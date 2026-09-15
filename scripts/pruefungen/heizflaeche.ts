/**
 * Prüfblock „Heizfläche" — von der Raumheizlast zur Normleistung.
 *
 * **Worum es geht.** `params.powerW` einer Heizfläche ist die
 * Normwärmeleistung nach DIN EN 442-2, also die Leistung bei 55/45/20 °C. Die
 * Raumheizlast ist die Leistung im Auslegungsbetriebspunkt der Anlage. Beides
 * sind Watt, und beides ist nicht dieselbe Zahl. Wer die Heizlast unverändert
 * ins Feld schreibt, legt den Heizkörper zu klein aus — bei einer Wärmepumpe
 * um mehr als die Hälfte.
 *
 * **Die Sollwerte stehen von Hand da, und sie sind zugleich die Gegenprobe
 * zum Modulkopf.** Im Kommentar von `heizflaechenLeistung.ts` stehen drei
 * Beispiele (1600 W Raumheizlast, n = 1,3 → 2040 / 2470 / 5730 W). Sie sind
 * einmal falsch dort gestanden. Diese Prüfung hält sie fest: Wer die Zahlen
 * im Modulkopf ändert, muss hier nachziehen, und wer sie hier ändert, dort.
 * Eine Prüfung, die ihren Sollwert aus `normleistungFuerHeizlast` selbst
 * holte, könnte das nicht leisten — sie bestätigte nur, dass die Funktion
 * sich selbst gleicht.
 *
 * **Ein offener Befund** steht in Abschnitt G: `heizflaechenbefundFuer` gibt
 * bei einer Abweichung von genau null **keinen** Befund zurück — obwohl das
 * der eine Fall ist, für den es diese zweite Abfrage gibt. Die Prüfung dort
 * schreibt den tatsächlichen Stand fest und ist als BEFUND gekennzeichnet.
 *
 * **Was dieser Block nicht prüft.** Ob die Raumheizlast selbst stimmt — das
 * ist Sache von `heatLoadEstimate` und des Referenzhauses. Damit die Zahlen
 * hier von Hand nachrechenbar bleiben, bekommt jeder Raum eine **gesetzte**
 * Norm-Heizlast (`Room.normHeatLoad`, der Weg, über den RaVia zurückschreibt).
 * Der Abgleich bevorzugt sie ohnehin vor dem eigenen Überschlag; damit ist die
 * Eingangsgröße dieses Blocks eine runde Zahl und keine Schätzung.
 */

import type { CheckFn } from './typ';
import type { BimDocument, BimNode, Fixture, LeistungHerkunft, Level, Wall } from '../../src/types/bim';
import { leistungNachziehbar } from '../../src/types/bim';
import { emptyPlant, emptySite } from '../../src/lib/plantDefaults';
import { detectRooms } from '../../src/lib/roomDetection';
import { systemtemperaturVon } from '../../src/lib/systemtemperatur';
import {
  NORM_UEBERTEMPERATUR,
  anteilJeHeizflaeche,
  istHeizflaeche,
  normleistungFuerHeizlast,
} from '../../src/lib/heizflaechenLeistung';
import {
  heizflaechenBefunde,
  heizflaechenbefundFuer,
  unterdeckteHeizflaechen,
  zieheHeizflaechenNach,
} from '../../src/lib/heizflaechenAbgleich';

// ---------------------------------------------------------------------------
// Die Zahlen, die von Hand stehen
// ---------------------------------------------------------------------------

/**
 * Die Raumheizlast, mit der gerechnet wird [W].
 *
 * 1600 W ist die Zahl aus dem Modulkopf von `heizflaechenLeistung.ts`. Sie
 * hier noch einmal zu nehmen ist der ganze Zweck: Die drei Ergebnisse unten
 * sind genau die drei Zeilen, die dort im Kommentar stehen.
 */
const HEIZLAST = 1600;

/**
 * Die Normleistung, die 1600 W Raumheizlast bei 50/40/20 °C und n = 1,3
 * verlangen [W].
 *
 * Nachgerechnet: Δϑ_norm = (35 − 25)/ln(35/25) = 29,72 K,
 * Δϑ = (30 − 20)/ln(30/20) = 24,66 K, Faktor = (29,72/24,66)^1,3 = 1,2744,
 * 1600 W × 1,2744 = 2039 W, auf 10 W gerundet 2040 W. Das sind +28 %.
 */
