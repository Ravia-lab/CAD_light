/**
 * Leitungen, die in keiner Menge auftauchen dürfen — und die man trotzdem
 * nicht still verschwinden lassen darf.
 * ---------------------------------------------------------------------------
 *
 * Bis 1.69.0 stand im Massenauszug die Zeile
 *
 *     if (!Number.isFinite(length) || length <= 0) continue;
 *
 * und im Handbuch, Abschnitt 18.5.1, der dazugehörige Satz: „Leitungen mit
 * der Länge 0 werden im Massenauszug still verworfen. Eine versehentlich
 * doppelt gesetzte Leitung fällt in der Menge nicht auf. Der Mangel ist
 * bekannt und noch offen."
 *
 * Das Verwerfen selbst ist richtig — eine Leitung ohne Länge ist keine
 * Bestellposition. Falsch war das *still*. Eine Leitung der Länge null ist
 * fast nie gewollt: Sie entsteht aus einem Doppelklick, aus einem
 * abgebrochenen Zug oder aus Koordinaten, die beim Einlesen kaputtgegangen
 * sind. Im Plan ist sie unsichtbar, in der Liste fehlt sie — und wer an
 * ihr einen Heizkörper angebunden hat, sucht den Fehler im Rohrnetz.
 *
 * Die doppelte Leitung ist das Gegenstück: Sie *steht* in der Menge, und
 * zwar zweimal. Im Plan liegen beide Striche übereinander und sehen aus wie
 * einer. Die Bestellung ist dann um genau diese Länge zu hoch, und im
 * Rohrnetz führen zwei Wege parallel zum selben Ziel — der Druckverlust des
 * Strangs halbiert sich rechnerisch, ohne dass ein Rohr dazugekommen wäre.
 *
 * Dieses Modul findet beide und sagt es. Es ändert nichts am Modell: Welche
 * der beiden doppelten Leitungen die richtige ist, weiß nur der, der sie
 * gezeichnet hat.
 */

import type { PipeRun, Vec2 } from '../types/bim';
import { rohrlaenge } from './rohrlaenge';

/**
 * Lagetoleranz für „deckungsgleich" [m].
 *
 * Ein Millimeter. Zwei Leitungen, die sich um mehr unterscheiden, hat
 * jemand absichtlich so gelegt oder mit dem Fang an verschiedenen Punkten
 * angesetzt — dann sind es zwei. Die Doppelleitung legt ihre beiden Rohre
 * 50 mm auseinander (`PAARABSTAND`), also fünfzigmal weiter, als hier
 * zusammengefasst wird.
 */
export const DECKUNGSTOLERANZ = 0.001;

/**
 * Höhentoleranz [m]. Ein Zentimeter — dieselbe Schwelle, unter der der
 * Massenauszug einen Höhenversatz als Rundung behandelt (`rohrBemerkung`).
 * Zwei Leitungen auf 0,10 m und 0,30 m sind zwei Leitungen übereinander und
 * kein Doppel.
 */
export const HOEHENTOLERANZ = 0.01;

/** Eine Leitung, die keine Länge hat — mit dem Grund. */
export interface NullLeitung {
  id: string;
  levelId: string;
  /**
   * `null`: Die Punkte fallen zusammen, und die Höhen auch.
   * `ungueltig`: Eine Koordinate oder Höhe ist keine Zahl. Das ist der
   * schlimmere der beiden Fälle, weil er nicht vom Zeichnen kommt, sondern
   * vom Einlesen — und dann ist meist mehr als eine Leitung betroffen.
   */
  grund: 'null' | 'ungueltig';
}

/** Zwei Leitungen, die deckungsgleich übereinanderliegen. */
export interface DoppelLeitung {
  /** Die zuerst gefundene — sie bleibt im Befund der Bezug. */
  id: string;
  /** Die zweite, die auf ihr liegt. */
  doppelId: string;
  levelId: string;
  /** Die Länge, um die die Bestellung zu hoch ist [m]. */
  laenge: number;
}

const istZahl = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Leitungen ohne Länge.
 *
 * Die Bedingung ist **dieselbe**, unter der der Massenauszug eine Leitung
 * verwirft — nicht eine ähnliche. Wäre sie auch nur etwas strenger oder
 * lockerer, gäbe es Leitungen, die fehlen, ohne gemeldet zu werden, oder
 * gemeldete, die gar nicht fehlen. Deshalb rechnet der Massenauszug seine
 * Auswahl über diese Funktion und nicht über eine eigene Zeile.
 */
export function nullLeitungen(runs: readonly PipeRun[]): NullLeitung[] {
  const aus: NullLeitung[] = [];
  for (const run of runs) {
    const laenge = rohrlaenge(run);
    if (istZahl(laenge) && laenge > 0) continue;
    aus.push({ id: run.id, levelId: run.levelId, grund: istZahl(laenge) ? 'null' : 'ungueltig' });
  }
  return aus;
}

const gleichAuf = (a: Vec2, b: Vec2): boolean =>
  Math.abs(a.x - b.x) <= DECKUNGSTOLERANZ && Math.abs(a.y - b.y) <= DECKUNGSTOLERANZ;

