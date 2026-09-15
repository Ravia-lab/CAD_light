/**
 * Wie ein Bauteil im Anlagenschema benannt wird.
 * ---------------------------------------------------------------------------
 * **Der Befund.** Auf dem Schemablatt der Projektmappe standen die Bauteilnamen
 * waagerecht mittig über dem Symbol — „Monoblock Luft/Wasser R290 8 kW",
 * „Absperrung Erzeuger Vorlauf", „Schlammabscheider mit Magnetit-Abscheidung".
 * Das Referenzhaus ergibt ein Schema von 40 × 31 Rasterschritten; auf A4 quer
 * passt das erst ab M 1:200, und dort ist ein Rasterschritt **5 mm** breit.
 * Ein Name von 31 Zeichen ist bei 2,2 mm Schrift aber rund **41 mm** breit —
 * das Achtfache des Platzes, der ihm zusteht. Gezählt wurden auf dem Blatt
 * **63 Überlappungen** bei 97 Beschriftungen. Es war kein Schönheitsfehler,
 * sondern ein unlesbares Blatt.
 *
 * **Warum nicht einfach ausweichen.** Die Beschriftung eines Bauteils darf
 * nicht wandern, wohin Platz ist: sie muss am Bauteil bleiben, sonst zeigt sie
 * auf das falsche. Bei 41 mm Textbreite und 5 mm Raster gibt es im ganzen
 * Blatt keinen freien Platz, der noch „am Bauteil" wäre. Ausweichen löst das
 * Problem nicht, es verschiebt es.
 *
 * **Was stattdessen.** Dasselbe, was jede Werkstattzeichnung tut, seit es
 * Werkstattzeichnungen gibt: **eine Nummer ans Bauteil, den Namen in die
 * Liste.** Die Nummer ist zweistellig und damit rund 3 mm breit — sie passt
 * auch bei 5 mm Raster. Der Name steht vollständig auf dem Positionsblatt,
 * samt Symbol, Anzahl, technischer Angabe und Anlagenkennzeichen. Wer das
 * Blatt in die Hand nimmt, sieht ein Symbol, liest eine Zahl und schlägt sie
 * nach — das kann ein Junggeselle am ersten Tag, und es braucht keine Lupe.
 *
 * **Die Nummer weicht aus, der Name nicht.** Ein Bauteil steht nie ohne
 * Nummer da: eine Nummer, die weggelassen wird, weil kein Platz war, macht
 * das Bauteil unauffindbar. Gesucht wird deshalb der Reihe nach in acht
 * Richtungen und auf drei Ringen; findet sich nirgends ein freier Platz,
 * wird die am wenigsten belegte Stelle genommen. Steht die Nummer nicht mehr
 * unmittelbar am Symbol, bekommt sie eine **Hinweislinie** — sonst gehört sie
 * optisch zum Nachbarn.
 *
 * **Wann welche Art.** `'auto'` zählt die Überlappungen, die die Namen am
 * Symbol ergäben: keine → Namen bleiben (bei einer kleinen Anlage auf großem
 * Blatt ist der Name unmittelbar am Bauteil die bessere Auskunft), sonst
 * Positionsnummern. Die Entscheidung ist damit eine Messung und keine
 * Voreinstellung, und sie steht als Begründung auf dem Blatt.
 *
 * Dieses Modul rechnet in **Blattmillimetern** und zeichnet nichts. Es kennt
 * weder SVG noch Leinwand, nur Punkte und Kästen — deshalb ist es prüfbar,
 * ohne einen Zeichenkontext zu bauen.
 */

import type { Rechteck } from './beschriftungsLage';
import { rechteckeUeberlappen } from './beschriftungsLage';

export type { Rechteck };

/** Wie die Bauteile auf dem Blatt benannt werden. */
export type SchemaBeschriftungsart = 'name' | 'position' | 'auto';

