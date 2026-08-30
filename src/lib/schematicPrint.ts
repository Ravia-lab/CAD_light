/**
 * Anlagenschema als druckfähiges Blatt.
 * ---------------------------------------------------------------------------
 * **Warum es dieses Modul gibt.** Ein Anlagenschema wird nicht am Bildschirm
 * montiert. Es liegt auf der Baustelle, im Ordner des Prüfers und in der
 * Anlagendokumentation — auf Papier, oft schwarzweiß, oft geknickt. Der
 * Bildschirmzeichner (`SchemaView`) taugt dafür nicht: er zeichnet in Pixeln
 * auf dunklem Grund, kennt kein Blattformat und kein Schriftfeld. Hier
 * entsteht deshalb dasselbe Schema noch einmal, aber in **Millimetern auf
 * einem Blatt** — mit Rahmen, Schriftfeld, Legende und der Prüfung, ob es
 * überhaupt draufpasst.
 *
 * **Warum das Rad nicht neu gedreht wird.** Die Symbole stehen in
 * `schematicSymbols.ts` und dürfen dort auch bleiben; zwei Symbolsätze wären
 * zwei Wahrheiten. Jenes Modul zeichnet aber auf ein
 * `CanvasRenderingContext2D`. Statt die Formen abzuschreiben, steht hier ein
 * **Aufzeichner** (`SvgRecorder`), der die von `drawSymbol` benutzten
 * Canvas-Aufrufe entgegennimmt und daraus SVG-Elemente macht. Das Symbol auf
 * dem Papier ist dadurch dasselbe Symbol wie am Bildschirm, Strich für
 * Strich; eine Änderung an der Symbolbibliothek wirkt automatisch im
 * Ausdruck.
 *
 * **Was „Maßstab" hier bedeutet.** Ein Prinzipschema hat streng genommen
 * keinen Maßstab: die Bauteillage ist ein Rasterplatz, kein Ort im Gebäude.
 * Ein Blatt ohne Maßstabsangabe ist aber unbrauchbar, weil niemand mehr
 * feststellen kann, ob der Drucker skaliert hat. Vereinbart ist deshalb:
 * **ein Rasterschritt entspricht 1,00 m Bezugsmaß.** Aus 1:50 werden also
 * 20 mm Rasterweite auf dem Papier, und die Maßstabsleiste aus
 * `planScaleBar.ts` ist ein echtes Prüfmaß. Das Schriftfeld sagt zusätzlich
 * ausdrücklich „Prinzipschema — kein Ausführungsplan", damit die Angabe
 * niemanden in die Irre führt.
 *
 * **Schwarzweiß ist kein Sonderfall.** Die Leitungsfarben aus
 * `PIPE_SERVICE_COLORS` sind Bildschirmfarben auf dunklem Grund; auf einem
 * Laserdrucker werden aus Hellblau und Gelb zwei kaum unterscheidbare Graus.
 * Deshalb hat jede Leitungsart hier zusätzlich eine eigene **Strichart**, die
 * im Schwarzweißdruck die Farbe vollständig ersetzt und in der Legende
 * ausgewiesen wird. Ein Schema muss ohne Farbe lesbar bleiben.
 *
 * **Keine DOM-Zugriffe.** Dieses Modul erzeugt Zeichenketten, sonst nichts.
 * Auch das Datum kommt von außen: eine Zeichenfunktion, die selbst auf die
 * Uhr sieht, liefert bei jedem Aufruf ein anderes Ergebnis und ist damit
 * weder prüfbar noch reproduzierbar.
 */

import type { PipeService, SchematicComponent, SchematicKind, SchematicLink } from '../types/bim';
import { PIPE_SERVICE_COLORS, PIPE_SERVICE_LABELS } from '../types/bim';
import { SCHEMATIC_LEGEND, drawSymbol, pickPortPair, symbolExtent, symbolPortPoints } from './schematicSymbols';
import { drawableScaleBar } from './planScaleBar';
import { druckeDokument } from './druckFenster';

// ---------------------------------------------------------------------------
// Kleinkram: Zahlen und XML
// ---------------------------------------------------------------------------

/**
 * Zahl für ein SVG-Attribut. Vier Nachkommastellen, weil Symbolkoordinaten in
 * Einheitskoordinaten (0,06 …) ankommen und erst die Gruppentransformation
 * sie auf Millimeter zieht — bei zwei Stellen würden Rundungsfehler sichtbar.
 */
const n = (v: number): string => {
  if (!Number.isFinite(v)) return '0';
  const r = Math.round(v * 1e4) / 1e4;
  return Object.is(r, -0) ? '0' : String(r);
};

const escapeXml = (v: string): string =>
  v.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);

/**
 * Textbreite ohne Schriftmetrik. Die Beschriftung des Schemas läuft in einer
 * dicktengleichen Schrift (JetBrains Mono und die üblichen Ersatzschriften);
 * deren Vorschub beträgt 0,6 em. Damit ist die Breite rechenbar, ohne ein
 * Canvas oder eine Schriftdatei anzufassen. Für Proportionalschrift ist der
 * Wert eine brauchbare obere Schätzung.
 */
const textWidth = (text: string, fontSize: number): number => text.length * fontSize * 0.6;

/**
 * Bildschirmfarbe fürs Papier abdunkeln.
 *
 * Die Palette ist für dunklen Untergrund gemacht. Auf Weiß verschwindet ein
 * 0,35 mm breiter Strich in `#FBBF24` beinahe. Gemischt wird deshalb linear
 * gegen Schwarz; der Farbton bleibt erhalten, die Leitungsart bleibt an der
 * Farbe erkennbar, der Strich wird aber deckend.
 */
