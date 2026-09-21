/**
 * Prüfblock „Anschlussgröße" — wirkt der Gerätestutzen auf die Leitung?
 *
 * **Der Befund, den dieser Block festhält.** Ein Heizungsfachplaner sagt:
 * „Bei der Wärmepumpe brauche ich eine Anschlussgröße; die meisten Anbieter
 * sagen hier mindestens 1 Zoll." Bis 1.23.0 kannte das Programm die Angabe
 * (`HeatPumpModel.hydraulicConnection`), druckte sie in Anlagenbuch,
 * Massenauszug und Schemasymbol — und **rechnete nicht damit**. Die Nennweite
 * der ersten Leitung ab dem Erzeuger entstand rein hydraulisch:
 *
 * ```
 * Gerät 8 kW, Anschluss G 1¼ AG          = DN 32
 * hydraulisch bei 10 K Spreizung          → DN 20   ← gerechnet
 * Trasse ab dem Erzeuger (Verbund 20 × 2) → DN 15   ← gezeichnet und bestellt
 * ```
 *
 * Das ist eine Leitung, halb so weit wie der Stutzen, an dem sie hängt. Am
 * Bau wird daraus ein Reduzierstück unmittelbar am Gerät; im Datenblatt sind
 * Gerätedruckverlust, Mindestvolumenstrom und Abtauverhalten aber auf das
 * Anschlussmaß bezogen, und die Gewährleistung hängt daran.
 *
 * **Die Zahlen stehen hier von Hand.** Die Zoll-Zuordnung ist eine Tabelle
 * und keine Formel — wer sie nachrechnet, liegt daneben (G 1¼ sind 31,75 mm
 * Außengewinde bei DN 32). Deshalb sind die Erwartungswerte unten
 * ausgeschrieben und nicht aus derselben Tabelle geholt, die sie prüfen
 * sollen.
 *
 * **Die vierte Prüfung ist die wichtigste.** Ohne jede Geräteangabe muss sich
 * gegenüber dem Stand vor der Änderung **nichts** ändern. Eine Regel, die
 * Anlagen anfasst, über die niemand etwas gesagt hat, wäre schlimmer als der
 * Befund, den sie heilt.
 */

import type { CheckFn } from './typ';
import type { BimDocument, BimNode, Fixture, HeatPump, Level, PipeRun, Wall } from '../../src/types/bim';
import { emptyPlant, emptySite } from '../../src/lib/plantDefaults';
import { detectRooms } from '../../src/lib/roomDetection';
import { designPlant } from '../../src/lib/plantDesign';
import { planPipeNetwork } from '../../src/lib/pipeLayout';
import { buildPipeReport } from '../../src/lib/pipeReport';
import { anschlussStufe, HEAT_PUMP_CATALOG } from '../../src/lib/deviceCatalog';
import { connectionDiameter } from '../../src/lib/safetyFittings';
import {
  anschlusstext,
  anschlussVonGeraet,
  nennweiteAusText,
  pruefeAnschluss,
} from '../../src/lib/anschlussgroesse';

// ---------------------------------------------------------------------------
// Das Prüfhaus
// ---------------------------------------------------------------------------

const BREITE = 10;
const TIEFE = 8;
const HOEHE = 2.75;

/**
 * Ein Haus mit zwei Räumen, einem Erzeuger im Westen und zwei Heizkörpern.
 *
 * Heizkörper und nicht Fläche, weil die Anlage damit auf 50/40 °C und 10 K
 * Spreizung kommt — genau die Auslegung, bei der die hydraulische Rechnung
 * **klein** ausfällt und der Befund sichtbar wird. Mit 7 K käme DN 25 heraus
 * und die Anhebung wäre nur noch eine Stufe.
 *
 * Der Erzeuger steht bei (0,6 | 0,6). Sein Aufstellpunkt ist zugleich der
 * Startpunkt der Trassierung — an ihm erkennt der Rohrausleger den ersten
 * Abschnitt.
 */
