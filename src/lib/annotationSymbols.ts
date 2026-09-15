/**
 * Planbeschriftung: freie Maßketten, Texte und Hinweisfahnen.
 * ---------------------------------------------------------------------------
 * Die automatischen Wandmaße nehmen einem die Fleißarbeit ab, aber sie
 * beantworten nicht jede Frage: der Abstand zweier Fenster, die lichte Weite
 * einer Nische, die Achse eines Schachts. Dafür braucht es Maße, die jemand
 * bewusst setzt — und die stehen bleiben, wo sie gesetzt wurden.
 *
 * Alle drei Arten liegen in derselben Entität, weil sie dieselbe Rolle haben:
 * Grafik auf dem Plan, ohne Wirkung auf die Berechnung.
 */

import type { Annotation, Vec2 } from '../types/bim';
import { planText } from './beschriftung3d';

export const ANNOTATION_COLORS = {
  line: '#94A3B8',
  text: '#CBD5E1',
  active: '#38BDF8',
};

/** Länge einer Maßkette [m] — der gemessene Wert. */
export function annotationLength(note: Annotation): number {
  if (note.points.length < 2) return 0;
  const a = note.points[0];
  const b = note.points[1];
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Beschriftungstext: eigener Text, sonst das gemessene Maß in Millimetern. */
export function annotationText(note: Annotation): string {
  if (note.text) return note.text;
  if (note.kind === 'dimension') return annotationLength(note).toFixed(3);
  return '';
}

/**
 * Der Text, der im **Grundriss** an einer Beschriftung steht.
 *
 * **Warum es dafür eine eigene Funktion braucht.** Seit dem Beschriften in
 * der begehbaren Ansicht kann eine Fahne eine Höhe über Fertigfußboden
 * tragen (`Annotation.elevation`). Diese Höhe ist ausdrücklich Teil der
 * Planaussage — „2000 W" allein sagt nicht, ob der Heizkörper über oder
 * unter der Fensterbank sitzt. `planText` aus `beschriftung3d` hängt sie an,
 * und genau dieser Text muss im Plan stehen; stünde dort weiterhin
 * `note.text`, läse man im Grundriss etwas anderes, als man in 3D gesetzt
 * hat, und zwar ohne jeden Hinweis darauf.
 *
 * **Warum die Maßkette ausgenommen ist.** Eine Maßkette ohne eigenen Text
 * zeigt das *gemessene* Maß; `planText` kennt dieses Maß nicht und gäbe für
 * sie nur den (leeren) freien Text zurück — bei gesetzter Höhe also allein
 * „+0,85 m" an der Stelle, an der die Länge stehen muss. Und selbst mit
 * eigenem Text wäre „2,450 · +0,85 m" auf einer Maßlinie kein Höhenhinweis
 * mehr, sondern läse sich wie ein zweites Maß. Deshalb bleibt die Maßkette
 * bei `annotationText`.
 *
 * **Warum einzeilig und nicht Höhe klein darunter.** Die Höhe steht so
 * überall gleich: in der Auswahlliste beim Setzen, im Massenauszug und hier
 * im Plan — dieselbe Zeichenkette aus derselben Funktion. Zwei Zeilen wären
 * hübscher, bedeuteten aber eine zweite Formatierung derselben Angabe, und
 * genau daran laufen Plan und Modell erfahrungsgemäß auseinander.
 *
 * Die Platzhalter („Text", „Hinweis") bleiben erhalten: eine Beschriftung,
 * die gerade erst gesetzt und noch nicht getippt wurde, muss sichtbar sein,
 * sonst sucht man auf dem Plan nach etwas Unsichtbarem.
 */
export function planbeschriftungsText(note: Annotation): string {
  if (note.kind === 'dimension') return annotationText(note);
  const text = planText(note);
  if (text) return text;
  return note.kind === 'leader' ? 'Hinweis' : 'Text';
}

/**
 * Die versetzte Maßlinie. Der Versatz steht senkrecht auf der Messrichtung,
 * damit sich die Kette vom bemaßten Bauteil wegziehen lässt, ohne dass die
 * Maßhilfslinien schief werden.
 */
export function dimensionLine(note: Annotation): { a: Vec2; b: Vec2; normal: Vec2 } | null {
  if (note.points.length < 2) return null;
  const a = note.points[0];
  const b = note.points[1];
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 1e-6) return null;
  const dir = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  const normal = { x: -dir.y, y: dir.x };
  return {
    a: { x: a.x + normal.x * note.offset, y: a.y + normal.y * note.offset },
    b: { x: b.x + normal.x * note.offset, y: b.y + normal.y * note.offset },
    normal,
  };
}

