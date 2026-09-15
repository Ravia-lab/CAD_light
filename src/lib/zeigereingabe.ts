/**
 * Stift, Finger, Maus — wer darf was.
 * ---------------------------------------------------------------------------
 * **Warum es diese Datei gibt.** Der Zeichner arbeitet seit jeher mit
 * Pointer-Ereignissen und nicht mit Maus-Ereignissen; damit war er technisch
 * schon immer stift- und fingerfähig. Was fehlte, war die **Regel**, wer
 * gewinnt, wenn mehrere Zeiger gleichzeitig auf dem Glas liegen — und genau
 * das ist auf einem Tablet der Normalfall und nicht die Ausnahme:
 *
 *  · Wer mit dem Stift schreibt, **legt die Hand auf**. Ohne Regel meldet das
 *    Betriebssystem einen zweiten Zeiger, und der Zeichner zieht eine Wand
 *    vom Handballen zum Stift. Das ist kein Schönheitsfehler, sondern macht
 *    das Gerät unbenutzbar.
 *  · Zwei Finger heißen auf jedem Tablet „zoomen und schieben". Ein Zeichner,
 *    der daraus zwei Wände macht, verhält sich falsch, auch wenn er
 *    technisch richtig reagiert.
 *  · Ein Fingerkuppenabdruck ist rund einen Zentimeter breit. Fangradien, die
 *    für einen Mauszeiger von einem Pixel gemacht sind, treffen damit nichts.
 *
 * **Warum als eigenes Modul und nicht im Zeichner.** Dieselbe Frage stellt
 * sich im Grundriss, im Anlagenschema und im Kalibrierfenster — drei
 * Zeichenwege, die heute schon jeder für sich Zeiger auswerten. Drei Kopien
 * derselben Regel wären drei Regeln, sobald jemand eine davon anfasst. Und:
 * hier drin steht kein DOM, keine Uhr und kein React. Damit ist die Regel
 * prüfbar, ohne ein Tablet in die Hand zu nehmen.
 *
 * **Die Vorgabe: der Stift zeichnet, der Finger schiebt.** Das ist die
 * Aufteilung, die jedes Zeichenprogramm auf dem Tablet benutzt, und sie löst
 * das Handballenproblem nicht nachträglich, sondern von vornherein: was mit
 * dem Finger kommt, zeichnet ohnehin nie. Wer kein Gerät mit Stift hat, kann
 * sie umstellen — dann greift die Karenzregel unten.
 */

import type { Vec2 } from '../types/bim';

// ---------------------------------------------------------------------------
// Eingabeart
// ---------------------------------------------------------------------------

/** Womit gezeigt wird. */
export type Eingabeart = 'maus' | 'stift' | 'finger';

/**
 * Die Eingabeart aus `PointerEvent.pointerType`.
 *
 * Unbekanntes gilt als Maus — das ist die Art mit den engsten Toleranzen und
 * ohne Sonderregeln. Ein Gerät, das sich nicht zu erkennen gibt, verhält sich
 * damit wie bisher und nicht plötzlich anders.
 */
export function eingabeart(pointerType: string | undefined): Eingabeart {
  if (pointerType === 'pen') return 'stift';
  if (pointerType === 'touch') return 'finger';
  return 'maus';
}

/**
 * Wie großzügig gefangen wird, je Eingabeart — als **Faktor** auf die
 * Einstellung des Anwenders, nicht als eigene Zahl.
 *
 * Ein fester Wert je Art würde die Einstellung „Fangradius" aushebeln: wer
 * sie auf 20 px stellt, weil er grob zeichnet, bekäme am Tablet trotzdem 30.
 * Der Faktor lässt seine Wahl bestehen und rechnet nur die Eingabeart dazu.
 *
 * **Woher die Zahlen kommen.** Die Berührungsfläche einer Fingerkuppe ist
 * rund 8 bis 10 mm breit; auf einem iPad sind das etwa 45 bis 55 CSS-Pixel,
 * also rund 25 Pixel Halbmesser — das Zweieinhalbfache des Mauswertes. Der
 * Stift trifft dagegen genau, aber die Hand verdeckt das Ziel: dort genügt
 * ein Drittel mehr.
 */
export const FANG_FAKTOR: Record<Eingabeart, number> = {
  maus: 1,
  stift: 1.35,
  finger: 2.5,
};

