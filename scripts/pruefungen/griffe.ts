/**
 * Prüfblock „Griffe" — was man in der 3D-Ansicht anfassen kann.
 *
 * **Worum es geht.** `src/lib/griffe.ts` beschreibt, welche Anfasspunkte ein
 * Bauteil hergibt, welchen Wert jeder trägt, wie weit er gehen darf und was
 * eine Änderung im Modell bedeutet. Das Modul ändert selbst nichts — es
 * liefert eine Beschreibung, die der Betrachter zeichnet und die der Speicher
 * anwendet. Genau deshalb lässt sich hier alles prüfen, was am Griff
 * fachlich ist, ohne eine Oberfläche zu starten.
 *
 * **Warum dieser Block überhaupt nötig ist.** Ein Griff hat eine Eigenschaft,
 * die kein Eingabefeld hat: Er zeigt einen Wert *und* verspricht, ihn zu
 * ändern. Geht beides auseinander, merkt es niemand — man zieht, die Zahl am
 * Griff wandert, im Modell passiert etwas anderes oder nichts. Ein falsches
 * Eingabefeld schreibt wenigstens in das Feld, auf dem es steht. Der
 * Rundlauf in Abschnitt F ist deshalb die wichtigste Prüfung hier: Griff
 * holen → ändern → Änderung von Hand anwenden → Griff erneut holen → trägt
 * er jetzt den neuen Wert? Ein Griff, der etwas anzeigt, das er nicht
 * ändert, fällt genau dort durch und sonst nirgends.
 *
 * **Die Sollwerte stehen von Hand da.** Eine Prüfung, die ihre Erwartung aus
 * derselben Rechnung holt, die sie prüft, bestätigt nur, dass die Rechnung
 * sich selbst gleicht. Das Prüfhaus ist deshalb so gebaut, dass jede Zahl im
 * Kopf nachzurechnen ist: eine 6,00-m-Wand, Fenster auf 2,00 m und 4,00 m,
 * je 1,00 m breit — dann ist die größtmögliche Breite 2,90 m, und das steht
 * unten als 2,9 da und nicht als `2 * (d - grenze)`. Die schräge Wand ist ein
 * 3-4-5-Dreieck (3,00 m nach Osten, 4,00 m nach Norden, 5,00 m lang), damit
 * die Knotenlage nach dem Kürzen auf 4,00 m eine glatte Zahl ist: (12,400 |
 * 3,200). An einer achsparallelen Wand fiele ein Vorzeichenfehler in der
 * Richtung gar nicht auf — deshalb ist sie schräg.
 *
 * **Ein offener Befund steht in Abschnitt G**: `wertAusZug` rastert nicht die
 * *Änderung*, sondern den *Absolutwert*. Ein Zug quer zur Griffachse — und
 * ebenso ein Zug der Länge null — verschiebt damit jedes Maß, das nicht
 * ohnehin auf dem Raster liegt, um bis zu einen halben Rasterschritt. Das
 * trifft 12 der 15 Öffnungen aus `OPENING_PRESETS`, also die Katalogmaße
 * nach DIN 18100. Die Prüfungen dort schreiben den **tatsächlichen** Stand
 * fest und sind als BEFUND gekennzeichnet, damit der Lauf grün bleibt und
 * die Lücke trotzdem niemandem entgeht. (Die Zahl stand hier bis zuletzt als
 * „14 von 16" und war bei beiden Werten falsch — genau deshalb zählt sie
 * Abschnitt K jetzt nach, statt sie nur zu behaupten.)
 *
 * **Die Abschnitte H bis K** decken den zweiten Bauabschnitt des Moduls ab:
 * die Obergrenze der Öffnungsbreite bei sehr dichten Nachbarn (H), das
 * Übertragen eines Maßes auf gleichartige Wände (I) und auf gleichartige
 * Öffnungen (J) und die nachgezählte Zahl aus dem Modulkopf (K). Zwei
 * weitere offene Befunde stehen in H — beide betreffen den 5-cm-Rand an der
 * Ecke und sind an Ort und Stelle im Kasten begründet.
 *
 * **Was dieser Block nicht prüft.** Wie ein Griff *gezeichnet* wird und wie
 * er sich anfühlt — Kugelgröße, Trefferfläche, Zeigerführung. Das ist Sache
 * des Betrachters und der Zeigereingabe und hat dort eigene Prüfblöcke.
 * Geprüft wird hier ausschließlich die Beschreibung: Lage, Achse, Wert,
 * Grenzen und die Änderung, die daraus folgt.
 */

import type { CheckFn } from './typ';
import type {
  BimDocument,
  BimNode,
  Fixture,
  Level,
  Opening,
  OpeningKind,
  Selection,
  Vec2,
  Wall,
} from '../../src/types/bim';
import { OPENING_PRESETS } from '../../src/types/bim';
import { emptyPlant, emptySite } from '../../src/lib/plantDefaults';
import { detectRooms } from '../../src/lib/roomDetection';
import type { Gleichartige, Griff, GriffAenderung } from '../../src/lib/griffe';
import {
  MAX_WANDDICKE,
  MAX_WANDHOEHE,
  MIN_OEFFNUNG,
  MIN_WANDDICKE,
  MIN_WANDHOEHE,
  RAND_AN_DER_ECKE,
  aenderungFuer,
  begrenze,
  fange,
  fangmasse,
  gleichartige,
  griffeFuer,
  wertAusZug,
} from '../../src/lib/griffe';

// ---------------------------------------------------------------------------
// Kleinkram
// ---------------------------------------------------------------------------

/**
 * Auf Millimeter runden.
 *
 * `begrenze` rundet selbst auf Millimeter; die Wandlänge, die sich nach einer
 * Knotenverschiebung wieder aus zwei gerundeten Koordinaten ergibt, tut es
 * nicht — aus 4,000 m wird dort 3,999999999999999. Der Millimeter ist die
 * Stelle, an der eine falsche Formel noch auffällt, während dieses Rauschen
 * schon herausfällt.
 */
const r3 = (v: number): number => Math.round(v * 1000) / 1000;

/** Auf ein Millionstel runden — für die Länge eines Einheitsvektors. */
const r6 = (v: number): number => Math.round(v * 1e6) / 1e6;

/**
 * Eine tiefe Kopie des Dokuments.
 *
 * Der Rundlauf in Abschnitt F muss die Änderung **von Hand** anwenden: Der
 * Speicher ist Oberflächenschicht und steht dem Rechenkern nicht zur
 * Verfügung (siehe Prüfblock „Schichtgrenze"). Kopiert wird über JSON und
 * nicht flach, weil ein flacher Spread die Knoten- und Wandtabellen mit dem
 * Ausgangsdokument teilt — die Prüfung würde dann ihr eigenes Vorher
 * überschreiben und jeden Rundlauf bestehen, auch einen kaputten.
 */
function kopie(doc: BimDocument): BimDocument {
  return JSON.parse(JSON.stringify(doc)) as BimDocument;
}

/**
 * Die Änderung auf eine Kopie anwenden — so, wie es der Speicher täte.
 *
 * Bewusst ohne Raumerkennung, ohne Historie, ohne Nachziehen abgeleiteter
 * Werte: Geprüft wird, ob der Griff nach *genau dieser* Zuweisung den neuen
 * Wert trägt. Käme die Raumerkennung dazwischen, ließe sich ein
 * Griff-Fehler nicht mehr von einem Raumerkennungs-Fehler trennen.
 */
function anwenden(doc: BimDocument, aenderung: GriffAenderung): BimDocument {
  const k = kopie(doc);
  switch (aenderung.art) {
    case 'wand':
      k.walls[aenderung.id] = { ...k.walls[aenderung.id], ...aenderung.patch };
      break;
    case 'oeffnung':
      k.openings[aenderung.id] = { ...k.openings[aenderung.id], ...aenderung.patch };
      break;
    case 'objekt':
      k.fixtures[aenderung.id] = { ...k.fixtures[aenderung.id], ...aenderung.patch };
      break;
    case 'knoten':
      k.nodes[aenderung.id] = {
        ...k.nodes[aenderung.id],
        x: aenderung.position.x,
        y: aenderung.position.y,
      };
      break;
  }
  return k;
}

/** Die Art der Änderung als Wort — `'fehlt'`, wenn gar keine kam. */
const art = (a: GriffAenderung | null): string => a?.art ?? 'fehlt';

/**
 * Welche Felder der Patch belegt, alphabetisch und als ein Text.
 *
 * Geprüft wird bewusst die **ganze** Feldliste und nicht nur, ob das
 * erwartete Feld dabei ist. Ein Patch, der neben `height` noch `thickness`
 * mitschickt, überschreibt beim Anwenden eine Zahl, die der Planer nie
 * angefasst hat — und weil die Wand danach immer noch aussieht wie eine
 * Wand, sucht das später niemand hier.
 */
function felder(a: GriffAenderung | null): string {
  if (!a) return 'fehlt';
  if (a.art === 'knoten') return 'position';
  return Object.keys(a.patch).sort().join(',');
}

/** Der Zahlenwert eines Patch-Feldes; `NaN`, wenn es ihn nicht gibt. */
function feldwert(a: GriffAenderung | null, feld: string): number {
  if (!a || a.art === 'knoten') return Number.NaN;
  const wert = (a.patch as Record<string, unknown>)[feld];
  return typeof wert === 'number' ? wert : Number.NaN;
}

/** Die neue Knotenlage einer Wandende-Änderung; `NaN`, wenn es keine ist. */
function knotenlage(a: GriffAenderung | null): Vec2 {
  return a && a.art === 'knoten' ? a.position : { x: Number.NaN, y: Number.NaN };
}

/** Einen Griff nach seiner Art heraussuchen — `undefined` ist ein Prüfergebnis. */
const griffNach = (griffe: Griff[], gesucht: string): Griff | undefined =>
  griffe.find((g) => g.art === gesucht);

/**
 * Denselben Griff derselben Auswahl noch einmal holen.
 *
 * Über die `id` und nicht über die Art, weil die `id` das ist, woran der
 * Betrachter den Griff über einen Neuaufbau hinweg wiedererkennt. Wandert
 * sie, verliert der Zeiger beim Ziehen den Griff — und zwar mitten im Zug.
 */
function erneut(doc: BimDocument, auswahl: Selection, id: string): Griff | undefined {
  return griffeFuer(doc, auswahl).find((g) => g.id === id);
}

// ---------------------------------------------------------------------------
// Das Prüfhaus
// ---------------------------------------------------------------------------

/** Wand- und Geschosshöhe des Prüfhauses [m]. */
const HOEHE = 2.5;
/** Wandstärke [m]. */
const DICKE = 0.3;
/** Grundriss über Wandachsen [m]: die Südwand ist 6,00 m lang. */
const LAENGE = 6;
const TIEFE = 4;

const geschoss: Level = {
  id: 'eg',
  name: 'EG',
  order: 0,
  elevation: 0,
  height: HOEHE,
  floorUValue: 0.35,
  floorBoundary: 'ground',
  ceilingUValue: 0.2,
  ceilingBoundary: 'unheated',
};

