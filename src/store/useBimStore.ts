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
  AnlagenAntworten,
  AiAnalysisState,
  AiFloorplanAnalysis,
  AuswahlQuelle,
  BimDocument,
  BimNode,
  ClosureIssue,
  FloorplanImage,
  Layer,
  Level,
  Opening,
  Annotation,
  AnnotationAnchor,
  Vorhaben,
  AnnotationKind,
  PipeRoutingMode,
  PipeAccessory,
  PipeAccessoryKind,
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
  Durchbruch,
  DurchbruchKind,
  DurchbruchPreset,
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
  Freihandstrich,
  SkizzenVorschlag,
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
  DACH_VORGABE,
  DEFAULT_CONSTRUCTIONS,
  FIXTURE_BY_TYPE,
  OPENING_PRESETS,
  PIPE_SERVICE_LABELS,
  ROOF_KIND_LABELS,
  ROOF_OPENING_LABELS,
  SITE_ELEMENT_LABELS,
  SOLID_LABELS,
  DURCHBRUCH_PRESETS,
  durchbruchWirt,
  VERTICAL_LABELS,
  VORHABEN_LABELS,
} from '../types/bim';

/**
 * Trassenlänge einer Polylinie [m] — **ohne** Höhenversatz.
 *
 * Bewusst behalten und bewusst so benannt: Es gibt Stellen, an denen genau
 * die Grundrisslänge gemeint ist (etwa der Maßstab im Plan). Wer die *Länge
 * des Rohres* braucht, nimmt `rohrlaenge` aus `lib/rohrlaenge.ts` — sie
 * rechnet den senkrechten Anteil mit.
 */
export function pipeLength(points: readonly Vec2[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return total;
}

/** Voreinstellung für ein neues Dach — siehe `DACH_VORGABE` in den Typen. */
const DEFAULT_ROOF: RoofDefinition = DACH_VORGABE;
import { anlageAusAntworten } from '../lib/anlagenFragen';
import { erkenneSkizze } from '../lib/skizze';
import { getroffene } from '../lib/notizen';
import { vorzugsrichtung, EPS, closestPointOnSegment, distance, distanceToSegment, pointInPolygon, roundMm } from '../lib/geometry';
import { ACCESSORY_LABELS } from '../lib/pipeAccessorySymbols';
import { hoehenText } from '../lib/beschriftung3d';
import { zieheHeizflaechenNach } from '../lib/heizflaechenAbgleich';
import { rohrlaenge } from '../lib/rohrlaenge';
import { istHeizflaeche } from '../lib/heizflaechenLeistung';
import { hinweiseZuRaeumen, leseVerworfene, type RaumverlustHinweis } from '../lib/verworfeneRaeume';
import { hatAusgangspunkt, schlageErzeugerVor } from '../lib/erzeugerplatz';
import { heizkoerperplatz, PLATZ_TEXT } from '../lib/heizkoerperplatz';
import {
  DEFAULT_EDGE_CLEARANCE,
  DEFAULT_LOOP_PATTERN,
  DEFAULT_OBSTACLE_CLEARANCE,
  FLOOR_OBSTACLE_TYPES,
  fixtureFootprint,
  measureLayableArea,
} from '../lib/floorLoopLayout';
import { BESTANDS_EBENEN, EBENEN_KATALOG, auswahlGesperrt, istSichtbar, type Gewerkesatz } from '../lib/ebenen';
import { stehtAufGeschoss } from '../lib/aufstellgeschoss';
import { bilanzSatz, leerePlan, loeschbilanz, type Loeschposten } from '../lib/planLeeren';
import { planeUebernahme } from '../lib/aussenwand';
import type { UiModus } from '../lib/uimodus';
import { belagsWiderstand } from '../lib/bodenbelag';
import { durchbruecheFuerTrassen } from '../lib/wandquerung';
import { bildePaar, partnerVon } from '../lib/doppelleitung';
import { copyLevelContents } from '../lib/levelCopy';
import { designFloorHeating } from '../lib/hydraulics';
import { estimateHeatLoad } from '../lib/heatLoadEstimate';
import {
  applyVerticalDeductions,
  detectRooms,
  gebaeudeUmriss,
  isMassiveArea,
  diagnoseClosure,
  findOpenEnds,
  usageDefaults,
} from '../lib/roomDetection';
import { solidFootprint } from '../lib/verticalSymbols';
import { rohrbezeichnung } from '../lib/rohrbezeichnung';
import { planeGebaeudeNetz, type GebaeudeNetzErgebnis } from '../lib/gebaeudeNetz';
import { baseRoofHeightAt, buildRoofFrame, dormerSide } from '../lib/roofGeometry';
import { baueDachlandschaft, daecherVon, raeumeOhneGeschossDarueber } from '../lib/dachlandschaft';
import { importIfc } from '../lib/ifcImport';
import { ordneRaumnamenZu } from '../lib/raumnutzung';
import { importRaumplan } from '../lib/raumplanImport';
import { ordneRaeumeZu } from '../lib/raumZuordnung';
import type { RaumHinweis, RaumplanImportErgebnis } from '../lib/raumplanImport';
import { importBuildingModel } from '../lib/buildingModelImport';
import { begradige } from '../lib/begradigen';
import { befundSatz, hoehenbefund } from '../lib/wandhoehen';
import { SPRACHEN, spracheSetzen, type Sprache } from '../lib/sprache';
import { spiegleDokument } from '../lib/spiegeln';
import { planeGeschosszuordnung } from '../lib/importgeschoss';
import type { SpiegelAchse } from '../lib/spiegeln';
import type { BegradigenOptionen } from '../lib/begradigen';
import { findeLuecken, oeffnungFuerLuecke } from '../lib/luecken';
import type { LueckenSchluss } from '../lib/luecken';
import { benenneGeschosse, erdgeschossIndex } from '../lib/levelGeometry';
import { VORHABEN_VORBELEGUNG, emptyPlant, emptySite } from '../lib/plantDefaults';
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

/**
 * Die Ebenen des Modells.
 *
 * Der Katalog selbst steht in `lib/ebenen.ts` — dort, wo auch die Zuordnung
 * steht, und damit im Rechenkern, der an die Gegenstelle geht. Hier bleibt
 * nur der Name, unter dem der Store ihn kennt.
 */
export const DEFAULT_LAYERS: readonly Layer[] = EBENEN_KATALOG;

/**
 * Fehlende Ebenen in einem geöffneten Projekt ergänzen.
 *
 * Heute baut jeder Ladeweg auf `emptyDocument()` auf, das die Ebenen
 * mitbringt — der Fall kann also gar nicht eintreten. Das ist aber eine
 * Eigenschaft des Ladewegs und keine des Modells: Käme je ein Weg dazu, der
 * `doc.layers` aus der Datei übernimmt, wäre `doc.layers['layer-site']`
 * `undefined`, und weil „nicht vorhanden" beim Sichtbarkeitsvergleich wie
 * „aus" aussieht, verschwände das Gelände beim Öffnen einer alten Datei.
 * Zwei Zeilen, die das ausschließen, sind billiger als die Suche danach.
 *
 * Ergänzt wird nur, was fehlt; ein ausgeblendeter Zustand bleibt stehen.
 */
export function ergaenzeEbenen(doc: BimDocument): void {
  for (const l of DEFAULT_LAYERS) {
    if (!doc.layers[l.id]) doc.layers[l.id] = { ...l };
  }
}

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
    durchbrueche: {},
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
  points: true,
  angle: true,
  angleStep: 45,
  pixelTolerance: 12,
  fingerZeichnet: false,
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
  /**
   * Woher die aktuelle Auswahl kam.
   *
   * Der Unterschied ist keine Spitzfindigkeit: Wer im Plan ein Objekt
   * anfasst, will danach dessen Eigenschaften sehen — wer dagegen eine
   * Liste abarbeitet (Prüfbefunde, Raumbuch), will in der Liste bleiben.
   * Springt der Inspektor dort weg, verliert man nach jedem Befund die
   * Stelle und muss sich zurückklicken. Darum trägt die Auswahl ihre
   * Herkunft mit, statt dass die Oberfläche sie erraten muss.
   */
  auswahlQuelle: AuswahlQuelle;
  /** Zwischenablage für Kopieren/Einfügen (geschossübergreifend). */
  clipboard: ClipboardContent | null;
  hover: Selection | null;
  viewport: Viewport;
  /**
   * Zähler, der um eins steigt, sobald das **ganze Dokument** ersetzt wurde —
   * Projektdatei, IFC, Raumscan, Demo, neues Projekt.
   *
   * Die Zeichenfläche passt die Ansicht sonst nur einmal ein, beim ersten
   * brauchbaren Modell; danach nie wieder, weil sonst beim Zeichnen die
   * Ansicht springt. Nach einem Import stand deshalb ein fremder Grundriss
   * im alten Ausschnitt: sichtbar war eine Wandecke, und das Programm sah
   * aus, als hätte es die Datei nicht gelesen. Der Zähler ist das Signal,
   * genau dann noch einmal einzupassen — und nur dann.
   */
  einpassenZaehler: number;
  snap: SnapSettings;
  showDimensions: boolean;
  /** Dachlinien im Grundriss: First, Traufe und die Höhenlinien nach WoFlV. */
  showRoofLines: boolean;
  /**
   * Oberste Geschossdecke in der 3D-Ansicht zeigen?
   *
   * **Warum das eine Ansichtssache ist und keine Ebene im Dokument.** Die
   * Decke ist ein Bauteil und steht als solches im Modell; ob man sie
   * *sieht*, hängt davon ab, wovon man gerade redet. Von außen auf das Haus
   * zu schauen und nur einen Deckel zu sehen, hilft niemandem — von innen
   * ist ein Zimmer ohne Decke kein Zimmer. Eine Dokumentebene würde diese
   * Entscheidung mit dem Projekt speichern und an den nächsten
   * weitergeben; sie gehört aber zum Blickwinkel, nicht zum Gebäude.
   *
   * **Vorgabe `false`, und zwar nur für die Außenansichten.** Im Begehen
   * steht die Decke ohnehin immer; dort ist sie nicht verhandelbar. In
   * Orbit, Iso und Top wäre sie voreingestellt ein Rückschritt: Man sähe
   * von einem Bungalow eine graue Platte und müsste erst einen Schalter
   * suchen, um den Grundriss wiederzubekommen. Wer sie draußen braucht —
   * etwa um einen Deckendurchbruch zu prüfen — schaltet sie ein.
   */
  showCeiling: boolean;
  /**
   * Bediensprache der Oberfläche.
   *
   * **Sie gehört zur Person, nicht zum Projekt** — deshalb steht sie hier
   * und nicht im Dokument. Zwei Monteure am selben Grundriss dürfen ihn in
   * verschiedenen Sprachen bedienen, und ein Projekt, das aus einer
   * türkischen Sitzung kommt, darf beim nächsten nicht plötzlich türkisch
   * aufgehen. Gemerkt wird sie im Browser, wie die Sitzungssicherung.
   *
   * Die **Ausgaben** — Plan, Massenauszug, Rohrnetzbericht, Übergabe an
   * RaVia — bleiben davon unberührt und deutsch. Sie gehen an Bauherr,
   * Prüfer und Bauleiter, und die lesen Deutsch.
   */
  sprache: Sprache;
  /** Aktive Leitungsart für das Rohr-Werkzeug. */
  pipeService: PipeService;
  /**
   * Zeichnet das Rohr-Werkzeug eine Doppelleitung?
   *
   * Eine Heizungstrasse ist immer zweirohrig; von Hand zwei Züge parallel zu
   * zeichnen ist Fleißarbeit mit garantiertem Rechtschreibfehler — der
   * Rücklauf hat dann drei Meter mehr als der Vorlauf, und niemand sieht
   * es. Der Schalter steht neben der Leitungsart und gilt nur für die
   * Heizung; bei Abwasser oder Zuluft gibt es kein Paar.
   */
  doppelleitung: boolean;
  /** Gewählte Raumvorlage für das Werkzeug „Raum aufziehen". */
  roomTemplate: RoomTemplateKind;
  /** Feineinstellung der Vorlage — Aussparung, Drehung, Segmentzahl. */
  roomTemplateOptions: TemplateOptions;
  /** Aktive Bauart für das Treppen-/Schacht-Werkzeug. */
  verticalKind: VerticalKind;
  /** Welche Art massives Bauteil das Werkzeug setzt. */
  solidKind: SolidKind;
  /** Gewählte Durchbruchart und Regelmaß für das Durchbruchwerkzeug. */
  durchbruchKind: DurchbruchKind;
  durchbruchPreset: DurchbruchPreset;
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
  uiMode: UiModus;
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
  /**
   * Räume, die RaVia beim Übernehmen verworfen hat — je Raumkennung ein
   * Hinweis.
   *
   * **Warum außerhalb von `doc`.** Das ist keine Eigenschaft des Gebäudes,
   * sondern eine Rückmeldung der Gegenstelle zu *einem* Übernahmelauf. Läge
   * sie im Dokument, wanderte sie in die Rückgängig-Kette, in die
   * Projektdatei und in den Export — und stünde dort noch, wenn der Raum
   * längst vergrößert ist.
   */
  verworfeneRaeume: Record<string, RaumverlustHinweis>;
  /** Auto-Trace-Vorschau — bewusst außerhalb von `doc` (kein Undo-Rauschen). */
  trace: TraceState | null;
  /**
   * Der Stand der Freihanderkennung. `null`, solange nichts skizziert wurde.
   *
   * Er liegt **neben** dem Dokument und nicht darin: ein Vorschlag ist kein
   * Modellinhalt, gehört nicht in die Projektdatei und nicht in die
   * Rückgängig-Kette. In die Kette kommt genau ein Schritt — das Übernehmen.
   */
  skizze: SkizzenVorschlag | null;
  /**
   * Radiert das Notizwerkzeug gerade, statt zu schreiben?
   *
   * Auf dem Tablet gibt es keine zweite Maustaste und der Apple Pencil hat
   * kein Radierende, das der Browser meldet. Es braucht also einen
   * sichtbaren Schalter — und weil er sichtbar ist, gehört sein Zustand in
   * den Speicher und nicht in eine Variable der Leinwand.
   */
  radiergummi: boolean;
  /** Notizebene sichtbar? Ansichtssache, deshalb neben dem Dokument. */
  notizenSichtbar: boolean;

  // --- UI ----------------------------------------------------------------
  setTool: (tool: ToolId) => void;
  setViewMode: (mode: ViewMode) => void;
  setCameraMode: (mode: CameraMode) => void;
  setSelection: (sel: Selection | null, quelle?: AuswahlQuelle) => void;
  setSelections: (sels: Selection[]) => void;
  toggleSelection: (sel: Selection) => void;
  selectInBox: (min: Vec2, max: Vec2, additive: boolean) => void;
  selectAll: () => void;
  setHover: (sel: Selection | null) => void;
  setViewport: (vp: Partial<Viewport>) => void;
  /**
   * Eine Stelle im Plan, die gerade hervorgehoben wird — Zeitpunkt und Ort.
   *
   * **Wozu.** Ein Befund aus der Prüfung anzuspringen half bisher nur halb:
   * Die Ansicht rückte hin, aber bei 60 Bildpunkten je Meter ist eine Wand
   * von 0,0 cm Länge ein Punkt, den niemand findet — und ausgerechnet das
   * sind die Befunde, die man anspringt. Gebraucht werden zwei Dinge, die
   * eine Verschiebung allein nicht leistet: nah genug heran, um zu
   * *arbeiten*, und eine Marke, die sagt „hier".
   */
  hervorhebung: { position: Vec2; seit: number } | null;
  /** Eine Stelle anspringen: hinrücken, heranzoomen, gelb markieren. */
  hebeHervor: (position: Vec2, mindestZoom?: number) => void;
  setSnap: (patch: Partial<SnapSettings>) => void;
  toggleDimensions: () => void;
  toggleRoofLines: () => void;
  toggleCeiling: () => void;
  setSprache: (s: Sprache) => void;
  setPipeService: (service: PipeService) => void;
  /** Doppelleitung (Vor- und Rücklauf in einem Zug) ein- oder ausschalten. */
  setDoppelleitung: (an: boolean) => void;
  setRoomTemplate: (kind: RoomTemplateKind) => void;
  setRoomTemplateOptions: (patch: Partial<TemplateOptions>) => void;
  setVerticalKind: (kind: VerticalKind) => void;
  setSolidKind: (kind: SolidKind) => void;
  setDurchbruchPreset: (preset: DurchbruchPreset) => void;
  setAnnotationKind: (kind: AnnotationKind) => void;
  toggleRoomLabels: () => void;
  setUiMode: (mode: UiModus) => void;
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
  /**
   * Die Heizleistung eines Raums im Raumbuch eintragen.
   *
   * Der Weg ist für die Bestandsaufnahme gedacht: Wer eine Wohnung aufnimmt,
   * liest je Raum eine Leistung ab und trägt sie in der Zeile ein, in der er
   * sie liest. Hat der Raum noch keine Heizfläche, entsteht ein Heizkörper an
   * der Stelle, an der er in einem Bestandsgebäude fast immer hängt (siehe
   * `heizkoerperplatz.ts`) — und die Antwort sagt, wo das war.
   *
   * Mehrdeutige Fälle werden **nicht** geraten: Bei zwei Heizflächen im Raum
   * ließe sich eine Summe nicht auf sie verteilen, und eine Fußbodenheizung
   * ist keine Zahl, die man überschreibt. Beides wird mit Begründung
   * abgelehnt.
   *
   * `watt === undefined` leert die Angabe („nicht erfasst"), löscht aber
   * keinen Heizkörper — was im Plan steht, verschwindet nicht über eine
   * Tabellenzelle.
   */
  setzeRaumHeizleistung: (roomId: string, watt: number | undefined) => { ok: boolean; message: string };
  /**
   * Die überschlägige Heizlast für **alle** Räume auf einmal eintragen.
   *
   * **Warum das eine eigene Aktion ist.** Die Leistung je Raum ist bisher
   * eine Eingabe pro Zeile. Beim Mehrfamilienhaus mit 42 Räumen sind das 42
   * Eingaben, bevor überhaupt etwas ausgelegt werden kann — der größte
   * einzelne Zeitfresser im Ablauf des Handwerkers.
   *
   * Gerechnet wird **nicht** mit einer W/m²-Faustzahl, sondern mit dem
   * Überschlag aus `lib/heatLoadEstimate.ts`: denselben Flächen, U-Werten
   * und Temperaturen, die ohnehin im Modell stehen. Das ist dieselbe Zahl,
   * die im Anlagenblatt für die Gerätewahl benutzt wird — sie kommt aus
   * diesem Gebäude und nicht aus einer Tabelle.
   *
   * **Was sie nicht anfasst:** Räume, in denen schon eine Leistung steht
   * (`nurLeere`, Vorgabe `true`), unbeheizte Räume, Räume mit
   * Fußbodenheizung und Räume mit mehr als einer Heizfläche. Eine Zahl, die
   * jemand eingetragen hat, überschreibt ein Knopf nicht.
   *
   * Und sie bleibt ein **Überschlag**: Die Norm-Heizlast rechnet RaVia und
   * schreibt sie zurück. Der Bericht sagt das, damit es niemand verwechselt.
   */
  uebernimmUeberschlagAlsHeizleistung: (optionen?: { levelId?: string; nurLeere?: boolean }) => {
    gesetzt: number;
    uebersprungen: number;
    summeW: number;
    message: string;
  };
  /**
   * Räume unter einer Mindestgröße als unbeheizt führen.
   *
   * Digitalisierungsrauschen und Schächte kommen als winzige Räume ins
   * Modell — im Lauf über die 54 Testgebäude waren 34 von 460 Räumen unter
   * 1 m², zehn davon als beheizt geführt. Sie bekommen Heizkörper, die nie
   * eine Trasse erreichen, und auf der Gegenseite fallen sie ohnehin weg.
   *
   * Entschieden wird das nicht still: Die Modellprüfung meldet solche Räume
   * längst als `room.tiny`; diese Aktion ist der Knopf dazu.
   */
  fuehreKleineRaeumeAlsUnbeheizt: (schwelle?: number) => { geaendert: number; message: string };
  moveFixture: (id: string, position: Vec2) => void;
  updateMeta: (patch: Partial<BimDocument['meta']>) => void;
  updateLevel: (id: string, patch: Partial<Level>) => void;
  /** Dach über einem Geschoss anlegen oder ändern. `null` entfernt es. */
  setRoof: (levelId: string, patch: Partial<RoofDefinition> | null) => void;
  /** Ein weiteres Dach über diesem Geschoss anlegen — für L-, T- und U-Häuser. */
  addRoof: (levelId: string) => void;
  /** Ein einzelnes Dach entfernen. */
  entferneRoof: (levelId: string, roofId: string) => void;
  /** Ein einzelnes Dach ändern. */
  setRoofById: (levelId: string, roofId: string, patch: Partial<RoofDefinition>) => void;

  // --- Treppen, Schächte, Rohrnetz ---------------------------------------
  addVertical: (kind: VerticalKind, position: Vec2) => VerticalElement;
  updateVertical: (id: string, patch: Partial<VerticalElement>) => void;
  addSolid: (kind: SolidKind, position: Vec2) => SolidElement;
  /**
   * Einen Durchbruch setzen.
   *
   * Bei wandgebundenen Arten muss eine Wand unter dem Zeiger liegen — ohne
   * Wand kein Wanddurchbruch. Der Aufrufer sucht sie (`pickWallForOpening`)
   * und reicht sie mitsamt Abstand auf der Achse herein; findet er keine,
   * gibt diese Aktion `null` zurück und schreibt eine Meldung in die
   * Statuszeile. Beim Deckendurchbruch zählt nur der Punkt.
   */
  addDurchbruch: (
    preset: DurchbruchPreset,
    ziel: { position: Vec2 } | { wallId: string; distance: number },
  ) => Durchbruch | null;
  updateDurchbruch: (id: string, patch: Partial<Durchbruch>) => void;
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
  /** Rohrnetz auslegen. `anordnung: 'ring'` legt eine Ringleitung an den Außenwänden. */
  /**
   * Das Rohrnetz auslegen — über alle Geschosse, mit Steigleitung zwischen
   * ihnen (siehe `src/lib/gebaeudeNetz.ts`).
   */
  legeRohrnetzAus: (mode: PipeRoutingMode, anordnung?: 'baum' | 'ring') => GebaeudeNetzErgebnis;
  updatePipe: (id: string, patch: Partial<PipeRun>) => void;
  /**
   * Eine Armatur von Hand setzen — aus der Werkzeugkiste im Haus.
   *
   * Der Rohrausleger setzt Armaturen dorthin, wo die Trasse sie verlangt.
   * Das deckt den Neubau ab. Im Bestand sitzt das Absperrventil aber da, wo
   * es 1978 jemand hingebaut hat, und das steht in keiner Regel. Von Hand
   * gesetzte Armaturen tragen deshalb **kein** `generated` und werden von
   * `legeRohrnetzAus` nicht angerührt.
   *
   * Liegt eine Leitung in Reichweite, bindet sich die Armatur an sie; sonst
   * steht sie frei. Beides ist gültig — eine Armatur ohne Abschnitt ist eine
   * Aufnahme aus dem Bestand, noch bevor die Trasse erfasst ist.
   */
  /**
   * Das Vorhaben festlegen — Neubau, Sanierung oder Teilsanierung.
   *
   * Ändert **nur** die Vorbelegungen, die noch niemand angefasst hat. Wer die
   * Auslegungstemperatur schon eingetragen hat, behält sie: Eine Angabe, die
   * der Anwender gemacht hat, darf eine Auswahl weiter oben nicht
   * überschreiben — sonst traut er der Auswahl beim nächsten Mal nicht mehr
   * und meidet sie.
   */
  setVorhaben: (vorhaben: Vorhaben) => void;
  setzeArmatur: (
    kind: PipeAccessoryKind,
    position: Vec2,
    elevation: number,
    label?: string,
  ) => PipeAccessory | null;
  addAnnotation: (kind: AnnotationKind, points: Vec2[], text?: string) => Annotation | null;
  /**
   * Eine Beschriftung setzen, die an einem Bauteil hängt und eine Höhe hat.
   *
   * Der Weg aus der begehbaren Ansicht: Man schaut ein Bauteil an, wählt
   * einen Wert, den das Modell kennt, und der Text hängt danach dort. Im
   * Grundriss erscheint er mit Höhenangabe (siehe `planText`).
   */
  setzeBeschriftung3D: (
    anchor: AnnotationAnchor,
    punkt: Vec2,
    elevation: number,
    text: string,
  ) => Annotation | null;
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
  /**
   * Die sechs Antworten im Anlagenblatt setzen — und die Anlage daraus bauen.
   *
   * **Ein Schritt in der Rückgängig-Kette je Änderung.** Wer den Puffer von
   * 200 auf 300 Liter stellt, hat eine Änderung gemacht und nicht drei
   * (Antwort, Speicher, Kreise).
   */
  setzeAnlagenAntworten: (antworten: AnlagenAntworten) => void;
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
  /** Eine Beschriftung gezielt löschen — ohne den Umweg über die Auswahl. */
  deleteAnnotation: (id: string) => void;
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
  /** Ein Geschoss im Modell ein- oder ausblenden. Das aktive bleibt sichtbar. */
  zeigeGeschoss: (id: string, sichtbar: boolean) => void;
  /**
   * Außenwände von einem Geschoss in ein anderes übernehmen.
   * @returns Zahl der angelegten Wände.
   */
  uebernehmeAussenwaende: (vonLevelId: string, nachLevelId: string) => number;
  /**
   * Den eingelesenen Grundriss einem Geschoss zuordnen — „das ist das 1. OG".
   *
   * Legt die fehlenden Geschosse darunter an, zieht Höhenlagen, Namen und
   * Randbedingungen nach und übernimmt auf Wunsch den Außenwandumriss nach
   * unten. Alles in einem Schritt der Historie.
   *
   * `ordnung`: 0 = EG, 1 = 1. OG, −1 = KG.
   */
  ordneGrundrissZu: (
    ordnung: number,
    aussenwaendeDarunter?: boolean,
  ) => { ok: boolean; message: string };

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
  /** Eine Ebene sperren oder freigeben — Gesperrtes ist sichtbar, aber unantastbar. */
  sperreEbene: (id: string, gesperrt: boolean) => void;
  /** Wände, Öffnungen, Räume und Durchbrüche auf einmal sperren. */
  sperreBestand: (gesperrt: boolean) => void;
  /** Die Sichtbarkeit auf einen Gewerkesatz stellen — ein Blatt auf Knopfdruck. */
  ebenenSatz: (satz: Gewerkesatz) => void;
  deleteSelection: () => void;
  /** Den ganzen Plan leeren. Gibt zurück, was weggenommen wurde. */
  clearAll: () => Loeschposten[];
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
  /**
   * Die Antwort von RaVias `raeume-uebernehmen` auswerten.
   *
   * Entgegengenommen wird die Antwort **so, wie sie kommt** — das Lesen
   * steckt in `lib/verworfeneRaeume.ts`. Zurück kommt, was daraus wurde:
   * wie viele Hinweise gesetzt sind und wie viele verworfene Räume sich
   * keinem gezeichneten Raum zuordnen ließen.
   */
  meldeVerworfeneRaeume: (antwort: unknown) => { hinweise: number; ohneRaum: number; message: string };
  /**
   * Den vorgeschlagenen Wärmeerzeuger setzen.
   *
   * Der Vorschlag selbst kommt aus `lib/erzeugerplatz.ts` und wird dem
   * Anwender **vorher gezeigt** — hier wird nur ausgeführt, was er bestätigt
   * hat. Gibt die Kennung zurück, damit der Aufrufer das Symbol gleich
   * fassen kann, oder `null`, wenn sich kein Ort begründen ließ.
   */
  setzeErzeugerNachVorschlag: () => { ok: boolean; message: string; fixtureId?: string };
  /** Die Hinweise wieder wegräumen — nach dem nächsten Übernahmelauf. */
  loescheVerworfeneHinweise: () => void;
  loadProject: (data: unknown) => { ok: boolean; message: string };
  /** IFC4-Datei als neues Projekt einlesen. */
  loadIfc: (text: string) => { ok: boolean; message: string };
  /** Raumscan aus Apple RoomPlan als neues Projekt einlesen. */
  loadRaumscan: (text: string) => { ok: boolean; message: string };
  /**
   * Gebäudemodell aus der App RaVia Scan (`ravia.building`) übernehmen —
   * Wände, Öffnungen, Raumnamen, Dachvorschlag, Heizkörper. Mit
   * `{ merge: true }` kommt das gescannte Geschoss zu den vorhandenen dazu,
   * statt das Modell zu ersetzen. Ein Schritt in der Rückgängig-Kette.
   */
  loadBuilding: (data: unknown, optionen?: { merge?: boolean }) => { ok: boolean; message: string };
  /**
   * Wände des aktiven Geschosses auf die Achsen ziehen. Ein Aufmaß steht nie
   * ganz gerade; dieser Schritt richtet es, ohne Ecken aufzureißen.
   */
  begradigeWaende: (optionen?: BegradigenOptionen) => { ok: boolean; message: string };
  /** Vorschau: Was eine Angleichung der Wandhöhen täte — ändert nichts. */
  wandhoehenVorschau: () => ReturnType<typeof hoehenbefund>;
  /** Alle Wände des Geschosses auf die lichte Geschosshöhe ziehen. */
  gleicheWandhoehenAn: () => { ok: boolean; message: string };
  /**
   * Den Grundriss spiegeln.
   *
   * `umfang` entscheidet, was mitgeht: `'alles'` nimmt das ganze Gebäude samt
   * Grundstück und Referenzbild — das ist der Regelfall, denn nur so stehen
   * die Geschosse danach wieder übereinander. `'geschoss'` spiegelt nur das
   * aktive; das ist gewollt, wenn gerade *ein* Plan eingelesen wurde und die
   * übrigen Geschosse schon stimmen.
   */
  spiegleGrundriss: (
    achse: SpiegelAchse,
    umfang: 'geschoss' | 'alles',
  ) => { ok: boolean; message: string };
  /** Ein loses Wandende bis zum Gegenüber schließen — als Wand oder Öffnung. */
  schliesseLuecke: (knotenId: string, art: LueckenSchluss) => { ok: boolean; message: string };
  /**
   * Geschätzte Wandstärken bestätigen — für eine Wandart oder alle, wahlweise
   * mit neuem Wert. Danach gilt die Zahl als gesetzt, nicht mehr als geschätzt.
   */
  bestaetigeWandstaerken: (
    typ: WallType | 'alle',
    staerke?: number,
  ) => { ok: boolean; message: string };
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

  // --- Freihand ----------------------------------------------------------
  /** Einen Freihandstrich auswerten und als Vorschlag zeigen. */
  skizziere: (punkte: Vec2[]) => { ok: boolean; message: string };
  /** Die vorgeschlagenen Wände wirklich anlegen — ein Schritt in der Historie. */
  uebernimmSkizze: () => { ok: boolean; message: string };
  /** Den zuletzt gezogenen Strich aus dem Vorschlag nehmen. */
  nimmZugZurueck: () => void;
  /** Den Vorschlag verwerfen. */
  verwirfSkizze: () => void;
  /** Wandstärke und -art der Vorschläge ändern, ohne neu zu skizzieren. */
  setzeSkizzenwand: (patch: { staerke?: number; art?: WallType }) => void;
  /** Eine Freihandnotiz ablegen. */
  notiere: (punkte: Vec2[], druck?: number[]) => void;
  /** Eine Freihandnotiz löschen. */
  loescheNotiz: (id: string) => void;
  /** Alle Freihandnotizen des aktiven Geschosses löschen. */
  loescheNotizen: () => void;
  /**
   * Alles wegradieren, was die Bahn im aktiven Geschoss berührt.
   * Ein Schritt in der Historie, egal wie viele Striche fallen.
   */
  radiere: (bahn: Vec2[]) => void;
  /** Zwischen Schreiben und Radieren umschalten (Werkzeug „Notiz"). */
  setzeRadiergummi: (an: boolean) => void;
  /** Die Notizebene ein- und ausblenden — Ansicht, nicht Dokument. */
  setzeNotizenSichtbar: (sichtbar: boolean) => void;

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
    durchbrueche: { ...(doc.durchbrueche ?? {}) },
    pipes: { ...(doc.pipes ?? {}) },
    /*
     * **Die Armaturen haben hier gefehlt — und das war kein Schönheitsfehler.**
     *
     * Ohne diese Zeile zeigte jede Kopie des Dokuments auf *dasselbe*
     * Armaturenverzeichnis wie das Original. Wer eine Armatur löschte,
     * löschte sie damit auch aus dem Stand, der in der Historie liegt: Strg+Z
     * holte sie nicht zurück. Aufgefallen ist es erst bei der Abnahme am
     * laufenden Server — im Programm sah alles richtig aus, weil der Fehler
     * genau dort sitzt, wo man ihn nicht sucht.
     *
     * `legeRohrnetzAus` war nie betroffen: die Aktion setzt ein neues Objekt
     * ein, statt im alten zu löschen. Das ist der Grund, warum die Lücke so
     * lange unbemerkt blieb.
     */
    pipeAccessories: { ...(doc.pipeAccessories ?? {}) },
    annotations: { ...(doc.annotations ?? {}) },
    freihand: { ...(doc.freihand ?? {}) },
    roofOpenings: { ...(doc.roofOpenings ?? {}) },
    rooms: { ...doc.rooms },
    site: { ...doc.site, elements: { ...doc.site.elements }, pumps: { ...doc.site.pumps } },
    diagnostics: { openEnds: doc.diagnostics.openEnds, closure: doc.diagnostics.closure },
    image: doc.image ? { ...doc.image } : undefined,
  };
}

