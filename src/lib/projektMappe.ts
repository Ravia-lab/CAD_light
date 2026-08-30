/**
 * Projektmappe — vier Druckwege, ein Dokument.
 * ---------------------------------------------------------------------------
 * **Der Anlass.** Bis 1.13.2 druckte dieses Programm aus vier getrennten
 * Stellen: den Grundriss (`planPrint`), das Anlagenschema (`schematicPrint`),
 * den Rohrnetzbericht (`pipeReportPrint`) und das Anlagenbuch (`plantBook`).
 * Vier Fenster, vier Blattzählungen, vier Deckblätter, viermal derselbe
 * Vorbehalt in anderen Worten. Wer eine Anlage übergibt, braucht **ein**
 * Dokument mit einem Inhaltsverzeichnis und einer durchlaufenden
 * Blattnummer — sonst heftet er vier Stapel zusammen und hofft, dass sie
 * denselben Stand zeigen.
 *
 * **Was dieses Modul deshalb nicht tut: zeichnen.** Es setzt die vorhandenen
 * Bauer zusammen und ruft sie mit denselben Argumenten auf, die auch die
 * Einzelfenster benutzen. Kein Grundriss, keine Teilstreckentabelle, kein
 * Schema wird hier ein zweites Mal gebaut. Das ist keine Bequemlichkeit,
 * sondern die wichtigste Regel dieses Projekts: **eine Geometriequelle für
 * Bildschirm, Blatt und 3D.** Drei der teuersten Fehler dieses Programms
 * entstanden aus zwei Kopien derselben Geometrie, die auseinanderliefen —
 * und auffielen, als ein Ausdruck anders aussah als der Bildschirm.
 *
 * Neu geschrieben wird hier ausschließlich das, was es noch nirgends gibt:
 * Deckblatt, Inhaltsverzeichnis, das Blatt zur Pumpenauslegung samt
 * Erzeugerbilanz, der Massenauszug als Blattfolge, das Quellenverzeichnis
 * und der Nachweiskatalog als eigenes Blatt.
 *
 * **Warum HTML mit eingebetteten SVG-Blättern.** Die Zeichnungen sind
 * maßhaltige SVGs in Millimetern und müssen es bleiben — ein Grundriss, den
 * der Browser auf die Seite skaliert, ist kein Maßstab mehr. Der Fließtext
 * dagegen braucht Umbruch, Silbentrennung und wiederholte Tabellenköpfe, und
 * die bekommt man in SVG nur durch Nachbau. HTML kann beides tragen: das SVG
 * als Block mit fester Millimeterbreite, den Text darum herum. Den Weg ins
 * PDF übernimmt der Druckdialog des Browsers — dieselbe Entscheidung wie in
 * `planPrint`, `pipeReportPrint` und `plantBook` und aus demselben Grund:
 * Vektor-PDF in Originalqualität, ohne ein einziges Kilobyte Bibliothek.
 *
 * **Warum durchgehend Querformat.** Die Teilstreckentabelle führt sechzehn
 * Spalten und passt hochkant nicht — das steht so in `pipeReportPrint` und
 * ist dort begründet. Eine Mappe mit wechselnder Blattausrichtung braucht
 * zwei `@page`-Regeln; benannte Druckseiten kennen längst nicht alle Browser,
 * und der Fehlerfall ist ein abgeschnittenes Blatt. Also ein Format für
 * alles, und zwar das, ohne das ein Kapitel gar nicht darstellbar wäre.
 *
 * **Keine Uhr, kein DOM, kein Store.** Das Datum kommt als fertige
 * Zeichenkette von außen; ein Dokument, das sich bei jedem Aufruf umdatiert,
 * taugt nicht als Nachweis. Auf `window` greift einzig `printProjektMappe`
 * am Dateiende zu — dieselbe Bequemlichkeitsfunktion wie `printPlantBook`.
 */

import type { BimDocument, WertHerkunft } from '../types/bim';
import { PIPE_MATERIAL_LABELS } from '../types/bim';
import type { RohrnetzBericht } from './pipeReport';
import { berichtsUrteil, buildPipeReport, wissensbasis } from './pipeReport';
import { buildPipeReportSheets } from './pipeReportPrint';
import { buildPlanSvg } from './planPrint';
import { buildSchematicSvg } from './schematicPrint';
import { buildPlantBook } from './plantBook';
import { buildMaterialSchedule, type MaterialItem } from './materialSchedule';
import { plantOf } from './plantDefaults';
import { GENERATOR, buildRaviaExport } from './raviaExport';
import { BELASTBARKEIT_LABELS, KORPUS_LABELS, type KorpusId, type WissensEintrag } from './wissensbasis';
import { druckeDokument } from './druckFenster';

// ---------------------------------------------------------------------------
// Öffentliche Typen
// ---------------------------------------------------------------------------

export type MappeFormat = 'A4' | 'A3';

/** Die Kapitel der Mappe in der Reihenfolge, in der sie gedruckt werden. */
export type MappeKapitelId =
  | 'deckblatt'
  | 'inhalt'
  | 'grundriss'
  | 'schema'
  | 'rohrnetz'
  | 'einstellwerte'
  | 'pumpe'
  | 'massenauszug'
  | 'anlagenbuch'
  | 'quellen'
  | 'nachweis';

/**
 * Ein Blatt der Mappe.
 *
 * `art` unterscheidet die beiden Sorten, und die Unterscheidung ist keine
 * Kosmetik: ein **Zeichnungsblatt** ist ein maßhaltiges SVG und belegt genau
 * eine Druckseite; ein **Textblatt** ist Fließtext und darf auf eine
 * Folgeseite überlaufen. Deshalb zählt die Mappe Blätter und nicht
 * Druckseiten — die Zahl der Druckseiten kennt erst der Browser, und ein
 * Inhaltsverzeichnis, das sie behauptet, würde raten.
 */
export interface MappeBlatt {
  /** Fortlaufende Blattnummer über die ganze Mappe, bei 1 beginnend. */
  nr: number;
  kapitel: MappeKapitelId;
  /** Beschriftung am Heftrand — sie macht ein herausgelöstes Blatt zuordenbar. */
  titel: string;
  art: 'zeichnung' | 'text';
}

/**
 * Ein Kapitel in der Übersicht.
 *
 * `blaetter` ist bewusst eine Liste und keine Spanne: das Kapitel
 * „Einstellwerte" liegt mitten in der Blattfolge des Rohrnetzberichts, und
 * eine Spanne würde die Blätter dazwischen mit vereinnahmen.
 */
export interface MappeKapitel {
  id: MappeKapitelId;
  /** Nummer im Inhaltsverzeichnis, bei 1 beginnend. */
  nummer: number;
  titel: string;
  /** Blattnummern dieses Kapitels, aufsteigend. */
  blaetter: number[];
  /** Dieselbe Aussage als Zeichenkette, z. B. „9–13, 16". */
  blattBereich: string;
  /** Hat das Kapitel etwas zu sagen? */
  inhalt: boolean;
  /** Warum es nichts zu sagen hat — leer, wenn es Inhalt hat. */
  grund?: string;
}

export interface ProjektMappeOptionen {
  /** Datum als fertige Zeichenkette. Dieses Modul liest keine Uhr. */
  datum: string;
  /** Projektname; ohne Angabe der Name aus dem Modell. */
  projektName?: string;
  /** Anlagenbezeichnung, z. B. „Wärmepumpenanlage Haus 1". */
  anlagenName?: string;
  /** Wer die Mappe erstellt hat. */
  bearbeiter?: string;
  /** Programmstand fürs Deckblatt; ohne Angabe die Kennung aus `raviaExport`. */
  programmstand?: string;
  format?: MappeFormat;
  /**
   * Maßstabsnenner der Grundrisse. Passt ein Geschoss darin nicht aufs Blatt,
   * weicht die Mappe für **alle** Geschosse auf den nächstpassenden Nenner
   * aus — zwei Grundrisse derselben Mappe in verschiedenen Maßstäben sind der
   * sicherste Weg, zwei Räume miteinander zu verwechseln.
   */
  planMassstab?: number;
  /**
   * Fertiger Rohrnetzbericht. Ohne Angabe baut ihn die Mappe selbst.
   *
   * Die Oberfläche reicht ihren eigenen Bericht herein, damit die Mappe
   * dieselben Zahlen zeigt wie das Berichtsfenster daneben — insbesondere
   * denselben Auslegungsdruck am Thermostatventil.
   */
  bericht?: RohrnetzBericht;
  /** Kapitel weglassen. Deckblatt und Inhaltsverzeichnis bleiben immer. */
  omit?: readonly MappeKapitelId[];
}

export interface ProjektMappe {
  /** Das vollständige Dokument, eingebetteter Stil inbegriffen. */
  html: string;
  /** Dokumenttitel — auch der Titel des Druckfensters. */
  titel: string;
  kapitel: MappeKapitel[];
  blaetter: MappeBlatt[];
  /** Blattmaße [mm] — dieselben für jedes Blatt der Mappe. */
  blattmass: { w: number; h: number };
  /** Tatsächlich verwendeter Maßstabsnenner der Grundrisse. */
  planMassstab: number;
  /** Deutsche Hinweise für die Oberfläche — leer, wenn alles glatt lief. */
  hinweise: string[];
}

// ---------------------------------------------------------------------------
// Maße und Zahlen
// ---------------------------------------------------------------------------

/** Hochformat-Maße [mm]; die Mappe dreht sie ins Querformat. */
const PAPIER: Record<MappeFormat, { w: number; h: number }> = {
  A4: { w: 210, h: 297 },
  A3: { w: 297, h: 420 },
};

/**
 * Ränder der Textblätter [mm].
 *
 * Links breiter als rechts: dort läuft der Heftrand mit der Blattnummer, und
 * er ist genau die Zone, die auf jedem Blatt dieses Programms frei bleibt —
 * `planPrint`, `pipeReportPrint` und `schematicPrint` beginnen ihren Inhalt
 * übereinstimmend bei 12 mm. Deshalb darf die Mappe dort ihre eigene Zählung
 * hinschreiben, ohne einer der vorhandenen Zeichnungen ins Bild zu fahren.
 */
const RAND = { oben: 13, rechts: 14, unten: 15, links: 22 };

/** Breite des Heftrands [mm] — schmaler als die 12 mm, die überall frei sind. */
const HEFTRAND = 11;

/**
 * Zulässige Maßstäbe für die Grundrisse der Mappe.
 *
 * `planPrint` rundet seinen Vorschlag auf Fünferschritte auf und liefert damit
 * Nenner wie 1:55. Rechnerisch stimmt das, auf einem Bauplan ist es trotzdem
 * falsch: abgegriffen wird mit dem Maßstabsdreieck, und das kennt diese
 * Reihe hier. Die Mappe weicht deshalb auf den nächsten Nenner der Reihe aus.
 */
const MASSSTABSREIHE: readonly number[] = [20, 25, 50, 75, 100, 125, 200, 250, 500];

