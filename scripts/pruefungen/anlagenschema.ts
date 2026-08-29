/**
 * Prüfblock „Anlagenschema" — stimmt das Bild mit der Auslegung überein?
 *
 * **Warum dieser Block gebraucht wird.** Ein Fachplaner hat das erzeugte
 * Strangschema durchgesehen und sieben Fehler gefunden, die alle dieselbe
 * Wurzel hatten: der Zeichner traf seine eigenen Entscheidungen, statt die
 * Auslegung zu zeichnen. Der Mischer saß am Heizkörper statt an der Fläche,
 * der Reihenpuffer hing mit einer einzigen Leitung im Nichts, der Heizstab
 * fehlte, und die Speicherladeleitung endete am **Trinkwasser-Kaltwasser-
 * stutzen** des Speichers — auf dem Blatt stand damit genau die Verbindung
 * zwischen Heizungs- und Trinkwasser, die durch Systemtrennung ausgeschlossen
 * sein muss.
 *
 * Die alten Prüfungen haben das nicht gefunden, weil sie nur zählten:
 * „mehr als acht Bauteile", „keine Leitung hängt in der Luft". Beides war
 * erfüllt. Dieser Block prüft stattdessen die **Topologie**: welcher Stutzen
 * an welchem Stutzen hängt, welcher Stoff darin läuft, und ob das Bild die
 * Entscheidungen der Auslegung wiedergibt.
 *
 * **Was seit 1.10 dazugekommen ist.** Ein Heizungsbauer hat zwei weitere
 * Punkte gemeldet. Erstens: „Heizkörper bekommen auch Ventile." Im Grundriss
 * setzte der Rohrausleger Thermostatventil und Rücklaufverschraubung längst,
 * im Schema hing der Heizkörper nackt an der Leitung — zwei Darstellungen
 * derselben Anlage, die sich widersprachen. Zweitens: „Der Hydraulikplan muss
 * nach den Gegebenheiten dargestellt werden." Der Generator zeichnete
 * unabhängig von der Anlagengröße immer denselben Vollausbau, samt
 * Verteilbalken für einen einzigen Heizkreis — ein Knoten mit je einer Leitung
 * auf beiden Seiten, der eine Verteilung behauptete, die es nicht gab.
 *
 * Geprüft wird das jetzt nicht mehr nur am Referenzhaus, sondern an den drei
 * Anlagen, die der Heizungsbauer nennt: (a) Wärmepumpe mit einem Heizkörper,
 * (b) Wärmepumpe mit Trennpuffer und Heizkörper, (c) die volle Anlage mit
 * Warmwasser, mehreren Kreisen und Trennpuffer. Je Fall steht die vollständige
 * Liste der erwarteten Bauteilarten im Test — „mehr als acht Bauteile" war
 * genau die Prüfung, die den Vollausbau durchgelassen hat.
 *
 * Alle Sollwerte folgen aus der Anlagentechnik und sind im Kommentar
 * begründet; keiner stammt aus einem Probelauf.
 */

import type { CheckFn } from './typ';
import type {
  BimDocument,
  Fixture,
  HeatingCircuit,
  PipeService,
  PlantStorage,
  Room,
  SchematicComponent,
  SchematicKind,
  SchematicLink,
} from '../../src/types/bim';
import { buildSchematic, designPlant } from '../../src/lib/plantDesign';
import { hasPort, portsOf } from '../../src/lib/schematicSymbols';
import { MASSIVE_SHARE, isMassiveArea } from '../../src/lib/roomDetection';
import { levelBaseHeights } from '../../src/lib/levelGeometry';
import { buildReferenceDocument } from '../reference';

/**
 * Stutzen, an denen **Trinkwasser** anliegt.
 *
 * Sie sind der Grund für diesen ganzen Block: eine Heizungsleitung darf hier
 * niemals enden, und eine Trinkwasserleitung niemals an einem Heizungsstutzen.
 */
const TRINKWASSER: Partial<Record<SchematicKind, string[]>> = {
  cylinder: ['cold', 'dhw'],
  'mixing-valve-dhw': ['hot', 'mixed', 'cold'],
  freshwater: ['dhw', 'cold'],
  'circulation-pump': ['in', 'out'],
};

/**
 * Stutzen, an denen **Heizungswasser** anliegt.
 *
 * `valve-2way` und `balancing-valve` stehen hier, weil der Generator sie
 * ausschließlich in der Übergabe einsetzt — Thermostatventil und
 * Rücklaufverschraubung am Heizkörper, Regulierventil am Verteiler. `shutoff`
 * fehlt bewusst: eine Absperrung ist eine allgemeine Armatur und sitzt genauso
 * in einer Trinkwasserleitung.
 */
const HEIZUNG: Partial<Record<SchematicKind, string[]>> = {
  cylinder: ['flow', 'return'],
  buffer: ['gen-flow', 'gen-return', 'sys-flow', 'sys-return'],
  separator: ['gen-flow', 'gen-return', 'sys-flow', 'sys-return'],
  'heatpump-outdoor': ['flow', 'return'],
  manifold: ['flow', 'return'],
  radiator: ['flow', 'return'],
  'floor-loop': ['flow', 'return'],
  'valve-2way': ['in', 'out'],
  'balancing-valve': ['in', 'out'],
};

const HEIZUNGSSTOFF: PipeService[] = ['heating-flow', 'heating-return'];
const TRINKSTOFF: PipeService[] = ['cold-water', 'hot-water', 'circulation'];

interface Schema {
  components: SchematicComponent[];
  links: SchematicLink[];
  notes: { severity: string; text: string }[];
}

const byId = (schema: Schema) => new Map(schema.components.map((c) => [c.id, c]));
/** Kurzform für die Fallprüfungen, die ihre eigene Tabelle brauchen. */
const map2 = byId;
const artOf = (schema: Schema, kind: SchematicKind) => schema.components.filter((c) => c.kind === kind);
const einer = (schema: Schema, kind: SchematicKind) => artOf(schema, kind)[0];

