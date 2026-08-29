/**
 * Viewer3D — Three.js-Echtzeitansicht im Clay-/Architekturmodell-Look.
 * ---------------------------------------------------------------------------
 * Renderstrategie:
 *
 *  • Die Wände entstehen aus *denselben* `wallSolidParts`, die auch der
 *    2D-Editor benutzt. Türen und Fenster sind damit echte Aussparungen mit
 *    Brüstung und Sturz — ohne CSG, ohne Boolesche Operationen.
 *  • Auch die *Lage* der Quader kommt aus `wallGeometry` (`wallBoxPlacement`,
 *    `wallLocalToScene`, `sceneRotationY`) und nicht aus einer zweiten
 *    Rechnung hier. Die Abbildung Modell → Szene (x, y) → (x, −y) spiegelt
 *    den Grundriss; wer den Drehsinn dabei ein zweites Mal von Hand umdreht,
 *    setzt jede Öffnung einer schrägen Wand daneben.
 *  • Alle Wandquader werden pro Materialgruppe zu *einer* Geometrie
 *    zusammengeführt (`mergeGeometries`). Ein Grundriss mit 60 Wänden und 20
 *    Öffnungen landet so bei einer Handvoll Draw Calls statt bei hunderten.
 *  • Die Geometrie wird nur neu gebaut, wenn sich Knoten, Wände, Öffnungen
 *    oder Räume ändern — Kamerabewegungen lösen keinen Rebuild aus.
 *  • `setAnimationLoop` läuft nur, solange die Ansicht sichtbar ist; beim
 *    Wechsel in den reinen 2D-Modus wird der Loop gestoppt.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type {
  CameraMode,
  Fixture,
  FixtureType,
  Opening,
  PipeAccessory,
  PipeRun,
  RoofDefinition,
  RoofOpening,
  Room,
  SitePlan,
  Vec2,
  SolidElement,
  VerticalElement,
  Wall,
} from '../types/bim';
import { PIPE_SERVICE_COLORS } from '../types/bim';
import { solidFootprint, stairPath, stairRunLength, verticalCorners } from '../lib/verticalSymbols';
import {
  getWallGeometry,
  junctionExtension,
  modelToScene,
  openingSpan,
  openingsOfWall,
  sceneRotationY,
  wallBoxPlacement,
  wallLocalToScene,
  wallLocalToWorld,
  wallSolidParts,
  type WallGeometry,
} from '../lib/wallGeometry';
import { pointInPolygon } from '../lib/geometry';
import { buildRoofFrame, roofHeightAt } from '../lib/roofGeometry';
import { levelBaseHeights } from '../lib/levelGeometry';
import { groundSlab, holeFitsOutline, levelSlabs, type SlabPlan } from '../lib/slabGeometry';
import { useBimStore } from '../store/useBimStore';

// ---------------------------------------------------------------------------
// Materialien — einmalig erzeugt und über alle Rebuilds hinweg wiederverwendet
// ---------------------------------------------------------------------------

function createMaterials() {
  const clay = new THREE.MeshStandardMaterial({
    color: 0xd8dee9,
    roughness: 0.92,
    metalness: 0.0,
    flatShading: false,
  });

  const clayInterior = new THREE.MeshStandardMaterial({
    color: 0xb9c2d0,
    roughness: 0.95,
    metalness: 0.0,
  });

  const floor = new THREE.MeshStandardMaterial({
    color: 0x8d97a8,
    roughness: 1.0,
    metalness: 0.0,
  });

  // Dachflächen etwas dunkler als die Wände und beidseitig sichtbar: man
  // schaut im Modell fast immer von schräg oben *und* von innen darauf.
  const roof = new THREE.MeshStandardMaterial({
    color: 0xa3adbd,
    roughness: 0.96,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });

  const stair = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.85, metalness: 0.02 });
  const shaft = new THREE.MeshStandardMaterial({
    color: 0xa78bfa,
    roughness: 0.7,
    metalness: 0.05,
    transparent: true,
    opacity: 0.55,
  });

  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x38bdf8,
    roughness: 0.06,
    metalness: 0.0,
    transmission: 0.82,
    thickness: 0.02,
    transparent: true,
    opacity: 0.42,
    side: THREE.DoubleSide,
  });

  const frame = new THREE.MeshStandardMaterial({
    color: 0x2f3947,
    roughness: 0.6,
    metalness: 0.15,
  });

  const door = new THREE.MeshStandardMaterial({
    color: 0x7dd3fc,
    roughness: 0.55,
    metalness: 0.05,
  });

  // TGA-Körper bewusst farbig und leicht glänzend: sie sollen sich vom
  // Clay-Look der Architektur klar absetzen, ohne ihn zu dominieren.
  const heating = new THREE.MeshStandardMaterial({ color: 0xf87171, roughness: 0.5, metalness: 0.1 });
  const sanitary = new THREE.MeshStandardMaterial({ color: 0xbae6fd, roughness: 0.2, metalness: 0.05 });
  const ventilation = new THREE.MeshStandardMaterial({ color: 0x34d399, roughness: 0.45, metalness: 0.1 });

  /**
   * Massive Bauteile: Mauerwerkston, matt und ohne Transparenz.
   *
   * Der Schacht ist halbdurchsichtig, weil er ein Hohlraum ist; ein Kamin ist
   * das Gegenteil. Die Farbe ist dieselbe wie im Plan, damit das Bauteil in
   * beiden Ansichten dasselbe Ding bleibt.
   */
  const masonry = new THREE.MeshStandardMaterial({ color: 0xcf8a6b, roughness: 0.85, metalness: 0.02 });

  /**
   * Geschossdecke: Rohbeton, etwas dunkler als die Wand.
   *
   * Sie muss sich vom Wandton absetzen, sonst verschmilzt das Haus in der
   * Isometrie zu einem einzigen Block und man sieht die Geschossteilung
   * wieder nicht — nur diesmal aus dem umgekehrten Grund.
   */
  const slab = new THREE.MeshStandardMaterial({ color: 0x9aa5b5, roughness: 0.95, metalness: 0.0 });

  return { clay, clayInterior, floor, roof, stair, shaft, masonry, slab, glass, frame, door, heating, sanitary, ventilation };
}

type Materials = ReturnType<typeof createMaterials>;

// ---------------------------------------------------------------------------
// Geometrie-Aufbau
// ---------------------------------------------------------------------------

interface BuildInput {
  walls: Wall[];
  openings: Opening[];
  rooms: Room[];
  fixtures: Fixture[];
  nodes: Record<string, { x: number; y: number }>;
  roof?: RoofDefinition;
  roofOpenings: RoofOpening[];
  verticals: VerticalElement[];
  solids: SolidElement[];
  /**
   * Deckenplatten zwischen den Geschossen.
   *
   * Ohne sie stand zwischen Wandoberkante und dem nächsten Geschoss die
   * Deckenstärke als Luft — das Haus zerfiel optisch in schwebende Scheiben.
   */
  slabs: SlabPlan[];
  pipes: PipeRun[];
  accessories: PipeAccessory[];
  levelHeight: number;
  /**
   * Höhenlage je Geschoss [m] — Oberkante Rohdecke über dem Bezugspunkt.
   *
   * Ohne sie zeichnete die Ansicht **jedes** Geschoss bei Höhe null: alle
   * Stockwerke standen ineinander, und man sah nur das oberste. Das Modell
   * zeigt jetzt das Haus, wie es steht — Erdgeschoss über Keller, Obergeschoss
   * über Erdgeschoss.
   */
  levelBase: Map<string, number>;
  /** Geschoss, auf dem das Dach sitzt. */
  roofLevelId?: string;
}