/**
 * Deutsche Zahl: Komma als Dezimaltrenner, Punkt als Tausendertrenner.
 *
 * Bewusst nicht über `toLocaleString` — dieselbe Begründung wie im
 * Anlagenbuch: ein Nachweis, dessen Zahlenformat von der Systemsprache des
 * Rechners abhängt, ist kein Nachweis. Was keine darstellbare Zahl ist, wird
 * zum Strich; eine gedruckte 0 wäre eine Aussage, die die Zahl nicht trägt.
 */
function de(wert: number | undefined | null, stellen = 1): string {
  if (wert === undefined || wert === null || !Number.isFinite(wert)) return '—';
  if (Math.abs(wert) >= 1e21) return '—';
  let text = wert.toFixed(stellen);
  if (/^-0(\.0*)?$/.test(text)) text = text.slice(1);
  const negativ = text.startsWith('-');
  if (negativ) text = text.slice(1);
  const [ganz, bruch] = text.split('.');
  const gruppiert = ganz.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negativ ? '−' : ''}${gruppiert}${bruch ? `,${bruch}` : ''}`;
}

const ENTITAET: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (z) => ENTITAET[z]);
}

/** Woher ein hydraulischer Kennwert stammt — im Klartext fürs Blatt. */
const HERKUNFT_LABELS: Record<WertHerkunft, string> = {
  tabellenwert: 'Tabellenwert des Herstellers',
  'diagramm-abgelesen': 'aus dem Diagramm abgelesen',
  abgeleitet: 'aus anderen Angaben abgeleitet',
  annahme: 'Annahme dieses Programms',
};

/**
 * Wie viele Tabellenzeilen auf ein Textblatt passen.
 *
 * **Warum überhaupt gerechnet und nicht dem Browser überlassen.** Ein
 * Inhaltsverzeichnis nennt Blattnummern, und die stimmen nur, wenn beim Bau
 * der Mappe feststeht, wo umbrochen wird. Der Browser weiß das erst beim
 * Drucken; dieses Modul hat kein DOM und kann nicht messen. Also wird
 * gerechnet — dieselbe Rechnung wie in `pipeReportPrint`: nutzbare Höhe durch
 * Zeilenhöhe. Die Zeilenhöhen sind an gedruckten Blättern abgenommen, nicht
 * geschätzt; sie stehen an der Aufrufstelle, weil eine Zeile mit Fußnote
 * anders hoch ist als eine ohne.
 *
 * @param vorspann Höhe von Überschrift, Einleitung und Tabellenkopf [mm]
 * @param zeile    Höhe einer Datenzeile [mm]
 */
function zeilenBudget(blatt: { w: number; h: number }, vorspann: number, zeile: number): number {
  return Math.max(6, Math.floor((blatt.h - RAND.oben - RAND.unten - vorspann) / zeile));
}

/**
 * Blattnummern zu einer lesbaren Angabe zusammenfassen.
 *
 * Aus 9, 10, 11, 13 wird „9–11, 13". Zusammenhängende Läufe zu verschmelzen
 * ist der Unterschied zwischen einem Inhaltsverzeichnis, das man liest, und
 * einer Zahlenkolonne, die man überspringt.
 */
export function blattBereich(nummern: readonly number[]): string {
  if (!nummern.length) return '—';
  const sortiert = [...nummern].sort((a, b) => a - b);
  const teile: string[] = [];
  let von = sortiert[0];
  let bis = sortiert[0];
  for (const n of sortiert.slice(1)) {
    if (n === bis + 1) {
      bis = n;
      continue;
    }
    teile.push(von === bis ? `${von}` : `${von}–${bis}`);
    von = n;
    bis = n;
  }
  teile.push(von === bis ? `${von}` : `${von}–${bis}`);
  return teile.join(', ');
}

// ---------------------------------------------------------------------------
// Fremden Stil einbetten
// ---------------------------------------------------------------------------

/**
 * Das Stilblatt des Anlagenbuchs auf einen Bereich der Mappe einschränken.
 *
 * **Warum überhaupt.** Das Anlagenbuch liefert ein vollständiges HTML-Dokument
 * mit eigenem Stilblatt. Dieses Stilblatt hier nachzubauen wäre genau die
 * Doppelung, die dieses Modul vermeiden soll: es würde still auseinanderlaufen,
 * sobald jemand am Anlagenbuch etwas ändert. Also wird es übernommen — aber
 * eingeschränkt, sonst setzt es der ganzen Mappe seine Seitenränder und seine
 * Schriftgrößen auf.
 *
 * Zwei Regelsorten müssen dabei fallen:
 *  • `@page` — das Anlagenbuch will A4 hoch mit 18 mm Rand. Die Mappe legt
 *    ihr Blattformat selbst fest, und bei `@page` gewinnt die letzte Regel;
 *    stehen beide im Dokument, entscheidet die Reihenfolge im Stilblatt
 *    darüber, ob eine Zeichnung abgeschnitten wird.
 *  • `@media screen` — die Bildschirmvorschau des Anlagenbuchs setzt einen
 *    dunklen Hintergrund und eine eigene Blattbreite. Die Mappe hat ihre
 *    eigene Vorschau.
 *
 * `html` und `body` werden auf den Bereich selbst abgebildet: sie tragen
 * Schrift und Grundfarbe, die im eingebetteten Kapitel gelten sollen, dürfen
 * aber nicht das ganze Dokument einfärben.
 *
 * Der Zerleger achtet auf Zeichenketten, weil im `@page`-Block der Projektname
 * steht — eine geschweifte Klammer im Projektnamen würde eine reine
 * Klammerzählung aus dem Tritt bringen.
 */
export function skopiereStil(css: string, praefix: string): string {
  const raus: string[] = [];
  let i = 0;

  /** Ab `start` bis zur schließenden Klammer des dort beginnenden Blocks. */
  const blockEnde = (start: number): number => {
    let tiefe = 0;
    let anfuehrung: string | undefined;
    for (let j = start; j < css.length; j++) {
      const z = css[j];
      if (anfuehrung) {
        if (z === '\\') j++;
        else if (z === anfuehrung) anfuehrung = undefined;
        continue;
      }
      if (z === '"' || z === "'") anfuehrung = z;
      else if (z === '{') tiefe++;
      else if (z === '}') {
        tiefe--;
        if (tiefe === 0) return j;
      }
    }
    return css.length;
  };

  while (i < css.length) {
    const auf = css.indexOf('{', i);
    if (auf < 0) break;
    const wahl = css.slice(i, auf).trim();
    const zu = blockEnde(auf);
    const rumpf = css.slice(auf + 1, zu);
    i = zu + 1;
    if (!wahl || wahl.startsWith('@')) continue; // @page und @media fallen weg
    // Doppelte Einträge entstehen dort, wo mehrere Wurzelselektoren auf
    // denselben Bereich abgebildet werden — `html,body{…}` ergäbe sonst
    // `.anlagenbuch,.anlagenbuch{…}`. Das wäre gültig und trotzdem falsch:
    // wer das Stilblatt liest, sucht nach dem Fehler.
    const wahlen = [
      ...new Set(
        wahl
          .split(',')
          .map((w) => w.trim())
          .filter(Boolean)
          .map((w) => (w === 'html' || w === 'body' ? praefix : `${praefix} ${w}`)),
      ),
    ];
    if (wahlen.length) raus.push(`${wahlen.join(',')}{${rumpf}}`);
  }
  return raus.join('');
}

/** Inhalt des ersten Elements dieser Art aus einem fremden Dokument. */
function innerHtml(dokument: string, tag: string): string {
  const treffer = new RegExp(`<${tag}[^>]*>([\\s\\S]*)</${tag}>`).exec(dokument);
  return treffer ? treffer[1] : '';
}

// ---------------------------------------------------------------------------
// Bausteine der eigenen Blätter
// ---------------------------------------------------------------------------

/** Eine Überschrift im Kapitel. */
const h2 = (text: string): string => `<h2>${escapeHtml(text)}</h2>`;
const h3 = (text: string): string => `<h3>${escapeHtml(text)}</h3>`;
const p = (text: string): string => `<p>${escapeHtml(text)}</p>`;

interface Spalte {
  titel: string;
  /** Rechtsbündig — für alles, was gerechnet wurde. */
  rechts?: boolean;
  /** Feste Spaltenbreite, z. B. „28mm". */
  breite?: string;
}

/**
 * Eine Datentabelle.
 *
 * Die Zellen kommen als **fertiges Markup** herein und nicht als Rohtext:
 * einzelne Zellen tragen eine Fußnote oder eine Auszeichnung, und eine
 * Tabellenfunktion, die alles maskiert, zwingt den Aufrufer zu einer zweiten
 * Tabellenfunktion daneben. Maskiert wird deshalb an der Stelle, an der der
 * Text entsteht.
 */
function tabelle(spalten: readonly Spalte[], zeilen: readonly string[][]): string {
  const kopf = spalten
    .map(
      (s) =>
        `<th class="${s.rechts ? 'r' : 'l'}"${s.breite ? ` style="width:${s.breite}"` : ''}>${escapeHtml(s.titel)}</th>`,
    )
    .join('');
  const rumpf = zeilen
    .map(
      (z) =>
        `<tr>${spalten.map((s, i) => `<td class="${s.rechts ? 'r' : 'l'}">${z[i] ?? ''}</td>`).join('')}</tr>`,
    )
    .join('');
  return `<table class="daten"><thead><tr>${kopf}</tr></thead><tbody>${rumpf}</tbody></table>`;
}

/** Zweispaltige Kennwertliste — Bezeichnung links, Wert rechts. */
function kennwerte(zeilen: readonly ({ label: string; wert: string; fussnote?: string } | undefined)[]): string {
  const rumpf = zeilen
    .filter((z): z is { label: string; wert: string; fussnote?: string } => z !== undefined)
    .map(
      (z) =>
        `<tr><th class="l">${escapeHtml(z.label)}</th><td class="l">${escapeHtml(z.wert)}` +
        (z.fussnote ? `<div class="fussnote">${escapeHtml(z.fussnote)}</div>` : '') +
        `</td></tr>`,
    )
    .join('');
  return `<table class="daten kennwerte"><tbody>${rumpf}</tbody></table>`;
}

/** Ein Merkkasten — für alles, was der Leser nicht überlesen darf. */
const kasten = (text: string): string => `<p class="hinweiskasten">${escapeHtml(text)}</p>`;

// ---------------------------------------------------------------------------
// Der Aufbau
// ---------------------------------------------------------------------------

/** Ein Blatt, bevor es seine Nummer bekommen hat. */
interface BlattEntwurf {
  kapitel: MappeKapitelId;
  titel: string;
  art: 'zeichnung' | 'text';
  /** Fertiges Markup ohne Blattrahmen. */
  inhalt: string;
}

/** Kopfdaten eines Kapitels, unabhängig von seinen Blättern. */
interface KapitelKopf {
  id: MappeKapitelId;
  titel: string;
  inhalt: boolean;
  grund?: string;
}

/**
 * Die Projektmappe bauen.
 *
 * Reihenfolge und Begründung:
 *
 *  1. **Rohrnetzbericht zuerst** — er trägt die Anlagenauslegung
 *     (`bericht.auslegung`), die Erzeugerbilanz und den Nachweiskatalog.
 *     Alles Weitere hängt daran, und es gibt ihn genau einmal: würde das
 *     Anlagenbuch seine eigene Auslegung rechnen, könnten Deckblatt und
 *     Anlagenbuch verschiedene Heizlasten drucken.
 *  2. **Zeichnungen**, mit einem Maßstab für alle Geschosse.
 *  3. **Eigene Blätter** aus den Daten, die noch kein Blatt haben.
 *  4. **Nummerierung und Inhaltsverzeichnis** ganz zum Schluss — erst dann
 *     steht fest, wie viele Blätter jedes Kapitel belegt.
 */
export function buildProjektMappe(doc: BimDocument, optionen: ProjektMappeOptionen): ProjektMappe {
  const format = optionen.format ?? 'A4';
  const papier = PAPIER[format];
  // Querformat für alles — die Begründung steht im Kopfkommentar.
  const blattmass = { w: papier.h, h: papier.w };
  const omit = new Set(optionen.omit ?? []);
  const hinweise: string[] = [];

  const projektName = optionen.projektName || doc.meta.name || 'Projekt ohne Namen';
  const anlagenName = optionen.anlagenName || 'Heizungsanlage';
  const bearbeiter = optionen.bearbeiter || 'RaVia CAD Light';
  const programmstand = optionen.programmstand || GENERATOR;

  const bericht = optionen.bericht ?? buildPipeReport(doc);
  const auslegung = bericht.auslegung;
  const urteil = berichtsUrteil(bericht);

  const entwuerfe: BlattEntwurf[] = [];
  const koepfe: KapitelKopf[] = [];
  const kopf = (id: MappeKapitelId, titel: string, inhalt: boolean, grund?: string): void => {
    koepfe.push({ id, titel, inhalt, grund });
  };

  // Deckblatt und Inhaltsverzeichnis stehen fest an Blatt 1 und 2; ihr Text
  // entsteht erst unten, weil er die Blattzahl kennen muss.
  kopf('deckblatt', 'Deckblatt', true);
  kopf('inhalt', 'Inhaltsverzeichnis', true);

  // --- Kapitel 3: Grundriss je Geschoss ------------------------------------
  const planMassstab = grundrissBlaetter(doc, bericht, format, optionen.planMassstab ?? 50, entwuerfe, hinweise, kopf);

  // --- Kapitel 4: Anlagenschema --------------------------------------------
  if (!omit.has('schema')) {
    schemaBlaetter(doc, format, projektName, anlagenName, bearbeiter, optionen.datum, entwuerfe, hinweise, kopf);
  }

  // --- Kapitel 5 und 6: Rohrnetzbericht und Einstellwerte -------------------
  if (!omit.has('rohrnetz')) {
    rohrnetzBlaetter(doc, bericht, format, entwuerfe, hinweise, kopf);
  }

  // --- Kapitel 7: Pumpenauslegung und Erzeugerkreis -------------------------
  if (!omit.has('pumpe')) {
    entwuerfe.push({
      kapitel: 'pumpe',
      titel: 'Pumpenauslegung und Erzeugerkreis',
      art: 'text',
      inhalt: pumpenBlatt(bericht),
    });
    kopf(
      'pumpe',
      'Pumpenauslegung und Erzeugerkreis',
      bericht.pumpe !== undefined,
      bericht.pumpe ? undefined : 'Ohne Rohrnetz gibt es keinen ungünstigsten Strang und damit keine Förderhöhe.',
    );
  }

  // --- Kapitel 8: Massenauszug ---------------------------------------------
  if (!omit.has('massenauszug')) {
    massenauszugBlaetter(doc, auslegung, blattmass, entwuerfe, kopf);
  }

  // --- Kapitel 9: Anlagenbuch ----------------------------------------------
  let buchStil = '';
  if (!omit.has('anlagenbuch')) {
    buchStil = anlagenbuchBlaetter(doc, bericht, format, projektName, anlagenName, bearbeiter, optionen.datum, entwuerfe, kopf);
  }

  // --- Kapitel 10: Quellenverzeichnis --------------------------------------
  if (!omit.has('quellen')) {
    quellenBlaetter(bericht, blattmass, entwuerfe, kopf);
  }

  // --- Kapitel 11: Nachweiskatalog -----------------------------------------
  if (!omit.has('nachweis')) {
    entwuerfe.push({
      kapitel: 'nachweis',
      titel: 'Nachweiskatalog § 60c Abs. 4 GModG',
      art: 'text',
      inhalt: nachweisBlatt(bericht),
    });
    kopf('nachweis', 'Nachweiskatalog nach § 60c Abs. 4 GModG', true);
  }

  // --- Nummerierung ---------------------------------------------------------
  // Deckblatt und Inhaltsverzeichnis belegen Blatt 1 und 2; alles Weitere
  // zählt ab 3. Die Zählung entsteht hier und nirgends sonst — sie ist die
  // eine Zahl, die die vier zusammengesetzten Druckwege bisher nicht kannten.
  const gesamt = entwuerfe.length + 2;
  const blaetter: MappeBlatt[] = [
    { nr: 1, kapitel: 'deckblatt', titel: 'Deckblatt', art: 'text' },
    { nr: 2, kapitel: 'inhalt', titel: 'Inhaltsverzeichnis', art: 'text' },
    ...entwuerfe.map((e, i) => ({ nr: i + 3, kapitel: e.kapitel, titel: e.titel, art: e.art })),
  ];

  const kapitel: MappeKapitel[] = koepfe.map((k, i) => {
    const nummern = blaetter.filter((b) => b.kapitel === k.id).map((b) => b.nr);
    return {
      id: k.id,
      nummer: i + 1,
      titel: k.titel,
      blaetter: nummern,
      blattBereich: blattBereich(nummern),
      inhalt: k.inhalt,
      grund: k.grund,
    };
  });

  // --- Blätter setzen -------------------------------------------------------
  const deckblattHtml = deckblatt(bericht, {
    projektName,
    adresse: doc.meta.address,
    bauherr: doc.meta.client,
    anlagenName,
    bearbeiter,
    programmstand,
    datum: optionen.datum,
    format,
    planMassstab,
    blattzahl: gesamt,
    urteil,
  });
  const inhaltHtml = inhaltsverzeichnis(kapitel, gesamt, hinweise);

  /*
   * Die Blattkennung steht auf jedem Blatt — sonst ist ein herausgelöstes
   * Blatt nicht mehr zuordenbar, und genau das passiert einer Mappe auf der
   * Baustelle. Wo sie steht, hängt an der Blattart:
   *
   *  • **Zeichnungsblatt** — senkrecht im linken Heftrand. Die Zeichnung füllt
   *    das Blatt vollständig; frei ist auf jedem Blatt dieses Programms nur
   *    der Streifen bis 12 mm, weil `planPrint`, `pipeReportPrint` und
   *    `schematicPrint` dort übereinstimmend beginnen.
   *  • **Textblatt** — waagerecht als Kopfzeile, wie im Anlagenbuch. Dort ist
   *    Platz, und quer gelesen wird sie schneller erfasst.
   */
  const rahmen = (blatt: MappeBlatt, inhalt: string): string => {
    const kennung = `Blatt ${blatt.nr} von ${gesamt} · ${blatt.titel}`;
    const kopfzeile =
      blatt.art === 'zeichnung'
        ? `<div class="heftrand"><span>${escapeHtml(`${projektName} · ${kennung}`)}</span></div>`
        : `<div class="blattkopf"><span>${escapeHtml(`${projektName} · ${anlagenName}`)}</span>` +
          `<span>${escapeHtml(kennung)}</span></div>`;
    return (
      `<section class="blatt ${blatt.art}" id="blatt-${blatt.nr}">` +
      kopfzeile +
      `<div class="feld">${inhalt}</div>` +
      `</section>`
    );
  };

  const koerper =
    rahmen(blaetter[0], deckblattHtml) +
    rahmen(blaetter[1], inhaltHtml) +
    entwuerfe.map((e, i) => rahmen(blaetter[i + 2], e.inhalt)).join('');

  const titel = `Projektmappe ${projektName}`;
  const html =
    `<!doctype html><html lang="de"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${escapeHtml(titel)}</title>` +
    `<style>${stilblatt(blattmass)}${buchStil}</style>` +
    `</head><body><div class="mappe">${koerper}</div></body></html>`;

  return { html, titel, kapitel, blaetter, blattmass, planMassstab, hinweise };
}

// ---------------------------------------------------------------------------
// Kapitel 3 — Grundriss je Geschoss
// ---------------------------------------------------------------------------

/**
 * Für jedes Geschoss mit Wänden ein Grundrissblatt.
 *
 * Gezeichnet wird von `buildPlanSvg` — derselben Funktion, die der
 * Plandruck und der Rohrnetzbericht benutzen. Zwei Zeichenwege für denselben
 * Grundriss wären der Fehler, den dieses Projekt schon zweimal gemacht hat.
 *
 * Der Maßstab gilt für die ganze Mappe: passt ein Geschoss im gewünschten
 * Nenner nicht, wird für **alle** Geschosse auf den größten notwendigen
 * Nenner ausgewichen. Zwei Grundrisse eines Hauses in verschiedenen
 * Maßstäben nebeneinander sind der sicherste Weg, zwei Räume zu verwechseln.
 *
 * @returns der tatsächlich verwendete Maßstabsnenner
 */
function grundrissBlaetter(
  doc: BimDocument,
  bericht: RohrnetzBericht,
  format: MappeFormat,
  wunsch: number,
  entwuerfe: BlattEntwurf[],
  hinweise: string[],
  kopf: (id: MappeKapitelId, titel: string, inhalt: boolean, grund?: string) => void,
): number {
  const geschosse = Object.values(doc.levels)
    .filter((l) => Object.values(doc.walls).some((w) => w.levelId === l.id))
    .sort((a, b) => a.order - b.order || a.elevation - b.elevation);

  if (!geschosse.length) {
    kopf('grundriss', 'Grundriss je Geschoss', false, 'Im Modell steht keine Wand.');
    entwuerfe.push({
      kapitel: 'grundriss',
      titel: 'Grundriss — kein Geschoss gezeichnet',
      art: 'text',
      inhalt:
        h2('Grundriss je Geschoss') +
        p(
          'Im Modell steht keine Wand, also gibt es keinen Grundriss zu drucken. Die Mappe lässt das Kapitel ' +
            'stehen, statt es zu verschweigen: ein Inhaltsverzeichnis ohne Grundriss wirft die Frage auf, ob das ' +
            'Blatt verlorengegangen ist.',
        ) +
        kasten(
          'Ein Grundriss entsteht mit dem Wand-Werkzeug, aus einer Raumvorlage oder durch Nachzeichnen eines ' +
            'hinterlegten Fotos, PDFs oder IFC-Modells.',
        ),
    });
    return wunsch;
  }

  const bauen = (massstab: number) =>
    geschosse.map((l) => ({
      level: l,
      plan: buildPlanSvg(doc, {
        scale: massstab,
        format,
        orientation: 'landscape',
        levelId: l.id,
        showRoomLabels: true,
        showDimensions: false,
        showFixtures: true,
        showAnnotations: false,
        showInteriorDimensions: false,
        showLegend: true,
        showOpeningDimensions: false,
        title: `${bericht.titel} — Grundriss ${l.name}`,
      }),
    }));

  let plaene = bauen(wunsch);
  let massstab = wunsch;
  if (plaene.some((x) => !x.plan.fits)) {
    // `suggestedScale` ist der kleinste Nenner, bei dem das Blatt reicht;
    // jeder größere reicht ebenfalls. Genommen wird der nächste Nenner der
    // Normreihe — 1:55 ist rechnerisch richtig und auf einem Bauplan trotzdem
    // falsch, weil ihn niemand am Maßstabsdreieck abgreifen kann.
    const noetig = Math.max(...plaene.map((x) => x.plan.suggestedScale));
    massstab = MASSSTABSREIHE.find((s) => s >= noetig) ?? noetig;
    plaene = bauen(massstab);
    hinweise.push(
      `Im Maßstab 1:${wunsch} passt nicht jedes Geschoss auf ${format} quer. Die Mappe zeichnet alle ` +
        `Grundrisse in 1:${massstab} — ein Maßstab für die ganze Mappe.`,
    );
  }

  for (const { level, plan } of plaene) {
    entwuerfe.push({
      kapitel: 'grundriss',
      titel: `Grundriss ${level.name} · M 1:${massstab}`,
      art: 'zeichnung',
      inhalt: plan.svg,
    });
  }
  kopf('grundriss', `Grundriss je Geschoss (M 1:${massstab})`, true);
  return massstab;
}

// ---------------------------------------------------------------------------
// Kapitel 4 — Anlagenschema
// ---------------------------------------------------------------------------

/**
 * Das Anlagenschema, wie es im Modell steht.
 *
 * Bewusst **nicht** aus der Auslegung neu erzeugt: die Mappe druckt die
 * Anlage, die jemand angesehen und gegebenenfalls von Hand nachgezogen hat.
 * Ein Schema, das erst beim Drucken entsteht, hat niemand geprüft — und es
 * wäre eine zweite Fassung neben der im Modell.
 */
function schemaBlaetter(
  doc: BimDocument,
  format: MappeFormat,
  projektName: string,
  anlagenName: string,
  bearbeiter: string,
  datum: string,
  entwuerfe: BlattEntwurf[],
  hinweise: string[],
  kopf: (id: MappeKapitelId, titel: string, inhalt: boolean, grund?: string) => void,
): void {
  const anlage = plantOf(doc);
  const bauteile = Object.values(anlage.schematic.components);
  const leitungen = Object.values(anlage.schematic.links);

  if (!bauteile.length) {
    kopf('schema', 'Anlagenschema', false, 'Im Modell ist kein Anlagenschema erzeugt.');
    entwuerfe.push({
      kapitel: 'schema',
      titel: 'Anlagenschema — nicht erzeugt',
      art: 'text',
      inhalt:
        h2('Anlagenschema') +
        p(
          'Im Modell steht kein Fließbild. Die Mappe erzeugt an dieser Stelle keines: ein Schema, das erst beim ' +
            'Drucken entsteht, hat niemand angesehen, und es stünde neben dem, was die Anlagenansicht zeigt.',
        ) +
        kasten(
          'Das Schema entsteht im Anlagenblatt über „Schema erzeugen". Danach lässt es sich in der ' +
            'Schema-Ansicht nachziehen; die Mappe druckt genau diesen Stand.',
        ),
    });
    return;
  }

  const schema = buildSchematicSvg(bauteile, leitungen, {
    format,
    orientation: 'landscape',
    projectName: projektName,
    plantName: anlagenName,
    author: bearbeiter,
    date: datum,
    scale: 'auto',
    showLegend: true,
    colour: false,
    componentTable: false,
  });
  schema.sheets.forEach((svg, i) => {
    entwuerfe.push({
      kapitel: 'schema',
      titel: schema.sheets.length > 1 ? `Anlagenschema ${i + 1}/${schema.sheets.length}` : 'Anlagenschema',
      art: 'zeichnung',
      inhalt: svg,
    });
  });
  for (const n of schema.notes) hinweise.push(`Anlagenschema: ${n}`);
  kopf('schema', `Anlagenschema (M 1:${schema.scale})`, true);
}

// ---------------------------------------------------------------------------
// Kapitel 5 und 6 — Rohrnetzbericht und Einstellwerte
// ---------------------------------------------------------------------------

/**
 * Erkennungsmarken der Berichtsblätter.
 *
 * **Warum am Blatt abgelesen und nicht nachgerechnet.** Wie viele
 * Teilstreckenblätter entstehen, entscheidet `pipeReportPrint` aus der
 * Zeilenhöhe und der Feldhöhe. Diese Rechnung hier zu wiederholen, um die
 * Blätter benennen zu können, wäre eine zweite Fassung derselben Paginierung
 * — und sie liefe beim nächsten Millimeter Zeilenabstand auseinander, ohne
 * dass es jemandem auffiele. Stattdessen wird die Abschnittsüberschrift im
 * fertigen Blatt gesucht: sie steht dort, weil das Blatt sie für den Leser
 * trägt, und ist damit die einzige Angabe, die nicht doppelt geführt wird.
 *
 * Die Reihenfolge ist bedeutsam: das Deckblatt des Berichts trägt neben
 * „Rohrnetzberechnung" auch „Pflichtangaben", das Quellenblatt neben
 * „Hinweise" auch „Quellen".
 */
const BERICHTSMARKEN: readonly { marke: string; titel: string; kapitel: MappeKapitelId }[] = [
  { marke: '>Einstellwerte je Heizfläche<', titel: 'Einstellwerte je Heizfläche', kapitel: 'einstellwerte' },
  { marke: '>Einstellwerte (Fortsetzung)<', titel: 'Einstellwerte je Heizfläche (Fortsetzung)', kapitel: 'einstellwerte' },
  { marke: '>Teilstrecken<', titel: 'Teilstreckentabelle', kapitel: 'rohrnetz' },
  { marke: '>Teilstrecken (Fortsetzung)<', titel: 'Teilstreckentabelle (Fortsetzung)', kapitel: 'rohrnetz' },
  { marke: '>Fließwege<', titel: 'Fließwege und Schlechtpunkt', kapitel: 'rohrnetz' },
  { marke: '>Rohrnetzberechnung<', titel: 'Anlagendaten und Nachweis', kapitel: 'rohrnetz' },
  { marke: '>Hinweise<', titel: 'Hinweise und Quellen des Berichts', kapitel: 'rohrnetz' },
];

function rohrnetzBlaetter(
  doc: BimDocument,
  bericht: RohrnetzBericht,
  format: MappeFormat,
  entwuerfe: BlattEntwurf[],
  hinweise: string[],
  kopf: (id: MappeKapitelId, titel: string, inhalt: boolean, grund?: string) => void,
): void {
  // Der Grundriss ist Kapitel 3 und wird hier nicht ein zweites Mal gedruckt.
  const druck = buildPipeReportSheets(doc, bericht, {
    format,
    orientation: 'landscape',
    grundriss: false,
  });
  for (const n of druck.notes) hinweise.push(`Rohrnetzbericht: ${n}`);

  let unbenannt = 0;
  druck.sheets.forEach((svg, i) => {
    const marke = BERICHTSMARKEN.find((m) => svg.includes(m.marke));
    if (!marke) unbenannt++;
    entwuerfe.push({
      kapitel: marke?.kapitel ?? 'rohrnetz',
      titel: marke ? marke.titel : `Rohrnetzbericht ${i + 1}/${druck.sheets.length}`,
      art: 'zeichnung',
      inhalt: svg,
    });
  });
  if (unbenannt > 0) {
    hinweise.push(
      `${unbenannt} Blätter des Rohrnetzberichts tragen keine bekannte Abschnittsüberschrift und stehen im ` +
        'Inhaltsverzeichnis unter ihrer laufenden Nummer.',
    );
  }

  kopf(
    'rohrnetz',
    'Rohrnetzbericht — Anlagendaten, Teilstrecken, Fließwege',
    bericht.teilstrecken.length > 0,
    bericht.teilstrecken.length ? undefined : 'Im Modell ist kein Rohrnetz gezeichnet.',
  );
  kopf(
    'einstellwerte',
    'Einstellwerte je Heizfläche',
    bericht.heizflaechen.some((h) => h.voreinstellung !== undefined),
    bericht.heizflaechen.length
      ? bericht.heizflaechen.some((h) => h.voreinstellung !== undefined)
        ? undefined
        : 'Keine Heizfläche ließ sich einstellen — siehe die Urteilsspalte auf dem Blatt.'
      : 'Am Netz hängt keine Heizfläche.',
  );
}

// ---------------------------------------------------------------------------
// Kapitel 7 — Pumpenauslegung und Erzeugerkreis
// ---------------------------------------------------------------------------

/**
 * Förderhöhe und die Posten des Erzeugerkreises.
 *
 * **Warum dieses Blatt neu ist.** Der Rohrnetzbericht nennt die Pumpe mit
 * einer Zeile auf seinem Anlagenblatt; **woraus** ihre Förderhöhe besteht,
 * stand bisher nirgends auf Papier. Seit der Bericht das Feld `erzeuger`
 * führt, ist die Bilanz des Erzeugerkreises eine Liste von Posten mit
 * Grundlage, Herkunft und Quelle — und genau das gehört in einen Nachweis:
 * nicht die Summe, sondern ihre Herkunft.
 *
 * Der zweite Zweck ist die Unterscheidung, an der man 40 bis 70 kPa falsch
 * rechnen kann: veröffentlicht der Hersteller einen **Druckverlust**, wird er
 * addiert; veröffentlicht er eine **Restförderhöhe**, wird gar keine Pumpe
 * ausgelegt, sondern geprüft. Das Blatt sagt, welcher Fall vorliegt.
 */
function pumpenBlatt(bericht: RohrnetzBericht): string {
  const e = bericht.erzeuger;
  const pumpe = bericht.pumpe;
  const teile: string[] = [h2('Pumpenauslegung und Erzeugerkreis')];

  if (e.angabe === 'restfoerderhoehe') {
    teile.push(
      kasten(
        'Der Wärmeerzeuger bringt seine eigene Pumpe mit und veröffentlicht eine Restförderhöhe. Hier wird ' +
          'deshalb keine Pumpe ausgelegt, sondern geprüft: Rohrnetz, Armaturen und Wärmeübergabe müssen ' +
          'zusammen unter der Restförderhöhe bleiben. Den Gerätewert zusätzlich zu addieren wäre der Fehler, ' +
          'vor dem diese Unterscheidung schützt.',
      ),
    );
  } else if (e.angabe === 'keine-angabe') {
    teile.push(
      kasten(
        'Für das gewählte Gerät liegt keine hydraulische Angabe vor. Der Erzeuger fehlt damit als Posten in ' +
          'der Förderhöhe; wie groß der fehlende Betrag ungefähr ist, steht unten bei den Hinweisen. Eine Null ' +
          'an dieser Stelle ist kein Messergebnis.',
      ),
    );
  }

  if (!pumpe) {
    teile.push(
      p(
        'Es liegt keine Pumpenauslegung vor. Ohne gezeichnetes Rohrnetz gibt es keinen ungünstigsten Strang, ' +
          'und ohne ihn keine Förderhöhe — die Bilanz des Erzeugerkreises steht trotzdem unten, sie hängt nur ' +
          'am Auslegungsvolumenstrom.',
      ),
    );
  } else {
    teile.push(
      kennwerte([
        { label: 'Förderstrom', wert: `${de(pumpe.flow, 3)} m³/h`, fussnote: 'Summe über alle Stränge — durch die Pumpe fließt alles.' },
        {
          label: 'Erforderliche Förderhöhe',
          wert: `${de(pumpe.head, 2)} m (${de(pumpe.pressureKpa, 1)} kPa)`,
          fussnote: `Ungünstigster Strang ${de(pumpe.worstPathLoss / 1000, 2)} kPa, Erzeugerkreis ${de(
            pumpe.generatorLoss / 1000,
            2,
          )} kPa, Sicherheitszuschlag ${de((pumpe.safetyFactor - 1) * 100, 0)} %.`,
        },
        pumpe.availableHead !== undefined
          ? {
              label: 'Verfügbare Restförderhöhe',
              wert: `${de(pumpe.availableHead, 2)} m`,
              fussnote: 'Angabe des Geräteherstellers, nicht gerechnet.',
            }
          : undefined,
        pumpe.residualHead !== undefined
          ? {
              label: 'Reserve',
              wert: `${de(pumpe.residualHead, 2)} m — ${pumpe.sufficient ? 'ausreichend' : 'nicht ausreichend'}`,
              fussnote: pumpe.sufficient
                ? 'Verfügbar minus erforderlich; positiv heißt, die eingebaute Pumpe trägt das Netz.'
                : 'Negativ: die eingebaute Pumpe trägt das Netz nicht. Dimensionen und Armaturen prüfen.',
            }
          : undefined,
        {
          label: 'Elektrische Leistungsaufnahme',
          wert: `rund ${de(pumpe.electricPower, 0)} W`,
          fussnote: `Hydraulisch ${de(pumpe.hydraulicPower, 1)} W bei einem angesetzten Gesamtwirkungsgrad von ${de(
            pumpe.efficiency * 100,
            0,
          )} %.`,
        },
        {
          label: 'Abzudrosselnde Spreizung',
          wert: `${de(pumpe.balancingSpread / 1000, 2)} kPa`,
          fussnote: 'Abstand zwischen ungünstigstem und zweitungünstigstem Strang.',
        },
      ]),
    );
  }

  // --- Die Posten des Erzeugerkreises ---------------------------------------
  teile.push(h3('Posten im Erzeugerkreis'));
  teile.push(
    p(
      `Gerechnet für ${de(e.volumenstrom, 3)} m³/h — den Auslegungsvolumenstrom des Erzeugerkreises. Die ` +
        'Bauteilliste ist nicht geraten: das Umschaltventil steht darin, wenn ein Trinkwasserspeicher über den ' +
        'Erzeuger geladen wird, Zähler und Abscheider, wenn die Armaturenliste sie führt. Damit zeigen Bild, ' +
        'Materialliste und Rechnung dieselbe Anlage.',
    ),
  );

  if (!e.posten.length) {
    teile.push(p('Im Erzeugerkreis ist kein Posten angesetzt — es ist kein Gerät gewählt und keine Armatur vorgesehen.'));
  } else {
    teile.push(
      tabelle(
        [
          { titel: 'Posten', breite: '58mm' },
          { titel: 'Δp [kPa]', rechts: true, breite: '20mm' },
          { titel: 'Grundlage' },
          { titel: 'Herkunft', breite: '46mm' },
          { titel: 'Quelle', breite: '54mm' },
        ],
        e.posten.map((posten) => [
          escapeHtml(posten.label),
          de(posten.druck / 1000, 2),
          escapeHtml(posten.grundlage),
          escapeHtml(HERKUNFT_LABELS[posten.herkunft]),
          escapeHtml(posten.quelle),
        ]),
      ),
    );
    teile.push(
      kennwerte([
        {
          label: 'Zum Rohrnetz addiert',
          wert: `${de(e.zusatz / 1000, 2)} kPa`,
          fussnote:
            e.angabe === 'restfoerderhoehe'
              ? 'Nur die Einbauten. Der Gerätewert ist eine Obergrenze und wird nicht addiert.'
              : 'Summe aller Posten des Erzeugerkreises.',
        },
        e.verfuegbar !== undefined
          ? {
              label: 'Restförderhöhe des Geräts',
              wert: `${de(e.verfuegbar / 1000, 2)} kPa`,
              fussnote: 'Obergrenze für Rohrnetz und Armaturen zusammen.',
            }
          : undefined,
        e.hydraulik
          ? {
              label: 'Kennwert des Geräts',
              wert: `${de(e.hydraulik.wert / 1000, 2)} kPa bei ${de(e.hydraulik.bezugsvolumenstrom, 2)} m³/h`,
              fussnote:
                `Herstellerwort „${e.hydraulik.herstellerbegriff}“ · ${HERKUNFT_LABELS[e.hydraulik.herkunft]} · ` +
                `${e.hydraulik.quelle}`,
            }
          : undefined,
      ]),
    );
  }

  if (e.hinweise.length) {
    teile.push(h3('Hinweise zur Erzeugerbilanz'));
    teile.push(
      tabelle(
        [
          { titel: 'Schwere', breite: '22mm' },
          { titel: 'Hinweis' },
        ],
        e.hinweise.map((h) => [
          escapeHtml(h.severity === 'error' ? 'Fehler' : h.severity === 'warn' ? 'Warnung' : 'Hinweis'),
          escapeHtml(h.text),
        ]),
      ),
    );
  }

  return teile.join('');
}

// ---------------------------------------------------------------------------
// Kapitel 8 — Massenauszug
// ---------------------------------------------------------------------------

/**
 * Der Massenauszug als Blattfolge, ein Gewerk je Blattgruppe.
 *
 * Umbrochen wird nach einem Zeilenbudget statt nach Gefühl — dieselbe
 * Rechnung wie in `pipeReportPrint`: Feldhöhe durch Zeilenhöhe. Das ist der
 * einzige Weg, im Inhaltsverzeichnis eine Blattnummer zu nennen, die
 * hinterher stimmt.
 */
function massenauszugBlaetter(
  doc: BimDocument,
  auslegung: RohrnetzBericht['auslegung'],
  blattmass: { w: number; h: number },
  entwuerfe: BlattEntwurf[],
  kopf: (id: MappeKapitelId, titel: string, inhalt: boolean, grund?: string) => void,
): void {
  const liste = buildMaterialSchedule(doc, auslegung);
  // Eine Position trägt Bezeichnung und Herkunft übereinander; gemessen sind
  // das gut 13 mm. Abgezogen werden Überschrift, Vorspann und Tabellenkopf.
  const proBlatt = zeilenBudget(blattmass, 46, 13);

  if (!liste.items.length) {
    kopf('massenauszug', 'Massenauszug', false, 'Im Modell steht nichts, was sich in Mengen fassen ließe.');
    entwuerfe.push({
      kapitel: 'massenauszug',
      titel: 'Massenauszug — ohne Positionen',
      art: 'text',
      inhalt:
        h2('Massenauszug') +
        p(
          'Das Modell führt keine Position. Der Massenauszug zählt, was gezeichnet und ausgelegt ist — ohne ' +
            'Wände, Leitungen und Anlagenteile gibt es nichts zu zählen.',
        ),
    });
    return;
  }

  const spalten: Spalte[] = [
    { titel: 'Pos.', rechts: true, breite: '14mm' },
    { titel: 'Bezeichnung' },
    { titel: 'Technische Angabe', breite: '62mm' },
    { titel: 'Menge', rechts: true, breite: '22mm' },
    { titel: 'Einheit', breite: '18mm' },
  ];

  const zeileVon = (item: MaterialItem): string =>
    `<tr><td class="r">${item.position}</td>` +
    `<td class="l"><strong>${escapeHtml(item.name)}</strong>` +
    `<div class="fussnote">${escapeHtml(item.origin)}</div>` +
    (item.remark ? `<div class="fussnote">${escapeHtml(item.remark)}</div>` : '') +
    `</td>` +
    `<td class="l">${escapeHtml(item.spec || '—')}</td>` +
    `<td class="r">${de(item.quantity, item.unit === 'Stk' || item.unit === 'l' ? 0 : item.unit === 'kW' ? 1 : 2)}</td>` +
    `<td class="l">${escapeHtml(item.unit)}</td></tr>`;

  /**
   * Gepackt wird über die Gewerksgrenze hinweg.
   *
   * Ein Blatt je Gewerk wäre einfacher zu schreiben und im Ergebnis Papier
   * mit drei Zeilen darauf: die Gewerke sind sehr unterschiedlich groß. Die
   * Gewerksüberschrift läuft deshalb als eigene Zeile in der Tabelle mit und
   * wird beim Blattwechsel als „(Fortsetzung)" wiederholt — sonst steht auf
   * dem Folgeblatt eine Mengenkolonne ohne Gewerk.
   */
  const gewerkszeile = (label: string, zusatz: string): string =>
    `<tr class="gruppe"><td class="l" colspan="5">${escapeHtml(label)}` +
    (zusatz ? ` <span class="fussnote">· ${escapeHtml(zusatz)}</span>` : '') +
    `</td></tr>`;

  let zeilen: string[] = [];
  let belegt = 0;
  let erstes = true;
  let laufendesGewerk = '';
  const blattSetzen = (): void => {
    if (!zeilen.length) return;
    const inhalt =
      (erstes
        ? h2('Massenauszug') +
          p(
            `${liste.positionCount} Positionen aus dem Modell, nach Gewerken geordnet. Die Zeile unter der ` +
              'Bezeichnung nennt, aus welchem Teil des Modells die Menge stammt — sie ist der Grund, warum ' +
              'diese Liste prüfbar ist. Zuschläge für Verschnitt, Kleinteile und Befestigung sind nicht ' +
              'enthalten.',
          )
        : h2('Massenauszug (Fortsetzung)')) +
      `<table class="daten"><thead><tr>` +
      spalten
        .map(
          (s) =>
            `<th class="${s.rechts ? 'r' : 'l'}"${s.breite ? ` style="width:${s.breite}"` : ''}>${escapeHtml(
              s.titel,
            )}</th>`,
        )
        .join('') +
      `</tr></thead><tbody>${zeilen.join('')}</tbody></table>`;
    entwuerfe.push({
      kapitel: 'massenauszug',
      titel: erstes ? 'Massenauszug' : `Massenauszug · ${laufendesGewerk}`,
      art: 'text',
      inhalt,
    });
    zeilen = [];
    belegt = 0;
    erstes = false;
  };

  for (const gruppe of liste.groups) {
    // Eine Gewerksüberschrift allein am Blattende ist eine verwaiste Zeile.
    if (belegt > 0 && belegt + 2 > proBlatt) blattSetzen();
    laufendesGewerk = gruppe.label;
    zeilen.push(gewerkszeile(gruppe.label, gruppe.summary));
    belegt += 1;
    for (const item of gruppe.items) {
      if (belegt >= proBlatt) {
        blattSetzen();
        zeilen.push(gewerkszeile(gruppe.label, 'Fortsetzung'));
        belegt += 1;
      }
      zeilen.push(zeileVon(item));
      belegt += 1;
    }
  }
  blattSetzen();

  if (liste.notes.length) {
    entwuerfe.push({
      kapitel: 'massenauszug',
      titel: 'Massenauszug · Hinweise',
      art: 'text',
      inhalt:
        h2('Massenauszug — Hinweise') +
        tabelle(
          [
            { titel: 'Schwere', breite: '22mm' },
            { titel: 'Hinweis' },
          ],
          liste.notes.map((n) => [
            escapeHtml(n.severity === 'error' ? 'Fehler' : n.severity === 'warn' ? 'Warnung' : 'Hinweis'),
            escapeHtml(n.text),
          ]),
        ),
    });
  }

  kopf('massenauszug', `Massenauszug (${liste.positionCount} Positionen)`, true);
}

// ---------------------------------------------------------------------------
// Kapitel 9 — Anlagenbuch
// ---------------------------------------------------------------------------

/**
 * Das Anlagenbuch, Kapitel für Kapitel eingehängt.
 *
 * Sein Deckblatt wird weggelassen — die Mappe hat ihres, und zwei Deckblätter
 * in einem Heft sind zwei Aussagen darüber, was das Dokument ist. Dass das
 * Anlagenbuch diese Möglichkeit von sich aus anbietet (`omit`), ist der
 * Grund, warum hier nichts nachgebaut werden muss.
 *
 * Zerlegt wird an der Abschnittsmarke: die Kapitel liegen im Anlagenbuch
 * flach nebeneinander. Jedes wird ein eigenes Blatt der Mappe und bekommt
 * damit eine Blattnummer, die im Inhaltsverzeichnis stimmt.
 *
 * @returns das eingeschränkte Stilblatt des Anlagenbuchs
 */
function anlagenbuchBlaetter(
  doc: BimDocument,
  bericht: RohrnetzBericht,
  format: MappeFormat,
  projektName: string,
  anlagenName: string,
  bearbeiter: string,
  datum: string,
  entwuerfe: BlattEntwurf[],
  kopf: (id: MappeKapitelId, titel: string, inhalt: boolean, grund?: string) => void,
): string {
  const auszug = buildRaviaExport(doc);
  const buch = buildPlantBook({
    design: bericht.auslegung,
    projectName: projektName,
    plantName: anlagenName,
    author: bearbeiter,
    date: datum,
    address: doc.meta.address,
    client: doc.meta.client,
    rooms: auszug.rooms,
    raviaExport: auszug,
    format,
    omit: ['deckblatt'],
  });

  const stil = skopiereStil(innerHtml(buch.html, 'style'), '.anlagenbuch');
  const koerper = innerHtml(buch.html, 'body');
  // Die Kapitel liegen flach nebeneinander; verschachtelte Abschnitte gibt es
  // nicht. Der erste Teil vor der ersten Marke ist der öffnende `div.buch`.
  const stuecke = koerper.split('<section class="kapitel').slice(1);

  stuecke.forEach((stueck, i) => {
    const abschnitt = `<section class="kapitel${stueck}`;
    // Der letzte Abschnitt schleppt das schließende `</div></body>`-Ende mit.
    const ende = abschnitt.lastIndexOf('</section>');
    const rein = ende >= 0 ? abschnitt.slice(0, ende + '</section>'.length) : abschnitt;
    entwuerfe.push({
      kapitel: 'anlagenbuch',
      titel: `Anlagenbuch · ${buch.chapters[i]?.title ?? `Kapitel ${i + 1}`}`,
      art: 'text',
      inhalt: `<div class="anlagenbuch">${rein}</div>`,
    });
  });

  const leer = buch.chapters.filter((k) => !k.hasContent);
  kopf(
    'anlagenbuch',
    'Anlagenbuch — Auslegung, Grenzen, Inbetriebnahme',
    leer.length < buch.chapters.length,
    leer.length ? `${leer.length} von ${buch.chapters.length} Kapiteln ohne Angaben.` : undefined,
  );
  return stil;
}

