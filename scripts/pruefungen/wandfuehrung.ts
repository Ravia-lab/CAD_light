/**
 * Prüfblock „Wandführung" — wohin ein wandgebundenes Objekt kann.
 *
 * **Warum dieser Block gebraucht wird.** Die Zahl, die beim Ziehen am Zeiger
 * steht — „4,87 m vom Wandanfang" —, ist keine Anzeige, sondern ein Maß:
 * danach wird auf der Baustelle angerissen. Sie muss deshalb von der Seite
 * her stimmen, von der auch gemessen wird, und sie darf nicht davon abhängen,
 * auf welcher Seite der Wand der Heizkörper hängt.
 *
 * **Was der Block nicht prüft.** Ob sich der Heizkörper *bewegt*. Das ist eine
 * Frage der Zeigerbehandlung und gehört in den Rauchtest — und genau dort ist
 * sie auch aufgefallen: In 1.21.1 starb ein Zug nach einem Zwischenschritt,
 * weil ein Effekt sich mitten darin neu aufbaute. Ein Prüfblock hätte das nie
 * gesehen; ein Rauchtest, der **wie weit** misst statt nur **dass**, sieht es
 * sofort.
 */

import type { CheckFn } from './typ';
import type { BimDocument, BimNode, Fixture, Level, Wall } from '../../src/types/bim';
import { emptyPlant, emptySite } from '../../src/lib/plantDefaults';
import { fuehrungsText, umsetzungsMeldung, wandfuehrung } from '../../src/lib/wandfuehrung';

/** Südwand von (0|0) nach (6|0), 24 cm stark, lichte Höhe 2,75 m. */
const LAENGE = 6;
const DICKE = 0.24;

