/**
 * Wohin eine Beschriftung an einer Trasse gesetzt wird.
 * ---------------------------------------------------------------------------
 * **Warum es diese Datei gibt.** Eine Rohrbeschriftung („DN 12") wurde an zwei
 * Stellen gesetzt — auf dem Bildschirm in `verticalSymbols` und auf dem
 * Druckblatt in `planPrint` —, und beide Stellen taten dasselbe: sie schrieben
 * den Text starr auf die Mitte des Abschnitts, ohne zu prüfen, was dort schon
 * steht. Im Demomodell landete „DN 12" dadurch auf dem Raumstempel
 * „Schlafen / 14,77 m²"; beides war unlesbar. Zwei Kopien derselben Geometrie,
 * die auseinanderlaufen, sind der teuerste wiederkehrende Fehler dieses
 * Projekts — die Regel steht deshalb genau einmal hier, und beide Zeichenwege
 * rufen sie auf.
 *
 * **Was die Regel tut.** Sie erzeugt aus einer Trasse eine geordnete Liste von
 * Platzierungskandidaten und liefert den ersten, dessen Hüllrechteck mit
 * keinem der übergebenen belegten Rechtecke überlappt. Sie rechnet in den
 * Koordinaten, in denen auch gezeichnet wird — Bildschirmpixel beim Editor,
 * Blattmillimeter beim Ausdruck. Sie kennt weder Räume noch Rohre, sondern nur
 * Punkte, Kästen und Winkel; das macht sie prüfbar, ohne einen Zeichenkontext
 * zu bauen.
 *
 * **Findet sich kein Platz, wird nicht gezeichnet.** Der Aufrufer bekommt
 * `null` und lässt die Beschriftung weg. Das ist eine bewusste Entscheidung
 * und keine Nebenwirkung: eine fehlende Nennweite ist ein Loch, das man sieht
 * und im Bericht nachschlägt — zwei Beschriftungen übereinander sind ein
 * Fleck, den man für gedruckte Wahrheit hält. Die Nennweite steht ohnehin
 * vollständig in der Rohrnetzberechnung und in der Legende; im Plan ist sie
 * eine Lesehilfe, kein alleiniger Nachweis.
 */

/** Ein Punkt in Zeichenkoordinaten (Bildschirmpixel bzw. Blattmillimeter). */
export interface Beschriftungspunkt {
  x: number;
  y: number;
}

/**
 * Ein achsenparalleles Rechteck in Zeichenkoordinaten.
 *
 * Achsenparallel ist Absicht: die Prüfung soll billig und offensichtlich
 * richtig sein. Für gedrehte Beschriftungen wird die Hülle genommen — sie ist
 * größer als der Schriftzug und drängt die Beschriftung im Zweifel eher
 * beiseite, als sie zu dicht zu setzen. Ein zu vorsichtiger Abstand kostet
 * nichts, eine zu knappe Prüfung kostet die Lesbarkeit.
 */
export interface Rechteck {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Die Ausdehnung des Schriftzugs, gemessen im gedrehten System der Linie.
 *
 * `oben`/`unten` sind Abstände **quer** zur Linie; negativ heißt „über der
 * Linie", so wie es beide Zeichenwege ohnehin rechnen (die y-Achse zeigt bei
 * Leinwand und SVG nach unten). Damit lässt sich der Kasten aus dem
 * bestehenden Zeichencode unverändert übernehmen, statt ihn ein zweites Mal
 * herzuleiten.
 */
export interface Beschriftungsmass {
  /** Breite des Kastens samt seitlichem Rand. */
  breite: number;
  /** Oberkante des Kastens quer zur Linie (negativ = über der Linie). */
  oben: number;
  /** Unterkante des Kastens quer zur Linie. */
  unten: number;
}

/** Das Ergebnis der Platzierung. */
export interface Beschriftungslage {
  /** Ankerpunkt auf der Linie — dorthin gehört der Ursprung der Drehung. */
  x: number;
  y: number;
  /** Drehwinkel [rad], bereits so gedreht, dass der Text lesbar steht. */
  winkel: number;
  /**
   * Das belegte Hüllrechteck. Der Aufrufer reicht es der nächsten
   * Beschriftung weiter — nur so weichen zwei Beschriftungen einander aus.
   */
  belegt: Rechteck;
  /** Rang des greifenden Kandidaten; 0 ist die erste Wahl. */
  rang: number;
}

export interface Beschriftungsoptionen {
  /**
   * Kürzeste Länge, die ein Abschnitt haben muss, um die Beschriftung zu
   * tragen. Ohne Angabe genügt die Breite des Schriftzugs.
   */
  mindestlaenge?: number;
}

