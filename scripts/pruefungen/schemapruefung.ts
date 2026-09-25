/**
 * Prüfblock „Schemaprüfung" — greift jede Regel, und greift sie **nur dann**?
 *
 * **Warum dieser Block gebraucht wird.** `schemaPruefung.ts` bewertet ein
 * fertiges Fließbild gegen benannte Regeln der Fachliteratur und liefert
 * Befunde mit Beleg. Ein solcher Prüfer kann auf zwei Arten falsch sein, und
 * die zweite ist die gefährlichere:
 *
 *  • **Er schweigt, wo er reden müsste.** Der Fehler steht im Bild, die Regel
 *    schlägt nicht an. Das fällt nur auf, wenn jemand denselben Fehler von
 *    Hand sucht.
 *  • **Er redet, wo nichts ist.** Eine Regel, die *immer* meldet, ist keine
 *    Prüfung, sondern ein Textbaustein. Wer sie dreimal gelesen hat, liest sie
 *    beim vierten Mal nicht mehr — und übersieht daneben den echten Befund.
 *    Genau deshalb steht zu **jeder** Regel hier ein Fall, der sie auslöst,
 *    *und* einer, der sie nicht auslöst. Der zweite ist der wichtigere.
 *
 * **Wie geprüft wird.** Ausgangspunkt ist ein bewusst *sauberes* Fließbild:
 * eine Wärmepumpe mit einem ungemischten Flächenheizkreis, vollständiger
 * Sicherheitsgruppe (Sicherheitsventil im Heizkreis, Manometer, KFE-Hahn),
 * Ausdehnungsgefäß, Schlammabscheider im Rücklauf, Mikroblasenabscheider,
 * Wärmemengenzähler, Absperrung am Erzeuger und Temperaturwächter vor der
 * Flächenheizung. Dieses Bild muss **null** Befunde ergeben — jede Regel, die
 * daran anschlägt, meldet ohne Anlass. Von diesem Nullpunkt aus wird je Regel
 * genau ein Merkmal verändert, und nur der eine erwartete Befund darf
 * erscheinen.
 *
 * Die Sollwerte sind nicht aus einem Probelauf abgeschrieben, sondern aus den
 * Regelbedingungen hergeleitet: welche Bauteilart, welcher Stutzen, welche
 * Leitungsart, welche Zahl — und daraus, welcher Befund folgen *muss*.
 *
 * **Die Reihenfolge ist Teil des Vertrags.** Die Befunde kommen sortiert:
 * erst `fehler`, dann `warnung`, dann `hinweis`, innerhalb der Grade
 * aufsteigend nach `id`, verglichen als ASCII und nicht über
 * `localeCompare` — sonst hinge die Reihenfolge an der Spracheinstellung der
 * Laufzeit, und ein Vergleich zweier Anlagenstände wäre wertlos. Geprüft wird
 * das an einem Fall, der alle drei Grade und je Grad mehrere Kennungen
 * auslöst.
 *
 * **Zuletzt die echte Anlage.** Ein Prüfer, der nur auf zurechtgelegten
 * Fällen läuft, kann an einem vollständigen Schema trotzdem in Serie melden.
 * Deshalb läuft er am Ende über `designPlant` + `buildSchematic` des
 * Referenzhauses — und dort muss er im Wesentlichen schweigen.
 */

import type { CheckFn } from './typ';
import type {
  HeatingCircuit,
  PipeService,
  PlantDefinition,
  PlantStorage,
  SchematicComponent,
  SchematicKind,
  SchematicLink,
} from '../../src/types/bim';
import type { CircuitDesign, PlantDesignResult } from '../../src/lib/plantDesign';
import type { ModelMatch } from '../../src/lib/deviceCatalog';
import { buildSchematic, designPlant } from '../../src/lib/plantDesign';
import { pruefeSchema, type SchemaBefund } from '../../src/lib/schemaPruefung';
import { zugeordneteVorlage } from '../../src/lib/schemaZuordnung';
import { emptyPlant } from '../../src/lib/plantDefaults';
import { sizePipe } from '../../src/lib/hydraulics';
import { HEAT_PUMP_CATALOG } from '../../src/lib/deviceCatalog';
import { buildReferenceDocument } from '../reference';
import { erzeugerBilanz } from '../../src/lib/erzeugerHydraulik';

// ---------------------------------------------------------------------------
// Bausteine des Fließbilds
// ---------------------------------------------------------------------------

interface Fliessbild {
  komponenten: SchematicComponent[];
  verbindungen: SchematicLink[];
}

function bauteil(id: string, kind: SchematicKind, label: string, spec?: string): SchematicComponent {
  // `x`/`y` sind Rasterplätze im Strangschema und für die Prüfung ohne
  // Bedeutung — sie bleiben null, damit niemand aus ihnen eine Aussage liest.
  return { id, kind, label, x: 0, y: 0, spec, generated: true };
}

function leitung(
  id: string,
  from: string,
  fromPort: string,
  to: string,
  toPort: string,
  service: PipeService,
): SchematicLink {
  return { id, from, to, fromPort, toPort, service, generated: true };
}

/**
 * Das saubere Fließbild — der Nullpunkt dieses Blocks.
 *
 * Es enthält genau das, was die Regeln A bis F verlangen, und nichts, was sie
 * verbieten: kein Überströmventil (Regeln 1–3), keinen zweiten Wärmeerzeuger
 * (Regel 5), keinen Reihenpuffer am Vorlauf (Regel 6), keinen Mischer
 * (Regel 7), einen Temperaturwächter vor der ungemischten Flächenheizung
 * (Regel 8), nur einen Heizkreis (Regel 9), keinen Trinkwasserstutzen an einer
 * Heizungsleitung (Regel 10), die vollständige Sicherheitsgruppe (Regel 11),
 * ein Ausdehnungsgefäß (Regel 12), einen Schlammabscheider im **Rücklauf**
 * (Regeln 13/14), eine Absperrung am Erzeuger (Regel 15), einen
 * Mikroblasenabscheider (Regel 16) und einen Wärmemengenzähler (Regel 17).
 */
function sauber(): Fliessbild {
  const komponenten = [
    bauteil('wp', 'heatpump-outdoor', 'Wärmepumpe Monoblock'),
    bauteil('sv', 'safety-valve', 'Sicherheitsventil', '3 bar'),
    bauteil('mano', 'pressure-gauge', 'Manometer mit Druckprüfstutzen'),
    bauteil('kfe', 'filling-valve', 'Füll- und Entleerungsarmatur'),
    bauteil('mag', 'expansion-vessel', 'Membran-Druckausdehnungsgefäß', '25 l'),
    bauteil('schlamm', 'dirt-separator', 'Schlammabscheider mit Magnetstab'),
    bauteil('luft', 'air-separator', 'Mikroblasenabscheider'),
    bauteil('wmz', 'heat-meter', 'Wärmemengenzähler'),
    bauteil('absperr', 'shutoff', 'Absperrung Erzeuger Vorlauf'),
    bauteil('waechter', 'sensor', 'Temperaturwächter Fußbodenheizung'),
    bauteil('fbh', 'floor-loop', 'Fußbodenheizung EG'),
  ];
  const verbindungen = [
    leitung('l-wp-luft', 'wp', 'flow', 'luft', 'in', 'heating-flow'),
    leitung('l-luft-fbh', 'luft', 'out', 'fbh', 'flow', 'heating-flow'),
    leitung('l-fbh-schlamm', 'fbh', 'return', 'schlamm', 'in', 'heating-return'),
    leitung('l-schlamm-wp', 'schlamm', 'out', 'wp', 'return', 'heating-return'),
    leitung('l-wp-sv', 'wp', 'flow', 'sv', 'in', 'heating-flow'),
    leitung('l-wp-absperr', 'wp', 'flow', 'absperr', 'in', 'heating-flow'),
  ];
  return { komponenten, verbindungen };
}

/** Dasselbe Bild ohne die Bauteile dieser Arten — samt ihrer Leitungen. */
function ohne(bild: Fliessbild, ...arten: readonly SchematicKind[]): Fliessbild {
  const raus = new Set(bild.komponenten.filter((c) => arten.indexOf(c.kind) >= 0).map((c) => c.id));
  return {
    komponenten: bild.komponenten.filter((c) => !raus.has(c.id)),
    verbindungen: bild.verbindungen.filter((l) => !raus.has(l.from) && !raus.has(l.to)),
  };
}

