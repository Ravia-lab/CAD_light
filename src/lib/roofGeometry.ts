/**
 * Dachgeometrie — die ortsabhängige Raumhöhe unter einer Schräge.
 * ---------------------------------------------------------------------------
 * Im Dachgeschoss stimmt nichts mehr, was im Regelgeschoss selbstverständlich
 * ist: Das Luftvolumen ist nicht Fläche × Höhe, eine Außenwand ist nicht
 * Länge × Geschosshöhe, und die Decke ist keine waagerechte Fläche, sondern
 * eine geneigte mit Giebeln an den Enden. Wer das Dachgeschoss wie ein
 * Regelgeschoss rechnet, bekommt zu viel Volumen (Lüftungsverlust zu hoch)
 * und zu viel Wandfläche (Transmission zu hoch) — bei gleichzeitig fehlender
 * Dachfläche, dem größten Verlustweg überhaupt.
 *
 * Deshalb wird hier alles über *eine* Funktion abgeleitet: die Höhe h(p) an
 * jedem Punkt des Grundrisses. Volumen, Dachfläche, Wandflächen und die
 * Wohnfläche nach WoFlV sind Integrale über diese Funktion.
 *
 * Die Integration läuft numerisch über ein Raster. Das ist bewusst gewählt:
 * eine geschlossene Lösung müsste das Raumpolygon an jeder Höhenlinie
 * zerschneiden — viel Code für Fälle, die in der Praxis nie auftreten. Das
 * Raster ist bei 5 cm auf zwei Nachkommastellen genau und bleibt bei
 * beliebig verwinkelten Räumen richtig.
 */

import type { RoofDefinition, RoofOpening, RoomRoofMetrics, Vec2 } from '../types/bim';
import { pointInPolygon, polygonArea } from './geometry';

const TO_RAD = Math.PI / 180;

/** Rasterweite der numerischen Integration [m]. */
export const ROOF_SAMPLE_STEP = 0.05;

/**
 * Vorberechneter Bezugsrahmen eines Daches: Richtung, Firstachse und die
 * Ausdehnung des Grundrisses in Neigungsrichtung. Einmal je Geschoss gebildet,
 * danach ist `roofHeightAt` reine Arithmetik.
 */
export interface RoofFrame {
  roof: RoofDefinition;
  /** Einheitsvektor in Fallrichtung (weg vom First). */
  dir: Vec2;
  /** Einheitsvektor längs des Firsts. */
  along: Vec2;
  /** Mittelpunkt des Grundrisses. */
  centre: Vec2;
  /** Lage der Firstachse, gemessen als Projektion auf `dir` ab `centre` [m]. */
  ridgeT: number;
  /** Ausdehnung des Grundrisses in Fall- und Firstrichtung ab `centre` [m]. */
  halfSpanT: number;
  halfSpanS: number;
  /** Höhe der Firstlinie über Rohfußboden [m]. */
  ridgeHeight: number;
  /** Steigung tan(pitch) — pro Meter Horizontalabstand. */
  slope: number;
  /** Gauben und Dachflächenfenster dieses Geschosses. */
  openings: RoofOpening[];
}

/**
 * Baut den Bezugsrahmen aus der Dachdefinition und den Eckpunkten des
 * Geschossgrundrisses. Ohne Punkte oder ohne Neigung gibt es kein Dach —
 * dann liefert die Funktion `null` und alle Aufrufer rechnen wie bisher.
 */
