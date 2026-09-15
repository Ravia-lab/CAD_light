/**
 * Automatische Raumerkennung über planare Facetten-Traversierung.
 * ---------------------------------------------------------------------------
 * Warum kein Flood-Fill auf Pixeln? Ein rasterbasierter Fill ist auflösungs-
 * abhängig, liefert gezackte Polygone und skaliert schlecht beim Zoomen.
 * Wir arbeiten stattdessen exakt auf dem *planaren Graphen* der Wandachsen:
 *
 *   1. Alle Wandachsen an ihren echten Schnittpunkten aufteilen (Planarisierung)
 *   2. Halbkanten-Struktur aufbauen, ausgehende Kanten je Knoten nach Winkel sortieren
 *   3. Facetten traversieren: "beim Ankommen immer scharf rechts abbiegen"
 *      → jede beschränkte Facette wird genau einmal CCW umlaufen
 *   4. Die unbeschränkte Außenfacette (negative Fläche) verwerfen
 *   5. Achspolygon je Kante um die halbe Wandstärke nach innen versetzen
 *      → lichte Raummaße bei gemischten Wandstärken
 *   6. Identität vergeben: jeder Vorgängerraum darf höchstens einmal geerbt
 *      werden (`matchPrevious`) — sonst tragen zwei Räume dieselbe Kennung
 *      und das Dokument, das Räume nach Kennung ablegt, behält nur einen
 *
 * Komplexität: O((n + k) log n) bei n Wänden und k Schnittpunkten.
 * Bei typischen Grundrissen (< 300 Wände) läuft das in deutlich unter 1 ms.
 *
 * Der zweite Auftrag dieses Moduls ist die Gegenprobe: `diagnoseClosure`
 * beantwortet die Frage, die sich stellt, wenn eine offensichtlich
 * umschlossene Fläche *nicht* als Raum erscheint. Ohne diese Antwort sieht der
 * Anwender nur, dass nichts da ist — und sucht den Fehler an der falschen
 * Stelle. Siehe den Abschnitt „Diagnose" am Dateiende.
 */

import type {
  BimNode,
  BoundaryCondition,
  Construction,
  ClosureIssue,
  ClosureIssueKind,
  Opening,
  RoofDefinition,
  RoofOpening,
  SolidElement,
  VerticalElement,
  Room,
  RoomBoundary,
  RoomUsage,
  Vec2,
  VentilationRole,
  Wall,
} from '../types/bim';
import {
  EPS,
  azimuthFromNormal,
  distance,
  distanceToSegment,
  normalize,
  offsetPolygonPerEdge,
  orientationFromAzimuth,
  polygonArea,
  polygonCentroid,
  polygonPerimeter,
  pointInPolygon,
  segmentIntersection,
  signedArea,
  simplifyPolygon,
  sub,
} from './geometry';
import { solidFootprint } from './verticalSymbols';
import { uWertWand } from './uwert';
import { buildRoofFrame, measureRoomUnderRoof, wallProfileUnderRoof } from './roofGeometry';
import type { RoofFrame } from './roofGeometry';

// ===========================================================================
// Geländeoberkante — welcher Teil eines Bauteils im Erdreich steckt
// ===========================================================================

/**
 * Aufteilung eines senkrechten Bauteils an der Geländeoberkante.
 *
 * Warum das hier steht und nicht im Export: die Frage „was liegt hinter
 * diesem Bauteil" wird in diesem Modul beantwortet (`resolveAdjacency`
 * entscheidet zwischen exterior, adjacent-room und unheated). Die Frage
 * „welcher Teil davon liegt im Erdreich" ist dieselbe Frage, nur in der
 * Senkrechten. Sie an einer zweiten Stelle zu beantworten hieße, zwei
 * Wahrheiten über dieselbe Wand zu führen — Export, Überschlagsrechnung und
 * Modellprüfung greifen deshalb alle auf diese eine Funktion zu.
 *
 * Die Randbedingung am `RoomBoundary` bleibt bewusst unverändert
 * `'exterior'`: sie beschreibt die Wand als Bauteil, und daran hängen
 * Umfang mit Erdkontakt, Hüllfläche und Wärmebrückenlängen. Erst der Export
 * teilt die Fläche in zwei Hüllflächen auf. Damit bleibt jedes Dokument ohne
 * Geländeoberkante Zahl für Zahl das, was es vorher war.
 */
export interface GradeSplit {
  /** Höhe des erdberührten Abschnitts [m]. 0 = die Wand steht ganz frei. */
  buriedHeight: number;
  /** Höhe des freistehenden Abschnitts [m]. 0 = die Wand steckt ganz im Erdreich. */
  exposedHeight: number;
  /**
   * Einbindetiefe z [m] — Tiefe der Bauteilunterkante unter Gelände.
   * 0, solange nichts im Erdreich steckt.
   */
  embedmentDepth: number;
}

/**
 * Teilt ein senkrechtes Bauteil an der Geländeoberkante.
 *
 * `footElevation` ist die Höhe der Unterkante in derselben Bezugshöhe wie
 * `Level.elevation` und `ProjectMeta.terrainElevation`; bei einer Wand also
 * die Fußbodenhöhe ihres Geschosses.
 *
 * Ohne erfasste Geländeoberkante (`terrainElevation === undefined`) steckt
 * nichts im Erdreich. Das ist keine Annahme über das Gebäude, sondern die
 * Weigerung, eine zu treffen: eine geratene Geländehöhe würde eine
 * Kellerwand erfinden, wo keine gezeichnet ist.
 */
export function gradeSplit(
  footElevation: number,
  height: number,
  terrainElevation: number | undefined,
): GradeSplit {
  const total = Math.max(0, height);
  if (terrainElevation === undefined || !Number.isFinite(terrainElevation)) {
    return { buriedHeight: 0, exposedHeight: total, embedmentDepth: 0 };
  }
  const buried = Math.min(total, Math.max(0, terrainElevation - footElevation));
  return {
    buriedHeight: buried,
    exposedHeight: total - buried,
    // Tiefe der Unterkante unter Gelände. Sie ist nur so lange gleich der
    // eingebundenen Höhe, wie die Wand nicht *unterhalb* des Geländes erst
    // beginnt — bei einem zweiten Untergeschoss ist sie größer.
    embedmentDepth: buried > 0 ? terrainElevation - footElevation : 0,
  };
}

/** Räume unter dieser Fläche gelten als Artefakt (z. B. Wandkreuzungs-Zwickel). */
const MIN_ROOM_AREA = 0.4; // m²

/**
 * Ab dieser Höhe ist ein Bauteil eine Wand, darunter eine Brüstung [m].
 *
 * Die Grenze trennt zwei Dinge, die geometrisch gleich aussehen und baulich
 * nichts miteinander zu tun haben: eine Wand schließt einen Raum nach oben
 * ab, eine Brüstung steht darin. 1,60 m liegt zwischen beidem — höher als
 * jedes Geländer und jeder Tresen, niedriger als jede Wand, die man für eine
 * Wand hält.
 */
export const BRUESTUNGS_HOEHE = 1.6; // m

/**
 * Schweiß-Toleranz [m] für die Topologie-Heilung.
 *
 * Der mit Abstand häufigste Grund dafür, dass ein optisch geschlossener
 * Raum *nicht* erkannt wird: zwei Wandenden liegen wenige Millimeter
 * auseinander, oder ein Wandende endet knapp neben statt exakt auf einer
 * anderen Wandachse. Für das Auge geschlossen, topologisch offen.
 *
 * 5 cm ist bewusst großzügig — kleiner als jede sinnvolle Wandstärke, aber
 * groß genug für alles, was beim freien Zeichnen entsteht. Die Zahl bleibt
 * so: nach oben verbietet sie sich, weil im 11,5-cm-Ständerwerk zwei
 * verschiedene Wandachsen 11,5 cm auseinanderliegen — eine Toleranz jenseits
 * der halben Wandstärke zöge sie zusammen. Nach unten bringt sie nichts, weil
 * die Fugen, um die es geht, im Millimeterbereich liegen.
 *
 * Wichtig ist der Preis dieser Großzügigkeit: eine geheilte Fuge ist eine
 * verschwiegene Fuge. Deshalb protokolliert die Heilung, was sie zurechtrückt
 * (`HealNotes`), und `diagnoseClosure` gibt es weiter.
 */
export const WELD_TOLERANCE = 0.05; // m

/** Quantisierung für die Knoten-Identität: 0,5 mm. */
const QUANT = 2000;

const keyOf = (p: Vec2): string =>
  `${Math.round(p.x * QUANT)}|${Math.round(p.y * QUANT)}`;

/** Normwerte nach DIN EN 12831 Beiblatt / VDI 2078 (Innentemperatur, Luftwechsel). */
/**
 * Voreinstellungen je Nutzung. `air` ist die Rolle im Lüftungskonzept:
 * Aufenthaltsräume bekommen Zuluft, Feuchte- und Geruchsräume sind
 * Ablufträume, Flure verbinden beides durch Überströmen. Das ist die
 * Grundordnung jeder Wohnungslüftung und keine Zahl aus einer Norm — die
 * Volumenströme setzt der Planer an den Ventilen selbst.
 */
const USAGE_DEFAULTS: Record<RoomUsage, { temp: number; ach: number; air: VentilationRole }> = {
  living: { temp: 20, ach: 0.5, air: 'supply' },
  bedroom: { temp: 20, ach: 0.5, air: 'supply' },
  kitchen: { temp: 20, ach: 1.5, air: 'exhaust' },
  bath: { temp: 24, ach: 1.5, air: 'exhaust' },
  wc: { temp: 20, ach: 1.5, air: 'exhaust' },
  hallway: { temp: 15, ach: 0.5, air: 'transfer' },
  office: { temp: 20, ach: 0.5, air: 'supply' },
  storage: { temp: 15, ach: 0.5, air: 'transfer' },
  technical: { temp: 15, ach: 0.5, air: 'none' },
  other: { temp: 20, ach: 0.5, air: 'none' },
};

export const usageDefaults = (usage: RoomUsage) => USAGE_DEFAULTS[usage];

// ---------------------------------------------------------------------------
// Interne Graph-Strukturen
// ---------------------------------------------------------------------------

interface GraphVertex {
  index: number;
  point: Vec2;
  /** Indizes der ausgehenden Halbkanten, nach Winkel aufsteigend sortiert. */
  outgoing: number[];
}

