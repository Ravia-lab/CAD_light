/**
 * Wände gerade ziehen.
 * ---------------------------------------------------------------------------
 * Ein aufgemessener Grundriss steht nie ganz gerade. Beim Raumscan sind es
 * ein bis fünf Grad, beim abfotografierten Plan auch mehr — und solange das so
 * bleibt, sieht jede Maßkette krumm aus, jede Fläche hat drei Nachkommastellen
 * mehr als sie verdient, und beim Weiterzeichnen fängt man sich die Schieflage
 * ein.
 *
 * **Was hier nicht gemacht wird: einzelne Wände drehen.** Wände hängen an
 * gemeinsamen Knoten. Dreht man eine Wand um ihre Mitte, reißt sie von der
 * nächsten ab, und aus einer schiefen Ecke werden zwei lose Enden. Bewegt
 * werden deshalb **Knoten**, nicht Wände:
 *
 *   1. Jede Wand wird eingeordnet — waagerecht, senkrecht oder schräg. Schräg
 *      heißt: weiter als die Toleranz von beiden Achsen entfernt. Die bleibt
 *      unangetastet; ein Erker ist kein Messfehler.
 *   2. Alle Knoten, die über eine *waagerechte* Wand zusammenhängen, müssen
 *      dieselbe y-Höhe haben. Das ist die Bedingung, nicht das Ergebnis: sie
 *      pflanzt sich über T-Stöße durch den ganzen Zug fort, und genau deshalb
 *      wird ein durchgehender Wandzug auch als Ganzes gerade und nicht
 *      stückweise. Für senkrechte Wände dasselbe mit x.
 *   3. Der gemeinsame Wert ist das **längengewichtete** Mittel. Eine 5-m-Wand
 *      soll nicht von einem 40-cm-Stummel verzogen werden.
 *   4. Wandert dabei auch nur ein Knoten weiter als erlaubt, bleibt die ganze
 *      Gruppe stehen. Das ist die Bremse gegen den Fall, in dem eine fast
 *      schräge Wand zwei Wandzüge verkettet, die nichts miteinander zu tun
 *      haben — ohne sie zöge das Begradigen den halben Grundriss zusammen.
 *
 * Der Rückgabewert enthält nur die **neuen Koordinaten**; geschrieben wird
 * nichts. So lässt sich dasselbe Ergebnis vorher anzeigen und hinterher
 * rückgängig machen.
 */

import type { BimNode, Vec2, Wall } from '../types/bim';

export interface BegradigenOptionen {
  /**
   * Bis zu welcher Abweichung eine Wand als achsparallel gilt [°].
   *
   * 8° deckt Aufmaßstreuung ab (ein Raumscan liegt bei 0 bis 5°) und lässt
   * alles darüber in Ruhe. Wer eine 30°-Wand begradigt haben will, meint
   * etwas anderes und soll sie von Hand ziehen.
   */
  winkelToleranz?: number;
  /**
   * Wie weit ein einzelner Knoten dabei höchstens wandern darf [m].
   *
   * Überschreitet ihn eine Gruppe, bleibt sie ganz stehen — halb begradigt
   * wäre schlimmer als gar nicht, weil dabei Ecken aufgehen.
   */
  maxVersatz?: number;
}

export interface BegradigenErgebnis {
  /** Neue Koordinaten, nur für tatsächlich bewegte Knoten. */
  knoten: Record<string, Vec2>;
  /** Länge jeder betroffenen Wand vorher und nachher — für die Öffnungen. */
  laengen: Record<string, { vorher: number; nachher: number }>;
  bewegt: number;
  groessterVersatz: number;
  /** Wände, die vorher bzw. nachher exakt achsparallel stehen. */
  achsparallelVorher: number;
  achsparallelNachher: number;
  /** Gruppen, die wegen `maxVersatz` unangetastet blieben. */
  uebersprungen: number;
  /** Wände, die zu schräg sind, um als Messfehler durchzugehen. */
  schraeg: number;
}

const LEER: BegradigenErgebnis = {
  knoten: {},
  laengen: {},
  bewegt: 0,
  groessterVersatz: 0,
  achsparallelVorher: 0,
  achsparallelNachher: 0,
  uebersprungen: 0,
  schraeg: 0,
};

