/**
 * Prüfblock „Raumnamen gehen beim Spiegeln, Verschieben und Drehen mit".
 * ---------------------------------------------------------------------------
 * **Die Meldung:** „wenn ich die zeichnung drehe, spiegle und so weiter, dass
 * die raumnamen nicht mitgenommen werden, die werden durcheinandergewürfelt".
 *
 * **Die Ursache:** Nach jeder Änderung werden die Räume neu erkannt und
 * erben Namen, Nutzung und Temperatur von dem alten Raum, in dem ihr
 * Schwerpunkt liegt. Beim Spiegeln liegt der Schwerpunkt aber im alten
 * *Nachbarraum* — der Name wanderte mit der Lage, nicht mit dem Raum.
 *
 * **Die Regel jetzt:** Wer von denselben Wänden umschlossen wird, ist
 * derselbe Raum. Erst danach entscheidet die Lage.
 *
 * **Das Prüfhaus** — 12 × 8 m, vier Zimmer ungleicher Größe (Trennwände bei
 * x = 5 und y = 3), damit jede Spiegelung einen Schwerpunkt in einen anderen
 * alten Raum wirft:
 *
 *        (0,8) ───────── (5,8) ─────────────── (12,8)
 *          │  Kind 5×5     │   Wohnen 7×5          │
 *        (0,3) ───────── (5,3) ─────────────── (12,3)
 *          │  Bad 5×3      │   Küche 7×3           │
 *        (0,0) ───────── (5,0) ─────────────── (12,0)
 *
 * Links/rechts gespiegelt um x = 6: der Schwerpunkt des Bads (≈ 2,5 | 1,5)
 * geht nach (9,5 | 1,5) — mitten in die alte Küche. Nach der alten Regel hieß
 * das Bad danach „Küche".
 */

import type { BimNode, Room, Wall } from '../../src/types/bim';
import { detectRooms } from '../../src/lib/roomDetection';
import type { CheckFn } from './typ';

const n = (id: string, x: number, y: number): BimNode => ({ id, x, y, levelId: 'eg' } as BimNode);
const knoten = (): Record<string, BimNode> => Object.fromEntries(
  [
    n('a', 0, 0), n('b', 5, 0), n('c', 12, 0), n('d', 12, 3), n('e', 12, 8),
    n('f', 5, 8), n('g', 0, 8), n('h', 0, 3), n('m', 5, 3),
  ].map((k) => [k.id, k]),
);
const wand = (id: string, a: string, b: string, aussen: boolean): Wall => ({
  id, a, b, levelId: 'eg', type: aussen ? 'exterior' : 'interior',
  thickness: aussen ? 0.36 : 0.115, uValue: aussen ? 0.28 : 1.3, height: 2.5, layerId: 'layer-walls',
} as Wall);
const WAENDE: Record<string, Wall> = Object.fromEntries(
  [
    wand('s1', 'a', 'b', true), wand('s2', 'b', 'c', true), wand('o1', 'c', 'd', true), wand('o2', 'd', 'e', true),
    wand('n1', 'e', 'f', true), wand('n2', 'f', 'g', true), wand('w1', 'g', 'h', true), wand('w2', 'h', 'a', true),
    wand('iu', 'b', 'm', false), wand('io', 'm', 'f', false), wand('iw', 'h', 'm', false), wand('ie', 'm', 'd', false),
  ].map((w) => [w.id, w]),
);

const erkenne = (nodes: Record<string, BimNode>, previous: Room[] = []) =>
  detectRooms({ walls: Object.values(WAENDE), nodes, openings: [], levelId: 'eg', defaultHeight: 2.5, northAngle: 0, previous });

/** Welcher Name steht in welchem Quadranten des Hauses — Lage nach dem Umbau. */
const nameBei = (rooms: Room[], x: number, y: number) =>
  rooms.find((r) => Math.abs(r.centroid.x - x) < 1.5 && Math.abs(r.centroid.y - y) < 1.5)?.name ?? '—';