/** Ein Bauteil, so wie die Platzierung es braucht. */
export interface Beschriftungsbauteil {
  id: string;
  /** Mittelpunkt des Symbols [mm]. */
  x: number;
  y: number;
  /** Belegung des Symbols [mm] — Breite und Höhe, nicht die halbe. */
  breite: number;
  hoehe: number;
  /** Positionsnummer aus der Stückliste. */
  position: number;
}

export interface Positionsoptionen {
  /** Schriftgröße der Nummer [mm]. */
  schrift: number;
  /** Abstand zwischen Symbolrand und Nummernkreis [mm]. */
  luft?: number;
  /**
   * Das Zeichenfeld [mm]. Eine Nummer, die darüber hinausragt, wird vom
   * Blattrand abgeschnitten — und eine halbe Ziffer ist schlimmer als keine,
   * weil aus der 8 eine 3 werden kann. Kandidaten außerhalb gelten deshalb
   * als belegt. Ohne Angabe wird nicht begrenzt.
   */
  feld?: Rechteck;
  /**
   * Die Leitungszüge [mm], als Punktfolgen.
   *
   * **Warum die Nummer der Leitung ausweicht.** Ein weiß gefüllter Kreis
   * mitten auf einem Strich sieht aus wie ein Bauteil — ein Prüfer hat den
   * Nummernkreis auf der Vorlaufleitung für eine Pumpe gehalten, und er hatte
   * recht: genau so wird eine Pumpe gezeichnet. Die Leitung ist deshalb kein
   * verbotener, aber ein teurer Platz: gequert wird sie nur, wenn daneben
   * nichts frei ist.
   */
  leitungen?: readonly (readonly { x: number; y: number }[])[];
}

/** Eine gesetzte Positionsnummer. */
export interface Positionslage {
  bauteilId: string;
  position: number;
  /** Mittelpunkt des Nummernkreises [mm]. */
  x: number;
  y: number;
  /** Halbmesser des Nummernkreises [mm]. */
  r: number;
  /**
   * Hinweislinie zum Bauteil. Nur gesetzt, wenn die Nummer ausweichen musste
   * und ohne Linie dem Nachbarn zugeschlagen würde.
   */
  linie?: { x1: number; y1: number; x2: number; y2: number };
  /** Das belegte Hüllrechteck — die nächste Nummer weicht ihm aus. */
  belegt: Rechteck;
  /** Rang des greifenden Kandidaten; 0 ist die erste Wahl. */
  rang: number;
  /** Kein Kandidat war frei; genommen wurde der mit der geringsten Überdeckung. */
  gedraengt: boolean;
}

export interface Positionsergebnis {
  lagen: Positionslage[];
  /** Wie viele Nummern gedrängt gesetzt werden mussten. */
  gedraengt: number;
  /** Wie viele Nummern eine Hinweislinie tragen. */
  mitLinie: number;
}

// ---------------------------------------------------------------------------
// Kästen und Kollisionen
// ---------------------------------------------------------------------------

/**
 * Wie viele Paare der übergebenen Kästen sich überlappen.
 *
 * Die Zahl ist das Maß, an dem dieses Modul gemessen wird: auf einem lesbaren
 * Blatt ist sie null. Gezählt werden Paare, nicht Kästen — zwei Namen, die
 * einander überdecken, sind ein Fehler, nicht zwei.
 */
export function zaehleUeberlappungen(kaesten: readonly Rechteck[]): number {
  let n = 0;
  for (let i = 0; i < kaesten.length; i++) {
    for (let j = i + 1; j < kaesten.length; j++) {
      if (rechteckeUeberlappen(kaesten[i], kaesten[j])) n += 1;
    }
  }
  return n;
}

