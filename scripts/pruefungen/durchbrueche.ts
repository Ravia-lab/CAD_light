/**
 * Prüfblock „Durchbrüche" — Kernbohrung, Wanddurchbruch, Schlitz, Deckenloch.
 *
 * **Warum dieser Block gebraucht wird.** Ein Durchbruch ist das Bauteil mit
 * dem größten Verhältnis von Folgeschaden zu Größe. Er ist zehn Zentimeter
 * groß, kostet im Rohbau fünf Minuten — und wenn er auf dem Plan fehlt oder
 * falsch steht, wird er nachträglich gebohrt: durch einen Ringanker, durch
 * eine fertige Fliesenwand, oder gar nicht, worauf die Leitung einen Meter
 * Umweg nimmt. Deshalb prüft dieser Block nicht nur, ob Zahlen stimmen,
 * sondern ob die *Lage* stimmt: der Durchbruch sitzt parametrisch in seiner
 * Wand, und die Wand bewegt sich.
 *
 * **Die vier Aussagen, die hier festgenagelt werden.**
 *
 * 1. *Er wandert mit.* Wird die Wand verschoben oder gedreht, bleibt der
 *    Durchbruch an seiner Stelle in der Wand und nicht an seiner Stelle in
 *    der Welt. Das ist der ganze Grund, warum die Lage als Abstand auf der
 *    Achse und nicht als Punkt gespeichert wird.
 * 2. *Er mindert keine Wandfläche.* Eine Kernbohrung Ø 152 ist wärmetechnisch
 *    belanglos. Erschiene sie in der Hüllflächenbilanz, zöge sie 0,018 m² von
 *    einer Wand ab und verlangte einen U-Wert, den niemand angeben kann. Der
 *    Block prüft, dass die Raum- und Wandkennzahlen *identisch* bleiben, ob
 *    ein Durchbruch im Modell steht oder nicht.
 * 3. *Er überlebt Speichern und Öffnen.* Der stille Datenverlust ist bei
 *    diesem Bauteil besonders teuer, weil niemand ein fehlendes Loch vermisst.
 * 4. *Er kopiert sich richtig.* Ein Wanddurchbruch gehört zur Wand und muss
 *    beim Übernehmen eines Geschosses auf die **neue** Wand umgehängt werden.
 *    Ein Deckendurchbruch gehört zur Decke und bleibt, wo er ist — die Platte
 *    über dem EG ist dieselbe geblieben.
 *
 * **Was hier steht und was woanders steht.** Wie jeder Prüfblock kennt dieser
 * weder Store noch Oberfläche: `src/lib` und `src/types` gehen als
 * eigenständiges Paket an die Gegenstelle, und ein Import aus `src/store`
 * zerrisse es. Der vollständige Rundlauf über die Oberfläche steht im
 * Rauchtest.
 *
 * Alle Sollwerte sind aus der Geometrie hergeleitet und im Kommentar
 * ausgerechnet; keiner stammt aus einem Probelauf.
 */

import type { CheckFn } from './typ';
import type {
  BimDocument,
  BimNode,
  Durchbruch,
  Level,
  Wall,
} from '../../src/types/bim';
import { DURCHBRUCH_PRESETS, durchbruchWirt } from '../../src/types/bim';
import { emptyPlant, emptySite } from '../../src/lib/plantDefaults';
import { detectRooms } from '../../src/lib/roomDetection';
import { buildRaviaExport } from '../../src/lib/raviaExport';
import { copyLevelContents } from '../../src/lib/levelCopy';
import { levelSlabs, slabArea } from '../../src/lib/slabGeometry';
import { levelBaseHeights } from '../../src/lib/levelGeometry';
import { validateModel } from '../../src/lib/validation';
import { buildMaterialSchedule } from '../../src/lib/materialSchedule';
import { buildIfc } from '../../src/lib/ifcExport';
import { distance, polygonArea } from '../../src/lib/geometry';
import {
  deckendurchbruchUmriss,
  durchbruchAussparungen,
  durchbruchBeschriftung,
  durchbruchFlaeche,
  durchbruchMitte,
  durchbruchPasst,
  durchbruchUmriss,
  durchbruecheAufGeschoss,
  trifftDurchbruch,
} from '../../src/lib/durchbruchSymbols';

// ---------------------------------------------------------------------------
// Das Prüfhaus — zwei Geschosse über demselben Rechteck
// ---------------------------------------------------------------------------

