/**
 * Prüfblock „Heizkörperplatz" — wo ein Heizkörper landet, den niemand gesetzt hat.
 *
 * **Warum das eine Prüfung wert ist.** Im Raumbuch entsteht ein Heizkörper
 * aus einer Zahl: Wer „1400" in die Zeile „Wohnen" tippt, bekommt einen. Für
 * die Heizlast zählt allein die Leistung — aber das Ding steht danach im
 * Plan, wandert in die 3D-Ansicht und bekommt bei der Rohrnetzauslegung eine
 * Anbindeleitung. Ein Heizkörper in der Raummitte sieht dort nicht nach einer
 * Vereinfachung aus, sondern nach einem Fehler, und die Trasse fährt quer
 * durchs Zimmer, um ihn zu erreichen.
 *
 * Geprüft wird deshalb die Rangfolge, nach der die Stelle gewählt wird —
 * Fenster vor Außenwand vor Raummitte —, und die Lage auf den Zentimeter.
 *
 * Alle Sollwerte sind von Hand gerechnet und stehen bei der Prüfung.
 */

import type { BimNode, Opening, Room, Wall } from '../../src/types/bim';
import { heizkoerperplatz } from '../../src/lib/heizkoerperplatz';
import type { CheckFn } from './typ';

/*
 * Der Prüfraum: 6 × 4 m, Wandachsen auf 0/0 bis 6/4, Außenwände 0,24 m dick.
 *
 *        n3 ────────── n4      Nord  (y = 4)
 *         │             │
 *    West │             │ Ost
 *         │             │
 *        n1 ────────── n2      Süd   (y = 0)
 *
 * Der Raum liegt zwischen den Achsen; sein Innenpolygon beginnt 0,12 m
 * innerhalb (halbe Wandstärke).
 */
const nodes: Record<string, BimNode> = {
  n1: { id: 'n1', x: 0, y: 0, levelId: 'eg' } as BimNode,
  n2: { id: 'n2', x: 6, y: 0, levelId: 'eg' } as BimNode,
  n3: { id: 'n3', x: 0, y: 4, levelId: 'eg' } as BimNode,
  n4: { id: 'n4', x: 6, y: 4, levelId: 'eg' } as BimNode,
};

const wand = (id: string, a: string, b: string, type = 'exterior'): Wall =>
  ({ id, levelId: 'eg', a, b, thickness: 0.24, height: 2.5, type, layerId: 'layer-walls' }) as unknown as Wall;

const walls: Record<string, Wall> = {
  sued: wand('sued', 'n1', 'n2'),
  ost: wand('ost', 'n2', 'n4'),
  nord: wand('nord', 'n4', 'n3'),
  west: wand('west', 'n3', 'n1'),
};

const grenze = (wallId: string, laenge: number, aussen = true) => ({
  wallId,
  length: laenge,
  netArea: laenge * 2.5,
  grossArea: laenge * 2.5,
  openingArea: 0,
  orientation: 'S',
  azimuth: 180,
  isExterior: aussen,
  boundary: aussen ? 'exterior' : 'interior',
});

const raum = (grenzen: ReturnType<typeof grenze>[]): Room =>
  ({
    id: 'r1',
    name: 'Wohnen',
    usage: 'living',
    levelId: 'eg',
    area: 22.13,
    centroid: { x: 3, y: 2 },
    innerPolygon: [
      { x: 0.12, y: 0.12 },
      { x: 5.88, y: 0.12 },
      { x: 5.88, y: 3.88 },
      { x: 0.12, y: 3.88 },
    ],
    boundaries: grenzen,
  }) as unknown as Room;

const fenster = (id: string, wallId: string, distance: number, width: number): Opening =>
  ({ id, wallId, kind: 'window', distance, width, height: 1.385, sillHeight: 0.9 }) as unknown as Opening;