/**
 * Sammlungen, an denen sich nichts geändert hat, bekommen ihre alte Kennung
 * zurück.
 * ---------------------------------------------------------------------------
 *
 * **Warum das nötig ist.** `cloneDoc` legt jede Sammlung flach neu an — es
 * muss das tun, weil die Mutationen unmittelbar in `next.walls[…]` schreiben.
 * Die Folge: Nach *jeder* Änderung hat `doc.walls` eine neue Kennung, auch
 * wenn keine einzige Wand angefasst wurde. Für React und für `useMemo` heißt
 * das „alles hat sich geändert".
 *
 * Was daran teuer ist, sieht man erst beim Ziehen. Die 3D-Ansicht baut ihren
 * Inhalt neu auf, sobald sich `walls`, `rooms`, `pipes` oder `doc.nodes`
 * ändern — Wände, Decken, Dach, Rohre, Gelände, alles. Beim Verschieben eines
 * Heizkörpers ändert sich davon nichts, und trotzdem lief der ganze Aufbau
 * fünfzigmal je Sekunde. Es gab dazu schon einen Kommentar im Viewer, der das
 * beschreibt und für `fixtures` behoben hat; die Ursache lag aber eine Ebene
 * tiefer und machte die Abhilfe wirkungslos.
 *
 * **Was hier passiert.** Nach der Änderung wird jede Sammlung mit ihrem
 * Vorzustand verglichen — Zahl der Einträge und Kennungsgleichheit je
 * Eintrag, kein tiefer Vergleich. Sind sie gleich, bekommt das neue Dokument
 * die *alte* Sammlung zurück. Das kostet einen Durchlauf über ein paar
 * hundert Verweise und spart eine Geometrie.
 *
 * **Warum der flache Vergleich genügt.** Eine geänderte Wand wird im Store
 * nirgends an Ort und Stelle verändert, sondern immer ersetzt
 * (`doc.walls[id] = { ...wall, … }`). Ein geänderter Eintrag hat damit
 * zwangsläufig eine neue Kennung. Wo doch einmal an Ort und Stelle geändert
 * würde, käme das Dokument hier unverändert durch — und die Anzeige bliebe
 * stehen. Das ist der Preis, und er ist derselbe, den React überall zahlt.
 *
 * `meta` bleibt außen vor: dort steht `modifiedAt`, das sich bei jeder
 * Änderung ändert — mit Absicht.
 */
function teileUnveraendertes(alt: BimDocument, neu: BimDocument): void {
  const gleich = (a: Record<string, unknown>, b: Record<string, unknown>): boolean => {
    const ka = Object.keys(a);
    if (ka.length !== Object.keys(b).length) return false;
    for (const k of ka) if (a[k] !== b[k]) return false;
    return true;
  };

  const sammlungen = [
    'levels',
    'layers',
    'constructions',
    'nodes',
    'walls',
    'openings',
    'fixtures',
    'verticals',
    'solids',
    'durchbrueche',
    'pipes',
    'pipeAccessories',
    'annotations',
    'freihand',
    'roofOpenings',
    'rooms',
  ] as const;

  const a = alt as unknown as Record<string, Record<string, unknown> | undefined>;
  const b = neu as unknown as Record<string, Record<string, unknown> | undefined>;
  for (const k of sammlungen) {
    const va = a[k];
    const vb = b[k];
    if (va && vb && va !== vb && gleich(va, vb)) b[k] = va;
  }

  // Die Außenanlage hat zwei Sammlungen in einem Objekt — erst die inneren,
  // dann das äußere, sonst bliebe `site` immer neu.
  if (alt.site && neu.site && alt.site !== neu.site) {
    if (alt.site.elements !== neu.site.elements && gleich(alt.site.elements, neu.site.elements)) {
      neu.site.elements = alt.site.elements;
    }
    if (alt.site.pumps !== neu.site.pumps && gleich(alt.site.pumps, neu.site.pumps)) {
      neu.site.pumps = alt.site.pumps;
    }
    const s1 = alt.site as unknown as Record<string, unknown>;
    const s2 = neu.site as unknown as Record<string, unknown>;
    if (gleich(s1, s2)) neu.site = alt.site;
  }
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

/**
 * Räume, Topologiebefunde und Raumzuordnung neu bilden.
 *
 * @param nurAktivesGeschoss Nur das sichtbare Geschoss neu erkennen; die
 *   übrigen behalten ihre Räume unverändert.
 *
 * **Wofür die Abkürzung da ist.** Beim Ziehen einer Wand läuft `mutate` bei
 * jedem Zeigerereignis — auf einem Stift sind das 120 in der Sekunde. Die
 * volle Raumerkennung geht dabei über *alle* Geschosse; am Referenzhaus mit
 * vier Geschossen sind das rund zehn Millisekunden je Ereignis, und die
 * fehlen dem Bild. Während eines Zuges ändert sich aber nur das sichtbare
 * Geschoss: Die Wand, die man anfasst, liegt dort, und keine Geste bewegt
 * etwas in einem anderen Geschoss mit.
 *
 * **Warum die übernommenen Räume nicht noch einmal durch
 * `applyVerticalDeductions` laufen dürfen.** Diese Funktion zieht das
 * Treppenloch vom Luftvolumen ab — `room.volume = room.volume − …`. Sie ist
 * damit *nicht* wiederholbar: Ein zweiter Durchlauf über dieselben Räume
 * zöge dasselbe Loch ein zweites Mal ab, und der Lüftungswärmeverlust des
 * Raums wäre zu klein. Die übernommenen Räume sind bereits abgezogen und
 * bleiben deshalb außen vor.
 *
 * Nach dem Loslassen läuft `endGesture` und rechnet einmal vollständig nach.
 */
/**
 * Sind zwei Räume inhaltlich derselbe?
 *
 * Verglichen wird alles, was die Anzeige und die Rechnung benutzen. Nicht
 * verglichen wird, was aus den Feldern folgt (`grossArea` aus `polygon`,
 * `volume` aus Fläche und Höhe) — zwei Räume mit gleichem Polygon und
 * gleicher Höhe haben dieselben abgeleiteten Zahlen, und ein Vergleich
 * darüber wäre doppelt gemoppelt und keine zusätzliche Sicherheit.
 *
 * Bewusst **kein** allgemeiner Tiefenvergleich: Der wäre langsamer als das
 * Raumerkennen selbst und würde bei jeder neuen Eigenschaft still falsch —
 * er verglichen ja auch die neue mit. Diese Liste muss wachsen, wenn `Room`
 * wächst; dass man sie dabei übersieht, ist der Preis. Er ist sichtbar: Ein
 * vergessenes Feld führt dazu, dass eine Änderung daran im Bild nicht
 * ankommt, und das fällt beim ersten Ausprobieren auf.
 */
/**
 * Räume benennen, die aus einem Scan kommen.
 *
 * Zugeordnet wird über die Lage, nicht über eine Kennung: Der Scan teilt das
 * Haus in eigene Bereiche, und deren Grenzen sind nicht die Wandachsen, an
 * denen die Raumerkennung arbeitet. Fällt der Punkt eines Hinweises in einen
 * erkannten Raum, erbt der Raum Namen und Nutzung.
 *
 * **Rangfolge:** Was der Monteur in der App benannt hat (`vomNutzer`), geht
 * vor die Bereichsbezeichnung, die RoomPlan geraten hat — er stand im Raum.
 * Trifft ein Raum mehrere Hinweise, gewinnt der erste; dass es mehrere sind,
 * heißt, dass zwischen ihnen eine Wand fehlt, und wird gezählt.
 */
function benenneRaeume(
  doc: BimDocument,
  hinweise: readonly RaumHinweis[],
): { benannt: number; doppelt: number } {
  let benannt = 0;
  let doppelt = 0;
  const vergeben = new Set<string>();
  const sortiert = [...hinweise].sort((a, b) => Number(b.vomNutzer ?? false) - Number(a.vomNutzer ?? false));
  for (const hinweis of sortiert) {
    const raum = Object.values(doc.rooms).find(
      (r) => r.levelId === hinweis.levelId && pointInPolygon(hinweis.punkt, r.polygon),
    );
    if (!raum) continue;
    if (vergeben.has(raum.id)) {
      doppelt++;
      continue;
    }
    vergeben.add(raum.id);
    doc.rooms[raum.id] = {
      ...raum,
      name: hinweis.name,
      usage: hinweis.usage,
      ...(hinweis.raviaRoomId ? { raviaRoomId: hinweis.raviaRoomId } : {}),
    };
    benannt++;
  }
  return { benannt, doppelt };
}

/**
 * Aus einem Scan-Ergebnis (RoomPlan-Datei oder RaVia Building Model) ein
 * neues Dokument bauen: Geschosse benennen und ordnen, Nordrichtung, Wände,
 * Räume erkennen, Raumnutzung übernehmen. `vorRaeumen` darf das Dokument
 * ergänzen, bevor die Raumerkennung läuft (Dächer, Heizkörper) — so bekommen
 * auch diese Objekte ihren Raumbezug aus derselben Erkennung.
 */
function dokumentAusScan(
  ergebnis: RaumplanImportErgebnis,
  vorRaeumen?: (doc: BimDocument) => void,
): { fresh: BimDocument; benannt: number; doppelt: number } {
  const fresh = emptyDocument();
  fresh.meta = {
    ...fresh.meta,
    name: ergebnis.projektName || 'Raumscan',
    address: ergebnis.adresse ?? fresh.meta.address,
    modifiedAt: new Date().toISOString(),
  };

  // Nordabweichung aus dem Kompass des Geräts.
  //
  // Der Import liefert die Nordrichtung als Winkel gegen +x; das Dokument
  // führt sie als Abweichung von „+y zeigt nach Norden". Zwischen beidem
  // liegt die Vierteldrehung. Die Genauigkeit des Kompasses — beim
  // Beispielscan ±15,7° — wird bewusst **nicht** stillschweigend
  // übernommen: sie steht in der Meldung, damit niemand solare Gewinne
  // auf ein Grad genau rechnet, die auf fünfzehn Grad unsicher sind.
  if (ergebnis.nordrichtung !== undefined) {
    const grad = (ergebnis.nordrichtung * 180) / Math.PI;
    fresh.meta.northAngle = Math.round(((90 - grad) % 360 + 360) % 360 * 10) / 10;
  }

  // Geschosse benennen und ordnen — genau wie beim IFC-Import.
  //
  // RoomPlan zählt Geschosse durch (`story: 0, 1, …`); daraus „Geschoss 0"
  // zu machen wäre eine Übersetzung ohne Übersetzung. Benannt wird deshalb
  // nach der Höhenlage: das Erdgeschoss ist das Geschoss am Bezugspunkt,
  // nicht das unterste. Hat das Haus einen Keller, steht das EG auf dessen
  // Decke — und die Reihenfolge `order` zählt von dort aus, damit ein
  // Kellergeschoss die Ordnungszahl −1 bekommt und nicht 0.
  const sortiert = [...ergebnis.levels].sort((a, b) => a.elevation - b.elevation);
  const namen = benenneGeschosse(sortiert);
  const egIdx = erdgeschossIndex(sortiert.map((l) => l.elevation));
  fresh.levels = Object.fromEntries(
    sortiert.map((l, i) => [
      l.id,
      {
        id: l.id,
        name: namen[i],
        order: i - egIdx,
        elevation: l.elevation,
        height: l.height,
        // Erdreich liegt unter dem *untersten* Geschoss, nicht unter dem
        // Erdgeschoss.
        floorUValue: i === 0 ? 0.3 : 0.9,
        floorBoundary: i === 0 ? ('ground' as const) : ('adjacent-room' as const),
        ceilingUValue: 0.2,
        ceilingBoundary: 'unheated' as const,
      },
    ]),
  );
  // Angefangen wird im Erdgeschoss, nicht im Keller — dort beginnt
  // niemand ein Aufmaß.
  fresh.activeLevelId = sortiert[egIdx]?.id ?? sortiert[0]?.id ?? fresh.activeLevelId;
  fresh.nodes = Object.fromEntries(ergebnis.nodes.map((n) => [n.id, n]));
  fresh.walls = Object.fromEntries(ergebnis.walls.map((w) => [w.id, w]));
  fresh.openings = Object.fromEntries(ergebnis.openings.map((o) => [o.id, o]));
  vorRaeumen?.(fresh);
  recomputeRooms(fresh);

  // Raumnutzung aus dem Scan übernehmen.
  //
  // Zugeordnet wird über die Lage, nicht über eine Kennung: RoomPlan
  // teilt die Wohnung in eigene Bereiche, und deren Grenzen sind nicht
  // die Wandachsen, an denen die Raumerkennung arbeitet. Fällt der
  // Mittelpunkt eines Bereichs in einen erkannten Raum, erbt der Raum
  // Namen und Nutzung — sonst bleibt er, wie er ist. Trifft ein Raum
  // mehrere Bereiche (weil eine Wand dazwischen im Scan fehlt), gewinnt
  // der erste; ihn stillschweigend zu überschreiben hieße, die Reihenfolge
  // in der Datei über die Sache entscheiden zu lassen.
  const { benannt, doppelt } = benenneRaeume(fresh, ergebnis.raumHinweise);
  return { fresh, benannt, doppelt };
}


/**
 * Die Dachkennwerte eines Raums vergleichen.
 *
 * Eigene Funktion, weil `roof` bei jedem Erkennen neu gerechnet wird und
 * deshalb nie kennungsgleich ist. Ein Kennungsvergleich hätte an dieser
 * Stelle bedeutet: In jedem Haus mit geneigtem Dach wäre jeder Raum bei
 * jeder Änderung „neu" — und die ganze Ersparnis dahin, ausgerechnet dort,
 * wo das Rechnen am teuersten ist.
 */
function gleicheDachwerte(a: Room['roof'], b: Room['roof']): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.volume === b.volume &&
    a.averageHeight === b.averageHeight &&
    a.minHeight === b.minHeight &&
    a.maxHeight === b.maxHeight &&
    a.slopedArea === b.slopedArea &&
    a.flatCeilingArea === b.flatCeilingArea &&
    a.gableArea === b.gableArea &&
    a.livingArea === b.livingArea &&
    a.skylightArea === b.skylightArea &&
    a.dormerFrontArea === b.dormerFrontArea &&
    a.slopedAreaByFace.length === b.slopedAreaByFace.length &&
    a.slopedAreaByFace.every(
      (f, i) => f.azimuth === b.slopedAreaByFace[i].azimuth && f.area === b.slopedAreaByFace[i].area,
    )
  );
}

