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
  MESSSTRECKE_MIN,
  meterJeMm,
  nachWelt,
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

  // -------------------------------------------------------------------------
  // 5 · Der Maßstab — die eine Angabe, ohne die nichts geht
  // -------------------------------------------------------------------------
  /*
   * Ein Blatt hat Millimeter, ein Gebäude hat Meter. Der Maßstab ist die
   * Brücke, und er ist die ganze Schwierigkeit: Jeder Fehler darin wird mit
   * dem Maßstabsfaktor auf jedes Maß im Modell umgelegt.
   *
   * Messstrecke von (20|100) nach (120|100): 100 mm Papier. Beschriftet mit
   * 10,00 m → **0,1 m je mm**, also 1 m = 10 mm (Maßstab 1:100).
   */
  const massstab = { von: { x: 20, y: 100 }, nach: { x: 120, y: 100 }, laenge: 10 };
  check('Skizzenseite · 100 mm für 10 m ergeben 0,1 m/mm', meterJeMm(massstab) ?? -1, 0.1, 1e-12);
  // Schräg gemessen zählt die Länge der Strecke: (0|0) nach (30|40) sind 50 mm
  // (3-4-5-Dreieck), beschriftet mit 5,00 m → 0,1 m/mm, dasselbe Ergebnis.
  check('Skizzenseite · schräg gemessen zählt die Strecke',
    meterJeMm({ von: { x: 0, y: 0 }, nach: { x: 30, y: 40 }, laenge: 5 }) ?? -1, 0.1, 1e-12);

  /*
   * **Die Gegenproben, auf die es ankommt.** Eine zu kurze Messstrecke legt
   * jeden Zeichenfehler vergrößert um: 4 mm Papier für 3,50 m sind 875 mm je
   * Meter — zwei Millimeter danebengetippt wären anderthalb Meter Wand.
   * Deshalb gibt es darunter **keinen** Maßstab und nicht einen schlechten.
   */
  check('Skizzenseite · die Schranke steht bei 20 mm', MESSSTRECKE_MIN, 20);
  check('Skizzenseite · 4 mm Messstrecke ergeben keinen Maßstab',
    meterJeMm({ von: { x: 0, y: 0 }, nach: { x: 4, y: 0 }, laenge: 3.5 }) === undefined, true);
  // Genau an der Schranke gilt er noch — 20 mm für 2 m sind 0,1 m/mm.
  check('Skizzenseite · genau 20 mm gelten noch',
    meterJeMm({ von: { x: 0, y: 0 }, nach: { x: 20, y: 0 }, laenge: 2 }) ?? -1, 0.1, 1e-12);
  // Ohne Länge und ohne Maßstab gibt es nichts zu rechnen.
  check('Skizzenseite · Länge 0 ergibt keinen Maßstab',
    meterJeMm({ von: { x: 0, y: 0 }, nach: { x: 100, y: 0 }, laenge: 0 }) === undefined, true);
  check('Skizzenseite · kein Maßstab ergibt keinen Faktor', meterJeMm(undefined) === undefined, true);

  // -------------------------------------------------------------------------
  // 6 · Vom Blatt in die Welt — und die umgeklappte y-Achse
  // -------------------------------------------------------------------------
  /*
   * Auf dem Blatt zählt y nach **unten**, im Modell nach **oben**. Beim
   * Umrechnen wird y deshalb gespiegelt: y_welt = (210 − y_blatt) · Faktor.
   * Ohne das käme der Grundriss gespiegelt an, und eine Spiegelung sieht man
   * an einem freihändigen Umriss erst, wenn das Bad an der falschen Hausseite
   * liegt.
   *
   * Faktor 0,1 m/mm. Blattpunkt (0|210) ist die **untere linke** Ecke des
   * Papiers → Welt (0|0). Blattpunkt (0|0) ist oben links → Welt (0|21,0),
   * denn 210 mm Papier sind bei diesem Maßstab 21,0 m.
   */
  const welt = nachWelt([{ x: 0, y: 210 }, { x: 0, y: 0 }, { x: 100, y: 110 }], 0.1);
  check('Skizzenseite · untere linke Blattecke liegt im Ursprung x', welt[0].x, 0, 1e-12);
  check('Skizzenseite · … und y', welt[0].y, 0, 1e-12);
  check('Skizzenseite · obere linke Ecke liegt bei y = 21 m', welt[1].y, 21, 1e-12);
  // (100|110): x = 10,0 m, y = (210 − 110) · 0,1 = 10,0 m.
  check('Skizzenseite · ein Punkt in der Mitte x', welt[2].x, 10, 1e-12);
  check('Skizzenseite · ein Punkt in der Mitte y', welt[2].y, 10, 1e-12);
  /*
   * **Die Gegenprobe zur Spiegelung:** Ein Punkt, der auf dem Blatt *weiter
   * unten* liegt, muss in der Welt *weiter unten* liegen — also einen
   * kleineren y-Wert haben. Ohne das Umklappen wäre es umgekehrt, und genau
   * das ist der Fehler, den man nicht sieht.
   */
  const paar = nachWelt([{ x: 0, y: 50 }, { x: 0, y: 150 }], 0.1);
  check('Skizzenseite · weiter unten auf dem Blatt heißt weiter unten in der Welt',
    paar[1].y < paar[0].y, true);
  // Der Ursprung verschiebt beides gleich: + (5|7) m.
  const versetzt = nachWelt([{ x: 0, y: 210 }], 0.1, { x: 5, y: 7 });
  check('Skizzenseite · der Ursprung verschiebt x', versetzt[0].x, 5, 1e-12);
  check('Skizzenseite · der Ursprung verschiebt y', versetzt[0].y, 7, 1e-12);
  /*
   * Und der Maßstab wirkt auf Längen: Zwei Punkte, 100 mm auseinander, sind
   * bei 0,1 m/mm genau 10,00 m auseinander — die Länge, die der Anwender
   * beschriftet hat. Das ist die Probe, die Maßstab und Umrechnung
   * zusammenhält.
   */
  const strecke = nachWelt([{ x: 20, y: 100 }, { x: 120, y: 100 }], meterJeMm(massstab) as number);
  check('Skizzenseite · die beschriftete Strecke ist in der Welt 10 m lang',
    Math.hypot(strecke[1].x - strecke[0].x, strecke[1].y - strecke[0].y), 10, 1e-12);
}
