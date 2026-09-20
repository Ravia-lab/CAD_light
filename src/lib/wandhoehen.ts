/**
 * Wandhöhen angleichen — eine Deckenhöhe je Geschoss.
 * ---------------------------------------------------------------------------
 * **Warum das eine eigene Funktion braucht.** Die Raumhöhe wird in
 * `roomDetection` nicht gesetzt, sondern **gemessen**: Sie ist die *niedrigste*
 * Wand des Raums (oberhalb Brüstungshöhe), ersatzweise die Geschosshöhe. Eine
 * einzige Wand, die beim Zeichnen auf 2,19 m stehen geblieben ist, zieht damit
 * die Höhe des ganzen Raums herunter — und mit ihr Volumen, Luftwechsel und
 * Lüftungsverlust.
 *
 * Genau so entsteht der Grundriss, in dem nebeneinander 2,44 m · 2,45 m ·
 * 2,19 m · 2,29 m stehen, ohne dass jemals jemand eine abgehängte Decke
 * gemessen hätte. Auffallen tut es niemandem, weil jede Zahl für sich
 * plausibel aussieht.
 *
 * **Was hier entschieden wird und was nicht.** Dieses Modul rechnet den
 * Befund: Welche Wände weichen ab, um wie viel, und welche bleiben mit
 * Begründung stehen. Es ändert nichts — das tut der Speicher, in einem
 * Schritt, der sich rückgängig machen lässt. Dieselbe Trennung wie beim
 * Heizflächenabgleich, und aus demselben Grund: So lässt sich die Regel
 * prüfen, ohne eine Oberfläche zu starten.
 *
 * **Die Ausnahme ist die Dachschräge, und sie wird gerechnet, nicht geraten.**
 * Liegt über dem Geschoss ein Dach, wird für jede Wand die lichte Höhe des
 * Dachs an ihrer Mitte bestimmt (`roofHeightAt`). Bleibt sie unter der
 * Sollhöhe, ist die Wand ein Kniestock oder eine Wand unter der Schräge —
 * sie wird **nicht** angefasst. Eine Kniestockwand auf Geschosshöhe zu
 * ziehen hieße, das Dachgeschoss rechnerisch aufzublasen.
 *
 * Schichtgrenze: nur `types` und andere `lib`-Bausteine.
 */

import type { BimNode, Level, Vec2, Wall } from '../types/bim';
import type { RoofFrame } from './roofGeometry';
import { roofHeightAt } from './roofGeometry';
import { pointInPolygon } from './geometry';

/**
 * Ab welcher Abweichung eine Wand überhaupt als abweichend gilt [m].
 *
 * **Ein Zentimeter, und das ist keine Willkür.** Höhen werden in der
 * Oberfläche auf Zentimeter eingegeben. Ohne Totzone meldete jede
 * Gleitkomma-Ungenauigkeit eine Abweichung, und der Knopf „angleichen"
 * stünde dauerhaft auf „3 Wände" — bis ihn niemand mehr drückt.
 */
export const TOTZONE = 0.01;

/**
 * Unterhalb dieser Höhe ist eine Wand keine Raumwand [m].
 *
 * Derselbe Wert, mit dem `roomDetection` die Raumhöhe misst: Eine Brüstung,
 * ein Sockel oder eine halbhohe Abtrennung soll die Raumhöhe nicht bestimmen
 * — und darf hier folgerichtig auch nicht auf Geschosshöhe gezogen werden.
 * Aus einer 1,10-m-Brüstung eine 2,50-m-Wand zu machen wäre keine Korrektur,
 * sondern eine Bauteiländerung.
 */
export const BRUESTUNGS_HOEHE = 1.4;

/** Warum eine Wand stehen bleibt. */
export type Ausnahmegrund = 'dachschraege' | 'bruestung' | 'andere-ebene';

