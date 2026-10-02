/**
 * Die Skizzenseite — ein Blatt Papier, kein Grundriss.
 *
 * **Warum es sie gibt.** Seit 1.64.0 gibt es das *Skizzenblatt*: eine Fläche
 * über dem Plan, auf der mit Finger oder Stift gezeichnet wird und aus deren
 * Strichen Wände werden. Es liegt aber **im Plan** — dieselbe Zeichenfläche,
 * dasselbe Koordinatensystem, dasselbe Modell. Gemeldet wurde genau das: „die
 * ist immer noch im hauptsystem, das muss so gehen, skizzirungsseite oder so".
 *
 * Eine Skizze ist aber oft gerade **kein** Grundriss: ein Strangschema von
 * Hand, ein Detail am Anschluss, eine Notiz für den Kollegen, die Lage des
 * Zählerschranks. Dafür braucht es ein leeres Blatt, das nichts mit der
 * Geometrie des Gebäudes zu tun hat — und das trotzdem zum Projekt gehört,
 * gespeichert wird und mit in die Mappe geht.
 *
 * **Deshalb ein eigenes Koordinatensystem.** Die Striche liegen in
 * Blattkoordinaten (Millimeter auf A4 quer, also 0…297 × 0…210), nicht in
 * Metern im Gebäude. Ein Blatt hat keinen Maßstab, und einen zu behaupten wäre
 * die Art Fehler, die man erst im Ausdruck sieht.
 *
 * **Was hier nicht passiert.** Keine Wände, keine Räume, keine Geometrie. Wer
 * einen Grundriss hinzeichnen will, nimmt das Skizzenblatt über dem Plan —
 * dort hat jeder Strich eine Länge in Metern. Beides nebeneinander ist kein
 * Versehen, sondern die Unterscheidung: **hier Papier, dort Modell.**
 */

import type { Vec2 } from '../types/bim';

/** Blattmaße in Millimetern — A4 quer. */
export const BLATT = { breite: 297, hoehe: 210 } as const;

/** Die Stiftstärken, die zur Wahl stehen [mm]. */
export const STRICHSTAERKEN = [0.5, 1, 2, 4] as const;

/**
 * Die Farben, die zur Wahl stehen.
 *
 * Vier, und jede mit einer Bedeutung, die sich auf der Baustelle eingebürgert
 * hat: Schwarz für das Vorhandene, Rot für das, was geändert wird, Blau für
 * Maße und Bemerkungen, Grün für das Neue. Mehr Farben hieße, über Farben
 * nachzudenken statt über die Sache.
 */
export const STIFTFARBEN = [
  { id: 'schwarz', wert: '#E2E8F0', label: 'Bestand' },
  { id: 'rot', wert: '#F87171', label: 'Änderung' },
  { id: 'blau', wert: '#38BDF8', label: 'Maß · Bemerkung' },
  { id: 'gruen', wert: '#34D399', label: 'Neu' },
] as const;

export type StiftfarbeId = (typeof STIFTFARBEN)[number]['id'];

export interface Strich {
  id: string;
  /** Stützpunkte in Blattkoordinaten [mm]. */
  punkte: Vec2[];
  farbe: StiftfarbeId;
  /** Strichstärke [mm]. */
  staerke: number;
}

/**
 * Der Maßstab eines Blattes: eine Strecke darauf und ihre wirkliche Länge.
 *
 * **Warum das die ganze Frage ist.** Ein Blatt hat Millimeter, ein Gebäude hat
 * Meter. Solange niemand gesagt hat, wie viele Meter ein Millimeter Papier
 * sind, lässt sich aus einem Strich keine Wand machen — jede Zahl wäre
 * geraten. Dieselbe Frage stellt das Referenzbild, und sie wird hier genauso
 * beantwortet: Man zieht eine Strecke über etwas, dessen Maß man kennt, und
 * schreibt das Maß dazu.
 */
export interface Massstab {
  /** Die beiden Enden der Messstrecke in Blattkoordinaten [mm]. */
  von: Vec2;
  nach: Vec2;
  /** Die wirkliche Länge dieser Strecke [m]. */
  laenge: number;
}

export interface Skizzenseite {
  id: string;
  name: string;
  striche: Strich[];
  /** Wann angelegt — ISO-Zeitpunkt, für die Reihenfolge und die Mappe. */
  at: string;
  /**
   * Der Maßstab, falls einer angelegt wurde.
   *
   * Ohne ihn ist das Blatt Papier und bleibt es. Mit ihm lässt sich das
   * Gezeichnete in den Grundriss übernehmen — als **Vorschlag**, der dort
   * geprüft wird, nicht als fertige Wand.
   */
  massstab?: Massstab;
}

/**
 * Meter je Millimeter Papier — oder `undefined`, wenn der Maßstab nichts
 * hergibt.
 *
 * **Die kurze Messstrecke ist der Fehler, den man nicht sieht.** Wer 4 mm auf
 * dem Papier mit „3,50 m" beschriftet, legt jeden Zeichenfehler mit dem Faktor
 * 875 auf das Modell um: Zwei Millimeter danebengetippt sind dann anderthalb
 * Meter Wand. Unter `MESSSTRECKE_MIN` wird deshalb nichts zurückgegeben —
 * lieber keine Übernahme als eine, deren Maßstab niemand nachrechnen kann.
 */