const NORM_50_40 = 2040;

/**
 * Dasselbe bei 45/38/20 [W].
 *
 * Δϑ = (25 − 18)/ln(25/18) = 21,31 K, Faktor = (29,72/21,31)^1,3 = 1,5412,
 * 1600 W × 1,5412 = 2466 W → 2470 W. Das sind +54 %.
 */
const NORM_45_38 = 2470;

/**
 * Und bei 35/28/20 [W] — der Fall, um den es geht.
 *
 * Δϑ = (15 − 8)/ln(15/8) = 11,14 K, Faktor = (29,72/11,14)^1,3 = 3,5829,
 * 1600 W × 3,5829 = 5733 W → 5730 W. Das sind +258 %, und das ist die
 * Antwort auf die Frage, warum ein Altbauheizkörper an einer Wärmepumpe oft
 * nicht reicht: Nicht der Heizkörper ist schlechter geworden, die
 * Übertemperatur ist kleiner.
 */
const NORM_35_28 = 5730;

// ---------------------------------------------------------------------------
// Das Prüfhaus
// ---------------------------------------------------------------------------

const HOEHE = 2.75;
/** Grundriss 10 × 8 m über Wandachsen, Trennwand bei x = 6. */
const BREITE = 10;
const TIEFE = 8;
const TRENNWAND = 6;

/**
 * Ein Haus mit zwei Räumen: im Westen zwei Heizkörper, im Osten einer.
 *
 * **Zwei Räume und drei Heizkörper**, weil sich nur so beide Regeln zugleich
 * zeigen: Der Westraum prüft die Teilung der Raumlast auf mehrere Flächen,
 * der Ostraum die Umrechnung ohne Teilung. In einem Raum mit drei Flächen
 * ließe sich die Teilung nicht von der Umrechnung trennen.
 *
 * **`plant.design` bleibt bei der Vorbelegung 35/28 °C.** Das ist der Kern
 * des Falls in Abschnitt F: Im Anlagenblatt steht der
 * Wärmepumpen-Flächenheizungsfall, gebaut werden aber Heizkörper — und die
 * Anlage fährt dann mindestens 50/40.
 *
 * Die Räume entstehen über `detectRooms` aus den Wänden, nicht über von Hand
 * gesetzte Polygone: Ein handgeschriebenes Polygon wäre eine zweite,
 * stillschweigende Fassung der Raumerkennung und würde nicht mit ihr altern.
 * Die Raumlast bekommt jeder Raum dagegen ausdrücklich gesetzt (siehe
 * Modulkopf).
 */
