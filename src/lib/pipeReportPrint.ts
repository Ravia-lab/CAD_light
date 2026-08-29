/**
 * Rohrnetzbericht als Blattfolge — Grundriss, Teilstrecken, Einstellwerte.
 * ---------------------------------------------------------------------------
 * Das Ergebnis ist ein Stapel A4-Blätter im SVG-Format. Der Weg ins PDF führt
 * über den **Druckdialog des Browsers**, nicht über eine PDF-Bibliothek —
 * dieselbe Entscheidung wie in `planPrint.ts` und aus demselben Grund: der
 * Druckdialog liefert Vektor-PDF in Originalqualität, kennt die Papierformate
 * des Anwenders und kostet kein einziges Kilobyte im Paket. Eine eingebettete
 * PDF-Bibliothek würde die Einzeldatei um ein Vielfaches aufblähen und dabei
 * schlechtere Schrift setzen.
 *
 * Die Reihenfolge der Blätter folgt dem, was ein Monteur nacheinander
 * braucht:
 *
 *   1. **Grundriss mit Rohrnetz** — wo liegt was.
 *   2. **Anlagendaten und Nachweis** — die sieben Pflichtangaben nach
 *      § 60c Abs. 4 GModG, jede mit Antwort oder offener Lücke.
 *   3. **Teilstreckentabelle** — die Rechnung, Zeile für Zeile nachvollziehbar
 *      (SAENA Abschn. 1.4.2.2: Durchfluss, Geschwindigkeit, Werkstoff,
 *      Innendurchmesser, Länge, R, Σζ, Z, Δp).
 *   4. **Strangübersicht** mit Kennzeichnung des Schlechtpunkts.
 *   5. **Einstellwerte je Heizfläche** — das Blatt, das mit an die Anlage geht.
 *   6. **Quellen und Hinweise** — damit jede Zahl rückverfolgbar bleibt.
 *
 * Warum Tabellen als SVG und nicht als HTML: das Blatt muss maßhaltig sein.
 * Ein HTML-Ausdruck bricht je nach Browser, Zoomstufe und Druckertreiber
 * anders um; ein SVG in Millimetern kommt überall gleich heraus. Der Preis
 * ist, dass Spaltenbreiten von Hand gerechnet werden — das ist der Grund für
 * `SPALTEN` weiter unten.
 */

import type { BimDocument } from '../types/bim';
import type { RohrnetzBericht, TeilstreckenZeile } from './pipeReport';
import { berichtsUrteil } from './pipeReport';
import { buildPlanSvg, type PaperFormat, type PaperOrientation } from './planPrint';
import { PIPE_MATERIAL_LABELS } from '../types/bim';

const PAPER: Record<PaperFormat, { w: number; h: number }> = {
  A4: { w: 210, h: 297 },
  A3: { w: 297, h: 420 },
};

/** Rand des Textfelds [mm]; unten Platz für den Schriftkopf. */
const RAND = { top: 14, right: 12, bottom: 20, left: 12 };

const FONT = 2.6;
const FONT_KLEIN = 2.1;
const FONT_TITEL = 5.0;
const FONT_ABSCHNITT = 3.4;
const ZEILE = 3.9;

const TINTE = '#0F172A';
const GRAU = '#475569';
const BLASS = '#94A3B8';
const LINIE = '#CBD5E1';

const n = (v: number): string => (Math.round(v * 100) / 100).toString();

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Deutsche Zahlschreibweise. */
function de(v: number, d = 1): string {
  if (!Number.isFinite(v)) return '—';
  return v.toFixed(d).replace('.', ',');
}

/**
 * Breite eines Textes [mm] — geschätzt.
 *
 * Ohne Textmetrik im Kern bleibt nur die Schätzung über die mittlere
 * Zeichenbreite. 0,54 em ist für eine schmale serifenlose Schrift der Wert,
 * der bei deutschen Fachtexten am besten trifft; er wird nur zum Kürzen
 * gebraucht, nicht zum Setzen.
 */
function textBreite(text: string, size: number): number {
  return text.length * size * 0.54;
}