const darkenForPrint = (hex: string, amount: number): string => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const v = Number.parseInt(m[1], 16);
  const channels = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((c) =>
    Math.max(0, Math.min(255, Math.round(c * (1 - amount)))),
  );
  return `#${channels.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
};

// ---------------------------------------------------------------------------
// Canvas-Aufzeichner → SVG
// ---------------------------------------------------------------------------

interface RecorderState {
  lineWidth: number;
  strokeStyle: string;
  fillStyle: string;
  font: string;
  textAlign: string;
  textBaseline: string;
  lineJoin: string;
  lineCap: string;
  globalAlpha: number;
  dash: number[];
}

/**
 * Ein Canvas-Kontext, der statt zu rastern SVG-Elemente sammelt.
 *
 * **Transformationen.** SVG kennt keinen impliziten Zeichenzustand. Statt
 * eine Matrix mitzuführen und jeden Punkt selbst umzurechnen, öffnet jede
 * `translate`/`rotate`/`scale`-Anweisung eine `<g transform="…">`-Gruppe, die
 * beim zugehörigen `restore()` wieder geschlossen wird. Das hat einen
 * praktischen Nebeneffekt: die Strichstärke wird von der Gruppe mitskaliert,
 * genau wie es Canvas tut — `drawSymbol` rechnet `lineWidth / size` zurück
 * und bekommt dadurch auch im SVG die gewünschte Strichstärke.
 *
 * **Grenze.** Innerhalb eines angefangenen Pfades darf die Transformation
 * nicht wechseln: Canvas rechnet jeden Pfadpunkt sofort um, die Gruppe erst
 * beim Zeichnen. Die Symbolbibliothek tut das nirgends (sie setzt die
 * Transformation einmal je Symbol und zeichnet dann in Einheitskoordinaten),
 * deshalb ist die Einschränkung hier folgenlos.
 */
export class SvgRecorder {
  lineWidth = 1;
  strokeStyle = '#000000';
  fillStyle = '#000000';
  font = '10px sans-serif';
  textAlign = 'start';
  textBaseline = 'alphabetic';
  lineJoin = 'miter';
  lineCap = 'butt';
  globalAlpha = 1;
  miterLimit = 10;
  lineDashOffset = 0;

  private out: string[] = [];
  private d: string[] = [];
  private cursor: { x: number; y: number } | null = null;
  private subpathStart: { x: number; y: number } | null = null;
  private dash: number[] = [];
  private states: RecorderState[] = [];
  /** Zahl offener Gruppen je `save()`-Ebene, damit `restore()` sie schließt. */
  private levels: number[] = [];
  private openGroups = 0;

  // -- Zustand ---------------------------------------------------------------

  save(): void {
    this.states.push({
      lineWidth: this.lineWidth,
      strokeStyle: this.strokeStyle,
      fillStyle: this.fillStyle,
      font: this.font,
      textAlign: this.textAlign,
      textBaseline: this.textBaseline,
      lineJoin: this.lineJoin,
      lineCap: this.lineCap,
      globalAlpha: this.globalAlpha,
      dash: [...this.dash],
    });
    this.levels.push(this.openGroups);
    this.openGroups = 0;
  }

  restore(): void {
    for (let i = 0; i < this.openGroups; i++) this.out.push('</g>');
    this.openGroups = this.levels.pop() ?? 0;
    const s = this.states.pop();
    if (!s) return;
    this.lineWidth = s.lineWidth;
    this.strokeStyle = s.strokeStyle;
    this.fillStyle = s.fillStyle;
    this.font = s.font;
    this.textAlign = s.textAlign;
    this.textBaseline = s.textBaseline;
    this.lineJoin = s.lineJoin;
    this.lineCap = s.lineCap;
    this.globalAlpha = s.globalAlpha;
    this.dash = s.dash;
  }

  setLineDash(segments: readonly number[]): void {
    this.dash = [...segments];
  }

  getLineDash(): number[] {
    return [...this.dash];
  }

  // -- Transformationen ------------------------------------------------------

  private group(transform: string): void {
    this.out.push(`<g transform="${transform}">`);
    this.openGroups++;
  }

  translate(x: number, y: number): void {
    this.group(`translate(${n(x)} ${n(y)})`);
  }

  rotate(angle: number): void {
    this.group(`rotate(${n((angle * 180) / Math.PI)})`);
  }

  scale(sx: number, sy: number): void {
    this.group(`scale(${n(sx)} ${n(sy)})`);
  }

  // -- Pfad ------------------------------------------------------------------

  beginPath(): void {
    this.d = [];
    this.cursor = null;
    this.subpathStart = null;
  }

  moveTo(x: number, y: number): void {
    this.d.push(`M${n(x)} ${n(y)}`);
    this.cursor = { x, y };
    this.subpathStart = { x, y };
  }

  lineTo(x: number, y: number): void {
    if (!this.cursor) {
      this.moveTo(x, y);
      return;
    }
    this.d.push(`L${n(x)} ${n(y)}`);
    this.cursor = { x, y };
  }

  closePath(): void {
    if (!this.cursor) return;
    this.d.push('Z');
    if (this.subpathStart) this.cursor = { ...this.subpathStart };
  }

  rect(x: number, y: number, w: number, h: number): void {
    this.d.push(`M${n(x)} ${n(y)}H${n(x + w)}V${n(y + h)}H${n(x)}Z`);
    // Canvas hinterlässt nach `rect` den Startpunkt als aktuellen Punkt.
    this.cursor = { x, y };
    this.subpathStart = { x, y };
  }

  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void {
    if (!this.cursor) this.moveTo(cpx, cpy);
    this.d.push(`Q${n(cpx)} ${n(cpy)} ${n(x)} ${n(y)}`);
    this.cursor = { x, y };
  }

  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void {
    if (!this.cursor) this.moveTo(c1x, c1y);
    this.d.push(`C${n(c1x)} ${n(c1y)} ${n(c2x)} ${n(c2y)} ${n(x)} ${n(y)}`);
    this.cursor = { x, y };
  }

  arc(cx: number, cy: number, r: number, start: number, end: number, counterclockwise = false): void {
    this.ellipse(cx, cy, r, r, 0, start, end, counterclockwise);
  }

  /**
   * Bogen als SVG-`A`-Segmente.
   *
   * Zwei Feinheiten, an denen eine naive Umsetzung scheitert: Canvas zieht
   * vom aktuellen Punkt eine Gerade zum Bogenanfang (deshalb das `L`), und
   * SVG kann keinen Vollkreis in einem Segment darstellen (Anfang gleich
   * Ende ist mehrdeutig) — deshalb die Aufteilung in Stücke von höchstens
   * einem Halbkreis.
   */
  ellipse(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    rotation: number,
    start: number,
    end: number,
    counterclockwise = false,
  ): void {
    const TAU = Math.PI * 2;
    let delta = end - start;
    if (!counterclockwise) {
      delta = delta >= TAU ? TAU : ((delta % TAU) + TAU) % TAU;
    } else {
      delta = delta <= -TAU ? -TAU : -((((start - end) % TAU) + TAU) % TAU);
    }

    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const at = (t: number) => {
      const x = rx * Math.cos(t);
      const y = ry * Math.sin(t);
      return { x: cx + x * cos - y * sin, y: cy + x * sin + y * cos };
    };

    const from = at(start);
    if (this.cursor) this.d.push(`L${n(from.x)} ${n(from.y)}`);
    else this.moveTo(from.x, from.y);

    if (Math.abs(delta) < 1e-9) {
      this.cursor = from;
      return;
    }
    const sweep = delta > 0 ? 1 : 0;
    const steps = Math.max(1, Math.ceil(Math.abs(delta) / Math.PI));
    const step = delta / steps;
    const deg = (rotation * 180) / Math.PI;
    for (let i = 1; i <= steps; i++) {
      const p = at(start + step * i);
      this.d.push(`A${n(rx)} ${n(ry)} ${n(deg)} 0 ${sweep} ${n(p.x)} ${n(p.y)}`);
      this.cursor = p;
    }
  }

  /** Verrundete Ecke zwischen den Strecken (cursor→p1) und (p1→p2). */
  arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void {
    if (!this.cursor) {
      this.moveTo(x1, y1);
      return;
    }
    const p0 = this.cursor;
    const v1 = { x: p0.x - x1, y: p0.y - y1 };
    const v2 = { x: x2 - x1, y: y2 - y1 };
    const l1 = Math.hypot(v1.x, v1.y);
    const l2 = Math.hypot(v2.x, v2.y);
    if (l1 < 1e-9 || l2 < 1e-9 || r <= 0) {
      this.lineTo(x1, y1);
      return;
    }
    const u1 = { x: v1.x / l1, y: v1.y / l1 };
    const u2 = { x: v2.x / l2, y: v2.y / l2 };
    const angle = Math.acos(Math.max(-1, Math.min(1, u1.x * u2.x + u1.y * u2.y)));
    if (angle < 1e-6 || Math.PI - angle < 1e-6) {
      this.lineTo(x1, y1);
      return;
    }
    const tangent = r / Math.tan(angle / 2);
    const t1 = { x: x1 + u1.x * tangent, y: y1 + u1.y * tangent };
    const t2 = { x: x1 + u2.x * tangent, y: y1 + u2.y * tangent };
    const cross = u1.x * u2.y - u1.y * u2.x;
    this.lineTo(t1.x, t1.y);
    this.d.push(`A${n(r)} ${n(r)} 0 0 ${cross > 0 ? 0 : 1} ${n(t2.x)} ${n(t2.y)}`);
    this.cursor = t2;
  }

  // -- Ausgabe ---------------------------------------------------------------

  private common(): string {
    let s = '';
    if (this.globalAlpha < 1) s += ` opacity="${n(this.globalAlpha)}"`;
    return s;
  }

  stroke(): void {
    if (!this.d.length) return;
    const dash = this.dash.length ? ` stroke-dasharray="${this.dash.map(n).join(' ')}"` : '';
    this.out.push(
      `<path d="${this.d.join('')}" fill="none" stroke="${this.strokeStyle}" stroke-width="${n(this.lineWidth)}" ` +
        `stroke-linejoin="${this.lineJoin}" stroke-linecap="${this.lineCap}"${dash}${this.common()}/>`,
    );
  }

  fill(rule?: 'nonzero' | 'evenodd'): void {
    if (!this.d.length) return;
    this.out.push(
      `<path d="${this.d.join('')}" fill="${this.fillStyle}" fill-rule="${rule ?? 'nonzero'}" stroke="none"${this.common()}/>`,
    );
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    this.out.push(
      `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="${this.fillStyle}"${this.common()}/>`,
    );
  }

  strokeRect(x: number, y: number, w: number, h: number): void {
    this.out.push(
      `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="none" ` +
        `stroke="${this.strokeStyle}" stroke-width="${n(this.lineWidth)}"${this.common()}/>`,
    );
  }

  /** Zerlegt `font` in Größe, Schnitt und Familie — mehr braucht SVG nicht. */
  private fontParts(): { size: number; weight: string; family: string } {
    const size = /(-?[\d.]+)px/.exec(this.font);
    const weight = /^\s*(\d{3}|bold|bolder|lighter|normal)\s/.exec(this.font);
    const px = this.font.indexOf('px');
    const family = px >= 0 ? this.font.slice(px + 2).trim() : this.font.trim();
    return {
      size: size ? Number.parseFloat(size[1]) : 10,
      weight: weight ? weight[1] : '400',
      family: family || 'sans-serif',
    };
  }

  private textAttributes(x: number, y: number): string {
    const f = this.fontParts();
    const anchor =
      this.textAlign === 'center' ? 'middle' : this.textAlign === 'right' || this.textAlign === 'end' ? 'end' : 'start';
    const baseline =
      this.textBaseline === 'top' || this.textBaseline === 'hanging'
        ? ' dominant-baseline="text-before-edge"'
        : this.textBaseline === 'middle'
          ? ' dominant-baseline="central"'
          : this.textBaseline === 'bottom' || this.textBaseline === 'ideographic'
            ? ' dominant-baseline="text-after-edge"'
            : '';
    return (
      `x="${n(x)}" y="${n(y)}" font-family="${escapeXml(f.family)}" font-size="${n(f.size)}" ` +
      `font-weight="${f.weight}" text-anchor="${anchor}"${baseline}`
    );
  }

  fillText(text: string, x: number, y: number, _maxWidth?: number): void {
    this.out.push(`<text ${this.textAttributes(x, y)} fill="${this.fillStyle}"${this.common()}>${escapeXml(text)}</text>`);
  }

  strokeText(text: string, x: number, y: number, _maxWidth?: number): void {
    this.out.push(
      `<text ${this.textAttributes(x, y)} fill="none" stroke="${this.strokeStyle}" ` +
        `stroke-width="${n(this.lineWidth)}"${this.common()}>${escapeXml(text)}</text>`,
    );
  }

  measureText(text: string): { width: number } {
    return { width: textWidth(text, this.fontParts().size) };
  }

  // -- Rumpfimplementierungen ------------------------------------------------
  // Von der Symbolbibliothek nicht benutzt. Sie stehen hier, damit ein
  // erweitertes Symbol nicht mit „is not a function" abstürzt, sondern nur
  // die betreffende Wirkung verliert.

  clip(_rule?: 'nonzero' | 'evenodd'): void {}
  clearRect(_x: number, _y: number, _w: number, _h: number): void {}
  setTransform(): void {}
  resetTransform(): void {}

  /** Alles Gezeichnete als SVG-Fragment; offene Gruppen werden geschlossen. */
  finish(): string {
    const open = this.openGroups + this.levels.reduce((a, b) => a + b, 0);
    return this.out.join('') + '</g>'.repeat(open);
  }
}

/**
 * Der Aufzeichner in der Gestalt, die `drawSymbol` erwartet.
 *
 * Die Umdeutung ist bewusst: nachgebildet sind nur die Methoden, die die
 * Symbolbibliothek tatsächlich aufruft. Ein vollständiger
 * `CanvasRenderingContext2D` mit Bildpuffern, Mustern und Verläufen wäre für
 * eine Strichzeichnung sinnlos.
 */
const asContext = (recorder: SvgRecorder): CanvasRenderingContext2D =>
  recorder as unknown as CanvasRenderingContext2D;

// ---------------------------------------------------------------------------
// Blatt, Maßstab, Strichbild
// ---------------------------------------------------------------------------

export type SchematicPaperFormat = 'A4' | 'A3' | 'A2';
export type SchematicOrientation = 'portrait' | 'landscape';

/** Hochformat-Maße [mm]; Querformat entsteht durch Tauschen. */
const PAPER: Record<SchematicPaperFormat, { w: number; h: number }> = {
  A4: { w: 210, h: 297 },
  A3: { w: 297, h: 420 },
  A2: { w: 420, h: 594 },
};

/**
 * Symbolgröße im Verhältnis zur Rasterweite. Übernommen aus der
 * Bildschirmdarstellung (Raster 74 px, Symbolgröße 34 px), damit Schema am
 * Bildschirm und Schema auf dem Blatt dasselbe Bild ergeben.
 */
const SYMBOL_RATIO = 34 / 74;

/** Vorgabe für den Rand [mm]; unten ist Platz für Schriftfeld und Maßstabsleiste. */
const MARGIN = { top: 12, right: 12, bottom: 36, left: 12 };

/** Höhe des Schriftfelds [mm]. */
const TITLE_H = 30;
/** Breite des Schriftfelds [mm]; bei sehr schmalem Blatt auf die Rahmenbreite begrenzt. */
const TITLE_W = 96;

/** Breite der Legendenspalte am rechten Rand [mm]. */
const LEGEND_W = 62;
/** Abstand zwischen Schema und Legendenspalte [mm]. */
const LEGEND_GAP = 4;
/** Zeilenhöhe der Symbolzeilen bzw. der Leitungszeilen in der Legende [mm]. */
const LEGEND_ROW = 9;
const LEGEND_LINE_ROW = 5;

/** Strichfarbe der Zeichnung. Ein Fließbild ist eine Strichzeichnung. */
const INK = '#0F172A';
const RULE = '#334155';
const FAINT = '#64748B';

/** Strichstärken [mm]. */
const SYMBOL_LINE = 0.25;
const PIPE_LINE = 0.35;
const FRAME_LINE = 0.4;

/** Schriftgrößen [mm]. */
const FONT_LABEL = 2.2;
const FONT_SMALL = 2.0;
const FONT_TITLE = 4.0;
const FONT_CAPTION = 1.7;

/**
 * Strichart je Leitungsart.
 *
 * Grundlage sind die vier Strichbilder, die jeder Drucker und jede Kopie
 * überstehen: durchgezogen, gestrichelt, strichpunktiert, gepunktet. Weil es
 * neun Leitungsarten gibt, sind vier davon abgewandelt (länger, kürzer,
 * zweiter Punkt) — die Zuordnung steht in der Legende und muss dort auch
 * gelesen werden, sie ist keine Norm.
 */
const SERVICE_DASH: Record<PipeService, string> = {
  'heating-flow': '',
  'heating-return': '3 1.4',
  'hot-water': '5 1.4 1 1.4',
  'cold-water': '0.8 1.2',
  circulation: '5 1.2 1 1.2 1 1.2',
  waste: '7 1.8',
  refrigerant: '2.6 1.2 0.6 1.2 0.6 1.2',
  'ventilation-supply': '1.6 1.2',
  'ventilation-exhaust': '5 1.2 1.6 1.2',
};

/** Benennung der Strichart im Klartext — für die Legendenspalte. */
const SERVICE_DASH_NAMES: Record<PipeService, string> = {
  'heating-flow': 'durchgezogen',
  'heating-return': 'gestrichelt',
  'hot-water': 'strichpunktiert',
  'cold-water': 'gepunktet',
  circulation: 'strich-zweipunkt',
  waste: 'lang gestrichelt',
  refrigerant: 'strich-zweipunkt kurz',
  'ventilation-supply': 'kurz gestrichelt',
  'ventilation-exhaust': 'lang-kurz gestrichelt',
};

/**
 * Maßstabsreihe. Bewusst grob gestuft: krumme Maßstäbe wie 1:37 sind auf dem
 * Blatt nicht nachmessbar. Ab 1:150 wird das Symbolraster kleiner als 7 mm —
 * das Schema ist dann zwar vollständig, aber nur noch mit der Lupe zu lesen;
 * darauf weist das Ergebnis hin.
 */
const SCALE_STEPS = [20, 25, 50, 75, 100, 125, 150, 200, 250, 500];

/** Rasterweite auf dem Papier [mm] bei gegebenem Maßstabsnenner. */
const pitchOf = (scale: number): number => 1000 / scale;

// ---------------------------------------------------------------------------
// Öffentliche Typen
// ---------------------------------------------------------------------------

export interface SchematicPrintOptions {
  format: SchematicPaperFormat;
  orientation: SchematicOrientation;
  /** Rand [mm]. Eine Zahl gilt für alle Seiten; unten wird auf das Schriftfeld aufgerundet. */
  margin?: number | { top: number; right: number; bottom: number; left: number };
  projectName: string;
  /** Anlagenbezeichnung, z. B. „Wärmepumpenanlage Haus 1". */
  plantName: string;
  /** Wer den Plan erstellt hat. */
  author: string;
  /** Datum als fertige Zeichenkette. Dieses Modul liest keine Uhr. */
  date: string;
  /** Maßstabsnenner (50 = 1:50) oder `'auto'` für die Einpassung. */
  scale: number | 'auto';
  showLegend: boolean;
  /** `true` = Leitungsfarben, `false` = Schwarzweiß mit Stricharten. */
  colour: boolean;
  /** Bauteilbeschriftung am Symbol. Vorgabe: an. */
  showLabels?: boolean;
  /** Leitungsbeschriftung an der Leitung. Vorgabe: an. */
  showLinkLabels?: boolean;
  /** Stückliste als eigenes Blatt anhängen. Vorgabe: aus. */
  componentTable?: boolean;
  /** Leitungsfarben fürs Papier abdunkeln. Vorgabe: an. */
  darkenColours?: boolean;
}

export interface SchematicPrintResult {
  /** Das Schemablatt — für den einfachen Fall, in dem nur ein Blatt gebraucht wird. */
  svg: string;
  /** Alle Blätter in Reihenfolge: Schema, ggf. Legende, ggf. Stückliste. */
  sheets: string[];
  /** Tatsächlich verwendeter Maßstabsnenner. */
  scale: number;
  /** Passt das Schema in diesem Maßstab in das Zeichenfeld? */
  fits: boolean;
  /** Kleinster Nenner der Reihe, bei dem es passen würde. */
  suggestedScale: number;
  sheet: { w: number; h: number };
  legendOnOwnSheet: boolean;
  /** Deutsche Hinweise für die Oberfläche — leer, wenn alles glatt lief. */
  notes: string[];
}

export interface SchematicFitResult {
  fits: boolean;
  /** Kleinster Nenner der Maßstabsreihe, bei dem alles ins Zeichenfeld passt. */
  requiredScale: number;
  /** Ausdehnung des Schemas im geprüften Maßstab [mm]. */
  contentMm: { w: number; h: number };
  /** Verfügbares Zeichenfeld [mm]. */
  frameMm: { w: number; h: number };
}

export interface ComponentTableRow {
  /** Positionsnummer auf dem Blatt, beginnend bei 1. */
  position: number;
  count: number;
  kind: SchematicKind;
  /** Bauteilname aus `SCHEMATIC_LEGEND`. */
  name: string;
  /** Anlagenkennzeichen der zusammengefassten Bauteile, in Reihenfolge. */
  labels: string[];
  /** Technische Angabe; leer, wenn keine hinterlegt ist. */
  spec: string;
  componentIds: string[];
}

// ---------------------------------------------------------------------------
// Blattaufteilung
// ---------------------------------------------------------------------------

interface SheetLayout {
  sheet: { w: number; h: number };
  margin: { top: number; right: number; bottom: number; left: number };
  frame: { x: number; y: number; w: number; h: number };
}

function resolveLayout(options: SchematicPrintOptions): SheetLayout {
  const paper = PAPER[options.format];
  const sheet = options.orientation === 'landscape' ? { w: paper.h, h: paper.w } : { w: paper.w, h: paper.h };

  const given =
    typeof options.margin === 'number'
      ? { top: options.margin, right: options.margin, bottom: options.margin, left: options.margin }
      : (options.margin ?? MARGIN);
  // Unten muss das Schriftfeld hin. Ein zu kleiner Rand würde es in die
  // Zeichnung schieben — deshalb hier aufrunden statt später überdecken.
  const margin = { ...given, bottom: Math.max(given.bottom, TITLE_H + 6) };

  return {
    sheet,
    margin,
    frame: {
      x: margin.left,
      y: margin.top,
      w: sheet.w - margin.left - margin.right,
      h: sheet.h - margin.top - margin.bottom,
    },
  };
}

/** Ausdehnung des Schemas [mm] bei gegebener Rasterweite, Beschriftung eingerechnet. */
function measureContent(
  components: readonly SchematicComponent[],
  pitch: number,
  showLabels: boolean,
): { minX: number; minY: number; w: number; h: number } {
  if (!components.length) return { minX: 0, minY: 0, w: 0, h: 0 };

  const size = pitch * SYMBOL_RATIO;
  const gap = Math.max(0.8, FONT_LABEL * 0.35);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const c of components) {
    const ext = symbolExtent(c.kind, size);
    const cx = c.x * pitch;
    const cy = c.y * pitch;
    const label = showLabels ? c.label : '';
    const spec = showLabels ? (c.spec ?? '') : '';
    // Die Beschriftung steht waagerecht mittig über und unter dem Symbol und
    // ist oft breiter als das Symbol selbst — sie gehört deshalb in die
    // Ausdehnung, sonst wird sie am Blattrand abgeschnitten.
    const half = Math.max(ext.width / 2, textWidth(label, FONT_LABEL) / 2, textWidth(spec, FONT_LABEL) / 2);
    minX = Math.min(minX, cx - half);
    maxX = Math.max(maxX, cx + half);
    minY = Math.min(minY, cy - ext.height / 2 - (label ? FONT_LABEL + gap : 0));
    maxY = Math.max(maxY, cy + ext.height / 2 + (spec ? FONT_LABEL + gap : 0));
  }

  // Zuschlag für die Anlaufstrecken der Leitungen, die aus den äußeren
  // Stutzen herauslaufen, bevor sie abknicken.
  const lead = size * 0.36;
  return { minX: minX - lead, minY: minY - lead, w: maxX - minX + lead * 2, h: maxY - minY + lead * 2 };
}

/** Zeichenfeld für das Schema — ohne die Legendenspalte, falls sie mit aufs Blatt kommt. */
function contentFrame(frame: SheetLayout['frame'], legendInline: boolean): SheetLayout['frame'] {
  if (!legendInline) return frame;
  return { ...frame, w: Math.max(20, frame.w - LEGEND_W - LEGEND_GAP) };
}

/**
 * Passt das Schema aufs Blatt, und wenn nicht: welcher Maßstab wäre nötig?
 *
 * Dieselbe Frage wie beim Planausdruck, nur mit einem anderen Bezugsmaß. Die
 * Antwort wird gebraucht, bevor gedruckt wird — ein abgeschnittenes Schema
 * fällt sonst erst auf dem Papier auf.
 */
export function fitsOnSheet(
  components: readonly SchematicComponent[],
  options: SchematicPrintOptions,
): SchematicFitResult {
  const layout = resolveLayout(options);
  const inline = options.showLegend && legendFitsBeside(components, layout.frame);
  const area = contentFrame(layout.frame, inline);
  const showLabels = options.showLabels !== false;

  const requiredScale =
    SCALE_STEPS.find((s) => {
      const box = measureContent(components, pitchOf(s), showLabels);
      return box.w <= area.w && box.h <= area.h;
    }) ?? SCALE_STEPS[SCALE_STEPS.length - 1];

  const scale = options.scale === 'auto' ? requiredScale : options.scale;
  const box = measureContent(components, pitchOf(scale), showLabels);

  return {
    fits: box.w <= area.w && box.h <= area.h,
    requiredScale,
    contentMm: { w: box.w, h: box.h },
    frameMm: { w: area.w, h: area.h },
  };
}

// ---------------------------------------------------------------------------
// Legende
// ---------------------------------------------------------------------------

/** Bauteilarten in der Reihenfolge der Symboltabelle, ohne Wiederholung. */
function usedKinds(components: readonly SchematicComponent[]): SchematicKind[] {
  const present = new Set<SchematicKind>(components.map((c) => c.kind));
  return (Object.keys(SCHEMATIC_LEGEND) as SchematicKind[]).filter((k) => present.has(k));
}

/** Leitungsarten in der Reihenfolge der Typdefinition, ohne Wiederholung. */
function usedServices(links: readonly SchematicLink[]): PipeService[] {
  const present = new Set<PipeService>(links.map((l) => l.service));
  return (Object.keys(PIPE_SERVICE_LABELS) as PipeService[]).filter((s) => present.has(s));
}

function legendHeight(kinds: readonly SchematicKind[], services: readonly PipeService[]): number {
  let h = 6;
  h += kinds.length * LEGEND_ROW;
  if (services.length) h += 5 + services.length * LEGEND_LINE_ROW;
  return h + 4;
}

/** Grobe Vorabprüfung für `fitsOnSheet`: bliebe neben der Legende noch Platz? */
function legendFitsBeside(components: readonly SchematicComponent[], frame: SheetLayout['frame']): boolean {
  const kinds = usedKinds(components);
  if (!kinds.length) return false;
  if (frame.w - LEGEND_W - LEGEND_GAP < frame.w * 0.5) return false;
  return legendHeight(kinds, []) <= frame.h;
}

/**
 * Legendenblock: Symbol, Name, darunter die Leitungsarten.
 *
 * Gezeichnet wird das *echte* Symbol, nicht ein Ersatzbild — eine Legende,
 * die anders aussieht als die Zeichnung, ist schlimmer als keine.
 */
function legendBlock(
  kinds: readonly SchematicKind[],
  services: readonly PipeService[],
  x: number,
  y: number,
  w: number,
  options: SchematicPrintOptions,
): { svg: string; height: number } {
  const parts: string[] = [];
  const recorder = new SvgRecorder();
  const ctx = asContext(recorder);
  const size = 5.2;
  let cy = y + 6;

  parts.push(
    `<text x="${n(x)}" y="${n(y + 3.4)}" font-size="${n(FONT_SMALL + 0.2)}" font-weight="600" fill="${INK}">Legende</text>`,
  );

  for (const kind of kinds) {
    // Der Symbolmittelpunkt sitzt in einer festen Spalte, damit die Namen
    // untereinander stehen, auch wenn die Symbole verschieden breit sind.
    drawSymbol(ctx, kind, x + 7, cy + LEGEND_ROW / 2 - 1, size, {
      color: INK,
      background: '#FFFFFF',
      label: null,
      spec: null,
      lineWidth: SYMBOL_LINE,
    });
    parts.push(
      `<text x="${n(x + 16)}" y="${n(cy + LEGEND_ROW / 2)}" font-size="${n(FONT_SMALL)}" fill="${RULE}">${escapeXml(
        SCHEMATIC_LEGEND[kind].name,
      )}</text>`,
    );
    cy += LEGEND_ROW;
  }

  if (services.length) {
    cy += 3;
    parts.push(
      `<text x="${n(x)}" y="${n(cy)}" font-size="${n(FONT_SMALL)}" font-weight="600" fill="${INK}">Leitungsarten</text>`,
    );
    cy += 3.5;
    for (const service of services) {
      const dash = SERVICE_DASH[service];
      const colour = pipeColour(service, options);
      const text = options.colour
        ? PIPE_SERVICE_LABELS[service]
        : `${PIPE_SERVICE_LABELS[service]} (${SERVICE_DASH_NAMES[service]})`;
      parts.push(
        `<line x1="${n(x)}" y1="${n(cy)}" x2="${n(x + 13)}" y2="${n(cy)}" stroke="${colour}" ` +
          `stroke-width="${n(PIPE_LINE)}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`,
        `<text x="${n(x + 16)}" y="${n(cy + 0.7)}" font-size="${n(FONT_CAPTION)}" fill="${RULE}">${escapeXml(text)}</text>`,
      );
      cy += LEGEND_LINE_ROW;
    }
  }

  const height = cy - y + 2;
  const box =
    `<rect x="${n(x - 2)}" y="${n(y - 2)}" width="${n(w)}" height="${n(height + 2)}" fill="#FFFFFF" ` +
    `fill-opacity="0.92" stroke="#CBD5E1" stroke-width="0.15"/>`;

  return { svg: box + recorder.finish() + parts.join(''), height };
}

