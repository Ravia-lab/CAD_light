/**
 * Anlagenbuch — die Auslegung als Dokument zum Ausdrucken.
 * ---------------------------------------------------------------------------
 * **Warum es dieses Modul gibt.** Die Rechenkerne liefern Zahlen, die
 * Zeichenmodule liefern Blätter. Was fehlt, ist das, was am Ende der Baustelle
 * übergeben wird: ein zusammenhängendes Heft, das eine Anlage beschreibt —
 * welches Gerät, warum dieses, mit welchen Temperaturen, welchem Speicher,
 * welchem Vordruck. Der Monteur braucht die Verteilertabelle, der Prüfer die
 * Druckkette, der Kunde das Deckblatt und die Grenzen des Dokuments. Alles
 * zusammen in einer Datei, die man abheften kann.
 *
 * **Warum HTML und nicht SVG.** `planPrint.ts` und `schematicPrint.ts` zeichnen
 * in Millimetern, weil ein Plan maßstäblich sein muss. Hier ist das Gegenteil
 * richtig: ein Anlagenbuch ist Fließtext mit Tabellen. Wer Fließtext in SVG
 * setzt, baut den Zeilenumbruch von Hand nach, verliert die Silbentrennung und
 * bekommt beim ersten längeren Raumnamen eine Textzeile, die aus dem Rahmen
 * läuft. HTML kann Umbruch, Tabellenkopf-Wiederholung und Seitenumbruch von
 * sich aus; das Blattformat kommt aus `@page`, genau wie bei den Plänen.
 *
 * **Ohne Netz.** Der Stil steht eingebettet im Dokument, es gibt keine externe
 * Schriftdatei und kein Bild von einem Server. Eine Anlagendokumentation, die
 * ohne Internetverbindung anders aussieht, ist keine Dokumentation. Gesetzt
 * wird in dem, was auf dem Rechner ohnehin liegt.
 *
 * **Kopf- und Fußzeile.** Die `@page`-Randbereiche (`@top-left`,
 * `@bottom-right` mit `counter(page)`) stehen im Dokument, weil sie der
 * richtige Ort dafür sind. Die gängigen Browser werten sie beim Drucken
 * derzeit nicht aus — sie setzen ihre eigene Kopfzeile. Deshalb trägt
 * zusätzlich jedes Kapitel oben eine sichtbare Zeile mit Projekt und
 * Kapitelnummer; damit bleibt eine einzelne herausgelöste Seite zuordenbar,
 * auch wenn niemand die Randbereiche unterstützt.
 *
 * **Keine Uhr, kein DOM.** Das Datum kommt als fertige Zeichenkette von außen.
 * Ein Dokument, das sich bei jedem Aufruf selbst umdatiert, ist nicht
 * reproduzierbar und taugt nicht als Nachweis. Auf `window` greift einzig
 * `printPlantBook` am Dateiende zu — dieselbe Bequemlichkeitsfunktion wie
 * `printPlan` in `planPrint.ts`.
 */

import type {
  ExportRoom,
  HeatPumpModel,
  HeatingCircuit,
  PipeSizing,
  PlantStorage,
  RaviaExport,
  SafetyDesign,
} from '../types/bim';
import {
  HEAT_SOURCE_LABELS,
  PIPE_MATERIAL_LABELS,
  PUMP_FORM_LABELS,
  STORAGE_KIND_LABELS,
} from '../types/bim';
import { REFRIGERANTS } from './deviceCatalog';
import type { DomesticWaterResult } from './domesticWater';
import type { CircuitDesign, PlanningNote, PlantDesignResult } from './plantDesign';

// ---------------------------------------------------------------------------
// Öffentliche Typen
// ---------------------------------------------------------------------------

export type PlantBookPaperFormat = 'A4' | 'A3';

/** Die Kapitel des Anlagenbuchs in der Reihenfolge, in der sie gedruckt werden. */
export type PlantBookChapterId =
  | 'deckblatt'
  | 'grenzen'
  | 'gebaeude'
  | 'erzeuger'
  | 'verteilung'
  | 'speicher'
  | 'sicherheit'
  | 'hinweise'
  | 'inbetriebnahme';

/**
 * Ein Kapitel in der Übersicht.
 *
 * `hasContent` unterscheidet „Kapitel steht im Heft" von „Kapitel hat etwas zu
 * sagen": ein Sicherheitskapitel ohne Auslegung wird gedruckt, damit die Lücke
 * sichtbar bleibt, meldet aber `false` — die Oberfläche kann daraus einen
 * Hinweis machen, statt ein scheinbar vollständiges Heft anzubieten.
 */
export interface PlantBookChapter {
  id: PlantBookChapterId;
  /**
   * Nummer im Heft, bei 1 beginnend. Das Deckblatt ist Kapitel 1, druckt seine
   * Nummer aber nicht — die Zählung bleibt trotzdem lückenlos.
   */
  number: number;
  title: string;
  /** Anker im Dokument, für Verweise aus der Oberfläche. */
  anchor: string;
  hasContent: boolean;
  /** Warum das Kapitel leer ist — leer, wenn es Inhalt hat. */
  emptyReason?: string;
}

export interface PlantBookOptions {
  /** Das Ergebnis der Anlagenauslegung — der eigentliche Inhalt des Hefts. */
  design: PlantDesignResult;
  /** Projektname für Deckblatt und Kapitelkopf. */
  projectName: string;
  /** Anlagenbezeichnung, z. B. „Wärmepumpenanlage Haus 1". */
  plantName: string;
  /** Wer die Auslegung erstellt hat. */
  author: string;
  /** Datum als fertige Zeichenkette. Dieses Modul liest keine Uhr. */
  date: string;
  /** Bauvorhaben/Anschrift fürs Deckblatt. */
  address?: string;
  /** Bauherr oder Auftraggeber. */
  client?: string;
  /** Freie Bemerkung unter dem Deckblattkopf, z. B. Revisionsstand. */
  remark?: string;
  /**
   * Räume aus dem Export. Sie liefern Volumen, Solltemperatur und Geschoss —
   * Angaben, die der Heizlastüberschlag nicht mitführt.
   */
  rooms?: readonly ExportRoom[];
  /** Vollständiger Export, falls vorhanden: Gebäudesummen und Projektkopf. */
  raviaExport?: RaviaExport;
  /** Blattformat. Vorgabe: A4 hoch. */
  format?: PlantBookPaperFormat;
  /** Kapitel weglassen — etwa die Checkliste, wenn nur der Nachweis gebraucht wird. */
  omit?: readonly PlantBookChapterId[];
}

export interface PlantBookResult {
  /** Das vollständige Dokument, eingebetteter Stil inbegriffen. */
  html: string;
  /** Dokumenttitel — auch der Titel des Druckfensters. */
  title: string;
  chapters: PlantBookChapter[];
}

// ---------------------------------------------------------------------------
// Zahlen und Zeichenketten
// ---------------------------------------------------------------------------

/**
 * Deutsche Zahl: Komma als Dezimaltrenner, Punkt als Tausendertrenner.
 *
 * Bewusst nicht über `toLocaleString`: die Umgebung, in der gedruckt wird, muss
 * nicht deutsch eingestellt sein, und ein Nachweis, dessen Zahlenformat von der
 * Systemsprache des Rechners abhängt, ist kein Nachweis. Ein rechnerisches
 * −0,0 wird zu 0,0 — das Minuszeichen wäre eine Aussage, die die Zahl nicht
 * trägt.
 */
function de(value: number | undefined | null, digits = 1): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return '—';
  // Ab 1e21 wechselt `toFixed` in die Exponentialschreibweise („1e+21"); die
  // Tausenderpunkte würden dann in eine Zeichenkette gesetzt, die keine Zahl
  // mehr ist. Eine Anlagengröße erreicht das nie — eine verrutschte Eingabe
  // schon, und dann soll der Strich stehen und keine Fantasiezahl.
  if (Math.abs(value) >= 1e21) return '—';
  let text = value.toFixed(digits);
  if (/^-0(\.0*)?$/.test(text)) text = text.slice(1);
  const negative = text.startsWith('-');
  const body = negative ? text.slice(1) : text;
  const [whole, fraction] = body.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negative ? '−' : ''}${grouped}${fraction ? `,${fraction}` : ''}`;
}

/** Anteil als Prozentangabe. `1,05` wird zu „105 %". */
function pct(value: number | undefined, digits = 0): string {
  if (value === undefined || !Number.isFinite(value)) return '—';
  return `${de(value * 100, digits)} %`;
}

const HTML_ESCAPES: Record<string, string> = {
  '<': '&lt;',
  '>': '&gt;',
  '&': '&amp;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Escaping für alles, was aus dem Modell kommt.
 *
 * Auch das Apostroph wird ersetzt: Attributwerte in diesem Dokument stehen in
 * doppelten Anführungszeichen, aber die Regel soll unabhängig davon halten, wo
 * der Text später landet.
 */
const escapeHtml = (value: string): string => value.replace(/[<>&"']/g, (c) => HTML_ESCAPES[c]);

/**
 * Zeichenkette für einen CSS-`content`-Wert.
 *
 * Der Projektname steht in der Kopfzeile der `@page`-Regel und damit in einer
 * CSS-Zeichenkette, nicht im HTML. Dort schützt HTML-Escaping nichts — dort
 * muss verhindert werden, dass ein Anführungszeichen die Regel schließt. Das
 * Kleinerzeichen wird zusätzlich als CSS-Escape geschrieben, weil ein
 * Projektname mit `</style>` sonst den Stilblock beenden würde; der
 * HTML-Zerteiler sieht innerhalb von `<style>` nur diese eine Zeichenfolge.
 */
const cssString = (value: string): string =>
  `"${value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/</g, '\\3c ')
    .replace(/[\r\n]+/g, ' ')}"`;

/** Ein Wert für eine Tabellenzelle: entweder Text (wird escaped) oder fertiges Markup. */
type Cell = string | { html: string };

const cellHtml = (cell: Cell): string => (typeof cell === 'string' ? escapeHtml(cell) : cell.html);

interface Column {
  label: string;
  /**
   * Einheit der Spalte. Sie steht in der Kopfzeile und nirgends sonst — eine
   * Einheit hinter jedem Zahlenwert macht die Spalte unlesbar und lädt dazu
   * ein, in derselben Spalte zwei Einheiten zu mischen.
   */
  unit?: string;
  align?: 'left' | 'right';
}

function dataTable(
  columns: readonly Column[],
  rows: readonly (readonly Cell[])[],
  footer?: readonly Cell[],
): string {
  const cls = (i: number): string => (columns[i]?.align === 'right' ? 'r' : 'l');
  const head = columns
    .map(
      (c, i) =>
        `<th class="${cls(i)}">${escapeHtml(c.label)}${
          c.unit ? `<span class="einheit">${escapeHtml(c.unit)}</span>` : ''
        }</th>`,
    )
    .join('');
  const body = rows
    .map((row) => `<tr>${row.map((cell, i) => `<td class="${cls(i)}">${cellHtml(cell)}</td>`).join('')}</tr>`)
    .join('');
  // `tfoot` steht hinter `tbody`, weil der aktuelle HTML-Standard nur diese
  // Reihenfolge kennt — die Erlaubnis, den Fuß vor den Rumpf zu setzen, stammt
  // aus HTML 4.01. Für die Wiederholung der Summenzeile am Seitenende ist die
  // Stelle im Markup ohnehin nicht maßgebend, sondern
  // `tfoot{display:table-footer-group}` im Stil.
  const foot = footer
    ? `<tfoot><tr>${footer.map((cell, i) => `<td class="${cls(i)}">${cellHtml(cell)}</td>`).join('')}</tr></tfoot>`
    : '';
  return `<table class="daten"><thead><tr>${head}</tr></thead><tbody>${body}</tbody>${foot}</table>`;
}

