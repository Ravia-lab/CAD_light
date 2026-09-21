/**
 * Massen- und Materialauszug über das ganze Projekt.
 * ---------------------------------------------------------------------------
 * Das ist die Liste, mit der jemand bestellt. Deshalb steht an jeder Position
 * nicht nur eine Menge, sondern auch ihre **Herkunft** im Klartext: aus
 * welchem Teil des Modells sie stammt. Eine Massenermittlung ohne Herkunft ist
 * wertlos, weil niemand sie nachprüfen kann — und geprüft wird sie immer, in
 * dem Moment, in dem auf der Baustelle Rohr fehlt.
 *
 * **Was das Modul nicht tut.** Es kennt keine Preise und erfindet keine. Wer
 * Mengen mit Preisen mischt, bekommt eine Zahl, die niemand mehr auseinander-
 * nehmen kann. Die Kalkulation setzt ihre Einheitspreise selbst daneben; hier
 * steht nur, wovon wie viel.
 *
 * **Was es zusammenführt.** Die Mengen liegen im Modell verstreut: Leitungen
 * im Grundriss, Flächenheizung in der Auslegung, Armaturen teils in der
 * Sicherheitsberechnung und teils im Anlagenschema, Bauteile in Wänden und
 * Öffnungen. Jede dieser Quellen hat ihre eigene Vollständigkeit und ihre
 * eigenen Lücken. Fehlt eine, wird das gemeldet und nicht überspielt — eine
 * Liste, die stillschweigend die halbe Anlage weglässt, ist gefährlicher als
 * gar keine.
 *
 * **Doppelzählung.** Der heikelste Punkt sind die Armaturen: dieselbe Pflicht-
 * armatur steht in `SafetyDesign.fittings` *und* als Bauteil im Anlagenschema,
 * weil `buildSchematic` das Schema aus genau diesem Ergebnis zeichnet. Die
 * Regel dagegen steht bei `SAFETY_LEADS` und wird dort begründet.
 *
 * Die CSV-Konventionen sind die von `componentTableCsv` in `schematicPrint`:
 * Semikolon als Trenner, CR/LF als Zeilenende, Anführungszeichen nur wo nötig.
 * Zwei Unterschiede sind gewollt und bei `cell` und `materialScheduleCsv`
 * begründet: diese Datei trägt ein BOM, und ein Wagenrücklauf im Feld löst
 * das Quoting mit aus.
 */

import type {
  BimDocument,
  Construction,
  Fixture,
  FixtureType,
  HeatingCircuit,
  Opening,
  PipeMaterial,
  PipeRun,
  PipeScheduleEntry,
  PipeService,
  PlantStorage,
  SchematicComponent,
  SchematicKind,
  WallType,
} from '../types/bim';
import {
  RADIATOR_CONNECTION_LABELS,
  VENTILSEITE_LABELS,
  BRANDSCHUTZ_LABELS,
  DEFAULT_CONSTRUCTIONS,
  DURCHBRUCH_LABELS,
  FIXTURE_BY_TYPE,
  PIPE_MATERIAL_LABELS,
  PIPE_SERVICE_LABELS,
  SHAFT_SERVICE_LABELS,
  STORAGE_KIND_LABELS,
} from '../types/bim';
import { BELAG_GRENZE, belagNach } from './bodenbelag';
import { rohrlaenge, steiganteil } from './rohrlaenge';
import { rohrbezeichnungLang } from './rohrbezeichnung';
import { herkunftText, uWertOeffnung, uWertWand, type UWertAuskunft } from './uwert';
import { findModel } from './deviceCatalog';
import { plantOf } from './plantDefaults';
import { buildSchematic, type CircuitDesign, type PlantDesignResult, type RoomLoopDesign } from './plantDesign';
import { buildComponentTable, type ComponentTableRow } from './schematicPrint';
import { SCHEMATIC_LEGEND } from './schematicSymbols';

// ===========================================================================
// 1 — Typen
// ===========================================================================

/**
 * Gewerk im Sinne der Bestellung, nicht im Sinne der Handwerksordnung.
 * Getrennt wird danach, wer die Position bestellt und wo sie herkommt: Rohr
 * und Dämmung gehen an denselben Großhändler, die Flächenheizung kommt als
 * Systempaket, Bauteile werden gar nicht bestellt.
 */
export type MaterialTrade =
  | 'rohr'
  | 'fbh'
  | 'heizflaeche'
  | 'geraet'
  | 'armatur'
  | 'sanitaer'
  | 'lueftung'
  | 'durchbruch'
  | 'bauteil';

export const MATERIAL_TRADE_LABELS: Record<MaterialTrade, string> = {
  rohr: 'Rohrleitungen und Dämmung',
  fbh: 'Fußbodenheizung',
  heizflaeche: 'Heizflächen',
  geraet: 'Geräte und Speicher',
  armatur: 'Armaturen und Sicherheitstechnik',
  sanitaer: 'Sanitär',
  lueftung: 'Lüftung',
  durchbruch: 'Durchbrüche und Schottungen',
  bauteil: 'Bauteile (Grundlage Leistungsverzeichnis)',
};

/** Reihenfolge der Gewerke in der Liste — sie folgt dem Bauablauf. */
const TRADE_ORDER: readonly MaterialTrade[] = [
  // Gebohrt wird, bevor verlegt wird — deshalb steht der Durchbruch vor dem
  // Rohr und nicht bei den Bauteilen am Ende.
  'durchbruch',
  'rohr',
  'fbh',
  'heizflaeche',
  'geraet',
  'armatur',
  'sanitaer',
  'lueftung',
  'bauteil',
];

/**
 * Einheiten. Bewusst nur fünf: alles, was sich nicht in Meter, Quadratmeter,
 * Stück, Liter oder Kilowatt ausdrücken lässt, gehört nicht in eine
 * Bestellliste.
 */
export type MaterialUnit = 'm' | 'm²' | 'Stk' | 'l' | 'kW';

const UNIT_ORDER: readonly MaterialUnit[] = ['m', 'm²', 'Stk', 'l', 'kW'];

/** Nachkommastellen je Einheit. Stück sind ganzzahlig, Meter auf den Zentimeter. */
const UNIT_DIGITS: Record<MaterialUnit, number> = {
  m: 2,
  'm²': 2,
  Stk: 0,
  l: 0,
  kW: 1,
};

/** Trennzeichen des Gruppierungsschlüssels — in keinem Feldwert enthalten. */
const SEP = '\u241F';

export interface MaterialItem {
  /** Laufende Nummer über die ganze Liste, beginnend bei 1. */
  position: number;
  trade: MaterialTrade;
  tradeLabel: string;
  /** Bezeichnung — wonach innerhalb des Gewerks sortiert wird. */
  name: string;
  /** Technische Angabe: Dimension, Leistung, Bauart. Leer, wenn keine da ist. */
  spec: string;
  quantity: number;
  unit: MaterialUnit;
  /**
   * Woher die Menge stammt, im Klartext. Das ist die Spalte, wegen der die
   * Liste prüfbar ist — sie nennt den Teil des Modells, nicht den Rechenweg.
   */
  origin: string;
  remark?: string;
}

export interface MaterialGroup {
  trade: MaterialTrade;
  label: string;
  items: MaterialItem[];
  /** Zahl der Positionen in diesem Gewerk. */
  itemCount: number;
  /** Wichtigste Mengen, je Einheit aufsummiert. */
  totals: { unit: MaterialUnit; quantity: number }[];
  /** Dieselbe Aussage als Satz, z. B. „14 Positionen · 248,50 m · 32 Stk". */
  summary: string;
}

export type MaterialNote = { severity: 'info' | 'warn' | 'error'; text: string };

export interface MaterialSchedule {
  projectName: string;
  groups: MaterialGroup[];
  /** Alle Positionen in der Reihenfolge ihrer laufenden Nummer. */
  items: MaterialItem[];
  positionCount: number;
  notes: MaterialNote[];
}

/** Eine Position, bevor sie ihre laufende Nummer bekommen hat. */
type Draft = Omit<MaterialItem, 'position' | 'tradeLabel'>;

// ===========================================================================
// 2 — Kleinkram
// ===========================================================================

/**
 * Endliche Zahl? Ein Modell, das durch Import oder Autosave gelaufen ist, kann
 * an jeder Stelle `NaN`, `Infinity` oder gar nichts stehen haben. Eine Menge
 * daraus fällt in `Sheet.add` heraus; eine Zahl, die nur im Text steht, fiele
 * niemandem auf — „Baulänge NaN m" ist genau die Zeile, die ungeprüft in eine
 * Bestellung wandert.
 */
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** Endlich und größer null — die Bedingung, unter der eine Zahl im Text etwas aussagt. */
const positive = (value: number | undefined): value is number => isNumber(value) && value > 0;

/** Deutsche Zahl mit Dezimalkomma. Was keine Zahl ist, wird als solches benannt. */
const num = (value: number, digits: number): string =>
  isNumber(value) ? value.toFixed(digits).replace('.', ',') : 'ohne Angabe';

/**
 * Dezimalpunkt zu Dezimalkomma in übernommenem Fremdtext.
 *
 * Die technische Angabe eines Schema-Bauteils kommt aus `plantDesign` und ist
 * dort mit `toFixed` gebildet, also mit Punkt („0.18 m³/h"). In einer
 * deutschen Bestellliste ist das falsch. Umgestellt wird nur zwischen zwei
 * Ziffern, damit Bezeichnungen wie „DIN 1988-200" oder „R290" unberührt
 * bleiben.
 */
const germanDecimals = (text: string): string => text.replace(/(\d)\.(\d)/g, '$1,$2');

/** Menge in der Schreibweise ihrer Einheit. */
const quantityText = (value: number, unit: MaterialUnit): string => num(value, UNIT_DIGITS[unit]);

/** Auf zwei Stellen runden — genauer wird eine Massenermittlung nicht. */
const round2 = (value: number): number => Math.round(value * 100) / 100;

/** Nicht-leere Textstücke mit Mittelpunkt verbinden; leere fallen weg. */
const joinSpec = (...parts: (string | false | undefined | null)[]): string =>
  parts.filter((p): p is string => typeof p === 'string' && p.length > 0).join(' · ');

/**
 * Sammelbecken für Positionen.
 *
 * Zusammengezählt wird nach Gewerk, Bezeichnung, technischer Angabe *und*
 * Herkunft. Die Herkunft gehört in den Schlüssel: zwanzig Meter DN 20 aus dem
 * Grundriss und zwanzig Meter DN 20 aus der Auslegung sind zwei Positionen,
 * denn sonst wüsste hinterher niemand mehr, welche Hälfte woher kam.
 */
class Sheet {
  private readonly rows = new Map<string, Draft>();