function baueHaus(): BimDocument {
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

  const fixtures: Record<string, Fixture> = {
    kessel: objekt('kessel', 'boiler', 0.6, 0.6, {}),
    hfW: objekt('hfW', 'radiator', 3, 0.4, { powerW: 1800 }),
    hfO: objekt('hfO', 'radiator', 8, 0.4, { powerW: 2400 }),
  };

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
      name: 'Prüfhaus Anschlussgröße',
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
  for (const f of Object.values(doc.fixtures)) {
    const raum = Object.values(doc.rooms).find((r) => (f.position.x < 6) === (r.centroid.x < 6));
    if (raum) f.roomId = raum.id;
  }
  return doc;
}

/**
 * Eine aufgestellte Wärmepumpe mit genau den Angaben, die der Fall braucht.
 *
 * Alles andere ist Beiwerk und steht nur da, weil `HeatPump` es verlangt. Die
 * beiden Felder, um die es geht, kommen über `felder` herein — so steht in
 * jeder Prüfung unten genau das, was sie prüft.
 */
function mitPumpe(doc: BimDocument, felder: Partial<HeatPump>): BimDocument {
  doc.site.pumps.wp = {
    id: 'wp',
    label: 'Wärmepumpe',
    source: 'air',
    form: 'monoblock-outdoor',
    position: { x: -2, y: 2 },
    azimuth: 180,
    width: 1.1,
    depth: 0.5,
    height: 1.05,
    standHeight: 0.3,
    mounting: 'free',
    soundPower: 54,
    nightModeGuaranteed: false,
    toneSurcharge: 0,
    refrigerant: 'R290',
    refrigerantMass: 1.4,
    protectionRadius: 1,
    heatingCapacity: 8,
    ratingPoint: 'A-7/W35',
    cop: 3.2,
    operation: 'mono-energetic',
    bivalencePoint: -7,
    backupCapacity: 6,
    flowTemperature: 50,
    gridRegime: 'none',
    blockedHours: 0,
    domesticHotWater: true,
    occupants: 4,
    ...felder,
  } as HeatPump;
  return doc;
}

/** Die Nennweiten der Vorlaufleitungen einer Trassenauslegung, größte zuerst. */
function trassenweiten(doc: BimDocument): number[] {
  const plan = planPipeNetwork(doc, { mode: 'neubau', levelId: 'eg' });
  return plan.runs
    .filter((r) => r.service === 'heating-flow')
    .map((r) => r.nominalDiameter)
    .sort((a, b) => b - a);
}

// ---------------------------------------------------------------------------
// Die Prüfungen
// ---------------------------------------------------------------------------