export const AUSNAHME_LABELS: Record<Ausnahmegrund, string> = {
  dachschraege: 'unter der Dachschräge',
  bruestung: 'Brüstung oder halbhohe Wand',
  'andere-ebene': 'gehört zu einem anderen Geschoss',
};

export interface Hoehenaenderung {
  wallId: string;
  ist: number;
  soll: number;
}

export interface Hoehenausnahme {
  wallId: string;
  ist: number;
  grund: Ausnahmegrund;
}

export interface Hoehenbefund {
  /** Höhe, auf die angeglichen würde [m] — die lichte Geschosshöhe. */
  soll: number;
  /** Wände, die geändert würden. */
  aenderungen: Hoehenaenderung[];
  /** Wände, die mit Grund stehen bleiben. */
  ausnahmen: Hoehenausnahme[];
  /** Größte Abweichung unter den Änderungen [m] — für die Vorschau. */
  groessteAbweichung: number;
  /** Zahl der Wände des Geschosses insgesamt. */
  gesamt: number;
}

export interface Hoehenbefundeingabe {
  level: Level;
  walls: readonly Wall[];
  nodes: Record<string, BimNode>;
  /**
   * Dachgerüste dieses Geschosses — seit 1.36.0 kann es mehrere geben.
   *
   * Maßgeblich ist das Dach **über der jeweiligen Wand**, nicht irgendeines
   * des Geschosses. Beim L-Haus stünde sonst die Traufwand des Nordflügels
   * unter dem Dach des Hauptbaus, und ihre Höhe würde angeglichen, obwohl
   * dort eine Schräge sitzt.
   */
  roofFrames?: readonly (RoofFrame | null)[];
}

/**
 * Liegt der Punkt unter diesem Dach?
 *
 * **Warum nicht einfach `pointInPolygon`.** Die Punkte, die hier gefragt
 * werden, sind Wandmitten — und die Wände *sind* der Umriss. Sie liegen
 * also genau auf der Polygonkante, und dort ist die Antwort von
 * `pointInPolygon` nicht definiert: Bei der Prüfung fiel genau das auf, die
 * Westwand galt als drinnen, die Ostwand als draußen. Dasselbe Haus, dieselbe
 * Lage, zwei Antworten.
 *
 * Der Punkt wird deshalb einen Zentimeter zur Umrissmitte hin gerückt, bevor
 * gefragt wird. Ein Zentimeter ist weniger als jede Wandstärke und damit
 * sicher innerhalb des Gebäudes, aber mehr als jede Rundung.
 */
function unterDach(frame: RoofFrame, p: Vec2): boolean {
  if (frame.umriss.length < 3) return true;
  let sx = 0;
  let sy = 0;
  for (const q of frame.umriss) {
    sx += q.x;
    sy += q.y;
  }
  const mx = sx / frame.umriss.length;
  const my = sy / frame.umriss.length;
  const dx = mx - p.x;
  const dy = my - p.y;
  const l = Math.hypot(dx, dy);
  const innen = l > 1e-9 ? { x: p.x + (dx / l) * 0.01, y: p.y + (dy / l) * 0.01 } : p;
  return pointInPolygon(innen, frame.umriss);
}