/** Bauhöhe der TGA-Körper [m] — grob, aber maßstäblich genug fürs Modell. */
const FIXTURE_HEIGHT: Partial<Record<FixtureType, number>> = {
  radiator: 0.6,
  'radiator-tube': 0.6,
  convector: 0.12,
  underfloor: 0.02,
  manifold: 0.7,
  boiler: 0.9,
  thermostat: 0.12,
  wc: 0.42,
  washbasin: 0.2,
  shower: 0.05,
  bathtub: 0.55,
  sink: 0.2,
  // Unterschrankzeile: 0,72 m Korpus auf 0,10 m Sockel plus 0,04 m
  // Arbeitsplatte — die im deutschen Küchenbau übliche Arbeitshöhe von
  // rund 0,90 m. Herstellermaß, keine Norm.
  'kitchen-unit': 0.86,
  'water-heater': 0.9,
  'floor-drain': 0.02,
  'air-supply': 0.04,
  'air-exhaust': 0.04,
  'air-transfer': 0.06,
  ahu: 0.5,
  duct: 0.2,
};

/**
 * Erzeugt einen Quader in Wandkoordinaten und stellt ihn in die Szene.
 *
 * Lage, Drehung und Maße kommen vollständig aus `wallBoxPlacement` — derselben
 * Geometriequelle, aus der der Plan seine Laibungen zeichnet. Der Renderer
 * darf die Achse einer schrägen Wand nicht selbst nachrechnen: genau daraus
 * entstand der Versatz zwischen Aussparung im Plan und Aussparung im Modell.
 */
function boxInWall(
  g: WallGeometry,
  uStart: number,
  uEnd: number,
  halfThickness: number,
  zStart: number,
  zEnd: number,
  sOffset = 0,
  /** Höhenlage des Geschosses [m]; 0 = unterstes Geschoss. */
  base = 0,
): THREE.BufferGeometry {
  const place = wallBoxPlacement(g, uStart, uEnd, zStart, zEnd, halfThickness, sOffset);
  const geom = new THREE.BoxGeometry(place.size.length, place.size.height, place.size.thickness);
  const m = new THREE.Matrix4();
  m.makeRotationY(place.rotationY);
  m.setPosition(place.center.x, place.center.y + base, place.center.z);
  geom.applyMatrix4(m);
  return geom;
}

interface BuiltGeometry {
  heating: THREE.BufferGeometry | null;
  sanitary: THREE.BufferGeometry | null;
  ventilation: THREE.BufferGeometry | null;
  exterior: THREE.BufferGeometry | null;
  interior: THREE.BufferGeometry | null;
  floors: THREE.BufferGeometry | null;
  roof: THREE.BufferGeometry | null;
  stairs: THREE.BufferGeometry | null;
  shafts: THREE.BufferGeometry | null;
  solids: THREE.BufferGeometry | null;
  slabs: THREE.BufferGeometry | null;
  pipes: { colour: string; geometry: THREE.BufferGeometry }[];
  glass: THREE.BufferGeometry | null;
  frames: THREE.BufferGeometry | null;
  doors: THREE.BufferGeometry | null;
  bounds: THREE.Box3;
}