/** Eine Zeile in der Kennwerttabelle. `undefined` fällt heraus. */
interface Fact {
  label: string;
  value: Cell;
  /** Erläuterung in kleiner Schrift unter dem Wert — Herkunft, Bezugspunkt, Grenze. */
  note?: string;
}

function factTable(entries: readonly (Fact | undefined)[]): string {
  const rows = entries
    .filter((entry): entry is Fact => entry !== undefined)
    .map(
      (entry) =>
        `<tr><th class="l">${escapeHtml(entry.label)}</th><td class="l">${cellHtml(entry.value)}${
          entry.note ? `<div class="fussnote">${escapeHtml(entry.note)}</div>` : ''
        }</td></tr>`,
    )
    .join('');
  return `<table class="kennwerte"><tbody>${rows}</tbody></table>`;
}

/**
 * Anzahl mit passender Form. „1 Kreise" in einer Summenzeile ist ein kleiner
 * Fehler, aber einer, den jeder Leser sofort sieht — und der den Eindruck
 * hinterlässt, es habe niemand hingesehen.
 */
const plural = (count: number, one: string, many: string): string =>
  `${de(count, 0)} ${count === 1 ? one : many}`;

/** Deutsches Anführungszeichenpaar. */
const quoted = (text: string): string => `„${text}“`;

const paragraph = (text: string): string => `<p>${escapeHtml(text)}</p>`;

const heading = (text: string): string => `<h3>${escapeHtml(text)}</h3>`;

const hint = (text: string): string => `<p class="hinweiskasten">${escapeHtml(text)}</p>`;

// ---------------------------------------------------------------------------
// Beschriftungen
// ---------------------------------------------------------------------------

const CIRCUIT_KIND_LABELS: Record<HeatingCircuit['kind'], string> = {
  floor: 'Fußbodenheizung',
  radiator: 'Heizkörper',
  wall: 'Wandheizung',
  fancoil: 'Gebläsekonvektor',
  dhw: 'Trinkwassererwärmung',
};

/** Warum die Rohrdimension so gewählt wurde — die Begründung gehört in den Nachweis. */
const PIPE_REASON_LABELS: Record<PipeSizing['reason'], string> = {
  geschwindigkeit: 'Geschwindigkeitsgrenze',
  'druckgefälle': 'Druckgefällegrenze',
  kleinste: 'kleinste Dimension der Reihe',
  'größte': 'größte Dimension der Reihe',
};

const SEVERITY_LABELS: Record<PlanningNote['severity'], string> = {
  error: 'Fehler',
  warn: 'Achtung',
  info: 'Hinweis',
};

const SEVERITY_ORDER: Record<PlanningNote['severity'], number> = { error: 0, warn: 1, info: 2 };

const PAPER: Record<PlantBookPaperFormat, { w: number; h: number }> = {
  A4: { w: 210, h: 297 },
  A3: { w: 297, h: 420 },
};

// ---------------------------------------------------------------------------
// Stil
// ---------------------------------------------------------------------------

/**
 * Der eingebettete Stil.
 *
 * Grundsätze: keine Farbfläche, die im Schwarzweißdruck zur grauen Suppe wird;
 * Linien statt Hintergründe; 9,5 pt Grundschrift, weil das Heft gelesen und
 * nicht überflogen wird. Die Bildschirmansicht setzt das Blatt auf grauen Grund
 * — dieselbe Vorschau wie bei `printPlan`, damit der Nutzer vor dem Druck
 * sieht, was auf das Papier geht.
 */
function styleSheet(format: PlantBookPaperFormat, headerLeft: string, headerRight: string): string {
  const paper = PAPER[format];
  return [
    `@page{size:${paper.w}mm ${paper.h}mm;margin:18mm 16mm 20mm 16mm;`,
    // Die Randbereiche sind der normgerechte Ort für Kopf- und Fußzeile. Die
    // verbreiteten Browser ignorieren sie beim Drucken; die sichtbare Zeile
    // oben in jedem Kapitel ist der Ersatz, der überall ankommt.
    `@top-left{content:${cssString(headerLeft)};font-size:7pt;color:#475569}`,
    `@top-right{content:${cssString(headerRight)};font-size:7pt;color:#475569}`,
    `@bottom-right{content:"Seite " counter(page) " von " counter(pages);font-size:7pt;color:#475569}}`,
    'html,body{margin:0;padding:0;background:#fff;color:#0F172A}',
    'body{font-family:"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;font-size:9.5pt;line-height:1.45}',
    '.buch{max-width:100%}',
    '.kapitel{break-before:page;page-break-before:always}',
    '.kapitel:first-child{break-before:auto;page-break-before:auto}',
    // Der Kapitelkopf wiederholt Projekt und Kapitel, damit ein einzelnes
    // herausgelöstes Blatt zuordenbar bleibt.
    '.blattkopf{display:flex;justify-content:space-between;gap:8mm;border-bottom:.4pt solid #94A3B8;',
    'padding-bottom:1.5mm;margin-bottom:5mm;font-size:7.5pt;color:#475569}',
    'h1{font-size:20pt;line-height:1.2;margin:0 0 2mm;font-weight:600}',
    'h2{font-size:13pt;margin:0 0 4mm;font-weight:600;letter-spacing:.01em}',
    'h2 .nr{display:inline-block;min-width:9mm;color:#64748B;font-variant-numeric:tabular-nums}',
    'h3{font-size:10pt;margin:6mm 0 2mm;font-weight:600}',
    'h3:first-of-type{margin-top:0}',
    'p{margin:0 0 2.5mm;orphans:2;widows:2}',
    'p.hinweiskasten{border-left:2pt solid #64748B;padding:1.5mm 0 1.5mm 3mm;margin:3mm 0;color:#334155}',
    'ul{margin:0 0 3mm;padding-left:5mm}li{margin:0 0 1.2mm}',
    'table{border-collapse:collapse;width:100%;margin:0 0 4mm;font-size:8.5pt;',
    'font-variant-numeric:tabular-nums}',
    'thead{display:table-header-group}tfoot{display:table-footer-group}',
    // Eine Tabellenzeile darf nicht mitten im Text auf die nächste Seite
    // rutschen — halbe Zahlen sind schlimmer als eine halbleere Seite.
    'tr,td,th{break-inside:avoid;page-break-inside:avoid}',
    'th,td{padding:1.1mm 2mm;border-bottom:.3pt solid #CBD5E1;vertical-align:top}',
    'thead th{border-bottom:.7pt solid #334155;font-weight:600;text-align:left;white-space:nowrap}',
    'tfoot td{border-top:.7pt solid #334155;border-bottom:none;font-weight:600}',
    'td.r,th.r{text-align:right}td.l,th.l{text-align:left}',
    '.einheit{display:block;font-weight:400;font-size:7pt;color:#64748B}',
    'table.kennwerte th{width:52mm;font-weight:600;background:none}',
    'table.kennwerte{font-size:9pt}',
    '.fussnote{font-size:7.5pt;color:#475569;margin-top:.5mm}',
    '.gruppe{font-weight:600;background:#F1F5F9}',
    // Deckblatt
    '.deckblatt{display:block;padding-top:14mm}',
    '.deckblatt .marke{font-size:8pt;letter-spacing:.18em;text-transform:uppercase;color:#64748B;margin-bottom:12mm}',
    '.deckblatt .anlage{font-size:12pt;color:#334155;margin:0 0 12mm}',
    '.deckblatt hr{border:none;border-top:.8pt solid #334155;margin:0 0 6mm}',
    '.zahlen{display:flex;gap:6mm;margin:8mm 0 10mm;flex-wrap:wrap}',
    '.zahl{flex:1 1 42mm;border:.5pt solid #94A3B8;padding:3mm 3.5mm}',
    '.zahl .k{font-size:7.5pt;text-transform:uppercase;letter-spacing:.1em;color:#64748B}',
    '.zahl .v{font-size:15pt;font-weight:600;margin-top:1.5mm;line-height:1.15}',
    '.zahl .z{font-size:8pt;color:#475569;margin-top:1mm}',
    '.inhalt{font-size:8.5pt;column-count:2;column-gap:8mm;margin-top:6mm}',
    '.inhalt div{break-inside:avoid;margin-bottom:1mm}',
    '.inhalt .nr{display:inline-block;min-width:6mm;color:#64748B}',
    // Schwere der Hinweise: Strichstärke statt Farbfläche, damit sie in
    // Schwarzweiß unterscheidbar bleibt.
    '.schwere{display:inline-block;min-width:16mm;font-weight:600;font-size:7.5pt;',
    'text-transform:uppercase;letter-spacing:.06em}',
    'tr.error td{border-left:2pt solid #0F172A}',
    'tr.warn td{border-left:1pt solid #475569}',
    'tr.info td{border-left:.3pt solid #CBD5E1}',
    'tr.error td:first-child,tr.warn td:first-child,tr.info td:first-child{padding-left:2.5mm}',
    // Checkliste
    'table.check td{padding:2.6mm 2mm}',
    '.kasten{display:inline-block;width:4.5mm;height:4.5mm;border:.7pt solid #0F172A;vertical-align:-1mm}',
    '.feld{display:inline-block;min-width:26mm;border-bottom:.4pt solid #64748B;height:4mm}',
    '.unterschrift{margin-top:10mm;display:flex;gap:10mm}',
    '.unterschrift div{flex:1 1 0;border-top:.5pt solid #334155;padding-top:1.5mm;font-size:8pt;color:#475569}',
    '.schluss{margin-top:8mm;border-top:.4pt solid #CBD5E1;padding-top:2mm;font-size:7.5pt;color:#64748B}',
    // Bildschirmvorschau
    `@media screen{body{background:#334155;padding:10mm 0}`,
    `.buch{width:${paper.w - 32}mm;margin:0 auto;background:#fff;padding:18mm 16mm 20mm;`,
    'box-shadow:0 8px 40px rgba(0,0,0,.45)}',
    '.kapitel{border-top:1px dashed #CBD5E1;margin-top:10mm;padding-top:10mm}',
    '.kapitel:first-child{border-top:none;margin-top:0;padding-top:0}}',
  ].join('');
}

// ---------------------------------------------------------------------------
// Kapitel 1 — Deckblatt
// ---------------------------------------------------------------------------

/**
 * Das Deckblatt trägt drei Zahlen, nicht dreißig.
 *
 * Heizlast, Gerät, Trinkwasserspeicher — das sind die Angaben, nach denen in
 * einem Gespräch über die Anlage als Erstes gefragt wird. Alles andere steht in
 * den Kapiteln dahinter; ein Deckblatt voller Kennwerte wird nicht gelesen.
 */