// ---------------------------------------------------------------------------
// Leitungen
// ---------------------------------------------------------------------------

/** Strichfarbe einer Leitung — schwarz im Schwarzweißdruck. */
function pipeColour(service: PipeService, options: SchematicPrintOptions): string {
  if (!options.colour) return INK;
  const base = PIPE_SERVICE_COLORS[service];
  return options.darkenColours === false ? base : darkenForPrint(base, 0.3);
}

/** Ein Stück gerade aus dem Stutzen heraus, damit die Ecke nicht am Symbol klebt. */
function offsetBySide(p: { port: { side: string }; x: number; y: number }, lead: number): { x: number; y: number } {
  switch (p.port.side) {
    case 'left':
      return { x: p.x - lead, y: p.y };
    case 'right':
      return { x: p.x + lead, y: p.y };
    case 'top':
      return { x: p.x, y: p.y - lead };
    default:
      return { x: p.x, y: p.y + lead };
  }
}

/**
 * Rechtwinklige Führung durch eine Punktfolge.
 *
 * Zwischen zwei Punkten, die weder auf einer Waagerechten noch auf einer
 * Senkrechten liegen, wird ein Eckpunkt eingeschoben. Die Richtung wechselt
 * dabei ab — läuft die Leitung waagerecht an, knickt sie erst am Ziel nach
 * oben oder unten ab. Das ergibt das übliche Treppenbild eines Fließbildes
 * statt einer Diagonalen.
 */
