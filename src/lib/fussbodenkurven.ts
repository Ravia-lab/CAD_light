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
