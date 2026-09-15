/**
 * Prüfblock „Außenwand" — die Hülle einmal zeichnen, nicht je Geschoss neu.
 *
 * **Worum es geht.** Steht der erste Grundriss, ist die Gebäudehülle
 * festgelegt. `src/lib/aussenwand.ts` beantwortet, welche Wände eines
 * Geschosses dazugehören, wie sie auf ein anderes Geschoss zu übertragen
 * wären und ob der Vorschlag überhaupt lohnt. Das Modul ändert nichts — es
 * legt einen Plan vor, den der Speicher einhängt. Genau deshalb lässt sich
 * hier alles prüfen, was daran fachlich ist, ohne eine Oberfläche zu starten.
 *
 * **Warum dieser Block nötig ist.** Drei Fehler dieses Moduls sind im Bild
 * nicht zu sehen und trotzdem im Ergebnis:
 *
 *  • **Die doppelte Wand.** Wird zweimal übernommen und liegt beim zweiten
 *    Mal eine zweite Wand auf der ersten, sind die beiden im Plan nicht zu
 *    unterscheiden — die Transmissionsfläche der ganzen Hülle ist danach
 *    doppelt so groß. Abschnitt E ist die Prüfung dagegen und der Grund,
 *    warum `schonDa` überhaupt gezählt wird.
 *  • **Der doppelte Knoten.** Bekäme jede Wand ihr eigenes Endknotenpaar,
 *    lägen in jeder Ecke zwei Knoten übereinander. Die Raumerkennung
 *    verschweißt sie (`WELD_TOLERANCE`), also fällt es im Bild nicht auf —
 *    aber das Ziehen einer Ecke bewegte nur noch eine der beiden Wände.
 *    Abschnitt B rechnet deshalb nach, dass aus vier Wänden mit acht Enden
 *    vier Knoten werden und nicht acht.
 *  • **Die mitgewanderte Öffnung.** Ein Fenster, das die Kopie erfindet,
 *    steht mit voller Fläche im Transmissionsverlust und im solaren Gewinn
 *    eines Geschosses, das niemand aufgemessen hat. Abschnitt D prüft nicht
 *    nur, dass keines im Plan steht, sondern dass der Plan gar kein Feld
 *    dafür hat.
 *
 * **Die Sollwerte stehen von Hand da.** Eine Prüfung, die ihre Erwartung aus
 * derselben Rechnung holt, die sie prüft, bestätigt nur, dass die Rechnung
 * sich selbst gleicht. Das Prüfhaus ist deshalb so gebaut, dass jede Zahl im
 * Kopf nachzurechnen ist: ein Rechteck 10,00 m × 8,00 m über den Wandachsen
 * — Umfang 2 × (10 + 8) = 36,00 m —, vier Ecken, dazu eine Innenwand quer auf
 * halber Höhe von (0|4) nach (10|4). Die Geschosshöhen sind mit 2,75 m unten
 * und 2,50 m oben verschieden gewählt, damit eine mitgeschleppte Vorlagehöhe
 * auffällt; wären beide gleich, ginge der Fehler durch.
 *
 * **Warum das Rechteck achsparallel bleibt.** Anders als bei den Griffen geht
 * hier keine Richtung in das Ergebnis ein: Verglichen werden Punktabstände,
 * und die sind von der Lage unabhängig. Eine schräge Wand brächte krumme
 * Erwartungswerte und keine zusätzliche Aussage. Die Vertauschprobe in
 * Abschnitt F deckt den Fall ab, in dem eine Richtung doch zählt — die Wand,
 * die jemand andersherum gezogen hat.
 *
 * **Was dieser Block nicht prüft.** Wie gefragt wird. `uebernahmeSinnvoll`
 * liefert nur das Urteil; wann die Oberfläche es zeigt, wie der Dialog heißt
 * und was ein Abbruch bedeutet, gehört dorthin und nicht hierher.
 */

