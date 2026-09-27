/**
 * Prüfblock „Übersichtsschema" — zeigt das Prinzipbild dieselbe Anlage?
 *
 * **Warum dieser Block gebraucht wird.** Das Übersichtsbild lässt weg. Genau
 * deshalb kann es auf zwei Arten falsch werden, und beide sieht man ihm nicht
 * an:
 *
 *  1. **Es zeigt etwas, das die Anlage nicht hat.** Ein Bauteil, das nicht aus
 *     dem Ausführungsschema stammt, wäre eine Behauptung — und ein Monteur,
 *     der danach bestellt, bekommt ein Teil, das niemand ausgelegt hat.
 *  2. **Es lässt etwas Tragendes weg.** Ein Prinzipschema darf Absperrungen
 *     und Messstellen weglassen. Einen Speicher darf es nicht weglassen.
 *
 * Geprüft wird deshalb an drei Anlagen, die der Reihe nach mehr können: die
 * kleine Wärmepumpe mit einem Heizkörper, dieselbe mit Trennpuffer, und das
 * Referenzhaus mit Warmwasser, Fußbodenheizung und zwei Kreisen. Jeder
 * Sollwert ist unten hergeleitet; keiner stammt aus einem Probelauf.
 */

import type { CheckFn } from './typ';
import type { BimDocument, Fixture, HeatingCircuit, PlantStorage, SchematicKind } from '../../src/types/bim';
import { buildSchematic, designPlant } from '../../src/lib/plantDesign';
import {
  UEBERSICHT_HINWEIS,
  UEBERSICHT_HOECHSTZAHL,
  uebersichtsschema,
  type Uebersichtsschema,
} from '../../src/lib/schemaUebersicht';
import { portsOf } from '../../src/lib/schematicSymbols';
import { leitungsverlauf } from '../../src/lib/schemaLeitung';
import { UEBERSICHT_MASSE } from '../../src/lib/uebersichtZeichnen';
import { buildReferenceDocument } from '../reference';

/** Der Trennpuffer aus Fall (b) — dieselbe Vorlage wie im Prüfblock „Anlagenschema". */
const TRENNPUFFER: PlantStorage = {
  id: 'puffer-trenn',
  modelId: 'buffer-parallel-200',
  label: 'Trennpuffer 200 l',
  kind: 'buffer-parallel',
  volume: 200,
  suggested: false,
};

/** Wärmepumpe, ein Heizkörper, kein Warmwasser. */
function wpMitEinemHeizkoerper(doc: BimDocument, storages: Record<string, PlantStorage> = {}): BimDocument {
  const hk = doc.fixtures['eg-f-hk1'] as Fixture | undefined;
  const kreis: HeatingCircuit = {
    id: 'circuit-hk',
    label: 'Heizkörper EG',
    kind: 'radiator',
    roomIds: hk?.roomId ? [hk.roomId] : [],
    flowTemperature: 55,
    returnTemperature: 45,
    material: 'kupfer',
    mixed: false,
  };
  return {
    ...doc,
    fixtures: hk ? { [hk.id]: hk } : {},
    plant: { ...doc.plant!, storages, circuits: { [kreis.id]: kreis }, dhw: { ...doc.plant!.dhw, units: 0 } },
  };
}

const bauteile = (u: Uebersichtsschema) => u.bauteile.filter((b) => b.kind !== 'node');
const hat = (u: Uebersichtsschema, kind: SchematicKind) => bauteile(u).some((b) => b.kind === kind);
const anzahlVon = (u: Uebersichtsschema, kind: SchematicKind) => bauteile(u).filter((b) => b.kind === kind).length;

// ---------------------------------------------------------------------------