function buildGeometry(input: BuildInput): BuiltGeometry {
  const { walls, openings, rooms, fixtures, nodes, roof, roofOpenings, verticals, solids, slabs, pipes, accessories, levelHeight, levelBase } = input;

  /** Höhenlage des Geschosses, in dem ein Bauteil steht. */
  const basis = (levelId: string): number => levelBase.get(levelId) ?? 0;
  /** Ein fertiges Bauteil auf sein Geschoss heben. */
  const hebe = (geom: THREE.BufferGeometry, levelId: string): THREE.BufferGeometry => {
    const dz = basis(levelId);
    if (dz !== 0) geom.translate(0, dz, 0);
    return geom;
  };

  const exteriorParts: THREE.BufferGeometry[] = [];
  const interiorParts: THREE.BufferGeometry[] = [];
  const glassParts: THREE.BufferGeometry[] = [];
  const framePartsGeom: THREE.BufferGeometry[] = [];
  const doorParts: THREE.BufferGeometry[] = [];
  const floorParts: THREE.BufferGeometry[] = [];
  const heatingParts: THREE.BufferGeometry[] = [];
  const sanitaryParts: THREE.BufferGeometry[] = [];
  const ventilationParts: THREE.BufferGeometry[] = [];
  const roofParts: THREE.BufferGeometry[] = [];
  const stairParts: THREE.BufferGeometry[] = [];
  const solidParts: THREE.BufferGeometry[] = [];
  const shaftParts: THREE.BufferGeometry[] = [];
  const slabParts: THREE.BufferGeometry[] = [];
  const accessoryParts: THREE.BufferGeometry[] = [];

  // Wände je Knoten — für die Eckverlängerung (saubere Gebäudeecken).
  const wallsByNode = new Map<string, Wall[]>();
  for (const w of walls) {
    for (const id of [w.a, w.b]) {
      const list = wallsByNode.get(id);
      if (list) list.push(w);
      else wallsByNode.set(id, [w]);
    }
  }
  // Die Verlängerung an Ecken und T-Stößen bestimmt, wo der erste und der
  // letzte Teilquader beginnen — und damit, wo alle Öffnungen dazwischen
  // liegen. Sie muss deshalb aus derselben Funktion kommen wie im Plan.
  const extensionAt = (nodeId: string, self: Wall): number =>
    junctionExtension(nodeId, wallsByNode.get(nodeId) ?? [], self);

  // Der Dachrahmen wird vor den Wänden gebraucht: unter einer Schräge endet
  // eine Wand nicht auf Geschosshöhe, sondern an der Dachfläche. Ohne das
  // Kappen stünden die Wände sichtbar durch das Dach hindurch.
  const roofOutline: { x: number; y: number }[] = [];
  for (const w of walls) {
    const na = nodes[w.a];
    const nb = nodes[w.b];
    if (na) roofOutline.push({ x: na.x, y: na.y });
    if (nb) roofOutline.push({ x: nb.x, y: nb.y });
  }
  // Gauben gehen in die Höhenfunktion ein: das Dachraster hebt sich dort von
  // selbst, und die Wände darunter werden entsprechend höher gekappt.
  const roofFrame = buildRoofFrame(roof, roofOutline, roofOpenings);

  for (const wall of walls) {
    const g = getWallGeometry(wall, nodes as never);
    if (!g) continue;
    const wallOpenings = openingsOfWall(wall.id, openings);
    const extStart = extensionAt(wall.a, wall);
    const extEnd = extensionAt(wall.b, wall);
    const parts = wallSolidParts(g, wallOpenings, extStart, extEnd);
    const target = wall.type === 'exterior' ? exteriorParts : interiorParts;
    const dz = basis(wall.levelId);

    for (const part of parts) {
      if (!roofFrame) {
        target.push(
          boxInWall(g, part.uStart, part.uEnd, g.halfThickness, part.zStart, part.zEnd, undefined, dz),
        );
        continue;
      }

      // Unter dem Dach wird die Wand in kurze Scheiben zerlegt, deren Höhe der
      // Dachfläche folgt. 8 cm sind fein genug, dass die Treppung in der
      // Silhouette verschwindet, und ersparen jede Verschneidungsrechnung.
      const SLICE = 0.08;
      const span = part.uEnd - part.uStart;
      const n = Math.max(1, Math.ceil(span / SLICE));
      for (let i = 0; i < n; i++) {
        const u0 = part.uStart + (span * i) / n;
        const u1 = part.uStart + (span * (i + 1)) / n;
        const um = (u0 + u1) / 2;
        const mid = wallLocalToWorld(g, um, 0);
        const top = Math.min(part.zEnd, roofHeightAt(roofFrame, mid));
        if (top <= part.zStart + 1e-4) continue;
        target.push(boxInWall(g, u0, u1, g.halfThickness, part.zStart, top, undefined, dz));
      }
    }

    // Öffnungsfüllungen: Glas, Rahmen, Türblatt
    for (const op of wallOpenings) {
      const span = openingSpan(g, op);
      // Unter der Schräge endet auch die Öffnung an der Dachfläche — sonst
      // ragen Rahmen und Glas sichtbar durch das Dach.
      const opCentre = wallLocalToWorld(g, (span.from + span.to) / 2, 0);
      const roofTop = roofFrame ? roofHeightAt(roofFrame, opCentre) : Infinity;
      const head = Math.min(wall.height, op.sillHeight + op.height, roofTop);
      if (head <= op.sillHeight + 0.05) continue;
      const frameDepth = g.halfThickness * 0.92;
      const fw = 0.045;

      // Ein Durchgang bekommt bewusst keinen Rahmen und kein Blatt — die
      // Laibung der Wand ist die Öffnung. Genau das unterscheidet ihn im
      // Modell sichtbar von einer Tür.
      if (op.kind === 'passage') continue;

      // Laibungsrahmen (dünner Streifen ringsum)
      framePartsGeom.push(
        boxInWall(g, span.from, span.from + fw, frameDepth, op.sillHeight, head, undefined, dz),
        boxInWall(g, span.to - fw, span.to, frameDepth, op.sillHeight, head, undefined, dz),
        boxInWall(g, span.from, span.to, frameDepth, head - fw, head, undefined, dz),
      );

      if (op.kind === 'window') {
        framePartsGeom.push(
          boxInWall(g, span.from, span.to, frameDepth, op.sillHeight, op.sillHeight + fw, undefined, dz),
        );

        // Pfosten entsprechend der Flügelteilung — ein zweiflügeliges Fenster
        // sieht im Modell auch zweiflügelig aus.
        const panels = op.panels ?? (op.windowType === 'double' ? 2 : op.windowType === 'ribbon' ? 3 : 1);
        for (let i = 1; i < panels; i++) {
          const u = span.from + ((span.to - span.from) * i) / panels;
          framePartsGeom.push(
            boxInWall(g, u - fw / 2, u + fw / 2, frameDepth, op.sillHeight, head, undefined, dz),
          );
        }

        glassParts.push(boxInWall(g, span.from + fw, span.to - fw, 0.008, op.sillHeight + fw, head - fw, undefined, dz));
      } else if (op.doorType === 'sliding') {
        // Schiebetür: Blatt liegt vor der Wand statt im Anschlag. Es ist damit
        // nichts anderes als ein Wandquader mit Querversatz.
        doorParts.push(
          boxInWall(
            g,
            span.from,
            span.to,
            0.02,
            op.sillHeight,
            head,
            g.halfThickness + 0.03,
            dz,
          ),
        );
      } else {
        // Türblatt, 72° geöffnet — verrät auf einen Blick die Anschlagsrichtung.
        const swing = op.flipSwing ? -1 : 1;
        const angle = (72 * Math.PI) / 180;

        // Zweiflügelig: zwei gegenläufige Blätter halber Breite.
        const leaves: { hingeU: number; width: number; dirSign: number }[] =
          op.doorType === 'double'
            ? [
                { hingeU: span.from, width: op.width / 2, dirSign: 1 },
                { hingeU: span.to, width: op.width / 2, dirSign: -1 },
              ]
            : [
                {
                  hingeU: op.hinge === 'right' ? span.to : span.from,
                  width: op.width,
                  dirSign: op.hinge === 'right' ? -1 : 1,
                },
              ];

        for (const l of leaves) {
          const leafHeight = head - op.sillHeight;
          const leaf = new THREE.BoxGeometry(l.width, leafHeight, 0.04);
          const pivot = new THREE.Matrix4();
          // Blatt so verschieben, dass die Drehachse an der Bandseite liegt
          leaf.translate((l.width / 2) * l.dirSign, leafHeight / 2, 0);
          pivot.makeRotationY(swing * angle * l.dirSign);
          leaf.applyMatrix4(pivot);

          // Aufgestellt wird um die Bandachse. Weil die Szenendrehung die
          // Querrichtung vertauscht (siehe `wallBoxPlacement`), zeigt das
          // lokale +z des Blattes auf die Gegennormale — der Anschlagsinn
          // `swing · dirSign` der Blattdrehung ist genau darauf abgestimmt und
          // liefert dieselbe Seite, die der Plan zeichnet.
          const anchor = wallLocalToScene(g, l.hingeU, 0, 0);
          const place = new THREE.Matrix4();
          place.makeRotationY(sceneRotationY(g.angle));
          place.setPosition(anchor.x, anchor.y, anchor.z);
          leaf.applyMatrix4(place);
          doorParts.push(leaf);
        }
      }
    }
  }

  // --- TGA-Körper -------------------------------------------------------
  for (const f of fixtures) {
    const h = FIXTURE_HEIGHT[f.type] ?? 0.3;
    // Steigstränge und Fallstränge laufen durchs ganze Geschoss.
    const isRiser = f.type === 'riser-heating' || f.type === 'riser-sanitary';
    // Auch die TGA endet unter der Schräge am Dach — ein Lüftungsventil, das
    // durch das Dach ragt, sieht nach Fehler aus, weil es einer ist.
    const roofTop = roofFrame ? roofHeightAt(roofFrame, f.position) : Infinity;
    const height = Math.min(isRiser ? 2.75 : h, Math.max(0, roofTop - f.elevation));
    if (height < 0.02) continue;

    const geom = isRiser
      ? new THREE.CylinderGeometry(f.length / 2, f.length / 2, height, 12)
      : new THREE.BoxGeometry(f.length, height, Math.max(f.depth, 0.04));

    const m = new THREE.Matrix4();
    m.makeRotationY(sceneRotationY((f.rotation * Math.PI) / 180));
    const c = modelToScene(f.position, f.elevation + height / 2);
    m.setPosition(c.x, c.y, c.z);
    geom.applyMatrix4(m);

    hebe(geom, f.levelId);
    if (f.category === 'heating') heatingParts.push(geom);
    else if (f.category === 'sanitary') sanitaryParts.push(geom);
    else ventilationParts.push(geom);
  }

  // Bodenplatten aus den erkannten Räumen
  for (const room of rooms) {
    if (room.innerPolygon.length < 3) continue;
    const shape = new THREE.Shape();
    shape.moveTo(room.innerPolygon[0].x, room.innerPolygon[0].y);
    for (let i = 1; i < room.innerPolygon.length; i++) {
      shape.lineTo(room.innerPolygon[i].x, room.innerPolygon[i].y);
    }
    shape.closePath();
    const geom = new THREE.ShapeGeometry(shape);
    // Shape liegt in der XY-Ebene → in die XZ-Ebene kippen. Die Drehung MUSS
    // −90° sein: nur so wird Modell-y auf −z abgebildet, wie es `boxInWall`
    // für die Wände tut. Mit +90° lägen die Böden spiegelverkehrt im Modell.
    geom.rotateX(-Math.PI / 2);
    geom.translate(0, 0.006, 0);
    floorParts.push(hebe(geom, room.levelId));
  }

  // Dachflächen: der Grundriss wird gerastert und je Zelle ein kleines
  // Viereck auf Dachhöhe gesetzt. Das ist grob, aber es zeigt genau das, was
  // im Dachgeschoss zählt — wo der Kopf anstößt. Eine exakte Verschneidung
  // von Dachebenen mit dem Grundriss wäre erheblich mehr Code für ein Bild.
  if (roofFrame) {
    // Gerastert wird über die *Achspolygone* der Räume plus einen Überstand.
    // Mit den lichten Innenpolygonen klaffte über jeder Wand ein Schlitz, und
    // das Dach endete an der Innenkante der Außenwand statt darüber hinaus.
    const OVERHANG = 0.5;
    const polys = rooms.map((r) => r.polygon).filter((p) => p.length >= 3);
    if (polys.length) {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const poly of polys) {
        for (const p of poly) {
          minX = Math.min(minX, p.x);
          minY = Math.min(minY, p.y);
          maxX = Math.max(maxX, p.x);
          maxY = Math.max(maxY, p.y);
        }
      }
      minX -= OVERHANG;
      minY -= OVERHANG;
      maxX += OVERHANG;
      maxY += OVERHANG;

      const covered = (c: { x: number; y: number }): boolean => {
        for (const poly of polys) if (pointInPolygon(c, poly)) return true;
        for (const poly of polys) {
          for (let i = 0; i < poly.length; i++) {
            const a = poly[i];
            const b = poly[(i + 1) % poly.length];
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const len2 = dx * dx + dy * dy;
            if (len2 < 1e-9) continue;
            let t = ((c.x - a.x) * dx + (c.y - a.y) * dy) / len2;
            t = Math.max(0, Math.min(1, t));
            const px2 = a.x + dx * t - c.x;
            const py2 = a.y + dy * t - c.y;
            if (px2 * px2 + py2 * py2 <= OVERHANG * OVERHANG) return true;
          }
        }
        return false;
      };

      // Alle Zellen landen in *einem* Positionsarray. Je Zelle eine eigene
      // BufferGeometry anzulegen und am Ende zu mergen kostet bei einem
      // normalen Grundriss mehrere tausend Objekte — der Aufbau blockierte
      // damit sichtbar den Hauptthread.
      const step = 0.12;
      const verts: number[] = [];
      const at = (px3: number, py3: number) => {
        verts.push(px3, roofHeightAt(roofFrame, { x: px3, y: py3 }) + 0.02, -py3);
      };
      for (let y = minY; y < maxY; y += step) {
        for (let x = minX; x < maxX; x += step) {
          if (!covered({ x: x + step / 2, y: y + step / 2 })) continue;
          at(x, y);
          at(x + step, y);
          at(x + step, y + step);
          at(x, y);
          at(x + step, y + step);
          at(x, y + step);
        }
      }
      if (verts.length) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
        roofParts.push(hebe(g, input.roofLevelId ?? ''));
      }
    }
  }

  // --- Treppen und Schächte -------------------------------------------------
  for (const v of verticals) {
    const corners = verticalCorners(v);
    if (v.kind === 'shaft') {
      // Schacht als durchgehender Körper über die Geschosshöhe.
      const geom = new THREE.BoxGeometry(v.length, levelHeight, v.width);
      const m = new THREE.Matrix4();
      m.makeRotationY(sceneRotationY((v.rotation * Math.PI) / 180));
      const c = modelToScene(v.position, levelHeight / 2);
      m.setPosition(c.x, c.y, c.z);
      geom.applyMatrix4(m);
      shaftParts.push(hebe(geom, v.levelId));
      continue;
    }

    // Treppe als echte Stufenfolge entlang ihrer Lauflinie — dadurch stimmt
    // auch bei der gewendelten Treppe, wo sie ankommt.
    void corners;
    const steps = Math.max(2, v.steps ?? 15);
    const rise = (levelHeight + 0.28) / steps;
    const path = stairPath(v);
    const runLength = stairRunLength(v);
    const going = runLength / steps;
    const treadWidth = v.kind === 'stair-u' ? v.width / 2 : v.width;

    /** Punkt und Richtung auf der Lauflinie. */
    const alongPath = (d: number) => {
      let rest = Math.max(0, Math.min(runLength, d));
      for (let i = 1; i < path.length; i++) {
        const seg = Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
        if (rest <= seg || i === path.length - 1) {
          const t = seg > 1e-9 ? rest / seg : 0;
          return {
            x: path[i - 1].x + (path[i].x - path[i - 1].x) * t,
            y: path[i - 1].y + (path[i].y - path[i - 1].y) * t,
            angle: Math.atan2(path[i].y - path[i - 1].y, path[i].x - path[i - 1].x),
          };
        }
        rest -= seg;
      }
      const last = path[path.length - 1];
      return { x: last.x, y: last.y, angle: 0 };
    };

    for (let i = 0; i < steps; i++) {
      const at = alongPath((i + 0.5) * going);
      const geom = new THREE.BoxGeometry(going * 1.05, rise, treadWidth);
      const m = new THREE.Matrix4();
      m.makeRotationY(sceneRotationY(at.angle));
      const c = modelToScene(at, (i + 0.5) * rise);
      m.setPosition(c.x, c.y, c.z);
      geom.applyMatrix4(m);
      stairParts.push(hebe(geom, v.levelId));
    }
  }

  // --- Massive Bauteile -----------------------------------------------------
  // Kamin, Pfeiler, Wandversatz: ein Prisma über dem Grundriss, über die volle
  // Höhe. `ExtrudeGeometry` statt eines Quaders, weil der Grundriss auch ein
  // freies Polygon sein darf — ein Mauerwerksversatz ist selten rechteckig.
  // Die Drehung um −90° um die x-Achse bildet (x, y, z_extrudiert) auf die
  // Szenenachsen ab, dieselbe Abbildung wie `modelToScene`.
  for (const b of solids) {
    const outline = solidFootprint(b);
    if (outline.length < 3) continue;
    const shape = new THREE.Shape(outline.map((p) => new THREE.Vector2(p.x, p.y)));
    const height = Math.max(0.05, b.height ?? levelHeight);
    const geom = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
    geom.rotateX(-Math.PI / 2);
    solidParts.push(hebe(geom, b.levelId));
  }

  // --- Geschossdecken -------------------------------------------------------
  /*
   * Die Platte sitzt auf ihrer **Unterkante**.
   *
   * `ExtrudeGeometry` zieht den Umriss entlang +z auf; nach der Kippung in die
   * Grundrissebene liegt der Körper zwischen y = 0 und y = Stärke, wächst also
   * **nach oben**. Angesetzt wird er deshalb an `bottom` — der Oberkante der
   * Wände darunter. Bis 1.13.1 stand hier `top`, und die Platte saß eine volle
   * Plattenstärke zu hoch: die Lücke blieb offen, und die Decke ragte in das
   * Geschoss darüber. `bottom` kommt fertig aus `slabGeometry`, damit im
   * Zeichenpfad keine Höhenrechnung mehr steht.
   *
   * Die Höhenlage steckt bereits darin — `hebe` wäre eine zweite Verschiebung.
   */
  for (const platte of slabs) {
    for (const outline of platte.outlines) {
      if (outline.length < 3) continue;
      const shape = new THREE.Shape(outline.map((p) => new THREE.Vector2(p.x, p.y)));
      for (const hole of platte.holes) {
        if (!holeFitsOutline(hole, outline)) continue;
        shape.holes.push(new THREE.Path(hole.map((p) => new THREE.Vector2(p.x, p.y))));
      }
      const geom = new THREE.ExtrudeGeometry(shape, { depth: platte.thickness, bevelEnabled: false });
      geom.rotateX(-Math.PI / 2);
      geom.translate(0, platte.bottom, 0);
      slabParts.push(geom);
    }
  }

  // --- Rohrleitungen --------------------------------------------------------
  // Je Teilstrecke ein Zylinder; die Farbe steckt im Material, deshalb wird
  // je Gewerk gesammelt statt alles in eine Geometrie zu werfen.
  const pipeByColour = new Map<string, THREE.BufferGeometry[]>();
  for (const run of pipes) {
    const radius = Math.max(0.012, (run.nominalDiameter / 1000) * 0.6);
    const colour = PIPE_SERVICE_COLORS[run.service];
    const list = pipeByColour.get(colour) ?? [];
    for (let i = 1; i < run.points.length; i++) {
      const a = run.points[i - 1];
      const b = run.points[i];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 1e-4) continue;
      const geom = new THREE.CylinderGeometry(radius, radius, len, 8);
      geom.rotateZ(Math.PI / 2);
      const m = new THREE.Matrix4();
      m.makeRotationY(sceneRotationY(Math.atan2(b.y - a.y, b.x - a.x)));
      const c = modelToScene({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, run.elevation + 0.02);
      m.setPosition(c.x, c.y, c.z);
      geom.applyMatrix4(m);
      list.push(hebe(geom, run.levelId));
    }
    pipeByColour.set(colour, list);
  }

  const merge = (parts: THREE.BufferGeometry[]): THREE.BufferGeometry | null => {
    if (!parts.length) return null;
    const merged = mergeGeometries(parts, false);
    for (const p of parts) p.dispose();
    if (!merged) return null;
    merged.computeVertexNormals();
    return merged;
  };

  const exterior = merge(exteriorParts);
  const interior = merge(interiorParts);
  const floors = merge(floorParts);
  const roofGeom = merge(roofParts);
  const stairs = merge(stairParts);
  const shafts = merge(shaftParts);
  const solidBodies = merge(solidParts);
  const slabBodies = merge(slabParts);
  const pipeMeshes: { colour: string; geometry: THREE.BufferGeometry }[] = [];
  /*
   * Armaturen im Modell.
   *
   * Sie werden bewusst als einfacher Körper gezeigt und nicht als Symbol: im
   * Grundriss ist eine Armatur ein Zeichen, im Modell ein Bauteil, das Platz
   * braucht. Wer wissen will, *welche* Armatur dort sitzt, liest den Plan —
   * das Modell zeigt, dass dort etwas sitzt und wie viel Raum es einnimmt.
   */
  for (const armatur of accessories) {
    const gross = armatur.kind === 'fixed-point' || armatur.kind === 'strainer';
    const geom = new THREE.BoxGeometry(gross ? 0.12 : 0.08, gross ? 0.12 : 0.08, gross ? 0.12 : 0.08);
    const c = modelToScene(armatur.position, armatur.elevation + 0.04);
    geom.translate(c.x, c.y, c.z);
    accessoryParts.push(hebe(geom, armatur.levelId));
  }

  for (const [colour, list] of pipeByColour) {
    const g = merge(list);
    if (g) pipeMeshes.push({ colour, geometry: g });
  }
  const glass = merge(glassParts);
  const frames = merge(framePartsGeom);
  const doors = merge(doorParts);
  // Die Armaturen gehören zum Gewerk Heizung und werden mit ihm gezeichnet —
  // eine eigene Materialgruppe für acht Zentimeter große Körper wäre ein
  // zusätzlicher Draw Call ohne Gewinn.
  const heating = merge([...heatingParts, ...accessoryParts]);
  const sanitary = merge(sanitaryParts);
  const ventilation = merge(ventilationParts);

  const bounds = new THREE.Box3();
  for (const geom of [exterior, interior, floors]) {
    if (!geom) continue;
    geom.computeBoundingBox();
    if (geom.boundingBox) bounds.union(geom.boundingBox);
  }
  if (bounds.isEmpty()) bounds.set(new THREE.Vector3(-5, 0, -5), new THREE.Vector3(5, 3, 5));

  return {
    exterior,
    interior,
    floors,
    roof: roofGeom,
    stairs,
    shafts,
    solids: solidBodies,
    slabs: slabBodies,
    pipes: pipeMeshes,
    glass,
    frames,
    doors,
    heating,
    sanitary,
    ventilation,
    bounds,
  };
}

