/**
 * Prüfblock „Dachlandschaft" — mehrere Dächer über einem Geschoss.
 * ---------------------------------------------------------------------------
 * **Der Anlass.** Ein L-förmiges Haus bekam ein Satteldach über den ganzen
 * Grundriss. Es deckte den Hauptbau; der Nordflügel stand ohne Dach da, im
 * Modell als offene Schnittfläche an der Kante zu sehen. Das Dach zu
 * **drehen** hilft dort nicht — es verschiebt das Problem auf den anderen
 * Flügel. Ein L-Haus braucht je Flügel ein Dach.
 *
 * **Die drei Zusagen, die dieser Block festhält:**
 *
 *  1. **Jedes Dach sitzt über seinem Gebäudeteil.** Der Umriss kommt aus den
 *     Wänden der ihm zugewiesenen Räume, nicht aus denen des Geschosses.
 *     Sonst bekäme das Dach des Nordflügels die Spannweite des ganzen Hauses
 *     — und damit einen First, der im Bau nirgends liegt.
 *  2. **Über einem Punkt gilt genau ein Dach**, und zwar das, unter dessen
 *     Umriss er liegt. `roofHeightAt` rechnet für **jeden** Punkt eine Höhe
 *     aus, auch weit außerhalb; ohne die Umrissfrage lieferte das Dach des
 *     Nordflügels auch über dem Wohnzimmer eine Zahl, und zwar eine falsche.
 *  3. **Wo ein Geschoss darüberliegt, ist kein Dach, sondern eine Decke.**
 *     Diese Regel folgt aus keiner Geometrie — der Grundriss weiß nichts
 *     über das Geschoss darüber. Sie steckt deshalb im Vorschlag und in der
 *     Prüfung, nicht in einem Verbot: Ein Vordach über einem Erker ist ein
 *     zulässiger Fall.
 *
 * **Das Prüfhaus.** Ein L in Achsmaßen, aus zwei Rechtecken:
 *
 *     Hauptbau   x 0…10, y 0…6
 *     Nordflügel x 0…4,  y 6…12
 *
 * Wandstärke durchgehend 0,30 m, Geschosshöhe 2,50 m. Die beiden Teile
 * teilen sich die Wand bei y = 6 zwischen x = 0 und x = 4.
 */

import type { BimNode, Level, Room, Wall } from '../../src/types/bim';
import { detectRooms } from '../../src/lib/roomDetection';
import {
  baueDachlandschaft,
  daecherVon,
  dachteilAn,
  frameFuerRaum,
  raeumeMitGeschossDarueber,
  raeumeOhneGeschossDarueber,
} from '../../src/lib/dachlandschaft';
import { roofHeightAt } from '../../src/lib/roofGeometry';
import type { CheckFn } from './typ';

const DICKE = 0.3;
const HOEHE = 2.5;

/** Ein L-förmiges Haus aus Achsstrecken. */
function lHaus(): { walls: Wall[]; nodes: Record<string, BimNode> } {
  const ecken: [number, number][] = [
    [0, 0], [10, 0], [10, 6], [4, 6], [4, 12], [0, 12],
  ];
  const nodes: Record<string, BimNode> = {};
  ecken.forEach(([x, y], i) => {
    nodes[`n${i}`] = { id: `n${i}`, x, y, levelId: 'eg' };
  });
  const walls: Wall[] = ecken.map((_, i) => ({
    id: `w${i}`,
    a: `n${i}`,
    b: `n${(i + 1) % ecken.length}`,
    levelId: 'eg',
    type: 'exterior',
    thickness: DICKE,
    height: HOEHE,
    uValue: 0.24,
    layerId: 'layer-walls',
  }));
  // Die Trennwand zwischen den beiden Flügeln: von (0|6) nach (4|6).
  nodes['t0'] = { id: 't0', x: 0, y: 6, levelId: 'eg' };
  nodes['t1'] = { id: 't1', x: 4, y: 6, levelId: 'eg' };
  walls.push({
    id: 'w-trenn',
    a: 't0',
    b: 't1',
    levelId: 'eg',
    type: 'interior',
    thickness: 0.2,
    height: HOEHE,
    uValue: 1.2,
    layerId: 'layer-walls',
  });
  return { walls, nodes };
}

function geschoss(id: string, order: number): Level {
  return {
    id,
    name: id.toUpperCase(),
    order,
    elevation: order * 2.75,
    height: HOEHE,
    floorUValue: 0.28,
    floorBoundary: 'ground',
    ceilingUValue: 0.2,
    ceilingBoundary: 'unheated',
  } as Level;
}

const DACH = {
  kind: 'gable' as const,
  pitch: 38,
  kneeHeight: 1.0,
  azimuth: 90,
  ridgeOffset: 0,
  uValue: 0.2,
  gableUValue: 0.24,
};