/** Text auf eine Spaltenbreite kürzen. */
function kuerze(text: string, breite: number, size: number): string {
  if (textBreite(text, size) <= breite) return text;
  const max = Math.max(1, Math.floor(breite / (size * 0.54)) - 1);
  return `${text.slice(0, max)}…`;
}

interface Spalte {
  titel: string;
  /** Breite [mm]. */
  breite: number;
  /** Rechtsbündig — für alles, was gerechnet wurde. */
  rechts?: boolean;
}

// ---------------------------------------------------------------------------
// Blattgerüst
// ---------------------------------------------------------------------------

interface Blattmasse {
  sheet: { w: number; h: number };
  feld: { x: number; y: number; w: number; h: number };
}

function masse(format: PaperFormat, ausrichtung: PaperOrientation): Blattmasse {
  const p = PAPER[format];
  const sheet = ausrichtung === 'landscape' ? { w: p.h, h: p.w } : { w: p.w, h: p.h };
  return {
    sheet,
    feld: {
      x: RAND.left,
      y: RAND.top,
      w: sheet.w - RAND.left - RAND.right,
      h: sheet.h - RAND.top - RAND.bottom,
    },
  };
}

function blatt(m: Blattmasse, inhalt: string, kopf: string, fuss: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${m.sheet.w}mm" height="${m.sheet.h}mm" ` +
    `viewBox="0 0 ${m.sheet.w} ${m.sheet.h}">` +
    `<rect width="${m.sheet.w}" height="${m.sheet.h}" fill="#FFFFFF"/>` +
    `<text x="${n(m.feld.x)}" y="${n(RAND.top - 5)}" font-size="${n(FONT_KLEIN)}" fill="${BLASS}" ` +
    `font-family="Inter, Segoe UI, Arial, sans-serif">${escapeXml(kopf)}</text>` +
    `<line x1="${n(m.feld.x)}" y1="${n(RAND.top - 3)}" x2="${n(m.feld.x + m.feld.w)}" y2="${n(RAND.top - 3)}" ` +
    `stroke="${LINIE}" stroke-width="0.25"/>` +
    `<g font-family="Inter, Segoe UI, Arial, sans-serif">${inhalt}</g>` +
    `<line x1="${n(m.feld.x)}" y1="${n(m.sheet.h - RAND.bottom + 4)}" x2="${n(m.feld.x + m.feld.w)}" ` +
    `y2="${n(m.sheet.h - RAND.bottom + 4)}" stroke="${LINIE}" stroke-width="0.25"/>` +
    `<text x="${n(m.feld.x)}" y="${n(m.sheet.h - RAND.bottom + 9)}" font-size="${n(FONT_KLEIN)}" fill="${BLASS}" ` +
    `font-family="Inter, Segoe UI, Arial, sans-serif">${escapeXml(fuss)}</text>` +
    `</svg>`
  );
}

/** Eine Textzeile setzen. */
function zeile(
  x: number,
  y: number,
  text: string,
  opt: { size?: number; fill?: string; bold?: boolean; rechts?: boolean } = {},
): string {
  const size = opt.size ?? FONT;
  return (
    `<text x="${n(x)}" y="${n(y)}" font-size="${n(size)}" fill="${opt.fill ?? TINTE}"` +
    (opt.bold ? ' font-weight="600"' : '') +
    (opt.rechts ? ' text-anchor="end"' : '') +
    `>${escapeXml(text)}</text>`
  );
}

/**
 * Fließtext umbrechen.
 *
 * Notwendig, weil SVG nicht umbricht. Der Umbruch erfolgt an Leerzeichen und
 * gibt die Zeilen zurück, statt sie zu setzen — so kann der Aufrufer vorher
 * prüfen, ob der Absatz noch aufs Blatt passt.
 */
function umbrich(text: string, breite: number, size: number): string[] {
  const worte = text.split(/\s+/).filter(Boolean);
  const zeilen: string[] = [];
  let aktuell = '';
  for (const w of worte) {
    const probe = aktuell ? `${aktuell} ${w}` : w;
    if (textBreite(probe, size) > breite && aktuell) {
      zeilen.push(aktuell);
      aktuell = w;
    } else {
      aktuell = probe;
    }
  }
  if (aktuell) zeilen.push(aktuell);
  return zeilen;
}