export function buildRoofFrame(
  roof: RoofDefinition | undefined,
  outline: readonly Vec2[],
  openings: readonly RoofOpening[] = [],
): RoofFrame | null {
  if (!roof || roof.kind === 'flat') return null;
  if (!(roof.pitch > 0) || roof.pitch >= 89) return null;
  if (outline.length < 3) return null;

  const a = roof.azimuth * TO_RAD;
  const dir = { x: Math.sin(a), y: Math.cos(a) };
  const along = { x: dir.y, y: -dir.x };

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of outline) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const centre = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };

  let minT = Infinity;
  let maxT = -Infinity;
  let minS = Infinity;
  let maxS = -Infinity;
  for (const p of outline) {
    const dx = p.x - centre.x;
    const dy = p.y - centre.y;
    const t = dx * dir.x + dy * dir.y;
    const s = dx * along.x + dy * along.y;
    minT = Math.min(minT, t);
    maxT = Math.max(maxT, t);
    minS = Math.min(minS, s);
    maxS = Math.max(maxS, s);
  }

  const halfSpanT = (maxT - minT) / 2;
  const halfSpanS = (maxS - minS) / 2;
  const slope = Math.tan(roof.pitch * TO_RAD);
  const knee = Math.max(0, roof.kneeHeight);

  let ridgeT: number;
  let rise: number;

  if (roof.kind === 'monopitch') {
    // Pultdach: der First sitzt an der oberen Kante, das Dach fällt in
    // Richtung `azimuth` bis zur gegenüberliegenden Traufe.
    ridgeT = minT;
    rise = (maxT - minT) * slope;
  } else if (roof.kind === 'hip') {
    // Walmdach: von allen vier Seiten geneigt. Der First liegt mittig, seine
    // Höhe folgt der *kürzeren* Gebäudeseite — dort treffen sich die Walme.
    ridgeT = 0 + roof.ridgeOffset;
    rise = Math.min(halfSpanT, halfSpanS) * slope;
  } else {
    // Satteldach: First mittig, wahlweise versetzt. Beide Flächen haben
    // dieselbe Neigung, also bestimmt die *längere* Spannweite die Firsthöhe;
    // die kürzere Seite endet dann entsprechend höher als der Kniestock.
    ridgeT = roof.ridgeOffset;
    rise = Math.max(ridgeT - minT, maxT - ridgeT) * slope;
  }

  const ridgeHeight = Math.max(knee, knee + rise);

  return {
    roof,
    dir,
    along,
    centre,
    ridgeT,
    halfSpanT,
    halfSpanS,
    // Ein Dach, das flacher endet als die Geschosshöhe, ist zulässig — dann
    // steht der First unter der Rohdecke. Umgekehrt wird nicht gekappt: die
    // Geschosshöhe beschreibt hier den Kniestock, nicht den First.
    ridgeHeight,
    slope,
    openings: [...openings],
  };
}

/**
 * Lichte Höhe der *reinen* Dachfläche, ohne Gauben. Sie wird für die Gauben
 * selbst gebraucht: eine Gaube setzt auf dem Dach auf und muss wissen, wo das
 * Dach unter ihr liegt.
 */
export function baseRoofHeightAt(frame: RoofFrame, p: Vec2): number {
  const dx = p.x - frame.centre.x;
  const dy = p.y - frame.centre.y;
  const t = dx * frame.dir.x + dy * frame.dir.y;

  let drop: number;
  if (frame.roof.kind === 'monopitch') {
    drop = Math.max(0, t - frame.ridgeT) * frame.slope;
  } else if (frame.roof.kind === 'hip') {
    // Abstand zur nächsten Traufkante im gedrehten Rechteck.
    const s = dx * frame.along.x + dy * frame.along.y;
    const toEaveT = frame.halfSpanT - Math.abs(t - frame.ridgeT);
    const toEaveS = frame.halfSpanS - Math.abs(s);
    const nearest = Math.min(toEaveT, toEaveS);
    drop = (Math.min(frame.halfSpanT, frame.halfSpanS) - Math.max(0, nearest)) * frame.slope;
  } else {
    drop = Math.abs(t - frame.ridgeT) * frame.slope;
  }

  let h = frame.ridgeHeight - drop;

  // Kehlbalkenlage: darüber wird die Decke waagerecht.
  const collar = frame.roof.collarHeight;
  if (typeof collar === 'number' && collar > 0) h = Math.min(h, collar);

  return Math.max(frame.roof.kneeHeight, h);
}

/**
 * Lage eines Punktes bezogen auf eine Gaube: liegt er in ihrer Grundfläche,
 * und wenn ja, wie weit ist er von der Gaubenfront entfernt (0 = Front,
 * 1 = Rückseite)? Gerechnet wird im Dach-Bezugssystem, damit die Gaube
 * automatisch in Fallrichtung ausgerichtet ist — schräg in der Dachfläche
 * sitzende Gauben gibt es am Bau nicht.
 */