  add(item: Draft): void {
    // Nullmengen und Rechenreste (NaN aus einer Leitung ohne Stützpunkte)
    // erzeugen keine Position. Eine Bestellzeile über 0 m ist keine Aussage.
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) return;
    // Zusammengefasst wird, was in allen fünf Merkmalen übereinstimmt. Als
    // Trennzeichen dient eine Zeichenfolge, die in keinem der Felder
    // vorkommen kann — ein NUL-Byte wäre auch eindeutig, macht die Quelldatei
    // aber technisch binär und damit für Werkzeuge wie grep und diff unlesbar.
    const key = [item.trade, item.name, item.spec, item.unit, item.origin].join(SEP);
    const found = this.rows.get(key);
    if (found) {
      found.quantity = round2(found.quantity + item.quantity);
      return;
    }
    this.rows.set(key, { ...item, quantity: round2(item.quantity) });
  }

  all(): Draft[] {
    return [...this.rows.values()];
  }
}

// ===========================================================================
// 3 — Rohrleitungen
// ===========================================================================

/**
 * Verlegeart, soweit sie aus dem Modell hervorgeht.
 *
 * Erkennbar ist sie allein an der Verlegehöhe über Fertigfußboden. Die beiden
 * Grenzen sind gesetzt, nicht genormt: unter 0,10 m liegt das Rohr im
 * Fußbodenaufbau, über 2,00 m unter der Decke, dazwischen an der Wand. Wer
 * andere Grenzen braucht, verschiebt sie hier — sie stehen bewusst an einer
 * Stelle und nicht verstreut in Bedingungen.
 */
type LayingKind = 'boden' | 'wand' | 'decke';

const LAYING_BOTTOM = 0.1;
const LAYING_TOP = 2.0;

const LAYING_LABELS: Record<LayingKind, string> = {
  boden: 'im Fußbodenaufbau',
  wand: 'an der Wand',
  decke: 'unter der Decke',
};

/**
 * Ohne belastbare Verlegehöhe gibt es keine Verlegeart.
 *
 * Ein ungeprüfter Vergleich mit `NaN` ist zweimal falsch und fiele damit in
 * den mittleren Zweig — die Leitung stünde als „an der Wand" in der Liste,
 * obwohl das Modell darüber nichts weiß. `undefined` ist hier die ehrliche
 * Antwort; der Fall wird in `collectPipes` gemeldet.
 */
const layingOf = (run: PipeRun): LayingKind | undefined => {
  if (!isNumber(run.elevation)) return undefined;
  return run.elevation < LAYING_BOTTOM ? 'boden' : run.elevation > LAYING_TOP ? 'decke' : 'wand';
};

/**
 * Dämmzustand einer Leitung — ein Kriterium, aus dem sowohl die Bestellzeile
 * als auch der Hinweisblock leben.
 *
 * Zwei Kriterien für denselben Sachverhalt sind der Weg zu einer Liste, die
 * sich selbst widerspricht: eine Zeile „ungedämmt" über einer Meldung „0
 * Leitungspositionen ohne Dämmung". Unterschieden wird deshalb an genau dieser
 * Stelle, und zwar fachlich: eine ausdrückliche Null ist die Aussage, dass
 * nicht gedämmt wird; eine fehlende, unendliche oder negative Stärke ist gar
 * keine Aussage. Beides „ungedämmt" zu nennen hieße, eine Angabe zu erfinden.
 */
type InsulationState = 'gedaemmt' | 'ungedaemmt' | 'unbekannt';

const insulationStateOf = (value: number | undefined): InsulationState =>
  positive(value) ? 'gedaemmt' : value === 0 ? 'ungedaemmt' : 'unbekannt';

/** Der Dämmzustand als technische Angabe. Bildet nur ab, was oben entschieden wurde. */
const insulationSpec = (value: number): string => {
  const state = insulationStateOf(value);
  if (state === 'gedaemmt') return `${num(value, 0)} mm gedämmt`;
  return state === 'ungedaemmt' ? 'ungedämmt' : 'Dämmstärke nicht angegeben';
};


/** Ein Eintrag des Längenauszugs, um die Verlegeart erweitert. */
interface PipeRow extends PipeScheduleEntry {
  laying?: LayingKind;
  /**
   * Werkstoff und Außenmaß — die Angaben, mit denen bestellt wird.
   *
   * **Warum sie in den Schlüssel gehören.** Cu 15 × 1 und MSV 16 × 2 tragen
   * beide die Nennweite DN 12 (d_i = 13 bzw. 12 mm, beide am nächsten an
   * 12). Gruppierte man nur nach der Nennweite, stünden zwanzig Meter
   * Kupfer und zwanzig Meter Verbundrohr als **eine** Position von vierzig
   * Metern in der Bestellung — zwei verschiedene Artikel unter einer Zahl.
   */
  material?: PipeMaterial;
  outerDiameter?: number;
}

/**
 * Leitungslängen zusammenfassen.
 *
 * Die Verlegeart kommt nur dann in den Schlüssel, wenn das Modell überhaupt
 * verschiedene Verlegehöhen kennt. Ein Dokument, in dem jede Leitung auf der
 * Vorgabehöhe liegt, weiß nichts über die Verlegeart — dann eine Spalte
 * „im Fußbodenaufbau" zu füllen wäre eine erfundene Angabe.
 */
function pipeRows(runs: readonly PipeRun[], splitByLaying: boolean): PipeRow[] {
  const map = new Map<string, PipeRow>();
  for (const run of runs) {
    /*
     * **Die wahre Länge, nicht die Trassenlänge.**
     *
     * Bis 1.23.0 stand hier die Grundrisslänge, und die Bemerkung unter der
     * Tabelle sagte das auch ehrlich: „ohne Höhenversatz". Ehrlich war sie,
     * richtig nicht: Ein Fallstrang von 2,40 m in der Zimmerecke hat im
     * Grundriss die Länge null und fiel damit durch die Zeile
     * `length <= 0` — er fehlte in der Bestellung vollständig, ohne dass
     * irgendwo etwas gemeldet worden wäre.
     */
    const length = rohrlaenge(run);
    const steig = steiganteil(run);
    if (!Number.isFinite(length) || length <= 0) continue;
    const laying = splitByLaying ? layingOf(run) : undefined;
    const key = `${run.service}|${run.nominalDiameter}|${run.material ?? ''}|${run.outerDiameter ?? ''}|${run.insulation}|${laying ?? ''}`;
    const found = map.get(key);
    if (found) {
      found.length += length;
      found.riseLength = (found.riseLength ?? 0) + steig;
      found.runs += 1;
      continue;
    }
    map.set(key, {
      service: run.service,
      nominalDiameter: run.nominalDiameter,
      insulation: run.insulation,
      length,
      riseLength: steig,
      runs: 1,
      laying,
      material: run.material,
      outerDiameter: run.outerDiameter,
    });
  }
  return [...map.values()];
}

/**
 * Die Bemerkung unter einer Rohrposition — und warum sie den senkrechten
 * Anteil **nennen muss**.
 *
 * Bis 1.23.0 stand hier ein fester Satz: „Trassenlänge in der Grundrissebene,
 * ohne Höhenversatz, ohne Formstücke und ohne Verschnitt." Der erste Teil
 * stimmt seit `rohrlaenge.ts` nicht mehr — die Menge ist die **wahre** Länge
 * einschließlich Höhenversatz. Den alten Satz stehen zu lassen wäre der
 * schlimmere der beiden möglichen Fehler: Eine falsche Menge fällt beim
 * Nachmessen auf, eine falsche Erklärung einer richtigen Menge lässt den
 * Prüfer die richtige Menge korrigieren.
 *
 * **Warum in der Bemerkung und nicht als eigene Spalte.** Die Zahl wird von
 * genau einem Leser gebraucht, und zwar in genau einem Moment: Wer eine
 * Bestellung gegen einen Plan prüft, misst im Plan nach und kommt auf die
 * Trassenlänge. Ihm fehlen dann ein paar Meter, und er hält sie für einen
 * Fehler. Er braucht die Differenz **neben der Menge, die er gerade
 * anzweifelt** — nicht in einer eigenen Spalte, die er erst in Beziehung
 * setzen muss, und die bei den neun von zehn Positionen ohne Höhenversatz
 * leer bliebe und damit als „nicht ausgefüllt" gelesen würde. Die Bemerkung
 * steht in der Projektmappe und in der CSV unter derselben Zeile; die Spalte
 * müsste in beiden erst geschaffen werden.
 *
 * Genannt werden beide Zahlen, aus denen sich die Menge zusammensetzt — die
 * Trasse und der senkrechte Anteil. Nur die Differenz zu nennen hieße, den
 * Prüfer rechnen zu lassen, was das Programm schon gerechnet hat.
 */
function rohrBemerkung(row: PipeRow): string {
  const ohneZuschlag = 'Ohne Formstücke und ohne Verschnitt.';
  // Unter einem Zentimeter ist der senkrechte Anteil kein Höhenversatz,
  // sondern Rundung aus den Verlegehöhen. Ihn auszuweisen erzeugte an jeder
  // waagerechten Leitung einen Satz über nichts.
  if (!positive(row.riseLength) || row.riseLength < 0.01) {
    return `Wahre Rohrlänge; die Leitungen liegen waagerecht, die Menge entspricht der Trasse im Grundriss. ${ohneZuschlag}`;
  }
  const trasse = row.length - row.riseLength;
  return (
    `Wahre Rohrlänge einschließlich Höhenversatz: ${num(trasse, 2)} m Trasse in der Grundrissebene ` +
    `zuzüglich ${num(row.riseLength, 2)} m senkrechter Anteil aus Steig- und Fallstrecken. Im Plan ` +
    `nachgemessen ergibt sich nur die Trasse — die Differenz ist kein Fehler. ${ohneZuschlag}`
  );
}

