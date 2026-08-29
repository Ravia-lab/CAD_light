/**
 * RaVia CAD Light — BIM-Datenmodell
 * ---------------------------------------------------------------------------
 * Einheiten-Konvention (projektweit verbindlich):
 *   • Längen / Höhen / Dicken : Meter [m]
 *   • Flächen                 : Quadratmeter [m²]
 *   • Volumina                : Kubikmeter [m³]
 *   • Winkel                  : Grad [°], mathematisch positiv (CCW)
 *   • U-Werte                 : W/(m²·K)
 *
 * Koordinatensystem (Modellraum, "Weltkoordinaten"):
 *   +x → Osten, +y → Norden. Das ist ein rechtshändiges 2D-System.
 *   Der Canvas spiegelt y beim Rendern (Screen-y zeigt nach unten) — der
 *   Modellraum bleibt davon unberührt. Das ist wichtig, damit Himmels-
 *   richtungen (N/O/S/W) für die Heizlast korrekt exportiert werden.
 *
 * Datenhaltung: bewusst "flach" und normalisiert (Entity-Maps statt
 * verschachtelter Bäume). Das hält Updates O(1), vermeidet tiefe Klone im
 * Store und macht strukturelles Sharing für React-Renderer trivial.
 */

// ===========================================================================
// Identifikatoren & Primitiven
// ===========================================================================

export type NodeId = string;
export type WallId = string;
export type OpeningId = string;
export type RoomId = string;
export type LevelId = string;
export type LayerId = string;

/** Punkt im Modellraum (Meter). */
export interface Vec2 {
  x: number;
  y: number;
}

/** Achsparalleles Rechteck im Modellraum. */
export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Himmelsrichtung einer Bauteil-Außenfläche (DIN EN 12831 Orientierung). */
export type Orientation = 'N' | 'NO' | 'O' | 'SO' | 'S' | 'SW' | 'W' | 'NW';

/**
 * Randbedingung eines Hüllbauteils — der entscheidende Parameter der
 * Transmissionsrechnung. Aus ihr folgt der Temperatur-Korrekturfaktor:
 *
 *   `exterior`      f = 1                       (direkt gegen Außenluft)
 *   `ground`        f_g über B' und U_equiv     (gegen Erdreich)
 *   `unheated`      f_u aus θ_u                 (gegen unbeheizten Bereich)
 *   `adjacent-room` f_ij = (θ_i − θ_j)/(θ_i − θ_e)
 *   `adiabatic`     f = 0                       (gegen gleich temperierten Bereich)
 */
export type BoundaryCondition =
  | 'exterior'
  | 'ground'
  | 'unheated'
  | 'adjacent-room'
  | 'adiabatic';

export const BOUNDARY_LABELS: Record<BoundaryCondition, string> = {
  exterior: 'Außenluft',
  ground: 'Erdreich',
  unheated: 'Unbeheizt',
  'adjacent-room': 'Nachbarraum',
  adiabatic: 'Adiabat',
};

// ===========================================================================
// Bauteilkatalog
// ===========================================================================

export type ConstructionCategory = 'wall' | 'floor' | 'ceiling' | 'roof' | 'window' | 'door';

/**
 * Ein benannter Bauteilaufbau. Der Katalog löst das Problem, dass U-Werte
 * sonst an jedem einzelnen Bauteil hängen: ändert sich der Aufbau, ändern
 * sich alle zugewiesenen Bauteile mit — und der Export trägt den Namen des
 * Aufbaus mit, sodass in RaVia nachvollziehbar bleibt, *warum* dort 0,21 steht.
 */
export interface Construction {
  id: string;
  name: string;
  category: ConstructionCategory;
  /** U-Wert [W/(m²·K)]. */
  uValue: number;
  /** Gesamtdicke [m] — bei Wänden zugleich Vorgabe für die Wandstärke. */
  thickness?: number;
  /** Schichtenbeschreibung als Freitext, z. B. „24 MW + 14 WDVS". */
  layers?: string;
  /** Wärmebrückenzuschlag ΔU_WB [W/(m²·K)] speziell für diesen Aufbau. */
  thermalBridgeSupplement?: number;
  /** Gesamtenergiedurchlassgrad g [-] bei transparenten Bauteilen. */
  gValue?: number;
}

/** Startkatalog mit gängigen Aufbauten — im Projekt frei erweiterbar. */
export const DEFAULT_CONSTRUCTIONS: Construction[] = [
  { id: 'c-aw-wdvs', name: 'AW 36,5 + WDVS 14', category: 'wall', uValue: 0.21, thickness: 0.365, layers: '36,5 Ziegel + 14 cm WDVS' },
  { id: 'c-aw-monolith', name: 'AW 42,5 monolithisch', category: 'wall', uValue: 0.24, thickness: 0.425, layers: '42,5 Wärmedämmziegel' },
  { id: 'c-aw-bestand', name: 'AW 36,5 Bestand ungedämmt', category: 'wall', uValue: 1.4, thickness: 0.365, layers: '36,5 Vollziegel' },
  { id: 'c-iw-24', name: 'IW 24 tragend', category: 'wall', uValue: 1.2, thickness: 0.24, layers: '24 Kalksandstein' },
  { id: 'c-iw-115', name: 'IW 11,5 nicht tragend', category: 'wall', uValue: 1.6, thickness: 0.115, layers: '11,5 Kalksandstein' },
  { id: 'c-iw-175', name: 'IW 17,5 tragend', category: 'wall', uValue: 1.4, thickness: 0.175, layers: '17,5 Kalksandstein' },
  { id: 'c-bo-erdreich', name: 'Bodenplatte gedämmt', category: 'floor', uValue: 0.28, thickness: 0.35, layers: '25 Beton + 10 XPS' },
  { id: 'c-bo-decke', name: 'Geschossdecke', category: 'floor', uValue: 0.9, thickness: 0.28, layers: '20 STB + Estrich' },
  { id: 'c-de-dach', name: 'Dachdecke gedämmt', category: 'ceiling', uValue: 0.18, thickness: 0.4, layers: '20 STB + 24 MW' },
  { id: 'c-de-innen', name: 'Decke zu beheizt', category: 'ceiling', uValue: 0.9, thickness: 0.28, layers: '20 STB + Estrich' },
  { id: 'c-fe-3fach', name: 'Fenster 3-fach', category: 'window', uValue: 0.9, gValue: 0.55 },
  { id: 'c-fe-2fach', name: 'Fenster 2-fach', category: 'window', uValue: 1.3, gValue: 0.62 },
  { id: 'c-fe-bestand', name: 'Fenster Bestand', category: 'window', uValue: 2.7, gValue: 0.7 },
  { id: 'c-tu-innen', name: 'Innentür', category: 'door', uValue: 1.8 },
  { id: 'c-tu-haus', name: 'Haustür gedämmt', category: 'door', uValue: 1.2 },
];

// ===========================================================================
// Knoten (Wandachsen-Endpunkte)
// ===========================================================================

/**
 * Ein Knoten ist der geteilte Endpunkt beliebig vieler Wandachsen.
 * Wände referenzieren Knoten — dadurch wandern beim Verschieben eines
 * Knotens alle angeschlossenen Wände automatisch mit (parametrisches Verhalten).
 */
export interface BimNode extends Vec2 {
  id: NodeId;
  /** Vom Nutzer fixiert: Snapping/Auto-Merge lässt diesen Knoten in Ruhe. */
  locked?: boolean;
  /** Geschoss, zu dem der Knoten gehört. */
  levelId: LevelId;
}

// ===========================================================================
// Wände
// ===========================================================================

/** Gebräuchliche Wandstärken (DIN-Mauerwerksmaße) in Metern. */
export const WALL_THICKNESS_PRESETS = [0.115, 0.175, 0.24, 0.365, 0.425] as const;
export type WallThicknessPreset = (typeof WALL_THICKNESS_PRESETS)[number];

export type WallType = 'exterior' | 'interior' | 'partition' | 'shaft';

export interface Wall {
  id: WallId;
  /** Geschoss, in dem die Wand steht. */
  levelId: LevelId;
  /** Zugewiesener Bauteilaufbau aus dem Katalog. Setzt U-Wert und Dicke. */
  constructionId?: string;
  /** Startknoten der Wandachse. */
  a: NodeId;
  /** Endknoten der Wandachse. */
  b: NodeId;
  /** Wandstärke [m], symmetrisch um die Achse aufgetragen. */
  thickness: number;
  /** Lichte Wandhöhe [m] (OK Rohdecke − OK Rohboden). */
  height: number;
  type: WallType;
  layerId: LayerId;
  /** U-Wert [W/(m²·K)] — direkt für die Heizlast nach DIN EN 12831. */
  uValue?: number;
  material?: string;
  /** Für den KI-Import: Vertrauensmaß 0..1 der Vision-Erkennung. */
  confidence?: number;
  locked?: boolean;
  /**
   * Randbedingung übersteuern. Ohne Angabe wird sie abgeleitet: Außenwand →
   * `exterior`, Innenwand mit Raum dahinter → `adjacent-room`, Innenwand ohne
   * erkannten Raum dahinter → `unheated`. Zu setzen ist sie nur für Fälle, die
   * die Geometrie nicht hergibt — etwa eine Innenwand zur unbeheizten Garage.
   */
  boundary?: BoundaryCondition;
  /** Wärmebrückenzuschlag ΔU_WB [W/(m²·K)] für dieses Bauteil. */
  thermalBridgeSupplement?: number;
}

// ===========================================================================
// Öffnungen (Türen & Fenster)
// ===========================================================================

export type OpeningKind = 'door' | 'window' | 'passage';

/**
 * Fenstertypen. Der Typ bestimmt Symbol im Plan, Sprossenteilung im Modell
 * und die sinnvollen Vorgabemaße — ein Bandfenster wird anders bemaßt als
 * ein Dreh-Kipp-Flügel.
 */
export type WindowType =
  | 'fixed' // Festverglasung
  | 'casement' // einflügelig Dreh
  | 'tilt-turn' // Dreh-Kipp
  | 'double' // zweiflügelig
  | 'french' // Fenstertür / Balkontür (bodentief)
  | 'ribbon'; // Bandfenster (mehrfach geteilt)

/** Türtypen — bestimmen Blattdarstellung und Aufschlag im Plan. */
export type DoorType =
  | 'single' // einflügelig
  | 'double' // zweiflügelig
  | 'sliding' // Schiebetür
  | 'folding' // Falttür
  | 'revolving'; // Pendeltür

/** Ausbildung eines Durchgangs ohne Tür. */
export type PassageType =
  | 'open' // raumhohe Öffnung
  | 'lintel' // mit Sturz (Standardhöhe)
  | 'arch'; // Rundbogen

export interface OpeningTypePreset {
  id: string;
  label: string;
  kind: OpeningKind;
  width: number;
  height: number;
  sillHeight: number;
  windowType?: WindowType;
  doorType?: DoorType;
  passageType?: PassageType;
  /** Anzahl der Flügel-/Feldteilungen für Symbol und 3D-Sprossen. */
  panels?: number;
  uValue?: number;
  gValue?: number;
}

/**
 * Katalog gebräuchlicher Öffnungen nach DIN 18100 (Türen) und üblichen
 * Fenster-Rastermaßen. Bewusst als Daten und nicht als Sonderfälle im Code:
 * ein Projekt kann diese Liste ersetzen, ohne die Zeichenlogik anzufassen.
 */
export const OPENING_PRESETS: OpeningTypePreset[] = [
  // --- Fenster ---
  { id: 'win-fixed', label: 'Festverglasung', kind: 'window', width: 1.26, height: 1.385, sillHeight: 0.9, windowType: 'fixed', panels: 1, uValue: 0.9, gValue: 0.6 },
  { id: 'win-casement', label: 'Dreh, einflügelig', kind: 'window', width: 0.885, height: 1.385, sillHeight: 0.9, windowType: 'casement', panels: 1, uValue: 0.95, gValue: 0.6 },
  { id: 'win-tilt-turn', label: 'Dreh-Kipp', kind: 'window', width: 1.135, height: 1.385, sillHeight: 0.9, windowType: 'tilt-turn', panels: 1, uValue: 0.95, gValue: 0.6 },
  { id: 'win-double', label: 'Zweiflügelig', kind: 'window', width: 1.76, height: 1.385, sillHeight: 0.9, windowType: 'double', panels: 2, uValue: 1.0, gValue: 0.6 },
  { id: 'win-french', label: 'Fenstertür / Balkon', kind: 'window', width: 1.01, height: 2.135, sillHeight: 0, windowType: 'french', panels: 1, uValue: 1.1, gValue: 0.58 },
  { id: 'win-ribbon', label: 'Bandfenster', kind: 'window', width: 3.5, height: 1.135, sillHeight: 1.1, windowType: 'ribbon', panels: 3, uValue: 1.0, gValue: 0.6 },
  // --- Türen (DIN 18100 Rohbaumaße) ---
  { id: 'door-76', label: 'Tür 76 × 201', kind: 'door', width: 0.76, height: 2.01, sillHeight: 0, doorType: 'single', uValue: 1.8 },
  { id: 'door-88', label: 'Tür 88,5 × 201', kind: 'door', width: 0.885, height: 2.01, sillHeight: 0, doorType: 'single', uValue: 1.8 },
  { id: 'door-101', label: 'Tür 101 × 213,5', kind: 'door', width: 1.01, height: 2.135, sillHeight: 0, doorType: 'single', uValue: 1.6 },
  { id: 'door-double', label: 'Tür zweiflügelig', kind: 'door', width: 1.76, height: 2.135, sillHeight: 0, doorType: 'double', uValue: 1.8 },
  { id: 'door-sliding', label: 'Schiebetür', kind: 'door', width: 0.885, height: 2.01, sillHeight: 0, doorType: 'sliding', uValue: 2.2 },
  // --- Durchgänge ---
  { id: 'pass-lintel', label: 'Durchgang mit Sturz', kind: 'passage', width: 1.01, height: 2.135, sillHeight: 0, passageType: 'lintel' },
  { id: 'pass-open', label: 'Durchgang raumhoch', kind: 'passage', width: 1.26, height: 2.75, sillHeight: 0, passageType: 'open' },
  { id: 'pass-wide', label: 'Wanddurchbruch breit', kind: 'passage', width: 2.5, height: 2.135, sillHeight: 0, passageType: 'lintel' },
  { id: 'pass-arch', label: 'Rundbogen', kind: 'passage', width: 1.5, height: 2.2, sillHeight: 0, passageType: 'arch' },
];

/**
 * Öffnungen sind *parametrisch an die Wand gebunden*: Position wird als
 * Distanz entlang der Wandachse gespeichert, nicht als Weltkoordinate.
 * Wird die Wand verschoben, gedreht oder verlängert, wandert die Öffnung
 * korrekt mit und die 3D-Aussparung bleibt konsistent.
 */
export interface Opening {
  id: OpeningId;
  wallId: WallId;
  /** Zugewiesener Bauteilaufbau (Fenster-/Türtyp aus dem Katalog). */
  constructionId?: string;
  kind: OpeningKind;
  /** Distanz vom Wandstart (Knoten a) bis zur Öffnungs-MITTE [m]. */
  distance: number;
  /** Rohbau-Breite [m]. */
  width: number;
  /** Rohbau-Höhe [m]. */
  height: number;
  /** Brüstungshöhe über Fertigfußboden [m]. Türen: 0. */
  sillHeight: number;
  /** Türanschlag / Öffnungsrichtung — nur für die 2D-Darstellung relevant. */
  hinge?: 'left' | 'right';
  /** Öffnet nach +Normale der Wand (true) oder nach −Normale (false). */
  flipSwing?: boolean;
  /** U-Wert des Bauteils [W/(m²·K)] (Fenster typ. 0.9–1.3, Türen 1.3–1.8). */
  uValue?: number;
  /** Gesamtenergiedurchlassgrad g [-] für den solaren Gewinn. */
  gValue?: number;
  confidence?: number;
  /** Bauart — steuert Symbol, Sprossen und 3D-Ausbildung. */
  windowType?: WindowType;
  doorType?: DoorType;
  passageType?: PassageType;
  /** Flügel-/Feldanzahl (Bandfenster, zweiflügelige Elemente). */
  panels?: number;
}

// ===========================================================================
// Räume (Ergebnis der automatischen Raumerkennung)
// ===========================================================================

/**
 * Ein Wandabschnitt, der eine Raumgrenze bildet — inklusive der für die
 * Heizlast entscheidenden Orientierung und der zugehörigen Öffnungsflächen.
 */
export interface RoomBoundary {
  wallId: WallId;
  /** Länge des raumseitigen Wandabschnitts [m]. */
  length: number;
  /** Nettofläche der Wandscheibe [m²] = Länge × Höhe − Öffnungen. */
  netArea: number;
  /** Bruttofläche der Wandscheibe [m²] = Länge × Höhe. */
  grossArea: number;
  /** Summe der Öffnungsflächen in diesem Abschnitt [m²]. */
  openingArea: number;
  orientation: Orientation;
  /** Azimut der raumseitigen Außennormalen [°], 0 = Nord, im Uhrzeigersinn. */
  azimuth: number;
  isExterior: boolean;
  uValue?: number;
  /** Abgeleitete Randbedingung dieses Abschnitts. */
  boundary: BoundaryCondition;
  /** Raum auf der anderen Seite der Wand, falls vorhanden. */
  neighbourRoomId?: RoomId;
  /**
   * Anteil der Wandfläche oberhalb des Kniestocks [m²] — der Giebel. Nur
   * gesetzt, wenn über dem Geschoss ein geneigtes Dach liegt. Er wird im
   * Export als eigenes Bauteil geführt, weil ein Giebel in der Regel anders
   * aufgebaut ist als die Wand darunter.
   */
  gableArea?: number;
}

export type RoomUsage =
  | 'living'
  | 'bedroom'
  | 'kitchen'
  | 'bath'
  | 'wc'
  | 'hallway'
  | 'office'
  | 'storage'
  | 'technical'
  | 'other';

export interface Room {
  id: RoomId;
  name: string;
  usage: RoomUsage;
  levelId: LevelId;
  /** Geschlossenes Polygon der Wandachsen (CCW, ohne Duplikat am Ende). */
  polygon: Vec2[];
  /** Lichtes Innenpolygon (Achspolygon um die halben Wandstärken versetzt). */
  innerPolygon: Vec2[];
  /** Lichte Grundfläche [m²] — die maßgebliche Wohnfläche. */
  area: number;
  /** Bruttofläche über Wandachsen [m²]. */
  grossArea: number;
  /** Lichter Umfang [m]. */
  perimeter: number;
  /** Raumhöhe [m]. */
  height: number;
  /** Luftvolumen [m³] = area × height. */
  volume: number;
  /** Schwerpunkt des Innenpolygons — Ankerpunkt des Raumlabels. */
  centroid: Vec2;
  boundaries: RoomBoundary[];
  /** Solltemperatur [°C] für die Heizlast (DIN EN 12831 Tab. B.2). */
  setpointTemperature: number;
  /** Mindest-Luftwechselrate n_min [1/h] für den Lüftungswärmeverlust. */
  airChangeRate: number;
  /**
   * Rolle im Lüftungskonzept. Ohne eigene Angabe aus der Nutzung abgeleitet:
   * Aufenthaltsräume bekommen Zuluft, Bad/WC/Küche sind Ablufträume, Flure
   * strömen über.
   */
  ventilationRole?: VentilationRole;
  /** Beheizt? Unbeheizte Räume gehen als Nachbarbereich in die Rechnung ein. */
  isHeated: boolean;
  /** U-Wert und Randbedingung von Boden und Decke (Raum übersteuert Geschoss). */
  floorUValue?: number;
  floorBoundary?: BoundaryCondition;
  ceilingUValue?: number;
  ceilingBoundary?: BoundaryCondition;
  /**
   * Umfang mit Erdkontakt [m] — Grundlage des charakteristischen Bodenmaßes
   * B' = A_G / (0,5 · P). Abgeleitet aus den Außenwand-Abschnitten.
   */
  groundContactPerimeter: number;
  /** Anzahl unterschiedlich orientierter Außenfassaden — Abschirmungsbeiwert. */
  exposedFacadeCount: number;
  /**
   * Vom Nutzer gesetzte lichte Raumhöhe [m]. Überschreibt die aus den Wänden
   * abgeleitete Höhe — nötig bei abgehängten Decken oder Dachschrägen, wo die
   * Wandhöhe nicht der maßgeblichen Raumhöhe entspricht.
   */
  heightOverride?: number;
  /**
   * Abgeleitete Kennwerte unter der Dachschräge. Nur gesetzt, wenn über dem
   * Geschoss ein geneigtes Dach definiert ist.
   */
  roof?: RoomRoofMetrics;
  /**
   * Grundfläche, die von Treppen und Schächten belegt wird [m²]. Sie zählt
   * nicht zur nutzbaren Fläche und trägt kein Luftvolumen.
   */
  floorOpeningArea?: number;
  /**
   * Fläche, über der die Decke fehlt [m²] — offene Treppe, Luftraum, Galerie.
   * Dort gibt es kein Bauteil, also auch keinen Transmissionsverlust.
   */
  openToAboveArea?: number;
  /**
   * Anteil von `floorOpeningArea`, der auf massive Bauteile entfällt [m²] —
   * Kamin, Pfeiler, Wandversatz.
   *
   * Er steht getrennt, weil er das Gegenteil eines Lochs ist: die Fläche
   * fehlt dem Raum, aber nicht dem Bauwerk. Die Gegenstelle braucht die
   * Unterscheidung für den Massenauszug und für die Wärmebrücke; für die
   * Flächen- und Volumenrechnung wirken beide gleich.
   */
  solidArea?: number;
  /**
   * Norm-Heizlast dieses Raums, **zurückgeschrieben von der Gegenstelle**.
   *
   * Dieses Werkzeug rechnet sie nicht — es erfasst die Eingangsdaten, und die
   * Rechnung nach DIN EN 12831 findet in RaVia statt. Kommt sie von dort
   * zurück, ersetzt sie in der Anlagenauslegung den eigenen Überschlag: die
   * Fußbodenheizung wird dann mit der echten Last je Raum ausgelegt statt mit
   * einer Schätzung. Fehlt sie, bleibt es beim Überschlag — und der ist als
   * solcher gekennzeichnet.
   */
  normHeatLoad?: RoomHeatLoad;
}