// ---------------------------------------------------------------------------
// Kapitel 10 — Quellenverzeichnis
// ---------------------------------------------------------------------------

/**
 * Themen, deren Belege ins Quellenverzeichnis der Mappe gehören.
 *
 * Der Rohrnetzbericht zitiert fünf davon selbst; die Mappe deckt zusätzlich
 * die Themen ab, die aus Anlagenbuch, Schema und Massenauszug stammen. Eine
 * Mappe, die Zahlen aus sechs Modulen zusammenträgt, muss auch deren Belege
 * mitbringen — sonst führt sie Quellen für die Hälfte ihres Inhalts.
 */
/**
 * Belege je Thema, die auf das Blatt kommen.
 *
 * Die Wissensbasis führt zu manchen Themen zwei Dutzend Einträge; alle zu
 * drucken hieße, einer Mappe von fünfzig Blättern zwanzig Blätter
 * Literaturverzeichnis beizulegen — das liest niemand, und es verdeckt die
 * Belege, auf die es ankommt. Genommen werden die drei belastbarsten je
 * Thema; `belege` sortiert dafür bereits Primärquellen nach vorn und liefert
 * eine stabile Reihenfolge, damit zwei Ausdrucke gleich aussehen. Dieselbe
 * Entscheidung trifft `pipeReport` für sein eigenes Quellenblatt.
 */
