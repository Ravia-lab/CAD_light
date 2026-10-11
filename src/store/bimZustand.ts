/**
 * Grundlagen des Stores `useBimStore`: Zustandstyp, Vorgaben und Helfer.
 *
 * TD-22: Aus `useBimStore.ts` herausgelöst, damit die Slices unter
 * `slices/` sie importieren können, ohne den Store selbst zu laden (sonst
 * entstünde ein Laufzeit-Zyklus Store → Slice → Store). Inhalt unverändert;
 * vorher modul-private Namen sind jetzt exportiert.
 */

import type {
  AnlagenAntworten,
  RatedPowerSource,
  AiAnalysisState,
  AuswahlQuelle,
  BimDocument,
  BimNode,
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
  SolidKind,
  VerticalElement,
  VerticalKind,
  Construction,
  Fixture,
  FixtureType,
  OpeningTypePreset,
  Selection,
  SnapSettings,
  ToolId,
  SkizzenVorschlag,
  Vec2,
  ViewMode,
  CameraMode,
  Viewport,
  Wall,
  WallType,
} from '../types/bim';
import {
  DACH_VORGABE,
  DEFAULT_CONSTRUCTIONS,
} from '../types/bim';
import type { StoreApi } from 'zustand';

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
export const DEFAULT_ROOF: RoofDefinition = DACH_VORGABE;
import {
  type Massstab,
  type StiftfarbeId,
} from '../lib/skizzenseite';
import { pointInPolygon } from '../lib/geometry';
import { type RaumverlustHinweis } from '../lib/verworfeneRaeume';
import {
  DEFAULT_EDGE_CLEARANCE,
  DEFAULT_LOOP_PATTERN,
  DEFAULT_OBSTACLE_CLEARANCE,
  FLOOR_OBSTACLE_TYPES,
  fixtureFootprint,
  measureLayableArea,
} from '../lib/floorLoopLayout';
import { EBENEN_KATALOG, type Gewerkesatz } from '../lib/ebenen';
import { type Loeschposten } from '../lib/planLeeren';
import type { UiModus } from '../lib/uimodus';
import { belagsWiderstand } from '../lib/bodenbelag';
import { designFloorHeating } from '../lib/hydraulics';
import { estimateHeatLoad } from '../lib/heatLoadEstimate';
import { solidFootprint } from '../lib/verticalSymbols';
import { type GebaeudeNetzErgebnis } from '../lib/gebaeudeNetz';
import type { Objektaufnahme } from '../lib/objektaufnahme';
import { type EinheitArt } from '../lib/nutzungseinheiten';
import type { RaumplanImportErgebnis } from '../lib/raumplanImport';
import { type BuildingImportErgebnis } from '../lib/buildingModelImport';
import { benenneRaeume, uebernimmBeheizung } from '../lib/scanUebernahme';
import { hoehenbefund } from '../lib/wandhoehen';
import { SPRACHEN, spracheSetzen, type Sprache } from '../lib/sprache';
import type { SpiegelAchse } from '../lib/spiegeln';
import type { BegradigenOptionen } from '../lib/begradigen';
import type { KorrekturAuswahl, KorrekturBericht, Korrekturplan } from '../lib/autokorrektur';
import type { LueckenSchluss } from '../lib/luecken';
import { benenneGeschosse, erdgeschossIndex } from '../lib/levelGeometry';
import { emptyPlant, emptySite } from '../lib/plantDefaults';
import type { HostPatch, HostPatchReport } from '../lib/hostPatch';
import {
  type RoomTemplateKind,
  type TemplateOptions,
} from '../lib/roomTemplates';
import {
  massiveInRoom,
  recomputeRooms,
} from '../lib/dokumentPflege';

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

