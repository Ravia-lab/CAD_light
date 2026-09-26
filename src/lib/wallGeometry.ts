/**
 * Abgeleitete Wandgeometrie — die *eine* Wahrheit für 2D und 3D.
 *
 * Beide Renderer konsumieren dieselben Funktionen. Dadurch kann eine
 * Aussparung im Plan niemals von der Aussparung im Modell abweichen —
 * der klassische Fehler, wenn 2D- und 3D-Pfad getrennt implementiert werden.
 */

import type { BimNode, Opening, Vec2, Wall } from '../types/bim';
import { EPS, clamp, distance, normalize, sub } from './geometry';

export interface WallGeometry {
  wall: Wall;
  a: Vec2;
  b: Vec2;
  /** Einheitsvektor entlang der Achse a→b. */
  dir: Vec2;
  /** Linksnormale zu `dir` (Einheitsvektor). */
  normal: Vec2;
  length: number;
  /** Achswinkel [rad]. */
  angle: number;
  /** Mittelpunkt der Achse. */
  mid: Vec2;
  halfThickness: number;
}

export function getWallGeometry(wall: Wall, nodes: Record<string, BimNode>): WallGeometry | null {
  const na = nodes[wall.a];
  const nb = nodes[wall.b];
  if (!na || !nb) return null;
  const a = { x: na.x, y: na.y };
  const b = { x: nb.x, y: nb.y };
  const len = distance(a, b);
  if (len < EPS) return null;
  const dir = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  return {
    wall,
    a,
    b,
    dir,
    normal: { x: -dir.y, y: dir.x },
    length: len,
    angle: Math.atan2(dir.y, dir.x),
    mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    halfThickness: wall.thickness / 2,
  };
}

/**
 * Die vier Eckpunkte des Wandrechtecks. `extendStart`/`extendEnd` verlängern
 * die Wand über die Achsknoten hinaus — damit an Ecken und T-Stößen keine
 * Lücke entsteht (Gehrungsersatz für rechtwinklige Anschlüsse).
 */
export function wallQuad(
  g: WallGeometry,
  inset = 0,
  extendStart = 0,
  extendEnd = 0,
): [Vec2, Vec2, Vec2, Vec2] {
  const h = Math.max(0.001, g.halfThickness - inset);
  const ax = g.a.x - g.dir.x * extendStart;
  const ay = g.a.y - g.dir.y * extendStart;
  const bx = g.b.x + g.dir.x * extendEnd;
  const by = g.b.y + g.dir.y * extendEnd;
  const nx = g.normal.x * h;
  const ny = g.normal.y * h;
  return [
    { x: ax + nx, y: ay + ny },
    { x: bx + nx, y: by + ny },
    { x: bx - nx, y: by - ny },
    { x: ax - nx, y: ay - ny },
  ];
}

/** Wie weit muss an einem Knoten verlängert werden, damit die Ecke schließt? */
export function junctionExtension(
  nodeId: string,
  wallsAtNode: Wall[],
  self: Wall,
): number {
  void nodeId;
  if (wallsAtNode.length < 2) return 0;
  let maxOther = 0;
  for (const w of wallsAtNode) {
    if (w.id === self.id) continue;
    if (w.thickness > maxOther) maxOther = w.thickness;
  }
  return maxOther / 2;
}

/** Öffnungsmittelpunkt in Weltkoordinaten. */
export function openingCenter(g: WallGeometry, opening: Opening): Vec2 {
  const t = clamp(opening.distance, 0, g.length);
  return { x: g.a.x + g.dir.x * t, y: g.a.y + g.dir.y * t };
}

/** Die beiden Laibungspunkte (Anfang/Ende) einer Öffnung auf der Achse. */
export function openingSpan(g: WallGeometry, opening: Opening): { from: number; to: number } {
  const half = opening.width / 2;
  const center = clamp(opening.distance, half, Math.max(half, g.length - half));
  return { from: clamp(center - half, 0, g.length), to: clamp(center + half, 0, g.length) };
}

