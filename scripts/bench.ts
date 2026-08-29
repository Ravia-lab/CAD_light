/**
 * Belastungsprobe — was passiert, wenn aus dem Beispielhaus ein echtes wird?
 *
 * Der Demo-Grundriss hat drei Räume. Ein Mehrfamilienhaus hat vier Geschosse
 * mit je einem Dutzend Räumen, hundert TGA-Objekten und einem Rohrnetz, das
 * über alle Geschosse läuft. Alles, was dabei quadratisch mit der Größe
 * wächst, fällt beim Beispielhaus nicht auf und macht das Werkzeug beim
 * ersten echten Projekt unbenutzbar.
 *
 * Gemessen wird deshalb an einem synthetischen Gebäude in der Größe, die
 * realistisch ist — und zwar die Wege, die bei *jeder* Änderung laufen:
 * Raumerkennung, Modellprüfung, Export.
 *
 * Ausführen:  npm run bench
 */

import type { BimDocument, BimNode, Fixture, Opening, PipeRun, Wall } from '../src/types/bim';
import { detectRooms, applyVerticalDeductions } from '../src/lib/roomDetection';
import { validateModel } from '../src/lib/validation';
import { buildRaviaExport } from '../src/lib/raviaExport';
import { buildIfc } from '../src/lib/ifcExport';
import { buildPlanSvg } from '../src/lib/planPrint';
import { buildPipeReport } from '../src/lib/pipeReport';
import { buildPipeReportSheets } from '../src/lib/pipeReportPrint';
import { planPipeNetwork } from '../src/lib/pipeLayout';
import { designPlant, deriveCircuits } from '../src/lib/plantDesign';
import { estimateHeatLoad } from '../src/lib/heatLoadEstimate';
import { buildPipeNetwork } from '../src/lib/pipeNetwork';
import { documentBridgeHeatLoss } from '../src/lib/thermalBridges';
import { emptyPlant, emptySite } from '../src/lib/plantDefaults';

// ---------------------------------------------------------------------------
// Synthetisches Gebäude
// ---------------------------------------------------------------------------

interface BuildOptions {
  levels: number;
  /** Wohnungen je Geschoss (jede mit 6 Räumen). */
  units: number;
}