function baueHaus(): BimDocument {
  const nodes: Record<string, BimNode> = {
    sw: { id: 'sw', x: 0, y: 0, levelId: 'eg' },
    sm: { id: 'sm', x: TRENNWAND, y: 0, levelId: 'eg' },
    se: { id: 'se', x: BREITE, y: 0, levelId: 'eg' },
    ne: { id: 'ne', x: BREITE, y: TIEFE, levelId: 'eg' },
    nm: { id: 'nm', x: TRENNWAND, y: TIEFE, levelId: 'eg' },
    nw: { id: 'nw', x: 0, y: TIEFE, levelId: 'eg' },
  };
  const kante = (id: string, a: string, b: string, innen = false): Wall => ({
    id,
    a,
    b,
    levelId: 'eg',
    type: innen ? 'interior' : 'exterior',
    thickness: innen ? 0.115 : 0.36,
    uValue: innen ? 1.3 : 0.28,
    height: HOEHE,
    layerId: 'layer-walls',
  });
  const walls: Record<string, Wall> = {
    sw: kante('sw', 'sw', 'sm'),
    so: kante('so', 'sm', 'se'),
    o: kante('o', 'se', 'ne'),
    no: kante('no', 'ne', 'nm'),
    nw: kante('nw', 'nm', 'nw'),
    w: kante('w', 'nw', 'sw'),
    m: kante('m', 'sm', 'nm', true),
  };
  const eg: Level = {
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

  const objekt = (id: string, type: string, x: number, params: object): Fixture =>
    ({
      id,
      type,
      category: 'heating',
      label: id,
      levelId: 'eg',
      position: { x, y: 0.4 },
      rotation: 0,
      length: 1,
      depth: 0.12,
      elevation: 0.3,
      params,
    }) as Fixture;

  const fixtures: Record<string, Fixture> = {
    // Der Erzeuger trägt keine eigenen Temperaturen — was die Anlage fährt,
    // beantwortet `systemtemperaturVon` und nicht ein Feld am Symbol.
    kessel: objekt('kessel', 'boiler', 0.6, {}),
    // Westraum: zwei Heizkörper, beide aus der Symbolbibliothek vorbelegt.
    hkW1: objekt('hkW1', 'radiator', 2, { powerW: 1000, powerSource: 'katalog' }),
    hkW2: objekt('hkW2', 'radiator', 4, { powerW: 1000, powerSource: 'katalog' }),
    // Ostraum: ein Heizkörper, dessen Leistung aus einem Datenblatt stammt.
    hkO: objekt('hkO', 'radiator', 8, { powerW: 1000, powerSource: 'datenblatt' }),
  };

  const doc: BimDocument = {
    site: emptySite(),
    plant: emptyPlant(),
    meta: {
      name: 'Prüfhaus Heizfläche',
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
    nodes,
    walls,
    openings: {},
    fixtures,
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

  const raeume = detectRooms({
    nodes: doc.nodes,
    walls: Object.values(doc.walls),
    openings: [],
    levelId: 'eg',
    defaultHeight: HOEHE,
    northAngle: 0,
  });
  doc.rooms = Object.fromEntries(raeume.map((r) => [r.id, r]));
  for (const raum of Object.values(doc.rooms)) {
    raum.setpointTemperature = 20;
    raum.isHeated = true;
    /*
     * Die gerechnete Norm-Heizlast, so wie RaVia sie zurückschreibt. Der
     * Westraum bekommt 3200 W, weil dort zwei Heizkörper stehen: geteilt
     * ergibt das je 1600 W und damit denselben Anteil wie im Ostraum. Beide
     * Räume führen so auf dieselbe von Hand gerechnete Normleistung — die
     * Teilung lässt sich dann an einer Zahl ablesen und nicht an zweien.
     */
    const westen = raum.centroid.x < TRENNWAND;
    raum.normHeatLoad = {
      total: westen ? HEIZLAST * 2 : HEIZLAST,
      source: 'Prüfung',
      receivedAt: '2026-01-01T00:00:00.000Z',
    };
  }
  // Objekte ihren Räumen zuordnen — über die Lage zur Trennwand. Ohne `roomId`
  // sieht der Abgleich die Heizfläche nicht.
  for (const f of Object.values(doc.fixtures)) {
    const raum = Object.values(doc.rooms).find(
      (r) => (f.position.x < TRENNWAND) === (r.centroid.x < TRENNWAND),
    );
    if (raum) f.roomId = raum.id;
  }
  return doc;
}

/**
 * Das Haus mit einer anderen Leistung und Herkunft am Ostheizkörper.
 *
 * `powerSource` hat bewusst **keinen** Vorgabewert: Der Fall „kein
 * Herkunftsfeld" (Abschnitt E) muss sich ausdrücklich hinschreiben lassen,
 * und mit einem Vorgabewert bekäme ein übergebenes `undefined` ihn wieder
 * zugeschoben — die Prüfung prüfte dann etwas anderes, als sie behauptet.
 */
function hausMitOstwert(
  powerW: number | undefined,
  powerSource: LeistungHerkunft | undefined,
): BimDocument {
  const doc = baueHaus();
  const f = doc.fixtures.hkO;
  doc.fixtures.hkO = { ...f, params: { ...f.params, powerW, powerSource } };
  return doc;
}

const r1 = (v: number): number => Math.round(v * 10) / 10;

/** Die Umrechnung mit den Vorgaben dieses Blocks — nur die Temperaturen wechseln. */
const norm = (vorlauf: number, ruecklauf: number, raum = 20) =>
  normleistungFuerHeizlast({ heizlast: HEIZLAST, vorlauf, ruecklauf, raum, type: 'radiator' });

// ---------------------------------------------------------------------------
// Die Prüfungen
// ---------------------------------------------------------------------------

export function pruefeHeizflaeche(check: CheckFn): void {
  // === A — Der Normpunkt ==================================================
  //
  // Δϑ_norm = (55 − 20 − (45 − 20)) / ln((55 − 20)/(45 − 20))
  //         = 10 / ln(1,4) = 29,72 K.
  // Diese Zahl ist der Nenner jeder Umrechnung; läuft sie weg, wandert jede
  // abgeleitete Leistung mit, und zwar gleichsinnig und damit unauffällig.
  check('Die Normübertemperatur bei 55/45/20 liegt bei 29,7 K', r1(NORM_UEBERTEMPERATUR), 29.7);

  // === B — Die drei Beispiele aus dem Modulkopf ===========================
  //
  // 1600 W Raumheizlast, Heizkörper, n = 1,3 als Richtwert für die Bauart.
  check('1600 W bei 50/40/20 verlangen 2040 W Normleistung', norm(50, 40)?.watt ?? -1, NORM_50_40);
  check('… bei 45/38/20 sind es 2470 W', norm(45, 38)?.watt ?? -1, NORM_45_38);
  check('… und bei 35/28/20 schon 5730 W', norm(35, 28)?.watt ?? -1, NORM_35_28);

  // Die Zwischengrößen, die neben der Zahl stehen und sie begründen:
  // Δϑ = (30 − 20)/ln(30/20) = 24,66 K, Faktor = (29,72/24,66)^1,3 = 1,274.
  check('Die Übertemperatur bei 50/40/20 ist 24,7 K', norm(50, 40)?.uebertemperatur ?? -1, 24.7);
  check('Der Faktor auf den Normpunkt ist 1,274', norm(50, 40)?.faktor ?? -1, 1.274, 0.0005);

  /*
   * Der Exponent: Ohne Angabe am Objekt gilt der Richtwert der Bauart, und
   * das Ergebnis sagt das auch. Die Kennzeichnung ist nicht Schmuck — eine
   * angenommene Zahl, die aussieht wie eine abgelesene, ist die gefährlichste
   * Art von Zahl.
   */
  check('Ohne Angabe am Objekt gilt der Richtwert', norm(50, 40)?.exponent ?? -1, 1.3);
  check('… und er ist als Annahme gekennzeichnet', norm(50, 40)?.exponentAngenommen ?? false, true);
  const eigenerExponent = normleistungFuerHeizlast({
    heizlast: HEIZLAST,
    vorlauf: 50,
    ruecklauf: 40,
    raum: 20,
    type: 'radiator',
    exponent: 1.3,
  });
  check('Ein erfasster Exponent gilt als erfasst', eigenerExponent?.exponentAngenommen ?? true, false);
  check('… und führt bei n = 1,3 auf dieselbe Leistung', eigenerExponent?.watt ?? -1, NORM_50_40);

  /*
   * Eine andere Bauart hat einen anderen Richtwert: Der Konvektor rechnet mit
   * n = 1,4 und braucht deshalb mehr.
   * Faktor = (29,72/24,66)^1,4 = 1,2984, 1600 W × 1,2984 = 2077 W → 2080 W.
   */
  check(
    'Ein Konvektor rechnet mit n = 1,4 und braucht 2080 W',
    normleistungFuerHeizlast({ heizlast: HEIZLAST, vorlauf: 50, ruecklauf: 40, raum: 20, type: 'convector' })?.watt ?? -1,
    2080,
  );
  check('Heizkörper und Konvektor gelten als Heizfläche', istHeizflaeche('radiator') && istHeizflaeche('convector'), true);
  check('Ein Kessel nicht', istHeizflaeche('boiler'), false);

  // === C — Wo es kein Ergebnis gibt =======================================
  //
  // **Kein Ersatzwert, sondern `null`.** Ein Vorschlag, der auf geratenen
  // Eingaben beruht, sieht genauso aus wie einer auf erfassten — der Anwender
  // kann die beiden dann nicht mehr auseinanderhalten.

  check(
    'Heizlast null: kein Vorschlag',
    normleistungFuerHeizlast({ heizlast: 0, vorlauf: 50, ruecklauf: 40, raum: 20, type: 'radiator' }) === null,
    true,
  );
  check(
    'Negative Heizlast: kein Vorschlag',
    normleistungFuerHeizlast({ heizlast: -1600, vorlauf: 50, ruecklauf: 40, raum: 20, type: 'radiator' }) === null,
    true,
  );

  /*
   * Die Untergrenze der Übertemperatur: 5 K.
   *
   * Ein Vorlauf von 22 °C bei 20 °C Raumtemperatur ist ein Eingabefehler und
   * kein Auslegungsfall. Der Faktor (29,72/1,44)^1,3 liegt bei 51 — der
   * Vorschlag stünde bei über 80 kW für ein Schlafzimmer, und das sähe aus
   * wie ein Rechenergebnis.
   */
  check('Ein Vorlauf von 22 °C bei 20 °C Raum: kein Vorschlag', norm(22, 21) === null, true);
  /*
   * Die Grenze von beiden Seiten. Bei gleichem Vor- und Rücklauf ist die
   * logarithmische Übertemperatur die Differenz zur Raumtemperatur selbst —
   * 25/25/20 sind also genau 5,0 K und 24,9/24,9/20 genau 4,9 K. Sauberer
   * lässt sich diese Schwelle nicht treffen.
   */
  check('Genau 5 K werden noch gerechnet', norm(25, 25)?.uebertemperatur ?? -1, 5);
  check('Knapp darunter nicht mehr', norm(24.9, 24.9) === null, true);

  /*
   * Eine Bauart ohne Richtwert: Ein Kessel ist keine Heizfläche, und für ihn
   * gibt es keinen Heizkörperexponenten. Ohne n lässt sich die Potenz nicht
   * bilden — geraten wird auch hier nicht.
   */
  check(
    'Unbekannte Bauart ohne Exponent: kein Vorschlag',
    normleistungFuerHeizlast({ heizlast: HEIZLAST, vorlauf: 50, ruecklauf: 40, raum: 20, type: 'boiler' }) === null,
    true,
  );
  check(
    '… mit erfasstem Exponenten rechnet auch sie',
    normleistungFuerHeizlast({ heizlast: HEIZLAST, vorlauf: 50, ruecklauf: 40, raum: 20, type: 'boiler', exponent: 1.3 })?.watt ?? -1,
    NORM_50_40,
  );

  // === D — Die Aufteilung auf mehrere Heizflächen =========================
  //
  // Gleichmäßig — eine Annahme, keine Rechnung. Ohne Teilung bekäme jeder von
  // zwei Heizkörpern die volle Raumheizlast, und der Raum wäre auf dem Papier
  // doppelt beheizt; das ist die schlechtere Annahme.
  check('Zwei Heizflächen teilen die Last', anteilJeHeizflaeche(3200, 2), 1600);
  check('Eine bekommt sie ganz', anteilJeHeizflaeche(1600, 1), 1600);
  // Null Heizflächen: keine Division durch null, kein `Infinity`, das sich
  // später als Leistung ausgäbe.
  check('Ohne Heizfläche gibt es keinen Anteil', anteilJeHeizflaeche(1600, 0), 0);
  check('… und keine ungültige Zahl', Number.isFinite(anteilJeHeizflaeche(1600, 0)), true);
  check('Eine negative Anzahl ebenso', anteilJeHeizflaeche(1600, -2), 0);

  // === E — Was nachgezogen werden darf ====================================
  //
  // Die Regel in einem Satz: Nachgezogen wird nur, was das Programm selbst
  // gesetzt hat.
  check('Eine Katalogvorbelegung darf überschrieben werden', leistungNachziehbar('katalog'), true);
  check('Eine schon abgeleitete Leistung auch', leistungNachziehbar('heizlast'), true);
  check('Ein Datenblattwert nicht', leistungNachziehbar('datenblatt'), false);
  check('Eine von RaVia gerechnete Zahl nicht', leistungNachziehbar('ravia'), false);
  /*
   * **Der eine Fehler, den es nicht geben darf.** Projekte aus älteren
   * Fassungen tragen das Herkunftsfeld nicht — und in ihnen hat der Anwender
   * die Leistungen von Hand gepflegt. Eine fehlende Herkunft im Nachhinein
   * für „überschreibbar" zu erklären, hieße, beim ersten Öffnen eines alten
   * Projekts jede gepflegte Zahl stillschweigend zu ersetzen.
   */
  check('Eine fehlende Herkunft gilt als eingetragen und bleibt stehen', leistungNachziehbar(undefined), false);

  // === F — Der Abgleich am Dokument =======================================

  const doc = baueHaus();

  /*
   * **Der Kernfall: `systemtemperaturVon(doc)` und nicht `plant.design`.**
   *
   * Im Anlagenblatt steht 35/28 °C — der Regelfall einer Wärmepumpe mit
   * Flächenheizung. Gebaut sind aber Heizkörper, und ein Heizkörperkreis wird
   * auf mindestens 50/40 °C angehoben. Nur diese angehobene Temperatur fährt
   * die Anlage wirklich.
   *
   * Rechnete der Abgleich mit 35/28, verlangte er 5730 W statt 2040 W — den
   * 2,8-fachen Wert. Das Programm meldete dann reihenweise „Heizkörper zu
   * klein" für Flächen, die reichen, und erzeugte Austauschbedarf, den es
   * nicht gibt. Das ist die gefährliche Richtung: Ein zu kleiner Vorschlag
   * fällt im ersten Winter auf, ein zu großer kostet vorher Geld.
   */
  check('Im Anlagenblatt steht 35 °C Vorlauf', doc.plant.design.flowTemperature, 35);
  check('… und 28 °C Rücklauf', doc.plant.design.returnTemperature, 28);
  check('Maßgeblich sind aber 50 °C', systemtemperaturVon(doc).vorlauf, 50);
  check('… und 40 °C', systemtemperaturVon(doc).ruecklauf, 40);

  const ostbefund = heizflaechenBefunde(doc).find((b) => b.fixtureId === 'hkO');
  check('Für den Ostheizkörper gibt es einen Befund', ostbefund !== undefined, true);
  check('Er verlangt die 2040 W der angehobenen Temperatur', ostbefund?.soll ?? -1, NORM_50_40);
  check('… und nicht die 5730 W aus dem Anlagenblatt', ostbefund?.soll === NORM_35_28, false);
  check('Die Begründung nennt die Übertemperatur von 24,7 K', (ostbefund?.begruendung ?? '').includes('24,7 K'), true);
  check('… und den Normpunkt, auf den gerechnet wird', (ostbefund?.begruendung ?? '').includes('55/45/20'), true);
  check('Er nennt die Leistung, die am Objekt steht', ostbefund?.ist ?? -1, 1000);
  check('Er nennt den Raum', ostbefund?.roomName ?? 'fehlt', 'Raum 2');

  // Die Teilung im Westraum: 3200 W auf zwei Heizkörper, je 1600 W Anteil —
  // und damit dieselben 2040 W wie im Ostraum, nur aus der doppelten Last.
  const westbefunde = heizflaechenBefunde(doc).filter((b) => b.fixtureId.startsWith('hkW'));
  check('Beide Westheizkörper bekommen einen Befund', westbefunde.length, 2);
  check('Der Befund weist die Zahl der Heizflächen aus', westbefunde[0]?.anzahl ?? -1, 2);
  check('Beide verlangen dieselben 2040 W', westbefunde.every((b) => b.soll === NORM_50_40), true);
  check(
    'Die Begründung nennt die Teilung',
    (westbefunde[0]?.begruendung ?? '').includes('2 Heizflächen, Last gleichmäßig geteilt'),
    true,
  );
  check('… und den geteilten Anteil, nicht die Raumlast', (westbefunde[0]?.begruendung ?? '').includes('1600 W Raumheizlast'), true);

  // Herkunft: Katalog darf nachgezogen werden, Datenblatt nicht.
  check('Die Katalogvorbelegung ist nachziehbar', westbefunde.every((b) => b.nachziehbar), true);
  check('Der Datenblattwert nicht', ostbefund?.nachziehbar ?? true, false);
  /*
   * Und ein Heizkörper ganz ohne Herkunftsfeld — der Normalfall in einem
   * Projekt aus einer älteren Fassung — bleibt ebenfalls stehen. Derselbe
   * Fall wie oben, aber diesmal über den ganzen Weg durch den Abgleich statt
   * an `leistungNachziehbar` allein.
   */
  const alt = heizflaechenbefundFuer(hausMitOstwert(1000, undefined), 'hkO');
  check('Eine Leistung ohne Herkunftsfeld bleibt stehen', alt?.nachziehbar ?? true, false);

  /*
   * **Der Datenblattwert bleibt stehen, auch wenn er nicht passt** — das ist
   * kein Versäumnis, sondern das Ergebnis: *diese Fläche reicht nicht*. Ein
   * Werkzeug, das hier „hilfreich" korrigiert, vernichtet den Befund, wegen
   * dessen die Sanierung überhaupt geplant wird.
   */
  const docZiehen = baueHaus();
  check('Nachgezogen werden nur die beiden Katalogwerte', zieheHeizflaechenNach(docZiehen), 2);
  check('Der Westheizkörper trägt jetzt 2040 W', docZiehen.fixtures.hkW1.params.powerW ?? -1, NORM_50_40);
  check('… und die Herkunft „aus der Heizlast"', docZiehen.fixtures.hkW1.params.powerSource ?? 'fehlt', 'heizlast');
  check('Der Datenblattwert steht unverändert bei 1000 W', docZiehen.fixtures.hkO.params.powerW ?? -1, 1000);
  check('… mit unveränderter Herkunft', docZiehen.fixtures.hkO.params.powerSource ?? 'fehlt', 'datenblatt');
  // Ein zweiter Lauf ändert nichts mehr — sonst schriebe jeder Aufruf einen
  // weiteren Schritt in die Historie.
  check('Ein zweiter Lauf ändert nichts mehr', zieheHeizflaechenNach(docZiehen), 0);
  // Und der stehengebliebene Datenblattwert ist der Befund, der in die
  // Prüfliste gehört.
  check('Der unterdeckte Heizkörper steht in der Liste', unterdeckteHeizflaechen(docZiehen).length, 1);
  check('… und zwar der aus dem Ostraum', unterdeckteHeizflaechen(docZiehen)[0]?.fixtureId ?? 'fehlt', 'hkO');

  /*
   * **Die Totzone von zwei Prozent.** Ohne sie schriebe jede Rundung der
   * Heizlast eine neue Leistung an jeden Heizkörper — und damit bei jeder
   * Eingabe einen neuen Schritt in die Historie.
   *
   * Zwei Prozent von 2040 W sind 40,8 W. 2000 W weichen um 40 W ab (1,96 %)
   * und bleiben unbehelligt; 1999 W weichen um 41 W ab (2,01 %) und werden
   * gemeldet. Ein Watt Unterschied an der Eingabe, ein Befund Unterschied am
   * Ergebnis — genauer lässt sich eine Schwelle nicht einfassen.
   */
  const knappDrin = heizflaechenBefunde(hausMitOstwert(2000, 'katalog')).filter((b) => b.fixtureId === 'hkO');
  check('1,96 % Abweichung bleiben unter der Totzone', knappDrin.length, 0);
  const knappDraussen = heizflaechenBefunde(hausMitOstwert(1999, 'katalog')).filter((b) => b.fixtureId === 'hkO');
  check('2,01 % Abweichung werden gemeldet', knappDraussen.length, 1);
  check('… mit denselben 2040 W als Soll', knappDraussen[0]?.soll ?? -1, NORM_50_40);
  // Eine Heizfläche ganz ohne erfasste Leistung ist immer ein Befund: Es gibt
  // nichts, wovon sie um weniger als zwei Prozent abweichen könnte.
  const ohneLeistung = heizflaechenBefunde(hausMitOstwert(undefined, 'katalog')).filter((b) => b.fixtureId === 'hkO');
  check('Ohne erfasste Leistung gibt es immer einen Befund', ohneLeistung.length, 1);
  check('… und das Ist-Feld bleibt leer statt null zu behaupten', ohneLeistung[0]?.ist === undefined, true);

  // === G — Die zweite Abfrage: der Inspektor ==============================
  //
  // `heizflaechenBefunde` beantwortet die Frage *ob nachgezogen wird* und
  // unterdrückt dafür Abweichungen unter zwei Prozent. `heizflaechenbefundFuer`
  // stellt die andere Frage: *warum steht diese Zahl da*. Es rechnet deshalb
  // ohne Totzone.
  const inspektor = heizflaechenbefundFuer(hausMitOstwert(2000, 'katalog'), 'hkO');
  check('Der Inspektor kennt die Totzone nicht', inspektor !== undefined, true);
  check('… und nennt dieselben 2040 W', inspektor?.soll ?? -1, NORM_50_40);
  check('… neben der Zahl, die am Objekt steht', inspektor?.ist ?? -1, 2000);
  check('Für ein Bauteil ohne Heizfläche gibt es nichts', heizflaechenbefundFuer(doc, 'kessel') === undefined, true);
  check('Für eine unbekannte Kennung ebenso', heizflaechenbefundFuer(doc, 'gibt-es-nicht') === undefined, true);

  /*
   * =====================================================================
   * BEFUND (offen, nicht repariert) — die Begründung fehlt genau dann,
   * wenn sie gebraucht wird
   * =====================================================================
   *
   * **Eingabe.** Das Prüfhaus mit `hkO` auf genau 2040 W und der Herkunft
   * `katalog` — also eine Heizfläche, deren Leistung exakt der geforderten
   * Normleistung entspricht. Das ist der Zustand unmittelbar nach
   * `zieheHeizflaechenNach`, und damit der Normalfall im Inspektor.
   *
   * **Erwartet.** `heizflaechenbefundFuer(doc, 'hkO')` liefert einen Befund
   * mit soll = 2040 W, ist = 2040 W und der Begründung, aus der hervorgeht,
   * woher die Zahl stammt. Der Modulkopf von `heizflaechenAbgleich.ts` sagt
   * das ausdrücklich: „Für eine gerade nachgezogene Leistung ist die
   * Abweichung null — und genau dann fehlte die Begründung, die den
   * Unterschied zwischen abgeleitet und abgelesen überhaupt sichtbar macht."
   *
   * **Tatsächlich.** `undefined`. Es gibt keinen Befund und damit keine
   * Begründung.
   *
   * **Wo es passiert.** In `befunde()` in `heizflaechenAbgleich.ts`:
   *
   *     if (abweichung <= opt.totzone) continue;
   *
   * Der Inspektorweg übergibt `totzone: 0`. Bei einer Abweichung von genau
   * null war `0 <= 0` wahr, und die Zeile wurde übersprungen — die Totzone
   * „null" schloss den Nullfall gerade ein, statt ihn auszunehmen.
   *
   * **Die Wirkung war genau die, gegen die es die zweite Abfrage gibt:** Eine
   * Leistung, die das Programm selbst gesetzt hatte, stand im Inspektor ohne
   * jede Herkunft da — ununterscheidbar von einer, die jemand aus einem
   * Datenblatt abgelesen hatte. Und der Normalfall direkt nach dem
   * Nachziehen ist die Abweichung null.
   *
   * Behoben durch die zusätzliche Bedingung `opt.totzone > 0`. Diese Prüfung
   * ist die Wache davor.
   */
  const nullAbweichung = heizflaechenbefundFuer(hausMitOstwert(NORM_50_40, 'katalog'), 'hkO');
  check(
    'Bei Abweichung null liefert der Inspektor trotzdem einen Befund',
    nullAbweichung !== undefined,
    true,
  );
  check('… mit soll = 2040 W', nullAbweichung?.soll ?? -1, NORM_50_40);
  check('… und derselben Begründung wie sonst', (nullAbweichung?.begruendung ?? '').includes('Raumheizlast'), true);
  // Die Gegenprobe, die zeigt, dass es allein an der Abweichung null liegt und
  // nicht an der Kennung: ein Watt daneben, und der Befund ist da.
  const fastNull = heizflaechenbefundFuer(hausMitOstwert(NORM_50_40 - 1, 'katalog'), 'hkO');
  check('… ein Watt daneben liefert er ihn', fastNull !== undefined, true);
  check('… mit soll = 2040 W (was auch im Nullfall stünde)', fastNull?.soll ?? -1, NORM_50_40);
  check('… und ist = 2039 W', fastNull?.ist ?? -1, NORM_50_40 - 1);
}
