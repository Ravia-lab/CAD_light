/**
 * Editor2D — HTML5-Canvas-Zeichenfläche.
 * ---------------------------------------------------------------------------
 * Performance-Entscheidungen:
 *
 *  • Kein React-Rendering im Interaktionspfad. Pointer-Bewegungen schreiben
 *    ausschließlich in Refs und planen einen rAF-Frame. React rendert nur,
 *    wenn sich das *Dokument* oder die Werkzeugwahl ändert.
 *  • Manuelle Welt→Screen-Transformation statt `ctx.setTransform`. So bleiben
 *    Linienstärken, Textgrößen und Fangradien zoom-unabhängig in Pixeln —
 *    genau das erwartet man von einem CAD-Werkzeug.
 *  • Wände werden in zwei globalen Durchgängen gezeichnet (erst alle Kanten-
 *    füllungen, dann alle Poché-Füllungen). Dadurch verschmelzen Ecken und
 *    T-Stöße optisch korrekt, ohne dass Boolesche Geometrie nötig wäre.
 *  • Öffnungen entstehen als *echte Lücken*: die Wand wird über
 *    `wallSolidParts` in massive Teilstücke zerlegt — dieselbe Funktion, die
 *    auch der 3D-Viewer nutzt. 2D und 3D können nicht auseinanderlaufen.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  BimNode,
  ClosureIssue,
  Fixture,
  Opening,
  FixtureType,
  PipeService,
  Room,
  SelectionKind,
  SiteElementKind,
  SnapResult,
  SolidKind,
  VerticalKind,
  TraceState,
  Vec2,
  Wall,
} from '../types/bim';
import {
  FIXTURE_BY_TYPE,
  PIPE_SERVICE_COLORS,
  PIPE_SERVICE_LABELS,
  SITE_ELEMENT_LABELS,
  SOLID_LABELS,
  VERTICAL_LABELS,
  DURCHBRUCH_LABELS,
  durchbruchWirt,
} from '../types/bim';
import { drawFixture, drawFloorLoops, floorLoopBadge, hitTestFixture } from '../lib/fixtureSymbols';
import { EBENE_DURCHBRUECHE, EBENE_GELAENDE, ebeneFuerMedium, istGesperrt, istSichtbar } from '../lib/ebenen';
import { belagNach } from '../lib/bodenbelag';
import { ECKART_LABELS, naechsterEckpunkt, sammleEckpunkte } from '../lib/eckpunkte';
import { RADIER_RADIUS } from '../lib/notizen';
import type { Eingabeeinstellung, Fingerpaar, Zeigerlage } from '../lib/zeigereingabe';
import {
  EINGABE_VORGABE,
  FANG_FAKTOR,
  ZEIGERLAGE_LEER,
  absicht,
  istTipp,
  tippBedient,
  eingabeart,
  fortschreiben,
  gestenschritt,
} from '../lib/zeigereingabe';
import { sammleVerlegekurven } from '../lib/fussbodenkurven';
import { kompassRose } from '../lib/kompass';
import {
  TO_DEG,
  clamp,
  distance,
  distanceToSegment,
  normalize,
  pointInPolygon,
  snapToAngle,
  snapToGrid,
  sub,
} from '../lib/geometry';
import {
  getWallGeometry,
  indexOpeningsByWall,
  indexWallsByNode,
  openingsOf,
  pickWallForOpening,
  planWallPieces,
  type PlanWallPiece,
  type WallGeometry,
} from '../lib/wallGeometry';
import { openingSymbol, type SymbolPart } from '../lib/openingSymbols';
import {
  buildRoofFrame,
  dormerSide,
  hitTestRoofOpening,
  ridgeLine,
  roofContourLines,
  roofOpeningCorners,
} from '../lib/roofGeometry';
import { gebaeudeUmriss } from '../lib/roomDetection';
import {
  distanceToPipe,
  drawCeilingOpening,
  drawPipe,
  drawPipeAccessory,
  drawRoofOpening,
  drawSolid,
  drawVertical,
  hitTestSolid,
  hitTestVertical,
  verticalCorners,
} from '../lib/verticalSymbols';
import {
  durchbruecheAufGeschoss,
  trifftDurchbruch,
  zeichneDurchbruch,
} from '../lib/durchbruchSymbols';
import { distanceToAnnotation, drawAnnotation, textKasten } from '../lib/annotationSymbols';
import type { RoofFrame } from '../lib/roofGeometry';
import { useBimStore } from '../store/useBimStore';
import { drawHeatPump, drawSiteElement, hitTestPump, hitTestSiteArea, hitTestSiteElement } from '../lib/siteSymbols';
import { ROOM_TEMPLATES, ROOM_TEMPLATE_BY_KIND, ROOM_SIZE_PRESETS, polygonArea, templatePolygon } from '../lib/roomTemplates';
import { acousticReport, protectionIssues, requiredDistance, ROOM_ANGLE, ratedSoundPower, IRRELEVANCE_MARGIN, IMMISSION_LIMITS } from '../lib/heatPump';
import CalibrationOverlay from './CalibrationOverlay';
import TraceReviewBar from './TraceReviewBar';
import SkizzenLeiste from './SkizzenLeiste';
import NotizLeiste from './NotizLeiste';

// ---------------------------------------------------------------------------
// Farbpalette der Zeichenfläche
// ---------------------------------------------------------------------------

const C = {
  bg: '#0B1120',
  gridMinor: 'rgba(148,163,184,0.055)',
  gridMajor: 'rgba(148,163,184,0.12)',
  axis: 'rgba(56,189,248,0.22)',
  wallEdge: '#94A3B8',
  wallFill: '#1B2439',
  wallEdgeSel: '#38BDF8',
  wallFillSel: '#123048',
  wallEdgeHover: '#CBD5E1',
  node: '#64748B',
  nodeActive: '#38BDF8',
  room: 'rgba(45,212,191,0.05)',
  roomSel: 'rgba(56,189,248,0.10)',
  roomStroke: 'rgba(45,212,191,0.22)',
  glass: '#38BDF8',
  door: '#7DD3FC',
  dim: '#64748B',
  dimText: '#94A3B8',
  draft: '#38BDF8',
  snap: '#2DD4BF',
  trace: '#E879F9',
  traceSel: '#F0ABFC',
  text: '#E2E8F0',
  textDim: '#94A3B8',
};

const WALL_EDGE_PX = 1.25;

// ---------------------------------------------------------------------------
// Interaktions-Zustand (Refs, kein React-State)
// ---------------------------------------------------------------------------

/**
 * Welche Außenanlagen-Objekte sind Flächen, welche sind Züge?
 *
 * Dieselbe Aufteilung wie im Store — hier noch einmal, weil der Editor sie
 * beim Zeichnen braucht und ein Import aus dem Store die Richtung der
 * Abhängigkeit umkehren würde.
 */
const AREA_SITE_KINDS = new Set<SiteElementKind>(['boundary', 'collector', 'neighbour-building', 'paved']);
const LINE_SITE_KINDS = new Set<SiteElementKind>(['trench', 'utility-line']);

/** Fangradius in Bildschirmpixeln für den Schlusspunkt einer Fläche. */
const CLOSE_PIXELS = 14;

/**
 * Fassradius eines Griffs [Bildpunkte], bevor die Zeigerart ihn streckt.
 *
 * 11 px mal 2,5 für den Finger ergibt knapp 28 px — das liegt in der
 * Größenordnung einer Fingerkuppe und zugleich unter dem Abstand, den zwei
 * Griffe an einer Beschriftung mindestens haben.
 */
const GRIFF_PIXEL = 11;

/**
 * Reichweite des Durchbruchwerkzeugs [m].
 *
 * Großzügiger als beim Fenster (1,20 m): eine Kernbohrung wird auf dem Tablet
 * mit dem Finger gesetzt, und der Finger trifft eine 24er Wand nicht auf
 * zwanzig Zentimeter genau. Zu groß darf sie trotzdem nicht sein — sonst
 * springt der Durchbruch bei einem Klick in der Raummitte an eine Wand, die
 * gar nicht gemeint war.
 */
const DURCHBRUCH_REICHWEITE = 1.5;

/**
 * Objektarten, die `moveSelection` gemeinsam versetzen kann.
 *
 * Die Liste steht hier und nicht als Bedingungskette im Ereignis, weil sie
 * mit dem Store zusammenhängt: was hier fehlt, lässt sich anklicken, aber
 * nicht bewegen — und genau diese Halbheit fällt dem Anwender als Fehler
 * auf, nicht als Absicht.
 */
const MIT_AUSWAHL_ZIEHBAR = new Set<SelectionKind>([
  'wall',
  'fixture',
  'heatpump',
  'site',
  'accessory',
  'pipe',
  'annotation',
]);
/**
 * Wie nah man an den Anfangspunkt muss, um einen Raumzug zu schließen —
 * je nachdem, womit gezeigt wird. Mit dem Finger ist der Anfangspunkt unter
 * der eigenen Kuppe nicht mehr zu sehen; wäre der Radius derselbe wie bei
 * der Maus, ginge der Ring nie zu.
 */
const schlussPixel = (art: 'maus' | 'stift' | 'finger'): number => CLOSE_PIXELS * FANG_FAKTOR[art];


type Draft =
  | { mode: 'idle' }
  | { mode: 'wall'; start: Vec2 }
  | { mode: 'pan'; lastScreen: Vec2 }
  | { mode: 'dragNode'; nodeId: string }
  | { mode: 'dragOpening'; openingId: string }
  | { mode: 'dragFixture'; fixtureId: string }
  | { mode: 'dragVertical'; verticalId: string }
  | { mode: 'dragSolid'; solidId: string }
  | { mode: 'dragDurchbruch'; durchbruchId: string }
  | { mode: 'dragRoofOpening'; openingId: string }
  | { mode: 'pipe'; points: Vec2[] }
  | { mode: 'site'; points: Vec2[] }
  | { mode: 'roomTemplate'; from: Vec2; to: Vec2 }
  | { mode: 'dragPump'; pumpId: string }
  | { mode: 'dragSite'; elementId: string; lastWorld: Vec2 }
  | { mode: 'annotation'; start: Vec2 }
  | { mode: 'dragAnnotation'; annotationId: string; lastWorld: Vec2 }
  /**
   * Ein einzelner Punkt einer Beschriftung wird gezogen.
   *
   * Bis 1.19.0 verschob das Ziehen **alle** Punkte zugleich. Eine Maßkette
   * ließ sich damit versetzen, aber nicht verlängern; wer den falschen
   * Messpunkt gesetzt hatte, musste löschen und neu ansetzen.
   */
  | { mode: 'dragAnnotationPoint'; annotationId: string; index: number }
  /** Die Schriftgröße einer Beschriftung wird am Griff aufgezogen. */
  | { mode: 'scaleAnnotation'; annotationId: string; anker: Vec2; startAbstand: number; startScale: number }
  | { mode: 'marquee'; from: Vec2 }
  | { mode: 'dragSelection'; lastWorld: Vec2 }
  | { mode: 'dragImage'; lastWorld: Vec2 }
  /**
   * Ein laufender Freihandstrich.
   *
   * `punkte` sind Weltkoordinaten und **nicht gefangen**: Ein Strich, der
   * beim Zeichnen aufs Raster springt, fühlt sich an wie ein Stift, der über
   * Kieselsteine geführt wird. Gefangen wird erst das Ergebnis der
   * Erkennung. `zweck` sagt, was daraus wird: Wandvorschläge oder eine Notiz.
   */
  | { mode: 'freihand'; punkte: Vec2[]; druck: number[]; zweck: 'skizze' | 'notiz' | 'radieren' };

/** Eine eingeblendete Ausrichtungs-Hilfslinie (Figma-artige Smart Guide). */
interface Guide {
  axis: 'x' | 'y';
  /** Weltkoordinate der Linie. */
  value: number;
  /** Bezugspunkt, von dem die Ausrichtung stammt — für den Anker im Plan. */
  from: Vec2;
}

interface PointerInfo {
  screen: Vec2;
  world: Vec2;
  snap: SnapResult;
  inside: boolean;
}

