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
  /**
   * Die Stärke ist **geschätzt**, nicht gemessen oder gesetzt.
   *
   * Gesetzt wird das vom Raumscan-Import: Apple RoomPlan misst Wände als
   * Flächen ohne Dicke, und der Import nimmt nach Lage am Bodenumriss 36,5 cm
   * außen und 11,5 cm innen an. Das ist eine brauchbare Annahme und trotzdem
   * eine Annahme — sie geht über die Bauteilfläche unmittelbar in den
   * Transmissionsverlust ein.
   *
   * Solange das Kennzeichen steht, bleibt der Schritt „Wandstärken
   * bestätigen" in der Aufgabenliste offen. Wer die Stärke von Hand setzt,
   * löscht es damit — eine gesetzte Zahl ist keine Schätzung mehr.
   */
  thicknessEstimated?: boolean;
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
 * Die Klartextnamen der Öffnungsarten.
 *
 * Bis 1.24.0 gab es sie nicht, und jede Oberfläche schrieb sich ihre eigenen
 * hin — mit den üblichen Folgen: „Durchgang" an einer Stelle, „Wandöffnung"
 * an der nächsten, und in der Meldung stand der englische Schlüssel.
 */
export const OPENING_LABELS: Record<OpeningKind, string> = {
  door: 'Tür',
  window: 'Fenster',
  passage: 'Durchgang',
};

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
   * Bodenbelag des Raums — Kennung aus `lib/bodenbelag.ts`.
   *
   * **Warum der Belag am Raum hängt und nicht am Heizkreis.** Bis 1.25.0
   * stand er ausschließlich an der Fußbodenheizung (`floorCoveringResistance`).
   * Damit hatte ein Raum ohne Flächenheizung überhaupt keinen Belag — im
   * Modell war jeder Boden dieselbe graue Fläche, und der Massenauszug
   * konnte nicht sagen, wie viel Fliese und wie viel Parkett zu verlegen
   * ist. Der Belag gehört aber zum Raum: er liegt dort, ob geheizt wird
   * oder nicht.
   *
   * Der Heizkreis liest ihn und übernimmt den Widerstand, solange an ihm
   * selbst nichts Abweichendes steht — dort darf weiterhin ein
   * Datenblattwert stehen, der den Listenwert schlägt.
   *
   * Fehlt das Feld, ist nichts erfasst. Das ist nicht dasselbe wie „kein
   * Belag": dafür gibt es den Eintrag `estrich` mit 0,00.
   */
  floorCovering?: string;
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
  | 'storage' // Speicher (Puffer, Trinkwasser, Kombi) — der Aufstellort
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

/**
 * Anschlussart eines Heizkörpers.
 *
 * Sie ist kein Schönheitsmerkmal: die Norm-Leistungsangabe gilt für den
 * Anschluss „oben/unten, wechselseitig". Ein Mittelanschluss oder ein
 * beidseitig unten angeschlossener Heizkörper überträgt bei gleicher
 * Übertemperatur weniger — die Hersteller geben dafür Korrekturfaktoren an.
 * Wer die Anschlussart nicht mitliefert, zwingt den Rechenkern, sie
 * anzunehmen.
 */
export type RadiatorConnection =
  /** Oben/unten wechselseitig — der Anschluss, für den die Normleistung gilt. */
  | 'wechselseitig'
  /** Beidseitig unten (Zweirohr, klassischer Ventilheizkörper). */
  | 'unten'
  /** Mittelanschluss (Ventilheizkörper mit Anschluss in der Mitte). */
  | 'mitte'
  /** Oben/unten gleichseitig. */
  | 'gleichseitig';

export const RADIATOR_CONNECTION_LABELS: Record<RadiatorConnection, string> = {
  wechselseitig: 'oben/unten wechselseitig',
  unten: 'Seitenanschluss unten, beidseitig',
  mitte: 'Mittelanschluss unten',
  gleichseitig: 'oben/unten gleichseitig',
};

/**
 * Auf welcher Seite das Ventil sitzt — **von vorn auf den Heizkörper gesehen**.
 *
 * **Warum das ein eigenes Feld ist und nicht in der Anschlussart steckt.** Die
 * Anschlussart sagt, *wo* Vor- und Rücklauf ankommen (unten mittig, unten an
 * den Enden, oben und unten). Die Ventilseite sagt, *an welchem Ende* die
 * Absperrung sitzt. Beides ist unabhängig: ein Mittelanschluss kann das
 * Ventil links oder rechts haben, ein Seitenanschluss auch. Führte man beides
 * in einer Liste, stünden dort acht Einträge, von denen die Hälfte nie
 * gebraucht wird — und man müsste bei jeder neuen Anschlussart alle Seiten
 * nachziehen.
 *
 * **Wofür es gebraucht wird.** Für die Anbindung: die Leitung muss auf der
 * richtigen Seite hochkommen. Wer das erst auf der Baustelle merkt, hat den
 * Estrich schon geschlossen. Gerechnet wird damit nichts — die Angabe geht
 * in Plan, Massenauszug und Export.
 *
 * Die Sicht ist festgelegt: **von vorn auf den Heizkörper**, also aus dem
 * Raum. Ohne diese Festlegung heißt „links" bei zwei Leuten zweierlei.
 */
export type VentilSeite = 'links' | 'rechts';

export const VENTILSEITE_LABELS: Record<VentilSeite, string> = {
  links: 'Ventil links',
  rechts: 'Ventil rechts',
};

/**
 * Woher die Leistung eines Bauteils stammt.
 *
 * **Der Fehler, den dieses Feld beendet.** `addFixture` kopierte bis 1.23.0
 * die Vorbelegung aus der Symbolbibliothek — beim Heizkörper 1200 W — als
 * echten Wert ins Objekt. Danach war die Katalogzahl von einem abgelesenen
 * Datenblattwert nicht mehr zu unterscheiden. Die Folgen trafen ausgerechnet
 * die Stellen, die Herkunft ausweisen *wollen*: Der Abgleich setzte
 * `assumed: false`, weil ja ein Wert dastand, und die ganze Kennzeichnung
 * angenommener Leistungen lief ins Leere. Der Übergabedatensatz an RaVia
 * meldete `herkunft: 'eingegeben'` für eine Zahl, die niemand eingegeben
 * hatte. Und die Prüfung „Heizfläche ohne Leistung" konnte nie zutreffen.
 *
 * **Was daran hängt.** Nur `katalog` und `heizlast` dürfen automatisch
 * nachgezogen werden. Alles andere hat ein Mensch oder eine rechnende
 * Gegenstelle gesetzt und bleibt stehen — auch dann, wenn es nicht zur
 * Heizlast passt. Ein Werkzeug, das einen abgelesenen Datenblattwert
 * überschreibt, ist schlimmer als eines, das gar nichts vorschlägt.
 */
export type LeistungHerkunft =
  /** Vorbelegung aus der Symbolbibliothek — eine Platzhalterzahl, kein Messwert. */
  | 'katalog'
  /** Aus der Raumheizlast abgeleitet, auf den Normpunkt umgerechnet. */
  | 'heizlast'
  /** Von Hand eingetragen oder aus einem Datenblatt übernommen. */
  | 'datenblatt'
  /** Von RaVia zurückgeschrieben — dort wurde gerechnet, hier nicht. */
  | 'ravia';

export const LEISTUNG_HERKUNFT_LABELS: Record<LeistungHerkunft, string> = {
  katalog: 'Vorbelegung aus dem Katalog',
  heizlast: 'aus der Raumheizlast geschätzt',
  datenblatt: 'eingetragen bzw. aus dem Datenblatt',
  ravia: 'von RaVia berechnet',
};

/** Darf diese Leistung automatisch nachgezogen werden? */
export function leistungNachziehbar(h: LeistungHerkunft | undefined): boolean {
  return h === 'katalog' || h === 'heizlast';
}

