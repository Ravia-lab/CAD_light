/**
 * Wohin eine Tür aufgeht — in Worten, die auf der Baustelle gelten.
 * ---------------------------------------------------------------------------
 * **Das Problem war nie die Geometrie, sondern der Name.** Das Modell weiß
 * seit jeher, zu welcher Seite eine Tür aufschlägt: `flipSwing` kippt sie auf
 * die andere Wandseite, und der Schwenkbogen im Plan folgt dem sofort. In der
 * Oberfläche hieß dieser Schalter „Öffnungsrichtung spiegeln" — ein **Verb
 * ohne Zustand**. Er sagt nicht, wo die Tür vorher aufging und wo nachher,
 * und auf einem Tablet, wo der Inspektor als Schublade über dem Plan liegt,
 * sieht man das Ergebnis beim Drücken nicht einmal.
 *
 * Ein Monteur denkt in zwei anderen Größen:
 *
 *  · **nach innen oder nach außen** — bei einer Tür in der Außenwand;
 *  · **in welchen Raum** — bei einer Innentür („öffnet nach Flur");
 *  · und beim Bestellen in **DIN links / DIN rechts**.
 *
 * Alle drei stehen im Modell, man muss sie nur ausrechnen. Genau das tut
 * diese Datei — ohne DOM, ohne Store, damit die Rechnung prüfbar bleibt.
 *
 * ## Die beiden Seiten einer Wand
 *
 * `WallGeometry.normal` ist die **Linksnormale** zur Achse a→b. Alles hier
 * nennt diese Seite `plus`, die andere `minus`. Welcher Raum auf welcher
 * Seite liegt, wird nicht aus den Raumgrenzen gelesen, sondern gemessen: ein
 * Prüfpunkt dreißig Zentimeter neben der Wandoberfläche, und dann die Frage,
 * in welchem Raumumriss er liegt. Das ist unabhängig davon, wie die
 * Raumerkennung ihre Abschnitte sortiert hat, und es stimmt auch dann noch,
 * wenn eine Wand an mehrere Räume grenzt.
 *
 * ## Welche Seite die Tür aufschlägt
 *
 * `openingSymbols.ts` zeichnet das offene Blatt bei `s = swing · Breite` mit
 * `swing = flipSwing ? -1 : 1`. Ohne `flipSwing` liegt das offene Blatt also
 * auf der Seite der Linksnormalen. Diese eine Zeile ist die ganze Verbindung
 * zwischen Zeichnung und Benennung — ändert sie sich dort, muss sie hier
 * mitgehen, und der Prüfblock `tueranschlag.ts` merkt es.
 *
 * ## DIN 107
 *
 * Bezeichnet wird **von der Öffnungsfläche aus**: Man steht auf der Seite, zu
 * der die Tür aufgeht, und sieht auf sie. Liegt die Drehachse dann links, ist
 * es eine Tür DIN links. Die Merkregel des Handwerks lautet „DIN ist da, wo
 * die Bänder sichtbar sind".
 *
 * Daraus wird hier gerechnet:
 *
 *  · Der Betrachter steht auf der Öffnungsseite σ und blickt zur Wand, also
 *    entgegen σ·n. Seine **linke Hand** zeigt damit in Richtung σ·dir.
 *  · Die Bänder sitzen bei `hinge === 'right'` am Ende der Öffnung (größeres
 *    u, also in +dir), sonst am Anfang.
 *  · Sie liegen links vom Betrachter, wenn beides zusammenfällt:
 *    **DIN links ⇔ (Band am Ende) = (Tür öffnet nach plus)**.
 *
 * Bemerkenswert daran: Die Oberfläche nennt die Bandseite seit jeher
 * „Anschlag links/rechts" — das ist die Seite **in Wandkoordinaten** und
 * gerade *nicht* die DIN-Bezeichnung. Beide können auseinanderfallen, und
 * genau deshalb lohnt es, die DIN-Bezeichnung auszurechnen, statt sie dem
 * Anwender im Kopf zu überlassen.
 *
 * Schichtgrenze: nur Typen und andere lib-Bausteine.
 */

import type { BimNode, Opening, Orientation, Room, Wall } from '../types/bim';
import { azimuthFromNormal, orientationFromAzimuth, pointInPolygon } from './geometry';
import { getWallGeometry, openingSpan, wallLocalToWorld } from './wallGeometry';

/** Wie weit neben der Wandoberfläche gefragt wird, was dort liegt [m]. */
export const PRUEFABSTAND = 0.3;

/**
 * Was auf einer Wandseite liegt.
 *
 * `offen` heißt: Dort ist kein Raum erkannt, und es lässt sich auch nicht
 * sagen, dass dort „außen" wäre. Der Fall ist häufiger, als er klingt — beim
 * Raumscan sind Wandenden offen, bis jemand die Lücken beantwortet hat, und
 * bis dahin gibt es keinen geschlossenen Umriss. Statt zu raten, trägt diese
 * Seite dann ihre Himmelsrichtung: die ist immer richtig und steht ohnehin
 * schon als Kompassrose im Plan.
 */
export type Tuerseite =
  | { art: 'raum'; raumId: string; name: string }
  | { art: 'aussen' }
  | { art: 'offen'; richtung: Orientation };