/** Achsmaße [m]: Rechteck 6,00 × 4,00, Wandstärke 0,24, lichte Höhe 2,75. */
const BREITE = 6;
const TIEFE = 4;
const DICKE = 0.24;
const HOEHE = 2.75;

/** Lichte Grundfläche [m²] = (6,00 − 0,24) × (4,00 − 0,24) = 5,76 × 3,76. */
const GRUNDFLAECHE = (BREITE - DICKE) * (TIEFE - DICKE);

/**
 * Die Kernbohrung des Prüfhauses.
 *
 * Ø 0,152 m, Achshöhe 0,30 m über FFB, auf der Südwand bei u = 2,00 m. Die
 * Südwand läuft von (0|0) nach (6|0); der Durchbruch sitzt damit bei (2|0).
 */
const KB_D = 0.152;
const KB_U = 2;
const KB_H = 0.3;
/** Lichter Querschnitt [m²] = π · 0,076² = 0,018145836… */
const KB_A = Math.PI * (KB_D / 2) ** 2;

/** Der Deckendurchbruch: 0,30 × 0,40 m in der Raummitte des EG. */
const DD_B = 0.3;
const DD_H = 0.4;
const DD_POS = { x: 3, y: 2 };

function geschoss(id: string, name: string, order: number, elevation: number): Level {
  return {
    id,
    name,
    order,
    elevation,
    height: HOEHE,
    floorUValue: 0.35,
    floorBoundary: order === 0 ? 'ground' : 'adjacent-room',
    ceilingUValue: 0.2,
    ceilingBoundary: 'unheated',
  };
}