/** Kopfzeile einer Tabelle. */
function tabellenkopf(spalten: readonly Spalte[], x: number, y: number): string {
  const teile: string[] = [];
  let cx = x;
  for (const s of spalten) {
    teile.push(
      zeile(s.rechts ? cx + s.breite - 0.6 : cx, y, kuerze(s.titel, s.breite, FONT_KLEIN), {
        size: FONT_KLEIN,
        fill: GRAU,
        bold: true,
        rechts: s.rechts,
      }),
    );
    cx += s.breite;
  }
  teile.push(
    `<line x1="${n(x)}" y1="${n(y + 1.1)}" x2="${n(cx)}" y2="${n(y + 1.1)}" stroke="${GRAU}" stroke-width="0.25"/>`,
  );
  return teile.join('');
}

/** Datenzeile einer Tabelle. */
function tabellenzeile(
  spalten: readonly Spalte[],
  werte: readonly string[],
  x: number,
  y: number,
  betont = false,
): string {
  const teile: string[] = [];
  let cx = x;
  spalten.forEach((s, i) => {
    teile.push(
      zeile(s.rechts ? cx + s.breite - 0.6 : cx, y, kuerze(werte[i] ?? '', s.breite, FONT_KLEIN), {
        size: FONT_KLEIN,
        rechts: s.rechts,
        bold: betont,
      }),
    );
    cx += s.breite;
  });
  return teile.join('');
}

// ---------------------------------------------------------------------------
// Spaltenbilder
// ---------------------------------------------------------------------------

/**
 * Die Teilstreckentabelle nach SAENA Abschn. 1.4.2.2.
 *
 * Die Spaltenbreiten sind auf A4 quer gerechnet: 273 mm Textfeld. Hochkant
 * passt die Tabelle nicht — sie führt fünfzehn Größen, und jede davon ist
 * gefordert. Deshalb ist Querformat für dieses Blatt kein Geschmack, sondern
 * die Bedingung, unter der es überhaupt lesbar wird.
 */
const SPALTEN_TEILSTRECKE: Spalte[] = [
  { titel: 'TS', breite: 8 },
  { titel: 'Strang / Abschnitt', breite: 44 },
  { titel: 'V̇ [m³/h]', breite: 17, rechts: true },
  { titel: 'l [m]', breite: 14, rechts: true },
  { titel: 'Werkstoff', breite: 22 },
  { titel: 'd_a × s', breite: 20 },
  { titel: 'd_i [mm]', breite: 15, rechts: true },
  { titel: 'w [m/s]', breite: 15, rechts: true },
  { titel: 'Re', breite: 16, rechts: true },
  { titel: 'λ', breite: 14, rechts: true },
  { titel: 'R [Pa/m]', breite: 17, rechts: true },
  { titel: 'R·l [Pa]', breite: 16, rechts: true },
  { titel: 'Σζ', breite: 12, rechts: true },
  { titel: 'Z [Pa]', breite: 15, rechts: true },
  { titel: 'Δp [Pa]', breite: 16, rechts: true },
  { titel: 'Dämm. [mm]', breite: 18, rechts: true },
];

const SPALTEN_STRANG: Spalte[] = [
  { titel: 'Strang', breite: 46 },
  { titel: 'Quelle', breite: 30 },
  { titel: 'Q̇ [W]', breite: 16, rechts: true },
  { titel: 'V̇ [m³/h]', breite: 18, rechts: true },
  { titel: 'l [m]', breite: 14, rechts: true },
  { titel: 'ΣR·l [Pa]', breite: 18, rechts: true },
  { titel: 'ΣZ [Pa]', breite: 17, rechts: true },
  { titel: 'Heizfl. [Pa]', breite: 19, rechts: true },
  { titel: 'Ventil [Pa]', breite: 18, rechts: true },
  { titel: 'Drossel [Pa]', breite: 20, rechts: true },
  { titel: 'Δp ges [Pa]', breite: 20, rechts: true },
  { titel: '', breite: 16 },
];

