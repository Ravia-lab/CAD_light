/**
 * Außenanlage im Grundriss zeichnen.
 *
 * Der Plan zeigt bisher das Gebäude. Für die Aufstellung einer Wärmepumpe
 * zählt aber, was *darum herum* liegt: die Grundstücksgrenze, das
 * Nachbarhaus, der Lichtschacht, der Baum. Diese Objekte liegen bewusst
 * unter der Baugeometrie und in gedeckten Farben — sie sind der Kontext, in
 * dem gebaut wird, nicht das Bauwerk selbst.
 *
 * Zwei Kreise um die Wärmepumpe tragen die eigentliche Aussage:
 *   • der **Schallradius** — ab hier ist der Nachtrichtwert eingehalten
 *   • der **Schutzbereich** — hier darf keine Öffnung liegen
 * Beide sind gestrichelt, weil sie nichts Gebautes sind, sondern eine
 * Bedingung. Wer die Wärmepumpe verschiebt, sieht sofort, ob sie passt.
 */

import type { HeatPump, SiteElement, Vec2 } from '../types/bim';
import { pointInPolygon } from './geometry';

export const SITE_COLORS = {
  boundary: '#F59E0B',
  neighbour: '#64748B',
  immission: '#FB7185',
  hazard: '#F97316',
  tree: '#4ADE80',
  source: '#22D3EE',
  utility: '#A78BFA',
  paved: '#475569',
  pump: '#38BDF8',
  noiseOk: '#34D399',
  noiseBad: '#FB7185',
} as const;

type Px = (v: number) => number;

const path = (ctx: CanvasRenderingContext2D, points: Vec2[], sx: Px, sy: Px, close: boolean): void => {
  if (!points.length) return;
  ctx.beginPath();
  ctx.moveTo(sx(points[0].x), sy(points[0].y));
  for (let i = 1; i < points.length; i++) ctx.lineTo(sx(points[i].x), sy(points[i].y));
  if (close) ctx.closePath();
};

