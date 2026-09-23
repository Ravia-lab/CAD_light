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
import { innererPunkt, pointInPolygon, polygonCentroid } from '../../src/lib/geometry';
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

  // =========================================================================
  // 6 · Offener Wohnbereich — der Suchpunkt muss im Raum liegen
  // =========================================================================
  /*
   * **Die zweite Meldung, gefunden im Gegenlauf der 46 Swiss-Dwellings-
   * Wohnungen (23.09.2026):** 11 von 338 Räumen hießen nach Speichern und
   * Öffnen wieder „Raum 1" — immer derselbe Zuschnitt, der offene Wohnbereich
   * „Wohnen/Essen + Flur + Küche".
   *
   * **Die Ursache:** Gesucht wurde über den Mittelwert der Ecken. Bei einem
   * L-förmigen Raum liegt der im fehlenden Schenkel, also außerhalb des
   * eigenen Raums. Kein erkannter Raum enthielt ihn, die Angaben fielen
   * stumm weg.
   *
   * **Das Prüfpolygon** — L-Form, 6 × 2 m unten, 2 × 4 m links oben:
   *
   *        (0,6) ─ (2,6)
   *          │       │
   *          │     (2,2) ───── (6,2)
   *          │                   │
   *        (0,0) ───────────── (6,0)
   *
   * Alle Sollwerte unten sind von Hand gerechnet, nicht aus einem Lauf
   * abgeschrieben.
   */
  {
    const L = [
      { x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 2 },
      { x: 2, y: 2 }, { x: 2, y: 6 }, { x: 0, y: 6 },
    ];

    // Eckenmittel: x = (0+6+6+2+2+0)/6 = 16/6, y = (0+0+2+2+6+6)/6 = 16/6.
    const mittel = {
      x: L.reduce((sum, q) => sum + q.x, 0) / L.length,
      y: L.reduce((sum, q) => sum + q.y, 0) / L.length,
    };
    check('L-Form: Eckenmittel x', mittel.x, 16 / 6, 1e-9);
    check('L-Form: Eckenmittel y', mittel.y, 16 / 6, 1e-9);
    // 2,667 > 2 in beiden Richtungen — das ist der ausgesparte Schenkel.
    check('L-Form: das Eckenmittel liegt außerhalb', pointInPolygon(mittel, L), false);

    /*
     * Auch der Flächenschwerpunkt hilft nicht: Rechteck unten 6 × 2 = 12 m²
     * mit Schwerpunkt (3|1), Rechteck oben 2 × 4 = 8 m² mit (1|4).
     *   x = (12·3 + 8·1) / 20 = 44/20 = 2,2   y = (12·1 + 8·4) / 20 = 2,2
     * (2,2 | 2,2) liegt ebenfalls im ausgesparten Schenkel.
     */
    const flaechenmitte = polygonCentroid(L);
    check('L-Form: Flächenschwerpunkt x', flaechenmitte.x, 2.2, 1e-9);
    check('L-Form: Flächenschwerpunkt y', flaechenmitte.y, 2.2, 1e-9);
    check('L-Form: auch der Flächenschwerpunkt liegt außerhalb', pointInPolygon(flaechenmitte, L), false);

    /*
     * Der Abtaststrahl: Ecken-Höhen 0, 2, 6 ergeben die Höhen 1 und 4.
     *   y = 1 → innen von x = 0 bis x = 6, Länge 6, Mitte (3|1)
     *   y = 4 → innen von x = 0 bis x = 2, Länge 2, Mitte (1|4)
     * Die längere Strecke gewinnt.
     */
    const innen = innererPunkt(L);
    check('L-Form: innerer Punkt x', innen.x, 3, 1e-9);
    check('L-Form: innerer Punkt y', innen.y, 1, 1e-9);
    check('L-Form: er liegt im Polygon', pointInPolygon(innen, L), true);

    // Beim Rechteck bleibt alles wie bisher: das Eckenmittel liegt innen.
    const rechteck = innererPunkt(LINKS);
    check('Rechteck: innerer Punkt bleibt das Eckenmittel x', rechteck.x, 2, 1e-9);
    check('Rechteck: innerer Punkt bleibt das Eckenmittel y', rechteck.y, 3, 1e-9);

    /*
     * U-Form (0,0) (6,0) (6,6) (4,6) (4,2) (2,2) (2,6) (0,6): Eckenmittel
     * x = 24/8 = 3, y = 28/8 = 3,5 — mitten im Einschnitt, also außen.
     * Bei y = 4 zerfällt das Innere in zwei Strecken von je 2 m (0…2 und
     * 4…6); bei y = 1 ist es eine Strecke von 6 m. Die gewinnt: (3|1).
     */
    const U = [
      { x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 6 }, { x: 4, y: 6 },
      { x: 4, y: 2 }, { x: 2, y: 2 }, { x: 2, y: 6 }, { x: 0, y: 6 },
    ];
    const uMittel = {
      x: U.reduce((sum, q) => sum + q.x, 0) / U.length,
      y: U.reduce((sum, q) => sum + q.y, 0) / U.length,
    };
    check('U-Form: Eckenmittel (3|3,5) liegt im Einschnitt', pointInPolygon(uMittel, U), false);
    const uInnen = innererPunkt(U);
    check('U-Form: innerer Punkt x', uInnen.x, 3, 1e-9);
    check('U-Form: innerer Punkt y', uInnen.y, 1, 1e-9);
    check('U-Form: er liegt im Polygon', pointInPolygon(uInnen, U), true);

    /*
     * Und der Fall, wie er im Projekt auftritt: ein erkannter L-Raum, dazu
     * die gespeicherte Angabe mit demselben Polygon. Vorher fiel der Name
     * weg, weil der Suchpunkt außerhalb lag.
     */
    const erkannt = [raum('room-eg-wohnen', 'eg', L, 20)];
    const treffer = ordneRaeumeZu([gespeichert('room-eg-wohnen', 'EG', L, 20)], erkannt, LEVELS);
    check('Offener Wohnbereich wird wiedergefunden', treffer[0]?.id ?? 'fehlt', 'room-eg-wohnen');

    // Gegenprobe: mit dem Eckenmittel als Suchpunkt findet sich nichts.
    check(
      'Gegenprobe — mit dem Eckenmittel fände sich kein Raum',
      erkannt.some((r) => pointInPolygon(mittel, r.innerPolygon)),
      false,
    );
  }
}