const SPALTEN_HEIZFLAECHE: Spalte[] = [
  { titel: 'Heizfläche', breite: 40 },
  { titel: 'Raum', breite: 30 },
  { titel: 'Geschoss', breite: 22 },
  { titel: 'Q̇ [W]', breite: 16, rechts: true },
  { titel: 'ṁ [kg/h]', breite: 18, rechts: true },
  { titel: 'DN', breite: 12, rechts: true },
  { titel: 'k_v erf.', breite: 16, rechts: true },
  { titel: 'Ventil', breite: 44 },
  { titel: 'Voreinst.', breite: 18, rechts: true },
  { titel: 'k_v Stufe', breite: 17, rechts: true },
  { titel: 'a_V', breite: 13, rechts: true },
  { titel: 'Urteil', breite: 30 },
];

// ---------------------------------------------------------------------------
// Ergebnis
// ---------------------------------------------------------------------------

export interface RohrnetzDruckOptionen {
  format?: PaperFormat;
  /** Ausrichtung der Tabellenblätter. Vorgabe quer — anders passt die Tabelle nicht. */
  orientation?: PaperOrientation;
  /** Den Grundriss als erstes Blatt mitdrucken. */
  grundriss?: boolean;
  /** Maßstabsnenner des Grundrisses. */
  planScale?: number;
  /** Ausrichtung des Grundrissblatts. */
  planOrientation?: PaperOrientation;
}

export interface RohrnetzDruckErgebnis {
  sheets: string[];
  sheet: { w: number; h: number };
  /** Maße des Grundrissblatts, falls es abweicht. */
  planSheet?: { w: number; h: number };
  /** Passt der Grundriss im gewählten Maßstab aufs Blatt? */
  planFits: boolean;
  /** Kleinster Maßstabsnenner, bei dem er passen würde. */
  planSuggestedScale: number;
  notes: string[];
}

/**
 * Den Bericht in Blätter setzen.
 *
 * Der Grundriss kommt als erstes Blatt und wird von `buildPlanSvg` gebaut —
 * derselben Funktion, die auch der Plandruck benutzt. Zwei Zeichenwege für
 * denselben Grundriss wären genau der Fehler, den dieses Projekt schon
 * zweimal gemacht hat: die zweite Kopie driftet, und niemand merkt es, bis
 * ein Ausdruck anders aussieht als der Bildschirm.
 */