export default function Editor2D({ className = '' }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);
  const draftRef = useRef<Draft>({ mode: 'idle' });
  const pointerRef = useRef<PointerInfo>({
    screen: { x: 0, y: 0 },
    world: { x: 0, y: 0 },
    snap: { point: { x: 0, y: 0 }, kind: 'free' },
    inside: false,
  });
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  const imageRef = useRef<HTMLImageElement | null>(null);
  /** Aktive Hilfslinien — nur Renderzustand, deshalb bewusst ein Ref. */
  const guidesRef = useRef<Guide[]>([]);
  /** Leertaste gedrückt → temporärer Pan-Modus. */
  const spaceRef = useRef(false);
  /** Spiegel des Radiergummi-Schalters — Zeigerereignisse lesen keinen Store. */
  const radiergummiRef = useRef(false);
  /**
   * Welchem Zeiger der laufende Vorgang gehört.
   *
   * **Warum das nötig ist.** Auf dem Tablet sind mehrere Zeiger gleichzeitig
   * unterwegs: der Stift zeichnet, der Handballen liegt auf, ein Finger
   * rutscht nach. Der Handballen wird beim Aufsetzen richtig verworfen — beim
   * *Abheben* aber landete sein `pointerup` in derselben Behandlung wie das
   * des Stifts. Und dort steht: „Freihandstrich fertig, auswerten." Der Strich
   * des Stifts wurde damit mitten im Zeichnen abgeschlossen, die folgenden
   * Bewegungen liefen ins Leere, und aus einem Zug wurde ein Bruchstück.
   *
   * Genau das meldet der Anwender als „man kann nicht in einem durchzeichnen".
   *
   * Seither trägt jeder Vorgang die Kennung des Zeigers, der ihn angefangen
   * hat. Wer nicht dazugehört, wird beim Bewegen, Abheben und Abbrechen
   * ignoriert. Ketten, die das Loslassen überleben (Wand, Leitung, Gelände),
   * geben den Besitz beim Abheben wieder frei — dort ist der nächste Zeiger
   * ein anderer und soll weiterzeichnen dürfen.
   */
  const draftZeigerRef = useRef<number | null>(null);
  /** Startpunkt eines Rechtsklicks, um Pan von Kontextabbruch zu trennen. */
  const rightDownRef = useRef<Vec2 | null>(null);
  /** Aufgezogener Auswahlrahmen in Weltkoordinaten. */
  const marqueeRef = useRef<{ from: Vec2; to: Vec2 } | null>(null);

  // --- Store ---------------------------------------------------------------
  const doc = useBimStore((s) => s.doc);
  const trace = useBimStore((s) => s.trace);
  const skizze = useBimStore((s) => s.skizze);
  const radiergummi = useBimStore((s) => s.radiergummi);
  const notizenSichtbar = useBimStore((s) => s.notizenSichtbar);
  const tool = useBimStore((s) => s.tool);
  const solidKind = useBimStore((s) => s.solidKind);
  const durchbruchPreset = useBimStore((s) => s.durchbruchPreset);
  const snap = useBimStore((s) => s.snap);
  const viewport = useBimStore((s) => s.viewport);
  const einpassenZaehler = useBimStore((s) => s.einpassenZaehler);
  const selection = useBimStore((s) => s.selection);
  const selections = useBimStore((s) => s.selections);
  const showDimensions = useBimStore((s) => s.showDimensions);
  const showRoomLabels = useBimStore((s) => s.showRoomLabels);
  const showRoofLines = useBimStore((s) => s.showRoofLines);
  const pipeService = useBimStore((s) => s.pipeService);
  const showDiagnostics = useBimStore((s) => s.showDiagnostics);
  const showGuides = useBimStore((s) => s.showGuides);
  const orthoLock = useBimStore((s) => s.orthoLock);
  const openingPreset = useBimStore((s) => s.openingPreset);
  const activeFixture = useBimStore((s) => s.activeFixture);

  const store = useBimStore;

  /**
   * Numerische Längeneingabe: sobald beim Zeichnen eine Ziffer getippt wird,
   * erscheint ein Feld am Cursor. Enter setzt den Endpunkt exakt auf diese
   * Länge in der gerade gefangenen Richtung — schneller und genauer als
   * jedes Klicken.
   */
  const [lengthInput, setLengthInput] = useState<string | null>(null);
  /**
   * Texteingabe unmittelbar auf der Zeichenfläche.
   *
   * **Warum das sein muss.** Eine Beschriftung entstand bisher mit dem
   * Platzhalter „Text", und der richtige Text war nur im Inspektor
   * einzutippen. Am Rechner ist das ein Blick nach rechts; auf dem Tablet ist
   * der Inspektor eine Schublade, die geschlossen startet und sich beim
   * Anlegen **nicht** öffnet. Die Statuszeile sagte „Text im Inspektor
   * eingeben", und im Plan stand „Text". Für den Anwender heißt das: „Text
   * schreiben fehlt."
   *
   * Jetzt erscheint das Eingabefeld dort, wo getippt wurde — wie die
   * Längeneingabe beim Wandzeichnen, nach demselben Muster und mit denselben
   * Tasten (Enter setzt, Esc bricht ab).
   */
  const [textEingabe, setTextEingabe] = useState<{ id: string; wert: string; screen: Vec2 } | null>(null);
  /**
   * Die Legende am Bildschirm.
   *
   * Im Ausdruck gab es sie längst; auf dem Bildschirm fehlte sie — dort, wo
   * gearbeitet wird. Wer nicht täglich Pläne liest, sieht ein blaues Rechteck
   * mit einem Kreuz und weiß nicht, ob das eine Dusche oder ein Lichtschacht
   * ist.
   */
  const [showLegend, setShowLegend] = useState(false);

  // Gezeichnet wird immer nur das aktive Geschoss; das darunter erscheint als
  // blasse Kontur, damit man daran ausrichten kann.
  const level = doc.activeLevelId;
  const walls = useMemo(
    () => Object.values(doc.walls).filter((w) => w.levelId === level),
    [doc.walls, level],
  );
  const rooms = useMemo(
    () => Object.values(doc.rooms).filter((r) => r.levelId === level),
    [doc.rooms, level],
  );
  const openings = useMemo(() => {
    const ids = new Set(walls.map((w) => w.id));
    return Object.values(doc.openings).filter((o) => ids.has(o.wallId));
  }, [doc.openings, walls]);
  // Einmal je Geschosswechsel indizieren; der Zeichenpfad läuft bei jedem
  // Frame und darf nicht je Wand die ganze Öffnungsliste durchsuchen.
  const openingIndex = useMemo(() => indexOpeningsByWall(openings), [openings]);
  const fixtures = useMemo(
    () => Object.values(doc.fixtures).filter((f) => f.levelId === level),
    [doc.fixtures, level],
  );
  /** Reihenfolge der Geschosse von unten nach oben — Rang statt Kennung. */
  const levelRank = useMemo(() => {
    const order = Object.values(doc.levels).sort((a, b) => a.order - b.order);
    return new Map(order.map((l, i) => [l.id, i]));
  }, [doc.levels]);
  /**
   * Massive Bauteile dieses Geschosses — samt derer, die nur hindurchlaufen.
   *
   * Ein Schornstein steht im Obergeschoss genauso im Weg wie im Erdgeschoss;
   * er wird dort schwächer gezeichnet (`passing`), bleibt aber dasselbe
   * Bauteil und damit auch greifbar.
   */
  const solids = useMemo(() => {
    const here = levelRank.get(level);
    return Object.values(doc.solids ?? {})
      .map((b) => {
        const from = levelRank.get(b.levelId);
        const own = b.levelId === level;
        const passing =
          !own && b.throughAllLevels && from !== undefined && here !== undefined && here > from;
        return { solid: b, passing, visible: own || passing };
      })
      .filter((e) => e.visible);
  }, [doc.solids, level, levelRank]);
  /**
   * Die Durchbrüche dieses Geschosses.
   *
   * `vonUnten` sind die Deckendurchbrüche des Geschosses darunter — im
   * Fußboden sichtbar, aber nicht hier zu Hause. Die Regel steht in
   * `durchbruecheAufGeschoss` und nicht hier, weil Bildschirm und Ausdruck
   * dieselbe Antwort brauchen.
   */
  const durchbrueche = useMemo(
    () => durchbruecheAufGeschoss(doc, level),
    // `doc.walls` und `doc.nodes` stehen bewusst im Abhängigkeitsfeld: ein
    // Wanddurchbruch sitzt parametrisch in seiner Wand, sein Umriss ändert
    // sich also, wenn die Wand sich ändert — ohne dass sich am Durchbruch
    // selbst etwas geändert hätte.
    [doc, level],
  );

  /**
   * Die Verlegekurven der raumfüllenden Fußbodenheizungen.
   *
   * Sie werden hier gerechnet und nicht im Zeichenpfad: der Zeichenpfad läuft
   * bei jedem Frame, die Kurve ändert sich nur mit dem Raum. Gespeichert wird
   * sie nirgends — wer eine Wand verschiebt, bekommt beim nächsten Rendern
   * eine Kurve für den neuen Raum. Genau das ist der Grund, warum im Modell
   * nur Verlegeabstand, Kreiszahl und Randabstand stehen und nicht die Kurve.
   */
  const floorLoops = useMemo(() => sammleVerlegekurven(doc, level), [doc, level]);

  const pipeAccessories = useMemo(
    () => Object.values(doc.pipeAccessories ?? {}).filter((a) => a.levelId === level),
    [doc.pipeAccessories, level],
  );

  const verticals = useMemo(
    () => Object.values(doc.verticals ?? {}).filter((v) => v.levelId === level),
    [doc.verticals, level],
  );
  /**
   * Die Deckenöffnungen, die Treppen und Schächte des Geschosses *darunter*
   * in diesem Geschoss hinterlassen.
   *
   * Sie werden gezeichnet, das Bauteil selbst nicht — es steht einmal im
   * Modell und gehört dem Geschoss darunter. Ohne diese Markierung fehlte im
   * oberen Geschoss jede Erklärung dafür, warum der Raum dort kleiner ist als
   * seine Wände hergeben.
   */
  const ceilingOpenings = useMemo(() => {
    const here = levelRank.get(level);
    if (here === undefined) return [];
    return Object.values(doc.verticals ?? {})
      .filter((v) => {
        if (v.levelId === level || !v.deductsArea) return false;
        const from = levelRank.get(v.levelId);
        if (from === undefined) return false;
        const upto = v.toLevelId ? levelRank.get(v.toLevelId) : from + 1;
        return upto !== undefined && here > from && here <= upto;
      })
      .map((v) => ({ id: v.id, corners: verticalCorners(v), label: v.kind === 'shaft' ? 'Schacht' : 'Treppenauge' }));
  }, [doc.verticals, level, levelRank]);
  const pipes = useMemo(
    () => Object.values(doc.pipes ?? {}).filter((p2) => p2.levelId === level),
    [doc.pipes, level],
  );
  // Die Außenanlage gehört zum Grundstück, nicht zu einem Geschoss — sie
  // wird deshalb in jedem Geschoss gezeigt, nur gedämpft.
  const siteElements = useMemo(() => Object.values(doc.site?.elements ?? {}), [doc.site?.elements]);
  const pumps = useMemo(() => Object.values(doc.site?.pumps ?? {}), [doc.site?.pumps]);
  /**
   * Die beiden Kreise um jede Wärmepumpe. Sie hier zu rechnen und nicht im
   * Zeichenpfad ist Absicht: der Zeichenpfad läuft bei jedem Frame, die
   * Radien ändern sich nur mit dem Modell.
   */
  const pumpOverlays = useMemo(() => {
    const map = new Map<string, { limitRadius: number; safeRadius: number; protectionRadius: number; exceeded: boolean }>();
    for (const pump of pumps) {
      if (pump.form === 'indoor') continue;
      const lw = ratedSoundPower(pump);
      const k0 = ROOM_ANGLE[pump.mounting];
      const limit = IMMISSION_LIMITS[doc.site.areaCategory][1];
      const report = acousticReport(doc, pump);
      map.set(pump.id, {
        limitRadius: requiredDistance(lw, k0, limit, pump.toneSurcharge),
        safeRadius: requiredDistance(lw, k0, limit - IRRELEVANCE_MARGIN, pump.toneSurcharge),
        protectionRadius: protectionIssues(doc, pump).length > 0 || pump.protectionRadius > 0 ? pump.protectionRadius : 0,
        exceeded: report.points.some((c) => c.verdict === 'exceeded'),
      });
    }
    return map;
  }, [doc, pumps]);
  const annotations = useMemo(
    () => Object.values(doc.annotations ?? {}).filter((a) => a.levelId === level),
    [doc.annotations, level],
  );
  const roofOpenings = useMemo(
    () => Object.values(doc.roofOpenings ?? {}).filter((o) => o.levelId === level),
    [doc.roofOpenings, level],
  );

  /**
   * Bezugsrahmen des Daches — wird für Zeichnen *und* Treffererkennung
   * gebraucht, deshalb einmal zentral statt an beiden Stellen neu gebaut.
   */
  const roofFrame = useMemo(() => {
    const outline: Vec2[] = [];
    for (const w of walls) {
      const na = doc.nodes[w.a];
      const nb = doc.nodes[w.b];
      if (na) outline.push({ x: na.x, y: na.y });
      if (nb) outline.push({ x: nb.x, y: nb.y });
    }
    const dach = doc.levels[level]?.roof;
    // Der geordnete Gebäudeumriss ist das, was aus der Punktwolke oben nicht
    // zu gewinnen ist: Ohne ihn bekommt ein L-förmiges Haus ein Walmdach über
    // seiner Bounding Box, First und Höhenlinien stehen im Plan an Stellen,
    // an denen das Dach gar nicht liegt.
    return buildRoofFrame(
      dach,
      outline,
      roofOpenings,
      dach && dach.kind !== 'flat' ? gebaeudeUmriss(walls, doc.nodes) : [],
    );
  }, [doc.levels, doc.nodes, level, roofOpenings, walls]);
  const nodesOfLevel = useMemo(() => {
    const out: Record<string, BimNode> = {};
    for (const n of Object.values(doc.nodes)) if (n.levelId === level) out[n.id] = n;
    return out;
  }, [doc.nodes, level]);

  /** Wände des darunterliegenden Geschosses — reine Zeichenhilfe. */
  const ghostWalls = useMemo(() => {
    const levels = Object.values(doc.levels).sort((a, b) => a.order - b.order);
    const index = levels.findIndex((l) => l.id === level);
    const below = levels[index - 1];
    if (!below) return [];
    return Object.values(doc.walls).filter((w) => w.levelId === below.id);
  }, [doc.levels, doc.walls, level]);

  /** Wände je Knoten — für Eckverlängerungen und Knoten-Picking. */
  const wallsByNode = useMemo(() => indexWallsByNode(walls), [walls]);

  // -------------------------------------------------------------------------
  // Transformation Welt ↔ Screen
  // -------------------------------------------------------------------------

  const toWorld = useCallback(
    (p: Vec2): Vec2 => {
      const { w, h } = sizeRef.current;
      return {
        x: (p.x - w / 2) / viewport.zoom + viewport.center.x,
        y: (h / 2 - p.y) / viewport.zoom + viewport.center.y,
      };
    },
    [viewport],
  );

  /**
   * Weltpunkt → Bildschirmpunkt. Das Gegenstück zu `toWorld`.
   *
   * Gebraucht wird es überall dort, wo eine Fangtoleranz in *Pixeln* gelten
   * muss statt in Metern: ein halber Meter ist bei einem eingezoomten Bad
   * eine halbe Bildschirmbreite und bei einem ausgezoomten Grundstück zwei
   * Pixel. Toleranzen, die der Benutzer mit der Maus treffen soll, gehören
   * deshalb immer auf den Bildschirm.
   */
  const toScreen = useCallback(
    (p: Vec2): Vec2 => {
      const { w, h } = sizeRef.current;
      return {
        x: (p.x - viewport.center.x) * viewport.zoom + w / 2,
        y: h / 2 - (p.y - viewport.center.y) * viewport.zoom,
      };
    },
    [viewport],
  );

  // -------------------------------------------------------------------------
  // Snapping
  // -------------------------------------------------------------------------

  /**
   * Alle fangbaren Ecken des Geschosses — ohne die des laufenden Zuges.
   *
   * Die kommen erst im Fang dazu: Sie stehen in `draftRef` und ändern sich mit
   * jedem gesetzten Punkt. Ein Memo darüber liefe bei jedem Klick neu und
   * brächte nichts; die Liste aus dem Dokument dagegen ist zwischen zwei
   * Änderungen stabil und darf stehen bleiben.
   */
  const eckpunkte = useMemo(
    () => (snap.points === false ? [] : sammleEckpunkte(doc, doc.activeLevelId)),
    [doc, snap.points],
  );

  const computeSnap = useCallback(
    (world: Vec2): SnapResult => {
      // Der Fangradius wächst mit der Eingabeart: eine Fingerkuppe ist rund
      // einen Zentimeter breit, ein Mauszeiger einen Bildpunkt.
      const tolWorld = (snap.pixelTolerance * FANG_FAKTOR[letzteArtRef.current]) / viewport.zoom;
      const draft = draftRef.current;
      const drawingFrom = draft.mode === 'wall' ? draft.start : null;

      // 1) Bestehende Knotenpunkte haben immer Vorrang — sie erzeugen die
      //    topologische Verbindung, auf der die Raumerkennung aufbaut.
      if (snap.nodes) {
        let best: BimNode | null = null;
        let bestDist = tolWorld;
        for (const node of Object.values(nodesOfLevel)) {
          const d = distance(node, world);
          if (d < bestDist) {
            bestDist = d;
            best = node;
          }
        }
        if (best) return { point: { x: best.x, y: best.y }, kind: 'node', nodeId: best.id };
      }

      /*
       * 1b) Eckpunkte, die keine Wandknoten sind.
       *
       * Gleich hinter den Knoten und **vor** Winkel, Wandachse und Raster:
       * Wer nah genug an eine vorhandene Ecke zeigt, meint diese Ecke. Das
       * Raster ist die Notlösung für „irgendwo dort", nicht die Regel.
       *
       * Die Punkte des laufenden Zuges kommen hier dazu, nicht im Memo — sie
       * entstehen ja gerade erst. Sie sind das häufigste Ziel überhaupt: der
       * vierte Punkt einer Umfahrung soll auf die Höhe des ersten.
       */
      if (snap.points !== false) {
        const laufend =
          draft.mode === 'site' || draft.mode === 'pipe'
            ? draft.points
            : draft.mode === 'wall'
              ? [draft.start]
              : draft.mode === 'annotation'
                ? [draft.start]
                : [];
        const treffer =
          naechsterEckpunkt(eckpunkte, world, tolWorld) ??
          naechsterEckpunkt(
            laufend.map((p) => ({ punkt: p, art: 'zug' as const })),
            world,
            tolWorld,
          );
        if (treffer) {
          return { point: { ...treffer.punkt }, kind: 'point', eckart: treffer.art };
        }
      }

      // 2) Winkelrasterung relativ zum Startpunkt (0/45/90 …).
      //    Ortho-Lock erzwingt 90° — damit sind schräge Wände ausgeschlossen,
      //    solange der Nutzer sie nicht ausdrücklich will.
      const angleStep = orthoLock ? 90 : snap.angleStep;
      if (drawingFrom && (snap.angle || orthoLock)) {
        const { point, angle } = snapToAngle(drawingFrom, world, angleStep);
        const result: SnapResult = { point, kind: 'angle', angleDeg: angle };
        if (snap.grid) {
          // Länge zusätzlich auf das Raster runden → saubere Maße wie 3,25 m
          const dir = normalize(sub(point, drawingFrom));
          const len = distance(drawingFrom, point);
          const snappedLen = Math.round(len / snap.gridSize) * snap.gridSize;
          result.point = {
            x: drawingFrom.x + dir.x * snappedLen,
            y: drawingFrom.y + dir.y * snappedLen,
          };
        }
        return result;
      }

      // 3) Punkt auf einer bestehenden Wandachse (T-Anschluss)
      if (snap.walls && !drawingFrom) {
        const hit = pickWallForOpening(world, walls, nodesOfLevel, tolWorld);
        if (hit) {
          return {
            point: {
              x: hit.geom.a.x + hit.geom.dir.x * hit.distanceAlong,
              y: hit.geom.a.y + hit.geom.dir.y * hit.distanceAlong,
            },
            kind: 'wall',
            wallId: hit.wall.id,
          };
        }
      }

      // 4) Raster
      if (snap.grid) return { point: snapToGrid(world, snap.gridSize), kind: 'grid' };
      return { point: world, kind: 'free' };
    },
    [eckpunkte, nodesOfLevel, orthoLock, snap, viewport.zoom, walls],
  );

  // -------------------------------------------------------------------------
  // Ausrichtungs-Hilfslinien
  // -------------------------------------------------------------------------

  /**
   * Sucht bestehende Knoten, die mit dem Zielpunkt auf einer Achse liegen, und
   * zieht ihn exakt darauf. Das ist der wirksamste Schutz gegen minimal
   * schiefe oder um ein paar Zentimeter überstehende Wände: man sieht die
   * Flucht, bevor man klickt.
   */
  const applyGuides = useCallback(
    (point: Vec2, exclude?: Vec2): Vec2 => {
      if (!showGuides) {
        guidesRef.current = [];
        return point;
      }
      // Dieselbe Streckung wie beim Fang: Die Flucht ist für den Stift
      // gedacht, und mit festen 10 Bildpunkten war sie mit dem Finger
      // genauso eng wie mit der Maus — also praktisch nicht zu treffen.
      const tol = (10 * FANG_FAKTOR[letzteArtRef.current]) / viewport.zoom;
      const found: Guide[] = [];
      let x = point.x;
      let y = point.y;
      let bestX = tol;
      let bestY = tol;

      for (const node of Object.values(nodesOfLevel)) {
        if (exclude && Math.abs(node.x - exclude.x) < 1e-6 && Math.abs(node.y - exclude.y) < 1e-6) continue;
        const dx = Math.abs(node.x - point.x);
        if (dx > 1e-6 && dx < bestX) {
          bestX = dx;
          x = node.x;
          found[0] = { axis: 'x', value: node.x, from: { x: node.x, y: node.y } };
        }
        const dy = Math.abs(node.y - point.y);
        if (dy > 1e-6 && dy < bestY) {
          bestY = dy;
          y = node.y;
          found[1] = { axis: 'y', value: node.y, from: { x: node.x, y: node.y } };
        }
      }

      guidesRef.current = found.filter(Boolean);
      return { x, y };
    },
    [nodesOfLevel, showGuides, viewport.zoom],
  );

  // -------------------------------------------------------------------------
  // Picking
  // -------------------------------------------------------------------------

  const pickAt = useCallback(
    (world: Vec2) => {
      const tol = (snap.pixelTolerance * FANG_FAKTOR[letzteArtRef.current]) / viewport.zoom;

      /*
       * Gesperrt heißt: sichtbar, aber nicht anfassbar.
       *
       * Die Prüfung sitzt **im** Treffertest und nicht in den Aktionen
       * dahinter. Der Unterschied ist der ganze Zweck: Wird ein gesperrtes
       * Bauteil gar nicht erst getroffen, greift der Zeiger durch es hindurch
       * auf das, was dahinter liegt. Prüfte erst die Aktion, wäre es gewählt,
       * der Inspektor stünde davor, und beim Ziehen passierte nichts — das
       * sieht nach einem kaputten Programm aus statt nach einer Sperre.
       *
       * Genau das ist der häufigste Unfall beim Aufmaß: Erst wird der Bestand
       * erfasst, dann steht man im Raum und setzt die Technik — und verschiebt
       * beim Zielen auf den Heizkörper die Wand dahinter.
       *
       * Ausgeblendetes wird aus demselben Grund nicht getroffen: Was man nicht
       * sieht, will man nicht anfassen.
       */
      const anfassbar = (art: SelectionKind, id: string): boolean =>
        istSichtbar(doc, art, id) && !istGesperrt(doc, art, id);


      // Auto-Trace-Vorschläge liegen ganz oben: ein Klick soll eine
      // Fehlerkennung sofort erreichbar machen, nicht die Wand darunter.
      if (trace?.visible) {
        for (const cand of trace.walls) {
          if (cand.rejected || cand.confidence < trace.minConfidence) continue;
          if (distanceToSegment(world, cand.start, cand.end) < Math.max(tol, cand.thickness / 2)) {
            return { kind: 'trace' as const, id: cand.id };
          }
        }
        for (const cand of trace.openings) {
          if (cand.rejected || cand.confidence < trace.minConfidence) continue;
          if (distance(cand.center, world) < Math.max(tol, cand.width / 2)) {
            return { kind: 'trace' as const, id: cand.id };
          }
        }
      }

      if (roofFrame) {
        for (const o of roofOpenings) {
          if (hitTestRoofOpening(roofFrame, o, world)) {
            if (anfassbar('roofOpening', o.id)) return { kind: 'roofOpening' as const, id: o.id };
          }
        }
      }

      // Beschriftungen ganz oben: sie liegen im Plan über allem und sollen
      // sich auch dort greifen lassen, wo sie ein Bauteil überdecken.
      for (const note of annotations) {
        // Mit `zoom` zählt bei einer Beschriftung die ganze Textfläche und
        // nicht nur der Ankerpunkt — sonst ist das Wort, das man antippt,
        // auf 95 % seiner Fläche tot.
        if (distanceToAnnotation(note, world, viewport.zoom) < Math.max(tol * 0.8, 0.08)) {
          if (anfassbar('annotation', note.id)) return { kind: 'annotation' as const, id: note.id };
        }
      }

      /*
       * Armaturen vor den Leitungen — aus demselben Grund, aus dem
       * Durchbrüche vor den Wänden geprüft werden: die Armatur sitzt *auf*
       * der Trasse und wird über sie gezeichnet. Käme die Leitung zuerst,
       * fände jeder Klick auf ein Thermostatventil die Leitung darunter, und
       * die Armatur wäre im Plan zwar sichtbar, aber nicht anfassbar.
       *
       * **Warum nur die von Hand gesetzten.** Was der Rohrausleger erzeugt
       * (`generated`), entsteht beim nächsten Auslegen neu — mit neuer Id.
       * Eine Auswahl darauf zeigte einen Knopfdruck später ins Leere: das
       * Eigenschaftenfeld stünde auf einem Objekt, das es nicht mehr gibt,
       * und ein Löschen brächte die Armatur beim nächsten Lauf ungefragt
       * zurück. Das ist schlimmer als gar keine Auswahl, weil es aussieht,
       * als hätte man etwas geändert. Von Hand gesetzte Armaturen sind
       * Bestandsaufnahme — sie bleiben, also darf man sie auch anfassen.
       *
       * Die Reichweite ist das halbe Symbolmaß: `drawPipeAccessory` malt das
       * Symbol mit derselben Formel (±0,5 lokale Einheiten mal `groesse`).
       * Beide Zahlen stehen hier bewusst nebeneinander — liefe die
       * Trefferfläche vom Bild weg, träfe man neben dem, was man sieht.
       */
      const armaturGroessePx = Math.max(10, Math.min(26, 0.22 * viewport.zoom));
      const armaturReichweite = Math.max((armaturGroessePx * 0.5) / viewport.zoom, tol * 0.4);
      /*
       * Auch die ausgelegten Armaturen sind treffbar.
       *
       * Vorher waren sie es nicht — mit der Begründung, sie gehörten der
       * Rechnung und nicht dem Anwender. Das hält der Praxis nicht stand:
       * wer im Plan ein Ventil sieht, will wissen, was es ist, und es
       * gegebenenfalls loswerden. Ein Symbol, das sich nicht anfassen
       * lässt, ist für den, der davorsitzt, schlicht kaputt. Dass eine
       * ausgelegte Armatur bei der nächsten Auslegung wiederkommt, sagt
       * die Statuszeile beim Löschen.
       */
      for (const armatur of pipeAccessories) {
        if (distance(armatur.position, world) < armaturReichweite) {
          if (anfassbar('accessory', armatur.id)) return { kind: 'accessory' as const, id: armatur.id };
        }
      }

      // Leitungen liegen als dünne Linien ganz oben — sie wären sonst nur
      // schwer zu treffen.
      for (const run of pipes) {
        if (distanceToPipe(run, world) < Math.max(tol * 0.6, 0.06)) {
          if (anfassbar('pipe', run.id)) return { kind: 'pipe' as const, id: run.id };
        }
      }

      // Die Wärmepumpe liegt im Plan ganz oben und wird auch zuerst
      // getroffen — sie ist das Objekt, das man beim Planen bewegt.
      for (const pump of pumps) {
        if (pump.form === 'indoor') continue;
        if (hitTestPump(pump, world)) if (anfassbar('heatpump', pump.id)) return { kind: 'heatpump' as const, id: pump.id };
      }

      for (const element of siteElements) {
        if (hitTestSiteElement(element, world, Math.max(tol * 0.6, 0.12))) {
          if (anfassbar('site', element.id)) return { kind: 'site' as const, id: element.id };
        }
      }

      // TGA-Objekte vor der Baugeometrie: sie liegen im Plan obenauf und
      // sollen auch dann greifbar sein, wenn sie auf einer Wand sitzen.
      for (const f of fixtures) {
        if (!isFixtureLayerVisible(doc, f)) continue;
        if (hitTestFixture(f, world, tol * 0.4)) if (anfassbar('fixture', f.id)) return { kind: 'fixture' as const, id: f.id };
      }

      for (const v of verticals) {
        if (hitTestVertical(v, world)) if (anfassbar('vertical', v.id)) return { kind: 'vertical' as const, id: v.id };
      }

      for (const b of solids) {
        if (hitTestSolid(b.solid, world)) if (anfassbar('solid', b.solid.id)) return { kind: 'solid' as const, id: b.solid.id };
      }

      // Durchbrüche vor den Wänden: sie liegen *in* der Wand und wären sonst
      // nie zu treffen — jeder Klick landete auf dem Bauteil, das sie
      // durchstoßen. Was von unten durchscheint, ist nicht greifbar; es
      // gehört dem Geschoss darunter.
      for (const e of durchbrueche) {
        if (e.vonUnten) continue;
        if (trifftDurchbruch(e.durchbruch, doc, world)) {
          if (anfassbar('durchbruch', e.durchbruch.id)) return { kind: 'durchbruch' as const, id: e.durchbruch.id };
        }
      }

      // Öffnungen zuerst — sie liegen visuell obenauf und sind klein.
      for (const op of openings) {
        const wall = doc.walls[op.wallId];
        if (!wall) continue;
        const g = getWallGeometry(wall, nodesOfLevel);
        if (!g) continue;
        const center = { x: g.a.x + g.dir.x * op.distance, y: g.a.y + g.dir.y * op.distance };
        if (distance(center, world) < Math.max(tol, op.width / 2)) {
          if (anfassbar('opening', op.id)) return { kind: 'opening' as const, id: op.id };
        }
      }

      // Knoten
      for (const node of Object.values(nodesOfLevel)) {
        if (distance(node, world) < tol) if (anfassbar('node', node.id)) return { kind: 'node' as const, id: node.id };
      }

      // Wände (Trefferbreite = halbe Wandstärke + Toleranz)
      for (const wall of walls) {
        const g = getWallGeometry(wall, nodesOfLevel);
        if (!g) continue;
        const rel = sub(world, g.a);
        const u = clamp(rel.x * g.dir.x + rel.y * g.dir.y, 0, g.length);
        const px = g.a.x + g.dir.x * u;
        const py = g.a.y + g.dir.y * u;
        if (Math.hypot(px - world.x, py - world.y) < g.halfThickness + tol * 0.5) {
          if (anfassbar('wall', wall.id)) return { kind: 'wall' as const, id: wall.id };
        }
      }

      // Räume
      for (const room of rooms) {
        if (room.innerPolygon.length >= 3 && pointInPolygon(world, room.innerPolygon)) {
          if (anfassbar('room', room.id)) return { kind: 'room' as const, id: room.id };
        }
      }

      // Flächen der Außenanlage ganz unten: Nachbargebäude, Kollektorfläche
      // und Pflasterfläche sind groß und liegen im Plan unter dem Gebäude.
      // Ihre Kante wurde oben schon geprüft — hier geht es nur noch um den
      // Klick mitten hinein, der nichts anderes getroffen hat.
      for (const element of siteElements) {
        if (hitTestSiteArea(element, world)) if (anfassbar('site', element.id)) return { kind: 'site' as const, id: element.id };
      }

      // Referenzbild ganz zuletzt — und nur, wenn es entsperrt ist.
      const img = doc.image;
      if (img && img.visible && !img.locked) {
        const w = img.naturalWidth * img.scale;
        const h = img.naturalHeight * img.scale;
        if (
          world.x >= img.origin.x &&
          world.x <= img.origin.x + w &&
          world.y <= img.origin.y &&
          world.y >= img.origin.y - h
        ) {
          if (anfassbar('image', img.id)) return { kind: 'image' as const, id: img.id };
        }
      }
      return null;
    },
    // Bewusst nur das Dokument statt der einzelnen abgeleiteten Listen:
    // `annotations`, `pumps`, `siteElements`, `walls` … sind allesamt
    // `useMemo`-Ableitungen aus `doc`. Wer sie einzeln aufzählt, vergisst
    // früher oder später eine — und dann greift ein Klick auf genau das
    // Objekt nicht mehr, das in der vergessenen Liste steht.
    [doc, snap.pixelTolerance, trace, viewport.zoom],
  );

  // -------------------------------------------------------------------------
  // Zeichnen
  // -------------------------------------------------------------------------

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const { w, h, dpr } = sizeRef.current;
    if (w === 0 || h === 0) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, w, h);

    const zoom = viewport.zoom;
    const sx = (x: number) => (x - viewport.center.x) * zoom + w / 2;
    const sy = (y: number) => h / 2 - (y - viewport.center.y) * zoom;
    const px = (meters: number) => meters * zoom;

    const draft = draftRef.current;
    const ptr = pointerRef.current;

    // ---------------------------------------------------------------- Raster
    drawGrid(ctx, w, h, viewport, snap.gridSize);

    // -------------------------------------------------------- Referenzbild
    const image = doc.image;
    const bitmap = imageRef.current;
    if (image && image.visible && bitmap && bitmap.complete && doc.layers['layer-image']?.visible) {
      ctx.save();
      ctx.globalAlpha = image.opacity;
      ctx.translate(sx(image.origin.x), sy(image.origin.y));
      ctx.rotate(-image.rotation * (Math.PI / 180));
      const dw = image.naturalWidth * image.scale * zoom;
      const dh = image.naturalHeight * image.scale * zoom;
      // Seitenverkehrt eingelesenes Bild: die Fläche bleibt, wo sie ist, nur
      // die Pixel kehren sich um. Deshalb erst an die rechte Kante schieben
      // und dann die x-Achse umdrehen — sonst läge das Bild neben seinem
      // Rahmen und der Auswahlrahmen zeigte ins Leere.
      if (image.gespiegelt) {
        ctx.translate(dw, 0);
        ctx.scale(-1, 1);
      }
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, 0, 0, dw, dh);
      ctx.restore();

      // Entsperrtes Bild sichtbar machen — sonst rätselt man, warum es sich
      // beim Zeichnen mitbewegt.
      if (!image.locked) {
        ctx.save();
        ctx.strokeStyle =
          selection?.kind === 'image' ? 'rgba(56,189,248,0.9)' : 'rgba(56,189,248,0.35)';
        ctx.lineWidth = 1;
        ctx.setLineDash([7, 5]);
        ctx.strokeRect(
          sx(image.origin.x),
          sy(image.origin.y),
          image.naturalWidth * image.scale * zoom,
          image.naturalHeight * image.scale * zoom,
        );
        ctx.restore();
      }
    }

    // ------------------------------------------- Geschoss darunter (Kontur)
    if (ghostWalls.length) {
      ctx.save();
      ctx.strokeStyle = 'rgba(148,163,184,0.16)';
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 5]);
      for (const wall of ghostWalls) {
        const a = doc.nodes[wall.a];
        const b = doc.nodes[wall.b];
        if (!a || !b) continue;
        ctx.beginPath();
        ctx.moveTo(sx(a.x), sy(a.y));
        ctx.lineTo(sx(b.x), sy(b.y));
        ctx.stroke();
      }
      ctx.restore();
    }

    // --------------------------------------------------------------- Räume
    if (doc.layers['layer-rooms']?.visible) {
      for (const room of rooms) {
        if (room.innerPolygon.length < 3) continue;
        const isSel = selection?.kind === 'room' && selection.id === room.id;
        ctx.beginPath();
        ctx.moveTo(sx(room.innerPolygon[0].x), sy(room.innerPolygon[0].y));
        for (let i = 1; i < room.innerPolygon.length; i++) {
          ctx.lineTo(sx(room.innerPolygon[i].x), sy(room.innerPolygon[i].y));
        }
        ctx.closePath();
        /*
         * Ein erfasster Bodenbelag färbt den Raum ein.
         *
         * Sehr blass — der Grundriss bleibt ein Grundriss und wird kein
         * Belagsplan. Aber wer über den Plan schaut, sieht ohne einen
         * einzigen Klick, in welchen Räumen der Belag steht und in welchen
         * nicht: die grauen sind die offenen.
         */
        const belag = belagNach(room.floorCovering);
        ctx.fillStyle = isSel ? C.roomSel : belag ? `${belag.farbe}22` : C.room;
        ctx.fill();
        ctx.strokeStyle = C.roomStroke;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    // -------------------------------------------------------- Außenanlage
    // Vor den Wänden gezeichnet: das Grundstück ist der Untergrund, auf dem
    // das Gebäude steht, nicht etwas, das darüber liegt.
    //
    // Die eigene Ebene macht aus „liegt unter allem" eine Entscheidung: Im
    // Kellergeschoss ist ein Rasen über der Bodenplatte schlicht falsch, und
    // wer ihn dort nicht sehen will, blendet ihn aus, statt dass das
    // Programm eine Geschossregel erfindet.
    if (doc.layers[EBENE_GELAENDE]?.visible !== false)
    for (const element of siteElements) {
      drawSiteElement(
        ctx,
        element,
        sx,
        sy,
        zoom,
        selections.some((s2) => s2.kind === 'site' && s2.id === element.id),
      );
    }

    // --------------------------------------------------------------- Wände
    if (doc.layers['layer-walls']?.visible) {
      const geoms: { g: WallGeometry; pieces: PlanWallPiece[] }[] = [];
      for (const wall of walls) {
        const g = getWallGeometry(wall, nodesOfLevel);
        if (!g) continue;
        geoms.push({ g, pieces: planWallPieces(g, openingsOf(openingIndex, wall.id), wallsByNode) });
      }

      const edgeWorld = WALL_EDGE_PX / zoom;

      const selectedWallIds = new Set(
        selections.filter((s2) => s2.kind === 'wall').map((s2) => s2.id),
      );

      // Durchgang 1 — Kantenfarbe über die volle Wandstärke
      for (const { g, pieces } of geoms) {
        const sel = selectedWallIds.has(g.wall.id);
        ctx.fillStyle = sel ? C.wallEdgeSel : C.wallEdge;
        for (const piece of pieces) fillPiece(ctx, g, piece, 0, 0, sx, sy);
      }
      // Durchgang 2 — Poché-Füllung, um `edgeWorld` eingerückt
      for (const { g, pieces } of geoms) {
        const sel = selectedWallIds.has(g.wall.id);
        ctx.fillStyle = sel ? C.wallFillSel : C.wallFill;
        for (const piece of pieces) {
          fillPiece(
            ctx,
            g,
            piece,
            edgeWorld,
            0,
            sx,
            sy,
            piece.capStart === 'opening' ? edgeWorld : 0,
            piece.capEnd === 'opening' ? edgeWorld : 0,
          );
        }
      }

      // Öffnungssymbole
      if (doc.layers['layer-openings']?.visible) {
        for (const { g } of geoms) {
          for (const op of openingsOf(openingIndex, g.wall.id)) {
            drawOpeningSymbol(ctx, g, op, sx, sy, px, selection?.kind === 'opening' && selection.id === op.id);
          }
        }
      }

      // Knotenpunkte nur im Auswahlmodus zeigen — sonst visuelles Rauschen
      if (tool === 'select' && zoom > 25) {
        for (const node of Object.values(nodesOfLevel)) {
          const isSel = selection?.kind === 'node' && selection.id === node.id;
          ctx.beginPath();
          ctx.arc(sx(node.x), sy(node.y), isSel ? 4.5 : 3, 0, Math.PI * 2);
          ctx.fillStyle = isSel ? C.nodeActive : C.node;
          ctx.fill();
        }
      }
    }

    // ------------------------------------------- Treppen, Schächte, Leitungen
    for (const v of verticals) {
      drawVertical(ctx, v, sx, sy, zoom, {
        selected: selections.some((s2) => s2.kind === 'vertical' && s2.id === v.id),
      });
    }

    for (const o of ceilingOpenings) {
      drawCeilingOpening(ctx, o.corners, sx, sy, zoom, o.label);
    }

    // Massive Bauteile zuletzt: sie sind Mauerwerk und liegen im Plan über
    // allem, was Fläche ist.
    for (const b of solids) {
      drawSolid(ctx, b.solid, sx, sy, zoom, {
        selected: selections.some((s2) => s2.kind === 'solid' && s2.id === b.solid.id),
        passing: b.passing,
      });
    }

    // Durchbrüche nach den massiven Bauteilen: ein Durchbruch durch einen
    // Kamin ist selten, aber wenn es ihn gibt, gehört das Loch obenauf.
    for (const e of doc.layers[EBENE_DURCHBRUECHE]?.visible === false ? [] : durchbrueche) {
      zeichneDurchbruch(ctx, e.durchbruch, doc, sx, sy, zoom, {
        selected: selections.some((s2) => s2.kind === 'durchbruch' && s2.id === e.durchbruch.id),
        vonUnten: e.vonUnten,
      });
    }

    // Die Leitung liegt auf der Ebene ihres Mediums, nicht auf der des
    // Werkzeugs, mit dem sie gezogen wurde — sonst stünde auf dem
    // Heizungsblatt die Abwasserleitung.
    for (const run of pipes) {
      if (doc.layers[ebeneFuerMedium(run.service)]?.visible === false) continue;
      drawPipe(ctx, run, sx, sy, zoom, {
        selected: selections.some((s2) => s2.kind === 'pipe' && s2.id === run.id),
      });
    }

    // Armaturen über den Leitungen: sie sitzen auf der Trasse und wären
    // darunter nicht zu sehen.
    for (const armatur of pipeAccessories) {
      // Geprüft wird `selections` und nicht `selection` — wie bei Wand,
      // TGA-Objekt und Wärmepumpe. Einzeln angetippt sind beide gleich; wenn
      // der Auswahlrahmen eines Tages auch Armaturen fasst, ist die
      // Hervorhebung schon richtig, statt still zu fehlen.
      if (!istSichtbar(doc, 'accessory', armatur.id)) continue;
      drawPipeAccessory(ctx, armatur, sx, sy, zoom, {
        selected: selections.some((s2) => s2.kind === 'accessory' && s2.id === armatur.id),
      });
    }

    // ------------------------------------------------- Fußbodenheizflächen
    // Vor den Symbolen: die Kurve liegt im Estrich und damit unter allem,
    // was auf dem Boden steht.
    for (const { fixture: f, layout } of floorLoops) {
      if (!isFixtureLayerVisible(doc, f)) continue;
      drawFloorLoops(ctx, layout, sx, sy, zoom, {
        selected: selections.some((s2) => s2.kind === 'fixture' && s2.id === f.id),
        badge: floorLoopBadge(f, layout),
        anchor: f.position,
      });
    }

    // ------------------------------------------------------------ TGA-Symbole
    for (const f of fixtures) {
      if (!isFixtureLayerVisible(doc, f)) continue;
      // Eine Flächenbelegung zeichnet ihre Kurve selbst; das Einzelsymbol
      // daneben wäre eine zweite, kleinere Fußbodenheizung im selben Raum.
      if (f.type === 'underfloor' && f.params.roomCoverage === true) continue;
      drawFixture(ctx, f, sx, sy, zoom, {
        selected: selections.some((s2) => s2.kind === 'fixture' && s2.id === f.id),
        hovered: false,
      });
    }

    // ------------------------------------------------------------ Wärmepumpe
    // Zuletzt und über allem: die Wärmepumpe mit ihren Bedingungskreisen.
    // Wer sie verschiebt, sieht am Kreis sofort, ob der Abstand reicht —
    // das ist der eigentliche Zweck der ganzen Darstellung.
    for (const pump of pumps) {
      if (pump.form === 'indoor') continue;
      drawHeatPump(
        ctx,
        pump,
        pumpOverlays.get(pump.id),
        sx,
        sy,
        zoom,
        // Wie bei Wand und TGA-Objekt über `selections`: sonst bliebe eine im
        // Rahmen gefasste Wärmepumpe unmarkiert, obwohl sie mitgezogen wird.
        selections.some((s2) => s2.kind === 'heatpump' && s2.id === pump.id),
      );
    }

    // ------------------------------------------------------------- Dachlinien
    // First, Traufe und die Höhenlinien bei 1,00 m und 2,00 m. Letztere sind
    // im Dachgeschoss die wichtigsten Linien des ganzen Plans: sie zeigen,
    // wo der Raum nach WoFlV noch zählt und wo ein Schrank nicht mehr steht.
    if (showRoofLines && roofFrame) {
      drawRoofLines(ctx, roofFrame, rooms, sx, sy, px);
    }

    // Gauben und Dachflächenfenster liegen über den Höhenlinien — sie sind
    // Bauteile, keine Hilfsgeometrie.
    if (roofFrame) {
      for (const o of roofOpenings) {
        drawRoofOpening(ctx, o, roofOpeningCorners(roofFrame, o), sx, sy, zoom, {
          selected: selections.some((s2) => s2.kind === 'roofOpening' && s2.id === o.id),
          frontSide: dormerSide(roofFrame, o),
        });
      }
    }

    // ---------------------------------------------------------- Raumlabels
    if (showRoomLabels && doc.layers['layer-rooms']?.visible) {
      for (const room of rooms) drawRoomLabel(ctx, room, sx, sy, zoom);
    }

    // ------------------------------------------------------------ Maßketten
    if (showDimensions && doc.layers['layer-dimensions']?.visible) {
      for (const wall of walls) {
        const g = getWallGeometry(wall, nodesOfLevel);
        if (!g) continue;
        if (px(g.length) < 42) continue; // zu kurz zum Beschriften
        const side = outwardSide(g, rooms);
        drawDimension(ctx, g.a, g.b, side * (g.halfThickness + 0.32), sx, sy, C.dim, C.dimText);
      }
    }

    // ---------------------------------------------------------- Beschriftung
    for (const note of annotations) {
      const gefasst = selections.some((s2) => s2.kind === 'annotation' && s2.id === note.id);
      drawAnnotation(ctx, note, sx, sy, { selected: gefasst });
      if (!gefasst) continue;

      /*
       * Die Griffe der gefassten Beschriftung.
       *
       * Ohne sie ist „verschiebbar und in der Größe änderbar" eine Behauptung:
       * Man sieht der Beschriftung nicht an, dass man sie anfassen kann, und
       * wo. Ein Griff ist die sichtbare Zusage, dass dort etwas geht.
       *
       * Weiße Quadrate an den Punkten (verschieben), ein gefülltes an der
       * oberen rechten Ecke der Textfläche (Größe). Alles in Bildpunkten, also
       * beim Herauszoomen genauso groß — ein Griff, der mitschrumpft, ist
       * genau dann weg, wenn man ihn braucht.
       */
      ctx.save();
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = '#38BDF8';
      ctx.fillStyle = '#0B1120';
      for (const p of note.points) {
        const q = toScreenLocal(p, sx, sy);
        ctx.beginPath();
        ctx.rect(q.x - 4, q.y - 4, 8, 8);
        ctx.fill();
        ctx.stroke();
      }
      const kasten = textKasten(note, viewport.zoom);
      if (kasten) {
        const g = toScreenLocal({ x: kasten.x1, y: kasten.y0 }, sx, sy);
        ctx.fillStyle = '#38BDF8';
        ctx.beginPath();
        ctx.rect(g.x - 4.5, g.y - 4.5, 9, 9);
        ctx.fill();
        // Zwei Striche im Griff — das Zeichen für „ziehen ändert die Größe".
        ctx.strokeStyle = '#0B1120';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(g.x - 2, g.y + 2);
        ctx.lineTo(g.x + 2, g.y - 2);
        ctx.moveTo(g.x, g.y + 2.5);
        ctx.lineTo(g.x + 2.5, g.y);
        ctx.stroke();
      }
      ctx.restore();
    }

    // ------------------------------------------------- Entwurf & Vorschauen
    // Wie beim Gelände: die gesetzten Punkte bleiben stehen, das Gummiband
    // hängt am Zeiger.
    if (draft.mode === 'pipe' && (ptr.inside || draft.points.length > 1)) {
      const preview = ptr.inside ? [...draft.points, ptr.snap.point] : [...draft.points];
      drawPipe(
        ctx,
        {
          id: 'draft',
          levelId: doc.activeLevelId,
          service: pipeService,
          points: preview,
          nominalDiameter: 0,
          insulation: 0,
          elevation: 0,
        },
        sx,
        sy,
        zoom,
        { selected: true },
      );
      const total = preview.reduce(
        (sum, p2, i) => (i ? sum + distance(preview[i - 1], p2) : 0),
        0,
      );
      ctx.save();
      ctx.font = '11px ui-monospace, monospace';
      ctx.fillStyle = C.draft;
      ctx.textAlign = 'left';
      ctx.fillText(`${de(total, 2)} m`, sx(ptr.snap.point.x) + 12, sy(ptr.snap.point.y) - 10);
      ctx.restore();
    }

    /*
     * Abgelegte Freihandnotizen — unter allem, was danach kommt, damit eine
     * Notiz die Zeichnung nicht verdeckt. Sie werden mit fester Strichstärke
     * in Bildpunkten gezeichnet und nicht in Metern: eine Notiz ist eine
     * Randbemerkung und soll beim Hineinzoomen nicht zum Balken werden.
     */
    for (const strich of Object.values(notizenSichtbar ? (doc.freihand ?? {}) : {})) {
      if (strich.levelId !== doc.activeLevelId || strich.punkte.length < 2) continue;
      ctx.save();
      ctx.strokeStyle = 'rgba(251, 191, 36, 0.85)';
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(sx(strich.punkte[0].x), sy(strich.punkte[0].y));
      for (let i = 1; i < strich.punkte.length; i++) ctx.lineTo(sx(strich.punkte[i].x), sy(strich.punkte[i].y));
      ctx.stroke();
      ctx.restore();
    }

    /*
     * Der Skizzenvorschlag: der rohe Strich blass, die erkannten Wände als
     * kräftige gestrichelte Achsen darüber.
     *
     * **Warum der rohe Strich stehen bleibt.** Ohne ihn ist nicht zu
     * beurteilen, ob die Erkennung getroffen hat, was gemeint war — man sieht
     * nur ein Ergebnis und muss es glauben. Mit ihm sieht man den Unterschied
     * und kann verwerfen.
     */
    const vorschlag = skizze;
    if (vorschlag && vorschlag.levelId === doc.activeLevelId) {
      ctx.save();
      // Jeder gezogene Strich bleibt blass stehen — auch die früheren. Erst
      // dadurch sieht man bei mehreren Zügen, welcher Vorschlag zu welchem
      // Strich gehört.
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
      ctx.lineWidth = 1.5;
      ctx.lineJoin = 'round';
      for (const zug of vorschlag.zuege) {
        if (zug.strich.length < 2) continue;
        ctx.beginPath();
        ctx.moveTo(sx(zug.strich[0].x), sy(zug.strich[0].y));
        for (let i = 1; i < zug.strich.length; i++) {
          ctx.lineTo(sx(zug.strich[i].x), sy(zug.strich[i].y));
        }
        ctx.stroke();
      }
      for (const strecke of vorschlag.strecken) {
        // Ausgerichtete Strecken magenta wie jeder Vorschlag; bewusst schräg
        // gebliebene bernsteinfarben, damit man sie im Bild wiederfindet und
        // nicht für einen Erkennungsfehler hält.
        ctx.strokeStyle = strecke.ausgerichtet ? '#E879F9' : '#FBBF24';
        ctx.lineWidth = 2.4;
        ctx.setLineDash([9, 5]);
        ctx.beginPath();
        ctx.moveTo(sx(strecke.a.x), sy(strecke.a.y));
        ctx.lineTo(sx(strecke.b.x), sy(strecke.b.y));
        ctx.stroke();
        ctx.setLineDash([]);
        for (const p of [strecke.a, strecke.b]) {
          ctx.beginPath();
          ctx.arc(sx(p.x), sy(p.y), 3.5, 0, Math.PI * 2);
          ctx.fillStyle = '#E879F9';
          ctx.fill();
        }
      }
      ctx.restore();
    }

    // Der laufende Freihandstrich — unmittelbar unter dem Stift.
    if (draft.mode === 'freihand' && draft.punkte.length > 1) {
      const radiert = draft.zweck === 'radieren';
      ctx.save();
      ctx.strokeStyle = radiert
        ? 'rgba(148, 163, 184, 0.9)'
        : draft.zweck === 'skizze'
          ? 'rgba(232, 121, 249, 0.9)'
          : 'rgba(251, 191, 36, 0.9)';
      ctx.lineWidth = 2.2;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      if (radiert) ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(sx(draft.punkte[0].x), sy(draft.punkte[0].y));
      for (let i = 1; i < draft.punkte.length; i++) ctx.lineTo(sx(draft.punkte[i].x), sy(draft.punkte[i].y));
      ctx.stroke();
      ctx.setLineDash([]);
      // Der Fassradius als Kreis an der Spitze: Radieren löscht ganze
      // Striche, und wie weit der Griff reicht, muss man sehen können,
      // bevor der Nachbarstrich mitgeht.
      if (radiert) {
        const spitze = draft.punkte[draft.punkte.length - 1];
        ctx.beginPath();
        ctx.arc(sx(spitze.x), sy(spitze.y), RADIER_RADIUS * viewport.zoom, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.55)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.restore();
    }

    // Vorschau der Außenanlagen-Fläche bzw. des Zuges.
    if (draft.mode === 'roomTemplate') {
      // Vorschau des Wandrings mit Achsmaßen an den beiden Hauptkanten und
      // der Achsfläche in der Mitte. Gezeichnet wird die Achslinie plus die
      // Wandstärke als blasses Band — so sieht man vor dem Loslassen, wie
      // viel lichtes Maß übrig bleibt.
      const s2 = useBimStore.getState();
      const poly = templatePolygon(s2.roomTemplate, draft.from, draft.to, s2.roomTemplateOptions);
      if (poly.length >= 3) {
        const t = s2.wallDefaults.thickness;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(sx(poly[0].x), sy(poly[0].y));
        for (let i = 1; i < poly.length; i++) ctx.lineTo(sx(poly[i].x), sy(poly[i].y));
        ctx.closePath();
        ctx.strokeStyle = C.draft;
        ctx.lineWidth = Math.max(1.5, t * viewport.zoom);
        ctx.globalAlpha = 0.35;
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.lineWidth = 1.4;
        ctx.setLineDash([6, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
        for (const p of poly) {
          ctx.beginPath();
          ctx.arc(sx(p.x), sy(p.y), 2.5, 0, Math.PI * 2);
          ctx.fillStyle = C.draft;
          ctx.fill();
        }
        const x0 = Math.min(draft.from.x, draft.to.x);
        const x1 = Math.max(draft.from.x, draft.to.x);
        const y0 = Math.min(draft.from.y, draft.to.y);
        const y1 = Math.max(draft.from.y, draft.to.y);
        drawDimension(ctx, { x: x0, y: y0 }, { x: x1, y: y0 }, -0.35, sx, sy, C.draft, C.draft);
        drawDimension(ctx, { x: x1, y: y0 }, { x: x1, y: y1 }, -0.35, sx, sy, C.draft, C.draft);
        ctx.font = '600 12px ui-sans-serif, system-ui';
        ctx.fillStyle = C.draft;
        ctx.textAlign = 'center';
        ctx.fillText(
          `${de(polygonArea(poly), 2)} m² Achsfläche`,
          sx((x0 + x1) / 2),
          sy((y0 + y1) / 2) + 4,
        );
        ctx.restore();
      }
    }

    /*
     * Der angefangene Zug wird **immer** gezeichnet, auch wenn der Zeiger
     * gerade nicht über dem Bild ist.
     *
     * Vorher hing die ganze Vorschau an `ptr.inside`. Mit der Maus fiel das
     * kaum auf; mit Stift und Finger ist es fatal: Der Browser meldet nach
     * *jedem* Abheben, dass der Zeiger das Bild verlassen hat — es gibt ihn
     * dann ja nicht mehr. Nach jedem gesetzten Eckpunkt verschwand damit die
     * gesamte bisherige Umfahrung und kam erst beim nächsten Aufsetzen zurück.
     * Genau das meldet der Anwender: „das Grundstück wird immer wieder
     * unsichtbar."
     *
     * Am Zeiger hängt nur noch das, was ohne ihn keinen Sinn ergibt: das
     * Gummiband zum nächsten Punkt, der Schlussring und die mitlaufende Maß-
     * oder Flächenangabe.
     */
    if (draft.mode === 'site') {
      const zeigerDa = ptr.inside;
      const preview = zeigerDa ? [...draft.points, ptr.snap.point] : [...draft.points];
      const kind = useBimStore.getState().siteKind;
      const isArea = AREA_SITE_KINDS.has(kind);
      // Liegt der Zeiger auf dem Startpunkt, wird der nächste Klick die
      // Fläche schließen. Das muss man sehen, bevor man klickt.
      const startScreen = { x: sx(draft.points[0].x), y: sy(draft.points[0].y) };
      const canClose =
        zeigerDa &&
        isArea &&
        draft.points.length >= 3 &&
        distance(startScreen, ptr.screen) <= schlussPixel(letzteArtRef.current);
      ctx.save();
      ctx.strokeStyle = C.draft;
      ctx.setLineDash([8, 5]);
      ctx.lineWidth = 1.6;
      if (preview.length > 1) {
        ctx.beginPath();
        ctx.moveTo(sx(preview[0].x), sy(preview[0].y));
        for (let i = 1; i < preview.length; i++) ctx.lineTo(sx(preview[i].x), sy(preview[i].y));
        if (isArea && preview.length >= 3) ctx.closePath();
        ctx.stroke();
      }
      for (const pt of draft.points) {
        ctx.beginPath();
        ctx.arc(sx(pt.x), sy(pt.y), 3, 0, Math.PI * 2);
        ctx.fillStyle = C.draft;
        ctx.fill();
      }
      ctx.setLineDash([]);
      if (isArea && draft.points.length >= 3) {
        // Der Startpunkt bekommt einen Fangring, sobald ein Schluss möglich
        // ist — grün, wenn der Zeiger ihn erreicht hat.
        ctx.beginPath();
        ctx.arc(startScreen.x, startScreen.y, schlussPixel(letzteArtRef.current) * 0.6, 0, Math.PI * 2);
        ctx.strokeStyle = canClose ? '#4ADE80' : C.draft;
        ctx.lineWidth = canClose ? 2.4 : 1.2;
        ctx.stroke();
        if (canClose) {
          ctx.font = '11px ui-monospace, monospace';
          ctx.fillStyle = '#4ADE80';
          ctx.textAlign = 'left';
          ctx.fillText('Klick schließt die Fläche', startScreen.x + 14, startScreen.y - 8);
        }
      }
      ctx.font = '11px ui-monospace, monospace';
      ctx.fillStyle = C.draft;
      ctx.textAlign = 'left';
      if (!zeigerDa) {
        // Ohne Zeiger keine mitlaufende Zahl — sie stünde an der Stelle, an
        // der der Zeiger zuletzt war, und das wäre eine Zahl ohne Bezug.
      } else if (isArea && preview.length >= 3) {
        let sum = 0;
        for (let i = 0; i < preview.length; i++) {
          const a = preview[i];
          const b = preview[(i + 1) % preview.length];
          sum += a.x * b.y - b.x * a.y;
        }
        ctx.fillText(`${de(Math.abs(sum) / 2, 1)} m²`, sx(ptr.snap.point.x) + 12, sy(ptr.snap.point.y) - 10);
      } else {
        const total = preview.reduce((acc, p2, i) => (i ? acc + distance(preview[i - 1], p2) : 0), 0);
        ctx.fillText(`${de(total, 2)} m`, sx(ptr.snap.point.x) + 12, sy(ptr.snap.point.y) - 10);
      }
      ctx.restore();
    }

    if (tool === 'solid' && ptr.inside) {
      const kind = solidKind;
      const masse =
        kind === 'chimney'
          ? { width: 0.4, length: 0.4 }
          : kind === 'pier'
            ? { width: 0.365, length: 0.365 }
            : kind === 'wall-offset'
              ? { width: 0.24, length: 1 }
              : { width: 0.3, length: 0.6 };
      ctx.save();
      ctx.globalAlpha = 0.55;
      drawSolid(
        ctx,
        {
          id: 'draft',
          kind,
          name: SOLID_LABELS[kind],
          levelId: doc.activeLevelId,
          position: ptr.snap.point,
          width: masse.width,
          length: masse.length,
          rotation: 0,
          throughAllLevels: kind === 'chimney',
        },
        sx,
        sy,
        zoom,
        { selected: false },
      );
      ctx.restore();
    }

    /*
     * Vorschau des Durchbruchs.
     *
     * Sie zeigt nicht den Zeiger, sondern die **Wand unter dem Zeiger**: ein
     * Wanddurchbruch landet dort, wo die Wandachse ihm am nächsten kommt, und
     * nicht dort, wo der Finger war. Wer das nicht sieht, tippt dreimal daneben
     * und hält das Werkzeug für ungenau.
     *
     * Findet sich keine Wand in Reichweite, wird nichts gezeigt — und das ist
     * die richtige Auskunft: hier entsteht kein Durchbruch.
     */
    if (tool === 'durchbruch' && ptr.inside) {
      const wirt = durchbruchWirt(durchbruchPreset.kind);
      const entwurf = {
        id: 'draft',
        kind: durchbruchPreset.kind,
        name: durchbruchPreset.label,
        levelId: doc.activeLevelId,
        form: durchbruchPreset.form,
        diameter: durchbruchPreset.diameter,
        width: durchbruchPreset.width,
        height: durchbruchPreset.height,
        sillHeight: durchbruchPreset.sillHeight,
      };
      if (wirt === 'decke') {
        ctx.save();
        ctx.globalAlpha = 0.6;
        zeichneDurchbruch(
          ctx,
          { ...entwurf, position: ptr.snap.point, rotation: 0 },
          doc,
          sx,
          sy,
          zoom,
          { selected: false },
        );
        ctx.restore();
      } else {
        const treffer = pickWallForOpening(ptr.world, walls, nodesOfLevel, DURCHBRUCH_REICHWEITE);
        if (treffer) {
          ctx.save();
          ctx.globalAlpha = 0.6;
          zeichneDurchbruch(
            ctx,
            { ...entwurf, wallId: treffer.wall.id, distance: treffer.distanceAlong },
            doc,
            sx,
            sy,
            zoom,
            { selected: false },
          );
          ctx.restore();
        }
      }
    }

    if ((tool === 'stair' || tool === 'shaft') && ptr.inside) {
      const isShaft = tool === 'shaft';
      ctx.save();
      ctx.globalAlpha = 0.55;
      drawVertical(
        ctx,
        {
          id: 'draft',
          kind: isShaft ? 'shaft' : 'stair-straight',
          name: '',
          levelId: doc.activeLevelId,
          position: ptr.snap.point,
          width: isShaft ? 0.4 : 1,
          length: isShaft ? 0.6 : 3.6,
          rotation: 0,
          steps: isShaft ? undefined : 15,
          deductsArea: true,
          openToAbove: !isShaft,
        },
        sx,
        sy,
        zoom,
        { selected: false },
      );
      ctx.restore();
    }

    if (draft.mode === 'annotation' && ptr.inside) {
      // (Die Beschriftung hat nur einen gesetzten Punkt; ohne Zeiger gibt es
      // kein zweites Ende zu zeigen — der Ring unten übernimmt das.)
      drawAnnotation(
        ctx,
        {
          id: 'draft',
          kind: store.getState().annotationKind,
          levelId: doc.activeLevelId,
          points: [draft.start, ptr.snap.point],
          offset: 0.4,
          scale: 1,
        },
        sx,
        sy,
        { selected: true },
      );
    }

    if (draft.mode === 'wall') {
      if (ptr.inside) {
        const end = ptr.snap.point;
        const thickness = store.getState().wallDefaults.thickness;
        drawDraftWall(ctx, draft.start, end, thickness, sx, sy);
        drawDimension(ctx, draft.start, end, thickness / 2 + 0.32, sx, sy, C.draft, C.draft);
        drawCursorHud(ctx, ptr, draft.start, w, h);
      } else {
        // Der Zeiger ist weg, der angefangene Zug nicht. Ein Ring am
        // Anfangspunkt sagt: hier geht es weiter, sobald du wieder aufsetzt.
        // Ohne ihn sah ein unterbrochener Wandzug aus wie „nichts passiert",
        // und der nächste Tipp legte eine Wand an, die niemand erwartete.
        ctx.save();
        ctx.strokeStyle = C.draft;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(sx(draft.start.x), sy(draft.start.y), 6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    if (draft.mode === 'annotation' && !ptr.inside) {
      ctx.save();
      ctx.strokeStyle = C.draft;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(sx(draft.start.x), sy(draft.start.y), 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    if ((tool === 'door' || tool === 'window' || tool === 'passage') && ptr.inside) {
      const preview = pickWallForOpening(ptr.world, walls, nodesOfLevel, 1.2);
      if (preview) {
        ctx.save();
        ctx.globalAlpha = 0.65;
        drawOpeningSymbol(ctx, preview.geom, openingFromPreset(openingPreset, preview.wall.id, preview.distanceAlong), sx, sy, px, true);
        ctx.restore();
      }
    }

    // ------------------------------------------------------ TGA-Vorschau
    if (tool === 'fixture' && ptr.inside) {
      const def = FIXTURE_BY_TYPE[activeFixture];
      if (def) {
        const preview = previewFixture(def, activeFixture, ptr.world, walls, nodesOfLevel);
        ctx.save();
        ctx.globalAlpha = 0.55;
        drawFixture(ctx, preview, sx, sy, zoom, { selected: false, hovered: true });
        ctx.restore();
      }
    }

    // ------------------------------------------------------- Hilfslinien
    if (guidesRef.current.length && (draft.mode === 'wall' || draft.mode === 'dragNode')) {
      ctx.save();
      ctx.strokeStyle = 'rgba(232,121,249,0.55)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      for (const guide of guidesRef.current) {
        ctx.beginPath();
        if (guide.axis === 'x') {
          const x = sx(guide.value);
          ctx.moveTo(x, 0);
          ctx.lineTo(x, h);
        } else {
          const y = sy(guide.value);
          ctx.moveTo(0, y);
          ctx.lineTo(w, y);
        }
        ctx.stroke();
        // Anker am Bezugsknoten, damit klar ist, worauf ausgerichtet wird
        ctx.beginPath();
        ctx.arc(sx(guide.from.x), sy(guide.from.y), 3, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(232,121,249,0.9)';
        ctx.fill();
      }
      ctx.restore();
    }

    // ------------------------------------------------------ Auswahlrahmen
    if (draft.mode === 'marquee' && marqueeRef.current) {
      const { from, to } = marqueeRef.current;
      const x1 = sx(Math.min(from.x, to.x));
      const y1 = sy(Math.max(from.y, to.y));
      const x2 = sx(Math.max(from.x, to.x));
      const y2 = sy(Math.min(from.y, to.y));
      ctx.save();
      ctx.fillStyle = 'rgba(56,189,248,0.10)';
      ctx.strokeStyle = 'rgba(56,189,248,0.8)';
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 4]);
      ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
      ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
      ctx.restore();
    }

    // ------------------------------------------------- Offene Wandenden
    if (showDiagnostics && doc.diagnostics.openEnds.length && doc.layers['layer-walls']?.visible) {
      ctx.save();
      for (const p of doc.diagnostics.openEnds) {
        const px2 = sx(p.x);
        const py2 = sy(p.y);
        ctx.beginPath();
        ctx.arc(px2, py2, 7, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(251,146,60,0.9)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(px2, py2, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(251,146,60,0.9)';
        ctx.fill();
      }
      ctx.restore();
    }

    // ------------------------------------------ Topologie-Befunde im Plan
    // Warum das gezeichnet wird und nicht nur im Prüfbericht steht: wer eine
    // fehlende Wand meldet, schreibt „obwohl die Kanten abgeschlossen sind" —
    // er hat die Lücke schlicht nicht gesehen. Ein Satz in einer Liste ändert
    // daran nichts; eine Marke an der Stelle schon. Offene Wandenden bleiben
    // dabei der Schleife darüber überlassen, sonst stünden zwei Marken
    // übereinander.
    if (showDiagnostics && doc.layers['layer-walls']?.visible) {
      for (const issue of doc.diagnostics.closure ?? []) {
        if (issue.kind === 'gap') drawGapMarker(ctx, issue, sx, sy);
        else if (issue.kind !== 'open-end') drawMinorClosureMarker(ctx, issue, sx, sy);
      }
    }

    // -------------------------------------------------- Auto-Trace-Vorschau
    if (trace?.visible) {
      drawTraceLayer(ctx, trace, sx, sy, zoom, selection?.kind === 'trace' ? selection.id : null);
    }

    // ------------------------------------------------------- Snap-Indikator
    /*
     * Der Fangmarker steht nur dort, wo der Fang auch wirkt.
     *
     * Vorher stand er bei **jedem** Werkzeug außer Auswahl und Schwenken —
     * auch bei Tür, Fenster und Durchgang (die ihren eigenen Wandfang haben)
     * und bei Freihand und Notiz (die bewusst ungefangen zeichnen). Dort zeigt
     * er auf eine Stelle, an der nichts entsteht. Ein Marker, der etwas
     * anderes verspricht, als passiert, ist schlimmer als keiner: Man
     * verlässt sich auf ihn und misst hinterher nach.
     */
    const fangWirkt = !(
      tool === 'select' ||
      tool === 'pan' ||
      tool === 'door' ||
      tool === 'window' ||
      tool === 'passage' ||
      tool === 'sketch' ||
      tool === 'ink'
    );
    if (ptr.inside && fangWirkt) {
      drawSnapMarker(
        ctx,
        toScreenLocal(ptr.snap.point, sx, sy),
        ptr.snap.kind,
        ptr.snap.kind === 'point'
          ? ECKART_LABELS[(ptr.snap.eckart ?? 'zug') as keyof typeof ECKART_LABELS]
          : ptr.snap.kind === 'node'
            ? 'Wandknoten'
            : ptr.snap.kind === 'wall'
              ? 'Wandachse'
              : ptr.snap.kind === 'angle' && ptr.snap.angleDeg !== undefined
                ? `${Math.round(ptr.snap.angleDeg)}°`
                : undefined,
      );
    }
    // ------------------------------------------------------------- Kompass
    /*
     * Die Kompassrose steht **am Bildschirm** fest und nicht im Modell.
     *
     * Sie ist eine Angabe über den Plan, nicht ein Gegenstand darin: Sie wird
     * nicht mitgezoomt, nicht mitgeschoben und liegt immer an derselben
     * Stelle — genau wie auf einem gedruckten Blatt, wo sie im Schriftfeld
     * sitzt. Läge sie im Modell, müsste man sie suchen, sobald man an eine
     * Ecke des Grundrisses zoomt.
     */
    zeichneKompass(ctx, w - 52, 52, 18, doc.meta.northAngle);

    // Die Zeichenfläche hängt am *Dokument als Ganzem*, nicht an einer Liste
    // seiner Felder. Der frühere Aufzählungsstil hatte einen eingebauten
    // Fehler: `doc.site` fehlte, also wurden Wärmepumpe und Geländeobjekte
    // erst nach einem Ansichtswechsel sichtbar. Eine Aufzählung ist nur so
    // richtig wie ihre letzte Pflege; `doc` ist immer vollständig.
    //
    // Das kostet nichts: `doc` bekommt nur beim Ändern des Modells eine neue
    // Identität. Mausbewegungen laufen über Refs und `scheduleRender()` und
    // erzeugen keinen React-Durchlauf — das Neuzeichnen bei jedem Pixel
    // Mausweg entsteht also nicht.
    //
    // Was hier steht, ist deshalb genau das, was *nicht* im Dokument liegt:
    // Ansicht, Werkzeug, Auswahl, Anzeigeschalter und der KI-Vorschlag.
  }, [
    doc,
    activeFixture,
    // Abgeleitet aus `doc`, aber teuer genug, um es einmal zu rechnen statt
    // je Frame — deshalb steht es als eigene Abhängigkeit hier.
    floorLoops,
    ceilingOpenings,
    solids,
    solidKind,
    durchbrueche,
    durchbruchPreset,
    openingPreset,
    selection,
    selections,
    showDiagnostics,
    showDimensions,
    showRoomLabels,
    showRoofLines,
    snap.gridSize,
    store,
    tool,
    trace,
    skizze,
    notizenSichtbar,
    viewport,
  ]);

  // Der Schalter aus der Notizleiste, gespiegelt: die Zeigerbehandlung läuft
  // außerhalb des Renderzyklus und darf den Store nicht abfragen.
  useEffect(() => {
    radiergummiRef.current = radiergummi;
  }, [radiergummi]);

  /*
   * --- Warum hier ein Ref steht und nicht die Funktion selbst ---------------
   *
   * **Das war das Flackern.**
   *
   * Der Ablauf, der es erzeugt hat: Beim Ziehen schreibt die Zeigerbehandlung
   * in den Store und ruft danach `scheduleRender`. Das eingehängte
   * `requestAnimationFrame` hielt dabei *die Fassung von `render` fest, die es
   * beim Einhängen sah* — also die mit dem **alten** Dokument. Unmittelbar
   * darauf lief React durch, `render` bekam eine neue Identität, der Effekt
   * rief `scheduleRender` erneut — und die Sperre `if (rafRef.current) return`
   * verwarf genau diesen neueren Anstoß. Gezeichnet wurde der alte Stand.
   *
   * Die Folge war nicht etwa gleichmäßiger Nachlauf, sondern ein Wechselbild:
   * Ob der React-Durchlauf vor oder nach dem Bildaufruf fertig wurde, hing an
   * Zehntelmillisekunden und wechselte von Ereignis zu Ereignis. Fangmarke,
   * Vorschau und Statuszeile kamen aus `pointerRef`/`draftRef` und waren
   * immer aktuell — die Wand darunter sprang zwischen zwei Ständen hin und
   * her. Das liest man als Flackern, und es ist keins: es ist ein
   * verschluckter Anstoß.
   *
   * Die Abhilfe kostet drei Zeilen: Der Bildaufruf liest `render` erst *im*
   * Bild aus einem Ref. Damit zeichnet er immer den neuesten Stand, und die
   * Sperre darf verwerfen, so viel sie will — verworfen wird dann nur noch
   * ein überzähliger Anstoß, nicht der einzige richtige.
   */
  const renderRef = useRef(render);
  renderRef.current = render;

  const scheduleRender = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      renderRef.current();
    });
  }, []);

  // Nach jeder Änderung an Dokument oder Ansicht ein Bild anfordern. Die
  // Abhängigkeit ist `render` (nicht `scheduleRender`, das jetzt stabil ist)
  // — sie wechselt genau dann, wenn sich etwas Gezeichnetes geändert hat.
  useEffect(() => {
    scheduleRender();
  }, [render, scheduleRender]);

  // -------------------------------------------------------------------------
  // Größe & DPR
  // -------------------------------------------------------------------------

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2); // > 2 bringt optisch nichts, kostet Füllrate
      sizeRef.current = { w: rect.width, h: rect.height, dpr };
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      scheduleRender();
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    window.addEventListener('resize', resize);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', resize);
    };
  }, [scheduleRender]);

  // -------------------------------------------------------------------------
  // Ansicht auf das Modell einpassen
  // -------------------------------------------------------------------------

  const fitToContent = useCallback(() => {
    const { w, h } = sizeRef.current;
    // Das Grundstück gehört mit ins Bild: eine Wärmepumpe steht selten
    // innerhalb der Außenwände, und ein Einpassen, das sie abschneidet,
    // beantwortet die Frage nicht, um die es geht.
    const points: Vec2[] = [
      ...Object.values(nodesOfLevel).map((n) => ({ x: n.x, y: n.y })),
      ...siteElements.flatMap((e) => e.points),
      ...pumps.filter((pump) => pump.form !== 'indoor').map((pump) => pump.position),
    ];
    if (w < 10 || h < 10 || points.length < 2) return;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    // Rand für Maßketten und Raumstempel einrechnen
    const pad = 1.2;
    const width = maxX - minX + pad * 2;
    const height = maxY - minY + pad * 2;
    const zoom = clamp(Math.min(w / width, h / height), 4, 900);
    store.getState().setViewport({
      zoom,
      center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
    });
  }, [nodesOfLevel, siteElements, pumps, store]);

  // Einmalig beim ersten sinnvollen Modell einpassen — danach nie automatisch,
  // sonst springt die Ansicht beim Zeichnen.
  //
  // Ausnahme: wenn das **ganze Dokument** ersetzt wurde. Ein Import, der den
  // alten Ausschnitt stehen lässt, zeigt vom fremden Grundriss eine Wandecke;
  // das Programm sieht dann aus, als hätte es die Datei nicht gelesen. Der
  // Zähler im Speicher steigt genau bei diesen Vorgängen — Projektdatei, IFC,
  // Raumscan, Demo, Wiederherstellung — und bei keinem Zeichenschritt.
  const fittedRef = useRef(-1);
  useEffect(() => {
    if (fittedRef.current === einpassenZaehler) return;
    /*
     * Eingepasst wird, sobald **irgendetwas** da ist, das eine Ausdehnung hat.
     *
     * Die Bedingung lautete „mindestens drei Wandknoten". Wer nur das
     * Grundstück gezeichnet hatte — ein häufiger erster Schritt, wenn die
     * Wärmepumpe geplant wird, bevor das Haus steht — bekam nie ein
     * Einpassen. Die Grenze lag außerhalb des Ausschnitts, und das sieht
     * genauso aus, als wäre sie verschwunden.
     */
    const etwasDa = Object.keys(nodesOfLevel).length >= 3 || siteElements.length > 0 || pumps.length > 0;
    if (!etwasDa) return;
    // Ein Frame warten, damit der ResizeObserver die Canvasgröße gesetzt hat.
    const id = requestAnimationFrame(() => {
      fitToContent();
      fittedRef.current = einpassenZaehler;
    });
    return () => cancelAnimationFrame(id);
  }, [nodesOfLevel, siteElements, pumps, fitToContent, einpassenZaehler]);

  // -------------------------------------------------------------------------
  // Referenzbild laden
  // -------------------------------------------------------------------------

  useEffect(() => {
    const src = doc.image?.src;
    if (!src) {
      imageRef.current = null;
      scheduleRender();
      return;
    }
    const img = new Image();
    img.onload = () => {
      imageRef.current = img;
      scheduleRender();
    };
    img.src = src;
  }, [doc.image?.src, scheduleRender]);

  // -------------------------------------------------------------------------
  // Pointer-Handling
  // -------------------------------------------------------------------------

  /**
   * Der Stand des Glases: wie viele Finger liegen auf, arbeitet der Stift.
   * Bewusst ein Ref und kein Zustand — er ändert sich bei jedem Ereignis und
   * darf keinen Neuaufbau auslösen.
   */
  const zeigerLageRef = useRef<Zeigerlage>(ZEIGERLAGE_LEER);
  const eingabe: Eingabeeinstellung = useMemo(
    () => ({ fingerZeichnet: snap.fingerZeichnet ?? EINGABE_VORGABE.fingerZeichnet }),
    [snap.fingerZeichnet],
  );
  /**
   * Womit zuletzt gezeigt wurde — für die Fangradien.
   *
   * Ein Ref und keine Zustandsgröße: der Fangradius wird beim Auswerten
   * gebraucht, nicht beim Zeichnen des Bildes. Eine Zustandsänderung je
   * Zeigerbewegung baute die Oberfläche sechzigmal in der Sekunde neu auf.
   */
  const letzteArtRef = useRef<ReturnType<typeof eingabeart>>('maus');
  /** Wo die Finger gerade liegen, je Zeigerkennung [Bildpunkte]. */
  const fingerRef = useRef<Map<number, Vec2>>(new Map());
  /** Die letzte Fingerlage einer laufenden Zwei-Finger-Geste. */
  const gesteRef = useRef<Fingerpaar | null>(null);
  /**
   * Der schiebende Finger, solange noch offen ist, ob er schiebt oder tippt.
   * `weg` ist der größte Abstand zum Aufsetzpunkt — nicht der letzte: wer
   * hinfährt und zurückkommt, hat geschoben, auch wenn er am Ende wieder am
   * Anfang steht.
   */
  const tippRef = useRef<{ id: number; start: Vec2; zeit: number; weg: number } | null>(null);

  const updatePointer = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const world = toWorld(screen);
      const draft = draftRef.current;
      let result = computeSnap(world);

      // Hilfslinien greifen nur beim freien Zeichnen: liegt bereits ein
      // harter Fang (Knoten, Wandachse) an, hat der Vorrang.
      if ((draft.mode === 'wall' || draft.mode === 'dragNode') && result.kind !== 'node' && result.kind !== 'wall') {
        const aligned = applyGuides(result.point, draft.mode === 'wall' ? draft.start : undefined);
        result = { ...result, point: aligned };
      } else {
        guidesRef.current = [];
      }

      pointerRef.current = { screen, world, snap: result, inside: true };
      return pointerRef.current;
    },
    [applyGuides, computeSnap, toWorld],
  );

  /**
   * Einen laufenden Zug abschließen und übernehmen.
   *
   * Vorher gab es dafür drei Wege mit drei verschiedenen Ergebnissen: ESC
   * hat übernommen, der Rechtsklick hat *verworfen*, und der Klick auf den
   * ersten Punkt musste auf einen halben Meter genau sitzen. Wer eine
   * Grundstücksgrenze mit dem in jedem CAD üblichen Rechtsklick beenden
   * wollte, hat damit die ganze Umfahrung verloren. Alle Wege führen jetzt
   * hierher, und hierher heißt: übernehmen, wenn es etwas zu übernehmen gibt.
   *
   * Gibt zurück, ob ein Zug beendet wurde — der Aufrufer weiß dann, dass er
   * das Ereignis nicht noch als Klick weiterverarbeiten darf.
   */
  const finishDraft = useCallback((): boolean => {
    const draft = draftRef.current;
    const s = store.getState();
    if (draft.mode === 'pipe') {
      if (draft.points.length >= 2) {
        s.addPipe(s.pipeService, draft.points);
        s.setStatus('Leitung übernommen');
      } else {
        s.setStatus('Leitung verworfen — sie hatte nur einen Punkt');
      }
      draftRef.current = { mode: 'idle' };
      return true;
    }
    if (draft.mode === 'site') {
      const kind = s.siteKind;
      const isArea = AREA_SITE_KINDS.has(kind);
      const needed = isArea ? 3 : 2;
      if (draft.points.length >= needed) {
        s.addSiteElement(kind, draft.points);
      } else {
        s.setStatus(
          isArea
            ? `${SITE_ELEMENT_LABELS[kind]} verworfen — eine Fläche braucht mindestens drei Ecken.`
            : `${SITE_ELEMENT_LABELS[kind]} verworfen — ein Zug braucht mindestens zwei Punkte.`,
        );
      }
      draftRef.current = { mode: 'idle' };
      return true;
    }
    if (draft.mode === 'wall') {
      draftRef.current = { mode: 'idle' };
      s.setStatus('Bereit');
      return true;
    }
    return false;
  }, [store]);

  /**
   * Zwei-Finger-Geste und Handballen.
   *
   * Die Regel selbst steht in `zeigereingabe.ts` und kennt weder DOM noch
   * React; hier wird sie nur angewandt. `zeigerLageRef` ist der Stand des
   * Glases: wie viele Finger liegen auf, arbeitet der Stift. `fingerRef`
   * merkt sich, wo die Finger sind — für die Geste braucht es beide Punkte.
   */
  /**
   * Sitzt der Zeiger auf einem Griff der gefassten Beschriftung?
   *
   * Griffe sind bewusst **in Bildpunkten** bemessen und nicht in Metern: Ein
   * Griff, der beim Herauszoomen mitschrumpft, ist genau dann nicht mehr zu
   * treffen, wenn man ihn am nötigsten braucht. Die Zeigerart streckt den
   * Radius wie überall sonst — mit dem Finger greift man gröber als mit der
   * Maus.
   */
  const griffTreffer = useCallback(
    (world: Vec2): Draft | null => {
      const sel = store.getState().selection;
      if (!sel || sel.kind !== 'annotation') return null;
      const note = store.getState().doc.annotations[sel.id];
      if (!note) return null;
      const fassRadius = (GRIFF_PIXEL * FANG_FAKTOR[letzteArtRef.current]) / viewport.zoom;

      // Einzelne Punkte: bei Maßkette und Hinweisfahne sind es zwei, beim
      // Text ist es der Anker.
      for (let i = 0; i < note.points.length; i++) {
        if (distance(note.points[i], world) <= fassRadius) {
          return { mode: 'dragAnnotationPoint', annotationId: note.id, index: i };
        }
      }

      // Der Größengriff — nur beim Text, denn nur dort gibt es eine Fläche,
      // an deren Ecke er sitzen kann.
      const kasten = textKasten(note, viewport.zoom);
      if (kasten) {
        const ecke = { x: kasten.x1, y: kasten.y0 };
        if (distance(ecke, world) <= fassRadius) {
          return {
            mode: 'scaleAnnotation',
            annotationId: note.id,
            anker: note.points[0],
            startAbstand: Math.max(distance(note.points[0], world), 1e-6),
            startScale: note.scale,
          };
        }
      }
      return null;
    },
    [store, viewport.zoom],
  );

  /**
   * `alsTipp` ist der zweite Weg hier hinein: Ein Finger, der kurz und ohne
   * Weg aufgesetzt hat, ruft diese Funktion beim **Abheben** noch einmal auf
   * — mit derselben Stelle, aber ohne Buchführung und ohne Schwenk. So
   * bedient ein Tippen genau das, was ein Mausklick bedient, und der lange
   * Zweig unten steht nur einmal da. Siehe `istTipp` in `zeigereingabe.ts`.
   */
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>, alsTipp = false) => {
    const art = eingabeart(e.pointerType);
    letzteArtRef.current = art;
    const jetzt = e.timeStamp;
    const was = alsTipp ? 'zeichnen' : absicht(art, zeigerLageRef.current, jetzt, eingabe);
    if (!alsTipp) {
      zeigerLageRef.current = fortschreiben(zeigerLageRef.current, art, 'runter', jetzt);
      if (art === 'finger') {
        const r = e.currentTarget.getBoundingClientRect();
        fingerRef.current.set(e.pointerId, { x: e.clientX - r.left, y: e.clientY - r.top });
      }
    }

    // Der Handballen. Er darf nicht einmal den laufenden Zug anfassen —
    // deshalb hier heraus und nicht erst später abfangen.
    if (was === 'verwerfen') return;

    // Zwei Finger: der laufende Zug bleibt stehen, wo er ist, und das Bild
    // wird geschoben. Ein angefangener Wandzug geht dabei nicht verloren —
    // wer zoomt, will weiterzeichnen.
    if (was === 'geste') {
      const paar = [...fingerRef.current.values()];
      if (paar.length >= 2) gesteRef.current = { a: paar[0], b: paar[1] };
      return;
    }

    if (!alsTipp) {
      e.currentTarget.setPointerCapture(e.pointerId);
      draftZeigerRef.current = e.pointerId;
    }

    // Ein Finger schiebt — wie die mittlere Maustaste, nur ohne Maus.
    if (was === 'schieben') {
      const r = e.currentTarget.getBoundingClientRect();
      const start = { x: e.clientX - r.left, y: e.clientY - r.top };
      draftRef.current = { mode: 'pan', lastScreen: start };
      // Vormerken, falls daraus doch ein Tippen wird. Nur für Werkzeuge, die
      // ein einzelner Punkt bedient — sonst bliebe ein halber Wandzug stehen.
      tippRef.current = tippBedient(tool) ? { id: e.pointerId, start, zeit: jetzt, weg: 0 } : null;
      scheduleRender();
      return;
    }

    const ptr = updatePointer(e);
    const s = store.getState();
    // Alles zwischen Drücken und Loslassen ist *eine* Handlung. Ohne diese
    // Klammer legt jede Mausbewegung beim Ziehen einen eigenen
    // Historieneintrag an, und Strg+Z holt das Objekt nicht an seinen
    // Ausgangsort zurück, sondern um einen Bewegungsschritt.
    s.beginGesture();

    // Pan: mittlere Maustaste, Leertaste, Pan-Werkzeug — oder rechte Maustaste
    // (dann entscheidet erst das Loslassen, ob es ein Schwenk oder ein
    // Kontextabbruch war; siehe handlePointerUp).
    if (e.button === 1 || e.button === 2 || tool === 'pan' || spaceRef.current) {
      if (e.button === 2) rightDownRef.current = ptr.screen;
      draftRef.current = { mode: 'pan', lastScreen: ptr.screen };
      scheduleRender();
      return;
    }

    switch (tool) {
      // Freihand — skizzieren oder notieren. Beides derselbe Strich, nur mit
      // verschiedenem Zweck.
      case 'sketch':
      case 'ink': {
        // Das Radierende mancher Stifte meldet der Browser als Taste 5 —
        // der Apple Pencil hat keines, deshalb gibt es zusätzlich den
        // Schalter in der Notizleiste. Wer ein Radierende hat, soll es
        // benutzen können, ohne den Schalter zu suchen.
        const radiert = tool === 'ink' && (radiergummiRef.current || e.button === 5 || e.buttons === 32);
        draftRef.current = {
          mode: 'freihand',
          punkte: [ptr.world],
          druck: [e.pressure > 0 ? e.pressure : 0.5],
          zweck: tool === 'sketch' ? 'skizze' : radiert ? 'radieren' : 'notiz',
        };
        scheduleRender();
        break;
      }
      case 'wall': {
        const draft = draftRef.current;
        if (draft.mode === 'wall') {
          const created = s.addWall(draft.start, ptr.snap.point);
          // Kettenzeichnen: der Endpunkt wird zum neuen Startpunkt.
          draftRef.current = { mode: 'wall', start: ptr.snap.point };
          if (created) s.setStatus(`Wand ${de(distance(draft.start, ptr.snap.point), 2)} m erstellt`);
        } else {
          draftRef.current = { mode: 'wall', start: ptr.snap.point };
          s.setStatus('Endpunkt setzen — ESC beendet die Kette');
        }
        break;
      }

      case 'door':
      case 'window':
      case 'passage': {
        const hit = pickWallForOpening(ptr.world, walls, nodesOfLevel, 1.2);
        if (!hit) {
          s.setStatus('Keine Wand in Reichweite');
          break;
        }
        const preset = s.openingPreset;
        const ghost = openingFromPreset(preset, hit.wall.id, hit.distanceAlong);
        const { id: _ignored, ...rest } = ghost;
        void _ignored;
        const created = s.addOpening(rest);
        s.setStatus(
          created
            ? `${preset.label} eingesetzt`
            : 'Passt hier nicht — Wand zu kurz oder Stelle belegt',
        );
        break;
      }

      case 'fixture': {
        /**
         * Fußbodenheizung ist der eine Fall, in dem ein Klick keine Stelle
         * meint, sondern einen Raum: verlegt wird die ganze Fläche. Ein
         * zweiter Klick in denselben Raum räumt sie wieder weg.
         *
         * Das alte Einzelsymbol bleibt trotzdem erreichbar — mit gedrückter
         * Alt-Taste und überall dort, wo kein Raum unter dem Cursor liegt.
         * Es hat seinen Zweck: eine Schleife in einem Vorraum, einen
         * nachgerüsteten Kreis in einem Bestandsplan, eine Fläche, die man
         * bewusst von Hand setzen will.
         */
        if (activeFixture === 'underfloor' && !e.altKey) {
          const room = rooms.find(
            (r) => r.innerPolygon.length >= 3 && pointInPolygon(ptr.world, r.innerPolygon),
          );
          if (room) {
            const ergebnis = s.toggleFloorLoopArea(room.id);
            if (ergebnis === null) s.setStatus(`In „${room.name}" lässt sich keine Fläche belegen`);
            break;
          }
          s.setStatus('Kein Raum an dieser Stelle — mit Alt wird ein Einzelsymbol gesetzt');
          break;
        }
        const created = s.addFixture(activeFixture, ptr.snap.point);
        if (created) {
          /*
           * Direkt einmal „bewegen": das richtet wandgebundene Objekte aus.
           *
           * Und zwar mit dem **gefangenen** Punkt. Vorher stand hier
           * `ptr.world`, und damit war der Fang für TGA-Objekte wirkungslos:
           * Der Marker zeigte auf die Raumecke, angelegt wurde auf dem
           * Raster, und der nächste Aufruf schob das Objekt wieder auf den
           * rohen Zeigerpunkt. Ein Fangmarker, der etwas anderes anzeigt, als
           * passiert, ist schlimmer als keiner — man verlässt sich darauf.
           */
          s.moveFixture(created.id, ptr.snap.point);
          s.setStatus(`${FIXTURE_BY_TYPE[activeFixture]?.label ?? 'Objekt'} platziert`);
        }
        break;
      }

      case 'stair':
      case 'shaft': {
        const kind = tool === 'shaft' ? 'shaft' : s.verticalKind;
        s.addVertical(kind === 'shaft' && tool === 'stair' ? 'stair-straight' : kind, ptr.snap.point);
        break;
      }

      case 'solid': {
        s.addSolid(s.solidKind, ptr.snap.point);
        break;
      }

      case 'durchbruch': {
        const preset = s.durchbruchPreset;
        const treffer =
          durchbruchWirt(preset.kind) === 'wand'
            ? pickWallForOpening(ptr.world, walls, nodesOfLevel, DURCHBRUCH_REICHWEITE)
            : null;
        // Ohne Wand wird trotzdem gerufen: die Aktion weist den Fall ab und
        // schreibt den Grund in die Statuszeile. Eine zweite Meldung an dieser
        // Stelle wäre eine zweite Wahrheit über denselben Sachverhalt.
        s.addDurchbruch(
          preset,
          treffer
            ? { wallId: treffer.wall.id, distance: treffer.distanceAlong }
            : { position: ptr.snap.point },
        );
        break;
      }

      case 'pipe': {
        const draft = draftRef.current;
        // Anfang und Ende rasten auf TGA-Objekte ein: eine Leitung soll am
        // Verteiler beginnen und am Heizkörper enden, nicht daneben.
        const near = nearestFixture(ptr.world, fixtures, 0.45);
        const point = near ? near.position : ptr.snap.point;
        if (draft.mode === 'pipe') {
          const points = [...draft.points, point];
          // Doppelklick bzw. Klick auf denselben Punkt beendet den Zug.
          const last = draft.points[draft.points.length - 1];
          if (distance(last, point) < 0.02 || near) {
            const run = s.addPipe(s.pipeService, points);
            if (run && near) s.updatePipe(run.id, { toFixtureId: near.id });
            draftRef.current = { mode: 'idle' };
          } else {
            draftRef.current = { mode: 'pipe', points };
            s.setStatus(`Leitung — ${points.length} Punkte · ESC beendet, Klick auf ein TGA-Objekt schließt an`);
          }
        } else {
          draftRef.current = { mode: 'pipe', points: [point] };
          s.setStatus(
            near
              ? `Leitung ab ${FIXTURE_BY_TYPE[near.type]?.label ?? 'Objekt'} — nächsten Punkt setzen`
              : 'Leitung — nächsten Punkt setzen, ESC beendet',
          );
        }
        break;
      }

      case 'room': {
        // Zwei Bedienarten in einem Werkzeug: ziehen (drücken, ziehen,
        // loslassen) und klicken (Ecke, zweite Ecke). Wer die Maus zieht,
        // wird in `handlePointerUp` bedient; wer nur klickt, kommt hier
        // beim zweiten Klick wieder an.
        const draft = draftRef.current;
        if (draft.mode === 'roomTemplate') {
          const wide = Math.abs(ptr.snap.point.x - draft.from.x) > 0.5;
          const deep = Math.abs(ptr.snap.point.y - draft.from.y) > 0.5;
          if (wide && deep) {
            s.addRoomTemplate(s.roomTemplate, draft.from, ptr.snap.point, s.roomTemplateOptions);
            draftRef.current = { mode: 'idle' };
            break;
          }
        }
        draftRef.current = { mode: 'roomTemplate', from: ptr.snap.point, to: ptr.snap.point };
        s.setStatus(
          `${ROOM_TEMPLATE_BY_KIND[s.roomTemplate].label} aufziehen — gegenüberliegende Ecke setzen, ESC bricht ab`,
        );
        break;
      }

      case 'heatpump': {
        s.addHeatPump(ptr.snap.point);
        break;
      }

      case 'site': {
        const kind = s.siteKind;
        const draft = draftRef.current;
        const isArea = AREA_SITE_KINDS.has(kind);
        const isLine = LINE_SITE_KINDS.has(kind);

        // Punktobjekte sitzen mit einem Klick.
        if (!isArea && !isLine) {
          s.addSiteElement(kind, [ptr.snap.point]);
          break;
        }

        if (draft.mode !== 'site') {
          draftRef.current = { mode: 'site', points: [ptr.snap.point] };
          s.setStatus(
            isArea
              ? 'Fläche umfahren — zurück auf den Startpunkt, Doppelklick, Enter oder Rechtsklick schließt sie ab'
              : 'Zug zeichnen — Doppelklick, Enter oder Rechtsklick beendet ihn',
          );
          break;
        }

        // Der Schlusspunkt wird in Bildschirmpixeln gefangen, nicht in
        // Metern: ein Grundstück wird ausgezoomt umfahren, und dort wären
        // 0,50 m weniger als ein Mauszeiger breit.
        const startScreen = toScreen(draft.points[0]);
        const closing =
          isArea && draft.points.length >= 3 && distance(startScreen, ptr.screen) <= schlussPixel(letzteArtRef.current);
        // Zweimal auf dieselbe Stelle heißt ebenfalls „fertig" — das ist die
        // Geste, die der Doppelklick auslöst.
        const lastScreen = toScreen(draft.points[draft.points.length - 1]);
        const repeated = distance(lastScreen, ptr.screen) <= 3;

        if (closing || repeated) {
          const points = draft.points;
          const needed = isArea ? 3 : 2;
          if (points.length >= needed) s.addSiteElement(kind, points);
          else
            s.setStatus(
              isArea
                ? 'Zu wenige Ecken — eine Fläche braucht mindestens drei.'
                : 'Zu wenige Punkte — ein Zug braucht mindestens zwei.',
            );
          draftRef.current = { mode: 'idle' };
          break;
        }

        const points = [...draft.points, ptr.snap.point];
        draftRef.current = { mode: 'site', points };
        const hint = isArea
          ? points.length >= 3
            ? 'Startpunkt anklicken schließt die Fläche'
            : 'noch mindestens eine Ecke'
          : 'Doppelklick beendet den Zug';
        s.setStatus(`${SITE_ELEMENT_LABELS[kind]} — ${points.length} Punkte · ${hint} · Rücktaste nimmt den letzten zurück`);
        break;
      }

      case 'annotation': {
        const draft = draftRef.current;
        if (s.annotationKind === 'text') {
          /*
           * Erst schauen, ob dort schon eine Beschriftung liegt.
           *
           * Die Trefferprüfung misst den Abstand zum Ankerpunkt; mit dem
           * Finger trifft man den selten auf Anhieb. Jeder Fehlversuch legte
           * bisher eine **weitere** Beschriftung an, und im Plan sammelten
           * sich Platzhalter. Wer eine bestehende trifft, ändert sie.
           */
          const treffer = pickAt(ptr.world);
          if (treffer?.kind === 'annotation') {
            const vorhanden = s.doc.annotations[treffer.id];
            if (vorhanden?.kind === 'text') {
              s.setSelection({ kind: 'annotation', id: vorhanden.id });
              setTextEingabe({ id: vorhanden.id, wert: vorhanden.text ?? '', screen: { ...ptr.screen } });
              s.setStatus('Text ändern — Enter setzt ihn, Esc bricht ab.');
              break;
            }
          }
          const neu = s.addAnnotation('text', [ptr.snap.point], '');
          if (neu) {
            setTextEingabe({ id: neu.id, wert: '', screen: { ...ptr.screen } });
            s.setStatus('Text eingeben — Enter setzt ihn, Esc bricht ab.');
          }
          break;
        }
        if (draft.mode === 'annotation') {
          s.addAnnotation(s.annotationKind, [draft.start, ptr.snap.point]);
          draftRef.current = { mode: 'idle' };
        } else {
          draftRef.current = { mode: 'annotation', start: ptr.snap.point };
          s.setStatus(
            s.annotationKind === 'dimension'
              ? 'Zweiten Messpunkt setzen'
              : 'Textpunkt setzen — die Fahne zeigt auf den ersten Punkt',
          );
        }
        break;
      }

      case 'calibrate':
        // Die Kalibrierung läuft vollständig in <CalibrationOverlay/> —
        // dort liegt eine eigene Ereignisebene über dem Canvas.
        break;

      case 'select':
      default: {
        /*
         * Zuerst die Griffe der gefassten Beschriftung — sie liegen über
         * allem anderen.
         *
         * **Warum vor `pickAt`.** Der Größengriff sitzt am Rand der Textbox,
         * und die Box ist selbst ein Trefferziel. Käme `pickAt` zuerst,
         * würde der Griff nie erreicht: man verschöbe den Text, statt ihn zu
         * skalieren. Die Reihenfolge ist also kein Zufall, sondern die
         * Regel „das Feinere schlägt das Gröbere".
         */
        const griff = griffTreffer(ptr.world);
        if (griff) {
          draftRef.current = griff;
          scheduleRender();
          break;
        }
        const hit = pickAt(ptr.world);
        // Alt+Klick auf einen KI-Vorschlag verwirft ihn direkt.
        if (hit?.kind === 'trace' && (e.altKey || e.ctrlKey || e.metaKey)) {
          s.rejectTraceCandidate(hit.id);
          break;
        }

        const additive = e.ctrlKey || e.metaKey || e.shiftKey;

        if (!hit) {
          // Auf leere Fläche geklickt: Auswahlrahmen aufziehen.
          if (!additive) s.setSelection(null);
          marqueeRef.current = { from: ptr.world, to: ptr.world };
          draftRef.current = { mode: 'marquee', from: ptr.world };
          break;
        }

        const target = { kind: hit.kind, id: hit.id };
        const already = s.selections.some((x) => x.kind === target.kind && x.id === target.id);

        if (additive) {
          s.toggleSelection(target);
          break;
        }
        if (!already) s.setSelection(target);

        // Mehrere Objekte gefasst → gemeinsam verschieben statt einzeln.
        // `moveSelection` beherrscht Wand, TGA-Objekt, Wärmepumpe,
        // Geländeobjekt, Armatur, Leitung und Beschriftung; alles andere
        // bleibt beim Einzelziehen.
        const multi = (already ? s.selections : [target]).length > 1;
        if (multi && MIT_AUSWAHL_ZIEHBAR.has(hit.kind)) {
          draftRef.current = { mode: 'dragSelection', lastWorld: ptr.world };
        } else if (hit.kind === 'node') draftRef.current = { mode: 'dragNode', nodeId: hit.id };
        else if (hit.kind === 'opening') draftRef.current = { mode: 'dragOpening', openingId: hit.id };
        else if (hit.kind === 'fixture') draftRef.current = { mode: 'dragFixture', fixtureId: hit.id };
        else if (hit.kind === 'vertical') draftRef.current = { mode: 'dragVertical', verticalId: hit.id };
        else if (hit.kind === 'solid') draftRef.current = { mode: 'dragSolid', solidId: hit.id };
        else if (hit.kind === 'durchbruch')
          draftRef.current = { mode: 'dragDurchbruch', durchbruchId: hit.id };
        else if (hit.kind === 'heatpump') draftRef.current = { mode: 'dragPump', pumpId: hit.id };
        else if (hit.kind === 'site') {
          draftRef.current = { mode: 'dragSite', elementId: hit.id, lastWorld: ptr.world };
        }
        else if (hit.kind === 'roofOpening') draftRef.current = { mode: 'dragRoofOpening', openingId: hit.id };
        else if (hit.kind === 'annotation') {
          draftRef.current = { mode: 'dragAnnotation', annotationId: hit.id, lastWorld: ptr.world };
        }
        else if (hit.kind === 'wall' || hit.kind === 'accessory' || hit.kind === 'pipe') {
          // Armatur und Leitung wandern über dieselbe Geste wie die Wand:
          // Versatz auf die ganze Auswahl. Wer sie anklicken kann, soll sie
          // auch bewegen können.
          draftRef.current = { mode: 'dragSelection', lastWorld: ptr.world };
        }
        else if (hit.kind === 'image') draftRef.current = { mode: 'dragImage', lastWorld: ptr.world };
        break;
      }
    }
    scheduleRender();
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const art = eingabeart(e.pointerType);
    letzteArtRef.current = art;

    // Finger nachführen — auch die, die gerade nur die Geste tragen.
    if (art === 'finger') {
      const r = e.currentTarget.getBoundingClientRect();
      const jetztPunkt = { x: e.clientX - r.left, y: e.clientY - r.top };
      const bekannt = fingerRef.current.has(e.pointerId);
      fingerRef.current.set(e.pointerId, jetztPunkt);

      const geste = gesteRef.current;
      if (geste && bekannt) {
        const paar = [...fingerRef.current.values()];
        if (paar.length >= 2) {
          const neuePaarlage = { a: paar[0], b: paar[1] };
          const feld = sizeRef.current;
          const naechster = gestenschritt(geste, neuePaarlage, viewport, feld);
          gesteRef.current = neuePaarlage;
          store.getState().setViewport(naechster);
          scheduleRender();
        }
        return;
      }
      // Ein Finger, der weder schiebt noch Teil einer Geste ist, ist der
      // Handballen. Er bewegt nichts.
      if (!bekannt) return;
    }

    // Solange der Stift arbeitet, rührt kein Finger etwas an.
    if (art === 'finger' && zeigerLageRef.current.stiftUnten) return;

    const ptr = updatePointer(e);
    const draft = draftRef.current;
    const s = store.getState();

    switch (draft.mode) {
      case 'pan': {
        const tipp = tippRef.current;
        if (tipp && tipp.id === e.pointerId) {
          tipp.weg = Math.max(tipp.weg, Math.hypot(ptr.screen.x - tipp.start.x, ptr.screen.y - tipp.start.y));
        }
        const dx = ptr.screen.x - draft.lastScreen.x;
        const dy = ptr.screen.y - draft.lastScreen.y;
        s.setViewport({
          center: {
            x: viewport.center.x - dx / viewport.zoom,
            y: viewport.center.y + dy / viewport.zoom,
          },
        });
        draftRef.current = { mode: 'pan', lastScreen: ptr.screen };
        break;
      }
      case 'freihand': {
        // Nur der Zeiger, der den Strich angefangen hat, schreibt hinein —
        // und nur, solange er wirklich aufliegt. Ein schwebender Stift meldet
        // `buttons === 0`; ohne die Prüfung sammelte ein Strich, dessen
        // `pointerup` verlorenging, beim bloßen Darüberfahren weiter Punkte.
        if (draftZeigerRef.current !== null && e.pointerId !== draftZeigerRef.current) break;
        if (e.buttons === 0) break;
        // Punkte erst ab einem Millimeter Abstand sammeln. Ein Tablet meldet
        // 120-mal in der Sekunde; ohne diese Schwelle stünden tausende
        // Punkte auf demselben Fleck, sobald die Hand kurz ruht.
        const letzter = draft.punkte[draft.punkte.length - 1];
        if (!letzter || Math.hypot(ptr.world.x - letzter.x, ptr.world.y - letzter.y) > 0.001) {
          draft.punkte.push(ptr.world);
          draft.druck.push(e.pressure > 0 ? e.pressure : 0.5);
        }
        break;
      }
      case 'roomTemplate': {
        draftRef.current = { mode: 'roomTemplate', from: draft.from, to: ptr.snap.point };
        break;
      }
      case 'dragNode': {
        s.moveNode(draft.nodeId, ptr.snap.point);
        break;
      }
      case 'dragOpening': {
        const op = doc.openings[draft.openingId];
        const wall = op && doc.walls[op.wallId];
        if (op && wall) {
          const g = getWallGeometry(wall, nodesOfLevel);
          if (g) {
            const rel = sub(ptr.world, g.a);
            const u = clamp(rel.x * g.dir.x + rel.y * g.dir.y, op.width / 2, g.length - op.width / 2);
            s.updateOpening(op.id, { distance: u });
          }
        }
        break;
      }
      case 'dragFixture': {
        s.moveFixture(draft.fixtureId, ptr.world);
        break;
      }
      case 'dragVertical': {
        s.updateVertical(draft.verticalId, { position: ptr.snap.point });
        break;
      }
      case 'dragSolid': {
        // Ein freier Umriss wandert mit: er steht in Weltkoordinaten, sonst
        // bliebe er beim Verschieben des Mittelpunkts liegen.
        const current = s.doc.solids?.[draft.solidId];
        if (!current) break;
        const dx = ptr.snap.point.x - current.position.x;
        const dy = ptr.snap.point.y - current.position.y;
        s.updateSolid(draft.solidId, {
          position: ptr.snap.point,
          outline: current.outline?.map((q) => ({ x: q.x + dx, y: q.y + dy })),
        });
        break;
      }
      case 'dragDurchbruch': {
        /*
         * Ein Wanddurchbruch bewegt sich **auf seiner Wand**, nicht frei.
         *
         * Gezogen wird deshalb nur der Abstand auf der Achse: der Zeiger wird
         * auf die Wandachse projiziert, und der Fußpunkt ist der neue Abstand.
         * Nähme man statt dessen den Zeigerpunkt, sprünge der Durchbruch aus
         * der Wand heraus und das Loch säße neben dem Bauteil.
         *
         * Zieht man weit genug weg, wechselt er auf die nächstgelegene andere
         * Wand — dieselbe Geste wie beim Verschieben eines Fensters, und aus
         * demselben Grund: ein Durchbruch, den man nur löschen und neu setzen
         * kann, wird nicht verschoben, sondern verdoppelt.
         */
        const current = s.doc.durchbrueche?.[draft.durchbruchId];
        if (!current) break;
        if (durchbruchWirt(current.kind) === 'decke') {
          s.updateDurchbruch(draft.durchbruchId, { position: ptr.snap.point });
          break;
        }
        const treffer = pickWallForOpening(ptr.world, walls, nodesOfLevel, DURCHBRUCH_REICHWEITE);
        if (!treffer) break;
        s.updateDurchbruch(draft.durchbruchId, {
          wallId: treffer.wall.id,
          distance: treffer.distanceAlong,
        });
        break;
      }
      case 'dragPump': {
        s.updateHeatPump(draft.pumpId, { position: ptr.snap.point });
        break;
      }
      case 'dragSite': {
        // Ein Punktobjekt springt auf den Fangpunkt, ein mehrpunktiges wandert
        // um die zurückgelegte Strecke. Einzelne Stützpunkte lassen sich nicht
        // greifen: eine Grenze oder eine Kollektorfläche wird umgesetzt, nicht
        // umgeformt — wer sie umformen will, zeichnet sie neu.
        const element = s.doc.site.elements[draft.elementId];
        if (!element) {
          draftRef.current = { ...draft, lastWorld: ptr.world };
          break;
        }
        if (element.points.length === 1) {
          s.updateSiteElement(element.id, { points: [ptr.snap.point] });
          draftRef.current = { ...draft, lastWorld: ptr.world };
          break;
        }
        // Dieselbe Rasterung wie beim Verschieben einer Wand. Ohne sie
        // verlässt ein Grundstück, das auf dem Raster gezeichnet wurde, das
        // Raster beim ersten Verschieben und kommt nie wieder darauf zurück.
        const roh = { x: ptr.world.x - draft.lastWorld.x, y: ptr.world.y - draft.lastWorld.y };
        const schritt = snap.grid ? snap.gridSize : 0;
        const delta = schritt
          ? { x: Math.round(roh.x / schritt) * schritt, y: Math.round(roh.y / schritt) * schritt }
          : roh;
        if (Math.abs(delta.x) > 1e-9 || Math.abs(delta.y) > 1e-9) {
          s.updateSiteElement(element.id, {
            points: element.points.map((pt) => ({ x: pt.x + delta.x, y: pt.y + delta.y })),
          });
          draftRef.current = {
            ...draft,
            lastWorld: { x: draft.lastWorld.x + delta.x, y: draft.lastWorld.y + delta.y },
          };
        }
        break;
      }
      case 'dragRoofOpening': {
        s.updateRoofOpening(draft.openingId, { position: ptr.snap.point });
        break;
      }
      case 'dragAnnotation': {
        // Die ganze Beschriftung wandert mit; bei der Maßkette bleibt der
        // Bezug erhalten, weil beide Punkte gemeinsam verschoben werden.
        const note = store.getState().doc.annotations[draft.annotationId];
        if (note) {
          const dx = ptr.world.x - draft.lastWorld.x;
          const dy = ptr.world.y - draft.lastWorld.y;
          s.updateAnnotation(note.id, {
            points: note.points.map((p2) => ({ x: p2.x + dx, y: p2.y + dy })),
          });
        }
        draftRef.current = { ...draft, lastWorld: ptr.world };
        break;
      }
      case 'dragAnnotationPoint': {
        // Ein einzelner Punkt — und der **fängt**, im Gegensatz zum
        // Verschieben der ganzen Beschriftung: Wer einen Messpunkt umsetzt,
        // meint eine Ecke und nicht eine Stelle in ihrer Nähe.
        const note = store.getState().doc.annotations[draft.annotationId];
        if (note) {
          const punkte = note.points.map((p2, i) => (i === draft.index ? ptr.snap.point : p2));
          s.updateAnnotation(note.id, { points: punkte });
        }
        break;
      }
      case 'scaleAnnotation': {
        const note = store.getState().doc.annotations[draft.annotationId];
        if (note && draft.startAbstand > 1e-6) {
          const jetzt = distance(draft.anker, ptr.world);
          // Dieselben Grenzen wie im Inspektor (0,5 bis 3) — zwei Wege zur
          // selben Größe dürfen nicht zwei verschiedene Bereiche haben.
          const faktor = jetzt / draft.startAbstand;
          const neu = Math.max(0.5, Math.min(3, draft.startScale * faktor));
          s.updateAnnotation(note.id, { scale: Math.round(neu * 100) / 100 });
        }
        break;
      }
      case 'marquee': {
        marqueeRef.current = { from: draft.from, to: ptr.world };
        break;
      }
      case 'dragSelection': {
        // Am Raster ausgerichtet verschieben, damit die Auswahl im Raster bleibt.
        const raw = { x: ptr.world.x - draft.lastWorld.x, y: ptr.world.y - draft.lastWorld.y };
        const step = snap.grid ? snap.gridSize : 0;
        const delta = step
          ? { x: Math.round(raw.x / step) * step, y: Math.round(raw.y / step) * step }
          : raw;
        if (Math.abs(delta.x) > 1e-9 || Math.abs(delta.y) > 1e-9) {
          s.moveSelection(delta);
          draftRef.current = {
            mode: 'dragSelection',
            lastWorld: { x: draft.lastWorld.x + delta.x, y: draft.lastWorld.y + delta.y },
          };
        }
        break;
      }
      case 'dragImage': {
        s.moveImage({ x: ptr.world.x - draft.lastWorld.x, y: ptr.world.y - draft.lastWorld.y });
        draftRef.current = { mode: 'dragImage', lastWorld: ptr.world };
        break;
      }
      default: {
        if (tool === 'select') {
          const hit = pickAt(ptr.world);
          s.setHover(hit ? { kind: hit.kind, id: hit.id } : null);
        }
      }
    }

    // Statuszeile mit Live-Koordinaten füttern
    if (draft.mode === 'wall') {
      const len = distance(draft.start, ptr.snap.point);
      const ang = Math.atan2(ptr.snap.point.y - draft.start.y, ptr.snap.point.x - draft.start.x) * TO_DEG;
      s.setStatus(`L = ${de(len, 3)} m   ∠ ${de((ang + 360) % 360, 1)}°`);
    }

    scheduleRender();
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const art = eingabeart(e.pointerType);
    if (art !== 'maus') {
      zeigerLageRef.current = fortschreiben(zeigerLageRef.current, art, 'hoch', e.timeStamp);
    }
    if (art === 'finger') {
      fingerRef.current.delete(e.pointerId);
      // Die Geste endet, sobald der zweite Finger geht. Der verbliebene
      // Finger schiebt **nicht** weiter: wer nach dem Zoomen einen Finger
      // liegen lässt, will das Bild nicht auch noch verschieben.
      if (fingerRef.current.size < 2 && gesteRef.current) {
        gesteRef.current = null;
        draftZeigerRef.current = null;
        if (draftRef.current.mode === 'pan') draftRef.current = { mode: 'idle' };
        return;
      }
    }

    /*
     * Gehört dieses Abheben überhaupt zum laufenden Vorgang?
     *
     * Der Handballen, der neben dem zeichnenden Stift abhebt, darf den Strich
     * nicht beenden. Er hat ihn nicht angefangen, also hat er hier nichts zu
     * melden — außer der Buchführung oben, die schon gelaufen ist.
     */
    if (draftZeigerRef.current !== null && e.pointerId !== draftZeigerRef.current) {
      scheduleRender();
      return;
    }
    draftZeigerRef.current = null;

    /*
     * Kurz aufgesetzt, nicht gewandert: Das war kein Schieben, sondern ein
     * Tippen — und ein Tippen bedient dasselbe wie ein Mausklick. Die
     * Entscheidung fällt hier und nicht beim Aufsetzen, weil sie vorher nicht
     * zu treffen ist: Ob der Finger schiebt, weiß man erst, wenn er wieder
     * weg ist.
     */
    const tipp = tippRef.current;
    tippRef.current = null;
    if (tipp && tipp.id === e.pointerId && istTipp(tipp.weg, e.timeStamp - tipp.zeit)) {
      draftRef.current = { mode: 'idle' };
      handlePointerDown(e, true);
    }

    // Rechte Maustaste: wurde nicht geschwenkt, war es ein Abbruch-Klick.
    if (e.button === 2 && rightDownRef.current) {
      const moved = distance(rightDownRef.current, pointerRef.current.screen);
      if (moved < 4) {
        // Rechtsklick ohne Schwenk ist in jedem CAD das Zeichen „fertig".
        // Deshalb wird der laufende Zug übernommen und nicht weggeworfen.
        if (!finishDraft()) {
          draftRef.current = { mode: 'idle' };
          store.getState().setSelection(null);
          store.getState().setStatus('Bereit');
        }
      }
      rightDownRef.current = null;
    }
    // Freihand: beim Abheben wird ausgewertet. Vorher passiert nichts — ein
    // Strich, der schon während des Ziehens Wände vorschlägt, flackert.
    if (draftRef.current.mode === 'freihand') {
      const draft = draftRef.current;
      draftRef.current = { mode: 'idle' };
      const s2 = store.getState();
      if (draft.zweck === 'skizze') s2.skizziere(draft.punkte);
      else if (draft.zweck === 'radieren') s2.radiere(draft.punkte);
      else s2.notiere(draft.punkte, draft.druck);
      s2.endGesture();
      scheduleRender();
      return;
    }

    // Raumvorlage: beim Loslassen entsteht der Wandring. Zu kleines
    // Aufziehen gilt als Klick — dann bleibt der Zug offen und der nächste
    // Klick setzt die zweite Ecke. So funktioniert beides: ziehen und klicken.
    if (draftRef.current.mode === 'roomTemplate') {
      const draft = draftRef.current;
      const s = store.getState();
      const dragged = Math.abs(draft.to.x - draft.from.x) > 0.5 && Math.abs(draft.to.y - draft.from.y) > 0.5;
      if (dragged) {
        s.addRoomTemplate(s.roomTemplate, draft.from, draft.to, s.roomTemplateOptions);
        draftRef.current = { mode: 'idle' };
      }
      scheduleRender();
      return;
    }

    if (draftRef.current.mode === 'marquee' && marqueeRef.current) {
      const { from, to } = marqueeRef.current;
      const min = { x: Math.min(from.x, to.x), y: Math.min(from.y, to.y) };
      const max = { x: Math.max(from.x, to.x), y: Math.max(from.y, to.y) };
      // Winzige Rahmen sind versehentliche Klicks, keine Auswahl.
      if (max.x - min.x > 0.05 || max.y - min.y > 0.05) {
        store.getState().selectInBox(min, max, e.ctrlKey || e.metaKey || e.shiftKey);
        const count = store.getState().selections.length;
        store.getState().setStatus(count ? `${count} Objekte ausgewählt` : 'Nichts im Rahmen');
      }
      marqueeRef.current = null;
    }

    // Wand-, Rohr- und Außenanlagenzug überleben das Loslassen bewusst: alle
    // drei werden als Kette gezeichnet, ein Klick setzt jeweils nur den
    // nächsten Punkt.
    const persistent = draftRef.current.mode === 'wall' || draftRef.current.mode === 'pipe' || draftRef.current.mode === 'site';
    if (!persistent) {
      draftRef.current = { mode: 'idle' };
    }
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    store.getState().endGesture();
    scheduleRender();
  };

  const handleWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const before = toWorld(screen);

      const factor = Math.exp(-e.deltaY * 0.0016);
      const zoom = clamp(viewport.zoom * factor, 4, 900);

      // Zoom zum Cursor: der Weltpunkt unter der Maus bleibt fix.
      const { w, h } = sizeRef.current;
      const center = {
        x: before.x - (screen.x - w / 2) / zoom,
        y: before.y + (screen.y - h / 2) / zoom,
      };
      store.getState().setViewport({ zoom, center });
    },
    [store, toWorld, viewport.zoom],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  // -------------------------------------------------------------------------
  // Tastatur
  // -------------------------------------------------------------------------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      const s = store.getState();

      // Ziffer beim Zeichnen → numerische Längeneingabe öffnen
      if (draftRef.current.mode === 'wall' && !e.ctrlKey && !e.metaKey && /^[0-9.,]$/.test(e.key)) {
        e.preventDefault();
        setLengthInput((prev) => (prev ?? '') + e.key.replace(',', '.'));
        return;
      }

      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        // Ist ein Raum gefasst, wird der ganze Raum kopiert und nicht
        // „nichts ausgewählt" gemeldet: ein Raum ist im Modell keine
        // Wand und keine Wandgruppe, aber gemeint ist er trotzdem.
        if (s.selection?.kind === 'room') s.copyRoom(s.selection.id);
        else s.copySelection();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        s.pasteClipboard();
        scheduleRender();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        s.selectAll();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        if (s.selection?.kind === 'room') {
          s.duplicateRoom(s.selection.id);
        } else {
          s.copySelection();
          s.pasteClipboard({ x: 0.5, y: -0.5 });
        }
        scheduleRender();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        s.mirrorSelection('x');
        scheduleRender();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        s.mirrorSelection('y');
        scheduleRender();
        return;
      }

      // Pfeiltasten schieben die Auswahl um eine Rasterweite.
      if (e.key.startsWith('Arrow') && s.selections.length) {
        e.preventDefault();
        const step = e.shiftKey ? s.snap.gridSize * 4 : s.snap.gridSize;
        const delta =
          e.key === 'ArrowLeft'
            ? { x: -step, y: 0 }
            : e.key === 'ArrowRight'
              ? { x: step, y: 0 }
              : e.key === 'ArrowUp'
                ? { x: 0, y: step }
                : { x: 0, y: -step };
        s.moveSelection(delta);
        scheduleRender();
        return;
      }

      // Geschoss wechseln
      if (e.key === 'PageUp' || e.key === 'PageDown') {
        e.preventDefault();
        const levels = Object.values(s.doc.levels).sort((a, b) => a.order - b.order);
        const index = levels.findIndex((l) => l.id === s.doc.activeLevelId);
        const next = levels[index + (e.key === 'PageUp' ? 1 : -1)];
        if (next) s.setActiveLevel(next.id);
        scheduleRender();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
        scheduleRender();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        s.redo();
        scheduleRender();
        return;
      }

      switch (e.key) {
        case 'Escape': {
          // Ein laufender Rohrzug wird beim Abbrechen *übernommen*, wenn er
          // schon zwei Punkte hat — sonst verliert man mit einem Tastendruck
          // die gesamte Trasse.
          const finished = finishDraft();
          const warAmZeichnen = finished || draftRef.current.mode !== 'idle';
          draftRef.current = { mode: 'idle' };
          marqueeRef.current = null;
          setLengthInput(null);
          if (!finished) {
            s.setSelection(null);
          }
          /*
           * Escape in zwei Stufen — und die zweite hat lange gefehlt.
           *
           * Bisher beendete Escape nur die angefangene Kette. Das Werkzeug
           * blieb aktiv, und weil das Programm im Werkzeug „Wand" startet,
           * hieß das: Jeder Klick zeichnete, statt auszuwählen. Man konnte
           * nichts anfassen, nichts verschieben und vor allem nichts löschen,
           * solange man nicht von Hand den Pfeil in der Werkzeugkiste
           * anklickte. Gemeldet kam das als „gesetzte Armaturen sind nicht
           * löschbar" — dabei war das Löschen nie das Problem, sondern das
           * Anfassen.
           *
           * Jetzt: Die erste Stufe beendet, was gerade läuft. Ist nichts
           * mehr zu beenden, geht die zweite zurück auf Auswahl. Das ist die
           * Erwartung aus jedem CAD, und es kostet den, der weiterzeichnen
           * will, genau nichts: Er drückt Escape einmal.
           */
          if (warAmZeichnen) {
            s.setStatus('Bereit');
          } else if (s.tool !== 'select') {
            s.setTool('select');
            s.setStatus('Auswahl — anklicken, um etwas anzufassen');
          } else {
            s.setStatus('Bereit');
          }
          break;
        }
        case 'Enter': {
          // Enter schließt den laufenden Zug ab. Ohne diese Taste bleibt nur
          // der Klick auf den Startpunkt, und der ist bei einem großen
          // Grundstück am schwersten zu treffen.
          if (finishDraft()) {
            e.preventDefault();
            scheduleRender();
          }
          break;
        }
        case 'Delete':
        case 'Backspace': {
          // Während eines Zuges nimmt die Rücktaste den letzten Punkt zurück,
          // statt die Auswahl zu löschen. Ein Fehlklick beim Umfahren kostet
          // damit einen Tastendruck und nicht die ganze Umfahrung.
          const draft = draftRef.current;
          if (draft.mode === 'site' || draft.mode === 'pipe') {
            e.preventDefault();
            const points = draft.points.slice(0, -1);
            draftRef.current = points.length ? { ...draft, points } : { mode: 'idle' };
            s.setStatus(points.length ? `${points.length} Punkte` : 'Zeichnen abgebrochen');
            scheduleRender();
            break;
          }
          // Ein selektierter KI-Vorschlag wird verworfen, nicht gelöscht —
          // er bleibt in der Trace-Liste wiederherstellbar.
          if (s.selection?.kind === 'trace') s.rejectTraceCandidate(s.selection.id);
          else s.deleteSelection();
          break;
        }
        case 'v':
        case 'V':
          s.setTool('select');
          break;
        case 'w':
        case 'W':
          s.setTool('wall');
          break;
        case 'q':
        case 'Q':
          // Neben dem W: skizzieren und zeichnen liegen nebeneinander, weil
          // sie dasselbe meinen — nur mit verschiedener Genauigkeit.
          s.setTool('sketch');
          break;
        case 'k':
        case 'K':
          s.setTool('ink');
          break;
        case 'd':
        case 'D':
          s.setTool('door');
          break;
        case 'f':
        case 'F':
          s.setTool('window');
          break;
        case 'g':
        case 'G':
          s.setSnap({ grid: !s.snap.grid });
          break;
        case 'e':
        case 'E':
          s.setTool('passage');
          break;
        case 't':
        case 'T':
          s.setTool('fixture');
          break;
        case 'r':
        case 'R':
          s.setTool('stair');
          break;
        case 's':
        case 'S':
          s.setTool('shaft');
          break;
        case 'm':
        case 'M':
          /*
           * Zwei Dinge auf einer Taste, und zwar mit Absicht.
           *
           * Bis 1.20.3 stand die Bemaßungsumschaltung als zweite `case 'm'`
           * weiter unten in *demselben* switch — und war damit toter Code:
           * die erste Verzweigung greift, die zweite wird nie erreicht. Die
           * Taste tat also nur eines, und im Handbuch stand beides. Der
           * Übersetzer hat es die ganze Zeit gemeldet.
           *
           * Statt eines neuen Buchstabens bekommt die Bemaßung den
           * Zusatzgriff: M für „massives Bauteil", Strg+M für „Maße". Der
           * Merksatz bleibt damit derselbe, und kein weiterer Buchstabe ist
           * verbraucht.
           */
          if (e.ctrlKey || e.metaKey) s.toggleDimensions();
          else s.setTool('solid');
          break;
        case 'u':
        case 'U':
          s.setTool('durchbruch');
          break;
        case 'l':
        case 'L':
          s.setTool('pipe');
          break;
        case 'b':
        case 'B':
          s.setTool('annotation');
          break;
        case 'z':
        case 'Z':
          // Strg+Z ist das Rückgängig — nur das nackte Z schaltet um.
          if (e.ctrlKey || e.metaKey) break;
          s.setTool('room');
          break;
        case 'p':
        case 'P':
          s.setTool('heatpump');
          break;
        case 'a':
        case 'A':
          // Strg+A wählt alles aus — das darf hier nicht dazwischenfunken.
          if (e.ctrlKey || e.metaKey) break;
          s.setTool('site');
          break;
        case 'o':
        case 'O':
          s.setOrthoLock(!s.orthoLock);
          s.setStatus(s.orthoLock ? 'Ortho-Zwang aus' : 'Ortho-Zwang an — nur 0/90°');
          break;
        case 'h':
        case 'H':
          s.toggleGuides();
          break;
        case 'Home':
        case '0':
          fitToContent();
          break;
        default:
          return;
      }
      scheduleRender();
    };

    // Leertaste = temporärer Schwenkmodus, wie in jedem Grafikwerkzeug.
    const onSpaceDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !spaceRef.current) {
        const target = e.target as HTMLElement | null;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
        e.preventDefault();
        spaceRef.current = true;
        scheduleRender();
      }
    };
    const onSpaceUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceRef.current = false;
        scheduleRender();
      }
    };

    window.addEventListener('keydown', onKey);
    window.addEventListener('keydown', onSpaceDown);
    window.addEventListener('keyup', onSpaceUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keydown', onSpaceDown);
      window.removeEventListener('keyup', onSpaceUp);
    };
  }, [fitToContent, scheduleRender, store]);

  /**
   * Den eingegebenen Text übernehmen — oder die leere Beschriftung wieder
   * wegnehmen.
   *
   * Eine Beschriftung ohne Text ist kein Zwischenstand, sondern Müll im Plan:
   * unsichtbar bis auf den Anker, und beim nächsten Antippen fängt man sich
   * eine zweite ein. Wer abbricht, soll den Plan so vorfinden wie vorher.
   */
  const schliesseTextEingabe = useCallback(
    (uebernehmen: boolean) => {
      const eingabe = textEingabe;
      if (!eingabe) return;
      const s2 = store.getState();
      const text = eingabe.wert.trim();
      if (uebernehmen && text.length > 0) {
        s2.updateAnnotation(eingabe.id, { text });
        s2.setStatus(`Beschriftung „${text}" gesetzt.`);
      } else {
        s2.deleteAnnotation(eingabe.id);
        s2.setStatus(uebernehmen ? 'Leere Beschriftung wieder entfernt.' : 'Beschriftung abgebrochen.');
      }
      setTextEingabe(null);
      scheduleRender();
    },
    [textEingabe, scheduleRender, store],
  );

  /** Setzt die Wand mit exakt der eingegebenen Länge in der aktuellen Richtung. */
  const commitLengthInput = useCallback(() => {
    const draft = draftRef.current;
    const value = parseFloat((lengthInput ?? '').replace(',', '.'));
    if (draft.mode !== 'wall' || !Number.isFinite(value) || value <= 0) {
      setLengthInput(null);
      return;
    }
    const ptr = pointerRef.current;
    let dx = ptr.snap.point.x - draft.start.x;
    let dy = ptr.snap.point.y - draft.start.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) {
      // Ohne Richtung: nach Osten, das ist die Konvention beim Zeichnen.
      dx = 1;
      dy = 0;
    } else {
      dx /= len;
      dy /= len;
    }
    const end = { x: draft.start.x + dx * value, y: draft.start.y + dy * value };
    const s2 = store.getState();
    s2.addWall(draft.start, end);
    draftRef.current = { mode: 'wall', start: end };
    s2.setStatus(`Wand ${de(value, 3)} m gesetzt`);
    setLengthInput(null);
    scheduleRender();
  }, [lengthInput, scheduleRender, store]);

  const cursor = spaceRef.current || tool === 'pan' ? 'grab' : tool === 'select' ? 'default' : 'crosshair';

  /** Zoomt um den Bildschirmmittelpunkt — für die Bedienelemente am Rand. */
  const zoomBy = (factor: number) => {
    const next = clamp(viewport.zoom * factor, 4, 900);
    store.getState().setViewport({ zoom: next });
  };

  return (
    <div ref={wrapRef} className={`relative h-full w-full overflow-hidden ${className}`}>
      <canvas
        ref={canvasRef}
        style={{ cursor }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={() => {
          pointerRef.current.inside = false;
          scheduleRender();
        }}
        // Verliert der Zeiger die Erfassung (Fenster wechselt, Geste bricht
        // ab), kommt kein `pointerup` mehr — die Klammer muss trotzdem zu,
        // sonst wüchse die nächste Änderung in die abgebrochene Geste hinein.
        onPointerCancel={(e) => {
          // Der Browser nimmt uns den Zeiger weg — Fokusverlust, Systemgeste,
          // Anruf. Ohne Aufräumen bliebe ein Finger für immer „aufliegend"
          // und danach zeichnete nie wieder etwas.
          const art = eingabeart(e.pointerType);
          if (art !== 'maus') {
            zeigerLageRef.current = fortschreiben(zeigerLageRef.current, art, 'hoch', e.timeStamp);
          }
          if (art === 'finger') {
            fingerRef.current.delete(e.pointerId);
            if (fingerRef.current.size < 2) gesteRef.current = null;
          }
          /*
           * Der abgebrochene Freihandstrich wird **weggeworfen**, nicht
           * ausgewertet. Ein Strich, den das System uns aus der Hand nimmt,
           * ist keine Aussage über einen Grundriss — würde er ausgewertet,
           * stünden Wandvorschläge im Bild, die niemand gezogen hat.
           *
           * Ohne dieses Aufräumen blieb der Entwurf auf 'freihand' stehen: der
           * Strich sammelte beim bloßen Darüberfahren weiter Punkte und wurde
           * beim nächstbesten Abheben — auch dem eines Handballens — als
           * Geisterzug ausgewertet.
           */
          if (draftZeigerRef.current === null || draftZeigerRef.current === e.pointerId) {
            draftZeigerRef.current = null;
            if (draftRef.current.mode === 'freihand') {
              draftRef.current = { mode: 'idle' };
              store.getState().setStatus('Strich abgebrochen.');
            }
          }
          store.getState().endGesture();
          scheduleRender();
        }}
        onLostPointerCapture={() => store.getState().endGesture()}
        /*
         * Doppeltippen auf eine Beschriftung öffnet sie zum Ändern — auch mit
         * dem Auswahlwerkzeug. Das ist der Griff, den jeder zuerst probiert.
         */
        onDoubleClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const screen = { x: e.clientX - r.left, y: e.clientY - r.top };
          const welt = toWorld(screen);
          const treffer = pickAt(welt);
          if (treffer?.kind !== 'annotation') return;
          const note = store.getState().doc.annotations[treffer.id];
          if (!note || note.kind !== 'text') return;
          e.preventDefault();
          store.getState().setSelection({ kind: 'annotation', id: note.id });
          setTextEingabe({ id: note.id, wert: note.text ?? '', screen });
        }}
        onContextMenu={(e) => e.preventDefault()}
      />

      {tool === 'room' && <RoomTemplateBar />}

      {showLegend && <PlanLegende onClose={() => setShowLegend(false)} />}

      {!showLegend && (
        <button
          className="panel absolute bottom-4 left-3 px-2.5 py-1.5 text-[10px] text-slate-400 transition hover:text-slate-200"
          title="Was bedeuten die Symbole und Farben im Plan?"
          onClick={() => setShowLegend(true)}
        >
          Legende
        </button>
      )}

      {/* Text unmittelbar im Plan eingeben — der Weg über den Inspektor ist
          auf dem Tablet keiner. */}
      {textEingabe !== null && (
        <div
          className="absolute z-20"
          style={{
            left: Math.min(textEingabe.screen.x + 14, Math.max(8, sizeRef.current.w - 260)),
            top: Math.min(textEingabe.screen.y + 14, Math.max(8, sizeRef.current.h - 64)),
          }}
        >
          <div className="panel flex items-center gap-2 px-2.5 py-2">
            <span className="label-xs">Text</span>
            <input
              autoFocus
              className="field w-44"
              placeholder="z. B. Steigleitung"
              value={textEingabe.wert}
              onChange={(e) => setTextEingabe((v) => (v ? { ...v, wert: e.target.value } : v))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  schliesseTextEingabe(true);
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  schliesseTextEingabe(false);
                }
              }}
            />
            <button
              className="chip bg-accent/15 text-accent"
              onClick={() => schliesseTextEingabe(true)}
              title="Text setzen"
            >
              Setzen
            </button>
          </div>
        </div>
      )}

      {/* Numerische Längeneingabe beim Zeichnen */}
      {lengthInput !== null && (
        <div
          className="absolute z-20"
          style={{
            left: Math.min(pointerRef.current.screen.x + 18, sizeRef.current.w - 150),
            top: Math.min(pointerRef.current.screen.y + 18, sizeRef.current.h - 60),
          }}
        >
          <div className="panel flex items-center gap-2 px-2.5 py-2">
            <span className="label-xs">Länge</span>
            <input
              autoFocus
              className="field w-20 font-mono"
              value={lengthInput}
              onChange={(e) => setLengthInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitLengthInput();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setLengthInput(null);
                }
              }}
            />
            <span className="text-[11px] text-slate-500">m</span>
          </div>
        </div>
      )}

      {/* Zoom-Bedienelemente: Navigation ohne jede Tastenkombination */}
      <div className="panel absolute bottom-4 right-3 flex flex-col overflow-hidden p-0.5">
        <button className="tool-btn h-7 w-7 text-base leading-none" title="Vergrößern" onClick={() => zoomBy(1.25)}>
          +
        </button>
        <button className="tool-btn h-7 w-7 text-base leading-none" title="Verkleinern" onClick={() => zoomBy(0.8)}>
          −
        </button>
        <div className="mx-auto my-0.5 h-px w-4 bg-white/[0.08]" />
        <button
          className="tool-btn h-7 w-7"
          title="Auf Gebäude einpassen · Taste 0"
          onClick={() => {
            fitToContent();
            scheduleRender();
          }}
        >
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4">
            <path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Eigene Ereignisebene für das 2-Punkt-Maßband — nur im Kalibriermodus aktiv */}
      <CalibrationOverlay />

      {/* Kontrollleiste der Auto-Trace-Vorschau */}
      <TraceReviewBar />
      <SkizzenLeiste />
      <NotizLeiste />
    </div>
  );
}

