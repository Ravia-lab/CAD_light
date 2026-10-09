/**
 * Prüfblock „Fußbodenheizung: Kreise einzeln, zu lange Kreise geteilt" (1.77.0).
 * ---------------------------------------------------------------------------
 * **Die Meldung (09.10.2026):** „Wir brauchen das auch für Fußbodenheizung —
 * ab bestimmten Verlegelängen gibt es weitere Heizkreise, z. B. Länge 200 m,
 * ergo 2 × 100." Dazu RaVia: Für FBH gebe es keine stabile Zuordnung, die
 * Längen kämen nur im eindeutigen Fall an.
 *
 * Geprüft wird:
 *  1. **Teilen.** Ein Raum, dessen Rohr nicht in einen Kreis passt, bekommt so
 *     viele Kreise, dass jeder unter 100 m bleibt — Anbindung eingerechnet.
 *     Das Rohr in der Fläche bleibt dabei dasselbe (es wird geteilt, nicht
 *     verlängert). Gegenprobe: ein kleiner Raum wird nicht geteilt, und ohne
 *     `autoSplit` bleibt es beim alten Verhalten (nur Meldung).
 *  2. **Export je Kreis** mit stabiler Kennung, fortlaufenden Abgängen über
 *     zwei Räume, Leistung und Strom nach Fläche (Summe = Raum), und der
 *     Zuleitung Erzeuger → Verteiler.
 */

import type { CheckFn } from './typ';
import type { BimDocument, Fixture, PipeRun, Room } from '../../src/types/bim';
import { planFloorLoops, DEFAULT_MAX_CIRCUIT_LENGTH } from '../../src/lib/floorLoopLayout';
import { buildPipeNetwork } from '../../src/lib/pipeNetwork';
import { baueFlaechenkreise } from '../../src/lib/netzExport';
import { floorLoopBadge } from '../../src/lib/fixtureSymbols';
import { sammleVerlegekurven } from '../../src/lib/fussbodenkurven';

const rechteck = (x0: number, y0: number, b: number, h: number) => [
  { x: x0, y: y0 },
  { x: x0 + b, y: y0 },
  { x: x0 + b, y: y0 + h },
  { x: x0, y: y0 + h },
];

function raum(id: string, x0: number, b: number, h: number): Room {
  return {
    id,
    levelId: 'eg',
    name: id,
    usage: 'living',
    innerPolygon: rechteck(x0, 0, b, h),
    centroid: { x: x0 + b / 2, y: h / 2 },
    area: b * h,
    isHeated: true,
    setpoint: 20,
  } as unknown as Room;
}

function fbh(id: string, roomId: string, x: number, powerW: number, loopCount = 1): Fixture {
  return {
    id,
    type: 'underfloor',
    levelId: 'eg',
    roomId,
    position: { x, y: 1 },
    rotation: 0,
    length: 0.4,
    depth: 0.4,
    elevation: 0,
    layerId: 'layer-tga',
    label: `FBH ${roomId}`,
    params: { roomCoverage: true, loopSpacing: 0.15, loopCount, powerW, flowTemperature: 35, returnTemperature: 28 },
  } as unknown as Fixture;
}

const fixture = (id: string, type: string, x: number, y: number): Fixture =>
  ({
    id,
    type,
    levelId: 'eg',
    position: { x, y },
    rotation: 0,
    length: 0.6,
    depth: 0.3,
    elevation: 0.02,
    layerId: 'layer-tga',
    label: id,
    params: {},
  }) as unknown as Fixture;

