/**
 * Prüfblock „Massive Bauteile" — Kamin, Pfeiler, Wandversatz.
 *
 * **Warum dieser Block gebraucht wird.** Ein massives Bauteil wirkt an drei
 * Stellen zugleich, und an jeder davon fällt ein Fehler leise aus: es nimmt
 * dem Raum Grundfläche und Luftvolumen (die Heizlast wird zu groß gerechnet,
 * wenn es fehlt), es steht auf dem Estrich (die Fußbodenheizung würde sonst
 * unter Mauerwerk verlegt), und an der Außenwand ist es eine Wärmebrücke
 * (die hier nicht gerechnet, aber übergeben wird). Alle drei Wirkungen sind
 * Zahlen, die niemandem auffallen, wenn sie um zwei Zehntel danebenliegen.
 *
 * Dazu kommt die Frage, die sich der Anwender beim Aufmaß seiner Wohnung
 * gestellt hat: was passiert beim Übernehmen eines Geschosses? Eine Treppe
 * verbindet zwei Geschosse und existiert genau einmal — sie darf sich beim
 * Kopieren nicht verdoppeln, muss im Geschoss darüber aber weiterhin richtig
 * rechnen. Ein Schornstein durchstößt jede Decke und darf sich ebenso wenig
 * verdoppeln; ein Pfeiler gehört zu einem Geschoss und muss mitkopiert
 * werden. Das sind drei verschiedene Antworten auf dieselbe Geste, und
 * deshalb stehen sie hier alle drei.
 *
 * **Was hier steht und was woanders steht.** Dieser Block prüft ausschließlich
 * gegen den Rechenkern. Er kennt weder den Store noch die Oberfläche — nicht
 * aus Sparsamkeit, sondern weil `src/lib` und `src/types` als eigenständiges
 * Paket an die Gegenstelle gehen (siehe `build_kernel.py`) und ein Prüfblock,
 * der aus `src/store` importiert, dieses Paket zerreißt. Die Kopierregel wurde
 * deshalb als reine Funktion nach `src/lib/levelCopy.ts` gezogen und wird hier
 * dort geprüft; `useBimStore.addLevel` ruft sie nur noch auf. Der vollständige
 * Rundlauf Speichern → Öffnen läuft zwangsläufig durch den Store und steht im
 * Rauchtest `scripts/smoke-round2.mjs`.
 *
 * Alle Sollwerte sind aus der Geometrie hergeleitet und im Kommentar
 * ausgerechnet; keiner stammt aus einem Probelauf. Normwerte kommen nicht
 * vor — dieser Block prüft Flächen, Volumina und Kopierregeln, und für die
 * gibt es keine Norm, sondern nur Arithmetik.
 */

import type { CheckFn } from './typ';
import type { BimDocument, BimNode, Level, SolidElement, Vec2, VerticalElement, Wall } from '../../src/types/bim';
import { emptyPlant, emptySite } from '../../src/lib/plantDefaults';
import { applyVerticalDeductions, detectRooms } from '../../src/lib/roomDetection';
import { buildRaviaExport } from '../../src/lib/raviaExport';
import {
  measureLayableArea,
  planFloorLoops,
  DEFAULT_EDGE_CLEARANCE,
  DEFAULT_OBSTACLE_CLEARANCE,
} from '../../src/lib/floorLoopLayout';
import { copiesWithLevel, copyLevelContents } from '../../src/lib/levelCopy';
import { pointInPolygon } from '../../src/lib/geometry';
import { solidFootprint } from '../../src/lib/verticalSymbols';

// ---------------------------------------------------------------------------
// Das Prüfhaus
// ---------------------------------------------------------------------------

/** Achsmaße [m]: Rechteck 6,00 × 4,00, Wandstärke 0,24, lichte Höhe 2,75. */
const BREITE = 6;
const TIEFE = 4;
const DICKE = 0.24;
const HOEHE = 2.75;

/** Lichte Grundfläche [m²] = (6,00 − 0,24) × (4,00 − 0,24) = 5,76 × 3,76. */
const GRUNDFLAECHE = (BREITE - DICKE) * (TIEFE - DICKE);
/** Luftvolumen ohne Einbauten [m³] = 21,6576 × 2,75. */
const VOLUMEN = GRUNDFLAECHE * HOEHE;

/** Maße des Kamins [m] — einzügiger Schornstein mit Mantelstein. */
const KAMIN_L = 0.5;
const KAMIN_B = 0.4;
/** Grundfläche des Kamins [m²] = 0,50 × 0,40. */
const KAMIN_A = KAMIN_L * KAMIN_B;