/**
 * Eine gerechnete Raum-Heizlast, die von außen kommt.
 *
 * Sie trägt ihre Herkunft mit sich. Das ist keine Formsache: eine Zahl, die
 * aussieht wie eine eigene Rechnung, aber aus einem anderen Programm stammt,
 * ist die gefährlichste Art von Zahl. Wer sie im Anlagenblatt sieht, muss
 * erkennen können, wer sie gerechnet hat und wann — sonst rechnet er mit
 * einem Stand weiter, den es im Modell längst nicht mehr gibt.
 */
export interface RoomHeatLoad {
  /** Norm-Heizlast des Raums [W]. */
  total: number;
  /** Transmissionsanteil [W], falls die Gegenstelle ihn ausweist. */
  transmission?: number;
  /** Lüftungsanteil [W]. */
  ventilation?: number;
  /** Wiederaufheizanteil [W] bei Absenkbetrieb. */
  reheat?: number;
  /** Wer gerechnet hat, z. B. „RaVia 3.2". */
  source: string;
  /** Zeitpunkt der Übernahme (ISO-8601). */
  receivedAt: string;
  /**
   * Modellstand zum Zeitpunkt der Übernahme (`meta.modifiedAt`).
   * Weicht er vom heutigen ab, ist die Last womöglich für eine andere
   * Geometrie gerechnet worden — das Anlagenblatt sagt das dann.
   */
  modelState?: string;
}

// ===========================================================================
// TGA — Technische Gebäudeausrüstung
// ===========================================================================

export type FixtureCategory = 'heating' | 'sanitary' | 'ventilation';

/**
 * Symbol-Typen der TGA-Bibliothek. Bewusst ein flacher String-Union statt
 * einer Klassenhierarchie: die Symbole unterscheiden sich in Darstellung und
 * Kennwerten, nicht im Verhalten.
 */
export type FixtureType =
  // Heizung
  | 'radiator' // Heizkörper (Kompakt)
  | 'radiator-tube' // Röhrenradiator
  | 'convector' // Unterflurkonvektor
  | 'underfloor' // Fußbodenheizkreis
  | 'manifold' // Heizkreisverteiler
  | 'boiler' // Wärmeerzeuger
  | 'riser-heating' // Heizungs-Steigstrang
  | 'thermostat' // Raumthermostat
  // Sanitär
  | 'wc'
  | 'washbasin'
  | 'shower'
  | 'bathtub'
  | 'sink' // Spüle
  | 'kitchen-unit' // Küchenzeile (Unterschrankzeile)
  | 'water-heater' // Warmwasserbereiter
  | 'riser-sanitary' // Fallstrang
  | 'floor-drain' // Bodenablauf
  // Lüftung
  | 'air-supply' // Zuluftventil
  | 'air-exhaust' // Abluftventil
  | 'air-transfer' // Überströmelement
  | 'ahu' // Lüftungsgerät
  | 'duct'; // Kanaltrasse

/**
 * Verlegemuster einer Fußbodenheizung.
 *
 * `schnecke` ist die bifilare Verlegung: Vor- und Rücklauf liegen
 * abwechselnd nebeneinander, sodass sich die Oberflächentemperatur über die
 * Fläche ausgleicht. `maeander` legt die Bahnen der Reihe nach — einfacher zu
 * verlegen, aber mit einem Temperaturgefälle vom Anfang zum Ende des Kreises.
 * Der Typ steht hier und nicht im Rechenkern, weil er zum gespeicherten
 * Modell gehört: die Kurve selbst wird nicht gespeichert, die Entscheidung
 * für das Muster schon.
 */
export type FloorLoopPattern = 'schnecke' | 'maeander';

export interface FixtureParams {
  /** Heizung: Normwärmeleistung [W] bei 55/45/20 °C. */
  powerW?: number;
  /** Heizung: Bautiefe/Typ, z. B. "22" für Typ 22. */
  radiatorType?: string;
  /** Heizung: Vor-/Rücklauftemperatur [°C]. */
  flowTemperature?: number;
  returnTemperature?: number;
  /** Lüftung: Volumenstrom [m³/h]. */
  airflow?: number;
  /** Sanitär: Anschlussnennweite, z. B. "DN 100". */
  connection?: string;
  /** Sanitär: Warmwasseranschluss vorhanden. */
  hotWater?: boolean;
  /**
   * Fußbodenheizung: Das Objekt belegt die **ganze Fläche des zugeordneten
   * Raums** und ist kein Einzelsymbol.
   *
   * Warum als Merkmal am Objekt und nicht als eigener `FixtureType`: eine
   * Flächenbelegung *ist* ein Fußbodenheizkreis. Ein zweiter Typ daneben
   * würde von allem, was heute `type === 'underfloor'` auswertet — Massen-
   * auszug, Validierung, Rohrnetz, hydraulischer Abgleich —, stillschweigend
   * übergangen. Der Raumbezug steht in `Fixture.roomId`.
   */
  roomCoverage?: boolean;
  /** Fußbodenheizung: Verlegeabstand [m]. */
  loopSpacing?: number;
  /** Fußbodenheizung: Zahl der Heizkreise in diesem Raum [-]. */
  loopCount?: number;
  /** Fußbodenheizung: Verlegemuster. */
  loopPattern?: FloorLoopPattern;
  /**
   * Fußbodenheizung: Randabstand [m] — Randdämmstreifen plus Abstand des
   * ersten Rohrs zur Wand. Steht am Objekt und nicht als Konstante im
   * Zeichencode, weil er die belegbare Fläche und damit die Leistung
   * verändert und deshalb nachvollziehbar sein muss.
   */
  loopEdgeClearance?: number;
  /** Freitext für Fabrikat/Typ. */
  note?: string;
}

/**
 * Ein platziertes TGA-Objekt. Position und Drehung liegen im Modellraum;
 * `wallId` bindet wandgebundene Objekte (Heizkörper, Ventile) parametrisch
 * an ihre Wand, damit sie beim Verschieben der Wand mitwandern.
 */
export interface Fixture {
  id: string;
  type: FixtureType;
  category: FixtureCategory;
  levelId: LevelId;
  /** Einbaupunkt (Symbolmitte) im Modellraum [m]. */
  position: Vec2;
  /** Drehung [°] CCW; 0 = Symbolachse zeigt nach +x. */
  rotation: number;
  /** Baulänge und Bautiefe [m] — steuern Symbolgröße und 3D-Körper. */
  length: number;
  depth: number;
  /** Montagehöhe über Fertigfußboden [m]. */
  elevation: number;
  /** Zugeordnete Wand (wandgebundene Objekte). */
  wallId?: WallId;
  /** Zugeordneter Raum — wird bei jeder Raumerkennung neu bestimmt. */
  roomId?: RoomId;
  label?: string;
  params: FixtureParams;
}

export interface FixtureDefinition {
  type: FixtureType;
  category: FixtureCategory;
  label: string;
  /** Vorgabe-Baulänge und -tiefe [m]. */
  length: number;
  depth: number;
  elevation: number;
  /** Objekt sitzt an einer Wand und richtet sich automatisch daran aus. */
  wallMounted: boolean;
  params: FixtureParams;
}

/** Die Symbolbibliothek als Daten — erweiterbar ohne Eingriff in den Renderer. */
export const FIXTURE_LIBRARY: FixtureDefinition[] = [
  // --- Heizung ---
  { type: 'radiator', category: 'heating', label: 'Heizkörper', length: 1.0, depth: 0.1, elevation: 0.15, wallMounted: true, params: { powerW: 1200, radiatorType: '22', flowTemperature: 55, returnTemperature: 45 } },
  { type: 'radiator-tube', category: 'heating', label: 'Röhrenradiator', length: 0.6, depth: 0.12, elevation: 0.15, wallMounted: true, params: { powerW: 700, radiatorType: 'Röhren' } },
  { type: 'convector', category: 'heating', label: 'Unterflurkonvektor', length: 1.4, depth: 0.2, elevation: 0, wallMounted: true, params: { powerW: 900 } },
  { type: 'underfloor', category: 'heating', label: 'FBH-Heizkreis', length: 0.9, depth: 0.9, elevation: 0, wallMounted: false, params: { powerW: 800, flowTemperature: 35, returnTemperature: 28 } },
  { type: 'manifold', category: 'heating', label: 'Heizkreisverteiler', length: 0.6, depth: 0.15, elevation: 0.5, wallMounted: true, params: {} },
  { type: 'boiler', category: 'heating', label: 'Wärmeerzeuger', length: 0.6, depth: 0.45, elevation: 0.6, wallMounted: true, params: { powerW: 15000 } },
  { type: 'riser-heating', category: 'heating', label: 'Steigstrang Heizung', length: 0.16, depth: 0.16, elevation: 0, wallMounted: false, params: {} },
  { type: 'thermostat', category: 'heating', label: 'Raumthermostat', length: 0.1, depth: 0.04, elevation: 1.4, wallMounted: true, params: {} },
  // --- Sanitär ---
  { type: 'wc', category: 'sanitary', label: 'WC', length: 0.38, depth: 0.55, elevation: 0, wallMounted: true, params: { connection: 'DN 100' } },
  { type: 'washbasin', category: 'sanitary', label: 'Waschtisch', length: 0.6, depth: 0.5, elevation: 0.85, wallMounted: true, params: { connection: 'DN 50', hotWater: true } },
  { type: 'shower', category: 'sanitary', label: 'Dusche', length: 0.9, depth: 0.9, elevation: 0, wallMounted: false, params: { connection: 'DN 50', hotWater: true } },
  { type: 'bathtub', category: 'sanitary', label: 'Badewanne', length: 1.7, depth: 0.75, elevation: 0, wallMounted: true, params: { connection: 'DN 50', hotWater: true } },
  { type: 'sink', category: 'sanitary', label: 'Spüle', length: 0.8, depth: 0.6, elevation: 0.85, wallMounted: true, params: { connection: 'DN 50', hotWater: true } },
  /**
   * Küchenzeile — die Unterschrankzeile, nicht die Spüle darin.
   *
   * Sie steht im Katalog, weil sie für die Fußbodenheizung dasselbe ist wie
   * eine Badewanne: ein fest eingebauter, bis auf den Estrich reichender
   * Körper, unter dem kein Rohr liegen darf — weder wärmetechnisch (der
   * Sockel schließt die Fläche vom Raum ab) noch handwerklich (die
   * Unterschränke werden am Boden befestigt).
   *
   * Vorgabemaße: 60 cm Bautiefe ist das seit Jahrzehnten übliche Maß des
   * Unterschrankkorpus samt Arbeitsplattenüberstand und steht so in jedem
   * Möbel- und Küchenkatalog. 3,00 m Länge ist eine gängige Zeile und
   * ausdrücklich nur eine Vorbelegung — die tatsächliche Länge trägt der
   * Planer am Objekt ein. `elevation` ist 0, weil die Zeile auf dem
   * Fertigfußboden steht; die Arbeitsplattenhöhe ist kein Montagemaß.
   *
   * Geführt unter „Sanitär", weil der Katalog nur die drei Gewerke kennt und
   * die Zeile das Objekt ist, zu dem Spüle und deren Anschlüsse gehören.
   */
  { type: 'kitchen-unit', category: 'sanitary', label: 'Küchenzeile', length: 3.0, depth: 0.6, elevation: 0, wallMounted: true, params: {} },
  { type: 'water-heater', category: 'sanitary', label: 'Warmwasserbereiter', length: 0.5, depth: 0.5, elevation: 1.2, wallMounted: true, params: { powerW: 2000 } },
  { type: 'riser-sanitary', category: 'sanitary', label: 'Fallstrang', length: 0.14, depth: 0.14, elevation: 0, wallMounted: false, params: { connection: 'DN 100' } },
  { type: 'floor-drain', category: 'sanitary', label: 'Bodenablauf', length: 0.15, depth: 0.15, elevation: 0, wallMounted: false, params: { connection: 'DN 70' } },
  // --- Lüftung ---
  { type: 'air-supply', category: 'ventilation', label: 'Zuluftventil', length: 0.16, depth: 0.16, elevation: 2.4, wallMounted: false, params: { airflow: 45 } },
  { type: 'air-exhaust', category: 'ventilation', label: 'Abluftventil', length: 0.16, depth: 0.16, elevation: 2.4, wallMounted: false, params: { airflow: 60 } },
  { type: 'air-transfer', category: 'ventilation', label: 'Überströmelement', length: 0.4, depth: 0.06, elevation: 0.01, wallMounted: true, params: { airflow: 40 } },
  { type: 'ahu', category: 'ventilation', label: 'Lüftungsgerät', length: 0.9, depth: 0.6, elevation: 1.8, wallMounted: true, params: { airflow: 300 } },
  { type: 'duct', category: 'ventilation', label: 'Kanaltrasse', length: 1.5, depth: 0.2, elevation: 2.5, wallMounted: false, params: { airflow: 300 } },
];

export const FIXTURE_BY_TYPE: Record<string, FixtureDefinition> = Object.fromEntries(
  FIXTURE_LIBRARY.map((f) => [f.type, f]),
);

export const FIXTURE_CATEGORY_LABELS: Record<FixtureCategory, string> = {
  heating: 'Heizung',
  sanitary: 'Sanitär',
  ventilation: 'Lüftung',
};

// ===========================================================================
// Geschosse & Layer
// ===========================================================================

export interface Level {
  id: LevelId;
  name: string;
  /** OK Fertigfußboden über Bezugsniveau [m]. */
  elevation: number;
  /** Lichte Geschosshöhe [m]. */
  height: number;
  /** Bodenaufbau: U-Wert [W/(m²·K)] und wogegen er grenzt. */
  floorUValue: number;
  floorBoundary: BoundaryCondition;
  /** Deckenaufbau. */
  ceilingUValue: number;
  ceilingBoundary: BoundaryCondition;
  /** Bauteilaufbauten aus dem Katalog (übersteuern die U-Werte oben). */
  floorConstructionId?: string;
  ceilingConstructionId?: string;
  /** Reihenfolge von unten nach oben — steuert Sortierung und Nachbarschaft. */
  order: number;
  /**
   * Dach über diesem Geschoss. Fehlt der Eintrag, ist die Decke horizontal —
   * dasselbe wie `kind: 'flat'`, nur ohne Ballast im Dokument.
   */
  roof?: RoofDefinition;
}

// ===========================================================================
// Dach — geneigte Hüllflächen über einem Geschoss
// ===========================================================================

/**
 * Dachform über einem Geschoss.
 *
 * `flat` bedeutet: kein Dach im Sinne einer Schräge, die Decke bleibt
 * horizontal — der Normalfall in Regelgeschossen.
 */
export type RoofKind = 'flat' | 'gable' | 'monopitch' | 'hip';

export const ROOF_KIND_LABELS: Record<RoofKind, string> = {
  flat: 'Flachdach / horizontale Decke',
  gable: 'Satteldach',
  monopitch: 'Pultdach',
  hip: 'Walmdach',
};

/**
 * Dachdefinition eines Geschosses.
 *
 * Beschrieben wird das Dach über seine **Firstachse** (Lage und Richtung) und
 * die Neigung. Daraus ergibt sich an jedem Punkt des Grundrisses eine Höhe —
 * und damit alles, was die Heizlast braucht: Luftvolumen, geneigte Dachfläche,
 * Giebelflächen und die *tatsächliche* Fläche jeder Außenwand unter der
 * Schräge. Das ist der Grund für diese Modellierung: eine Wand im Dachgeschoss
 * ist nicht `Länge × Geschosshöhe`, sondern läuft unter der Schräge aus.
 *
 * Geometrie:
 *   h(p) = ridgeHeight − dist(p, Firstachse) · tan(pitch),  nach unten auf
 *   `kneeHeight` begrenzt (dort steht der Kniestock).
 *
 * Beim Pultdach zählt nur die Seite, die von `azimuth` weg zeigt; die
 * Gegenseite liegt vollständig auf Kniestockhöhe.
 */
export interface RoofDefinition {
  kind: RoofKind;
  /** Dachneigung gegen die Horizontale [°]. 0–75. */
  pitch: number;
  /** Lichte Höhe an der Traufe (Kniestock) über Rohfußboden [m]. */
  kneeHeight: number;
  /**
   * Richtung der Dachneigung als Azimut [°], 0 = Nord, im Uhrzeigersinn.
   * Beim Satteldach die Richtung, in die die *eine* Dachfläche zeigt — die
   * Firstachse steht senkrecht dazu. Beim Pultdach die Fallrichtung.
   */
  azimuth: number;
  /**
   * Lage der Firstachse als Verschiebung aus der Grundriss-Mitte [m],
   * gemessen in Neigungsrichtung. 0 = mittig (symmetrisches Satteldach).
   */
  ridgeOffset: number;
  /** Dachaufbau. */
  uValue: number;
  constructionId?: string;
  /** Giebelflächen (senkrechte Dreiecke unter dem First). */
  gableUValue: number;
  gableConstructionId?: string;
  /**
   * Höhe, ab der die Schräge in eine waagerechte Decke übergeht [m] —
   * die Kehlbalkenlage. Ohne Wert läuft die Schräge bis zum First durch.
   */
  collarHeight?: number;
  collarUValue?: number;
  collarConstructionId?: string;
}

/** Kennwerte eines Raums unter dem Dach — vollständig abgeleitet. */
/**
 * Dachflächenfenster und Gauben.
 *
 * Beides sind Löcher in der Dachfläche, aber mit gegensätzlicher Wirkung:
 * Das **Dachflächenfenster** ersetzt ein Stück Dach durch Glas — dieselbe
 * Neigung, derselbe Azimut, nur ein anderer U-Wert und ein g-Wert dazu. Die
 * **Gaube** dagegen hebt den Raum an: sie schafft Volumen und Stehhöhe, wo
 * vorher die Schräge war, und bringt drei neue Bauteile mit — die senkrechte
 * Front, zwei Wangen und ein eigenes kleines Dach.
 *
 * Modelliert wird die Gaube über die Höhenfunktion: innerhalb ihrer
 * Grundfläche liegt die lichte Höhe höher. Damit stimmen Volumen und
 * Wohnfläche automatisch, ohne dass irgendwo ein Sonderfall gerechnet wird.
 */
export type RoofOpeningKind = 'skylight' | 'dormer-shed' | 'dormer-gable';

export const ROOF_OPENING_LABELS: Record<RoofOpeningKind, string> = {
  skylight: 'Dachflächenfenster',
  'dormer-shed': 'Schleppgaube',
  'dormer-gable': 'Giebelgaube',
};

export interface RoofOpening {
  id: string;
  levelId: LevelId;
  kind: RoofOpeningKind;
  /** Mittelpunkt der Grundrissfläche [m]. */
  position: Vec2;
  /** Breite quer zur Fallrichtung des Daches [m]. */
  width: number;
  /**
   * Ausdehnung in Fallrichtung [m]. Beim Dachflächenfenster ist das die
   * Fensterhöhe *in der Dachebene*, bei der Gaube ihre Tiefe im Grundriss.
   */
  depth: number;
  /** Nur Gaube: lichte Höhe der Gaubenfront über Rohfußboden [m]. */
  frontHeight?: number;
  /** Nur Gaube: verglaster Anteil der Front [m²]. */
  frontWindowArea?: number;
  /**
   * Nur Giebelgaube: Höhe der Giebelspitze über der Traufe der Gaube [m].
   * Sie macht aus der senkrechten Rechteckfront ein Rechteck mit Dreieck
   * darüber — und aus dem flachen Gaubendach ein kleines Satteldach.
   */
  gableRise?: number;
  /** U-Wert des Bauteils selbst (Fenster bzw. Gaubendach). */
  uValue: number;
  /** Gesamtenergiedurchlassgrad — nur beim Fenster. */
  gValue?: number;
  /** U-Wert der Gaubenfront und -wangen. */
  frontUValue?: number;
  constructionId?: string;
  label?: string;
}

