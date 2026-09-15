/**
 * Rohrnetz als Strangschema.
 * ---------------------------------------------------------------------------
 * Bisher waren verlegte Leitungen eine Liste von Polylinien: gut für den
 * Längenauszug, wertlos für alles andere. Für den hydraulischen Abgleich
 * zählt aber nicht die Summe der Meter, sondern **welcher Verbraucher wie
 * weit von seiner Quelle entfernt hängt** — der ungünstigste Strang bestimmt
 * die Pumpe, und jeder Voreinstellwert folgt aus der Länge und der Nennweite
 * bis dorthin.
 *
 * Diese Angaben stecken bereits in der Zeichnung. Sie müssen nur als Graph
 * gelesen werden statt als Striche:
 *
 *   1. Alle Stützpunkte aller Leitungen werden zu Knoten verschmolzen, wenn
 *      sie näher als 6 cm beieinander liegen. Beim Zeichnen wird gefangen,
 *      exakt gleiche Koordinaten sind trotzdem die Ausnahme.
 *   2. Steigstränge verbinden Geschosse: liegt in zwei Geschossen ein
 *      Steigstrang-Symbol übereinander, ist es dieselbe Leitung. Ohne diesen
 *      Schritt endete jeder Strang an der Geschossdecke.
 *   3. Von allen Quellen (Verteiler, Erzeuger, Lüftungsgerät) läuft ein
 *      Dijkstra gleichzeitig los. Jeder Verbraucher bekommt damit seine
 *      nächstgelegene Quelle und den Weg dorthin — Länge, Nennweitenfolge,
 *      Dämmung, Höhenversatz.
 *
 * **Gerechnet wird auch hier nichts.** Druckverluste, Ventilvoreinstellungen
 * und Pumpenauslegung entstehen in RaVia. Dieses Modul liefert die Geometrie,
 * die dafür nötig ist — und die Liste derer, die gar nicht angeschlossen sind.
 */

import type {
  BimDocument,
  Fixture,
  PipeAccessory,
  PipeAccessoryKind,
  PipeMaterial,
  PipeNetworkReport,
  PipePath,
  PipeRun,
  PipeSegment,
  PipeService,
  Vec2,
} from '../types/bim';
import { hoeheAnPunkt, hoehenversatz, trassenlaenge } from './rohrlaenge';

export type { PipeNetworkReport, PipePath, PipeSegment };

/** Zwei Stützpunkte gelten als derselbe Knoten. */
const WELD = 0.06;
/** Ein Objekt ohne ausdrückliche Anbindung wird bis hierher zugeordnet. */
const ATTACH = 0.3;
/** Steigstränge übereinander gelten als verbunden. */
const RISER_ALIGN = 0.35;

/**
 * Objekte, von denen ein Netz ausgeht.
 *
 * Der Speicher gehört dazu, und das ist keine Feinheit. Bei einer
 * Wärmepumpe steht der Erzeuger draußen; im Haus beginnt das Heizungsnetz
 * am Puffer oder am Trinkwasserspeicher. Wer ihn hier nicht als Quelle
 * führt, bekommt bei einer vollständig erfassten Anlage den Befund, es
 * gebe keinen Erzeuger — und das ist schlicht falsch.
 */
const SOURCES: Partial<Record<string, PipeService>> = {
  manifold: 'heating-flow',
  boiler: 'heating-flow',
  storage: 'heating-flow',
  'water-heater': 'hot-water',
  ahu: 'ventilation-supply',
};

/** Objekte, die versorgt werden wollen. */
const CONSUMERS = new Set([
  'radiator',
  'radiator-tube',
  'convector',
  'underfloor',
  'wc',
  'washbasin',
  'shower',
  'bathtub',
  'sink',
  'air-supply',
  'air-exhaust',
]);

const RISERS = new Set(['riser-heating', 'riser-sanitary']);

// ---------------------------------------------------------------------------
// Graph
// ---------------------------------------------------------------------------