import type { CheckFn } from './typ';
import type { BimNode, Opening, Wall } from '../../src/types/bim';
import { WELD_TOLERANCE } from '../../src/lib/roomDetection';
import {
  UEBERNAHME_TOLERANZ,
  aussenwaendeVon,
  planeUebernahme,
  uebernahmeSinnvoll,
  type UebernahmePlan,
} from '../../src/lib/aussenwand';

// ---------------------------------------------------------------------------
// Kleinkram
// ---------------------------------------------------------------------------

/** Auf Millimeter runden — feiner ist an einer Wandachse keine Angabe. */
const r3 = (v: number): number => Math.round(v * 1000) / 1000;

/**
 * Ein optionales Feld prüfbar machen, ohne die Lücke zuzuschütten.
 *
 * Die halbe Aussage dieses Blocks ist, welche Felder **nicht** mitwandern.
 * Wer das mit `?? 0` oder `!` glattzieht, macht aus „fehlt" einen Wert und
 * kann den Unterschied nicht mehr prüfen. `'fehlt'` ist ein dritter Zustand,
 * der gegen jeden Sollwert falsch ist und im Protokoll auch so erscheint.
 */
function angabe<T extends string | number | boolean>(value: T | undefined): T | 'fehlt' {
  return value === undefined ? 'fehlt' : value;
}

/** Kennungen wie im Speicher — und mitgezählt, damit „nichts angelegt" prüfbar ist. */
function kennungen(): { uid: (prefix: string) => string; aufrufe: () => number } {
  let n = 0;
  return {
    uid: (prefix: string) => `${prefix}${++n}`,
    aufrufe: () => n,
  };
}

const EG = 'eg';
const OG = 'og';

/** Lichte Höhe des Erdgeschosses [m] — bewusst nicht die des Obergeschosses. */
const HOEHE_EG = 2.75;
/** Lichte Höhe des Obergeschosses [m] — die Höhe, die jede Kopie bekommen muss. */
const HOEHE_OG = 2.5;

interface Geschosse {
  walls: Wall[];
  nodes: Record<string, BimNode>;
}

/**
 * Das Prüfhaus: Rechteck 10 × 8 über den Wandachsen, dazu eine Innenwand.
 *
 * Die Innenwand hängt an zwei **eigenen** Knoten auf der West- und Ostachse
 * und nicht an den Ecken. Hinge sie an den Ecken, käme sie über die Knoten
 * mit in die Übernahme, ohne dass ihre Wand kopiert würde — die Prüfung auf
 * vier Knoten wäre dann zufällig richtig.
 *
 * Die Felder, die **nicht** mitwandern dürfen, sind absichtlich besetzt:
 * ein U-Wert und ein Material an der Wand, ein `locked` an der Ostwand und
 * am Eckknoten (0|0), und ein `thicknessEstimated` an der Südwand — das
 * einzige davon, das mitwandern **muss**, weil es zur Stärke gehört.
 */
function pruefhaus(): Geschosse {
  const nodes: Record<string, BimNode> = {
    'eg-n0': { id: 'eg-n0', x: 0, y: 0, levelId: EG, locked: true },
    'eg-n1': { id: 'eg-n1', x: 10, y: 0, levelId: EG },
    'eg-n2': { id: 'eg-n2', x: 10, y: 8, levelId: EG },
    'eg-n3': { id: 'eg-n3', x: 0, y: 8, levelId: EG },
    'eg-n4': { id: 'eg-n4', x: 0, y: 4, levelId: EG },
    'eg-n5': { id: 'eg-n5', x: 10, y: 4, levelId: EG },
  };
  const aussen = (id: string, a: string, b: string): Wall => ({
    id,
    levelId: EG,
    a,
    b,
    thickness: 0.365,
    height: HOEHE_EG,
    type: 'exterior',
    layerId: 'ebene-waende',
    constructionId: 'aw-365',
    uValue: 0.24,
  });
  const walls: Wall[] = [
    { ...aussen('eg-w0', 'eg-n0', 'eg-n1'), thicknessEstimated: true },
    { ...aussen('eg-w1', 'eg-n1', 'eg-n2'), locked: true, material: 'Ziegel' },
    aussen('eg-w2', 'eg-n2', 'eg-n3'),
    aussen('eg-w3', 'eg-n3', 'eg-n0'),
    {
      id: 'eg-w4',
      levelId: EG,
      a: 'eg-n4',
      b: 'eg-n5',
      thickness: 0.115,
      height: HOEHE_EG,
      type: 'interior',
      layerId: 'ebene-waende',
      constructionId: 'iw-115',
    },
  ];
  return { walls, nodes };
}