/** Ein Objekt des Außengeländes. */
export function drawSiteElement(
  ctx: CanvasRenderingContext2D,
  element: SiteElement,
  sx: Px,
  sy: Px,
  zoom: number,
  selected: boolean,
): void {
  const points = element.points;
  if (!points.length) return;
  ctx.save();
  ctx.lineWidth = selected ? 2.4 : 1.4;

  switch (element.kind) {
    case 'boundary': {
      // Die Grenze bekommt die kräftigste Linie im Plan — sie ist die
      // Bedingung, gegen die am häufigsten verstoßen wird.
      ctx.strokeStyle = SITE_COLORS.boundary;
      ctx.setLineDash([14, 5, 3, 5]);
      ctx.lineWidth = selected ? 3 : 2;
      path(ctx, points, sx, sy, true);
      ctx.stroke();
      break;
    }
    case 'neighbour-building': {
      ctx.fillStyle = 'rgba(100,116,139,0.16)';
      ctx.strokeStyle = SITE_COLORS.neighbour;
      path(ctx, points, sx, sy, true);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'paved': {
      ctx.fillStyle = 'rgba(71,85,105,0.18)';
      ctx.strokeStyle = SITE_COLORS.paved;
      ctx.setLineDash([4, 3]);
      path(ctx, points, sx, sy, true);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'collector': {
      ctx.fillStyle = 'rgba(34,211,238,0.10)';
      ctx.strokeStyle = SITE_COLORS.source;
      path(ctx, points, sx, sy, true);
      ctx.fill();
      ctx.stroke();
      // Andeutung der Rohrschlangen — nur ein paar Linien, keine Zeichnung
      // des wirklichen Verlegemusters. Der zählt in Metern, nicht im Bild.
      const spacing = Math.max(0.3, element.pipeSpacing ?? 0.6);
      const xs = points.map((p) => p.x);
      const ys = points.map((p) => p.y);
      ctx.save();
      path(ctx, points, sx, sy, true);
      ctx.clip();
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1;
      for (let y = Math.min(...ys); y <= Math.max(...ys); y += spacing) {
        ctx.beginPath();
        ctx.moveTo(sx(Math.min(...xs)), sy(y));
        ctx.lineTo(sx(Math.max(...xs)), sy(y));
        ctx.stroke();
      }
      ctx.restore();
      break;
    }
    case 'trench': {
      ctx.strokeStyle = SITE_COLORS.source;
      ctx.lineWidth = Math.max(3, 1.6 * zoom * 0.5);
      ctx.setLineDash([10, 4]);
      path(ctx, points, sx, sy, false);
      ctx.stroke();
      break;
    }
    case 'utility-line': {
      ctx.strokeStyle = SITE_COLORS.utility;
      ctx.setLineDash([6, 4]);
      path(ctx, points, sx, sy, false);
      ctx.stroke();
      break;
    }
    case 'tree': {
      const r = Math.max(4, (element.radius ?? 3) * zoom);
      ctx.strokeStyle = SITE_COLORS.tree;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(sx(points[0].x), sy(points[0].y), r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(sx(points[0].x), sy(points[0].y), 3, 0, Math.PI * 2);
      ctx.fillStyle = SITE_COLORS.tree;
      ctx.fill();
      break;
    }
    case 'hazard-opening': {
      const r = Math.max(5, (element.radius ?? 0.4) * zoom);
      ctx.strokeStyle = SITE_COLORS.hazard;
      ctx.beginPath();
      ctx.rect(sx(points[0].x) - r, sy(points[0].y) - r, r * 2, r * 2);
      ctx.stroke();
      // Diagonalen: das Zeichen für „hier geht es nach unten".
      ctx.beginPath();
      ctx.moveTo(sx(points[0].x) - r, sy(points[0].y) - r);
      ctx.lineTo(sx(points[0].x) + r, sy(points[0].y) + r);
      ctx.moveTo(sx(points[0].x) + r, sy(points[0].y) - r);
      ctx.lineTo(sx(points[0].x) - r, sy(points[0].y) + r);
      ctx.stroke();
      break;
    }
    case 'immission-point': {
      const x = sx(points[0].x);
      const y = sy(points[0].y);
      ctx.strokeStyle = SITE_COLORS.immission;
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - 9, y);
      ctx.lineTo(x + 9, y);
      ctx.moveTo(x, y - 9);
      ctx.lineTo(x, y + 9);
      ctx.stroke();
      break;
    }
    case 'borehole': {
      const x = sx(points[0].x);
      const y = sy(points[0].y);
      ctx.strokeStyle = SITE_COLORS.source;
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = SITE_COLORS.source;
      ctx.fill();
      break;
    }
    case 'well-supply':
    case 'well-injection': {
      const x = sx(points[0].x);
      const y = sy(points[0].y);
      ctx.strokeStyle = SITE_COLORS.source;
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, Math.PI * 2);
      ctx.stroke();
      // Pfeil nach oben = fördern, nach unten = schlucken.
      const up = element.kind === 'well-supply';
      ctx.beginPath();
      ctx.moveTo(x, y + (up ? 5 : -5));
      ctx.lineTo(x, y + (up ? -5 : 5));
      ctx.lineTo(x - 3, y + (up ? -1 : 1));
      ctx.moveTo(x, y + (up ? -5 : 5));
      ctx.lineTo(x + 3, y + (up ? -1 : 1));
      ctx.stroke();
      break;
    }
  }

  ctx.setLineDash([]);
  ctx.restore();
}

/** Umriss der Außeneinheit — gedreht in Ausblasrichtung. */
export function pumpCorners(pump: HeatPump): Vec2[] {
  // Azimut zählt im Uhrzeigersinn ab Nord (+y). Die Ausblasseite ist die
  // Vorderseite des Geräts.
  const rad = ((90 - pump.azimuth) * Math.PI) / 180;
  const dx = { x: Math.cos(rad), y: Math.sin(rad) };
  const dy = { x: -dx.y, y: dx.x };
  const w = pump.depth / 2;
  const l = pump.width / 2;
  return [
    { x: pump.position.x - dx.x * w - dy.x * l, y: pump.position.y - dx.y * w - dy.y * l },
    { x: pump.position.x + dx.x * w - dy.x * l, y: pump.position.y + dx.y * w - dy.y * l },
    { x: pump.position.x + dx.x * w + dy.x * l, y: pump.position.y + dx.y * w + dy.y * l },
    { x: pump.position.x - dx.x * w + dy.x * l, y: pump.position.y - dx.y * w + dy.y * l },
  ];
}

export interface PumpOverlay {
  /** Radius, ab dem der Nachtrichtwert eingehalten ist [m]. */
  limitRadius: number;
  /** Radius für die Irrelevanzschwelle [m]. */
  safeRadius: number;
  /** Schutzbereich bei brennbarem Kältemittel [m]. */
  protectionRadius: number;
  /** Wird an einem Immissionsort überschritten? */
  exceeded: boolean;
}

/** Die Wärmepumpe mit ihren beiden Bedingungskreisen. */
export function drawHeatPump(
  ctx: CanvasRenderingContext2D,
  pump: HeatPump,
  overlay: PumpOverlay | undefined,
  sx: Px,
  sy: Px,
  zoom: number,
  selected: boolean,
): void {
  const x = sx(pump.position.x);
  const y = sy(pump.position.y);
  ctx.save();

  if (overlay) {
    // Schallradien zuerst, damit das Gerät darüber liegt.
    ctx.setLineDash([8, 6]);
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = overlay.exceeded ? SITE_COLORS.noiseBad : SITE_COLORS.noiseOk;
    ctx.globalAlpha = 0.75;
    ctx.beginPath();
    ctx.arc(x, y, overlay.limitRadius * zoom, 0, Math.PI * 2);
    ctx.stroke();

    ctx.globalAlpha = 0.35;
    ctx.setLineDash([3, 5]);
    ctx.beginPath();
    ctx.arc(x, y, overlay.safeRadius * zoom, 0, Math.PI * 2);
    ctx.stroke();

    if (overlay.protectionRadius > 0) {
      ctx.globalAlpha = 0.8;
      ctx.setLineDash([2, 3]);
      ctx.strokeStyle = SITE_COLORS.hazard;
      ctx.beginPath();
      ctx.arc(x, y, overlay.protectionRadius * zoom, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
  }

  const corners = pumpCorners(pump);
  ctx.beginPath();
  ctx.moveTo(sx(corners[0].x), sy(corners[0].y));
  for (let i = 1; i < corners.length; i++) ctx.lineTo(sx(corners[i].x), sy(corners[i].y));
  ctx.closePath();
  ctx.fillStyle = 'rgba(56,189,248,0.18)';
  ctx.strokeStyle = SITE_COLORS.pump;
  ctx.lineWidth = selected ? 2.4 : 1.6;
  ctx.fill();
  ctx.stroke();

  // Ausblasrichtung: drei Striche vor der Vorderseite. Ohne sie steht im
  // Plan ein Kasten, dem man nicht ansieht, wohin er bläst — und genau das
  // ist die Frage, die den Nachbarn beschäftigt.
  const rad = ((90 - pump.azimuth) * Math.PI) / 180;
  const dx = { x: Math.cos(rad), y: Math.sin(rad) };
  const dy = { x: -dx.y, y: dx.x };
  ctx.strokeStyle = SITE_COLORS.pump;
  ctx.lineWidth = 1.2;
  for (let k = -1; k <= 1; k++) {
    const base = {
      x: pump.position.x + dx.x * (pump.depth / 2) + dy.x * k * (pump.width / 3),
      y: pump.position.y + dx.y * (pump.depth / 2) + dy.y * k * (pump.width / 3),
    };
    const tip = { x: base.x + dx.x * 0.55, y: base.y + dx.y * 0.55 };
    ctx.beginPath();
    ctx.moveTo(sx(base.x), sy(base.y));
    ctx.lineTo(sx(tip.x), sy(tip.y));
    ctx.stroke();
  }
  ctx.restore();
}

/** Trifft ein Klick die Wärmepumpe? */
export function hitTestPump(pump: HeatPump, world: Vec2): boolean {
  const rad = ((90 - pump.azimuth) * Math.PI) / 180;
  const dx = { x: Math.cos(rad), y: Math.sin(rad) };
  const dy = { x: -dx.y, y: dx.x };
  const rx = world.x - pump.position.x;
  const ry = world.y - pump.position.y;
  const along = rx * dy.x + ry * dy.y;
  const across = rx * dx.x + ry * dx.y;
  return Math.abs(along) <= pump.width / 2 + 0.1 && Math.abs(across) <= pump.depth / 2 + 0.1;
}

/** Trifft ein Klick ein Objekt des Außengeländes? */
export function hitTestSiteElement(element: SiteElement, world: Vec2, tolerance: number): boolean {
  if (!element.points.length) return false;
  if (element.points.length === 1) {
    const r = Math.max(element.radius ?? 0.3, tolerance);
    return Math.hypot(world.x - element.points[0].x, world.y - element.points[0].y) <= r;
  }
  const closed = element.kind === 'boundary' || element.kind === 'collector' || element.kind === 'neighbour-building' || element.kind === 'paved';
  const last = closed ? element.points.length : element.points.length - 1;
  for (let i = 0; i < last; i++) {
    const a = element.points[i];
    const b = element.points[(i + 1) % element.points.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared > 0 ? Math.max(0, Math.min(1, ((world.x - a.x) * dx + (world.y - a.y) * dy) / lengthSquared)) : 0;
    if (Math.hypot(world.x - (a.x + dx * t), world.y - (a.y + dy * t)) <= tolerance) return true;
  }
  return false;
}

/**
 * Trifft ein Klick das *Innere* einer Fläche des Außengeländes?
 *
 * Getrennt von `hitTestSiteElement`, weil beide Prüfungen an
 * unterschiedlichen Stellen der Trefferreihenfolge gebraucht werden: die
 * Kante liegt oben (sie ist dünn und muss zuerst greifen), die Fläche ganz
 * unten (sie ist groß und würde sonst alles verdecken, was auf ihr liegt).
 *
 * Die Grundstücksgrenze ist bewusst *keine* Fläche in diesem Sinn. Sie
 * umschließt in aller Regel das gesamte Modell — würde ihr Inneres treffen,
 * wäre jeder Klick neben ein Bauteil ein Klick auf die Grenze, und weder der
 * Auswahlrahmen noch das Abwählen käme je zum Zug. Sie bleibt an ihrer Linie
 * greifbar.
 */
export function hitTestSiteArea(element: SiteElement, world: Vec2): boolean {
  if (element.kind !== 'neighbour-building' && element.kind !== 'collector' && element.kind !== 'paved') {
    return false;
  }
  return element.points.length >= 3 && pointInPolygon(world, element.points);
}
