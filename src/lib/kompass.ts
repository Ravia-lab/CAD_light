/**
 * Der Kompass — wo Norden liegt, und wie man es sieht.
 * ---------------------------------------------------------------------------
 * **Warum die Nordrichtung überhaupt zählt.** Sie geht nirgends in eine
 * Fläche ein und trotzdem in fast jede Zahl der Heizlast: Über sie bekommt
 * jedes Außenbauteil seinen Azimut, und daraus folgen die solaren Gewinne
 * nach DIN EN 12831-1, die Abschirmung gegen Wind und die Bewertung einer
 * Verglasung. Ein Grundriss, der um neunzig Grad falsch liegt, rechnet die
 * Südfassade als Westfassade — und das sieht man der Zahl nicht an.
 *
 * Das Dokument führt die Nordrichtung seit jeher als `meta.northAngle`, und
 * der Export rechnet korrekt damit. Was fehlte, war das Bild: Man konnte die
 * Zahl eintragen und nirgends nachsehen, ob sie stimmt. Genau dafür ist
 * diese Datei da.
 *
 * **Die Konvention, einmal ausgeschrieben.** `northAngle` ist die
 * Nordabweichung des Grundrisses in Grad, gegen den Uhrzeigersinn positiv;
 * 0 heißt „+y zeigt nach Norden". Der Azimut einer Bauteilnormalen ist
 *
 *     azimut = atan2(n_x, n_y) − northAngle       (0 = Nord, im Uhrzeigersinn)
 *
 * Daraus folgt die Gegenrichtung, die dieses Modul braucht: Norden zeigt im
 * Modellraum in Richtung
 *
 *     (sin northAngle, cos northAngle)
 *
 * Probe: Bei northAngle = 0 ist das (0|1), also +y — wie versprochen. Bei
 * northAngle = 90° ist es (1|0), also +x: Der Plan ist um eine
 * Vierteldrehung verdreht, und Norden liegt rechts.
 *
 * **Warum die Rose in Einheitskoordinaten entsteht.** Sie wird an drei Orten
 * gezeichnet — auf der Leinwand, auf dem Blatt und im Einstellfeld — und in
 * drei verschiedenen Maßstäben und Achsrichtungen (Bildschirm-y zeigt nach
 * unten, Modell-y nach oben). Hier steht deshalb nur die Form, in einem
 * Kreis vom Radius 1 und mit y nach oben. Wohin sie kommt und wie groß sie
 * wird, entscheidet der Zeichner.
 */

import type { Vec2 } from '../types/bim';

const TO_RAD = Math.PI / 180;

/**
 * Einheitsvektor nach Norden im Modellraum.
 *
 * Siehe die Herleitung im Dateikopf. Die Umkehrung von `azimuthFromNormal`
 * steht bewusst hier und nicht dort: `geometry.ts` beantwortet die Frage
 * „welche Himmelsrichtung hat dieses Bauteil", diese Datei die Frage „wo ist
 * Norden" — dieselbe Konvention, zwei Richtungen.
 */
export function nordrichtung(northAngle: number): Vec2 {
  const a = northAngle * TO_RAD;
  return { x: Math.sin(a), y: Math.cos(a) };
}

/**
 * Aus einer Richtung im Modellraum die Nordabweichung machen — die Umkehrung.
 *
 * Gebraucht wird sie vom Einstellfeld: Wer die Nadel dreht, gibt eine
 * Richtung an und keine Zahl.
 */
export function nordabweichungAus(richtung: Vec2): number {
  const grad = Math.atan2(richtung.x, richtung.y) / TO_RAD;
  return ((grad % 360) + 360) % 360;
}

/** Ein Teil der Kompassrose, in Einheitskoordinaten (Radius 1, y nach oben). */
export type KompassTeil =
  | { kind: 'kreis'; zentrum: Vec2; radius: number }
  | { kind: 'linie'; a: Vec2; b: Vec2 }
  /** Gefüllte Fläche — die Nordspitze. */
  | { kind: 'flaeche'; punkte: Vec2[] }
  /** Beschriftung; `punkt` ist die Mitte des Zeichens. */
  | { kind: 'text'; punkt: Vec2; text: string };

/**
 * Die Kompassrose als Formteile.
 *
 * Die Nadel ist eine schlanke Raute: Die Nordhälfte wird gefüllt, die
 * Südhälfte bleibt offen. Das ist die übliche Darstellung im Bauplan und
 * unterscheidet sich auf einen Blick von einem Pfeil, der nach *irgendwo*
 * zeigt — eine Rose zeigt in beide Richtungen und behauptet damit nichts
 * über eine Blickrichtung.
 *
 * `mitLetter` blendet das „N" aus. Auf dem Blatt gehört es dazu; in einem
 * zwölf Pixel großen Einstellfeld wäre es ein Fleck.
 */
export function kompassRose(northAngle: number, mitLetter = true): KompassTeil[] {
  const n = nordrichtung(northAngle);
  // Die Querrichtung: um 90° gegen den Uhrzeigersinn gedreht.
  const q = { x: -n.y, y: n.x };

  /** Ein Punkt der Rose: `laengs` nach Norden, `quer` nach Westen. */
  const p = (laengs: number, quer: number): Vec2 => ({
    x: n.x * laengs + q.x * quer,
    y: n.y * laengs + q.y * quer,
  });

  const teile: KompassTeil[] = [
    { kind: 'kreis', zentrum: { x: 0, y: 0 }, radius: 1 },
    // Nordhälfte der Nadel, gefüllt.
    { kind: 'flaeche', punkte: [p(0.82, 0), p(0, 0.2), p(0, -0.2)] },
    // Südhälfte, nur Umriss.
    { kind: 'linie', a: p(-0.82, 0), b: p(0, 0.2) },
    { kind: 'linie', a: p(-0.82, 0), b: p(0, -0.2) },
    { kind: 'linie', a: p(0, 0.2), b: p(0, -0.2) },
  ];

  // Teilstriche für Ost, Süd und West — sie machen aus der Nadel eine Rose
  // und zeigen, dass die Drehung den ganzen Kreis mitnimmt.
  for (const grad of [90, 180, 270]) {
    const a = grad * TO_RAD;
    const r = { x: n.x * Math.cos(a) + q.x * Math.sin(a), y: n.y * Math.cos(a) + q.y * Math.sin(a) };
    teile.push({ kind: 'linie', a: { x: r.x * 0.86, y: r.y * 0.86 }, b: { x: r.x, y: r.y } });
  }

  if (mitLetter) teile.push({ kind: 'text', punkt: p(1.3, 0), text: 'N' });
  return teile;
}