/** Kleinste Kantenlänge einer Schaltfläche [CSS-Pixel] bei Berührung. */
export const TIPPZIEL = 44;

// ---------------------------------------------------------------------------
// Wer darf zeichnen
// ---------------------------------------------------------------------------

/** Was mit einem Zeiger geschehen soll. */
export type Absicht =
  /** Zeichnen, auswählen, ziehen — die eigentliche Arbeit. */
  | 'zeichnen'
  /** Den Ausschnitt schieben. */
  | 'schieben'
  /** Teil einer Zwei-Finger-Geste. */
  | 'geste'
  /** Nichts tun — Handballen oder ein Finger, während der Stift arbeitet. */
  | 'verwerfen';

export interface Eingabeeinstellung {
  /**
   * Darf der Finger zeichnen?
   *
   * Vorgabe **nein**: auf einem Gerät mit Stift ist das die Regel, die den
   * Handballen von vornherein ausschließt. Für ein Tablet ohne Stift lässt
   * sie sich umlegen — dann trägt die Karenzregel allein.
   */
  fingerZeichnet: boolean;
}

export const EINGABE_VORGABE: Eingabeeinstellung = { fingerZeichnet: false };

/**
 * Wie lange nach dem Abheben des Stifts noch kein Finger zeichnen darf [ms].
 *
 * **Wozu die Karenz.** Beim Absetzen des Stifts liegt die Hand oft schon auf
 * dem Glas, und beim Abheben bleibt sie einen Moment liegen. Ohne Karenz
 * würde genau dieser Moment als Fingerstrich gelesen — ein kurzer Kringel
 * neben der eben gezogenen Wand. Eine halbe Sekunde deckt das Abheben ab und
 * ist kurz genug, dass niemand auf einen Finger wartet.
 */
export const STIFT_KARENZ_MS = 500;

/**
 * Der Zustand, den die Entscheidung braucht — bewusst ein einfaches Objekt.
 *
 * Der Aufrufer hält ihn und reicht ihn herein; das Modul selbst hat kein
 * Gedächtnis. Damit ist jede Entscheidung aus ihren Eingaben allein
 * nachvollziehbar, und ein Prüflauf kann eine ganze Handbewegung Schritt für
 * Schritt durchspielen, ohne Zeit vergehen zu lassen.
 */
export interface Zeigerlage {
  /** Wie viele Finger gerade aufliegen. */
  finger: number;
  /** Liegt der Stift auf? */
  stiftUnten: boolean;
  /** Wann der Stift zuletzt aufgelegen hat [ms seit Programmstart]; 0 = nie. */
  stiftZuletzt: number;
}

export const ZEIGERLAGE_LEER: Zeigerlage = { finger: 0, stiftUnten: false, stiftZuletzt: 0 };

/**
 * Was ein neu aufsetzender Zeiger tun soll.
 *
 * `lage` ist der Stand **vor** diesem Zeiger: `finger` zählt die schon
 * aufliegenden Finger, nicht den neuen mit.
 */
export function absicht(
  art: Eingabeart,
  lage: Zeigerlage,
  jetzt: number,
  einstellung: Eingabeeinstellung = EINGABE_VORGABE,
): Absicht {
  // Die Maus kennt keine Gesten und keinen Handballen.
  if (art === 'maus') return 'zeichnen';

  // Der Stift hat immer Vorrang — auch wenn schon Finger aufliegen. Wer den
  // Stift ansetzt, meint den Stift.
  if (art === 'stift') return 'zeichnen';

  // Ab hier: Finger.
  //
  // Solange der Stift arbeitet oder gerade gearbeitet hat, ist jeder Finger
  // die Hand, mit der der Stift gehalten wird. Sie wird verworfen — auch als
  // Geste, denn ein Handballen und ein Stift sind keine zwei Finger.
  if (lage.stiftUnten || (lage.stiftZuletzt > 0 && jetzt - lage.stiftZuletzt < STIFT_KARENZ_MS)) {
    return 'verwerfen';
  }

  // Der zweite Finger macht aus dem Schieben eine Geste. Ein dritter und
  // jeder weitere ändert nichts mehr — er wird verworfen, statt die Geste zu
  // stören. Drei Finger sind auf einem Tablet fast immer die Handfläche.
  if (lage.finger >= 2) return 'verwerfen';
  if (lage.finger === 1) return 'geste';

  return einstellung.fingerZeichnet ? 'zeichnen' : 'schieben';
}