function gleicherRaum(a: Room, b: Room): boolean {
  if (a === b) return true;
  const punkteGleich = (p: readonly Vec2[], q: readonly Vec2[]): boolean => {
    if (p.length !== q.length) return false;
    for (let i = 0; i < p.length; i++) {
      if (p[i].x !== q[i].x || p[i].y !== q[i].y) return false;
    }
    return true;
  };
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.usage === b.usage &&
    a.levelId === b.levelId &&
    a.area === b.area &&
    a.perimeter === b.perimeter &&
    a.height === b.height &&
    a.volume === b.volume &&
    a.setpointTemperature === b.setpointTemperature &&
    a.airChangeRate === b.airChangeRate &&
    a.ventilationRole === b.ventilationRole &&
    a.isHeated === b.isHeated &&
    a.floorUValue === b.floorUValue &&
    a.floorBoundary === b.floorBoundary &&
    a.ceilingUValue === b.ceilingUValue &&
    a.ceilingBoundary === b.ceilingBoundary &&
    a.groundContactPerimeter === b.groundContactPerimeter &&
    a.exposedFacadeCount === b.exposedFacadeCount &&
    a.heightOverride === b.heightOverride &&
    a.floorCovering === b.floorCovering &&
    a.floorOpeningArea === b.floorOpeningArea &&
    a.openToAboveArea === b.openToAboveArea &&
    a.solidArea === b.solidArea &&
    a.grossArea === b.grossArea &&
    a.normHeatLoad === b.normHeatLoad &&
    gleicheDachwerte(a.roof, b.roof) &&
    a.boundaries.length === b.boundaries.length &&
    /*
     * Alle Felder des Wandabschnitts, nicht eine Auswahl.
     *
     * Die naheliegende Abkürzung — Länge und U-Wert genügen doch — ist
     * falsch: Ein eingesetztes Fenster ändert `openingArea` und `netArea`,
     * die Länge aber nicht. Der Raum sähe damit gleich aus, behielte seinen
     * alten Verweis, und im Modell stünde ein Wandabschnitt ohne das
     * Fenster, das man gerade gesetzt hat. Die Heizlast rechnete dann über
     * die volle Wandfläche.
     */
    a.boundaries.every((s1, i) => {
      const s2 = b.boundaries[i];
      return (
        s1.wallId === s2.wallId &&
        s1.length === s2.length &&
        s1.netArea === s2.netArea &&
        s1.grossArea === s2.grossArea &&
        s1.openingArea === s2.openingArea &&
        s1.orientation === s2.orientation &&
        s1.azimuth === s2.azimuth &&
        s1.isExterior === s2.isExterior &&
        s1.uValue === s2.uValue &&
        s1.boundary === s2.boundary &&
        s1.neighbourRoomId === s2.neighbourRoomId &&
        s1.gableArea === s2.gableArea
      );
    }) &&
    punkteGleich(a.polygon, b.polygon) &&
    punkteGleich(a.innerPolygon, b.innerPolygon) &&
    a.centroid.x === b.centroid.x &&
    a.centroid.y === b.centroid.y
  );
}

