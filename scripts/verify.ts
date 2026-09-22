/**
 * Verifikation der Geometrie-Kernel ohne Browser: Raumerkennung,
 * lichte Maße, Orientierungen, Wandzerlegung und Export-Kennwerte.
 * Ausführen:  npm run verify
 */

import type { BimDocument, BimNode, HeatPump, Opening, Wall } from '../src/types/bim';
import { applyVerticalDeductions, detectRooms, findOpenEnds } from '../src/lib/roomDetection';
import { buildRaviaExport } from '../src/lib/raviaExport';
import { REMEDIES, validateModel } from '../src/lib/validation';
import { GLOSSAR, glossaryList } from '../src/lib/glossar';
import {
  getWallGeometry,
  junctionExtension,
  openingSpan,
  wallBoxPlacement,
  wallLocalToScene,
  wallSolidParts,
  type ScenePoint,
} from '../src/lib/wallGeometry';
import { offsetPolygonPerEdge, polygonArea, orientationFromAzimuth, azimuthFromNormal } from '../src/lib/geometry';
import { diffExports, isRaviaExport } from '../src/lib/exportDiff';
import { buildIfc } from '../src/lib/ifcExport';
import { importIfc, parseStep, type StepValue } from '../src/lib/ifcImport';
import { stairPath, stairRunLength } from '../src/lib/verticalSymbols';
import { buildSummary } from '../src/lib/embedApi';
import { bridgeLengths, documentBridgeHeatLoss, envelopeArea, roomBridgeHeatLoss, roomThermalBridges } from '../src/lib/thermalBridges';
import { buildPipeNetwork } from '../src/lib/pipeNetwork';
import {
  acousticReport,
  blockingFactor,
  IMMISSION_LIMITS,
  // heatPump.ts führt eine eigene Flächenformel; geometry.ts exportiert
  // denselben Namen. Beide bleiben importiert, damit jeder Prüfblock die
  // Fassung prüft, die das geprüfte Modul selbst benutzt — der Aliasname
  // sagt am Aufrufort, welche das ist.
  polygonArea as heatPumpPolygonArea,
  protectionIssues,
  requiredDistance,
  ROOM_ANGLE,
  soundPressureAt,
  sourceDemand,
  waterProtectionVerdict,
} from '../src/lib/heatPump';
import { buildReferenceDocument, buildReferenceReport } from './reference';
import { pruefeDruckplan } from './pruefungen/druckplan';
import { pruefeAnlagenschema } from './pruefungen/anlagenschema';
import { pruefeRohrdaemmung } from './pruefungen/rohrdaemmung';
import { pruefeRohrbezeichnung } from './pruefungen/rohrbezeichnung';
import { pruefeWandhoehen } from './pruefungen/wandhoehen';
import { pruefePlanLeeren } from './pruefungen/planleeren';
import { pruefeRingleitung } from './pruefungen/ringleitung';
import { pruefeRaumnamenMitnehmen } from './pruefungen/raumnamenMitnehmen';
import { pruefeRaumzuordnung } from './pruefungen/raumzuordnung';
import { pruefeSprache } from './pruefungen/sprache';
import { pruefeDachlandschaft } from './pruefungen/dachlandschaft';
import { pruefeRohrausleger } from './pruefungen/rohrausleger';
import { pruefeRohrnetzrechner } from './pruefungen/rohrnetzrechner';
import { pruefeWissensbasis } from './pruefungen/wissensbasis';
import { pruefeGeschossdecken } from './pruefungen/geschossdecken';
import { pruefeSchemapruefung } from './pruefungen/schemapruefung';
import { pruefeSchemavorschlag } from './pruefungen/schemavorschlag';
import expectedReference from './fixtures/referenz-soll.json';
import {
  baseRoofHeightAt,
  buildRoofFrame,
  measureRoomUnderRoof,
  roofHeightAt,
  wallProfileUnderRoof,
} from '../src/lib/roofGeometry';
import { buildPlanSvg } from '../src/lib/planPrint';
import {
  HEAT_PUMP_CATALOG,
  capacityAt,
  matchModels,
  minimumBufferVolume,
  minimumRoomVolume,
} from '../src/lib/deviceCatalog';
import {
  PIPE_TABLES,
  designFloorHeating,
  findDimension,
  sizePipe,
  velocityOf,
  volumeFlow,
  volumeFlowShort,
} from '../src/lib/hydraulics';
import { designSafety, systemVolume } from '../src/lib/safetyFittings';
import { designDomesticHotWater, mixedVolume } from '../src/lib/domesticWater';
import { estimateHeatLoad } from '../src/lib/heatLoadEstimate';
import { buildSchematic, designPlant } from '../src/lib/plantDesign';
import { SCHEMATIC_LEGEND } from '../src/lib/schematicSymbols';
import { ROOM_TEMPLATES, polygonArea as templateArea, templatePolygon } from '../src/lib/roomTemplates';
import {
  buildComponentTable,
  buildSchematicSvg,
  componentTableCsv,
  fitsOnSheet,
} from '../src/lib/schematicPrint';
import { balanceNetwork, dimensionForDn, requiredKv } from '../src/lib/hydraulicBalance';
// Ausgelagerte Prüfblöcke. Sie liegen in eigenen Dateien, damit mehrere
// Blöcke unabhängig voneinander entstehen können; gezählt wird hier.
import { pruefeGeraeteimport } from './pruefungen/geraeteimport';
import { pruefeMassenauszug } from './pruefungen/massenauszug';
import { pruefeAnlagenbuch } from './pruefungen/anlagenbuch';
import { pruefeEinbettung } from './pruefungen/einbettung';
import { pruefeFussbodenheizung } from './pruefungen/fussbodenheizung';
import { pruefeKeller } from './pruefungen/keller';
import { pruefeRaumerkennung } from './pruefungen/raumerkennung';
import { pruefeProjekte } from './pruefungen/projekte';
import { pruefeMassivbauteile } from './pruefungen/massivbauteile';
import { pruefeDurchbrueche } from './pruefungen/durchbrueche';
import { pruefeWandfuehrung } from './pruefungen/wandfuehrung';
import { pruefeRohrlaenge } from './pruefungen/rohrlaenge';
import { pruefeHeizflaeche } from './pruefungen/heizflaeche';
import { pruefeGriffe } from './pruefungen/griffe';
import { pruefeUwert } from './pruefungen/uwert';
import { pruefeSystemtemperatur } from './pruefungen/systemtemperatur';
import { pruefeAnschlussgroesse } from './pruefungen/anschlussgroesse';
import { pruefeVorhaben } from './pruefungen/vorhaben';
import { pruefeBaugrund, pruefeLueftungskonvention, pruefeRueckweg } from './pruefungen/uebergabe';
import { pruefeAuslegungsuebergabe } from './pruefungen/auslegungsuebergabe';
import { pruefeUWertQuelle } from './pruefungen/uwertquelle';
import { pruefePruefsumme } from './pruefungen/pruefsumme';
import { pruefeExportvertrag } from './pruefungen/exportvertrag';
import { pruefeFassung } from './pruefungen/fassung';
import { pruefeDachgeschoss } from './pruefungen/dachgeschoss';
import { pruefeSpiegeln } from './pruefungen/spiegeln';
import { pruefeImportgeschoss } from './pruefungen/importgeschoss';
import { pruefeFlurfuehrung } from './pruefungen/flurfuehrung';
import { pruefeDachformen } from './pruefungen/dachformen';
import { pruefeKompass } from './pruefungen/kompass';
import { pruefeIfcFremd } from './pruefungen/ifcfremd';
import { pruefeIfcEinheiten } from './pruefungen/ifceinheiten';
import { pruefeIfcRaumumriss } from './pruefungen/ifcraumumriss';
import { pruefeIfcGeometrie } from './pruefungen/ifcgeometrie';
import { pruefeAutosave } from './pruefungen/autosave';
import { pruefeImportRobustheit } from './pruefungen/importrobustheit';
import { pruefeRaumnamen } from './pruefungen/raumnamen';
import { pruefeProjektmappe } from './pruefungen/projektmappe';
import { pruefeUiModus } from './pruefungen/uimodus';
import { pruefeSchichtgrenze } from './pruefungen/schichtgrenze';
import { pruefeBeschriftungslage } from './pruefungen/beschriftungslage';
import { pruefeSchemabeschriftung } from './pruefungen/schemabeschriftung';
import { pruefeZeigereingabe } from './pruefungen/zeigereingabe';
import { pruefeTueranschlag } from './pruefungen/tueranschlag';
import { pruefeHeizkoerperplatz } from './pruefungen/heizkoerperplatz';
import { pruefeSkizze } from './pruefungen/skizze';
import { pruefeNotizen } from './pruefungen/notizen';
import { pruefeBeschriftungsflaeche, pruefeEckpunkte } from './pruefungen/eckpunkte';
import { pruefeBegehen } from './pruefungen/begehen';
import { pruefeRaumtreffer } from './pruefungen/raumtreffer';
import { pruefeErzeugerhydraulik } from './pruefungen/erzeugerhydraulik';
import { pruefeRaumscan } from './pruefungen/raumscan';
import { pruefeGebaeudescan } from './pruefungen/gebaeudescan';
import { pruefeAufmass } from './pruefungen/aufmass';
import { pruefeWerkzeugkiste } from './pruefungen/werkzeugkiste';
import { pruefeBeschriftung3d } from './pruefungen/beschriftung';
import { pruefeWandquerung } from './pruefungen/wandquerung';
import { pruefeDachumriss } from './pruefungen/dachumriss';
import { pruefeAussenwand } from './pruefungen/aussenwand';
import { pruefeEbenen } from './pruefungen/ebenen';

let failures = 0;
let checks = 0;

function check(label: string, actual: number | string | boolean, expected: number | string | boolean, tol = 0) {
  checks++;
  const ok =
    typeof actual === 'number' && typeof expected === 'number'
      ? Math.abs(actual - expected) <= tol
      : actual === expected;
  if (!ok) {
    failures++;
    console.log(`  ✗ ${label}: erwartet ${expected}, erhalten ${actual}`);
  } else {
    console.log(`  ✓ ${label}: ${typeof actual === 'number' ? actual.toFixed(4) : actual}`);
  }
}

/**
 * Ein optionales Feld prüfbar machen, ohne die Lücke zuzuschütten.
 *
 * Viele Export- und Berichtsfelder sind optional: sie fehlen, wenn es nichts
 * zu berichten gibt. Wer das mit `?? 0`, `?? ''` oder `!` glattzieht, macht
 * aus „fehlt" einen Wert — die Zeile kann dann nicht mehr scheitern, wenn das
 * Feld eines Tages verschwindet, und prüft nur noch in eine Richtung.
 * `'fehlt'` ist ein dritter Zustand, der gegen jeden Sollwert falsch ist und
 * im Protokoll auch so erscheint.
 */
function angabe<T extends string | number | boolean>(value: T | undefined): T | 'fehlt' {
  return value === undefined ? 'fehlt' : value;
}

/**
 * Ein STEP-Attribut als Text.
 *
 * `StepValue` schließt `null` — das unbelegte `$` einer STEP-Zeile — und
 * verschachtelte Listen ein. Mit `String()` würde aus `null` ein „null" und
 * aus einer Liste eine Aufzählung; ein unbelegtes Attribut ginge damit als
 * Wert durch. Die Wörter halten die Fälle auseinander, sodass jede Zeile
 * unten auch dann scheitert, wenn der Parser statt des Textes nichts liefert.
 */
function stepText(value: StepValue): string {
  if (value === null) return 'unbelegt';
  if (Array.isArray(value)) return 'Liste';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return `#${value.ref}`;
}

/**
 * Urteil des Wasserschutzgebiets als ein Wort.
 *
 * Ohne Urteil ist nicht dasselbe wie „erlaubt": bei Luft als Quelle und
 * außerhalb eines Schutzgebiets stellt sich die Frage gar nicht, und das
 * Modul gibt deshalb `undefined` zurück. Als eigenes Wort geführt, scheitern
 * die Prüfungen unten auch dann, wenn das Modul die Fälle vertauscht.
 */
function schutzgebietsurteil(
  zone: BimDocument['site']['waterProtection'],
  source: HeatPump['source'],
): 'ohne Urteil' | 'ja' | 'einzelfall' | 'nein' {
  const urteil = waterProtectionVerdict(zone, source);
  return urteil === undefined ? 'ohne Urteil' : urteil.allowed;
}

// ---------------------------------------------------------------------------
// Testgeometrie
// ---------------------------------------------------------------------------

// Alle Testgeometrien dieser Datei liegen auf einer Ebene. Knoten und Wände
// tragen deren Kennung mit, weil `levelId` im Datenmodell Pflicht ist — ein
// Bauteil ohne Ebene wäre im Dokument nicht zuzuordnen.
const TEST_LEVEL_ID = 'level-0';

let nid = 0;
const nodes: Record<string, BimNode> = {};
const mk = (x: number, y: number): BimNode => {
  const n: BimNode = { id: `n${nid++}`, x, y, levelId: TEST_LEVEL_ID };
  nodes[n.id] = n;
  return n;
};

let wid = 0;
const walls: Wall[] = [];
const link = (a: BimNode, b: BimNode, thickness: number, type: Wall['type'] = 'exterior'): Wall => {
  const w: Wall = {
    id: `w${wid++}`,
    a: a.id,
    b: b.id,
    thickness,
    height: 2.75,
    type,
    layerId: 'layer-walls',
    levelId: TEST_LEVEL_ID,
    uValue: type === 'exterior' ? 0.24 : 1.2,
  };
  walls.push(w);
  return w;
};

// Rechteck 10,00 × 7,50 m (Achsmaße), 36,5er Außenwand,
// senkrechte 17,5er Innenwand bei x = 6,00 m.
const p1 = mk(0, 0);
const p2 = mk(10, 0);
const p3 = mk(10, 7.5);
const p4 = mk(0, 7.5);
const q1 = mk(6, 0);
const q2 = mk(6, 7.5);

const south = link(p1, q1, 0.365);
link(q1, p2, 0.365);
link(p2, p3, 0.365);
link(p3, q2, 0.365);
link(q2, p4, 0.365);
link(p4, p1, 0.365);
link(q1, q2, 0.175, 'interior');

const openings: Opening[] = [
  { id: 'o0', wallId: south.id, kind: 'window', distance: 3, width: 1.5, height: 1.385, sillHeight: 0.9, uValue: 0.95 },
];

console.log('\n▸ Reine Geometrie');
{
  // Ein 4×3-Quadrat, jede Kante 0,1 m nach innen versetzt → 3,8 × 2,8
  const poly = [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 3 },
    { x: 0, y: 3 },
  ];
  const inner = offsetPolygonPerEdge(poly, [0.1, 0.1, 0.1, 0.1]);
  check('Polygon-Offset Fläche', polygonArea(inner), 3.8 * 2.8, 1e-9);

  check('Azimut Nordnormale', azimuthFromNormal({ x: 0, y: 1 }), 0, 1e-9);
  check('Azimut Ostnormale', azimuthFromNormal({ x: 1, y: 0 }), 90, 1e-9);
  check('Orientierung 180°', orientationFromAzimuth(180), 'S');
  check('Orientierung 270°', orientationFromAzimuth(270), 'W');
}

console.log('\n▸ Wandzerlegung (Öffnungen als echte Aussparung)');
{
  const g = getWallGeometry(south, nodes)!;
  const parts = wallSolidParts(g, openings);
  // Fensterbrüstung 0,90 m + Sturz über 2,285 m + zwei volle Wandstücke
  check('Anzahl Teilquader', parts.length, 4);
  const solidVolume = parts.reduce(
    (sum, p) => sum + (p.uEnd - p.uStart) * (p.zEnd - p.zStart) * g.wall.thickness,
    0,
  );
  const full = g.length * g.wall.height * g.wall.thickness;
  const openingVolume = 1.5 * 1.385 * g.wall.thickness;
  check('Volumen = Wand − Öffnung', solidVolume, full - openingVolume, 1e-9);
}

console.log('\n▸ Öffnungslage im 3D-Modell (schräge Wände)');
{
  // Warum dieser Block: 2D und 3D müssen dieselbe Laibung treffen. Solange
  // nur achsparallel gezeichnet wurde, konnte das 3D-Modell die Achse falsch
  // herum aufspannen, ohne dass es auffiel — ein Quader ist punktsymmetrisch
  // und fällt bei 0° wie bei 180° Verdrehung auf sich selbst zurück. Erst
  // eine schräge Wand deckt den Fehler auf.

  // three.js dreht um die Hochachse mit R_y(θ)·(u, 0, s)
  //   = (u·cos θ + s·sin θ, 0, −u·sin θ + s·cos θ).
  // Genau diese Kette wird hier nachgestellt: trifft der so gesetzte Quader
  // die Laibung des Plans, kann das Modell nicht vom Plan abweichen.
  const rotY = (c: ScenePoint, angle: number, u: number, s: number): ScenePoint => ({
    x: c.x + u * Math.cos(angle) + s * Math.sin(angle),
    y: c.y,
    z: c.z - u * Math.sin(angle) + s * Math.cos(angle),
  });

  // 3-4-5-Wand: A = (1|2) → B = (5|5). Achslänge 5,00 m, Richtung (0,8|0,6) —
  // alle Erwartungswerte unten sind damit exakt und von Hand nachrechenbar.
  const sn: Record<string, BimNode> = {
    sa: { id: 'sa', x: 1, y: 2, levelId: TEST_LEVEL_ID },
    sb: { id: 'sb', x: 5, y: 5, levelId: TEST_LEVEL_ID },
  };
  const schraeg: Wall = {
    id: 'ws',
    a: 'sa',
    b: 'sb',
    thickness: 0.24,
    height: 2.5,
    type: 'interior',
    layerId: 'layer-walls',
    levelId: TEST_LEVEL_ID,
  };
  const gs = getWallGeometry(schraeg, sn);
  if (!gs) throw new Error('Testwand ohne Geometrie');
  check('Achslänge der schrägen Wand', gs.length, 5, 1e-12);

  const tuer: Opening = {
    id: 'os',
    wallId: 'ws',
    kind: 'door',
    distance: 2,
    width: 1,
    height: 2.01,
    sillHeight: 0,
  };
  const span = openingSpan(gs, tuer);
  check('Laibung ab Knoten a', span.from, 1.5, 1e-12);

  // Sollwert des Plans: A + 1,50·(0,8|0,6) = (2,20|2,90); Szene-z = −Modell-y.
  const soll = wallLocalToScene(gs, span.from, 0, 0);
  check('Laibung Szene x', soll.x, 2.2, 1e-12);
  check('Laibung Szene z', soll.z, -2.9, 1e-12);

  const parts = wallSolidParts(gs, [tuer]);
  check('Teilquader der schrägen Wand', parts.length, 3);
  check('Erster Teilquader endet an der Laibung', parts[0].uEnd, 1.5, 1e-12);

  // Erster Teilquader [0,00 … 1,50] → Mitte bei u = 0,75, also (1,60|2,45).
  const place = wallBoxPlacement(gs, parts[0].uStart, parts[0].uEnd, parts[0].zStart, parts[0].zEnd, gs.halfThickness);
  check('Quadermitte Szene x', place.center.x, 1.6, 1e-12);
  check('Quadermitte Szene z', place.center.z, -2.45, 1e-12);
  check('Quaderlänge', place.size.length, 1.5, 1e-12);

  // Die Stirnfläche des Quaders muss exakt auf der Laibung des Plans liegen.
  const stirn = rotY(place.center, place.rotationY, place.size.length / 2, 0);
  check('Stirnfläche trifft Laibung (x)', stirn.x, soll.x, 1e-12);
  check('Stirnfläche trifft Laibung (z)', stirn.z, soll.z, 1e-12);

  // Kennzahl zur Herleitung: mit gespiegelter Drehung (−α statt +α) wandert
  // die Stirnfläche um 2·r·|sin α| = 2·0,75·0,6 = 0,90 m. Das ist der Versatz,
  // den der Anwender im Modell gesehen hat.
  const gespiegelt = rotY(place.center, -place.rotationY, place.size.length / 2, 0);
  check(
    'Versatz bei gespiegelter Drehung',
    Math.hypot(gespiegelt.x - soll.x, gespiegelt.z - soll.z),
    0.9,
    1e-12,
  );

  // Querrichtung: die Szenendrehung vertauscht die Wandseiten (siehe
  // `wallBoxPlacement`). Die lokale +z-Kante des Quaders muss deshalb auf der
  // Seite der *Gegen*normale liegen — sonst säße ein Türblatt spiegelverkehrt.
  const flanke = rotY(place.center, place.rotationY, 0, gs.halfThickness);
  const flankeSoll = wallLocalToScene(gs, 0.75, -gs.halfThickness, place.center.y);
  check('Wandflanke Szene x', flanke.x, flankeSoll.x, 1e-12);
  check('Wandflanke Szene z', flanke.z, flankeSoll.z, 1e-12);

  // --- Ungleiche Anschlussstärken -----------------------------------------
  // Am Knoten a stößt eine 36,5er, am Knoten b eine 11,5er Wand an. Die
  // Verlängerungen sind damit verschieden: der erste Teilquader ist nicht mehr
  // symmetrisch zur Wandmitte. Wer statt der Quadermitte die Wandmitte als
  // Bezug nimmt, fällt hier auf.
  sn.sc = { id: 'sc', x: 1, y: -1, levelId: TEST_LEVEL_ID };
  sn.sd = { id: 'sd', x: 8, y: 5, levelId: TEST_LEVEL_ID };
  const dick: Wall = { ...schraeg, id: 'wd', a: 'sa', b: 'sc', thickness: 0.365 };
  const duenn: Wall = { ...schraeg, id: 'wl', a: 'sb', b: 'sd', thickness: 0.115 };

  const extStart = junctionExtension('sa', [schraeg, dick], schraeg);
  const extEnd = junctionExtension('sb', [schraeg, duenn], schraeg);
  check('Verlängerung am dicken Anschluss', extStart, 0.1825, 1e-12);
  check('Verlängerung am dünnen Anschluss', extEnd, 0.0575, 1e-12);

  const partsJ = wallSolidParts(gs, [tuer], extStart, extEnd);
  check('Erster Teilquader beginnt vor Knoten a', partsJ[0].uStart, -0.1825, 1e-12);
  check('Letzter Teilquader endet hinter Knoten b', partsJ[partsJ.length - 1].uEnd, 5.0575, 1e-12);

  // Mitte bei u = (−0,1825 + 1,50)/2 = 0,65875 → (1,527|2,39525).
  const placeJ = wallBoxPlacement(gs, partsJ[0].uStart, partsJ[0].uEnd, 0, 2.5, gs.halfThickness);
  check('Quadermitte mit Verlängerung (x)', placeJ.center.x, 1.527, 1e-12);
  check('Quadermitte mit Verlängerung (z)', placeJ.center.z, -2.39525, 1e-12);

  // Vorderes Ende weiterhin auf der Laibung, hinteres Ende auf u = −0,1825:
  // A − 0,1825·(0,8|0,6) = (0,854|1,8905).
  const vorn = rotY(placeJ.center, placeJ.rotationY, placeJ.size.length / 2, 0);
  const hinten = rotY(placeJ.center, placeJ.rotationY, -placeJ.size.length / 2, 0);
  check('Verlängerter Quader trifft Laibung (x)', vorn.x, 2.2, 1e-12);
  check('Verlängerter Quader trifft Laibung (z)', vorn.z, -2.9, 1e-12);
  check('Verlängerter Quader beginnt am Stoß (x)', hinten.x, 0.854, 1e-12);
  check('Verlängerter Quader beginnt am Stoß (z)', hinten.z, -1.8905, 1e-12);
}

console.log('\n▸ Automatische Raumerkennung');
const rooms = detectRooms({
  walls,
  nodes,
  openings,
  levelId: 'level-0',
  defaultHeight: 2.75,
  northAngle: 0,
});

check('Erkannte Räume', rooms.length, 2);

// Erwartete lichte Maße:
//  links : (6,00 − 0,365/2 − 0,175/2) × (7,50 − 0,365) = 5,73 × 7,135
//  rechts: (10,00 − 6,00 − 0,365/2 − 0,175/2) × 7,135  = 3,73 × 7,135
const left = rooms.find((r) => r.centroid.x < 6)!;
const right = rooms.find((r) => r.centroid.x > 6)!;

check('Fläche linker Raum', left.area, 5.73 * 7.135, 1e-6);
check('Fläche rechter Raum', right.area, 3.73 * 7.135, 1e-6);
check('Volumen linker Raum', left.volume, 5.73 * 7.135 * 2.75, 1e-6);
check('Umfang linker Raum', left.perimeter, 2 * (5.73 + 7.135), 1e-6);
check('Wandabschnitte linker Raum', left.boundaries.length, 4);

// Orientierungen: die Südwand des linken Raums muss nach Süden zeigen.
const southBoundary = left.boundaries.find((b) => b.orientation === 'S');
check('Südorientierung vorhanden', Boolean(southBoundary), true);
check('Nordorientierung vorhanden', Boolean(left.boundaries.find((b) => b.orientation === 'N')), true);
check('Westorientierung vorhanden', Boolean(left.boundaries.find((b) => b.orientation === 'W')), true);

