/**
 * Prüfblock „Prüfsumme" — erkennt die Gegenstelle, *was* sich geändert hat?
 *
 * **Der Fehler, der hier nicht mehr passieren soll.** RaVia ersetzt beim
 * erneuten Abgleich die Raum-Zwillinge automatisch und ohne sichtbaren
 * Hinweis. Wer gestern eine Heizlast für das Bad gerechnet hat und heute im
 * Erdgeschoss eine Steckdose verschiebt, bekommt entweder alle Ergebnisse
 * verworfen oder rechnet stillschweigend mit veralteten weiter. Ein
 * Zeitstempel kann diese Frage nicht beantworten — er sagt nur, dass das
 * Modell neuer ist.
 *
 * **Was hier geprüft wird, ist deshalb kein Zahlenwert, sondern ein
 * Verhalten.** Eine Prüfsumme ist nur brauchbar, wenn sie beide Fehler
 * vermeidet: Sie darf keine Änderung übersehen (dann wird mit falschen Zahlen
 * gerechnet), und sie darf nicht bei Belanglosem anspringen (dann traut ihr
 * nach dem dritten Fehlalarm niemand mehr). Beide Richtungen stehen unten,
 * und die zweite ist die, die in der Praxis vergessen wird.
 *
 * Erwartete Summenwerte stehen hier bewusst **nicht**. Eine festgeschriebene
 * Summe wäre kein Prüfwert, sondern ein Abbild der Implementierung: Jede
 * Änderung am Hash — auch eine Verbesserung — bräche sie, ohne dass etwas
 * falsch wäre. Geprüft werden die Eigenschaften, auf die sich die Gegenstelle
 * verlässt.
 */

import type { CheckFn } from './typ';
import type { BimDocument, BimNode, Level, Wall } from '../../src/types/bim';
import { emptyPlant, emptySite } from '../../src/lib/plantDefaults';
import { detectRooms } from '../../src/lib/roomDetection';
import { buildRaviaExport } from '../../src/lib/raviaExport';
import { hash64, kanonisch, pruefsumme } from '../../src/lib/pruefsumme';

// ---------------------------------------------------------------------------
// Das Prüfhaus — zwei Räume nebeneinander, Trennwand bei x = 5.
// ---------------------------------------------------------------------------

const BREITE = 8;
const TIEFE = 5;
const DICKE = 0.3;
const INNEN = 0.2;
const HOEHE = 2.5;

interface Vorgabe {
  /** Lage der Trennwand in x [m] — verschiebt beide Räume. */
  trennwand?: number;
  /** U-Wert der Westwand. */
  westU?: number;
  /** Name des westlichen Raums. */
  westName?: string;
  /** Solltemperatur des westlichen Raums. */
  westSoll?: number;
}