interface HalfEdge {
  index: number;
  from: number;
  to: number;
  twin: number;
  angle: number;
  wallId: string;
  visited: boolean;
}

interface PlanarGraph {
  vertices: GraphVertex[];
  halfEdges: HalfEdge[];
}

// ---------------------------------------------------------------------------
// Topologie-Heilung
// ---------------------------------------------------------------------------

interface HealedSegment {
  wall: Wall;
  a: Vec2;
  b: Vec2;
}

/**
 * Mitschrift der Heilung — was sie stillschweigend zurechtgerückt hat.
 *
 * Die Heilung ist bewusst großzügig, und genau deshalb muss sie protokolliert
 * werden: eine Fuge, die die Raumerkennung überbrückt, bleibt im Modell eine
 * Fuge. Sie taucht im Aufmaß auf, in der Wandliste, beim Export — nur eben
 * nicht mehr als Grund dafür, dass ein Raum fehlt. Wer sie nie zu sehen
 * bekommt, räumt sie auch nie weg.
 *
 * Wird `healSegments` ohne Mitschrift aufgerufen (der Regelfall in der
 * Raumerkennung), entsteht kein einziges zusätzliches Objekt.
 */
interface HealNotes {
  /** Zusammengeschweißte Enden: Ort, größter Abstand darin, beteiligte Wände. */
  welds: { position: Vec2; spread: number; wallIds: string[] }[];
  /** Auf eine fremde Achse gezogene Enden. */
  projections: { position: Vec2; offset: number; wallId: string; hostWallId: string }[];
}

/**
 * Bringt fast-zusammenhängende Wandenden auf exakt dieselbe Koordinate.
 *
 *  1. **Clustern** — alle Wandenden innerhalb der Toleranz werden über ein
 *     Gitter-Hashing zu einer gemeinsamen Position verschmolzen. Ein
 *     Raster mit Zellgröße = Toleranz macht das linear statt quadratisch.
 *  2. **Projizieren** — ein Ende, das knapp *neben* einer fremden Wandachse
 *     liegt, wird exakt auf diese Achse gezogen. Erst dadurch wird aus einem
 *     beinahe-T-Stoß ein echter, und der Raum dahinter schließt sich.
 *
 * Die Heilung arbeitet auf einer Kopie — das Dokument bleibt unangetastet.
 * Der Nutzer sieht seine Wände weiterhin genau dort, wo er sie gezeichnet hat.
 */
function healSegments(
  walls: Wall[],
  nodes: Record<string, BimNode>,
  tolerance: number,
  notes?: HealNotes,
): { segments: HealedSegment[]; clusters: Vec2[]; degree: number[] } {
  const raw = walls
    .map((w) => ({ wall: w, a: nodes[w.a], b: nodes[w.b] }))
    .filter((s) => s.a && s.b && distance(s.a, s.b) > EPS);

  const clusters: Vec2[] = [];
  const counts: number[] = [];
  const degree: number[] = [];
  /** Nur mit Mitschrift belegt: die Rohpunkte je Cluster vor dem Verschweißen. */
  const members: { point: Vec2; wallId: string }[][] = [];
  const grid = new Map<string, number[]>();
  const cell = Math.max(tolerance, 1e-3);
  const cellKey = (p: Vec2) => `${Math.floor(p.x / cell)}|${Math.floor(p.y / cell)}`;

  /** Ordnet einen Punkt einem Cluster zu (oder legt einen neuen an). */
  const clusterFor = (p: Vec2, wallId: string): number => {
    const cx = Math.floor(p.x / cell);
    const cy = Math.floor(p.y / cell);
    let best = -1;
    let bestDist = tolerance;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const idx of grid.get(`${cx + dx}|${cy + dy}`) ?? []) {
          const d = distance(clusters[idx], p);
          if (d < bestDist) {
            bestDist = d;
            best = idx;
          }
        }
      }
    }
    if (best >= 0) {
      // Laufender Mittelwert — die geschweißte Ecke landet mittig zwischen
      // den beteiligten Enden statt willkürlich auf dem ersten.
      const n = ++counts[best];
      clusters[best] = {
        x: clusters[best].x + (p.x - clusters[best].x) / n,
        y: clusters[best].y + (p.y - clusters[best].y) / n,
      };
      degree[best]++;
      if (notes) members[best].push({ point: { x: p.x, y: p.y }, wallId });
      return best;
    }
    const idx = clusters.length;
    clusters.push({ x: p.x, y: p.y });
    counts.push(1);
    degree.push(1);
    if (notes) members.push([{ point: { x: p.x, y: p.y }, wallId }]);
    const key = cellKey(p);
    const list = grid.get(key);
    if (list) list.push(idx);
    else grid.set(key, [idx]);
    return idx;
  };

  const assigned = raw.map((s) => ({
    wall: s.wall,
    ia: clusterFor(s.a, s.wall.id),
    ib: clusterFor(s.b, s.wall.id),
  }));

  // Schritt 2: Enden auf nahe fremde Achsen ziehen.
  //
  // Umschließende Rechtecke vorab, sonst wird der Schritt quadratisch mit
  // teurem Kern: ein Ende kann nur auf eine Achse gezogen werden, deren
  // Rechteck es überhaupt streift. Die Rechtecke werden um die doppelte
  // Toleranz aufgeweitet — die Achsenden können sich in dieser Schleife noch
  // um je eine Toleranz verschieben, und ein zu enges Rechteck würde einen
  // gültigen T-Stoß verwerfen.
  const reach = 2 * tolerance;
  const boxes = assigned.map((item) => {
    const a = clusters[item.ia];
    const b = clusters[item.ib];
    return {
      minX: Math.min(a.x, b.x) - reach,
      maxX: Math.max(a.x, b.x) + reach,
      minY: Math.min(a.y, b.y) - reach,
      maxY: Math.max(a.y, b.y) + reach,
    };
  });

  for (const item of assigned) {
    for (const idx of [item.ia, item.ib]) {
      const p = clusters[idx];
      let bestPoint: Vec2 | null = null;
      let bestHost = '';
      let bestDist = tolerance;
      // Sitzt das Ende bereits exakt auf einer fremden Achse, ist der T-Stoß
      // fertig. Ohne diese Feststellung würde es eine zweite Achse, die
      // zufällig innerhalb der Toleranz vorbeiläuft, wieder herunterziehen —
      // im 11,5-cm-Ständerwerk stehen solche Achsen dicht beieinander.
      let seated = false;

      for (let k = 0; k < assigned.length; k++) {
        const other = assigned[k];
        if (other === item) continue;
        const box = boxes[k];
        if (p.x < box.minX || p.x > box.maxX || p.y < box.minY || p.y > box.maxY) continue;
        const a = clusters[other.ia];
        const b = clusters[other.ib];
        const abx = b.x - a.x;
        const aby = b.y - a.y;
        const lenSq = abx * abx + aby * aby;
        if (lenSq < EPS) continue;
        const t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq;
        // Nur echte T-Stöße: an den Enden hat bereits das Clustern gegriffen.
        if (t <= 0.001 || t >= 0.999) continue;
        const px = a.x + abx * t;
        const py = a.y + aby * t;
        const d = Math.hypot(px - p.x, py - p.y);
        if (d <= 1e-9) {
          seated = true;
          break;
        }
        if (d < bestDist) {
          bestDist = d;
          bestPoint = { x: px, y: py };
          bestHost = other.wall.id;
        }
      }
      if (!seated && bestPoint) {
        if (notes) {
          notes.projections.push({
            position: { x: p.x, y: p.y },
            offset: bestDist,
            wallId: item.wall.id,
            hostWallId: bestHost,
          });
        }
        clusters[idx] = bestPoint;
      }
    }
  }

  if (notes) {
    for (let i = 0; i < members.length; i++) {
      const group = members[i];
      if (group.length < 2) continue;
      let spread = 0;
      for (let a = 0; a < group.length; a++) {
        for (let b = a + 1; b < group.length; b++) {
          const d = distance(group[a].point, group[b].point);
          if (d > spread) spread = d;
        }
      }
      // Unter 0,1 mm ist die Fuge keine Fuge, sondern Fließkomma-Rauschen.
      if (spread <= EPS) continue;
      notes.welds.push({
        position: { x: clusters[i].x, y: clusters[i].y },
        spread,
        wallIds: [...new Set(group.map((m) => m.wallId))],
      });
    }
  }

  const segments: HealedSegment[] = assigned
    .map((s) => ({ wall: s.wall, a: clusters[s.ia], b: clusters[s.ib] }))
    .filter((s) => distance(s.a, s.b) > EPS);

  return { segments, clusters, degree };
}

/**
 * Wandenden, an denen keine zweite Wand ansetzt und die auch auf keiner
 * fremden Achse liegen — die typische Ursache für „Raum wird nicht erkannt".
 * Werden im Plan als Warnpunkt eingeblendet.
 *
 * Der Zuschnitt ist eng und bleibt es: gemeldet wird nur, was Grad 1 hat.
 * Genau deshalb ist diese Funktion *nicht* die Antwort auf die Frage, warum
 * eine Fläche kein Raum geworden ist — fehlt zwischen zwei Bauteilen ein
 * ganzes Wandstück, hat dort jedes Ende Grad 2 und diese Liste bleibt leer.
 * Die vollständige Auskunft gibt `diagnoseClosure`.
 */
export function findOpenEnds(
  walls: Wall[],
  nodes: Record<string, BimNode>,
  tolerance = WELD_TOLERANCE,
): Vec2[] {
  const { segments, clusters, degree } = healSegments(walls, nodes, tolerance);
  const open: Vec2[] = [];

  for (let i = 0; i < clusters.length; i++) {
    if (degree[i] > 1) continue;
    const p = clusters[i];
    // Liegt der Punkt auf einer fremden Achse, ist er trotz Grad 1 angebunden.
    const onAxis = segments.some((s) => {
      if (almostSame(s.a, p) || almostSame(s.b, p)) return false;
      const abx = s.b.x - s.a.x;
      const aby = s.b.y - s.a.y;
      const lenSq = abx * abx + aby * aby;
      if (lenSq < EPS) return false;
      const t = ((p.x - s.a.x) * abx + (p.y - s.a.y) * aby) / lenSq;
      if (t <= 0 || t >= 1) return false;
      return Math.hypot(s.a.x + abx * t - p.x, s.a.y + aby * t - p.y) < 1e-6;
    });
    if (!onAxis) open.push(p);
  }
  return open;
}