function collectPipes(doc: BimDocument, sheet: Sheet, notes: MaterialNote[]): void {
  const runs = Object.values(doc.pipes ?? {});
  if (!runs.length) {
    notes.push({
      severity: 'warn',
      text: 'Es sind keine Leitungen gezeichnet. Die Rohrmengen fehlen in der Liste — sie lassen sich aus Räumen und Geräten nicht ableiten und müssen im Grundriss erfasst werden.',
    });
  } else {
    /*
     * Nur belastbare Höhen entscheiden über die Aufteilung. Ein einzelner
     * `NaN` machte die Menge sonst größer als eins und träfe damit für das
     * ganze Dokument die Entscheidung, nach einer Verlegeart aufzuteilen, die
     * an dieser Leitung gar nicht bekannt ist.
     */
    const withoutElevation = runs.filter((r) => !isNumber(r.elevation));
    const elevations = new Set(runs.map((r) => r.elevation).filter(isNumber));
    const splitByLaying = elevations.size > 1;
    if (withoutElevation.length) {
      notes.push({
        severity: 'warn',
        text: `${withoutElevation.length} Leitungsabschnitt${withoutElevation.length === 1 ? ' hat' : 'e haben'} keine belastbare Verlegehöhe. Für ${withoutElevation.length === 1 ? 'ihn' : 'sie'} ist keine Verlegeart angegeben; die Höhe ist an der Leitung nachzutragen.`,
      });
    }
    if (elevations.size === 1) {
      notes.push({
        severity: 'info',
        text: 'Alle Leitungen liegen auf derselben Verlegehöhe. Die Verlegeart ist damit nicht erkennbar; die Rohrpositionen sind nicht danach getrennt.',
      });
    }

    const rows = pipeRows(runs, splitByLaying);
    for (const row of rows) {
      sheet.add({
        trade: 'rohr',
        name: PIPE_SERVICE_LABELS[row.service] ?? String(row.service),
        spec: joinSpec(
          /*
           * **Die Bestellangabe, nicht die Sortiernummer.** Ein Einkauf
           * bestellt „Cu 22 × 1", kein „DN 20" — die Nennweite steht
           * dahinter, weil die Armaturen danach gehen. Fehlt der
           * Werkstoff, bleibt nur die Nennweite, und das ist dann auch
           * die ehrliche Auskunft: Es ist noch nicht festgelegt.
           */
          positive(row.nominalDiameter)
            ? rohrbezeichnungLang({
                nominalDiameter: row.nominalDiameter,
                outerDiameter: row.outerDiameter,
                material: row.material,
              })
            : 'Nennweite nicht angegeben',
          insulationSpec(row.insulation),
          row.laying ? LAYING_LABELS[row.laying] : undefined,
        ),
        quantity: row.length,
        unit: 'm',
        origin: `Rohrnetz im Grundriss, ${row.runs} ${row.runs === 1 ? 'Abschnitt' : 'Abschnitte'}`,
        remark: rohrBemerkung(row),
      });
    }

    /*
     * Dämmung als eigene Position.
     *
     * Sie wird getrennt bestellt, in Metern je Dämmstärke und Nennweite, und
     * zwar über alle Medien hinweg: Dämmschlauch DN 20 mit 20 mm Wandstärke
     * ist derselbe Artikel, gleich ob darunter Vorlauf oder Rücklauf liegt.
     * Die Verlegeart bleibt hier außen vor — sie ändert am Artikel nichts.
     */
    const insulation = new Map<string, { insulation: number; dn: number; length: number; services: Set<PipeService> }>();
    for (const row of rows) {
      if (insulationStateOf(row.insulation) !== 'gedaemmt') continue;
      const key = `${row.insulation}|${row.nominalDiameter}`;
      const found = insulation.get(key);
      if (found) {
        found.length += row.length;
        found.services.add(row.service);
        continue;
      }
      insulation.set(key, {
        insulation: row.insulation,
        dn: row.nominalDiameter,
        length: row.length,
        services: new Set<PipeService>([row.service]),
      });
    }
    for (const entry of insulation.values()) {
      sheet.add({
        trade: 'rohr',
        name: 'Rohrdämmung',
        spec: `${num(entry.insulation, 0)} mm auf ${positive(entry.dn) ? `DN ${num(entry.dn, 0)}` : 'unbekannter Nennweite'}`,
        quantity: entry.length,
        unit: 'm',
        origin: `Gedämmte Leitungen im Grundriss (${[...entry.services].map((s) => PIPE_SERVICE_LABELS[s] ?? String(s)).join(', ')})`,
        remark: 'Getrennte Bestellposition. Formteile für Bögen und Abzweige sind nicht enthalten.',
      });
    }

    // Abwasser wird nicht gedämmt; alles andere ohne Dämmung ist einen Blick
    // wert, bevor die Bestellung rausgeht. Gezählt wird nach demselben
    // Kriterium, aus dem oben die Bestellzeile „ungedämmt" entstanden ist.
    const undamped = rows.filter((r) => insulationStateOf(r.insulation) === 'ungedaemmt' && r.service !== 'waste');
    if (undamped.length) {
      notes.push({
        severity: 'info',
        text: `${undamped.length} Leitungsposition${undamped.length === 1 ? ' ist' : 'en sind'} ohne Dämmung erfasst. Bei Heiz- und Trinkwasserleitungen ist zu prüfen, ob das so gewollt ist.`,
      });
    }

    /*
     * Die fehlende Angabe ist der schwerere Fall und steht deshalb getrennt:
     * hier ist nicht entschieden, dass nicht gedämmt wird — es ist gar nichts
     * entschieden. Solange das offen ist, fehlt der Dämmung ihre Menge.
     */
    const unknownInsulation = rows
      .filter((r) => insulationStateOf(r.insulation) === 'unbekannt')
      .reduce((sum, r) => sum + r.runs, 0);
    if (unknownInsulation > 0) {
      notes.push({
        // Gezählt werden Abschnitte und nicht Positionen: verschiedene
        // unbrauchbare Werte ergeben denselben Zeilentext und stehen deshalb
        // in einer Position — die Zahl der betroffenen Leitungen wäre daraus
        // nicht mehr abzulesen.
        severity: 'warn',
        text: `${unknownInsulation} Leitungsabschnitt${unknownInsulation === 1 ? ' trägt' : 'e tragen'} keine belastbare Dämmstärke. Für diese Leitungen ist keine Dämmung ausgewiesen; die Stärke ist an der Leitung nachzutragen.`,
      });
    }
  }

  // Steigstränge sind Objekte, keine Trassen — sie tragen keine Länge, aber
  // ihre Anzahl gehört trotzdem in die Bestellung.
  const risers = Object.values(doc.fixtures ?? {}).filter((f) => f.type === 'riser-heating');
  if (risers.length) {
    sheet.add({
      trade: 'rohr',
      name: FIXTURE_BY_TYPE['riser-heating']?.label ?? 'Steigstrang Heizung',
      spec: 'Bauart nach Objektangabe',
      quantity: risers.length,
      unit: 'Stk',
      origin: 'TGA-Objekte im Grundriss',
      remark: 'Der Strang ist als Objekt gesetzt; seine Länge steckt in den Leitungsabschnitten der Geschosse.',
    });
  }
}

// ===========================================================================
// 4 — Fußbodenheizung
// ===========================================================================

/**
 * Verteilergrößen, nach denen bestellt wird.
 *
 * Verteilerbalken gibt es nicht in beliebiger Abgangszahl. Die Staffel 4/8/12
 * ist keine Norm, sondern die in den Programmen der gängigen Anbieter durchweg
 * vorhandene Auswahl; zwölf Abgänge sind dort auch die übliche Obergrenze
 * eines Balkens. Wer nach einem Programm bestellt, das 2er- oder 10er-Balken
 * führt, ändert die Reihe hier — sie steht deshalb an einer Stelle.
 */
const MANIFOLD_SIZES: readonly number[] = [4, 8, 12];
const MANIFOLD_LARGEST = MANIFOLD_SIZES[MANIFOLD_SIZES.length - 1];

/** Verteiler für eine Abgangszahl: so wenige wie möglich, der Rest so klein wie möglich. */
function manifoldsFor(loops: number): number[] {
  const result: number[] = [];
  let rest = Math.max(0, Math.round(loops));
  while (rest > MANIFOLD_LARGEST) {
    result.push(MANIFOLD_LARGEST);
    rest -= MANIFOLD_LARGEST;
  }
  if (rest > 0) result.push(MANIFOLD_SIZES.find((s) => s >= rest) ?? MANIFOLD_LARGEST);
  return result;
}

/**
 * Ein Flächenheizkreis, gleich aus welcher Quelle.
 *
 * Die Auslegung liefert Rohrlänge, Dimension und Kreiszahl je Raum. Liegt
 * keine vor, bleibt das Anlagenblatt: dort stehen Kreiszahl und Kreislänge,
 * wenn sie einmal gerechnet wurden. Beide Wege sind zulässig, aber sie sagen
 * nicht dasselbe — deshalb trägt jeder seine eigene Herkunft mit.
 */
interface FloorSource {
  label: string;
  origin: string;
  /** Rohrlängen [m] je Werkstoff-und-Dimension-Bezeichnung. */
  pipe: { spec: string; length: number }[];
  /** Kreise, nach Verlegeabstand [m] getrennt. */
  loopsBySpacing: Map<number, number>;
  loops: number;
  /** Belegbare Fläche [m²]. */
  layableArea: number;
  /** Herkunft der Fläche, weil sie je nach Weg anders zustande kommt. */
  areaOrigin: string;
  roomIds: string[];
}

function floorSourceFromDesign(design: CircuitDesign): FloorSource {
  const rooms: RoomLoopDesign[] = design.rooms ?? [];
  const pipe = new Map<string, number>();
  const loopsBySpacing = new Map<number, number>();
  let area = 0;
  let loops = 0;

  const take = (dimension: string, length: number, spacing: number, count: number, roomArea: number): void => {
    pipe.set(dimension, (pipe.get(dimension) ?? 0) + length);
    loopsBySpacing.set(spacing, (loopsBySpacing.get(spacing) ?? 0) + count);
    loops += count;
    area += roomArea;
  };

  if (rooms.length) {
    // Raumweise, weil raumweise gebaut wird: Bad und Schlafzimmer bekommen
    // verschiedene Verlegeabstände und damit verschiedene Rohrmengen.
    for (const room of rooms) {
      const d = room.floor.dimension;
      take(
        `${PIPE_MATERIAL_LABELS[d.material]} ${d.label}`,
        room.floor.totalLength,
        room.floor.spacing,
        room.floor.loops,
        room.area,
      );
    }
  } else if (design.floor) {
    const d = design.floor.dimension;
    take(
      `${PIPE_MATERIAL_LABELS[d.material]} ${d.label}`,
      design.floor.totalLength,
      design.floor.spacing,
      design.floor.loops,
      design.floor.area,
    );
  }

  return {
    label: design.circuit.label,
    origin: rooms.length
      ? `Auslegung Fußbodenheizung, ${rooms.length} ${rooms.length === 1 ? 'Raum' : 'Räume'} im Kreis „${design.circuit.label}"`
      : `Auslegung Fußbodenheizung, Kreis „${design.circuit.label}" als Ganzes`,
    pipe: [...pipe.entries()].map(([label, length]) => ({ spec: label, length })),
    loopsBySpacing,
    loops,
    layableArea: area,
    areaOrigin: rooms.length
      ? `Belegbare Fläche der Räume aus der Auslegung, Kreis „${design.circuit.label}" (Grundfläche abzüglich Einbauten und Randstreifen)`
      : `Belegbare Fläche des Kreises „${design.circuit.label}" aus der Auslegung`,
    /*
     * Ohne raumweise Auslegung stehen die Räume trotzdem am Kreis — sonst
     * fiele der Randdämmstreifen stillschweigend aus der Liste, und genau das
     * soll dieses Modul nicht tun.
     */
    roomIds: rooms.length ? rooms.map((r) => r.roomId) : (design.circuit.roomIds ?? []),
  };
}