export function pruefeRaumnamenMitnehmen(check: CheckFn): void {
  // Ausgangslage: vier Räume, von Hand benannt.
  const start = erkenne(knoten());
  check('Vier Räume erkannt', start.length, 4);
  const taufe: Record<string, [string, Room['usage']]> = {
    '2.5|1.5': ['Bad', 'bath'], '8.5|1.5': ['Küche', 'kitchen'],
    '2.5|5.5': ['Kind', 'bedroom'], '8.5|5.5': ['Wohnen', 'living'],
  };
  const benannt = start.map((r) => {
    const k = `${Math.round(r.centroid.x * 2) / 2}|${Math.round(r.centroid.y * 2) / 2}`;
    const t = taufe[k];
    return t ? { ...r, name: t[0], usage: t[1], setpointTemperature: t[1] === 'bath' ? 24 : 20 } : r;
  });
  check('Alle vier getauft', benannt.filter((r) => ['Bad', 'Küche', 'Kind', 'Wohnen'].includes(r.name)).length, 4);

  const umbau = (f: (x: number, y: number) => [number, number]) => {
    const k = knoten();
    for (const v of Object.values(k)) [v.x, v.y] = f(v.x, v.y);
    return erkenne(k, benannt);
  };

  // Links/rechts um x = 6: Bad (2,5|1,5) → (9,5|1,5), Kind (2,5|5,5) → (9,5|5,5).
  const lr = umbau((x, y) => [12 - x, y]);
  check('Links/rechts: das Bad ist rechts unten', nameBei(lr, 9.5, 1.5), 'Bad');
  check('Links/rechts: die Küche links unten', nameBei(lr, 3.5, 1.5), 'Küche');
  check('Links/rechts: das Kind rechts oben', nameBei(lr, 9.5, 5.5), 'Kind');
  check('Links/rechts: Wohnen links oben', nameBei(lr, 3.5, 5.5), 'Wohnen');
  check('Links/rechts: das Bad bleibt ein Bad', lr.find((r) => r.name === 'Bad')?.usage ?? '—', 'bath');
  check('Links/rechts: … mit 24 °C', lr.find((r) => r.name === 'Bad')?.setpointTemperature ?? 0, 24);
  check('Links/rechts: die Kennungen gehen mit',
    lr.find((r) => r.name === 'Bad')?.id ?? '—', benannt.find((r) => r.name === 'Bad')?.id ?? 'x');

  // Oben/unten um y = 4: Bad (2,5|1,5) → (2,5|6,5).
  const ou = umbau((x, y) => [x, 8 - y]);
  check('Oben/unten: das Bad ist links oben', nameBei(ou, 2.5, 6.5), 'Bad');
  check('Oben/unten: Wohnen rechts unten', nameBei(ou, 8.5, 2.5), 'Wohnen');

  // Vierteldrehung gegen den Uhrzeigersinn um den Ursprung: (x, y) → (−y, x).
  // Bad (2,5|1,5) → (−1,5|2,5), Wohnen (8,5|5,5) → (−5,5|8,5).
  const dreh = umbau((x, y) => [-y, x]);
  check('Gedreht: das Bad', nameBei(dreh, -1.5, 2.5), 'Bad');
  check('Gedreht: Wohnen', nameBei(dreh, -5.5, 8.5), 'Wohnen');

  // Um 30 m verschoben — kein Schwerpunkt liegt mehr in einem alten Raum.
  const weg = umbau((x, y) => [x + 30, y]);
  check('Weit verschoben: das Bad', nameBei(weg, 32.5, 1.5), 'Bad');
  check('Weit verschoben: kein Raum namenlos', weg.filter((r) => /^Raum /.test(r.name)).length, 0);

  // Gegenprobe: Eine Wand durchs Wohnzimmer teilt es — dann gilt weiter die
  // Lage, und die größere Hälfte behält den Namen (Regel aus matchPrevious).
  {
    const k = knoten();
    k.p = n('p', 10, 3);
    k.q = n('q', 10, 8);
    const walls = { ...WAENDE };
    delete walls.ie; delete walls.n1;
    Object.assign(walls, {
      ie1: wand('ie1', 'm', 'p', false), ie2: wand('ie2', 'p', 'd', false),
      n1a: wand('n1a', 'e', 'q', true), n1b: wand('n1b', 'q', 'f', true),
      tw: wand('tw', 'p', 'q', false),
    });
    const geteilt = detectRooms({ walls: Object.values(walls), nodes: k, openings: [], levelId: 'eg', defaultHeight: 2.5, northAngle: 0, previous: benannt });
    check('Geteilt: fünf Räume', geteilt.length, 5);
    check('Geteilt: die größere Hälfte (5 × 5) heißt Wohnen', nameBei(geteilt, 7.5, 5.5), 'Wohnen');
    check('Geteilt: das Bad ist unverändert', nameBei(geteilt, 2.5, 1.5), 'Bad');
  }
}