/**
 * Ein massiver Wandteil in lokalen Wandkoordinaten:
 *   u  = Distanz entlang der Achse [m]
 *   z  = Höhe über Fertigfußboden [m]
 */
export interface WallSolidPart {
  uStart: number;
  uEnd: number;
  zStart: number;
  zEnd: number;
}

/**
 * Zerlegt eine Wand in massive Teilquader, sodass Türen und Fenster als
 * echte Aussparungen entstehen — ohne CSG. Erzeugt Brüstungen unter
 * Fenstern und Stürze über allen Öffnungen.
 *
 * Warum kein CSG? Boolesche Operationen auf Meshes kosten pro Wand
 * Millisekunden und erzeugen instabile Topologie. Die Zerlegung in
 * achsparallele Quader ist exakt, deterministisch und praktisch gratis.
 */
export function wallSolidParts(
  g: WallGeometry,
  openings: Opening[],
  extendStart = 0,
  extendEnd = 0,
): WallSolidPart[] {
  const height = g.wall.height;
  const uMin = -extendStart;
  const uMax = g.length + extendEnd;

  const spans = openings
    .map((op) => {
      const { from, to } = openingSpan(g, op);
      return { from, to, sill: Math.max(0, op.sillHeight), head: Math.min(height, op.sillHeight + op.height) };
    })
    .filter((s) => s.to - s.from > EPS)
    .sort((m, n) => m.from - n.from);

  const parts: WallSolidPart[] = [];
  let cursor = uMin;

  for (const s of spans) {
    if (s.from > cursor + EPS) {
      parts.push({ uStart: cursor, uEnd: s.from, zStart: 0, zEnd: height });
    }
    // Brüstung unter dem Fenster
    if (s.sill > EPS) {
      parts.push({ uStart: Math.max(cursor, s.from), uEnd: s.to, zStart: 0, zEnd: s.sill });
    }
    // Sturz über der Öffnung
    if (height - s.head > EPS) {
      parts.push({ uStart: Math.max(cursor, s.from), uEnd: s.to, zStart: s.head, zEnd: height });
    }
    cursor = Math.max(cursor, s.to);
  }

  if (cursor < uMax - EPS) {
    parts.push({ uStart: cursor, uEnd: uMax, zStart: 0, zEnd: height });
  }

  return parts.filter((p) => p.uEnd - p.uStart > EPS && p.zEnd - p.zStart > EPS);
}

/** Weltposition eines lokalen Wandpunkts (u entlang Achse, s quer zur Achse). */
export function wallLocalToWorld(g: WallGeometry, u: number, s: number): Vec2 {
  return {
    x: g.a.x + g.dir.x * u + g.normal.x * s,
    y: g.a.y + g.dir.y * u + g.normal.y * s,
  };
}


// ---------------------------------------------------------------------------
// Grundriss — massive Wandstücke mit geschlossenen Ecken
// ---------------------------------------------------------------------------

/**
 * Ein massives Wandstück im Grundriss, in Wandkoordinaten (u entlang der
 * Achse). `cap` sagt, *warum* das Stück dort endet — an einem Anschluss oder
 * an einer Öffnung. Der Unterschied ist zeichnerisch: an der Öffnung gehört
 * eine Laibungskante hin, am Anschluss nicht.
 */
export interface PlanWallPiece {
  uStart: number;
  uEnd: number;
  capStart: 'junction' | 'opening';
  capEnd: 'junction' | 'opening';
}

/** Wände je Knoten — Grundlage jeder Eckverlängerung. */
export function indexWallsByNode(walls: Wall[]): Map<string, Wall[]> {
  const map = new Map<string, Wall[]>();
  for (const w of walls) {
    for (const id of [w.a, w.b]) {
      const list = map.get(id);
      if (list) list.push(w);
      else map.set(id, [w]);
    }
  }
  return map;
}

