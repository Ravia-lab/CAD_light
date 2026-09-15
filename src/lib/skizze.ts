/**
 * Aus einem Freihandstrich werden Wände.
 * ---------------------------------------------------------------------------
 * **Der Anlass.** Auf dem Tablet liegt der Stift schon in der Hand. Wer vor
 * Ort in einer Wohnung steht, zeichnet den Grundriss in dreißig Sekunden
 * krakelig hin — und braucht danach zehn Minuten, um dieselben Linien noch
 * einmal Punkt für Punkt zu setzen. Genau diese zehn Minuten nimmt dieses
 * Modul weg.
 *
 * **Was es tut, in fünf Schritten.** Aus einer Punktfolge, wie sie unter dem
 * Stift entsteht, wird eine Folge gerader Strecken:
 *
 *  1. **Glätten.** Eine Hand zittert, und ein Tablet tastet 120-mal in der
 *     Sekunde ab. Der rohe Strich hat deshalb hunderte Punkte, von denen die
 *     meisten Rauschen sind.
 *  2. **Vereinfachen** (Ramer–Douglas–Peucker). Übrig bleiben die Punkte, an
 *     denen der Strich wirklich die Richtung wechselt — die Ecken.
 *  3. **Kurzes schlucken.** Ein 8 cm langes Stück zwischen zwei Ecken ist
 *     keine Wand, sondern eine unsaubere Ecke.
 *  4. **Ausrichten.** Die Vorzugsrichtung der Skizze wird bestimmt und jede
 *     Strecke, die nah genug dran liegt, darauf gezogen. Was deutlich schräg
 *     gemeint war, bleibt schräg — ein Erker ist kein Zeichenfehler.
 *  5. **Ecken schließen.** Nach dem Ausrichten treffen sich die Strecken
 *     nicht mehr; ihre Verlängerungen aber schon. Die Ecke wandert auf den
 *     Schnittpunkt.
 *
 * **Was es ausdrücklich nicht tut: ins Modell schreiben.** Das Ergebnis ist
 * ein **Vorschlag**. Dieselbe Regel gilt seit 1.0 für die Bilderkennung, und
 * sie gilt hier aus demselben Grund: eine Erkennung, die ungefragt Geometrie
 * anlegt, ist beim ersten Fehlgriff nicht mehr zu bändigen. Erst
 * „Übernehmen" macht Wände daraus, und dieser eine Schritt ist ein Schritt
 * in der Rückgängig-Kette.
 *
 * Dieses Modul rechnet in **Metern** und kennt weder Leinwand noch Speicher.
 */

import type { Vec2 } from '../types/bim';
import { distanceToSegment, lineIntersection, vorzugsrichtung } from './geometry';

// ---------------------------------------------------------------------------
// Stellschrauben
// ---------------------------------------------------------------------------

/**
 * Wie stark geglättet wird — Fensterbreite des gleitenden Mittels [Punkte].
 *
 * Drei Punkte nehmen das Zittern heraus, ohne eine Ecke zu verschleifen.
 * Fünf und mehr runden echte Ecken sichtbar ab, und die Ecke ist gerade das,
 * was gesucht wird.
 */
const GLAETTUNG = 3;

/**
 * Wie weit ein Punkt von der Geraden abweichen darf, um weggelassen zu
 * werden [m].
 *
 * 6 cm ist die Größenordnung, in der eine freihändig gezogene Linie
 * schwankt, wenn sie „gerade" gemeint ist — und deutlich weniger als der
 * kleinste Wandversatz, den jemand absichtlich zeichnet.
 */
const VEREINFACHUNG = 0.06;

/** Kürzeste Strecke, die als eigene Wand durchgeht [m]. */
const MIN_STRECKE = 0.35;

/**
 * Bis zu welcher Länge ein **schräges** Stück zwischen zwei ausgerichteten
 * Wänden als Ecke gilt und nicht als Wand [m].
 *
 * Größer als `MIN_STRECKE`, und das aus einem Grund, der sich nachrechnen
 * lässt: Eine abgeschrägte Ecke von 50 cm nimmt einem Raum 0,06 m² Fläche —
 * weniger, als die Heizlast, der Massenauszug oder der Plan im Maßstab 1:50
 * auflösen. Unterhalb dieser Länge ist die Unterscheidung „Schräge oder
 * Zeichenfehler" gegenstandslos; oberhalb wird sie sichtbar und die Schräge
 * bleibt stehen. Die am Stift gemessenen Eckstücke lagen bei 28 bis 47 cm.
 */