export interface RoomRoofMetrics {
  /** Luftvolumen unter der Schräge [m³] statt Fläche × Höhe. */
  volume: number;
  /** Mittlere lichte Höhe [m] = Volumen / Grundfläche. */
  averageHeight: number;
  minHeight: number;
  maxHeight: number;
  /** Geneigte Dachfläche über dem Raum [m²] (echte Fläche, nicht projiziert). */
  slopedArea: number;
  /**
   * Dieselbe Fläche nach Dachflächen getrennt — Azimut [°] und Fläche [m²].
   * Ein Satteldach liefert zwei Einträge, ein Walmdach bis zu vier. Für die
   * solaren Gewinne und den Abschirmungsbeiwert ist die Himmelsrichtung
   * jeder Dachfläche nötig, nicht nur ihre Summe.
   */
  slopedAreaByFace: { azimuth: number; area: number }[];
  /** Waagerechte Deckenfläche über dem Raum [m²] (Kehlbalken oder Flachanteil). */
  flatCeilingArea: number;
  /** Senkrechte Giebelflächen über dem Raum [m²]. */
  gableArea: number;
  /**
   * Wohnfläche nach WoFlV §4 [m²]: über 2,00 m voll, 1,00–2,00 m zur Hälfte,
   * darunter gar nicht. Steht *neben* der Grundfläche, ersetzt sie nicht.
   */
  livingArea: number;
  /** Grundfläche mit lichter Höhe unter 1,00 m [m²] — nicht nutzbar. */
  areaBelow1m: number;
  /** Verglaste Fläche in der Dachfläche [m²] — Dachflächenfenster. */
  skylightArea: number;
  /** Senkrechte Gaubenfronten über dem Raum [m²]. */
  dormerFrontArea: number;
  /** Wangen der Gauben [m²] — die seitlichen Dreiecke. */
  dormerCheekArea: number;
  /** Geneigte Dachflächen der Gauben [m²]. */
  dormerRoofArea: number;
  /** Zusätzliches Luftvolumen durch Gauben [m³]. */
  dormerVolume: number;
}

export interface Layer {
  id: LayerId;
  name: string;
  /** Hex-Farbe der Vektorlinien. */
  color: string;
  visible: boolean;
  locked: boolean;
}

// ===========================================================================
// Grundriss-Referenzbild (Import & Kalibrierung)
// ===========================================================================

export interface CalibrationLine {
  /** Startpunkt der gezogenen Messstrecke im Modellraum [m]. */
  from: Vec2;
  to: Vec2;
  /** Vom Nutzer eingegebene reale Länge dieser Strecke [m]. */
  realLength: number;
}

export interface FloorplanImage {
  id: string;
  /** Object-URL oder Data-URL des Bitmaps (PDF wird vorab gerastert). */
  src: string;
  name: string;
  /** Natürliche Pixelmaße der Quelle. */
  naturalWidth: number;
  naturalHeight: number;
  /** Position der linken oberen Bildecke im Modellraum [m]. */
  origin: Vec2;
  /** Maßstab [m pro Pixel] — Ergebnis der Kalibrierung. */
  scale: number;
  /** Drehung [°] gegen den Uhrzeigersinn. */
  rotation: number;
  opacity: number;
  visible: boolean;
  /**
   * Interaktions-Sperre. Ist das Bild gesperrt, ignoriert der Editor jeden
   * Zugriff darauf — man kann bedenkenlos darüber zeichnen, ohne die
   * Referenz versehentlich zu verschieben.
   */
  locked: boolean;
  calibration?: CalibrationLine;
}

/** Pixel pro Meter — der für die Kalibrierung sprechende Kehrwert von `scale`. */
export const pixelsPerMeter = (image: Pick<FloorplanImage, 'scale'>): number =>
  image.scale > 0 ? 1 / image.scale : 0;

// ===========================================================================
// KI-Erkennung (Vision-API-Vertrag)
// ===========================================================================

/**
 * Antwortformat, das der Vision-Proxy liefern MUSS. Alle Koordinaten in
 * *Bildpixeln* der Originalauflösung — die Umrechnung in Modellmeter
 * übernimmt der Client anhand von `FloorplanImage.scale` und `.origin`.
 * Dadurch bleibt die KI-Seite maßstabsagnostisch und damit robust.
 */
export interface AiDetectedWall {
  /** Achsen-Startpunkt in Bildpixeln. */
  start: Vec2;
  /** Achsen-Endpunkt in Bildpixeln. */
  end: Vec2;
  /** Erkannte Wandstärke in Bildpixeln. */
  thicknessPx: number;
  confidence: number;
  type?: WallType;
}

export interface AiDetectedOpening {
  kind: OpeningKind;
  /** Mittelpunkt der Öffnung in Bildpixeln. */
  center: Vec2;
  /** Breite entlang der Wand in Bildpixeln. */
  widthPx: number;
  confidence: number;
  /** Höhe / Brüstung in Metern, falls die KI sie aus Beschriftung ableitet. */
  heightM?: number;
  sillHeightM?: number;
}

export interface AiDetectedRoomLabel {
  /** OCR-Text des Raumstempels, z. B. "Wohnen 24,80 m²". */
  text: string;
  /** Ankerpunkt in Bildpixeln. */
  position: Vec2;
  /** Aus dem Text geparste Fläche [m²], falls vorhanden. */
  areaM2?: number;
  confidence: number;
}

/** Von der KI erkannte Maßkette — Grundlage für die Auto-Kalibrierung. */
export interface AiDetectedDimension {
  from: Vec2;
  to: Vec2;
  /** Gelesener Maßtext in Metern, z. B. 5.0 für "5,00". */
  valueM: number;
  confidence: number;
}

export interface AiFloorplanAnalysis {
  walls: AiDetectedWall[];
  openings: AiDetectedOpening[];
  roomLabels: AiDetectedRoomLabel[];
  dimensions: AiDetectedDimension[];
  /** Von der KI vorgeschlagener Maßstab [m/px] — aus `dimensions` abgeleitet. */
  suggestedScale?: number;
  /** Gesamtvertrauen 0..1. */
  confidence: number;
  /** Laufzeit des Vision-Calls [ms] — für die Statuszeile. */
  durationMs: number;
  modelId: string;
}

export type AiAnalysisState =
  | { status: 'idle' }
  | { status: 'uploading'; progress: number }
  | { status: 'analyzing'; progress: number; stage: string }
  | { status: 'done'; result: AiFloorplanAnalysis }
  | { status: 'error'; message: string };

// ---------------------------------------------------------------------------
// Auto-Trace-Vorschau
// ---------------------------------------------------------------------------

/**
 * Ein KI-Vorschlag, bereits in *Weltkoordinaten* umgerechnet, aber noch nicht
 * Teil des Dokuments. Die Vorschau lebt bewusst außerhalb von `BimDocument`:
 * Vorschläge sollen keine Undo-Schritte erzeugen und keine Raumerkennung
 * auslösen, solange sie nicht bestätigt sind.
 */
export interface TraceWallCandidate {
  id: string;
  kind: 'wall';
  start: Vec2;
  end: Vec2;
  /** Aus der Bildanalyse abgeleitete Wandstärke [m]. */
  thickness: number;
  confidence: number;
  type: WallType;
  /** Vom Nutzer verworfen — bleibt zur Nachvollziehbarkeit erhalten. */
  rejected: boolean;
}

export interface TraceOpeningCandidate {
  id: string;
  kind: 'door' | 'window';
  center: Vec2;
  width: number;
  height: number;
  sillHeight: number;
  confidence: number;
  rejected: boolean;
}

export type TraceCandidate = TraceWallCandidate | TraceOpeningCandidate;

export interface TraceState {
  /** Modell-ID / Provider, der die Vorschläge erzeugt hat. */
  source: string;
  createdAt: string;
  walls: TraceWallCandidate[];
  openings: TraceOpeningCandidate[];
  roomLabels: AiDetectedRoomLabel[];
  /** Vorschau-Ebene sichtbar? */
  visible: boolean;
  /** Vorschläge unterhalb dieser Konfidenz werden ausgeblendet. */
  minConfidence: number;
  overallConfidence: number;
  durationMs: number;
}

// ===========================================================================
// Werkzeuge & Editor-Zustand
// ===========================================================================

// ===========================================================================
// Vertikale Bauteile — Treppen und Schächte
// ===========================================================================

export type VerticalKind = 'stair-straight' | 'stair-l' | 'stair-u' | 'stair-spiral' | 'shaft';

export const VERTICAL_LABELS: Record<VerticalKind, string> = {
  'stair-straight': 'Gerade Treppe',
  'stair-l': 'Viertelgewendelte Treppe',
  'stair-u': 'Halbgewendelte Treppe',
  'stair-spiral': 'Wendeltreppe',
  shaft: 'Schacht',
};

export type ShaftService = 'heating' | 'sanitary' | 'ventilation' | 'electric' | 'mixed';

export const SHAFT_SERVICE_LABELS: Record<ShaftService, string> = {
  heating: 'Heizung',
  sanitary: 'Sanitär',
  ventilation: 'Lüftung',
  electric: 'Elektro',
  mixed: 'gemischt',
};

/**
 * Ein Bauteil, das mehrere Geschosse verbindet.
 *
 * Treppe und Schacht sind dasselbe Problem: eine Fläche im Grundriss, die
 * kein normaler Raum ist, weil die Decke darüber fehlt. Für die Heizlast
 * heißt das zweierlei — die Grundfläche des Raums wird kleiner, und die
 * Decke über dieser Fläche grenzt nicht an ein unbeheiztes Geschoss, sondern
 * ist offen. Beides falsch zu rechnen kostet in einem Reihenhaus mit offener
 * Treppe schnell 10 % der Last.
 */
export interface VerticalElement {
  id: string;
  kind: VerticalKind;
  name: string;
  /** Geschoss, in dem das Bauteil beginnt (unteres Ende). */
  levelId: LevelId;
  /** Oberstes erreichtes Geschoss. Fehlt der Wert, ist es das nächsthöhere. */
  toLevelId?: LevelId;
  /** Mittelpunkt der Grundrissfläche [m]. */
  position: Vec2;
  /** Laufbreite [m] (quer zur Laufrichtung). */
  width: number;
  /** Lauflänge [m] (in Laufrichtung). */
  length: number;
  /** Drehung [°] CCW; 0 = Laufrichtung zeigt nach +x. */
  rotation: number;
  /** Anzahl Steigungen — bestimmt Steigungshöhe und die Darstellung im Plan. */
  steps?: number;
  /** Nur beim Schacht: welches Gewerk darin läuft. */
  service?: ShaftService;
  /**
   * Zieht die Fläche von der Raumfläche ab. Bei einer offenen Treppe ja,
   * bei einem eingehausten Treppenraum nein — dort ist die Treppe ein
   * eigener Raum mit eigenen Wänden.
   */
  deductsArea: boolean;
  /**
   * Die Decke über dieser Fläche fehlt: der Luftraum reicht ins nächste
   * Geschoss. Für die Heizlast bedeutet das eine adiabate Fläche statt
   * einer Decke gegen unbeheizt.
   */
  openToAbove: boolean;
}

// ===========================================================================
// Massive Bauteile — Kamin, Pfeiler, Wandversatz
// ===========================================================================

export type SolidKind = 'chimney' | 'pier' | 'wall-offset' | 'service-block';

export const SOLID_LABELS: Record<SolidKind, string> = {
  chimney: 'Kamin / Schornstein',
  pier: 'Pfeiler',
  'wall-offset': 'Wandversatz',
  'service-block': 'Installationsblock',
};

/**
 * Ein massives Bauteil ohne Raumfunktion.
 *
 * **Warum ein eigener Typ und nicht ein weiterer `VerticalKind`.** Treppe und
 * Schacht sind Hohlräume: `openToAbove` beschreibt eine offene Luftverbindung
 * ins nächste Geschoss, `deductsArea` eine fehlende Decke. Ein Schornstein ist
 * das Gegenteil — dort ist Material, keine Luft. Wer ihn als Treppenart führt,
 * erbt jede Regel, die für Hohlräume geschrieben wurde: der IFC-Export macht
 * aus jedem vertikalen Bauteil, das kein Schacht ist, eine `IFCSTAIR`, die
 * Eigenschaftsleiste bietet Steigungszahl und Laufbreite an, und die
 * Deckenöffnung im Geschoss darüber wäre die falsche Aussage. Ein eigener,
 * rein additiver Typ hält beide Sachverhalte auseinander und lässt den
 * Bestand unangetastet.
 *
 * **Was der Typ leisten muss.** Ein Kamin nimmt Grundfläche und Luftvolumen
 * weg wie eine Treppe, steht auf dem Estrich und ist damit eine Aussparung für
 * die Fußbodenheizung, wird im Plan massiv dargestellt und ist — wenn er an
 * einer Außenwand steht — eine Wärmebrücke. Die Wärmebrücke wird hier nicht
 * gerechnet (siehe `raviaExport`), aber als Eingangsgröße geführt.
 */
export interface SolidElement {
  id: string;
  kind: SolidKind;
  name: string;
  /** Geschoss, in dem das Bauteil steht (unteres Ende). */
  levelId: LevelId;
  /** Mittelpunkt der Grundrissfläche [m] — auch beim freien Umriss. */
  position: Vec2;
  /** Breite [m] quer zur Längsrichtung. Ohne Wirkung, wenn `outline` steht. */
  width: number;
  /** Länge [m] in Längsrichtung. Ohne Wirkung, wenn `outline` steht. */
  length: number;
  /** Drehung [°] CCW; 0 = Längsrichtung zeigt nach +x. */
  rotation: number;
  /**
   * Freier Grundriss in Weltkoordinaten [m].
   *
   * Der Regelfall ist das Rechteck — ein Schornstein ist rechteckig, ein
   * Pfeiler auch. Ein Mauerwerksversatz ist es nicht immer, deshalb darf der
   * Umriss auch als Polygon angegeben werden. Steht er, gilt er; `width`,
   * `length` und `rotation` bleiben dann nur noch Griff für die Anzeige.
   */
  outline?: Vec2[];
  /**
   * Höhe über OK Fertigfußboden [m]. Fehlt der Wert, reicht das Bauteil über
   * die volle lichte Geschosshöhe — der Regelfall bei Kamin und Pfeiler.
   * Ein Versatz kann niedriger sein (Sockel, Brüstung).
   */
  height?: number;
  /**
   * Durchstößt das Bauteil die Decke und läuft durch alle darüberliegenden
   * Geschosse weiter?
   *
   * Beim Schornstein ja: er beginnt am Feuerraum und geht bis übers Dach. Beim
   * Pfeiler und beim Versatz nein — die gehören zu genau einem Geschoss. Aus
   * dieser Angabe folgt zweierlei: ob das Bauteil in den Geschossen darüber
   * gezeichnet wird und rechnet, und ob es beim Übernehmen eines Geschosses
   * kopiert wird (siehe `addLevel`).
   */
  throughAllLevels: boolean;
  /** Baustoff im Klartext — geht in den Export, wird nicht gerechnet. */
  material?: string;
}

// ===========================================================================
// Rohrnetz
// ===========================================================================

export type PipeService =
  | 'heating-flow'
  | 'heating-return'
  | 'hot-water'
  | 'cold-water'
  | 'circulation'
  | 'waste'
  /**
   * Kältemittelleitung zwischen Außen- und Inneneinheit eines Splitgeräts.
   *
   * Eigene Art, weil die Leitungsart im Fließbild eine Aussage über den
   * **Stoff** ist. Als „Heizung Vorlauf" gezeichnet behauptete die Legende
   * Heizungswasser zwischen den Einheiten — mit Zollmaßen daneben, und für
   * den Monteur, der danach Dämmung, Druckprobe und Kälteschein richtet,
   * gefährlich irreführend.
   */
  | 'refrigerant'
  | 'ventilation-supply'
  | 'ventilation-exhaust';

export const PIPE_SERVICE_LABELS: Record<PipeService, string> = {
  'heating-flow': 'Heizung Vorlauf',
  'heating-return': 'Heizung Rücklauf',
  'hot-water': 'Trinkwasser warm',
  'cold-water': 'Trinkwasser kalt',
  circulation: 'Zirkulation',
  waste: 'Abwasser',
  refrigerant: 'Kältemittel',
  'ventilation-supply': 'Zuluft',
  'ventilation-exhaust': 'Abluft',
};

export const PIPE_SERVICE_COLORS: Record<PipeService, string> = {
  'heating-flow': '#F87171',
  'heating-return': '#60A5FA',
  'hot-water': '#FB923C',
  'cold-water': '#38BDF8',
  circulation: '#FBBF24',
  waste: '#A78BFA',
  refrigerant: '#C084FC',
  'ventilation-supply': '#34D399',
  'ventilation-exhaust': '#2DD4BF',
};

/**
 * Ein Leitungsabschnitt als Polylinie im Grundriss.
 *
 * Zweck ist der **Längenauszug**: wie viele Meter DN 20 gedämmt, wie viele
 * Meter DN 15 blank. Damit lässt sich die Rohrleitungslänge für den
 * hydraulischen Abgleich und die Massenermittlung übergeben, ohne im
 * Grundriss nachzumessen. Die Höhenlage steckt in `elevation` und in
 * `risesTo`: ein Strang, der ins nächste Geschoss geht, bekommt dort seine
 * Fortsetzung als eigener Abschnitt.
 */
export interface PipeRun {
  id: string;
  levelId: LevelId;
  service: PipeService;
  /** Stützpunkte im Grundriss [m], mindestens zwei. */
  points: Vec2[];
  /** Nennweite DN [mm]. */
  nominalDiameter: number;
  /** Dämmstärke [mm]; 0 = ungedämmt. */
  insulation: number;
  /** Verlegehöhe über Fertigfußboden [m]. */
  elevation: number;
  /** Angebundene TGA-Objekte — Verteiler am Anfang, Verbraucher am Ende. */
  fromFixtureId?: string;
  toFixtureId?: string;
  label?: string;
  /** Von Hand gezogen oder vom Rohrausleger erzeugt? */
  generated?: boolean;
  /** Verlegeart, aus der dieser Abschnitt entstanden ist. */
  routing?: PipeRoutingMode;
  /** Lage des Abschnitts — maßgeblich für die Dämmpflicht nach Anlage 8 GEG. */
  surrounding?: PipeSurrounding;
  /** Volumenstrom [m³/h], mit dem der Abschnitt ausgelegt wurde. */
  designFlow?: number;
  /** Fließgeschwindigkeit [m/s] im Auslegungsfall. */
  velocity?: number;
  /** Spezifisches Druckgefälle [Pa/m]. */
  gradient?: number;
  /** Rohraußendurchmesser [mm] — die Kanalwahl in der Sanierung hängt daran. */
  outerDiameter?: number;
  /** Werkstoff des Abschnitts. */
  material?: PipeMaterial;
}

// ---------------------------------------------------------------------------
// Rohrnetz — automatische Auslegung
// ---------------------------------------------------------------------------

/**
 * Wie wird verlegt?
 *
 * Die Entscheidung fällt am Anfang und bestimmt alles Weitere: Trassenführung,
 * Verlegehöhe, zulässige Rohrdurchmesser, Dämmpflicht und die Bauteile, die
 * in den Massenauszug gehen.
 *
 * `neubau` — Leitungen auf der Rohdecke im Fußbodenaufbau, parallel zu den
 *   Wänden, quer durch den Raum, wo es der kürzere Weg ist. Anbindeleitungen
 *   gehören **nicht** in den Heizestrich, sondern darunter (DIN 18560-2; die
 *   Rohrüberdeckung des Heizestrichs gilt für die Heizrohre, nicht für
 *   Anbindeleitungen).
 * `sanierung` — Leitungen sichtbar an der Wand im Sockelleistenkanal. Der
 *   handelsübliche Kanal (40 × 105 mm) trägt Rohre bis 20 mm Außendurchmesser;
 *   die Trasse folgt zwangsläufig den Wänden und muss Türöffnungen umgehen.
 */
export type PipeRoutingMode = 'neubau' | 'sanierung';

/**
 * Wo liegt ein Leitungsabschnitt?
 *
 * Die Lage entscheidet über die Dämmpflicht nach Anlage 8 GEG — und zwar
 * schärfer, als man vermutet: „im Fußbodenaufbau" heißt **nicht** pauschal
 * 6 mm, und für unbeheizte Räume gibt es keine Ermäßigung, sondern die volle
 * Dicke.
 */
export type PipeSurrounding =
  /** In einem beheizten Raum desselben Nutzers. */
  | 'beheizt'
  /** In einem unbeheizten Raum — volle Dämmdicke, keine Ermäßigung. */
  | 'unbeheizt'
  /** Im Fußbodenaufbau. */
  | 'fussboden'
  /** In einem Bauteil zwischen beheizten Räumen verschiedener Nutzer. */
  | 'zwischen-nutzern'
  /** An Außenluft grenzend — doppelte Dämmdicke. */
  | 'aussenluft'
  /** Wand- oder Deckendurchbruch, Kreuzung, Verbindungsstelle, Verteiler. */
  | 'durchbruch';

/** Art einer Armatur am Rohrnetz. */
export type PipeAccessoryKind =
  | 'shutoff'
  | 'thermostatic-valve'
  | 'lockshield'
  | 'balancing-valve'
  | 'differential-pressure'
  | 'air-vent'
  | 'drain'
  | 'fixed-point'
  | 'expansion-bend'
  | 'tee'
  | 'elbow'
  | 'strainer';

/**
 * Eine Armatur oder ein Formstück am Rohrnetz.
 *
 * Sie sitzt auf einem Abschnitt an einer Stelle, die aus der Trasse folgt:
 * das T-Stück am Abzweig, der Bogen am Richtungswechsel, die Entlüftung am
 * Hochpunkt, die Entleerung am Tiefpunkt. Anders als die Bauteile im
 * Anlagenschema hat sie eine **Lage im Grundriss**.
 */
export interface PipeAccessory {
  id: string;
  kind: PipeAccessoryKind;
  levelId: LevelId;
  /** Lage im Grundriss [m]. */
  position: Vec2;
  /** Verlegehöhe über Fertigfußboden [m]. */
  elevation: number;
  /** Zugehöriger Leitungsabschnitt. */
  runId?: string;
  /** Klartext für Plan und Massenauszug. */
  label: string;
  /** Technische Angabe — DN, Einstellwert, Werkstoff. */
  spec?: string;
  /** Warum diese Armatur hier sitzt — Regel oder Norm. */
  reason?: string;
  generated?: boolean;
}