function orthogonalise(points: readonly { x: number; y: number }[], horizontalFirst: boolean): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  let horizontal = horizontalFirst;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (!out.length) {
      out.push(p);
      continue;
    }
    const prev = out[out.length - 1];
    const dx = Math.abs(p.x - prev.x);
    const dy = Math.abs(p.y - prev.y);
    if (dx > 1e-6 && dy > 1e-6) {
      out.push(horizontal ? { x: p.x, y: prev.y } : { x: prev.x, y: p.y });
      horizontal = !horizontal;
    } else if (dx > 1e-6) {
      horizontal = false;
    } else if (dy > 1e-6) {
      horizontal = true;
    }
    out.push(p);
  }
  return out;
}

/** Die längste Teilstrecke — dort ist Platz für Pfeil und Beschriftung. */
function longestSegment(points: readonly { x: number; y: number }[]): {
  mid: { x: number; y: number };
  angle: number;
  length: number;
} {
  let best = { mid: points[0] ?? { x: 0, y: 0 }, angle: 0, length: -1 };
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length > best.length) {
      best = { mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, angle: Math.atan2(b.y - a.y, b.x - a.x), length };
    }
  }
  return best;
}

function linkSvg(
  a: SchematicComponent,
  b: SchematicComponent,
  link: SchematicLink,
  X: (gx: number) => number,
  Y: (gy: number) => number,
  pitch: number,
  options: SchematicPrintOptions,
): string {
  const size = pitch * SYMBOL_RATIO;
  const from = symbolPortPoints(a.kind, X(a.x), Y(a.y), size);
  const to = symbolPortPoints(b.kind, X(b.x), Y(b.y), size);
  if (!from.length || !to.length) return '';

  // Angeschlossen wird an den Stutzen, die die Verbindung nennt. Erst wenn
  // sie keine nennt, gilt die Nähe — siehe `pickPortPair`.
  const paar = pickPortPair(from, to, link);
  if (!paar) return '';

  const lead = size * 0.36;
  const p = paar.p;
  const q = paar.q;
  const horizontalFirst = p.port.side === 'left' || p.port.side === 'right';
  const waypoints = (link.waypoints ?? []).map((w) => ({ x: X(w.x), y: Y(w.y) }));
  const route = orthogonalise(
    [{ x: p.x, y: p.y }, offsetBySide(p, lead), ...waypoints, offsetBySide(q, lead), { x: q.x, y: q.y }],
    horizontalFirst,
  );

  const colour = pipeColour(link.service, options);
  const dash = SERVICE_DASH[link.service];
  const d = route.map((pt, i) => `${i ? 'L' : 'M'}${n(pt.x)} ${n(pt.y)}`).join(' ');

  const parts = [
    `<path d="${d}" fill="none" stroke="${colour}" stroke-width="${n(PIPE_LINE)}" stroke-linejoin="round" ` +
      `stroke-linecap="round"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`,
  ];

  // Fließrichtung. Ohne Pfeil ist ein Schema mehrdeutig: Vorlauf und
  // Rücklauf sehen gleich aus, und wer die Anlage füllt, muss wissen, wohin
  // das Wasser läuft.
  const seg = longestSegment(route);
  if (seg.length > 4) {
    const head = Math.max(1.4, size * 0.16);
    const tip = { x: seg.mid.x + Math.cos(seg.angle) * head * 0.5, y: seg.mid.y + Math.sin(seg.angle) * head * 0.5 };
    const wing = (sign: number) => ({
      x: tip.x + Math.cos(seg.angle + sign * 2.6) * head,
      y: tip.y + Math.sin(seg.angle + sign * 2.6) * head,
    });
    const w1 = wing(1);
    const w2 = wing(-1);
    parts.push(
      `<path d="M${n(w1.x)} ${n(w1.y)} L${n(tip.x)} ${n(tip.y)} L${n(w2.x)} ${n(w2.y)} Z" fill="${colour}" stroke="none"/>`,
    );
  }

  if (options.showLinkLabels !== false && link.label) {
    // Beschriftung auf einem weißen Feld, sonst kreuzt der Strich die Schrift.
    const w = textWidth(link.label, FONT_CAPTION) + 1.2;
    const ly = seg.mid.y - 1.4;
    parts.push(
      `<rect x="${n(seg.mid.x - w / 2)}" y="${n(ly - FONT_CAPTION)}" width="${n(w)}" height="${n(FONT_CAPTION + 1)}" ` +
        `fill="#FFFFFF" fill-opacity="0.9" stroke="none"/>`,
      `<text x="${n(seg.mid.x)}" y="${n(ly)}" font-size="${n(FONT_CAPTION)}" text-anchor="middle" fill="${RULE}">${escapeXml(
        link.label,
      )}</text>`,
    );
  }

  return parts.join('');
}