// ===========================================================================
// Zeichen-Primitiven (reine Funktionen, außerhalb der Komponente)
// ===========================================================================

type Sx = (x: number) => number;
type Sy = (y: number) => number;

const toScreenLocal = (p: Vec2, sx: Sx, sy: Sy): Vec2 => ({ x: sx(p.x), y: sy(p.y) });

function fillPiece(
  ctx: CanvasRenderingContext2D,
  g: WallGeometry,
  piece: PlanWallPiece,
  inset: number,
  _pad: number,
  sx: Sx,
  sy: Sy,
  insetStart = 0,
  insetEnd = 0,
): void {
  void _pad;
  const half = Math.max(0.002, g.halfThickness - inset);
  const u0 = piece.uStart + insetStart;
  const u1 = piece.uEnd - insetEnd;
  if (u1 <= u0) return;

  const ax = g.a.x + g.dir.x * u0;
  const ay = g.a.y + g.dir.y * u0;
  const bx = g.a.x + g.dir.x * u1;
  const by = g.a.y + g.dir.y * u1;
  const nx = g.normal.x * half;
  const ny = g.normal.y * half;

  ctx.beginPath();
  ctx.moveTo(sx(ax + nx), sy(ay + ny));
  ctx.lineTo(sx(bx + nx), sy(by + ny));
  ctx.lineTo(sx(bx - nx), sy(by - ny));
  ctx.lineTo(sx(ax - nx), sy(ay - ny));
  ctx.closePath();
  ctx.fill();
}