/** Das Prüfhaus. `zweiGeschosse` schaltet das OG zu — sonst gibt es keine Decke. */
function baueHaus(zweiGeschosse = false): BimDocument {
  const nodes: Record<string, BimNode> = {};
  const walls: Record<string, Wall> = {};

  const p = (name: string, x: number, y: number, levelId: string): string => {
    nodes[name] = { id: name, x, y, levelId };
    return name;
  };
  const wand = (name: string, a: string, b: string, levelId: string): void => {
    walls[name] = {
      id: name,
      a,
      b,
      levelId,
      type: 'exterior',
      thickness: DICKE,
      uValue: 0.28,
      height: HOEHE,
      layerId: 'layer-walls',
    };
  };

  const levels: Record<string, Level> = { eg: geschoss('eg', 'EG', 0, 0) };
  const ebenen = zweiGeschosse ? ['eg', 'og'] : ['eg'];
  if (zweiGeschosse) levels.og = geschoss('og', 'OG', 1, HOEHE + 0.2);

  for (const e of ebenen) {
    const sw = p(`${e}-sw`, 0, 0, e);
    const se = p(`${e}-se`, BREITE, 0, e);
    const ne = p(`${e}-ne`, BREITE, TIEFE, e);
    const nw = p(`${e}-nw`, 0, TIEFE, e);
    wand(`${e}-w-s`, sw, se, e);
    wand(`${e}-w-e`, se, ne, e);
    wand(`${e}-w-n`, ne, nw, e);
    wand(`${e}-w-w`, nw, sw, e);
  }

  const doc: BimDocument = {
    site: emptySite(),
    plant: emptyPlant(),
    meta: {
      name: 'Prüfhaus Durchbrüche',
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
    levels,
    layers: {},
    nodes,
    walls,
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

  doc.rooms = {};
  for (const e of ebenen) {
    const raeume = detectRooms({
      nodes: doc.nodes,
      walls: Object.values(doc.walls),
      openings: [],
      levelId: e,
      defaultHeight: HOEHE,
      northAngle: 0,
    });
    for (const r of raeume) {
      r.name = e === 'eg' ? 'Wohnen' : 'Schlafen';
      r.setpointTemperature = 20;
      r.isHeated = true;
      doc.rooms[r.id] = r;
    }
  }
  return doc;
}

/** Die Kernbohrung des Prüfhauses in der Südwand eines Geschosses. */
function kernbohrung(id: string, levelId = 'eg'): Durchbruch {
  return {
    id,
    kind: 'kernbohrung',
    name: 'Kernbohrung Ø 152 (DN 100)',
    levelId,
    wallId: `${levelId}-w-s`,
    distance: KB_U,
    form: 'rund',
    diameter: KB_D,
    sillHeight: KB_H,
    service: 'sanitary',
    dn: 100,
    brandschutz: 'keine',
  };
}

/** Der Deckendurchbruch des Prüfhauses. */
function deckendurchbruch(id: string, levelId = 'eg'): Durchbruch {
  return {
    id,
    kind: 'deckendurchbruch',
    name: 'Deckendurchbruch 30 × 40',
    levelId,
    position: { ...DD_POS },
    rotation: 0,
    form: 'rechteckig',
    width: DD_B,
    height: DD_H,
    service: 'mixed',
    brandschutz: 'R90',
  };
}

const r3 = (v: number): number => Math.round(v * 1000) / 1000;

// ---------------------------------------------------------------------------

export function pruefeDurchbrueche(check: CheckFn): void {
  // =========================================================================
  // 1 · Der Katalog
  // =========================================================================
  check('Der Regelmaßkatalog ist nicht leer', DURCHBRUCH_PRESETS.length > 0, true);
  check(
    'Jedes Regelmaß hat eine eindeutige Kennung',
    new Set(DURCHBRUCH_PRESETS.map((v) => v.id)).size,
    DURCHBRUCH_PRESETS.length,
  );
  check(
    'Jedes runde Regelmaß hat einen Durchmesser',
    DURCHBRUCH_PRESETS.filter((v) => v.form === 'rund').every((v) => (v.diameter ?? 0) > 0),
    true,
  );
  check(
    'Jedes rechteckige Regelmaß hat beide Maße',
    DURCHBRUCH_PRESETS.filter((v) => v.form === 'rechteckig').every(
      (v) => (v.width ?? 0) > 0 && (v.height ?? 0) > 0,
    ),
    true,
  );
  check(
    'Kein Regelmaß ist größer als eine halbe Wandlänge dieses Hauses',
    DURCHBRUCH_PRESETS.every((v) => Math.max(v.diameter ?? 0, v.width ?? 0) < BREITE / 2),
    true,
  );
  check(
    'Der Wirt folgt aus der Art: Kernbohrung ist Wand',
    durchbruchWirt('kernbohrung'),
    'wand',
  );
  check(
    'Der Wirt folgt aus der Art: Deckendurchbruch ist Decke',
    durchbruchWirt('deckendurchbruch'),
    'decke',
  );

  // =========================================================================
  // 2 · Lage und Geometrie
  // =========================================================================
  const haus = baueHaus();
  const kb = kernbohrung('db-1');
  haus.durchbrueche = { 'db-1': kb };

  const mitte = durchbruchMitte(kb, haus);
  // Die Südwand läuft von (0|0) nach (6|0). Bei u = 2,00 liegt die Mitte
  // auf (2|0) — auf der Achse, nicht auf der Innenkante.
  check('Die Mitte liegt auf der Wandachse (x)', r3(mitte?.x ?? -1), 2);
  check('Die Mitte liegt auf der Wandachse (y)', r3(mitte?.y ?? -1), 0);

  const umriss = durchbruchUmriss(kb, haus);
  check('Der Wandumriss ist ein Rechteck', umriss.length, 4);
  // Das Rechteck ist so breit wie die Bohrung (0,152) und so tief wie die
  // Wand (0,24). Fläche = 0,152 × 0,24 = 0,03648 m².
  check('Der Wandumriss geht über die volle Wanddicke', r3(Math.abs(polygonArea(umriss))), r3(KB_D * DICKE));
  check('Der lichte Querschnitt ist die Kreisfläche', r3(durchbruchFlaeche(kb)), r3(KB_A));

  check('Die Mitte des Umrisses trifft', trifftDurchbruch(kb, haus, { x: 2, y: 0 }), true);
  check(
    'Knapp daneben trifft nicht',
    trifftDurchbruch(kb, haus, { x: 2 + KB_D, y: 0 }),
    false,
  );

  // --- Er wandert mit der Wand ---------------------------------------------
  //
  // Die Südwand wird um 1,00 m nach Osten verschoben: beide Endknoten
  // wandern. Der Durchbruch behält seinen Abstand auf der Achse und muss
  // deshalb bei (3|0) liegen — 1,00 m weiter, ohne dass jemand ihn angefasst
  // hat.
  const verschoben = baueHaus();
  verschoben.durchbrueche = { 'db-1': kernbohrung('db-1') };
  verschoben.nodes['eg-sw'] = { ...verschoben.nodes['eg-sw'], x: 1 };
  verschoben.nodes['eg-se'] = { ...verschoben.nodes['eg-se'], x: BREITE + 1 };
  const neu = durchbruchMitte(verschoben.durchbrueche['db-1'], verschoben);
  check('Nach dem Verschieben der Wand wandert der Durchbruch mit (x)', r3(neu?.x ?? -1), 3);
  check('Nach dem Verschieben der Wand wandert der Durchbruch mit (y)', r3(neu?.y ?? -1), 0);

  // Und dasselbe beim Drehen: die Südwand wird um 90° aufgestellt, indem der
  // Ostknoten nach Norden wandert. Die Wand läuft nun von (0|0) nach (0|6),
  // der Durchbruch bei u = 2,00 also auf (0|2).
  const gedreht = baueHaus();
  gedreht.durchbrueche = { 'db-1': kernbohrung('db-1') };
  gedreht.nodes['eg-se'] = { ...gedreht.nodes['eg-se'], x: 0, y: BREITE };
  const gedrehtMitte = durchbruchMitte(gedreht.durchbrueche['db-1'], gedreht);
  check('Nach dem Drehen der Wand steht er auf der neuen Achse (x)', r3(gedrehtMitte?.x ?? -1), 0);
  check('Nach dem Drehen der Wand steht er auf der neuen Achse (y)', r3(gedrehtMitte?.y ?? -1), 2);

  // --- Verwaist ------------------------------------------------------------
  const verwaist = baueHaus();
  verwaist.durchbrueche = { 'db-1': kernbohrung('db-1') };
  delete verwaist.walls['eg-w-s'];
  check(
    'Ohne Wand gibt es keine Mitte',
    durchbruchMitte(verwaist.durchbrueche['db-1'], verwaist) === null,
    true,
  );
  check('Ohne Wand gibt es keinen Umriss', durchbruchUmriss(verwaist.durchbrueche['db-1'], verwaist).length, 0);

  // =========================================================================
  // 3 · Passt er in seine Wand?
  // =========================================================================
  check('Die Prüfbohrung passt', durchbruchPasst(kb, haus, HOEHE).passt, true);
  check(
    'Ein Durchbruch breiter als die Wand passt nicht',
    durchbruchPasst({ ...kb, form: 'rechteckig', width: BREITE + 1, height: 0.3, diameter: undefined }, haus, HOEHE).passt,
    false,
  );
  check(
    'Ein Durchbruch über dem Wandende passt nicht',
    durchbruchPasst({ ...kb, distance: BREITE - 0.01 }, haus, HOEHE).passt,
    false,
  );
  // Achshöhe 2,70 + halbe Bohrung 0,076 = 2,776 > 2,75 lichte Höhe.
  check(
    'Ein Durchbruch über der Geschosshöhe passt nicht',
    durchbruchPasst({ ...kb, sillHeight: 2.7 }, haus, HOEHE).passt,
    false,
  );
  // Achshöhe 2,60 + 0,076 = 2,676 < 2,75 — knapp, aber richtig.
  check(
    'Knapp darunter passt er noch',
    durchbruchPasst({ ...kb, sillHeight: 2.6 }, haus, HOEHE).passt,
    true,
  );
  check('Ein Deckendurchbruch hat keine Wandgrenze', durchbruchPasst(deckendurchbruch('db-d'), haus, HOEHE).passt, true);

  // =========================================================================
  // 4 · Die Beschriftung
  // =========================================================================
  check(
    'Die Beschriftung nennt Maß und Höhe',
    durchbruchBeschriftung(kb),
    'Ø152 · 0,30 m',
  );
  check(
    'Mit Brandschutz steht die Klasse dahinter',
    durchbruchBeschriftung({ ...kb, brandschutz: 'R90' }),
    'Ø152 · 0,30 m · R 90',
  );
  check(
    'Rechteckig steht das Kreuzmaß',
    durchbruchBeschriftung(deckendurchbruch('db-d')),
    '300×400 · R 90',
  );

  // =========================================================================
  // 5 · Er mindert keine Wandfläche
  // =========================================================================
  //
  // Die Gegenprobe, die dieses Bauteil von einer Öffnung unterscheidet: das
  // Modell wird zweimal exportiert, einmal mit und einmal ohne Durchbruch.
  // Jede Raumkennzahl muss gleich bleiben. Bliebe sie es nicht, hätte sich
  // irgendwo eine Fläche abgezogen — und niemand sähe, wo.
  const ohne = baueHaus();
  const mit = baueHaus();
  mit.durchbrueche = { 'db-1': kernbohrung('db-1') };

  const expOhne = buildRaviaExport(ohne);
  const expMit = buildRaviaExport(mit);
  const raumOhne = expOhne.rooms[0];
  const raumMit = expMit.rooms[0];
  check('Die Raumfläche bleibt gleich', r3(raumMit.area), r3(raumOhne.area));
  check('Das Luftvolumen bleibt gleich', r3(raumMit.volume), r3(raumOhne.volume));
  check(
    'Die Hüllflächen bleiben gleich',
    r3(raumMit.surfaces.reduce((sum, e) => sum + e.grossArea, 0)),
    r3(raumOhne.surfaces.reduce((sum, e) => sum + e.grossArea, 0)),
  );
  check(
    'Die Zahl der Hüllflächen bleibt gleich',
    raumMit.surfaces.length,
    raumOhne.surfaces.length,
  );
  check('Die Außenwandfläche bleibt gleich', r3(raumMit.exteriorWallArea), r3(raumOhne.exteriorWallArea));
  check('Die Prüfbohrung erscheint in keiner Fensterfläche', r3(raumMit.totalWindowArea), 0);
  // Der Export rundet Flächen auf 1/100 m²; die Handrechnung ergibt 21,6576.
  check('Die Grundfläche stimmt mit der Handrechnung', raumMit.area, GRUNDFLAECHE, 0.005);

  // =========================================================================
  // 6 · Der Export
  // =========================================================================
  check('Der Export führt den Durchbruch', expMit.durchbrueche.length, 1);
  const eDb = expMit.durchbrueche[0];
  check('Der Export nennt den Wirt', eDb.wirt, 'wand');
  check('Der Export nennt die Wand', eDb.wallId ?? '—', 'eg-w-s');
  check('Der Export nennt den Weltpunkt (x)', r3(eDb.position.x), 2);
  // π · 0,076² = 0,0181458… → auf den Quadratzentimeter 0,0181.
  check('Der Export nennt den lichten Querschnitt', eDb.openArea, KB_A, 5e-5);
  check('Der Export nennt die Höhe über FFB', r3(eDb.sillHeight ?? -1), KB_H);
  check('Der Export nennt das Geschoss im Klartext', eDb.level, 'EG');
  check('Ohne Angabe ist die Brandschutzklasse „keine"', eDb.brandschutz, 'keine');
  check(
    'Die Konvention erklärt, dass keine Wandfläche gemindert wird',
    expMit.conventions.durchbrueche.includes('mindert **keine** Wandfläche'),
    true,
  );
  check('Die Rohgeometrie führt den Durchbruch mit', expMit.geometry.durchbrueche.length, 1);
  check(
    'Die Rohgeometrie ist das Original und keine Ableitung',
    expMit.geometry.durchbrueche[0].distance ?? -1,
    KB_U,
  );
  check('Ohne Durchbruch bleibt die Liste leer', expOhne.durchbrueche.length, 0);

  // Der verwaiste Durchbruch verschwindet nicht aus dem Export.
  const expVerwaist = buildRaviaExport(verwaist);
  check('Ein verwaister Durchbruch bleibt im Export', expVerwaist.durchbrueche.length, 1);

  // =========================================================================
  // 7 · Die Prüfung
  // =========================================================================
  const berichtGut = validateModel(mit);
  check(
    'Ein sauberer Durchbruch erzeugt keinen Befund',
    berichtGut.issues.filter((i) => i.code.startsWith('durchbruch.')).length,
    0,
  );

  const berichtVerwaist = validateModel(verwaist);
  check(
    'Der verwaiste Durchbruch wird gemeldet',
    berichtVerwaist.issues.some((i) => i.code === 'durchbruch.orphan'),
    true,
  );
  check(
    'Der Befund zeigt auf den Durchbruch',
    berichtVerwaist.issues.find((i) => i.code === 'durchbruch.orphan')?.target?.kind ?? '—',
    'durchbruch',
  );

  const zuGross = baueHaus();
  zuGross.durchbrueche = {
    'db-1': { ...kernbohrung('db-1'), form: 'rechteckig', diameter: undefined, width: 8, height: 0.3 },
  };
  check(
    'Ein zu breiter Durchbruch wird gemeldet',
    validateModel(zuGross).issues.some((i) => i.code === 'durchbruch.does-not-fit'),
    true,
  );

  // Zwei Bohrungen, deren Felder sich waagerecht und senkrecht überlagern.
  const doppelt = baueHaus();
  doppelt.durchbrueche = {
    'db-1': kernbohrung('db-1'),
    'db-2': { ...kernbohrung('db-2'), distance: KB_U + 0.05 },
  };
  check(
    'Zwei überschneidende Bohrungen werden gemeldet',
    validateModel(doppelt).issues.some((i) => i.code === 'durchbruch.overlap'),
    true,
  );

  // Vorlauf oben, Rücklauf unten: gleiche Achse, verschiedene Höhe. Das ist
  // der Regelfall und darf keinen Befund geben. 0,30 und 0,50 liegen 0,20
  // auseinander, die Bohrungen sind 0,152 groß — der Steg misst 0,048 m.
  const uebereinander = baueHaus();
  uebereinander.durchbrueche = {
    'db-1': kernbohrung('db-1'),
    'db-2': { ...kernbohrung('db-2'), sillHeight: 0.5 },
  };
  check(
    'Zwei Bohrungen übereinander sind kein Befund',
    validateModel(uebereinander).issues.some((i) => i.code === 'durchbruch.overlap'),
    false,
  );

  // =========================================================================
  // 8 · Der Massenauszug
  // =========================================================================
  const zwei = baueHaus();
  zwei.durchbrueche = {
    'db-1': kernbohrung('db-1'),
    'db-2': { ...kernbohrung('db-2'), distance: 4 },
    'db-3': { ...kernbohrung('db-3'), distance: 1, brandschutz: 'R90' },
  };
  const auszug = buildMaterialSchedule(zwei);
  const gewerk = auszug.groups.find((g) => g.trade === 'durchbruch');
  check('Der Massenauszug führt ein Gewerk „Durchbrüche"', gewerk !== undefined, true);
  const bohrungen = gewerk?.items.filter((i) => i.name === 'Kernbohrung') ?? [];
  // Drei Bohrungen, aber **zwei** Positionen: zwei ohne Brandschutz, eine mit
  // R 90. Das ist gewollt — wer R 90 fordert, bestellt ein anderes Los.
  check('Gleiche Bohrungen werden zusammengefasst', bohrungen.length, 2);
  check(
    '… die beiden gleichen mit der Menge 2',
    bohrungen.find((i) => !i.spec.includes('R 90'))?.quantity ?? -1,
    2,
  );
  check(
    '… die dritte mit Brandschutz einzeln',
    bohrungen.find((i) => i.spec.includes('R 90'))?.quantity ?? -1,
    1,
  );
  check('… in Stück', bohrungen[0]?.unit ?? '—', 'Stk');
  const schott = gewerk?.items.find((i) => i.name === 'Brandschott');
  check('Das Schott steht als eigene Position', schott !== undefined, true);
  check('… und nur für den einen Durchbruch mit Anforderung', schott?.quantity ?? -1, 1);
  // Gebohrt wird, bevor verlegt oder verputzt wird — deshalb steht dieses
  // Gewerk an erster Stelle und nicht bei den Bauteilen am Ende.
  check('Das Gewerk steht an erster Stelle', auszug.groups[0]?.trade ?? '—', 'durchbruch');

  // =========================================================================
  // 9 · Der Deckendurchbruch schneidet die Platte
  // =========================================================================
  const zweiGeschossig = baueHaus(true);
  const basis = levelBaseHeights(Object.values(zweiGeschossig.levels));
  const eingabe = {
    levels: Object.values(zweiGeschossig.levels),
    rooms: Object.values(zweiGeschossig.rooms),
    walls: Object.values(zweiGeschossig.walls),
    nodes: zweiGeschossig.nodes,
    verticals: [],
    base: basis,
  };
  const ohneLoch = levelSlabs(eingabe);
  const dd = deckendurchbruch('db-d');
  const mitLoch = levelSlabs({ ...eingabe, durchbrueche: [dd] });
  check('Es gibt genau eine Geschossdecke', ohneLoch.length, 1);
  check('Mit Durchbruch ebenso viele Platten', mitLoch.length, 1);
  check('Ohne Durchbruch hat die Platte kein Loch', ohneLoch[0].holes.length, 0);
  check('Mit Durchbruch hat sie eines', mitLoch[0].holes.length, 1);
  // 0,30 × 0,40 = 0,12 m² weniger Plattenfläche.
  check(
    'Die Plattenfläche schrumpft um das Lochmaß',
    r3(slabArea(ohneLoch[0]) - slabArea(mitLoch[0])),
    r3(DD_B * DD_H),
  );

  // Ein Wanddurchbruch schneidet die Platte **nicht** — das ist der Test,
  // der die beiden Arten auseinanderhält.
  const mitWandloch = levelSlabs({ ...eingabe, durchbrueche: [kernbohrung('db-1')] });
  check('Ein Wanddurchbruch lässt die Decke unberührt', mitWandloch[0].holes.length, 0);

  // Und ein Deckendurchbruch im OG schneidet die Decke über dem OG — die es
  // nicht gibt. Auch das muss folgenlos bleiben.
  const imOg = levelSlabs({ ...eingabe, durchbrueche: [deckendurchbruch('db-d', 'og')] });
  check('Ein Deckendurchbruch im obersten Geschoss bleibt folgenlos', imOg[0].holes.length, 0);

  check('Der Deckenumriss braucht kein Dokument', deckendurchbruchUmriss(dd).length, 4);
  check(
    'Der Deckenumriss hat das richtige Maß',
    r3(Math.abs(polygonArea(deckendurchbruchUmriss(dd)))),
    r3(DD_B * DD_H),
  );

  // =========================================================================
  // 10 · Sichtbarkeit über zwei Geschosse
  // =========================================================================
  const sicht = baueHaus(true);
  sicht.durchbrueche = { 'db-d': deckendurchbruch('db-d'), 'db-1': kernbohrung('db-1') };
  const imEg = durchbruecheAufGeschoss(sicht, 'eg');
  const imOG = durchbruecheAufGeschoss(sicht, 'og');
  check('Im EG stehen beide Durchbrüche', imEg.length, 2);
  check('… und keiner davon von unten', imEg.every((e) => !e.vonUnten), true);
  check('Im OG ist nur das Deckenloch zu sehen', imOG.length, 1);
  check('… und zwar als Loch von unten', imOG[0].vonUnten, true);
  check('… und es ist der Deckendurchbruch', imOG[0].durchbruch.id, 'db-d');

  // =========================================================================
  // 11 · Die Geschosskopie
  // =========================================================================
  //
  // Das EG wird ins OG übernommen. Der Wanddurchbruch muss mitkommen und auf
  // die **neue** Wand zeigen; der Deckendurchbruch bleibt liegen.
  let lauf = 0;
  const kopie = copyLevelContents({
    sourceLevelId: 'eg',
    targetLevelId: 'og',
    targetHeight: HOEHE,
    nodes: Object.values(sicht.nodes).filter((nd) => nd.levelId === 'eg'),
    walls: Object.values(sicht.walls).filter((wl) => wl.levelId === 'eg'),
    openings: [],
    verticals: [],
    solids: [],
    durchbrueche: Object.values(sicht.durchbrueche ?? {}),
    newId: (prefix) => `${prefix}-k${++lauf}`,
  });
  check('Der Wanddurchbruch wird mitkopiert', kopie.durchbrueche.length, 1);
  check('… und zwar als Kernbohrung', kopie.durchbrueche[0].kind, 'kernbohrung');
  check('… im Zielgeschoss', kopie.durchbrueche[0].levelId, 'og');
  check(
    '… mit einer neuen Kennung',
    kopie.durchbrueche[0].id !== 'db-1',
    true,
  );
  check(
    '… auf einer der neu erzeugten Wände',
    kopie.walls.some((wl) => wl.id === kopie.durchbrueche[0].wallId),
    true,
  );
  check(
    '… und nicht mehr auf der alten Wand',
    kopie.durchbrueche[0].wallId === 'eg-w-s',
    false,
  );
  check('Der Abstand auf der Achse bleibt', kopie.durchbrueche[0].distance ?? -1, KB_U);
  check(
    'Der Deckendurchbruch bleibt liegen',
    kopie.skipped.some((sk) => sk.art === 'durchbruch' && sk.grund === 'gehoert-zur-decke'),
    true,
  );

  // =========================================================================
  // 12 · IFC
  // =========================================================================
  const ifc = buildIfc(sicht, { timestamp: '2026-01-01T00:00:00.000Z' });
  check('Die IFC-Datei nennt den Durchbruch als Öffnungselement', ifc.includes("'Durchbruch'"), true);
  check('… und schneidet ihn aus einem Bauteil', ifc.includes('IFCRELVOIDSELEMENT'), true);
  check('Der Deckendurchbruch steht als eigenes Öffnungselement', ifc.includes("'Deckendurchbruch'"), true);
  const schlitz = baueHaus();
  schlitz.durchbrueche = {
    'db-s': {
      ...kernbohrung('db-s'),
      kind: 'schlitz',
      form: 'rechteckig',
      diameter: undefined,
      width: 0.2,
      height: 0.08,
    },
  };
  check(
    'Ein Schlitz ist eine Vertiefung, kein Durchgang',
    buildIfc(schlitz, { timestamp: '2026-01-01T00:00:00.000Z' }).includes('.RECESS.'),
    true,
  );

  // =========================================================================
  // 13 · Die Aussparung in der 3D-Wand
  // =========================================================================
  //
  // In 3D soll man durch eine Kernbohrung hindurchsehen. Geschnitten wird sie
  // aus derselben Zerlegung wie Fenster und Türen — mit zwei Ausnahmen, die
  // hier festgenagelt werden, weil beide sonst wie ein Bauschaden aussähen.
  const aus = durchbruchAussparungen([kb], 'eg-w-s', [], BREITE);
  check('Die Kernbohrung wird ausgespart', aus.length, 1);
  check('… über ihre Breite', r3(aus[0].width), KB_D);
  check('… an ihrer Stelle auf der Achse', r3(aus[0].distance), KB_U);
  // Achshöhe 0,30 − halbe Bohrung 0,076 = 0,224 Unterkante.
  check('… mit der Unterkante aus der Achshöhe', r3(aus[0].sillHeight), r3(KB_H - KB_D / 2));

  check(
    'Ein Schlitz wird nicht ausgespart — er geht nicht durch',
    durchbruchAussparungen(
      [{ ...kb, kind: 'schlitz', form: 'rechteckig', diameter: undefined, width: 0.2, height: 0.08 }],
      'eg-w-s',
      [],
      BREITE,
    ).length,
    0,
  );
  check(
    'Ein Deckendurchbruch spart keine Wand aus',
    durchbruchAussparungen([deckendurchbruch('db-d')], 'eg-w-s', [], BREITE).length,
    0,
  );
  check(
    'Ein Durchbruch auf einer anderen Wand bleibt außen vor',
    durchbruchAussparungen([kb], 'eg-w-n', [], BREITE).length,
    0,
  );
  // Ein Fenster von 1,20 m Breite bei u = 2,00 belegt 1,40 bis 2,60. Die
  // Bohrung bei 2,00 liegt mittendrin — sie würde die Zerlegung zerreißen.
  check(
    'Eine Bohrung im Fenster wird übergangen',
    durchbruchAussparungen([kb], 'eg-w-s', [{ distance: 2, width: 1.2 }], BREITE).length,
    0,
  );
  // Dieselbe Bohrung 1,00 m weiter liegt frei.
  check(
    'Daneben wird sie ausgespart',
    durchbruchAussparungen([{ ...kb, distance: 4 }], 'eg-w-s', [{ distance: 2, width: 1.2 }], BREITE)
      .length,
    1,
  );
  // Und zwei Bohrungen, die sich gegenseitig überlagern: die zweite fällt
  // weg, sonst liefe der Cursor der Zerlegung rückwärts.
  check(
    'Von zwei überlagerten Bohrungen bleibt eine',
    durchbruchAussparungen([kb, { ...kb, id: 'db-2', distance: KB_U + 0.05 }], 'eg-w-s', [], BREITE)
      .length,
    1,
  );
  check(
    'Die Aussparungen kommen sortiert',
    durchbruchAussparungen(
      [{ ...kb, id: 'b', distance: 4 }, { ...kb, id: 'a', distance: 1 }],
      'eg-w-s',
      [],
      BREITE,
    ).map((o) => o.id).join(','),
    'a,b',
  );

  // =========================================================================
  // 14 · Zweimal gerechnet ergibt dasselbe
  // =========================================================================
  const a = JSON.stringify(buildRaviaExport(mit).durchbrueche);
  const b = JSON.stringify(buildRaviaExport(mit).durchbrueche);
  check('Zweimal exportiert ergibt denselben Durchbruch', a === b, true);
  check('Kein „NaN" im Durchbruchblock', a.includes('NaN'), false);
  check('Kein „undefined" im Durchbruchblock', a.includes('undefined'), false);

  // Und die Kontrolle, dass die Prüfhausmaße stimmen — sonst prüfte alles
  // oben gegen ein Haus, das anders aussieht als gedacht.
  check(
    'Die Südwand des Prüfhauses ist 6,00 m lang',
    r3(distance(haus.nodes['eg-sw'], haus.nodes['eg-se'])),
    BREITE,
  );
}