export function buildPipeReportSheets(
  doc: BimDocument,
  bericht: RohrnetzBericht,
  optionen: RohrnetzDruckOptionen = {},
): RohrnetzDruckErgebnis {
  const format = optionen.format ?? 'A4';
  const m = masse(format, optionen.orientation ?? 'landscape');
  const notes: string[] = [];
  const sheets: string[] = [];

  // --- Blatt 1: Grundriss mit Rohrnetz -------------------------------------
  let planFits = true;
  let planSuggestedScale = optionen.planScale ?? 50;
  let planSheet: { w: number; h: number } | undefined;
  if (optionen.grundriss !== false) {
    const plan = buildPlanSvg(doc, {
      scale: optionen.planScale ?? 50,
      format,
      orientation: optionen.planOrientation ?? 'portrait',
      levelId: bericht.levelId,
      showRoomLabels: true,
      showDimensions: false,
      showFixtures: true,
      showAnnotations: false,
      showInteriorDimensions: false,
      showLegend: true,
      showOpeningDimensions: false,
      title: `${bericht.titel} — Rohrnetz`,
    });
    sheets.push(plan.svg);
    planFits = plan.fits;
    planSuggestedScale = plan.suggestedScale;
    planSheet = plan.sheet;
    if (!plan.fits) {
      notes.push(
        `Der Grundriss passt im Maßstab 1:${optionen.planScale ?? 50} nicht auf ${format}. ` +
          `Ab 1:${plan.suggestedScale} passt er.`,
      );
    }
  }

  const gesamtVorschau = 5 + Math.ceil(bericht.teilstrecken.length / 55) + Math.ceil(bericht.heizflaechen.length / 55);
  const kopf = `${bericht.titel} · Rohrnetzberechnung · ${bericht.erstellt}`;
  const fuss = (i: number) =>
    `Blatt ${i}/${gesamtVorschau} · RaVia CAD Light · Berechnung nach anerkannten Regeln der Technik, ` +
    'kein Ersatz für die Prüfung durch den Fachplaner';

  // --- Blatt 2: Anlagendaten und Nachweis ----------------------------------
  sheets.push(blatt(m, deckblatt(m, bericht), kopf, fuss(sheets.length + 1)));

  // --- Teilstreckenblätter --------------------------------------------------
  const proBlatt = Math.max(10, Math.floor((m.feld.h - 26) / ZEILE));
  for (let i = 0; i < bericht.teilstrecken.length; i += proBlatt) {
    const teil = bericht.teilstrecken.slice(i, i + proBlatt);
    sheets.push(
      blatt(m, teilstreckenBlatt(m, bericht, teil, i === 0), kopf, fuss(sheets.length + 1)),
    );
  }
  if (!bericht.teilstrecken.length) {
    sheets.push(blatt(m, teilstreckenBlatt(m, bericht, [], true), kopf, fuss(sheets.length + 1)));
  }

  // --- Strangübersicht ------------------------------------------------------
  sheets.push(blatt(m, strangBlatt(m, bericht), kopf, fuss(sheets.length + 1)));

  // --- Einstellwerte --------------------------------------------------------
  for (let i = 0; i < Math.max(1, bericht.heizflaechen.length); i += proBlatt) {
    const teil = bericht.heizflaechen.slice(i, i + proBlatt);
    sheets.push(
      blatt(m, heizflaechenBlatt(m, bericht, teil, i === 0), kopf, fuss(sheets.length + 1)),
    );
  }

  // --- Quellen und Hinweise -------------------------------------------------
  sheets.push(blatt(m, quellenBlatt(m, bericht), kopf, fuss(sheets.length + 1)));

  return { sheets, sheet: m.sheet, planSheet, planFits, planSuggestedScale, notes };
}

// ---------------------------------------------------------------------------
// Die einzelnen Blätter
// ---------------------------------------------------------------------------