function baueHaus(v: Vorgabe = {}): BimDocument {
  const mitte = v.trennwand ?? 5;
  const nodes: Record<string, BimNode> = {};
  const walls: Record<string, Wall> = {};

  const p = (name: string, x: number, y: number): string => {
    nodes[name] = { id: name, x, y, levelId: 'eg' };
    return name;
  };
  const sw = p('sw', 0, 0);
  const se = p('se', BREITE, 0);
  const ne = p('ne', BREITE, TIEFE);
  const nw = p('nw', 0, TIEFE);
  const ms = p('ms', mitte, 0);
  const mn = p('mn', mitte, TIEFE);

  const wand = (name: string, a: string, b: string, innen: boolean, u: number): void => {
    walls[name] = {
      id: name,
      a,
      b,
      levelId: 'eg',
      type: innen ? 'interior' : 'exterior',
      thickness: innen ? INNEN : DICKE,
      uValue: u,
      height: HOEHE,
      layerId: 'layer-walls',
    } as Wall;
  };
  wand('w-s1', sw, ms, false, 0.28);
  wand('w-s2', ms, se, false, 0.28);
  wand('w-e', se, ne, false, 0.28);
  wand('w-n2', ne, mn, false, 0.28);
  wand('w-n1', mn, nw, false, 0.28);
  wand('w-w', nw, sw, false, v.westU ?? 0.28);
  wand('w-mid', ms, mn, true, 1.2);

  const levels: Record<string, Level> = {
    eg: {
      id: 'eg',
      name: 'EG',
      order: 0,
      elevation: 0,
      height: HOEHE,
      floorUValue: 0.35,
      floorBoundary: 'ground',
      ceilingUValue: 0.2,
      ceilingBoundary: 'unheated',
    } as Level,
  };

  const doc: BimDocument = {
    site: emptySite(),
    plant: emptyPlant(),
    meta: {
      name: 'Prüfhaus Prüfsumme',
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
      ventilation: { kind: 'none', heatRecovery: 0, operation: 'continuous' },
    },
    levels,
    layers: {},
    nodes,
    walls,
    openings: {},
    fixtures: {},
    verticals: {},
    pipes: {},
    annotations: {},
    roofOpenings: {},
    rooms: {},
    constructions: {},
    diagnostics: { openEnds: [] },
    activeLevelId: 'eg',
  } as BimDocument;

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
    const west = raum.centroid.x < mitte;
    // Feste Kennungen: Die Raumerkennung vergibt sonst neue, und zwei
    // Exporte wären schon deshalb nicht vergleichbar. Die Prüfsumme soll
    // zeigen, ob sich *am Raum* etwas geändert hat, nicht ob er neu erkannt
    // wurde — im laufenden Betrieb behält ein Raum seine Kennung.
    raum.id = west ? 'r-west' : 'r-ost';
    raum.name = west ? (v.westName ?? 'Wohnen') : 'Bad';
    raum.usage = (west ? 'living' : 'bath') as never;
    raum.setpointTemperature = west ? (v.westSoll ?? 20) : 24;
    raum.airChangeRate = west ? 0.5 : 1.5;
  }
  doc.rooms = Object.fromEntries(Object.values(doc.rooms).map((r) => [r.id, r]));
  return doc;
}

/** Die Prüfsummen beider Räume, nach Kennung. */
function summen(v: Vorgabe = {}): Record<string, string> {
  const ex = buildRaviaExport(baueHaus(v));
  return Object.fromEntries(ex.rooms.map((r) => [r.id, r.checksum]));
}

