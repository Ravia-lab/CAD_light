/**
 * Prüfblock „Systemtemperatur" — mit welcher Temperatur rechnet die Anlage?
 *
 * **Der Befund, den dieser Block festhält.** An einem reinen Heizkörperhaus
 * mit 35/28 °C im Anlagenblatt stand bis 1.23.0 dreierlei gleichzeitig im
 * Programm:
 *
 * ```
 * plant.design VL/RL = 35 28              ← Anlagenblatt
 *  Kreis Heizkörper EG  radiator 50/40    ← plantDesign hebt richtig an
 *  pipeReport verwendet: 35 / 28          ← und alles darunter nimmt wieder 35/28
 * ```
 *
 * 7 K statt 10 K Spreizung sind über V̇ = Q/(1,163·Δϑ) rund 43 % Volumenstrom
 * zu viel. Jede Nennweite, jede Reynoldszahl und jedes λ auf dem
 * Nachweisblatt waren damit falsch — und niemand konnte es sehen, weil der
 * Bericht die Temperatur ohne Absender auswies.
 *
 * **Die Zahlen stehen hier von Hand.** Eine Prüfung, die ihre Erwartung aus
 * derselben Formel holt, die sie prüft, bestätigt nur, dass die Formel sich
 * selbst gleicht. Die Sollwerte unten sind nachgerechnet und im Kommentar
 * hergeleitet; wer sie ändert, muss die Herleitung mitändern.
 *
 * **Was dieser Block nicht prüft.** Ob 50/40 die *richtige* Auslegung für
 * einen bestimmten Heizkörper ist — das entscheidet die Heizflächenrechnung
 * (`heizflaechenLeistung`) und nicht die Systemtemperatur. Hier geht es
 * ausschließlich darum, dass alle Stellen dieselbe Zahl benutzen.
 */

import type { CheckFn } from './typ';
import type { BimDocument, BimNode, Fixture, Level, PipeRun, Wall } from '../../src/types/bim';
import { emptyPlant, emptySite } from '../../src/lib/plantDefaults';
import { detectRooms } from '../../src/lib/roomDetection';
import { designPlant } from '../../src/lib/plantDesign';
import { buildPipeReport } from '../../src/lib/pipeReport';
import { connectionDiameter } from '../../src/lib/safetyFittings';
import {
  HEIZKOERPER_MINDESTRUECKLAUF,
  HEIZKOERPER_MINDESTVORLAUF,
  kreistemperatur,
  systemtemperatur,
  systemtemperaturVon,
} from '../../src/lib/systemtemperatur';

// ---------------------------------------------------------------------------
// Das Prüfhaus
// ---------------------------------------------------------------------------

/** Außenmaß über Wandachsen [m] — ein Rechteck, mehr braucht es nicht. */
const BREITE = 10;
const TIEFE = 8;
const HOEHE = 2.75;

/** Wie die Räume beheizt werden — das ist die einzige Stellschraube. */
type Bestueckung = 'heizkoerper' | 'flaeche' | 'gemischt' | 'nichts';

/**
 * Ein Haus mit zwei Räumen, einem Erzeuger und je einer Heizfläche.
 *
 * **Zwei Räume und nicht einer**, weil der gemischte Fall sonst nicht
 * abbildbar ist: Stehen Fläche und Heizkörper im selben Raum, gilt der Raum
 * als Fläche (der Heizkörper ist dann die Ergänzung im Bad, nicht der
 * Kreis) — und aus einem Raum wird nie ein gemischtes System.
 *
 * Der Erzeuger steht im Westraum, die Leitung läuft zur Heizfläche im
 * Ostraum. Ohne die gezeichnete Leitung hätte der Rohrnetzbericht keine
 * Teilstrecke, und genau die Teilstrecke ist die Zeile, an der sich der
 * Befund zeigt.
 *
 * `plant.design` bleibt bei der Vorbelegung 35/28 °C. Das ist der Kern des
 * Falls: Im Anlagenblatt steht der Wärmepumpen-Regelfall, gebaut werden aber
 * Heizkörper.
 */
