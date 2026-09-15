/**
 * Vor- und Rücklauf als ein Bauteil.
 * ---------------------------------------------------------------------------
 *
 * **Was eine Doppelleitung ist.** Im Plan sind es zwei Linien, im Bau ist es
 * eine Trasse: ein Kanal, eine Schlitzung, ein Loch durch die Wand, ein
 * Arbeitsgang. Für die Bestellung zählt die Rohrlänge (zweimal), für alles
 * andere die Trassenlänge (einmal). Wer die beiden Zahlen verwechselt,
 * bestellt halb so viel Rohr oder doppelt so viel Kanal.
 *
 * **Warum das Paar eine Kennung trägt.** Weil es sonst keins ist. Zwei
 * Leitungen, die zufällig 5 cm nebeneinander liegen, sind für das Programm
 * zwei Leitungen: Verschiebt man eine, bleibt die andere stehen; löscht man
 * eine, hat man eine Heizung, die nur hinführt. Beides ist im Plan kaum zu
 * sehen — parallel und fast parallel sehen gleich aus — und fällt erst beim
 * Bauen auf. Die Kennung macht aus zwei Linien ein Bauteil.
 *
 * **Der Abstand.** 50 mm zwischen den Achsen, jede also 25 mm von der Mitte.
 * Die Zahl passt zur Lage, die `pipeRouting` der Trasse gibt: in der
 * Sanierung liegt deren Achse 50 mm vor der Wandfläche, die beiden Rohre
 * also bei 25 mm und 75 mm — beide innerhalb der 105 mm des
 * Sockelleistenkanals. Der Versatz ist eine reine Parallelverschiebung; er
 * ändert die Länge eines Abschnitts nicht.
 */

import type { PipeRun, Vec2 } from '../types/bim';

/** Achsabstand der beiden Rohre einer Doppelleitung [m]. */
export const PAARABSTAND = 0.05;

/**
 * Einen Zug um den halben Paarabstand quer versetzen.
 *
 * `vz` gibt die Seite an (+1 links, −1 rechts, bezogen auf die
 * Laufrichtung). An einem Knick wird der Schnittpunkt der beiden versetzten
 * Geraden gebildet (Gehrung) — nur so bleibt **jede** Strecke des Ergebnisses
 * parallel zu ihrer Vorlage. Der naheliegende Weg, jeden Punkt entlang der
 * anliegenden Strecke zu versetzen, ergibt an der Ecke eine Linie, die zu
 * keiner der beiden Vorlagen parallel liegt; im Kanal hieße das, dass die
 * beiden Rohre sich an der Ecke annähern.
 *
 * **Eine Doppelleitung ist an der Ecke nicht zweimal gleich lang, und das
 * ist richtig so.** Wer ein Seilpaar um eine Ecke führt, hat innen das
 * kürzere Seil. Bei rechtem Winkel und 25 mm Versatz sind es 50 mm je Ecke
 * — außen dazu, innen weg. Was dagegen *exakt* gilt: Die Summe beider
 * Längen ist zweimal die Trassenlänge, weil sich die beiden Beträge
 * aufheben. Genau diese Aussage steht auch hinter „Rohrlänge = 2 ×
 * Trassenlänge" im Rohrausleger.
 *
 * Bei einer Kehrtwende (Winkel nahe 180°) liefe die Gehrung ins Unendliche.
 * Dort wird auf den einfachen Versatz der anliegenden Strecke
 * zurückgefallen: Eine Leitung, die auf sich selbst zurückläuft, gibt es im
 * Bau nicht, und eine Zahl in Kilometern wäre die schlechtere Antwort.
 */
export function versetzeQuer(points: readonly Vec2[], vz: number): Vec2[] {
  if (points.length < 2) return points.map((p) => ({ ...p }));

  const richtung = (a: Vec2, b: Vec2): Vec2 | null => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    return len < 1e-9 ? null : { x: dx / len, y: dy / len };
  };
  /** Die Normale einer Richtung, nach links. */
  const quer = (d: Vec2): Vec2 => ({ x: -d.y, y: d.x });

  const d = (PAARABSTAND / 2) * vz;
  const aus: Vec2[] = [];

  for (let i = 0; i < points.length; i++) {
    const vor = i > 0 ? richtung(points[i - 1], points[i]) : null;
    const nach = i < points.length - 1 ? richtung(points[i], points[i + 1]) : null;
    const eine = vor ?? nach;
    if (!eine) {
      aus.push({ ...points[i] });
      continue;
    }
    if (!vor || !nach) {
      const n = quer(eine);
      aus.push({ x: points[i].x + n.x * d, y: points[i].y + n.y * d });
      continue;
    }
    // Winkelhalbierende der beiden Normalen, verlängert um 1/cos(φ/2).
    const na = quer(vor);
    const nb = quer(nach);
    const mx = na.x + nb.x;
    const my = na.y + nb.y;
    const betrag = Math.hypot(mx, my);
    // `betrag/2` ist cos(φ/2); bei einer Kehrtwende geht er gegen null.
    if (betrag < 0.2) {
      aus.push({ x: points[i].x + na.x * d, y: points[i].y + na.y * d });
      continue;
    }
    const skala = (2 / (betrag * betrag)) * d;
    aus.push({ x: points[i].x + mx * skala, y: points[i].y + my * skala });
  }
  return aus;
}

/** Länge eines Zuges [m]. */
export function zuglaenge(points: readonly Vec2[]): number {
  let sum = 0;
  for (let i = 1; i < points.length; i++) {
    sum += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return sum;
}

/**
 * Aus einem gezeichneten Zug ein Paar machen.
 *
 * Der übergebene Zug ist die **Mitte** der Trasse und wird dabei selbst nach
 * links versetzt; zurück kommt der Partner auf der rechten Seite. Beide
 * tragen danach dieselbe `pairId`.
 *
 * Wer an einer Wand entlangzeichnet, meint die Trasse — nicht den Vorlauf.
 * Deshalb wird der gezeichnete Zug versetzt und nicht als Vorlauf stehen
 * gelassen: Sonst läge der Rücklauf 5 cm weiter im Raum als angerissen.
 */
export function bildePaar(mitte: PipeRun, partnerId: string, pairId: string): PipeRun {
  const links = versetzeQuer(mitte.points, 1);
  const rechts = versetzeQuer(mitte.points, -1);
  // Der übergebene Lauf wird an Ort und Stelle zur linken Seite.
  mitte.points = links;
  mitte.pairId = pairId;
  return {
    ...mitte,
    id: partnerId,
    service: mitte.service === 'heating-return' ? 'heating-flow' : 'heating-return',
    points: rechts,
    pairId,
  };
}

/** Der Partner eines Abschnitts, falls es einen gibt. */
export function partnerVon(
  runs: Readonly<Record<string, PipeRun>>,
  run: PipeRun,
): PipeRun | undefined {
  if (!run.pairId) return undefined;
  return Object.values(runs).find((r) => r.id !== run.id && r.pairId === run.pairId);
}