// ---------------------------------------------------------------------------
// Komponente
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Außengelände
// ---------------------------------------------------------------------------

/**
 * Grundstück, Wärmepumpe und Wärmequelle im Modell.
 *
 * Im Grundriss ist das alles längst zu sehen — im Modell fehlte es, und genau
 * dort wird die Frage gestellt, die man am Plan schlecht beantwortet: passt
 * das Gerät zwischen Haus und Grenze, ohne dass jemand daran vorbeimuss, und
 * wie hoch steht das Nachbarhaus wirklich.
 *
 * Abbildung wie im übrigen Modell: Modell-x auf x, Modell-y auf **−z**, Höhe
 * auf y. Alles, was unter Gelände liegt (Sonden, Kollektorleitungen), bekommt
 * eine negative Höhe und ist damit von oben nicht zu sehen, von der Seite aber
 * schon — das ist bei einer Erdsonde die interessantere Ansicht.
 */
function buildSite(site: SitePlan | undefined): THREE.Group | null {
  if (!site) return null;
  const elements = Object.values(site.elements ?? {});
  const pumps = Object.values(site.pumps ?? {});
  if (!elements.length && !pumps.length) return null;

  const group = new THREE.Group();
  group.name = 'gelaende';

  const mat = {
    boundary: new THREE.LineBasicMaterial({ color: 0xfbbf24 }),
    neighbour: new THREE.MeshStandardMaterial({ color: 0x7c8598, roughness: 0.95 }),
    paved: new THREE.MeshStandardMaterial({ color: 0x5b6472, roughness: 1 }),
    collector: new THREE.MeshStandardMaterial({
      color: 0x2dd4bf,
      roughness: 0.9,
      transparent: true,
      opacity: 0.28,
      side: THREE.DoubleSide,
    }),
    trunk: new THREE.MeshStandardMaterial({ color: 0x6b4f3a, roughness: 1 }),
    crown: new THREE.MeshStandardMaterial({ color: 0x4ade80, roughness: 1, transparent: true, opacity: 0.75 }),
    hazard: new THREE.MeshStandardMaterial({ color: 0xf87171, roughness: 0.8 }),
    bore: new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.5, metalness: 0.2 }),
    well: new THREE.MeshStandardMaterial({ color: 0x60a5fa, roughness: 0.5, metalness: 0.2 }),
    line: new THREE.MeshStandardMaterial({ color: 0xa78bfa, roughness: 0.6 }),
    pump: new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.55, metalness: 0.25 }),
    guard: new THREE.MeshStandardMaterial({
      color: 0xfb7185,
      transparent: true,
      opacity: 0.16,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
    marker: new THREE.MeshStandardMaterial({ color: 0xfbbf24, roughness: 0.6 }),
  };

  /** Ein Polygon des Modells als ebene Fläche in der Geländeebene. */
  const shapeOf = (points: readonly Vec2[]): THREE.Shape => {
    const shape = new THREE.Shape();
    shape.moveTo(points[0].x, -points[0].y);
    for (let i = 1; i < points.length; i += 1) shape.lineTo(points[i].x, -points[i].y);
    shape.closePath();
    return shape;
  };

  /** Fläche flach auf das Gelände legen (Shape liegt in der xy-Ebene). */
  const layFlat = (mesh: THREE.Mesh, height: number) => {
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = height;
  };

  for (const element of elements) {
    const pts = element.points;
    if (!pts.length) continue;

    switch (element.kind) {
      case 'boundary': {
        if (pts.length < 3) break;
        // Die Grenze wird als Linie gezeichnet, nicht als Fläche: sie ist
        // eine Rechtslinie, keine Oberfläche, und eine eingefärbte Fläche
        // würde jedes Gelände darunter verdecken.
        const verts: number[] = [];
        for (let i = 0; i < pts.length; i += 1) {
          const a = pts[i];
          const b = pts[(i + 1) % pts.length];
          verts.push(a.x, 0.03, -a.y, b.x, 0.03, -b.y);
        }
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
        group.add(new THREE.LineSegments(geom, mat.boundary));
        break;
      }

      case 'neighbour-building': {
        if (pts.length < 3) break;
        const height = Math.max(0.5, element.height ?? 7);
        const geom = new THREE.ExtrudeGeometry(shapeOf(pts), { depth: height, bevelEnabled: false });
        const mesh = new THREE.Mesh(geom, mat.neighbour);
        // ExtrudeGeometry wächst in +z; nach dem Kippen zeigt das nach oben.
        mesh.rotation.x = -Math.PI / 2;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
        break;
      }

      case 'paved':
      case 'collector': {
        if (pts.length < 3) break;
        const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shapeOf(pts)), element.kind === 'paved' ? mat.paved : mat.collector);
        layFlat(mesh, element.kind === 'paved' ? 0.015 : -(element.depth ?? 1.4));
        mesh.receiveShadow = element.kind === 'paved';
        group.add(mesh);
        break;
      }

      case 'tree': {
        const r = element.radius ?? 3;
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.08, r * 0.11, r * 1.1, 8), mat.trunk);
        trunk.position.set(pts[0].x, (r * 1.1) / 2, -pts[0].y);
        trunk.castShadow = true;
        group.add(trunk);
        const crown = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), mat.crown);
        crown.position.set(pts[0].x, r * 1.1 + r * 0.55, -pts[0].y);
        crown.castShadow = true;
        group.add(crown);
        break;
      }

      case 'hazard-opening': {
        const r = element.radius ?? 0.4;
        const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.12, 16), mat.hazard);
        mesh.position.set(pts[0].x, 0.06, -pts[0].y);
        group.add(mesh);
        break;
      }

      case 'borehole':
      case 'well-supply':
      case 'well-injection': {
        const depth = Math.max(1, element.depth ?? 100);
        const material = element.kind === 'borehole' ? mat.bore : mat.well;
        const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, depth, 10), material);
        // Nach unten: die Mitte liegt auf halber Tiefe unter Gelände.
        mesh.position.set(pts[0].x, -depth / 2, -pts[0].y);
        group.add(mesh);
        const head = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.16, 12), material);
        head.position.set(pts[0].x, 0.08, -pts[0].y);
        group.add(head);
        break;
      }

      case 'trench':
      case 'utility-line': {
        if (pts.length < 2) break;
        const depth = element.depth ?? 1.2;
        const path = new THREE.CatmullRomCurve3(
          pts.map((p) => new THREE.Vector3(p.x, -depth, -p.y)),
          false,
          'catmullrom',
          0,
        );
        const geom = new THREE.TubeGeometry(path, Math.max(2, pts.length * 4), 0.06, 6, false);
        group.add(new THREE.Mesh(geom, mat.line));
        break;
      }

      case 'immission-point': {
        // Ein Pfahl in Ohrhöhe: der Immissionsort ist ein Ort, an dem jemand
        // steht, kein Punkt auf dem Boden.
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.6, 8), mat.marker);
        post.position.set(pts[0].x, 0.8, -pts[0].y);
        group.add(post);
        const ball = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 8), mat.marker);
        ball.position.set(pts[0].x, 1.7, -pts[0].y);
        group.add(ball);
        break;
      }

      default:
        break;
    }
  }

  for (const pump of pumps) {
    const body = new THREE.Mesh(new THREE.BoxGeometry(pump.width, pump.height, pump.depth), mat.pump);
    // Der Azimut zählt von Nord im Uhrzeigersinn; die Drehung um die
    // Hochachse läuft entgegengesetzt, deshalb das Vorzeichen.
    body.rotation.y = -((pump.azimuth * Math.PI) / 180);
    body.position.set(pump.position.x, pump.standHeight + pump.height / 2, -pump.position.y);
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    if (pump.standHeight > 0.02) {
      const base = new THREE.Mesh(
        new THREE.BoxGeometry(pump.width * 0.9, pump.standHeight, pump.depth * 0.9),
        mat.paved,
      );
      base.rotation.y = body.rotation.y;
      base.position.set(pump.position.x, pump.standHeight / 2, -pump.position.y);
      group.add(base);
    }

    // Schutzbereich brennbarer Kältemittel als stehender Zylinder. Er ist
    // kein Kreis am Boden: Propan sinkt, aber der Bereich gilt räumlich.
    if (pump.protectionRadius > 0 && (pump.refrigerant === 'R290' || pump.refrigerant === 'R32')) {
      const r = pump.protectionRadius;
      const guard = new THREE.Mesh(new THREE.CylinderGeometry(r, r, Math.max(0.6, pump.height), 28, 1, true), mat.guard);
      guard.position.set(pump.position.x, Math.max(0.6, pump.height) / 2, -pump.position.y);
      group.add(guard);
    }
  }

  return group;
}