/**
 * Notbehelf ohne Auslegung: das, was im Anlagenblatt am Kreis steht.
 *
 * Ohne Dimension und ohne belegbare Fläche — beides kommt erst aus der
 * Auslegung. Was hier steht, ist Kreiszahl mal Kreislänge, und genau das sagt
 * die Herkunft auch. Die Grundfläche der Räume wird ungekürzt übernommen und
 * als solche gekennzeichnet; ein Belegungsabzug wäre an dieser Stelle geraten.
 */
function floorSourceFromSheet(doc: BimDocument, circuit: HeatingCircuit): FloorSource | undefined {
  const loops = circuit.loops ?? 0;
  const loopLength = circuit.loopLength ?? 0;
  if (!positive(loops) || !positive(loopLength)) return undefined;

  const rooms = circuit.roomIds.map((id) => doc.rooms?.[id]).filter((r): r is NonNullable<typeof r> => Boolean(r));
  const loopsBySpacing = new Map<number, number>([[circuit.spacing ?? 0, loops]]);

  return {
    label: circuit.label,
    origin: `Anlagenblatt, Kreis „${circuit.label}" (${loops} Kreise × ${num(loopLength, 1)} m)`,
    pipe: [{ spec: `${PIPE_MATERIAL_LABELS[circuit.material] ?? String(circuit.material)}, Dimension nicht ausgelegt`, length: loops * loopLength }],
    loopsBySpacing,
    loops,
    layableArea: rooms.reduce((s, r) => s + (isNumber(r.area) ? r.area : 0), 0),
    areaOrigin: `Raumgrundfläche aus der Raumerkennung, Kreis „${circuit.label}", ohne Belegungsabzug`,
    roomIds: circuit.roomIds ?? [],
  };
}

/** Liefert `true`, wenn die Flächenheizung aus einer Auslegung stammt. */
function collectFloorHeating(
  doc: BimDocument,
  plan: PlantDesignResult | undefined,
  sheet: Sheet,
  notes: MaterialNote[],
): boolean {
  const sources: FloorSource[] = [];

  if (plan) {
    for (const design of plan.circuits) {
      if (design.circuit.kind !== 'floor') continue;
      sources.push(floorSourceFromDesign(design));
    }
  } else {
    for (const circuit of Object.values(plantOf(doc).circuits ?? {})) {
      if (circuit.kind !== 'floor') continue;
      const source = floorSourceFromSheet(doc, circuit);
      if (source) {
        sources.push(source);
      } else {
        notes.push({
          severity: 'warn',
          text: `Kreis „${circuit.label}" ist als Flächenheizung angelegt, aber weder ausgelegt noch mit Kreiszahl und Kreislänge gepflegt. Rohr, Verteiler und Randdämmstreifen fehlen dafür.`,
        });
      }
    }
  }

  if (!sources.length) return false;

  for (const source of sources) {
    for (const pipe of source.pipe) {
      sheet.add({
        trade: 'fbh',
        name: 'Fußbodenheizrohr',
        spec: pipe.spec,
        quantity: pipe.length,
        unit: 'm',
        origin: source.origin,
        remark: 'Rohr in der Fläche einschließlich Anbindeleitungen zum Verteiler. Verschnitt nicht enthalten.',
      });
    }

    for (const [spacing, loops] of source.loopsBySpacing) {
      sheet.add({
        trade: 'fbh',
        name: 'Heizkreis am Verteiler',
        spec: positive(spacing) ? `Verlegeabstand ${num(spacing * 100, 0)} cm` : 'Verlegeabstand offen',
        quantity: loops,
        unit: 'Stk',
        origin: source.origin,
        remark: 'Je Kreis ein Abgang mit Durchflussmesser und Absperrung.',
      });
    }

    for (const size of manifoldsFor(source.loops)) {
      sheet.add({
        trade: 'fbh',
        name: `Heizkreisverteiler bis ${size} Abgänge`,
        spec: `${source.loops} Abgänge im Kreis „${source.label}"`,
        quantity: 1,
        unit: 'Stk',
        origin: source.origin,
        remark:
          source.loops > MANIFOLD_LARGEST
            ? 'Mehr als zwölf Abgänge: auf mehrere Verteiler aufgeteilt.'
            : undefined,
      });
    }

    if (source.layableArea > 0) {
      sheet.add({
        trade: 'fbh',
        name: 'Systemplatte oder Tackerbahn',
        spec: 'nach gewähltem Verlegesystem',
        quantity: source.layableArea,
        unit: 'm²',
        origin: source.areaOrigin,
        remark: 'Die Systemwahl steht nicht im Modell. Die Menge ist in beiden Fällen die belegbare Fläche.',
      });
    }

    /*
     * Randdämmstreifen aus dem lichten Raumumfang.
     *
     * Er läuft an jeder Wand des Raums entlang, also genau einmal um den Raum.
     * Türdurchgänge werden nicht abgezogen — der Streifen wird dort
     * durchgezogen, weil im Durchgang die Dehnfuge sitzt.
     */
    const perimeter = source.roomIds.reduce((s, id) => s + (doc.rooms?.[id]?.perimeter ?? 0), 0);
    if (perimeter > 0) {
      sheet.add({
        trade: 'fbh',
        name: 'Randdämmstreifen',
        spec: 'Höhe nach Estrichaufbau',
        quantity: perimeter,
        unit: 'm',
        // Der Kreis gehört in die Herkunft: ohne ihn tragen zwei Kreise mit
        // gleicher Raumzahl denselben Schlüssel, werden zusammengezählt und
        // die Zeile behauptet danach „1 Raum" über die Menge von zweien.
        origin: `Lichter Umfang von ${source.roomIds.length} ${source.roomIds.length === 1 ? 'Raum' : 'Räumen'} im Kreis „${source.label}"`,
        remark: 'Ohne Verschnitt und ohne Überlappung an den Stößen.',
      });
    } else if (source.roomIds.length) {
      notes.push({
        severity: 'warn',
        text: `Für den Kreis „${source.label}" ist kein Raumumfang bekannt. Der Randdämmstreifen fehlt in der Liste.`,
      });
    }
  }

  return true;
}

// ===========================================================================
// 5 — Heizflächen
// ===========================================================================

const RADIATOR_TYPES: readonly FixtureType[] = ['radiator', 'radiator-tube', 'towel-radiator', 'convector'];

function collectRadiators(doc: BimDocument, sheet: Sheet, notes: MaterialNote[]): void {
  const fixtures = Object.values(doc.fixtures ?? {});
  const radiators = fixtures.filter((f) => RADIATOR_TYPES.includes(f.type));

  let withoutPower = 0;
  for (const f of radiators) {
    const power = f.params?.powerW ?? 0;
    if (!positive(power)) withoutPower += 1;
    sheet.add({
      trade: 'heizflaeche',
      name: FIXTURE_BY_TYPE[f.type]?.label ?? f.type,
      spec: joinSpec(
        f.params?.radiatorType ? `Typ ${f.params.radiatorType}` : undefined,
        positive(f.length) ? `Baulänge ${num(f.length, 2)} m` : undefined,
        positive(power) ? `${num(power, 0)} W` : 'Leistung nicht angegeben',
        positive(f.params?.flowTemperature) && positive(f.params?.returnTemperature)
          ? `${num(f.params.flowTemperature, 0)}/${num(f.params.returnTemperature, 0)} °C`
          : undefined,
        /*
         * **Anschlussart und Ventilseite gehören in den Massenauszug.**
         *
         * Sie ändern keine Zahl in der Berechnung, aber sie ändern, *was
         * bestellt und wie angebunden wird*: Ein Mittelanschluss braucht
         * eine andere Garnitur als ein Seitenanschluss, und ob das Ventil
         * links oder rechts sitzt, entscheidet, auf welcher Seite die
         * Leitung hochkommt. Wer das erst auf der Baustelle merkt, hat den
         * Estrich schon geschlossen.
         *
         * Fehlt die Angabe, steht hier **nichts** — nicht etwa eine
         * Annahme. Eine geratene Seite ist auf dem Bestellzettel schlimmer
         * als eine fehlende: Die fehlende fragt jemand nach.
         */
        f.params?.radiatorConnection ? RADIATOR_CONNECTION_LABELS[f.params.radiatorConnection] : undefined,
        f.params?.valveSide ? VENTILSEITE_LABELS[f.params.valveSide] : undefined,
      ),
      quantity: 1,
      unit: 'Stk',
      origin: 'TGA-Objekte im Grundriss',
      remark: positive(power) ? undefined : 'Ohne Normwärmeleistung ist die Heizfläche nicht bestellbar.',
    });
  }

  if (withoutPower > 0) {
    notes.push({
      severity: 'error',
      text: `${withoutPower} Heizfläche${withoutPower === 1 ? '' : 'n'} ohne Normwärmeleistung. Diese Positionen sind nicht bestellbar — die Leistung ist am Objekt nachzutragen.`,
    });
  }

  if (radiators.length) {
    /*
     * Anschlussgarnitur je Heizfläche: ein Ventil und eine Verschraubung.
     * Bei Ventilheizkörpern steckt der Ventileinsatz schon im Körper, dann
     * bleibt nur der Thermostatkopf. Das Modell führt die Bauart nicht, also
     * steht die Einschränkung in der Bemerkung und nicht in einer Annahme.
     */
    sheet.add({
      trade: 'heizflaeche',
      name: 'Thermostatventil mit Kopf',
      spec: 'voreinstellbar, Anschluss nach Heizflächenbauart',
      quantity: radiators.length,
      unit: 'Stk',
      origin: `Je Heizfläche eine Garnitur (${radiators.length} Heizflächen im Grundriss)`,
      remark: 'Bei Ventilheizkörpern entfällt der Ventileinsatz; dann ist nur der Thermostatkopf zu bestellen.',
    });
    sheet.add({
      trade: 'heizflaeche',
      name: 'Rücklaufverschraubung',
      spec: 'absperr- und entleerbar',
      quantity: radiators.length,
      unit: 'Stk',
      origin: `Je Heizfläche eine Verschraubung (${radiators.length} Heizflächen im Grundriss)`,
    });
  }

  const thermostats = fixtures.filter((f) => f.type === 'thermostat');
  if (thermostats.length) {
    sheet.add({
      trade: 'heizflaeche',
      name: FIXTURE_BY_TYPE.thermostat?.label ?? 'Raumthermostat',
      spec: 'Einzelraumregelung',
      quantity: thermostats.length,
      unit: 'Stk',
      origin: 'TGA-Objekte im Grundriss',
    });
  }
}