export const DEFAULT_LEVEL: Level = {
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
export const POLYGON_KINDS = new Set<SiteElementKind>(['boundary', 'collector', 'neighbour-building', 'paved']);
export const LINE_KINDS = new Set<SiteElementKind>(['trench', 'utility-line']);

/** Vorbelegung je Art — die Werte, die in der Praxis am häufigsten stimmen. */
export const SITE_DEFAULTS: Partial<Record<SiteElementKind, Partial<SiteElement>>> = {
  borehole: { depth: 100, label: 'Erdwärmesonde' },
  collector: { depth: 1.4, pipeSpacing: 0.6, label: 'Flächenkollektor' },
  trench: { depth: 1.5, label: 'Grabenkollektor' },
  'well-supply': { depth: 15, label: 'Förderbrunnen' },
  'well-injection': { depth: 15, label: 'Schluckbrunnen' },
  'hazard-opening': { radius: 0.4, label: 'Lichtschacht' },
  ignition: { ignition: 'socket', label: 'Steckdose' },
  tree: { radius: 3, label: 'Baum' },
  'neighbour-building': { height: 7, label: 'Nachbargebäude' },
  'immission-point': { label: 'Immissionsort' },
  'utility-line': { depth: 1, utility: 'water', label: 'Leitung' },
};

export function emptyDocument(): BimDocument {
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
      // θ_u bleibt leer: dann gilt θ_i − b_u · (θ_i − θ_e), siehe lib/unbeheizt.ts (Befund B1).
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

export const DEFAULT_SNAP: SnapSettings = {
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

export interface BimState {
  doc: BimDocument;
  past: BimDocument[];
  future: BimDocument[];

  tool: ToolId;
  viewMode: ViewMode;
  /**
   * Prüfansicht statt Zeichenoberfläche (seit 1.70.0).
   *
   * Nach einem Gebäudescan auf dem **Telefon** zeigt CAD Light zuerst, was
   * angekommen ist — 3D, Grundriss, Prüfliste — und nicht die Werkzeuge. Am
   * Telefon prüft man einen Scan, man zeichnet ihn nicht nach; Bearbeiten
   * gibt es auf Wunsch. Liegt im Store und nicht in der Komponente, damit
   * das Drehen des Geräts (neues Layout) den Zustand nicht verliert.
   */
  pruefansicht: boolean;
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
  /**
   * Der Stand der Freihanderkennung. `null`, solange nichts skizziert wurde.
   *
   * Er liegt **neben** dem Dokument und nicht darin: ein Vorschlag ist kein
   * Modellinhalt, gehört nicht in die Projektdatei und nicht in die
   * Rückgängig-Kette. In die Kette kommt genau ein Schritt — das Übernehmen.
   */
  skizze: SkizzenVorschlag | null;
  /**
   * Läuft gerade die Aufnahme Zimmer für Zimmer?
   *
   * Reiner Oberflächenzustand — der Assistent hält **keine** eigenen Daten.
   * Was er erfragt, steht nach jeder Antwort im Dokument; fällt er weg,
   * bleibt alles stehen. Deshalb darf er auch mitten im Satz abgebrochen
   * werden, ohne dass etwas verlorengeht.
   */
  assistent: boolean;
  /**
   * Vollbild zum Skizzieren — ohne Leisten, mit zeichnendem Finger.
   *
   * **Warum ein eigener Zustand und nicht nur ein Werkzeug.** Auf dem Plan
   * ist ein Finger zweideutig: Er muss auch schieben können. Auf einem Blatt,
   * das nichts anderes zulässt, ist er es nicht — und genau deshalb darf er
   * dort zeichnen. Der Zustand merkt sich, was vorher galt, und stellt es
   * beim Verlassen wieder her.
   */
  vollbildSkizze: boolean;
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
  setPruefansicht: (an: boolean) => void;
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
  setzeRaumHeizleistung: (
    roomId: string,
    watt: number | undefined,
    quelle?: RatedPowerSource,
  ) => { ok: boolean; message: string };
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
  /**
   * Eine Angabe des Objektaufnahmebogens setzen.
   *
   * Nur die Felder, die im Modell keinen anderen Platz haben — alles andere
   * liest der Bogen aus Modell, Projekt und Anlagenblatt. Siehe
   * `lib/objektaufnahme.ts`.
   */
  setzeAufnahme: (patch: Partial<Objektaufnahme>) => void;
  /** Die Ansicht auf den Inhalt einpassen — zählt den Einpassen-Zähler hoch. */
  passeEin: () => void;
  // --- Skizzenseiten ------------------------------------------------------
  /** Gerade bearbeitetes Blatt; ohne Angabe das erste. */
  aktivesBlatt?: string;
  waehleBlatt: (id: string) => void;
  /** Ein neues leeres Blatt anlegen und zum aktiven machen. */
  neuesBlatt: () => string;
  /**
   * Dafür sorgen, dass **ein** Blatt da ist — und nur dann eines anlegen.
   *
   * Die Oberfläche legt beim Aufschlagen der Seite ein Blatt an, damit niemand
   * erst eines anlegen muss, bevor er zeichnen kann. Ein Aufruf beim Einhängen
   * der Ansicht läuft aber zweimal (React ruft Effekte in der Entwicklung
   * doppelt auf, und ein Wiedereinhängen gibt es auch im Betrieb) — und zwei
   * leere Blätter beim Aufschlagen sind ein sichtbarer Fehler. Diese Aktion
   * ist deshalb mehrfach aufrufbar, ohne mehrfach zu wirken.
   */
  sorgeFuerBlatt: () => string;
  loescheBlatt: (id: string) => void;
  benenneBlatt: (id: string, name: string) => void;
  /**
   * Den Maßstab eines Blattes setzen — zwei Punkte darauf und ihre wirkliche
   * Länge. `undefined` als Länge nimmt ihn wieder weg.
   */
  setzeBlattMassstab: (id: string, massstab: Massstab | undefined) => void;
  /**
   * **Das Blatt in den Grundriss übernehmen.**
   *
   * Gemeldet wurde: „bei skizze wird nur skizziert, hier sollte dann auch die
   * funktion der räume also wände erzeugen und dergleichen gegeben sein das man
   * es übertragen kann". Und so war es: Ein leeres Blatt ist die
   * naheliegendste Fläche, um eine Wohnung aufzuzeichnen — und danach war der
   * Strich ein Bild und kein Modell.
   *
   * Was hier passiert, ist deshalb **kein neuer Erkennungsweg**, sondern der
   * vorhandene: Die Striche werden mit dem Maßstab des Blattes in Meter
   * gerechnet und durch dieselbe Erkennung geschickt wie das Skizzenblatt über
   * dem Plan (`skizziere`). Es entsteht derselbe **Vorschlag** in Magenta, mit
   * derselben Leiste zum Prüfen, Verwerfen einzelner Vektoren und Übernehmen.
   * Eine zweite Erkennung mit eigenen Schwellen wäre ein zweites Verhalten für
   * dieselbe Sache.
   *
   * **Das Blatt bleibt, wie es ist.** Übernehmen verbraucht es nicht; es ist
   * Papier und bleibt Papier. Wer zweimal übernimmt, bekommt zweimal einen
   * Vorschlag — und sieht beim zweiten Mal, dass er schon einen hat.
   */
  uebertrageBlatt: (
    id: string,
    optionen?: { nurSchwarz?: boolean },
  ) => { ok: boolean; message: string; zuege: number };
  /** Einen fertigen Zug auf das Blatt legen — Punkte in Blattkoordinaten [mm]. */
  zeichneAufBlatt: (id: string, punkte: Vec2[], farbe: StiftfarbeId, staerke: number) => void;
  /** Den letzten Zug zurücknehmen. */
  nimmBlattstrichZurueck: (id: string) => void;
  /** Das Blatt leeren — die Seite bleibt. */
  leereBlatt: (id: string) => void;
  // --- Nutzungseinheiten --------------------------------------------------
  /**
   * Eine Nutzungseinheit anlegen — Wohnung, Gewerbeeinheit oder
   * Gemeinschaftsfläche. Der Name wird fortlaufend vorgeschlagen.
   */
  neueEinheit: (art?: EinheitArt, name?: string) => string;
  benenneEinheit: (id: string, name: string) => void;
  setzeEinheitArt: (id: string, art: EinheitArt) => void;
  /**
   * Eine Einheit entfernen — und die Zuordnung an ihren Räumen mit ihr.
   *
   * Eine Kennung an einem Raum, zu der es keine Einheit mehr gibt, wäre der
   * stillste denkbare Fehler: Der Raum sieht zugeordnet aus, zählt aber
   * nirgends mit.
   */
  loescheEinheit: (id: string) => void;
  /** Einen Raum einer Einheit zuordnen; `undefined` hebt die Zuordnung auf. */
  ordneRaumEinheitZu: (roomId: string, einheitId?: string) => void;
  /**
   * Alle Räume eines Geschosses einer Einheit zuordnen.
   *
   * Der Regelfall im Mehrfamilienhaus: ein Geschoss, eine Wohnung. Räume, die
   * schon einer **anderen** Einheit gehören, bleiben unberührt — wer eine
   * Maisonette zugeordnet hat, verliert sie nicht beim Zuordnen des Geschosses
   * darunter.
   */
  ordneGeschossEinheitZu: (levelId: string, einheitId: string) => number;
  /** Die getippte Zahl der Wohneinheiten aus dem Modell nachziehen. */
  uebernehmeEinheitenzahl: () => { gezaehlt: number; message: string };
  /** Die Aufnahme Zimmer für Zimmer öffnen oder schließen. */
  setzeAssistent: (offen: boolean) => void;
  /** Das Skizzen-Vollbild öffnen oder schließen; stellt den Finger-Zustand wieder her. */
  setzeVollbildSkizze: (offen: boolean) => void;
  /** Eine angenommene Angabe vermerken — dieselbe Angabe ersetzt den Eintrag. */
  vermerkeAnnahme: (was: string, wert: string, grund: string) => void;
  /** Den Vermerk wieder entfernen, weil die Angabe doch gemacht wurde. */
  entferneAnnahme: (was: string) => void;
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
  /**
   * Das Rohrnetz des **Gebäudes** auslegen — und auf Wunsch die
   * Flächenheizung gleich mit.
   *
   * `flaechenheizung` steuert den zweiten Teil und steht ausdrücklich **nicht**
   * an der Verlegeart: Eine Fußbodenheizung wird auch im Bestand gelegt — bei
   * neuem Estrich, in Niedrigaufbauweise, im angebauten Bad —, und gemischte
   * Systeme sind der Normalfall und nicht die Ausnahme. Die Verlegeart sagt,
   * **wie die Verteilleitung läuft** (Fußbodenaufbau oder Sockelleistenkanal),
   * nicht, welche Heizfläche im Raum liegt. Vorgabe ist `true`; belegt werden
   * nur Räume **ohne** Heizfläche, womit gemischte Systeme von selbst
   * entstehen.
   */
  legeRohrnetzAus: (
    mode: PipeRoutingMode,
    anordnung?: 'baum' | 'ring',
    optionen?: { flaechenheizung?: boolean },
  ) => GebaeudeNetzErgebnis;
  /**
   * **Der abgeschlossene Auslegungsstand** — gesetzt von `legeRohrnetzAus`,
   * sonst von niemandem.
   *
   * Warum es das gibt: Die Einbettung meldet bisher jede Änderung am Modell
   * (`onChange`, entprellt). Für den hydraulischen Abgleich ist das zu viel.
   * Die RaVia-Seite hat es am 01.10.2026 so beschrieben: „Unser hydraulischer
   * Abgleich soll nicht auf jede Zwischenänderung neu rechnen, sondern erst
   * auf einen abgeschlossenen Auslegungsstand." Genau dieser Zeitpunkt ist
   * hier festgehalten — eine gezogene Wand ändert ihn nicht, ein neu gelegtes
   * Rohrnetz schon.
   *
   * `undefined` heißt: In dieser Sitzung wurde nicht ausgelegt. Das ist etwas
   * anderes als „es gibt kein Rohrnetz" — ein geöffnetes Projekt bringt sein
   * gezeichnetes Netz mit, ohne dass hier jemand ausgelegt hätte.
   */
  netzStand?: {
    /** Fortlaufend, damit ein Hörer zwei gleiche Stände unterscheiden kann. */
    lauf: number;
    at: string;
    mode: PipeRoutingMode;
    anordnung: 'baum' | 'ring';
    /** Mit Flächenheizung ausgelegt? */
    flaechenheizung: boolean;
    served: number;
    routeLength: number;
    pipeLength: number;
    accessories: number;
    durchbrueche: number;
    geschosse: number;
    straenge: number;
    /** Räume, in denen dabei Flächenheizung gelegt wurde. */
    flaechenraeume: number;
    /** Schwerster Befund der Auslegung, falls einer vorliegt. */
    fehler?: string;
  };
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
   * Die sieben Antworten im Anlagenblatt setzen — und die Anlage daraus bauen.
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
   * Grundriss prüfen — alles suchen, nichts ändern. Siehe `lib/autokorrektur.ts`.
   */
  planeAutokorrektur: () => Korrekturplan;
  /**
   * Die angehakten Korrekturen ausführen, als **ein** Schritt in der
   * Historie: Strg+Z nimmt alles zusammen zurück.
   */
  autokorrigiere: (auswahl: KorrekturAuswahl) => { ok: boolean; message: string; bericht: KorrekturBericht };
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
//
// IDs, Klonen, Knoten-/Wandpflege und Raumerkennung stehen seit TD-22 in
// `lib/dokumentPflege.ts`; hier bleibt, was den Store-Zustand braucht.

/**
 * Aus einem Scan-Ergebnis (RoomPlan-Datei oder RaVia Building Model) ein
 * neues Dokument bauen: Geschosse benennen und ordnen, Nordrichtung, Wände,
 * Räume erkennen, Raumnutzung übernehmen. `vorRaeumen` darf das Dokument
 * ergänzen, bevor die Raumerkennung läuft (Dächer, Heizkörper) — so bekommen
 * auch diese Objekte ihren Raumbezug aus derselben Erkennung.
 */
export function dokumentAusScan(
  ergebnis: RaumplanImportErgebnis,
  vorRaeumen?: (doc: BimDocument) => void,
): { fresh: BimDocument; benannt: number; doppelt: number; bereiche: string[] } {
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
  const { benannt, doppelt, bereiche } = benenneRaeume(fresh, ergebnis.raumHinweise);
  // K2: beheizt oder nicht kommt aus dem Scan (Festlegung F4).
  if ('raumBeheizung' in ergebnis) uebernimmBeheizung(fresh, (ergebnis as BuildingImportErgebnis).raumBeheizung);
  return { fresh, benannt, doppelt, bereiche };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export function belegeRaum(get: () => BimState, roomId: string): FloorLoopBatchResult | null {
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
    /*
     * **Das Geschoss kommt vom Raum, nicht vom Bildschirm.** `addFixture`
     * setzt sonst das aktive Geschoss — solange dieser Weg nur über die
     * TGA-Palette lief, war das dasselbe. Seit die Trassenauslegung das
     * **ganze Gebäude** belegt, ist es das nicht mehr: Die Kreise des
     * Obergeschosses lägen im Erdgeschoss, und im Plan sähe man es nicht.
     * Dieselbe Falle wie bei den Raumangaben in 1.42.0.
     */
    levelId: room.levelId,
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

/** Wo die Sprachwahl im Browser liegt. */
export const SPRACH_SCHLUESSEL = 'ravia-cad-light.sprache.v1';

/**
 * Merker für das einmalige Zurücksetzen nach dem Anzeigefehler in 1.36.0.
 * Siehe `geladeneSprache`.
 */
export const SPRACH_ENTSPERRT = 'ravia-cad-light.sprache.entsperrt.v1';

/**
 * Die gemerkte Sprache beim Start — und sie wird sofort gesetzt.
 *
 * `spracheSetzen` hier und nicht erst im ersten Bauteil: `t()` wird schon
 * beim Aufbau des Speichers aufgerufen (Beschriftungstabellen,
 * Vorgabetexte). Käme die Sprache erst danach, stünde der erste Bildaufbau
 * auf Deutsch und der zweite nicht — ein Flackern, für das niemand eine
 * Erklärung hätte.
 */
export function geladeneSprache(): Sprache {
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

// ---------------------------------------------------------------------------
// Bausteine der Slices (TD-22)
// ---------------------------------------------------------------------------

/** `set` des Stores, wie Zustand es an `create` übergibt. */
export type StoreSet = StoreApi<BimState>['setState'];
/** `get` des Stores. */
export type StoreGet = () => BimState;
/** Dokumentmutation mit Historie, siehe `mutate` in `useBimStore.ts`. */
export type Mutate = (
  fn: (doc: BimDocument) => void,
  options?: { skipRooms?: boolean; ziehenachHeizflaechen?: boolean },
) => void;