/** Ein Fenster in der Südwand — es darf nirgends im Plan auftauchen. */
const FENSTER_SUED: Opening = {
  id: 'eg-fenster-sued',
  wallId: 'eg-w0',
  kind: 'window',
  distance: 5,
  width: 1.5,
  height: 1.3,
  sillHeight: 0.9,
};

/** Eine Wand im Obergeschoss, gerade genug für den Abgleich. */
function ogWand(
  id: string,
  a: { id: string; x: number; y: number },
  b: { id: string; x: number; y: number },
  type: Wall['type'] = 'exterior',
): { wall: Wall; nodes: Record<string, BimNode> } {
  return {
    wall: {
      id,
      levelId: OG,
      a: a.id,
      b: b.id,
      thickness: 0.365,
      height: HOEHE_OG,
      type,
      layerId: 'ebene-waende',
    },
    nodes: {
      [a.id]: { id: a.id, x: a.x, y: a.y, levelId: OG },
      [b.id]: { id: b.id, x: b.x, y: b.y, levelId: OG },
    },
  };
}

/**
 * Das Prüfhaus mit einer einzigen Wand im Obergeschoss, um `versatz` nach
 * Norden verschoben. Die Südwand des Erdgeschosses läuft von (0|0) nach
 * (10|0); die Vergleichswand läuft von (0|versatz) nach (10|versatz).
 */
function mitOgWand(versatz: number, type: Wall['type'] = 'exterior'): Geschosse {
  const haus = pruefhaus();
  const { wall, nodes } = ogWand(
    'og-w0',
    { id: 'og-n0', x: 0, y: versatz },
    { id: 'og-n1', x: 10, y: versatz },
    type,
  );
  return { walls: [...haus.walls, wall], nodes: { ...haus.nodes, ...nodes } };
}

/** Den Plan einhängen, wie es der Speicher täte. */
function anwenden(basis: Geschosse, plan: UebernahmePlan): Geschosse {
  const nodes = { ...basis.nodes };
  for (const k of plan.neueKnoten) nodes[k.id] = k;
  return { walls: [...basis.walls, ...plan.neueWaende], nodes };
}

/** Ein Punkt als ein Wort, damit beide Koordinaten in eine Prüfzeile passen. */
const punktwort = (p: { x: number; y: number }): string => `${r3(p.x)}|${r3(p.y)}`;

/** Die Achse einer Wand als ein Wort — das Maß, das auf den Millimeter stimmen muss. */
function achswort(wand: Wall, nodes: Record<string, BimNode>): string {
  const a = nodes[wand.a];
  const b = nodes[wand.b];
  if (!a || !b) return 'ohne Achse';
  return `${punktwort(a)}→${punktwort(b)}`;
}

/** Länge einer Wandachse [m]. */
function laenge(wand: Wall, nodes: Record<string, BimNode>): number {
  const a = nodes[wand.a];
  const b = nodes[wand.b];
  if (!a || !b) return 0;
  return Math.hypot(b.x - a.x, b.y - a.y);
}

// ---------------------------------------------------------------------------

