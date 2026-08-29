/**
 * Referenzprojekt — ein festes Haus, an dem sich jede Änderung zeigt.
 *
 * Die Einzeltests prüfen jeder für sich eine Formel. Was sie nicht sehen: dass
 * eine Änderung an der Raumerkennung nebenbei die Fensterflächen verschiebt,
 * oder dass ein neues Exportfeld eine Nachbartemperatur überschreibt. Solche
 * Fernwirkungen fallen erst bei der Gegenstelle auf — also zu spät.
 *
 * Deshalb dieses Haus: drei Geschosse, Satteldach, Fenster und Türen, TGA,
 * Rohrnetz, Treppe, längenbezogene Wärmebrücken, Lüftungsanlage. Sein Export
 * wird gegen einen eingecheckten Sollstand gehalten. Weicht eine Zahl ab,
 * sagt der Test *welche* — nicht bloß, dass sich etwas geändert hat.
 *
 * Das unterste Geschoss ist ein **halb eingegrabener Keller**. Halb, weil nur
 * so beide Fälle in derselben Wand stecken: der Teil unter der
 * Geländeoberkante grenzt an Erdreich, der darüber an Außenluft. Ein
 * vollständig eingegrabener Keller würde die Aufteilung nie auslösen und ein
 * freistehender sie nie brauchen. Dazu ein Fenster über und eines unter
 * Gelände (Lichtschacht), damit auch die Zuordnung der Öffnungen an beiden
 * Enden geprüft ist. Die Geschosse darüber liegen vollständig über Gelände —
 * sie sind die Gegenprobe, dass sich an einem Haus ohne Keller nichts ändert.
 *
 * Alle IDs sind fest vergeben und es kommt kein Datum vor: der Bericht muss
 * bei jedem Lauf bitgleich sein, sonst prüft er nichts.
 *
 * Sollstand bewusst ändern:  npm run reference:update
 */

import type { BimDocument, BimNode, Fixture, Opening, PipeRun, Vec2, Wall } from '../src/types/bim';
import { emptyPlant, emptySite } from '../src/lib/plantDefaults';
import { applyVerticalDeductions, detectRooms } from '../src/lib/roomDetection';
import { buildRaviaExport } from '../src/lib/raviaExport';
import { buildIfc } from '../src/lib/ifcExport';
import { buildPipeNetwork } from '../src/lib/pipeNetwork';
import { validateModel } from '../src/lib/validation';

const r3 = (v: number): number => Math.round(v * 1000) / 1000;

// ---------------------------------------------------------------------------
// Das Haus
// ---------------------------------------------------------------------------

/**
 * Grundriss 10 × 8 m über Wandachsen, Außenwand 36,5 cm, eine Trennwand bei
 * x = 6. Drei Geschosse; über dem obersten ein Satteldach 40° mit 1,00 m
 * Kniestock, First in Nord-Süd-Richtung.
 *
 * Höhenlage: EG bei ±0,00, Keller bei −2,60 m mit 2,30 m lichter Höhe (seine
 * Wände laufen also von −2,60 bis −0,30), Geländeoberkante bei −1,45 m. Damit
 * steckt genau die Hälfte jeder Kellerwand im Erdreich — eine Zahl, die sich
 * im Kopf nachrechnen lässt, und darauf kommt es bei einem Sollstand an.
 */