export function pruefeFbhKreise(check: CheckFn): void {
  console.log('\n▸ Fußbodenheizung — Kreise einzeln, zu lange Kreise geteilt (1.77.0)');

  // =========================================================================
  // 1 · Teilen
  // =========================================================================
  /*
   * Raum 6,00 × 5,00 m. Nach 10 cm Randabstand bleiben rund 5,8 × 4,8 m
   * = 27,8 m²; bei 0,15 m Verlegeabstand liegen darauf ≈ 27,8 / 0,15 ≈ 186 m
   * Rohr. Verteiler in der Ecke (0,3 | 0,3). Ein Kreis wäre also weit über
   * 100 m — die Meldung „200 m, ergo 2 × 100".
   */
  const polygon = rechteck(0, 0, 6, 5);
  const manifold = { x: 0.3, y: 0.3 };
  const ohne = planFloorLoops(polygon, { spacing: 0.15, loops: 1, manifold });
  check('Teilen · ohne autoSplit: ein Kreis wie bisher', ohne.loops, 1);
  check('Teilen · ohne autoSplit: er ist zu lang (> 150 m)', ohne.circuits[0]?.circuitLength > 150, true);
  check('Teilen · ohne autoSplit: und wird gemeldet', ohne.notes.some((n) => n.severity === 'warn' && n.text.includes('überschreiten')), true);

  const mit = planFloorLoops(polygon, { spacing: 0.15, loops: 1, manifold, autoSplit: true });
  check('Teilen · mit autoSplit: mehr als ein Kreis', mit.loops >= 2, true);
  check('Teilen · jeder Kreis höchstens 100 m (Anbindung eingerechnet)',
    mit.circuits.every((c) => c.circuitLength <= DEFAULT_MAX_CIRCUIT_LENGTH + 0.01), true);
  check('Teilen · splitFrom nennt die eingetragene Zahl', mit.splitFrom ?? 0, 1);
  check('Teilen · eine Kreisliste je gelegtem Kreis', mit.circuits.length, mit.loops);
  /*
   * Geteilt, nicht verlängert: Das Rohr in der Fläche folgt weiter aus
   * Fläche durch Verlegeabstand. Mit dem Vorgabemuster Schnecke ist der eine
   * Kreis 175,4 m lang; zwei Kreise legt das Programm als Mäander (eine
   * Schnecke trägt nur einen Kreis), 185,6 m gerade Bahnen. Verglichen wird
   * deshalb nicht mit dem einen Kreis, sondern mit der Fläche: belegbare
   * Fläche / 0,15 m, Abweichung unter 10 %.
   */
  check('Teilen · Rohr in der Fläche ≈ Fläche / Verlegeabstand (± 10 %)',
    Math.abs(mit.fieldLength - mit.layableArea / 0.15) / (mit.layableArea / 0.15) < 0.1, true);
  check('Teilen · die Fläche der Kreise ist die belegbare Fläche (± 10 %)',
    Math.abs(mit.circuits.reduce((s, c) => s + c.area, 0) - mit.layableArea) / mit.layableArea < 0.1, true);
  // Die Einzelkreise summieren sich zur Raumsumme.
  check('Teilen · Summe der Kreise = Kreislänge des Raums',
    mit.circuits.reduce((s, c) => s + c.circuitLength, 0), mit.circuitLength, 0.05);
  check('Teilen · die Meldung nennt die neue Zahl', mit.notes.some((n) => n.severity === 'info' && n.text.includes(`${mit.loops} statt 1`)), true);
  check('Teilen · keine Überschreitungswarnung mehr', mit.notes.some((n) => n.text.includes('überschreiten die angesetzten')), false);
  /*
   * Nicht mehr Kreise als nötig: Mit einem Kreis weniger wäre mindestens
   * einer zu lang — sonst hätte das Teilen dort aufgehört.
   */
  const einerWeniger = planFloorLoops(polygon, { spacing: 0.15, loops: mit.loops - 1, manifold });
  check('Teilen · mit einem Kreis weniger wäre einer zu lang',
    einerWeniger.circuits.some((c) => c.circuitLength > DEFAULT_MAX_CIRCUIT_LENGTH), true);

  // Gegenprobe: 3,00 × 3,00 m, ≈ 50 m Rohr — bleibt ein Kreis, nichts geteilt.
  const klein = planFloorLoops(rechteck(0, 0, 3, 3), { spacing: 0.15, loops: 1, manifold, autoSplit: true });
  check('Teilen · Gegenprobe: kleiner Raum bleibt ein Kreis', klein.loops, 1);
  check('Teilen · Gegenprobe: kein splitFrom', klein.splitFrom === undefined, true);
  // Eine eingetragene höhere Kreiszahl bleibt die Untergrenze.
  const vier = planFloorLoops(rechteck(0, 0, 3, 3), { spacing: 0.15, loops: 3, manifold, autoSplit: true });
  check('Teilen · eingetragene 3 Kreise werden nicht verringert', vier.loops, 3);

  // =========================================================================
  // 2 · Export je Kreis
  // =========================================================================
  /*
   * Zwei Räume nebeneinander, beide am Verteiler bei (0,3 | 0,3):
   *   A  6,00 × 5,00 m, 2 400 W → wird geteilt
   *   B  3,00 × 3,00 m (ab x = 6,5),   600 W → ein Kreis
   * Kessel bei (−4 | 0,3), Vorlaufleitung 4,30 m gerade bis zum Verteiler.
   */
  const doc = {
    schemaVersion: 1,
    activeLevelId: 'eg',
    levels: { eg: { id: 'eg', name: 'EG', order: 0, elevation: 0, height: 2.5 } },
    nodes: {},
    walls: {},
    openings: {},
    rooms: { A: raum('A', 0, 6, 5), B: raum('B', 6.5, 3, 3) },
    fixtures: {
      fA: fbh('fA', 'A', 3, 2400),
      fB: fbh('fB', 'B', 8, 600),
      vt: fixture('vt', 'manifold', 0.3, 0.3),
      kessel: fixture('kessel', 'boiler', -4, 0.3),
    },
    pipes: {
      zu: {
        id: 'zu',
        levelId: 'eg',
        service: 'heating-flow',
        points: [{ x: -4, y: 0.3 }, { x: 0.3, y: 0.3 }],
        nominalDiameter: 20,
        outerDiameter: 22,
        insulation: 0,
        elevation: 0.02,
        material: 'kupfer',
      } as unknown as PipeRun,
    },
    diagnostics: { openEnds: [], gaps: [], nearMisses: [] },
    meta: {},
  } as unknown as BimDocument;

  const netz = buildPipeNetwork(doc);
  const zuleitung = netz.manifoldFeeds?.find((m) => m.manifoldId === 'vt');
  check('Export · Zuleitung des Verteilers gefunden', zuleitung?.generatorId ?? '', 'kessel');
  check('Export · Zuleitung 4,30 m (Handmaß)', zuleitung?.routeLength ?? 0, 4.3, 0.05);

  const kreise = baueFlaechenkreise(doc, netz);
  const a = kreise.find((k) => k.fixtureId === 'fA');
  const b = kreise.find((k) => k.fixtureId === 'fB');
  check('Export · beide Räume da', kreise.length, 2);
  check('Export · A geteilt, splitFrom 1', a?.splitFrom ?? 0, 1);
  check('Export · A: loops = Zahl der Einzelkreise', a?.loops ?? 0, a?.circuits.length ?? -1);
  check('Export · A: jeder Kreis ≤ maxLoopLength', (a?.circuits ?? []).every((c) => c.loopLength <= (a?.maxLoopLength ?? 0) + 0.01), true);
  check('Export · A: maxLoopLength 100 m', a?.maxLoopLength ?? 0, 100);
  check('Export · Kennung <fixtureId>#<n>', a?.circuits.map((c) => c.id).join(',') ?? '',
    (a?.circuits ?? []).map((_, i) => `fA#${i + 1}`).join(','));
  check('Export · B nicht geteilt', b?.splitFrom === undefined && b?.circuits.length === 1, true);
  // Leistung und Strom: nach Fläche geteilt, Summe = Raum.
  check('Export · A: Summe der Kreisleistungen = 2 400 W', (a?.circuits ?? []).reduce((s, c) => s + c.powerW, 0), 2400, 2);
  check('Export · A: Summe der Kreisströme = Raumstrom', (a?.circuits ?? []).reduce((s, c) => s + c.flow, 0), a?.flow ?? -1, 0.0005);
  // Abgänge fortlaufend je Kreis über beide Räume: A 1…n, B n+1.
  const portsA = (a?.circuits ?? []).map((c) => c.manifoldPort);
  check('Export · A: Abgänge 1 … n', portsA.join(','), portsA.map((_, i) => i + 1).join(','));
  check('Export · B: nächster freier Abgang (nicht 2)', b?.circuits[0]?.manifoldPort ?? 0, (a?.circuits.length ?? 0) + 1);
  check('Export · manifoldPort der Heizfläche = erster Abgang', b?.manifoldPort ?? 0, b?.circuits[0]?.manifoldPort ?? -1);
  check('Export · Zuleitung am Flächenkreis', a?.feedLength ?? 0, zuleitung?.routeLength ?? -1, 1e-9);
  check('Export · Erzeuger am Flächenkreis', a?.generatorId ?? '', 'kessel');
  // Gegenprobe: ohne Netz keine erfundene Zuleitung.
  const ohneNetz = baueFlaechenkreise(doc);
  check('Export · Gegenprobe: ohne Netz keine feedLength', ohneNetz.every((k) => k.feedLength === undefined), true);

  // =========================================================================
  // 3 · Die Beschriftung im Plan nennt die Kreise einzeln
  // =========================================================================
  const kurve = sammleVerlegekurven(doc, 'eg').find((k) => k.fixture.id === 'fA');
  const schild = kurve ? floorLoopBadge(kurve.fixture, kurve.layout) : '';
  console.log(`    Beschriftung A: ${schild}`);
  check('Plan · nennt die gelegte Kreiszahl, nicht die eingetragene', schild.includes(`${a?.loops} Kreise`), true);
  check('Plan · nennt die Kreislängen einzeln („… + … m")', / \+ /.test(schild), true);
}