export function pruefeDachlandschaft(check: CheckFn): void {
  const { walls, nodes } = lHaus();
  const raeume = detectRooms({
    walls,
    nodes,
    openings: [],
    levelId: 'eg',
    defaultHeight: HOEHE,
    northAngle: 0,
  });

  check('Das L zerfällt in zwei Räume', raeume.length, 2);
  // Hauptbau 10 × 6 abzüglich der halben Wandstärken, Nordflügel 4 × 6 —
  // welcher welcher ist, entscheidet die Fläche.
  const sortiert = [...raeume].sort((a, b) => b.area - a.area);
  const haupt = sortiert[0];
  const fluegel = sortiert[1];
  check('Der Hauptbau ist der größere', haupt.area > fluegel.area, true);

  // =========================================================================
  // 1 · daecherVon — ein Feld lesen, zwei Formate
  // =========================================================================
  {
    const ohne = geschoss('eg', 0);
    check('Ohne Dach: leere Liste', daecherVon(ohne).length, 0);

    const alt: Level = { ...ohne, roof: { ...DACH } };
    check('Altes Format: ein Dach', daecherVon(alt).length, 1);
    // Ein Projekt von vor 1.36.0 hat keine Kennung. Sie wird beim Lesen
    // vergeben, damit alles Weitere sich auf eine verlassen kann.
    check('… und es bekommt eine Kennung', daecherVon(alt)[0].id ?? '—', 'dach-1');

    const neu: Level = { ...ohne, roofs: [{ ...DACH, id: 'a' }, { ...DACH, id: 'b' }] };
    check('Neues Format: zwei Dächer', daecherVon(neu).length, 2);
    check('… in der Reihenfolge des Dokuments', daecherVon(neu).map((r) => r.id).join(','), 'a,b');

    // Beides gesetzt darf nicht doppelt zählen — `roofs` gewinnt.
    const beides: Level = { ...ohne, roof: { ...DACH }, roofs: [{ ...DACH, id: 'x' }] };
    check('Sind beide gesetzt, gilt roofs', daecherVon(beides).map((r) => r.id).join(','), 'x');
  }

  // =========================================================================
  // 2 · Jedes Dach über seinem Gebäudeteil
  // =========================================================================
  {
    const level: Level = {
      ...geschoss('eg', 0),
      roofs: [
        { ...DACH, id: 'haupt', name: 'Hauptdach', roomIds: [haupt.id] },
        { ...DACH, id: 'anbau', name: 'Anbau', azimuth: 0, roomIds: [fluegel.id] },
      ],
    };
    const teile = baueDachlandschaft({ level, walls, nodes, rooms: raeume });
    check('Zwei Dachteile', teile.length, 2);
    check('Beide haben ein Gerüst', teile.every((t) => t.frame !== null), true);

    /*
     * **Der Kern der Sache.** Die Umrisse der beiden Dächer müssen
     * *verschieden* sein und je einen Flügel beschreiben. Wäre der Umriss
     * aus den Wänden des ganzen Geschosses gebildet, wären beide gleich —
     * und das Dach des Anbaus hätte die Spannweite des Hauptbaus.
     */
    const [a, b] = teile;
    const spanne = (t: (typeof teile)[number]): number =>
      t.frame ? Math.max(t.frame.halfSpanT, t.frame.halfSpanS) : -1;
    check('Die Umrisse sind verschieden', spanne(a) !== spanne(b), true);
    check('Der Hauptbau spannt weiter als der Anbau', spanne(a) > spanne(b), true);

    // =======================================================================
    // 3 · Über einem Punkt gilt genau ein Dach
    // =======================================================================
    // (8|3) liegt tief im Hauptbau, (2|10) tief im Nordflügel — beide weit
    // von jeder Kante, damit keine Rundung mitspielt.
    check('Im Hauptbau gilt das Hauptdach', dachteilAn(teile, { x: 8, y: 3 })?.roof.id ?? '—', 'haupt');
    check('Im Anbau gilt der Anbau', dachteilAn(teile, { x: 2, y: 10 })?.roof.id ?? '—', 'anbau');
    // Außerhalb des Hauses gilt keines. Genau hier lag der Fehler: Ohne die
    // Umrissfrage liefert `roofHeightAt` auch dort eine Zahl.
    check('Außerhalb gilt keines', dachteilAn(teile, { x: 30, y: 30 }) === undefined, true);

    const hauptFrame = teile.find((t) => t.roof.id === 'haupt')?.frame ?? null;
    const anbauFrame = teile.find((t) => t.roof.id === 'anbau')?.frame ?? null;
    check('Der Raum bekommt sein eigenes Dach',
      frameFuerRaum(teile, haupt) === hauptFrame, true);
    check('… und der Flügel seines', frameFuerRaum(teile, fluegel) === anbauFrame, true);

    /*
     * Und die Höhen unterscheiden sich wirklich. Beide Dächer haben
     * dieselbe Neigung und denselben Kniestock; verschieden ist allein die
     * Spannweite ihres Gebäudeteils — und genau das muss sich in der
     * Firsthöhe niederschlagen. Wäre es nicht so, säße doch ein Dach über
     * dem ganzen Haus.
     */
    if (hauptFrame && anbauFrame) {
      check('Der Hauptbau hat den höheren First',
        hauptFrame.ridgeHeight > anbauFrame.ridgeHeight, true);
      check('Beide Firste liegen über dem Kniestock',
        hauptFrame.ridgeHeight > DACH.kneeHeight && anbauFrame.ridgeHeight > DACH.kneeHeight, true);
      /*
       * Die lichte Höhe im Anbau kommt aus dem Anbaudach, nicht aus dem
       * Hauptdach — die beiden Zahlen dürfen nicht gleich sein.
       *
       * **Der Punkt ist mit Bedacht gewählt, und der erste war es nicht.**
       * Bei (2|10) liefern beide Dächer 2,563 m, und zwar zufällig: Das
       * Hauptdach fällt nach Osten, hängt also nur von x ab (x = 2), das
       * Anbaudach fällt nach Norden und hängt nur von y ab (y = 10). Dass
       * beide Rechnungen dort dieselbe Zahl ergeben, ist ein Zusammentreffen
       * und kein Befund — die Prüfung wäre aus dem falschen Grund
       * durchgefallen.
       *
       * (2|9) liegt auf der **Firstachse des Anbaus**: Er spannt in y von 6
       * bis 12, sein First liegt damit bei y = 9 und dort auf 3,344 m. Das
       * Hauptdach liefert an derselben Stelle weiterhin 2,563 m. Die beiden
       * Zahlen sind jetzt aus einem Grund verschieden.
       */
      const imAnbau = { x: 2, y: 9 };
      check('Im Anbau rechnet das Anbaudach',
        Math.abs(roofHeightAt(anbauFrame, imAnbau) - roofHeightAt(hauptFrame, imAnbau)) > 0.5, true);
      check('… und zwar mit seinem First', roofHeightAt(anbauFrame, imAnbau), anbauFrame.ridgeHeight, 1e-6);
    }
  }

  // =========================================================================
  // 4 · Ohne Raumauswahl deckt ein Dach das ganze Geschoss
  // =========================================================================
  {
    const level: Level = { ...geschoss('eg', 0), roof: { ...DACH } };
    const teile = baueDachlandschaft({ level, walls, nodes, rooms: raeume });
    check('Ein Dach ohne Raumauswahl', teile.length, 1);
    check('Es gilt im Hauptbau', dachteilAn(teile, { x: 8, y: 3 }) !== undefined, true);
    check('… und im Anbau', dachteilAn(teile, { x: 2, y: 10 }) !== undefined, true);
    // Das ist der Zustand vor 1.36.0 — jedes alte Projekt muss ihn treffen.
    check('Beide Räume bekommen dasselbe Gerüst',
      frameFuerRaum(teile, haupt) === frameFuerRaum(teile, fluegel), true);
  }

  // =========================================================================
  // 5 · Wo ein Geschoss darüberliegt, ist eine Decke
  // =========================================================================
  {
    /*
     * Das Obergeschoss steht **nur über dem Hauptbau**: dieselben Wände,
     * aber nur das Rechteck 0…10 × 0…6. Der Nordflügel bleibt eingeschossig
     * — genau der Fall, den ein L-Haus mit Anbau darstellt.
     */
    const obenRaum: Room = { ...haupt, id: 'og-raum', levelId: 'og' };

    const ohne = raeumeOhneGeschossDarueber(raeume, [obenRaum]);
    check('Der Flügel hat kein Geschoss darüber', ohne.includes(fluegel.id), true);
    check('Der Hauptbau schon', ohne.includes(haupt.id), false);
    check('Genau einer bleibt übrig', ohne.length, 1);

    // Ohne Geschoss darüber gehören beide dazu — die Gegenprobe, damit die
    // Prüfung nicht nur „gibt immer eins zurück" bestätigt.
    check('Ohne Obergeschoss gehören beide dazu',
      raeumeOhneGeschossDarueber(raeume, []).length, 2);

    /*
     * Die Gegenrichtung: Was steht in einem Dach, obwohl darüber ein
     * Geschoss liegt? Das ist die Zahl, die die Modellprüfung meldet.
     */
    const falsch = raeumeMitGeschossDarueber([haupt.id, fluegel.id], raeume, [obenRaum]);
    check('Der Hauptbau wird als „darüber liegt etwas" gemeldet', falsch.join(','), haupt.id);
    check('Ein Dach nur über dem Flügel wird nicht gemeldet',
      raeumeMitGeschossDarueber([fluegel.id], raeume, [obenRaum]).length, 0);
    // Ein leeres Dach (ganzes Geschoss) meldet nichts — sonst stünde bei
    // jedem alten Projekt eine Warnung, die niemand verursacht hat.
    check('Ein Dach ohne Raumauswahl meldet nichts',
      raeumeMitGeschossDarueber([], raeume, [obenRaum]).length, 0);
  }
}