/** Dasselbe Bild mit zusätzlichen Bauteilen und Leitungen. */
function mit(
  bild: Fliessbild,
  komponenten: readonly SchematicComponent[],
  verbindungen: readonly SchematicLink[] = [],
): Fliessbild {
  return {
    komponenten: [...bild.komponenten, ...komponenten],
    verbindungen: [...bild.verbindungen, ...verbindungen],
  };
}

// ---------------------------------------------------------------------------
// Bausteine der Auslegung
// ---------------------------------------------------------------------------

/** Ein Heizkreis samt Auslegung — die Zahlen daneben spielen keine Rolle. */
function kreis(
  id: string,
  label: string,
  art: HeatingCircuit['kind'],
  vorlauf: number,
  gemischt: boolean,
): CircuitDesign {
  const circuit: HeatingCircuit = {
    id,
    label,
    kind: art,
    roomIds: [],
    flowTemperature: vorlauf,
    returnTemperature: vorlauf - 7,
    material: 'verbund',
    mixed: gemischt,
  };
  return { circuit, load: 3, loadSource: 'norm', flow: 0.3, pipe: sizePipe(0.3), notes: [] };
}

/** Ein Speicher, wie ihn die Auslegung als Puffer ausweist. */
function speicher(id: string, label: string, kind: PlantStorage['kind'], volumen: number): PlantStorage {
  return { id, label, kind, volume: volumen, suggested: true };
}

/**
 * Ein Gerätetreffer.
 *
 * Er wird aus dem Katalog geholt und nur in den beiden Feldern verändert, auf
 * die die Regeln überhaupt zugreifen: `manufacturer` (Regel 18) und
 * `minSystemVolume` (Regel 4). Ein von Hand zusammengeschriebenes Gerät wäre
 * dieselbe Aussage mit dreißig erfundenen Zahlen daneben.
 */
function geraet(hersteller: string, mindestVolumen: number, leistung: number): ModelMatch {
  const modell = HEAT_PUMP_CATALOG[0];
  return {
    model: { ...modell, manufacturer: hersteller, minSystemVolume: mindestVolumen },
    capacityAtDesign: leistung,
    coverage: 1,
    score: 1,
    verdict: 'passt',
    reason: 'Prüffall',
  };
}

/**
 * Die Auslegung zum sauberen Bild.
 *
 * Ein Heizkreis (Regel 9 verlangt erst ab zwei einen Verteilbalken),
 * Flächenheizung ungemischt (Regel 7 setzt einen Mischer voraus, Regel 8 den
 * fehlenden Wächter), 200 l Anlagenvolumen bei 8 kW — die Faustregel
 * 3 l/kW fordert 24 l, das Datenblatt bleibt ohne Gerät bei 0 l, gefordert
 * sind also 24 l und vorhanden 200 l (Regel 4 schweigt).
 */
function baueAuslegung(anpassung: Partial<PlantDesignResult> = {}): PlantDesignResult {
  return {
    heatLoadSource: 'norm',
    heatLoadProvenance: 'raumweise',
    heatLoad: 6,
    normCoverage: {
      heatedRooms: 4,
      withNorm: 4,
      outdated: 0,
      total: 6,
      complete: true,
      missing: [],
      outdatedRooms: [],
    },
    dhwSurcharge: 0.2,
    blocking: 1.1,
    requiredCapacity: 8,
    matches: [],
    circuits: [kreis('hk-1', 'Fußbodenheizung EG', 'floor', 35, false)],
    // Seit 1.23.0 trägt jede Auslegung ihre maßgebliche Systemtemperatur
    // samt Absender: Der Rohrnetzbericht liest sie hier ab, statt sie aus
    // dem Anlagenblatt noch einmal zu rechnen.
    systemtemperatur: {
      vorlauf: 35,
      ruecklauf: 28,
      spreizung: 7,
      herkunft: 'anlagenblatt',
      begruendung: '35/28 °C stehen so im Anlagenblatt; kein Heizkreis verlangt mehr. Spreizung 7 K.',
    },
    anschlussDn: 20,
    totalFlow: 0.6,
    volume: { total: 200, parts: [{ label: 'Anlage', volume: 200 }] },
    buffer: { required: 0, reason: 'Anlagenvolumen ohne Puffer ausreichend' },
    generator: erzeugerBilanz({ flow: 0, dn: 25, umschaltung: false, waermezaehler: false, abscheiderVorhanden: false }),
    notes: [],
    ...anpassung,
  };
}

/** Das Anlagenblatt mit geänderter Auslegungsvorgabe. */
function anlagenblatt(anpassung: Partial<PlantDefinition['design']> = {}): PlantDefinition {
  const p = emptyPlant();
  return { ...p, design: { ...p.design, ...anpassung } };
}

// ---------------------------------------------------------------------------
// Auswertung
// ---------------------------------------------------------------------------

function pruefe(bild: Fliessbild, auslegung: PlantDesignResult, anlage?: PlantDefinition): SchemaBefund[] {
  return pruefeSchema({
    komponenten: bild.komponenten,
    verbindungen: bild.verbindungen,
    auslegung,
    anlage,
  });
}

const hat = (befunde: readonly SchemaBefund[], id: string): boolean => befunde.some((b) => b.id === id);
const gradVon = (befunde: readonly SchemaBefund[], id: string): string =>
  befunde.find((b) => b.id === id)?.grad ?? 'fehlt';
const zahl = (befunde: readonly SchemaBefund[], grad: SchemaBefund['grad']): number =>
  befunde.filter((b) => b.grad === grad).length;

// ---------------------------------------------------------------------------
// Der Prüfblock
// ---------------------------------------------------------------------------