function buildBuilding({ levels, units }: BuildOptions): BimDocument {
  const nodes: Record<string, BimNode> = {};
  const walls: Record<string, Wall> = {};
  const openings: Record<string, Opening> = {};
  const fixtures: Record<string, Fixture> = {};
  const pipes: Record<string, PipeRun> = {};
  const levelsMap: BimDocument['levels'] = {};

  let n = 0;
  let w = 0;
  let o = 0;
  let f = 0;
  let p = 0;

  const node = (x: number, y: number, levelId: string): string => {
    const id = `n${n++}`;
    nodes[id] = { id, x, y, levelId };
    return id;
  };
  const wall = (a: string, b: string, levelId: string, type: Wall['type']): void => {
    const id = `w${w++}`;
    walls[id] = {
      id, a, b, levelId, type,
      thickness: type === 'exterior' ? 0.365 : 0.115,
      height: 2.6,
      layerId: 'layer-walls',
      uValue: type === 'exterior' ? 0.24 : 1.2,
    } as Wall;
    // Jede Außenwand bekommt ein Fenster, jede Innenwand eine Tür — ein
    // Gebäude ohne Öffnungen wäre keine ehrliche Belastungsprobe: gerade die
    // Zuordnung Öffnung → Wandabschnitt wächst schnell.
    const oid = `o${o++}`;
    openings[oid] = {
      id: oid, wallId: id,
      kind: type === 'exterior' ? 'window' : 'door',
      subtype: type === 'exterior' ? 'turn-tilt' : 'single',
      distance: 2, width: type === 'exterior' ? 1.2 : 0.885,
      height: type === 'exterior' ? 1.35 : 2.01,
      sillHeight: type === 'exterior' ? 0.9 : 0,
      uValue: type === 'exterior' ? 1.1 : 1.8,
      gValue: type === 'exterior' ? 0.6 : undefined,
    } as Opening;
  };

  // Ein Geschoss ist ein Raster aus `units` × 3 Zellen à 4 × 4 m.
  const cols = units;
  const rows = 3;
  const cell = 4;

  for (let l = 0; l < levels; l++) {
    const levelId = `lvl-${l}`;
    levelsMap[levelId] = {
      id: levelId, name: `Geschoss ${l}`, order: l, elevation: l * 2.85, height: 2.6,
      floorUValue: 0.3, floorBoundary: l === 0 ? 'ground' : 'adjacent-room',
      ceilingUValue: 0.2, ceilingBoundary: l === levels - 1 ? 'unheated' : 'adjacent-room',
    };

    // Knotenraster
    const grid: string[][] = [];
    for (let r = 0; r <= rows; r++) {
      const row: string[] = [];
      for (let c = 0; c <= cols; c++) row.push(node(c * cell, r * cell, levelId));
      grid.push(row);
    }
    // Waagerechte und senkrechte Wände
    for (let r = 0; r <= rows; r++) {
      for (let c = 0; c < cols; c++) {
        wall(grid[r][c], grid[r][c + 1], levelId, r === 0 || r === rows ? 'exterior' : 'interior');
      }
    }
    for (let c = 0; c <= cols; c++) {
      for (let r = 0; r < rows; r++) {
        wall(grid[r][c], grid[r + 1][c], levelId, c === 0 || c === cols ? 'exterior' : 'interior');
      }
    }

    // TGA: je Zelle ein Heizkörper, jede dritte Zelle ein Ventil.
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const id = `f${f++}`;
        fixtures[id] = {
          id, type: 'radiator', category: 'heating', levelId,
          position: { x: c * cell + 2, y: r * cell + 0.4 },
          rotation: 0, length: 1, depth: 0.1, elevation: 0.15,
          params: { powerW: 900, flowTemperature: 55, returnTemperature: 45 },
        };
        if ((r * cols + c) % 3 === 0) {
          const v = `f${f++}`;
          fixtures[v] = {
            id: v, type: 'air-exhaust', category: 'ventilation', levelId,
            position: { x: c * cell + 2, y: r * cell + 2 },
            rotation: 0, length: 0.16, depth: 0.16, elevation: 2.4,
            params: { airflow: 45 },
          };
        }
      }
    }

    // Verteiler je Geschoss, Steigstrang in der Ecke, Leitung zu jedem Heizkörper.
    const manifold = `f${f++}`;
    fixtures[manifold] = {
      id: manifold, type: 'manifold', category: 'heating', levelId,
      position: { x: 0.5, y: 0.5 }, rotation: 0, length: 0.6, depth: 0.15, elevation: 0.5,
      params: {},
    };
    const riser = `f${f++}`;
    fixtures[riser] = {
      id: riser, type: 'riser-heating', category: 'heating', levelId,
      position: { x: 0.5, y: 1.5 }, rotation: 0, length: 0.2, depth: 0.2, elevation: 0,
      params: {},
    };
    pipes[`p${p++}`] = {
      id: `p${p - 1}`, levelId, service: 'heating-flow',
      points: [{ x: 0.5, y: 0.5 }, { x: 0.5, y: 1.5 }],
      nominalDiameter: 32, insulation: 13, elevation: 0.1,
      fromFixtureId: manifold, toFixtureId: riser,
    };
    for (const [id, fx] of Object.entries(fixtures)) {
      if (fx.levelId !== levelId || fx.type !== 'radiator') continue;
      pipes[`p${p++}`] = {
        id: `p${p - 1}`, levelId, service: 'heating-flow',
        points: [
          { x: 0.5, y: 0.5 },
          { x: fx.position.x, y: 0.5 },
          { x: fx.position.x, y: fx.position.y },
        ],
        nominalDiameter: 16, insulation: 9, elevation: 0.1,
        fromFixtureId: manifold, toFixtureId: id,
      };
    }
  }

  const doc: BimDocument = {
    // Grundstück und Anlagenblatt sind Pflichtabschnitte des Dokuments. Die
    // Belastungsprobe misst nur Geometrie- und Exportwege, braucht also keine
    // ausgelegte Anlage — die Vorbelegung stellt aber sicher, dass hier
    // dasselbe Dokument gemessen wird, das die Oberfläche liefert.
    site: emptySite(),
    plant: emptyPlant(),
    meta: {
      name: 'Belastungsprobe', createdAt: '', modifiedAt: '', northAngle: 0,
      designOutdoorTemperature: -12, designIndoorTemperature: 20, n50: 1.5,
      shielding: 'moderate', unheatedTemperature: 10, groundTemperature: 10,
      thermalBridgeSupplement: 0.1, thermalBridgeMethod: 'detailed',
      thermalBridgeCategory: 'none', reheatFactor: 0,
      ventilation: { kind: 'balanced', heatRecovery: 0.8, operation: 'continuous' },
    },
    levels: levelsMap,
    layers: {}, nodes, walls, openings, fixtures,
    verticals: {}, pipes, annotations: {}, roofOpenings: {},
    rooms: {}, constructions: {},
    diagnostics: { openEnds: [] },
    activeLevelId: 'lvl-0',
  };

  // Räume einmal erkennen — im Betrieb macht das der Store.
  const rooms = Object.values(doc.levels).flatMap((level) =>
    detectRooms({
      nodes: doc.nodes,
      walls: Object.values(doc.walls).filter((x) => x.levelId === level.id),
      openings: Object.values(doc.openings).filter((x) => doc.walls[x.wallId]?.levelId === level.id),
      levelId: level.id,
      defaultHeight: level.height,
      northAngle: 0,
    }),
  );
  applyVerticalDeductions(rooms, [], Object.values(doc.levels).map((l) => l.id));
  doc.rooms = Object.fromEntries(rooms.map((r) => [r.id, r]));

  // TGA-Objekte den Räumen zuordnen (im Betrieb Teil der Raumerkennung).
  for (const fx of Object.values(doc.fixtures)) {
    const room = rooms.find(
      (r) =>
        r.levelId === fx.levelId &&
        Math.abs(r.centroid.x - fx.position.x) < 2.5 &&
        Math.abs(r.centroid.y - fx.position.y) < 2.5,
    );
    if (room) fx.roomId = room.id;
  }

  return doc;
}