export interface FixtureParams {
  /** Heizung: Normwärmeleistung [W] bei 55/45/20 °C. */
  powerW?: number;
  /**
   * Woher `powerW` stammt.
   *
   * Fehlt die Angabe, gilt die Leistung als **eingetragen** (`datenblatt`) —
   * nicht als Katalogwert. Grund: Projekte aus älteren Fassungen tragen das
   * Feld nicht, und in ihnen hat der Anwender die Zahlen tatsächlich
   * gepflegt. Sie im Nachhinein für überschreibbar zu erklären, wäre der
   * eine Fehler, den dieses Feld auf keinen Fall machen darf.
   */
  powerSource?: LeistungHerkunft;
  /** Heizung: Bautiefe/Typ, z. B. "22" für Typ 22. */
  radiatorType?: string;
  /** Heizung: Vor-/Rücklauftemperatur [°C]. */
  flowTemperature?: number;
  returnTemperature?: number;
  /**
   * Heizung: **Heizkörperexponent n** aus dem Datenblatt [-].
   *
   * **Warum dieses Feld die wichtigste Ergänzung für den Rechenkern ist.**
   * `powerW` ist die Normleistung bei genau 55/45/20 °C. Eine Wärmepumpe
   * fährt aber 35/28 oder 45/38 — und eine Normleistung lässt sich ohne den
   * Exponenten **nicht** auf eine andere Übertemperatur umrechnen. Die
   * Beziehung lautet (EN 442-2):
   *
   *     Q = Q_norm · (Δθ / Δθ_norm)^n
   *
   * mit Δθ als logarithmischer Übertemperatur. Ohne n fehlt dem Rechenkern
   * der Exponent dieser Potenz; er kann dann entweder nichts rechnen oder
   * muss selbst etwas annehmen — und eine Annahme, die zweimal unabhängig
   * getroffen wird, ist zweimal anders.
   *
   * Der Wert steht im Datenblatt des Herstellers. Ohne Angabe bleibt das Feld
   * **leer**; der Export nennt dann den branchenüblichen Richtwert
   * ausdrücklich als Annahme (siehe `EMITTER_EXPONENT_ANNAHME`), statt ihn
   * als Messwert auszugeben.
   */
  radiatorExponent?: number;
  /** Heizung: Bauhöhe des Heizkörpers [m] — Datenblattmaß, nicht geschätzt. */
  radiatorHeight?: number;
  /** Heizung: Zahl der Glieder bzw. Elemente [-]; bei Plattenheizkörpern leer. */
  radiatorSections?: number;
  /** Heizung: Anschlussart — bestimmt den Korrekturfaktor der Leistung. */
  radiatorConnection?: RadiatorConnection;
  /**
   * Heizung: Auf welcher Seite das Ventil sitzt, von vorn gesehen.
   *
   * Rein ausführungsrelevant: Es geht in Plan, Massenauszug und Export, aber
   * in keine Rechnung. Fehlt die Angabe, ist sie nicht erfasst — nicht
   * „rechts".
   */
  valveSide?: VentilSeite;
  /**
   * Heizung: Speicherinhalt [l] am Aufstellort.
   *
   * Maßgebend ist die Auslegung in der Anlage; dieser Wert beschreibt, was
   * dort im Raum steht, und bestimmt die Stellfläche.
   */
  volumeL?: number;
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
  /**
   * Heizung: An welchem Heizkreisverteiler diese Heizfläche hängt
   * (`Fixture.id` des Verteilers).
   *
   * **Wozu das Feld überhaupt da ist.** Bei einem Verteiler je Geschoss ist
   * die Frage beantwortet, bevor sie gestellt wird. Bei zweien nicht — und
   * die Trassierung hängte bis 1.30.0 stillschweigend alles an den ersten.
   * Ohne Angabe wird jetzt der **nächstgelegene** genommen und die Annahme
   * gemeldet; wer es besser weiß, trägt es hier ein.
   *
   * Absichtlich keine Pflichtangabe: In den allermeisten Wohngebäuden gibt
   * es einen Verteiler je Geschoss, und ein Pflichtfeld, das fast immer
   * dieselbe Antwort hat, wird nicht gepflegt, sondern weggeklickt.
   */
  manifoldId?: string;
  /** Fußbodenheizung: Verlegeabstand [m]. */
  loopSpacing?: number;
  /**
   * Fußbodenheizung: **Wärmedurchlasswiderstand des Bodenbelags R_λB**
   * [m²·K/W].
   *
   * Die zweite Größe, ohne die der Rechenkern eine Fußbodenheizung nicht
   * auslegen kann. Das Kennfeld nach DIN EN 1264-2 hängt an drei Eingängen:
   * Verlegeabstand, Estrichüberdeckung **und** R_λB. Derselbe Kreis trägt
   * unter Fliesen (R_λB ≈ 0,00) rund ein Drittel mehr als unter Teppich
   * (0,15) — das ist der Unterschied zwischen „reicht" und „reicht nicht".
   *
   * Übliche Werte: Fliese/Naturstein 0,00 · Parkett 10 mm 0,06 ·
   * Laminat 0,05 bis 0,10 · Teppich 0,10 bis 0,15 · PVC 0,02.
   */
  floorCoveringResistance?: number;
  /** Fußbodenheizung: Estrichüberdeckung über dem Rohrscheitel [m]. */
  screedCover?: number;
  /** Fußbodenheizung: Rohraußendurchmesser [m], z. B. 0,017 für 17 × 2. */
  pipeOuterDiameter?: number;
  /** Fußbodenheizung: Rohrwandstärke [m], z. B. 0,002 für 17 × 2. */
  pipeWallThickness?: number;
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
  /*
   * Der Speicher ist hier der **Aufstellort**, nicht das Gerät.
   *
   * Das Gerät mit Volumen, Bauart und Anschlüssen steht in der Anlage
   * (`PlantDefinition.storages`) — dort wird es ausgelegt, dort steht die
   * maßgebende Zahl. Was im Grundriss fehlte, war die Antwort auf die andere
   * Frage: *wo* steht er, und passt er da überhaupt hin. Genau dieselbe
   * Trennung gilt schon beim Wärmeerzeuger, und aus demselben Grund.
   *
   * `volumeL` steht trotzdem daneben, weil die Stellfläche vom Volumen
   * abhängt und man im Raum eine Zahl sehen will. Maßgebend bleibt die
   * Auslegung; weicht beides ab, meldet die Prüfung es.
   */
  { type: 'storage', category: 'heating', label: 'Speicher', length: 0.7, depth: 0.7, elevation: 0, wallMounted: false, params: { volumeL: 300 } },
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
   * Wird dieses Geschoss im Modell gezeigt?
   *
   * **Warum das am Geschoss steht und nicht an einer Ebene.** Der Grundriss
   * zeigt immer *ein* Geschoss, das Modell bisher immer *alle* — und genau
   * darin lagen Erdgeschoss, Obergeschoss und Keller auseinander: Wer im
   * Keller arbeitete, sah im Plan den Keller und im Modell das ganze Haus
   * darüber. Eine Ebene taugt dafür nicht: Ebenen ordnen nach Gewerk, und
   * ein Geschoss ist kein Gewerk.
   *
   * Fehlt das Feld, ist das Geschoss sichtbar. Ältere Projekte kennen es
   * nicht, und „nicht eingetragen" darf nicht wie „ausgeblendet" wirken —
   * sonst öffnet sich eine alte Datei mit leerem Modell.
   *
   * Das **aktive** Geschoss wird immer gezeigt, auch wenn es hier
   * ausgeblendet ist: Man bearbeitet nicht, was man nicht sieht.
   */
  visible?: boolean;
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
export type RoofKind =
  | 'flat'
  | 'gable'
  | 'monopitch'
  | 'hip'
  | 'krueppelwalm'
  | 'mansard'
  | 'flat-sloped';

export const ROOF_KIND_LABELS: Record<RoofKind, string> = {
  flat: 'Flachdach / horizontale Decke',
  gable: 'Satteldach',
  monopitch: 'Pultdach',
  hip: 'Walmdach',
  krueppelwalm: 'Krüppelwalmdach',
  mansard: 'Mansarddach',
  'flat-sloped': 'Flachdach mit Gefälle',
};

/**
 * Welche Dachformen ergeben sich aus dem Umriss, statt eine eigene Form zu sein?
 *
 * Das ist keine Spitzfindigkeit, sondern spart die Hälfte der Liste. Die
 * Höhenfunktion des Walmdachs über einem bekannten Gebäudeumriss lautet seit
 * 1.27.0
 *
 *     h(p) = Kniestock + Abstand(p, Umriss) · Steigung
 *
 * und das ist die Höhenfunktion des Straight Skeleton. Aus ihr entstehen
 * von selbst:
 *
 *  · **Zeltdach** — Walmdach über einem quadratischen Umriss. Der First
 *    schrumpft zum Punkt, weil alle vier Kanten gleich weit entfernt sind.
 *  · **Walmkehldach** — Walmdach über einem L oder T. Im einspringenden
 *    Winkel entsteht eine Kehle, an den Schenkelenden je ein Walm.
 *  · **Kreuzdach** — Walmdach über einem Kreuz: vier Grate, vier Kehlen.
 *  · **Pyramidendach** — dasselbe wie das Zeltdach; der Name meint den
 *    quadratischen Grundriss.
 *
 * Wer für diese vier eigene Aufzählungswerte anlegte, bekäme vier Formeln,
 * die dasselbe rechnen — und vier Stellen, an denen es künftig auseinander
 * läuft. Sie stehen deshalb hier als Auskunft und nicht dort als Form.
 */
export const DACHFORMEN_AUS_UMRISS: readonly { name: string; umriss: string }[] = [
  { name: 'Zeltdach / Pyramidendach', umriss: 'Walmdach über quadratischem Grundriss' },
  { name: 'Walmkehldach', umriss: 'Walmdach über L- oder T-Grundriss' },
  { name: 'Kreuzdach', umriss: 'Walmdach über kreuzförmigem Grundriss' },
];

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
  /**
   * Nur Krüppelwalmdach: Wie viel vom Giebeldreieck ist abgewalmt? [-] 0…1.
   *
   * 0 wäre ein reines Satteldach, 1 ein volles Walmdach — der Krüppelwalm
   * liegt dazwischen und ist genau dadurch definiert. Gemessen wird vom First
   * abwärts: 0,5 heißt, die obere Hälfte des Giebels ist gewalmt, die untere
   * bleibt senkrechte Giebelwand.
   *
   * **Warum ein Anteil und keine Höhe.** Eine Höhe müsste nachgezogen werden,
   * sobald sich Neigung, Kniestock oder Spannweite ändern — sonst stünde der
   * Walm plötzlich über dem First oder unter der Traufe. Der Anteil bleibt in
   * jedem Fall gültig.
   *
   * Ohne Angabe 0,5. Das ist die Größenordnung, die man im Bestand antrifft;
   * eine Normvorgabe gibt es nicht.
   */
  hipRatio?: number;
  /**
   * Nur Mansarddach: Neigung der **oberen**, flachen Dachfläche [°].
   *
   * Beim Mansarddach ist `pitch` die untere, steile Fläche — sie ist die
   * kennzeichnende und die, die den Wohnraum schafft. Ohne Angabe 30°.
   */
  upperPitch?: number;
  /**
   * Nur Mansarddach: Höhe des Mansardknicks über Rohfußboden [m].
   *
   * Dort geht die steile untere Fläche in die flache obere über. Ohne Angabe
   * 2,20 m — die Höhe, in der der Knick den Raum tatsächlich nutzbar macht.
   */
  knickHeight?: number;
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
  /**
   * Das Bitmap wird seitenverkehrt aufgetragen.
   *
   * Ein Grundriss kommt oft spiegelverkehrt herein — von der Rückseite
   * abfotografiert, aus einem Scanner mit vertauschter Achse. Wer den Plan
   * dann spiegelt, spiegelt die Geometrie; das Bild darunter bliebe stehen
   * und passte nicht mehr dazu. Deshalb trägt das Bild die Umkehr selbst,
   * statt dass irgendwo ein zweites Bitmap entsteht: das Original bleibt
   * unangetastet, und der Schritt ist umkehrbar.
   *
   * Der Rahmen (`origin`, `rotation`) beschreibt unverändert die Lage der
   * Bildfläche im Modell — gespiegelt wird *innerhalb* dieses Rahmens, um
   * die Hochachse.
   */
  gespiegelt?: boolean;
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

/**
 * Ein Freihandstrich, wie er unter dem Stift entsteht.
 *
 * Punkte in **Weltkoordinaten** und nicht in Bildpunkten: Ein Strich, der in
 * Bildpunkten abgelegt wäre, läge nach dem nächsten Zoomen woanders. Der
 * Druck reist mit, wo das Gerät ihn meldet — er steuert die Strichstärke der
 * Notiz und sonst nichts.
 */
export interface Freihandstrich {
  id: string;
  levelId: LevelId;
  punkte: Vec2[];
  /** Stiftdruck je Punkt [0…1]; leer, wenn das Gerät keinen meldet. */
  druck?: number[];
  /** Strichfarbe als Kennung, nicht als Hexwert — die Ebene bestimmt sie. */
  farbe?: 'tinte' | 'rot' | 'gruen' | 'gelb';
  /** Strichstärke [mm auf dem Blatt]. */
  staerke?: number;
  createdAt: string;
}

/**
 * Der Stand der Freihanderkennung — ein **Vorschlag**, kein Modellinhalt.
 *
 * Dieselbe Bauart wie `TraceState` bei der Bilderkennung, und aus demselben
 * Grund: Was eine Erkennung liefert, wird angezeigt, geprüft und erst dann
 * übernommen. Ein Strich, der ungefragt Wände anlegt, ist beim ersten
 * Fehlgriff nicht mehr zu bändigen — und ein Fehlgriff ist bei einer
 * Freihandskizze die Regel und nicht die Ausnahme.
 */
export interface SkizzenZug {
  /** Der rohe Strich — er bleibt sichtbar, damit man vergleichen kann. */
  strich: Vec2[];
  /** Wie viele Strecken dieser Zug zum Vorschlag beigesteuert hat. */
  anzahl: number;
  ring: boolean;
}

export interface SkizzenVorschlag {
  /** Die erkannten Strecken **aller** Züge in Weltkoordinaten. */
  strecken: { a: Vec2; b: Vec2; laenge: number; ausgerichtet: boolean }[];
  /**
   * Die einzelnen Züge, in der Reihenfolge, in der sie gezogen wurden.
   *
   * **Warum mehrere.** Ein Grundriss entsteht nicht in einem Strich. Wer die
   * Außenwände umfährt und danach die Innenwände einzeichnet, zieht drei,
   * vier, fünf Striche — und bis 1.18.0 warf jeder neue Strich den vorigen
   * Vorschlag weg, weil hier genau einer Platz hatte. Schlimmer noch: ein
   * misslungener Kurzstrich löschte den fertigen Vorschlag davor gleich mit.
   * Für den Anwender sah das aus, als könne man „nicht in einem
   * durchzeichnen".
   *
   * Die Züge bleiben einzeln erhalten, damit sich der letzte zurücknehmen
   * lässt, ohne alles zu verlieren.
   */
  zuege: SkizzenZug[];
  levelId: LevelId;
  /** Hat **einer** der Züge einen geschlossenen Umriss ergeben? */
  ring: boolean;
  /** Um wie viel der Strich gedreht lag [°]. */
  drehungGrad: number;
  hinweise: string[];
  /** Wandstärke, mit der die Vorschläge angelegt würden [m]. */
  staerke: number;
  /** Wandart der Vorschläge. */
  art: WallType;
}

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
// Durchbrüche und Bohrungen
// ===========================================================================

export type DurchbruchKind =
  | 'kernbohrung' // Rundbohrung in der Wand, gebohrt
  | 'wanddurchbruch' // rechteckiger Ausbruch in der Wand, gestemmt oder gesägt
  | 'schlitz' // Wandschlitz für eine aufliegende Leitung
  | 'deckendurchbruch'; // Loch in der Geschossdecke

export const DURCHBRUCH_LABELS: Record<DurchbruchKind, string> = {
  kernbohrung: 'Kernbohrung',
  wanddurchbruch: 'Wanddurchbruch',
  schlitz: 'Wandschlitz',
  deckendurchbruch: 'Deckendurchbruch',
};

/** Wird die Wand durchstoßen oder die Decke? Folgt aus der Art. */
export type DurchbruchWirt = 'wand' | 'decke';

export function durchbruchWirt(kind: DurchbruchKind): DurchbruchWirt {
  return kind === 'deckendurchbruch' ? 'decke' : 'wand';
}

export type DurchbruchForm = 'rund' | 'rechteckig';

/**
 * Feuerwiderstand, den die Schottung im Durchbruch leisten muss.
 *
 * Bewusst als Anforderung und nicht als Produkt: welches Schott gesetzt wird,
 * entscheidet der Ausführende nach seiner Zulassung. Was der Plan liefern
 * muss, ist die Anforderung — und zwar so, dass sie im Massenauszug steht.
 */
export type Brandschutzklasse = 'keine' | 'R30' | 'R60' | 'R90' | 'R120';

export const BRANDSCHUTZ_LABELS: Record<Brandschutzklasse, string> = {
  keine: 'ohne Anforderung',
  R30: 'R 30',
  R60: 'R 60',
  R90: 'R 90',
  R120: 'R 120',
};

/**
 * Ein Durchbruch im Modell — und warum er ein eigenes Bauteil ist.
 *
 * Eine Kernbohrung ließe sich auch als Loch in der Anzeige führen: man malt
 * einen Kreis in die Wand, und in 3D fehlt dort Material. Das reicht genau so
 * lange, bis jemand danach bohrt. Dann braucht er die Nennweite, die Höhe über
 * Fertigfußboden, die Wand, in der gebohrt wird, und die Anforderung an die
 * Schottung — und all das steht in keinem Loch, sondern nur in einem Bauteil.
 *
 * **Warum nicht als weitere `OpeningKind`.** Eine Öffnung ist ein Bauteil mit
 * Fläche, U-Wert und Orientierung: Fenster und Türen mindern die Wandfläche
 * und gehen als eigene Hüllfläche in die Heizlast ein. Eine Kernbohrung von
 * 100 mm tut das nicht — sie ist wärmetechnisch belanglos, aber
 * ausführungsrelevant. Führte man sie als Öffnung, zöge sie stillschweigend
 * 0,008 m² von der Wandfläche ab, erschiene in der Hüllflächenliste des
 * Exports und verlangte einen U-Wert, den niemand angeben kann. Umgekehrt
 * bekäme ein Durchbruch alles, was eine Öffnung mitbringt — Anschlag,
 * Flügelzahl, g-Wert —, und nichts, was er braucht.
 *
 * **Was der Typ leisten muss.** Er sitzt parametrisch in seinem Wirtsbauteil
 * (Wand: Abstand auf der Wandachse wie bei `Opening`; Decke: Punkt im
 * Grundriss), er erscheint im Plan mit Maß und Höhenangabe, er zählt im
 * Massenauszug nach Nennweite und Brandschutzklasse, und beim Deckendurchbruch
 * fehlt in 3D tatsächlich Material in der Platte.
 */
export interface Durchbruch {
  id: string;
  kind: DurchbruchKind;
  name: string;
  /** Geschoss. Beim Deckendurchbruch das Geschoss **unter** der Decke. */
  levelId: LevelId;
  /**
   * Die durchbrochene Wand. Steht nur bei wandgebundenen Arten.
   *
   * Fehlt die Wand im Dokument (gelöscht, nie gesetzt), ist der Durchbruch
   * verwaist. Die Prüfung meldet das als `durchbruch.orphan`; stillschweigend
   * gelöscht wird er nicht — ein Loch, das jemand eingetragen hat, verschwindet
   * nicht dadurch, dass die Wand neu gezogen wurde.
   */
  wallId?: WallId;
  /** Distanz vom Wandstart (Knoten a) bis zur Durchbruchsmitte [m]. */
  distance?: number;
  /** Mittelpunkt im Grundriss [m] — nur beim Deckendurchbruch. */
  position?: Vec2;
  /** Drehung [°] CCW — nur beim rechteckigen Deckendurchbruch. */
  rotation?: number;
  form: DurchbruchForm;
  /** Lichter Durchmesser [m] bei runder Form. */
  diameter?: number;
  /**
   * Erstes Rechteckmaß [m] — **in der Ebene des durchbrochenen Bauteils**.
   * In der Wand: Breite waagerecht entlang der Wandachse.
   * In der Decke: Ausdehnung in x-Richtung bei `rotation = 0`.
   */
  width?: number;
  /**
   * Zweites Rechteckmaß [m], ebenfalls in der Bauteilebene.
   * In der Wand: lichte Höhe.
   * In der Decke: Ausdehnung in y-Richtung bei `rotation = 0`.
   */
  height?: number;
  /**
   * Unterkante bzw. Achshöhe über OK Fertigfußboden [m] — nur wandgebunden.
   *
   * Bei runder Form ist es die **Achshöhe** (danach wird angerissen), bei
   * rechteckiger die **Unterkante** (danach wird gestemmt). Der Unterschied
   * steht hier und nicht in zwei Feldern, weil auf der Baustelle nie beides
   * zugleich gebraucht wird — aber die Anzeige muss ihn benennen.
   */
  sillHeight?: number;
  /** Gewerk, das hindurchgeführt wird. */
  service?: ShaftService;
  /** Nennweite der durchgeführten Leitung [mm] — reine Angabe, kein Maß. */
  dn?: number;
  /** Geforderter Feuerwiderstand der Schottung. */
  brandschutz?: Brandschutzklasse;
  /** Freitext zur Ausführung — geht in den Massenauszug als Bemerkung. */
  note?: string;
  /**
   * Von der Rohrnetzauslegung erzeugt.
   *
   * Erzeugte Durchbrüche werden bei der nächsten Auslegung ersetzt, von Hand
   * gesetzte nie. Ohne die Unterscheidung müsste man nach jeder Änderung der
   * Trasse alle Bohrungen von Hand nachziehen — oder es bliebe eine Bohrung
   * an einer Wand stehen, durch die längst keine Leitung mehr geht.
   *
   * Wer einen erzeugten Durchbruch verschiebt, macht ihn damit zu seinem:
   * das Merkmal fällt weg, und die nächste Auslegung lässt ihn stehen.
   */
  generated?: boolean;
}

/**
 * Regelmaße für Durchbrüche.
 *
 * Bewusst als Daten und nicht als Sonderfälle im Code — dieselbe Entscheidung
 * wie bei `OPENING_PRESETS`, und aus demselben Grund: ein Betrieb, der andere
 * Bohrkronen vorhält, ersetzt diese Liste, ohne die Zeichenlogik anzufassen.
 *
 * Die Durchmesser sind **Bohrkronenmaße**, nicht Rohrmaße. Der lichte
 * Durchbruch muss Rohr, Dämmung und Luft aufnehmen; die hier angegebenen
 * Werte gehen von einer üblichen Dämmstärke aus. Wer nach EnEV-Vollmaß dämmt,
 * braucht die nächstgrößere Krone — deshalb steht die Nennweite als eigenes
 * Feld daneben und wird nicht aus dem Durchmesser zurückgerechnet.
 */
export interface DurchbruchPreset {
  id: string;
  label: string;
  kind: DurchbruchKind;
  form: DurchbruchForm;
  diameter?: number;
  width?: number;
  height?: number;
  sillHeight?: number;
  service?: ShaftService;
  dn?: number;
}

export const DURCHBRUCH_PRESETS: DurchbruchPreset[] = [
  // --- Kernbohrungen, Heizung/Sanitär ---
  { id: 'kb-dn20', label: 'Kernbohrung Ø 68 (DN 20)', kind: 'kernbohrung', form: 'rund', diameter: 0.068, sillHeight: 0.3, service: 'heating', dn: 20 },
  { id: 'kb-dn25', label: 'Kernbohrung Ø 82 (DN 25)', kind: 'kernbohrung', form: 'rund', diameter: 0.082, sillHeight: 0.3, service: 'heating', dn: 25 },
  { id: 'kb-dn32', label: 'Kernbohrung Ø 102 (DN 32)', kind: 'kernbohrung', form: 'rund', diameter: 0.102, sillHeight: 0.3, service: 'heating', dn: 32 },
  { id: 'kb-dn50', label: 'Kernbohrung Ø 127 (DN 50)', kind: 'kernbohrung', form: 'rund', diameter: 0.127, sillHeight: 0.3, service: 'sanitary', dn: 50 },
  { id: 'kb-dn100', label: 'Kernbohrung Ø 152 (DN 100)', kind: 'kernbohrung', form: 'rund', diameter: 0.152, sillHeight: 0.15, service: 'sanitary', dn: 100 },
  { id: 'kb-lueftung', label: 'Kernbohrung Ø 162 (Lüftung)', kind: 'kernbohrung', form: 'rund', diameter: 0.162, sillHeight: 2.2, service: 'ventilation', dn: 160 },
  { id: 'kb-elektro', label: 'Kernbohrung Ø 52 (Elektro)', kind: 'kernbohrung', form: 'rund', diameter: 0.052, sillHeight: 0.3, service: 'electric', dn: 40 },
  // --- Rechteckige Wanddurchbrüche ---
  { id: 'wd-klein', label: 'Wanddurchbruch 30 × 30', kind: 'wanddurchbruch', form: 'rechteckig', width: 0.3, height: 0.3, sillHeight: 0.1, service: 'mixed' },
  { id: 'wd-mittel', label: 'Wanddurchbruch 50 × 30', kind: 'wanddurchbruch', form: 'rechteckig', width: 0.5, height: 0.3, sillHeight: 0.1, service: 'mixed' },
  { id: 'wd-trasse', label: 'Wanddurchbruch Trasse 80 × 40', kind: 'wanddurchbruch', form: 'rechteckig', width: 0.8, height: 0.4, sillHeight: 2.3, service: 'mixed' },
  // --- Schlitze ---
  { id: 'sz-waagerecht', label: 'Wandschlitz 20 × 8', kind: 'schlitz', form: 'rechteckig', width: 0.2, height: 0.08, sillHeight: 0.3, service: 'heating' },
  // --- Deckendurchbrüche ---
  { id: 'dd-strang', label: 'Deckendurchbruch 30 × 30', kind: 'deckendurchbruch', form: 'rechteckig', width: 0.3, height: 0.3, service: 'mixed' },
  { id: 'dd-schacht', label: 'Deckendurchbruch 60 × 40', kind: 'deckendurchbruch', form: 'rechteckig', width: 0.6, height: 0.4, service: 'mixed' },
  { id: 'dd-rund', label: 'Deckenbohrung Ø 152', kind: 'deckendurchbruch', form: 'rund', diameter: 0.152, service: 'sanitary', dn: 100 },
];

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
  /** Verlegehöhe über Fertigfußboden [m] — am **Anfang** des Abschnitts. */
  elevation: number;
  /**
   * Verlegehöhe am **Ende** des Abschnitts [m]. Fehlt: waagerecht.
   *
   * **Warum der senkrechte Meter ein eigenes Feld braucht.** Bis 1.23.0 trug
   * ein Abschnitt genau eine Höhe. Zwei Leitungen auf verschiedenen Höhen —
   * der Vorlauf unter der Decke, die Anbindung am Sockel — standen damit
   * zwar beide im Modell, aber das Stück dazwischen existierte nirgends:
   * nicht in der Zeichnung, nicht in den Metern des Massenauszugs, nicht im
   * Druckverlust. Der Massenauszug sagte es sogar selbst in der Bemerkung
   * („Trassenlänge in der Grundrissebene, ohne Höhenversatz") — ehrlich
   * deklariert und trotzdem eine Lücke, denn im Altbau ist der Fallstrang in
   * der Zimmerecke der Normalfall, nicht die Ausnahme.
   *
   * **Warum eine zweite Höhe und kein eigenes Bauteil „Steigstrang".** Ein
   * eigenes Bauteil hätte eine zweite Art von Leitung geschaffen, mit
   * eigener Auslegung, eigener Dämmpflicht, eigenem Bericht — und mit der
   * Frage, was an der Nahtstelle gilt. Eine zweite Höhe ändert dagegen nur
   * **eine** Größe, und zwar genau die, die falsch war: die Länge.
   *
   *     l = √(Trassenlänge² + Δh²)
   *
   * Ein reiner Steigstrang ist damit ein Abschnitt, dessen beide Punkte im
   * Grundriss (fast) aufeinanderliegen und dessen Höhen sich unterscheiden.
   * Die Steigung verteilt sich gleichmäßig über die Trasse; wer ein
   * abschnittsweise anderes Gefälle braucht, legt zwei Abschnitte — das ist
   * die ehrlichere Abbildung als eine Neigung, die nur an einem Ende stimmt.
   */
  elevationTo?: number;
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
  /**
   * Kennung der Doppelleitung, zu der dieser Abschnitt gehört.
   *
   * **Warum das Paar eine Kennung braucht.** Vor- und Rücklauf liegen im
   * Bau nebeneinander in einem Kanal, einer Schlitzung, einem Loch. Bis
   * 1.25.0 entstand das Paar nur beim automatischen Auslegen, und zwar als
   * zwei Leitungen 5 cm nebeneinander — zusammengehörig ausschließlich
   * dadurch, dass sie zufällig parallel lagen. Wer eine davon verschob,
   * hatte einen Vorlauf im Flur und einen Rücklauf im Zimmer; wer eine
   * löschte, hatte eine Heizung, die nur hinführt.
   *
   * Mit der Kennung wandert und verschwindet das Paar gemeinsam, und der
   * Massenauszug kann sagen, wie viel Meter **Trasse** zu bauen sind — was
   * für Kanal, Dämmung und Bohrung die maßgebliche Zahl ist — statt nur,
   * wie viel Meter Rohr zu bestellen sind.
   */
  pairId?: string;
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
  /**
   * **Wahre** Rohrlänge [m] — Trasse und Höhenversatz zusammen.
   *
   * Bis 1.23.0 stand hier die reine Grundrisslänge. Ein Fallstrang von
   * 2,40 m hatte damit eine Länge von null und fehlte in der Bestellung
   * vollständig.
   */
  length: number;
  /** Davon senkrecht bzw. geneigt [m] — der Anteil, der im Grundriss fehlt. */
  riseLength?: number;
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
  /**
   * Heizungsseitige Anschlussgröße des Geräts, im Klartext — z. B. „G 1¼ AG".
   *
   * Die Herstellerangabe, so wie sie im Datenblatt steht. Sie geht in das
   * Anlagenbuch und in den Massenauszug.
   */
  hydraulicConnection?: string;
  /**
   * Dieselbe Anschlussgröße als **Nennweite** [mm] — die rechenbare Fassung.
   *
   * **Warum beides nebeneinander steht.** „G 1¼ AG" ist der Text, den der
   * Monteur am Gerät wiederfindet; DN 32 ist die Zahl, mit der sich die
   * Leitung auslegen lässt. Aus dem Text die Zahl zu erraten, ginge für die
   * gängigen Fälle und scheiterte am ersten Gerät mit „Cu 28 × 1,0".
   *
   * **Wofür sie gebraucht wird — und das ist der eigentliche Punkt.** Die
   * erste Leitung ab dem Erzeuger darf die Anschlussgröße des Geräts nicht
   * unterschreiten. Nicht weil die Hydraulik es verlangte — rechnerisch
   * kommt man bei 8 kW und 7 K Spreizung leicht auf DN 20 —, sondern weil
   * der Hersteller es vorgibt: Gerätedruckverlust, Mindestvolumenstrom,
   * Abtauverhalten, Gewährleistung. Bis 1.23.0 rechnete das Programm eine
   * Leitung, die kleiner sein konnte als der Stutzen, an dem sie hängt, und
   * der Massenauszug bestellte sie so.
   *
   * Ohne Angabe wird **nichts** angenommen: Die Auslegung läuft dann wie
   * bisher rein hydraulisch, und das Anlagenbuch schreibt einen Strich.
   */
  connectionDn?: number;
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
  /**
   * Höhe über Fertigfußboden [m] — nur bei Beschriftungen, die in der
   * begehbaren Ansicht gesetzt wurden.
   *
   * **Warum die Höhe am Text steht und nicht nur in der 3D-Ansicht.** Eine
   * Fahne, die im Raum an einem Heizkörper hängt, hat im Grundriss keinen
   * Platz, an dem sie „oben" wäre — der Grundriss kennt nur x und y. Ohne
   * die Höhe stünde derselbe Text zweimal an derselben Stelle, sobald jemand
   * über- und untereinander zwei Bauteile beschriftet, und niemand wüsste,
   * welcher Text zu welchem gehört. Mit der Höhe schreibt der Plan sie
   * dazu: „2000 W · +0,85 m".
   *
   * Fehlt das Feld, ist die Beschriftung eine reine Planbeschriftung wie
   * bisher — nicht etwa eine auf Höhe 0.
   */
  elevation?: number;
  /**
   * Das Bauteil, das hier beschriftet wird.
   *
   * Der Anker ist der Grund, warum in der begehbaren Ansicht **keine Zahl
   * getippt** wird: Über ihn kennt das Programm die Werte, die am Bauteil
   * stehen — Leistung, Nennweite, Höhe —, und bietet sie an. Eine getippte
   * Zahl altert still weiter, wenn der Heizkörper später getauscht wird;
   * ein angebotener Wert lässt sich nachziehen, weil klar ist, woher er
   * kommt.
   */
  anchor?: AnnotationAnchor;
}