/** Ein Dokument ohne Inhalt — die Pflichtfelder, sonst nichts. */
function leeresDokument(): BimDocument {
  return {
    site: emptySite(),
    plant: emptyPlant(),
    meta: {
      name: 'Prüfhaus Griffe',
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
    levels: { eg: { ...geschoss } },
    layers: {},
    nodes: {},
    walls: {},
    openings: {},
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
    activeLevelId: 'eg',
  };
}

const knoten = (id: string, x: number, y: number): BimNode => ({ id, x, y, levelId: 'eg' });

const wand = (id: string, a: string, b: string, dicke = DICKE, hoehe = HOEHE): Wall => ({
  id,
  a,
  b,
  levelId: 'eg',
  type: 'exterior',
  thickness: dicke,
  height: hoehe,
  layerId: 'wandschicht',
});

const oeffnung = (
  id: string,
  wallId: string,
  kind: OpeningKind,
  distance: number,
  width: number,
  height: number,
  sillHeight: number,
): Opening => ({ id, wallId, kind, distance, width, height, sillHeight });

/**
 * Das Prüfhaus: ein geschlossener Raum 6,00 × 4,00 m über Wandachsen.
 *
 * **Geschlossen**, weil Abschnitt A braucht, dass die Raumerkennung
 * tatsächlich einen Raum findet — die Aussage „ein Raum hat keine Griffe"
 * ist nur dann eine Aussage, wenn es den Raum gibt. Ein von Hand
 * geschriebenes Raumpolygon wäre eine zweite, stillschweigende Fassung der
 * Raumerkennung und würde nicht mit ihr altern.
 *
 * In der Südwand stehen **zwei** Fenster, und zwar so, dass jedes genau
 * einen Nachbarn hat: `fensterA` auf 2,00 m einen rechts, `fensterB` auf
 * 4,00 m einen links. Damit zeigt sich die Nachbarbegrenzung an beiden
 * Seiten getrennt — in einer Wand mit nur einer Öffnung ließe sich nicht
 * unterscheiden, ob die Grenze vom Nachbarn oder vom Wandende kommt.
 *
 * Die Tür sitzt in der West-, der Durchgang in der Ostwand: Beide sollen
 * zeigen, dass ihnen der Brüstungsgriff fehlt, und dafür dürfen sie einander
 * nicht im Weg stehen.
 */
function baueHaus(): BimDocument {
  const doc = leeresDokument();
  doc.nodes = {
    sw: knoten('sw', 0, 0),
    so: knoten('so', LAENGE, 0),
    no: knoten('no', LAENGE, TIEFE),
    nw: knoten('nw', 0, TIEFE),
  };
  doc.walls = {
    sued: wand('sued', 'sw', 'so'),
    ost: wand('ost', 'so', 'no'),
    nord: wand('nord', 'no', 'nw'),
    west: wand('west', 'nw', 'sw'),
  };
  doc.openings = {
    fensterA: oeffnung('fensterA', 'sued', 'window', 2, 1, 1.3, 0.9),
    fensterB: oeffnung('fensterB', 'sued', 'window', 4, 1, 1.3, 0.9),
    tuer: oeffnung('tuer', 'west', 'door', 2, 1, 2, 0),
    durchgang: oeffnung('durchgang', 'ost', 'passage', 2, 1, 2, 0),
  };
  doc.fixtures = {
    heizkoerper: {
      id: 'heizkoerper',
      type: 'radiator',
      category: 'heating',
      levelId: 'eg',
      position: { x: 2, y: 0.3 },
      rotation: 0,
      length: 1,
      depth: 0.1,
      elevation: 0.15,
      wallId: 'sued',
      params: { powerW: 1000 },
    } as Fixture,
  };
  const raeume = detectRooms({
    nodes: doc.nodes,
    walls: Object.values(doc.walls),
    openings: Object.values(doc.openings),
    levelId: 'eg',
    defaultHeight: HOEHE,
    northAngle: 0,
  });
  doc.rooms = Object.fromEntries(raeume.map((r) => [r.id, r]));
  return doc;
}

/**
 * Eine freistehende schräge Wand — das 3-4-5-Dreieck.
 *
 * Von (10,00 | 0,00) nach (13,00 | 4,00): drei Meter nach Osten, vier nach
 * Norden, genau fünf Meter lang, Richtung (0,6 | 0,8). An einer
 * achsparallelen Wand bliebe ein vertauschtes Vorzeichen in der Richtung
 * folgenlos — die Wand wäre danach immer noch waagerecht und immer noch so
 * lang wie verlangt, nur an der falschen Stelle. Hier wandert der Knoten
 * sichtbar in die falsche Ecke.
 *
 * Eigenes Dokument und nicht ein fünftes Wandstück im Prüfhaus, damit die
 * Raumerkennung dort einen sauberen geschlossenen Umriss behält.
 */
function baueSchraegeWand(): BimDocument {
  const doc = leeresDokument();
  doc.nodes = { anfang: knoten('anfang', 10, 0), ende: knoten('ende', 13, 4) };
  doc.walls = { schraeg: wand('schraeg', 'anfang', 'ende') };
  return doc;
}

/**
 * Eine Wand mit **drei** Öffnungen — die mittlere hat links und rechts einen
 * Nachbarn.
 *
 * Die Nachbarn liegen bewusst ungleich weit weg: links endet `links` bei
 * 1,50 m, rechts beginnt `rechts` bei 3,70 m. Die Öffnung in der Mitte steht
 * auf 3,00 m und wächst symmetrisch — es muss also der **nähere** Nachbar
 * binden. Läge die Grenze bei beiden gleich weit, ließe sich nicht erkennen,
 * ob überhaupt der richtige gewählt wird.
 */
function baueDreiFenster(): BimDocument {
  const doc = leeresDokument();
  doc.nodes = { a: knoten('a', 0, 0), b: knoten('b', LAENGE, 0) };
  doc.walls = { lang: wand('lang', 'a', 'b') };
  doc.openings = {
    links: oeffnung('links', 'lang', 'window', 1, 1, 1.3, 0.9),
    mitte: oeffnung('mitte', 'lang', 'window', 3, 1, 1.3, 0.9),
    rechts: oeffnung('rechts', 'lang', 'window', 4.2, 1, 1.3, 0.9),
  };
  return doc;
}

/**
 * Eine Fassade mit vier Fenstern und einer Tür — die Vorlage für die
 * Fangmaße.
 *
 * Drei Fenster auf 0,90 m Brüstung, eines auf 0,60 m: So sieht ein
 * Bestandsgebäude aus, in dem jemand ein Fenster nachträglich tiefer
 * gesetzt hat. Die Tür steht in **derselben** Wand und ist mit 0,90 m Breite
 * so gewählt, dass sie in den zulässigen Bereich der Fensterbreite fällt —
 * nur so beweist ihr Fehlen in der Liste, dass die Art gefiltert wird und
 * nicht bloß die Grenze.
 */
function baueFassade(): BimDocument {
  const doc = leeresDokument();
  doc.nodes = { a: knoten('a', 0, 0), b: knoten('b', 12, 0) };
  doc.walls = { fassade: wand('fassade', 'a', 'b') };
  doc.openings = {
    f1: oeffnung('f1', 'fassade', 'window', 1.5, 1, 1.3, 0.9),
    f2: oeffnung('f2', 'fassade', 'window', 4, 1, 1.3, 0.9),
    f3: oeffnung('f3', 'fassade', 'window', 6.5, 1, 1.3, 0.9),
    f4: oeffnung('f4', 'fassade', 'window', 9.5, 0.8, 1.1, 0.6),
    haustuer: oeffnung('haustuer', 'fassade', 'door', 11.3, 0.9, 2.01, 0),
  };
  return doc;
}

/**
 * Eine Wand mit zwei Türen aus dem Katalog — Grundlage des Befunds in G.
 *
 * `door-88` misst 0,885 × 2,010 m, `door-101` misst 1,010 × 2,135 m; beide
 * Zahlen stammen aus `OPENING_PRESETS` und damit aus den Rohbaumaßen nach
 * DIN 18100. Die halben Zentimeter darin sind kein Zufall und kein
 * Tippfehler — sie sind das Maß, das auf der Baustelle steht.
 */
function baueKatalogtueren(): BimDocument {
  const doc = leeresDokument();
  doc.nodes = { a: knoten('a', 0, 0), b: knoten('b', 8, 0) };
  doc.walls = { kw: wand('kw', 'a', 'b') };
  doc.openings = {
    t88: oeffnung('t88', 'kw', 'door', 2, 0.885, 2.01, 0),
    t101: oeffnung('t101', 'kw', 'door', 5, 1.01, 2.135, 0),
  };
  return doc;
}

/**
 * Zwei Fenster mit **12 cm** Wand dazwischen — der Fall, für den die
 * Obergrenze der Breite gedacht ist.
 *
 * Wand 6,00 m: `weitA` auf 2,00 m, `weitB` auf 3,12 m, beide 1,00 m breit.
 * Die rechte Laibung von `weitA` liegt damit bei 2,50 m, die linke von
 * `weitB` bei 2,62 m — zwölf Zentimeter Wand, also **weniger als
 * `MIN_OEFFNUNG`**, und trotzdem genug, dass die Öffnung noch wachsen darf,
 * bis der 5-cm-Rand aufgebraucht ist. Genau diese beiden Aussagen
 * auseinanderzuhalten ist der Zweck dieses Prüfhauses: „wenig Platz
 * zwischen den Öffnungen" und „zu wenig Platz für eine Öffnung" sind zwei
 * verschiedene Zahlen, und die Obergrenze hängt an der zweiten.
 */
function baueEngeNachbarn(): BimDocument {
  const doc = leeresDokument();
  doc.nodes = { a: knoten('a', 0, 0), b: knoten('b', LAENGE, 0) };
  doc.walls = { eng: wand('eng', 'a', 'b') };
  doc.openings = {
    weitA: oeffnung('weitA', 'eng', 'window', 2, 1, 1.3, 0.9),
    weitB: oeffnung('weitB', 'eng', 'window', 3.12, 1, 1.3, 0.9),
  };
  return doc;
}

/**
 * Eine Wand mit einem schmalen Schlitz und einem Nachbarn dicht daneben.
 *
 * `breite` ist die heutige lichte Breite des Schlitzes (Mitte immer 2,00 m),
 * `nachbarMitte` die Mitte der 0,20 m breiten Nachbaröffnung. Beide Zahlen
 * stehen am **Aufrufort**, weil dort auch die Rechnung steht, die aus ihnen
 * folgt — ein Prüfhaus mit fest eingebauten Maßen zwänge jede der drei
 * Lagen (unterhalb, genau auf und oberhalb der Mindestbreite) in eine
 * eigene Funktion, und die Zahlen stünden dann weit weg von ihrer
 * Begründung.
 *
 * Warum die Öffnung so schmal sein muss, um die Grenze überhaupt
 * auszulösen, steht im Kasten in Abschnitt H.
 */
function baueSchlitzWand(breite: number, nachbarMitte: number): BimDocument {
  const doc = leeresDokument();
  doc.nodes = { a: knoten('a', 0, 0), b: knoten('b', LAENGE, 0) };
  doc.walls = { eng: wand('eng', 'a', 'b') };
  doc.openings = {
    schlitz: oeffnung('schlitz', 'eng', 'window', 2, breite, 1.3, 0.9),
    nachbar: oeffnung('nachbar', 'eng', 'window', nachbarMitte, 0.2, 1.3, 0.9),
  };
  return doc;
}

/** Das Obergeschoss — nur da, um die Geschossgrenze zu zeigen. */
const obergeschoss: Level = { ...geschoss, id: 'og', name: 'OG', order: 1, elevation: HOEHE };

/**
 * Ein freistehendes Wandstück ins Dokument legen, Achsknoten inklusive.
 *
 * Die Wände stehen bewusst **nebeneinander und ohne gemeinsame Knoten**: Für
 * das Übertragen eines Maßes zählt allein die Wandart und das Geschoss, nicht
 * die Nachbarschaft. Ein geschlossener Grundriss würde hier nur eine
 * Raumerkennung mitschleppen, die nichts zur Aussage beiträgt — und bei einem
 * Fehler in ihr fiele dieser Abschnitt aus einem Grund durch, der nichts mit
 * Griffen zu tun hat.
 */
function legeWand(
  doc: BimDocument,
  id: string,
  x: number,
  typ: Wall['type'],
  dicke: number,
  hoehe: number,
  levelId: string,
): void {
  doc.nodes[`${id}A`] = { id: `${id}A`, x, y: 0, levelId };
  doc.nodes[`${id}B`] = { id: `${id}B`, x, y: 3, levelId };
  doc.walls[id] = {
    id,
    a: `${id}A`,
    b: `${id}B`,
    levelId,
    type: typ,
    thickness: dicke,
    height: hoehe,
    layerId: 'wandschicht',
  };
}

/**
 * Ein Geschoss mit **allen vier** Wandarten, je dreimal — und zwei
 * Außenwänden im Obergeschoss.
 *
 * `WallType` hat vier Werte: `exterior | interior | partition | shaft`. Der
 * erste Entwurf der Beschriftung kannte nur zwei davon und schob den Rest auf
 * „Trennwände"; eine Schachtwand bekam damit im Knopf „auf n weitere
 * Trennwände übertragen", obwohl richtig übertragen wurde. Damit dieser
 * Fehler nicht zurückkommen kann, muss **jede** der vier Arten in einem
 * Prüfhaus vorkommen, in dem sie sich voneinander unterscheiden lässt.
 *
 * Je Art drei Wände, damit im Knopf eine **Zahl größer eins** steht: „auf 1
 * weitere" ließe eine Verwechslung von „alle anderen" und „alle" nicht
 * auffallen. Die Stärken sind je Art verschieden (0,30 · 0,175 · 0,10 ·
 * 0,15 m), damit ein fehlender Artfilter sofort eine fremde Wand in die
 * Liste spülte. Die beiden Wände im Obergeschoss sind Außenwände mit
 * **derselben** Stärke wie `aussen1` — sie unterscheiden sich allein durch
 * das Geschoss, und nur so beweist ihr Fehlen, dass nach Geschoss gefiltert
 * wird.
 */
function baueWandarten(): BimDocument {
  const doc = leeresDokument();
  doc.levels.og = { ...obergeschoss };
  legeWand(doc, 'aussen1', 0, 'exterior', 0.3, HOEHE, 'eg');
  legeWand(doc, 'aussen2', 1, 'exterior', 0.3, HOEHE, 'eg');
  legeWand(doc, 'aussen3', 2, 'exterior', 0.3, HOEHE, 'eg');
  legeWand(doc, 'innen1', 3, 'interior', 0.175, HOEHE, 'eg');
  legeWand(doc, 'innen2', 4, 'interior', 0.175, HOEHE, 'eg');
  legeWand(doc, 'innen3', 5, 'interior', 0.175, HOEHE, 'eg');
  legeWand(doc, 'trenn1', 6, 'partition', 0.1, HOEHE, 'eg');
  legeWand(doc, 'trenn2', 7, 'partition', 0.1, HOEHE, 'eg');
  legeWand(doc, 'trenn3', 8, 'partition', 0.1, HOEHE, 'eg');
  legeWand(doc, 'schacht1', 9, 'shaft', 0.15, HOEHE, 'eg');
  legeWand(doc, 'schacht2', 10, 'shaft', 0.15, HOEHE, 'eg');
  legeWand(doc, 'schacht3', 11, 'shaft', 0.15, HOEHE, 'eg');
  legeWand(doc, 'ogAussen1', 12, 'exterior', 0.3, HOEHE, 'og');
  legeWand(doc, 'ogAussen2', 13, 'exterior', 0.3, HOEHE, 'og');
  return doc;
}

/**
 * Eine Fassade mit Fenstern, Türen und einem Durchgang — und dieselbe
 * Fassade noch einmal im Obergeschoss.
 *
 * Das Prüfhaus für das Übertragen von Öffnungsmaßen. Die drei Fenster tragen
 * bewusst **drei verschiedene** Sätze aus Breite, lichter Höhe und Brüstung
 * (1,00 · 1,30 · 0,90 — 1,20 · 1,40 · 0,75 — 1,00 · 1,30 · 0,90), damit sich
 * jedes der drei Maße einzeln prüfen lässt und `fensterC` in einigen Fällen
 * den Zielwert schon trägt: Wer ihn schon trägt, darf nicht in der Liste
 * stehen, sonst hält die Zahl im Knopf ihr Versprechen nicht.
 *
 * Zwei Türen, damit die Beschriftung „Türen" überhaupt entstehen kann; nur
 * **ein** Durchgang, damit die Gegenprobe „nichts zu übertragen" an einer
 * echten Öffnungsart hängt und nicht an einer erfundenen. Das Fenster im
 * Obergeschoss ist bis auf das Geschoss eine Kopie von `fensterA`.
 */
function baueUebertragung(): BimDocument {
  const doc = leeresDokument();
  doc.levels.og = { ...obergeschoss };
  doc.nodes = {
    egA: { id: 'egA', x: 0, y: 0, levelId: 'eg' },
    egB: { id: 'egB', x: 14, y: 0, levelId: 'eg' },
    ogA: { id: 'ogA', x: 0, y: 6, levelId: 'og' },
    ogB: { id: 'ogB', x: 14, y: 6, levelId: 'og' },
  };
  doc.walls = {
    fassadeEg: { ...wand('fassadeEg', 'egA', 'egB') },
    fassadeOg: { ...wand('fassadeOg', 'ogA', 'ogB'), levelId: 'og' },
  };
  doc.openings = {
    fensterA: oeffnung('fensterA', 'fassadeEg', 'window', 2, 1, 1.3, 0.9),
    fensterB: oeffnung('fensterB', 'fassadeEg', 'window', 5, 1.2, 1.4, 0.75),
    fensterC: oeffnung('fensterC', 'fassadeEg', 'window', 8, 1, 1.3, 0.9),
    tuerA: oeffnung('tuerA', 'fassadeEg', 'door', 10, 1.01, 2.01, 0),
    tuerB: oeffnung('tuerB', 'fassadeEg', 'door', 11.5, 0.885, 2.01, 0),
    durchgang: oeffnung('durchgang', 'fassadeEg', 'passage', 13, 1, 2.135, 0),
    fensterOg: oeffnung('fensterOg', 'fassadeOg', 'window', 2, 1, 1.3, 0.9),
  };
  return doc;
}

/**
 * Die Kennungen der betroffenen Bauteile, alphabetisch und als ein Text.
 *
 * Geprüft wird bewusst **namentlich** und nicht nur die Anzahl: Eine Liste
 * der richtigen Länge mit dem falschen Inhalt — die Innenwand statt der
 * Außenwand, das Fenster aus dem Obergeschoss statt dem daneben — bestünde
 * jede Zählprüfung und schriebe trotzdem in ein Bauteil, das niemand
 * angefasst hat. `'nichts'` ist ein dritter Zustand, der gegen jeden
 * Sollwert falsch ist.
 */
function betroffene(g: Gleichartige | null): string {
  if (!g) return 'nichts';
  return g.aenderungen.map((a) => a.id).sort().join(',');
}

/** Der Text im Knopf — `'nichts'`, wenn gar keiner angeboten wird. */
const knopf = (g: Gleichartige | null): string => g?.beschreibung ?? 'nichts';

/**
 * Die Feldlisten aller Änderungen, doppelte zusammengefasst.
 *
 * Erwartet wird hier immer **genau ein** Feldname. Schickte eine Übertragung
 * neben der Brüstung noch die lichte Höhe mit, stünde hier
 * `height,sillHeight` — und ohne diese Zeile fiele es niemandem auf: Das
 * Fenster säße danach richtig, wäre aber still auf die Höhe des Nachbarn
 * gebracht worden.
 */
function felderAller(g: Gleichartige | null): string {
  if (!g) return 'nichts';
  return [...new Set(g.aenderungen.map((a) => felder(a)))].sort().join(' + ');
}

/** Die Änderungsarten aller Einträge, doppelte zusammengefasst. */
function artenAller(g: Gleichartige | null): string {
  if (!g) return 'nichts';
  return [...new Set(g.aenderungen.map((a) => a.art))].sort().join('+');
}

/**
 * Die Regeln, die für **jeden** Griff gelten, an einer Stelle.
 *
 * Diese fünf Zusagen sind das, worauf sich der Betrachter blind verlässt:
 * Er sucht den Griff über die `id`, schreibt das `label` an den Zeiger,
 * sperrt den Zug an `min`/`max` und rechnet die Zugrichtung über `achse`.
 * Ist die Achse kein Einheitsvektor, wird aus einem Zentimeter Zug je nach
 * Wandrichtung mal ein halber und mal ein doppelter — ein Fehler, den man
 * an einer waagerechten Wand nie sieht und an einer schrägen für ein
 * Gefühlsproblem hält. Deshalb wird die Länge **gerechnet** und nicht
 * angesehen.
 */
function pruefeGrundregeln(check: CheckFn, titel: string, griffe: Griff[]): void {
  const ids = new Set(griffe.map((g) => g.id));
  check(`${titel}: jede Griff-id kommt genau einmal vor`, ids.size, griffe.length);
  check(`${titel}: jeder Griff hat eine Beschriftung`, griffe.every((g) => g.label.length > 0), true);
  check(`${titel}: bei jedem Griff ist min kleiner als max`, griffe.every((g) => g.min < g.max), true);
  check(
    `${titel}: jeder Griff trägt einen Wert innerhalb seiner Grenzen`,
    griffe.every((g) => g.wert >= g.min && g.wert <= g.max),
    true,
  );
  check(
    `${titel}: jede Griffachse ist ein Einheitsvektor`,
    griffe.every((g) => r6(Math.hypot(g.achse.x, g.achse.y, g.achse.z)) === 1),
    true,
  );
}

// ---------------------------------------------------------------------------
// Der Prüflauf
// ---------------------------------------------------------------------------

export function pruefeGriffe(check: CheckFn): void {
  const haus = baueHaus();
  const wandAuswahl: Selection = { kind: 'wall', id: 'sued' };
  const fensterAAuswahl: Selection = { kind: 'opening', id: 'fensterA' };
  const objektAuswahl: Selection = { kind: 'fixture', id: 'heizkoerper' };

  // === A — Welche Griffe entstehen ========================================
  //
  // Die Anzahl ist keine Nebensache: Jeder Griff, den es gibt, ist ein
  // Versprechen, und jeder, den es nicht gibt, ist eine Aussage. Ein Griff
  // zu viel verspricht ein Maß, das es am Bauteil nicht gibt; einer zu wenig
  // macht ein Maß in der 3D-Ansicht unerreichbar, ohne dass irgendwo etwas
  // fehlschlägt.

  // --- A.1 Die Wand: vier Griffe -----------------------------------------
  const wandGriffe = griffeFuer(haus, wandAuswahl);
  check('Eine Wand liefert vier Griffe', wandGriffe.length, 4);
  check('… Höhe ist dabei', griffNach(wandGriffe, 'wandHoehe') !== undefined, true);
  check('… Dicke ist dabei', griffNach(wandGriffe, 'wandDicke') !== undefined, true);
  check('… Ende A ist dabei', griffNach(wandGriffe, 'wandEndeA') !== undefined, true);
  check('… Ende B ist dabei', griffNach(wandGriffe, 'wandEndeB') !== undefined, true);
  pruefeGrundregeln(check, 'Wand', wandGriffe);

  /*
   * Die gelöschte Wand.
   *
   * Der Betrachter hält die Auswahl über einen Löschvorgang hinweg fest —
   * er erfährt erst beim nächsten Aufbau, dass es das Bauteil nicht mehr
   * gibt. Eine leere Liste ist hier die richtige Antwort; ein Absturz wäre
   * der falsche, und ein Griff auf ein gelöschtes Bauteil der schlimmste:
   * Er schriebe beim Ziehen in eine Tabelle, in der niemand mehr nachsieht.
   */
  const geloescht = kopie(haus);
  delete geloescht.walls.sued;
  check('Eine gelöschte Wand liefert keine Griffe', griffeFuer(geloescht, wandAuswahl).length, 0);
  check(
    'Auch das Fenster in der gelöschten Wand liefert keine Griffe',
    griffeFuer(geloescht, fensterAAuswahl).length,
    0,
  );
  // Dasselbe, wenn nur ein Achsknoten fehlt: Ohne Knoten gibt es keine
  // Wandachse, und ohne Wandachse keine Lage, an der ein Griff säße.
  const ohneKnoten = kopie(haus);
  delete ohneKnoten.nodes.so;
  check('Eine Wand ohne Achsknoten liefert keine Griffe', griffeFuer(ohneKnoten, wandAuswahl).length, 0);

  // --- A.2 Fenster vier, Tür und Durchgang drei --------------------------
  //
  // Der Unterschied ist Absicht und im Modul begründet: Eine Tür steht auf
  // dem Fußboden. Ein Brüstungsgriff an ihr verspräche ein Maß, das es nicht
  // gibt — wer eine Tür 20 cm anhebt, meint eine Schwelle, und die ist ein
  // anderes Bauteil. Geprüft werden beide Richtungen: dass das Fenster den
  // Griff **hat** und dass Tür und Durchgang ihn **nicht** haben. Nur die
  // erste Hälfte zu prüfen ließe einen Brüstungsgriff an der Tür durch.
  const fensterGriffe = griffeFuer(haus, fensterAAuswahl);
  const tuerGriffe = griffeFuer(haus, { kind: 'opening', id: 'tuer' });
  const durchgangGriffe = griffeFuer(haus, { kind: 'opening', id: 'durchgang' });
  check('Ein Fenster liefert vier Griffe', fensterGriffe.length, 4);
  check('… darunter die Brüstung', griffNach(fensterGriffe, 'oeffnungBruestung') !== undefined, true);
  check('Eine Tür liefert drei Griffe', tuerGriffe.length, 3);
  check('… und keinen Brüstungsgriff', griffNach(tuerGriffe, 'oeffnungBruestung') !== undefined, false);
  check('Ein Durchgang liefert drei Griffe', durchgangGriffe.length, 3);
  check(
    '… und ebenfalls keinen Brüstungsgriff',
    griffNach(durchgangGriffe, 'oeffnungBruestung') !== undefined,
    false,
  );
  // Breite, Höhe und Lage hat jede Öffnung — auch die ohne Brüstung.
  check('Jede Öffnung hat einen Breitengriff', griffNach(tuerGriffe, 'oeffnungBreite') !== undefined, true);
  check('Jede Öffnung hat einen Höhengriff', griffNach(tuerGriffe, 'oeffnungHoehe') !== undefined, true);
  check('Jede Öffnung hat einen Lagegriff', griffNach(tuerGriffe, 'oeffnungLage') !== undefined, true);
  pruefeGrundregeln(check, 'Fenster', fensterGriffe);
  pruefeGrundregeln(check, 'Tür', tuerGriffe);
  pruefeGrundregeln(check, 'Durchgang', durchgangGriffe);

  // --- A.3 Das TGA-Objekt: drei Griffe -----------------------------------
  const objektGriffe = griffeFuer(haus, objektAuswahl);
  check('Ein TGA-Objekt liefert drei Griffe', objektGriffe.length, 3);
  check('… Baulänge', griffNach(objektGriffe, 'objektLaenge') !== undefined, true);
  check('… Bautiefe', griffNach(objektGriffe, 'objektTiefe') !== undefined, true);
  check('… Höhe', griffNach(objektGriffe, 'objektHoehe') !== undefined, true);
  pruefeGrundregeln(check, 'Objekt', objektGriffe);

  // --- A.4 Raum und leere Auswahl ----------------------------------------
  //
  // Der Raum ist abgeleitet: Seine Größe folgt aus den Wänden, und ein Griff
  // an seiner Kante wäre ein Griff, dessen Änderung die Raumerkennung beim
  // nächsten Lauf wieder wegwirft. Die leere Liste ist hier kein Mangel,
  // sondern die Aussage „das ändert man an der Wand".
  const raumIds = Object.keys(haus.rooms);
  check('Das Prüfhaus hat einen erkannten Raum', raumIds.length, 1);
  check('Ein Raum liefert keine Griffe', griffeFuer(haus, { kind: 'room', id: raumIds[0] }).length, 0);
  check('Ohne Auswahl gibt es keine Griffe', griffeFuer(haus, null).length, 0);

  // === B — Die Grenzen, und zwar die fachlichen ===========================
  //
  // Die Grenzen sind der eigentliche Inhalt des Moduls. Ohne sie zieht man
  // in der 3D-Ansicht ein Modell, das der Grundriss nicht mehr zeichnen kann
  // — und zwar lautlos: Es gibt keine Fehlermeldung für ein Fenster, das
  // oben aus der Wand ragt, nur eine fehlende Fläche im Bild.

  // --- B.1 Wandhöhe und Wandstärke ---------------------------------------
  const hoeheGriff = griffNach(wandGriffe, 'wandHoehe')!;
  const dickeGriff = griffNach(wandGriffe, 'wandDicke')!;
  check('Der Höhengriff trägt die Wandhöhe', hoeheGriff.wert, HOEHE);
  check('Die Wandhöhe beginnt bei 1,50 m', hoeheGriff.min, MIN_WANDHOEHE);
  check('… und endet bei 6,00 m', hoeheGriff.max, MAX_WANDHOEHE);
  check('Die Zahlen selbst sind 1,5 und 6', `${MIN_WANDHOEHE}/${MAX_WANDHOEHE}`, '1.5/6');
  check('Der Dickengriff trägt die Wandstärke', dickeGriff.wert, DICKE);
  check('Die Wandstärke beginnt bei 5 cm', dickeGriff.min, MIN_WANDDICKE);
  check('… und endet bei 1,00 m', dickeGriff.max, MAX_WANDDICKE);
  check('Die Zahlen selbst sind 0,05 und 1', `${MIN_WANDDICKE}/${MAX_WANDDICKE}`, '0.05/1');
  // Der Höhengriff zeigt senkrecht nach oben, der Dickengriff quer zur Wand.
  // Die Südwand läuft nach +x, ihre Linksnormale zeigt nach +y.
  check('Der Höhengriff zieht senkrecht', `${hoeheGriff.achse.x}/${hoeheGriff.achse.y}/${hoeheGriff.achse.z}`, '0/0/1');
  check('Der Dickengriff zieht quer zur Wand', `${dickeGriff.achse.x}/${dickeGriff.achse.y}/${dickeGriff.achse.z}`, '0/1/0');

  // --- B.2 Die lichte Höhe endet an der Wandoberkante --------------------
  //
  // 2,50 m Wand, 0,90 m Brüstung — dann bleiben für das Fenster 1,60 m.
  // Ohne diese Grenze steht im Modell ein Fenster, dessen Sturz über der
  // Wandoberkante liegt: gezeichnet wird ein Loch ohne Sturz, und im Plan
  // fehlt das Wandstück darüber. Der Planer sieht eine Lücke und sucht sie
  // bei der Wand.
  const lichteHoehe = griffNach(fensterGriffe, 'oeffnungHoehe')!;
  check('Der Höhengriff des Fensters trägt die lichte Höhe', lichteHoehe.wert, 1.3);
  check('Die lichte Höhe endet bei Wandhöhe minus Brüstung, also 1,60 m', r3(lichteHoehe.max), 1.6);
  check('… und beginnt bei der kleinsten Öffnung', lichteHoehe.min, MIN_OEFFNUNG);
  check('Die kleinste Öffnung ist 0,20 m', MIN_OEFFNUNG, 0.2);
  // Gegenprobe mit einer anderen Brüstung: 2,50 − 0,30 = 2,20 m. Eine feste
  // 1,60 würde hier durchfallen, eine Grenze „Wandhöhe" ebenso.
  const tiefeBruestung = kopie(haus);
  tiefeBruestung.openings.fensterA.sillHeight = 0.3;
  check(
    'Bei 0,30 m Brüstung sind es 2,20 m',
    r3(griffNach(griffeFuer(tiefeBruestung, fensterAAuswahl), 'oeffnungHoehe')!.max),
    2.2,
  );
  // Die Tür hat keine Brüstung — bei ihr ist die ganze Wandhöhe die Grenze.
  check(
    'Bei der Tür ist die ganze Wandhöhe die Grenze',
    r3(griffNach(tuerGriffe, 'oeffnungHoehe')!.max),
    HOEHE,
  );

  // --- B.3 Die Brüstung endet an der Wandhöhe minus Fensterhöhe ----------
  //
  // Dieselbe Bedingung von der anderen Seite: 2,50 − 1,30 = 1,20 m. Wer die
  // Brüstung höher zieht, schiebt den Sturz aus der Wand — mit demselben
  // Ergebnis wie oben, nur über einen anderen Griff erreicht.
  const bruestung = griffNach(fensterGriffe, 'oeffnungBruestung')!;
  check('Der Brüstungsgriff trägt die Brüstungshöhe', bruestung.wert, 0.9);
  check('Die Brüstung beginnt am Fußboden', bruestung.min, 0);
  check('Die Brüstung endet bei Wandhöhe minus Fensterhöhe, also 1,20 m', r3(bruestung.max), 1.2);
  const hohesFenster = kopie(haus);
  hohesFenster.openings.fensterA.height = 2.1;
  check(
    'Bei 2,10 m Fensterhöhe bleiben 0,40 m Brüstung',
    r3(griffNach(griffeFuer(hohesFenster, fensterAAuswahl), 'oeffnungBruestung')!.max),
    0.4,
  );

  // --- B.4 Die Breite endet vor der Nachbaröffnung -----------------------
  //
  // Der wichtigste Fall. Schiebt man zwei Öffnungen ineinander, zerfällt die
  // Wanddarstellung lautlos: `wallSolidParts` läuft mit einem Zeiger nach
  // vorn und überspringt alles, was hinter dem Zeiger liegt — das Wandstück
  // zwischen den beiden Fenstern verschwindet, ohne dass irgendwo etwas
  // gemeldet wird.
  //
  // Nachgerechnet für `fensterA` (Mitte 2,00 m, Wand 6,00 m lang):
  //   • links bindet das Wandende:      Grenze 0,00 + 0,05 = 0,05 m,
  //     verfügbar 2,00 − 0,05 = 1,95 m;
  //   • rechts bindet `fensterB`, dessen linke Laibung bei 4,00 − 0,50 =
  //     3,50 m liegt: Grenze 3,50 − 0,05 = 3,45 m, verfügbar 1,45 m;
  //   • die Öffnung wächst um ihre Mitte, also zählt die **kleinere** Seite
  //     doppelt: 2 × 1,45 = 2,90 m.
  const breiteA = griffNach(fensterGriffe, 'oeffnungBreite')!;
  check('Der Breitengriff trägt die lichte Breite', breiteA.wert, 1);
  check('Die größte Breite von fensterA ist 2,90 m', r3(breiteA.max), 2.9);
  // Und damit bleibt genau der geforderte Rand stehen: die rechte Laibung
  // läge bei 2,00 + 1,45 = 3,45 m, die linke Laibung von fensterB bei
  // 3,50 m — 5 cm Wand dazwischen, keinen Millimeter weniger.
  check('Zwischen beiden bleiben genau 5 cm Wand', r3(3.5 - (2 + r3(breiteA.max) / 2)), RAND_AN_DER_ECKE);
  check('Der Rand an der Ecke ist 0,05 m', RAND_AN_DER_ECKE, 0.05);

  // Dieselbe Rechnung von der anderen Seite: `fensterB` hat nur links einen
  // Nachbarn. Rechte Laibung von `fensterA` bei 2,50 m, Grenze 2,55 m,
  // verfügbar 4,00 − 2,55 = 1,45 m, rechts bis 5,95 m also 1,95 m — wieder
  // 2 × 1,45 = 2,90 m. Ein Vorzeichenfehler in der Nachbarschleife träfe nur
  // eine der beiden Seiten und käme genau hier heraus.
  const fensterBGriffe = griffeFuer(haus, { kind: 'opening', id: 'fensterB' });
  const breiteB = griffNach(fensterBGriffe, 'oeffnungBreite')!;
  check('Die größte Breite von fensterB ist ebenfalls 2,90 m', r3(breiteB.max), 2.9);
  check('… bei ihr bindet der linke Nachbar', r3(4 - r3(breiteB.max) / 2), 2.55);

  // Ohne Nachbar bindet nur das Wandende: 6,00 m Wand, Mitte auf 2,00 m,
  // links 1,95 m verfügbar, rechts 3,95 m → 2 × 1,95 = 3,90 m.
  const alleine = kopie(haus);
  delete alleine.openings.fensterB;
  check(
    'Ohne Nachbar bindet nur das Wandende: 3,90 m',
    r3(griffNach(griffeFuer(alleine, fensterAAuswahl), 'oeffnungBreite')!.max),
    3.9,
  );

  // Nachbarn auf **beiden** Seiten: Die mittlere Öffnung steht auf 3,00 m,
  // links endet `links` bei 1,50 m (Grenze 1,55, verfügbar 1,45), rechts
  // beginnt `rechts` bei 3,70 m (Grenze 3,65, verfügbar 0,65). Der nähere
  // Nachbar gewinnt: 2 × 0,65 = 1,30 m.
  const drei = baueDreiFenster();
  const mitteGriffe = griffeFuer(drei, { kind: 'opening', id: 'mitte' });
  const breiteMitte = griffNach(mitteGriffe, 'oeffnungBreite')!;
  check('Mit Nachbarn auf beiden Seiten bindet der nähere: 1,30 m', r3(breiteMitte.max), 1.3);
  check('… die rechte Laibung endet dann bei 3,65 m', r3(3 + r3(breiteMitte.max) / 2), 3.65);
  check('… und hält 5 cm vor dem Nachbarn', r3(3.7 - r3(3 + r3(breiteMitte.max) / 2)), RAND_AN_DER_ECKE);
  pruefeGrundregeln(check, 'Mittleres Fenster', mitteGriffe);

  // --- B.5 Die Lage hält die halbe Breite innerhalb der Grenzen ----------
  //
  // Der Lagegriff verschiebt die **Mitte**. Damit die Öffnung ganz in der
  // Wand und neben dem Nachbarn bleibt, muss die Mitte um die halbe Breite
  // innerhalb der Grenzen bleiben: links 0,05 + 0,50 = 0,55 m, rechts
  // 3,45 − 0,50 = 2,95 m. Ohne den halben Zuschlag ließe sich die Mitte bis
  // an die Grenze schieben — und die Laibung stünde außerhalb der Wand.
  const lageA = griffNach(fensterGriffe, 'oeffnungLage')!;
  check('Der Lagegriff trägt den Abstand ab Wandanfang', lageA.wert, 2);
  check('Die Mitte kommt nicht näher als 0,55 m an den Wandanfang', r3(lageA.min), 0.55);
  check('… und nicht weiter als 2,95 m, wegen fensterB', r3(lageA.max), 2.95);
  const lageB = griffNach(fensterBGriffe, 'oeffnungLage')!;
  check('Für fensterB beginnt der Bereich bei 3,05 m', r3(lageB.min), 3.05);
  check('… und endet bei 5,45 m', r3(lageB.max), 5.45);
  // Eine breitere Öffnung hat einen entsprechend kleineren Spielraum:
  // 1,80 m breit → halbe Breite 0,90 → 0,05 + 0,90 = 0,95 m.
  const breitesFenster = kopie(haus);
  breitesFenster.openings.fensterA.width = 1.8;
  check(
    'Ein 1,80 m breites Fenster beginnt erst bei 0,95 m',
    r3(griffNach(griffeFuer(breitesFenster, fensterAAuswahl), 'oeffnungLage')!.min),
    0.95,
  );

  // --- B.6 Das TGA-Objekt ------------------------------------------------
  //
  // Die Montagehöhe endet 10 cm unter der Wandoberkante: 2,50 − 0,10 =
  // 2,40 m. Ein Heizkörper auf 4,80 m ist kein Heizkörper mehr, sondern ein
  // Zahlendreher — und einer, der in der Heizlastrechnung als Leistung
  // mitzählt, ohne dass ihn je jemand im Raum gesehen hat.
  const objektHoehe = griffNach(objektGriffe, 'objektHoehe')!;
  check('Die Montagehöhe beginnt am Fußboden', objektHoehe.min, 0);
  check('… und endet 10 cm unter der Wandoberkante', r3(objektHoehe.max), 2.4);
  check('Der Längengriff trägt die Baulänge', griffNach(objektGriffe, 'objektLaenge')!.wert, 1);
  check('Der Tiefengriff trägt die Bautiefe', griffNach(objektGriffe, 'objektTiefe')!.wert, 0.1);

  // === C — begrenze und wertAusZug ========================================

  // --- C.1 begrenze ------------------------------------------------------
  check('begrenze schneidet oben ab', begrenze(hoeheGriff, 99), MAX_WANDHOEHE);
  check('begrenze schneidet unten ab', begrenze(hoeheGriff, 0.1), MIN_WANDHOEHE);
  check('begrenze lässt einen gültigen Wert stehen', begrenze(hoeheGriff, 2.62), 2.62);
  check('begrenze rundet auf Millimeter ab', begrenze(hoeheGriff, 2.623_49), 2.623);
  check('begrenze rundet auf Millimeter auf', begrenze(hoeheGriff, 2.623_51), 2.624);
  /*
   * `NaN` entsteht bei jedem Tippfehler im Eingabefeld: aus „2,6" wird beim
   * Umwandeln mit dem Komma eine ungültige Zahl. Der alte Wert ist die
   * einzige brauchbare Antwort. Eine 0 wäre die schlimmste — sie liefe glatt
   * durch `Math.max(min, …)` und setzte die Wand stillschweigend auf ihre
   * Mindesthöhe, also auf ein Maß, das nie jemand gemessen hat.
   */
  check('Aus NaN wird der alte Wert', begrenze(hoeheGriff, Number.NaN), HOEHE);
  check('… und nicht NaN', Number.isFinite(begrenze(hoeheGriff, Number.NaN)), true);
  check('… und nicht 0', begrenze(hoeheGriff, Number.NaN) === 0, false);
  check('Auch aus Unendlich wird der alte Wert', begrenze(hoeheGriff, Number.POSITIVE_INFINITY), HOEHE);

  // --- C.2 wertAusZug: der Zug wird auf die Achse projiziert -------------
  //
  // Man zieht nie genau in der Achse. Was quer dazu geht, soll nichts tun —
  // sonst wandert beim Anheben einer Wand auch ihre Stärke, und zwar um
  // einen Betrag, der von der Handbewegung abhängt und in keinem Aufmaß
  // steht.
  check('Ein Zug von 0,30 m nach oben macht aus 2,50 m 2,80 m', wertAusZug(hoeheGriff, { x: 0, y: 0, z: 0.3 }), 2.8);
  check('Ein Zug nach unten verkleinert', wertAusZug(hoeheGriff, { x: 0, y: 0, z: -0.4 }), 2.1);
  check('Ein rein waagerechter Zug lässt die Wandhöhe stehen', wertAusZug(hoeheGriff, { x: 0.5, y: 0.5, z: 0 }), HOEHE);
  // Schräger Zug: Nur der senkrechte Anteil zählt. 0,8 m nach Norden und
  // 0,20 m nach oben ergeben 2,50 + 0,20 = 2,70 m.
  check('Vom schrägen Zug zählt nur der Anteil in der Achse', wertAusZug(hoeheGriff, { x: 0.8, y: 0, z: 0.2 }), 2.7);
  // Die Grenzen gelten auch beim Ziehen und nicht nur beim Tippen.
  check('Ein sehr langer Zug endet an der Obergrenze', wertAusZug(hoeheGriff, { x: 0, y: 0, z: 9 }), MAX_WANDHOEHE);
  check('… und nach unten an der Untergrenze', wertAusZug(hoeheGriff, { x: 0, y: 0, z: -9 }), MIN_WANDHOEHE);

  /*
   * Der Dickengriff zählt doppelt.
   *
   * Die Wand wächst symmetrisch um ihre Achse — so ist sie im Modell
   * definiert. Zieht man die Außenseite um 5 cm nach außen, wandert die
   * Innenseite um dieselben 5 cm nach innen, und die Wand ist 10 cm dicker.
   * Ohne den Faktor 2 bliebe der Griff hinter dem Zeiger zurück: Man zieht
   * 5 cm und sieht 2,5 cm Bewegung an der Oberfläche, an der man zieht.
   *
   * Die Südwand läuft nach +x, ihre Linksnormale zeigt nach +y. 5 cm in
   * Richtung +y sind also genau ein Zug an der Außenseite: 0,30 → 0,40 m.
   */
  check('Ein Zug von 5 cm am Dickengriff macht die Wand 10 cm dicker', wertAusZug(dickeGriff, { x: 0, y: 0.05, z: 0 }), 0.4);
  check('… und 5 cm nach innen entsprechend dünner', wertAusZug(dickeGriff, { x: 0, y: -0.05, z: 0 }), 0.2);
  check('Ein Zug längs der Wand lässt die Stärke stehen', wertAusZug(dickeGriff, { x: 0.05, y: 0, z: 0 }), DICKE);
  check('Und senkrecht ebenso', wertAusZug(dickeGriff, { x: 0, y: 0, z: 0.05 }), DICKE);
  /*
   * Gegenprobe zum Faktor: Wäre er 1, käme hier 0,35 heraus. Die Zeile steht
   * ausdrücklich da, weil eine Prüfung auf „0,40" allein auch dann bestünde,
   * wenn jemand den Zug versehentlich verdoppelt *und* das Ergebnis halbiert.
   */
  check('… der einfache Zug ergäbe 0,35 und ist nicht das Ergebnis', wertAusZug(dickeGriff, { x: 0, y: 0.05, z: 0 }) === 0.35, false);

  // --- C.3 Das Rastermaß wirkt -------------------------------------------
  //
  // Beim Ziehen wird auf das Rastermaß gefangen — beim Tippen nicht. Der
  // Höhengriff rastet auf den Zentimeter, der Dickengriff auf den halben.
  // Ohne Raster liefert jeder Zug eine Zahl mit fünf Nachkommastellen, und
  // die steht danach als Aufmaß im Dokument.
  check('Der Höhengriff rastet auf den Zentimeter', hoeheGriff.schritt, 0.01);
  check('Der Dickengriff rastet auf den halben Zentimeter', dickeGriff.schritt, 0.005);
  // 2,50 + 0,234 = 2,734 → auf den Zentimeter 2,73.
  check('Ein Zug von 0,234 m ergibt 2,73 m und nicht 2,734 m', wertAusZug(hoeheGriff, { x: 0, y: 0, z: 0.234 }), 2.73);
  // 2,50 + 0,236 = 2,736 → 2,74. Beide Zeilen zusammen zeigen, dass gerundet
  // und nicht abgeschnitten wird.
  check('… und ein Zug von 0,236 m ergibt 2,74 m', wertAusZug(hoeheGriff, { x: 0, y: 0, z: 0.236 }), 2.74);
  // Dickengriff: 4 mm Zug × 2 = 8 mm → 0,308 → auf den halben Zentimeter
  // 0,310. Hier zeigt sich, dass das Raster **nach** der Verdopplung greift.
  check('Am Dickengriff rastet der verdoppelte Zug', wertAusZug(dickeGriff, { x: 0, y: 0.004, z: 0 }), 0.31);

  // === D — aenderungFuer: was im Modell ankommt ===========================
  //
  // Bis hierher ist alles Anzeige. Erst `aenderungFuer` sagt, was der
  // Speicher tun soll — und hier entscheidet sich, ob der Griff hält, was er
  // zeigt.

  // --- D.1 Art und Feld je Griffart --------------------------------------
  //
  // Geprüft wird beides: die Änderungsart (welche Tabelle) und die
  // vollständige Feldliste des Patches (welche Spalte, und keine zweite).
  // Ein Patch, der auf das falsche Feld zeigt, ist der Fehler, den niemand
  // sucht — man zieht am Höhengriff, und die Wand wird dicker.
  const hoeheAe = aenderungFuer(haus, hoeheGriff, 2.8);
  check('Der Höhengriff ändert eine Wand', art(hoeheAe), 'wand');
  check('… und zwar das Feld height', felder(hoeheAe), 'height');
  check('… mit dem neuen Wert', feldwert(hoeheAe, 'height'), 2.8);
  const dickeAe = aenderungFuer(haus, dickeGriff, 0.24);
  check('Der Dickengriff ändert eine Wand', art(dickeAe), 'wand');
  check('… und zwar das Feld thickness', felder(dickeAe), 'thickness');
  check('… mit dem neuen Wert', feldwert(dickeAe, 'thickness'), 0.24);

  const breiteAe = aenderungFuer(haus, breiteA, 1.4);
  check('Der Breitengriff ändert eine Öffnung', art(breiteAe), 'oeffnung');
  check('… und zwar das Feld width', felder(breiteAe), 'width');
  check('… mit dem neuen Wert', feldwert(breiteAe, 'width'), 1.4);
  const lichtAe = aenderungFuer(haus, lichteHoehe, 1.5);
  check('Der Höhengriff der Öffnung ändert height', felder(lichtAe), 'height');
  check('… mit dem neuen Wert', feldwert(lichtAe, 'height'), 1.5);
  const bruestungAe = aenderungFuer(haus, bruestung, 0.8);
  check('Der Brüstungsgriff ändert sillHeight', felder(bruestungAe), 'sillHeight');
  check('… mit dem neuen Wert', feldwert(bruestungAe, 'sillHeight'), 0.8);
  const lageAe = aenderungFuer(haus, lageA, 2.4);
  check('Der Lagegriff ändert distance', felder(lageAe), 'distance');
  check('… mit dem neuen Wert', feldwert(lageAe, 'distance'), 2.4);

  const laengeAe = aenderungFuer(haus, griffNach(objektGriffe, 'objektLaenge')!, 1.4);
  check('Der Längengriff ändert ein Objekt', art(laengeAe), 'objekt');
  check('… und zwar das Feld length', felder(laengeAe), 'length');
  const tiefeAe = aenderungFuer(haus, griffNach(objektGriffe, 'objektTiefe')!, 0.22);
  check('Der Tiefengriff ändert depth', felder(tiefeAe), 'depth');
  const montageAe = aenderungFuer(haus, objektHoehe, 0.6);
  check('Der Höhengriff des Objekts ändert elevation', felder(montageAe), 'elevation');
  check('… mit dem neuen Wert', feldwert(montageAe, 'elevation'), 0.6);

  // Die Grenzen gelten auch hier: Wer 9,00 m tippt, bekommt 6,00 m.
  check('Ein zu großer Wert wird vor dem Patch beschnitten', feldwert(aenderungFuer(haus, hoeheGriff, 9), 'height'), MAX_WANDHOEHE);

  // --- D.2 Das Wandende: der Griff trägt die Länge -----------------------
  //
  // Der Sonderfall, der am ehesten falsch ist. Der Wert am Griff ist die
  // **Länge** der Wand, nicht eine Koordinate — „diese Wand ist 4,12 m lang"
  // ist ein Aufmaß, „der Knoten liegt bei x = 7,34" ist keines. Geändert
  // wird deshalb ein Knoten, und zwar so, dass die Wand vom **festen** Ende
  // aus die neue Länge hat und ihre **Richtung behält**.
  //
  // Die Prüfwand ist das 3-4-5-Dreieck: von (10,00 | 0,00) nach
  // (13,00 | 4,00), Länge 5,00 m, Richtung (0,6 | 0,8). Von Hand gerechnet:
  //   • Ende B auf 4,00 m: fest ist A, neuer Knoten
  //     (10,00 + 0,6·4 | 0,00 + 0,8·4) = (12,400 | 3,200);
  //   • Ende A auf 4,00 m: fest ist B, neuer Knoten
  //     (13,00 − 0,6·4 | 4,00 − 0,8·4) = (10,600 | 0,800).
  // An einer waagerechten Wand wären beide Fälle nicht zu unterscheiden.
  const schraegDoc = baueSchraegeWand();
  const schraegAuswahl: Selection = { kind: 'wall', id: 'schraeg' };
  const schraegGriffe = griffeFuer(schraegDoc, schraegAuswahl);
  const endeA = griffNach(schraegGriffe, 'wandEndeA')!;
  const endeB = griffNach(schraegGriffe, 'wandEndeB')!;
  pruefeGrundregeln(check, 'Schräge Wand', schraegGriffe);
  check('Beide Wandende-Griffe tragen dieselbe Länge', `${endeA.wert}/${endeB.wert}`, '5/5');
  check('Der Griff am Anfang sitzt am Anfangsknoten', `${endeA.punkt.x}/${endeA.punkt.y}`, '10/0');
  check('Der Griff am Ende sitzt am Endknoten', `${endeB.punkt.x}/${endeB.punkt.y}`, '13/4');
  // Die Zugrichtungen zeigen nach außen: am Anfang gegen die Achse, am Ende
  // mit ihr. Zeigten beide in dieselbe Richtung, würde ein Ende beim Ziehen
  // nach außen kürzer statt länger.
  check('Der Anfangsgriff zieht gegen die Achse', `${r3(endeA.achse.x)}/${r3(endeA.achse.y)}`, '-0.6/-0.8');
  check('Der Endgriff zieht mit der Achse', `${r3(endeB.achse.x)}/${r3(endeB.achse.y)}`, '0.6/0.8');

  const endeBAe = aenderungFuer(schraegDoc, endeB, 4);
  check('Das Wandende ändert einen Knoten', art(endeBAe), 'knoten');
  check('… und zwar den Endknoten', endeBAe && endeBAe.art === 'knoten' ? endeBAe.id : 'fehlt', 'ende');
  check('Der Endknoten wandert auf x = 12,400', r3(knotenlage(endeBAe).x), 12.4);
  check('… und auf y = 3,200', r3(knotenlage(endeBAe).y), 3.2);

  const endeAAe = aenderungFuer(schraegDoc, endeA, 4);
  check('Auch am Anfang wird ein Knoten geändert', art(endeAAe), 'knoten');
  check('… und zwar der Anfangsknoten', endeAAe && endeAAe.art === 'knoten' ? endeAAe.id : 'fehlt', 'anfang');
  check('Der Anfangsknoten wandert auf x = 10,600', r3(knotenlage(endeAAe).x), 10.6);
  check('… und auf y = 0,800', r3(knotenlage(endeAAe).y), 0.8);

  /*
   * Das feste Ende bewegt sich nicht.
   *
   * Das ist die halbe Aussage des Griffs: Man misst im Bestand von der Ecke,
   * die steht. Wanderten beide Knoten, verschöbe sich die ganze Wand — und
   * mit ihr alles, was sonst noch an dem Knoten hängt, also die anschließende
   * Wand, deren Länge niemand angefasst hat.
   */
  const nachB = anwenden(schraegDoc, endeBAe!);
  check('Beim Ziehen am Ende bleibt der Anfangsknoten stehen', `${nachB.nodes.anfang.x}/${nachB.nodes.anfang.y}`, '10/0');
  const nachA = anwenden(schraegDoc, endeAAe!);
  check('Beim Ziehen am Anfang bleibt der Endknoten stehen', `${nachA.nodes.ende.x}/${nachA.nodes.ende.y}`, '13/4');
  // Die Richtung bleibt erhalten: (12,400 − 10,000)/(3,200 − 0,000) = 3/4,
  // also dieselbe Steigung wie vorher. Gerechnet wird über das
  // Kreuzprodukt — es ist null, solange die neue Achse parallel zur alten
  // liegt, und zwar unabhängig von der Länge.
  const richtungB = { x: nachB.nodes.ende.x - 10, y: nachB.nodes.ende.y - 0 };
  check('Die Wand behält beim Ziehen am Ende ihre Richtung', r3(richtungB.x * 0.8 - richtungB.y * 0.6), 0);
  const richtungA = { x: 13 - nachA.nodes.anfang.x, y: 4 - nachA.nodes.anfang.y };
  check('… und ebenso beim Ziehen am Anfang', r3(richtungA.x * 0.8 - richtungA.y * 0.6), 0);
  // Und die Wand zeigt weiterhin nach vorn und nicht rückwärts: Das
  // Skalarprodukt mit der alten Richtung muss positiv sein. Ein
  // Vorzeichenfehler ließe die Wand um ihr festes Ende kippen — die Länge
  // stimmte, die Wand stünde auf der anderen Seite.
  check('… und kippt nicht um ihr festes Ende', richtungB.x * 0.6 + richtungB.y * 0.8 > 0, true);
  check('… auch nicht am anderen Ende', richtungA.x * 0.6 + richtungA.y * 0.8 > 0, true);

  // --- D.3 Gelöschte Bauteile liefern keine Änderung ---------------------
  //
  // **Kein stiller Rückfall**: Eine Änderung, die nichts bewirkt, darf keinen
  // Schritt in der Historie erzeugen. Sonst steht im Verlauf ein „Wandhöhe
  // geändert", zu dem es keine Wand mehr gibt — und das Rückgängigmachen
  // führt an einen Punkt, der nie existiert hat.
  const ohneAlles = kopie(haus);
  delete ohneAlles.walls.sued;
  delete ohneAlles.openings.fensterA;
  delete ohneAlles.fixtures.heizkoerper;
  //
  // Gelesen wird über `art`, das aus `null` ein `'fehlt'` macht: Ein dritter
  // Zustand, der gegen jeden Sollwert falsch ist und im Protokoll auch so
  // erscheint. Ein `?? 0` an dieser Stelle machte aus „keine Änderung" eine
  // Zahl und ließe die Zeile nicht mehr scheitern.
  check('Die gelöschte Wand liefert keine Höhenänderung', art(aenderungFuer(ohneAlles, hoeheGriff, 2.8)), 'fehlt');
  check('… keine Dickenänderung', art(aenderungFuer(ohneAlles, dickeGriff, 0.24)), 'fehlt');
  check('… und keine Wandende-Änderung', art(aenderungFuer(ohneAlles, griffNach(wandGriffe, 'wandEndeB')!, 4)), 'fehlt');
  check('Die gelöschte Öffnung liefert keine Breitenänderung', art(aenderungFuer(ohneAlles, breiteA, 1.4)), 'fehlt');
  check('… keine Höhenänderung', art(aenderungFuer(ohneAlles, lichteHoehe, 1.5)), 'fehlt');
  check('… keine Brüstungsänderung', art(aenderungFuer(ohneAlles, bruestung, 0.8)), 'fehlt');
  check('… und keine Lageänderung', art(aenderungFuer(ohneAlles, lageA, 2.4)), 'fehlt');
  check('Das gelöschte Objekt liefert keine Längenänderung', art(aenderungFuer(ohneAlles, griffNach(objektGriffe, 'objektLaenge')!, 1.4)), 'fehlt');
  check('… keine Tiefenänderung', art(aenderungFuer(ohneAlles, griffNach(objektGriffe, 'objektTiefe')!, 0.22)), 'fehlt');
  check('… und keine Höhenänderung', art(aenderungFuer(ohneAlles, objektHoehe, 0.6)), 'fehlt');
  // Auch die Wand ohne Achsknoten: Es gibt keine Richtung, in die der Knoten
  // wandern könnte.
  check('Eine Wand ohne Achsknoten liefert keine Wandende-Änderung', art(aenderungFuer(ohneKnoten, griffNach(wandGriffe, 'wandEndeA')!, 4)), 'fehlt');

  // === E — Fangmaße =======================================================
  //
  // In einem Bestandsgebäude haben alle Fenster einer Fassade dieselbe
  // Brüstungshöhe — nicht ungefähr, sondern genau. Wer das von Hand
  // einstellt, trifft 1,255 statt 1,26 und erzeugt eine Abweichung, die es
  // am Bau nicht gibt und die später jemand für eine Messung hält.
  //
  // Gefangen wird deshalb nur an Maßen, die **im selben Modell** schon
  // vorkommen. Eine Tabelle üblicher Höhen würde Bestandsmaße auf Neubaumaße
  // ziehen, und das ist das Gegenteil von Aufmaß.
  const fassade = baueFassade();
  const f4Auswahl: Selection = { kind: 'opening', id: 'f4' };
  const f4Griffe = griffeFuer(fassade, f4Auswahl);
  const f4Bruestung = griffNach(f4Griffe, 'oeffnungBruestung')!;

  // --- E.1 Nur Maße aus dem Modell ---------------------------------------
  //
  // Drei Fenster auf 0,90 m, das vierte auf 0,60 m. Angeboten wird genau die
  // 0,90 — einmal, obwohl sie dreimal vorkommt, und sonst nichts. Käme hier
  // eine 1,00 oder eine 0,85 dazu, stammte sie aus einer Tabelle und nicht
  // aus dem Haus.
  const bruestungsmasse = fangmasse(fassade, f4Bruestung);
  check('Für die vierte Brüstung gibt es genau ein Fangmaß', bruestungsmasse.length, 1);
  check('… und das sind die 0,90 m der anderen drei', bruestungsmasse[0], 0.9);

  // --- E.2 Der eigene Wert ist nicht dabei --------------------------------
  //
  // Man fängt nicht an sich selbst. Für ein Fenster, das schon auf 0,90 m
  // sitzt, ist die 0,90 kein Angebot — angeboten wird die abweichende 0,60.
  // Stünde der eigene Wert in der Liste, rastete der Griff beim kleinsten
  // Zug wieder auf den Ausgangswert zurück und ließe sich nicht mehr
  // verstellen.
  const f1Bruestung = griffNach(griffeFuer(fassade, { kind: 'opening', id: 'f1' }), 'oeffnungBruestung')!;
  const f1Masse = fangmasse(fassade, f1Bruestung);
  check('Der eigene Wert steht nicht in der Liste', f1Masse.includes(0.9), false);
  check('… angeboten wird die abweichende Brüstung', f1Masse.join('/'), '0.6');

  // --- E.3 Angebotene Maße liegen innerhalb der Grenzen -------------------
  //
  // Ein Fangmaß außerhalb von min/max wäre ein Angebot, das der Griff im
  // nächsten Schritt selbst wieder beschneidet — der Zeiger rastete sichtbar
  // ein, und der Wert stünde danach woanders.
  const alleFangmasse = [...f4Griffe, ...griffeFuer(fassade, { kind: 'wall', id: 'fassade' })].flatMap((g) =>
    fangmasse(fassade, g).map((v) => ({ g, v })),
  );
  check('Es gibt überhaupt Fangmaße zu prüfen', alleFangmasse.length > 0, true);
  check(
    'Jedes angebotene Maß liegt innerhalb der Griffgrenzen',
    alleFangmasse.every(({ g, v }) => v >= g.min && v <= g.max),
    true,
  );

  // --- E.4 Nur Öffnungen derselben Art -----------------------------------
  //
  // Eine Tür ist kein Fangmaß für ein Fenster. Die Haustür in derselben Wand
  // ist 0,90 m breit — das liegt mitten im zulässigen Bereich des vierten
  // Fensters (0,20 bis 2,60 m), fiele also nicht schon durch die Grenze
  // heraus. Dass sie trotzdem fehlt, ist der Beweis, dass nach Art gefiltert
  // wird.
  const f4Breite = griffNach(f4Griffe, 'oeffnungBreite')!;
  const breitenmasse = fangmasse(fassade, f4Breite);
  check('Die Türbreite läge im zulässigen Bereich des Fensters', 0.9 >= f4Breite.min && 0.9 <= f4Breite.max, true);
  check('Für die Fensterbreite gibt es genau ein Fangmaß', breitenmasse.length, 1);
  check('… und das ist die Fensterbreite der anderen, nicht die Türbreite', breitenmasse[0], 1);
  /*
   * Die Gegenprobe von der anderen Seite: Die Tür ist die einzige ihrer Art
   * in diesem Modell. Für ihre lichte Höhe darf es deshalb **kein** Fangmaß
   * geben — obwohl vier Fensterhöhen (1,30 und 1,10 m) im Modell stehen und
   * beide in ihren Bereich (0,20 bis 2,50 m) fallen. Ohne den Artfilter
   * stünden hier zwei Werte.
   */
  const tuerHoehe = griffNach(griffeFuer(fassade, { kind: 'opening', id: 'haustuer' }), 'oeffnungHoehe')!;
  check('Die Fensterhöhen lägen im Bereich der Tür', 1.3 >= tuerHoehe.min && 1.3 <= tuerHoehe.max, true);
  check('Für die einzige Tür gibt es kein Fangmaß', fangmasse(fassade, tuerHoehe).length, 0);

  // --- E.5 Wandhöhe und Wandstärke ---------------------------------------
  //
  // Bei der Wandhöhe zählt die Geschosshöhe mit: Sie ist das Maß, auf das im
  // Neubau alle Wände eines Geschosses gehen, und im Bestand das, was der
  // Planer eingetragen hat. Die Liste kommt aufsteigend — der Betrachter
  // zeichnet sie als Leiter neben dem Griff, und eine unsortierte Leiter
  // liest niemand.
  const geschossHaus = baueHaus();
  geschossHaus.levels.eg.height = 2.6;
  geschossHaus.walls.ost.height = 2.75;
  geschossHaus.walls.nord.height = 2.75;
  geschossHaus.walls.west.height = 3.1;
  geschossHaus.walls.ost.thickness = 0.24;
  geschossHaus.walls.nord.thickness = 0.24;
  geschossHaus.walls.west.thickness = 0.365;
  const geschossWand = griffeFuer(geschossHaus, wandAuswahl);
  const hoehenmasse = fangmasse(geschossHaus, griffNach(geschossWand, 'wandHoehe')!);
  check('Die Wandhöhe bietet drei Maße an', hoehenmasse.length, 3);
  check('… aufsteigend sortiert, mit der Geschosshöhe darin', hoehenmasse.join('/'), '2.6/2.75/3.1');
  const dickenmasse = fangmasse(geschossHaus, griffNach(geschossWand, 'wandDicke')!);
  check('Die Wandstärke bietet zwei Maße an', dickenmasse.length, 2);
  check('… ebenfalls aufsteigend', dickenmasse.join('/'), '0.24/0.365');

  // --- E.6 fange: die Fangweite von beiden Seiten ------------------------
  //
  // Zwei Zentimeter: eng genug, dass man jeden Zwischenwert erreicht, wenn
  // man ihn wirklich will, und weit genug, dass man das gemeinsame Maß nicht
  // verfehlt. Geprüft wird beides — eine Prüfung nur auf „fängt" ließe eine
  // Fangweite von zwei Metern durchgehen, und der Griff ließe sich dann gar
  // nicht mehr frei setzen.
  check('Knapp innerhalb der Fangweite wird gefangen', fange([0.9], 0.919), 0.9);
  check('… auch von unten', fange([0.9], 0.881), 0.9);
  check('Knapp außerhalb bleibt der Wert stehen', fange([0.9], 0.921), 0.921);
  check('… auch von unten', fange([0.9], 0.879), 0.879);
  check('Weit weg bleibt der Wert erst recht stehen', fange([0.9], 1.4), 1.4);
  // Genau auf der Grenze wird nicht gefangen: Die Fangweite ist ein offenes
  // Intervall. Das ist die Seite, auf der man den Wert noch selbst setzen
  // kann — die wichtigere von beiden.
  check('Genau auf der Fangweite wird nicht gefangen', fange([0.9], 0.92), 0.92);
  // Bei mehreren Angeboten gewinnt das nächste, nicht das erste in der Liste.
  check('Von mehreren Maßen gewinnt das nächste', fange([0.6, 0.9, 1.26], 0.895), 0.9);
  check('… unabhängig von der Reihenfolge', fange([1.26, 0.9, 0.6], 0.895), 0.9);
  // Ohne Angebote bleibt alles, wie es ist.
  check('Ohne Fangmaße bleibt der Wert stehen', fange([], 1.234), 1.234);
  // Eine größere Fangweite fängt weiter — das Maß ist ein Parameter und
  // keine im Code eingebackene Zahl.
  check('Eine größere Fangweite fängt weiter', fange([0.9], 0.94, 0.05), 0.9);

  // === F — Der Rundlauf ===================================================
  //
  // Die Prüfung, die eine ganze Klasse von Fehlern fängt: ein Griff, der
  // etwas anzeigt, das er nicht ändert. Jeder Griff wird geholt, über
  // `aenderungFuer` auf einen neuen Wert gesetzt, die Änderung von Hand auf
  // eine Kopie angewendet — der Speicher ist Oberflächenschicht und steht
  // hier nicht zur Verfügung — und der Griff danach erneut geholt. Trägt er
  // jetzt den neuen Wert, stimmen Anzeige und Wirkung überein.
  //
  // Ohne diesen Abschnitt bliebe ein Patch auf das falsche Feld unentdeckt,
  // solange nur Art und Feldname zueinander passen: Ein Brüstungsgriff, der
  // `height` statt `sillHeight` schriebe, käme durch Abschnitt D, wenn dort
  // jemand den Sollwert mitändert. Hier nicht — dort steht danach eine
  // andere Zahl am Griff.
  const rundlauf: Array<{ auswahl: Selection; art: string; ziel: number }> = [
    { auswahl: wandAuswahl, art: 'wandHoehe', ziel: 2.8 },
    { auswahl: wandAuswahl, art: 'wandDicke', ziel: 0.24 },
    { auswahl: fensterAAuswahl, art: 'oeffnungBreite', ziel: 1.4 },
    { auswahl: fensterAAuswahl, art: 'oeffnungHoehe', ziel: 1.5 },
    { auswahl: fensterAAuswahl, art: 'oeffnungLage', ziel: 2.4 },
    { auswahl: fensterAAuswahl, art: 'oeffnungBruestung', ziel: 0.8 },
    { auswahl: objektAuswahl, art: 'objektLaenge', ziel: 1.4 },
    { auswahl: objektAuswahl, art: 'objektTiefe', ziel: 0.22 },
    { auswahl: objektAuswahl, art: 'objektHoehe', ziel: 0.6 },
  ];
  for (const fall of rundlauf) {
    const vorher = griffNach(griffeFuer(haus, fall.auswahl), fall.art)!;
    const aenderung = aenderungFuer(haus, vorher, fall.ziel);
    check(`Rundlauf ${fall.art}: es gibt eine Änderung`, aenderung !== null, true);
    const nachher = erneut(anwenden(haus, aenderung!), fall.auswahl, vorher.id);
    check(`Rundlauf ${fall.art}: der Griff gibt es danach noch`, nachher !== undefined, true);
    check(`Rundlauf ${fall.art}: er trägt jetzt den neuen Wert`, r3(nachher?.wert ?? -1), fall.ziel);
    check(`Rundlauf ${fall.art}: und er hat dieselbe id behalten`, nachher?.id ?? 'fehlt', vorher.id);
  }

  /*
   * Das Wandende gesondert, weil sein Rundlauf über die Geometrie führt: Der
   * Patch setzt eine Koordinate, der Griff liest danach eine Länge. Genau
   * dazwischen liegt der Fehler, den dieser Abschnitt sucht — die Länge
   * ergibt sich aus zwei auf Millimeter gerundeten Koordinaten und nicht aus
   * der Zahl, die getippt wurde.
   */
  for (const fall of [
    { art: 'wandEndeA', festerKnoten: 'ende', festeLage: '13/4' },
    { art: 'wandEndeB', festerKnoten: 'anfang', festeLage: '10/0' },
  ]) {
    const vorher = griffNach(griffeFuer(schraegDoc, schraegAuswahl), fall.art)!;
    const aenderung = aenderungFuer(schraegDoc, vorher, 4);
    const danach = anwenden(schraegDoc, aenderung!);
    const nachher = erneut(danach, schraegAuswahl, vorher.id);
    check(`Rundlauf ${fall.art}: die Wand ist danach 4,00 m lang`, r3(nachher?.wert ?? -1), 4);
    check(
      `Rundlauf ${fall.art}: das feste Ende hat sich nicht bewegt`,
      `${danach.nodes[fall.festerKnoten].x}/${danach.nodes[fall.festerKnoten].y}`,
      fall.festeLage,
    );
    // Und der zweite Griff derselben Wand zeigt dieselbe neue Länge — beide
    // messen dasselbe Maß, sie ändern es nur von verschiedenen Seiten.
    const anderer = fall.art === 'wandEndeA' ? 'wandEndeB' : 'wandEndeA';
    check(
      `Rundlauf ${fall.art}: auch der Griff am anderen Ende zeigt 4,00 m`,
      r3(griffNach(griffeFuer(danach, schraegAuswahl), anderer)?.wert ?? -1),
      4,
    );
  }

  /*
   * Ein zweiter Durchgang über denselben Griff.
   *
   * Zieht man zweimal hintereinander, muss der zweite Zug vom Ergebnis des
   * ersten ausgehen. Ein Griff, der seinen Wert aus einem Zwischenspeicher
   * statt aus dem Dokument liest, bestünde den ersten Rundlauf und fiele
   * hier durch — und in der Bedienung äußerte sich das als ein Griff, der
   * beim zweiten Anfassen zurückspringt.
   */
  const einmal = anwenden(haus, aenderungFuer(haus, hoeheGriff, 2.8)!);
  const zwischenGriff = erneut(einmal, wandAuswahl, hoeheGriff.id)!;
  const zweimal = anwenden(einmal, aenderungFuer(einmal, zwischenGriff, 3.05)!);
  check('Der zweite Zug geht vom Ergebnis des ersten aus', r3(erneut(zweimal, wandAuswahl, hoeheGriff.id)?.wert ?? -1), 3.05);
  check('… und der Zug aus dem zwischenzeitlichen Griff rechnet mit 2,80 m', wertAusZug(zwischenGriff, { x: 0, y: 0, z: 0.2 }), 3);

  // === G — Ein Zug, der nichts bewegt, ändert nichts =======================

  /*
   * =====================================================================
   * Der Fehler, den dieser Abschnitt für immer ausschließt
   * =====================================================================
   *
   * `wertAusZug` rastete bis zur Reparatur nicht die *Änderung*, sondern den
   * *Absolutwert*:
   *
   *     const roh = griff.wert + anteil * faktor;
   *     const gerastert = Math.round(roh / griff.schritt) * griff.schritt;
   *
   * War `anteil` null — ein Antippen ohne Bewegung, ein Zug quer zur Achse —,
   * dann war `roh` der alte Wert, und der wurde trotzdem aufs Raster gezogen.
   * Jedes Maß, das nicht ohnehin auf dem Zentimeter lag, wanderte damit beim
   * bloßen Anfassen um bis zu einen halben Rasterschritt.
   *
   * Betroffen waren ausgerechnet die **Regelmaße**: 12 der 15 Einträge in
   * `OPENING_PRESETS` tragen mindestens ein Maß abseits des Zentimeters
   * (Rohbaumaße nach DIN 18100 — 0,885 · 1,135 · 1,385 · 1,76 · 2,01 ·
   * 2,135; nachgezählt), und ebenso jede abgelesene
   * Raumhöhe wie 2,625 m. Aus einer Tür mit 0,885 m wurde durch Anfassen eine
   * mit 0,890 m, aus 2,135 m Höhe wurden 2,130 m — die Sprungrichtung hing an
   * der Gleitkommadarstellung (0,885/0,01 = 88,50000000000001 → 89, aber
   * 2,135/0,01 = 213,49999999999997 → 213) und war damit nicht einmal
   * vorhersehbar. Im Massenauszug stand danach ein Maß, das niemand gemessen
   * hatte.
   *
   * **Die Entscheidung dahinter, und sie gilt weiter:** Das Raster ist eine
   * Hilfe fürs Ziehen, das Feld ist fürs Aufmaß. Ein Aufmaß, das schon
   * dasteht, darf ein Zug nicht anfassen — auch dann nicht, wenn das Ergebnis
   * dadurch krumm bleibt. Ein Zug von 20 cm auf eine 0,885-m-Tür ergibt
   * deshalb **1,085 m** und nicht 1,090 m: Die abgelesene Zahl bleibt
   * erhalten, die Änderung ist rund. Wer runde Ergebnisse will, bekommt sie
   * über die Fangmaße (Abschnitt E) — dort, wo Rundheit tatsächlich eine
   * Bedeutung hat, weil ein anderes Bauteil dasselbe Maß trägt.
   */
  const katalog = baueKatalogtueren();
  const t88Breite = griffNach(griffeFuer(katalog, { kind: 'opening', id: 't88' }), 'oeffnungBreite')!;
  const t88Hoehe = griffNach(griffeFuer(katalog, { kind: 'opening', id: 't88' }), 'oeffnungHoehe')!;
  const t101Hoehe = griffNach(griffeFuer(katalog, { kind: 'opening', id: 't101' }), 'oeffnungHoehe')!;
  const t101Breite = griffNach(griffeFuer(katalog, { kind: 'opening', id: 't101' }), 'oeffnungBreite')!;

  // Erst die Eingangslage: Die Griffe tragen die Katalogmaße unverändert.
  check('Der Breitengriff von door-88 trägt 0,885 m', t88Breite.wert, 0.885);
  check('Der Höhengriff von door-101 trägt 2,135 m', t101Hoehe.wert, 2.135);
  // Die Wand läuft nach +x; ein Zug nach +y ist bei beiden Griffen quer zur
  // Achse und hat einen Anteil von genau null.
  check(
    'Querzug an der 0,885-m-Breite lässt das Katalogmaß stehen',
    wertAusZug(t88Breite, { x: 0, y: 0.5, z: 0 }),
    0.885,
  );
  check(
    'Ein Zug der Länge null ebenso — Antippen verstellt nichts',
    wertAusZug(t88Breite, { x: 0, y: 0, z: 0 }),
    0.885,
  );
  check(
    'Querzug an der 2,135-m-Höhe lässt das Katalogmaß stehen',
    wertAusZug(t101Hoehe, { x: 0.7, y: 0, z: 0 }),
    2.135,
  );
  check(
    'Und der Zug der Länge null ebenso',
    wertAusZug(t101Hoehe, { x: 0, y: 0, z: 0 }),
    2.135,
  );

  /*
   * Die Gegenprobe, die den Befund einkreist: Liegt das Maß auf dem Raster,
   * passiert nichts — wie versprochen. Damit ist ausgeschlossen, dass die
   * Projektion auf die Achse falsch rechnet; der Anteil ist in allen sechs
   * Fällen null, und nur die Rasterung macht daraus einmal eine Änderung und
   * einmal keine. Diese beiden Zeilen bestehen vorher wie nachher.
   */
  check('Gegenprobe: 2,010 m liegt auf dem Raster und bleibt stehen', wertAusZug(t88Hoehe, { x: 0.7, y: 0, z: 0 }), 2.01);
  check('Gegenprobe: 1,010 m ebenso', wertAusZug(t101Breite, { x: 0, y: 0.5, z: 0 }), 1.01);
  /*
   * Die Gegenprobe in die andere Richtung — und zugleich die Zeile, an der
   * die Entscheidung von oben hängt: Ein **echter** Zug von 20 cm auf die
   * 0,885-m-Tür ergibt **1,085 m**. Gerastert ist die Änderung (0,20 m liegt
   * auf dem Zentimeter), nicht das Ergebnis. Die abgelesenen fünf Millimeter
   * überleben den Zug; sie sind eine Messung und kein Rundungsrest.
   *
   * Stünde hier 1,09, wäre das Raster wieder stärker als das Aufmaß, und der
   * Fehler von oben käme durch die Hintertür zurück.
   */
  check('Ein echter Zug von 0,20 m ergibt 1,085 m — die Messung überlebt', wertAusZug(t88Breite, { x: 0.2, y: 0, z: 0 }), 1.085);

  // === H — Die Obergrenze der Breite, wenn der Platz nicht reicht =========
  //
  // Abschnitt B.4 prüft den Normalfall: Die Öffnung darf wachsen, bis links
  // und rechts noch `RAND_AN_DER_ECKE` Wand steht. Hier geht es um den Fall
  // **darunter** — wenn nicht einmal `MIN_OEFFNUNG` Platz ist.
  //
  // Die Rechnung im Modul, damit die Zahlen unten nachvollziehbar sind:
  //
  //     linkeGrenze  = max(0,05 ; linke Laibung des linken Nachbarn + 0,05)
  //     rechteGrenze = min(Wandlänge − 0,05 ; linke Laibung des rechten
  //                        Nachbarn − 0,05)
  //     verfügbar    = 2 · min(Mitte − linkeGrenze ; rechteGrenze − Mitte)
  //
  // `verfügbar` ist also **kein** Maß für den Abstand zwischen zwei
  // Öffnungen, sondern die größte Breite, die diese Öffnung um ihre Mitte
  // annehmen darf. Die Öffnung wächst symmetrisch, deshalb zählt die engere
  // Seite doppelt. Beides auseinanderzuhalten ist der ganze Abschnitt:
  // „zwischen den Fenstern stehen nur 12 cm Wand" und „das Fenster darf
  // nicht mehr wachsen" sind zwei verschiedene Aussagen.

  // --- H.1 Zwölf Zentimeter zwischen den Laibungen -----------------------
  //
  // `weitA` auf 2,00 m und `weitB` auf 3,12 m, beide 1,00 m breit: Die
  // rechte Laibung von `weitA` liegt bei 2,50 m, die linke von `weitB` bei
  // 3,62 − 1,00/2 = 2,62 m. Zwischen ihnen stehen 12 cm Wand, also weniger
  // als `MIN_OEFFNUNG` — und trotzdem gilt die normale Regel, weil um die
  // Mitte von `weitA` herum reichlich Platz ist:
  //   • rechteGrenze = 2,62 − 0,05 = 2,57 m, davon bis zur Mitte 0,57 m;
  //   • linkeGrenze  = 0,05 m, davon bis zur Mitte 1,95 m;
  //   • verfügbar    = 2 × 0,57 = 1,14 m.
  const engeNachbarn = baueEngeNachbarn();
  const weitAAuswahl: Selection = { kind: 'opening', id: 'weitA' };
  const weitABreite = griffNach(griffeFuer(engeNachbarn, weitAAuswahl), 'oeffnungBreite')!;
  check('Zwischen den beiden Fenstern stehen 12 cm Wand', r3(3.12 - 0.5 - (2 + 0.5)), 0.12);
  check('… das ist weniger als die kleinste Öffnung', 0.12 < MIN_OEFFNUNG, true);
  check('Die größte Breite von weitA ist trotzdem 1,14 m', r3(weitABreite.max), 1.14);
  check('… und die Untergrenze bleibt das Mindestmaß', weitABreite.min, MIN_OEFFNUNG);
  check('… min liegt nicht über max', weitABreite.min <= weitABreite.max, true);

  /*
   * **Die eigentliche Zusage**, und sie hängt nicht an der Zahl in `max`:
   * Wer über den Griff so weit aufzieht, wie es geht, darf den Nachbarn
   * nicht berühren. Geprüft wird deshalb nicht die Obergrenze, sondern das
   * Ergebnis — die beiden Laibungskanten nach der Änderung.
   *
   * 2,00 ± 1,14/2 ergibt 1,43 … 2,57 m; die linke Laibung von `weitB` liegt
   * bei 2,62 m. Bleiben genau die 5 cm, unterhalb derer `wallSolidParts` ein
   * Wandstück von null Länge erzeugt, das im Bild verschwindet.
   */
  const weitAWeit = aenderungFuer(engeNachbarn, weitABreite, 5);
  check('Eine Verbreiterung über jedes Maß hinaus ergibt eine Änderung', art(weitAWeit), 'oeffnung');
  check('… und wird auf 1,14 m beschnitten', r3(feldwert(weitAWeit, 'width')), 1.14);
  const nachWeit = anwenden(engeNachbarn, weitAWeit!);
  const laibungRechtsA = nachWeit.openings.weitA.distance + nachWeit.openings.weitA.width / 2;
  const laibungLinksB = nachWeit.openings.weitB.distance - nachWeit.openings.weitB.width / 2;
  check('Die rechte Laibung von weitA endet bei 2,57 m', r3(laibungRechtsA), 2.57);
  check('Die linke Laibung von weitB beginnt bei 2,62 m', r3(laibungLinksB), 2.62);
  check('Zwischen beiden bleiben 5 cm Wand', r3(laibungLinksB - laibungRechtsA), RAND_AN_DER_ECKE);
  check('… und keinesfalls weniger', r3(laibungLinksB - laibungRechtsA) >= RAND_AN_DER_ECKE, true);

  // --- H.2 Eine Öffnung, die den Rand schon überschreitet ----------------
  //
  // Schlitz 0,24 m breit auf 2,00 m, Nachbar 0,20 m breit auf 2,25 m:
  //   • linke Laibung des Nachbarn 2,25 − 0,10 = 2,15 m;
  //   • rechteGrenze 2,15 − 0,05 = 2,10 m, davon bis zur Mitte 0,10 m;
  //   • verfügbar = 2 × 0,10 = 0,20 m — die Öffnung ist 4 cm zu breit.
  //
  // **Die Regel, um die hier gerungen wurde.** Sie hat drei Anläufe
  // gebraucht, und der Prüfstein ist am Ende eine einzige Eigenschaft: Die
  // heutige Breite muss **innerhalb** der Grenzen liegen. Nur dann kann ein
  // Antippen sie nicht verschieben — und genau das war der Fehler, der alle
  // drei Anläufe überlebt hat.
  //
  // Daraus folgen zwei getrennte Grenzen, weil es zwei getrennte Fragen sind.
  // Nach oben: der Platz, und wo eine Öffnung ihn schon überschreitet, ihre
  // heutige Breite — sie darf bleiben, aber nicht weiter wachsen. Nach unten:
  // das Mindestmaß, und wo Platz oder Breite kleiner sind, eben dieser Wert —
  // sie soll sich auf ein zulässiges Maß bringen **lassen**.
  //
  // Die Alternative wäre, beim ersten Anfassen zurechtzustutzen. Sie ist
  // verworfen: Ein Werkzeug, das ein erfasstes Maß ungefragt ändert, ist
  // schlimmer als eines, das eine vorhandene Verletzung stehen lässt. Die
  // Verletzung gehört in die Prüfliste, nicht in einen stillen Eingriff.
  const grenzfall = baueSchlitzWand(0.24, 2.25);
  const schlitzAuswahl: Selection = { kind: 'opening', id: 'schlitz' };
  const grenzBreite = griffNach(griffeFuer(grenzfall, schlitzAuswahl), 'oeffnungBreite')!;
  check('Der Griff trägt die heutigen 0,24 m', grenzBreite.wert, 0.24);
  check('Die heutige Breite liegt innerhalb der Grenzen', grenzBreite.wert >= grenzBreite.min && grenzBreite.wert <= grenzBreite.max, true);
  check('Die Obergrenze ist die heutige Breite — wachsen geht nicht mehr', r3(grenzBreite.max), 0.24);
  check('Die Untergrenze lässt das Zurechtrücken zu', r3(grenzBreite.min), 0.2);
  check('… min liegt nicht über max', grenzBreite.min <= grenzBreite.max, true);
  // Ein Zug nach außen bewegt nichts mehr.
  const nachGrenze = anwenden(grenzfall, aenderungFuer(grenzfall, grenzBreite, 5)!);
  check('Ein Zug nach außen lässt die Breite stehen', r3(nachGrenze.openings.schlitz.width), 0.24);
  check(
    'Vor der Änderung stehen nur 3 cm zwischen den Laibungen',
    r3(2.25 - 0.1 - (2 + 0.24 / 2)),
    0.03,
  );
  // … und von Hand auf das zulässige Maß gebracht, stehen die 5 cm wieder.
  const zurecht = anwenden(grenzfall, aenderungFuer(grenzfall, grenzBreite, 0.2)!);
  check(
    'Auf 0,20 m gebracht stehen die 5 cm wieder',
    r3(2.25 - 0.1 - (2 + zurecht.openings.schlitz.width / 2)),
    RAND_AN_DER_ECKE,
  );

  // --- H.3 Unterhalb der Kante: die heutige Breite ist die Obergrenze ----
  //
  // Schlitz 0,26 m breit auf 2,00 m, Nachbar 0,20 m breit auf 2,24 m:
  //   • linke Laibung des Nachbarn 2,14 m, rechteGrenze 2,09 m;
  //   • verfügbar = 2 × 0,09 = 0,18 m — weniger als `MIN_OEFFNUNG`.
  //
  // Auch hier gilt: Die heutige Breite bleibt stehen (Obergrenze 0,26 m,
  // wachsen geht nicht), und die Untergrenze fällt auf den Platz von 0,18 m —
  // dorthin lässt sich die Öffnung bringen, und dann steht der 5-cm-Rand
  // wieder. Das Mindestmaß von 0,20 m gilt hier ausdrücklich **nicht**: Es
  // würde verhindern, dass die Verletzung überhaupt zu beheben ist.
  const schmal = baueSchlitzWand(0.26, 2.24);
  const schmalBreite = griffNach(griffeFuer(schmal, schlitzAuswahl), 'oeffnungBreite')!;
  check('Der verfügbare Platz reicht nicht für die kleinste Öffnung', r3(2 * (2.24 - 0.1 - 0.05 - 2)), 0.18);
  check('Die Obergrenze ist die heutige Breite von 0,26 m', r3(schmalBreite.max), 0.26);
  check('Die Untergrenze fällt auf den Platz von 0,18 m', r3(schmalBreite.min), 0.18);
  check('… und ausdrücklich nicht auf das Mindestmaß 0,20 m', r3(schmalBreite.min) === MIN_OEFFNUNG, false);
  check('Die heutige Breite liegt innerhalb der Grenzen', schmalBreite.wert >= schmalBreite.min && schmalBreite.wert <= schmalBreite.max, true);
  check('… min liegt nicht über max', schmalBreite.min <= schmalBreite.max, true);
  // Ein Zug nach außen ändert die Breite nicht mehr …
  const schmalWeit = aenderungFuer(schmal, schmalBreite, 5);
  check('Eine Verbreiterung bewegt nichts mehr', r3(feldwert(schmalWeit, 'width')), 0.26);
  const nachSchmal = anwenden(schmal, schmalWeit!);
  check(
    'Die Öffnung ist danach keinen Millimeter breiter',
    r3(nachSchmal.openings.schlitz.width - schmal.openings.schlitz.width),
    0,
  );
  // Und auf den Platz gebracht steht der Rand wieder.
  const schmalZurecht = anwenden(schmal, aenderungFuer(schmal, schmalBreite, 0.18)!);
  check(
    'Auf 0,18 m gebracht stehen die 5 cm wieder',
    r3(2.24 - 0.1 - (2 + schmalZurecht.openings.schlitz.width / 2)),
    RAND_AN_DER_ECKE,
  );
  // … kleiner werden darf sie weiterhin, sonst wäre der Griff tot.
  check('Kleiner als der Platz geht nicht — dort ist die Untergrenze', r3(feldwert(aenderungFuer(schmal, schmalBreite, 0.12), 'width')), 0.18);

  /*
   * =====================================================================
   * Warum diese beiden Zeilen hier stehen
   * =====================================================================
   *
   * Sie halten fest, was zwei Anläufe **nicht** geleistet haben.
   *
   * `Math.max(MIN_OEFFNUNG, verfuegbar)` — der erste Entwurf — hob die
   * Grenze genau dort an, wo sie greifen sollte. Der zweite Entwurf setzte
   * bei zu wenig Platz die *heutige Breite* als Obergrenze; das verhinderte
   * das Wachsen, schützte den Rand aber ebenso wenig. Rechnet man die
   * Bedingung zurück, ist `verfuegbar < MIN_OEFFNUNG` gleichbedeutend mit
   * `Breite + 2·Spalt < 0,30 m`; bei eingehaltenem Rand (Spalt ≥ 0,05) heißt
   * das `Breite < 0,20 m`. Aus einem regelkonformen Modell heraus war der
   * Zweig also gar nicht erreichbar — er fror nur eine schon vorhandene
   * Verletzung ein.
   *
   * Seit der dritten Fassung ist die Obergrenze schlicht der Platz, und die
   * Untergrenze geht mit. Die beiden Zeilen unten prüfen genau das Ergebnis:
   * Die Grenze liegt **unter** dem Mindestmaß, und zwischen den Laibungen
   * stehen danach die vollen 5 cm.
   */
  check('Die Untergrenze liegt unter dem Mindestmaß — der Platz entscheidet', r3(schmalBreite.min) < MIN_OEFFNUNG, true);

  // --- H.4 Die Öffnung aus dem Import: schmaler als das Mindestmaß -------
  //
  // Schlitz 0,16 m breit auf 2,00 m, Nachbar 0,20 m breit auf 2,23 m. Hier
  // ist der 5-cm-Rand heute **intakt**: rechte Laibung 2,08 m, linke Laibung
  // des Nachbarn 2,13 m. Verfügbar sind 2 × (2,08 − 2,00) = 0,16 m, also
  // weniger als `MIN_OEFFNUNG`; die Obergrenze wird damit
  // `Math.max(0,16 ; 0,20) = 0,20 m` — und das ist zugleich die Untergrenze.
  const importiert = baueSchlitzWand(0.16, 2.23);
  const importBreite = griffNach(griffeFuer(importiert, schlitzAuswahl), 'oeffnungBreite')!;
  check('Der Import-Schlitz ist 0,16 m breit', importBreite.wert, 0.16);
  check('Der 5-cm-Rand ist vor der Änderung intakt', r3(2.23 - 0.1 - (2 + 0.16 / 2)), RAND_AN_DER_ECKE);
  check('Die Obergrenze ist hier der Platz von 0,16 m', r3(importBreite.max), 0.16);
  check('… min liegt nicht über max', importBreite.min <= importBreite.max, true);

  /*
   * =====================================================================
   * Der Griff als Anzeiger, wenn kein Platz ist
   * =====================================================================
   *
   * Ein 16 cm breiter Schlitz aus einem Import, mit genau 5 cm Wand zum
   * Nachbarn. Der Platz beträgt 0,16 m — weniger als das Mindestmaß.
   *
   * **Was hier früher geschah:** `min` und `max` waren beide `MIN_OEFFNUNG`.
   * Jede Berührung des Griffs kam durch `begrenze` als 0,20 m heraus, auch
   * die Eingabe des alten Wertes; vom intakten 5-cm-Rand blieben danach drei
   * Zentimeter, und genau darunter erzeugt `wallSolidParts` das Wandstück
   * ohne Fläche.
   *
   * **Was jetzt geschieht:** Obergrenze und Untergrenze fallen beide auf den
   * verfügbaren Platz von 0,16 m. Der Griff nennt das Maß und ändert es
   * nicht — er ist ein Anzeiger und kein Steller. Das ist die ehrliche
   * Antwort auf „hier ist kein Platz"; ein Griff, der stattdessen den Rand
   * auffrisst, wäre die unehrliche.
   */
  check('Die Untergrenze ist der Platz von 0,16 m', r3(importBreite.min), 0.16);
  check('Die Obergrenze ebenfalls — hier ist kein Platz', r3(importBreite.max), 0.16);
  check('Der Griff zeigt damit nur an und stellt nichts', r3(importBreite.min) === r3(importBreite.max), true);
  const nachImport = anwenden(importiert, aenderungFuer(importiert, importBreite, 0.16)!);
  check('Die Eingabe des alten Maßes lässt es unverändert', r3(nachImport.openings.schlitz.width), 0.16);
  check(
    'Der intakte 5-cm-Rand bleibt intakt',
    r3(2.23 - 0.1 - (2 + nachImport.openings.schlitz.width / 2)),
    RAND_AN_DER_ECKE,
  );
  /*
   * Und die Gegenprobe, die den Kern festhält: Auch der Versuch, ihn auf das
   * Mindestmaß zu bringen, endet beim Platz. Ohne diese Zeile stünde nur da,
   * dass 0,16 m 0,16 m bleibt — und das täte auch ein Griff, der gar nichts
   * tut.
   */
  const nachImportWeit = anwenden(importiert, aenderungFuer(importiert, importBreite, MIN_OEFFNUNG)!);
  check('Auch ein Zug auf 0,20 m endet beim verfügbaren Platz', r3(nachImportWeit.openings.schlitz.width), 0.16);

  // === I — Ein Maß auf gleichartige Wände übertragen =======================
  //
  // `gleichartige` beantwortet eine einzige Frage: Wen nähme dieses Maß mit?
  // Die Antwort steht danach als Zahl in einem Knopf, und der Planer drückt
  // ihn, ohne die Liste zu sehen. Deshalb sind hier drei Dinge zu prüfen und
  // nicht eines: **wen** es trifft (namentlich, nicht nur wie viele), **was**
  // geschrieben wird (genau ein Feld) und **was im Knopf steht** (die Art,
  // die Zahl und das Maß).

  const wandarten = baueWandarten();
  /** Den Dickengriff einer bestimmten Wand holen — die Wandart steckt im Dokument. */
  const dickeGriffIn = (d: BimDocument, id: string): Griff =>
    griffNach(griffeFuer(d, { kind: 'wall', id }), 'wandDicke')!;
  const hoeheGriffIn = (d: BimDocument, id: string): Griff =>
    griffNach(griffeFuer(d, { kind: 'wall', id }), 'wandHoehe')!;

  // --- I.1 Alle vier Wandarten stehen mit ihrem eigenen Namen im Knopf ----
  //
  // `WallType` hat vier Werte. Der erste Entwurf bildete `exterior` und
  // `interior` ab und schob alles Übrige auf „Trennwände" — eine Schachtwand
  // bekam damit „auf 3 weitere Trennwände übertragen", obwohl richtig
  // übertragen wurde. Ein Knopf, der etwas anderes sagt, als er tut, wird
  // genau einmal gedrückt.
  //
  // Der Zielwert ist bei allen vier derselbe (0,24 m) und unterscheidet sich
  // von jeder der vier Ist-Stärken (0,30 · 0,175 · 0,10 · 0,15 m). Damit
  // kommen überall genau zwei Wände in die Liste, und die Beschriftungen
  // lassen sich Wort für Wort vergleichen.
  const aussenDicke = gleichartige(wandarten, dickeGriffIn(wandarten, 'aussen1'), 0.24);
  const innenDicke = gleichartige(wandarten, dickeGriffIn(wandarten, 'innen1'), 0.24);
  const trennDicke = gleichartige(wandarten, dickeGriffIn(wandarten, 'trenn1'), 0.24);
  const schachtDicke = gleichartige(wandarten, dickeGriffIn(wandarten, 'schacht1'), 0.24);
  check('Eine Außenwand heißt im Knopf „Außenwände"', knopf(aussenDicke), 'auf 2 weitere Außenwände im Geschoss übertragen (0,24 m)');
  check('Eine Innenwand heißt „Innenwände"', knopf(innenDicke), 'auf 2 weitere Innenwände im Geschoss übertragen (0,24 m)');
  check('Eine Trennwand heißt „Trennwände"', knopf(trennDicke), 'auf 2 weitere Trennwände im Geschoss übertragen (0,24 m)');
  check('Eine Schachtwand heißt „Schachtwände" und nicht „Trennwände"', knopf(schachtDicke), 'auf 2 weitere Schachtwände im Geschoss übertragen (0,24 m)');

  // --- I.2 Betroffen ist nur dieselbe Wandart ----------------------------
  //
  // Namentlich und nicht nur der Anzahl nach: Eine Liste der richtigen Länge
  // mit dem falschen Inhalt bestünde jede Zählprüfung und schriebe trotzdem
  // in eine Wand, die niemand angefasst hat.
  check('Von der Außenwand aus kommen nur Außenwände mit', betroffene(aussenDicke), 'aussen2,aussen3');
  check('Von der Innenwand aus nur Innenwände', betroffene(innenDicke), 'innen2,innen3');
  check('Von der Trennwand aus nur Trennwände', betroffene(trennDicke), 'trenn2,trenn3');
  check('Von der Schachtwand aus nur Schachtwände', betroffene(schachtDicke), 'schacht2,schacht3');

  // --- I.3 Andere Geschosse bleiben außen vor ----------------------------
  //
  // `ogAussen1` und `ogAussen2` sind Außenwände mit derselben Stärke wie
  // `aussen1` — sie unterscheiden sich allein durch das Geschoss. Im
  // Obergeschoss sind die Maße oft andere, und ein Knopf, der zwei Geschosse
  // gleichzeitig verstellt, wird beim ersten Mal gedrückt und danach nie
  // wieder.
  check('Die Außenwände im Obergeschoss sind dieselbe Art', wandarten.walls.ogAussen1.type, wandarten.walls.aussen1.type);
  check('… und tragen dieselbe Stärke', r3(wandarten.walls.ogAussen1.thickness), r3(wandarten.walls.aussen1.thickness));
  check('… kommen aber nicht mit', betroffene(aussenDicke).includes('ogAussen'), false);

  // --- I.4 Wer den Wert schon trägt, steht nicht in der Liste ------------
  //
  // Sonst stünde im Knopf „auf 3 übertragen", und eine davon änderte sich
  // nicht — die Zahl im Knopf muss das Versprechen halten, das sie gibt.
  const schonGleich = kopie(wandarten);
  schonGleich.walls.aussen3.thickness = 0.24;
  const restDicke = gleichartige(schonGleich, dickeGriffIn(schonGleich, 'aussen1'), 0.24);
  check('Trägt aussen3 den Wert schon, bleibt nur aussen2', betroffene(restDicke), 'aussen2');
  check('… und die Zahl im Knopf geht auf eins zurück', knopf(restDicke), 'auf 1 weitere Außenwände im Geschoss übertragen (0,24 m)');
  check(
    'Tragen alle den Wert schon, gibt es gar keinen Knopf',
    knopf(gleichartige(wandarten, dickeGriffIn(wandarten, 'aussen1'), 0.3)),
    'nichts',
  );

  // --- I.5 Der Patch trägt genau ein Feld --------------------------------
  //
  // Ein mitgeschicktes Zweitfeld fällt niemandem auf: Die Wand sieht danach
  // immer noch aus wie eine Wand, nur trägt sie eine Zahl, die der Planer nie
  // angefasst hat.
  const aussenHoehe = gleichartige(wandarten, hoeheGriffIn(wandarten, 'aussen1'), 2.75);
  check('Jede Änderung der Stärke betrifft eine Wand', artenAller(aussenDicke), 'wand');
  check('… und trägt genau das Feld thickness', felderAller(aussenDicke), 'thickness');
  check('Auch die Wandhöhe wird übertragen', betroffene(aussenHoehe), 'aussen2,aussen3');
  check('… mit genau dem Feld height', felderAller(aussenHoehe), 'height');
  check('… und mit Zahl und Maß im Knopf', knopf(aussenHoehe), 'auf 2 weitere Außenwände im Geschoss übertragen (2,75 m)');

  // --- I.6 Der Rundlauf --------------------------------------------------
  //
  // Dieselbe Frage wie in Abschnitt F, nur für die Übertragung: Wird das,
  // was im Knopf steht, beim Anwenden auch wahr? Angewendet wird von Hand
  // auf eine Tiefkopie — der Speicher ist Oberflächenschicht und steht dem
  // Rechenkern nicht zur Verfügung.
  let nachUebertragung = kopie(wandarten);
  for (const aenderung of aussenDicke!.aenderungen) nachUebertragung = anwenden(nachUebertragung, aenderung);
  check('Rundlauf: aussen2 trägt danach 0,24 m', r3(nachUebertragung.walls.aussen2.thickness), 0.24);
  check('… aussen3 ebenso', r3(nachUebertragung.walls.aussen3.thickness), 0.24);
  check('… die Innenwand daneben ist unberührt', r3(nachUebertragung.walls.innen1.thickness), 0.175);
  check('… die Schachtwand ebenso', r3(nachUebertragung.walls.schacht1.thickness), 0.15);
  check('… das Obergeschoss ebenso', r3(nachUebertragung.walls.ogAussen1.thickness), 0.3);
  check('… die Höhe von aussen2 hat sich nicht mitverändert', r3(nachUebertragung.walls.aussen2.height), HOEHE);
  check(
    '… und danach gibt es nichts mehr zu übertragen',
    knopf(gleichartige(nachUebertragung, dickeGriffIn(nachUebertragung, 'aussen1'), 0.24)),
    'nichts',
  );

  // === J — Ein Maß auf gleichartige Öffnungen übertragen ==================
  //
  // Der Handgriff, den das ersetzt: Ein Bestandsgebäude hat eine
  // Fensterbrüstung, nicht sieben. Man misst sie einmal — und trägt sie dann
  // sieben Mal ein, weil jedes Fenster ein eigenes Objekt ist. Bei der
  // vierten Eingabe vertippt sich jemand, und im Plan steht ein Fenster, das
  // zwei Zentimeter tiefer sitzt als seine Nachbarn. Diese Abweichung sieht
  // später aus wie eine Messung.
  const uebertrag = baueUebertragung();
  const oeffnungsgriff = (d: BimDocument, id: string, gesucht: string): Griff =>
    griffNach(griffeFuer(d, { kind: 'opening', id }), gesucht)!;

  // --- J.1 Alle drei Maße gehen mit --------------------------------------
  //
  // Brüstung, lichte Höhe und lichte Breite — je eines, und jedes in sein
  // eigenes Feld. Die drei Fenster tragen bewusst drei verschiedene Sätze
  // (1,00 · 1,30 · 0,90 — 1,20 · 1,40 · 0,75 — 1,00 · 1,30 · 0,90), damit
  // sich die Maße nicht gegenseitig decken.
  const bruestung110 = gleichartige(uebertrag, oeffnungsgriff(uebertrag, 'fensterA', 'oeffnungBruestung'), 1.1);
  const lichteHoehe150 = gleichartige(uebertrag, oeffnungsgriff(uebertrag, 'fensterA', 'oeffnungHoehe'), 1.5);
  const lichteBreite140 = gleichartige(uebertrag, oeffnungsgriff(uebertrag, 'fensterA', 'oeffnungBreite'), 1.4);
  check('Die Brüstung geht auf die anderen Fenster des Geschosses', betroffene(bruestung110), 'fensterB,fensterC');
  check('… und schreibt genau sillHeight', felderAller(bruestung110), 'sillHeight');
  check('… im Knopf steht die Zahl, die Art und das Maß', knopf(bruestung110), 'auf 2 weitere Fenster im Geschoss übertragen (1,10 m)');
  check('Die lichte Höhe ebenso', betroffene(lichteHoehe150), 'fensterB,fensterC');
  check('… und schreibt genau height', felderAller(lichteHoehe150), 'height');
  check('… mit dem Maß im Knopf', knopf(lichteHoehe150), 'auf 2 weitere Fenster im Geschoss übertragen (1,50 m)');
  check('Die lichte Breite ebenso', betroffene(lichteBreite140), 'fensterB,fensterC');
  check('… und schreibt genau width', felderAller(lichteBreite140), 'width');
  check('… mit dem Maß im Knopf', knopf(lichteBreite140), 'auf 2 weitere Fenster im Geschoss übertragen (1,40 m)');
  check('Jede Änderung betrifft eine Öffnung', artenAller(bruestung110), 'oeffnung');

  // --- J.2 Nur dieselbe Öffnungsart --------------------------------------
  //
  // Eine Tür ist kein Fenster. In derselben Wand stehen zwei Türen und ein
  // Durchgang; keines der drei darf in der Fensterliste auftauchen, und von
  // der Tür aus darf kein Fenster mitkommen.
  const tuerBreite = gleichartige(uebertrag, oeffnungsgriff(uebertrag, 'tuerA', 'oeffnungBreite'), 0.76);
  check('Türen stehen nicht in der Fensterliste', betroffene(lichteBreite140).includes('tuer'), false);
  check('Der Durchgang ebenfalls nicht', betroffene(lichteBreite140).includes('durchgang'), false);
  check('Von der Tür aus kommt nur die andere Tür mit', betroffene(tuerBreite), 'tuerB');
  check('… und die Beschriftung nennt Türen', knopf(tuerBreite), 'auf 1 weitere Türen im Geschoss übertragen (0,76 m)');

  // --- J.3 Nur dasselbe Geschoss -----------------------------------------
  //
  // `fensterOg` ist bis auf das Geschoss eine Kopie von `fensterA`. Im
  // Obergeschoss sind die Brüstungen oft andere — und wer sie vom Erdgeschoss
  // aus mitverstellt, merkt es erst im Plan.
  check('Das Fenster im Obergeschoss ist dieselbe Öffnungsart', uebertrag.openings.fensterOg.kind, uebertrag.openings.fensterA.kind);
  check('… kommt aber nicht mit', betroffene(bruestung110).includes('fensterOg'), false);

  // --- J.4 Nichts zu übertragen heißt: kein Knopf ------------------------
  //
  // Zwei Wege führen dahin, und beide werden geprüft. Erstens: Es gibt keine
  // zweite Öffnung dieser Art im Geschoss — der Durchgang ist der einzige
  // seiner Art. Zweitens: Alle tragen den Wert schon. In beiden Fällen ist
  // `null` die richtige Antwort; ein Knopf „auf 0 weitere übertragen" wäre
  // ein Knopf, der nichts tut, und den drückt man trotzdem.
  check(
    'Für den einzigen Durchgang im Geschoss gibt es nichts zu übertragen',
    knopf(gleichartige(uebertrag, oeffnungsgriff(uebertrag, 'durchgang', 'oeffnungBreite'), 1.4)),
    'nichts',
  );
  const alleAufNeunzig = kopie(uebertrag);
  alleAufNeunzig.openings.fensterB.sillHeight = 0.9;
  check(
    'Tragen alle Fenster schon 0,90 m, gibt es ebenfalls nichts',
    knopf(gleichartige(alleAufNeunzig, oeffnungsgriff(alleAufNeunzig, 'fensterA', 'oeffnungBruestung'), 0.9)),
    'nichts',
  );
  // Und derselbe Fall über die Teilmenge: fensterC sitzt schon auf 0,90 m,
  // fensterB nicht — dann bleibt genau eines übrig.
  const nurEines = gleichartige(uebertrag, oeffnungsgriff(uebertrag, 'fensterA', 'oeffnungBruestung'), 0.9);
  check('Sitzt nur fensterC schon auf 0,90 m, bleibt fensterB übrig', betroffene(nurEines), 'fensterB');
  check('… und die Zahl im Knopf sagt eins', knopf(nurEines), 'auf 1 weitere Fenster im Geschoss übertragen (0,90 m)');

  // --- J.5 Lagemaße werden nicht übertragen ------------------------------
  //
  // **Die wichtigste Prüfung dieses Abschnitts.** Die Lage einer Öffnung in
  // ihrer Wand und die Länge einer Wand sind Einzelmaße. Sie auf „alle
  // gleichartigen" zu legen, schöbe sämtliche Fenster auf denselben Abstand
  // zur Ecke — das ist kein Aufmaß, das ist ein Schaden, und zwar einer, der
  // im 3D-Bild zunächst ordentlich aussieht. Dasselbe gilt für die Maße
  // eines TGA-Objekts: Ein Heizkörper ist nach dem Raum bemessen, in dem er
  // steht, und nicht nach seinen Geschwistern.
  check(
    'Der Abstand ab Wandanfang wird nicht übertragen',
    knopf(gleichartige(uebertrag, oeffnungsgriff(uebertrag, 'fensterA', 'oeffnungLage'), 5)),
    'nichts',
  );
  check('Das Wandende am Anfang wird nicht übertragen', knopf(gleichartige(schraegDoc, endeA, 4)), 'nichts');
  check('Das Wandende am Ende ebenso', knopf(gleichartige(schraegDoc, endeB, 4)), 'nichts');
  check('Die Baulänge eines Objekts wird nicht übertragen', knopf(gleichartige(haus, griffNach(objektGriffe, 'objektLaenge')!, 1.4)), 'nichts');
  check('Die Bautiefe ebenso', knopf(gleichartige(haus, griffNach(objektGriffe, 'objektTiefe')!, 0.22)), 'nichts');
  check('Die Montagehöhe ebenso', knopf(gleichartige(haus, objektHoehe, 0.6)), 'nichts');

  // --- J.6 Der Rundlauf --------------------------------------------------
  //
  // Angewendet wird von Hand auf eine Tiefkopie. Geprüft wird beides: dass
  // die genannten Fenster den Wert danach tragen — und dass **sonst nichts**
  // anders ist. Ein Patch, der neben der Brüstung noch die lichte Höhe
  // mitschickte, käme durch J.1 nur dann, wenn jemand dort den Sollwert
  // mitänderte; hier nicht.
  let nachFenster = kopie(uebertrag);
  for (const aenderung of bruestung110!.aenderungen) nachFenster = anwenden(nachFenster, aenderung);
  check('Rundlauf: fensterB trägt danach 1,10 m Brüstung', r3(nachFenster.openings.fensterB.sillHeight), 1.1);
  check('… fensterC ebenso', r3(nachFenster.openings.fensterC.sillHeight), 1.1);
  check('… lichte Höhe und Breite von fensterB sind unverändert', `${r3(nachFenster.openings.fensterB.height)}/${r3(nachFenster.openings.fensterB.width)}`, '1.4/1.2');
  check('… die Lage von fensterB ist unverändert', r3(nachFenster.openings.fensterB.distance), 5);
  check('… die Türen sind unberührt', r3(nachFenster.openings.tuerA.sillHeight), 0);
  check('… und das Fenster im Obergeschoss steht weiter auf 0,90 m', r3(nachFenster.openings.fensterOg.sillHeight), 0.9);
  check(
    '… danach gibt es nichts mehr zu übertragen',
    knopf(gleichartige(nachFenster, oeffnungsgriff(nachFenster, 'fensterA', 'oeffnungBruestung'), 1.1)),
    'nichts',
  );

  /*
   * Beobachtung (kein Befund, heute nicht erreichbar): `gleichartige`
   * vergleicht gegen `doc.activeLevelId` und nicht gegen das Geschoss des
   * **ausgewählten** Bauteils. Steht die Auswahl in einem anderen Geschoss
   * als dem aktiven, geht die Übertragung deshalb in das aktive Geschoss —
   * also genau quer über die Grenze, die der Modulkopf zieht.
   *
   * Erreichbar ist das heute nicht: `setActiveLevel` im Speicher löscht die
   * Auswahl (`set({ selection: null, selections: [] })`), und der Klick in
   * der 3D-Ansicht deutet den Treffer über `deuteTreffer(doc,
   * doc.activeLevelId, …)`, findet also nur Bauteile des aktiven Geschosses.
   * Die Zeile hält den Zustand fest, damit ein späterer Griff auf ein
   * Nachbargeschoss — die 3D-Ansicht **zeichnet** alle Geschosse — nicht
   * unbemerkt durch diese Tür geht.
   */
  const ogAktiv = kopie(uebertrag);
  ogAktiv.activeLevelId = 'og';
  check(
    'Bei aktivem Obergeschoss trifft das Erdgeschossfenster das Obergeschoss',
    betroffene(gleichartige(ogAktiv, oeffnungsgriff(ogAktiv, 'fensterA', 'oeffnungBruestung'), 1.1)),
    'fensterOg',
  );

  // === K — Die Zahl im Modulkopf ==========================================
  //
  // Der Kommentar über `wertAusZug` begründet die Rasterung der *Änderung*
  // mit einer Zahl: „Von den fünfzehn Katalogöffnungen (Rohbaumaße nach DIN
  // 18100) tragen zwölf mindestens ein Maß abseits des Zentimeters." Diese
  // Zahl ist das Gewicht des ganzen Arguments — ohne sie klänge der Fehler
  // nach einem Sonderfall statt nach dem Regelfall.
  //
  // Nachgezählt wird hier, damit der Kommentar nicht unbemerkt veraltet: Wer
  // morgen ein Regelmaß ergänzt, das glatt auf dem Zentimeter liegt,
  // verschiebt beide Zahlen — und erfährt es an dieser Stelle.
  //
  // „Abseits des Zentimeters" heißt: Breite, lichte Höhe oder Brüstung lässt
  // sich nicht als ganze Zahl von Zentimetern schreiben. Gerechnet wird über
  // Millimeter und nicht über `% 0.01`, weil 1,76/0,01 in Gleitkomma
  // 175,99999999999997 ergibt — ausgerechnet der Rechenweg, der den Fehler
  // überhaupt erzeugt hat, taugt nicht zum Nachzählen.
  const abseitsDesZentimeters = OPENING_PRESETS.filter((p) =>
    [p.width, p.height, p.sillHeight].some((m) => Math.round(m * 1000) % 10 !== 0),
  );
  check('OPENING_PRESETS hat fünfzehn Einträge', OPENING_PRESETS.length, 15);
  check('… davon tragen zwölf ein Maß abseits des Zentimeters', abseitsDesZentimeters.length, 12);
  check('… und drei liegen ganz auf dem Zentimeter', OPENING_PRESETS.length - abseitsDesZentimeters.length, 3);
  // Die drei namentlich: Eine Prüfung auf die Anzahl allein bestünde auch
  // dann, wenn jemand einen Eintrag austauschte und einen anderen ergänzte.
  check(
    '… die drei sind Tür 76, der raumhohe Durchgang und der Rundbogen',
    OPENING_PRESETS.filter((p) => !abseitsDesZentimeters.includes(p)).map((p) => p.id).sort().join('/'),
    'door-76/pass-arch/pass-open',
  );
  /*
   * Und die krummen Maße selbst, alle vier, aufsteigend: 0,885 · 1,135 ·
   * 1,385 · 2,135 m. Sie stehen hier, weil der Modulkopf sie aufzählt — dort
   * allerdings mit sechs Einträgen, denn er nennt zusätzlich 1,76 und 2,01.
   * Diese beiden liegen auf dem Zentimeter (176 und 201 mm) und gehören
   * fachlich nicht in die Aufzählung; an der Zahl „zwölf von fünfzehn" ändert
   * das nichts, weil jeder Eintrag, der sie trägt, ohnehin über ein anderes
   * Maß in die Liste kommt. Die Zeile hält den tatsächlichen Satz fest.
   */
  check(
    '… und die krummen Maße selbst sind vier: 0,885 · 1,135 · 1,385 · 2,135 m',
    [
      ...new Set(
        OPENING_PRESETS.flatMap((p) => [p.width, p.height, p.sillHeight]).filter(
          (m) => Math.round(m * 1000) % 10 !== 0,
        ),
      ),
    ]
      .sort((a, b) => a - b)
      .join('/'),
    '0.885/1.135/1.385/2.135',
  );
}
