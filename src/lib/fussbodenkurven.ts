/**
 * Die Verlegekurven eines Geschosses — einmal gerechnet, zweimal gezeichnet.
 * ---------------------------------------------------------------------------
 * **Warum es diese Datei gibt.** Die Kurve einer raumfüllenden
 * Fußbodenheizung entsteht aus dem Raumpolygon, dem Verlegeabstand, dem
 * Randabstand, den Einbauten, dem Mauerwerk und der Lage des Verteilers —
 * sechs Eingangsgrößen, die aus vier verschiedenen Ecken des Dokuments
 * kommen. Bis 1.28.2 stand diese Sammelarbeit im Grundriss-Editor, und zwar
 * nur dort: Das Modell zeigte den Estrich als glatte Platte, obwohl das
 * Programm genau wusste, wo jedes Rohr liegt.
 *
 * „Wenn Fußboden gelegt wird, möchte ich die Rohre sehen" — das ist eine
 * Frage an die Darstellung und nicht an den Rechenkern. Die Antwort darf
 * aber nicht sein, dass die Sammelarbeit ein zweites Mal geschrieben wird:
 * Zwei Fassungen derselben Regel laufen auseinander, und dann zeigt der Plan
 * eine andere Verlegung als das Modell. Wer beides nebeneinander sieht,
 * glaubt keiner von beiden mehr.
 *
 * Also steht sie hier, im Rechenkern, und Plan wie Modell fragen dieselbe
 * Funktion. Sie rechnet nichts Neues — `planFloorLoops` bleibt die eine
 * Stelle, an der eine Kurve entsteht. Sie beantwortet nur die Frage davor:
 * *welche* Räume haben eine, und mit welchen Eingangsgrößen.
 *
 * **Gespeichert wird weiterhin nichts.** Eine mitgespeicherte Kurve wäre
 * nach dem ersten Wandzug falsch, ohne dass es jemandem auffiele.
 */

import type { BimDocument, Fixture, LevelId, SolidElement, Vec2 } from '../types/bim';
import {
  DEFAULT_EDGE_CLEARANCE,
  DEFAULT_LOOP_PATTERN,
  DEFAULT_OBSTACLE_CLEARANCE,
  FLOOR_OBSTACLE_TYPES,
  fixtureFootprint,
  planFloorLoops,
  type FloorCircuit,
  type FloorLoopLayout,
} from './floorLoopLayout';
import { pointInPolygon } from './geometry';
import { solidFootprint } from './verticalSymbols';

export interface Verlegekurven {
  /** Die Heizfläche, zu der die Verlegung gehört. */
  fixture: Fixture;
  layout: FloorLoopLayout;
}

/**
 * Massive Bauteile, die in diesem Geschoss im Estrich stehen.
 *
 * Auch die, die nur hindurchlaufen: Ein Schornstein steht im Obergeschoss
 * genauso im Estrich wie im Erdgeschoss — er hört an der Decke nicht auf.
 */
function massiveImGeschoss(doc: BimDocument, levelId: LevelId): SolidElement[] {
  const rang = new Map(
    Object.values(doc.levels)
      .sort((a, b) => a.order - b.order)
      .map((l, i) => [l.id, i] as const),
  );
  const hier = rang.get(levelId);
  return Object.values(doc.solids ?? {}).filter((s) => {
    if (s.levelId === levelId) return true;
    if (!s.throughAllLevels) return false;
    const von = rang.get(s.levelId);
    return von !== undefined && hier !== undefined && hier > von;
  });
}

/**
 * Alle Verlegekurven eines Geschosses.
 *
 * Gerechnet wird nur für Heizflächen, die den Raum füllen
 * (`params.roomCoverage`) und einem erkannten Raum zugeordnet sind. Eine
 * Fußbodenheizung ohne Raum ist eine Angabe zur Leistung, keine Verlegung —
 * für sie eine Kurve zu erfinden hieße, eine Fläche zu behaupten.
 */
