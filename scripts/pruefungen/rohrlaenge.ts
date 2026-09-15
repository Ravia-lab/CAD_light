/**
 * Prüfblock „Rohrlänge" — wie lang eine Leitung wirklich ist.
 *
 * **Warum es diesen Block gibt.** Seit `PipeRun.elevationTo` gibt es zu jeder
 * Leitung zwei Längen: die Trasse, die der Grundriss zeigt, und die wahre
 * Länge √(Trasse² + Δh²), die bestellt, gedämmt und durchströmt wird. Vier
 * Stellen im Programm haben die Unterscheidung bis 1.23.0 nicht gemacht
 * (Massenauszug, Rohrnetz, Rohrnetzbericht, Plan); seitdem gibt es genau eine
 * Rechnung, und dieser Block hält sie fest.
 *
 * **Die Sollwerte stehen von Hand da.** Eine Prüfung, die ihre Erwartung aus
 * derselben Formel holt, die sie prüft, bestätigt nur, dass die Formel sich
 * selbst gleicht — sie liefe auch dann durch, wenn der Pythagoras durch eine
 * Summe ersetzt würde. Die Zahlen unten sind deshalb so gewählt, dass sie
 * jeder im Kopf nachrechnet: Trasse 4 m, Versatz 3 m, Länge 5 m — das
 * 3-4-5-Dreieck. Und als zweites 0,7 / 2,4 / 2,5, das 7-24-25-Dreieck.
 *
 * **Zwei offene Befunde hält dieser Block fest** (siehe Abschnitt G): Ein
 * reiner Strang — zwei Stützpunkte, die im Grundriss fast aufeinanderliegen —
 * verschwindet im Rohrnetz vollständig. Die Prüfungen dort schreiben den
 * **tatsächlichen** Stand fest und sind als BEFUND gekennzeichnet, damit der
 * Lauf grün bleibt und die Lücke trotzdem niemandem entgeht. Wer sie
 * repariert, dreht die beiden Zeilen um; daneben steht, auf welchen Wert.
 *
 * **Was dieser Block nicht prüft.** Wie die geneigte Leitung *gezeichnet*
 * wird — das ist Sache der 3D-Ansicht. Geprüft wird nur die Höhe je
 * Stützpunkt (`hoeheAnPunkt`), aus der die Ansicht ihre Punkte bildet.
 */

import type { CheckFn } from './typ';
import type { BimDocument, Fixture, Level, PipeRun, Vec2 } from '../../src/types/bim';
import { emptyPlant, emptySite } from '../../src/lib/plantDefaults';
import { buildMaterialSchedule } from '../../src/lib/materialSchedule';
import { buildPipeNetwork } from '../../src/lib/pipeNetwork';
import {
  hoeheAnPunkt,
  hoehenversatz,
  istStrang,
  rohrlaenge,
  steiganteil,
  trassenlaenge,
} from '../../src/lib/rohrlaenge';

// ---------------------------------------------------------------------------
// Kleinkram
// ---------------------------------------------------------------------------

/**
 * Auf Millimeter runden.
 *
 * Eine Rohrlänge wird auf den Zentimeter bestellt; der Millimeter ist hier nur
 * die Stelle, an der eine falsche Formel noch auffällt, während
 * Gleitkommarauschen (√5,7604 = 2,400083…) schon herausfällt.
 */
const r3 = (v: number): number => Math.round(v * 1000) / 1000;

/**
 * Eine Leitung mit zwei Stützpunkten im Abstand `trasse` und dem Höhenversatz
 * `versatz`.
 *
 * Die Nennweite ist fest: Sie geht in keine der geprüften Längen ein, und ein
 * Parameter, den keine Prüfung braucht, lädt nur dazu ein, ihn zu verstellen.
 */
function leitung(trasse: number, versatz?: number): PipeRun {
  return {
    id: 'p',
    levelId: 'eg',
    service: 'heating-flow',
    points: [
      { x: 0, y: 0 },
      { x: trasse, y: 0 },
    ],
    nominalDiameter: 16,
    insulation: 9,
    elevation: 0,
    ...(versatz === undefined ? {} : { elevationTo: versatz }),
  };
}