/** Adaptives Raster: die Schrittweite verdoppelt/verzehnfacht sich beim Auszoomen. */
function drawGrid(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  viewport: { zoom: number; center: Vec2 },
  baseStep: number,
): void {
  const { zoom, center } = viewport;
  let step = baseStep;
  while (step * zoom < 9) step *= step * zoom < 3 ? 10 : 2;
  const major = step * 5;

  const left = center.x - w / 2 / zoom;
  const right = center.x + w / 2 / zoom;
  const bottom = center.y - h / 2 / zoom;
  const top = center.y + h / 2 / zoom;

  ctx.lineWidth = 1;

  // Nebenlinien
  ctx.beginPath();
  for (let x = Math.ceil(left / step) * step; x <= right; x += step) {
    if (Math.abs(x % major) < 1e-6) continue;
    const px = Math.round((x - center.x) * zoom + w / 2) + 0.5;
    ctx.moveTo(px, 0);
    ctx.lineTo(px, h);
  }
  for (let y = Math.ceil(bottom / step) * step; y <= top; y += step) {
    if (Math.abs(y % major) < 1e-6) continue;
    const py = Math.round(h / 2 - (y - center.y) * zoom) + 0.5;
    ctx.moveTo(0, py);
    ctx.lineTo(w, py);
  }
  ctx.strokeStyle = C.gridMinor;
  ctx.stroke();

  // Hauptlinien
  ctx.beginPath();
  for (let x = Math.ceil(left / major) * major; x <= right; x += major) {
    const px = Math.round((x - center.x) * zoom + w / 2) + 0.5;
    ctx.moveTo(px, 0);
    ctx.lineTo(px, h);
  }
  for (let y = Math.ceil(bottom / major) * major; y <= top; y += major) {
    const py = Math.round(h / 2 - (y - center.y) * zoom) + 0.5;
    ctx.moveTo(0, py);
    ctx.lineTo(w, py);
  }
  ctx.strokeStyle = C.gridMajor;
  ctx.stroke();

  // Nullachsen
  ctx.beginPath();
  const zx = Math.round((0 - center.x) * zoom + w / 2) + 0.5;
  const zy = Math.round(h / 2 + center.y * zoom) + 0.5;
  ctx.moveTo(zx, 0);
  ctx.lineTo(zx, h);
  ctx.moveTo(0, zy);
  ctx.lineTo(w, zy);
  ctx.strokeStyle = C.axis;
  ctx.stroke();
}