// ---------------------------------------------------------------------------
// Messung
// ---------------------------------------------------------------------------

function time(label: string, budget: number, fn: () => unknown): number {
  // Einmal warmlaufen, damit der JIT nicht die erste Messung verfälscht.
  fn();
  const runs = 3;
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < runs; i++) fn();
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / runs;
  const ok = ms <= budget;
  if (!ok) failures++;
  console.log(
    `  ${ok ? '✓' : '✗'} ${label.padEnd(34)} ${ms.toFixed(1).padStart(7)} ms   (Budget ${budget} ms)`,
  );
  return ms;
}

let failures = 0;

/**
 * Budgets sind absichtlich knapp über dem Gemessenen gesetzt: sie sollen
 * anschlagen, wenn etwas wieder quadratisch wird, und nicht erst, wenn das
 * Werkzeug schon hakt. Die Prüfung und der Export laufen bei *jeder*
 * Änderung — dort ist die Grenze der Wahrnehmung, nicht die der Geduld.
 */
interface Budgets {
  rooms: number;
  validation: number;
  bridges: number;
  pipes: number;
  export: number;
  ifc: number;
  plant: number;
  /** Planausdruck eines Geschosses — läuft bei jeder Änderung im Dialog neu. */
  print: number;
  /** Rohrausleger: Trassierung, Dimensionierung, Armaturen für ein Geschoss. */
  routing: number;
  /**
   * Rohrnetzbericht: Netz aufbauen, Abgleich rechnen, Tabellen und Blätter
   * setzen. Er läuft bei jeder Änderung im Berichtsfenster neu — auch beim
   * Umschalten des Ventildrucks — und hängt damit an der Bedienung.
   */
  report: number;
}

const SIZES: Record<string, BuildOptions & { budgets: Budgets }> = {
  // Mehrfamilienhaus — die Größe, die im Alltag vorkommt.
  normal: {
    levels: 4, units: 6,
    budgets: { rooms: 60, validation: 40, bridges: 30, pipes: 30, export: 80, ifc: 80, plant: 25, print: 60, routing: 250, report: 220 },
  },
  // Wohnanlage.
  large: {
    levels: 8, units: 12,
    budgets: { rooms: 200, validation: 100, bridges: 60, pipes: 80, export: 200, ifc: 200, plant: 45, print: 90, routing: 400, report: 500 },
  },
  // Absichtlich jenseits des Sinnvollen — hier zeigt sich, was quadratisch ist.
  huge: {
    levels: 12, units: 20,
    budgets: { rooms: 300, validation: 150, bridges: 100, pipes: 120, export: 250, ifc: 300, plant: 70, print: 120, routing: 600, report: 800 },
  },
};