export function pruefePruefsumme(check: CheckFn): void {
  // === 1 — Form ===========================================================
  const basis = summen();
  check('Beide Räume tragen eine Prüfsumme', Object.keys(basis).length, 2);
  check('Sie ist 64 Bit in Hexadezimal', basis['r-west']?.length ?? 0, 16);
  check('… und besteht nur aus Hexziffern', /^[0-9a-f]{16}$/.test(basis['r-west'] ?? ''), true);
  check('Zwei verschiedene Räume, zwei Summen', basis['r-west'] !== basis['r-ost'], true);

  // === 2 — Dasselbe Modell ergibt dieselbe Summe ==========================
  //
  // Das ist die Grundlage von allem. Zwischen den beiden Aufrufen liegt ein
  // neuer `exportedAt`-Zeitstempel; wenn er die Summe veränderte, wäre jeder
  // Export von jedem anderen verschieden und die ganze Übung umsonst.
  const nochmal = summen();
  check('Zweiter Export, gleiche Summe (West)', nochmal['r-west'], basis['r-west']);
  check('Zweiter Export, gleiche Summe (Ost)', nochmal['r-ost'], basis['r-ost']);

  // === 3 — Was eine Heizlast ungültig macht, ändert die Summe =============
  //
  // Der U-Wert der Westwand. Er gehört nur zum westlichen Raum — der Osten
  // darf sich nicht rühren. Eine Summe, die auf jede Änderung im Haus
  // anspringt, ist dasselbe wie gar keine: Sie verwirft wieder alles.
  const andererU = summen({ westU: 0.19 });
  check('Anderer U-Wert: West ändert sich', andererU['r-west'] !== basis['r-west'], true);
  check('… und Ost bleibt gültig', andererU['r-ost'], basis['r-ost']);

  // Die Solltemperatur — dieselbe Probe für eine nicht-geometrische Größe.
  const andereSoll = summen({ westSoll: 22 });
  check('Andere Solltemperatur: West ändert sich', andereSoll['r-west'] !== basis['r-west'], true);
  check('… und Ost bleibt gültig', andereSoll['r-ost'], basis['r-ost']);

  // Die Trennwand verschieben ändert beide Räume — und zwar zu Recht: Der
  // eine wird größer, der andere kleiner.
  const verschoben = summen({ trennwand: 5.5 });
  check('Trennwand verschoben: West ändert sich', verschoben['r-west'] !== basis['r-west'], true);
  check('… und Ost ebenfalls', verschoben['r-ost'] !== basis['r-ost'], true);

  // === 4 — Was keine Heizlast ungültig macht, ändert sie nicht ============
  //
  // Die Richtung, die in der Praxis vergessen wird. Wer „Wohnen" in
  // „Wohnzimmer" umbenennt, hat nichts gerechnet, was ungültig würde. Springt
  // die Summe trotzdem an, kommt beim nächsten Abgleich eine Warnung ohne
  // Anlass — und nach der dritten schaut niemand mehr hin.
  const umbenannt = summen({ westName: 'Wohnzimmer' });
  check('Umbenennen ändert die Summe nicht', umbenannt['r-west'], basis['r-west']);
  check('… auch nicht die des Nachbarn', umbenannt['r-ost'], basis['r-ost']);

  // === 5 — Die kanonische Form ============================================
  //
  // `JSON.stringify` schreibt Felder in Einfügereihenfolge. Zwei Objekte mit
  // gleichem Inhalt ergäben dann verschiedene Summen — bei jedem zweiten
  // Export ein Fehlalarm.
  check(
    'Feldreihenfolge ändert nichts',
    kanonisch({ a: 1, b: 2 }),
    kanonisch({ b: 2, a: 1 }),
  );
  check('Fehlende Felder zählen wie nicht vorhanden', kanonisch({ a: 1, b: undefined }), kanonisch({ a: 1 }));

  // Rechenrauschen: Das Planarisieren der Wandachsen erzeugt Abweichungen um
  // 1e-15. Sie ändern keine Fläche um ein Mikrometer und dürfen deshalb
  // nichts melden. Ein Millimeter dagegen muss durchkommen.
  check('Rauschen unter 1e-6 fällt heraus', kanonisch(2.5) === kanonisch(2.5 + 1e-15), true);
  check('Ein Millimeter kommt durch', kanonisch(2.5) === kanonisch(2.501), false);

  // −0 entsteht aus einer Drehung um 180° und ist dieselbe Zahl wie 0.
  check('Minus null ist null', kanonisch(-0), kanonisch(0));

  // Verschachtelung und Listen: Reihenfolge *in einer Liste* ist dagegen
  // bedeutsam und muss durchschlagen — sonst wären zwei verschieden
  // sortierte Flächenlisten gleich, und genau deshalb sortiert der Export
  // sie vorher selbst.
  check('Listenreihenfolge schlägt durch', kanonisch([1, 2]) === kanonisch([2, 1]), false);

  // === 6 — Der Hash selbst ================================================
  check('Gleiche Eingabe, gleicher Hash', hash64('abc'), hash64('abc'));
  check('Verschiedene Eingabe, verschiedener Hash', hash64('abc') === hash64('abd'), false);
  check('Auch bei einem Bit Unterschied am Ende', hash64('Wand-1') === hash64('Wand-2'), false);
  check('Die leere Zeichenkette hat auch eine Summe', hash64('').length, 16);
  check('Die Prüfsumme eines Werts ist die seiner kanonischen Form', pruefsumme({ a: 1 }), hash64(kanonisch({ a: 1 })));
}