interface GraphNode {
  id: number;
  point: Vec2;
  /**
   * Verlegehöhe des Knotens über Fertigfußboden [m].
   *
   * **Warum ein Knoten eine Höhe braucht.** Ohne sie ist das Netz ein
   * Grundriss, und ein Fallstrang in der Zimmerecke ist darin ein Punkt:
   * Anfang und Ende liegen im Grundriss zwei Zentimeter auseinander, also
   * innerhalb des Fangabstands, werden verschmolzen — und die Kante zwischen
   * ihnen ist danach eine Schleife auf sich selbst, die `connect` verwirft.
   * Der Strang verschwand damit **vollständig** aus dem Rohrnetz: keine
   * Teilstrecke, keine Länge, kein Druckverlust, und der Heizkörper dahinter
   * galt als angeschlossen und widerstandsfrei. Gemessen: bis 5,9 cm Trasse
   * war er weg, ab 6,1 cm stand er mit 2,40 m im Bericht.
   *
   * Derselbe Massenauszug führte ihn die ganze Zeit richtig. Zwei Berichte
   * aus einem Modell, und der eine hätte die Pumpe zu klein gewählt.
   */
  hoehe: number;
  levelId: string;
  fixtures: string[];
}

interface GraphEdge {
  to: number;
  length: number;
  runId: string;
  nominalDiameter: number;
  insulation: number;
  service: PipeService;
  /** Werkstoff der Leitung, falls am Modell hinterlegt. */
  material?: PipeMaterial;
  /** Außendurchmesser [mm], falls am Modell hinterlegt. */
  outerDiameter?: number;
  /** Armaturen, die auf diesem Abschnitt sitzen. */
  accessories: PipeAccessoryKind[];
}

/**
 * Fangabstand einer Armatur zu ihrem Abschnitt [m].
 *
 * Eine Armatur trägt eine `runId`, aber keine Angabe, an welcher Stelle der
 * Leitung sie sitzt. Sie wird deshalb dem Abschnitt zugeordnet, dessen Achse
 * ihr am nächsten liegt — mit einer Schranke, damit ein Ventil an einer
 * langen Leitung nicht einem Abschnitt am anderen Ende zufällt.
 */
const ACCESSORY_SNAP = 0.4;

/** Abstand eines Punktes zu einer Strecke [m]. */
function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const q = dx * dx + dy * dy;
  if (q < 1e-9) return dist(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / q;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

class Graph {
  nodes: GraphNode[] = [];
  edges = new Map<number, GraphEdge[]>();
  /**
   * Rasterhash statt linearer Suche. Jeder Stützpunkt muss beim Anlegen mit
   * den vorhandenen verglichen werden; über alle Punkte hinweg wäre das ein
   * Quadrat. Bei einer Zellengröße von einem Zentimeter über dem Fangabstand
   * genügt es, die neun Zellen um den Punkt herum anzusehen.
   */
  private cells = new Map<string, GraphNode[]>();

  private static cellKey(levelId: string, cx: number, cy: number): string {
    return `${levelId}|${cx}|${cy}`;
  }

  /** Knoten an dieser Stelle finden oder anlegen. */
  node(point: Vec2, levelId: string, hoehe = 0): GraphNode {
    const cx = Math.floor(point.x / WELD);
    const cy = Math.floor(point.y / WELD);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = this.cells.get(Graph.cellKey(levelId, cx + dx, cy + dy));
        if (!bucket) continue;
        /*
         * Verschmolzen wird nur, was im Grundriss **und** in der Höhe
         * zusammenfällt. Der Rasterhash bleibt zweidimensional — Knoten an
         * derselben Stelle in verschiedenen Höhen liegen also im selben
         * Eimer und werden hier auseinandergehalten, statt das Raster
         * dreidimensional zu machen. Das ist billiger und ändert am
         * Verhalten aller waagerechten Leitungen nichts.
         */
        for (const n of bucket) {
          if (dist(n.point, point) <= WELD && Math.abs(n.hoehe - hoehe) <= WELD) return n;
        }
      }
    }
    const n: GraphNode = { id: this.nodes.length, point, hoehe, levelId, fixtures: [] };
    this.nodes.push(n);
    this.edges.set(n.id, []);
    const key = Graph.cellKey(levelId, cx, cy);
    const bucket = this.cells.get(key);
    if (bucket) bucket.push(n);
    else this.cells.set(key, [n]);
    return n;
  }

  /** Nächstgelegener Knoten innerhalb des Radius — über denselben Rasterhash. */
  nearest(point: Vec2, levelId: string, radius: number): GraphNode | undefined {
    const span = Math.ceil(radius / WELD);
    const cx = Math.floor(point.x / WELD);
    const cy = Math.floor(point.y / WELD);
    let best: GraphNode | undefined;
    let bestDistance = radius;
    for (let dx = -span; dx <= span; dx++) {
      for (let dy = -span; dy <= span; dy++) {
        const bucket = this.cells.get(Graph.cellKey(levelId, cx + dx, cy + dy));
        if (!bucket) continue;
        for (const n of bucket) {
          const d = dist(n.point, point);
          if (d <= bestDistance) {
            best = n;
            bestDistance = d;
          }
        }
      }
    }
    return best;
  }

  connect(a: GraphNode, b: GraphNode, edge: Omit<GraphEdge, 'to'>): void {
    if (a.id === b.id) return;
    this.edges.get(a.id)!.push({ ...edge, to: b.id });
    this.edges.get(b.id)!.push({ ...edge, to: a.id });
  }
}

