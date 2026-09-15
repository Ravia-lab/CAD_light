/**
 * Wie lang ist eine Leitung wirklich?
 * ---------------------------------------------------------------------------
 * **Warum das ein eigenes Modul ist.** Bis 1.23.0 rechnete jede Stelle, die
 * eine Rohrlänge brauchte, sie selbst aus — der Massenauszug, der
 * Rohrnetzbericht, der hydraulische Abgleich, der Plan. Jede dieser Stellen
 * nahm dieselbe Formel: die Summe der Abstände zwischen den Stützpunkten **im
 * Grundriss**. Solange jede Leitung waagerecht lag, war das richtig.
 *
 * Mit der geneigten Leitung (`PipeRun.elevationTo`) ist es falsch, und zwar
 * an vier Stellen gleichzeitig und auf vier verschiedene Arten. Ein
 * Fallstrang von 2,40 m in der Zimmerecke hat im Grundriss die Länge null:
 * Er fehlt in der Bestellung vollständig, taucht im Druckverlust nicht auf,
 * und der Plan zeichnet ihn als Punkt. Vier Stellen zu ändern heißt, dass
 * die fünfte beim nächsten Mal vergessen wird — also gibt es ab jetzt genau
 * eine Rechnung.
 *
 * Schichtgrenze: nur Typen, kein Zustand.
 */

import type { PipeRun, Vec2 } from '../types/bim';

/** Die Länge der Trasse in der Grundrissebene [m] — ohne jeden Höhenversatz. */
export function trassenlaenge(points: readonly Vec2[]): number {
  let summe = 0;
  for (let i = 1; i < points.length; i += 1) {
    summe += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return summe;
}

/**
 * Der Höhenversatz eines Abschnitts [m] — vorzeichenbehaftet.
 *
 * Positiv heißt: Das Ende liegt höher als der Anfang. Das Vorzeichen wird
 * gebraucht, nicht nur der Betrag: Eine Entlüftung gehört an den Hochpunkt,
 * eine Entleerung an den Tiefpunkt, und welches Ende welches ist, steht
 * nirgends sonst.
 */
export function hoehenversatz(run: Pick<PipeRun, 'elevation' | 'elevationTo'>): number {
  if (run.elevationTo === undefined) return 0;
  return run.elevationTo - run.elevation;
}

/**
 * Die wahre Rohrlänge eines Abschnitts [m].
 *
 * Pythagoras über die ganze Trasse, nicht abschnittsweise: Die Steigung
 * verteilt sich gleichmäßig über die Stützpunkte (so ist `elevationTo`
 * definiert), und über eine gleichmäßige Steigung ist die Summe der
 * geneigten Teilstücke genau die Hypotenuse aus Gesamttrasse und
 * Gesamtversatz. Abschnittsweise gerechnet käme dieselbe Zahl heraus — nur
 * mit mehr Gelegenheiten, sie falsch zu runden.
 */
export function rohrlaenge(run: Pick<PipeRun, 'points' | 'elevation' | 'elevationTo'>): number {
  const trasse = trassenlaenge(run.points);
  const dh = hoehenversatz(run);
  if (dh === 0) return trasse;
  return Math.hypot(trasse, dh);
}

/**
 * Der Anteil, den der Grundriss **nicht** zeigt [m].
 *
 * Das ist die Zahl, die in den Massenauszug als eigene Spalte gehört: Wer
 * eine Bestellung gegen einen Plan prüft, misst im Plan nach und kommt auf
 * die Trassenlänge. Die Differenz muss er benannt bekommen, sonst hält er
 * sie für einen Fehler.
 */
export function steiganteil(run: Pick<PipeRun, 'points' | 'elevation' | 'elevationTo'>): number {
  return Math.max(0, rohrlaenge(run) - trassenlaenge(run.points));
}

/**
 * Steht dieser Abschnitt praktisch senkrecht?
 *
 * Die Schwelle ist ein Verhältnis und keine feste Länge: Ein Strang gilt als
 * senkrecht, wenn er über seine Trasse mehr als das Doppelte an Höhe
 * gewinnt — das entspricht einem Neigungswinkel über 63°. Darunter ist es
 * eine ansteigende Leitung, und die verhält sich hydraulisch wie eine
 * liegende.
 *
 * Gebraucht wird die Unterscheidung für die Armaturen: Ein Strang bekommt am
 * oberen Ende eine Entlüftung und am unteren eine Entleerung; eine leicht
 * ansteigende Leitung braucht beides nicht.
 */
export function istStrang(run: Pick<PipeRun, 'points' | 'elevation' | 'elevationTo'>): boolean {
  const dh = Math.abs(hoehenversatz(run));
  if (dh < 0.15) return false;
  return dh > trassenlaenge(run.points) * 2;
}

/**
 * Die Höhe an einem Stützpunkt [m] — für die Darstellung in 3D.
 *
 * Linear über die zurückgelegte Trassenlänge, nicht über den Punktindex:
 * Stützpunkte liegen nicht gleichmäßig verteilt, und eine Interpolation über
 * den Index ließe eine Leitung mit einem kurzen und einem langen Teilstück
 * in der Mitte knicken.
 */
export function hoeheAnPunkt(
  run: Pick<PipeRun, 'points' | 'elevation' | 'elevationTo'>,
  index: number,
): number {
  const dh = hoehenversatz(run);
  if (dh === 0) return run.elevation;
  const gesamt = trassenlaenge(run.points);
  if (gesamt <= 0) {
    // Ein reiner Strang: Die Trasse hat keine Länge, die Höhe springt also
    // vom ersten auf den letzten Punkt. Alles dazwischen gibt es nicht.
    return index <= 0 ? run.elevation : (run.elevationTo ?? run.elevation);
  }
  const bis = trassenlaenge(run.points.slice(0, Math.max(1, index + 1)));
  return run.elevation + (dh * bis) / gesamt;
}