/** Zusammengefasste Leitungslängen für den Massenauszug. */
export interface PipeScheduleEntry {
  service: PipeService;
  nominalDiameter: number;
  insulation: number;
  /** Trassenlänge im Grundriss [m]. */
  length: number;
  /** Zahl der Abschnitte. */
  runs: number;
}

export interface PipeSegment {
  runId: string;
  length: number;
  nominalDiameter: number;
  insulation: number;
  service: PipeService;
  /**
   * Werkstoff der Leitung, aus der der Abschnitt stammt.
   *
   * Bis 1.11.0 rechnete der Abgleich jeden Abschnitt in dem Werkstoff nach,
   * der ihm als Vorgabe übergeben wurde — meist Kupfer —, während der
   * Rohrausleger in Verbundrohr auslegte. Bei R ~ d⁻⁴·⁷⁵ ist das ein
   * systematischer Fehler, den keine Prüfung sieht. Steht der Werkstoff am
   * Abschnitt, gilt er.
   */
  material?: PipeMaterial;
  /** Tatsächlicher Außendurchmesser [mm], wenn bekannt. */
  outerDiameter?: number;
  /**
   * Richtungswechsel am Anfang des Abschnitts [-].
   *
   * Jeder innere Stützpunkt der gezeichneten Polylinie ist im gebauten
   * Zustand ein Bogen. Der erste Abschnitt einer Leitung hat keinen — davor
   * ist nichts, was die Richtung wechseln könnte.
   */
  bends?: number;
  /**
   * Armaturen auf diesem Abschnitt, nach Bauart.
   *
   * Sie stammen aus `doc.pipeAccessories` und ersetzen den pauschalen
   * ζ-Zuschlag durch die Widerstandsbeiwerte der tatsächlich gesetzten
   * Bauteile.
   */
  accessories?: PipeAccessoryKind[];
}

export interface PipePath {
  fixtureId: string;
  fixtureType: string;
  label: string;
  roomId?: string;
  levelId: string;
  /** Quelle, von der aus der Weg gefunden wurde. */
  sourceFixtureId: string;
  sourceLabel: string;
  /** Einfache Trassenlänge bis zur Quelle [m]. */
  routeLength: number;
  /** Hin und zurück [m] — die Länge, über die der Druckverlust entsteht. */
  circuitLength: number;
  /** Höhenversatz Quelle → Verbraucher [m], Geschosslage eingerechnet. */
  elevationChange: number;
  /** Kleinste Nennweite auf dem Weg [mm] — der Engpass. */
  minimumDiameter: number;
  /** Abschnitte in Fließrichtung von der Quelle zum Verbraucher. */
  segments: PipeSegment[];
}

export interface PipeNetworkReport {
  paths: PipePath[];
  /** Verbraucher ohne Weg zu einer Quelle — der häufigste Planungsfehler. */
  unconnected: { fixtureId: string; label: string; levelId: string; reason: string }[];
  /** Quellen im Modell. */
  sources: { fixtureId: string; label: string; levelId: string; consumers: number }[];
  /** Der längste Weg — er bestimmt die Pumpe. */
  worstPath?: { fixtureId: string; label: string; circuitLength: number };
  /** Verbundene Geschosse über Steigstränge. */
  risers: number;
}


// ===========================================================================
// Außenanlage und Wärmepumpe
// ===========================================================================

/**
 * Gebietstyp nach BauNVO — er entscheidet über die zulässigen Geräusche.
 * Die Immissionsrichtwerte stehen in TA Lärm Nr. 6.1.
 */
export type AreaCategory = 'GI' | 'GE' | 'MU' | 'MK' | 'MD' | 'MI' | 'WA' | 'WS' | 'WR' | 'KUR';

export const AREA_CATEGORY_LABELS: Record<AreaCategory, string> = {
  GI: 'Industriegebiet',
  GE: 'Gewerbegebiet',
  MU: 'Urbanes Gebiet',
  MK: 'Kerngebiet',
  MD: 'Dorfgebiet',
  MI: 'Mischgebiet',
  WA: 'Allgemeines Wohngebiet',
  WS: 'Kleinsiedlungsgebiet',
  WR: 'Reines Wohngebiet',
  KUR: 'Kurgebiet, Krankenhaus',
};

/** Aufstellsituation — sie bestimmt das Raumwinkelmaß K0 (VDI 2714). */
export type MountingSituation = 'free' | 'wall' | 'corner' | 'niche';

export const MOUNTING_LABELS: Record<MountingSituation, string> = {
  free: 'frei im Garten',
  wall: 'vor einer Wand',
  corner: 'in einer Ecke',
  niche: 'in einer Nische, überdacht',
};

/** Wärmequelle der Anlage. */
export type HeatSourceKind = 'air' | 'brine-borehole' | 'brine-collector' | 'groundwater';

export const HEAT_SOURCE_LABELS: Record<HeatSourceKind, string> = {
  air: 'Außenluft',
  'brine-borehole': 'Erdwärmesonde',
  'brine-collector': 'Flächenkollektor',
  groundwater: 'Grundwasser',
};

/** Untergrund für die spezifische Entzugsleistung (VDI 4640 Blatt 2). */
export type SoilKind = 'dry' | 'normal' | 'conductive' | 'saturated';

export const SOIL_LABELS: Record<SoilKind, string> = {
  dry: 'trocken, sandig',
  normal: 'normal, bindig-feucht',
  conductive: 'Festgestein, gut leitend',
  saturated: 'wassergesättigter Sand/Kies',
};

/** Wasserschutzgebietszone — entscheidet über Erdwärme ja/nein. */
export type WaterProtectionZone = 'none' | 'I' | 'II' | 'III' | 'IIIA' | 'IIIB';

/**
 * Die Wärmepumpe als Objekt im Außengelände.
 *
 * Sie steht bewusst nicht in der TGA-Bibliothek: ihre Aufstellung ist kein
 * Symbol im Grundriss, sondern eine Standortfrage mit drei voneinander
 * unabhängigen Randbedingungen — Schall, Sicherheitsabstand, Bauordnung.
 */
export interface HeatPump {
  id: string;
  label: string;
  source: HeatSourceKind;
  /** Bauform. Bei `split` steht außen nur der Verflüssiger. */
  form: 'monoblock-outdoor' | 'split' | 'indoor';
  /** Aufstellpunkt im Modellraum [m]. Bei Innenaufstellung ohne Bedeutung. */
  position: Vec2;
  /** Ausblasrichtung als Azimut [°] — 0 = Nord, im Uhrzeigersinn. */
  azimuth: number;
  /** Grundriss der Außeneinheit [m]. */
  width: number;
  depth: number;
  height: number;
  /** Aufstellhöhe der Unterkante über Gelände [m] — Schnee und Kondensat. */
  standHeight: number;
  /** Aufstellsituation für das Raumwinkelmaß. */
  mounting: MountingSituation;
  /**
   * Schallleistungspegel im lautesten Betriebszustand [dB(A)]. Maßgeblich ist
   * nicht der Wert vom Energielabel, sondern der höchste, der nachts auftritt.
   */
  soundPower: number;
  /** Schallleistungspegel im abgesenkten Nachtbetrieb [dB(A)], falls garantiert. */
  soundPowerNight?: number;
  /** Nachtabsenkung wird zwangsweise aktiviert — nur dann darf sie zählen. */
  nightModeGuaranteed: boolean;
  /** Tonhaltigkeitszuschlag K_T [dB] — 0, wenn der Hersteller nichts ausweist. */
  toneSurcharge: number;
  /** Kältemittel und Füllmenge. */
  refrigerant: 'R290' | 'R32' | 'R410A' | 'R744' | 'andere';
  refrigerantMass: number;
  /**
   * Radius des Schutzbereichs um das Gerät [m] (nur brennbare Kältemittel).
   * Herstellerangabe — es gibt dafür keine Normtabelle.
   */
  protectionRadius: number;
  /** Heizleistung im Auslegungspunkt [kW]. */
  heatingCapacity: number;
  /** Betriebspunkt, auf den sich die Leistung bezieht, z. B. „A-7/W35". */
  ratingPoint: string;
  /** Leistungszahl im Auslegungspunkt. */
  cop: number;
  /** Betriebsweise. */
  operation: 'monovalent' | 'mono-energetic' | 'bivalent-parallel' | 'bivalent-alternative';
  /** Bivalenzpunkt [°C]. */
  bivalencePoint: number;
  /** Leistung des zweiten Wärmeerzeugers [kW]. */
  backupCapacity: number;
  /** Auslegungs-Vorlauftemperatur [°C]. */
  flowTemperature: number;
  /** Sperrzeit-Regime nach §14a EnWG bzw. altes EVU-Modell. */
  gridRegime: 'none' | 'evu-3x2h' | 'p14a-dimming';
  /** Summe der Sperrstunden je Tag [h] — für den Sperrzeitfaktor. */
  blockedHours: number;
  /** Trinkwarmwasser über die Wärmepumpe? Zuschlag je Person [kW]. */
  domesticHotWater: boolean;
  occupants: number;
}

/** Art eines Objekts im Außengelände. */
export type SiteElementKind =
  | 'boundary'
  | 'neighbour-building'
  | 'immission-point'
  | 'hazard-opening'
  | 'tree'
  | 'borehole'
  | 'collector'
  | 'trench'
  | 'well-supply'
  | 'well-injection'
  | 'utility-line'
  | 'paved';

export const SITE_ELEMENT_LABELS: Record<SiteElementKind, string> = {
  boundary: 'Grundstücksgrenze',
  'neighbour-building': 'Nachbargebäude',
  'immission-point': 'Immissionsort',
  'hazard-opening': 'Öffnung / Schacht / Ablauf',
  tree: 'Baum',
  borehole: 'Erdwärmesonde',
  collector: 'Flächenkollektor',
  trench: 'Grabenkollektor',
  'well-supply': 'Förderbrunnen',
  'well-injection': 'Schluckbrunnen',
  'utility-line': 'Ver-/Entsorgungsleitung',
  paved: 'Befestigte Fläche',
};

/**
 * Ein Objekt im Außengelände.
 *
 * Punkte, Linien und Flächen in einer Struktur: `points` trägt einen Punkt,
 * einen Zug oder ein Polygon — welches davon, sagt die Art. Eine eigene
 * Klasse je Art wäre sauberer und in der Bedienung schwerfälliger.
 */
export interface SiteElement {
  id: string;
  kind: SiteElementKind;
  label?: string;
  points: Vec2[];
  /** Tiefe unter Gelände [m] — Sonde, Kollektor, Leitung, Brunnen. */
  depth?: number;
  /** Radius [m] — Baumkrone, Schachtöffnung. */
  radius?: number;
  /** Höhe über Gelände [m] — Nachbargebäude. */
  height?: number;
  /** Art der Leitung, wenn `utility-line`. */
  utility?: 'water' | 'sewer' | 'district-heating' | 'gas' | 'power' | 'telecom';
  /** Rohrabstand im Kollektor [m]. */
  pipeSpacing?: number;
  /** Bei Immissionsorten: gilt hier ein anderer Gebietstyp? */
  areaCategory?: AreaCategory;
  /** Freitext — was der Planer sich notiert hat. */
  note?: string;
}

/** Das Grundstück und alles, was darauf steht. */
export interface SitePlan {
  /** Gebietstyp für die Immissionsrichtwerte. */
  areaCategory: AreaCategory;
  /** Bundesland — die Abstandsregeln der Bauordnung sind Ländersache. */
  state: string;
  /**
   * Bodenart des Baugrunds.
   *
   * Sie wird zweimal gebraucht und deshalb einmal erfasst: für die
   * spezifische Entzugsleistung der Wärmequelle (VDI 4640 Blatt 2) und als
   * Eingangsgröße der Erdreichrechnung nach DIN EN ISO 13370. Die
   * Wärmeleitfähigkeit λ steht hier bewusst nicht daneben — ihre Tabelle
   * gehört zur Norm und ist nicht frei zitierbar; die Bodenart benennt nur,
   * welche Zeile gemeint ist.
   */
  soil: SoilKind;
  /** Wasserschutzgebietszone am Standort. */
  waterProtection: WaterProtectionZone;
  /** Fließrichtung des Grundwassers als Azimut [°]. */
  groundwaterAzimuth?: number;
  /**
   * Grundwasserstand als Tiefe unter Geländeoberkante [m].
   *
   * Er ist die Größe, die die Korrektur G_w nach DIN EN ISO 13370 überhaupt
   * erst auslöst: liegt der Spiegel dicht unter der Sohle, leitet der
   * gesättigte Boden deutlich mehr ab als der trockene darüber. Ohne Angabe
   * bleibt das Feld leer — „nicht erfasst" ist eine Auskunft, eine geratene
   * Tiefe wäre keine. Bezugshöhe ist `ProjectMeta.terrainElevation`, positiv
   * nach unten.
   */
  groundwaterDepth?: number;
  /** Jahresbetriebsstunden der Wärmequelle: 1800 ohne, 2400 mit Warmwasser. */
  sourceRunHours: 1800 | 2400;
  elements: Record<string, SiteElement>;
  pumps: Record<string, HeatPump>;
}

// ===========================================================================
// Plangrafik — freie Maßketten und Beschriftungen
// ===========================================================================

export type AnnotationKind = 'dimension' | 'text' | 'leader';

export const ANNOTATION_LABELS: Record<AnnotationKind, string> = {
  dimension: 'Maßkette',
  text: 'Beschriftung',
  leader: 'Hinweis mit Fahne',
};

/**
 * Eine Planbeschriftung: freie Maßkette, Text oder Hinweisfahne.
 *
 * Bewusst *eine* Entität für alle drei: sie unterscheiden sich nur darin,
 * wie sie gezeichnet werden, nicht darin, was sie sind — Grafik auf dem
 * Plan, ohne jede Wirkung auf die Berechnung. Genau deshalb stehen sie auch
 * nicht in der Geometrie, sondern in einem eigenen Block.
 */
export interface Annotation {
  id: string;
  kind: AnnotationKind;
  levelId: LevelId;
  /**
   * Bezugspunkte. Maßkette: Anfang und Ende. Text: ein Punkt. Hinweis:
   * Fahnenspitze und Textpunkt.
   */
  points: Vec2[];
  /** Versatz der Maßlinie quer zur Messrichtung [m]; positiv = links. */
  offset: number;
  /** Freier Text. Bei der Maßkette überschreibt er das gemessene Maß. */
  text?: string;
  /** Schriftgröße relativ (1 = normal). */
  scale: number;
}

export type ToolId =
  | 'select'
  | 'wall'
  | 'room'
  | 'door'
  | 'window'
  | 'passage'
  | 'fixture'
  | 'stair'
  | 'shaft'
  | 'solid'
  | 'pipe'
  | 'annotation'
  | 'site'
  | 'heatpump'
  | 'dimension'
  | 'calibrate'
  | 'pan';

export type ViewMode = '2d' | '3d' | 'split' | 'schema';
export type CameraMode = 'orbit' | 'iso' | 'top';

export interface SnapSettings {
  /** Raster-Snapping aktiv. */
  grid: boolean;
  /** Rasterweite [m]. */
  gridSize: number;
  /** Fang auf bestehende Knotenpunkte. */
  nodes: boolean;
  /** Fang auf Wandachsen (Punkt auf Linie). */
  walls: boolean;
  /** Winkelrasterung 0/45/90 relativ zum Startpunkt. */
  angle: boolean;
  /** Winkelschritt [°]. */
  angleStep: number;
  /** Fangradius in Bildschirm-Pixeln (zoom-unabhängig gedacht). */
  pixelTolerance: number;
}

/** Ergebnis einer Snapping-Auswertung — trägt seine eigene Begründung. */
export interface SnapResult {
  point: Vec2;
  kind: 'free' | 'grid' | 'node' | 'wall' | 'angle' | 'extension';
  /** Getroffener Knoten, falls `kind === 'node'`. */
  nodeId?: NodeId;
  /** Getroffene Wand, falls `kind === 'wall'`. */
  wallId?: WallId;
  /** Für das HUD: gerasteter Winkel [°]. */
  angleDeg?: number;
}

export type SelectionKind =
  | 'node'
  | 'wall'
  | 'opening'
  | 'room'
  | 'trace'
  | 'image'
  | 'fixture'
  | 'vertical'
  | 'solid'
  | 'pipe'
  | 'annotation'
  | 'roofOpening'
  | 'site'
  | 'heatpump';

export interface Selection {
  kind: SelectionKind;
  id: string;
}

/** 2D-Viewport: Modellraum → Bildschirm. */
export interface Viewport {
  /** Bildschirmpixel pro Meter. */
  zoom: number;
  /** Modellpunkt, der auf die Canvas-Mitte fällt. */
  center: Vec2;
}

// ===========================================================================
// Projekt & Dokument
// ===========================================================================

export interface ProjectMeta {
  name: string;
  address?: string;
  client?: string;
  /** ISO-8601. */
  createdAt: string;
  modifiedAt: string;
  /** Nordabweichung des Grundrisses [°], CCW positiv. 0 = +y zeigt nach Norden. */
  northAngle: number;
  /** Norm-Außentemperatur θ_e [°C] am Standort (DIN EN 12831 Beiblatt 1). */
  designOutdoorTemperature: number;
  /** Standard-Innentemperatur [°C]. */
  designIndoorTemperature: number;
  /**
   * Luftdichtheit n50 [1/h] aus dem Blower-Door-Test bzw. der Annahme.
   * Geht über die Infiltration direkt in den Lüftungswärmeverlust ein.
   */
  n50: number;
  /** Abschirmungsklasse des Gebäudes (DIN EN 12831 Tab. B.5). */
  shielding: 'none' | 'moderate' | 'high';
  /** Temperatur unbeheizter angrenzender Bereiche θ_u [°C]. */
  unheatedTemperature: number;
  /** Erdreichtemperatur bzw. Jahresmittel der Außentemperatur [°C]. */
  groundTemperature: number;
  /**
   * Geländeoberkante [m] — dieselbe Bezugshöhe wie `Level.elevation`.
   *
   * Aus ihr allein folgt, welcher Teil eines Bauteils im Erdreich steckt: was
   * unter dieser Höhe liegt, grenzt an Erdreich, was darüber liegt, an
   * Außenluft. Das ist der Grund, warum hier eine Höhe steht und nicht am
   * Geschoss ein Häkchen „ist Keller": ein Hanggrundstück hat dieselbe Wand
   * an der Bergseite tief im Erdreich und an der Talseite frei — ein Häkchen
   * kann das nicht abbilden, eine Bezugshöhe schon.
   *
   * Ohne Angabe wird **nichts** als erdberührt gerechnet. Das ist Absicht:
   * ein Bestandsprojekt, das diese Höhe nicht kennt, muss sich exakt so
   * verhalten wie vor ihrer Einführung. Fehlt sie, obwohl ein Geschoss unter
   * dem Bezugsniveau liegt, meldet das die Modellprüfung.
   */
  terrainElevation?: number;
  /** Pauschaler Wärmebrückenzuschlag ΔU_WB [W/(m²·K)]. */
  thermalBridgeSupplement: number;
  /**
   * Wie Wärmebrücken angesetzt werden. `flat` legt ΔU_WB auf jede Hüllfläche,
   * `detailed` bilanziert stattdessen die Anschlusslängen mit ihren ψ-Werten.
   * Beides zusammen wäre doppelt gezählt — deshalb eine Entscheidung, kein
   * Nebeneinander.
   */
  thermalBridgeMethod: 'flat' | 'detailed';
  /**
   * Kategorie der Planungsbeispiele nach DIN 4108 Beiblatt 2. Sie legt den
   * pauschalen Zuschlag fest: ohne Nachweis 0,10, Kategorie A 0,05,
   * Kategorie B 0,03 W/(m²·K). `custom` lässt den Wert frei.
   */
  thermalBridgeCategory: 'none' | 'A' | 'B' | 'custom';
  /** Abweichende ψ-Werte je Anschlussart [W/(m·K)]. Fehlt: Vorgabekatalog. */
  thermalBridgeCatalogue?: ThermalBridgeCatalogue;
  /**
   * Wiederaufheizfaktor f_RH [W/m²] für Absenkbetrieb. 0 = keine
   * Zusatzaufheizleistung; das ist in Deutschland der Regelfall.
   */
  reheatFactor: number;
  /** Randbedingungen des Absenkbetriebs — Eingangsdaten, keine Rechnung. */
  setback?: SetbackOperation;
  /** Lüftungsanlage des Gebäudes. Fehlt sie, wird frei gelüftet. */
  ventilation?: VentilationSystem;
  /**
   * Spur des letzten Schreibvorgangs der Gegenstelle.
   *
   * Wenn ein zweites Programm in dieses Modell schreiben darf, muss am Modell
   * stehen, dass es das getan hat. Ohne diese Spur erklärt niemand mehr, warum
   * eine Solltemperatur plötzlich 24 °C ist, die niemand hier eingetragen hat.
   */
  lastHostPatch?: HostPatchTrace;
}

/** Was von einem Schreibvorgang der Gegenstelle im Modell zurückbleibt. */
export interface HostPatchTrace {
  /** Zeitpunkt (ISO-8601). */
  at: string;
  /** Absender, wie er sich genannt hat, z. B. „RaVia 3.2". */
  source: string;
  applied: number;
  rejected: number;
  unchanged: number;
  /** Ein Satz im Klartext, so wie er in der Statuszeile steht. */
  summary: string;
}

