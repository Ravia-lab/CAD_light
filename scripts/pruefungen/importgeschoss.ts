/**
 * Prüfblock „Geschosszuordnung" — der Grundriss kommt selten vom Erdgeschoss.
 *
 * Geprüft wird der Umbau, den `planeGeschosszuordnung` vorrechnet, wenn
 * jemand sagt: „Dieser eingelesene Grundriss ist das 1. OG." Drei Dinge
 * müssen dabei zugleich stimmen, und jedes einzelne ist für die Heizlast
 * entscheidend:
 *
 *  1. **Die Ordnung.** Aus dem einen Geschoss werden zwei, und das
 *     eingelesene ist das obere. Verrutscht das, sitzt die Wohnung im
 *     Erdgeschoss und die erfundene Etage darüber.
 *  2. **Die Randbedingungen.** Der Boden der Wohnung grenzt danach nicht
 *     mehr an Erdreich, sondern an einen Raum. Das ist der Unterschied
 *     zwischen einer Erdreichrechnung nach DIN EN ISO 13370 und einer
 *     Innenbauteilfläche, die gar nicht in die Transmission eingeht.
 *  3. **Die Höhenlage.** Das Erdgeschoss liegt auf 0, alles Vorhandene
 *     wandert um genau eine Geschosshöhe plus Deckenstärke nach oben. Bleibt
 *     die Anhebung aus, stehen zwei Geschosse ineinander.
 *
 * Alle Sollwerte sind von Hand gerechnet; die Rechnung steht daneben.
 */

import type { Level } from '../../src/types/bim';
import { planeGeschosszuordnung } from '../../src/lib/importgeschoss';
import { DEFAULT_SLAB, istLagename } from '../../src/lib/levelGeometry';
import type { CheckFn } from './typ';

/** Ein eingelesenes Geschoss, wie es nach einem Import dasteht. */
function eingelesen(over: Partial<Level> = {}): Level {
  return {
    id: 'l1', name: 'EG', order: 0, elevation: 0, height: 2.6,
    floorUValue: 0.35, floorBoundary: 'ground',
    ceilingUValue: 0.2, ceilingBoundary: 'unheated',
    ...over,
  };
}

let zaehler = 0;
const uid = (p: string): string => `${p}-${++zaehler}`;

