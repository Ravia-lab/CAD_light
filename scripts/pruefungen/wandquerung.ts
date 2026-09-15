/**
 * Prüfblock „Wandquerung" — das Loch, das bis 1.25.0 niemand bestellt hat.
 *
 * **Worum es geht.** Eine ausgelegte Trasse läuft durch das Haus, und an
 * jeder Wand, die sie kreuzt, muss jemand bohren. `src/lib/wandquerung.ts`
 * findet diese Kreuzungen, wirft die weg, die durch eine Tür laufen, fasst
 * die zusammen, die sich ein Loch teilen, und schlägt für jede übrige ein
 * Regelmaß vor. `src/lib/doppelleitung.ts` liefert den Grund, warum
 * zusammengefasst werden muss: Vor- und Rücklauf liegen 5 cm nebeneinander,
 * und zwei Kernbohrungen im Abstand von 5 cm sind in einer 11,5er Wand kein
 * Durchbruch mehr, sondern ein Loch mit einem Steg in der Mitte.
 *
 * **Warum es diesen Block gibt.** Drei der Entscheidungen hier sind
 * unsichtbar, solange sie stimmen, und teuer, sobald sie kippen:
 *
 *  • Eine Querung **in** einer Tür darf kein Loch erzeugen. Ohne diese Regel
 *    stünde an jedem Durchgang eine Kernbohrung; ein Auszug mit fünfzig
 *    erfundenen Positionen wird nicht gelesen, sondern weggelegt — und mit
 *    ihm die zehn echten.
 *  • Bei runder Form ist `sillHeight` die **Achshöhe**, bei rechteckiger die
 *    **Unterkante** (so steht es am Feld in `types/bim.ts`). Wer das
 *    verwechselt, legt jede Bohrung um einen halben Durchmesser tief — im
 *    Bild läuft die Leitung dann durch die Wand statt durch das Loch, und
 *    auf der Baustelle wird nach dem falschen Riss gebohrt.
 *  • `kernbohrungFuer` liefert `undefined`, wenn der Katalog nichts hergibt.
 *    Eine zu kleine Krone stillschweigend einzutragen wäre schlimmer als gar
 *    keine — deshalb wird hier auch gezählt, dass der Fall als Hinweis
 *    herauskommt und nicht als Durchbruch.
 *
 * **Die Sollwerte stehen von Hand da.** Eine Prüfung, die ihre Erwartung aus
 * derselben Rechnung holt, die sie prüft, bestätigt nur, dass die Rechnung
 * sich selbst gleicht. Das Prüfhaus ist deshalb so gebaut, dass jede Zahl im
 * Kopf nachzurechnen ist: eine waagerechte 5,00-m-Wand von (0|0) nach (5|0),
 * eine Tür bei 2,00 m, 1,00 m breit, und eine Leitung, deren Außenmaß glatt
 * 50 mm ist (32 mm Rohr + 2 × 9 mm Dämmung). Damit ist der halbe Querschnitt
 * 25 mm — die Zahl, die über dem Sturz den Ausschlag gibt.
 *
 * **Warum die Wand schräg nicht nötig ist.** Anders als bei den Griffen geht
 * hier keine Richtung in das Ergebnis ein: Gesucht ist ein Abstand auf der
 * Wandachse, und der ist von der Lage der Wand unabhängig. Eine schräge Wand
 * brächte nur krumme Erwartungswerte und keine zusätzliche Aussage.
 *
 * **Was dieser Block nicht prüft.** Ob an dieser Stelle gebohrt werden
 * *darf* — das ist eine Frage an den Tragwerksplaner und keine, die ein
 * Programm aus einer Wandstärke beantwortet. Und wie der Durchbruch
 * gezeichnet wird; das hat mit `durchbrueche` einen eigenen Prüfblock.
 */

import type { CheckFn } from './typ';
import type {
  BimDocument,
  BimNode,
  Level,
  Opening,
  PipeRun,
  Vec2,
  Wall,
} from '../../src/types/bim';
import { emptyPlant, emptySite } from '../../src/lib/plantDefaults';
import { trassenlaenge } from '../../src/lib/rohrlaenge';
import {
  QUERUNG_HOEHENFENSTER,
  QUERUNG_LUFT,
  QUERUNG_MINDESTMASS,
  QUERUNG_ZUSAMMEN,
  aussenmass,
  durchbruchAusStelle,
  durchbruecheFuerTrassen,
  kernbohrungFuer,
  querungsstellen,
  wandquerungen,
} from '../../src/lib/wandquerung';
import { PAARABSTAND, bildePaar, partnerVon, versetzeQuer } from '../../src/lib/doppelleitung';
import type { Auslegungstemperatur } from '../../src/lib/systemtemperatur';
import { HEIZKOERPER_MINDEST, kreistemperatur } from '../../src/lib/systemtemperatur';
import { BELAG_GRENZE, BODENBELAEGE, belagNach, belagsWiderstand } from '../../src/lib/bodenbelag';

// ---------------------------------------------------------------------------
// Kleinkram
// ---------------------------------------------------------------------------

/**
 * Auf Millimeter runden.
 *
 * Ein Durchbruch wird auf den Zentimeter angerissen; der Millimeter ist hier
 * nur die Stelle, an der eine falsche Formel noch auffällt, während
 * Gleitkommarauschen (32 · 1,15 / 1000 = 0,036800000000000006) schon
 * herausfällt.
 */
const r3 = (v: number): number => Math.round(v * 1000) / 1000;

/** Ein Temperaturpaar als ein Wort — „50/40" liest sich im Protokoll wie im Blatt. */
const paar = (t: Auslegungstemperatur): string => `${t.vorlauf}/${t.ruecklauf}`;

/** Ein Punkt als ein Wort, auf Millimeter — damit beide Koordinaten in einer Zeile stehen. */
const punktwort = (p: Vec2): string => `${r3(p.x)}|${r3(p.y)}`;

const EBENE = 'eg';