// Die Fensterfläche muss genau einem Abschnitt zugeordnet sein …
const openingArea = left.boundaries.reduce((sum, b) => sum + b.openingArea, 0);
check('Zugeordnete Öffnungsfläche', openingArea, 1.5 * 1.385, 1e-9);

// … und zwar dem SÜDlichen Abschnitt. Das ist der eigentliche Lackmustest
// für die Normalenrichtung: eine um 180° verdrehte Normale würde die
// Fensterfläche in der Heizlast auf die Nordfassade buchen.
const windowBoundary = left.boundaries.find((b) => b.openingArea > 0)!;
check('Fenster liegt auf der Südfassade', windowBoundary.orientation, 'S');
check('Azimut der Südfassade', windowBoundary.azimuth, 180, 1e-9);

// Der rechte Raum grenzt im Osten an die Außenwand.
check('Ostfassade rechter Raum', Boolean(right.boundaries.find((b) => b.orientation === 'O')), true);
// Die Trennwand ist für beide Räume eine Innenwand.
check('Trennwand nicht als Außenwand gezählt', left.boundaries.filter((b) => b.isExterior).length, 3);

console.log('\n▸ Stabilität');
{
  // Offener Grundriss (eine Wand fehlt) darf keinen Raum erzeugen.
  const openWalls = walls.slice(0, 3);
  const openRooms = detectRooms({
    walls: openWalls,
    nodes,
    openings: [],
    levelId: 'level-0',
    defaultHeight: 2.75,
    northAngle: 0,
  });
  check('Offener Umriss → keine Räume', openRooms.length, 0);

  // Wiederholte Erkennung muss identische Ergebnisse liefern (Determinismus).
  const again = detectRooms({ walls, nodes, openings, levelId: 'level-0', defaultHeight: 2.75, northAngle: 0 });
  check('Deterministische Fläche', again[0].area, rooms[0].area, 1e-12);
}

console.log('\n▸ Topologie-Heilung (die häufigste Ursache für „Raum nicht erkannt")');
{
  /** Baut einen frischen Grundriss aus expliziten Koordinaten. */
  const build = (edges: [number, number, number, number, number][]) => {
    const n: Record<string, BimNode> = {};
    const w: Wall[] = [];
    let id = 0;
    const at = (x: number, y: number) => {
      const key = `p${x.toFixed(4)}_${y.toFixed(4)}`;
      if (!n[key]) n[key] = { id: key, x, y, levelId: TEST_LEVEL_ID };
      return n[key];
    };
    for (const [x1, y1, x2, y2, t] of edges) {
      const a = at(x1, y1);
      const b = at(x2, y2);
      w.push({
        id: `w${id++}`,
        a: a.id,
        b: b.id,
        thickness: t,
        height: 2.75,
        type: 'exterior',
        layerId: 'layer-walls',
        levelId: TEST_LEVEL_ID,
      });
    }
    return { nodes: n, walls: w };
  };

  const run = (edges: [number, number, number, number, number][]) => {
    const { nodes: n, walls: w } = build(edges);
    return detectRooms({
      walls: w,
      nodes: n,
      openings: [],
      levelId: 'level-0',
      defaultHeight: 2.75,
      northAngle: 0,
    });
  };

  // (a) Eine Ecke klafft um 12 mm auseinander — optisch geschlossen.
  const gap = run([
    [0, 0, 6, 0, 0.24],
    [6, 0, 6, 4, 0.24],
    [6, 4, 0.012, 4, 0.24],
    [0, 4.008, 0, 0, 0.24],
  ]);
  check('Klaffende Ecke (12 mm) wird geschlossen', gap.length, 1);

  // (b) Innenwand endet 25 mm vor der Außenwand — der klassische Fall aus
  //     dem freien Zeichnen. Ohne Heilung entsteht statt zwei Räumen einer.
  const tGap = run([
    [0, 0, 10, 0, 0.365],
    [10, 0, 10, 6, 0.365],
    [10, 6, 0, 6, 0.365],
    [0, 6, 0, 0, 0.365],
    [6, 0.025, 6, 5.975, 0.115],
  ]);
  check('T-Stoß mit 25 mm Luft trennt zwei Räume', tGap.length, 2);

  // (c) Über die Kreuzung hinausstehende Wand ("überstehendes Ende")
  const overhang = run([
    [0, 0, 10, 0, 0.24],
    [10, 0, 10, 6, 0.24],
    [10, 6, 0, 6, 0.24],
    [0, 6, 0, 0, 0.24],
    [5, -0.4, 5, 6.4, 0.24],
  ]);
  check('Überstehende Wand trennt trotzdem sauber', overhang.length, 2);

  // (d) Offene Enden werden gemeldet: ein Stummel ragt frei in den Raum.
  const stub = build([
    [0, 0, 10, 0, 0.24],
    [10, 0, 10, 6, 0.24],
    [10, 6, 0, 6, 0.24],
    [0, 6, 0, 0, 0.24],
    [5, 0, 5, 3, 0.115],
  ]);
  const ends = findOpenEnds(stub.walls, stub.nodes);
  check('Freies Wandende wird als offenes Ende gemeldet', ends.length, 1);
  check('Offenes Ende an der richtigen Stelle', ends[0]?.y ?? -1, 3, 1e-6);

  // (e) Geschlossener Grundriss meldet keine offenen Enden.
  const closed = build([
    [0, 0, 10, 0, 0.24],
    [10, 0, 10, 6, 0.24],
    [10, 6, 0, 6, 0.24],
    [0, 6, 0, 0, 0.24],
  ]);
  check('Geschlossener Umriss: keine offenen Enden', findOpenEnds(closed.walls, closed.nodes).length, 0);

  // (f) Verschachtelte Räume: Raum im Raum darf beide liefern.
  const nested = run([
    [0, 0, 12, 0, 0.365],
    [12, 0, 12, 9, 0.365],
    [12, 9, 0, 9, 0.365],
    [0, 9, 0, 0, 0.365],
    [4, 3, 8, 3, 0.115],
    [8, 3, 8, 6, 0.115],
    [8, 6, 4, 6, 0.115],
    [4, 6, 4, 3, 0.115],
  ]);
  check('Raum im Raum: innen + Restfläche erkannt', nested.length, 2);

  // (g) Mehrere getrennte Gebäudeteile
  const twoBlocks = run([
    [0, 0, 5, 0, 0.24],
    [5, 0, 5, 4, 0.24],
    [5, 4, 0, 4, 0.24],
    [0, 4, 0, 0, 0.24],
    [8, 0, 13, 0, 0.24],
    [13, 0, 13, 4, 0.24],
    [13, 4, 8, 4, 0.24],
    [8, 4, 8, 0, 0.24],
  ]);
  check('Zwei getrennte Baukörper', twoBlocks.length, 2);

  // (h) Kammartiger Grundriss wie im Nutzerplan: eine durchlaufende
  //     Rückwand mit angesetzten Querwänden ergibt drei Zellen.
  const comb = run([
    [0, 0, 15, 0, 0.24],
    [0, 0, 0, 5, 0.24],
    [0, 5, 15, 5, 0.24],
    [15, 5, 15, 0, 0.24],
    [5, 0, 5, 5, 0.115],
    [10, 0, 10, 5, 0.115],
  ]);
  check('Kammgrundriss ergibt drei Zellen', comb.length, 3);
}

console.log('\n▸ Export für die Heizlastberechnung');
{
  // Kleines, vollständig kontrollierbares Gebäude: zwei Räume, eine Trennwand.
  const n: Record<string, BimNode> = {};
  const w: Wall[] = [];
  let id = 0;
  const at = (x: number, y: number) => {
    const key = `p${x}_${y}`;
    if (!n[key]) n[key] = { id: key, x, y, levelId: TEST_LEVEL_ID };
    return n[key];
  };
  const edge = (x1: number, y1: number, x2: number, y2: number, t: number, type: Wall['type'], u: number) => {
    const wall: Wall = {
      id: `w${id++}`,
      a: at(x1, y1).id,
      b: at(x2, y2).id,
      thickness: t,
      height: 2.5,
      type,
      layerId: 'layer-walls',
      levelId: TEST_LEVEL_ID,
      uValue: u,
    };
    w.push(wall);
    return wall;
  };

  const south = edge(0, 0, 8, 0, 0.36, 'exterior', 0.22);
  edge(8, 0, 8, 5, 0.36, 'exterior', 0.22);
  edge(8, 5, 0, 5, 0.36, 'exterior', 0.22);
  edge(0, 5, 0, 0, 0.36, 'exterior', 0.22);
  const divider = edge(4, 0, 4, 5, 0.12, 'interior', 1.3);

  const ops: Opening[] = [
    { id: 'win-a', wallId: south.id, kind: 'window', distance: 2, width: 1.2, height: 1.4, sillHeight: 0.9, uValue: 0.9, gValue: 0.6 },
    { id: 'pass-a', wallId: divider.id, kind: 'passage', distance: 2.5, width: 1.0, height: 2.1, sillHeight: 0, passageType: 'lintel' },
  ];

  const detected = detectRooms({
    walls: w,
    nodes: n,
    openings: ops,
    levelId: 'level-0',
    defaultHeight: 2.5,
    northAngle: 0,
  });
  check('Zwei Räume für den Export', detected.length, 2);

  const doc = {
    meta: {
      name: 'Test',
      createdAt: '', modifiedAt: '',
      northAngle: 0,
      designOutdoorTemperature: -12,
      designIndoorTemperature: 20,
      n50: 3,
      shielding: 'moderate' as const,
      unheatedTemperature: 10,
      groundTemperature: 10,
      thermalBridgeSupplement: 0.1,
      reheatFactor: 0,
    },
    levels: {
      'level-0': {
        id: 'level-0', name: 'EG', elevation: 0, height: 2.5,
        floorUValue: 0.3, floorBoundary: 'ground' as const,
        ceilingUValue: 0.2, ceilingBoundary: 'unheated' as const,
      },
    },
    layers: {},
    nodes: n,
    walls: Object.fromEntries(w.map((x) => [x.id, x])),
    openings: Object.fromEntries(ops.map((o) => [o.id, o])),
    fixtures: {},
    rooms: Object.fromEntries(detected.map((r) => [r.id, r])),
    diagnostics: { openEnds: [] },
    activeLevelId: 'level-0',
  };

  const ex = buildRaviaExport(doc as never);
  check('Schema-Version', ex.version, '2.2.0');
  check('Einheiten dokumentiert', ex.units.uValue, 'W/(m2K)');

  const room = ex.rooms.find((r) => r.polygon.some((p) => p.x < 4))!;

  // Jeder Raum MUSS Boden und Decke haben — sonst fehlt in der Transmission
  // bei einem Erdgeschossraum leicht ein Drittel der Hüllfläche.
  check('Boden vorhanden', ex.rooms.every((r) => r.surfaces.some((s) => s.kind === 'floor')), true);
  check('Decke vorhanden', ex.rooms.every((r) => r.surfaces.some((s) => s.kind === 'ceiling')), true);
  check('Hüllbauteile im Raum', room.surfaces.length, 6); // 4 Wände + Boden + Decke

  const floor = room.surfaces.find((s) => s.kind === 'floor')!;
  check('Boden gegen Erdreich', floor.boundary, 'ground');
  check('Bodentemperatur = Erdreich', floor.neighbourTemperature, 10);
  check('Bodenfläche = Raumfläche', floor.grossArea, room.area, 1e-9);

  const exteriorWall = room.surfaces.find((s) => s.kind === 'wall' && s.boundary === 'exterior')!;
  check('Außenwand-Temperatur = θe', exteriorWall.neighbourTemperature, -12);
  check('Wärmebrückenzuschlag gesetzt', exteriorWall.thermalBridgeSupplement, 0.1, 1e-9);
  check('Neigung Wand', exteriorWall.tilt, 90);

  // Die Trennwand muss den Nachbarraum kennen — sonst rechnet die Gegenstelle
  // sie als unbeheizt und erfindet einen Wärmestrom, den es nicht gibt.
  const partition = room.surfaces.find((s) => s.kind === 'wall' && s.component === 'interior')!;
  check('Trennwand kennt Nachbarraum', partition.boundary, 'adjacent-room');
  check('Nachbarraum-ID vorhanden', Boolean(partition.neighbourRoomId), true);
  check('Nachbartemperatur = Solltemp. Nachbar', partition.neighbourTemperature, 20);

  // Erdreich-Kennwerte
  check('Erdkontakt-Umfang > 0', room.groundContactPerimeter > 0, true);
  check('B′ berechnet', room.characteristicGroundDimension > 0, true);
  check('Außenfassaden gezählt', room.exposedFacadeCount, 3);
  check('Mindestluftstrom', room.minimumAirflow, room.volume * room.airChangeRate, 0.02);

  // Der Durchgang darf keine Bauteilfläche bekommen, aber die Wand verkleinern.
  const passageSurface = ex.rooms
    .flatMap((r) => r.surfaces)
    .find((s) => s.openings.some((o) => o.kind === 'passage'))!;
  check('Durchgang mindert Nettofläche', passageSurface.netArea < passageSurface.grossArea, true);
  check('Durchgang ohne U-Wert', passageSurface.openings.find((o) => o.kind === 'passage')!.uValue, 0);

  // Fensterfläche darf genau einmal auftauchen
  const windows = ex.rooms.flatMap((r) => r.surfaces).flatMap((s) => s.openings).filter((o) => o.kind === 'window');
  check('Fenster genau einmal exportiert', windows.length, 1);
  check('Fensterfläche', windows[0].area, 1.2 * 1.4, 1e-9);

  // Prüfbericht
  const report = validateModel(doc as never);
  check('Modell rechenfähig', report.ready, true);
  check('Keine Fehler', report.errors, 0);

  // Fehlerfall: Fenster breiter als die Wand
  const broken = { ...doc, openings: { bad: { ...ops[0], id: 'bad', width: 99 } } };
  const badReport = validateModel(broken as never);
  check('Zu breite Öffnung wird gemeldet', badReport.errors > 0, true);
  check('Modell dann nicht rechenfähig', badReport.ready, false);
}

// ---------------------------------------------------------------------------
// Mehrgeschossigkeit, Bauteilkatalog, Planausgabe, Export-Vergleich
// ---------------------------------------------------------------------------

/** Kleines, in sich geschlossenes Gebäude: ein Rechteck je Geschoss. */
function buildStack(levelIds: string[]) {
  const nodesX: Record<string, BimNode> = {};
  const wallsX: Wall[] = [];
  let i = 0;
  for (const levelId of levelIds) {
    const pts = [
      { x: 0, y: 0 },
      { x: 6, y: 0 },
      { x: 6, y: 5 },
      { x: 0, y: 5 },
    ];
    const ids = pts.map((p) => {
      const n = { id: `s${i++}`, x: p.x, y: p.y, levelId } as BimNode;
      nodesX[n.id] = n;
      return n;
    });
    for (let k = 0; k < 4; k++) {
      wallsX.push({
        id: `sw${i++}`,
        a: ids[k].id,
        b: ids[(k + 1) % 4].id,
        thickness: 0.365,
        height: 2.6,
        type: 'exterior',
        layerId: 'layer-walls',
        uValue: 0.24,
        levelId,
      } as Wall);
    }
  }
  return { nodesX, wallsX };
}

console.log('\n▸ Mehrgeschossigkeit');
{
  const levelIds = ['lvl-eg', 'lvl-og'];
  const { nodesX, wallsX } = buildStack(levelIds);

  const rooms = levelIds.flatMap((levelId) =>
    detectRooms({
      nodes: nodesX,
      walls: wallsX.filter((w) => w.levelId === levelId),
      openings: [],
      levelId,
      defaultHeight: 2.6,
      northAngle: 0,
    }),
  );

  check('Ein Raum je Geschoss', rooms.length, 2);
  check('Räume tragen ihre Geschoss-ID', rooms.every((r) => levelIds.includes(r.levelId)), true);
  check(
    'Raumerkennung mischt Geschosse nicht',
    rooms.filter((r) => r.levelId === 'lvl-eg').length,
    1,
  );

  const stackDoc = {
    meta: {
      name: 'Stapel', createdAt: '', modifiedAt: '', northAngle: 0,
      designOutdoorTemperature: -12, designIndoorTemperature: 20, n50: 3,
      shielding: 'moderate' as const, unheatedTemperature: 10, groundTemperature: 10,
      thermalBridgeSupplement: 0.1, reheatFactor: 0,
    },
    levels: {
      'lvl-eg': {
        id: 'lvl-eg', name: 'EG', order: 0, elevation: 0, height: 2.6,
        floorUValue: 0.3, floorBoundary: 'ground' as const,
        ceilingUValue: 0.2, ceilingBoundary: 'unheated' as const,
      },
      'lvl-og': {
        id: 'lvl-og', name: 'OG', order: 1, elevation: 2.85, height: 2.6,
        floorUValue: 0.3, floorBoundary: 'unheated' as const,
        ceilingUValue: 0.18, ceilingBoundary: 'exterior' as const,
      },
    },
    layers: {},
    nodes: nodesX,
    walls: Object.fromEntries(wallsX.map((x) => [x.id, x])),
    openings: {},
    fixtures: {},
    rooms: Object.fromEntries(rooms.map((r) => [r.id, r])),
    constructions: {},
    diagnostics: { openEnds: [] },
    activeLevelId: 'lvl-eg',
  };

  const ex = buildRaviaExport(stackDoc as never);
  check('Beide Geschosse exportiert', ex.rooms.length, 2);
  check('Geschosse benannt', new Set(ex.rooms.map((r) => r.level)).size, 2);

  // Der entscheidende Punkt: die Decke des EG grenzt an einen beheizten
  // Raum gleicher Temperatur — dort fließt keine Wärme. Würde sie weiter als
  // „unbeheizt" gerechnet, erfände die Heizlast einen Verlust nach oben.
  const eg = ex.rooms.find((r) => r.level === 'EG')!;
  const og = ex.rooms.find((r) => r.level === 'OG')!;
  const egCeiling = eg.surfaces.find((s) => s.kind === 'ceiling')!;
  const ogFloor = og.surfaces.find((s) => s.kind === 'floor')!;
  check('EG-Decke gegen beheizt = adiabat', egCeiling.boundary, 'adiabatic');
  check('OG-Boden gegen beheizt = adiabat', ogFloor.boundary, 'adiabatic');
  check('OG-Decke bleibt außen', og.surfaces.find((s) => s.kind === 'ceiling')!.boundary, 'exterior');
  check('EG-Boden bleibt Erdreich', eg.surfaces.find((s) => s.kind === 'floor')!.boundary, 'ground');

  // Bauteilkatalog: ein zugewiesener Aufbau schlägt den Wand-U-Wert.
  const withCat = {
    ...stackDoc,
    constructions: {
      'c-aw': {
        id: 'c-aw', name: 'Außenwand 36,5 WDVS', category: 'wall' as const,
        uValue: 0.15, thickness: 0.365,
      },
    },
    walls: Object.fromEntries(
      Object.values(stackDoc.walls).map((w) => [w.id, { ...w, constructionId: 'c-aw' }]),
    ),
  };
  const exCat = buildRaviaExport(withCat as never);
  const catWall = exCat.rooms[0].surfaces.find((s) => s.kind === 'wall')!;
  check('Aufbau setzt den U-Wert', catWall.uValue, 0.15, 1e-9);
  check('Aufbau im Export dokumentiert', Object.keys(exCat.constructions ?? {}).length > 0, true);

  // Planausgabe
  const plan = buildPlanSvg(stackDoc as never, {
    scale: 100,
    format: 'A4',
    orientation: 'landscape',
    levelId: 'lvl-eg',
    showRoomLabels: true,
    showDimensions: true,
    showFixtures: true,
    showAnnotations: true,
    showInteriorDimensions: true,
    showLegend: true,
    showOpeningDimensions: true,
  });
  check('Plan-SVG erzeugt', plan.svg.startsWith('<svg'), true);
  check('Blattbreite A4 quer [mm]', plan.sheet.w, 297, 1e-9);
  check('6 × 5 m passt bei 1:100 auf A4', plan.fits, true);

  const tight = buildPlanSvg(stackDoc as never, {
    scale: 20,
    format: 'A4',
    orientation: 'landscape',
    levelId: 'lvl-eg',
    showRoomLabels: true,
    showDimensions: true,
    showFixtures: true,
    showAnnotations: true,
    showInteriorDimensions: true,
    showLegend: true,
    showOpeningDimensions: true,
  });
  check('1:20 passt nicht mehr', tight.fits, false);
  check('Passender Maßstab wird vorgeschlagen', tight.suggestedScale >= 20, true);

  // Export-Vergleich
  check('Export wird als RaVia-Export erkannt', isRaviaExport(ex), true);
  check('Fremdes JSON wird abgelehnt', isRaviaExport({ hello: 'world' }), false);

  const same = diffExports(ex, ex);
  check('Identischer Stand: nichts geändert', same.summary.changed + same.summary.added + same.summary.removed, 0);
  check('Identischer Stand: alles unverändert', same.summary.unchanged, 2);

  const changed = diffExports(ex, exCat);
  check('U-Wert-Änderung wird gefunden', changed.summary.changed > 0, true);

  const shrunk = {
    ...ex,
    rooms: ex.rooms.slice(0, 1).map((r) => ({ ...r, area: r.area + 5, volume: r.volume + 12 })),
  };
  const diff2 = diffExports(ex, shrunk as never);
  check('Entfallener Raum erkannt', diff2.summary.removed, 1);
  check('Flächenänderung erkannt', diff2.summary.changed, 1);
  const areaChange = diff2.rooms
    .find((r) => r.kind === 'changed')!
    .changes.find((c) => c.field === 'area')!;
  check('Delta der Fläche vorzeichenrichtig', areaChange.delta! > 0, true);
}

// ---------------------------------------------------------------------------
// Dachgeometrie
// ---------------------------------------------------------------------------

console.log('\n▸ Dachschrägen (Satteldach 45°, Kniestock 1,00 m)');
{
  // Rechteck 8 × 10 m; First in Nord-Süd-Richtung, Dach fällt nach Ost/West.
  // Damit lassen sich alle Werte von Hand nachrechnen:
  //   Firsthöhe  = 1,00 + 4,00 · tan45° = 5,00 m
  //   Volumen    = 80 · 1,00 + ½ · 8 · 4 · 10 = 240 m³
  //   Mittelhöhe = 240 / 80 = 3,00 m
  const rect = [
    { x: -4, y: -5 },
    { x: 4, y: -5 },
    { x: 4, y: 5 },
    { x: -4, y: 5 },
  ];
  const roof = {
    kind: 'gable' as const,
    pitch: 45,
    kneeHeight: 1,
    azimuth: 90,
    ridgeOffset: 0,
    uValue: 0.2,
    gableUValue: 0.24,
  };
  const frame = buildRoofFrame(roof, rect)!;

  check('Firsthöhe', frame.ridgeHeight, 5, 1e-9);
  check('Höhe am First', roofHeightAt(frame, { x: 0, y: 0 }), 5, 1e-9);
  check('Höhe an der Traufe', roofHeightAt(frame, { x: 4, y: 0 }), 1, 1e-9);
  check('Höhe auf halbem Weg', roofHeightAt(frame, { x: 2, y: 3 }), 3, 1e-9);

  const m = measureRoomUnderRoof(frame, rect, 0.02);
  check('Luftvolumen unter der Schräge', m.volume, 240, 0.5);
  check('Mittlere lichte Höhe', m.averageHeight, 3, 0.01);
  check('Kleinste Höhe', m.minHeight, 1, 0.03);
  check('Größte Höhe', m.maxHeight, 5, 0.03);

  // Geneigte Fläche: 80 m² projiziert / cos45° = 113,14 m².
  check('Geneigte Dachfläche', m.slopedArea, 80 / Math.cos((45 * Math.PI) / 180), 0.5);
  check('Zwei Dachflächen', m.slopedAreaByFace.length, 2);
  check('Dachflächen gleich groß', Math.abs(m.slopedAreaByFace[0].area - m.slopedAreaByFace[1].area) < 0.6, true);
  const azimuths = m.slopedAreaByFace.map((f) => f.azimuth).sort((a, b) => a - b);
  check('Dachflächen zeigen nach Ost und West', `${azimuths[0]}/${azimuths[1]}`, '90/270');

  // WoFlV §4: über 2,00 m voll (Breite 6 m → 60 m²), 1,00–2,00 m zur Hälfte
  // (Breite 2 m → 20 m² · 0,5 = 10 m²) ⇒ 70 m² von 80 m² Grundfläche.
  check('Wohnfläche nach WoFlV', m.livingArea, 70, 0.5);
  check('Nichts unter 1,00 m', m.areaBelow1m, 0, 0.3);

  // Traufwand: überall Kniestockhöhe, also kein Giebel.
  const eave = wallProfileUnderRoof(frame, { x: 4, y: -5 }, { x: 4, y: 5 }, 0.01);
  check('Traufwand: Fläche = Länge × Kniestock', eave.grossArea, 10, 0.05);
  check('Traufwand ohne Giebelanteil', eave.gableArea, 0, 0.02);

  // Giebelwand: Trapez 1 → 5 → 1 m über 8 m ⇒ 24 m², davon 16 m² Giebeldreieck.
  const gableWall = wallProfileUnderRoof(frame, { x: -4, y: 5 }, { x: 4, y: 5 }, 0.01);
  check('Giebelwand: Gesamtfläche', gableWall.grossArea, 24, 0.05);
  check('Giebelwand: Dreieck über der Traufe', gableWall.gableArea, 16, 0.05);
  check('Giebelwand: Wand bis Traufe', gableWall.kneeArea, 8, 0.05);

  // Pultdach über demselben Rechteck: Firsthöhe 1 + 8 · tan30°.
  const mono = buildRoofFrame({ ...roof, kind: 'monopitch', pitch: 30 }, rect)!;
  check('Pultdach: Firsthöhe', mono.ridgeHeight, 1 + 8 * Math.tan((30 * Math.PI) / 180), 1e-9);
  check('Pultdach: hohe Seite', roofHeightAt(mono, { x: -4, y: 0 }), mono.ridgeHeight, 1e-9);
  check('Pultdach: tiefe Seite', roofHeightAt(mono, { x: 4, y: 0 }), 1, 1e-9);
  const monoM = measureRoomUnderRoof(mono, rect, 0.02);
  check('Pultdach: nur eine Dachfläche', monoM.slopedAreaByFace.length, 1);

  // Kehlbalkenlage bei 3,00 m kappt die Schräge.
  const collar = buildRoofFrame({ ...roof, collarHeight: 3 }, rect)!;
  check('Kehlbalken kappt die Höhe', roofHeightAt(collar, { x: 0, y: 0 }), 3, 1e-9);
  const collarM = measureRoomUnderRoof(collar, rect, 0.02);
  // Waagerechter Anteil: |x| ≤ 2 ⇒ 4 m Breite × 10 m = 40 m².
  check('Waagerechte Deckenfläche', collarM.flatCeilingArea, 40, 0.6);
  check('Volumen kleiner als beim vollen Satteldach', collarM.volume < m.volume, true);

  // Flachdach bleibt ohne Rahmen — der Regelfall darf nichts kosten.
  check('Flachdach liefert keinen Rahmen', buildRoofFrame({ ...roof, kind: 'flat' }, rect) === null, true);
  check('Neigung 0 liefert keinen Rahmen', buildRoofFrame({ ...roof, pitch: 0 }, rect) === null, true);
}

