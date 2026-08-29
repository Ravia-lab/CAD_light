/**
 * Datenblätter einlesen — von der Typklasse zum belastbaren Gerät.
 * ---------------------------------------------------------------------------
 * Der Gerätekatalog in `deviceCatalog.ts` enthält bewusst nur Typklassen
 * (`provenance: 'generisch'`). Das reicht, um vorzudimensionieren, und es ist
 * ehrlich: keine Zahl darin behauptet, aus einem Prospekt zu stammen. Sobald
 * aber ein Datenblatt auf dem Tisch liegt, gehört es ins Programm — und zwar
 * vollständig, nicht Feld für Feld von Hand abgetippt.
 *
 * Dieses Modul liest CSV- und JSON-Dateien ein, wie sie in der Praxis
 * entstehen: aus einem Prospekt in Excel übertragen, aus einem Hersteller-
 * Konfigurator exportiert, aus einer Ausschreibungsliste kopiert. Solche
 * Dateien sind nie sauber. Sie haben Semikolon oder Komma als Trennzeichen,
 * deutsche oder englische Zahlen, Einheiten in den Zellen, Überschriften mit
 * Bindestrichen, Umlaute als „ae" geschrieben, doppelte Spalten und eine
 * Zeile mit einer Spalte zu viel.
 *
 * **Die zentrale Entscheidung dieses Moduls: es übernimmt nichts still.**
 * Ergebnis eines Imports ist kein Array von Geräten, sondern ein Bericht
 * (`DeviceImportReport`) — je Zeile steht darin, welches Feld aus welcher
 * Spalte kam, wie sicher die Zuordnung war, welche Pflichtangabe fehlt und
 * welcher Wert unplausibel ist. Erst wenn eine Zeile sauber ist, gilt sie als
 * übernehmbar. Der Grund ist einfach: eine Typklasse ist zwar ungenau, aber
 * sie ist als ungenau gekennzeichnet. Ein Datenblatt mit einem Zahlendreher
 * trägt dagegen `provenance: 'hersteller'` und sieht damit belastbarer aus,
 * als es ist. Der stille Import wäre also die schlechtere Variante als gar
 * kein Import.
 *
 * Das Modul rechnet nichts aus, was der Katalog nicht auch ausrechnet; wo für
 * ein Pflichtfeld des Typs kein Wert im Datenblatt steht (Mindestvolumenstrom
 * etwa steht selten drin), wird derselbe offengelegte Zusammenhang wie im
 * Katalog verwendet und als Annahme im Bericht vermerkt.
 */

import { HEAT_PUMP_CATALOG, STORAGE_CATALOG } from './deviceCatalog';
import type {
  DeviceRatingPoint,
  HeatPumpModel,
  HeatSourceKind,
  PumpForm,
  Refrigerant,
  StorageKind,
  StorageModel,
} from '../types/bim';

// ===========================================================================
// Typen des Berichts
// ===========================================================================

/** Welche Art Gerät eine Datei beschreibt. */
export type DeviceKind = 'waermepumpe' | 'speicher';

/**
 * Zahlenformat einer Spalte oder Datei.
 * `komma` = deutsch (8,5), `punkt` = englisch (8.5), `unklar` = kein Beleg.
 */
export type DecimalStyle = 'komma' | 'punkt' | 'unklar';

/** Ein Hinweis, eine Warnung oder ein Ausschlussgrund. */
export interface ImportIssue {
  severity: 'info' | 'warn' | 'error';
  /** Betroffenes Zielfeld, sofern zuordenbar. */
  field?: string;
  text: string;
}

/**
 * Ein übernommener Wert samt Herkunft.
 *
 * Die Herkunft ist der eigentliche Zweck: wer später eine Zahl anzweifelt,
 * muss ohne Rückgriff auf die Quelldatei sehen können, aus welcher Spalte sie
 * kam und wie sicher die Zuordnung war.
 */
export interface FieldMatch {
  /** Schlüssel des Zielfeldes, z. B. `nominalCapacity` oder `outdoor.width`. */
  field: string;
  /** Deutsche Bezeichnung des Zielfeldes. */
  label: string;
  /** Überschrift der Quellspalte, unverändert. */
  column: string;
  columnIndex: number;
  /** Zellinhalt, unverändert. */
  raw: string;
  /** Übernommener Wert nach Bereinigung. */
  value: string | number;
  /** Güte der Spaltenzuordnung, 1 = wörtlich getroffen. */
  confidence: number;
  method: 'exakt' | 'ähnlich' | 'betriebspunkt' | 'direkt';
  /** Was beim Lesen der Zelle passiert ist, z. B. entfernte Einheit. */
  note?: string;
}

/** Zuordnung einer Spalte der Quelldatei zu einem Zielfeld. */
export interface ColumnMapping {
  index: number;
  heading: string;
  field?: string;
  label?: string;
  confidence: number;
  method: FieldMatch['method'] | 'ohne';
  /** Bester abgelehnter Kandidat — hilft beim Nachbessern der Überschrift. */
  suggestion?: string;
  decimalStyle: DecimalStyle;
}

/** Ergebnis einer einzelnen Zeile. */
export interface ImportedDevice {
  /**
   * Nummer des Datensatzes in der Quelldatei.
   * CSV: die physische Zeilennummer, so wie sie der Editor anzeigt — die
   * Kopfzeile ist mitgezählt, damit man die Stelle wiederfindet.
   * JSON: die laufende Nummer des Eintrags in der Liste, beginnend bei 1.
   * Weil beides „7" heißen kann und nicht dasselbe meint, steht in
   * `rowLabel` die Bezeichnung, die dem Anwender gezeigt werden soll.
   */
  row: number;
  /** Fundstelle im Klartext, z. B. „Zeile 7" (CSV) oder „Eintrag 3" (JSON). */
  rowLabel: string;
  kind: DeviceKind;
  /** Aufgebautes Gerät — auch bei `accepted: false` zur Ansicht vorhanden. */
  heatPump?: HeatPumpModel;
  storage?: StorageModel;
  matches: FieldMatch[];
  missing: { field: string; label: string }[];
  issues: ImportIssue[];
  /** Darf das Gerät als Auslegungsgrundlage verwendet werden? */
  accepted: boolean;
  summary: string;
}

/** Der vollständige Bericht eines Importlaufs. */
export interface DeviceImportReport {
  format: 'csv' | 'json' | 'unbekannt';
  /** Erkanntes Trennzeichen der CSV-Datei. */
  delimiter?: string;
  /** Dateiweites Zahlenformat. */
  decimalStyle: DecimalStyle;
  kind: DeviceKind;
  columns: ColumnMapping[];
  devices: ImportedDevice[];
  acceptedCount: number;
  rejectedCount: number;
  /** Probleme der Datei als Ganzes. */
  issues: ImportIssue[];
  summary: string;
}

export interface DeviceImportOptions {
  /** Geräteart erzwingen; sonst wird sie aus den Überschriften erschlossen. */
  kind?: DeviceKind;
  /** Hersteller, falls die Datei ihn nicht in einer Spalte führt. */
  manufacturer?: string;
  /** Zahlenformat erzwingen; sonst wird es je Spalte erkannt. */
  decimalStyle?: DecimalStyle;
  /** Trennzeichen erzwingen; sonst wird es erkannt. */
  delimiter?: string;
}

// ===========================================================================
// CSV — Trennzeichen, Anführungszeichen, Zeilenenden
// ===========================================================================

/**
 * Kandidaten für das Trennzeichen, in der Reihenfolge ihrer Häufigkeit in
 * deutschen Exporten. Excel schreibt im deutschen Gebietsschema Semikolon,
 * weil das Komma als Dezimaltrennzeichen belegt ist; Tabulator kommt aus dem
 * Kopieren aus PDF-Tabellen, Komma aus englischen Werkzeugen.
 */
const DELIMITERS = [';', '\t', ',', '|'] as const;

/**
 * Zerlegt CSV-Text in Zeilen und Zellen.
 *
 * Der Parser ist bewusst eigen und nicht aus einer Bibliothek: er muss mit
 * Dateien umgehen, die kein Werkzeug erzeugt hat, sondern ein Mensch, und
 * darf an keiner Stelle abbrechen. Nicht abgeschlossene Anführungszeichen am
 * Dateiende werden stillschweigend geschlossen, statt eine Ausnahme zu
 * werfen — der Bericht meldet ohnehin, wenn dabei Unsinn herauskommt.
 *
 * Regeln: Anführungszeichen umschließen ein Feld, doppelte Anführungszeichen
 * darin stehen für eines, ein Zeilenumbruch innerhalb der Anführungszeichen
 * gehört zum Feld. Unquotierte Felder werden am Rand beschnitten, quotierte
 * nicht — dort ist der Leerraum gewollt.
 */
function splitRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let inQuotes = false;
  let i = 0;
  const pushField = (): void => {
    row.push(quoted ? field : field.trim());
    field = '';
    quoted = false;
  };
  const pushRow = (): void => {
    pushField();
    rows.push(row);
    row = [];
  };
  while (i < text.length) {
    const c = text.charAt(i);
    if (inQuotes) {
      if (c === '"') {
        if (text.charAt(i + 1) === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"' && field.trim() === '') {
      inQuotes = true;
      quoted = true;
      field = '';
      i += 1;
      continue;
    }
    if (c === delimiter) {
      pushField();
      i += 1;
      continue;
    }
    if (c === '\r') {
      if (text.charAt(i + 1) === '\n') i += 1;
      pushRow();
      i += 1;
      continue;
    }
    if (c === '\n') {
      pushRow();
      i += 1;
      continue;
    }
    field += c;
    i += 1;
  }
  if (field.length > 0 || quoted || row.length > 0) pushRow();
  return rows;
}

/**
 * Trennzeichen erkennen.
 *
 * Nicht durch Zählen der Zeichen — ein Komma im Gerätenamen und ein Semikolon
 * in einer Bemerkung verfälschen jede Häufigkeitszählung. Stattdessen wird
 * mit jedem Kandidaten probeweise zerlegt und bewertet, ob dabei eine
 * *Tabelle* entsteht: mehr als eine Spalte und über die Zeilen hinweg
 * gleichbleibend viele. Das ist genau die Eigenschaft, die ein echtes
 * Trennzeichen von einem zufälligen Zeichen unterscheidet.
 */
function detectDelimiter(text: string): string {
  let best: string = DELIMITERS[0];
  let bestScore = -1;
  for (const candidate of DELIMITERS) {
    const rows = splitRows(text, candidate).filter((r) => r.some((c) => c !== ''));
    if (rows.length === 0) continue;
    // Maßgeblich ist die *häufigste* Zeilenbreite, nicht die der ersten Zeile:
    // über der Kopfzeile steht in Exporten aus Prospekten oft eine Titelzeile
    // ohne jedes Trennzeichen. Würde deren Breite zählen, fiele der richtige
    // Kandidat aus der Wertung und die Datei zerfiele in eine Spalte.
    const counts = new Map<number, number>();
    for (const row of rows) counts.set(row.length, (counts.get(row.length) ?? 0) + 1);
    let width = 0;
    let widthCount = 0;
    for (const [candidateWidth, count] of counts) {
      if (candidateWidth < 2) continue;
      if (count > widthCount || (count === widthCount && candidateWidth > width)) {
        width = candidateWidth;
        widthCount = count;
      }
    }
    if (width < 2) continue;
    const consistent = widthCount / rows.length;
    // Der Anteil gleich breiter Zeilen geht als Faktor ein, nicht als Summand:
    // ein Zeichen, das nur eine einzige Zeile zerlegt (das Komma in „8,2"),
    // soll auch dann verlieren, wenn es dabei viele Spalten erzeugt.
    const score = (width + 4) * consistent;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

/** Zerlegtes CSV mit dem verwendeten Trennzeichen. */
export interface ParsedCsv {
  rows: string[][];
  /** Logische Zeilennummer je Zeile (Leerzeilen sind entfernt). */
  lines: number[];
  delimiter: string;
}

/** CSV-Text zerlegen. Leerzeilen entfallen, ihre Nummerierung bleibt erhalten. */
export function parseCsv(text: string, delimiter?: string): ParsedCsv {
  const clean = stripBom(text);
  const used = delimiter ?? detectDelimiter(clean);
  const all = splitRows(clean, used);
  const rows: string[][] = [];
  const lines: number[] = [];
  all.forEach((cells, index) => {
    if (cells.some((c) => c !== '')) {
      rows.push(cells);
      lines.push(index + 1);
    }
  });
  return { rows, lines, delimiter: used };
}

/** Byte Order Mark am Dateianfang entfernen — Excel schreibt ihn bei UTF-8. */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

// ===========================================================================
// Zahlen — deutsch und englisch in derselben Datei
// ===========================================================================

/**
 * Die Mehrdeutigkeit von „1.234".
 *
 * Der Punkt kann Dezimaltrennzeichen (englisch, 1,234) oder
 * Tausendertrennzeichen (deutsch, 1234) sein. Aus der Zelle allein ist das
 * nicht zu entscheiden, und wer es raten lässt, bekommt in derselben Datei
 * beide Bedeutungen — genau das darf nicht passieren.
 *
 * Deshalb wird nicht die Zelle befragt, sondern die **Spalte**:
 *
 *  1. Eindeutige Belege sammeln. Eindeutig ist eine Zelle, die beide Zeichen
 *     enthält („1.234,5" / „1,234.5") — dann ist das zuletzt stehende Zeichen
 *     das Dezimaltrennzeichen. Eindeutig ist auch ein Zeichen, dem *nicht*
 *     genau drei Ziffern folgen („8,5", „3.75", „12,25"), denn ein
 *     Tausendertrennzeichen steht immer vor einer Dreiergruppe.
 *  2. Aus den Belegen der Spalte wird deren Format bestimmt. Es gilt dann
 *     auch für die zweideutigen Zellen derselben Spalte.
 *  3. Hat die Spalte keinen Beleg, gilt das Format der ganzen Datei.
 *  4. Hat auch die Datei keinen Beleg, entscheidet die Plausibilität des
 *     Feldes: beide Lesarten werden gebildet, und es gewinnt die, die in den
 *     Wertebereich des Feldes fällt (8 kW Heizleistung sind plausibel,
 *     8000 kW nicht). Passen beide oder keine, wird als Dezimaltrennzeichen
 *     gelesen und der Wert im Bericht als mehrdeutig geführt.
 *
 * Damit bedeutet „1.234" innerhalb einer Spalte immer dasselbe, und wo es
 * trotzdem eine Vermutung bleibt, steht das im Bericht.
 */
interface NumberToken {
  /** Die Zahl, wie sie in der Zelle steht. */
  token: string;
  /** Was in derselben Zelle daneben stand — Einheit, Vorsatz, Fußnote. */
  rest: string;
  /**
   * Die abgetrennte Stückzahl, falls die Zelle eine trug („3 x 16 A" → „3").
   *
   * Sie wird mitgeführt, weil erst sie die Lesart belegbar macht: aus
   * derselben Zelle ließe sich auch 3 A lesen, und diese Verwechslung fällt
   * niemandem auf, solange im Bericht nur der übernommene Wert steht.
   */
  count?: string;
}

/**
 * Die Zahl aus einer Zelle herauslösen.
 *
 * Zwei Schreibweisen werden vorher entschärft, weil sie sonst eine falsche
 * Zahl liefern statt gar keiner — der schlechtere der beiden Fehler:
 *
 *  - Leerzeichen als Tausendertrennzeichen („1 234" → „1234").
 *  - Die Stückzahl vor der eigentlichen Angabe. „3 x 16 A" ist eine
 *    Absicherung von 16 A, nicht von 3 A; „3 × 400 V" sind 400 V. Ohne diesen
 *    Schritt liest das Modul die Phasenzahl als Messwert, meldet sie als
 *    unplausibel und weist eine völlig gesunde Zeile zurück.
 *
 * Zurück kommt außerdem der Rest der Zelle, damit im Bericht steht, was
 * abgeschnitten wurde. Der Rest wird am bereinigten Text abgetrennt, nicht am
 * Original: sonst meldet die Zelle „1 234 kW" ihren gesamten Inhalt als
 * entfernten Zusatz.
 */
function splitNumberToken(raw: string): NumberToken | undefined {
  let count: string | undefined;
  const cleaned = raw
    .replace(/[\u00a0\u202f\u2009]/g, ' ')
    .replace(/(\d) (?=\d{3}(?:\D|$))/g, '$1')
    .replace(/(^|[^\d,.])([1-4])\s*[x×*]\s*(?=\d)/g, (_match: string, before: string, factor: string) => {
      count = factor;
      return before;
    });
  const m = /-?\d+(?:[.,]\d+)*/.exec(cleaned);
  if (!m) return undefined;
  const rest = [cleaned.slice(0, m.index).trim(), cleaned.slice(m.index + m[0].length).trim()]
    .filter((part) => part !== '')
    .join(' ');
  return { token: m[0], rest, count };
}

function numberToken(raw: string): string | undefined {
  return splitNumberToken(raw)?.token;
}

/** Welches Format belegt eine einzelne Zelle? `keine` = kein Beleg. */
function classifyNumberText(raw: string): DecimalStyle | 'keine' {
  const token = numberToken(raw);
  if (!token) return 'keine';
  const hasComma = token.includes(',');
  const hasDot = token.includes('.');
  if (hasComma && hasDot) return token.lastIndexOf(',') > token.lastIndexOf('.') ? 'komma' : 'punkt';
  if (hasComma) {
    const groups = token.split(',').slice(1);
    if (groups.some((g) => g.length !== 3)) return 'komma';
    return groups.length > 1 ? 'punkt' : 'unklar';
  }
  if (hasDot) {
    const groups = token.split('.').slice(1);
    if (groups.some((g) => g.length !== 3)) return 'punkt';
    return groups.length > 1 ? 'komma' : 'unklar';
  }
  return 'keine';
}

/** Format aus mehreren Zellen bestimmen — Mehrheit der eindeutigen Belege. */
export function detectDecimalStyle(cells: readonly string[]): DecimalStyle {
  let komma = 0;
  let punkt = 0;
  for (const cell of cells) {
    const c = classifyNumberText(cell);
    if (c === 'komma') komma += 1;
    else if (c === 'punkt') punkt += 1;
  }
  if (komma > punkt) return 'komma';
  if (punkt > komma) return 'punkt';
  return 'unklar';
}

interface NumberReading {
  value?: number;
  /** Das Zahlenformat war nicht belegt und wurde erschlossen. */
  ambiguous: boolean;
  note?: string;
}

/**
 * Felder, deren Zahl ein Strom ist.
 *
 * Sie entscheiden den Wortlaut der Lesart: eine Absicherung von 16 A gilt auf
 * jeder Phase, die 400 V eines Drehstromanschlusses liegen dagegen zwischen
 * zwei Außenleitern und nicht „je Phase". Der Wortlaut folgt deshalb dem
 * Zielfeld und nicht der Einheit in der Zelle, die auch fehlen kann.
 */
const CURRENT_FIELDS = new Set(['electric.fuse', 'electric.maxCurrent', 'electric.startCurrent']);

/**
 * Die Lesart einer Zelle mit Stückzahl offenlegen.
 *
 * „3 x 16 A" als 16 A zu lesen ist die riskanteste Entscheidung des
 * Zahlenlesers: sie ist richtig, aber sie ist eine Deutung, und die
 * Gegendeutung (3 A) ergäbe eine Anlage, die niemand nachrechnet, weil im
 * Bericht nur „Zusatz „A" entfernt." stünde. Deshalb nennt die Notiz nicht
 * den entfernten Rest, sondern die Lesart im Ganzen — Zelle, übernommener
 * Wert und Bedeutung der Stückzahl.
 */
function countReadingNote(raw: string, token: string, rest: string, count: string, field?: string): string {
  const cell = raw.trim().replace(/\s+/g, ' ');
  const value = rest !== '' ? `${token} ${rest}` : token;
  if (field !== undefined && CURRENT_FIELDS.has(field)) {
    return `„${cell}" gelesen als ${value} je Phase bei ${count} Phasen.`;
  }
  if (field !== undefined && field.startsWith('electric.')) {
    return `„${cell}" gelesen als ${value} bei ${count} Phasen.`;
  }
  return `„${cell}" gelesen als ${value} je Stück bei ${count} Stück.`;
}

function toNumber(token: string, style: 'komma' | 'punkt'): number {
  if (style === 'komma') {
    const s = token.replace(/\./g, '');
    const idx = s.lastIndexOf(',');
    return Number(idx < 0 ? s : `${s.slice(0, idx)}.${s.slice(idx + 1)}`);
  }
  return Number(token.replace(/,/g, ''));
}

/**
 * Eine Zelle als Zahl lesen. Einheiten, Vorsätze („ca.") und Klammerzusätze
 * werden abgeschnitten; was abgeschnitten wurde, steht in `note`, damit im
 * Bericht sichtbar bleibt, dass die Zelle mehr enthielt als die Zahl.
 */
function readNumber(raw: string, style: DecimalStyle, range?: readonly [number, number], field?: string): NumberReading {
  const split = splitNumberToken(raw);
  if (!split) return { ambiguous: false };
  const token = split.token;
  const note =
    split.count !== undefined
      ? countReadingNote(raw, token, split.rest, split.count, field)
      : split.rest !== ''
        ? `Zusatz „${split.rest}" entfernt.`
        : undefined;
  const own = classifyNumberText(raw);
  const effective: DecimalStyle = own === 'komma' || own === 'punkt' ? own : style;
  if (effective !== 'unklar') {
    const value = toNumber(token, effective);
    return { value: Number.isFinite(value) ? value : undefined, ambiguous: false, note };
  }
  // Weder Zelle noch Spalte noch Datei geben einen Beleg her: beide Lesarten
  // bilden und über den Wertebereich des Feldes entscheiden.
  const asDecimal = toNumber(token, token.includes(',') ? 'komma' : 'punkt');
  const asThousands = Number(token.replace(/[.,]/g, ''));
  const inRange = (v: number): boolean => !range || (v >= range[0] && v <= range[1]);
  const decimalFits = inRange(asDecimal);
  const thousandsFits = inRange(asThousands);
  if (decimalFits !== thousandsFits) {
    const value = decimalFits ? asDecimal : asThousands;
    return {
      value,
      ambiguous: true,
      note: [note, `Zahlenformat nicht belegt; „${token}" wurde über den Wertebereich als ${formatDe(value)} gelesen.`]
        .filter(Boolean)
        .join(' '),
    };
  }
  return {
    value: asDecimal,
    ambiguous: true,
    note: [note, `Zahlenformat nicht belegt; „${token}" wurde als ${formatDe(asDecimal)} gelesen.`]
      .filter(Boolean)
      .join(' '),
  };
}

/**
 * Zahl mit deutschem Dezimalkomma ausgeben, ohne Abhängigkeit vom
 * Gebietsschema.
 *
 * Zwei Vorkehrungen: ein nicht endlicher Wert wird benannt statt als „NaN"
 * in einen Nutzertext geschrieben, und kleine Beträge werden nicht auf drei
 * Nachkommastellen gerundet. Sonst meldet die Prüfung „0,00015 kg/kW" als
 * „0 kg/kW" — eine Meldung, die den Fehler verschweigt, den sie meldet.
 */
function formatDe(value: number): string {
  if (!Number.isFinite(value)) return 'kein Zahlenwert';
  const abs = Math.abs(value);
  if (abs >= 1e21) {
    // Ab 10^21 schreibt JavaScript von sich aus Exponentialschreibweise mit
    // Dezimalpunkt („1e+23"). Solche Werte entstehen nur aus verunglückten
    // Zellen, aber sie stehen dann in einer deutschen Meldung — deshalb als
    // Zehnerpotenz mit Komma.
    const exponent = Math.floor(Math.log10(abs));
    const mantissa = (value / 10 ** exponent).toFixed(2).replace(/0+$/, '').replace(/\.$/, '').replace('.', ',');
    return `${mantissa}·10^${exponent}`;
  }
  const decimals = abs === 0 || abs >= 1 ? 3 : Math.min(12, 3 + Math.ceil(-Math.log10(abs)));
  let text = value.toFixed(decimals);
  if (text.includes('.')) text = text.replace(/0+$/, '').replace(/\.$/, '');
  return text.replace('.', ',');
}

// ===========================================================================
// Spaltenerkennung
// ===========================================================================

/**
 * Einheiten, die als eigenes Wort hinter der Überschrift stehen und für die
 * Zuordnung nichts beitragen. Nur ganze Wörter werden entfernt — sonst würde
 * aus „Leistungszahl" beim Abschneiden eines vermeintlichen „l" der Torso
 * „Leistungszah".
 */
const UNIT_WORDS = new Set([
  'kw',
  'kwh',
  'mwh',
  'w',
  'db',
  'dba',
  'kg',
  'g',
  'mm',
  'cm',
  'm',
  'm2',
  'm3',
  'l',
  'ltr',
  'liter',
  'bar',
  'v',
  'a',
  'k',
  'c',
  'grad',
  'gradc',
  'h',
  '24h',
  'prozent',
  'proz',
  'stk',
]);

/**
 * Überschrift auf eine Vergleichsform bringen.
 *
 * Umlaute werden aufgelöst, weil Datenblätter beides schreiben („Kältemittel"
 * und „Kaeltemittel"). Klammerinhalte fallen weg, weil dort fast immer die
 * Einheit steht („Heizleistung [kW]", „Schallleistungspegel dB(A)").
 * Trennzeichen, Bindestriche und Leerzeichen verschwinden, weil sie in
 * Prospekten willkürlich gesetzt sind („Heiz-Leistung", „Heiz Leistung").
 */
export function normalizeHeading(text: string): string {
  const base = text
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const words = base.split(' ').filter((w) => w !== '');
  const kept = words.filter((w) => !UNIT_WORDS.has(w));
  return (kept.length > 0 ? kept : words).join('');
}

/** Levenshtein-Abstand, zeilenweise — für Überschriften ist das schnell genug. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = new Array<number>(b.length + 1);
  let cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) prev[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    const swap = prev;
    prev = cur;
    cur = swap;
  }
  return prev[b.length];
}

/** Übereinstimmung der Buchstabenpaare (Dice) — unempfindlich gegen Umstellungen. */
function bigramSimilarity(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const counts = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i += 1) {
    const g = a.slice(i, i + 2);
    counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  let hits = 0;
  for (let i = 0; i < b.length - 1; i += 1) {
    const g = b.slice(i, i + 2);
    const n = counts.get(g) ?? 0;
    if (n > 0) {
      counts.set(g, n - 1);
      hits += 1;
    }
  }
  return (2 * hits) / (a.length - 1 + (b.length - 1));
}

/**
 * Ähnlichkeit zweier normalisierter Überschriften.
 *
 * **Warum nicht auf exakte Treffer setzen?** Weil es die Überschrift nicht
 * gibt. Dieselbe Angabe heißt je nach Hersteller „Heizleistung",
 * „Nennwärmeleistung", „Heizleistung A-7/W35 [kW]" oder „Heating capacity";
 * dazu kommen Tippfehler, Umbrüche und der eine Kollege, der Umlaute meidet.
 * Eine exakte Tabelle würde solche Spalten stillschweigend übergehen — und
 * eine stillschweigend übergangene Spalte ist der teuerste Fehler dieses
 * Moduls, weil die Zeile danach *plausibel* aber unvollständig aussieht.
 *
 * Der Preis der Unschärfe ist die Fehlzuordnung. Der wird auf zwei Wegen
 * bezahlt: die Schwelle liegt hoch (`MATCH_ACCEPT`), und jede Zuordnung
 * schleppt ihre Güte bis in den Bericht mit — wer eine Zahl anzweifelt, sieht
 * sofort, ob sie über eine wörtliche oder eine geratene Spalte kam.
 */
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const lev = 1 - levenshtein(a, b) / Math.max(a.length, b.length);
  let score = Math.max(lev, bigramSimilarity(a, b));
  const shorter = Math.min(a.length, b.length);
  const longer = Math.max(a.length, b.length);
  // Enthält die eine Überschrift die andere vollständig, ist das ein starker
  // Hinweis („max. Vorlauftemperatur" enthält „Vorlauftemperatur"). Der Wert
  // bleibt unter 1, damit ein wörtlicher Treffer eines anderen Feldes gewinnt.
  // Der Zuschlag greift nur, wenn die kürzere Überschrift den Großteil der
  // längeren ausmacht. Sonst würde „Leistungsaufnahme" über das enthaltene
  // „Leistung" zur Heizleistung — aus 8 kW Heizleistung würden 2 kW
  // Stromaufnahme, und die Auslegung wäre still um den Faktor COP falsch.
  if (shorter >= 5 && shorter / longer >= 0.6 && (a.includes(b) || b.includes(a))) {
    score = Math.max(score, 0.84 + 0.1 * (shorter / longer));
  }
  return score;
}

/** Ab hier gilt eine Spalte als zugeordnet. */
const MATCH_ACCEPT = 0.82;
/** Ab hier wird sie als Vorschlag im Bericht genannt, aber nicht verwendet. */
const MATCH_SUGGEST = 0.66;

/**
 * Beschreibung eines Zielfeldes.
 *
 * `range` ist der plausible Wertebereich. Er hat zwei Aufgaben: er entscheidet
 * bei mehrdeutigem Zahlenformat (siehe oben) und er fängt Tippfehler ab. Die
 * Grenzen sind bewusst weit — sie sollen Unsinn erkennen, nicht Auslegung
 * betreiben.
 */
interface FieldSpec {
  key: string;
  label: string;
  group: DeviceKind | 'beide';
  type: 'zahl' | 'text';
  /** Überschrift in der Importvorlage, mit Einheit. */
  heading: string;
  aliases: string[];
  range?: readonly [number, number];
  /** Ohne dieses Feld ist die Zeile nicht übernehmbar. */
  required?: boolean;
  /** Beispielwert für die Vorlage. */
  example?: string;
}

/**
 * Feldtabelle.
 *
 * Die Aliasliste ist in normalisierter Form (klein, ohne Umlaute, ohne
 * Trennzeichen) geschrieben — die Überschrift der Datei wird vor dem Vergleich
 * genauso behandelt. Deutsch und englisch stehen nebeneinander, weil beides
 * vorkommt, oft in derselben Datei.
 */
const FIELDS: FieldSpec[] = [
  // -- gemeinsam ------------------------------------------------------------
  {
    key: 'manufacturer',
    label: 'Hersteller',
    group: 'beide',
    type: 'text',
    heading: 'Hersteller',
    aliases: ['hersteller', 'fabrikat', 'marke', 'manufacturer', 'brand', 'lieferant'],
    example: 'Musterhersteller',
  },
  {
    key: 'id',
    label: 'Artikelnummer',
    group: 'beide',
    type: 'text',
    heading: 'Artikelnummer',
    aliases: ['id', 'artikelnummer', 'artnr', 'artikelnr', 'bestellnummer', 'sachnummer', 'materialnummer', 'articlenumber', 'partnumber', 'sku'],
    example: 'MH-WP-8',
  },
  {
    key: 'label',
    label: 'Bezeichnung',
    group: 'beide',
    type: 'text',
    heading: 'Bezeichnung',
    required: true,
    aliases: ['bezeichnung', 'typenbezeichnung', 'typ', 'modell', 'model', 'geraet', 'produkt', 'name', 'benennung', 'designation'],
    example: 'Muster WP 8 R290',
  },
  {
    key: 'note',
    label: 'Bemerkung',
    group: 'beide',
    type: 'text',
    heading: 'Bemerkung',
    aliases: ['bemerkung', 'hinweis', 'anmerkung', 'kommentar', 'note', 'remark', 'comment'],
    example: 'Beispielzeile — vor dem Import löschen.',
  },

  // -- Wärmepumpe -----------------------------------------------------------
  {
    key: 'series',
    label: 'Baureihe',
    group: 'waermepumpe',
    type: 'text',
    heading: 'Baureihe',
    aliases: ['baureihe', 'serie', 'reihe', 'produktfamilie', 'series', 'productline'],
    example: 'Muster Monoblock R290',
  },
  {
    key: 'form',
    label: 'Bauform',
    group: 'waermepumpe',
    type: 'text',
    heading: 'Bauform',
    aliases: ['bauform', 'bauart', 'ausfuehrung', 'aufstellung', 'form', 'type', 'installation'],
    example: 'Monoblock Außenaufstellung',
  },
  {
    key: 'source',
    label: 'Wärmequelle',
    group: 'waermepumpe',
    type: 'text',
    heading: 'Wärmequelle',
    aliases: ['waermequelle', 'quelle', 'quellenart', 'waermequellenart', 'source', 'heatsource'],
    example: 'Luft',
  },
  {
    key: 'refrigerant',
    label: 'Kältemittel',
    group: 'waermepumpe',
    type: 'text',
    heading: 'Kältemittel',
    required: true,
    aliases: ['kaeltemittel', 'refrigerant', 'kuehlmittel', 'kaeltemitteltyp'],
    example: 'R290',
  },
  {
    key: 'refrigerantMass',
    label: 'Füllmenge Kältemittel',
    group: 'waermepumpe',
    type: 'zahl',
    heading: 'Füllmenge [kg]',
    required: true,
    range: [0.1, 20],
    aliases: [
      'fuellmenge',
      'kaeltemittelfuellmenge',
      'fuellmengekaeltemittel',
      'kaeltemittelmenge',
      'fuellgewicht',
      'refrigerantcharge',
      'charge',
      'refrigerantmass',
    ],
    example: '1,25',
  },
  {
    key: 'nominalCapacity',
    label: 'Heizleistung',
    group: 'waermepumpe',
    type: 'zahl',
    heading: 'Heizleistung [kW]',
    required: true,
    range: [1, 100],
    aliases: [
      'heizleistung',
      'nennleistung',
      'nennheizleistung',
      'nennwaermeleistung',
      'waermeleistung',
      'leistung',
      'capacity',
      'heatingcapacity',
      'ratedcapacity',
      'ratedheatingcapacity',
      'output',
    ],
    example: '8,2',
  },
  {
    key: 'nominalPoint',
    label: 'Betriebspunkt der Nennleistung',
    group: 'waermepumpe',
    type: 'text',
    heading: 'Betriebspunkt',
    aliases: ['betriebspunkt', 'nennpunkt', 'bezugspunkt', 'auslegungspunkt', 'ratingpoint', 'ratingcondition', 'pruefpunkt'],
    example: 'A-7/W35',
  },
  {
    key: 'copNominal',
    label: 'COP im Betriebspunkt',
    group: 'waermepumpe',
    type: 'zahl',
    heading: 'COP',
    range: [1, 8],
    aliases: ['cop', 'leistungszahl', 'copnennpunkt', 'coefficientofperformance', 'copwert'],
    example: '2,85',
  },
  {
    key: 'scop35',
    label: 'SCOP bei 35 °C',
    group: 'waermepumpe',
    type: 'zahl',
    heading: 'SCOP 35 °C',
    range: [1, 8],
    aliases: ['scop35', 'scopw35', 'scopniedertemperatur', 'scoplowtemperature', 'jahresarbeitszahl35', 'etas35'],
    example: '4,95',
  },
  {
    key: 'scop55',
    label: 'SCOP bei 55 °C',
    group: 'waermepumpe',
    type: 'zahl',
    heading: 'SCOP 55 °C',
    range: [1, 8],
    aliases: ['scop55', 'scopw55', 'scopmitteltemperatur', 'scopmediumtemperature', 'jahresarbeitszahl55', 'etas55'],
    example: '3,60',
  },
  {
    key: 'maxFlowTemperature',
    label: 'höchste Vorlauftemperatur',
    group: 'waermepumpe',
    type: 'zahl',
    heading: 'max. Vorlauftemperatur [°C]',
    required: true,
    range: [35, 90],
    aliases: [
      'maxvorlauftemperatur',
      'maximalevorlauftemperatur',
      'vorlauftemperaturmax',
      'hoechstevorlauftemperatur',
      'maxaustrittstemperatur',
      'maxwarmwassertemperatur',
      'maxflowtemperature',
      'maximumflowtemperature',
      'maxwatertemperature',
    ],
    example: '70',
  },
  {
    key: 'soundPowerOutdoor',
    label: 'Schallleistungspegel außen',
    group: 'waermepumpe',
    type: 'zahl',
    heading: 'Schallleistungspegel [dB(A)]',
    range: [30, 80],
    aliases: [
      'schallleistung',
      'schallleistungspegel',
      'schallleistungaussen',
      'schallleistungspegelaussen',
      'schallleistungspegelaussengeraet',
      'lwa',
      'soundpower',
      'soundpowerlevel',
      'schallleistungspegelnachennnorm',
    ],
    example: '54,0',
  },
  {
    key: 'soundPowerNight',
    label: 'Schallleistungspegel Nachtbetrieb',
    group: 'waermepumpe',
    type: 'zahl',
    heading: 'Schallleistungspegel Nachtbetrieb [dB(A)]',
    range: [30, 80],
    aliases: [
      'schallleistungnacht',
      'schallleistungspegelnacht',
      'schallleistungnachtbetrieb',
      'schallleistungfluesterbetrieb',
      'fluesterbetrieb',
      'nachtbetrieb',
      'silentmode',
      'soundpowernight',
      'nachtabsenkung',
    ],
    example: '50,0',
  },
  {
    key: 'soundPowerIndoor',
    label: 'Schallleistungspegel Innengerät',
    group: 'waermepumpe',
    type: 'zahl',
    heading: 'Schallleistungspegel Innengerät [dB(A)]',
    range: [30, 80],
    aliases: ['schallleistunginnen', 'schallleistunginnengeraet', 'schallleistungspegelinnen', 'soundpowerindoor', 'lwainnen'],
    example: '42,0',
  },
  {
    key: 'outdoor.width',
    label: 'Breite Außengerät',
    group: 'waermepumpe',
    type: 'zahl',
    heading: 'Breite Außengerät [m]',
    range: [0.2, 4],
    aliases: ['breite', 'breiteaussengeraet', 'breiteaussen', 'width', 'widthoutdoor', 'baubreite'],
    example: '1,10',
  },
  {
    key: 'outdoor.depth',
    label: 'Tiefe Außengerät',
    group: 'waermepumpe',
    type: 'zahl',
    heading: 'Tiefe Außengerät [m]',
    range: [0.2, 3],
    aliases: ['tiefe', 'tiefeaussengeraet', 'tiefeaussen', 'depth', 'depthoutdoor', 'bautiefe'],
    example: '0,50',
  },
  {
    key: 'outdoor.height',
    label: 'Höhe Außengerät',
    group: 'waermepumpe',
    type: 'zahl',
    heading: 'Höhe Außengerät [m]',
    range: [0.2, 3],
    aliases: ['hoehe', 'hoeheaussengeraet', 'hoeheaussen', 'height', 'heightoutdoor', 'bauhoehe'],
    example: '1,05',
  },
  {
    key: 'outdoor.weight',
    label: 'Gewicht Außengerät',
    group: 'waermepumpe',
    type: 'zahl',
    heading: 'Gewicht Außengerät [kg]',
    range: [20, 2000],
    aliases: ['gewicht', 'gewichtaussengeraet', 'gewichtaussen', 'masse', 'weight', 'weightoutdoor', 'leergewicht'],
    example: '135',
  },
  {
    key: 'indoor.width',
    label: 'Breite Innengerät',
    group: 'waermepumpe',
    type: 'zahl',
    heading: 'Breite Innengerät [m]',
    range: [0.2, 3],
    aliases: ['breiteinnengeraet', 'breiteinnen', 'widthindoor', 'breiteinneneinheit'],
    example: '0,60',
  },
  {
    key: 'indoor.depth',
    label: 'Tiefe Innengerät',
    group: 'waermepumpe',
    type: 'zahl',
    heading: 'Tiefe Innengerät [m]',
    range: [0.2, 3],
    aliases: ['tiefeinnengeraet', 'tiefeinnen', 'depthindoor', 'tiefeinneneinheit'],
    example: '0,65',
  },
  {
    key: 'indoor.height',
    label: 'Höhe Innengerät',
    group: 'waermepumpe',
    type: 'zahl',
    heading: 'Höhe Innengerät [m]',
    range: [0.2, 3],
    aliases: ['hoeheinnengeraet', 'hoeheinnen', 'heightindoor', 'hoeheinneneinheit'],
    example: '0,85',
  },
  {
    key: 'indoor.weight',
    label: 'Gewicht Innengerät',
    group: 'waermepumpe',
    type: 'zahl',
    heading: 'Gewicht Innengerät [kg]',
    range: [10, 1000],
    aliases: ['gewichtinnengeraet', 'gewichtinnen', 'weightindoor', 'gewichtinneneinheit'],
    example: '78',
  },
  {
    key: 'indoor.integratedCylinder',
    label: 'integrierter Trinkwasserspeicher',
    group: 'waermepumpe',
    type: 'zahl',
    heading: 'Integrierter Trinkwasserspeicher [l]',
    range: [50, 500],
    aliases: ['integriertertrinkwasserspeicher', 'integrierterspeicher', 'trinkwasserspeicherintegriert', 'integratedcylinder', 'speicherinhaltintegriert'],
    example: '',
  },
  {
    key: 'indoor.integratedBuffer',
    label: 'integrierter Puffer',
    group: 'waermepumpe',
    type: 'zahl',
    heading: 'Integrierter Puffer [l]',
    range: [5, 500],
    aliases: ['integrierterpuffer', 'pufferintegriert', 'integratedbuffer', 'pufferinhaltintegriert'],
    example: '',
  },
  {
    key: 'hydraulicConnection',
    label: 'Heizungsanschluss',
    group: 'waermepumpe',
    type: 'text',
    heading: 'Heizungsanschluss',
    aliases: ['heizungsanschluss', 'hydraulischeranschluss', 'hydraulikanschluss', 'anschlussgroesse', 'anschluss', 'connection', 'waterconnection'],
    example: 'G 1 AG',
  },
  {
    key: 'refrigerantLines.liquid',
    label: 'Flüssigkeitsleitung',
    group: 'waermepumpe',
    type: 'text',
    heading: 'Flüssigkeitsleitung',
    aliases: ['fluessigkeitsleitung', 'fluessigleitung', 'liquidline', 'fluessigkeitsrohr'],
    example: '',
  },
  {
    key: 'refrigerantLines.gas',
    label: 'Sauggasleitung',
    group: 'waermepumpe',
    type: 'text',
    heading: 'Sauggasleitung',
    aliases: ['sauggasleitung', 'gasleitung', 'saugleitung', 'gasline', 'suctionline'],
    example: '',
  },
  {
    key: 'refrigerantLines.maxLength',
    label: 'max. Leitungslänge',
    group: 'waermepumpe',
    type: 'zahl',
    heading: 'max. Leitungslänge [m]',
    range: [1, 100],
    aliases: ['maxleitungslaenge', 'maximaleleitungslaenge', 'leitungslaengemax', 'maxpipelength', 'maximumpipelength'],
    example: '',
  },
  {
    key: 'refrigerantLines.maxHeight',
    label: 'max. Höhendifferenz',
    group: 'waermepumpe',
    type: 'zahl',
    heading: 'max. Höhendifferenz [m]',
    range: [1, 60],
    aliases: ['maxhoehendifferenz', 'maximalehoehendifferenz', 'hoehendifferenzmax', 'maxheightdifference'],
    example: '',
  },
  {
    key: 'minVolumeFlow',
    label: 'Mindestvolumenstrom',
    group: 'waermepumpe',
    type: 'zahl',
    heading: 'Mindestvolumenstrom [m³/h]',
    range: [0.05, 20],
    aliases: ['mindestvolumenstrom', 'minvolumenstrom', 'mindestdurchfluss', 'mindestwasserdurchsatz', 'minimumflowrate', 'minwaterflow'],
    example: '0,86',
  },
  {
    key: 'minSystemVolume',
    label: 'Mindestwasserinhalt der Anlage',
    group: 'waermepumpe',
    type: 'zahl',
    heading: 'Mindestwasserinhalt [l]',
    range: [5, 2000],
    aliases: ['mindestwasserinhalt', 'mindestanlagenvolumen', 'mindestwassermenge', 'minsystemvolume', 'minimumwatervolume'],
    example: '100',
  },
  {
    key: 'electric.phases',
    label: 'Phasen',
    group: 'waermepumpe',
    type: 'zahl',
    heading: 'Phasen',
    range: [1, 3],
    aliases: ['phasen', 'phasenzahl', 'netzanschluss', 'anschlussspannung', 'spannung', 'phases', 'powersupply', 'stromart'],
    example: '1',
  },
  {
    key: 'electric.fuse',
    label: 'Absicherung',
    group: 'waermepumpe',
    type: 'zahl',
    heading: 'Absicherung [A]',
    range: [6, 200],
    aliases: ['absicherung', 'vorsicherung', 'sicherung', 'absicherungtraege', 'fuse', 'fuseprotection', 'circuitbreaker'],
    example: '20',
  },
  {
    key: 'electric.maxCurrent',
    label: 'Maximaler Betriebsstrom',
    group: 'waermepumpe',
    type: 'zahl',
    heading: 'Max. Betriebsstrom [A]',
    range: [1, 250],
    aliases: [
      'maxbetriebsstrom',
      'maximalerbetriebsstrom',
      'betriebsstrom',
      'maxstrom',
      'maximalstrom',
      'maxstromaufnahme',
      'stromaufnahmemax',
      'nennstrom',
      'maxcurrent',
      'maximumcurrent',
      'runningcurrent',
      'ratedcurrent',
      'maxoperatingcurrent',
    ],
    example: '14,5',
  },
  {
    key: 'electric.startCurrent',
    label: 'Anlaufstrom',
    group: 'waermepumpe',
    type: 'zahl',
    heading: 'Anlaufstrom [A]',
    range: [1, 300],
    aliases: ['anlaufstrom', 'anlaufstromstaerke', 'startcurrent', 'startingcurrent', 'einschaltstrom'],
    example: '21,0',
  },
  {
    key: 'electric.backupHeater',
    label: 'Elektroheizstab',
    group: 'waermepumpe',
    type: 'zahl',
    heading: 'Heizstab [kW]',
    range: [0.5, 30],
    aliases: ['heizstab', 'elektroheizstab', 'elektrischezusatzheizung', 'zusatzheizung', 'backupheater', 'immersionheater', 'nachheizung'],
    example: '6',
  },

  // -- Speicher -------------------------------------------------------------
  {
    key: 'kind',
    label: 'Speicherart',
    group: 'speicher',
    type: 'text',
    heading: 'Speicherart',
    aliases: ['speicherart', 'speichertyp', 'bauart', 'art', 'kind', 'storagetype', 'tanktype'],
    example: 'Trinkwasserspeicher',
  },
  {
    key: 'volume',
    label: 'Nenninhalt',
    group: 'speicher',
    type: 'zahl',
    heading: 'Nenninhalt [l]',
    required: true,
    range: [10, 5000],
    aliases: ['nenninhalt', 'inhalt', 'speicherinhalt', 'volumen', 'volume', 'fassungsvermoegen', 'capacity', 'nennvolumen', 'tankvolume'],
    example: '300',
  },
  {
    key: 'potableVolume',
    label: 'Trinkwasserinhalt',
    group: 'speicher',
    type: 'zahl',
    heading: 'Trinkwasserinhalt [l]',
    range: [5, 2000],
    aliases: ['trinkwasserinhalt', 'trinkwasseranteil', 'trinkwasservolumen', 'potablevolume', 'dhwvolume'],
    example: '',
  },
  {
    key: 'coilArea',
    label: 'Wärmetauscherfläche',
    group: 'speicher',
    type: 'zahl',
    heading: 'Wärmetauscherfläche [m²]',
    range: [0.2, 12],
    aliases: ['waermetauscherflaeche', 'waermeuebertragerflaeche', 'heizflaeche', 'flaechewaermetauscher', 'coilarea', 'heatexchangerarea'],
    example: '4,2',
  },
  {
    key: 'continuousOutput',
    label: 'Dauerleistung',
    group: 'speicher',
    type: 'zahl',
    heading: 'Dauerleistung [kW]',
    range: [1, 200],
    aliases: ['dauerleistung', 'dauerleistungwarmwasser', 'continuousoutput', 'continuousperformance', 'leistungdauerbetrieb'],
    example: '26,8',
  },
  {
    key: 'performanceIndex',
    label: 'Leistungskennzahl NL',
    group: 'speicher',
    type: 'zahl',
    heading: 'Leistungskennzahl NL',
    range: [0.1, 60],
    aliases: ['leistungskennzahl', 'nl', 'nlzahl', 'kennzahlnl', 'performanceindex', 'nlwert'],
    example: '2,1',
  },
  {
    key: 'standbyLoss',
    label: 'Bereitschaftswärmeaufwand',
    group: 'speicher',
    type: 'zahl',
    heading: 'Bereitschaftswärmeaufwand [kWh/24h]',
    range: [0.2, 15],
    aliases: ['bereitschaftswaermeaufwand', 'bereitschaftsverlust', 'warmhalteverlust', 'standbyverlust', 'standbyloss', 'standingloss'],
    example: '1,40',
  },
  {
    key: 'diameter',
    label: 'Durchmesser',
    group: 'speicher',
    type: 'zahl',
    heading: 'Durchmesser [m]',
    required: true,
    range: [0.3, 2],
    aliases: ['durchmesser', 'aussendurchmesser', 'diameter', 'outerdiameter', 'durchmessermitdaemmung'],
    example: '0,70',
  },
  {
    key: 'height',
    label: 'Höhe',
    group: 'speicher',
    type: 'zahl',
    heading: 'Höhe [m]',
    required: true,
    range: [0.4, 3.5],
    aliases: ['hoehe', 'gesamthoehe', 'bauhoehe', 'height', 'totalheight'],
    example: '1,75',
  },
  {
    key: 'tiltHeight',
    label: 'Kippmaß',
    group: 'speicher',
    type: 'zahl',
    heading: 'Kippmaß [m]',
    range: [0.4, 4],
    aliases: ['kippmass', 'kippmasz', 'kippmassdiagonale', 'diagonale', 'tiltheight', 'tiltingdimension'],
    example: '1,88',
  },
  {
    key: 'material',
    label: 'Werkstoff',
    group: 'speicher',
    type: 'text',
    heading: 'Werkstoff',
    aliases: ['werkstoff', 'material', 'innenbehaelter', 'behaelterwerkstoff', 'oberflaeche'],
    example: 'emailliert',
  },
  {
    key: 'maxPressure.potable',
    label: 'Betriebsdruck Trinkwasser',
    group: 'speicher',
    type: 'zahl',
    heading: 'Betriebsdruck Trinkwasser [bar]',
    range: [0, 25],
    aliases: ['betriebsdrucktrinkwasser', 'maxdrucktrinkwasser', 'zulaessigerbetriebsdrucktrinkwasser', 'drucktrinkwasser', 'pressurepotable'],
    example: '10',
  },
  {
    key: 'maxPressure.heating',
    label: 'Betriebsdruck Heizung',
    group: 'speicher',
    type: 'zahl',
    heading: 'Betriebsdruck Heizung [bar]',
    range: [0, 25],
    aliases: ['betriebsdruckheizung', 'maxdruckheizung', 'zulaessigerbetriebsdruckheizung', 'pressureheating'],
    example: '3',
  },
];

/** Feldbeschreibung zu einem Schlüssel. */
function fieldSpec(key: string): FieldSpec | undefined {
  return FIELDS.find((f) => f.key === key);
}

/** Alle Felder einer Geräteart, gemeinsame eingeschlossen. */
function fieldsOf(kind: DeviceKind): FieldSpec[] {
  return FIELDS.filter((f) => f.group === kind || f.group === 'beide');
}

// ===========================================================================
// Betriebspunkte in den Überschriften
// ===========================================================================

/**
 * Eine Spalte, die einen Betriebspunkt trägt.
 *
 * Betriebspunkte stehen in Datenblättern nicht als Wert in einer Zelle,
 * sondern als *Überschrift* („A-7/W35", „COP A2/W35"). Sie sind damit die
 * einzige Angabe, deren Bezeichnung aus dem Kopf und deren Wert aus der Zelle
 * kommt. Leistung und COP desselben Punktes gehören zusammen, auch wenn sie
 * drei Spalten auseinanderstehen — deshalb wird der Punkt kanonisiert und als
 * Schlüssel verwendet.
 */
interface RatingColumn {
  /** Kanonische Bezeichnung, z. B. „A-7/W35". */
  point: string;
  metric: 'capacity' | 'cop';
}

const POINT_PATTERN = /(?:^|[^a-z0-9])([abw])\s*(-?\d{1,2}(?:[.,]\d)?)\s*\/\s*w\s*(\d{2,3})/i;

/**
 * Überschriften, die einer Leistungsangabe ähneln, aber etwas anderes meinen.
 *
 * Die elektrische Aufnahmeleistung und die Kälteleistung stehen in denselben
 * Tabellen wie die Heizleistung, in derselben Einheit und oft in derselben
 * Zeile. Wer sie verwechselt, bekommt eine Wärmepumpe, die um den Faktor COP
 * zu klein oder zu groß ist — und zwar ohne dass irgendeine Prüfung anschlägt,
 * weil die Zahl für sich plausibel bleibt. Solche Spalten werden deshalb gar
 * nicht erst zur Zuordnung zugelassen.
 */
const BLOCKED_FRAGMENTS = [
  'leistungsaufnahme',
  'aufnahmeleistung',
  'stromaufnahme',
  'powerinput',
  'inputpower',
  'kuehlleistung',
  'kaelteleistung',
  'coolingcapacity',
  'verdichterleistung',
];

/**
 * Überschrift auf einen Betriebspunkt prüfen.
 *
 * Spalten mit der *Aufnahme*leistung desselben Punktes werden ausdrücklich
 * nicht übernommen: sie sehen wie eine Leistungsangabe aus, meinen aber die
 * elektrische Seite. Wer sie versehentlich als Heizleistung einliest, bekommt
 * eine Wärmepumpe mit 2 kW statt 8 — ein Fehler, der sich durch die gesamte
 * Auslegung zieht und dabei plausibel aussieht.
 */
/**
 * Betriebspunkt aus beliebiger Schreibweise auf die kanonische Form bringen.
 *
 * Datenblätter schreiben denselben Punkt als „A-7/W35", „A-7 / W35",
 * „A -7 / W 35" oder „A-7/W35 nach EN 14511". Ohne Kanonisierung findet die
 * Spalte „Betriebspunkt" ihre eigene Leistungsspalte nicht wieder: Nennpunkt
 * und Leistungsspalte tragen dann verschiedene Namen, Nennleistung und COP
 * gelten als fehlend, und eine vollständige Zeile wird zurückgewiesen.
 */
function canonicalPoint(text: string): string | undefined {
  const m = POINT_PATTERN.exec(text);
  if (!m) return undefined;
  return `${m[1].toUpperCase()}${String(Number(m[2].replace(',', '.')))}/W${m[3]}`;
}

function matchRatingColumn(heading: string): RatingColumn | undefined {
  const point = canonicalPoint(heading);
  if (!point) return undefined;
  const normalized = normalizeHeading(heading);
  if (isBlockedHeading(normalized)) return undefined;
  const isCop = normalized.includes('cop') || normalized.includes('leistungszahl') || normalized.includes('efficiency');
  return { point, metric: isCop ? 'cop' : 'capacity' };
}

// ===========================================================================
// Spalten zuordnen
// ===========================================================================

interface HeadingHit {
  field: string;
  label: string;
  score: number;
  method: FieldMatch['method'];
}

/** Trifft die Überschrift eine der bewusst ausgeschlossenen Angaben? */
function isBlockedHeading(normalized: string): boolean {
  return BLOCKED_FRAGMENTS.some((fragment) => normalized.includes(fragment));
}

/** Beste Feldzuordnung einer Überschrift innerhalb einer Geräteart. */
function matchHeading(heading: string, kind: DeviceKind): { hit?: HeadingHit; suggestion?: string; blocked?: boolean } {
  if (isBlockedHeading(normalizeHeading(heading))) return { blocked: true };
  const rating = matchRatingColumn(heading);
  if (rating && kind === 'waermepumpe') {
    return {
      hit: {
        field: `punkt:${rating.point}:${rating.metric}`,
        label: rating.metric === 'cop' ? `COP ${rating.point}` : `Heizleistung ${rating.point}`,
        score: 1,
        method: 'betriebspunkt',
      },
    };
  }
  const normalized = normalizeHeading(heading);
  if (normalized === '') return {};
  let best: HeadingHit | undefined;
  for (const spec of fieldsOf(kind)) {
    // Der Feldschlüssel selbst gilt als Alias. Das ist der Weg, auf dem eine
    // JSON-Datei mit den Namen aus `HeatPumpModel` ohne Umweg ankommt.
    if (normalized === normalizeHeading(spec.key)) {
      return { hit: { field: spec.key, label: spec.label, score: 1, method: 'direkt' } };
    }
    for (const alias of spec.aliases) {
      const score = similarity(normalized, alias);
      if (!best || score > best.score) {
        best = { field: spec.key, label: spec.label, score, method: score >= 1 ? 'exakt' : 'ähnlich' };
      }
    }
  }
  if (!best) return {};
  if (best.score >= MATCH_ACCEPT) return { hit: best };
  if (best.score >= MATCH_SUGGEST) return { suggestion: best.label };
  return {};
}

/**
 * Geräteart aus den Überschriften erschließen.
 *
 * Gezählt wird nicht die Zahl der Treffer, sondern ihre Güte — eine Datei mit
 * „Nenninhalt" und „Kippmaß" ist eine Speicherliste, auch wenn sie daneben
 * „Hersteller" und „Bezeichnung" führt, die zu beidem passen.
 */
function detectKind(headings: readonly string[]): DeviceKind {
  const weight = (kind: DeviceKind): number =>
    headings.reduce((sum, heading) => {
      const rating = matchRatingColumn(heading);
      if (rating) return sum + (kind === 'waermepumpe' ? 1 : 0);
      const normalized = normalizeHeading(heading);
      if (normalized === '') return sum;
      let best = 0;
      for (const spec of FIELDS) {
        if (spec.group !== kind) continue;
        for (const alias of spec.aliases) best = Math.max(best, similarity(normalized, alias));
      }
      return sum + (best >= MATCH_ACCEPT ? best : 0);
    }, 0);
  return weight('speicher') > weight('waermepumpe') ? 'speicher' : 'waermepumpe';
}

// ===========================================================================
// Texte in Aufzählungen übersetzen
// ===========================================================================

function coerceForm(text: string): PumpForm | undefined {
  const n = normalizeHeading(text);
  if (n === '') return undefined;
  if (n.includes('split')) return 'split';
  if (n.includes('luftkanal') || n.includes('kanal')) return 'monoblock-indoor';
  if (n.includes('monoblock')) return n.includes('innen') ? 'monoblock-indoor' : 'monoblock-outdoor';
  if (n.includes('aussen') || n.includes('outdoor')) return 'monoblock-outdoor';
  if (n.includes('innen') || n.includes('indoor')) return 'indoor';
  return undefined;
}

function coerceSource(text: string): HeatSourceKind | undefined {
  const n = normalizeHeading(text);
  if (n === '') return undefined;
  if (n.includes('kollektor') || n.includes('flaechenkollektor') || n.includes('erdkollektor')) return 'brine-collector';
  if (n.includes('sole') || n.includes('brine') || n.includes('erdsonde') || n.includes('erdreich') || n.includes('geothermie')) {
    return 'brine-borehole';
  }
  if (n.includes('luft') || n.includes('air')) return 'air';
  if (n.includes('grundwasser') || n.includes('brunnen') || n.includes('wasser') || n.includes('water')) return 'groundwater';
  return undefined;
}

function coerceRefrigerant(text: string): { value: Refrigerant; exact: boolean } | undefined {
  const n = normalizeHeading(text);
  if (n === '') return undefined;
  if (n.includes('r290') || n.includes('propan')) return { value: 'R290', exact: true };
  if (n.includes('r410a')) return { value: 'R410A', exact: true };
  if (n.includes('r454c')) return { value: 'R454C', exact: true };
  if (n.includes('r1234ze')) return { value: 'R1234ze', exact: true };
  if (n.includes('r744') || n.includes('co2') || n.includes('kohlendioxid')) return { value: 'R744', exact: true };
  if (n.includes('r32') || n.includes('difluormethan')) return { value: 'R32', exact: true };
  return { value: 'andere', exact: false };
}

function coerceStorageKind(text: string): StorageKind | undefined {
  const n = normalizeHeading(text);
  if (n === '') return undefined;
  if (n.includes('kombi')) return 'combi';
  if (n.includes('frischwasser') || n.includes('durchfluss')) return 'fresh-water-station';
  if (n.includes('weiche')) return 'separator';
  if (n.includes('puffer') || n.includes('buffer')) {
    if (n.includes('parallel')) return 'buffer-parallel';
    return 'buffer-series';
  }
  if (n.includes('trinkwasser') || n.includes('warmwasser') || n.includes('brauchwasser') || n.includes('dhw')) return 'dhw-cylinder';
  return undefined;
}

function coerceMaterial(text: string): StorageModel['material'] | undefined {
  const n = normalizeHeading(text);
  if (n === '') return undefined;
  if (n.includes('email')) return 'emailliert';
  if (n.includes('edelstahl') || n.includes('inox') || n.includes('stainless')) return 'edelstahl';
  if (n.includes('kunststoff') || n.includes('polypropylen') || n.includes('pp')) return 'kunststoff';
  if (n.includes('stahl') || n.includes('steel')) return 'stahl-unlegiert';
  return undefined;
}

/**
 * Phasenzahl aus Zahl oder Text.
 *
 * Datenblätter schreiben die Elektrik unterschiedlich: „3", „3~", „400 V",
 * „3/N/PE 400 V 50 Hz" oder „1/N/PE 230 V". Die Spannung ist dabei das
 * verlässlichere Merkmal als die führende Ziffer.
 */
function coercePhases(text: string, value?: number): 1 | 3 | undefined {
  const n = text.replace(/\s/g, '').toLowerCase();
  if (n.includes('400') || n.includes('3~') || n.includes('3n') || n.includes('drehstrom')) return 3;
  if (n.includes('230') || n.includes('1~') || n.includes('1n') || n.includes('wechselstrom')) return 1;
  if (value === 3) return 3;
  if (value === 1) return 1;
  return undefined;
}

// ===========================================================================
// Zeile lesen
// ===========================================================================

interface ParsedValue {
  column: string;
  columnIndex: number;
  raw: string;
  text: string;
  number?: number;
  ambiguous: boolean;
  note?: string;
  confidence: number;
  method: FieldMatch['method'];
}

interface RowData {
  row: number;
  /** „Zeile" bei CSV, „Eintrag" bei JSON — siehe ImportedDevice.rowLabel. */
  rowWord: 'Zeile' | 'Eintrag';
  values: Map<string, ParsedValue>;
  points: Map<string, { capacity?: ParsedValue; cop?: ParsedValue }>;
  matches: FieldMatch[];
  issues: ImportIssue[];
}

/** Bereich, in dem eine Betriebspunktangabe plausibel ist. */
const POINT_RANGES: Record<'capacity' | 'cop', readonly [number, number]> = {
  capacity: [1, 100],
  cop: [1, 8],
};

function readRow(
  cells: readonly string[],
  columns: readonly ColumnMapping[],
  fileStyle: DecimalStyle,
  rowNumber: number,
  rowWord: 'Zeile' | 'Eintrag',
): RowData {
  const data: RowData = { row: rowNumber, rowWord, values: new Map(), points: new Map(), matches: [], issues: [] };
  for (const column of columns) {
    if (!column.field) continue;
    const raw = cells[column.index] ?? '';
    if (raw.trim() === '') continue;
    const style: DecimalStyle = column.decimalStyle !== 'unklar' ? column.decimalStyle : fileStyle;
    const isPoint = column.field.startsWith('punkt:');
    const spec = isPoint ? undefined : fieldSpec(column.field);
    const range = isPoint ? POINT_RANGES[column.field.endsWith(':cop') ? 'cop' : 'capacity'] : spec?.range;
    const wantsNumber = isPoint || spec?.type === 'zahl';
    const reading = wantsNumber
      ? readNumber(raw, style, range, column.field)
      : { ambiguous: false, note: undefined, value: undefined };
    const value: ParsedValue = {
      column: column.heading,
      columnIndex: column.index,
      raw,
      text: raw.trim(),
      number: reading.value,
      ambiguous: reading.ambiguous,
      note: reading.note,
      confidence: column.confidence,
      method: column.method === 'ohne' ? 'ähnlich' : column.method,
    };
    if (wantsNumber && reading.value === undefined) {
      data.issues.push({
        severity: 'warn',
        field: column.field,
        text: `Spalte „${column.heading}": „${raw.trim()}" enthält keine Zahl und wurde übergangen.`,
      });
      continue;
    }
    if (isPoint) {
      const parts = column.field.split(':');
      const point = parts[1];
      const metric = parts[2] === 'cop' ? 'cop' : 'capacity';
      const entry = data.points.get(point) ?? {};
      if (entry[metric]) {
        data.issues.push({
          severity: 'info',
          field: column.field,
          text: `Betriebspunkt ${point} steht mehrfach in der Datei; die erste Spalte gilt.`,
        });
        continue;
      }
      entry[metric] = value;
      data.points.set(point, entry);
    } else if (data.values.has(column.field)) {
      data.issues.push({
        severity: 'info',
        field: column.field,
        text: `Spalte „${column.heading}" führt auf dasselbe Feld wie eine frühere Spalte; die erste gilt.`,
      });
      continue;
    } else {
      data.values.set(column.field, value);
    }
    data.matches.push({
      field: column.field,
      label: column.label ?? column.field,
      column: column.heading,
      columnIndex: column.index,
      raw,
      value: reading.value !== undefined ? reading.value : value.text,
      confidence: column.confidence,
      method: value.method,
      note: reading.note,
    });
  }
  const width = columns.length;
  if (cells.length > width) {
    data.issues.push({
      severity: 'warn',
      text: `Die Zeile hat ${cells.length} Zellen, die Kopfzeile nur ${width}. Die überzähligen Zellen wurden nicht gelesen — vermutlich ein ungeschütztes Trennzeichen im Text.`,
    });
  }
  return data;
}

// ===========================================================================
// Plausibilität
// ===========================================================================

/**
 * Wertebereiche, in denen eine Angabe plausibel ist.
 *
 * Die Grenzen stammen aus dem, was am deutschen Markt für Wohngebäude
 * überhaupt vorkommt, nicht aus einer Norm. Sie sollen den Zahlendreher und
 * die verwechselte Einheit fangen (Watt statt Kilowatt, Millimeter statt
 * Meter), nicht die Auslegung ersetzen. Wer ein Gerät außerhalb dieser
 * Grenzen einliest, muss den Wert von Hand bestätigen.
 */
export const PLAUSIBILITY_RANGES: Readonly<Record<string, readonly [number, number]>> = Object.freeze(
  FIELDS.reduce<Record<string, readonly [number, number]>>((acc, spec) => {
    if (spec.range) acc[spec.key] = spec.range;
    return acc;
  }, {}),
);

/** Einheit aus der Vorlagenüberschrift, z. B. „Füllmenge [kg]" → „kg". */
function unitOf(spec: FieldSpec): string {
  const m = /\[([^\]]+)\]/.exec(spec.heading);
  return m ? ` ${m[1]}` : '';
}

function checkRange(spec: FieldSpec, value: number, issues: ImportIssue[]): boolean {
  if (!spec.range) return true;
  if (value >= spec.range[0] && value <= spec.range[1]) return true;
  const unit = unitOf(spec);
  issues.push({
    severity: 'error',
    field: spec.key,
    text: `${spec.label}: ${formatDe(value)}${unit} liegt außerhalb des plausiblen Bereichs von ${formatDe(
      spec.range[0],
    )}${unit} bis ${formatDe(spec.range[1])}${unit}. Einheit oder Zahlendreher prüfen.`,
  });
  return false;
}

// ===========================================================================
// Aus einer Zeile ein Gerät bauen
// ===========================================================================

function slugify(text: string): string {
  return normalizeHeading(text)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}

/** Quellentemperatur eines Betriebspunktes: „A-7/W35" → −7. */
function pointSourceTemperature(point: string): number {
  const m = /^[ABW](-?\d+(?:[.,]\d+)?)\//.exec(point);
  return m ? Number(m[1].replace(',', '.')) : NaN;
}

/** Vorlauftemperatur eines Betriebspunktes: „A-7/W35" → 35. */
function pointFlowTemperature(point: string): number {
  const m = /\/W(\d+)$/.exec(point);
  return m ? Number(m[1]) : NaN;
}

/**
 * Felder, deren Zelle regelmäßig eine andere Größe enthält als das Zielfeld,
 * und die deshalb nicht über den Wertebereich geprüft werden dürfen.
 *
 * Die Elektrik steht in Datenblättern als „400 V", „3/N/PE 400 V 50 Hz" oder
 * „3~" — gemeint ist die Phasenzahl, in der Zelle steht die Spannung. Eine
 * Bereichsprüfung gegen 1 bis 3 macht daraus einen Fehler und weist eine
 * einwandfreie Zeile zurück. Die Phasenzahl wird stattdessen aus dem Text
 * erschlossen (`coercePhases`); misslingt das, steht eine Warnung im Bericht.
 */
const RANGE_CHECK_EXEMPT = new Set(['electric.phases']);

/** Bereichsprüfung aller gelesenen Zahlen einer Zeile. */
function checkAllRanges(data: RowData, issues: ImportIssue[]): void {
  for (const [key, value] of data.values) {
    const spec = fieldSpec(key);
    if (!spec || spec.type !== 'zahl' || value.number === undefined) continue;
    if (RANGE_CHECK_EXEMPT.has(key)) continue;
    checkRange(spec, value.number, issues);
  }
  for (const [point, pair] of data.points) {
    const capacity = pair.capacity?.number;
    const cop = pair.cop?.number;
    if (capacity !== undefined && (capacity < POINT_RANGES.capacity[0] || capacity > POINT_RANGES.capacity[1])) {
      issues.push({
        severity: 'error',
        text: `Heizleistung im Punkt ${point}: ${formatDe(capacity)} kW liegt außerhalb des plausiblen Bereichs von ${formatDe(
          POINT_RANGES.capacity[0],
        )} bis ${formatDe(POINT_RANGES.capacity[1])} kW.`,
      });
    }
    if (cop !== undefined && (cop < POINT_RANGES.cop[0] || cop > POINT_RANGES.cop[1])) {
      issues.push({
        severity: 'error',
        text: `COP im Punkt ${point}: ${formatDe(cop)} liegt außerhalb des plausiblen Bereichs von ${formatDe(
          POINT_RANGES.cop[0],
        )} bis ${formatDe(POINT_RANGES.cop[1])}.`,
      });
    }
  }
  for (const [, value] of data.values) {
    if (value.ambiguous && value.note) {
      issues.push({ severity: 'info', text: `Spalte „${value.column}": ${value.note}` });
    }
  }
}

interface BuildContext {
  manufacturer?: string;
}

function buildHeatPump(data: RowData, context: BuildContext): ImportedDevice {
  const issues: ImportIssue[] = [...data.issues];
  const missing: { field: string; label: string }[] = [];
  const num = (key: string): number | undefined => {
    const v = data.values.get(key);
    return v && v.number !== undefined && Number.isFinite(v.number) ? v.number : undefined;
  };
  const txt = (key: string): string | undefined => {
    const v = data.values.get(key);
    return v && v.text !== '' ? v.text : undefined;
  };
  checkAllRanges(data, issues);

  const label = txt('label') ?? '';
  const manufacturer = txt('manufacturer') ?? context.manufacturer;

  // Bauform und Wärmequelle bestimmen, was danach gefordert wird — fehlt eine
  // von beiden, wird sie erschlossen und die Annahme offengelegt.
  //
  // Die Ersatz-Bauform darf dabei nicht pauschal die Außenaufstellung sein:
  // steht in der Zeile „Sole" oder „Wasser", kann das Gerät keine Luft-
  // Außeneinheit haben. Die Annahme „Monoblock außen" würde für ein solches
  // Gerät den Außenschallpegel als Pflichtangabe verlangen — eine Angabe, die
  // es an ihm nicht gibt — und damit eine vollständige Zeile zurückweisen.
  // Die gelesene Wärmequelle ist der stärkere Anhaltspunkt als die
  // Marktverteilung und geht ihr deshalb vor.
  const formText = txt('form');
  const sourceText = txt('source');
  const readForm = coerceForm(formText ?? '');
  const readSource = coerceSource(sourceText ?? '');
  const assumedForm: PumpForm = readSource !== undefined && readSource !== 'air' ? 'indoor' : 'monoblock-outdoor';
  // `sourceText` ist belegt, sobald `readSource` einen Wert hat; die Abfrage
  // steht nur, damit im Text keine leere Herkunft landen kann.
  const assumedFormText =
    assumedForm === 'indoor' && sourceText !== undefined
      ? `aus der Wärmequelle „${sourceText}" abgeleitet wird Innenaufstellung`
      : 'angenommen wird Monoblock in Außenaufstellung';
  const form = readForm ?? assumedForm;
  if (!formText) {
    issues.push({ severity: 'info', field: 'form', text: `Bauform fehlt; ${assumedFormText}.` });
  } else if (!readForm) {
    issues.push({ severity: 'warn', field: 'form', text: `Bauform „${formText}" nicht erkannt; ${assumedFormText}.` });
  }
  const source = readSource ?? (form === 'indoor' ? 'brine-borehole' : 'air');
  if (!sourceText) {
    issues.push({ severity: 'info', field: 'source', text: `Wärmequelle fehlt; angenommen wird ${source === 'air' ? 'Luft' : 'Sole'}.` });
  }

  const refrigerantText = txt('refrigerant');
  const refrigerantHit = coerceRefrigerant(refrigerantText ?? '');
  if (!refrigerantText) {
    missing.push({ field: 'refrigerant', label: 'Kältemittel' });
  } else if (refrigerantHit && !refrigerantHit.exact) {
    issues.push({
      severity: 'warn',
      field: 'refrigerant',
      text: `Kältemittel „${refrigerantText}" ist dem Programm unbekannt; es wird als „andere" geführt. Sicherheitsgruppe und praktischer Grenzwert nach DIN EN 378-1 müssen dann von Hand gepflegt werden.`,
    });
  }
  const refrigerant: Refrigerant = refrigerantHit?.value ?? 'andere';

  const refrigerantMass = num('refrigerantMass');
  if (refrigerantMass === undefined) missing.push({ field: 'refrigerantMass', label: 'Füllmenge Kältemittel' });

  // Betriebspunkte zusammenstellen. Ein Punkt ohne COP wird nicht übernommen:
  // `DeviceRatingPoint` führt den COP als Pflichtangabe, und eine Null dort
  // wäre eine Behauptung, die das Datenblatt nicht deckt.
  const ratings: DeviceRatingPoint[] = [];
  for (const [point, pair] of data.points) {
    const capacity = pair.capacity?.number;
    const cop = pair.cop?.number;
    if (capacity === undefined) {
      if (cop !== undefined) {
        issues.push({ severity: 'warn', text: `Betriebspunkt ${point}: COP ohne Heizleistung — der Punkt wurde übergangen.` });
      }
      continue;
    }
    if (cop === undefined) {
      issues.push({
        severity: 'warn',
        text: `Betriebspunkt ${point}: Heizleistung ohne COP — der Punkt wurde übergangen. Mit einer Spalte „COP ${point}" wird er verwendet.`,
      });
      continue;
    }
    ratings.push({ point, capacity, cop });
  }
  ratings.sort((a, b) => pointSourceTemperature(a.point) - pointSourceTemperature(b.point));

  const defaultPoint = source === 'air' ? 'A-7/W35' : source === 'groundwater' ? 'W10/W35' : 'B0/W35';
  const nominalPointText = txt('nominalPoint');
  const nominalPointCanonical = nominalPointText !== undefined ? canonicalPoint(nominalPointText) : undefined;
  const nominalPoint = nominalPointCanonical ?? (ratings.length > 0 ? ratings[0].point : defaultPoint);
  if (nominalPointText === undefined) {
    issues.push({ severity: 'info', field: 'nominalPoint', text: `Betriebspunkt der Nennleistung fehlt; angenommen wird ${nominalPoint}.` });
  } else if (nominalPointCanonical === undefined) {
    issues.push({
      severity: 'warn',
      field: 'nominalPoint',
      text: `Betriebspunkt „${nominalPointText}" ist nicht als Punkt lesbar; angenommen wird ${nominalPoint}. Erwartet wird die Schreibweise A-7/W35.`,
    });
  } else if (nominalPointCanonical !== nominalPointText) {
    issues.push({
      severity: 'info',
      field: 'nominalPoint',
      text: `Betriebspunkt „${nominalPointText}" wurde als ${nominalPointCanonical} gelesen.`,
    });
  }
  const atNominal = ratings.find((r) => r.point === nominalPoint);
  const nominalCapacity = num('nominalCapacity') ?? atNominal?.capacity;
  if (nominalCapacity === undefined) missing.push({ field: 'nominalCapacity', label: 'Heizleistung' });
  const nominalCop = num('copNominal') ?? atNominal?.cop;
  if (nominalCop === undefined) {
    issues.push({
      severity: 'error',
      field: 'copNominal',
      text: 'Kein COP im Nennpunkt. Ohne Leistungszahl ist keine Aussage zu Effizienz und Stromaufnahme möglich; das Gerät bleibt eine Typklasse.',
    });
  }
  if (!atNominal && nominalCapacity !== undefined && nominalCop !== undefined) {
    ratings.push({ point: nominalPoint, capacity: nominalCapacity, cop: nominalCop });
    ratings.sort((a, b) => pointSourceTemperature(a.point) - pointSourceTemperature(b.point));
  }

  const maxFlowTemperature = num('maxFlowTemperature');
  if (maxFlowTemperature === undefined) missing.push({ field: 'maxFlowTemperature', label: 'höchste Vorlauftemperatur' });

  const soundPowerOutdoor = num('soundPowerOutdoor');
  // Gefordert wird der Außenschallpegel nur dort, wo es eine Außeneinheit im
  // Freien gibt. Darüber entscheidet die Bauform zusammen mit der Wärmequelle:
  // ein Sole- oder Wassergerät hat keinen Ventilator im Freien, gleich welche
  // Bauform im Datenblatt steht, und ein Luftgerät mit Kanälen im Haus
  // ebenfalls nicht.
  const hasOutdoorUnit = source === 'air' && form !== 'indoor' && form !== 'monoblock-indoor';
  if (soundPowerOutdoor === undefined && hasOutdoorUnit) {
    missing.push({ field: 'soundPowerOutdoor', label: 'Schallleistungspegel außen' });
  }

  const width = num('outdoor.width');
  const depth = num('outdoor.depth');
  const height = num('outdoor.height');
  const weight = num('outdoor.weight');
  const outdoor =
    width !== undefined && depth !== undefined && height !== undefined
      ? { width, depth, height, weight: weight ?? 0 }
      : undefined;
  if (outdoor && weight === undefined) {
    issues.push({ severity: 'warn', field: 'outdoor.weight', text: 'Gewicht der Außeneinheit fehlt; für die Fundamentlast muss es nachgetragen werden.' });
  }
  const inWidth = num('indoor.width');
  const inDepth = num('indoor.depth');
  const inHeight = num('indoor.height');
  const inWeight = num('indoor.weight');
  const indoor =
    inWidth !== undefined && inDepth !== undefined && inHeight !== undefined
      ? {
          width: inWidth,
          depth: inDepth,
          height: inHeight,
          weight: inWeight ?? 0,
          integratedCylinder: num('indoor.integratedCylinder'),
          integratedBuffer: num('indoor.integratedBuffer'),
          backupHeater: num('electric.backupHeater'),
        }
      : undefined;
  if (indoor && inWeight === undefined) {
    issues.push({
      severity: 'warn',
      field: 'indoor.weight',
      text: 'Gewicht des Innengeräts fehlt; für Transportweg und Aufstellfläche muss es nachgetragen werden.',
    });
  }
  // Ohne vollständige Maße entsteht kein Innengerät im Modell: `indoor` führt
  // Breite, Tiefe und Höhe als Pflichtangaben, und eine 0 wäre dort ein
  // erfundener Körper, der in jeder Aufstellungs- und Transportprüfung als
  // gemessen gälte. Der gewählte Weg ist deshalb nicht „ersatzweise 0", sondern
  // die Meldung — dieselbe Behandlung wie beim Betriebspunkt ohne COP weiter
  // oben: erkannt, nicht übernommen, und genau das steht im Bericht. Eine
  // Warnung reicht dafür; die Zeile bleibt übernehmbar, weil das Innengerät
  // keine Pflichtangabe ist und die übrige Zeile davon unberührt bleibt.
  //
  // `electric.backupHeater` steht bewusst nicht in dieser Liste: der Heizstab
  // kommt über `electric.backupHeater` im Modell an, auch ohne Innengerät —
  // eine Meldung „nicht übernommen" wäre dort schlicht falsch.
  if (indoor === undefined) {
    const missingDimensions = [
      inWidth === undefined ? 'Breite' : '',
      inDepth === undefined ? 'Tiefe' : '',
      inHeight === undefined ? 'Höhe' : '',
    ].filter((name) => name !== '');
    const dimensionText =
      missingDimensions.length === 1
        ? `fehlt die ${missingDimensions[0]}`
        : `fehlen ${missingDimensions.slice(0, -1).join(', ')} und ${missingDimensions[missingDimensions.length - 1]}`;
    const droppedIndoor: { key: string; label: string; unit: string }[] = [
      { key: 'indoor.integratedCylinder', label: 'Integrierter Trinkwasserspeicher', unit: 'l' },
      { key: 'indoor.integratedBuffer', label: 'Integrierter Puffer', unit: 'l' },
      { key: 'indoor.weight', label: 'Gewicht des Innengeräts', unit: 'kg' },
    ];
    for (const dropped of droppedIndoor) {
      const value = num(dropped.key);
      if (value === undefined) continue;
      issues.push({
        severity: 'warn',
        field: dropped.key,
        text: `${dropped.label}: ${formatDe(value)} ${dropped.unit} wurde gelesen, aber nicht übernommen — zum Innengerät ${dimensionText}. Mit den Maßen des Innengeräts kommt der Wert an; sonst ist er von Hand nachzutragen.`,
      });
    }
  }

  const lineLiquid = txt('refrigerantLines.liquid');
  const lineGas = txt('refrigerantLines.gas');
  const refrigerantLines =
    lineLiquid && lineGas
      ? {
          liquid: lineLiquid,
          gas: lineGas,
          maxLength: num('refrigerantLines.maxLength') ?? 0,
          maxHeight: num('refrigerantLines.maxHeight') ?? 0,
        }
      : undefined;
  if (form === 'split' && !refrigerantLines) {
    issues.push({
      severity: 'warn',
      field: 'refrigerantLines.liquid',
      text: 'Split-Gerät ohne Angabe der Kältemittelleitungen — Leitungslänge und Höhendifferenz bestimmen, ob die geplante Führung zulässig ist.',
    });
  }

  // Ersatzwerte werden nur aus einer Nennleistung gebildet, die selbst im
  // plausiblen Bereich liegt. Sonst erzeugt eine in Watt eingetragene Leistung
  // Folgeangaben wie „881,5 m³/h", die im Bericht zwischen den echten
  // Meldungen stehen und von der eigentlichen Ursache ablenken.
  const capacityRange = fieldSpec('nominalCapacity')?.range;
  const capacityForDefaults =
    nominalCapacity !== undefined && (!capacityRange || (nominalCapacity >= capacityRange[0] && nominalCapacity <= capacityRange[1]))
      ? nominalCapacity
      : 0;
  // Mindestvolumenstrom und Mindestwasserinhalt stehen selten im Prospekt.
  // Fehlen sie, gilt derselbe offengelegte Zusammenhang wie im Katalog:
  // 0,1075 m³/(h·kW) entspricht dem Nennvolumenstrom bei 8 K Spreizung,
  // 12 l/kW ist der Erfahrungswert für die Abtauung bei Luftgeräten.
  let minVolumeFlow = num('minVolumeFlow');
  if (minVolumeFlow === undefined && capacityForDefaults > 0) {
    minVolumeFlow = Math.round(capacityForDefaults * 0.1075 * 100) / 100;
    issues.push({
      severity: 'info',
      field: 'minVolumeFlow',
      text: `Mindestvolumenstrom fehlt; angesetzt werden ${formatDe(minVolumeFlow)} m³/h aus 8 K Spreizung bei Nennleistung.`,
    });
  }
  let minSystemVolume = num('minSystemVolume');
  if (minSystemVolume === undefined && capacityForDefaults > 0) {
    minSystemVolume = Math.round(capacityForDefaults * (source === 'air' ? 12 : 4));
    issues.push({
      severity: 'info',
      field: 'minSystemVolume',
      text: `Mindestwasserinhalt fehlt; angesetzt werden ${minSystemVolume} l aus dem Erfahrungswert ${source === 'air' ? '12' : '4'} l/kW.`,
    });
  }

  const phases = coercePhases(txt('electric.phases') ?? '', num('electric.phases'));
  const fuse = num('electric.fuse');
  if (phases === undefined) {
    issues.push({ severity: 'warn', field: 'electric.phases', text: 'Phasenzahl fehlt; angenommen wird ein dreiphasiger Anschluss.' });
  }
  if (fuse === undefined) {
    issues.push({ severity: 'warn', field: 'electric.fuse', text: 'Absicherung fehlt; sie ist für die Anmeldung beim Netzbetreiber erforderlich.' });
  }

  const hydraulicConnection = txt('hydraulicConnection') ?? 'nicht angegeben';
  const model: HeatPumpModel = {
    id: txt('id') ?? slugify([manufacturer, label].filter(Boolean).join(' ')),
    label: label !== '' ? label : 'ohne Bezeichnung',
    series: txt('series') ?? (label !== '' ? label : 'ohne Bezeichnung'),
    form,
    source,
    refrigerant,
    refrigerantMass: refrigerantMass ?? 0,
    nominalCapacity: nominalCapacity ?? 0,
    nominalPoint,
    ratings,
    scop35: num('scop35'),
    scop55: num('scop55'),
    maxFlowTemperature: maxFlowTemperature ?? 0,
    soundPowerOutdoor,
    soundPowerNight: num('soundPowerNight'),
    soundPowerIndoor: num('soundPowerIndoor'),
    outdoor,
    indoor,
    hydraulicConnection,
    refrigerantLines,
    minVolumeFlow: minVolumeFlow ?? 0,
    minSystemVolume: minSystemVolume ?? 0,
    electric: {
      phases: phases ?? 3,
      fuse: fuse ?? 0,
      maxCurrent: num('electric.maxCurrent'),
      startCurrent: num('electric.startCurrent'),
      backupHeater: num('electric.backupHeater'),
    },
    provenance: 'hersteller',
    manufacturer,
    note: txt('note'),
  };
  if (label === '') missing.push({ field: 'label', label: 'Bezeichnung' });
  if (model.id === '') model.id = `import-${data.rowWord.toLowerCase()}-${data.row}`;

  crossCheckHeatPump(model, issues);
  return finishDevice(data, 'waermepumpe', { heatPump: model }, missing, issues, model.label);
}

/**
 * Querprüfungen an einer eingelesenen Wärmepumpe.
 *
 * Ein Zahlendreher liegt fast nie außerhalb des plausiblen Bereichs — er
 * liegt *innerhalb* und passt nur nicht zum Rest des Datenblatts. Genau diese
 * Widersprüche sucht diese Prüfung: physikalisch Unmögliches wird zum
 * Ausschlussgrund, Auffälliges zur Warnung.
 */
function crossCheckHeatPump(model: HeatPumpModel, issues: ImportIssue[]): void {
  const atNominal = model.ratings.find((r) => r.point === model.nominalPoint);
  if (atNominal && model.nominalCapacity > 0) {
    const deviation = Math.abs(atNominal.capacity - model.nominalCapacity) / model.nominalCapacity;
    if (deviation > 0.1) {
      issues.push({
        severity: 'warn',
        field: 'nominalCapacity',
        text: `Nennleistung ${formatDe(model.nominalCapacity)} kW und Leistung im Punkt ${model.nominalPoint} (${formatDe(
          atNominal.capacity,
        )} kW) weichen um ${Math.round(deviation * 100)} % voneinander ab. Beziehen sich beide auf denselben Punkt?`,
      });
    }
  }
  // Der COP steigt mit der Quellentemperatur — bei gleicher Vorlauftemperatur
  // gibt es dazu keine Ausnahme. Fällt er, stimmt die Zuordnung der Spalten
  // nicht oder eine Zahl ist verdreht.
  const families = new Map<number, DeviceRatingPoint[]>();
  for (const rating of model.ratings) {
    const flow = pointFlowTemperature(rating.point);
    if (!Number.isFinite(flow)) continue;
    const list = families.get(flow) ?? [];
    list.push(rating);
    families.set(flow, list);
  }
  for (const [flow, list] of families) {
    const sorted = [...list].sort((a, b) => pointSourceTemperature(a.point) - pointSourceTemperature(b.point));
    for (let i = 1; i < sorted.length; i += 1) {
      if (sorted[i].cop < sorted[i - 1].cop - 0.01) {
        issues.push({
          severity: 'error',
          text: `Bei ${flow} °C Vorlauf fällt der COP von ${formatDe(sorted[i - 1].cop)} (${sorted[i - 1].point}) auf ${formatDe(
            sorted[i].cop,
          )} (${sorted[i].point}), obwohl die Quelle wärmer wird. Das ist physikalisch nicht möglich.`,
        });
        break;
      }
    }
  }
  if (model.scop35 !== undefined && model.scop55 !== undefined && model.scop55 > model.scop35) {
    issues.push({
      severity: 'warn',
      field: 'scop55',
      text: `SCOP bei 55 °C (${formatDe(model.scop55)}) liegt über dem bei 35 °C (${formatDe(model.scop35)}). Vermutlich sind die beiden Spalten vertauscht.`,
    });
  }
  if (
    model.soundPowerNight !== undefined &&
    model.soundPowerOutdoor !== undefined &&
    model.soundPowerOutdoor > 0 &&
    model.soundPowerNight >= model.soundPowerOutdoor
  ) {
    issues.push({
      severity: 'warn',
      field: 'soundPowerNight',
      text: `Der Nachtbetrieb ist mit ${formatDe(model.soundPowerNight)} dB(A) nicht leiser als der Normalbetrieb (${formatDe(
        model.soundPowerOutdoor,
      )} dB(A)).`,
    });
  }
  if (model.refrigerantMass > 0 && model.nominalCapacity > 0) {
    // Marktübliche Füllmengen liegen bei 0,10 bis 0,25 kg/kW (Monoblock) und
    // bis etwa 0,35 kg/kW (Split mit langen Leitungen). Alles jenseits von
    // 0,6 kg/kW oder unterhalb von 0,02 kg/kW ist erklärungsbedürftig.
    const perKw = model.refrigerantMass / model.nominalCapacity;
    if (perKw > 0.6 || perKw < 0.02) {
      issues.push({
        severity: 'warn',
        field: 'refrigerantMass',
        text: `Füllmenge ${formatDe(model.refrigerantMass)} kg bei ${formatDe(model.nominalCapacity)} kW entspricht ${formatDe(
          perKw,
        )} kg/kW und liegt weit außerhalb des Üblichen (0,10 bis 0,35 kg/kW).`,
      });
    }
  }
  // Steht der maximale Betriebsstrom im Datenblatt, ist er die bessere
  // Grundlage als jede Rechnung: er ist gemessen, die Rechnung geschätzt.
  if (model.electric.maxCurrent !== undefined && model.electric.fuse > 0 && model.electric.fuse < model.electric.maxCurrent) {
    issues.push({
      severity: 'error',
      field: 'electric.fuse',
      text: `Die angegebene Absicherung von ${formatDe(model.electric.fuse)} A liegt unter dem angegebenen maximalen Betriebsstrom von ${formatDe(
        model.electric.maxCurrent,
      )} A. Eine der beiden Angaben stimmt nicht.`,
    });
  }
  if (
    model.electric.maxCurrent === undefined &&
    model.electric.fuse > 0 &&
    model.nominalCapacity > 0 &&
    atNominal &&
    atNominal.cop > 0
  ) {
    // Aufnahmeleistung aus Heizleistung und COP, daraus der Strangstrom:
    // einphasig I = P / U mit U = 230 V, dreiphasig I = P / (√3 · U) mit
    // U = 400 V Außenleiterspannung. Der Leistungsfaktor wird mit 1
    // angesetzt — das unterschätzt den Strom leicht und ist damit die
    // vorsichtige Richtung: die Meldung schlägt eher zu spät an als zu früh.
    const input = model.nominalCapacity / atNominal.cop;
    const current = model.electric.phases === 3 ? (input * 1000) / (Math.sqrt(3) * 400) : (input * 1000) / 230;
    if (model.electric.fuse < current) {
      issues.push({
        severity: 'error',
        field: 'electric.fuse',
        text: `Die angegebene Absicherung von ${formatDe(model.electric.fuse)} A liegt unter dem rechnerischen Betriebsstrom von ${formatDe(
          Math.round(current * 10) / 10,
        )} A (${formatDe(Math.round(input * 100) / 100)} kW Aufnahme bei ${
          model.electric.phases === 1 ? 'einer Phase' : `${model.electric.phases} Phasen`
        }).`,
      });
    }
  }
  if (model.maxFlowTemperature > 0 && model.ratings.some((r) => pointFlowTemperature(r.point) > model.maxFlowTemperature)) {
    issues.push({
      severity: 'error',
      field: 'maxFlowTemperature',
      text: `Es sind Betriebspunkte oberhalb der angegebenen Höchst-Vorlauftemperatur von ${formatDe(
        model.maxFlowTemperature,
      )} °C aufgeführt.`,
    });
  }
}

function buildStorage(data: RowData, context: BuildContext): ImportedDevice {
  const issues: ImportIssue[] = [...data.issues];
  const missing: { field: string; label: string }[] = [];
  const num = (key: string): number | undefined => {
    const v = data.values.get(key);
    return v && v.number !== undefined && Number.isFinite(v.number) ? v.number : undefined;
  };
  const txt = (key: string): string | undefined => {
    const v = data.values.get(key);
    return v && v.text !== '' ? v.text : undefined;
  };
  checkAllRanges(data, issues);

  const label = txt('label') ?? '';
  if (label === '') missing.push({ field: 'label', label: 'Bezeichnung' });
  const manufacturer = txt('manufacturer') ?? context.manufacturer;

  const kindText = txt('kind');
  const kind = coerceStorageKind(kindText ?? '') ?? coerceStorageKind(label) ?? 'dhw-cylinder';
  if (!kindText && !coerceStorageKind(label)) {
    issues.push({
      severity: 'warn',
      field: 'kind',
      text: 'Speicherart fehlt; angenommen wird ein Trinkwasserspeicher. Die Art entscheidet über die hydraulische Einbindung — bitte prüfen.',
    });
  }

  const volume = num('volume');
  if (volume === undefined) missing.push({ field: 'volume', label: 'Nenninhalt' });
  const diameter = num('diameter');
  if (diameter === undefined) missing.push({ field: 'diameter', label: 'Durchmesser' });
  const height = num('height');
  if (height === undefined) missing.push({ field: 'height', label: 'Höhe' });

  const potable = kind === 'dhw-cylinder' || kind === 'combi';
  const pressurePotable = num('maxPressure.potable');
  const pressureHeating = num('maxPressure.heating');
  // Die Ersatzwerte 10 bar trinkwasserseitig und 3 bar heizungsseitig sind die
  // marktüblichen Typenschildwerte, keine Norm- und keine Herstellerangabe.
  // Sie stehen nur da, weil das Feld sonst unbesetzt bliebe, und werden mit
  // Wert benannt — die Ansprechdrücke der Sicherheitsventile hängen daran.
  const maxPressure =
    pressurePotable !== undefined || pressureHeating !== undefined
      ? { potable: pressurePotable ?? (potable ? 10 : 0), heating: pressureHeating ?? 3 }
      : undefined;
  if (maxPressure && pressurePotable === undefined) {
    issues.push({
      severity: 'warn',
      field: 'maxPressure.potable',
      text: `Der trinkwasserseitige Betriebsdruck war nicht angegeben; angesetzt sind ${formatDe(
        maxPressure.potable,
      )} bar. Der Wert bestimmt das Sicherheitsventil und ist am Typenschild zu prüfen.`,
    });
  }
  if (maxPressure && pressureHeating === undefined) {
    issues.push({
      severity: 'warn',
      field: 'maxPressure.heating',
      text: `Der heizungsseitige Betriebsdruck war nicht angegeben; angesetzt sind ${formatDe(
        maxPressure.heating,
      )} bar. Der Wert bestimmt das Sicherheitsventil und ist am Typenschild zu prüfen.`,
    });
  }

  const materialText = txt('material');
  const material = coerceMaterial(materialText ?? '');
  if (materialText && !material) {
    issues.push({ severity: 'warn', field: 'material', text: `Werkstoff „${materialText}" nicht erkannt; das Feld bleibt leer.` });
  }

  const model: StorageModel = {
    id: txt('id') ?? slugify([manufacturer, label].filter(Boolean).join(' ')),
    label: label !== '' ? label : 'ohne Bezeichnung',
    kind,
    volume: volume ?? 0,
    potableVolume: num('potableVolume'),
    coilArea: num('coilArea'),
    continuousOutput: num('continuousOutput'),
    performanceIndex: num('performanceIndex'),
    standbyLoss: num('standbyLoss'),
    diameter: diameter ?? 0,
    height: height ?? 0,
    tiltHeight: num('tiltHeight'),
    material,
    maxPressure,
    provenance: 'hersteller',
    manufacturer,
    note: txt('note'),
  };
  if (model.id === '') model.id = `import-${data.rowWord.toLowerCase()}-${data.row}`;

  crossCheckStorage(model, issues);
  return finishDevice(data, 'speicher', { storage: model }, missing, issues, model.label);
}

/** Querprüfungen an einem eingelesenen Speicher. */
function crossCheckStorage(model: StorageModel, issues: ImportIssue[]): void {
  if (model.diameter > 0 && model.height > 0 && model.volume > 0) {
    // Der Behälter kann nicht mehr fassen, als sein äußerer Umriss hergibt.
    // Das ist keine Auslegungsregel, sondern Geometrie: die Dämmung und die
    // gewölbten Böden machen den nutzbaren Inhalt kleiner, nie größer.
    const envelope = (Math.PI / 4) * model.diameter ** 2 * model.height * 1000;
    if (model.volume > envelope * 1.05) {
      issues.push({
        severity: 'error',
        field: 'volume',
        text: `Ein Zylinder mit ${formatDe(model.diameter)} m Durchmesser und ${formatDe(model.height)} m Höhe fasst höchstens ${Math.round(
          envelope,
        )} l; angegeben sind ${formatDe(model.volume)} l. Vermutlich sind die Maße in Millimetern eingetragen.`,
      });
    }
  }
  if (model.tiltHeight !== undefined && model.height > 0 && model.tiltHeight < model.height) {
    issues.push({
      severity: 'error',
      field: 'tiltHeight',
      text: `Das Kippmaß (${formatDe(model.tiltHeight)} m) kann nicht kleiner sein als die Höhe (${formatDe(model.height)} m).`,
    });
  }
  if (model.potableVolume !== undefined && model.volume > 0 && model.potableVolume > model.volume) {
    issues.push({
      severity: 'error',
      field: 'potableVolume',
      text: `Der Trinkwasseranteil (${formatDe(model.potableVolume)} l) ist größer als der Nenninhalt (${formatDe(model.volume)} l).`,
    });
  }
  if (model.kind === 'dhw-cylinder' && model.coilArea !== undefined && model.volume > 0) {
    // Für Wärmepumpen gilt der Praxisrichtwert von rund 1,4 m² je 100 l.
    // Deutlich weniger heißt: der Speicher ist für einen Kessel gebaut.
    const perHundred = model.coilArea / (model.volume / 100);
    if (perHundred < 0.8) {
      issues.push({
        severity: 'warn',
        field: 'coilArea',
        text: `Die Wärmetauscherfläche beträgt nur ${formatDe(Math.round(perHundred * 100) / 100)} m² je 100 l. Für den Betrieb mit einer Wärmepumpe sind rund 1,4 m² je 100 l üblich — sonst springt der Heizstab ein.`,
      });
    }
  }
}

/** Bericht einer Zeile abschließen und die Übernahmeentscheidung fällen. */
function finishDevice(
  data: RowData,
  kind: DeviceKind,
  device: { heatPump?: HeatPumpModel; storage?: StorageModel },
  missing: { field: string; label: string }[],
  issues: ImportIssue[],
  label: string,
): ImportedDevice {
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.filter((i) => i.severity === 'warn').length;
  const accepted = missing.length === 0 && errors === 0;
  const rowLabel = `${data.rowWord} ${data.row}`;
  const parts: string[] = [`${rowLabel}: „${label}" — ${data.matches.length} Felder erkannt`];
  if (missing.length > 0) parts.push(missing.length === 1 ? '1 Pflichtangabe fehlt' : `${missing.length} Pflichtangaben fehlen`);
  if (errors > 0) parts.push(errors === 1 ? '1 unplausibler Wert' : `${errors} unplausible Werte`);
  if (warnings > 0) parts.push(`${warnings} Warnung${warnings === 1 ? '' : 'en'}`);
  parts.push(accepted ? 'übernehmbar' : 'nicht übernehmbar');
  return {
    row: data.row,
    rowLabel,
    kind,
    heatPump: device.heatPump,
    storage: device.storage,
    matches: data.matches,
    missing,
    issues,
    accepted,
    summary: `${parts.join(', ')}.`,
  };
}

// ===========================================================================
// Einlesen — CSV
// ===========================================================================

function emptyReport(format: DeviceImportReport['format'], kind: DeviceKind, issues: ImportIssue[], summary: string): DeviceImportReport {
  return {
    format,
    decimalStyle: 'unklar',
    kind,
    columns: [],
    devices: [],
    acceptedCount: 0,
    rejectedCount: 0,
    issues,
    summary,
  };
}


/**
 * Der gemeinsame Kern beider Formate.
 *
 * CSV und JSON unterscheiden sich nur darin, wie aus der Datei eine Tabelle
 * mit Überschriften und Zellen wird. Alles danach — Spaltenzuordnung,
 * Zahlenformat, Prüfung, Bericht — ist identisch und steht deshalb nur an
 * einer Stelle. Der Nebeneffekt ist wichtig: ein JSON-Import kann nicht
 * strenger oder milder ausfallen als ein CSV-Import derselben Daten.
 */
function buildReport(
  headings: readonly string[],
  dataRows: readonly string[][],
  dataLines: readonly number[],
  options: DeviceImportOptions,
  format: 'csv' | 'json',
  delimiter?: string,
  preIssues: readonly ImportIssue[] = [],
): DeviceImportReport {
  const issues: ImportIssue[] = [...preIssues];
  const kind = options.kind ?? detectKind(headings);
  // Dateiweites Zahlenformat als letzte Instanz. Für JSON ist diese letzte
  // Instanz nicht „unklar", sondern der Punkt: JSON-Zahlen sind sprachneutral
  // und tragen immer einen Dezimalpunkt. Ohne diesen Vorrang würde eine Datei,
  // deren einzige Zahl 1.234 ist, den Wert über den Wertebereich raten und
  // notfalls als 1234 lesen. Zeichenketten in JSON dürfen trotzdem deutsch
  // sein — sie belegen das Format ihrer Spalte, und die Spalte geht vor.
  const detectedStyle = detectDecimalStyle(dataRows.flat());
  const fileStyle: DecimalStyle =
    options.decimalStyle ?? (detectedStyle !== 'unklar' ? detectedStyle : format === 'json' ? 'punkt' : 'unklar');

  const used = new Set<string>();
  const duplicates = new Set<number>();
  const blockedColumns = new Set<number>();
  const columns: ColumnMapping[] = headings.map((heading, index) => {
    const columnCells = dataRows.map((row) => row[index] ?? '');
    const decimalStyle = options.decimalStyle ?? detectDecimalStyle(columnCells);
    const { hit, suggestion, blocked } = matchHeading(heading, kind);
    if (blocked) {
      issues.push({
        severity: 'info',
        text: `Die Spalte „${heading}" beschreibt nicht die Heizleistung, sondern Aufnahme- oder Kälteleistung, und wurde bewusst übergangen.`,
      });
      blockedColumns.add(index);
      return { index, heading, confidence: 0, method: 'ohne', decimalStyle };
    }
    if (!hit) {
      return { index, heading, confidence: 0, method: 'ohne', suggestion, decimalStyle };
    }
    if (used.has(hit.field)) {
      issues.push({
        severity: 'info',
        text: `Die Spalte „${heading}" führt auf dasselbe Feld wie eine frühere Spalte; nur die erste wird gelesen.`,
      });
      duplicates.add(index);
      return { index, heading, confidence: 0, method: 'ohne', suggestion: hit.label, decimalStyle };
    }
    used.add(hit.field);
    return {
      index,
      heading,
      field: hit.field,
      label: hit.label,
      confidence: Math.round(hit.score * 100) / 100,
      method: hit.method,
      decimalStyle,
    };
  });

  const mapped = columns.filter((c) => c.field !== undefined);
  if (mapped.length < 2) {
    const numericHeadings = headings.filter((h) => numberToken(h) !== undefined && normalizeHeading(h).length < 4).length;
    const hint =
      numericHeadings >= Math.max(2, Math.ceil(headings.length / 2))
        ? 'Die erste Zeile besteht überwiegend aus Zahlen — vermutlich fehlt die Kopfzeile.'
        : 'Keine der Überschriften konnte einem Feld zugeordnet werden.';
    issues.push({ severity: 'error', text: `${hint} Die Importvorlage zeigt, welche Überschriften erwartet werden.` });
    return {
      ...emptyReport(format, kind, issues, `Kopfzeile nicht erkannt. ${hint}`),
      delimiter,
      decimalStyle: fileStyle,
      columns,
    };
  }
  for (const column of columns) {
    if (column.field !== undefined || column.heading.trim() === '') continue;
    if (duplicates.has(column.index) || blockedColumns.has(column.index)) continue;
    issues.push({
      severity: 'info',
      text: column.suggestion
        ? `Die Spalte „${column.heading}" wurde nicht übernommen; gemeint sein könnte „${column.suggestion}".`
        : `Die Spalte „${column.heading}" wurde nicht übernommen.`,
    });
  }
  if (dataRows.length === 0) {
    issues.push({ severity: 'warn', text: 'Die Datei enthält nur eine Kopfzeile und keine Gerätedaten.' });
  }

  const context: BuildContext = { manufacturer: options.manufacturer };
  const devices = dataRows.map((cells, i) => {
    const data = readRow(cells, columns, fileStyle, dataLines[i] ?? i + 2, format === 'json' ? 'Eintrag' : 'Zeile');
    return kind === 'speicher' ? buildStorage(data, context) : buildHeatPump(data, context);
  });
  const acceptedCount = devices.filter((d) => d.accepted).length;
  const rejectedCount = devices.length - acceptedCount;
  const styleText = fileStyle === 'komma' ? 'deutsch (Dezimalkomma)' : fileStyle === 'punkt' ? 'englisch (Dezimalpunkt)' : 'nicht belegt';
  const source =
    format === 'csv'
      ? `Trennzeichen ${delimiter === '\t' ? 'Tabulator' : `„${delimiter ?? ';'}"`}, Zahlenformat ${styleText}`
      : `Zahlenformat ${styleText}`;
  return {
    format,
    delimiter,
    decimalStyle: fileStyle,
    kind,
    columns,
    devices,
    acceptedCount,
    rejectedCount,
    issues,
    summary: `${devices.length} ${devices.length === 1 ? 'Datensatz' : 'Datensätze'} gelesen, ${acceptedCount} übernehmbar, ${rejectedCount} zurückgewiesen. ${source}, ${mapped.length} von ${columns.length} Spalten zugeordnet.`,
  };
}

/**
 * CSV einlesen.
 *
 * Der Ablauf ist bewusst so gestaffelt, dass jeder Schritt scheitern darf,
 * ohne den nächsten mitzureißen: fehlt die Kopfzeile, endet der Lauf mit
 * einem verständlichen Bericht statt mit einer Ausnahme; fehlt eine Spalte,
 * fehlt nur diese eine Angabe; ist eine Zeile kaputt, betrifft das nur sie.
 */
/**
 * Die Kopfzeile suchen.
 *
 * Aus einem Prospekt oder einer PDF-Tabelle kopierte Dateien tragen über den
 * Überschriften oft eine Titelzeile („Technische Daten 2026") oder eine Zeile
 * mit dem Herstellernamen. Ohne Suche endet so eine Datei mit der Meldung,
 * keine Überschrift sei zuzuordnen — obwohl sie vollständig ist.
 *
 * Genommen wird die *erste* Zeile der ersten fünf, die mindestens zwei Felder
 * trifft. „Erste" statt „beste" ist Absicht: solange die erste Zeile bereits
 * eine Kopfzeile ist, ändert die Suche nichts an ihrem Ergebnis.
 */
function findHeaderRow(rows: readonly string[][], options: DeviceImportOptions): number {
  const limit = Math.min(rows.length, 5);
  for (let index = 0; index < limit; index += 1) {
    const headings = rows[index];
    const kind = options.kind ?? detectKind(headings);
    const mapped = headings.filter((heading) => matchHeading(heading, kind).hit !== undefined).length;
    if (mapped >= 2) return index;
  }
  return 0;
}

export function importDevicesFromCsv(text: string, options: DeviceImportOptions = {}): DeviceImportReport {
  if (text.trim() === '') {
    return emptyReport('csv', options.kind ?? 'waermepumpe', [{ severity: 'error', text: 'Die Datei ist leer.' }], 'Die Datei ist leer.');
  }
  const parsed = parseCsv(text, options.delimiter);
  if (parsed.rows.length === 0) {
    return emptyReport(
      'csv',
      options.kind ?? 'waermepumpe',
      [{ severity: 'error', text: 'Die Datei enthält keine auswertbaren Zeilen.' }],
      'Die Datei enthält keine auswertbaren Zeilen.',
    );
  }
  const header = findHeaderRow(parsed.rows, options);
  const preIssues: ImportIssue[] =
    header > 0
      ? [
          {
            severity: 'info',
            text: `Die Kopfzeile steht in Zeile ${parsed.lines[header]}; ${
              header === 1 ? 'die Zeile davor wurde' : `die ${header} Zeilen davor wurden`
            } als Titel übergangen.`,
          },
        ]
      : [];
  return buildReport(
    parsed.rows[header],
    parsed.rows.slice(header + 1),
    parsed.lines.slice(header + 1),
    options,
    'csv',
    parsed.delimiter,
    preIssues,
  );
}

// ===========================================================================
// Einlesen — JSON
// ===========================================================================

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Schlüssel, unter denen eine Datei ihre Geräteliste einpackt. */
const JSON_WRAPPERS = ['devices', 'geraete', 'models', 'modelle', 'items', 'daten', 'data', 'liste'];

/** Skalar in Text — JSON-Zahlen tragen immer einen Dezimalpunkt. */
function scalarToText(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : undefined;
  if (typeof value === 'boolean') return value ? 'ja' : 'nein';
  return undefined;
}

/**
 * Ein JSON-Objekt in eine Zeile der gemeinsamen Tabelle übersetzen.
 *
 * Verschachtelte Objekte werden mit Punktschreibweise flach gemacht
 * (`outdoor.width`), damit sie dieselben Feldschlüssel treffen wie eine
 * CSV-Spalte. Die Liste `ratings` ist der einzige Sonderfall: sie wird in
 * dieselben Betriebspunkt-Spalten übersetzt, die auch eine CSV-Kopfzeile
 * erzeugen würde.
 */
function flattenRecord(record: Record<string, unknown>, into: Map<string, string>): void {
  for (const [key, value] of Object.entries(record)) {
    if (value === null || value === undefined) continue;
    const normalizedKey = normalizeHeading(key);
    if (Array.isArray(value)) {
      if (normalizedKey === 'ratings' || normalizedKey === 'betriebspunkte' || normalizedKey === 'punkte') {
        for (const entry of value) {
          if (!isRecord(entry)) continue;
          const point = scalarToText(entry.point ?? entry.punkt ?? entry.bezeichnung);
          if (!point) continue;
          const capacity = scalarToText(entry.capacity ?? entry.heizleistung ?? entry.leistung);
          const cop = scalarToText(entry.cop ?? entry.leistungszahl);
          if (capacity !== undefined) into.set(point, capacity);
          if (cop !== undefined) into.set(`COP ${point}`, cop);
        }
      }
      continue;
    }
    if (isRecord(value)) {
      for (const [subKey, subValue] of Object.entries(value)) {
        const text = scalarToText(subValue);
        if (text !== undefined) into.set(`${key}.${subKey}`, text);
      }
      continue;
    }
    const text = scalarToText(value);
    if (text !== undefined) into.set(key, text);
  }
}

/**
 * JSON einlesen — ein Objekt oder eine Liste von Objekten.
 *
 * Die Feldnamen dürfen denen von `HeatPumpModel` und `StorageModel`
 * entsprechen; tun sie es nicht, laufen sie über dieselbe Spaltenerkennung
 * wie eine CSV-Überschrift. Ein Export aus einem Herstellerwerkzeug mit
 * deutschen Schlüsseln funktioniert damit genauso wie eine Datei, die aus
 * diesem Programm stammt.
 */
export function importDevicesFromJson(input: string | unknown, options: DeviceImportOptions = {}): DeviceImportReport {
  const fallbackKind = options.kind ?? 'waermepumpe';
  let payload: unknown = input;
  if (typeof input === 'string') {
    if (input.trim() === '') {
      return emptyReport('json', fallbackKind, [{ severity: 'error', text: 'Die Datei ist leer.' }], 'Die Datei ist leer.');
    }
    try {
      payload = JSON.parse(stripBom(input)) as unknown;
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unbekannter Fehler';
      return emptyReport(
        'json',
        fallbackKind,
        [{ severity: 'error', text: `Die Datei ist kein gültiges JSON: ${reason}` }],
        'Die Datei ist kein gültiges JSON.',
      );
    }
  }
  if (isRecord(payload)) {
    // Viele Werkzeuge verpacken die Liste in ein Objekt: { "devices": [ ... ] }.
    let wrapped: unknown;
    for (const [key, value] of Object.entries(payload)) {
      if (Array.isArray(value) && JSON_WRAPPERS.includes(normalizeHeading(key))) {
        wrapped = value;
        break;
      }
    }
    payload = wrapped ?? [payload];
  }
  if (!Array.isArray(payload)) {
    return emptyReport(
      'json',
      fallbackKind,
      [{ severity: 'error', text: 'Erwartet wird ein Objekt oder eine Liste von Objekten.' }],
      'Die Datei enthält keine Geräteliste.',
    );
  }
  const preIssues: ImportIssue[] = [];
  const flattened: Map<string, string>[] = [];
  payload.forEach((entry, index) => {
    if (!isRecord(entry)) {
      preIssues.push({ severity: 'warn', text: `Eintrag ${index + 1} ist kein Objekt und wurde übergangen.` });
      return;
    }
    const row = new Map<string, string>();
    flattenRecord(entry, row);
    flattened.push(row);
  });
  if (flattened.length === 0) {
    return emptyReport(
      'json',
      fallbackKind,
      [...preIssues, { severity: 'error', text: 'Die Liste enthält keinen auswertbaren Eintrag.' }],
      'Die Liste enthält keinen auswertbaren Eintrag.',
    );
  }
  const headings: string[] = [];
  const seen = new Set<string>();
  for (const row of flattened) {
    for (const key of row.keys()) {
      if (!seen.has(key)) {
        seen.add(key);
        headings.push(key);
      }
    }
  }
  const rows = flattened.map((row) => headings.map((heading) => row.get(heading) ?? ''));
  const lines = flattened.map((_row, index) => index + 1);
  return buildReport(headings, rows, lines, options, 'json', undefined, preIssues);
}

/**
 * Format erkennen und einlesen.
 *
 * Entschieden wird am ersten bedeutungstragenden Zeichen: `{` oder `[` heißt
 * JSON, alles andere CSV. Das ist zuverlässiger als die Dateiendung, die beim
 * Umbenennen verloren geht.
 */
export function importDevices(text: string, options: DeviceImportOptions = {}): DeviceImportReport {
  const trimmed = stripBom(text).trim();
  if (trimmed === '') {
    return emptyReport('unbekannt', options.kind ?? 'waermepumpe', [{ severity: 'error', text: 'Die Datei ist leer.' }], 'Die Datei ist leer.');
  }
  const first = trimmed.charAt(0);
  return first === '{' || first === '[' ? importDevicesFromJson(trimmed, options) : importDevicesFromCsv(text, options);
}

// ===========================================================================
// Zusammenführen mit dem Katalog
// ===========================================================================

export interface CatalogMergeResult {
  /** Katalog und Import gemeinsam — die Liste für Auswahl und Vergleich. */
  heatPumps: HeatPumpModel[];
  storages: StorageModel[];
  /** Nur die eingelesenen Geräte — das, was in `PlantDefinition.extraModels` gehört. */
  extraModels: HeatPumpModel[];
  extraStorages: StorageModel[];
  /** Ids, die einen vorhandenen Eintrag ersetzt haben. */
  replaced: string[];
  /** Ids, die neu hinzugekommen sind. */
  added: string[];
  /** Ids, die nicht übernommen wurden. */
  skipped: string[];
  notes: string[];
}

export interface CatalogMergeOptions {
  /** Hersteller, falls die Datei ihn nicht führt. */
  manufacturer?: string;
  /** Vorhandene Liste; ohne Angabe der Katalog dieses Programms. */
  heatPumps?: readonly HeatPumpModel[];
  storages?: readonly StorageModel[];
  /** Auch zurückgewiesene Zeilen übernehmen — nur für die Ansicht gedacht. */
  includeRejected?: boolean;
}

/**
 * Eingelesene Geräte mit dem Katalog zusammenführen.
 *
 * Gleiche `id` ersetzt, neue kommen dazu. Der Katalog selbst wird dabei nicht
 * verändert: `HEAT_PUMP_CATALOG` und `STORAGE_CATALOG` sind Modulzustand, und
 * ein Import, der sie umschriebe, würde je nach Ladereihenfolge unterschiedlich
 * wirken. Zurück kommen neue Listen — die zusammengeführte für die Auswahl und
 * die reine Importliste für `PlantDefinition.extraModels`, wo sie im Projekt
 * gespeichert wird und `findModel`/`matchModels` sie bevorzugt berücksichtigen.
 *
 * `provenance` steht bei jedem übernommenen Gerät auf `'hersteller'` — das ist
 * der ganze Zweck der Übung: ab hier rechnet das Programm mit Datenblattwerten
 * und sagt das auch.
 */
export function mergeIntoCatalog(report: DeviceImportReport, options: CatalogMergeOptions = {}): CatalogMergeResult {
  const heatPumps: HeatPumpModel[] = [...(options.heatPumps ?? HEAT_PUMP_CATALOG)];
  const storages: StorageModel[] = [...(options.storages ?? STORAGE_CATALOG)];
  const extraModels: HeatPumpModel[] = [];
  const extraStorages: StorageModel[] = [];
  const replaced: string[] = [];
  const added: string[] = [];
  const skipped: string[] = [];
  const notes: string[] = [];

  for (const device of report.devices) {
    if (!device.accepted && !options.includeRejected) {
      const id = device.heatPump?.id ?? device.storage?.id ?? device.rowLabel;
      skipped.push(id);
      continue;
    }
    if (device.heatPump) {
      const model: HeatPumpModel = {
        ...device.heatPump,
        provenance: 'hersteller',
        manufacturer: device.heatPump.manufacturer ?? options.manufacturer,
      };
      const index = heatPumps.findIndex((m) => m.id === model.id);
      if (index >= 0) {
        const previous = heatPumps[index];
        heatPumps[index] = model;
        replaced.push(model.id);
        notes.push(
          previous.provenance === 'generisch'
            ? `„${previous.label}" war eine Typklasse und wurde durch die Herstellerangaben aus ${device.rowLabel} ersetzt.`
            : `„${previous.label}" wurde durch eine neuere Herstellerangabe aus ${device.rowLabel} ersetzt.`,
        );
      } else {
        heatPumps.push(model);
        added.push(model.id);
      }
      extraModels.push(model);
    }
    if (device.storage) {
      const model: StorageModel = {
        ...device.storage,
        provenance: 'hersteller',
        manufacturer: device.storage.manufacturer ?? options.manufacturer,
      };
      const index = storages.findIndex((s) => s.id === model.id);
      if (index >= 0) {
        const previous = storages[index];
        storages[index] = model;
        replaced.push(model.id);
        notes.push(`„${previous.label}" wurde durch die Herstellerangaben aus ${device.rowLabel} ersetzt.`);
      } else {
        storages.push(model);
        added.push(model.id);
      }
      extraStorages.push(model);
    }
  }
  if (skipped.length > 0) {
    notes.push(
      `${skipped.length} Zeile${skipped.length === 1 ? '' : 'n'} wurde${
        skipped.length === 1 ? '' : 'n'
      } nicht übernommen, weil Pflichtangaben fehlten oder Werte unplausibel waren. Solange bleibt die Typklasse aus dem Katalog die Auslegungsgrundlage.`,
    );
  }
  return { heatPumps, storages, extraModels, extraStorages, replaced, added, skipped, notes };
}

// ===========================================================================
// Vorlage
// ===========================================================================

/** Betriebspunkte, die in der Vorlage vorgesehen sind. */
const TEMPLATE_POINTS: { point: string; capacity: string; cop: string }[] = [
  { point: 'A-7/W35', capacity: '8,2', cop: '2,85' },
  { point: 'A2/W35', capacity: '8,7', cop: '3,82' },
  { point: 'A7/W35', capacity: '9,4', cop: '4,90' },
  { point: 'A-7/W55', capacity: '7,5', cop: '2,02' },
];

/** Zelle für die Ausgabe schützen, falls sie das Trennzeichen enthält. */
function quoteCell(value: string, delimiter: string): string {
  if (value.includes(delimiter) || value.includes('"') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export interface TemplateOptions {
  delimiter?: string;
  /** Byte Order Mark voranstellen — ohne ihn zeigt Excel Umlaute falsch an. */
  bom?: boolean;
  /** Beispielzeile weglassen. */
  withoutExample?: boolean;
}

/**
 * Leere Importvorlage mit Beispielzeile.
 *
 * Wer ein Datenblatt abtippt, soll nicht raten müssen, welche Angabe in
 * welcher Einheit erwartet wird — deshalb trägt jede Überschrift ihre Einheit,
 * und die Beispielzeile zeigt die Schreibweise. Das Beispiel ist absichtlich
 * als Muster erkennbar und trägt in der Bemerkung die Aufforderung, es zu
 * löschen: eine Beispielzeile, die versehentlich im Katalog landet, wäre genau
 * die Art erfundener Herstellerangabe, die dieses Modul verhindern soll.
 *
 * Die Zeilen enden mit CR LF, weil Excel Dateien mit reinem LF beim Öffnen
 * teilweise in eine Spalte legt.
 */
export function buildCsvTemplate(kind: DeviceKind = 'waermepumpe', options: TemplateOptions = {}): string {
  const delimiter = options.delimiter ?? ';';
  // Die Bemerkung wandert ans Ende; alle übrigen Spalten behalten die
  // Reihenfolge der Feldtabelle, weil sie dort der Gliederung eines
  // Datenblatts folgt.
  const specs = fieldsOf(kind)
    .slice()
    .sort((a, b) => (a.key === 'note' ? 1 : 0) - (b.key === 'note' ? 1 : 0));
  // Die gemeinsamen Felder tragen ein Beispiel aus der Welt der Wärmepumpen;
  // für die Speichervorlage werden sie ausgetauscht, damit die Zeile in sich
  // stimmig bleibt.
  const overrides: Record<string, string> = kind === 'speicher' ? { id: 'MH-SP-300', label: 'Muster S 300' } : {};
  const headings: string[] = [];
  const example: string[] = [];
  for (const spec of specs) {
    headings.push(spec.heading);
    example.push(
      spec.key === 'note' ? 'Beispielzeile — vor dem Import löschen.' : overrides[spec.key] ?? spec.example ?? '',
    );
  }
  if (kind === 'waermepumpe') {
    const noteIndex = headings.length - 1;
    const pointHeadings: string[] = [];
    const pointValues: string[] = [];
    for (const entry of TEMPLATE_POINTS) {
      pointHeadings.push(`${entry.point} [kW]`, `COP ${entry.point}`);
      pointValues.push(entry.capacity, entry.cop);
    }
    // Die Betriebspunkte stehen vor der Bemerkung, damit die Zahlenspalten
    // beieinanderliegen.
    headings.splice(noteIndex, 0, ...pointHeadings);
    example.splice(noteIndex, 0, ...pointValues);
  }
  const lines = [headings.map((h) => quoteCell(h, delimiter)).join(delimiter)];
  if (!options.withoutExample) lines.push(example.map((v) => quoteCell(v, delimiter)).join(delimiter));
  const text = `${lines.join('\r\n')}\r\n`;
  return options.bom === false ? text : `\ufeff${text}`;
}