/**
 * Lüftungsanlage. In einem dichten Neubau entscheidet sie über einen guten
 * Teil der Heizlast: ohne Wärmerückgewinnung geht die gesamte Zuluft mit
 * Außentemperatur ein, mit 80 % Rückgewinnung nur noch ein Fünftel davon.
 * Ohne diese Angabe müsste die Gegenstelle raten — und zwar um den Faktor 5.
 */
export interface VentilationSystem {
  /**
   * `none` = freie Lüftung, `exhaust` = reine Abluftanlage (Zuluft strömt
   * durch Außenwandventile nach), `balanced` = Zu- und Abluft mit Gerät.
   */
  kind: 'none' | 'exhaust' | 'balanced';
  /**
   * Wärmerückgewinnungsgrad η [-], nur bei `balanced` wirksam. Er wirkt
   * unmittelbar: der wirksame Zuluftstrom ist V̇_zu · (1 − η).
   */
  heatRecovery: number;
  /** Dauerbetrieb oder bedarfsgeführt — reine Angabe für die Gegenstelle. */
  operation: 'continuous' | 'demand';
  /** Frostschutz-Vorwärmung der Zuluft [°C], falls vorhanden. */
  preheatTemperature?: number;
}

/**
 * Rolle eines Raums im Lüftungskonzept. Zuluft in Aufenthaltsräume, Abluft
 * aus Feuchte- und Geruchsräumen, dazwischen strömt es über — die
 * Grundordnung jeder Wohnungslüftung.
 */
export type VentilationRole = 'supply' | 'exhaust' | 'transfer' | 'none';

export const VENTILATION_ROLE_LABELS: Record<VentilationRole, string> = {
  supply: 'Zuluftraum',
  exhaust: 'Abluftraum',
  transfer: 'Überströmraum',
  none: 'ohne Lüftung',
};

/**
 * Absenkbetrieb. Die Zusatz-Aufheizleistung selbst rechnet RaVia; hier werden
 * nur ihre Eingangsgrößen erfasst. Der Wiederaufheizfaktor f_RH kommt aus
 * einer Tabelle der jeweils geltenden Norm — in Deutschland ist er national
 * auf 0 gesetzt, deshalb steht er hier auch nicht fest verdrahtet drin,
 * sondern bleibt eine Eingabe.
 */
export interface SetbackOperation {
  /** Wird überhaupt abgesenkt? */
  active: boolean;
  /** Dauer der Absenkung t_Abs [h]. */
  hours: number;
  /** Vorgesehene Wiederaufheizzeit t_RH [h]. */
  reheatHours: number;
  /** Luftwechsel während der Absenkung n_Abs [1/h]. */
  airChangeRate: number;
  /**
   * Bauart als wirksame Speicherfähigkeit c_wirk [Wh/(m³·K)]. Sie bestimmt
   * die Zeitkonstante des Gebäudes und damit, wie weit die Temperatur in der
   * Absenkzeit überhaupt fällt.
   */
  massClass: 'light' | 'medium' | 'heavy';
}

/** ψ-Werte je Anschlussart [W/(m·K)]. */
export type ThermalBridgeCatalogue = Partial<Record<ThermalBridgeKind, number>>;

/** Anschlussarten, deren Längen sich aus dem Modell ableiten lassen. */
export type ThermalBridgeKind =
  | 'building-corner'
  | 'interior-wall'
  | 'window-reveal'
  | 'window-lintel'
  | 'window-sill'
  | 'base'
  | 'floor-slab'
  | 'eaves'
  | 'verge';

/** Eine Anschlussart mit ihrer Länge in einem Raum. */
export interface RoomThermalBridge {
  kind: ThermalBridgeKind;
  label: string;
  /** Längenbezogener Wärmedurchgangskoeffizient ψ [W/(m·K)]. */
  psi: number;
  /** Aus der Geometrie abgeleitete Anschlusslänge [m]. */
  length: number;
  /** ψ · l [W/K]. */
  heatLossCoefficient: number;
  /** Herkunft des ψ-Werts — ein Vorgabewert ist kein Nachweis. */
  source: 'default' | 'user';
}

/** Der vollständige, serialisierbare Dokumentzustand. */
export interface BimDocument {
  meta: ProjectMeta;
  levels: Record<LevelId, Level>;
  layers: Record<LayerId, Layer>;
  nodes: Record<NodeId, BimNode>;
  walls: Record<WallId, Wall>;
  openings: Record<OpeningId, Opening>;
  fixtures: Record<string, Fixture>;
  verticals: Record<string, VerticalElement>;
  /**
   * Massive Bauteile ohne Raumfunktion. Optional, damit ein Dokument aus einer
   * älteren Fassung oder aus dem Import ohne dieses Feld gültig bleibt.
   */
  solids?: Record<string, SolidElement>;
  pipes: Record<string, PipeRun>;
  /** Armaturen und Formstücke am Rohrnetz — vom Rohrausleger erzeugt. */
  pipeAccessories?: Record<string, PipeAccessory>;
  annotations: Record<string, Annotation>;
  roofOpenings: Record<string, RoofOpening>;
  constructions: Record<string, Construction>;
  /** Außengelände: Grundstück, Wärmepumpe, Wärmequelle. */
  site: SitePlan;
  /** Anlagentechnik: Erzeuger, Speicher, Verteilung, Sicherheitsarmaturen. */
  plant: PlantDefinition;
  /** Abgeleitet — wird von der Raumerkennung neu berechnet, nie manuell gepflegt. */
  rooms: Record<RoomId, Room>;
  /**
   * Abgeleitete Prüfergebnisse. `openEnds` sind Wandenden ohne Anschluss —
   * die häufigste Ursache dafür, dass ein Raum nicht erkannt wird. Sie
   * werden im Plan als Warnpunkt eingeblendet.
   *
   * `closure` ist die vollständigere Auskunft derselben Prüfung: sie benennt
   * auch die Stellen, an denen *jedes* Wandende einen Anschluss hat und
   * trotzdem ein Wandstück fehlt. Diese Befunde stehen hier und nicht nur im
   * Prüfbericht, weil sie im Plan gezeichnet werden — eine Lücke, die man
   * nicht sieht, sucht man an der falschen Stelle. Optional, damit ein
   * Dokument aus einer älteren Fassung oder aus dem Import ohne dieses Feld
   * weiterhin gültig ist.
   */
  diagnostics: { openEnds: Vec2[]; closure?: ClosureIssue[] };
  activeLevelId: LevelId;
  image?: FloorplanImage;
}

// ===========================================================================
// RaVia / TGA-Export (DIN EN 12831)
// ===========================================================================

/** Öffnungs-Datensatz, wie ihn die Heizlastberechnung erwartet. */
export interface ExportOpening {
  id: string;
  kind: OpeningKind;
  width: number;
  height: number;
  area: number;
  sillHeight: number;
  orientation: Orientation;
  azimuth: number;
  uValue: number;
  gValue?: number;
  /** Name des zugewiesenen Bauteilaufbaus. */
  construction?: string;
  constructionId?: string;
}

/**
 * Ein Hüllbauteil des Raums — Wand, Boden oder Decke. Bewusst *eine* Struktur
 * für alle drei: die Transmissionsrechnung behandelt sie identisch
 * (A · U · f), und eine einheitliche Liste erspart der Gegenseite jede
 * Sonderbehandlung.
 */
/**
 * Kenngrößen einer erdberührten Hüllfläche.
 *
 * Die Transmission über eine erdberührte Fläche rechnet sich zwar wie jede
 * andere (A · U · f), aber der Temperatur-Korrekturfaktor f entsteht nicht
 * aus einer Temperaturdifferenz allein: nach DIN EN 12831-1 gehen dort die
 * Faktoren f_g1, f_g2 und der Grundwassereinfluss G_w ein, und die hängen
 * am charakteristischen Bodenmaß B′ und an der Einbindetiefe. Diese Faktoren
 * stehen in einer kostenpflichtigen Norm; sie werden hier nicht nachgebaut.
 *
 * Geliefert werden stattdessen die **Eingangsgrößen**, aus denen die
 * Gegenstelle sie bildet: Fläche (`netArea` der Fläche), Einbindetiefe,
 * B′ (`ExportRoom.characteristicGroundDimension`) und die Erdreichtemperatur
 * (`neighbourTemperature`).
 */
export interface GroundContact {
  /**
   * Einbindetiefe z [m] — Tiefe der **Unterkante** des Bauteils unter der
   * Geländeoberkante.
   *
   * Warum Unterkante und nicht Flächenmitte: DIN EN ISO 13370, auf die
   * DIN EN 12831-1 für erdberührte Bauteile verweist, definiert z als die
   * Tiefe des Kellerfußbodens unter Geländeoberkante. Die Kennlinie für die
   * Kellerwand ist über die eingebundene Höhe bereits integriert — sie
   * erwartet also die Tiefe, bis zu der die Wand hinabreicht, nicht die
   * mittlere Tiefe ihrer Fläche. Wer die mittlere Tiefe braucht (Verfahren,
   * die mit einer Erdreichtemperatur in Flächenmitte rechnen), bildet sie
   * ohne weitere Angabe: `embedmentDepth − buriedHeight / 2`.
   */
  embedmentDepth: number;
  /**
   * Höhe des erdberührten Abschnitts [m]. Bei einer waagerechten Fläche
   * (Bodenplatte, Kellersohle) ist sie 0 — dort fallen Unterkante und
   * Flächenmitte zusammen.
   */
  buriedHeight: number;
}

export interface ExportSurface {
  id: string;
  kind: 'wall' | 'floor' | 'ceiling' | 'roof' | 'gable';
  /** Bauteilart der Wand; Boden, Decke und Dach tragen 'slab'. */
  component: WallType | 'slab';
  /** Nur für Wände. */
  length?: number;
  height?: number;
  thickness?: number;
  /** Neigung gegen die Horizontale [°]: 90 Wand, 0 Boden/Decke. */
  tilt: number;
  /** Nur für Wände: Himmelsrichtung der raumabgewandten Seite. */
  orientation?: Orientation;
  azimuth?: number;
  grossArea: number;
  /** Fläche abzüglich aller Öffnungen [m²] — Basis für Q_T. */
  netArea: number;
  uValue: number;
  /** Name des zugewiesenen Bauteilaufbaus — macht den U-Wert nachvollziehbar. */
  construction?: string;
  constructionId?: string;
  /** Wärmebrückenzuschlag ΔU_WB [W/(m²·K)] für dieses Bauteil. */
  thermalBridgeSupplement: number;
  boundary: BoundaryCondition;
  /**
   * Nur bei `boundary === 'ground'`: Einbindetiefe und eingebundene Höhe.
   * Fehlt der Block trotz `ground`, ist keine Geländeoberkante erfasst
   * (`project.terrainElevation`) — dann ist die Tiefe unbekannt und wird
   * nicht geraten.
   */
  groundContact?: GroundContact;
  /** Raum auf der anderen Seite, falls `boundary === 'adjacent-room'`. */
  neighbourRoomId?: string;
  /**
   * Temperatur auf der anderen Seite [°C]. Für `exterior` die Norm-Außen-
   * temperatur, für `ground` die Erdreichtemperatur, für `unheated` θ_u,
   * für `adjacent-room` die Solltemperatur des Nachbarraums. Damit lässt sich
   * der Temperatur-Korrekturfaktor ohne weitere Nachschlagearbeit bilden.
   */
  neighbourTemperature: number;
  openings: ExportOpening[];
}

/** Ein TGA-Objekt im Exportformat — direkt für Auslegung und Massenauszug. */
export interface ExportFixture {
  id: string;
  type: FixtureType;
  category: FixtureCategory;
  label: string;
  position: Vec2;
  rotation: number;
  length: number;
  elevation: number;
  params: FixtureParams;
}

export interface ExportRoom {
  id: string;
  name: string;
  usage: RoomUsage;
  level: string;
  area: number;
  height: number;
  /**
   * Kennwerte unter der Dachschräge. Nur gesetzt, wenn über dem Geschoss ein
   * geneigtes Dach liegt. `height` ist dann die *mittlere* lichte Höhe, das
   * Volumen stammt aus der Integration über die Grundfläche — nicht aus
   * Fläche × Höhe.
   */
  /** Grundfläche abzüglich Treppen-, Schacht- und Massivflächen [m²]. */
  netFloorArea?: number;
  /** Von Treppen, Schächten und massiven Bauteilen belegte Grundfläche [m²]. */
  floorOpeningArea?: number;
  /** Anteil davon, der auf massive Bauteile entfällt [m²] — siehe `solids`. */
  solidArea?: number;
  roof?: {
    pitch: number;
    kneeHeight: number;
    minHeight: number;
    maxHeight: number;
    averageHeight: number;
    slopedArea: number;
    flatCeilingArea: number;
    /** Wohnfläche nach WoFlV §4 [m²] — über 2,00 m voll, 1,00–2,00 m halb. */
    livingArea: number;
    areaBelow1m: number;
    /** Verglasung in der Dachfläche [m²]. */
    skylightArea: number;
    /** Zusätzliches Volumen durch Gauben [m³]. */
    dormerVolume: number;
  };
  volume: number;
  perimeter: number;
  setpointTemperature: number;
  /**
   * Hygienischer Mindestluftwechsel n_min [1/h] aus der Nutzung — **nicht**
   * die Infiltration. Deren Eingangsgrößen sind `ProjectMeta.n50`,
   * `ProjectMeta.shielding`, `exposedFacadeCount` und `levelElevation`.
   */
  airChangeRate: number;
  /** Aggregierte Fensterfläche je Himmelsrichtung [m²] — solare Gewinne. */
  windowAreaByOrientation: Partial<Record<Orientation, number>>;
  totalWindowArea: number;
  exteriorWallArea: number;
  /** Alle Hüllbauteile des Raums: Wände, Boden, Decke. */
  surfaces: ExportSurface[];
  polygon: Vec2[];
  /** Beheizt? Unbeheizte Räume sind Nachbarbereich, keine Lastquelle. */
  isHeated: boolean;
  /** Umfang mit Erdkontakt [m] — für B' = A/(0,5·P). */
  groundContactPerimeter: number;
  /**
   * Erdberührte Hüllfläche dieses Raums [m²] — Summe der `netArea` aller
   * Flächen mit `boundary === 'ground'`, also Kellerwände *und* Sohle.
   *
   * Sie steht hier, weil sie sonst jede Gegenstelle einzeln aus der
   * Flächenliste zusammensuchen müsste, und weil sie die Probe auf die
   * Wandaufteilung ist: erdberührter plus freistehender Anteil einer Wand
   * ergeben wieder deren Gesamtfläche.
   */
  groundContactArea: number;
  /** Charakteristisches Bodenmaß B' [m], bereits ausgerechnet. */
  characteristicGroundDimension: number;
  /** Zahl unterschiedlich orientierter Außenfassaden — Abschirmungsbeiwert. */
  exposedFacadeCount: number;
  /**
   * Mindestluftvolumenstrom n_min · V [m³/h]. Dieselbe Größe wie
   * `airChangeRate`, nur als Volumenstrom — nicht zu den Anlagenströmen in
   * `ventilation` addieren.
   */
  minimumAirflow: number;
  /**
   * Längenbezogene Wärmebrücken dieses Raums. Nur gesetzt, wenn das Projekt
   * auf `detailed` steht — sonst steckt der Zuschlag im U-Wert jeder Fläche
   * und hier stünde er ein zweites Mal.
   */
  thermalBridges?: RoomThermalBridge[];
  /** Σ ψ·l des Raums [W/K]. */
  thermalBridgeHeatLoss?: number;
  /**
   * Wärmeübertragende Hüllfläche dieses Raums [m²] — seine Außenwände brutto
   * plus Boden und Decke. Bezugsfläche von
   * `thermalBridgeEquivalentSupplement`; ohne sie ließe sich der Zuschlag
   * nicht in einen Leitwert zurückrechnen. Die Summe über alle Räume ist die
   * Hüllfläche in `ThermalBridgeTotals`.
   */
  thermalBridgeEnvelopeArea?: number;
  /**
   * Gleichwertiger pauschaler Zuschlag des Raums
   * ΔU_WB,äq = Σψ·l ÷ A_Hülle,Raum [W/(m²·K)] — dieselbe Definition wie
   * `ThermalBridgeTotals.equivalentSupplement`, nur je Raum.
   *
   * Für eine Gegenstelle gedacht, die nur katalogisierte Wärmebrücken kennt
   * und mit rohen ψ-Werten nichts anfangen kann: sie rechnet mit diesem
   * Zuschlag wie mit einem pauschalen und kommt raumweise auf denselben
   * Leitwert. Wie `thermalBridges` nur im Verfahren `detailed` gesetzt — im
   * pauschalen Verfahren steckt der Zuschlag bereits im
   * `thermalBridgeSupplement` jeder Fläche, und ein zweiter Wert daneben
   * lüde zur Doppelzählung ein. Fehlt das Feld, gibt es nichts umzurechnen.
   *
   * 0 bei einem Raum ohne Hüllfläche: dort gibt es keine Bezugsfläche, auf
   * die sich ein Zuschlag je m² beziehen könnte.
   */
  thermalBridgeEquivalentSupplement?: number;
  /** Lüftung des Raums — Rolle, Volumenströme, wirksame Zuluft. */
  ventilation: ExportRoomVentilation;
  /** Geschosshöhe über Gelände [m] — Höhenkorrekturfaktor der Lüftung. */
  levelElevation: number;
  /** Im Raum platzierte TGA-Objekte. */
  fixtures: ExportFixture[];
  /** Summe der installierten Heizleistung [W]. */
  installedHeatingPower: number;
  /** Zuluft-/Abluftvolumenstrom [m³/h] aus den platzierten Ventilen. */
  supplyAirflow: number;
  exhaustAirflow: number;
  /**
   * Von der Gegenstelle zurückgeschriebene Norm-Heizlast dieses Raums.
   *
   * Sie steht im Export, obwohl sie von dort kommt: der Export ist zugleich
   * die Projektdatei. Ohne dieses Feld wäre eine gerechnete Heizlast nach
   * Speichern und Öffnen weg — still, und das ist die schlimmste Art von
   * Datenverlust.
   */
  normHeatLoad?: RoomHeatLoad;
}

/** Ein vertikales Bauteil im Exportformat. */
export interface ExportVertical {
  id: string;
  kind: VerticalKind;
  name: string;
  level: string;
  toLevel?: string;
  area: number;
  width: number;
  length: number;
  steps?: number;
  service?: ShaftService;
  deductsArea: boolean;
  openToAbove: boolean;
  roomId?: string;
}

/**
 * Eingangsgrößen der Wärmebrücke eines massiven Bauteils an der Außenwand.
 *
 * Gerechnet wird sie hier nicht: der längenbezogene Wärmedurchgangskoeffizient
 * ψ eines Schornsteins in der Außenwand hängt an Aufbau, Zug und Dämmung und
 * steht in keiner frei zitierbaren Tabelle. Geliefert werden deshalb nur die
 * Größen, aus denen die Gegenstelle ψ · l bilden kann — Länge der Berührung
 * und die Kennungen der berührten Wände.
 */
export interface ExportSolidThermalBridge {
  /** Berührt das Bauteil mindestens eine Außenwand? */
  atExteriorWall: boolean;
  /** Länge der Berührung mit Außenwänden [m] — das l in ψ · l. */
  contactLength: number;
  /** Kennungen der berührten Außenwände. */
  wallIds: string[];
}

/** Ein massives Bauteil im Exportformat. */
export interface ExportSolid {
  id: string;
  kind: SolidKind;
  name: string;
  /** Geschoss, in dem das Bauteil steht bzw. beginnt. */
  level: string;
  /** Alle Geschosse, durch die es reicht — beim Schornstein mehrere. */
  levels: string[];
  /** Grundriss in Weltkoordinaten [m], ohne Wiederholung des Startpunkts. */
  outline: Vec2[];
  /** Grundfläche [m²]. */
  area: number;
  /** Umfang [m]. */
  perimeter: number;
  /** Höhe je Geschoss [m]. */
  height: number;
  /** Bauvolumen über alle durchlaufenen Geschosse [m³]. */
  volume: number;
  /** Baustoff im Klartext, falls erfasst. */
  material?: string;
  /** Raum, in dem das Bauteil in seinem Ausgangsgeschoss steht. */
  roomId?: string;
  thermalBridge: ExportSolidThermalBridge;
}

/** Ein Leitungsabschnitt im Exportformat. */
export interface ExportPipe {
  id: string;
  service: PipeService;
  level: string;
  nominalDiameter: number;
  insulation: number;
  elevation: number;
  /** Trassenlänge im Grundriss [m]. */
  length: number;
  points: Vec2[];
  fromFixtureId?: string;
  toFixtureId?: string;
  label?: string;
}

export interface ExportBuildingTotals {
  roomCount: number;
  netFloorArea: number;
  grossFloorArea: number;
  netVolume: number;
  exteriorWallArea: number;
  windowArea: number;
  /** Fensterflächenanteil an der Außenwandfläche [-]. */
  windowWallRatio: number;
  /** Hüllfläche/Volumen-Verhältnis A/V [1/m]. */
  compactness: number;
  /** Installierte Heizleistung über alle Räume [W]. */
  installedHeatingPower: number;
  /** Beheizte Räume und beheiztes Luftvolumen. */
  heatedRoomCount: number;
  heatedVolume: number;
  /** Anzahl platzierter TGA-Objekte je Gewerk. */
  fixtureCount: Record<FixtureCategory, number>;
  /** Wärmebrücken über alle Räume — Verfahren, Bilanz und Gegenprobe. */
  thermalBridges: ThermalBridgeTotals;
  /** Absenkbetrieb: Eingangsgrößen und die daraus ableitbaren Größen. */
  setback?: SetbackTotals;
  /** Lüftungsanlage und Luftbilanz des Gebäudes. */
  ventilation: VentilationTotals;
}