const almostSame = (a: Vec2, b: Vec2): boolean =>
  Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;

/**
 * Zerlegt die Wandachsen in einen planaren Graphen. Jede Wand wird an allen
 * echten Kreuzungen mit anderen Wänden sowie an aufliegenden Knoten geteilt.
 */
function buildPlanarGraph(walls: Wall[], nodes: Record<string, BimNode>, tolerance: number): PlanarGraph {
  return graphFromSegments(healSegments(walls, nodes, tolerance).segments);
}

/**
 * Derselbe Aufbau aus bereits geheilten Achsen.
 *
 * Getrennt, weil die Diagnose die Heilung ohnehin selbst durchführt — sie
 * braucht deren Mitschrift. Sie ein zweites Mal laufen zu lassen, nur um an
 * den Graphen zu kommen, wäre der teuerste Teil der Prüfung, doppelt.
 */
function graphFromSegments(segments: HealedSegment[]): PlanarGraph {
  // --- 1. Splitpunkte je Segment sammeln ----------------------------------
  const splits: Vec2[][] = segments.map((s) => [
    { x: s.a.x, y: s.a.y },
    { x: s.b.x, y: s.b.y },
  ]);

  // Umschließende Rechtecke vorab: der Schnitttest ist teurer als vier
  // Vergleiche, und in einem Grundriss überlappen sich die wenigsten Paare.
  const boxes = segments.map((s) => ({
    minX: Math.min(s.a.x, s.b.x),
    maxX: Math.max(s.a.x, s.b.x),
    minY: Math.min(s.a.y, s.b.y),
    maxY: Math.max(s.a.y, s.b.y),
  }));

  for (let i = 0; i < segments.length; i++) {
    const bi = boxes[i];
    for (let j = i + 1; j < segments.length; j++) {
      const bj = boxes[j];
      if (bi.maxX < bj.minX - EPS || bj.maxX < bi.minX - EPS) continue;
      if (bi.maxY < bj.minY - EPS || bj.maxY < bi.minY - EPS) continue;
      const hit = segmentIntersection(
        segments[i].a,
        segments[i].b,
        segments[j].a,
        segments[j].b,
      );
      if (hit) {
        splits[i].push(hit);
        splits[j].push(hit);
      }
    }
  }

  // T-Stöße: geheilte Wandenden, die auf einer fremden Achse aufsetzen, ohne
  // sie zu kreuzen. Nach der Heilung liegen sie exakt darauf, die Toleranz
  // hier ist reine Fließkomma-Sicherheit.
  const endpoints: Vec2[] = [];
  for (const s of segments) {
    endpoints.push(s.a, s.b);
  }
  for (let i = 0; i < segments.length; i++) {
    const { a, b } = segments[i];
    const bi = boxes[i];
    const dir = normalize(sub(b, a));
    const len = distance(a, b);
    for (const n of endpoints) {
      // Ein Wandende kann nur dort aufsetzen, wo die Achse überhaupt liegt.
      // Der Rechteckvergleich spart den Rest der Rechnung für die weitaus
      // meisten Paare — bei 150 Wänden sind das über 40 000 Prüfungen.
      if (n.x < bi.minX - EPS || n.x > bi.maxX + EPS || n.y < bi.minY - EPS || n.y > bi.maxY + EPS) continue;
      const t = (n.x - a.x) * dir.x + (n.y - a.y) * dir.y;
      if (t <= EPS || t >= len - EPS) continue;
      const px = a.x + dir.x * t;
      const py = a.y + dir.y * t;
      if (Math.abs(px - n.x) < 1e-6 && Math.abs(py - n.y) < 1e-6) {
        splits[i].push({ x: n.x, y: n.y });
      }
    }
  }

  // --- 2. Vertices & Kanten materialisieren -------------------------------
  const vertexByKey = new Map<string, GraphVertex>();
  const vertices: GraphVertex[] = [];

  const vertexFor = (p: Vec2): GraphVertex => {
    const key = keyOf(p);
    let vtx = vertexByKey.get(key);
    if (!vtx) {
      vtx = { index: vertices.length, point: { x: p.x, y: p.y }, outgoing: [] };
      vertexByKey.set(key, vtx);
      vertices.push(vtx);
    }
    return vtx;
  };

  const halfEdges: HalfEdge[] = [];
  const edgeSeen = new Set<string>();

  const addEdge = (p: Vec2, q: Vec2, wallId: string) => {
    const vp = vertexFor(p);
    const vq = vertexFor(q);
    if (vp.index === vq.index) return;
    const undirected = vp.index < vq.index ? `${vp.index}-${vq.index}` : `${vq.index}-${vp.index}`;
    if (edgeSeen.has(undirected)) return; // deckungsgleiche Wände nur einmal
    edgeSeen.add(undirected);

    const i1 = halfEdges.length;
    const i2 = i1 + 1;
    const angle1 = Math.atan2(vq.point.y - vp.point.y, vq.point.x - vp.point.x);
    const angle2 = Math.atan2(vp.point.y - vq.point.y, vp.point.x - vq.point.x);

    halfEdges.push(
      { index: i1, from: vp.index, to: vq.index, twin: i2, angle: angle1, wallId, visited: false },
      { index: i2, from: vq.index, to: vp.index, twin: i1, angle: angle2, wallId, visited: false },
    );
    vp.outgoing.push(i1);
    vq.outgoing.push(i2);
  };

  for (let i = 0; i < segments.length; i++) {
    const { a, b, wall } = segments[i];
    const dir = normalize(sub(b, a));
    // Splitpunkte entlang der Achse sortieren und Duplikate entfernen
    const ordered = splits[i]
      .map((p) => ({ p, t: (p.x - a.x) * dir.x + (p.y - a.y) * dir.y }))
      .sort((m, n) => m.t - n.t);

    for (let k = 1; k < ordered.length; k++) {
      if (ordered[k].t - ordered[k - 1].t < 1e-3) continue; // < 1 mm → verschmelzen
      addEdge(ordered[k - 1].p, ordered[k].p, wall.id);
    }
  }

  for (const vtx of vertices) {
    vtx.outgoing.sort((a, b) => halfEdges[a].angle - halfEdges[b].angle);
  }

  return { vertices, halfEdges };
}

/** Eine traversierte Facette samt Umlaufsinn. */
interface TracedFace {
  polygon: Vec2[];
  wallIds: string[];
  /** Vorzeichenbehaftete Fläche: > 0 beschränkt (Raum), < 0 unbeschränkt (außen). */
  signed: number;
}

/**
 * Traversiert alle Facetten. Beim Erreichen eines Knotens wird die
 * Zwillingskante gesucht und die im Winkelfächer *davor* liegende Kante
 * gewählt (scharf rechts). Das umläuft beschränkte Facetten CCW.
 *
 * Die unbeschränkte Facette wird hier bewusst *nicht* verworfen: sie ist der
 * Außenbereich, und wo der in den Grundriss hineinreicht, steht die Antwort
 * auf die Frage, warum eine Fläche kein Raum geworden ist. Aussortiert wird
 * erst beim Aufrufer.
 */
function traceFaces(graph: PlanarGraph): TracedFace[] {
  const { vertices, halfEdges } = graph;
  const faces: TracedFace[] = [];

  for (const start of halfEdges) {
    if (start.visited) continue;

    const polygon: Vec2[] = [];
    const wallIds: string[] = [];
    let edge = start;
    let guard = 0;

    while (!edge.visited && guard++ < halfEdges.length + 4) {
      edge.visited = true;
      polygon.push({ ...vertices[edge.from].point });
      wallIds.push(edge.wallId);

      const vtx = vertices[edge.to];
      const twin = halfEdges[edge.twin];
      const ring = vtx.outgoing;
      const pos = ring.indexOf(twin.index);
      if (pos < 0) break;
      edge = halfEdges[ring[(pos - 1 + ring.length) % ring.length]];
    }

    if (polygon.length >= 3) faces.push({ polygon, wallIds, signed: signedArea(polygon) });
  }

  return faces;
}

/** Beschränkte Facetten: die Außenfacette läuft CW und fällt damit heraus. */
const boundedFaces = (faces: TracedFace[]): TracedFace[] =>
  faces.filter((f) => f.signed > MIN_ROOM_AREA * 0.5);

// ---------------------------------------------------------------------------
// Gebäudeumriss
// ---------------------------------------------------------------------------

/** Zwei Punkte, die aus derselben Graphenecke stammen. */
const nahBei = (a: Vec2, b: Vec2): boolean =>
  Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;

/**
 * Entfernt Stacheln aus einem traversierten Ring.
 *
 * Die Außenfacette läuft über *jede* Wand, auch über die, die nichts
 * umschließt: ein freies Wandende, ein Gartenmauerstumpf, eine Wand, die nur
 * an einem Ende angebunden ist. Solche Wände werden hin und wieder zurück
 * durchlaufen und stehen im Ring als Zickzack ohne Fläche.
 *
 * Stehen bleiben dürfen sie nicht. Der Umriss wird für Punkt-Kanten-Abstände
 * benutzt, und ein null Millimeter breiter Schlitz mitten in der Fläche liegt
 * jedem Punkt daneben beliebig nahe — das Dach bekäme dort eine Kehle bis auf
 * Traufhöhe, wo in Wirklichkeit gar keine Gebäudekante ist.
 *
 * Gestrichen wird, solange sich etwas ändert: ein langer Stachel aus mehreren
 * Wänden wird von der Spitze her abgetragen, und jeder abgetragene Zacken legt
 * den nächsten frei.
 */
function ohneStacheln(ring: readonly Vec2[]): Vec2[] {
  let pts: Vec2[] = ring.map((p) => ({ x: p.x, y: p.y }));

  for (let runde = 0; runde < pts.length + 4; runde++) {
    // Aufeinanderfolgende Dubletten — auch über den Ringschluss hinweg.
    const knapp: Vec2[] = [];
    for (const p of pts) {
      if (knapp.length === 0 || !nahBei(knapp[knapp.length - 1], p)) knapp.push(p);
    }
    while (knapp.length > 1 && nahBei(knapp[0], knapp[knapp.length - 1])) knapp.pop();
    pts = knapp;
    if (pts.length < 3) return [];

    // Ein Stachel: Vorgänger und Nachfolger sind derselbe Punkt.
    const n = pts.length;
    let spitze = -1;
    for (let i = 0; i < n; i++) {
      if (nahBei(pts[(i - 1 + n) % n], pts[(i + 1) % n])) {
        spitze = i;
        break;
      }
    }
    if (spitze < 0) return pts;
    // Die Spitze und einen der beiden gleichen Nachbarn streichen; der andere
    // bleibt stehen und schließt die Lücke.
    const weg = (spitze + 1) % n;
    pts = pts.filter((_, k) => k !== spitze && k !== weg);
    if (pts.length < 3) return [];
  }
  return pts.length >= 3 ? pts : [];
}