/**
 * Lage des Kamins: mittig an der Nordwand.
 *
 * Die Nordwand hat ihre Achse bei y = 4,00 und ist 0,24 m stark, ihre
 * raumseitige Fläche liegt also bei y = 3,88. Der Kamin ist 0,40 m tief;
 * sein Mittelpunkt bei y = 3,68 setzt seine Nordkante genau auf diese
 * Fläche. Damit ist die Berührungslänge exakt seine Länge, 0,50 m.
 */
const KAMIN_POS = { x: 3, y: TIEFE - DICKE / 2 - KAMIN_B / 2 };
/** Der Pfeiler steht frei in der Raummitte — die Gegenprobe zur Wärmebrücke. */
const PFEILER_POS = { x: 1.5, y: 1.5 };

/**
 * Grundflächen der Vorgabemaße des Werkzeugs [m²].
 *
 * Block 4 und 5 setzen die Bauteile mit den Maßen, die ein Klick im Plan
 * erzeugt: 0,40 × 0,40 m beim Schornstein (einzügig mit Mantelstein),
 * 0,365 × 0,365 m beim Pfeiler (halbe Steinlänge zuzüglich Fuge). Die Zahlen
 * stehen hier als Klartext und werden nicht aus dem Werkzeug gelesen — sonst
 * prüfte die Zeile den Vorgabewert gegen sich selbst.
 */
const WERKZEUG_KAMIN_A = 0.4 * 0.4;
const WERKZEUG_PFEILER_A = 0.365 * 0.365;