const BELEGE_JE_THEMA = 3;

const MAPPEN_THEMEN: readonly string[] = [
  // Was der Rohrnetzbericht selbst zitiert
  'dokumentation',
  'abgleich-recht',
  'abgleich-verfahren',
  'ventilautoritaet',
  'voreinstellung',
  'druckverlust',
  'rohrdaemmung',
  // Was aus Teilstreckentabelle und Pumpenblatt dazukommt
  'rohrdimension',
  'rohrreibung',
  'einzelwiderstand',
  'druckgefaelle',
  'geschwindigkeit',
  'rauigkeit',
  'stoffwerte',
  'pumpe',
  'ueberstroemventil',
  'waermemengenzaehler',
  // Was aus Anlagenbuch, Schema und Massenauszug dazukommt
  'waermepumpe',
  'puffer',
  'mischer',
  'heizkoerper',
  'fussbodenheizung',
  'trinkwasser',
  'sicherheit',
  'ausdehnungsgefaess',
  'wasserqualitaet',
  'schemafehler',
  // Und die Annahmen, die dieses Programm selbst gesetzt hat
  'programmannahme',
];

function quellenBlaetter(
  bericht: RohrnetzBericht,
  blattmass: { w: number; h: number },
  entwuerfe: BlattEntwurf[],
  kopf: (id: MappeKapitelId, titel: string, inhalt: boolean, grund?: string) => void,
): void {
  const basis = wissensbasis();

  // Belege der Wissensbasis, ohne Doppelung und in stabiler Reihenfolge.
  const belege = new Map<string, WissensEintrag>();
  for (const thema of MAPPEN_THEMEN) {
    for (const e of basis.belege(thema).slice(0, BELEGE_JE_THEMA)) if (!belege.has(e.id)) belege.set(e.id, e);
  }
  // Was der Rohrnetzbericht zitiert, gehört auch dann ins Verzeichnis, wenn
  // es über kein Thema dieser Liste hereinkam — sonst führte die Mappe eine
  // Quelle, die auf einem ihrer eigenen Blätter steht, nicht auf.
  const ohneThema = bericht.quellen.filter(
    (q) => ![...belege.values()].some((e) => e.titel === q.titel),
  );
  // Was der Bericht bereits zitiert, steht schon in seinen eigenen Blättern —
  // hier wird es zusammengeführt, damit ein Titel nicht zweimal erscheint.
  const berichtsTitel = new Set(bericht.quellen.map((q) => q.titel));
  const eintraege = [...belege.values()].sort((a, b) => a.titel.localeCompare(b.titel, 'de'));

  const spalten: Spalte[] = [
    { titel: 'Titel', breite: '70mm' },
    { titel: 'Quelle' },
    { titel: 'Belastbarkeit', breite: '46mm' },
    { titel: 'Sammlung', breite: '38mm' },
  ];
  const zeilen = [
    ...eintraege.map((e) => [
      `<strong>${escapeHtml(e.titel)}</strong>` +
        (berichtsTitel.has(e.titel) ? '<div class="fussnote">auch im Rohrnetzbericht zitiert</div>' : '') +
        (e.url ? `<div class="fussnote">${escapeHtml(e.url)}</div>` : ''),
      escapeHtml(e.quelle),
      escapeHtml(BELASTBARKEIT_LABELS[e.belastbarkeit]),
      escapeHtml(KORPUS_LABELS[e.korpus]),
    ]),
    ...ohneThema.map((q) => [
      `<strong>${escapeHtml(q.titel)}</strong>` +
        '<div class="fussnote">im Rohrnetzbericht zitiert</div>' +
        (q.url ? `<div class="fussnote">${escapeHtml(q.url)}</div>` : ''),
      escapeHtml(q.quelle),
      '—',
      '—',
    ]),
  ];

  // Ein Eintrag trägt Titel, Fußnote und meist einen Verweis — rund 17 mm.
  const proBlatt = zeilenBudget(blattmass, 60, 17);

  const umfang = basis
    .korpora()
    .map((k: KorpusId) => `${KORPUS_LABELS[k]}: ${basis.umfang(k)}`)
    .join(' · ');

  for (let i = 0; i < Math.max(1, zeilen.length); i += proBlatt) {
    const teil = zeilen.slice(i, i + proBlatt);
    const inhalt =
      (i === 0
        ? h2('Quellenverzeichnis') +
          p(
            'Jede Zahl dieser Mappe kommt aus einem der folgenden Belege oder aus dem Modell selbst. Die Spalte ' +
              '„Belastbarkeit" ist der Kern des Verzeichnisses: eine Primärquelle wurde im Volltext nachgelesen, ' +
              'eine Sekundärquelle aus Fachliteratur übernommen, und eine Annahme hat dieses Programm gesetzt, ' +
              'weil eine Zahl gebraucht wurde. Wer den Unterschied verwischt, verkauft eine Annahme als Norm.',
          ) +
          p(`Die Wissensbasis führt ${basis.umfang()} Einträge in getrennten Sammlungen — ${umfang}.`)
        : h2('Quellenverzeichnis (Fortsetzung)')) +
      (teil.length ? tabelle(spalten, teil) : p('Zu den Themen dieser Mappe ist kein Beleg hinterlegt.'));
    entwuerfe.push({
      kapitel: 'quellen',
      titel: i === 0 ? 'Quellenverzeichnis' : 'Quellenverzeichnis (Fortsetzung)',
      art: 'text',
      inhalt,
    });
  }

  kopf(
    'quellen',
    `Quellenverzeichnis (${zeilen.length} Belege)`,
    zeilen.length > 0,
    zeilen.length ? undefined : 'Kein Beleg zu den Themen dieser Mappe.',
  );
}

