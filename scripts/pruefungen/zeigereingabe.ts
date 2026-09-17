/**
 * Prüfblock „Zeigereingabe" — Stift, Finger und der Handballen.
 *
 * **Warum das geprüft gehört, obwohl es „nur Bedienung" ist.** Ein
 * Handballen, der als zweiter Zeiger durchkommt, zieht eine Wand quer durch
 * die Wohnung. Das ist kein Darstellungsfehler — es steht danach echte
 * Geometrie im Modell, die niemand gezeichnet hat, und sie geht in die
 * Heizlast ein. Die Regel muss also so verlässlich sein wie eine Rechnung,
 * und deshalb wird sie wie eine geprüft.
 *
 * **Was hier nicht geprüft wird.** Ob ein echtes iPad seine Ereignisse so
 * meldet, wie dieses Modul es annimmt. Das kann keine Prüfung dieser Art
 * wissen; dafür gibt es den Rauchtest auf Tabletmaß, der Stift- und
 * Berührungsereignisse wirklich auslöst. Hier steht die Regel selbst auf dem
 * Prüfstand: bei dieser Zeigerlage geschieht dies und nichts anderes.
 *
 * Alle Sollwerte folgen aus der Sache und nicht aus einem Probelauf.
 */

import type { CheckFn } from './typ';
import {
  EINGABE_VORGABE,
  TIPP_DAUER_MS,
  TIPP_WEG_PX,
  TIPP_WERKZEUGE,
  istTipp,
  tippBedient,
  FANG_FAKTOR,
  STIFT_KARENZ_MS,
  TIPPZIEL,
  ZEIGERLAGE_LEER,
  ZOOM_MAX,
  ZOOM_MIN,
  absicht,
  eingabeart,
  fortschreiben,
  gestenschritt,
  zuWelt,
} from '../../src/lib/zeigereingabe';
import type { Zeigerlage } from '../../src/lib/zeigereingabe';