const ECKSTUECK = 0.5;

/**
 * Bis zu welcher Abweichung eine Strecke auf die Vorzugsrichtung gezogen
 * wird [°].
 *
 * 18° ist mit Bedacht gewählt: Wer freihändig eine gerade Wand zieht, trifft
 * die Richtung auf wenige Grad. Wer eine Schräge meint — Erker, Dachschräge,
 * abgeschnittene Ecke —, zeichnet sie deutlich schräger als 18°, sonst wäre
 * sie auch in der Wirklichkeit keine. Über der Grenze bleibt die Strecke, wie
 * sie gezeichnet wurde.
 */
const AUSRICHT_TOLERANZ = 18;

/**
 * Wie nah Anfang und Ende liegen müssen, damit der Zug als Ring gilt [m].
 *
 * Großzügig, weil das Ende eines freihändigen Umrisses selten den Anfang
 * trifft — und weil ein offener Ring keinen Raum ergibt und damit den
 * halben Zweck verfehlt.
 */
const RING_TOLERANZ = 0.6;

// ---------------------------------------------------------------------------
// Ergebnis
// ---------------------------------------------------------------------------

/** Eine erkannte Strecke — der Vorschlag für eine Wand. */
export interface Skizzenstrecke {
  a: Vec2;
  b: Vec2;
  /** Länge [m]. */
  laenge: number;
  /** Auf die Vorzugsrichtung gezogen — oder bewusst schräg gelassen. */
  ausgerichtet: boolean;
}

export interface Skizzenergebnis {
  strecken: Skizzenstrecke[];
  /** Ist der Zug ein geschlossener Ring? Dann entsteht ein Raum. */
  ring: boolean;
  /** Um wie viel der Strich gedreht lag [°], zur Anzeige. */
  drehungGrad: number;
  /** Punkte im rohen Strich, Punkte nach dem Vereinfachen. */
  punkteRoh: number;
  punkteEinfach: number;
  /** Was der Anwender wissen sollte, im Klartext. */
  hinweise: string[];
}

export const SKIZZE_LEER: Skizzenergebnis = {
  strecken: [],
  ring: false,
  drehungGrad: 0,
  punkteRoh: 0,
  punkteEinfach: 0,
  hinweise: [],
};

// ---------------------------------------------------------------------------
// Die einzelnen Schritte — jeder für sich prüfbar
// ---------------------------------------------------------------------------

/**
 * Gleitendes Mittel über die Punktfolge.
 *
 * Anfang und Ende bleiben unangetastet: Sie sind die Stellen, an denen der
 * Anwender abgesetzt hat, und die soll niemand verschieben. Ein geglätteter
 * Anfangspunkt wandert in den Strich hinein, und der Ring geht nicht mehr zu.
 */
export function glaette(punkte: readonly Vec2[], fenster = GLAETTUNG): Vec2[] {
  if (punkte.length < 3 || fenster < 2) return [...punkte];
  const halb = Math.floor(fenster / 2);
  const raus: Vec2[] = [punkte[0]];
  for (let i = 1; i < punkte.length - 1; i++) {
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (let j = Math.max(0, i - halb); j <= Math.min(punkte.length - 1, i + halb); j++) {
      sx += punkte[j].x;
      sy += punkte[j].y;
      n += 1;
    }
    raus.push({ x: sx / n, y: sy / n });
  }
  raus.push(punkte[punkte.length - 1]);
  return raus;
}

/**
 * Ramer–Douglas–Peucker: die Punktfolge auf ihre Ecken eindampfen.
 *
 * Rekursiv formuliert wie im Lehrbuch, aber mit eigener Stapelverwaltung —
 * ein Strich mit zehntausend Punkten (langsam gezogen auf einem Gerät mit
 * 120 Hz) würde die Aufrufkette sonst sprengen.
 */
export function vereinfache(punkte: readonly Vec2[], toleranz = VEREINFACHUNG): Vec2[] {
  if (punkte.length < 3) return [...punkte];
  const behalten = new Uint8Array(punkte.length);
  behalten[0] = 1;
  behalten[punkte.length - 1] = 1;

  const stapel: [number, number][] = [[0, punkte.length - 1]];
  while (stapel.length) {
    const [von, bis] = stapel.pop()!;
    if (bis - von < 2) continue;
    let weit = -1;
    let index = -1;
    for (let i = von + 1; i < bis; i++) {
      const d = distanceToSegment(punkte[i], punkte[von], punkte[bis]);
      if (d > weit) {
        weit = d;
        index = i;
      }
    }
    if (weit > toleranz && index > 0) {
      behalten[index] = 1;
      stapel.push([von, index], [index, bis]);
    }
  }
  return punkte.filter((_, i) => behalten[i] === 1);
}