export function pruefeAussenwand(check: CheckFn): void {
  // =========================================================================
  // A — Welche Wände sind Außenwände?
  // =========================================================================

  const haus = pruefhaus();

  /*
   * Fünf Wände stehen im Erdgeschoss: vier im Ring und eine quer. Maßgeblich
   * ist `type === 'exterior'`, also bleiben vier. Die Zahl steht hier als 4
   * und nicht als `walls.length - 1` — sonst prüfte die Zeile nur, dass eine
   * Liste um eins kürzer geworden ist, und nicht, welche Wand fehlt.
   */
  const aussenEg = aussenwaendeVon(haus.walls, haus.nodes, EG);
  check('Vier Außenwände im Erdgeschoss', aussenEg.length, 4);
  check(
    '… und zwar der Ring, nicht die Innenwand',
    aussenEg.map((w) => w.id).join(','),
    'eg-w0,eg-w1,eg-w2,eg-w3',
  );

  // Das Obergeschoss ist leer — auch das muss die Funktion sagen können,
  // sonst könnte die Oberfläche nie fragen, ob übernommen werden soll.
  check('Das leere Obergeschoss hat keine', aussenwaendeVon(haus.walls, haus.nodes, OG).length, 0);

  /*
   * Eine Außenwand, deren Endknoten fehlt, hat keine Achse. Sie lässt sich
   * weder vergleichen noch übertragen, und eine geratene Lage wäre schlimmer
   * als eine fehlende Wand. Sie zählt deshalb nicht mit: 4 statt 5.
   */
  const mitBruch: Wall[] = [
    ...haus.walls,
    { ...haus.walls[0], id: 'eg-w9', a: 'eg-n0', b: 'gibtsnicht' },
  ];
  check('Eine Wand ohne Endknoten zählt nicht mit', aussenwaendeVon(mitBruch, haus.nodes, EG).length, 4);

  // Ein anderes Geschoss bleibt ein anderes Geschoss.
  const zweiEbenen = mitOgWand(3);
  check('Die Wand im Obergeschoss zählt nicht zum Erdgeschoss', aussenwaendeVon(zweiEbenen.walls, zweiEbenen.nodes, EG).length, 4);
  check('… und im Obergeschoss steht genau die eine', aussenwaendeVon(zweiEbenen.walls, zweiEbenen.nodes, OG).length, 1);

  // =========================================================================
  // B — Die Übernahme auf ein leeres Obergeschoss
  // =========================================================================

  const k1 = kennungen();
  const plan = planeUebernahme({
    walls: haus.walls,
    nodes: haus.nodes,
    vonLevelId: EG,
    nachLevelId: OG,
    hoehe: HOEHE_OG,
    uid: k1.uid,
  });

  check('Vier Wände werden angelegt', plan.neueWaende.length, 4);
  check('Nichts liegt schon da', plan.schonDa, 0);

  /*
   * Die Knotenzahl ist die Stelle, an der sich die Konvention entscheidet.
   * Von Hand: Vier Wände haben 4 × 2 = 8 Enden, aber der Ring hat nur vier
   * Ecken — jede Ecke wird von zwei Wänden benutzt. Je Vorlageknoten entsteht
   * genau ein Zielknoten, also 4 und nicht 8. Die Innenwand hängt an zwei
   * eigenen Knoten (0|4) und (10|4); die wandern nicht mit, weil ihre Wand
   * nicht mitwandert — sonst stünden hier 6.
   */
  check('Vier Knoten, nicht acht — der Ring teilt seine Ecken', plan.neueKnoten.length, 4);
  check(
    '… und jeder Knoten liegt an einer anderen Stelle',
    new Set(plan.neueKnoten.map(punktwort)).size,
    4,
  );

  check('Alle neuen Wände gehören ins Obergeschoss', plan.neueWaende.every((w) => w.levelId === OG), true);
  check('Alle neuen Knoten gehören ins Obergeschoss', plan.neueKnoten.every((k) => k.levelId === OG), true);

  /*
   * Knoten werden **nicht geteilt**: Keine neue Wand darf auf einen Knoten
   * des Erdgeschosses zeigen. Täte sie es, zöge ein Versatz im Obergeschoss
   * die Erdgeschosswand mit — zwei Grundrisse, die sich nicht mehr getrennt
   * bearbeiten lassen.
   */
  const neueKnotenIds = new Set(plan.neueKnoten.map((k) => k.id));
  check(
    'Keine neue Wand hängt an einem Knoten des Erdgeschosses',
    plan.neueWaende.every((w) => neueKnotenIds.has(w.a) && neueKnotenIds.has(w.b)),
    true,
  );
  check(
    'Die neuen Kennungen sind frisch und überschreiben nichts',
    plan.neueKnoten.every((k) => !(k.id in haus.nodes)),
    true,
  );

  // Die Innenwand bleibt unten: keine der vier Kopien trägt ihre Stärke.
  check('Die Innenwand wandert nicht mit', plan.neueWaende.every((w) => w.thickness === 0.365), true);

  // =========================================================================
  // C — Die Achsen stimmen auf den Millimeter
  // =========================================================================

  const nachher = anwenden(haus, plan);

  /*
   * Rechteck 10 × 8, gegen den Uhrzeigersinn ab (0|0). Die vier Achsen von
   * Hand: Süd (0|0)→(10|0), Ost (10|0)→(10|8), Nord (10|8)→(0|8), West
   * (0|8)→(0|0). Die Reihenfolge folgt der Vorlage, damit eine vertauschte
   * Zuordnung hier und nicht erst in Abschnitt H auffällt.
   */
  check(
    'Die vier Achsen liegen auf der Vorlage',
    plan.neueWaende.map((w) => achswort(w, nachher.nodes)).join(' · '),
    '0|0→10|0 · 10|0→10|8 · 10|8→0|8 · 0|8→0|0',
  );

  /*
   * Und der Umfang als eine Zahl: 2 × (10,00 + 8,00) = 36,00 m. Toleranz
   * ein halber Millimeter — feiner ist an einer Wandachse keine Angabe, und
   * gröber ginge ein vertauschtes Koordinatenpaar durch.
   */
  const umfang = plan.neueWaende.reduce((s, w) => s + laenge(w, nachher.nodes), 0);
  check('Umfang der Kopie: 2 × (10 + 8) = 36,000 m', r3(umfang), 36, 0.0005);

  // =========================================================================
  // D — Öffnungen wandern nicht mit
  // =========================================================================

  /*
   * Die Südwand trägt ein Fenster. Geprüft wird nicht, dass keines im Plan
   * steht — das wäre wohlfeil, weil `planeUebernahme` gar keine Öffnungen
   * entgegennimmt —, sondern dass der Plan **kein Feld** dafür hat. Wer sie
   * eines Tages doch übernehmen will, soll die Entscheidung neu treffen
   * müssen und nicht versehentlich eine Liste mitfüllen können.
   */
  check(
    'Der Plan trägt genau drei Felder — keines für Öffnungen',
    Object.keys(plan).sort().join(','),
    'neueKnoten,neueWaende,schonDa',
  );

  /*
   * Und die Stelle, an der eine Öffnung trotzdem durchschlüpfen könnte: Eine
   * Öffnung zeigt über `wallId` auf ihre Wand. Trüge eine Kopie die Kennung
   * ihrer Vorlage, gehörte das Fenster der Erdgeschosswand mit einem Mal zu
   * zwei Wänden — es stünde im Obergeschoss, ohne dass irgendwo ein zweites
   * Fenster angelegt worden wäre, und kein Blick in die Öffnungsliste würde
   * es zeigen.
   */
  check(
    'Keine Kopie trägt die Kennung ihrer Vorlage',
    plan.neueWaende.every((w) => !haus.walls.some((v) => v.id === w.id)),
    true,
  );
  check(
    '… insbesondere nicht die Wand, an der das Fenster hängt',
    plan.neueWaende.some((w) => w.id === FENSTER_SUED.wallId),
    false,
  );

  // Die Wand mit dem Fenster wurde trotzdem übernommen — es geht um die
  // Öffnung und nicht darum, die Wand auszulassen.
  check(
    'Die Wand mit dem Fenster ist trotzdem dabei',
    plan.neueWaende.some((w) => achswort(w, nachher.nodes) === '0|0→10|0'),
    true,
  );

  // =========================================================================
  // E — Zweimal übernehmen legt nichts doppelt an
  // =========================================================================

  /*
   * Die Prüfung gegen die doppelte Wand. Nach der ersten Übernahme stehen
   * oben vier Wände auf genau den Achsen der Vorlage. Der zweite Lauf muss
   * alle vier wiedererkennen: 4 × `schonDa`, nichts Neues, und nicht eine
   * einzige Kennung vergeben — ein Zähler, der weiterläuft, obwohl nichts
   * entsteht, wäre das Zeichen, dass doch etwas gebaut und nur nicht
   * ausgegeben wurde.
   */
  const k2 = kennungen();
  const plan2 = planeUebernahme({
    walls: nachher.walls,
    nodes: nachher.nodes,
    vonLevelId: EG,
    nachLevelId: OG,
    hoehe: HOEHE_OG,
    uid: k2.uid,
  });
  check('Beim zweiten Mal entsteht keine Wand', plan2.neueWaende.length, 0);
  check('… und kein Knoten', plan2.neueKnoten.length, 0);
  check('… alle vier liegen schon da', plan2.schonDa, 4);
  check('… und es wird keine Kennung verbraucht', k2.aufrufe(), 0);

  // =========================================================================
  // F — Wann ist es dieselbe Wand?
  // =========================================================================

  /** Kurzform für die Abschnitte F und G: planen und nur die Zahlen behalten. */
  const plane = (g: Geschosse): UebernahmePlan =>
    planeUebernahme({
      walls: g.walls,
      nodes: g.nodes,
      vonLevelId: EG,
      nachLevelId: OG,
      hoehe: HOEHE_OG,
      uid: kennungen().uid,
    });

  check('Die Toleranz beträgt 5 cm', UEBERNAHME_TOLERANZ, 0.05);
  /*
   * Und sie ist dieselbe wie die der Raumerkennung. Wäre die Übernahme
   * feinfühliger, legte sie eine zweite Wand an, deren Enden `healSegments`
   * anschließend auf die erste schweißt: zwei Wände an einer Kante, doppelte
   * Fläche, ein Bild ohne Auffälligkeit. Diese Zeile hält die Kopplung fest.
   */
  check('… und ist die Schweißtoleranz der Raumerkennung', UEBERNAHME_TOLERANZ === WELD_TOLERANCE, true);

  /*
   * 20 cm daneben ist eine andere Wand — und ihre Enden liegen auch zu weit
   * von den vorhandenen Knoten weg, um darauf einzurasten: 4 neue Wände,
   * 4 neue Knoten.
   */
  const weit = plane(mitOgWand(0.2));
  check('20 cm versetzt: eine andere Wand', weit.schonDa, 0);
  check('… es entstehen alle vier', weit.neueWaende.length, 4);
  check('… mit vier eigenen Knoten', weit.neueKnoten.length, 4);

  // 6 cm ist mehr als 5 cm — knapp, aber draußen.
  const knappDraussen = plane(mitOgWand(0.06));
  check('6 cm versetzt: immer noch eine andere Wand', knappDraussen.schonDa, 0);
  check('… es entstehen alle vier', knappDraussen.neueWaende.length, 4);

  /*
   * 4 cm ist innerhalb der Toleranz: dieselbe Wand. Von Hand nachgezählt:
   * Die Südwand gilt als vorhanden (`schonDa` = 1), es bleiben drei Wände
   * (Ost, Nord, West). Die benutzen die Vorlageecken (10|0), (10|8), (0|8)
   * und (0|0) — vier Stück. Zwei davon, (0|0) und (10|0), liegen 4 cm neben
   * den vorhandenen Knoten (0|0,04) und (10|0,04) und rasten darauf ein.
   * Bleiben 4 − 2 = 2 neue Knoten.
   */
  const knappDrin = plane(mitOgWand(0.04));
  check('4 cm versetzt: dieselbe Wand', knappDrin.schonDa, 1);
  check('… es bleiben drei anzulegen', knappDrin.neueWaende.length, 3);
  check('… und nur zwei neue Knoten, zwei rasten ein', knappDrin.neueKnoten.length, 2);
  check(
    '… und zwar auf die beiden Knoten, die oben schon stehen',
    knappDrin.neueWaende.some((w) => w.a === 'og-n0' || w.b === 'og-n0') &&
      knappDrin.neueWaende.some((w) => w.a === 'og-n1' || w.b === 'og-n1'),
    true,
  );

  /*
   * Die Vertauschprobe: dieselbe Achse, andersherum gezogen. Ohne den
   * Vergleich in beide Richtungen bekäme jede andersherum gezeichnete Wand
   * eine Kopie — genau die unsichtbare Doppelung aus Abschnitt E.
   */
  const haus2 = pruefhaus();
  const rueckwaerts = ogWand(
    'og-w0',
    { id: 'og-n0', x: 10, y: 0 },
    { id: 'og-n1', x: 0, y: 0 },
  );
  const verkehrt = plane({
    walls: [...haus2.walls, rueckwaerts.wall],
    nodes: { ...haus2.nodes, ...rueckwaerts.nodes },
  });
  check('Andersherum gezogen ist dieselbe Wand', verkehrt.schonDa, 1);
  check('… es bleiben drei anzulegen', verkehrt.neueWaende.length, 3);

  /*
   * Und der Fall, der zeigt, dass es um die Fläche geht und nicht um die
   * Einstufung: Steht im Ziel eine als `interior` geführte Wand auf derselben
   * Achse, ist das eine Frage an die Einstufung — eine zweite Wand darüber
   * verdoppelt die Fläche trotzdem.
   */
  const alsInnenwand = plane(mitOgWand(0, 'interior'));
  check('Eine gleich liegende Innenwand zählt auch als „schon da"', alsInnenwand.schonDa, 1);
  check('… es bleiben drei anzulegen', alsInnenwand.neueWaende.length, 3);

  // =========================================================================
  // G — Lohnt der Vorschlag?
  // =========================================================================

  check('Beim leeren Obergeschoss: ja', uebernahmeSinnvoll(haus.walls, haus.nodes, EG, OG), true);
  check(
    '… nach der Übernahme: nein',
    uebernahmeSinnvoll(nachher.walls, nachher.nodes, EG, OG),
    false,
  );
  /*
   * Ohne Vorlage gibt es nichts zu übernehmen. Gefragt wird hier andersherum
   * — vom leeren Obergeschoss ins volle Erdgeschoss.
   */
  check('Ohne Außenwände im Quellgeschoss: nein', uebernahmeSinnvoll(haus.walls, haus.nodes, OG, EG), false);

  /*
   * Die Schwelle liegt bei der Hälfte. Von Hand: Steht oben eine der vier
   * Wände, fehlen drei — 3 > 1, also fragen. Stehen zwei, fehlen zwei —
   * 2 > 2 ist falsch, also nicht fragen: Wer oben schon die halbe Hülle
   * gezogen hat, arbeitet dort von Hand, und ein Vorschlag wäre Drängeln.
   */
  const eineDa = mitOgWand(0);
  check('Eine von vier steht oben schon: ja', uebernahmeSinnvoll(eineDa.walls, eineDa.nodes, EG, OG), true);

  const haus3 = pruefhaus();
  const sued = ogWand('og-w0', { id: 'og-n0', x: 0, y: 0 }, { id: 'og-n1', x: 10, y: 0 });
  const ost = ogWand('og-w1', { id: 'og-n1', x: 10, y: 0 }, { id: 'og-n2', x: 10, y: 8 });
  const zweiDa: Geschosse = {
    walls: [...haus3.walls, sued.wall, ost.wall],
    nodes: { ...haus3.nodes, ...sued.nodes, ...ost.nodes },
  };
  check('Zwei von vier stehen oben schon: nein', uebernahmeSinnvoll(zweiDa.walls, zweiDa.nodes, EG, OG), false);
  // Zur Gegenprobe, dass die Zahl stimmt und nicht nur das Urteil:
  check('… von Hand: zwei liegen da, zwei fehlen', `${plane(zweiDa).schonDa}/${plane(zweiDa).neueWaende.length}`, '2/2');

  // =========================================================================
  // H — Was mitwandert und was nicht
  // =========================================================================

  const kopieSued = plan.neueWaende[0];
  const kopieOst = plan.neueWaende[1];

  check('Der Bauteilaufbau wandert mit', plan.neueWaende.every((w) => w.constructionId === 'aw-365'), true);
  check('Die Stärke wandert mit', angabe(kopieSued.thickness), 0.365);
  check('Die Zeichenebene wandert mit', angabe(kopieSued.layerId), 'ebene-waende');
  check('Der Wandtyp wandert mit', angabe(kopieSued.type), 'exterior');

  /*
   * Die Höhe kommt aus dem Zielgeschoss: 2,50 m und nicht die 2,75 m der
   * Vorlage. Beide Zahlen stehen hier nebeneinander, weil erst die zweite
   * Zeile den Fehler ausschließt, bei dem zufällig beide gleich wären.
   */
  check('Die Höhe kommt aus dem Zielgeschoss', plan.neueWaende.every((w) => w.height === HOEHE_OG), true);
  check('… und ausdrücklich nicht aus der Vorlage', plan.neueWaende.some((w) => w.height === HOEHE_EG), false);

  /*
   * Das Kennzeichen „Stärke geschätzt" gehört zur Stärke und wandert mit.
   * Ohne es sähe die Kopie aus wie ein gesetztes Maß, und der Schritt
   * „Wandstärken bestätigen" wäre für sie stillschweigend erledigt. Es steht
   * nur an der Südwand — die Ostwand muss es deshalb weiterhin nicht haben,
   * sonst wäre es erfunden statt übernommen.
   */
  check('Die geschätzte Stärke bleibt als geschätzt gekennzeichnet', angabe(kopieSued.thicknessEstimated), true);
  check('… und wird nirgends erfunden', angabe(kopieOst.thicknessEstimated), 'fehlt');

  /*
   * Und die Felder, die nicht mitdürfen. Der U-Wert steht an der Vorlage
   * (0,24) — mitkopiert wäre er von einem gemessenen nicht zu unterscheiden.
   * `material` und `locked` sind Angaben über genau diese Wand.
   */
  check('Der U-Wert der Vorlage wandert nicht mit', angabe(kopieSued.uValue), 'fehlt');
  check('Das Material wandert nicht mit', angabe(kopieOst.material), 'fehlt');
  check('Die Sperre der Vorlagewand wandert nicht mit', angabe(kopieOst.locked), 'fehlt');

  const eckeNull = plan.neueKnoten.find((k) => punktwort(k) === '0|0');
  check('Die Ecke (0|0) ist im Plan', eckeNull !== undefined, true);
  check('… und die Sperre des Vorlageknotens wandert nicht mit', angabe(eckeNull?.locked), 'fehlt');
}
