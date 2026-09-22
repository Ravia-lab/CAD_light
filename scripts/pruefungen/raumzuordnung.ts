/**
 * Prüfblock „Raumangaben beim Öffnen — geschossweise zuordnen".
 * ---------------------------------------------------------------------------
 * **Die Meldung (22.09.2026, aus einem Testlauf mit mehrgeschossigen
 * Gebäuden):** Nach Speichern und Öffnen heißen die oberen Geschosse „Raum 1,
 * Raum 2 …", der Keller ist plötzlich beheizt, und die Heizlast des
 * Obergeschosses steht im Erdgeschoss.
 *
 * **Die Ursache:** `loadProject` suchte den Raum zu einer gespeicherten
 * Angabe über den Schwerpunkt — in *allen* Geschossen. Bei
 * übereinanderliegenden Grundrissen liegt der Schwerpunkt des Schlafzimmers
 * im OG genau über dem Wohnzimmer im EG, und der erste Treffer gewann.
 *
 * **Das Prüfhaus** — zwei Geschosse, jedes 8 × 6 m, in der Mitte geteilt,
 * beide Grundrisse deckungsgleich übereinander:
 *
 *        (0,6) ───── (4,6) ───── (8,6)
 *          │  links    │  rechts   │
 *        (0,0) ───── (4,0) ───── (8,0)
 *
 *   EG: links „Wohnen" (Schwerpunkt 2|3), rechts „Küche" (6|3)
 *   OG: links „Schlafen" (2|3),           rechts „Bad"   (6|3)
 *
 * Die Schwerpunkte beider Geschosse sind **dieselben Punkte**. Genau daran
 * scheitert die Suche ohne Geschoss: Vier gespeicherte Räume beanspruchen
 * zwei erkannte. Mit Geschossfilter ist die Zuordnung eindeutig.
 */

import type { Level, Room } from '../../src/types/bim';
import { geschossVon, ordneRaeumeZu } from '../../src/lib/raumZuordnung';
import type { CheckFn } from './typ';

const HALB = [
  { links: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 6 }, { x: 0, y: 6 }] },
  { rechts: [{ x: 4, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 6 }, { x: 4, y: 6 }] },
] as const;
const LINKS = HALB[0].links;
const RECHTS = HALB[1].rechts;

const level = (id: string, name: string, order: number): Level =>
  ({ id, name, order, elevation: order * 2.75, height: 2.5 } as Level);

const LEVELS: Record<string, Level> = {
  kg: level('kg', 'KG', -1),
  eg: level('eg', 'EG', 0),
  og: level('og', 'OG', 1),
};

const raum = (id: string, levelId: string, poly: readonly { x: number; y: number }[], area: number): Room =>
  ({
    id,
    levelId,
    name: `Raum ${id}`,
    usage: 'other',
    polygon: [...poly],
    innerPolygon: [...poly],
    area,
    grossArea: area,
    perimeter: 20,
    height: 2.5,
    volume: area * 2.5,
    centroid: {
      x: poly.reduce((s, p) => s + p.x, 0) / poly.length,
      y: poly.reduce((s, p) => s + p.y, 0) / poly.length,
    },
    boundaries: [],
    setpointTemperature: 20,
    airChangeRate: 0.5,
    isHeated: true,
    groundContactPerimeter: 0,
    exposedFacadeCount: 1,
  } as unknown as Room);

const ERKANNT: Room[] = [
  raum('room-eg-0', 'eg', LINKS, 24),
  raum('room-eg-1', 'eg', RECHTS, 24),
  raum('room-og-0', 'og', LINKS, 24),
  raum('room-og-1', 'og', RECHTS, 24),
];

/** Wie die Projektdatei die Räume schreibt: mit Geschossnamen in `level`. */
const gespeichert = (id: string, lvl: string, poly: readonly { x: number; y: number }[], area?: number) =>
  ({ id, level: lvl, polygon: [...poly], ...(area === undefined ? {} : { area }) });