// ---------------------------------------------------------------------------
// Kapitel 11 — Nachweiskatalog
// ---------------------------------------------------------------------------

/**
 * Die sieben Pflichtangaben nach § 60c Abs. 4 GModG.
 *
 * Sie stehen bereits auf dem Anlagenblatt des Rohrnetzberichts — dort in
 * einer Spalte, hier als eigenes Blatt mit der Aussage, die eine Übergabe
 * braucht: **liegt vor** oder **fehlt, weil …**. Die Punkte werden nicht neu
 * bewertet; sie kommen unverändert aus `nachweisPunkte` im Bericht. Eine
 * zweite Bewertung derselben Forderung wäre eine zweite Wahrheit.
 */
function nachweisBlatt(bericht: RohrnetzBericht): string {
  const offen = bericht.nachweis.filter((n) => !n.erfuellt);
  const urteil = berichtsUrteil(bericht);

  return (
    h2('Nachweiskatalog nach § 60c Abs. 4 GModG (vormals GEG)') +
    p(
      'Der Wortlaut ist kein Vorschlag: „Die Einstellungswerte, die Heizlast des Gebäudes, die eingestellte ' +
        'Leistung der Wärmeerzeuger, die raumweise Heizlastberechnung, die Auslegungstemperatur, die Einstellung ' +
        'der Regelung und der Druck im Ausdehnungsgefäß sind dem Verantwortlichen schriftlich mitzuteilen." ' +
        'Diese Mappe führt die sieben Angaben einzeln auf und sagt bei jeder, ob sie sie liefern kann.',
    ) +
    kasten(
      urteil.nachweisfaehig
        ? 'Alle sieben Angaben liegen vor. Damit ist die Mappe vollständig im Sinne der Vorschrift — ob die ' +
            'Zahlen richtig sind, prüft sie damit nicht.'
        : `${offen.length} von 7 Angaben fehlen. Offen: ${urteil.offen.join('; ')}. Solange eine Angabe fehlt, ` +
            'ist diese Mappe eine Vorbemessung und kein Nachweis.',
    ) +
    tabelle(
      [
        { titel: 'Nr.', rechts: true, breite: '12mm' },
        { titel: 'Forderung', breite: '58mm' },
        { titel: 'Zustand', breite: '26mm' },
        { titel: 'Angabe' },
        { titel: 'Herkunft', breite: '58mm' },
      ],
      bericht.nachweis.map((n) => [
        String(n.nr),
        `<strong>${escapeHtml(n.forderung)}</strong>`,
        n.erfuellt ? '<strong>liegt vor</strong>' : '<strong>fehlt, weil …</strong>',
        escapeHtml(n.antwort),
        escapeHtml(n.herkunft),
      ]),
    )
  );
}