function chapterCover(options: PlantBookOptions, chapters: readonly PlantBookChapter[]): string {
  const { design } = options;
  const selected = design.selected;
  const dhwVolume = options.design.dhwStorage?.volume ?? design.dhw?.recommendedVolume;

  const kachel = (key: string, value: string, note: string): string =>
    `<div class="zahl"><div class="k">${escapeHtml(key)}</div><div class="v">${escapeHtml(value)}</div>` +
    `<div class="z">${escapeHtml(note)}</div></div>`;

  const inhalt = chapters
    .filter((c) => c.id !== 'deckblatt')
    .map(
      (c) =>
        `<div><span class="nr">${c.number}</span>${escapeHtml(c.title)}${
          c.hasContent ? '' : ' <span class="fussnote">(ohne Angaben)</span>'
        }</div>`,
    )
    .join('');

  return (
    `<section class="kapitel deckblatt" id="kapitel-deckblatt">` +
    `<div class="marke">Anlagenbuch</div>` +
    `<h1>${escapeHtml(options.projectName)}</h1>` +
    `<p class="anlage">${escapeHtml(options.plantName)}</p>` +
    `<hr>` +
    factTable([
      options.address ? { label: 'Bauvorhaben', value: options.address } : undefined,
      options.client ? { label: 'Bauherr', value: options.client } : undefined,
      { label: 'Erstellt von', value: options.author },
      { label: 'Datum', value: options.date },
      options.remark ? { label: 'Bemerkung', value: options.remark } : undefined,
    ]) +
    `<div class="zahlen">` +
    kachel(
      'Heizlast',
      `${de(design.heatLoad, 1)} kW`,
      design.heatLoadSource === 'norm' ? 'Norm-Heizlast, übergeben' : 'Überschlag, kein Normnachweis',
    ) +
    kachel(
      'Wärmeerzeuger',
      selected ? selected.model.label : 'nicht gewählt',
      selected
        ? `${de(selected.capacityAtDesign, 1)} kW im Auslegungspunkt · Deckung ${pct(selected.coverage)}`
        : 'Kein Gerät aus dem Katalog übernommen',
    ) +
    kachel(
      'Trinkwasserspeicher',
      dhwVolume !== undefined ? `${de(dhwVolume, 0)} l` : 'nicht ausgelegt',
      design.dhw
        ? `Bedarfskennzahl N = ${de(design.dhw.demandIndex, 1)} · ${de(design.dhw.storageTemperature, 0)} °C`
        : 'Keine Trinkwasserauslegung im Dokument',
    ) +
    `</div>` +
    `<h3>Inhalt</h3><div class="inhalt">${inhalt}</div>` +
    `<p class="schluss">Dieses Heft beschreibt eine Auslegung, keine ausgeführte Anlage. Abweichungen auf der ` +
    `Baustelle sind hier nachzutragen; ohne Nachtrag beschreibt das Heft die Anlage nicht mehr.</p>` +
    `</section>`
  );
}

// ---------------------------------------------------------------------------
// Kapitel 2 — Was hier steht und was nicht
// ---------------------------------------------------------------------------

/**
 * Die Grenzen des Dokuments.
 *
 * Wer ein Dokument weitergibt, muss dessen Grenzen mitgeben. Ein Heft, das
 * seine Vorbehalte im Kleingedruckten versteckt, erzeugt genau das
 * Missverständnis, das es vermeiden will: der Empfänger hält eine
 * Vordimensionierung für einen Nachweis. Deshalb steht dieses Kapitel vorn,
 * nicht hinten, und es formuliert die Vorbehalte fallabhängig — ein pauschaler
 * Haftungstext wäre wieder nur eine Formel, die niemand liest.
 */
function chapterLimits(options: PlantBookOptions): string {
  const { design } = options;
  const parts: string[] = [];

  parts.push(
    paragraph(
      'Dieses Heft fasst zusammen, was das Programm gerechnet hat. Es ersetzt weder die Ausführungsplanung ' +
        'noch die Abnahme durch das ausführende Unternehmen. Die folgenden Punkte benennen, worauf die Zahlen ' +
        'beruhen und wo sie enden.',
    ),
  );

  parts.push(heading('Heizlast'));
  if (design.heatLoadSource === 'norm') {
    parts.push(
      paragraph(
        `Die Gebäudeheizlast von ${de(design.heatLoad, 1)} kW wurde als Norm-Heizlast übergeben. Das Programm ` +
          'hat diese Zahl übernommen und nicht nachgerechnet; die Verantwortung für sie liegt bei der Stelle, ' +
          'die den Nachweis nach DIN EN 12831-1 erstellt hat.',
      ),
    );
  } else {
    parts.push(
      paragraph(
        `Die Gebäudeheizlast von ${de(design.heatLoad, 1)} kW ist ein Überschlag aus der Gebäudegeometrie, den ` +
          'U-Werten und dem Mindestluftwechsel — kein Nachweis nach DIN EN 12831-1. Der Überschlag kennt weder ' +
          'die raumweise Aufheizleistung noch Sonderfälle wie hohe Räume, Wintergärten oder Zwischenwerte der ' +
          'Luftdichtheit aus einer Messung. Für die Auslegung eines Geräts reicht er; für die Förderung, den ' +
          'hydraulischen Abgleich Verfahren B und für eine Gewährleistungszusage reicht er nicht.',
      ),
    );
    if (design.estimate) {
      parts.push(
        paragraph(
          `Zur Einordnung: ${de(design.estimate.specific, 0)} W/m² bezogen auf ${de(design.estimate.heatedArea, 1)} m² ` +
            `beheizte Fläche — ${design.estimate.klassifizierung}. Weicht diese Kennzahl vom Baujahr des ` +
            'Gebäudes deutlich ab, stimmt eine Eingangsgröße nicht.',
        ),
      );
    }
  }

  parts.push(heading('Gerätekatalog'));
  const selected = design.selected;
  if (!selected) {
    parts.push(
      paragraph(
        'Es wurde kein Gerät gewählt. Alle Angaben, die vom Gerät abhängen — Deckungsgrad, Mindestwasserinhalt, ' +
          'Puffergröße, Elektrik —, fehlen deshalb in diesem Heft.',
      ),
    );
  } else if (selected.model.provenance === 'generisch') {
    parts.push(
      paragraph(
        `${quoted(selected.model.label)} ist eine Typklasse, kein Produkt. Die Kennwerte beschreiben den Bereich, in ` +
          'dem sich marktübliche Geräte dieser Bauart und Größe bewegen; sie stammen nicht aus einem ' +
          'Datenblatt. Damit lässt sich vordimensionieren und ausschreiben — bestellen lässt sich damit nichts. ' +
          'Sobald ein Datenblatt vorliegt, ist die Auslegung mit den echten Werten zu wiederholen; ' +
          'insbesondere Leistungskurve, Mindestvolumenstrom, Mindestwasserinhalt und Schallleistung können ' +
          'abweichen und ziehen dann Puffer, Überströmer und Aufstellort nach sich.',
      ),
    );
  } else {
    parts.push(
      paragraph(
        `${quoted(selected.model.label)} stammt aus einer Herstellerangabe. Zwischen den angegebenen Betriebspunkten ` +
          'wird linear interpoliert; die tatsächliche Kennlinie eines invertergeregelten Geräts ist ' +
          'abschnittsweise gekrümmt. In der Nähe der Norm-Außentemperatur liegt die Interpolation dicht an der ' +
          'Wirklichkeit, an den Rändern der Kurve nicht.',
      ),
    );
  }

  parts.push(heading('Anlagenschema'));
  parts.push(
    paragraph(
      'Das zugehörige Schema ist ein Prinzipschema: es zeigt, was woran hängt, und nicht, wo es steht. ' +
        'Rohrführung, Längen, Höhenlagen und Befestigungen sind daraus nicht ableitbar. Ein Prinzipschema ist ' +
        'kein Ausführungsplan und kein Ersatz für die Montageplanung.',
    ),
  );

  parts.push(heading('Schall'));
  parts.push(
    paragraph(
      'Die Schallangaben sind Herstellerwerte der Schallleistung, ergänzt um eine überschlägige Ausbreitung. ' +
        'Ein Schallnachweis nach TA Lärm ist das nicht: er verlangt den Immissionsort am maßgeblichen Fenster, ' +
        'die Vorbelastung, Zuschläge für Ton- und Impulshaltigkeit sowie die Beurteilung der Nachtzeit. Steht ' +
        'die Anlage nahe an einer Nachbarbebauung, ist der Nachweis gesondert zu führen.',
    ),
  );

  if (design.dhw) {
    parts.push(heading('Trinkwasser'));
    parts.push(
      paragraph(
        'Die Trinkwasserauslegung stützt sich auf die Bedarfskennzahl nach DIN 4708 und die Bewertung nach ' +
          'DVGW W 551 und DIN 1988-200. Sie ersetzt keine Prüfung der Trinkwasserhygiene und keine ' +
          'Gefährdungsanalyse. Die Wahl des Speichers muss über die Leistungskennzahl N_L des Herstellers ' +
          'gegengeprüft werden — das Volumen allein sagt nichts über die Zapfleistung.',
      ),
    );
  }

  if (design.safety) {
    parts.push(heading('Sicherheitstechnik'));
    parts.push(
      paragraph(
        'Die Druckkette und die Gefäßgröße sind rechnerisch ermittelt. Ansprechdruck, Bauteilprüfzeichen und ' +
          'Einbaulage der Armaturen sind am Bauteil zu prüfen; die Anlage darf erst mit bauteilgeprüften ' +
          'Sicherheitseinrichtungen betrieben werden. Vordruck und Fülldruck sind nach dem Füllen zu messen und ' +
          'in die Checkliste am Heftende einzutragen — ohne diese beiden Zahlen ist die Rechnung unbelegt.',
      ),
    );
  }

  parts.push(heading('Was in diesem Heft nicht steht'));
  parts.push(
    '<ul>' +
      [
        'Elektroplanung: Leitungsquerschnitte, Zählerplatz, Sperrzeitensteuerung und die Anmeldung beim Netzbetreiber.',
        'Statik und Bauphysik: Fundament der Außeneinheit, Durchbrüche, Schallentkopplung des Aufstellorts.',
        'Kältetechnik: Aufstellraumanforderungen und Prüfpflichten aus der F-Gas-Verordnung und DIN EN 378.',
        'Genehmigungen: Abstandsflächen, Wasserrecht bei Sole- und Grundwasseranlagen, Denkmalschutz.',
        'Hydraulischer Abgleich als Nachweis: die Voreinstellwerte sind zu ermitteln und zu protokollieren.',
        'Kosten, Fördermittel und Wirtschaftlichkeit.',
      ]
        .map((t) => `<li>${escapeHtml(t)}</li>`)
        .join('') +
      '</ul>',
  );

  return parts.join('');
}

// ---------------------------------------------------------------------------
// Kapitel 3 — Gebäude
// ---------------------------------------------------------------------------

interface RoomRow {
  name: string;
  level: string;
  area: number;
  volume?: number;
  setpoint?: number;
  load?: number;
  specific?: number;
}

/**
 * Ein Geschoss, zu dem weder Export noch Raumliste einen Namen liefern.
 *
 * Die rohe Kennung in die Spalte „Geschoss" zu setzen behauptet, „og" sei die
 * Bezeichnung des Geschosses. Sie steht deshalb als das im Heft, was sie ist:
 * ein Schlüssel aus dem Modell. Der Leser sieht die Lücke, statt sie für einen
 * ungewöhnlichen Namen zu halten, und der Rückweg ins Modell bleibt offen.
 */
const technicalLevel = (id: string): string => `Kennung ${quoted(id)}`;

/**
 * Die Raumtabelle entsteht aus zwei Quellen, weil keine allein reicht.
 *
 * Der Heizlastüberschlag kennt Last und Solltemperatur, aber kein Volumen und
 * keinen Geschossnamen; der Export kennt Geometrie, aber keine Last. Verbunden
 * wird über die Raum-Id. Räume, die nur in einer der beiden Quellen stehen,
 * fallen nicht heraus — sie erscheinen mit Strichen in den fehlenden Spalten,
 * damit die Lücke sichtbar bleibt.
 */
