/**
 * Darstellung von Treppen, Schächten und Leitungen im Grundriss.
 * ---------------------------------------------------------------------------
 * Eine Treppe im Plan ist nicht einfach ein Rechteck: sie braucht die
 * Stufenlinien, die Laufrichtung und den Antritt. Erst daran erkennt man,
 * ob sie hinauf- oder hinabführt und ob sie an der richtigen Stelle beginnt.
 * Ein Schacht braucht die Schraffur, damit er nicht mit einem Raum
 * verwechselt wird. Beides ist Konvention, keine Dekoration.
 *
 * Dieselbe Datei trägt die massiven Bauteile — Kamin, Pfeiler, Wandversatz.
 * Sie gehören hierher, weil sie dasselbe Darstellungsproblem lösen: eine
 * Fläche im Grundriss, die kein Raum ist. Nur ist die Aussage die umgekehrte,
 * und deshalb ist auch das Symbol das umgekehrte: der Schacht ist leicht
 * schraffiert und offen, das massive Bauteil ist durchgehend gefüllt und
 * dicht schraffiert.
 */

import type {
  BimDocument,
  PipeAccessory,
  PipeRun,
  RoofOpening,
  SolidElement,
  Vec2,
  VerticalElement,
} from '../types/bim';
import { PIPE_SERVICE_COLORS } from '../types/bim';
import { accessorySymbol } from './pipeAccessorySymbols';
import { trassenlaenge as trassenlaengeVon } from './rohrlaenge';
import { findeBeschriftungslage, type Rechteck } from './beschriftungsLage';
import { rohrbezeichnung } from './rohrbezeichnung';

const TO_RAD = Math.PI / 180;

export const VERTICAL_COLORS = {
  stair: '#94A3B8',
  stairActive: '#38BDF8',
  shaft: '#A78BFA',
  hatch: 'rgba(148,163,184,0.35)',
};

/** Die vier Eckpunkte eines vertikalen Bauteils in Weltkoordinaten. */
export function verticalCorners(v: VerticalElement): Vec2[] {
  const a = v.rotation * TO_RAD;
  const dx = { x: Math.cos(a), y: Math.sin(a) };
  const dy = { x: -Math.sin(a), y: Math.cos(a) };
  const hl = v.length / 2;
  const hw = v.width / 2;
  return [
    { x: v.position.x - dx.x * hl - dy.x * hw, y: v.position.y - dx.y * hl - dy.y * hw },
    { x: v.position.x + dx.x * hl - dy.x * hw, y: v.position.y + dx.y * hl - dy.y * hw },
    { x: v.position.x + dx.x * hl + dy.x * hw, y: v.position.y + dx.y * hl + dy.y * hw },
    { x: v.position.x - dx.x * hl + dy.x * hw, y: v.position.y - dx.y * hl + dy.y * hw },
  ];
}

export function hitTestVertical(v: VerticalElement, p: Vec2): boolean {
  const a = -v.rotation * TO_RAD;
  const dx = p.x - v.position.x;
  const dy = p.y - v.position.y;
  const lx = dx * Math.cos(a) - dy * Math.sin(a);
  const ly = dx * Math.sin(a) + dy * Math.cos(a);
  return Math.abs(lx) <= v.length / 2 && Math.abs(ly) <= v.width / 2;
}

export function drawVertical(
  ctx: CanvasRenderingContext2D,
  v: VerticalElement,
  sx: (x: number) => number,
  sy: (y: number) => number,
  zoom: number,
  state: { selected: boolean },
): void {
  const corners = verticalCorners(v);
  const isStair = v.kind !== 'shaft';
  const colour = state.selected
    ? VERTICAL_COLORS.stairActive
    : isStair
      ? VERTICAL_COLORS.stair
      : VERTICAL_COLORS.shaft;

  ctx.save();
  ctx.lineWidth = state.selected ? 1.8 : 1.2;
  ctx.strokeStyle = colour;

  // Umriss
  ctx.beginPath();
  ctx.moveTo(sx(corners[0].x), sy(corners[0].y));
  for (let i = 1; i < 4; i++) ctx.lineTo(sx(corners[i].x), sy(corners[i].y));
  ctx.closePath();
  ctx.fillStyle = state.selected ? 'rgba(56,189,248,0.10)' : 'rgba(148,163,184,0.06)';
  ctx.fill();
  ctx.stroke();

  if (isStair) {
    drawSteps(ctx, v, corners, sx, sy, colour, zoom);
  } else {
    drawShaftHatch(ctx, corners, sx, sy, colour);
    if (zoom > 26 && v.service) {
      const label = v.service.slice(0, 1).toUpperCase();
      ctx.fillStyle = colour;
      ctx.font = '9px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, sx(v.position.x), sy(v.position.y));
    }
  }

  ctx.restore();
}