// ===========================================================================
// 6 — Geräte und Speicher
// ===========================================================================

function collectDevices(
  doc: BimDocument,
  plan: PlantDesignResult | undefined,
  sheet: Sheet,
  notes: MaterialNote[],
): void {
  const plant = plantOf(doc);

  // --- Wärmeerzeuger -------------------------------------------------------
  // Das Gerät kommt aus der Auslegung, wenn eine vorliegt; sonst aus dem
  // Anlagenblatt, wo es festgelegt sein kann, ohne gerechnet worden zu sein.
  const model =
    plan?.selected?.model ?? (plant.generatorModelId ? findModel(plant.generatorModelId, plant.extraModels ?? []) : undefined);

  if (model) {
    const capacity = plan?.selected?.capacityAtDesign ?? model.nominalCapacity;
    sheet.add({
      trade: 'geraet',
      name: model.label,
      spec: joinSpec(
        positive(capacity) ? `${num(capacity, 1)} kW` : 'Leistung nicht angegeben',
        model.refrigerant,
        positive(model.refrigerantMass) ? `${num(model.refrigerantMass, 2)} kg Füllmenge` : undefined,
        model.hydraulicConnection,
      ),
      quantity: 1,
      unit: 'Stk',
      origin: plan?.selected
        ? 'Anlagenauslegung, Geräteauswahl nach der Leistung im Auslegungspunkt'
        : 'Anlagenblatt, festgelegtes Gerät',
      remark:
        model.provenance === 'generisch'
          ? 'Typklasse aus dem Katalog, kein Fabrikat. Vor der Bestellung durch ein Datenblatt ersetzen.'
          : model.manufacturer,
    });

    const backup = model.electric.backupHeater ?? model.indoor?.backupHeater ?? 0;
    if (positive(backup)) {
      sheet.add({
        trade: 'geraet',
        name: 'Elektro-Heizstab',
        spec: joinSpec(
          `${num(backup, 1)} kW`,
          `${model.electric.phases}-phasig`,
          positive(model.electric.fuse) ? `Absicherung ${num(model.electric.fuse, 0)} A` : undefined,
        ),
        quantity: 1,
        unit: 'Stk',
        origin: 'Gerätedaten des gewählten Wärmeerzeugers',
        remark: 'Im Gerät enthalten oder als Zubehör — beim Fabrikat prüfen.',
      });
    }
  } else {
    notes.push({ severity: 'warn', text: 'Es ist kein Wärmeerzeuger gewählt. Die Liste enthält kein Gerät.' });
  }

  // --- Speicher ------------------------------------------------------------
  const storages = new Map<string, { storage: PlantStorage; origin: string }>();
  for (const storage of Object.values(plant.storages ?? {})) {
    storages.set(storage.id, { storage, origin: 'Anlagenblatt, eingeplante Speicher' });
  }
  const proposed: [PlantStorage | undefined, string][] = [
    [plan?.buffer.selected, 'Anlagenauslegung, Puffervolumen aus Abtauung und Mindestlaufzeit'],
    [plan?.dhwStorage, 'Anlagenauslegung, Trinkwasserbedarf nach DIN 4708'],
  ];
  for (const [storage, origin] of proposed) {
    // Der Vorschlag kommt nur hinein, wenn derselbe Speicher nicht schon im
    // Anlagenblatt steht — sonst stünde er zweimal in der Bestellung.
    if (storage && !storages.has(storage.id)) storages.set(storage.id, { storage, origin });
  }

  for (const { storage, origin } of storages.values()) {
    sheet.add({
      trade: 'geraet',
      name: storage.label || STORAGE_KIND_LABELS[storage.kind] || String(storage.kind),
      spec: joinSpec(
        STORAGE_KIND_LABELS[storage.kind] ?? String(storage.kind),
        positive(storage.volume) ? `${num(storage.volume, 0)} l` : 'Inhalt offen',
      ),
      quantity: 1,
      unit: 'Stk',
      origin,
      remark: storage.suggested ? 'Vorschlag der Auslegung, noch nicht bestätigt.' : storage.note,
    });
    if (!positive(storage.volume)) {
      notes.push({
        severity: 'warn',
        text: `Speicher „${storage.label || STORAGE_KIND_LABELS[storage.kind] || 'ohne Bezeichnung'}" hat keinen Inhalt. Ohne Volumen ist er nicht bestellbar.`,
      });
    }
  }

  /*
   * Ein „Wärmeerzeuger"-Objekt im Grundriss ist ein zweites Gerät nur dann,
   * wenn gar keines aus der Anlage kommt. Sonst ist es dieselbe Maschine, nur
   * an ihrem Aufstellort gezeichnet.
   */
  if (!model) {
    const boilers = Object.values(doc.fixtures ?? {}).filter((f) => f.type === 'boiler');
    for (const f of boilers) {
      sheet.add({
        trade: 'geraet',
        name: FIXTURE_BY_TYPE.boiler?.label ?? 'Wärmeerzeuger',
        spec: positive(f.params?.powerW) ? `${num(f.params.powerW / 1000, 1)} kW` : 'Leistung nicht angegeben',
        quantity: 1,
        unit: 'Stk',
        origin: 'TGA-Objekt im Grundriss (keine Geräteauswahl vorhanden)',
      });
    }
  }
}

// ===========================================================================
// 7 — Armaturen: Sicherheitsliste und Anlagenschema ohne Doppelzählung
// ===========================================================================

/**
 * Bauteilarten, die zu den Geräten gehören und nicht zu den Armaturen.
 * Sie stehen bereits im Gewerk „Geräte und Speicher".
 */
const DEVICE_KINDS: ReadonlySet<SchematicKind> = new Set<SchematicKind>([
  'heatpump-outdoor',
  'heatpump-indoor',
  // Die Hydraulikstation ist ein Gerät, keine Armatur: sie wird als Einheit
  // bestellt, sie hat eine Typenbezeichnung, und sie kostet das Vielfache
  // eines Ventils. Stünde sie bei den Armaturen, fiele sie im Auszug nicht auf.
  'hydraulic-station',
  'cylinder',
  'buffer',
  'separator',
  'freshwater',
  'boiler',
  'electric-heater',
  'solar',
]);

/**
 * Bauteilarten der Wärmeübergabe. Ein „Heizkörper" im Schema steht für einen
 * ganzen Kreis, nicht für ein einzelnes Gerät; die Stückzahlen kommen aus dem
 * Grundriss und aus der Auslegung, wo sie tatsächlich stehen.
 */
const EMITTER_KINDS: ReadonlySet<SchematicKind> = new Set<SchematicKind>(['manifold', 'radiator', 'floor-loop']);

/**
 * Die Armaturen **an** der Wärmeübergabe — Thermostatventil und
 * Rücklaufverschraubung.
 *
 * Sie stehen seit 1.11.0 im Anlagenschema, und sie stehen zugleich im
 * Grundriss: der Rohrausleger setzt sie an jeden Heizkörper. Gezählt werden
 * sie **im Grundriss**, denn dort steht die richtige Stückzahl — das Schema
 * führt einen Heizkörper je *Kreis*, der Grundriss je *Heizfläche*. Vier
 * Heizkörper in zwei Kreisen brauchen vier Thermostatventile, nicht zwei.
 *
 * Dieselbe Regel wie bei den Heizflächen selbst, aus demselben Grund.
 */
const EMITTER_FITTING_KINDS: ReadonlySet<SchematicKind> = new Set<SchematicKind>([
  'valve-2way',
  'balancing-valve',
]);

/**
 * **Die Doppelzählungsregel.**
 *
 * Dieselbe Armatur kann aus zwei Quellen kommen:
 *  (a) `SafetyDesign.fittings` — die Pflichtarmaturen der Sicherheitsauslegung,
 *      mit Nennweite und Normbezug,
 *  (b) den Bauteilen des Anlagenschemas.
 *
 * Sie sind nicht unabhängig: `buildSchematic` zeichnet Sicherheitsventil,
 * Ausdehnungsgefäß, Manometer, Luft- und Schlammabscheider, Füllarmatur,
 * Systemtrenner, Wärmemengenzähler und Überströmventil aus **demselben**
 * Auslegungsergebnis, aus dem auch (a) stammt. Wer beide Listen addiert,
 * bestellt alles doppelt.
 *
 * Die Regel lautet deshalb:
 *
 *  1. Die Sicherheitsliste führt. Sie ist die genauere Quelle: sie nennt
 *     Nennweite, Ansprechdruck und die Norm, aus der die Pflicht folgt.
 *  2. Ein **erzeugtes** Schema-Bauteil (`generated === true`), dessen `kind`
 *     in der Sicherheitsliste vorkommt, ist dasselbe Teil und wird nicht
 *     gezählt.
 *  3. Ein **von Hand ergänztes** Bauteil (`generated === false`) wird immer
 *     gezählt. Wer es gesetzt hat, wollte ein zusätzliches Teil; steht seine
 *     Art auch in der Sicherheitsliste, sagt das die Bemerkung.
 *  4. Bauteilarten, die die Sicherheitsliste nicht kennt — Umwälzpumpe,
 *     Umschaltventil, Mischer, Verbrühschutz, Zirkulationspumpe — kommen
 *     ausschließlich aus dem Schema.
 *
 * **Warum die Bauteilart und nicht der Name.** Die Sicherheitsliste schreibt
 * „Sicherheitsventil Heizung", das Schema „Sicherheitsventil"; die eine
 * technische Angabe lautet „DN 20 (R ¾), Ansprechdruck 3,0 bar …", die andere
 * „DN 20 · 3,0 bar". Name und Angabe sind Fließtext aus zwei Federn und taugen
 * nicht als Identität. `SchematicKind` dagegen ist ein geschlossenes
 * Vokabular, das beide Seiten benutzen — und `buildSchematic` setzt genau die
 * Art, die die Sicherheitsauslegung vorher vergeben hat.
 *
 * **Grenzfall zwei gleiche Arten.** Die Sicherheitsliste enthält zweimal
 * `filling-valve` (Entleerung am tiefsten Punkt und Füll-/Entleerarmatur) und
 * zweimal `shutoff`. Beide bleiben als eigene Positionen erhalten — die Regel
 * unterdrückt das Schema-Bauteil, niemals eine Sicherheitsposition.
 *
 * **Grenzfall Mengenangabe im Text.** Eine Sicherheitsposition kann mehrere
 * Stücke meinen („2 × DN 32, Vorlauf und Rücklauf"). Gezählt wird trotzdem
 * eine Position mit der Menge 1, weil die Stückzahl dort nur im Fließtext
 * steht und nicht als Zahl. Die technische Angabe trägt sie mit.
 */
