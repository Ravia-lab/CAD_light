/**
 * Prüfblock „Alles löschen" und „Aufstellgeschoss".
 * ---------------------------------------------------------------------------
 * **Die zwei Befunde, die dahinterstehen.** Beide kamen aus demselben Satz
 * aus dem Feld: „baue mir noch ein komplettes löschen ein, leider kann ich
 * grundstückgrenzen beim löschen nicht entfernen, weiterhin ist mir
 * aufgefallen das wärempumoe auf allen ebenen angezeigt wird, wenn ich die im
 * eg setze kann ich die in der zeichnung auch im og sehen und löschen, die
 * ist dann weg".
 *
 *  1. **Der Papierkorb räumte nicht alles.** `clearAll` leerte elf
 *     Sammlungen und ließ Grundstück, Wärmepumpe, Armaturen,
 *     Freihandnotizen, Referenzbild, Dächer und die ausgelegte Anlage
 *     stehen. Die Grundstücksgrenze blieb also sichtbar im Plan liegen,
 *     nachdem „Alles löschen" gedrückt war.
 *  2. **Das Gerät hatte kein Geschoss.** Es lag im Gelände und war damit in
 *     jedem Grundriss greifbar — und löschbar.
 *
 * **Was dieser Block festhält:**
 *
 *  - Nach `leerePlan` ist *jede* Sammlung leer, die Geometrie trägt. Geprüft
 *    wird nicht eine Auswahl davon, sondern die vollständige Liste; genau
 *    diese Vollständigkeit war der Fehler.
 *  - Die drei Dinge, die bleiben, bleiben: Geschosse, Ebenen, Bauteilkatalog.
 *    Dazu die erfassten Kennwerte — Bodenart und Systemtemperatur überleben,
 *    die Sonde im Garten nicht.
 *  - Die Bilanz zählt den Stand *vor* dem Löschen und lässt leere Gattungen
 *    weg.
 *  - Das Aufstellgeschoss folgt dem Eintrag; fehlt er, gilt das Geschoss bei
 *    ±0,00 — auch in einem Haus mit Keller.
 *
 * Alle Sollzahlen sind von Hand ausgezählt und stehen als Rechnung dabei.
 */

import type { BimDocument, HeatPump, Level } from '../../src/types/bim';
import { aufstellgeschoss, stehtAufGeschoss } from '../../src/lib/aufstellgeschoss';
import { bilanzSatz, leerePlan, loeschbilanz } from '../../src/lib/planLeeren';
import { emptyPlant, emptySite } from '../../src/lib/plantDefaults';
import type { CheckFn } from './typ';

function geschoss(id: string, name: string, elevation: number, order: number): Level {
  return {
    id,
    name,
    elevation,
    height: 2.5,
    floorUValue: 0.28,
    floorBoundary: 'ground',
    ceilingUValue: 0.2,
    ceilingBoundary: 'unheated',
    order,
  } as Level;
}

function pumpe(id: string, levelId?: string): HeatPump {
  return {
    id,
    label: 'Wärmepumpe',
    source: 'air',
    form: 'monoblock-outdoor',
    position: { x: 3, y: -2 },
    azimuth: 180,
    width: 1.1,
    depth: 0.5,
    height: 1.3,
    standHeight: 0.3,
    mounting: 'wall',
    soundPower: 55,
    nightModeGuaranteed: false,
    toneSurcharge: 0,
    refrigerant: 'R290',
    refrigerantMass: 1.5,
    protectionRadius: 1,
    heatingCapacity: 8,
    ratingPoint: 'A-7/W35',
    cop: 3.2,
    operation: 'mono-energetic',
    bivalencePoint: -7,
    backupCapacity: 6,
    flowTemperature: 40,
    gridRegime: 'p14a-dimming',
    blockedHours: 0,
    domesticHotWater: true,
    occupants: 4,
    ...(levelId ? { levelId } : {}),
  } as HeatPump;
}

/**
 * Ein Dokument mit genau einem Stück je Gattung.
 *
 * Eins je Gattung ist Absicht: Die Bilanz muss dann für jede Zeile „1"
 * melden, und ein vergessenes Feld in `leerePlan` fällt als „1" auf, das
 * stehen bleibt — bei größeren Zahlen müsste man erst nachrechnen, welche.
 */