/**
 * Tür- und Fenstersymbole nach Bauzeichnungs-Konvention.
 *
 * Die Geometrie kommt aus `openingSymbol` — derselben Funktion, aus der auch
 * der Ausdruck zeichnet. Hier bleibt nur, was den Bildschirm ausmacht: Farbe
 * nach Öffnungsart und die Hervorhebung der Auswahl. Solange beide Pfade ihre
 * eigene Geometrie rechneten, konnte im Plan eine Tür anders aufschlagen als
 * auf dem Blatt — und auf dem Blatt gar nicht.
 */
function drawOpeningSymbol(
  ctx: CanvasRenderingContext2D,
  g: WallGeometry,
  op: Opening,
  sx: Sx,
  sy: Sy,
  px: (m: number) => number,
  highlight: boolean,
): void {
  const ink =
    op.kind === 'passage'
      ? highlight
        ? '#FDE68A'
        : '#FBBF24'
      : op.kind === 'window'
        ? highlight
          ? '#7DD3FC'
          : C.glass
        : highlight
          ? '#BAE6FD'
          : C.door;

  const lineWidth = (weight: SymbolPart['weight']): number => {
    if (weight === 'stark') return highlight ? 3 : 2.25;
    if (weight === 'mittel') return highlight ? 2 : 1.25;
    return highlight ? 1.6 : 1;
  };

  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = ink;

  for (const part of openingSymbol(g, op)) {
    ctx.lineWidth = lineWidth(part.weight);
    ctx.globalAlpha = part.faint ? 0.55 : 1;

    if (part.kind === 'line') {
      ctx.setLineDash(part.dashed ? [5, 4] : []);
      const a = toScreenLocal(part.a, sx, sy);
      const b = toScreenLocal(part.b, sx, sy);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      continue;
    }

    // Bogen: die Winkel stehen im Modell (y nach oben), der Bildschirm rechnet
    // y nach unten. Beides zusammen heißt: Winkel negieren, Drehsinn behalten.
    ctx.setLineDash([]);
    const c = toScreenLocal(part.center, sx, sy);
    const r = px(part.radius);
    if (r < 1) continue;
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, -part.startAngle, -part.endAngle, part.ccw);
    ctx.stroke();
  }

  ctx.setLineDash([]);
  ctx.restore();
}