/**
 * Baut den Graphen aus Leitungen, Objektanbindungen und Steigsträngen.
 * Getrennt von der Auswertung, damit sich die Verschmelzungsregeln prüfen
 * lassen, ohne einen ganzen Export zu bauen.
 */
function buildGraph(doc: BimDocument): { graph: Graph; risers: number } {
  const graph = new Graph();
  const runs = Object.values(doc.pipes ?? {});
  const fixtures = Object.values(doc.fixtures);

  // --- Leitungen ----------------------------------------------------------
  const ends = new Map<string, { first: GraphNode; last: GraphNode }>();
  // Armaturen nach Leitung vorsortieren — sonst wird die Zuordnung quadratisch.
  const armaturenJeLeitung = new Map<string, PipeAccessory[]>();
  for (const a of Object.values(doc.pipeAccessories ?? {})) {
    if (!a.runId) continue;
    const liste = armaturenJeLeitung.get(a.runId) ?? [];
    liste.push(a);
    armaturenJeLeitung.set(a.runId, liste);
  }

  for (const run of runs) {
    if (run.points.length < 2) continue;
    let previous = graph.node(run.points[0], run.levelId, hoeheAnPunkt(run, 0));
    const first = previous;
    const armaturen = armaturenJeLeitung.get(run.id) ?? [];
    for (let i = 1; i < run.points.length; i++) {
      const current = graph.node(run.points[i], run.levelId, hoeheAnPunkt(run, i));
      // Armaturen, deren nächster Abschnitt genau dieser ist.
      const aufAbschnitt: PipeAccessoryKind[] = [];
      for (const armatur of armaturen) {
        const d = distToSegment(armatur.position, run.points[i - 1], run.points[i]);
        if (d > ACCESSORY_SNAP) continue;
        let naeher = false;
        for (let j = 1; j < run.points.length; j++) {
          if (j === i) continue;
          if (distToSegment(armatur.position, run.points[j - 1], run.points[j]) < d - 1e-6) {
            naeher = true;
            break;
          }
        }
        if (!naeher) aufAbschnitt.push(armatur.kind);
      }
      graph.connect(previous, current, {
        material: run.material,
        outerDiameter: run.outerDiameter,
        accessories: aufAbschnitt,
        // Gemessen wird an den *gezeichneten* Punkten, nicht an den
        // verschmolzenen Knoten. Sonst wichen Strangschema und Längenauszug
        // um genau den Fangabstand voneinander ab — zwei Zahlen im selben
        // Dokument, die sich widersprechen.
        /*
         * **Der senkrechte Anteil gehört in die Teilstreckenlänge.**
         *
         * Bis 1.23.0 stand hier die reine Grundrisslänge. Ein Abschnitt mit
         * Höhenversatz — der Vorlauf, der unter die Decke steigt, der
         * Fallstrang in der Zimmerecke — ging damit mit einer zu kurzen
         * Länge in den Druckverlust ein; ein reiner Strang sogar mit **null**.
         * Der Rohrnetzbericht wies die Teilstrecke dann als widerstandsfrei
         * aus, die Pumpe wurde zu klein gewählt, und im Längenauszug fehlten
         * dieselben Meter ein zweites Mal.
         *
         * Die Steigung verteilt sich gleichmäßig über die Trasse (so ist
         * `elevationTo` definiert), also trägt jede Teilstrecke ihren Anteil
         * am Höhenversatz — im selben Verhältnis, in dem sie an der Trasse
         * beteiligt ist. Bei einem reinen Strang (Trassenlänge null) fällt
         * der ganze Versatz auf die eine Teilstrecke, die es dann gibt.
         */
        length: teilstreckenlaenge(run, i),
        runId: run.id,
        nominalDiameter: run.nominalDiameter,
        insulation: run.insulation,
        service: run.service,
      });
      previous = current;
    }
    ends.set(run.id, { first, last: previous });
  }

  // --- Objekte anbinden ---------------------------------------------------
  // Zuerst die ausdrücklichen Anbindungen aus dem Zeichnen; sie sind eine
  // Aussage des Planers und dürfen nicht von einer Näherung überstimmt werden.
  const attached = new Set<string>();
  for (const run of runs) {
    const e = ends.get(run.id);
    if (!e) continue;
    if (run.fromFixtureId) {
      e.first.fixtures.push(run.fromFixtureId);
      attached.add(run.fromFixtureId);
    }
    if (run.toFixtureId) {
      e.last.fixtures.push(run.toFixtureId);
      attached.add(run.toFixtureId);
    }
  }
  // Was danach übrig bleibt, wird über die Nähe zugeordnet — ein Symbol, das
  // sichtbar an der Leitung klebt, ist angeschlossen, auch wenn beim Zeichnen
  // nicht gefangen wurde.
  for (const f of fixtures) {
    if (attached.has(f.id)) continue;
    if (!CONSUMERS.has(f.type) && !SOURCES[f.type] && !RISERS.has(f.type)) continue;
    const best = graph.nearest(f.position, f.levelId, ATTACH);
    if (best) best.fixtures.push(f.id);
  }

  // --- Steigstränge über Geschosse ---------------------------------------
  let risers = 0;
  const riserFixtures = fixtures.filter((f) => RISERS.has(f.type));
  for (let i = 0; i < riserFixtures.length; i++) {
    for (let j = i + 1; j < riserFixtures.length; j++) {
      const a = riserFixtures[i];
      const b = riserFixtures[j];
      if (a.levelId === b.levelId) continue;
      if (dist(a.position, b.position) > RISER_ALIGN) continue;
      const na = graph.nodes.find((n) => n.fixtures.includes(a.id));
      const nb = graph.nodes.find((n) => n.fixtures.includes(b.id));
      if (!na || !nb) continue;
      const ea = doc.levels[a.levelId]?.elevation ?? 0;
      const eb = doc.levels[b.levelId]?.elevation ?? 0;
      graph.connect(na, nb, {
        length: Math.abs(eb - ea),
        runId: `riser-${a.id}-${b.id}`,
        nominalDiameter: Math.min(
          riserDiameter(doc, a) ?? 25,
          riserDiameter(doc, b) ?? 25,
        ),
        insulation: 0,
        service: a.type === 'riser-sanitary' ? 'hot-water' : 'heating-flow',
        accessories: [],
      });
      risers++;
    }
  }

  return { graph, risers };
}