const SAFETY_LEADS = true;

function collectFittings(
  doc: BimDocument,
  plan: PlantDesignResult | undefined,
  sheet: Sheet,
  notes: MaterialNote[],
): void {
  const plant = plantOf(doc);
  const safety = plan?.safety;

  const covered = new Set<SchematicKind>();
  if (safety && SAFETY_LEADS) {
    for (const fitting of safety.fittings) {
      covered.add(fitting.kind);
      sheet.add({
        trade: 'armatur',
        name: fitting.label,
        spec: fitting.spec,
        quantity: 1,
        unit: 'Stk',
        origin: 'Sicherheitsauslegung der Anlage (Pflichtarmatur)',
        remark: `Grundlage: ${fitting.norm}`,
      });
    }
  } else {
    notes.push({
      severity: 'warn',
      text: 'Es liegt keine Sicherheitsauslegung vor. Sicherheitsventil, Ausdehnungsgefäß und die übrigen Pflichtarmaturen nach DIN EN 12828 fehlen in der Liste.',
    });
  }

  /*
   * Woher die Schema-Bauteile kommen. Ein gespeichertes Schema hat Vorrang —
   * dort steckt die Entscheidung des Planers, auch dann, wenn er nur ein
   * Bauteil verschoben hat. Ist keines gespeichert, wird das Schema aus der
   * Auslegung erzeugt; es enthält dieselben Bauteile, die die Ansicht zeichnen
   * würde.
   */
  const stored = Object.values(plant.schematic?.components ?? {});
  const components: SchematicComponent[] = stored.length ? stored : plan ? buildSchematic(plan).components : [];

  if (!components.length) {
    if (plan) {
      notes.push({
        severity: 'info',
        text: 'Das Anlagenschema ist leer. Betriebsarmaturen wie Umwälzpumpe und Umschaltventil fehlen in der Liste.',
      });
    }
    // Ohne Schema bleibt wenigstens die ausgelegte Umwälzpumpe.
    if (plan?.pump) {
      sheet.add({
        trade: 'armatur',
        name: 'Umwälzpumpe',
        spec: `${num(plan.pump.flow, 2)} m³/h · ${num(plan.pump.head, 1)} m Förderhöhe`, // eigene Zahlen, deshalb schon mit Komma
        quantity: 1,
        unit: 'Stk',
        origin: 'Anlagenauslegung, Pumpenauslegung aus dem ungünstigsten Strang',
      });
    }
    return;
  }

  /*
   * Knoten sind Zeichenhilfen, keine Bauteile. Bauteilarten, die die
   * Symbolbibliothek nicht kennt, fliegen ebenfalls heraus: ein gespeichertes
   * Schema kann aus einer älteren Fassung stammen, und `buildComponentTable`
   * holt sich den Namen unbesehen aus `SCHEMATIC_LEGEND`. Weggelassen wird so
   * ein Bauteil nicht stillschweigend — es steht als Hinweis in der Liste.
   */
  const known = components.filter((c) => Boolean(SCHEMATIC_LEGEND[c.kind]));
  if (known.length < components.length) {
    notes.push({
      severity: 'warn',
      text: `${components.length - known.length} Bauteil${components.length - known.length === 1 ? '' : 'e'} des Anlagenschemas hat eine unbekannte Bauteilart und fehlt in der Liste.`,
    });
  }
  const relevant = known.filter((c) => c.kind !== 'node');
  const isFitting = (c: SchematicComponent): boolean =>
    !DEVICE_KINDS.has(c.kind) && !EMITTER_KINDS.has(c.kind) && !EMITTER_FITTING_KINDS.has(c.kind);

  const generated = relevant.filter((c) => c.generated && isFitting(c) && !covered.has(c.kind));
  const manual = relevant.filter((c) => !c.generated && isFitting(c));

  const push = (rows: readonly ComponentTableRow[], fromManual: boolean): void => {
    for (const row of rows) {
      sheet.add({
        trade: 'armatur',
        name: row.name,
        spec: germanDecimals(row.spec),
        quantity: row.count,
        unit: 'Stk',
        origin: fromManual
          ? 'Anlagenschema, von Hand ergänzte Bauteile'
          : 'Anlagenschema, aus der Auslegung erzeugte Bauteile',
        remark:
          fromManual && covered.has(row.kind)
            ? `Zusätzlich zur Sicherheitsliste von Hand gesetzt${row.labels.length ? ` (${row.labels.join(', ')})` : ''}.`
            : row.labels.length
              ? `Anlagenkennzeichen: ${row.labels.join(', ')}`
              : undefined,
      });
    }
  };

  // `buildComponentTable` fasst nach Bauteilart und technischer Angabe
  // zusammen — dieselbe Regel wie in der Stückliste des Schemablatts, damit
  // beide Listen dieselben Positionen zeigen.
  push(buildComponentTable(generated), false);
  push(buildComponentTable(manual), true);

  /*
   * Geräte und Wärmeübergabe, die jemand von Hand ins Schema gesetzt hat,
   * gehen nicht verloren — sie landen in ihrem eigenen Gewerk. Die erzeugten
   * Gegenstücke bleiben draußen, weil sie schon aus der Auslegung kommen.
   */
  const manualDevices = relevant.filter((c) => !c.generated && !isFitting(c));
  for (const row of buildComponentTable(manualDevices)) {
    sheet.add({
      trade: DEVICE_KINDS.has(row.kind) ? 'geraet' : row.kind === 'radiator' ? 'heizflaeche' : 'fbh',
      name: row.name || SCHEMATIC_LEGEND[row.kind]?.name || String(row.kind),
      spec: germanDecimals(row.spec),
      quantity: row.count,
      unit: 'Stk',
      origin: 'Anlagenschema, von Hand ergänzte Bauteile',
      remark: 'Von Hand im Schema gesetzt und in keiner Auslegung enthalten — vor der Bestellung prüfen.',
    });
  }
}

// ===========================================================================
// 8 — Sanitär und Lüftung
// ===========================================================================

/** Technische Angabe eines Sanitär- oder Lüftungsobjekts aus seinen Kennwerten. */
function fixtureSpec(f: Fixture): string {
  return joinSpec(
    f.params?.connection,
    positive(f.params?.airflow) ? `${num(f.params.airflow, 0)} m³/h` : undefined,
    positive(f.params?.powerW) ? `${num(f.params.powerW, 0)} W` : undefined,
    f.params?.hotWater ? 'mit Warmwasseranschluss' : undefined,
  );
}

function collectSanitaryAndVentilation(doc: BimDocument, sheet: Sheet, notes: MaterialNote[]): void {
  for (const f of Object.values(doc.fixtures ?? {})) {
    if (f.category !== 'sanitary' && f.category !== 'ventilation') continue;
    const name = FIXTURE_BY_TYPE[f.type]?.label ?? f.type;
    const trade: MaterialTrade = f.category === 'sanitary' ? 'sanitaer' : 'lueftung';

    // Die Kanaltrasse ist das einzige Objekt mit einer Länge statt einer
    // Stückzahl — sie wird in Metern bestellt wie eine Leitung.
    if (f.type === 'duct') {
      /*
       * Ohne belastbare Baulänge fiele die Zeile in `Sheet.add` heraus und der
       * gezeichnete Kanal verschwände wortlos aus der Bestellung. Genau das
       * schließt dieses Modul aus: eine Lücke wird gemeldet, nicht überspielt.
       * Gemeldet wird mit Bezeichnung und Kennung, damit der Kanal im Modell
       * wiederzufinden ist.
       */
      if (!positive(f.length)) {
        notes.push({
          severity: 'warn',
          text: `Kanaltrasse ${f.label ? `„${f.label}" ` : ''}(${f.id}) hat keine belastbare Baulänge. Der Kanal fehlt in der Liste; die Länge ist am Objekt nachzutragen.`,
        });
        continue;
      }
      sheet.add({
        trade,
        name,
        spec: fixtureSpec(f) || 'Querschnitt nach Objektangabe',
        quantity: f.length,
        unit: 'm',
        origin: 'TGA-Objekte im Grundriss, Baulänge der Kanalabschnitte',
        remark: 'Formteile und Aufhängung nicht enthalten.',
      });
      continue;
    }

    sheet.add({
      trade,
      name,
      spec: fixtureSpec(f),
      quantity: 1,
      unit: 'Stk',
      origin: 'TGA-Objekte im Grundriss, je Bauart gezählt',
    });
  }
}

// ===========================================================================
// 9 — Bauteile für das Leistungsverzeichnis
// ===========================================================================

const WALL_TYPE_LABELS: Record<WallType, string> = {
  exterior: 'Außenwand',
  interior: 'Innenwand',
  partition: 'Trennwand',
  shaft: 'Schacht',
};

const OPENING_KIND_LABELS: Record<Opening['kind'], string> = {
  door: 'Tür',
  window: 'Fenster',
  passage: 'Durchgang',
};

/**
 * Der U-Wert als technische Angabe — **mit Vorbehalt, wo einer nötig ist**.
 *
 * Bis 1.23.0 stand hier `wall.uValue ?? construction?.uValue`, also die
 * **umgekehrte** Rangfolge gegenüber Export, Heizlast und Prüfbericht. Das war
 * keine Geschmacksfrage: Eine Wand mit dem Aufbau „AW 36,5 + WDVS" (0,21) und
 * einem alten Eintrag 1,10 am Bauteil stand im Export mit U = 0,21 und in der
 * Stückliste mit U = 1,10 — beides gedruckt, beides mit demselben Anspruch,
 * und kein Hinweis darauf, welche der beiden Zahlen gilt. Wer daraufhin
 * ausschreibt, schreibt die falsche Wand aus. Die Rangfolge kommt deshalb aus
 * `uwert.ts` und steht damit nur noch an einer Stelle.
 *
 * Der zweite Teil ist genauso wichtig: Ein **Vorgabewert nach Bauteilart** ist
 * eine Annahme des Programms und keine Eigenschaft des Bauteils. Ihn ohne
 * Zusatz neben eine erfasste Zahl zu drucken hieße, dem Leser die Auskunft zu
 * nehmen, an der er entscheidet, ob er der Zahl folgen darf — und eine
 * Nachweismenge fürs Leistungsverzeichnis ist genau der Ort, an dem das
 * auffallen muss. Fehlt der U-Wert ganz, steht gar keine Angabe da; ein
 * Strich wäre eine Zahl, die es nicht gibt.
 */