const size = process.argv[2] ?? 'normal';
const config = SIZES[size] ?? SIZES.normal;
const budgets = config.budgets;
const doc = buildBuilding(config);
const walls = Object.keys(doc.walls).length;
const rooms = Object.keys(doc.rooms).length;

console.log(`\n▸ Belastungsprobe (${size})`);
console.log(
  `  ${Object.keys(doc.levels).length} Geschosse · ${walls} Wände · ` +
    `${Object.keys(doc.openings).length} Öffnungen · ${rooms} Räume · ` +
    `${Object.keys(doc.fixtures).length} TGA · ${Object.keys(doc.pipes).length} Leitungen\n`,
);

time('Raumerkennung (alle Geschosse)', budgets.rooms, () =>
  Object.values(doc.levels).flatMap((level) =>
    detectRooms({
      nodes: doc.nodes,
      walls: Object.values(doc.walls).filter((x) => x.levelId === level.id),
      openings: Object.values(doc.openings).filter((x) => doc.walls[x.wallId]?.levelId === level.id),
      levelId: level.id,
      defaultHeight: level.height,
      northAngle: 0,
    }),
  ),
);
time('Modellprüfung', budgets.validation, () => validateModel(doc));
time('Wärmebrückenbilanz', budgets.bridges, () => documentBridgeHeatLoss(doc));
time('Rohrnetz', budgets.pipes, () => buildPipeNetwork(doc));
time('RaVia-Export', budgets.export, () => buildRaviaExport(doc));
time('IFC-Export', budgets.ifc, () => buildIfc(doc));
// Die Vorschau des Planausdrucks wird bei jedem Klick im Druckdialog neu
// gebaut — Maßstab, Blattformat, jeder Schalter. Sie gehört damit zu den
// Funktionen, die eine Bedienung spürbar zäh machen können.
time('Planausdruck (ein Geschoss)', budgets.print, () =>
  buildPlanSvg(doc, {
    scale: 100,
    format: 'A3',
    orientation: 'landscape',
    levelId: doc.activeLevelId,
    showRoomLabels: true,
    showDimensions: true,
    showFixtures: true,
    showAnnotations: true,
    showInteriorDimensions: true,
    showLegend: true,
    showOpeningDimensions: true,
  }),
);
// Die Anlagenauslegung läuft bei jeder Änderung im Anlagenblatt neu — sie
// hängt damit direkt an der Tippgeschwindigkeit und braucht ein Budget.
// Der Rohrausleger sucht je Verbraucher einen Weg durch ein Raster über das
// ganze Geschoss. Das ist der teuerste Einzelschritt des Programms und
// braucht deshalb ein eigenes Budget.
time('Rohrausleger (ein Geschoss)', budgets.routing, () =>
  planPipeNetwork(doc, { mode: 'neubau', levelId: doc.activeLevelId }),
);
time('Anlagenauslegung', budgets.plant, () => designPlant(doc));
// Der Rohrnetzbericht ist die teuerste Kette des Programms: Netzaufbau,
// Abgleich über alle Stränge, Tabellen, Blätter. Er enthält `designPlant`
// und `buildPipeNetwork` als Teilschritte — das Budget ist deshalb kein
// zusätzlicher Posten, sondern die Obergrenze der ganzen Kette.
{
  const bericht = buildPipeReport(doc);
  time('Rohrnetzbericht (Daten)', budgets.report, () => buildPipeReport(doc));
  time('Rohrnetzbericht (Blätter)', budgets.print, () => buildPipeReportSheets(doc, bericht, {}));
}
if (process.env.PROFILE) {
  time('  davon Heizlast-Überschlag', budgets.plant, () => estimateHeatLoad(doc));
  const est = estimateHeatLoad(doc);
  time('  davon Heizkreise ableiten', budgets.plant, () => deriveCircuits(doc, est));
}

console.log(
  `\n${failures === 0 ? '✓ ALLE BUDGETS EINGEHALTEN' : `✗ ${failures} BUDGET(S) ÜBERSCHRITTEN`}\n`,
);
process.exit(failures === 0 ? 0 : 1);