function deckblatt(m: Blattmasse, b: RohrnetzBericht): string {
  const teile: string[] = [];
  let y = m.feld.y + 6;
  teile.push(zeile(m.feld.x, y, 'Rohrnetzberechnung', { size: FONT_TITEL, bold: true }));
  y += 6;
  teile.push(zeile(m.feld.x, y, b.titel, { size: FONT_ABSCHNITT, fill: GRAU }));
  y += 8;

  const urteil = berichtsUrteil(b);
  teile.push(
    zeile(m.feld.x, y, urteil.nachweisfaehig ? 'Nachweisfähig' : 'Nicht nachweisfähig', {
      size: FONT_ABSCHNITT,
      bold: true,
      fill: urteil.nachweisfaehig ? '#15803D' : '#B45309',
    }),
  );
  y += 4.5;
  if (!urteil.nachweisfaehig) {
    for (const z of umbrich(`Offen: ${urteil.offen.join('; ')}.`, m.feld.w, FONT)) {
      teile.push(zeile(m.feld.x, y, z, { fill: GRAU }));
      y += ZEILE;
    }
  }
  y += 3;

  // --- Anlagendaten ---------------------------------------------------------
  teile.push(zeile(m.feld.x, y, 'Anlagendaten', { size: FONT_ABSCHNITT, bold: true }));
  y += 5;
  const daten: [string, string][] = [
    ['Auslegungstemperaturen', `${de(b.temperaturen.vorlauf, 0)} / ${de(b.temperaturen.ruecklauf, 0)} °C, Spreizung ${de(b.temperaturen.spreizung, 1)} K`],
    ['Stoffwerte', `ρ = ${de(b.fluid.density, 1)} kg/m³, ν = ${b.fluid.kinematicViscosity.toExponential(2)} m²/s bei ${de(b.fluid.temperature, 0)} °C`],
    ['Vorherrschender Werkstoff', PIPE_MATERIAL_LABELS[b.werkstoff]],
    ['Gebäudeheizlast', `${de(b.heizlast.wert, 1)} kW (${b.heizlast.herkunft})`],
    ['Gesamtvolumenstrom', `${de(b.volumenstrom, 3)} m³/h`],
    ['Gezeichnete Rohrlänge', `${de(b.rohrlaenge, 1)} m Trasse`],
    ['Teilstrecken', `${b.teilstrecken.length}`],
    ['Heizflächen', `${b.heizflaechen.length}`],
  ];
  if (b.schlechtpunkt) {
    daten.push([
      'Schlechtpunkt',
      `${b.schlechtpunkt.bezeichnung} mit ${de(b.schlechtpunkt.gesamt / 1000, 2)} kPa`,
    ]);
  }
  if (b.pumpe) {
    daten.push([
      'Pumpe',
      `${de(b.pumpe.flow, 3)} m³/h bei ${de(b.pumpe.head, 2)} m (${de(b.pumpe.pressureKpa, 1)} kPa), ` +
        `elektrisch rund ${de(b.pumpe.electricPower, 0)} W`,
    ]);
  }
  for (const [k, v] of daten) {
    teile.push(zeile(m.feld.x, y, k, { fill: GRAU }));
    teile.push(zeile(m.feld.x + 58, y, v));
    y += ZEILE;
  }
  y += 4;

  // --- Nachweiskatalog ------------------------------------------------------
  teile.push(
    zeile(m.feld.x, y, 'Pflichtangaben nach § 60c Abs. 4 GModG (vormals GEG)', {
      size: FONT_ABSCHNITT,
      bold: true,
    }),
  );
  y += 5;
  for (const p of b.nachweis) {
    teile.push(zeile(m.feld.x, y, p.erfuellt ? '✓' : '○', { bold: true, fill: p.erfuellt ? '#15803D' : '#B45309' }));
    teile.push(zeile(m.feld.x + 5, y, `${p.nr}. ${p.forderung}`, { bold: true }));
    const zeilen = umbrich(p.antwort, m.feld.w - 62, FONT_KLEIN);
    zeilen.forEach((z, i) => {
      teile.push(zeile(m.feld.x + 60, y + i * 3.1, z, { size: FONT_KLEIN, fill: GRAU }));
    });
    y += Math.max(ZEILE, zeilen.length * 3.1 + 0.8);
  }

  return teile.join('');
}

function teilstreckenBlatt(
  m: Blattmasse,
  b: RohrnetzBericht,
  zeilen: readonly TeilstreckenZeile[],
  erste: boolean,
): string {
  const teile: string[] = [];
  let y = m.feld.y + 5;
  if (erste) {
    teile.push(zeile(m.feld.x, y, 'Teilstrecken', { size: FONT_ABSCHNITT, bold: true }));
    y += 4;
    teile.push(
      zeile(
        m.feld.x,
        y,
        'Δp = R·l + Σζ·ρ/2·w². λ nach Colebrook-White, iterativ. Längen sind Vor- und Rücklauf zusammen.',
        { size: FONT_KLEIN, fill: GRAU },
      ),
    );
    y += 5;
  } else {
    teile.push(zeile(m.feld.x, y, 'Teilstrecken (Fortsetzung)', { size: FONT_ABSCHNITT, bold: true }));
    y += 5;
  }

  if (!zeilen.length) {
    teile.push(
      zeile(m.feld.x, y + 4, 'Keine Teilstrecken — im Modell ist kein Rohrnetz gezeichnet.', {
        fill: GRAU,
      }),
    );
    return teile.join('');
  }

  teile.push(tabellenkopf(SPALTEN_TEILSTRECKE, m.feld.x, y));
  y += 4;
  const strangName = new Map(b.straenge.map((s) => [s.id, s.bezeichnung]));
  for (const t of zeilen) {
    teile.push(
      tabellenzeile(
        SPALTEN_TEILSTRECKE,
        [
          String(t.nr),
          `${strangName.get(t.strangId) ?? ''} · ${t.bezeichnung}`,
          de(t.volumenstrom, 3),
          de(t.laenge, 2),
          PIPE_MATERIAL_LABELS[t.werkstoff],
          t.abmessung,
          de(t.innen, 1),
          de(t.geschwindigkeit, 3),
          t.reynolds.toLocaleString('de-DE'),
          de(t.lambda, 4),
          de(t.r, 1),
          String(t.rl),
          de(t.zeta, 2),
          String(t.z),
          String(t.dp),
          t.daemmung > 0 ? String(t.daemmung) : '—',
        ],
        m.feld.x,
        y,
      ),
    );
    y += ZEILE;
  }
  return teile.join('');
}

