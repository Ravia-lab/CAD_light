/**
 * Wo die Leitung von der Wärmepumpe ins Haus kommt.
 * ---------------------------------------------------------------------------
 * **Warum es das braucht.** Der Rohrausleger kannte als Anfang des Netzes nur
 * Objekte im Haus: Wärmeerzeuger, Speicher, Verteiler. Eine Monoblock-
 * Wärmepumpe steht aber draußen — sie *ist* der Wärmeerzeuger, und im Plan
 * steht sie im Garten. Wer sie gesetzt hatte und auf „Rohrnetz auslegen"
 * drückte, bekam „Kein Wärmeerzeuger auf diesem Geschoss". Gemeldet wurde es
 * so: „wärmepumpe ist wärmeerzeuger für die automatische rohrverlegung".
 *
 * **Was hier bestimmt wird.** Die Stelle, an der die Leitung durch die
 * Außenwand geht: der Punkt auf der **nächstgelegenen Außenwand**, dazu je
 * ein Punkt außen vor und innen hinter der Wand. Außen beginnt die
 * Außenleitung an der Wärmepumpe, innen beginnt die Trasse im Haus.
 *
 * **Das ist eine Annahme, und sie wird so benannt.** Wo die Hauseinführung
 * wirklich sitzt, entscheiden Kellerlage, Kernbohrung und Aufstellplan. Die
 * nächste Außenwand ist der kürzeste Weg und damit der Vorschlag, den ein
 * Planer auch zuerst machen würde — der Rohrausleger sagt in seinen
 * Hinweisen dazu, dass er angenommen ist.
 *
 * **Drei Dinge werden gemieden**, weil dort keine Leitung durch die Wand geht:
 *  - Öffnungen — durch ein Fenster oder eine Tür führt man kein Rohr;
 *  - die Wandenden — an der Gebäudeecke trifft die Bohrung die Nachbarwand;
 *  - Wände, hinter denen kein Raum liegt — dann gäbe es innen nichts, wo die
 *    Trasse beginnen könnte.
 */

import type { BimNode, Opening, Room, Vec2, Wall } from '../types/bim';
import { getWallGeometry } from './wallGeometry';
import { pointInPolygon } from './geometry';

/** Abstand der Bohrung von einem Wandende [m] — die halbe Nachbarwand und etwas Luft. */
export const ECKABSTAND = 0.3;
/** Abstand der Bohrung von einer Öffnung [m] — Laibung und Sturzauflager bleiben frei. */
export const OEFFNUNGSABSTAND = 0.2;
/** Wie weit hinter der Wand die Trasse im Haus beginnt [m]. */
export const INNENVERSATZ = 0.15;

export interface Hauseinfuehrung {
  wallId: string;
  /** Punkt auf der Wandachse. */
  achse: Vec2;
  /** Vor der Außenseite der Wand — hier endet die Außenleitung. */
  aussen: Vec2;
  /** Hinter der Innenseite — hier beginnt die Trasse im Haus. */
  innen: Vec2;
  /** Luftlinie von der Wärmepumpe zur Außenseite der Wand [m]. */
  aussenLaenge: number;
  /** Der Raum, in dem die Leitung ankommt. */
  roomId: string;
}

/**
 * Die Hauseinführung zur Wärmepumpe an `pumpe`.
 *
 * `undefined`, wenn keine Außenwand eine zulässige Stelle hat — dann bleibt
 * es beim bisherigen Verhalten, und der Rohrausleger sagt, warum.
 */
export function hauseinfuehrung(
  pumpe: Vec2,
  walls: readonly Wall[],
  nodes: Record<string, BimNode>,
  openings: readonly Opening[],
  rooms: readonly Room[],
): Hauseinfuehrung | undefined {
  let beste: Hauseinfuehrung | undefined;

  for (const wall of walls) {
    if (wall.type !== 'exterior') continue;
    const g = getWallGeometry(wall, nodes);
    if (!g || g.length < 2 * ECKABSTAND) continue;

    // Die gesperrten Abschnitte entlang der Achse: Enden und Öffnungen.
    const sperren: Array<[number, number]> = [
      [0, ECKABSTAND],
      [g.length - ECKABSTAND, g.length],
    ];
    for (const o of openings) {
      if (o.wallId !== wall.id) continue;
      sperren.push([o.distance - o.width / 2 - OEFFNUNGSABSTAND, o.distance + o.width / 2 + OEFFNUNGSABSTAND]);
    }

    // Fußpunkt der Wärmepumpe auf der Achse, dann aus den Sperren heraus.
    const rel = { x: pumpe.x - g.a.x, y: pumpe.y - g.a.y };
    const fuss = Math.max(0, Math.min(g.length, rel.x * g.dir.x + rel.y * g.dir.y));
    const t = ausSperren(fuss, sperren, g.length);
    if (t === undefined) continue;

    const achse = { x: g.a.x + g.dir.x * t, y: g.a.y + g.dir.y * t };
    // Welche Seite ist innen? Die, auf der hinter der Wand ein Raum liegt.
    const versatz = g.halfThickness + INNENVERSATZ;
    const links = { x: achse.x + g.normal.x * versatz, y: achse.y + g.normal.y * versatz };
    const rechts = { x: achse.x - g.normal.x * versatz, y: achse.y - g.normal.y * versatz };
    const raumLinks = rooms.find((r) => r.innerPolygon.length >= 3 && pointInPolygon(links, r.innerPolygon));
    const raumRechts = rooms.find((r) => r.innerPolygon.length >= 3 && pointInPolygon(rechts, r.innerPolygon));
    const raum = raumLinks ?? raumRechts;
    if (!raum || (raumLinks && raumRechts)) continue; // kein Raum dahinter, oder gar keine Außenwand
    const innen = raumLinks ? links : rechts;
    const vz = raumLinks ? -1 : 1;
    const aussen = {
      x: achse.x + g.normal.x * vz * g.halfThickness,
      y: achse.y + g.normal.y * vz * g.halfThickness,
    };
    const aussenLaenge = Math.hypot(pumpe.x - aussen.x, pumpe.y - aussen.y);
    if (!beste || aussenLaenge < beste.aussenLaenge - 1e-9) {
      beste = { wallId: wall.id, achse, aussen, innen, aussenLaenge, roomId: raum.id };
    }
  }
  return beste;
}

/**
 * Den Punkt `t` aus allen gesperrten Abschnitten schieben — zum nächsten
 * freien Rand. `undefined`, wenn die ganze Wand gesperrt ist.
 */
function ausSperren(t: number, sperren: Array<[number, number]>, laenge: number): number | undefined {
  const frei = (x: number) => x >= 0 && x <= laenge && sperren.every(([a, b]) => x <= a || x >= b);
  if (frei(t)) return t;
  const kandidaten = sperren.flatMap(([a, b]) => [a, b]).filter(frei);
  if (!kandidaten.length) return undefined;
  return kandidaten.reduce((best, x) => (Math.abs(x - t) < Math.abs(best - t) ? x : best));
}