/**
 * Der Außenumriss aus einem bereits traversierten Facettensatz.
 *
 * Die unbeschränkte Facette läuft im Uhrzeigersinn und trägt deshalb eine
 * negative Fläche. Gibt es mehrere — jede zusammenhängende Wandgruppe hat
 * ihre eigene, und ein freistehender Innenring im Hof hat auch eine —, gewinnt
 * die flächengrößte: das ist der Umriss des Gebäudes, alle anderen liegen
 * darin oder daneben.
 */
function umrissAusFacetten(faces: TracedFace[]): Vec2[] {
  let aussen: TracedFace | undefined;
  for (const f of faces) {
    if (f.signed >= 0) continue;
    if (!aussen || f.signed < aussen.signed) aussen = f;
  }
  if (!aussen) return [];

  const ring = simplifyPolygon(ohneStacheln(aussen.polygon));
  if (ring.length < 3) return [];
  // Umgedreht, damit der Umriss gegen den Uhrzeigersinn läuft — wie
  // `room.polygon`, das aus den beschränkten Facetten kommt und dort schon
  // CCW ist. Zwei Umlaufkonventionen in einem Programm wären eine Falle:
  // jede Außennormale, jedes Vorzeichen einer Fläche hinge dann davon ab,
  // aus welcher Funktion das Polygon gerade stammt.
  ring.reverse();
  return ring;
}

/**
 * Der Gebäudeumriss eines Geschosses als geordnetes Polygon, gegen den
 * Uhrzeigersinn und ohne Dubletten.
 *
 * **Warum es diese Funktion braucht.** Bis 1.26.0 gab es im ganzen Programm
 * keine. Wer den Umriss brauchte — das Dach braucht ihn —, bekam eine
 * *Punktwolke*: je Wand Anfangs- und Endknoten, mit Duplikaten, ohne
 * Reihenfolge, Innenwände mittendrin. Daraus lässt sich nur noch das
 * umschließende Rechteck bilden, und ein L-förmiges Haus ist kein Rechteck.
 * Ein Walmdach über einem solchen Rechteck läuft über den Innenwinkel hinweg:
 * Dachform, Raumvolumen, Wohnfläche nach WoFlV und die Dachflächen je
 * Himmelsrichtung stimmen dann alle nicht — und zwar unbemerkt, weil die
 * Zahlen plausibel aussehen.
 *
 * Gerechnet wird auf demselben planaren Graphen wie die Raumerkennung. Die
 * unbeschränkte Facette, die dort verworfen wird, *ist* der gesuchte Umriss;
 * sie wird hier nur nicht weggeworfen, sondern von Stacheln befreit und
 * umgedreht.
 *
 * Leeres Ergebnis heißt: es gibt keinen geschlossenen Umriss (zu wenige
 * Wände, nur Stummel, kein Ring). Dann rechnet der Aufrufer wie bisher — eine
 * geratene Umrisslinie wäre schlimmer als gar keine.
 */
export function gebaeudeUmriss(
  walls: Wall[],
  nodes: Record<string, BimNode>,
  weldTolerance = WELD_TOLERANCE,
): Vec2[] {
  if (walls.length < 3) return [];
  return umrissAusFacetten(traceFaces(buildPlanarGraph(walls, nodes, weldTolerance)));
}

// ---------------------------------------------------------------------------
// Raumbildung
// ---------------------------------------------------------------------------

export interface DetectRoomsInput {
  walls: Wall[];
  nodes: Record<string, BimNode>;
  openings: Opening[];
  levelId: string;
  /** Standard-Raumhöhe [m], falls die Wandhöhen abweichen. */
  defaultHeight: number;
  northAngle: number;
  /** Bereits vorhandene Räume — für die Namensübernahme nach Umbauten. */
  previous?: Room[];
  /** Schweiß-Toleranz [m] für die Topologie-Heilung. */
  weldTolerance?: number;
  /**
   * Dach über diesem Geschoss. Ist es gesetzt, ersetzt die ortsabhängige
   * Höhe unter der Schräge die konstante Geschosshöhe — in Volumen,
   * Wandflächen und Raumhöhe.
   */
  roof?: RoofDefinition;
  /** Gauben und Dachflächenfenster dieses Geschosses. */
  roofOpenings?: RoofOpening[];
  /**
   * Der Katalog der Bauteilaufbauten — `doc.constructions`.
   *
   * **Warum die Raumerkennung ihn braucht.** Der Wandabschnitt führt einen
   * U-Wert mit, und bis 1.23.0 war das stur `wall.uValue`. Eine Wand, der ein
   * Aufbau aus dem Katalog zugewiesen war und die deshalb gar keinen eigenen
   * U-Wert trug, kam damit ohne U-Wert aus der Raumerkennung heraus — während
   * die Übergabe an RaVia denselben Aufbau längst auswertete. Zwei Programme,
   * dieselbe Wand, zwei U-Werte.
   *
   * Wahlfrei, weil die Raumerkennung auch ohne Katalog arbeiten können muss:
   * sie läuft in Prüfblöcken über von Hand gebaute Wandlisten, in denen es gar
   * kein Dokument gibt. Ohne Katalog bleibt es bei der bisherigen Rangfolge
   * ohne die oberste Stufe.
   */
  constructions?: Record<string, Construction>;
}

/**
 * Der U-Wert, den ein Wandabschnitt mitführen darf.
 *
 * Nur die beiden belastbaren Stufen der Rangfolge: was im Modell steht.
 * `undefined` heißt hier ausdrücklich „im Modell nicht erfasst" und nicht
 * „null" — der Unterschied ist der ganze Zweck dieser Funktion. Wer daraus
 * rechnet, muss den Vorgabewert selbst holen und mitdrucken, dass er geraten
 * ist; siehe `uwert.ts` und `heatLoadEstimate.ts`.
 */
function uWertAbschnitt(
  wall: Wall | undefined,
  constructions: Record<string, Construction> | undefined,
): number | undefined {
  const auskunft = uWertWand(wall, constructions);
  return auskunft.herkunft === 'aufbau' || auskunft.herkunft === 'bauteil' ? auskunft.wert : undefined;
}

/**
 * Eine erkannte Facette, deren Geometrie feststeht — aber noch nicht ihre
 * Identität.
 *
 * Der Zwischenschritt existiert, weil die Namensübernahme aus dem vorigen
 * Stand *alle* Flächen kennen muss, bevor die erste einen Namen bekommt.
 * Siehe `matchPrevious`.
 */
interface PreparedFace {
  polygon: Vec2[];
  edgeWalls: (Wall | undefined)[];
  innerPolygon: Vec2[];
  grossArea: number;
  area: number;
  perimeter: number;
  centroid: Vec2;
}

/**
 * Ordnet den erkannten Flächen ihre Vorgänger zu — höchstens einen je Fläche
 * **und höchstens eine Fläche je Vorgänger**.
 *
 * Die zweite Hälfte des Satzes ist der ganze Punkt. Vorgängerräume überlappen
 * einander nicht, deshalb liegt der Schwerpunkt einer Fläche in höchstens
 * einem von ihnen — die Richtung Fläche → Vorgänger ist von selbst eindeutig.
 * Die Gegenrichtung ist es nicht: zieht man eine Wand durch ein Zimmer,
 * liegen die Schwerpunkte *beider* Teilflächen im selben alten Raum. Ohne
 * diese Funktion erbten beide dieselbe Kennung, und wer Räume nach Kennung
 * ablegt — das Dokument tut genau das —, behält nur eine davon. An einem
 * sauber gezeichneten 2×3-Raster kostete das drei von sechs Räumen, ohne dass
 * die Facettensuche selbst etwas übersehen hätte.
 *
 * Wer von mehreren Anwärtern gewinnt: die Fläche, die dem alten Raum am
 * ähnlichsten ist, also die mit der kleinsten Flächendifferenz. Beim Teilen
 * eines Raums ist das die größere Hälfte — Name, Nutzung, Solltemperatur und
 * eine gerechnete Heizlast bleiben damit an dem Stück, das der Raum von
 * vorher im Wesentlichen noch ist, und der abgetrennte Teil ist der neue.
 * Bei Gleichstand entscheidet der kürzere Weg zwischen den Schwerpunkten,
 * danach die Reihenfolge: das Ergebnis darf nicht davon abhängen, in welcher
 * Reihenfolge die Facettensuche gelaufen ist.
 */
function matchPrevious(prepared: PreparedFace[], previous: Room[]): (Room | undefined)[] {
  const matched: (Room | undefined)[] = prepared.map(() => undefined);
  if (previous.length === 0) return matched;

  // Anwärter je Vorgängerraum sammeln.
  const claims = new Map<number, number[]>();
  for (let i = 0; i < prepared.length; i++) {
    const idx = previous.findIndex(
      (r) => r.innerPolygon.length >= 3 && pointInPolygon(prepared[i].centroid, r.innerPolygon),
    );
    if (idx < 0) continue;
    const list = claims.get(idx);
    if (list) list.push(i);
    else claims.set(idx, [i]);
  }

  for (const [prevIndex, faceIndices] of claims) {
    const room = previous[prevIndex];
    let best = faceIndices[0];
    let bestDelta = Math.abs(prepared[best].area - room.area);
    let bestReach = distance(prepared[best].centroid, room.centroid);
    for (let k = 1; k < faceIndices.length; k++) {
      const i = faceIndices[k];
      const delta = Math.abs(prepared[i].area - room.area);
      const reach = distance(prepared[i].centroid, room.centroid);
      if (delta < bestDelta - 1e-9 || (Math.abs(delta - bestDelta) <= 1e-9 && reach < bestReach)) {
        best = i;
        bestDelta = delta;
        bestReach = reach;
      }
    }
    matched[best] = room;
  }
  return matched;
}

/**
 * Erkennt alle geschlossenen Räume und berechnet Fläche, Volumen,
 * Wandabschnitte und Öffnungsflächen pro Himmelsrichtung.
 */