export function pruefeRaumzuordnung(check: CheckFn): void {
  // =========================================================================
  // 1 · Zwei deckungsgleiche Geschosse
  // =========================================================================
  {
    const datei = [
      gespeichert('room-eg-0', 'EG', LINKS, 24),
      gespeichert('room-eg-1', 'EG', RECHTS, 24),
      gespeichert('room-og-0', 'OG', LINKS, 24),
      gespeichert('room-og-1', 'OG', RECHTS, 24),
    ];
    const t = ordneRaeumeZu(datei, ERKANNT, LEVELS);
    check('EG links bleibt im EG', t[0]?.id ?? 'fehlt', 'room-eg-0');
    check('EG rechts bleibt im EG', t[1]?.id ?? 'fehlt', 'room-eg-1');
    check('OG links bleibt im OG', t[2]?.id ?? 'fehlt', 'room-og-0');
    check('OG rechts bleibt im OG', t[3]?.id ?? 'fehlt', 'room-og-1');
    check('Jeder erkannte Raum genau einmal vergeben', new Set(t.map((r) => r?.id)).size, 4);
  }

  // =========================================================================
  // 2 · Woher das Geschoss kommt
  // =========================================================================
  {
    check('Aus der Geschosskennung', geschossVon({ levelId: 'og' }, LEVELS) ?? 'fehlt', 'og');
    check('Aus dem Geschossnamen', geschossVon({ level: 'OG' }, LEVELS) ?? 'fehlt', 'og');
    check('Groß-/Kleinschreibung egal', geschossVon({ level: ' og ' }, LEVELS) ?? 'fehlt', 'og');
    check('Aus der Raumkennung', geschossVon({ id: 'room-kg-3' }, LEVELS) ?? 'fehlt', 'kg');
    check('Kennung schlägt nicht zu kurz an', geschossVon({ id: 'room-ogx-1' }, LEVELS) ?? 'fehlt', 'fehlt');
    check('Ohne Angabe: kein Geschoss', geschossVon({ polygon: [...LINKS] }, LEVELS) ?? 'fehlt', 'fehlt');
    check(
      'Unbekanntes Geschoss zählt nicht',
      geschossVon({ levelId: 'dg', level: 'DG' }, LEVELS) ?? 'fehlt',
      'fehlt',
    );
  }

  // =========================================================================
  // 3 · Nur die Kennung, kein Geschossname (ältere Dateien)
  // =========================================================================
  {
    const datei = [
      { id: 'room-og-1', polygon: [...RECHTS] },
      { id: 'room-eg-1', polygon: [...RECHTS] },
    ];
    const t = ordneRaeumeZu(datei, ERKANNT, LEVELS);
    check('Kennung führt ins OG', t[0]?.id ?? 'fehlt', 'room-og-1');
    check('… und ins EG', t[1]?.id ?? 'fehlt', 'room-eg-1');
  }

  // =========================================================================
  // 4 · Ganz ohne Geschossangabe: wie früher, aber ohne Doppelvergabe
  // =========================================================================
  {
    const datei = [{ polygon: [...LINKS] }, { polygon: [...LINKS] }];
    const t = ordneRaeumeZu(datei, ERKANNT, LEVELS);
    check('Der erste bekommt einen Raum', t[0] !== undefined || t[1] !== undefined, true);
    check('Aber nicht beide denselben', t[0]?.id === t[1]?.id && t[0] !== undefined, false);
  }

  // =========================================================================
  // 5 · Umbau: zwei gespeicherte Räume, ein erkannter
  // =========================================================================
  /*
   * Aus zwei Zimmern ist eines geworden (die Trennwand ist weg). Beide
   * Schwerpunkte liegen jetzt im großen Raum von 48 m². Den Zuschlag bekommt
   * der mit der ähnlicheren Fläche: 40 m² gegenüber 8 m².
   */
  {
    const gross = raum('room-eg-0', 'eg', [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 6 }, { x: 0, y: 6 }], 48);
    const datei = [
      gespeichert('room-eg-1', 'EG', RECHTS, 8),
      gespeichert('room-eg-0', 'EG', LINKS, 40),
    ];
    const t = ordneRaeumeZu(datei, [gross], LEVELS);
    check('Umbau: der kleine geht leer aus', t[0]?.id ?? 'fehlt', 'fehlt');
    check('Umbau: die ähnlichere Fläche gewinnt', t[1]?.id ?? 'fehlt', 'room-eg-0');
  }

  // =========================================================================
  // 6 · Nichts mehr da, wo der Raum war
  // =========================================================================
  {
    const weg = [{ id: 'room-kg-0', level: 'KG', polygon: [...LINKS] }];
    check('Kein Raum im KG: keine Zuordnung', ordneRaeumeZu(weg, ERKANNT, LEVELS)[0]?.id ?? 'fehlt', 'fehlt');

    const daneben = [gespeichert('room-eg-0', 'EG', [{ x: 20, y: 20 }, { x: 24, y: 20 }, { x: 24, y: 26 }], 24)];
    check('Schwerpunkt außerhalb: keine Zuordnung', ordneRaeumeZu(daneben, ERKANNT, LEVELS)[0]?.id ?? 'fehlt', 'fehlt');

    check('Ohne Polygon: keine Zuordnung', ordneRaeumeZu([{ id: 'room-eg-0', level: 'EG' }], ERKANNT, LEVELS)[0]?.id ?? 'fehlt', 'fehlt');
    check('Zu wenige Stützpunkte: keine Zuordnung',
      ordneRaeumeZu([{ level: 'EG', polygon: [{ x: 1, y: 1 }, { x: 2, y: 2 }] }], ERKANNT, LEVELS)[0]?.id ?? 'fehlt', 'fehlt');
    check('Leere Datei: leeres Ergebnis', ordneRaeumeZu([], ERKANNT, LEVELS).length, 0);
  }

  // =========================================================================
  // 7 · Die Gegenprobe: ohne Geschossfilter wäre es falsch
  // =========================================================================
  /*
   * Nachgestellt wird der alte Weg — erster Treffer über alle Geschosse. Er
   * schiebt die OG-Angaben ins EG. Diese Prüfung hält fest, *dass* die alte
   * Regel falsch war; sie darf nie wieder grün werden.
   */
  {
    const datei = [
      gespeichert('room-og-0', 'OG', LINKS, 24),
      gespeichert('room-og-1', 'OG', RECHTS, 24),
    ];
    const alterWeg = datei.map((saved) => {
      const mitte = {
        x: saved.polygon.reduce((s, p) => s + p.x, 0) / saved.polygon.length,
        y: saved.polygon.reduce((s, p) => s + p.y, 0) / saved.polygon.length,
      };
      return ERKANNT.find((r) => {
        // Punkt-im-Polygon, absichtlich schlicht: es geht nur um „erster Treffer".
        const xs = r.innerPolygon.map((p) => p.x);
        const ys = r.innerPolygon.map((p) => p.y);
        return mitte.x > Math.min(...xs) && mitte.x < Math.max(...xs)
          && mitte.y > Math.min(...ys) && mitte.y < Math.max(...ys);
      });
    });
    check('Der alte Weg greift ins EG', alterWeg[0]?.id ?? 'fehlt', 'room-eg-0');
    check('… und zwar bei jedem Raum', alterWeg[1]?.id ?? 'fehlt', 'room-eg-1');
    const neu = ordneRaeumeZu(datei, ERKANNT, LEVELS);
    check('Der neue Weg nicht', [neu[0]?.id, neu[1]?.id].join(','), 'room-og-0,room-og-1');
  }
}