function collectRooms(options: PlantBookOptions): RoomRow[] {
  const loadByRoom = new Map(options.design.estimate?.rooms.map((r) => [r.roomId, r]) ?? []);
  // Der Export führt den Geschossnamen, der Heizlastüberschlag nur die Id.
  // Ohne diese Zuordnung stünde in der Spalte „Geschoss" einmal „Erdgeschoss"
  // und einmal „level-eg" — eine technische Kennung in einem Dokument, das
  // dem Bauherrn übergeben wird, und dazu eine Sortierung, die beides
  // vermischt. Die Höhenlage ordnet die Geschosse so, wie sie im Haus liegen;
  // alphabetisch käme das Dachgeschoss vor dem Erdgeschoss.
  const levelName = new Map<string, string>();
  const levelHeight = new Map<string, number>();
  for (const level of options.raviaExport?.levels ?? []) {
    levelName.set(level.id, level.name);
    levelHeight.set(level.name, level.elevation);
  }
  // Der vollständige Export ist die bequemere, aber nicht die einzige Quelle:
  // er ist wahlfrei, die Raumliste trägt denselben Geschossnamen und dessen
  // Höhenlage ohnehin mit sich. Die Brücke zur Kennung des
  // Heizlastüberschlags schlägt die Raum-Id. Ohne diesen zweiten Weg verliert
  // ein Heft, das nur mit `rooms` gebaut wurde, genau das, was der Kommentar
  // oben ausschließt — Kennung statt Name und eine Sortierung nach Alphabet.
  for (const room of options.rooms ?? []) {
    const levelId = loadByRoom.get(room.id)?.levelId;
    if (levelId !== undefined && !levelName.has(levelId)) levelName.set(levelId, room.level);
    if (!levelHeight.has(room.level) && Number.isFinite(room.levelElevation)) {
      levelHeight.set(room.level, room.levelElevation);
    }
  }
  const rows: RoomRow[] = [];
  const seen = new Set<string>();

  for (const room of options.rooms ?? []) {
    if (!room.isHeated) continue;
    const load = loadByRoom.get(room.id);
    seen.add(room.id);
    rows.push({
      name: room.name,
      level: room.level,
      area: room.netFloorArea ?? room.area,
      volume: room.volume,
      setpoint: room.setpointTemperature,
      load: load?.total,
      specific: load?.specific,
    });
  }

  for (const load of options.design.estimate?.rooms ?? []) {
    if (seen.has(load.roomId)) continue;
    rows.push({
      name: load.name,
      level: levelName.get(load.levelId) ?? technicalLevel(load.levelId),
      area: load.area,
      setpoint: load.setpoint,
      load: load.total,
      specific: load.specific,
    });
  }

  return rows.sort((a, b) => {
    const ha = levelHeight.get(a.level);
    const hb = levelHeight.get(b.level);
    if (ha !== undefined && hb !== undefined && ha !== hb) return ha - hb;
    return a.level.localeCompare(b.level, 'de') || a.name.localeCompare(b.name, 'de');
  });
}

function chapterBuilding(options: PlantBookOptions, rows: readonly RoomRow[]): string {
  const { design } = options;
  if (rows.length === 0) {
    return paragraph(
      'Zu diesem Heft liegen keine Raumdaten vor. Die Gebäudeheizlast wurde als Summe übergeben; eine ' +
        'raumweise Aufteilung ist daraus nicht rekonstruierbar.',
    );
  }

  const areaSum = rows.reduce((sum, r) => sum + r.area, 0);
  const volumeSum = rows.reduce((sum, r) => sum + (r.volume ?? 0), 0);
  const loadSum = rows.reduce((sum, r) => sum + (r.load ?? 0), 0);
  const totals = options.raviaExport?.totals;

  const table = dataTable(
    [
      { label: 'Raum' },
      { label: 'Geschoss' },
      { label: 'Fläche', unit: 'm²', align: 'right' },
      { label: 'Volumen', unit: 'm³', align: 'right' },
      { label: 'ϑ innen', unit: '°C', align: 'right' },
      { label: 'Heizlast', unit: 'W', align: 'right' },
      { label: 'spezifisch', unit: 'W/m²', align: 'right' },
    ],
    rows.map((r) => [
      r.name,
      r.level,
      de(r.area, 2),
      r.volume === undefined ? '—' : de(r.volume, 2),
      r.setpoint === undefined ? '—' : de(r.setpoint, 0),
      r.load === undefined ? '—' : de(r.load, 0),
      r.specific === undefined ? '—' : de(r.specific, 0),
    ]),
    [
      plural(rows.length, 'beheizter Raum', 'beheizte Räume'),
      '',
      de(areaSum, 2),
      volumeSum > 0 ? de(volumeSum, 2) : '—',
      '',
      loadSum > 0 ? de(loadSum, 0) : '—',
      loadSum > 0 && areaSum > 0 ? de(loadSum / areaSum, 0) : '—',
    ],
  );

  const facts = factTable([
    {
      label: 'Gebäudeheizlast',
      value: `${de(design.heatLoad, 2)} kW`,
      note:
        design.heatLoadSource === 'norm'
          ? 'Als Norm-Heizlast übergeben.'
          : 'Überschlag aus Geometrie, U-Werten und Mindestluftwechsel.',
    },
    // `HeatLoadEstimate.total` steht in kW, `transmission` und `ventilation`
    // stehen in W — die beiden Teilbeträge kommen ungeteilt aus der Summe über
    // die Räume. Wer sie ohne Umrechnung neben die Gebäudeheizlast stellt,
    // druckt einen Nachweis, in dem die Teile das Tausendfache der Summe sind.
    design.estimate
      ? {
          label: 'davon Transmission',
          value: `${de(design.estimate.transmission / 1000, 2)} kW`,
          note: 'Wände, Fenster, Boden, Dach einschließlich Wärmebrückenzuschlag.',
        }
      : undefined,
    design.estimate
      ? {
          label: 'davon Lüftung',
          value: `${de(design.estimate.ventilation / 1000, 2)} kW`,
          note: 'Aus n_min · V.',
        }
      : undefined,
    design.estimate
      ? {
          label: 'Spezifische Heizlast',
          value: `${de(design.estimate.specific, 1)} W/m²`,
          note: design.estimate.klassifizierung,
        }
      : undefined,
    design.estimate
      ? {
          label: 'Norm-Außentemperatur',
          value: `${de(design.estimate.designOutdoor, 1)} °C`,
          note: 'Standortwert nach DIN EN 12831-1 Beiblatt.',
        }
      : options.raviaExport
        ? {
            label: 'Norm-Außentemperatur',
            value: `${de(options.raviaExport.project.designOutdoorTemperature, 1)} °C`,
          }
        : undefined,
    totals
      ? {
          label: 'Beheiztes Luftvolumen',
          value: `${de(totals.heatedVolume, 1)} m³`,
          note: `${totals.heatedRoomCount} von ${totals.roomCount} Räumen beheizt.`,
        }
      : undefined,
    totals
      ? {
          label: 'Hüllfläche/Volumen A/V',
          value: `${de(totals.compactness, 3)} 1/m`,
          note: 'Kompaktheit — je kleiner, desto günstiger das Verhältnis von Verlustfläche zu Nutzen.',
        }
      : undefined,
    totals
      ? {
          label: 'Fensterflächenanteil',
          value: pct(totals.windowWallRatio, 1),
          // Der Bezug ist die gesamte Fassadenfläche, nicht die opake Wand:
          // `windowWallRatio` rechnet Fenster/(Wand + Fenster). Stünde in der
          // Fußnote „x m² Fenster auf y m² Außenwand", rechnete der Leser
          // x/y nach und käme auf eine andere Zahl als die daneben.
          note:
            `${de(totals.windowArea, 1)} m² Fenster in ${de(totals.exteriorWallArea + totals.windowArea, 1)} m² ` +
            'Fassadenfläche; die restlichen ' +
            `${de(totals.exteriorWallArea, 1)} m² sind opake Außenwand.`,
        }
      : undefined,
  ]);

  return heading('Räume') + table + heading('Gebäudesummen') + facts;
}

// ---------------------------------------------------------------------------
// Kapitel 4 — Wärmeerzeuger
// ---------------------------------------------------------------------------

function generatorFacts(design: PlantDesignResult, model: HeatPumpModel, capacityAtDesign: number): string {
  const refrigerant = REFRIGERANTS[model.refrigerant];
  // CO₂-Äquivalent = Füllmenge [kg] · GWP; 1000 kg = 1 t. Bei R290 (GWP 3)
  // ergibt eine 1,2-kg-Füllung 0,0036 t — als „0,00 t" gedruckt liest sich das
  // wie „kein Äquivalent", und die Prüfschwellen der F-Gas-Verordnung hängen
  // genau an dieser Zahl. Unterhalb einer Tonne steht deshalb die Kilogramm-
  // Angabe; sie ist dieselbe Größe, nur nicht weggerundet.
  const kgCo2 = model.refrigerantMass * refrigerant.gwp;
  const co2Text = kgCo2 >= 1000 ? `${de(kgCo2 / 1000, 2)} t` : `${de(kgCo2, 1)} kg`;
  const outdoor = model.outdoor;
  const indoor = model.indoor;

  return factTable([
    { label: 'Bezeichnung', value: model.label, note: model.manufacturer ? `Hersteller: ${model.manufacturer}` : undefined },
    { label: 'Baureihe', value: model.series },
    { label: 'Bauform', value: PUMP_FORM_LABELS[model.form] },
    { label: 'Wärmequelle', value: HEAT_SOURCE_LABELS[model.source] },
    {
      label: 'Herkunft der Daten',
      value: model.provenance === 'hersteller' ? 'Herstellerangabe' : 'Typklasse (generisch)',
      note:
        model.provenance === 'hersteller'
          ? 'Werte aus dem Datenblatt; zwischen den Punkten wird interpoliert.'
          : 'Bereichswerte marktüblicher Geräte. Zum Vordimensionieren, nicht zum Bestellen.',
    },
    {
      label: 'Nennheizleistung',
      value: `${de(model.nominalCapacity, 2)} kW`,
      note: `Bezugspunkt ${model.nominalPoint}.`,
    },
    {
      label: 'Leistung im Auslegungspunkt',
      value: `${de(capacityAtDesign, 2)} kW`,
      note: 'Interpoliert aus der Leistungskurve bei der Norm-Außentemperatur.',
    },
    {
      label: 'Erforderliche Leistung',
      value: `${de(design.requiredCapacity, 2)} kW`,
      note:
        `Heizlast ${de(design.heatLoad, 2)} kW + Warmwasserzuschlag ${de(design.dhwSurcharge, 2)} kW, ` +
        `Sperrzeitfaktor ${de(design.blocking, 2)}.`,
    },
    {
      label: 'Deckungsgrad',
      value: pct(design.selected?.coverage, 0),
      note: design.selected ? `Bewertung: ${design.selected.verdict}. ${design.selected.reason}` : undefined,
    },
    {
      label: 'Höchste Vorlauftemperatur',
      value: `${de(model.maxFlowTemperature, 0)} °C`,
      note: 'Die Grenze für Heizkörperbestand und für die Trinkwassererwärmung ohne Nachheizung.',
    },
    model.scop35 !== undefined || model.scop55 !== undefined
      ? {
          label: 'Jahresarbeitszahl SCOP',
          value:
            [
              model.scop35 !== undefined ? `${de(model.scop35, 2)} bei 35 °C` : '',
              model.scop55 !== undefined ? `${de(model.scop55, 2)} bei 55 °C` : '',
            ]
              .filter(Boolean)
              .join(' · ') || '—',
          note: 'Nach EN 14825, mittleres Klima. Der Wert am Objekt hängt an Heizkurve und Betriebsweise.',
        }
      : undefined,
    {
      label: 'Mindestvolumenstrom',
      value: `${de(model.minVolumeFlow, 2)} m³/h`,
      note: 'Er bestimmt, ob ein Überströmventil oder eine Weiche nötig ist.',
    },
    {
      label: 'Mindestwasserinhalt',
      value: `${de(model.minSystemVolume, 0)} l`,
      note: 'Maßgebend für die Puffergröße; siehe Kapitel Speicher.',
    },
    { label: 'Heizungsanschluss', value: model.hydraulicConnection },
    model.refrigerantLines
      ? {
          label: 'Kältemittelleitungen',
          value: `flüssig ${model.refrigerantLines.liquid}, Sauggas ${model.refrigerantLines.gas}`,
          note:
            `Höchstens ${de(model.refrigerantLines.maxLength, 0)} m Länge und ` +
            `${de(model.refrigerantLines.maxHeight, 0)} m Höhenunterschied.`,
        }
      : undefined,
    {
      label: 'Kältemittel',
      value: `${model.refrigerant}, ${de(model.refrigerantMass, 2)} kg`,
      note:
        `Sicherheitsgruppe ${refrigerant.group}, GWP ${de(refrigerant.gwp, 0)}, entspricht ` +
        `${co2Text} CO₂-Äquivalent. ${refrigerant.note}`,
    },
    refrigerant.flammable
      ? {
          label: 'Brennbarkeit',
          value: 'brennbares Kältemittel',
          note:
            'Aufstellung, Schutzbereich und Prüfpflichten nach DIN EN 378 und der F-Gas-Verordnung sind ' +
            'gesondert nachzuweisen. Der Schutzbereich ist eine Herstellerangabe, keine Normzahl.',
        }
      : undefined,
    {
      label: 'Schallleistung außen',
      value:
        model.soundPowerOutdoor === undefined
          ? 'entfällt — keine Außeneinheit'
          : `${de(model.soundPowerOutdoor, 0)} dB(A)`,
      note:
        [
          model.soundPowerNight !== undefined ? `Flüsterbetrieb ${de(model.soundPowerNight, 0)} dB(A)` : '',
          model.soundPowerIndoor !== undefined ? `Inneneinheit ${de(model.soundPowerIndoor, 0)} dB(A)` : '',
        ]
          .filter(Boolean)
          .join(' · ') || undefined,
    },
    {
      label: 'Elektrik',
      value:
        `${model.electric.phases === 3 ? 'Drehstrom 400 V' : 'Wechselstrom 230 V'}, ` +
        `Absicherung ${de(model.electric.fuse, 0)} A`,
      note:
        [
          model.electric.maxCurrent !== undefined ? `max. Betriebsstrom ${de(model.electric.maxCurrent, 1)} A` : '',
          model.electric.startCurrent !== undefined ? `Anlaufstrom ${de(model.electric.startCurrent, 1)} A` : '',
          model.electric.backupHeater !== undefined
            ? `Elektro-Heizstab ${de(model.electric.backupHeater, 1)} kW`
            : '',
        ]
          .filter(Boolean)
          .join(' · ') || 'Anschluss und Anmeldung beim Netzbetreiber sind Sache der Elektroplanung.',
    },
    outdoor
      ? {
          label: 'Außeneinheit',
          value: `${de(outdoor.width, 2)} × ${de(outdoor.depth, 2)} × ${de(outdoor.height, 2)} m, ${de(outdoor.weight, 0)} kg`,
          note: 'Breite × Tiefe × Höhe. Freiräume für Luftführung und Wartung nach Herstellerangabe.',
        }
      : undefined,
    indoor
      ? {
          label: 'Inneneinheit',
          value: `${de(indoor.width, 2)} × ${de(indoor.depth, 2)} × ${de(indoor.height, 2)} m, ${de(indoor.weight, 0)} kg`,
          note:
            [
              indoor.integratedCylinder !== undefined
                ? `Trinkwasserspeicher ${de(indoor.integratedCylinder, 0)} l eingebaut`
                : '',
              indoor.integratedBuffer !== undefined ? `Pufferanteil ${de(indoor.integratedBuffer, 0)} l` : '',
              indoor.backupHeater !== undefined ? `Heizstab ${de(indoor.backupHeater, 1)} kW` : '',
            ]
              .filter(Boolean)
              .join(' · ') || undefined,
        }
      : undefined,
    model.note ? { label: 'Anmerkung', value: model.note } : undefined,
  ]);
}