/**
 * Richtungswechsel entlang eines Wegs zählen.
 *
 * **Warum das hier steht und nicht an der Leitung.** Ein Bogen entsteht dort,
 * wo das Wasser die Richtung wechselt — und das ist eine Eigenschaft des
 * *Fließwegs*, nicht der gezeichneten Polylinie. Der Rohrausleger legt jede
 * Trassenstrecke als eigene Leitung mit genau zwei Stützpunkten an; zählte man
 * nur innere Stützpunkte, hätte ein Netz mit zehn Richtungswechseln null
 * Bögen. Genau dieser Fehler hat 1.12.0 vor dieser Fassung günstiger rechnen
 * lassen als 1.11.0, obwohl mehr Physik im Spiel war.
 *
 * Die Schranke von 15° trennt den Bogen vom Zeichenrauschen: ein
 * millimeterweise versetzter Stützpunkt auf einer geraden Strecke schließt
 * einen Winkel von Bruchteilen eines Grades ein und ist kein Formstück.
 *
 * Ein Steigstrang bekommt zwei Bögen — unten aus der Waagerechten in die
 * Senkrechte, oben zurück. Seine beiden Knoten liegen im Grundriss
 * übereinander; aus ihrer Lage ließe sich keine Richtung ableiten.
 */
function zaehleBoegen(
  graph: Graph,
  kette: readonly { from: number; to: number; riser: boolean }[],
  segments: PipeSegment[],
): void {
  const SCHRANKE = Math.cos((15 * Math.PI) / 180);
  const richtung = (i: number): Vec2 | undefined => {
    const glied = kette[i];
    if (!glied || glied.riser) return undefined;
    const a = graph.nodes[glied.from];
    const b = graph.nodes[glied.to];
    if (!a || !b) return undefined;
    const dx = b.point.x - a.point.x;
    const dy = b.point.y - a.point.y;
    const l = Math.hypot(dx, dy);
    if (l < 1e-6) return undefined;
    return { x: dx / l, y: dy / l };
  };

  for (let i = 0; i < segments.length; i++) {
    if (kette[i]?.riser) {
      segments[i].bends = 2;
      continue;
    }
    // Der erste Abschnitt hat keinen Vorgänger — dort ist ein Anschluss, kein
    // Bogen. Der Anschluss selbst steckt im Verbraucherwiderstand.
    if (i === 0) {
      segments[i].bends = 0;
      continue;
    }
    const vor = richtung(i - 1);
    const jetzt = richtung(i);
    if (!vor || !jetzt) {
      // Vor oder nach einem Steigstrang wechselt die Richtung zwangsläufig;
      // der Bogen ist dort aber schon dem Steigstrang zugeschlagen.
      segments[i].bends = 0;
      continue;
    }
    segments[i].bends = vor.x * jetzt.x + vor.y * jetzt.y < SCHRANKE ? 1 : 0;
  }
}