export function sammleVerlegekurven(doc: BimDocument, levelId: LevelId): Verlegekurven[] {
  const fixtures = Object.values(doc.fixtures).filter((f) => f.levelId === levelId);
  const verteiler = fixtures.find((f) => f.type === 'manifold');
  const massiv = massiveImGeschoss(doc, levelId);
  const out: Verlegekurven[] = [];

  for (const f of fixtures) {
    if (f.type !== 'underfloor' || f.params.roomCoverage !== true || !f.roomId) continue;
    const room = doc.rooms[f.roomId];
    if (!room || room.innerPolygon.length < 3) continue;

    const einbauten = fixtures
      .filter((o) => FLOOR_OBSTACLE_TYPES.has(o.type) && pointInPolygon(o.position, room.innerPolygon))
      .map((o) => fixtureFootprint(o));
    const mauerwerk = massiv
      .filter((s) => pointInPolygon(s.position, room.innerPolygon))
      .map((s) => solidFootprint(s));

    out.push({
      fixture: f,
      layout: planFloorLoops(room.innerPolygon, {
        spacing: f.params.loopSpacing ?? 0.15,
        loops: f.params.loopCount ?? 1,
        autoSplit: true,
        edgeClearance: f.params.loopEdgeClearance ?? DEFAULT_EDGE_CLEARANCE,
        obstacles: [...einbauten, ...mauerwerk],
        obstacleClearance: DEFAULT_OBSTACLE_CLEARANCE,
        pattern: f.params.loopPattern ?? DEFAULT_LOOP_PATTERN,
        manifold: verteiler?.position,
      }),
    });
  }
  return out;
}

/**
 * Was eine raumfüllende Fußbodenheizung an Material verlangt.
 *
 * **Warum es diese Bilanz gibt.** Die Verlegekurven wurden gerechnet, um sie
 * zu *zeichnen* — im Plan und im Modell. Ihre Längen gingen dabei nirgends
 * hin: Der Massenauszug kannte nur zwei Wege zu einer Rohrlänge, die
 * vollständige Auslegung im Anlagenblatt und die von Hand gepflegten Felder
 * „Kreiszahl × Kreislänge". Wer die Fußbodenheizung im Grundriss gelegt hatte
 * — der kürzeste und häufigste Weg —, bekam im Massenauszug die Zeile
 * „Bauart nach Objektangabe, nicht ausgelegt" mit dem Vermerk, dass Rohrlänge
 * und Randdämmstreifen fehlen. Für eine Bestellung ist das wertlos.
 *
 * Gerechnet wird hier **nichts Neues**: Dieselbe Kurve, dieselbe Funktion,
 * dieselben Zahlen wie im Bild. Nur zusammengezählt.
 */
export interface Verlegebilanz {
  roomId: string;
  raum: string;
  levelId: LevelId;
  /** Verlegeabstand [m]. */
  abstand: number;
  /** Zahl der Kreise. */
  kreise: number;
  /** Rohr in der Fläche [m] — nur die geraden Bahnen. */
  feldLaenge: number;
  /** Rohr insgesamt in der Fläche [m], einschließlich der Kehren. */
  flaechenLaenge: number;
  /** Rohr in den Anbindeleitungen zum Verteiler [m]; 0 ohne Verteiler. */
  anbindung: number;
  /** Rohr zusammen [m] = Fläche + Anbindung. */
  gesamtLaenge: number;
  /** Belegte Fläche [m²] — nach Randabstand und Einbauten. */
  belegteFlaeche: number;
  /** Lichte Grundfläche des Raums [m²]. */
  raumFlaeche: number;
  /** Umfang des Raums [m] — das Maß für den Randdämmstreifen. */
  umfang: number;
  /** Hing die Verlegung an einem Verteiler? */
  amVerteiler: boolean;
  /** Ließ sich jeder Kreis als ein Zug legen? */
  vollstaendig: boolean;
  /** Die Kreise einzeln (seit 1.77.0). */
  kreisListe: FloorCircuit[];
  /** Angeforderte Kreiszahl, wenn wegen der Länge geteilt wurde (seit 1.77.0). */
  geteiltVon?: number;
  /** Größte Kreislänge, gegen die geteilt wurde [m]. */
  maxKreislaenge: number;
}