export function drawAnnotation(
  ctx: CanvasRenderingContext2D,
  note: Annotation,
  sx: (x: number) => number,
  sy: (y: number) => number,
  state: { selected: boolean },
): void {
  const colour = state.selected ? ANNOTATION_COLORS.active : ANNOTATION_COLORS.line;
  const textColour = state.selected ? ANNOTATION_COLORS.active : ANNOTATION_COLORS.text;
  const size = 10 * note.scale;

  ctx.save();
  ctx.strokeStyle = colour;
  ctx.fillStyle = textColour;
  ctx.lineWidth = state.selected ? 1.6 : 1.1;
  ctx.font = `${size}px ui-monospace, monospace`;

  if (note.kind === 'text') {
    const p = note.points[0];
    const label = planbeschriftungsText(note);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const w = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(11,17,32,0.72)';
    ctx.fillRect(sx(p.x) - 4, sy(p.y) - size / 2 - 3, w + 8, size + 6);
    ctx.fillStyle = textColour;
    ctx.fillText(label, sx(p.x), sy(p.y));
    if (state.selected) {
      ctx.beginPath();
      ctx.arc(sx(p.x), sy(p.y), 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    return;
  }

  if (note.kind === 'leader') {
    const tip = note.points[0];
    const anchor = note.points[1];
    ctx.beginPath();
    ctx.moveTo(sx(tip.x), sy(tip.y));
    ctx.lineTo(sx(anchor.x), sy(anchor.y));
    // Waagerechte Fahne unter dem Text — so liest sich der Hinweis auch,
    // wenn die Zugrichtung schräg verläuft.
    const flagDir = anchor.x >= tip.x ? 1 : -1;
    const flagEnd = { x: sx(anchor.x) + flagDir * 26, y: sy(anchor.y) };
    ctx.lineTo(flagEnd.x, flagEnd.y);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(sx(tip.x), sy(tip.y), 2.6, 0, Math.PI * 2);
    ctx.fillStyle = colour;
    ctx.fill();

    const label = planbeschriftungsText(note);
    ctx.fillStyle = textColour;
    ctx.textAlign = flagDir > 0 ? 'left' : 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText(label, flagEnd.x - flagDir * 24, flagEnd.y - 3);
    ctx.restore();
    return;
  }

  // --- Maßkette ------------------------------------------------------------
  const line = dimensionLine(note);
  if (!line) {
    ctx.restore();
    return;
  }
  const a = note.points[0];
  const b = note.points[1];

  // Maßhilfslinien vom Bezugspunkt zur versetzten Maßlinie, mit dem üblichen
  // kleinen Überstand.
  const over = 0.06;
  for (const [from, to] of [
    [a, line.a],
    [b, line.b],
  ] as [Vec2, Vec2][]) {
    ctx.beginPath();
    ctx.globalAlpha = 0.6;
    ctx.moveTo(sx(from.x), sy(from.y));
    ctx.lineTo(sx(to.x + line.normal.x * over), sy(to.y + line.normal.y * over));
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  ctx.beginPath();
  ctx.moveTo(sx(line.a.x), sy(line.a.y));
  ctx.lineTo(sx(line.b.x), sy(line.b.y));
  ctx.stroke();

  // 45°-Begrenzungsschrägen statt Pfeilspitzen — die Bauzeichnungs-Konvention.
  const ax = sx(line.a.x);
  const ay = sy(line.a.y);
  const bx = sx(line.b.x);
  const by = sy(line.b.y);
  const ang = Math.atan2(by - ay, bx - ax);
  const tick = 5;
  for (const [px, py] of [
    [ax, ay],
    [bx, by],
  ]) {
    ctx.beginPath();
    ctx.moveTo(px - tick * Math.cos(ang + Math.PI / 4), py - tick * Math.sin(ang + Math.PI / 4));
    ctx.lineTo(px + tick * Math.cos(ang + Math.PI / 4), py + tick * Math.sin(ang + Math.PI / 4));
    ctx.stroke();
  }

  const label = annotationText(note);
  let textAngle = ang;
  if (textAngle > Math.PI / 2 || textAngle < -Math.PI / 2) textAngle += Math.PI;
  ctx.translate((ax + bx) / 2, (ay + by) / 2);
  ctx.rotate(textAngle);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  const w = ctx.measureText(label).width;
  ctx.fillStyle = 'rgba(11,17,32,0.8)';
  ctx.fillRect(-w / 2 - 3, -size - 4, w + 6, size + 2);
  ctx.fillStyle = textColour;
  ctx.fillText(label, 0, -3);

  ctx.restore();
}

/**
 * Breite eines Textes in Bildpunkten.
 *
 * Gemessen wird mit einem eigenen, unsichtbaren Kontext — dieselbe Schrift wie
 * beim Zeichnen, also dasselbe Ergebnis. Wo es kein DOM gibt (Prüflauf,
 * Serverdruck), greift die Näherung: bei einer Festbreitenschrift ist ein
 * Zeichen 0,6 Geviert breit, und genau die benutzen wir hier.
 */
let messkontext: CanvasRenderingContext2D | null | undefined;
export function textBreitePx(label: string, size: number): number {
  if (messkontext === undefined) {
    messkontext = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  }
  if (!messkontext) return 0.6 * size * label.length;
  messkontext.font = `${size}px ui-monospace, monospace`;
  return messkontext.measureText(label).width;
}

/**
 * Die Fläche, die eine Textbeschriftung im Plan wirklich einnimmt [m].
 *
 * **Warum das gebraucht wird.** Die Trefferprüfung maß bis 1.19.0 nur den
 * Abstand zum **Ankerpunkt**. Bei einem Text von zwanzig Zeichen sind damit
 * rund 95 % der sichtbaren Fläche tot: Man tippt auf das Wort, das man meint,
 * und trifft nichts. Mit dem Finger ist das kein Randfall, sondern der
 * Regelfall.
 *
 * Der Kasten wird in Bildpunkten aufgespannt (so wird die Schrift gezeichnet)
 * und über `zoom` in Meter zurückgerechnet. Er beginnt am Anker und läuft nach
 * rechts — genau so, wie `drawAnnotation` ihn malt.
 */
export function textKasten(
  note: Annotation,
  zoom: number,
): { x0: number; y0: number; x1: number; y1: number } | null {
  if (note.kind !== 'text') return null;
  const p = note.points[0];
  if (!p || zoom <= 0) return null;
  const size = 10 * note.scale;
  // Gemessen wird genau die Zeichenkette, die auch gezeichnet wird. Sonst
  // wäre der Trefferkasten einer in 3D gesetzten Fahne um die angehängte
  // Höhe zu kurz — man tippt auf „+0,85 m" und trifft nichts.
  const breite = (textBreitePx(planbeschriftungsText(note), size) + 8) / zoom;
  const hoehe = (size + 6) / zoom;
  return {
    x0: p.x - 4 / zoom,
    // Bildschirm-y wächst nach unten, Welt-y nach oben: die halbe Höhe geht
    // deshalb in beide Richtungen, und der Kasten ist um den Anker zentriert.
    y0: p.y - hoehe / 2,
    x1: p.x - 4 / zoom + breite,
    y1: p.y + hoehe / 2,
  };
}

/**
 * Abstand eines Punktes zur Beschriftung [m] — für die Trefferprüfung.
 *
 * `zoom` ist freiwillig und betrifft nur den Text: ohne ihn bleibt es beim
 * alten Verhalten (Abstand zum Anker), mit ihm zählt die ganze Textfläche.
 */
export function distanceToAnnotation(note: Annotation, p: Vec2, zoom?: number): number {
  if (note.kind === 'text') {
    const kasten = zoom ? textKasten(note, zoom) : null;
    if (kasten) {
      // Abstand zum Rechteck: innerhalb null, außerhalb der Weg zur nächsten
      // Kante.
      const dx = Math.max(kasten.x0 - p.x, 0, p.x - kasten.x1);
      const dy = Math.max(kasten.y0 - p.y, 0, p.y - kasten.y1);
      return Math.hypot(dx, dy);
    }
    return Math.hypot(note.points[0].x - p.x, note.points[0].y - p.y);
  }
  const segments: [Vec2, Vec2][] = [];
  if (note.kind === 'dimension') {
    const line = dimensionLine(note);
    if (line) segments.push([line.a, line.b]);
  } else if (note.points.length >= 2) {
    segments.push([note.points[0], note.points[1]]);
  }

  let best = Infinity;
  for (const [a, b] of segments) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1e-9) continue;
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    best = Math.min(best, Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y));
  }
  return best;
}