/**
 * Der Laufweg einer Treppe als Polylinie in Weltkoordinaten.
 *
 * Erst die Form macht den Unterschied im Plan: die gerade Treppe ist ein
 * Lauf, die viertelgewendelte hat einen Knick mit Podest, die halbgewendelte
 * zwei Läufe nebeneinander, die Wendeltreppe eine Spirale. Aus derselben
 * Polylinie folgen Stufenlinien, Pfeil und — über ihre Länge — der Auftritt.
 */
export function stairPath(v: VerticalElement): Vec2[] {
  const a = v.rotation * TO_RAD;
  const ex = { x: Math.cos(a), y: Math.sin(a) };
  const ey = { x: -Math.sin(a), y: Math.cos(a) };
  const L = v.length;
  const W = v.width;
  const at = (u: number, t: number): Vec2 => ({
    x: v.position.x + ex.x * (u - L / 2) + ey.x * (t - W / 2),
    y: v.position.y + ex.y * (u - L / 2) + ey.y * (t - W / 2),
  });

  switch (v.kind) {
    case 'stair-l': {
      // Ein Lauf längs, Podest in der Ecke, dann quer heraus.
      const turn = Math.min(W, L) / 2;
      return [at(0, turn), at(L - turn, turn), at(L - turn, W)];
    }
    case 'stair-u': {
      // Zwei Läufe nebeneinander, Podest am Kopfende.
      const q = W / 4;
      return [at(0, q), at(L - q, q), at(L - q, W - q), at(0, W - q)];
    }
    case 'stair-spiral': {
      // Spindel in der Mitte, Lauflinie auf halbem Radius.
      const r = Math.min(L, W) / 2;
      const pts: Vec2[] = [];
      for (let i = 0; i <= 24; i++) {
        const phi = (i / 24) * Math.PI * 1.75;
        pts.push({
          x: v.position.x + Math.cos(phi + a) * r * 0.62,
          y: v.position.y + Math.sin(phi + a) * r * 0.62,
        });
      }
      return pts;
    }
    default:
      return [at(0, W / 2), at(L, W / 2)];
  }
}

/** Gesamtlänge der Lauflinie [m] — daraus folgt der Auftritt. */
export function stairRunLength(v: VerticalElement): number {
  const path = stairPath(v);
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
  }
  return total;
}

/**
 * Stufenlinien, Lauflinie, Antritt und Austritt — in Weltkoordinaten.
 *
 * Die Aufteilung steht hier und nicht im Zeichenpfad, weil der Ausdruck
 * dieselbe Treppe zeigen muss wie der Bildschirm. Die Stufen stehen senkrecht
 * auf der Lauflinie; bei der gewendelten Treppe fächern sie dadurch am Knick
 * auf, genau wie in einer Bauzeichnung.
 */
export interface StairLayout {
  steps: { a: Vec2; b: Vec2 }[];
  /** Lauflinie, an beiden Enden um den Antritt verkürzt. */
  run: Vec2[];
  /** Antritt — die erste Stufe. */
  start: Vec2;
  /** Austritt mit Laufrichtung; dort sitzt die Pfeilspitze. */
  tip: Vec2;
  tipDir: Vec2;
}

export function stairLayout(v: VerticalElement): StairLayout | null {
  const steps = Math.max(2, v.steps ?? 15);
  const path = stairPath(v);
  const total = stairRunLength(v);
  if (total < 1e-6) return null;

  /** Punkt und Richtung auf der Lauflinie beim Abstand `d`. */
  const along = (d: number): { p: Vec2; dir: Vec2 } => {
    let rest = Math.max(0, Math.min(total, d));
    for (let i = 1; i < path.length; i++) {
      const seg = Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
      if (rest <= seg || i === path.length - 1) {
        const t = seg > 1e-9 ? rest / seg : 0;
        return {
          p: {
            x: path[i - 1].x + (path[i].x - path[i - 1].x) * t,
            y: path[i - 1].y + (path[i].y - path[i - 1].y) * t,
          },
          dir: {
            x: (path[i].x - path[i - 1].x) / (seg || 1),
            y: (path[i].y - path[i - 1].y) / (seg || 1),
          },
        };
      }
      rest -= seg;
    }
    return { p: path[path.length - 1], dir: { x: 1, y: 0 } };
  };

  const half = v.kind === 'stair-u' ? v.width / 4 : v.width / 2;

  const lines: { a: Vec2; b: Vec2 }[] = [];
  for (let i = 1; i < steps; i++) {
    const { p, dir } = along((i / steps) * total);
    const nx = -dir.y * half;
    const ny = dir.x * half;
    lines.push({ a: { x: p.x - nx, y: p.y - ny }, b: { x: p.x + nx, y: p.y + ny } });
  }

  const anfang = along(0.12);
  const run: Vec2[] = [anfang.p];
  for (let i = 1; i <= 32; i++) run.push(along(0.12 + ((total - 0.24) * i) / 32).p);
  const ende = along(total - 0.12);

  return { steps: lines, run, start: anfang.p, tip: ende.p, tipDir: ende.dir };
}