/** Eine Leitung über beliebige Stützpunkte, mit Anfangs- und Endhöhe. */
function polylinie(points: Vec2[], elevation: number, elevationTo?: number): PipeRun {
  return {
    ...leitung(1),
    points,
    elevation,
    ...(elevationTo === undefined ? {} : { elevationTo }),
  };
}

/**
 * Der Fall, wegen dessen das Modul entstanden ist: der Fallstrang in der
 * Zimmerecke.
 *
 * Zwei Zentimeter Trasse — so genau trifft niemand zwei Punkte übereinander —
 * und 2,40 m Höhenversatz von der Anbindung am Sockel bis unter die Decke.
 * Im Grundriss ist das ein Punkt; bestellt werden 2,40 m Rohr.
 */
const FALLSTRANG_TRASSE = 0.02;
const FALLSTRANG_VERSATZ = 2.4;

/** Dasselbe als angebundener Abschnitt zwischen Erzeuger und Heizkörper. */
function strangImHaus(trasse: number): PipeRun {
  return {
    id: 'strang',
    levelId: 'eg',
    service: 'heating-flow',
    points: [
      { x: 8, y: 0.6 },
      { x: 8 + trasse, y: 0.6 },
    ],
    nominalDiameter: 16,
    insulation: 9,
    elevation: 0.1,
    elevationTo: 0.1 + FALLSTRANG_VERSATZ,
    fromFixtureId: 'kessel',
    toFixtureId: 'hk',
  };
}

/**
 * Ein Modell, das außer den übergebenen Leitungen nur einen Erzeuger und einen
 * Heizkörper enthält.
 *
 * **Ohne Wände und ohne Räume, und das ist Absicht.** Weder der Längenauszug
 * noch das Rohrnetz lesen die Gebäudehülle: Der eine summiert `doc.pipes`, das
 * andere baut seinen Graphen aus Stützpunkten und Objekten. Ein Prüfhaus mit
 * Geometrie brächte hier nur Zahlen ins Spiel, die mit der Rohrlänge nichts zu
 * tun haben — und damit Gründe, aus denen eine Prüfung scheitern kann, ohne
 * dass an der Rohrlänge etwas falsch wäre. Gebaut wird über `emptySite` und
 * `emptyPlant`; von Hand gesetzte Polygone gibt es hier deshalb keine.
 */