/** Abweichung der Wandrichtung von der nächsten Achse [°], 0…45. */
export function achsAbweichung(a: Vec2, b: Vec2): number {
  const g = Math.abs((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI) % 90;
  return Math.min(g, 90 - g);
}

/** Steht die Wand exakt auf einer Achse? Ein Zehntelgrad ist Rundung, mehr nicht. */
const istAchsparallel = (a: Vec2, b: Vec2): boolean => achsAbweichung(a, b) < 0.1;

/** Einfaches Union-Find über Knotenkennungen. */
function verband(): {
  finde: (k: string) => string;
  vereine: (a: string, b: string) => void;
} {
  const eltern = new Map<string, string>();
  const finde = (k: string): string => {
    let wurzel = eltern.get(k) ?? k;
    if (wurzel === k) {
      eltern.set(k, k);
      return k;
    }
    wurzel = finde(wurzel);
    eltern.set(k, wurzel);
    return wurzel;
  };
  const vereine = (a: string, b: string): void => {
    const wa = finde(a);
    const wb = finde(b);
    if (wa !== wb) eltern.set(wb, wa);
  };
  return { finde, vereine };
}

export function begradige(
  walls: Wall[],
  nodes: Record<string, BimNode>,
  optionen: BegradigenOptionen = {},
): BegradigenErgebnis {
  const winkelToleranz = optionen.winkelToleranz ?? 8;
  const maxVersatz = optionen.maxVersatz ?? 0.3;

  const gueltig = walls.filter((w) => nodes[w.a] && nodes[w.b]);
  if (gueltig.length === 0) return { ...LEER };

  // --- 1 · Einordnen ---------------------------------------------------------
  type Art = 'waagerecht' | 'senkrecht' | 'schraeg';
  const art = new Map<string, Art>();
  let schraeg = 0;
  let achsparallelVorher = 0;
  for (const w of gueltig) {
    const a = nodes[w.a];
    const b = nodes[w.b];
    if (istAchsparallel(a, b)) achsparallelVorher++;
    const grad = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    const zurWaagerechten = Math.min(Math.abs(grad % 180), 180 - Math.abs(grad % 180));
    const zurSenkrechten = Math.abs(90 - Math.abs(grad % 180));
    if (zurWaagerechten <= winkelToleranz) art.set(w.id, 'waagerecht');
    else if (zurSenkrechten <= winkelToleranz) art.set(w.id, 'senkrecht');
    else {
      art.set(w.id, 'schraeg');
      schraeg++;
    }
  }

  // --- 2 · Gruppen bilden ----------------------------------------------------
  const yVerband = verband();
  const xVerband = verband();
  for (const w of gueltig) {
    const a = art.get(w.id);
    if (a === 'waagerecht') yVerband.vereine(w.a, w.b);
    else if (a === 'senkrecht') xVerband.vereine(w.a, w.b);
  }

  /**
   * Gewicht eines Knotens in seiner Gruppe: die Summe der Wandlängen, die dort
   * in der maßgeblichen Richtung ankommen. Ein Knoten, an dem eine lange Wand
   * endet, zieht stärker als einer am Stummel.
   */
  const gewicht = (richtung: Art): Map<string, number> => {
    const g = new Map<string, number>();
    for (const w of gueltig) {
      if (art.get(w.id) !== richtung) continue;
      const l = Math.hypot(nodes[w.b].x - nodes[w.a].x, nodes[w.b].y - nodes[w.a].y);
      g.set(w.a, (g.get(w.a) ?? 0) + l);
      g.set(w.b, (g.get(w.b) ?? 0) + l);
    }
    return g;
  };

  const neuY = new Map<string, number>();
  const neuX = new Map<string, number>();
  let uebersprungen = 0;

  /** Eine Achse ausrichten: gruppieren, mitteln, Versatz prüfen. */
  const richteAus = (
    v: ReturnType<typeof verband>,
    richtung: Art,
    holeWert: (n: BimNode) => number,
    ziel: Map<string, number>,
  ): void => {
    const g = gewicht(richtung);
    const gruppen = new Map<string, string[]>();
    for (const id of g.keys()) {
      const wurzel = v.finde(id);
      const liste = gruppen.get(wurzel);
      if (liste) liste.push(id);
      else gruppen.set(wurzel, [id]);
    }

    for (const mitglieder of gruppen.values()) {
      if (mitglieder.length < 2) continue;
      let summe = 0;
      let gewichtSumme = 0;
      for (const id of mitglieder) {
        const wg = g.get(id) ?? 0;
        summe += holeWert(nodes[id]) * wg;
        gewichtSumme += wg;
      }
      if (gewichtSumme <= 0) continue;
      const mittel = summe / gewichtSumme;

      // Die Bremse: wandert einer zu weit, bleibt die ganze Gruppe stehen.
      let weiteste = 0;
      for (const id of mitglieder) {
        weiteste = Math.max(weiteste, Math.abs(holeWert(nodes[id]) - mittel));
      }
      if (weiteste > maxVersatz) {
        uebersprungen++;
        continue;
      }
      for (const id of mitglieder) ziel.set(id, mittel);
    }
  };

  richteAus(yVerband, 'waagerecht', (n) => n.y, neuY);
  richteAus(xVerband, 'senkrecht', (n) => n.x, neuX);

  // --- 3 · Neue Koordinaten --------------------------------------------------
  const knoten: Record<string, Vec2> = {};
  let bewegt = 0;
  let groessterVersatz = 0;
  const rund = (v: number): number => Math.round(v * 1000) / 1000;

  for (const id of new Set([...neuX.keys(), ...neuY.keys()])) {
    const n = nodes[id];
    if (!n || n.locked) continue;
    const x = rund(neuX.get(id) ?? n.x);
    const y = rund(neuY.get(id) ?? n.y);
    const versatz = Math.hypot(x - n.x, y - n.y);
    if (versatz < 1e-4) continue;
    knoten[id] = { x, y };
    bewegt++;
    groessterVersatz = Math.max(groessterVersatz, versatz);
  }

  // --- 4 · Längen vorher/nachher --------------------------------------------
  const holen = (id: string): Vec2 => knoten[id] ?? nodes[id];
  const laengen: Record<string, { vorher: number; nachher: number }> = {};
  let achsparallelNachher = 0;
  for (const w of gueltig) {
    const a0 = nodes[w.a];
    const b0 = nodes[w.b];
    const a1 = holen(w.a);
    const b1 = holen(w.b);
    if (istAchsparallel(a1, b1)) achsparallelNachher++;
    const vorher = Math.hypot(b0.x - a0.x, b0.y - a0.y);
    const nachher = Math.hypot(b1.x - a1.x, b1.y - a1.y);
    if (Math.abs(vorher - nachher) > 1e-6) laengen[w.id] = { vorher, nachher };
  }

  return {
    knoten,
    laengen,
    bewegt,
    groessterVersatz: rund(groessterVersatz),
    achsparallelVorher,
    achsparallelNachher,
    uebersprungen,
    schraeg,
  };
}
