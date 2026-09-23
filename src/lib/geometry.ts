/**
 * Geometrie-Kernel — allokationsarme 2D-Mathematik.
 *
 * Bewusst funktional und ohne Klassen: Vec2 ist ein reines Objekt-Literal,
 * das die JS-Engine als "hidden class" stabil hält. Kein `Math.hypot` in
 * heißen Pfaden (deutlich langsamer als sqrt), keine Zwischen-Arrays in
 * Schleifen, die pro Frame laufen.
 */

import type { Bounds, Orientation, Vec2 } from '../types/bim';

/** Toleranz für Koordinatenvergleiche [m] — 0,1 mm. */
export const EPS = 1e-4;

// ---------------------------------------------------------------------------
// Vektoren
// ---------------------------------------------------------------------------

export const v = (x: number, y: number): Vec2 => ({ x, y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
/** 2D-Kreuzprodukt (z-Komponente) — Vorzeichen = Drehsinn. */
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;

export function length(a: Vec2): number {
  return Math.sqrt(a.x * a.x + a.y * a.y);
}

export function distance(a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Quadrierte Distanz — für Vergleiche, spart die Wurzel. */
export function distanceSq(a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return dx * dx + dy * dy;
}

export function normalize(a: Vec2): Vec2 {
  const len = Math.sqrt(a.x * a.x + a.y * a.y);
  return len < EPS ? { x: 0, y: 0 } : { x: a.x / len, y: a.y / len };
}

/** Linksnormale (90° CCW gedreht). */
export const perp = (a: Vec2): Vec2 => ({ x: -a.y, y: a.x });

export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

export function rotate(a: Vec2, angleRad: number): Vec2 {
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
}

export const almostEqual = (a: Vec2, b: Vec2, eps = EPS): boolean =>
  Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps;

export const clamp = (value: number, min: number, max: number): number =>
  value < min ? min : value > max ? max : value;

// ---------------------------------------------------------------------------
// Strecken
// ---------------------------------------------------------------------------

/** Parameter t∈[0,1] der Projektion von p auf die Strecke a→b. */
export function projectParam(p: Vec2, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lenSq = abx * abx + aby * aby;
  if (lenSq < EPS * EPS) return 0;
  return clamp(((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq, 0, 1);
}

/** Nächstgelegener Punkt auf der Strecke a→b. */
export function closestPointOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  return lerp(a, b, projectParam(p, a, b));
}

export function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  return distance(p, closestPointOnSegment(p, a, b));
}

/**
 * Echter Schnittpunkt zweier Strecken (ohne Berührung an den Endpunkten,
 * steuerbar über `includeEndpoints`). Gibt `null` bei Parallelität zurück.
 */
export function segmentIntersection(
  p1: Vec2,
  p2: Vec2,
  p3: Vec2,
  p4: Vec2,
  includeEndpoints = false,
): Vec2 | null {
  const d1 = sub(p2, p1);
  const d2 = sub(p4, p3);
  const denom = cross(d1, d2);
  if (Math.abs(denom) < 1e-12) return null; // parallel oder kollinear

  const diff = sub(p3, p1);
  const t = cross(diff, d2) / denom;
  const u = cross(diff, d1) / denom;

  const lo = includeEndpoints ? -EPS : EPS;
  const hi = includeEndpoints ? 1 + EPS : 1 - EPS;
  if (t < lo || t > hi || u < lo || u > hi) return null;

  return { x: p1.x + d1.x * t, y: p1.y + d1.y * t };
}

/**
 * Schnittpunkt zweier *unendlicher* Geraden durch (p, richtung d).
 * Grundlage für den Polygon-Offset (Versatz der lichten Raumkanten).
 */
export function lineIntersection(p1: Vec2, d1: Vec2, p2: Vec2, d2: Vec2): Vec2 | null {
  const denom = cross(d1, d2);
  if (Math.abs(denom) < 1e-9) return null;
  const t = cross(sub(p2, p1), d2) / denom;
  return { x: p1.x + d1.x * t, y: p1.y + d1.y * t };
}

// ---------------------------------------------------------------------------
// Winkel & Snapping-Hilfen
// ---------------------------------------------------------------------------

/**
 * Die Vorzugsrichtung einer Menge von Strecken [rad].
 *
 * **Wozu.** Ein Aufmaß — gescannt oder mit dem Stift skizziert — liegt nie
 * achsparallel. Bevor irgendetwas ausgerichtet werden kann, muss feststehen,
 * *wonach*: nach dem Norden? Nach der ersten Wand? Nach der längsten? Alle
 * drei Antworten sind willkürlich. Richtig ist die Richtung, in der der
 * größte Teil der Gesamtlänge liegt.
 *
 * **Warum der vierfache Winkel.** Ein Rechteck hat vier Seiten in zwei
 * Richtungen, die 90° auseinanderliegen. Mittelt man die Winkel unmittelbar,
 * heben sich 0° und 90° zu 45° auf — also genau zur falschen Richtung. Mit
 * dem vierfachen Winkel fallen 0°, 90°, 180° und 270° auf demselben
 * Einheitskreis zusammen; der Mittelwert wird dadurch richtig, und das
 * anschließende Vierteln bringt ihn zurück.
 *
 * Gewichtet wird mit der Länge: eine sechs Meter lange Außenwand sagt mehr
 * über die Ausrichtung des Hauses als ein 40 cm langer Mauervorsprung.
 *
 * Das Ergebnis liegt zwischen −45° und +45° — mehr braucht es nicht, weil
 * jede weitere Vierteldrehung dieselbe Ausrichtung ist.
 */
export function vorzugsrichtung(
  stuecke: readonly { dx: number; dy: number; laenge: number }[],
): number {
  let sx = 0;
  let sy = 0;
  for (const s of stuecke) {
    const w = Math.atan2(s.dy, s.dx) * 4;
    sx += Math.cos(w) * s.laenge;
    sy += Math.sin(w) * s.laenge;
  }
  if (sx === 0 && sy === 0) return 0;
  return Math.atan2(sy, sx) / 4;
}

export const TO_DEG = 180 / Math.PI;
export const TO_RAD = Math.PI / 180;

/** Winkel der Strecke a→b [°] im Bereich (−180, 180]. */
export function angleDeg(a: Vec2, b: Vec2): number {
  return Math.atan2(b.y - a.y, b.x - a.x) * TO_DEG;
}

/** Normalisiert einen Winkel auf [0, 360). */
export function normalizeDeg(deg: number): number {
  const m = deg % 360;
  return m < 0 ? m + 360 : m;
}

/**
 * Rastert den Endpunkt so, dass die Strecke origin→p auf einem Vielfachen
 * von `stepDeg` liegt. Die *Länge* bleibt dabei die Projektion auf die
 * gerasterte Achse — dadurch "gleitet" der Cursor an der Achse entlang,
 * statt zu springen. Genau dieses Verhalten kennt man aus AutoCAD/ArchiCAD.
 */
export function snapToAngle(origin: Vec2, p: Vec2, stepDeg: number): { point: Vec2; angle: number } {
  const dx = p.x - origin.x;
  const dy = p.y - origin.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < EPS) return { point: { ...origin }, angle: 0 };

  const raw = Math.atan2(dy, dx) * TO_DEG;
  const snapped = Math.round(raw / stepDeg) * stepDeg;
  const rad = snapped * TO_RAD;
  const dirX = Math.cos(rad);
  const dirY = Math.sin(rad);
  // Projektion der Maus auf die gerasterte Achse (nie negativ zurückspringen)
  const proj = Math.max(0, dx * dirX + dy * dirY);
  return {
    point: { x: origin.x + dirX * proj, y: origin.y + dirY * proj },
    angle: normalizeDeg(snapped),
  };
}

export function snapToGrid(p: Vec2, size: number): Vec2 {
  return { x: Math.round(p.x / size) * size, y: Math.round(p.y / size) * size };
}

/** Rundet auf Millimeter — verhindert Fließkomma-Rauschen in Exports. */
export const roundMm = (n: number): number => Math.round(n * 1000) / 1000;
export const roundCm2 = (n: number): number => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// Polygone
// ---------------------------------------------------------------------------

/** Vorzeichenbehaftete Fläche (Gauß'sche Trapezformel). CCW → positiv. */
export function signedArea(poly: readonly Vec2[]): number {
  let sum = 0;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

export const polygonArea = (poly: readonly Vec2[]): number => Math.abs(signedArea(poly));

export function polygonPerimeter(poly: readonly Vec2[]): number {
  let sum = 0;
  const n = poly.length;
  for (let i = 0; i < n; i++) sum += distance(poly[i], poly[(i + 1) % n]);
  return sum;
}

/** Flächenschwerpunkt. Fällt bei entarteten Polygonen auf den Mittelwert zurück. */
export function polygonCentroid(poly: readonly Vec2[]): Vec2 {
  const n = poly.length;
  if (n === 0) return { x: 0, y: 0 };
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % n];
    const f = p.x * q.y - q.x * p.y;
    a += f;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  a *= 0.5;
  if (Math.abs(a) < 1e-9) {
    let sx = 0;
    let sy = 0;
    for (const p of poly) {
      sx += p.x;
      sy += p.y;
    }
    return { x: sx / n, y: sy / n };
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

/** Punkt-in-Polygon (Ray-Casting, robust für konkave Polygone). */
export function pointInPolygon(p: Vec2, poly: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Ein Punkt, der **sicher im Inneren** des Polygons liegt.
 *
 * Gebraucht wird das überall dort, wo ein Polygon über „welcher Raum enthält
 * diesen Punkt?" wiedergefunden wird. Der naheliegende Kandidat — der
 * Mittelwert der Ecken — liegt bei konkaven Grundrissen **außerhalb**: Beim
 * offenen Wohnbereich „Wohnen/Essen + Flur + Küche" (L-förmig) fällt er in
 * den fehlenden Schenkel. Der Flächenschwerpunkt hilft nur zum Teil; bei vier
 * der Swiss-Dwellings-Wohnungen liegt auch er außerhalb.
 *
 * Deshalb hier in zwei Stufen:
 *
 *  1. Mittelwert der Ecken, solange er innen liegt — damit bleibt alles, was
 *     bisher zugeordnet wurde, bei genau demselben Punkt.
 *  2. Sonst ein **Abtaststrahl**: zwischen je zwei benachbarten Ecken-Höhen
 *     wird waagerecht geschnitten, die Schnittstellen werden paarweise zu
 *     Innenstrecken; die **längste** Strecke gewinnt, ihre Mitte ist das
 *     Ergebnis. Die längste Strecke ist die unempfindlichste: Millimeter am
 *     Rand ändern an ihrer Mitte nichts.
 *
 * Beispiel von Hand — L-Form (0,0) (6,0) (6,2) (2,2) (2,6) (0,6):
 * Eckenmittel (16/6, 16/6) = (2,667 | 2,667) liegt außen. Ecken-Höhen 0, 2, 6
 * ergeben die Abtasthöhen 1 und 4; bei y = 1 reicht das Innere von x = 0 bis
 * x = 6 (Länge 6), bei y = 4 von x = 0 bis x = 2 (Länge 2). Die längere
 * gewinnt: (3 | 1).
 */
export function innererPunkt(poly: readonly Vec2[]): Vec2 {
  const n = poly.length;
  if (n === 0) return { x: 0, y: 0 };
  let sx = 0;
  let sy = 0;
  for (const p of poly) {
    sx += p.x;
    sy += p.y;
  }
  const mittel = { x: sx / n, y: sy / n };
  if (n < 3 || pointInPolygon(mittel, poly)) return mittel;

  const hoehen = [...new Set(poly.map((p) => p.y))].sort((a, b) => a - b);
  let beste = -1;
  let ergebnis = mittel;
  for (let i = 0; i + 1 < hoehen.length; i++) {
    const y = (hoehen[i] + hoehen[i + 1]) / 2;
    const schnitte: number[] = [];
    for (let k = 0, j = n - 1; k < n; j = k++) {
      const a = poly[k];
      const b = poly[j];
      if (a.y > y !== b.y > y) schnitte.push(((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x);
    }
    schnitte.sort((p, q) => p - q);
    // Paarweise: von der 1. zur 2. Schnittstelle innen, von der 2. zur 3. außen.
    for (let k = 0; k + 1 < schnitte.length; k += 2) {
      const laenge = schnitte[k + 1] - schnitte[k];
      if (laenge > beste) {
        beste = laenge;
        ergebnis = { x: (schnitte[k] + schnitte[k + 1]) / 2, y };
      }
    }
  }
  return ergebnis;
}

export function polygonBounds(poly: readonly Vec2[]): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Wie weit eine Gehrungsecke höchstens vom Ursprungseckpunkt wegwandern darf,
 * als Vielfaches des Versatzes. 4 ist der Vorgabewert von SVG und der
 * übliche Wert in CAD-Anwendungen; er lässt Ecken bis herunter zu etwa 29°
 * unangetastet und fängt alles Spitzere ab.
 */
const MITER_LIMIT = 4;

/**
 * Versetzt jede Polygonkante um ihren *eigenen* Betrag nach innen und
 * schneidet die versetzten Geraden neu — so entstehen die lichten
 * Raummaße bei gemischten Wandstärken korrekt (eine 36,5er Außenwand
 * und eine 11,5er Trennwand versetzen unterschiedlich weit).
 *
 * `poly` muss CCW orientiert sein; `offsets[i]` gehört zur Kante i→i+1.
 */
export function offsetPolygonPerEdge(poly: readonly Vec2[], offsets: readonly number[]): Vec2[] {
  const n = poly.length;
  if (n < 3) return poly.map((p) => ({ ...p }));

  // Kanten nach innen versetzen. Bei CCW-Umlauf liegt das Innere links der
  // Laufrichtung — die Linksnormale (−dy, dx) zeigt also nach innen.
  const shifted: { p: Vec2; d: Vec2 }[] = [];
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const dir = normalize(sub(b, a));
    const inward = { x: -dir.y, y: dir.x };
    const off = offsets[i] ?? 0;
    shifted.push({ p: { x: a.x + inward.x * off, y: a.y + inward.y * off }, d: dir });
  }

  const result: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const prev = shifted[(i - 1 + n) % n];
    const curr = shifted[i];
    const hit = lineIntersection(prev.p, prev.d, curr.p, curr.d);
    // Nahezu kollineare Kanten liefern keinen stabilen Schnitt → Startpunkt nehmen.
    if (!hit) {
      result.push({ ...curr.p });
      continue;
    }
    // Gehrung begrenzen. An einer spitzen Ecke laufen die beiden versetzten
    // Kanten fast parallel, und ihr Schnittpunkt wandert gegen unendlich: aus
    // einem Versatz von 12 cm wird ein Eckpunkt hundert Meter neben dem
    // Grundriss. Das ist kein Randfall — eine Facette, die um ein loses
    // Wandende herumläuft, enthält eine Zacke ohne Breite, und genau dort
    // entsteht diese Ecke. Ohne Grenze liefert der Versatz dann ein Polygon
    // mit 0,7 m² Fläche und 438 m Umfang, das anschließend als „Raum" durch
    // die ganze Rechnung getragen wird.
    //
    // Begrenzt wird wie beim Linienzug in SVG und in jedem CAD: über das
    // Verhältnis von Gehrungslänge zu Versatz. Jenseits der Grenze wird der
    // Punkt auf der Verbindung Ecke→Gehrung zurückgezogen — die Ecke wird
    // stumpf statt falsch.
    const ecke = poly[i];
    const grenze = MITER_LIMIT * Math.max(offsets[(i - 1 + n) % n] ?? 0, offsets[i] ?? 0, 1e-6);
    const dx = hit.x - ecke.x;
    const dy = hit.y - ecke.y;
    const weit = Math.hypot(dx, dy);
    if (weit > grenze) {
      const f = grenze / weit;
      result.push({ x: ecke.x + dx * f, y: ecke.y + dy * f });
    } else {
      result.push(hit);
    }
  }
  return result;
}

/** Entfernt Duplikate und kollineare Zwischenpunkte. */
export function simplifyPolygon(poly: readonly Vec2[], eps = 1e-3): Vec2[] {
  const pts: Vec2[] = [];
  for (const p of poly) {
    if (pts.length === 0 || !almostEqual(pts[pts.length - 1], p, eps)) pts.push({ ...p });
  }
  if (pts.length > 1 && almostEqual(pts[0], pts[pts.length - 1], eps)) pts.pop();
  if (pts.length < 3) return pts;

  const out: Vec2[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n];
    const b = pts[i];
    const c = pts[(i + 1) % n];
    const area2 = Math.abs(cross(sub(b, a), sub(c, b)));
    if (area2 > eps) out.push(b);
  }
  return out.length >= 3 ? out : pts;
}

// ---------------------------------------------------------------------------
// Himmelsrichtungen (Heizlast)
// ---------------------------------------------------------------------------

const ORIENTATIONS: Orientation[] = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'];

/**
 * Azimut einer Flächennormalen: 0° = Nord, 90° = Ost (im Uhrzeigersinn) —
 * die in der Bauphysik übliche Konvention. Modellraum ist +y = Nord,
 * daher azimut = atan2(nx, ny).
 *
 * @param northAngle Nordabweichung des Grundrisses [°], CCW positiv.
 */
export function azimuthFromNormal(normal: Vec2, northAngle = 0): number {
  const deg = Math.atan2(normal.x, normal.y) * TO_DEG;
  return normalizeDeg(deg - northAngle);
}

export function orientationFromAzimuth(azimuth: number): Orientation {
  const idx = Math.round(normalizeDeg(azimuth) / 45) % 8;
  return ORIENTATIONS[idx];
}
