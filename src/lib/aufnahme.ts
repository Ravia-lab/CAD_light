/**
 * Die Aufnahme Zimmer für Zimmer — die Rechenseite.
 * ---------------------------------------------------------------------------
 *
 * **Wofür.** Wer noch nie ein CAD bedient hat, scheitert nicht an der Zahl
 * der Werkzeuge, sondern an der ersten Frage, die er nicht beantworten kann.
 * Deshalb gibt es neben dem Zeichnen einen zweiten Weg zum Grundriss: Das
 * Programm fragt, der Anwender antwortet, und aus den Antworten entstehen
 * ganz normale Wände.
 *
 * Ein Mensch, der eine Wohnung aufnimmt, **geht durch die Zimmer**. Er steht
 * im Wohnzimmer, misst 4,20 auf 5,10, zählt zwei Fenster — und geht ins
 * nächste. Er denkt nicht in Wänden, nicht in Zügen und nicht in Achsen.
 * Genau dieser Gang ist die Fragenfolge hier.
 *
 * **Was dieses Modul tut und was nicht.** Es rechnet, wo das nächste
 * Rechteck liegt, und hält die Tabelle der Raumarten. Es legt **nichts** an:
 * die Wände entstehen über `addRoomTemplate`, also über denselben Weg wie
 * beim Werkzeug „Raum aufziehen". Damit gibt es keine zweite Geometrie und
 * keinen zweiten Datenbestand — nach der letzten Antwort steht ein Modell da,
 * als hätte es jemand gezeichnet.
 *
 * **Koordinaten.** Gerechnet wird in Metern auf den **Wandachsen**, und +y
 * zeigt nach oben (so zeichnet der Editor). „Darunter" heißt deshalb
 * kleineres y, nicht größeres — der Fehler wäre nicht zu sehen, solange alle
 * Räume nebeneinanderliegen, und fiele erst beim ersten „darunter" auf.
 */

import type { Annahme, RoomUsage, Vec2 } from '../types/bim';

// ---------------------------------------------------------------------------
// Raumarten
// ---------------------------------------------------------------------------

/**
 * Eine Raumart, wie sie der Anwender antippt.
 *
 * `l` und `b` sind **Vorgaben in Metern**, kein Nachschlagewerk: Sie stehen
 * schon im Eingabefeld, damit niemand bei null anfängt, und werden in der
 * Regel überschrieben. Die Zahlen sind gebräuchliche Zimmergrößen; die
 * Solltemperatur kommt nicht von hier, sondern aus `usageDefaults` — es gibt
 * sie im Programm bereits, und zwei Tabellen über dieselbe Sache laufen
 * auseinander.
 */
export interface Raumart {
  id: string;
  label: string;
  usage: RoomUsage;
  /** Vorgeschlagene Länge [m]. */
  l: number;
  /** Vorgeschlagene Breite [m]. */
  b: number;
}

export const RAUMARTEN: readonly Raumart[] = [
  { id: 'wohnen', label: 'Wohnen', usage: 'living', l: 4.5, b: 5.0 },
  { id: 'schlafen', label: 'Schlafen', usage: 'bedroom', l: 3.5, b: 4.0 },
  { id: 'kind', label: 'Kind', usage: 'bedroom', l: 3.0, b: 3.5 },
  { id: 'kueche', label: 'Küche', usage: 'kitchen', l: 3.0, b: 3.5 },
  { id: 'bad', label: 'Bad', usage: 'bath', l: 2.4, b: 3.0 },
  { id: 'wc', label: 'WC', usage: 'wc', l: 1.2, b: 2.2 },
  { id: 'flur', label: 'Flur', usage: 'hallway', l: 1.5, b: 5.0 },
  { id: 'buero', label: 'Büro', usage: 'office', l: 3.0, b: 3.5 },
  { id: 'abstell', label: 'Abstell', usage: 'storage', l: 1.5, b: 2.0 },
  { id: 'technik', label: 'Technik', usage: 'technical', l: 2.0, b: 2.5 },
];

export function raumart(id: string): Raumart | undefined {
  return RAUMARTEN.find((r) => r.id === id);
}

// ---------------------------------------------------------------------------
// Wo der nächste Raum liegt
// ---------------------------------------------------------------------------

/** Auf welcher Seite des vorigen Raums der nächste liegt. */
export type Anbau = 'rechts' | 'links' | 'oben' | 'unten';

export const ANBAU_LABELS: Record<Anbau, string> = {
  rechts: 'rechts daneben',
  links: 'links daneben',
  oben: 'darüber',
  unten: 'darunter',
};

/** Ein achsparalleles Rechteck auf den Wandachsen [m]. */
export interface Achsrechteck {
  /** Linke untere Ecke. */
  x: number;
  y: number;
  /** Ausdehnung in x [m]. */
  l: number;
  /** Ausdehnung in y [m]. */
  b: number;
}