export function pruefeAnschlussgroesse(check: CheckFn): void {
  // --- 1. Zoll → Nennweite, von Hand ausgeschrieben ------------------------
  //
  // Die Zuordnung ist eine Tabelle des Gewinderohrs nach EN 10255. Sie folgt
  // **keiner** Formel: G 1 sind 25,4 mm Außengewinde bei DN 25 (das geht
  // zufällig auf), G 1¼ sind 31,75 mm bei DN 32, G 2 sind 50,8 mm bei DN 50.
  // Wer aus dem Zollmaß rechnet, trifft die Reihe nicht.
  check('G ½ ist DN 15', nennweiteAusText('G ½') ?? 0, 15);
  check('G ¾ ist DN 20', nennweiteAusText('G ¾ AG') ?? 0, 20);
  check('G 1 ist DN 25', nennweiteAusText('G 1 AG') ?? 0, 25);
  check('G 1¼ ist DN 32, nicht DN 31', nennweiteAusText('G 1¼ AG') ?? 0, 32);
  check('G 1½ ist DN 40', nennweiteAusText('G 1½ AG') ?? 0, 40);
  check('G 2 ist DN 50', nennweiteAusText('G 2 AG') ?? 0, 50);

  // Dieselbe Größe in den Schreibweisen, die in Datenblättern vorkommen.
  // Sie müssen alle auf dieselbe Zahl fallen — sonst hängt die Auslegung
  // daran, wie jemand tippt.
  check('„1 1/4 Zoll" ist dieselbe Größe', nennweiteAusText('1 1/4 Zoll') ?? 0, 32);
  check('„1¼"" ist dieselbe Größe', nennweiteAusText('1¼"') ?? 0, 32);
  check('„R 1 1/4" ist dieselbe Größe', nennweiteAusText('R 1 1/4') ?? 0, 32);
  check('„Rp 1" ist DN 25', nennweiteAusText('Rp 1') ?? 0, 25);
  check('Kleinschreibung ändert nichts', nennweiteAusText('g 1¼ ag') ?? 0, 32);
  check('„3/4 Zoll" ist DN 20', nennweiteAusText('3/4 Zoll') ?? 0, 20);

  // Die ausdrückliche Nennweite schlägt alles.
  check('„DN 32" ist DN 32', nennweiteAusText('DN 32') ?? 0, 32);
  check('„DN 32 (G 1¼)" wird als DN 32 gelesen', nennweiteAusText('DN 32 (G 1¼)') ?? 0, 32);

  // Lötanschluss — der Fall Viessmann Vitocal 250-A, 2,6 bis 18,5 kW.
  check('„Cu 28 × 1,0" ist DN 25', nennweiteAusText('Cu 28 × 1,0') ?? 0, 25);
  check('„Cu 28 x 1,5" ist ebenfalls DN 25', nennweiteAusText('Cu 28 x 1,5') ?? 0, 25);
  check('„Cu 35 × 1,5" ist DN 32', nennweiteAusText('Cu 35 × 1,5') ?? 0, 32);

  // --- 2. Was sich nicht deuten lässt, bleibt undeutbar --------------------
  //
  // Das ist keine Nachlässigkeit, sondern die Bedingung dafür, dass die
  // Anhebung überhaupt scharf geschaltet werden darf: Ein geratener Wert
  // zwingt die Leitung auf eine falsche Größe, und niemand sieht, woher sie
  // kommt.
  check('„Flansch" ergibt nichts', nennweiteAusText('Flansch') === undefined, true);
  check('„bauseits" ergibt nichts', nennweiteAusText('bauseits') === undefined, true);
  check('„nicht angegeben" ergibt nichts', nennweiteAusText('nicht angegeben') === undefined, true);
  check('Leerer Text ergibt nichts', nennweiteAusText('') === undefined, true);
  check('undefined ergibt nichts', nennweiteAusText(undefined) === undefined, true);
  // Die blanke Zahl ist der wichtigste Fall: „32" wäre als DN gelesen DN 32
  // und als Kupferaußenmaß gelesen DN 25 — dieselbe Ziffernfolge, zwei
  // Stufen Unterschied.
  check('Die blanke Zahl „32" wird nicht geraten', nennweiteAusText('32') === undefined, true);
  check('Die blanke Zahl „28" wird nicht geraten', nennweiteAusText('28') === undefined, true);
  check('„DN 33" gibt es nicht', nennweiteAusText('DN 33') === undefined, true);

  // --- 3. Und zurück -------------------------------------------------------
  check('DN 25 heißt G 1', anschlusstext(25) ?? '', 'G 1');
  check('DN 32 heißt G 1¼', anschlusstext(32) ?? '', 'G 1¼');
  check('DN 40 heißt G 1½', anschlusstext(40) ?? '', 'G 1½');
  check('DN 50 heißt G 2', anschlusstext(50) ?? '', 'G 2');
  check('DN 27 heißt gar nichts', anschlusstext(27) === undefined, true);
  // Hin und zurück muss dieselbe Zahl ergeben, sonst ist eine der beiden
  // Tabellen falsch abgeschrieben.
  for (const dn of [15, 20, 25, 32, 40, 50, 65, 80, 100]) {
    check(`Hin und zurück: DN ${dn}`, nennweiteAusText(anschlusstext(dn) ?? '') ?? 0, dn);
  }

  // --- 4. Die Regel selbst -------------------------------------------------
  const hoch = pruefeAnschluss(20, 32);
  check('DN 20 hydraulisch, DN 32 am Gerät → DN 32', hoch.dn, 32);
  check('… und es steht als Anhebung fest', hoch.angehoben, true);
  check('… die hydraulische Zahl bleibt erhalten', hoch.hydraulisch, 20);
  const gleich = pruefeAnschluss(32, 32);
  check('Gleich groß ist keine Anhebung', gleich.angehoben, false);
  const gross = pruefeAnschluss(40, 32);
  check('Ein kleinerer Stutzen verjüngt die Leitung nicht', gross.dn, 40);
  check('… und gilt nicht als Anhebung', gross.angehoben, false);
  const ohne = pruefeAnschluss(20, undefined);
  check('Ohne Geräteangabe bleibt es bei der Hydraulik', ohne.dn, 20);
  check('… ohne Anhebung', ohne.angehoben, false);
  check('… und die Begründung sagt, dass nichts angenommen wurde', ohne.begruendung.includes('keine angenommen'), true);

  // --- 5. Rangfolge: aufgestelltes Gerät vor Katalogmodell ------------------
  const ausGeraet = anschlussVonGeraet({ connectionDn: 40 }, { hydraulicConnection: 'G 1¼ AG' });
  check('Das aufgestellte Gerät schlägt den Katalog', ausGeraet.dn ?? 0, 40);
  check('… und sagt es', ausGeraet.herkunft, 'gerät');
  const ausKatalog = anschlussVonGeraet(undefined, { hydraulicConnection: 'G 1¼ AG' });
  check('Ohne Gerät antwortet der Katalog', ausKatalog.dn ?? 0, 32);
  check('… und sagt es', ausKatalog.herkunft, 'katalog');
  const nichts = anschlussVonGeraet(undefined, undefined);
  check('Ohne beides gibt es keine Nennweite', nichts.dn === undefined, true);
  check('… und die Herkunft heißt „fehlt"', nichts.herkunft, 'fehlt');
  // Eine unlesbare Angabe hält die Suche nicht auf, wird aber gemeldet.
  const unlesbar = anschlussVonGeraet({ hydraulicConnection: 'Flansch' }, { hydraulicConnection: 'G 1¼ AG' });
  check('Unlesbar am Gerät → Katalog antwortet', unlesbar.dn ?? 0, 32);
  check('… und der unlesbare Text bleibt sichtbar', unlesbar.unlesbar ?? '', 'Flansch');

  // --- 6. Der Katalog ------------------------------------------------------
  //
  // Belegt aus den Planungsunterlagen: Vaillant aroTHERM plus VWL 75/8.1 A
  // (~7 kW) hat G 1¼ AG, Daikin Altherma 4 H Hydrosplit über 6 bis 14 kW
  // DN 32. Die Typklasse darf bei 8 kW deshalb nicht mehr G 1 AG sagen.
  check('8 kW: G 1¼ AG, nicht mehr G 1 AG', anschlussStufe(8).text, 'G 1¼ AG');
  check('… als Nennweite DN 32', anschlussStufe(8).dn, 32);
  check('7 kW ebenfalls G 1¼ AG (Vaillant VWL 75/8.1 A)', anschlussStufe(7).text, 'G 1¼ AG');
  check('14 kW ebenfalls (Daikin Altherma 4 H Hydrosplit)', anschlussStufe(14).dn, 32);
  check('4 kW bleibt G 1 AG', anschlussStufe(4).text, 'G 1 AG');
  check('… als Nennweite DN 25 (Viessmann Cu 28 × 1,0)', anschlussStufe(4).dn, 25);
  check('20 kW: G 1½ AG', anschlussStufe(20).text, 'G 1½ AG');
  check('30 kW: G 2 AG', anschlussStufe(30).text, 'G 2 AG');
  // Text und Nennweite dürfen nicht auseinanderlaufen — sie kommen aus
  // derselben Zeile, und genau das wird hier über den ganzen Katalog geprüft.
  const abweichler = HEAT_PUMP_CATALOG.filter(
    (m) => nennweiteAusText(m.hydraulicConnection) !== anschlussStufe(m.nominalCapacity).dn,
  );
  check('Kein Katalogmodell, dessen Text zur Nennweite nicht passt', abweichler.length, 0);
  check('Jedes Katalogmodell trägt eine deutbare Anschlussgröße',
    HEAT_PUMP_CATALOG.every((m) => nennweiteAusText(m.hydraulicConnection) !== undefined), true);

  // --- 7. DER BEFUND: am ganzen Haus ---------------------------------------
  //
  // Das Prüfhaus trägt nur 2,4 kW Heizlast; dort fällt die Anschlussnennweite
  // ohnehin auf DN 15 und der Befund wäre unsichtbar. Deshalb dasselbe Haus
  // mit 8 kW vorgegebener Gebäudeheizlast — das Gerät leistet dann 9,6 kW im
  // Auslegungspunkt:
  //
  //   V̇ = 9,6/(1,163·10) = 0,825 m³/h → d = 19,1 mm → DN 20 hydraulisch
  //   Gerät G 1¼ AG                                 → DN 32 vorgeschrieben
  const haus = mitPumpe(baueHaus(), { hydraulicConnection: 'G 1¼ AG', connectionDn: 32 });
  const aus = designPlant(haus, { heatLoad: 8 });
  check('Das Gerät leistet 9,6 kW im Auslegungspunkt', aus.selected?.capacityAtDesign ?? 0, 9.6);
  check('Gerechnet wird mit 10 K Spreizung', aus.systemtemperatur.spreizung, 10);
  check('Hydraulisch allein wären es DN 20', connectionDiameter(9.6, { spread: 10, velocity: 0.8 }), 20);
  // **Die Prüfung, um die es geht.** Bis 1.23.0 stand hier 20.
  check('Die Erzeugeranbindung wird DN 32', aus.anschlussDn, 32);
  check('… und das Ergebnis weiß, dass angehoben wurde', aus.anschluss?.angehoben ?? false, true);
  check('… nennt die hydraulische Zahl daneben', aus.anschluss?.hydraulisch ?? 0, 20);
  check('… und den Geräteanschluss', aus.anschluss?.geraet ?? 0, 32);

  // Die Warnung — ohne sie steht im Nachweis eine Nennweite, die sich mit den
  // Zahlen daneben nicht nachrechnen lässt, und der Leser hält sie für einen
  // Fehler.
  const warnung = aus.notes.find((n) => n.text.includes('angehoben'));
  check('Es gibt eine Meldung dazu', warnung !== undefined, true);
  check('… als Warnung, nicht als Nebenbemerkung', warnung?.severity ?? '', 'warn');
  check('… sie nennt die hydraulisch nötige Nennweite', warnung?.text.includes('DN 20') ?? false, true);
  check('… sie nennt die geforderte Nennweite', warnung?.text.includes('DN 32') ?? false, true);
  check('… sie nennt den Mindestvolumenstrom als Grund', warnung?.text.includes('Mindestvolumenstrom') ?? false, true);
  check('… sie nennt das Abtauverhalten', warnung?.text.includes('Abtauverhalten') ?? false, true);
  check('… sie nennt die Gewährleistung', warnung?.text.includes('Gewährleistung') ?? false, true);

  // Der Rohrnetzbericht liest dieselbe Zahl ab — und trägt die Begründung mit.
  const bericht = buildPipeReport(haus);
  check('Der Rohrnetzbericht trägt die Begründung', bericht.hinweise.some((n) => n.text.includes('angehoben')), true);

  // Die Trasse ab dem Erzeuger. Ohne die Regel kam Verbundrohr 20 × 2 = DN 15
  // heraus; DN 32 ist im Verbundrohr das Maß 40 × 3,5.
  const weiten = trassenweiten(haus);
  check('Die Trasse ab dem Erzeuger wird DN 32', weiten[0], 32);
  check('… und nur sie — die Anbindeleitungen bleiben klein', weiten[1] <= 15, true);
  const plan = planPipeNetwork(haus, { mode: 'neubau', levelId: 'eg' });
  const trassenwarnung = plan.notes.find((n) => n.text.includes('erste Abschnitt ab dem Erzeuger'));
  check('Auch die Trassenauslegung begründet die Anhebung', trassenwarnung !== undefined, true);
  check('… als Warnung', trassenwarnung?.severity ?? '', 'warn');

  // Derselbe Fall über den Klartext allein — ohne eingetragene Nennweite.
  // Das ist der Weg, auf dem die Angabe im Alltag ins Modell kommt.
  const nurText = mitPumpe(baueHaus(), { hydraulicConnection: 'G 1¼ AG' });
  check('Klartext allein genügt: DN 32', designPlant(nurText, { heatLoad: 8 }).anschlussDn, 32);
  check('… auch für die Trasse', trassenweiten(nurText)[0], 32);
  // Und über den Lötanschluss — Viessmann Vitocal 250-A.
  const cu = mitPumpe(baueHaus(), { hydraulicConnection: 'Cu 28 × 1,0' });
  check('„Cu 28 × 1,0" hebt auf DN 25 an', designPlant(cu, { heatLoad: 8 }).anschlussDn, 25);

  // --- 8. DIE NICHTREGRESSION: ohne Geräteangabe ändert sich nichts --------
  //
  // Kein aufgestelltes Gerät, kein gewähltes Katalogmodell. Die Anlagen-
  // auslegung wählt zwar selbst ein Modell aus und nimmt dessen Anschluss —
  // das ist gewollt und in Abschnitt 7 geprüft. Die **Trassenauslegung**
  // dagegen läuft bei jedem Zeichenschritt und fasst nur an, was ausdrücklich
  // gesagt wurde: Ohne Eintrag bleibt jede Nennweite so, wie sie vor der
  // Änderung war.
  const blank = baueHaus();
  check('Ohne Gerät: keine Wärmepumpe im Modell', Object.keys(blank.site.pumps).length, 0);
  check('Ohne Gerät: kein gewähltes Katalogmodell', blank.plant?.generatorModelId === undefined, true);
  const blankWeiten = trassenweiten(blank);
  check('Ohne Gerät bleibt die Trasse bei DN 15', blankWeiten[0], 15);
  check('… und es gibt keine Anhebungsmeldung',
    planPipeNetwork(blank, { mode: 'neubau', levelId: 'eg' }).notes.some((n) => n.text.includes('angehoben')), false);

  // Ein Gerät mit ausdrücklich ausgeschalteter Untergrenze rechnet ebenfalls
  // wie früher — das ist der Rückweg für den Fall, dass jemand die Regel für
  // ein Sondergerät nicht will.
  const ausgeschaltet = planPipeNetwork(haus, { mode: 'neubau', levelId: 'eg', anschlussDn: 0 });
  check('`anschlussDn: 0` schaltet die Anhebung ab',
    Math.max(...ausgeschaltet.runs.filter((r) => r.service === 'heating-flow').map((r) => r.nominalDiameter)), 15);

  // Und ein Erzeuger, der gar keiner ist: Beginnt die Trasse mangels
  // Wärmeerzeuger am Verteiler, hat das Anschlussmaß einer Wärmepumpe dort
  // nichts zu suchen.
  //
  // Seit 1.39.0 ist eine **Monoblock**-Außeneinheit selbst der Erzeuger, und
  // die Trasse beginnt an der Hauseinführung — der Stamm von dort zum
  // Verteiler wird dann zu Recht angehoben (geprüft in `wpErzeuger.ts`).
  // Der Fall „kein Erzeuger" ist deshalb hier mit einer **Split**-Wärmepumpe
  // nachgestellt: Deren Leitung nach draußen führt Kältemittel, das
  // Heizungsnetz beginnt an der Inneneinheit, und die fehlt.
  const ohneKessel = mitPumpe(baueHaus(), { connectionDn: 32, form: 'split' });
  delete ohneKessel.fixtures.kessel;
  ohneKessel.fixtures.vt = {
    ...ohneKessel.fixtures.hfW,
    id: 'vt',
    type: 'manifold',
    position: { x: 0.6, y: 0.6 },
    params: {},
  } as Fixture;
  const amVerteiler = planPipeNetwork(ohneKessel, { mode: 'neubau', levelId: 'eg' });
  check('Am Verteiler wird nicht angehoben',
    amVerteiler.notes.some((n) => n.text.includes('erste Abschnitt ab dem Erzeuger')), false);
}