/**
 * Eine Leitung über die übergebenen Stützpunkte.
 *
 * Nennweite und Außendurchmesser sind getrennte Angaben, und das ist hier
 * der Punkt: Die **Nennweite** wählt die Krone (Abschnitt E), das
 * **Außenmaß** entscheidet, ob die Leitung noch unter den Sturz passt
 * (Abschnitt B) und wie breit der rechteckige Durchbruch wird (Abschnitt D).
 * Mit 32 mm Rohr und 9 mm Dämmung ist das Außenmaß glatt 50 mm — jede
 * Erwartung unten lässt sich damit ohne Taschenrechner nachrechnen.
 */
function leitung(id: string, points: Vec2[], hoehe: number, nennweite = 20): PipeRun {
  return {
    id,
    levelId: EBENE,
    service: 'heating-flow',
    points,
    nominalDiameter: nennweite,
    outerDiameter: 32,
    insulation: 9,
    elevation: hoehe,
  };
}

/**
 * Ein Prüfhaus mit genau einer Wand: (0|0) → (5|0), 11,5 cm stark.
 *
 * **Eine Wand und sonst nichts, und das ist Absicht.** `wandquerungen` läuft
 * über alle Wände des Dokuments; ein vollständiger Grundriss brächte weitere
 * Kreuzungen ins Spiel, die mit der geprüften Aussage nichts zu tun haben —
 * und damit Gründe, aus denen eine Prüfung scheitern kann, ohne dass an der
 * Querung etwas falsch wäre. Räume gibt es aus demselben Grund keine: Weder
 * die Querung noch der Durchbruch lesen die Raumtabelle.
 */
function haus(...oeffnungen: readonly Opening[]): BimDocument {
  const eg: Level = {
    id: EBENE,
    name: 'EG',
    order: 0,
    elevation: 0,
    height: 2.75,
    floorUValue: 0.35,
    floorBoundary: 'ground',
    ceilingUValue: 0.2,
    ceilingBoundary: 'unheated',
  };
  const a: BimNode = { id: 'na', x: 0, y: 0, levelId: EBENE };
  const b: BimNode = { id: 'nb', x: 5, y: 0, levelId: EBENE };
  const wand: Wall = {
    id: 'w1',
    levelId: EBENE,
    a: a.id,
    b: b.id,
    thickness: 0.115,
    height: 2.75,
    type: 'interior',
    layerId: 'layer-walls',
  };

  return {
    site: emptySite(),
    plant: emptyPlant(),
    meta: {
      name: 'Prüfhaus Wandquerung',
      createdAt: '2026-01-01T00:00:00.000Z',
      modifiedAt: '2026-01-01T00:00:00.000Z',
      northAngle: 0,
      designOutdoorTemperature: -12,
      designIndoorTemperature: 20,
      n50: 1.5,
      shielding: 'moderate',
      unheatedTemperature: 10,
      groundTemperature: 10,
      thermalBridgeSupplement: 0,
      thermalBridgeMethod: 'flat',
      thermalBridgeCategory: 'custom',
      reheatFactor: 0,
    },
    levels: { [EBENE]: eg },
    layers: {},
    nodes: { [a.id]: a, [b.id]: b },
    walls: { [wand.id]: wand },
    openings: Object.fromEntries(oeffnungen.map((o) => [o.id, o])),
    fixtures: {},
    verticals: {},
    solids: {},
    durchbrueche: {},
    pipes: {},
    annotations: {},
    roofOpenings: {},
    rooms: {},
    constructions: {},
    diagnostics: { openEnds: [] },
    activeLevelId: EBENE,
  };
}

/**
 * Die Tür des Prüfhauses: Mitte bei 2,00 m, 1,00 m breit, 2,00 m hoch.
 *
 * Damit reicht die Laibung von 1,50 m bis 2,50 m und der Sturz liegt auf
 * 2,00 m — beides glatte Zahlen, die in jeder Erwartung unten wieder
 * auftauchen.
 */
const TUER: Opening = {
  id: 'tuer',
  wallId: 'w1',
  kind: 'door',
  distance: 2,
  width: 1,
  height: 2,
  sillHeight: 0,
};

// ---------------------------------------------------------------------------
// Die Prüfungen
// ---------------------------------------------------------------------------