// ---------------------------------------------------------------------------
// Blatt 1 — Deckblatt
// ---------------------------------------------------------------------------

interface DeckblattDaten {
  projektName: string;
  adresse?: string;
  bauherr?: string;
  anlagenName: string;
  bearbeiter: string;
  programmstand: string;
  datum: string;
  format: MappeFormat;
  planMassstab: number;
  blattzahl: number;
  urteil: { nachweisfaehig: boolean; offen: string[] };
}

/**
 * Das Deckblatt trägt vier Zahlen und einen Vorbehalt.
 *
 * Vier Zahlen, weil das die Angaben sind, nach denen in einem Gespräch über
 * die Anlage als Erstes gefragt wird. Der Vorbehalt steht **vorn** und nicht
 * im Kleingedruckten: wer ein Dokument weitergibt, muss dessen Grenzen
 * mitgeben, sonst hält der Empfänger eine Vordimensionierung für einen
 * Nachweis. Formuliert wird er fallabhängig aus dem, was der Bericht selbst
 * über sich sagt — ein pauschaler Haftungstext wäre wieder nur eine Formel,
 * die niemand liest.
 */
function deckblatt(bericht: RohrnetzBericht, d: DeckblattDaten): string {
  const a = bericht.auslegung;
  const pumpe = bericht.pumpe;

  const kachel = (schluessel: string, wert: string, notiz: string): string =>
    `<div class="zahl"><div class="k">${escapeHtml(schluessel)}</div>` +
    `<div class="v">${escapeHtml(wert)}</div><div class="z">${escapeHtml(notiz)}</div></div>`;

  const foerderhoehe = pumpe
    ? pumpe.availableHead !== undefined
      ? `${de(pumpe.head, 2)} m von ${de(pumpe.availableHead, 2)} m`
      : `${de(pumpe.head, 2)} m`
    : 'nicht ausgelegt';
  const foerderNotiz = !pumpe
    ? 'Ohne gezeichnetes Rohrnetz gibt es keinen ungünstigsten Strang'
    : bericht.erzeuger.angabe === 'restfoerderhoehe'
      ? `Gegen die Restförderhöhe des Geräts geprüft — ${pumpe.sufficient ? 'ausreichend' : 'nicht ausreichend'}`
      : `Erforderlich am Schlechtpunkt · ${de(pumpe.pressureKpa, 1)} kPa`;

  const herkunftText =
    a.heatLoadProvenance === 'raumweise'
      ? 'Summe der raumweise gerechneten Heizlasten'
      : a.heatLoadProvenance === 'vorgabe'
        ? 'als Norm-Heizlast übergeben, nicht nachgerechnet'
        : 'Überschlag dieses Programms — kein Nachweis nach DIN EN 12831-1';

  const vorbehalt: string[] = [];
  vorbehalt.push(
    'Diese Mappe fasst zusammen, was dieses Programm aus dem Modell gerechnet und gezeichnet hat: Grundriss, ' +
      'Anlagenschema, Rohrnetz, Einstellwerte, Mengen und Auslegung — in einem Dokument mit durchlaufender ' +
      'Blattnummer.',
  );
  if (a.heatLoadProvenance === 'überschlag') {
    vorbehalt.push(
      'Die Heizlast ist ein Überschlag aus Geometrie, U-Werten und Mindestluftwechsel. § 60c Abs. 2 GModG ' +
        'verlangt für den hydraulischen Abgleich eine raumweise Heizlastberechnung nach DIN EN 12831-1. Mit ' +
        'dieser Zahl ist die Mappe eine Vorbemessung und kein Nachweis.',
    );
  }
  vorbehalt.push(
    d.urteil.nachweisfaehig
      ? 'Alle sieben Pflichtangaben nach § 60c Abs. 4 GModG liegen vor; der Nachweiskatalog am Ende der Mappe ' +
          'führt sie einzeln auf.'
      : `Nicht nachweisfähig. Offen: ${d.urteil.offen.join('; ')}. Der Nachweiskatalog am Ende der Mappe sagt bei ` +
          'jeder Angabe, warum sie fehlt.',
  );
  vorbehalt.push(
    'Was die Mappe nicht ist: Ausführungsplanung, Elektro-, Statik- oder Kälteplanung, Genehmigungsunterlage ' +
      'und Abnahme. Das Anlagenschema ist ein Prinzipschema. Abweichungen auf der Baustelle sind hier ' +
      'nachzutragen; ohne Nachtrag beschreibt die Mappe die Anlage nicht mehr.',
  );

  return (
    `<div class="deckblatt">` +
    `<div class="marke">Projektmappe</div>` +
    `<h1>${escapeHtml(d.projektName)}</h1>` +
    `<p class="anlage">${escapeHtml(d.anlagenName)}</p>` +
    `<hr>` +
    kennwerte([
      // Anschrift und Bauherr stehen nur dann da, wenn sie im Modell stehen.
      // Eine Zeile „Bauvorhaben: —" auf einem Deckblatt sieht aus wie ein
      // vergessenes Feld; eine fehlende Zeile fällt niemandem auf.
      d.adresse ? { label: 'Bauvorhaben', wert: d.adresse } : undefined,
      d.bauherr ? { label: 'Bauherr', wert: d.bauherr } : undefined,
      { label: 'Erstellt von', wert: d.bearbeiter },
      { label: 'Programmstand', wert: d.programmstand },
      { label: 'Datum', wert: d.datum },
      {
        label: 'Umfang',
        wert: `${d.blattzahl} Blätter · ${d.format} quer · Grundrisse M 1:${d.planMassstab}`,
        fussnote:
          'Blätter, nicht Druckseiten: ein Zeichnungsblatt belegt genau eine Seite, ein Textkapitel darf auf ' +
          'eine Folgeseite überlaufen.',
      },
    ]) +
    `<div class="zahlen">` +
    kachel('Heizlast', `${de(a.heatLoad, 1)} kW`, herkunftText) +
    kachel(
      'Wärmeerzeuger',
      a.selected ? a.selected.model.label : 'nicht gewählt',
      a.selected
        ? `${de(a.selected.capacityAtDesign, 1)} kW im Auslegungspunkt · ${a.selected.model.series}`
        : 'Kein Gerät aus dem Katalog übernommen',
    ) +
    kachel(
      'Volumenstrom',
      `${de(bericht.volumenstrom, 3)} m³/h`,
      `${de(bericht.temperaturen.vorlauf, 0)}/${de(bericht.temperaturen.ruecklauf, 0)} °C · Spreizung ${de(
        bericht.temperaturen.spreizung,
        1,
      )} K · ${PIPE_MATERIAL_LABELS[bericht.werkstoff]}`,
    ) +
    kachel('Förderhöhe', foerderhoehe, foerderNotiz) +
    `</div>` +
    `<h3>Was diese Mappe ist und was nicht</h3>` +
    vorbehalt.map((t) => p(t)).join('') +
    `</div>`
  );
}