/** Der kürzeste Abstand eines Punktes zu einer Strecke. */
function abstandZurStrecke(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Liegt eine Leitung im Nummernkreis? */
function aufLeitung(
  x: number,
  y: number,
  r: number,
  leitungen: readonly (readonly { x: number; y: number }[])[],
): boolean {
  for (const zug of leitungen) {
    for (let i = 1; i < zug.length; i++) {
      if (abstandZurStrecke(x, y, zug[i - 1].x, zug[i - 1].y, zug[i].x, zug[i].y) < r) return true;
    }
  }
  return false;
}

/** Die Fläche, um die ein Kasten aus dem Feld herausragt [mm²]. */
function ausserhalb(kasten: Rechteck, feld: Rechteck): number {
  const drin =
    Math.max(0, Math.min(kasten.x1, feld.x1) - Math.max(kasten.x0, feld.x0)) *
    Math.max(0, Math.min(kasten.y1, feld.y1) - Math.max(kasten.y0, feld.y0));
  return (kasten.x1 - kasten.x0) * (kasten.y1 - kasten.y0) - drin;
}

/** Die Fläche, um die sich zwei Kästen überdecken [mm²]. */
function ueberdeckung(a: Rechteck, b: Rechteck): number {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * Die Kästen, die die Namen am Symbol belegen würden.
 *
 * Gerechnet wird mit derselben Regel, nach der `schematicPrint` die Namen
 * setzt: Name mittig über dem Symbol, technische Angabe mittig darunter. Das
 * ist die Grundlage der `'auto'`-Entscheidung — gemessen wird, was wirklich
 * gezeichnet würde, nicht eine Näherung davon.
 */
export function namensKaesten(
  bauteile: readonly (Beschriftungsbauteil & { name: string; angabe: string })[],
  schrift: number,
  breiteJeZeichen = 0.6,
): Rechteck[] {
  const kaesten: Rechteck[] = [];
  const abstand = Math.max(0.8, schrift * 0.35);
  for (const b of bauteile) {
    const halb = b.hoehe / 2;
    for (const [text, oben] of [
      [b.name, true],
      [b.angabe, false],
    ] as [string, boolean][]) {
      if (!text) continue;
      const w = text.length * schrift * breiteJeZeichen;
      const yMitte = oben ? b.y - halb - abstand - schrift / 2 : b.y + halb + abstand + schrift / 2;
      kaesten.push({ x0: b.x - w / 2, x1: b.x + w / 2, y0: yMitte - schrift / 2, y1: yMitte + schrift / 2 });
    }
  }
  return kaesten;
}

// ---------------------------------------------------------------------------
// Positionsnummern setzen
// ---------------------------------------------------------------------------

/**
 * Die Richtungen, in denen ein Platz gesucht wird — und ihre Rangfolge.
 *
 * Oben rechts zuerst, weil das Fließbild von links nach rechts und von oben
 * nach unten gelesen wird: dort steht die Nummer vor dem Bauteil im Lesefluss
 * und nicht dahinter. Danach die übrigen Diagonalen (an einer Ecke ist mehr
 * Luft als an einer Kante, weil die Leitungen orthogonal an den Stutzen
 * ankommen), dann die vier Kanten.
 */
const RICHTUNGEN: readonly (readonly [number, number])[] = [
  [1, -1],
  [-1, -1],
  [1, 1],
  [-1, 1],
  [1, 0],
  [-1, 0],
  [0, -1],
  [0, 1],
];

/**
 * Die Ringe, auf denen gesucht wird — als Vielfaches des Grundabstands.
 *
 * Ab dem zweiten Ring bekommt die Nummer eine Hinweislinie: sie steht dann
 * weiter vom Symbol entfernt als vom nächsten Nachbarn, und ohne Linie wäre
 * die Zuordnung geraten.
 */
const RINGE = [1, 1.75, 2.6] as const;

/**
 * Positionsnummern für alle Bauteile setzen.
 *
 * `belegtVorher` sind Flächen, die schon vergeben sind — in der Regel die
 * Symbole selbst. Leitungen gehören **nicht** dazu: der Nummernkreis ist weiß
 * hinterlegt und darf eine Leitung queren, so wie jede Bemaßung das darf.
 * Eine Nummer auf einem Symbol dagegen macht beide unlesbar.
 */
export function setzePositionen(
  bauteile: readonly Beschriftungsbauteil[],
  belegtVorher: readonly Rechteck[],
  optionen: Positionsoptionen,
): Positionsergebnis {
  const luft = optionen.luft ?? Math.max(0.3, optionen.schrift * 0.25);
  const lagen: Positionslage[] = [];
  const belegt: Rechteck[] = [...belegtVorher];
  let gedraengt = 0;
  let mitLinie = 0;

  // Die größte vorkommende Nummer bestimmt den Halbmesser — sonst sind
  // einstellige und zweistellige Kreise verschieden groß und das Blatt wirkt
  // unruhig. Ein gleich großer Kreis ist außerdem leichter zu finden.
  const stellen = Math.max(1, ...bauteile.map((b) => String(b.position).length));
  const r = Math.max(optionen.schrift * 0.62, (stellen * optionen.schrift * 0.6) / 2 + optionen.schrift * 0.2);

  // Große Bauteile zuerst: sie haben die wenigsten freien Richtungen, weil
  // ihr eigenes Symbol schon viel Fläche belegt. Wer zuletzt sucht, sucht im
  // vollsten Blatt — deshalb bekommt der Engste den ersten Griff.
  const reihenfolge = [...bauteile].sort((a, b) => b.breite * b.hoehe - a.breite * a.hoehe);

  for (const teil of reihenfolge) {
    const grund = Math.hypot(teil.breite, teil.hoehe) / 2 + r + luft;
    let beste: { x: number; y: number; kasten: Rechteck; rang: number; last: number } | null = null;
    let rang = 0;

    suche: for (const ring of RINGE) {
      for (const [rx, ry] of RICHTUNGEN) {
        const norm = Math.hypot(rx, ry) || 1;
        const d = grund * ring;
        const x = teil.x + (rx / norm) * d;
        const y = teil.y + (ry / norm) * d;
        const kasten = { x0: x - r, x1: x + r, y0: y - r, y1: y + r };
        let last = 0;
        for (const f of belegt) last += ueberdeckung(kasten, f);
        // Was über das Zeichenfeld hinausragt, zählt wie belegte Fläche —
        // aber schwerer, damit ein Platz im Feld auch dann gewinnt, wenn er
        // ein wenig gedrängt ist. Abgeschnitten ist unbrauchbar, gedrängt nur
        // eng.
        if (optionen.feld) last += ausserhalb(kasten, optionen.feld) * 4;
        // Die Leitung ist kein Hindernis, sondern ein Aufschlag: sie kostet
        // etwa ein Viertel der Kreisfläche. Ein wirklich belegter Platz
        // (Symbol, Leitungsbeschriftung) wiegt damit schwerer, ein freier
        // Platz neben der Leitung gewinnt aber immer gegen einen darauf.
        if (optionen.leitungen && aufLeitung(x, y, r, optionen.leitungen)) last += r * r;
        if (last === 0) {
          beste = { x, y, kasten, rang, last };
          break suche;
        }
        if (!beste || last < beste.last) beste = { x, y, kasten, rang, last };
        rang += 1;
      }
    }

    // `beste` ist nie null: RICHTUNGEN und RINGE sind beide nicht leer.
    const gewaehlt = beste!;
    // **Wann eine Hinweislinie gebraucht wird.** Nicht erst, wenn die Nummer
    // weit weg steht, sondern schon, wenn ein *anderes* Bauteil ihr näher ist
    // als ihr eigenes. Ein Prüfer hat auf dem ersten Blatt gefragt, ob „16"
    // die Absperrung links oder die Pumpe rechts meint — bei 5 mm Raster
    // stehen die Nachbarn eben dicht. Die Linie beantwortet die Frage, und
    // sie kostet 0,15 mm Strich.
    const eigen = Math.hypot(gewaehlt.x - teil.x, gewaehlt.y - teil.y);
    let naechsterFremder = Infinity;
    for (const anderer of bauteile) {
      if (anderer.id === teil.id) continue;
      const d = Math.hypot(gewaehlt.x - anderer.x, gewaehlt.y - anderer.y);
      if (d < naechsterFremder) naechsterFremder = d;
    }
    const weit = eigen > grund * 1.2 || naechsterFremder <= eigen;
    const lage: Positionslage = {
      bauteilId: teil.id,
      position: teil.position,
      x: gewaehlt.x,
      y: gewaehlt.y,
      r,
      belegt: gewaehlt.kasten,
      rang: gewaehlt.rang,
      gedraengt: gewaehlt.last > 0,
    };
    if (weit) {
      // Die Linie läuft vom Symbolrand bis an den Kreisrand, nicht durch
      // beide hindurch — sonst steht sie im Symbol und in der Zahl.
      const dx = gewaehlt.x - teil.x;
      const dy = gewaehlt.y - teil.y;
      const l = Math.hypot(dx, dy) || 1;
      const abSymbol = Math.hypot(teil.breite, teil.hoehe) / 2;
      lage.linie = {
        x1: teil.x + (dx / l) * abSymbol,
        y1: teil.y + (dy / l) * abSymbol,
        x2: gewaehlt.x - (dx / l) * r,
        y2: gewaehlt.y - (dy / l) * r,
      };
      mitLinie += 1;
    }
    if (lage.gedraengt) gedraengt += 1;
    lagen.push(lage);
    belegt.push(gewaehlt.kasten);
  }

  // Zurück in die Reihenfolge der Eingabe: der Aufrufer zeichnet in der
  // Reihenfolge seiner Bauteilliste, und eine umsortierte Antwort wäre eine
  // stille Falle.
  const nachId = new Map(lagen.map((l) => [l.bauteilId, l]));
  return {
    lagen: bauteile.map((b) => nachId.get(b.id)!).filter(Boolean),
    gedraengt,
    mitLinie,
  };
}

/**
 * Welche Beschriftungsart das Blatt trägt.
 *
 * Bei `'auto'` entscheidet die Messung: solange die Namen am Symbol einander
 * nicht überdecken, sind sie die bessere Auskunft — man liest, was man sieht,
 * ohne nachzuschlagen. Sobald sich auch nur zwei überdecken, ist das Blatt an
 * dieser Stelle falsch, und Positionsnummern sind die einzige Darstellung, die
 * bei 5 mm Raster noch trägt.
 */
export function entscheideArt(
  gewuenscht: SchemaBeschriftungsart,
  namenskollisionen: number,
): { art: 'name' | 'position'; begruendung: string } {
  if (gewuenscht === 'name') {
    return {
      art: 'name',
      begruendung:
        namenskollisionen > 0
          ? `Die Namen stehen am Symbol, wie vorgegeben — ${namenskollisionen} von ihnen überdecken einander.`
          : 'Die Namen stehen am Symbol.',
    };
  }
  if (gewuenscht === 'position') {
    return { art: 'position', begruendung: 'Die Bauteile tragen Positionsnummern; die Namen stehen im Positionsblatt.' };
  }
  if (namenskollisionen === 0) {
    return { art: 'name', begruendung: 'Die Namen passen ohne Überdeckung an die Symbole.' };
  }
  return {
    art: 'position',
    begruendung:
      `Die Bauteilnamen würden einander an ${namenskollisionen} Stellen überdecken. ` +
      'Auf dem Blatt stehen deshalb Positionsnummern, die Namen im Positionsblatt.',
  };
}

// ---------------------------------------------------------------------------
// Leitungsbeschriftung
// ---------------------------------------------------------------------------

/**
 * Wo die Beschriftung einer Leitung hinkommt — „15 × 1", „Beimischung".
 *
 * **Warum nicht einfach auf die Mitte.** Genau das tat der Zeichner: längste
 * Teilstrecke suchen, Text auf deren Mittelpunkt, 1,4 mm nach oben. Solange
 * das Blatt voller Bauteilnamen war, fiel nicht auf, dass der Mittelpunkt
 * einer Teilstrecke oft genau dort liegt, wo auch ein Bauteil sitzt — ein
 * Fließbild reiht Armaturen entlang der Leitung auf, und die Mitte zwischen
 * zwei Armaturen ist die nächste Armatur. Auf dem aufgeräumten Blatt stand
 * „15 × 1" dann mitten im Absperrventil.
 *
 * **Was hier stattdessen geschieht.** Dieselbe Regel wie bei der Nennweite im
 * Grundriss (`beschriftungsLage.ts`): eine Rangfolge von Kandidaten, und
 * genommen wird der erste, der frei ist. Gesucht wird auf der längsten
 * Teilstrecke zuerst, dort in der Mitte und an den Viertelpunkten, und je
 * Punkt auf beiden Seiten der Leitung. Der Text bleibt dabei **waagerecht** —
 * ein Schema ist keine Landkarte, und gedrehte Schrift liest sich auf einem
 * Blatt, das im Heizungskeller gehalten wird, schlechter als versetzte.
 *
 * Findet sich nichts, kommt `null` zurück und der Aufrufer entscheidet. Die
 * Angabe ist im Schema eine Lesehilfe; vollständig steht sie in der
 * Rohrnetzberechnung.
 */
export function setzeLeitungsbeschriftung(
  route: readonly { x: number; y: number }[],
  breite: number,
  hoehe: number,
  belegt: readonly Rechteck[],
): { x: number; y: number } | null {
  if (route.length < 2) return null;

  const abschnitte: { a: { x: number; y: number }; b: { x: number; y: number }; laenge: number }[] = [];
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1];
    const b = route[i];
    const laenge = Math.hypot(b.x - a.x, b.y - a.y);
    if (laenge < 2) continue;
    abschnitte.push({ a, b, laenge });
  }
  abschnitte.sort((x, y) => y.laenge - x.laenge);

  for (const abschnitt of abschnitte) {
    const dx = (abschnitt.b.x - abschnitt.a.x) / abschnitt.laenge;
    const dy = (abschnitt.b.y - abschnitt.a.y) / abschnitt.laenge;
    const senkrecht = Math.abs(dy) > Math.abs(dx);
    // Quer zur Leitung ausrücken: bei einer senkrechten Leitung um die halbe
    // Textbreite, bei einer waagerechten um die halbe Texthöhe — der Text
    // bleibt in beiden Fällen waagerecht, er weicht nur zur Seite.
    const quer = senkrecht ? breite / 2 + 0.8 : hoehe / 2 + 0.8;
    // Mitte zuerst — dort ist die Beschriftung dem Abschnitt am ehesten
    // zuzuordnen —, dann die Viertel, dann näher an die Enden. Die beiden
    // äußeren Anteile sind kein Beiwerk: eine lange Leitung, auf der in der
    // Mitte eine Armatur sitzt, hat sonst überhaupt keinen freien Platz,
    // obwohl links und rechts davon meterweise nichts steht.
    for (const anteil of [0.5, 0.25, 0.75, 0.12, 0.88]) {
      const mx = abschnitt.a.x + (abschnitt.b.x - abschnitt.a.x) * anteil;
      const my = abschnitt.a.y + (abschnitt.b.y - abschnitt.a.y) * anteil;
      for (const seite of [-1, 1]) {
        const x = senkrecht ? mx + seite * quer : mx;
        const y = senkrecht ? my : my + seite * quer;
        const kasten = { x0: x - breite / 2, x1: x + breite / 2, y0: y - hoehe / 2, y1: y + hoehe / 2 };
        if (!belegt.some((r) => rechteckeUeberlappen(kasten, r))) return { x, y };
      }
    }
  }
  return null;
}
