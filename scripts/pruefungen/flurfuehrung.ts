/**
 * Prüfblock „Flurführung" — die Trasse gehört auf die Verkehrsfläche.
 * ---------------------------------------------------------------------------
 * **Der Befund.** „Rohre quer durch den Raum ist auch doof, vor allem wenn ein
 * Heizkreisverteiler da ist — dann schlängelt der sich mit." Genau das tat die
 * Wegsuche: Sie kannte nur „kurz" und „Randfuge meiden" und schickte die
 * Anbindeleitungen quer durch die Wohnräume, notfalls durch drei
 * hintereinander. Verlegt wird anders — gebündelt über den Flur, Abzweig an
 * der Zimmertür.
 *
 * **Zwei Zahlen zusammen ergeben das Verhalten**, und beide werden hier
 * geprüft:
 *
 *  · `WAND_GEWICHT_NEUBAU` macht die Raummitte teuer. Damit folgt die Trasse
 *    innerhalb eines Raums der Wand, statt ihn zu zerschneiden.
 *  · `NUTZUNGS_GEWICHT` macht den Flur billig. Damit gewinnt der Weg über die
 *    Verkehrsfläche, sobald er nicht mehr als zweieinhalbmal so lang ist.
 *
 * Die erste allein ordnet die Trasse im Raum, ändert aber nichts daran, *durch
 * welchen* Raum sie läuft. Die zweite allein bliebe wirkungslos, solange der
 * Weg quer durch die Zimmer der billigste ist. Deshalb stehen sie hier in
 * einem Block.
 *
 * **Der Prüfstand.** Drei Wohnräume nebeneinander, darüber ein durchgehender
 * Flur. Jeder Raum hat eine Tür zum Flur, und die Wohnräume haben zusätzlich
 * Türen untereinander. Quelle ist ein Verteiler im linken Raum, Ziele sind
 * Heizkörper im mittleren und im rechten.
 *
 *      y=5,5  ┌────────────────────────────────────┐
 *             │             F L U R                │
 *      y=4    ├──────┬──────────┬──────────────────┤
 *             │  R1  │    R2    │        R3        │
 *      y=0    └──────┴──────────┴──────────────────┘
 *            x=0    x=4        x=8               x=12
 *
 * **Warum die Gegenprobe dazugehört.** Ein Gewicht, das immer den Flur wählt,
 * wäre genauso falsch wie eines, das ihn nie wählt. Derselbe Grundriss wird
 * deshalb zweimal gerechnet — einmal mit dem oberen Raum als Flur, einmal mit
 * demselben Raum als Wohnzimmer. Beim zweiten Mal *muss* die Trasse den kurzen
 * Weg nehmen; sonst prüfte dieser Block nicht das Gewicht, sondern die
 * Geometrie.
 */

import type { BimNode, Opening, Room, RoomUsage, Vec2, Wall } from '../../src/types/bim';
import { NUTZUNGS_GEWICHT, routePipes } from '../../src/lib/pipeRouting';
import { pointInPolygon } from '../../src/lib/geometry';
import type { CheckFn } from './typ';

const HOEHE = 2.75;
const DICKE = 0.24;
/** Halbe Wandstärke — der Abstand von der Achse zur lichten Fläche. */
const H = DICKE / 2;

interface Pruefstand {
  nodes: Record<string, BimNode>;
  walls: Wall[];
  openings: Opening[];
  rooms: Room[];
}

