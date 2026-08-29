/**
 * Zentraler Anwendungszustand (Zustand-Store).
 *
 * Aufteilung mit Absicht:
 *   • `doc`  — alles, was ins Projekt gehört und in die Historie einfließt
 *   • `ui`   — Werkzeug, Selektion, Viewport, Snapping: flüchtig, kein Undo
 *
 * Nur Mutationen an `doc` erzeugen einen Undo-Schritt. Das verhindert die
 * typische Frustration, bei der ein Undo den Zoom zurücksetzt statt die
 * letzte Wand zu entfernen.
 */

import { create } from 'zustand';
import type {
  AiAnalysisState,
  AiFloorplanAnalysis,
  BimDocument,
  BimNode,
  ClosureIssue,
  FloorplanImage,
  Layer,
  Level,
  Opening,
  Annotation,
  AnnotationKind,
  PipeRoutingMode,
  PipeRun,
  PipeService,
  PlantDefinition,
  PlantStorage,
  SchematicComponent,
  SchematicLink,
  HeatingCircuit,
  SchematicKind,
  RoofDefinition,
  RoofOpening,
  RoofOpeningKind,
  Room,
  RoomUsage,
  HeatPump,
  SiteElement,
  SiteElementKind,
  SolidElement,
  StorageKind,
  SolidKind,
  VerticalElement,
  VerticalKind,
  Construction,
  Fixture,
  FixtureCategory,
  FixtureType,
  OpeningTypePreset,
  Selection,
  SnapSettings,
  ToolId,
  TraceOpeningCandidate,
  TraceState,
  TraceWallCandidate,
  Vec2,
  ViewMode,
  CameraMode,
  Viewport,
  Wall,
  WallType,
} from '../types/bim';
import {
  ANNOTATION_LABELS,
  DEFAULT_CONSTRUCTIONS,
  FIXTURE_BY_TYPE,
  OPENING_PRESETS,
  PIPE_SERVICE_LABELS,
  ROOF_KIND_LABELS,
  ROOF_OPENING_LABELS,
  SITE_ELEMENT_LABELS,
  SOLID_LABELS,
  VERTICAL_LABELS,
} from '../types/bim';

