/**
 * Die Baugrube — was man sieht, wenn man in den Keller schaut.
 * ---------------------------------------------------------------------------
 * **Das gemeldete Bild.** Wer im Modell die Geschosse über dem Keller
 * ausblendet, sah bis 1.60.0 den Rasen. Das Grundstück ist eine gedeckte
 * Fläche auf Höhe der Geländeoberkante, der Keller liegt darunter — also lag
 * der Garten wie ein Deckel über dem, was man sehen wollte. Sichtbar blieb
 * allein der Teil der Kellerwände, der über Gelände aufragt: beim Prüfhaus
 * 1,15 m von 2,30 m, in Manuels Projekt 45 cm. Genau das ist gemeint mit
 * „ich sehe nur die Umrisse" (gemeldet am 27.09.2026).
 *
 * **Die Antwort ist keine Sichtbarkeitsregel, sondern ein Bauvorgang.** Ein
 * Keller steht nicht unter dem gewachsenen Boden, er steht in einer
 * **Baugrube**. Sobald nur noch Geschosse unter Gelände im Bild sind, wird
 * diese Baugrube geöffnet: Das Erdreich wird um das Bauwerk herum
 * ausgehoben, mit Arbeitsraum, und man sieht hinein. Das Grundstück bleibt
 * dabei, wo es ist — Grenze, Wärmepumpe, Schutzbereich und Beläge stehen
 * weiter im Bild. Wer das Gelände ganz weghaben will, hat dafür seinen
 * Schalter; er wird hier nicht ersetzt.
 *
 * **Warum ein Rechteck und keine Umrisslinie.** Eine Baugrube wird
 * ausgehoben, bevor das Haus steht; sie folgt nicht seinem Grundriss, sondern
 * umschließt ihn mit Arbeitsraum. Das Rechteck ist damit nicht die bequeme
 * Näherung, sondern die richtige Form — und nebenbei die einzige, die sich
 * ohne Verschneidung zweier Polygone zeichnen lässt.
 *
 * **Ohne erfasste Geländeoberkante gibt es keine Baugrube.** Das ist
 * dieselbe Regel wie im Export (`raviaExport`) und in der Raumerkennung:
 * Fehlt die Geländeoberkante, ist nicht bekannt, was unter Gelände liegt —
 * und dann wird nichts ausgehoben statt etwas geraten.
 */

import type { BimNode, Level, Wall } from '../types/bim';
import { getWallGeometry } from './wallGeometry';
import { GROUND_SLAB } from './slabGeometry';

/**
 * Arbeitsraum um das Bauwerk [m].
 *
 * Der Streifen zwischen Kellerwand und Böschung, auf dem gearbeitet und
 * abgedichtet wird. DIN 4124 fordert an einer Grube, in der gearbeitet wird,
 * 0,50 m lichte Breite; genau diese Zahl steht hier. Sie ist eine Annahme
 * dieses Programms für die Darstellung und geht in keine Rechnung ein.
 */
export const ARBEITSRAUM = 0.5;

/**
 * Toleranz, ab der ein Geschoss als „unter Gelände" gilt [m].
 *
 * Fünf Millimeter. Ein Geschoss, dessen Fußboden auf der Geländeoberkante
 * liegt, ist keines unter Gelände — und eine Geländeoberkante, die aus einem
 * Import mit 0,0000001 m Abweichung kommt, darf die Grube nicht öffnen.
 */
const TOLERANZ = 0.005;

/** Die ausgehobene Grube in Modellkoordinaten. */
export interface Baugrube {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  /** Oberkante — die Geländeoberkante [m]. */
  gelaende: number;
  /** Sohle — Unterkante der Bodenplatte des untersten sichtbaren Geschosses [m]. */
  sohle: number;
}

export interface BaugrubeEingabe {
  /** Die **sichtbaren** Geschosse. Ausgeblendete zählen nicht mit. */
  levels: readonly Level[];
  /** Die Wände der sichtbaren Geschosse. */
  walls: readonly Wall[];
  nodes: Record<string, BimNode>;
  /** Höhenlage je Geschoss aus `levelBaseHeights`. */
  base: Map<string, number>;
  /** Geländeoberkante über dem Bezugsniveau [m]; `undefined` = nicht erfasst. */
  gelaende: number | undefined;
}

/**
 * Wird die Baugrube geöffnet — und wo?
 *
 * Sie wird geöffnet, wenn **jedes** sichtbare Geschoss unter der
 * Geländeoberkante beginnt. Steht auch nur eines darauf oder darüber, bleibt
 * der Boden geschlossen: Dann schaut man auf ein Haus, das auf einem
 * Grundstück steht, und das ist das gewohnte Bild.
 *
 * Maßgeblich ist der **Fußboden**, nicht die Wandoberkante. Ein halb
 * eingegrabener Keller ragt oben heraus — das ändert nichts daran, dass man
 * ihn nur sieht, wenn das Erdreich um ihn herum weg ist.
 */
export function baugrube(eingabe: BaugrubeEingabe): Baugrube | undefined {
  const { gelaende } = eingabe;
  if (gelaende === undefined || !Number.isFinite(gelaende)) return undefined;
  if (!eingabe.levels.length || !eingabe.walls.length) return undefined;

  let hoechster = -Infinity;
  let tiefster = Infinity;
  for (const level of eingabe.levels) {
    const b = eingabe.base.get(level.id);
    if (b === undefined || !Number.isFinite(b)) continue;
    if (b > hoechster) hoechster = b;
    if (b < tiefster) tiefster = b;
  }
  if (!Number.isFinite(hoechster)) return undefined;
  // Das höchste sichtbare Geschoss entscheidet: liegt sein Fußboden auf oder
  // über Gelände, steht etwas Sichtbares im Freien und es wird nicht gegraben.
  if (hoechster >= gelaende - TOLERANZ) return undefined;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const sichtbar = new Set(eingabe.levels.map((l) => l.id));
  for (const wall of eingabe.walls) {
    if (!sichtbar.has(wall.levelId)) continue;
    const g = getWallGeometry(wall, eingabe.nodes);
    if (!g) continue;
    // Die Außenkante der Wand, nicht ihre Achse: Die Grube muss das Bauwerk
    // umschließen und nicht durch seine Wände laufen.
    const h = g.halfThickness;
    for (const p of [g.a, g.b]) {
      if (p.x - h < minX) minX = p.x - h;
      if (p.x + h > maxX) maxX = p.x + h;
      if (p.y - h < minY) minY = p.y - h;
      if (p.y + h > maxY) maxY = p.y + h;
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return undefined;

  return {
    minX: minX - ARBEITSRAUM,
    maxX: maxX + ARBEITSRAUM,
    minY: minY - ARBEITSRAUM,
    maxY: maxY + ARBEITSRAUM,
    gelaende,
    // Die Sohle liegt unter der Bodenplatte des untersten sichtbaren
    // Geschosses — sonst endete die Böschung in der Platte und die Grube
    // sähe aus, als schwebte das Haus darin.
    sohle: (Number.isFinite(tiefster) ? tiefster : hoechster) - GROUND_SLAB,
  };
}