function dokument(): BimDocument {
  const eg = geschoss('eg', 'EG', 0, 1);
  const kg = geschoss('kg', 'KG', -2.7, 0);
  return {
    meta: { name: 'Prüfhaus' },
    levels: { kg, eg: { ...eg, roofs: [{ id: 'd1', kind: 'gable', pitch: 38 }] } },
    layers: { 'layer-walls': { id: 'layer-walls', name: 'Wände', visible: true, locked: false } },
    constructions: { 'c1': { id: 'c1', name: 'Außenwand', source: 'user' } },
    nodes: { n1: { id: 'n1', x: 0, y: 0, levelId: 'eg' }, n2: { id: 'n2', x: 5, y: 0, levelId: 'eg' } },
    walls: { w1: { id: 'w1', a: 'n1', b: 'n2', levelId: 'eg' } },
    openings: { o1: { id: 'o1', wallId: 'w1', levelId: 'eg' } },
    fixtures: { f1: { id: 'f1', levelId: 'eg' } },
    verticals: { v1: { id: 'v1', levelId: 'eg' } },
    solids: { s1: { id: 's1', levelId: 'eg' } },
    durchbrueche: { d1: { id: 'd1', levelId: 'eg' } },
    pipes: { p1: { id: 'p1', levelId: 'eg' } },
    pipeAccessories: { a1: { id: 'a1', levelId: 'eg' } },
    annotations: { m1: { id: 'm1', levelId: 'eg' } },
    freihand: { h1: { id: 'h1', levelId: 'eg' } },
    roofOpenings: { r1: { id: 'r1', levelId: 'eg' } },
    rooms: { raum1: { id: 'raum1', levelId: 'eg' } },
    diagnostics: { openEnds: [{ x: 1, y: 1 }] },
    activeLevelId: 'eg',
    image: { id: 'bild', naturalWidth: 100, naturalHeight: 80, scale: 0.01, origin: { x: 0, y: 0 } },
    site: { ...emptySite(), soil: 'clay', state: 'NW', elements: { g1: { id: 'g1', kind: 'boundary', points: [] } }, pumps: { wp1: pumpe('wp1', 'eg') } },
    plant: { ...emptyPlant(), storages: { sp1: { id: 'sp1' } }, circuits: { k1: { id: 'k1' } } },
  } as unknown as BimDocument;
}