export interface Tueranschlag {
  /** Was auf der Seite der Linksnormalen liegt. */
  plus: Tuerseite;
  /** Was auf der anderen Seite liegt. */
  minus: Tuerseite;
  /** Wohin die Tür aufschlägt. */
  oeffnetNach: 'plus' | 'minus';
  /** Bezeichnung nach DIN 107. */
  din: 'links' | 'rechts';
  /** Beschriftung der beiden Schaltflächen, in der Sprache der Baustelle. */
  beschriftung: { plus: string; minus: string };
  /** Ein Satz für Panel und Statuszeile. */
  satz: string;
}

/** Name einer Seite für die Schaltfläche — ohne „öffnet nach". */
function seitenname(seite: Tuerseite): string {
  if (seite.art === 'raum') return seite.name;
  if (seite.art === 'aussen') return 'außen';
  return HIMMELSRICHTUNG[seite.richtung];
}

/** Die Himmelsrichtung ausgeschrieben — „öffnet nach NO" liest sich niemand. */
const HIMMELSRICHTUNG: Record<Orientation, string> = {
  N: 'Norden',
  NO: 'Nordosten',
  O: 'Osten',
  SO: 'Südosten',
  S: 'Süden',
  SW: 'Südwesten',
  W: 'Westen',
  NW: 'Nordwesten',
};

/**
 * Was auf einer Seite der Wand liegt.
 *
 * `vorzeichen` ist +1 für die Seite der Linksnormalen, −1 für die andere.
 */
function raumAuf(
  opening: Opening,
  wall: Wall,
  nodes: Record<string, BimNode>,
  raeume: readonly Room[],
  vorzeichen: 1 | -1,
): Room | undefined {
  const g = getWallGeometry(wall, nodes);
  if (!g) return undefined;
  const { from, to } = openingSpan(g, opening);
  const u = (from + to) / 2;
  const punkt = wallLocalToWorld(g, u, vorzeichen * (g.halfThickness + PRUEFABSTAND));
  return raeume.find(
    (r) => r.levelId === wall.levelId && r.innerPolygon.length >= 3 && pointInPolygon(punkt, r.innerPolygon),
  );
}

/** Die Himmelsrichtung, in die eine Wandseite zeigt. */
function richtungVon(wall: Wall, nodes: Record<string, BimNode>, vorzeichen: 1 | -1): Orientation {
  const g = getWallGeometry(wall, nodes);
  if (!g) return 'N';
  return orientationFromAzimuth(
    azimuthFromNormal({ x: g.normal.x * vorzeichen, y: g.normal.y * vorzeichen }),
  );
}

/**
 * Anschlag und Öffnungsrichtung einer Tür in Worten.
 *
 * Gibt `null` zurück, wenn die Öffnung keine Tür ist oder die Wand fehlt —
 * Fenster und Durchgänge schlagen nicht auf.
 */
export function tueranschlag(
  opening: Opening,
  wall: Wall,
  nodes: Record<string, BimNode>,
  raeume: readonly Room[],
): Tueranschlag | null {
  if (opening.kind !== 'door') return null;
  if (!getWallGeometry(wall, nodes)) return null;

  /*
   * **„Außen" wird nur gesagt, wenn es feststeht.**
   *
   * Die naheliegende Regel — „Außenwand, kein Raum, also außen" — ist an
   * einer Außenwand für *beide* Seiten wahr, solange die Raumerkennung
   * drinnen noch keinen Umriss geschlossen hat. Sie hätte damit auch die
   * Wohnzimmerseite „außen" genannt. Feststehen tut es erst, wenn die
   * gegenüberliegende Seite ein Raum ist: Dann ist diese hier der Garten.
   */
  const raumPlus = raumAuf(opening, wall, nodes, raeume, 1);
  const raumMinus = raumAuf(opening, wall, nodes, raeume, -1);
  const seite = (eigener: Room | undefined, gegenueber: Room | undefined, vz: 1 | -1): Tuerseite => {
    if (eigener) return { art: 'raum', raumId: eigener.id, name: eigener.name };
    if (gegenueber && wall.type === 'exterior') return { art: 'aussen' };
    return { art: 'offen', richtung: richtungVon(wall, nodes, vz) };
  };
  const plus = seite(raumPlus, raumMinus, 1);
  const minus = seite(raumMinus, raumPlus, -1);
  const oeffnetNach: 'plus' | 'minus' = opening.flipSwing ? 'minus' : 'plus';

  // Siehe Dateikopf: Band am Ende der Öffnung und Öffnung zur Linksnormalen
  // ergeben zusammen DIN links.
  const bandAmEnde = opening.hinge === 'right';
  const din: 'links' | 'rechts' = bandAmEnde === (oeffnetNach === 'plus') ? 'links' : 'rechts';

  const beschriftung = {
    plus: seitenname(plus),
    minus: seitenname(minus),
  };
  const ziel = oeffnetNach === 'plus' ? beschriftung.plus : beschriftung.minus;
  const satz = `DIN ${din}, öffnet nach ${ziel}`;

  return { plus, minus, oeffnetNach, din, beschriftung, satz };
}