export function pruefeWandquerung(check: CheckFn): void {
  // === A — Wo eine Leitung die Wandachse kreuzt ===========================
  //
  // Wand (0|0) → (5|0), Leitung (2|−1) → (2|1). Die Leitung steht senkrecht
  // auf der Wand und trifft sie bei x = 2,00 — der Abstand ab Knoten a ist
  // damit 2,000 m, und zwar unabhängig davon, in welcher Richtung die
  // Leitung gezogen wurde.
  const leer = haus();
  const quer = leitung('quer', [{ x: 2, y: -1 }, { x: 2, y: 1 }], 0.6);
  const treffer = wandquerungen(leer, [quer]);
  check('Die senkrecht kreuzende Leitung liefert genau eine Querung', treffer.length, 1);
  check('… bei 2,000 m ab Knoten a', r3(treffer[0]?.distance ?? -1), 2);
  check('… am Punkt (2|0)', punktwort(treffer[0]?.punkt ?? { x: -1, y: -1 }), '2|0');
  check('… auf Verlegehöhe 0,600 m', r3(treffer[0]?.hoehe ?? -1), 0.6);
  check('… an der Wand w1', treffer[0]?.wallId ?? 'fehlt', 'w1');
  check('… und sie trägt die Kennung ihrer Leitung', treffer[0]?.runId ?? 'fehlt', 'quer');

  /*
   * Das Außenmaß, das durch die Wand muss: 32 mm Rohr + 2 × 9 mm Dämmung =
   * 50 mm. Nicht die Nennweite (20 mm) und nicht der Rohrdurchmesser allein —
   * gebohrt wird für das, was tatsächlich hindurchgeschoben wird.
   */
  check('Das Außenmaß ist Rohr plus zweimal Dämmung', r3(aussenmass(quer)), 0.05);
  check('Die Nennweite steht daneben und ist nicht dasselbe', treffer[0]?.nennweite ?? -1, 20);

  // Eine Leitung, die vor der Wand endet: (2|−1) → (2|−0,5). Der Schnittpunkt
  // der *Geraden* läge weiterhin bei (2|0) — nur liegt er nicht mehr auf dem
  // Stück. Wer hier Geraden statt Strecken schneidet, bohrt Löcher für
  // Leitungen, die einen halben Meter vorher aufhören.
  const kurz = leitung('kurz', [{ x: 2, y: -1 }, { x: 2, y: -0.5 }], 0.6);
  check('Eine Leitung, die die Wand nicht erreicht, quert sie nicht', wandquerungen(leer, [kurz]).length, 0);

  // Eine Leitung parallel zur Wand — der Regelfall der Sockelleiste. Sie
  // läuft die Wand entlang und geht nirgends hindurch; rechnerisch ist das
  // der Fall, in dem eine Schnittpunktformel durch null teilt.
  const parallel = leitung('parallel', [{ x: 0.5, y: 0 }, { x: 4.5, y: 0 }], 0.6);
  check('Eine Leitung auf der Wandachse quert nichts', wandquerungen(leer, [parallel]).length, 0);
  // Und dieselbe Leitung 10 cm daneben ebenso wenig.
  const daneben = leitung('daneben', [{ x: 0.5, y: 0.1 }, { x: 4.5, y: 0.1 }], 0.6);
  check('Eine Leitung parallel neben der Wand auch nicht', wandquerungen(leer, [daneben]).length, 0);

  // === B — Die Querung in der Tür =========================================
  //
  // Tür bei 2,00 m, 1,00 m breit (Laibung 1,50 … 2,50 m), Sturz auf 2,00 m.
  // Die Leitung ist 50 mm dick, ihr halber Querschnitt also 25 mm.
  const mitTuer = haus(TUER);

  // Die Anbindung am Sockel: 0,05 m über Fertigfußboden, quer durch die
  // Türöffnung. Unterkante 0,05 − 0,025 = 0,025 m über dem Boden, Oberkante
  // 0,075 m — beides innerhalb der Öffnung. Hier wird nicht gebohrt.
  const durchTuer = leitung('t1', [{ x: 2, y: -1 }, { x: 2, y: 1 }], 0.05);
  check('Die Leitung im Türdurchgang liegt in der Öffnung', wandquerungen(mitTuer, [durchTuer])[0]?.inOeffnung ?? 'fehlt', true);

  // Dieselbe Leitung 2,00 m weiter: bei 4,00 m ist die Tür 1,50 m entfernt,
  // also weit außerhalb ihrer halben Breite von 0,50 m. Dort wird gebohrt.
  const nebenTuer = leitung('t2', [{ x: 4, y: -1 }, { x: 4, y: 1 }], 0.05);
  check('Zwei Meter weiter liegt sie nicht mehr in der Öffnung', wandquerungen(mitTuer, [nebenTuer])[0]?.inOeffnung ?? 'fehlt', false);

  // An derselben Stelle, aber unter der Decke: 2,50 m liegt über dem Sturz
  // von 2,00 m. Über der Tür steht wieder Mauerwerk, und es wird gebohrt.
  const ueberSturz = leitung('t3', [{ x: 2, y: -1 }, { x: 2, y: 1 }], 2.5);
  check('Über dem Sturz liegt sie nicht in der Öffnung', wandquerungen(mitTuer, [ueberSturz])[0]?.inOeffnung ?? 'fehlt', false);

  /*
   * Der Fall, auf den es ankommt, und der Grund für das halbe Außenmaß in
   * der Rechnung: eine Achse bei 1,990 m — also noch unter dem Sturz von
   * 2,000 m — aber mit 25 mm Radius. Die Oberkante liegt bei 2,015 m und
   * damit 15 mm im Sturz. Wer nur die Achse prüft, hält das für eine
   * Durchführung durch die Tür, lässt die Bohrung weg und schickt eine
   * Leitung durch den Türsturz.
   */
  const halbImSturz = leitung('t4', [{ x: 2, y: -1 }, { x: 2, y: 1 }], 1.99);
  check('Zur Hälfte im Sturz ist nicht „in der Öffnung"', wandquerungen(mitTuer, [halbImSturz])[0]?.inOeffnung ?? 'fehlt', false);
  // Die Gegenprobe zwei Zentimeter tiefer: Achse 1,970 m, Oberkante 1,995 m —
  // ganz unter dem Sturz, und damit wieder eine Durchführung ohne Bohrung.
  const knappDarunter = leitung('t5', [{ x: 2, y: -1 }, { x: 2, y: 1 }], 1.97);
  check('… zwei Zentimeter tiefer passt sie wieder ganz hinein', wandquerungen(mitTuer, [knappDarunter])[0]?.inOeffnung ?? 'fehlt', true);

  /*
   * Und derselbe Fall um neunzig Grad gedreht — an der **Laibung** statt am
   * Sturz. Die Öffnungsmitte liegt bei 2,000 m, die Tür ist 1,00 m breit,
   * die Laibung steht also bei 1,500 m und 2,500 m.
   *
   * Eine Leitung bei 2,490 m ist von der Mitte 0,490 m entfernt; mit 0,025 m
   * halbem Außenmaß reicht ihre Außenkante bis 0,515 m und damit 15 mm über
   * die halbe Türbreite von 0,500 m hinaus. Die Achse liegt einen Zentimeter
   * **innerhalb** der Tür, das Rohr steckt trotzdem im Mauerwerk.
   *
   * Solange hier nur die Achse verglichen wurde, galt das als „durch die Tür
   * geführt": Es entstand kein Durchbruch, also wurde nicht gebohrt, und auf
   * der Baustelle lag eine Leitung vor einer Wand, durch die sie nicht
   * passt. Waagerecht gilt jetzt dieselbe Regel wie senkrecht — der ganze
   * Querschnitt muss hinein.
   */
  const anDerLaibung = leitung('t6', [{ x: 2.49, y: -1 }, { x: 2.49, y: 1 }], 0.05);
  check('Über die Laibung ragend ist nicht „in der Öffnung"', wandquerungen(mitTuer, [anDerLaibung])[0]?.inOeffnung ?? 'fehlt', false);
  // Die Gegenprobe vier Zentimeter weiter innen: Achse 2,450 m, Außenkante
  // bei 0,450 + 0,025 = 0,475 m — also 25 mm Luft bis zur Laibung.
  const innerhalb = leitung('t7', [{ x: 2.45, y: -1 }, { x: 2.45, y: 1 }], 0.05);
  check('… vier Zentimeter weiter innen passt sie ganz hinein', wandquerungen(mitTuer, [innerhalb])[0]?.inOeffnung ?? 'fehlt', true);
  /*
   * Die Probe darauf, dass die neue Bedingung nicht die halbe Tür
   * wegschneidet: Die Anbindung in der Türmitte (Abschnitt oben, 2,000 m)
   * bleibt eine Durchführung. Zwischen ihr und der Laibung liegen 0,475 m
   * Spielraum — die Regel greift erst an der Kante, nicht schon im Feld.
   */
  check('Die Leitung in der Türmitte bleibt eine Durchführung', wandquerungen(mitTuer, [durchTuer])[0]?.inOeffnung ?? 'fehlt', true);

  // === C — Mehrere Querungen, eine Stelle =================================
  //
  // Die Fangmaße, mit denen zusammengefasst wird. Sie stehen hier als Zahl,
  // weil jede Erwartung darunter an ihnen hängt: 0,30 m auf der Wandachse
  // und 0,25 m in der Höhe.
  check('Zusammengefasst wird bis 0,30 m Abstand', QUERUNG_ZUSAMMEN, 0.3);
  check('… und bis 0,25 m Höhenunterschied', QUERUNG_HOEHENFENSTER, 0.25);

  // Vor- und Rücklauf: 5 cm auseinander, gleiche Höhe. Das ist ein Loch.
  const vor = leitung('vl', [{ x: 2, y: -1 }, { x: 2, y: 1 }], 0.6);
  const rueck = leitung('rl', [{ x: 2.05, y: -1 }, { x: 2.05, y: 1 }], 0.6);
  const paarQuerungen = wandquerungen(leer, [vor, rueck]);
  check('Das Leitungspaar ergibt zwei Querungen', paarQuerungen.length, 2);
  const eineStelle = querungsstellen(leer, paarQuerungen);
  check('… aber nur eine Stelle', eineStelle.length, 1);
  check('… mit beiden Leitungen daran', eineStelle[0]?.querungen.length ?? -1, 2);
  // Die Mitte liegt zwischen den beiden Achsen: (2,000 + 2,050)/2 = 2,025 m.
  check('… und ihre Mitte liegt bei 2,025 m', r3(eineStelle[0]?.distance ?? -1), 2.025);
  check('… auf 0,600 m Höhe', r3(eineStelle[0]?.hoehe ?? -1), 0.6);

  // Einen vollen Meter auseinander sind es zwei Wände-Durchbrüche und keine
  // gemeinsame Stelle — 1,00 m ist mehr als das Fangmaß von 0,30 m.
  const weit = leitung('weit', [{ x: 3, y: -1 }, { x: 3, y: 1 }], 0.6);
  check('Ein Meter Abstand bleiben zwei Stellen', querungsstellen(leer, wandquerungen(leer, [vor, weit])).length, 2);

  /*
   * Und dieselbe Stelle im Grundriss, aber 0,50 m höher: der Vorlauf unter
   * der Decke, die Anbindung am Sockel. Im Plan liegen sie übereinander, in
   * der Wand sind es zwei Löcher. Ohne das Höhenfenster entstünde daraus ein
   * Durchbruch auf einer Höhe, auf der keine der beiden Leitungen liegt.
   */
  const hoch = leitung('hoch', [{ x: 2, y: -1 }, { x: 2, y: 1 }], 1.1);
  check('Ein halber Meter Höhenunterschied bleiben zwei Stellen', querungsstellen(leer, wandquerungen(leer, [vor, hoch])).length, 2);

  // Eine Querung in der Öffnung fällt weg — dort wird nicht gebohrt, und
  // eine Stelle ohne Loch wäre eine Position im Auszug ohne Leistung.
  const inTuer = wandquerungen(mitTuer, [durchTuer]);
  check('Die Querung in der Tür ist eine Querung', inTuer.length, 1);
  check('… und trotzdem keine Stelle', querungsstellen(mitTuer, inTuer).length, 0);

  // === D — Aus der Stelle wird ein Durchbruch =============================
  //
  // Die Luft ringsum und das Mindestmaß, beide als Zahl, weil sie unten in
  // den Erwartungen stecken.
  check('Rund um das Rohr bleiben 4 cm Luft', QUERUNG_LUFT, 0.04);
  check('Die kleinste Kante misst 15 cm', QUERUNG_MINDESTMASS, 0.15);

  // --- D.1 Eine Leitung → Kernbohrung ------------------------------------
  const einzeln = querungsstellen(leer, wandquerungen(leer, [vor]));
  const bohrung = durchbruchAusStelle(einzeln[0], 'db-einzeln');
  check('Eine einzelne Leitung ergibt einen Durchbruch', bohrung !== null, true);
  check('… und zwar eine Kernbohrung', bohrung?.kind ?? 'fehlt', 'kernbohrung');
  check('… mit runder Form', bohrung?.form ?? 'fehlt', 'rund');
  // DN 20 → Krone Ø 68 aus dem Regelmaßkatalog (Abschnitt E).
  check('… Ø 0,068 m', r3(bohrung?.diameter ?? -1), 0.068);
  check('… und der Vermerk DN 20', bohrung?.dn ?? -1, 20);
  check('… für das Gewerk Heizung', bohrung?.service ?? 'fehlt', 'heating');
  check('… an der Wand w1 bei 2,000 m', r3(bohrung?.distance ?? -1), 2);

  /*
   * Der Punkt, an dem sich rund und rechteckig unterscheiden: Bei runder
   * Form ist `sillHeight` die **Achshöhe**, nach der angerissen wird. Die
   * Querung liegt auf 0,600 m, also steht dort 0,600 m.
   *
   * Der naheliegende Fehler wäre die Unterkante, und er wäre im Modell kaum
   * zu sehen: 0,600 − 0,068/2 = 0,566 m. Vierunddreißig Millimeter zu tief
   * sind im Plan ein Strich Unterschied — und auf der Baustelle ein Loch,
   * durch das die Leitung nicht geht.
   */
  check('Bei runder Form ist sillHeight die Achshöhe', r3(bohrung?.sillHeight ?? -1), 0.6);
  check('… und nicht die Unterkante 0,566 m', r3(bohrung?.sillHeight ?? -1) === 0.566, false);
  check('Der Durchbruch ist als erzeugt gekennzeichnet', bohrung?.generated ?? 'fehlt', true);

  // --- D.2 Zwei Leitungen → rechteckiger Wanddurchbruch -------------------
  //
  // Achsabstand 0,050 m + Außenmaß 0,050 m + 2 × 0,040 m Luft = 0,180 m,
  // aufgerundet auf 5 cm = 0,200 m. Die 0,180 m stehen hier bewusst daneben:
  // Wer statt aufzurunden abrundete, käme auf 0,150 m und damit auf einen
  // Durchbruch, der 3 cm zu schmal ist.
  const zusammen = durchbruchAusStelle(eineStelle[0], 'db-paar');
  check('Zwei Leitungen ergeben einen Wanddurchbruch', zusammen?.kind ?? 'fehlt', 'wanddurchbruch');
  check('… mit rechteckiger Form', zusammen?.form ?? 'fehlt', 'rechteckig');
  check('… 0,200 m breit (0,05 + 0,05 + 2 × 0,04 = 0,18, aufgerundet)', r3(zusammen?.width ?? -1), 0.2);
  check('… also breiter als die gerechneten 0,180 m', (zusammen?.width ?? 0) > 0.18, true);
  /*
   * Die Höhe: beide Leitungen liegen auf 0,600 m, der Höhenunterschied ist
   * also null. 0,000 + 0,050 + 2 × 0,040 = 0,130 m, aufgerundet 0,150 m —
   * und das ist zugleich das Mindestmaß. Beide Wege führen hier auf
   * dieselbe Zahl; die Zeile hält sie fest, damit die Unterkante darunter
   * nachrechenbar bleibt.
   */
  check('… und 0,150 m hoch', r3(zusammen?.height ?? -1), 0.15);
  // Bei rechteckiger Form ist `sillHeight` die **Unterkante**: die Mitte der
  // Stelle liegt auf 0,600 m, die halbe Höhe sind 0,075 m → 0,525 m.
  check('Bei rechteckiger Form ist sillHeight die Unterkante', r3(zusammen?.sillHeight ?? -1), 0.525);
  check('… und der Name nennt beide Maße in Zentimetern', zusammen?.name ?? 'fehlt', 'Wanddurchbruch 20 × 15');
  check('Auch er ist als erzeugt gekennzeichnet', zusammen?.generated ?? 'fehlt', true);
  check('… und seine Mitte liegt bei 2,025 m', r3(zusammen?.distance ?? -1), 2.025);

  // === E — Welche Krone gewählt wird ======================================
  //
  // Gewählt wird die kleinste Kernbohrung, deren **Nennweite** die der
  // Leitung erreicht — nicht die, deren Durchmesser rechnerisch passt. Die
  // drei Heizungsmaße des Katalogs, von Hand abgelesen:
  check('DN 20 bekommt die Krone Ø 68', r3(kernbohrungFuer(20, 'heating')?.diameter ?? -1), 0.068);
  check('DN 25 bekommt Ø 82', r3(kernbohrungFuer(25, 'heating')?.diameter ?? -1), 0.082);
  check('DN 32 bekommt Ø 102', r3(kernbohrungFuer(32, 'heating')?.diameter ?? -1), 0.102);
  // Dazwischen wird nicht interpoliert, sondern aufgerückt: DN 22 ist keine
  // Katalognennweite und bekommt deshalb die nächstgrößere Krone.
  check('DN 22 rückt auf Ø 82 auf', r3(kernbohrungFuer(22, 'heating')?.diameter ?? -1), 0.082);

  /*
   * Und der Fall ohne Regelmaß: Die größte Kernbohrung im Katalog ist die
   * Lüftungskrone mit DN 160. Eine Leitung DN 200 findet nichts, und dann
   * kommt `undefined` zurück — ausdrücklich nicht die größte vorhandene
   * Krone. Eine zu kleine Bohrung im Plan wäre schlimmer als gar keine: Sie
   * wird gebohrt, und danach passt die Leitung nicht hindurch.
   */
  check('Über dem Katalog gibt es kein Regelmaß', kernbohrungFuer(200, 'heating') === undefined, true);

  /*
   * Und der Fall, der bis 1.27.0 falsch lief: die Gewerksgrenze.
   *
   * Der Kronenkatalog führt für Heizung DN 20, 25 und 32. Eine
   * DN-40-Heizungsleitung findet dort nichts. Bis 1.27.0 durchsuchte die
   * Wahl daraufhin den ganzen Katalog nach Nennweite und fand die
   * **Elektrokrone** kb-elektro: DN 40, aber Ø 52 — denn DN 40 heißt bei
   * Elektro ein Leerrohr und bei Heizung ein Rohr von 48,3 mm plus Dämmung.
   * Gebohrt worden wäre Ø 52 für eine Leitung, die gedämmt gut 100 mm misst.
   *
   * Jetzt endet die Suche am eigenen Gewerk und meldet die Lücke. Der
   * Durchbruch entsteht dann nicht, sondern ein Hinweis — dieselbe Antwort
   * wie oberhalb des Katalogs, und aus demselben Grund.
   */
  check('DN 40 Heizung findet keine Krone', kernbohrungFuer(40, 'heating') === undefined, true);
  check(
    '… und greift nicht zur Elektrokrone Ø 52',
    r3(kernbohrungFuer(40, 'heating')?.diameter ?? -1) === 0.052,
    false,
  );
  // Gegenprobe: Dieselbe DN 40 im Elektrogewerk ist genau die richtige Krone.
  check('DN 40 Elektro bekommt Ø 52', r3(kernbohrungFuer(40, 'electric')?.diameter ?? -1), 0.052);

  // Die übrigen Gewerke, je einmal von Hand am Katalog abgelesen.
  check('DN 50 Sanitär bekommt Ø 127', r3(kernbohrungFuer(50, 'sanitary')?.diameter ?? -1), 0.127);
  check('DN 100 Sanitär bekommt Ø 152', r3(kernbohrungFuer(100, 'sanitary')?.diameter ?? -1), 0.152);
  check('DN 160 Lüftung bekommt Ø 162', r3(kernbohrungFuer(160, 'ventilation')?.diameter ?? -1), 0.162);
  /*
   * Der Sanitärkatalog beginnt bei DN 50. Eine DN-20-Sanitärleitung bekommt
   * deshalb Ø 127 und nicht die Heizungskrone Ø 68 — reichlich groß, aber
   * dasselbe Gewerk und derselbe Kronensatz auf dem Wagen. Das ist der
   * bewusste Preis dafür, dass über die Gewerksgrenze nicht gesucht wird.
   */
  check('DN 20 Sanitär bleibt im Sanitärsatz', r3(kernbohrungFuer(20, 'sanitary')?.diameter ?? -1), 0.127);
  /*
   * „mixed" ist kein Gewerk, sondern die Feststellung, dass mehrere beteiligt
   * sind — und mehrere Leitungen ergeben ohnehin einen rechteckigen
   * Durchbruch, keine Bohrung. Eine Krone gibt es dafür nicht.
   */
  check('Für „gemischt" gibt es keine Krone', kernbohrungFuer(20, 'mixed') === undefined, true);

  // === F — Der ganze Weg: Trassen hinein, Durchbrüche heraus ==============
  //
  // Drei Leitungen an derselben Wand, jede mit einem anderen Ausgang:
  //   • bei 1,00 m eine DN-200-Leitung  → kein Regelmaß, also ein Hinweis,
  //   • bei 2,00 m die Anbindung auf 0,05 m durch die Tür → kein Loch,
  //   • bei 4,00 m eine DN-20-Leitung   → eine Kernbohrung.
  // Die drei Stellen liegen 1,00 bzw. 2,00 m auseinander und werden deshalb
  // nicht zusammengefasst.
  let lfd = 0;
  const uid = () => `db${lfd++}`;
  const gemischt = durchbruecheFuerTrassen(
    mitTuer,
    [
      leitung('gross', [{ x: 1, y: -1 }, { x: 1, y: 1 }], 0.6, 200),
      durchTuer,
      leitung('klein', [{ x: 4, y: -1 }, { x: 4, y: 1 }], 0.6),
    ],
    uid,
  );
  check('Aus drei Querungen entsteht genau ein Durchbruch', gemischt.durchbrueche.length, 1);
  check('… und zwar der für die DN-20-Leitung bei 4,000 m', r3(gemischt.durchbrueche[0]?.distance ?? -1), 4);
  check('Eine Querung lief durch die Tür', gemischt.inOeffnung, 1);
  /*
   * Und eine fand kein Regelmaß. Die Zahl ist der Grund, warum
   * `durchbruchAusStelle` `null` zurückgeben darf: Der Aufrufer zählt den
   * Fall und meldet ihn, statt ihn wegzuwerfen. Stünde hier 0, wäre die
   * DN-200-Leitung spurlos verschwunden — sie ginge weiterhin durch die
   * Wand, nur stünde nirgends mehr, dass dort ein Loch gebraucht wird.
   */
  check('… und eine fand kein Regelmaß', gemischt.ohneRegelmass, 1);
  /*
   * Die Kennung kommt aus dem übergebenen Zähler — dieselbe Quelle wie im
   * Store, damit sich ein erzeugter Durchbruch von einem von Hand gesetzten
   * nicht unterscheidet.
   *
   * **Was diese beiden Zeilen festhalten: Der Zähler läuft nur für
   * Durchbrüche, die auch entstehen.** Von den zwei Stellen — DN 200 bei
   * 1,00 m und DN 20 bei 4,00 m — liefert die erste kein Regelmaß und
   * bekommt deshalb gar keine Kennung mehr. Der einzige Durchbruch trägt
   * `db0`, und `uid()` wurde genau einmal gezogen.
   *
   * Eine Fassung, die die Kennung **je Stelle** zieht, bevor feststeht, ob
   * daraus ein Durchbruch wird, verbraucht `db0` an der DN-200-Stelle und
   * gibt dem einzigen Loch `db1`. Die Nummern haben dann Lücken — für sich
   * harmlos, aber eine Falle für jeden, der aus der höchsten Nummer auf die
   * Zahl der Durchbrüche schließt; er zählt einen zu viel. Genau gegen
   * diesen Rückfall stehen die beiden Zeilen hier: `db0` statt `db1` und
   * ein Zählerstand von 1 statt 2.
   */
  check('Die Kennung kommt aus dem übergebenen Zähler', gemischt.durchbrueche[0]?.id ?? 'fehlt', 'db0');
  check('… und der Zähler lief nur für den Durchbruch, der auch entsteht', lfd, 1);

  // === G — Vor- und Rücklauf als ein Bauteil ==============================
  //
  // Der Achsabstand, an dem alles darunter hängt: 50 mm zwischen den Rohren,
  // jedes also 25 mm von der gezeichneten Mitte.
  check('Der Achsabstand der Doppelleitung beträgt 0,05 m', PAARABSTAND, 0.05);

  /*
   * Der gezeichnete Zug ist die **Mitte**, nicht der Vorlauf. Wer an einer
   * Wand entlangreißt, meint die Trasse; bliebe der gezeichnete Zug als
   * Vorlauf stehen, läge der Rücklauf 5 cm weiter im Raum als angerissen —
   * im Sockelleistenkanal ist das der Unterschied zwischen „passt" und
   * „passt nicht".
   *
   * Waagerechter Zug (0|0) → (4|0), Laufrichtung +x. Die linke Seite ist
   * damit +y: Der Zug selbst wandert auf y = +0,025, sein Partner auf
   * y = −0,025.
   */
  const mitte = leitung('mitte', [{ x: 0, y: 0 }, { x: 4, y: 0 }], 0.6);
  const laengeVorher = r3(trassenlaenge(mitte.points));
  const partner = bildePaar(mitte, 'partner', 'paar-1');

  check('Der gezeichnete Zug wandert auf y = +0,025', punktwort(mitte.points[0]), '0|0.025');
  check('… über seine ganze Länge', punktwort(mitte.points[1]), '4|0.025');
  check('Der Partner liegt auf y = −0,025', punktwort(partner.points[0]), '0|-0.025');
  check('… ebenfalls über die ganze Länge', punktwort(partner.points[1]), '4|-0.025');
  // Zusammen sind es die 50 mm von oben: 0,025 + 0,025.
  check('Zwischen den Achsen liegen 0,050 m', r3(partner.points[0].y - mitte.points[0].y), -0.05);

  check('Beide tragen dieselbe Paarkennung', mitte.pairId ?? 'fehlt', 'paar-1');
  check('… der Partner auch', partner.pairId ?? 'fehlt', 'paar-1');
  check('… und die Kennungen selbst bleiben verschieden', mitte.id === partner.id, false);
  check('Der gezeichnete Zug ist der Vorlauf', mitte.service, 'heating-flow');
  check('… und der Partner der Rücklauf', partner.service, 'heating-return');

  /*
   * Die Länge: Der Versatz ist eine reine Parallelverschiebung, also bleibt
   * jede Trasse 4,000 m lang. Würde quer statt senkrecht versetzt — ein
   * vertauschtes Vorzeichenpaar in der Normalen genügt —, stünden die
   * Stützpunkte auf (0,025|0) und (4,025|0), und die Trasse wäre weiterhin
   * 4,000 m lang. Deshalb prüft der Block oben die Koordinaten und hier die
   * Länge: Erst beides zusammen schließt den Fall aus.
   */
  check('Die Trasse war vorher 4,000 m lang', laengeVorher, 4);
  check('Der versetzte Zug ist genauso lang', r3(trassenlaenge(mitte.points)), 4);
  check('… und der Partner auch', r3(trassenlaenge(partner.points)), 4);

  // Den Partner wiederfinden — das ist der Sinn der Kennung.
  const bestand: Record<string, PipeRun> = { [mitte.id]: mitte, [partner.id]: partner };
  check('Der Partner des Vorlaufs ist der Rücklauf', partnerVon(bestand, mitte)?.id ?? 'fehlt', 'partner');
  check('… und umgekehrt', partnerVon(bestand, partner)?.id ?? 'fehlt', 'mitte');
  /*
   * Eine Leitung ohne Paarkennung hat keinen Partner — und bekommt
   * `undefined`, nicht die erstbeste Leitung. Zwei Leitungen, die zufällig
   * 5 cm nebeneinander liegen, sind zwei Leitungen; erst die Kennung macht
   * daraus ein Bauteil.
   */
  const allein = leitung('allein', [{ x: 0, y: 3 }, { x: 4, y: 3 }], 0.6);
  check('Ohne Paarkennung gibt es keinen Partner', partnerVon({ ...bestand, allein }, allein) === undefined, true);

  // Ein einzelner Stützpunkt lässt sich nicht versetzen — es gibt keine
  // Richtung, quer zu der das ginge. Der Punkt bleibt, wo er ist.
  const einPunkt = versetzeQuer([{ x: 1, y: 2 }], 1);
  check('Ein einzelner Stützpunkt bleibt liegen', punktwort(einPunkt[0]), '1|2');

  // === H — Womit ein Heizkörperkreis mindestens fährt =====================
  //
  // Die Tabelle von Hand abgelesen. Sie ist eine **Untergrenze** je
  // Vorhaben: Im Neubau wählt man das Gerät zur Temperatur, im Bestand hängt
  // der Heizkörper schon an der Wand und die Temperatur folgt ihm.
  check('Neubau: mindestens 50/40', paar(HEIZKOERPER_MINDEST.neubau), '50/40');
  check('Teilsanierung: mindestens 50/40', paar(HEIZKOERPER_MINDEST.teilsanierung), '50/40');
  check('Sanierung: mindestens 55/45', paar(HEIZKOERPER_MINDEST.sanierung), '55/45');
  /*
   * Der unsanierte Bestand: 75/60.
   *
   * Das ist der Fall, den ein Werkzeug für die Wärmepumpensanierung am
   * leichtesten vergisst — das Haus, an dem nichts gemacht wird. Ein
   * Heizkörper, der auf 75/60 ausgelegt wurde, gibt bei 55/45 nach
   * DIN EN 442-2 nur noch rund 60 Prozent ab. Wer die Anlage mit 55/45
   * nachrechnet, obwohl sie mit 75/60 läuft, hält jeden Raum für
   * unterversorgt und legt das Rohrnetz auf den doppelten Volumenstrom aus.
   */
  check('Bestand: mindestens 75/60', paar(HEIZKOERPER_MINDEST.bestand), '75/60');
  check('Mehr Vorhaben als diese vier gibt es nicht', Object.keys(HEIZKOERPER_MINDEST).length, 4);

  // Am Anlagenblatt steht 35/28 — der übliche Auslegungspunkt einer
  // Wärmepumpe mit Flächenheizung. Ein Heizkörper wird davon nicht größer.
  const blatt3528: Auslegungstemperatur = { vorlauf: 35, ruecklauf: 28 };
  check('Heizkörper im Neubau: 35/28 werden auf 50/40 angehoben', paar(kreistemperatur('heizkoerper', blatt3528, 'neubau')), '50/40');
  check('… in der Teilsanierung ebenso', paar(kreistemperatur('heizkoerper', blatt3528, 'teilsanierung')), '50/40');
  check('… und in der Sanierung auf 55/45', paar(kreistemperatur('heizkoerper', blatt3528, 'sanierung')), '55/45');
  /*
   * Ohne festgelegtes Vorhaben bleibt es bei 50/40. Ein Projekt aus der Zeit
   * vor dem Feld kennt es nicht, und aus seinem Fehlen „Sanierung" zu
   * schließen hieße raten — mit 55/45 statt 50/40 stünde in einem Neubau
   * eine Vorlauftemperatur, die niemand eingetragen hat.
   */
  check('Ohne Vorhaben gilt weiterhin 50/40', paar(kreistemperatur('heizkoerper', blatt3528)), '50/40');

  // Eine Flächenheizung bleibt bei dem, was im Anlagenblatt steht — in jedem
  // Vorhaben. Die Mindesttabelle gilt dem Heizkörper und sonst niemandem.
  check('Fläche im Neubau: 35/28 bleiben 35/28', paar(kreistemperatur('flaeche', blatt3528, 'neubau')), '35/28');
  check('… in der Teilsanierung ebenso', paar(kreistemperatur('flaeche', blatt3528, 'teilsanierung')), '35/28');
  check('… und in der Sanierung ebenso', paar(kreistemperatur('flaeche', blatt3528, 'sanierung')), '35/28');
  check('… und ohne Vorhaben auch', paar(kreistemperatur('flaeche', blatt3528)), '35/28');

  /*
   * Die Gegenrichtung, und der Satz, der die Tabelle richtig einordnet:
   * Steht am Anlagenblatt 70/55 — der Altbau mit seinen Gussgliedern —, so
   * bleibt es dabei. Die Tabelle ist eine Untergrenze und keine Vorgabe; sie
   * hebt an, sie deckelt nicht. Würde hier auf 55/45 heruntergerechnet, bekäme
   * ein Bestandshaus eine um 15 K zu niedrige Auslegung und Heizflächen, die
   * nicht warm werden.
   */
  const blatt7055: Auslegungstemperatur = { vorlauf: 70, ruecklauf: 55 };
  check('70/55 im Blatt schlagen die Sanierungsgrenze 55/45', paar(kreistemperatur('heizkoerper', blatt7055, 'sanierung')), '70/55');
  check('… und erst recht die Neubaugrenze 50/40', paar(kreistemperatur('heizkoerper', blatt7055, 'neubau')), '70/55');
  /*
   * Vorlauf und Rücklauf werden einzeln verglichen, nicht als Paar. Blatt
   * 60/38 in der Sanierung (55/45): Der Vorlauf kommt vom Blatt, der
   * Rücklauf aus der Tabelle → 60/45. Wer das Paar als Ganzes nähme, käme
   * auf 60/38 und damit auf 22 K Spreizung statt 15 K — also auf zwei Drittel
   * des Volumenstroms und reihenweise eine Nennweite zu wenig.
   */
  check('Vorlauf und Rücklauf werden einzeln angehoben', paar(kreistemperatur('heizkoerper', { vorlauf: 60, ruecklauf: 38 }, 'sanierung')), '60/45');

  // === I — Der Bodenbelag unter der Flächenheizung ========================
  //
  // Acht Einträge, jede Kennung genau einmal. Eine doppelte Kennung fiele
  // sonst nirgends auf: `belagNach` fände die erste, die Auswahlliste zeigte
  // beide, und je nachdem, welche der Anwender anklickt, stünde ein anderer
  // Widerstand im Modell.
  check('Die Auswahlliste hat acht Einträge', BODENBELAEGE.length, 8);
  check('… und jede Kennung kommt genau einmal vor', new Set(BODENBELAEGE.map((b) => b.id)).size, 8);
  check(
    'Jeder Eintrag wird über seine Kennung gefunden',
    BODENBELAEGE.every((b) => belagNach(b.id)?.id === b.id),
    true,
  );
  check('Ohne Kennung gibt es keinen Belag', belagNach(undefined) === undefined, true);

  /*
   * Der dickste Teppich liegt genau auf der Grenze aus DIN EN 1264-3: Für
   * einen höheren Belagswiderstand darf eine Flächenheizung nicht ausgelegt
   * werden. Beide Zahlen stehen hier nebeneinander, weil sie zusammengehören
   * und trotzdem in zwei Dateienabschnitten stehen — verschiebt jemand die
   * eine, fällt es hier auf.
   */
  check('Teppich dick trägt 0,15 m²·K/W', belagsWiderstand('teppich-dick') ?? -1, 0.15);
  check('… und das ist genau die Auslegungsgrenze', belagsWiderstand('teppich-dick') === BELAG_GRENZE, true);
  check('Estrich ohne Belag trägt null', belagsWiderstand('estrich') ?? -1, 0);

  /*
   * Und der Fall, der den Unterschied macht: Eine unbekannte Kennung ergibt
   * `undefined` und ausdrücklich **nicht** null. Null heißt „blanker
   * Estrich" und ist eine gültige Angabe; `undefined` heißt „nichts
   * erfasst". Wer beides gleichsetzt, legt eine Flächenheizung unter Teppich
   * so aus, als läge sie unter Fliesen — und liegt um rund ein Drittel
   * daneben, ohne dass irgendwo eine Meldung entsteht.
   */
  check('Eine unbekannte Kennung ergibt keinen Wert', belagsWiderstand('gibtsnicht') === undefined, true);
  check('… und ausdrücklich nicht null', belagsWiderstand('gibtsnicht') === 0, false);
  check('„Nichts erfasst" und „kein Belag" sind zweierlei', belagsWiderstand('gibtsnicht') === belagsWiderstand('estrich'), false);
}