/**
 * Wo liegt das nächste Rechteck?
 *
 * Der erste Raum liegt im Ursprung — das ist eine Setzung und keine Rechnung;
 * eingepasst wird die Ansicht ohnehin. Jeder weitere dockt an den **zuletzt
 * angelegten** an, nicht an irgendeinen: Der Anwender hat gerade diesen Raum
 * vor Augen, und die Frage lautet „wo liegt der nächste von *hier* aus".
 *
 * Die gemeinsame Kante entsteht dabei von selbst, weil beide Rechtecke
 * dieselbe Koordinate teilen. Dass daraus **eine** Wand wird und nicht zwei
 * aufeinanderliegende, besorgt `addRoomTemplate`: Es verschmilzt nahe Knoten
 * und überspringt eine Wand, die zwischen denselben beiden Knoten schon
 * steht.
 */
export function platziere(
  vorher: Achsrechteck | undefined,
  anbau: Anbau,
  l: number,
  b: number,
): Achsrechteck {
  if (!vorher) return { x: 0, y: 0, l, b };
  switch (anbau) {
    case 'rechts':
      return { x: vorher.x + vorher.l, y: vorher.y, l, b };
    case 'links':
      return { x: vorher.x - l, y: vorher.y, l, b };
    case 'oben':
      return { x: vorher.x, y: vorher.y + vorher.b, l, b };
    case 'unten':
      return { x: vorher.x, y: vorher.y - b, l, b };
  }
}

/** Die beiden Ecken, mit denen `addRoomTemplate` aufgezogen wird. */
export function ecken(r: Achsrechteck): { from: Vec2; to: Vec2 } {
  return { from: { x: r.x, y: r.y }, to: { x: r.x + r.l, y: r.y + r.b } };
}

/** Grundfläche auf den Achsen [m²] — nicht das lichte Maß. */
export function achsflaeche(r: Achsrechteck): number {
  return r.l * r.b;
}

/** Die beiden Endpunkte einer Rechteckseite — in Richtung aufsteigender Achse. */
export function seitenkanten(r: Achsrechteck, seite: Anbau): [Vec2, Vec2] {
  switch (seite) {
    case 'rechts':
      return [{ x: r.x + r.l, y: r.y }, { x: r.x + r.l, y: r.y + r.b }];
    case 'links':
      return [{ x: r.x, y: r.y }, { x: r.x, y: r.y + r.b }];
    case 'oben':
      return [{ x: r.x, y: r.y + r.b }, { x: r.x + r.l, y: r.y + r.b }];
    case 'unten':
      return [{ x: r.x, y: r.y }, { x: r.x + r.l, y: r.y }];
  }
}

/** Überdeckung zweier Zahlenbereiche [m] — negativ, wenn sie sich nicht berühren. */
function ueberdeckung(a0: number, a1: number, b0: number, b1: number): number {
  return Math.min(a1, b1) - Math.max(a0, b0);
}

/**
 * Liegt an dieser Seite schon ein anderer Raum?
 *
 * Geprüft wird auf der Achse: Eine Seite ist belegt, wenn ein anderes
 * Rechteck mit einer seiner Kanten auf derselben Linie liegt **und** sich die
 * Ausdehnung um mehr als einen Zentimeter überschneidet. Eine bloße
 * Eckberührung ist keine Belegung — dort steht keine gemeinsame Wand.
 */
export function seiteBelegt(r: Achsrechteck, seite: Anbau, andere: readonly Achsrechteck[]): boolean {
  const senkrecht = seite === 'rechts' || seite === 'links';
  const linie = seite === 'rechts' ? r.x + r.l : seite === 'links' ? r.x : seite === 'oben' ? r.y + r.b : r.y;
  const [von, bis] = senkrecht ? [r.y, r.y + r.b] : [r.x, r.x + r.l];
  for (const q of andere) {
    const kanten = senkrecht ? [q.x, q.x + q.l] : [q.y, q.y + q.b];
    if (!kanten.some((k) => Math.abs(k - linie) < 0.01)) continue;
    const [qv, qb] = senkrecht ? [q.y, q.y + q.b] : [q.x, q.x + q.l];
    if (ueberdeckung(von, bis, qv, qb) > 0.01) return true;
  }
  return false;
}

/**
 * Welche Seite bekommt die Fenster?
 *
 * **Warum das nicht einfach „gegenüber dem Anschluss" sein kann.** Beim
 * *ersten* Raum gibt es keinen Anschluss, und wer dort auf gut Glück eine
 * Seite nimmt, stellt mit dem zweiten Raum den Nachbarn genau davor: Die
 * Fenster stehen dann in einer Innenwand. Im Plan fällt das kaum auf, in der
 * Heizlast sehr wohl — ein Fenster in einer Innenwand rechnet mit
 * Außentemperatur gegen das Nebenzimmer.
 *
 * Entschieden wird deshalb nach dem, was dasteht: Die bevorzugte Seite kommt
 * zuerst, und belegt eine schon ein anderer Raum, wird die nächste freie
 * genommen. Ist jeder Seite ein Raum vorgelagert, gibt es `undefined` — dann
 * gehört in diesen Raum kein Fenster, und das ist eine Aussage und kein
 * Fehler.
 */