function bauePruefstand(obenNutzung: RoomUsage): Pruefstand {
  const nodes: Record<string, BimNode> = {};
  const knoten = (id: string, x: number, y: number): string => {
    nodes[id] = { id, x, y, levelId: 'eg' };
    return id;
  };
  const walls: Wall[] = [];
  const wand = (id: string, a: string, b: string, typ: Wall['type']): void => {
    walls.push({
      id, a, b, levelId: 'eg', type: typ, thickness: DICKE,
      uValue: typ === 'exterior' ? 0.28 : 1.2, height: HOEHE, layerId: 'layer-walls',
    });
  };

  knoten('sw', 0, 0); knoten('se', 12, 0);
  knoten('mw', 0, 4); knoten('me', 12, 4);
  knoten('nw', 0, 5.5); knoten('ne', 12, 5.5);
  knoten('t1s', 4, 0); knoten('t1n', 4, 4);
  knoten('t2s', 8, 0); knoten('t2n', 8, 4);

  wand('w-s', 'sw', 'se', 'exterior');
  wand('w-e1', 'se', 'me', 'exterior');
  wand('w-e2', 'me', 'ne', 'exterior');
  wand('w-n', 'ne', 'nw', 'exterior');
  wand('w-w2', 'nw', 'mw', 'exterior');
  wand('w-w1', 'mw', 'sw', 'exterior');
  wand('w-flur', 'mw', 'me', 'interior');
  wand('w-t1', 't1s', 't1n', 'interior');
  wand('w-t2', 't2s', 't2n', 'interior');

  const tuer = (id: string, wallId: string, distance: number): Opening => ({
    id, wallId, kind: 'door', distance, width: 0.885, height: 2.01, sillHeight: 0,
    doorType: 'single',
  });
  const openings: Opening[] = [
    // Zwischen den Wohnräumen — der kurze Weg.
    tuer('t-12', 'w-t1', 2),
    tuer('t-23', 'w-t2', 2),
    // Vom Flur in jeden Wohnraum — der Weg über die Verkehrsfläche.
    tuer('t-f1', 'w-flur', 2),
    tuer('t-f2', 'w-flur', 6),
    tuer('t-f3', 'w-flur', 10),
  ];

  const raum = (id: string, name: string, usage: RoomUsage, poly: Vec2[]): Room => ({
    id, name, usage, levelId: 'eg',
    polygon: poly, innerPolygon: poly,
    area: 0, grossArea: 0, perimeter: 0, height: HOEHE, volume: 0,
    centroid: poly.reduce(
      (a, p) => ({ x: a.x + p.x / poly.length, y: a.y + p.y / poly.length }),
      { x: 0, y: 0 },
    ),
    boundaries: [], setpointTemperature: 20, airChangeRate: 0.5, isHeated: true,
    groundContactPerimeter: 0, exposedFacadeCount: 2,
  });

  const rooms: Room[] = [
    raum('r1', 'Raum 1', 'living', [
      { x: H, y: H }, { x: 4 - H, y: H }, { x: 4 - H, y: 4 - H }, { x: H, y: 4 - H },
    ]),
    raum('r2', 'Raum 2', 'living', [
      { x: 4 + H, y: H }, { x: 8 - H, y: H }, { x: 8 - H, y: 4 - H }, { x: 4 + H, y: 4 - H },
    ]),
    raum('r3', 'Raum 3', 'living', [
      { x: 8 + H, y: H }, { x: 12 - H, y: H }, { x: 12 - H, y: 4 - H }, { x: 8 + H, y: 4 - H },
    ]),
    raum('oben', 'Flur', obenNutzung, [
      { x: H, y: 4 + H }, { x: 12 - H, y: 4 + H }, { x: 12 - H, y: 5.5 - H }, { x: H, y: 5.5 - H },
    ]),
  ];

  return { nodes, walls, openings, rooms };
}