// ---------------------------------------------------------------------------
// Blatt 2 — Inhaltsverzeichnis
// ---------------------------------------------------------------------------

function inhaltsverzeichnis(kapitel: readonly MappeKapitel[], blattzahl: number, hinweise: readonly string[]): string {
  const zeilen = kapitel.map((k) => [
    String(k.nummer),
    `<strong>${escapeHtml(k.titel)}</strong>` +
      (k.inhalt ? '' : `<div class="fussnote">ohne Angaben — ${escapeHtml(k.grund ?? '')}</div>`),
    escapeHtml(k.blattBereich),
    String(k.blaetter.length),
  ]);

  return (
    h2('Inhaltsverzeichnis') +
    p(
      `Die Mappe hat ${blattzahl} Blätter. Ein Kapitel ohne Angaben bleibt stehen und nennt den Grund — eine ` +
        'weggelassene Nummer sieht aus wie ein verlorenes Blatt, und genau danach wird bei einer Übergabe ' +
        'gefragt.',
    ) +
    tabelle(
      [
        { titel: 'Nr.', rechts: true, breite: '12mm' },
        { titel: 'Kapitel' },
        { titel: 'Blatt', breite: '34mm' },
        { titel: 'Anzahl', rechts: true, breite: '20mm' },
      ],
      zeilen,
    ) +
    (hinweise.length
      ? h3('Anmerkungen zum Satz dieser Mappe') +
        `<ul>${hinweise.map((h) => `<li>${escapeHtml(h)}</li>`).join('')}</ul>`
      : '')
  );
}