/** Worauf eine Beschriftung zeigt. */
export interface AnnotationAnchor {
  kind: 'fixture' | 'pipe' | 'durchbruch';
  id: string;
  /**
   * Woraus der Text stammt, falls er aus dem Modell angeboten wurde.
   *
   * Steht hier ein Schlüssel, ist `text` eine **Abschrift** des Modellwerts
   * zum Zeitpunkt des Setzens. Der Plan kann dann melden, dass Abschrift und
   * Modell auseinanderlaufen, statt die veraltete Zahl stillschweigend zu
   * drucken. Freier Text lässt das Feld leer.
   */
  quelle?: AnnotationQuelle;
}

/**
 * Die Modellwerte, die als Beschriftung angeboten werden.
 *
 * Bewusst kurz. Angeboten wird nur, was am Bauteil wirklich steht und was
 * auf einer Fahne im Raum einen Sinn ergibt — nicht jedes Feld des Modells.
 */
export type AnnotationQuelle =
  | 'leistung'
  | 'typ'
  | 'anschluss'
  | 'hoehe'
  | 'dn'
  | 'medium'
  | 'volumen'
  | 'mass'
  | 'name';

export const ANNOTATION_QUELLE_LABELS: Record<AnnotationQuelle, string> = {
  leistung: 'Leistung',
  typ: 'Bauart',
  anschluss: 'Anschluss',
  hoehe: 'Höhe über FFB',
  dn: 'Nennweite',
  medium: 'Medium',
  volumen: 'Inhalt',
  mass: 'Maß',
  name: 'Bezeichnung',
};

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
  | 'durchbruch'
  | 'pipe'
  | 'annotation'
  | 'site'
  | 'heatpump'
  | 'dimension'
  | 'calibrate'
  /**
   * Freihand skizzieren — mit dem Stift einen Grundriss ziehen, aus dem das
   * Programm Wandvorschläge macht. Kein Zeichenwerkzeug im engeren Sinn: es
   * legt nichts an, sondern schlägt vor.
   */
  | 'sketch'
  /** Freihand auf den Plan schreiben. Notiz, keine Geometrie. */
  | 'ink'
  | 'pan';