function baueHaus(bestueckung: Bestueckung): BimDocument {
  const nodes: Record<string, BimNode> = {
    sw: { id: 'sw', x: 0, y: 0, levelId: 'eg' },
    sm: { id: 'sm', x: 6, y: 0, levelId: 'eg' },
    se: { id: 'se', x: BREITE, y: 0, levelId: 'eg' },
    ne: { id: 'ne', x: BREITE, y: TIEFE, levelId: 'eg' },
    nm: { id: 'nm', x: 6, y: TIEFE, levelId: 'eg' },
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

  const objekt = (id: string, type: string, x: number, y: number, params: object): Fixture =>
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
      params,
    }) as Fixture;

  /*
   * Was im Westraum steckt und was im Ostraum.
   *
   * Beim gemischten Haus liegt die Fläche im Westen und der Heizkörper im
   * Osten — so entsteht je Art genau ein Kreis, und der heißere gibt den Ton
   * an.
   */
  const westen: 'radiator' | 'underfloor' = bestueckung === 'heizkoerper' ? 'radiator' : 'underfloor';
  const osten: 'radiator' | 'underfloor' = bestueckung === 'flaeche' ? 'underfloor' : 'radiator';
  const fixtures: Record<string, Fixture> = {
    // Der Wärmeerzeuger. Er trägt **keine** eigenen Temperaturen: Was er
    // fährt, ist die Frage, die dieser Prüfblock stellt.
    kessel: objekt('kessel', 'boiler', 0.6, 0.6, {}),
  };
  if (bestueckung !== 'nichts') {
    fixtures.hfW = objekt('hfW', westen, 3, 0.4, { powerW: 1800 });
    fixtures.hfO = objekt('hfO', osten, 8, 0.4, { powerW: 2400 });
  }

  const pipes: Record<string, PipeRun> = {
    p1: {
      id: 'p1',
      levelId: 'eg',
      service: 'heating-flow',
      points: [
        { x: 0.6, y: 0.6 },
        { x: 8, y: 0.6 },
        { x: 8, y: 0.4 },
      ],
      nominalDiameter: 16,
      insulation: 9,
      elevation: 0.1,
      fromFixtureId: 'kessel',
      toFixtureId: 'hfO',
    },
  };

  const doc: BimDocument = {
    site: emptySite(),
    plant: emptyPlant(),
    meta: {
      name: 'Prüfhaus Systemtemperatur',
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
    pipes,
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
  }
  // Die Objekte ihren Räumen zuordnen — über die Lage zur Trennwand bei
  // x = 6. Ohne `roomId` sieht `heizflaechenArten` nichts, und genau das ist
  // der Zustand „unbekannt", den der letzte Abschnitt prüft.
  for (const f of Object.values(doc.fixtures)) {
    const raum = Object.values(doc.rooms).find((r) => (f.position.x < 6) === (r.centroid.x < 6));
    if (raum) f.roomId = raum.id;
  }
  return doc;
}

/** Ein leeres Modell — keine Wand, kein Raum, kein Kreis. */
function leeresModell(): BimDocument {
  const doc = baueHaus('nichts');
  return { ...doc, nodes: {}, walls: {}, rooms: {}, fixtures: {}, pipes: {} };
}

const r3 = (v: number): number => Math.round(v * 1000) / 1000;

// ---------------------------------------------------------------------------
// Die Prüfungen
// ---------------------------------------------------------------------------