function baueHaus(): BimDocument {
  const nodes: Record<string, BimNode> = {
    a: { id: 'a', x: 0, y: 0, levelId: 'eg' },
    b: { id: 'b', x: LAENGE, y: 0, levelId: 'eg' },
  };
  const walls: Record<string, Wall> = {
    'w-s': {
      id: 'w-s',
      a: 'a',
      b: 'b',
      levelId: 'eg',
      type: 'exterior',
      thickness: DICKE,
      uValue: 0.28,
      height: 2.75,
      layerId: 'layer-walls',
    },
  };
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
  return {
    site: emptySite(),
    plant: emptyPlant(),
    meta: {
      name: 'Prüfhaus Wandführung',
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

/**
 * Ein Heizkörper an der Südwand: `u` auf der Achse, `s` quer dazu.
 *
 * `wallId` hat bewusst **keinen** Vorgabewert. Mit einem geschriebe man
 * `heizkoerper(2, 0.17, undefined)` und bekäme trotzdem die Wand — ein
 * ausdrücklich übergebenes `undefined` greift auf den Vorgabewert zurück.
 * Genau diese Falle hat hier eine Prüfung scheitern lassen, und das war gut:
 * sie hätte sonst behauptet, ein Objekt ohne Wandbindung habe eine Führung.
 */
function heizkoerper(u: number, s: number, wallId: string | null = 'w-s'): Fixture {
  return {
    id: 'hk',
    type: 'radiator',
    category: 'heating',
    label: 'Heizkörper',
    levelId: 'eg',
    position: { x: u, y: s },
    length: 1,
    depth: 0.1,
    rotation: 0,
    elevation: 0.15,
    wallId: wallId ?? undefined,
    params: { powerW: 1200 },
  } as Fixture;
}

const r3 = (v: number): number => Math.round(v * 1000) / 1000;

export function pruefeWandfuehrung(check: CheckFn): void {
  const doc = baueHaus();

  // --- Die Zahl, nach der angerissen wird --------------------------------
  const f = heizkoerper(2, 0.17);
  const w = wandfuehrung(doc, f);
  check('Es gibt eine Führung', w !== null, true);
  check('Sie nennt die Wand', w?.wallId ?? '—', 'w-s');
  check('Der Abstand wird vom Wandanfang gemessen', r3(w?.abstand ?? -1), 2);
  check('Die Wandlänge stimmt', r3(w?.laenge ?? -1), LAENGE);
  // Wandachse bei y = 0, Objektmitte bei y = +0,17 → Linksnormale (0|1), also +1.
  check('Die Seite folgt aus der Lage', w?.seite ?? 0, 1);
  check('Die Ausladung ist der Abstand zur Achse', r3(w?.ausladung ?? -1), 0.17);

  // Dieselbe Stelle, andere Seite: der Abstand darf sich **nicht** ändern.
  const gegen = wandfuehrung(doc, heizkoerper(2, -0.17));
  check('Auf der anderen Seite dieselbe Zahl', r3(gegen?.abstand ?? -1), 2);
  check('… aber die andere Seite', gegen?.seite ?? 0, -1);

  // --- Die Enden ----------------------------------------------------------
  check('Am Wandanfang ist der Abstand null', r3(wandfuehrung(doc, heizkoerper(0, 0.17))?.abstand ?? -1), 0);
  check('Am Wandende ist er die Wandlänge', r3(wandfuehrung(doc, heizkoerper(LAENGE, 0.17))?.abstand ?? -1), LAENGE);
  // Über das Ende hinaus wird gekappt: ein Maß größer als die Wand wäre eine
  // Anweisung, neben der Wand zu bohren.
  check('Über das Ende hinaus wird gekappt', r3(wandfuehrung(doc, heizkoerper(9, 0.17))?.abstand ?? -1), LAENGE);
  check('Vor den Anfang ebenso', r3(wandfuehrung(doc, heizkoerper(-3, 0.17))?.abstand ?? -1), 0);

  // --- Wenn es keine Führung gibt ----------------------------------------
  check('Ohne Wandbindung keine Führung', wandfuehrung(doc, heizkoerper(2, 0.17, null)) === null, true);
  check('Mit gelöschter Wand keine Führung', wandfuehrung(doc, heizkoerper(2, 0.17, 'w-fort')) === null, true);

  // --- Die Wand dreht sich, das Maß wandert mit --------------------------
  //
  // Der Ostknoten wandert nach Norden: die Wand läuft nun von (0|0) nach
  // (0|6). Ein Objekt bei (0|2) hat denselben Abstand vom Wandanfang wie
  // vorher eines bei (2|0) — das ist der ganze Zweck der Achsmessung.
  const gedreht = baueHaus();
  gedreht.nodes.b = { ...gedreht.nodes.b, x: 0, y: LAENGE };
  const wd = wandfuehrung(gedreht, { ...heizkoerper(0.17, 2), position: { x: -0.17, y: 2 } } as Fixture);
  check('Nach dem Drehen der Wand bleibt der Abstand', r3(wd?.abstand ?? -1), 2);

  // --- Die Zeilen ---------------------------------------------------------
  check('Die Fahne nennt Maß und Höhe', fuehrungsText(w, 0.15), '2,00 m vom Wandanfang · h 0,15 m');
  check('Ohne Wand sagt sie das', fuehrungsText(null, 0.15), 'frei im Raum · h 0,15 m');
  check(
    'Die Statusmeldung benennt den Gegenstand',
    umsetzungsMeldung('Heizkörper', w, 0.15),
    'Heizkörper umgesetzt · 2,00 m vom Wandanfang · h 0,15 m',
  );
  check(
    'Und ohne Wand auch dort',
    umsetzungsMeldung('Verteiler', null, 0.5),
    'Verteiler umgesetzt · frei im Raum · h 0,50 m',
  );
  // Deutsches Komma, zwei Nachkommastellen — auf den Zentimeter, wie auf dem
  // Zollstock. Millimeter wären an einer Wand eine Scheingenauigkeit.
  check('Zentimetergenau und mit Komma', fuehrungsText(wandfuehrung(doc, heizkoerper(1.2345, 0.17)), 0.153), '1,23 m vom Wandanfang · h 0,15 m');
}