export function fensterseite(
  r: Achsrechteck,
  bevorzugt: Anbau,
  andere: readonly Achsrechteck[],
): Anbau | undefined {
  const reihe: Anbau[] = [bevorzugt, 'unten', 'rechts', 'links', 'oben'];
  for (const seite of reihe) {
    if (!seiteBelegt(r, seite, andere)) return seite;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Fenster: wohin damit
// ---------------------------------------------------------------------------

/**
 * Wie viele Fenster in eine Wand dieser Länge passen.
 *
 * **Warum das begrenzt wird.** Gefragt wird nach der Zahl, nicht nach dem
 * Maß — zählen kann jeder, über Kopf messen nicht. Vier Fenster in einer
 * 1,20 m langen Wand sind aber keine Angabe, sondern ein Vertipper, und
 * vier Öffnungen, die einander überlappen, machen aus der Wand ein Loch.
 *
 * Gerechnet wird mit der Regelbreite plus einem Rest von 24 cm Mauerwerk
 * zwischen zwei Öffnungen und an den Enden. In eine 3,50-m-Wand passen damit
 * bei 1,26 m Regelbreite: (3,50 − 0,24) / (1,26 + 0,24) = 2,17 → **zwei**.
 */
export const FENSTER_REGELBREITE = 1.26;
export const PFEILER_MIN = 0.24;

export function fensterPlatz(wandlaenge: number, breite = FENSTER_REGELBREITE): number {
  const platz = Math.floor((wandlaenge - PFEILER_MIN) / (breite + PFEILER_MIN));
  return Math.max(0, platz);
}

/**
 * Die Mittelpunkte der Fenster auf einer Wand, als Anteil ihrer Länge.
 *
 * Gleichmäßig verteilt: bei einem Fenster die Mitte, bei zweien ein Drittel
 * und zwei Drittel. Das ist eine **Annahme über die Lage**, keine Messung —
 * sie wird als solche vermerkt, und wer es genau braucht, schiebt die
 * Öffnung danach im Plan an ihren Platz.
 */
export function fensterLagen(anzahl: number): number[] {
  const out: number[] = [];
  for (let i = 1; i <= anzahl; i += 1) out.push(i / (anzahl + 1));
  return out;
}

// ---------------------------------------------------------------------------
// Annahmen
// ---------------------------------------------------------------------------

/** Eine Annahme aufnehmen oder ersetzen. Reine Funktion — ohne Seiteneffekt. */
export function merkeAnnahme(liste: readonly Annahme[], neu: Annahme): Annahme[] {
  return liste.filter((a) => a.was !== neu.was).concat(neu);
}

/** Eine Annahme wieder entfernen, weil die Frage doch beantwortet wurde. */
export function loescheAnnahme(liste: readonly Annahme[], was: string): Annahme[] {
  return liste.filter((a) => a.was !== was);
}

// ---------------------------------------------------------------------------
// Die Fragenfolge
// ---------------------------------------------------------------------------

/** Die Fragen zum Gebäude — einmal, nicht je Raum. */
export const GEBAEUDE_FRAGEN = ['umfang', 'baualter', 'unten', 'oben', 'hoehe'] as const;

/** Die Fragen je Raum. `anbau` entfällt beim ersten. */
export const RAUM_FRAGEN = ['anbau', 'art', 'groesse', 'fenster', 'heizkoerper'] as const;
export type RaumFrage = (typeof RAUM_FRAGEN)[number];

export function raumFragen(istErster: boolean): readonly RaumFrage[] {
  return istErster ? RAUM_FRAGEN.slice(1) : RAUM_FRAGEN;
}

/**
 * Wie weit die Aufnahme ist [0…1].
 *
 * Gezählt wird gegen eine **geschätzte** Gesamtzahl: fünf Fragen zum Gebäude
 * plus fünf je Raum, mindestens für drei Räume. Ein Balken, der bei jedem
 * weiteren Raum zurückspringt, wäre schlimmer als keiner — deshalb wächst der
 * Nenner mit und der Balken steht still, statt rückwärts zu laufen.
 */
export function fortschritt(getan: number, raeume: number): number {
  const gesamt = GEBAEUDE_FRAGEN.length + Math.max(3, raeume + 1) * RAUM_FRAGEN.length;
  return Math.max(0, Math.min(1, getan / gesamt));
}