/** Nennweite der Leitungen, die an diesem Steigstrang hängen. */
function riserDiameter(doc: BimDocument, fixture: Fixture): number | undefined {
  const runs = Object.values(doc.pipes ?? {}).filter(
    (r) => r.fromFixtureId === fixture.id || r.toFixtureId === fixture.id,
  );
  if (!runs.length) return undefined;
  return Math.min(...runs.map((r) => r.nominalDiameter));
}

// ---------------------------------------------------------------------------
// Auswertung
// ---------------------------------------------------------------------------

/**
 * Kleiner Binärheap für den Dijkstra.
 *
 * Eine lineare Suche nach dem kleinsten Eintrag reicht für ein Einfamilienhaus
 * und wird bei einer Wohnanlage zum Quadrat: 2.000 Knoten sind vier Millionen
 * Vergleiche, jedes Mal, wenn die Modellprüfung läuft — und die läuft bei
 * jeder Änderung.
 */
class MinHeap {
  private items: { node: number; distance: number }[] = [];

  get size(): number {
    return this.items.length;
  }

  push(node: number, distance: number): void {
    const items = this.items;
    items.push({ node, distance });
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (items[parent].distance <= items[i].distance) break;
      [items[parent], items[i]] = [items[i], items[parent]];
      i = parent;
    }
  }

  pop(): { node: number; distance: number } | undefined {
    const items = this.items;
    if (!items.length) return undefined;
    const top = items[0];
    const last = items.pop()!;
    if (!items.length) return top;
    items[0] = last;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let smallest = i;
      if (l < items.length && items[l].distance < items[smallest].distance) smallest = l;
      if (r < items.length && items[r].distance < items[smallest].distance) smallest = r;
      if (smallest === i) break;
      [items[smallest], items[i]] = [items[i], items[smallest]];
      i = smallest;
    }
    return top;
  }
}

interface Visit {
  distance: number;
  from?: number;
  edge?: GraphEdge;
  source: string;
}

/**
 * Mehrquellen-Dijkstra: alle Quellen starten gleichzeitig bei 0. Jeder Knoten
 * bekommt dadurch die *nächstgelegene* Quelle — genau die Zuordnung, die ein
 * Installateur auch treffen würde.
 */
function shortestPaths(graph: Graph, sourceNodes: { node: number; fixtureId: string }[]): Map<number, Visit> {
  const best = new Map<number, Visit>();
  const queue = new MinHeap();

  for (const s of sourceNodes) {
    const known = best.get(s.node);
    if (known && known.distance <= 0) continue;
    best.set(s.node, { distance: 0, source: s.fixtureId });
    queue.push(s.node, 0);
  }

  while (queue.size) {
    const { node, distance } = queue.pop()!;
    const current = best.get(node);
    if (!current || distance > current.distance + 1e-9) continue;

    for (const edge of graph.edges.get(node) ?? []) {
      const next = distance + edge.length;
      const known = best.get(edge.to);
      if (known && known.distance <= next + 1e-9) continue;
      best.set(edge.to, { distance: next, from: node, edge, source: current.source });
      queue.push(edge.to, next);
    }
  }
  return best;
}


/**
 * Die wahre Länge der Teilstrecke zwischen Stützpunkt `i-1` und `i` [m].
 *
 * Getrennt von `rohrlaenge` (die den ganzen Abschnitt misst), weil das
 * Rohrnetz je Teilstrecke rechnet: Reynoldszahl, λ und Δp hängen an der
 * einzelnen Strecke, nicht an der Summe.
 */