function localToDormer(
  frame: RoofFrame,
  opening: RoofOpening,
  p: Vec2,
): { inside: boolean; along: number; lateral: number } {
  const dx = p.x - opening.position.x;
  const dy = p.y - opening.position.y;
  const t = dx * frame.dir.x + dy * frame.dir.y;
  const u = dx * frame.along.x + dy * frame.along.y;
  // Kleine Toleranz: die Richtungsvektoren kommen aus sin/cos und treffen
  // die Kante nie exakt. Ein Punkt genau auf der Gaubenkante fiele sonst je
  // nach Rundung mal hinein und mal heraus.
  const EDGE = 1e-6;
  const inside =
    Math.abs(t) <= opening.depth / 2 + EDGE && Math.abs(u) <= opening.width / 2 + EDGE;
  // Die Front liegt talwärts. Bei einem Satteldach hängt das davon ab, auf
  // welcher Seite des Firsts die Gaube sitzt: rechts davon fällt das Dach in
  // Richtung `dir`, links davon dagegen. Ohne dieses Vorzeichen zeigten alle
  // Gauben in dieselbe Richtung — die eine Hälfte davon in den Berg hinein.
  const side = dormerSide(frame, opening);
  const along = 0.5 - (t * side) / Math.max(opening.depth, 1e-6);
  // Seitliche Lage, 0 in der Mitte und 1 an der Wange — nur die Giebelgaube
  // braucht sie, weil ihre Front oben spitz zuläuft.
  const lateral = Math.min(1, Math.abs(u) / Math.max(opening.width / 2, 1e-6));
  return { inside, along: Math.max(0, Math.min(1, along)), lateral };
}

/**
 * Höhe der Gaubenoberkante an der Front, seitlich veränderlich.
 *
 * Die Schleppgaube hat eine waagerechte Oberkante. Die Giebelgaube läuft in
 * der Mitte spitz zu — genau das macht sie aus, und genau daraus folgen ihre
 * größere Front und ihr zweiflächiges Dach.
 */
export function dormerFrontHeightAt(opening: RoofOpening, lateral: number): number {
  const base = opening.frontHeight ?? 2.2;
  if (opening.kind !== 'dormer-gable') return base;
  return base + defaultGableRise(opening) * (1 - lateral);
}

/** Giebelhöhe der Gaube; ohne Angabe aus der Breite abgeleitet (rund 35°). */
export function defaultGableRise(opening: RoofOpening): number {
  if (typeof opening.gableRise === 'number') return Math.max(0, opening.gableRise);
  return (opening.width / 2) * Math.tan((35 * Math.PI) / 180);
}

/**
 * Auf welcher Dachseite sitzt die Öffnung? +1 = talwärts in `dir`,
 * −1 = talwärts entgegen `dir`.
 */
export function dormerSide(frame: RoofFrame, opening: { position: Vec2 }): 1 | -1 {
  if (frame.roof.kind === 'monopitch') return 1;
  const dx = opening.position.x - frame.centre.x;
  const dy = opening.position.y - frame.centre.y;
  const t = dx * frame.dir.x + dy * frame.dir.y;
  return t >= frame.ridgeT ? 1 : -1;
}

/** Front- und Rückpunkt einer Gaube auf der Dachfläche. */
export function dormerFrontBack(
  frame: RoofFrame,
  opening: RoofOpening,
): { front: Vec2; back: Vec2 } {
  const side = dormerSide(frame, opening);
  const half = (opening.depth / 2) * side;
  return {
    front: {
      x: opening.position.x + frame.dir.x * half,
      y: opening.position.y + frame.dir.y * half,
    },
    back: {
      x: opening.position.x - frame.dir.x * half,
      y: opening.position.y - frame.dir.y * half,
    },
  };
}

/**
 * Lichte Höhe unter dem Dach, Gauben eingerechnet.
 *
 * Innerhalb einer Gaube läuft die Decke von der Frontkante (dort so hoch wie
 * die Gaube) linear zurück, bis sie das Hauptdach trifft. Das ist genau die
 * Geometrie einer Schleppgaube — und die Giebelgaube unterscheidet sich davon
 * im Grundriss nur in der Front, nicht in der lichten Höhe.
 */