console.log('\n▸ Dach im Export');
{
  // Dasselbe Rechteck als echtes Geschoss mit Wänden, damit der Weg über
  // Raumerkennung und Export mitgeprüft wird.
  const nodesR: Record<string, BimNode> = {};
  const wallsR: Wall[] = [];
  const pts = [
    { x: -4, y: -5 },
    { x: 4, y: -5 },
    { x: 4, y: 5 },
    { x: -4, y: 5 },
  ];
  const ids = pts.map((p, i) => {
    const n = { id: `r${i}`, x: p.x, y: p.y, levelId: 'dg' } as BimNode;
    nodesR[n.id] = n;
    return n;
  });
  for (let i = 0; i < 4; i++) {
    wallsR.push({
      id: `rw${i}`,
      a: ids[i].id,
      b: ids[(i + 1) % 4].id,
      thickness: 0.24,
      height: 1,
      type: 'exterior',
      layerId: 'layer-walls',
      uValue: 0.24,
      levelId: 'dg',
    } as Wall);
  }

  const roof = {
    kind: 'gable' as const,
    pitch: 45,
    kneeHeight: 1,
    azimuth: 90,
    ridgeOffset: 0,
    uValue: 0.18,
    gableUValue: 0.28,
  };

  const detected = detectRooms({
    walls: wallsR,
    nodes: nodesR,
    openings: [],
    levelId: 'dg',
    defaultHeight: 2.5,
    northAngle: 0,
    roof,
  });
  check('Ein Dachraum erkannt', detected.length, 1);
  const dgRoom = detected[0];
  check('Raum kennt seine Dachkennwerte', Boolean(dgRoom.roof), true);
  check('Raumhöhe = mittlere lichte Höhe', dgRoom.height < 3.1 && dgRoom.height > 2.8, true);
  check('Volumen nicht Fläche × Geschosshöhe', Math.abs(dgRoom.volume - dgRoom.area * 2.5) > 10, true);

  const dgDoc = {
    meta: {
      name: 'Dach', createdAt: '', modifiedAt: '', northAngle: 0,
      designOutdoorTemperature: -12, designIndoorTemperature: 20, n50: 3,
      shielding: 'moderate' as const, unheatedTemperature: 10, groundTemperature: 10,
      thermalBridgeSupplement: 0.1, reheatFactor: 0,
    },
    levels: {
      dg: {
        id: 'dg', name: 'DG', order: 0, elevation: 0, height: 2.5,
        floorUValue: 0.9, floorBoundary: 'adjacent-room' as const,
        ceilingUValue: 0.2, ceilingBoundary: 'exterior' as const,
        roof,
      },
    },
    layers: {},
    nodes: nodesR,
    walls: Object.fromEntries(wallsR.map((w) => [w.id, w])),
    openings: {},
    fixtures: {},
    rooms: Object.fromEntries(detected.map((r) => [r.id, r])),
    constructions: {},
    diagnostics: { openEnds: [] },
    activeLevelId: 'dg',
  };

  const ex = buildRaviaExport(dgDoc as never);
  const r = ex.rooms[0];

  const roofSurfaces = r.surfaces.filter((s) => s.kind === 'roof');
  check('Dachflächen im Export', roofSurfaces.length, 2);
  check('Dachfläche geneigt', roofSurfaces[0].tilt, 45, 1e-9);
  check('Dach gegen Außenluft', roofSurfaces[0].boundary, 'exterior');
  check('Dach-U-Wert übernommen', roofSurfaces[0].uValue, 0.18, 1e-9);
  check(
    'Summe der Dachflächen ≈ Grundfläche / cos45°',
    roofSurfaces.reduce((sum, s) => sum + s.netArea, 0),
    r.area / Math.cos((45 * Math.PI) / 180),
    0.6,
  );

  // Keine waagerechte Decke mehr — sie wäre eine zweite, falsche Wahrheit.
  check('Keine waagerechte Decke unter der Schräge', r.surfaces.filter((s) => s.kind === 'ceiling').length, 0);

  const gables = r.surfaces.filter((s) => s.kind === 'gable');
  check('Zwei Giebel', gables.length, 2);
  check('Giebel senkrecht', gables[0].tilt, 90, 1e-9);
  check('Giebel-U-Wert eigenständig', gables[0].uValue, 0.28, 1e-9);
  check('Giebelfläche je Seite ≈ Dreieck', gables[0].grossArea > 12 && gables[0].grossArea < 17, true);

  // Traufwände dürfen keinen Giebelanteil bekommen.
  const walls4 = r.surfaces.filter((s) => s.kind === 'wall');
  check('Vier Wandflächen', walls4.length, 4);
  const eaveWalls = walls4.filter((s) => s.orientation === 'O' || s.orientation === 'W');
  check('Traufwände ≈ Länge × Kniestock', eaveWalls[0].grossArea < 11, true);

  check('Wohnfläche nach WoFlV ausgewiesen', (r.roof?.livingArea ?? 0) > 0, true);
  check('Wohnfläche kleiner als Grundfläche', (r.roof?.livingArea ?? 0) < r.area, true);
  check('Kniestock im Export', angabe(r.roof?.kneeHeight), 1);
  check('Neigung im Export', angabe(r.roof?.pitch), 45);
}

// ---------------------------------------------------------------------------
// Treppen, Schächte, Rohrnetz
// ---------------------------------------------------------------------------

console.log('\n▸ Treppen, Schächte und Rohrnetz');
{
  // Rechteck 8 × 6 m mit 24er Wänden ⇒ lichte Fläche 7,76 × 5,76 = 44,6976 m².
  const nodesV: Record<string, BimNode> = {};
  const wallsV: Wall[] = [];
  const pts = [
    { x: 0, y: 0 },
    { x: 8, y: 0 },
    { x: 8, y: 6 },
    { x: 0, y: 6 },
  ];
  const ids = pts.map((p, i) => {
    const n = { id: `t${i}`, x: p.x, y: p.y, levelId: 'eg' } as BimNode;
    nodesV[n.id] = n;
    return n;
  });
  for (let i = 0; i < 4; i++) {
    wallsV.push({
      id: `tw${i}`,
      a: ids[i].id,
      b: ids[(i + 1) % 4].id,
      thickness: 0.24,
      height: 2.5,
      type: 'exterior',
      layerId: 'layer-walls',
      uValue: 0.24,
      levelId: 'eg',
    } as Wall);
  }

  // Offene Treppe 1,00 × 3,60 m mittig, dazu ein Schacht 0,40 × 0,60 m.
  const stair = {
    id: 'v1',
    kind: 'stair-straight' as const,
    name: 'Treppe',
    levelId: 'eg',
    position: { x: 4, y: 3 },
    width: 1,
    length: 3.6,
    rotation: 0,
    steps: 15,
    deductsArea: true,
    openToAbove: true,
  };
  const shaft = {
    id: 'v2',
    kind: 'shaft' as const,
    name: 'Schacht',
    levelId: 'eg',
    position: { x: 1, y: 1 },
    width: 0.4,
    length: 0.6,
    rotation: 0,
    service: 'sanitary' as const,
    deductsArea: true,
    openToAbove: false,
  };

  const pipes = {
    p1: {
      id: 'p1',
      levelId: 'eg',
      service: 'heating-flow' as const,
      points: [
        { x: 1, y: 1 },
        { x: 1, y: 5 },
        { x: 7, y: 5 },
      ],
      nominalDiameter: 20,
      insulation: 20,
      elevation: 0.05,
    },
    p2: {
      id: 'p2',
      levelId: 'eg',
      service: 'heating-return' as const,
      points: [
        { x: 1.1, y: 1 },
        { x: 1.1, y: 5 },
      ],
      nominalDiameter: 20,
      insulation: 20,
      elevation: 0.05,
    },
    p3: {
      id: 'p3',
      levelId: 'eg',
      service: 'heating-flow' as const,
      points: [
        { x: 2, y: 2 },
        { x: 5, y: 2 },
      ],
      nominalDiameter: 15,
      insulation: 0,
      elevation: 0.05,
    },
  };

  const detected = detectRooms({
    walls: wallsV,
    nodes: nodesV,
    openings: [],
    levelId: 'eg',
    defaultHeight: 2.5,
    northAngle: 0,
  });
  check('Ein Raum erkannt', detected.length, 1);

  const vDoc = {
    meta: {
      name: 'Vertikal', createdAt: '', modifiedAt: '', northAngle: 0,
      designOutdoorTemperature: -12, designIndoorTemperature: 20, n50: 3,
      shielding: 'moderate' as const, unheatedTemperature: 10, groundTemperature: 10,
      thermalBridgeSupplement: 0.1, reheatFactor: 0,
    },
    levels: {
      eg: {
        id: 'eg', name: 'EG', order: 0, elevation: 0, height: 2.5,
        floorUValue: 0.3, floorBoundary: 'ground' as const,
        ceilingUValue: 0.2, ceilingBoundary: 'unheated' as const,
      },
    },
    layers: {},
    nodes: nodesV,
    walls: Object.fromEntries(wallsV.map((w) => [w.id, w])),
    openings: {},
    fixtures: {},
    verticals: { v1: stair, v2: shaft },
    pipes,
    rooms: Object.fromEntries(detected.map((r) => [r.id, r])),
    constructions: {},
    diagnostics: { openEnds: [] },
    activeLevelId: 'eg',
  };

  applyVerticalDeductions(detected, [stair, shaft] as never, ['eg']);
  const doc2 = vDoc;
  const room = detected[0];

  const stairArea = 1 * 3.6;
  const shaftArea = 0.4 * 0.6;
  check('Treppen- und Schachtfläche abgezogen', angabe(room.floorOpeningArea), stairArea + shaftArea, 0.005);
  check('Nur die offene Treppe nimmt die Decke weg', angabe(room.openToAboveArea), stairArea, 0.005);
  check(
    'Volumen um das Treppenloch kleiner',
    room.volume,
    (room.area - stairArea - shaftArea) * room.height,
    0.02,
  );

  const ex = buildRaviaExport(doc2 as never);
  const r = ex.rooms[0];
  check('Netto-Grundfläche im Export', angabe(r.netFloorArea), r.area - stairArea - shaftArea, 0.01);
  check('Treppenfläche im Export', angabe(r.floorOpeningArea), stairArea + shaftArea, 0.01);

  const floor = r.surfaces.find((s) => s.kind === 'floor')!;
  const ceiling = r.surfaces.find((s) => s.kind === 'ceiling')!;
  check('Bodenfläche ohne Treppenloch', floor.grossArea, r.area - stairArea - shaftArea, 0.01);
  // Der Schacht ist oben geschlossen, die Treppe nicht — die Decke verliert
  // deshalb nur die Treppenfläche.
  check('Deckenfläche nur ohne offene Treppe', ceiling.grossArea, r.area - stairArea, 0.01);

  check('Zwei vertikale Bauteile exportiert', ex.verticals.length, 2);
  const exStair = ex.verticals.find((v) => v.kind === 'stair-straight')!;
  check('Treppe kennt ihren Raum', angabe(exStair.roomId), room.id);
  check('Treppenfläche', exStair.area, stairArea, 0.005);
  check('Steigungen übernommen', angabe(exStair.steps), 15);

  // Rohrnetz: 4 + 6 = 10 m Vorlauf DN 20, 4 m Rücklauf DN 20, 3 m DN 15.
  check('Drei Leitungsabschnitte', ex.pipes.length, 3);
  check('Trassenlänge Abschnitt 1', ex.pipes.find((p) => p.id === 'p1')!.length, 10, 0.01);

  check('Längenauszug mit drei Zeilen', ex.pipeSchedule.length, 3);
  const flow20 = ex.pipeSchedule.find((e) => e.service === 'heating-flow' && e.nominalDiameter === 20)!;
  check('Vorlauf DN 20 gedämmt', flow20.length, 10, 0.01);
  check('Vorlauf DN 20 Dämmstärke', flow20.insulation, 20);
  const flow15 = ex.pipeSchedule.find((e) => e.service === 'heating-flow' && e.nominalDiameter === 15)!;
  check('Vorlauf DN 15 ungedämmt', flow15.length, 3, 0.01);
  check('DN 15 ohne Dämmung', flow15.insulation, 0);
  const ret = ex.pipeSchedule.find((e) => e.service === 'heating-return')!;
  check('Rücklauf DN 20', ret.length, 4, 0.01);

  // Die Rohgeometrie muss vollständig mitgehen, sonst ist die Exportdatei
  // als Projektdatei wertlos.
  check('Treppen in der Rohgeometrie', ex.geometry.verticals.length, 2);

  // Eine Treppe ins Obergeschoss nimmt *dort* ebenfalls Bodenfläche weg —
  // man läuft schließlich durch das Loch hindurch.
  const ogNodes = Object.fromEntries(
    Object.entries(nodesV).map(([id, nd]) => [`og-${id}`, { ...nd, id: `og-${id}`, levelId: 'og' }]),
  );
  const ogRooms = detectRooms({
    walls: wallsV.map((w) => ({ ...w, id: `og-${w.id}`, a: `og-${w.a}`, b: `og-${w.b}`, levelId: 'og' })),
    nodes: ogNodes,
    openings: [],
    levelId: 'og',
    defaultHeight: 2.5,
    northAngle: 0,
  });
  check('Raum im Obergeschoss erkannt', ogRooms.length, 1);
  applyVerticalDeductions(ogRooms, [stair, shaft] as never, ['eg', 'og']);
  check('Treppe wirkt auch im Geschoss darüber', (ogRooms[0].floorOpeningArea ?? 0) > 3, true);
  check('Decke oben aber nicht offen', ogRooms[0].openToAboveArea ?? 0, 0, 0.001);
  check('Leitungen in der Rohgeometrie', ex.geometry.pipes.length, 3);
}

// ---------------------------------------------------------------------------
// IFC-Export
// ---------------------------------------------------------------------------