function teilstreckenlaenge(run: PipeRun, i: number): number {
  const eben = dist(run.points[i - 1], run.points[i]);
  const dh = hoehenversatz(run);
  if (dh === 0) return eben;
  const gesamt = trassenlaenge(run.points);
  // Reiner Strang: keine Trasse, also fällt der ganze Versatz auf die eine
  // Teilstrecke. Ohne diesen Zweig teilte man durch null.
  if (gesamt <= 0) return Math.abs(dh);
  return Math.hypot(eben, (dh * eben) / gesamt);
}


export function buildPipeNetwork(doc: BimDocument): PipeNetworkReport {
  const fixtures = Object.values(doc.fixtures);
  const byId = new Map(fixtures.map((f) => [f.id, f]));
  const { graph, risers } = buildGraph(doc);

  const nodeOf = new Map<string, number>();
  for (const n of graph.nodes) for (const id of n.fixtures) nodeOf.set(id, n.id);

  const sourceFixtures = fixtures.filter((f) => SOURCES[f.type] && nodeOf.has(f.id));
  const visits = shortestPaths(
    graph,
    sourceFixtures.map((f) => ({ node: nodeOf.get(f.id)!, fixtureId: f.id })),
  );

  const label = (f: Fixture): string => f.label ?? f.type;
  const paths: PipePath[] = [];
  const unconnected: PipeNetworkReport['unconnected'] = [];

  for (const f of fixtures) {
    if (!CONSUMERS.has(f.type)) continue;
    const node = nodeOf.get(f.id);
    if (node === undefined) {
      unconnected.push({
        fixtureId: f.id,
        label: label(f),
        levelId: f.levelId,
        reason: 'keine Leitung angeschlossen',
      });
      continue;
    }
    const visit = visits.get(node);
    if (!visit) {
      unconnected.push({
        fixtureId: f.id,
        label: label(f),
        levelId: f.levelId,
        reason: sourceFixtures.length ? 'kein Weg zu einer Quelle' : 'keine Quelle im Modell',
      });
      continue;
    }

    // Weg rückwärts abrollen und dann umdrehen — von der Quelle zum
    // Verbraucher gelesen ist die Nennweitenfolge das, was man erwartet:
    // vorne dick, hinten dünn.
    const segments: PipeSegment[] = [];
    /** Knotenkette des Wegs, in derselben Reihenfolge wie `segments`. */
    const kette: { from: number; to: number; riser: boolean }[] = [];
    let cursor: number | undefined = node;
    let guard = 0;
    while (cursor !== undefined && guard++ < 10000) {
      const step: Visit | undefined = visits.get(cursor);
      if (!step?.edge || step.from === undefined) break;
      segments.push({
        runId: step.edge.runId,
        length: round(step.edge.length),
        nominalDiameter: step.edge.nominalDiameter,
        insulation: step.edge.insulation,
        service: step.edge.service,
        material: step.edge.material,
        outerDiameter: step.edge.outerDiameter,
        accessories: step.edge.accessories.length ? [...step.edge.accessories] : undefined,
      });
      kette.push({ from: step.from, to: cursor, riser: step.edge.runId.startsWith('riser-') });
      cursor = step.from;
    }
    segments.reverse();
    kette.reverse();
    zaehleBoegen(graph, kette, segments);

    const source = byId.get(visit.source);
    const elevation =
      (doc.levels[f.levelId]?.elevation ?? 0) +
      f.elevation -
      ((source ? doc.levels[source.levelId]?.elevation ?? 0 : 0) + (source?.elevation ?? 0));

    paths.push({
      fixtureId: f.id,
      fixtureType: f.type,
      label: label(f),
      roomId: f.roomId,
      levelId: f.levelId,
      sourceFixtureId: visit.source,
      sourceLabel: source ? label(source) : visit.source,
      routeLength: round(visit.distance),
      circuitLength: round(2 * visit.distance),
      elevationChange: round(elevation),
      minimumDiameter: segments.length
        ? Math.min(...segments.map((s) => s.nominalDiameter))
        : 0,
      segments,
    });
  }

  paths.sort((a, b) => b.circuitLength - a.circuitLength);

  return {
    paths,
    unconnected,
    sources: sourceFixtures.map((f) => ({
      fixtureId: f.id,
      label: label(f),
      levelId: f.levelId,
      consumers: paths.filter((p) => p.sourceFixtureId === f.id).length,
    })),
    worstPath: paths.length
      ? { fixtureId: paths[0].fixtureId, label: paths[0].label, circuitLength: paths[0].circuitLength }
      : undefined,
    risers,
  };
}

const round = (v: number): number => Math.round(v * 100) / 100;