export function pruefeSystemtemperatur(check: CheckFn): void {
  // --- Die Regel für sich ------------------------------------------------
  //
  // Sie stand bis 1.23.0 als Ausdruck in `deriveCircuits` und war damit für
  // niemanden prüfbar. Hier ist sie es.
  const blatt = { vorlauf: 35, ruecklauf: 28 };
  check('Ein Heizkörperkreis wird auf 50 °C angehoben', kreistemperatur('heizkoerper', blatt).vorlauf, 50);
  check('… und sein Rücklauf auf 40 °C', kreistemperatur('heizkoerper', blatt).ruecklauf, 40);
  check('Eine Fläche bleibt beim Anlagenblatt', kreistemperatur('flaeche', blatt).vorlauf, 35);
  check('… auch im Rücklauf', kreistemperatur('flaeche', blatt).ruecklauf, 28);
  // Ein Raum ohne Heizfläche gilt als Fläche — die Annahme bleibt, aber sie
  // hat jetzt einen Namen und wird gemeldet.
  check('„unbekannt" wird wie Fläche behandelt', kreistemperatur('unbekannt', blatt).vorlauf, 35);
  // Mindestwert, keine Vorgabe: 55/45 im Anlagenblatt werden nicht auf 50/40
  // heruntergezogen. Ein Heizkörper, der 55 °C braucht, bekommt sie.
  const heiss = kreistemperatur('heizkoerper', { vorlauf: 55, ruecklauf: 45 });
  check('55/45 bleiben 55 °C Vorlauf', heiss.vorlauf, 55);
  check('… und 45 °C Rücklauf', heiss.ruecklauf, 45);
  check('Der Mindestvorlauf ist 50 °C', HEIZKOERPER_MINDESTVORLAUF, 50);
  check('Der Mindestrücklauf ist 40 °C', HEIZKOERPER_MINDESTRUECKLAUF, 40);

  // --- Der heißeste Kreis gibt den Ton an --------------------------------
  const gemischtesSystem = systemtemperatur({
    anlagenblatt: { vorlauf: 35, ruecklauf: 28 },
    kreise: [
      { label: 'Fußbodenheizung EG', vorlauf: 35, ruecklauf: 28 },
      { label: 'Heizkörper EG', vorlauf: 50, ruecklauf: 40 },
    ],
  });
  check('Gemischt: der Erzeuger fährt 50 °C', gemischtesSystem.vorlauf, 50);
  check('… mit 40 °C Rücklauf', gemischtesSystem.ruecklauf, 40);
  check('… also 10 K Spreizung', gemischtesSystem.spreizung, 10);
  check('… und der Absender heißt „angehoben"', gemischtesSystem.herkunft, 'angehoben');
  check('Die Begründung nennt das Anlagenblatt', gemischtesSystem.begruendung.includes('35/28 °C'), true);
  check('… und den Kreis, der mehr verlangt', gemischtesSystem.begruendung.includes('Heizkörper EG'), true);

  /*
   * Die gefährliche Richtung.
   *
   * Anlagenblatt 55/45 (10 K), Kreise fahren 55/50 (5 K). Wer die Spreizung
   * aus dem Anlagenblatt nimmt, rechnet mit dem **halben** Volumenstrom und
   * legt die Leitung eine bis zwei Nennweiten zu klein aus — die Heizflächen
   * werden nicht warm, und der Fehler zeigt sich erst im Winter.
   *
   * Deshalb ist der Rücklauf ein Maximum: 50 schlägt 45, die Spreizung wird
   * 5 K, und die Nennweite fällt eher zu groß als zu klein aus.
   */
  const kleineSpreizung = systemtemperatur({
    anlagenblatt: { vorlauf: 55, ruecklauf: 45 },
    kreise: [{ label: 'Gebläsekonvektor', vorlauf: 55, ruecklauf: 50 }],
  });
  check('Kleine Kreisspreizung schlägt das Anlagenblatt', kleineSpreizung.ruecklauf, 50);
  check('… Spreizung damit 5 K statt 10 K', kleineSpreizung.spreizung, 5);
  check('… und das gilt als Anhebung', kleineSpreizung.herkunft, 'angehoben');

  /*
   * Ein **gemischter** Kreis zählt beim Rücklauf nicht mit.
   *
   * Anlagenblatt 55/45, dazu eine Fußbodenheizung mit 35/28 hinter einem
   * Mischer. Ihr Rücklauf von 28 °C liegt nie am Erzeuger an — er entsteht
   * hinter dem Mischer. Würde er mitgerechnet, käme eine Spreizung von 27 K
   * heraus und damit ein Drittel des wirklichen Volumenstroms.
   */
  const mitMischer = systemtemperatur({
    anlagenblatt: { vorlauf: 55, ruecklauf: 45 },
    kreise: [
      { label: 'Heizkörper', vorlauf: 55, ruecklauf: 45 },
      { label: 'Fußbodenheizung', vorlauf: 35, ruecklauf: 28 },
    ],
  });
  check('Der gemischte Kreis verändert den Rücklauf nicht', mitMischer.ruecklauf, 45);
  check('… Spreizung bleibt 10 K', mitMischer.spreizung, 10);
  check('… und nichts wurde angehoben', mitMischer.herkunft, 'anlagenblatt');

  // --- Das leere Modell ---------------------------------------------------
  //
  // `Math.max()` über eine leere Liste ist −∞; eine Spreizung von −∞ ergibt
  // einen Volumenstrom von NaN, und ein NaN wandert lautlos bis auf das
  // Blatt. Ohne jede Angabe gibt es deshalb eine benannte Vorbelegung.
  const nichts = systemtemperatur({});
  check('Ohne alles: 35 °C Vorlauf', nichts.vorlauf, 35);
  check('Ohne alles: 28 °C Rücklauf', nichts.ruecklauf, 28);
  check('Ohne alles: 7 K Spreizung', nichts.spreizung, 7);
  check('Ohne alles heißt der Absender „vorgabe"', nichts.herkunft, 'vorgabe');
  check('Kein NaN im Ergebnis', Number.isFinite(nichts.spreizung), true);
  check('Die Vorgabe erklärt sich', nichts.begruendung.includes('Vorbelegung'), true);

  const leer = designPlant(leeresModell());
  check('Leeres Modell: Vorlauf bleibt eine Zahl', Number.isFinite(leer.systemtemperatur.vorlauf), true);
  check('Leeres Modell: 35/28 aus dem Anlagenblatt', leer.systemtemperatur.vorlauf, 35);
  check('Leeres Modell: Spreizung 7 K', leer.systemtemperatur.spreizung, 7);
  check('Leeres Modell: keine NaN-Nennweite', Number.isFinite(leer.anschlussDn), true);

  // --- Der Befund am ganzen Haus -----------------------------------------
  //
  // Ein Haus mit **nur** Heizkörpern, Anlagenblatt 35/28. Der Kreis wird auf
  // 50/40 angehoben — das war schon immer richtig. Neu ist, dass der
  // Rohrnetzbericht und die Anschlussnennweite darunter dasselbe tun.
  const hkDoc = baueHaus('heizkoerper');
  const hk = designPlant(hkDoc);
  check('Reines Heizkörperhaus: ein Kreis', hk.circuits.length, 1);
  check('… als Heizkörperkreis geführt', hk.circuits[0].circuit.kind, 'radiator');
  check('… mit 50 °C Vorlauf', hk.circuits[0].circuit.flowTemperature, 50);
  check('… und 40 °C Rücklauf', hk.circuits[0].circuit.returnTemperature, 40);
  check('Die Anlage fährt 50 °C', hk.systemtemperatur.vorlauf, 50);
  check('… Rücklauf 40 °C', hk.systemtemperatur.ruecklauf, 40);
  check('… Spreizung 10 K, nicht 7 K', hk.systemtemperatur.spreizung, 10);
  check('… und das Anlagenblatt sagt weiterhin 35/28', hkDoc.plant?.design.flowTemperature ?? 0, 35);

  const bericht = buildPipeReport(hkDoc);
  // **Die Prüfung, um die es geht.** Bis 1.23.0 stand hier 35/28/7.
  check('Der Rohrnetzbericht rechnet mit 50 °C', bericht.temperaturen.vorlauf, 50);
  check('… 40 °C Rücklauf', bericht.temperaturen.ruecklauf, 40);
  check('… 10 K Spreizung', bericht.temperaturen.spreizung, 10);
  check('… und nennt die Herkunft', bericht.temperaturen.herkunft, 'angehoben');
  check('Die Begründung steht im Bericht', bericht.temperaturen.begruendung.includes('Anlagenblatt'), true);

  /*
   * Die Stoffwerte, die daran hängen.
   *
   * Gerechnet wird bei der mittleren Temperatur: (50+40)/2 = 45 °C statt
   * (35+28)/2 = 31,5 °C. Die Dichte ändert sich von 995,14 auf 990,13 kg/m³ —
   * unter einem Prozent. Die kinematische Zähigkeit fällt von 7,80·10⁻⁷ auf
   * 6,06·10⁻⁷ m²/s, also um 22 %. Sie steht im Nenner der Reynoldszahl und
   * entscheidet damit über λ und über jeden Druckverlust auf dem Blatt.
   */
  check('Dichte bei 45 °C', r3(bericht.fluid.density), 990.13);
  check('Kinematische Zähigkeit bei 45 °C', Math.round(bericht.fluid.kinematicViscosity * 1e9), 606);
  check('Die Bezugstemperatur ist das Mittel', bericht.fluid.temperature, 45);

  /*
   * Die Anschlussnennweite des Erzeugers — die zweite Stelle des Befunds.
   *
   * d = √(4·V̇/(3600·π·v)) mit V̇ = Q/(1,163·Δϑ) und v = 0,8 m/s. Das kleine
   * Prüfhaus trägt nur 2,4 kW Heizlast; dort fällt die Nennweite mit beiden
   * Spreizungen auf DN 15, der Befund wäre unsichtbar. Deshalb dasselbe Haus
   * noch einmal mit 8 kW vorgegebener Gebäudeheizlast — das Gerät leistet
   * dann 9,6 kW im Auslegungspunkt, und dort liegt die Stufengrenze
   * dazwischen:
   *
   *   mit 10 K:  V̇ = 9,6/(1,163·10) = 0,825 m³/h → d = 19,1 mm → DN 20
   *   mit  7 K:  V̇ = 9,6/(1,163· 7) = 1,179 m³/h → d = 22,8 mm → DN 25
   *
   * Eine Nennweite zu groß ist Geld; in der Gegenrichtung — Anlagenblatt
   * wärmer als die Kreise — wäre es eine Nennweite zu klein, und die wird
   * nicht warm.
   */
  const gross = designPlant(hkDoc, { heatLoad: 8 });
  check('Das große Gerät leistet 9,6 kW im Auslegungspunkt', gross.selected?.capacityAtDesign ?? 0, 9.6);
  check('Es rechnet mit 10 K', gross.systemtemperatur.spreizung, 10);
  check('Die Anschlussnennweite ist DN 20, nicht DN 25', gross.anschlussDn, 20);
  // Gegenprobe an demselben Haus: Hätte jemand die Spreizung des
  // Anlagenblatts genommen — 35/28, also 7 K —, käme DN 25 heraus.
  check('Mit der Spreizung des Anlagenblatts wären es DN 25', connectionDiameter(9.6, { spread: 7, velocity: 0.8 }), 25);
  check('Mit der der Anlage sind es DN 20', connectionDiameter(9.6, { spread: 10, velocity: 0.8 }), 20);
  // Am kleinen Haus fällt sie auf DN 15 — geprüft, damit die Zahl oben nicht
  // versehentlich aus einem anderen Haus stammt.
  check('Das kleine Prüfhaus bleibt bei DN 15', hk.anschlussDn, 15);
  check('Der Bericht liest die Nennweite ab, statt sie zu rechnen', bericht.erzeuger.volumenstrom > 0, true);

  // Der Nachweispunkt 5 nach § 60c Abs. 4 GModG — die Zeile, die der
  // Empfänger liest. Sie muss die angehobene Temperatur nennen **und**
  // sagen, dass sie angehoben wurde; sonst sucht er sie im Anlagenblatt.
  const punkt5 = bericht.nachweis.find((p) => p.nr === 5);
  check('Nachweis 5 nennt 50 °C', punkt5?.antwort.includes('Vorlauf 50 °C') ?? false, true);
  check('Nachweis 5 nennt die Spreizung', punkt5?.antwort.includes('Spreizung 10 K') ?? false, true);
  check('Nachweis 5 nennt die Herkunft', punkt5?.herkunft.includes('angehoben') ?? false, true);

  // --- Reines Flächensystem bleibt, wie es ist ---------------------------
  const flDoc = baueHaus('flaeche');
  const fl = designPlant(flDoc);
  check('Reines Flächensystem: 35 °C', fl.systemtemperatur.vorlauf, 35);
  check('… 28 °C Rücklauf', fl.systemtemperatur.ruecklauf, 28);
  check('… 7 K Spreizung', fl.systemtemperatur.spreizung, 7);
  check('… und nichts wurde angehoben', fl.systemtemperatur.herkunft, 'anlagenblatt');
  check('Der Bericht folgt', buildPipeReport(flDoc).temperaturen.spreizung, 7);
  check('… mit den Stoffwerten von 31,5 °C', r3(buildPipeReport(flDoc).fluid.density), 995.14);

  // --- Gemischtes System: der heißeste Kreis --------------------------------
  const gemDoc = baueHaus('gemischt');
  const gem = designPlant(gemDoc);
  check('Gemischtes Haus: zwei Kreise', gem.circuits.length, 2);
  check('Der Erzeuger folgt dem heißesten Kreis', gem.systemtemperatur.vorlauf, 50);
  check('… Spreizung 10 K', gem.systemtemperatur.spreizung, 10);
  check('Der Bericht rechnet mit 50/40', buildPipeReport(gemDoc).temperaturen.vorlauf, 50);
  // Die Fläche hängt hinter einem Mischer — sonst stünden 50 °C im Estrich.
  const flaechenkreis = gem.circuits.find((c) => c.circuit.kind === 'floor');
  check('Die Fläche bekommt einen Mischer', flaechenkreis?.circuit.mixed ?? false, true);

  // --- Räume ohne Heizfläche ---------------------------------------------
  //
  // `emitterOfRoom(…) ?? 'floor'` hieß bis 1.23.0: ein Heizkörperprojekt im
  // frühen Aufmaß wird stillschweigend als Flächenheizung ausgelegt, Gerät
  // nach W35 gewählt, Nennweiten danach. Die Annahme bleibt — gerechnet wird
  // weiter mit 35/28 —, aber sie steht jetzt als Warnung am Ergebnis.
  const ohneDoc = baueHaus('nichts');
  const ohne = designPlant(ohneDoc);
  check('Ohne Heizfläche: weiter 35/28', ohne.systemtemperatur.vorlauf, 35);
  const warnung = ohne.notes.find((n) => n.severity === 'warn' && n.text.includes('keine Heizfläche'));
  check('Es gibt eine Warnung', warnung !== undefined, true);
  check('Sie nennt die Zahl der Räume', warnung?.text.startsWith('In 2 Räumen steht') ?? false, true);
  check('Sie nennt die getroffene Annahme', warnung?.text.includes('Fläche angenommen') ?? false, true);
  check('Sie nennt die Temperatur, die daraus folgt', warnung?.text.includes('35/28 °C') ?? false, true);
  // Steht eine Heizfläche im Raum, schweigt sie — eine Warnung, die immer
  // kommt, liest nach der dritten Auslegung niemand mehr.
  check(
    'Mit Heizkörper schweigt sie',
    hk.notes.some((n) => n.text.includes('keine Heizfläche')),
    false,
  );

  // --- Die Trassenauslegung kommt auf dieselbe Zahl ----------------------
  //
  // `planPipeNetwork` lief bis 1.23.0 mit fest verdrahteten 55/45 °C, wenn
  // der Aufrufer nichts übergab, und sonst mit dem Anlagenblatt. Beides war
  // an einem Heizkörperhaus eine andere Spreizung als die des Berichts über
  // dieselbe Leitung.
  check('Die Trasse rechnet mit 50 °C', systemtemperaturVon(hkDoc).vorlauf, 50);
  check('… und 10 K', systemtemperaturVon(hkDoc).spreizung, 10);
  check('Eine Vorgabe von 55/45 bleibt wirksam', systemtemperaturVon(hkDoc, { vorlauf: 55, ruecklauf: 45 }).vorlauf, 55);
  check('… mit ihrer eigenen Spreizung', systemtemperaturVon(hkDoc, { vorlauf: 55, ruecklauf: 45 }).spreizung, 10);
  /*
   * Eine **zu niedrige** Vorgabe wird angehoben und nicht übernommen.
   *
   * Genau so kommt der Befund heute in die Trassenauslegung: Der Store ruft
   * `legeRohrnetzAus` mit `plant.design.flowTemperature` auf — also mit
   * 35/28. Die Übergabe ist eine Untergrenze, kein Freibrief.
   */
  const wieDerStore = systemtemperaturVon(hkDoc, { vorlauf: 35, ruecklauf: 28 });
  check('Eine zu niedrige Vorgabe wird angehoben', wieDerStore.vorlauf, 50);
  check('… auf 10 K Spreizung', wieDerStore.spreizung, 10);
  check('Ohne Räume bleibt es beim Anlagenblatt', systemtemperaturVon(leeresModell()).vorlauf, 35);
}