export default function Viewer3D({ className = '' }: { className?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const contentRef = useRef<THREE.Group | null>(null);
  const perspectiveRef = useRef<THREE.PerspectiveCamera | null>(null);
  const orthoRef = useRef<THREE.OrthographicCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const materialsRef = useRef<Materials | null>(null);
  const fittedRef = useRef(false);
  /** Halbe Höhe des orthografischen Frustums — steuert den Iso-Zoom. */
  const orthoFrustumRef = useRef(12);
  const resizeRef = useRef<() => void>(() => {});

  const doc = useBimStore((s) => s.doc);
  const cameraMode = useBimStore((s) => s.cameraMode);
  const viewMode = useBimStore((s) => s.viewMode);
  const site = useBimStore((s) => s.doc.site);
  /**
   * Das Gelände lässt sich ausblenden.
   *
   * Bei einem großen Grundstück nimmt es den größten Teil des Bildes ein, und
   * wer am Dachaufbau arbeitet, will das Haus sehen, nicht den Garten. Der
   * Schalter sitzt neben den Kameramodi, weil er dasselbe tut: er ändert, was
   * man sieht, nicht was im Modell steht.
   */
  const [showSite, setShowSite] = useState(true);

  const walls = useMemo(() => Object.values(doc.walls), [doc.walls]);
  const openings = useMemo(() => Object.values(doc.openings), [doc.openings]);
  const rooms = useMemo(() => Object.values(doc.rooms), [doc.rooms]);
  const fixtures = useMemo(() => Object.values(doc.fixtures), [doc.fixtures]);
  const verticals = useMemo(() => Object.values(doc.verticals ?? {}), [doc.verticals]);
  const solids = useMemo(() => Object.values(doc.solids ?? {}), [doc.solids]);
  const roofOpenings = useMemo(
    () => Object.values(doc.roofOpenings ?? {}).filter((o) => o.levelId === doc.activeLevelId),
    [doc.roofOpenings, doc.activeLevelId],
  );
  const pipes = useMemo(() => Object.values(doc.pipes ?? {}), [doc.pipes]);
  const accessories = useMemo(() => Object.values(doc.pipeAccessories ?? {}), [doc.pipeAccessories]);

  /**
   * Höhenlage je Geschoss — gerechnet im Kern, damit sie prüfbar bleibt.
   */
  const geschossHoehen = useMemo(() => levelBaseHeights(Object.values(doc.levels)), [doc.levels]);

  /**
   * Deckenplatten zwischen den Geschossen.
   *
   * Gerechnet im Kern (`slabGeometry`), damit der Prüfblock sie sieht. Ohne
   * sie klaffte über jeder Wandoberkante die Deckenstärke als Luft.
   */
  const geschossDecken = useMemo(() => {
    const eingabe = {
      levels: Object.values(doc.levels),
      rooms,
      walls,
      nodes: doc.nodes,
      verticals,
      base: geschossHoehen,
    };
    // Decken zwischen den Geschossen und die Bodenplatte darunter. Beides sind
    // Platten und werden gleich gezeichnet; getrennt gerechnet werden sie,
    // weil eine Bodenplatte keine Geschossdecke ist — sie liegt unter ihrem
    // Geschoss und bekommt keine Aussparungen.
    const boden = groundSlab(eingabe);
    return boden ? [boden, ...levelSlabs(eingabe)] : levelSlabs(eingabe);
  }, [doc.levels, doc.nodes, rooms, walls, verticals, geschossHoehen]);

  // ------------------------------------------------------------ Szene-Setup
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b1120);
    scene.fog = new THREE.Fog(0x0b1120, 34, 105);
    sceneRef.current = scene;

    // --- Licht: weiches Studio-Setup, wie man es aus Architekturrenderings kennt
    const hemi = new THREE.HemisphereLight(0xdfe9f5, 0x1a2233, 1.15);
    scene.add(hemi);

    const key = new THREE.DirectionalLight(0xffffff, 1.85);
    key.position.set(14, 22, 12);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 90;
    key.shadow.camera.left = -28;
    key.shadow.camera.right = 28;
    key.shadow.camera.top = 28;
    key.shadow.camera.bottom = -28;
    key.shadow.bias = -0.0006;
    key.shadow.normalBias = 0.02;
    scene.add(key);

    const fill = new THREE.DirectionalLight(0x9ecbff, 0.34);
    fill.position.set(-16, 9, -12);
    scene.add(fill);

    scene.add(new THREE.AmbientLight(0xffffff, 0.18));

    // --- Schattenfänger: unsichtbare Ebene, die nur den Schatten annimmt
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400),
      new THREE.ShadowMaterial({ opacity: 0.36 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.002;
    ground.receiveShadow = true;
    scene.add(ground);

    const grid = new THREE.GridHelper(120, 120, 0x1e2a3f, 0x141d2e);
    grid.position.y = -0.004;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.5;
    scene.add(grid);

    const content = new THREE.Group();
    scene.add(content);
    contentRef.current = content;

    materialsRef.current = createMaterials();

    // --- Kameras
    const perspective = new THREE.PerspectiveCamera(42, 1, 0.1, 500);
    perspective.position.set(16, 13, 18);
    perspectiveRef.current = perspective;

    const ortho = new THREE.OrthographicCamera(-10, 10, 10, -10, -200, 500);
    ortho.position.set(24, 24, 24);
    ortho.lookAt(0, 0, 0);
    orthoRef.current = ortho;

    const controls = new OrbitControls(perspective, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.maxPolarAngle = Math.PI / 2 - 0.03; // nie unter die Bodenebene
    controls.minDistance = 2;
    controls.maxDistance = 150;
    controls.target.set(0, 1.2, 0);
    controlsRef.current = controls;

    // --- Größe
    const resize = () => {
      const rect = host.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return;
      // updateStyle MUSS true bleiben: sonst behält der Canvas keine
      // CSS-Größe und wird auf Geräten mit DPR > 1 um genau diesen Faktor
      // zu groß dargestellt — das Modell erscheint dann angeschnitten.
      renderer.setSize(rect.width, rect.height, true);
      perspective.aspect = rect.width / rect.height;
      perspective.updateProjectionMatrix();

      const aspect = rect.width / rect.height;
      const frustum = orthoFrustumRef.current;
      ortho.left = -frustum * aspect;
      ortho.right = frustum * aspect;
      ortho.top = frustum;
      ortho.bottom = -frustum;
      ortho.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resizeRef.current = resize;

    return () => {
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === host) host.removeChild(renderer.domElement);
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
      });
      const mats = materialsRef.current;
      if (mats) for (const m of Object.values(mats)) m.dispose();
      rendererRef.current = null;
      sceneRef.current = null;
      contentRef.current = null;
      controlsRef.current = null;
      materialsRef.current = null;
    };
  }, []);

  // ------------------------------------------------- Geometrie neu aufbauen
  useEffect(() => {
    const content = contentRef.current;
    const materials = materialsRef.current;
    if (!content || !materials) return;

    // Alten Inhalt sauber freigeben — sonst wächst der GPU-Speicher monoton.
    for (const child of [...content.children]) {
      content.remove(child);
      const mesh = child as THREE.Mesh;
      mesh.geometry?.dispose();
    }

    const built = buildGeometry({
      walls,
      openings,
      rooms,
      fixtures,
      nodes: doc.nodes,
      roof: doc.levels[doc.activeLevelId]?.roof,
      roofOpenings,
      verticals,
      solids,
      slabs: geschossDecken,
      pipes,
      levelHeight: doc.levels[doc.activeLevelId]?.height ?? 2.75,
      accessories,
      levelBase: geschossHoehen,
      roofLevelId: doc.activeLevelId,
    });

    const addMesh = (
      geom: THREE.BufferGeometry | null,
      material: THREE.Material,
      shadows: { cast: boolean; receive: boolean },
    ) => {
      if (!geom) return;
      const mesh = new THREE.Mesh(geom, material);
      mesh.castShadow = shadows.cast;
      mesh.receiveShadow = shadows.receive;
      content.add(mesh);
    };

    addMesh(built.exterior, materials.clay, { cast: true, receive: true });
    addMesh(built.interior, materials.clayInterior, { cast: true, receive: true });
    addMesh(built.floors, materials.floor, { cast: false, receive: true });
    addMesh(built.roof, materials.roof, { cast: true, receive: true });
    addMesh(built.stairs, materials.stair, { cast: true, receive: true });
    addMesh(built.shafts, materials.shaft, { cast: true, receive: true });
    addMesh(built.solids, materials.masonry, { cast: true, receive: true });
    addMesh(built.slabs, materials.slab, { cast: true, receive: true });
    for (const pipe of built.pipes) {
      const mesh = new THREE.Mesh(
        pipe.geometry,
        new THREE.MeshStandardMaterial({ color: new THREE.Color(pipe.colour), roughness: 0.4, metalness: 0.3 }),
      );
      mesh.castShadow = true;
      content.add(mesh);
    }
    addMesh(built.frames, materials.frame, { cast: true, receive: true });
    addMesh(built.doors, materials.door, { cast: true, receive: true });
    addMesh(built.heating, materials.heating, { cast: true, receive: true });
    addMesh(built.sanitary, materials.sanitary, { cast: true, receive: true });
    addMesh(built.ventilation, materials.ventilation, { cast: true, receive: true });
    addMesh(built.glass, materials.glass, { cast: false, receive: false });

    // Das Gelände hängt in derselben Gruppe wie das Gebäude und wird beim
    // nächsten Neuaufbau mit ihr freigegeben.
    if (showSite) {
      const siteGroup = buildSite(site);
      if (siteGroup) {
        content.add(siteGroup);
        // Die Einpassung soll das Grundstück mitnehmen — sonst steht die
        // Kamera auf dem Haus und die Wärmepumpe liegt außerhalb des Bildes.
        //
        // Aber nur die *Fläche*, nicht die Tiefe: eine 100 m tiefe Erdsonde
        // würde die Ausdehnung des Modells verhundertfachen. Die Kamera
        // richtete sich dann auf einen Punkt fünfzig Meter unter Gelände und
        // das Haus wäre ein Punkt am oberen Bildrand — genau das ist beim
        // ersten Versuch passiert. Nach unten wird deshalb auf zwei Meter
        // geklemmt; die Sonde bleibt sichtbar, sie bestimmt nur nicht mehr
        // den Bildausschnitt.
        const box = new THREE.Box3().setFromObject(siteGroup);
        if (!box.isEmpty()) {
          box.min.y = Math.max(box.min.y, -2);
          box.max.y = Math.min(box.max.y, 25);
          built.bounds.union(box);
        }
      }
    }

    // Beim ersten sinnvollen Modell einmalig einpassen — danach nie wieder,
    // sonst springt die Kamera bei jeder gezeichneten Wand.
    if (!fittedRef.current && walls.length > 2) {
      fitToBounds(built.bounds);
      fittedRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walls, openings, rooms, fixtures, verticals, solids, pipes, roofOpenings, doc.nodes, doc.levels, doc.activeLevelId, site, showSite]);

  /** Setzt Kamera und Orbit-Ziel so, dass das Gebäude formatfüllend sitzt. */
  const fitToBounds = (bounds: THREE.Box3) => {
    const perspective = perspectiveRef.current;
    const ortho = orthoRef.current;
    const controls = controlsRef.current;
    if (!perspective || !ortho || !controls) return;

    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.z, size.y) * 0.5 || 6;

    // Abstand aus *beiden* Öffnungswinkeln bestimmen. Nur den vertikalen FOV
    // zu betrachten reicht nicht: im Split-Screen ist das Fenster hochkant,
    // dort limitiert der horizontale Winkel — das Gebäude ragte sonst seitlich
    // aus dem Bild.
    const vFov = (perspective.fov * Math.PI) / 180;
    const aspect = perspective.aspect > 0.01 ? perspective.aspect : 1;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
    const distance =
      Math.max(radius / Math.tan(vFov / 2), radius / Math.tan(hFov / 2)) * 1.18;
    const dir = new THREE.Vector3(0.72, 0.55, 0.85).normalize();
    perspective.position.copy(center).addScaledVector(dir, distance);
    controls.target.copy(center);
    controls.update();

    orthoFrustumRef.current = radius * 1.5;
    ortho.position.copy(center).addScaledVector(new THREE.Vector3(1, 1, 1).normalize(), radius * 6);
    ortho.lookAt(center);
    resizeRef.current();
  };

  // --------------------------------------------------------- Kameramodi
  useEffect(() => {
    const controls = controlsRef.current;
    const perspective = perspectiveRef.current;
    const ortho = orthoRef.current;
    if (!controls || !perspective || !ortho) return;

    const target = controls.target.clone();
    const radius = orthoFrustumRef.current / 1.5;

    switch (cameraMode as CameraMode) {
      case 'iso':
        // Klassische SW-Isometrie
        ortho.position.copy(target).add(new THREE.Vector3(radius * 4, radius * 4, radius * 4));
        ortho.lookAt(target);
        controls.object = ortho;
        break;
      case 'top':
        ortho.position.copy(target).add(new THREE.Vector3(0, radius * 8, 0.001));
        ortho.lookAt(target);
        controls.object = ortho;
        break;
      default:
        controls.object = perspective;
    }
    controls.update();
  }, [cameraMode]);

  // ----------------------------------------------------------- Renderloop
  useEffect(() => {
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const controls = controlsRef.current;
    if (!renderer || !scene || !controls) return;

    const visible = viewMode === '3d' || viewMode === 'split';
    if (!visible) {
      renderer.setAnimationLoop(null);
      return;
    }

    resizeRef.current();
    renderer.setAnimationLoop(() => {
      controls.update();
      renderer.render(scene, controls.object as THREE.Camera);
    });

    return () => renderer.setAnimationLoop(null);
  }, [viewMode, cameraMode]);

  return (
    <div className={`relative h-full w-full overflow-hidden ${className}`}>
      <div ref={hostRef} className="h-full w-full" />

      {/* Kamera-Umschalter */}
      <div className="panel absolute right-3 top-3 flex gap-1 p-1">
        {(
          [
            { id: 'orbit', label: 'Orbit' },
            { id: 'iso', label: 'Iso' },
            { id: 'top', label: 'Top' },
          ] as { id: CameraMode; label: string }[]
        ).map((mode) => (
          <button
            key={mode.id}
            className={`chip ${cameraMode === mode.id ? 'bg-accent/15 text-accent' : 'text-slate-400 hover:text-slate-200'}`}
            onClick={() => useBimStore.getState().setCameraMode(mode.id)}
          >
            {mode.label}
          </button>
        ))}
        <div className="divider-v" />
        <button
          className={`chip ${showSite ? 'bg-accent/15 text-accent' : 'text-slate-400 hover:text-slate-200'}`}
          title="Grundstück, Wärmepumpe und Wärmequelle im Modell zeigen"
          onClick={() => setShowSite((v) => !v)}
        >
          Gelände
        </button>
        <div className="divider-v" />
        <button
          className="chip text-slate-400 hover:text-slate-200"
          onClick={() => {
            fittedRef.current = false;
            const built = buildGeometry({
              walls,
              openings,
              rooms,
              fixtures,
              nodes: doc.nodes,
              roof: doc.levels[doc.activeLevelId]?.roof,
              roofOpenings,
              verticals,
              solids,
              slabs: geschossDecken,
              pipes,
              levelHeight: doc.levels[doc.activeLevelId]?.height ?? 2.75,
              accessories,
              levelBase: geschossHoehen,
              roofLevelId: doc.activeLevelId,
            });
            fitToBounds(built.bounds);
            fittedRef.current = true;
            for (const g of [built.exterior, built.interior, built.floors, built.roof, built.stairs, built.shafts, built.glass, built.frames, built.doors]) {
              g?.dispose();
            }
            for (const p2 of built.pipes) {
              const g = p2.geometry;
              g?.dispose();
            }
          }}
          title="Ansicht auf das Gebäude einpassen"
        >
          Einpassen
        </button>
      </div>

      {walls.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="text-center">
            <div className="text-xs text-slate-500">Noch keine Geometrie</div>
            <div className="mt-1 text-[11px] text-slate-600">
              Zeichnen Sie Wände im 2D-Editor — das Modell entsteht in Echtzeit
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