/** Wie viele Trassenmeter liegen in diesem Raum? */
function meterIn(punkte: readonly Vec2[], poly: readonly Vec2[]): number {
  let summe = 0;
  for (let i = 1; i < punkte.length; i++) {
    const a = punkte[i - 1];
    const b = punkte[i];
    // Der Mittelpunkt entscheidet. Das Suchraster ist 10 cm fein, die Stücke
    // sind es damit auch — feiner zu unterteilen brächte keine andere Antwort.
    if (pointInPolygon({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, poly)) {
      summe += Math.hypot(b.x - a.x, b.y - a.y);
    }
  }
  return summe;
}

/** Größter Wandabstand eines Trassenstücks — misst, ob die Trasse quer läuft. */
function groessterWandabstand(punkte: readonly Vec2[], poly: readonly Vec2[]): number {
  let weit = 0;
  for (const p of punkte) {
    if (!pointInPolygon(p, poly)) continue;
    let nah = Infinity;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const l2 = dx * dx + dy * dy;
      const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
      nah = Math.min(nah, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
    }
    if (nah > weit) weit = nah;
  }
  return weit;
}

function trassiere(g: Pruefstand) {
  return routePipes({
    mode: 'neubau',
    levelId: 'eg',
    rooms: g.rooms,
    walls: g.walls,
    nodes: g.nodes,
    openings: g.openings,
    source: { x: 1, y: 1 },
    targets: [
      { id: 'hk2', position: { x: 6, y: 0.5 } },
      { id: 'hk3', position: { x: 10, y: 0.5 } },
    ],
  });
}

export function pruefeFlurfuehrung(check: CheckFn): void {
  // === 1 — Die Rangfolge der Gewichte ======================================
  check('Der Aufenthaltsraum ist der Bezugswert', NUTZUNGS_GEWICHT.living, 1, 1e-9);
  check('Schlafzimmer und Arbeitszimmer ebenso', NUTZUNGS_GEWICHT.bedroom, 1, 1e-9);
  check('Der Flur ist der günstigste Weg', NUTZUNGS_GEWICHT.hallway, 0.4, 1e-9);
  // 1 / 0,4 = 2,5 — so viel länger darf der Flurweg höchstens sein.
  check('… um den Faktor 2,5', NUTZUNGS_GEWICHT.living / NUTZUNGS_GEWICHT.hallway, 2.5, 1e-9);
  check('Nebenräume liegen dazwischen', NUTZUNGS_GEWICHT.kitchen, 0.67, 1e-9);
  check('Kein Gewicht ist null oder negativ',
    Object.values(NUTZUNGS_GEWICHT).every((w) => w > 0), true);
  check('Kein Raum ist teurer als der Aufenthaltsraum',
    Object.values(NUTZUNGS_GEWICHT).every((w) => w <= 1), true);

  // === 2 — Mit Flur: die Trasse geht oben herum ============================
  const mitFlur = bauePruefstand('hallway');
  const netzFlur = trassiere(mitFlur);
  check('Beide Verbraucher werden erreicht', netzFlur.legs.length, 2, 0);

  const flurPoly = mitFlur.rooms[3].innerPolygon;
  const legR3 = netzFlur.legs.find((l) => l.targetId === 'hk3');
  const wegR3 = legR3?.points ?? [];

  // Der Weg zum rechten Heizkörper ist der aussagekräftige: Er muss an Raum 2
  // vorbei. Quer hindurch wären es rund 9 m mitten durch ein Wohnzimmer.
  check('Der Weg zum rechten Heizkörper führt durch den Flur',
    meterIn(wegR3, flurPoly) > 6, true);
  check('… und nicht mehr durch den mittleren Raum',
    meterIn(wegR3, mitFlur.rooms[1].innerPolygon) < 0.5, true);
  check('… die Tür zwischen den Wohnräumen bleibt unbenutzt',
    (legR3?.doorCrossings ?? []).includes('t-23'), false);
  check('… und die Flurtüren werden benutzt',
    (legR3?.doorCrossings ?? []).filter((d) => d.startsWith('t-f')).length, 2, 0);

  // === 3 — Gegenprobe: derselbe Grundriss ohne Flur ========================
  // Ist der obere Raum kein Flur, sondern ein weiteres Wohnzimmer, gibt es
  // keinen Grund mehr für den Umweg — dann muss der kurze Weg gewinnen.
  const ohneFlur = bauePruefstand('living');
  const netzOhne = trassiere(ohneFlur);
  const legOhne = netzOhne.legs.find((l) => l.targetId === 'hk3');
  const wegOhne = legOhne?.points ?? [];
  check('Ohne Flur bleibt die Trasse unten',
    meterIn(wegOhne, ohneFlur.rooms[3].innerPolygon) < 0.5, true);
  check('Ohne Flur geht sie durch den mittleren Raum',
    meterIn(wegOhne, ohneFlur.rooms[1].innerPolygon) > 2, true);
  check('Ohne Flur ist die Trasse kürzer',
    (legOhne?.length ?? 0) < (legR3?.length ?? 0), true);
  // Der Umweg darf den Flur nicht beliebig teuer erkaufen: mehr als das
  // Zweieinhalbfache wäre ein Widerspruch zur Rangfolge oben.
  check('… und der Flurweg nicht mehr als das Zweieinhalbfache',
    (legR3?.length ?? 0) <= 2.5 * (legOhne?.length ?? 0), true);

  // === 4 — Die Wandnähe im Fußbodenaufbau ==================================
  /*
   * Auch ohne Flur darf die Trasse den Raum nicht zerschneiden. Raum 2 ist
   * 3,76 m licht; seine Mitte liegt 1,88 m von jeder Wand. Eine Trasse, die
   * quer hindurchläuft, käme dort auf rund 1,9 m Wandabstand — eine, die der
   * Wand folgt, bleibt darunter.
   *
   * Die Schwelle ist 1,00 m: Sie liegt deutlich über dem Sollabstand von
   * 0,05 m und deutlich unter der Raummitte, trennt also beide Fälle sauber,
   * ohne an einer Nachkommastelle zu hängen.
   */
  check('Die Trasse folgt im mittleren Raum der Wand',
    groessterWandabstand(wegOhne, ohneFlur.rooms[1].innerPolygon) < 1.0, true);
  check('Und im linken Raum ebenso',
    groessterWandabstand(wegOhne, ohneFlur.rooms[0].innerPolygon) < 1.0, true);
}