export function roofHeightAt(frame: RoofFrame, p: Vec2): number {
  const base = baseRoofHeightAt(frame, p);
  let best = base;

  for (const opening of frame.openings) {
    if (opening.kind === 'skylight') continue;
    const local = localToDormer(frame, opening, p);
    if (!local.inside) continue;

    const front = dormerFrontHeightAt(opening, local.lateral);
    // Hinterkante: dort schließt die Gaube an das Hauptdach an.
    const back = baseRoofHeightAt(frame, dormerFrontBack(frame, opening).back);
    // `along` ist 0 an der Front und 1 an der Rückseite: dort trifft die
    // Gaubendecke wieder auf das Hauptdach.
    const h = front + (back - front) * local.along;
    if (h > best) best = h;
  }

  return best;
}


/** Liegt an diesem Punkt die waagerechte Kehlbalkendecke statt der Schräge? */
function isCollarZone(frame: RoofFrame, h: number): boolean {
  const collar = frame.roof.collarHeight;
  return typeof collar === 'number' && collar > 0 && h >= collar - 1e-6;
}

/**
 * Welche Dachfläche liegt über diesem Punkt? Für das Satteldach die Seite
 * links oder rechts des Firsts, für das Walmdach zusätzlich die beiden Walme.
 * Der Rückgabewert ist der Azimut der Dachfläche [°].
 */
export function roofFaceAzimuthAt(frame: RoofFrame, p: Vec2): number {
  const dx = p.x - frame.centre.x;
  const dy = p.y - frame.centre.y;
  const t = dx * frame.dir.x + dy * frame.dir.y;
  const base = frame.roof.azimuth;

  if (frame.roof.kind === 'monopitch') return norm360(base);
  if (frame.roof.kind === 'gable') return norm360(t >= frame.ridgeT ? base : base + 180);

  // Walmdach: die nächstgelegene der vier Traufkanten bestimmt die Fläche.
  const s = dx * frame.along.x + dy * frame.along.y;
  const toEaveT = frame.halfSpanT - Math.abs(t - frame.ridgeT);
  const toEaveS = frame.halfSpanS - Math.abs(s);
  if (toEaveT <= toEaveS) return norm360(t >= frame.ridgeT ? base : base + 180);
  return norm360(s >= 0 ? base - 90 : base + 90);
}

const norm360 = (deg: number): number => ((deg % 360) + 360) % 360;

/**
 * Rastert einen Raum unter dem Dach ab und liefert alle abgeleiteten
 * Kennwerte. `polygon` ist das lichte Innenpolygon des Raums.
 */