console.log('\n▸ IFC4-Export');
{
  const nodesI: Record<string, BimNode> = {};
  const wallsI: Wall[] = [];
  const pts = [
    { x: 0, y: 0 },
    { x: 6, y: 0 },
    { x: 6, y: 4 },
    { x: 0, y: 4 },
  ];
  const ids = pts.map((p, i) => {
    const nd = { id: `i${i}`, x: p.x, y: p.y, levelId: 'eg' } as BimNode;
    nodesI[nd.id] = nd;
    return nd;
  });
  for (let i = 0; i < 4; i++) {
    wallsI.push({
      id: `iw${i}`,
      a: ids[i].id,
      b: ids[(i + 1) % 4].id,
      thickness: 0.365,
      height: 2.6,
      type: 'exterior',
      layerId: 'layer-walls',
      uValue: 0.24,
      levelId: 'eg',
    } as Wall);
  }
  const openingsI: Opening[] = [
    {
      id: 'io1',
      wallId: 'iw0',
      kind: 'window',
      distance: 3,
      width: 1.2,
      height: 1.4,
      sillHeight: 0.9,
      layerId: 'layer-openings',
      uValue: 1.1,
      gValue: 0.6,
    } as Opening,
    {
      id: 'io2',
      wallId: 'iw1',
      kind: 'door',
      distance: 2,
      width: 1.01,
      height: 2.01,
      sillHeight: 0,
      layerId: 'layer-openings',
      uValue: 1.8,
    } as Opening,
  ];

  const detected = detectRooms({
    walls: wallsI,
    nodes: nodesI,
    openings: openingsI,
    levelId: 'eg',
    defaultHeight: 2.6,
    northAngle: 0,
  });

  const ifcDoc = {
    meta: {
      name: 'IFC Test', createdAt: '', modifiedAt: '', northAngle: 0,
      designOutdoorTemperature: -12, designIndoorTemperature: 20, n50: 3,
      shielding: 'moderate' as const, unheatedTemperature: 10, groundTemperature: 10,
      thermalBridgeSupplement: 0.1, reheatFactor: 0,
    },
    levels: {
      eg: {
        id: 'eg', name: 'EG', order: 0, elevation: 0, height: 2.6,
        floorUValue: 0.3, floorBoundary: 'ground' as const,
        ceilingUValue: 0.2, ceilingBoundary: 'unheated' as const,
      },
      og: {
        id: 'og', name: 'OG', order: 1, elevation: 2.9, height: 2.6,
        floorUValue: 0.9, floorBoundary: 'adjacent-room' as const,
        ceilingUValue: 0.2, ceilingBoundary: 'exterior' as const,
        roof: {
          kind: 'gable' as const, pitch: 40, kneeHeight: 1, azimuth: 90,
          ridgeOffset: 0, uValue: 0.18, gableUValue: 0.24,
        },
      },
    },
    layers: {},
    nodes: nodesI,
    walls: Object.fromEntries(wallsI.map((w) => [w.id, w])),
    openings: Object.fromEntries(openingsI.map((o) => [o.id, o])),
    fixtures: {},
    roofOpenings: {
      sky: {
        id: 'sky', levelId: 'og', kind: 'skylight' as const,
        position: { x: 3, y: 2 }, width: 0.78, depth: 1.18, uValue: 1.3, gValue: 0.5,
      },
    },
    verticals: {
      sv: {
        id: 'sv', kind: 'stair-straight' as const, name: 'Treppe', levelId: 'eg',
        position: { x: 3, y: 2 }, width: 1, length: 3.4, rotation: 0, steps: 16,
        deductsArea: true, openToAbove: true,
      },
    },
    pipes: {},
    annotations: {},
    rooms: Object.fromEntries(detected.map((r) => [r.id, r])),
    constructions: {},
    diagnostics: { openEnds: [] },
    activeLevelId: 'eg',
  };

  const ifc = buildIfc(ifcDoc as never, { timestamp: '2026-08-18T10:00:00Z' });
  const has = (token: string) => ifc.includes(token);
  // Gezählt wird über den Entity-Namen am Zeilenanfang — kein Regex-Basteln
  // mit Klammern, das im gebündelten Skript nur schwer zu lesen wäre.
  const count = (name: string) =>
    ifc.split('\n').filter((l) => l.startsWith('#') && l.slice(l.indexOf('=') + 1).startsWith(name + '(')).length;

  // Struktur nach ISO 10303-21
  check('STEP-Kopf', ifc.startsWith('ISO-10303-21;'), true);
  check('STEP-Ende', ifc.trimEnd().endsWith('END-ISO-10303-21;'), true);
  check('Schema IFC4', has("FILE_SCHEMA(('IFC4'))"), true);
  check('DATA-Sektion geschlossen', (ifc.match(/ENDSEC;/g) ?? []).length, 2);

  // Pflicht-Hierarchie
  check('IfcProject', count('IFCPROJECT'), 1);
  check('IfcSite', count('IFCSITE'), 1);
  check('IfcBuilding', count('IFCBUILDING'), 1);
  check('Zwei Geschosse', count('IFCBUILDINGSTOREY'), 2);
  check('Einheiten zugewiesen', has('IFCUNITASSIGNMENT'), true);
  check('Meter als Längeneinheit', has('.LENGTHUNIT.,$,.METRE.'), true);

  // Bauteile
  check('Vier Wände', count('IFCWALLSTANDARDCASE'), 4);
  check('Zwei Öffnungen', count('IFCOPENINGELEMENT'), 2);
  check('Öffnungen schneiden die Wand', count('IFCRELVOIDSELEMENT'), 2);
  check('Fassadenfenster gefüllt', count('IFCWINDOW') >= 1, true);
  check('Tür gefüllt', count('IFCDOOR'), 1);
  check('Füllungen verknüpft', count('IFCRELFILLSELEMENT'), 2);
  check('Raum als IfcSpace', count('IFCSPACE'), detected.length);
  check('Bodenplatte je Raum', count('IFCSLAB'), detected.length);
  check('Treppe exportiert', count('IFCSTAIR'), 1);
  check('Dachfenster als IfcWindow', count('IFCWINDOW'), 2);
  check('Dach exportiert', count('IFCROOF'), 1);
  check('Mengen am Raum', has("IFCQUANTITYAREA('NetFloorArea'"), true);

  // Jede Entity-Zeile muss auf ';' enden und mit '#' beginnen — sonst ist die
  // Datei für jeden STEP-Parser unlesbar.
  const dataLines = ifc.split('\n').filter((l) => l.startsWith('#'));
  check('Entity-Zeilen vorhanden', dataLines.length > 60, true);
  check('Alle Entities korrekt terminiert', dataLines.every((l) => l.endsWith(';')), true);
  check('Keine leeren Entities', dataLines.every((l) => /^#\d+=[A-Z]/.test(l)), true);

  // Referenzen müssen auf existierende IDs zeigen.
  const defined = new Set(dataLines.map((l) => l.slice(0, l.indexOf('='))));
  const referenced = new Set<string>();
  for (const line of dataLines) {
    const body = line.slice(line.indexOf('=') + 1);
    for (const m of body.matchAll(/#\d+/g)) referenced.add(m[0]);
  }
  const dangling = [...referenced].filter((r) => !defined.has(r));
  check('Keine baumelnden Referenzen', dangling.length, 0);
  check('IDs eindeutig', defined.size, dataLines.length);

  // GUIDs: 22 Zeichen aus dem IFC-Alphabet, und stabil über zwei Läufe.
  const guids = [...ifc.matchAll(/'([0-9A-Za-z_$]{22})'/g)].map((m) => m[1]);
  check('GUIDs erzeugt', guids.length > 10, true);
  check('GUID-Länge 22', guids.every((g) => g.length === 22), true);
  const again = buildIfc(ifcDoc as never, { timestamp: '2026-08-18T10:00:00Z' });
  check('Export ist deterministisch', again === ifc, true);

  // Das erste GUID-Zeichen trägt nur zwei Bit — Werte über 3 sind ungültig.
  check('GUID beginnt mit 0–3', guids.every((g) => '0123'.includes(g[0])), true);

  /*
   * --- Sonderzeichen ------------------------------------------------------
   *
   * ISO 10303-21 lässt in einer Zeichenkette nur druckbares ASCII zu. Bis
   * 1.30.0 schrieb dieser Export den Umlaut roh als UTF-8 hinein — die
   * meisten Betrachter verzeihen das, ein strenger Prüfer weist die Datei
   * ab, und ein Leser mit anderer Zeichensatzannahme macht „KÃ¼che" daraus.
   *
   * Geprüft wird an einem Projektnamen, der alles Kritische enthält: einen
   * Umlaut, zwei Sonderzeichen **nebeneinander** (sie gehören in *eine*
   * Umschriftfolge), einen Apostroph (er wird verdoppelt) und einen
   * Rückwärtsstrich (auch). Der Rundlauf über den eigenen Import ist die
   * eigentliche Aussage: was hinausgeht, muss unverändert zurückkommen.
   */
  {
    const heikel = "Küche & Straße, 3'er \\ Gang";
    const mitUmlaut = buildIfc(
      { ...ifcDoc, meta: { ...ifcDoc.meta, name: heikel } } as never,
      { timestamp: '2026-08-18T10:00:00Z' },
    );
    check(
      'Die ganze Datei ist druckbares ASCII',
      /^[\x20-\x7E\r\n]*$/.test(mitUmlaut),
      true,
    );
    check('Der Umlaut steht als Umschrift da', mitUmlaut.includes('K\\X2\\00FC\\X0\\che'), true);
    // ü und ß stehen in „Straße" nicht nebeneinander; „ße" schon nicht mehr.
    // Nebeneinander steht nichts — geprüft wird die Zusammenfassung deshalb
    // an einem eigenen Namen weiter unten.
    check('Der Apostroph ist verdoppelt', mitUmlaut.includes("3''er"), true);
    check('Der Rückwärtsstrich ist verdoppelt', mitUmlaut.includes('\\\\'), true);
    check('Auch der Dateikopf trägt die Umschrift',
      /FILE_NAME\('[\x20-\x7E]*'/.test(mitUmlaut), true);

    const zurueck = importIfc(mitUmlaut);
    check('Der Name kommt unverändert zurück', zurueck.projectName ?? '', heikel);

    // Zwei Sonderzeichen nebeneinander gehören in **eine** Folge — dafür
    // ist `\X2\…\X0\` gedacht, und der Leser erwartet es so.
    const zusammen = buildIfc(
      { ...ifcDoc, meta: { ...ifcDoc.meta, name: 'Grüße' } } as never,
      { timestamp: '2026-08-18T10:00:00Z' },
    );
    check('Zwei Sonderzeichen in einer Folge', zusammen.includes('Gr\\X2\\00FC00DF\\X0\\e'), true);
    check('Auch das kommt zurück', importIfc(zusammen).projectName ?? '', 'Grüße');

    // Gegenprobe: ein reiner ASCII-Name bleibt buchstäblich unberührt.
    // Gegenprobe: wo nichts umzuschreiben ist, wird nichts angefasst. Der
    // Name steht dann buchstäblich in der Datei — auch im Kopf.
    const schlicht = buildIfc(
      { ...ifcDoc, meta: { ...ifcDoc.meta, name: 'Haus Nord 12' } } as never,
      { timestamp: '2026-08-18T10:00:00Z' },
    );
    check('Ohne Sonderzeichen bleibt der Name buchstäblich', schlicht.includes("'Haus Nord 12'"), true);
    check('Und auch im Dateikopf', schlicht.includes("FILE_NAME('Haus Nord 12.ifc'"), true);
  }

  // In ISO 10303-21 ist `1` ein INTEGER. An einer REAL-Stelle — Koordinate,
  // Richtung, Maß — muss der Punkt stehen: `1.`. Genau daran scheitern
  // selbstgebaute IFC-Dateien am häufigsten.
  const realLists = [...ifc.matchAll(/IFC(?:CARTESIANPOINT|DIRECTION)\(\(([^)]*)\)\)/g)];
  check('Punkte und Richtungen vorhanden', realLists.length > 20, true);
  const badReal = realLists
    .flatMap((m) => m[1].split(','))
    .find((v) => v.trim().length > 0 && !v.includes('.'));
  check('Alle Koordinaten sind STEP-REAL', badReal ?? 'ok', 'ok');

  const extruded = ifc
    .split('\n')
    .filter((l) => l.includes('IFCEXTRUDEDAREASOLID('))
    .map((l) => {
      const inner = l.slice(l.indexOf('IFCEXTRUDEDAREASOLID(') + 21, l.lastIndexOf(')'));
      const parts = inner.split(',');
      return parts[parts.length - 1];
    });
  check('Extrusionstiefen vorhanden', extruded.length >= 8, true);
  check('Extrusionstiefen sind REAL', extruded.every((v) => v.includes('.')), true);
}

// ---------------------------------------------------------------------------
// Gauben und Dachflächenfenster
// ---------------------------------------------------------------------------

console.log('\n▸ Gauben und Dachflächenfenster');
{
  // Dieselbe Ausgangslage wie oben: Rechteck 8 × 10 m, Satteldach 45°,
  // Kniestock 1,00 m, Fall nach Osten ⇒ Firsthöhe 5,00 m.
  const rect = [
    { x: -4, y: -5 },
    { x: 4, y: -5 },
    { x: 4, y: 5 },
    { x: -4, y: 5 },
  ];
  const roof = {
    kind: 'gable' as const,
    pitch: 45,
    kneeHeight: 1,
    azimuth: 90,
    ridgeOffset: 0,
    uValue: 0.2,
    gableUValue: 0.24,
  };

  // Gaube auf der Ostseite: Mitte bei x = 2,5 (Traufabstand 1,5 m),
  // 2,00 m breit, 1,50 m tief, lichte Front 2,20 m.
  const dormer = {
    id: 'd1',
    levelId: 'dg',
    kind: 'dormer-shed' as const,
    position: { x: 2.5, y: 0 },
    width: 2,
    depth: 1.5,
    frontHeight: 2.2,
    frontWindowArea: 1.6,
    uValue: 0.2,
    frontUValue: 0.24,
  };

  const plain = buildRoofFrame(roof, rect)!;
  const withDormer = buildRoofFrame(roof, rect, [dormer])!;

  // Ohne Gaube liegt die Decke an der Frontkante (x = 3,25) bei 5 − 3,25 = 1,75 m.
  const frontPoint = { x: 3.25, y: 0 };
  check('Ohne Gaube: Höhe an der Frontkante', roofHeightAt(plain, frontPoint), 1.75, 1e-9);
  check('Mit Gaube: Front auf 2,20 m', roofHeightAt(withDormer, frontPoint), 2.2, 0.02);
  check('Reine Dachebene bleibt unverändert', baseRoofHeightAt(withDormer, frontPoint), 1.75, 1e-9);

  // An der Rückkante (x = 1,75) schließt die Gaube ans Hauptdach an:
  // dort ist das Dach 5 − 1,75 = 3,25 m hoch, also höher als die Gaube.
  check('Hinter der Gaube gilt wieder das Hauptdach', roofHeightAt(withDormer, { x: 1.75, y: 0 }), 3.25, 0.02);
  check('Neben der Gaube unverändert', roofHeightAt(withDormer, { x: 3.25, y: 3 }), 1.75, 1e-9);

  const before = measureRoomUnderRoof(plain, rect, 0.02);
  const after = measureRoomUnderRoof(withDormer, rect, 0.02);

  check('Gaube schafft Volumen', after.volume > before.volume, true);
  check('Gaubenvolumen ausgewiesen', after.dormerVolume > 0.5, true);
  check(
    'Zugewinn = ausgewiesenes Gaubenvolumen',
    after.volume - before.volume,
    after.dormerVolume,
    0.05,
  );
  check('Gaube schafft Wohnfläche', after.livingArea > before.livingArea, true);
  check('Gaubenfront ausgewiesen', after.dormerFrontArea > 0.5, true);
  check('Gaubenwangen ausgewiesen', after.dormerCheekArea > 0.1, true);
  check('Gaubendach ausgewiesen', after.dormerRoofArea > 1, true);

  // Frontfläche von Hand: 2,00 m breit × (2,20 − 1,75) m = 0,90 m².
  check('Frontfläche stimmt rechnerisch', after.dormerFrontArea, 0.9, 0.02);

  // Dachflächenfenster 78 × 118 cm.
  const skylight = {
    id: 's1',
    levelId: 'dg',
    kind: 'skylight' as const,
    position: { x: -2, y: 2 },
    width: 0.78,
    depth: 1.18,
    uValue: 1.3,
    gValue: 0.5,
  };
  const withSkylight = buildRoofFrame(roof, rect, [skylight])!;
  check('Dachfenster ändert die Höhe nicht', roofHeightAt(withSkylight, { x: -2, y: 2 }), 3, 1e-9);
  const sky = measureRoomUnderRoof(withSkylight, rect, 0.02);
  check('Glasfläche ausgewiesen', sky.skylightArea, 0.78 * 1.18, 0.005);
  check('Volumen unverändert', sky.volume, before.volume, 0.05);

  // --- Weg über Raumerkennung und Export ---------------------------------
  const nodesD: Record<string, BimNode> = {};
  const wallsD: Wall[] = [];
  const ids = rect.map((p, i) => {
    const nd = { id: `d${i}`, x: p.x, y: p.y, levelId: 'dg' } as BimNode;
    nodesD[nd.id] = nd;
    return nd;
  });
  for (let i = 0; i < 4; i++) {
    wallsD.push({
      id: `dw${i}`,
      a: ids[i].id,
      b: ids[(i + 1) % 4].id,
      thickness: 0.24,
      height: 1,
      type: 'exterior',
      layerId: 'layer-walls',
      uValue: 0.24,
      levelId: 'dg',
    } as Wall);
  }

  const detected = detectRooms({
    walls: wallsD,
    nodes: nodesD,
    openings: [],
    levelId: 'dg',
    defaultHeight: 2.5,
    northAngle: 0,
    roof,
    roofOpenings: [dormer, skylight] as never,
  });
  check('Ein Dachraum', detected.length, 1);

  const dgDoc = {
    meta: {
      name: 'Gaube', createdAt: '', modifiedAt: '', northAngle: 0,
      designOutdoorTemperature: -12, designIndoorTemperature: 20, n50: 3,
      shielding: 'moderate' as const, unheatedTemperature: 10, groundTemperature: 10,
      thermalBridgeSupplement: 0.1, reheatFactor: 0,
    },
    levels: {
      dg: {
        id: 'dg', name: 'DG', order: 0, elevation: 0, height: 2.5,
        floorUValue: 0.9, floorBoundary: 'adjacent-room' as const,
        ceilingUValue: 0.2, ceilingBoundary: 'exterior' as const,
        roof,
      },
    },
    layers: {},
    nodes: nodesD,
    walls: Object.fromEntries(wallsD.map((w) => [w.id, w])),
    openings: {},
    fixtures: {},
    verticals: {},
    pipes: {},
    annotations: {},
    roofOpenings: { d1: dormer, s1: skylight },
    rooms: Object.fromEntries(detected.map((r) => [r.id, r])),
    constructions: {},
    diagnostics: { openEnds: [] },
    activeLevelId: 'dg',
  };

  const ex = buildRaviaExport(dgDoc as never);
  const r = ex.rooms[0];

  // Das Dachfenster sitzt bei x = −2, also auf der *West*fläche (Azimut 270).
  const west = r.surfaces.find((s) => s.kind === 'roof' && s.azimuth === 270)!;
  check('Westliche Dachfläche vorhanden', Boolean(west), true);
  check('Dachfenster auf der Westfläche', west.openings.length, 1);
  check('Dachfenster geneigt wie das Dach', west.tilt, 45, 1e-9);
  check('Dachfenster mit g-Wert', angabe(west.openings[0].gValue), 0.5);
  check('Netto = Brutto − Glas', west.netArea, west.grossArea - west.openings[0].area, 0.02);

  // Die Ostfläche trägt die Gaube — dort darf kein Fenster liegen.
  const east = r.surfaces.find((s) => s.kind === 'roof' && s.azimuth === 90 && s.id.includes('-roof-'))!;
  check('Ostfläche ohne Dachfenster', east.openings.length, 0);

  const front = r.surfaces.find((s) => s.id === 'd1-front')!;
  check('Gaubenfront als Wandbauteil', front.kind, 'wall');
  check('Gaubenfront senkrecht', front.tilt, 90, 1e-9);
  check('Gaubenfront nach Osten', angabe(front.orientation), 'O');
  check('Gaubenfront verglast', front.openings.length, 1);
  check('Front-U-Wert eigenständig', front.uValue, 0.24, 1e-9);

  check('Gaubenwangen exportiert', Boolean(r.surfaces.find((s) => s.id === 'd1-cheeks')), true);
  const dormerRoof = r.surfaces.find((s) => s.id === 'd1-roof')!;
  check('Gaubendach exportiert', Boolean(dormerRoof), true);
  check('Gaubendach flacher als das Hauptdach', dormerRoof.tilt < 45, true);

  check('Fensterfläche im Raum aufsummiert', r.totalWindowArea > 0.9, true);
  check('Dachfenster im Raum-Kennwert', angabe(r.roof?.skylightArea), 0.78 * 1.18, 0.01);
  check('Gaubenvolumen im Raum-Kennwert', (r.roof?.dormerVolume ?? 0) > 0.5, true);
  check('Dachöffnungen in der Rohgeometrie', ex.geometry.roofOpenings.length, 2);

  // Spiegelbild: dieselbe Gaube auf der *West*seite muss genauso rechnen.
  // Ohne Seitenvorzeichen zeigte ihre Front in den Berg hinein und alle
  // Flächen kämen als Null heraus.
  const westDormer = { ...dormer, id: 'd2', position: { x: -2.5, y: 0 } };
  const westFrame = buildRoofFrame(roof, rect, [westDormer])!;
  check('Westgaube: Front auf 2,20 m', roofHeightAt(westFrame, { x: -3.25, y: 0 }), 2.2, 0.02);
  check(
    'Westgaube: hinten wieder Hauptdach',
    roofHeightAt(westFrame, { x: -1.75, y: 0 }),
    3.25,
    0.02,
  );
  const westMetrics = measureRoomUnderRoof(westFrame, rect, 0.02);
  check('Westgaube: Front gleich groß', westMetrics.dormerFrontArea, after.dormerFrontArea, 0.02);
  check('Westgaube: Volumen gleich groß', westMetrics.dormerVolume, after.dormerVolume, 0.05);
}

// ---------------------------------------------------------------------------
// IFC-Import
// ---------------------------------------------------------------------------

console.log('\n▸ IFC-Import');
{
  // --- Der Parser für sich ------------------------------------------------
  const sample = [
    'ISO-10303-21;',
    'HEADER;',
    "FILE_SCHEMA(('IFC4'));",
    'ENDSEC;',
    'DATA;',
    "#1=IFCPROJECT('abc',$,'Haus mit ''Anbau''',$,$,$,$,$);",
    '#2=IFCCARTESIANPOINT((1.5,-2.,0.));',
    '#3=IFCDIRECTION((0.,1.,0.));',
    '#4=IFCPOLYLINE((#2,#2,',
    '  #2));',
    "#5=IFCPROPERTYSINGLEVALUE('Hinweis',$,IFCTEXT('Klammer ) und Semikolon ; im Text'),$);",
    'ENDSEC;',
    'END-ISO-10303-21;',
  ].join('\n');

  const parsed = parseStep(sample);
  check('Entities erkannt', parsed.size, 5);
  check('Typ gelesen', parsed.get(1)!.type, 'IFCPROJECT');
  check('Verdoppelter Apostroph entschärft', stepText(parsed.get(1)!.attributes[2]), "Haus mit 'Anbau'");
  check('Koordinaten als Zahlen', JSON.stringify(parsed.get(2)!.attributes[0]), '[1.5,-2,0]');
  check('Mehrzeilige Entity zusammengefügt', (parsed.get(4)!.attributes[0] as unknown[]).length, 3);
  check('Semikolon im Text bricht nicht ab', parsed.get(5)!.type, 'IFCPROPERTYSINGLEVALUE');
  check(
    'Typisierter Wert ausgepackt',
    stepText(parsed.get(5)!.attributes[2]),
    'Klammer ) und Semikolon ; im Text',
  );

  // --- Rundlauf über den eigenen Export ------------------------------------
  // Der schärfste Test für einen Importer ist der eigene Export: was
  // hineingeschrieben wurde, muss unverändert wieder herauskommen.
  const nodesR: Record<string, BimNode> = {};
  const wallsR: Wall[] = [];
  const pts = [
    { x: 0, y: 0 },
    { x: 9, y: 0 },
    { x: 9, y: 6 },
    { x: 0, y: 6 },
  ];
  const ids = pts.map((p, i) => {
    const nd = { id: `q${i}`, x: p.x, y: p.y, levelId: 'eg' } as BimNode;
    nodesR[nd.id] = nd;
    return nd;
  });
  for (let i = 0; i < 4; i++) {
    wallsR.push({
      id: `qw${i}`,
      a: ids[i].id,
      b: ids[(i + 1) % 4].id,
      thickness: 0.365,
      height: 2.6,
      type: 'exterior',
      layerId: 'layer-walls',
      uValue: 0.24,
      levelId: 'eg',
    } as Wall);
  }
  const openingsR: Opening[] = [
    {
      id: 'qo1', wallId: 'qw0', kind: 'window', distance: 4.5, width: 1.2, height: 1.4,
      sillHeight: 0.9, layerId: 'layer-openings', uValue: 1.1, gValue: 0.6,
    } as Opening,
    {
      id: 'qo2', wallId: 'qw1', kind: 'door', distance: 3, width: 1.01, height: 2.01,
      sillHeight: 0, layerId: 'layer-openings', uValue: 1.8,
    } as Opening,
  ];

  const detectedR = detectRooms({
    walls: wallsR, nodes: nodesR, openings: openingsR,
    levelId: 'eg', defaultHeight: 2.6, northAngle: 0,
  });

  const srcDoc = {
    meta: {
      name: 'Rundlauf', createdAt: '', modifiedAt: '', northAngle: 0,
      designOutdoorTemperature: -12, designIndoorTemperature: 20, n50: 3,
      shielding: 'moderate' as const, unheatedTemperature: 10, groundTemperature: 10,
      thermalBridgeSupplement: 0.1, reheatFactor: 0,
    },
    levels: {
      eg: {
        id: 'eg', name: 'Erdgeschoss', order: 0, elevation: 0, height: 2.6,
        floorUValue: 0.3, floorBoundary: 'ground' as const,
        ceilingUValue: 0.2, ceilingBoundary: 'unheated' as const,
      },
      og: {
        id: 'og', name: 'Obergeschoss', order: 1, elevation: 2.9, height: 2.6,
        floorUValue: 0.9, floorBoundary: 'adjacent-room' as const,
        ceilingUValue: 0.2, ceilingBoundary: 'exterior' as const,
      },
    },
    layers: {},
    nodes: nodesR,
    walls: Object.fromEntries(wallsR.map((w) => [w.id, w])),
    openings: Object.fromEntries(openingsR.map((o) => [o.id, o])),
    fixtures: {}, verticals: {}, pipes: {}, annotations: {}, roofOpenings: {},
    rooms: Object.fromEntries(detectedR.map((r) => [r.id, r])),
    constructions: {},
    diagnostics: { openEnds: [] },
    activeLevelId: 'eg',
  };

  const ifcText = buildIfc(srcDoc as never, { timestamp: '2026-08-18T12:00:00Z' });
  const back = importIfc(ifcText);

  check('Import erfolgreich', back.ok, true);
  check('Schema erkannt', angabe(back.schema), 'IFC4');
  check('Projektname übernommen', angabe(back.projectName), 'Rundlauf');
  check('Beide Geschosse gelesen', back.levels.length, 2);
  check('Geschossnamen erhalten', back.levels.map((l) => l.name).join('/'), 'Erdgeschoss/Obergeschoss');
  check('Höhenlage des OG', back.levels[1].elevation, 2.9, 1e-6);
  check('Geschosshöhe abgeleitet', back.levels[0].height, 2.6, 0.05);

  check('Alle vier Wände zurück', back.walls.length, 4);
  check('Wanddicke erhalten', back.walls[0].thickness, 0.365, 0.002);
  check('Wandhöhe erhalten', back.walls[0].height, 2.6, 0.002);
  check('Wände dem Geschoss zugeordnet', back.walls.every((w) => w.levelId === back.levels[0].id), true);

  // Die Achsen müssen wieder das 9 × 6 m große Rechteck ergeben.
  const xs = back.nodes.map((n) => n.x);
  const ys = back.nodes.map((n) => n.y);
  check('Ausdehnung in x', Math.max(...xs) - Math.min(...xs), 9, 0.02);
  check('Ausdehnung in y', Math.max(...ys) - Math.min(...ys), 6, 0.02);
  check('Vier Eckknoten', back.nodes.length, 4);

  check('Beide Öffnungen zurück', back.openings.length, 2);
  const win = back.openings.find((o) => o.kind === 'window')!;
  const door = back.openings.find((o) => o.kind === 'door')!;
  check('Fenster als Fenster erkannt', Boolean(win), true);
  check('Tür als Tür erkannt', Boolean(door), true);
  check('Fensterbreite erhalten', win.width, 1.2, 0.02);
  check('Fensterhöhe erhalten', win.height, 1.4, 0.02);
  check('Brüstungshöhe erhalten', win.sillHeight, 0.9, 0.02);
  check('Fensterlage in der Wand', win.distance, 4.5, 0.05);
  check('Türhöhe erhalten', door.height, 2.01, 0.02);

  // Aus den importierten Wänden muss sich derselbe Raum wieder erkennen lassen.
  const reNodes: Record<string, BimNode> = Object.fromEntries(back.nodes.map((n) => [n.id, n]));
  const reRooms = detectRooms({
    walls: back.walls,
    nodes: reNodes,
    openings: back.openings,
    levelId: back.levels[0].id,
    defaultHeight: 2.6,
    northAngle: 0,
  });
  check('Raum aus Importgeometrie erkannt', reRooms.length, 1);
  check('Fläche stimmt mit dem Original', reRooms[0].area, detectedR[0].area, 0.05);

  // --- Fehlerfälle ---------------------------------------------------------
  check('Fremde Datei abgewiesen', importIfc('{"hallo":"welt"}').ok, false);
  check(
    'Fehlermeldung nennt den Grund',
    /keine STEP/i.test(importIfc('{"hallo":"welt"}').message),
    true,
  );
  const emptyIfc = importIfc("ISO-10303-21;\nHEADER;\nFILE_SCHEMA(('IFC4'));\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n");
  check('Leere Datei liefert kein Modell', emptyIfc.ok, false);
}

// ---------------------------------------------------------------------------
// Giebelgaube, Treppenformen, Einbettungs-Kurzfassung
// ---------------------------------------------------------------------------

console.log('\n▸ Giebelgaube');
{
  const rect = [
    { x: -4, y: -5 },
    { x: 4, y: -5 },
    { x: 4, y: 5 },
    { x: -4, y: 5 },
  ];
  const roof = {
    kind: 'gable' as const, pitch: 45, kneeHeight: 1, azimuth: 90,
    ridgeOffset: 0, uValue: 0.2, gableUValue: 0.24,
  };
  const base = {
    id: 'g1', levelId: 'dg', position: { x: 2.5, y: 0 },
    width: 2, depth: 1.5, frontHeight: 2.2, frontWindowArea: 1.2,
    uValue: 0.2, frontUValue: 0.24,
  };
  const shed = { ...base, kind: 'dormer-shed' as const };
  // Giebelspitze 0,70 m über der Traufe der Gaube.
  const gable = { ...base, id: 'g2', kind: 'dormer-gable' as const, gableRise: 0.7 };

  const shedFrame = buildRoofFrame(roof, rect, [shed])!;
  const gableFrame = buildRoofFrame(roof, rect, [gable])!;

  // In der Mitte der Front steht die Giebelgaube um die volle Giebelhöhe
  // höher, an der Wange sind beide gleich hoch.
  const mid = { x: 3.25, y: 0 };
  const edge = { x: 3.25, y: 0.99 };
  check('Schleppgaube: Front waagerecht', roofHeightAt(shedFrame, mid), 2.2, 0.02);
  check('Giebelgaube: Spitze in der Mitte', roofHeightAt(gableFrame, mid), 2.9, 0.02);
  check('Giebelgaube: an der Wange wie die Schleppgaube', roofHeightAt(gableFrame, edge), 2.2, 0.05);

  const shedM = measureRoomUnderRoof(shedFrame, rect, 0.02);
  const gableM = measureRoomUnderRoof(gableFrame, rect, 0.02);

  // Front: Rechteck 2,00 × 0,45 = 0,90 m² plus Dreieck ½ · 2,00 · 0,70 = 0,70 m².
  check('Schleppgaube: Frontfläche', shedM.dormerFrontArea, 0.9, 0.02);
  check('Giebelgaube: Front mit Dreieck', gableM.dormerFrontArea, 1.6, 0.02);
  check('Giebelgaube: mehr Volumen', gableM.dormerVolume > shedM.dormerVolume, true);
  check('Giebelgaube: größeres Dach', gableM.dormerRoofArea > shedM.dormerRoofArea, true);
  check('Giebelgaube: mehr Wohnfläche', gableM.livingArea >= shedM.livingArea, true);
}

console.log('\n▸ Treppenformen');
{
  const make = (kind: string) =>
    ({
      id: 't', kind, name: 'Treppe', levelId: 'eg',
      position: { x: 0, y: 0 }, width: 1.2, length: 4, rotation: 0, steps: 16,
      deductsArea: true, openToAbove: true,
    }) as never;

  const straight = stairRunLength(make('stair-straight'));
  const lRun = stairRunLength(make('stair-l'));
  const uRun = stairRunLength(make('stair-u'));
  const spiral = stairRunLength(make('stair-spiral'));

  check('Gerade Treppe: Lauflinie = Bauteillänge', straight, 4, 1e-6);
  // Viertelgewendelt: 4 − 0,6 längs plus 1,2 − 0,6 quer = 4,0 m.
  check('Viertelgewendelt: Lauflinie', lRun, 4, 0.02);
  // Halbgewendelt: zwei Läufe à 3,7 m plus das Podest quer (0,6 m).
  check('Halbgewendelt: deutlich länger als das Bauteil', uRun > 7, true);
  check('Wendeltreppe: Lauflinie auf dem Kreis', spiral > 2 && spiral < 5, true);

  // Der Auftritt folgt der Lauflinie. Bei der halbgewendelten Treppe wäre er
  // sonst weniger als halb so groß — und damit rechnerisch unbegehbar.
  const going = (run: number) => run / 15;
  check('Gerade: Auftritt', going(straight), 0.267, 0.01);
  check('Halbgewendelt: Auftritt bleibt begehbar', going(uRun) > 0.23, true);

  // Die Lauflinie muss innerhalb des Bauteils bleiben.
  for (const kind of ['stair-straight', 'stair-l', 'stair-u', 'stair-spiral']) {
    const v = make(kind);
    const inside = stairPath(v).every(
      (p) => Math.abs(p.x) <= 4 / 2 + 1e-6 && Math.abs(p.y) <= 1.2 / 2 + 1e-6,
    );
    check(`${kind}: Lauflinie liegt im Bauteil`, inside, true);
  }
}

console.log('\n▸ Einbettungs-Kurzfassung');
{
  // Dieselbe Kurzfassung, die RaVia über die Schnittstelle bekommt.
  const nodesS: Record<string, BimNode> = {};
  const wallsS: Wall[] = [];
  const pts = [
    { x: 0, y: 0 },
    { x: 6, y: 0 },
    { x: 6, y: 4 },
    { x: 0, y: 4 },
  ];
  const ids = pts.map((p, i) => {
    const nd = { id: `e${i}`, x: p.x, y: p.y, levelId: 'eg' } as BimNode;
    nodesS[nd.id] = nd;
    return nd;
  });
  for (let i = 0; i < 4; i++) {
    wallsS.push({
      id: `ew${i}`, a: ids[i].id, b: ids[(i + 1) % 4].id,
      thickness: 0.24, height: 2.5, type: 'exterior',
      layerId: 'layer-walls', uValue: 0.24, levelId: 'eg',
    } as Wall);
  }
  const detectedS = detectRooms({
    walls: wallsS, nodes: nodesS, openings: [],
    levelId: 'eg', defaultHeight: 2.5, northAngle: 0,
  });

  const sumDoc = {
    meta: {
      name: 'Kurzfassung', createdAt: '', modifiedAt: '', northAngle: 0,
      designOutdoorTemperature: -12, designIndoorTemperature: 20, n50: 3,
      shielding: 'moderate' as const, unheatedTemperature: 10, groundTemperature: 10,
      thermalBridgeSupplement: 0.1, reheatFactor: 0,
    },
    levels: {
      eg: {
        id: 'eg', name: 'EG', order: 0, elevation: 0, height: 2.5,
        floorUValue: 0.3, floorBoundary: 'ground' as const,
        ceilingUValue: 0.2, ceilingBoundary: 'unheated' as const,
      },
    },
    layers: {},
    nodes: nodesS,
    walls: Object.fromEntries(wallsS.map((w) => [w.id, w])),
    openings: {},
    fixtures: {
      hk: {
        id: 'hk', type: 'radiator', category: 'heating', levelId: 'eg',
        position: { x: 3, y: 0.3 }, rotation: 0, length: 1, depth: 0.1,
        elevation: 0.15, params: { powerW: 1200 },
      },
    },
    verticals: {}, pipes: {}, annotations: {}, roofOpenings: {},
    rooms: Object.fromEntries(detectedS.map((r) => [r.id, r])),
    constructions: {},
    diagnostics: { openEnds: [] },
    activeLevelId: 'eg',
  };

  const summary = buildSummary(sumDoc as never);
  check('Projektname', summary.projectName, 'Kurzfassung');
  check('Ein Geschoss', summary.levels, 1);
  check('Ein Raum', summary.rooms, 1);
  check('Vier Wände', summary.walls, 4);
  check('Nutzfläche = Raumfläche', summary.netFloorArea, detectedS[0].area, 0.02);
  check('Volumen', summary.netVolume, detectedS[0].volume, 0.02);
  check('Heizleistung aufsummiert', summary.installedHeatingPower, 1200);
  check('Rechenfähig', summary.ready, true);
  check('Keine Fehler', summary.errors, 0);
}


// ---------------------------------------------------------------------------
// Wärmebrücken — Längen aus der Geometrie, von Hand nachrechenbar
// ---------------------------------------------------------------------------

console.log('\n▸ Wärmebrücken');
{
  // Rechteck 6 × 5 m über Wandachsen, Außenwand 36,5 cm, Höhe 2,60 m.
  // Lichtes Maß also 5,635 × 4,635 m, lichter Umfang 20,54 m.
  const bn: Record<string, BimNode> = {};
  const bw: Wall[] = [];
  const pts = [
    { x: 0, y: 0 },
    { x: 6, y: 0 },
    { x: 6, y: 5 },
    { x: 0, y: 5 },
  ];
  const ids = pts.map((pt, i) => {
    const n = { id: `b${i}`, x: pt.x, y: pt.y, levelId: 'eg' } as BimNode;
    bn[n.id] = n;
    return n;
  });
  for (let k = 0; k < 4; k++) {
    bw.push({
      id: `bw${k}`, a: ids[k].id, b: ids[(k + 1) % 4].id,
      thickness: 0.365, height: 2.6, type: 'exterior',
      layerId: 'layer-walls', uValue: 0.24, levelId: 'eg',
    } as Wall);
  }
  // Ein Fenster 1,00 × 1,00 m in der Südwand.
  const bo: Opening[] = [
    {
      id: 'bo1', wallId: 'bw0', kind: 'window', subtype: 'turn-tilt',
      distance: 3, width: 1, height: 1, sillHeight: 0.9, uValue: 1.1, gValue: 0.6,
    } as Opening,
  ];

  const detected = detectRooms({
    nodes: bn, walls: bw, openings: bo, levelId: 'eg', defaultHeight: 2.6, northAngle: 0,
  });
  check('Ein Raum erkannt', detected.length, 1);
  const room = detected[0];
  check('Lichter Umfang', room.perimeter, 2 * (5.635 + 4.635), 1e-9);
  // Anschlusslängen laufen über die Wandachsen, nicht über das lichte Maß:
  // die Wärmebrücke sitzt im Bauteil, nicht in der Raumluft.
  check('Umfang mit Erdkontakt (Achsmaß)', room.groundContactPerimeter, 22, 1e-9);

  const mkDoc = (patch: Record<string, unknown> = {}, level: Record<string, unknown> = {}) => ({
    meta: {
      name: 'WB', createdAt: '', modifiedAt: '', northAngle: 0,
      designOutdoorTemperature: -12, designIndoorTemperature: 20, n50: 3,
      shielding: 'moderate' as const, unheatedTemperature: 10, groundTemperature: 10,
      thermalBridgeSupplement: 0.1, thermalBridgeMethod: 'flat' as const,
      thermalBridgeCategory: 'none' as const, reheatFactor: 0, ...patch,
    },
    levels: {
      eg: {
        id: 'eg', name: 'EG', order: 0, elevation: 0, height: 2.6,
        floorUValue: 0.3, floorBoundary: 'ground' as const,
        ceilingUValue: 0.2, ceilingBoundary: 'unheated' as const, ...level,
      },
    },
    layers: {}, nodes: bn,
    walls: Object.fromEntries(bw.map((w) => [w.id, w])),
    openings: Object.fromEntries(bo.map((o) => [o.id, o])),
    fixtures: {}, verticals: {}, pipes: {}, annotations: {}, roofOpenings: {},
    rooms: Object.fromEntries(detected.map((r) => [r.id, r])),
    constructions: {}, diagnostics: { openEnds: [] }, activeLevelId: 'eg',
  });

  const doc = mkDoc();
  const lengths = bridgeLengths(doc as never, room);

  // Vier rechtwinklige Gebäudeecken × Raumhöhe.
  check('Gebäudekanten', lengths.get('building-corner') ?? 0, 4 * 2.6, 1e-9);
  // Keine Innenwand, kein Geschoss darüber, kein Dach.
  check('Keine Innenwand-Einbindung', lengths.get('interior-wall') ?? 0, 0, 1e-9);
  check('Keine Geschossdecke', lengths.get('floor-slab') ?? 0, 0, 1e-9);
  check('Keine Traufe ohne Dach', lengths.get('eaves') ?? 0, 0, 1e-9);
  // Laibung = 2 × Höhe, Sturz und Brüstung = Breite.
  check('Laibung', lengths.get('window-reveal') ?? 0, 2, 1e-9);
  check('Sturz', lengths.get('window-lintel') ?? 0, 1, 1e-9);
  check('Brüstung', lengths.get('window-sill') ?? 0, 1, 1e-9);
  check('Sockel = Umfang mit Erdkontakt', lengths.get('base') ?? 0, 22, 1e-9);

  // Σ ψ·l von Hand: −0,05·10,4 + 0,10·2 + 0,18·1 + 0,10·1 + 0,22·22 = 4,80 W/K
  const expected = -0.05 * 10.4 + 0.1 * 2 + 0.18 * 1 + 0.1 * 1 + 0.22 * 22;
  const bridges = roomThermalBridges(doc as never, room);
  check('Σ ψ·l des Raums', roomBridgeHeatLoss(bridges), expected, 0.002);
  check('Alle ψ aus dem Vorgabekatalog', bridges.every((b) => b.source === 'default'), true);

  // Hüllfläche: Außenwände brutto (20,54 × 2,60) plus Boden und Decke.
  const area = 5.635 * 4.635;
  check('Hüllfläche', envelopeArea(doc as never), 22 * 2.6 + 2 * area, 0.02);

  // Eigener ψ-Wert schlägt den Vorgabewert und wird als solcher gekennzeichnet.
  const custom = mkDoc({ thermalBridgeCatalogue: { base: 0.5 } });
  const customBridges = roomThermalBridges(custom as never, room);
  const baseBridge = customBridges.find((b) => b.kind === 'base')!;
  check('Eigener ψ-Wert gilt', baseBridge.psi, 0.5, 1e-9);
  check('Herkunft wird mitgeführt', baseBridge.source, 'user');
  check('Leitwert folgt dem eigenen Wert', baseBridge.heatLossCoefficient, 0.5 * 22, 0.01);

  // --- Verfahren: keine Doppelzählung ------------------------------------
  const flatExport = buildRaviaExport(mkDoc() as never);
  const flatRoom = flatExport.rooms[0];
  check('Pauschal: Zuschlag steckt in der Fläche', flatRoom.surfaces[0].thermalBridgeSupplement, 0.1, 1e-9);
  check('Pauschal: keine Anschlussliste am Raum', flatRoom.thermalBridges === undefined, true);
  check('Pauschal: Bilanz trotzdem ausgewiesen', flatExport.totals.thermalBridges.detailedHeatLoss > 0, true);
  check(
    'Pauschal: Vergleichswert = ΔU_WB × Hüllfläche',
    flatExport.totals.thermalBridges.flatHeatLoss,
    0.1 * (22 * 2.6 + 2 * area),
    0.02,
  );

  const detailedExport = buildRaviaExport(mkDoc({ thermalBridgeMethod: 'detailed' }) as never);
  const detailedRoom = detailedExport.rooms[0];
  check(
    'Detailliert: kein Flächenzuschlag mehr',
    detailedRoom.surfaces.every((s) => s.thermalBridgeSupplement === 0),
    true,
  );
  check('Detailliert: Anschlussliste am Raum', (detailedRoom.thermalBridges ?? []).length > 0, true);
  check('Detailliert: Σ ψ·l am Raum', detailedRoom.thermalBridgeHeatLoss ?? 0, expected, 0.002);
  check(
    'Gleichwertiger Zuschlag',
    detailedExport.totals.thermalBridges.equivalentSupplement,
    expected / (22 * 2.6 + 2 * area),
    0.001,
  );
  check(
    'Gesamtbilanz = Summe der Räume',
    documentBridgeHeatLoss(mkDoc() as never),
    expected,
    0.002,
  );

  // --- Je Raum: gleichwertiger Zuschlag für die Gegenstelle ---------------
  // RaVia kennt nur katalogisierte Wärmebrücken-Typen und kann mit rohen
  // ψ-Werten nichts anfangen. Damit `detailed` dort überhaupt ankommt, trägt
  // jeder Raum denselben Quotienten wie das Gebäude — Σψ·l ÷ Hüllfläche —
  // und daneben seine Bezugsfläche, sonst wäre der Wert nicht nachrechenbar.
  const roomEnvelope = 22 * 2.6 + 2 * area;
  check(
    'Detailliert: Hüllfläche am Raum',
    angabe(detailedRoom.thermalBridgeEnvelopeArea),
    roomEnvelope,
    0.02,
  );
  check(
    'Detailliert: gleichwertiger Zuschlag am Raum',
    angabe(detailedRoom.thermalBridgeEquivalentSupplement),
    expected / roomEnvelope,
    0.001,
  );
  // Ein Raum, ein Gebäude: dann müssen Raum- und Gebäudewert zusammenfallen.
  check(
    'Ein-Raum-Haus: Raumwert = Gebäudewert',
    angabe(detailedRoom.thermalBridgeEquivalentSupplement),
    detailedExport.totals.thermalBridges.equivalentSupplement,
    1e-9,
  );
  // Pauschal steckt der Zuschlag schon im U-Wert jeder Fläche. Stünde er hier
  // noch einmal, wäre die Einladung zur Doppelzählung ausgesprochen.
  check(
    'Pauschal: kein Raumzuschlag',
    flatRoom.thermalBridgeEquivalentSupplement === undefined,
    true,
  );
  check(
    'Pauschal: keine Raum-Hüllfläche',
    flatRoom.thermalBridgeEnvelopeArea === undefined,
    true,
  );

  // --- Gegenprobe am Referenzhaus ----------------------------------------
  // Die eine Rechnung, die den Raumwert trägt: multipliziert die Gegenstelle
  // ihn wieder mit der Hüllfläche des Raums, muss über alle Räume Σψ·l des
  // Gebäudes herauskommen. Sonst stünde der Wert zwar da, wäre aber falsch
  // auf die Räume verteilt — und der Fehler fiele erst drüben auf.
  {
    const refExport = buildRaviaExport(buildReferenceDocument());
    const refTotals = refExport.totals.thermalBridges;
    check('Referenzhaus rechnet detailliert', refTotals.method, 'detailed');

    let recovered = 0;
    let envelopeSum = 0;
    let supplementSum = 0;
    let ohneAngabe = 0;
    for (const r of refExport.rooms) {
      const supplement = r.thermalBridgeEquivalentSupplement;
      const envelope = r.thermalBridgeEnvelopeArea;
      if (
        supplement === undefined ||
        envelope === undefined ||
        !Number.isFinite(supplement) ||
        !Number.isFinite(envelope)
      ) {
        ohneAngabe++;
        continue;
      }
      recovered += supplement * envelope;
      envelopeSum += envelope;
      supplementSum += Math.abs(supplement);
    }
    check('Jeder Raum trägt Zuschlag und Bezugsfläche', ohneAngabe, 0);
    // Jede Raumfläche steht auf zwei Nachkommastellen, die Gebäudefläche
    // ebenfalls — die Summe darf also um die Rundung je Raum abweichen.
    check(
      'Hüllflächen der Räume ergeben die des Gebäudes',
      envelopeSum,
      refTotals.envelopeArea,
      0.005 * (refExport.rooms.length + 1),
    );
    // Die Toleranz stammt aus der Rundung selbst, nicht aus dem Gefühl: der
    // Zuschlag steht auf vier Nachkommastellen (±5·10⁻⁵), die Hüllfläche auf
    // zwei (±0,005 m²), die Gebäudesumme ebenfalls auf zwei.
    const tol = 5e-5 * envelopeSum + 0.005 * supplementSum + 0.005;
    check(
      'Σ(ΔU_äq · A_Hülle) je Raum = Σψ·l des Gebäudes',
      recovered,
      refTotals.detailedHeatLoss,
      tol,
    );
  }

  // --- Raum ohne Hüllfläche ----------------------------------------------
  // Innenliegend *und* ohne Grundfläche: dann hat der Quotient keine
  // Bezugsfläche. Die Raumerkennung liefert so etwas nicht, ein von außen
  // eingelesenes Dokument kann es enthalten — und ein `Infinity` im Export
  // schlägt durch jede Weiterverarbeitung der Gegenstelle durch.
  {
    const hollow = {
      ...room,
      id: 'hohl',
      area: 0,
      boundaries: room.boundaries.map((b) => ({ ...b, boundary: 'unheated' as const })),
      // Erdkontakt ohne Außenwand ist baulich abwegig; hier steht er, weil nur
      // so ψ·l ≠ 0 auf eine Hüllfläche von 0 trifft. Aus der Geometrie heraus
      // kann dieser Fall nicht entstehen: jede Anschlussart setzt einen
      // Außenwandabschnitt voraus.
      groundContactPerimeter: 22,
      floorBoundary: 'ground' as const,
    };
    const hollowDoc = {
      ...mkDoc({ thermalBridgeMethod: 'detailed' }),
      rooms: { hohl: hollow },
    };
    const hollowRoom = buildRaviaExport(hollowDoc as never).rooms[0];
    check('Ohne Hüllfläche: Bezugsfläche 0', angabe(hollowRoom.thermalBridgeEnvelopeArea), 0, 1e-9);
    check(
      'Ohne Hüllfläche: Zuschlag 0 statt Division durch null',
      angabe(hollowRoom.thermalBridgeEquivalentSupplement),
      0,
      1e-9,
    );
    // Der Leitwert selbst geht nicht verloren — er steht weiter am Raum, nur
    // eben nicht als Zuschlag je m².
    check(
      'Ohne Hüllfläche: Σψ·l bleibt ausgewiesen',
      angabe(hollowRoom.thermalBridgeHeatLoss),
      0.22 * 22,
      0.01,
    );
    // JSON.stringify macht aus Infinity und NaN ein `null`. Der ganze
    // Raumdatensatz wird deshalb abgesucht, nicht nur die beiden neuen Felder.
    const unendlich: string[] = [];
    const suche = (value: unknown, path: string): void => {
      if (typeof value === 'number') {
        if (!Number.isFinite(value)) unendlich.push(`${path} = ${value}`);
        return;
      }
      if (Array.isArray(value)) {
        value.forEach((item, i) => suche(item, `${path}[${i}]`));
        return;
      }
      if (value && typeof value === 'object') {
        for (const [key, item] of Object.entries(value)) suche(item, path ? `${path}.${key}` : key);
      }
    };
    suche(hollowRoom, 'room');
    if (unendlich.length) console.log(`      ${unendlich.join(', ')}`);
    check('Ohne Hüllfläche: keine unendliche Zahl im Export', unendlich.length, 0);
  }

  // --- Geschoss darüber: die Deckenplatte durchdringt die Außenwand -------
  const stacked = mkDoc();
  (stacked.levels as Record<string, unknown>)['og'] = {
    id: 'og', name: 'OG', order: 1, elevation: 2.6, height: 2.6,
    floorUValue: 0.3, floorBoundary: 'adjacent-room', ceilingUValue: 0.2, ceilingBoundary: 'unheated',
  };
  check(
    'Geschossdecke an der Außenwand',
    bridgeLengths(stacked as never, room).get('floor-slab') ?? 0,
    22,
    1e-9,
  );

  // --- Dach: Traufe an den Längsseiten, Ortgang über dem Giebel ----------
  const roofDoc = mkDoc({}, {
    roof: {
      kind: 'gable', pitch: 45, kneeHeight: 1, azimuth: 180, ridgeOffset: 0,
      uValue: 0.2, gableUValue: 0.24,
    },
  });
  const roofRooms = detectRooms({
    nodes: bn, walls: bw, openings: bo, levelId: 'eg', defaultHeight: 2.6, northAngle: 0,
    roof: (roofDoc.levels as Record<string, { roof?: unknown }>).eg.roof as never,
  } as never);
  const roofRoom = roofRooms[0];
  (roofDoc as { rooms: Record<string, unknown> }).rooms = { [roofRoom.id]: roofRoom };
  const roofLengths = bridgeLengths(roofDoc as never, roofRoom);
  const gableWalls = roofRoom.boundaries.filter((b) => (b.gableArea ?? 0) > 0.05);
  const eaveWalls = roofRoom.boundaries.filter((b) => b.boundary === 'exterior' && (b.gableArea ?? 0) <= 0.05);
  check('Giebelwände erkannt', gableWalls.length, 2);
  check(
    'Ortgang = Giebellänge ÷ cos(45°)',
    roofLengths.get('verge') ?? 0,
    gableWalls.reduce((sum, b) => sum + b.length, 0) / Math.cos(Math.PI / 4),
    1e-6,
  );
  check(
    'Traufe = Länge der übrigen Außenwände',
    roofLengths.get('eaves') ?? 0,
    eaveWalls.reduce((sum, b) => sum + b.length, 0),
    1e-6,
  );

  // --- Innenwand-Einbindung: eine Kante, zwei Räume ------------------------
  // Ein Riegel teilt das Rechteck; die Trennwand stößt oben und unten an die
  // Außenwand. Das sind zwei Wärmebrücken — nicht vier, obwohl beide Räume
  // sie sehen.
  {
    const dn: Record<string, BimNode> = {};
    const dw: Wall[] = [];
    const corner = [
      { x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 5 }, { x: 0, y: 5 },
    ];
    const cids = corner.map((pt, i) => {
      const n = { id: `d${i}`, x: pt.x, y: pt.y, levelId: 'eg' } as BimNode;
      dn[n.id] = n;
      return n;
    });
    // Zwei Knoten auf der Süd- und der Nordwand, an denen die Trennwand sitzt.
    const ds = { id: 'ds', x: 3, y: 0, levelId: 'eg' } as BimNode;
    const dnn = { id: 'dn', x: 3, y: 5, levelId: 'eg' } as BimNode;
    dn[ds.id] = ds;
    dn[dnn.id] = dnn;
    const wall = (id: string, a: string, b: string, type: Wall['type'], thickness: number) =>
      dw.push({
        id, a, b, thickness, height: 2.6, type,
        layerId: 'layer-walls', uValue: type === 'exterior' ? 0.24 : 1.2, levelId: 'eg',
      } as Wall);
    wall('dw0', cids[0].id, ds.id, 'exterior', 0.365);
    wall('dw1', ds.id, cids[1].id, 'exterior', 0.365);
    wall('dw2', cids[1].id, cids[2].id, 'exterior', 0.365);
    wall('dw3', cids[2].id, dnn.id, 'exterior', 0.365);
    wall('dw4', dnn.id, cids[3].id, 'exterior', 0.365);
    wall('dw5', cids[3].id, cids[0].id, 'exterior', 0.365);
    wall('dw6', ds.id, dnn.id, 'interior', 0.115);

    const two = detectRooms({
      nodes: dn, walls: dw, openings: [], levelId: 'eg', defaultHeight: 2.6, northAngle: 0,
    });
    check('Zwei Räume erkannt', two.length, 2);
    const twoDoc = {
      ...mkDoc(),
      nodes: dn,
      walls: Object.fromEntries(dw.map((w) => [w.id, w])),
      openings: {},
      rooms: Object.fromEntries(two.map((r) => [r.id, r])),
    };
    const shared = two.reduce(
      (sum, r) => sum + (bridgeLengths(twoDoc as never, r).get('interior-wall') ?? 0),
      0,
    );
    check('Zwei Einbindungen, nicht vier', shared, 2 * 2.6, 1e-9);
    check(
      'Jeder Raum trägt die Hälfte',
      bridgeLengths(twoDoc as never, two[0]).get('interior-wall') ?? 0,
      2.6,
      1e-9,
    );
  }

  // --- Absenkbetrieb: Zeitkonstante und Temperaturabfall ------------------
  const setbackDoc = mkDoc({
    setback: { active: true, hours: 8, reheatHours: 2, airChangeRate: 0.1, massClass: 'medium' },
  });
  const setbackExport = buildRaviaExport(setbackDoc as never);
  const sb = setbackExport.totals.setback!;
  check('Absenkbetrieb im Export', sb.active, true);
  check('Wirksame Speicherfähigkeit mittelschwer', sb.effectiveHeatCapacity, 42);
  check('Zeitkonstante τ = c·V / H', sb.timeConstant, (42 * setbackExport.totals.netVolume) / sb.heatLossCoefficient, 0.05);
  check(
    'Temperaturabfall ΔΘ = (Θi − Θe)(1 − e^(−t/τ))',
    sb.temperatureDrop,
    32 * (1 - Math.exp(-8 / sb.timeConstant)),
    0.02,
  );
  check('Ohne f_RH keine Aufheizleistung', sb.reheatPower, 0);

  const withFactor = buildRaviaExport(
    mkDoc({
      reheatFactor: 10,
      setback: { active: true, hours: 8, reheatHours: 2, airChangeRate: 0.1, massClass: 'heavy' },
    }) as never,
  );
  check('Bauart schwer', withFactor.totals.setback!.effectiveHeatCapacity, 70);
  check(
    'Aufheizleistung = Fläche × f_RH',
    withFactor.totals.setback!.reheatPower,
    Math.round(withFactor.rooms[0].netFloorArea! * 10),
  );
  check('Ohne Absenkung kein Eintrag', buildRaviaExport(mkDoc() as never).totals.setback === undefined, true);

  // --- Prüfbericht --------------------------------------------------------
  const ignored = validateModel(mkDoc({ thermalBridgeSupplement: 0 }) as never);
  check(
    'Zuschlag 0 wird gemeldet',
    ignored.issues.some((i) => i.code === 'project.thermal-bridges-ignored'),
    true,
  );
  const setbackReport = validateModel(setbackDoc as never);
  check(
    'Absenkung ohne f_RH wird angemerkt',
    setbackReport.issues.some((i) => i.code === 'project.reheat-factor'),
    true,
  );
}


// ---------------------------------------------------------------------------
// Lüftungskonzept und Rohrnetz-Topologie
// ---------------------------------------------------------------------------

console.log('\n▸ Lüftung');
{
  // Zwei Räume: links Wohnen (Zuluft), rechts Bad (Abluft).
  const vn: Record<string, BimNode> = {};
  const vw: Wall[] = [];
  const pts = [
    { x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 5 }, { x: 0, y: 5 },
  ];
  const vids = pts.map((pt, i) => {
    const n = { id: `v${i}`, x: pt.x, y: pt.y, levelId: 'eg' } as BimNode;
    vn[n.id] = n;
    return n;
  });
  const vs = { id: 'vs', x: 5, y: 0, levelId: 'eg' } as BimNode;
  const vnn = { id: 'vn', x: 5, y: 5, levelId: 'eg' } as BimNode;
  vn[vs.id] = vs;
  vn[vnn.id] = vnn;
  const wall = (id: string, a: string, b: string, type: Wall['type']) =>
    vw.push({
      id, a, b, thickness: type === 'exterior' ? 0.365 : 0.115, height: 2.6, type,
      layerId: 'layer-walls', uValue: 0.24, levelId: 'eg',
    } as Wall);
  wall('vw0', vids[0].id, vs.id, 'exterior');
  wall('vw1', vs.id, vids[1].id, 'exterior');
  wall('vw2', vids[1].id, vids[2].id, 'exterior');
  wall('vw3', vids[2].id, vnn.id, 'exterior');
  wall('vw4', vnn.id, vids[3].id, 'exterior');
  wall('vw5', vids[3].id, vids[0].id, 'exterior');
  wall('vw6', vs.id, vnn.id, 'interior');

  const detected = detectRooms({
    nodes: vn, walls: vw, openings: [], levelId: 'eg', defaultHeight: 2.6, northAngle: 0,
  });
  check('Zwei Räume', detected.length, 2);

  // Nutzung setzen: der größere Raum ist Wohnen, der kleinere Bad.
  const living = detected.find((r) => r.centroid.x < 5)!;
  const bath = detected.find((r) => r.centroid.x > 5)!;
  const withUsage = detectRooms({
    nodes: vn, walls: vw, openings: [], levelId: 'eg', defaultHeight: 2.6, northAngle: 0,
    previous: [
      { ...living, usage: 'living' as const, ventilationRole: undefined },
      { ...bath, usage: 'bath' as const, ventilationRole: undefined },
    ],
  });
  const l2 = withUsage.find((r) => r.centroid.x < 5)!;
  const b2 = withUsage.find((r) => r.centroid.x > 5)!;
  check('Wohnen wird Zuluftraum', angabe(l2.ventilationRole), 'supply');
  check('Bad wird Abluftraum', angabe(b2.ventilationRole), 'exhaust');

  const fixture = (id: string, type: string, x: number, roomId: string, airflow: number) => ({
    id, type, category: 'ventilation' as const, levelId: 'eg',
    position: { x, y: 2.5 }, rotation: 0, length: 0.16, depth: 0.16, elevation: 2.4,
    roomId, params: { airflow },
  });

  const mkDoc = (meta: Record<string, unknown>, fixtures: unknown[]) => ({
    meta: {
      name: 'Lüftung', createdAt: '', modifiedAt: '', northAngle: 0,
      designOutdoorTemperature: -12, designIndoorTemperature: 20, n50: 1.5,
      shielding: 'moderate' as const, unheatedTemperature: 10, groundTemperature: 10,
      thermalBridgeSupplement: 0.1, thermalBridgeMethod: 'flat' as const,
      thermalBridgeCategory: 'none' as const, reheatFactor: 0, ...meta,
    },
    levels: {
      eg: {
        id: 'eg', name: 'EG', order: 0, elevation: 0, height: 2.6,
        floorUValue: 0.3, floorBoundary: 'ground' as const,
        ceilingUValue: 0.2, ceilingBoundary: 'unheated' as const,
      },
    },
    layers: {}, nodes: vn,
    walls: Object.fromEntries(vw.map((w) => [w.id, w])),
    openings: {},
    fixtures: Object.fromEntries((fixtures as { id: string }[]).map((f) => [f.id, f])),
    verticals: {}, pipes: {}, annotations: {}, roofOpenings: {},
    rooms: Object.fromEntries(withUsage.map((r) => [r.id, r])),
    constructions: {}, diagnostics: { openEnds: [] }, activeLevelId: 'eg',
  });

  const valves = [
    fixture('f-su', 'air-supply', 2, l2.id, 60),
    fixture('f-ex', 'air-exhaust', 6.5, b2.id, 60),
    fixture('f-tr', 'air-transfer', 5, l2.id, 40),
  ];

  // --- Freie Lüftung: keine Rückgewinnung, kein Abzug -------------------
  const free = buildRaviaExport(mkDoc({}, valves) as never);
  check('Ohne Anlage: frei', free.totals.ventilation.kind, 'none');
  check('Ohne Anlage: keine Rückgewinnung', free.totals.ventilation.heatRecovery, 0);
  check(
    'Ohne Anlage: wirksame Zuluft = Zuluft',
    free.totals.ventilation.effectiveSupplyAirflow,
    free.totals.ventilation.supplyAirflow,
  );

  // --- Zu-/Abluft mit 80 % Rückgewinnung --------------------------------
  const balanced = buildRaviaExport(
    mkDoc({ ventilation: { kind: 'balanced', heatRecovery: 0.8, operation: 'continuous' } }, valves) as never,
  );
  const vt = balanced.totals.ventilation;
  check('Zuluft summiert', vt.supplyAirflow, 60);
  check('Abluft summiert', vt.exhaustAirflow, 60);
  check('Überströmung summiert', vt.transferAirflow, 40);
  check('Bilanz ausgeglichen', vt.balance, 0);
  check('Wirksame Zuluft = V̇ · (1 − η)', vt.effectiveSupplyAirflow, 12);
  check('Ein Zuluftraum', vt.roomsByRole.supply, 1);
  check('Ein Abluftraum', vt.roomsByRole.exhaust, 1);

  const livingExport = balanced.rooms.find((r) => r.id === l2.id)!;
  check('Raumrolle im Export', livingExport.ventilation.role, 'supply');
  check('Raum: wirksame Zuluft', livingExport.ventilation.effectiveSupplyAirflow, 12);
  check(
    'Raum: Mindestluftstrom bleibt daneben stehen',
    livingExport.ventilation.minimumAirflow,
    Math.round(l2.volume * l2.airChangeRate * 100) / 100,
    0.01,
  );

  // --- Reine Abluftanlage: nichts zurückzugewinnen ------------------------
  const exhaustOnly = buildRaviaExport(
    mkDoc({ ventilation: { kind: 'exhaust', heatRecovery: 0.8, operation: 'continuous' } }, valves) as never,
  );
  check(
    'Abluftanlage: Rückgewinnung wird nicht angerechnet',
    exhaustOnly.totals.ventilation.heatRecovery,
    0,
  );

  // --- Prüfbericht --------------------------------------------------------
  const skewed = [
    fixture('f-su', 'air-supply', 2, l2.id, 120),
    fixture('f-ex', 'air-exhaust', 6.5, b2.id, 60),
  ];
  const report = validateModel(
    mkDoc({ ventilation: { kind: 'balanced', heatRecovery: 0.8, operation: 'continuous' } }, skewed) as never,
  );
  check(
    'Klaffende Luftbilanz wird gemeldet',
    report.issues.some((i) => i.code === 'ventilation.unbalanced'),
    true,
  );
  const noValve = validateModel(
    mkDoc({ ventilation: { kind: 'balanced', heatRecovery: 0.8, operation: 'continuous' } }, [
      fixture('f-su', 'air-supply', 2, l2.id, 60),
    ]) as never,
  );
  check(
    'Abluftraum ohne Ventil wird gemeldet',
    noValve.issues.some((i) => i.code === 'ventilation.room-missing-exhaust'),
    true,
  );
  const tooGood = validateModel(
    mkDoc({ ventilation: { kind: 'balanced', heatRecovery: 0.99, operation: 'continuous' } }, valves) as never,
  );
  check(
    'Unmöglicher Wirkungsgrad ist ein Fehler',
    tooGood.issues.some((i) => i.code === 'ventilation.recovery-range' && i.severity === 'error'),
    true,
  );
}

console.log('\n▸ Rohrnetz-Topologie');
{
  const heat = (id: string, type: string, x: number, y: number, levelId = 'eg', elevation = 0.15) => ({
    id, type, category: 'heating' as const, levelId,
    position: { x, y }, rotation: 0, length: 1, depth: 0.1, elevation,
    params: { powerW: 1000 },
  });

  const run = (
    id: string,
    points: { x: number; y: number }[],
    dn: number,
    from?: string,
    to?: string,
    levelId = 'eg',
  ) => ({
    id, levelId, service: 'heating-flow' as const, points,
    nominalDiameter: dn, insulation: 0, elevation: 0.1,
    fromFixtureId: from, toFixtureId: to,
  });

  const netDoc = (fixtures: unknown[], pipes: unknown[], levels?: Record<string, unknown>) => ({
    meta: {
      name: 'Netz', createdAt: '', modifiedAt: '', northAngle: 0,
      designOutdoorTemperature: -12, designIndoorTemperature: 20, n50: 3,
      shielding: 'moderate' as const, unheatedTemperature: 10, groundTemperature: 10,
      thermalBridgeSupplement: 0.1, thermalBridgeMethod: 'flat' as const,
      thermalBridgeCategory: 'none' as const, reheatFactor: 0,
    },
    levels: levels ?? {
      eg: {
        id: 'eg', name: 'EG', order: 0, elevation: 0, height: 2.6,
        floorUValue: 0.3, floorBoundary: 'ground' as const,
        ceilingUValue: 0.2, ceilingBoundary: 'unheated' as const,
      },
    },
    layers: {}, nodes: {}, walls: {}, openings: {},
    fixtures: Object.fromEntries((fixtures as { id: string }[]).map((f) => [f.id, f])),
    verticals: {},
    pipes: Object.fromEntries((pipes as { id: string }[]).map((p) => [p.id, p])),
    annotations: {}, roofOpenings: {}, rooms: {}, constructions: {},
    diagnostics: { openEnds: [] }, activeLevelId: 'eg',
  });

  // --- Ein Verteiler, ein Heizkörper, ein Zug über Eck -------------------
  const simple = buildPipeNetwork(
    netDoc(
      [heat('m1', 'manifold', 0, 0), heat('r1', 'radiator', 3, 4)],
      [run('p1', [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 4 }], 20, 'm1', 'r1')],
    ) as never,
  );
  check('Ein Verbraucher gefunden', simple.paths.length, 1);
  check('Trassenlänge über Eck', simple.paths[0].routeLength, 7, 1e-9);
  check('Kreislänge = 2 × Trasse', simple.paths[0].circuitLength, 14, 1e-9);
  check('Quelle zugeordnet', simple.paths[0].sourceFixtureId, 'm1');
  check('Zwei Abschnitte', simple.paths[0].segments.length, 2);
  check('Kleinste Nennweite', simple.paths[0].minimumDiameter, 20);
  check('Nichts unverbunden', simple.unconnected.length, 0);

  // --- Zwei Züge, am Stützpunkt verschweißt ------------------------------
  // Der zweite Zug beginnt 3 cm neben dem Ende des ersten — beim Zeichnen
  // gefangen, aber nicht bitgenau. Ohne Verschmelzung bliebe der Heizkörper
  // ohne Anschluss.
  const welded = buildPipeNetwork(
    netDoc(
      [heat('m1', 'manifold', 0, 0), heat('r1', 'radiator', 10, 0)],
      [
        run('p1', [{ x: 0, y: 0 }, { x: 5, y: 0 }], 25, 'm1'),
        run('p2', [{ x: 5.03, y: 0 }, { x: 10, y: 0 }], 15, undefined, 'r1'),
      ],
    ) as never,
  );
  check('Über zwei Züge angeschlossen', welded.paths.length, 1);
  check('Länge über beide Züge', welded.paths[0].routeLength, 9.97, 0.01);
  check('Engpass ist die kleinere Nennweite', welded.paths[0].minimumDiameter, 15);
  check('Abschnitte von der Quelle her gelesen', welded.paths[0].segments[0].nominalDiameter, 25);

  // --- Ohne Quelle bleibt alles unverbunden ------------------------------
  const orphan = buildPipeNetwork(
    netDoc(
      [heat('r1', 'radiator', 3, 0)],
      [run('p1', [{ x: 0, y: 0 }, { x: 3, y: 0 }], 15, undefined, 'r1')],
    ) as never,
  );
  check('Ohne Quelle kein Strang', orphan.paths.length, 0);
  check('Verbraucher wird gemeldet', orphan.unconnected.length, 1);
  check('Grund benannt', orphan.unconnected[0].reason, 'keine Quelle im Modell');

  // --- Zwei Quellen: die nähere gewinnt ----------------------------------
  const twoSources = buildPipeNetwork(
    netDoc(
      [heat('m1', 'manifold', 0, 0), heat('m2', 'manifold', 12, 0), heat('r1', 'radiator', 9, 0)],
      [
        run('p1', [{ x: 0, y: 0 }, { x: 9, y: 0 }], 20, 'm1', 'r1'),
        run('p2', [{ x: 9, y: 0 }, { x: 12, y: 0 }], 20, 'r1', 'm2'),
      ],
    ) as never,
  );
  check('Nächstgelegene Quelle gewinnt', twoSources.paths[0].sourceFixtureId, 'm2');
  check('Länge zur näheren Quelle', twoSources.paths[0].routeLength, 3, 1e-9);

  // --- Steigstrang verbindet Geschosse -----------------------------------
  const levels = {
    eg: {
      id: 'eg', name: 'EG', order: 0, elevation: 0, height: 2.6,
      floorUValue: 0.3, floorBoundary: 'ground' as const,
      ceilingUValue: 0.2, ceilingBoundary: 'adjacent-room' as const,
    },
    og: {
      id: 'og', name: 'OG', order: 1, elevation: 2.75, height: 2.6,
      floorUValue: 0.3, floorBoundary: 'adjacent-room' as const,
      ceilingUValue: 0.2, ceilingBoundary: 'unheated' as const,
    },
  };
  const stacked = buildPipeNetwork(
    netDoc(
      [
        heat('m1', 'manifold', 0, 0),
        { ...heat('s1', 'riser-heating', 4, 0), category: 'heating' as const },
        { ...heat('s2', 'riser-heating', 4.1, 0, 'og'), category: 'heating' as const },
        heat('r1', 'radiator', 7, 0, 'og'),
      ],
      [
        run('p1', [{ x: 0, y: 0 }, { x: 4, y: 0 }], 25, 'm1', 's1'),
        run('p2', [{ x: 4.1, y: 0 }, { x: 7, y: 0 }], 15, 's2', 'r1', 'og'),
      ],
      levels,
    ) as never,
  );
  check('Steigstrang erkannt', stacked.risers, 1);
  check('Verbraucher im OG angeschlossen', stacked.paths.length, 1);
  // 4,00 m im EG + 2,75 m senkrecht + 2,90 m im OG
  check('Länge über den Steigstrang', stacked.paths[0].routeLength, 4 + 2.75 + 2.9, 0.01);
  check('Höhenversatz zum Verbraucher', stacked.paths[0].elevationChange, 2.75, 0.01);

  // --- Der ungünstigste Strang steht oben --------------------------------
  const ranked = buildPipeNetwork(
    netDoc(
      [heat('m1', 'manifold', 0, 0), heat('r1', 'radiator', 2, 0), heat('r2', 'radiator', 9, 0)],
      [
        run('p1', [{ x: 0, y: 0 }, { x: 2, y: 0 }], 15, 'm1', 'r1'),
        run('p2', [{ x: 0, y: 0 }, { x: 9, y: 0 }], 15, 'm1', 'r2'),
      ],
    ) as never,
  );
  check('Nach Kreislänge sortiert', ranked.paths[0].fixtureId, 'r2');
  check('Ungünstigster Strang benannt', ranked.worstPath?.circuitLength ?? 0, 18, 1e-9);
  check('Quelle zählt ihre Verbraucher', ranked.sources[0].consumers, 2);
}


// ---------------------------------------------------------------------------
// Referenzprojekt — Fernwirkungen sichtbar machen
// ---------------------------------------------------------------------------

console.log('\n▸ Referenzprojekt');
{
  // Ein festes Haus, dessen Export gegen einen eingecheckten Sollstand
  // gehalten wird. Die Einzeltests prüfen je eine Formel; dieser Test fängt,
  // was sie nicht sehen können — dass eine Änderung an einer Stelle eine
  // Zahl an einer ganz anderen verschiebt.
  const actual = buildReferenceReport(buildReferenceDocument());
  const expected = expectedReference as unknown as Record<string, unknown>;

  const differences: string[] = [];
  const walk = (a: unknown, b: unknown, path: string): void => {
    if (Array.isArray(a) || Array.isArray(b)) {
      const arrA = (a ?? []) as unknown[];
      const arrB = (b ?? []) as unknown[];
      if (arrA.length !== arrB.length) {
        differences.push(`${path}: ${arrB.length} Einträge erwartet, ${arrA.length} erhalten`);
        return;
      }
      arrA.forEach((item, i) => walk(item, arrB[i], `${path}[${i}]`));
      return;
    }
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
      for (const key of keys) {
        walk(
          (a as Record<string, unknown>)[key],
          (b as Record<string, unknown>)[key],
          path ? `${path}.${key}` : key,
        );
      }
      return;
    }
    if (typeof a === 'number' && typeof b === 'number') {
      if (Math.abs(a - b) > 1e-6) differences.push(`${path}: ${b} → ${a}`);
      return;
    }
    if (a !== b) differences.push(`${path}: ${JSON.stringify(b)} → ${JSON.stringify(a)}`);
  };
  walk(actual, expected, '');

  if (differences.length) {
    console.log('  Abweichungen gegenüber dem Sollstand:');
    for (const d of differences.slice(0, 25)) console.log(`      ${d}`);
    if (differences.length > 25) console.log(`      … und ${differences.length - 25} weitere`);
    console.log('  Gewollt? Dann: npm run reference:update — und den Diff ansehen.');
  }
  check('Export entspricht dem Sollstand', differences.length, 0);

  // Zwei Läufe müssen bitgleich sein, sonst prüft der Sollstand nichts.
  check(
    'Bericht ist reproduzierbar',
    JSON.stringify(buildReferenceReport(buildReferenceDocument())) === JSON.stringify(actual),
    true,
  );
}


// ---------------------------------------------------------------------------
// Verständlichkeit: Glossar und Handlungsanweisungen
// ---------------------------------------------------------------------------

console.log('\n▸ Verständlichkeit');
{
  // Das Glossar ist kein Beiwerk: es steht an jedem Fachbegriff im Programm.
  // Ein leerer oder zu knapper Eintrag hilft niemandem.
  const entries = glossaryList();
  check('Glossar gefüllt', entries.length >= 15, true);
  check(
    'Jeder Eintrag hat Begriff, Kurzfassung und Erklärung',
    entries.every((e) => e.term.length > 2 && e.short.length > 10 && e.long.length > 60),
    true,
  );
  check(
    'Kurzfassung bleibt kurz',
    entries.every((e) => e.short.length <= 90),
    true,
  );
  check(
    'Erklärungen enden als ganze Sätze',
    entries.every((e) => e.short.trim().endsWith('.') && e.long.trim().endsWith('.')),
    true,
  );
  check('Begriffe eindeutig', new Set(entries.map((e) => e.term)).size, entries.length);
  check('Nachschlagen über den Schlüssel', Boolean(GLOSSAR['u-wert']), true);

  // --- Jeder Befund muss sagen, was zu tun ist --------------------------
  // Ein Prüfbericht ohne Handlungsanweisung hilft nur dem, der die Antwort
  // ohnehin kennt. Deshalb wird hier nicht der Text geprüft, sondern die
  // Vollständigkeit: kein Befund ohne Satz.
  check(
    'Handlungsanweisungen sind Sätze, keine Stichworte',
    Object.values(REMEDIES).every((r) => r.length > 25 && r.trim().endsWith('.')),
    true,
  );

  const collected = new Set<string>();
  const collect = (doc: unknown) => {
    for (const issue of validateModel(doc as never).issues) collected.add(issue.code);
  };

  // Ein gesundes Haus, ein kaputtes und mehrere Sonderfälle — zusammen
  // decken sie den größten Teil der Befunde ab.
  const healthy = buildReferenceDocument();
  collect(healthy);

  const broken = buildReferenceDocument();
  broken.meta.designOutdoorTemperature = 5;
  broken.meta.thermalBridgeSupplement = 0;
  broken.meta.thermalBridgeMethod = 'flat';
  broken.meta.n50 = 40;
  broken.meta.ventilation = { kind: 'balanced', heatRecovery: 0.99, operation: 'continuous' };
  for (const wall of Object.values(broken.walls)) delete (wall as { uValue?: number }).uValue;
  for (const op of Object.values(broken.openings)) {
    delete (op as { uValue?: number }).uValue;
    delete (op as { gValue?: number }).gValue;
  }
  for (const room of Object.values(broken.rooms)) room.usage = 'other';
  collect(broken);

  const noPower = buildReferenceDocument();
  for (const f of Object.values(noPower.fixtures)) {
    if (f.type === 'radiator') delete (f.params as { powerW?: number }).powerW;
  }
  collect(noPower);

  check('Genug Befunde für die Probe gesammelt', collected.size >= 8, true);
  const withoutRemedy = [...collected].filter((code) => !REMEDIES[code]);
  if (withoutRemedy.length) {
    console.log(`      ohne Handlungsanweisung: ${withoutRemedy.join(', ')}`);
  }
  check('Jeder aufgetretene Befund sagt, was zu tun ist', withoutRemedy.length, 0);

  // Und die Befunde selbst tragen den Satz auch wirklich mit.
  const issues = validateModel(broken as never).issues;
  check(
    'Handlungsanweisung hängt am Befund',
    issues.filter((i) => REMEDIES[i.code]).every((i) => Boolean(i.remedy)),
    true,
  );
}


// ---------------------------------------------------------------------------
// Wärmepumpe: Schall, Schutzbereich, Wärmequelle
// ---------------------------------------------------------------------------

console.log('\n▸ Wärmepumpe');
{
  // --- Schallausbreitung nach TA Lärm Anhang A.2.4.3 (G4) ----------------
  // L = L_WA + K0 − 20·lg(r) − 11.  Mit 55 dB(A), vor einer Wand (K0 = 6)
  // und 5 m Abstand: 55 + 6 − 13,98 − 11 = 36,0 dB(A). Das ist der Wert, den
  // auch die Tabelle des BWP-Leitfadens ausweist.
  // 20·lg(5) = 13,979 — das Ergebnis ist 36,02 und wird erst in der Anzeige
  // auf volle dB gerundet. Die Tabelle des BWP-Leitfadens nennt 36.
  check('Schalldruck 55 dB(A), 5 m, vor Wand', soundPressureAt(55, 6, 5), 36.02, 0.01);
  check('Frei auf dem Boden sind 3 dB weniger', soundPressureAt(55, 3, 5), 33.02, 0.01);
  check('In der Ecke 3 dB mehr', soundPressureAt(55, 9, 5), 39.02, 0.01);
  check('Gerundet ergibt das die Tabellenzahl', Math.round(soundPressureAt(55, 6, 5)), 36);
  // Abstandsverdopplung kostet 6 dB — die Faustregel der Punktquelle.
  check(
    'Doppelter Abstand, 6 dB leiser',
    soundPressureAt(55, 6, 10),
    soundPressureAt(55, 6, 5) - 6.02,
    0.02,
  );
  check('Im Nahbereich wird bei 1 m abgeschnitten', soundPressureAt(55, 6, 0.2), soundPressureAt(55, 6, 1), 1e-9);

  // Gegenprobe zur Abstandstabelle des Merkblatts Brandenburg:
  // r = 10^((L_WA + K0 − 11 − (IRW − 6))/20). 55 dB(A), WA (40 nachts),
  // K0 = 3 ⇒ 4,47 m, aufgerundet 4 m in der Tabelle.
  check('Mindestabstand 55 dB(A), WA, frei', requiredDistance(55, 3, 34), 4.47, 0.01);
  check('Mindestabstand 55 dB(A), WA, vor Wand', requiredDistance(55, 6, 34), 6.31, 0.01);
  check('Mindestabstand 65 dB(A), WA, vor Wand', requiredDistance(65, 6, 34), 19.95, 0.02);

  // Die Richtwerte selbst, stichprobenartig gegen TA Lärm Nr. 6.1.
  check('Allgemeines Wohngebiet nachts', IMMISSION_LIMITS.WA[1], 40);
  check('Reines Wohngebiet nachts', IMMISSION_LIMITS.WR[1], 35);
  check('Urbanes Gebiet tags 63, nicht 60', IMMISSION_LIMITS.MU[0], 63);
  check('Industriegebiet ohne Nachtabsenkung', IMMISSION_LIMITS.GI[0], IMMISSION_LIMITS.GI[1]);
  check('Raumwinkelmaß frei/Wand/Ecke', `${ROOM_ANGLE.free}/${ROOM_ANGLE.wall}/${ROOM_ANGLE.corner}`, '3/6/9');

  // --- Ein Grundstück mit Gerät ------------------------------------------
  const pump = {
    id: 'wp1', label: 'Wärmepumpe', source: 'air' as const, form: 'monoblock-outdoor' as const,
    position: { x: 5, y: 5 }, azimuth: 180, width: 1.1, depth: 0.5, height: 1.3, standHeight: 0.3,
    mounting: 'wall' as const, soundPower: 55, soundPowerNight: 49, nightModeGuaranteed: false,
    toneSurcharge: 0, refrigerant: 'R290' as const, refrigerantMass: 1.5, protectionRadius: 1,
    heatingCapacity: 8, ratingPoint: 'A-7/W35', cop: 3.2, operation: 'mono-energetic' as const,
    bivalencePoint: -7, backupCapacity: 6, flowTemperature: 40,
    gridRegime: 'p14a-dimming' as const, blockedHours: 0, domesticHotWater: true, occupants: 4,
  };

  // Quadratisches Grundstück 20 × 20 m, Gerät 5 m von der Westgrenze.
  const mkSite = (patch: Record<string, unknown> = {}, elements: Record<string, unknown> = {}) => ({
    meta: {
      name: 'WP', createdAt: '', modifiedAt: '', northAngle: 0,
      designOutdoorTemperature: -12, designIndoorTemperature: 20, n50: 1.5,
      shielding: 'moderate' as const, unheatedTemperature: 10, groundTemperature: 10,
      thermalBridgeSupplement: 0.1, thermalBridgeMethod: 'flat' as const,
      thermalBridgeCategory: 'none' as const, reheatFactor: 0,
    },
    site: {
      areaCategory: 'WA' as const, state: '', soil: 'normal' as const,
      waterProtection: 'none' as const, sourceRunHours: 2400,
      elements: {
        grenze: {
          id: 'grenze', kind: 'boundary' as const,
          points: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }],
        },
        ...elements,
      },
      pumps: { wp1: { ...pump, ...patch } },
    },
    levels: {
      eg: {
        id: 'eg', name: 'EG', order: 0, elevation: 0, height: 2.75,
        floorUValue: 0.3, floorBoundary: 'ground' as const,
        ceilingUValue: 0.2, ceilingBoundary: 'unheated' as const,
      },
    },
    layers: {}, nodes: {}, walls: {}, openings: {}, fixtures: {},
    verticals: {}, pipes: {}, annotations: {}, roofOpenings: {},
    rooms: {}, constructions: {}, diagnostics: { openEnds: [] }, activeLevelId: 'eg',
  });

  const doc = mkSite();
  const report = acousticReport(doc as never, doc.site.pumps.wp1 as never);
  check('Grenze wird als Immissionsort genommen', report.points.length, 1);
  check('Abstand zur nächsten Grenze', report.points[0].distance, 5, 1e-9);
  check('Beurteilungspegel an der Grenze', report.points[0].level, 36.0, 0.05);
  check('Richtwert eingehalten, aber knapp', report.points[0].verdict, 'tight');
  check('Fläche des Grundstücks', heatPumpPolygonArea(doc.site.elements.grenze.points), 400, 1e-9);

  // Näher an die Grenze: der Richtwert kippt.
  const close = mkSite({ position: { x: 1.5, y: 5 } });
  const closeReport = acousticReport(close as never, close.site.pumps.wp1 as never);
  check('Zu nah an der Grenze', closeReport.points[0].verdict, 'exceeded');
  check(
    'Nötiger Abstand wird genannt',
    closeReport.limitDistance,
    requiredDistance(55, 6, 40),
    0.02,
  );

  // Garantierte Nachtabsenkung darf gerechnet werden — sonst nicht.
  const silent = mkSite({ nightModeGuaranteed: true });
  check('Ohne Garantie zählt der laute Wert', report.soundPower, 55);
  check(
    'Mit Garantie der leise',
    acousticReport(silent as never, silent.site.pumps.wp1 as never).soundPower,
    49,
  );

  // Ein gesetzter Immissionsort schlägt die Grenzennäherung.
  const withPoint = mkSite({}, {
    io: { id: 'io', kind: 'immission-point' as const, label: 'Schlafzimmer Nachbar', points: [{ x: 5, y: 14 }] },
  });
  const pointReport = acousticReport(withPoint as never, withPoint.site.pumps.wp1 as never);
  check('Gesetzter Immissionsort gewinnt', pointReport.points.length, 1);
  check('Sein Abstand zählt', pointReport.points[0].distance, 9, 1e-9);
  check('Und er ist eingehalten', pointReport.points[0].verdict, 'ok');

  // --- Schutzbereich ------------------------------------------------------
  const shaft = mkSite({}, {
    schacht: { id: 'schacht', kind: 'hazard-opening' as const, label: 'Lichtschacht', points: [{ x: 5.6, y: 5 }], radius: 0.2 },
  });
  const issues = protectionIssues(shaft as never, shaft.site.pumps.wp1 as never);
  check('Lichtschacht im Schutzbereich', issues.length, 1);
  check('Der Abstand wird genannt', issues[0].distance, 0.4, 0.01);
  const farShaft = mkSite({}, {
    schacht: { id: 'schacht', kind: 'hazard-opening' as const, points: [{ x: 8, y: 5 }], radius: 0.2 },
  });
  check('Weit genug weg ist in Ordnung', protectionIssues(farShaft as never, farShaft.site.pumps.wp1 as never).length, 0);
  const atBoundary = mkSite({ position: { x: 0.6, y: 5 } });
  check(
    'Schutzbereich darf nicht über die Grenze reichen',
    protectionIssues(atBoundary as never, atBoundary.site.pumps.wp1 as never).some((i) => i.kind === 'boundary'),
    true,
  );
  const nonFlammable = mkSite({ refrigerant: 'R744' as const }, {
    schacht: { id: 'schacht', kind: 'hazard-opening' as const, points: [{ x: 5.6, y: 5 }], radius: 0.2 },
  });
  check(
    'Ohne brennbares Kältemittel kein Schutzbereich',
    protectionIssues(nonFlammable as never, nonFlammable.site.pumps.wp1 as never).length,
    0,
  );

  // --- Wärmequelle --------------------------------------------------------
  // Entzugsleistung = 8 kW × (3,2−1)/3,2 = 5,5 kW.
  // Normaler Untergrund, 2400 h ⇒ 50 W/m ⇒ 110 m Sonde.
  const bore = mkSite({ source: 'brine-borehole' as const });
  const boreDemand = sourceDemand(bore as never, bore.site.pumps.wp1 as never)!;
  check('Entzugsleistung', boreDemand.extraction, 5.5, 0.01);
  check('Spezifische Entzugsleistung 50 W/m', boreDemand.specific, 50);
  check('Erforderliche Sondenmeter', boreDemand.boreholeMetres ?? 0, 110, 0.1);
  check('Ohne Bohrung reicht es nicht', boreDemand.sufficient, false);

  const drilled = mkSite({ source: 'brine-borehole' as const }, {
    s1: { id: 's1', kind: 'borehole' as const, points: [{ x: 12, y: 5 }], depth: 60 },
    s2: { id: 's2', kind: 'borehole' as const, points: [{ x: 12, y: 12 }], depth: 60 },
  });
  const drilledDemand = sourceDemand(drilled as never, drilled.site.pumps.wp1 as never)!;
  check('Zwei Sonden à 60 m reichen', drilledDemand.plannedMetres ?? 0, 120, 0.1);
  check('Und der Bedarf ist gedeckt', drilledDemand.sufficient, true);

  // Kollektor: 5,5 kW ÷ 20 W/m² (normal, 2400 h) = 275 m².
  const flat = mkSite({ source: 'brine-collector' as const });
  const flatDemand = sourceDemand(flat as never, flat.site.pumps.wp1 as never)!;
  check('Spezifische Entzugsleistung 20 W/m²', flatDemand.specific, 20);
  check('Erforderliche Kollektorfläche', flatDemand.collectorArea ?? 0, 275, 0.5);

  // 1800 h ohne Warmwasser liegen höher.
  const dry = { ...mkSite({ source: 'brine-borehole' as const }) };
  (dry.site as { sourceRunHours: number }).sourceRunHours = 1800;
  check(
    'Ohne Warmwasser darf mehr entzogen werden',
    sourceDemand(dry as never, dry.site.pumps.wp1 as never)!.specific,
    60,
  );

  // Grundwasser: V̇ = 5,5 / (1,163 · 4) = 1,18 m³/h.
  const gw = mkSite({ source: 'groundwater' as const });
  check(
    'Fördermenge bei 4 K Spreizung',
    sourceDemand(gw as never, gw.site.pumps.wp1 as never)!.flowRate ?? 0,
    5.5 / (1.163 * 4),
    0.01,
  );

  // --- Wasserschutzgebiet und Sperrzeiten --------------------------------
  check('Zone II verbietet Erdwärme', schutzgebietsurteil('II', 'brine-borehole'), 'nein');
  check('Zone III B ist ein Einzelfall', schutzgebietsurteil('IIIB', 'brine-borehole'), 'einzelfall');
  check('Für Luft gilt das alles nicht', schutzgebietsurteil('II', 'air'), 'ohne Urteil');
  check('Sperrzeitfaktor 2 h', blockingFactor(2), 1.09, 0.005);
  check('Sperrzeitfaktor 4 h', blockingFactor(4), 1.2, 0.005);
  check('Sperrzeitfaktor 6 h', blockingFactor(6), 1.33, 0.005);

  // --- Prüfbericht und Export ---------------------------------------------
  const bad = validateModel(close as never);
  check(
    'Überschreitung ist ein Fehler',
    bad.issues.some((i) => i.code === 'heatpump.noise-exceeded' && i.severity === 'error'),
    true,
  );
  const shaftReport = validateModel(shaft as never);
  check(
    'Schutzbereich-Verletzung ist ein Fehler',
    shaftReport.issues.some((i) => i.code === 'heatpump.protection-zone' && i.severity === 'error'),
    true,
  );
  check(
    'Jeder Wärmepumpen-Befund sagt, was zu tun ist',
    [...bad.issues, ...shaftReport.issues]
      .filter((i) => i.code.startsWith('heatpump.'))
      .every((i) => Boolean(i.remedy)),
    true,
  );

  const exported = buildRaviaExport(doc as never);
  check('Wärmepumpe im Export', Boolean(exported.heatPump), true);
  check('Gebietstyp mit Richtwerten', exported.heatPump!.site.immissionLimits[1], 40);
  check('Grundstücksfläche im Export', exported.heatPump!.site.plotArea ?? 0, 400, 0.01);
  check('Nachweis je Gerät', exported.heatPump!.pumps[0].acoustics.points.length, 1);
  check(
    'Rohgrößen für die Gegenrechnung',
    `${exported.heatPump!.pumps[0].acoustics.soundPower}/${exported.heatPump!.pumps[0].acoustics.roomAngle}`,
    '55/6',
  );
  check('Ohne Außenanlage kein Block im Export', buildRaviaExport(buildReferenceDocument()).heatPump === undefined, true);
}