const uWertAngabe = (a: UWertAuskunft): string | undefined => {
  if (!positive(a.wert)) return undefined;
  const zahl = `U = ${num(a.wert, 2)} W/(m²·K)`;
  return a.herkunft === 'katalog' ? `${zahl} (${herkunftText(a)})` : zahl;
};

/** Bauteilaufbauten des Dokuments, ergänzt um den Startkatalog. */
function constructionIndex(doc: BimDocument): Map<string, Construction> {
  const map = new Map<string, Construction>();
  for (const c of DEFAULT_CONSTRUCTIONS) map.set(c.id, c);
  for (const c of Object.values(doc.constructions ?? {})) map.set(c.id, c);
  return map;
}

/**
 * Bauteile sind keine Bestellpositionen — sie stehen hier, damit die Liste als
 * Grundlage für ein Leistungsverzeichnis taugt. Ein Auszug, der die Anlage
 * kennt und das Gebäude nicht, ist für die Ausschreibung nur die halbe Arbeit.
 */
/**
 * Durchbrüche und Schottungen.
 *
 * Gruppiert wird nach dem, wonach bestellt und abgerechnet wird: Art, lichtes
 * Maß und Brandschutzklasse. Zwei Kernbohrungen Ø 152 in derselben Klasse sind
 * eine Position mit Menge 2 — das erledigt der Gruppierungsschlüssel des
 * Blatts von selbst, sobald `name` und `spec` gleich sind.
 *
 * Die Schottung steht als **eigene** Position daneben und nicht als Zusatz in
 * der Bemerkung. Grund: die Bohrung macht der Rohbau, die Schottung der
 * Brandschützer, und die beiden schreiben getrennte Rechnungen. Eine Zeile,
 * die beides enthält, lässt sich nicht aufteilen, ohne sie neu zu schreiben.
 */
function collectDurchbrueche(doc: BimDocument, sheet: Sheet, notes: MaterialNote[]): void {
  const durchbrueche = Object.values(doc.durchbrueche ?? {});
  if (!durchbrueche.length) return;

  let geschottet = 0;
  for (const d of durchbrueche) {
    const mass =
      d.form === 'rund'
        ? `Ø ${num((d.diameter ?? 0) * 1000, 0)} mm`
        : `${num((d.width ?? 0) * 1000, 0)} × ${num((d.height ?? 0) * 1000, 0)} mm`;
    const klasse = d.brandschutz && d.brandschutz !== 'keine' ? d.brandschutz : undefined;
    sheet.add({
      trade: 'durchbruch',
      name: DURCHBRUCH_LABELS[d.kind],
      spec: joinSpec(
        mass,
        d.service ? SHAFT_SERVICE_LABELS[d.service] : undefined,
        d.dn !== undefined ? `DN ${num(d.dn, 0)}` : undefined,
        klasse ? BRANDSCHUTZ_LABELS[klasse] : undefined,
      ),
      quantity: 1,
      unit: 'Stk',
      origin: 'Durchbrüche im Grundriss, nach Maß und Brandschutzklasse gruppiert',
      remark: d.note,
    });
    if (klasse) {
      geschottet++;
      sheet.add({
        trade: 'durchbruch',
        name: 'Brandschott',
        spec: joinSpec(BRANDSCHUTZ_LABELS[klasse], mass),
        quantity: 1,
        unit: 'Stk',
        origin: 'Brandschutzanforderung der Durchbrüche',
        remark: 'Bauart nach Zulassung des Ausführenden — hier steht die Anforderung, nicht das Produkt.',
      });
    }
  }

  notes.push({
    severity: 'info',
    text:
      `${durchbrueche.length} Durchbrüche im Modell, davon ${geschottet} mit Brandschutzanforderung. ` +
      'Die Maße sind lichte Maße. Ob die angegebene Bohrkrone reicht, hängt an der Dämmstärke der ' +
      'durchgeführten Leitung — bei Vollmaßdämmung ist die nächstgrößere anzusetzen. Eine Kernbohrung ' +
      'in einer tragenden Wand ist nachweispflichtig; dieser Auszug erbringt den Nachweis nicht.',
  });
}

function collectBuildingParts(doc: BimDocument, sheet: Sheet, notes: MaterialNote[]): void {
  const constructions = constructionIndex(doc);
  /*
   * Derselbe Katalog noch einmal als Record — `uwert.ts` kennt nur diese
   * Form, und sie muss die Vorgabeaufbauten mit enthalten. Würde hier bloß
   * `doc.constructions` übergeben, sähe die Stückliste einen Aufbau
   * `c-aw-wdvs` nicht, den der Export über `constructionIndex` sehr wohl
   * kennt — und wir hätten die beiden Zahlen wieder, nur an anderer Stelle.
   */
  const aufbauten: Record<string, Construction> = Object.fromEntries(constructions);
  const openings = Object.values(doc.openings ?? {});
  const walls = Object.values(doc.walls ?? {});
  const LV_REMARK = 'Nachweismenge für das Leistungsverzeichnis, keine Bestellposition.';

  // --- Fenster und Türen nach Größe ---------------------------------------
  for (const o of openings) {
    const construction = o.constructionId ? constructions.get(o.constructionId) : undefined;
    sheet.add({
      trade: 'bauteil',
      name: OPENING_KIND_LABELS[o.kind] ?? 'Öffnung',
      // In Zentimeter, weil Fenster- und Türlisten so geschrieben werden.
      spec: joinSpec(
        positive(o.width) && positive(o.height)
          ? `${num(o.width * 100, 1)} × ${num(o.height * 100, 1)} cm`
          : 'Rohbaumaß nicht angegeben',
        positive(o.sillHeight) ? `Brüstung ${num(o.sillHeight * 100, 0)} cm` : undefined,
        construction?.name,
        // Dieselbe Rangfolge wie bei der Wand darunter und aus demselben
        // Grund: Ein Fenster mit dem Aufbau „Fenster 3-fach" (0,90) und einem
        // stehen gebliebenen Wert 1,40 am Bauteil stand hier mit 1,40 und im
        // Export mit 0,90 — dieselbe Öffnung in zwei Papieren mit zwei
        // U-Werten, und der Ausschreibende muss raten, welcher gilt.
        uWertAngabe(uWertOeffnung(o, aufbauten)),
      ),
      quantity: 1,
      unit: 'Stk',
      origin: 'Öffnungen im Grundriss, nach Rohbaumaß gruppiert',
      remark: LV_REMARK,
    });
  }

  // --- Wandflächen je Bauteilaufbau ---------------------------------------
  const openingAreaByWall = new Map<string, number>();
  for (const o of openings) {
    const area = o.width * o.height;
    if (!isNumber(area)) continue;
    openingAreaByWall.set(o.wallId, (openingAreaByWall.get(o.wallId) ?? 0) + area);
  }

  let withoutConstruction = 0;
  for (const wall of walls) {
    const a = doc.nodes?.[wall.a];
    const b = doc.nodes?.[wall.b];
    if (!a || !b) continue;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    /*
     * Achsfläche abzüglich der Öffnungen. Gemessen wird über die Wandachse,
     * weil das die Länge ist, die im Leistungsverzeichnis steht; die lichte
     * Länge hinge davon ab, wie die Ecken aufgelöst werden, und wäre zwischen
     * zwei Auszügen desselben Gebäudes nicht mehr vergleichbar.
     */
    const net = length * wall.height - (openingAreaByWall.get(wall.id) ?? 0);
    if (net <= 0) continue;

    const construction = wall.constructionId ? constructions.get(wall.constructionId) : undefined;
    if (!construction) withoutConstruction += 1;

    sheet.add({
      trade: 'bauteil',
      name: construction ? construction.name : `${WALL_TYPE_LABELS[wall.type] ?? 'Wand'}, Aufbau nicht zugewiesen`,
      spec: joinSpec(
        positive(wall.thickness) ? `${num(wall.thickness * 100, 1)} cm dick` : 'Wandstärke nicht angegeben',
        construction?.layers,
        uWertAngabe(uWertWand(wall, aufbauten)),
      ),
      quantity: net,
      unit: 'm²',
      origin: 'Wände aller Geschosse, Achsfläche abzüglich Öffnungen',
      remark: LV_REMARK,
    });
  }

  /*
   * --- Bodenbeläge ---------------------------------------------------------
   *
   * Sie fehlten bis 1.25.0 vollständig. Ein Auszug, der jede Schraubverbindung
   * am Rohrnetz führt, aber nicht sagt, wie viel Quadratmeter Fliese zu legen
   * sind, ist für den Bau die halbe Liste. Gemessen wird die lichte Fläche des
   * Raums — das ist die Fläche, die verlegt wird; ein Verschnittzuschlag steht
   * hier bewusst nicht, den setzt der Verleger nach seinem Verlegemuster.
   *
   * Räume ohne erfassten Belag erscheinen nicht als Position, sondern als
   * Hinweis. Eine Position „Belag unbekannt, 42 m²" sähe im Ausdruck wie eine
   * Menge aus und wäre keine.
   */
  let ohneBelag = 0;
  for (const room of Object.values(doc.rooms ?? {})) {
    if (!positive(room.area)) continue;
    const belag = belagNach(room.floorCovering);
    if (!belag) {
      ohneBelag += 1;
      continue;
    }
    sheet.add({
      trade: 'bauteil',
      name: `Bodenbelag ${belag.name}`,
      spec: joinSpec(
        `R λB ${num(belag.wert, 2)} m²K/W`,
        belag.wert > BELAG_GRENZE ? 'über der Grenze aus DIN EN 1264-3' : undefined,
      ),
      quantity: room.area,
      unit: 'm²',
      origin: `Lichte Fläche „${room.name}"`,
      remark: LV_REMARK,
    });
  }
  if (ohneBelag > 0) {
    notes.push({
      severity: 'info',
      text: `${ohneBelag} ${ohneBelag === 1 ? 'Raum trägt' : 'Räume tragen'} keinen erfassten Bodenbelag. Diese Flächen fehlen im Auszug — der Belag steht im Inspektor beim Raum.`,
    });
  }

  if (withoutConstruction > 0) {
    notes.push({
      severity: 'info',
      text: `${withoutConstruction} ${withoutConstruction === 1 ? 'Wand steht' : 'Wände stehen'} ohne zugewiesenen Bauteilaufbau. Diese Flächen sind nach Wandart geführt statt nach Aufbau.`,
    });
  }
}

// ===========================================================================
// 10 — Zusammenbau
// ===========================================================================