export function pruefeZeigereingabe(check: CheckFn): void {
  // =========================================================================
  // 1 · Die Eingabeart aus dem Ereignis
  // =========================================================================
  {
    check('„pen" ist der Stift', eingabeart('pen'), 'stift');
    check('„touch" ist der Finger', eingabeart('touch'), 'finger');
    check('„mouse" ist die Maus', eingabeart('mouse'), 'maus');
    // Ein Gerät, das sich nicht zu erkennen gibt, verhält sich wie bisher —
    // und nicht plötzlich wie ein Tablet.
    check('Unbekanntes gilt als Maus', eingabeart('trackpad-von-morgen'), 'maus');
    check('Fehlende Angabe gilt als Maus', eingabeart(undefined), 'maus');
  }

  // =========================================================================
  // 2 · Der Handballen — der Fehler, der das Gerät unbenutzbar macht
  // =========================================================================
  {
    const t = 10_000;

    // Der Stift setzt auf. Was jetzt an Fingern kommt, ist die Hand.
    let lage: Zeigerlage = fortschreiben(ZEIGERLAGE_LEER, 'stift', 'runter', t);
    check('Der Stift zeichnet', absicht('stift', ZEIGERLAGE_LEER, t), 'zeichnen');
    check('Der Handballen daneben wird verworfen', absicht('finger', lage, t + 5), 'verwerfen');
    check('Auch ein zweiter Handballenpunkt', absicht('finger', { ...lage, finger: 1 }, t + 9), 'verwerfen');

    // Der Stift hebt ab. Die Hand liegt noch einen Moment.
    lage = fortschreiben(lage, 'stift', 'hoch', t + 400);
    check('Der Stift liegt nicht mehr auf', lage.stiftUnten, false);
    check(
      'Unmittelbar nach dem Abheben zeichnet kein Finger',
      absicht('finger', lage, t + 400 + STIFT_KARENZ_MS - 1),
      'verwerfen',
    );
    // Nach der Karenz ist es wieder ein gewöhnlicher Finger — und der schiebt.
    check(
      'Nach der Karenz schiebt der Finger wieder',
      absicht('finger', lage, t + 400 + STIFT_KARENZ_MS + 1),
      'schieben',
    );
    // Die Karenz ist kurz genug, dass niemand darauf wartet.
    check('Die Karenz liegt unter einer Sekunde', STIFT_KARENZ_MS < 1000, true);

    // Und der Stift gewinnt auch dann, wenn schon Finger liegen: wer den
    // Stift ansetzt, meint den Stift.
    check('Der Stift schlägt zwei aufliegende Finger', absicht('stift', { ...ZEIGERLAGE_LEER, finger: 2 }, t), 'zeichnen');
  }

  // =========================================================================
  // 3 · Ein Finger schiebt, zwei zoomen, drei sind die Handfläche
  // =========================================================================
  {
    const t = 1000;
    check('Der erste Finger schiebt', absicht('finger', ZEIGERLAGE_LEER, t), 'schieben');
    check('Der zweite Finger macht eine Geste', absicht('finger', { ...ZEIGERLAGE_LEER, finger: 1 }, t), 'geste');
    check('Der dritte wird verworfen', absicht('finger', { ...ZEIGERLAGE_LEER, finger: 2 }, t), 'verwerfen');
    check('Der vierte auch', absicht('finger', { ...ZEIGERLAGE_LEER, finger: 3 }, t), 'verwerfen');

    // Umgestellt auf ein Gerät ohne Stift: dann zeichnet der einzelne Finger.
    check(
      'Ohne Stift am Gerät zeichnet der Finger',
      absicht('finger', ZEIGERLAGE_LEER, t, { fingerZeichnet: true }),
      'zeichnen',
    );
    // Aber zwei Finger bleiben eine Geste — sonst gäbe es am fingergeführten
    // Gerät keinen Weg mehr, den Ausschnitt zu ändern.
    check(
      '… zwei Finger bleiben trotzdem die Geste',
      absicht('finger', { ...ZEIGERLAGE_LEER, finger: 1 }, t, { fingerZeichnet: true }),
      'geste',
    );
    check('Vorgabe ist: der Finger zeichnet nicht', EINGABE_VORGABE.fingerZeichnet, false);

    // Die Maus bleibt von allem unberührt.
    check('Die Maus zeichnet immer', absicht('maus', { finger: 2, stiftUnten: true, stiftZuletzt: t }, t), 'zeichnen');
  }

  // =========================================================================
  // 4 · Das Zählwerk der aufliegenden Finger
  // =========================================================================
  {
    let lage = ZEIGERLAGE_LEER;
    lage = fortschreiben(lage, 'finger', 'runter', 1);
    lage = fortschreiben(lage, 'finger', 'runter', 2);
    check('Zwei Finger liegen auf', lage.finger, 2);
    lage = fortschreiben(lage, 'finger', 'hoch', 3);
    check('Einer wird abgehoben', lage.finger, 1);
    lage = fortschreiben(lage, 'finger', 'hoch', 4);
    check('Und der letzte', lage.finger, 0);
    // Ein verlorenes Abheben — der Browser meldet nicht jedes `pointerup`,
    // etwa wenn das Fenster den Fokus verliert — darf den Zähler nicht unter
    // null treiben. Sonst zeichnet danach nie wieder ein Finger.
    lage = fortschreiben(lage, 'finger', 'hoch', 5);
    check('Ein Abheben zu viel geht nicht ins Minus', lage.finger, 0);
    check('Die Maus ändert die Zeigerlage nicht', fortschreiben(lage, 'maus', 'runter', 6).finger, 0);
  }

  // =========================================================================
  // 5 · Fangradien — die Fingerkuppe ist keine Mausspitze
  // =========================================================================
  {
    check('Die Maus bleibt bei ihrem Wert', FANG_FAKTOR.maus, 1);
    check('Der Stift fängt großzügiger', FANG_FAKTOR.stift > 1, true);
    check('Der Finger am großzügigsten', FANG_FAKTOR.finger > FANG_FAKTOR.stift, true);
    // Eine Fingerkuppe ist rund 8 bis 10 mm breit, auf einem iPad also etwa
    // 25 CSS-Pixel Halbmesser. Bei einer Einstellung von 12 px sind das
    // Faktor 2 bis 2,5 — darunter trifft der Finger nichts, darüber fängt er
    // Dinge, die er nicht meint.
    check('Der Fingerfaktor liegt zwischen 2 und 3', FANG_FAKTOR.finger >= 2 && FANG_FAKTOR.finger <= 3, true);
    // Apple und Google nennen beide 44 bzw. 48 Punkte als kleinste
    // Schaltfläche. 44 ist der strengere und damit der richtige Wert.
    check('Das Tippziel ist mindestens 44 Pixel', TIPPZIEL >= 44, true);
  }

  // =========================================================================
  // 6 · Die Zwei-Finger-Geste — der Punkt zwischen den Fingern bleibt liegen
  // =========================================================================
  {
    const feld = { w: 1000, h: 800 };
    const aus = { center: { x: 0, y: 0 }, zoom: 50 };

    // Reines Spreizen um die Feldmitte: der Maßstab verdoppelt sich, die
    // Mitte bleibt die Mitte.
    const auf = gestenschritt(
      { a: { x: 400, y: 400 }, b: { x: 600, y: 400 } },
      { a: { x: 300, y: 400 }, b: { x: 700, y: 400 } },
      aus,
      feld,
    );
    check('Spreizen verdoppelt den Maßstab', auf.zoom, 100, 1e-9);
    check('… und lässt die Mitte liegen (x)', auf.center.x, 0, 1e-9);
    check('… und (y)', auf.center.y, 0, 1e-9);

    // Reines Schieben ohne Spreizen: der Maßstab bleibt, das Bild wandert
    // genau um die Fingerstrecke.
    const schieb = gestenschritt(
      { a: { x: 400, y: 400 }, b: { x: 600, y: 400 } },
      { a: { x: 450, y: 430 }, b: { x: 650, y: 430 } },
      aus,
      feld,
    );
    check('Schieben ändert den Maßstab nicht', schieb.zoom, 50, 1e-9);
    // 50 Pixel nach rechts bei 50 px/m: die Weltmitte wandert 1 m nach links.
    check('50 Pixel nach rechts sind 1 m nach links', schieb.center.x, -1, 1e-9);
    // Der Bildschirm zählt nach unten, die Welt nach oben.
    check('30 Pixel nach unten sind 0,6 m nach oben', schieb.center.y, 0.6, 1e-9);

    // Die Eigenschaft, auf die es ankommt, allgemein geprüft: bei einer
    // beliebigen Geste bleibt der Weltpunkt zwischen den Fingern zwischen
    // den Fingern.
    const vorher = { a: { x: 220, y: 640 }, b: { x: 780, y: 210 } };
    const nachher = { a: { x: 300, y: 500 }, b: { x: 640, y: 260 } };
    const neu = gestenschritt(vorher, nachher, aus, feld);
    const m0 = { x: (vorher.a.x + vorher.b.x) / 2, y: (vorher.a.y + vorher.b.y) / 2 };
    const m1 = { x: (nachher.a.x + nachher.b.x) / 2, y: (nachher.a.y + nachher.b.y) / 2 };
    const haltVorher = zuWelt(m0, aus, feld);
    const haltNachher = zuWelt(m1, neu, feld);
    check('Der Punkt zwischen den Fingern bleibt liegen (x)', haltNachher.x, haltVorher.x, 1e-9);
    check('… und (y)', haltNachher.y, haltVorher.y, 1e-9);

    // Grenzfälle, die ohne Absicherung das Bild wegschleudern.
    const entartet = gestenschritt(
      { a: { x: 500, y: 400 }, b: { x: 500, y: 400 } },
      { a: { x: 400, y: 400 }, b: { x: 600, y: 400 } },
      aus,
      feld,
    );
    check('Zwei Finger auf einem Punkt ändern den Maßstab nicht', entartet.zoom, 50, 1e-9);
    check('… und liefern eine endliche Mitte', Number.isFinite(entartet.center.x), true);

    // Der Maßstab läuft in dieselben Grenzen wie am Mausrad — sonst zoomt
    // der Finger dorthin, wo das Rad nicht hinkommt, und der Plan
    // verschwindet.
    const winzig = gestenschritt(
      { a: { x: 0, y: 400 }, b: { x: 1000, y: 400 } },
      { a: { x: 495, y: 400 }, b: { x: 505, y: 400 } },
      aus,
      feld,
    );
    check('Herauszoomen endet an der Untergrenze', winzig.zoom, ZOOM_MIN, 1e-9);
    const riesig = gestenschritt(
      { a: { x: 495, y: 400 }, b: { x: 505, y: 400 } },
      { a: { x: 0, y: 400 }, b: { x: 1000, y: 400 } },
      aus,
      feld,
    );
    check('Hineinzoomen endet an der Obergrenze', riesig.zoom, ZOOM_MAX, 1e-9);
  }

  // =========================================================================
  // 6 · Tippen ist kein Schieben
  // =========================================================================
  {
    /*
     * Die Regel „ein Finger schiebt" war für das Zeichnen richtig und für
     * alles andere zu grob: Sie traf auch das Auswählen und das Setzen.
     * Gemessen am Tablet wählte ein Fingertipp keinen Raum aus und setzte
     * keinen Heizkörper — auf einem Gerät ohne Stift war damit nach dem
     * Einlesen eines Raumscans Schluss.
     *
     * Unterschieden wird am Abheben: kurz und ohne Weg ist ein Tipp.
     */
    check('Ein sauberer Tipp', istTipp(0, 80), true);
    check('Ein Wackler bleibt ein Tipp', istTipp(TIPP_WEG_PX - 1, 120), true);
    check('Genau an der Weggrenze noch ein Tipp', istTipp(TIPP_WEG_PX, 120), true);
    check('Einen Pixel weiter ist es ein Schwenk', istTipp(TIPP_WEG_PX + 1, 120), false);
    check('Genau an der Zeitgrenze noch ein Tipp', istTipp(2, TIPP_DAUER_MS), true);
    check('Eine Millisekunde länger ist Liegenlassen', istTipp(2, TIPP_DAUER_MS + 1), false);
    check('Beides überschritten ist erst recht kein Tipp', istTipp(40, 900), false);

    /*
     * Welche Werkzeuge ein Tipp bedienen darf: die, die mit **einem** Punkt
     * fertig sind. Ein Wandzug braucht zwei und darf deshalb nicht auf einen
     * versehentlichen Tipp hin anfangen — sonst steht ein halber Zug im Plan.
     */
    check('Auswählen darf tippen', tippBedient('select'), true);
    check('TGA-Symbole setzen darf tippen', tippBedient('fixture'), true);
    check('Tür setzen darf tippen', tippBedient('door'), true);
    check('Fenster setzen darf tippen', tippBedient('window'), true);
    check('Wärmepumpe setzen darf tippen', tippBedient('heatpump'), true);
    check('Wand zeichnen nicht', tippBedient('wall'), false);
    check('Raum aufziehen nicht', tippBedient('room'), false);
    check('Leitung verlegen nicht', tippBedient('pipe'), false);
    check('Freihandskizze nicht', tippBedient('sketch'), false);
    check('Beschriften nicht', tippBedient('annotation'), false);
    check('Kalibrieren nicht', tippBedient('calibrate'), false);
    check('Und das Schiebewerkzeug schon gar nicht', tippBedient('pan'), false);
    check('Zehn Werkzeuge bedient ein Tipp', TIPP_WERKZEUGE.length, 10);
  }
}