export function detectRooms(input: DetectRoomsInput): Room[] {
  const {
    walls,
    nodes,
    openings,
    levelId,
    defaultHeight,
    northAngle,
    previous = [],
    weldTolerance = WELD_TOLERANCE,
    roof,
    roofOpenings = [],
    constructions,
  } = input;
  if (walls.length < 3) return [];

  const openingsByWall = new Map<string, Opening[]>();
  for (const op of openings) {
    const list = openingsByWall.get(op.wallId);
    if (list) list.push(op);
    else openingsByWall.set(op.wallId, [op]);
  }

  const graph = buildPlanarGraph(walls, nodes, weldTolerance);
  const facetten = traceFaces(graph);
  const faces = boundedFaces(facetten);

  // Bezugsrahmen des Daches einmal aus allen Wandknoten dieses Geschosses.
  // Er muss aus dem *ganzen* Geschoss kommen, nicht je Raum: der First liegt
  // über dem Gebäude, nicht über einem einzelnen Zimmer.
  const outline: Vec2[] = [];
  for (const w of walls) {
    const na = nodes[w.a];
    const nb = nodes[w.b];
    if (na) outline.push({ x: na.x, y: na.y });
    if (nb) outline.push({ x: nb.x, y: nb.y });
  }
  // Der geordnete Umriss kommt aus *demselben* Facettensatz, der eben für die
  // Räume traversiert wurde — ein zweiter Graphaufbau wäre der teuerste
  // Schritt der Raumerkennung, doppelt. Gebildet wird er nur, wenn wirklich
  // ein geneigtes Dach darüberliegt: der Regelfall ohne Dach darf nichts
  // kosten.
  const umriss = roof && roof.kind !== 'flat' ? umrissAusFacetten(facetten) : [];
  const roofFrame: RoofFrame | null = buildRoofFrame(roof, outline, roofOpenings, umriss);

  const rooms: Room[] = [];
  const probesByRoom = new Map<string, Vec2[]>();
  const wallById = new Map(walls.map((w) => [w.id, w]));
  let counter = 0;

  // --- 1. Geometrie je Facette -------------------------------------------
  // Bewusst vor allem anderen und vollständig: die Identitätsvergabe im
  // nächsten Schritt vergleicht die Flächen untereinander und kann deshalb
  // nicht mitten in einer Schleife über dieselben Flächen stattfinden.
  const prepared: PreparedFace[] = [];
  for (const face of faces) {
    const polygon = simplifyPolygon(face.polygon);
    if (polygon.length < 3) continue;

    const grossArea = polygonArea(polygon);
    if (grossArea < MIN_ROOM_AREA) continue;

    // Kanten-Metadaten in der Reihenfolge des vereinfachten Polygons neu bestimmen.
    const edgeWalls: (Wall | undefined)[] = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i];
      const b = polygon[(i + 1) % polygon.length];
      edgeWalls.push(findWallForEdge(a, b, walls, nodes, weldTolerance + 5e-3));
    }

    // Lichtes Innenpolygon: jede Kante um ihre halbe Wandstärke versetzen.
    const offsets = edgeWalls.map((w) => (w ? w.thickness / 2 : 0.1));
    const innerPolygon = simplifyPolygon(offsetPolygonPerEdge(polygon, offsets));
    const area = innerPolygon.length >= 3 ? polygonArea(innerPolygon) : grossArea;
    const perimeter = innerPolygon.length >= 3 ? polygonPerimeter(innerPolygon) : polygonPerimeter(polygon);

    prepared.push({
      polygon,
      edgeWalls,
      innerPolygon,
      grossArea,
      area,
      perimeter,
      centroid: polygonCentroid(innerPolygon.length >= 3 ? innerPolygon : polygon),
    });
  }

  // --- 2. Identität über Umbauten hinweg halten --------------------------
  const matched = matchPrevious(prepared, previous);

  // Schon vergebene Kennungen und Namen — die geerbten zuerst. Eine neu
  // vergebene Nummer darf nie auf eine geerbte treffen: `room-eg-2` zweimal
  // wäre im Dokument nur einmal, und der zweite Raum verschwände so
  // spurlos wie vorher die Teilflächen.
  const takenIds = new Set<string>();
  const takenNames = new Set<string>();
  for (const room of matched) {
    if (!room) continue;
    takenIds.add(room.id);
    takenNames.add(room.name);
  }

  // --- 3. Räume bauen ----------------------------------------------------
  for (let faceIndex = 0; faceIndex < prepared.length; faceIndex++) {
    const { polygon, edgeWalls, innerPolygon, grossArea, area, perimeter, centroid } = prepared[faceIndex];
    const inherited = matched[faceIndex];

    // Raumhöhe = kleinste beteiligte Wandhöhe (lichtes Maß gewinnt).
    // Eine vom Nutzer gesetzte Raumhöhe schlägt das — bei abgehängter Decke
    // oder Dachschräge ist die Wandhöhe nicht die maßgebliche Raumhöhe.
    //
    // **Brüstungen zählen dabei nicht mit.** Ein Raum, der teilweise von einer
    // Brüstung begrenzt wird — Galerie, Treppenauge, Küchentresen, der
    // Kniestock im Dachgeschoss —, ist nicht so hoch wie diese Brüstung. Bis
    // 1.15.1 war er es: die kleinste Wandhöhe gewann bedingungslos, und ein
    // Raum neben einer 1,19-m-Brüstung bekam 1,19 m Höhe.
    //
    // Das ist kein Schönheitsfehler. Aus der Raumhöhe folgt das Luftvolumen,
    // aus dem Luftvolumen der Lüftungswärmeverlust. Der Raum im Beispielscan
    // wurde mit 10,3 m³ statt 21,3 m³ gerechnet — der Lüftungsanteil seiner
    // Heizlast war damit halbiert. Aufgefallen ist es erst, als ein Raumscan
    // echte, unterschiedliche Wandhöhen ins Modell brachte; von Hand zeichnet
    // niemand eine 1,19-m-Wand an einen Wohnraum.
    let height = defaultHeight;
    for (const w of edgeWalls) {
      if (!w || w.height >= height) continue;
      if (w.height < BRUESTUNGS_HOEHE) continue;
      height = w.height;
    }

    // --- Wandabschnitte & Öffnungen -------------------------------------
    const boundaries: RoomBoundary[] = [];
    const probes: Vec2[] = [];
    const usedOpenings = new Set<string>();

    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i];
      const b = polygon[(i + 1) % polygon.length];
      const wall = edgeWalls[i];
      const segLength = distance(a, b);
      if (segLength < EPS) continue;

      // Bei CCW-Umlauf liegt der Raum links der Laufrichtung. Die vom Raum
      // *weg* zeigende Normale ist damit die Rechtsnormale (dy, −dx) — und
      // genau sie bestimmt die Himmelsrichtung für die Heizlast.
      const dir = normalize(sub(b, a));
      const outwardNormal = { x: dir.y, y: -dir.x };
      const azimuth = azimuthFromNormal(outwardNormal, northAngle);

      // Unter einer Dachschräge ist die Wandfläche kein Rechteck mehr,
      // sondern das Integral der Höhe entlang der Wand. Ohne Dach bleibt es
      // bei Länge × Höhe.
      const wallHeight = wall?.height ?? height;
      const profile = roofFrame ? wallProfileUnderRoof(roofFrame, a, b) : null;
      const grossWallArea = profile ? profile.grossArea : segLength * wallHeight;

      // Öffnungen, deren Mitte innerhalb dieses Abschnitts liegt, zuordnen.
      let openingArea = 0;
      if (wall) {
        const na = nodes[wall.a];
        const nb = nodes[wall.b];
        for (const op of openingsByWall.get(wall.id) ?? []) {
          if (usedOpenings.has(op.id)) continue;
          if (!na || !nb) continue;
          const wallLen = distance(na, nb);
          if (wallLen < EPS) continue;
          const t = op.distance / wallLen;
          const center = { x: na.x + (nb.x - na.x) * t, y: na.y + (nb.y - na.y) * t };
          // Liegt der Öffnungsmittelpunkt auf DIESEM Teilstück?
          const along = (center.x - a.x) * dir.x + (center.y - a.y) * dir.y;
          if (along >= -0.05 && along <= segLength + 0.05) {
            openingArea += op.width * op.height;
            usedOpenings.add(op.id);
          }
        }
      }

      boundaries.push({
        wallId: wall?.id ?? '',
        length: segLength,
        grossArea: grossWallArea,
        openingArea: Math.min(openingArea, grossWallArea),
        netArea: Math.max(0, grossWallArea - openingArea),
        orientation: orientationFromAzimuth(azimuth),
        azimuth,
        isExterior: wall?.type === 'exterior',
        // Nicht `wall?.uValue`, sondern die Rangfolge aus `uwert.ts`: zuerst
        // der zugewiesene Bauteilaufbau, dann der am Bauteil erfasste Wert.
        // Der Vorgabewert nach Bauteilart bleibt hier bewusst **außen vor** —
        // der Abschnitt soll festhalten, was im Modell steht, nicht was man
        // ersatzweise annehmen könnte. Wer rechnet, fragt `uwert.ts` selbst
        // und erfährt dabei auch die Herkunft; ein hier eingetragener
        // Vorgabewert wäre von einem erfassten nicht mehr zu unterscheiden.
        uValue: uWertAbschnitt(wall, constructions),
        // Vorläufig; die endgültige Randbedingung steht erst fest, wenn alle
        // Räume bekannt sind — ein Nachbarraum kann erst dann gefunden werden.
        boundary: wall?.boundary ?? (wall?.type === 'exterior' ? 'exterior' : 'unheated'),
        gableArea: profile ? profile.gableArea : undefined,
      });

      // Sondierpunkt jenseits der Wand: von dort aus wird gleich der
      // Nachbarraum gesucht. Er wird hier gemerkt, weil die Kantenreihenfolge
      // durch übersprungene Nullkanten nicht mit dem Polygonindex übereinstimmt.
      const probeDistance = (wall?.thickness ?? 0.2) / 2 + 0.12;
      probes.push({
        x: (a.x + b.x) / 2 + outwardNormal.x * probeDistance,
        y: (a.y + b.y) / 2 + outwardNormal.y * probeDistance,
      });
    }

    if (inherited?.heightOverride) height = inherited.heightOverride;

    // Unter dem Dach ist die maßgebliche Höhe die *mittlere* lichte Höhe;
    // das Volumen kommt aus der Integration, nicht aus Fläche × Höhe.
    const roofMetrics =
      roofFrame && innerPolygon.length >= 3
        ? measureRoomUnderRoof(roofFrame, innerPolygon)
        : undefined;
    if (roofMetrics && !inherited?.heightOverride) height = roofMetrics.averageHeight;
    const volume = roofMetrics ? roofMetrics.volume : area * height;
    const usage: RoomUsage = inherited?.usage ?? 'other';
    const defaults = USAGE_DEFAULTS[usage];

    // Neue Räume bekommen die kleinste freie Nummer. Geerbte verbrauchen
    // keine — ihre Nummer steckt schon in ihrem Namen. Ohne die
    // Freiheitsprüfung könnte eine neu vergebene Kennung auf eine geerbte
    // treffen, und der neue Raum verschwände beim Ablegen ebenso spurlos.
    let id: string;
    let name: string;
    if (inherited) {
      id = inherited.id;
      name = inherited.name;
    } else {
      while (takenIds.has(`room-${levelId}-${counter}`) || takenNames.has(`Raum ${counter + 1}`)) counter++;
      id = `room-${levelId}-${counter}`;
      name = `Raum ${counter + 1}`;
      takenIds.add(id);
      takenNames.add(name);
      counter++;
    }

    rooms.push({
      id,
      name,
      usage,
      levelId,
      polygon,
      innerPolygon,
      area,
      grossArea,
      perimeter,
      height,
      volume,
      centroid,
      boundaries,
      setpointTemperature: inherited?.setpointTemperature ?? defaults.temp,
      airChangeRate: inherited?.airChangeRate ?? defaults.ach,
      ventilationRole: inherited?.ventilationRole ?? defaults.air,
      isHeated: inherited?.isHeated ?? true,
      floorUValue: inherited?.floorUValue,
      floorBoundary: inherited?.floorBoundary,
      ceilingUValue: inherited?.ceilingUValue,
      ceilingBoundary: inherited?.ceilingBoundary,
      groundContactPerimeter: 0,
      exposedFacadeCount: 0,
      heightOverride: inherited?.heightOverride,
      // Der Bodenbelag ist eine Angabe des Anwenders und überlebt das
      // Neuerkennen — eine verschobene Wand ändert nicht, was auf dem
      // Boden liegt.
      floorCovering: inherited?.floorCovering,
      // Eine von der Gegenstelle gerechnete Heizlast überlebt das Neuerkennen.
      // Sie geht dabei aber nicht als „aktuell" durch: sie trägt den
      // Modellstand mit, für den sie gerechnet wurde, und das Anlagenblatt
      // sagt es, sobald der abweicht. Sie hier wegzuwerfen wäre bequemer und
      // falsch — eine verschobene Innenwand macht die Heizlast des Nachbarraums
      // nicht ungültig, sie macht sie fraglich.
      normHeatLoad: inherited?.normHeatLoad,
      roof: roofMetrics,
    });
    probesByRoom.set(rooms[rooms.length - 1].id, probes);
  }

  resolveAdjacency(rooms, probesByRoom, wallById);

  // Größte Räume zuerst — stabile, sinnvolle Reihenfolge in der Raumliste.
  rooms.sort((a, b) => b.area - a.area);
  return rooms;
}