function drawRoomLabel(
  ctx: CanvasRenderingContext2D,
  room: Room,
  sx: Sx,
  sy: Sy,
  zoom: number,
): void {
  if (room.area < 0.8) return;
  const cx = sx(room.centroid.x);
  const cy = sy(room.centroid.y);

  /*
   * --- Der Stempel muss in den Raum passen ---------------------------------
   *
   * Bis 1.26.0 stand er in voller Größe in jedem Raum, egal wie klein der
   * war. Im Bad las man dann „Kinderzimmer 1" quer über die Wand hinweg in
   * den Flur hinein, und zwei Stempel benachbarter Räume überlagerten sich
   * zu einem unleserlichen Wort. Auf einem Ausdruck fällt so etwas nicht
   * auf — dort sorgt `beschriftungsLage` für Ordnung —, am Bildschirm
   * schaut man dagegen die ganze Zeit darauf.
   *
   * Drei Stufen, je nachdem, wie viel Platz da ist:
   *   • voller Stempel — Name, Fläche, Volumen und Höhe
   *   • nur Name und Fläche
   *   • nur der Name
   * Und passt nicht einmal der, wird er gekürzt statt über die Wand
   * geschrieben. Ein abgeschnittener Name mit Auslassungszeichen sagt
   * „hier steht mehr"; ein überstehender sagt gar nichts und verdeckt
   * obendrein den Nachbarn.
   *
   * Gemessen wird gegen die **lichte** Breite und Höhe des Raums, nicht
   * gegen seine Fläche: Ein zwei Meter langer, achtzig Zentimeter breiter
   * Flur hat 1,6 m² und trotzdem keinen Platz für eine Zeile.
   */
  const xs = room.innerPolygon.map((p) => sx(p.x));
  const ys = room.innerPolygon.map((p) => sy(p.y));
  const breitePx = xs.length ? Math.max(...xs) - Math.min(...xs) : 0;
  const hoehePx = ys.length ? Math.max(...ys) - Math.min(...ys) : 0;
  // 8 px Luft zu jeder Seite — direkt an der Wand gelesen wirkt eine
  // Beschriftung wie ein Teil davon.
  const platzBreit = Math.max(0, breitePx - 16);

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.font = '500 12px Inter, system-ui, sans-serif';
  const namensBreite = ctx.measureText(room.name).width;
  /** So viele Zeilen trägt der Raum in der Höhe. */
  const zeilen = hoehePx >= 46 ? 3 : hoehePx >= 28 ? 2 : 1;
  const passtName = namensBreite <= platzBreit;
  const flaeche = `${de(room.area, 2)} m²`;
  const passtFlaeche = ctx.measureText(flaeche).width <= platzBreit;

  const voll = zoom >= 34 && zeilen >= 3 && passtName && passtFlaeche;
  const mittel = !voll && zeilen >= 2 && passtName && passtFlaeche;

  ctx.fillStyle = C.text;
  ctx.fillText(
    passtName ? room.name : kuerze(ctx, room.name, platzBreit),
    cx,
    cy - (voll ? 9 : mittel ? 6 : 0),
  );

  if (voll || mittel) {
    ctx.font = '400 11px JetBrains Mono, ui-monospace, monospace';
    ctx.fillStyle = C.textDim;
    ctx.fillText(flaeche, cx, cy + (voll ? 6 : 7));
  }
  if (voll) {
    const dritte = `${de(room.volume, 2)} m³ · h ${de(room.height, 2)} m`;
    ctx.font = '400 9.5px JetBrains Mono, ui-monospace, monospace';
    if (ctx.measureText(dritte).width <= platzBreit) {
      ctx.fillStyle = 'rgba(148,163,184,0.6)';
      ctx.fillText(dritte, cx, cy + 20);
    }
  }
  ctx.restore();
}