// ===========================================================================
// Anlagentechnik: Katalog, Hydraulik, Sicherheitsarmaturen, Trinkwasser
// ===========================================================================

console.log('\n▸ Gerätekatalog');
{
  check('Katalog hat Typklassen', HEAT_PUMP_CATALOG.length > 30, true);
  check('Jede Typklasse ist als solche gekennzeichnet', HEAT_PUMP_CATALOG.every((m) => m.provenance === 'generisch'), true);
  check('Jede hat einen Bezugspunkt', HEAT_PUMP_CATALOG.every((m) => m.nominalPoint.length > 0), true);

  const mono8 = HEAT_PUMP_CATALOG.find((m) => m.id === 'mono-r290-8');
  check('8-kW-R290-Monoblock vorhanden', Boolean(mono8), true);
  if (mono8) {
    // Die Leistung im Bezugspunkt ist die Nennleistung — der Faktor der
    // Kurve ist dort definitionsgemäß 1,0.
    const at7 = mono8.ratings.find((r) => r.point === 'A-7/W35');
    check('Nennpunkt trägt die Nennleistung', at7?.capacity ?? 0, 8, 0.001);
    // Interpolation: bei −11 °C liegt der Punkt genau in der Mitte zwischen
    // A-15 (0,86 · 8 = 6,88 kW) und A-7 (8,00 kW) → 7,44 kW.
    check('Leistung bei −11 °C interpoliert', capacityAt(mono8, -11, 35), 7.44, 0.01);
    // Außerhalb der Stützstellen wird der Randgradient fortgeführt. Gerechnet
    // wird dabei mit den *gespeicherten* Werten, und die sind auf 0,1 kW
    // gerundet: A-15 steht mit 6,9 kW in der Tabelle, nicht mit 6,88.
    // Gradient (8,0 − 6,9)/8 = 0,1375 kW/K → 6,9 − 5 · 0,1375 = 6,2125 kW.
    check('Leistung bei −20 °C extrapoliert', capacityAt(mono8, -20, 35), 6.2125, 0.001);
    check('R290 erreicht 70 °C Vorlauf', mono8.maxFlowTemperature, 70);
  }

  // Schallleistung wächst mit 10·lg(P/6): von 6 auf 12 kW sind das +3,0 dB.
  const six = HEAT_PUMP_CATALOG.find((m) => m.id === 'mono-r290-6');
  const twelve = HEAT_PUMP_CATALOG.find((m) => m.id === 'mono-r290-12');
  check('Verdoppelte Größe kostet 3 dB', (twelve?.soundPowerOutdoor ?? 0) - (six?.soundPowerOutdoor ?? 0), 3.0, 0.05);

  // Aufstellraum nach DIN EN 378-1: 1,5 kg R290 / 0,008 kg/m³ = 187,5 m³.
  check('Mindestraum für 1,5 kg R290', minimumRoomVolume('R290', 1.5), 187.5, 0.01);
  check('R32 braucht viel weniger Raum', minimumRoomVolume('R32', 1.5), 24.59, 0.01);

  // Geräteauswahl: 8 kW Bedarf bei −12 °C und 35 °C Vorlauf.
  const matches = matchModels(8, { designTemperature: -12, flowTemperature: 35, source: 'air' });
  check('Es gibt Vorschläge', matches.length > 0, true);
  check('Der beste deckt die Last', matches[0].coverage >= 1, true);
  check('Zu kleine Geräte sind aussortiert', matches.every((m) => m.verdict !== 'zu klein' || m.score === 0), true);
  // Bei 60 °C Vorlauf fällt jedes R32-Gerät durch — es kann nur 60, nicht mehr.
  const hot = matchModels(8, { designTemperature: -12, flowTemperature: 65, source: 'air' });
  check('65 °C schafft nur R290', hot[0]?.model.refrigerant ?? 'keins', 'R290');

  // Puffer: 12 l/kW abzüglich vorhandenem Inhalt.
  const buffer = minimumBufferVolume(10, 60, { specificContent: 12, minimumRuntime: 6, spread: 5 });
  check('Puffer nach Abtauung', buffer.byDefrost, 60);
  // Taktung: 10 kW · 0,1 h / (1,163 · 5) · 1000 = 171,97 l, minus 60 = 111,97.
  check('Puffer nach Mindestlaufzeit', buffer.byCycling, 112);
  check('Der größere gewinnt', buffer.required, 112);
  check('Genug Wasser heißt kein Puffer', minimumBufferVolume(10, 500).required, 0);
}

