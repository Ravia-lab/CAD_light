/**
 * Wohin ein Heizkörper kommt, wenn nur seine Leistung erfasst wird.
 * ---------------------------------------------------------------------------
 * **Wozu das gebraucht wird.** Im Raumbuch steht je Raum eine Zeile mit
 * Fläche und Heizleistung. Wer ein Gebäude aufnimmt, weiß die Leistung —
 * „Wohnzimmer, 1400 Watt" — und will sie dort eintragen, wo er sie abliest,
 * statt für jeden Raum ins Zeichenblatt zu wechseln, das Werkzeug zu suchen
 * und an die richtige Wand zu tippen. Für die Heizlastübergabe ist der
 * **Ort** des Heizkörpers ohnehin nachrangig: In die Rechnung geht seine
 * Leistung ein, nicht seine Stelle im Raum.
 *
 * Nachrangig heißt aber nicht beliebig. Ein Heizkörper, der in der Raummitte
 * schwebt, ist im Plan falsch, wandert bei der Rohrnetzauslegung an die
 * falsche Stelle und sieht in der 3D-Ansicht nach einem Fehler aus. Deshalb
 * setzt ihn dieses Modul dorthin, wo er in einem Bestandsgebäude fast immer
 * hängt:
 *
 *   1. **unter das breiteste Fenster** des Raums — die Regel, nach der seit
 *      hundert Jahren gebaut wird: der Kaltluftabfall am Glas wird dort
 *      abgefangen, wo er entsteht;
 *   2. sonst an die **längste Außenwand** des Raums, mittig;
 *   3. sonst in die **Raummitte** — dann gibt es keine Außenwand, und das ist
 *      eher ein Innenraum als ein Irrtum.
 *
 * Welcher Fall zutraf, wird mitgegeben und in der Oberfläche gesagt. Eine
 * gesetzte Stelle, die niemand genannt hat, wäre eine stille Annahme — und
 * genau die soll dieses Programm nicht machen.
 *
 * Schichtgrenze: nur Typen und andere lib-Bausteine.
 */

import type { BimNode, Opening, Room, Vec2, Wall } from '../types/bim';
import { pointInPolygon } from './geometry';
import { getWallGeometry, openingSpan, wallLocalToWorld } from './wallGeometry';

export interface Heizkoerperplatz {
  /** Einbaupunkt (Symbolmitte) im Modellraum [m]. */
  position: Vec2;
  /** Drehung [°] CCW — die Achse des Symbols folgt der Wand. */
  rotation: number;
  /** Wand, an der er hängt; fehlt bei der Raummitte. */
  wallId?: string;
  /** Warum er dort sitzt — für die Meldung an den Anwender. */
  grund: 'fenster' | 'aussenwand' | 'raummitte';
}

/** Was in der Statuszeile steht, wenn ein Heizkörper aus dem Raumbuch entsteht. */
export const PLATZ_TEXT: Record<Heizkoerperplatz['grund'], string> = {
  fenster: 'unter das breiteste Fenster gesetzt',
  aussenwand: 'an die längste Außenwand gesetzt',
  raummitte: 'in die Raummitte gesetzt — der Raum hat keine Außenwand',
};

/** Auf welcher Seite der Wand der Raum liegt: +1 = Seite der Linksnormalen. */
function raumseite(
  wall: Wall,
  nodes: Record<string, BimNode>,
  u: number,
  room: Room,
): 1 | -1 {
  const g = getWallGeometry(wall, nodes);
  if (!g) return 1;
  const probe = (vz: 1 | -1) => wallLocalToWorld(g, u, vz * (g.halfThickness + 0.25));
  if (room.innerPolygon.length >= 3 && pointInPolygon(probe(1), room.innerPolygon)) return 1;
  return -1;
}

/** Punkt und Drehung an einer Wand, um `tiefe` in den Raum gerückt. */
function anDerWand(
  wall: Wall,
  nodes: Record<string, BimNode>,
  u: number,
  room: Room,
  tiefe: number,
): { position: Vec2; rotation: number } | null {
  const g = getWallGeometry(wall, nodes);
  if (!g) return null;
  const seite = raumseite(wall, nodes, u, room);
  const abstand = g.halfThickness + tiefe / 2;
  return {
    position: wallLocalToWorld(g, u, seite * abstand),
    rotation: (Math.atan2(g.dir.y, g.dir.x) * 180) / Math.PI,
  };
}

/**
 * Wo ein Heizkörper dieses Raums hingehört.
 *
 * `tiefe` ist die Bautiefe des Symbols [m] — der Heizkörper wird um seine
 * halbe Tiefe von der Wandoberfläche weggerückt, damit er davor steht und
 * nicht darin.
 */
export function heizkoerperplatz(
  room: Room,
  walls: Record<string, Wall>,
  nodes: Record<string, BimNode>,
  openings: Record<string, Opening>,
  tiefe = 0.1,
): Heizkoerperplatz {
  const aussen = room.boundaries
    .filter((b) => b.isExterior && walls[b.wallId])
    .map((b) => ({ wand: walls[b.wallId], laenge: b.length }))
    .sort((a, b) => b.laenge - a.laenge);

  // 1 — das breiteste Fenster in einer Außenwand des Raums.
  const wandIds = new Set(aussen.map((a) => a.wand.id));
  const fenster = Object.values(openings)
    .filter((o) => o.kind === 'window' && wandIds.has(o.wallId))
    .sort((a, b) => b.width - a.width)[0];
  if (fenster) {
    const wall = walls[fenster.wallId];
    const g = getWallGeometry(wall, nodes);
    if (g) {
      const { from, to } = openingSpan(g, fenster);
      const lage = anDerWand(wall, nodes, (from + to) / 2, room, tiefe);
      if (lage) return { ...lage, wallId: wall.id, grund: 'fenster' };
    }
  }

  // 2 — die längste Außenwand, mittig.
  for (const kandidat of aussen) {
    const g = getWallGeometry(kandidat.wand, nodes);
    if (!g) continue;
    const lage = anDerWand(kandidat.wand, nodes, g.length / 2, room, tiefe);
    if (lage) return { ...lage, wallId: kandidat.wand.id, grund: 'aussenwand' };
  }

  // 3 — Raummitte.
  return { position: room.centroid, rotation: 0, grund: 'raummitte' };
}