/**
 * Zerlegt eine Wand im Grundriss in ihre massiven Teilstücke.
 *
 * Warum das hier steht und nicht im Zeichenpfad: Bildschirm und Ausdruck
 * müssen dieselbe Wand zeigen. Solange beide ihre eigene Zerlegung rechneten,
 * war der Unterschied unsichtbar — bis auf dem Papier die Ecken offen standen,
 * weil nur der Bildschirm über den Knoten hinaus verlängerte. Genau diese
 * Klasse Fehler ist der Grund, warum die Wandgeometrie eine Datei ist.
 *
 * An einem Anschlussknoten wird um die halbe Stärke der *dicksten* dort
 * ankommenden anderen Wand verlängert. Das schließt jede rechtwinklige Ecke
 * und jeden T-Stoß; bei schiefen Winkeln steht der Überstand innerhalb der
 * anderen Wand und ist unter deren Füllung nicht zu sehen.
 */
export function planWallPieces(
  g: WallGeometry,
  openings: Opening[],
  byNode: Map<string, Wall[]>,
): PlanWallPiece[] {
  const extendStart = junctionExtension(g.wall.a, byNode.get(g.wall.a) ?? [], g.wall);
  const extendEnd = junctionExtension(g.wall.b, byNode.get(g.wall.b) ?? [], g.wall);

  const spans = openings
    .map((op) => openingSpan(g, op))
    .filter((s) => s.to - s.from > 1e-4)
    .sort((a, b) => a.from - b.from);

  const pieces: PlanWallPiece[] = [];
  let cursor = -extendStart;
  const uMax = g.length + extendEnd;
  let capStart: PlanWallPiece['capStart'] = 'junction';

  for (const s of spans) {
    if (s.from > cursor + 1e-4) {
      pieces.push({ uStart: cursor, uEnd: s.from, capStart, capEnd: 'opening' });
    }
    cursor = Math.max(cursor, s.to);
    capStart = 'opening';
  }
  if (uMax > cursor + 1e-4) {
    pieces.push({ uStart: cursor, uEnd: uMax, capStart, capEnd: 'junction' });
  }
  return pieces;
}

// ---------------------------------------------------------------------------
// Modell → Szene (3D)
// ---------------------------------------------------------------------------

/**
 * Ein Punkt im Koordinatensystem der 3D-Szene.
 * Modell-x → Szene-x, Modell-y → Szene-**−z**, Höhe über Fertigfußboden → y.
 */
export interface ScenePoint {
  x: number;
  y: number;
  z: number;
}

/** Modellpunkt (Grundriss) plus Höhe → Szenenpunkt. */
export function modelToScene(p: Vec2, z = 0): ScenePoint {
  return { x: p.x, y: z, z: -p.y };
}

/**
 * Wo ein Stützpunkt landet, der in einer **flach gekippten Fläche** steckt.
 * ---------------------------------------------------------------------------
 * Eine Fläche wird in der Zeichenbibliothek in der xy-Ebene aufgebaut und
 * anschließend mit einer Drehung um die x-Achse um −90° in die Grundebene
 * gelegt. Diese Drehung ist
 *
 *     y' = y·cos(−90°) − z·sin(−90°) = z
 *     z' = y·sin(−90°) + z·cos(−90°) = −y
 *
 * und für einen Stützpunkt, der wie jeder Punkt einer ebenen Fläche bei
 * z = 0 liegt, also **(x, y, 0) → (x, 0, −y)**.
 *
 * Reine Nachrechnung, ohne die Zeichenbibliothek — damit die Prüfung sie
 * gegen `modelToScene` halten kann.
 */
export function flachGekippt(stuetzpunkt: Vec2, hoehe = 0): ScenePoint {
  return { x: stuetzpunkt.x, y: hoehe, z: -stuetzpunkt.y };
}