export function pruefePlanLeeren(check: CheckFn): void {
  // =========================================================================
  // 1 · Die Bilanz zählt, was weggeht
  // =========================================================================
  {
    const doc = dokument();
    const bilanz = loeschbilanz(doc);
    // Sechzehn Gattungen kennt `loeschbilanz`; das Prüfdokument trägt in
    // jeder genau ein Stück. Also sechzehn Zeilen, jede mit 1.
    check('Sechzehn Gattungen in der Bilanz', bilanz.length, 16);
    check('Jede mit genau einem Stück', bilanz.every((p) => p.anzahl === 1), true);
    check('Die Grundstücksgrenze steht drin',
      bilanz.some((p) => p.label === 'Objekte im Gelände'), true);
    check('Die Wärmepumpe steht drin', bilanz.some((p) => p.label === 'Wärmepumpen'), true);
    check('Das Dach steht drin', bilanz.some((p) => p.label === 'Dächer' && p.anzahl === 1), true);

    // Leere Gattungen fehlen — „0 Dächer" ist keine Auskunft.
    const leer = loeschbilanz({ ...doc, rooms: {}, image: undefined } as BimDocument);
    check('Ohne Räume und Bild bleiben vierzehn Zeilen', leer.length, 14);

    // Einzahl statt Mehrzahl, wo es nur eines ist.
    const satz = bilanzSatz(bilanz);
    check('Der Satz sagt „1 Wand"', satz.includes('1 Wand,'), true);
    check('Und nennt den Rückweg', satz.includes('Strg+Z'), true);
    check('Der leere Plan bekommt einen eigenen Satz', bilanzSatz([]), 'Der Plan war schon leer');
  }

  // =========================================================================
  // 2 · Geleert wird vollständig
  // =========================================================================
  {
    const doc = dokument();
    leerePlan(doc);
    const zaehl = (o: Record<string, unknown> | undefined) => Object.keys(o ?? {}).length;
    const summe =
      zaehl(doc.nodes) + zaehl(doc.walls) + zaehl(doc.openings) + zaehl(doc.fixtures) +
      zaehl(doc.verticals) + zaehl(doc.solids) + zaehl(doc.durchbrueche) + zaehl(doc.pipes) +
      zaehl(doc.pipeAccessories) + zaehl(doc.annotations) + zaehl(doc.freihand) +
      zaehl(doc.roofOpenings) + zaehl(doc.rooms) + zaehl(doc.site.elements) +
      zaehl(doc.site.pumps) + zaehl(doc.plant.storages) + zaehl(doc.plant.circuits);
    check('Keine Geometrie bleibt übrig', summe, 0);
    check('Das Referenzbild ist weg', doc.image === undefined, true);
    check('Die offenen Wandenden sind weg', doc.diagnostics.openEnds.length, 0);
    check('Kein Dach über dem EG', doc.levels['eg'].roofs === undefined, true);
    check('Und auch kein altes Einzeldach', doc.levels['eg'].roof === undefined, true);
    // Die Bilanz danach ist leer — das ist die eigentliche Aussage: was
    // gezählt wurde, ist auch weg.
    check('Danach gibt es nichts mehr zu löschen', loeschbilanz(doc).length, 0);
  }

  // =========================================================================
  // 3 · Der Rahmen bleibt stehen
  // =========================================================================
  {
    const doc = dokument();
    leerePlan(doc);
    check('Beide Geschosse stehen noch', Object.keys(doc.levels).length, 2);
    check('Mit ihrer Höhe', doc.levels['eg'].height, 2.5);
    check('Die Ebene bleibt', Object.keys(doc.layers).length, 1);
    check('Der Bauteilkatalog bleibt', Object.keys(doc.constructions).length, 1);
    check('Der Projektname bleibt', doc.meta.name, 'Prüfhaus');
    check('Das aktive Geschoss bleibt', doc.activeLevelId, 'eg');
    // Kennwerte sind Eingaben zum Vorhaben, nicht zum Plan.
    check('Die Bodenart bleibt', doc.site.soil, 'clay');
    check('Das Bundesland bleibt', doc.site.state, 'NW');
    check('Die Vorlauftemperatur bleibt', doc.plant.design.flowTemperature, 35);
  }

  // =========================================================================
  // 4 · Das Aufstellgeschoss der Wärmepumpe
  // =========================================================================
  {
    const doc = dokument();
    check('Mit Eintrag gilt der Eintrag', aufstellgeschoss(doc, pumpe('wp1', 'kg')), 'kg');
    check('Im EG greifbar', stehtAufGeschoss(doc, pumpe('wp1', 'eg'), 'eg'), true);
    check('Im KG nicht', stehtAufGeschoss(doc, pumpe('wp1', 'eg'), 'kg'), false);

    /*
     * Ohne Eintrag: das Geschoss bei ±0,00.
     *
     * Im Prüfhaus stehen KG bei −2,70 m und EG bei 0,00 m. |−2,70| = 2,70,
     * |0,00| = 0,00 — also das EG. Das ist genau der Fall, in dem „das
     * unterste Geschoss" danebenläge: Eine Außeneinheit steht nicht im
     * Keller.
     */
    check('Ohne Eintrag gilt das EG', aufstellgeschoss(doc, pumpe('wp2')), 'eg');
    check('Ein unbekanntes Geschoss zählt nicht',
      aufstellgeschoss(doc, pumpe('wp3', 'dg-gibts-nicht')), 'eg');

    // Bei Gleichstand das untere: zwei Geschosse auf 0,00, order 0 gewinnt.
    const gleich = {
      ...doc,
      levels: { a: geschoss('a', 'A', 0, 1), b: geschoss('b', 'B', 0, 0) },
    } as BimDocument;
    check('Bei Gleichstand das untere', aufstellgeschoss(gleich, pumpe('wp4')), 'b');

    // Ohne Geschoss gibt es keinen Aufstellort — und damit nirgends Zugriff.
    const ohne = { ...doc, levels: {} } as BimDocument;
    check('Ohne Geschoss kein Aufstellort', aufstellgeschoss(ohne, pumpe('wp5')) === undefined, true);
    check('Und nirgends greifbar', stehtAufGeschoss(ohne, pumpe('wp5'), 'eg'), false);
  }
}