export function pruefeImportgeschoss(check: CheckFn): void {
  check('Die Deckenstärke der Annahme ist 0,25 m', DEFAULT_SLAB, 0.25, 1e-9);

  // === 1 — Lagenamen =======================================================
  // Ein Lagename wandert mit der Lage, ein Eigenname bleibt stehen.
  check('„EG" ist ein Lagename', istLagename('EG'), true);
  check('„1. OG" ist ein Lagename', istLagename('1. OG'), true);
  check('„2.OG" ohne Leerzeichen ebenso', istLagename('2.OG'), true);
  check('„KG" ist ein Lagename', istLagename('KG'), true);
  check('„Geschoss 2" ist ein Platzhalter', istLagename('Geschoss 2'), true);
  check('Ein leerer Name gilt als Lagename', istLagename(''), true);
  check('„Dachboden" ist ein Eigenname', istLagename('Dachboden'), false);
  check('„Wohnung Müller" ist ein Eigenname', istLagename('Wohnung Müller'), false);

  // === 2 — Der Regelfall: ein Grundriss wird zum 1. OG =====================
  zaehler = 0;
  const p1 = planeGeschosszuordnung({
    levels: [eingelesen()],
    quelleId: 'l1',
    ordnung: 1,
    uid,
  });

  check('Es gibt etwas zu tun', p1.hinweis ?? '', '');
  check('Genau ein Geschoss entsteht', p1.neu.length, 1, 0);
  check('Und es ist das Erdgeschoss', p1.neu[0]?.name ?? '', 'EG');
  check('Mit der Ordnung 0', p1.neu[0]?.order ?? -99, 0, 0);
  check('Es steht auf 0,00 m', p1.neu[0]?.elevation ?? -99, 0, 1e-9);
  // Die lichte Höhe wird von der Quelle übernommen: 2,60 m.
  check('Es bekommt die lichte Höhe der Quelle', p1.neu[0]?.height ?? -99, 2.6, 1e-9);
  check('Sein Boden steht auf Erdreich', p1.neu[0]?.floorBoundary ?? '', 'ground');
  check('Seine Decke grenzt an den Raum darüber', p1.neu[0]?.ceilingBoundary ?? '', 'adjacent-room');

  // Anhebung = lichte Höhe + Deckenstärke = 2,60 + 0,25 = 2,85 m
  check('Alles Vorhandene wird um 2,85 m angehoben', p1.anhebung, 2.85, 1e-9);
  const quelle1 = p1.geaendert.find((l) => l.id === 'l1');
  check('Die Quelle bekommt die Ordnung 1', quelle1?.order ?? -99, 1, 0);
  check('Sie heißt jetzt 1. OG', quelle1?.name ?? '', '1. OG');
  check('Sie liegt auf 2,85 m', quelle1?.elevation ?? -99, 2.85, 1e-9);
  // Der entscheidende Punkt für die Heizlast.
  check('Ihr Boden grenzt nicht mehr an Erdreich', quelle1?.floorBoundary ?? '', 'adjacent-room');
  check('Ihre Decke bleibt gegen unbeheizt', quelle1?.ceilingBoundary ?? '', 'unheated');
  check('Das neue Geschoss bekommt den Außenwandumriss', p1.umrissFuer.length, 1, 0);
  check('… und zwar genau das neue', p1.umrissFuer[0] === p1.neu[0]?.id, true);

  // === 3 — Zwei Geschosse dazwischen ======================================
  // „Das ist das 2. OG" bei einem einzelnen eingelesenen Geschoss: EG und
  // 1. OG fehlen beide. Anhebung = 2 · (2,60 + 0,25) = 5,70 m.
  zaehler = 0;
  const p2 = planeGeschosszuordnung({ levels: [eingelesen()], quelleId: 'l1', ordnung: 2, uid });
  check('Zwei Geschosse entstehen', p2.neu.length, 2, 0);
  check('Sie heißen EG und 1. OG', p2.neu.map((l) => l.name).sort().join('|'), '1. OG|EG');
  check('Die Anhebung ist 5,70 m', p2.anhebung, 5.7, 1e-9);
  const eg2 = p2.neu.find((l) => l.order === 0);
  const og2 = p2.neu.find((l) => l.order === 1);
  check('Das EG steht auf Erdreich', eg2?.floorBoundary ?? '', 'ground');
  // Das erfundene 1. OG hat ein Geschoss unter sich — kein Erdreich.
  check('Das 1. OG nicht', og2?.floorBoundary ?? '', 'adjacent-room');
  check('Das 1. OG liegt auf 2,85 m', og2?.elevation ?? -99, 2.85, 1e-9);
  check('Beide bekommen den Umriss', p2.umrissFuer.length, 2, 0);

  // === 4 — Ein Bestand mit zwei Geschossen wandert geschlossen =============
  // Eingelesen wurden EG und OG einer Wohnung, die in Wirklichkeit im ersten
  // und zweiten Stock liegt. Beide wandern um eine Ordnung nach oben, ihr
  // Abstand bleibt.
  zaehler = 0;
  const p3 = planeGeschosszuordnung({
    levels: [
      eingelesen(),
      eingelesen({ id: 'l2', name: '1. OG', order: 1, elevation: 2.85, floorBoundary: 'adjacent-room', floorUValue: 0.9 }),
    ],
    quelleId: 'l1',
    ordnung: 1,
    uid,
  });
  check('Nur ein Geschoss entsteht', p3.neu.length, 1, 0);
  const a = p3.geaendert.find((l) => l.id === 'l1');
  const b = p3.geaendert.find((l) => l.id === 'l2');
  check('Das untere wird zum 1. OG', a?.order ?? -99, 1, 0);
  check('Das obere zum 2. OG', b?.order ?? -99, 2, 0);
  check('… und heißt auch so', b?.name ?? '', '2. OG');
  // Abstand vorher 2,85 − 0 = 2,85 m; nachher 5,70 − 2,85 = 2,85 m.
  check('Ihr Abstand bleibt 2,85 m', (b?.elevation ?? 0) - (a?.elevation ?? 0), 2.85, 1e-9);
  check('Die Decke des unteren grenzt an das obere', a?.ceilingBoundary ?? '', 'adjacent-room');
  check('Die Decke des obersten bleibt gegen unbeheizt', b?.ceilingBoundary ?? '', 'unheated');

  // === 5 — Eigennamen bleiben ==============================================
  zaehler = 0;
  const p4 = planeGeschosszuordnung({
    levels: [eingelesen({ name: 'Wohnung Müller' })],
    quelleId: 'l1',
    ordnung: 1,
    uid,
  });
  check('Ein Eigenname überlebt die Umsortierung', p4.geaendert[0]?.name ?? '', 'Wohnung Müller');
  check('Die Ordnung ändert sich trotzdem', p4.geaendert[0]?.order ?? -99, 1, 0);

  // === 6 — Nichts zu tun ===================================================
  zaehler = 0;
  const p5 = planeGeschosszuordnung({ levels: [eingelesen()], quelleId: 'l1', ordnung: 0, uid });
  check('Dieselbe Lage meldet „nichts zu tun"', (p5.hinweis ?? '').length > 0, true);
  check('… und ändert nichts', p5.geaendert.length + p5.neu.length, 0, 0);

  zaehler = 0;
  const p6 = planeGeschosszuordnung({ levels: [eingelesen()], quelleId: 'gibt-es-nicht', ordnung: 1, uid });
  check('Ein unbekanntes Quellgeschoss meldet sich', (p6.hinweis ?? '').length > 0, true);

  // === 7 — Nach unten ======================================================
  // „Das ist der Keller": über der Quelle fehlt das Erdgeschoss. Der Bestand
  // rückt nach *unten*, denn das neue Erdgeschoss beansprucht die 0.
  // Verschiebung = −1 · 2,85 − 0 = −2,85 m.
  zaehler = 0;
  const p7 = planeGeschosszuordnung({ levels: [eingelesen()], quelleId: 'l1', ordnung: -1, uid });
  check('Ein Geschoss darüber entsteht', p7.neu.length, 1, 0);
  check('Und es ist das Erdgeschoss', p7.neu[0]?.name ?? '', 'EG');
  check('Der Bestand rückt um 2,85 m nach unten', p7.anhebung, -2.85, 1e-9);
  const kg = p7.geaendert.find((l) => l.id === 'l1');
  check('Die Quelle wird zum KG', kg?.name ?? '', 'KG');
  check('Sie liegt auf −2,85 m', kg?.elevation ?? -99, -2.85, 1e-9);
  check('Ihr Boden bleibt auf Erdreich', kg?.floorBoundary ?? '', 'ground');
  check('Ihre Decke grenzt jetzt an das EG', kg?.ceilingBoundary ?? '', 'adjacent-room');
}