/**
 * Die Stützpunkte, mit denen eine flach gekippte Fläche den Grundriss trifft.
 * ---------------------------------------------------------------------------
 * **Sie sind die Modellkoordinaten selbst.** Das sieht nach einer Funktion
 * aus, die nichts tut, und genau darin liegt ihr Zweck: Die Frage „kommt hier
 * `p.y` oder `−p.y` hinein?" wird an **einer** Stelle beantwortet und in der
 * Prüfung gegen `modelToScene` gehalten.
 *
 * **Der Anlass.** Die Außenanlage — Grundstücksfläche, Nachbargebäude,
 * befestigte Fläche, Kollektorfeld — baute ihre Flächen mit `−p.y` auf und
 * kippte sie danach flach. Beide Vorzeichenwechsel hoben sich auf, und die
 * Flächen lagen **an der Modellachse gespiegelt** im Bild. Bei einem
 * rechteckigen Grundstück fiel das kaum auf; bei einem schiefwinkligen lag
 * die grüne Fläche sichtbar neben ihrer gelben Grenzlinie — gemeldet als „in
 * 3D ist das Grün verschoben". Die Raumböden machten es von jeher richtig;
 * die beiden Stellen wussten nichts voneinander.
 */
export function flacheStuetzpunkte(points: readonly Vec2[]): Vec2[] {
  return points.map((p) => ({ x: p.x, y: p.y }));
}

/**
 * Drehung um die Hochachse, die einen im Grundriss um `modelAngle` gedrehten
 * Körper in der Szene richtig hinstellt.
 *
 * Warum eine eigene Funktion, wo sie den Winkel unverändert zurückgibt?
 * Weil genau hier der Vorzeichenfehler saß, der Öffnungen im 3D-Modell neben
 * die Wand setzte. Die Abbildung y → −z spiegelt den Grundriss, und three
 * dreht um die Hochachse im Uhrzeigersinn (R_y(θ)·x̂ = (cos θ, 0, −sin θ)).
 * Beide Vorzeichenwechsel heben sich auf: der Szenenwinkel *ist* der
 * Modellwinkel. Die naheliegende „Korrektur" −modelAngle ist falsch — sie
 * spiegelt jeden Körper an der Waagerechten durch seinen eigenen Bezugspunkt,
 * was einer Drehung um −2·modelAngle entspricht.
 *
 * Unsichtbar bleibt das bei achsparallelen Wänden: ein Quader ist
 * punktsymmetrisch und fällt bei 0° wie bei 180° Verdrehung auf sich selbst
 * zurück. Bei jeder schrägen Wand nicht — dort wandert die Laibung einer
 * Öffnung um 2·r·min(|sin α|, |cos α|), mit r = Abstand der Laibung vom
 * Mittelpunkt ihres Teilquaders. Für eine 45°-Wand mit r = 0,75 m sind das
 * 1,06 m: die Aussparung liegt sichtbar in der Nachbarwand.
 */
export function sceneRotationY(modelAngle: number): number {
  return modelAngle;
}

/** Ein lokaler Wandpunkt (u entlang der Achse, s quer, z in der Höhe) in der Szene. */
export function wallLocalToScene(g: WallGeometry, u: number, s: number, z: number): ScenePoint {
  return modelToScene(wallLocalToWorld(g, u, s), z);
}

/** Lage und Maße eines Wandquaders in der Szene. */
export interface WallBoxPlacement {
  /** Mittelpunkt des Quaders. */
  center: ScenePoint;
  /** Drehung um die Hochachse [rad]. */
  rotationY: number;
  /** Kantenlängen: entlang der Achse, in der Höhe, quer zur Achse. */
  size: { length: number; height: number; thickness: number };
}

/**
 * Setzt einen Teilquader aus `wallSolidParts` (oder ein Bauteil in
 * Wandkoordinaten) in die Szene. Der 3D-Renderer rechnet die Lage damit nicht
 * mehr selbst nach, sondern konsumiert dieselbe Achse, dieselbe Bezugslänge
 * und denselben Startpunkt wie der Plan.
 *
 * Nach der Drehung zeigt die lokale +z-Kante des Quaders auf die
 * *Gegen*normale der Wand. Das ist der Preis dafür, die spiegelnde Abbildung
 * Modell → Szene mit einer echten Drehung auszuführen: eine Spiegelmatrix
 * hätte Determinante −1 und würde den Umlaufsinn aller Dreiecke kippen, die
 * Wände wären von außen unsichtbar. Für die in Dickenrichtung symmetrischen
 * Quader ist die Seitenvertauschung ohne Belang; wer asymmetrisch anbaut —
 * ein aufgeschlagenes Türblatt — muss sein Quermaß entsprechend spiegeln.
 */