export function buildReferenceDocument(): BimDocument {
  const nodes: Record<string, BimNode> = {};
  const walls: Record<string, Wall> = {};
  const openings: Record<string, Opening> = {};
  const fixtures: Record<string, Fixture> = {};
  const pipes: Record<string, PipeRun> = {};

  const node = (id: string, x: number, y: number, levelId: string): string => {
    nodes[id] = { id, x, y, levelId };
    return id;
  };
  const wall = (
    id: string,
    a: string,
    b: string,
    levelId: string,
    type: Wall['type'],
    thickness: number,
    uValue: number,
    height = 2.75,
  ): void => {
    walls[id] = {
      id, a, b, levelId, type, thickness, uValue,
      height, layerId: 'layer-walls',
    } as Wall;
  };

  for (const levelId of ['eg', 'og']) {
    const p = (name: string, x: number, y: number) => node(`${levelId}-${name}`, x, y, levelId);
    const sw = p('sw', 0, 0);
    const sm = p('sm', 6, 0);
    const se = p('se', 10, 0);
    const ne = p('ne', 10, 8);
    const nm = p('nm', 6, 8);
    const nw = p('nw', 0, 8);

    wall(`${levelId}-w-s1`, sw, sm, levelId, 'exterior', 0.365, 0.24);
    wall(`${levelId}-w-s2`, sm, se, levelId, 'exterior', 0.365, 0.24);
    wall(`${levelId}-w-e`, se, ne, levelId, 'exterior', 0.365, 0.24);
    wall(`${levelId}-w-n2`, ne, nm, levelId, 'exterior', 0.365, 0.24);
    wall(`${levelId}-w-n1`, nm, nw, levelId, 'exterior', 0.365, 0.24);
    wall(`${levelId}-w-w`, nw, sw, levelId, 'exterior', 0.365, 0.24);
    wall(`${levelId}-w-mid`, sm, nm, levelId, 'interior', 0.115, 1.2);

    // Fenster nach Süden und Westen, eine Tür in der Trennwand.
    openings[`${levelId}-o-s1`] = {
      id: `${levelId}-o-s1`, wallId: `${levelId}-w-s1`, kind: 'window', subtype: 'turn-tilt',
      distance: 3, width: 2, height: 1.35, sillHeight: 0.9, uValue: 1.1, gValue: 0.6,
    } as Opening;
    openings[`${levelId}-o-s2`] = {
      id: `${levelId}-o-s2`, wallId: `${levelId}-w-s2`, kind: 'window', subtype: 'fixed',
      distance: 2, width: 1.2, height: 1.35, sillHeight: 0.9, uValue: 1.1, gValue: 0.6,
    } as Opening;
    openings[`${levelId}-o-w`] = {
      id: `${levelId}-o-w`, wallId: `${levelId}-w-w`, kind: 'window', subtype: 'turn',
      distance: 4, width: 1, height: 1.35, sillHeight: 0.9, uValue: 1.1, gValue: 0.6,
    } as Opening;
    openings[`${levelId}-o-d`] = {
      id: `${levelId}-o-d`, wallId: `${levelId}-w-mid`, kind: 'door', subtype: 'single-885',
      distance: 4, width: 0.885, height: 2.01, sillHeight: 0, uValue: 1.8,
    } as Opening;

    // TGA: zwei Heizkörper, ein Zu- und ein Abluftventil, ein Verteiler.
    const fx = (name: string, type: string, category: string, at: Vec2, params: object) => {
      const id = `${levelId}-f-${name}`;
      fixtures[id] = {
        id, type, category, levelId, position: at,
        rotation: 0, length: 1, depth: 0.12, elevation: 0.15, params,
      } as Fixture;
      return id;
    };
    fx('hk1', 'radiator', 'heating', { x: 3, y: 0.4 }, {
      powerW: 1400, flowTemperature: 55, returnTemperature: 45,
    });
    fx('hk2', 'radiator', 'heating', { x: 8, y: 0.4 }, {
      powerW: 900, flowTemperature: 55, returnTemperature: 45,
    });
    fx('zu', 'air-supply', 'ventilation', { x: 3, y: 4 }, { airflow: 60 });
    fx('ab', 'air-exhaust', 'ventilation', { x: 8, y: 4 }, { airflow: 60 });
    const manifold = fx('vt', 'manifold', 'heating', { x: 0.6, y: 0.6 }, {});

    pipes[`${levelId}-p1`] = {
      id: `${levelId}-p1`, levelId, service: 'heating-flow',
      points: [{ x: 0.6, y: 0.6 }, { x: 3, y: 0.6 }, { x: 3, y: 0.4 }],
      nominalDiameter: 16, insulation: 9, elevation: 0.1,
      fromFixtureId: manifold, toFixtureId: `${levelId}-f-hk1`,
    };
    pipes[`${levelId}-p2`] = {
      id: `${levelId}-p2`, levelId, service: 'heating-flow',
      points: [{ x: 0.6, y: 0.6 }, { x: 8, y: 0.6 }, { x: 8, y: 0.4 }],
      nominalDiameter: 16, insulation: 9, elevation: 0.1,
      fromFixtureId: manifold, toFixtureId: `${levelId}-f-hk2`,
    };
  }

  // --- Kellergeschoss ------------------------------------------------------
  // Derselbe Grundriss, aber 2,30 m lichte Höhe und ohne TGA: der Keller ist
  // hier nicht als Nutzung interessant, sondern als Höhenlage. Zwei Fenster,
  // eines über und eines unter der Geländeoberkante — mehr braucht es nicht,
  // um beide Zuordnungen dauerhaft festzuhalten.
  {
    const p = (name: string, x: number, y: number) => node(`kg-${name}`, x, y, 'kg');
    const sw = p('sw', 0, 0);
    const sm = p('sm', 6, 0);
    const se = p('se', 10, 0);
    const ne = p('ne', 10, 8);
    const nm = p('nm', 6, 8);
    const nw = p('nw', 0, 8);

    // 0,28 W/(m²·K) für die Kellerwand: erkennbar anders als die 0,24 der
    // Wände darüber, damit eine vertauschte Zuordnung im Sollstand auffällt.
    wall('kg-w-s1', sw, sm, 'kg', 'exterior', 0.365, 0.28, 2.3);
    wall('kg-w-s2', sm, se, 'kg', 'exterior', 0.365, 0.28, 2.3);
    wall('kg-w-e', se, ne, 'kg', 'exterior', 0.365, 0.28, 2.3);
    wall('kg-w-n2', ne, nm, 'kg', 'exterior', 0.365, 0.28, 2.3);
    wall('kg-w-n1', nm, nw, 'kg', 'exterior', 0.365, 0.28, 2.3);
    wall('kg-w-w', nw, sw, 'kg', 'exterior', 0.365, 0.28, 2.3);
    wall('kg-w-mid', sm, nm, 'kg', 'interior', 0.115, 1.2, 2.3);

    // Brüstung 1,40 m über Kellerfußboden = −1,20 m absolut, also 0,25 m
    // über Gelände: dieses Fenster gehört ganz in den freistehenden Teil.
    openings['kg-o-s1'] = {
      id: 'kg-o-s1', wallId: 'kg-w-s1', kind: 'window', subtype: 'fixed',
      distance: 3, width: 1, height: 0.6, sillHeight: 1.4, uValue: 1.1, gValue: 0.6,
    } as Opening;
    // Brüstung 0,40 m über Kellerfußboden = −2,20 m absolut, also 0,75 m
    // unter Gelände: Lichtschacht, und damit ganz im erdberührten Teil.
    openings['kg-o-w'] = {
      id: 'kg-o-w', wallId: 'kg-w-w', kind: 'window', subtype: 'fixed',
      distance: 4, width: 1, height: 0.6, sillHeight: 0.4, uValue: 1.1, gValue: 0.6,
    } as Opening;
    openings['kg-o-d'] = {
      id: 'kg-o-d', wallId: 'kg-w-mid', kind: 'door', subtype: 'single-885',
      distance: 4, width: 0.885, height: 2.01, sillHeight: 0, uValue: 1.8,
    } as Opening;
  }

  const doc: BimDocument = {
    // Grundstück und Anlagenblatt gehören seit Fassung 1.2 zum Dokument.
    // Das Referenzhaus führt sie in der Vorbelegung mit: ein Dokument ohne
    // diese Abschnitte gibt es im Programm nicht mehr, und der Prüflauf soll
    // dasselbe Dokument sehen wie die Oberfläche.
    site: emptySite(),
    plant: emptyPlant(),
    meta: {
      name: 'Referenzhaus',
      createdAt: '2026-01-01T00:00:00.000Z',
      modifiedAt: '2026-01-01T00:00:00.000Z',
      northAngle: 0,
      designOutdoorTemperature: -12,
      designIndoorTemperature: 20,
      n50: 1.5,
      shielding: 'moderate',
      unheatedTemperature: 10,
      groundTemperature: 10,
      // Gelände 1,45 m über dem Kellerfußboden — die Hälfte der 2,30 m
      // hohen Kellerwand steckt damit im Erdreich, die andere Hälfte steht
      // frei. Beide Fälle liegen so in derselben Wand.
      terrainElevation: -1.45,
      thermalBridgeSupplement: 0.05,
      thermalBridgeMethod: 'detailed',
      thermalBridgeCategory: 'A',
      reheatFactor: 0,
      setback: { active: true, hours: 8, reheatHours: 2, airChangeRate: 0.1, massClass: 'medium' },
      ventilation: { kind: 'balanced', heatRecovery: 0.8, operation: 'continuous' },
    },
    levels: {
      kg: {
        id: 'kg', name: 'KG', order: -1, elevation: -2.6, height: 2.3,
        floorUValue: 0.35, floorBoundary: 'ground',
        ceilingUValue: 0.9, ceilingBoundary: 'adjacent-room',
      },
      // Der Boden des Erdgeschosses grenzt jetzt an den Keller, nicht mehr
      // an Erdreich — sonst stünde die Bodenplatte zweimal im Modell.
      eg: {
        id: 'eg', name: 'EG', order: 0, elevation: 0, height: 2.75,
        floorUValue: 0.9, floorBoundary: 'adjacent-room',
        ceilingUValue: 0.2, ceilingBoundary: 'adjacent-room',
      },
      og: {
        id: 'og', name: 'OG', order: 1, elevation: 2.9, height: 2.75,
        floorUValue: 0.3, floorBoundary: 'adjacent-room',
        ceilingUValue: 0.2, ceilingBoundary: 'unheated',
        roof: {
          kind: 'gable', pitch: 40, kneeHeight: 1, azimuth: 90, ridgeOffset: 0,
          uValue: 0.18, gableUValue: 0.22,
        },
      },
    },
    layers: {},
    nodes,
    walls,
    openings,
    fixtures,
    verticals: {
      treppe: {
        id: 'treppe', levelId: 'eg', kind: 'stair', name: 'Treppe',
        position: { x: 8, y: 6.5 }, rotation: 0, width: 1, length: 3,
        deductsFloorArea: true, openToAbove: true,
        toLevelId: 'og', stairKind: 'straight', steps: 16, riserHeight: 0.18,
      } as never,
    },
    pipes,
    annotations: {},
    roofOpenings: {
      gaube: {
        id: 'gaube', levelId: 'og', kind: 'dormer-shed',
        position: { x: 3, y: 2 }, width: 2, depth: 1.6, frontHeight: 2.2,
        uValue: 0.2, frontUValue: 1.1,
      } as never,
    },
    rooms: {},
    constructions: {},
    diagnostics: { openEnds: [] },
    activeLevelId: 'eg',
  };

  // Räume erkennen — im Betrieb macht das der Store bei jeder Änderung.
  const levels = Object.values(doc.levels).sort((a, b) => a.order - b.order);
  const rooms = levels.flatMap((level) =>
    detectRooms({
      nodes: doc.nodes,
      walls: Object.values(doc.walls).filter((w) => w.levelId === level.id),
      openings: Object.values(doc.openings).filter(
        (o) => doc.walls[o.wallId]?.levelId === level.id,
      ),
      levelId: level.id,
      defaultHeight: level.height,
      northAngle: doc.meta.northAngle,
      roof: level.roof,
      roofOpenings: Object.values(doc.roofOpenings).filter((o) => o.levelId === level.id),
    }),
  );
  applyVerticalDeductions(rooms, Object.values(doc.verticals), levels.map((l) => l.id));
  doc.rooms = Object.fromEntries(rooms.map((r) => [r.id, r]));

  // Nutzung und Rolle setzen — sonst wäre jeder Raum „other" und die
  // Lüftungsrollen blieben leer.
  const named: [string, string][] = [
    ['Wohnen', 'living'],
    ['Bad', 'bath'],
  ];
  for (const room of Object.values(doc.rooms)) {
    const isWest = room.centroid.x < 6;
    // Der Keller bekommt eigene Nutzungen und eine niedrigere Solltemperatur:
    // ein „Bad KG" mit 24 °C wäre als Sollstand zwar rechenbar, aber niemand
    // könnte an ihm noch erkennen, ob eine Zahl plausibel ist.
    if (room.levelId === 'kg') {
      room.name = isWest ? 'Keller' : 'Technik';
      room.usage = (isWest ? 'storage' : 'technical') as never;
      // Beide Kellerräume ohne Lüftungsrolle: ein Abluftraum ohne Abluftventil
      // brächte eine Warnung ins Bild, die mit dem Keller nichts zu tun hat.
      room.ventilationRole = 'none';
      // Unbeheizt — der Regelfall beim Keller im Wohnungsbau, und der
      // interessantere Fall: die Decke des Erdgeschosses grenzt damit an
      // einen unbeheizten Bereich mit θ_u, während die Kellerwände selbst
      // weiterhin ihre erdberührten Teilflächen in den Export tragen. Beheizt
      // wäre der Keller nur eine vierte Wohnebene.
      room.isHeated = false;
      room.setpointTemperature = 15;
      continue;
    }
    const [name, usage] = named[isWest ? 0 : 1];
    room.name = `${name} ${doc.levels[room.levelId]?.name ?? ''}`.trim();
    room.usage = usage as never;
    room.ventilationRole = isWest ? 'supply' : 'exhaust';
    room.setpointTemperature = isWest ? 20 : 24;
  }

  // TGA-Objekte ihren Räumen zuordnen.
  for (const f of Object.values(doc.fixtures)) {
    const room = Object.values(doc.rooms).find(
      (r) => r.levelId === f.levelId && (f.position.x < 6) === (r.centroid.x < 6),
    );
    if (room) f.roomId = room.id;
  }

  return doc;
}