export interface VentilationTotals {
  kind: 'none' | 'exhaust' | 'balanced';
  /**
   * Wärmerückgewinnungsgrad η [-] der Anlage. Nur bei `kind === 'balanced'`
   * von 0 verschieden — eine reine Abluftanlage hat nichts, woraus sie
   * zurückgewinnen könnte. Er ist bereits in
   * `effectiveSupplyAirflow` eingerechnet und steht hier für den, der lieber
   * selbst rechnet; beides zusammen wäre doppelt abgezogen.
   */
  heatRecovery: number;
  operation: 'continuous' | 'demand';
  preheatTemperature?: number;
  /**
   * Summen der im Plan platzierten Ventile über alle Räume [m³/h] — der
   * Anlagenstrom des Gebäudes. Der hygienische Mindeststrom steht je Raum
   * (`ExportRoom.minimumAirflow`) und wird zu diesen Werten nicht addiert.
   */
  supplyAirflow: number;
  exhaustAirflow: number;
  /**
   * Summe der Überströmelemente [m³/h]. Sie ist der Grund, warum sich die
   * Außenluftmenge des Gebäudes nicht aus den Abluftmengen der einzelnen
   * Räume aufaddieren lässt: diese Luft wurde als Zuluft schon einmal
   * erwärmt und wandert nur weiter.
   */
  transferAirflow: number;
  /** Σ V̇_zu · (1 − η) [m³/h]. */
  effectiveSupplyAirflow: number;
  /**
   * Zuluft − Abluft [m³/h]. Eine ausgeglichene Anlage steht bei 0; jede
   * Abweichung bedeutet, dass die Differenz durch die Gebäudehülle geht —
   * ungeplant und ungewärmt.
   */
  balance: number;
  /** Zahl der Räume je Rolle. */
  roomsByRole: Record<VentilationRole, number>;
}

export interface ThermalBridgeTotals {
  method: 'flat' | 'detailed';
  category: 'none' | 'A' | 'B' | 'custom';
  /** Pauschaler Zuschlag ΔU_WB [W/(m²·K)]. */
  supplement: number;
  /** Wärmeübertragende Hüllfläche [m²] — Bezugsfläche des Zuschlags. */
  envelopeArea: number;
  /** Σ ψ·l über alle Räume [W/K]. */
  detailedHeatLoss: number;
  /** ΔU_WB · Hüllfläche [W/K]. */
  flatHeatLoss: number;
  /**
   * Σ ψ·l ÷ Hüllfläche [W/(m²·K)] — der pauschale Zuschlag, der dieselbe
   * Bilanz ergäbe. Die einzige Zahl, an der sich ablesen lässt, ob die
   * gewählte Pauschale für dieses Gebäude passt.
   */
  equivalentSupplement: number;
  /** Anschlusslänge je Art über alle Räume [m]. */
  lengthsByKind: Partial<Record<ThermalBridgeKind, number>>;
}

/**
 * Alles Eingangsdaten bis auf die abgeleiteten Größen — die
 * Zusatz-Aufheizleistung selbst rechnet RaVia.
 */
export interface SetbackTotals {
  active: boolean;
  hours: number;
  reheatHours: number;
  airChangeRate: number;
  massClass: 'light' | 'medium' | 'heavy';
  /** Wirksame Speicherfähigkeit c_wirk [Wh/(m³·K)] aus der Bauart. */
  effectiveHeatCapacity: number;
  /** Wärmeverlustkoeffizient während der Absenkung H_Abs [W/K]. */
  heatLossCoefficient: number;
  /** Zeitkonstante τ = c_wirk · V / H_Abs [h]. */
  timeConstant: number;
  /**
   * Temperaturabfall in der Absenkzeit
   * ΔΘ_RH = (Θ_int − Θ_e) · (1 − e^(−t_Abs/τ)) [K].
   */
  temperatureDrop: number;
  /** Vorgegebener Wiederaufheizfaktor f_RH [W/m²]. */
  reheatFactor: number;
  /** A_Boden · f_RH [W] — 0, solange kein f_RH vorgegeben ist. */
  reheatPower: number;
}

/**
 * Lüftung eines Raums im Export.
 *
 * Die Felder beschreiben denselben Luftwechsel aus zwei Blickwinkeln und
 * werden deshalb **nicht** addiert: `minimumAirflow` ist der hygienische
 * Mindeststrom aus der Nutzung, die übrigen Ströme sind das, was die geplante
 * Anlage an diesem Raum bewegt. Maßgebend ist der größere von beiden — ein
 * Mindeststrom ist eine Untergrenze, keine Zugabe.
 *
 * Derselbe Sachverhalt steht im Klartext in `conventions.ventilation` und
 * wandert damit im Dokument mit. Hier steht er, damit beide Seiten dasselbe
 * lesen: eine Konvention, die nur in einer Doku steht, geht verloren.
 */
export interface ExportRoomVentilation {
  /**
   * Rolle im Lüftungskonzept. Sie entscheidet, woher die Luft dieses Raums
   * kommt: ein Abluftraum (`exhaust`) bekommt sie über den Überströmweg aus
   * den Zulufträumen und damit bereits temperiert.
   */
  role: VentilationRole;
  /** Summe der Zuluftventile im Raum [m³/h]. */
  supplyAirflow: number;
  /**
   * Summe der Abluftventile [m³/h]. Das ist Fortluft, keine Außenluft: sie
   * verlässt den Raum, nachdem sie über den Überströmweg aus den
   * Zulufträumen zugeflossen ist. Wer diesen Strom bei einem Bad oder einer
   * Küche als Außenluft ansetzt, überschätzt deren Heizlast erheblich.
   */
  exhaustAirflow: number;
  /** Summe der Überströmelemente [m³/h] — Luft aus den Zulufträumen. */
  transferAirflow: number;
  /**
   * Zuluft nach Wärmerückgewinnung V̇_zu · (1 − η) [m³/h]. Genau dieser
   * Anteil trägt noch Außenlufttemperatur; der Rest ist zurückgewonnen.
   * Entweder dieser Wert wird angesetzt **oder** `supplyAirflow` mit einer
   * eigenen Rückgewinnungsrechnung aus `VentilationTotals.heatRecovery` —
   * beides zusammen zieht η zweimal ab.
   */
  effectiveSupplyAirflow: number;
  /**
   * Mindestluftvolumenstrom n_min · V [m³/h] — die Vergleichsgröße, nicht
   * die zweite. Derselbe Wert steht als `ExportRoom.minimumAirflow` noch
   * einmal da, weil er dort in die Reihe der Raumkennwerte gehört.
   */
  minimumAirflow: number;
}

/** Befund der Modellprüfung — wandert mit in den Export. */
/**
 * Art eines Topologie-Befundes der Raumerkennung.
 *
 * Die Typen stehen hier und nicht im Rechenkern, weil sie im Dokument
 * abgelegt und von der Oberfläche gezeichnet werden — `src/lib/roomDetection`
 * gibt sie unverändert weiter. Ohne diesen Umweg müsste `types/bim` aus dem
 * Rechenkern importieren, und die Abhängigkeit liefe im Kreis.
 *
 * - `open-end`  Wandende ohne jeden Anschluss (Grad 1). Der klassische Fall.
 * - `gap`       Umschließung reißt zwischen zwei Wandenden auf, obwohl beide
 *               angeschlossen sind. Der Fall, den niemand sieht.
 * - `near-miss` Zwei Enden liegen dicht beieinander und wurden verschweißt.
 *               Der Raum entsteht, die Fuge bleibt im Modell.
 * - `off-axis`  Ein Ende setzt neben einer fremden Achse auf und wurde darauf
 *               gezogen — ein T-Stoß, der ohne Heilung nicht geteilt würde.
 * - `overlap`   Zwei kollineare Wände liegen übereinander statt zu stoßen.
 */
export type ClosureIssueKind = 'open-end' | 'gap' | 'near-miss' | 'off-axis' | 'overlap';

/** Ein einzelner Topologie-Befund samt allem, was zum Zeichnen nötig ist. */
export interface ClosureIssue {
  kind: ClosureIssueKind;
  /** Ort im Modellraum [m]; bei `gap` die Mitte der Lücke. */
  position: Vec2;
  /**
   * Das Maß, um das es geht [m]: Lückenbreite, Fugenweite, Achsversatz oder
   * Überlappungslänge. Immer eine Länge, damit ein Anzeigetext sie einheitlich
   * behandeln kann.
   */
  measure: number;
  /**
   * Fläche [m²], die als Raum entstünde, wenn die Lücke geschlossen wird.
   * Nur bei `kind === 'gap'` belegt — sie macht aus „da fehlt etwas" ein
   * „da fehlen 9,5 m²".
   */
  enclosedArea?: number;
  /**
   * Die beiden Wandenden, zwischen denen die Wand fehlt — nur bei `gap`.
   * Der Plan zeichnet genau diese Strecke gestrichelt: sie *ist* die fehlende
   * Wand. Eine Marke auf der Mitte allein sagt nicht, in welche Richtung.
   */
  ends?: [Vec2, Vec2];
  /**
   * Umriss der Fläche hinter der Lücke, über die fehlende Wand geschlossen —
   * nur bei `kind === 'gap'`. Er beantwortet die zweite Hälfte der Frage:
   * nicht nur „hier fehlt eine Wand", sondern „das ist der Raum, der deshalb
   * fehlt".
   */
  enclosedOutline?: Vec2[];
  /** Beteiligte Wände, für den Sprung im Editor. */
  wallIds: string[];
  /** Ein Satz Klartext: was ist wo, und was folgt daraus. */
  message: string;
}

export interface ValidationIssue {
  severity: 'error' | 'warning' | 'info';
  /** Maschinenlesbarer Code, z. B. 'wall.missing-u-value'. */
  code: string;
  message: string;
  /** Betroffenes Objekt für den Sprung im Editor. */
  target?: { kind: SelectionKind; id: string };
  /**
   * Ort im Modellraum [m], falls der Befund kein Objekt hat, das man
   * auswählen könnte. Eine fehlende Wand ist genau das: sie hat keine
   * Kennung, nur eine Stelle. Ohne dieses Feld bliebe ausgerechnet der
   * Befund unanspringbar, bei dem der Anwender am wenigsten weiß, wo er
   * suchen soll — die Ansicht springt stattdessen auf diesen Punkt.
   */
  position?: Vec2;
  /**
   * Was zu tun ist, in einem Satz. Die Meldung nennt das Problem, dieser Satz
   * den Handgriff — ohne ihn hilft ein Prüfbericht nur dem, der die Antwort
   * ohnehin kennt.
   */
  remedy?: string;
}

export interface ValidationReport {
  errors: number;
  warnings: number;
  infos: number;
  /** Ist das Modell rechenfähig? Fehler bedeuten: nein. */
  ready: boolean;
  issues: ValidationIssue[];
}

/**
 * Der Baugrund im Export — Erfassungsgrößen, keine Kennwerte.
 *
 * Für die Erdreichrechnung nach DIN EN ISO 13370 reicht die Geometrie nicht:
 * dieselbe Kellersohle verliert über gesättigtem Kies deutlich mehr als über
 * trockenem Sand, und der Grundwasserstand ist die Größe, die die Korrektur
 * G_w überhaupt erst auslöst. Beides steht im Modell ohnehin — der Untergrund
 * für die Entzugsleistung der Wärmequelle —, war aber bisher nur dort
 * verwendet und stand nicht im Export. Ohne diesen Block müsste die
 * Gegenstelle den Baugrund ein zweites Mal erfassen, an einer Stelle, an der
 * niemand mehr nachsieht, ob er zum Grundstück passt.
 *
 * **Was hier nicht steht.** Wärmeleitfähigkeiten λ des Bodens liefert dieser
 * Export nicht. Die Tabelle gehört zur Norm und ist nicht frei zitierbar; ein
 * nachgebauter Zahlensatz sähe aus wie eine Angabe und wäre eine Erfindung.
 * Die Bodenart benennt die Zeile, die Gegenstelle schlägt sie nach.
 *
 * Der Block fehlt ganz, wenn es nichts zu berichten gibt — siehe
 * `RaviaExport.subsoil`.
 */
export interface ExportSubsoil {
  /**
   * Bodenart des Baugrunds, wie im Lageplan geführt. Eine Eingabe mit der
   * Vorbelegung „normal, bindig-feucht" — der Export gibt sie weiter und
   * behauptet nicht, dass sie erkundet wurde; das sagt
   * `conventions.subsoil` auch der Gegenstelle.
   */
  soil: SoilKind;
  /** Klartext dazu (`SOIL_LABELS`) — ein Bericht muss ihn nicht nachschlagen. */
  soilLabel: string;
  /**
   * Grundwasserstand als Tiefe unter Geländeoberkante [m], positiv nach
   * unten. Fehlt, solange er nicht erfasst ist; er wird nicht geschätzt.
   */
  groundwaterDepth?: number;
  /** Fließrichtung des Grundwassers als Azimut [°], falls erfasst. */
  groundwaterAzimuth?: number;
  /** Geländeoberkante [m] — die Bezugshöhe, auf die sich die Tiefe bezieht. */
  terrainElevation?: number;
  /**
   * Größte Einbindetiefe eines erdberührten Bauteils [m]. Die Zahl, gegen
   * die `groundwaterDepth` zu halten ist: erst wenn der Spiegel in die Nähe
   * dieser Tiefe kommt, ist über G_w überhaupt zu reden. 0, wenn keine
   * Geländeoberkante erfasst ist oder die Bodenplatte auf Geländeniveau
   * liegt — eine Bodenplatte ohne Einbindung ist erdberührt, aber nicht
   * eingegraben.
   */
  deepestEmbedment: number;
  /** Erdberührte Hüllfläche des Gebäudes [m²] — Summe über alle Räume. */
  groundContactArea: number;
}

/** Wärmepumpe, Aufstellung und Nachweis im Export. */
export interface ExportHeatPump {
  /** Angaben zum Grundstück. */
  site: {
    areaCategory: AreaCategory;
    /** Immissionsrichtwerte [tags, nachts] in dB(A). */
    immissionLimits: [number, number];
    state: string;
    soil: SoilKind;
    waterProtection: WaterProtectionZone;
    sourceRunHours: number;
    /** Grundstücksfläche [m²], falls die Grenze gezeichnet ist. */
    plotArea?: number;
  };
  pumps: {
    id: string;
    label: string;
    source: HeatSourceKind;
    form: string;
    /** Heizleistung im Auslegungspunkt [kW] und der Punkt selbst. */
    heatingCapacity: number;
    ratingPoint: string;
    cop: number;
    operation: string;
    bivalencePoint: number;
    backupCapacity: number;
    flowTemperature: number;
    refrigerant: string;
    refrigerantMass: number;
    gridRegime: string;
    blockedHours: number;
    /** Sperrzeitfaktor 24/(24−t) — 1, wenn nicht gesperrt wird. */
    blockingFactor: number;
    domesticHotWater: boolean;
    occupants: number;
    /** Schallnachweis nach dem überschlägigen Verfahren der TA Lärm. */
    acoustics: {
      soundPower: number;
      roomAngle: number;
      toneSurcharge: number;
      limitNight: number;
      /** Abstand für den Richtwert bzw. für Richtwert minus 6 dB [m]. */
      limitDistance: number;
      safeDistance: number;
      points: {
        label: string;
        origin: string;
        distance: number;
        level: number;
        limit: number;
        verdict: string;
      }[];
    };
    /** Verletzungen des Schutzbereichs bei brennbarem Kältemittel. */
    protectionIssues: { kind: string; label: string; distance: number; required: number }[];
    /** Bedarf und Bestand der erdgekoppelten Wärmequelle. */
    source_demand?: {
      extraction: number;
      specific: number;
      boreholeMetres?: number;
      collectorArea?: number;
      flowRate?: number;
      plannedMetres?: number;
      plannedArea?: number;
      sufficient: boolean;
      tableApplicable: boolean;
    };
  }[];
  /** Alle Objekte des Außengeländes — Rohdaten für den Lageplan. */
  elements: SiteElement[];
}

/** Das Austauschformat für RaVia / nachgelagerte TGA-Werkzeuge. */
/**
 * Die Anlagentechnik im Export.
 *
 * Für die Heizlast selbst ohne Belang — für alles danach entscheidend: die
 * Gegenseite bekommt hier das Gerät, die Speicher, die Rohrnetz-Auslegung und
 * die Sicherheitsausrüstung als geschlossenen Datensatz und muss nichts davon
 * nachfragen. Jede berechnete Größe trägt mit, woher ihre Eingangswerte
 * stammen (`provenance`), damit auf der anderen Seite unterscheidbar bleibt,
 * was Datenblatt ist und was Typklasse.
 */
export interface ExportPlant {
  /** Gewähltes Gerät — Typklasse oder Herstellergerät. */
  generator?: {
    modelId: string;
    label: string;
    form: PumpForm;
    source: HeatSourceKind;
    refrigerant: Refrigerant;
    refrigerantMass: number;
    nominalCapacity: number;
    nominalPoint: string;
    capacityAtDesign: number;
    maxFlowTemperature: number;
    scop35?: number;
    provenance: 'generisch' | 'hersteller';
    manufacturer?: string;
  };
  /** Speicher der Anlage. */
  storages: {
    id: string;
    label: string;
    kind: StorageKind;
    volume: number;
    roomId?: RoomId;
    suggested: boolean;
  }[];
  /** Auslegungstemperaturen und Werkstoff der Verteilung. */
  design: PlantDefinition['design'];
  /** Heizkreise mit ihrer Auslegung. */
  circuits: HeatingCircuit[];
  /** Sicherheitsausrüstung nach DIN EN 12828. */
  safety?: SafetyDesign;
  /** Trinkwarmwasser. */
  domesticHotWater?: DomesticHotWaterDesign;
  /** Anlagenschema als Bauteile und Verbindungen. */
  schematic: {
    components: SchematicComponent[];
    links: SchematicLink[];
  };
}

export interface RaviaExport {
  schema: 'ravia.bim.light';
  version: '2.0.0';
  generator: string;
  exportedAt: string;
  /** Einheiten explizit im Dokument — keine Konvention, die verloren gehen kann. */
  units: {
    length: 'm';
    area: 'm2';
    volume: 'm3';
    temperature: 'degC';
    uValue: 'W/(m2K)';
    power: 'W';
    airflow: 'm3/h';
    angle: 'deg';
  };
  /** Kurzbeschreibung der Konventionen für den Konsumenten. */
  conventions: {
    azimuth: string;
    coordinates: string;
    areas: string;
    boundaries: string;
    /** Wie erdberührte Flächen entstehen und was `groundContact` bedeutet. */
    groundContact: string;
    /** Was ein massives Bauteil ist und was seine Wärmebrückenangabe leistet. */
    solids: string;
    /**
     * Was die Lüftungsfelder bedeuten und was nicht addiert werden darf.
     * Der Text beantwortet die Fragen, die sonst als Rückfrage kommen:
     * n_min gegen Anlagenstrom, welcher der beiden Rückgewinnungswerte gilt,
     * woher die Infiltration kommt und warum die Abluft eines Bades keine
     * Außenluft ist.
     */
    ventilation: string;
    /** Was `subsoil` erfasst — und was es bewusst nicht liefert. */
    subsoil: string;
  };
  project: ProjectMeta;
  /**
   * Baugrund: Bodenart und, falls erfasst, Grundwasserstand.
   *
   * Optional und ohne Vorgabewerte: der Block erscheint nur, wenn das Gebäude
   * das Erdreich überhaupt berührt oder ein Grundwasserstand erfasst ist. Ein
   * Dokument ohne Baugrundangaben verhält sich damit wie vor der Einführung
   * dieses Blocks — eine behauptete Bodenart wäre schlechter als keine.
   */
  subsoil?: ExportSubsoil;
  levels: Level[];
  /** Bauteilkatalog — die U-Werte im Modell verweisen hierauf. */
  constructions: Construction[];
  /** Treppen und Schächte — Flächen, die kein Raum sind. */
  verticals: ExportVertical[];
  /** Massive Bauteile — Kamin, Pfeiler, Wandversatz. */
  solids: ExportSolid[];
  /** Einzelne Leitungsabschnitte mit ihrer Trassenlänge. */
  pipes: ExportPipe[];
  /** Längenauszug: Meter je Gewerk, Nennweite und Dämmstärke. */
  pipeSchedule: PipeScheduleEntry[];
  /**
   * Strangschema: je Verbraucher der Weg zu seiner Quelle. Die Grundlage des
   * hydraulischen Abgleichs — gerechnet wird er in RaVia.
   */
  pipeNetwork: PipeNetworkReport;
  rooms: ExportRoom[];
  totals: ExportBuildingTotals;
  validation: ValidationReport;
  /**
   * Außenanlage und Wärmepumpe. Für die Heizlast selbst ohne Belang — für
   * alles, was danach kommt, unverzichtbar: Auslegung, Schallnachweis,
   * Genehmigung.
   */
  heatPump?: ExportHeatPump;
  /**
   * Anlagentechnik: Erzeuger, Speicher, Verteilung, Sicherheitsarmaturen,
   * Anlagenschema. Fehlt, solange kein Gerät gewählt wurde.
   */
  plant?: ExportPlant;
  /** Rohgeometrie für verlustfreien Re-Import. */
  geometry: {
    nodes: BimNode[];
    walls: Wall[];
    openings: Opening[];
    fixtures: Fixture[];
    verticals: VerticalElement[];
    solids: SolidElement[];
    pipes: PipeRun[];
    annotations: Annotation[];
    roofOpenings: RoofOpening[];
  };
}