export function pruefeUebersichtsschema(check: CheckFn): void {
  const basis = buildReferenceDocument();
  const voll = buildSchematic(designPlant(basis, {}));
  const u = uebersichtsschema(voll.components, voll.links);

  // =========================================================================
  // 1 · Die Projektionsregel: nichts erfunden
  // =========================================================================
  {
    /*
     * Jedes Bauteil der Übersicht muss aus dem vollständigen Schema stammen.
     * Das ist die Zusage, auf der alles andere steht — ohne sie wäre die
     * Übersicht ein zweites, eigenständig gepflegtes Bild, und zwei Bilder
     * derselben Anlage laufen auseinander.
     *
     * Knotenpunkte sind ausgenommen: Ein Verteilpunkt ist eine Ecke der
     * Leitung und kein Bauteil; er trägt deshalb keine Herkunft.
     */
    const kennungen = new Set(voll.components.map((c) => c.id));
    const ohneHerkunft = bauteile(u).filter((b) => b.herkunft.length === 0).length;
    check('Übersicht · jedes Bauteil hat eine Herkunft', ohneHerkunft, 0);

    const fremd = bauteile(u)
      .flatMap((b) => b.herkunft)
      .filter((id) => !kennungen.has(id)).length;
    check('Übersicht · keine Herkunft zeigt ins Leere', fremd, 0);

    // Kein Bauteil des vollständigen Bildes darf doppelt verwendet werden:
    // Sonst stünde derselbe Heizkörper in zwei Zweigen.
    const alleHerkuenfte = bauteile(u).flatMap((b) => b.herkunft);
    check('Übersicht · keine Herkunft doppelt', alleHerkuenfte.length - new Set(alleHerkuenfte).size, 0);
  }

  // =========================================================================
  // 2 · Die Obergrenze — und dass sie nicht durch Streichen erkauft wird
  // =========================================================================
  {
    /*
     * Der BWP-Leitfaden Hydraulik führt je Schema acht bis fünfzehn
     * Hauptkomponenten. Fünfzehn ist damit die belegte Obergrenze dessen, was
     * in der Branche noch als Prinzipschema gilt.
     */
    /*
     * Gezählt werden **Hauptbauteile**. Die beiden Absperrungen des
     * Erzeugerzweigs stehen seit 1.62.0 im Bild und zählen nicht mit: Eine
     * Absperrung ist keine Hauptkomponente, sondern das Zubehör des Bauteils,
     * an dem sie sitzt. Zählte sie mit, drängte sie einen Speicher oder eine
     * Pumpe aus dem Bild — die Notbremse opferte dann eine Aussage, um eine
     * Armatur zu behalten.
     */
    const haupt = bauteile(u).filter((b) => b.kind !== 'shutoff');
    check('Übersicht · höchstens fünfzehn Bauteile', haupt.length <= UEBERSICHT_HOECHSTZAHL, true);
    check('Übersicht · und höchstens zwei Absperrungen', anzahlVon(u, 'shutoff') <= 2, true);

    /*
     * Und die Gegenprobe: Kein **tragendes** Bauteil darf herausgefallen sein.
     * Tragend sind Erzeuger, Speicher, Verteiler, Verbraucher, Pumpen und die
     * wegentscheidenden Ventile; Armaturen und Messstellen sind es nicht.
     * Fällt hier etwas durch, hat die Notbremse zugeschlagen, und das ist ein
     * Befund und kein Normalfall.
     */
    const tragendWeg = u.weggelassen.filter((w) => w.tragend).length;
    check('Übersicht · nichts Tragendes weggefallen', tragendWeg, 0);
  }

  // =========================================================================
  // 3 · Das Referenzhaus, Bauteil für Bauteil
  // =========================================================================
  {
    /*
     * Was in diesem Haus steht, folgt aus seiner Auslegung: eine
     * Monoblock-Wärmepumpe mit Hydraulikstation und Heizstab, ein Parallel-
     * puffer, Warmwasser über Umschaltventil und Speicher mit Verbrühschutz,
     * und zwei Arten von Verbrauchern — Fußbodenheizung (gemischt) und
     * Heizkörper. Dazu die Anlagenpumpe im Rücklauf und die Sicherheitsgruppe
     * am Erzeuger.
     */
    for (const kind of [
      'heatpump-outdoor',
      'hydraulic-station',
      'electric-heater',
      'safety-valve',
      'expansion-vessel',
      'valve-diverter',
      'cylinder',
      'mixing-valve-dhw',
      'buffer',
      'valve-3way',
      'floor-loop',
      'radiator',
      'pump',
    ] as SchematicKind[]) {
      check(`Übersicht · Referenzhaus zeigt ${kind}`, hat(u, kind), true);
    }

    /*
     * Und was **nicht** darin stehen darf: die Armaturen und Messstellen.
     * Sie sind der ganze Grund für dieses Bild.
     *
     * **Zwei Ausnahmen, seit 1.62.0** — gemeldet am 27.09.2026: „Filter wie
     * Schmutzfänger und Magnetabscheider sowie Absperrventile sollten hier
     * eingezeichnet sein."
     *
     *  · Der **Schlamm- und Magnetitabscheider** im Rücklauf ist bei einer
     *    Wärmepumpe keine Armatur, die man weglässt, sondern das Bauteil, das
     *    den Verflüssiger rettet — einen gelöteten Plattenwärmetauscher mit
     *    Spaltweiten im Zehntelmillimeterbereich. Die Schemaprüfung dieses
     *    Programms meldet sein Fehlen als eigene Regel; ein Bild, das ihn
     *    verschweigt, widerspräche der eigenen Prüfung.
     *  · Die **beiden Absperrungen** des Erzeugerzweigs: Der BWP-Leitfaden
     *    führt in jedem Schema „Umwälzpumpe + Rückschlagklappe und
     *    beidseitige Absperrventile". Gezeigt werden genau die zwei, die den
     *    Erzeuger tauschbar machen — nicht alle Absperrungen der Anlage.
     */
    for (const kind of [
      'check-valve',
      'balancing-valve',
      'valve-2way',
      'strainer',
      'air-separator',
      'pressure-gauge',
      'thermometer',
      'sensor',
      'heat-meter',
      'filling-valve',
      'backflow-preventer',
    ] as SchematicKind[]) {
      check(`Übersicht · Referenzhaus zeigt ${kind} nicht`, hat(u, kind), false);
    }
    check('Übersicht · der Magnetitabscheider steht im Bild', hat(u, 'dirt-separator'), true);
    check('Übersicht · die Absperrungen des Erzeugers stehen im Bild', anzahlVon(u, 'shutoff'), 2);
    /*
     * Und sie stehen an der richtigen Stelle: eine im Vorlauf, eine im
     * Rücklauf. Zwei Absperrungen im selben Strang wären keine Absperrung
     * des Erzeugers, sondern eine doppelte Absperrung einer Leitung.
     */
    const absperrY = bauteile(u).filter((b) => b.kind === 'shutoff').map((b) => b.y);
    check('Übersicht · eine im Vorlauf, eine im Rücklauf', new Set(absperrY).size, 2);

    /*
     * Beide Fußbodenheizkreise des Referenzhauses (EG und OG) hängen gleich:
     * Verteiler, Mischer, Kreispumpe, 35/28 °C. Sie werden deshalb zu **einem**
     * Symbol mit der Anzahl 2 zusammengefasst — dass es zwei Geschosse sind,
     * sagt der Grundriss und nicht das Prinzipbild. Dasselbe gilt für die
     * beiden Heizkörper (50/40 °C).
     */
    check('Übersicht · nur ein Symbol für die Fußbodenheizung', anzahlVon(u, 'floor-loop'), 1);
    check('Übersicht · nur ein Symbol für die Heizkörper', anzahlVon(u, 'radiator'), 1);
    const fbh = bauteile(u).find((b) => b.kind === 'floor-loop');
    const hk = bauteile(u).find((b) => b.kind === 'radiator');
    check('Übersicht · die Fußbodenheizung zählt zwei Kreise', fbh?.anzahl ?? 0, 2);
    check('Übersicht · der Heizkörper zählt zwei Stück', hk?.anzahl ?? 0, 2);
    check('Übersicht · die Fußbodenheizung nennt ihre Temperaturen', /35\/28/.test(fbh?.spec ?? ''), true);
    check('Übersicht · der Heizkörper nennt seine Temperaturen', /50\/40/.test(hk?.spec ?? ''), true);
  }

  // =========================================================================
  // 4 · Die Baugruppen
  // =========================================================================
  {
    /*
     * Zwei Rahmen gehören ins Referenzhaus: die **Sicherheitsgruppe** aus
     * Sicherheitsventil und Ausdehnungsgefäß, und der **Heizkreisverteiler**.
     *
     * Letzterer ist neu in 1.62.0. Gemeldet am 27.09.2026: „oft werden
     * Pumpengruppen, also Pumpe extern für ungemischt und Mischerpumpe, in
     * einem Teil zusammengebaut … wenn es als Pumpengruppe im
     * Heizkreisverteiler liegt, ist das in einem Kasten." Das Referenzhaus
     * hat genau diesen Fall: zwei Zweige — Fußbodenheizung gemischt,
     * Heizkörper ungemischt — an **einem** Verteilbalken. Sie stecken in
     * einem Kasten und werden so gekauft; bis 1.61.0 bekam der gemischte
     * Zweig einen eigenen Rahmen „Mischergruppe" und die Pumpe des
     * ungemischten stand nackt daneben.
     */
    const namen = u.gruppen.map((g) => g.name).sort();
    check('Übersicht · zwei Baugruppen', u.gruppen.length, 2);
    check('Übersicht · Baugruppen benannt', namen.join('|'), 'Heizkreisverteiler|Sicherheitsgruppe');

    const sicherheit = u.gruppen.find((g) => g.name === 'Sicherheitsgruppe');
    check('Übersicht · die Sicherheitsgruppe fasst zwei Bauteile', sicherheit?.bauteile.length ?? 0, 2);

    /*
     * Der Verteiler fasst **drei**: den Mischer des Flächenkreises und die
     * Umwälzpumpen beider Zweige. Damit steht im Bild, was auf der Baustelle
     * ein Teil ist — und nicht drei Einzelteile, die jemand einzeln bestellt.
     */
    const verteiler = u.gruppen.find((g) => g.name === 'Heizkreisverteiler');
    check('Übersicht · der Heizkreisverteiler fasst drei Bauteile', verteiler?.bauteile.length ?? 0, 3);
    const inVerteiler = (verteiler?.bauteile ?? [])
      .map((id) => u.bauteile.find((b) => b.id === id)?.kind ?? '?')
      .sort()
      .join(', ');
    check('Übersicht · und zwar Mischer und beide Pumpen', inVerteiler, 'pump, pump, valve-3way');

    // Ein Rahmen um ein einziges Bauteil ist kein Rahmen — er darf nicht
    // vorkommen, sonst zeichnet das Bild Kästchen ohne Aussage.
    const einzeln = u.gruppen.filter((g) => g.bauteile.length < 2).length;
    check('Übersicht · kein Rahmen um ein einziges Bauteil', einzeln, 0);

    // Jeder Rahmen zeigt auf Bauteile, die es auch gibt.
    const vorhanden = new Set(u.bauteile.map((b) => b.id));
    const verirrt = u.gruppen.flatMap((g) => g.bauteile).filter((id) => !vorhanden.has(id)).length;
    check('Übersicht · kein Rahmen zeigt auf ein fehlendes Bauteil', verirrt, 0);
  }

  // =========================================================================
  // 5 · Die Leitungen
  // =========================================================================
  {
    const vorhanden = new Set(u.bauteile.map((b) => b.id));
    const haengend = u.leitungen.filter((l) => !vorhanden.has(l.from) || !vorhanden.has(l.to)).length;
    check('Übersicht · keine Leitung hängt in der Luft', haengend, 0);

    /*
     * Jede Leitung nennt ihre Stutzen, und es gibt sie am Symbol. Das ist
     * dieselbe Regel wie im vollständigen Schema, und sie hat denselben
     * Grund: Eine Heizungsleitung, die am Kaltwasserstutzen des Speichers
     * endet, behauptet genau die Verbindung, die durch Systemtrennung
     * ausgeschlossen sein muss.
     */
    const nach = new Map(u.bauteile.map((b) => [b.id, b]));
    let ohneStutzen = 0;
    let zeichenbar = 0;
    for (const l of u.leitungen) {
      const a = nach.get(l.from);
      const b = nach.get(l.to);
      if (!a || !b) continue;
      const hatVon = portsOf(a.kind).some((p) => p.id === l.fromPort);
      const hatNach = portsOf(b.kind).some((p) => p.id === l.toPort);
      if (!hatVon || !hatNach) ohneStutzen += 1;
      if (leitungsverlauf(a, b, l, UEBERSICHT_MASSE)) zeichenbar += 1;
    }
    check('Übersicht · jede Leitung sitzt an einem Stutzen, den es gibt', ohneStutzen, 0);
    check('Übersicht · jede Leitung lässt sich zeichnen', zeichenbar, u.leitungen.length);

    /*
     * **Trinkwasser und Heizungswasser bleiben getrennt.** Der Speicher ist
     * die einzige Stelle, an der beide Stoffe an einem Bauteil liegen — und
     * genau dort entscheidet der Stutzen. Eine Heizungsleitung darf an
     * `flow`/`return` hängen, niemals an `dhw`/`cold`.
     */
    const TRINKWASSERSTUTZEN: Partial<Record<SchematicKind, string[]>> = {
      cylinder: ['cold', 'dhw'],
      freshwater: ['dhw', 'cold'],
      'mixing-valve-dhw': ['hot', 'mixed', 'cold'],
      'circulation-pump': ['in', 'out'],
    };
    const heizung = (s: string) => s === 'heating-flow' || s === 'heating-return';
    let vermischt = 0;
    for (const l of u.leitungen) {
      const a = nach.get(l.from);
      const b = nach.get(l.to);
      if (!a || !b) continue;
      const aTrink = TRINKWASSERSTUTZEN[a.kind]?.includes(l.fromPort) ?? false;
      const bTrink = TRINKWASSERSTUTZEN[b.kind]?.includes(l.toPort) ?? false;
      if (heizung(l.service) && (aTrink || bTrink)) vermischt += 1;
      if (!heizung(l.service) && l.service !== 'waste') {
        // Umgekehrt: eine Trinkwasserleitung an einem Heizungsstutzen.
        const aHeiz = a.kind === 'cylinder' && (l.fromPort === 'flow' || l.fromPort === 'return');
        const bHeiz = b.kind === 'cylinder' && (l.toPort === 'flow' || l.toPort === 'return');
        if (aHeiz || bHeiz) vermischt += 1;
      }
    }
    check('Übersicht · Heizungs- und Trinkwasser bleiben getrennt', vermischt, 0);

    /*
     * **Was hineinläuft, muss auch wieder heraus.**
     *
     * Gemeldet aus der Benutzung: „hier fehlt der Rücklauf". Die
     * Speicherladeleitung war einbahnig gezeichnet — der Vorlauf ging in den
     * Trinkwasserspeicher hinein, und zurück kam nichts. In einem Fließbild
     * ist das keine Unschönheit, sondern eine falsche Aussage: Es behauptet
     * einen Strang, der nirgends endet.
     *
     * Geprüft wird deshalb für **jedes** Bauteil, das einen Heizungsvorlauf
     * bekommt und einen Rücklaufstutzen hat: Hängt an diesem Stutzen auch
     * eine Leitung? Die Prüfung ist allgemein und nicht auf den Speicher
     * gemünzt — sie greift genauso beim Puffer, beim Verteiler und bei jedem
     * Verbraucher.
     */
    const RUECKSTUTZEN: Partial<Record<SchematicKind, string>> = {
      cylinder: 'return',
      freshwater: 'prim-return',
      buffer: 'sys-return',
      separator: 'sys-return',
      radiator: 'return',
      'floor-loop': 'return',
      manifold: 'return',
    };
    const ohneRuecklauf: string[] = [];
    for (const b of u.bauteile) {
      const stutzen = RUECKSTUTZEN[b.kind];
      if (!stutzen) continue;
      const bekommtVorlauf = u.leitungen.some((l) => l.to === b.id && l.service === 'heating-flow');
      if (!bekommtVorlauf) continue;
      const gibtZurueck = u.leitungen.some(
        (l) => (l.from === b.id && l.fromPort === stutzen) || (l.to === b.id && l.toPort === stutzen),
      );
      if (!gibtZurueck) ohneRuecklauf.push(`${b.kind}/${b.id}`);
    }
    check(`Übersicht · jeder Vorlauf hat seinen Rücklauf${ohneRuecklauf.length ? ` (${ohneRuecklauf.join(', ')})` : ''}`, ohneRuecklauf.length, 0);
  }

  // =========================================================================
  // 6 · Der Hinweissatz
  // =========================================================================
  {
    /*
     * Er gehört zum Bild und nicht zur Oberfläche: Wer die Übersicht druckt
     * oder weitergibt, muss ihn mitbekommen. Geprüft wird, dass er da ist und
     * dass er die beiden Aussagen trägt, auf die es ankommt — dass das Bild
     * ein **Beispiel** ist, und woran man sich stattdessen hält.
     */
    check('Übersicht · der Hinweissatz steht am Bild', u.hinweis, UEBERSICHT_HINWEIS);
    check('Übersicht · der Hinweis nennt es ein Beispielschema', /^Beispielschema\./.test(u.hinweis), true);
    check('Übersicht · der Hinweis nennt das Maßgebende', /Maßgebend für die Ausführung/.test(u.hinweis), true);
    check('Übersicht · der Hinweis nennt die Ergänzungspflicht', /anlagenspezifisch zu ergänzen/.test(u.hinweis), true);
  }

  // =========================================================================
  // 7 · Die kleinen Anlagen — wird das Bild mit ihnen kleiner?
  // =========================================================================
  {
    /*
     * Fall (a): Wärmepumpe, ein Heizkörper, kein Warmwasser. Die Auslegung
     * fordert hier einen Reihenpuffer für den Mindestwasserinhalt; Warmwasser
     * gibt es nicht, also auch kein Umschaltventil, keinen Speicher und
     * keinen Verbrühschutz. Es bleiben: Wärmepumpe, Hydraulikstation,
     * Heizstab, Sicherheitsventil, Ausdehnungsgefäß, Puffer, Heizkörper und
     * der Magnetitabscheider — acht Bauteile, dazu die beiden Absperrungen
     * des Erzeugerzweigs, die nicht als Hauptkomponente zählen: zehn Symbole.
     *
     * **Die Rechnung gegenüber 1.61.0**: −1 (die externe Pumpe entfällt, die
     * Hydraulikeinheit hat sie), +1 Abscheider, +2 Absperrungen. Acht
     * Hauptbauteile bleiben acht — genau die untere Grenze der Spanne, die
     * der BWP-Leitfaden für ein Prinzipschema nennt.
     */
    const a = uebersichtsschema(...schemaVon(wpMitEinemHeizkoerper(basis)));
    check('Übersicht · kleine Anlage kommt mit zehn Symbolen aus', bauteile(a).length, 10);
    check(
      'Übersicht · davon acht Hauptbauteile',
      bauteile(a).filter((b) => b.kind !== 'shutoff').length,
      8,
    );
    check('Übersicht · keine externe Pumpe neben der Hydraulikstation', hat(a, 'pump'), false);
    check('Übersicht · kleine Anlage ohne Umschaltventil', hat(a, 'valve-diverter'), false);
    check('Übersicht · kleine Anlage ohne Trinkwasserspeicher', hat(a, 'cylinder'), false);
    check('Übersicht · kleine Anlage ohne Mischer', hat(a, 'valve-3way'), false);
    check('Übersicht · kleine Anlage zeigt trotzdem den Erzeuger', hat(a, 'heatpump-outdoor'), true);
    check('Übersicht · kleine Anlage zeigt trotzdem die Sicherheitsgruppe', hat(a, 'safety-valve'), true);
    check('Übersicht · kleine Anlage: nichts Tragendes weggefallen', a.weggelassen.filter((w) => w.tragend).length, 0);

    /*
     * Ein einziger Verbraucherzweig braucht **keinen Verteilbalken**. Ein
     * Knoten mit je einer Leitung auf beiden Seiten behauptete eine
     * Verteilung, die es nicht gibt — dieselbe Regel wie im vollständigen
     * Schema.
     */
    const balken = a.bauteile.filter((b) => b.id.startsWith('u-k-balken')).length;
    check('Übersicht · ein Zweig, kein Verteilbalken', balken, 0);
    /*
     * Ein Knoten bleibt trotzdem übrig, und er gehört dorthin: der
     * Anschlusspunkt der Sicherheitsgruppe am Erzeugervorlauf. Ohne ihn
     * hinge das Sicherheitsventil an keiner Leitung.
     */
    check('Übersicht · der Anschluss der Sicherheitsgruppe bleibt', a.bauteile.filter((b) => b.kind === 'node').length, 1);

    /*
     * Fall (b): dieselbe Anlage mit Trennpuffer. Er trennt Erzeuger- und
     * Anlagenseite, und dadurch bekommt der Heizkreis eine **eigene** Pumpe —
     * ein Symbol mehr als in Fall (a), also elf. Die Erzeugerpumpe steckt
     * weiterhin in der Hydraulikeinheit; gezeichnet wird die, die bauseits
     * gesetzt wird.
     */
    const b = uebersichtsschema(...schemaVon(wpMitEinemHeizkoerper(basis, { [TRENNPUFFER.id]: TRENNPUFFER })));
    check('Übersicht · mit Trennpuffer elf Symbole', bauteile(b).length, 11);
    check('Übersicht · und die Kreispumpe dazu', anzahlVon(b, 'pump'), 1);
    check('Übersicht · der Trennpuffer steht im Bild', hat(b, 'buffer'), true);
  }

  // =========================================================================
  // 8 · Die Weglassliste
  // =========================================================================
  {
    /*
     * Was herausfiel, wird gezählt und benannt — nicht, um es im Bild zu
     * zeigen, sondern damit es überhaupt eine Zahl gibt. Am Referenzhaus sind
     * das die Absperrungen, Rückschlagklappen, Thermostatventile,
     * Rücklaufverschraubungen, Abscheider, Füllarmatur, Systemtrenner, das
     * Manometer, der Wärmemengenzähler und das Sicherheitsventil der
     * Trinkwasserseite.
     */
    check('Übersicht · die Weglassliste ist nicht leer', u.weggelassen.length > 0, true);
    const summe = u.weggelassen.reduce((s, w) => s + w.anzahl, 0);
    const gezeigt = bauteile(u).reduce((s, b) => s + b.herkunft.length, 0);
    check('Übersicht · gezeigt plus weggelassen ist das ganze Schema', gezeigt + summe, u.vollstaendig);
    check('Übersicht · jede Weglassung hat einen Klartextnamen', u.weggelassen.every((w) => w.name.length > 2), true);
  }
}

/** Auslegung und Schema in einem Griff — spart drei Zeilen je Prüffall. */
function schemaVon(doc: BimDocument): [ReturnType<typeof buildSchematic>['components'], ReturnType<typeof buildSchematic>['links']] {
  const s = buildSchematic(designPlant(doc, {}));
  return [s.components, s.links];
}