function recomputeRooms(doc: BimDocument, nurAktivesGeschoss = false): void {
  const previousAll = Object.values(doc.rooms);
  const allWalls = Object.values(doc.walls);
  const allOpenings = Object.values(doc.openings);
  const rooms: Room[] = [];
  /** Räume, die unverändert übernommen werden — schon abgezogen. */
  const uebernommen: Room[] = [];
  const openEnds: Vec2[] = [];
  // Topologie-Befunde nur des sichtbaren Geschosses — genau wie `openEnds`.
  // Sie werden im Plan gezeichnet, und der Plan zeigt ein Geschoss.
  const closure: ClosureIssue[] = [];

  for (const level of Object.values(doc.levels)) {
    if (nurAktivesGeschoss && level.id !== doc.activeLevelId) {
      uebernommen.push(...previousAll.filter((r) => r.levelId === level.id));
      continue;
    }
    const walls = allWalls.filter((w) => w.levelId === level.id);
    if (!walls.length) continue;
    const wallIds = new Set(walls.map((w) => w.id));
    const openings = allOpenings.filter((o) => wallIds.has(o.wallId));

    rooms.push(
      ...detectRooms({
        walls,
        nodes: doc.nodes,
        openings,
        /*
         * Die Bauteilaufbauten gehören mit hinein.
         *
         * Ohne sie führt jeder Wandabschnitt eines Raums nur den am Bauteil
         * erfassten U-Wert — ein zugewiesener Aufbau mit gerechnetem U-Wert
         * wurde gar nicht erst gesehen. Die Heizlast stimmte trotzdem, weil
         * sie `doc.walls` direkt fragt; alles, was den Abschnitt-Schnappschuss
         * liest, arbeitete dagegen mit einer veralteten Zahl.
         */
        constructions: doc.constructions,
        levelId: level.id,
        defaultHeight: level.height,
        northAngle: doc.meta.northAngle,
        previous: previousAll.filter((r) => r.levelId === level.id),
        roof: level.roof,
        /*
         * **Die Dachlandschaft aus dem vorigen Stand.**
         *
         * Welcher Gebäudeteil unter welchem Dach liegt, hängt an einer
         * Raumauswahl — also an dem Ergebnis, das die Raumerkennung gerade
         * erst erzeugt. Das Henne-Ei-Problem wird hier aufgelöst: Die
         * Landschaft entsteht aus den Räumen des **vorigen** Durchgangs.
         *
         * Das ist kein Kunstgriff, sondern die Reihenfolge, in der auch
         * gearbeitet wird: Erst stehen die Räume, dann legt man das Dach
         * darüber. Nur im allerersten Durchgang eines frisch gezeichneten
         * Geschosses fehlt die Zuordnung — dann deckt das Dach das ganze
         * Geschoss, was ohne Raumauswahl ohnehin gilt.
         */
        roofFrames: baueDachlandschaft({
          level,
          walls,
          nodes: doc.nodes,
          rooms: previousAll.filter((r) => r.levelId === level.id),
          roofOpenings: Object.values(doc.roofOpenings ?? {}).filter((o) => o.levelId === level.id),
        })
          .map((t) => t.frame)
          .filter((fr): fr is NonNullable<typeof fr> => fr !== null),
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
  /*
   * Ein unveränderter Raum behält seinen alten Verweis.
   *
   * `detectRooms` baut bei jedem Durchlauf neue Raumobjekte — auch dann,
   * wenn sich an ihnen nichts geändert hat. Für die Rechnung ist das egal,
   * für die Anzeige nicht: Die 3D-Ansicht baut ihren ganzen Inhalt neu auf,
   * sobald `rooms` eine neue Kennung hat. Beim Verschieben eines Heizkörpers
   * ändert sich kein Raum, und trotzdem entstand fünfzigmal je Sekunde das
   * ganze Haus neu.
   *
   * Verglichen wird auf Inhalt, nicht auf Kennung — die Punkte eines
   * Polygons sind bei jedem Durchlauf neue Objekte mit denselben Zahlen.
   * Der Vergleich kostet zwei Durchläufe über die Stützpunkte; `detectRooms`
   * kostet ein Vielfaches davon.
   */
  const vorherNach = new Map(previousAll.map((r) => [r.id, r]));
  const echteRaeume = [...rooms.filter((r) => !isMassiveArea(r)), ...uebernommen].map((r) => {
    const alt = vorherNach.get(r.id);
    return alt && gleicherRaum(alt, r) ? alt : r;
  });
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
      /*
       * Die Zahl kommt aus dem Kennfeld nach DIN EN 1264-2, nicht von einem
       * Datenblatt. Ohne diese Zeile fiele sie auf „eingetragen" zurück —
       * `addFixture` setzt `powerSource` nur für die Katalogvorbelegung, und
       * `...options` überschreibt das ganze `params`-Objekt. Der Inspektor
       * behauptete dann, ein Mensch habe die Zahl abgelesen.
       *
       * `'katalog'` und nicht `'heizlast'`: Der Heizkreis ist von der
       * Umrechnung nach EN 442-2 ausgenommen (er ist keine Heizfläche in
       * deren Sinn), soll aber nachziehbar bleiben.
       */
      powerSource: 'katalog',
      flowTemperature: 35,
      returnTemperature: 28,
      /*
       * Der Belagswiderstand kommt aus dem Raum, wenn dort einer erfasst
       * ist. Ist keiner erfasst, bleibt das Feld leer — und nicht etwa bei
       * null: „unter Fliesen" und „nicht erfasst" sind zwei verschiedene
       * Aussagen, und die Flächenheizung trägt unter Teppich ein Drittel
       * weniger.
       */
      ...(belagsWiderstand(room.floorCovering) !== undefined
        ? { floorCoveringResistance: belagsWiderstand(room.floorCovering) }
        : {}),
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


/**
 * Das Dachgerüst eines Geschosses — oder `null`, wenn dort kein Dach sitzt.
 *
 * Ausgelagert, weil es an zwei Stellen gebraucht wird (Vorschau und
 * Ausführung der Höhenangleichung) und beide dasselbe sehen müssen. Liefen
 * sie auseinander, zeigte der Knopf eine andere Zahl, als er anschließend
 * ändert.
 */
function dachGeruest(doc: BimDocument, level: Level): ReturnType<typeof buildRoofFrame>[] {
  if (!daecherVon(level).length) return [];
  const levelWalls = Object.values(doc.walls).filter((w) => w.levelId === level.id);
  return baueDachlandschaft({
    level,
    walls: levelWalls,
    nodes: doc.nodes,
    rooms: Object.values(doc.rooms ?? {}).filter((r) => r.levelId === level.id),
    roofOpenings: Object.values(doc.roofOpenings ?? {}).filter((o) => o.levelId === level.id),
  }).map((t) => t.frame);
}


/** Wo die Sprachwahl im Browser liegt. */
const SPRACH_SCHLUESSEL = 'ravia-cad-light.sprache.v1';

/**
 * Merker für das einmalige Zurücksetzen nach dem Anzeigefehler in 1.36.0.
 * Siehe `geladeneSprache`.
 */
const SPRACH_ENTSPERRT = 'ravia-cad-light.sprache.entsperrt.v1';

/**
 * Die gemerkte Sprache beim Start — und sie wird sofort gesetzt.
 *
 * `spracheSetzen` hier und nicht erst im ersten Bauteil: `t()` wird schon
 * beim Aufbau des Speichers aufgerufen (Beschriftungstabellen,
 * Vorgabetexte). Käme die Sprache erst danach, stünde der erste Bildaufbau
 * auf Deutsch und der zweite nicht — ein Flackern, für das niemand eine
 * Erklärung hätte.
 */
function geladeneSprache(): Sprache {
  let s: Sprache = 'de';
  try {
    /*
     * **Einmaliges Zurücksetzen nach dem Anzeigefehler in 1.36.0.**
     *
     * In 1.36.0 war die Sprachliste unsichtbar: Die Kopfzeile trägt
     * `overflow-x-auto`, und damit wird `overflow-y` zu `auto` — alles, was
     * unten aus der Kopfzeile ragte, wurde beschnitten. Wer eine Sprache
     * gewählt hatte, kam nicht mehr zurück: Der Knopf zeigte die fremde
     * Flagge, die Liste ließ sich nicht mehr sehen. Die Wahl blieb im
     * Browser stehen und überlebt auch die Behebung.
     *
     * Deshalb hier **einmal** zurück auf Deutsch — die Sprache, in der das
     * Programm startet und in der derzeit ohnehin jeder Text steht. Der
     * Merker sorgt dafür, dass es bei diesem einen Mal bleibt: Wer danach
     * Türkisch wählt, behält Türkisch.
     *
     * Ein Zurücksetzen fremder Einstellungen ist sonst eine Unart. Hier ist
     * es die Behebung eines Zustands, den der Anwender nicht gewollt und
     * nicht mehr verlassen konnte.
     */
    if (localStorage.getItem(SPRACH_ENTSPERRT) !== '1') {
      localStorage.setItem(SPRACH_ENTSPERRT, '1');
      localStorage.removeItem(SPRACH_SCHLUESSEL);
    }
    const roh = localStorage.getItem(SPRACH_SCHLUESSEL);
    if (roh && SPRACHEN.some((x) => x.code === roh)) s = roh as Sprache;
  } catch {
    // Kein Speicher, keine Erinnerung — Deutsch.
  }
  spracheSetzen(s);
  return s;
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
  const mutate = (
    fn: (doc: BimDocument) => void,
    options?: { skipRooms?: boolean; ziehenachHeizflaechen?: boolean },
  ) => {
    const { doc, past } = get();
    const next = cloneDoc(doc);
    fn(next);
    // Während einer Geste nur das sichtbare Geschoss — siehe `recomputeRooms`.
    if (!options?.skipRooms) recomputeRooms(next, gestureActive);
    // Unveränderte Sammlungen behalten ihre Kennung — siehe oben.
    teileUnveraendertes(doc, next);
    /*
     * **Heizflächen nachziehen — aber nicht bei jedem Tastendruck.**
     *
     * `heizflaechenBefunde` rechnet die Heizlast aller Räume neu; das kostet
     * am Referenzhaus einige Millisekunden und am großen Projekt ein
     * Vielfaches davon. In `mutate` hängt aber *jede* Eingabe — jede
     * verschobene Wand, jeder getippte Buchstabe im Raumnamen. Blind
     * mitzurechnen hieße, die Oberfläche für eine Zahl zu verlangsamen, die
     * sich in neun von zehn Fällen gar nicht geändert hat.
     *
     * Deshalb muss der Aufrufer es ausdrücklich verlangen — und zwar an den
     * Stellen, an denen sich die Heizlast oder die Zahl der Heizflächen
     * wirklich ändern kann: beim Setzen und Löschen einer Heizfläche, beim
     * Ändern der Systemtemperaturen und auf Zuruf aus dem Anlagenblatt.
     * Läuft eine Änderung durch, die keiner dieser Fälle ist, bleibt die
     * Abweichung stehen — und wird in der Prüfliste gemeldet statt still
     * korrigiert.
     */
    if (options?.ziehenachHeizflaechen) zieheHeizflaechenNach(next);
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
    auswahlQuelle: 'plan',
    selections: [],
    clipboard: null,
    hover: null,
    viewport: { zoom: 60, center: { x: 4, y: 3 } },
    hervorhebung: null,
    einpassenZaehler: 0,
    snap: DEFAULT_SNAP,
    showDimensions: true,
    showRoofLines: true,
    showCeiling: false,
    sprache: geladeneSprache(),
    pipeService: 'heating-flow',
    doppelleitung: true,
    roomTemplate: 'rechteck',
    roomTemplateOptions: { ...DEFAULT_TEMPLATE_OPTIONS },
    verticalKind: 'stair-straight',
    solidKind: 'chimney',
    durchbruchKind: 'kernbohrung',
    durchbruchPreset: DURCHBRUCH_PRESETS[4],
    /*
     * Vorgabe ist **Text**, nicht die Maßkette.
     *
     * Das Werkzeug heißt „Text & Maßkette", und wer es greift, will in den
     * allermeisten Fällen etwas auf den Plan schreiben. Stand die Vorgabe auf
     * „Maßkette", bekam er beim ersten Tippen eine angefangene Bemaßung und
     * musste erst einen Umschalter finden, der auf dem Tablet aus der
     * Kopfzeile herausgescrollt war.
     */
    annotationKind: 'text',
    siteKind: 'boundary',
    showRoomLabels: true,
    /*
     * Der Einstieg ist der einfache Modus. Wer mehr braucht, schaltet um —
     * umgekehrt sucht niemand nach dem Schalter, der ihm die Hälfte wegnimmt.
     *
     * Der Handwerkermodus ist **nicht** der Einstieg, obwohl er der
     * schmalste ist: Wer das Programm zum ersten Mal öffnet, weiß noch
     * nicht, ob er nur aufmisst. Eine Oberfläche, die von sich aus die
     * Hälfte wegnimmt, wirkt kaputt; eine, die man bewusst schmaler stellt,
     * wirkt aufgeräumt.
     */
    uiMode: ((): UiModus => {
      const gespeichert = typeof localStorage !== 'undefined' ? localStorage.getItem('ravia-ui-mode') : null;
      return gespeichert === 'profi' || gespeichert === 'handwerker' || gespeichert === 'einfach'
        ? gespeichert
        : 'einfach';
    })(),
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
    verworfeneRaeume: {},
    trace: null,
    skizze: null,
    radiergummi: false,
    notizenSichtbar: true,

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
    setSelection: (selection, quelle = 'plan') =>
      set({ selection, selections: selection ? [selection] : [], auswahlQuelle: quelle }),

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
      /*
       * Von Hand gesetzte Armaturen fasst der Rahmen mit, erzeugte nicht.
       *
       * Dieselbe Regel wie beim Antippen im Grundriss: Was der Rohrausleger
       * beim nächsten Auslegen ohnehin neu anlegt, darf nicht in einer
       * Auswahl stehen, die man danach löschen oder verschieben will.
       */
      for (const a of Object.values(doc.pipeAccessories ?? {})) {
        if (a.levelId !== doc.activeLevelId || a.generated) continue;
        if (inBox(a.position)) found.push({ kind: 'accessory', id: a.id });
      }
      /*
       * Das Gelände gehört keinem Geschoss an und wird in jedem gezeigt —
       * also ist es auch in jedem Geschoss mit dem Rahmen zu fassen.
       *
       * Das **Gerät** darin nicht: Es steht auf dem Geschoss, auf dem es
       * aufgestellt wurde, und wird anderswo nur durchscheinend gezeigt. Ein
       * Rahmen, der es dort mitnimmt, nähme etwas mit, das man nicht sieht —
       * und löschte es beim nächsten Tastendruck.
       */
      for (const pump of Object.values(doc.site.pumps)) {
        if (pump.form === 'indoor') continue; // steht nicht im Lageplan
        if (!stehtAufGeschoss(doc, pump, doc.activeLevelId)) continue;
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

    /*
     * Strg+A — und zwar wirklich alles.
     *
     * **Was hier falsch war.** Bis 1.36.2 fasste „Alles auswählen" nur Wände
     * und TGA-Objekte des aktiven Geschosses. Wer danach Entf drückte, sah
     * das Gebäude verschwinden — und die Grundstücksgrenze, die Leitungen,
     * die Maßketten und die Wärmepumpe stehen bleiben. Gemeldet wurde genau
     * das: „leider kann ich grundstückgrenzen beim löschen nicht entfernen".
     * Eine Auswahl, die „alles" heißt und die Hälfte meint, ist schlimmer als
     * keine: Man hält den Plan für leer und arbeitet auf Resten weiter.
     *
     * **Was jetzt darin ist.** Alles, was auf diesem Geschoss liegt und sich
     * einzeln anfassen lässt, dazu das Gelände — es gehört keinem Geschoss
     * und wird in jedem gezeigt.
     *
     * **Was bewusst nicht darin ist.**
     * - *Räume.* Sie sind abgeleitet; sie verschwinden mit ihren Wänden und
     *   nicht auf Zuruf. In der Auswahl stünden sie nur als Zahl, die beim
     *   Löschen nicht aufgeht.
     * - *Öffnungen.* Sie gehen mit ihrer Wand, und die ist schon dabei.
     * - *Erzeugte Armaturen.* Dieselbe Regel wie beim Rahmen: Was der
     *   Rohrausleger beim nächsten Lauf ohnehin neu setzt, gehört nicht in
     *   eine Auswahl, die man löschen oder verschieben will.
     * - *Die Wärmepumpe fremder Geschosse.* Sie scheint hier nur durch.
     * - *Gesperrtes und Ausgeblendetes.* Was man nicht sieht oder nicht
     *   anfassen darf, wählt man auch nicht mit aus — sonst meldete das
     *   Löschen hinterher „gesperrt" für etwas, das man nie gewählt hat.
     *
     * Für das Leeren des ganzen Projekts gibt es `allesLoeschen()`; Strg+A
     * bleibt eine Auswahl auf *einem* Geschoss.
     */
    selectAll: () => {
      const doc = get().doc;
      const hier = doc.activeLevelId;
      const roh: Selection[] = [
        ...Object.values(doc.walls)
          .filter((w) => w.levelId === hier)
          .map((w) => ({ kind: 'wall' as const, id: w.id })),
        ...Object.values(doc.fixtures)
          .filter((f) => f.levelId === hier)
          .map((f) => ({ kind: 'fixture' as const, id: f.id })),
        ...Object.values(doc.pipes)
          .filter((r) => r.levelId === hier)
          .map((r) => ({ kind: 'pipe' as const, id: r.id })),
        ...Object.values(doc.pipeAccessories ?? {})
          .filter((a) => a.levelId === hier && !a.generated)
          .map((a) => ({ kind: 'accessory' as const, id: a.id })),
        ...Object.values(doc.verticals ?? {})
          .filter((v) => v.levelId === hier)
          .map((v) => ({ kind: 'vertical' as const, id: v.id })),
        ...Object.values(doc.solids ?? {})
          .filter((b) => b.levelId === hier)
          .map((b) => ({ kind: 'solid' as const, id: b.id })),
        ...Object.values(doc.durchbrueche ?? {})
          .filter((d) => d.levelId === hier)
          .map((d) => ({ kind: 'durchbruch' as const, id: d.id })),
        ...Object.values(doc.annotations ?? {})
          .filter((a) => a.levelId === hier)
          .map((a) => ({ kind: 'annotation' as const, id: a.id })),
        ...Object.values(doc.site.elements).map((e) => ({ kind: 'site' as const, id: e.id })),
        ...Object.values(doc.site.pumps)
          .filter((p) => stehtAufGeschoss(doc, p, hier))
          .map((p) => ({ kind: 'heatpump' as const, id: p.id })),
      ];
      const next = roh.filter((sel) => !auswahlGesperrt(doc, sel) && istSichtbar(doc, sel.kind, sel.id));
      set({ selections: next, selection: next.length ? next[next.length - 1] : null });
    },
    setHover: (hover) => set({ hover }),
    setViewport: (vp) => set({ viewport: { ...get().viewport, ...vp } }),

    /**
     * Zu einer Stelle springen und sie markieren.
     *
     * **Warum herangezoomt wird und nicht nur verschoben.** Die Befunde,
     * die man anspringt, sind klein: eine Wand von 0,0 cm, eine Bohrung von
     * 68 mm, eine Öffnung, die zwei Zentimeter über die Wand ragt. Bei 60
     * Bildpunkten je Meter ist das ein Pixel. Wer eine Sache beheben soll,
     * muss sie greifen können.
     *
     * **Warum eine Untergrenze und kein fester Wert.** Wer schon bei 200
     * Bildpunkten je Meter arbeitet, will nicht auf 120 herausgezogen
     * werden — das wäre eine Ansicht, die sich gegen ihren Benutzer wehrt.
     * Herangezoomt wird nur, wer noch zu weit weg ist.
     */
    hebeHervor: (position, mindestZoom = 140) => {
      const vp = get().viewport;
      set({
        viewport: { ...vp, center: { ...position }, zoom: Math.max(vp.zoom, mindestZoom) },
        hervorhebung: { position: { ...position }, seit: Date.now() },
      });
    },
    setSnap: (patch) => set({ snap: { ...get().snap, ...patch } }),
    toggleDimensions: () => set({ showDimensions: !get().showDimensions }),
    toggleRoofLines: () => set({ showRoofLines: !get().showRoofLines }),
    toggleCeiling: () => set({ showCeiling: !get().showCeiling }),
    /**
     * Sprache umstellen.
     *
     * Drei Dinge in einem Schritt, und alle drei sind nötig: der
     * Modulzustand in `lib/sprache` (daraus liest `t()`), der Speicher
     * (daraus lesen die Bauteile und zeichnen neu) und der Browser (damit
     * die Wahl den nächsten Start überlebt). Fehlt der erste, übersetzt
     * nichts; fehlt der zweite, ändert sich das Bild nicht; fehlt der
     * dritte, fragt das Programm jeden Morgen erneut.
     */
    setSprache: (s2: Sprache) => {
      spracheSetzen(s2);
      try {
        localStorage.setItem(SPRACH_SCHLUESSEL, s2);
      } catch {
        // Privates Fenster oder gesperrter Speicher: die Wahl gilt für
        // diese Sitzung und wird eben nicht gemerkt. Kein Grund, die
        // Umstellung deshalb zu verweigern.
      }
      set({ sprache: s2 });
    },
    setRoomTemplate: (kind) =>
      set({ roomTemplate: kind, tool: 'room', statusMessage: `${ROOM_TEMPLATE_BY_KIND[kind].label} — im Plan aufziehen` }),
    setRoomTemplateOptions: (patch) =>
      set((st) => ({ roomTemplateOptions: { ...st.roomTemplateOptions, ...patch } })),
    setPipeService: (service) =>
      set({ pipeService: service, statusMessage: PIPE_SERVICE_LABELS[service] }),

    setDoppelleitung: (an) =>
      set({
        doppelleitung: an,
        statusMessage: an
          ? 'Doppelleitung: ein Zug legt Vor- und Rücklauf nebeneinander'
          : 'Einzelleitung: ein Zug legt eine Leitung',
      }),
    setVerticalKind: (kind) => set({ verticalKind: kind, statusMessage: VERTICAL_LABELS[kind] }),

    setSolidKind: (kind) => set({ solidKind: kind, statusMessage: SOLID_LABELS[kind] }),

    setDurchbruchPreset: (preset) =>
      set({
        durchbruchPreset: preset,
        durchbruchKind: preset.kind,
        statusMessage: preset.label,
      }),
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
        if (!wall) return;
        // Wer die Stärke von Hand setzt, hat sie nicht mehr geschätzt. Das
        // Kennzeichen hier zu löschen ist die einzige Stelle, an der das
        // zuverlässig passiert — sonst bliebe der Schritt „Wandstärken
        // bestätigen" auch dann offen, wenn jede Zahl längst geprüft ist.
        const geprueft =
          patch.thickness !== undefined && patch.thickness !== wall.thickness
            ? { thicknessEstimated: undefined }
            : {};
        doc.walls[id] = { ...wall, ...patch, ...geprueft };
      }),

    /**
     * Die geschätzten Wandstärken bestätigen — wahlweise mit neuem Wert.
     *
     * Zwei Dinge in einem Zug, weil sie zusammengehören: alle Wände einer Art
     * auf eine Stärke setzen *und* das Kennzeichen „geschätzt" löschen. Ohne
     * den zweiten Teil bliebe die Aufgabe offen, obwohl sie erledigt ist;
     * ohne den ersten müsste man einundzwanzig Wände einzeln anklicken.
     *
     * `staerke` weglassen heißt: die Schätzung stimmt so, nur bestätigen.
     */
    bestaetigeWandstaerken: (typ, staerke) => {
      let betroffen = 0;
      mutate((doc) => {
        for (const wand of Object.values(doc.walls)) {
          if (wand.levelId !== doc.activeLevelId) continue;
          if (!wand.thicknessEstimated) continue;
          if (typ !== 'alle' && wand.type !== typ) continue;
          doc.walls[wand.id] = {
            ...wand,
            thickness: staerke ?? wand.thickness,
            thicknessEstimated: undefined,
          };
          betroffen++;
        }
      });
      const wort = typ === 'exterior' ? 'Außenwände' : typ === 'alle' ? 'Wände' : 'Innenwände';
      const message = betroffen
        ? staerke !== undefined
          ? `${betroffen} ${wort} auf ${(staerke * 100).toFixed(1).replace('.', ',')} cm gesetzt`
          : `${betroffen} ${wort} bestätigt`
        : 'Keine geschätzten Stärken mehr offen';
      set({ statusMessage: message });
      return { ok: betroffen > 0, message };
    },

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

      /*
       * Eine Fußbodenheizung ist keine Kachel im Raum — sie ist der Raum.
       *
       * Wer aus der Palette „Fußbodenheizung" nimmt und in ein Zimmer
       * tippt, meint: dieses Zimmer bekommt Fußbodenheizung. Bis hierher
       * entstand daraus ein 40 mal 40 Zentimeter großes Symbol in der
       * Mitte — ein Objekt, das im Plan wie eine Heizfläche aussieht, im
       * Massenauszug 0,16 m² Verlegefläche trägt und in der Heizlast
       * nichts leistet. Man sieht ihm nicht an, dass es falsch ist; man
       * merkt es erst, wenn die Zahlen nicht stimmen.
       *
       * Deshalb legt derselbe Klick jetzt die ganze Raumfläche aus — mit
       * Verlegeabstand, Kreiszahl und Leistung aus der Raumheizlast, also
       * genau das, was der Knopf „Raum belegen" tut. Liegt der Punkt in
       * keinem Raum, bleibt es beim einzelnen Objekt: dann ist es eine
       * Anbindeleitung im Flur, kein Zimmer.
       */
      if (type === 'underfloor' && options?.params?.roomCoverage === undefined) {
        const d0 = get().doc;
        const raum = Object.values(d0.rooms).find(
          (r) =>
            r.levelId === d0.activeLevelId &&
            r.innerPolygon.length >= 3 &&
            pointInPolygon(position, r.innerPolygon),
        );
        if (raum) {
          const schon = Object.values(d0.fixtures).find(
            (f) => f.type === 'underfloor' && f.params.roomCoverage === true && f.roomId === raum.id,
          );
          if (schon) {
            set({ statusMessage: `„${raum.name}" trägt bereits eine Fußbodenheizung` });
            return schon;
          }
          const gelegt = belegeRaum(get, raum.id);
          if (!gelegt) {
            set({ statusMessage: `„${raum.name}" ist für eine Fußbodenheizung zu klein` });
            return null;
          }
          set({
            statusMessage:
              `Fußbodenheizung „${raum.name}": ${gelegt.area.toFixed(1).replace('.', ',')} m² belegt · ` +
              `${gelegt.loops} ${gelegt.loops === 1 ? 'Kreis' : 'Kreise'} · ${gelegt.powerW} W`,
          });
          return (
            Object.values(get().doc.fixtures).find(
              (f) => f.type === 'underfloor' && f.params.roomCoverage === true && f.roomId === raum.id,
            ) ?? null
          );
        }
      }

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
            /*
             * **Die Vorbelegung bleibt als Vorbelegung erkennbar.**
             *
             * Bis 1.23.0 stand hier nur `{ ...def.params }` — die Katalogzahl
             * wurde damit zu einem Wert, der von einem abgelesenen
             * Datenblattwert nicht mehr zu unterscheiden war. Die Folgen
             * trafen ausgerechnet die Stellen, die Herkunft ausweisen
             * wollen: Der hydraulische Abgleich meldete `assumed: false`,
             * weil ja eine Zahl dastand; die Übergabe an RaVia behauptete
             * `herkunft: 'eingegeben'` für etwas, das niemand eingegeben
             * hatte; und die Prüfung „Heizfläche ohne Leistung" konnte nie
             * zutreffen. Ein Feld mehr, und alle drei stimmen wieder.
             */
            params: { ...def.params, ...(def.params.powerW !== undefined ? { powerSource: 'katalog' as const } : {}) },
            ...options,
          };
          // Raumzuordnung sofort setzen, damit der Export ohne weitere
          // Geometrieänderung vollständig ist — **im eigenen Geschoss**.
          // Ohne den Geschossfilter bekam ein Heizkörper im OG den Raum aus
          // dem EG, der zufällig darunter liegt; bis zum nächsten vollen
          // Rechenlauf stand er dann im falschen Raum (dieser Aufruf läuft
          // mit `skipRooms`). Dieselbe Verwechslung wie beim Öffnen einer
          // Projektdatei, siehe `src/lib/raumZuordnung.ts`.
          const room = Object.values(doc.rooms).find(
            (r) =>
              r.levelId === fixture.levelId &&
              r.innerPolygon.length >= 3 &&
              pointInPolygon(fixture.position, r.innerPolygon),
          );
          fixture.roomId = room?.id;
          doc.fixtures[fixture.id] = fixture;
          created = fixture;
        },
        /*
         * Beim Setzen einer Heizfläche wird nachgezogen — und zwar in
         * demselben Schritt.
         *
         * Das betrifft **auch die schon vorhandenen**: Steht in einem Raum
         * bisher ein Heizkörper mit der vollen Raumlast und kommt ein
         * zweiter dazu, muss der erste von 100 auf 50 Prozent herunter.
         * Täte das erst der nächste Rechenlauf, stünde der Raum bis dahin
         * mit doppelter Heizfläche im Heft.
         */
        { skipRooms: true, ziehenachHeizflaechen: istHeizflaeche(type) },
      );
      return created;
    },

    setzeRaumHeizleistung: (roomId, watt) => {
      const d0 = get().doc;
      const room = d0.rooms[roomId];
      if (!room) return { ok: false, message: 'Raum nicht gefunden' };

      const imRaum = Object.values(d0.fixtures).filter((f) => f.roomId === roomId);
      const fbh = imRaum.find((f) => f.type === 'underfloor' && f.params.roomCoverage === true);
      if (fbh) {
        return {
          ok: false,
          message: `„${room.name}" hat eine Fußbodenheizung — ihre Leistung folgt aus der Auslegung, nicht aus einer Eingabe.`,
        };
      }

      const heizflaechen = imRaum.filter((f) => istHeizflaeche(f.type));
      if (heizflaechen.length > 1) {
        return {
          ok: false,
          message: `„${room.name}" hat ${heizflaechen.length} Heizflächen — die Leistung steht an jeder einzeln im Plan.`,
        };
      }

      if (heizflaechen.length === 1) {
        const f = heizflaechen[0];
        get().updateFixture(f.id, { params: { ...f.params, powerW: watt } });
        return {
          ok: true,
          message:
            watt === undefined
              ? `„${room.name}": Heizleistung geleert — sie gilt jetzt als nicht erfasst.`
              : `„${room.name}": ${Math.round(watt)} W eingetragen.`,
        };
      }

      if (watt === undefined) return { ok: true, message: '' };

      // Im Bad hängt ein Badheizkörper, kein Plattenheizkörper — so setzt ihn
      // der Handwerker, und so trägt ihn die Heizflächenauslegung (EN 442, n = 1,3).
      const typ = room.usage === 'bath' ? 'towel-radiator' : 'radiator';
      const def = FIXTURE_BY_TYPE[typ];
      const platz = heizkoerperplatz(room, d0.walls, d0.nodes, d0.openings, def?.depth ?? 0.1);
      const erstellt = get().addFixture(typ, platz.position, {
        rotation: platz.rotation,
        wallId: platz.wallId,
        roomId,
        // Der Heizkörper gehört auf das Geschoss **des Raums** — nicht auf
        // das gerade sichtbare. Über das Raumbuch und über die Schnittstelle
        // lässt sich die Heizlast eines Raums setzen, der nicht im
        // aktiven Geschoss liegt.
        levelId: room.levelId,
        params: { ...def.params, powerW: watt, powerSource: 'datenblatt' },
      });
      if (!erstellt) return { ok: false, message: 'Heizkörper konnte nicht angelegt werden' };
      return {
        ok: true,
        message: `„${room.name}": ${typ === 'towel-radiator' ? 'Badheizkörper' : 'Heizkörper'} mit ${Math.round(watt)} W ${PLATZ_TEXT[platz.grund]}.`,
      };
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
      const heizkoerperTypen: FixtureType[] = ['radiator', 'radiator-tube', 'towel-radiator', 'convector'];

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
          if (!fixture) return;
          const neu: Fixture = { ...fixture, ...patch };
          /*
           * **Wer die Leistung anfasst, macht sie zu seiner.**
           *
           * Ändert jemand `powerW` über diesen Weg — im Inspektor, aus einem
           * Datenblattimport, über die Einbettungsschnittstelle —, dann ist
           * das keine Vorbelegung und keine Schätzung mehr, sondern eine
           * Angabe. Ab hier zieht das Programm sie nicht mehr nach.
           *
           * Ohne diese Zeile wäre das automatische Nachziehen eine Falle:
           * Man trägt den Wert aus dem Datenblatt ein, ändert später eine
           * Dämmstärke, und die Zahl ist wieder weg — ersetzt durch eine
           * Schätzung, die schlechter ist als das, was man abgelesen hatte.
           *
           * Ausdrücklich mitgegebene Herkunft (etwa `'ravia'` oder
           * `'heizlast'`) gewinnt: Die kennt ihren eigenen Ursprung besser
           * als diese Regel.
           */
          /*
           * **Geprüft wird, ob die Herkunft *mitgeändert* wurde — nicht, ob
           * sie im Patch steht.**
           *
           * Der erste Versuch fragte `patch.params?.powerSource === undefined`
           * und war damit in der Praxis wirkungslos: Jede Oberfläche, die ein
           * einzelnes Feld ändert, baut den Patch als `{ ...params, powerW: x }`
           * — die alte Herkunft steht dann mit drin, und die Regel sah einen
           * ausdrücklichen Wunsch, wo nur eine Kopie war. Gemessen: Ein von
           * Hand auf 777 W gesetzter Heizkörper trug danach weiterhin
           * `heizlast` und wurde beim nächsten Rechenlauf überschrieben.
           *
           * Ein *echter* Herkunftswunsch unterscheidet sich davon: Er setzt
           * einen **anderen** Wert als den, der schon dastand.
           */
          const leistungGeaendert =
            patch.params?.powerW !== undefined && patch.params.powerW !== fixture.params.powerW;
          const herkunftAusdruecklich =
            patch.params?.powerSource !== undefined &&
            patch.params.powerSource !== fixture.params.powerSource;
          if (leistungGeaendert && !herkunftAusdruecklich) {
            neu.params = { ...neu.params, powerSource: 'datenblatt' };
          }
          doc.fixtures[id] = neu;
        },
        { skipRooms: true },
      ),

    uebernimmUeberschlagAlsHeizleistung: (optionen) => {
      const nurLeere = optionen?.nurLeere ?? true;
      const doc = get().doc;
      const ueberschlag = estimateHeatLoad(doc);
      const jeRaum = new Map(ueberschlag.rooms.map((r) => [r.roomId, r]));

      let gesetzt = 0;
      let uebersprungen = 0;
      let summeW = 0;
      for (const raum of Object.values(doc.rooms)) {
        if (optionen?.levelId && raum.levelId !== optionen.levelId) continue;
        if (!raum.isHeated) { uebersprungen++; continue; }
        const last = jeRaum.get(raum.id);
        if (!last || last.total <= 0) { uebersprungen++; continue; }

        // Steht schon eine Leistung im Raum? Dann bleibt sie stehen.
        if (nurLeere) {
          const vorhanden = Object.values(get().doc.fixtures)
            .some((f) => f.roomId === raum.id && istHeizflaeche(f.type)
              && typeof f.params.powerW === 'number' && f.params.powerW > 0);
          if (vorhanden) { uebersprungen++; continue; }
        }

        // Auf 50 W runden: Der Überschlag gibt keine Watt-Genauigkeit her,
        // und eine krumme Zahl täuscht eine vor.
        const watt = Math.round(last.total / 50) * 50;
        const antwort = get().setzeRaumHeizleistung(raum.id, watt);
        if (antwort.ok) { gesetzt++; summeW += watt; } else uebersprungen++;
      }

      const message = gesetzt === 0
        ? 'Keine Heizleistung eingetragen — entweder steht überall schon eine, oder es gibt keinen beheizten Raum mit Überschlag.'
        // Komma, nicht Punkt — der Satz steht in einer deutschen Oberfläche.
        : `${gesetzt} ${gesetzt === 1 ? 'Raum' : 'Räume'} mit dem Überschlag belegt, ` +
          `zusammen ${(summeW / 1000).toFixed(1).replace('.', ',')} kW` +
          `${uebersprungen ? ` (${uebersprungen} übersprungen)` : ''}. ` +
          'Das ist ein Überschlag aus Flächen und U-Werten, keine Norm-Heizlast — die rechnet RaVia.';
      set({ statusMessage: message });
      return { gesetzt, uebersprungen, summeW, message };
    },

    fuehreKleineRaeumeAlsUnbeheizt: (schwelle = 1) => {
      const doc = get().doc;
      const klein = Object.values(doc.rooms).filter((r) => r.isHeated && r.area < schwelle);
      if (!klein.length) {
        return { geaendert: 0, message: `Kein beheizter Raum unter ${schwelle.toFixed(2).replace('.', ',')} m².` };
      }
      for (const r of klein) get().updateRoom(r.id, { isHeated: false });
      const namen = klein.slice(0, 3).map((r) => `„${r.name}"`).join(', ');
      const message =
        `${klein.length} Raum/Räume unter ${schwelle.toFixed(2).replace('.', ',')} m² als unbeheizt geführt ` +
        `(${namen}${klein.length > 3 ? ' …' : ''}). Rückgängig geht mit Strg+Z.`;
      set({ statusMessage: message });
      return { geaendert: klein.length, message };
    },

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
              /*
               * **Nur Wände desselben Geschosses.**
               *
               * Ohne diese Zeile rastet ein Heizkörper an eine Wand ein, die
               * im Obergeschoss steht — der Suchradius beträgt einen Meter,
               * und im Grundriss liegen die Geschosse übereinander. Das
               * Objekt übernimmt dann `wallId` und Drehung einer Wand, die im
               * Bild gar nicht zu sehen ist; beim nächsten Verschieben jener
               * Wand wandert es mit, und niemand versteht, warum.
               */
              if (wall.levelId !== next.levelId) continue;
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

          // Auch der Raum gehört zum eigenen Geschoss — aus demselben Grund.
          const room = Object.values(doc.rooms).find(
            (r) =>
              r.levelId === next.levelId &&
              r.innerPolygon.length >= 3 &&
              pointInPolygon(next.position, r.innerPolygon),
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
            durchbrueche: Object.values(doc.durchbrueche ?? {}),
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
          if (kopie.durchbrueche.length > 0) {
            const durchbrueche = doc.durchbrueche ?? {};
            for (const db of kopie.durchbrueche) durchbrueche[db.id] = db;
            doc.durchbrueche = durchbrueche;
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
        for (const db of Object.values(d.durchbrueche ?? {})) {
          if (db.levelId === id) delete d.durchbrueche?.[db.id];
        }
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

    /**
     * Ein Geschoss im Modell ein- oder ausblenden.
     *
     * Das **aktive** Geschoss lässt sich nicht ausblenden: Man bearbeitet
     * nicht, was man nicht sieht — und ein Klick, nach dem der Plan leer ist
     * und niemand weiß warum, ist schlimmer als ein Klick, der nichts tut.
     */
    zeigeGeschoss: (id, sichtbar) => {
      const level = get().doc.levels[id];
      if (!level) return;
      if (!sichtbar && id === get().doc.activeLevelId) {
        set({ statusMessage: `${level.name} ist das aktive Geschoss und bleibt sichtbar` });
        return;
      }
      mutate(
        (doc) => {
          const l = doc.levels[id];
          if (l) doc.levels[id] = { ...l, visible: sichtbar };
        },
        { skipRooms: true },
      );
      set({ statusMessage: `${level.name} ${sichtbar ? 'eingeblendet' : 'ausgeblendet'}` });
    },

    /**
     * Die Außenwände eines Geschosses in ein anderes übernehmen.
     *
     * Der Fall, für den es das gibt: Der erste Grundriss steht, und das
     * Obergeschoss hat dieselbe Hülle — was in aller Regel stimmt und was
     * niemand ein zweites Mal zeichnen will. Übernommen werden Achse,
     * Stärke, Wandart und Bauteilaufbau; **keine Öffnungen.** Fenster sitzen
     * oben anders, und ein mitkopiertes Fenster wäre eine Behauptung über
     * ein Geschoss, das niemand aufgemessen hat.
     *
     * Wände, die im Ziel schon an derselben Stelle liegen, entstehen nicht
     * noch einmal: Zwei deckungsgleiche Wände sind im Plan nicht zu
     * unterscheiden und verdoppeln jede Fläche in der Heizlast.
     */
    uebernehmeAussenwaende: (vonLevelId, nachLevelId) => {
      const doc0 = get().doc;
      const ziel = doc0.levels[nachLevelId];
      const quelle = doc0.levels[vonLevelId];
      if (!ziel || !quelle) return 0;

      const plan = planeUebernahme({
        walls: Object.values(doc0.walls),
        nodes: doc0.nodes,
        vonLevelId,
        nachLevelId,
        hoehe: ziel.height,
        uid,
      });
      if (!plan.neueWaende.length) {
        set({
          statusMessage:
            plan.schonDa > 0
              ? `${ziel.name}: alle ${plan.schonDa} Außenwände stehen dort schon`
              : `${quelle.name} hat keine Außenwände zum Übernehmen`,
        });
        return 0;
      }

      mutate((doc) => {
        for (const k of plan.neueKnoten) doc.nodes[k.id] = k;
        for (const w of plan.neueWaende) doc.walls[w.id] = w;
      });
      set({
        statusMessage:
          `${plan.neueWaende.length} Außenwände aus ${quelle.name} in ${ziel.name} übernommen` +
          (plan.schonDa > 0 ? ` · ${plan.schonDa} standen schon` : '') +
          ' · Öffnungen wurden nicht mitgenommen',
      });
      return plan.neueWaende.length;
    },

    ordneGrundrissZu: (ordnung, aussenwaendeDarunter = true) => {
      const doc0 = get().doc;
      const quelleId = doc0.activeLevelId;
      const plan = planeGeschosszuordnung({
        levels: Object.values(doc0.levels),
        quelleId,
        ordnung,
        uid,
      });

      if (plan.hinweis) {
        set({ statusMessage: plan.hinweis });
        return { ok: false, message: plan.hinweis };
      }

      /*
       * **Warum die Außenwände hier und nicht in `planeGeschosszuordnung`
       * geplant werden.** Der Übernahmeplan braucht die Zielgeschosse — und
       * die gibt es erst, seit der Zuordnungsplan sie erfunden hat. Beides in
       * einer Funktion hieße, dass sie Geschosse anlegt *und* Wände zieht;
       * getrennt bleibt jede für sich prüfbar. Gerechnet wird beides vor dem
       * Schreiben, damit ein einziger Schritt in der Historie entsteht.
       */
      const knoten: BimNode[] = [];
      const waende: Wall[] = [];
      if (aussenwaendeDarunter) {
        for (const ziel of plan.neu) {
          const uebernahme = planeUebernahme({
            walls: Object.values(doc0.walls),
            nodes: doc0.nodes,
            vonLevelId: quelleId,
            nachLevelId: ziel.id,
            hoehe: ziel.height,
            uid,
          });
          knoten.push(...uebernahme.neueKnoten);
          waende.push(...uebernahme.neueWaende);
        }
      }

      mutate((d) => {
        for (const l of plan.geaendert) d.levels[l.id] = l;
        for (const l of plan.neu) d.levels[l.id] = l;
        for (const k of knoten) d.nodes[k.id] = k;
        for (const w of waende) d.walls[w.id] = w;
      });

      const ziel = get().doc.levels[quelleId];
      const message =
        `Der Grundriss liegt jetzt im ${ziel?.name ?? 'Geschoss'}` +
        (plan.neu.length
          ? ` · ${plan.neu.length} Geschoss${plan.neu.length === 1 ? '' : 'e'} angelegt (` +
            plan.neu.map((l) => l.name).join(', ') +
            ')'
          : '') +
        (waende.length ? ` · ${waende.length} Außenwände darunter übernommen` : '') +
        (Math.abs(plan.anhebung) > 1e-6
          ? ` · Bestand um ${Math.abs(plan.anhebung).toFixed(2).replace('.', ',')} m ` +
            (plan.anhebung > 0 ? 'angehoben' : 'abgesenkt')
          : '') +
        ' · Öffnungen wurden nicht mitgenommen';
      set({ statusMessage: message });
      return { ok: true, message };
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
      const { selections, doc: doc0 } = get();
      if (!selections.length) return;
      /*
       * Gesperrtes wandert nicht mit.
       *
       * Der Treffertest lässt ein gesperrtes Bauteil gar nicht erst fassen —
       * aber eine Auswahl kann auch aus einer Liste kommen, aus dem
       * Auswahlrahmen oder aus einem Prüfbefund. Ein zweites Sieb hier kostet
       * nichts und schließt den Weg, auf dem die Sperre sonst zu umgehen
       * wäre, ohne dass jemand es merkt.
       */
      const beweglich = selections.filter((s2) => !auswahlGesperrt(doc0, s2));
      if (!beweglich.length) {
        set({ statusMessage: 'Gesperrt — im Reiter „Ebenen" freigeben' });
        return;
      }
      mutate((doc) => {
        const moved = new Set<string>();
        for (const sel of beweglich) {
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
          } else if (sel.kind === 'accessory') {
            /*
             * Eine Armatur wandert mit — auch die ausgelegte.
             *
             * Sie zwar anklicken, aber nicht bewegen zu können ist die
             * Sorte Halbheit, die man dem Programm anlastet und nicht der
             * Absicht dahinter. Wer eine Armatur verschiebt, macht sie zu
             * seiner: `generated` fällt weg, damit die nächste Auslegung
             * seine Lage nicht wieder überschreibt.
             */
            const armatur = doc.pipeAccessories?.[sel.id];
            if (!armatur || !doc.pipeAccessories) continue;
            doc.pipeAccessories[sel.id] = {
              ...armatur,
              position: { x: roundMm(armatur.position.x + delta.x), y: roundMm(armatur.position.y + delta.y) },
              generated: undefined,
            };
          } else if (sel.kind === 'pipe') {
            // Die ganze Trasse wandert; die Form bleibt. Eine ausgelegte
            // Leitung wird damit zur gezogenen — sonst stünde sie nach der
            // nächsten Auslegung wieder an der alten Stelle.
            const run = doc.pipes[sel.id];
            if (!run) continue;
            // Eine Doppelleitung wandert als Ganzes — sonst läge nach der
            // Geste der Vorlauf im Flur und der Rücklauf im Zimmer.
            const paar = partnerVon(doc.pipes, run);
            for (const r of paar && !moved.has(paar.id) ? [run, paar] : [run]) {
              if (moved.has(r.id)) continue;
              doc.pipes[r.id] = {
                ...r,
                points: r.points.map((p) => ({ x: roundMm(p.x + delta.x), y: roundMm(p.y + delta.y) })),
                generated: undefined,
              };
              moved.add(r.id);
            }
          } else if (sel.kind === 'annotation') {
            const note = doc.annotations[sel.id];
            if (!note) continue;
            doc.annotations[sel.id] = {
              ...note,
              points: note.points.map((p) => ({ x: roundMm(p.x + delta.x), y: roundMm(p.y + delta.y) })),
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
        // Die Tür schlägt zur Wandnormalen auf, und die kehrt sich beim
        // Spiegeln um: aus der Linksnormalen wird das *negative* Spiegelbild
        // der alten. Ohne diese Zeile schlägt jede gespiegelte Tür nach dem
        // Spiegeln in den Nachbarraum auf — dieselbe Regel wie in
        // `spiegleGrundriss`, nur für die Auswahl.
        const gespiegelteWaende = new Set(walls.map((w) => w.id));
        for (const o of Object.values(d.openings)) {
          if (!gespiegelteWaende.has(o.wallId)) continue;
          d.openings[o.id] = { ...o, flipSwing: !o.flipSwing };
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

    /**
     * Einen Durchbruch setzen.
     *
     * Die Maße kommen aus dem Regelmaßkatalog und nicht aus einer Tabelle an
     * dieser Stelle — dieselbe Entscheidung wie bei Fenstern und Türen, und
     * aus demselben Grund: wer andere Bohrkronen vorhält, tauscht den Katalog
     * und nicht diese Funktion.
     *
     * Der Name ist das Regelmaß, nicht die Art: „Kernbohrung Ø 152 (DN 100)"
     * sagt in der Bauteilliste mehr als „Kernbohrung 3".
     */
    addDurchbruch: (preset, ziel) => {
      const wandgebunden = durchbruchWirt(preset.kind) === 'wand';
      if (wandgebunden && !('wallId' in ziel)) {
        set({ statusMessage: 'Ein Wanddurchbruch braucht eine Wand — näher an eine Wand tippen.' });
        return null;
      }
      const element: Durchbruch = {
        id: uid('db'),
        kind: preset.kind,
        name: preset.label,
        levelId: get().doc.activeLevelId,
        form: preset.form,
        diameter: preset.diameter,
        width: preset.width,
        height: preset.height,
        service: preset.service,
        dn: preset.dn,
        brandschutz: 'keine',
      };
      if ('wallId' in ziel) {
        element.wallId = ziel.wallId;
        element.distance = roundMm(ziel.distance);
        element.sillHeight = preset.sillHeight ?? 0.3;
      } else {
        element.position = { x: roundMm(ziel.position.x), y: roundMm(ziel.position.y) };
        element.rotation = 0;
      }
      mutate((doc) => {
        if (!doc.durchbrueche) doc.durchbrueche = {};
        doc.durchbrueche[element.id] = element;
      });
      set({
        selection: { kind: 'durchbruch', id: element.id },
        selections: [{ kind: 'durchbruch', id: element.id }],
        statusMessage: `${preset.label} gesetzt`,
      });
      return element;
    },

    updateDurchbruch: (id, patch) =>
      mutate((doc) => {
        const db = (doc.durchbrueche ?? {})[id];
        if (!db || !doc.durchbrueche) return;
        const neu: Durchbruch = { ...db, ...patch };
        // Millimeter, nicht Mikrometer: alles, was hier gerundet wird, ist ein
        // Maß, nach dem jemand anreißt.
        if (neu.distance !== undefined) neu.distance = roundMm(neu.distance);
        if (neu.sillHeight !== undefined) neu.sillHeight = roundMm(neu.sillHeight);
        if (neu.diameter !== undefined) neu.diameter = roundMm(neu.diameter);
        if (neu.width !== undefined) neu.width = roundMm(neu.width);
        if (neu.height !== undefined) neu.height = roundMm(neu.height);
        if (neu.position) {
          neu.position = { x: roundMm(neu.position.x), y: roundMm(neu.position.y) };
        }
        doc.durchbrueche[id] = neu;
      }),

    legeRohrnetzAus: (mode, anordnung) => {
      const s = get();
      let anzahlDurchbrueche = 0;
      let ohneRegelmass = 0;
      /*
       * Ausgelegt wird das **Gebäude**, nicht nur das sichtbare Geschoss.
       *
       * Steht der Speicher im Keller und hängen die Heizkörper darüber, gibt
       * es ohne Steigleitung gar keine Verbindung — gemeldet am 22.09.2026.
       * `planeGebaeudeNetz` findet das Quellgeschoss, setzt die Stränge und
       * rechnet von außen nach innen, damit jeder Strangabschnitt trägt, was
       * über ihm hängt. Gibt es nichts zu verbinden, ist das Ergebnis genau
       * die Auslegung des sichtbaren Geschosses wie zuvor.
       */
      const ergebnis = planeGebaeudeNetz(s.doc, {
        mode,
        levelId: s.doc.activeLevelId,
        /*
         * Vorlauf und Rücklauf werden hier **nicht** übergeben.
         *
         * Das Anlagenblatt ist nur die Untergrenze: Ein Heizkörperkreis
         * verlangt mindestens 50/40, und `planPipeNetwork` holt sich die
         * maßgebliche Temperatur über `systemtemperaturVon` aus demselben
         * Dokument, aus dem auch der Rohrnetzbericht sie nimmt. Bis 1.23.0
         * standen hier `plant.design.flowTemperature` und `.returnTemperature`
         * — an einem Heizkörperhaus mit 35/28 im Blatt legte die Trasse damit
         * mit 7 K statt 10 K Spreizung aus, also mit 43 % zu viel
         * Volumenstrom. Gemessen wanderten die Nennweiten dadurch eine bis
         * zwei Stufen zu hoch.
         */
        material: s.doc.plant?.design.material,
        anordnung,
      });

      /** Die Geschosse, die neu geplant wurden — nur dort wird ersetzt. */
      const geplant = new Set(ergebnis.geschosse.map((g) => g.levelId));

      mutate((doc) => {
        // Von Hand gezogene Leitungen bleiben; erzeugte werden ersetzt.
        const behalten = Object.values(doc.pipes ?? {}).filter(
          (r) => !(r.generated && geplant.has(r.levelId)),
        );
        doc.pipes = Object.fromEntries([
          ...behalten.map((r) => [r.id, r] as const),
          ...ergebnis.runs.map((r) => [r.id, r] as const),
        ]);
        const armaturen = Object.values(doc.pipeAccessories ?? {}).filter(
          (a) => !(a.generated && geplant.has(a.levelId)),
        );
        doc.pipeAccessories = Object.fromEntries([
          ...armaturen.map((a) => [a.id, a] as const),
          ...ergebnis.accessories.map((a) => [a.id, a] as const),
        ]);

        /*
         * --- Durchbrüche ----------------------------------------------------
         *
         * Jede Wand, die die Trasse kreuzt, braucht ein Loch. Das war bis
         * 1.25.0 eine Textnotiz im Bericht und sonst nichts: Der Rohbau bekam
         * eine Leitungsführung ohne Bohrungen, und gebohrt wurde, wenn der
         * Estrich lag.
         *
         * Gezählt wird gegen **alle** Leitungen dieses Geschosses, nicht nur
         * gegen die eben erzeugten — eine von Hand gezogene Leitung geht
         * genauso durch die Wand. Erzeugte Durchbrüche dieses Geschosses
         * werden dabei ersetzt, von Hand gesetzte bleiben stehen.
         */
        const eigene = Object.values(doc.durchbrueche ?? {}).filter(
          (d) => !(d.generated && geplant.has(d.levelId)),
        );
        const leitungen = Object.values(doc.pipes).filter((r) => geplant.has(r.levelId));
        const gebohrt = durchbruecheFuerTrassen(doc, leitungen, () => uid('db'));
        doc.durchbrueche = Object.fromEntries([
          ...eigene.map((d) => [d.id, d] as const),
          ...gebohrt.durchbrueche.map((d) => [d.id, d] as const),
        ]);
        anzahlDurchbrueche = gebohrt.durchbrueche.length;
        ohneRegelmass = gebohrt.ohneRegelmass;
      });

      const schwer = ergebnis.notes.find((n) => n.severity === 'error');
      if (ohneRegelmass > 0) {
        ergebnis.notes.push({
          severity: 'warn',
          text:
            `${ohneRegelmass} ${ohneRegelmass === 1 ? 'Wandquerung hat' : 'Wandquerungen haben'} kein Regelmaß im Katalog — ` +
            `dort ist von Hand ein Durchbruch zu setzen. Eine zu kleine Bohrung einzutragen wäre schlimmer als keine.`,
        });
      }
      set({
        statusMessage: schwer
          ? schwer.text
          : `Rohrnetz ausgelegt — ${ergebnis.served} Verbraucher, ${ergebnis.routeLength.toFixed(1)} m Trasse, ` +
            `${ergebnis.pipeLength.toFixed(1)} m Rohr, ${ergebnis.accessories.length} Armaturen, ` +
            `${anzahlDurchbrueche} ${anzahlDurchbrueche === 1 ? 'Durchbruch' : 'Durchbrüche'}` +
            (ergebnis.geschosse.length > 1
              ? ` · ${ergebnis.geschosse.length} Geschosse, ${ergebnis.straenge.length} Steigleitung(en)`
              : ''),
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

      /*
       * Doppelleitung: ein Zug, zwei Rohre.
       *
       * Der Partner entsteht durch Parallelverschiebung um denselben
       * `PAARABSTAND`, den die automatische Auslegung benutzt — die beiden
       * Wege dürfen nicht verschiedene Abstände haben, sonst liegt eine von
       * Hand gezogene Trasse anders im Kanal als eine ausgelegte. Verschoben
       * wird um den halben Abstand nach jeder Seite, damit der gezeichnete
       * Zug die **Mitte** des Paares bleibt: Wer an einer Wand entlangzeichnet,
       * meint die Trasse, nicht den Vorlauf.
       *
       * Nur für die Heizung. Ein Abwasserrohr hat keinen Rücklauf, und ein
       * stillschweigend verdoppelter Zuluftkanal wäre ein Fehler, den man
       * erst im Massenauszug fände.
       */
      const paarbar = service === 'heating-flow' || service === 'heating-return';
      /*
       * Die Trassenlänge **vor** der Paarbildung merken.
       *
       * `bildePaar` versetzt den übergebenen Zug an Ort und Stelle nach
       * links; danach ist seine Länge nicht mehr die der gezeichneten
       * Trasse, sondern die des inneren Rohrs. An einer rechtwinkligen Ecke
       * sind das 50 mm Unterschied — und die Meldung sagte „7,95 m Trasse",
       * wo der Anwender 8,00 m gezogen hatte. Eine Zahl, die um fünf
       * Zentimeter neben dem liegt, was man gerade angerissen hat, ist
       * schlimmer als keine.
       */
      const trasse = rohrlaenge(run);
      const partner: PipeRun | null =
        paarbar && get().doppelleitung ? bildePaar(run, uid('p'), uid('pp')) : null;

      mutate((doc) => {
        doc.pipes[run.id] = run;
        if (partner) doc.pipes[partner.id] = partner;
      });
      /*
       * **Die wahre Länge in der Meldung, nicht die Trassenlänge.**
       *
       * `addPipe` legt einen waagerechten Abschnitt an, also sind beide
       * Zahlen hier meist gleich. Meist — nicht immer: Die begehbare Ansicht
       * legt den Abschnitt zuerst an und setzt die zweite Höhe unmittelbar
       * danach. In der Abnahme von 1.24.0 stand deshalb am Bildschirm
       * „0,02 m verlegt", während derselbe Strang im Export mit 2,40 m
       * geführt wurde — zwei Zahlen für dieselbe Leitung, im Abstand von
       * einer Sekunde. Gerechnet wird deshalb auch hier mit `rohrlaenge`.
       */
      const meter = (v: number): string => `${v.toFixed(2).replace('.', ',')} m`;
      set({
        selection: { kind: 'pipe', id: run.id },
        selections: partner
          ? [
              { kind: 'pipe', id: run.id },
              { kind: 'pipe', id: partner.id },
            ]
          : [{ kind: 'pipe', id: run.id }],
        statusMessage: partner
          ? `Doppelleitung ${rohrbezeichnung(run)} · ${meter(trasse)} Trasse · ` +
            `${meter(2 * trasse)} Rohr (Vor- und Rücklauf)`
          : `${PIPE_SERVICE_LABELS[service]} ${rohrbezeichnung(run)} · ${meter(trasse)} verlegt`,
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
      let ersetzt = false;
      mutate((doc) => {
        // Es gibt genau eine Grundstücksgrenze. Eine zweite wäre kein
        // zweites Grundstück, sondern ein Widerspruch.
        if (kind === 'boundary') {
          for (const existing of Object.values(doc.site.elements)) {
            if (existing.kind === 'boundary') {
              delete doc.site.elements[existing.id];
              ersetzt = true;
            }
          }
        }
        doc.site.elements[element.id] = element;
      });
      set({
        selection: { kind: 'site', id: element.id },
        selections: [{ kind: 'site', id: element.id }],
        /*
         * Dass die alte Grenze dabei verschwindet, muss dastehen.
         *
         * Vorher hieß es nur „Grundstücksgrenze angelegt", während die zuvor
         * gezeichnete stillschweigend gelöscht wurde. Wer nach dem Zeichnen
         * einer zweiten Fläche die erste vermisst, hält das für einen Fehler
         * im Programm — und sucht an der falschen Stelle. Die Vorgabe des
         * Geländewerkzeugs ist „Grundstücksgrenze", der Fall tritt also
         * ungewollt ein, sobald jemand zweimal hintereinander umfährt.
         */
        statusMessage: ersetzt
          ? 'Grundstücksgrenze ersetzt — es gibt nur eine. Strg+Z holt die alte zurück.'
          : `${SITE_ELEMENT_LABELS[kind]} angelegt`,
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
        // Aufgestellt wird auf dem Geschoss, auf dem man steht. Nur dort ist
        // das Gerät danach greifbar — siehe `aufstellgeschoss.ts`.
        levelId: get().doc.activeLevelId,
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

    setzeAnlagenAntworten: (antworten) =>
      mutate(
        (doc) => {
          const { storages, circuits } = anlageAusAntworten(
            antworten,
            { storages: doc.plant.storages, circuits: doc.plant.circuits },
            Object.values(doc.rooms),
          );
          doc.plant = { ...doc.plant, antworten, storages, circuits };
        },
        {
          skipRooms: true,
          /*
           * Die Heizkreistemperaturen hängen an den Kreisen, und an ihnen
           * hängt jede abgeleitete Heizflächenleistung. Wer aus einem
           * ungemischten einen gemischten Kreis macht, ändert die Auslegung
           * des ganzen Zweiges mit.
           */
          ziehenachHeizflaechen: true,
        },
      ),

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
      }, {
        skipRooms: true,
        /*
         * Ändert sich die Auslegungstemperatur, ändert sich jede abgeleitete
         * Heizflächenleistung mit — und zwar erheblich: zwischen 50/40 und
         * 35/28 liegt beim selben Raum fast der Faktor drei. Genau deshalb
         * wird hier nachgezogen, obwohl an der Geometrie nichts geschah.
         */
        ziehenachHeizflaechen:
          patch.design?.flowTemperature !== undefined || patch.design?.returnTemperature !== undefined,
      }),

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

        /*
         * Was für die Trasse gilt, gilt für beide Rohre.
         *
         * Vor- und Rücklauf einer Doppelleitung liegen im selben Kanal, im
         * selben Schlitz, im selben Loch: Sie haben dieselbe Höhe, dieselbe
         * Nennweite, dieselbe Dämmung und denselben Werkstoff. Ohne dieses
         * Nachziehen entstand genau der Fehler, den die Paarkennung
         * verhindern soll — in der begehbaren Ansicht wurde die Höhe am
         * angelegten Zug gesetzt, und der Rücklauf blieb auf der
         * Voreinstellung 0,05 m liegen, während der Vorlauf auf 2,45 m
         * stieg. Zwei Rohre in einem Kanal, zwei Meter auseinander.
         *
         * Lage, Leitungsart und Beschriftung wandern ausdrücklich **nicht**
         * mit: Die Punkte sind die versetzten des jeweiligen Rohrs, und die
         * Leitungsart ist das, was das Paar unterscheidet.
         */
        const paar = partnerVon(doc.pipes, doc.pipes[id]);
        if (!paar) return;
        const gemeinsam: Partial<PipeRun> = {};
        if (patch.elevation !== undefined) gemeinsam.elevation = patch.elevation;
        if (patch.elevationTo !== undefined) gemeinsam.elevationTo = patch.elevationTo;
        if (patch.nominalDiameter !== undefined) gemeinsam.nominalDiameter = patch.nominalDiameter;
        if (patch.insulation !== undefined) gemeinsam.insulation = patch.insulation;
        if (patch.material !== undefined) gemeinsam.material = patch.material;
        if (patch.outerDiameter !== undefined) gemeinsam.outerDiameter = patch.outerDiameter;
        if (Object.keys(gemeinsam).length > 0) doc.pipes[paar.id] = { ...paar, ...gemeinsam };
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
          const levelWalls = Object.values(doc0.walls).filter((w) => w.levelId === level.id);
          const outline: Vec2[] = [];
          for (const w of levelWalls) {
            const na = doc0.nodes[w.a];
            const nb = doc0.nodes[w.b];
            if (na) outline.push({ x: na.x, y: na.y });
            if (nb) outline.push({ x: nb.x, y: nb.y });
          }
          // Gesucht wird gleich die niedrigste Stelle im Raum. Ohne den
          // geordneten Umriss wäre das beim L-Grundriss die niedrigste Stelle
          // eines Daches, das es nicht gibt — die Gaube stünde dann irgendwo.
          const frame = buildRoofFrame(level.roof, outline, [], gebaeudeUmriss(levelWalls, doc0.nodes));
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

    setVorhaben: (vorhaben) => {
      const vorher = get().doc.meta.vorhaben;
      const v = VORHABEN_VORBELEGUNG[vorhaben];
      mutate(
        (doc) => {
          doc.meta = { ...doc.meta, vorhaben };
          /*
           * **Vorbelegungen nur beim ersten Festlegen.**
           *
           * Wechselt jemand später von „Neubau" auf „Sanierung", ist die
           * Anlage in aller Regel schon bearbeitet. Alles zurückzustellen
           * wäre dann kein Dienst, sondern Datenverlust — die
           * Auslegungstemperatur, die jemand bewusst auf 45/38 gesetzt hat,
           * spränge ohne Rückfrage auf 55/45. Beim *ersten* Mal dagegen
           * steht überall noch die Vorgabe, und genau dort hilft die
           * Ableitung.
           */
          if (vorher !== undefined) return;
          doc.plant = {
            ...doc.plant,
            design: {
              ...doc.plant.design,
              flowTemperature: v.vorlauf,
              returnTemperature: v.ruecklauf,
            },
          };
          // Ohne Vorbelegung für die Luftdichtheit bleibt das Feld, wie es
          // ist — beim unsanierten Bestand gibt es keine Zahl, die man
          // annehmen darf (siehe `VORHABEN_VORBELEGUNG`).
          doc.meta = { ...doc.meta, vorhaben, ...(v.n50 !== undefined ? { n50: v.n50 } : {}) };
        },
        { skipRooms: true, ziehenachHeizflaechen: vorher === undefined },
      );
      set({
        statusMessage:
          vorher === undefined
            ? `${VORHABEN_LABELS[vorhaben]}: Vorbelegung ${v.vorlauf}/${v.ruecklauf} °C` +
              (v.n50 !== undefined ? `, n50 ${String(v.n50).replace('.', ',')} 1/h` : '') +
              ` — ${v.grund}`
            : `${VORHABEN_LABELS[vorhaben]} — vorhandene Eingaben bleiben unverändert`,
      });
    },

    setzeArmatur: (kind, position, elevation, label) => {
      const s = get();
      const levelId = s.doc.activeLevelId;
      /*
       * Die nächste Leitung in Reichweite bekommt die Armatur.
       *
       * **Warum eine halbe Meter breite Reichweite und nicht der genaue
       * Punkt.** Wer im Haus steht und auf ein Rohr zeigt, trifft es auf
       * wenige Zentimeter genau — aber der Strahl trifft die *Oberfläche*
       * des Rohres, die Trasse läuft durch seine Achse, und eine Leitung
       * unter der Decke wird aus zwei Metern Entfernung anvisiert. Ein
       * exakter Vergleich fände nie etwas. Fünfzig Zentimeter ist die
       * Entfernung, in der im Raum nichts anderes mehr in Frage kommt.
       */
      const REICHWEITE = 0.5;
      let runId: string | undefined;
      let naechste = REICHWEITE;
      for (const r of Object.values(s.doc.pipes ?? {})) {
        if (r.levelId !== levelId) continue;
        for (let i = 0; i + 1 < r.points.length; i += 1) {
          const d = distanceToSegment(position, r.points[i], r.points[i + 1]);
          if (d < naechste) {
            naechste = d;
            runId = r.id;
          }
        }
      }
      const armatur: PipeAccessory = {
        id: uid('ar'),
        kind,
        levelId,
        position: { x: roundMm(position.x), y: roundMm(position.y) },
        elevation: roundMm(elevation),
        runId,
        label: label ?? ACCESSORY_LABELS[kind],
        reason: 'Von Hand gesetzt — Bestandsaufnahme',
      };
      mutate((doc) => {
        if (!doc.pipeAccessories) doc.pipeAccessories = {};
        doc.pipeAccessories[armatur.id] = armatur;
      });
      set({
        selection: { kind: 'accessory', id: armatur.id },
        selections: [{ kind: 'accessory', id: armatur.id }],
        statusMessage: runId
          ? `${armatur.label} gesetzt und an die Leitung gebunden`
          : `${armatur.label} gesetzt — keine Leitung in Reichweite, steht frei`,
      });
      return armatur;
    },

    setzeBeschriftung3D: (anchor, punkt, elevation, text) => {
      const note: Annotation = {
        id: uid('a'),
        kind: 'leader',
        levelId: get().doc.activeLevelId,
        /*
         * Zwei Punkte, wie jede Hinweisfahne: Spitze und Textpunkt.
         *
         * Die Spitze sitzt am Bauteil, der Text 0,60 m schräg darüber. Ohne
         * den Versatz läge die Schrift im Grundriss genau auf dem Symbol,
         * das sie erklärt — und verdeckte es.
         */
        points: [
          { x: roundMm(punkt.x), y: roundMm(punkt.y) },
          { x: roundMm(punkt.x + 0.42), y: roundMm(punkt.y + 0.42) },
        ],
        offset: 0,
        text,
        scale: 1,
        elevation: roundMm(elevation),
        anchor,
      };
      mutate((doc) => {
        doc.annotations[note.id] = note;
      });
      set({
        selection: { kind: 'annotation', id: note.id },
        selections: [{ kind: 'annotation', id: note.id }],
        statusMessage: `Beschriftet: ${text} auf ${hoehenText(elevation)}`,
      });
      return note;
    },

    updateAnnotation: (id, patch) =>
      mutate((doc) => {
        const note = doc.annotations[id];
        if (!note) return;
        // Punkte auf den Millimeter runden — dieselbe Regel wie beim Anlegen.
        // Ohne sie sammelt eine verschobene Beschriftung Fließkommareste an,
        // die später als krumme Koordinaten im Plan und im Export stehen.
        const punkte = patch.points?.map((p) => ({ x: roundMm(p.x), y: roundMm(p.y) }));
        doc.annotations[id] = { ...note, ...patch, ...(punkte ? { points: punkte } : {}) };
      }),

    deleteAnnotation: (id) =>
      mutate((doc) => {
        if (!doc.annotations[id]) return;
        const rest = { ...doc.annotations };
        delete rest[id];
        doc.annotations = rest;
      }),

    /**
     * Ein Dach hinzufügen.
     *
     * **Der Vorschlag für die Räume ist die halbe Funktion.** Ein neues Dach
     * bekommt die Räume, über denen **kein Geschoss liegt** und die noch
     * keinem anderen Dach gehören. Das ist die Regel „wo ein Geschoss
     * darüberliegt, ist eine Decke und kein Dach", als Vorbelegung statt als
     * Verbot: Wer ein Vordach über einem Erker will, hakt den Raum von Hand
     * dazu, und die Prüfung sagt, dass er es getan hat.
     */
    addRoof: (levelId) => {
      const doc0 = get().doc;
      const level0 = doc0.levels[levelId];
      if (!level0) return;
      const geschosse = Object.values(doc0.levels).sort((a, b) => a.order - b.order);
      const index = geschosse.findIndex((l) => l.id === levelId);
      const darueber = geschosse[index + 1];
      const hier = Object.values(doc0.rooms ?? {}).filter((r) => r.levelId === levelId);
      const oben = darueber
        ? Object.values(doc0.rooms ?? {}).filter((r) => r.levelId === darueber.id)
        : [];
      const vergeben = new Set(daecherVon(level0).flatMap((r) => r.roomIds ?? []));
      const frei = raeumeOhneGeschossDarueber(hier, oben).filter((id) => !vergeben.has(id));

      mutate((doc) => {
        const level = doc.levels[levelId];
        if (!level) return;
        const bisher = daecherVon(level);
        doc.levels[levelId] = {
          ...level,
          roof: undefined,
          roofs: [
            ...bisher,
            {
              ...DEFAULT_ROOF,
              id: `dach-${Date.now().toString(36)}`,
              name: `Dach ${bisher.length + 1}`,
              roomIds: frei,
            },
          ],
        };
      });
      set({
        statusMessage: frei.length
          ? `Dach angelegt über ${frei.length} ${frei.length === 1 ? 'Raum' : 'Räumen'} ohne Geschoss darüber.`
          : 'Dach angelegt — es deckt noch keinen Raum. Räume unten zuweisen.',
      });
    },

    /** Ein Dach entfernen. Das letzte zu entfernen heißt: waagerechte Decke. */
    entferneRoof: (levelId, roofId) => {
      mutate((doc) => {
        const level = doc.levels[levelId];
        if (!level) return;
        const rest = daecherVon(level).filter((r) => r.id !== roofId);
        doc.levels[levelId] = {
          ...level,
          roof: undefined,
          roofs: rest.length ? rest : undefined,
        };
      });
      set({ statusMessage: 'Dach entfernt.' });
    },

    /**
     * Ein einzelnes Dach ändern.
     *
     * **Warum jede Änderung auf `roofs` schreibt.** `level.roof` (eines) und
     * `level.roofs` (mehrere) stehen nebeneinander, damit alte Projekte
     * aufgehen. Zwei Quellen für dieselbe Sache sind aber ein Fehler, der
     * darauf wartet zu passieren — deshalb wandert ein Projekt beim ersten
     * Schreiben nach `roofs`, und `roof` wird geleert. Gelesen wird ohnehin
     * nur über `daecherVon`.
     */
    setRoofById: (levelId, roofId, patch) => {
      mutate((doc) => {
        const level = doc.levels[levelId];
        if (!level) return;
        const daecher = daecherVon(level).map((r) =>
          r.id === roofId ? { ...DEFAULT_ROOF, ...r, ...patch } : r,
        );
        doc.levels[levelId] = { ...level, roof: undefined, roofs: daecher };
      });
    },

    setRoof: (levelId, patch) => {
      mutate((doc) => {
        const level = doc.levels[levelId];
        if (!level) return;
        if (patch === null) {
          doc.levels[levelId] = { ...level, roof: undefined, roofs: undefined };
          return;
        }
        /*
         * Der alte Weg — er ändert **das erste** Dach. Er bleibt, weil ihn
         * der Dachreiter für den Regelfall (ein Haus, ein Dach) benutzt und
         * weil die Einbettungsschnittstelle ihn kennt.
         */
        const daecher = daecherVon(level);
        if (daecher.length > 1) {
          doc.levels[levelId] = {
            ...level,
            roof: undefined,
            roofs: daecher.map((r, i) => (i === 0 ? { ...DEFAULT_ROOF, ...r, ...patch } : r)),
          };
          return;
        }
        doc.levels[levelId] = { ...level, roof: { ...DEFAULT_ROOF, ...level.roof, ...patch }, roofs: undefined };
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

    sperreEbene: (id, gesperrt) =>
      mutate(
        (doc) => {
          const layer = doc.layers[id];
          if (layer) doc.layers[id] = { ...layer, locked: gesperrt };
        },
        { skipRooms: true },
      ),

    /*
     * Den Bestand sperren oder freigeben.
     *
     * Der Ablauf, für den es das gibt: Erst wird der Bestand aufgemessen,
     * dann steht man im Haus und setzt die Technik. In der zweiten Hälfte ist
     * jede Wandbewegung ein Unfall — und zwar einer, den man nicht bemerkt,
     * weil eine um zwei Zentimeter verschobene Wand im Plan aussieht wie
     * vorher und in der Heizlast nicht.
     */
    sperreBestand: (gesperrt) => {
      mutate(
        (doc) => {
          for (const id of BESTANDS_EBENEN) {
            const layer = doc.layers[id];
            if (layer) doc.layers[id] = { ...layer, locked: gesperrt };
          }
        },
        { skipRooms: true },
      );
      set({
        statusMessage: gesperrt
          ? 'Bestand gesperrt — Wände, Öffnungen, Räume und Durchbrüche lassen sich nicht mehr anfassen'
          : 'Bestand freigegeben',
      });
    },

    ebenenSatz: (satz) => {
      mutate(
        (doc) => {
          const an = new Set<string>(satz.sichtbar);
          for (const [id, layer] of Object.entries(doc.layers)) {
            // Das Referenzbild bleibt außen vor: Es ist keine Zeichnungsebene,
            // sondern die Vorlage, über der gezeichnet wird. Wer es
            // eingeblendet hat, will es beim Umschalten des Gewerks nicht
            // verlieren.
            if (id === 'layer-image') continue;
            doc.layers[id] = { ...layer, visible: an.has(id) };
          }
        },
        { skipRooms: true },
      );
      set({ statusMessage: `${satz.label}: ${satz.auskunft}` });
    },

    deleteSelection: () => {
      const { selections, selection, doc: doc0 } = get();
      const gewaehlt = selections.length ? selections : selection ? [selection] : [];
      // Gesperrtes wird nicht gelöscht — siehe `moveSelection`.
      const targets = gewaehlt.filter((t) => !auswahlGesperrt(doc0, t));
      if (!targets.length) {
        if (gewaehlt.length) set({ statusMessage: 'Gesperrt — im Reiter „Ebenen" freigeben' });
        return;
      }

      /*
       * Gezählt wird, was wirklich weg ist.
       *
       * Vorher meldete die Statuszeile die Zahl der *angewählten* Objekte.
       * Wer einen Raum anklickte und Entf drückte, las „1 Objekt gelöscht"
       * und sah den Raum weiter im Plan stehen — eine Rückmeldung, die
       * lügt, ist schlimmer als gar keine. Räume sind abgeleitet: sie
       * verschwinden, wenn die Wände verschwinden, und nicht auf Zuruf.
       */
      let entfernt = 0;
      let geblieben = 0;
      /*
       * Vor der Änderung zählen, nicht danach.
       *
       * Nach `mutate` ist die Armatur weg, und `doc0` — der Stand von vorher
       * — führt sie nicht mehr, weil beide Stände sich dasselbe Verzeichnis
       * teilten. Das ist seit dieser Fassung behoben (siehe `cloneDoc`);
       * hier vorher zu zählen ist trotzdem das Richtige: Die Frage „war das
       * eine ausgelegte Armatur?" ist eine Frage an den Stand von vorher.
       */
      const ausgelegte = targets.filter(
        (t) => t.kind === 'accessory' && doc0.pipeAccessories?.[t.id]?.generated,
      ).length;
      mutate((doc) => {
        const zaehle = (weg: boolean): void => {
          if (weg) entfernt += 1;
          else geblieben += 1;
        };
        for (const sel of targets) {
          if (sel.kind === 'wall') {
            zaehle(sel.id in doc.walls);
            delete doc.walls[sel.id];
            for (const o of Object.values(doc.openings)) {
              if (o.wallId === sel.id) delete doc.openings[o.id];
            }
            // TGA-Objekte bleiben erhalten, verlieren aber ihre Wandbindung.
            for (const f of Object.values(doc.fixtures)) {
              if (f.wallId === sel.id) doc.fixtures[f.id] = { ...f, wallId: undefined };
            }
          } else if (sel.kind === 'opening') {
            zaehle(sel.id in doc.openings);
            delete doc.openings[sel.id];
          } else if (sel.kind === 'fixture') {
            zaehle(sel.id in doc.fixtures);
            delete doc.fixtures[sel.id];
          } else if (sel.kind === 'vertical') {
            zaehle(sel.id in doc.verticals);
            delete doc.verticals[sel.id];
          } else if (sel.kind === 'solid') {
            zaehle(Boolean(doc.solids && sel.id in doc.solids));
            if (doc.solids) delete doc.solids[sel.id];
          } else if (sel.kind === 'durchbruch') {
            zaehle(Boolean(doc.durchbrueche && sel.id in doc.durchbrueche));
            if (doc.durchbrueche) delete doc.durchbrueche[sel.id];
          } else if (sel.kind === 'pipe') {
            zaehle(sel.id in doc.pipes);
            // Der Rücklauf geht mit dem Vorlauf. Eine Heizung, die nur
            // hinführt, ist kein Zwischenstand, sondern ein Fehler — und
            // einer, den man im Plan nicht sieht.
            const paar = doc.pipes[sel.id] ? partnerVon(doc.pipes, doc.pipes[sel.id]) : undefined;
            delete doc.pipes[sel.id];
            if (paar) {
              // Auch der Partner wird gezählt. „1 Objekt gelöscht", wenn zwei
              // verschwunden sind, ist genau die Sorte Rückmeldung, wegen der
              // man dem Programm beim nächsten Mal nicht mehr glaubt.
              zaehle(true);
              delete doc.pipes[paar.id];
              for (const a of Object.values(doc.pipeAccessories ?? {})) {
                if (a.runId === paar.id) delete doc.pipeAccessories![a.id];
              }
            }
            /*
             * Mit der Leitung gehen die Armaturen, die auf ihr sitzen.
             *
             * Eine Armatur ohne Leitung ist kein Bauteil mehr, sondern ein
             * Symbol, das im Plan hängen bleibt und in den Massenauszug
             * geht. Von Hand gesetzte bleiben stehen, wenn sie keiner
             * Leitung zugeordnet sind — sie gehören dann dem Anwender.
             */
            for (const a of Object.values(doc.pipeAccessories ?? {})) {
              if (a.runId === sel.id) delete doc.pipeAccessories![a.id];
            }
          } else if (sel.kind === 'accessory') {
            /*
             * Auch eine ausgelegte Armatur lässt sich entfernen.
             *
             * Sie kommt bei der nächsten Rohrnetzauslegung wieder, weil die
             * Rechnung sie fordert — das steht danach in der Statuszeile.
             * Eine Armatur nicht löschen zu können, weil das Programm sie
             * gesetzt hat, wäre die schlechtere Antwort: dann stünde sie im
             * Plan, ohne dass jemand sie wegbekäme.
             */
            const armatur = doc.pipeAccessories?.[sel.id];
            zaehle(Boolean(armatur));
            // Die ζ-Liste eines Abschnitts (`PipeSegment.accessories`) wird
            // beim Aufbau des Netzes aus `doc.pipeAccessories` neu
            // gebildet — sie braucht hier kein Nachräumen.
            if (armatur && doc.pipeAccessories) delete doc.pipeAccessories[sel.id];
          } else if (sel.kind === 'annotation') {
            zaehle(sel.id in doc.annotations);
            delete doc.annotations[sel.id];
          } else if (sel.kind === 'roofOpening') {
            zaehle(sel.id in doc.roofOpenings);
            delete doc.roofOpenings[sel.id];
          } else if (sel.kind === 'site') {
            zaehle(sel.id in doc.site.elements);
            delete doc.site.elements[sel.id];
          } else if (sel.kind === 'heatpump') {
            zaehle(sel.id in doc.site.pumps);
            delete doc.site.pumps[sel.id];
          } else if (sel.kind === 'node') {
            let weg = false;
            for (const w of Object.values(doc.walls)) {
              if (w.a === sel.id || w.b === sel.id) {
                weg = true;
                delete doc.walls[w.id];
                for (const o of Object.values(doc.openings)) {
                  if (o.wallId === w.id) delete doc.openings[o.id];
                }
              }
            }
            zaehle(weg);
          } else {
            // Raum, Bild, Spurkandidat: nichts zu löschen. Der Zähler
            // merkt es sich, damit die Rückmeldung stimmt.
            geblieben += 1;
          }
        }
        pruneNodes(doc);
      }, {
        // Fällt eine von zwei Heizflächen im Raum weg, muss die verbliebene
        // wieder die ganze Last tragen. Ohne dieses Nachziehen bliebe der
        // Raum mit halber Heizfläche im Heft stehen.
        ziehenachHeizflaechen: targets.some(
          (t) => t.kind === 'fixture' && istHeizflaeche(doc0.fixtures[t.id]?.type ?? 'radiator'),
        ),
      });
      const meldung =
        entfernt === 0
          ? geblieben === 1
            ? 'Nichts gelöscht — dieses Objekt entsteht aus anderen und verschwindet mit ihnen.'
            : 'Nichts gelöscht — diese Objekte entstehen aus anderen und verschwinden mit ihnen.'
          : `${entfernt} Objekt${entfernt === 1 ? '' : 'e'} gelöscht` +
            (geblieben > 0 ? `, ${geblieben} unverändert` : '') +
            (ausgelegte > 0
              ? ` · ${ausgelegte === 1 ? 'die ausgelegte Armatur kommt' : 'ausgelegte Armaturen kommen'} bei der nächsten Rohrnetzauslegung wieder`
              : '');
      set({ selection: null, selections: [], statusMessage: meldung });
    },

    /*
     * „Alles löschen" — jetzt wirklich alles.
     *
     * Was hier stand, räumte elf Sammlungen und ließ Grundstück, Wärmepumpe,
     * Armaturen, Freihandnotizen, Referenzbild, Dächer und die ausgelegte
     * Anlage stehen. Die Begründung dafür stand nirgends, und im Plan sah man
     * nur das Ergebnis: eine leere Zeichenfläche mit einer
     * Grundstücksgrenze darauf, die sich mit demselben Knopf nicht mehr
     * entfernen ließ. Was bleibt und was geht, steht jetzt an einer Stelle
     * und mit Begründung in `planLeeren.ts`.
     *
     * Zurückgegeben wird die Bilanz — der Aufrufer zeigt sie *vor* der
     * Rückfrage und danach in der Statuszeile.
     */
    clearAll: () => {
      const bilanz = loeschbilanz(get().doc);
      mutate((doc) => leerePlan(doc));
      set({
        selection: null,
        selections: [],
        trace: null,
        statusMessage: bilanzSatz(bilanz),
      });
      return bilanz;
    },

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
      set({ statusMessage: 'Demo-Grundriss geladen', einpassenZaehler: get().einpassenZaehler + 1 });
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
        einpassenZaehler: get().einpassenZaehler + 1,
      });

      /*
       * Die Namen, die der Architekt vergeben hat.
       *
       * `IfcSpace` ist die einzige Stelle in einer IFC-Datei, an der steht,
       * wie ein Raum heißt. Ohne sie kommt jeder Raum als „Raum 3",
       * Nutzung „sonstige", 20 °C an — beim FZK-Haus fünf Räume, beim
       * Institutsgebäude des KIT 82. Die Nutzung entscheidet über die
       * Solltemperatur nach DIN EN 12831; sie von Hand nachzutragen ist
       * genau die Arbeit, die ein Import abnehmen soll.
       *
       * Die **Geometrie** kommt weiter aus den Wänden. Der Umriss aus der
       * Datei dient nur dazu, den Raum wiederzufinden; würde er den
       * erkannten ersetzen, hätte das Modell zwei Wahrheiten, die beim
       * ersten Verschieben einer Wand auseinanderlaufen.
       */
      const zuordnung = ordneRaumnamenZu(
        Object.values(fresh.rooms).map((r) => ({
          id: r.id,
          levelId: r.levelId,
          polygon: r.polygon,
          area: r.area,
        })),
        result.spaces,
      );
      let zusammengefasst = 0;
      for (const z of zuordnung) {
        const raum = fresh.rooms[z.roomId];
        if (!raum) continue;
        const vorgabe = z.usage ? usageDefaults(z.usage) : undefined;
        fresh.rooms[z.roomId] = {
          ...raum,
          name: z.name,
          ...(z.usage && vorgabe
            ? {
                usage: z.usage,
                // Die Normwerte ziehen mit der Nutzung nach — sonst stünde
                // im Bad der Name „Bad" und daneben 20 °C. Dieselbe Regel
                // wie in `updateRoom`, nur ohne den Umweg über den Patch.
                setpointTemperature: vorgabe.temp,
                airChangeRate: vorgabe.ach,
                ventilationRole: vorgabe.air,
              }
            : {}),
        };
        zusammengefasst += z.weitere.length;
      }

      const rooms = Object.keys(fresh.rooms).length;
      // Alle Gründe nennen, nicht nur den ersten.
      //
      // Vorher stand hier `result.skipped[0].reason`. Beim FZK-Haus des KIT
      // waren zwei Gründe im Spiel — vier Wände ohne auswertbare Geometrie
      // und drei Öffnungen, die deshalb ihre Wand verloren hatten. Gemeldet
      // wurde nur der erste, und damit fehlte gerade der Hinweis, dass das
      // eine das andere nach sich zog. Die Liste ist kurz: es gibt nur eine
      // Handvoll Gründe, und jeder steht mit seiner Anzahl da.
      const uebersprungen = result.skipped.reduce((sum, s2) => sum + s2.count, 0);
      const gruende = result.skipped.map((s2) => `${s2.count}× ${s2.reason}`).join(', ');
      const vorbehalte = result.hinweise.map((h) => `${h.count}× ${h.reason}`).join(', ');
      return {
        ok: true,
        message:
          `IFC ${result.schema ?? ''}: ${result.walls.length} Wände, ${result.openings.length} Öffnungen, ` +
          `${rooms} Räume erkannt` +
          (zuordnung.length ? `, ${zuordnung.length} benannt` : '') +
          (uebersprungen ? ` — ${uebersprungen} Bauteile übersprungen (${gruende})` : '') +
          (vorbehalte ? ` · Hinweis: ${vorbehalte}` : '') +
          // Wo der Architekt Raumgrenzen ohne Wand gezogen hat, erkennt
          // CAD Light zu Recht einen Raum — aber der Nutzer soll erfahren,
          // dass die Datei dort mehr Räume kennt als sein Grundriss.
          (zusammengefasst
            ? ` · ${zusammengefasst} Raum/Räume der Datei liegen ohne trennende Wand in einem erkannten Raum`
            : ''),
      };
    },

    /**
     * Liest einen Raumscan aus Apple RoomPlan ein.
     *
     * Wie beim IFC-Import entsteht bewusst ein *neues* Dokument. Was den Scan
     * vom IFC unterscheidet, ist die Rechenschaft: ein Scan misst Wände ohne
     * Dicke und kennt keinen Türanschlag. Beides wird geschätzt, und beides
     * steht hinterher in der Statuszeile — der Nutzer soll wissen, welche
     * Zahlen aus dem Aufmaß kommen und welche aus einer Annahme.
     */
    loadRaumscan: (text) => {
      const ergebnis = importRaumplan(text);
      if (!ergebnis.ok) return { ok: false, message: ergebnis.message };

      const { fresh, benannt, doppelt } = dokumentAusScan(ergebnis);

      set({
        doc: fresh,
        past: [...get().past.slice(-49), get().doc],
        future: [],
        selection: null,
        selections: [],
        einpassenZaehler: get().einpassenZaehler + 1,
      });

      const offen = fresh.diagnostics.openEnds.length;
      const raeume = Object.keys(fresh.rooms).length;
      return {
        ok: true,
        message:
          `${ergebnis.message} · ${raeume} Räume erkannt, ${benannt} benannt` +
          (doppelt
            ? ` · ${doppelt} Raumname nicht vergeben: dort liegen zwei Bereiche in einem Raum, zwischen ihnen fehlt eine Wand`
            : '') +
          (offen ? ` · ${offen} offene Wandenden — der Scan hat dort keine Wand gemessen` : ''),
      };
    },

    /**
     * Übernimmt das Gebäudemodell der App RaVia Scan.
     *
     * Geometrie wie beim Raumscan (gleicher Weg über `dokumentAusScan`), dazu
     * zwei Dinge, die eine RoomPlan-Datei nicht kennt: den **Dachvorschlag**
     * je Geschoss, geschätzt aus den gescannten Dachschrägen, und die
     * **Heizkörper** mit gemessenen Maßen. Beide werden vor der Raumerkennung
     * eingesetzt, damit Dachräume ihre Höhen und Heizkörper ihren Raum
     * bekommen. Eine Heizleistung setzt der Import nicht.
     */
    loadBuilding: (data, optionen) => {
      const ergebnis = importBuildingModel(data);
      if (!ergebnis.ok) return { ok: false, message: ergebnis.message };

      const { fresh, benannt, doppelt } = dokumentAusScan(ergebnis, (doc) => {
        for (const [levelId, dach] of Object.entries(ergebnis.daecher)) {
          const level = doc.levels[levelId];
          if (level) doc.levels[levelId] = { ...level, roof: { ...DEFAULT_ROOF, ...dach } };
        }
        for (const f of ergebnis.fixtures) {
          if (doc.levels[f.levelId]) doc.fixtures[f.id] = f;
        }
      });
      if (ergebnis.koordinaten && !fresh.meta.name) fresh.meta.name = 'Gebäudescan';

      /*
       * Hinzufügen statt ersetzen.
       *
       * Ein Haus wird selten in einem Zug gescannt: Reißt das Tracking auf
       * der Treppe, kommt das Obergeschoss als zweite Aufnahme. Dann darf
       * der Scan das Erdgeschoss nicht wegwerfen. Ersetzt wird deshalb nur
       * das Geschoss, das der Scan mitbringt — alles andere bleibt stehen.
       *
       * Die Lage in der Ebene ist damit noch nicht geklärt: Zwei Aufnahmen
       * haben zwei Nullpunkte. Das Geschoss landet dort, wo der Scan es
       * sieht; zurechtschieben geht wie bei jedem kopierten Geschoss.
       */
      let ziel = fresh;
      let ergaenzt = 0;
      let ersetzt = 0;
      let benanntGesamt = benannt;
      let doppeltGesamt = doppelt;
      const vorher = get().doc;
      if (optionen?.merge && Object.keys(vorher.walls).length > 0) {
        ziel = structuredClone(vorher);
        ziel.meta = { ...ziel.meta, modifiedAt: new Date().toISOString() };
        for (const level of Object.values(fresh.levels)) {
          if (ziel.levels[level.id]) ersetzt++;
          else ergaenzt++;
          // Was auf diesem Geschoss stand, stammt aus dem vorigen Scan
          // desselben Geschosses und wird ersetzt.
          for (const w of Object.values(ziel.walls)) if (w.levelId === level.id) delete ziel.walls[w.id];
          for (const o of Object.values(ziel.openings)) {
            if (!ziel.walls[o.wallId]) delete ziel.openings[o.id];
          }
          for (const n of Object.values(ziel.nodes)) if (n.levelId === level.id) delete ziel.nodes[n.id];
          for (const f of Object.values(ziel.fixtures)) if (f.levelId === level.id) delete ziel.fixtures[f.id];
          for (const r of Object.values(ziel.rooms)) if (r.levelId === level.id) delete ziel.rooms[r.id];
          ziel.levels[level.id] = level;
        }
        /*
         * Kennungen eindeutig machen.
         *
         * Zwei Aufnahmen nennen ihre erste Wand beide `w-001` — die Zählung
         * beginnt in jedem Scan von vorn. Würde man sie unverändert
         * übernehmen, überschriebe das Obergeschoss die Wände des
         * Erdgeschosses, und der Grundriss darunter verschwände. Beim
         * Zusammenlegen bekommt deshalb alles aus dem neuen Scan das
         * Geschoss als Vorsatz.
         */
        const zielGeschoss = Object.values(fresh.levels)[0]?.id ?? 'x';
        const vorsatz = (id: string): string => `${zielGeschoss}-${id}`;
        const neueKnoten = new Map<string, string>();
        for (const n of Object.values(fresh.nodes)) {
          const id = vorsatz(n.id);
          neueKnoten.set(n.id, id);
          ziel.nodes[id] = { ...n, id };
        }
        const neueWaende = new Map<string, string>();
        for (const w of Object.values(fresh.walls)) {
          const id = vorsatz(w.id);
          neueWaende.set(w.id, id);
          ziel.walls[id] = { ...w, id, a: neueKnoten.get(w.a) ?? w.a, b: neueKnoten.get(w.b) ?? w.b };
        }
        for (const o of Object.values(fresh.openings)) {
          const id = vorsatz(o.id);
          ziel.openings[id] = { ...o, id, wallId: neueWaende.get(o.wallId) ?? o.wallId };
        }
        for (const f of Object.values(fresh.fixtures)) {
          const id = vorsatz(f.id);
          ziel.fixtures[id] = { ...f, id, ...(f.wallId ? { wallId: neueWaende.get(f.wallId) ?? f.wallId } : {}) };
        }
        // Geschosse neu ordnen: die Reihenfolge ergibt sich aus der Höhenlage.
        const sortiert = Object.values(ziel.levels).sort((a, b) => a.elevation - b.elevation);
        const egIdx = erdgeschossIndex(sortiert.map((l) => l.elevation));
        sortiert.forEach((l, i) => { ziel.levels[l.id] = { ...l, order: i - egIdx }; });
        ziel.activeLevelId = Object.values(fresh.levels)[0]?.id ?? ziel.activeLevelId;
        recomputeRooms(ziel);
        const namen = benenneRaeume(ziel, ergebnis.raumHinweise);
        benanntGesamt = namen.benannt;
        doppeltGesamt = namen.doppelt;
      }

      set({
        doc: ziel,
        past: [...get().past.slice(-49), get().doc],
        future: [],
        selection: null,
        selections: [],
        einpassenZaehler: get().einpassenZaehler + 1,
      });

      const offen = ziel.diagnostics.openEnds.length;
      const raeume = Object.keys(ziel.rooms).length;
      const dazu = ziel === fresh ? '' :
        ` · ${ergaenzt} Geschoss(e) ergänzt${ersetzt ? `, ${ersetzt} ersetzt` : ''}, bestehende Geschosse bleiben stehen`;
      return {
        ok: true,
        message:
          `RaVia Scan: ${ergebnis.message}${dazu} · ${raeume} Räume erkannt, ${benanntGesamt} benannt` +
          (doppeltGesamt ? ` · ${doppeltGesamt} Raumname nicht vergeben (zwei Bereiche in einem Raum, dazwischen fehlt eine Wand)` : '') +
          (offen ? ` · ${offen} offene Wandenden` : '') +
          (ergebnis.nordGenauigkeitGrad !== undefined
            ? ` · Nordrichtung ±${String(ergebnis.nordGenauigkeitGrad).replace('.', ',')}°`
            : ''),
      };
    },

    /**
     * Wände gerade ziehen.
     *
     * Bewegt Knoten, nicht Wände — siehe `lib/begradigen.ts`. Öffnungen wandern
     * **verhältnisgleich** mit: ändert sich die Wandlänge um ein Prozent, rückt
     * eine Tür in der Wandmitte um ein halbes Prozent. Absolut stehen zu lassen
     * wäre die naheliegende und falsche Wahl — eine Öffnung am fernen Ende
     * stünde nach dem Begradigen über der Wandkante und verschwände beim
     * nächsten Neuzeichnen.
     */
    /**
     * Was eine Angleichung täte — ohne sie zu tun.
     *
     * Eigene Funktion und nicht ein Rückgabewert von `gleicheWandhoehenAn`,
     * weil die Vorschau bei **jedem** Bild gebraucht wird: Der Knopf trägt
     * die Zahl, bevor ihn jemand drückt. Ein Knopf, der erst nach dem
     * Drücken sagt, was er getan hat, ist bei einer Änderung an 40 Wänden
     * kein Angebot, sondern eine Zumutung.
     */
    wandhoehenVorschau: () => {
      const doc = get().doc;
      const level = doc.levels[doc.activeLevelId];
      const waende = Object.values(doc.walls);
      if (!level) {
        return { soll: 0, aenderungen: [], ausnahmen: [], groessteAbweichung: 0, gesamt: 0 };
      }
      return hoehenbefund({ level, walls: waende, nodes: doc.nodes, roofFrames: dachGeruest(doc, level) });
    },

    /**
     * Wandhöhen angleichen.
     *
     * **Warum das überhaupt nötig ist.** Die Raumhöhe ist in diesem Programm
     * keine Eingabe, sondern eine Messung: die *niedrigste* Wand des Raums.
     * Eine Wand, die beim Zeichnen auf 2,19 m stehen geblieben ist, macht
     * daraus die Höhe des ganzen Raums — und damit sein Volumen, seinen
     * Luftwechsel und seinen Lüftungsverlust. Im Plan steht dann neben
     * 2,44 m ein 2,19 m, das nie jemand gemessen hat.
     *
     * Angefasst wird nur, was eine Raumwand ist und nicht unter der
     * Dachschräge liegt; die Begründung steht in `lib/wandhoehen.ts`. Der
     * Schritt geht in die Historie und ist mit Rückgängig zu widerrufen —
     * eine Änderung an vielen Wänden auf einmal muss man zurücknehmen
     * können, ohne sie einzeln zu suchen.
     */
    gleicheWandhoehenAn: () => {
      const doc = get().doc;
      const level = doc.levels[doc.activeLevelId];
      if (!level) {
        const m = 'Kein Geschoss gewählt.';
        set({ statusMessage: m });
        return { ok: false, message: m };
      }
      const befund = hoehenbefund({
        level,
        walls: Object.values(doc.walls),
        nodes: doc.nodes,
        roofFrames: dachGeruest(doc, level),
      });
      if (befund.aenderungen.length === 0) {
        const m = befundSatz(befund);
        set({ statusMessage: m });
        return { ok: false, message: m };
      }
      mutate((d) => {
        for (const a of befund.aenderungen) {
          const w = d.walls[a.wallId];
          if (w) d.walls[a.wallId] = { ...w, height: a.soll };
        }
      });
      const m = `Wandhöhen angeglichen: ${befundSatz(befund)}`;
      set({ statusMessage: m });
      return { ok: true, message: m };
    },

    begradigeWaende: (optionen) => {
      const doc = get().doc;
      const waende = Object.values(doc.walls).filter((w) => w.levelId === doc.activeLevelId);
      const ergebnis = begradige(waende, doc.nodes, optionen);
      if (ergebnis.bewegt === 0) {
        const meldung =
          ergebnis.achsparallelVorher === waende.length
            ? 'Alle Wände stehen bereits gerade.'
            : ergebnis.uebersprungen > 0
              ? `Nichts verändert — ${ergebnis.uebersprungen} Wandzüge hätten sich dabei um mehr als das Erlaubte verschoben.`
              : 'Nichts zu begradigen.';
        set({ statusMessage: meldung });
        return { ok: false, message: meldung };
      }

      mutate((d) => {
        for (const [id, p] of Object.entries(ergebnis.knoten)) {
          const n = d.nodes[id];
          if (n) d.nodes[id] = { ...n, x: p.x, y: p.y };
        }
        for (const o of Object.values(d.openings)) {
          const laenge = ergebnis.laengen[o.wallId];
          if (!laenge || laenge.vorher <= 0) continue;
          const faktor = laenge.nachher / laenge.vorher;
          const mitte = Math.min(
            Math.max(o.distance * faktor, o.width / 2),
            laenge.nachher - o.width / 2,
          );
          d.openings[o.id] = { ...o, distance: roundMm(mitte) };
        }
      });

      const message =
        `${ergebnis.bewegt} Knoten gerade gezogen, größter Versatz ` +
        `${ergebnis.groessterVersatz.toFixed(3).replace('.', ',')} m · ` +
        `${ergebnis.achsparallelNachher} von ${waende.length} Wänden stehen jetzt genau auf der Achse ` +
        `(vorher ${ergebnis.achsparallelVorher})` +
        (ergebnis.schraeg ? ` · ${ergebnis.schraeg} schräge Wände unangetastet` : '') +
        (ergebnis.uebersprungen ? ` · ${ergebnis.uebersprungen} Wandzüge übersprungen` : '');
      set({ statusMessage: message });
      return { ok: true, message };
    },

    spiegleGrundriss: (achse, umfang) => {
      const doc = get().doc;
      const ergebnis = spiegleDokument(doc, {
        achse,
        geschosse: umfang === 'alles' ? 'alle' : [doc.activeLevelId],
      });

      if (ergebnis.leer) {
        const meldung =
          umfang === 'alles'
            ? 'Nichts zu spiegeln — das Projekt ist leer.'
            : 'Nichts zu spiegeln — in diesem Geschoss steht noch nichts.';
        set({ statusMessage: meldung });
        return { ok: false, message: meldung };
      }

      mutate((d) => {
        d.nodes = ergebnis.nodes;
        d.openings = ergebnis.openings;
        d.fixtures = ergebnis.fixtures;
        d.verticals = ergebnis.verticals;
        d.solids = ergebnis.solids;
        d.durchbrueche = ergebnis.durchbrueche;
        d.pipes = ergebnis.pipes;
        d.pipeAccessories = ergebnis.pipeAccessories;
        d.annotations = ergebnis.annotations;
        d.freihand = ergebnis.freihand;
        d.roofOpenings = ergebnis.roofOpenings;
        d.levels = ergebnis.levels;
        d.site = ergebnis.site;
        d.image = ergebnis.image;
      });

      const wo = umfang === 'alles' ? 'Das Gebäude' : 'Das Geschoss';
      const wie = achse === 'senkrecht' ? 'links/rechts' : 'oben/unten';
      const message =
        `${wo} gespiegelt (${wie}) — ${ergebnis.anzahl} Bauteile, ` +
        `Achse bei ${achse === 'senkrecht' ? 'x' : 'y'} = ` +
        `${ergebnis.lage.toFixed(2).replace('.', ',')} m. ` +
        'Türanschläge und Dachrichtung sind mitgegangen; Strg+Z nimmt es zurück.';
      set({ statusMessage: message });
      return { ok: true, message };
    },

    /**
     * Eine Lücke schließen — als Wand, Tür, Fenster oder Durchgang.
     *
     * Der Reihe nach: Wand von der Lücke zum Gegenüber ziehen (`addWall` bindet
     * beide Enden an und teilt eine getroffene Wand, aus dem optischen wird ein
     * topologischer T-Stoß), dann die Öffnung hineinsetzen. Dicke, Höhe und Art
     * erbt die neue Wand von der, die an der Lücke hängt — eine Außenwand wird
     * mit einer Außenwand geschlossen.
     */
    schliesseLuecke: (knotenId, art) => {
      const doc = get().doc;
      const luecken = findeLuecken(
        Object.values(doc.walls),
        doc.nodes,
        doc.activeLevelId,
      );
      const luecke = luecken.find((l) => l.knotenId === knotenId);
      if (!luecke) return { ok: false, message: 'Zu diesem Wandende ist kein Gegenüber in Reichweite.' };

      const quelle = doc.walls[luecke.wandId];
      if (!quelle) return { ok: false, message: 'Die Wand an der Lücke fehlt.' };

      const wand = get().addWall(luecke.punkt, luecke.ziel, {
        thickness: quelle.thickness,
        height: quelle.height,
        type: quelle.type,
        uValue: quelle.uValue,
        levelId: quelle.levelId,
      });
      if (!wand) return { ok: false, message: 'Die Wand ließ sich nicht setzen.' };

      const weite = luecke.weite;
      if (art === 'wand') {
        const message = `Lücke mit ${weite.toFixed(2).replace('.', ',')} m Wand geschlossen`;
        set({ statusMessage: message });
        return { ok: true, message };
      }

      const masse = oeffnungFuerLuecke(art, weite, quelle.height);
      if (!masse) {
        const message = `Lücke geschlossen — für eine Öffnung ist sie mit ${weite.toFixed(2).replace('.', ',')} m zu schmal`;
        set({ statusMessage: message });
        return { ok: true, message };
      }

      const kind = art === 'tuer' ? 'door' : art === 'fenster' ? 'window' : 'passage';
      const erzeugt = get().addOpening({
        wallId: wand.id,
        kind,
        distance: weite / 2,
        width: masse.width,
        height: masse.height,
        sillHeight: masse.sillHeight,

        uValue: kind === 'window' ? 1.3 : kind === 'door' ? 1.8 : 0,
        gValue: kind === 'window' ? 0.6 : undefined,
        doorType: kind === 'door' ? 'single' : undefined,
        windowType: kind === 'window' ? 'tilt-turn' : undefined,
        passageType: kind === 'passage' ? 'lintel' : undefined,
      });

      const wort = art === 'tuer' ? 'Tür' : art === 'fenster' ? 'Fenster' : 'Durchgang';
      const message = erzeugt
        ? `${wort} ${masse.width.toFixed(2).replace('.', ',')} m in die Lücke gesetzt`
        : `Lücke geschlossen, aber ${wort} passte nicht hinein`;
      set({ statusMessage: message });
      return { ok: true, message };
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
        einpassenZaehler: get().einpassenZaehler + 1,
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
    setzeErzeugerNachVorschlag: () => {
      const doc = get().doc;
      if (hatAusgangspunkt(doc)) {
        return { ok: false, message: 'Es steht bereits ein Erzeuger, Speicher oder Verteiler im Modell.' };
      }
      const vorschlag = schlageErzeugerVor(doc, doc.activeLevelId);
      if (!vorschlag) {
        return { ok: false, message: 'Kein Raum gefunden, der sich als Aufstellort begründen ließe — Erzeuger von Hand setzen.' };
      }
      /*
       * Gesetzt wird auf dem Geschoss des Vorschlags, nicht auf dem aktiven:
       * Der Heizraum liegt unten, gearbeitet wird oft oben. Das aktive
       * Geschoss wandert mit, sonst setzt der Anwender ein Symbol, das er
       * nicht sieht.
       */
      if (vorschlag.levelId !== doc.activeLevelId) get().setActiveLevel(vorschlag.levelId);
      const kessel = get().addFixture('boiler', vorschlag.position, { levelId: vorschlag.levelId });
      if (!kessel) return { ok: false, message: 'Der Erzeuger ließ sich an dieser Stelle nicht setzen.' };
      const message = `Wärmeerzeuger gesetzt: ${vorschlag.ort}. ${vorschlag.grund}`;
      set({ statusMessage: message });
      return { ok: true, message, fixtureId: kessel.id };
    },

    meldeVerworfeneRaeume: (antwort) => {
      const verworfene = leseVerworfene(antwort);
      const { hinweise, ohneRaum } = hinweiseZuRaeumen(verworfene, Object.keys(get().doc.rooms));
      const karte: Record<string, RaumverlustHinweis> = {};
      for (const h of hinweise) karte[h.roomId] = h;
      const message = verworfene.length === 0
        ? 'RaVia hat alle Räume übernommen.'
        : `${verworfene.length} Raum/Räume wurden von RaVia nicht übernommen` +
          `${ohneRaum.length ? ` (${ohneRaum.length} davon ohne passenden Raum im Plan)` : ''}.`;
      set({ verworfeneRaeume: karte, statusMessage: message });
      return { hinweise: hinweise.length, ohneRaum: ohneRaum.length, message };
    },

    loescheVerworfeneHinweise: () => set({ verworfeneRaeume: {} }),

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
            durchbrueche?: Durchbruch[];
            pipes?: PipeRun[];
            annotations?: Annotation[];
            roofOpenings?: RoofOpening[];
            site?: BimDocument['site'];
            freihand?: Freihandstrich[];
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
              /*
               * Ein Dach aus einer Datei kann die Form führen und den Aufbau
               * weglassen — ein Aufmaß hat Neigung und Kniestock, aber keinen
               * U-Wert. Ohne diese Zeile stand im Export `uValue: undefined`
               * am Dach, und auf der Gegenseite ging die Dachfläche stumm mit
               * 0 W/K in die Rechnung. Gefunden im Lauf über die
               * TABULA-Testgebäude (A02, A06).
               */
              ...(l.roof ? { roof: { ...DACH_VORGABE, ...l.roof } } : {}),
              ...(l.roofs ? { roofs: l.roofs.map((r) => ({ ...DACH_VORGABE, ...r })) } : {}),
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
      // Und dasselbe für die Durchbrüche: ohne diese Zeile wäre nach dem
      // Öffnen jede Kernbohrung fort — und niemand vermisst ein Loch, bis der
      // Bohrer angesetzt ist.
      fresh.durchbrueche = Object.fromEntries(
        (geometry.durchbrueche ?? []).map((db) => [
          db.id,
          { ...db, levelId: db.levelId ?? fallbackLevel },
        ]),
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
      /*
       * Grundstück und Handnotizen zurücklesen.
       *
       * Bis 1.18.0 stand hier nichts: `emptyDocument()` legt ein leeres
       * Gelände an, und niemand füllte es wieder. „Exportieren, wieder
       * öffnen" hat damit Grundstücksgrenze, Nachbarbebauung und Wärmepumpe
       * verloren — ohne Meldung, denn geladen wurde ja etwas.
       *
       * Ältere Dateien haben den Block noch nicht. Aus ihnen lassen sich
       * wenigstens die gezeichneten Objekte retten; sie stehen im
       * ausgewerteten Teil unter `heatPump.elements`. Die Wärmepumpen selbst
       * stehen dort als Rechenfall und nicht als Gerät — die kommen nicht
       * zurück, und das sagt die Meldung unten auch.
       */
      let altbestand = false;
      if (geometry.site) {
        fresh.site = {
          ...fresh.site,
          ...geometry.site,
          elements: { ...(geometry.site.elements ?? {}) },
          pumps: { ...(geometry.site.pumps ?? {}) },
        };
      } else {
        const hp = raw.heatPump as { elements?: SiteElement[] } | undefined;
        if (hp?.elements?.length) {
          fresh.site = {
            ...fresh.site,
            elements: Object.fromEntries(hp.elements.map((el) => [el.id, el])),
          };
          altbestand = true;
        }
      }
      if (geometry.freihand?.length) {
        fresh.freihand = Object.fromEntries(
          geometry.freihand.map((f) => [f.id, { ...f, levelId: f.levelId ?? fallbackLevel }]),
        );
      }

      const constructions = raw.constructions as Construction[] | undefined;
      if (constructions?.length) {
        fresh.constructions = Object.fromEntries(constructions.map((c) => [c.id, c]));
      }

      ergaenzeEbenen(fresh);
      recomputeRooms(fresh);

      // Raumbezogene Angaben zuordnen — über den Schwerpunkt, weil sich die
      // Raum-IDs bei der Neuerkennung ändern können.
      const savedRooms = (raw.rooms as Record<string, unknown>[] | undefined) ?? [];
      /*
       * Die Zuordnung läuft **geschossweise** (`ordneRaeumeZu`). Über den
       * bloßen Schwerpunkt gesucht, landeten bei übereinanderliegenden
       * Grundrissen die Angaben des Obergeschosses im Erdgeschoss — siehe
       * `src/lib/raumZuordnung.ts`.
       */
      const treffer = ordneRaeumeZu(savedRooms, Object.values(fresh.rooms), fresh.levels);
      savedRooms.forEach((saved, i) => {
        const match = treffer[i];
        if (!match) return;
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
      });

      set({
        doc: fresh,
        past: [],
        future: [],
        selection: null,
        trace: null,
        // Eine Rückmeldung zum *vorigen* Modell gilt für dieses nicht mehr.
        verworfeneRaeume: {},
        einpassenZaehler: get().einpassenZaehler + 1,
        statusMessage:
          `Projekt geladen: ${Object.keys(fresh.walls).length} Wände, ${Object.keys(fresh.rooms).length} Räume` +
          (altbestand
            ? ' — aus einer älteren Datei: Geländeobjekte sind da, die Wärmepumpe muss neu gesetzt werden.'
            : ''),
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
        einpassenZaehler: get().einpassenZaehler + 1,
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
    // --- Freihand ---------------------------------------------------------

    /**
     * Einen Freihandstrich auswerten.
     *
     * Es entsteht ein **Vorschlag** und kein Modellinhalt. Die Wandstärke
     * kommt aus der Werkzeugleiste, damit der Strich dieselbe Stärke bekommt
     * wie eine von Hand gezogene Wand — wer 24 cm eingestellt hat, meint
     * 24 cm, auch wenn er skizziert.
     *
     * Die Ausrichtung folgt dem **Bestand**, wenn welcher da ist: eine
     * angebaute Wand soll zum Haus passen und nicht zu dem Strich, mit dem
     * sie gerade gezogen wurde.
     */
    skizziere: (punkte) => {
      const st = get();
      const levelId = st.doc.activeLevelId;
      // Ein Vorschlag, der schon steht, wird **fortgeschrieben** und nicht
      // ersetzt — solange er zum selben Geschoss gehört.
      const vorher = st.skizze && st.skizze.levelId === levelId ? st.skizze : null;
      const bestand = Object.values(st.doc.walls).filter((w) => w.levelId === levelId);
      const richtungGrad =
        bestand.length > 0
          ? (vorzugsrichtung(
              bestand
                .map((w) => {
                  const a = st.doc.nodes[w.a];
                  const b = st.doc.nodes[w.b];
                  if (!a || !b) return null;
                  return { dx: b.x - a.x, dy: b.y - a.y, laenge: Math.hypot(b.x - a.x, b.y - a.y) };
                })
                .filter((x): x is { dx: number; dy: number; laenge: number } => x !== null),
            ) *
              180) /
            Math.PI
          : undefined;

      /*
       * Steht schon ein Vorschlag, gilt **seine** Richtung — nicht die des
       * neuen Strichs. Sonst richtete sich die Innenwand nach sich selbst
       * aus, während die Außenwand daneben eine andere Vorzugsrichtung
       * behielt, und die beiden stünden im Plan schief zueinander.
       */
      const richtung = richtungGrad ?? vorher?.drehungGrad;
      const ergebnis = erkenneSkizze(punkte, richtung !== undefined ? { richtungGrad: richtung } : {});
      if (ergebnis.strecken.length === 0) {
        // Ein misslungener Strich nimmt den guten davor **nicht** mit. Wer
        // beim vierten Zug abrutscht, hat sonst die ersten drei verloren.
        const grund = ergebnis.hinweise[0] ?? 'Aus dem Strich ließ sich keine Wand lesen.';
        const zusatz = vorher ? ' Der bisherige Vorschlag bleibt stehen.' : '';
        if (!vorher) set({ skizze: null });
        get().setStatus(grund + zusatz);
        return { ok: false, message: grund + zusatz };
      }

      // Hinweise zusammenführen, ohne sie zu wiederholen: „2 sehr kurze
      // Stücke …" dreimal untereinander sagt nicht mehr als einmal.
      const hinweise = [...new Set([...(vorher?.hinweise ?? []), ...ergebnis.hinweise])];
      const strecken = [...(vorher?.strecken ?? []), ...ergebnis.strecken];
      const zuege = [
        ...(vorher?.zuege ?? []),
        { strich: [...punkte], anzahl: ergebnis.strecken.length, ring: ergebnis.ring },
      ];

      set({
        skizze: {
          strecken,
          zuege,
          levelId,
          ring: (vorher?.ring ?? false) || ergebnis.ring,
          drehungGrad: vorher?.drehungGrad ?? ergebnis.drehungGrad,
          hinweise,
          // Stärke und Art bleiben, was der Anwender am Vorschlag eingestellt
          // hat — sonst setzte jeder neue Zug seine Wahl zurück.
          staerke: vorher?.staerke ?? st.wallDefaults.thickness,
          art: vorher?.art ?? st.wallDefaults.type,
        },
      });
      const message =
        `${strecken.length} Wände erkannt` +
        (zuege.length > 1 ? ` aus ${zuege.length} Zügen` : '') +
        (ergebnis.ring ? ', geschlossener Umriss' : '') +
        ' — noch nicht übernommen';
      get().setStatus(message);
      return { ok: true, message };
    },

    /**
     * Den zuletzt gezogenen Strich aus dem Vorschlag nehmen.
     *
     * Der Gegenzug zum Sammeln: Wer vier Züge gezeichnet hat und mit dem
     * vierten unzufrieden ist, soll nicht alles verwerfen müssen.
     */
    nimmZugZurueck: () => {
      const v = get().skizze;
      if (!v || v.zuege.length === 0) return;
      if (v.zuege.length === 1) {
        set({ skizze: null });
        get().setStatus('Skizze verworfen.');
        return;
      }
      const letzter = v.zuege[v.zuege.length - 1];
      const zuege = v.zuege.slice(0, -1);
      const strecken = v.strecken.slice(0, v.strecken.length - letzter.anzahl);
      set({
        skizze: { ...v, zuege, strecken, ring: zuege.some((z) => z.ring) },
      });
      get().setStatus(`Letzter Zug zurückgenommen — ${strecken.length} Wände bleiben im Vorschlag.`);
    },

    /**
     * Die vorgeschlagenen Wände anlegen.
     *
     * **Ein** Schritt in der Rückgängig-Kette, nicht einer je Wand: Wer eine
     * Skizze übernimmt und es sich anders überlegt, will die Skizze zurück
     * und nicht sechsmal Strg+Z drücken.
     *
     * Angeschlossen wird an den Bestand: Endpunkte, die nah genug an einem
     * vorhandenen Knoten liegen, bekommen diesen Knoten. Sonst stünde die
     * skizzierte Wand neben der gezeichneten statt an ihr, und die
     * Raumerkennung fände keinen geschlossenen Umriss.
     */
    uebernimmSkizze: () => {
      const vorschlag = get().skizze;
      if (!vorschlag || vorschlag.strecken.length === 0) {
        return { ok: false, message: 'Es liegt keine Skizze vor.' };
      }
      let angelegt = 0;
      mutate((doc) => {
        const level = doc.levels[doc.activeLevelId];
        for (const strecke of vorschlag.strecken) {
          // 12 cm: großzügiger als beim Bildimport (8 cm), weil eine
          // Handskizze gröber ist als eine erkannte Linie — aber enger als
          // die halbe kleinste Wand, damit nichts zusammenfällt, was
          // getrennt gemeint war.
          const a = nodeAt(doc, strecke.a, 0.12);
          const b = nodeAt(doc, strecke.b, 0.12);
          if (a.id === b.id) continue;
          const gibtEs = Object.values(doc.walls).some(
            (w) => (w.a === a.id && w.b === b.id) || (w.a === b.id && w.b === a.id),
          );
          if (gibtEs) continue;
          const wall: Wall = {
            id: uid('w'),
            levelId: doc.activeLevelId,
            a: a.id,
            b: b.id,
            thickness: vorschlag.staerke,
            height: level?.height ?? 2.75,
            type: vorschlag.art,
            layerId: 'layer-walls',
            uValue: vorschlag.art === 'exterior' ? 0.24 : 1.2,
          };
          doc.walls[wall.id] = wall;
          angelegt += 1;
        }
      });
      set({ skizze: null });
      const message =
        angelegt === vorschlag.strecken.length
          ? `${angelegt} Wände aus der Skizze übernommen.`
          : `${angelegt} von ${vorschlag.strecken.length} Wänden übernommen — die übrigen gab es schon.`;
      get().setStatus(message);
      return { ok: true, message };
    },

    verwirfSkizze: () => {
      set({ skizze: null });
      get().setStatus('Skizze verworfen.');
    },

    setzeSkizzenwand: (patch) => {
      const s2 = get().skizze;
      if (s2) set({ skizze: { ...s2, ...patch } });
    },

    /**
     * Eine Freihandnotiz ablegen.
     *
     * Sie geht ins Dokument und damit in die Projektdatei — eine Notiz, die
     * beim Speichern verschwindet, schreibt niemand ein zweites Mal. Sie geht
     * **nicht** in Massenauszug, Heizlast oder Export: sie ist eine
     * Randbemerkung und keine Geometrie.
     */
    notiere: (punkte, druck) => {
      if (punkte.length < 2) return;
      mutate((doc) => {
        const strich: Freihandstrich = {
          id: uid('fh'),
          levelId: doc.activeLevelId,
          punkte: punkte.map((p) => ({ x: p.x, y: p.y })),
          ...(druck && druck.length === punkte.length ? { druck: [...druck] } : {}),
          createdAt: new Date().toISOString(),
        };
        doc.freihand = { ...(doc.freihand ?? {}), [strich.id]: strich };
      });
    },

    loescheNotiz: (id) => {
      mutate((doc) => {
        if (!doc.freihand?.[id]) return;
        const rest = { ...doc.freihand };
        delete rest[id];
        doc.freihand = rest;
      });
    },

    loescheNotizen: () => {
      const aktiv = get().doc.activeLevelId;
      let weg = 0;
      mutate((doc) => {
        const rest: Record<string, Freihandstrich> = {};
        for (const [id, f] of Object.entries(doc.freihand ?? {})) {
          if (f.levelId === aktiv) weg += 1;
          else rest[id] = f;
        }
        doc.freihand = rest;
      });
      get().setStatus(weg > 0 ? `${weg} Notizen gelöscht.` : 'Keine Notizen in diesem Geschoss.');
    },

    radiere: (bahn) => {
      if (bahn.length === 0) return;
      const doc0 = get().doc;
      const treffer = getroffene(doc0.freihand ?? {}, bahn, doc0.activeLevelId);
      if (treffer.length === 0) {
        // Kein Treffer ist kein Fehler — aber auch kein Schritt in der
        // Historie. Wer daneben radiert, soll mit „Rückgängig" nicht ins
        // Leere greifen.
        get().setStatus('Nichts getroffen.');
        return;
      }
      mutate((doc) => {
        const rest = { ...(doc.freihand ?? {}) };
        for (const id of treffer) delete rest[id];
        doc.freihand = rest;
      });
      get().setStatus(treffer.length === 1 ? 'Notiz radiert.' : `${treffer.length} Notizen radiert.`);
    },

    setzeRadiergummi: (an) => set({ radiergummi: an }),

    setzeNotizenSichtbar: (sichtbar) => set({ notizenSichtbar: sichtbar }),

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
      const lief = gestureActive;
      gestureActive = false;
      gestureRecorded = false;
      /*
       * Einmal vollständig nachrechnen.
       *
       * Während des Zuges lief die Raumerkennung nur über das sichtbare
       * Geschoss. Das ist richtig, solange gezogen wird — aber nur solange:
       * Eine Wand, die zwei Geschosse begrenzt (ein Luftraum über dem
       * Wohnzimmer), oder ein verschobener Schacht wirkt nach oben, und
       * dieser Anteil muss nach dem Loslassen stimmen. Ohne diesen Durchlauf
       * bliebe die Abweichung bis zur nächsten beliebigen Änderung stehen —
       * und niemand sähe sie.
       *
       * Ohne Geste passiert nichts: `endGesture` wird auch dann gerufen,
       * wenn gar nicht gezogen wurde.
       */
      if (!lief) return;
      const doc = cloneDoc(get().doc);
      recomputeRooms(doc);
      // Kein Historieneintrag: Die Geste hat ihren schon.
      set({ doc });
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