// ===========================================================================
// Anlagentechnik — Erzeuger, Speicher, Verteilung
// ===========================================================================

/**
 * Bauform des Wärmeerzeugers.
 *
 * Der Unterschied ist nicht kosmetisch: er entscheidet, wo Kältemittel liegt,
 * wer den Schall abstrahlt und welche Arbeiten am Kältekreis anfallen.
 *  • `monoblock-outdoor` — kompletter Kältekreis draußen, ins Haus geht
 *    Heizungswasser. Kein Kälteschein nötig, dafür Frostschutz in der
 *    Außenleitung oder eine sichere Entleerung.
 *  • `split` — Verdichter draußen, Verflüssiger drinnen, dazwischen
 *    Kältemittelleitungen. Braucht eine Kälteanlagen-Sachkunde und bringt
 *    brennbares Kältemittel ins Gebäude (bei R32/R290 aufstellraumrelevant).
 *  • `monoblock-indoor` — alles drinnen, Luft über Kanäle. Selten, aber
 *    schalltechnisch außen unschlagbar.
 *  • `hydrosplit` — der Zwischenweg, und der am häufigsten falsch gezeichnete:
 *    der **Kältekreis liegt vollständig draußen** wie beim Monoblock, ins Haus
 *    geht Heizungswasser. Drinnen steht eine **Hydraulikstation** ohne
 *    Verdichter, die Pumpe, Umschaltventil, Sicherheitsgruppe,
 *    Ausdehnungsgefäß und oft den Heizstab enthält. Der Begriff ist am Markt
 *    nicht einheitlich: LG und Daikin sagen „Hydrosplit", Panasonic
 *    „Bi-Bloc", Viessmann, Bosch, Buderus und Vaillant nennen dasselbe
 *    „Monoblock mit Inneneinheit". Hydraulisch ist es dasselbe wie ein
 *    Monoblock — einschließlich des Frostrisikos in der Außenleitung.
 *  • `tower` — Kompakt- oder Turmgerät: Inneneinheit mit **eingebautem
 *    Trinkwasserspeicher** im Sockel (marktüblich 170 bis 280 l). Wer daneben
 *    einen zweiten Speicher zeichnet, plant einen, den niemand kauft.
 *  • `indoor` — Sole- oder Wasser-Wärmepumpe im Technikraum.
 *
 * **Warum das für das Anlagenschema entscheidend ist:** Die Bauform sagt,
 * welche Bauteile schon im Gerät stecken und deshalb **nicht** ein zweites Mal
 * ins Bild gehören. Ein Schema, das eine Umwälzpumpe zeichnet, obwohl sie in
 * der Hydraulikstation sitzt, lässt eine Pumpe zu viel bestellen. Die Bauform
 * allein genügt dafür allerdings nicht: die Pumpenlage kippt *innerhalb*
 * derselben Bauform (Vaillant aroTHERM plus hat sie in der Außeneinheit,
 * Buderus WLW176i in der Inneneinheit). Deshalb steht die tatsächliche
 * Ausstattung an `HeatPumpModel.contains` und nicht an dieser Aufzählung.
 */
export type PumpForm =
  | 'monoblock-outdoor'
  | 'split'
  | 'hydrosplit'
  | 'monoblock-indoor'
  | 'tower'
  | 'indoor';

export const PUMP_FORM_LABELS: Record<PumpForm, string> = {
  'monoblock-outdoor': 'Monoblock, Außenaufstellung',
  split: 'Split, Außen- und Innengerät',
  hydrosplit: 'Hydrosplit, Kältekreis außen mit Hydraulikstation',
  'monoblock-indoor': 'Monoblock, Innenaufstellung mit Luftkanälen',
  tower: 'Kompaktgerät mit eingebautem Trinkwasserspeicher',
  indoor: 'Innenaufstellung (Sole/Wasser)',
};

/**
 * Baugruppen, die im Gerät schon enthalten sind.
 *
 * Jede davon darf im Anlagenschema **nicht als eigenes Bauteil** erscheinen —
 * sie wird innerhalb des Gerätesymbols geführt. Die Liste ist die Antwort auf
 * die Frage, an der sich Hersteller und Bauform gerade nicht decken: dieselbe
 * Bauform kann die Pumpe drinnen oder draußen haben.
 */
export interface UnitContents {
  /** Umwälzpumpe des Heizkreises. */
  pump?: boolean;
  /** Dreiwege-Umschaltventil Heizung/Warmwasser. */
  diverter?: boolean;
  /** Sicherheitsventil, Manometer, Füll- und Entleerhahn. */
  safetyGroup?: boolean;
  /** Membran-Ausdehnungsgefäß [l]; 0 oder fehlend heißt: bauseits. */
  expansionVessel?: number;
  /** Elektro-Heizstab [kW]. */
  backupHeater?: number;
  /** Trinkwasserspeicher [l]. */
  cylinder?: number;
  /** Pufferanteil [l]. */
  buffer?: number;
  /** Volumenstromwächter / Strömungsschalter. */
  flowSwitch?: boolean;
  /** Schlamm- oder Magnetitabscheider. */
  dirtSeparator?: boolean;
  /** In welcher Einheit die Baugruppen sitzen — für die Beschriftung. */
  location?: 'aussen' | 'innen';
}

/** Kältemittel mit den Eigenschaften, die für die Aufstellung zählen. */
export type Refrigerant = 'R290' | 'R32' | 'R410A' | 'R454C' | 'R744' | 'R1234ze' | 'andere';

/**
 * Sicherheitsgruppe nach DIN EN 378-1 Tabelle E.1 und GWP nach der
 * EU-F-Gas-Verordnung (VO (EU) 2024/573, Anhang I/II).
 *
 * `flammable` steuert, ob ein Schutzbereich zu prüfen ist; die Größe des
 * Schutzbereichs steht in keiner Norm und bleibt Herstellerangabe.
 */
export interface RefrigerantProperties {
  group: 'A1' | 'A2L' | 'A3' | 'B1' | 'A1/A2L';
  gwp: number;
  flammable: boolean;
  /** Praktischer Grenzwert nach DIN EN 378-1 Anhang C [kg/m³]. */
  practicalLimit: number;
  note: string;
}

/** Ein Betriebspunkt nach EN 14511 — „A-7/W35" heißt Luft −7 °C, Wasser 35 °C. */
export interface DeviceRatingPoint {
  /** Kurzform des Punktes, z. B. „A-7/W35". */
  point: string;
  /** Heizleistung [kW]. */
  capacity: number;
  /** Leistungszahl COP [-]. */
  cop: number;
}

/**
 * Woher eine Zahl im Datensatz kommt.
 *
 * Sie steht neben jedem hydraulischen Kennwert, weil die vier Fälle
 * verschieden belastbar sind: ein Tabellenwert ist zitierbar, ein aus einem
 * Diagramm abgelesener Wert trägt die Ablesegenauigkeit, ein abgeleiteter
 * ist eine Rechnung dieses Programms, und eine Annahme ist gar keine
 * Herstellerangabe. Ohne diese Unterscheidung sieht im Bericht alles gleich
 * aus — und genau das ist der Fehler, den ein Nachweis nicht machen darf.
 */
export type WertHerkunft = 'tabellenwert' | 'diagramm-abgelesen' | 'abgeleitet' | 'annahme';

/**
 * Welche Art hydraulischer Angabe ein Wärmeerzeuger veröffentlicht.
 *
 * **Der Markt liefert zwei fachlich verschiedene, sich gegenseitig
 * ausschließende Angaben** — und wer sie verwechselt, rechnet um 40 bis
 * 70 kPa falsch, und zwar in beide Richtungen:
 *
 *  • `druckverlust` — das Gerät ist ein Widerstand im Fließweg. Sein Δp wird
 *    zum Rohrnetz **addiert**; die Pumpe muss beides fördern. Herstellerworte:
 *    „Interne Druckabnahme" (Bosch), „Interner Druckverlust Heizung" (Stiebel
 *    Eltron), „Durchflusswiderstand Verflüssiger" (Viessmann), „product
 *    pressure drop" (LG). Der Wert **steigt** mit dem Volumenstrom.
 *  • `restfoerderhoehe` — im Gerät sitzt eine Pumpe, und der Hersteller sagt,
 *    was davon außerhalb des Geräts noch übrig ist. Der Wert wird **nicht
 *    addiert**, sondern ist die **Obergrenze**: Rohrnetz + Armaturen ≤ RFH.
 *    Es wird gar keine Pumpe ausgelegt, sondern geprüft. Der Wert **fällt**
 *    mit dem Volumenstrom — eine Pumpenkennlinie, keine Widerstandskennlinie.
 *  • `keine-angabe` — der Hersteller publiziert nur Diagramme oder gar nichts.
 *    Dann rechnet das Programm ohne diesen Posten, **beziffert aber im
 *    Bericht, wie groß der fehlende Betrag ist.**
 *
 * Die beiden Felder sind unabhängig von `UnitContents.pump`: Stiebel Eltron
 * baut die Pumpe ein und publiziert trotzdem nur Δp.
 *
 * Quelle der Unterscheidung: VdZ, „Leitfaden für Fachleute: Hydraulischer
 * Abgleich in Heizungsanlagen" — die Pumpenauslegung ist dort ausdrücklich
 * die „Summe der Einzeldruckverluste, bestehend aus den Druckverlusten der
 * Rohrleitungen, **des Wärmeerzeugers**, der Wärmeübergabeeinrichtung, der
 * Armaturen sowie der sonstigen Einbauten".
 */
export type ErzeugerAngabe = 'druckverlust' | 'restfoerderhoehe' | 'keine-angabe';

/**
 * Was ein veröffentlichter Δp-Wert einschließt.
 *
 * Viessmann nennt ausdrücklich den **Verflüssiger**, Bosch die **interne**
 * Druckabnahme des ganzen Geräts. Zwischen beiden liegen die
 * Geräteverrohrung, das Umschaltventil und bei manchen Baureihen ein
 * Abscheider. Wer das nicht mitführt, zählt dieselben Bauteile zweimal.
 */
export type ErzeugerUmfang =
  | 'nur-waermetauscher'
  | 'gesamtes-geraet'
  | 'geraet-mit-abscheider'
  | 'unbekannt';

/**
 * Der hydraulische Kennwert eines Wärmeerzeugers.
 *
 * **`bezugsvolumenstrom` ist Pflicht und kein Beiwerk.** Wolf hat die
 * Restförderhöhe der CHA-07 zwischen zwei Prospektausgaben von 610 auf
 * 420 mbar geändert — allein dadurch, dass der Bezugsvolumenstrom von 22 auf
 * 27 l/min wechselte. Ein Δp oder eine Restförderhöhe ohne den zugehörigen
 * Volumenstrom ist keine Zahl, sondern eine Behauptung.
 */
export interface GeneratorHydraulics {
  angabe: ErzeugerAngabe;
  /** Δp bzw. Restförderhöhe beim Bezugsvolumenstrom [Pa]. */
  wert: number;
  /** Volumenstrom, auf den sich `wert` bezieht [m³/h]. Pflichtangabe. */
  bezugsvolumenstrom: number;
  /**
   * Exponent der Skalierung Δp = Δp_bezug · (V̇/V̇_bezug)^n [-].
   *
   * Vorgabe 2,0 — der in der deutschen TGA-Praxis übliche Wert („der
   * Volumenstrom geht quadratisch in die Berechnung ein") und zugleich der
   * konservative: oberhalb des Bezugspunktes liefert n = 2 mehr Δp als der
   * aus Plattenwärmetauscher-Messungen regressierte n ≈ 1,78, die Pumpe
   * fällt also nicht zu klein aus. **Auf die Restförderhöhe wird er nicht
   * angewendet** — sie ist eine Pumpenkennlinie und fällt, statt zu steigen.
   */
  exponent: number;
  umfang: ErzeugerUmfang;
  /** Worauf sich eine Restförderhöhe bezieht. */
  rfhBezug?: 'mindestvolumenstrom' | 'nennvolumenstrom' | 'kennlinienmaximum';
  /**
   * Bauteile, die in `wert` bereits stecken — sie dürfen im Fließweg nicht
   * ein zweites Mal gezählt werden.
   */
  enthaelt?: SchematicKind[];
  /** Gültigkeitsgrenzen der Skalierung [m³/h]. */
  vMin?: number;
  vMax?: number;
  /** Originalwortlaut des Herstellers, z. B. „Interne Druckabnahme". */
  herstellerbegriff: string;
  herkunft: WertHerkunft;
  /** Dokument und Stand — Wolf 2018 ist nicht Wolf 2024. */
  quelle: string;
}

/**
 * Ein Gerät aus dem Katalog.
 *
 * **Herkunft der Zahlen.** `provenance: 'generisch'` bedeutet: das ist eine
 * Typklasse, keine Herstellerangabe. Die Werte stammen aus dem Bereich, in
 * dem sich marktübliche Geräte dieser Bauart und Größe bewegen, und sind zum
 * Vordimensionieren gedacht — nicht zum Bestellen. Sobald ein Datenblatt
 * vorliegt, wird das Gerät mit `provenance: 'hersteller'` überschrieben; erst
 * dann ist die Auslegung belastbar. Das Programm sagt an jeder Stelle dazu,
 * womit es gerade rechnet.
 */
export interface HeatPumpModel {
  id: string;
  /** Anzeigename, z. B. „Monoblock 8 kW R290". */
  label: string;
  /** Baureihe oder Typklasse zur Gruppierung im Katalog. */
  series: string;
  form: PumpForm;
  source: HeatSourceKind;
  refrigerant: Refrigerant;
  /** Füllmenge [kg]. */
  refrigerantMass: number;
  /** Nennheizleistung im Auslegungspunkt der Baureihe [kW]. */
  nominalCapacity: number;
  /** Auf welchen Punkt sich `nominalCapacity` bezieht. */
  nominalPoint: string;
  /** Weitere Betriebspunkte für die Leistungskurve. */
  ratings: DeviceRatingPoint[];
  /** Jahresarbeitszahl nach EN 14825, mittleres Klima. */
  scop35?: number;
  scop55?: number;
  /** Höchste erreichbare Vorlauftemperatur [°C] — die Grenze für Bestandsbauten. */
  maxFlowTemperature: number;
  /**
   * Schallleistung der Außeneinheit [dB(A)], lautester Nachtzustand.
   * Bleibt leer, wenn das Gerät keine Außeneinheit hat (Innenaufstellung,
   * Sole/Wasser, Wasser/Wasser) — dort gibt es keinen Wert, und 0 wäre gelogen.
   */
  soundPowerOutdoor?: number;
  /** Schallleistung im garantierten Flüsterbetrieb [dB(A)]. */
  soundPowerNight?: number;
  /** Schallleistung der Inneneinheit [dB(A)] — Thema bei Aufstellung neben Schlafräumen. */
  soundPowerIndoor?: number;
  /** Außeneinheit: Breite, Tiefe, Höhe [m], Gewicht [kg]. */
  outdoor?: { width: number; depth: number; height: number; weight: number };
  /** Inneneinheit — bei Split und bei Innenaufstellung. */
  indoor?: {
    width: number;
    depth: number;
    height: number;
    weight: number;
    /** Eingebauter Trinkwasserspeicher [l], falls Turmgerät. */
    integratedCylinder?: number;
    /** Eingebauter Pufferanteil [l]. */
    integratedBuffer?: number;
    /** Eingebauter Elektro-Heizstab [kW]. */
    backupHeater?: number;
  };
  /**
   * Maximale Vorlauftemperatur bei **Norm-Außentemperatur** [°C].
   *
   * Die übliche Angabe im Prospekt gilt bei Nennbedingungen. Mehrere
   * Hersteller schreiben daneben einen zweiten, niedrigeren Wert für den
   * kalten Tag — Buderus etwa „75 °C (65 °C bei −10 °C)". Ausgerechnet am
   * Auslegungspunkt zählt der zweite. Fehlt er, gilt `maxFlowTemperature`,
   * und die Auslegung sagt dazu, dass sie damit optimistisch rechnet.
   */
  maxFlowTemperatureAtDesign?: number;
  /**
   * Baugruppen, die das Gerät bereits enthält.
   *
   * Sie entscheiden, was das Anlagenschema **nicht** zeichnen darf. Fehlt die
   * Angabe, wird nichts angenommen — das Schema zeichnet dann alles bauseits,
   * und das ist der sichere Fehler: ein Bauteil zu viel im Plan kostet eine
   * Rückfrage, ein fehlendes kostet eine Baustelle.
   */
  contains?: UnitContents;
  /** Heizungsseitiger Anschluss, z. B. „G 1¼ AG". */
  hydraulicConnection: string;
  /** Kältemittelleitungen bei Split: Flüssig / Sauggas [Zoll]. */
  refrigerantLines?: { liquid: string; gas: string; maxLength: number; maxHeight: number };
  /** Mindestvolumenstrom im Heizbetrieb [m³/h] — er bestimmt den Überströmer. */
  minVolumeFlow: number;
  /** Mindestwasserinhalt der Anlage [l] — er bestimmt den Puffer. */
  minSystemVolume: number;
  /**
   * Mindestwasserinhalt bei **aktiviertem Elektro-Heizstab** [l].
   *
   * Der Heizstab liefert die Abtauenergie mit, die sonst dem Anlagenwasser
   * entnommen wird. Vaillant senkt den geforderten Wert dadurch von 150 l auf
   * 45 l — wer den Heizstab ignoriert, legt den Puffer um ein Mehrfaches zu
   * groß aus. Die Zahl steht im Datenblatt; die Typklassen führen sie nicht.
   */
  minSystemVolumeWithHeater?: number;
  /**
   * Heizungsseitiger Widerstand bzw. Restförderhöhe des Geräts.
   *
   * Fehlt das Feld, rechnet die Auslegung ohne diesen Posten — und sagt es
   * im Bericht. Für einen 8-kW-Monoblock bei 1,5 m³/h fehlen dann rund
   * 10 kPa allein am Gerät und mit den übrigen Einbauten des Fließwegs
   * 26 bis 30 kPa; bei einem Einfamilienhaus-Rohrnetz mit 1,5 bis 3 m
   * Förderhöhe ist das eine **Verdopplung**. Deshalb steht das Feld hier und
   * nicht in einer Randnotiz.
   */
  hydraulics?: GeneratorHydraulics;
  /**
   * Elektrik: Phasen, Absicherung [A], maximaler Betriebsstrom [A],
   * Anlaufstrom [A], Heizstab [kW].
   * `maxCurrent` ist der Wert, den der Netzbetreiber im Anmeldeformular sehen
   * will; er steht im Datenblatt und ist nicht dasselbe wie die Absicherung.
   */
  electric: {
    phases: 1 | 3;
    fuse: number;
    maxCurrent?: number;
    startCurrent?: number;
    backupHeater?: number;
  };
  provenance: 'generisch' | 'hersteller';
  manufacturer?: string;
  note?: string;
}

/** Art eines Speichers. */
export type StorageKind =
  | 'dhw-cylinder'
  | 'buffer-series'
  | 'buffer-parallel'
  | 'separator'
  | 'combi'
  | 'fresh-water-station';

export const STORAGE_KIND_LABELS: Record<StorageKind, string> = {
  'dhw-cylinder': 'Trinkwasserspeicher',
  'buffer-series': 'Reihenpuffer im Rücklauf',
  'buffer-parallel': 'Parallelpuffer',
  separator: 'Hydraulische Weiche',
  combi: 'Kombispeicher',
  'fresh-water-station': 'Frischwasserstation',
};

/** Ein Speicher aus dem Katalog. */
export interface StorageModel {
  id: string;
  label: string;
  kind: StorageKind;
  /** Nenninhalt [l]. */
  volume: number;
  /** Trinkwasseranteil beim Kombispeicher [l]. */
  potableVolume?: number;
  /** Fläche des Glattrohr-Wärmetauschers [m²]. */
  coilArea?: number;
  /** Dauerleistung bei 10/45 °C und 60 °C Heizwasser [kW]. */
  continuousOutput?: number;
  /** Leistungskennzahl N_L nach DIN 4708. */
  performanceIndex?: number;
  /** Bereitschaftswärmeaufwand [kWh/24h] — er bestimmt den Standby-Verbrauch. */
  standbyLoss?: number;
  /** Abmessungen [m] und Kippmaß [m] — passt der Speicher durch die Tür? */
  diameter: number;
  height: number;
  tiltHeight?: number;
  /** Werkstoff der Trinkwasserseite — entscheidet über Anode und Wasserqualität. */
  material?: 'emailliert' | 'edelstahl' | 'kunststoff' | 'stahl-unlegiert';
  /** Zulässiger Betriebsdruck [bar] trinkwasserseitig / heizungsseitig. */
  maxPressure?: { potable: number; heating: number };
  provenance: 'generisch' | 'hersteller';
  manufacturer?: string;
  note?: string;
}

/** Werkstoff der Rohrleitung — er bestimmt Rauheit und Innendurchmesser. */
export type PipeMaterial = 'kupfer' | 'stahl' | 'edelstahl' | 'pex' | 'verbund' | 'ppr';

export const PIPE_MATERIAL_LABELS: Record<PipeMaterial, string> = {
  kupfer: 'Kupfer',
  stahl: 'Stahl, nahtlos',
  edelstahl: 'Edelstahl-Pressrohr',
  pex: 'PE-Xa',
  verbund: 'Mehrschichtverbundrohr',
  ppr: 'PP-R',
};