function baueHaus(): BimDocument {
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

  const wand = (name: string, a: string, b: string): void => {
    walls[name] = {
      id: name,
      a,
      b,
      levelId: 'eg',
      type: 'exterior',
      thickness: DICKE,
      uValue: 0.28,
      height: HOEHE,
      layerId: 'layer-walls',
    };
  };
  wand('w-s', sw, se);
  wand('w-e', se, ne);
  wand('w-n', ne, nw);
  wand('w-w', nw, sw);

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

  const doc: BimDocument = {
    site: emptySite(),
    plant: emptyPlant(),
    meta: {
      name: 'Prüfhaus Massivbauteile',
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
    raum.name = 'Wohnen';
    raum.setpointTemperature = 20;
    raum.isHeated = true;
  }
  return doc;
}

/** Ein massives Bauteil als Rechteck — die Vorgabe des Werkzeugs. */
function massiv(id: string, kind: SolidElement['kind'], pos: { x: number; y: number }, l: number, b: number, durch: boolean): SolidElement {
  return {
    id,
    kind,
    name: id,
    levelId: 'eg',
    position: pos,
    length: l,
    width: b,
    rotation: 0,
    throughAllLevels: durch,
  };
}

/** Der eine Raum des Prüfhauses. */
const raumVon = (doc: BimDocument) => Object.values(doc.rooms)[0];

const r3 = (v: number): number => Math.round(v * 1000) / 1000;

// ---------------------------------------------------------------------------

export function pruefeMassivbauteile(check: CheckFn): void {
  // === 1 — Grundfläche und Volumen eines Raums mit Kamin ====================
  const doc = baueHaus();
  const raumRoh = raumVon(doc);
  check('Lichte Grundfläche des Prüfraums', r3(raumRoh.area), r3(GRUNDFLAECHE), 0.002);
  check('Luftvolumen ohne Einbauten', r3(raumRoh.volume), r3(VOLUMEN), 0.005);

  const kamin = massiv('kamin', 'chimney', KAMIN_POS, KAMIN_L, KAMIN_B, true);
  doc.solids = { kamin };
  applyVerticalDeductions(Object.values(doc.rooms), [], ['eg'], [kamin]);
  const raum = raumVon(doc);

  // 0,50 × 0,40 = 0,20 m².
  check('Kaminfläche abgezogen', r3(raum.floorOpeningArea ?? 0), KAMIN_A, 0.002);
  check('Und als massiver Anteil ausgewiesen', r3(raum.solidArea ?? 0), KAMIN_A, 0.002);
  // Ein Kamin öffnet keine Decke — dort steht Mauerwerk, kein Luftraum.
  check('Die Decke bleibt geschlossen', r3(raum.openToAboveArea ?? 0), 0, 0.001);
  // 21,6576 − 0,20 = 21,4576 m²; 21,4576 × 2,75 = 59,0084 m³.
  check('Luftvolumen um Fläche × Höhe kleiner', r3(raum.volume), r3((GRUNDFLAECHE - KAMIN_A) * HOEHE), 0.005);
  check('Das sind genau 0,55 m³ weniger', r3(VOLUMEN - raum.volume), r3(KAMIN_A * HOEHE), 0.005);

  // === 2 — Wirkung im Export ===============================================
  doc.solids = { kamin, pfeiler: massiv('pfeiler', 'pier', PFEILER_POS, 0.365, 0.365, false) };
  applyVerticalDeductions(Object.values(doc.rooms), [], ['eg'], Object.values(doc.solids));
  const exp = buildRaviaExport(doc);
  const expRaum = exp.rooms[0];

  check('Der Export führt beide massiven Bauteile', exp.solids.length, 2);
  const expKamin = exp.solids.find((s) => s.id === 'kamin');
  check('Der Kamin steht als Kamin darin', expKamin?.kind ?? 'fehlt', 'chimney');
  check('Mit seiner Grundfläche', r3(expKamin?.area ?? 0), KAMIN_A, 0.002);
  // Umfang 2 × (0,50 + 0,40) = 1,80 m; Volumen 0,20 × 2,75 = 0,55 m³.
  check('Mit seinem Umfang', r3(expKamin?.perimeter ?? 0), 2 * (KAMIN_L + KAMIN_B), 0.002);
  check('Mit voller Geschosshöhe', r3(expKamin?.height ?? 0), HOEHE, 0.002);
  check('Und dem daraus folgenden Bauvolumen', r3(expKamin?.volume ?? 0), r3(KAMIN_A * HOEHE), 0.005);
  check('Sein Umriss hat vier Punkte', expKamin?.outline.length ?? 0, 4);
  check('Er ist dem Raum zugeordnet', expKamin?.roomId ?? 'fehlt', raum.id);

  // Wärmebrücke: nur die Eingangsgrößen, kein ψ.
  check('Der Kamin steht an der Außenwand', expKamin?.thermalBridge.atExteriorWall ?? false, true);
  check('Berührungslänge ist seine Länge', r3(expKamin?.thermalBridge.contactLength ?? 0), KAMIN_L, 0.002);
  check('Genau eine Wand ist berührt', expKamin?.thermalBridge.wallIds.length ?? 0, 1);
  check('Und zwar die Nordwand', expKamin?.thermalBridge.wallIds[0] ?? 'fehlt', 'w-n');

  const expPfeiler = exp.solids.find((s) => s.id === 'pfeiler');
  check('Der freistehende Pfeiler ist keine Wärmebrücke', expPfeiler?.thermalBridge.atExteriorWall ?? true, false);
  check('Und hat keine Berührungslänge', r3(expPfeiler?.thermalBridge.contactLength ?? -1), 0, 0.001);

  // Flächenbilanz im Raum: Boden ohne, Decke mit der Kaminfläche.
  // 0,20 + 0,365² = 0,20 + 0,133225 = 0,333225 m².
  const massivFlaeche = KAMIN_A + WERKZEUG_PFEILER_A;
  check('Nettogrundfläche im Export', r3(expRaum.netFloorArea ?? 0), r3(GRUNDFLAECHE - massivFlaeche), 0.01);
  check('Massiver Anteil im Export', r3(expRaum.solidArea ?? 0), r3(massivFlaeche), 0.01);
  const boden = expRaum.surfaces.find((s) => s.kind === 'floor');
  const decke = expRaum.surfaces.find((s) => s.kind === 'ceiling');
  check('Der Fußboden ist um die massiven Flächen kleiner', r3(boden?.grossArea ?? 0), r3(GRUNDFLAECHE - massivFlaeche), 0.01);
  check('Die Decke bleibt die volle Grundfläche', r3(decke?.grossArea ?? 0), r3(GRUNDFLAECHE), 0.01);

  // Auch die Rohgeometrie muss mitkommen, sonst geht das Bauteil beim
  // Speichern und Öffnen verloren.
  check('Die Rohgeometrie führt die massiven Bauteile', exp.geometry.solids.length, 2);

  // === 3 — Fußbodenheizung spart massive Bauteile aus ======================
  const ohne = measureLayableArea(raum.innerPolygon, {
    spacing: 0.15,
    edgeClearance: DEFAULT_EDGE_CLEARANCE,
    obstacleClearance: DEFAULT_OBSTACLE_CLEARANCE,
  });
  const mit = measureLayableArea(raum.innerPolygon, {
    spacing: 0.15,
    edgeClearance: DEFAULT_EDGE_CLEARANCE,
    obstacles: [solidFootprint(kamin)],
    obstacleClearance: DEFAULT_OBSTACLE_CLEARANCE,
  });
  check('Unter dem Kamin wird nicht verlegt', mit < ohne, true);
  // Mindestens die Grundfläche selbst; mehr, weil rundherum ein Abstand von
  // 0,10 m bleibt (DEFAULT_OBSTACLE_CLEARANCE).
  check('Und zwar mindestens seine Grundfläche', ohne - mit >= KAMIN_A, true);

  // === 4 — Geschoss übernehmen: die Kopierregel ============================
  // Ausgangslage: Erdgeschoss mit Treppe, Kamin (durchgehend) und Pfeiler
  // (geschossgebunden). Geprüft wird `copyLevelContents` — die Regel selbst,
  // ohne Store und ohne Oberfläche. Dass der Knopf im Programm sie auslöst,
  // ist eine andere Frage und steht im Rauchtest (`smoke:round2`).
  const quelle = baueHaus();
  const treppe: VerticalElement = {
    id: 'treppe',
    kind: 'stair-straight',
    name: 'Treppe',
    levelId: 'eg',
    position: { x: 1.2, y: 2 },
    // Vorgaben des Werkzeugs: 1,00 m Laufbreite, 3,60 m Lauflänge.
    width: 1,
    length: 3.6,
    rotation: 0,
    steps: 15,
    deductsArea: true,
    openToAbove: true,
  };
  quelle.verticals = { treppe };
  quelle.solids = {
    kamin: massiv('kamin-eg', 'chimney', KAMIN_POS, 0.4, 0.4, true),
    pfeiler: massiv('pfeiler-eg', 'pier', PFEILER_POS, 0.365, 0.365, false),
  };

  /**
   * Ein vorhersagbarer ID-Erzeuger statt des zufälligen aus dem Store: die
   * Prüfung will die Anzahl und die Herkunft der Kopien nachweisen, nicht die
   * Streuung eines Zufallsgenerators.
   */
  let lfd = 0;
  const neueId = (praefix: string): string => `${praefix}-kopie-${lfd++}`;

  const og: Level = { ...quelle.levels.eg, id: 'og', name: '1. OG', order: 1, elevation: HOEHE + 0.3 };
  const kopie = copyLevelContents({
    sourceLevelId: 'eg',
    targetLevelId: og.id,
    targetHeight: og.height,
    nodes: Object.values(quelle.nodes),
    walls: Object.values(quelle.walls),
    openings: Object.values(quelle.openings),
    verticals: Object.values(quelle.verticals),
    solids: Object.values(quelle.solids),
    durchbrueche: Object.values(quelle.durchbrueche ?? {}),
    newId: neueId,
  });

  check('Der Grundriss wird kopiert: vier Knoten', kopie.nodes.length, 4);
  check('Und vier Wände', kopie.walls.length, 4);
  check('Die Kopien gehören dem neuen Geschoss', new Set(kopie.walls.map((w) => w.levelId)).size, 1);
  check('Und zwar dem angelegten', kopie.walls[0]?.levelId ?? 'fehlt', og.id);
  check('Mit der Höhe des neuen Geschosses', r3(kopie.walls[0]?.height ?? 0), r3(og.height), 0.001);
  check('Keine Wandkopie behält die ID ihrer Vorlage', kopie.walls.some((w) => w.id in quelle.walls), false);
  check('Und jede hängt an kopierten Knoten', kopie.walls.every((w) => kopie.nodes.some((n) => n.id === w.a) && kopie.nodes.some((n) => n.id === w.b)), true);

  // Der Kern der Anwendermeldung: die Treppe geht *nicht* mit hoch.
  const uebergangen = kopie.skipped;
  check('Die Treppe wird nicht kopiert', uebergangen.filter((s) => s.art === 'vertikal').length, 1);
  check('Weil sie zwei Geschosse verbindet', uebergangen.find((s) => s.art === 'vertikal')?.grund ?? 'fehlt', 'verbindet-geschosse');
  // Der Schornstein durchstößt die Decke ohnehin — auch er bleibt einmalig.
  check('Der Schornstein wird nicht kopiert', kopie.solids.filter((b) => b.kind === 'chimney').length, 0);
  check('Weil er durch alle Geschosse läuft', uebergangen.find((s) => s.art === 'massiv')?.grund ?? 'fehlt', 'durchgehend');
  check('Die Regel sagt das auch einzeln', copiesWithLevel({ throughAllLevels: true }), false);
  // Der Pfeiler gehört zum Grundriss und wird mitkopiert, wie eine Wand.
  check('Der Pfeiler wandert mit', kopie.solids.filter((b) => b.kind === 'pier').length, 1);
  check('Auch das sagt die Regel einzeln', copiesWithLevel({ throughAllLevels: false }), true);
  check('Er steht danach im neuen Geschoss', kopie.solids[0]?.levelId ?? 'fehlt', og.id);
  check('An unveränderter Stelle', r3(kopie.solids[0]?.position.x ?? 0), PFEILER_POS.x, 0.001);
  check('Unter eigener ID', kopie.solids[0]?.id === 'pfeiler-eg', false);
  check('Und die Vorlage bleibt unberührt', Object.keys(quelle.solids).length, 2);

  // Und trotzdem sieht und rechnet das obere Geschoss richtig: das Loch in
  // der Decke bleibt, die Decke darüber ist geschlossen. Dafür wird der
  // kopierte Grundriss einmal durch die Raumerkennung geschickt — genau das
  // tut das Programm nach dem Übernehmen auch.
  const knotenBeide = { ...quelle.nodes, ...Object.fromEntries(kopie.nodes.map((n) => [n.id, n])) };
  const massivBeide = [...Object.values(quelle.solids), ...kopie.solids];
  const raeumeOg = detectRooms({
    nodes: knotenBeide,
    walls: kopie.walls,
    openings: kopie.openings,
    levelId: og.id,
    defaultHeight: og.height,
    northAngle: 0,
  });
  const raeumeBeide = [...Object.values(quelle.rooms), ...raeumeOg];
  applyVerticalDeductions(raeumeBeide, [treppe], ['eg', og.id], massivBeide);
  const egRaum = raeumeBeide.find((r) => r.levelId === 'eg');
  const ogRaum = raeumeBeide.find((r) => r.levelId === og.id);

  const treppenFlaeche = treppe.width * treppe.length;
  check('Im Erdgeschoss öffnet die Treppe die Decke', (egRaum?.openToAboveArea ?? 0) > 3, true);
  check('Im Obergeschoss fehlt die Treppenfläche', (ogRaum?.floorOpeningArea ?? 0) >= treppenFlaeche, true);
  check('Die Deckenöffnung im OG ist geschlossen', r3(ogRaum?.openToAboveArea ?? 0), 0, 0.001);
  check(
    'Fläche im OG: Treppe, Schornstein und Pfeiler',
    r3(ogRaum?.floorOpeningArea ?? 0),
    r3(treppenFlaeche + WERKZEUG_KAMIN_A + WERKZEUG_PFEILER_A),
    0.01,
  );

  // === 5 — Was die Projektdatei tragen muss ================================
  // Die Exportdatei ist zugleich die Projektdatei. Was ihre Rohgeometrie
  // nicht führt, ist nach dem nächsten Öffnen weg. Der vollständige Rundlauf
  // Speichern → Öffnen läuft durch den Store und steht deshalb im Rauchtest
  // (`smoke:round2`); hier wird die Bedingung geprüft, ohne die er gar nicht
  // tragen kann — dass die massiven Bauteile ungekürzt in `geometry.solids`
  // stehen.
  const zuSichern = baueHaus();
  zuSichern.solids = {
    kamin: { ...massiv('kamin-datei', 'chimney', KAMIN_POS, 0.4, 0.4, true), material: 'Schamotte' },
    pfeiler: massiv('pfeiler-datei', 'pier', PFEILER_POS, 0.365, 0.365, false),
  };
  applyVerticalDeductions(Object.values(zuSichern.rooms), [], ['eg'], Object.values(zuSichern.solids));
  const datei = JSON.parse(JSON.stringify(buildRaviaExport(zuSichern))) as ReturnType<typeof buildRaviaExport>;
  const roh = datei.geometry.solids;
  check('Die Rohgeometrie führt beide massiven Bauteile', roh.length, 2);
  const rohKamin = roh.find((b) => b.id === 'kamin-datei');
  check('Mit ihrer Art', rohKamin?.kind ?? 'fehlt', 'chimney');
  check('Mit ihrem Baustoff', rohKamin?.material ?? 'fehlt', 'Schamotte');
  check('Mit ihrer Grundfläche', r3((rohKamin?.width ?? 0) * (rohKamin?.length ?? 0)), WERKZEUG_KAMIN_A, 0.002);
  check('Mit ihrem Geschoss', rohKamin?.levelId ?? 'fehlt', 'eg');
  // Ohne diese Angabe würde der Schornstein beim nächsten Übernehmen eines
  // Geschosses kopiert — die Kopierregel hängt an ihr.
  check('Und mit der Angabe, dass er durchgeht', rohKamin?.throughAllLevels ?? 'fehlt', true);
  check('Der Pfeiler geht nicht durch', roh.find((b) => b.id === 'pfeiler-datei')?.throughAllLevels ?? 'fehlt', false);

  // === 6 — Die Verlegekurve spart den Kamin aus ============================
  // Block 3 misst nur die belegbare Fläche. Hier wird tatsächlich gelegt:
  // eine Kurve, die durch den Kamin liefe, wäre im Plan nicht zu sehen und
  // im Rohrauszug trotzdem enthalten.
  const legeOptionen = {
    spacing: 0.15,
    edgeClearance: DEFAULT_EDGE_CLEARANCE,
    obstacleClearance: DEFAULT_OBSTACLE_CLEARANCE,
  };
  const kaminUmriss = solidFootprint(kamin);
  const kurveOhne = planFloorLoops(raum.innerPolygon, legeOptionen);
  const kurveMit = planFloorLoops(raum.innerPolygon, { ...legeOptionen, obstacles: [kaminUmriss] });
  check('Beide Male entsteht eine Verlegekurve', kurveOhne.curves.length >= 1 && kurveMit.curves.length >= 1, true);
  check('Mit Kamin bleibt weniger belegbare Fläche', kurveMit.layableArea < kurveOhne.layableArea, true);
  check('Und zwar um mindestens seine Grundfläche', kurveOhne.layableArea - kurveMit.layableArea >= KAMIN_A - 0.001, true);

  /**
   * Ob die Kurve den Kamin ausspart, entscheidet sich zwischen den
   * Stützpunkten und nicht an ihnen: eine gerade Bahn quer durch das
   * Mauerwerk hätte dort keinen einzigen Knick. Deshalb wird jede Bahn in
   * Schritten von 20 mm abgetastet — feiner als die kürzeste Kante des
   * Kamins (0,40 m), also kann kein Durchgang zwischen zwei Proben
   * hindurchrutschen.
   */
  const laeuftDurch = (kurven: readonly { points: Vec2[] }[]): boolean => {
    for (const c of kurven) {
      for (let i = 1; i < c.points.length; i++) {
        const p0 = c.points[i - 1];
        const p1 = c.points[i];
        const schritte = Math.max(1, Math.ceil(Math.hypot(p1.x - p0.x, p1.y - p0.y) / 0.02));
        for (let k = 0; k <= schritte; k++) {
          const t = k / schritte;
          if (pointInPolygon({ x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t }, kaminUmriss)) return true;
        }
      }
    }
    return false;
  };
  check('Keine Bahn läuft durch den Kamin', laeuftDurch(kurveMit.curves), false);
  // Die Gegenprobe. Ohne sie prüfte die Zeile darüber nur, dass die Kurve
  // irgendwo liegt — der Kamin steht in der belegten Fläche, nicht daneben.
  check('Ohne Aussparung liefe sie hindurch', laeuftDurch(kurveOhne.curves), true);

  /**
   * Und die Beobachtung, die dabei nicht übergangen werden darf: mit der
   * Aussparung wird *mehr* Rohr verlegt, nicht weniger. Die Schnecke trägt
   * die durchbrochene Form nicht mehr und zerfällt in zwei Stücke; die
   * belegbare Fläche schrumpft um 0,20 m², die Rohrlänge wächst um rund 13 m.
   * Das ist kein Fehler, sondern der Grund, warum ein Kamin im Raum die
   * Auslegung teurer macht — und es steht hier, damit niemand die
   * naheliegende, falsche Erwartung „weniger Fläche, weniger Rohr" prüft.
   */
  check('Die Aussparung zerlegt die Schnecke', kurveMit.curves.length > kurveOhne.curves.length, true);
  check('Und kostet dabei mehr Rohr, nicht weniger', kurveMit.fieldLength > kurveOhne.fieldLength, true);
}