// ---------------------------------------------------------------------------
// Rahmen und Schriftfeld
// ---------------------------------------------------------------------------

function frameSvg(layout: SheetLayout): string {
  const { frame } = layout;
  return (
    `<rect x="${n(frame.x)}" y="${n(frame.y)}" width="${n(frame.w)}" height="${n(frame.h)}" fill="none" ` +
    `stroke="${INK}" stroke-width="${n(FRAME_LINE)}"/>`
  );
}

/**
 * Schriftfeld unten rechts.
 *
 * Aufgebaut wie beim Planausdruck — Projekt und Anlage links, Maßstab, Blatt
 * und Datum in einer Zeile, Ersteller darunter. Die letzte Zeile ist der
 * Vorbehalt: ein Prinzipschema zeigt die Wirkzusammenhänge, nicht die
 * Ausführung. Wer danach baut, ohne die Ausführungsplanung zu haben, baut auf
 * eigene Rechnung.
 */
function titleBlockSvg(
  layout: SheetLayout,
  options: SchematicPrintOptions,
  scale: number,
  sheetLabel: string,
): string {
  const { sheet, margin, frame } = layout;
  const w = Math.min(TITLE_W, frame.w);
  const x = frame.x + frame.w - w;
  const y = sheet.h - margin.bottom + 3;
  const orientation = options.orientation === 'landscape' ? 'quer' : 'hoch';
  const col = w / 3;

  const caption = (cx: number, cy: number, text: string) =>
    `<text x="${n(cx)}" y="${n(cy)}" font-size="${n(FONT_CAPTION - 0.2)}" fill="${FAINT}">${escapeXml(text)}</text>`;
  const value = (cx: number, cy: number, text: string, bold = false) =>
    `<text x="${n(cx)}" y="${n(cy)}" font-size="${n(FONT_SMALL + 0.2)}"${bold ? ' font-weight="600"' : ''} fill="${INK}">${escapeXml(
      text,
    )}</text>`;

  return (
    `<g>` +
    `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(TITLE_H)}" fill="#FFFFFF" stroke="${INK}" stroke-width="${n(FRAME_LINE)}"/>` +
    `<line x1="${n(x)}" y1="${n(y + 9)}" x2="${n(x + w)}" y2="${n(y + 9)}" stroke="${RULE}" stroke-width="0.15"/>` +
    `<line x1="${n(x)}" y1="${n(y + 16)}" x2="${n(x + w)}" y2="${n(y + 16)}" stroke="${RULE}" stroke-width="0.15"/>` +
    `<line x1="${n(x)}" y1="${n(y + 23)}" x2="${n(x + w)}" y2="${n(y + 23)}" stroke="${RULE}" stroke-width="0.15"/>` +
    `<line x1="${n(x + col)}" y1="${n(y + 16)}" x2="${n(x + col)}" y2="${n(y + 23)}" stroke="${RULE}" stroke-width="0.15"/>` +
    `<line x1="${n(x + col * 2)}" y1="${n(y + 16)}" x2="${n(x + col * 2)}" y2="${n(y + 23)}" stroke="${RULE}" stroke-width="0.15"/>` +
    caption(x + 2, y + 3, 'Projekt') +
    `<text x="${n(x + 2)}" y="${n(y + 7.6)}" font-size="${n(FONT_TITLE)}" font-weight="600" fill="${INK}">${escapeXml(
      options.projectName,
    )}</text>` +
    caption(x + 2, y + 12, 'Anlage') +
    value(x + 2, y + 15.2, options.plantName) +
    caption(x + 2, y + 19, 'Maßstab') +
    value(x + 2, y + 22.2, `M 1:${scale}`, true) +
    caption(x + col + 2, y + 19, 'Blatt') +
    value(x + col + 2, y + 22.2, `${options.format} ${orientation}${sheetLabel ? ` · ${sheetLabel}` : ''}`) +
    caption(x + col * 2 + 2, y + 19, 'Datum') +
    value(x + col * 2 + 2, y + 22.2, options.date) +
    caption(x + 2, y + 26, 'Ersteller') +
    value(x + 2, y + 29, options.author) +
    `<text x="${n(x + w - 2)}" y="${n(y + 29)}" font-size="${n(FONT_CAPTION)}" text-anchor="end" fill="${FAINT}">Prinzipschema – kein Ausführungsplan</text>` +
    `</g>`
  );
}