export type ViewMode = '2d' | '3d' | 'split' | 'schema';
/**
 * Wie man das Modell ansieht — oder darin steht.
 *
 * `walk` ist die vierte und andersartige: Bei den ersten dreien dreht man ein
 * Modell auf dem Tisch, bei `walk` steht man auf Augenhöhe darin. Das ist
 * nicht nur eine andere Kamera, sondern eine andere Frage: „komme ich hier
 * durch?" statt „wie sieht das aus?".
 */
export type CameraMode = 'orbit' | 'iso' | 'top' | 'walk';

export interface SnapSettings {
  /** Raster-Snapping aktiv. */
  grid: boolean;
  /** Rasterweite [m]. */
  gridSize: number;
  /** Fang auf bestehende Knotenpunkte. */
  nodes: boolean;
  /** Fang auf Wandachsen (Punkt auf Linie). */
  walls: boolean;
  /**
   * Fang auf **Eckpunkte** außerhalb der Wandtopologie: Geländeecken,
   * Leitungspunkte, Kamin- und Treppenecken, lichte Raumecken, TGA-Objekte —
   * und die Punkte des gerade gezogenen Zuges.
   *
   * Bis 1.19.0 war der Wandknoten das einzige Fangziel im ganzen Programm.
   * Eine Grundstücksgrenze ließ sich nicht an die Ecke des Nachbarhauses
   * legen und der vierte Punkt einer Umfahrung nicht auf die Höhe des ersten.
   */
  points?: boolean;
  /** Winkelrasterung 0/45/90 relativ zum Startpunkt. */
  angle: boolean;
  /** Winkelschritt [°]. */
  angleStep: number;
  /** Fangradius in Bildschirm-Pixeln (zoom-unabhängig gedacht). */
  pixelTolerance: number;
  /**
   * Darf der Finger zeichnen?
   *
   * Auf einem Gerät mit Stift ist die Antwort **nein**, und das ist keine
   * Bequemlichkeit: Wer mit dem Stift schreibt, legt die Hand auf. Zeichnet
   * der Finger mit, zieht der Handballen eine Wand quer durch die Wohnung.
   * Für ein Tablet ohne Stift lässt sich die Einstellung umlegen; dann trägt
   * allein die Karenzzeit nach dem Abheben des Stifts.
   */
  fingerZeichnet?: boolean;
}