export const MESSSTRECKE_MIN = 20;

export function meterJeMm(massstab: Massstab | undefined): number | undefined {
  if (!massstab) return undefined;
  const d = Math.hypot(massstab.nach.x - massstab.von.x, massstab.nach.y - massstab.von.y);
  if (!(d >= MESSSTRECKE_MIN)) return undefined;
  if (!(massstab.laenge > 0)) return undefined;
  return massstab.laenge / d;
}

/**
 * Blattkoordinaten [mm] in Weltkoordinaten [m] umrechnen.
 *
 * **Die y-Achse wird umgeklappt.** Auf dem Blatt zählt y nach unten (so rechnet
 * eine Leinwand), im Modell nach oben (+y ist Norden). Ohne das Umklappen käme
 * der Grundriss gespiegelt an — und eine Spiegelung sieht man an einem
 * freihändigen Umriss erst, wenn das Bad plötzlich an der falschen Hausseite
 * liegt.
 */
export function nachWelt(
  punkte: readonly Vec2[],
  faktor: number,
  ursprung: Vec2 = { x: 0, y: 0 },
): Vec2[] {
  return punkte.map((p) => ({
    x: ursprung.x + p.x * faktor,
    y: ursprung.y + (BLATT.hoehe - p.y) * faktor,
  }));
}

/** Ein leeres Blatt. */
export function neueSeite(id: string, name: string, at: string): Skizzenseite {
  return { id, name, striche: [], at };
}

/**
 * Der nächste Blattname.
 *
 * Fortlaufend über die vorhandenen hinweg: Wer „Blatt 1" bis „Blatt 3" hat und
 * das zweite löscht, bekommt „Blatt 4". Nummern wiederzuverwenden heißt, zwei
 * verschiedene Skizzen im Schriftverkehr gleich zu nennen.
 */
export function naechsterBlattname(vorhanden: readonly Skizzenseite[]): string {
  const zahlen = vorhanden.map((s) => {
    const m = /^Blatt\s+(\d+)$/.exec(s.name.trim());
    return m ? Number(m[1]) : 0;
  });
  return `Blatt ${Math.max(0, ...zahlen) + 1}`;
}

/** Den letzten Strich zurücknehmen — nicht das Blatt leeren. */
export function strichZurueck(seite: Skizzenseite): Skizzenseite {
  return seite.striche.length ? { ...seite, striche: seite.striche.slice(0, -1) } : seite;
}

export function istLeer(seite: Skizzenseite): boolean {
  return seite.striche.length === 0;
}

/**
 * Was auf dem Blatt belegt ist — für den Ausdruck und die Vorschau.
 *
 * `undefined` bei leerem Blatt: Ein Umriss von nichts ist kein Punkt im
 * Ursprung, sondern keiner.
 */
export function umriss(seite: Skizzenseite): { x: number; y: number; breite: number; hoehe: number } | undefined {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const strich of seite.striche) {
    for (const p of strich.punkte) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (!Number.isFinite(minX)) return undefined;
  return { x: minX, y: minY, breite: maxX - minX, hoehe: maxY - minY };
}

/**
 * Stützpunkte ausdünnen — Douglas-Peucker, aber einfach gehalten.
 *
 * **Warum überhaupt.** Ein Zug über das halbe Blatt liefert je nach Gerät
 * mehrere hundert Punkte, und die landen alle in der Projektdatei. Ein Blatt
 * mit dreißig Strichen wäre damit größer als der ganze Grundriss. Geglättet
 * wird **nicht**: Eine Handskizze soll wie eine Handskizze aussehen; was hier
 * wegfällt, sind nur Punkte, die auf der Linie zwischen ihren Nachbarn liegen.
 *
 * Die Schranke ist 0,3 mm auf dem Blatt — unterhalb dessen, was ein Stift
 * trennt, und weit unterhalb dessen, was ein Auge sieht.
 */
export function duenneAus(punkte: readonly Vec2[], schranke = 0.3): Vec2[] {
  if (punkte.length <= 2) return [...punkte];
  const a = punkte[0];
  const b = punkte[punkte.length - 1];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const laenge = Math.hypot(dx, dy);

  let weitester = 0;
  let abstand = -1;
  for (let i = 1; i < punkte.length - 1; i++) {
    const p = punkte[i];
    const d =
      laenge < 1e-9
        ? Math.hypot(p.x - a.x, p.y - a.y)
        : Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / laenge;
    if (d > abstand) {
      abstand = d;
      weitester = i;
    }
  }
  if (abstand <= schranke) return [a, b];
  return [
    ...duenneAus(punkte.slice(0, weitester + 1), schranke),
    ...duenneAus(punkte.slice(weitester), schranke).slice(1),
  ];
}

/** Zahl der Stützpunkte eines Blattes — die Größe, die in der Datei landet. */
export function punktzahl(seite: Skizzenseite): number {
  return seite.striche.reduce((s, x) => s + x.punkte.length, 0);
}