function chapterGenerator(design: PlantDesignResult): string {
  const selected = design.selected;
  if (!selected) {
    return (
      paragraph(
        'Es wurde kein Wärmeerzeuger gewählt. Die Auslegung endet damit bei der erforderlichen Leistung; ' +
          'Puffer, Elektrik und Sicherheitstechnik lassen sich ohne Gerät nicht abschließen.',
      ) +
      factTable([
        { label: 'Gebäudeheizlast', value: `${de(design.heatLoad, 2)} kW` },
        { label: 'Warmwasserzuschlag', value: `${de(design.dhwSurcharge, 2)} kW` },
        { label: 'Sperrzeitfaktor', value: de(design.blocking, 2) },
        {
          label: 'Erforderliche Leistung',
          value: `${de(design.requiredCapacity, 2)} kW`,
          note: 'Das muss das Gerät im Auslegungspunkt können — nicht die Nennleistung im Katalogpunkt.',
        },
      ])
    );
  }

  const model = selected.model;
  const parts: string[] = [heading('Gewähltes Gerät'), generatorFacts(design, model, selected.capacityAtDesign)];

  if (model.ratings.length > 0) {
    parts.push(
      heading('Betriebspunkte'),
      dataTable(
        [
          { label: 'Punkt' },
          { label: 'Heizleistung', unit: 'kW', align: 'right' },
          { label: 'COP', unit: '—', align: 'right' },
        ],
        model.ratings.map((r) => [r.point, de(r.capacity, 2), de(r.cop, 2)]),
      ),
      hint(
        `Lesehilfe: ${quoted('A−7/W35')} bedeutet Außenluft −7 °C, Heizwasser 35 °C nach EN 14511. ` +
          'Zwischen den Punkten ' +
          'wird linear interpoliert.',
      ),
    );
  }

  const alternatives = design.matches.filter((m) => m.model.id !== model.id).slice(0, 5);
  if (alternatives.length > 0) {
    parts.push(
      heading('Weitere geprüfte Geräte'),
      dataTable(
        [
          { label: 'Gerät' },
          { label: 'Leistung im Auslegungspunkt', unit: 'kW', align: 'right' },
          { label: 'Deckung', unit: '%', align: 'right' },
          { label: 'Bewertung' },
        ],
        alternatives.map((m) => [
          m.model.label,
          de(m.capacityAtDesign, 2),
          de(m.coverage * 100, 0),
          m.verdict,
        ]),
      ),
      hint('Die Liste dokumentiert die Auswahl. Sie ist keine Empfehlung und kein Marktüberblick.'),
    );
  }

  return parts.join('');
}

// ---------------------------------------------------------------------------
// Kapitel 5 — Wärmeverteilung
// ---------------------------------------------------------------------------

/**
 * Die Verteilertabelle ist der Teil des Hefts, der auf der Baustelle wirklich
 * benutzt wird: Kreis für Kreis, Raum für Raum, mit dem Wert in l/h, der am
 * Durchflussmesser eingestellt wird. Deshalb steht sie raumweise und nicht als
 * Summe über den Kreis.
 */
function manifoldTable(circuit: CircuitDesign): string {
  const rooms = circuit.rooms ?? [];
  if (rooms.length === 0) return '';

  const loopSum = rooms.reduce((sum, r) => sum + r.floor.loops, 0);
  const areaSum = rooms.reduce((sum, r) => sum + r.area, 0);
  const loadSum = rooms.reduce((sum, r) => sum + r.load, 0);
  const flowSum = rooms.reduce((sum, r) => sum + r.floor.flowPerLoop * r.floor.loops, 0);

  return dataTable(
    [
      { label: 'Raum' },
      { label: 'Belegbare Fläche', unit: 'm²', align: 'right' },
      { label: 'Heizlast', unit: 'W', align: 'right' },
      { label: 'Wärmestromdichte', unit: 'W/m²', align: 'right' },
      { label: 'Verlegeabstand', unit: 'mm', align: 'right' },
      { label: 'Kreise', unit: 'Stück', align: 'right' },
      { label: 'Kreislänge', unit: 'm', align: 'right' },
      { label: 'Durchfluss je Kreis', unit: 'l/h', align: 'right' },
      { label: 'Δp Kreis', unit: 'mbar', align: 'right' },
    ],
    rooms.map((r) => [
      r.name,
      de(r.area, 2),
      de(r.load, 0),
      de(r.specificOutput, 0),
      de(r.floor.spacing * 1000, 0),
      de(r.floor.loops, 0),
      de(r.floor.loopLength, 1),
      de(r.floor.flowPerLoop, 0),
      de(r.floor.loopPressureMbar, 0),
    ]),
    [
      plural(rooms.length, 'Raum', 'Räume'),
      de(areaSum, 2),
      de(loadSum, 0),
      areaSum > 0 ? de(loadSum / areaSum, 0) : '—',
      '',
      de(loopSum, 0),
      '',
      // Die Spalte trägt den Wert *je Kreis* — der am Durchflussmesser
      // eingestellt wird. In der Summenzeile steht die Summe über alle Kreise
      // des Verteilers. Ohne das Summenzeichen liest jemand die Zahl als
      // Einstellwert und dreht den Verteiler um den Faktor der Kreisanzahl auf.
      `Σ ${de(flowSum, 0)}`,
      '',
    ],
  );
}

function chapterDistribution(design: PlantDesignResult): string {
  if (design.circuits.length === 0) {
    return paragraph(
      'Im Modell ist kein Heizkreis angelegt. Ohne Kreise gibt es weder Volumenströme noch Rohrdimensionen, ' +
        'und der Wasserinhalt der Anlage bleibt eine Schätzung.',
    );
  }

  const parts: string[] = [];

  parts.push(
    heading('Heizkreise'),
    dataTable(
      [
        { label: 'Kreis' },
        { label: 'Übergabe' },
        { label: 'Räume', unit: 'Stück', align: 'right' },
        { label: 'VL/RL', unit: '°C', align: 'right' },
        { label: 'Last', unit: 'kW', align: 'right' },
        { label: 'Volumenstrom', unit: 'm³/h', align: 'right' },
        { label: 'Anbindeleitung' },
        { label: 'v', unit: 'm/s', align: 'right' },
        { label: 'R', unit: 'Pa/m', align: 'right' },
        { label: 'Mischer' },
      ],
      design.circuits.map((c) => [
        c.circuit.label,
        CIRCUIT_KIND_LABELS[c.circuit.kind],
        de(c.circuit.roomIds.length, 0),
        `${de(c.circuit.flowTemperature, 0)}/${de(c.circuit.returnTemperature, 0)}`,
        de(c.load, 2),
        de(c.flow, 3),
        `${PIPE_MATERIAL_LABELS[c.pipe.dimension.material]} ${c.pipe.dimension.label}`,
        de(c.pipe.velocity, 2),
        de(c.pipe.gradient, 0),
        c.circuit.mixed ? 'ja' : 'nein',
      ]),
      [
        plural(design.circuits.length, 'Kreis', 'Kreise'),
        '',
        '',
        '',
        de(
          design.circuits.reduce((sum, c) => sum + c.load, 0),
          2,
        ),
        de(design.totalFlow, 3),
        '',
        '',
        '',
        '',
      ],
    ),
  );

  const reasons = [
    ...new Set(design.circuits.map((c) => PIPE_REASON_LABELS[c.pipe.reason])),
  ];
  parts.push(
    hint(
      `Maßgebend für die Rohrwahl: ${reasons.join(', ')}. Die Dimension folgt aus Volumenstrom, zulässiger ` +
        'Fließgeschwindigkeit und zulässigem Druckgefälle — nicht aus der Anschlussgröße des Verteilers.',
    ),
  );

  for (const circuit of design.circuits) {
    const table = manifoldTable(circuit);
    if (!table) continue;
    const floor = circuit.floor;
    parts.push(heading(`Verteiler ${quoted(circuit.circuit.label)}`));
    if (floor) {
      parts.push(
        factTable([
          {
            label: 'Auslegungstemperaturen',
            value: `${de(circuit.circuit.flowTemperature, 0)} / ${de(circuit.circuit.returnTemperature, 0)} °C`,
            note: `Spreizung ${de(floor.spread, 1)} K, Übertemperatur Δϑ_H = ${de(floor.logMeanOverTemperature, 1)} K.`,
          },
          { label: 'Rohr in der Fläche', value: `${PIPE_MATERIAL_LABELS[floor.dimension.material]} ${floor.dimension.label}` },
          {
            label: 'Rohrbedarf',
            value: `${de(floor.totalLength, 0)} m`,
            note: `${de(floor.fieldLength, 0)} m in der Fläche, Rest Anbindung. Wasserinhalt ${de(floor.waterContent, 1)} l.`,
          },
          {
            label: 'Oberflächentemperatur',
            value: `${de(floor.surfaceTemperature, 1)} °C`,
            note:
              `Grenze ${de(floor.maxSurfaceTemperature, 1)} °C, daraus höchstens ` +
              `${de(floor.maxSpecificOutput, 0)} W/m². Der Wert ist ein Mittel über die Fläche; über dem Rohr ` +
              'liegt die Temperatur höher.',
          },
          {
            label: 'Ungünstigster Kreis',
            value: `${de(floor.loopPressureMbar, 0)} mbar`,
            note: `Fließgeschwindigkeit ${de(floor.velocity, 2)} m/s.`,
          },
        ]),
      );
    }
    parts.push(table);
  }

  const pump = design.pump;
  if (pump) {
    parts.push(
      heading('Umwälzpumpe'),
      factTable([
        { label: 'Förderstrom', value: `${de(pump.flow, 3)} m³/h` },
        {
          label: 'Förderhöhe',
          value: `${de(pump.head, 2)} m`,
          note: `Entspricht ${de(pump.pressureKpa, 1)} kPa bzw. ${de(pump.pressureMbar, 0)} mbar.`,
        },
        {
          label: 'Ungünstigster Strang',
          value: `${de(pump.worstPathLoss, 0)} Pa`,
          note: `Zuschlag ${de(pump.safetyFactor, 2)}; Erzeuger und Kesselgruppe ${de(pump.generatorLoss, 0)} Pa.`,
        },
        {
          label: 'Abzudrosseln',
          value: `${de(pump.balancingSpread, 0)} Pa`,
          note: 'Differenz zum zweitschlechtesten Strang — so viel Druck ist dort im Abgleich abzubauen.',
        },
        {
          label: 'Leistungsaufnahme',
          value: `${de(pump.electricPower, 0)} W`,
          note: `Hydraulisch ${de(pump.hydraulicPower, 0)} W bei angesetztem Wirkungsgrad ${pct(pump.efficiency, 0)}.`,
        },
        pump.residualHead !== undefined
          ? {
              label: 'Restförderhöhe',
              value: `${de(pump.residualHead, 2)} m`,
              note: pump.sufficient ? 'Die eingebaute Pumpe reicht.' : 'Die eingebaute Pumpe reicht nicht.',
            }
          : undefined,
      ]),
    );
  }

  return parts.join('');
}