/** Ergebnis einer Snapping-Auswertung — trägt seine eigene Begründung. */
export interface SnapResult {
  point: Vec2;
  kind: 'free' | 'grid' | 'node' | 'wall' | 'angle' | 'extension' | 'point';
  /** Getroffener Knoten, falls `kind === 'node'`. */
  nodeId?: NodeId;
  /** Getroffene Wand, falls `kind === 'wall'`. */
  wallId?: WallId;
  /** Für das HUD: gerasteter Winkel [°]. */
  angleDeg?: number;
  /** Woher der Eckpunkt stammt, falls `kind === 'point'` — für die Anzeige. */
  eckart?: string;
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
  | 'durchbruch'
  | 'pipe'
  /** Eine Armatur am Rohrnetz. */
  | 'accessory'
  | 'annotation'
  | 'roofOpening'
  | 'site'
  | 'heatpump';

export interface Selection {
  kind: SelectionKind;
  id: string;
}

/**
 * Woher eine Auswahl stammt.
 *
 * `'plan'` heißt: jemand hat im Grundriss oder im Modell auf ein Bauteil
 * gezeigt. `'liste'` heißt: jemand hat einen Eintrag in einer Liste
 * angeklickt — einen Prüfbefund, eine Raumzeile. Beides wählt dasselbe
 * Objekt aus, aber nur im ersten Fall will der Anwender auch den Inspektor
 * davor haben. Im zweiten würde der Reiterwechsel ihm die Liste wegnehmen,
 * die er gerade abarbeitet.
 */
export type AuswahlQuelle = 'plan' | 'liste';

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

/**
 * Neubau oder Bestand — die Wurzel, aus der ein Dutzend Vorbelegungen folgt.
 *
 * **Warum das ein eigenes Feld ist und keine Ableitung.** Bis 1.23.0 gab es
 * diesen Begriff im Modell überhaupt nicht, und in der Folge wurde er an
 * einem Dutzend Stellen einzeln geraten: die Auslegungstemperatur mit 35/28
 * (Flächenheizung, also Neubau), die Luftdichtheit mit einem Mittelwert, die
 * Fenster-U-Werte im Überschlag mit 1,3 statt 0,9 „damit der Überschlag im
 * Bestand nicht systematisch zu niedrig liegt", das vorhandene
 * Ausdehnungsgefäß mit 0 (im Bestand fast immer falsch), die Dämmpflicht
 * nach GEG mit dem Neubaufall. Jede dieser Annahmen ist für sich
 * verteidigbar; zusammen beschreiben sie ein Haus, das es nicht gibt.
 *
 * Aus dem Programm ableiten lässt sich das Vorhaben **nicht**. Ein
 * Bestandsgebäude, das vollständig entkernt wird, sieht im Modell aus wie ein
 * Neubau. Deshalb wird gefragt, und zwar früh.
 *
 * `teilsanierung` ist kein Zwischenwert aus Bequemlichkeit, sondern der
 * häufigste Fall in der Wärmepumpensanierung: neue Fenster und gedämmte
 * oberste Geschossdecke, aber die Heizkörper von 1985 bleiben hängen. Wer
 * ihn nicht führt, muss sich zwischen zwei falschen Annahmen entscheiden.
 *
 * `bestand` ist der vierte Fall und der, den ein Werkzeug für die
 * Wärmepumpensanierung am leichtesten vergisst: das Haus, an dem **nichts**
 * gemacht wird. Gusseiserne oder schmale Stahlheizkörper von 1975, ein Kessel
 * im Keller, 75/60 im Auslegungsfall. Er kommt vor, wenn nur die Heizlast
 * gebraucht wird — für den Kesseltausch, für den hydraulischen Abgleich nach
 * VdZ, für die Frage, ob eine Wärmepumpe überhaupt in Frage kommt. Ihn unter
 * `sanierung` zu führen hieße, mit 55/45 zu rechnen; bei einem Heizkörper
 * sind das nach DIN EN 442-2 rund 40 Prozent weniger Leistung, als er
 * wirklich abgibt, und ein doppelt so großer Volumenstrom im Rohrnetz.
 */
export type Vorhaben = 'neubau' | 'sanierung' | 'teilsanierung' | 'bestand';

export const VORHABEN_LABELS: Record<Vorhaben, string> = {
  neubau: 'Neubau',
  sanierung: 'Sanierung',
  teilsanierung: 'Teilsanierung',
  bestand: 'Bestand, unsaniert',
};

export interface ProjectMeta {
  name: string;
  address?: string;
  client?: string;
  /**
   * Art des Vorhabens.
   *
   * **Optional, und das ist Absicht.** Ein Projekt aus einer älteren Fassung
   * kennt das Feld nicht. Fehlt es, verhält sich das Programm exakt so wie
   * vor seiner Einführung — es wird nichts abgeleitet, und jede Stelle, die
   * daraus eine Vorbelegung zöge, behält ihren bisherigen Wert. Ein
   * stillschweigendes „dann eben Neubau" wäre genau der Fehler, den dieses
   * Feld beheben soll.
   */
  vorhaben?: Vorhaben;
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
  /**
   * Durchbrüche und Bohrungen. Optional aus demselben Grund wie `solids`:
   * ein Dokument aus einer älteren Fassung oder aus dem Import bleibt ohne
   * dieses Feld gültig.
   */
  durchbrueche?: Record<string, Durchbruch>;
  pipes: Record<string, PipeRun>;
  /** Armaturen und Formstücke am Rohrnetz — vom Rohrausleger erzeugt. */
  pipeAccessories?: Record<string, PipeAccessory>;
  annotations: Record<string, Annotation>;
  /**
   * Freihandnotizen über dem Plan.
   *
   * Bewusst **neben** den Annotationen und nicht in ihnen: eine Annotation
   * ist ein Bemaßungs- oder Textobjekt mit Bedeutung für die Auswertung, ein
   * Freihandstrich ist eine Randbemerkung. Wer beides in einen Topf wirft,
   * bekommt Kringel in den Massenauszug.
   */
  freihand?: Record<string, Freihandstrich>;
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
/**
 * Woher der U-Wert einer exportierten Fläche stammt.
 *
 * Die Stufen sind nach ihrer Belastbarkeit geordnet, von stark nach schwach.
 * Sie sind der Grund, warum diese Angabe überhaupt mitreist: eine Heizlast,
 * deren U-Werte sämtlich `'annahme'` sind, ist rechnerisch dieselbe wie eine
 * mit geöffneten Bauteilen — und fachlich etwas völlig anderes. Wer sie
 * ausweist, macht aus einer Schwäche eine Aussage; wer sie verschweigt, hat
 * im Streitfall nichts in der Hand.
 *
 * `'annahme'` ist dabei die einzige Stufe, die keine Erfassung hinter sich
 * hat: Sie steht für einen festen Ersatzwert dieses Exports, den niemand
 * eingetragen und kein Katalog geliefert hat. Genau diese Zeilen gehören in
 * ein Annahmenverzeichnis.
 */
export type UWertQuelle =
  /** U-Wert aus dem zugewiesenen Bauteilaufbau, gerechnet aus dessen Schichten. */
  | 'aufbau'
  /** Am Bauteil selbst erfasster Wert — jemand hat ihn eingetragen. */
  | 'bauteil'
  /** Vorgabewert der Bauteilart aus `VORGABE_U` — marktübliche Größenordnung. */
  | 'katalog'
  /** Fester Ersatzwert dieses Exports, ohne Katalogeintrag und ohne Erfassung. */
  | 'annahme';

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
  /** Woher dieser U-Wert stammt — siehe `UWertQuelle`. */
  uValueSource: UWertQuelle;
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
  /** Woher dieser U-Wert stammt — siehe `UWertQuelle`. */
  uValueSource: UWertQuelle;
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
  /**
   * Prüfsumme über die heizlastrelevanten Größen dieses Raums.
   *
   * Sie beantwortet der Gegenstelle eine einzige Frage: *Ist die Heizlast,
   * die ich für diesen Raum gerechnet habe, noch gültig?* Gleiche Summe heißt
   * ja, verschiedene Summe heißt nein.
   *
   * Gedeckt sind Geometrie, Hüllbauteile mit U-Werten und Randbedingungen,
   * Öffnungen, Solltemperatur, Luftwechsel und Wärmebrücken. **Nicht** gedeckt
   * sind Name, Farbe und Beschriftung: Wer einen Raum umbenennt, hat nichts
   * ungültig gemacht, und eine Summe, die auf Umbenennungen anspringt,
   * erzeugt Fehlalarme, nach denen niemand mehr hinschaut. Ebenso wenig
   * gedeckt ist `exportedAt` — sonst wäre jeder Export anders als der vorige.
   *
   * Was das Modell mitliefert, ist der Vergleich; die Entscheidung, was mit
   * einem veralteten Ergebnis geschieht, bleibt bei der Gegenstelle. Diese
   * Übergabe rechnet keine Heizlast und kann sie deshalb auch nicht
   * verwerfen.
   */
  checksum: string;
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
   * Rohrmeter, die **in diesem Raum** liegen — nach Gewerk, Nennweite und
   * Dämmstärke getrennt.
   *
   * **Wozu das gebraucht wird.** Ein Heizkreisverteiler in der Diele sammelt
   * alle Kreise des Geschosses; über den Flur laufen sie gebündelt ab. Diese
   * Leitungen geben ihre Wärme dort ab, wo sie liegen, und nicht dort, wohin
   * sie führen. Ein Flur mit zwanzig Metern ungedämmter Anbindeleitung im
   * Estrich ist unter Umständen vollständig beheizt — wer ihm zusätzlich
   * einen Heizkörper gibt, baut ihn doppelt.
   *
   * **Die Zuordnung ist geometrisch.** Gezählt wird, was über der lichten
   * Raumfläche liegt; Abschnitte werden an den Raumgrenzen geteilt. Meter
   * über keinem erkannten Raum — über einer Wand, in einem Schacht — fehlen
   * hier und stehen nur im Längenauszug.
   *
   * **Die Wärmeabgabe selbst steht hier nicht.** Sie folgt aus
   * Vorlauftemperatur, Dämmung, Werkstoff und Verlegeart, und ihr Verfahren
   * gehört in die Heizlastberechnung (DIN EN 12831-1, DIN EN 1264). CAD Light
   * liefert, was nur die Zeichnung weiß: wo die Meter liegen.
   *
   * Fehlt das Feld, liegt in diesem Raum kein Rohr.
   */
  pipeLengths?: ExportRoomPipe[];
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

/** Rohrmeter eines Raums, nach Gewerk, Nennweite und Dämmstärke getrennt. */
export interface ExportRoomPipe {
  service: PipeService;
  /** Nennweite DN [mm]. */
  nominalDiameter: number;
  /** Dämmstärke [mm]; 0 = ungedämmt. */
  insulation: number;
  /** Trassenlänge in diesem Raum [m] — Grundriss, ohne Höhenversatz. */
  length: number;
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

/**
 * Ein Durchbruch im Exportformat.
 *
 * Alle Maße sind lichte Maße in Metern. Es steht bewusst **keine** Fläche
 * darin, die in eine Hüllflächenbilanz passen würde: ein Durchbruch mindert
 * keine Wandfläche, er wird geschottet. Was er liefert, ist eine
 * Ausführungsangabe — wo, wie groß, wie hoch, welches Gewerk, welche
 * Brandschutzklasse.
 */
export interface ExportDurchbruch {
  id: string;
  kind: DurchbruchKind;
  name: string;
  /** Wird die Wand durchstoßen oder die Decke? */
  wirt: DurchbruchWirt;
  /** Geschoss; beim Deckendurchbruch das Geschoss unter der Decke. */
  level: string;
  /** Kennung der durchbrochenen Wand, falls wandgebunden. */
  wallId?: string;
  form: DurchbruchForm;
  /** Lichter Durchmesser [m] bei runder Form. */
  diameter?: number;
  /** Rechteckmaße [m] in der Bauteilebene. */
  width?: number;
  height?: number;
  /** Lichter Querschnitt [m²] — für den Schottungsaufwand, nicht für die Hülle. */
  openArea: number;
  /** Mittelpunkt in Weltkoordinaten [m]. */
  position: Vec2;
  /** Achs- bzw. Unterkantenhöhe über OK FFB [m], falls wandgebunden. */
  sillHeight?: number;
  service?: ShaftService;
  dn?: number;
  brandschutz: Brandschutzklasse;
  note?: string;
}

/** Ein Leitungsabschnitt im Exportformat. */
export interface ExportPipe {
  id: string;
  service: PipeService;
  level: string;
  nominalDiameter: number;
  insulation: number;
  /** Verlegehöhe am Anfang [m]. */
  elevation: number;
  /** Verlegehöhe am Ende [m], falls der Abschnitt geneigt ist. */
  elevationTo?: number;
  /**
   * **Wahre** Rohrlänge [m] — Trasse und Höhenversatz zusammen.
   *
   * Bis 1.23.0 stand hier die reine Grundrisslänge; der Steigstrang fehlte
   * der Gegenstelle damit vollständig. Wer die Grundrisslänge braucht,
   * rechnet sie aus `points` — die stehen daneben.
   */
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

/**
 * Das Übergabeformat an die Heizlastberechnung — der **Vertrag**.
 *
 * **Wie die Version zu lesen ist.** `major.minor.patch`, und zwar aus der
 * Sicht der Gegenstelle, nicht aus der des Erzeugers:
 *
 *   • **major** — ein Feld ist weggefallen oder hat eine andere Bedeutung
 *     bekommen. Wer gegen die alte Fassung gebaut hat, rechnet ab jetzt
 *     falsch oder gar nicht. Das ist der Fall, der abgestimmt werden muss.
 *   • **minor** — es sind Felder dazugekommen, alle alten stehen unverändert.
 *     Wer sie nicht kennt, überliest sie und rechnet weiter wie bisher.
 *   • **patch** — an den Feldern hat sich nichts geändert.
 *
 * Diese Unterscheidung ist der ganze Zweck der Zahl: Sie sagt der
 * Gegenstelle, ob sie etwas tun *muss* oder nur *kann*.
 *
 * **Was den Vertrag bewacht.** `scripts/pruefungen/exportvertrag.ts` führt
 * die Feldlisten von Hand und vergleicht sie bei jedem `npm run verify` mit
 * dem, was tatsächlich herauskommt. Ein Feld, das dazukommt oder verschwindet,
 * ohne dass jemand die Liste anfasst, lässt den Prüflauf fallen — und wer die
 * Liste anfasst, entscheidet dabei über die Version. Ohne diesen Wächter
 * wandert das Format still weiter, während die Gegenstelle gegen eine
 * Fassung baut, die es nicht mehr gibt.
 */
export interface RaviaExport {
  schema: 'ravia.bim.light';
  /**
   * 2.2.0 — gegenüber 2.1.0 additiv: `pipeLengths` an jedem Raum, also die
   * Rohrmeter, die in diesem Raum liegen. Damit lässt sich die Wärmeabgabe
   * der Verteilleitungen dem Raum zurechnen, durch den sie laufen — beim
   * Flur mit dem Heizkreisverteiler ist das der Unterschied zwischen einem
   * unbeheizten und einem vollständig mitbeheizten Raum.
   *
   * 2.1.0 hatte gegenüber 2.0.0 `uValueSource` an jeder Hüllfläche und jeder
   * Öffnung sowie `checksum` an jedem Raum gebracht. Alle Felder aus 2.0.0
   * stehen weiterhin unverändert; eine Gegenstelle, die 2.0.0 oder 2.1.0
   * liest, rechnet ohne Änderung weiter.
   */
  version: '2.2.0';
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
     * Was ein Durchbruch ist, warum er die Wandfläche **nicht** mindert und
     * was die Brandschutzangabe leistet.
     */
    durchbrueche: string;
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
  /** Durchbrüche und Bohrungen — Ausführungsangaben, keine Rechengrößen. */
  durchbrueche: ExportDurchbruch[];
  /** Einzelne Leitungsabschnitte mit ihrer Trassenlänge. */
  pipes: ExportPipe[];
  /** Längenauszug: Meter je Gewerk, Nennweite und Dämmstärke. */
  pipeSchedule: PipeScheduleEntry[];
  /**
   * Strangschema: je Verbraucher der Weg zu seiner Quelle. Die Grundlage des
   * hydraulischen Abgleichs — gerechnet wird er in RaVia.
   */
  pipeNetwork: PipeNetworkReport;
  /**
   * **Die Eingangsgrößen der Auslegung, je Heizfläche.**
   *
   * Warum dieser Block neben `rooms[].fixtures` steht, obwohl dort dieselben
   * Objekte schon vorkommen: dort stehen sie als *Zeichnungsobjekte* —
   * Position, Drehung, Symbolgröße. Hier stehen sie als *Rechenfälle*, und
   * zwar vollständig. Der Rechenkern soll nicht aus einer Zeichnungsliste
   * heraussuchen müssen, was er zum Auslegen braucht, und er soll vor allem
   * nicht raten müssen, was fehlt: jedes Feld sagt, ob es gemessen, eingegeben
   * oder angenommen ist.
   *
   * Der Block ist leer, solange keine Heizfläche gezeichnet ist.
   */
  emitters: ExportEmitter[];
  /**
   * **Vorbemessung der Hydraulik.** Ausdrücklich eine Vorbemessung: gerechnet
   * wird der hydraulische Abgleich in RaVia. Was hier steht, ist der Stand,
   * den die Zeichnung selbst ergibt — damit RaVia ihn nachvollziehen,
   * vergleichen und ersetzen kann, statt bei null anzufangen.
   *
   * Fehlt, solange kein Rohrnetz gezeichnet ist.
   */
  hydraulics?: ExportHydraulics;
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
    durchbrueche: Durchbruch[];
    pipes: PipeRun[];
    annotations: Annotation[];
    roofOpenings: RoofOpening[];
    /**
     * Das Grundstück, wie es im Modell steht — Grenze, Nachbarbebauung,
     * Wärmepumpen, Bodenart. `heatPump` weiter oben ist die ausgewertete
     * Sicht für den Rechenkern; **hier** steht, was zum Zurücklesen nötig ist.
     */
    site: SitePlan;
    /** Handnotizen, falls welche im Plan liegen. */
    freihand?: Freihandstrich[];
  };
}

// ===========================================================================
// Auslegung — die Eingangsgrößen, die der Rechenkern braucht
// ===========================================================================

/**
 * Woher eine Zahl kommt.
 *
 * Das Feld steht an jeder Größe, die nicht unmittelbar gemessen ist. Es ist
 * die Antwort auf die Frage, die bei jeder Übergabe zuerst kommt: „ist das
 * jetzt euer Wert oder unserer?"
 */
export type Herkunft =
  /** Aus dem Modell gemessen — Länge, Fläche, Höhe. */
  | 'gemessen'
  /** Von Hand eingegeben, meist aus einem Datenblatt. */
  | 'eingegeben'
  /** Aus anderen Eingaben gerechnet. */
  | 'gerechnet'
  /**
   * Angenommen, weil nichts vorlag. **Jede so gekennzeichnete Zahl darf der
   * Rechenkern durch eine bessere ersetzen** — sie ist ein Platzhalter mit
   * Begründung, kein Ergebnis.
   */
  | 'angenommen';

/** Eine Zahl mit ihrer Herkunft und, wo nötig, ihrer Begründung. */
export interface Auslegungswert {
  wert: number;
  herkunft: Herkunft;
  /** Warum dieser Wert — Pflicht, wenn `herkunft` „angenommen" ist. */
  begruendung?: string;
}

/**
 * Eine Heizfläche als Rechenfall.
 *
 * **Warum es diesen Typ gibt.** Die Übergabe war an genau einer Stelle
 * blockiert: `powerW` ist die Normleistung bei 55/45/20 °C, und ohne den
 * Heizkörperexponenten lässt sie sich auf keine andere Übertemperatur
 * umrechnen. Eine Wärmepumpe fährt aber nie 55/45. Der Rechenkern bekam also
 * eine Zahl, mit der er nichts anfangen konnte, und musste den Exponenten
 * selbst annehmen — eine Annahme, die an zwei Stellen unabhängig getroffen
 * wird, ist an zwei Stellen anders.
 *
 * Dasselbe bei der Fußbodenheizung: das Kennfeld nach DIN EN 1264-2 hängt an
 * Verlegeabstand, Estrichüberdeckung **und** Belagswiderstand R_λB. Zwei der
 * drei standen im Export, der dritte nicht.
 */
export interface ExportEmitter {
  /** Verweist auf `geometry.fixtures[].id`. */
  fixtureId: string;
  roomId?: RoomId;
  levelId: LevelId;
  label: string;
  /** `radiator`, `underfloor`, `convector` … — die Bauart entscheidet die Rechenregel. */
  type: FixtureType;
  /**
   * Welche Norm die Leistung dieser Bauart beschreibt. Der Rechenkern weiß
   * damit ohne Fallunterscheidung, welches Verfahren gilt.
   */
  rule: 'EN 442' | 'EN 1264' | 'unbekannt';
  /** Normwärmeleistung [W] und bei welchen Temperaturen sie gilt. */
  nominalPower?: Auslegungswert;
  nominalFlowTemperature?: number;
  nominalReturnTemperature?: number;
  nominalRoomTemperature?: number;
  /** Die Temperaturen, mit denen diese Fläche betrieben werden soll [°C]. */
  designFlowTemperature?: Auslegungswert;
  designReturnTemperature?: Auslegungswert;
  /** Der Exponent n aus EN 442-2. Ohne ihn ist keine Umrechnung möglich. */
  exponent?: Auslegungswert;
  /** Korrekturfaktor für die Anschlussart, falls bekannt. */
  connection?: RadiatorConnection;
  /** Baumaße [m] — Länge und Tiefe stehen in der Zeichnung, Höhe nicht. */
  length?: number;
  depth?: number;
  height?: Auslegungswert;
  /** Zahl der Glieder [-]; bei Plattenheizkörpern leer. */
  sections?: number;
  /** Fußbodenheizung: die drei Eingänge des Kennfelds nach EN 1264-2. */
  loopSpacing?: Auslegungswert;
  screedCover?: Auslegungswert;
  floorCoveringResistance?: Auslegungswert;
  /** Fußbodenheizung: Rohr [m] — außen und Wandstärke. */
  pipeOuterDiameter?: Auslegungswert;
  pipeWallThickness?: Auslegungswert;
  /** Belegte Fläche [m²] bei Flächenheizung; die Heizkörperfläche ist keine. */
  area?: number;
  /** Zahl der Heizkreise in diesem Raum [-]. */
  loopCount?: number;
  /**
   * Was dieser Heizfläche zum Auslegen **fehlt**, im Klartext.
   *
   * Eine leere Liste heißt: der Rechenkern kann rechnen. Eine gefüllte sagt
   * ihm, was er beim Anwender nachfragen muss — und zwar bevor er rechnet und
   * nicht, nachdem das Ergebnis unplausibel war.
   */
  missing: string[];
}

/**
 * Die Vorbemessung der Hydraulik, wie die Zeichnung sie hergibt.
 *
 * **Ausdrücklich eine Vorbemessung.** Der hydraulische Abgleich gehört in den
 * Rechenkern: dort liegen die Ventilkennlinien, die Herstellerdaten und die
 * Verantwortung für das Ergebnis. Was hier steht, ist der Stand aus der
 * Zeichnung — Trassenlängen, Einzelwiderstände, der ungünstigste Strang. Ihn
 * mitzuliefern kostet nichts und erspart RaVia, ihn aus `pipes` neu
 * herzuleiten; ihn *nicht* mitzuliefern hieße, dass zwei Programme dasselbe
 * Netz verschieden verstehen und niemand merkt es.
 */
export interface ExportHydraulics {
  /** „Vorbemessung aus der Zeichnung — maßgebend ist die Berechnung in RaVia." */
  status: 'vorbemessung';
  /** Angesetzte Spreizung [K] und Stoffwerte. */
  spread: number;
  fluid: { name: string; density: number; heatCapacity: number; viscosity: number };
  material: string;
  /** Summe der Volumenströme [m³/h] und der angesetzten Leistungen [kW]. */
  totalFlow: number;
  totalPower: number;
  /** Je Verbraucher: Sollstrom, Druckverlust, erforderlicher k_v, Drosselbedarf. */
  consumers: ExportConsumerBalance[];
  /** Ungünstigster und günstigster Strang [Pa] und ihr Verhältnis. */
  worst?: { fixtureId: string; label: string; lossPa: number };
  best?: { fixtureId: string; label: string; lossPa: number };
  lossSpreadPa: number;
  lossRatio: number;
  /** Wie viele Stränge sich mit den gewählten Ventilen **nicht** einstellen lassen. */
  notAdjustable: number;
  beyondPreset: number;
  /** Pumpenauslegung aus der Vorbemessung. */
  pump?: { flow: number; head: number; note?: string };
  /**
   * Erzeugerseite: was das Gerät selbst an Druckverlust hat und was es an
   * Restförderhöhe übriglässt. Die beiden Angaben schließen einander aus —
   * ein Hersteller nennt entweder die eine oder die andere; welche, steht in
   * `kind`.
   */
  generator?: {
    kind: 'geraetedruckverlust' | 'restfoerderhoehe' | 'unbekannt';
    valuePa?: number;
    flow?: number;
    source?: string;
  };
  /** Hinweise der Vorbemessung im Klartext. */
  notes: string[];
}

export interface ExportConsumerBalance {
  fixtureId: string;
  label: string;
  roomId?: RoomId;
  /** Sollvolumenstrom [m³/h]. */
  flow: number;
  /** Angesetzte Leistung [W]. */
  powerW: number;
  /** Druckverlust des Strangs ohne Ventil [Pa]. */
  lossPa: number;
  /** Erforderlicher k_v-Wert [m³/h bei 1 bar]. */
  requiredKv?: number;
  /** Zu drosselnder Anteil [Pa]. */
  throttlePa?: number;
  /** Druckverlust über dem Ventil [Pa] und dessen Autorität [-]. */
  valvePa?: number;
  authority?: number;
  /** Vorgeschlagene Voreinstellung, falls das Ventil eine Reihe hat. */
  preset?: string;
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
  /**
   * Dieselbe Anschlussgröße als **Nennweite** [mm] — die rechenbare Fassung.
   *
   * Der Klartext oben ist, was im Datenblatt steht; diese Zahl ist die, mit
   * der die erste Leitung ab dem Erzeuger gegen den Gerätestutzen geprüft
   * wird. Fehlt sie, wird sie aus dem Klartext gedeutet — das trägt für
   * „G 1¼ AG" und „Cu 28 × 1,0" und scheitert stillschweigend an jeder
   * Schreibweise, die der Deuter nicht kennt. Dann wirkt eine vorhandene
   * Herstellerangabe gar nicht auf die Rohrauslegung, und genau deshalb
   * steht die Zahl lieber daneben.
   *
   * Optional, weil nicht jedes importierte Datenblatt sie hergibt. Fehlt sie
   * **und** lässt sich der Klartext nicht deuten, wird nichts angenommen.
   */
  connectionDn?: number;
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