/**
 * Bestimmt für jeden Wandabschnitt, was auf der anderen Seite liegt, und
 * leitet daraus die Randbedingung ab. Das ist der Datenpunkt, ohne den eine
 * Heizlastrechnung Innenwände nicht bewerten kann: erst die Nachbartemperatur
 * entscheidet, ob über eine Trennwand überhaupt Wärme abfließt.
 *
 * Zusätzlich fallen zwei Kennwerte ab, die die Norm für Lüftung und Erdreich
 * braucht: der Umfang mit Erdkontakt und die Zahl unterschiedlich orientierter
 * Außenfassaden.
 */
function resolveAdjacency(
  rooms: Room[],
  probesByRoom: Map<string, Vec2[]>,
  wallById: Map<string, Wall>,
): void {
  for (const room of rooms) {
    const probes = probesByRoom.get(room.id) ?? [];
    const facades = new Set<string>();
    let groundPerimeter = 0;

    for (let i = 0; i < room.boundaries.length; i++) {
      const boundary = room.boundaries[i];
      const probe = probes[i];
      const wall = wallById.get(boundary.wallId);

      if (probe) {
        const neighbour = rooms.find(
          (r) => r.id !== room.id && r.innerPolygon.length >= 3 && pointInPolygon(probe, r.innerPolygon),
        );
        if (neighbour) boundary.neighbourRoomId = neighbour.id;
      }

      // Explizite Angabe an der Wand hat immer Vorrang — sie beschreibt
      // Situationen, die aus der Geometrie allein nicht hervorgehen.
      let condition: BoundaryCondition;
      if (wall?.boundary) condition = wall.boundary;
      else if (wall?.type === 'exterior') condition = 'exterior';
      else if (boundary.neighbourRoomId) condition = 'adjacent-room';
      else condition = 'unheated';
      boundary.boundary = condition;

      if (condition === 'exterior') {
        groundPerimeter += boundary.length;
        facades.add(boundary.orientation);
      }
    }

    room.groundContactPerimeter = groundPerimeter;
    room.exposedFacadeCount = facades.size;
  }
}

/** Findet die Wand, auf deren Achse das Teilstück a→b vollständig liegt. */
function findWallForEdge(
  a: Vec2,
  b: Vec2,
  walls: Wall[],
  nodes: Record<string, BimNode>,
  tolerance = 5e-3,
): Wall | undefined {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  let best: Wall | undefined;
  // Nach der Heilung kann die Kante um bis zu eine Schweiß-Toleranz von der
  // ursprünglichen Wandachse abweichen — die Zuordnung muss das mitgehen.
  let bestDist = tolerance;

  for (const w of walls) {
    const na = nodes[w.a];
    const nb = nodes[w.b];
    if (!na || !nb) continue;
    const dx = nb.x - na.x;
    const dy = nb.y - na.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < EPS) continue;
    let t = ((mx - na.x) * dx + (my - na.y) * dy) / lenSq;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = na.x + dx * t;
    const py = na.y + dy * t;
    const d = Math.sqrt((px - mx) * (px - mx) + (py - my) * (py - my));
    if (d < bestDist) {
      bestDist = d;
      best = w;
    }
  }
  return best;
}

/**
 * Bucht Treppen, Schächte und massive Bauteile auf die Räume, in denen sie
 * liegen.
 *
 * Getrennt von `detectRooms`, weil es nichts mit der Geometrie der Wände zu
 * tun hat: die Räume stehen schon fest, es geht nur noch um die Frage, wie
 * viel Fläche und Decke eine Treppe wegnimmt.
 *
 * Massive Bauteile stehen in derselben Funktion, obwohl sie das Gegenteil
 * eines Lochs sind: für Fläche und Volumen wirken sie identisch. Ein Kamin
 * von 0,50 × 0,40 m nimmt dem Raum dieselben 0,20 m² wie ein Schacht
 * derselben Größe, und dieselben 0,55 m³ Luft. Was er *nicht* tut, ist die
 * Decke öffnen — dort ist Mauerwerk, kein Luftraum. Die Deckenfläche des
 * Raums bleibt deshalb ungeschmälert; sie fällt damit um die Kaminfläche zu
 * groß aus, was den Transmissionsverlust um Bruchteile eines Watts nach oben
 * verschiebt und auf der sicheren Seite liegt. Ein eigenes Feld dafür wäre
 * mehr Aufwand als Erkenntnis.
 */
export function applyVerticalDeductions(
  rooms: Room[],
  verticals: VerticalElement[],
  /** Geschosse von unten nach oben — nötig, um „reicht bis" aufzulösen. */
  levelOrder: string[] = [],
  /** Massive Bauteile: Kamin, Pfeiler, Wandversatz. */
  solids: SolidElement[] = [],
): void {
  const rank = new Map(levelOrder.map((id, i) => [id, i]));

  /**
   * Über welche Geschosse reicht ein Bauteil? Eine Treppe vom EG ins OG
   * durchstößt auch die Decke des EG *und* den Boden des OG — im oberen
   * Geschoss fehlt an dieser Stelle die Fläche genauso.
   */
  const spans = (v: VerticalElement, levelId: string): boolean => {
    if (v.levelId === levelId) return true;
    if (!v.toLevelId) {
      // Ohne Angabe reicht das Bauteil ein Geschoss nach oben.
      const from = rank.get(v.levelId);
      const to = rank.get(levelId);
      return from !== undefined && to !== undefined && to === from + 1;
    }
    const from = rank.get(v.levelId);
    const upto = rank.get(v.toLevelId);
    const here = rank.get(levelId);
    if (from === undefined || upto === undefined || here === undefined) return false;
    return here > Math.min(from, upto) && here <= Math.max(from, upto);
  };

  /**
   * Reicht ein massives Bauteil bis in dieses Geschoss?
   *
   * Ein Schornstein durchstößt jede Decke über seinem Ausgangsgeschoss; ein
   * Pfeiler und ein Wandversatz gehören zu genau einem. Anders als bei der
   * Treppe braucht es dafür kein Zielgeschoss: „durch alles darüber" ist die
   * ehrlichere Angabe, weil sie beim Anbau eines Geschosses richtig bleibt.
   */
  const solidSpans = (b: SolidElement, levelId: string): boolean => {
    if (b.levelId === levelId) return true;
    if (!b.throughAllLevels) return false;
    const from = rank.get(b.levelId);
    const here = rank.get(levelId);
    return from !== undefined && here !== undefined && here > from;
  };

  for (const room of rooms) {
    let opening = 0;
    let openAbove = 0;
    let solidPart = 0;
    for (const v of verticals) {
      if (!spans(v, room.levelId)) continue;
      if (room.innerPolygon.length < 3 || !pointInPolygon(v.position, room.innerPolygon)) continue;
      const a = v.width * v.length;
      // Im *oberen* Geschoss fehlt nur die Bodenfläche; ob dort die Decke
      // offen ist, entscheidet erst das Bauteil des nächsten Geschosses.
      const isOwnLevel = v.levelId === room.levelId;
      if (v.deductsArea) opening += a;
      if (v.openToAbove && isOwnLevel) openAbove += a;
    }
    for (const b of solids) {
      if (!solidSpans(b, room.levelId)) continue;
      if (room.innerPolygon.length < 3 || !pointInPolygon(b.position, room.innerPolygon)) continue;
      // Die volle Grundfläche, nicht der Teil innerhalb des Raumpolygons: ein
      // Bauteil, dessen Mittelpunkt im Raum liegt, steht im Raum. Dieselbe
      // Vereinfachung wie bei Treppe und Schacht — wer einen Versatz halb in
      // die Wand legt, zeichnet ihn schmaler.
      solidPart += polygonArea(solidFootprint(b));
    }
    opening += solidPart;
    if (opening <= 0 && openAbove <= 0) continue;

    room.floorOpeningArea = Math.min(round3(opening), room.area);
    room.openToAboveArea = Math.min(round3(openAbove), room.area);
    if (solidPart > 0) room.solidArea = Math.min(round3(solidPart), room.area);
    // Das Luftvolumen verliert genau den Anteil, den die Treppe einnimmt —
    // sonst wird der Lüftungswärmeverlust zu groß gerechnet.
    room.volume = round3(Math.max(0, room.volume - (room.floorOpeningArea ?? 0) * room.height));
  }
}

