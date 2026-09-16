/**
 * Höhenlage der Geschosse.
 * ---------------------------------------------------------------------------
 * Ein Geschoss trägt eine Höhenlage (`elevation`) — die Oberkante seines
 * Rohfußbodens über dem Bezugspunkt. Steht sie im Modell, gilt sie. Fehlt sie,
 * werden die Geschosse von unten nach oben aufeinandergesetzt.
 *
 * Warum das eine eigene Funktion ist: die 3D-Ansicht hat bis 1.8.1 **jedes**
 * Geschoss auf Höhe null gezeichnet. Alle Stockwerke standen ineinander, und
 * man sah nur eines — im Aufmaß einer Wohnung fällt das nicht auf, im
 * Zweifamilienhaus sofort. Die Rechnung gehört damit dorthin, wo sie geprüft
 * werden kann, und nicht in den Zeichenpfad.
 */

import type { Level } from '../types/bim';

/**
 * Übliche Deckenstärke samt Aufbau [m].
 *
 * 20 cm Stahlbeton, 4 cm Estrich, 1 cm Belag — der Regelfall im
 * Wohnungsbau. Der Wert greift nur, wenn am Geschoss keine Höhenlage steht;
 * er ist eine Annahme und keine Messung.
 */
export const DEFAULT_SLAB = 0.25;

/** Vorgabe der lichten Geschosshöhe [m], wenn am Geschoss keine steht. */
export const DEFAULT_LEVEL_HEIGHT = 2.75;

/**
 * Höhenlage je Geschoss, von unten nach oben aufgebaut.
 *
 * Die Reihenfolge folgt `order`, nicht der Reihenfolge im Objekt: ein
 * nachträglich angelegter Keller hat die kleinste Ordnung und muss zuunterst
 * stehen, obwohl er zuletzt entstanden ist.
 */
export function levelBaseHeights(levels: readonly Level[]): Map<string, number> {
  const sortiert = [...levels].sort((a, b) => a.order - b.order);
  const map = new Map<string, number>();
  let hoehe = 0;
  for (const l of sortiert) {
    // `elevation` kann fehlen oder unbrauchbar sein (NaN aus einem Import).
    const eigen = Number.isFinite(l.elevation) ? l.elevation : undefined;
    const wert = eigen ?? hoehe;
    map.set(l.id, wert);
    const lichte = Number.isFinite(l.height) && l.height > 0 ? l.height : DEFAULT_LEVEL_HEIGHT;
    hoehe = wert + lichte + DEFAULT_SLAB;
  }
  return map;
}


/**
 * Geschossbezeichnungen nach deutscher Gewohnheit.
 * ---------------------------------------------------------------------------
 * **Der Bezugspunkt ist das Erdgeschoss, nicht das unterste Geschoss.** Das
 * ist der Unterschied, an dem eine Zählung von unten scheitert: in einem Haus
 * mit Keller ist das unterste Geschoss das KG, in einem ohne Keller ist es das
 * EG — dieselbe Position, zwei verschiedene Namen. Wer stumpf durchzählt,
 * nennt den Keller „Geschoss 1" und das Erdgeschoss „Geschoss 2", und ab da
 * stimmt nichts mehr: nicht die Heizlast (Boden gegen Erdreich), nicht die
 * Höhenlage, nicht der Plankopf.
 *
 * Erkannt wird das Erdgeschoss an seiner Höhenlage: es ist das Geschoss, das
 * dem Bezugspunkt 0 am nächsten liegt und nicht mehr als eine halbe
 * Geschosshöhe darunter. Ein Souterrain auf −1,20 m ist damit ein
 * Kellergeschoss und kein Erdgeschoss — was der üblichen Lesart entspricht.
 *
 * Über dem Erdgeschoss wird aufsteigend gezählt (1. OG, 2. OG …), darunter
 * heißt die erste Ebene KG und jede weitere 2. UG, 3. UG … Ein „1. UG" gibt es
 * nicht: das ist das Kellergeschoss.
 */

/** Wie weit unter dem Bezugspunkt ein Geschoss noch als Erdgeschoss gilt [m]. */
const EG_TOLERANZ = 1.0;

export function geschossName(index: number, egIndex: number): string {
  if (index === egIndex) return 'EG';
  if (index > egIndex) return `${index - egIndex}. OG`;
  const unter = egIndex - index;
  return unter === 1 ? 'KG' : `${unter}. UG`;
}

/**
 * Index des Erdgeschosses in einer nach Höhe aufsteigend sortierten Liste.
 *
 * Gibt es keine brauchbare Höhenlage, ist das unterste Geschoss das
 * Erdgeschoss — die Annahme, mit der ein Aufmaß beginnt.
 */
export function erdgeschossIndex(elevations: readonly number[]): number {
  if (!elevations.length) return 0;
  let treffer = 0;
  let abstand = Infinity;
  for (let i = 0; i < elevations.length; i++) {
    const e = elevations[i];
    if (!Number.isFinite(e)) continue;
    if (e < -EG_TOLERANZ) continue;
    const d = Math.abs(e);
    if (d < abstand) {
      abstand = d;
      treffer = i;
    }
  }
  return abstand === Infinity ? 0 : treffer;
}

/**
 * Namen für eine nach Höhe aufsteigend sortierte Geschossfolge.
 *
 * Ein bereits vergebener, sprechender Name bleibt stehen: eine IFC-Datei, die
 * ihre Geschosse „Erdgeschoss" und „Dachboden" nennt, weiß mehr über das
 * Gebäude als diese Funktion. Ersetzt werden nur Platzhalter — leere Namen
 * und die Zählform „Geschoss 3", die kein Mensch so vergibt.
 */
export function benenneGeschosse(
  levels: readonly { name?: string; elevation?: number }[],
): string[] {
  const egIndex = erdgeschossIndex(levels.map((l) => l.elevation ?? Number.NaN));
  return levels.map((l, i) => {
    const eigen = (l.name ?? '').trim();
    const platzhalter = !eigen || /^geschoss(\s*\d+)?$/i.test(eigen) || /^level\s*\d+$/i.test(eigen);
    return platzhalter ? geschossName(i, egIndex) : eigen;
  });
}

/**
 * Ist das ein Lagename — einer, der nur die Position im Haus beschreibt?
 *
 * Der Unterschied entscheidet, ob ein Name beim Umsortieren mitwandert. „1. OG"
 * ist eine Ortsangabe: Wird aus dem Geschoss das zweite Obergeschoss, ist der
 * Name falsch und muss nachgezogen werden. „Dachboden" oder „Wohnung Müller"
 * sind dagegen Eigennamen — sie überleben jede Umsortierung, weil sie etwas
 * sagen, das aus der Position nicht folgt.
 */
export function istLagename(name: string | undefined): boolean {
  const n = (name ?? '').trim();
  if (!n) return true;
  return /^(EG|KG)$/i.test(n) || /^\d+\.\s*(OG|UG)$/i.test(n) || /^geschoss(\s*-?\d+)?$/i.test(n);
}