/** Winkelabstand zur nächsten Vielfachen von 90° um die Vorzugsrichtung [°]. */
function abweichung(dx: number, dy: number, richtungGrad: number): { rest: number; ziel: number } {
  const winkel = (Math.atan2(dy, dx) * 180) / Math.PI;
  const relativ = winkel - richtungGrad;
  const stufe = Math.round(relativ / 90);
  const ziel = richtungGrad + stufe * 90;
  let rest = relativ - stufe * 90;
  while (rest > 180) rest -= 360;
  while (rest < -180) rest += 360;
  return { rest: Math.abs(rest), ziel };
}

// ---------------------------------------------------------------------------
// Der ganze Weg
// ---------------------------------------------------------------------------

/**
 * Aus einem Freihandstrich Wandvorschläge machen.
 *
 * `punkte` sind Weltkoordinaten in Metern, in der Reihenfolge, in der der
 * Stift sie gezogen hat.
 */
export function erkenneSkizze(
  punkte: readonly Vec2[],
  optionen: {
    toleranz?: number;
    ausrichten?: boolean;
    /**
     * Die Richtung, an der sich die Skizze ausrichten soll [°].
     *
     * Steht im Modell schon ein Gebäude, ist seine Vorzugsrichtung
     * maßgeblich — eine angebaute Wand soll zum Bestand passen und nicht zu
     * dem Strich, mit dem sie gerade gezeichnet wurde. Ohne Angabe bestimmt
     * die Skizze ihre Richtung selbst.
     */
    richtungGrad?: number;
  } = {},
): Skizzenergebnis {
  const hinweise: string[] = [];
  if (punkte.length < 2) {
    return { ...SKIZZE_LEER, punkteRoh: punkte.length, hinweise: ['Der Strich ist zu kurz.'] };
  }

  // --- 1 und 2 · Glätten und vereinfachen ---------------------------------
  const glatt = glaette(punkte);
  const einfach = vereinfache(glatt, optionen.toleranz ?? VEREINFACHUNG);

  // --- Ring? --------------------------------------------------------------
  const ersteP = einfach[0];
  const letzteP = einfach[einfach.length - 1];
  const ring = einfach.length >= 4 && Math.hypot(letzteP.x - ersteP.x, letzteP.y - ersteP.y) <= RING_TOLERANZ;

  // Beim Ring fällt der Endpunkt weg — er ist der Anfangspunkt.
  //
  // **Und mit ihm der Schließfehler.** Ein freihändiger Umriss endet nie
  // genau am Anfang; die letzten Zentimeter sind der Weg zurück zum
  // Startpunkt. Das Vereinfachen liest darin gerne noch eine Ecke, und aus
  // dem Schließfehler würde eine 36 cm lange Wand quer in der Ecke. Alles,
  // was am Ende schon innerhalb der Ringtoleranz um den Anfang liegt, ist
  // deshalb Ankommen und keine Wand.
  let ecken = ring ? einfach.slice(0, -1) : einfach;
  if (ring) {
    while (
      ecken.length > 3 &&
      Math.hypot(ecken[ecken.length - 1].x - ecken[0].x, ecken[ecken.length - 1].y - ecken[0].y) <= RING_TOLERANZ
    ) {
      ecken = ecken.slice(0, -1);
    }
  }

  // --- 3 · Zu kurze Stücke schlucken --------------------------------------
  //
  // Ein Stück unter 35 cm ist keine Wand, sondern eine Ecke, die der Stift
  // in zwei Zügen genommen hat. Die beiden Nachbarn treffen sich später am
  // Schnittpunkt ihrer Verlängerungen ohnehin wieder.
  const behalten: Vec2[] = [ecken[0]];
  let geschluckt = 0;
  for (let i = 1; i < ecken.length; i++) {
    const vorher = behalten[behalten.length - 1];
    const d = Math.hypot(ecken[i].x - vorher.x, ecken[i].y - vorher.y);
    const letzter = i === ecken.length - 1;
    if (d < MIN_STRECKE && !letzter) {
      geschluckt += 1;
      continue;
    }
    behalten.push(ecken[i]);
  }
  if (geschluckt > 0) {
    hinweise.push(`${geschluckt} sehr kurze Stücke wurden als Ecke gelesen, nicht als Wand.`);
  }

  const paare: [Vec2, Vec2][] = [];
  for (let i = 1; i < behalten.length; i++) paare.push([behalten[i - 1], behalten[i]]);
  if (ring && behalten.length >= 3) paare.push([behalten[behalten.length - 1], behalten[0]]);

  if (paare.length === 0) {
    return {
      ...SKIZZE_LEER,
      punkteRoh: punkte.length,
      punkteEinfach: einfach.length,
      hinweise: ['Aus dem Strich ließ sich keine Wand lesen — er ist zu kurz oder zu rund.'],
    };
  }

  // --- 4 · Ausrichten ------------------------------------------------------
  //
  // **Wonach ausgerichtet wird.** Die Vorzugsrichtung entsteht aus dem Strich
  // selbst — außer in zwei Fällen:
  //
  //  · Der Aufrufer kennt die Richtung des Gebäudes schon, weil dort Wände
  //    stehen. Dann gilt die, denn eine neue Wand soll zum Bestand passen
  //    und nicht zu sich selbst.
  //  · Der Strich ist **eine einzige Strecke**. Dann ist „die Richtung, in
  //    der der größte Teil der Länge liegt", genau diese eine Strecke — sie
  //    würde also auf sich selbst ausgerichtet und bliebe schief. Wer eine
  //    einzelne Wand zieht, meint aber die Achse. Also gelten die Weltachsen.
  const richtungGrad =
    optionen.richtungGrad ??
    (paare.length === 1
      ? 0
      : (vorzugsrichtung(
          paare.map(([a, b]) => ({ dx: b.x - a.x, dy: b.y - a.y, laenge: Math.hypot(b.x - a.x, b.y - a.y) })),
        ) *
          180) /
        Math.PI);
  const ausrichten = optionen.ausrichten !== false;

  /** Je Strecke: Richtungsvektor nach dem Ausrichten und ob sie gezogen wurde. */
  const gerichtet: { a: Vec2; b: Vec2; dir: Vec2; ausgerichtet: boolean }[] = paare.map(([a, b]) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (!ausrichten) return { a, b, dir: { x: dx, y: dy }, ausgerichtet: false };
    const { rest, ziel } = abweichung(dx, dy, richtungGrad);
    if (rest > AUSRICHT_TOLERANZ) return { a, b, dir: { x: dx, y: dy }, ausgerichtet: false };
    const rad = (ziel * Math.PI) / 180;
    return { a, b, dir: { x: Math.cos(rad), y: Math.sin(rad) }, ausgerichtet: true };
  });
  /*
   * **Zwei Stücke auf derselben Achse sind eine Wand.**
   *
   * Nach dem Ausrichten kommt das regelmäßig vor: der Strich hatte an einer
   * Stelle eine Delle, die das Vereinfachen als Ecke gelesen hat, und das
   * Ausrichten zieht beide Teile auf dieselbe Achse zurück. Blieben sie
   * getrennt, wäre die Folge nicht kosmetisch: die anschließende
   * Eckenrechnung sucht den Schnittpunkt zweier **paralleler** Geraden,
   * findet keinen brauchbaren und lässt die gezeichneten Ecken stehen — und
   * damit steht am Ende genau der schiefe Zug im Plan, der vermieden werden
   * sollte. Dasselbe tut `fasseZusammen` beim Scanimport, aus demselben
   * Grund.
   */
  const richtungVon = (g: { dir: Vec2 }): number => {
    const w = (Math.atan2(g.dir.y, g.dir.x) * 180) / Math.PI;
    return ((w % 180) + 180) % 180;
  };
  const gleich = (x: { dir: Vec2 }, y: { dir: Vec2 }): boolean => {
    const d = Math.abs(richtungVon(x) - richtungVon(y));
    return Math.min(d, 180 - d) < 1;
  };
  const verschmolzen: typeof gerichtet = [];
  for (const g of gerichtet) {
    const vor = verschmolzen[verschmolzen.length - 1];
    if (vor && gleich(vor, g)) {
      vor.b = g.b;
      vor.ausgerichtet = vor.ausgerichtet && g.ausgerichtet;
      continue;
    }
    verschmolzen.push({ ...g });
  }
  // Beim Ring auch über die Naht hinweg: die letzte und die erste Strecke
  // können dieselbe Wand sein, wenn der Zug dort angefangen hat.
  if (ring && verschmolzen.length > 2) {
    const erste = verschmolzen[0];
    const letzte = verschmolzen[verschmolzen.length - 1];
    if (gleich(erste, letzte)) {
      erste.a = letzte.a;
      erste.ausgerichtet = erste.ausgerichtet && letzte.ausgerichtet;
      verschmolzen.pop();
    }
  }
  gerichtet.length = 0;
  gerichtet.push(...verschmolzen);

  // --- 5 · Ecken schließen -------------------------------------------------
  //
  // Nach dem Ausrichten liegt jede Strecke auf ihrer eigenen Geraden, und die
  // Geraden treffen sich nicht mehr in den gezeichneten Ecken. Gesucht ist
  // der Schnittpunkt der beiden Geraden — dort gehört die Ecke hin. Sind sie
  // fast parallel (eine sanfte Krümmung, die der Ausrichter beide Male
  // dieselbe Richtung geben ließ), gibt es keinen Schnittpunkt; dann bleibt
  // die gezeichnete Ecke stehen.
  const mitte = (a: Vec2, b: Vec2): Vec2 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const ecke = (i: number): Vec2 => {
    const vorige = gerichtet[(i - 1 + gerichtet.length) % gerichtet.length];
    const jetzige = gerichtet[i];
    const treff = lineIntersection(mitte(vorige.a, vorige.b), vorige.dir, mitte(jetzige.a, jetzige.b), jetzige.dir);
    if (!treff) return jetzige.a;
    // Eine Ecke, die weiter als einen Meter von der gezeichneten wegwandert,
    // ist keine Ecke mehr, sondern ein Schnittpunkt zweier fast paralleler
    // Geraden weit draußen. Dann bleibt die gezeichnete stehen.
    return Math.hypot(treff.x - jetzige.a.x, treff.y - jetzige.a.y) > 1 ? jetzige.a : treff;
  };

  /**
   * Einen Punkt auf die ausgerichtete Gerade einer Strecke ziehen.
   *
   * Für den **Anfang eines offenen Zuges** gebraucht. Er hat keinen Vorgänger,
   * mit dem er sich schneiden könnte, und blieb deshalb zunächst dort liegen,
   * wo der Stift angesetzt hatte — neben der ausgerichteten Geraden. Die
   * erste Strecke lief damit vom gezeichneten Anfangspunkt zur ausgerichteten
   * Ecke und war um ein halbes Grad schief, obwohl sie als „ausgerichtet"
   * galt. Ein halbes Grad auf fünf Metern sind vier Zentimeter — genug, dass
   * die Ecke im Plan nicht mehr stimmt.
   */
  const aufGerade = (p: Vec2, g: { a: Vec2; b: Vec2; dir: Vec2 }): Vec2 => {
    const n = Math.hypot(g.dir.x, g.dir.y) || 1;
    const ux = g.dir.x / n;
    const uy = g.dir.y / n;
    const m = mitte(g.a, g.b);
    const t = (p.x - m.x) * ux + (p.y - m.y) * uy;
    return { x: m.x + ux * t, y: m.y + uy * t };
  };

  /** Die festen Punkte des ganzen Zuges — je Strecke ein Anfang, plus das Ende. */
  const festePunkte = (): { punkte: Vec2[]; ende: Vec2 } => {
    const punkte: Vec2[] = gerichtet.map((_, i) =>
      i === 0 && !ring ? aufGerade(gerichtet[0].a, gerichtet[0]) : ecke(i),
    );
    // Das offene Ende der letzten Strecke: auf ihre eigene Gerade gezogen.
    const letzteStrecke = gerichtet[gerichtet.length - 1];
    const ende = ring
      ? punkte[0]
      : (() => {
          const start = punkte[punkte.length - 1];
          const laenge = Math.hypot(letzteStrecke.b.x - letzteStrecke.a.x, letzteStrecke.b.y - letzteStrecke.a.y);
          const n = Math.hypot(letzteStrecke.dir.x, letzteStrecke.dir.y) || 1;
          return { x: start.x + (letzteStrecke.dir.x / n) * laenge, y: start.y + (letzteStrecke.dir.y / n) * laenge };
        })();
    return { punkte, ende };
  };

  /*
   * --- 6 · Das Schrägstück in der Ecke -------------------------------------
   *
   * **Der Fall.** Ein Stift, der eine Ecke in zwei Zügen nimmt, hinterlässt
   * dort ein kurzes Stück quer zu beiden Wänden. Schritt 3 hat kurze Stücke
   * schon einmal geschluckt, aber nach der **gezeichneten** Länge — und die
   * ist hier zu groß: an einem mit dem Stift gezogenen Rechteck gemessen
   * 47 cm, also über der Schwelle von 35 cm. Es überlebt, wird nicht
   * ausgerichtet (20° neben der Achse), und erst die Eckenrechnung schneidet
   * es auf 28 cm zusammen. Im Vorschlag standen damit **fünf** Wände statt
   * vier, eine davon diagonal in der Ecke.
   *
   * **Warum erst hier und nicht früher.** Entscheidend ist nicht, wie lang
   * das Stück gezeichnet wurde, sondern wie lang die Wand würde, die daraus
   * entstünde. Diese Länge steht erst nach der Eckenrechnung fest. Deshalb
   * wird gerechnet, geprüft und, wenn nötig, ohne das Stück noch einmal
   * gerechnet.
   *
   * **Was dabei stehen bleibt: die abgeschrägte Ecke.** Eine echte Schräge
   * — die 45°-Ecke, die es in Grundrissen gibt — behält ihre Länge auch nach
   * der Eckenrechnung, denn ihre Nachbarn schneiden sie an, statt sich
   * hinter ihr zu treffen. Sie bleibt damit über der Schwelle und bleibt
   * stehen. Weggenommen wird nur, was zusammenfällt.
   */
  let eckstuecke = 0;
  for (let durchgang = 0; durchgang < gerichtet.length && gerichtet.length > 2; durchgang++) {
    const { punkte, ende } = festePunkte();
    const laengeVon = (i: number): number => {
      const a = punkte[i];
      const b = i + 1 < punkte.length ? punkte[i + 1] : ende;
      return Math.hypot(b.x - a.x, b.y - a.y);
    };
    const i = gerichtet.findIndex((g, k) => {
      if (g.ausgerichtet || !ausrichten) return false;
      if (laengeVon(k) >= ECKSTUECK) return false;
      // Zwei Nachbarn muss es geben: am offenen Ende eines Zuges würde das
      // Wegnehmen die Wand kürzer machen, als sie gezeichnet wurde.
      const vorN = ring ? (k - 1 + gerichtet.length) % gerichtet.length : k - 1;
      const nachN = ring ? (k + 1) % gerichtet.length : k + 1;
      if (vorN < 0 || nachN >= gerichtet.length || vorN === k || nachN === k) return false;
      const vor = gerichtet[vorN];
      const nach = gerichtet[nachN];
      // Parallele Nachbarn treffen sich nicht: dann ist das Stück ein
      // Versatz zwischen zwei Fluchten und keine Ecke.
      return vor.ausgerichtet && nach.ausgerichtet && !gleich(vor, nach);
    });
    if (i < 0) break;
    // Der Vorgänger übernimmt den Endpunkt; wo die Ecke wirklich liegt,
    // rechnet die Eckenrechnung im nächsten Durchgang aus.
    const vorN = ring ? (i - 1 + gerichtet.length) % gerichtet.length : i - 1;
    gerichtet[vorN].b = gerichtet[i].b;
    gerichtet.splice(i, 1);
    eckstuecke += 1;
  }
  if (eckstuecke > 0) {
    hinweise.push(
      eckstuecke === 1
        ? 'Ein kurzes Schrägstück wurde als Ecke gelesen, nicht als Wand.'
        : `${eckstuecke} kurze Schrägstücke wurden als Ecke gelesen, nicht als Wand.`,
    );
  }

  const schraeg = gerichtet.filter((g) => !g.ausgerichtet).length;
  if (schraeg > 0 && ausrichten) {
    hinweise.push(`${schraeg} Strecken sind deutlich schräg und bleiben, wie sie gezeichnet wurden.`);
  }

  const { punkte: punkteFest, ende: endpunkt } = festePunkte();

  const strecken: Skizzenstrecke[] = [];
  for (let i = 0; i < gerichtet.length; i++) {
    const a = punkteFest[i];
    const b = i + 1 < punkteFest.length ? punkteFest[i + 1] : endpunkt;
    const laenge = Math.hypot(b.x - a.x, b.y - a.y);
    if (laenge < 0.05) continue;
    strecken.push({ a, b, laenge, ausgerichtet: gerichtet[i].ausgerichtet });
  }

  if (ring) hinweise.push('Der Zug ist geschlossen — daraus wird ein Raum.');

  return {
    strecken,
    ring,
    drehungGrad: Math.round(richtungGrad * 10) / 10,
    punkteRoh: punkte.length,
    punkteEinfach: einfach.length,
    hinweise,
  };
}