/** Trassenlänge einer Polylinie [m]. */
export function pipeLength(points: readonly Vec2[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return total;
}

/**
 * Voreinstellung für ein neues Dach: Satteldach 38° mit 1,00 m Kniestock —
 * die in Deutschland häufigste Ausführung im Wohnungsbau.
 */
const DEFAULT_ROOF: RoofDefinition = {
  kind: 'gable',
  pitch: 38,
  kneeHeight: 1,
  azimuth: 90,
  ridgeOffset: 0,
  uValue: 0.2,
  gableUValue: 0.24,
};
import { EPS, closestPointOnSegment, distance, pointInPolygon, roundMm } from '../lib/geometry';
import {
  DEFAULT_EDGE_CLEARANCE,
  DEFAULT_LOOP_PATTERN,
  DEFAULT_OBSTACLE_CLEARANCE,
  FLOOR_OBSTACLE_TYPES,
  fixtureFootprint,
  measureLayableArea,
} from '../lib/floorLoopLayout';
import { copyLevelContents } from '../lib/levelCopy';
import { designFloorHeating } from '../lib/hydraulics';
import { estimateHeatLoad } from '../lib/heatLoadEstimate';
import {
  applyVerticalDeductions,
  detectRooms,
  isMassiveArea,
  diagnoseClosure,
  findOpenEnds,
  usageDefaults,
} from '../lib/roomDetection';
import { solidFootprint } from '../lib/verticalSymbols';
import { planPipeNetwork, type PipeLayoutResult } from '../lib/pipeLayout';
import { baseRoofHeightAt, buildRoofFrame, dormerSide } from '../lib/roofGeometry';
import { importIfc } from '../lib/ifcImport';
import { benenneGeschosse, erdgeschossIndex } from '../lib/levelGeometry';
import { emptyPlant, emptySite } from '../lib/plantDefaults';
import { ANBINDUNG_LABELS, schemaVorlage } from '../lib/schemaKatalog';
import { applyHostPatch as applyPatchToDocument } from '../lib/hostPatch';
import type { HostPatch, HostPatchReport } from '../lib/hostPatch';
import {
  DEFAULT_TEMPLATE_OPTIONS,
  ROOM_TEMPLATE_BY_KIND,
  polygonArea,
  templatePolygon,
  type RoomTemplateKind,
  type TemplateOptions,
} from '../lib/roomTemplates';

// ---------------------------------------------------------------------------
// IDs
// ---------------------------------------------------------------------------

let idCounter = 0;
const uid = (prefix: string): string => `${prefix}-${(idCounter++).toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_LAYERS: Layer[] = [
  { id: 'layer-walls', name: 'Wände', color: '#E2E8F0', visible: true, locked: false },
  { id: 'layer-openings', name: 'Öffnungen', color: '#38BDF8', visible: true, locked: false },
  { id: 'layer-rooms', name: 'Räume', color: '#2DD4BF', visible: true, locked: false },
  { id: 'layer-dimensions', name: 'Maßketten', color: '#94A3B8', visible: true, locked: false },
  { id: 'layer-heating', name: 'TGA · Heizung', color: '#F87171', visible: true, locked: false },
  { id: 'layer-sanitary', name: 'TGA · Sanitär', color: '#38BDF8', visible: true, locked: false },
  { id: 'layer-ventilation', name: 'TGA · Lüftung', color: '#34D399', visible: true, locked: false },
  { id: 'layer-image', name: 'Referenzbild', color: '#64748B', visible: true, locked: false },
];

/** Jedes Gewerk hat seine eigene Ebene — Pläne lassen sich gewerkeweise leeren. */
export const LAYER_BY_CATEGORY: Record<FixtureCategory, string> = {
  heating: 'layer-heating',
  sanitary: 'layer-sanitary',
  ventilation: 'layer-ventilation',
};

const DEFAULT_LEVEL: Level = {
  id: 'level-0',
  name: 'EG',
  order: 0,
  elevation: 0,
  height: 2.75,
  // Erdgeschoss auf Bodenplatte, darüber ein beheiztes Geschoss oder Dach:
  // beides lässt sich im Inspektor umstellen.
  floorUValue: 0.3,
  floorBoundary: 'ground',
  ceilingUValue: 0.2,
  ceilingBoundary: 'unheated',
};

/**
 * Welche Außenanlagen-Objekte sind Flächen, welche Züge, welche Punkte?
 * Aus dieser Zuordnung folgt, wie viele Klicks das Zeichnen braucht.
 */
const POLYGON_KINDS = new Set<SiteElementKind>(['boundary', 'collector', 'neighbour-building', 'paved']);
const LINE_KINDS = new Set<SiteElementKind>(['trench', 'utility-line']);

/** Vorbelegung je Art — die Werte, die in der Praxis am häufigsten stimmen. */
const SITE_DEFAULTS: Partial<Record<SiteElementKind, Partial<SiteElement>>> = {
  borehole: { depth: 100, label: 'Erdwärmesonde' },
  collector: { depth: 1.4, pipeSpacing: 0.6, label: 'Flächenkollektor' },
  trench: { depth: 1.5, label: 'Grabenkollektor' },
  'well-supply': { depth: 15, label: 'Förderbrunnen' },
  'well-injection': { depth: 15, label: 'Schluckbrunnen' },
  'hazard-opening': { radius: 0.4, label: 'Lichtschacht' },
  tree: { radius: 3, label: 'Baum' },
  'neighbour-building': { height: 7, label: 'Nachbargebäude' },
  'immission-point': { label: 'Immissionsort' },
  'utility-line': { depth: 1, utility: 'water', label: 'Leitung' },
};

function emptyDocument(): BimDocument {
  const now = new Date().toISOString();
  return {
    meta: {
      name: 'Neues Projekt',
      createdAt: now,
      modifiedAt: now,
      northAngle: 0,
      designOutdoorTemperature: -12,
      designIndoorTemperature: 20,
      n50: 3,
      shielding: 'moderate',
      unheatedTemperature: 10,
      groundTemperature: 10,
      // 0,10 W/(m²·K) ist der Zuschlag ohne Nachweis nach DIN 4108 Beiblatt 2 —
      // die sichere Seite, solange niemand die Anschlüsse betrachtet hat.
      thermalBridgeSupplement: 0.1,
      thermalBridgeMethod: 'flat',
      thermalBridgeCategory: 'none',
      // In Deutschland ist der Wiederaufheizfaktor national auf 0 gesetzt.
      reheatFactor: 0,
    },
    site: emptySite(),
    plant: emptyPlant(),
    levels: { [DEFAULT_LEVEL.id]: { ...DEFAULT_LEVEL } },
    layers: Object.fromEntries(DEFAULT_LAYERS.map((l) => [l.id, l])),
    constructions: Object.fromEntries(DEFAULT_CONSTRUCTIONS.map((c) => [c.id, c])),
    nodes: {},
    walls: {},
    openings: {},
    fixtures: {},
    verticals: {},
    solids: {},
    pipes: {},
    annotations: {},
    roofOpenings: {},
    rooms: {},
    diagnostics: { openEnds: [] },
    activeLevelId: DEFAULT_LEVEL.id,
  };
}

const DEFAULT_SNAP: SnapSettings = {
  grid: true,
  gridSize: 0.25,
  nodes: true,
  walls: true,
  angle: true,
  angleStep: 45,
  pixelTolerance: 12,
};

/**
 * Inhalt der Zwischenablage. Kopiert wird eine *geschlossene* Teilmenge:
 * Wände samt ihrer Knoten und Öffnungen, dazu freistehende TGA-Objekte.
 * Die Koordinaten sind relativ zum Bezugspunkt, damit sich derselbe Inhalt
 * an beliebiger Stelle und in beliebigem Geschoss einfügen lässt.
 */
export interface ClipboardContent {
  origin: Vec2;
  nodes: BimNode[];
  walls: Wall[];
  openings: Opening[];
  fixtures: Fixture[];
}

// ---------------------------------------------------------------------------
// Store-Form
// ---------------------------------------------------------------------------

/**
 * Ergebnis einer Sammelauslegung — was belegt wurde und was nicht.
 *
 * Die zweite Liste ist die wichtigere. „Alles auslegen" heißt nicht „alles
 * bekommt eine Fußbodenheizung": ein unbeheizter Abstellraum bekommt keine,
 * ein Raum mit Heizkörper auch nicht, und ein Raum, in dem nach Randabstand
 * und Einbauten nichts übrig bleibt, ebenfalls nicht. Jeder dieser Fälle ist
 * ein richtiges Ergebnis — aber nur, wenn er benannt wird. Ein stillschweigend
 * ausgelassener Raum sieht im Plan aus wie ein vergessener.
 */
export interface FloorLoopBatchSkip {
  roomId: string;
  room: string;
  reason: string;
}

export interface FloorLoopBatchResult {
  roomId: string;
  room: string;
  /** Belegbare Fläche [m²] nach Randabstand und Einbauten. */
  area: number;
  loops: number;
  /** Ausgelegte Leistung [W]. */
  powerW: number;
}

export interface FloorLoopBatchReport {
  /** Geschoss, auf das sich der Bericht bezieht. */
  levelId: string;
  laid: FloorLoopBatchResult[];
  skipped: FloorLoopBatchSkip[];
  /** Stand ein Heizkreisverteiler im Geschoss? */
  manifold: boolean;
}

export interface WallDefaults {
  thickness: number;
  height: number;
  type: WallType;
  uValue: number;
}

export interface OpeningDefaults {
  doorWidth: number;
  doorHeight: number;
  windowWidth: number;
  windowHeight: number;
  windowSill: number;
}

interface BimState {
  doc: BimDocument;
  past: BimDocument[];
  future: BimDocument[];

  tool: ToolId;
  viewMode: ViewMode;
  cameraMode: CameraMode;
  selection: Selection | null;
  /** Mehrfachauswahl. `selection` ist immer das zuletzt gefasste Objekt. */
  selections: Selection[];
  /** Zwischenablage für Kopieren/Einfügen (geschossübergreifend). */
  clipboard: ClipboardContent | null;
  hover: Selection | null;
  viewport: Viewport;
  snap: SnapSettings;
  showDimensions: boolean;
  /** Dachlinien im Grundriss: First, Traufe und die Höhenlinien nach WoFlV. */
  showRoofLines: boolean;
  /** Aktive Leitungsart für das Rohr-Werkzeug. */
  pipeService: PipeService;
  /** Gewählte Raumvorlage für das Werkzeug „Raum aufziehen". */
  roomTemplate: RoomTemplateKind;
  /** Feineinstellung der Vorlage — Aussparung, Drehung, Segmentzahl. */
  roomTemplateOptions: TemplateOptions;
  /** Aktive Bauart für das Treppen-/Schacht-Werkzeug. */
  verticalKind: VerticalKind;
  /** Welche Art massives Bauteil das Werkzeug setzt. */
  solidKind: SolidKind;
  /** Aktive Art für das Beschriftungs-Werkzeug. */
  annotationKind: AnnotationKind;
  /** Aktive Art für das Außenanlagen-Werkzeug. */
  siteKind: SiteElementKind;
  showRoomLabels: boolean;
  /**
   * Bedienmodus. `einfach` blendet alles aus, was für die Aufnahme eines
   * Gebäudes nicht gebraucht wird — die Fachplaner-Reiter, die selteneren
   * Werkzeuge, die Kürzel. Wer das Werkzeug zum ersten Mal öffnet, soll
   * nicht zwischen zehn Reitern suchen müssen, welcher gemeint ist.
   */
  uiMode: 'einfach' | 'profi';
  /** Warnpunkte an nicht angeschlossenen Wandenden einblenden. */
  showDiagnostics: boolean;
  /** Ausrichtungs-Hilfslinien beim Zeichnen. */
  showGuides: boolean;
  /** Ortho-Zwang: nur 0/90° — verhindert versehentlich schräge Wände. */
  orthoLock: boolean;
  /** Aktive Öffnungs-Vorlage für Fenster/Tür/Durchgang. */
  openingPreset: OpeningTypePreset;
  /** Für das Platzieren scharf geschaltetes TGA-Symbol. */
  activeFixture: FixtureType;
  wallDefaults: WallDefaults;
  openingDefaults: OpeningDefaults;
  aiState: AiAnalysisState;
  statusMessage: string;
  /** Auto-Trace-Vorschau — bewusst außerhalb von `doc` (kein Undo-Rauschen). */
  trace: TraceState | null;

  // --- UI ----------------------------------------------------------------
  setTool: (tool: ToolId) => void;
  setViewMode: (mode: ViewMode) => void;
  setCameraMode: (mode: CameraMode) => void;
  setSelection: (sel: Selection | null) => void;
  setSelections: (sels: Selection[]) => void;
  toggleSelection: (sel: Selection) => void;
  selectInBox: (min: Vec2, max: Vec2, additive: boolean) => void;
  selectAll: () => void;
  setHover: (sel: Selection | null) => void;
  setViewport: (vp: Partial<Viewport>) => void;
  setSnap: (patch: Partial<SnapSettings>) => void;
  toggleDimensions: () => void;
  toggleRoofLines: () => void;
  setPipeService: (service: PipeService) => void;
  setRoomTemplate: (kind: RoomTemplateKind) => void;
  setRoomTemplateOptions: (patch: Partial<TemplateOptions>) => void;
  setVerticalKind: (kind: VerticalKind) => void;
  setSolidKind: (kind: SolidKind) => void;
  setAnnotationKind: (kind: AnnotationKind) => void;
  toggleRoomLabels: () => void;
  setUiMode: (mode: 'einfach' | 'profi') => void;
  toggleDiagnostics: () => void;
  toggleGuides: () => void;
  setOrthoLock: (value: boolean) => void;
  setOpeningPreset: (preset: OpeningTypePreset) => void;
  setActiveFixture: (type: FixtureType) => void;
  setWallDefaults: (patch: Partial<WallDefaults>) => void;
  setOpeningDefaults: (patch: Partial<OpeningDefaults>) => void;
  setStatus: (message: string) => void;
  setAiState: (state: AiAnalysisState) => void;

  // --- Dokument ----------------------------------------------------------
  addWall: (start: Vec2, end: Vec2, options?: Partial<Wall>) => Wall | null;
  updateWall: (id: string, patch: Partial<Wall>) => void;
  moveNode: (id: string, position: Vec2) => void;
  addOpening: (opening: Omit<Opening, 'id'>) => Opening | null;
  updateOpening: (id: string, patch: Partial<Opening>) => void;
  updateRoom: (id: string, patch: Partial<Room>) => void;
  splitWallAt: (wallId: string, point: Vec2) => void;
  /** Eine Raumvorlage als Wandzug anlegen — vier bis sechzehn Wände in einem Schritt. */
  addRoomTemplate: (
    kind: RoomTemplateKind,
    from: Vec2,
    to: Vec2,
    options?: Partial<TemplateOptions> & { usage?: RoomUsage; name?: string },
  ) => { walls: number; area: number } | null;
  /** Einen ganzen Raum samt Wänden, Öffnungen und TGA-Objekten duplizieren. */
  duplicateRoom: (roomId: string, offset?: Vec2) => { walls: number; fixtures: number } | null;
  /** Einen Raum in die Zwischenablage legen — ohne ihn sofort einzufügen. */
  copyRoom: (roomId: string) => boolean;
  addFixture: (type: FixtureType, position: Vec2, options?: Partial<Fixture>) => Fixture | null;
  /**
   * Fußbodenheizung eines Raums an- oder abschalten.
   *
   * Ein Klick belegt die ganze Raumfläche, der nächste räumt sie wieder weg.
   * Gespeichert wird nur das Ergebnis der Auslegung — Verlegeabstand,
   * Kreiszahl, Leistung, Randabstand; die Verlegekurve selbst nicht: sie ist
   * aus dem Raumpolygon ableitbar und muss sich beim Verschieben einer Wand
   * neu ergeben.
   */
  toggleFloorLoopArea: (roomId: string) => 'angelegt' | 'entfernt' | null;
  /**
   * Alle beheizten Räume eines Geschosses in einem Schritt auslegen.
   *
   * Der Bericht ist Teil der Funktion, nicht Beiwerk: eine Sammelaktion, die
   * stillschweigend Räume auslässt, ist gefährlicher als gar keine. Wer sie
   * auslöst, muss hinterher lesen können, welcher Raum warum leer geblieben
   * ist — ein unbeheizter Technikraum ist ein richtiges Ergebnis, ein
   * übersehenes Wohnzimmer ein Fehler, und im Plan sehen beide gleich aus.
   *
   * @param levelId Geschoss; ohne Angabe das aktive.
   */
  layAllFloorLoops: (levelId?: string) => FloorLoopBatchReport;
  updateFixture: (id: string, patch: Partial<Fixture>) => void;
  moveFixture: (id: string, position: Vec2) => void;
  updateMeta: (patch: Partial<BimDocument['meta']>) => void;
  updateLevel: (id: string, patch: Partial<Level>) => void;
  /** Dach über einem Geschoss anlegen oder ändern. `null` entfernt es. */
  setRoof: (levelId: string, patch: Partial<RoofDefinition> | null) => void;

  // --- Treppen, Schächte, Rohrnetz ---------------------------------------
  addVertical: (kind: VerticalKind, position: Vec2) => VerticalElement;
  updateVertical: (id: string, patch: Partial<VerticalElement>) => void;
  addSolid: (kind: SolidKind, position: Vec2) => SolidElement;
  /**
   * Einen erkannten Raum in ein massives Bauteil verwandeln.
   *
   * Der Fall aus der Praxis: zwischen vier Wandstücken erkennt das Programm
   * eine Fläche und nennt sie „Raum 3" — tatsächlich steht dort der Kaminzug.
   * Statt die Wände umzuzeichnen, wird der Umriss dieser Fläche zum Umriss
   * des Bauteils. Der Raum bleibt bestehen (er ist ein Ergebnis der Wände und
   * lässt sich nicht löschen), trägt aber ab sofort massive Fläche und
   * verschwindet aus dem Plan hinter der Schraffur.
   */
  solidFromRoom: (roomId: string, kind: SolidKind) => SolidElement | null;
  updateSolid: (id: string, patch: Partial<SolidElement>) => void;
  addPipe: (service: PipeService, points: Vec2[]) => PipeRun | null;
  /**
   * Das Rohrnetz des aktiven Geschosses automatisch auslegen.
   *
   * Ersetzt **nur** die erzeugten Abschnitte und Armaturen; von Hand gezogene
   * Leitungen bleiben stehen. Wer eine Trasse selbst gelegt hat, hat sich
   * etwas dabei gedacht — das darf ein Knopf nicht wegwischen.
   */
  legeRohrnetzAus: (mode: PipeRoutingMode) => PipeLayoutResult;
  updatePipe: (id: string, patch: Partial<PipeRun>) => void;
  addAnnotation: (kind: AnnotationKind, points: Vec2[], text?: string) => Annotation | null;
  setSiteKind: (kind: SiteElementKind) => void;
  addSiteElement: (kind: SiteElementKind, points: Vec2[]) => SiteElement | null;
  updateSiteElement: (id: string, patch: Partial<SiteElement>) => void;
  addHeatPump: (position: Vec2) => HeatPump | null;
  updateHeatPump: (id: string, patch: Partial<HeatPump>) => void;
  updateSite: (patch: Partial<BimDocument['site']>) => void;
  /** Anlagenblatt ändern — flach oder in einem der Unterabschnitte. */
  updatePlant: (patch: {
    generatorModelId?: string;
    pumpId?: string;
    heatLoadOverride?: number;
    design?: Partial<PlantDefinition['design']>;
    safety?: Partial<PlantDefinition['safety']>;
    dhw?: Partial<PlantDefinition['dhw']>;
    /**
     * Zweiter Wärmeerzeuger, Kaskade, Kühlung, weiterer Verbraucher.
     *
     * Die vier Angaben werden **ganz** gesetzt und nicht zusammengemischt:
     * ein halber zweiter Wärmeerzeuger — Bivalenzpunkt ohne Betriebsweise —
     * ist keine Anlage, sondern eine Fehlerquelle. `undefined` ausdrücklich
     * zu übergeben löscht die Angabe wieder; deshalb wird unten mit
     * `'x' in patch` geprüft und nicht mit `??`.
     */
    secondGenerator?: PlantDefinition['secondGenerator'];
    cascade?: PlantDefinition['cascade'];
    cooling?: PlantDefinition['cooling'];
    additionalConsumer?: PlantDefinition['additionalConsumer'];
  }) => void;
  /** Einen vorgeschlagenen Speicher übernehmen. */
  addPlantStorage: (storage: PlantStorage) => void;
  removePlantStorage: (id: string) => void;
  /** Heizkreise aus der Auslegung ins Modell schreiben. */
  setPlantCircuits: (circuits: HeatingCircuit[]) => void;
  /** Das erzeugte Anlagenschema übernehmen. */
  setSchematic: (
    components: SchematicComponent[],
    links: SchematicLink[],
    manual?: boolean,
    vorlageId?: string,
  ) => void;
  /**
   * Eine Schemavorlage aus dem Katalog übernehmen.
   *
   * Das ist mehr als ein Bild: die Vorlage legt die **Anbindung** fest
   * (direkt, Reihenpuffer, Parallelpuffer, Weiche) und damit einen Speicher.
   * Wer „Parallelpuffer mit zwei Heizkreisen" wählt, will nicht nur die
   * Zeichnung, sondern die Anlage dazu. Der Speicher wird deshalb im
   * Anlagenblatt gesetzt, und erst danach wird gezeichnet — sonst zeigte das
   * Schema etwas, das die Auslegung nicht kennt.
   *
   * Gibt `false` zurück, wenn die Kennung unbekannt ist.
   */
  uebernehmeSchemaVorlage: (vorlageId: string) => boolean;
  /** Ein Bauteil im Schema ändern — Lage, Beschriftung, technische Angabe. */
  updateSchematicComponent: (id: string, patch: Partial<SchematicComponent>) => void;
  /** Ein Bauteil ergänzen; es gilt danach als von Hand bearbeitet. */
  addSchematicComponent: (kind: SchematicKind, x: number, y: number, label?: string) => SchematicComponent;
  /** Ein Bauteil samt seiner Verbindungen entfernen. */
  deleteSchematicComponent: (id: string) => void;
  /** Zwei Bauteile verbinden. */
  addSchematicLink: (from: string, to: string, service: PipeService, label?: string) => SchematicLink | null;
  deleteSchematicLink: (id: string) => void;
  updateAnnotation: (id: string, patch: Partial<Annotation>) => void;
  addRoofOpening: (kind: RoofOpeningKind, position?: Vec2) => RoofOpening | null;
  updateRoofOpening: (id: string, patch: Partial<RoofOpening>) => void;

  // --- Geschosse ---------------------------------------------------------
  /**
   * Legt ein Geschoss an — voreingestellt oben, mit `below: true` unten.
   * Rückgabe ist das angelegte Geschoss oder `null`, wenn nichts entstand.
   */
  addLevel: (options?: { copyFrom?: string; name?: string; below?: boolean }) => Level | null;
  deleteLevel: (id: string) => void;
  setActiveLevel: (id: string) => void;

  // --- Bauteilkatalog ----------------------------------------------------
  addConstruction: (construction: Omit<Construction, 'id'>) => Construction;
  updateConstruction: (id: string, patch: Partial<Construction>) => void;
  deleteConstruction: (id: string) => void;
  assignConstruction: (targets: Selection[], constructionId: string) => void;

  // --- Gruppenoperationen ------------------------------------------------
  copySelection: () => void;
  pasteClipboard: (offset?: Vec2) => void;
  moveSelection: (delta: Vec2) => void;
  mirrorSelection: (axis: 'x' | 'y') => void;
  arraySelection: (count: number, delta: Vec2) => void;
  toggleLayer: (id: string) => void;
  deleteSelection: () => void;
  clearAll: () => void;
  loadDemo: () => void;
  /**
   * Leeres Dokument unter einem Namen — die Grundlage eines neuen
   * Projekts. `clearAll` reicht dafür nicht: es räumt die Geometrie ab,
   * lässt aber Geschosse, Bauteilkatalog und Anlagentechnik des alten
   * Projekts stehen. Wer „neues Projekt" sagt, meint ein leeres Blatt.
   * Rückgabe ist das erzeugte Dokument, damit der Aufrufer es ablegen
   * kann, ohne auf den nächsten Store-Durchlauf zu warten.
   */
  neuesDokument: (name: string) => BimDocument;
  /** Projektdatei (RaVia-Export) verlustfrei zurücklesen. */
  loadProject: (data: unknown) => { ok: boolean; message: string };
  /** IFC4-Datei als neues Projekt einlesen. */
  loadIfc: (text: string) => { ok: boolean; message: string };
  /** Dokument direkt ersetzen — für die Wiederherstellung aus dem Autosave. */
  replaceDocument: (doc: BimDocument, message?: string) => void;
  /**
   * Schreibvorgang der Gegenstelle anwenden (Einbettung, Rückweg aus RaVia).
   *
   * Er läuft durch dieselbe Historie wie jede Handbewegung: Strg+Z nimmt ihn
   * zurück. Das ist die Bedingung dafür, dass ein zweites Programm überhaupt
   * schreiben darf — der Mensch am Bildschirm behält das letzte Wort.
   */
  applyHostPatch: (patch: HostPatch) => HostPatchReport;

  // --- Referenzbild ------------------------------------------------------
  setImage: (image: FloorplanImage | undefined) => void;
  updateImage: (patch: Partial<FloorplanImage>) => void;
  moveImage: (delta: Vec2) => void;
  applyCalibration: (from: Vec2, to: Vec2, realLength: number) => void;

  // --- Auto-Trace --------------------------------------------------------
  buildTrace: (analysis: AiFloorplanAnalysis) => void;
  setTraceVisible: (visible: boolean) => void;
  setTraceMinConfidence: (value: number) => void;
  rejectTraceCandidate: (id: string) => void;
  restoreTraceCandidate: (id: string) => void;
  acceptTrace: () => void;
  clearTrace: () => void;

  // --- Historie ----------------------------------------------------------
  /**
   * Klammert eine zusammenhängende Geste — typisch das Ziehen mit der Maus.
   *
   * Ohne die Klammer legt jede einzelne Mausbewegung einen Historieneintrag
   * an; ein Zug über den halben Plan wären dann zwei Dutzend Schritte, und
   * Strg+Z holte das Objekt um ein Pixel zurück statt an seinen Ausgangsort.
   * Zwischen `beginGesture` und `endGesture` wird deshalb nur der Stand
   * *vor* der Geste abgelegt.
   */
  beginGesture: () => void;
  endGesture: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

// ---------------------------------------------------------------------------
// Hilfsfunktionen auf dem Dokument
// ---------------------------------------------------------------------------

/**
 * Flache Kopie mit neuen Entity-Maps — günstig und React-freundlich.
 *
 * „React-freundlich" heißt: *jede* Sammlung, in die eine Mutation
 * hineinschreibt, bekommt hier eine neue Identität. Wird eine vergessen,
 * bricht gleich zweierlei, und beides sieht nicht nach demselben Fehler aus:
 *
 *  1. Die Oberfläche merkt nichts. Ein `useMemo`, das an dieser Sammlung
 *     hängt, rechnet nicht neu und liefert weiter den alten Stand — das
 *     Objekt ist im Modell, aber nicht im Plan.
 *  2. Die Historie wird unbrauchbar. `past` legt das *alte* Dokument ab; teilt
 *     es die Sammlung mit dem neuen, schreibt die Mutation rückwärts in die
 *     Vergangenheit, und Rückgängig führt zurück auf denselben Stand.
 *
 * Genau das ist mit `site` passiert: Außenanlage und Wärmepumpe wurden über
 * `doc.site.pumps[id] = …` verändert, während `site` hier nur als Referenz aus
 * `...doc` durchgereicht wurde.
 *
 * `plant` steht bewusst nicht in der Liste: die Anlagentechnik wird
 * ausnahmslos als Ganzes ersetzt (`doc.plant = { ...doc.plant, … }`), damit
 * genügt die Referenzkopie aus `...doc`. Wer das ändert, muss `plant` hier
 * nachziehen.
 */
function cloneDoc(doc: BimDocument): BimDocument {
  return {
    ...doc,
    meta: { ...doc.meta },
    levels: { ...doc.levels },
    layers: { ...doc.layers },
    constructions: { ...doc.constructions },
    nodes: { ...doc.nodes },
    walls: { ...doc.walls },
    openings: { ...doc.openings },
    fixtures: { ...doc.fixtures },
    verticals: { ...(doc.verticals ?? {}) },
    solids: { ...(doc.solids ?? {}) },
    pipes: { ...(doc.pipes ?? {}) },
    annotations: { ...(doc.annotations ?? {}) },
    roofOpenings: { ...(doc.roofOpenings ?? {}) },
    rooms: { ...doc.rooms },
    site: { ...doc.site, elements: { ...doc.site.elements }, pumps: { ...doc.site.pumps } },
    diagnostics: { openEnds: doc.diagnostics.openEnds, closure: doc.diagnostics.closure },
    image: doc.image ? { ...doc.image } : undefined,
  };
}

/** Sucht einen Knoten im Toleranzradius oder legt einen neuen an. */
function nodeAt(doc: BimDocument, p: Vec2, tolerance = 0.02, levelId?: string): BimNode {
  const level = levelId ?? doc.activeLevelId;
  let best: BimNode | undefined;
  let bestDist = tolerance;
  for (const node of Object.values(doc.nodes)) {
    // Knoten werden nur innerhalb desselben Geschosses verschmolzen —
    // sonst würde eine Wand im OG an einer Wand im EG hängen bleiben.
    if (node.levelId !== level) continue;
    const d = distance(node, p);
    if (d < bestDist) {
      bestDist = d;
      best = node;
    }
  }
  if (best) return best;
  const created: BimNode = { id: uid('n'), x: roundMm(p.x), y: roundMm(p.y), levelId: level };
  doc.nodes[created.id] = created;
  return created;
}

/**
 * Teilt jede Wand, die durch den Knoten hindurchläuft, an genau dieser Stelle.
 *
 * Das ist der Unterschied zwischen „sieht aus wie ein T-Stoß" und „ist ein
 * T-Stoß": ohne diesen Schritt bleibt die durchlaufende Wand eine einzige
 * Kante, der Raum dahinter ist topologisch offen und wird nicht erkannt.
 * Wir erledigen das direkt beim Zeichnen — nicht erst als Reparatur.
 */
function splitWallsAtNode(doc: BimDocument, node: BimNode, tolerance = 0.02): void {
  for (const wall of Object.values(doc.walls)) {
    if (wall.a === node.id || wall.b === node.id) continue;
    if (wall.levelId !== node.levelId) continue;
    const a = doc.nodes[wall.a];
    const b = doc.nodes[wall.b];
    if (!a || !b) continue;

    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const lenSq = abx * abx + aby * aby;
    if (lenSq < EPS) continue;
    const t = ((node.x - a.x) * abx + (node.y - a.y) * aby) / lenSq;
    if (t <= 0.001 || t >= 0.999) continue;

    const px = a.x + abx * t;
    const py = a.y + aby * t;
    if (Math.hypot(px - node.x, py - node.y) > tolerance) continue;

    const len = Math.sqrt(lenSq);
    const splitDistance = t * len;
    const second: Wall = { ...wall, id: uid('w'), a: node.id, b: wall.b };
    doc.walls[wall.id] = { ...wall, b: node.id };
    doc.walls[second.id] = second;

    for (const op of Object.values(doc.openings)) {
      if (op.wallId !== wall.id) continue;
      if (op.distance > splitDistance) {
        doc.openings[op.id] = {
          ...op,
          wallId: second.id,
          distance: roundMm(op.distance - splitDistance),
        };
      }
    }
  }
}

/** Entfernt Knoten ohne angeschlossene Wand. */
function pruneNodes(doc: BimDocument): void {
  const used = new Set<string>();
  for (const w of Object.values(doc.walls)) {
    used.add(w.a);
    used.add(w.b);
  }
  for (const id of Object.keys(doc.nodes)) {
    if (!used.has(id)) delete doc.nodes[id];
  }
}

/**
 * Raumerkennung neu ausführen — für **jedes** Geschoss getrennt.
 *
 * Getrennt deshalb, weil Wände verschiedener Geschosse übereinander liegen:
 * würde man sie gemeinsam planarisieren, entstünden Schnittpunkte zwischen
 * Bauteilen, die einander nie berühren.
 */
/**
 * Übernimmt die Raumangaben eines Geschosses auf ein deckungsgleich kopiertes.
 *
 * Ohne diesen Schritt hieße jeder Raum im neuen Geschoss wieder „Raum 1" und
 * stünde auf 20 °C — man müsste ein Bad, das an derselben Stelle liegt, ein
 * zweites Mal von Hand beschreiben. Zugeordnet wird über den Schwerpunkt: die
 * Kopie ist geometrisch identisch, daher ist die Zuordnung eindeutig.
 */
function transferRoomProperties(doc: BimDocument, fromLevelId: string, toLevelId: string): void {
  const key = (r: Room) => `${r.centroid.x.toFixed(3)}|${r.centroid.y.toFixed(3)}`;
  const source = new Map<string, Room>();
  for (const r of Object.values(doc.rooms)) {
    if (r.levelId === fromLevelId) source.set(key(r), r);
  }
  if (!source.size) return;

  for (const r of Object.values(doc.rooms)) {
    if (r.levelId !== toLevelId) continue;
    const origin = source.get(key(r));
    if (!origin) continue;
    doc.rooms[r.id] = {
      ...r,
      name: origin.name,
      usage: origin.usage,
      setpointTemperature: origin.setpointTemperature,
      airChangeRate: origin.airChangeRate,
      isHeated: origin.isHeated,
      heightOverride: origin.heightOverride,
    };
  }
}

function recomputeRooms(doc: BimDocument): void {
  const previousAll = Object.values(doc.rooms);
  const allWalls = Object.values(doc.walls);
  const allOpenings = Object.values(doc.openings);
  const rooms: Room[] = [];
  const openEnds: Vec2[] = [];
  // Topologie-Befunde nur des sichtbaren Geschosses — genau wie `openEnds`.
  // Sie werden im Plan gezeichnet, und der Plan zeigt ein Geschoss.
  const closure: ClosureIssue[] = [];

  for (const level of Object.values(doc.levels)) {
    const walls = allWalls.filter((w) => w.levelId === level.id);
    if (!walls.length) continue;
    const wallIds = new Set(walls.map((w) => w.id));
    const openings = allOpenings.filter((o) => wallIds.has(o.wallId));

    rooms.push(
      ...detectRooms({
        walls,
        nodes: doc.nodes,
        openings,
        levelId: level.id,
        defaultHeight: level.height,
        northAngle: doc.meta.northAngle,
        previous: previousAll.filter((r) => r.levelId === level.id),
        roof: level.roof,
        roofOpenings: Object.values(doc.roofOpenings ?? {}).filter((o) => o.levelId === level.id),
      }),
    );
    if (level.id === doc.activeLevelId) {
      openEnds.push(...findOpenEnds(walls, doc.nodes));
      closure.push(...diagnoseClosure({ walls, nodes: doc.nodes }));
    }
  }

  // Treppen und Schächte belegen Grundfläche und nehmen — wenn sie offen
  // sind — die Decke darüber weg. Massive Bauteile belegen dieselbe
  // Grundfläche, lassen die Decke aber stehen.
  applyVerticalDeductions(
    rooms,
    Object.values(doc.verticals ?? {}),
    Object.values(doc.levels)
      .sort((a, b) => a.order - b.order)
      .map((l) => l.id),
    Object.values(doc.solids ?? {}),
  );

  /*
   * Eine Fläche, die zu vier Fünfteln Mauerwerk ist, hört auf, ein Raum zu
   * sein.
   *
   * Das ist der Abschluss von „Fläche ist kein Raum, sondern massiv": der
   * Anwender erklärt den Kaminzug zum massiven Bauteil, und danach darf die
   * Fläche keine Heizlast, kein Luftvolumen, keine Fußbodenheizung und keinen
   * Raumstempel mehr tragen. Sie verschwindet nicht — an ihrer Stelle steht
   * das Bauteil mit seiner Schraffur. Wer das Bauteil wieder löscht, bekommt
   * beim nächsten Rechnen seinen Raum zurück.
   */
  const echteRaeume = rooms.filter((r) => !isMassiveArea(r));
  doc.rooms = Object.fromEntries(echteRaeume.map((r) => [r.id, r]));
  doc.diagnostics = { openEnds, closure };

  // TGA-Objekte ihrem Raum zuordnen — abgeleitet, nie manuell gepflegt.
  for (const fixture of Object.values(doc.fixtures)) {
    const room = echteRaeume.find(
      (r) =>
        r.levelId === fixture.levelId &&
        r.innerPolygon.length >= 3 &&
        pointInPolygon(fixture.position, r.innerPolygon),
    );
    if (fixture.roomId !== room?.id) {
      doc.fixtures[fixture.id] = { ...fixture, roomId: room?.id };
    }
  }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

/**
 * Einen Raum belegen — die eine Stelle, an der eine Fußbodenheizung entsteht.
 *
 * Sie wird von zwei Aufrufern gebraucht: vom Klick in einen einzelnen Raum
 * und von der Sammelauslegung. Beide müssen dieselbe Auslegung bekommen,
 * sonst hängt das Ergebnis davon ab, wie man es ausgelöst hat. Deshalb steht
 * die Auslegung hier und nicht zweimal in den Aktionen.
 *
 * Bewusst kein `set` und keine Statusmeldung: was auf dem Bildschirm steht,
 * entscheidet der Aufrufer — bei einem Raum ist es die Auslegung, bei zehn
 * Räumen die Bilanz.
 *
 * @returns Kennwerte des angelegten Objekts, oder `null`, wenn im Raum nach
 *   Randabstand und Einbauten nichts belegbar bleibt.
 */
/**
 * Die massiven Bauteile, die in einem Raum stehen — auch die, die nur
 * hindurchlaufen.
 *
 * Ein Schornstein steht im Erdgeschoss am Kamin und durchstößt jede Decke
 * darüber. Im Obergeschoss ist er trotzdem Mauerwerk im Raum: er nimmt dort
 * Fläche weg und die Fußbodenheizung muss ihn aussparen. Genau diese Frage
 * beantwortet die Funktion, und zwar an einer Stelle statt an dreien.
 */
function massiveInRoom(doc: BimDocument, room: Room): SolidElement[] {
  const order = Object.values(doc.levels).sort((a, b) => a.order - b.order);
  const rank = new Map(order.map((l, i) => [l.id, i]));
  const here = rank.get(room.levelId);
  return Object.values(doc.solids ?? {}).filter((b) => {
    const from = rank.get(b.levelId);
    const reaches =
      b.levelId === room.levelId ||
      (b.throughAllLevels && from !== undefined && here !== undefined && here > from);
    return reaches && room.innerPolygon.length >= 3 && pointInPolygon(b.position, room.innerPolygon);
  });
}

function belegeRaum(get: () => BimState, roomId: string): FloorLoopBatchResult | null {
  const doc = get().doc;
  const room = doc.rooms[roomId];
  if (!room || room.innerPolygon.length < 3) return null;

  /**
   * Unter fest eingebauten Objekten wird nicht verlegt. Welche das sind,
   * entscheidet die Planungsregel im Rechenkern — hier wird nur eingesammelt,
   * was in diesem Raum steht.
   */
  const einbauten = Object.values(doc.fixtures)
    .filter((f) => f.levelId === room.levelId && FLOOR_OBSTACLE_TYPES.has(f.type))
    .filter((f) => pointInPolygon(f.position, room.innerPolygon))
    .map((f) => fixtureFootprint(f));

  /**
   * Massive Bauteile sind immer Aussparung — ein Kamin steht auf dem Estrich,
   * kein Rohr geht durch ihn hindurch. Sie stehen deshalb nicht in
   * `FLOOR_OBSTACLE_TYPES`, sondern kommen ausnahmslos dazu; die Liste
   * unterscheidet Einbauten, die auf dem Boden stehen, von solchen, die an
   * der Wand hängen — bei Mauerwerk gibt es diese Frage nicht.
   */
  const massiv = massiveInRoom(doc, room).map(solidFootprint);

  const spacing = 0.15;
  const belegbar = measureLayableArea(room.innerPolygon, {
    spacing,
    edgeClearance: DEFAULT_EDGE_CLEARANCE,
    obstacles: [...einbauten, ...massiv],
    obstacleClearance: DEFAULT_OBSTACLE_CLEARANCE,
  });
  if (belegbar <= 0) return null;

  /**
   * Die Raumheizlast ist die bessere Grundlage als die Vorbelegung des
   * Rechenkerns: mit ihr kommt die Wärmestromdichte aus dem Bedarf und
   * nicht aus einer Annahme. Vorrang hat die gerechnete Norm-Heizlast,
   * sonst der Überschlag dieses Programms.
   */
  const last = estimateHeatLoad(doc).rooms.find((r) => r.roomId === roomId);
  const watt = last ? (last.normHeatLoad ? last.normHeatLoad.total : last.total) : undefined;
  const design = designFloorHeating(belegbar, {
    spacing,
    load: watt,
    flowTemperature: 35,
    returnTemperature: 28,
  });

  const erstellt = get().addFixture('underfloor', room.centroid, {
    roomId: room.id,
    // Das Objekt steht für die ganze Raumfläche; als Griff für die Auswahl
    // reicht ein kleines Feld in der Raummitte. Die Ausdehnung steckt im
    // Raum, nicht im Symbol.
    length: 0.4,
    depth: 0.4,
    label: `FBH ${room.name}`,
    params: {
      roomCoverage: true,
      loopSpacing: design.spacing,
      loopCount: design.loops,
      loopPattern: DEFAULT_LOOP_PATTERN,
      loopEdgeClearance: DEFAULT_EDGE_CLEARANCE,
      powerW: Math.round(design.output),
      flowTemperature: 35,
      returnTemperature: 28,
    },
  });
  if (!erstellt) return null;
  return {
    roomId: room.id,
    room: room.name,
    area: belegbar,
    loops: design.loops,
    powerW: Math.round(design.output),
  };
}

export const useBimStore = create<BimState>()((set, get) => {
  /**
   * Läuft gerade eine geklammerte Geste, und wurde ihr Ausgangsstand schon
   * abgelegt? Bewusst zwei Variablen im Abschluss statt Feldern im Zustand:
   * das ist reine Buchführung der Historie, kein Zustand, auf den die
   * Oberfläche reagieren soll — ein `set` dafür würde nur Neuzeichnen
   * auslösen.
   */
  let gestureActive = false;
  let gestureRecorded = false;

  /** Führt eine Dokumentmutation aus, schreibt Historie und erneuert Räume. */
  const mutate = (fn: (doc: BimDocument) => void, options?: { skipRooms?: boolean }) => {
    const { doc, past } = get();
    const next = cloneDoc(doc);
    fn(next);
    if (!options?.skipRooms) recomputeRooms(next);
    next.meta.modifiedAt = new Date().toISOString();
    // Innerhalb einer Geste wandert nur der erste Zwischenstand in die
    // Historie — alle folgenden Schritte gehören zu derselben Bewegung.
    const record = !gestureActive || !gestureRecorded;
    if (gestureActive) gestureRecorded = true;
    set({
      doc: next,
      past: record ? [...past.slice(-49), doc] : past, // max. 50 Schritte
      future: [],
    });
  };

  return {
    doc: emptyDocument(),
    past: [],
    future: [],

    tool: 'wall',
    viewMode: '2d',
    cameraMode: 'orbit',
    selection: null,
    selections: [],
    clipboard: null,
    hover: null,
    viewport: { zoom: 60, center: { x: 4, y: 3 } },
    snap: DEFAULT_SNAP,
    showDimensions: true,
    showRoofLines: true,
    pipeService: 'heating-flow',
    roomTemplate: 'rechteck',
    roomTemplateOptions: { ...DEFAULT_TEMPLATE_OPTIONS },
    verticalKind: 'stair-straight',
    solidKind: 'chimney',
    annotationKind: 'dimension',
    siteKind: 'boundary',
    showRoomLabels: true,
    // Der Einstieg ist der einfache Modus. Wer mehr braucht, schaltet um —
    // umgekehrt sucht niemand nach dem Schalter, der ihm die Hälfte wegnimmt.
    uiMode: (typeof localStorage !== 'undefined' && localStorage.getItem('ravia-ui-mode') === 'profi'
      ? 'profi'
      : 'einfach') as 'einfach' | 'profi',
    showDiagnostics: true,
    showGuides: true,
    orthoLock: false,
    openingPreset: OPENING_PRESETS[2],
    activeFixture: 'radiator',
    wallDefaults: { thickness: 0.24, height: 2.75, type: 'exterior', uValue: 0.24 },
    openingDefaults: {
      doorWidth: 0.885,
      doorHeight: 2.01,
      windowWidth: 1.26,
      windowHeight: 1.385,
      windowSill: 0.9,
    },
    aiState: { status: 'idle' },
    statusMessage: 'Bereit',
    trace: null,

    // ----------------------------------------------------------------- UI
    setTool: (tool) => {
      const state = get();
      // Beim Wechsel auf ein Öffnungswerkzeug die Vorlage mitziehen: wer
      // „Durchgang" wählt, will keinen Durchgang mit Fensterparametern.
      let openingPreset = state.openingPreset;
      if ((tool === 'door' || tool === 'window' || tool === 'passage') && openingPreset.kind !== tool) {
        openingPreset = OPENING_PRESETS.find((p) => p.kind === tool) ?? openingPreset;
      }
      set({ tool, openingPreset, selection: tool === 'select' ? state.selection : null });
    },
    setViewMode: (viewMode) => set({ viewMode }),
    setCameraMode: (cameraMode) => set({ cameraMode }),
    setSelection: (selection) => set({ selection, selections: selection ? [selection] : [] }),

    setSelections: (selections) =>
      set({ selections, selection: selections.length ? selections[selections.length - 1] : null }),

    /** Strg/Umschalt-Klick: Objekt zur Auswahl hinzunehmen oder herausnehmen. */
    toggleSelection: (sel) => {
      const current = get().selections;
      const exists = current.some((s2) => s2.kind === sel.kind && s2.id === sel.id);
      const next = exists
        ? current.filter((s2) => !(s2.kind === sel.kind && s2.id === sel.id))
        : [...current, sel];
      set({ selections: next, selection: next.length ? next[next.length - 1] : null });
    },

    /** Auswahlrahmen: alles im Rechteck fassen (nur das aktive Geschoss). */
    selectInBox: (min, max, additive) => {
      const doc = get().doc;
      const inBox = (p: Vec2) => p.x >= min.x && p.x <= max.x && p.y >= min.y && p.y <= max.y;
      const found: Selection[] = [];

      for (const wall of Object.values(doc.walls)) {
        if (wall.levelId !== doc.activeLevelId) continue;
        const a = doc.nodes[wall.a];
        const b = doc.nodes[wall.b];
        // Vollständig im Rahmen — wie in CAD üblich beim Aufziehen nach rechts.
        if (a && b && inBox(a) && inBox(b)) found.push({ kind: 'wall', id: wall.id });
      }
      for (const f of Object.values(doc.fixtures)) {
        if (f.levelId !== doc.activeLevelId) continue;
        if (inBox(f.position)) found.push({ kind: 'fixture', id: f.id });
      }
      // Die Außenanlage gehört keinem Geschoss an und wird in jedem gezeigt —
      // also ist sie auch in jedem Geschoss mit dem Rahmen zu fassen.
      for (const pump of Object.values(doc.site.pumps)) {
        if (pump.form === 'indoor') continue; // steht nicht im Lageplan
        if (inBox(pump.position)) found.push({ kind: 'heatpump', id: pump.id });
      }
      for (const element of Object.values(doc.site.elements)) {
        // Dieselbe Regel wie bei der Wand: vollständig im Rahmen. Ein Zug,
        // von dem nur ein Stützpunkt getroffen ist, würde sich beim
        // Verschieben verformen statt zu wandern.
        if (element.points.length && element.points.every(inBox)) {
          found.push({ kind: 'site', id: element.id });
        }
      }

      const next = additive ? [...get().selections, ...found] : found;
      set({ selections: next, selection: next.length ? next[next.length - 1] : null });
    },

    selectAll: () => {
      const doc = get().doc;
      const next: Selection[] = [
        ...Object.values(doc.walls)
          .filter((w) => w.levelId === doc.activeLevelId)
          .map((w) => ({ kind: 'wall' as const, id: w.id })),
        ...Object.values(doc.fixtures)
          .filter((f) => f.levelId === doc.activeLevelId)
          .map((f) => ({ kind: 'fixture' as const, id: f.id })),
      ];
      set({ selections: next, selection: next.length ? next[next.length - 1] : null });
    },
    setHover: (hover) => set({ hover }),
    setViewport: (vp) => set({ viewport: { ...get().viewport, ...vp } }),
    setSnap: (patch) => set({ snap: { ...get().snap, ...patch } }),
    toggleDimensions: () => set({ showDimensions: !get().showDimensions }),
    toggleRoofLines: () => set({ showRoofLines: !get().showRoofLines }),
    setRoomTemplate: (kind) =>
      set({ roomTemplate: kind, tool: 'room', statusMessage: `${ROOM_TEMPLATE_BY_KIND[kind].label} — im Plan aufziehen` }),
    setRoomTemplateOptions: (patch) =>
      set((st) => ({ roomTemplateOptions: { ...st.roomTemplateOptions, ...patch } })),
    setPipeService: (service) =>
      set({ pipeService: service, statusMessage: PIPE_SERVICE_LABELS[service] }),
    setVerticalKind: (kind) => set({ verticalKind: kind, statusMessage: VERTICAL_LABELS[kind] }),

    setSolidKind: (kind) => set({ solidKind: kind, statusMessage: SOLID_LABELS[kind] }),
    setAnnotationKind: (kind) => set({ annotationKind: kind, statusMessage: ANNOTATION_LABELS[kind] }),
    setSiteKind: (kind) => set({ siteKind: kind, statusMessage: SITE_ELEMENT_LABELS[kind] }),
    toggleRoomLabels: () => set({ showRoomLabels: !get().showRoomLabels }),
    setUiMode: (mode) => {
      // Bewusst über einen Neustart hinweg gemerkt: der Modus ist eine
      // Eigenschaft des Menschen, nicht des Projekts.
      try {
        localStorage.setItem('ravia-ui-mode', mode);
      } catch {
        // Privater Modus oder gesperrter Speicher — dann gilt er nur jetzt.
      }
      set({ uiMode: mode });
    },
    toggleDiagnostics: () => set({ showDiagnostics: !get().showDiagnostics }),
    toggleGuides: () => set({ showGuides: !get().showGuides }),
    setOrthoLock: (orthoLock) => set({ orthoLock }),
    setOpeningPreset: (openingPreset) => set({ openingPreset }),
    setActiveFixture: (activeFixture) => set({ activeFixture, tool: 'fixture' }),
    setWallDefaults: (patch) => set({ wallDefaults: { ...get().wallDefaults, ...patch } }),
    setOpeningDefaults: (patch) => set({ openingDefaults: { ...get().openingDefaults, ...patch } }),
    setStatus: (statusMessage) => set({ statusMessage }),
    setAiState: (aiState) => set({ aiState }),

    // ----------------------------------------------------------- Dokument
    addWall: (start, end, options) => {
      if (distance(start, end) < 0.05) return null; // < 5 cm ignorieren
      const defaults = get().wallDefaults;
      let created: Wall | null = null;

      mutate((doc) => {
        const a = nodeAt(doc, start);
        const b = nodeAt(doc, end);
        if (a.id === b.id) return;

        // Doppelte Wand zwischen denselben Knoten vermeiden
        const exists = Object.values(doc.walls).some(
          (w) => (w.a === a.id && w.b === b.id) || (w.a === b.id && w.b === a.id),
        );
        if (exists) return;

        const wall: Wall = {
          id: uid('w'),
          levelId: doc.activeLevelId,
          a: a.id,
          b: b.id,
          thickness: defaults.thickness,
          height: doc.levels[doc.activeLevelId]?.height ?? defaults.height,
          type: defaults.type,
          layerId: 'layer-walls',
          uValue: defaults.uValue,
          ...options,
        };
        doc.walls[wall.id] = wall;
        created = wall;

        // Beide Enden sauber anbinden: läuft dort eine Wand durch, wird sie
        // geteilt. Damit entsteht gar nicht erst ein "fast angeschlossenes" Ende.
        splitWallsAtNode(doc, a);
        splitWallsAtNode(doc, b);
      });

      return created;
    },

    updateWall: (id, patch) =>
      mutate((doc) => {
        const wall = doc.walls[id];
        if (wall) doc.walls[id] = { ...wall, ...patch };
      }),

    moveNode: (id, position) =>
      mutate((doc) => {
        const node = doc.nodes[id];
        if (!node || node.locked) return;
        doc.nodes[id] = { ...node, x: roundMm(position.x), y: roundMm(position.y) };
      }),

    addOpening: (opening) => {
      let created: Opening | null = null;
      mutate((doc) => {
        const wall = doc.walls[opening.wallId];
        if (!wall) return;
        const na = doc.nodes[wall.a];
        const nb = doc.nodes[wall.b];
        if (!na || !nb) return;
        const wallLength = distance(na, nb);
        const half = opening.width / 2;
        if (wallLength < opening.width + 0.02) return; // passt nicht in die Wand

        // Überlappung mit bestehenden Öffnungen verhindern
        const clampedDistance = Math.min(Math.max(opening.distance, half), wallLength - half);
        const overlaps = Object.values(doc.openings).some((o) => {
          if (o.wallId !== wall.id) return false;
          return Math.abs(o.distance - clampedDistance) < (o.width + opening.width) / 2;
        });
        if (overlaps) return;

        const next: Opening = { ...opening, id: uid('o'), distance: roundMm(clampedDistance) };
        doc.openings[next.id] = next;
        created = next;
      });
      return created;
    },

    updateOpening: (id, patch) =>
      mutate((doc) => {
        const opening = doc.openings[id];
        if (opening) doc.openings[id] = { ...opening, ...patch };
      }),

    /**
     * Teilt eine Wand an einem Punkt in zwei Wände. Wird beim Zeichnen
     * automatisch aufgerufen, wenn ein neues Wandende auf einer bestehenden
     * Wand landet: aus dem optischen T-Stoß wird ein topologischer. Genau
     * daran scheitert sonst die Raumerkennung.
     */
    splitWallAt: (wallId, point) =>
      mutate((doc) => {
        const wall = doc.walls[wallId];
        if (!wall) return;
        const na = doc.nodes[wall.a];
        const nb = doc.nodes[wall.b];
        if (!na || !nb) return;

        const len = distance(na, nb);
        const t = ((point.x - na.x) * (nb.x - na.x) + (point.y - na.y) * (nb.y - na.y)) / (len * len);
        // Zu nah am Ende: dort wird ohnehin auf den vorhandenen Knoten gefangen.
        if (t <= 0.02 || t >= 0.98) return;

        const mid = nodeAt(doc, point, 1e-4);
        const second: Wall = { ...wall, id: uid('w'), a: mid.id, b: wall.b };
        doc.walls[wall.id] = { ...wall, b: mid.id };
        doc.walls[second.id] = second;

        // Öffnungen wandern auf das Teilstück, in dem sie liegen.
        const splitDistance = t * len;
        for (const op of Object.values(doc.openings)) {
          if (op.wallId !== wall.id) continue;
          if (op.distance > splitDistance) {
            doc.openings[op.id] = {
              ...op,
              wallId: second.id,
              distance: roundMm(op.distance - splitDistance),
            };
          }
        }
      }),

    addRoomTemplate: (kind, from, to, options) => {
      const polygon = templatePolygon(kind, from, to, options);
      // Zu klein aufgezogen: lieber nichts anlegen als vier Wände, die
      // kürzer sind als ihre eigene Dicke.
      if (polygon.length < 3) return null;

      const defaults = get().wallDefaults;
      let count = 0;
      mutate((doc) => {
        const height = doc.levels[doc.activeLevelId]?.height ?? defaults.height;
        // Erst alle Knoten, dann alle Wände: so schließt der Ring sauber,
        // auch wenn zwei Ecken dicht beieinander liegen und verschmelzen.
        const ring = polygon.map((p) => nodeAt(doc, { x: roundMm(p.x), y: roundMm(p.y) }));
        for (let i = 0; i < ring.length; i += 1) {
          const a = ring[i];
          const b = ring[(i + 1) % ring.length];
          if (a.id === b.id) continue;
          const exists = Object.values(doc.walls).some(
            (w) => (w.a === a.id && w.b === b.id) || (w.a === b.id && w.b === a.id),
          );
          if (exists) continue;
          const wall: Wall = {
            id: uid('w'),
            levelId: doc.activeLevelId,
            a: a.id,
            b: b.id,
            thickness: defaults.thickness,
            height,
            type: defaults.type,
            layerId: 'layer-walls',
            uValue: defaults.uValue,
          };
          doc.walls[wall.id] = wall;
          count += 1;
        }
        // Anschließend anbinden: läuft eine bestehende Wand durch eine Ecke
        // der Vorlage, wird sie dort geteilt. Das passiert erst nach dem
        // Ring, damit die neuen Wände sich nicht gegenseitig zerteilen.
        for (const node of ring) splitWallsAtNode(doc, node);
      });

      if (!count) {
        set({ statusMessage: 'Hier steht schon eine Wand — die Vorlage hätte nichts hinzugefügt.' });
        return null;
      }

      // Der eben entstandene Raum bekommt Namen und Nutzung, wenn sie
      // mitgegeben wurden. Erkannt wird er über seinen Schwerpunkt.
      const centre = {
        x: polygon.reduce((a, p) => a + p.x, 0) / polygon.length,
        y: polygon.reduce((a, p) => a + p.y, 0) / polygon.length,
      };
      if (options?.name || options?.usage) {
        const doc = get().doc;
        const room = Object.values(doc.rooms).find(
          (r) => r.levelId === doc.activeLevelId && r.innerPolygon.length >= 3 && pointInPolygon(centre, r.innerPolygon),
        );
        if (room) get().updateRoom(room.id, { name: options.name ?? room.name, usage: options.usage ?? room.usage });
      }

      const area = polygonArea(polygon);
      set({
        statusMessage: `${ROOM_TEMPLATE_BY_KIND[kind].label} mit ${count} Wänden angelegt · ${area.toFixed(2)} m² Achsfläche`,
      });
      return { walls: count, area };
    },

    /**
     * Die Wände, Öffnungen und TGA-Objekte eines Raums einsammeln.
     *
     * „Zum Raum gehörig" heißt: eine Wand, die als Begrenzung erkannt wurde,
     * und ein Objekt, dessen Standort im lichten Polygon liegt. Eine Wand
     * zwischen zwei Räumen gehört damit zu beiden — beim Kopieren eines
     * einzelnen Raums ist das richtig, denn der Nachbar bleibt ja stehen.
     */
    copyRoom: (roomId) => {
      const { doc } = get();
      const room = doc.rooms[roomId];
      if (!room) return false;
      const wallIds = room.boundaries.map((b) => b.wallId);
      const walls = wallIds.map((id) => doc.walls[id]).filter(Boolean);
      if (!walls.length) return false;
      const nodeIds = new Set(walls.flatMap((w) => [w.a, w.b]));
      const nodes = [...nodeIds].map((id) => doc.nodes[id]).filter(Boolean);
      const openings = Object.values(doc.openings).filter((o) => wallIds.includes(o.wallId));
      const fixtures = Object.values(doc.fixtures).filter(
        (f) => f.levelId === room.levelId && room.innerPolygon.length >= 3 && pointInPolygon(f.position, room.innerPolygon),
      );
      const points: Vec2[] = [...nodes, ...fixtures.map((f) => f.position)];
      const origin = points.reduce(
        (acc, p) => ({ x: Math.min(acc.x, p.x), y: Math.min(acc.y, p.y) }),
        { x: Infinity, y: Infinity },
      );
      set({
        clipboard: { origin, nodes, walls, openings, fixtures },
        statusMessage: `Raum „${room.name}" kopiert — ${walls.length} Wände, ${openings.length} Öffnungen, ${fixtures.length} TGA-Objekte`,
      });
      return true;
    },

    duplicateRoom: (roomId, offset) => {
      const { doc } = get();
      const room = doc.rooms[roomId];
      if (!room) return null;
      if (!get().copyRoom(roomId)) return null;
      const clip = get().clipboard;
      if (!clip) return null;

      // Ohne Vorgabe wird der Raum um seine eigene Breite nach rechts
      // versetzt und rückt einen halben Meter ab. So überlappt die Kopie
      // nicht mit dem Original und klebt trotzdem nicht daran.
      const xs = room.polygon.map((p) => p.x);
      const width = Math.max(...xs) - Math.min(...xs);
      const d = offset ?? { x: roundMm(width + 0.5), y: 0 };
      get().pasteClipboard(d);
      const created = get().selections;
      set({
        statusMessage: `Raum „${room.name}" dupliziert — ${clip.walls.length} Wände, ${clip.fixtures.length} TGA-Objekte`,
      });
      return { walls: created.filter((c) => c.kind === 'wall').length, fixtures: clip.fixtures.length };
    },

    addFixture: (type, position, options) => {
      const def = FIXTURE_BY_TYPE[type];
      if (!def) return null;
      let created: Fixture | null = null;

      mutate(
        (doc) => {
          const fixture: Fixture = {
            id: uid('f'),
            type,
            category: def.category,
            levelId: doc.activeLevelId,
            position: { x: roundMm(position.x), y: roundMm(position.y) },
            rotation: 0,
            length: def.length,
            depth: def.depth,
            elevation: def.elevation,
            label: def.label,
            params: { ...def.params },
            ...options,
          };
          // Raumzuordnung sofort setzen, damit der Export ohne weitere
          // Geometrieänderung vollständig ist.
          const room = Object.values(doc.rooms).find(
            (r) => r.innerPolygon.length >= 3 && pointInPolygon(fixture.position, r.innerPolygon),
          );
          fixture.roomId = room?.id;
          doc.fixtures[fixture.id] = fixture;
          created = fixture;
        },
        { skipRooms: true },
      );
      return created;
    },

    toggleFloorLoopArea: (roomId) => {
      const doc0 = get().doc;
      const room = doc0.rooms[roomId];
      if (!room || room.innerPolygon.length < 3) return null;

      const vorhanden = Object.values(doc0.fixtures).find(
        (f) => f.type === 'underfloor' && f.params.roomCoverage === true && f.roomId === roomId,
      );
      if (vorhanden) {
        mutate(
          (doc) => {
            delete doc.fixtures[vorhanden.id];
          },
          { skipRooms: true },
        );
        set({ statusMessage: `Fußbodenheizung in „${room.name}" entfernt` });
        return 'entfernt';
      }

      const gelegt = belegeRaum(get, roomId);
      if (!gelegt) {
        set({ statusMessage: `„${room.name}" ist für eine Fußbodenheizung zu klein` });
        return null;
      }
      set({
        statusMessage:
          `Fußbodenheizung „${room.name}": ${gelegt.area.toFixed(1).replace('.', ',')} m² belegt · ` +
          `${gelegt.loops} ${gelegt.loops === 1 ? 'Kreis' : 'Kreise'} · ${gelegt.powerW} W`,
      });
      return 'angelegt';
    },

    layAllFloorLoops: (levelId) => {
      const doc0 = get().doc;
      const geschoss = levelId ?? doc0.activeLevelId;
      const raeume = Object.values(doc0.rooms).filter((r) => r.levelId === geschoss);
      const laid: FloorLoopBatchResult[] = [];
      const skipped: FloorLoopBatchSkip[] = [];

      /**
       * Ein Raum, in dem schon ein Heizkörper steht, bekommt keine
       * Fußbodenheizung dazu. Das ist keine Bequemlichkeit, sondern
       * Hydraulik: zwei Heizflächen mit verschiedenen Systemtemperaturen im
       * selben Raum sind eine Entscheidung, die jemand treffen muss —
       * stillschweigend darf sie nicht fallen.
       */
      const heizkoerperTypen: FixtureType[] = ['radiator', 'radiator-tube', 'convector'];

      for (const room of raeume) {
        if (room.innerPolygon.length < 3) {
          skipped.push({ roomId: room.id, room: room.name, reason: 'kein geschlossener Raumumriss' });
          continue;
        }
        if (!room.isHeated) {
          skipped.push({ roomId: room.id, room: room.name, reason: 'unbeheizt' });
          continue;
        }
        const aktuell = get().doc;
        const schon = Object.values(aktuell.fixtures).find(
          (f) => f.type === 'underfloor' && f.params.roomCoverage === true && f.roomId === room.id,
        );
        if (schon) {
          skipped.push({ roomId: room.id, room: room.name, reason: 'hat schon eine Fußbodenheizung' });
          continue;
        }
        const heizkoerper = Object.values(aktuell.fixtures).find(
          (f) =>
            f.levelId === room.levelId &&
            heizkoerperTypen.includes(f.type) &&
            pointInPolygon(f.position, room.innerPolygon),
        );
        if (heizkoerper) {
          skipped.push({
            roomId: room.id,
            room: room.name,
            reason: `hat bereits einen Heizkörper (${heizkoerper.label ?? FIXTURE_BY_TYPE[heizkoerper.type]?.label ?? heizkoerper.type})`,
          });
          continue;
        }
        const gelegt = belegeRaum(get, room.id);
        if (!gelegt) {
          skipped.push({
            roomId: room.id,
            room: room.name,
            reason: 'nach Randabstand und Einbauten bleibt keine belegbare Fläche',
          });
          continue;
        }
        laid.push(gelegt);
      }

      const verteiler = Object.values(get().doc.fixtures).some(
        (f) => f.type === 'manifold' && f.levelId === geschoss,
      );
      const flaeche = laid.reduce((s, r) => s + r.area, 0);
      set({
        statusMessage:
          laid.length === 0
            ? `Kein Raum ausgelegt — ${skipped.length} übergangen (siehe TGA-Palette)`
            : `${laid.length} ${laid.length === 1 ? 'Raum' : 'Räume'} ausgelegt · ` +
              `${flaeche.toFixed(1).replace('.', ',')} m²` +
              (skipped.length > 0 ? ` · ${skipped.length} übergangen` : '') +
              (verteiler ? '' : ' · kein Heizkreisverteiler gesetzt'),
      });
      return { levelId: geschoss, laid, skipped, manifold: verteiler };
    },

    updateFixture: (id, patch) =>
      mutate(
        (doc) => {
          const fixture = doc.fixtures[id];
          if (fixture) doc.fixtures[id] = { ...fixture, ...patch };
        },
        { skipRooms: true },
      ),

    moveFixture: (id, position) =>
      mutate(
        (doc) => {
          const fixture = doc.fixtures[id];
          if (!fixture) return;
          const def = FIXTURE_BY_TYPE[fixture.type];
          let next: Fixture = {
            ...fixture,
            position: { x: roundMm(position.x), y: roundMm(position.y) },
          };

          // Wandgebundene Objekte rasten an die nächste Wand ein und richten
          // sich automatisch parallel dazu aus — ein Heizkörper steht nie schräg.
          if (def?.wallMounted) {
            let bestWall: Wall | undefined;
            let bestDist = 1.0;
            let bestPoint = next.position;
            for (const wall of Object.values(doc.walls)) {
              const a = doc.nodes[wall.a];
              const b = doc.nodes[wall.b];
              if (!a || !b) continue;
              const cp = closestPointOnSegment(position, a, b);
              const d = distance(cp, position);
              if (d < bestDist) {
                bestDist = d;
                bestWall = wall;
                bestPoint = cp;
              }
            }
            if (bestWall) {
              const a = doc.nodes[bestWall.a];
              const b = doc.nodes[bestWall.b];
              const angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
              const nx = -(b.y - a.y);
              const ny = b.x - a.x;
              const nlen = Math.hypot(nx, ny) || 1;
              // Auf die Raumseite setzen, auf der der Cursor steht.
              const side = (position.x - bestPoint.x) * (nx / nlen) + (position.y - bestPoint.y) * (ny / nlen);
              const offset = bestWall.thickness / 2 + next.depth / 2;
              const sign = side >= 0 ? 1 : -1;
              next = {
                ...next,
                wallId: bestWall.id,
                rotation: angle,
                position: {
                  x: roundMm(bestPoint.x + (nx / nlen) * offset * sign),
                  y: roundMm(bestPoint.y + (ny / nlen) * offset * sign),
                },
              };
            } else {
              next = { ...next, wallId: undefined };
            }
          }

          const room = Object.values(doc.rooms).find(
            (r) => r.innerPolygon.length >= 3 && pointInPolygon(next.position, r.innerPolygon),
          );
          next.roomId = room?.id;
          doc.fixtures[id] = next;
        },
        { skipRooms: true },
      ),

    updateRoom: (id, patch) =>
      mutate(
        (doc) => {
          const room = doc.rooms[id];
          if (!room) return;
          const merged = { ...room, ...patch };
          // Nutzungsänderung zieht die Normwerte nach, sofern nicht explizit gesetzt
          if (patch.usage && patch.setpointTemperature === undefined) {
            const d = usageDefaults(patch.usage);
            merged.setpointTemperature = d.temp;
            merged.airChangeRate = d.ach;
            // Die Rolle im Lüftungskonzept folgt der Nutzung mit — wer einen
            // Raum zum Bad macht, meint einen Abluftraum. Eine ausdrücklich
            // gesetzte Rolle bleibt stehen.
            if (patch.ventilationRole === undefined) merged.ventilationRole = d.air;
          }
          doc.rooms[id] = merged;
        },
        { skipRooms: true },
      ),

    // ------------------------------------------------------------ Geschosse
    /**
     * Legt ein Geschoss an. `copyFrom` übernimmt die Wände des Bezugs-
     * geschosses samt Öffnungen — der Regelfall im Wohnungsbau, wo das
     * Obergeschoss demselben Grundriss folgt.
     *
     * **Was beim Übernehmen nicht mitkopiert wird.** Eine Treppe verbindet
     * zwei Geschosse und steht deshalb genau einmal im Modell: `levelId` ist
     * ihr unteres, `toLevelId` ihr oberes Ende. Sie zu kopieren ergäbe eine
     * zweite Treppe an derselben Stelle — zwei Bauteile für einen Sachverhalt,
     * mit doppeltem Flächenabzug und doppeltem Massenauszug. Kopiert wird sie
     * darum nicht; sie *wirkt* im neuen Geschoss trotzdem, weil
     * `applyVerticalDeductions` das Bauteil über beide Geschosse auflöst: unten
     * fehlt die Decke, oben der Fußboden. Der Plan des oberen Geschosses
     * zeichnet an dieser Stelle die Deckenöffnung, nicht die Treppe. Für
     * Schächte gilt dasselbe, aus demselben Grund.
     *
     * Bei massiven Bauteilen entscheidet `throughAllLevels`: ein Schornstein
     * geht ohnehin durch alle Geschosse darüber und wird deshalb wie die
     * Treppe nicht kopiert. Ein Pfeiler oder Wandversatz gehört dagegen zu
     * genau einem Geschoss — er ist Teil des übernommenen Grundrisses und
     * wird mitkopiert, wie eine Wand.
     *
     * `below: true` legt das Geschoss *unter* dem bisher untersten an. Ein
     * Keller ist dabei kein Obergeschoss mit umgekehrtem Vorzeichen: seine
     * lichte Höhe ist kleiner, sein Boden grenzt an Erdreich und seine Decke
     * an den Raum darüber, dessen Bodenplatte damit keine mehr ist.
     *
     * Vor allem aber braucht das Modell dann eine Geländeoberkante — ohne sie
     * stünde vor jeder Kellerwand die Norm-Außentemperatur. Sie wird deshalb
     * hier gesetzt, falls sie noch fehlt: 0,30 m unter dem bisher untersten
     * Fußboden, also auf Höhe der neuen Kellerdecke und damit die übliche
     * Sockelhöhe. Der neue Keller steckt so vollständig im Erdreich — der
     * Regelfall. Am Hang zieht der Anwender die Höhe tiefer, und die Wände
     * teilen sich von selbst in einen erdberührten und einen freien Teil.
     * Eine bereits erfasste Geländeoberkante wird nie überschrieben.
     */
    addLevel: (options) => {
      let created: Level | null = null;
      mutate((doc) => {
        const levels = Object.values(doc.levels).sort((a, b) => a.order - b.order);
        const below = levels[levels.length - 1];
        const above = levels[0];

        // 2,30 m lichte Höhe für den Keller: Erfahrungswert des deutschen
        // Wohnungsbaus, deutlich unter den 2,75 m eines Wohngeschosses.
        // Keine Normangabe — überschreibbar wie jede Vorbelegung.
        const KELLERHOEHE = 2.3;
        // Dieselbe Deckenstärke von 0,30 m wie beim Anbau nach oben.
        const DECKE = 0.3;
        // Wie viele Geschosse liegen schon unter dem Bezugsgeschoss? Aus
        // dieser Zahl folgt der Name: das erste ist das Kellergeschoss, jedes
        // weitere ein Untergeschoss mit fortlaufender Zählung — dieselbe
        // Systematik wie „1. OG, 2. OG" nach oben, nur mit dem in Deutschland
        // üblichen Sonderfall für die erste Ebene darunter. Ein „1. UG" gibt
        // es deshalb nicht: das ist das KG.
        const belowCount = levels.filter((l) => l.order < 0).length;

        const level: Level = options?.below
          ? {
              id: uid('lvl'),
              name: options.name ?? (belowCount === 0 ? 'KG' : `${belowCount + 1}. UG`),
              order: (above?.order ?? 0) - 1,
              elevation: (above?.elevation ?? 0) - (KELLERHOEHE + DECKE),
              height: KELLERHOEHE,
              // Kellersohle auf Erdreich; 0,35 W/(m²·K) ist die Größenordnung
              // einer Bodenplatte mit Perimeterdämmung.
              floorUValue: 0.35,
              floorBoundary: 'ground',
              // Kellerdecke gegen den Raum darüber — derselbe Wert, den der
              // Anbau nach oben für eine Geschossdecke setzt.
              ceilingUValue: 0.9,
              ceilingBoundary: 'adjacent-room',
            }
          : {
              id: uid('lvl'),
              name: options?.name ?? `${levels.filter((l) => l.order >= 0).length}. OG`,
              order: (below?.order ?? -1) + 1,
              elevation: below ? below.elevation + below.height + DECKE : 0,
              height: below?.height ?? 2.75,
              floorUValue: 0.9,
              floorBoundary: 'adjacent-room',
              ceilingUValue: below?.ceilingUValue ?? 0.2,
              ceilingBoundary: 'unheated',
            };
        doc.levels[level.id] = level;

        if (options?.below) {
          // Das Geschoss darüber steht jetzt nicht mehr auf Erdreich.
          if (above) {
            doc.levels[above.id] = {
              ...above,
              floorBoundary: 'adjacent-room',
              floorUValue: 0.9,
            };
          }

          // Ohne Geländeoberkante bliebe der Keller rechnerisch ein Geschoss
          // mit Norm-Außentemperatur vor der Wand. Vorhandene Angaben bleiben
          // unangetastet — sie können aus einer Hanglage stammen, die niemand
          // überschreiben darf.
          if (doc.meta.terrainElevation === undefined && above) {
            doc.meta.terrainElevation = above.elevation - DECKE;
          }
        } else if (below) {
          // Das Geschoss darunter grenzt jetzt an ein beheiztes Geschoss.
          doc.levels[below.id] = {
            ...below,
            ceilingBoundary: 'adjacent-room',
            ceilingUValue: 0.9,
          };
        }

        const source = options?.copyFrom ? doc.levels[options.copyFrom] : undefined;
        if (source) {
          // Welche Bauteile mitwandern, entscheidet der Rechenkern: die Regel
          // ist fachlich (eine Treppe gibt es einmal, ein Schornstein auch,
          // ein Pfeiler gehört zum Grundriss) und hat mit Zustandsverwaltung
          // nichts zu tun. Hier bleibt nur das Einhängen ins Dokument.
          const kopie = copyLevelContents({
            sourceLevelId: source.id,
            targetLevelId: level.id,
            targetHeight: level.height,
            nodes: Object.values(doc.nodes),
            walls: Object.values(doc.walls),
            openings: Object.values(doc.openings),
            verticals: Object.values(doc.verticals ?? {}),
            solids: Object.values(doc.solids ?? {}),
            newId: uid,
          });
          for (const node of kopie.nodes) doc.nodes[node.id] = node;
          for (const wall of kopie.walls) doc.walls[wall.id] = wall;
          for (const opening of kopie.openings) doc.openings[opening.id] = opening;
          if (kopie.solids.length > 0) {
            const solids = doc.solids ?? {};
            for (const massiv of kopie.solids) solids[massiv.id] = massiv;
            doc.solids = solids;
          }

          // Räume einmal vorab erkennen und beschriften. Der anschließende
          // reguläre Durchlauf in mutate() übernimmt die Namen dann als
          // „vorherigen Stand" — es bleibt bei einem Undo-Schritt.
          recomputeRooms(doc);
          transferRoomProperties(doc, source.id, level.id);
        }

        doc.activeLevelId = level.id;
        created = level;
      });
      set({ selection: null, selections: [], statusMessage: created ? `Geschoss „${(created as Level).name}" angelegt` : '' });
      return created;
    },

    deleteLevel: (id) => {
      const doc = get().doc;
      if (Object.keys(doc.levels).length <= 1) {
        set({ statusMessage: 'Das letzte Geschoss lässt sich nicht löschen' });
        return;
      }
      mutate((d) => {
        for (const w of Object.values(d.walls)) {
          if (w.levelId !== id) continue;
          for (const o of Object.values(d.openings)) if (o.wallId === w.id) delete d.openings[o.id];
          delete d.walls[w.id];
        }
        for (const n of Object.values(d.nodes)) if (n.levelId === id) delete d.nodes[n.id];
        for (const v of Object.values(d.verticals)) if (v.levelId === id) delete d.verticals[v.id];
        for (const b of Object.values(d.solids ?? {})) if (b.levelId === id) delete d.solids?.[b.id];
        for (const pr of Object.values(d.pipes)) if (pr.levelId === id) delete d.pipes[pr.id];
        for (const an of Object.values(d.annotations)) if (an.levelId === id) delete d.annotations[an.id];
        for (const ro of Object.values(d.roofOpenings)) if (ro.levelId === id) delete d.roofOpenings[ro.id];
        for (const f of Object.values(d.fixtures)) if (f.levelId === id) delete d.fixtures[f.id];
        delete d.levels[id];
        if (d.activeLevelId === id) {
          d.activeLevelId = Object.values(d.levels).sort((a, b) => a.order - b.order)[0].id;
        }
      });
      set({ selection: null, selections: [] });
    },

    setActiveLevel: (id) => {
      if (!get().doc.levels[id]) return;
      mutate((doc) => {
        doc.activeLevelId = id;
      });
      set({ selection: null, selections: [], statusMessage: `Geschoss ${get().doc.levels[id]?.name}` });
    },

    // ------------------------------------------------------- Bauteilkatalog
    addConstruction: (construction) => {
      const created: Construction = { ...construction, id: uid('c') };
      mutate((doc) => {
        doc.constructions[created.id] = created;
      }, { skipRooms: true });
      return created;
    },

    /**
     * Ändert einen Aufbau — und zieht alle zugewiesenen Bauteile mit. Genau
     * dafür gibt es den Katalog: eine Änderung an einer Stelle statt an
     * dreißig Wänden.
     */
    updateConstruction: (id, patch) =>
      mutate((doc) => {
        const current = doc.constructions[id];
        if (!current) return;
        const next = { ...current, ...patch };
        doc.constructions[id] = next;

        for (const wall of Object.values(doc.walls)) {
          if (wall.constructionId !== id) continue;
          doc.walls[wall.id] = {
            ...wall,
            uValue: next.uValue,
            thickness: next.thickness ?? wall.thickness,
            thermalBridgeSupplement: next.thermalBridgeSupplement ?? wall.thermalBridgeSupplement,
          };
        }
        for (const op of Object.values(doc.openings)) {
          if (op.constructionId !== id) continue;
          doc.openings[op.id] = { ...op, uValue: next.uValue, gValue: next.gValue ?? op.gValue };
        }
        for (const level of Object.values(doc.levels)) {
          if (level.floorConstructionId === id) doc.levels[level.id] = { ...level, floorUValue: next.uValue };
          if (level.ceilingConstructionId === id) {
            doc.levels[level.id] = { ...doc.levels[level.id], ceilingUValue: next.uValue };
          }
        }
      }),

    deleteConstruction: (id) =>
      mutate((doc) => {
        delete doc.constructions[id];
        // Zuweisungen lösen, U-Werte bleiben als Einzelwerte erhalten.
        for (const wall of Object.values(doc.walls)) {
          if (wall.constructionId === id) doc.walls[wall.id] = { ...wall, constructionId: undefined };
        }
        for (const op of Object.values(doc.openings)) {
          if (op.constructionId === id) doc.openings[op.id] = { ...op, constructionId: undefined };
        }
      }, { skipRooms: true }),

    assignConstruction: (targets, constructionId) =>
      mutate((doc) => {
        const c = doc.constructions[constructionId];
        if (!c) return;
        for (const t of targets) {
          if (t.kind === 'wall') {
            const wall = doc.walls[t.id];
            if (!wall) continue;
            doc.walls[t.id] = {
              ...wall,
              constructionId,
              uValue: c.uValue,
              thickness: c.thickness ?? wall.thickness,
              thermalBridgeSupplement: c.thermalBridgeSupplement ?? wall.thermalBridgeSupplement,
            };
          } else if (t.kind === 'opening') {
            const op = doc.openings[t.id];
            if (!op) continue;
            doc.openings[t.id] = { ...op, constructionId, uValue: c.uValue, gValue: c.gValue ?? op.gValue };
          }
        }
      }),

    // -------------------------------------------------- Gruppenoperationen
    copySelection: () => {
      const { doc, selections } = get();
      const wallIds = selections.filter((s2) => s2.kind === 'wall').map((s2) => s2.id);
      const fixtureIds = selections.filter((s2) => s2.kind === 'fixture').map((s2) => s2.id);
      if (!wallIds.length && !fixtureIds.length) {
        set({ statusMessage: 'Nichts zum Kopieren ausgewählt' });
        return;
      }

      const walls = wallIds.map((id) => doc.walls[id]).filter(Boolean);
      const nodeIds = new Set(walls.flatMap((w) => [w.a, w.b]));
      const nodes = [...nodeIds].map((id) => doc.nodes[id]).filter(Boolean);
      const openings = Object.values(doc.openings).filter((o) => wallIds.includes(o.wallId));
      const fixtures = fixtureIds.map((id) => doc.fixtures[id]).filter(Boolean);

      // Bezugspunkt = linke untere Ecke der Auswahl.
      const points: Vec2[] = [...nodes, ...fixtures.map((f) => f.position)];
      const origin = points.reduce(
        (acc, p) => ({ x: Math.min(acc.x, p.x), y: Math.min(acc.y, p.y) }),
        { x: Infinity, y: Infinity },
      );

      set({
        clipboard: { origin, nodes, walls, openings, fixtures },
        statusMessage: `${walls.length} Wände, ${fixtures.length} TGA-Objekte kopiert`,
      });
    },

    pasteClipboard: (offset) => {
      const clip = get().clipboard;
      if (!clip) return;
      const d = offset ?? { x: 1, y: -1 };
      const created: Selection[] = [];

      mutate((doc) => {
        const nodeMap = new Map<string, string>();
        for (const node of clip.nodes) {
          const id = uid('n');
          nodeMap.set(node.id, id);
          doc.nodes[id] = {
            ...node,
            id,
            levelId: doc.activeLevelId,
            x: roundMm(node.x + d.x),
            y: roundMm(node.y + d.y),
          };
        }
        for (const wall of clip.walls) {
          const a = nodeMap.get(wall.a);
          const b = nodeMap.get(wall.b);
          if (!a || !b) continue;
          const id = uid('w');
          doc.walls[id] = { ...wall, id, a, b, levelId: doc.activeLevelId };
          created.push({ kind: 'wall', id });
          for (const op of clip.openings) {
            if (op.wallId !== wall.id) continue;
            const opId = uid('o');
            doc.openings[opId] = { ...op, id: opId, wallId: id };
          }
        }
        for (const f of clip.fixtures) {
          const id = uid('f');
          doc.fixtures[id] = {
            ...f,
            id,
            levelId: doc.activeLevelId,
            position: { x: roundMm(f.position.x + d.x), y: roundMm(f.position.y + d.y) },
          };
          created.push({ kind: 'fixture', id });
        }
      });

      set({
        selections: created,
        selection: created[created.length - 1] ?? null,
        statusMessage: `${created.length} Objekte eingefügt`,
      });
    },

    moveSelection: (delta) => {
      const { selections } = get();
      if (!selections.length) return;
      mutate((doc) => {
        const moved = new Set<string>();
        for (const sel of selections) {
          if (sel.kind === 'wall') {
            const wall = doc.walls[sel.id];
            if (!wall) continue;
            for (const nid of [wall.a, wall.b]) {
              if (moved.has(nid)) continue;
              const node = doc.nodes[nid];
              if (!node) continue;
              doc.nodes[nid] = { ...node, x: roundMm(node.x + delta.x), y: roundMm(node.y + delta.y) };
              moved.add(nid);
            }
          } else if (sel.kind === 'fixture') {
            const f = doc.fixtures[sel.id];
            if (!f) continue;
            doc.fixtures[sel.id] = {
              ...f,
              position: { x: roundMm(f.position.x + delta.x), y: roundMm(f.position.y + delta.y) },
            };
          } else if (sel.kind === 'heatpump') {
            const pump = doc.site.pumps[sel.id];
            if (!pump) continue;
            doc.site.pumps[sel.id] = {
              ...pump,
              position: { x: roundMm(pump.position.x + delta.x), y: roundMm(pump.position.y + delta.y) },
            };
          } else if (sel.kind === 'site') {
            const element = doc.site.elements[sel.id];
            if (!element) continue;
            // Alle Stützpunkte um denselben Betrag: das Objekt wandert, es
            // verformt sich nicht. Das Anfassen eines einzelnen Punktes ist
            // eine andere Geste und läuft nicht über die Auswahl.
            doc.site.elements[sel.id] = {
              ...element,
              points: element.points.map((p) => ({ x: roundMm(p.x + delta.x), y: roundMm(p.y + delta.y) })),
            };
          }
        }
      });
    },

    /** Spiegelt die Auswahl an der Mittelachse ihrer eigenen Ausdehnung. */
    mirrorSelection: (axis) => {
      const { doc, selections } = get();
      const walls = selections.filter((s2) => s2.kind === 'wall').map((s2) => doc.walls[s2.id]).filter(Boolean);
      const fixtures = selections.filter((s2) => s2.kind === 'fixture').map((s2) => doc.fixtures[s2.id]).filter(Boolean);
      if (!walls.length && !fixtures.length) return;

      const pts: Vec2[] = [
        ...walls.flatMap((w) => [doc.nodes[w.a], doc.nodes[w.b]]).filter(Boolean),
        ...fixtures.map((f) => f.position),
      ];
      const min = pts.reduce((a, p) => ({ x: Math.min(a.x, p.x), y: Math.min(a.y, p.y) }), { x: Infinity, y: Infinity });
      const max = pts.reduce((a, p) => ({ x: Math.max(a.x, p.x), y: Math.max(a.y, p.y) }), { x: -Infinity, y: -Infinity });
      const centre = { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2 };

      mutate((d) => {
        const done = new Set<string>();
        for (const w of walls) {
          for (const nid of [w.a, w.b]) {
            if (done.has(nid)) continue;
            const node = d.nodes[nid];
            if (!node) continue;
            d.nodes[nid] = {
              ...node,
              x: axis === 'x' ? roundMm(2 * centre.x - node.x) : node.x,
              y: axis === 'y' ? roundMm(2 * centre.y - node.y) : node.y,
            };
            done.add(nid);
          }
        }
        for (const f of fixtures) {
          d.fixtures[f.id] = {
            ...f,
            position: {
              x: axis === 'x' ? roundMm(2 * centre.x - f.position.x) : f.position.x,
              y: axis === 'y' ? roundMm(2 * centre.y - f.position.y) : f.position.y,
            },
            // Symbole müssen mitgespiegelt werden, sonst zeigt ein Heizkörper
            // nach dem Spiegeln in die Wand statt in den Raum.
            rotation: axis === 'x' ? 180 - f.rotation : -f.rotation,
          };
        }
      });
      set({ statusMessage: `Auswahl an der ${axis === 'x' ? 'Vertikal' : 'Horizontal'}achse gespiegelt` });
    },

    /** Reiht die Auswahl `count`-mal mit konstantem Versatz aneinander. */
    arraySelection: (count, delta) => {
      const state = get();
      if (!state.selections.length || count < 1) return;
      state.copySelection();
      for (let i = 1; i <= count; i++) {
        get().pasteClipboard({ x: delta.x * i, y: delta.y * i });
      }
      set({ statusMessage: `${count} Kopien in Reihe erzeugt` });
    },

    updateMeta: (patch) => mutate((doc) => Object.assign(doc.meta, patch)),

    addVertical: (kind, position) => {
      const isStair = kind !== 'shaft';
      const element: VerticalElement = {
        id: uid('v'),
        kind,
        name: isStair ? 'Treppe' : 'Schacht',
        levelId: get().doc.activeLevelId,
        position: { x: roundMm(position.x), y: roundMm(position.y) },
        // Vorgaben nach DIN 18065: 1,00 m Laufbreite, 17,5/26 cm Steigung.
        width: isStair ? 1 : 0.4,
        length: isStair ? 3.6 : 0.6,
        rotation: 0,
        steps: isStair ? 15 : undefined,
        service: isStair ? undefined : 'mixed',
        deductsArea: true,
        openToAbove: isStair,
      };
      mutate((doc) => {
        doc.verticals[element.id] = element;
      });
      set({
        selection: { kind: 'vertical', id: element.id },
        selections: [{ kind: 'vertical', id: element.id }],
        statusMessage: `${VERTICAL_LABELS[kind]} eingesetzt`,
      });
      return element;
    },

    updateVertical: (id, patch) =>
      mutate((doc) => {
        const v = doc.verticals[id];
        if (!v) return;
        doc.verticals[id] = { ...v, ...patch };
      }),

    /**
     * Setzt ein massives Bauteil.
     *
     * Die Vorgabemaße sind Erfahrungswerte des Wohnungsbaus, keine Normwerte:
     * ein einzügiger Schornstein misst mit Mantelstein rund 0,40 × 0,40 m, ein
     * Mauerwerkspfeiler entspricht der halben Steinlänge zuzüglich Fugen
     * (0,365 m), ein Wandversatz ist so tief wie eine Wand stark. Alle drei
     * sind überschreibbar.
     *
     * `throughAllLevels` ist nur beim Schornstein gesetzt: er beginnt am
     * Feuerraum und geht bis übers Dach. Pfeiler und Versatz gehören zu genau
     * einem Geschoss — beim Übernehmen eines Geschosses ist das der
     * Unterschied zwischen „wird mitkopiert" und „gibt es weiterhin einmal".
     */
    addSolid: (kind, position) => {
      const masse: Record<SolidKind, { width: number; length: number }> = {
        chimney: { width: 0.4, length: 0.4 },
        pier: { width: 0.365, length: 0.365 },
        'wall-offset': { width: 0.24, length: 1 },
        'service-block': { width: 0.3, length: 0.6 },
      };
      const element: SolidElement = {
        id: uid('m'),
        kind,
        name: SOLID_LABELS[kind],
        levelId: get().doc.activeLevelId,
        position: { x: roundMm(position.x), y: roundMm(position.y) },
        width: masse[kind].width,
        length: masse[kind].length,
        rotation: 0,
        throughAllLevels: kind === 'chimney',
      };
      mutate((doc) => {
        if (!doc.solids) doc.solids = {};
        doc.solids[element.id] = element;
      });
      set({
        selection: { kind: 'solid', id: element.id },
        selections: [{ kind: 'solid', id: element.id }],
        statusMessage: `${SOLID_LABELS[kind]} eingesetzt`,
      });
      return element;
    },

    solidFromRoom: (roomId, kind) => {
      const room = get().doc.rooms[roomId];
      if (!room || room.innerPolygon.length < 3) return null;

      // Der Umriss ist die lichte Raumfläche, nicht die Achsfläche: massiv ist
      // das Mauerwerk zwischen den Wänden, und genau das ist das Innenpolygon.
      const outline = room.innerPolygon.map((p) => ({ x: roundMm(p.x), y: roundMm(p.y) }));
      const xs = outline.map((p) => p.x);
      const ys = outline.map((p) => p.y);
      const element: SolidElement = {
        id: uid('m'),
        kind,
        name: SOLID_LABELS[kind],
        levelId: room.levelId,
        position: { x: roundMm(room.centroid.x), y: roundMm(room.centroid.y) },
        width: Math.max(0.05, Math.max(...ys) - Math.min(...ys)),
        length: Math.max(0.05, Math.max(...xs) - Math.min(...xs)),
        rotation: 0,
        outline,
        throughAllLevels: kind === 'chimney',
      };
      mutate((doc) => {
        if (!doc.solids) doc.solids = {};
        doc.solids[element.id] = element;
      });
      set({
        selection: { kind: 'solid', id: element.id },
        selections: [{ kind: 'solid', id: element.id }],
        statusMessage: `${room.name} ist jetzt ${SOLID_LABELS[kind]}`,
      });
      return element;
    },

    updateSolid: (id, patch) =>
      mutate((doc) => {
        const b = (doc.solids ?? {})[id];
        if (!b || !doc.solids) return;
        doc.solids[id] = { ...b, ...patch };
      }),

    legeRohrnetzAus: (mode) => {
      const s = get();
      const ergebnis = planPipeNetwork(s.doc, {
        mode,
        levelId: s.doc.activeLevelId,
        flowTemperature: s.doc.plant?.design.flowTemperature,
        returnTemperature: s.doc.plant?.design.returnTemperature,
        material: s.doc.plant?.design.material,
      });

      mutate((doc) => {
        // Von Hand gezogene Leitungen bleiben; erzeugte werden ersetzt.
        const behalten = Object.values(doc.pipes ?? {}).filter(
          (r) => !(r.generated && r.levelId === doc.activeLevelId),
        );
        doc.pipes = Object.fromEntries([
          ...behalten.map((r) => [r.id, r] as const),
          ...ergebnis.runs.map((r) => [r.id, r] as const),
        ]);
        const armaturen = Object.values(doc.pipeAccessories ?? {}).filter(
          (a) => !(a.generated && a.levelId === doc.activeLevelId),
        );
        doc.pipeAccessories = Object.fromEntries([
          ...armaturen.map((a) => [a.id, a] as const),
          ...ergebnis.accessories.map((a) => [a.id, a] as const),
        ]);
      });

      const schwer = ergebnis.notes.find((n) => n.severity === 'error');
      set({
        statusMessage: schwer
          ? schwer.text
          : `Rohrnetz ausgelegt — ${ergebnis.served} Verbraucher, ${ergebnis.routeLength.toFixed(1)} m Trasse, ` +
            `${ergebnis.pipeLength.toFixed(1)} m Rohr, ${ergebnis.accessories.length} Armaturen`,
      });
      return ergebnis;
    },

    addPipe: (service, points) => {
      if (points.length < 2) return null;
      const run: PipeRun = {
        id: uid('p'),
        levelId: get().doc.activeLevelId,
        service,
        points: points.map((p) => ({ x: roundMm(p.x), y: roundMm(p.y) })),
        nominalDiameter: service.startsWith('ventilation') ? 125 : service === 'waste' ? 100 : 20,
        insulation: service === 'heating-flow' || service === 'heating-return' || service === 'hot-water' ? 20 : 0,
        elevation: service === 'waste' ? -0.1 : 0.05,
      };
      mutate((doc) => {
        doc.pipes[run.id] = run;
      });
      const length = pipeLength(run.points);
      set({
        selection: { kind: 'pipe', id: run.id },
        selections: [{ kind: 'pipe', id: run.id }],
        statusMessage: `${PIPE_SERVICE_LABELS[service]} DN ${run.nominalDiameter} · ${length.toFixed(2)} m verlegt`,
      });
      return run;
    },

    // --- Außenanlage -------------------------------------------------------
    /**
     * Legt ein Objekt im Außengelände an. Punkte, Züge und Flächen liegen in
     * derselben Struktur; welche Form gemeint ist, sagt die Art.
     */
    addSiteElement: (kind, points) => {
      const needed = POLYGON_KINDS.has(kind) ? 3 : LINE_KINDS.has(kind) ? 2 : 1;
      if (points.length < needed) return null;
      const element: SiteElement = {
        id: uid('site'),
        kind,
        points: points.map((p) => ({ x: roundMm(p.x), y: roundMm(p.y) })),
        ...SITE_DEFAULTS[kind],
      };
      mutate((doc) => {
        // Es gibt genau eine Grundstücksgrenze. Eine zweite wäre kein
        // zweites Grundstück, sondern ein Widerspruch.
        if (kind === 'boundary') {
          for (const existing of Object.values(doc.site.elements)) {
            if (existing.kind === 'boundary') delete doc.site.elements[existing.id];
          }
        }
        doc.site.elements[element.id] = element;
      });
      set({
        selection: { kind: 'site', id: element.id },
        selections: [{ kind: 'site', id: element.id }],
        statusMessage: `${SITE_ELEMENT_LABELS[kind]} angelegt`,
      });
      return element;
    },

    updateSiteElement: (id, patch) =>
      mutate((doc) => {
        const element = doc.site.elements[id];
        if (!element) return;
        // Stützpunkte auf den Millimeter runden — dieselbe Regel wie beim
        // Anlegen. Ohne sie sammelt ein Objekt beim Verschieben mit der Maus
        // Nachkommastellen an, die im Lageplan und im Export als krumme
        // Koordinaten wieder auftauchen.
        const points = patch.points
          ? patch.points.map((p) => ({ x: roundMm(p.x), y: roundMm(p.y) }))
          : undefined;
        doc.site.elements[id] = { ...element, ...patch, ...(points ? { points } : {}) };
      }),

    /**
     * Setzt eine Wärmepumpe. Die Vorgabewerte sind bewusst ein durchschnittliches
     * Gerät der 8-kW-Klasse mit Propan — nicht das leiseste am Markt. Wer die
     * Zahlen nicht anfasst, bekommt ein Ergebnis auf der sicheren Seite.
     */
    addHeatPump: (position) => {
      const pump: HeatPump = {
        id: uid('wp'),
        label: 'Wärmepumpe',
        source: 'air',
        form: 'monoblock-outdoor',
        position: { x: roundMm(position.x), y: roundMm(position.y) },
        azimuth: 180,
        width: 1.1,
        depth: 0.5,
        height: 1.3,
        standHeight: 0.3,
        mounting: 'wall',
        soundPower: 55,
        soundPowerNight: 50,
        nightModeGuaranteed: false,
        toneSurcharge: 0,
        refrigerant: 'R290',
        refrigerantMass: 1.5,
        protectionRadius: 1,
        heatingCapacity: 8,
        ratingPoint: 'A-7/W35',
        cop: 3.2,
        operation: 'mono-energetic',
        bivalencePoint: -7,
        backupCapacity: 6,
        flowTemperature: 40,
        gridRegime: 'p14a-dimming',
        blockedHours: 0,
        domesticHotWater: true,
        occupants: 4,
      };
      mutate((doc) => {
        doc.site.pumps[pump.id] = pump;
      });
      set({
        selection: { kind: 'heatpump', id: pump.id },
        selections: [{ kind: 'heatpump', id: pump.id }],
        statusMessage: 'Wärmepumpe gesetzt — Schallnachweis im Reiter „Wärmepumpe"',
      });
      return pump;
    },

    updateHeatPump: (id, patch) =>
      mutate((doc) => {
        const pump = doc.site.pumps[id];
        if (!pump) return;
        // Standort auf den Millimeter runden — wie beim Knoten einer Wand.
        // Der Aufstellort geht in den Schallnachweis ein; ein Abstand mit
        // zwölf Nachkommastellen sähe im Bericht nach Genauigkeit aus, die
        // es nicht gibt.
        const position = patch.position
          ? { x: roundMm(patch.position.x), y: roundMm(patch.position.y) }
          : undefined;
        doc.site.pumps[id] = { ...pump, ...patch, ...(position ? { position } : {}) };
      }),

    updatePlant: (patch) =>
      mutate((doc) => {
        const p = doc.plant;
        doc.plant = {
          ...p,
          generatorModelId: patch.generatorModelId ?? p.generatorModelId,
          pumpId: patch.pumpId ?? p.pumpId,
          heatLoadOverride:
            'heatLoadOverride' in patch ? patch.heatLoadOverride : p.heatLoadOverride,
          secondGenerator: 'secondGenerator' in patch ? patch.secondGenerator : p.secondGenerator,
          cascade: 'cascade' in patch ? patch.cascade : p.cascade,
          cooling: 'cooling' in patch ? patch.cooling : p.cooling,
          additionalConsumer:
            'additionalConsumer' in patch ? patch.additionalConsumer : p.additionalConsumer,
          design: { ...p.design, ...(patch.design ?? {}) },
          safety: { ...p.safety, ...(patch.safety ?? {}) },
          dhw: { ...p.dhw, ...(patch.dhw ?? {}) },
          storages: { ...p.storages },
          circuits: { ...p.circuits },
          schematic: { ...p.schematic },
        };
      }, { skipRooms: true }),

    addPlantStorage: (storage) =>
      mutate((doc) => {
        doc.plant = {
          ...doc.plant,
          storages: { ...doc.plant.storages, [storage.id]: { ...storage, suggested: false } },
        };
      }, { skipRooms: true }),

    removePlantStorage: (id) =>
      mutate((doc) => {
        const storages = { ...doc.plant.storages };
        delete storages[id];
        doc.plant = { ...doc.plant, storages };
      }, { skipRooms: true }),

    setPlantCircuits: (circuits) =>
      mutate((doc) => {
        doc.plant = {
          ...doc.plant,
          circuits: Object.fromEntries(circuits.map((c) => [c.id, c])),
        };
      }, { skipRooms: true }),

    setSchematic: (components, links, manual, vorlageId) =>
      mutate((doc) => {
        doc.plant = {
          ...doc.plant,
          schematic: {
            components: Object.fromEntries(components.map((c) => [c.id, c])),
            links: Object.fromEntries(links.map((l) => [l.id, l])),
            manual: manual ?? doc.plant.schematic.manual,
            // Ohne Angabe bleibt die bisherige Kennung stehen: „neu erzeugen"
            // ändert das Bild, nicht die Zuordnung zur Musterlösung.
            vorlageId: vorlageId ?? doc.plant.schematic.vorlageId,
          },
        };
      }, { skipRooms: true }),

    uebernehmeSchemaVorlage: (vorlageId) => {
      const vorlage = schemaVorlage(vorlageId);
      if (!vorlage) return false;
      mutate((doc) => {
        /*
         * Zuerst die Anlage, dann das Bild.
         *
         * Die Vorlage sagt, wie der Erzeuger an die Kreise kommt. Diese
         * Aussage gehört ins Anlagenblatt, nicht ins Fließbild: `designPlant`
         * rechnet daraus Puffervolumen, Pumpenförderstrom und die Frage, ob
         * ein Überströmventil nötig ist. Zeichnete man erst und trüge den
         * Speicher nicht nach, zeigte das Schema einen Puffer, den die
         * Auslegung nicht kennt — und die Materialliste bestellte ihn nicht.
         */
        const art: StorageKind | undefined =
          vorlage.merkmale.anbindung === 'reihenpuffer'
            ? 'buffer-series'
            : vorlage.merkmale.anbindung === 'parallelpuffer'
              ? 'buffer-parallel'
              : vorlage.merkmale.anbindung === 'weiche'
                ? 'separator'
                : vorlage.merkmale.anbindung === 'kombispeicher'
                  ? 'combi'
                  : undefined;

        const speicher: Record<string, PlantStorage> = {};
        for (const [id, s2] of Object.entries(doc.plant.storages)) {
          // Puffer, Weichen und Kombispeicher werden ersetzt; der
          // Trinkwasserspeicher bleibt — über ihn sagt die Anbindung nichts.
          const istAnbindung =
            s2.kind === 'buffer-series' ||
            s2.kind === 'buffer-parallel' ||
            s2.kind === 'separator' ||
            s2.kind === 'combi';
          if (!istAnbindung) speicher[id] = s2;
        }
        if (art) {
          // Das Volumen bleibt offen: es kommt aus `minimumBufferVolume` und
          // hängt an der Geräteleistung, nicht am Schema. Der Eintrag ist
          // deshalb als Vorschlag markiert, bis die Auslegung ihn füllt.
          const vorhanden = Object.values(doc.plant.storages).find((s2) => s2.kind === art);
          speicher['buffer-vorlage'] = vorhanden ?? {
            id: 'buffer-vorlage',
            label: `${ANBINDUNG_LABELS[vorlage.merkmale.anbindung]} nach ${vorlage.kennung}`,
            kind: art,
            volume: 0,
            suggested: true,
            note: `Aus der Schemavorlage „${vorlage.name}" übernommen.`,
          };
        }

        doc.plant = {
          ...doc.plant,
          storages: speicher,
          schematic: { ...doc.plant.schematic, vorlageId, manual: false },
        };
      }, { skipRooms: true });
      set({ statusMessage: `Schema „${vorlage.name}" übernommen (${vorlage.kennung})` });
      return true;
    },

    updateSchematicComponent: (id, patch) =>
      mutate((doc) => {
        const c = doc.plant.schematic.components[id];
        if (!c) return;
        doc.plant = {
          ...doc.plant,
          schematic: {
            ...doc.plant.schematic,
            components: { ...doc.plant.schematic.components, [id]: { ...c, ...patch } },
            // Sobald jemand von Hand eingreift, wird das Schema nicht mehr
            // ungefragt überschrieben. Der Planer hat dann recht, nicht das
            // Programm.
            manual: true,
          },
        };
      }, { skipRooms: true }),

    addSchematicComponent: (kind, x, y, label) => {
      const component: SchematicComponent = {
        id: uid('sc'),
        kind,
        label: label ?? kind,
        x,
        y,
        generated: false,
      };
      mutate((doc) => {
        doc.plant = {
          ...doc.plant,
          schematic: {
            ...doc.plant.schematic,
            components: { ...doc.plant.schematic.components, [component.id]: component },
            manual: true,
          },
        };
      }, { skipRooms: true });
      set({ statusMessage: `${component.label} ins Schema eingefügt` });
      return component;
    },

    deleteSchematicComponent: (id) =>
      mutate((doc) => {
        const components = { ...doc.plant.schematic.components };
        delete components[id];
        // Eine Verbindung ohne Bauteil ist keine Verbindung. Sie geht mit.
        const links = Object.fromEntries(
          Object.entries(doc.plant.schematic.links).filter(([, l]) => l.from !== id && l.to !== id),
        );
        doc.plant = { ...doc.plant, schematic: { components, links, manual: true } };
      }, { skipRooms: true }),

    addSchematicLink: (from, to, service, label) => {
      if (from === to) return null;
      const { doc } = get();
      const known = doc.plant.schematic.components;
      if (!known[from] || !known[to]) return null;
      // Dieselbe Verbindung zweimal wäre im Bild nicht zu unterscheiden.
      const exists = Object.values(doc.plant.schematic.links).some(
        (l) => l.from === from && l.to === to && l.service === service,
      );
      if (exists) return null;
      const link: SchematicLink = { id: uid('sl'), from, to, service, label, generated: false };
      mutate((d) => {
        d.plant = {
          ...d.plant,
          schematic: {
            ...d.plant.schematic,
            links: { ...d.plant.schematic.links, [link.id]: link },
            manual: true,
          },
        };
      }, { skipRooms: true });
      set({ statusMessage: 'Verbindung gezeichnet' });
      return link;
    },

    deleteSchematicLink: (id) =>
      mutate((doc) => {
        const links = { ...doc.plant.schematic.links };
        delete links[id];
        doc.plant = { ...doc.plant, schematic: { ...doc.plant.schematic, links, manual: true } };
      }, { skipRooms: true }),

    updateSite: (patch) =>
      mutate((doc) => {
        doc.site = { ...doc.site, ...patch };
      }),

    updatePipe: (id, patch) =>
      mutate((doc) => {
        const run = doc.pipes[id];
        if (!run) return;
        doc.pipes[id] = { ...run, ...patch };
      }),

    addRoofOpening: (kind, position) => {
      const doc0 = get().doc;
      const level = doc0.levels[doc0.activeLevelId];
      if (!level?.roof || level.roof.kind === 'flat') {
        set({ statusMessage: 'Erst eine Dachform wählen — ohne Dach gibt es keine Gaube' });
        return null;
      }

      const isSkylight = kind === 'skylight';
      const rooms = Object.values(doc0.rooms).filter((r) => r.levelId === level.id);
      const biggest = rooms.sort((a, b) => b.area - a.area)[0];

      let target = position;
      if (!target) {
        target = biggest ? biggest.centroid : { x: 0, y: 0 };

        // Eine Gaube gehört an die Traufe, nicht an den First: dort, wo die
        // Schräge den Raum unbrauchbar macht, schafft sie Stehhöhe. In der
        // Raummitte gesetzt hätte sie gar keine Front — das Dach ist dort
        // schon höher als die Gaube, und alle Flächen kämen als Null heraus.
        if (!isSkylight && biggest) {
          const outline: Vec2[] = [];
          for (const w of Object.values(doc0.walls)) {
            if (w.levelId !== level.id) continue;
            const na = doc0.nodes[w.a];
            const nb = doc0.nodes[w.b];
            if (na) outline.push({ x: na.x, y: na.y });
            if (nb) outline.push({ x: nb.x, y: nb.y });
          }
          const frame = buildRoofFrame(level.roof, outline);
          if (frame) {
            // Gesucht ist die *niedrigste* Stelle im Raum — dort steht man
            // nicht mehr, und genau dort hilft eine Gaube. Einfach in
            // Fallrichtung zu tasten wäre falsch: bei einem Raum, der an
            // einer Innenwand endet, liefe man auf den First zu.
            const poly = biggest.innerPolygon;
            let minX = Infinity;
            let minY = Infinity;
            let maxX = -Infinity;
            let maxY = -Infinity;
            for (const pt of poly) {
              minX = Math.min(minX, pt.x);
              minY = Math.min(minY, pt.y);
              maxX = Math.max(maxX, pt.x);
              maxY = Math.max(maxY, pt.y);
            }
            // Gesucht: die niedrigste Stelle — und unter mehreren gleich
            // niedrigen die, die am wenigsten in der Ecke liegt. Sonst
            // landet die Gaube am Traufpunkt der Zimmerecke statt mittig
            // an der Traufe, wo sie hingehört.
            let bestPoint = biggest.centroid;
            let bestHeight = Infinity;
            let bestOffset = Infinity;
            for (let y = minY; y <= maxY; y += 0.2) {
              for (let x = minX; x <= maxX; x += 0.2) {
                const probe = { x, y };
                if (!pointInPolygon(probe, poly)) continue;
                const h = baseRoofHeightAt(frame, probe);
                // Abstand längs des Firsts zur Raummitte — quer dazu zählt
                // nur die Höhe.
                const offset = Math.abs(
                  (probe.x - biggest.centroid.x) * frame.along.x +
                    (probe.y - biggest.centroid.y) * frame.along.y,
                );
                if (h < bestHeight - 0.01 || (h < bestHeight + 0.01 && offset < bestOffset)) {
                  bestHeight = Math.min(bestHeight, h);
                  bestOffset = offset;
                  bestPoint = probe;
                }
              }
            }
            // Die Front sitzt an dieser Stelle, der Mittelpunkt liegt eine
            // halbe Gaubentiefe *firstwärts* dahinter — auf der Westseite
            // eines Satteldachs also in die andere Richtung als auf der Ost.
            const side = dormerSide(frame, { position: bestPoint });
            const candidate = {
              x: bestPoint.x - frame.dir.x * 0.75 * side,
              y: bestPoint.y - frame.dir.y * 0.75 * side,
            };

            // Die Gaube ganz in den Raum schieben: liegt ihre Breite quer zum
            // First teilweise außerhalb, wandert sie so weit hinein, bis sie
            // passt. Eine halb im Freien stehende Gaube wäre kein Vorschlag,
            // sondern ein Fehler, den jemand von Hand korrigieren müsste.
            let shift = 0;
            for (let step = 0; step <= 40; step++) {
              const trial = step === 0 ? 0 : (step % 2 === 1 ? 1 : -1) * Math.ceil(step / 2) * 0.2;
              const probe = {
                x: candidate.x + frame.along.x * trial,
                y: candidate.y + frame.along.y * trial,
              };
              const corners = [-1, 1].flatMap((su) =>
                [-1, 1].map((st) => ({
                  x: probe.x + frame.along.x * su * 0.95 + frame.dir.x * st * 0.7,
                  y: probe.y + frame.along.y * su * 0.95 + frame.dir.y * st * 0.7,
                })),
              );
              if (corners.every((c) => pointInPolygon(c, poly))) {
                shift = trial;
                break;
              }
            }
            target = {
              x: candidate.x + frame.along.x * shift,
              y: candidate.y + frame.along.y * shift,
            };
          }
        }
      }
      const opening: RoofOpening = {
        id: uid('ro'),
        levelId: level.id,
        kind,
        position: { x: roundMm(target.x), y: roundMm(target.y) },
        // Vorgaben: Dachfenster 78 × 118 cm (das gängigste Maß), Gaube 2,00 m
        // breit, 1,50 m tief, 2,20 m lichte Front.
        width: isSkylight ? 0.78 : 2,
        depth: isSkylight ? 1.18 : 1.5,
        frontHeight: isSkylight ? undefined : 2.2,
        frontWindowArea: isSkylight ? undefined : 1.6,
        uValue: isSkylight ? 1.3 : 0.2,
        gValue: isSkylight ? 0.5 : undefined,
        frontUValue: isSkylight ? undefined : 0.24,
      };
      mutate((doc) => {
        doc.roofOpenings[opening.id] = opening;
      });
      set({
        selection: { kind: 'roofOpening', id: opening.id },
        selections: [{ kind: 'roofOpening', id: opening.id }],
        statusMessage: `${ROOF_OPENING_LABELS[kind]} eingesetzt — mit dem Auswahl-Werkzeug verschieben`,
      });
      return opening;
    },

    updateRoofOpening: (id, patch) =>
      mutate((doc) => {
        const o = doc.roofOpenings[id];
        if (!o) return;
        doc.roofOpenings[id] = { ...o, ...patch };
      }),

    addAnnotation: (kind, points, text) => {
      if (!points.length) return null;
      if (kind !== 'text' && points.length < 2) return null;
      const note: Annotation = {
        id: uid('a'),
        kind,
        levelId: get().doc.activeLevelId,
        points: points.map((p) => ({ x: roundMm(p.x), y: roundMm(p.y) })),
        offset: kind === 'dimension' ? 0.4 : 0,
        text,
        scale: 1,
      };
      mutate((doc) => {
        doc.annotations[note.id] = note;
      });
      set({
        selection: { kind: 'annotation', id: note.id },
        selections: [{ kind: 'annotation', id: note.id }],
        statusMessage:
          kind === 'dimension'
            ? `Maßkette ${Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y).toFixed(3)} m`
            : 'Beschriftung gesetzt — Text im Inspektor eingeben',
      });
      return note;
    },

    updateAnnotation: (id, patch) =>
      mutate((doc) => {
        const note = doc.annotations[id];
        if (!note) return;
        doc.annotations[id] = { ...note, ...patch };
      }),

    setRoof: (levelId, patch) => {
      mutate((doc) => {
        const level = doc.levels[levelId];
        if (!level) return;
        if (patch === null) {
          doc.levels[levelId] = { ...level, roof: undefined };
          return;
        }
        doc.levels[levelId] = { ...level, roof: { ...DEFAULT_ROOF, ...level.roof, ...patch } };
      });
      const roof = get().doc.levels[levelId]?.roof;
      set({
        statusMessage: roof
          ? `Dach: ${ROOF_KIND_LABELS[roof.kind]} · ${roof.pitch.toFixed(0)}° · Kniestock ${roof.kneeHeight.toFixed(2)} m`
          : 'Dach entfernt — Decke wieder waagerecht',
      });
    },

    updateLevel: (id, patch) =>
      mutate((doc) => {
        const level = doc.levels[id];
        if (!level) return;
        doc.levels[id] = { ...level, ...patch };
        // Wandhöhen dem Geschoss folgen lassen, solange sie nicht abweichen
        if (patch.height !== undefined) {
          for (const w of Object.values(doc.walls)) {
            if (Math.abs(w.height - level.height) < EPS) {
              doc.walls[w.id] = { ...w, height: patch.height };
            }
          }
        }
      }),

    toggleLayer: (id) =>
      mutate(
        (doc) => {
          const layer = doc.layers[id];
          if (layer) doc.layers[id] = { ...layer, visible: !layer.visible };
        },
        { skipRooms: true },
      ),

    deleteSelection: () => {
      const { selections, selection } = get();
      const targets = selections.length ? selections : selection ? [selection] : [];
      if (!targets.length) return;

      mutate((doc) => {
        for (const sel of targets) {
          if (sel.kind === 'wall') {
            delete doc.walls[sel.id];
            for (const o of Object.values(doc.openings)) {
              if (o.wallId === sel.id) delete doc.openings[o.id];
            }
            // TGA-Objekte bleiben erhalten, verlieren aber ihre Wandbindung.
            for (const f of Object.values(doc.fixtures)) {
              if (f.wallId === sel.id) doc.fixtures[f.id] = { ...f, wallId: undefined };
            }
          } else if (sel.kind === 'opening') {
            delete doc.openings[sel.id];
          } else if (sel.kind === 'fixture') {
            delete doc.fixtures[sel.id];
          } else if (sel.kind === 'vertical') {
            delete doc.verticals[sel.id];
          } else if (sel.kind === 'solid') {
            if (doc.solids) delete doc.solids[sel.id];
          } else if (sel.kind === 'pipe') {
            delete doc.pipes[sel.id];
          } else if (sel.kind === 'annotation') {
            delete doc.annotations[sel.id];
          } else if (sel.kind === 'roofOpening') {
            delete doc.roofOpenings[sel.id];
          } else if (sel.kind === 'site') {
            delete doc.site.elements[sel.id];
          } else if (sel.kind === 'heatpump') {
            delete doc.site.pumps[sel.id];
          } else if (sel.kind === 'node') {
            for (const w of Object.values(doc.walls)) {
              if (w.a === sel.id || w.b === sel.id) {
                delete doc.walls[w.id];
                for (const o of Object.values(doc.openings)) {
                  if (o.wallId === w.id) delete doc.openings[o.id];
                }
              }
            }
          }
        }
        pruneNodes(doc);
      });
      set({ selection: null, selections: [], statusMessage: `${targets.length} Objekt(e) gelöscht` });
    },

    clearAll: () =>
      mutate((doc) => {
        doc.nodes = {};
        doc.walls = {};
        doc.openings = {};
        doc.fixtures = {};
        doc.verticals = {};
        doc.solids = {};
        doc.pipes = {};
        doc.annotations = {};
        doc.roofOpenings = {};
        doc.rooms = {};
      }),

    loadDemo: () => {
      mutate((doc) => {
        doc.nodes = {};
        doc.walls = {};
        doc.openings = {};
        doc.fixtures = {};
        doc.rooms = {};

        const mk = (x: number, y: number): BimNode => {
          const n: BimNode = { id: uid('n'), x, y, levelId: doc.activeLevelId };
          doc.nodes[n.id] = n;
          return n;
        };
        const link = (a: BimNode, b: BimNode, thickness: number, type: WallType, uValue: number) => {
          const w: Wall = {
            id: uid('w'),
            levelId: doc.activeLevelId,
            a: a.id,
            b: b.id,
            thickness,
            height: 2.75,
            type,
            layerId: 'layer-walls',
            uValue,
          };
          doc.walls[w.id] = w;
          return w;
        };

        // Außenhülle 10,00 × 7,50 m
        const p1 = mk(0, 0);
        const p2 = mk(10, 0);
        const p3 = mk(10, 7.5);
        const p4 = mk(0, 7.5);
        // Innere Achsen
        const q1 = mk(6, 0);
        const q2 = mk(6, 7.5);
        const q3 = mk(6, 4.2);
        const q4 = mk(10, 4.2);

        const south = link(p1, q1, 0.365, 'exterior', 0.21);
        const south2 = link(q1, p2, 0.365, 'exterior', 0.21);
        const east1 = link(p2, q4, 0.365, 'exterior', 0.21);
        const east2 = link(q4, p3, 0.365, 'exterior', 0.21);
        const north = link(p3, q2, 0.365, 'exterior', 0.21);
        const north2 = link(q2, p4, 0.365, 'exterior', 0.21);
        const west = link(p4, p1, 0.365, 'exterior', 0.21);
        const spineS = link(q1, q3, 0.175, 'interior', 1.2);
        const spineN = link(q3, q2, 0.175, 'interior', 1.2);
        const cross = link(q3, q4, 0.115, 'partition', 1.4);

        const openings: Omit<Opening, 'id'>[] = [
          { wallId: south.id, kind: 'window', distance: 3, width: 1.51, height: 1.385, sillHeight: 0.9, uValue: 0.95, gValue: 0.6 },
          { wallId: south2.id, kind: 'door', distance: 1.8, width: 1.01, height: 2.135, sillHeight: 0, uValue: 1.4, hinge: 'left' },
          { wallId: west.id, kind: 'window', distance: 3.7, width: 1.26, height: 1.385, sillHeight: 0.9, uValue: 0.95, gValue: 0.6 },
          { wallId: north2.id, kind: 'window', distance: 2.1, width: 1.76, height: 1.385, sillHeight: 0.9, uValue: 0.95, gValue: 0.6 },
          { wallId: east1.id, kind: 'window', distance: 2.1, width: 0.885, height: 1.135, sillHeight: 1.1, uValue: 0.95, gValue: 0.6 },
          { wallId: east2.id, kind: 'window', distance: 1.6, width: 1.26, height: 1.385, sillHeight: 0.9, uValue: 0.95, gValue: 0.6 },
          { wallId: spineS.id, kind: 'door', distance: 2.1, width: 0.885, height: 2.01, sillHeight: 0, uValue: 1.8, hinge: 'right' },
          { wallId: spineN.id, kind: 'door', distance: 1.7, width: 0.885, height: 2.01, sillHeight: 0, uValue: 1.8, hinge: 'left' },
          { wallId: cross.id, kind: 'door', distance: 2.6, width: 0.76, height: 2.01, sillHeight: 0, uValue: 1.8, hinge: 'left' },
        ];
        for (const o of openings) {
          const id = uid('o');
          doc.openings[id] = { ...o, id };
        }

        // Ein Durchgang ohne Tür — zeigt die Aussparung in 2D und 3D.
        const passageId = uid('o');
        doc.openings[passageId] = {
          id: passageId,
          wallId: cross.id,
          kind: 'passage',
          distance: 1.2,
          width: 1.26,
          height: 2.135,
          sillHeight: 0,
          passageType: 'lintel',
        };

        // TGA-Ausstattung: Heizkörper unter den Fenstern, Bad und Lüftung.
        const place = (
          type: FixtureType,
          x: number,
          y: number,
          rotation: number,
          params: Record<string, unknown> = {},
        ) => {
          const def = FIXTURE_BY_TYPE[type];
          const id = uid('f');
          doc.fixtures[id] = {
            id,
            type,
            category: def.category,
            levelId: doc.activeLevelId,
            position: { x, y },
            rotation,
            length: def.length,
            depth: def.depth,
            elevation: def.elevation,
            label: def.label,
            params: { ...def.params, ...params },
          };
        };

        place('radiator', 3, 0.28, 0, { powerW: 1400 });
        place('radiator', 0.28, 3.7, 90, { powerW: 1100 });
        place('radiator', 2.1, 7.22, 180, { powerW: 900 });
        place('radiator', 9.72, 2.1, 270, { powerW: 700 });
        place('wc', 8.6, 6.6, 180);
        place('washbasin', 9.4, 6.9, 180);
        place('shower', 7.2, 6.6, 0);
        place('air-exhaust', 8.3, 5.6, 0, { airflow: 60 });
        place('air-supply', 3, 4, 0, { airflow: 45 });
        place('manifold', 6.4, 1.2, 90);

        void north;
      });

      // Räume sinnvoll benennen (nach Größe sortiert vorhanden)
      const rooms = Object.values(get().doc.rooms);
      const naming: { name: string; usage: Room['usage'] }[] = [
        { name: 'Wohnen / Essen', usage: 'living' },
        { name: 'Schlafen', usage: 'bedroom' },
        { name: 'Bad', usage: 'bath' },
        { name: 'Flur', usage: 'hallway' },
      ];
      rooms.forEach((room, i) => {
        const preset = naming[i];
        if (preset) get().updateRoom(room.id, { name: preset.name, usage: preset.usage });
      });
      set({ statusMessage: 'Demo-Grundriss geladen' });
    },

    /**
     * Liest eine IFC4-Datei ein.
     *
     * Anders als beim Projektexport entsteht daraus bewusst ein *neues*
     * Dokument: eine Fremddatei in ein bestehendes Modell zu mischen wäre
     * kaum kontrollierbar. Der Schritt liegt in der Historie, ein Undo holt
     * den vorherigen Stand zurück.
     */
    loadIfc: (text) => {
      const result = importIfc(text);
      if (!result.ok) return { ok: false, message: result.message };

      const fresh = emptyDocument();
      fresh.meta = {
        ...fresh.meta,
        name: result.projectName || 'IFC-Import',
        modifiedAt: new Date().toISOString(),
      };
      // Geschossnamen: eine IFC-Datei liefert oft nur „Geschoss 1, 2, 3".
      // Benannt wird deshalb nach der Höhenlage — das Erdgeschoss ist das
      // Geschoss am Bezugspunkt, nicht das unterste. Sprechende Namen aus der
      // Datei bleiben stehen.
      const sortiertNachHoehe = [...result.levels].sort((a, b) => a.elevation - b.elevation);
      const namen = benenneGeschosse(sortiertNachHoehe);
      const egIdx = erdgeschossIndex(sortiertNachHoehe.map((l) => l.elevation));
      fresh.levels = Object.fromEntries(
        sortiertNachHoehe.map((l, i) => [
          l.id,
          {
            id: l.id,
            name: namen[i],
            order: i - egIdx,
            elevation: l.elevation,
            height: l.height,
            // Erdreich liegt unter dem *untersten* Geschoss, nicht unter dem
            // Erdgeschoss: hat das Haus einen Keller, steht das EG auf dessen
            // Decke.
            floorUValue: i === 0 ? 0.3 : 0.9,
            floorBoundary: i === 0 ? ('ground' as const) : ('adjacent-room' as const),
            ceilingUValue: 0.2,
            ceilingBoundary: 'unheated' as const,
          },
        ]),
      );
      // Angefangen wird im Erdgeschoss. Das unterste Geschoss ist bei einem
      // unterkellerten Haus der Keller, und niemand beginnt ein Aufmaß dort.
      fresh.activeLevelId = sortiertNachHoehe[egIdx]?.id ?? sortiertNachHoehe[0]?.id ?? fresh.activeLevelId;
      fresh.nodes = Object.fromEntries(result.nodes.map((n) => [n.id, n]));
      fresh.walls = Object.fromEntries(result.walls.map((w) => [w.id, w]));
      fresh.openings = Object.fromEntries(result.openings.map((o) => [o.id, o]));
      recomputeRooms(fresh);

      set({
        doc: fresh,
        past: [...get().past.slice(-49), get().doc],
        future: [],
        selection: null,
        selections: [],
      });

      const rooms = Object.keys(fresh.rooms).length;
      const skipped = result.skipped.reduce((sum, s2) => sum + s2.count, 0);
      return {
        ok: true,
        message:
          `IFC ${result.schema ?? ''}: ${result.walls.length} Wände, ${result.openings.length} Öffnungen, ` +
          `${rooms} Räume erkannt` +
          (skipped ? ` — ${skipped} Bauteile übersprungen (${result.skipped[0].reason})` : ''),
      };
    },

    neuesDokument: (name) => {
      const frisch = emptyDocument();
      frisch.meta.name = name.trim() || 'Neues Projekt';
      set({
        doc: frisch,
        past: [],
        future: [],
        selection: null,
        selections: [],
        trace: null,
        statusMessage: `Neues Projekt „${frisch.meta.name}“ angelegt`,
      });
      return frisch;
    },

    /**
     * Liest eine Exportdatei zurück. Die Rohgeometrie im Block `geometry` ist
     * dafür vorgesehen: Knoten, Wände, Öffnungen und TGA-Objekte kommen
     * unverändert zurück, Räume werden neu erkannt und bekommen Namen,
     * Nutzung und Temperaturen aus der Datei zurückgespielt.
     */
    loadProject: (data) => {
      const raw = data as Record<string, unknown> | null;
      if (!raw || typeof raw !== 'object') return { ok: false, message: 'Keine gültige JSON-Datei' };
      if (raw.schema !== 'ravia.bim.light') {
        return { ok: false, message: 'Das ist keine RaVia-CAD-Light-Projektdatei' };
      }
      const geometry = raw.geometry as
        | {
            nodes?: BimNode[];
            walls?: Wall[];
            openings?: Opening[];
            fixtures?: Fixture[];
            verticals?: VerticalElement[];
            solids?: SolidElement[];
            pipes?: PipeRun[];
            annotations?: Annotation[];
            roofOpenings?: RoofOpening[];
          }
        | undefined;
      if (!geometry?.nodes || !geometry.walls) {
        return { ok: false, message: 'Die Datei enthält keine Rohgeometrie' };
      }

      const fresh = emptyDocument();
      fresh.meta = { ...fresh.meta, ...(raw.project as object), modifiedAt: new Date().toISOString() };
      const levels = raw.levels as Level[] | undefined;
      if (levels?.length) {
        // Ältere Dateien kennen `order` noch nicht — aus der Höhenlage ableiten.
        const sorted = [...levels].sort((a, b) => (a.elevation ?? 0) - (b.elevation ?? 0));
        fresh.levels = Object.fromEntries(
          sorted.map((l, i) => [
            l.id,
            {
              ...l,
              order: typeof l.order === 'number' ? l.order : i,
              floorUValue: l.floorUValue ?? 0.3,
              floorBoundary: l.floorBoundary ?? 'ground',
              ceilingUValue: l.ceilingUValue ?? 0.2,
              ceilingBoundary: l.ceilingBoundary ?? 'unheated',
            },
          ]),
        );
        // Angefangen wird im Erdgeschoss — nicht im untersten Geschoss.
        // `order === 0` ist per Aufbau das EG; fehlt es (alte Datei ohne
        // Ordnung), greift die Höhenlage.
        const egId =
          sorted.find((l) => l.order === 0)?.id ??
          sorted[erdgeschossIndex(sorted.map((l) => l.elevation ?? Number.NaN))]?.id ??
          sorted[0].id;
        fresh.activeLevelId = egId;
      }
      const fallbackLevel = fresh.activeLevelId;
      // Geometrie aus Dateien vor der Mehrgeschossigkeit bekommt das erste Geschoss.
      fresh.nodes = Object.fromEntries(
        geometry.nodes.map((n) => [n.id, { ...n, levelId: n.levelId ?? fallbackLevel }]),
      );
      fresh.walls = Object.fromEntries(
        geometry.walls.map((w) => [w.id, { ...w, levelId: w.levelId ?? fallbackLevel }]),
      );
      fresh.openings = Object.fromEntries((geometry.openings ?? []).map((o) => [o.id, o]));
      fresh.fixtures = Object.fromEntries(
        (geometry.fixtures ?? []).map((f) => [f.id, { ...f, levelId: f.levelId ?? fallbackLevel }]),
      );
      fresh.verticals = Object.fromEntries(
        (geometry.verticals ?? []).map((v) => [v.id, { ...v, levelId: v.levelId ?? fallbackLevel }]),
      );
      // Ohne diese Zeile ginge ein Kamin beim Speichern und Öffnen verloren —
      // still, und das ist die schlimmste Art von Datenverlust. Ältere Dateien
      // führen den Block nicht; dann bleibt die Sammlung leer.
      fresh.solids = Object.fromEntries(
        (geometry.solids ?? []).map((b) => [b.id, { ...b, levelId: b.levelId ?? fallbackLevel }]),
      );
      fresh.pipes = Object.fromEntries(
        (geometry.pipes ?? []).map((pr) => [pr.id, { ...pr, levelId: pr.levelId ?? fallbackLevel }]),
      );
      fresh.annotations = Object.fromEntries(
        (geometry.annotations ?? []).map((an) => [an.id, { ...an, levelId: an.levelId ?? fallbackLevel }]),
      );
      fresh.roofOpenings = Object.fromEntries(
        (geometry.roofOpenings ?? []).map((ro) => [ro.id, { ...ro, levelId: ro.levelId ?? fallbackLevel }]),
      );

      const constructions = raw.constructions as Construction[] | undefined;
      if (constructions?.length) {
        fresh.constructions = Object.fromEntries(constructions.map((c) => [c.id, c]));
      }

      recomputeRooms(fresh);

      // Raumbezogene Angaben zuordnen — über den Schwerpunkt, weil sich die
      // Raum-IDs bei der Neuerkennung ändern können.
      const savedRooms = (raw.rooms as Record<string, unknown>[] | undefined) ?? [];
      for (const saved of savedRooms) {
        const polygon = saved.polygon as Vec2[] | undefined;
        if (!polygon?.length) continue;
        let cx = 0;
        let cy = 0;
        for (const p of polygon) {
          cx += p.x;
          cy += p.y;
        }
        const centre = { x: cx / polygon.length, y: cy / polygon.length };
        const match = Object.values(fresh.rooms).find(
          (r) => r.innerPolygon.length >= 3 && pointInPolygon(centre, r.innerPolygon),
        );
        if (!match) continue;
        fresh.rooms[match.id] = {
          ...match,
          name: (saved.name as string) ?? match.name,
          usage: (saved.usage as Room['usage']) ?? match.usage,
          setpointTemperature: (saved.setpointTemperature as number) ?? match.setpointTemperature,
          airChangeRate: (saved.airChangeRate as number) ?? match.airChangeRate,
          isHeated: (saved.isHeated as boolean) ?? match.isHeated,
          heightOverride: saved.heightOverride as number | undefined,
          // Eine von der Gegenstelle gerechnete Heizlast gehört zum Raum und
          // nicht zur Sitzung. Ginge sie beim Öffnen verloren, müsste RaVia
          // nach jedem Speichern erneut rechnen — und niemand würde merken,
          // dass die Auslegung wieder auf dem Überschlag steht.
          normHeatLoad: (saved.normHeatLoad as Room['normHeatLoad']) ?? match.normHeatLoad,
        };
      }

      set({
        doc: fresh,
        past: [],
        future: [],
        selection: null,
        trace: null,
        statusMessage: `Projekt geladen: ${Object.keys(fresh.walls).length} Wände, ${Object.keys(fresh.rooms).length} Räume`,
      });
      return { ok: true, message: 'Projekt geladen' };
    },

    /** Ersetzt das Dokument vollständig — Autosave-Wiederherstellung. */
    /**
     * Der Rückweg aus RaVia.
     *
     * Die Prüfung und das Anwenden stecken vollständig in `lib/hostPatch.ts`;
     * hier bleibt nur, was ohne Store nicht geht: Historie schreiben, Räume
     * *nicht* neu erkennen (die Geometrie hat sich nicht geändert) und die
     * Statuszeile setzen, damit der Mensch am Bildschirm sieht, dass gerade
     * jemand anderes etwas geändert hat.
     */
    applyHostPatch: (patch) => {
      const { doc, past } = get();
      const result = applyPatchToDocument(doc, patch, new Date().toISOString());
      if (result.changed) {
        set({
          doc: result.doc,
          past: [...past.slice(-49), doc],
          future: [],
          statusMessage: result.report.summary,
        });
      } else {
        set({ statusMessage: result.report.summary });
      }
      return result.report;
    },

    replaceDocument: (next, message) =>
      set({
        doc: next,
        past: [],
        future: [],
        selection: null,
        selections: [],
        trace: null,
        statusMessage: message ?? 'Dokument ersetzt',
      }),

    // ------------------------------------------------------- Referenzbild
    setImage: (image) => mutate((doc) => { doc.image = image; }, { skipRooms: true }),

    updateImage: (patch) =>
      mutate(
        (doc) => {
          if (doc.image) doc.image = { ...doc.image, ...patch };
        },
        { skipRooms: true },
      ),

    /** Verschiebt das Referenzbild — nur, solange es nicht gesperrt ist. */
    moveImage: (delta) =>
      mutate(
        (doc) => {
          if (!doc.image || doc.image.locked) return;
          doc.image = {
            ...doc.image,
            origin: { x: doc.image.origin.x + delta.x, y: doc.image.origin.y + delta.y },
          };
        },
        { skipRooms: true },
      ),

    applyCalibration: (from, to, realLength) => {
      mutate(
        (doc) => {
          if (!doc.image || realLength <= 0) return;
          const drawn = distance(from, to);
          if (drawn < EPS) return;
          const factor = realLength / drawn;
          // Bild um den Startpunkt der Messstrecke skalieren, damit dieser fix bleibt.
          const origin = doc.image.origin;
          doc.image = {
            ...doc.image,
            scale: doc.image.scale * factor,
            origin: {
              x: from.x + (origin.x - from.x) * factor,
              y: from.y + (origin.y - from.y) * factor,
            },
            calibration: { from, to, realLength },
          };
        },
        { skipRooms: true },
      );
      set({ statusMessage: `Kalibriert auf ${realLength.toFixed(2)} m`, tool: 'select' });
    },

    // ---------------------------------------------------------- Auto-Trace
    /**
     * Wandelt eine Vision-Antwort in eine *Vorschau* um. Es wird noch nichts
     * ins Dokument geschrieben — der Nutzer prüft erst, verwirft einzelne
     * Vektoren und bestätigt dann bewusst mit "Vorschlag übernehmen".
     */
    buildTrace: (analysis) => {
      const image = get().doc.image;
      if (!image) {
        set({ statusMessage: 'Kein Referenzbild geladen' });
        return;
      }
      const scale = image.scale;
      // Bildkoordinaten laufen nach unten, Modellkoordinaten nach oben.
      const toWorld = (p: Vec2): Vec2 => ({
        x: image.origin.x + p.x * scale,
        y: image.origin.y - p.y * scale,
      });

      const walls: TraceWallCandidate[] = analysis.walls.map((det) => {
        const thickness = Math.max(0.06, roundMm(det.thicknessPx * scale));
        return {
          id: uid('tw'),
          kind: 'wall',
          start: toWorld(det.start),
          end: toWorld(det.end),
          thickness,
          confidence: det.confidence,
          type: det.type ?? (thickness >= 0.24 ? 'exterior' : 'interior'),
          rejected: false,
        };
      });

      const openings: TraceOpeningCandidate[] = analysis.openings.map((det) => ({
        id: uid('to'),
        // Die Vision-Erkennung liefert nur Tür/Fenster — Durchgänge lassen
        // sich aus einem Grundriss-Bitmap nicht zuverlässig unterscheiden.
        kind: det.kind === 'door' ? 'door' : 'window',
        center: toWorld(det.center),
        width: Math.max(0.5, roundMm(det.widthPx * scale)),
        height: det.heightM ?? (det.kind === 'door' ? 2.01 : 1.385),
        sillHeight: det.sillHeightM ?? (det.kind === 'door' ? 0 : 0.9),
        confidence: det.confidence,
        rejected: false,
      }));

      set({
        trace: {
          source: analysis.modelId,
          createdAt: new Date().toISOString(),
          walls,
          openings,
          roomLabels: analysis.roomLabels,
          visible: true,
          minConfidence: 0.4,
          overallConfidence: analysis.confidence,
          durationMs: analysis.durationMs,
        },
        statusMessage: `Auto-Trace: ${walls.length} Wände, ${openings.length} Öffnungen erkannt — bitte prüfen`,
      });
    },

    setTraceVisible: (visible) => {
      const trace = get().trace;
      if (trace) set({ trace: { ...trace, visible } });
    },

    setTraceMinConfidence: (minConfidence) => {
      const trace = get().trace;
      if (trace) set({ trace: { ...trace, minConfidence } });
    },

    rejectTraceCandidate: (id) => {
      const trace = get().trace;
      if (!trace) return;
      set({
        trace: {
          ...trace,
          walls: trace.walls.map((w) => (w.id === id ? { ...w, rejected: true } : w)),
          openings: trace.openings.map((o) => (o.id === id ? { ...o, rejected: true } : o)),
        },
        selection: null,
      });
    },

    restoreTraceCandidate: (id) => {
      const trace = get().trace;
      if (!trace) return;
      set({
        trace: {
          ...trace,
          walls: trace.walls.map((w) => (w.id === id ? { ...w, rejected: false } : w)),
          openings: trace.openings.map((o) => (o.id === id ? { ...o, rejected: false } : o)),
        },
      });
    },

    /** Übernimmt alle nicht verworfenen Vorschläge als echte CAD-Objekte. */
    acceptTrace: () => {
      const trace = get().trace;
      if (!trace) return;
      const threshold = trace.minConfidence;
      const acceptedWalls = trace.walls.filter((w) => !w.rejected && w.confidence >= threshold);
      const acceptedOpenings = trace.openings.filter((o) => !o.rejected && o.confidence >= threshold);

      mutate((doc) => {
        const level = doc.levels[doc.activeLevelId];
        const createdIds: string[] = [];

        for (const cand of acceptedWalls) {
          // Toleranz 8 cm: erkannte Endpunkte streuen, sollen aber verschmelzen.
          const a = nodeAt(doc, cand.start, 0.08);
          const b = nodeAt(doc, cand.end, 0.08);
          if (a.id === b.id) continue;
          const exists = Object.values(doc.walls).some(
            (w) => (w.a === a.id && w.b === b.id) || (w.a === b.id && w.b === a.id),
          );
          if (exists) continue;

          const wall: Wall = {
            id: uid('w'),
            levelId: doc.activeLevelId,
            a: a.id,
            b: b.id,
            thickness: cand.thickness,
            height: level?.height ?? 2.75,
            type: cand.type,
            layerId: 'layer-walls',
            uValue: cand.type === 'exterior' ? 0.24 : 1.2,
            confidence: cand.confidence,
          };
          doc.walls[wall.id] = wall;
          createdIds.push(wall.id);
        }

        // Öffnungen der jeweils nächstgelegenen übernommenen Wand zuordnen.
        for (const cand of acceptedOpenings) {
          let bestWallId = '';
          let bestDist = 0.6;
          let bestAlong = 0;
          for (const id of createdIds) {
            const wall = doc.walls[id];
            if (!wall) continue;
            const na = doc.nodes[wall.a];
            const nb = doc.nodes[wall.b];
            const dx = nb.x - na.x;
            const dy = nb.y - na.y;
            const lenSq = dx * dx + dy * dy;
            if (lenSq < EPS) continue;
            let t = ((cand.center.x - na.x) * dx + (cand.center.y - na.y) * dy) / lenSq;
            t = Math.min(1, Math.max(0, t));
            const d = Math.hypot(na.x + dx * t - cand.center.x, na.y + dy * t - cand.center.y);
            if (d < bestDist) {
              bestDist = d;
              bestWallId = wall.id;
              bestAlong = t * Math.sqrt(lenSq);
            }
          }
          if (!bestWallId) continue;

          const wall = doc.walls[bestWallId];
          const wallLength = distance(doc.nodes[wall.a], doc.nodes[wall.b]);
          const half = cand.width / 2;
          if (wallLength < cand.width + 0.02) continue;
          const clamped = Math.min(Math.max(bestAlong, half), wallLength - half);
          const overlaps = Object.values(doc.openings).some(
            (o) => o.wallId === bestWallId && Math.abs(o.distance - clamped) < (o.width + cand.width) / 2,
          );
          if (overlaps) continue;

          const id = uid('o');
          doc.openings[id] = {
            id,
            wallId: bestWallId,
            kind: cand.kind,
            distance: roundMm(clamped),
            width: cand.width,
            height: cand.height,
            sillHeight: cand.sillHeight,
            uValue: cand.kind === 'door' ? 1.6 : 0.95,
            gValue: cand.kind === 'window' ? 0.6 : undefined,
            confidence: cand.confidence,
          };
        }
      });

      // OCR-Raumstempel auf die neu erkannten Räume übertragen.
      const rooms = Object.values(get().doc.rooms);
      const image = get().doc.image;
      if (image) {
        for (const label of trace.roomLabels) {
          const world = {
            x: image.origin.x + label.position.x * image.scale,
            y: image.origin.y - label.position.y * image.scale,
          };
          let best: Room | undefined;
          let bestDist = Infinity;
          for (const room of rooms) {
            const d = distance(room.centroid, world);
            if (d < bestDist) {
              bestDist = d;
              best = room;
            }
          }
          if (best && bestDist < 3.5) {
            const clean = label.text.replace(/[\d.,]+\s*m²/i, '').trim();
            if (clean) get().updateRoom(best.id, { name: clean });
          }
        }
      }

      set({
        trace: null,
        statusMessage: `${acceptedWalls.length} Wände und ${acceptedOpenings.length} Öffnungen übernommen`,
      });
    },

    clearTrace: () => set({ trace: null, statusMessage: 'Auto-Trace verworfen' }),

    // ----------------------------------------------------------- Historie
    beginGesture: () => {
      gestureActive = true;
      gestureRecorded = false;
    },
    endGesture: () => {
      gestureActive = false;
      gestureRecorded = false;
    },

    undo: () => {
      // Eine offene Geste würde den zurückgeholten Stand gleich wieder
      // überschreiben, ohne ihn abzulegen. Rückgängig beendet sie deshalb.
      gestureActive = false;
      gestureRecorded = false;
      const { past, doc, future } = get();
      if (!past.length) return;
      set({
        doc: past[past.length - 1],
        past: past.slice(0, -1),
        future: [doc, ...future].slice(0, 50),
        selection: null,
      });
    },

    redo: () => {
      const { future, doc, past } = get();
      if (!future.length) return;
      set({
        doc: future[0],
        future: future.slice(1),
        past: [...past, doc],
        selection: null,
      });
    },

    canUndo: () => get().past.length > 0,
    canRedo: () => get().future.length > 0,
  };
});

// ---------------------------------------------------------------------------
// Selektoren — verhindern unnötige Re-Renders in den Panels
// ---------------------------------------------------------------------------

export const selectWalls = (s: BimState): Wall[] => Object.values(s.doc.walls);
export const selectOpenings = (s: BimState): Opening[] => Object.values(s.doc.openings);
export const selectRooms = (s: BimState): Room[] => Object.values(s.doc.rooms);
export const selectNodes = (s: BimState): BimNode[] => Object.values(s.doc.nodes);