function strangBlatt(m: Blattmasse, b: RohrnetzBericht): string {
  const teile: string[] = [];
  let y = m.feld.y + 5;
  teile.push(zeile(m.feld.x, y, 'Fließwege', { size: FONT_ABSCHNITT, bold: true }));
  y += 4;
  teile.push(
    zeile(
      m.feld.x,
      y,
      'Der ungünstigste Strang bestimmt die Förderhöhe; alle übrigen werden auf ihn abgedrosselt.',
      { size: FONT_KLEIN, fill: GRAU },
    ),
  );
  y += 5;
  teile.push(tabellenkopf(SPALTEN_STRANG, m.feld.x, y));
  y += 4;
  const platz = Math.floor((m.feld.h - (y - m.feld.y) - 4) / ZEILE);
  for (const s of b.straenge.slice(0, platz)) {
    teile.push(
      tabellenzeile(
        SPALTEN_STRANG,
        [
          s.bezeichnung,
          s.quelle,
          String(s.leistung) + (s.leistungGeschaetzt ? ' *' : ''),
          de(s.volumenstrom, 3),
          de(s.laenge, 2),
          String(s.reibung),
          String(s.einzelwiderstaende),
          String(s.heizflaeche),
          String(s.ventil),
          String(s.drossel),
          String(s.gesamt),
          s.ungueninstigster ? 'Schlechtpunkt' : '',
        ],
        m.feld.x,
        y,
        s.ungueninstigster,
      ),
    );
    y += ZEILE;
  }
  if (b.straenge.some((s) => s.leistungGeschaetzt)) {
    y += 3;
    teile.push(
      zeile(m.feld.x, y, '* Leistung ist eine Vorbelegung, keine gerechnete Heizlast.', {
        size: FONT_KLEIN,
        fill: GRAU,
      }),
    );
  }
  return teile.join('');
}

function heizflaechenBlatt(
  m: Blattmasse,
  b: RohrnetzBericht,
  zeilen: RohrnetzBericht['heizflaechen'],
  erste: boolean,
): string {
  const teile: string[] = [];
  let y = m.feld.y + 5;
  teile.push(
    zeile(m.feld.x, y, erste ? 'Einstellwerte je Heizfläche' : 'Einstellwerte (Fortsetzung)', {
      size: FONT_ABSCHNITT,
      bold: true,
    }),
  );
  y += 4;
  if (erste) {
    teile.push(
      zeile(
        m.feld.x,
        y,
        'a_V = Ventilautorität; unter 0,3 wird der Regelkreis instabil. k_v = V̇·√(1 bar/Δp).',
        { size: FONT_KLEIN, fill: GRAU },
      ),
    );
    y += 5;
  }
  if (!zeilen.length) {
    teile.push(zeile(m.feld.x, y + 4, 'Keine Heizflächen am Netz.', { fill: GRAU }));
    return teile.join('');
  }
  teile.push(tabellenkopf(SPALTEN_HEIZFLAECHE, m.feld.x, y));
  y += 4;
  for (const h of zeilen) {
    teile.push(
      tabellenzeile(
        SPALTEN_HEIZFLAECHE,
        [
          h.bezeichnung,
          h.raum ?? '—',
          h.geschoss,
          String(h.leistung) + (h.leistungGeschaetzt ? ' *' : ''),
          String(h.massenstrom),
          String(h.dn),
          h.kv === undefined ? '—' : de(h.kv, 2),
          h.ventil ?? '—',
          h.voreinstellung ?? '—',
          h.kvStufe === undefined ? '—' : de(h.kvStufe, 2),
          h.autoritaet === undefined ? '—' : de(h.autoritaet, 2),
          h.urteil,
        ],
        m.feld.x,
        y,
      ),
    );
    y += ZEILE;
  }
  void b;
  return teile.join('');
}