// ---------------------------------------------------------------------------
// Stilblatt
// ---------------------------------------------------------------------------

/**
 * Der Stil der Mappe.
 *
 * `@page` steht ohne Rand: die Zeichnungsblätter sind maßhaltige SVGs in
 * Millimetern und füllen das Blatt vollständig — ein Seitenrand würde sie
 * verkleinern und damit den Maßstab zerstören. Den Rand der Textblätter
 * trägt deshalb das Blatt selbst als Innenabstand.
 *
 * Der Heftrand links ist die Zone, die auf jedem Blatt dieses Programms frei
 * ist: `planPrint`, `pipeReportPrint` und `schematicPrint` beginnen ihren
 * Inhalt übereinstimmend bei 12 mm. Dort und nur dort darf die Mappe ihre
 * durchlaufende Blattnummer über eine fremde Zeichnung legen, ohne etwas zu
 * verdecken. Gesetzt wird sie senkrecht — quer gelesen bräuchte sie Platz,
 * den die Zeichnungen nicht hergeben.
 */
function stilblatt(blatt: { w: number; h: number }): string {
  return [
    // Die Grundseite trägt keinen Rand: die Zeichnungsblätter sind maßhaltige
    // SVGs und füllen sie vollständig.
    `@page{size:${blatt.w}mm ${blatt.h}mm;margin:0}`,
    /*
     * Die Textseite trägt ihn.
     *
     * Der Umweg über eine **benannte Druckseite** ist der einzige, der auch
     * auf der zweiten Seite eines langen Kapitels wirkt: ein Innenabstand am
     * Element gilt nur für dessen erstes und letztes Bruchstück, und ein
     * Anlagenbuchkapitel läuft regelmäßig über zwei Seiten. Ohne diese Regel
     * stünde die Fortsetzung bis an die Blattkante, also im nicht bedruckbaren
     * Bereich jedes Druckers.
     *
     * Kennt der Browser benannte Druckseiten nicht, greift die Rückfallebene
     * darunter: derselbe Abstand als Innenabstand des Blatts — richtig auf der
     * ersten Seite, knapp auf der Fortsetzung. Die Abfrage `@supports (page: …)`
     * hält beide auseinander, damit sich die Abstände nicht addieren.
     */
    `@page mappenblatt{margin:${RAND.oben}mm ${RAND.rechts}mm ${RAND.unten}mm ${RAND.links}mm}`,
    'html,body{margin:0;padding:0;background:#fff;color:#0F172A}',
    'body{font-family:"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;font-size:9pt;line-height:1.45}',
    `.blatt{position:relative;box-sizing:border-box;break-after:page;page-break-after:always}`,
    // Das Zeichnungsblatt ist genau eine Seite groß — eine Rundung nach oben
    // löste eine leere Folgeseite aus, deshalb feste Maße statt Mindestmaße.
    `.blatt.zeichnung{width:${blatt.w}mm;height:${blatt.h}mm;overflow:hidden}`,
    '.blatt:last-child{break-after:auto;page-break-after:auto}',
    '.blatt.zeichnung .feld{position:absolute;inset:0}',
    '.blatt.zeichnung svg{display:block;width:100%;height:100%}',
    `.blatt.text{width:${blatt.w}mm;padding:${RAND.oben}mm ${RAND.rechts}mm ${RAND.unten}mm ${RAND.links}mm}`,
    '@supports (page: mappenblatt){.blatt.text{page:mappenblatt;width:auto;padding:0}}',
    // Kopfzeile des Textblatts — dieselbe Bauform wie im Anlagenbuch.
    '.blattkopf{display:flex;justify-content:space-between;gap:8mm;border-bottom:.4pt solid #94A3B8;',
    'padding-bottom:1.5mm;margin-bottom:5mm;font-size:7.5pt;color:#475569}',
    // Das eingebettete Anlagenbuch bringt seinen eigenen Kapitelkopf mit. Er
    // sagt dasselbe wie die Kopfzeile der Mappe, kennt aber die Blattnummer
    // nicht — zwei Kopfzeilen übereinander sind eine zu viel.
    '.blatt .anlagenbuch .blattkopf{display:none}',
    // Heftrand: senkrecht laufende Blattkennung am linken Blattrand.
    `.heftrand{position:absolute;left:0;top:0;width:${HEFTRAND}mm;height:${blatt.h}mm;`,
    // Über der Zeichnung, nicht darunter: `.feld` ist auf Zeichnungsblättern
    // ebenfalls positioniert und läge sonst darüber.
    'display:flex;align-items:center;justify-content:center;overflow:hidden;pointer-events:none;z-index:2}',
    '.heftrand span{writing-mode:vertical-rl;transform:rotate(180deg);white-space:nowrap;',
    'font-size:6.5pt;letter-spacing:.04em;color:#64748B}',
    // Fließtext
    'h1{font-size:20pt;line-height:1.2;margin:0 0 2mm;font-weight:600}',
    'h2{font-size:13pt;margin:0 0 3mm;font-weight:600}',
    'h3{font-size:10pt;margin:5mm 0 2mm;font-weight:600}',
    'p{margin:0 0 2.5mm;orphans:2;widows:2;max-width:230mm}',
    'p.hinweiskasten{border-left:2pt solid #64748B;padding:1.5mm 0 1.5mm 3mm;margin:3mm 0;color:#334155}',
    'ul{margin:0 0 3mm;padding-left:5mm}li{margin:0 0 1.2mm;max-width:230mm}',
    // Tabellen
    'table{border-collapse:collapse;width:100%;margin:0 0 4mm;font-size:8pt;font-variant-numeric:tabular-nums}',
    'thead{display:table-header-group}',
    'tr,td,th{break-inside:avoid;page-break-inside:avoid}',
    'th,td{padding:1mm 2mm;border-bottom:.3pt solid #CBD5E1;vertical-align:top}',
    'thead th{border-bottom:.7pt solid #334155;font-weight:600;text-align:left;white-space:nowrap}',
    'td.r,th.r{text-align:right}td.l,th.l{text-align:left}',
    'table.kennwerte th{width:52mm;font-weight:600}',
    'table.kennwerte{font-size:9pt;max-width:210mm}',
    'tr.gruppe td{font-weight:600;background:#F1F5F9;border-bottom:.5pt solid #94A3B8}',
    '.fussnote{font-size:7.5pt;color:#475569;margin-top:.4mm}',
    // Deckblatt
    '.deckblatt{padding-top:0}',
    '.deckblatt .marke{font-size:8pt;letter-spacing:.18em;text-transform:uppercase;color:#64748B;margin-bottom:5mm}',
    '.deckblatt .anlage{font-size:12pt;color:#334155;margin:0 0 4mm}',
    '.deckblatt hr{border:none;border-top:.8pt solid #334155;margin:0 0 4mm}',
    '.zahlen{display:flex;gap:5mm;margin:4mm 0 5mm;flex-wrap:wrap}',
    '.zahl{flex:1 1 52mm;border:.5pt solid #94A3B8;padding:3mm 3.5mm}',
    '.zahl .k{font-size:7.5pt;text-transform:uppercase;letter-spacing:.1em;color:#64748B}',
    '.zahl .v{font-size:13pt;font-weight:600;margin-top:1.2mm;line-height:1.15}',
    '.deckblatt h3{margin-top:2mm}',
    '.zahl .z{font-size:7.5pt;color:#475569;margin-top:1mm}',
    // Bildschirmvorschau: die Blätter als weiße Karten auf dunklem Grund —
    // dasselbe Bild wie in den Einzelfenstern dieses Programms.
    // Bildschirmvorschau: die Blätter als weiße Karten auf dunklem Grund —
    // dasselbe Bild wie in den Einzelfenstern dieses Programms. Die Ränder der
    // Textblätter kommen beim Druck aus der benannten Druckseite; am Bildschirm
    // gibt es keine, deshalb hier ausdrücklich.
    '@media screen{body{background:#334155;padding:8mm 0}',
    '.blatt{margin:0 auto 8mm;background:#fff;box-shadow:0 8px 40px rgba(0,0,0,.45)}',
    `.blatt.text{width:${blatt.w}mm;padding:${RAND.oben}mm ${RAND.rechts}mm ${RAND.unten}mm ${RAND.links}mm}}`,
  ].join('');
}

// ---------------------------------------------------------------------------
// Druck
// ---------------------------------------------------------------------------

/**
 * Öffnet die Projektmappe in einem Druckfenster.
 *
 * Dieselbe Bequemlichkeitsfunktion wie `printPlantBook` und `printPlan`, und
 * die einzige Stelle dieses Moduls, die `window` anfasst — sie steht bewusst
 * am Ende, damit der Rest der Datei ohne Browser läuft und im Prüfblock
 * geprüft werden kann.
 *
 * Rückgabe `false` heißt: der Browser hat das Fenster blockiert. Die
 * Oberfläche muss das anzeigen, sonst passiert für den Nutzer scheinbar
 * nichts.
 */
export function printProjektMappe(html: string, titel = 'Projektmappe'): boolean {
  /*
   * Der Fenstertitel wird von `druckeDokument` als **Eigenschaft** gesetzt und
   * nicht mehr über ein eingebettetes Skript ins Dokument geschrieben. Damit
   * entfällt die doppelte Entschärfung des Projektnamens (`</script>` im Titel,
   * `$&` im Ersatztext) — und vor allem läuft der Druck auch unter der
   * Inhaltsrichtlinie `script-src 'self'`, die der Server ausliefert. Ein
   * eingebettetes Skript würde dort verworfen, und der Druckdialog ginge
   * stillschweigend nicht auf.
   */
  return druckeDokument(html, titel);
}