// ---------------------------------------------------------------------------
// Der Sollstand
// ---------------------------------------------------------------------------

export interface ReferenceReport {
  [key: string]: number | string | boolean | ReferenceReport | ReferenceReport[];
}

/**
 * Verdichtet den Export auf die Zahlen, auf die es ankommt. Bewusst nicht der
 * ganze Export: dessen Reihenfolge und Rohgeometrie sind Rauschen, an dem ein
 * Regressionstest nur scheitern würde, ohne etwas zu zeigen.
 */
export function buildReferenceReport(doc: BimDocument): ReferenceReport {
  const ex = buildRaviaExport(doc);
  const ifc = buildIfc(doc);
  const net = buildPipeNetwork(doc);
  const report = validateModel(doc);

  const count = (needle: string): number => ifc.split(needle).length - 1;

  const rooms: ReferenceReport[] = ex.rooms
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((room) => ({
      id: room.id,
      name: room.name,
      level: room.level,
      area: r3(room.area),
      netFloorArea: r3(room.netFloorArea ?? 0),
      volume: r3(room.volume),
      perimeter: r3(room.perimeter),
      height: r3(room.height),
      surfaces: room.surfaces.length,
      exteriorWallArea: r3(room.exteriorWallArea),
      windowArea: r3(room.totalWindowArea),
      groundContactPerimeter: r3(room.groundContactPerimeter),
      characteristicGroundDimension: r3(room.characteristicGroundDimension),
      // Erdberührung: Fläche, Zahl der erdberührten Bauteile und die größte
      // Einbindetiefe. Ohne diese drei Zahlen ginge eine verschobene
      // Geländeoberkante im Sollstand unter — die Gesamtflächen bleiben ja
      // gleich, es verschiebt sich nur, welche Temperatur dahinter steht.
      groundContactArea: r3(room.groundContactArea),
      groundSurfaces: room.surfaces.filter((s) => s.boundary === 'ground').length,
      embedmentDepth: r3(
        room.surfaces.reduce((max, s) => Math.max(max, s.groundContact?.embedmentDepth ?? 0), 0),
      ),
      exposedFacadeCount: room.exposedFacadeCount,
      minimumAirflow: r3(room.minimumAirflow),
      installedHeatingPower: room.installedHeatingPower,
      thermalBridgeHeatLoss: r3(room.thermalBridgeHeatLoss ?? 0),
      thermalBridges: room.thermalBridges?.length ?? 0,
      ventilationRole: room.ventilation.role,
      effectiveSupplyAirflow: room.ventilation.effectiveSupplyAirflow,
      livingArea: r3(room.roof?.livingArea ?? 0),
      slopedArea: r3(room.roof?.slopedArea ?? 0),
      // Summe A·(U+ΔU) je Raum — die eine Zahl, in der jede Flächen- oder
      // U-Wert-Verschiebung sichtbar wird.
      envelopeConductance: r3(
        room.surfaces.reduce(
          (sum, s) =>
            sum +
            s.netArea * (s.uValue + (s.thermalBridgeSupplement ?? 0)) +
            (s.openings ?? []).reduce((o, op) => o + op.area * op.uValue, 0),
          0,
        ),
      ),
    }));

  return {
    schema: ex.schema,
    version: ex.version,
    rooms,
    totals: {
      roomCount: ex.totals.roomCount,
      netFloorArea: r3(ex.totals.netFloorArea),
      netVolume: r3(ex.totals.netVolume),
      exteriorWallArea: r3(ex.totals.exteriorWallArea),
      windowArea: r3(ex.totals.windowArea),
      windowWallRatio: r3(ex.totals.windowWallRatio),
      compactness: r3(ex.totals.compactness),
      installedHeatingPower: ex.totals.installedHeatingPower,
      heatedVolume: r3(ex.totals.heatedVolume),
      bridgeMethod: ex.totals.thermalBridges.method,
      bridgeDetailed: r3(ex.totals.thermalBridges.detailedHeatLoss),
      bridgeFlat: r3(ex.totals.thermalBridges.flatHeatLoss),
      bridgeEquivalent: r3(ex.totals.thermalBridges.equivalentSupplement),
      envelopeArea: r3(ex.totals.thermalBridges.envelopeArea),
      ventilationKind: ex.totals.ventilation.kind,
      supplyAirflow: ex.totals.ventilation.supplyAirflow,
      exhaustAirflow: ex.totals.ventilation.exhaustAirflow,
      effectiveSupplyAirflow: ex.totals.ventilation.effectiveSupplyAirflow,
      ventilationBalance: ex.totals.ventilation.balance,
      setbackTimeConstant: r3(ex.totals.setback?.timeConstant ?? 0),
      setbackTemperatureDrop: r3(ex.totals.setback?.temperatureDrop ?? 0),
    },
    pipes: {
      schedule: ex.pipeSchedule.length,
      scheduleLength: r3(ex.pipeSchedule.reduce((sum, e) => sum + e.length, 0)),
      paths: net.paths.length,
      unconnected: net.unconnected.length,
      worstCircuitLength: r3(net.worstPath?.circuitLength ?? 0),
    },
    validation: {
      errors: report.errors,
      warnings: report.warnings,
      infos: report.infos,
      ready: report.ready,
      codes: report.issues
        .map((i) => i.code)
        .sort()
        .join(','),
    },
    ifc: {
      lines: ifc.split('\n').length,
      walls: count('IFCWALLSTANDARDCASE('),
      windows: count('IFCWINDOW('),
      doors: count('IFCDOOR('),
      spaces: count('IFCSPACE('),
      openingElements: count('IFCOPENINGELEMENT('),
      stairs: count('IFCSTAIR('),
      roofs: count('IFCROOF('),
    },
  };
}