/** Alle Leitungen, die an einem Bauteil hängen. */
const anBauteil = (schema: Schema, id: string) => schema.links.filter((l) => l.from === id || l.to === id);

/**
 * Die beiden Regeln, die für **jedes** erzeugte Schema gelten.
 *
 * Sie stehen als eigene Funktion da, weil sie sonst nur am Referenzhaus
 * geprüft würden. Genau das war die Lücke: die Anlagenvarianten — eine
 * Wärmepumpe mit einem Heizkörper, eine mit Trennpuffer — laufen durch andere
 * Zweige des Generators, und ein vergessener Stutzenname fiele dort erst dem
 * Zeichner auf.
 */
function pruefeGrundregeln(check: CheckFn, fall: string, schema: Schema): void {
  const map = byId(schema);

  const ohneNamen = schema.links.filter((l) => !l.fromPort || !l.toPort);
  check(`${fall}: jede Leitung nennt beide Stutzen`, ohneNamen.length, 0);

  const unbekannt = schema.links.filter((l) => {
    const a = map.get(l.from);
    const b = map.get(l.to);
    if (!a || !b) return true;
    return !hasPort(a.kind, l.fromPort ?? '') || !hasPort(b.kind, l.toPort ?? '');
  });
  check(`${fall}: jeder genannte Stutzen existiert am Symbol`, unbekannt.length, 0);

  let verstoesse = 0;
  for (const l of schema.links) {
    const a = map.get(l.from);
    const b = map.get(l.to);
    if (!a || !b) continue;
    for (const [c, port] of [
      [a, l.fromPort ?? ''],
      [b, l.toPort ?? ''],
    ] as [SchematicComponent, string][]) {
      const trink = TRINKWASSER[c.kind]?.includes(port) ?? false;
      const heiz = HEIZUNG[c.kind]?.includes(port) ?? false;
      if (trink && HEIZUNGSSTOFF.includes(l.service)) verstoesse += 1;
      if (heiz && TRINKSTOFF.includes(l.service)) verstoesse += 1;
    }
  }
  check(`${fall}: keine Heizungsleitung an einem Trinkwasserstutzen`, verstoesse, 0);

  // Kein Bauteil hängt einseitig im Nichts — Knoten und Heizflächen sind
  // Systemgrenzen bzw. Übergabe und dürfen einseitig enden.
  const offen = schema.components.filter((c) => {
    if (c.kind === 'node') return false;
    if (c.kind === 'radiator' || c.kind === 'floor-loop') return false;
    const noetig = Math.min(2, portsOf(c.kind).length);
    return anBauteil(schema, c.id).length < noetig;
  });
  check(`${fall}: kein Bauteil hängt einseitig im Nichts`, offen.map((c) => c.label).join(', '), '');

  // Zwei Bauteile auf demselben Rasterplatz überdecken sich im Blatt.
  const plaetze = new Set(schema.components.map((c) => `${c.x}|${c.y}`));
  check(`${fall}: jeder Rasterplatz ist einmal belegt`, plaetze.size, schema.components.length);
}

/**
 * Fall (a) und (b) des Heizungsbauers: eine Wärmepumpe, **ein** Heizkörper.
 *
 * Aus dem Referenzhaus bleibt genau ein Heizkörper stehen, die Kreisliste wird
 * von Hand auf einen Kreis gesetzt und das Warmwasser abgeschaltet. Damit läuft
 * die Auslegung durch denselben Rechenweg wie sonst — nur eben für die
 * kleinste Anlage, die es gibt.
 */
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
    plant: {
      ...doc.plant!,
      storages,
      circuits: { [kreis.id]: kreis },
      dhw: { ...doc.plant!.dhw, units: 0 },
    },
  };
}

/**
 * Ein Haus ohne Heizkörper: alle Räume hängen an Fußbodenheizung.
 *
 * Der Wasserinhalt der Estrichkreise deckt hier den Mindestinhalt der
 * Wärmepumpe — die Auslegung fordert deshalb keinen Puffer. Das ist der
 * einzige Weg, den Zweig „ohne Puffer" mit echten Zahlen zu erreichen: acht
 * Liter je Kilowatt Heizkörperleistung tragen die geforderten rund
 * siebzehn nie.
 */
function nurFlaechenheizung(doc: BimDocument): BimDocument {
  const fixtures: Record<string, Fixture> = {};
  for (const [id, f] of Object.entries(doc.fixtures)) if (f.type !== 'radiator') fixtures[id] = f;
  return { ...doc, fixtures, plant: { ...doc.plant!, dhw: { ...doc.plant!.dhw, units: 0 } } };
}

/** Derselbe Fall mit genau einem Flächenkreis über alle Räume. */
function einFlaechenkreis(doc: BimDocument): BimDocument {
  const basis = nurFlaechenheizung(doc);
  const kreis: HeatingCircuit = {
    id: 'circuit-fbh',
    label: 'Fußbodenheizung',
    kind: 'floor',
    roomIds: Object.values(doc.rooms)
      .filter((r) => r.isHeated !== false)
      .map((r) => r.id),
    flowTemperature: 35,
    returnTemperature: 28,
    material: 'kupfer',
    mixed: false,
  };
  return { ...basis, plant: { ...basis.plant!, circuits: { [kreis.id]: kreis } } };
}

/** Der Trennpuffer aus Fall (b) und (c). */
const TRENNPUFFER: PlantStorage = {
  id: 'puffer-trenn',
  modelId: 'buffer-parallel-200',
  label: 'Trennpuffer 200 l',
  kind: 'buffer-parallel',
  volume: 200,
  suggested: false,
};

/** Ein Dokument ohne Warmwasser: null Wohneinheiten. */
function ohneWarmwasser(doc: BimDocument): BimDocument {
  return { ...doc, plant: { ...doc.plant!, dhw: { ...doc.plant!.dhw, units: 0 } } };
}