/**
 * Stufenlinien, Lauflinie und Richtungspfeil auf dem Bildschirm.
 */
function drawSteps(
  ctx: CanvasRenderingContext2D,
  v: VerticalElement,
  corners: Vec2[],
  sx: (x: number) => number,
  sy: (y: number) => number,
  colour: string,
  zoom: number,
): void {
  void corners;
  const layout = stairLayout(v);
  if (!layout) return;

  ctx.lineWidth = 0.9;
  ctx.strokeStyle = colour;
  ctx.globalAlpha = 0.75;
  for (const line of layout.steps) {
    ctx.beginPath();
    ctx.moveTo(sx(line.a.x), sy(line.a.y));
    ctx.lineTo(sx(line.b.x), sy(line.b.y));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Lauflinie
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(sx(layout.run[0].x), sy(layout.run[0].y));
  for (const p of layout.run.slice(1)) ctx.lineTo(sx(p.x), sy(p.y));
  ctx.stroke();

  // Pfeilspitze am Austritt
  const head = Math.max(6, Math.min(11, zoom * 0.16));
  const ang = Math.atan2(-layout.tipDir.y, layout.tipDir.x);
  const ex2 = sx(layout.tip.x);
  const ey2 = sy(layout.tip.y);
  ctx.beginPath();
  ctx.moveTo(ex2, ey2);
  ctx.lineTo(ex2 - head * Math.cos(ang - 0.4), ey2 - head * Math.sin(ang - 0.4));
  ctx.moveTo(ex2, ey2);
  ctx.lineTo(ex2 - head * Math.cos(ang + 0.4), ey2 - head * Math.sin(ang + 0.4));
  ctx.stroke();

  // Antritt
  ctx.beginPath();
  ctx.arc(sx(layout.start.x), sy(layout.start.y), 2.2, 0, Math.PI * 2);
  ctx.fillStyle = colour;
  ctx.fill();

  // Spindel der Wendeltreppe
  if (v.kind === 'stair-spiral') {
    const r = (Math.min(v.length, v.width) / 2) * 0.16;
    ctx.beginPath();
    ctx.arc(sx(v.position.x), sy(v.position.y), Math.max(2, r * zoom), 0, Math.PI * 2);
    ctx.strokeStyle = colour;
    ctx.lineWidth = 1.1;
    ctx.stroke();
  }
}

/** Schraffur 45° — die Konvention für einen Schacht im Grundriss. */
function drawShaftHatch(
  ctx: CanvasRenderingContext2D,
  corners: Vec2[],
  sx: (x: number) => number,
  sy: (y: number) => number,
  colour: string,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(sx(corners[0].x), sy(corners[0].y));
  for (let i = 1; i < 4; i++) ctx.lineTo(sx(corners[i].x), sy(corners[i].y));
  ctx.closePath();
  ctx.clip();

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of corners) {
    minX = Math.min(minX, sx(c.x));
    maxX = Math.max(maxX, sx(c.x));
    minY = Math.min(minY, sy(c.y));
    maxY = Math.max(maxY, sy(c.y));
  }

  ctx.strokeStyle = colour;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 0.8;
  const span = maxX - minX + (maxY - minY);
  for (let o = -span; o < span; o += 5) {
    ctx.beginPath();
    ctx.moveTo(minX + o, minY);
    ctx.lineTo(minX + o + (maxY - minY), maxY);
    ctx.stroke();
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Rohrleitungen
// ---------------------------------------------------------------------------

/**
 * Die Beschriftungskästen, die in diesem Zeichendurchgang schon stehen.
 * ---------------------------------------------------------------------------
 * `drawPipe` wird je Leitung einmal gerufen und sieht von sich aus nur die
 * eigene Trasse. Damit zwei Nennweiten nicht übereinander landen — im
 * Demomodell treffen sich am Abzweig „DN 15" und „DN 20" —, merkt sich das
 * Modul die Kästen des laufenden Durchgangs.
 *
 * **Warum das kein verstecktes Gedächtnis ist.** Der Durchgang ist ein
 * einziger synchroner Aufruf des Zeichenpfads; ein `queueMicrotask` räumt die
 * Liste, sobald dieser Aufruf zu Ende ist. Der Zustand ist damit auf genau ein
 * Bild begrenzt und kann nicht ins nächste hineinlecken — auch dann nicht,
 * wenn ein Bild abbricht oder weniger Leitungen zeichnet als das vorige.
 *
 * Der Raumstempel steht **nicht** darin: der Zeichenpfad des Editors setzt ihn
 * selbst und reicht ihn nicht durch. Wer ihn kennt — der Ausdruck tut das —,
 * gibt ihn über `state.belegt` mit; der Bildschirm verlässt sich auf die
 * Rangfolge der Kandidaten in `beschriftungsLage`.
 */
let durchgangsFelder: Rechteck[] = [];
let raeumungBestellt = false;

function merkeBeschriftung(kasten: Rechteck): void {
  durchgangsFelder.push(kasten);
  if (raeumungBestellt) return;
  raeumungBestellt = true;
  queueMicrotask(() => {
    durchgangsFelder = [];
    raeumungBestellt = false;
  });
}

/** Alles, was diese Beschriftung meiden muss: Übergebenes plus Gemerktes. */
function belegteFelder(vomAufrufer: readonly Rechteck[] | undefined): readonly Rechteck[] {
  if (!vomAufrufer || vomAufrufer.length === 0) return durchgangsFelder;
  return [...vomAufrufer, ...durchgangsFelder];
}

export function drawPipe(
  ctx: CanvasRenderingContext2D,
  run: PipeRun,
  sx: (x: number) => number,
  sy: (y: number) => number,
  zoom: number,
  state: {
    selected: boolean;
    /**
     * Flächen, die schon belegt sind — Raumstempel, Maßketten, fremde
     * Beschriftungen —, in Bildschirmkoordinaten. Der Zeichenpfad des Editors
     * kennt sie beim Aufruf noch nicht und lässt das Feld weg; der Weg steht
     * offen, sobald er sie sammelt.
     */
    belegt?: readonly Rechteck[];
  },
): void {
  if (run.points.length < 2) return;
  const colour = PIPE_SERVICE_COLORS[run.service];

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  /*
   * **Der Strang, der im Grundriss ein Punkt ist.**
   *
   * Ein Fallstrang in der Zimmerecke hat keine Trassenlänge — Anfang und
   * Ende liegen aufeinander. Gezeichnet als Linie ergäbe das nichts
   * Sichtbares: Der Plan zeigte an dieser Stelle leeren Fußboden, während
   * im Modell zweieinhalb Meter Rohr stehen, die im Massenauszug und im
   * Druckverlust auftauchen. Genau diese Lücke zwischen Plan und Liste ist
   * es, an der Bestellungen scheitern.
   *
   * Ein Strang bekommt deshalb ein eigenes Zeichen: ein Ring um den
   * Durchstoßpunkt, mit einem Pfeil nach oben oder unten für die Richtung.
   * Die Darstellung ist dieselbe Verabredung wie auf jedem Strangschema —
   * wer Pläne liest, muss dafür nichts lernen.
   */
  const dh = (run.elevationTo ?? run.elevation) - run.elevation;
  const trasse = trassenlaengeVon(run.points);
  if (Math.abs(dh) >= 0.15 && trasse < 0.2) {
    const x = sx(run.points[0].x);
    const y = sy(run.points[0].y);
    const r = Math.max(4, Math.min(10, 0.09 * zoom));
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.strokeStyle = colour;
    ctx.lineWidth = state.selected ? 2.4 : 1.6;
    ctx.setLineDash([]);
    ctx.stroke();
    // Pfeilspitze: nach oben, wenn der Strang steigt.
    const auf = dh > 0;
    ctx.beginPath();
    ctx.moveTo(x, auf ? y - r * 0.65 : y + r * 0.65);
    ctx.lineTo(x - r * 0.42, auf ? y + r * 0.25 : y - r * 0.25);
    ctx.lineTo(x + r * 0.42, auf ? y + r * 0.25 : y - r * 0.25);
    ctx.closePath();
    ctx.fillStyle = colour;
    ctx.fill();
    ctx.restore();
    return;
  }

  // Gedämmte Leitungen bekommen einen breiten, blassen Mantel — man sieht
  // auf einen Blick, was gedämmt ist und was nicht.
  if (run.insulation > 0) {
    ctx.beginPath();
    ctx.moveTo(sx(run.points[0].x), sy(run.points[0].y));
    for (let i = 1; i < run.points.length; i++) ctx.lineTo(sx(run.points[i].x), sy(run.points[i].y));
    ctx.strokeStyle = colour;
    ctx.globalAlpha = 0.18;
    ctx.lineWidth = state.selected ? 9 : 7;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  ctx.beginPath();
  ctx.moveTo(sx(run.points[0].x), sy(run.points[0].y));
  for (let i = 1; i < run.points.length; i++) ctx.lineTo(sx(run.points[i].x), sy(run.points[i].y));
  ctx.strokeStyle = colour;
  ctx.lineWidth = state.selected ? 2.6 : 1.8;
  // Rücklauf gestrichelt: Vor- und Rücklauf laufen fast immer parallel und
  // wären sonst nicht auseinanderzuhalten.
  ctx.setLineDash(run.service === 'heating-return' ? [6, 3] : []);
  ctx.stroke();
  ctx.setLineDash([]);

  // Stützpunkte
  if (state.selected) {
    for (const p of run.points) {
      ctx.beginPath();
      ctx.arc(sx(p.x), sy(p.y), 3, 0, Math.PI * 2);
      ctx.fillStyle = colour;
      ctx.fill();
    }
  }

  /*
   * Nennweite an der Trasse — **nur am Vorlauf**.
   *
   * Vor- und Rücklauf laufen fünf Zentimeter nebeneinander und tragen
   * dieselbe Nennweite. Beschriftete man beide, stünde bei jedem Abschnitt
   * „DN 20" zweimal übereinander; bei kleinem Maßstab überlagern sich die
   * beiden Kästchen zu einem unlesbaren Fleck. Der gedruckte Plan hält es seit
   * 1.8.0 genauso — das war der Bildschirm, der ihm hinterherhinkte.
   *
   * Beschriftet wird der Vorlauf, weil er durchgezogen gezeichnet ist und die
   * Beschriftung dort auf einer vollen Linie sitzt. Leitungen ohne Gegenstück
   * — Trinkwasser, Zirkulation, Lüftung, Kältemittel — tragen ihre eigene.
   *
   * **Wo sie steht, entscheidet `findeBeschriftungslage`** — dieselbe Regel,
   * die auch das Druckblatt benutzt. Vorher stand der Text starr auf der Mitte
   * des längsten Abschnitts, und genau dort saß im Demomodell der Raumstempel
   * „Schlafen / 14,77 m²". Findet die Regel keinen freien Platz, wird die
   * Nennweite **weggelassen**; sie steht vollständig in der
   * Rohrnetzberechnung. Ein Loch im Plan sieht man, einen Fleck hält man für
   * eine Angabe.
   */
  if (zoom > 24 && run.service !== 'heating-return') {
    ctx.font = '9px ui-monospace, monospace';
    const label = rohrbezeichnung(run);
    const w = ctx.measureText(label).width;
    const punkte = run.points.map((p) => ({ x: sx(p.x), y: sy(p.y) }));
    // Der Kasten ist derselbe, der gleich gezeichnet wird: 3 px Rand seitlich,
    // Oberkante 12 px über der Linie, Unterkante 1 px darüber.
    const mass = { breite: w + 6, oben: -12, unten: -1 };
    const lage = findeBeschriftungslage(punkte, mass, belegteFelder(state.belegt), {
      // 46 px ist die alte Schranke: kürzer als das trägt ein Abschnitt im
      // Bild keine Beschriftung mehr, auch wenn der Text hineinpasste.
      mindestlaenge: 46,
    });
    if (lage) {
      merkeBeschriftung(lage.belegt);
      ctx.translate(lage.x, lage.y);
      ctx.rotate(lage.winkel);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = 'rgba(11,17,32,0.8)';
      ctx.fillRect(-mass.breite / 2, mass.oben, mass.breite, mass.unten - mass.oben);
      ctx.fillStyle = colour;
      ctx.fillText(label, 0, -2.5);
    }
  }

  ctx.restore();
}

/** Abstand eines Punktes zur Polylinie [m] — für die Trefferprüfung. */
/**
 * Eine Armatur am Rohrnetz im Grundriss.
 *
 * Die Geometrie kommt aus `pipeAccessorySymbols` — derselben Quelle, aus der
 * auch der Ausdruck zeichnet. Hier bleibt nur, was den Bildschirm ausmacht:
 * Farbe, Auswahl und die Größe in Bildschirmpixeln.
 *
 * Die Symbolgröße wächst **nicht** linear mit dem Zoom: eine Armatur ist im
 * Plan ein Zeichen, kein Bauteil. Bei 0,22 m Grundgröße und einer Schranke
 * zwischen 10 und 26 Pixeln bleibt sie im ganzen sinnvollen Zoombereich
 * lesbar, ohne den Grundriss zuzudecken.
 */
export function drawPipeAccessory(
  ctx: CanvasRenderingContext2D,
  a: PipeAccessory,
  sx: (x: number) => number,
  sy: (y: number) => number,
  zoom: number,
  state: { selected?: boolean } = {},
): void {
  const groesse = Math.max(10, Math.min(26, 0.22 * zoom));
  const cx = sx(a.position.x);
  const cy = sy(a.position.y);
  const farbe = state.selected ? '#38BDF8' : ACCESSORY_COLOR[a.kind] ?? '#CBD5E1';

  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = farbe;
  ctx.fillStyle = farbe;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  for (const teil of accessorySymbol(a.kind)) {
    ctx.lineWidth = teil.weight === 'stark' ? (state.selected ? 2 : 1.4) : 1;
    if (teil.kind === 'line') {
      ctx.beginPath();
      ctx.moveTo(teil.a.x * groesse, teil.a.y * groesse);
      ctx.lineTo(teil.b.x * groesse, teil.b.y * groesse);
      ctx.stroke();
    } else if (teil.kind === 'poly') {
      ctx.beginPath();
      ctx.moveTo(teil.points[0].x * groesse, teil.points[0].y * groesse);
      for (const q of teil.points.slice(1)) ctx.lineTo(q.x * groesse, q.y * groesse);
      if (teil.closed) ctx.closePath();
      if (teil.filled) ctx.fill();
      else ctx.stroke();
    } else if (teil.kind === 'circle') {
      ctx.beginPath();
      ctx.arc(teil.c.x * groesse, teil.c.y * groesse, teil.r * groesse, 0, Math.PI * 2);
      if (teil.filled) ctx.fill();
      else ctx.stroke();
    } else {
      // Bogen: die Winkel stehen im Modell (y nach oben), der Bildschirm
      // rechnet y nach unten — Winkel negieren, Drehsinn behalten.
      ctx.beginPath();
      ctx.arc(teil.c.x * groesse, teil.c.y * groesse, teil.r * groesse, -teil.from, -teil.to, true);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** Farbe je Armaturenart — Regelarmaturen rot, Betriebsarmaturen blaugrau. */
const ACCESSORY_COLOR: Partial<Record<PipeAccessory['kind'], string>> = {
  'thermostatic-valve': '#F87171',
  lockshield: '#F87171',
  'balancing-valve': '#FB923C',
  'differential-pressure': '#FB923C',
  shutoff: '#94A3B8',
  tee: '#94A3B8',
  elbow: '#64748B',
  'air-vent': '#38BDF8',
  drain: '#38BDF8',
  'fixed-point': '#A78BFA',
  'expansion-bend': '#A78BFA',
  strainer: '#94A3B8',
};

export function distanceToPipe(run: PipeRun, p: Vec2): number {
  let best = Infinity;
  for (let i = 1; i < run.points.length; i++) {
    const a = run.points[i - 1];
    const b = run.points[i];
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

// ---------------------------------------------------------------------------
// Dachöffnungen
// ---------------------------------------------------------------------------

export const ROOF_OPENING_COLORS = {
  skylight: '#38BDF8',
  dormer: '#FBBF24',
};

/**
 * Dachflächenfenster und Gauben im Grundriss.
 *
 * Das Dachfenster bekommt die Diagonalen — die Konvention für „Öffnung in
 * einer geneigten Fläche". Die Gaube wird als Kasten mit betonter Frontkante
 * gezeichnet: an der dicken Linie erkennt man sofort, wohin sie schaut.
 */
export function drawRoofOpening(
  ctx: CanvasRenderingContext2D,
  opening: RoofOpening,
  corners: Vec2[],
  sx: (x: number) => number,
  sy: (y: number) => number,
  zoom: number,
  state: { selected: boolean; frontSide?: 1 | -1 },
): void {
  if (corners.length < 4) return;
  const isSkylight = opening.kind === 'skylight';
  const colour = state.selected
    ? '#7DD3FC'
    : isSkylight
      ? ROOF_OPENING_COLORS.skylight
      : ROOF_OPENING_COLORS.dormer;

  ctx.save();
  ctx.strokeStyle = colour;
  ctx.lineWidth = state.selected ? 1.8 : 1.2;

  ctx.beginPath();
  ctx.moveTo(sx(corners[0].x), sy(corners[0].y));
  for (let i = 1; i < 4; i++) ctx.lineTo(sx(corners[i].x), sy(corners[i].y));
  ctx.closePath();
  ctx.fillStyle = state.selected ? 'rgba(125,211,252,0.12)' : 'rgba(56,189,248,0.06)';
  ctx.fill();
  ctx.stroke();

  if (isSkylight) {
    // Diagonalen
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(sx(corners[0].x), sy(corners[0].y));
    ctx.lineTo(sx(corners[2].x), sy(corners[2].y));
    ctx.moveTo(sx(corners[1].x), sy(corners[1].y));
    ctx.lineTo(sx(corners[3].x), sy(corners[3].y));
    ctx.stroke();
    ctx.globalAlpha = 1;
  } else {
    // Frontkante betonen. Welche der beiden Querkanten die Front ist, hängt
    // von der Dachseite ab — auf der anderen Firsthälfte fällt das Dach in
    // die Gegenrichtung.
    const front = (state.frontSide ?? 1) > 0 ? [corners[1], corners[2]] : [corners[0], corners[3]];
    const back = (state.frontSide ?? 1) > 0 ? [corners[0], corners[3]] : [corners[1], corners[2]];
    ctx.lineWidth = state.selected ? 3.2 : 2.4;
    ctx.beginPath();
    ctx.moveTo(sx(front[0].x), sy(front[0].y));
    ctx.lineTo(sx(front[1].x), sy(front[1].y));
    ctx.stroke();

    // Giebelgaube: ihr eigener First läuft von der Giebelspitze nach hinten.
    // Erst diese Linie unterscheidet sie im Grundriss von der Schleppgaube.
    if (opening.kind === 'dormer-gable') {
      const midFront = { x: (front[0].x + front[1].x) / 2, y: (front[0].y + front[1].y) / 2 };
      const midBack = { x: (back[0].x + back[1].x) / 2, y: (back[0].y + back[1].y) / 2 };
      ctx.lineWidth = 1;
      ctx.setLineDash([7, 3, 2, 3]);
      ctx.beginPath();
      ctx.moveTo(sx(midFront.x), sy(midFront.y));
      ctx.lineTo(sx(midBack.x), sy(midBack.y));
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  if (zoom > 26) {
    const label = isSkylight
      ? `${(opening.width * 100).toFixed(0)}×${(opening.depth * 100).toFixed(0)}`
      : `${(opening.frontHeight ?? 0).toFixed(2)} m`;
    ctx.font = '9px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const w = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(11,17,32,0.8)';
    ctx.fillRect(sx(opening.position.x) - w / 2 - 3, sy(opening.position.y) - 6, w + 6, 12);
    ctx.fillStyle = colour;
    ctx.fillText(label, sx(opening.position.x), sy(opening.position.y));
  }

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Massive Bauteile
// ---------------------------------------------------------------------------

/**
 * Farben der massiven Bauteile.
 *
 * Bewusst ein Mauerwerkston und keiner der schon vergebenen: Wände sind
 * blaugrau, Räume türkis, Schächte violett, offene Wandenden orange. Ein
 * Kamin, der wie eine Wand aussieht, wird für eine gehalten.
 */
export const SOLID_COLORS = {
  edge: '#CF8A6B',
  fill: 'rgba(207,138,107,0.30)',
  hatch: 'rgba(207,138,107,0.85)',
  active: '#38BDF8',
  activeFill: 'rgba(56,189,248,0.22)',
};

/**
 * Der Grundriss eines massiven Bauteils in Weltkoordinaten.
 *
 * Steht ein freier Umriss im Modell, gilt er unverändert; sonst wird das
 * Rechteck aus Länge, Breite und Drehung aufgespannt. Beides ergibt dieselbe
 * Form von Ergebnis, damit jeder Aufrufer — Plan, 3D, Fußbodenheizung,
 * Export — mit *einer* Geometriequelle arbeitet.
 */
export function solidFootprint(s: SolidElement): Vec2[] {
  if (s.outline && s.outline.length >= 3) return s.outline;
  const a = s.rotation * TO_RAD;
  const dx = { x: Math.cos(a), y: Math.sin(a) };
  const dy = { x: -Math.sin(a), y: Math.cos(a) };
  const hl = s.length / 2;
  const hw = s.width / 2;
  return [
    { x: s.position.x - dx.x * hl - dy.x * hw, y: s.position.y - dx.y * hl - dy.y * hw },
    { x: s.position.x + dx.x * hl - dy.x * hw, y: s.position.y + dx.y * hl - dy.y * hw },
    { x: s.position.x + dx.x * hl + dy.x * hw, y: s.position.y + dx.y * hl + dy.y * hw },
    { x: s.position.x - dx.x * hl + dy.x * hw, y: s.position.y - dx.y * hl + dy.y * hw },
  ];
}

/**
 * Die massiven Bauteile, die in einem Geschoss zu zeichnen sind.
 *
 * Ein Schornstein steht im Obergeschoss genauso im Weg wie im Erdgeschoss —
 * er beginnt am Feuerraum und geht bis übers Dach. Dort ist er `passing`:
 * dasselbe Bauteil, gezeichnet als Durchdringung und nicht als Bestandteil
 * dieses Geschosses. Pfeiler und Versatz gehören zu genau einem Geschoss.
 *
 * Die Funktion steht hier und nicht im Editor, weil Bildschirm, Ausdruck und
 * Massenauszug dieselbe Antwort brauchen.
 */
export function solidsOnLevel(
  doc: BimDocument,
  levelId: string,
): { solid: SolidElement; passing: boolean }[] {
  const rank = new Map(
    Object.values(doc.levels)
      .sort((a, b) => a.order - b.order)
      .map((l, i) => [l.id, i]),
  );
  const here = rank.get(levelId);
  const out: { solid: SolidElement; passing: boolean }[] = [];
  for (const solid of Object.values(doc.solids ?? {})) {
    if (solid.levelId === levelId) {
      out.push({ solid, passing: false });
      continue;
    }
    const from = rank.get(solid.levelId);
    if (solid.throughAllLevels && from !== undefined && here !== undefined && here > from) {
      out.push({ solid, passing: true });
    }
  }
  return out;
}

/** Punkt-in-Grundriss, für die Auswahl im Plan. */
export function hitTestSolid(s: SolidElement, p: Vec2): boolean {
  const poly = solidFootprint(s);
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * Ein massives Bauteil im Grundriss.
 *
 * Massiv heißt im Plan: durchgehend gefüllt und mit dichter 45°-Schraffur,
 * dazu eine kräftigere Umrisslinie als jedes andere Symbol. Der Unterschied
 * zur Wand ist dabei nicht der Ton allein, sondern die Dichte — die Schraffur
 * steht bei jedem Zoom im gleichen Bildschirmabstand, damit sie auch bei
 * kleinem Maßstab als Fläche und nicht als Streifenmuster liest.
 *
 * `passing` zeichnet dasselbe Bauteil in einem Geschoss, durch das es nur
 * hindurchläuft (Schornstein). Es bleibt massiv — dort *ist* Mauerwerk —,
 * wird aber schwächer gezeichnet, damit man sieht, dass es nicht zu diesem
 * Geschoss gehört.
 */
export function drawSolid(
  ctx: CanvasRenderingContext2D,
  s: SolidElement,
  sx: (x: number) => number,
  sy: (y: number) => number,
  zoom: number,
  state: { selected: boolean; passing?: boolean },
): void {
  const poly = solidFootprint(s);
  if (poly.length < 3) return;
  const colour = state.selected ? SOLID_COLORS.active : SOLID_COLORS.edge;

  ctx.save();
  if (state.passing) ctx.globalAlpha = 0.55;

  const path = () => {
    ctx.beginPath();
    ctx.moveTo(sx(poly[0].x), sy(poly[0].y));
    for (let i = 1; i < poly.length; i++) ctx.lineTo(sx(poly[i].x), sy(poly[i].y));
    ctx.closePath();
  };

  path();
  ctx.fillStyle = state.selected ? SOLID_COLORS.activeFill : SOLID_COLORS.fill;
  ctx.fill();

  // Massivschraffur: 45°, im Bildschirmraum gerechnet und auf den Umriss
  // beschnitten. Im Modellraum gerechnet würde sie beim Herauszoomen zur
  // Volltonfläche und beim Hineinzoomen zu drei Strichen.
  ctx.save();
  ctx.clip();
  const xs = poly.map((p) => sx(p.x));
  const ys = poly.map((p) => sy(p.y));
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const step = 5;
  ctx.strokeStyle = state.selected ? SOLID_COLORS.active : SOLID_COLORS.hatch;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  for (let d = x0 - (y1 - y0); d <= x1; d += step) {
    ctx.moveTo(d, y0);
    ctx.lineTo(d + (y1 - y0), y1);
  }
  ctx.stroke();
  ctx.restore();

  path();
  ctx.strokeStyle = colour;
  ctx.lineWidth = state.selected ? 2.4 : 1.8;
  ctx.stroke();

  if (zoom > 24 && !state.passing) {
    const label = s.name;
    ctx.font = '9px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const w = ctx.measureText(label).width;
    const cx = sx(s.position.x);
    const cy = sy(s.position.y);
    ctx.fillStyle = 'rgba(11,17,32,0.82)';
    ctx.fillRect(cx - w / 2 - 3, cy - 6, w + 6, 12);
    ctx.fillStyle = colour;
    ctx.fillText(label, cx, cy);
  }

  ctx.restore();
}

/**
 * Die Deckenöffnung, die eine Treppe oder ein Schacht im Geschoss darüber
 * hinterlässt.
 *
 * Sie wird gezeichnet, das Bauteil selbst aber nicht: eine Treppe verbindet
 * zwei Geschosse und steht genau einmal im Modell — im oberen Geschoss ist
 * von ihr nur das Loch im Fußboden zu sehen. Gestrichelt und ohne Stufen,
 * damit niemand sie für eine zweite Treppe hält, und ohne Trefferfläche: was
 * hier liegt, gehört dem Geschoss darunter.
 */
export function drawCeilingOpening(
  ctx: CanvasRenderingContext2D,
  corners: Vec2[],
  sx: (x: number) => number,
  sy: (y: number) => number,
  zoom: number,
  label: string,
): void {
  if (corners.length < 3) return;
  ctx.save();
  ctx.strokeStyle = VERTICAL_COLORS.stair;
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(sx(corners[0].x), sy(corners[0].y));
  for (let i = 1; i < corners.length; i++) ctx.lineTo(sx(corners[i].x), sy(corners[i].y));
  ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);

  if (zoom > 24) {
    let cx = 0;
    let cy = 0;
    for (const c of corners) {
      cx += c.x;
      cy += c.y;
    }
    cx /= corners.length;
    cy /= corners.length;
    ctx.font = '9px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = VERTICAL_COLORS.stair;
    ctx.fillText(label, sx(cx), sy(cy));
  }
  ctx.restore();
}