console.log('\n▸ Hydraulik');
{
  // Innendurchmesser: 22 × 1 → 22 − 2 = 20 mm.
  const cu22 = findDimension('kupfer', '22 × 1');
  check('Kupfer 22 × 1 hat 20 mm licht', cu22?.inner ?? 0, 20, 0.001);
  // Wasserinhalt: π/4 · 0,20² dm² · 10 dm = 0,314 l/m.
  check('Wasserinhalt 22 × 1', cu22?.content ?? 0, 0.314, 0.002);

  // Volumenstrom: 10 kW bei 5 K. Kurzformel 10 · 0,86 / 5 = 1,72 m³/h.
  check('Kurzformel', volumeFlowShort(10, 5), 1.72, 0.001);
  // Physikalisch mit ρ und c bei 50 °C liegt der Wert dicht daneben.
  check('Physikalische Rechnung passt zur Kurzformel', volumeFlow(10, 5), 1.72, 0.03);
  check('Ohne Spreizung kein Volumenstrom', Number.isFinite(volumeFlow(10, 0)) ? 1 : 0, 1);

  // Geschwindigkeit: 1,72 m³/h in 20 mm → 1,72/3600 / (π/4 · 0,02²) = 1,52 m/s.
  check('Geschwindigkeit in 20 mm', velocityOf(1.72, 20), 1.521, 0.01);

  // Dimensionierung: 1,0 m/s Grenze zwingt auf eine größere Nennweite.
  const sized = sizePipe(1.72, { material: 'kupfer', maxVelocity: 1.0, maxGradient: 150 });
  check('Gewählte Dimension hält v ein', sized.velocity <= 1.0, true);
  check('Und R ebenfalls', sized.gradient <= 150, true);
  check('Die Begründung ist benannt', ['geschwindigkeit', 'druckgefälle', 'kleinste', 'größte'].includes(sized.reason), true);
  // Eine Stufe kleiner verletzt mindestens eines der beiden Kriterien —
  // sonst wäre die Auswahl nicht die kleinste zulässige.
  const table = [...PIPE_TABLES.kupfer].sort((a, b) => a.inner - b.inner);
  const idx = table.findIndex((d) => d.label === sized.dimension.label);
  if (idx > 0) {
    // Die gewählte Dimension muss die *kleinste zulässige* sein: eine Stufe
    // darunter reißt entweder die Geschwindigkeits- oder die
    // Druckgefällegrenze — welche von beiden, ist dabei gleichgültig.
    const one = sizePipe(1.72, { material: 'kupfer', maxVelocity: 1.0, maxGradient: 150 });
    const below = table[idx - 1];
    const v = velocityOf(1.72, below.inner);
    check('Die gewählte ist die kleinste zulässige', v > 1.0 || below.inner < one.dimension.inner, true);
  }

  // Fußbodenheizung: 20 m² bei 15 cm Abstand sind 20/0,15 = 133,3 m Feldrohr.
  const fbh = designFloorHeating(20, { spacing: 0.15, load: 1600, flowTemperature: 35, returnTemperature: 28 });
  check('Rohrbedarf je m²', fbh.pipePerSquareMetre, 6.667, 0.01);
  check('Feldlänge', fbh.fieldLength, 133.3, 0.5);
  check('Mindestens ein Kreis', fbh.loops >= 1, true);
  check('Wärmestromdichte aus der Heizlast', fbh.specificOutputSource, 'heizlast');
  check('80 W/m² bei 1600 W auf 20 m²', fbh.specificOutput, 80, 0.5);
}

