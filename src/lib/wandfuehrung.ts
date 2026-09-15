/**
 * Wo ein wandgebundenes Objekt hin kann — und wie weit es schon ist.
 * ---------------------------------------------------------------------------
 * **Warum es diese Datei gibt.** Ein Heizkörper hängt an einer Wand und kann
 * sich nur *auf* ihr bewegen. Zieht man ihn quer, passiert fast nichts — und
 * das sieht aus wie ein Fehler, obwohl es die Regel ist. Die Antwort darauf
 * ist kein anderer Rechenweg, sondern eine sichtbare Führung: ein Band auf der
 * Wand, das zeigt, wohin es geht, und eine Zahl, die sagt, wo man gerade ist.
 *
 * Gerechnet wird das hier und nicht im Betrachter, weil Grundriss und
 * 3D-Ansicht dieselbe Auskunft brauchen und weil eine Zahl, nach der jemand
 * anreißt, in den Prüfblock gehört.
 */

import type { BimDocument, Fixture, Vec2 } from '../types/bim';
import { getWallGeometry } from './wallGeometry';

/** Die Führung eines Objekts entlang seiner Wand. */
export interface Wandfuehrung {
  wallId: string;
  /** Anfang der Führungslinie in Weltkoordinaten — die Höhe kommt vom Objekt. */
  von: Vec2;
  bis: Vec2;
  /** Achslänge der Wand [m]. */
  laenge: number;
  /**
   * Abstand der Objektmitte vom Wandanfang, **auf der Achse** gemessen [m].
   *
   * Das ist die Zahl, nach der auf der Baustelle angerissen wird: vom Knoten
   * aus am Boden entlang. Der senkrechte Abstand zur Wand steht bewusst nicht
   * daneben — er folgt aus Wandstärke und Bautiefe und ist keine Eingabe.
   */
  abstand: number;
  /** Auf welcher Seite der Wand das Objekt hängt: +1 Linksnormale, −1 sonst. */
  seite: 1 | -1;
  /** Abstand der Objektmitte von der Wandachse [m] — für die Lage des Bandes. */
  ausladung: number;
}

/**
 * Die Führung eines Objekts, oder `null`, wenn es keine hat.
 *
 * Keine hat es in drei Fällen, und alle drei sind gültige Zustände und keine
 * Fehler: das Objekt ist nicht wandgebunden (ein Verteiler steht frei), die
 * zugeordnete Wand fehlt im Dokument, oder sie hat keine Geometrie.
 */
export function wandfuehrung(doc: BimDocument, fixture: Fixture): Wandfuehrung | null {
  if (!fixture.wallId) return null;
  const wall = doc.walls[fixture.wallId];
  if (!wall) return null;
  const g = getWallGeometry(wall, doc.nodes);
  if (!g) return null;

  const rel = { x: fixture.position.x - g.a.x, y: fixture.position.y - g.a.y };
  const u = rel.x * g.dir.x + rel.y * g.dir.y;
  const s = rel.x * g.normal.x + rel.y * g.normal.y;

  return {
    wallId: wall.id,
    von: { x: g.a.x, y: g.a.y },
    bis: { x: g.b.x, y: g.b.y },
    laenge: g.length,
    abstand: Math.min(Math.max(u, 0), g.length),
    seite: s >= 0 ? 1 : -1,
    ausladung: Math.abs(s),
  };
}

/** Eine Zahl in Metern, deutsch geschrieben, auf den Zentimeter. */
const meter = (v: number): string => `${v.toFixed(2).replace('.', ',')} m`;

/**
 * Die Zeile, die beim Ziehen am Zeiger steht.
 *
 * Sie nennt beides, was beim Umsetzen zählt: wo auf der Wand, und wie hoch.
 * Ohne Wand steht dort, dass es keine gibt — „frei im Raum" ist eine Auskunft
 * und kein Fehler, und wer sie liest, weiß, warum der Heizkörper nicht mehr
 * einrastet.
 */
export function fuehrungsText(f: Wandfuehrung | null, hoeheUeberFfb: number): string {
  const hoch = `h ${meter(hoeheUeberFfb)}`;
  if (!f) return `frei im Raum · ${hoch}`;
  return `${meter(f.abstand)} vom Wandanfang · ${hoch}`;
}

/**
 * Dieselbe Auskunft als Satz für die Statuszeile, nach dem Loslassen.
 *
 * Bewusst eine zweite Funktion und nicht dieselbe: die Fahne am Zeiger muss
 * kurz sein, weil sie neben dem Daumen steht; die Statuszeile darf den
 * Gegenstand benennen, weil man dort nachliest, was gerade passiert ist.
 */
export function umsetzungsMeldung(
  name: string,
  f: Wandfuehrung | null,
  hoeheUeberFfb: number,
): string {
  return `${name} umgesetzt · ${fuehrungsText(f, hoeheUeberFfb)}`;
}