// ---------------------------------------------------------------------------
// Kapitel 6 — Speicher und Trinkwasser
// ---------------------------------------------------------------------------

function storageFact(label: string, storage: PlantStorage | undefined, fallback: string): Fact {
  if (!storage) return { label, value: fallback };
  // Viele Katalogbezeichnungen tragen das Volumen bereits im Namen. Es ein
  // zweites Mal anzuhängen liest sich wie ein Fehler in der Ausgabe.
  const volume = `${de(storage.volume, 0)} l`;
  return {
    label,
    value: storage.label.includes(volume) ? storage.label : `${storage.label} · ${volume}`,
    note:
      `${STORAGE_KIND_LABELS[storage.kind]}. ` +
      (storage.suggested ? 'Vom Programm vorgeschlagen.' : 'Vom Planer festgelegt.') +
      (storage.note ? ` ${storage.note}` : ''),
  };
}

/** Was die Aufheizleistung begrenzt — als Satz, nicht als Aufzählungswert. */
const REHEAT_LIMIT_TEXTS: Record<DomesticWaterResult['reheat']['limitedBy'], string> = {
  'wärmetauscher': 'Begrenzt durch die Übertragungsleistung des Speicherwärmetauschers.',
  erzeuger: 'Begrenzt durch die Leistung des Wärmeerzeugers.',
  keine: 'Weder Erzeuger noch Wärmetauscher begrenzen die Aufheizung.',
};

function domesticWaterSection(dhw: DomesticWaterResult, storage: PlantStorage | undefined): string {
  const parts: string[] = [heading('Trinkwassererwärmung')];

  parts.push(
    factTable([
      storageFact('Speicher', storage, 'Kein Speicher zugeordnet'),
      {
        label: 'Bedarfskennzahl N',
        value: de(dhw.demandIndex, 2),
        note:
          `${plural(dhw.units, 'Wohneinheit', 'Wohneinheiten')}, ${plural(dhw.occupants, 'Person', 'Personen')}. ` +
          'Nach DIN 4708-1. Der Speicher muss über seine Leistungskennzahl N_L mindestens dieses N abdecken — ' +
          'das prüft das Datenblatt, nicht dieses Heft.',
      },
      {
        label: 'Empfohlener Inhalt',
        value: `${de(dhw.recommendedVolume, 0)} l`,
        note:
          `${dhw.storage.reason} Angesetzt sind ${pct(dhw.storage.usableFraction)} des Inhalts als nutzbar — ` +
          'der Rest ist Schichtung und Totzone über und unter dem Wärmetauscher.',
      },
      dhw.catalogVolume !== undefined
        ? {
            label: 'Nächste Baugröße',
            value: `${de(dhw.catalogVolume, 0)} l`,
            note: 'Aus der Baugrößenreihe des Katalogs aufgerundet.',
          }
        : undefined,
      {
        label: 'Temperaturen',
        value: `Speicher ${de(dhw.storageTemperature, 0)} °C, Zapfstelle ${de(dhw.tapTemperature, 0)} °C`,
        note: 'Die Zapftemperatur wird über einen Verbrühschutz eingestellt; sie ist keine Speichertemperatur.',
      },
      {
        label: 'Aufheizleistung',
        value: `${de(dhw.reheatCapacity, 2)} kW`,
        // Die Sätze werden gefügt und nicht mit festen Trennzeichen
        // aneinandergehängt: bleibt einer leer, stünde sonst eine doppelte
        // Lücke mitten in der Fußnote — der Leser sucht dann nach dem Wort,
        // das dort fehlt. Der Grund der Begrenzung ist über die Union
        // typisiert und deshalb im Typ immer vorhanden; über die Typgrenze
        // hinweg — etwa aus einem älteren gespeicherten Stand — kann er
        // trotzdem fehlen. Dann entfällt der Satz, und das Heft wird
        // gedruckt, statt beim Drucken abzubrechen.
        note: [
          `Für ${de(dhw.reheatTime, 1)} h Aufheizzeit.`,
          REHEAT_LIMIT_TEXTS[dhw.reheat.limitedBy],
          dhw.reheat.available !== undefined
            ? `Verfügbar ${de(dhw.reheat.available, 2)} kW, erreichbare Zeit ${de(dhw.reheat.achievableTime, 1)} h.`
            : 'Die Übertragungsleistung des Speicherwärmetauschers ist am Datenblatt gegenzuprüfen.',
        ]
          .filter((satz: string | undefined) => satz !== undefined && satz.length > 0)
          .join(' '),
      },
    ]),
  );

  parts.push(
    heading('Legionellen'),
    factTable([
      {
        label: 'Einstufung',
        value: dhw.legionellaRegime === 'großanlage' ? 'Großanlage' : 'Kleinanlage',
        note: dhw.legionellaReason,
      },
      {
        label: 'Maßgebende Speichertemperatur',
        value: `${de(dhw.legionella.requiredStorageTemperature, 0)} °C`,
        note:
          dhw.legionellaRegime === 'großanlage'
            ? 'Forderung aus DVGW W 551.'
            : 'Empfehlung, keine Normforderung: unter 50 °C wächst Legionella pneumophila, über 55 °C stirbt sie ab.',
      },
      dhw.legionella.requiredCirculationReturn !== undefined
        ? {
            label: 'Zirkulationsrücklauf',
            value: `mindestens ${de(dhw.legionella.requiredCirculationReturn, 0)} °C`,
            note: 'Nach DVGW W 551 darf die Temperatur im System um höchstens 5 K abfallen.',
          }
        : undefined,
      {
        label: 'Untersuchungspflicht',
        value: dhw.legionella.inspectionDuty ? 'ja, nach TrinkwV' : 'nein',
        note: dhw.legionella.inspectionDuty
          ? 'Anzeige beim Gesundheitsamt und wiederkehrende Beprobung sind zu veranlassen.'
          : undefined,
      },
    ]),
  );

  parts.push(
    heading('Zirkulation'),
    factTable([
      {
        label: 'Erforderlich',
        value: dhw.circulationRequired ? 'ja' : 'nein',
        note: dhw.circulationReason,
      },
      {
        label: 'Maßgebender Leitungsinhalt',
        value: `${de(dhw.circulation.content, 2)} l`,
        note:
          'Erwärmer bis zur entferntesten Entnahmestelle, ohne Zirkulationsleitung. Über 3 l verlangt ' +
          'DIN 1988-200 Zirkulation oder Begleitheizung.',
      },
      dhw.circulation.circulationFlow !== undefined
        ? {
            label: 'Zirkulationsvolumenstrom',
            value: `${de(dhw.circulation.circulationFlow, 0)} l/h`,
            note:
              `Bei ${de(dhw.circulation.circulationSpread, 1)} K Abkühlung` +
              (dhw.circulation.heatLoss !== undefined
                ? ` und ${de(dhw.circulation.heatLoss, 0)} W Leitungsverlust.`
                : '.'),
          }
        : undefined,
    ]),
  );

  return parts.join('');
}

/**
 * Hat das Kapitel „Speicher und Trinkwasser" etwas zu sagen?
 *
 * Die Frage entscheidet zwei Dinge und wird deshalb einmal beantwortet: ob im
 * Inhaltsverzeichnis „(ohne Angaben)" steht und ob die Zahlen des Kapitels
 * gedruckte Werte oder Striche sind. Liefen beide Antworten auseinander, stünde
 * ein Kapitel mit gedruckten Nullen ohne Marke im Verzeichnis — der Fall, den
 * die Marke gerade sichtbar machen soll.
 *
 * Inhalt hat das Kapitel, sobald eine seiner Größen aus dem Modell stammt: ein
 * zugeordneter Puffer, ein gerechneter Pufferbedarf, ein Wasserinhalt der
 * Anlage oder eine Trinkwasserrechnung. Fehlt alles, sind die 0 l keine
 * Aussage über die Anlage, sondern der Startwert einer Auslegung, die nie
 * gelaufen ist; er gehört als Strich ins Heft.
 */
function hasStorageContent(design: PlantDesignResult): boolean {
  const gerechnet = (value: number): boolean => Number.isFinite(value) && value > 0;
  return (
    design.buffer.selected !== undefined ||
    design.dhw !== undefined ||
    gerechnet(design.buffer.required) ||
    gerechnet(design.volume.total)
  );
}

function chapterStorage(design: PlantDesignResult): string {
  const parts: string[] = [heading('Pufferspeicher')];
  const ausgelegt = hasStorageContent(design);

  parts.push(
    factTable([
      {
        label: 'Erforderlich',
        value: ausgelegt ? `${de(design.buffer.required, 0)} l` : '—',
        note: design.buffer.reason,
      },
      storageFact('Gewählt', design.buffer.selected, 'Kein Puffer erforderlich oder keiner zugeordnet'),
      {
        label: 'Wasserinhalt der Anlage',
        value: ausgelegt ? `${de(design.volume.total, 0)} l` : '—',
        // Der Verweis auf das Kapitel Sicherheitstechnik gilt nur, wenn dort
        // auch die Aufstellung steht — ohne Sicherheitsauslegung zeigt er ins
        // Leere, und ein Querverweis auf eine leere Seite ist schlimmer als
        // keiner.
        note: design.safety
          ? 'Summe aus Erzeuger, Speicher, Verteilleitungen und Heizflächen. Die Aufstellung steht im Kapitel ' +
            'Sicherheitstechnik, weil sie dort in die Gefäßgröße eingeht.'
          : 'Summe aus Erzeuger, Speicher, Verteilleitungen und Heizflächen. Die Aufstellung nach Anteilen ' +
            'fehlt, solange die Sicherheitsausrüstung nicht ausgelegt ist.',
      },
    ]),
  );

  parts.push(
    hint(
      'Ein Puffer ist kein Selbstzweck. Er deckt die Abtauung, hält die Mindestlaufzeit ein und entkoppelt den ' +
        'Erzeuger von zugefahrenen Heizkreisen. Wo der Wasserinhalt der Anlage das schon leistet, ist der ' +
        'kleinere Puffer der bessere — jeder zusätzliche Liter ist auch zusätzlicher Bereitschaftsverlust.',
    ),
  );

  if (design.dhw) {
    parts.push(domesticWaterSection(design.dhw, design.dhwStorage));
  } else {
    parts.push(
      heading('Trinkwassererwärmung'),
      paragraph(
        'Für dieses Projekt wurde keine Trinkwasserauslegung gerechnet. Speichergröße, Aufheizleistung und ' +
          'die Bewertung nach DVGW W 551 fehlen damit; sie sind vor der Ausführung nachzuholen.',
      ),
    );
  }

  return parts.join('');
}