/** Umfang eines geschlossenen Polygonzugs [m]. */
function umfangVon(punkte: readonly Vec2[]): number {
  let u = 0;
  for (let i = 0; i < punkte.length; i++) {
    const a = punkte[i];
    const b = punkte[(i + 1) % punkte.length];
    u += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return u;
}

/**
 * Die Bilanz je Raum — für ein Geschoss oder, ohne Angabe, für das ganze Haus.
 *
 * Über alle Geschosse zu rechnen ist der Regelfall: Bestellt wird für das
 * Gebäude, nicht für die Etage, die gerade auf dem Bildschirm steht. Genau
 * dieser Unterschied war in der Auslegung der Grund dafür, dass die
 * Steigleitung fehlte (1.43.0).
 */
export function verlegebilanz(doc: BimDocument, levelId?: LevelId): Verlegebilanz[] {
  const geschosse = levelId ? [levelId] : Object.keys(doc.levels);
  const raus: Verlegebilanz[] = [];
  for (const g of geschosse) {
    for (const k of sammleVerlegekurven(doc, g)) {
      const room = k.fixture.roomId ? doc.rooms[k.fixture.roomId] : undefined;
      if (!room) continue;
      raus.push({
        roomId: room.id,
        raum: room.name,
        levelId: g,
        abstand: k.layout.spacing,
        kreise: k.layout.loops,
        feldLaenge: k.layout.fieldLength,
        flaechenLaenge: k.layout.totalLength,
        anbindung: k.layout.supplyLength,
        gesamtLaenge: k.layout.totalLength + k.layout.supplyLength,
        belegteFlaeche: k.layout.layableArea,
        raumFlaeche: k.layout.grossArea,
        umfang: umfangVon(room.innerPolygon),
        amVerteiler: k.layout.manifoldConnected,
        vollstaendig: k.layout.complete,
        kreisListe: k.layout.circuits,
        ...(k.layout.splitFrom !== undefined ? { geteiltVon: k.layout.splitFrom } : {}),
        maxKreislaenge: k.layout.maxCircuitLength,
      });
    }
  }
  return raus;
}

/** Summen über eine Bilanz — was in eine Bestellung geht. */
export interface Verlegesumme {
  raeume: number;
  kreise: number;
  /** Rohr zusammen [m], einschließlich Anbindeleitungen. */
  rohr: number;
  /** Rohr nur in der Fläche [m]. */
  rohrFlaeche: number;
  /** Rohr nur in den Anbindungen [m]. */
  rohrAnbindung: number;
  belegteFlaeche: number;
  /** Randdämmstreifen [m] — Summe der Raumumfänge. */
  randstreifen: number;
  /** Kreise je Verlegeabstand [m] — getrennt, weil getrennt bestellt wird. */
  kreiseJeAbstand: Map<number, number>;
  /** Räume ohne Verteileranbindung — dort fehlt die Anbindelänge. */
  ohneVerteiler: string[];
}

export function verlegesumme(bilanz: readonly Verlegebilanz[]): Verlegesumme {
  const kreiseJeAbstand = new Map<number, number>();
  for (const b of bilanz) {
    kreiseJeAbstand.set(b.abstand, (kreiseJeAbstand.get(b.abstand) ?? 0) + b.kreise);
  }
  return {
    raeume: bilanz.length,
    kreise: bilanz.reduce((s, b) => s + b.kreise, 0),
    rohr: bilanz.reduce((s, b) => s + b.gesamtLaenge, 0),
    rohrFlaeche: bilanz.reduce((s, b) => s + b.flaechenLaenge, 0),
    rohrAnbindung: bilanz.reduce((s, b) => s + b.anbindung, 0),
    belegteFlaeche: bilanz.reduce((s, b) => s + b.belegteFlaeche, 0),
    randstreifen: bilanz.reduce((s, b) => s + b.umfang, 0),
    kreiseJeAbstand,
    ohneVerteiler: bilanz.filter((b) => !b.amVerteiler).map((b) => b.raum),
  };
}

/**
 * Die Verlegekurven als reine Linienzüge — für das Modell.
 *
 * Anbindeleitungen sind dabei, denn im Modell sind sie zu sehen: Sie laufen
 * vom Verteiler zur ersten Windung und liegen genau wie das übrige Rohr im
 * Estrich. Sie tragen `anbindung: true`, damit sie sich zeichnerisch
 * unterscheiden lassen — sie sind die kürzeste Verbindung und nicht die
 * verlegte Trasse (siehe `FloorSupplyLine`), und das darf ein Modell nicht
 * als gesicherte Lage darstellen.
 */
export interface Verlegelinie {
  punkte: readonly Vec2[];
  anbindung: boolean;
}

export function verlegelinien(kurven: readonly Verlegekurven[]): Verlegelinie[] {
  const out: Verlegelinie[] = [];
  for (const k of kurven) {
    for (const c of k.layout.curves) {
      if (c.points.length >= 2) out.push({ punkte: c.points, anbindung: false });
    }
    for (const s of k.layout.supplyLines) {
      if (s.points.length >= 2) out.push({ punkte: s.points, anbindung: true });
    }
  }
  return out;
}