/** Blattgerüst: weißes Papier, Rahmen, Schriftfeld — der Inhalt kommt dazwischen. */
function sheetSvg(layout: SheetLayout, body: string, options: SchematicPrintOptions, scale: number, label: string): string {
  const { sheet } = layout;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(sheet.w)}mm" height="${n(sheet.h)}mm" ` +
    `viewBox="0 0 ${n(sheet.w)} ${n(sheet.h)}" font-family="Inter, Segoe UI, system-ui, sans-serif">` +
    `<rect x="0" y="0" width="${n(sheet.w)}" height="${n(sheet.h)}" fill="#FFFFFF"/>` +
    frameSvg(layout) +
    body +
    titleBlockSvg(layout, options, scale, label) +
    `</svg>`
  );
}

// ---------------------------------------------------------------------------
// Stückliste
// ---------------------------------------------------------------------------

/**
 * Bauteile zu Positionen zusammenfassen.
 *
 * Zusammengezählt wird nach Bauteilart *und* technischer Angabe: zwei
 * Absperrungen DN 25 sind eine Position, eine DN 25 und eine DN 32 sind
 * zwei — wer bestellt, braucht die Trennung. Die Anlagenkennzeichen bleiben
 * einzeln erhalten, damit sich jede Position im Schema wiederfinden lässt.
 *
 * Bewusst eine Datenstruktur und kein SVG: dieselbe Liste geht als Tabelle
 * aufs Blatt, als CSV in die Kalkulation und als JSON in den Export.
 */