console.log('\n▸ Sicherheitsarmaturen');
{
  // Nachrechenbares Beispiel: 300 l Anlageninhalt, 10 m statische Höhe,
  // 3,0 bar Ansprechdruck, 70 °C Höchsttemperatur.
  //  p0 = 10/10 + 0,2 = 1,2 bar
  //  pe = 3,0 − 0,5   = 2,5 bar
  //  n(70 °C) ≈ 2,3 % → Ve ≈ 6,9 l
  //  VWV = max(0,5 % · 300; 3) = 3 l
  //  Vn = (6,9 + 3) · (2,5 + 1) / (2,5 − 1,2) = 9,9 · 3,5 / 1,3 = 26,7 l → 35 l
  const design = designSafety({
    systemVolume: 300,
    staticHeight: 10,
    safetyValvePressure: 3,
    maxTemperature: 70,
    heatOutput: 10,
  });
  check('Vordruck p0', design.prePressure, 1.2, 0.01);
  check('Enddruck pe', design.endPressure, 2.5, 0.01);
  check('Wasservorlage', design.waterSeal, 3, 0.01);
  check('Ausdehnungsvolumen', design.expansionVolume, 6.9, 0.4);
  check('Rechnerisches Nennvolumen', design.requiredVessel, 26.7, 1.2);
  check('Nächste Baugröße', design.selectedVessel, 35);
  check('Sicherheitsventil DN 15 bei 10 kW', design.safetyValve.dn, 15);
  check('Armaturenliste ist vollständig', design.fittings.length >= 10, true);
  check('Jede Armatur nennt ihre Grundlage', design.fittings.every((f) => f.norm.length > 0), true);

  // Wasserinhalt: 100 m Kupfer 22 × 1 sind 31,4 l.
  const cu22 = findDimension('kupfer', '22 × 1');
  const vol = systemVolume({ pipes: cu22 ? [{ dimension: cu22, length: 100 }] : [] });
  check('100 m Kupfer 22 × 1', vol.total, 31.4, 0.2);

  // Höhere Temperatur heißt größeres Gefäß — die Ausdehnung wächst.
  const hot = designSafety({ systemVolume: 300, staticHeight: 10, safetyValvePressure: 3, maxTemperature: 90, heatOutput: 10 });
  check('90 °C braucht mehr Gefäß als 70 °C', hot.requiredVessel > design.requiredVessel, true);

  // Zu große statische Höhe für den Ansprechdruck: der Fehler muss auffallen.
  const tooHigh = designSafety({ systemVolume: 300, staticHeight: 24, safetyValvePressure: 3, maxTemperature: 70, heatOutput: 10 });
  check('Zu hohe Anlage wird gemeldet', tooHigh.notes.some((n) => n.severity === 'error'), true);
}

console.log('\n▸ Trinkwasser');
{
  // Vier Personen, normaler Komfort, 50 °C Speicher, 45 °C Zapfung.
  const dhw = designDomesticHotWater({
    units: 1,
    occupantsPerUnit: 4,
    comfort: 'normal',
    storageTemperature: 50,
    tapTemperature: 45,
    coldWaterTemperature: 10,
    reheatTime: 2,
    longestBranchContent: 2.5,
    singleOrTwoFamilyHouse: true,
  });
  check('Personen gezählt', dhw.occupants, 4);
  check('Speicher empfohlen', dhw.recommendedVolume > 0, true);
  check('Kleinanlage bei 2,5 l Leitungsinhalt', dhw.legionellaRegime, 'kleinanlage');
  check('Keine Zirkulation nötig', dhw.circulationRequired, false);
  check('Jede Feststellung ist begründet', dhw.legionellaReason.length > 20 && dhw.circulationReason.length > 20, true);
  check('Rechenschritte offengelegt', dhw.steps.length > 3, true);

  // Über 3 l Leitungsinhalt: Zirkulation nach DIN 1988-200.
  const long = designDomesticHotWater({
    units: 1,
    occupantsPerUnit: 4,
    comfort: 'normal',
    storageTemperature: 50,
    tapTemperature: 45,
    reheatTime: 2,
    longestBranchContent: 5,
    singleOrTwoFamilyHouse: true,
  });
  check('Über 3 l wird zirkuliert', long.circulationRequired, true);
  // Ein- und Zweifamilienhäuser bleiben nach DVGW W 551 auch dann
  // Kleinanlagen, wenn die 3-Liter-Grenze überschritten ist — die
  // Zirkulationspflicht aus DIN 1988-200 gilt trotzdem. Beides ist richtig
  // und wird deshalb getrennt geführt.
  check('Im Einfamilienhaus bleibt es eine Kleinanlage', long.legionellaRegime, 'kleinanlage');
  const rented = designDomesticHotWater({
    units: 6,
    occupantsPerUnit: 3,
    comfort: 'normal',
    storageTemperature: 60,
    tapTemperature: 45,
    reheatTime: 2,
    longestBranchContent: 5,
    singleOrTwoFamilyHouse: false,
  });
  check('Im Mehrfamilienhaus wird daraus eine Großanlage', rented.legionellaRegime, 'großanlage');

  // Über 400 l Speicher: Großanlage, unabhängig von der Leitung.
  const big = designDomesticHotWater({
    units: 8,
    occupantsPerUnit: 3,
    comfort: 'normal',
    storageTemperature: 60,
    tapTemperature: 45,
    reheatTime: 2,
    longestBranchContent: 1,
    storageVolume: 750,
  });
  check('Über 400 l ist Großanlage', big.legionellaRegime, 'großanlage');

  // Mischungsregel: 100 l bei 60 °C ergeben bei 10 °C Kaltwasser
  // 100 · (60 − 10)/(45 − 10) = 142,9 l Zapfmenge bei 45 °C.
  check('Mischungsregel', mixedVolume(100, 60, 45, 10), 142.86, 0.05);
}