function quellenBlatt(m: Blattmasse, b: RohrnetzBericht): string {
  const teile: string[] = [];
  let y = m.feld.y + 5;
  teile.push(zeile(m.feld.x, y, 'Hinweise', { size: FONT_ABSCHNITT, bold: true }));
  y += 5;
  const hinweise = b.hinweise.slice(0, 14);
  if (!hinweise.length) {
    teile.push(zeile(m.feld.x, y, 'Keine Hinweise.', { fill: GRAU }));
    y += ZEILE;
  }
  for (const h of hinweise) {
    const marke = h.severity === 'error' ? '!' : h.severity === 'warn' ? '△' : '·';
    teile.push(zeile(m.feld.x, y, marke, { bold: true, fill: h.severity === 'info' ? BLASS : '#B45309' }));
    const zeilen = umbrich(h.text, m.feld.w - 6, FONT_KLEIN);
    zeilen.forEach((z, i) => teile.push(zeile(m.feld.x + 5, y + i * 3.1, z, { size: FONT_KLEIN })));
    y += Math.max(ZEILE, zeilen.length * 3.1 + 1);
    if (y > m.feld.y + m.feld.h - 40) break;
  }

  y += 5;
  teile.push(zeile(m.feld.x, y, 'Quellen', { size: FONT_ABSCHNITT, bold: true }));
  y += 5;
  for (const q of b.quellen.slice(0, 12)) {
    teile.push(zeile(m.feld.x, y, `${q.titel} — ${q.quelle}`, { size: FONT_KLEIN }));
    y += 3.2;
    if (q.url) {
      teile.push(zeile(m.feld.x + 4, y, q.url, { size: FONT_KLEIN, fill: BLASS }));
      y += 3.2;
    }
    if (y > m.feld.y + m.feld.h - 6) break;
  }
  return teile.join('');
}

// ---------------------------------------------------------------------------
// Druck
// ---------------------------------------------------------------------------

/**
 * Die Blätter im Druckdialog des Browsers öffnen.
 *
 * Die einzige Stelle dieses Moduls, die `window` anfasst — bewusst am Ende,
 * damit der Rest ohne Browser läuft und im Prüfblock geprüft werden kann.
 *
 * Das Grundrissblatt kann ein anderes Seitenformat haben als die
 * Tabellenblätter (hochkant gegen quer). `@page` gilt für das ganze Dokument;
 * deshalb wird das größere Maß genommen und das kleinere Blatt darin
 * zentriert — der Browser skaliert nicht, und ein zu großes `@page` schneidet
 * nichts ab.
 */
export function printPipeReport(ergebnis: RohrnetzDruckErgebnis, titel = 'Rohrnetzberechnung'): boolean {
  const win = window.open('', '_blank');
  if (!win) return false;
  const w = Math.max(ergebnis.sheet.w, ergebnis.planSheet?.w ?? 0);
  const h = Math.max(ergebnis.sheet.h, ergebnis.planSheet?.h ?? 0);
  const koerper = ergebnis.sheets
    .map(
      (svg, i) =>
        `<div class="blatt"${i === ergebnis.sheets.length - 1 ? ' style="page-break-after:auto"' : ''}>${svg}</div>`,
    )
    .join('');
  win.document.write(
    `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${escapeXml(titel)}</title>` +
      `<style>@page{size:${w}mm ${h}mm;margin:0}html,body{margin:0;padding:0;background:#fff}` +
      '.blatt{page-break-after:always;display:flex;align-items:center;justify-content:center}svg{display:block}' +
      '@media screen{body{padding:16px;background:#334155}svg{box-shadow:0 8px 40px rgba(0,0,0,.4);margin:0 auto 16px}}' +
      `</style></head><body>${koerper}` +
      "<script>window.addEventListener('load',function(){setTimeout(function(){window.print()},250)})<\\/script>" +
      '</body></html>',
  );
  win.document.close();
  return true;
}