const gleicheHoehe = (a: number | undefined, b: number | undefined): boolean =>
  istZahl(a) && istZahl(b) ? Math.abs(a - b) <= HOEHENTOLERANZ : a === b;

/**
 * Liegen zwei Züge deckungsgleich — Punkt für Punkt, in derselben oder der
 * umgekehrten Laufrichtung?
 *
 * **Der ganze Zug, nicht ein Stück davon.** Zwei Leitungen, die am selben
 * Verteiler beginnen und ein Stück gemeinsam laufen, sind der Normalfall —
 * im Referenzhaus dieses Programms tun es die beiden Vorlaufzüge. Ein
 * gemeinsamer Abschnitt ist kein Doppel, sondern eine Trasse, die sich
 * verzweigt. Erst wenn jeder Punkt auf einem Punkt liegt, ist die zweite
 * Leitung überflüssig.
 *
 * Die Gegenrichtung zählt mit, weil sie im Plan nicht zu unterscheiden ist:
 * Ein Zug von A nach B und einer von B nach A sind derselbe Strich. Bei der
 * umgekehrten Richtung tauschen auch die beiden Höhen die Rollen.
 */
function deckungsgleich(a: PipeRun, b: PipeRun): boolean {
  if (a.points.length !== b.points.length) return false;
  const n = a.points.length;
  const vorwaerts =
    a.points.every((p, i) => gleichAuf(p, b.points[i])) &&
    gleicheHoehe(a.elevation, b.elevation) &&
    gleicheHoehe(a.elevationTo ?? a.elevation, b.elevationTo ?? b.elevation);
  if (vorwaerts) return true;
  return (
    a.points.every((p, i) => gleichAuf(p, b.points[n - 1 - i])) &&
    gleicheHoehe(a.elevation, b.elevationTo ?? b.elevation) &&
    gleicheHoehe(a.elevationTo ?? a.elevation, b.elevation)
  );
}

/**
 * Doppelt gesetzte Leitungen.
 *
 * **Was gleich sein muss, damit es ein Doppel ist.** Geschoss, Leitungsart,
 * Nennweite und Werkstoff — und der Zug samt Höhen. Jede dieser Bedingungen
 * schützt einen Fall, der richtig gezeichnet ist und trotzdem übereinander
 * liegt:
 *
 * - **Leitungsart:** Vorlauf und Rücklauf in derselben Trasse, ohne den
 *   Versatz der Doppelleitung gezeichnet. Das ist eine Darstellungsfrage,
 *   kein Doppel — es sind zwei Rohre.
 * - **Nennweite:** Saug- und Flüssigkeitsleitung eines Splitgeräts tragen
 *   beide die Art „Kältemittel" und laufen im Bau gemeinsam gedämmt in einer
 *   Trasse. Sie unterscheiden sich im Durchmesser — sonst in nichts.
 * - **Werkstoff:** Eine alte und eine neue Leitung derselben Nennweite, im
 *   Bestand nebeneinander aufgenommen.
 *
 * Eine Erkennung, die einen dieser Fälle meldete, wäre schlimmer als keine:
 * Wer der Meldung folgt und „die doppelte" löscht, löscht ein echtes Rohr.
 * Lieber findet die Prüfung ein Doppel mit abweichendem Werkstoffeintrag
 * nicht.
 *
 * Mehr als zwei deckungsgleiche Leitungen ergeben eine Meldung je
 * überzähliger Leitung, jeweils gegen die erste: Drei Striche sind zwei zu
 * viel, und die Bestellung ist um die doppelte Länge zu hoch.
 */
export function doppelteLeitungen(runs: readonly PipeRun[]): DoppelLeitung[] {
  const aus: DoppelLeitung[] = [];
  const schonDoppel = new Set<string>();
  // Leitungen ohne Länge sind schon ein eigener Befund. Zwei Nullleitungen
  // am selben Punkt sind zusätzlich deckungsgleich — das noch einmal als
  // Doppel zu melden, nennte denselben Fehler zweimal.
  const ohneLaenge = new Set(nullLeitungen(runs).map((n) => n.id));
  const gueltig = runs.filter((r) => !ohneLaenge.has(r.id));
  for (let i = 0; i < gueltig.length; i++) {
    const a = gueltig[i];
    if (schonDoppel.has(a.id)) continue;
    for (let j = i + 1; j < gueltig.length; j++) {
      const b = gueltig[j];
      if (schonDoppel.has(b.id)) continue;
      if (a.levelId !== b.levelId) continue;
      if (a.service !== b.service) continue;
      if (a.nominalDiameter !== b.nominalDiameter) continue;
      if ((a.material ?? '') !== (b.material ?? '')) continue;
      if (!deckungsgleich(a, b)) continue;
      schonDoppel.add(b.id);
      aus.push({ id: a.id, doppelId: b.id, levelId: a.levelId, laenge: rohrlaenge(b) });
    }
  }
  return aus;
}