function modell(...leitungen: readonly PipeRun[]): BimDocument {
  const eg: Level = {
    id: 'eg',
    name: 'EG',
    order: 0,
    elevation: 0,
    height: 2.75,
    floorUValue: 0.35,
    floorBoundary: 'ground',
    ceilingUValue: 0.2,
    ceilingBoundary: 'unheated',
  };
  const objekt = (id: string, type: string, x: number, y: number): Fixture =>
    ({
      id,
      type,
      category: 'heating',
      label: id,
      levelId: 'eg',
      position: { x, y },
      rotation: 0,
      length: 1,
      depth: 0.12,
      elevation: 0.3,
      params: {},
    }) as Fixture;

  return {
    site: emptySite(),
    plant: emptyPlant(),
    meta: {
      name: 'Prüfhaus Rohrlänge',
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
    levels: { eg },
    layers: {},
    nodes: {},
    walls: {},
    openings: {},
    fixtures: {
      // Quelle und Verbraucher — ohne beide fände das Rohrnetz keinen Weg und
      // könnte auch keine Teilstrecke ausweisen.
      kessel: objekt('kessel', 'boiler', 1, 1),
      hk: objekt('hk', 'radiator', 8, 0.6),
    },
    verticals: {},
    solids: {},
    durchbrueche: {},
    pipes: Object.fromEntries(leitungen.map((l) => [l.id, l])),
    annotations: {},
    roofOpenings: {},
    rooms: {},
    constructions: {},
    diagnostics: { openEnds: [] },
    activeLevelId: 'eg',
  };
}

// ---------------------------------------------------------------------------
// Die Prüfungen
// ---------------------------------------------------------------------------

export function pruefeRohrlaenge(check: CheckFn): void {
  // === A — Die Trasse in der Grundrissebene ===============================

  // Zwei Teilstücke, rechtwinklig: 3 m nach Osten, 4 m nach Norden.
  // Die Trasse ist ihre Summe (7 m) und **nicht** der Abstand der Endpunkte
  // (5 m) — wer den nähme, verlöre jeden Bogen einer Leitung.
  check(
    'Die Trasse summiert die Teilstücke, sie misst nicht Luftlinie',
    r3(trassenlaenge([{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 4 }])),
    7,
  );
  check('Ein einzelner Stützpunkt ergibt keine Trasse', r3(trassenlaenge([{ x: 2, y: 3 }])), 0);
  check('Und gar keiner auch nicht', r3(trassenlaenge([])), 0);

  /*
   * Der Sonderfall, an dem sich eine Division durch null zeigen würde: alle
   * Stützpunkte liegen aufeinander. Das ist der reine Steigstrang, wenn beim
   * Zeichnen sauber gefangen wurde. Die Trasse ist null — und null, nicht
   * `NaN`: Eine Länge, die `NaN` ist, fällt in jeder Summe stillschweigend
   * durch und macht den ganzen Auszug zu `NaN`, ohne dass irgendwo eine
   * Meldung entstünde.
   */
  const aufeinander = trassenlaenge([{ x: 2, y: 3 }, { x: 2, y: 3 }, { x: 2, y: 3 }]);
  check('Alle Punkte aufeinander: die Trasse ist null', r3(aufeinander), 0);
  check('… und keine ungültige Zahl', Number.isFinite(aufeinander), true);

  // === B — Die wahre Länge ================================================

  // Ohne zweite Verlegehöhe liegt die Leitung waagerecht: wahre Länge = Trasse.
  check('Ohne Höhe am Ende ist die Rohrlänge die Trasse', r3(rohrlaenge(leitung(4))), 4);
  check('… und der senkrechte Anteil null', r3(steiganteil(leitung(4))), 0);

  /*
   * Das 3-4-5-Dreieck: 4 m Trasse, 3 m Höhengewinn, 5 m Rohr. Die Zahl ist
   * ohne Taschenrechner nachvollziehbar — und genau darum geht es. Eine
   * Prüfung, die `Math.hypot(4, 3)` als Sollwert schriebe, prüfte nichts.
   */
  check('Trasse 4 m, Versatz 3 m → 5 m Rohr', r3(rohrlaenge(leitung(4, 3))), 5);
  check('Davon 1 m senkrechter Anteil', r3(steiganteil(leitung(4, 3))), 1);
  // Fallend ist dieselbe Länge — Rohr wird nicht kürzer, wenn man es andersherum
  // verlegt. Nur das Vorzeichen des Versatzes dreht sich (Abschnitt D).
  check('Fallend ist die Leitung genauso lang', r3(rohrlaenge(polylinie([{ x: 0, y: 0 }, { x: 4, y: 0 }], 3, 0))), 5);

  // === C — Der Kernfall: der Fallstrang in der Zimmerecke =================
  //
  // 2 cm Trasse, 2,40 m Versatz. Drei Zahlen sind denkbar, und zwei davon
  // wären falsch:
  //   0,02 m  — die Trasse; so stand es bis 1.23.0 im Massenauszug, und der
  //             Strang fehlte in der Bestellung praktisch vollständig.
  //   2,42 m  — Trasse plus Versatz; die naheliegende Reparatur, und um den
  //             Verschnitt einer ganzen Wohnung zu groß, wenn man sie über
  //             hundert Abschnitte hinweg macht.
  //   2,400 m — die Hypotenuse. Bei dieser Geometrie fällt sie mit dem
  //             Versatz praktisch zusammen (√(0,02² + 2,40²) = 2,4000833),
  //             und das ist der Punkt: Im Grundriss ist der Strang ein Punkt,
  //             im Rohr sind es 2,40 m.
  const fallstrang = leitung(FALLSTRANG_TRASSE, FALLSTRANG_VERSATZ);
  check('Der Fallstrang ist 2,400 m lang', r3(rohrlaenge(fallstrang)), 2.4);
  check('… also nicht seine Trasse von 0,02 m', r3(trassenlaenge(fallstrang.points)), 0.02);
  check(
    '… und nicht Trasse plus Versatz (2,42 m)',
    rohrlaenge(fallstrang) < FALLSTRANG_TRASSE + FALLSTRANG_VERSATZ,
    true,
  );
  check('Sein senkrechter Anteil ist 2,380 m', r3(steiganteil(fallstrang)), 2.38);

  // === D — Der Höhenversatz trägt ein Vorzeichen ==========================
  //
  // Gebraucht wird es für die Armaturen: Die Entlüftung gehört an den
  // Hochpunkt, die Entleerung an den Tiefpunkt. Nur der Betrag sagt, dass es
  // einen Strang gibt; erst das Vorzeichen sagt, an welchem Ende was sitzt.
  check('Ohne zweite Höhe ist der Versatz null', r3(hoehenversatz(leitung(4))), 0);
  check('Steigend ist er positiv', r3(hoehenversatz(polylinie([{ x: 0, y: 0 }, { x: 1, y: 0 }], 0.3, 2.5))), 2.2);
  check('Fallend ist er negativ', r3(hoehenversatz(polylinie([{ x: 0, y: 0 }, { x: 1, y: 0 }], 2.5, 0.3))), -2.2);

  // === E — Was als Strang gilt ============================================
  //
  // Zwei Bedingungen, und beide müssen erfüllt sein:
  //   • Verhältnis: Versatz > 2 × Trasse (Neigung über 63°),
  //   • Mindestversatz: 0,15 m.
  // Das Verhältnis allein reichte nicht: Zwei Punkte, die beim Zeichnen um
  // einen Zentimeter verfehlt wurden, und ein Höhenunterschied von drei
  // Zentimetern aus zwei Verlegehöhen ergäben ein Verhältnis von 3 — und
  // damit eine Entlüftung an einer waagerechten Leitung.

  // Die Verhältnisschwelle, von beiden Seiten. Trasse 1 m:
  check('Mehr als das Doppelte der Trasse ist ein Strang', istStrang(leitung(1, 2.5)), true);
  check('Knapp darüber auch noch', istStrang(leitung(1, 2.02)), true);
  // Genau das Doppelte ist keiner: Die Schwelle ist ein echtes „größer als".
  // Bei Gleichstand liegt die Neigung bei 63,4° — das ist eine steile Leitung
  // und noch kein Strang, und irgendwo muss die Grenze liegen.
  check('Genau das Doppelte ist keiner', istStrang(leitung(1, 2)), false);
  check('Knapp darunter erst recht nicht', istStrang(leitung(1, 1.98)), false);

  // Der Mindestversatz, von beiden Seiten. Trasse 1 cm — das Verhältnis ist
  // damit weit überschritten, es entscheidet also allein der Versatz.
  check('Unter 15 cm Versatz ist nichts ein Strang', istStrang(leitung(0.01, 0.149)), false);
  check('Bei genau 15 cm beginnt er', istStrang(leitung(0.01, 0.15)), true);

  /*
   * Die Gegenprobe, die in der Praxis zählt: der Vorlauf, der über zwölf
   * Meter einen halben Meter steigt, weil er einer Gefällestrecke folgt. Der
   * Versatz liegt weit über dem Mindestmaß — und trotzdem ist das eine
   * liegende Leitung. Sie bekommt keine Entlüftung und keine Entleerung,
   * sonst stünden an jedem Haus ein Dutzend Armaturen zu viel.
   */
  check('Eine lang ansteigende Leitung ist kein Strang', istStrang(leitung(12, 0.5)), false);
  check('Ohne Versatz ist nichts ein Strang', istStrang(leitung(12)), false);
  check('Der Fallstrang aus der Zimmerecke ist einer', istStrang(fallstrang), true);

  // === F — Die Höhe an einem Stützpunkt ===================================
  //
  // **Der Knick, den man in der 3D-Ansicht sähe.** Eine Leitung mit
  // Stützpunkten bei 0, 1 und 11 m, die auf ganzer Länge 2,20 m steigt:
  //   • über die Trasse gerechnet liegt der mittlere Punkt bei 1/11 der
  //     Strecke, also bei 2,20 m × 1/11 = 0,200 m;
  //   • über den Punktindex gerechnet läge er in der Mitte der Punktliste,
  //     also bei 1,100 m.
  // Der Unterschied ist ein volles Stockwerk Steigung auf dem ersten Meter
  // und ein fast waagerechtes Reststück — sichtbar als Knick im Bild und
  // falsch in jeder Höhenangabe, die daran hängt.
  const lang = polylinie([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 11, y: 0 }], 0, 2.2);
  check('Am ersten Punkt liegt die Anfangshöhe', r3(hoeheAnPunkt(lang, 0)), 0);
  check('Nach einem von elf Metern ist die Höhe 0,200 m', r3(hoeheAnPunkt(lang, 1)), 0.2);
  check('… und nicht die 1,100 m, die der Punktindex ergäbe', r3(hoeheAnPunkt(lang, 1)) === 1.1, false);
  check('Am letzten Punkt liegt die Endhöhe', r3(hoeheAnPunkt(lang, 2)), 2.2);

  // Ohne Versatz hat jeder Punkt dieselbe Höhe — auch der letzte.
  const waagerecht = polylinie([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 11, y: 0 }], 0.3);
  check('Ohne Versatz liegt jeder Punkt auf der Verlegehöhe', r3(hoeheAnPunkt(waagerecht, 1)), 0.3);

  /*
   * Der reine Strang mit exakt aufeinanderliegenden Punkten: Es gibt keine
   * Trasse, über die sich interpolieren ließe. Die Höhe springt vom ersten
   * auf den letzten Punkt — alles dazwischen gibt es nicht. Ohne diesen Zweig
   * stünde hier eine Division durch null.
   */
  const senkrecht = polylinie([{ x: 2, y: 3 }, { x: 2, y: 3 }], 0.1, 2.5);
  check('Beim reinen Strang trägt der erste Punkt die Anfangshöhe', r3(hoeheAnPunkt(senkrecht, 0)), 0.1);
  check('… und der zweite die Endhöhe', r3(hoeheAnPunkt(senkrecht, 1)), 2.5);
  check('… ohne ungültige Zahl dazwischen', Number.isFinite(hoeheAnPunkt(senkrecht, 1)), true);

  // === G — Die Verbindung nach außen ======================================
  //
  // Die Rechnung für sich genommen kann stimmen und trotzdem nirgends
  // ankommen. Geprüft wird deshalb an den beiden Stellen, an denen die Zahl
  // den Planer erreicht: in der Bestellung und im Druckverlust.

  // --- G.1 Massenauszug: die Menge ist die wahre Länge --------------------
  const auszug = buildMaterialSchedule(modell(strangImHaus(FALLSTRANG_TRASSE)));
  const rohrzeile = auszug.items.find((i) => i.trade === 'rohr' && i.name === 'Heizung Vorlauf');
  check('Der Fallstrang steht überhaupt im Auszug', rohrzeile !== undefined, true);
  // 2,40 m — nicht 0,02 m. Bis 1.23.0 fiel die Position durch `length <= 0`
  // heraus und fehlte in der Bestellung, ohne dass etwas gemeldet wurde.
  check('… mit 2,4 m, also seiner wahren Länge', r3(rohrzeile?.quantity ?? -1), 2.4);
  check('… und in Metern', rohrzeile?.unit ?? 'fehlt', 'm');
  /*
   * Die Bemerkung muss **beide** Zahlen nennen, aus denen sich die Menge
   * zusammensetzt. Wer eine Bestellung gegen einen Plan prüft, misst im Plan
   * nach und kommt auf 0,02 m; ohne den Satz daneben hält er die 2,40 m für
   * einen Fehler und korrigiert die richtige Menge.
   */
  check('Die Bemerkung nennt die Trasse', (rohrzeile?.remark ?? '').includes('0,02 m Trasse'), true);
  check(
    '… und den senkrechten Anteil',
    (rohrzeile?.remark ?? '').includes('2,38 m senkrechter Anteil'),
    true,
  );
  // Die Dämmung folgt der Leitung, nicht der Trasse: Gedämmt wird das Rohr,
  // auch dort, wo es senkrecht steht.
  check(
    'Die Dämmung wird über dieselbe Länge bestellt',
    r3(auszug.items.find((i) => i.name === 'Rohrdämmung')?.quantity ?? -1),
    2.4,
  );

  // --- G.2 Rohrnetz: die Teilstrecke muss einen Widerstand haben ----------
  //
  // Gegenprobe zuerst, damit klar ist, dass die Rechnung selbst stimmt: ein
  // schräger Strang mit 0,70 m Trasse und 2,40 m Versatz — das
  // 7-24-25-Dreieck, also genau 2,500 m Rohr.
  const schraegNetz = buildPipeNetwork(modell(strangImHaus(0.7)));
  const schraegWeg = schraegNetz.paths.find((p) => p.fixtureId === 'hk');
  check('Der schräge Strang hat im Rohrnetz eine Teilstrecke', schraegWeg?.segments.length ?? -1, 1);
  check('… mit 2,500 m, seiner wahren Länge', r3(schraegWeg?.segments[0]?.length ?? -1), 2.5);
  check('… und die Weglänge zur Quelle ist dieselbe', r3(schraegWeg?.routeLength ?? -1), 2.5);
  // Hin und zurück — darüber entsteht der Druckverlust.
  check('… der Kreis ist doppelt so lang', r3(schraegWeg?.circuitLength ?? -1), 5);

  /*
   * =====================================================================
   * BEFUND (offen, nicht repariert) — der reine Strang fällt aus dem Netz
   * =====================================================================
   *
   * **Eingabe.** Derselbe Abschnitt wie oben, nur mit 0,02 m Trasse statt
   * 0,70 m: Stützpunkte (8,00|0,60) und (8,02|0,60), Verlegehöhe 0,10 m am
   * Anfang und 2,50 m am Ende, angebunden an Erzeuger und Heizkörper.
   *
   * **Erwartet.** Ein Weg mit einer Teilstrecke von 2,400 m — dieselbe Zahl,
   * die der Massenauszug oben schon richtig ausweist.
   *
   * **Tatsächlich.** Ein Weg mit **null** Teilstrecken und einer Weglänge von
   * 0 m. Der Heizkörper gilt als angeschlossen (er steht nicht unter
   * `unconnected`), sein Weg zur Quelle ist aber widerstandsfrei.
   *
   * **Der Fehler, den diese Prüfung für immer ausschließt.**
   *
   * `Graph.node` in `pipeNetwork.ts` verschmolz Stützpunkte, die im
   * Grundriss näher als der Fangabstand `WELD` = 0,06 m beieinanderlagen, zu
   * **einem** Knoten — zweidimensional, ohne die Höhe anzusehen. Beide Enden
   * eines Fallstrangs landeten damit auf demselben Knoten, und `connect`
   * verwarf eine Kante von einem Knoten auf sich selbst. Die Teilstrecke
   * entstand gar nicht erst.
   *
   * Die Grenze war gemessen: Bis 0,059 m Trasse verschwand der Abschnitt, ab
   * 0,061 m stand er mit 2,400 m im Bericht. Derselbe Massenauszug führte
   * ihn die ganze Zeit richtig — zwei Berichte aus einem Modell nannten
   * verschiedene Längen für dieselbe Leitung, und der eine hätte die Pumpe
   * zu klein gewählt.
   *
   * Behoben, indem ein Knoten seine Verlegehöhe trägt und nur verschmolzen
   * wird, was im Grundriss **und** in der Höhe zusammenfällt. Diese Prüfung
   * ist die Wache davor.
   */
  const strangNetz = buildPipeNetwork(modell(strangImHaus(FALLSTRANG_TRASSE)));
  const strangWeg = strangNetz.paths.find((p) => p.fixtureId === 'hk');
  check('Der reine Strang findet einen Weg zur Quelle', strangWeg !== undefined, true);
  check('… und der Heizkörper gilt nicht als unangeschlossen', strangNetz.unconnected.length, 0);
  check(
    'Der reine Strang hat im Rohrnetz genau eine Teilstrecke',
    strangWeg?.segments.length ?? -1,
    1,
  );
  check('… und seine Weglänge sind die vollen 2,400 m', r3(strangWeg?.routeLength ?? -1), 2.4);
}