export function buildComponentTable(components: readonly SchematicComponent[]): ComponentTableRow[] {
  const order = Object.keys(SCHEMATIC_LEGEND) as SchematicKind[];
  const groups = new Map<string, ComponentTableRow>();

  for (const c of components) {
    const spec = c.spec ?? '';
    // Der Schlüssel ist eindeutig, weil eine SchematicKind niemals einen
    // senkrechten Strich enthält — sie sind durchgehend kebab-case.
    const key = `${c.kind}|${spec}`;
    const found = groups.get(key);
    if (found) {
      found.count++;
      if (c.label) found.labels.push(c.label);
      found.componentIds.push(c.id);
      continue;
    }
    groups.set(key, {
      position: 0,
      count: 1,
      kind: c.kind,
      name: SCHEMATIC_LEGEND[c.kind].name,
      labels: c.label ? [c.label] : [],
      spec,
      componentIds: [c.id],
    });
  }

  const rows = [...groups.values()].sort(
    (a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.spec.localeCompare(b.spec, 'de'),
  );
  rows.forEach((row, i) => {
    row.position = i + 1;
  });
  return rows;
}

/**
 * Stückliste als CSV. Semikolon als Trenner und BOM-freies UTF-8, weil das
 * deutsche Excel Kommas als Dezimaltrenner liest und an einer
 * Komma-getrennten Datei scheitert.
 */
export function componentTableCsv(rows: readonly ComponentTableRow[]): string {
  const cell = (v: string): string => (/[";\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = ['Pos;Anzahl;Bezeichnung;Technische Angabe;Anlagenkennzeichen'];
  for (const r of rows) {
    lines.push(
      [String(r.position), String(r.count), cell(r.name), cell(r.spec), cell(r.labels.join(', '))].join(';'),
    );
  }
  return lines.join('\r\n');
}

/** Die Stückliste als Blatt — eine Tabelle, notfalls über mehrere Blätter. */
function componentTableSheets(
  rows: readonly ComponentTableRow[],
  layout: SheetLayout,
  options: SchematicPrintOptions,
  scale: number,
  firstSheetNumber: number,
  sheetCount: number,
): string[] {
  if (!rows.length) return [];
  const { frame } = layout;
  const rowH = 5.5;
  const perSheet = Math.max(1, Math.floor((frame.h - 12) / rowH));
  const columns = [0, 12, 26, frame.w * 0.62, frame.w - 2];
  const sheets: string[] = [];

  for (let start = 0, page = 0; start < rows.length; start += perSheet, page++) {
    const slice = rows.slice(start, start + perSheet);
    const parts: string[] = [
      `<text x="${n(frame.x)}" y="${n(frame.y + 5)}" font-size="${n(FONT_SMALL + 0.6)}" font-weight="600" fill="${INK}">Stückliste</text>`,
      `<line x1="${n(frame.x)}" y1="${n(frame.y + 8)}" x2="${n(frame.x + frame.w)}" y2="${n(frame.y + 8)}" stroke="${INK}" stroke-width="0.25"/>`,
    ];
    const head = ['Pos', 'Anzahl', 'Bezeichnung', 'Technische Angabe', 'Anlagenkennzeichen'];
    head.forEach((text, i) => {
      parts.push(
        `<text x="${n(frame.x + columns[i])}" y="${n(frame.y + 6.6)}" font-size="${n(FONT_CAPTION)}" fill="${FAINT}">${escapeXml(
          text,
        )}</text>`,
      );
    });

    slice.forEach((row, i) => {
      const y = frame.y + 13 + i * rowH;
      const cells = [
        String(row.position),
        String(row.count),
        row.name,
        row.spec || '–',
        row.labels.join(', ') || '–',
      ];
      cells.forEach((text, c) => {
        parts.push(
          `<text x="${n(frame.x + columns[c])}" y="${n(y)}" font-size="${n(FONT_SMALL)}" fill="${INK}">${escapeXml(
            text,
          )}</text>`,
        );
      });
      parts.push(
        `<line x1="${n(frame.x)}" y1="${n(y + 1.6)}" x2="${n(frame.x + frame.w)}" y2="${n(y + 1.6)}" stroke="#E2E8F0" stroke-width="0.1"/>`,
      );
    });

    sheets.push(sheetSvg(layout, parts.join(''), options, scale, `Blatt ${firstSheetNumber + page}/${sheetCount}`));
  }
  return sheets;
}

/** Die Legende auf einem eigenen Blatt, in so vielen Spalten, wie hineinpassen. */
function legendSheet(
  kinds: readonly SchematicKind[],
  services: readonly PipeService[],
  layout: SheetLayout,
  options: SchematicPrintOptions,
  scale: number,
  label: string,
): string {
  const { frame } = layout;
  const perColumn = Math.max(1, Math.floor((frame.h - 12) / LEGEND_ROW));
  const columnW = LEGEND_W + 4;
  const parts: string[] = [];

  for (let start = 0, col = 0; start < kinds.length; start += perColumn, col++) {
    const x = frame.x + 2 + col * columnW;
    if (x + LEGEND_W > frame.x + frame.w) break;
    const slice = kinds.slice(start, start + perColumn);
    // Die Leitungsarten hängen an der letzten Spalte, damit sie nicht in der
    // Mitte des Blattes stehen.
    const withServices = start + perColumn >= kinds.length ? services : [];
    parts.push(legendBlock(slice, withServices, x, frame.y + 4, LEGEND_W, options).svg);
  }

  return sheetSvg(layout, parts.join(''), options, scale, label);
}

// ---------------------------------------------------------------------------
// Hauptfunktion
// ---------------------------------------------------------------------------

/**
 * Das Anlagenschema als vollständiges SVG in Millimetern.
 *
 * Reihenfolge auf dem Blatt: erst die Leitungen, dann die Symbole. Die
 * Symbole stellen ihren Untergrund weiß frei — eine durchlaufende Leitung
 * scheint dadurch nicht durch das Manometer hindurch. Umgekehrt wäre die
 * Zeichnung an jedem Bauteil zerhackt.
 */
export function buildSchematicSvg(
  components: readonly SchematicComponent[],
  links: readonly SchematicLink[],
  options: SchematicPrintOptions,
): SchematicPrintResult {
  const layout = resolveLayout(options);
  const notes: string[] = [];
  const showLabels = options.showLabels !== false;

  const kinds = usedKinds(components);
  const services = usedServices(links);
  const wantLegend = options.showLegend && (kinds.length > 0 || services.length > 0);
  const neededLegendHeight = legendHeight(kinds, services);
  const legendInline =
    wantLegend &&
    neededLegendHeight <= layout.frame.h &&
    layout.frame.w - LEGEND_W - LEGEND_GAP >= layout.frame.w * 0.5;
  const legendOnOwnSheet = wantLegend && !legendInline;
  if (legendOnOwnSheet) {
    notes.push('Die Legende passt neben dem Schema nicht auf das Blatt und steht deshalb auf einem eigenen Blatt.');
  }

  const area = contentFrame(layout.frame, legendInline);

  // --- Maßstab -------------------------------------------------------------
  const suggestedScale =
    SCALE_STEPS.find((s) => {
      const box = measureContent(components, pitchOf(s), showLabels);
      return box.w <= area.w && box.h <= area.h;
    }) ?? SCALE_STEPS[SCALE_STEPS.length - 1];

  const scale = options.scale === 'auto' ? suggestedScale : options.scale;
  const pitch = pitchOf(scale);
  const box = measureContent(components, pitch, showLabels);
  const fits = box.w <= area.w && box.h <= area.h;
  if (!fits) {
    notes.push(`Das Schema ist in M 1:${scale} größer als das Zeichenfeld; es passt ab M 1:${suggestedScale}.`);
  }
  if (pitch * SYMBOL_RATIO < 7) {
    // Deutsche Schreibweise: auf einem deutschen Blatt ist „2.3 mm" kein
    // Maß, sondern ein Tippfehler mit Bedeutung.
    notes.push(
      `Bei M 1:${scale} ist ein Symbol nur ${(pitch * SYMBOL_RATIO).toLocaleString('de-DE', { maximumFractionDigits: 1 })} mm groß und kaum noch lesbar.`,
    );
  }

  // Zentriert einsetzen. Anders als im Grundriss zeigt die y-Achse des
  // Schemas schon nach unten — der Rasterplatz ist eine Bildkoordinate, kein
  // Ort im Gebäude, deshalb wird hier nichts gespiegelt.
  const offsetX = area.x + (area.w - box.w) / 2 - box.minX;
  const offsetY = area.y + (area.h - box.h) / 2 - box.minY;
  const X = (gx: number) => offsetX + gx * pitch;
  const Y = (gy: number) => offsetY + gy * pitch;

  const byId = new Map(components.map((c) => [c.id, c]));
  const parts: string[] = [];

  // --- Leitungen -----------------------------------------------------------
  for (const link of links) {
    const a = byId.get(link.from);
    const b = byId.get(link.to);
    if (!a || !b) continue;
    parts.push(linkSvg(a, b, link, X, Y, pitch, options));
  }

  // --- Symbole -------------------------------------------------------------
  const recorder = new SvgRecorder();
  const ctx = asContext(recorder);
  for (const c of components) {
    drawSymbol(ctx, c.kind, X(c.x), Y(c.y), pitch * SYMBOL_RATIO, {
      color: INK,
      background: '#FFFFFF',
      label: showLabels ? c.label : null,
      spec: showLabels ? (c.spec ?? null) : null,
      // Strichstärke und Schriftgröße sind hier Millimeter, keine Pixel —
      // ohne die Vorgabe würde `drawSymbol` seine Bildschirmwerte einsetzen
      // und das Symbol wäre auf dem Blatt fingerdick beschriftet.
      lineWidth: SYMBOL_LINE,
      fontSize: FONT_LABEL,
    });
  }
  parts.push(recorder.finish());

  // --- Legendenspalte ------------------------------------------------------
  if (legendInline) {
    parts.push(
      legendBlock(kinds, services, layout.frame.x + layout.frame.w - LEGEND_W + 2, layout.frame.y + 4, LEGEND_W, options)
        .svg,
    );
  }

  // --- Maßstabsleiste ------------------------------------------------------
  // Das Prüfmaß: wer nachmisst, sieht, ob der Drucker skaliert hat. Bezug ist
  // die Vereinbarung „ein Rasterschritt = 1,00 m".
  parts.push(drawableScaleBar(layout.margin.left, layout.sheet.h - layout.margin.bottom + 8, scale));
  parts.push(
    `<text x="${n(layout.margin.left)}" y="${n(layout.sheet.h - layout.margin.bottom + 18)}" font-size="${n(
      FONT_CAPTION,
    )}" fill="${FAINT}">Prüfmaß · 1 Rasterschritt = 1,00 m Bezugsmaß</text>`,
  );

  // --- Blätter zusammenstellen ---------------------------------------------
  const tableRows = options.componentTable ? buildComponentTable(components) : [];
  const tableSheetCount = tableRows.length
    ? Math.max(1, Math.ceil(tableRows.length / Math.max(1, Math.floor((layout.frame.h - 12) / 5.5))))
    : 0;
  const total = 1 + (legendOnOwnSheet ? 1 : 0) + tableSheetCount;
  const label = (index: number) => (total > 1 ? `Blatt ${index}/${total}` : '');

  const sheets = [sheetSvg(layout, parts.join(''), options, scale, label(1))];
  if (legendOnOwnSheet) {
    sheets.push(legendSheet(kinds, services, layout, options, scale, label(2)));
  }
  if (tableRows.length) {
    sheets.push(...componentTableSheets(tableRows, layout, options, scale, sheets.length + 1, total));
  }

  return {
    svg: sheets[0],
    sheets,
    scale,
    fits,
    suggestedScale,
    sheet: layout.sheet,
    legendOnOwnSheet,
    notes,
  };
}

/**
 * Die Blätter im Druckdialog des Browsers öffnen.
 *
 * Dieselbe Bequemlichkeitsfunktion wie `printPlan` in `planPrint.ts` und die
 * einzige Stelle dieses Moduls, die `window` anfasst — sie steht bewusst am
 * Ende, damit der Rest der Datei ohne Browser läuft.
 *
 * Mehrere Blätter kommen untereinander in dasselbe Dokument; der
 * Seitenumbruch entsteht über `page-break-after`, damit die Vorschau des
 * Browsers sie einzeln zeigt.
 */
export function printSchematic(result: SchematicPrintResult, title = 'Anlagenschema'): boolean {
  const size = `${result.sheet.w}mm ${result.sheet.h}mm`;
  const sheets = result.sheets
    .map((svg, i) => `<div class="blatt"${i === result.sheets.length - 1 ? ' style="page-break-after:auto"' : ''}>${svg}</div>`)
    .join('');
  return druckeDokument(
    `<!doctype html><html lang="de"><head><meta charset="utf-8">` +
      `<style>@page{size:${size};margin:0}html,body{margin:0;padding:0;background:#fff}` +
      `.blatt{page-break-after:always}svg{display:block}` +
      `@media screen{body{padding:16px;background:#334155}svg{box-shadow:0 8px 40px rgba(0,0,0,.4);margin:0 auto 16px}}</style>` +
      `</head><body>${sheets}</body></html>`,
    `${title} M 1:${result.scale}`,
  );
}