// ---------------------------------------------------------------------------
// Kapitel 7 — Sicherheitstechnik
// ---------------------------------------------------------------------------

/**
 * Die Druckkette in der Reihenfolge, in der sie gerechnet wird.
 *
 * p_0 aus der statischen Höhe, p_F darüber, p_e unter dem Ansprechdruck des
 * Sicherheitsventils — jede Zeile mit dem Zwischenwert, aus dem die nächste
 * folgt. Wer nur Anfang und Ende sieht, kann die Rechnung nicht prüfen, und
 * genau das ist der Zweck dieser Tabelle.
 */
function pressureChain(safety: SafetyDesign): string {
  // Die erste Zeile ist eine Länge, alle folgenden sind Drücke. Deshalb trägt
  // die Tabelle eine eigene Einheitenspalte und die Wertspalte keine Einheit
  // im Kopf: eine Spalte mit „bar ü" über einem Meterwert ist genau der
  // Zahlendreher, den ein Prüfer der Rechnung anlastet.
  return dataTable(
    [
      { label: 'Größe' },
      { label: 'Formelzeichen' },
      { label: 'Wert', align: 'right' },
      { label: 'Einheit' },
      { label: 'Herkunft' },
    ],
    [
      [
        'Statische Höhe',
        'h_st',
        de(safety.staticHeight, 2),
        'm',
        'Höchster Anlagenpunkt über dem Gefäß — Grundlage von p_0.',
      ],
      [
        'Vordruck des Gefäßes',
        'p_0',
        de(safety.prePressure, 2),
        'bar ü',
        'Statische Höhe zuzüglich Zuschlag gegen Unterdruck am höchsten Punkt.',
      ],
      [
        'Fülldruck',
        'p_F',
        de(safety.fillPressure, 2),
        'bar ü',
        'Über p_0, damit die Wasservorlage vorhanden ist.',
      ],
      [
        'Ansprechdruck Sicherheitsventil',
        'p_SV',
        de(safety.safetyPressure, 2),
        'bar ü',
        'Bauteilwert des gewählten Ventils.',
      ],
      [
        'Enddruck',
        'p_e',
        de(safety.endPressure, 2),
        'bar ü',
        'Unter p_SV mit dem geforderten Schließdruckabfall — sonst spricht das Ventil im Normalbetrieb an.',
      ],
    ],
  );
}

function chapterSafety(design: PlantDesignResult): string {
  const safety = design.safety;
  if (!safety) {
    return paragraph(
      'Die Sicherheitsausrüstung wurde nicht ausgelegt. Ohne Ausdehnungsgefäß, Sicherheitsventil und die ' +
        'zugehörige Armaturenkette darf die Anlage nicht betrieben werden; die Auslegung ist nachzuholen.',
    );
  }

  const parts: string[] = [heading('Druckkette'), pressureChain(safety)];

  parts.push(
    heading('Ausdehnungsgefäß'),
    factTable([
      {
        label: 'Ausdehnungsvolumen',
        value: `${de(safety.expansionVolume, 1)} l`,
        note: 'Volumenzunahme des Anlagenwassers zwischen Füll- und Höchsttemperatur.',
      },
      {
        label: 'Wasservorlage',
        value: `${de(safety.waterSeal, 1)} l`,
        note: 'Reserve gegen Leckverluste und gegen Abkühlung unter die Fülltemperatur.',
      },
      {
        label: 'Rechnerisches Nennvolumen',
        value: `${de(safety.requiredVessel, 1)} l`,
        note: 'Aus Ausdehnungsvolumen, Wasservorlage und dem Druckverhältnis (p_e + 1)/(p_e − p_0).',
      },
      {
        label: 'Gewählte Baugröße',
        value: `${de(safety.selectedVessel, 0)} l`,
        note: 'Nächste Größe der Baureihe. Der Vordruck ist am Gefäß einzustellen und zu protokollieren.',
      },
      {
        label: 'Ausdehnungsleitung',
        value: `DN ${de(safety.expansionLine, 0)}`,
        note: 'Absperrbar nur mit gesicherter Kappenventilarmatur; ein normales Absperrventil ist unzulässig.',
      },
      safety.glycol
        ? {
            label: 'Frostschutz',
            value: `${de(safety.glycol.fraction, 0)} Vol-% ${safety.glycol.kind === 'ethylen' ? 'Ethylenglykol' : 'Propylenglykol'}`,
            note:
              `Frostsicher bis ${de(safety.glycol.freezePoint, 1)} °C. Der Volumenstrom steigt um den Faktor ` +
              `${de(safety.glycol.flowFactor, 3)}; Pumpe und Rohrdimension sind darauf ausgelegt.`,
          }
        : undefined,
    ]),
  );

  parts.push(
    heading('Sicherheitsventil'),
    factTable([
      {
        label: 'Nennweite',
        value: `${safety.safetyValve.label} (DN ${de(safety.safetyValve.dn, 0)})`,
        note: `Bis ${de(safety.safetyValve.maxCapacity, 0)} kW Nennwärmeleistung, Ansprechdruck ${de(safety.safetyPressure, 1)} bar.`,
      },
      {
        label: 'Abblaseleitung',
        value: 'frei und beobachtbar über eine Entwässerung',
        note: 'Nicht absperrbar, nicht verengt, mit Gefälle. Der Austritt muss gefahrlos beobachtbar sein.',
      },
    ]),
  );

  parts.push(
    heading('Wasserinhalt der Anlage'),
    dataTable(
      [{ label: 'Anteil' }, { label: 'Inhalt', unit: 'l', align: 'right' }],
      safety.volumeParts.map((part) => [part.label, de(part.volume, 1)]),
      ['Summe', de(safety.systemVolume, 1)],
    ),
  );

  if (safety.fittings.length > 0) {
    parts.push(
      heading('Armaturen'),
      dataTable(
        [
          { label: 'Pos', align: 'right' },
          { label: 'Armatur' },
          { label: 'Technische Angabe' },
          { label: 'Regelwerk' },
        ],
        safety.fittings.map((f, i) => [de(i + 1, 0), f.label, f.spec, f.norm]),
      ),
      hint(
        'Die Liste nennt die Pflichtarmaturen mit dem Regelwerk, aus dem sie folgen. Bauteilprüfzeichen, ' +
          'Einbaulage und Zugänglichkeit für die Wartung sind am Bauteil zu prüfen.',
      ),
    );
  }

  return parts.join('');
}

// ---------------------------------------------------------------------------
// Kapitel 8 — Hinweise
// ---------------------------------------------------------------------------

interface CollectedNote extends PlanningNote {
  /** Aus welchem Rechenschritt der Hinweis stammt. */
  origin: string;
}

/**
 * Alle Hinweise der Auslegung an einem Ort, Fehler zuerst.
 *
 * Die Kerne melden ihre Hinweise dort, wo sie entstehen — im Kreis, im
 * Speicher, in der Sicherheitstechnik. Für den, der das Heft liest, ist die
 * Verteilung über sieben Kapitel unbrauchbar: ein Fehler in der Trinkwasser-
 * auslegung darf nicht deshalb übersehen werden, weil er auf Seite neun steht.
 * Doppelte Texte werden zusammengefasst; die Herkunft bleibt erhalten, damit
 * nachvollziehbar ist, worauf sich der Hinweis bezieht.
 */