export function wallBoxPlacement(
  g: WallGeometry,
  uStart: number,
  uEnd: number,
  zStart: number,
  zEnd: number,
  halfThickness: number,
  sOffset = 0,
): WallBoxPlacement {
  return {
    center: wallLocalToScene(g, (uStart + uEnd) / 2, sOffset, (zStart + zEnd) / 2),
    rotationY: sceneRotationY(g.angle),
    size: { length: uEnd - uStart, height: zEnd - zStart, thickness: halfThickness * 2 },
  };
}

/**
 * Projiziert einen Weltpunkt auf die nächstgelegene Wand — die Grundlage
 * für das Einsetzen von Türen/Fenstern per Drag & Drop.
 */
export function pickWallForOpening(
  point: Vec2,
  walls: Wall[],
  nodes: Record<string, BimNode>,
  maxDistance: number,
): { wall: Wall; geom: WallGeometry; distanceAlong: number } | null {
  let best: { wall: Wall; geom: WallGeometry; distanceAlong: number } | null = null;
  let bestDist = maxDistance;

  for (const wall of walls) {
    const g = getWallGeometry(wall, nodes);
    if (!g) continue;
    const rel = sub(point, g.a);
    const u = clamp(rel.x * g.dir.x + rel.y * g.dir.y, 0, g.length);
    const px = g.a.x + g.dir.x * u;
    const py = g.a.y + g.dir.y * u;
    const d = Math.sqrt((px - point.x) ** 2 + (py - point.y) ** 2);
    if (d < bestDist) {
      bestDist = d;
      best = { wall, geom: g, distanceAlong: u };
    }
  }
  return best;
}

/** Sortierte Öffnungen einer Wand — mehrfach pro Frame gebraucht. */
export function openingsOfWall(wallId: string, openings: Opening[]): Opening[] {
  return openings.filter((o) => o.wallId === wallId).sort((a, b) => a.distance - b.distance);
}

/**
 * Öffnungen einmal nach Wand sortieren, statt für jede Wand die ganze Liste
 * zu durchsuchen.
 *
 * `openingsOfWall` ist bequem und für eine Handvoll Wände völlig in Ordnung.
 * In einer Schleife über alle Wandabschnitte aller Räume wird daraus aber ein
 * Produkt: bei 1.700 Wänden und 1.700 Öffnungen sind das knapp drei Millionen
 * Vergleiche — je Export, je Prüfung, je Zeichenvorgang. Der Index kostet
 * einmal O(n) und macht dieselbe Abfrage danach konstant teuer.
 */
export function indexOpeningsByWall(openings: Opening[]): Map<string, Opening[]> {
  const index = new Map<string, Opening[]>();
  for (const o of openings) {
    const list = index.get(o.wallId);
    if (list) list.push(o);
    else index.set(o.wallId, [o]);
  }
  for (const list of index.values()) list.sort((a, b) => a.distance - b.distance);
  return index;
}

/** Leere Liste als geteilte Konstante — spart Allokationen in engen Schleifen. */
const NO_OPENINGS: Opening[] = [];

export const openingsOf = (index: Map<string, Opening[]>, wallId: string): Opening[] =>
  index.get(wallId) ?? NO_OPENINGS;

/** Außennormale einer Wandseite als Richtungsvektor (+1 = Linksnormale). */
export function wallSideNormal(g: WallGeometry, side: 1 | -1): Vec2 {
  return normalize({ x: g.normal.x * side, y: g.normal.y * side });
}