/**
 * Ab welchem Anteil gilt eine Fläche als Mauerwerk und nicht mehr als Raum?
 *
 * Der Fall aus dem Aufmaß: zwischen vier Wandstücken erkennt die
 * Raumerkennung eine Fläche und nennt sie „Raum 3, 3,16 m²" — tatsächlich
 * steht dort der Kaminzug. Der Anwender erklärt sie deshalb im
 * Eigenschaftsfenster zum massiven Bauteil; das erzeugt ein `SolidElement`
 * mit dem Umriss des Raums.
 *
 * Danach *muss* die Fläche aufhören, ein Raum zu sein — sonst trägt sie
 * weiterhin Heizlast, Luftvolumen, Fußbodenheizung und einen Raumstempel.
 * Gerechnet wird das nicht über ein zusätzliches Kennzeichen am Raum
 * (Räume sind abgeleitet und überleben keine Änderung an den Wänden),
 * sondern über die Fläche selbst: was zu vier Fünfteln Mauerwerk ist, ist
 * kein Aufenthaltsraum mehr.
 *
 * 0,80 und nicht 1,00, weil der Umriss des Bauteils auf Millimeter gerundet
 * wird und ein Kaminzug selten exakt am Putz endet.
 */
export const MASSIVE_SHARE = 0.8;

/**
 * Ist diese Fläche in Wirklichkeit Mauerwerk?
 *
 * Die eine Stelle, an der die Frage beantwortet wird — Export, Heizlast,
 * Grundriss, Ausdruck und 3D-Ansicht fragen hier und entscheiden nicht
 * jeweils selbst.
 */
export function isMassiveArea(room: Room): boolean {
  if (room.area <= 0) return false;
  return (room.solidArea ?? 0) / room.area >= MASSIVE_SHARE;
}

const round3 = (v: number): number => Math.round(v * 1000) / 1000;

// ===========================================================================
// Diagnose — warum aus einer Fläche kein Raum wird
// ===========================================================================

/**
 * Warum es diesen Abschnitt gibt.
 *
 * Die Raumerkennung ist entweder erfolgreich oder stumm. Bleibt eine Fläche
 * ohne Raum, sieht der Anwender nichts — keine Fläche, keinen Namen, keine
 * Meldung. Er sucht dann dort, wo er zuletzt gezeichnet hat, und nicht dort,
 * wo die Umschließung tatsächlich aufreißt. Der häufigste Fall aus der Praxis
 * ist dabei der unauffälligste: *jedes* Wandende sitzt sauber an einem
 * anderen, und trotzdem fehlt zwischen zwei Bauteilen ein Wandstück. Die
 * bisherige Prüfung (`findOpenEnds`) kann das nicht sehen — sie meldet nur
 * Enden mit Grad 1, und an einer solchen Lücke hat jedes Ende Grad 2.
 *
 * Deshalb wird hier nicht nach losen Enden gesucht, sondern nach dem
 * Außenbereich: Wo die unbeschränkte Facette in den Grundriss hineingreift,
 * liegt die Lücke. Die Sehne zwischen zwei Punkten dieser Facette, die keine
 * Wand kreuzt, ist die fehlende Wand; die Fläche, die sie abtrennt, ist der
 * Raum, der dadurch fehlt. Beides lässt sich in Metern und Quadratmetern
 * benennen — und genau das braucht der Anwender.
 */

/**
 * Die Befundtypen stehen in `types/bim` und werden hier nur weitergereicht.
 *
 * Grund: die Befunde landen im Dokument (`BimDocument.diagnostics.closure`)
 * und werden von der Oberfläche gezeichnet. Stünden sie hier, müsste
 * `types/bim` aus dem Rechenkern importieren — die Abhängigkeit liefe im
 * Kreis. Der Re-Export hält den bisherigen Importweg offen: wer
 * `ClosureIssue` aus diesem Modul geholt hat, holt es weiter von hier.
 */
export type { ClosureIssue, ClosureIssueKind } from '../types/bim';

/**
 * Größte Lücke [m], die noch als vergessene Wand gilt.
 *
 * Die Zahl trennt nicht Richtig von Falsch, sondern Versehen von Absicht.
 * Eine zweiflügelige Tür mit Laibungen misst rund 2,00 m; darunter liegt
 * alles, was ein Wandstück sein könnte, das jemand nicht gezeichnet hat.
 * Was breiter als 2,50 m offen steht, hat der Planer so gewollt — eine Loggia,
 * ein offener Übergang, ein Carport. Das zu melden wäre Lärm, und Lärm bringt
 * den Anwender dazu, auch die berechtigten Meldungen wegzuklicken.
 *
 * Die Grenze begrenzt zugleich die Suche: nur Punktpaare innerhalb dieses
 * Abstands kommen in Frage, damit die Prüfung nicht quadratisch wird.
 */
export const MAX_GAP = 2.5; // m

/** Ab dieser Überlappungslänge sind zwei kollineare Wände ein Befund. */
const MIN_OVERLAP = 0.01; // m

/** Zulässiger Achsabstand, ab dem zwei parallele Wände als kollinear gelten. */
const COLLINEAR_TOLERANCE = 0.01; // m

export interface DiagnoseClosureInput {
  /** Wände *eines* Geschosses. Geschosse zu mischen erfände Lücken. */
  walls: Wall[];
  nodes: Record<string, BimNode>;
  weldTolerance?: number;
}

/**
 * Untersucht die Topologie eines Geschosses und benennt jede Stelle, an der
 * die Umschließung nicht schließt oder nur durch die Heilung geschlossen wird.
 *
 * Die Befunde sind nach Schwere sortiert: erst was einen Raum kostet
 * (`gap`, `open-end`), dann was im Modell offen bleibt, ohne einen Raum zu
 * kosten (`near-miss`, `off-axis`, `overlap`).
 */
export function diagnoseClosure(input: DiagnoseClosureInput): ClosureIssue[] {
  const { walls, nodes, weldTolerance = WELD_TOLERANCE } = input;
  if (walls.length === 0) return [];

  const notes: HealNotes = { welds: [], projections: [] };
  const { segments, clusters, degree } = healSegments(walls, nodes, weldTolerance, notes);
  if (segments.length === 0) return [];

  const issues: ClosureIssue[] = [];

  // --- 1. Lose Enden ------------------------------------------------------
  // Dieselbe Feststellung wie in `findOpenEnds`, hier aber mit dem Maß, das
  // dem Anwender die Suche abnimmt: wie weit ist die nächste Wand entfernt.
  for (let i = 0; i < clusters.length; i++) {
    if (degree[i] > 1) continue;
    const p = clusters[i];
    if (isOnForeignAxis(p, segments)) continue;
    let nearest = Infinity;
    let nearestWall = '';
    for (const s of segments) {
      if (almostSame(s.a, p) || almostSame(s.b, p)) continue;
      const d = distanceToSegment(p, s.a, s.b);
      if (d < nearest) {
        nearest = d;
        nearestWall = s.wall.id;
      }
    }
    const own = segments.find((s) => almostSame(s.a, p) || almostSame(s.b, p));
    issues.push({
      kind: 'open-end',
      position: { x: p.x, y: p.y },
      measure: Number.isFinite(nearest) ? nearest : 0,
      wallIds: [own?.wall.id ?? '', nearestWall].filter((id) => id !== ''),
      message: Number.isFinite(nearest)
        ? `Wandende bei ${fmt(p.x)} / ${fmt(p.y)} hat keinen Anschluss; die nächste Wand liegt ${cm(nearest)} entfernt.`
        : `Wandende bei ${fmt(p.x)} / ${fmt(p.y)} hat keinen Anschluss.`,
    });
  }

  // --- 2. Lücken in der Umschließung -------------------------------------
  const faces = traceFaces(graphFromSegments(segments));
  for (const face of faces) {
    if (face.signed >= 0) continue; // nur die unbeschränkten Facetten
    issues.push(...findGaps(face.polygon, segments));
  }

  // --- 3. Was die Heilung stillschweigend gerichtet hat -------------------
  for (const weld of notes.welds) {
    issues.push({
      kind: 'near-miss',
      position: weld.position,
      measure: weld.spread,
      wallIds: weld.wallIds,
      message:
        `Zwei Wandenden bei ${fmt(weld.position.x)} / ${fmt(weld.position.y)} liegen ${cm(weld.spread)} ` +
        `auseinander. Die Raumerkennung rechnet sie zusammen — im Modell bleibt die Fuge stehen.`,
    });
  }
  for (const pr of notes.projections) {
    issues.push({
      kind: 'off-axis',
      position: pr.position,
      measure: pr.offset,
      wallIds: [pr.wallId, pr.hostWallId],
      message:
        `Wandende bei ${fmt(pr.position.x)} / ${fmt(pr.position.y)} endet ${cm(pr.offset)} neben der Achse ` +
        `der Wand, auf die es stößt — der T-Stoß teilt sie nicht. Für die Raumerkennung wird es darauf gezogen.`,
    });
  }

  // --- 4. Kollineare Überlappungen ---------------------------------------
  issues.push(...findOverlaps(segments));

  const rank: Record<ClosureIssueKind, number> = {
    gap: 0,
    'open-end': 1,
    'off-axis': 2,
    'near-miss': 3,
    overlap: 4,
  };
  issues.sort((a, b) => rank[a.kind] - rank[b.kind] || a.position.x - b.position.x || a.position.y - b.position.y);
  return issues;
}