/** Eine Dimension aus der Werkstofftabelle. */
export interface PipeDimension {
  material: PipeMaterial;
  /** Bezeichnung, wie sie bestellt wird, z. B. „22 × 1" oder „DN 25". */
  label: string;
  /** Außendurchmesser [mm]. */
  outer: number;
  /** Wanddicke [mm]. */
  wall: number;
  /** Lichter Innendurchmesser [mm] — damit wird gerechnet. */
  inner: number;
  /** Nennweite zur Zuordnung von Armaturen [mm]. */
  dn: number;
  /** Wasserinhalt [l/m] — er geht in Ausdehnungsgefäß und Spülzeit ein. */
  content: number;
}

/** Ergebnis einer Rohrdimensionierung für einen Abschnitt. */
export interface PipeSizing {
  dimension: PipeDimension;
  /** Volumenstrom [m³/h]. */
  flow: number;
  /** Fließgeschwindigkeit [m/s]. */
  velocity: number;
  /** Druckgefälle [Pa/m]. */
  gradient: number;
  /** Reynoldszahl [-] — unter 2320 laminar. */
  reynolds: number;
  /** Rohrreibungszahl λ [-]. */
  lambda: number;
  /** Warum diese Dimension gewählt wurde. */
  reason: 'geschwindigkeit' | 'druckgefälle' | 'kleinste' | 'größte';
  /** Verletzte Grenzwerte, falls die Tabelle nichts Passendes hergibt. */
  warning?: string;
}

/** Auslegung eines Heizkreises. */
export interface HeatingCircuit {
  id: string;
  label: string;
  /** Art der Wärmeübergabe — sie bestimmt die Auslegungstemperatur. */
  kind: 'floor' | 'radiator' | 'wall' | 'fancoil' | 'dhw';
  /** Versorgte Räume. */
  roomIds: RoomId[];
  /** Auslegungs-Vorlauf- und Rücklauftemperatur [°C]. */
  flowTemperature: number;
  returnTemperature: number;
  /** Wärmebedarf des Kreises [kW]; leer = aus den Räumen ableiten. */
  load?: number;
  /** Zugeordneter Verteiler (Fixture-Id). */
  manifoldId?: string;
  /** Werkstoff und Dimension der Anbindeleitung. */
  material: PipeMaterial;
  /** Fester Mischer oder direkt an den Erzeuger? */
  mixed: boolean;
  /** Verlegeabstand der Fußbodenheizung [m]. */
  spacing?: number;
  /** Zahl der Heizkreise am Verteiler. */
  loops?: number;
  /** Länge eines Kreises [m] — über 100 m wird der Druckverlust unwirtschaftlich. */
  loopLength?: number;
  /** Druckverlust des ungünstigsten Kreises [Pa]. */
  loopPressure?: number;
  /** Volumenstrom des Kreises [m³/h]. */
  volumeFlow?: number;
}

/**
 * Ein Bauteil im Anlagenschema — Erzeuger, Speicher, Armatur, Pumpe.
 *
 * Das Schema ist bewusst **kein zweiter Grundriss**: die Position ist ein
 * Rasterplatz im Strangschema, nicht ein Ort im Gebäude. Wer die Anlage im
 * Raum sehen will, findet die Geräte als TGA-Objekte im Grundriss wieder.
 */
export type SchematicKind =
  | 'heatpump-outdoor'
  | 'heatpump-indoor'
  | 'cylinder'
  | 'buffer'
  | 'separator'
  | 'freshwater'
  | 'pump'
  | 'valve-2way'
  | 'valve-3way'
  | 'valve-diverter'
  | 'check-valve'
  | 'shutoff'
  | 'balancing-valve'
  | 'overflow-valve'
  | 'safety-valve'
  | 'expansion-vessel'
  | 'pressure-gauge'
  | 'thermometer'
  | 'sensor'
  | 'strainer'
  | 'air-separator'
  | 'dirt-separator'
  | 'filling-valve'
  | 'backflow-preventer'
  | 'water-meter'
  | 'heat-meter'
  | 'manifold'
  | 'radiator'
  | 'floor-loop'
  | 'boiler'
  | 'electric-heater'
  | 'solar'
  | 'mixing-valve-dhw'
  | 'circulation-pump'
  /**
   * Volumenstromwächter (Strömungsschalter).
   *
   * Bis 1.12.0 gab es ihn nur als Beschriftung an einem Fühler — die
   * Schemaregel suchte ihn per Namensmuster. Bei Glykolbetrieb fordert
   * Daikin ihn ausdrücklich; ein Bauteil, das eine Anlage abschaltet, gehört
   * als Bauteil ins Bild und nicht als Wort.
   */
  | 'flow-switch'
  /**
   * Temperaturwächter / Sicherheitstemperaturbegrenzer.
   *
   * Zwingend an jedem **ungemischten** Flächenheizkreis: ohne ihn kann der
   * Estrich die Vorlauftemperatur des Erzeugers ungebremst abbekommen.
   */
  | 'temperature-limiter'
  /**
   * Hydraulikstation / Inneneinheit ohne Verdichter.
   *
   * Sie sah bis 1.12.0 aus wie eine Wärmepumpe — das Symbol zeigte einen
   * Verdichterkreis, den eine Hydraulikstation nicht hat. Wer das Bild liest,
   * sucht dann einen zweiten Erzeuger.
   */
  | 'hydraulic-station'
  | 'node';

export interface SchematicComponent {
  id: string;
  kind: SchematicKind;
  label: string;
  /** Rasterplatz im Schema [Einheiten, nicht Meter]. */
  x: number;
  y: number;
  /** Bezug auf ein reales Objekt, falls vorhanden. */
  fixtureId?: string;
  pumpId?: string;
  storageId?: string;
  /** Beschriftung unter dem Symbol, z. B. „DN 25" oder „3 bar". */
  spec?: string;
  /** Vom Programm erzeugt (true) oder von Hand ergänzt (false). */
  generated: boolean;
}

/** Eine Verbindung im Anlagenschema. */
export interface SchematicLink {
  id: string;
  from: string;
  to: string;
  /**
   * An welchen Stutzen die Leitung angeschlossen wird — die `id` aus
   * `SymbolPort`.
   *
   * Ohne diese Angabe suchen die Zeichner das *geometrisch nächste*
   * Stutzenpaar, und genau daran ist das erzeugte Schema gescheitert: die
   * Speicherladeleitung landete am Kaltwasserstutzen des Trinkwasserspeichers,
   * das Ausdehnungsgefäß am Abblasestutzen des Sicherheitsventils, die
   * Füllleitung am Abschlämmventil des Schlammabscheiders. Ein Fließbild, das
   * Heizungswasser an einen Trinkwasserstutzen zeichnet, behauptet genau die
   * Verbindung, die durch Systemtrennung ausgeschlossen sein muss.
   *
   * Der Generator benennt die Stutzen deshalb ausnahmslos. Die Nähe-Heuristik
   * bleibt als Rückfall für von Hand ergänzte Verbindungen.
   */
  fromPort?: string;
  toPort?: string;
  service: PipeService;
  /** Zwischenpunkte im Raster für rechtwinklige Führung. */
  waypoints?: Vec2[];
  label?: string;
  generated: boolean;
}

/** Ergebnis der Sicherheitsarmaturen-Auslegung nach DIN EN 12828. */
export interface SafetyDesign {
  /** Gesamtwasserinhalt der Anlage [l]. */
  systemVolume: number;
  /** Wasserinhalt aus Erzeuger, Speicher, Leitungen, Heizflächen [l]. */
  volumeParts: { label: string; volume: number }[];
  /** Statische Höhe [m] — höchster Punkt über dem Ausdehnungsgefäß. */
  staticHeight: number;
  /** Vordruck p0 [bar ü]. */
  prePressure: number;
  /** Fülldruck p_F [bar ü]. */
  fillPressure: number;
  /** Ansprechdruck des Sicherheitsventils [bar ü]. */
  safetyPressure: number;
  /** Enddruck p_e [bar ü]. */
  endPressure: number;
  /** Ausdehnungsvolumen V_e [l]. */
  expansionVolume: number;
  /** Wasservorlage V_WV [l]. */
  waterSeal: number;
  /** Rechnerisches Nennvolumen [l]. */
  requiredVessel: number;
  /** Nächste Baugröße aus der Reihe [l]. */
  selectedVessel: number;
  /** Nennweite des Sicherheitsventils. */
  safetyValve: { dn: number; label: string; maxCapacity: number };
  /** Nennweite der Ausdehnungsleitung [mm]. */
  expansionLine: number;
  /** Frostschutzanteil [Vol-%] und daraus folgende Korrekturen. */
  glycol?: { fraction: number; kind: 'ethylen' | 'propylen'; flowFactor: number; freezePoint: number };
  /** Weitere Pflichtarmaturen mit Begründung. */
  fittings: { kind: SchematicKind; label: string; spec: string; norm: string }[];
  /** Hinweise und Verstöße. */
  notes: { severity: 'info' | 'warn' | 'error'; text: string }[];
}

/** Ergebnis der Trinkwasser-Auslegung. */
export interface DomesticHotWaterDesign {
  /** Bedarfskennzahl N nach DIN 4708. */
  demandIndex: number;
  /** Personen und Wohneinheiten aus dem Modell. */
  occupants: number;
  units: number;
  /** Empfohlener Speicherinhalt [l]. */
  recommendedVolume: number;
  /** Aufheizleistung [kW] bei der gewählten Aufheizzeit. */
  reheatCapacity: number;
  /** Aufheizzeit [h]. */
  reheatTime: number;
  /** Speichertemperatur [°C] und Zapftemperatur [°C]. */
  storageTemperature: number;
  tapTemperature: number;
  /** Muss nach DVGW W 551 auf 60 °C gehalten werden? */
  legionellaRegime: 'kleinanlage' | 'großanlage';
  /** Begründung des Regimes. */
  legionellaReason: string;
  /** Zirkulation erforderlich (3-Liter-Regel DIN 1988-200)? */
  circulationRequired: boolean;
  circulationReason: string;
  notes: { severity: 'info' | 'warn' | 'error'; text: string }[];
}

/**
 * Die Anlage als Ganzes.
 *
 * Absichtlich getrennt von `site`: dort steht, *wo* die Wärmepumpe steht,
 * hier steht, *woran sie hängt*. Beides ändert sich unabhängig voneinander.
 */
/**
 * Betriebsweise eines zweiten Wärmeerzeugers.
 *
 * Die drei bivalenten Weisen sind im BDH-Infoblatt Nr. 57 definiert, und der
 * Unterschied ist hydraulisch, nicht regelungstechnisch: er entscheidet, ob
 * beide Erzeuger **gleichzeitig durchströmt** werden — und damit, ob sich die
 * Volumenströme addieren.
 *
 *  • `bivalent-parallel` — „Unterhalb des Bivalenzpunktes werden weitere
 *    Wärmeerzeuger **gleichzeitig** mit der Wärmepumpe betrieben."
 *  • `bivalent-alternativ` — „Unterhalb des Abschaltpunktes werden
 *    **ausschließlich** die anderen Wärmeerzeuger betrieben."
 *  • `bivalent-teilparallel` — zwischen Bivalenz- und Abschaltpunkt laufen
 *    beide, darunter nur noch der zweite. Braucht **zwei** Temperaturpunkte;
 *    ein einzelnes Feld „Bivalenzpunkt" reicht dafür nicht.
 *  • `monoenergetisch` — der zweite Erzeuger ist der Elektro-Heizstab im
 *    Gerät. Er ist kein eigener hydraulischer Kreis.
 */
export type BivalenzBetrieb =
  | 'monoenergetisch'
  | 'bivalent-parallel'
  | 'bivalent-alternativ'
  | 'bivalent-teilparallel';

/** Art des zweiten Wärmeerzeugers. */
export type ZweitErzeugerArt =
  | 'gas'
  | 'oel'
  | 'festbrennstoff'
  | 'pellet'
  | 'solarthermie'
  | 'elektro-heizstab'
  | 'fernwaerme';

export const ZWEITERZEUGER_LABELS: Record<ZweitErzeugerArt, string> = {
  gas: 'Gaskessel',
  oel: 'Ölkessel',
  festbrennstoff: 'Festbrennstoffkessel (Scheitholz)',
  pellet: 'Pelletkessel',
  solarthermie: 'Solarthermie',
  'elektro-heizstab': 'Elektro-Heizstab',
  fernwaerme: 'Fernwärme-Übergabestation',
};

/**
 * Ein zweiter Wärmeerzeuger neben der Wärmepumpe.
 *
 * Ohne dieses Feld konnte das Programm bis 1.13.2 vier Schemavorlagen des
 * BWP-Leitfadens gar nicht vorschlagen — Solar, Kessel, Festbrennstoff und
 * Kaskade standen im Katalog, waren aber unerreichbar, weil das Anlagenmodell
 * keine Möglichkeit hatte, sie zu behaupten.
 *
 * `einbindung` ist dabei die auslegungsrelevante Angabe: bei serieller
 * Einbindung in den Rücklauf liegt der zweite Erzeuger im selben Fließweg wie
 * die Wärmepumpe und braucht „weder eine Entladepumpe noch eine Regelung für
 * diese Pumpe"; bei paralleler Einbindung über eine Weiche ist es ein eigener
 * Kreis mit eigener Pumpe.
 */
export interface SecondGenerator {
  art: ZweitErzeugerArt;
  /** Nennleistung [kW] — Grundlage der Deckungsanteilrechnung nach VDI 4645 Anhang G. */
  leistung: number;
  betrieb: BivalenzBetrieb;
  /** Außentemperatur, ab der zugeschaltet wird [°C]. */
  bivalenzpunkt: number;
  /**
   * Außentemperatur, ab der die Wärmepumpe abschaltet [°C].
   *
   * Bei `bivalent-teilparallel` und `bivalent-alternativ` ein **zweiter,
   * anderer** Punkt als der Bivalenzpunkt. Leer bei parallel.
   */
  abschaltpunkt?: number;
  einbindung: 'ruecklauf-seriell' | 'vorlauf-parallel' | 'puffer-oben' | 'puffer-unten' | 'weiche';
  /** Hat der Erzeugerkreis eine eigene Pumpe? */
  eigenePumpe: boolean;
  /** Kollektorfläche [m²] — nur bei Solarthermie. */
  kollektorflaeche?: number;
  /** Heizungsseitiger Widerstand des Geräts; dieselbe Doppelnatur wie bei der Wärmepumpe. */
  hydraulics?: GeneratorHydraulics;
  note?: string;
}

/**
 * Mehrere gleichartige Wärmepumpen an einem Verteiler.
 *
 * Rechnerisch die unangenehmste Anlagenform: bei einer eigenen Pumpe je Gerät
 * ist der **ungünstigste Fließweg nicht mehr eindeutig** — jedes Gerät hat
 * seinen eigenen. „Eine Pumpe für alles" ist bei Kaskaden fachlich falsch.
 */
export interface CascadeDefinition {
  /** Zahl der Geräte; 1 heißt: keine Kaskade. */
  geraete: number;
  /**
   * Verrohrung der Erzeugerzweige.
   *
   * Viessmann für die Pufferspeicher-Kaskade: „Die Systemverrohrung … **muss
   * nach Tichelmann** erfolgen." Bei Stichverrohrung sind die Zweige
   * unterschiedlich lang und müssen abgeglichen werden.
   */
  verrohrung: 'tichelmann' | 'stich';
  /** Eine Sekundärpumpe je Gerät? */
  pumpeJeGeraet: boolean;
  /** Rückschlagklappe je Gerät gegen Rückströmen durch das abgeschaltete Gerät. */
  rueckschlagklappeJeGeraet: boolean;
  note?: string;
}

export interface PlantDefinition {
  /** Gewähltes Gerät aus dem Katalog. */
  generatorModelId?: string;
  /** Zugeordnete Wärmepumpe im Außengelände. */
  pumpId?: string;
  /**
   * Norm-Heizlast [kW], sobald sie vorliegt.
   *
   * Solange dieses Feld leer ist, rechnet die Anlagenauslegung mit dem
   * Überschlag aus `heatLoadEstimate`. Wer die Zahl aus RaVia einträgt,
   * schaltet den Überschlag ab — und zwar für alle Folgegrößen gleichzeitig,
   * damit nicht die Hälfte der Auslegung auf der einen und die andere Hälfte
   * auf der anderen Zahl steht.
   */
  heatLoadOverride?: number;
  /** Zusätzliche Geräte aus Datenblättern. */
  extraModels?: HeatPumpModel[];
  /**
   * Zweiter Wärmeerzeuger neben der Wärmepumpe.
   *
   * Er ist der Grund, warum vier Vorlagen des Schemakatalogs bis 1.13.2
   * unerreichbar waren: das Programm konnte eine Solaranlage oder einen
   * Kessel nicht *wissen*, also schlug es die zugehörigen Schemata nie vor.
   * Was das Programm nicht weiß, behauptet es nicht — aber wer es einträgt,
   * bekommt die passende Musterlösung.
   */
  secondGenerator?: SecondGenerator;
  /** Mehrere gleichartige Geräte an einem Verteiler. */
  cascade?: CascadeDefinition;
  /**
   * Kühlbetrieb über dieselbe Hydraulik.
   *
   * `passiv` ist die Soleumkehr über einen Wärmeübertrager ohne Verdichter,
   * `aktiv` die Kreislaufumkehr. Beide verlangen Taupunktüberwachung und
   * dampfdiffusionsdichte Dämmung — und beide haben eigene Schemavorlagen.
   */
  cooling?: 'keine' | 'passiv' | 'aktiv';
  /** Weiterer Verbraucher am selben Erzeuger, z. B. ein Schwimmbad. */
  additionalConsumer?: 'kein' | 'schwimmbad';
  /** Speicher der Anlage. */
  storages: Record<string, PlantStorage>;
  /** Heizkreise. */
  circuits: Record<string, HeatingCircuit>;
  /** Auslegungsdaten der Verteilung. */
  design: {
    /** Vorlauf/Rücklauf im Auslegungsfall [°C]. */
    flowTemperature: number;
    returnTemperature: number;
    /** Trinkwarmwasser-Speichertemperatur [°C]. */
    dhwTemperature: number;
    /** Zapftemperatur an der Entnahmestelle [°C]. */
    tapTemperature: number;
    /** Kaltwassertemperatur [°C]. */
    coldWaterTemperature: number;
    /** Werkstoff der Verteilleitungen. */
    material: PipeMaterial;
    /** Höchstzulässige Fließgeschwindigkeit [m/s]. */
    maxVelocity: number;
    /** Höchstzulässiges Druckgefälle [Pa/m]. */
    maxGradient: number;
    /** Frostschutzanteil im Heizkreis [Vol-%]. */
    glycolFraction: number;
    glycolKind: 'ethylen' | 'propylen';
  };
  /** Randbedingungen für die Sicherheitstechnik. */
  safety: {
    /** Höhe des höchsten Anlagenpunktes über dem Gefäß [m]. */
    staticHeight: number;
    /** Ansprechdruck des Sicherheitsventils [bar ü]. */
    safetyValvePressure: number;
    /** Höchste Vorlauftemperatur im Störfall [°C] — sie bestimmt n. */
    maxTemperature: number;
    /** Bereits vorhandenes Gefäß [l]; 0 = neu auslegen. */
    existingVessel: number;
    /**
     * Ist der Trinkwassererwärmer abgesichert?
     *
     * Vorbelegt `true`, weil die erzeugte Armaturenliste das Sicherheitsventil
     * nach DIN 4753 immer enthält. Auf `false` zu stellen ist der Fall
     * „vorhandener Speicher wird weiterverwendet" — dann muss jemand
     * nachsehen, ob dort tatsächlich ein bauteilgeprüftes Ventil sitzt.
     */
    dhwSecured: boolean;
  };
  /** Trinkwasser-Randbedingungen. */
  dhw: {
    /** Wohneinheiten im Gebäude. */
    units: number;
    /** Personen je Wohneinheit. */
    occupantsPerUnit: number;
    /** Komfortanspruch — er skaliert die Bedarfskennzahl. */
    comfort: 'sparsam' | 'normal' | 'komfort';
    /** Gewünschte Aufheizzeit [h]. */
    reheatTime: number;
    /** Inhalt der längsten Warmwasserleitung ab Abgang [l] — 3-Liter-Regel. */
    longestBranchContent: number;
  };
  /** Von Hand ergänzte oder verschobene Schema-Bauteile. */
  schematic: {
    components: Record<string, SchematicComponent>;
    links: Record<string, SchematicLink>;
    /** Wurde das Schema von Hand bearbeitet? Dann nicht mehr überschreiben. */
    manual: boolean;
    /**
     * Kennung der übernommenen Schemavorlage aus `schemaKatalog`.
     *
     * Sie ist die Antwort auf die Frage, die jeder stellt, der ein fremdes
     * Fließbild in die Hand bekommt: **welches Schema ist das?** Ohne sie ist
     * ein erzeugtes Bild anonym — es zeigt eine Anlage, aber nicht, nach
     * welcher Musterlösung sie gebaut ist.
     */
    vorlageId?: string;
  };
}

/** Ein konkret eingeplanter Speicher. */
export interface PlantStorage {
  id: string;
  modelId?: string;
  label: string;
  kind: StorageKind;
  volume: number;
  /** Aufstellort — Raum im Modell, falls zugeordnet. */
  roomId?: RoomId;
  /** Vom Programm vorgeschlagen (true) oder vom Planer gesetzt (false). */
  suggested: boolean;
  note?: string;
}