function collectNotes(design: PlantDesignResult): CollectedNote[] {
  const collected: CollectedNote[] = [];
  const push = (origin: string, notes: readonly PlanningNote[] | undefined): void => {
    for (const note of notes ?? []) collected.push({ ...note, origin });
  };

  push('Auslegung', design.notes);
  for (const circuit of design.circuits) {
    push(`Heizkreis ${circuit.circuit.label}`, circuit.notes);
    push(`Heizkreis ${circuit.circuit.label}`, circuit.floor?.notes);
    for (const room of circuit.rooms ?? []) push(`Raum ${room.name}`, room.notes);
  }
  push('Pumpe', design.pump?.notes);
  push('Trinkwasser', design.dhw?.notes);
  push('Sicherheitstechnik', design.safety?.notes);

  const merged = new Map<string, CollectedNote>();
  for (const note of collected) {
    const key = `${note.severity}|${note.text}`;
    const found = merged.get(key);
    if (!found) {
      merged.set(key, note);
      continue;
    }
    if (!found.origin.includes(note.origin)) found.origin = `${found.origin}, ${note.origin}`;
  }

  return [...merged.values()].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

function chapterNotes(notes: readonly CollectedNote[]): string {
  if (notes.length === 0) {
    return paragraph(
      'Die Auslegung ist ohne Hinweise durchgelaufen. Das bedeutet, dass keine der geprüften Bedingungen ' +
        'verletzt wurde — nicht, dass die Anlage vollständig geplant ist.',
    );
  }

  const counts = {
    error: notes.filter((n) => n.severity === 'error').length,
    warn: notes.filter((n) => n.severity === 'warn').length,
    info: notes.filter((n) => n.severity === 'info').length,
  };

  const rows = notes.map((note) => [
    {
      html:
        `<tr class="${note.severity}">` +
        `<td class="l"><span class="schwere">${escapeHtml(SEVERITY_LABELS[note.severity])}</span></td>` +
        `<td class="l">${escapeHtml(note.text)}</td>` +
        `<td class="l">${escapeHtml(note.origin)}</td>` +
        `</tr>`,
    },
  ]);

  // Die Zeilen tragen eine eigene Klasse für die Schwere; deshalb hier die
  // Tabelle von Hand statt über `dataTable`.
  const body = rows.map((row) => (typeof row[0] === 'string' ? '' : row[0].html)).join('');

  return (
    paragraph(
      `Die Auslegung hat ${plural(counts.error, 'Fehler', 'Fehler')}, ` +
        `${plural(counts.warn, 'Warnung', 'Warnungen')} und ` +
        `${plural(counts.info, 'Hinweis', 'Hinweise')} gemeldet. Fehler stehen zuerst: sie bezeichnen eine verletzte ` +
        'Bedingung, nicht eine Geschmacksfrage, und müssen vor der Ausführung geklärt sein.',
    ) +
    `<table class="daten"><thead><tr><th class="l">Schwere</th><th class="l">Hinweis</th>` +
    `<th class="l">Herkunft</th></tr></thead><tbody>${body}</tbody></table>`
  );
}

// ---------------------------------------------------------------------------
// Kapitel 9 — Inbetriebnahme
// ---------------------------------------------------------------------------

interface ChecklistItem {
  task: string;
  /** Was einzutragen ist — leer, wenn nur abzuhaken. */
  field?: string;
  note?: string;
}

/**
 * Die Checkliste ist bewusst kurz und bewusst unvollständig.
 *
 * Sie enthält die Schritte, die aus *dieser* Auslegung folgen und deren
 * Ergebnis in dieses Heft gehört — vor allem Vordruck und Fülldruck, weil die
 * Gefäßrechnung ohne die gemessenen Werte unbelegt bleibt. Eine vollständige
 * Inbetriebnahme folgt dem Protokoll des Geräteherstellers; diese Liste ersetzt
 * es nicht und tut auch nicht so.
 */
function checklistItems(design: PlantDesignResult): ChecklistItem[] {
  const items: ChecklistItem[] = [
    {
      task: 'Anlage gespült',
      note: 'Vor dem Füllen, gegen Montagerückstände und Späne im Wärmetauscher.',
    },
    {
      task: 'Anlage gefüllt und Wasserqualität geprüft',
      field: 'Leitfähigkeit / pH',
      note: 'Füllwasser nach VDI 2035; das Ergebnis gehört ins Anlagenbuch.',
    },
    {
      task: 'Vordruck des Ausdehnungsgefäßes drucklos geprüft und eingestellt',
      field: 'p_0 = ______ bar',
      note: design.safety
        ? `Rechnerisch ${de(design.safety.prePressure, 2)} bar. Prüfung nur bei drucklos entleerter Wasserseite.`
        : 'Rechenwert liegt nicht vor — die Sicherheitsauslegung fehlt.',
    },
    {
      task: 'Fülldruck der kalten Anlage eingetragen',
      field: 'p_F = ______ bar',
      note: design.safety ? `Rechnerisch ${de(design.safety.fillPressure, 2)} bar bei kalter Anlage.` : undefined,
    },
    {
      task: 'Anlage entlüftet, Schnellentlüfter geöffnet',
      note: 'An allen Hochpunkten, am Erzeuger und am Speicher; nach dem ersten Aufheizen wiederholen.',
    },
    {
      task: 'Voreinstellwerte übertragen und protokolliert',
      // Verweise gehen über den Kapitelnamen, nicht über die Nummer: die
      // Nummer verschiebt sich, sobald ein Kapitel weggelassen wird, und ein
      // falscher Querverweis ist schlimmer als gar keiner.
      note: 'Durchflussmesser und Ventile nach der Verteilertabelle im Kapitel Wärmeverteilung.',
    },
    {
      task: 'Heizkurve eingestellt',
      field: 'Steilheit / Niveau',
      note: design.circuits.length
        ? `Auslegungsvorlauf ${de(Math.max(...design.circuits.map((c) => c.circuit.flowTemperature)), 0)} °C ` +
          'bei Norm-Außentemperatur. Höher eingestellt kostet unmittelbar Arbeitszahl.'
        : undefined,
    },
    {
      task: 'Sicherheitsventil auf Gangbarkeit geprüft',
      note: 'Anlüften, Abblaseleitung frei und beobachtbar.',
    },
  ];

  if (design.circuits.some((c) => c.circuit.kind === 'floor')) {
    items.push({
      task: 'Estrich-Aufheizprotokoll erstellt',
      field: 'Datum Beginn / Ende',
      note: 'Funktionsheizen vor dem Belegen; das Protokoll ist Voraussetzung für die Bodenlegerabnahme.',
    });
  }

  if (design.dhw) {
    items.push(
      {
        task: 'Trinkwasserleitungen gespült',
        note: 'Nach DIN 1988-200 vor der Inbetriebnahme; Spülprotokoll beilegen.',
      },
      {
        task: 'Speichertemperatur und Legionellenschaltung eingestellt',
        field: `ϑ = ______ °C`,
        note: `Maßgebend ${de(design.dhw.legionella.requiredStorageTemperature, 0)} °C — ${design.dhw.legionellaReason}`,
      },
    );
  }

  items.push({
    task: 'Übergabe an den Betreiber erklärt',
    note: 'Bedienung, Heizkurve, Fülldruck, Störmeldungen, Wartungsintervalle. Unterlagen übergeben.',
  });

  return items;
}

function chapterCommissioning(design: PlantDesignResult, options: PlantBookOptions): string {
  const items = checklistItems(design);

  const rows = items
    .map(
      (item) =>
        `<tr><td class="l"><span class="kasten"></span></td>` +
        `<td class="l"><strong>${escapeHtml(item.task)}</strong>` +
        (item.note ? `<div class="fussnote">${escapeHtml(item.note)}</div>` : '') +
        `</td>` +
        `<td class="l">${item.field ? `${escapeHtml(item.field)} <span class="feld"></span>` : ''}</td></tr>`,
    )
    .join('');

  return (
    paragraph(
      'Abzuhaken auf der Baustelle. Die Zeilen mit Eintragfeld sind auszufüllen — ohne die gemessenen Drücke ' +
        'ist die Gefäßrechnung im Kapitel Sicherheitstechnik nicht belegt.',
    ) +
    `<table class="daten check"><thead><tr><th class="l">erledigt</th><th class="l">Schritt</th>` +
    `<th class="l">Eintrag</th></tr></thead><tbody>${rows}</tbody></table>` +
    `<div class="unterschrift">` +
    `<div>Ort, Datum</div>` +
    `<div>Ausführendes Unternehmen</div>` +
    `<div>Betreiber</div>` +
    `</div>` +
    `<p class="schluss">${escapeHtml(
      `Anlagenbuch ${options.plantName} · ${options.projectName} · Stand ${options.date} · erstellt von ${options.author}`,
    )}</p>`
  );
}

// ---------------------------------------------------------------------------
// Zusammenbau
// ---------------------------------------------------------------------------

interface ChapterPlan {
  id: PlantBookChapterId;
  title: string;
  /** Inhalt des Kapitels ohne Rahmen. */
  body: string;
  hasContent: boolean;
  emptyReason?: string;
}

/**
 * Baut das Anlagenbuch als vollständiges HTML-Dokument.
 *
 * Alles, was das Dokument braucht, steckt darin: Stil, Text, Tabellen. Es
 * lässt sich speichern, per Mail versenden und in zehn Jahren wieder öffnen,
 * ohne dass ein Server antworten muss.
 */
export function buildPlantBook(options: PlantBookOptions): PlantBookResult {
  const format = options.format ?? 'A4';
  const omit = new Set(options.omit ?? []);
  const design = options.design;
  const rooms = collectRooms(options);
  const notes = collectNotes(design);
  const title = `Anlagenbuch ${options.plantName} — ${options.projectName}`;

  const allPlans: ChapterPlan[] = [
    { id: 'deckblatt', title: 'Deckblatt', body: '', hasContent: true },
    {
      id: 'grenzen',
      title: 'Was hier steht und was nicht',
      body: chapterLimits(options),
      hasContent: true,
    },
    {
      id: 'gebaeude',
      title: 'Gebäude',
      body: chapterBuilding(options, rooms),
      hasContent: rooms.length > 0,
      emptyReason: rooms.length > 0 ? undefined : 'Keine Raumdaten übergeben.',
    },
    {
      id: 'erzeuger',
      title: 'Wärmeerzeuger',
      body: chapterGenerator(design),
      hasContent: design.selected !== undefined,
      emptyReason: design.selected ? undefined : 'Kein Gerät gewählt.',
    },
    {
      id: 'verteilung',
      title: 'Wärmeverteilung',
      body: chapterDistribution(design),
      hasContent: design.circuits.length > 0,
      emptyReason: design.circuits.length > 0 ? undefined : 'Kein Heizkreis angelegt.',
    },
    {
      id: 'speicher',
      title: 'Speicher und Trinkwasser',
      body: chapterStorage(design),
      hasContent: hasStorageContent(design),
      emptyReason: hasStorageContent(design) ? undefined : 'Kein Speicher und keine Trinkwasserauslegung.',
    },
    {
      id: 'sicherheit',
      title: 'Sicherheitstechnik',
      body: chapterSafety(design),
      hasContent: design.safety !== undefined,
      emptyReason: design.safety ? undefined : 'Sicherheitsausrüstung nicht ausgelegt.',
    },
    {
      id: 'hinweise',
      title: 'Hinweise',
      body: chapterNotes(notes),
      hasContent: notes.length > 0,
      emptyReason: notes.length > 0 ? undefined : 'Keine Hinweise gemeldet.',
    },
    {
      id: 'inbetriebnahme',
      title: 'Inbetriebnahme-Checkliste',
      body: chapterCommissioning(design, options),
      hasContent: true,
    },
  ];
  const plans = allPlans.filter((plan) => !omit.has(plan.id));

  // Die Nummerierung entsteht erst nach dem Weglassen: ein Heft mit den
  // Kapiteln 1, 2, 4, 5 sieht aus, als fehle eine Seite. Das Deckblatt zählt
  // als Kapitel 1 mit, trägt seine Nummer aber nicht sichtbar — ein Deckblatt
  // mit aufgedruckter „1" sieht aus wie eine verlorene Seite 1.
  const chapters: PlantBookChapter[] = plans.map((plan, index) => ({
    id: plan.id,
    number: index + 1,
    title: plan.title,
    anchor: `kapitel-${plan.id}`,
    hasContent: plan.hasContent,
    emptyReason: plan.emptyReason,
  }));

  const headerLeft = `${options.projectName} · ${options.plantName}`;
  const headerRight = `Anlagenbuch · ${options.date}`;

  const sections = plans
    .map((plan, index) => {
      if (plan.id === 'deckblatt') return chapterCover(options, chapters);
      const chapter = chapters[index];
      return (
        `<section class="kapitel" id="${chapter.anchor}">` +
        `<div class="blattkopf"><span>${escapeHtml(headerLeft)}</span>` +
        `<span>${escapeHtml(`Kapitel ${chapter.number} · ${plan.title}`)}</span></div>` +
        `<h2><span class="nr">${chapter.number}</span>${escapeHtml(plan.title)}</h2>` +
        plan.body +
        `</section>`
      );
    })
    .join('');

  const html =
    `<!doctype html><html lang="de"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${escapeHtml(title)}</title>` +
    `<style>${styleSheet(format, headerLeft, headerRight)}</style>` +
    `</head><body><div class="buch">${sections}</div></body></html>`;

  return { html, title, chapters };
}

/**
 * Öffnet das Anlagenbuch in einem Druckfenster.
 *
 * Dieselbe Bequemlichkeitsfunktion wie `printPlan` in `planPrint.ts` und die
 * einzige Stelle dieses Moduls, die `window` anfasst — sie steht bewusst am
 * Ende, damit der Rest der Datei ohne Browser läuft und geprüft werden kann.
 *
 * Rückgabe `false` heißt: der Browser hat das Fenster blockiert. Die Oberfläche
 * muss das anzeigen, sonst passiert für den Nutzer scheinbar nichts.
 */
export function printPlantBook(html: string, title = 'Anlagenbuch'): boolean {
  const win = window.open('', '_blank');
  if (!win) return false;
  // Der Titel des Fensters wird gesetzt, bevor der Druckdialog aufgeht: er ist
  // in den meisten Browsern der vorgeschlagene Dateiname beim Speichern als PDF.
  //
  // Zwei Fallstricke, beide mit demselben Auslöser — ein Projektname, den
  // jemand frei eintippt:
  //  • `JSON.stringify` schützt Anführungszeichen, aber nicht das
  //    Kleinerzeichen. Ein Titel mit `</script>` beendet den Skriptblock
  //    mitten im Dokument; deshalb wird es als Unicode-Escape geschrieben,
  //    das innerhalb einer JavaScript-Zeichenkette dasselbe Zeichen ergibt.
  //  • Der Ersatztext von `String.replace` deutet `$&`, `$'` und `` $` `` als
  //    Muster. Ein Projektname mit `$&` bekäme dort den gefundenen Text
  //    eingesetzt. Eine Ersatzfunktion wird nicht gedeutet.
  const script =
    `<script>document.title=${JSON.stringify(title).replace(/</g, '\\u003c')};` +
    `window.addEventListener('load',function(){setTimeout(function(){window.print()},250)})<\/script></body>`;
  win.document.write(html.replace('</body>', () => script));
  win.document.close();
  return true;
}