export function measureRoomUnderRoof(
  frame: RoofFrame,
  polygon: readonly Vec2[],
  step = ROOF_SAMPLE_STEP,
): RoomRoofMetrics {
  const area = Math.abs(polygonArea(polygon));
  if (polygon.length < 3 || area <= 0) {
    return {
      volume: 0,
      averageHeight: 0,
      minHeight: 0,
      maxHeight: 0,
      slopedArea: 0,
      slopedAreaByFace: [],
      flatCeilingArea: 0,
      gableArea: 0,
      livingArea: 0,
      areaBelow1m: 0,
      skylightArea: 0,
      dormerFrontArea: 0,
      dormerCheekArea: 0,
      dormerRoofArea: 0,
      dormerVolume: 0,
    };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of polygon) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }

  const cell = step * step;
  const cosPitch = Math.cos(frame.roof.pitch * TO_RAD);

  let hits = 0;
  let volume = 0;
  let living = 0;
  let below1 = 0;
  let sloped = 0;
  let flat = 0;
  let dormerFootprint = 0;
  let dormerVolume = 0;
  let dormerRoofSlope = 0;
  const byFace = new Map<number, number>();
  let minHeight = Infinity;
  let maxHeight = -Infinity;

  for (let y = minY + step / 2; y < maxY; y += step) {
    for (let x = minX + step / 2; x < maxX; x += step) {
      const p = { x, y };
      if (!pointInPolygon(p, polygon)) continue;
      hits++;

      const h = roofHeightAt(frame, p);
      const base = baseRoofHeightAt(frame, p);
      volume += h;
      // Was über der reinen Dachebene liegt, hat eine Gaube dazugewonnen.
      if (h > base + 1e-6) {
        dormerVolume += h - base;
        dormerFootprint += 1;
      }
      minHeight = Math.min(minHeight, h);
      maxHeight = Math.max(maxHeight, h);

      // WoFlV §4: über 2,00 m voll, 1,00 bis 2,00 m zur Hälfte, darunter nicht.
      if (h >= 2) living += 1;
      else if (h >= 1) living += 0.5;
      else below1 += 1;

      if (h > base + 1e-6) {
        // Über der Gaube liegt ihr eigenes Dach, nicht das Hauptdach. Die
        // Neigung ergibt sich aus dem Höhenunterschied über die Gaubentiefe.
        dormerRoofSlope += 1;
      } else if (isCollarZone(frame, h)) {
        flat += 1;
      } else {
        sloped += 1;
        // Nach Dachfläche getrennt zählen: die Himmelsrichtung einer
        // Dachfläche entscheidet über solare Gewinne und die Abschirmung.
        const face = Math.round(roofFaceAzimuthAt(frame, p));
        byFace.set(face, (byFace.get(face) ?? 0) + 1);
      }
    }
  }

  // Das Raster trifft die Fläche nur näherungsweise; skaliert auf die exakte
  // Polygonfläche bleiben Volumen und Teilflächen konsistent zur Grundfläche.
  const scale = hits > 0 ? area / (hits * cell) : 0;
  const f = cell * scale;

  return {
    volume: round2(volume * f),
    averageHeight: hits > 0 ? round3((volume / hits)) : 0,
    minHeight: Number.isFinite(minHeight) ? round3(minHeight) : 0,
    maxHeight: Number.isFinite(maxHeight) ? round3(maxHeight) : 0,
    // Die geneigte Fläche ist die projizierte geteilt durch cos(Neigung).
    slopedArea: round2((sloped * f) / (cosPitch || 1)),
    slopedAreaByFace: [...byFace.entries()]
      .map(([azimuth, cells]) => ({ azimuth, area: round2((cells * f) / (cosPitch || 1)) }))
      .filter((e) => e.area > 0.01)
      .sort((a, b) => b.area - a.area),
    flatCeilingArea: round2(flat * f),
    gableArea: 0, // wird aus den Wandprofilen gefüllt, siehe wallProfileUnderRoof
    livingArea: round2(living * f),
    areaBelow1m: round2(below1 * f),
    ...dormerAndSkylightAreas(frame, polygon, {
      dormerFootprintArea: dormerFootprint * f,
      dormerRoofProjected: dormerRoofSlope * f,
      dormerVolume: dormerVolume * f,
    }),
  };
}

/**
 * Die Bauteilflächen von Gauben und Dachflächenfenstern.
 *
 * Die Grundflächen kommen aus dem Raster (sie folgen dem Raumzuschnitt), die
 * senkrechten Flächen dagegen aus der Geometrie der Gaube selbst — sie stehen
 * am Rand der Grundfläche und wären im Raster nur ungenau zu treffen.
 * Gezählt wird eine Gaube nur, wenn ihr Mittelpunkt in diesem Raum liegt;
 * sonst bekämen zwei Räume dieselbe Front angerechnet.
 */
function dormerAndSkylightAreas(
  frame: RoofFrame,
  polygon: readonly Vec2[],
  raster: { dormerFootprintArea: number; dormerRoofProjected: number; dormerVolume: number },
): Pick<
  RoomRoofMetrics,
  'skylightArea' | 'dormerFrontArea' | 'dormerCheekArea' | 'dormerRoofArea' | 'dormerVolume'
