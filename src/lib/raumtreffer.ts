/**
 * raumtreffer — was ein Punkt im 3D-Raum im Modell bedeutet.
 *
 * **Das Problem, das diese Datei löst.** In der 3D-Ansicht sind alle Bauteile
 * einer Materialgruppe zu *einer* Geometrie verschmolzen — das ist der Grund,
 * warum ein ganzes Haus in einer Handvoll Zeichenaufrufe steht. Der Preis: Ein
 * Strahl, der eine Wand trifft, weiß nicht, **welche** Wand er getroffen hat.
 * Er weiß nur einen Punkt.
 *
 * Genau dort setzt diese Datei an: Aus dem Punkt wird wieder ein Bauteil. Das
 * ist reine Geometrie über dem Grundriss — kein Three.js, kein Strahl, keine
 * Kamera — und damit prüfbar.
 *
 * **Warum das besser ist als Kennungen in der Geometrie.** Die Alternative
 * wäre, jedem Dreieck eine Bauteilkennung mitzugeben und das Verschmelzen
 * aufzugeben. Das kostet Zeichenaufrufe bei *jedem* Bild, nur damit ein
 * seltener Klick einfacher wird. Hier kostet es eine Rechnung je Klick.
 *
 * **Die Reihenfolge ist eine Entscheidung.** Ein Punkt an einer Wand liegt
 * zugleich in einem Raum. Gemeint ist in aller Regel die Wand — man zeigt auf
 * das, was man sieht, und die Wand steht vor dem Raum. Nur wo keine Wand in
 * der Nähe ist, ist der Raum gemeint (Boden, Decke).
 */

import { distanceToSegment, pointInPolygon } from './geometry';
import { getWallGeometry } from './wallGeometry';
import type { BimDocument, LevelId, Vec2 } from '../types/bim';

/** Was an einer Stelle im Raum gemeint ist. */
export type Trefferart = 'wand' | 'raum' | 'nichts';

export interface Raumtreffer {
  art: Trefferart;
  /** Kennung der Wand bzw. des Raums. */
  id?: string;
  /**
   * Bei einer Wand: Abstand vom Wandanfang [m] entlang der Achse.
   * Das ist die Größe, in der eine Öffnung oder ein Durchbruch sitzt.
   */
  abstand?: number;
  /** Bei einer Wand: der Fußpunkt auf der Achse. */
  achspunkt?: Vec2;
};

/**
 * Wie weit neben der Wandachse ein Punkt noch zur Wand zählt [m].
 *
 * Die halbe Wandstärke plus dieser Zuschlag. Der Zuschlag ist nötig, weil der
 * Strahl die **Oberfläche** trifft und die Oberfläche einer 11,5er-Wand 5,75 cm
 * neben der Achse liegt — ohne Zuschlag hinge das Ergebnis an der
 * Rechengenauigkeit. 4 cm sind großzügig genug dafür und immer noch schmaler
 * als jede Wand, sodass zwei gegenüberliegende Wände nicht verschwimmen.
 */
export const WANDZUSCHLAG = 0.04;

/**
 * Den Punkt einem Bauteil zuordnen.
 *
 * `levelId` grenzt auf das Geschoss ein, in dem gearbeitet wird — sonst träfe
 * man im Erdgeschoss eine Wand des Obergeschosses, die im Bild an derselben
 * Stelle steht.
 */
export function deuteTreffer(doc: BimDocument, levelId: LevelId, p: Vec2): Raumtreffer {
  let beste: Raumtreffer = { art: 'nichts' };
  let besterAbstand = Infinity;

  for (const wand of Object.values(doc.walls ?? {})) {
    if (wand.levelId !== levelId) continue;
    const g = getWallGeometry(wand, doc.nodes);
    if (!g) continue;
    const d = distanceToSegment(p, g.a, g.b);
    if (d > wand.thickness / 2 + WANDZUSCHLAG) continue;
    if (d >= besterAbstand) continue;
    besterAbstand = d;
    // Abstand entlang der Achse — begrenzt auf die Wandlänge, damit ein
    // Punkt am Wandende nicht über das Ende hinaus verortet wird.
    const t = Math.max(
      0,
      Math.min(g.length, (p.x - g.a.x) * g.dir.x + (p.y - g.a.y) * g.dir.y),
    );
    beste = {
      art: 'wand',
      id: wand.id,
      abstand: t,
      achspunkt: { x: g.a.x + g.dir.x * t, y: g.a.y + g.dir.y * t },
    };
  }
  if (beste.art === 'wand') return beste;

  for (const raum of Object.values(doc.rooms ?? {})) {
    if (raum.levelId !== levelId) continue;
    const poly = raum.innerPolygon ?? raum.polygon;
    if (poly.length >= 3 && pointInPolygon(p, poly)) return { art: 'raum', id: raum.id };
  }
  return { art: 'nichts' };
}

/**
 * Szenenkoordinaten in Modellkoordinaten.
 *
 * Die Szene dreht die Modell-y-Achse um (`modelToScene` in `wallGeometry`);
 * der Rückweg muss dasselbe tun, sonst landet jeder Klick spiegelverkehrt.
 * Steht hier und nicht im Viewer, damit beide Richtungen **nebeneinander**
 * geprüft werden können — ein Vorzeichenfehler an dieser Stelle hat das
 * Programm schon einmal Stunden gekostet.
 */
export function szeneZuModell(s: { x: number; z: number }): Vec2 {
  return { x: s.x, y: -s.z };
}