/** Ein Dokument mit Trennpuffer statt Reihenpuffer. */
function mitTrennpuffer(doc: BimDocument): BimDocument {
  return {
    ...doc,
    plant: { ...doc.plant!, storages: { ...doc.plant!.storages, [TRENNPUFFER.id]: TRENNPUFFER } },
  };
}

// ---------------------------------------------------------------------------

export function pruefeAnlagenschema(check: CheckFn): void {
  const doc = buildReferenceDocument();
  const plan = designPlant(doc, {});
  const schema = buildSchematic(plan);
  const map = byId(schema);

  // =========================================================================
  // 1 · Jede Leitung nennt ihre Stutzen — und es gibt sie
  // =========================================================================
  {
    const ohneNamen = schema.links.filter((l) => !l.fromPort || !l.toPort);
    check('Jede erzeugte Leitung nennt beide Stutzen', ohneNamen.length, 0);

    const unbekannt = schema.links.filter((l) => {
      const a = map.get(l.from);
      const b = map.get(l.to);
      if (!a || !b) return true;
      return !hasPort(a.kind, l.fromPort ?? '') || !hasPort(b.kind, l.toPort ?? '');
    });
    check('Und jeder genannte Stutzen existiert am Symbol', unbekannt.length, 0);
  }

  // =========================================================================
  // 2 · Heizungswasser und Trinkwasser berühren sich nicht
  // =========================================================================
  {
    let verstoesse = 0;
    let beispiel = '';
    for (const l of schema.links) {
      const a = map.get(l.from);
      const b = map.get(l.to);
      if (!a || !b) continue;
      const enden: [SchematicComponent, string][] = [
        [a, l.fromPort ?? ''],
        [b, l.toPort ?? ''],
      ];
      for (const [c, port] of enden) {
        const trink = TRINKWASSER[c.kind]?.includes(port) ?? false;
        const heiz = HEIZUNG[c.kind]?.includes(port) ?? false;
        if (trink && HEIZUNGSSTOFF.includes(l.service)) {
          verstoesse += 1;
          beispiel = `${l.service} an ${c.kind}.${port}`;
        }
        if (heiz && TRINKSTOFF.includes(l.service)) {
          verstoesse += 1;
          beispiel = `${l.service} an ${c.kind}.${port}`;
        }
      }
    }
    check('Keine Heizungsleitung an einem Trinkwasserstutzen', verstoesse, 0);
    if (verstoesse > 0) check('… gefundenes Beispiel', beispiel, '(keines)');

    // Die Speicherladung geht an den Wärmetauscher, nicht in den Speicher.
    const speicher = einer(schema, 'cylinder');
    const ladung = schema.links.find((l) => l.to === speicher?.id && l.service === 'heating-flow');
    check('Die Speicherladung geht an den Heizungsvorlauf des Speichers', ladung?.toPort ?? 'fehlt', 'flow');
  }

  // =========================================================================
  // 3 · Sicherheitsgruppe: Abzweige, keine Reihe
  // =========================================================================
  {
    const sv = artOf(schema, 'safety-valve').find((c) => c.label === 'Sicherheitsventil' && c.y < 0);
    const mag = einer(schema, 'expansion-vessel');
    check('Das Sicherheitsventil steht im Schema', Boolean(sv), true);
    check('Das Ausdehnungsgefäß steht im Schema', Boolean(mag), true);

    // Nichts hängt am Abblasestutzen außer der Abblaseleitung.
    const amAbblas = schema.links.filter((l) => (l.from === sv?.id && l.fromPort === 'blow') || (l.to === sv?.id && l.toPort === 'blow'));
    check('Am Abblasestutzen hängt genau eine Leitung', amAbblas.length, 1);
    check('… und sie führt ins Freie', amAbblas[0]?.service ?? 'fehlt', 'waste');
    const ziel = map.get(amAbblas[0]?.to ?? '');
    check('… zu einer benannten Systemgrenze', ziel?.kind ?? 'fehlt', 'node');

    // Die Ausdehnungsleitung kommt vom Erzeugerknoten, nicht vom Ventil.
    const zumMag = schema.links.filter((l) => l.to === mag?.id);
    check('Zum Ausdehnungsgefäß führt genau eine Leitung', zumMag.length, 1);
    check('… und sie kommt von einem Knoten, nicht vom Sicherheitsventil',
      map.get(zumMag[0]?.from ?? '')?.kind ?? 'fehlt', 'node');
  }

  // =========================================================================
  // 4 · Der Puffer hat Zu- und Abfluss
  // =========================================================================
  {
    const puffer = einer(schema, 'buffer');
    check('Der Puffer steht im Schema', Boolean(puffer), true);
    const hinein = schema.links.filter((l) => l.to === puffer?.id);
    const hinaus = schema.links.filter((l) => l.from === puffer?.id);
    // Ein Reihenpuffer liegt **in** der Rücklaufleitung: eine Leitung hinein,
    // eine hinaus. Bis 1.8.1 hatte er nur eine hinaus und war ein toter Ast.
    check('In den Puffer führt mindestens eine Leitung', hinein.length >= 1, true);
    check('Aus dem Puffer führt mindestens eine Leitung', hinaus.length >= 1, true);
    /*
     * Das Prüfhaus hat vier Kreise, davon gemischte — seit 1.13.0 wählt die
     * Auslegung dafür einen **Parallelpuffer** statt eines Reihenpuffers.
     * Das ist die Reparatur, nicht der Fehler: ein Reihenpuffer liegt im
     * Rücklauf und trennt nicht, die Kreispumpen förderten also durch den
     * Wärmetauscher des Erzeugers mit. Der BWP zeigt den Reihenpuffer
     * ausschließlich in Schema 2 — ein einziger ungemischter Kreis.
     *
     * Ein Parallelpuffer hat vier Anschlüsse: zwei Vorlauf (einer hinein vom
     * Erzeuger, einer hinaus zur Anlage), zwei Rücklauf.
     */
    check('Das Prüfhaus bekommt einen Parallelpuffer',
      plan.buffer.selected?.kind ?? 'fehlt', 'buffer-parallel');
    check('Der Parallelpuffer hat vier Anschlüsse', hinein.length + hinaus.length, 4);
    check('… je zwei im Vorlauf und im Rücklauf',
      [...hinein, ...hinaus].filter((l) => l.service === 'heating-flow').length, 2);
  }

  // =========================================================================
  // 5 · Gemischt ist die Fläche, nicht der Heizkörper
  // =========================================================================
  {
    const flaechen = plan.circuits.filter((c) => c.circuit.kind === 'floor');
    const koerper = plan.circuits.filter((c) => c.circuit.kind === 'radiator');
    check('Das Prüfhaus hat beide Kreisarten', flaechen.length > 0 && koerper.length > 0, true);
    // Der Erzeuger fährt die höchste geforderte Temperatur (Heizkörper 50 °C);
    // heruntergemischt wird die Fläche (35 °C). Hinaufmischen kann kein Mischer.
    check('Die Fläche ist gemischt', flaechen.every((c) => c.circuit.mixed), true);
    check('Der Heizkörper ist ungemischt', koerper.every((c) => !c.circuit.mixed), true);

    const mischer = artOf(schema, 'valve-3way');
    check('Ein Mischer je gemischtem Kreis', mischer.length, flaechen.length);
    for (const m of mischer) {
      const hot = schema.links.some((l) => l.to === m.id && l.toPort === 'hot');
      const cold = schema.links.some((l) => l.to === m.id && l.toPort === 'cold');
      const mixed = schema.links.some((l) => l.from === m.id && l.fromPort === 'mixed');
      check(`Mischer „${m.label}“: Vorlauf, Beimischung und Mischwasser angeschlossen`, hot && cold && mixed, true);
    }
    // Zum Mischer gehört eine Pumpe — ohne sie steht der Kreis, sobald der
    // Mischer zufährt.
    const kreispumpen = artOf(schema, 'pump').filter((c) => c.label === 'Kreispumpe');
    check('Jeder gemischte Kreis hat eine eigene Pumpe', kreispumpen.length >= flaechen.length, true);
  }

  // =========================================================================
  // 6 · Was ausgelegt ist, wird gezeichnet
  // =========================================================================
  {
    const modell = plan.selected?.model;
    const heizstab = modell?.indoor?.backupHeater ?? modell?.electric.backupHeater ?? 0;
    check('Das Prüfgerät führt einen Heizstab', heizstab > 0, true);
    check('… und er steht im Schema', artOf(schema, 'electric-heater').length, 1);

    /*
     * Der Monoblock außen bekommt seine Hydraulikstation — über den ganzen
     * Markt liefert jeder Hersteller eine dazu.
     *
     * Seit 1.13.0 trägt sie ihr **eigenes** Symbol. Bis dahin bekam sie das
     * der Wärmepumpe, samt Verdichterkreis — ein Bauteil, das eine
     * Hydraulikstation nicht hat. Wer das Bild las, suchte einen zweiten
     * Erzeuger. `heatpump-indoor` bleibt dem Splitgerät vorbehalten: dort
     * steht drinnen tatsächlich ein Kältekreis (der Verflüssiger).
     */
    check('Zum Monoblock außen gehört eine Hydraulikstation', artOf(schema, 'hydraulic-station').length, 1);
    check('… und sie trägt nicht das Symbol der Wärmepumpe', artOf(schema, 'heatpump-indoor').length, 0);

    const luft = einer(schema, 'air-separator');
    check('Der Abscheider heißt nach seiner Bauart', (luft?.label ?? '').includes('Mikroblasen'), true);
    // Er gehört an die heißeste Stelle: alle seine Leitungen sind Vorlauf.
    check('… und liegt im Vorlauf',
      anBauteil(schema, luft?.id ?? '').every((l) => l.service === 'heating-flow'), true);

    // Der Schlammabscheider ist das letzte Bauteil vor dem Erzeuger.
    const schlamm = einer(schema, 'dirt-separator');
    const ausSchlamm = schema.links.find((l) => l.from === schlamm?.id && l.fromPort === 'out');
    const zielArt = map.get(ausSchlamm?.to ?? '')?.kind;
    /*
     * Seit 1.13.0 heißt das Innenteil eines Monoblocks `hydraulic-station`;
     * beim Splitgerät bleibt es `heatpump-indoor`. Beide sind „der Erzeuger"
     * im Sinne dieser Prüfung.
     *
     * Zwischen Abscheider und Erzeuger sitzt seit 1.13.0 die Absperrung, die
     * DIN EN 12828 für den Ausbau des Erzeugers verlangt. Sie ist zulässig:
     * eine Absperrung erzeugt keinen Schmutz, das Schutzziel des Abscheiders
     * bleibt gewahrt. Was NICHT dazwischen liegen darf, ist alles, was
     * abrieb- oder korrosionsbehaftet ist — Pumpe, Speicher, Zähler.
     */
    const erzeugerArten: SchematicKind[] = ['heatpump-indoor', 'heatpump-outdoor', 'hydraulic-station'];
    const naechstes = zielArt === 'shutoff'
      ? map.get(schema.links.find((l) => l.from === ausSchlamm?.to && l.fromPort === 'out')?.to ?? '')?.kind
      : zielArt;
    check('Der Schlammabscheider gibt direkt an den Erzeuger ab',
      erzeugerArten.includes(naechstes as SchematicKind), true);

    // Die Füllleitung hängt an der Anlagenleitung, nicht am Abschlämmventil.
    const fuellung = einer(schema, 'filling-valve');
    const ausFuellung = schema.links.filter((l) => l.from === fuellung?.id);
    check('Die Füllarmatur gibt über die Schlauchtülle ab', ausFuellung[0]?.fromPort ?? 'fehlt', 'hose');
    check('… und nicht an das Abschlämmventil des Abscheiders',
      ausFuellung.every((l) => map.get(l.to)?.kind !== 'dirt-separator'), true);
  }

  // =========================================================================
  // 7 · Sackgassen sind benannte Systemgrenzen
  // =========================================================================
  {
    /*
     * Wie viele Leitungen ein Bauteil braucht, sagt seine Bauart: ein
     * Ausdehnungsgefäß hat genau **einen** Stutzen, ein Manometer auch — sie
     * sind Abzweige und keine Durchgänge. Alles mit zwei oder mehr Stutzen
     * muss durchströmt werden, sonst ist es ein toter Ast.
     */
    const offen = schema.components.filter((c) => {
      if (c.kind === 'node') return false; // Systemgrenzen und Verteilpunkte
      if (c.kind === 'radiator' || c.kind === 'floor-loop') return false; // Übergabe
      const noetig = Math.min(2, portsOf(c.kind).length);
      return anBauteil(schema, c.id).length < noetig;
    });
    check('Kein Bauteil hängt einseitig im Nichts', offen.map((c) => c.label).join(', '), '');
  }

  // =========================================================================
  // 8 · Kältemittel ist kein Heizungswasser
  // =========================================================================
  {
    // Das Prüfhaus wählt einen Monoblock; für den Splitfall wird das Gerät
    // ausdrücklich vorgegeben.
    const splitPlan = designPlant(doc, { modelId: 'split-r32-8' });
    const splitSchema = buildSchematic(splitPlan);
    const kaelte = splitSchema.links.filter((l) => l.service === 'refrigerant');
    if (splitPlan.selected?.model.form === 'split') {
      check('Beim Splitgerät läuft Kältemittel zwischen den Einheiten', kaelte.length, 1);
      check('… und keine Heizungsleitung', splitSchema.links.some((l) =>
        l.service === 'heating-flow' &&
        byId(splitSchema).get(l.from)?.kind === 'heatpump-outdoor'), false);
    }
  }

  // =========================================================================
  // 9 · Ohne Warmwasser bleibt ein Heizungsschema
  // =========================================================================
  {
    const planOhne = designPlant(ohneWarmwasser(doc), {});
    const s2 = buildSchematic(planOhne);
    check('Ohne Warmwasser kein Trinkwasserspeicher', artOf(s2, 'cylinder').length, 0);
    check('… kein Umschaltventil', artOf(s2, 'valve-diverter').length, 0);
    check('… kein Verbrühschutz', artOf(s2, 'mixing-valve-dhw').length, 0);
    check('… und kein Warmwasserzuschlag auf die Leistung', planOhne.dhwSurcharge, 0);
    check('Der Heizungsteil steht weiterhin', artOf(s2, 'dirt-separator').length, 1);
  }

  // =========================================================================
  // 10 · Überströmventil nur ohne hydraulische Trennung
  // =========================================================================
  {
    /*
     * Seit 1.13.0 wählt die Auslegung für das Prüfhaus einen Parallelpuffer.
     * Damit ist die Anlage hydraulisch getrennt, und das Überströmventil
     * entfällt — genau das war schon immer die Regel, sie greift jetzt nur
     * auch beim Referenzhaus.
     *
     * Der Reihenpuffer wird deshalb eigens erzeugt: ein Haus mit **einem**
     * ungemischten Kreis. Dort bleibt das Überströmventil nötig, weil nichts
     * die Kreise entkoppelt.
     */
    check('Mit Parallelpuffer entfällt das Überströmventil im Prüfhaus',
      artOf(schema, 'overflow-valve').length, 0);

    const planReihe = designPlant(wpMitEinemHeizkoerper(doc), {});
    const sReihe = buildSchematic(planReihe);
    check('Ein ungemischter Kreis bekommt den Reihenpuffer',
      planReihe.buffer.selected?.kind ?? 'fehlt', 'buffer-series');
    check('Mit Reihenpuffer bleibt das Überströmventil nötig',
      artOf(sReihe, 'overflow-valve').length, 1);
    const pufferReihe = einer(sReihe, 'buffer');
    check('Der Reihenpuffer sitzt im Rücklauf',
      sReihe.links.filter((l) => l.to === pufferReihe?.id).every((l) => l.service === 'heating-return'), true);

    const planTrenn = designPlant(mitTrennpuffer(doc), {});
    const s3 = buildSchematic(planTrenn);
    check('Der Trennpuffer wird übernommen', planTrenn.buffer.selected?.kind ?? 'fehlt', 'buffer-parallel');
    check('Mit Trennpuffer entfällt das Überströmventil', artOf(s3, 'overflow-valve').length, 0);
    // Hinter der Trennung braucht jeder Kreis eine eigene Pumpe.
    check('Hinter der Trennung hat jeder Kreis eine Pumpe',
      artOf(s3, 'pump').filter((c) => c.label === 'Kreispumpe').length, planTrenn.circuits.length);
    // Und der Trennpuffer hat alle vier Anschlüsse.
    const puffer3 = einer(s3, 'buffer');
    const stutzen = new Set(
      s3.links
        .filter((l) => l.from === puffer3?.id || l.to === puffer3?.id)
        .map((l) => (l.from === puffer3?.id ? l.fromPort : l.toPort)),
    );
    check('Der Trennpuffer ist vierfach angeschlossen', stutzen.size, 4);
  }

  // =========================================================================
  // 11 · Die Pumpe fördert die Summe, nicht den größten Kreis
  // =========================================================================
  {
    const summe = plan.circuits.reduce((s, c) => s + c.flow, 0);
    const groesster = Math.max(...plan.circuits.map((c) => c.flow));
    check('Das Prüfhaus hat mehrere Kreise', plan.circuits.length > 1, true);
    check('Der Förderstrom ist die Summe der Kreise', plan.pump?.flow ?? 0, summe, 0.001);
    check('… und damit größer als der größte Einzelkreis', (plan.pump?.flow ?? 0) > groesster, true);
  }

  // =========================================================================
  // 12 · Kein Bauteil liegt auf einem anderen
  // =========================================================================
  {
    const plaetze = new Set(schema.components.map((c) => `${c.x}|${c.y}`));
    check('Jeder Rasterplatz ist einmal belegt', plaetze.size, schema.components.length);
  }

  // =========================================================================
  // 13 · Massive Flächen sind keine Räume
  // =========================================================================
  {
    // Der Fall aus dem Aufmaß: der Kaminzug wird von der Raumerkennung als
    // Raum geführt. Sobald er als massives Bauteil erklärt ist, muss er aus
    // Heizlast, Volumen und Export verschwinden.
    const raum = Object.values(doc.rooms)[0];
    const massiv: Room = { ...raum, solidArea: raum.area * 0.95 };
    const knapp: Room = { ...raum, solidArea: raum.area * 0.5 };
    check('Zu 95 % Mauerwerk ist kein Raum mehr', isMassiveArea(massiv), true);
    check('Zur Hälfte belegt bleibt ein Raum', isMassiveArea(knapp), false);
    check('Ohne massives Bauteil bleibt es ein Raum', isMassiveArea({ ...raum, solidArea: undefined }), false);
    // Die Schwelle steht an einer Stelle und wird nicht dreimal getippt.
    check('Die Schwelle liegt bei vier Fünfteln', MASSIVE_SHARE, 0.8);
  }

  // =========================================================================
  // 14 · Geschosse stehen aufeinander
  // =========================================================================
  {
    // Bis 1.8.1 zeichnete die 3D-Ansicht jedes Geschoss auf Höhe null: alle
    // Stockwerke standen ineinander.
    const hoehen = levelBaseHeights([
      { id: 'kg', name: 'KG', order: 0, elevation: -2.6, height: 2.3, floorUValue: 0.3, floorBoundary: 'ground', ceilingUValue: 0.3, ceilingBoundary: 'adjacent-room' },
      { id: 'eg', name: 'EG', order: 1, elevation: 0, height: 2.75, floorUValue: 0.3, floorBoundary: 'adjacent-room', ceilingUValue: 0.3, ceilingBoundary: 'adjacent-room' },
      { id: 'og', name: 'OG', order: 2, elevation: Number.NaN, height: 2.5, floorUValue: 0.3, floorBoundary: 'adjacent-room', ceilingUValue: 0.3, ceilingBoundary: 'unheated' },
    ]);
    check('Der Keller liegt unter null', hoehen.get('kg') ?? 0, -2.6, 0.001);
    check('Das Erdgeschoss liegt auf null', hoehen.get('eg') ?? -1, 0, 0.001);
    // Ohne eigene Höhenlage folgt das Obergeschoss auf 0 + 2,75 + 0,25 = 3,00 m.
    check('Ohne eigene Angabe wird aufgesetzt', hoehen.get('og') ?? 0, 3.0, 0.001);
    // Die Reihenfolge folgt der Ordnung, nicht der Reihenfolge im Objekt.
    const verdreht = levelBaseHeights([
      { id: 'og', name: 'OG', order: 2, elevation: Number.NaN, height: 2.5, floorUValue: 0.3, floorBoundary: 'adjacent-room', ceilingUValue: 0.3, ceilingBoundary: 'unheated' },
      { id: 'eg', name: 'EG', order: 1, elevation: Number.NaN, height: 2.75, floorUValue: 0.3, floorBoundary: 'ground', ceilingUValue: 0.3, ceilingBoundary: 'adjacent-room' },
    ]);
    check('Auch verdreht übergeben steht das EG unten', verdreht.get('eg') ?? -1, 0, 0.001);
    check('… und das OG darüber', verdreht.get('og') ?? 0, 3.0, 0.001);
  }

  // =========================================================================
  // 15 · Die Übergabe hat Armaturen
  // =========================================================================
  {
    /*
     * Der Einwand des Heizungsbauers: „Heizkörper bekommen auch Ventile."
     * Im Grundriss setzt der Rohrausleger sie längst (`pipeLayout`), im Schema
     * hing der Heizkörper nackt an der Leitung. Beide Darstellungen zeigen
     * dieselbe Anlage — also müssen sie dieselben Armaturen zeigen.
     */
    const heizkoerper = artOf(schema, 'radiator');
    check('Das Prüfhaus hat Heizkörper im Schema', heizkoerper.length > 0, true);

    const thermostate = artOf(schema, 'valve-2way').filter((c) => c.label === 'Thermostatventil');
    check('Je Heizkörper ein Thermostatventil', thermostate.length, heizkoerper.length);
    const verschraubungen = artOf(schema, 'balancing-valve').filter((c) => c.label === 'Rücklaufverschraubung');
    check('Je Heizkörper eine Rücklaufverschraubung', verschraubungen.length, heizkoerper.length);

    // § 63 GEG/GModG verlangt die Regelung im **Vorlauf** des Heizkörpers:
    // das Ventil muss vor der Heizfläche liegen, nicht dahinter.
    for (const hk of heizkoerper) {
      const zulauf = schema.links.find((l) => l.to === hk.id && l.toPort === 'flow');
      const davor = map.get(zulauf?.from ?? '');
      check(`„${hk.label}“: der Vorlauf kommt aus dem Thermostatventil`, davor?.kind ?? 'fehlt', 'valve-2way');
      check(`„${hk.label}“: und tritt an dessen Austritt aus`, zulauf?.fromPort ?? 'fehlt', 'out');

      const ruecklauf = schema.links.find((l) => l.from === hk.id && l.fromPort === 'return');
      const dahinter = map.get(ruecklauf?.to ?? '');
      check(`„${hk.label}“: der Rücklauf geht in die Rücklaufverschraubung`, dahinter?.kind ?? 'fehlt', 'balancing-valve');
      check(`„${hk.label}“: und dort an den Eintritt`, ruecklauf?.toPort ?? 'fehlt', 'in');
    }

    // Der Flächenheizungsverteiler trägt seine Ventile selbst — Durchflussmesser
    // und Stellantriebe stecken im Verteiler. Was ihm fehlte, ist die
    // Absperrung; ein Thermostatventil davor wäre doppelt geregelt.
    const verteiler = artOf(schema, 'manifold');
    const absperrungen = artOf(schema, 'shutoff').filter((c) => c.label === 'Absperrung Verteiler');
    check('Je Verteiler eine Absperrung', absperrungen.length, verteiler.length);
    // Alle Verteiler heißen „Verteiler" — nummeriert, damit im Protokoll
    // erkennbar bleibt, welcher gemeint ist.
    verteiler.forEach((v, i) => {
      const zulauf = schema.links.find((l) => l.to === v.id && l.toPort === 'flow');
      check(`Verteiler ${i + 1}: der Vorlauf kommt aus der Absperrung`, map.get(zulauf?.from ?? '')?.kind ?? 'fehlt', 'shutoff');
    });
    check('Am Verteiler steht kein Thermostatventil',
      thermostate.some((t) => schema.links.some((l) => l.from === t.id && map.get(l.to)?.kind === 'manifold')), false);
  }

  // =========================================================================
  // 16 · Fall (a): eine Wärmepumpe, ein Heizkörper
  // =========================================================================
  {
    /*
     * Der kleinste Fall, den der Heizungsbauer nennt. Was hier steht, muss
     * jeder Zeile der Auslegung entsprechen — und was nicht ausgelegt ist,
     * darf nicht auf dem Blatt stehen. Der Reihenpuffer gehört dazu: acht
     * Liter Wasserinhalt je Kilowatt Heizkörperleistung tragen den geforderten
     * Mindestinhalt einer Luft/Wasser-Wärmepumpe nicht, die Auslegung fordert
     * ihn also. Er liegt im Rücklauf und steht dem Vorlauf nicht im Weg.
     */
    const planA = designPlant(wpMitEinemHeizkoerper(doc), {});
    const a = buildSchematic(planA);
    pruefeGrundregeln(check, 'Fall (a)', a);

    check('Fall (a): genau ein Heizkreis', planA.circuits.length, 1);
    check('Fall (a): und er ist ungemischt', planA.circuits[0]?.circuit.mixed ?? true, false);

    /*
     * Die vollständige Artenliste. Sie steht ausgeschrieben da, weil „mehr als
     * acht Bauteile" genau die Prüfung war, die den Vollausbau durchgelassen
     * hat. Jede Art ist begründbar: Erzeuger außen und innen, der Heizstab aus
     * der Geräteauswahl, Mikroblasen- und Schlammabscheider sowie Füllarmatur,
     * Systemtrenner, Wärmemengenzähler und Überströmventil aus der
     * Sicherheitsauslegung, die Sicherheitsgruppe aus derselben, der Puffer aus
     * der Pufferrechnung, die Umwälzpumpe aus der Pumpenauslegung, Heizkörper
     * mit Thermostatventil und Rücklaufverschraubung aus der Übergabe, Knoten
     * als Systemgrenzen.
     */
    const artenA = [...new Set(a.components.map((c) => c.kind))].sort().join(', ');
    check(
      'Fall (a): genau diese Bauteilarten',
      artenA,
      [
        'air-separator', 'backflow-preventer', 'balancing-valve', 'buffer', 'dirt-separator',
        'electric-heater', 'expansion-vessel', 'filling-valve', 'heat-meter',
        'heatpump-outdoor', 'hydraulic-station', 'node', 'overflow-valve', 'pressure-gauge',
        'pump', 'radiator', 'safety-valve', 'shutoff', 'valve-2way',
      ].join(', '),
    );

    // Kein Verteilbalken: bei einem Kreis teilt sich nichts.
    check('Fall (a): kein Vorlaufbalken', a.components.some((c) => c.label === 'Vorlaufbalken'), false);
    check('Fall (a): kein Rücklaufbalken', a.components.some((c) => c.label === 'Rücklaufbalken'), false);
    // Der Vorlauf läuft vom Erzeugerknoten unmittelbar zur Übergabe.
    const abVl = a.links.find((l) => map2(a).get(l.from)?.label === 'Vorlauf' && l.fromPort === 'east');
    check('Fall (a): der Vorlauf geht direkt an das Thermostatventil',
      map2(a).get(abVl?.to ?? '')?.kind ?? 'fehlt', 'valve-2way');
    // Und der Rücklauf unmittelbar in den Puffer, der im Rücklauf liegt.
    const rlv = a.components.find((c) => c.label === 'Rücklaufverschraubung');
    const abRl = a.links.find((l) => l.from === rlv?.id && l.fromPort === 'out');
    check('Fall (a): der Rücklauf geht direkt in den Reihenpuffer',
      map2(a).get(abRl?.to ?? '')?.kind ?? 'fehlt', 'buffer');

    // Sicherheitsrelevantes bleibt in jedem Fall stehen.
    check('Fall (a): das Sicherheitsventil steht', artOf(a, 'safety-valve').length, 1);
    check('Fall (a): das Ausdehnungsgefäß steht', artOf(a, 'expansion-vessel').length, 1);
    check('Fall (a): das Manometer steht', artOf(a, 'pressure-gauge').length, 1);
  }

  // =========================================================================
  // 17 · Fall (b): Wärmepumpe, Trennpuffer, Heizkörper
  // =========================================================================
  {
    /*
     * Derselbe eine Heizkörper, aber mit hydraulischer Trennung. Drei Dinge
     * müssen sich gegenüber (a) ändern und sonst nichts: der Puffer trennt und
     * bekommt alle vier Anschlüsse, der Kreis bekommt hinter der Trennung
     * seine eigene Pumpe, und das Überströmventil entfällt — der Erzeugerkreis
     * behält seinen Volumenstrom unabhängig von den Stellantrieben.
     */
    const planB = designPlant(wpMitEinemHeizkoerper(doc, { [TRENNPUFFER.id]: TRENNPUFFER }), {});
    const b = buildSchematic(planB);
    pruefeGrundregeln(check, 'Fall (b)', b);

    check('Fall (b): der Trennpuffer wird übernommen', planB.buffer.selected?.kind ?? 'fehlt', 'buffer-parallel');
    check('Fall (b): weiterhin genau ein Heizkreis', planB.circuits.length, 1);

    const artenB = [...new Set(b.components.map((c) => c.kind))].sort().join(', ');
    check(
      'Fall (b): genau diese Bauteilarten',
      artenB,
      [
        'air-separator', 'backflow-preventer', 'balancing-valve', 'buffer', 'check-valve',
        'dirt-separator', 'electric-heater', 'expansion-vessel', 'filling-valve', 'heat-meter',
        'heatpump-outdoor', 'hydraulic-station', 'node', 'pressure-gauge', 'pump', 'radiator',
        'safety-valve', 'shutoff', 'valve-2way',
      ].join(', '),
    );
    check('Fall (b): kein Überströmventil hinter der Trennung', artOf(b, 'overflow-valve').length, 0);
    check('Fall (b): auch hier kein Verteilbalken', b.components.some((c) => c.label === 'Vorlaufbalken'), false);
    check('Fall (b): der Kreis hat seine eigene Pumpe',
      artOf(b, 'pump').filter((c) => c.label === 'Kreispumpe').length, 1);

    // Alle vier Anschlüsse — sonst wäre es keine Trennung, sondern ein Behälter.
    const pufferB = einer(b, 'buffer');
    const stutzenB = new Set(
      b.links
        .filter((l) => l.from === pufferB?.id || l.to === pufferB?.id)
        .map((l) => (l.from === pufferB?.id ? l.fromPort : l.toPort)),
    );
    check('Fall (b): der Trennpuffer ist vierfach angeschlossen', stutzenB.size, 4);
  }

  // =========================================================================
  // 18 · Fall (c): die volle Anlage
  // =========================================================================
  {
    /*
     * Warmwasser, vier Kreise, Trennpuffer — hier muss alles stehen, was die
     * Auslegung hergibt. Der Gegenbeweis zu (a) und (b): das Schema wird nicht
     * grundsätzlich kleiner, es folgt der Anlage.
     */
    const planC = designPlant(mitTrennpuffer(doc), {});
    const c = buildSchematic(planC);
    pruefeGrundregeln(check, 'Fall (c)', c);

    check('Fall (c): mehrere Heizkreise', planC.circuits.length > 1, true);
    const artenC = [...new Set(c.components.map((x) => x.kind))].sort().join(', ');
    check(
      'Fall (c): genau diese Bauteilarten',
      artenC,
      [
        'air-separator', 'backflow-preventer', 'balancing-valve', 'buffer', 'check-valve',
        'cylinder', 'dirt-separator', 'electric-heater', 'expansion-vessel', 'filling-valve',
        'floor-loop', 'heat-meter', 'heatpump-outdoor', 'hydraulic-station', 'manifold',
        'mixing-valve-dhw', 'node', 'pressure-gauge', 'pump', 'radiator', 'safety-valve',
        'shutoff', 'valve-2way', 'valve-3way', 'valve-diverter',
      ].join(', '),
    );
    // Bei mehreren Kreisen bleiben die Balken — dort teilt sich der Strom.
    check('Fall (c): der Vorlaufbalken steht', c.components.some((x) => x.label === 'Vorlaufbalken'), true);
    check('Fall (c): der Rücklaufbalken steht', c.components.some((x) => x.label === 'Rücklaufbalken'), true);
    // Und die volle Anlage ist deutlich mehr als der kleinste Fall.
    const planA2 = designPlant(wpMitEinemHeizkoerper(doc), {});
    check('Fall (c): mehr Bauteile als bei einem Heizkörper',
      c.components.length > buildSchematic(planA2).components.length, true);
  }

  // =========================================================================
  // 19 · Ohne Puffer geht der Vorlauf direkt weiter
  // =========================================================================
  {
    /*
     * Der dritte Pufferzweig. Nur mit Flächenheizung deckt der Wasserinhalt
     * der Estrichkreise den Mindestinhalt der Wärmepumpe — die Auslegung
     * fordert dann keinen Puffer, und der Vorlauf muss vom Erzeugerknoten
     * unmittelbar zur Übergabe laufen.
     */
    const planD = designPlant(einFlaechenkreis(doc), {});
    const d = buildSchematic(planD);
    pruefeGrundregeln(check, 'Ohne Puffer', d);
    check('Ohne Puffer: die Auslegung fordert keinen', planD.buffer.required, 0);
    check('… und das Schema zeigt keinen', artOf(d, 'buffer').length, 0);
    check('… bei einem Kreis auch keinen Balken', d.components.some((x) => x.label === 'Vorlaufbalken'), false);

    const vorlaufKnoten = d.components.find((x) => x.label === 'Vorlauf');
    const ab = d.links.find((l) => l.from === vorlaufKnoten?.id && l.fromPort === 'east');
    check('… der Vorlauf geht direkt an die Absperrung des Verteilers',
      map2(d).get(ab?.to ?? '')?.kind ?? 'fehlt', 'shutoff');

    /*
     * Zwei ungemischte Flächenkreise an derselben Pumpe: erst hier verteilt
     * sich eine Förderhöhe auf mehrere Wege, und erst hier gehört ein
     * Strangregulierventil an den Verteiler. Bei einem Kreis oder bei eigener
     * Kreispumpe wäre es ein Bauteil, das nur Förderhöhe vernichtet.
     */
    const planE = designPlant(nurFlaechenheizung(doc), {});
    const e = buildSchematic(planE);
    pruefeGrundregeln(check, 'Zwei Flächenkreise', e);
    check('Zwei Flächenkreise ohne eigene Pumpe', planE.circuits.length, 2);
    check('… keiner davon gemischt', planE.circuits.every((x) => !x.circuit.mixed), true);
    check('… je Verteiler ein Regulierventil',
      artOf(e, 'balancing-valve').filter((x) => x.label === 'Regulierventil').length, 2);
    check('Bei einem einzigen Kreis gibt es nichts abzugleichen',
      artOf(d, 'balancing-valve').filter((x) => x.label === 'Regulierventil').length, 0);
  }
}