/** Liegt der Punkt exakt auf der Achse einer fremden Wand? */
function isOnForeignAxis(p: Vec2, segments: HealedSegment[]): boolean {
  for (const s of segments) {
    if (almostSame(s.a, p) || almostSame(s.b, p)) continue;
    const abx = s.b.x - s.a.x;
    const aby = s.b.y - s.a.y;
    const lenSq = abx * abx + aby * aby;
    if (lenSq < EPS) continue;
    const t = ((p.x - s.a.x) * abx + (p.y - s.a.y) * aby) / lenSq;
    if (t <= 0 || t >= 1) continue;
    if (Math.hypot(s.a.x + abx * t - p.x, s.a.y + aby * t - p.y) < 1e-6) return true;
  }
  return false;
}

/**
 * Sucht in einer unbeschränkten Facette die Stellen, an denen der Außenbereich
 * durch einen Engpass in den Grundriss greift.
 *
 * Der Umlauf einer unbeschränkten Facette ist im Uhrzeigersinn. Greift sie in
 * den Grundriss hinein, läuft sie dort *gegen* den Uhrzeigersinn um die
 * eingeschlossene Fläche — die Teilkette zwischen zwei Punkten der Facette hat
 * dann eine positive Fläche, und das ist genau der Raum, der fehlt. Eine
 * Sehne kommt nur in Frage, wenn sie keine Wand kreuzt und nicht selbst auf
 * einer liegt: sonst wäre sie keine fehlende Wand, sondern eine vorhandene.
 */
function findGaps(cycle: Vec2[], segments: HealedSegment[]): ClosureIssue[] {
  const n = cycle.length;
  if (n < 4) return [];

  // Laufende Summe der Kreuzprodukte. Damit kostet die Fläche jeder Teilkette
  // zwei Zugriffe statt einer Kopie — ohne das wäre die Suche kubisch.
  const prefix = new Float64Array(n);
  for (let k = 1; k < n; k++) {
    const a = cycle[k - 1];
    const b = cycle[k];
    prefix[k] = prefix[k - 1] + (a.x * b.y - b.x * a.y);
  }
  const chainArea = (i: number, j: number): number => {
    const p = cycle[i];
    const q = cycle[j];
    return (prefix[j] - prefix[i] + (q.x * p.y - p.x * q.y)) / 2;
  };

  interface Candidate {
    i: number;
    j: number;
    distance: number;
    area: number;
  }
  const candidates: Candidate[] = [];

  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // entlang der Kette benachbart
      const p = cycle[i];
      const q = cycle[j];
      const d = distance(p, q);
      if (d < 1e-3 || d > MAX_GAP) continue;

      // Die abgetrennte Fläche muss groß genug sein, um ein Raum zu sein —
      // sonst ist die Sehne ein Zwickel an einer Wandkreuzung.
      const area = chainArea(i, j);
      if (area <= MIN_ROOM_AREA) continue;

      if (chordBlocked(p, q, segments)) continue;
      candidates.push({ i, j, distance: d, area });
    }
  }

  // Eine Lücke lässt sich meist an mehreren Stellen schließen: am Engpass
  // selbst und überall dahinter. Gemeldet wird die Sehne, die am meisten
  // erklärt — sie trennt die größte Fläche ab. Alles, was innerhalb dieser
  // Fläche liegt, beschreibt danach dieselbe Lücke ein zweites Mal und
  // entfällt. Bei gleicher Fläche gewinnt die engere Stelle.
  candidates.sort((a, b) => b.area - a.area || a.distance - b.distance);
  const used = new Set<number>();
  const issues: ClosureIssue[] = [];
  for (const c of candidates) {
    if (used.has(c.i) || used.has(c.j)) continue;
    for (let k = c.i; k <= c.j; k++) used.add(k);
    const p = cycle[c.i];
    const q = cycle[c.j];
    const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    // Der Umriss der Fläche dahinter: die Teilkette der Facette von p bis q,
    // über die fehlende Wand geschlossen. Er wird mitgegeben, weil der Plan
    // ihn zeichnet — der Anwender soll nicht nur sehen, *dass* hier etwas
    // fehlt, sondern welchen Raum ihn das kostet. Die Punkte werden kopiert:
    // sie gehen ins Dokument und dürfen nicht auf die Facette zurückzeigen.
    const outline = cycle.slice(c.i, c.j + 1).map((v) => ({ x: v.x, y: v.y }));
    issues.push({
      kind: 'gap',
      position: mid,
      measure: c.distance,
      enclosedArea: c.area,
      ends: [{ x: p.x, y: p.y }, { x: q.x, y: q.y }],
      enclosedOutline: outline,
      // Die beiden Wände, deren Enden die Lücke einfassen. Sie sind nicht
      // die Ursache — die Ursache ist die Wand, die zwischen ihnen fehlt und
      // die es nicht gibt. Sie sind aber das Einzige, was man auswählen kann,
      // und liegen an der richtigen Stelle.
      wallIds: [...new Set([wallEndingAt(p, segments), wallEndingAt(q, segments)])].filter(
        (id): id is string => id !== undefined,
      ),
      message:
        `Zwischen den Wandenden bei ${fmt(p.x)} / ${fmt(p.y)} und ${fmt(q.x)} / ${fmt(q.y)} klafft eine ` +
        `Lücke von ${c.distance.toFixed(2)} m. Die Fläche dahinter (${c.area.toFixed(2)} m²) steht damit mit ` +
        `dem Außenbereich in Verbindung und wird nicht als Raum geführt.`,
    });
  }
  return issues;
}

/** Welche Wand endet an diesem Punkt? Für den Sprung aus dem Prüfbericht. */
function wallEndingAt(p: Vec2, segments: HealedSegment[]): string | undefined {
  for (const s of segments) {
    if (almostSame(s.a, p) || almostSame(s.b, p)) return s.wall.id;
  }
  return undefined;
}

/** Kreuzt die Sehne eine Wand oder liegt sie auf einer? Dann ist sie keine Lücke. */
function chordBlocked(p: Vec2, q: Vec2, segments: HealedSegment[]): boolean {
  const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
  for (const s of segments) {
    // Eine Sehne, die auf einer Wandachse liegt, verbindet zwei Punkte
    // derselben Wand — dort fehlt nichts.
    if (distanceToSegment(mid, s.a, s.b) < 1e-3) return true;
    if (segmentIntersection(p, q, s.a, s.b)) return true;
  }
  return false;
}

/**
 * Kollineare Wände, die einander überlagern.
 *
 * Für die Raumerkennung ist das harmlos — deckungsgleiche Kanten werden nur
 * einmal in den Graphen aufgenommen. Für alles danach nicht: die überlappende
 * Länge steht zweimal im Aufmaß, zweimal in der Hüllfläche und zweimal in der
 * Wärmebrückenbilanz. Und der Anwender sieht nur eine Wand.
 */
function findOverlaps(segments: HealedSegment[]): ClosureIssue[] {
  const issues: ClosureIssue[] = [];
  // Umschließende Rechtecke, um den Achsvergleich gar nicht erst zu führen:
  // Wände, die sich nicht einmal berühren, können nicht übereinanderliegen.
  const boxes = segments.map((s) => ({
    minX: Math.min(s.a.x, s.b.x) - COLLINEAR_TOLERANCE,
    maxX: Math.max(s.a.x, s.b.x) + COLLINEAR_TOLERANCE,
    minY: Math.min(s.a.y, s.b.y) - COLLINEAR_TOLERANCE,
    maxY: Math.max(s.a.y, s.b.y) + COLLINEAR_TOLERANCE,
  }));
  for (let i = 0; i < segments.length; i++) {
    const si = segments[i];
    const bi = boxes[i];
    const dir = normalize(sub(si.b, si.a));
    const lenI = distance(si.a, si.b);
    if (lenI < EPS) continue;
    for (let j = i + 1; j < segments.length; j++) {
      const bj = boxes[j];
      if (bi.maxX < bj.minX || bj.maxX < bi.minX) continue;
      if (bi.maxY < bj.minY || bj.maxY < bi.minY) continue;
      const sj = segments[j];
      // Beide Enden von j müssen nahe genug an der Achse von i liegen.
      const da = perpendicularOffset(sj.a, si.a, dir);
      const db = perpendicularOffset(sj.b, si.a, dir);
      if (Math.abs(da) > COLLINEAR_TOLERANCE || Math.abs(db) > COLLINEAR_TOLERANCE) continue;

      const ta = (sj.a.x - si.a.x) * dir.x + (sj.a.y - si.a.y) * dir.y;
      const tb = (sj.b.x - si.a.x) * dir.x + (sj.b.y - si.a.y) * dir.y;
      const lo = Math.max(0, Math.min(ta, tb));
      const hi = Math.min(lenI, Math.max(ta, tb));
      const overlap = hi - lo;
      if (overlap <= MIN_OVERLAP) continue;

      const mid = {
        x: si.a.x + dir.x * ((lo + hi) / 2),
        y: si.a.y + dir.y * ((lo + hi) / 2),
      };
      issues.push({
        kind: 'overlap',
        position: mid,
        measure: overlap,
        wallIds: [si.wall.id, sj.wall.id],
        message:
          `Zwei Wände liegen bei ${fmt(mid.x)} / ${fmt(mid.y)} auf ${overlap.toFixed(2)} m Länge übereinander. ` +
          `Aufmaß und Hüllfläche zählen diese Länge doppelt.`,
      });
    }
  }
  return issues;
}

/** Vorzeichenbehafteter Abstand eines Punktes von der Geraden (origin, dir). */
const perpendicularOffset = (p: Vec2, origin: Vec2, dir: Vec2): number =>
  (p.x - origin.x) * dir.y - (p.y - origin.y) * dir.x;

/** Koordinate für die Meldung — zwei Nachkommastellen reichen zum Wiederfinden. */
const fmt = (n: number): string => n.toFixed(2);

/**
 * Kleine Maße in Millimeter, große in Zentimeter.
 *
 * „0,003 m" liest niemand als drei Millimeter; genau um diese Größenordnung
 * geht es bei einer nicht geschlossenen Fuge aber meistens.
 */
const cm = (m: number): string =>
  m < 0.01 ? `${(m * 1000).toFixed(0)} mm` : m < 1 ? `${(m * 100).toFixed(1)} cm` : `${m.toFixed(2)} m`;