/**
 * Gruppen bilden, sortieren, durchnummerieren.
 *
 * Sortiert wird nach Gewerk in der Reihenfolge des Bauablaufs, innerhalb des
 * Gewerks nach Bezeichnung mit deutscher Kollation — sonst landet „Öltank"
 * hinter „Zirkulationspumpe". Die laufende Nummer läuft über die ganze Liste
 * durch und nicht je Gewerk neu, damit eine Position eindeutig zitierbar ist.
 */
function assemble(drafts: readonly Draft[]): { groups: MaterialGroup[]; items: MaterialItem[] } {
  const items: MaterialItem[] = [];
  const groups: MaterialGroup[] = [];

  for (const trade of TRADE_ORDER) {
    const rows = drafts
      .filter((d) => d.trade === trade)
      .sort((a, b) => a.name.localeCompare(b.name, 'de') || a.spec.localeCompare(b.spec, 'de'));
    if (!rows.length) continue;

    const groupItems: MaterialItem[] = [];
    for (const row of rows) {
      const item: MaterialItem = {
        position: items.length + 1,
        trade: row.trade,
        tradeLabel: MATERIAL_TRADE_LABELS[row.trade],
        name: row.name,
        spec: row.spec,
        quantity: row.quantity,
        unit: row.unit,
        origin: row.origin,
        remark: row.remark,
      };
      items.push(item);
      groupItems.push(item);
    }

    const byUnit = new Map<MaterialUnit, number>();
    for (const item of groupItems) byUnit.set(item.unit, round2((byUnit.get(item.unit) ?? 0) + item.quantity));
    const totals = UNIT_ORDER.filter((u) => byUnit.has(u)).map((unit) => ({ unit, quantity: byUnit.get(unit) ?? 0 }));

    groups.push({
      trade,
      label: MATERIAL_TRADE_LABELS[trade],
      items: groupItems,
      itemCount: groupItems.length,
      totals,
      summary: [
        `${groupItems.length} ${groupItems.length === 1 ? 'Position' : 'Positionen'}`,
        ...totals.map((t) => `${quantityText(t.quantity, t.unit)} ${t.unit}`),
      ].join(' · '),
    });
  }

  return { groups, items };
}

/**
 * Massen- und Materialauszug über ein ganzes Projekt.
 *
 * `plan` ist die Anlagenauslegung. Ohne sie bleibt die Liste ein reiner
 * Grundrissauszug: Leitungen, Heizflächen, Sanitär, Lüftung und Bauteile
 * kommen aus dem Dokument, Fußbodenheizung, Geräte und Sicherheitsarmaturen
 * fehlen. Das ist zulässig — es steht dann als Hinweis in `notes` und nicht
 * als stille Lücke in der Bestellung.
 *
 * Ein leeres Dokument, ein Dokument ohne Anlagenblatt und ein Dokument ohne
 * Leitungen liefern jeweils eine gültige, nur eben magere Liste. Nichts davon
 * ist ein Fehlerfall im Sinne einer Ausnahme; es sind die Zustände, in denen
 * ein Projekt die meiste Zeit ist.
 */
export function buildMaterialSchedule(doc: BimDocument, plan?: PlantDesignResult): MaterialSchedule {
  const notes: MaterialNote[] = [];
  const sheet = new Sheet();

  const walls = Object.values(doc.walls ?? {});
  const fixtures = Object.values(doc.fixtures ?? {});
  const pipes = Object.values(doc.pipes ?? {});
  const openings = Object.values(doc.openings ?? {});
  const empty = !walls.length && !fixtures.length && !pipes.length && !openings.length;

  if (!doc.plant) {
    notes.push({
      severity: 'info',
      text: 'Das Dokument hat kein Anlagenblatt. Für Speicher, Heizkreise und Sicherheitstechnik gelten die Vorbelegungen; ausgelegt ist davon nichts.',
    });
  }

  if (!plan) {
    notes.push({
      severity: 'warn',
      text: 'Es wurde keine Anlagenauslegung übergeben. Gerät, Speicher, Pumpe und die Pflichtarmaturen nach DIN EN 12828 stehen nicht in der Liste.',
    });
  }

  collectPipes(doc, sheet, notes);
  const hasFloorDesign = collectFloorHeating(doc, plan, sheet, notes);

  /*
   * FBH-Objekte im Grundriss zählen nur, solange keine Auslegung da ist.
   * Sonst stünde derselbe Kreis zweimal: einmal als gesetztes Objekt und
   * einmal als ausgelegter Kreis mit Rohrlänge und Verteilerabgang.
   */
  if (!hasFloorDesign) {
    const loops = fixtures.filter((f) => f.type === 'underfloor');
    const manifolds = fixtures.filter((f) => f.type === 'manifold');
    if (loops.length) {
      sheet.add({
        trade: 'fbh',
        name: FIXTURE_BY_TYPE.underfloor?.label ?? 'FBH-Heizkreis',
        spec: 'Bauart nach Objektangabe, nicht ausgelegt',
        // Ein raumfüllendes FBH-Objekt steht für die Kreise seines Raums,
        // nicht für einen einzelnen. Die Zahl liegt am Objekt (`loopCount`);
        // ein von Hand gesetztes Einzelsymbol trägt sie nicht und zählt
        // deshalb wie bisher als ein Kreis.
        quantity: loops.reduce((sum, f) => sum + (f.params.loopCount ?? 1), 0),
        unit: 'Stk',
        origin: 'TGA-Objekte im Grundriss (keine Auslegung der Flächenheizung vorhanden)',
        remark: 'Ohne Auslegung fehlen Rohrlänge, Verlegeabstand und Randdämmstreifen.',
      });
    }
    if (manifolds.length) {
      sheet.add({
        trade: 'fbh',
        name: FIXTURE_BY_TYPE.manifold?.label ?? 'Heizkreisverteiler',
        spec: 'Abgangszahl nicht ausgelegt',
        quantity: manifolds.length,
        unit: 'Stk',
        origin: 'TGA-Objekte im Grundriss (keine Auslegung der Flächenheizung vorhanden)',
      });
    }
    if (loops.length || manifolds.length) {
      notes.push({
        severity: 'warn',
        text: 'Die Flächenheizung ist nicht ausgelegt. Gezählt sind nur die gesetzten Objekte — Rohrmenge, Verteilergröße, Systemplatten und Randdämmstreifen fehlen.',
      });
    }
  }

  collectRadiators(doc, sheet, notes);
  collectDevices(doc, plan, sheet, notes);
  collectFittings(doc, plan, sheet, notes);
  collectSanitaryAndVentilation(doc, sheet, notes);
  collectDurchbrueche(doc, sheet, notes);
  collectBuildingParts(doc, sheet, notes);

  const { groups, items } = assemble(sheet.all());

  /*
   * Der Befund „leer" wird erst hier gestellt, nicht vorab am Grundriss. Ein
   * Dokument ohne Wände, Öffnungen, Leitungen und Objekte kann über sein
   * Anlagenblatt trotzdem eine Flächenheizung führen — dann ist die Liste
   * nicht leer, und ein Fehlerhinweis „es gibt nichts zu ermitteln" stünde
   * über einer Liste mit tausend Metern Rohr.
   */
  if (empty && !items.length) {
    notes.push({
      severity: 'error',
      text: 'Das Dokument enthält weder Wände noch Öffnungen, Leitungen oder TGA-Objekte. Es gibt nichts zu ermitteln.',
    });
  } else if (empty) {
    notes.push({
      severity: 'warn',
      text: 'Das Dokument enthält weder Wände noch Öffnungen, Leitungen oder TGA-Objekte. Die Liste stammt allein aus dem Anlagenblatt und der Auslegung; alles, was aus dem Grundriss käme, fehlt.',
    });
  } else if (!items.length) {
    notes.push({
      severity: 'error',
      text: 'Es ließ sich keine einzige Position ermitteln, obwohl das Dokument Inhalt hat. Das deutet auf unvollständige Bauteildaten hin.',
    });
  }

  notes.push({
    severity: 'info',
    text: 'Die Liste führt Mengen, keine Preise. Verschnitt, Befestigung, Kleinteile und Montagezeit sind nicht enthalten und in der Kalkulation zuzuschlagen.',
  });

  return {
    projectName: doc.meta?.name ?? 'Ohne Titel',
    groups,
    items,
    positionCount: items.length,
    notes,
  };
}

// ===========================================================================
// 11 — CSV
// ===========================================================================

/**
 * Zelle nach den Regeln von `componentTableCsv`: quoten nur, wenn nötig.
 * Ein Unterschied ist Absicht: der einzelne Wagenrücklauf löst hier ebenfalls
 * das Quoting aus. Zeilenende der Datei ist CR/LF; ein CR im Feld — ein
 * Projektname aus einer Windows-Zwischenablage genügt — würde eine Zeile
 * sonst mitten im Feld beenden.
 */
const cell = (value: string): string => (/[";\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

const SEVERITY_LABELS: Record<MaterialNote['severity'], string> = {
  info: 'Hinweis',
  warn: 'Warnung',
  error: 'Fehler',
};

/**
 * Der Materialauszug als CSV.
 *
 * Aufbau: die Positionstabelle, danach die Zusammenfassung je Gewerk, danach
 * die Hinweise — durch Leerzeilen getrennt. Der Hinweisblock ist kein Beiwerk:
 * wer die Datei bekommt, muss sehen, was in der Liste *fehlt*, und nicht nur,
 * was darin steht.
 *
 * Zahlen tragen Dezimalkomma, Trenner ist das Semikolon, am Anfang steht ein
 * BOM (U+FEFF). Das ist die Kombination, mit der das deutsche Excel die Datei
 * ohne Importdialog richtig öffnet.
 */
export function materialScheduleCsv(schedule: MaterialSchedule): string {
  const lines: string[] = ['Pos;Gewerk;Bezeichnung;Technische Angabe;Menge;Einheit;Herkunft;Bemerkung'];

  for (const item of schedule.items) {
    lines.push(
      [
        String(item.position),
        cell(item.tradeLabel),
        cell(item.name),
        cell(item.spec),
        cell(quantityText(item.quantity, item.unit)),
        cell(item.unit),
        cell(item.origin),
        cell(item.remark ?? ''),
      ].join(';'),
    );
  }

  lines.push('');
  lines.push('Zusammenfassung;Positionen;Mengen');
  for (const group of schedule.groups) {
    lines.push(
      [
        cell(group.label),
        String(group.itemCount),
        cell(group.totals.map((t) => `${quantityText(t.quantity, t.unit)} ${t.unit}`).join(', ')),
      ].join(';'),
    );
  }

  lines.push('');
  lines.push('Hinweis;Text');
  for (const note of schedule.notes) {
    lines.push([cell(SEVERITY_LABELS[note.severity]), cell(note.text)].join(';'));
  }

  return `﻿${lines.join('\r\n')}`;
}