/**
 * Die Zeigerlage nach einem Ereignis fortschreiben.
 *
 * Getrennt von `absicht`, weil beides verschiedene Fragen beantwortet: „was
 * soll geschehen" und „was liegt jetzt auf". Wer sie zusammenlegt, kann die
 * Entscheidung nicht mehr prüfen, ohne den Zustand mitzuändern.
 */
export function fortschreiben(
  lage: Zeigerlage,
  art: Eingabeart,
  phase: 'runter' | 'hoch',
  jetzt: number,
): Zeigerlage {
  if (art === 'stift') {
    return phase === 'runter'
      ? { ...lage, stiftUnten: true, stiftZuletzt: jetzt }
      : { ...lage, stiftUnten: false, stiftZuletzt: jetzt };
  }
  if (art === 'finger') {
    const finger = phase === 'runter' ? lage.finger + 1 : Math.max(0, lage.finger - 1);
    return { ...lage, finger };
  }
  return lage;
}

// ---------------------------------------------------------------------------
// Zwei-Finger-Geste
// ---------------------------------------------------------------------------

/** Der Blick auf die Zeichnung, wie ihn der Zeichner führt. */
export interface Ausschnitt {
  /** Weltpunkt in der Mitte des Feldes. */
  center: Vec2;
  /** Bildpunkte je Meter. */
  zoom: number;
}

/** Größe des Zeichenfeldes [CSS-Pixel]. */
export interface Feldgroesse {
  w: number;
  h: number;
}

/** Die Lage zweier Finger auf dem Glas [CSS-Pixel, Ursprung links oben]. */
export interface Fingerpaar {
  a: Vec2;
  b: Vec2;
}

/** Grenzen des Maßstabs — dieselben wie beim Mausrad. */
export const ZOOM_MIN = 4;
export const ZOOM_MAX = 900;

const mitte = (p: Fingerpaar): Vec2 => ({ x: (p.a.x + p.b.x) / 2, y: (p.a.y + p.b.y) / 2 });
const spanne = (p: Fingerpaar): number => Math.hypot(p.b.x - p.a.x, p.b.y - p.a.y);

/** Bildpunkt → Weltpunkt, dieselbe Rechnung wie im Zeichner. */
export function zuWelt(screen: Vec2, aus: Ausschnitt, feld: Feldgroesse): Vec2 {
  return {
    x: (screen.x - feld.w / 2) / aus.zoom + aus.center.x,
    y: (feld.h / 2 - screen.y) / aus.zoom + aus.center.y,
  };
}

/**
 * Ein Schritt der Zwei-Finger-Geste.
 *
 * **Die eine Eigenschaft, die zählt:** der Weltpunkt zwischen den Fingern
 * bleibt zwischen den Fingern. Alles andere folgt daraus. Wer stattdessen
 * erst zoomt und dann verschiebt, bekommt ein Bild, das unter den Fingern
 * wegläuft — und das merkt man sofort, ohne es benennen zu können.
 *
 * Zoomen und Schieben sind derselbe Schritt und nicht zwei: die Finger tun
 * beides gleichzeitig, und wer es trennt, muss sich für eine Reihenfolge
 * entscheiden, die es nicht gibt.
 */
export function gestenschritt(
  vorher: Fingerpaar,
  jetzt: Fingerpaar,
  aus: Ausschnitt,
  feld: Feldgroesse,
): Ausschnitt {
  const s0 = spanne(vorher);
  const s1 = spanne(jetzt);
  // Zwei Finger auf demselben Punkt geben kein Verhältnis her. Dann bleibt
  // der Maßstab und es wird nur geschoben — besser als eine Division durch
  // beinahe null, die das Bild wegschleudert.
  const faktor = s0 > 1 && s1 > 1 ? s1 / s0 : 1;
  const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, aus.zoom * faktor));

  const m0 = mitte(vorher);
  const m1 = mitte(jetzt);
  const halt = zuWelt(m0, aus, feld);

  return {
    zoom,
    center: {
      x: halt.x - (m1.x - feld.w / 2) / zoom,
      y: halt.y - (feld.h / 2 - m1.y) / zoom,
    },
  };
}
