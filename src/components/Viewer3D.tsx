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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type {
  CameraMode,
  Fixture,
  FixtureCategory,
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
  Durchbruch,
  RadiatorConnection,
  VentilSeite,
  VerticalElement,
  Wall,
} from '../types/bim';
import { FIXTURE_BY_TYPE, OPENING_LABELS, PIPE_SERVICE_COLORS, PIPE_SERVICE_LABELS, VENTILSEITE_LABELS, RADIATOR_CONNECTION_LABELS } from '../types/bim';
import { BODENBELAEGE, belagNach } from '../lib/bodenbelag';
import { EBENE_DURCHBRUECHE, EBENE_GELAENDE, EBENE_HEIZUNG, auswahlGesperrt, ebeneFuerMedium, ebeneFuerObjekt } from '../lib/ebenen';
import { durchbruchAussparungen } from '../lib/durchbruchSymbols';
import { hoeheAnPunkt, rohrlaenge } from '../lib/rohrlaenge';
import {
  aenderungFuer,
  begrenze,
  fange,
  fangmasse,
  griffText,
  gleichartige,
  griffeFuer,
  wertAusZug,
  type Griff,
} from '../lib/griffe';
import { fuehrungsText, umsetzungsMeldung, wandfuehrung } from '../lib/wandfuehrung';
import { beschriftungsVorschlaege, hoehenText, type Beschriftungsvorschlag } from '../lib/beschriftung3d';
import {
  ANSCHLUSS_AUSWAHL,
  VENTIL_AUSWAHL,
  WERKZEUGE,
  anschlussKurz,
  darfSetzen,
  deuteZiel,
  durchbruchAmRand,
  durchbruchMeldung,
  durchbruchPreset,
  rohrHoehe,
  rohrLaenge,
  rohrMeldung,
  sturzAusZiel,
  zielAuskunft,
  zielAuswahl,
  type Werkzeug,
  type Zieltreffer,
} from '../lib/werkzeugkiste';
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
import {
  AUGENHOEHE,
  TEMPO_GEHEN,
  TEMPO_SCHNELL,
  TUER_OFFEN_WINKEL,
  TUER_TEMPO,
  begrenzeNick,
  blickrichtung,
  gehe,
  hindernisse,
  schritt,
  tuerInReichweite,
  type Hindernis,
} from '../lib/begehen';
import { pointInPolygon } from '../lib/geometry';
import { deuteTreffer, szeneZuModell } from '../lib/raumtreffer';
import { buildRoofFrame, roofHeightAt } from '../lib/roofGeometry';
import { gebaeudeUmriss } from '../lib/roomDetection';
import { sammleVerlegekurven, verlegelinien, type Verlegelinie } from '../lib/fussbodenkurven';
import { kompassRose } from '../lib/kompass';
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

  /**
   * Das gefasste Objekt.
   *
   * Dasselbe Blau wie die Auswahl im Grundriss — wer im Plan etwas anfasst
   * und dann in den Raum wechselt, soll dasselbe Ding in derselben Farbe
   * wiederfinden. Leicht leuchtend, damit es auch im Schatten zu sehen ist.
   */
  const gefasst = new THREE.MeshStandardMaterial({
    color: 0x38bdf8,
    emissive: 0x0b4a6f,
    roughness: 0.35,
    metalness: 0.1,
  });

  /** Das Objekt unter dem Zeiger — heller, aber noch nicht gefasst. */
  const beruehrt = new THREE.MeshStandardMaterial({
    color: 0xfbbf24,
    emissive: 0x7c2d12,
    roughness: 0.4,
    metalness: 0.1,
  });

  /*
   * Ein Werkstoff je Farbe — und nicht je Körper.
   *
   * Seit 1.26.0 hängt jede Leitung und jede Armatur als eigener Körper in
   * der Szene, damit man sie anfassen kann. Die erste Fassung baute dabei
   * für jede Leitung ein eigenes `MeshStandardMaterial`. Das sieht harmlos
   * aus und ist es nicht: Der Inhalt der Szene wird bei jeder Änderung neu
   * aufgebaut, die alten Werkstoffe werden nicht freigegeben, und jeder
   * einzelne belegt ein Schattenprogramm auf der Grafikkarte. Im Rauchtest
   * — Software-WebGL, 76 Leitungen, Dutzende Neuaufbauten — ist der
   * Anzeigeprozess daran abgestürzt.
   *
   * Die Farbe hängt an der Leitungsart, nicht an der Leitung. Also gibt es
   * so viele Werkstoffe wie Leitungsarten, einmal gebaut, für immer.
   */
  const rohr: Record<string, THREE.MeshStandardMaterial> = {};
  for (const farbe of new Set(Object.values(PIPE_SERVICE_COLORS))) {
    rohr[farbe] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(farbe),
      roughness: 0.4,
      metalness: 0.3,
    });
  }

  /*
   * Die Anbindeleitung der Fußbodenheizung.
   *
   * Sie bekommt einen eigenen, durchscheinenden Werkstoff und nicht die Farbe
   * des Vorlaufs: Sie ist die kürzeste Verbindung zwischen Verteiler und
   * Kurvenanfang und **nicht** die verlegte Trasse — die läuft an Wänden
   * entlang und im Bündel mit den Nachbarkreisen. Ein Modell, das sie wie
   * gelegtes Rohr zeichnet, behauptet eine Lage, die niemand aufgemessen hat.
   */
  const fbhAnbindung = new THREE.MeshStandardMaterial({
    color: new THREE.Color(PIPE_SERVICE_COLORS['heating-flow']),
    roughness: 0.5,
    metalness: 0.2,
    transparent: true,
    opacity: 0.45,
  });

  /** Dasselbe für die Bodenbeläge: ein Werkstoff je Belagsfarbe. */
  const belag: Record<string, THREE.MeshStandardMaterial> = {};
  for (const b of BODENBELAEGE) {
    belag[b.farbe] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(b.farbe),
      roughness: 0.9,
      metalness: 0,
    });
  }

  return {
    rohr,
    belag,
    fbhAnbindung,
    clay,
    clayInterior,
    floor,
    roof,
    stair,
    shaft,
    masonry,
    slab,
    glass,
    frame,
    door,
    heating,
    sanitary,
    ventilation,
    gefasst,
    beruehrt,
  };
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
  durchbrueche: Durchbruch[];
  /**
   * Deckenplatten zwischen den Geschossen.
   *
   * Ohne sie stand zwischen Wandoberkante und dem nächsten Geschoss die
   * Deckenstärke als Luft — das Haus zerfiel optisch in schwebende Scheiben.
   */
  slabs: SlabPlan[];
  pipes: PipeRun[];
  accessories: PipeAccessory[];
  /**
   * Die Verlegekurven der Fußbodenheizungen, je Geschoss.
   *
   * Sie stehen nicht im Dokument und können es nicht: Eine Kurve folgt aus
   * dem Raumpolygon und wäre nach dem ersten Wandzug falsch. Gerechnet
   * werden sie von `sammleVerlegekurven` — derselben Stelle, die auch der
   * Grundriss fragt. Zwei Fassungen derselben Regel liefen auseinander, und
   * dann zeigte der Plan eine andere Verlegung als das Modell.
   */
  fussbodenkurven: { levelId: string; linien: readonly Verlegelinie[] }[];
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

/**
 * Ein TGA-Objekt als **eigener** Körper.
 *
 * Bis 1.20.3 wurden auch die TGA-Objekte in die Gewerkegeometrie gemerged.
 * Das war für die Anzeige richtig und fürs Anfassen tödlich: Ein Strahl, der
 * einen Heizkörper trifft, landete in einem Klumpen aus allen Heizkörpern,
 * allen Armaturen und allen Rohren — ohne Kennung, ohne Zuordnung.
 *
 * Jetzt bekommt jedes Objekt sein eigenes Mesh. Der Preis sind ein paar
 * Dutzend zusätzliche Zeichenaufrufe — in einem Wohnhaus sind es zwanzig bis
 * achtzig Objekte, nicht Hunderte. Das Verschmelzen bleibt dort, wo es
 * gebraucht wird: bei Wänden, Decken und Dach, also bei dem, wovon es viel
 * gibt und was niemand einzeln anfasst.
 */
interface TgaKoerper {
  id: string;
  category: FixtureCategory;
  geometry: THREE.BufferGeometry;
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
  /** Je Leitung ein Körper — damit sich eine einzelne anfassen lässt. */
  pipes: { runId: string; colour: string; geometry: THREE.BufferGeometry }[];
  /** Je Armatur ein Körper, aus demselben Grund. */
  accessories: { id: string; geometry: THREE.BufferGeometry }[];
  /** Raumböden mit erfasstem Belag, nach Belagsfarbe zusammengefasst. */
  coveredFloors: { colour: string; geometry: THREE.BufferGeometry }[];
  /**
   * Die Rohre der Fußbodenheizung im Estrich — Verlegung und Anbindung
   * getrennt, weil die Anbindung die kürzeste Verbindung zeigt und nicht die
   * verlegte Trasse. Sie wird deshalb schwächer gezeichnet.
   */
  floorPipes: THREE.BufferGeometry | null;
  floorSupply: THREE.BufferGeometry | null;
  glass: THREE.BufferGeometry | null;
  frames: THREE.BufferGeometry | null;
  /**
   * Türblätter — je Flügel eines, mit Kennung und Angelpunkt.
   *
   * **Warum nicht mehr ein zusammengefasster Körper.** Bis 1.28.2 wurden alle
   * Blätter in *eine* Geometrie verschmolzen, mit dem Öffnungswinkel fest
   * eingebacken. Das war billig und richtig, solange eine Tür ein Symbol war,
   * das die Anschlagsrichtung zeigt. Sobald man sie im begehbaren Modus
   * öffnen und schließen kann, ist sie ein Bauteil, das sich bewegt — und
   * bewegen lässt sich nur, was für sich steht.
   *
   * Das Blatt ist so gebaut, dass die Bandachse im Ursprung liegt und das
   * geschlossene Blatt in der Wandebene: Der Öffnungswinkel ist dann eine
   * Drehung um die Hochachse und sonst nichts.
   */
  doors: {
    openingId: string;
    geometry: THREE.BufferGeometry;
    /** Bandachse in Szenenkoordinaten. */
    hinge: { x: number; y: number; z: number };
    /** Drehung der Wand in der Szene [rad]. */
    wallAngle: number;
    /** Vorzeichen, mit dem der Öffnungswinkel wirkt (Anschlag und Seite). */
    sign: number;
    /** Schiebetür: sie schwenkt nicht, sie fährt. */
    sliding: boolean;
  }[];
  bounds: THREE.Box3;
}

/**
 * Die Körper der TGA-Objekte — je Objekt einer, mit Kennung.
 *
 * **Warum das eine eigene Funktion ist.** Sie wird an zwei Stellen gebraucht:
 * beim vollständigen Aufbau und beim *Umsetzen im Raum*. Beim Ziehen eines
 * Heizkörpers das ganze Haus neu zu bauen — Wände, Öffnungen, Dachraster,
 * Decken, Rohre — kostet bei jedem Bild mehr Zeit, als zwischen zwei Bildern
 * ist; das Objekt hinkt dann der Hand hinterher. Hier wird nur gebaut, was
 * sich wirklich ändert.
 */
function baueTgaKoerper(
  fixtures: Fixture[],
  roofFrame: ReturnType<typeof buildRoofFrame>,
  levelBase: Map<string, number>,
  /** Geschoss, zu dem der Dachrahmen gehört — für alle anderen gilt er nicht. */
  roofLevelId: string,
): TgaKoerper[] {
  const raus: TgaKoerper[] = [];
  for (const f of fixtures) {
    const h = FIXTURE_HEIGHT[f.type] ?? 0.3;
    // Steigstränge und Fallstränge laufen durchs ganze Geschoss.
    const isRiser = f.type === 'riser-heating' || f.type === 'riser-sanitary';
    // Auch die TGA endet unter der Schräge am Dach — ein Lüftungsventil, das
    // durch das Dach ragt, sieht nach Fehler aus, weil es einer ist.
    // Der Rahmen gilt nur für Objekte auf dem Dachgeschoss. Ohne diese
    // Bindung wurde ein Lüftungsventil im Erdgeschoss an der Schräge des
    // Obergeschosses gekappt — und verschwand ganz, sobald das Dach tief
    // genug saß.
    const tgaDach = roofFrame && f.levelId === roofLevelId ? roofFrame : null;
    const roofTop = tgaDach ? roofHeightAt(tgaDach, f.position) : Infinity;
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

    geom.translate(0, levelBase.get(f.levelId) ?? 0, 0);
    raus.push({ id: f.id, category: f.category, geometry: geom });
  }
  return raus;
}