/**
 * Die Anteile entlang eines Abschnitts, in der Reihenfolge, in der sie
 * probiert werden.
 *
 * **Warum die Viertelpunkte vor der Mitte kommen.** Der Mittelpunkt eines
 * Abschnitts ist im Grundriss der am dichtesten belegte Ort, und das ist kein
 * Zufall: eine Anbindeleitung quert den Raum von der Trasse zum Heizkörper an
 * der Außenwand. Ihr Mittelpunkt liegt damit ungefähr in der Raummitte — genau
 * dort, wo der Raumstempel sitzt, denn der steht auf dem Flächenschwerpunkt.
 * Zwei Setzungen, die aus derselben Geometrie folgen, treffen sich zwangsläufig.
 * Genau das hat der Bildprüfstand gefunden: „DN 12" auf „14,77 m²".
 *
 * Die Reihenfolge ist eine Rangfolge, keine feste Setzung: **welcher Kandidat
 * greift, entscheidet weiterhin die Kollisionsprüfung.** Wo der Aufrufer die
 * belegten Flächen kennt (Druckblatt: Raumstempel und die schon gesetzten
 * Beschriftungen), rückt die Beschriftung notfalls bis in die Mitte oder auf
 * einen anderen Abschnitt. Wo er sie nicht vollständig kennt (Bildschirm: der
 * Zeichenpfad ruft je Leitung einmal und reicht den Raumstempel nicht durch),
 * trägt die Rangfolge — sie ist dann die begründete Vorsichtsmaßnahme und
 * nicht mehr die Prüfung selbst.
 */
const ANTEILE = [0.25, 0.75, 0.5] as const;

/** Überlappen sich zwei achsenparallele Rechtecke? Berührung zählt nicht. */
export function rechteckeUeberlappen(a: Rechteck, b: Rechteck): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

/**
 * Das Hüllrechteck eines um `winkel` gedrehten Schriftkastens am Punkt (x, y).
 *
 * Der Kasten wird in seinem eigenen System aufgespannt, gedreht und dann in
 * eine achsenparallele Hülle gefasst. Bei waagerechten und senkrechten
 * Leitungen — und das sind im Grundriss fast alle — ist die Hülle der Kasten
 * selbst; schräg liegt sie außen herum.
 */
export function beschriftungsHuelle(
  x: number,
  y: number,
  winkel: number,
  mass: Beschriftungsmass,
): Rechteck {
  const cos = Math.cos(winkel);
  const sin = Math.sin(winkel);
  const hb = mass.breite / 2;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [lx, ly] of [
    [-hb, mass.oben],
    [hb, mass.oben],
    [hb, mass.unten],
    [-hb, mass.unten],
  ] as const) {
    const px = x + lx * cos - ly * sin;
    const py = y + lx * sin + ly * cos;
    if (px < x0) x0 = px;
    if (px > x1) x1 = px;
    if (py < y0) y0 = py;
    if (py > y1) y1 = py;
  }
  return { x0, y0, x1, y1 };
}

/**
 * Die Beschriftung einer Trasse platzieren.
 *
 * `punkte` sind die Stützpunkte in Zeichenkoordinaten — bereits projiziert,
 * nicht in Metern. Geliefert wird der erste freie Kandidat oder `null`, wenn
 * die Trasse zu kurz ist oder jeder Kandidat auf etwas Belegtem läge.
 */
export function findeBeschriftungslage(
  punkte: readonly Beschriftungspunkt[],
  mass: Beschriftungsmass,
  belegt: readonly Rechteck[],
  optionen: Beschriftungsoptionen = {},
): Beschriftungslage | null {
  if (punkte.length < 2) return null;
  // Ein Abschnitt, der kürzer ist als der Schriftzug, kann ihn nicht tragen:
  // die Beschriftung stünde über beide Enden hinaus und zeigte auf nichts.
  const mindestlaenge = Math.max(optionen.mindestlaenge ?? 0, mass.breite);

  const abschnitte: { a: Beschriftungspunkt; b: Beschriftungspunkt; laenge: number }[] = [];
  for (let i = 1; i < punkte.length; i++) {
    const a = punkte[i - 1];
    const b = punkte[i];
    const laenge = Math.hypot(b.x - a.x, b.y - a.y);
    if (laenge < mindestlaenge) continue;
    abschnitte.push({ a, b, laenge });
  }
  // Längster zuerst: dort steht die Beschriftung am freiesten, und dort ist
  // sie am ehesten dem Abschnitt zuzuordnen, den sie meint.
  abschnitte.sort((x, y) => y.laenge - x.laenge);

  let rang = 0;
  for (const abschnitt of abschnitte) {
    // Lesbar drehen: Text steht nie auf dem Kopf, die Trasse behält aber ihre
    // Richtung. Der Winkel gilt für den ganzen Abschnitt, nicht je Kandidat.
    let winkel = Math.atan2(abschnitt.b.y - abschnitt.a.y, abschnitt.b.x - abschnitt.a.x);
    if (winkel > Math.PI / 2 || winkel < -Math.PI / 2) winkel += Math.PI;

    for (const anteil of ANTEILE) {
      const x = abschnitt.a.x + (abschnitt.b.x - abschnitt.a.x) * anteil;
      const y = abschnitt.a.y + (abschnitt.b.y - abschnitt.a.y) * anteil;
      const huelle = beschriftungsHuelle(x, y, winkel, mass);
      if (!belegt.some((r) => rechteckeUeberlappen(huelle, r))) {
        return { x, y, winkel, belegt: huelle, rang };
      }
      rang += 1;
    }
  }
  return null;
}
