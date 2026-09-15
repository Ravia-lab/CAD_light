/**
 * notizen — die Regel für den Radiergummi der Notizebene.
 *
 * **Warum das hier steht und nicht in der Leinwand.** Radieren sieht nach
 * einer Kleinigkeit aus, ist aber eine Entscheidung mit Folgen: Was der
 * Radierer erwischt, ist weg. Ein Radierer, der zu gierig greift, löscht die
 * Notiz daneben mit; einer, der zu genau ist, zwingt zum Zielen — und Zielen
 * mit dem Stift auf einem wackelnden Tablet ist genau das, was wir dem
 * Handwerker ersparen wollen. Die Regel gehört also geprüft, und geprüft
 * werden kann nur, was ohne Leinwand, Zeigergerät und Bildschirm läuft.
 *
 * Der Radierer arbeitet **strichweise**, nicht punktweise: Was er berührt,
 * fällt ganz. Das ist die ehrlichere Bedienung — ein halb weggeriebener
 * Strich sieht nach Zeichnung aus und ist doch keine mehr. Wer nur ein Stück
 * weghaben will, löscht und schreibt neu; das ist auf Papier nicht anders.
 */

import { distanceToSegment } from './geometry';
import type { Freihandstrich, Vec2 } from '../types/bim';

/**
 * Fassradius des Radierers in Metern, bevor die Zeigerart ihn streckt.
 *
 * 12 cm klingt viel. Auf einem Blatt 1:50 sind das 2,4 mm — etwa die Breite
 * der Notizlinie selbst. Weniger trifft nicht, mehr frisst den Nachbarn.
 */
export const RADIER_RADIUS = 0.12;

/** Der kürzeste Abstand zwischen einem Punkt und einem Streckenzug [m]. */
export function abstandZuZug(p: Vec2, zug: readonly Vec2[]): number {
  if (zug.length === 0) return Infinity;
  if (zug.length === 1) return Math.hypot(p.x - zug[0].x, p.y - zug[0].y);
  let best = Infinity;
  for (let i = 1; i < zug.length; i++) {
    const d = distanceToSegment(p, zug[i - 1], zug[i]);
    if (d < best) best = d;
  }
  return best;
}

/**
 * Trifft die Radierbahn den Strich?
 *
 * Geprüft wird in **beide** Richtungen: jeder Punkt der Bahn gegen den
 * Strich und jeder Punkt des Strichs gegen die Bahn. Nur so wird auch ein
 * Kreuz erkannt, dessen Balken sich zwischen zwei aufgezeichneten Punkten
 * schneiden — bei schneller Bewegung liegen die Punkte weit auseinander, und
 * eine einseitige Prüfung ließe genau den Fall durchrutschen, der am
 * häufigsten vorkommt: einmal quer durchgestrichen.
 */
export function trifft(strich: readonly Vec2[], bahn: readonly Vec2[], radius = RADIER_RADIUS): boolean {
  if (strich.length === 0 || bahn.length === 0) return false;
  for (const p of bahn) if (abstandZuZug(p, strich) <= radius) return true;
  for (const p of strich) if (abstandZuZug(p, bahn) <= radius) return true;
  return false;
}

/**
 * Alle Notizen des Geschosses, die die Bahn erwischt hat.
 *
 * Gibt Kennungen zurück und löscht selbst nichts: Was gelöscht wird,
 * entscheidet der Speicher, damit der Vorgang **ein** Schritt in der
 * Historie bleibt und nicht einer je Strich.
 */
export function getroffene(
  notizen: Readonly<Record<string, Freihandstrich>>,
  bahn: readonly Vec2[],
  levelId: string,
  radius = RADIER_RADIUS,
): string[] {
  const treffer: string[] = [];
  for (const [id, strich] of Object.entries(notizen)) {
    if (strich.levelId !== levelId) continue;
    if (trifft(strich.punkte, bahn, radius)) treffer.push(id);
  }
  return treffer;
}