/**
 * Einen Text auf eine Breite kürzen, mit Auslassungszeichen.
 *
 * Nicht zeichenweise gemessen, sondern halbierend gesucht: Bei einem
 * Raumnamen sind das vier Messungen statt zwanzig, und `measureText` ist der
 * teuerste Aufruf in dieser Schleife.
 */
function kuerze(ctx: CanvasRenderingContext2D, text: string, breite: number): string {
  if (breite <= 0) return '';
  const punkt = '…';
  if (ctx.measureText(punkt).width > breite) return '';
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mitte = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(text.slice(0, mitte) + punkt).width <= breite) lo = mitte;
    else hi = mitte - 1;
  }
  return lo === text.length ? text : text.slice(0, lo) + punkt;
}

/** Auf welcher Seite der Wand ist "außen"? (Seite, die in keinem Raum liegt) */
function outwardSide(g: WallGeometry, rooms: Room[]): 1 | -1 {
  const probe = 0.25;
  const test = (side: 1 | -1): boolean => {
    const p = {
      x: g.mid.x + g.normal.x * side * (g.halfThickness + probe),
      y: g.mid.y + g.normal.y * side * (g.halfThickness + probe),
    };
    return rooms.some((r) => r.innerPolygon.length >= 3 && pointInPolygon(p, r.innerPolygon));
  };
  if (test(1) && !test(-1)) return -1;
  return 1;
}

/** Maßkette mit Hilfslinien, Schrägstrichen und mittig gesetztem Maßtext. */
function drawDimension(
  ctx: CanvasRenderingContext2D,
  a: Vec2,
  b: Vec2,
  offset: number,
  sx: Sx,
  sy: Sy,
  lineColor: string,
  textColor: string,
): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-4) return;
  const nx = -dy / len;
  const ny = dx / len;

  const p1 = toScreenLocal({ x: a.x + nx * offset, y: a.y + ny * offset }, sx, sy);
  const p2 = toScreenLocal({ x: b.x + nx * offset, y: b.y + ny * offset }, sx, sy);
  const s1 = toScreenLocal(a, sx, sy);
  const s2 = toScreenLocal(b, sx, sy);

  ctx.save();
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 1;

  // Maßhilfslinien
  ctx.globalAlpha = 0.4;
  ctx.beginPath();
  ctx.moveTo(s1.x, s1.y);
  ctx.lineTo(p1.x, p1.y);
  ctx.moveTo(s2.x, s2.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.stroke();

  // Maßlinie
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.stroke();

  // 45°-Schrägstriche statt Pfeile — DIN-konform und optisch ruhiger
  const ang = Math.atan2(p2.y - p1.y, p2.x - p1.x);
  const tick = 4;
  for (const p of [p1, p2]) {
    ctx.beginPath();
    ctx.moveTo(p.x - Math.cos(ang + Math.PI / 4) * tick, p.y - Math.sin(ang + Math.PI / 4) * tick);
    ctx.lineTo(p.x + Math.cos(ang + Math.PI / 4) * tick, p.y + Math.sin(ang + Math.PI / 4) * tick);
    ctx.stroke();
  }

  // Text immer lesbar orientieren (nie auf dem Kopf)
  const mx = (p1.x + p2.x) / 2;
  const my = (p1.y + p2.y) / 2;
  let textAngle = ang;
  if (textAngle > Math.PI / 2 || textAngle < -Math.PI / 2) textAngle += Math.PI;

  ctx.translate(mx, my);
  ctx.rotate(textAngle);
  ctx.font = '500 10.5px JetBrains Mono, ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  const label = de(len, 3);
  const wText = ctx.measureText(label).width;
  ctx.fillStyle = C.bg;
  ctx.fillRect(-wText / 2 - 3, -13, wText + 6, 13);
  ctx.fillStyle = textColor;
  ctx.fillText(label, 0, -2);
  ctx.restore();
}

function drawDraftWall(
  ctx: CanvasRenderingContext2D,
  a: Vec2,
  b: Vec2,
  thickness: number,
  sx: Sx,
  sy: Sy,
): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-5) return;
  const nx = (-dy / len) * (thickness / 2);
  const ny = (dx / len) * (thickness / 2);

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(sx(a.x + nx), sy(a.y + ny));
  ctx.lineTo(sx(b.x + nx), sy(b.y + ny));
  ctx.lineTo(sx(b.x - nx), sy(b.y - ny));
  ctx.lineTo(sx(a.x - nx), sy(a.y - ny));
  ctx.closePath();
  ctx.fillStyle = 'rgba(56,189,248,0.16)';
  ctx.fill();
  ctx.strokeStyle = C.draft;
  ctx.lineWidth = 1.25;
  ctx.stroke();

  // Achslinie
  ctx.beginPath();
  ctx.setLineDash([5, 4]);
  ctx.moveTo(sx(a.x), sy(a.y));
  ctx.lineTo(sx(b.x), sy(b.y));
  ctx.strokeStyle = 'rgba(56,189,248,0.5)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

/** Kompaktes Cursor-HUD mit Länge und Winkel — direkt am Zeiger. */
function drawCursorHud(
  ctx: CanvasRenderingContext2D,
  ptr: PointerInfo,
  start: Vec2,
  w: number,
  h: number,
): void {
  const len = distance(start, ptr.snap.point);
  const ang = (Math.atan2(ptr.snap.point.y - start.y, ptr.snap.point.x - start.x) * TO_DEG + 360) % 360;
  const lines = [`${de(len, 3)} m`, `${de(ang, 1)}°`];

  ctx.save();
  ctx.font = '500 11px JetBrains Mono, ui-monospace, monospace';
  const width = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 16;
  const height = 36;
  let x = ptr.screen.x + 18;
  let y = ptr.screen.y + 18;
  if (x + width > w) x = ptr.screen.x - width - 18;
  if (y + height > h) y = ptr.screen.y - height - 18;

  ctx.fillStyle = 'rgba(11,17,32,0.92)';
  ctx.strokeStyle = 'rgba(56,189,248,0.35)';
  ctx.lineWidth = 1;
  roundRect(ctx, x, y, width, height, 6);
  ctx.fill();
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = C.draft;
  ctx.fillText(lines[0], x + 8, y + 12);
  ctx.fillStyle = C.textDim;
  ctx.fillText(lines[1], x + 8, y + 25);
  ctx.restore();
}

/**
 * Auto-Trace-Ebene: KI-Vorschläge als gestrichelte Magenta-Vektoren über dem
 * Referenzbild. Bewusst in einer klar "fremden" Farbe — sie darf nie mit
 * echter, editierbarer CAD-Geometrie verwechselbar sein.
 */