export function pruefeSchemapruefung(check: CheckFn): void {
  console.log('\nSchemaprüfung — greift jede Regel, und greift sie nur dann?');

  const basisBild = sauber();
  const basisAuslegung = baueAuslegung();
  const basisAnlage = anlagenblatt();

  // =========================================================================
  // 0 — Der Nullpunkt
  // =========================================================================

  /*
   * Das saubere Bild darf keinen einzigen Befund ergeben. Träfe hier auch nur
   * eine Regel zu, wären alle folgenden Prüfungen wertlos: jede
   * „löst nicht aus"-Aussage stünde dann auf einem Bild, das schon meldet.
   */
  const null0 = pruefe(basisBild, basisAuslegung, basisAnlage);
  check('sauberes Schema: Zahl der Befunde', null0.length, 0);
  check('sauberes Schema: keine Fehler', zahl(null0, 'fehler'), 0);
  check('sauberes Schema: keine Warnungen', zahl(null0, 'warnung'), 0);
  check('sauberes Schema: keine Hinweise', zahl(null0, 'hinweis'), 0);

  // =========================================================================
  // A — Überströmventil (Regeln 1 bis 3)
  // =========================================================================

  const ueberstroemer = [bauteil('uev', 'overflow-valve', 'Überströmventil')];
  const reihenpuffer = speicher('sp-reihe', 'Reihenpuffer 200 l', 'buffer-series', 200);
  const trennpuffer = speicher('sp-trenn', 'Parallelpuffer 300 l', 'buffer-parallel', 300);

  /*
   * Regel 1 — Überströmventil ohne Speicher (fehler).
   * Auslösend: Ventil im Bild, kein Behälter in Auslegung oder Anlage.
   * Nicht auslösend: derselbe Fall mit Reihenpuffer — dann ist das
   * Anlagenvolumen nachgewiesen, und das Ventil sichert wie vorgesehen nur
   * noch den Mindestvolumenstrom.
   */
  const r1ja = pruefe(mit(basisBild, ueberstroemer), basisAuslegung, basisAnlage);
  check('R1 Überströmventil ohne Speicher: löst aus', hat(r1ja, 'ueberstroemventil-ohne-speicher'), true);
  check('R1 Grad', gradVon(r1ja, 'ueberstroemventil-ohne-speicher'), 'fehler');
  const mitReihe = baueAuslegung({ buffer: { required: 200, selected: reihenpuffer, reason: 'Abtauvolumen' } });
  const r1nein = pruefe(mit(basisBild, ueberstroemer), mitReihe, basisAnlage);
  check('R1 mit Reihenpuffer: löst nicht aus', hat(r1nein, 'ueberstroemventil-ohne-speicher'), false);

  /*
   * Regel 2 — Überströmventil neben hydraulischer Trennung (warnung).
   * Auslösend: Parallelpuffer (trennt) **und** Ventil.
   * Nicht auslösend: Reihenpuffer (trennt nicht) und Ventil — genau die
   * Paarung, die Wolf ausdrücklich verlangt.
   */
  const mitTrennung = baueAuslegung({ buffer: { required: 300, selected: trennpuffer, reason: 'Trennpuffer' } });
  const r2ja = pruefe(mit(basisBild, ueberstroemer), mitTrennung, basisAnlage);
  check('R2 Ventil neben Trennpuffer: löst aus', hat(r2ja, 'ueberstroemventil-mit-trennspeicher'), true);
  check('R2 Grad', gradVon(r2ja, 'ueberstroemventil-mit-trennspeicher'), 'warnung');
  check('R2 Ventil mit Reihenpuffer: löst nicht aus', hat(r1nein, 'ueberstroemventil-mit-trennspeicher'), false);

  /*
   * Regel 3 — Pumpenkennlinie zum Überströmventil (hinweis). Sie hängt an
   * nichts als am Vorhandensein des Ventils: die Kennlinie steht nicht im
   * Modell, also bleibt nur die Aufforderung, sie an der Pumpe zu prüfen.
   * Nicht auslösend ist folglich jedes Bild ohne Überströmventil.
   */
  check('R3 Pumpenkennlinie: löst mit Ventil aus', hat(r1nein, 'ueberstroemventil-pumpenkennlinie'), true);
  check('R3 Grad', gradVon(r1nein, 'ueberstroemventil-pumpenkennlinie'), 'hinweis');
  check('R3 ohne Ventil: löst nicht aus', hat(null0, 'ueberstroemventil-pumpenkennlinie'), false);

  // =========================================================================
  // B — Speicher und Entkopplung (Regeln 4 bis 6)
  // =========================================================================

  /*
   * Regel 4 — Mindestanlagenvolumen.
   * Gefordert ist der größere Wert aus Datenblatt und Faustregel 3 l/kW.
   *
   * Auslösend ohne Gerät: 8 kW → 3 × 8 = 24 l gefordert, 15 l vorhanden.
   * Ohne Speicher im Bild ist der Grad `fehler`, mit Speicher `warnung` —
   * denn dann ist der Behälter da und nur zu klein.
   * Nicht auslösend: 200 l bei denselben 24 l Forderung (der Nullpunkt).
   */
  const r4ja = pruefe(basisBild, baueAuslegung({ volume: { total: 15, parts: [] } }), basisAnlage);
  check('R4 Volumen 15 l < 24 l: löst aus', hat(r4ja, 'mindestanlagenvolumen-unterschritten'), true);
  check('R4 ohne Speicher: Grad', gradVon(r4ja, 'mindestanlagenvolumen-unterschritten'), 'fehler');
  const r4warn = pruefe(
    basisBild,
    baueAuslegung({
      volume: { total: 15, parts: [] },
      buffer: { required: 24, selected: reihenpuffer, reason: 'zu klein gewählt' },
    }),
    basisAnlage,
  );
  check('R4 mit Speicher: Grad', gradVon(r4warn, 'mindestanlagenvolumen-unterschritten'), 'warnung');
  check('R4 Volumen 200 l: löst nicht aus', hat(null0, 'mindestanlagenvolumen-unterschritten'), false);
  /*
   * Und der Fall, in dem das Datenblatt die Faustregel schlägt: 7 kW ergeben
   * nach Faustregel 21 l, das Gerät fordert 100 l. Mit 60 l im System ist die
   * Forderung verletzt, obwohl die Faustregel erfüllt wäre.
   */
  const r4datenblatt = pruefe(
    basisBild,
    baueAuslegung({ selected: geraet('Daikin Europe', 100, 7), volume: { total: 60, parts: [] } }),
    basisAnlage,
  );
  check('R4 Datenblatt 100 l > Faustregel 21 l: löst aus', hat(r4datenblatt, 'mindestanlagenvolumen-unterschritten'), true);
  const r4datenblattOk = pruefe(
    basisBild,
    baueAuslegung({ selected: geraet('Daikin Europe', 100, 7), volume: { total: 120, parts: [] } }),
    basisAnlage,
  );
  check('R4 Datenblatt erfüllt (120 l): löst nicht aus', hat(r4datenblattOk, 'mindestanlagenvolumen-unterschritten'), false);

  /*
   * Regel 5 — hydraulische Trennung bei zweitem Erzeuger ohne eigene Pumpe.
   * Auslösend: Parallelpuffer plus Kessel, an dem keine Pumpe hängt.
   * Nicht auslösend: derselbe Kessel mit eigener Heizungspumpe daran — dann
   * wird er durchströmt, und seine Wärme erreicht den Speicher.
   */
  const kesselOhne = mit(basisBild, [bauteil('kessel', 'boiler', 'Gaskessel Bestand')]);
  const r5ja = pruefe(kesselOhne, mitTrennung, basisAnlage);
  check('R5 Kessel ohne Pumpe hinter Trennung: löst aus', hat(r5ja, 'trennung-bei-zweiterzeuger-ohne-pumpe'), true);
  check('R5 Grad', gradVon(r5ja, 'trennung-bei-zweiterzeuger-ohne-pumpe'), 'fehler');
  const kesselMit = mit(
    kesselOhne,
    [bauteil('kesselpumpe', 'pump', 'Kesselkreispumpe')],
    [leitung('l-kessel-pumpe', 'kessel', 'flow', 'kesselpumpe', 'in', 'heating-flow')],
  );
  const r5nein = pruefe(kesselMit, mitTrennung, basisAnlage);
  check('R5 Kessel mit eigener Pumpe: löst nicht aus', hat(r5nein, 'trennung-bei-zweiterzeuger-ohne-pumpe'), false);

  /*
   * Regel 6 — Reihenpuffer wie ein Trennspeicher beschaltet.
   * Der Reihenpuffer liegt in Reihe im **Rücklauf** und hat dort zwei
   * Anschlüsse. Auslösend ist deshalb jede Leitung an ihm, die entweder an
   * einem Trennspeicher-Vorlaufstutzen (`gen-flow`/`sys-flow`) endet oder
   * Heizungsvorlauf führt.
   * Nicht auslösend: derselbe Puffer ausschließlich im Rücklauf, an Stutzen
   * ohne Trennspeicherbedeutung.
   */
  const pufferBauteil = bauteil('puffer', 'buffer', 'Reihenpuffer 200 l');
  pufferBauteil.storageId = reihenpuffer.id;
  const falschEingebunden = mit(
    basisBild,
    [pufferBauteil],
    [leitung('l-puffer-falsch', 'wp', 'flow', 'puffer', 'gen-flow', 'heating-flow')],
  );
  const r6ja = pruefe(falschEingebunden, mitReihe, basisAnlage);
  check('R6 Reihenpuffer am Vorlaufstutzen: löst aus', hat(r6ja, 'reihenpuffer-falsch-eingebunden'), true);
  check('R6 Grad', gradVon(r6ja, 'reihenpuffer-falsch-eingebunden'), 'fehler');
  const richtigEingebunden = mit(
    basisBild,
    [pufferBauteil],
    [
      leitung('l-puffer-ein', 'fbh', 'return', 'puffer', 'in', 'heating-return'),
      leitung('l-puffer-aus', 'puffer', 'out', 'wp', 'return', 'heating-return'),
    ],
  );
  const r6nein = pruefe(richtigEingebunden, mitReihe, basisAnlage);
  check('R6 Reihenpuffer im Rücklauf: löst nicht aus', hat(r6nein, 'reihenpuffer-falsch-eingebunden'), false);

  // =========================================================================
  // C — Mischer, Regelung und Verteilung (Regeln 7 bis 9)
  // =========================================================================

  /*
   * Regel 7 — Mischer ohne erkennbare Notwendigkeit.
   * Auslösend: ein gemischter Kreis, der die höchste Vorlauftemperatur der
   * Anlage fährt (35 °C bei 35 °C Erzeugervorlauf) — es gibt nichts
   * herunterzumischen.
   * Nicht auslösend, erster Fall: derselbe gemischte Kreis mit 28 °C. Die
   * Schwelle ist `Erzeugervorlauf − 2 K`, also 33 °C; 28 °C liegt darunter,
   * der Mischer hat eine Aufgabe.
   * Nicht auslösend, zweiter Fall: Fremdwärme im Bild (Kessel oder Kollektor).
   * Dann kann Übertemperatur in den Puffer gelangen, und die Regel schaltet
   * sich ausdrücklich ab, statt zu raten.
   */
  const gemischtHeiss = baueAuslegung({ circuits: [kreis('hk-1', 'Fußbodenheizung EG', 'floor', 35, true)] });
  const r7ja = pruefe(basisBild, gemischtHeiss, basisAnlage);
  check('R7 Mischer auf Erzeugertemperatur: löst aus', hat(r7ja, 'mischer-ohne-notwendigkeit'), true);
  check('R7 Grad', gradVon(r7ja, 'mischer-ohne-notwendigkeit'), 'warnung');
  const gemischtKalt = baueAuslegung({ circuits: [kreis('hk-1', 'Fußbodenheizung EG', 'floor', 28, true)] });
  check(
    'R7 Mischer auf 28 °C bei 35 °C Erzeuger: löst nicht aus',
    hat(pruefe(basisBild, gemischtKalt, basisAnlage), 'mischer-ohne-notwendigkeit'),
    false,
  );
  const mitSolar = mit(basisBild, [bauteil('solar', 'solar', 'Solarkollektorfeld')]);
  check(
    'R7 mit Fremdwärme im Bild: löst nicht aus',
    hat(pruefe(mitSolar, gemischtHeiss, basisAnlage), 'mischer-ohne-notwendigkeit'),
    false,
  );

  /*
   * Regel 8 — ungemischte Flächenheizung ohne Temperaturwächter.
   * Auslösend: der Nullpunkt ohne den Wächter (Bauteilart `sensor`, dessen
   * Beschriftung auf Temperaturwächter, Maximalthermostat oder STB passt).
   * Nicht auslösend, erster Fall: der Nullpunkt selbst.
   * Nicht auslösend, zweiter Fall: derselbe Kreis gemischt — dann steht der
   * Mischer zwischen Erzeugertemperatur und Estrich.
   */
  const ohneWaechter = ohne(basisBild, 'sensor');
  const r8ja = pruefe(ohneWaechter, basisAuslegung, basisAnlage);
  check('R8 Flächenheizung ohne Wächter: löst aus', hat(r8ja, 'flaechenheizung-ohne-temperaturwaechter'), true);
  check('R8 Grad', gradVon(r8ja, 'flaechenheizung-ohne-temperaturwaechter'), 'fehler');
  check('R8 mit Wächter: löst nicht aus', hat(null0, 'flaechenheizung-ohne-temperaturwaechter'), false);
  check(
    'R8 gemischter Kreis ohne Wächter: löst nicht aus',
    hat(pruefe(ohneWaechter, gemischtHeiss, basisAnlage), 'flaechenheizung-ohne-temperaturwaechter'),
    false,
  );

  /*
   * Regel 9 — mehrere Heizkreise ohne Verteilbalken.
   * Auslösend: zwei Kreise, im Bild kein Knoten oder Verteiler, dessen
   * Beschriftung Balken, Sammler oder Verteiler nennt.
   * Nicht auslösend: dieselben zwei Kreise mit einem Verteilbalken im Bild.
   * Der Vergleich ist wichtig, weil ein einzelner Kreis nie einen Balken
   * braucht — die Regel darf an der Anlagengröße hängen und an nichts sonst.
   */
  const zweiKreise = baueAuslegung({
    circuits: [
      kreis('hk-1', 'Fußbodenheizung EG', 'floor', 35, false),
      kreis('hk-2', 'Fußbodenheizung OG', 'floor', 35, false),
    ],
  });
  const r9ja = pruefe(basisBild, zweiKreise, basisAnlage);
  check('R9 zwei Kreise ohne Balken: löst aus', hat(r9ja, 'verteilbalken-fehlt'), true);
  check('R9 Grad', gradVon(r9ja, 'verteilbalken-fehlt'), 'warnung');
  const mitBalken = mit(basisBild, [bauteil('balken', 'manifold', 'Verteilbalken Heizkreise')]);
  check('R9 zwei Kreise mit Balken: löst nicht aus', hat(pruefe(mitBalken, zweiKreise, basisAnlage), 'verteilbalken-fehlt'), false);
  check('R9 ein Kreis ohne Balken: löst nicht aus', hat(null0, 'verteilbalken-fehlt'), false);

  // =========================================================================
  // D — Trinkwasser (Regel 10)
  // =========================================================================

  /*
   * Regel 10 — Heiz- und Trinkwasserseite vermischt.
   * Der Speicher wird über seinen Wärmeübertrager geladen; Heizungswasser
   * und Trinkwasser berühren sich nicht.
   * Auslösend: eine Heizungsleitung am Kaltwasserstutzen `cold` des
   * Trinkwasserspeichers — genau der Fehler, den ein Fachplaner im erzeugten
   * Schema gefunden hat.
   * Nicht auslösend: derselbe Speicher richtig beschaltet — Ladeleitung an
   * `flow`/`return`, Trinkwasser an `cold`/`dhw`.
   */
  const speicherBauteil = bauteil('tws', 'cylinder', 'Trinkwasserspeicher 300 l');
  const falscherStutzen = mit(
    basisBild,
    [speicherBauteil],
    [leitung('l-tws-falsch', 'wp', 'flow', 'tws', 'cold', 'heating-flow')],
  );
  const r10ja = pruefe(falscherStutzen, basisAuslegung, basisAnlage);
  check('R10 Heizung am Kaltwasserstutzen: löst aus', hat(r10ja, 'heizungswasser-an-trinkwasserstutzen'), true);
  check('R10 Grad', gradVon(r10ja, 'heizungswasser-an-trinkwasserstutzen'), 'fehler');
  const richtigerStutzen = mit(
    basisBild,
    [speicherBauteil],
    [
      leitung('l-tws-lade', 'wp', 'flow', 'tws', 'flow', 'heating-flow'),
      leitung('l-tws-rueck', 'tws', 'return', 'wp', 'return', 'heating-return'),
      leitung('l-tws-kalt', 'tws', 'cold', 'kfe', 'in', 'cold-water'),
    ],
  );
  check(
    'R10 Speicher richtig beschaltet: löst nicht aus',
    hat(pruefe(richtigerStutzen, basisAuslegung, basisAnlage), 'heizungswasser-an-trinkwasserstutzen'),
    false,
  );
  /*
   * Die Gegenrichtung zählt genauso: eine Trinkwasserleitung am
   * Heizungsstutzen `flow` ist derselbe Übertritt über die Systemgrenze.
   */
  const trinkwasserAmHeizstutzen = mit(
    basisBild,
    [speicherBauteil],
    [leitung('l-tws-warm', 'tws', 'flow', 'kfe', 'in', 'hot-water')],
  );
  check(
    'R10 Trinkwasser am Heizungsstutzen: löst aus',
    hat(pruefe(trinkwasserAmHeizstutzen, basisAuslegung, basisAnlage), 'heizungswasser-an-trinkwasserstutzen'),
    true,
  );

  // =========================================================================
  // E — Pflichtarmaturen (Regeln 11 bis 17)
  // =========================================================================

  /*
   * Regel 11 — Sicherheitsgruppe unvollständig.
   * Sie fasst drei Bauteile zusammen; fehlt eines, meldet sie. Geprüft wird
   * jedes einzeln, damit nicht ein vorhandenes Bauteil das fehlende deckt.
   * Nicht auslösend ist nur der vollständige Satz.
   */
  check(
    'R11 ohne Sicherheitsventil: löst aus',
    hat(pruefe(ohne(basisBild, 'safety-valve'), basisAuslegung, basisAnlage), 'sicherheitsgruppe-unvollstaendig'),
    true,
  );
  check(
    'R11 ohne Manometer: löst aus',
    hat(pruefe(ohne(basisBild, 'pressure-gauge'), basisAuslegung, basisAnlage), 'sicherheitsgruppe-unvollstaendig'),
    true,
  );
  const r11kfe = pruefe(ohne(basisBild, 'filling-valve'), basisAuslegung, basisAnlage);
  check('R11 ohne KFE-Hahn: löst aus', hat(r11kfe, 'sicherheitsgruppe-unvollstaendig'), true);
  check('R11 Grad', gradVon(r11kfe, 'sicherheitsgruppe-unvollstaendig'), 'fehler');
  check('R11 vollständige Gruppe: löst nicht aus', hat(null0, 'sicherheitsgruppe-unvollstaendig'), false);
  /*
   * Und der Fall, für den die Regel eigens gebaut ist: das Sicherheitsventil
   * des Trinkwassererwärmers zählt nicht mit. Es wird daran erkannt, dass an
   * ihm keine Heizungsleitung hängt.
   */
  const nurTrinkwasserVentil = mit(
    ohne(basisBild, 'safety-valve'),
    [bauteil('sv-tw', 'safety-valve', 'Sicherheitsventil Trinkwasser', '10 bar')],
    [leitung('l-sv-tw', 'kfe', 'out', 'sv-tw', 'in', 'cold-water')],
  );
  check(
    'R11 nur Trinkwasser-Sicherheitsventil: löst aus',
    hat(pruefe(nurTrinkwasserVentil, basisAuslegung, basisAnlage), 'sicherheitsgruppe-unvollstaendig'),
    true,
  );

  /*
   * Regel 12 — Ausdehnungsgefäß fehlt. Ohne Gefäß bläst das Sicherheitsventil
   * beim Aufheizen ab; die Anlage verliert Wasser und zieht beim Abkühlen
   * Luft.
   */
  const r12ja = pruefe(ohne(basisBild, 'expansion-vessel'), basisAuslegung, basisAnlage);
  check('R12 ohne Ausdehnungsgefäß: löst aus', hat(r12ja, 'ausdehnungsgefaess-fehlt'), true);
  check('R12 Grad', gradVon(r12ja, 'ausdehnungsgefaess-fehlt'), 'fehler');
  check('R12 mit Ausdehnungsgefäß: löst nicht aus', hat(null0, 'ausdehnungsgefaess-fehlt'), false);

  /*
   * Regel 13 — Schmutzfänger/Magnetitabscheider fehlt. Zwei Bauteilarten
   * erfüllen sie, `dirt-separator` und `strainer`; geprüft wird beides, sonst
   * bliebe unbemerkt, dass die zweite Art vergessen wurde.
   */
  const ohneAbscheider = ohne(basisBild, 'dirt-separator');
  const r13ja = pruefe(ohneAbscheider, basisAuslegung, basisAnlage);
  check('R13 ohne Abscheider: löst aus', hat(r13ja, 'schlammabscheider-fehlt'), true);
  check('R13 Grad', gradVon(r13ja, 'schlammabscheider-fehlt'), 'fehler');
  check('R13 mit Schlammabscheider: löst nicht aus', hat(null0, 'schlammabscheider-fehlt'), false);
  const mitSieb = mit(
    ohneAbscheider,
    [bauteil('sieb', 'strainer', 'Schmutzfänger Rücklauf')],
    [leitung('l-sieb', 'sieb', 'out', 'wp', 'return', 'heating-return')],
  );
  check(
    'R13 Schmutzfänger statt Schlammabscheider: löst nicht aus',
    hat(pruefe(mitSieb, basisAuslegung, basisAnlage), 'schlammabscheider-fehlt'),
    false,
  );

  /*
   * Regel 14 — Schmutzfänger nicht im Rücklauf.
   * Auslösend: derselbe Abscheider ausschließlich an Vorlaufleitungen — dort
   * schützt er den Erzeuger nicht, sondern erst die Verbraucher dahinter.
   * Nicht auslösend: der Nullpunkt, dessen Abscheider im Rücklauf hängt.
   */
  const abscheiderImVorlauf = mit(
    ohneAbscheider,
    [bauteil('vor', 'dirt-separator', 'Schlammabscheider Vorlauf')],
    [leitung('l-vor', 'wp', 'flow', 'vor', 'in', 'heating-flow')],
  );
  const r14ja = pruefe(abscheiderImVorlauf, basisAuslegung, basisAnlage);
  check('R14 Abscheider im Vorlauf: löst aus', hat(r14ja, 'schlammabscheider-nicht-im-ruecklauf'), true);
  check('R14 Grad', gradVon(r14ja, 'schlammabscheider-nicht-im-ruecklauf'), 'warnung');
  check('R14 Abscheider im Rücklauf: löst nicht aus', hat(null0, 'schlammabscheider-nicht-im-ruecklauf'), false);

  /*
   * Regel 15 — keine Absperrung an Erzeuger und Pumpe.
   * Auslösend: der Nullpunkt ohne die Absperrung; die Wärmepumpe bleibt als
   * absperrpflichtiges Gerät stehen.
   * Nicht auslösend: der Nullpunkt selbst — **und** ein Bild ganz ohne
   * Erzeuger und Pumpe, denn dann gibt es nichts abzusperren. Die Regel darf
   * an einem leeren Blatt nicht melden.
   */
  const r15ja = pruefe(ohne(basisBild, 'shutoff'), basisAuslegung, basisAnlage);
  check('R15 ohne Absperrung: löst aus', hat(r15ja, 'absperrung-erzeuger-fehlt'), true);
  check('R15 Grad', gradVon(r15ja, 'absperrung-erzeuger-fehlt'), 'warnung');
  check('R15 mit Absperrung: löst nicht aus', hat(null0, 'absperrung-erzeuger-fehlt'), false);
  check(
    'R15 ohne Erzeuger und Pumpe: löst nicht aus',
    hat(pruefe(ohne(basisBild, 'shutoff', 'heatpump-outdoor'), basisAuslegung, basisAnlage), 'absperrung-erzeuger-fehlt'),
    false,
  );

  /* Regel 16 — Mikroblasenabscheider (Empfehlung, deshalb `hinweis`). */
  const r16ja = pruefe(ohne(basisBild, 'air-separator'), basisAuslegung, basisAnlage);
  check('R16 ohne Luftabscheider: löst aus', hat(r16ja, 'luftabscheider-fehlt'), true);
  check('R16 Grad', gradVon(r16ja, 'luftabscheider-fehlt'), 'hinweis');
  check('R16 mit Luftabscheider: löst nicht aus', hat(null0, 'luftabscheider-fehlt'), false);

  /* Regel 17 — Verbrauchserfassung (keine Pflicht aus § 71 GEG, deshalb `hinweis`). */
  const r17ja = pruefe(ohne(basisBild, 'heat-meter'), basisAuslegung, basisAnlage);
  check('R17 ohne Wärmemengenzähler: löst aus', hat(r17ja, 'waermemengenzaehler-fehlt'), true);
  check('R17 Grad', gradVon(r17ja, 'waermemengenzaehler-fehlt'), 'hinweis');
  check('R17 mit Wärmemengenzähler: löst nicht aus', hat(null0, 'waermemengenzaehler-fehlt'), false);

  // =========================================================================
  // F — Frostschutz (Regeln 18 und 19)
  // =========================================================================

  /*
   * Regel 18 — Frostschutzmittel.
   * Auslösend, Grad `warnung`: Glykol im Heizkreis ohne Gerät oder mit einem
   * Hersteller, der es zulässt (Daikin lässt es mit Auflagen zu).
   * Auslösend, Grad `fehler`: derselbe Anteil mit einem Hersteller, der es
   * ausschließt — Bosch, Buderus, Junkers, Wolf.
   * Nicht auslösend: Anteil null, also der Nullpunkt.
   */
  const mitGlykol = anlagenblatt({ glycolFraction: 30 });
  const r18warn = pruefe(basisBild, baueAuslegung({ selected: geraet('Daikin Europe', 0, 8) }), mitGlykol);
  check('R18 Glykol bei Daikin: löst aus', hat(r18warn, 'glykol-herstellerkonflikt'), true);
  check('R18 Grad bei zulassendem Hersteller', gradVon(r18warn, 'glykol-herstellerkonflikt'), 'warnung');
  const r18fehler = pruefe(basisBild, baueAuslegung({ selected: geraet('Bosch Thermotechnik', 0, 8) }), mitGlykol);
  check('R18 Grad bei ausschließendem Hersteller', gradVon(r18fehler, 'glykol-herstellerkonflikt'), 'fehler');
  check('R18 ohne Glykol: löst nicht aus', hat(null0, 'glykol-herstellerkonflikt'), false);

  /*
   * Regel 19 — Volumenstromwächter bei Glykolbetrieb.
   * Auslösend: Glykol im Kreis, kein Bauteil, dessen Beschriftung auf
   * Flussschalter, Strömungswächter oder Durchflusssensor passt.
   * Nicht auslösend, erster Fall: derselbe Betrieb mit einem so beschrifteten
   * Bauteil. Nicht auslösend, zweiter Fall: kein Glykol — die Regel liegt
   * innerhalb von Regel 18 und darf ohne Frostschutz gar nicht erst prüfen.
   */
  check('R19 Glykol ohne Flussschalter: löst aus', hat(r18warn, 'flussschalter-fehlt-bei-glykol'), true);
  check('R19 Grad', gradVon(r18warn, 'flussschalter-fehlt-bei-glykol'), 'warnung');
  const mitFlussschalter = mit(basisBild, [bauteil('fs', 'sensor', 'Strömungswächter EKFLSW1')]);
  check(
    'R19 Glykol mit Strömungswächter: löst nicht aus',
    hat(pruefe(mitFlussschalter, baueAuslegung({ selected: geraet('Daikin Europe', 0, 8) }), mitGlykol), 'flussschalter-fehlt-bei-glykol'),
    false,
  );
  check('R19 ohne Glykol: löst nicht aus', hat(null0, 'flussschalter-fehlt-bei-glykol'), false);

  // =========================================================================
  // G — Reihenfolge, Vollständigkeit, Wiederholbarkeit
  // =========================================================================

  /*
   * Ein Fall, der alle drei Grade und je Grad mehrere Kennungen auslöst.
   *
   * Aus dem Nullpunkt werden Ausdehnungsgefäß, Schlammabscheider,
   * Luftabscheider, Wärmemengenzähler und Absperrung entfernt und ein
   * Überströmventil neben einen Parallelpuffer gestellt. Daraus folgt:
   *
   *   fehler   ausdehnungsgefaess-fehlt              (Regel 12)
   *   fehler   schlammabscheider-fehlt               (Regel 13)
   *   warnung  absperrung-erzeuger-fehlt             (Regel 15)
   *   warnung  ueberstroemventil-mit-trennspeicher   (Regel 2)
   *   hinweis  luftabscheider-fehlt                  (Regel 16)
   *   hinweis  ueberstroemventil-pumpenkennlinie     (Regel 3)
   *   hinweis  waermemengenzaehler-fehlt             (Regel 17)
   *
   * Regel 1 schweigt, weil der Parallelpuffer Anlagenvolumen beisteuert;
   * Regel 14 schweigt, weil ohne Abscheider nichts falsch sitzen kann;
   * Regel 4 schweigt bei 200 l gegen 24 l Forderung.
   *
   * Die erwartete Reihenfolge ergibt sich allein aus der Sortierregel:
   * Grad vor Kennung, Kennung als ASCII aufsteigend — innerhalb `fehler`
   * „a" vor „s", innerhalb `warnung` „a" vor „u", innerhalb `hinweis`
   * „l" vor „u" vor „w".
   */
  const vielfach = mit(
    ohne(basisBild, 'expansion-vessel', 'dirt-separator', 'air-separator', 'heat-meter', 'shutoff'),
    ueberstroemer,
  );
  const gemischtesErgebnis = pruefe(vielfach, mitTrennung, basisAnlage);
  const erwarteteFolge = [
    'ausdehnungsgefaess-fehlt',
    'schlammabscheider-fehlt',
    'absperrung-erzeuger-fehlt',
    'ueberstroemventil-mit-trennspeicher',
    'luftabscheider-fehlt',
    'ueberstroemventil-pumpenkennlinie',
    'waermemengenzaehler-fehlt',
  ];
  check('Mehrfachfall: Zahl der Befunde', gemischtesErgebnis.length, erwarteteFolge.length);
  check('Mehrfachfall: Zahl der Fehler', zahl(gemischtesErgebnis, 'fehler'), 2);
  check('Mehrfachfall: Zahl der Warnungen', zahl(gemischtesErgebnis, 'warnung'), 2);
  check('Mehrfachfall: Zahl der Hinweise', zahl(gemischtesErgebnis, 'hinweis'), 3);
  check('Mehrfachfall: Reihenfolge der Kennungen', gemischtesErgebnis.map((b) => b.id).join(' '), erwarteteFolge.join(' '));
  check(
    'Mehrfachfall: Reihenfolge der Grade',
    gemischtesErgebnis.map((b) => b.grad).join(' '),
    'fehler fehler warnung warnung hinweis hinweis hinweis',
  );

  /*
   * Die Sortierung darf nicht an der Reihenfolge der Eingabe hängen. Dieselben
   * Bauteile und Leitungen rückwärts eingespeist müssen dieselbe Liste
   * ergeben — sonst wäre der Vergleich zweier Anlagenstände Zufall.
   */
  const rueckwaerts = pruefe(
    { komponenten: [...vielfach.komponenten].reverse(), verbindungen: [...vielfach.verbindungen].reverse() },
    mitTrennung,
    basisAnlage,
  );
  check(
    'Reihenfolge unabhängig von der Eingabefolge',
    rueckwaerts.map((b) => b.id).join(' '),
    erwarteteFolge.join(' '),
  );

  /* Zweimal dieselbe Eingabe muss buchstabengleich dasselbe ergeben. */
  const nochmal = pruefe(vielfach, mitTrennung, basisAnlage);
  check(
    'zweimal dieselbe Eingabe: identisches Ergebnis',
    JSON.stringify(nochmal) === JSON.stringify(gemischtesErgebnis),
    true,
  );

  /*
   * Jeder Befund muss lesbar und belegt sein. Ein Befund ohne Beleg ist eine
   * Behauptung — und dieses Modul lebt davon, dass jede Regel ihre Quelle
   * nennt. Geprüft wird über alle in diesem Block erzeugten Ergebnisse
   * zusammen, damit kein Grad und keine Regel ausgelassen wird.
   */
  const alleBefunde = [
    ...gemischtesErgebnis,
    ...r1ja,
    ...r2ja,
    ...r4ja,
    ...r5ja,
    ...r6ja,
    ...r7ja,
    ...r8ja,
    ...r9ja,
    ...r10ja,
    ...r11kfe,
    ...r13ja,
    ...r14ja,
    ...r18fehler,
  ];
  check('Prüfmenge ist nicht leer', alleBefunde.length > 20, true);
  check('alle Kennungen nicht leer', alleBefunde.every((b) => b.id.length > 0), true);
  check('alle Titel nicht leer', alleBefunde.every((b) => b.titel.trim().length > 0), true);
  check('alle Texte nicht leer', alleBefunde.every((b) => b.text.trim().length > 0), true);
  check('alle Belege nicht leer', alleBefunde.every((b) => b.beleg.trim().length > 0), true);
  check(
    'Kennungen innerhalb eines Ergebnisses eindeutig',
    new Set(gemischtesErgebnis.map((b) => b.id)).size,
    gemischtesErgebnis.length,
  );
  check(
    'Kennungen im Mehrfachfall eindeutig — auch rückwärts',
    new Set(rueckwaerts.map((b) => b.id)).size,
    rueckwaerts.length,
  );

  // =========================================================================
  // H — Das leere Schema
  // =========================================================================

  /*
   * Keine Komponenten, keine Verbindungen, keine Zahlen. Das ist der Zustand
   * eines frisch angelegten Projekts, und die Prüfung darf daran nicht
   * scheitern. Erwartet werden genau die Regeln, die auf **Abwesenheit**
   * prüfen und keine Anlagengröße brauchen:
   *
   *   fehler   ausdehnungsgefaess-fehlt          (Regel 12)
   *   fehler   schlammabscheider-fehlt           (Regel 13)
   *   fehler   sicherheitsgruppe-unvollstaendig  (Regel 11)
   *   hinweis  luftabscheider-fehlt              (Regel 16)
   *   hinweis  waermemengenzaehler-fehlt         (Regel 17)
   *
   * Regel 4 schweigt, weil Leistung und Volumen null sind; Regel 8 und 9,
   * weil es keine Heizkreise gibt; Regel 15, weil es weder Erzeuger noch
   * Pumpe abzusperren gibt.
   */
  const leer = pruefe(
    { komponenten: [], verbindungen: [] },
    baueAuslegung({ requiredCapacity: 0, circuits: [], volume: { total: 0, parts: [] } }),
    undefined,
  );
  check('leeres Schema: Zahl der Befunde', leer.length, 5);
  check('leeres Schema: Zahl der Fehler', zahl(leer, 'fehler'), 3);
  check('leeres Schema: Zahl der Hinweise', zahl(leer, 'hinweis'), 2);
  check('leeres Schema: keine Warnungen', zahl(leer, 'warnung'), 0);
  check('leeres Schema: Sicherheitsgruppe gemeldet', hat(leer, 'sicherheitsgruppe-unvollstaendig'), true);
  check('leeres Schema: kein Mindestvolumen gemeldet', hat(leer, 'mindestanlagenvolumen-unterschritten'), false);
  check('leeres Schema: keine Absperrung gemeldet', hat(leer, 'absperrung-erzeuger-fehlt'), false);

  // =========================================================================
  // I — Das echte Haus
  // =========================================================================

  /*
   * Referenzhaus → `designPlant` → `buildSchematic` → Prüfung.
   *
   * Erwartet wird **kein** Fehler und **keine** Warnung. Der Generator
   * zeichnet die vollständige Anlage: Sicherheitsventil, Manometer, KFE-Hahn,
   * Ausdehnungsgefäß, Schlammabscheider im Rücklauf, Mikroblasenabscheider,
   * Wärmemengenzähler, Absperrungen und einen Verteilbalken. Damit schweigen
   * die Regeln 11 bis 17. Der Puffer ist ein **Reihenpuffer** im Rücklauf —
   * er trennt nicht hydraulisch, also schweigen Regeln 2 und 5, und weil er
   * Anlagenvolumen beisteuert, auch Regel 1. Die Flächenheizkreise sind
   * gemischt (Regel 8 verlangt einen Wächter nur bei ungemischten), fahren
   * aber 35 °C gegen einen Erzeugervorlauf von 50 °C aus den Heizkörpern —
   * die Schwelle liegt bei 48 °C, also schweigt Regel 7. Ohne Frostschutz
   * schweigen Regeln 18 und 19.
   *
   * Übrig bleibt **kein einziger Befund**.
   *
   * Bis 1.12.0 waren es drei. Der letzte fiel mit der Pufferwahl: das
   * Referenzhaus hat vier Kreise, davon gemischte, und bekommt seit 1.13.0
   * einen **Parallelpuffer** statt eines Reihenpuffers. Damit ist die Anlage
   * hydraulisch getrennt, das Überströmventil entfällt — und mit ihm der
   * Hinweis auf die Pumpenkennlinie, der an nichts hing als an seinem
   * Vorhandensein.
   *
   * Der Weg dorthin ist der eigentliche Inhalt von 1.13.0. Zwei Regeln
   * schlugen bis dahin bei **jedem** erzeugten Schema an, und beide zu Recht:
   *
   *  • Regel 15 (Absperrung am Erzeuger) — der Generator zeichnete keine
   *    einzige Absperrung. Jetzt sitzt je eine im Vor- und im Rücklauf am
   *    Erzeuger und eine auf der Anlagenseite der Umwälzpumpe, wie DIN EN
   *    12828 und der BWP-Leitfaden es verlangen. Die Regel selbst wurde
   *    zugleich enger gefasst: sie fordert die Absperrung am Wärmeerzeuger,
   *    nicht an jeder Kreispumpe — der BWP zeichnet den gemischten Kreis
   *    ausdrücklich als „Absperrventil → Mischer → Pumpe → Rückschlagklappe",
   *    die Kreispumpe hat dort also keine benachbarte Absperrung. Eine Regel,
   *    die bei der Musterzeichnung anschlägt, meldet sich selbst.
   *  • Regel 8 (Temperaturwächter am ungemischten Flächenheizkreis) — er
   *    wurde nie gezeichnet. Jetzt schon.
   */
  const doc = buildReferenceDocument();
  const auslegung = designPlant(doc);
  const schema = buildSchematic(auslegung);
  const echt = pruefeSchema({
    komponenten: schema.components,
    verbindungen: schema.links,
    auslegung,
    anlage: doc.plant,
  });
  check('Referenzhaus: Bauteile im Schema vorhanden', schema.components.length > 20, true);
  check('Referenzhaus: keine Fehler', zahl(echt, 'fehler'), 0);
  check('Referenzhaus: keine Warnungen', zahl(echt, 'warnung'), 0);
  check('Referenzhaus: keine Hinweise', zahl(echt, 'hinweis'), 0);
  check('Referenzhaus: gar kein Befund', echt.length, 0);
  // Die Gegenprobe: der Block ist nicht deshalb leer, weil er nichts prüft.
  // Dieselbe Anlage ohne Ausdehnungsgefäß muss weiterhin anschlagen.
  const ohneAg = pruefeSchema({
    komponenten: schema.components.filter((c) => c.kind !== 'expansion-vessel'),
    verbindungen: schema.links,
    auslegung,
    anlage: doc.plant,
  });
  check('Referenzhaus ohne Ausdehnungsgefäß: Regel greift', ohneAg.some((b) => b.id === 'ausdehnungsgefaess-fehlt'), true);
  // Die beiden Regeln, die bis 1.12.0 immer anschlugen, schweigen jetzt —
  // nicht weil sie entschärft wurden, sondern weil das Schema die Bauteile
  // zeichnet, die sie fordern.
  check('Referenzhaus: Absperrung am Erzeuger vorhanden',
    echt.some((b) => b.id === 'absperrung-erzeuger-fehlt'), false);
  check('Referenzhaus: Temperaturwächter am ungemischten Flächenkreis vorhanden',
    echt.some((b) => b.id === 'flaechenheizung-ohne-temperaturwaechter'), false);

  // =========================================================================
  // Die zwei Bildregeln aus 1.53.0
  // =========================================================================
  /*
   * Sie sind am Referenzhaus stumm — das Erzeugte war nie falsch. Aufgefallen
   * sind beide an einer **von Hand** gezeichneten Übersicht. Eine Regel, die
   * nur schweigt, ist aber nichts wert: geprüft wird hier vor allem, dass sie
   * anschlägt, wenn das Bild wirklich falsch ist.
   *
   * Gebaut werden dafür zwei winzige Fließbilder von Hand. Sie sind kein
   * Ersatz für das Referenzhaus, sondern das Gegenstück dazu: dort das
   * richtige Bild, hier das falsche.
   */
  {
    const auslegungKlein = baueAuslegung();

    /** Ein Anlagenblatt mit genau einem Speicher bekannter Art. */
    const mitSpeicher = (id: string, kind: 'buffer-parallel' | 'buffer-series'): PlantDefinition => {
      const p = emptyPlant();
      return {
        ...p,
        storages: {
          [id]: {
            id,
            kind,
            volume: 200,
            label: kind === 'buffer-parallel' ? 'Parallelpuffer' : 'Reihenpuffer',
          } as PlantDefinition['storages'][string],
        },
      };
    };

    // --- Regel „Trinkwasserladung nicht über den Puffer" -------------------
    //
    // Falsches Bild: Vom Umschaltventil geht es **nur** über den Puffer zum
    // Trinkwasserspeicher. Genau die Aussage, die das Umschaltventil
    // widerlegt — es schaltet um, es verteilt nicht.
    const ueberPuffer: Fliessbild = {
      komponenten: [
        bauteil('wp', 'heatpump-outdoor', 'Wärmepumpe'),
        bauteil('uv', 'valve-diverter', 'Umschaltventil'),
        bauteil('pu', 'buffer', 'Pufferspeicher'),
        bauteil('tw', 'cylinder', 'Trinkwasserspeicher'),
      ],
      verbindungen: [
        leitung('l1', 'wp', 'flow', 'uv', 'in', 'heating-flow'),
        leitung('l2', 'uv', 'b', 'pu', 'flow-top', 'heating-flow'),
        leitung('l3', 'pu', 'flow-out', 'tw', 'coil-in', 'heating-flow'),
      ],
    };
    const befundeUeberPuffer = pruefe(ueberPuffer, auslegungKlein);
    check('Bildregel · Warmwasser über den Puffer wird erkannt',
      hat(befundeUeberPuffer, 'trinkwasser-ueber-puffer'), true);
    check('Bildregel · und zwar als Fehler',
      gradVon(befundeUeberPuffer, 'trinkwasser-ueber-puffer'), 'fehler');

    // Richtiges Bild: dieselben Bauteile, aber die Ladeleitung zweigt **vor**
    // dem Puffer ab. Ein Bauteil mehr wäre eine andere Anlage; hier ist nur
    // eine Leitung anders gelegt — und das ist der ganze Unterschied.
    const amPufferVorbei: Fliessbild = {
      komponenten: ueberPuffer.komponenten,
      verbindungen: [
        leitung('l1', 'wp', 'flow', 'uv', 'in', 'heating-flow'),
        leitung('l2', 'uv', 'a', 'pu', 'flow-top', 'heating-flow'),
        leitung('l3', 'uv', 'b', 'tw', 'coil-in', 'heating-flow'),
      ],
    };
    check('Bildregel · am Puffer vorbei ist in Ordnung',
      hat(pruefe(amPufferVorbei, auslegungKlein), 'trinkwasser-ueber-puffer'), false);

    // Ohne Puffer kann die Regel nicht greifen — sonst schlüge sie bei jeder
    // Anlage ohne Puffer an, und das wäre das Gegenteil von hilfreich.
    const ohnePuffer: Fliessbild = {
      komponenten: ueberPuffer.komponenten.filter((c) => c.kind !== 'buffer'),
      verbindungen: [
        leitung('l1', 'wp', 'flow', 'uv', 'in', 'heating-flow'),
        leitung('l3', 'uv', 'b', 'tw', 'coil-in', 'heating-flow'),
      ],
    };
    check('Bildregel · ohne Puffer schweigt sie',
      hat(pruefe(ohnePuffer, auslegungKlein), 'trinkwasser-ueber-puffer'), false);

    // --- Regel „Parallelpuffer hat vier Anschlüsse" ------------------------
    //
    // Abgezählt: Erzeugervorlauf, Erzeugerrücklauf, Heizungsvorlauf,
    // Heizungsrücklauf — vier. Das Prüfbild hängt zwei daran.
    const zweiAnschluesse: Fliessbild = {
      komponenten: [
        bauteil('wp', 'heatpump-outdoor', 'Wärmepumpe'),
        { ...bauteil('pu', 'buffer', 'Parallelpuffer'), storageId: 'sp-1' },
        bauteil('hk', 'radiator', 'Heizkörper'),
      ],
      verbindungen: [
        leitung('l1', 'wp', 'flow', 'pu', 'flow-top', 'heating-flow'),
        leitung('l2', 'pu', 'return-bottom', 'wp', 'return', 'heating-return'),
      ],
    };
    const befundeZwei = pruefe(zweiAnschluesse, auslegungKlein, mitSpeicher('sp-1', 'buffer-parallel'));
    check('Bildregel · Parallelpuffer mit zwei Anschlüssen fällt auf',
      hat(befundeZwei, 'parallelpuffer-anschlusszahl'), true);

    // Vier Anschlüsse: still.
    const vierAnschluesse: Fliessbild = {
      komponenten: zweiAnschluesse.komponenten,
      verbindungen: [
        ...zweiAnschluesse.verbindungen,
        leitung('l3', 'pu', 'flow-out', 'hk', 'flow', 'heating-flow'),
        leitung('l4', 'hk', 'return', 'pu', 'return-top', 'heating-return'),
      ],
    };
    check('Bildregel · Parallelpuffer mit vier Anschlüssen ist in Ordnung',
      hat(pruefe(vierAnschluesse, auslegungKlein, mitSpeicher('sp-1', 'buffer-parallel')), 'parallelpuffer-anschlusszahl'),
      false);

    // Reihenpuffer: dieselben zwei Anschlüsse, aber die Regel gilt für ihn
    // nicht — er sitzt allein im Rücklauf, und das ist hydraulisch etwas
    // anderes, kein Fehler.
    check('Bildregel · Reihenpuffer wird nicht an der Vier gemessen',
      hat(pruefe(zweiAnschluesse, auslegungKlein, mitSpeicher('sp-1', 'buffer-series')), 'parallelpuffer-anschlusszahl'),
      false);

    // Und ohne Angabe der Speicherart schweigt sie ebenfalls: Was das
    // Programm nicht weiß, behauptet es nicht.
    check('Bildregel · ohne bekannte Speicherart schweigt sie',
      hat(pruefe(zweiAnschluesse, auslegungKlein), 'parallelpuffer-anschlusszahl'), false);
  }

  // =========================================================================
  // Welche Musterlösung ist das? — die Zuordnung ohne Auswahlliste
  // =========================================================================
  /*
   * Seit 1.51.0 wird die Vorlage nicht mehr ausgewählt, sondern abgeleitet.
   * Geprüft wird hier dreierlei: dass überhaupt eine herauskommt, dass eine
   * **eingetragene** gewinnt, und dass eine eingetragene, die nicht passt,
   * gemeldet wird, statt still ersetzt zu werden.
   */
  {
    const z = zugeordneteVorlage(auslegung, doc.plant);
    check('Zuordnung · das Referenzhaus bekommt eine Vorlage', Boolean(z), true);
    check('Zuordnung · sie ist abgeleitet, nicht eingetragen', z?.quelle ?? 'keine', 'abgeleitet');
    /*
     * Welche es sein muss, folgt aus der Anlage: Wärmepumpe, **paralleler**
     * Pufferspeicher, eigener Trinkwasserspeicher, **zwei** Heizkreise. Genau
     * das ist im BWP-Leitfaden Schema 3 — „Wärmepumpe, mehrere Heizkreise und
     * Trinkwassererwärmung mit parallelem Pufferspeicher". Schema 1 und 2
     * scheiden an der Anbindung aus (kein Puffer / Puffer in Reihe), 4 bis 11
     * an Bauteilen, die es hier nicht gibt (Solar, Kessel, Kombispeicher,
     * Kühlung, Schwimmbad, Kaskade).
     */
    check('Zuordnung · und sie heißt BWP-H-03', z?.vorlage.kennung ?? 'keine', 'BWP-H-03');
    check('Zuordnung · der Satz nennt die Kennung', (z?.satz ?? '').includes('BWP-H-03'), true);

    // Eingetragenes schlägt Abgeleitetes — dieselbe Regel wie bei den sechs
    // Antworten: was dasteht, gilt.
    const mitEintrag = {
      ...doc.plant,
      schematic: { ...doc.plant.schematic, vorlageId: 'bwp-h-01-direkt-flaeche' },
    };
    const zEin = zugeordneteVorlage(auslegung, mitEintrag);
    check('Zuordnung · Eingetragenes gewinnt', zEin?.quelle ?? 'keine', 'eingetragen');
    check('Zuordnung · und wird nicht still ersetzt', zEin?.vorlage.kennung ?? 'keine', 'BWP-H-01');

    /*
     * BWP-H-01 ist das Schema **ohne** Puffer. Die Anlage hat einen — ein
     * hartes Merkmal steht dagegen, also muss die Schemaprüfung es sagen.
     */
    const befundeEintrag = pruefeSchema({
      komponenten: schema.components,
      verbindungen: schema.links,
      auslegung,
      anlage: mitEintrag,
    });
    check('Zuordnung · unpassender Eintrag wird gemeldet', hat(befundeEintrag, 'vorlage-passt-nicht'), true);
    check('Zuordnung · als Warnung, nicht als Fehler', gradVon(befundeEintrag, 'vorlage-passt-nicht'), 'warnung');
    check('Zuordnung · das passende Referenzhaus schweigt', hat(echt, 'vorlage-passt-nicht'), false);
    check('Zuordnung · und es fehlt keine Musterlösung', hat(echt, 'keine-musterloesung'), false);
  }
}