export function pruefeHeizkoerperplatz(check: CheckFn): void {
  const alleAussen = [grenze('sued', 6), grenze('ost', 4), grenze('nord', 6), grenze('west', 4)];

  // =========================================================================
  // 1 · Unter dem breitesten Fenster
  // =========================================================================
  {
    const openings = {
      f1: fenster('f1', 'sued', 2, 1.2),
      f2: fenster('f2', 'nord', 3, 1.76), // breiter — und trotzdem nicht gemeint?
    };
    const platz = heizkoerperplatz(raum(alleAussen), walls, nodes, openings, 0.1);

    /*
     * Das breiteste Fenster ist f2 in der Nordwand (1,76 m gegen 1,20 m).
     * Die Nordwand läuft von n4(6,4) nach n3(0,4), also in −x; ihre
     * Linksnormale zeigt damit nach −y, und das ist die Raumseite.
     *
     *   u = 3 ab n4 in −x            → x = 6 − 3 = 3
     *   Abstand = 0,12 + 0,1/2       = 0,17 m in Raumrichtung (−y)
     *                                → y = 4 − 0,17 = 3,83
     *   Drehung = atan2(0, −1)       = 180°
     */
    check('Erste Wahl ist das Fenster', platz.grund, 'fenster');
    check('An der Wand des breitesten Fensters', platz.wallId ?? '', 'nord');
    check('Mittig unter dem Fenster (x)', platz.position.x, 3, 1e-9);
    check('Um halbe Wand plus halbe Tiefe hereingerückt (y)', platz.position.y, 3.83, 1e-9);
    check('Drehung folgt der Wandachse', platz.rotation, 180, 1e-9);
  }

  // =========================================================================
  // 2 · Ohne Fenster: die längste Außenwand
  // =========================================================================
  {
    const platz = heizkoerperplatz(raum(alleAussen), walls, nodes, {}, 0.1);
    /*
     * Ohne Fenster entscheidet die Länge. Süd und Nord sind beide 6 m lang;
     * bei Gleichstand bleibt die Reihenfolge der Raumgrenzen erhalten, und
     * das ist hier die Südwand.
     *
     *   Südwand n1(0,0) → n2(6,0), Linksnormale (0, 1) = Raumseite
     *   u = 3 (Mitte), Abstand 0,17 m nach +y      → (3 | 0,17)
     *   Drehung = atan2(0, 1) = 0°
     */
    check('Zweite Wahl ist die Außenwand', platz.grund, 'aussenwand');
    check('Die längste zuerst', platz.wallId ?? '', 'sued');
    check('Mittig an der Wand (x)', platz.position.x, 3, 1e-9);
    check('Vor der Wandoberfläche (y)', platz.position.y, 0.17, 1e-9);
    check('Drehung 0° bei einer Wand in +x', platz.rotation, 0, 1e-9);
  }

  // =========================================================================
  // 3 · Die Tiefe des Symbols geht in den Abstand ein
  // =========================================================================
  {
    // Ein Röhrenradiator ist 0,12 m tief: 0,12 + 0,06 = 0,18 m.
    const platz = heizkoerperplatz(raum(alleAussen), walls, nodes, {}, 0.12);
    check('Tiefere Bauart rückt weiter herein', platz.position.y, 0.18, 1e-9);
  }

  // =========================================================================
  // 4 · Kein Außenbauteil: die Raummitte, und sie wird genannt
  // =========================================================================
  {
    const innen = [grenze('sued', 6, false), grenze('ost', 4, false)];
    const platz = heizkoerperplatz(raum(innen), walls, nodes, {}, 0.1);
    check('Ohne Außenwand die Raummitte', platz.grund, 'raummitte');
    check('Mitte in x', platz.position.x, 3, 1e-9);
    check('Mitte in y', platz.position.y, 2, 1e-9);
    check('Ohne Wandbindung', platz.wallId === undefined, true);
    check('Drehung bleibt 0°', platz.rotation, 0, 1e-9);
  }

  // =========================================================================
  // 5 · Ein Fenster in einer Innenwand zählt nicht
  // =========================================================================
  {
    // Innenfenster gibt es (Oberlicht zum Flur) — unter eines davon gehört
    // kein Heizkörper. Maßgeblich ist die Außenwand.
    const innenfenster = { f9: fenster('f9', 'ost', 2, 2.0) };
    const nurSuedAussen = [grenze('sued', 6), grenze('ost', 4, false)];
    const platz = heizkoerperplatz(raum(nurSuedAussen), walls, nodes, innenfenster, 0.1);
    check('Fenster in der Innenwand wird übergangen', platz.grund, 'aussenwand');
    check('Es bleibt bei der Außenwand', platz.wallId ?? '', 'sued');
  }
}