> {
  let skylight = 0;
  let front = 0;
  let cheek = 0;
  let dormerRoof = 0;

  for (const opening of frame.openings) {
    if (!pointInPolygon(opening.position, polygon)) continue;

    if (opening.kind === 'skylight') {
      // Das Fenster liegt *in* der Dachebene; Breite und Höhe sind bereits
      // dort gemessen, also keine Umrechnung über cos(Neigung).
      skylight += opening.width * opening.depth;
      continue;
    }

    const frontHeight = opening.frontHeight ?? 2.2;
    const { front: frontPoint, back: backPoint } = dormerFrontBack(frame, opening);
    const atFront = baseRoofHeightAt(frame, frontPoint);
    const atBack = baseRoofHeightAt(frame, backPoint);

    // Front: senkrechtes Rechteck zwischen Dachfläche und Gaubenoberkante.
    // Bei der Giebelgaube kommt das Dreieck der Giebelspitze dazu —
    // ½ · Breite · Giebelhöhe, unabhängig davon, wo die Gaube sitzt.
    const frontRise = Math.max(0, frontHeight - atFront);
    const gableRise = opening.kind === 'dormer-gable' ? defaultGableRise(opening) : 0;
    front += opening.width * frontRise + 0.5 * opening.width * gableRise;

    // Wangen: das Dreieck zwischen Gaubendecke und Hauptdach, zweimal.
    // Näherung über den mittleren Höhenunterschied — bei der Giebelgaube
    // etwas zu groß, bei der Schleppgaube exakt.
    const meanRise = Math.max(0, (frontRise + Math.max(0, frontHeight - atBack)) / 2);
    cheek += 2 * opening.depth * meanRise * 0.5;

    // Gaubendach: die geneigte Fläche von der Front nach hinten. Beim
    // Giebeldach kippt sie zusätzlich quer zur Firstlinie der Gaube; die
    // Querneigung vergrößert die Fläche um 1/cos(Querwinkel).
    const dz = Math.max(0, frontHeight - atBack);
    const lateralTilt =
      gableRise > 0 ? Math.cos(Math.atan2(gableRise, Math.max(opening.width / 2, 1e-6))) : 1;
    dormerRoof += (opening.width * Math.hypot(opening.depth, dz)) / (lateralTilt || 1);
  }

  return {
    skylightArea: round2(skylight),
    dormerFrontArea: round2(front),
    dormerCheekArea: round2(cheek),
    // Liegt keine Gaube mit ihrem Mittelpunkt im Raum, aber ragt eine herein,
    // bleibt wenigstens die gerasterte Dachfläche erhalten.
    dormerRoofArea: round2(dormerRoof > 0 ? dormerRoof : raster.dormerRoofProjected),
    dormerVolume: round2(raster.dormerVolume),
  };
}

/** Ergebnis der Integration entlang einer Wand unter dem Dach. */
export interface WallRoofProfile {
  /** Gesamte Wandfläche unter der Schräge [m²] = ∫ h(s) ds. */
  grossArea: number;
  /** Anteil bis Kniestockhöhe [m²] — die eigentliche Wand. */
  kneeArea: number;
  /** Anteil oberhalb des Kniestocks [m²] — der Giebel. */
  gableArea: number;
  minHeight: number;
  maxHeight: number;
}

/**
 * Integriert die Wandhöhe entlang eines Wandabschnitts.
 *
 * Getrennt ausgewiesen wird der Teil oberhalb der Traufe: das ist der Giebel,
 * der in der Praxis oft anders aufgebaut ist als die Wand darunter (Holz,
 * Vorhangfassade) und deshalb einen eigenen U-Wert bekommt.
 */
export function wallProfileUnderRoof(
  frame: RoofFrame,
  a: Vec2,
  b: Vec2,
  step = ROOF_SAMPLE_STEP,
): WallRoofProfile {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (length <= 1e-6) {
    return { grossArea: 0, kneeArea: 0, gableArea: 0, minHeight: 0, maxHeight: 0 };
  }

  const n = Math.max(2, Math.ceil(length / step));
  const ds = length / n;
  const knee = frame.roof.kneeHeight;

  let total = 0;
  let above = 0;
  let minHeight = Infinity;
  let maxHeight = -Infinity;

  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n;
    const p = { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
    const h = roofHeightAt(frame, p);
    total += h;
    above += Math.max(0, h - knee);
    minHeight = Math.min(minHeight, h);
    maxHeight = Math.max(maxHeight, h);
  }

  return {
    grossArea: round2(total * ds),
    kneeArea: round2((total - above) * ds),
    gableArea: round2(above * ds),
    minHeight: Number.isFinite(minHeight) ? round3(minHeight) : 0,
    maxHeight: Number.isFinite(maxHeight) ? round3(maxHeight) : 0,
  };
}