/** Mitte einer Wand im Grundriss — oder `null`, wenn ein Knoten fehlt. */
function mitte(wall: Wall, nodes: Record<string, BimNode>): { x: number; y: number } | null {
  const a = nodes[wall.a];
  const b = nodes[wall.b];
  if (!a || !b) return null;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * Was eine Angleichung täte — ohne sie zu tun.
 *
 * Die Reihenfolge der Prüfungen ist bewusst: Erst wird ausgeschlossen, was
 * gar keine Raumwand ist (Brüstung), dann, was unter dem Dach liegt, und
 * erst zuletzt gemessen. Andersherum stünde eine Kniestockwand als
 * „Abweichung von 1,20 m" in der Vorschau, und die Zahl, die der Mensch
 * liest, wäre eine Drohung statt einer Auskunft.
 */
export function hoehenbefund(eingabe: Hoehenbefundeingabe): Hoehenbefund {
  const { level, walls, nodes } = eingabe;
  const rahmen = (eingabe.roofFrames ?? []).filter((r): r is RoofFrame => !!r);
  const soll = Number.isFinite(level.height) && level.height > 0 ? level.height : 2.5;

  const aenderungen: Hoehenaenderung[] = [];
  const ausnahmen: Hoehenausnahme[] = [];
  let gesamt = 0;

  for (const wall of walls) {
    if (wall.levelId !== level.id) continue;
    gesamt += 1;

    if (!Number.isFinite(wall.height) || wall.height < BRUESTUNGS_HOEHE) {
      ausnahmen.push({ wallId: wall.id, ist: wall.height, grund: 'bruestung' });
      continue;
    }

    if (rahmen.length) {
      const p = mitte(wall, nodes);
      // Ohne Knoten lässt sich die Lage unter dem Dach nicht bestimmen. Dann
      // wird nicht angefasst — im Zweifel stehen lassen.
      if (!p) {
        ausnahmen.push({ wallId: wall.id, ist: wall.height, grund: 'dachschraege' });
        continue;
      }
      /*
       * Das Dach **über dieser Wand**. Ein Gerüst ohne Umriss gilt für das
       * ganze Geschoss (Projekte vor 1.36.0); sonst entscheidet der Umriss.
       * Liegt die Wand unter keinem Dach, gibt es dort keine Schräge und
       * die Wand wird angeglichen wie jede andere.
       */
      const darueber = rahmen.find((r) => unterDach(r, p));
      if (darueber) {
        const lichte = roofHeightAt(darueber, p);
        if (Number.isFinite(lichte) && lichte < soll - TOTZONE) {
          ausnahmen.push({ wallId: wall.id, ist: wall.height, grund: 'dachschraege' });
          continue;
        }
      }
    }

    if (Math.abs(wall.height - soll) > TOTZONE) {
      aenderungen.push({ wallId: wall.id, ist: wall.height, soll });
    }
  }

  const groessteAbweichung = aenderungen.reduce(
    (m, a) => Math.max(m, Math.abs(a.soll - a.ist)),
    0,
  );

  return { soll, aenderungen, ausnahmen, groessteAbweichung, gesamt };
}

/**
 * Ein Satz aus dem Befund — für Knopf, Vorschau und Statuszeile.
 *
 * Er sagt **immer** beide Zahlen: wie viele Wände sich ändern und wie viele
 * mit Grund stehen bleiben. Eine Vorschau, die nur die Änderungen nennt,
 * lässt den Anwender glauben, danach sei alles gleich hoch — und im
 * Dachgeschoss ist es das nicht, mit voller Absicht.
 */
export function befundSatz(b: Hoehenbefund): string {
  const cm = (m: number): string => `${Math.round(m * 100)} cm`;
  const dach = b.ausnahmen.filter((a) => a.grund === 'dachschraege').length;
  const bruestung = b.ausnahmen.filter((a) => a.grund === 'bruestung').length;

  if (b.aenderungen.length === 0) {
    const teile = [`Alle Wände stehen auf ${cm(b.soll)}`];
    if (dach) teile.push(`${dach} unter der Dachschräge bleiben, wie sie sind`);
    if (bruestung) teile.push(`${bruestung} Brüstung${bruestung === 1 ? '' : 'en'} ebenso`);
    return `${teile.join('; ')}.`;
  }

  const teile = [
    `${b.aenderungen.length} von ${b.gesamt} Wänden auf ${cm(b.soll)} — größte Änderung ${cm(b.groessteAbweichung)}`,
  ];
  if (dach) teile.push(`${dach} unter der Dachschräge bleiben stehen`);
  if (bruestung) teile.push(`${bruestung} Brüstung${bruestung === 1 ? '' : 'en'} bleibt${bruestung === 1 ? '' : 'en'} stehen`);
  return `${teile.join('; ')}.`;
}
