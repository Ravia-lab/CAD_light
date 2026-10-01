/**
 * Prüfblock „Skizzenseite" — das Blatt Papier neben dem Modell.
 *
 * **Was hier geprüft wird.** Die Seite trägt keine Geometrie, also gibt es
 * wenig zu rechnen — aber zwei Dinge, bei denen ein Fehler teuer wäre: das
 * **Ausdünnen** der Stützpunkte, das in jeder gespeicherten Datei landet, und
 * die **Blattnamen**, die fortlaufend bleiben müssen, weil zwei gleich
 * benannte Blätter im Schriftverkehr nicht zu unterscheiden sind.
 *
 * Alle Sollwerte sind von Hand hergeleitet.
 */

import type { CheckFn } from './typ';
import type { Vec2 } from '../../src/types/bim';
import {
  BLATT,
  STIFTFARBEN,
  STRICHSTAERKEN,
  duenneAus,
  istLeer,
  naechsterBlattname,
  neueSeite,
  punktzahl,
  strichZurueck,
  umriss,
  type Skizzenseite,
} from '../../src/lib/skizzenseite';

export function pruefeSkizzenseite(check: CheckFn): void {
  // -------------------------------------------------------------------------
  // 1 · Das Blatt
  // -------------------------------------------------------------------------
  // A4 quer: 297 × 210 mm. Querformat, weil ein Strangschema breiter als hoch ist.
  check('Skizzenseite · A4 quer', `${BLATT.breite}×${BLATT.hoehe}`, '297×210');
  check('Skizzenseite · breiter als hoch', BLATT.breite > BLATT.hoehe, true);
  check('Skizzenseite · vier Farben', STIFTFARBEN.length, 4);
  check('Skizzenseite · jede Farbe hat eine Bedeutung',
    STIFTFARBEN.every((f) => f.label.length > 2), true);
  check('Skizzenseite · vier Strichstärken', STRICHSTAERKEN.length, 4);
  check('Skizzenseite · die feinste ist 0,5 mm', Math.min(...STRICHSTAERKEN), 0.5, 1e-9);

  const leer = neueSeite('s1', 'Blatt 1', '2026-10-01T10:00:00.000Z');
  check('Skizzenseite · ein neues Blatt ist leer', istLeer(leer), true);
  check('Skizzenseite · und hat keine Punkte', punktzahl(leer), 0);
  check('Skizzenseite · ein leeres Blatt hat keinen Umriss', umriss(leer) === undefined, true);

  // -------------------------------------------------------------------------
  // 2 · Blattnamen laufen fort
  // -------------------------------------------------------------------------
  check('Skizzenseite · das erste heißt Blatt 1', naechsterBlattname([]), 'Blatt 1');
  const drei: Skizzenseite[] = [1, 2, 3].map((n) => neueSeite(`s${n}`, `Blatt ${n}`, '2026-10-01T10:00:00.000Z'));
  check('Skizzenseite · nach drei kommt vier', naechsterBlattname(drei), 'Blatt 4');
  /*
   * Und nach dem Löschen des zweiten kommt **fünf**, nicht zwei. Eine Nummer
   * wiederzuverwenden hieße, zwei verschiedene Skizzen im Schriftverkehr
   * gleich zu nennen — „schick mir Blatt 2" wäre dann zweideutig.
   */
  check('Skizzenseite · Nummern werden nicht wiederverwendet',
    naechsterBlattname([drei[0], drei[2]]), 'Blatt 4');
  // Ein eigener Name stört die Zählung nicht.
  check('Skizzenseite · eigene Namen stören nicht',
    naechsterBlattname([neueSeite('x', 'Strangschema Keller', '2026-10-01T10:00:00.000Z')]), 'Blatt 1');

  // -------------------------------------------------------------------------
  // 3 · Ausdünnen — was in der Datei landet
  // -------------------------------------------------------------------------
  /*
   * Eine gerade Linie von (0|0) nach (100|0), mit zehn Zwischenpunkten exakt
   * auf der Linie. Alle zehn sind überflüssig: Übrig bleiben Anfang und Ende.
   */
  const gerade: Vec2[] = Array.from({ length: 12 }, (_, i) => ({ x: i * 10, y: 0 }));
  check('Skizzenseite · die Gerade wird auf zwei Punkte gekürzt', duenneAus(gerade).length, 2);
  check('Skizzenseite · Anfang bleibt', duenneAus(gerade)[0].x, 0, 1e-9);
  check('Skizzenseite · Ende bleibt', duenneAus(gerade)[1].x, 110, 1e-9);

  /*
   * Eine Ecke darf **nicht** verschwinden: (0|0) → (50|50) → (100|0). Der
   * mittlere Punkt liegt 35,36 mm von der Verbindungslinie entfernt, weit
   * über der Schranke von 0,3 mm.
   */
  const ecke: Vec2[] = [{ x: 0, y: 0 }, { x: 50, y: 50 }, { x: 100, y: 0 }];
  check('Skizzenseite · die Ecke bleibt', duenneAus(ecke).length, 3);

  /*
   * Ein Zittern von 0,1 mm quer zur Linie liegt unter der Schranke und fällt
   * weg — das ist die Handbewegung, nicht die Zeichnung.
   */
  const zittern: Vec2[] = Array.from({ length: 21 }, (_, i) => ({
    x: i * 5,
    y: i % 2 === 0 ? 0.1 : -0.1,
  }));
  check('Skizzenseite · Zittern unter 0,3 mm fällt weg', duenneAus(zittern).length, 2);
  /*
   * Ein Zittern von 2 mm ist dagegen gezeichnet und bleibt. Gegenprobe zur
   * vorigen Zeile: Eine Ausdünnung, die alles glattbügelt, macht aus einer
   * Handskizze eine Gerade.
   */
  const gewollt: Vec2[] = Array.from({ length: 21 }, (_, i) => ({
    x: i * 5,
    y: i % 2 === 0 ? 2 : -2,
  }));
  check('Skizzenseite · ein gezeichnetes Zickzack bleibt', duenneAus(gewollt).length > 10, true);

  // Zwei Punkte bleiben zwei Punkte, einer bleibt einer — keine Sonderfälle.
  check('Skizzenseite · zwei Punkte bleiben', duenneAus([{ x: 0, y: 0 }, { x: 1, y: 1 }]).length, 2);
  check('Skizzenseite · ein Punkt bleibt', duenneAus([{ x: 0, y: 0 }]).length, 1);
  check('Skizzenseite · nichts bleibt nichts', duenneAus([]).length, 0);

  // -------------------------------------------------------------------------
  // 4 · Striche, Umriss, Zurücknehmen
  // -------------------------------------------------------------------------
  const mitStrichen: Skizzenseite = {
    ...leer,
    striche: [
      { id: 'a', punkte: [{ x: 10, y: 20 }, { x: 60, y: 20 }], farbe: 'schwarz', staerke: 1 },
      { id: 'b', punkte: [{ x: 30, y: 5 }, { x: 30, y: 80 }], farbe: 'rot', staerke: 2 },
    ],
  };
  check('Skizzenseite · zwei Striche', mitStrichen.striche.length, 2);
  check('Skizzenseite · vier Punkte', punktzahl(mitStrichen), 4);
  check('Skizzenseite · nicht mehr leer', istLeer(mitStrichen), false);
  /*
   * Umriss von Hand: x von 10 bis 60, y von 5 bis 80 → Ecke (10|5),
   * 50 mm breit, 75 mm hoch.
   */
  const u = umriss(mitStrichen);
  check('Skizzenseite · Umriss links oben x', u?.x ?? -1, 10, 1e-9);
  check('Skizzenseite · Umriss links oben y', u?.y ?? -1, 5, 1e-9);
  check('Skizzenseite · Umriss 50 mm breit', u?.breite ?? -1, 50, 1e-9);
  check('Skizzenseite · Umriss 75 mm hoch', u?.hoehe ?? -1, 75, 1e-9);

  // Zurücknehmen nimmt den **letzten**, nicht irgendeinen.
  const einer = strichZurueck(mitStrichen);
  check('Skizzenseite · zurück nimmt einen Strich', einer.striche.length, 1);
  check('Skizzenseite · und zwar den letzten', einer.striche[0].id, 'a');
  // Und auf einem leeren Blatt tut es nichts — statt zu werfen.
  check('Skizzenseite · zurück auf leerem Blatt tut nichts', strichZurueck(leer).striche.length, 0);
}