function drawTraceLayer(
  ctx: CanvasRenderingContext2D,
  trace: TraceState,
  sx: Sx,
  sy: Sy,
  zoom: number,
  selectedId: string | null,
): void {
  ctx.save();
  ctx.lineCap = 'round';

  for (const cand of trace.walls) {
    if (cand.rejected || cand.confidence < trace.minConfidence) continue;
    const selected = cand.id === selectedId;
    const a = toScreenLocal(cand.start, sx, sy);
    const b = toScreenLocal(cand.end, sx, sy);

    // Wandstärke als transparentes Band — man sieht sofort, was übernommen wird.
    ctx.save();
    ctx.globalAlpha = selected ? 0.32 : 0.16;
    ctx.strokeStyle = C.trace;
    ctx.lineWidth = Math.max(2, cand.thickness * zoom);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.restore();

    // Achse gestrichelt
    ctx.setLineDash(selected ? [3, 3] : [8, 5]);
    ctx.strokeStyle = selected ? C.traceSel : C.trace;
    ctx.lineWidth = selected ? 2.25 : 1.5;
    // Niedrige Konfidenz wird transparenter dargestellt — visuelle Priorisierung.
    ctx.globalAlpha = 0.45 + 0.55 * cand.confidence;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    if (selected || zoom > 45) {
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      ctx.font = '500 9.5px JetBrains Mono, ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const label = `${Math.round(cand.confidence * 100)}%`;
      const w = ctx.measureText(label).width + 8;
      ctx.fillStyle = 'rgba(11,17,32,0.85)';
      roundRect(ctx, mx - w / 2, my - 7, w, 14, 4);
      ctx.fill();
      ctx.fillStyle = selected ? C.traceSel : C.trace;
      ctx.fillText(label, mx, my);
    }
  }

  for (const cand of trace.openings) {
    if (cand.rejected || cand.confidence < trace.minConfidence) continue;
    const selected = cand.id === selectedId;
    const p = toScreenLocal(cand.center, sx, sy);
    const r = Math.max(5, (cand.width / 2) * zoom);
    ctx.beginPath();
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = selected ? C.traceSel : C.trace;
    ctx.lineWidth = selected ? 2 : 1.3;
    ctx.globalAlpha = 0.45 + 0.55 * cand.confidence;
    if (cand.kind === 'door') {
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    } else {
      ctx.rect(p.x - r, p.y - 5, r * 2, 10);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}

/** Der Fangpunkt zeigt durch seine Form, *warum* er gefangen hat. */
/** Warnfarbe der Diagnose — dieselbe wie beim offenen Wandende. */
const C_GAP = { line: 'rgba(251,146,60,0.95)', area: 'rgba(251,146,60,0.13)', hint: 'rgba(251,146,60,0.4)' };

/**
 * Zahl in deutscher Schreibweise — im Plan steht kein Dezimalpunkt.
 *
 * **Warum das mehr ist als Kosmetik.** Bis 1.26.0 benutzte nur die
 * Lückenmarkierung diesen Helfer; Maßketten, Raumstempel und Statuszeile
 * schrieben „6.000". Für einen deutschen Leser ist das sechstausend,
 * gemeint sind sechs Meter. Auf einem Blatt, das auf die Baustelle geht,
 * steht damit neben der Wand eine Zahl, die um den Faktor tausend falsch
 * gelesen werden kann — und der Druckpfad schrieb daneben längst mit Komma.
 * Zwei Schreibweisen für dasselbe Maß sind der zusätzliche Ärger.
 */
const de = (n: number, digits: number): string => n.toFixed(digits).replace('.', ',');

/**
 * Die fehlende Wand als das zeichnen, was sie ist: eine Strecke, die es nicht
 * gibt.
 *
 * Deshalb gestrichelt zwischen genau den beiden Wandenden, zwischen denen sie
 * fehlt — und nicht als Punkt auf der Mitte, der die Richtung verschweigt.
 * Dazu die Fläche dahinter flach hinterlegt: erst sie beantwortet die zweite
 * Hälfte der Frage, nämlich welcher Raum dem Anwender dadurch fehlt.
 */
function drawGapMarker(ctx: CanvasRenderingContext2D, issue: ClosureIssue, sx: Sx, sy: Sy): void {
  const outline = issue.enclosedOutline;
  const ends = issue.ends;
  ctx.save();

  if (outline && outline.length >= 3) {
    ctx.beginPath();
    ctx.moveTo(sx(outline[0].x), sy(outline[0].y));
    for (let i = 1; i < outline.length; i++) ctx.lineTo(sx(outline[i].x), sy(outline[i].y));
    ctx.closePath();
    ctx.fillStyle = C_GAP.area;
    ctx.fill();
    ctx.setLineDash([2, 3]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = C_GAP.hint;
    ctx.stroke();
  }

  if (!ends) {
    ctx.restore();
    return;
  }
  const a = toScreenLocal(ends[0], sx, sy);
  const b = toScreenLocal(ends[1], sx, sy);

  ctx.setLineDash([7, 5]);
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'butt';
  ctx.strokeStyle = C_GAP.line;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();

  // Die beiden Wandenden ausdrücklich benennen: dort hört das Vorhandene auf.
  ctx.setLineDash([]);
  ctx.lineWidth = 1.5;
  for (const q of [a, b]) {
    ctx.beginPath();
    ctx.arc(q.x, q.y, 4, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Beschriftung senkrecht neben der Lücke, damit sie die Strecke nicht
  // verdeckt — und mit Hinterlegung, weil sie sonst auf der Wandfüllung
  // untergeht.
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const nx = -(b.y - a.y) / len;
  const ny = (b.x - a.x) / len;
  const zeilen = [
    `Wand fehlt · ${de(issue.measure, 2)} m`,
    issue.enclosedArea !== undefined ? `${de(issue.enclosedArea, 1)} m² zählen nicht als Raum` : '',
  ].filter((z) => z !== '');

  ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const breite = Math.max(...zeilen.map((z) => ctx.measureText(z).width)) + 10;
  const hoehe = zeilen.length * 12 + 6;
  const cx = (a.x + b.x) / 2 + nx * (hoehe / 2 + 8);
  const cy = (a.y + b.y) / 2 + ny * (hoehe / 2 + 8);
  ctx.fillStyle = 'rgba(11,17,32,0.88)';
  ctx.fillRect(cx - breite / 2, cy - hoehe / 2, breite, hoehe);
  ctx.strokeStyle = C_GAP.hint;
  ctx.lineWidth = 1;
  ctx.strokeRect(cx - breite / 2, cy - hoehe / 2, breite, hoehe);
  ctx.fillStyle = C_GAP.line;
  for (let i = 0; i < zeilen.length; i++) {
    ctx.fillText(zeilen[i], cx, cy - hoehe / 2 + 9 + i * 12);
  }
  ctx.restore();
}

/**
 * Die leiseren Befunde — verschweißte Fuge, Ende neben der Achse, doppelt
 * liegende Wand.
 *
 * Sie kosten keinen Raum, bleiben aber im Modell stehen und gehen in Aufmaß
 * und Export ein. Eine kleine Raute reicht, um die Stelle wiederzufinden; der
 * Satz dazu steht im Prüfbericht. Größer wäre Lärm — und Lärm bringt den
 * Anwender dazu, auch die berechtigten Meldungen wegzuklicken.
 */
function drawMinorClosureMarker(ctx: CanvasRenderingContext2D, issue: ClosureIssue, sx: Sx, sy: Sy): void {
  const p = toScreenLocal(issue.position, sx, sy);
  ctx.save();
  ctx.strokeStyle = C_GAP.hint;
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  ctx.moveTo(p.x, p.y - 5);
  ctx.lineTo(p.x + 5, p.y);
  ctx.lineTo(p.x, p.y + 5);
  ctx.lineTo(p.x - 5, p.y);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

/**
 * Der Fangmarker — und seit 1.20.0 sagt er auch, **was** er gefangen hat.
 *
 * Vorher waren alle Arten türkis und unterschieden sich nur in der Form;
 * „Raster" und „frei" sahen sogar identisch aus, obwohl das eine gefangen ist
 * und das andere nicht. Wer mit dem Stift auf eine Ecke zielt, muss vor dem
 * Aufsetzen sehen, ob er sie hat — nachher ist der Punkt gesetzt.
 */
function drawSnapMarker(
  ctx: CanvasRenderingContext2D,
  p: Vec2,
  kind: SnapResult['kind'],
  beschriftung?: string,
): void {
  ctx.save();
  ctx.strokeStyle = C.snap;
  ctx.lineWidth = 1.5;
  switch (kind) {
    case 'node':
      ctx.strokeRect(p.x - 5, p.y - 5, 10, 10);
      break;
    case 'point':
      // Gefülltes Dreieck: deutlich anders als Quadrat (Knoten) und Raute
      // (Wandachse), damit man die drei nicht verwechselt.
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - 6.5);
      ctx.lineTo(p.x + 6, p.y + 4.5);
      ctx.lineTo(p.x - 6, p.y + 4.5);
      ctx.closePath();
      ctx.fillStyle = C.snap;
      ctx.globalAlpha = 0.25;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.stroke();
      break;
    case 'wall':
      ctx.beginPath();
      ctx.moveTo(p.x - 6, p.y);
      ctx.lineTo(p.x, p.y - 6);
      ctx.lineTo(p.x + 6, p.y);
      ctx.lineTo(p.x, p.y + 6);
      ctx.closePath();
      ctx.stroke();
      break;
    case 'angle':
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
      ctx.stroke();
      break;
    default:
      ctx.beginPath();
      ctx.moveTo(p.x - 5, p.y);
      ctx.lineTo(p.x + 5, p.y);
      ctx.moveTo(p.x, p.y - 5);
      ctx.lineTo(p.x, p.y + 5);
      ctx.globalAlpha = 0.7;
      ctx.stroke();
  }
  // Der Klartext daneben. Nur wo es etwas zu sagen gibt: bei „frei" stünde
  // dort „frei", und das ist keine Auskunft, sondern Lärm.
  if (beschriftung) {
    ctx.font = '10px ui-monospace, monospace';
    ctx.fillStyle = C.snap;
    ctx.textAlign = 'left';
    ctx.globalAlpha = 0.9;
    ctx.fillText(beschriftung, p.x + 10, p.y - 8);
  }
  ctx.restore();
}

/** Ist die Gewerke-Ebene des Objekts eingeblendet? */
function isFixtureLayerVisible(doc: { layers: Record<string, { visible: boolean }> }, f: Fixture): boolean {
  const id =
    f.category === 'heating' ? 'layer-heating' : f.category === 'sanitary' ? 'layer-sanitary' : 'layer-ventilation';
  return doc.layers[id]?.visible !== false;
}

/** Baut aus einer Vorlage eine konkrete (noch nicht gespeicherte) Öffnung. */
function openingFromPreset(
  preset: { kind: Opening['kind']; width: number; height: number; sillHeight: number; windowType?: Opening['windowType']; doorType?: Opening['doorType']; passageType?: Opening['passageType']; panels?: number; uValue?: number; gValue?: number },
  wallId: string,
  distanceAlong: number,
): Opening {
  return {
    id: '__preview',
    wallId,
    kind: preset.kind,
    distance: distanceAlong,
    width: preset.width,
    height: preset.height,
    sillHeight: preset.sillHeight,
    windowType: preset.windowType,
    doorType: preset.doorType,
    passageType: preset.passageType,
    panels: preset.panels,
    uValue: preset.uValue,
    gValue: preset.gValue,
    hinge: 'left',
  };
}

/**
 * Vorschau-Objekt für das TGA-Werkzeug: zeigt schon vor dem Klick, wo das
 * Symbol landet und wie es sich an der nächsten Wand ausrichtet.
 */
function previewFixture(
  def: { category: Fixture['category']; length: number; depth: number; elevation: number; wallMounted: boolean; params: Fixture['params']; label: string },
  type: Fixture['type'],
  world: Vec2,
  walls: Wall[],
  nodes: Record<string, BimNode>,
): Fixture {
  let position = world;
  let rotation = 0;

  if (def.wallMounted) {
    const hit = pickWallForOpening(world, walls, nodes, 1.0);
    if (hit) {
      const base = {
        x: hit.geom.a.x + hit.geom.dir.x * hit.distanceAlong,
        y: hit.geom.a.y + hit.geom.dir.y * hit.distanceAlong,
      };
      const side =
        (world.x - base.x) * hit.geom.normal.x + (world.y - base.y) * hit.geom.normal.y >= 0 ? 1 : -1;
      const offset = hit.wall.thickness / 2 + def.depth / 2;
      position = {
        x: base.x + hit.geom.normal.x * offset * side,
        y: base.y + hit.geom.normal.y * offset * side,
      };
      rotation = (Math.atan2(hit.geom.dir.y, hit.geom.dir.x) * 180) / Math.PI;
    }
  }

  return {
    id: '__preview',
    type,
    category: def.category,
    levelId: 'preview',
    position,
    rotation,
    length: def.length,
    depth: def.depth,
    elevation: def.elevation,
    label: def.label,
    params: def.params,
  };
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Dachlinien im Grundriss.
 *
 * Gezeichnet werden First (Strichpunkt), Traufe und die Höhenlinien bei
 * 1,00 m und 2,00 m. Alle Linien werden an den Raumpolygonen geklippt —
 * eine Höhenlinie, die durch die Außenwand hinaus ins Freie läuft, wäre
 * keine Information, sondern Dekoration.
 */
function drawRoofLines(
  ctx: CanvasRenderingContext2D,
  frame: RoofFrame,
  rooms: Room[],
  sx: (x: number) => number,
  sy: (y: number) => number,
  px: (m: number) => number,
): void {
  const polygons = rooms.map((r) => r.innerPolygon).filter((p) => p.length >= 3);
  if (!polygons.length) return;

  ctx.save();
  ctx.lineCap = 'butt';

  const drawClipped = (
    line: { a: Vec2; b: Vec2 },
    stroke: string,
    width: number,
    dash: number[],
    label?: string,
  ) => {
    for (const poly of polygons) {
      for (const seg of clipSegmentToPolygon(line.a, line.b, poly)) {
        if (px(distance(seg.a, seg.b)) < 8) continue;
        ctx.beginPath();
        ctx.setLineDash(dash);
        ctx.strokeStyle = stroke;
        ctx.lineWidth = width;
        ctx.moveTo(sx(seg.a.x), sy(seg.a.y));
        ctx.lineTo(sx(seg.b.x), sy(seg.b.y));
        ctx.stroke();

        if (label && px(distance(seg.a, seg.b)) > 46) {
          const mx = (seg.a.x + seg.b.x) / 2;
          const my = (seg.a.y + seg.b.y) / 2;
          let angle = Math.atan2(sy(seg.b.y) - sy(seg.a.y), sx(seg.b.x) - sx(seg.a.x));
          if (angle > Math.PI / 2 || angle < -Math.PI / 2) angle += Math.PI;
          ctx.save();
          ctx.setLineDash([]);
          ctx.translate(sx(mx), sy(my));
          ctx.rotate(angle);
          ctx.font = '9px ui-monospace, monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          const w = ctx.measureText(label).width;
          ctx.fillStyle = 'rgba(11,17,32,0.82)';
          ctx.fillRect(-w / 2 - 3, -12, w + 6, 11);
          ctx.fillStyle = stroke;
          ctx.fillText(label, 0, -2.5);
          ctx.restore();
        }
      }
    }
  };

  // Höhenlinien nach WoFlV zuerst, damit der First darüber liegt.
  for (const line of roofContourLines(frame, 1)) {
    drawClipped(line, 'rgba(251,146,60,0.55)', 1, [5, 4], '1,00 m');
  }
  for (const line of roofContourLines(frame, 2)) {
    drawClipped(line, 'rgba(56,189,248,0.5)', 1, [5, 4], '2,00 m');
  }

  drawClipped(ridgeLine(frame), 'rgba(226,232,240,0.55)', 1.2, [9, 3, 2, 3], `First ${de(frame.ridgeHeight, 2)} m`);

  ctx.setLineDash([]);
  ctx.restore();
}

/**
 * Schneidet eine Strecke am Polygon: liefert die Teilstücke, die *innerhalb*
 * liegen. Umgesetzt über die sortierten Schnittparameter — bei konkaven
 * Räumen entstehen dabei korrekt mehrere Stücke.
 */
function clipSegmentToPolygon(a: Vec2, b: Vec2, poly: readonly Vec2[]): { a: Vec2; b: Vec2 }[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const ts: number[] = [0, 1];

  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const ex = q.x - p.x;
    const ey = q.y - p.y;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((p.x - a.x) * ey - (p.y - a.y) * ex) / den;
    const u = ((p.x - a.x) * dy - (p.y - a.y) * dx) / den;
    if (t > 0 && t < 1 && u >= 0 && u <= 1) ts.push(t);
  }

  ts.sort((x, y) => x - y);
  const out: { a: Vec2; b: Vec2 }[] = [];
  for (let i = 0; i < ts.length - 1; i++) {
    const t0 = ts[i];
    const t1 = ts[i + 1];
    if (t1 - t0 < 1e-6) continue;
    const mid = (t0 + t1) / 2;
    const mp = { x: a.x + dx * mid, y: a.y + dy * mid };
    if (!pointInPolygon(mp, poly)) continue;
    out.push({
      a: { x: a.x + dx * t0, y: a.y + dy * t0 },
      b: { x: a.x + dx * t1, y: a.y + dy * t1 },
    });
  }
  return out;
}

/** Nächstes TGA-Objekt im Radius — Anschlusspunkt für eine Leitung. */
function nearestFixture(p: Vec2, list: Fixture[], radius: number): Fixture | null {
  let best: Fixture | null = null;
  let bestDist = radius;
  for (const f of list) {
    const d = distance(f.position, p);
    if (d < bestDist) {
      bestDist = d;
      best = f;
    }
  }
  return best;
}


// ---------------------------------------------------------------------------
// Auswahlleiste für Raumvorlagen
// ---------------------------------------------------------------------------

/**
 * Die Leiste über dem Plan, solange das Vorlagen-Werkzeug aktiv ist.
 *
 * Sie sitzt bewusst *im Plan* und nicht im rechten Inspektor: die Form wählt
 * man unmittelbar bevor man zieht, und der Weg quer über den Bildschirm zu
 * einem Reiter und zurück ist genau der Weg, den dieses Werkzeug einsparen
 * soll. Der Preis dafür sind ein paar Pixel Plan — die sind es wert.
 */
function RoomTemplateBar() {
  const kind = useBimStore((s) => s.roomTemplate);
  const options = useBimStore((s) => s.roomTemplateOptions);
  const setKind = useBimStore((s) => s.setRoomTemplate);
  const setOptions = useBimStore((s) => s.setRoomTemplateOptions);
  const addTemplate = useBimStore((s) => s.addRoomTemplate);
  const centre = useBimStore((s) => s.viewport.center);
  const template = ROOM_TEMPLATE_BY_KIND[kind];

  return (
    <div className="panel absolute left-1/2 top-3 z-20 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 flex-col gap-2 px-3 py-2">
      <div className="flex flex-wrap items-center gap-1">
        <span className="label-xs mr-1 shrink-0">Form</span>
        {ROOM_TEMPLATES.map((t) => (
          <button
            key={t.kind}
            className={`chip whitespace-nowrap ${
              t.kind === kind ? 'bg-accent/15 text-accent' : 'bg-white/[0.05] text-slate-300 hover:bg-white/[0.1]'
            }`}
            title={t.hint}
            onClick={() => setKind(t.kind)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {template.adjustable && (
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
          {kind === 'rund' ? (
            <label className="flex items-center gap-2">
              <span className="label-xs">Segmente</span>
              <input
                type="range"
                min={6}
                max={32}
                step={1}
                value={options.segments}
                onChange={(e) => setOptions({ segments: Number(e.target.value) })}
                className="w-28"
              />
              <span className="w-6 text-right font-mono">{options.segments}</span>
            </label>
          ) : (
            <>
              <label className="flex items-center gap-2">
                <span className="label-xs">Aussparung quer</span>
                <input
                  type="range"
                  min={10}
                  max={85}
                  step={5}
                  value={Math.round(options.notchX * 100)}
                  onChange={(e) => setOptions({ notchX: Number(e.target.value) / 100 })}
                  className="w-24"
                />
                <span className="w-8 text-right font-mono">{Math.round(options.notchX * 100)} %</span>
              </label>
              <label className="flex items-center gap-2">
                <span className="label-xs">längs</span>
                <input
                  type="range"
                  min={10}
                  max={85}
                  step={5}
                  value={Math.round(options.notchY * 100)}
                  onChange={(e) => setOptions({ notchY: Number(e.target.value) / 100 })}
                  className="w-24"
                />
                <span className="w-8 text-right font-mono">{Math.round(options.notchY * 100)} %</span>
              </label>
              <button
                className="chip whitespace-nowrap bg-white/[0.05] text-slate-300 hover:bg-white/[0.1]"
                title="Dreht die Aussparung um eine Vierteldrehung weiter"
                onClick={() => setOptions({ quarterTurns: (options.quarterTurns + 1) % 4 })}
              >
                Drehen ({options.quarterTurns * 90}°)
              </button>
            </>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1 border-t border-white/[0.06] pt-2">
        <span className="label-xs mr-1 shrink-0" title="Legt den Raum sofort in der angegebenen Größe in die Bildmitte">
          Fertigmaß
        </span>
        {ROOM_SIZE_PRESETS.map((preset) => (
          <button
            key={preset.label}
            className="chip whitespace-nowrap bg-white/[0.05] text-slate-300 hover:bg-white/[0.1]"
            title={`${de(preset.width, 2)} × ${de(preset.depth, 2)} m Achsmaß${preset.note ? ` — ${preset.note}` : ''}`}
            onClick={() =>
              addTemplate(
                kind,
                { x: centre.x - preset.width / 2, y: centre.y - preset.depth / 2 },
                { x: centre.x + preset.width / 2, y: centre.y + preset.depth / 2 },
                { ...options, name: preset.label },
              )
            }
          >
            {preset.label}
          </button>
        ))}
      </div>

      <p className="max-w-[46rem] text-[11px] leading-snug text-slate-500">{template.hint}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Legende am Bildschirm
// ---------------------------------------------------------------------------

/**
 * Was im Plan gerade zu sehen ist, in Worten.
 *
 * Gezeigt wird nur, was im aktiven Geschoss tatsächlich vorkommt — eine
 * vollständige Bibliothekslegende wäre eine Wand aus Symbolen, von denen
 * neun Zehntel im Projekt nicht auftauchen. Dieselbe Regel gilt im Ausdruck.
 *
 * Die Symbole werden mit denselben Zeichenfunktionen gemalt wie im Plan; eine
 * zweite Zeichnung der gleichen Sache wäre eine zweite Wahrheit.
 */
function PlanLegende({ onClose }: { onClose: () => void }) {
  const doc = useBimStore((s) => s.doc);
  const level = doc.activeLevelId;

  const inhalt = useMemo(() => {
    const fixtures = new Map<FixtureType, number>();
    /*
     * Zeichnet in diesem Geschoss überhaupt jemand Anschlusspunkte?
     *
     * Die beiden Punkte unter dem Heizkörper malt `anschlussPunkte` in
     * `fixtureSymbols` nur bei Gliederheizkörper und Röhrenradiator, und auch
     * dort nur, wenn eine **Anschlussart** hinterlegt ist. Die Erklärung dazu
     * erscheint deshalb unter genau derselben Bedingung: eine Legende, die
     * ein Zeichen erklärt, das im Plan nicht vorkommt, lässt einen auf dem
     * Blatt nach etwas suchen, das es nicht gibt.
     */
    let anschlusspunkte = false;
    for (const f of Object.values(doc.fixtures)) {
      if (f.levelId !== level) continue;
      fixtures.set(f.type, (fixtures.get(f.type) ?? 0) + 1);
      /*
       * **Auch die Ventilseite allein lässt die Punkte erscheinen.**
       *
       * `anschlussPunkte` zeichnet seit 1.23.0 schon dann, wenn nur die
       * Ventilseite erfasst ist — das ist der Regelfall im Bestand: Man
       * sieht auf der Baustelle, wo das Ventil sitzt, die Anschlussart
       * ergibt sich erst beim Ausbau. Fragte die Legende weiterhin nur nach
       * der Anschlussart, stünden in diesem Fall zwei Kreise im Plan, die
       * niemand erklärt.
       */
      if (
        (f.type === 'radiator' || f.type === 'radiator-tube') &&
        (f.params.radiatorConnection || f.params.valveSide)
      ) {
        anschlusspunkte = true;
      }
    }
    const services = new Map<PipeService, number>();
    for (const p of Object.values(doc.pipes ?? {})) {
      if (p.levelId !== level) continue;
      services.set(p.service, (services.get(p.service) ?? 0) + 1);
    }
    const verticals = new Map<string, number>();
    for (const v of Object.values(doc.verticals ?? {})) {
      if (v.levelId !== level) continue;
      verticals.set(v.kind, (verticals.get(v.kind) ?? 0) + 1);
    }
    // Massive Bauteile werden auch dort gezählt, wo sie nur hindurchlaufen:
    // im Obergeschoss steht der Schornstein genauso im Raum.
    const massiv = new Map<string, number>();
    const rang = new Map(Object.values(doc.levels).sort((a, b) => a.order - b.order).map((l, i) => [l.id, i]));
    for (const b of Object.values(doc.solids ?? {})) {
      const von = rang.get(b.levelId);
      const hier = rang.get(level);
      const sichtbar = b.levelId === level || (b.throughAllLevels && von !== undefined && hier !== undefined && hier > von);
      if (!sichtbar) continue;
      massiv.set(b.kind, (massiv.get(b.kind) ?? 0) + 1);
    }
    // Durchbrüche nach Maß und nicht nach Art: „3 × Ø 152" sagt auf einer
    // Legende mehr als „3 × Kernbohrung".
    const durchbrueche = new Map<string, number>();
    for (const e of durchbruecheAufGeschoss(doc, level)) {
      if (e.vonUnten) continue;
      const d = e.durchbruch;
      const mass =
        d.form === 'rund'
          ? `Ø ${Math.round((d.diameter ?? 0) * 1000)}`
          : `${Math.round((d.width ?? 0) * 1000)} × ${Math.round((d.height ?? 0) * 1000)}`;
      const schluessel = `${DURCHBRUCH_LABELS[d.kind]} ${mass}`;
      durchbrueche.set(schluessel, (durchbrueche.get(schluessel) ?? 0) + 1);
    }
    const site = new Map<SiteElementKind, number>();
    for (const e of Object.values(doc.site?.elements ?? {})) {
      site.set(e.kind, (site.get(e.kind) ?? 0) + 1);
    }
    return {
      fixtures,
      anschlusspunkte,
      services,
      verticals,
      massiv,
      durchbrueche,
      site,
      pumps: Object.keys(doc.site?.pumps ?? {}).length,
    };
  }, [doc, level]);

  const leer =
    inhalt.fixtures.size === 0 &&
    inhalt.services.size === 0 &&
    inhalt.verticals.size === 0 &&
    inhalt.massiv.size === 0 &&
    inhalt.durchbrueche.size === 0 &&
    inhalt.site.size === 0 &&
    inhalt.pumps === 0;

  return (
    <div className="panel absolute bottom-4 left-3 max-h-[70%] w-[15.5rem] overflow-y-auto px-2.5 py-2">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="label-xs">Legende</span>
        <button className="text-[10px] text-slate-600 hover:text-slate-300" onClick={onClose}>
          schließen
        </button>
      </div>

      {leer ? (
        <p className="text-[10px] leading-relaxed text-slate-500">
          In diesem Geschoss steht noch nichts, was einer Erklärung bedürfte. Sobald TGA-Symbole, Leitungen, Treppen
          oder Geländeobjekte gesetzt sind, stehen sie hier.
        </p>
      ) : (
        <div className="space-y-2">
          {inhalt.fixtures.size > 0 && (
            <div>
              <div className="label-xs mb-1">Heizung, Sanitär, Lüftung</div>
              {[...inhalt.fixtures.entries()].map(([type, n]) => (
                <div key={type} className="flex items-baseline gap-1.5 py-0.5">
                  <SymbolVorschau type={type} />
                  <span className="min-w-0 flex-1 truncate text-[10px] text-slate-400">
                    {FIXTURE_BY_TYPE[type]?.label ?? type}
                  </span>
                  <span className="shrink-0 text-[10px] tabular-nums text-slate-600">{n}×</span>
                </div>
              ))}
              {inhalt.anschlusspunkte && <Ventilseitenhinweis />}
            </div>
          )}

          {inhalt.services.size > 0 && (
            <div className="border-t border-white/[0.06] pt-1.5">
              <div className="label-xs mb-1">Leitungen</div>
              {[...inhalt.services.entries()].map(([service, n]) => (
                <div key={service} className="flex items-center gap-1.5 py-0.5">
                  <span
                    className="h-0.5 w-5 shrink-0 rounded"
                    style={{ background: PIPE_SERVICE_COLORS[service] }}
                  />
                  <span className="min-w-0 flex-1 truncate text-[10px] text-slate-400">
                    {PIPE_SERVICE_LABELS[service]}
                  </span>
                  <span className="shrink-0 text-[10px] tabular-nums text-slate-600">{n}×</span>
                </div>
              ))}
            </div>
          )}

          {inhalt.verticals.size > 0 && (
            <div className="border-t border-white/[0.06] pt-1.5">
              <div className="label-xs mb-1">Treppen und Schächte</div>
              {[...inhalt.verticals.entries()].map(([kind, n]) => (
                <div key={kind} className="flex items-baseline gap-1.5 py-0.5">
                  <span className="min-w-0 flex-1 truncate text-[10px] text-slate-400">
                    {VERTICAL_LABELS[kind as VerticalKind] ?? kind}
                  </span>
                  <span className="shrink-0 text-[10px] tabular-nums text-slate-600">{n}×</span>
                </div>
              ))}
            </div>
          )}

          {inhalt.massiv.size > 0 && (
            <div className="border-t border-white/[0.06] pt-1.5">
              <div className="label-xs mb-1">Massive Bauteile</div>
              {[...inhalt.massiv.entries()].map(([kind, n]) => (
                <div key={kind} className="flex items-baseline gap-1.5 py-0.5">
                  <span className="min-w-0 flex-1 truncate text-[10px] text-slate-400">
                    {SOLID_LABELS[kind as SolidKind] ?? kind}
                  </span>
                  <span className="shrink-0 text-[10px] tabular-nums text-slate-600">{n}×</span>
                </div>
              ))}
            </div>
          )}

          {inhalt.durchbrueche.size > 0 && (
            <div className="border-t border-white/[0.06] pt-1.5">
              <div className="label-xs mb-1">Durchbrüche</div>
              {[...inhalt.durchbrueche.entries()].map(([bez, n]) => (
                <div key={bez} className="flex items-baseline gap-1.5 py-0.5">
                  <span className="min-w-0 flex-1 truncate text-[10px] text-slate-400">{bez}</span>
                  <span className="shrink-0 text-[10px] tabular-nums text-slate-600">{n}×</span>
                </div>
              ))}
            </div>
          )}

          {(inhalt.site.size > 0 || inhalt.pumps > 0) && (
            <div className="border-t border-white/[0.06] pt-1.5">
              <div className="label-xs mb-1">Außengelände</div>
              {inhalt.pumps > 0 && (
                <div className="flex items-baseline gap-1.5 py-0.5">
                  <span className="min-w-0 flex-1 truncate text-[10px] text-slate-400">Wärmepumpe</span>
                  <span className="shrink-0 text-[10px] tabular-nums text-slate-600">{inhalt.pumps}×</span>
                </div>
              )}
              {[...inhalt.site.entries()].map(([kind, n]) => (
                <div key={kind} className="flex items-baseline gap-1.5 py-0.5">
                  <span className="min-w-0 flex-1 truncate text-[10px] text-slate-400">
                    {SITE_ELEMENT_LABELS[kind]}
                  </span>
                  <span className="shrink-0 text-[10px] tabular-nums text-slate-600">{n}×</span>
                </div>
              ))}
              <p className="mt-1 text-[9.5px] leading-relaxed text-slate-600">
                Der gestrichelte Kreis um die Wärmepumpe ist der Abstand, ab dem der Nachtwert eingehalten ist; der
                durchgezogene der Schutzbereich des Kältemittels.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Die beiden Punkte unter dem Heizkörper, in Worten.
 *
 * **Warum das in die Legende gehört.** Anschlussart und Ventilseite
 * entscheiden, auf welcher Seite die Leitung aus dem Estrich kommen muss.
 * Das Symbol beantwortet die Frage längst — ein gefüllter und ein offener
 * Punkt unter dem Heizkörper —, aber nur für den, der die Zeichenregel
 * kennt. Wer sie nicht kennt, hält die beiden Punkte für Schmuck und legt
 * die Leitung auf die falsche Seite; gemerkt wird das, wenn der Estrich zu
 * ist. Drei Zeilen Legende kosten nichts und verhindern genau das.
 *
 * Der dritte Fall ist der wichtigste: **kein** gefüllter Punkt heißt nicht
 * „mittig" oder „egal", sondern „nicht erfasst". Eine erfundene Seite wäre
 * schlimmer als keine — deshalb zeichnet `anschlussPunkte` in diesem Fall
 * beide Punkte offen, und deshalb steht das hier ausdrücklich dabei.
 *
 * Die Blickrichtung steht dazu, weil „links" ohne sie mehrdeutig ist: von
 * vorn auf den Heizkörper gesehen — so, wie man im Raum davorsteht, und so,
 * wie der Grundriss ihn bei 0° Drehung zeigt.
 */
function Ventilseitenhinweis() {
  return (
    <div className="mt-1 border-t border-white/[0.06] pt-1">
      <div className="label-xs mb-1">Anschlusspunkte am Heizkörper</div>
      <div className="flex items-center gap-1.5 py-0.5">
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ background: '#F87171' }}
        />
        <span className="min-w-0 flex-1 text-[10px] text-slate-400">Gefüllt: Ventilseite (Vorlauf)</span>
      </div>
      <div className="flex items-center gap-1.5 py-0.5">
        <span
          className="h-2 w-2 shrink-0 rounded-full border"
          style={{ borderColor: '#F87171' }}
        />
        <span className="min-w-0 flex-1 text-[10px] text-slate-400">Offen: Rücklauf</span>
      </div>
      <p className="mt-1 text-[9.5px] leading-relaxed text-slate-600">
        Sind beide Punkte offen, ist die Ventilseite nicht erfasst — sie ist dann auf der Baustelle festzulegen, nicht
        aus dem Plan abzulesen. Blickrichtung: von vorn auf den Heizkörper.
      </p>
    </div>
  );
}

/**
 * Ein TGA-Symbol als kleine Vorschau — gezeichnet mit derselben Funktion wie
 * im Plan, damit Legende und Zeichnung nicht auseinanderlaufen können.
 */
function SymbolVorschau({ type }: { type: FixtureType }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const size = 18;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    const def = FIXTURE_BY_TYPE[type];
    if (!def) return;
    // Der Maßstab wird so gewählt, dass das größte Symbolmaß gerade in das
    // Kästchen passt — sonst ragt eine Badewanne heraus und ein Fühler ist
    // ein Punkt.
    const span = Math.max(def.length, def.depth, 0.2);
    const scale = (size - 4) / span;
    ctx.translate(size / 2, size / 2);
    drawFixture(
      ctx,
      {
        id: 'legende',
        levelId: '',
        type,
        category: def.category,
        position: { x: 0, y: 0 },
        rotation: 0,
        length: def.length,
        depth: def.depth,
        elevation: def.elevation,
        params: { ...def.params },
      },
      (x: number) => x * scale,
      (y: number) => -y * scale,
      scale,
      { selected: false, hovered: false },
    );
  }, [type]);

  return <canvas ref={ref} style={{ width: 18, height: 18 }} className="shrink-0" />;
}

/**
 * Die Kompassrose auf die Leinwand — an einer festen Stelle am Bildschirm.
 *
 * `(cx|cy)` ist die Mitte in Bildpunkten, `r` der Radius. Die Formteile
 * kommen aus `kompassRose` in Einheitskoordinaten mit y nach oben; hier wird
 * y gespiegelt, weil die Leinwand nach unten zählt.
 */
function zeichneKompass(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  northAngle: number,
): void {
  const P = (p: Vec2) => ({ x: cx + p.x * r, y: cy - p.y * r });
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(148,163,184,0.55)';
  ctx.fillStyle = 'rgba(148,163,184,0.75)';

  for (const teil of kompassRose(northAngle)) {
    if (teil.kind === 'kreis') {
      const c = P(teil.zentrum);
      ctx.beginPath();
      ctx.arc(c.x, c.y, teil.radius * r, 0, Math.PI * 2);
      // Ein schwacher Grund, damit die Rose auch über dem Referenzbild lesbar
      // bleibt — ohne ihn verschwindet sie auf einem hellen Scan.
      ctx.fillStyle = 'rgba(15,23,42,0.55)';
      ctx.fill();
      ctx.fillStyle = 'rgba(148,163,184,0.75)';
      ctx.stroke();
    } else if (teil.kind === 'linie') {
      const a = P(teil.a);
      const b = P(teil.b);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    } else if (teil.kind === 'flaeche') {
      ctx.beginPath();
      teil.punkte.forEach((q, i) => {
        const s2 = P(q);
        if (i === 0) ctx.moveTo(s2.x, s2.y);
        else ctx.lineTo(s2.x, s2.y);
      });
      ctx.closePath();
      ctx.fill();
    } else {
      const s2 = P(teil.punkt);
      ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(203,213,225,0.9)';
      ctx.fillText(teil.text, s2.x, s2.y);
    }
  }
  ctx.restore();
}