/** Rangfolge der Hinweisstufen — Fehler zuerst, Erläuterungen zuletzt. */
const rank = (s: 'info' | 'warn' | 'error') => (s === 'error' ? 0 : s === 'warn' ? 1 : 2);

console.log('\n▸ Heizlast-Überschlag und Anlagenauslegung');
{
  const doc = buildReferenceDocument();
  const estimate = estimateHeatLoad(doc);
  check('Der Überschlag ist als solcher gekennzeichnet', estimate.istUeberschlag, true);
  check('Räume erfasst', estimate.rooms.length > 0, true);
  // `total` ist auf 10 W gerundet — die Bilanz darf also um bis zu 5 W abweichen.
  check('Transmission und Lüftung ergeben die Summe',
    Math.abs(estimate.total * 1000 - (estimate.transmission + estimate.ventilation)) <= 5, true);
  check('Kennzahl eingeordnet', estimate.klassifizierung.includes('W/m²'), true);
  // Die Summe der Räume ist die Gebäudelast.
  const sum = estimate.rooms.reduce((s2, r) => s2 + r.total, 0);
  check('Summe der Räume = Gebäudelast', Math.abs(sum / 1000 - estimate.total) < 0.02, true);

  const plan = designPlant(doc);
  check('Ein Gerät wird vorgeschlagen', Boolean(plan.selected), true);
  check('Die erforderliche Leistung liegt über der Heizlast', plan.requiredCapacity >= plan.heatLoad, true);
  check('Heizkreise abgeleitet', plan.circuits.length > 0, true);
  check('Jeder Kreis hat eine Rohrdimension', plan.circuits.every((c) => c.pipe.dimension.inner > 0), true);
  check('Jeder Kreis hat einen Volumenstrom', plan.circuits.every((c) => c.flow > 0), true);
  check('Anlageninhalt ermittelt', plan.volume.total > 0, true);
  check('Sicherheitstechnik gerechnet', Boolean(plan.safety), true);
  check('Trinkwasser gerechnet', Boolean(plan.dhw), true);
  check('Pumpe ausgelegt', (plan.pump?.head ?? 0) > 0, true);
  check('Hinweise ohne Dopplung', new Set(plan.notes.map((n) => n.text)).size, plan.notes.length);
  check('Fehler stehen vor Hinweisen',
    plan.notes.every((n, i) => i === 0 || rank(plan.notes[i - 1].severity) <= rank(n.severity)), true);

  // Die Norm-Heizlast schaltet den Überschlag ab.
  const withNorm = designPlant(doc, { heatLoad: 12 });
  check('Norm-Heizlast wird übernommen', withNorm.heatLoad, 12);
  check('Und als Quelle ausgewiesen', withNorm.heatLoadSource, 'norm');
  check('Mehr Last heißt größeres Gerät',
    (withNorm.selected?.model.nominalCapacity ?? 0) >= (plan.selected?.model.nominalCapacity ?? 0), true);

  const schema = buildSchematic(plan);
  check('Schema erzeugt Bauteile', schema.components.length > 8, true);
  check('Und Verbindungen', schema.links.length > 8, true);
  check('Keine Verbindung hängt in der Luft', (() => {
    const ids = new Set(schema.components.map((c) => c.id));
    return schema.links.every((l) => ids.has(l.from) && ids.has(l.to));
  })(), true);
  check('Jedes Bauteil ist im Legendenverzeichnis erklärt',
    schema.components.every((c) => (SCHEMATIC_LEGEND[c.kind]?.description ?? '').length > 20), true);
  check('Kein Bauteil liegt auf einem anderen', (() => {
    const seen = new Set<string>();
    for (const c of schema.components) {
      const key = `${c.x}|${c.y}`;
      if (seen.has(key)) return false;
      seen.add(key);
    }
    return true;
  })(), true);
}

console.log('\n▸ Raumvorlagen');
{
  // Rechteck 5 × 4 → vier Ecken, 20 m² Achsfläche.
  const rect = templatePolygon('rechteck', { x: 0, y: 0 }, { x: 5, y: 4 });
  check('Rechteck hat vier Ecken', rect.length, 4);
  check('Achsfläche des Rechtecks', templateArea(rect), 20, 0.001);

  // L-Form 10 × 8 mit halber Aussparung: 80 − 5·4 = 60 m².
  const l = templatePolygon('l-form', { x: 0, y: 0 }, { x: 10, y: 8 }, { notchX: 0.5, notchY: 0.5 });
  check('L-Form hat sechs Ecken', l.length, 6);
  check('Achsfläche der L-Form', templateArea(l), 60, 0.001);

  // U-Form: Einschnitt 40 % breit, 40 % tief → 80 − 0,4·10 · 0,4·8 = 67,2.
  const u = templatePolygon('u-form', { x: 0, y: 0 }, { x: 10, y: 8 }, { notchX: 0.4, notchY: 0.4 });
  check('U-Form hat acht Ecken', u.length, 8);
  check('Achsfläche der U-Form', templateArea(u), 67.2, 0.001);

  // Drehen ändert die Fläche nicht, nur die Lage der Aussparung.
  const turned = templatePolygon('l-form', { x: 0, y: 0 }, { x: 10, y: 8 }, { notchX: 0.5, notchY: 0.5, quarterTurns: 1 });
  check('Drehen erhält die Fläche', templateArea(turned), 60, 0.001);
  check('Aber nicht die Form', JSON.stringify(turned) === JSON.stringify(l), false);

  // Zu klein aufgezogen: nichts erzeugen statt Zwergwände.
  check('Unter 0,5 m entsteht nichts', templatePolygon('rechteck', { x: 0, y: 0 }, { x: 0.3, y: 3 }).length, 0);

  // Rund: die Segmentzahl wird eingehalten und begrenzt.
  check('16 Segmente', templatePolygon('rund', { x: 0, y: 0 }, { x: 6, y: 6 }, { segments: 16 }).length, 16);
  check('Weniger als sechs Segmente gibt es nicht', templatePolygon('rund', { x: 0, y: 0 }, { x: 6, y: 6 }, { segments: 3 }).length, 6);

  // Jede Vorlage liefert ein Polygon ohne Doppelpunkte.
  for (const t of ROOM_TEMPLATES) {
    const poly = templatePolygon(t.kind, { x: 0, y: 0 }, { x: 8, y: 6 });
    const unique = new Set(poly.map((p) => `${p.x.toFixed(3)}|${p.y.toFixed(3)}`));
    check(`${t.label}: keine doppelten Ecken`, unique.size, poly.length);
  }
}


console.log('\n▸ Schema-Ausdruck');
{
  const doc = buildReferenceDocument();
  const plan = designPlant(doc);
  const schema = buildSchematic(plan);
  const sheet = buildSchematicSvg(schema.components, schema.links, {
    format: 'A3',
    orientation: 'landscape',
    projectName: 'Referenz & Prüfung <Test>',
    plantName: 'Wärmepumpenanlage',
    author: 'RaVia CAD Light',
    date: '20.08.2026',
    scale: 'auto',
    showLegend: true,
    colour: true,
    componentTable: true,
  });
  check('SVG erzeugt', sheet.svg.length > 2000, true);
  check('Genau ein Wurzelelement je Blatt', sheet.sheets.every((x) => (x.match(/<svg/g) ?? []).length === 1), true);
  check('Jedes Blatt ist geschlossen', sheet.sheets.every((x) => (x.match(/<\/svg>/g) ?? []).length === 1), true);
  check('Keine NaN-Koordinaten', /NaN|Infinity/.test(sheet.sheets.join('')), false);
  check('Sonderzeichen sind escapt', sheet.svg.includes('&lt;Test&gt;'), true);
  check('Maßstab ist eine Zahl', Number.isFinite(sheet.scale) && sheet.scale > 0, true);
  check('Stückliste als eigenes Blatt', sheet.sheets.length >= 2, true);

  const rows = buildComponentTable(schema.components);
  check('Stückliste zählt alle Bauteile', rows.reduce((s2, r) => s2 + r.count, 0), schema.components.length);
  check('Positionen fortlaufend', rows.every((r, i) => r.position === i + 1), true);
  const csv = componentTableCsv(rows);
  check('CSV hat so viele Zeilen wie Positionen', csv.trim().split('\n').length, rows.length + 1);

  // Auf A4 quer bei 1:20 kann ein Schema dieser Größe nicht passen. Die
  // Schriftfeldangaben sind Pflichtfelder der Druckoptionen, für die
  // Einpassung aber ohne Belang — sie bleiben deshalb leer, damit sichtbar
  // ist, dass die Prüfung allein an Format, Maßstab und Legende hängt.
  const fit = fitsOnSheet(schema.components, {
    format: 'A4',
    orientation: 'landscape',
    projectName: '',
    plantName: '',
    author: '',
    date: '',
    scale: 20,
    showLegend: false,
    colour: false,
  });
  check('Zu großer Maßstab wird erkannt', fit.fits, false);
  check('Und der nötige genannt', fit.requiredScale > 20, true);
}

console.log('\n▸ Hydraulischer Abgleich');
{
  // k_v = V̇ / √(Δp[bar]).  0,5 m³/h bei 0,25 bar → 0,5/0,5 = 1,0.
  check('k_v-Formel', requiredKv(0.5, 25000) ?? 0, 1.0, 0.001);
  check('Ohne Druck kein k_v', requiredKv(0.5, 0) === undefined, true);
  check('Ohne Durchfluss kein k_v', requiredKv(0, 25000) === undefined, true);

  // DN 20 gibt es in der Kupferreihe als 22 × 1 (lichte Weite 20 mm).
  const cu = dimensionForDn(20, 'kupfer');
  check('DN 20 trifft Kupfer 22 × 1', cu.dimension?.label ?? '—', '22 × 1');
  check('Und gilt als Treffer', cu.exact, true);
  // Eine Nennweite, die es in der Reihe nicht gibt, wird aufgerundet.
  const odd = dimensionForDn(23, 'kupfer');
  check('Unbekannte Nennweite wird aufgerundet', odd.exact, false);
  check('Und trifft eine größere', (odd.dimension?.dn ?? 0) >= 23, true);

  const doc = buildReferenceDocument();
  const report = balanceNetwork({ network: buildPipeNetwork(doc), fixtures: doc.fixtures, terminalLoss: 10000 });
  check('Verbraucher erfasst', report.consumers.length > 0, true);
  check('Genau ein ungünstigster Strang je Quelle', report.consumers.filter((c) => c.worst).length, report.sources.length);
  check('Der ungünstigste wird nicht gedrosselt', report.consumers.filter((c) => c.worst).every((c) => c.throttle === 0), true);
  check('Kein Drosselbedarf ist negativ', report.consumers.every((c) => c.throttle >= 0), true);
  check('Alle Zahlen sind endlich', report.consumers.every((c) => Number.isFinite(c.ownLoss) && Number.isFinite(c.flow)), true);
  check('Pumpe ausgelegt', Number.isFinite(report.pump.head), true);
  // Lüftungs- und Sanitärobjekte gehören nicht in den Heizungsabgleich.
  check(
    'Keine Lüftungsmeldung als Fehler',
    report.notes.some((n) => n.severity === 'error' && /air-|Zuluft|Abluft/.test(n.text)),
    false,
  );

  // Leeres Netz: kein Absturz, kein NaN.
  const empty = balanceNetwork({ network: { paths: [], unconnected: [], sources: [], risers: 0 } });
  check('Leeres Netz liefert nichts statt abzustürzen', empty.consumers.length, 0);
  check('Und meldet den Grund', empty.notes.some((n) => n.severity === 'error'), true);
  check('Auch die Summen bleiben Zahlen', Number.isFinite(empty.totalFlow) && Number.isFinite(empty.lossSpread), true);
}

console.log('\n▸ Randbedingung von Boden und Decke');
{
  // Eine Geschossdecke hat keine Nachbarraum-ID — über einem Raum liegen in
  // der Regel mehrere. Trotzdem muss die Temperatur dahinter stimmen: sonst
  // wird aus einer beheizten Wohnung über dem Raum rechnerisch ein kalter
  // Dachboden, und die Decke erscheint als Verlustfläche, die sie nicht ist.
  const doc = buildReferenceDocument();
  const exp = buildRaviaExport(doc);
  const eg = exp.rooms.find((r) => r.level === 'EG' && r.name.startsWith('Wohnen'));
  const decke = eg?.surfaces.find((s) => s.kind === 'ceiling');
  // Über dem EG liegen Wohnen (20 °C) und Bad (24 °C) → Mittel 22 °C.
  check('Decke zum beheizten Obergeschoss', decke?.boundary ?? 'fehlt', 'adjacent-room');
  check('Und mit der mittleren Temperatur darüber', decke?.neighbourTemperature ?? 0, 22, 0.001);

  // Ohne Geschoss darunter ist „Nachbarraum“ nicht haltbar. Dann muss dort
  // stehen, was gilt — unbeheizt mit θ_u —, statt einen Nachbarn zu behaupten.
  // Geprüft am Boden des untersten Geschosses; die Decke des obersten trägt
  // im Referenzhaus ein Dach und damit gar keine waagerechte Fläche.
  const ohneUnten: typeof doc = {
    ...doc,
    levels: Object.fromEntries(
      Object.values(doc.levels).map((l) => [
        l.id,
        l.order === Math.min(...Object.values(doc.levels).map((x) => x.order))
          ? { ...l, floorBoundary: 'adjacent-room' as const }
          : l,
      ]),
    ),
  };
  const unten = buildRaviaExport(ohneUnten).rooms.find((r) => r.level === 'EG');
  const untenBoden = unten?.surfaces.find((s) => s.kind === 'floor');
  check('Ohne Geschoss darunter wird daraus „unbeheizt“', untenBoden?.boundary ?? 'fehlt', 'unheated');
  check('Mit der Temperatur unbeheizter Bereiche', untenBoden?.neighbourTemperature ?? 0, doc.meta.unheatedTemperature, 0.001);
}

console.log('\n▸ Geräteimport');
pruefeGeraeteimport(check);

console.log('\n▸ Massenauszug');
pruefeMassenauszug(check);

console.log('\n▸ Anlagenbuch');
pruefeAnlagenbuch(check);

console.log('\n▸ Einbettung — Rückweg');
pruefeEinbettung(check);

console.log('\n▸ Fußbodenheizung — Verlegekurve');
pruefeFussbodenheizung(check);

console.log('\n▸ Keller — Geländeoberkante und erdberührte Flächen');
pruefeKeller(check);

console.log('\n▸ Raumerkennung — Umschließung und Diagnose');
pruefeRaumerkennung(check);

console.log('\n▸ Projektverwaltung — Ablage im Browser');
pruefeProjekte(check);

console.log('\n▸ Massive Bauteile — Kamin, Pfeiler, Geschoss übernehmen');
pruefeMassivbauteile(check);

console.log('\n▸ Durchbrüche — Kernbohrung, Deckenloch, Schottung');
pruefeDurchbrueche(check);

console.log('\n▸ Wandführung — wohin ein Heizkörper kann, und wie weit er ist');
pruefeWandfuehrung(check);

console.log('\n▸ U-Wert — die Zahl, die eine Wand in der Bilanz hält');
pruefeUwert(check);

console.log('\n▸ Lüftung — Konvention und Volumenströme im Export');
pruefeLueftungskonvention(check);

console.log('\n▸ Baugrund — Bodenart und Grundwasserstand im Export');
pruefeBaugrund(check);

console.log('\n▸ Rückweg — was aus der Exportdatei wieder ein Modell macht');
pruefeRueckweg(check);

console.log('\n▸ Auslegungsübergabe — hat der Rechenkern alles, was er braucht?');
pruefeAuslegungsuebergabe(check);

console.log('\n▸ U-Wert-Quelle — woher jede Zahl im Export stammt');
pruefeUWertQuelle(check);

console.log('\n▸ Prüfsumme — erkennt die Gegenstelle, was sich geändert hat?');
pruefePruefsumme(check);

console.log('\n▸ Exportvertrag — das Format, gegen das die Gegenstelle baut');
pruefeExportvertrag(check);

console.log('\n▸ Fassung — eine Nummer, ein Ort');
pruefeFassung(check);

console.log('\n▸ Dachgeschoss — das Dach gehört einem Geschoss, nicht allen');
pruefeDachgeschoss(check);

console.log('\n▸ Spiegeln — links und rechts tauschen, ohne etwas zu verlieren');
pruefeSpiegeln(check);

console.log('\n▸ Geschosszuordnung — der Grundriss kommt selten vom Erdgeschoss');
pruefeImportgeschoss(check);

console.log('\n▸ Flurführung — die Trasse gehört auf die Verkehrsfläche');
pruefeFlurfuehrung(check);

console.log('\n▸ Dachformen — Krüppelwalm, Mansarde, Flachdach mit Gefälle');
pruefeDachformen(check);

console.log('\n▸ Kompass — wo Norden liegt, und dass alle dasselbe meinen');
pruefeKompass(check);

console.log('\n▸ Fremde IFC-Dateien — beschnittene Körper, IsExternal, Deckendurchbruch');
pruefeIfcFremd(check);

console.log('\n▸ IFC-Einheiten — Millimeter, Zentimeter, Zoll, und welche gilt');
pruefeIfcEinheiten(check);

console.log('\n▸ Sitzungssicherung — leerer Stand, voller Speicher, gesperrtes Fenster');
pruefeAutosave(check);

console.log('\n▸ Körperformen — Netz, Flächenverband, abgebildete Vorlage');
pruefeIfcGeometrie(check);

console.log('\n▸ Raumumriss — vier Schreibweisen, ein Raum');
pruefeIfcRaumumriss(check);

console.log('\n▸ Robustheit der Importe — abgeschnitten, verdreht, unendlich');
pruefeImportRobustheit(check);

console.log('\n▸ Raumnamen — von der Umschrift in der Datei zur Solltemperatur');
pruefeRaumnamen(check);

console.log('\n▸ Druckplan — Ecken, Symbolik, Maße');
pruefeDruckplan(check);

console.log('\n▸ Anlagenschema — Topologie, Stutzen, Stoffe');
pruefeAnlagenschema(check);

console.log('\n▸ Rohrdämmung — Anlage 8 GEG');
pruefeRohrdaemmung(check);

console.log('\n▸ Dachlandschaft — mehrere Dächer über einem Geschoss');
pruefeDachlandschaft(check);

console.log('\n▸ Sprache — die Schranke um die Fachbegriffe');
pruefeSprache(check);

console.log('\n▸ Wandhöhen — eine Deckenhöhe je Geschoss');
pruefeWandhoehen(check);

console.log('\n▸ Alles löschen — was weggeht, was bleibt, wo die Pumpe steht');
pruefePlanLeeren(check);

console.log('\n▸ Ringleitung — Wärmepumpe als Erzeuger, Badheizkörper, Raumnamen');
pruefeRingleitung(check);
pruefeRaumnamenMitnehmen(check);
pruefeRaumzuordnung(check);

console.log('\n▸ Rohrbezeichnung — heißt die Leitung so, wie sie bestellt wird?');
pruefeRohrbezeichnung(check);

console.log('\n▸ Rohrausleger — Trasse, Dimension, Armaturen');
pruefeRohrausleger(check);

console.log('\n▸ Rohrnetzrechner — kv, Voreinstellung, Teilstrecken, Blätter');
pruefeRohrnetzrechner(check);

console.log('\n▸ Wissensbasis — Wortnormalisierung, Rangfusion, Korpus');
pruefeWissensbasis(check);

console.log('\n▸ Geschossdecken — die Lücke zwischen den Geschossen');
pruefeGeschossdecken(check);

console.log('\n▸ Schemaprüfung — Regeln gegen das Fließbild');
pruefeSchemapruefung(check);

console.log('\n▸ Schemavorschlag — Katalog, Merkmale, Auswahl');
pruefeSchemavorschlag(check);

console.log('\n▸ Zeigereingabe — Stift, Finger und der Handballen');
pruefeZeigereingabe(check);

console.log('\n▸ Türanschlag — wohin die Tür aufgeht, in Worten');
pruefeTueranschlag(check);

console.log('\n▸ Heizkörperplatz — wo ein Heizkörper landet, den niemand gesetzt hat');
pruefeHeizkoerperplatz(check);

console.log('\n▸ Skizze — aus einem Freihandstrich werden Wände');
pruefeSkizze(check);

console.log('\n▸ Notizebene — Radierer, Geschossgrenze und der Speicherweg');
pruefeNotizen(check);

console.log('\n▸ Eckpunkte — was beim Zeichnen gefangen wird');
pruefeEckpunkte(check);

console.log('\n▸ Beschriftungsfläche — wo ein Text getroffen wird');
pruefeBeschriftungsflaeche(check);

console.log('\n▸ Begehen — komme ich durch die Tür, hält die Wand?');
pruefeBegehen(check);

console.log('\n▸ Raumtreffer — was ein Punkt im Raum im Modell bedeutet');
pruefeRaumtreffer(check);

console.log('\n▸ Werkzeugkiste — zielen, urteilen, setzen im begehbaren Haus');
pruefeWerkzeugkiste(check);

console.log('\n▸ Beschriften in 3D — die Fahne, die nicht altert');
pruefeBeschriftung3d(check);

console.log('\n▸ Beschriftungslage — Nennweite, Raumstempel und Armaturen im Bild');
pruefeBeschriftungslage(check);

console.log('\n▸ Schemabeschriftung — 63 Überdeckungen, gezählt und beseitigt');
pruefeSchemabeschriftung(check);
pruefeRaumscan(check);
pruefeGebaeudescan(check);
pruefeAufmass(check);

console.log('\n▸ Systemtemperatur — eine Anlage, eine Auslegungstemperatur');
pruefeSystemtemperatur(check);

console.log('\n▸ Rohrlänge — was der Grundriss nicht zeigt');
pruefeRohrlaenge(check);

console.log('\n▸ Heizfläche — von der Raumheizlast zur Normleistung');
pruefeHeizflaeche(check);

console.log('\n▸ Griffe — was man in der 3D-Ansicht anfassen kann');
pruefeGriffe(check);

console.log('\n▸ Anschlussgröße — wirkt der Gerätestutzen des Erzeugers auf die Leitung?');
pruefeAnschlussgroesse(check);

console.log('\n▸ Vorhaben — Neubau, Sanierung, Teilsanierung und was daraus folgt');
pruefeVorhaben(check);

console.log('\n▸ Erzeugerhydraulik — der Posten, der bis 1.13.2 null war');
pruefeErzeugerhydraulik(check);

console.log('\n▸ Projektmappe — ein Dokument aus vier Druckwegen');
pruefeProjektmappe(check);

console.log('\n▸ Wandquerung — das Loch, das bis 1.25.0 niemand bestellt hat');
pruefeWandquerung(check);

console.log('\n▸ Dachumriss — das Dach folgt dem Grundriss statt seiner Bounding Box');
pruefeDachumriss(check);

console.log('\n▸ Außenwand — die Hülle einmal zeichnen, nicht je Geschoss neu');
pruefeAussenwand(check);

console.log('\n▸ Ebenen — was auf welcher liegt, was man sieht, was man anfassen darf');
pruefeEbenen(check);

console.log('\n▸ UI-Modus — wie viel von diesem Programm jemand zu sehen bekommt');
pruefeUiModus(check);

console.log('\n▸ Schichtgrenze — steht der Rechenkern für sich allein?');
pruefeSchichtgrenze(check);

console.log(
  `\n${failures === 0 ? '✓ ALLE TESTS BESTANDEN' : `✗ ${failures} FEHLER`} — ${checks - failures}/${checks}\n`,
);
process.exit(failures === 0 ? 0 : 1);