function buildGeometry(input: BuildInput): BuiltGeometry {
  const { walls, openings, rooms, nodes, roof, roofOpenings, verticals, solids, durchbrueche, slabs, pipes, accessories, fussbodenkurven, levelHeight, levelBase } = input;

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
  const doorLeaves: BuiltGeometry['doors'] = [];
  const floorParts: THREE.BufferGeometry[] = [];
  const heatingParts: THREE.BufferGeometry[] = [];
  const sanitaryParts: THREE.BufferGeometry[] = [];
  const ventilationParts: THREE.BufferGeometry[] = [];
  const roofParts: THREE.BufferGeometry[] = [];
  const stairParts: THREE.BufferGeometry[] = [];
  const solidParts: THREE.BufferGeometry[] = [];
  const shaftParts: THREE.BufferGeometry[] = [];
  const slabParts: THREE.BufferGeometry[] = [];

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
  /*
   * Das Dach gehört **einem** Geschoss.
   *
   * Seit 1.27.0 können mehrere Geschosse zugleich im Bild stehen, und
   * `walls`/`rooms` enthalten seither alle sichtbaren. Der Dachrahmen wurde
   * aber weiter aus dieser Gesamtmenge gebildet und danach auf *jede* Wand
   * angewandt — unabhängig davon, auf welchem Geschoss sie steht. Weil das
   * Kappen in den lokalen Höhen der jeweiligen Wand rechnet, bekam damit
   * jedes Geschoss sein eigenes Dach: dasselbe Dach, einmal je Stockwerk,
   * mitten durch die Wände. Vor 1.27.0 fiel das nicht auf, weil nur das
   * aktive Geschoss gezeichnet wurde und beide Mengen dieselben waren.
   */
  const dachGeschoss = input.roofLevelId ?? '';
  const dachWaende = walls.filter((w) => w.levelId === dachGeschoss);
  const dachRaeume = rooms.filter((r) => r.levelId === dachGeschoss);

  const roofOutline: { x: number; y: number }[] = [];
  for (const w of dachWaende) {
    const na = nodes[w.a];
    const nb = nodes[w.b];
    if (na) roofOutline.push({ x: na.x, y: na.y });
    if (nb) roofOutline.push({ x: nb.x, y: nb.y });
  }
  // Gauben gehen in die Höhenfunktion ein: das Dachraster hebt sich dort von
  // selbst, und die Wände darunter werden entsprechend höher gekappt.
  // Der geordnete Umriss kommt dazu: ohne ihn bekäme ein L-förmiges Haus ein
  // Walmdach über seiner Bounding Box, und die Wände würden an einer
  // Dachfläche gekappt, die über dem Innenwinkel gar nicht liegt.
  const roofFrame = buildRoofFrame(
    roof,
    roofOutline,
    roofOpenings,
    roof && roof.kind !== 'flat' ? gebaeudeUmriss(dachWaende, nodes as never) : [],
  );

  for (const wall of walls) {
    const g = getWallGeometry(wall, nodes as never);
    if (!g) continue;
    const wallOpenings = openingsOfWall(wall.id, openings);
    const extStart = extensionAt(wall.a, wall);
    const extEnd = extensionAt(wall.b, wall);
    // Durchbrüche werden aus derselben Zerlegung geschnitten wie Fenster und
    // Türen: in 3D sieht man durch eine Kernbohrung hindurch, weil dort
    // wirklich kein Material steht. Die Regel, welche Durchbrüche das dürfen,
    // steht in `durchbruchAussparungen` — nicht hier.
    const aussparungen = durchbruchAussparungen(durchbrueche, wall.id, wallOpenings, g.length);
    const parts = wallSolidParts(g, [...wallOpenings, ...aussparungen], extStart, extEnd);
    const target = wall.type === 'exterior' ? exteriorParts : interiorParts;
    const dz = basis(wall.levelId);
    // Nur die Wände des Dachgeschosses enden an der Schräge; alle anderen
    // gehen auf ihre volle Geschosshöhe.
    const wandDach = wall.levelId === dachGeschoss ? roofFrame : null;

    for (const part of parts) {
      if (!wandDach) {
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
        const top = Math.min(part.zEnd, roofHeightAt(wandDach, mid));
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
      const roofTop = wandDach ? roofHeightAt(wandDach, opCentre) : Infinity;
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
        //
        // Sie schwenkt nicht, also bekommt sie auch keinen Angelpunkt: Die
        // Geometrie steht schon an ihrem Platz, der Angelpunkt ist der
        // Ursprung, und „öffnen" heißt sie ausblenden. Ein fahrendes Blatt
        // wäre schöner und bräuchte die Wandtasche, die das Modell nicht
        // führt — dann stünde es beim Öffnen in der Nachbarwand.
        doorLeaves.push({
          openingId: op.id,
          geometry: boxInWall(
            g,
            span.from,
            span.to,
            0.02,
            op.sillHeight,
            head,
            g.halfThickness + 0.03,
            dz,
          ),
          hinge: { x: 0, y: 0, z: 0 },
          wallAngle: 0,
          sign: 0,
          sliding: true,
        });
      } else {
        // Der Anschlagsinn. Wie weit das Blatt steht, entscheidet die
        // Ansicht (siehe `TUER_OFFEN_WINKEL` und `tuerenOffen`) — hier wird
        // nur gebaut, nicht geöffnet.
        const swing = op.flipSwing ? -1 : 1;

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
          // Blatt so verschieben, dass die Drehachse an der Bandseite im
          // Ursprung liegt. Ohne Drehung liegt es damit in der Wandebene —
          // das ist die geschlossene Tür, und jeder Öffnungswinkel ist von
          // dort aus eine reine Drehung um die Hochachse.
          leaf.translate((l.width / 2) * l.dirSign, leafHeight / 2 + op.sillHeight, 0);

          // Aufgestellt wird um die Bandachse. Weil die Szenendrehung die
          // Querrichtung vertauscht (siehe `wallBoxPlacement`), zeigt das
          // lokale +z des Blattes auf die Gegennormale — der Anschlagsinn
          // `swing · dirSign` ist genau darauf abgestimmt und liefert dieselbe
          // Seite, die der Plan zeichnet.
          const anchor = wallLocalToScene(g, l.hingeU, 0, 0);
          doorLeaves.push({
            openingId: op.id,
            geometry: leaf,
            hinge: { x: anchor.x, y: anchor.y + dz, z: anchor.z },
            wallAngle: sceneRotationY(g.angle),
            sign: swing * l.dirSign,
            sliding: false,
          });
        }
      }
    }
  }

  /*
   * --- TGA-Körper ------------------------------------------------------
   *
   * Sie werden hier **nicht** gebaut. Sie hängen in einer eigenen Gruppe und
   * in einem eigenen Effekt, weil sie sich beim Arbeiten am häufigsten ändern
   * und am billigsten neu entstehen. Siehe `baueTgaKoerper`.
   */

  /*
   * Bodenplatten aus den erkannten Räumen — eingefärbt nach Belag.
   *
   * Bis 1.25.0 waren alle Böden dieselbe graue Fläche. Damit sah ein Modell,
   * in dem der Belag vollständig erfasst ist, genauso aus wie eines, in dem
   * niemand ihn angefasst hat — und wo Fliese aufhört und Parkett anfängt,
   * war nirgends zu sehen. Räume ohne Angabe behalten das Grau; genau daran
   * erkennt man sie jetzt auf einen Blick.
   */
  const floorByColour = new Map<string, THREE.BufferGeometry[]>();
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
    const belag = belagNach(room.floorCovering);
    if (belag) {
      const liste = floorByColour.get(belag.farbe) ?? [];
      liste.push(hebe(geom, room.levelId));
      floorByColour.set(belag.farbe, liste);
    } else {
      floorParts.push(hebe(geom, room.levelId));
    }
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
    const polys = dachRaeume.map((r) => r.polygon).filter((p) => p.length >= 3);
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
  const pipeByRun = new Map<string, { colour: string; parts: THREE.BufferGeometry[] }>();
  for (const run of pipes) {
    const radius = Math.max(0.012, (run.nominalDiameter / 1000) * 0.6);
    const colour = PIPE_SERVICE_COLORS[run.service];
    const eintrag = pipeByRun.get(run.id) ?? { colour, parts: [] };
    const list = eintrag.parts;
    /*
     * **Eine Leitung darf steigen.**
     *
     * Bis 1.23.0 lag jeder Zylinder waagerecht auf `run.elevation`, und die
     * Teilstrecke wurde verworfen, sobald ihre Grundrisslänge unter einem
     * zehntel Millimeter lag. Ein Fallstrang in der Zimmerecke — im
     * Grundriss ein Punkt, in Wirklichkeit zweieinhalb Meter Rohr — war
     * damit unsichtbar: Er stand im Modell, wurde gezählt und gerechnet,
     * und im Bild war nichts.
     *
     * Jetzt bekommt jeder Punkt seine eigene Höhe (`hoeheAnPunkt`, linear
     * über die zurückgelegte Trasse), und der Zylinder wird zwischen zwei
     * Raumpunkten aufgespannt statt entlang der Grundrissachse gedreht.
     * `lookAt` auf die Verbindungsachse ist dafür der kurze Weg: Er trägt
     * die senkrechte Neigung von selbst, während eine Drehung um die
     * Hochachse sie gar nicht ausdrücken kann.
     */
    for (let i = 1; i < run.points.length; i++) {
      const a = run.points[i - 1];
      const b = run.points[i];
      const vonP = modelToScene(a, hoeheAnPunkt(run, i - 1) + 0.02);
      const bisP = modelToScene(b, hoeheAnPunkt(run, i) + 0.02);
      const von = new THREE.Vector3(vonP.x, vonP.y, vonP.z);
      const bis = new THREE.Vector3(bisP.x, bisP.y, bisP.z);
      const len = von.distanceTo(bis);
      if (len < 1e-4) continue;
      const geom = new THREE.CylinderGeometry(radius, radius, len, 8);
      // Der Zylinder steht in Three.js auf der y-Achse; die Ausrichtung
      // entsteht daher über eine Basis, deren „oben" die Rohrachse ist.
      const achse = new THREE.Vector3().subVectors(bis, von).normalize();
      const hilf = Math.abs(achse.y) > 0.999 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
      const quer = new THREE.Vector3().crossVectors(hilf, achse).normalize();
      const dritte = new THREE.Vector3().crossVectors(achse, quer);
      const m = new THREE.Matrix4().makeBasis(quer, achse, dritte);
      m.setPosition(
        (von.x + bis.x) / 2,
        (von.y + bis.y) / 2,
        (von.z + bis.z) / 2,
      );
      geom.applyMatrix4(m);
      list.push(hebe(geom, run.levelId));
    }
    pipeByRun.set(run.id, eintrag);
  }

  // --- Fußbodenheizung im Estrich ------------------------------------------
  /*
   * **Warum die Rohre überhaupt ins Modell gehören.**
   *
   * Der Estrich war bis hierher eine glatte Platte, obwohl das Programm
   * genau weiß, wo jedes Rohr liegt. Für den Verleger ist das die
   * entscheidende Ansicht: Er sieht in *einem* Bild, ob die Schlange um den
   * Kamin herumkommt, ob die Anbindungen sich im Flur häufen, und wo ein
   * Kreis quer durch einen anderen Raum müsste.
   *
   * **Warum Zylinderstücke und keine geglättete Schlauchkurve.** Eine
   * geglättete Kurve sähe gefälliger aus und läge an den Kehren woanders als
   * die Linie im Grundriss. Plan und Modell müssen dieselbe Verlegung
   * zeigen, sonst glaubt man keinem von beiden — die Kehren sind hier kein
   * Darstellungsdetail, sondern die Stelle, an der der Verlegeabstand
   * eingehalten wird oder nicht.
   *
   * Maß: 16 × 2 mm Verbundrohr, also 8 mm Außenradius — das gängige
   * Flächenheizungsrohr. Es liegt 4 cm über OK Rohdecke, also im Estrich
   * und damit über einem etwaigen Bodenbelag, der auf der Rohdecke gezeichnet
   * wird. Beides sind Darstellungsmaße: Gerechnet wird mit diesen Zahlen
   * nichts, die Auslegung steht in `hydraulics.ts`.
   */
  const FBH_RADIUS = 0.008;
  const FBH_HOEHE = 0.04;
  const floorPipeParts: THREE.BufferGeometry[] = [];
  const floorSupplyParts: THREE.BufferGeometry[] = [];
  for (const geschoss of fussbodenkurven) {
    for (const linie of geschoss.linien) {
      const ziel = linie.anbindung ? floorSupplyParts : floorPipeParts;
      for (let i = 1; i < linie.punkte.length; i++) {
        const vonP = modelToScene(linie.punkte[i - 1], FBH_HOEHE);
        const bisP = modelToScene(linie.punkte[i], FBH_HOEHE);
        const dx = bisP.x - vonP.x;
        const dz = bisP.z - vonP.z;
        const len = Math.hypot(dx, dz);
        if (len < 1e-4) continue;
        const geom = new THREE.CylinderGeometry(FBH_RADIUS, FBH_RADIUS, len, 6);
        // Waagerecht im Estrich: eine Vierteldrehung um x legt den Zylinder
        // hin, die Drehung um y richtet ihn auf die Trasse aus.
        geom.rotateX(Math.PI / 2);
        geom.rotateY(Math.atan2(dx, dz));
        geom.translate((vonP.x + bisP.x) / 2, vonP.y, (vonP.z + bisP.z) / 2);
        ziel.push(hebe(geom, geschoss.levelId));
      }
    }
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
  const floorPipes = merge(floorPipeParts);
  const floorSupply = merge(floorSupplyParts);
  const pipeMeshes: { runId: string; colour: string; geometry: THREE.BufferGeometry }[] = [];
  const accessoryMeshes: { id: string; geometry: THREE.BufferGeometry }[] = [];
  const coveredFloors: { colour: string; geometry: THREE.BufferGeometry }[] = [];
  for (const [colour, list] of floorByColour) {
    const g = merge(list);
    if (g) coveredFloors.push({ colour, geometry: g });
  }
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
    accessoryMeshes.push({ id: armatur.id, geometry: hebe(geom, armatur.levelId) });
  }

  for (const [runId, eintrag] of pipeByRun) {
    const g = merge(eintrag.parts);
    if (g) pipeMeshes.push({ runId, colour: eintrag.colour, geometry: g });
  }
  const glass = merge(glassParts);
  const frames = merge(framePartsGeom);
  const doors = doorLeaves;
  /*
   * Die Armaturen standen bis 1.25.0 im Gewerkeklumpen der Heizung — mit der
   * Begründung, niemand fasse im Modell ein einzelnes Eckventil an. Die
   * Begründung war falsch: Wer eine Armatur sieht, will wissen, was sie ist,
   * und sie gegebenenfalls loswerden. Dafür braucht jede ihren eigenen
   * Körper. Es sind Würfel mit acht Zentimetern Kante; die zusätzlichen
   * Zeichenaufrufe fallen gegen eine Wand aus 200 Dreiecken nicht ins
   * Gewicht.
   */
  const heating = merge(heatingParts);
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
    accessories: accessoryMeshes,
    coveredFloors,
    floorPipes,
    floorSupply,
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
function buildSite(
  site: SitePlan | undefined,
  /**
   * Geländeoberkante über dem Bezugsniveau [m].
   *
   * **Warum das nicht null ist, sobald ein Keller im Spiel ist.** Alles in
   * diesem Modell wird von Oberkante Fertigfußboden Erdgeschoss aus
   * gerechnet; das Gelände liegt bei einem unterkellerten Haus aber rund
   * 2,60 m tiefer. Bis 1.26.0 wurde die Außenanlage trotzdem auf y = 0
   * gezeichnet — der Rasen lag damit auf Höhe des Erdgeschossfußbodens und
   * im Keller **über** dem Kopf. Genau das ist gemeint, wenn jemand sagt,
   * er sehe im Kellergeschoss noch das Grundstück: Es lag nicht nur im
   * Bild, es lag an der falschen Stelle.
   *
   * Ohne erfasste Geländeoberkante bleibt es bei null — das ist der
   * nicht unterkellerte Regelfall und keine Annahme.
   */
  gelaende: number,
): THREE.Group | null {
  if (!site) return null;
  const elements = Object.values(site.elements ?? {});
  const pumps = Object.values(site.pumps ?? {});
  if (!elements.length && !pumps.length) return null;

  const group = new THREE.Group();
  // Die ganze Außenanlage hängt an der Geländeoberkante. Die Höhen der
  // einzelnen Objekte darin bleiben dadurch, was sie sind: Bezugsebene ist
  // das Gelände, nicht der Fußboden des Erdgeschosses.
  group.position.y = gelaende;
  group.name = 'gelaende';

  const mat = {
    boundary: new THREE.LineBasicMaterial({ color: 0xfbbf24 }),
    /*
     * Das Grundstück als Fläche.
     *
     * Gedeckt und matt, damit es Untergrund bleibt und nicht mit dem Haus
     * um Aufmerksamkeit ringt. Es liegt tiefer als jede gepflasterte
     * Fläche, damit Zufahrt und Terrasse darauf sichtbar bleiben.
     */
    lawn: new THREE.MeshStandardMaterial({ color: 0x4a6b3d, roughness: 1, metalness: 0 }),
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
        /*
         * Die Grenze ist zweierlei, und beides wird gebraucht.
         *
         * Sie ist eine **Rechtslinie** — dafür die kräftige gelbe Kante,
         * die auch dann zu sehen ist, wenn etwas darauf steht. Und sie
         * umschließt das **Grundstück** — eine Fläche, auf der ein Haus
         * steht und neben dem Haus Rasen liegt. Bis 1.25.0 gab es nur die
         * Linie; ein Modell mit erfasstem Grundstück sah aus wie eines
         * ohne, das Haus schwebte über einem Raster. Die Fläche liegt
         * einen Zentimeter unter Gelände, damit Zufahrt, Terrasse und
         * Kollektorfeld darüber sichtbar bleiben.
         */
        const boden = new THREE.Mesh(new THREE.ShapeGeometry(shapeOf(pts)), mat.lawn);
        layFlat(boden, -0.01);
        boden.receiveShadow = true;
        group.add(boden);

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
  /** Die anfassbaren Objekte — eigene Gruppe, damit der Strahl kurz bleibt. */
  const tgaGruppeRef = useRef<THREE.Group | null>(null);
  /**
   * Schattenfänger und Raster — beide stellen den **Boden** dar.
   *
   * Sie lagen fest auf y ≈ 0, also auf Oberkante Fertigfußboden Erdgeschoss.
   * Bei einem unterkellerten Haus liegt das Gelände rund 2,60 m tiefer; das
   * Raster schnitt dann mitten durch das Kellergeschoss und der Schatten fiel
   * auf eine Ebene in der Luft. Beide folgen jetzt der Geländeoberkante.
   */
  const schattenRef = useRef<THREE.Mesh | null>(null);
  const rasterRef = useRef<THREE.GridHelper | null>(null);
  /** Zählt die Neuaufbauten des Hauses — koppelt die TGA-Gruppe daran. */
  const [neuaufbau, setNeuaufbau] = useState(0);
  const fuehrungRef = useRef<THREE.Group | null>(null);
  /**
   * Die Anfasspunkte am ausgewählten Bauteil.
   *
   * Eigene Gruppe, und anders als das Führungsband **fängt sie den Strahl**:
   * Ein Griff, den man nicht treffen kann, ist eine Verzierung. Sie liegt
   * zuletzt in der Szene und wird ohne Tiefenprüfung gezeichnet — ein Griff
   * an der Rückseite einer Wand muss sichtbar bleiben, sonst kommt man an
   * die Wandstärke nur heran, indem man um das Haus herumfliegt.
   */
  const griffGruppeRef = useRef<THREE.Group | null>(null);
  /**
   * Fangkörper für Öffnungen — unsichtbar, nur zum Treffen.
   *
   * **Warum es sie braucht.** Eine Öffnung ist im Modell ein **Loch**:
   * `wallSolidParts` baut die Wandstücke darum herum, und dort, wo das
   * Fenster ist, ist nichts. Ein Strahl fliegt also hindurch und trifft, was
   * dahinter liegt — die Nachbarwand, den Fußboden, den Himmel. Anwählbar
   * war eine Öffnung in 3D deshalb bis 1.24.0 überhaupt nicht.
   *
   * Der Fangkörper füllt das Loch mit einem unsichtbaren Quader. Er wird
   * nicht gezeichnet (`visible = false` reicht nicht — dann ignoriert ihn
   * auch der Strahl; also gezeichnet mit `colorWrite: false` und `depthWrite:
   * false`), und er wird **gegen die Entfernung geprüft** wie die
   * TGA-Objekte: Wer auf die Wand neben dem Fenster zeigt, meint die Wand.
   */
  const oeffnungsGruppeRef = useRef<THREE.Group | null>(null);
  const perspectiveRef = useRef<THREE.PerspectiveCamera | null>(null);
  const orthoRef = useRef<THREE.OrthographicCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const materialsRef = useRef<Materials | null>(null);
  const fittedRef = useRef(false);
  /** Ausdehnung des zuletzt gebauten Modells — für das Einpassen auf Zuruf. */
  const boundsRef = useRef<THREE.Box3 | null>(null);
  /** Halbe Höhe des orthografischen Frustums — steuert den Iso-Zoom. */
  const orthoFrustumRef = useRef(12);
  const resizeRef = useRef<() => void>(() => {});

  /*
   * --- Begehen ------------------------------------------------------------
   *
   * Alles, was der Begehmodus braucht, liegt in Refs und nicht im State: Es
   * ändert sich sechzigmal in der Sekunde, und ein React-Zustand, der das
   * mitmacht, baut sechzigmal in der Sekunde die Oberfläche neu auf.
   */
  /** Womit gerade gerendert wird — im Begehmodus hält OrbitControls nicht mehr die Wahrheit. */
  const aktiveKameraRef = useRef<THREE.Camera | null>(null);
  /** Wo der Betrachter steht (Modellkoordinaten) und wohin er schaut [rad]. */
  const geherRef = useRef({ x: 0, y: 0, gier: 0, nick: 0 });
  /**
   * Die Türblätter in der Szene — je Flügel eines, mit seiner Drehgruppe.
   *
   * Ein Ref und kein Zustand: Der Öffnungswinkel wird sechzigmal in der
   * Sekunde nachgeführt, und eine Zustandsänderung je Bild wäre ein
   * Neuaufbau des ganzen Betrachters je Bild.
   */
  const tuerBlaetterRef = useRef<
    { id: string; mesh: THREE.Mesh; gruppe: THREE.Group | null; sign: number }[]
  >([]);
  /**
   * Welche Türen offen stehen, und wie weit — 0 = zu, 1 = ganz auf.
   *
   * **Warum das im Betrachter steht und nicht im Dokument.** Ob eine Tür
   * gerade offen ist, ist keine Eigenschaft des Gebäudes. Sie im Modell zu
   * führen hieße, sie zu speichern, zu exportieren und in der Historie zu
   * haben — eine Tür aufzumachen wäre dann ein Bearbeitungsschritt, den
   * Strg+Z zurücknimmt. Das ist sie nicht.
   */
  const tuerStandRef = useRef(new Map<string, number>());
  /** Der Knotenpunkt der Kompassrose — wird je Bild gedreht, siehe unten. */
  const kompassRef = useRef<HTMLDivElement | null>(null);
  /** Ziel je Tür: 0 oder 1. Dazwischen läuft die Bewegung. */
  const tuerZielRef = useRef(new Map<string, number>());
  /**
   * Die Absicht — getrennt nach Quelle.
   *
   * Tastatur und Steuerkreuz schreiben in **verschiedene** Felder und werden
   * erst beim Schritt addiert. Sonst löscht das Loslassen des Steuerkreuzes
   * eine gedrückte Taste, und wer beides benutzt, bleibt mitten im Raum
   * stehen.
   */
  const eingabeRef = useRef({ tastVor: 0, tastSeit: 0, stickVor: 0, stickSeit: 0, schnell: false });
  const uhrRef = useRef<THREE.Clock | null>(null);
  const hindRef = useRef<Hindernis[]>([]);
  /** Augenhöhe über dem Szenennullpunkt [m] — Geschosshöhe plus 1,65 m. */
  const augenRef = useRef(AUGENHOEHE);
  /** Nur für die Anzeige: steht der Zeiger gerade unter Fangschloss? */
  const [zeigerGefangen, setZeigerGefangen] = useState(false);

  /*
   * --- Die Werkzeugkiste im Haus ------------------------------------------
   *
   * Anders als der Rest des Begehmodus gehört sie in den React-Zustand: Sie
   * ändert sich nur, wenn jemand etwas antippt, und sie muss gezeichnet
   * werden. Die 60-Hz-Werte bleiben in Refs (siehe oben) — nur die eine
   * Zeile am Fadenkreuz wird in ruhigem Takt in den Zustand geschrieben.
   */
  /** Welches Werkzeug in der Hand liegt — `null` heißt: nur schauen. */
  const [werkzeug, setWerkzeug] = useState<Werkzeug | null>(null);
  /** Anschlussart und Ventilseite für den nächsten Heizkörper. */
  const [anschluss, setAnschluss] = useState<RadiatorConnection>('unten');
  const [ventilSeite, setVentilSeite] = useState<VentilSeite | null>(null);
  /** Was das Fadenkreuz gerade trifft — für Auskunft und Knopfbeschriftung. */
  const [ziel, setZiel] = useState<Zieltreffer | null>(null);
  /** Beim Rohr: der schon gesetzte Anfang. */
  const [rohrAnfang, setRohrAnfang] = useState<{ punkt: Vec2; hoehe: number } | null>(null);
  /** Was gerade an einem Griff gezogen wird. */
  const griffZugRef = useRef<{
    griff: Griff;
    /** Bildschirmrichtung der Griffachse, auf Einheitslänge je Meter. */
    achseAufSchirm: { x: number; y: number };
    /** Bildpunkte je Meter entlang der Achse — der Umrechnungsfaktor. */
    pixelProMeter: number;
    start: { x: number; y: number };
    angemeldet: boolean;
    bewegt: boolean;
  } | null>(null);
  /** Der Griff, an dem gerade ein Maß eingetippt wird. */
  const [tippGriff, setTippGriff] = useState<Griff | null>(null);
  const [tippWert, setTippWert] = useState('');

  /** Beim Beschriften: die Werte, die das Modell anbietet. */
  const [vorschlaege, setVorschlaege] = useState<
    { fixtureId: string; punkt: Vec2; hoehe: number; liste: Beschriftungsvorschlag[] } | null
  >(null);
  /** Ist die Kiste aufgeklappt? Auf dem Tablet nimmt sie sonst das halbe Bild. */
  const [kisteOffen, setKisteOffen] = useState(false);

  const doc = useBimStore((s) => s.doc);
  const cameraMode = useBimStore((s) => s.cameraMode);
  const viewMode = useBimStore((s) => s.viewMode);
  /** Die Auswahl — geteilt mit dem Grundriss, damit beide dasselbe meinen. */
  const selections = useBimStore((s) => s.selections);
  const site = useBimStore((s) => s.doc.site);
  /**
   * Das Gelände lässt sich ausblenden — über **seine Ebene**.
   *
   * Bei einem großen Grundstück nimmt es den größten Teil des Bildes ein, und
   * wer am Dachaufbau arbeitet, will das Haus sehen, nicht den Garten.
   *
   * Bis 1.26.0 war das ein eigener Schalter allein für die 3D-Ansicht. Damit
   * gab es das Gelände zweimal: Man blendete es im Plan aus und sah es im
   * Modell weiter — und im Kellergeschoss lag der Rasen über der Bodenplatte,
   * ohne dass man ihn irgendwo losgeworden wäre. Jetzt ist es eine Ebene wie
   * jede andere, und der Knopf hier schaltet dieselbe: ein Zustand, zwei
   * Ansichten.
   */
  const toggleLayer = useBimStore((s) => s.toggleLayer);
  const showSite = doc.layers[EBENE_GELAENDE]?.visible !== false;

  /*
   * --- Geschosse lassen sich einzeln zeigen -------------------------------
   *
   * Der Grundriss zeigt immer *ein* Geschoss, das Modell zeigte immer
   * *alle* — genau darin lagen Erdgeschoss, Obergeschoss und Keller
   * auseinander. Wer im Keller arbeitete, sah im Plan den Keller und im
   * Modell das ganze Haus darüber.
   *
   * Das aktive Geschoss ist immer dabei: Man bearbeitet nicht, was man nicht
   * sieht. Und `visible === undefined` heißt sichtbar — eine ältere Datei
   * kennt das Feld nicht und darf nicht mit leerem Modell aufgehen.
   */
  const sichtbareGeschosse = useMemo(() => {
    const ids = new Set<string>();
    for (const l of Object.values(doc.levels)) {
      if (l.visible !== false || l.id === doc.activeLevelId) ids.add(l.id);
    }
    return ids;
  }, [doc.levels, doc.activeLevelId]);
  const imBild = useCallback((levelId: string) => sichtbareGeschosse.has(levelId), [sichtbareGeschosse]);

  const walls = useMemo(
    () => Object.values(doc.walls).filter((w) => imBild(w.levelId)),
    [doc.walls, imBild],
  );

  /*
   * Woran man beim Gehen anstößt.
   *
   * Nur das aktive Geschoss: Man steht in einer Etage, und die Wände des
   * Obergeschosses gehen einen dort nichts an. Türen und Durchgänge sind
   * Löcher darin — das rechnet `hindernisse` aus, nicht diese Datei.
   */
  /*
   * **Türen zählen nur, wenn sie offen sind.** Welche offen sind, steht in
   * `tuerStandRef` und ändert sich sechzigmal in der Sekunde — als
   * Abhängigkeit dieses `useMemo` wäre das ein Neuaufbau je Bild. Deshalb
   * wird hier nur das Gebäude vorbereitet; die Hindernisse selbst baut
   * `baueHindernisse` neu, wenn eine Tür ihren Zustand wechselt. Das ist
   * genau einmal je Tastendruck.
   */
  const gehHindernisse = useMemo(
    () => hindernisse(doc, doc.activeLevelId, new Set<string>()),
    [doc, doc.activeLevelId],
  );

  const openings = useMemo(
    () => Object.values(doc.openings).filter((o) => imBild(doc.walls[o.wallId]?.levelId ?? '')),
    [doc.openings, doc.walls, imBild],
  );
  const rooms = useMemo(
    () => Object.values(doc.rooms).filter((r) => imBild(r.levelId)),
    [doc.rooms, imBild],
  );
  /*
   * --- Ebenen wirken auch im Modell ---------------------------------------
   *
   * Im begangenen Haus ist das Ausblenden mehr wert als im Grundriss: Wer die
   * Leitungsführung beurteilt, will die Sanitärobjekte weg — und wer den
   * Heizkörper unter dem Fenster ansieht, will nicht durch die Lüftungsleitung
   * davor schauen. Bis 1.26.0 wirkte die Ebene nur im Plan; man blendete die
   * Lüftung aus, wechselte in die Ansicht und sah sie wieder.
   *
   * Gefiltert wird hier und nicht im Geometrieaufbau, damit auch die
   * Trefferprüfung mitzieht: Was nicht zu sehen ist, soll man nicht anfassen
   * können.
   */
  const ebenen = doc.layers;
  const fixtures = useMemo(
    () =>
      Object.values(doc.fixtures).filter(
        (f) => imBild(f.levelId) && ebenen[ebeneFuerObjekt(f)]?.visible !== false,
      ),
    [doc.fixtures, ebenen, imBild],
  );
  /*
   * Treppen und Schächte bleiben, sobald **eines** ihrer Geschosse zu sehen
   * ist — sie verbinden zwei und gehören keinem allein. Eine Treppe, die
   * verschwindet, weil das Geschoss darunter ausgeblendet ist, hinterlässt
   * im Bild ein Loch in der Decke ohne Erklärung.
   */
  const verticals = useMemo(
    () =>
      Object.values(doc.verticals ?? {}).filter(
        (v) => imBild(v.levelId) || (v.toLevelId !== undefined && imBild(v.toLevelId)),
      ),
    [doc.verticals, imBild],
  );
  const solids = useMemo(
    () => Object.values(doc.solids ?? {}).filter((b) => imBild(b.levelId)),
    [doc.solids, imBild],
  );
  const durchbrueche = useMemo(
    () =>
      ebenen[EBENE_DURCHBRUECHE]?.visible === false
        ? []
        : Object.values(doc.durchbrueche ?? {}).filter((d) => imBild(d.levelId)),
    [doc.durchbrueche, ebenen, imBild],
  );
  const roofOpenings = useMemo(
    () => Object.values(doc.roofOpenings ?? {}).filter((o) => o.levelId === doc.activeLevelId),
    [doc.roofOpenings, doc.activeLevelId],
  );
  const pipes = useMemo(
    () =>
      Object.values(doc.pipes ?? {}).filter(
        (r) => imBild(r.levelId) && ebenen[ebeneFuerMedium(r.service)]?.visible !== false,
      ),
    [doc.pipes, ebenen, imBild],
  );
  const accessories = useMemo(
    () =>
      Object.values(doc.pipeAccessories ?? {}).filter((a) => {
        if (!imBild(a.levelId)) return false;
        const lauf = a.runId ? doc.pipes[a.runId] : undefined;
        const ebene = lauf ? ebeneFuerMedium(lauf.service) : EBENE_HEIZUNG;
        return ebenen[ebene]?.visible !== false;
      }),
    [doc.pipeAccessories, doc.pipes, ebenen, imBild],
  );

  /**
   * Die Verlegekurven der Fußbodenheizung — je sichtbarem Geschoss.
   *
   * Sie hängen an der Ebene „Heizung": Wer das Gewerk ausblendet, blendet
   * auch den Estrichinhalt aus. Und sie werden nur für Geschosse gerechnet,
   * die im Bild sind — eine Schnecke je Geschoss ist ein paar hundert
   * Stützpunkte, und ausgeblendet will sie niemand bezahlen.
   */
  const fussbodenkurven = useMemo(() => {
    if (ebenen[EBENE_HEIZUNG]?.visible === false) return [];
    return Object.values(doc.levels)
      .filter((l) => imBild(l.id))
      .map((l) => ({ levelId: l.id, linien: verlegelinien(sammleVerlegekurven(doc, l.id)) }))
      .filter((e) => e.linien.length > 0);
  }, [doc, ebenen, imBild]);

  /** Die Formteile der Rose — sie ändern sich nur mit der Nordabweichung. */
  const kompassTeile = useMemo(() => kompassRose(doc.meta.northAngle), [doc.meta.northAngle]);

  /**
   * Höhenlage je Geschoss — gerechnet im Kern, damit sie prüfbar bleibt.
   */
  const geschossHoehen = useMemo(() => levelBaseHeights(Object.values(doc.levels)), [doc.levels]);

  /**
   * Die Griffe des ausgewählten Bauteils — als Beschreibung, nicht als Netz.
   *
   * Sie entstehen aus `griffeFuer` und damit aus derselben Quelle, die auch
   * der Prüfblock befragt. Der Betrachter zeichnet sie nur; welche es gibt
   * und wie weit sie gehen dürfen, entscheidet der Rechenkern.
   */
  const griffe = useMemo(
    () => griffeFuer(doc, selections.length === 1 ? selections[0] : null),
    [doc, selections],
  );


  /**
   * Deckenplatten zwischen den Geschossen.
   *
   * Gerechnet im Kern (`slabGeometry`), damit der Prüfblock sie sieht. Ohne
   * sie klaffte über jeder Wandoberkante die Deckenstärke als Luft.
   */
  const geschossDecken = useMemo(() => {
    const eingabe = {
      // Nur die gezeigten Geschosse: Eine Decke über einem ausgeblendeten
      // Geschoss schwebte sonst allein im Raum.
      levels: Object.values(doc.levels).filter((l) => imBild(l.id)),
      rooms,
      walls,
      nodes: doc.nodes,
      verticals,
      durchbrueche,
      base: geschossHoehen,
    };
    // Decken zwischen den Geschossen und die Bodenplatte darunter. Beides sind
    // Platten und werden gleich gezeichnet; getrennt gerechnet werden sie,
    // weil eine Bodenplatte keine Geschossdecke ist — sie liegt unter ihrem
    // Geschoss und bekommt keine Aussparungen.
    const boden = groundSlab(eingabe);
    return boden ? [boden, ...levelSlabs(eingabe)] : levelSlabs(eingabe);
  }, [doc.levels, doc.nodes, rooms, walls, verticals, durchbrueche, geschossHoehen, imBild]);

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
    schattenRef.current = ground;

    const grid = new THREE.GridHelper(120, 120, 0x1e2a3f, 0x141d2e);
    grid.position.y = -0.004;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.5;
    scene.add(grid);
    rasterRef.current = grid;

    const content = new THREE.Group();
    scene.add(content);
    contentRef.current = content;

    /*
     * Eine eigene Gruppe für alles, was man anfassen kann.
     *
     * Zwei Gründe: Der Strahl beim Anklicken prüft nur diese Gruppe und nicht
     * das ganze Haus — und beim Umsetzen eines Heizkörpers muss nur sie neu
     * gebaut werden, nicht Wände, Decken, Dach und Rohre. Ohne diese Trennung
     * wäre Ziehen im Raum eine Diashow.
     */
    const tga = new THREE.Group();
    tga.name = 'tga';
    content.add(tga);
    tgaGruppeRef.current = tga;

    /*
     * Die Führung — das Band auf der Wand und der Griff am Objekt.
     *
     * Sie hängt an der Szene und **nicht** am Inhalt: Der Inhalt wird bei
     * jeder Geometrieänderung geleert, die Führung soll aber stehen bleiben,
     * solange etwas ausgewählt ist. Außerdem darf sie nie einen Strahl
     * abfangen — sonst fasste man beim Zielen auf den Heizkörper das Band an,
     * das gerade zeigt, wohin er kann.
     */
    const fuehrung = new THREE.Group();
    fuehrung.name = 'fuehrung';
    fuehrung.raycast = () => {};
    scene.add(fuehrung);
    fuehrungRef.current = fuehrung;

    const griffe = new THREE.Group();
    griffe.name = 'griffe';
    scene.add(griffe);
    griffGruppeRef.current = griffe;

    const oeffnungen = new THREE.Group();
    oeffnungen.name = 'oeffnungsfang';
    scene.add(oeffnungen);
    oeffnungsGruppeRef.current = oeffnungen;

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
      // `rohr` und `belag` sind Sammlungen von Werkstoffen, keine einzelnen —
      // sie werden eine Ebene tiefer freigegeben.
      if (mats) {
        for (const m of Object.values(mats)) {
          if (m instanceof THREE.Material) m.dispose();
          else for (const einzeln of Object.values(m)) einzeln.dispose();
        }
      }
      rendererRef.current = null;
      sceneRef.current = null;
      contentRef.current = null;
      fuehrungRef.current = null;
      griffGruppeRef.current = null;
      oeffnungsGruppeRef.current = null;
      controlsRef.current = null;
      materialsRef.current = null;
    };
  }, []);

  // ------------------------------------------------- Geometrie neu aufbauen
  useEffect(() => {
    const content = contentRef.current;
    const materials = materialsRef.current;
    if (!content || !materials) return;

    /*
     * Alten Inhalt sauber freigeben — sonst wächst der GPU-Speicher monoton.
     *
     * **Auch die Materialien, und auch in Gruppen.** Bisher wurde nur die
     * Geometrie der obersten Ebene freigegeben. Zwei Stellen erzeugen aber
     * bei *jedem* Aufbau neue Materialien: die Rohre (eine Farbe je Gewerk)
     * und das Gelände (zehn Stück, siehe `buildSite`). Die blieben liegen.
     * Bei einem Grundriss, an dem eine Stunde gezeichnet wird, sind das
     * schnell mehrere hundert — jedes mit eigenem Shaderprogramm.
     *
     * Die gemeinsamen Materialien aus `createMaterials()` dürfen **nicht**
     * mit weg: Sie werden über die ganze Lebensdauer des Viewers benutzt und
     * erst beim Abbau freigegeben. Unterschieden wird an der Kennung, die
     * `createMaterials` vergibt.
     */
    /*
     * **Auch die Werkstoffe in den Sammlungen sind gemeinsam.**
     *
     * `materials.rohr` und `materials.belag` sind seit 1.26.0 keine
     * einzelnen Werkstoffe, sondern Verzeichnisse — eines je Leitungsart,
     * eines je Belagsfarbe. Ein flaches `Object.values` findet darin die
     * Verzeichnisse selbst und nicht ihren Inhalt; die Werkstoffe fielen
     * damit *nicht* in die Schonliste und wurden bei jedem Neuaufbau
     * freigegeben, obwohl sie beim nächsten wieder benutzt werden. Das
     * Ergebnis ist kein sichtbarer Fehler — Three baut ein freigegebenes
     * Shaderprogramm stillschweigend neu — sondern genau das, was hier
     * eigentlich verhindert werden sollte.
     */
    const gemeinsame = new Set<THREE.Material>();
    for (const wert of Object.values(materials as unknown as Record<string, unknown>)) {
      if (wert instanceof THREE.Material) gemeinsame.add(wert);
      else if (wert && typeof wert === 'object') {
        for (const einzeln of Object.values(wert as Record<string, unknown>)) {
          if (einzeln instanceof THREE.Material) gemeinsame.add(einzeln);
        }
      }
    }
    const freigeben = (o: THREE.Object3D): void => {
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose();
      const mat = (mesh as { material?: THREE.Material | THREE.Material[] }).material;
      for (const m of Array.isArray(mat) ? mat : mat ? [mat] : []) {
        if (!gemeinsame.has(m)) m.dispose();
      }
      for (const kind of o.children) freigeben(kind);
    };
    for (const child of [...content.children]) {
      content.remove(child);
      freigeben(child);
    }
    // Die Gruppe für die anfassbaren Objekte wird beim Freigeben mit
    // entfernt und hier wieder eingehängt.
    const tgaGruppe = new THREE.Group();
    tgaGruppe.name = 'tga';
    content.add(tgaGruppe);
    tgaGruppeRef.current = tgaGruppe;

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
      durchbrueche,
      slabs: geschossDecken,
      pipes,
      fussbodenkurven,
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
    for (const boden of built.coveredFloors) {
      const mesh = new THREE.Mesh(boden.geometry, materials.belag[boden.colour] ?? materials.floor);
      mesh.receiveShadow = true;
      content.add(mesh);
    }
    addMesh(built.roof, materials.roof, { cast: true, receive: true });
    addMesh(built.stairs, materials.stair, { cast: true, receive: true });
    addMesh(built.shafts, materials.shaft, { cast: true, receive: true });
    addMesh(built.solids, materials.masonry, { cast: true, receive: true });
    addMesh(built.slabs, materials.slab, { cast: true, receive: true });
    /*
     * Die Fußbodenheizung liegt im Estrich und wirft keinen Schatten — sie
     * ist im Modell eine Auskunft über die Verlegung, kein Bauteil, das den
     * Raum verdunkelt. Die Anbindeleitung wird durchscheinend gezeichnet,
     * weil sie die kürzeste Verbindung zeigt und nicht die verlegte Trasse.
     */
    if (built.floorPipes) {
      const mesh = new THREE.Mesh(
        built.floorPipes,
        materials.rohr[PIPE_SERVICE_COLORS['heating-flow']] ?? materials.heating,
      );
      mesh.userData = { art: 'fbh' };
      content.add(mesh);
    }
    if (built.floorSupply) {
      const mesh = new THREE.Mesh(built.floorSupply, materials.fbhAnbindung);
      mesh.userData = { art: 'fbh-anbindung' };
      content.add(mesh);
    }
    for (const pipe of built.pipes) {
      const werkstoff = materials.rohr[pipe.colour] ?? materials.heating;
      const mesh = new THREE.Mesh(pipe.geometry, werkstoff);
      mesh.castShadow = true;
      // Das Grundmaterial wandert mit, damit der Auswahleffekt es
      // zurücklegen kann, ohne es neu zu bauen.
      mesh.userData = { art: 'pipe', id: pipe.runId, grund: werkstoff };
      content.add(mesh);
    }
    for (const armatur of built.accessories) {
      const mesh = new THREE.Mesh(armatur.geometry, materials.heating);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData = { art: 'accessory', id: armatur.id, grund: materials.heating };
      content.add(mesh);
    }
    addMesh(built.frames, materials.frame, { cast: true, receive: true });
    /*
     * Türblätter — je Flügel ein eigener Körper.
     *
     * Der Öffnungswinkel wird **nicht** hier gesetzt, sondern in einem
     * eigenen Effekt weiter unten. Dieser hier läuft nur, wenn sich das
     * Gebäude ändert; eine Tür geht aber auf, ohne dass sich ein Bauteil
     * ändert. Stünde der Winkel hier, würde für jede geöffnete Tür das ganze
     * Haus neu gebaut.
     */
    tuerBlaetterRef.current = [];
    for (const blatt of built.doors) {
      const mesh = new THREE.Mesh(blatt.geometry, materials.door);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData = { art: 'door', id: blatt.openingId };
      if (blatt.sliding) {
        content.add(mesh);
        tuerBlaetterRef.current.push({ id: blatt.openingId, mesh, gruppe: null, sign: 0 });
        continue;
      }
      // Die Gruppe sitzt auf der Bandachse und trägt die Wanddrehung; das
      // Blatt hängt darin und dreht sich um die Hochachse dieser Gruppe.
      const band = new THREE.Group();
      band.position.set(blatt.hinge.x, blatt.hinge.y, blatt.hinge.z);
      band.rotation.y = blatt.wallAngle;
      const dreh = new THREE.Group();
      dreh.add(mesh);
      band.add(dreh);
      content.add(band);
      tuerBlaetterRef.current.push({ id: blatt.openingId, mesh, gruppe: dreh, sign: blatt.sign });
    }
    // Die Armaturen liegen weiter im Gewerkeklumpen: Es sind viele, sie sind
    // klein, und niemand fasst ein einzelnes Eckventil im Raum an.
    addMesh(built.heating, materials.heating, { cast: true, receive: true });
    addMesh(built.sanitary, materials.sanitary, { cast: true, receive: true });
    addMesh(built.ventilation, materials.ventilation, { cast: true, receive: true });

    // Die TGA-Objekte füllt der eigene Effekt weiter unten — hier steht nur
    // die leere Gruppe, damit sie in der richtigen Reihenfolge hängt.
    addMesh(built.glass, materials.glass, { cast: false, receive: false });

    // Das Gelände hängt in derselben Gruppe wie das Gebäude und wird beim
    // nächsten Neuaufbau mit ihr freigegeben.
    if (showSite) {
      const siteGroup = buildSite(site, doc.meta.terrainElevation ?? 0);
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
    // Die Ausdehnung merken: „Einpassen" baute bisher das **ganze Modell ein
    // zweites Mal** auf, nur um sie zu erfahren — und ließ dabei einen Teil
    // der erzeugten Geometrien liegen. Sie steht hier ohnehin schon.
    boundsRef.current = built.bounds.clone();

    if (!fittedRef.current && walls.length > 2) {
      fitToBounds(built.bounds);
      fittedRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    /*
     * `fixtures` steht hier bewusst **nicht** mehr.
     *
     * Seit die TGA-Objekte eine eigene Gruppe mit eigenem Takt haben, benutzt
     * `buildGeometry` sie gar nicht — der Eintrag war eine Altlast. Er hat
     * aber gewirkt: `cloneDoc` legt bei jeder Änderung ein neues
     * `fixtures`-Objekt an, und so wurde beim Ziehen eines Heizkörpers
     * fünfzigmal je Sekunde das **ganze Haus** neu gebaut — Wände, Decken,
     * Dach, Rohre. Das war der zweite Grund, warum sich in 3D nichts zu
     * bewegen schien: es bewegte sich, nur bei drei Bildern je Sekunde.
     */
    /*
     * Der Zähler koppelt den Füll-Effekt an diesen hier.
     *
     * Dieser Effekt hängt die Gruppe für die anfassbaren Objekte **leer**
     * wieder ein; gefüllt wird sie vom Effekt darunter, und der hat eine
     * andere Abhängigkeitsliste. Läuft dieser hier ohne jenen — etwa weil
     * sich nur das Gelände geändert hat —, stünde das Haus ohne Heizkörper
     * da. Dass das bisher nie passiert ist, lag allein daran, dass
     * `doc.nodes` bei jeder Änderung eine neue Kennung bekam; seit die
     * Sammlungen ihre Kennung behalten, wenn sich nichts geändert hat, ist
     * genau diese Zufälligkeit weg.
     */
    /*
     * Diagnosehaken für die Rauchtests (siehe `main.tsx`).
     *
     * Er zählt, wie viele Eckpunkte je Bauteilart wirklich in der Szene
     * stehen. Ein Bild beweist nicht, dass ein Rohr gebaut wurde — eine Null
     * an dieser Stelle beweist, dass keines gebaut wurde.
     */
    window.__raviaSzene = () => {
      const zahlen: Record<string, number> = {};
      content.traverse((o) => {
        const art = (o.userData as { art?: string } | undefined)?.art;
        const geom = (o as THREE.Mesh).geometry;
        if (!art || !geom?.attributes?.position) return;
        zahlen[art] = (zahlen[art] ?? 0) + geom.attributes.position.count;
      });
      return zahlen;
    };

    setNeuaufbau((n) => n + 1);
  }, [walls, openings, rooms, verticals, solids, durchbrueche, pipes, fussbodenkurven, roofOpenings, doc.nodes, doc.levels, doc.activeLevelId, site, showSite, doc.meta.terrainElevation]);

  // Boden und Raster auf die Geländeoberkante legen — siehe `schattenRef`.
  useEffect(() => {
    const gok = doc.meta.terrainElevation ?? 0;
    if (schattenRef.current) schattenRef.current.position.y = gok - 0.002;
    if (rasterRef.current) rasterRef.current.position.y = gok - 0.004;
  }, [doc.meta.terrainElevation]);

  /*
   * Die anfassbaren Objekte — eigener Aufbau, eigener Takt.
   *
   * Dieser Effekt hängt nur an `fixtures` (und an dem, was ihre Höhenlage
   * bestimmt). Beim Ziehen eines Heizkörpers entstehen dadurch ein paar
   * Dutzend Quader neu statt des ganzen Hauses — der Unterschied zwischen
   * „klebt an der Hand" und „hinkt hinterher".
   *
   * Die Geometrien werden hier freigegeben, die Materialien nicht: Die sind
   * gemeinsam und gehören dem Viewer, nicht diesem Effekt.
   */
  useEffect(() => {
    const gruppe = tgaGruppeRef.current;
    const materials = materialsRef.current;
    if (!gruppe || !materials) return;

    for (const kind of [...gruppe.children]) {
      gruppe.remove(kind);
      (kind as THREE.Mesh).geometry?.dispose();
    }

    const roofOutline: Vec2[] = [];
    for (const w of walls) {
      const na = doc.nodes[w.a];
      const nb = doc.nodes[w.b];
      if (na) roofOutline.push({ x: na.x, y: na.y });
      if (nb) roofOutline.push({ x: nb.x, y: nb.y });
    }
    const aktivesDach = doc.levels[doc.activeLevelId]?.roof;
    const roofFrame = buildRoofFrame(
      aktivesDach,
      roofOutline,
      roofOpenings,
      aktivesDach && aktivesDach.kind !== 'flat' ? gebaeudeUmriss(walls, doc.nodes) : [],
    );

    for (const k of baueTgaKoerper(fixtures, roofFrame, geschossHoehen, doc.activeLevelId)) {
      const mesh = new THREE.Mesh(
        k.geometry,
        k.category === 'heating'
          ? materials.heating
          : k.category === 'sanitary'
            ? materials.sanitary
            : materials.ventilation,
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData = { art: 'fixture', id: k.id };
      gruppe.add(mesh);
    }
    // Die Farbgebung (gefasst/berührt) setzt der Effekt darunter — er läuft
    // nach diesem, weil er dieselbe Gruppe liest.
    setAufbauZaehler((n) => n + 1);
    // `neuaufbau` steht hier, weil der Effekt über diesem die Gruppe leer neu
    // einhängt — ohne diese Abhängigkeit bliebe sie leer.
  }, [fixtures, geschossHoehen, roofOpenings, walls, doc.nodes, doc.levels, doc.activeLevelId, neuaufbau]);

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
      case 'walk': {
        /*
         * Der Einstieg ins Gebäude.
         *
         * Gestartet wird dort, wo die Kamera bisher hingeschaut hat — nicht
         * im Nullpunkt. Wer sich ein Zimmer angesehen hat und auf „Begehen"
         * tippt, will in diesem Zimmer stehen und nicht draußen vor der Tür.
         * Die Blickrichtung wird ebenfalls übernommen, damit das Bild nicht
         * springt; der Nickwinkel geht auf waagerecht, denn ein Mensch
         * schaut geradeaus.
         */
        const richtung = new THREE.Vector3();
        perspective.getWorldDirection(richtung);
        // Szene → Modell: x bleibt x, Modell-y ist −Szene-z.
        geherRef.current.x = target.x;
        geherRef.current.y = -target.z;
        geherRef.current.gier = Math.atan2(-richtung.z, richtung.x);
        geherRef.current.nick = 0;
        controls.enabled = false;
        aktiveKameraRef.current = perspective;
        // Diagnosehaken (siehe main.tsx): der Standort ist ein Ref und kein
        // Zustand — ohne diesen Zeiger wäre er im Rauchtest nicht messbar.
        window.__raviaGeher = geherRef.current;
        break;
      }
      default:
        controls.enabled = true;
        controls.object = perspective;
        aktiveKameraRef.current = perspective;
        window.__raviaGeher = undefined;
    }
    if (cameraMode !== 'walk') {
      aktiveKameraRef.current = controls.object as THREE.Camera;
      controls.update();
    }
  }, [cameraMode]);

  // ------------------------------------------- Anfassen und Setzen im Raum
  /*
   * Der Strahl.
   *
   * **Was hier passiert und was bewusst nicht.** Geprüft wird zuerst die
   * Gruppe der anfassbaren Objekte — sie ist kurz, und ein getroffenes Objekt
   * bringt seine Kennung selbst mit. Erst wenn dort nichts liegt, wird gegen
   * das ganze Haus geprüft, und aus dem **Trefferpunkt** wird wieder ein
   * Bauteil (`deuteTreffer`). Das ist die Umkehrung des Verschmelzens: Die
   * Anzeige bleibt schnell, und die Zuordnung kostet eine Rechnung je Klick
   * statt Zeichenaufrufe je Bild.
   */
  const strahlRef = useRef(new THREE.Raycaster());

  const treffePunkt = useCallback(
    (klient: { x: number; y: number }): {
      fixtureId?: string;
      openingId?: string;
      /** Getroffene Rohrleitung — der Körper trägt seine Kennung selbst. */
      pipeId?: string;
      /** Getroffene Armatur am Rohrnetz. */
      accessoryId?: string;
      punkt?: Vec2;
      szene?: THREE.Vector3;
    } | null => {
      const renderer = rendererRef.current;
      const kamera = aktiveKameraRef.current;
      const content = contentRef.current;
      const tgaGruppe = tgaGruppeRef.current;
      if (!renderer || !kamera || !content) return null;

      const r = renderer.domElement.getBoundingClientRect();
      const zeiger = new THREE.Vector2(
        ((klient.x - r.left) / r.width) * 2 - 1,
        -((klient.y - r.top) / r.height) * 2 + 1,
      );
      const strahl = strahlRef.current;
      strahl.setFromCamera(zeiger, kamera);

      const tgaTreffer = tgaGruppe ? strahl.intersectObjects(tgaGruppe.children, false) : [];
      const oeffnungsGruppe = oeffnungsGruppeRef.current;
      const oeffnungsTreffer = oeffnungsGruppe
        ? strahl.intersectObjects(oeffnungsGruppe.children, false)
        : [];
      const haus = strahl.intersectObject(content, true);

      /*
       * **Was näher liegt, gewinnt — und zwar auch gegen ein TGA-Objekt.**
       *
       * Bis 1.22.0 hatte die Gruppe der anfassbaren Objekte unbedingten
       * Vorrang: Traf der Strahl irgendwo auf ihrem Weg einen Heizkörper,
       * war er getroffen, ganz gleich, wie viele Wände davor standen. In der
       * Umlaufansicht fiel das nie auf — dort schaut man von außen auf ein
       * Modell, und was man sieht, liegt vorn.
       *
       * Im begangenen Haus ist es ein Fehler mit Folgen. Man steht im
       * Wohnzimmer, zielt auf die Wand, und die Fahne hängt am Heizkörper im
       * Schlafzimmer dahinter — sichtbar ist er nicht, gemeint war er nicht,
       * und im Plan steht danach eine Beschriftung an einem Bauteil, das
       * niemand angeschaut hat. Seit dieser Fassung entscheidet die
       * Entfernung.
       *
       * Die zwei Millimeter Nachsicht sind kein Rundungsspiel: Ein
       * wandgebundener Heizkörper steht mit der Rückseite *in* der Wand, und
       * seine Vorderseite kann bei dünnem Bauteil rechnerisch mit der
       * Wandfläche zusammenfallen. Ohne die Nachsicht gewänne dann die Wand,
       * und der Heizkörper wäre nicht mehr anzufassen.
       */
      if (tgaTreffer.length > 0) {
        const o = tgaTreffer[0];
        const naeher = haus.length === 0 || o.distance <= haus[0].distance + 0.002;
        if (naeher) {
          return {
            fixtureId: (o.object.userData as { id?: string }).id,
            punkt: szeneZuModell(o.point),
            szene: o.point.clone(),
          };
        }
      }
      /*
       * Die Öffnung gewinnt nur, wenn sie **näher** liegt als die Wand.
       *
       * Ihr Fangkörper füllt das Loch; wer daneben auf die Wand zeigt, trifft
       * die Wand, und das soll auch so bleiben. Ohne den Entfernungsvergleich
       * fasste man durch eine Fensteröffnung hindurch das Fenster der
       * gegenüberliegenden Fassade an — derselbe Fehler, der bei den
       * TGA-Objekten schon einmal behoben werden musste.
       */
      if (oeffnungsTreffer.length > 0) {
        const o = oeffnungsTreffer[0];
        if (haus.length === 0 || o.distance <= haus[0].distance + 0.002) {
          return {
            openingId: (o.object.userData as { openingId?: string }).openingId,
            punkt: szeneZuModell(o.point),
            szene: o.point.clone(),
          };
        }
      }
      if (haus.length === 0) return null;
      /*
       * Rohr und Armatur bringen ihre Kennung am Körper mit.
       *
       * Sie hängen in derselben Gruppe wie das Haus und werden deshalb erst
       * hier erkannt — was näher liegt, hat schon gewonnen. Wer im Modell
       * auf eine Leitung zeigt, meint die Leitung und nicht die Wand
       * dahinter; und wer sie anfassen kann, kann sie auch entfernen.
       */
      const daten = haus[0].object.userData as { art?: string; id?: string };
      if (daten.art === 'pipe' && daten.id) {
        return { pipeId: daten.id, punkt: szeneZuModell(haus[0].point), szene: haus[0].point.clone() };
      }
      if (daten.art === 'accessory' && daten.id) {
        return { accessoryId: daten.id, punkt: szeneZuModell(haus[0].point), szene: haus[0].point.clone() };
      }
      return { punkt: szeneZuModell(haus[0].point), szene: haus[0].point.clone() };
    },
    [],
  );

  /*
   * --- Zielen im Haus -----------------------------------------------------
   *
   * Der Strahl geht durch die **Bildmitte**, nicht durch den Finger. Das ist
   * der ganze Unterschied zwischen der Bedienung draußen und der im Haus:
   * Draußen zeigt man auf ein Modell, das vor einem liegt; drinnen steht man
   * mittendrin und dreht sich. Ein Fingertipp auf die Leinwand ist im
   * Begehmodus die Drehgeste — er kann nicht zugleich setzen, ohne dass
   * beides unzuverlässig wird.
   */
  const zielpunkt = useCallback((): Zieltreffer | null => {
    const renderer = rendererRef.current;
    const kamera = perspectiveRef.current;
    if (!renderer || !kamera) return null;
    const r = renderer.domElement.getBoundingClientRect();
    const roh = treffePunkt({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
    if (!roh?.punkt || !roh.szene) return null;
    const s2 = useBimStore.getState();
    const basis = geschossHoehenRef.current.get(s2.doc.activeLevelId) ?? 0;
    return deuteZiel(s2.doc, s2.doc.activeLevelId, {
      punkt: roh.punkt,
      // Höhe über **Fertigfußboden des aktiven Geschosses**, nicht über dem
      // Szenennullpunkt. Im Obergeschoss wären das sonst 3,20 m für einen
      // Heizkörper, der 15 cm über dem Boden hängt.
      hoehe: roh.szene.y - basis,
      entfernung: kamera.position.distanceTo(roh.szene),
      fixtureId: roh.fixtureId,
      // Die Öffnung kommt aus dem Strahl, nicht aus der Deutung im
      // Grundriss: Der kennt nur die Wand, in der sie sitzt. Im Raum stehend
      // ist aber die Öffnung das Bauteil, das man meint.
      openingId: roh.openingId,
    });
  }, [treffePunkt]);

  /*
   * Die Zeile am Fadenkreuz — in ruhigem Takt, nicht je Bild.
   *
   * **Warum ein Takt und keine Kopplung an die Bildschleife.** Der
   * Zielstrahl kostet eine Schnittrechnung gegen das ganze Haus. Je Bild
   * gerechnet, sind das sechzig davon in der Sekunde, und jede schriebe in
   * den React-Zustand — die Oberfläche baute sich sechzigmal neu auf, und das
   * Tablet würde dabei warm, ohne dass irgendjemand etwas davon hätte.
   * Achtmal in der Sekunde ist schneller, als ein Mensch die Zeile lesen
   * kann, und kostet ein Achtel Prozent.
   *
   * Gezielt wird nur, solange ein Werkzeug in der Hand liegt. Wer nur durch
   * das Haus geht, soll dafür nichts bezahlen.
   */
  useEffect(() => {
    if (cameraMode !== 'walk' || !werkzeug) {
      setZiel(null);
      return;
    }
    const takt = window.setInterval(() => setZiel(zielpunkt()), 125);
    setZiel(zielpunkt());
    return () => window.clearInterval(takt);
  }, [cameraMode, werkzeug, zielpunkt]);

  /*
   * Ein Werkzeug aus der Hand legen, wenn die Ansicht wechselt.
   *
   * Sonst käme man aus dem Haus heraus, ginge später wieder hinein und hätte
   * unbemerkt noch den Durchbruch in der Hand — der nächste Knopfdruck säße
   * dann irgendwo.
   */
  useEffect(() => {
    if (cameraMode !== 'walk') {
      setWerkzeug(null);
      setRohrAnfang(null);
      setVorschlaege(null);
      setKisteOffen(false);
    }
  }, [cameraMode]);

  /*
   * --- Auslösen -----------------------------------------------------------
   *
   * Ein Knopf, ein Bauteil. Alles läuft über dieselben Speicheraktionen wie
   * im Grundriss (`addFixture`, `addPipe`, `addDurchbruch`, `setzeArmatur`) —
   * damit gelten dort auch dieselben Regeln, und es kann nicht passieren,
   * dass ein im Haus gesetzter Heizkörper anderen Gesetzen folgt als ein im
   * Plan gesetzter.
   *
   * Jedes Setzen ist **ein** Schritt in der Historie: `beginGesture` /
   * `endGesture` klammern auch die Fälle, die aus zwei Speicheraktionen
   * bestehen (anlegen, dann an die Wand rücken). Ohne die Klammer bräuchte
   * es zwei Rückgängig für einen Heizkörper, und das eine davon ließe ihn an
   * der falschen Stelle stehen.
   */
  const ausloesen = useCallback((): void => {
    if (!werkzeug) return;
    const z = zielpunkt();
    const urteil = darfSetzen(werkzeug, z, rohrAnfang ?? undefined);
    const s2 = useBimStore.getState();
    if (!urteil.moeglich || !z) {
      s2.setStatus(urteil.text);
      return;
    }

    switch (werkzeug.art) {
      case 'objekt': {
        if (!werkzeug.fixture) return;
        const def = FIXTURE_BY_TYPE[werkzeug.fixture];
        s2.beginGesture();
        /*
         * **Die Montagehöhe kommt aus der Bibliothek, nicht vom Zielpunkt.**
         *
         * Beim Durchbruch und beim Rohr ist die abgelesene Höhe die
         * eigentliche Auskunft — man zeigt auf die Stelle, an der gebohrt
         * oder verlegt wird. Beim Heizkörper ist sie eine Falle: Wer im Raum
         * steht und die Wand unter dem Fenster anschaut, zielt aus
         * Augenhöhe, also auf 1,20 bis 1,50 m. Übernähme das Programm diese
         * Zahl, hinge jeder so gesetzte Heizkörper auf Brusthöhe — und zwar
         * mit einer Höhe, die *abgelesen* aussieht und deshalb niemandem
         * verdächtig vorkommt. Gemessen hatte man aber nur, wohin man
         * geschaut hat.
         *
         * Was der Strahl beim Heizkörper wirklich liefert, ist die **Stelle
         * an der Wand** — und die ist das, was im Raum stehend niemand aus
         * dem Grundriss ablesen kann. Die Höhe bleibt die Regelhöhe des
         * Bauteils und ist danach mit Umschalt + Ziehen in dieser Ansicht
         * oder im Inspektor zu ändern; im Altbau, wo Heizkörper höher
         * hängen, ist das ein Handgriff.
         */
        const zusatz =
          werkzeug.fixture === 'radiator'
            ? {
                params: { ...def.params, radiatorConnection: anschluss, ...(ventilSeite ? { valveSide: ventilSeite } : {}) },
              }
            : undefined;
        const neu = s2.addFixture(werkzeug.fixture, z.punkt, zusatz);
        if (!neu) {
          s2.endGesture();
          return;
        }
        /*
         * Zweischritt wie im Grundriss: anlegen, dann einmal bewegen.
         *
         * Das Bewegen ist es, das ein wandgebundenes Objekt an seiner Wand
         * ausrichtet — `addFixture` allein legt es nur an die Stelle. Wer den
         * zweiten Schritt wegließe, bekäme einen Heizkörper, der schräg in
         * der Wand steckt, und würde den Fehler in der Drehung suchen.
         */
        s2.moveFixture(neu.id, z.punkt);
        s2.setSelection({ kind: 'fixture', id: neu.id });
        s2.endGesture();
        const nach = useBimStore.getState().doc.fixtures[neu.id];
        const anhang =
          werkzeug.fixture === 'radiator'
            ? ` · ${anschlussKurz(anschluss, ventilSeite)}`
            : '';
        s2.setStatus(
          `${def.label} gesetzt${anhang} — ${umsetzungsMeldung(
            def.label,
            nach ? wandfuehrung(useBimStore.getState().doc, nach) : null,
            nach?.elevation ?? 0,
          )}`,
        );
        return;
      }

      case 'rohr': {
        if (!rohrAnfang) {
          setRohrAnfang({ punkt: z.punkt, hoehe: z.hoehe });
          s2.setStatus(`Anfang auf ${hoehenText(z.hoehe)} — jetzt das Ende anzielen`);
          return;
        }
        const laenge = rohrLaenge(rohrAnfang.punkt, z.punkt);
        const versatz = z.hoehe - rohrAnfang.hoehe;
        /*
         * **Zu kurz ist nur, was in *keiner* Richtung Länge hat.**
         *
         * Der erste Entwurf verwarf jede Leitung unter 15 cm Trassenlänge.
         * Damit war ausgerechnet der Fall unmöglich, für den im Haus gezielt
         * wird: der **Fallstrang in der Zimmerecke**. Er steht im Grundriss
         * auf einem Punkt — Trassenlänge null — und ist trotzdem zweieinhalb
         * Meter Rohr. Geprüft wird deshalb die wahre Länge aus Trasse und
         * Höhenversatz; verworfen wird nur, was in beiden Richtungen nichts
         * ist, also der doppelte Knopfdruck ohne jede Bewegung.
         */
        const wahr = Math.hypot(laenge, versatz);
        if (wahr < 0.15) {
          s2.setStatus('Anfang und Ende liegen zu dicht beieinander — weiter drehen, gehen oder den Blick heben');
          return;
        }
        s2.beginGesture();
        const run = s2.addPipe(s2.pipeService, [rohrAnfang.punkt, z.punkt]);
        if (run) {
          /*
           * **Beide Höhen, nicht ihr Mittelwert.**
           *
           * Bis eben schrieb diese Stelle den Mittelwert aus beiden
           * Ablesungen in `elevation` — eine waagerechte Leitung auf halber
           * Höhe. Für die Aufputzleitung, die tatsächlich waagerecht läuft,
           * war das richtig; für den Strang war es die Lüge, die den
           * senkrechten Meter überhaupt erst verschwinden ließ.
           *
           * Ist der Versatz klein (unter 5 cm über die ganze Strecke), ist er
           * Zielgenauigkeit und kein Gefälle — dann bleibt es beim
           * Mittelwert und die Leitung ist waagerecht. Alles darüber ist
           * gewollt und wird als geneigter Abschnitt geführt.
           */
          if (Math.abs(versatz) < 0.05) {
            s2.updatePipe(run.id, { elevation: rohrHoehe(rohrAnfang.hoehe, z.hoehe) });
          } else {
            s2.updatePipe(run.id, { elevation: rohrAnfang.hoehe, elevationTo: z.hoehe });
          }
          s2.setSelection({ kind: 'pipe', id: run.id });
        }
        s2.endGesture();
        setRohrAnfang(null);
        const nachRun = run ? useBimStore.getState().doc.pipes[run.id] : undefined;
        if (nachRun) {
          s2.setStatus(
            rohrMeldung(
              PIPE_SERVICE_LABELS[nachRun.service],
              rohrlaenge(nachRun),
              nachRun.elevation,
              nachRun.elevationTo,
            ),
          );
        }
        return;
      }

      case 'armatur': {
        if (!werkzeug.armatur) return;
        s2.beginGesture();
        s2.setzeArmatur(werkzeug.armatur, z.punkt, Math.max(0, z.hoehe));
        s2.endGesture();
        return;
      }

      case 'durchbruch': {
        const preset = durchbruchPreset(werkzeug.preset);
        if (!preset || !z.wallId || z.wandAbstand === undefined) {
          s2.setStatus('Kein Regelmaß in der Hand — Durchbruch im Grundriss setzen');
          return;
        }
        const breite = preset.diameter ?? preset.width ?? 0.1;
        const randfehler = durchbruchAmRand(s2.doc, z.wallId, z.wandAbstand, breite);
        if (randfehler) {
          s2.setStatus(randfehler);
          return;
        }
        s2.beginGesture();
        const db = s2.addDurchbruch(preset, { wallId: z.wallId, distance: z.wandAbstand });
        if (db) {
          // Die Höhe kommt vom Zielpunkt: Man schaut die Stelle an, an der
          // gebohrt wird, und nicht auf ein Zahlenfeld. Umgerechnet wird von
          // der Mitte auf die Unterkante — siehe `sturzAusZiel`.
          s2.updateDurchbruch(db.id, { sillHeight: sturzAusZiel(z.hoehe, preset) });
        }
        s2.endGesture();
        const nach = db ? useBimStore.getState().doc.durchbrueche?.[db.id] : undefined;
        const wand = s2.doc.walls[z.wallId];
        const g = wand ? getWallGeometry(wand, s2.doc.nodes) : null;
        if (nach) s2.setStatus(durchbruchMeldung(nach, g?.length ?? 0));
        return;
      }

      case 'beschriftung': {
        if (!z.fixtureId) return;
        const liste = beschriftungsVorschlaege(s2.doc, { kind: 'fixture', id: z.fixtureId });
        if (!liste.length) {
          s2.setStatus('An diesem Bauteil steht nichts, was sich beschriften ließe');
          return;
        }
        setVorschlaege({ fixtureId: z.fixtureId, punkt: z.punkt, hoehe: z.hoehe, liste });
        return;
      }

      /*
       * **Ändern im Gehen: fassen, dann eintippen.**
       *
       * Der Auslöser wählt das Bauteil aus, auf das das Fadenkreuz zeigt —
       * dieselbe Auswahl wie im Grundriss, nur aus dem Raum heraus gefasst.
       * Danach erscheint die Maßleiste mit den Werten des Bauteils; jeder
       * ist antippbar und wird eingetippt.
       *
       * **Gezogen wird hier nicht.** Der Zug über das Bild dreht den Kopf,
       * und beides auf derselben Geste wäre unbedienbar. Das ist kein
       * Verlust: Wer mit dem Bandmaß vor dem Bauteil steht, hat eine Zahl
       * und keine Richtung.
       */
      case 'aendern': {
        const wahl = zielAuswahl(z);
        if (!wahl) {
          s2.setStatus('Nichts gefasst — auf Wand, Fenster, Tür oder Gerät zielen');
          return;
        }
        if (auswahlGesperrt(s2.doc, wahl)) {
          s2.setSelection(null);
          s2.setStatus('Gesperrt — im Reiter „Ebenen" freigeben');
          return;
        }
        s2.setSelection(wahl);
        const griffe = griffeFuer(s2.doc, wahl);
        s2.setStatus(
          griffe.length
            ? `Gefasst · ${griffe.map((g) => g.label).join(' · ')} — antippen und eintippen`
            : 'Gefasst — für dieses Bauteil gibt es hier kein Maß zum Ändern',
        );
        return;
      }

      default:
        return;
    }
  }, [werkzeug, zielpunkt, rohrAnfang, anschluss, ventilSeite]);

  /**
   * Einen ausgewählten Wert als Fahne setzen.
   *
   * Getrennt von `ausloesen`, weil dazwischen ein Mensch entscheidet: Der
   * Strahl sagt, *woran*; die Liste sagt, *was*. Zusammengelegt bräuchte es
   * eine Voreinstellung, welcher Wert gemeint ist — und die wäre in der
   * Hälfte der Fälle falsch.
   */
  const beschriften = useCallback(
    (vorschlag: Beschriftungsvorschlag): void => {
      if (!vorschlaege) return;
      const s2 = useBimStore.getState();
      s2.setzeBeschriftung3D(
        { kind: 'fixture', id: vorschlaege.fixtureId, quelle: vorschlag.quelle },
        vorschlaege.punkt,
        vorschlaege.hoehe,
        vorschlag.text,
      );
      setVorschlaege(null);
    },
    [vorschlaege],
  );

  /*
   * Anfassen, Setzen, Umsetzen.
   *
   * **Die Regel dahinter:** Die 3D-Ansicht ist eine zweite Art zu *zeigen*,
   * kein zweites Modell. Jede Änderung läuft über dieselben Speicheraktionen
   * wie im Grundriss — `addFixture`, `moveFixture`, `setSelection`. Damit
   * gelten dort auch dieselben Regeln (Wandbindung, Geschossgrenze,
   * Raumzuordnung), und es kann gar nicht erst passieren, dass Plan und Raum
   * verschiedene Wahrheiten zeigen.
   *
   * Im Begehmodus ist all das aus: Dort dreht der Zeiger den Blick.
   */
  const zieheRef = useRef<{
    id: string;
    hoehe: boolean;
    start: Vec2;
    startHoehe: number;
    /**
     * Ob die Geste im Speicher schon angemeldet ist.
     *
     * Angemeldet wird beim **ersten** Zwischenschritt und nicht beim
     * Aufsetzen: Wer nur antippt, um auszuwählen, soll keinen Schritt in der
     * Historie bekommen, den er nachher zurücknehmen muss.
     */
    angemeldet: boolean;
  } | null>(null);
  const [beruehrt, setBeruehrt] = useState<string | null>(null);
  /** Die Fahne am Zeiger beim Ziehen: Text und Bildschirmlage. */
  const [zugFahne, setZugFahne] = useState<{ x: number; y: number; text: string } | null>(null);

  /*
   * Die Höhenlage der Geschosse als Ref, nicht als Abhängigkeit.
   *
   * **Der Grund ist ein Fehler, der zwei Fassungen lang unbemerkt blieb.** Der
   * Zeigereffekt weiter unten hatte `geschossHoehen` im Abhängigkeitsfeld.
   * Diese Map entsteht aus `doc.levels`, und `cloneDoc` legt bei *jeder*
   * Änderung ein neues `levels`-Objekt an — also auch beim Verschieben eines
   * Heizkörpers. Der Effekt wurde dadurch mitten im Zug abgebaut und neu
   * aufgebaut, und seine Aufräumfunktion setzt `zieheRef` auf null: Der Zug
   * war nach **einem** Zwischenschritt zu Ende. Gemessen sah das so aus, als
   * bewege sich der Heizkörper acht Zentimeter und bleibe dann stehen — und
   * genau so wurde es auch gemeldet.
   *
   * Über einen Ref gelesen, ändert die Höhenlage die Lebensdauer des Effekts
   * nicht mehr.
   */
  const geschossHoehenRef = useRef(geschossHoehen);
  geschossHoehenRef.current = geschossHoehen;
  /** Zählt die Neuaufbauten der TGA-Gruppe — der Farb-Effekt hängt daran. */
  const [aufbauZaehler, setAufbauZaehler] = useState(0);

  /*
   * Diagnosehaken (wie `__ravia` und `__raviaGeher`, siehe main.tsx).
   *
   * Ohne ihn ließe sich „liegt der Heizkörper dort, wo ich hinzeige?" im
   * Rauchtest nur am Bild beurteilen — und ein Bild beweist nichts. Mit ihm
   * fragt der Test denselben Strahl, den auch der Klick benutzt.
   */
  useEffect(() => {
    window.__raviaTreffer = (x: number, y: number) => {
      const t = treffePunkt({ x, y });
      if (!t) return null;
      return {
        fixtureId: t.fixtureId,
        punkt: t.punkt,
        hoehe: t.szene ? Math.round(t.szene.y * 1000) / 1000 : undefined,
      };
    };
    return () => {
      window.__raviaTreffer = undefined;
    };
  }, [treffePunkt]);

  useEffect(() => {
    const renderer = rendererRef.current;
    const host = renderer?.domElement;
    if (!host || cameraMode === 'walk') return;

    const runter = (e: PointerEvent): void => {
      // Nur die linke Taste; rechts und Mitte gehören der Kamera.
      if (e.button !== 0) return;
      const s2 = useBimStore.getState();

      /*
       * **Der Griff hat Vorfahrt vor allem anderen.**
       *
       * Er liegt über dem Bild und ist absichtlich größer, als er im Modell
       * wäre. Prüfte man erst das Haus, läge unter jedem Griff eine Wand, und
       * der Klick wählte die Wand neu aus — die Auswahl spränge weg, und mit
       * ihr der Griff, den man gerade fassen wollte.
       */
      const griffTreffer = treffeGriff(e);
      if (griffTreffer) {
        const controls0 = controlsRef.current;
        if (controls0) controls0.enabled = false;
        const schirm = griffAufSchirm(griffTreffer);
        if (schirm) {
          griffZugRef.current = {
            griff: griffTreffer,
            ...schirm,
            start: { x: e.clientX, y: e.clientY },
            angemeldet: false,
            bewegt: false,
          };
          host.setPointerCapture?.(e.pointerId);
        } else {
          /*
           * Die Achse zeigt auf den Betrachter zu — ziehen ginge nicht
           * sinnvoll. Statt nichts zu tun, wird gleich das Feld geöffnet:
           * Das Maß lässt sich immer eintippen, und das ist ohnehin der
           * genauere Weg.
           */
          setTippGriff(griffTreffer);
          setTippWert(griffTreffer.wert.toFixed(3).replace('.', ','));
          s2.setStatus(`${griffTreffer.label} — die Achse zeigt zum Betrachter, bitte eintippen`);
        }
        return;
      }

      const treffer = treffePunkt(e);
      if (!treffer) {
        s2.setSelection(null);
        return;
      }

      /*
       * Die Kamera muss stillhalten, solange etwas anderes passiert.
       *
       * OrbitControls dreht auf derselben linken Taste, mit der hier gefasst
       * und gesetzt wird. Ohne diese Sperre zöge man den Heizkörper an die
       * Wand **und** drehte dabei das Haus — man sieht dann weder, was man
       * tut, noch wo es landet. Gesperrt wird nur so lange, wie die Taste
       * unten ist; wer ins Leere greift, dreht wie bisher.
       */
      const controls = controlsRef.current;
      if (controls && (treffer.fixtureId || s2.tool === 'fixture')) {
        controls.enabled = false;
      }

      // 1) Ein bestehendes Objekt getroffen → fassen und zum Ziehen bereit.
      if (treffer.fixtureId) {
        const f = s2.doc.fixtures[treffer.fixtureId];
        s2.setSelection({ kind: 'fixture', id: treffer.fixtureId });
        /*
         * Sofort hervorheben, nicht erst beim Darüberfahren.
         *
         * Mit der Maus gibt es ein Darüberfahren, mit dem Finger nicht. Auf
         * dem Tablet war deshalb **nie** etwas hervorgehoben, und man sah an
         * keiner Stelle, dass man gerade etwas in der Hand hat.
         */
        setBeruehrt(treffer.fixtureId);
        if (f) {
          zieheRef.current = {
            id: treffer.fixtureId,
            // Umschalt hebt und senkt, statt zu verschieben — „aufhängen"
            // heißt schließlich: auf eine Höhe bringen.
            hoehe: e.shiftKey,
            start: treffer.punkt ?? f.position,
            startHoehe: f.elevation,
            angemeldet: false,
          };
          host.setPointerCapture?.(e.pointerId);
        }
        return;
      }

      /*
       * 1b) Eine Öffnung getroffen — Fenster, Tür oder Durchgang.
       *
       * Sie wird ausgewählt, nicht gezogen: Ihre Lage in der Wand ändert der
       * Lagegriff, und der ist genauer als jeder Zug über die Leinwand. Ein
       * Fenster mit dem Finger zu verschieben klingt naheliegend und trifft
       * im Bestand nie den Zentimeter, um den es geht.
       */
      if (treffer.openingId) {
        if (controls) controls.enabled = true;
        s2.setSelection({ kind: 'opening', id: treffer.openingId });
        const op = s2.doc.openings[treffer.openingId];
        if (op) {
          s2.setStatus(
            `${OPENING_LABELS[op.kind] ?? 'Öffnung'} · ${(op.width * 100).toFixed(0)} × ${(op.height * 100).toFixed(0)} cm` +
              ` — Maß am Griff ändern oder antippen und eintippen`,
          );
        }
        return;
      }

      if (!treffer.punkt) return;

      // 2) Mit dem TGA-Werkzeug entsteht an dieser Stelle ein neues Objekt.
      if (s2.tool === 'fixture') {
        const neu = s2.addFixture(s2.activeFixture, treffer.punkt);
        if (neu) {
          // Zweischritt wie im Grundriss: anlegen, dann einmal bewegen —
          // das richtet wandgebundene Objekte an der Wand aus.
          s2.moveFixture(neu.id, treffer.punkt);
          s2.setSelection({ kind: 'fixture', id: neu.id });
          s2.setStatus(`${FIXTURE_BY_TYPE[s2.activeFixture]?.label ?? 'Objekt'} im Raum gesetzt`);
        }
        return;
      }

      // 2b) Leitung oder Armatur: auswählen wie im Grundriss. Die Maßleiste
      // zeigt dafür keine Griffe, aber die Entf-Taste greift, und der
      // Inspektor zeigt, was dort liegt.
      if (treffer.pipeId) {
        const run = s2.doc.pipes[treffer.pipeId];
        s2.setSelection({ kind: 'pipe', id: treffer.pipeId });
        s2.setStatus(
          run ? `${PIPE_SERVICE_LABELS[run.service]} DN ${run.nominalDiameter}` : 'Leitung gewählt',
        );
        return;
      }
      if (treffer.accessoryId) {
        const armatur = s2.doc.pipeAccessories?.[treffer.accessoryId];
        s2.setSelection({ kind: 'accessory', id: treffer.accessoryId });
        s2.setStatus(armatur ? armatur.label : 'Armatur gewählt');
        return;
      }

      // 3) Sonst: Wand oder Raum auswählen — dieselbe Auswahl wie im Plan.
      const gedeutet = deuteTreffer(s2.doc, s2.doc.activeLevelId, treffer.punkt);
      if (gedeutet.art === 'wand' && gedeutet.id) s2.setSelection({ kind: 'wall', id: gedeutet.id });
      else if (gedeutet.art === 'raum' && gedeutet.id) s2.setSelection({ kind: 'room', id: gedeutet.id });
      else s2.setSelection(null);
    };

    const bewegt = (e: PointerEvent): void => {
      const s2 = useBimStore.getState();

      const griffZug = griffZugRef.current;
      if (griffZug) {
        const dx = e.clientX - griffZug.start.x;
        const dy = e.clientY - griffZug.start.y;
        /*
         * Erst ab vier Bildpunkten gilt es als Zug.
         *
         * Darunter ist es ein Antippen — und das öffnet beim Loslassen das
         * Eingabefeld. Ohne diese Schwelle gäbe es kein Antippen mehr: Jeder
         * Finger wackelt um ein, zwei Punkte, und das Feld ginge nie auf.
         */
        if (!griffZug.bewegt && Math.hypot(dx, dy) < 4) return;
        griffZug.bewegt = true;
        if (!griffZug.angemeldet) {
          griffZug.angemeldet = true;
          s2.beginGesture();
        }
        // Bewegung auf die Griffachse projizieren und in Meter umrechnen.
        const entlang =
          (dx * griffZug.achseAufSchirm.x + dy * griffZug.achseAufSchirm.y) / griffZug.pixelProMeter;
        const a = griffZug.griff.achse;
        const roh = wertAusZug(griffZug.griff, { x: a.x * entlang, y: a.y * entlang, z: a.z * entlang });
        /*
         * Fangen an Maßen, die im selben Modell schon vorkommen — nicht an
         * einer Tabelle üblicher Höhen. Im Bestand haben alle Fenster einer
         * Fassade dieselbe Brüstung, nicht ungefähr, sondern genau; wer sie
         * von Hand einstellt, trifft 1,255 statt 1,26 und erzeugt eine
         * Abweichung, die es am Bau nicht gibt.
         */
        const masse = fangmasse(s2.doc, griffZug.griff);
        const wert = fange(masse, roh);
        const meldung = wendeAn(griffZug.griff, wert);
        if (meldung) {
          const r = host.getBoundingClientRect();
          setZugFahne({
            x: e.clientX - r.left,
            y: e.clientY - r.top,
            text: griffText(griffZug.griff, wert, wert !== roh),
          });
        }
        return;
      }

      const zieht = zieheRef.current;
      if (zieht) {
        const treffer = treffePunkt(e);
        if (!treffer?.punkt) return;
        // Erst jetzt ist es eine Bewegung und kein Antippen — ab hier gehört
        // alles Folgende zu **einem** Schritt in der Historie.
        if (!zieht.angemeldet) {
          zieht.angemeldet = true;
          s2.beginGesture();
        }
        if (zieht.hoehe) {
          // Höhe aus der Höhe des Trefferpunktes in der Szene: Man zieht das
          // Objekt dorthin, wo der Zeiger an der Wand steht.
          const y = treffer.szene?.y;
          if (y !== undefined) {
            const basis = geschossHoehenRef.current.get(s2.doc.activeLevelId) ?? 0;
            const f = s2.doc.fixtures[zieht.id];
            const hoehe = Math.max(0, Math.round((y - basis) * 1000) / 1000);
            if (f) s2.updateFixture(zieht.id, { elevation: hoehe });
          }
        } else {
          s2.moveFixture(zieht.id, treffer.punkt);
        }
        // Die Fahne sagt, wo das Objekt **jetzt** steht — nicht, wo der
        // Zeiger ist. Bei einem wandgebundenen Objekt sind das zwei
        // verschiedene Stellen, und genau dieser Unterschied ist die Auskunft.
        const nach = useBimStore.getState();
        const f2 = nach.doc.fixtures[zieht.id];
        if (f2) {
          // Bildschirmlage **relativ zur Leinwand**: Die Fahne sitzt in einem
          // Kasten mit `position: relative`, und `clientX` zählt vom
          // Fensterrand. Ungerechnet stünde sie um die Breite der
          // Werkzeugleiste daneben.
          const r = host.getBoundingClientRect();
          setZugFahne({
            x: e.clientX - r.left,
            y: e.clientY - r.top,
            text: fuehrungsText(wandfuehrung(nach.doc, f2), f2.elevation),
          });
        }
        return;
      }
      // Kein Ziehen: nur zeigen, was unter dem Zeiger liegt.
      const treffer = treffePunkt(e);
      setBeruehrt(treffer?.fixtureId ?? null);
    };

    const hoch = (e: PointerEvent): void => {
      const griffZug = griffZugRef.current;
      if (griffZug) {
        griffZugRef.current = null;
        setZugFahne(null);
        host.releasePointerCapture?.(e.pointerId);
        const s3 = useBimStore.getState();
        if (griffZug.angemeldet) s3.endGesture();
        if (!griffZug.bewegt) {
          // Angetippt statt gezogen: Das Maß wird eingetippt.
          setTippGriff(griffZug.griff);
          setTippWert(griffZug.griff.wert.toFixed(3).replace('.', ','));
        } else {
          const jetzt = griffeFuer(s3.doc, s3.selections[0] ?? null).find((g) => g.id === griffZug.griff.id);
          if (jetzt) s3.setStatus(griffText(jetzt, jetzt.wert, false));
        }
        const controls2 = controlsRef.current;
        if (controls2) controls2.enabled = true;
        return;
      }
      if (zieheRef.current) {
        const s3 = useBimStore.getState();
        // Die Geste **vor** der Meldung schließen: `endGesture` schreibt
        // nichts in die Statuszeile, aber jeder weitere Speichervorgang
        // täte es, und dann stünde dort etwas anderes als das, was gerade
        // geschehen ist.
        if (zieheRef.current.angemeldet) s3.endGesture();
        const f = s3.doc.fixtures[zieheRef.current.id];
        if (f && zieheRef.current.angemeldet) {
          s3.setStatus(
            umsetzungsMeldung(f.label ?? FIXTURE_BY_TYPE[f.type]?.label ?? 'Objekt', wandfuehrung(s3.doc, f), f.elevation),
          );
        }
        zieheRef.current = null;
        setZugFahne(null);
        host.releasePointerCapture?.(e.pointerId);
      }
      // Die Kamera darf wieder. (Der Effekt läuft ohnehin nur außerhalb des
      // Begehmodus — dort gibt es keine Orbit-Steuerung, die zu sperren wäre.)
      const controls = controlsRef.current;
      if (controls) controls.enabled = true;
    };

    /*
     * **In der Erfassungsphase, nicht in der Blasenphase.**
     *
     * OrbitControls hängt seinen Hörer im Konstruktor an dieselbe Leinwand,
     * also vor diesem hier — und Hörer laufen in der Reihenfolge, in der sie
     * angemeldet wurden. In der Blasenphase hätte die Umlaufsteuerung den
     * Zeiger also längst gefasst und eine Drehung begonnen, bevor wir
     * überhaupt wissen, ob etwas getroffen wurde; `controls.enabled = false`
     * käme einen Schritt zu spät, und das Haus drehte sich beim Fassen mit.
     *
     * In der Erfassungsphase läuft dieser Hörer zuerst. Wer ein Objekt
     * greift, sperrt die Kamera, bevor sie anspringt; wer daneben greift,
     * dreht wie bisher. Genau das ist die Regel aus dem Grundriss: ein Finger
     * fasst, zwei Finger schwenken.
     */
    host.addEventListener('pointerdown', runter, true);
    host.addEventListener('pointermove', bewegt);
    window.addEventListener('pointerup', hoch);
    return () => {
      host.removeEventListener('pointerdown', runter, true);
      host.removeEventListener('pointermove', bewegt);
      window.removeEventListener('pointerup', hoch);
      zieheRef.current = null;
      setZugFahne(null);
      setBeruehrt(null);
    };
    /*
     * **Nur `cameraMode` und `treffePunkt`.** `treffePunkt` ist ein
     * `useCallback` ohne Abhängigkeiten und damit über die ganze Lebensdauer
     * dasselbe; `cameraMode` ändert sich nur, wenn jemand die Ansicht
     * umschaltet. Alles Übrige wird über Refs gelesen — siehe die Begründung
     * bei `geschossHoehenRef`.
     */
  }, [cameraMode, treffePunkt]);

  /*
   * --- Fangkörper für die Öffnungen ---------------------------------------
   *
   * Je Fenster, Tür und Durchgang ein unsichtbarer Quader im Loch. Er wird
   * gezeichnet, schreibt aber weder Farbe noch Tiefe — der Strahl findet ihn,
   * das Auge nicht. Er ist zwei Zentimeter dünner als die Wand, damit er die
   * Laibung nicht überragt und beim schrägen Blick vor der Wand liegt.
   */
  useEffect(() => {
    const gruppe = oeffnungsGruppeRef.current;
    if (!gruppe) return;
    const leeren = () => {
      for (const kind of [...gruppe.children]) {
        gruppe.remove(kind);
        (kind as THREE.Mesh).geometry?.dispose();
      }
    };
    leeren();
    if (cameraMode === 'walk') return;

    const unsichtbar = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    for (const wand of walls) {
      const g = getWallGeometry(wand, doc.nodes);
      if (!g) continue;
      const basis = geschossHoehen.get(wand.levelId) ?? 0;
      for (const op of openingsOfWall(wand.id, openings)) {
        const spanne = openingSpan(g, op);
        const unten = op.sillHeight ?? 0;
        const platz = wallBoxPlacement(
          g,
          spanne.from,
          spanne.to,
          unten,
          unten + op.height,
          Math.max(0.01, wand.thickness / 2 - 0.01),
        );
        const box = new THREE.Mesh(
          new THREE.BoxGeometry(platz.size.length, platz.size.height, platz.size.thickness),
          unsichtbar,
        );
        box.position.set(platz.center.x, platz.center.y + basis, platz.center.z);
        box.rotation.y = platz.rotationY;
        box.userData = { openingId: op.id };
        gruppe.add(box);
      }
    }
    return leeren;
  }, [walls, openings, doc.nodes, geschossHoehen, cameraMode]);

  /*
   * --- Die Griffe zeichnen ------------------------------------------------
   *
   * Eine Kugel je Griff, gezeichnet **ohne Tiefenprüfung** und ganz zuletzt.
   *
   * **Warum ohne Tiefenprüfung.** Der Griff für die Wandstärke sitzt an der
   * Außenseite; steht man im Haus, liegt er hinter der Wand. Mit
   * Tiefenprüfung wäre er unsichtbar, und die Wandstärke ließe sich nur
   * ändern, indem man um das Gebäude herumfliegt. Ein Griff ist keine
   * Geometrie, sondern ein Bedienelement — er gehört über das Bild, nicht
   * hinein.
   *
   * **Warum die Kugel so groß ist.** 0,07 m Radius wirkt im Modell riesig
   * und ist am Bildschirm gerade eben ein Tippziel: In einer Ansicht, in der
   * ein Haus ins Bild passt, sind das etwa zwanzig Bildpunkte. Kleiner trifft
   * man mit dem Finger nicht.
   */
  useEffect(() => {
    const gruppe = griffGruppeRef.current;
    if (!gruppe) return;
    for (const kind of [...gruppe.children]) {
      gruppe.remove(kind);
      const m = kind as THREE.Mesh;
      m.geometry?.dispose();
    }
    /*
     * Im Begehmodus keine Griffe.
     *
     * Dort wird gezielt, nicht gefasst: Der Strahl geht durch die Bildmitte,
     * und eine Handvoll Kugeln im Raum stünde genau dort, wo das Fadenkreuz
     * hinzeigt. Man käme an kein Bauteil mehr heran, weil immer ein Griff
     * davorläge.
     */
    if (cameraMode === 'walk' || !griffe.length) return;

    const basis = geschossHoehen.get(doc.activeLevelId) ?? 0;
    for (const g of griffe) {
      const kugel = new THREE.Mesh(
        new THREE.SphereGeometry(0.07, 16, 12),
        new THREE.MeshBasicMaterial({
          color: g.achse.z === 1 ? 0x38bdf8 : 0x2dd4bf,
          depthTest: false,
          transparent: true,
          opacity: 0.92,
        }),
      );
      const p = modelToScene(g.punkt, basis + g.hoehe);
      kugel.position.set(p.x, p.y, p.z);
      kugel.renderOrder = 1000;
      kugel.userData = { griffId: g.id };
      gruppe.add(kugel);
    }
    return () => {
      for (const kind of [...gruppe.children]) {
        gruppe.remove(kind);
        (kind as THREE.Mesh).geometry?.dispose();
      }
    };
  }, [griffe, cameraMode, doc.activeLevelId, geschossHoehen]);

  /*
   * --- Am Griff ziehen ----------------------------------------------------
   *
   * **Der Kern der Umrechnung: Bildpunkte in Meter.** Der Zeiger bewegt sich
   * auf dem Bildschirm, der Griff auf einer Achse im Raum. Naiv über die
   * Rücktransformation eines Bildpunktes gerechnet, hinge das Ergebnis an
   * der Tiefe unter dem Zeiger — und die springt, sobald der Zeiger über eine
   * Wand wandert. Der Griff zappelte dann.
   *
   * Stattdessen wird die **Achse selbst** auf den Bildschirm projiziert: Wo
   * landet der Griff, und wo landet ein Punkt einen Meter weiter auf seiner
   * Achse? Die Strecke dazwischen ist der Maßstab, und die Bewegung des
   * Zeigers wird darauf projiziert. Das ist dieselbe Rechnung, die jedes
   * CAD-Programm für seine Ziehgriffe benutzt, und sie ist tiefenstabil:
   * Der Faktor wird **einmal beim Aufsetzen** bestimmt und gilt für den
   * ganzen Zug.
   */
  /**
   * Welchen Griff der Zeiger trifft.
   *
   * Eigener Strahl gegen **nur** die Griffgruppe, und bewusst getrennt von
   * `treffePunkt`: Dort entscheidet seit 1.23.0 die Entfernung, welcher
   * Treffer gewinnt — hier darf sie das gerade nicht. Ein Griff liegt
   * absichtlich vor der Wand, zu der er gehört, und manchmal auch hinter
   * ihr; er soll in beiden Fällen greifbar sein.
   */
  const treffeGriff = useCallback(
    (klient: { x: number; y: number }): Griff | null => {
      const renderer = rendererRef.current;
      const kamera = aktiveKameraRef.current;
      const gruppe = griffGruppeRef.current;
      if (!renderer || !kamera || !gruppe || !gruppe.children.length) return null;
      const r = renderer.domElement.getBoundingClientRect();
      const zeiger = new THREE.Vector2(
        ((klient.x - r.left) / r.width) * 2 - 1,
        -((klient.y - r.top) / r.height) * 2 + 1,
      );
      const strahl = strahlRef.current;
      strahl.setFromCamera(zeiger, kamera);
      const treffer = strahl.intersectObjects(gruppe.children, false);
      if (!treffer.length) return null;
      const id = (treffer[0].object.userData as { griffId?: string }).griffId;
      /*
       * Die Griffe werden **neu aus dem Dokument geholt**, nicht aus dem
       * Netz gelesen. Das Netz trägt nur die Kennung; alles andere — Wert,
       * Grenzen, Achse — stammt aus dem Rechenkern und ist damit so aktuell
       * wie das Modell. Andernfalls zöge man an einem Griff, der noch die
       * Grenzen von vor drei Änderungen kennt.
       */
      const s2 = useBimStore.getState();
      return griffeFuer(s2.doc, s2.selections[0] ?? null).find((g) => g.id === id) ?? null;
    },
    [],
  );

  const griffAufSchirm = useCallback(
    (g: Griff): { achseAufSchirm: { x: number; y: number }; pixelProMeter: number } | null => {
      const renderer = rendererRef.current;
      const kamera = aktiveKameraRef.current;
      if (!renderer || !kamera) return null;
      const r = renderer.domElement.getBoundingClientRect();
      const basis = geschossHoehenRef.current.get(useBimStore.getState().doc.activeLevelId) ?? 0;
      const p0 = modelToScene(g.punkt, basis + g.hoehe);
      const p1 = modelToScene(
        { x: g.punkt.x + g.achse.x, y: g.punkt.y + g.achse.y },
        basis + g.hoehe + g.achse.z,
      );
      const auf = (p: { x: number; y: number; z: number }) => {
        const v = new THREE.Vector3(p.x, p.y, p.z).project(kamera);
        return { x: ((v.x + 1) / 2) * r.width, y: ((1 - v.y) / 2) * r.height };
      };
      const a = auf(p0);
      const b = auf(p1);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const laenge = Math.hypot(dx, dy);
      /*
       * Zu kurz heißt: Die Achse zeigt fast genau auf den Betrachter zu. Ein
       * Zug ließe sich dann nicht mehr sinnvoll auf sie abbilden — jede
       * Bewegung ergäbe Meter. Lieber gar nicht ziehen und es sagen; das Maß
       * lässt sich immer noch eintippen.
       */
      if (laenge < 6) return null;
      return { achseAufSchirm: { x: dx / laenge, y: dy / laenge }, pixelProMeter: laenge };
    },
    [],
  );

  /**
   * Eine Griffänderung in den Speicher bringen.
   *
   * Die Fallunterscheidung steht hier und nicht im Rechenkern: `griffe.ts`
   * beschreibt, *was* zu ändern ist, und kennt den Speicher nicht — genau
   * deshalb lässt es sich ohne laufende Oberfläche prüfen.
   */
  const wendeAn = useCallback((griff: Griff, wert: number): string | null => {
    const s2 = useBimStore.getState();
    const aenderung = aenderungFuer(s2.doc, griff, wert);
    if (!aenderung) return null;
    if (aenderung.art === 'wand') s2.updateWall(aenderung.id, aenderung.patch);
    else if (aenderung.art === 'oeffnung') s2.updateOpening(aenderung.id, aenderung.patch);
    else if (aenderung.art === 'objekt') s2.updateFixture(aenderung.id, aenderung.patch);
    else s2.moveNode(aenderung.id, aenderung.position);
    return griffText(griff, begrenze(griff, wert), false);
  }, []);

  /*
   * --- Die Tastatur in der 3D-Ansicht -------------------------------------
   *
   * **Warum es sie bisher nicht gab.** Der Grundriss hört seit jeher auf
   * Entf, Rückgängig und Esc; die 3D-Ansicht hörte nur auf W A S D, und auch
   * das nur im Begehmodus. Solange man dort nichts ändern konnte, war das
   * folgerichtig. Seit man Wände, Öffnungen und Objekte anfassen kann, ist es
   * eine Lücke: Man wählt eine Wand aus, drückt Entf — und nichts geschieht.
   *
   * Der Hörer hängt am Fenster und nicht an der Leinwand, weil eine Leinwand
   * ohne `tabindex` gar keinen Tastaturfokus bekommt. Er prüft deshalb
   * selbst, ob die Eingabe woanders hingehört: Wer in einem Feld tippt,
   * löscht kein Bauteil.
   */
  useEffect(() => {
    if (viewMode === '2d' || viewMode === 'schema') return;
    const runter = (e: KeyboardEvent): void => {
      /*
       * **Im Begehmodus gilt die Taste auch** — und zwar mit Absicht.
       *
       * Dort entsteht mit der Werkzeugkiste laufend etwas Neues, und das
       * Neue ist danach ausgewählt. Wer sieht, dass der Heizkörper an der
       * falschen Wand hängt, drückt Entf, statt herauszugehen. Griffe gibt es
       * dort keine (sie lägen im Fadenkreuz), die Auswahl aber schon — und
       * Entf ist keine Gehtaste, also kollidiert nichts.
       */
      const ziel = e.target as HTMLElement | null;
      /*
       * In einem Eingabefeld gilt die Taste dem Feld. Ohne diese Abfrage
       * löschte das Maßfeld beim Korrigieren einer Zahl die Wand, deren Maß
       * man gerade eintippt — und der Griff, an dem das Feld hängt, wäre
       * mitten in der Eingabe verschwunden.
       */
      if (ziel && (ziel.tagName === 'INPUT' || ziel.tagName === 'TEXTAREA' || ziel.isContentEditable)) return;
      const s2 = useBimStore.getState();
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!s2.selections.length && !s2.selection) return;
        e.preventDefault();
        s2.deleteSelection();
        return;
      }
      if (e.key === 'Escape') {
        setTippGriff(null);
        s2.setSelection(null);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) s2.redo();
        else s2.undo();
      }
    };
    window.addEventListener('keydown', runter);
    return () => window.removeEventListener('keydown', runter);
  }, [viewMode]);

  /**
   * Das eingetippte Maß übernehmen.
   *
   * **Das Komma ist Pflicht, nicht Kür.** Auf einer deutschen Tastatur liegt
   * das Komma auf dem Zehnerblock; wer „2,62" tippt, meint 2,62 m, und
   * `parseFloat('2,62')` ergibt **2**. Ein Aufmaß, das durch die Eingabe um
   * den Faktor hundert danebenliegt, sieht im Modell nicht falsch aus — es
   * sieht aus wie eine sehr niedrige Wand.
   *
   * Der Wert wird ausdrücklich **nicht** gerastert: Er ist abgelesen. 0,885 m
   * bleibt 0,885 m, auch wenn das Raster fürs Ziehen bei einem Zentimeter
   * steht. Begrenzt wird er trotzdem — eine Öffnung, die höher ist als ihre
   * Wand, ist kein Aufmaß, sondern ein Tippfehler.
   */
  const uebernimmTippmass = useCallback((auchGleichartige: boolean): void => {
    if (!tippGriff) return;
    const zahl = Number.parseFloat(tippWert.replace(',', '.'));
    if (!Number.isFinite(zahl)) {
      useBimStore.getState().setStatus('Das ist keine Zahl — bitte als Meter eintippen, etwa 2,62');
      return;
    }
    const s2 = useBimStore.getState();
    s2.beginGesture();
    const meldung = wendeAn(tippGriff, zahl);
    /*
     * Die Übertragung läuft **in derselben Geste**. Ein Rückgängig nimmt
     * damit alle sieben Fenster zurück und nicht eines — wer sich beim
     * Übertragen vertut, will den ganzen Schritt weghaben und nicht sieben
     * Mal drücken.
     */
    let mitgenommen = 0;
    if (auchGleichartige) {
      const mit = gleichartige(useBimStore.getState().doc, tippGriff, begrenze(tippGriff, zahl));
      for (const a of mit?.aenderungen ?? []) {
        const s3 = useBimStore.getState();
        if (a.art === 'wand') s3.updateWall(a.id, a.patch);
        else if (a.art === 'oeffnung') s3.updateOpening(a.id, a.patch);
        else if (a.art === 'objekt') s3.updateFixture(a.id, a.patch);
        else s3.moveNode(a.id, a.position);
        mitgenommen += 1;
      }
    }
    s2.endGesture();
    const begrenzt = begrenze(tippGriff, zahl);
    if (meldung) {
      const anhang = mitgenommen ? ` · auf ${mitgenommen} weitere übertragen` : '';
      s2.setStatus(
        Math.abs(begrenzt - zahl) > 1e-6
          ? `${tippGriff.label} auf ${begrenzt.toFixed(3).replace('.', ',')} m begrenzt — zulässig sind ${tippGriff.min
              .toFixed(2)
              .replace('.', ',')} bis ${tippGriff.max.toFixed(2).replace('.', ',')} m${anhang}`
          : `${meldung}${anhang}`,
      );
    }
    setTippGriff(null);
  }, [tippGriff, tippWert, wendeAn]);

  /*
   * Das Führungsband und der Griff.
   *
   * **Wozu.** Ein wandgebundenes Objekt kann sich nur *auf* seiner Wand
   * bewegen. Zieht man es quer, passiert fast nichts — das ist die Regel und
   * sieht trotzdem aus wie ein Fehler. Das Band beantwortet die Frage, bevor
   * sie entsteht: es zeigt die Strecke, auf der etwas geht.
   *
   * Gezeichnet wird ohne Tiefenprüfung und ganz zuletzt: Ein Hinweis, der
   * hinter der Wand verschwindet, auf die er sich bezieht, hilft niemandem.
   */
  useEffect(() => {
    const gruppe = fuehrungRef.current;
    if (!gruppe) return;
    for (const alt of [...gruppe.children]) {
      gruppe.remove(alt);
      (alt as THREE.Mesh).geometry?.dispose();
      const m = (alt as THREE.Mesh).material;
      for (const x of Array.isArray(m) ? m : m ? [m] : []) x.dispose();
    }
    // Genau ein gefasstes Objekt — bei einer Mehrfachauswahl wäre ein Band
    // je Objekt ein Gitter und keine Führung mehr.
    const gefasst = selections.length === 1 && selections[0].kind === 'fixture' ? selections[0] : null;
    if (!gefasst) return;
    const f = doc.fixtures[gefasst.id];
    if (!f) return;
    const basis = geschossHoehen.get(f.levelId) ?? 0;
    // Auf Objekthöhe plus eine Handbreit: auf der Achse selbst läge das Band
    // im Bauteil und wäre nur an den Enden zu sehen.
    const y = basis + f.elevation + 0.12;

    const farbe = new THREE.Color(0x38bdf8);
    const bandStoff = new THREE.MeshBasicMaterial({
      color: farbe,
      transparent: true,
      opacity: 0.7,
      depthTest: false,
    });
    const griffStoff = new THREE.MeshBasicMaterial({ color: farbe, depthTest: false });

    const fuehr = wandfuehrung(doc, f);
    if (fuehr) {
      // Das Band liegt auf der Objektseite der Wand, in Objekthöhe — dort, wo
      // die Mitte des Heizkörpers tatsächlich entlangwandert.
      const n = {
        x: -(fuehr.bis.y - fuehr.von.y),
        y: fuehr.bis.x - fuehr.von.x,
      };
      const len = Math.hypot(n.x, n.y) || 1;
      const off = fuehr.ausladung * fuehr.seite;
      const a = modelToScene(
        { x: fuehr.von.x + (n.x / len) * off, y: fuehr.von.y + (n.y / len) * off },
        y,
      );
      const b = modelToScene(
        { x: fuehr.bis.x + (n.x / len) * off, y: fuehr.bis.y + (n.y / len) * off },
        y,
      );
      const mitte = new THREE.Vector3((a.x + b.x) / 2, y, (a.z + b.z) / 2);
      const band = new THREE.Mesh(
        new THREE.BoxGeometry(Math.max(0.01, fuehr.laenge), 0.022, 0.022),
        bandStoff,
      );
      band.position.copy(mitte);
      band.rotation.y = Math.atan2(-(b.z - a.z), b.x - a.x);
      band.renderOrder = 999;
      gruppe.add(band);
    }

    // Der Griff sitzt immer, auch ohne Wand: Er ist die Zusage, dass hier
    // etwas angefasst werden kann — und ohne Wand ist das die einzige.
    const p = modelToScene(f.position, y);
    const griff = new THREE.Mesh(new THREE.SphereGeometry(0.055, 16, 12), griffStoff);
    griff.position.set(p.x, p.y, p.z);
    griff.renderOrder = 1000;
    gruppe.add(griff);
  }, [selections, doc, geschossHoehen]);

  /*
   * Farbe für Gefasstes und Berührtes.
   *
   * Ein eigener Effekt, der **nur Materialien umhängt** — kein Neuaufbau. Das
   * ist der Unterschied zwischen „reagiert sofort" und „denkt kurz nach".
   */
  useEffect(() => {
    const gruppe = tgaGruppeRef.current;
    const materials = materialsRef.current;
    if (!gruppe || !materials) return;
    const gefasstIds = new Set(
      selections.filter((x) => x.kind === 'fixture').map((x) => x.id),
    );
    for (const kind of gruppe.children) {
      const mesh = kind as THREE.Mesh;
      const daten = mesh.userData as { id?: string; art?: string };
      if (daten.art !== 'fixture' || !daten.id) continue;
      const f = doc.fixtures[daten.id];
      const grund =
        f?.category === 'heating'
          ? materials.heating
          : f?.category === 'sanitary'
            ? materials.sanitary
            : materials.ventilation;
      mesh.material = gefasstIds.has(daten.id)
        ? materials.gefasst
        : beruehrt === daten.id
          ? materials.beruehrt
          : grund;
    }

    /*
     * Leitungen und Armaturen hängen nicht in der TGA-Gruppe, sondern beim
     * Haus — sie werden mit ihm aufgebaut. Ohne diese zweite Schleife ließen
     * sie sich zwar anfassen, aber man sähe nicht, dass man sie in der Hand
     * hat, und das ist die Hälfte der Auswahl.
     */
    const inhalt = contentRef.current;
    if (!inhalt) return;
    const gefasstRohr = new Set(
      selections.filter((x) => x.kind === 'pipe' || x.kind === 'accessory').map((x) => x.id),
    );
    for (const kind of inhalt.children) {
      const mesh = kind as THREE.Mesh;
      const daten = mesh.userData as { id?: string; art?: string; grund?: THREE.Material };
      if ((daten.art !== 'pipe' && daten.art !== 'accessory') || !daten.id || !daten.grund) continue;
      mesh.material = gefasstRohr.has(daten.id) ? materials.gefasst : daten.grund;
    }
  }, [selections, beruehrt, doc.fixtures, aufbauZaehler]);

  // ------------------------------------------------------------- Begehen
  /*
   * Der Begehmodus braucht drei Dinge, die es im Viewer bisher nicht gab:
   * eine Zeitbasis (wie weit ist ein Schritt in diesem Bild?), Eingaben
   * (Tasten, Maus, Finger) und eine Kamera, die nicht an OrbitControls hängt.
   *
   * Die **Regel** — wie weit ein Schritt trägt, woran er sich stößt, wie der
   * Blick begrenzt wird — steht bewusst nicht hier, sondern in
   * `src/lib/begehen.ts`. Sie ist Geometrie und wird geprüft; hier stehen nur
   * Ereignisse und Kamerazuweisungen.
   */
  useEffect(() => {
    hindRef.current = gehHindernisse;
  }, [gehHindernisse]);

  /**
   * Die Hindernisse neu bilden — nach jedem Wechsel eines Türzustands.
   *
   * Eine Tür gilt als offen, sobald sie mehr als halb aufsteht. Das ist eine
   * Entscheidung und kein Kompromiss: Wer durch eine Tür geht, während sie
   * aufschwingt, soll nicht am letzten Zentimeter hängenbleiben — und wer sie
   * hinter sich zuzieht, soll nicht schon beim Anfassen ausgesperrt sein.
   */
  const baueHindernisse = useCallback(() => {
    const offen = new Set<string>();
    for (const [id, stand] of tuerStandRef.current) if (stand > 0.5) offen.add(id);
    hindRef.current = hindernisse(doc, doc.activeLevelId, offen);
  }, [doc]);

  useEffect(() => {
    augenRef.current = (geschossHoehen.get(doc.activeLevelId) ?? 0) + AUGENHOEHE;
  }, [geschossHoehen, doc.activeLevelId]);

  /*
   * Diagnosehaken für die Rauchtests (siehe `main.tsx`): wie weit jedes
   * Türblatt aufsteht, 0 = zu, 1 = ganz auf. Am Bild ist das nicht zu messen.
   */
  useEffect(() => {
    window.__raviaTueren = () =>
      tuerBlaetterRef.current.map((b) => tuerStandRef.current.get(b.id) ?? 0);
    return () => {
      window.__raviaTueren = undefined;
    };
  }, []);

  /** Die Blätter auf ihren jeweiligen Stand drehen. */
  const tuerenZeichnen = useCallback(() => {
    for (const blatt of tuerBlaetterRef.current) {
      const stand = tuerStandRef.current.get(blatt.id) ?? 0;
      if (blatt.gruppe) blatt.gruppe.rotation.y = blatt.sign * TUER_OFFEN_WINKEL * stand;
      else blatt.mesh.visible = stand < 0.5;
    }
  }, []);

  /*
   * **Beim Betreten sind alle Türen zu, beim Verlassen alle auf.**
   *
   * Das klingt widersprüchlich und ist es nicht — es sind zwei verschiedene
   * Fragen an dasselbe Bauteil:
   *
   *  · In der Übersicht ist die offene Tür ein *Zeichen*. Sie sagt auf einen
   *    Blick, wohin sie aufgeht, und genau dafür wurde sie seit jeher mit 72°
   *    gezeichnet. Eine geschlossene Tür sähe dort aus wie eine Wand.
   *  · Im begehbaren Modus ist sie ein *Bauteil*. Dort ist die Frage, ob man
   *    durchkommt und wie sich der Weg durch die Wohnung anfühlt — und die
   *    beantwortet nur eine Tür, die man öffnen muss.
   */
  useEffect(() => {
    const zu = cameraMode === 'walk';
    tuerStandRef.current.clear();
    tuerZielRef.current.clear();
    if (!zu) {
      for (const blatt of tuerBlaetterRef.current) {
        tuerStandRef.current.set(blatt.id, 1);
        tuerZielRef.current.set(blatt.id, 1);
      }
    }
    tuerenZeichnen();
    baueHindernisse();
  }, [cameraMode, neuaufbau, tuerenZeichnen, baueHindernisse]);

  /**
   * Die Tür vor einem auf- oder zumachen.
   *
   * **Warum das eine Taste ist und kein Klick.** Im begehbaren Modus ist die
   * Maus das Umsehen — sie steckt im Fangschloss und hat keinen Zeiger. Ein
   * Klick wäre dort nicht ortsgebunden, also auch nicht auf eine bestimmte
   * Tür zu richten. Welche Tür gemeint ist, entscheidet stattdessen der
   * Blick (siehe `tuerInReichweite`).
   */
  const tuerSchalten = useCallback(() => {
    const g = geherRef.current;
    const treffer = tuerInReichweite(doc, doc.activeLevelId, { x: g.x, y: g.y }, g.gier);
    if (!treffer) {
      useBimStore.getState().setStatus('Keine Tür in Reichweite — näher herangehen.');
      return;
    }
    const id = treffer.opening.id;
    const jetzt = tuerZielRef.current.get(id) ?? 0;
    const ziel = jetzt > 0.5 ? 0 : 1;
    tuerZielRef.current.set(id, ziel);
    const wand = doc.walls[treffer.opening.wallId];
    const raum = wand
      ? Object.values(doc.rooms).find((r) => r.boundaries.some((b) => b.wallId === wand.id))
      : undefined;
    useBimStore
      .getState()
      .setStatus(
        `Tür ${ziel > 0.5 ? 'geöffnet' : 'geschlossen'}` +
          (raum ? ` — ${raum.name}` : '') +
          ' · E schaltet um',
      );
  }, [doc]);

  /*
   * Die Stirnlampe.
   *
   * Von außen betrachtet reicht Sonne und Himmel; drinnen nicht. Im ersten
   * Versuch stand man in einem Zimmer, das fast schwarz war — das Licht kam
   * durchs Fenster und sonst nirgendwoher, und genau so ist es ja auch
   * gerechnet. Eine schwache Lampe an der Kamera macht daraus einen Raum, in
   * dem man Heizkörper und Leitungen erkennt, ohne dass er künstlich
   * ausgeleuchtet wirkt.
   *
   * Sie hängt an der Kamera und nicht in der Szene: Wer sich umdreht, nimmt
   * sie mit.
   */
  useEffect(() => {
    const kamera = perspectiveRef.current;
    const szene = sceneRef.current;
    if (!kamera || !szene) return;
    if (cameraMode !== 'walk') return;
    const lampe = new THREE.PointLight(0xfff3e0, 22, 14, 2);
    lampe.position.set(0, 0.25, 0);
    kamera.add(lampe);
    szene.add(kamera);
    return () => {
      kamera.remove(lampe);
      szene.remove(kamera);
      lampe.dispose();
    };
  }, [cameraMode]);

  useEffect(() => {
    if (cameraMode !== 'walk') return;
    const host = rendererRef.current?.domElement;
    if (!host) return;

    const taste = (e: KeyboardEvent, unten: boolean): void => {
      /*
       * In einem Eingabefeld gilt die Taste dem Feld.
       *
       * Seit im Gehen Maße eingetippt werden, ist das kein Randfall mehr: Wer
       * „0,885" in das Maßfeld tippt, drückte sonst mit jedem `s` einen
       * Schritt rückwärts und stünde nach der Zahl in einem anderen Raum —
       * mit einem Feld, das an einem Griff hängt, den es dort nicht mehr
       * gibt. `a`, `s`, `d` und `w` kommen in deutschen Maßangaben zwar
       * nicht vor, in einem Raumnamen aber sehr wohl.
       */
      const feld = e.target as HTMLElement | null;
      if (feld && (feld.tagName === 'INPUT' || feld.tagName === 'TEXTAREA' || feld.isContentEditable)) {
        return;
      }
      const v = unten ? 1 : 0;
      const ein = eingabeRef.current;
      switch (e.key.toLowerCase()) {
        case 'w': case 'arrowup': ein.tastVor = v; break;
        case 's': case 'arrowdown': ein.tastVor = unten ? -1 : 0; break;
        case 'd': case 'arrowright': ein.tastSeit = v; break;
        case 'a': case 'arrowleft': ein.tastSeit = unten ? -1 : 0; break;
        case 'shift': ein.schnell = unten; return;
        case 'e':
          // Die Tür vor einem auf- oder zumachen. Nur beim Drücken, nicht
          // beim Loslassen — sonst schlüge sie zweimal um und stünde wieder
          // so da wie vorher.
          if (unten) tuerSchalten();
          return;
        case 'escape':
          if (unten) useBimStore.getState().setCameraMode('orbit');
          return;
        default:
          return;
      }
      // Nur für die Tasten, die wir wirklich benutzen: sonst ließe sich im
      // Begehmodus nichts mehr tippen und die Seite nicht mehr scrollen.
      e.preventDefault();
    };
    const runter = (e: KeyboardEvent): void => taste(e, true);
    const hoch = (e: KeyboardEvent): void => taste(e, false);

    /** Blick drehen — dieselbe Rechnung für Maus im Fangschloss und Ziehen. */
    const drehe = (dx: number, dy: number): void => {
      const g = geherRef.current;
      // 0,0022 rad je Bildpunkt ≈ 0,13° — dieselbe Größenordnung wie in
      // Spielen; darunter fühlt sich das Umsehen zäh an, darüber nervös.
      g.gier -= dx * 0.0022;
      g.nick = begrenzeNick(g.nick - dy * 0.0022);
    };

    let zieht = false;
    let letzte = { x: 0, y: 0 };
    const zeigerRunter = (e: PointerEvent): void => {
      if (document.pointerLockElement === host) return;
      if (e.pointerType === 'mouse') {
        // Am Rechner ist das Fangschloss der bequemste Weg: die Maus wird
        // unsichtbar und dreht endlos, statt am Fensterrand anzustoßen.
        host.requestPointerLock?.();
        return;
      }
      zieht = true;
      letzte = { x: e.clientX, y: e.clientY };
    };
    const zeigerBewegt = (e: PointerEvent): void => {
      if (document.pointerLockElement === host) {
        drehe(e.movementX, e.movementY);
        return;
      }
      if (!zieht) return;
      drehe(e.clientX - letzte.x, e.clientY - letzte.y);
      letzte = { x: e.clientX, y: e.clientY };
    };
    const zeigerHoch = (): void => {
      zieht = false;
    };
    const schlossWechsel = (): void => setZeigerGefangen(document.pointerLockElement === host);

    window.addEventListener('keydown', runter);
    window.addEventListener('keyup', hoch);
    host.addEventListener('pointerdown', zeigerRunter);
    window.addEventListener('pointermove', zeigerBewegt);
    window.addEventListener('pointerup', zeigerHoch);
    document.addEventListener('pointerlockchange', schlossWechsel);

    return () => {
      window.removeEventListener('keydown', runter);
      window.removeEventListener('keyup', hoch);
      host.removeEventListener('pointerdown', zeigerRunter);
      window.removeEventListener('pointermove', zeigerBewegt);
      window.removeEventListener('pointerup', zeigerHoch);
      document.removeEventListener('pointerlockchange', schlossWechsel);
      if (document.pointerLockElement === host) document.exitPointerLock?.();
      // Beim Verlassen alles loslassen — sonst läuft man beim nächsten
      // Betreten sofort los, weil eine Taste als „gedrückt" gemerkt war.
      eingabeRef.current = { tastVor: 0, tastSeit: 0, stickVor: 0, stickSeit: 0, schnell: false };
      setZeigerGefangen(false);
    };
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
    if (!uhrRef.current) uhrRef.current = new THREE.Clock();
    const uhr = uhrRef.current;
    uhr.getDelta(); // den aufgelaufenen Rest verwerfen

    renderer.setAnimationLoop(() => {
      /*
       * Ein Zeitschritt, gedeckelt auf eine Zehntelsekunde.
       *
       * Der Deckel ist kein Feinschliff: Wer den Reiter wechselt, bekommt beim
       * Zurückkommen ein Delta von mehreren Sekunden. Ohne Deckel wäre der
       * erste Schritt danach zehn Meter lang — durch jede Wand hindurch,
       * gegen die er unterwegs stieße.
       */
      const dt = Math.min(uhr.getDelta(), 0.1);

      if (cameraMode === 'walk') {
        const kamera = perspectiveRef.current;
        if (kamera) {
          const g = geherRef.current;
          const ein = eingabeRef.current;
          const vor = Math.max(-1, Math.min(1, ein.tastVor + ein.stickVor));
          const seit = Math.max(-1, Math.min(1, ein.tastSeit + ein.stickSeit));
          const tempo = ein.schnell ? TEMPO_SCHNELL : TEMPO_GEHEN;
          const s2 = schritt(g.gier, vor, seit, tempo, dt);
          if (s2.x !== 0 || s2.y !== 0) {
            const ziel = gehe({ x: g.x, y: g.y }, { x: g.x + s2.x, y: g.y + s2.y }, hindRef.current);
            g.x = ziel.x;
            g.y = ziel.y;
          }
          /*
           * Türblätter nachführen.
           *
           * Eine Tür braucht rund eine Sekunde, bis sie ganz aufsteht — das
           * ist nicht Zierde: Wer sie sofort auf 72° springen ließe, sähe
           * nicht, *wohin* sie aufgeht, und genau das ist im Modell die
           * interessante Auskunft (steht der Heizkörper im Weg?).
           *
           * Erreicht ein Blatt die Halbstellung, ändert sich die
           * Begehbarkeit — dann und nur dann werden die Hindernisse neu
           * gebildet.
           */
          let schwelleGekreuzt = false;
          for (const [id, ziel] of tuerZielRef.current) {
            const stand = tuerStandRef.current.get(id) ?? 0;
            if (Math.abs(stand - ziel) < 1e-4) continue;
            const richtung = ziel > stand ? 1 : -1;
            const neu2 = Math.max(0, Math.min(1, stand + richtung * dt * TUER_TEMPO));
            tuerStandRef.current.set(id, neu2);
            if (stand > 0.5 !== neu2 > 0.5) schwelleGekreuzt = true;
          }
          if (schwelleGekreuzt) baueHindernisse();
          tuerenZeichnen();

          // Modell → Szene: x bleibt, Modell-y wird −z, die Höhe ist y.
          kamera.position.set(g.x, augenRef.current, -g.y);
          const b = blickrichtung(g.gier, g.nick);
          kamera.lookAt(g.x + b.x, augenRef.current + b.z, -(g.y + b.y));
        }
      } else {
        controls.update();
      }
      /*
       * Die Rose auf den Blickwinkel drehen.
       *
       * Auf dem Blatt zeigt der Bildschirm nach oben, was im Modell +y ist.
       * Im Modell zeigt er nach oben, wohin die Kamera schaut. Zwischen
       * beidem liegt genau der Blickwinkel: Eine Richtung mit dem Modellwinkel
       * φ erscheint am Bildschirm unter φ − gier + 90°. Für den Plan ist
       * gier = 90° und die Formel fällt auf φ zusammen — dieselbe Rose, eine
       * Drehung weiter.
       */
      const kompass = kompassRef.current;
      if (kompass) {
        const richtung = new THREE.Vector3();
        (aktiveKameraRef.current ?? controls.object).getWorldDirection(richtung);
        // Szene → Modell: x bleibt x, Modell-y ist −z.
        const gier = Math.atan2(-richtung.z, richtung.x);
        // CSS dreht im Uhrzeigersinn, die Rechnung gegen ihn.
        kompass.style.transform = `rotate(${((gier * 180) / Math.PI - 90).toFixed(1)}deg)`;
      }

      renderer.render(scene, (aktiveKameraRef.current ?? controls.object) as THREE.Camera);
    });

    return () => renderer.setAnimationLoop(null);
  }, [viewMode, cameraMode]);

  return (
    <div className={`relative h-full w-full overflow-hidden ${className}`}>
      <div ref={hostRef} className="h-full w-full" />

      {/*
        Der Kompass.

        **Warum er sich mitdreht.** Im Grundriss steht Norden fest — dort ist
        die Rose eine Angabe über das Blatt. Im Modell dreht man sich, und
        dann ist die Frage eine andere: In welche Richtung schaue ich gerade?
        Die Nadel bleibt deshalb auf Norden stehen, während sich die Rose
        unter ihr dreht. Genau das tut ein Kompass in der Hand.

        Gedreht wird am Knotenpunkt und nicht im Zustand: Der Blickwinkel
        ändert sich sechzigmal in der Sekunde, und ein React-Durchlauf je Bild
        wäre dafür der falsche Preis.
      */}
      <div
        ref={kompassRef}
        // Unter der Ansichtsmarke „Modell 3D" (die sitzt links oben, siehe
        // `ViewportBadge` in App.tsx) — sonst liegen beide übereinander und
        // beide sind unlesbar.
        className="pointer-events-none absolute left-3 top-12 h-[52px] w-[52px]"
        title="Norden"
      >
        <svg viewBox="0 0 100 100" className="h-full w-full">
          {kompassTeile.map((t, i) => {
            const P = (q: { x: number; y: number }): string => `${50 + q.x * 30},${50 - q.y * 30}`;
            if (t.kind === 'kreis') {
              return (
                <circle
                  key={i}
                  cx={50}
                  cy={50}
                  r={t.radius * 30}
                  fill="rgba(15,23,42,0.6)"
                  stroke="rgba(148,163,184,0.5)"
                  strokeWidth={1.2}
                />
              );
            }
            if (t.kind === 'linie') {
              const [x1, y1] = P(t.a).split(',');
              const [x2, y2] = P(t.b).split(',');
              return (
                <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(148,163,184,0.6)" strokeWidth={1.2} />
              );
            }
            if (t.kind === 'flaeche') {
              return <polygon key={i} points={t.punkte.map(P).join(' ')} fill="#38BDF8" />;
            }
            const [tx, ty] = P(t.punkt).split(',');
            return (
              <text
                key={i}
                x={tx}
                y={ty}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={13}
                fontWeight={700}
                fill="#CBD5E1"
              >
                {t.text}
              </text>
            );
          })}
        </svg>
      </div>

      {/* Kamera-Umschalter */}
      <div className="panel absolute right-3 top-3 flex gap-1 p-1">
        {(
          [
            { id: 'orbit', label: 'Orbit' },
            { id: 'iso', label: 'Iso' },
            { id: 'top', label: 'Top' },
            { id: 'walk', label: 'Begehen' },
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
          title="Grundstück, Wärmepumpe und Wärmequelle zeigen — dieselbe Ebene wie im Grundriss"
          onClick={() => toggleLayer(EBENE_GELAENDE)}
        >
          Gelände
        </button>
        <div className="divider-v" />
        <button
          className="chip text-slate-400 hover:text-slate-200"
          onClick={() => {
            if (boundsRef.current) fitToBounds(boundsRef.current);
            fittedRef.current = true;
          }}
          title="Ansicht auf das Gebäude einpassen"
        >
          Einpassen
        </button>
      </div>

      {/* ------------------------------------------------- Bedienung im Haus */}
      {cameraMode === 'walk' && (
        <>
          {/*
            Das Steuerkreuz.

            **Warum es auch am Rechner dasteht.** Es kostet nichts und nimmt
            die Frage weg, ob dieses Gerät gerade Tastatur hat oder nicht.
            Auf dem Tablet ist es die einzige Art, vorwärts zu kommen; dort
            ist es 128 px groß, also weit über dem Tippmaß.
          */}
          <Steuerkreuz
            onAendern={(vor, seit) => {
              eingabeRef.current.stickVor = vor;
              eingabeRef.current.stickSeit = seit;
            }}
          />

          {/*
            Die Grundzeile weicht, sobald ein Werkzeug in der Hand liegt.

            Beides untereinander wäre auf dem Tablet ein Drittel des Bildes,
            und die Zeile „W A S D gehen" braucht nur, wer noch nicht geht.
          */}
          {!werkzeug && (
            <div className="panel pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-2 text-center">
              <div className="text-[11px] text-slate-300">
                {zeigerGefangen
                  ? 'Maus dreht den Blick · E öffnet die Tür · Esc beendet'
                  : 'W A S D gehen · ziehen dreht den Blick · E öffnet die Tür'}
              </div>
              <div className="mt-0.5 text-[10px] text-slate-500">
                Augenhöhe 1,65 m · Umschalt geht schneller · Türen sind offen, Fenster nicht
              </div>
            </div>
          )}

          <Werkzeugkiste
            offen={kisteOffen}
            aufZu={() => setKisteOffen((v) => !v)}
            gewaehlt={werkzeug}
            waehle={(w) => {
              setWerkzeug((alt) => (alt?.id === w.id ? null : w));
              setRohrAnfang(null);
              setVorschlaege(null);
            }}
            anschluss={anschluss}
            setzeAnschluss={setAnschluss}
            ventilSeite={ventilSeite}
            setzeVentilSeite={setVentilSeite}
          />

          {werkzeug && (
            <Fadenkreuz
              auskunft={zielAuskunft(doc, ziel)}
              scharf={darfSetzen(werkzeug, ziel, rohrAnfang ?? undefined).moeglich}
            />
          )}

          {werkzeug && !vorschlaege && (
            <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 flex-col items-center gap-1.5">
              <div className="panel pointer-events-none px-3 py-1 text-center text-[10px] text-slate-400">
                {werkzeug.ziel}
              </div>
              <div className="flex items-center gap-2">
                <button
                  /*
                    Der Auslöser.

                    **Warum er so groß ist.** Er wird mit dem Daumen bedient,
                    während die andere Hand am Steuerkreuz liegt und die Augen
                    am Fadenkreuz hängen — also blind. Alles unter der
                    Tippgröße von 44 px trifft man in dieser Lage nicht.
                  */
                  className={`rounded-xl px-5 py-3 text-sm font-medium shadow-lg transition ${
                    darfSetzen(werkzeug, ziel, rohrAnfang ?? undefined).moeglich
                      ? 'bg-accent text-graphite-950 hover:brightness-110'
                      : 'cursor-not-allowed bg-graphite-800 text-slate-500'
                  }`}
                  style={{ minWidth: 200, minHeight: 48 }}
                  onClick={ausloesen}
                >
                  {darfSetzen(werkzeug, ziel, rohrAnfang ?? undefined).text}
                </button>
                <button
                  className="panel px-3 text-[11px] text-slate-400 hover:text-slate-200"
                  style={{ minHeight: 48 }}
                  title="Werkzeug aus der Hand legen"
                  onClick={() => {
                    setWerkzeug(null);
                    setRohrAnfang(null);
                  }}
                >
                  Ablegen
                </button>
              </div>
            </div>
          )}

          {/*
            Die Werteauswahl beim Beschriften.

            Sie steht mitten im Bild und fängt den Zeiger ab: An dieser Stelle
            ist die Frage gestellt, und solange sie offensteht, soll nichts
            anderes gehen — auch kein zweiter Auslöser, der eine zweite Fahne
            anlegt.
          */}
          {vorschlaege && (
            <div className="absolute inset-0 flex items-center justify-center bg-graphite-950/40">
              <div className="panel w-[min(22rem,86vw)] p-3">
                <div className="text-[11px] text-slate-300">Was soll auf der Fahne stehen?</div>
                <div className="mt-0.5 text-[10px] text-slate-500">
                  Nur Werte, die im Modell stehen — dann altert die Fahne nicht still mit.
                </div>
                <div className="mt-2 flex flex-col gap-1">
                  {vorschlaege.liste.map((v) => (
                    <button
                      key={`${v.quelle}-${v.text}`}
                      className="flex items-center justify-between rounded-lg bg-white/[0.03] px-3 text-left hover:bg-white/[0.07]"
                      style={{ minHeight: 44 }}
                      onClick={() => beschriften(v)}
                    >
                      <span className="font-mono text-[12px] text-slate-100">{v.text}</span>
                      <span className="text-[10px] text-slate-500">{v.hinweis}</span>
                    </button>
                  ))}
                </div>
                <button
                  className="mt-2 w-full rounded-lg px-3 text-[11px] text-slate-400 hover:text-slate-200"
                  style={{ minHeight: 40 }}
                  onClick={() => setVorschlaege(null)}
                >
                  Abbrechen
                </button>
              </div>
            </div>
          )}

          <button
            className="panel absolute bottom-4 right-3 px-3 py-2 text-[11px] text-slate-300 hover:text-slate-100"
            onClick={() => useBimStore.getState().setCameraMode('orbit')}
          >
            Herausgehen
          </button>
        </>
      )}

      {/*
        Die Fahne am Zeiger beim Ziehen.

        Sie steht **über** dem Finger und nicht darunter: auf dem Tablet
        verdeckt die Hand alles unterhalb des Berührpunktes, und eine
        Auskunft, die man nur sieht, wenn man die Hand wegnimmt, kommt zu
        spät. `pointer-events-none`, damit sie den Zug nicht abfängt.
      */}
      {zugFahne && (
        <div
          className="panel pointer-events-none absolute z-10 whitespace-nowrap px-2.5 py-1.5 font-mono text-[11px] text-accent"
          style={{
            left: zugFahne.x,
            top: zugFahne.y,
            transform: 'translate(-50%, calc(-100% - 22px))',
          }}
        >
          {zugFahne.text}
        </div>
      )}

      {/*
        Das Maß eintippen.

        **Warum das der wichtigere der beiden Wege ist.** Ziehen ändert grob;
        ein Aufmaß besteht aber aus Zahlen, die jemand abgelesen hat — 2,62 m
        Raumhöhe, 1,26 m Brüstung, 0,885 m Rohbaubreite. Auf dem Tablet ist
        Ziehen zusätzlich ungenau. Ein Griff ist deshalb beides: Man zieht ihn,
        wenn man die Richtung sucht, und tippt ihn an, wenn man die Zahl hat.

        Das Feld zeigt die Grenzen mit an. Sie stehen nicht zur Zierde da: Wer
        eine 3,20 m hohe Öffnung in eine 2,50 m hohe Wand tippt, soll vorher
        sehen, woran es scheitert, statt hinterher eine gekappte Zahl
        vorzufinden.
      */}
      {tippGriff && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-graphite-950/40">
          <div className="panel w-[min(20rem,86vw)] p-3">
            <div className="text-[11px] text-slate-300">{tippGriff.label}</div>
            <div className="mt-0.5 text-[10px] text-slate-500">
              zulässig {tippGriff.min.toFixed(2).replace('.', ',')} bis{' '}
              {tippGriff.max.toFixed(2).replace('.', ',')} m
            </div>
            <input
              className="field mt-2 w-full text-center font-mono"
              inputMode="decimal"
              autoFocus
              value={tippWert}
              onChange={(e) => setTippWert(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') uebernimmTippmass(false);
                if (e.key === 'Escape') setTippGriff(null);
              }}
            />
            {/*
              Die Fangmaße als Knöpfe.

              Sie sind die Abkürzung für den häufigsten Fall im Bestand: „so
              wie die anderen". Angeboten wird nur, was im selben Modell schon
              vorkommt — eine Tabelle üblicher Höhen wäre das Gegenteil von
              Aufmaß.
            */}
            {(() => {
              const masse = fangmasse(useBimStore.getState().doc, tippGriff);
              if (!masse.length) return null;
              return (
                <div className="mt-2">
                  <div className="text-[10px] text-slate-500">im Modell vorhanden</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {masse.slice(0, 6).map((m) => (
                      <button
                        key={m}
                        className="chip text-[11px] text-slate-300 hover:text-slate-100"
                        style={{ minHeight: 36 }}
                        onClick={() => setTippWert(m.toFixed(3).replace('.', ','))}
                      >
                        {m.toFixed(2).replace('.', ',')} m
                      </button>
                    ))}
                  </div>
                </div>
              );
            })()}
            {/*
              Dasselbe Maß auf alles legen, was offensichtlich dazugehört.

              Der Handgriff, den das ersetzt: Ein Bestandsgebäude hat **eine**
              Fensterbrüstung, nicht sieben. Man misst sie einmal und trägt
              sie sieben Mal ein — bei der vierten Eingabe vertippt sich
              jemand, und im Plan sitzt ein Fenster zwei Zentimeter tiefer als
              seine Nachbarn. Diese Abweichung sieht später aus wie eine
              Messung.

              Der Knopf nennt die Zahl, die er anfasst. Ein „auf alle
              übertragen" ohne Zahl drückt niemand zweimal.
            */}
            {(() => {
              const zahl = Number.parseFloat(tippWert.replace(',', '.'));
              if (!Number.isFinite(zahl)) return null;
              const mit = gleichartige(useBimStore.getState().doc, tippGriff, begrenze(tippGriff, zahl));
              if (!mit) return null;
              return (
                <button
                  className="mt-2 w-full rounded-lg bg-white/[0.04] px-3 text-[11px] text-slate-300 hover:bg-white/[0.08]"
                  style={{ minHeight: 40 }}
                  onClick={() => uebernimmTippmass(true)}
                >
                  {mit.beschreibung}
                </button>
              );
            })()}
            <div className="mt-3 flex gap-2">
              <button
                className="flex-1 rounded-lg bg-accent px-3 text-sm font-medium text-graphite-950 hover:brightness-110"
                style={{ minHeight: 44 }}
                onClick={() => uebernimmTippmass(false)}
              >
                Übernehmen
              </button>
              <button
                className="panel px-3 text-[11px] text-slate-400 hover:text-slate-200"
                style={{ minHeight: 44 }}
                onClick={() => setTippGriff(null)}
              >
                Abbrechen
              </button>
            </div>
          </div>
        </div>
      )}

      {/*
        Was mit dem ausgewählten Bauteil geht.

        Die Leiste erscheint, sobald genau **ein** Bauteil gewählt ist. Bei
        mehreren wäre „löschen" mehrdeutig und „Maß ändern" ohnehin sinnlos.

        Sie hing bis 1.25.0 an den Griffen — kein Griff, keine Leiste. Für
        eine Leitung oder eine Armatur gibt es aber nichts zu ziehen, und
        damit gab es auf dem Tablet, wo keine Entf-Taste liegt, keinen Weg,
        sie wieder loszuwerden. Jetzt trägt die Leiste die Maße, *wenn* es
        welche gibt, und den Entfernen-Knopf immer.

        **Und sie erscheint jetzt auch im begangenen Haus.** Bis 1.26.0 war
        sie dort ausgeschlossen — mit der stillen Begründung, im Gehen werde
        gesetzt und nicht geändert. Das ist nicht, wie ein Aufmaß abläuft:
        Man steht vor der Tür, misst 0,885 m, und will das eintragen, ohne
        herauszugehen und den Grundriss zu suchen. Gezogen wird im Gehen
        nicht — der Zug dreht den Kopf —, getippt schon.

        Etwas höher als draußen: Unter der Leiste sitzt im Gehen der
        Auslöser, und zwei Knopfreihen übereinander trifft niemand mit dem
        Daumen.
      */}
      {!tippGriff && selections.length === 1 && (
        <div
          className={`panel absolute left-1/2 flex max-w-[min(42rem,92vw)] -translate-x-1/2 flex-wrap items-center gap-1 p-1.5 ${
            cameraMode === 'walk' ? 'bottom-24' : 'bottom-4'
          }`}
        >
          {griffe.length > 0 && <span className="px-1.5 text-[10px] text-slate-500">Maß ändern:</span>}
          {griffe.map((g) => (
            <button
              key={g.id}
              className="chip text-[11px] text-slate-300 hover:text-slate-100"
              style={{ minHeight: 36 }}
              title={
                cameraMode === 'walk'
                  ? `${g.label} — antippen und eintippen. Im Gehen wird nicht gezogen: Der Zug über das Bild dreht den Kopf.`
                  : `${g.label} — antippen zum Eintippen, im Bild ziehen zum Ändern`
              }
              onClick={() => {
                setTippGriff(g);
                setTippWert(g.wert.toFixed(3).replace('.', ','));
              }}
            >
              {g.label} <span className="ml-1 font-mono text-slate-500">{g.wert.toFixed(2).replace('.', ',')}</span>
            </button>
          ))}
          {griffe.length > 0 && <div className="divider-v" />}
          <button
            className="chip text-[11px] text-rose-300 hover:text-rose-200"
            style={{ minHeight: 36 }}
            title="Bauteil entfernen (Entf)"
            onClick={() => useBimStore.getState().deleteSelection()}
          >
            Entfernen
          </button>
        </div>
      )}

      {/*
        Der Hinweis, dass hier etwas geht.

        **Warum er nötig ist.** Eine 3D-Ansicht sieht aus wie ein Bild, und auf
        ein Bild fasst niemand. Dass man einen Heizkörper anfassen und
        umsetzen kann, steht an keiner Stelle — es war deshalb zu erfahren nur
        durch Zufall. Der Hinweis verschwindet, sobald etwas ausgewählt ist:
        dann ist die Frage beantwortet, und der Platz gehört dem Modell.
      */}
      {cameraMode !== 'walk' && walls.length > 0 && selections.length === 0 && (
        <div className="panel pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-2 text-center">
          <div className="text-[11px] text-slate-300">
            Antippen wählt · Ziehen setzt um · Umschalt + Ziehen ändert die Höhe
          </div>
          <div className="mt-0.5 text-[10px] text-slate-500">
            Ein wandgebundenes Objekt bleibt auf seiner Wand — das Band zeigt, wohin
          </div>
        </div>
      )}

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

/**
 * Das Steuerkreuz zum Gehen.
 *
 * **Warum ein Schiebefeld und keine vier Knöpfe.** Vier Knöpfe kann man nur
 * einzeln drücken; ein Mensch geht aber schräg, und zwar ständig. Das
 * Schiebefeld liefert zwei Zahlen zwischen −1 und 1 — Richtung *und* Tempo
 * zugleich, ohne dass man etwas dazulernen müsste.
 *
 * Der Knopf kehrt beim Loslassen in die Mitte zurück. Ohne das läuft man
 * weiter, sobald der Finger abrutscht, und das ist im Haus die häufigste Art,
 * in einer Wand zu landen.
 */
function Steuerkreuz({ onAendern }: { onAendern: (vor: number, seit: number) => void }): JSX.Element {
  const feldRef = useRef<HTMLDivElement>(null);
  const [knopf, setKnopf] = useState({ x: 0, y: 0 });
  const zeigerRef = useRef<number | null>(null);

  const setzen = (e: React.PointerEvent<HTMLDivElement>): void => {
    const feld = feldRef.current;
    if (!feld) return;
    const r = feld.getBoundingClientRect();
    const mx = r.left + r.width / 2;
    const my = r.top + r.height / 2;
    const halb = r.width / 2;
    let dx = (e.clientX - mx) / halb;
    let dy = (e.clientY - my) / halb;
    const l = Math.hypot(dx, dy);
    // Über den Rand hinaus wird nicht schneller — sonst rennt man, sobald
    // der Daumen weit genug wandert.
    if (l > 1) {
      dx /= l;
      dy /= l;
    }
    setKnopf({ x: dx, y: dy });
    // Nach oben schieben heißt vorwärts; Bildschirm-y zeigt nach unten.
    onAendern(-dy, dx);
  };

  const loslassen = (): void => {
    zeigerRef.current = null;
    setKnopf({ x: 0, y: 0 });
    onAendern(0, 0);
  };

  return (
    <div
      ref={feldRef}
      className="panel absolute bottom-4 left-3 h-32 w-32 touch-none rounded-full"
      style={{ touchAction: 'none' }}
      onPointerDown={(e) => {
        zeigerRef.current = e.pointerId;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        setzen(e);
      }}
      onPointerMove={(e) => {
        if (zeigerRef.current === e.pointerId) setzen(e);
      }}
      onPointerUp={loslassen}
      onPointerCancel={loslassen}
      title="Schieben zum Gehen"
    >
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="h-24 w-24 rounded-full border border-white/[0.08]" />
      </div>
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 h-12 w-12 rounded-full bg-accent/25 ring-1 ring-accent/50"
        style={{ transform: `translate(calc(-50% + ${knopf.x * 40}px), calc(-50% + ${knopf.y * 40}px))` }}
      />
    </div>
  );
}

/**
 * Das Fadenkreuz.
 *
 * **Warum es überhaupt eines gibt.** In der begehbaren Ansicht wird gesetzt,
 * wohin man schaut. Ohne eine Marke ist „wohin man schaut" aber keine Stelle,
 * sondern eine Gegend: Die Bildmitte liegt nicht dort, wo das Auge hinsieht,
 * sondern dort, wo die Kamera hinsieht, und das sind bei 60° Bildwinkel auf
 * einem Tabletbildschirm gut und gerne zwanzig Zentimeter Unterschied an der
 * Wand gegenüber. Die Marke macht aus der Gegend eine Stelle.
 *
 * Der Ring wechselt die Farbe, sobald dort gesetzt werden darf. Das ist die
 * einzige Rückmeldung, die man beim Zielen wirklich liest — die Zeile
 * darunter liest man erst, wenn der Ring einen stutzig macht.
 */
function Fadenkreuz({ auskunft, scharf }: { auskunft: string; scharf: boolean }): JSX.Element {
  // Der Akzentton als Literal: Der Ring wird in SVG gezeichnet, und Tailwind-
  // Klassen greifen dort nicht auf `stroke`. Der Wert ist derselbe wie
  // `accent.DEFAULT` in der Tailwind-Konfiguration.
  const farbe = scharf ? '#38BDF8' : 'rgba(148,163,184,0.75)';
  return (
    <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
      <svg width="42" height="42" viewBox="0 0 42 42" aria-hidden>
        <circle cx="21" cy="21" r="9.5" fill="none" stroke={farbe} strokeWidth="1.2" />
        <circle cx="21" cy="21" r="1.4" fill={farbe} />
        {/* Vier Striche statt eines Kreuzes: Die Mitte bleibt frei, und man
            sieht, was genau dort liegt. */}
        <path d="M21 2v8M21 32v8M2 21h8M32 21h8" stroke={farbe} strokeWidth="1.2" />
      </svg>
      <div
        className="panel absolute left-1/2 top-[46px] -translate-x-1/2 whitespace-nowrap px-2 py-1 font-mono text-[10px]"
        style={{ color: farbe }}
      >
        {auskunft}
      </div>
    </div>
  );
}

/**
 * Die Werkzeugkiste am rechten Rand.
 *
 * **Warum rechts und nicht unten.** Unten links liegt das Steuerkreuz, unten
 * rechts der Ausgang, unten mittig der Auslöser — das ist die Hand. Der rechte
 * Rand ist der einzige Streifen, der frei bleibt, und er ist im Hochformat
 * wie im Querformat mit dem Daumen erreichbar, ohne dass die Hand über das
 * Bild wandert und dabei die Sicht auf das verdeckt, worauf gezielt wird.
 *
 * **Warum sie sich zuklappen lässt.** Ausgeklappt nimmt sie auf einem 10-Zoll-
 * Tablet etwa ein Sechstel der Bildbreite. Wer ein Werkzeug gewählt hat und
 * jetzt zehn Heizkörper in zehn Räumen setzt, braucht die Liste nicht mehr —
 * er braucht das Bild. Zugeklappt bleibt nur der gewählte Eintrag stehen,
 * damit niemand vergisst, was er in der Hand hält.
 */
function Werkzeugkiste({
  offen,
  aufZu,
  gewaehlt,
  waehle,
  anschluss,
  setzeAnschluss,
  ventilSeite,
  setzeVentilSeite,
}: {
  offen: boolean;
  aufZu: () => void;
  gewaehlt: Werkzeug | null;
  waehle: (w: Werkzeug) => void;
  anschluss: RadiatorConnection;
  setzeAnschluss: (a: RadiatorConnection) => void;
  ventilSeite: VentilSeite | null;
  setzeVentilSeite: (s: VentilSeite | null) => void;
}): JSX.Element {
  return (
    /*
      **Warum 64 px vom rechten Rand und nicht 12 wie überall sonst.**

      Am rechten Bildschirmrand sitzt der Griff, mit dem der Inspektor
      wieder aufgeht: fest verankert, auf halber Höhe, 44 px breit. Er
      gehört nicht zur 3D-Ansicht, liegt aber darüber. Mit dem üblichen
      Abstand von 12 px lagen die Einträge „Ventil" und „Durchbruch"
      genau darunter — sichtbar, aber am rechten Rand nicht mehr
      antippbar. Auf dem Bildschirm sah es aus wie ein Anzeigefehler; mit
      dem Finger war es einer.

      Aufgefallen ist es erst in der Abnahme am echten Gerät. Die
      Prüfumgebung ist breiter, dort überlappte nichts — deshalb prüft
      der Rauchtest seit dieser Fassung nicht mehr nur die Mitte eines
      Knopfes, sondern auch seinen rechten Rand.
    */
    <div className="absolute right-16 top-16 flex max-h-[calc(100%-9rem)] w-[10.5rem] flex-col gap-1">
      <button
        className="panel flex shrink-0 items-center justify-between px-2.5 text-[11px] text-slate-300 hover:text-slate-100"
        style={{ minHeight: 40 }}
        onClick={aufZu}
        title="Werkzeugkiste auf- und zuklappen"
      >
        <span>Werkzeug</span>
        <span className="text-slate-500">{offen ? '▾' : '▸'}</span>
      </button>

      {/*
        **Die Liste rollt, die Unterauswahl nicht.**

        Vorher rollte die ganze Kiste als ein Stück. Mit neun Werkzeugen à
        44 px füllt sie auf einem Tablet quer die Bildhöhe — und die
        Unterauswahl des Heizkörpers (Anschlussart, Ventilseite) stand
        darunter, also außerhalb: sichtbar erst nach dem Rollen, und wer
        nicht rollte, hielt sie für nicht vorhanden. Aufgefallen ist das,
        als das neunte Werkzeug dazukam; bis dahin passte es knapp, und
        „knapp" ist bei einer Bildhöhe, die von Gerät zu Gerät verschieden
        ist, dasselbe wie „zufällig".

        Jetzt rollt nur die Werkzeugliste. Was zum gewählten Werkzeug gehört,
        steht immer darunter und bleibt erreichbar — es ist das, was man
        beim Setzen tatsächlich braucht.

        `min-h-0` ist dabei kein Beiwerk: Ein Flex-Kind darf von sich aus
        nicht unter seine Inhaltsgröße schrumpfen, und ohne diese Zeile
        wüchse die Liste über den Rahmen hinaus, statt zu rollen.
      */}
      <div className="flex min-h-0 flex-col gap-1 overflow-y-auto">
        {(offen ? WERKZEUGE : WERKZEUGE.filter((w) => w.id === gewaehlt?.id)).map((w) => (
          <button
            key={w.id}
            className={`panel shrink-0 px-2.5 text-left text-[11px] ${
              gewaehlt?.id === w.id ? 'bg-accent/15 text-accent' : 'text-slate-300 hover:text-slate-100'
            }`}
            style={{ minHeight: 44 }}
            onClick={() => waehle(w)}
          >
            {w.label}
          </button>
        ))}
      </div>

      {/*
        Die Unterauswahl am Heizkörper.

        Sie steht hier und nicht erst im Inspektor, weil die Anschlussart
        genau dann bekannt ist, wenn man vor dem Heizkörper steht. Wer sie
        später nachtragen will, muss ein zweites Mal ins Haus — und trägt sie
        deshalb meistens gar nicht nach.

        Die Sicht ist festgelegt: **von vorn auf den Heizkörper**, aus dem
        Raum. Ohne diese Festlegung heißt „links" bei zwei Leuten zweierlei.
      */}
      {gewaehlt?.fixture === 'radiator' && (
        <div className="panel flex shrink-0 flex-col gap-1 p-1.5">
          <div className="px-1 text-[10px] text-slate-500">Anschluss</div>
          {ANSCHLUSS_AUSWAHL.map((a) => (
            <button
              key={a}
              className={`rounded px-1.5 text-left text-[10px] leading-tight ${
                anschluss === a ? 'bg-accent/15 text-accent' : 'text-slate-400 hover:text-slate-200'
              }`}
              style={{ minHeight: 34 }}
              onClick={() => setzeAnschluss(a)}
            >
              {RADIATOR_CONNECTION_LABELS[a]}
            </button>
          ))}
          <div className="mt-1 px-1 text-[10px] text-slate-500">Ventil · von vorn</div>
          <div className="flex gap-1">
            {VENTIL_AUSWAHL.map((v) => (
              <button
                key={v ?? 'offen'}
                className={`flex-1 rounded px-1 text-[10px] ${
                  ventilSeite === v ? 'bg-accent/15 text-accent' : 'text-slate-400 hover:text-slate-200'
                }`}
                style={{ minHeight: 34 }}
                title={v ? VENTILSEITE_LABELS[v] : 'Nicht erfasst — das ist etwas anderes als „rechts"'}
                onClick={() => setzeVentilSeite(v)}
              >
                {v === 'links' ? 'links' : v === 'rechts' ? 'rechts' : '—'}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