/**
 * Höhenlinie im Grundriss: die Punkte, an denen die lichte Höhe genau `h`
 * beträgt. Für die 1-m- und 2-m-Linie nach WoFlV, die im Plan eingezeichnet
 * werden — sie zeigen sofort, wo ein Dachraum noch nutzbar ist.
 *
 * Geliefert werden Strecken in Weltkoordinaten, lang genug, um über den
 * ganzen Grundriss zu reichen; der Zeichner klippt sie am Raumpolygon.
 */
export function roofContourLines(frame: RoofFrame, height: number): { a: Vec2; b: Vec2 }[] {
  if (height <= frame.roof.kneeHeight || height >= frame.ridgeHeight) return [];

  const drop = frame.ridgeHeight - height;
  const distance = drop / frame.slope;
  const reach = Math.max(frame.halfSpanT, frame.halfSpanS) * 2 + 2;

  const ridgeOrigin = {
    x: frame.centre.x + frame.dir.x * frame.ridgeT,
    y: frame.centre.y + frame.dir.y * frame.ridgeT,
  };

  const lineAt = (offset: number) => ({
    a: {
      x: ridgeOrigin.x + frame.dir.x * offset - frame.along.x * reach,
      y: ridgeOrigin.y + frame.dir.y * offset - frame.along.y * reach,
    },
    b: {
      x: ridgeOrigin.x + frame.dir.x * offset + frame.along.x * reach,
      y: ridgeOrigin.y + frame.dir.y * offset + frame.along.y * reach,
    },
  });

  if (frame.roof.kind === 'monopitch') return [lineAt(distance)];
  if (frame.roof.kind === 'gable') return [lineAt(distance), lineAt(-distance)];

  // Walmdach: rundum, also zusätzlich die beiden Linien längs des Firsts.
  const perpAt = (offset: number) => ({
    a: {
      x: ridgeOrigin.x + frame.along.x * offset - frame.dir.x * reach,
      y: ridgeOrigin.y + frame.along.y * offset - frame.dir.y * reach,
    },
    b: {
      x: ridgeOrigin.x + frame.along.x * offset + frame.dir.x * reach,
      y: ridgeOrigin.y + frame.along.y * offset + frame.dir.y * reach,
    },
  });
  return [lineAt(distance), lineAt(-distance), perpAt(distance), perpAt(-distance)];
}

/** Die Firstlinie als Strecke — für Plan und Modell. */
export function ridgeLine(frame: RoofFrame): { a: Vec2; b: Vec2 } {
  const reach = frame.halfSpanS;
  const o = {
    x: frame.centre.x + frame.dir.x * frame.ridgeT,
    y: frame.centre.y + frame.dir.y * frame.ridgeT,
  };
  return {
    a: { x: o.x - frame.along.x * reach, y: o.y - frame.along.y * reach },
    b: { x: o.x + frame.along.x * reach, y: o.y + frame.along.y * reach },
  };
}

const round2 = (v: number): number => Math.round(v * 100) / 100;
const round3 = (v: number): number => Math.round(v * 1000) / 1000;

/** Die vier Eckpunkte einer Dachöffnung im Grundriss, im Dach-Bezugssystem. */
export function roofOpeningCorners(frame: RoofFrame, opening: RoofOpening): Vec2[] {
  const ht = opening.depth / 2;
  const hu = opening.width / 2;
  const d = frame.dir;
  const a = frame.along;
  const c = opening.position;
  return [
    { x: c.x - d.x * ht - a.x * hu, y: c.y - d.y * ht - a.y * hu },
    { x: c.x + d.x * ht - a.x * hu, y: c.y + d.y * ht - a.y * hu },
    { x: c.x + d.x * ht + a.x * hu, y: c.y + d.y * ht + a.y * hu },
    { x: c.x - d.x * ht + a.x * hu, y: c.y - d.y * ht + a.y * hu },
  ];
}

/** Trefferprüfung im Grundriss. */
export function hitTestRoofOpening(frame: RoofFrame, opening: RoofOpening, p: Vec2): boolean {
  const dx = p.x - opening.position.x;
  const dy = p.y - opening.position.y;
  const t = dx * frame.dir.x + dy * frame.dir.y;
  const u = dx * frame.along.x + dy * frame.along.y;
  return Math.abs(t) <= opening.depth / 2 && Math.abs(u) <= opening.width / 2;
}
