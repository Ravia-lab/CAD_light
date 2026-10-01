/**
 * Prüfblock „Netzexport" — das Rohrnetz als Netz, und die Flächenheizkreise.
 *
 * **Worum es geht.** Die RaVia-Seite hat am 01.10.2026 entschieden, ihren
 * eigenen Rohrnetzrechner entfallen zu lassen: Das Rohrnetz kommt künftig
 * ausschließlich aus dieser Datei. Damit ist der Block `pipeGraph` keine
 * Beigabe, sondern die Grundlage des hydraulischen Abgleichs auf der
 * Gegenseite — und der Punkt, an dem ein stiller Fehler am teuersten wäre:
 * Eine falsche Topologie fällt dort nicht auf, sie rechnet nur anders.
 *
 * **Was hier geprüft wird, ist die Topologie selbst.** Ein Netz mit einer
 * Verzweigung: Quelle → Hauptleitung → Abzweig → zwei Heizkörper. Daran lassen
 * sich alle Aussagen von Hand nachzählen:
 *
 *  · Der gemeinsame Abschnitt steht **einmal** da, nicht zweimal — obwohl zwei
 *    Fließwege über ihn laufen.
 *  · Er führt **beide** Verbraucher und die **Summe** ihrer Ströme.
 *  · Sein Druckverlust fehlt, weil er vom Fließweg abhängt; der des
 *    eindeutigen Abschnitts steht da.
 *  · Der Vorgänger zeigt zur Quelle, nicht vom ihr weg.
 *  · Der Abzweigknoten ist als Verzweigung gemeldet, mit zwei Abgängen.
 *
 * **Alle Sollwerte sind von Hand hergeleitet.**
 */

import type { CheckFn } from './typ';
import type { BimDocument, Fixture, PipeRun, Room } from '../../src/types/bim';
import { buildPipeNetwork } from '../../src/lib/pipeNetwork';
import { balanceNetwork } from '../../src/lib/hydraulicBalance';
import { baueNetzExport, baueFlaechenkreise, gemischteRaeume } from '../../src/lib/netzExport';

/** Ein Dokument, das nur enthält, was das Netz braucht. */
function baueNetzHaus(): BimDocument {
  const fix = (id: string, type: string, x: number, y: number, extra: Record<string, unknown> = {}): Fixture =>
    ({
      id,
      type,
      levelId: 'eg',
      position: { x, y },
      rotation: 0,
      length: 1,
      depth: 0.1,
      elevation: 0.15,
      layerId: 'layer-tga',
      params: { powerW: 1000, flowTemperature: 55, returnTemperature: 45 },
      ...extra,
    }) as unknown as Fixture;

  const rohr = (id: string, von: [number, number], nach: [number, number]): PipeRun =>
    ({
      id,
      levelId: 'eg',
      service: 'heating-flow',
      points: [{ x: von[0], y: von[1] }, { x: nach[0], y: nach[1] }],
      nominalDiameter: 20,
      insulation: 0,
      elevation: 0.3,
      layerId: 'layer-tga',
      generated: true,
    }) as unknown as PipeRun;

  return {
    schemaVersion: 1,
    activeLevelId: 'eg',
    levels: { eg: { id: 'eg', name: 'EG', order: 0, elevation: 0, height: 2.5 } },
    nodes: {},
    walls: {},
    openings: {},
    rooms: {},
    fixtures: {
      sp: fix('sp', 'storage', 0, 0, { label: 'Speicher' }),
      hk1: fix('hk1', 'radiator', 5, 0, { label: 'HK 1' }),
      hk2: fix('hk2', 'radiator', 5, 3, { label: 'HK 2' }),
    },
    pipes: {
      haupt: rohr('haupt', [0, 0], [4, 0]),
      ab1: rohr('ab1', [4, 0], [5, 0]),
      ab2: rohr('ab2', [4, 0], [5, 3]),
    },
    diagnostics: { openEnds: [], gaps: [], nearMisses: [] },
    meta: {},
  } as unknown as BimDocument;
}

/** Ein Haus mit einem Raum, Fußbodenheizung und Verteiler. */
function baueFbhHaus(): BimDocument {
  const raum: Room = {
    id: 'r1',
    levelId: 'eg',
    name: 'Wohnen',
    usage: 'living',
    // 5,00 × 4,00 m lichte Fläche = 20,00 m²
    innerPolygon: [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 4 },
      { x: 0, y: 4 },
    ],
    centroid: { x: 2.5, y: 2 },
    area: 20,
    isHeated: true,
    setpoint: 20,
  } as unknown as Room;

  const fbh = {
    id: 'fbh1',
    type: 'underfloor',
    levelId: 'eg',
    roomId: 'r1',
    position: { x: 2.5, y: 2 },
    rotation: 0,
    length: 0.4,
    depth: 0.4,
    elevation: 0,
    layerId: 'layer-tga',
    label: 'FBH Wohnen',
    params: {
      roomCoverage: true,
      loopSpacing: 0.15,
      loopCount: 2,
      powerW: 1400,
      flowTemperature: 35,
      returnTemperature: 28,
    },
  } as unknown as Fixture;

  const verteiler = {
    id: 'vt1',
    type: 'manifold',
    levelId: 'eg',
    position: { x: 0.3, y: 0.3 },
    rotation: 0,
    length: 0.6,
    depth: 0.12,
    elevation: 0.3,
    layerId: 'layer-tga',
    label: 'HKV EG',
    params: {},
  } as unknown as Fixture;

  return {
    schemaVersion: 1,
    activeLevelId: 'eg',
    levels: { eg: { id: 'eg', name: 'EG', order: 0, elevation: 0, height: 2.5 } },
    nodes: {},
    walls: {},
    openings: {},
    rooms: { r1: raum },
    fixtures: { fbh1: fbh, vt1: verteiler },
    pipes: {},
    diagnostics: { openEnds: [], gaps: [], nearMisses: [] },
    meta: {},
  } as unknown as BimDocument;
}

export function pruefeNetzexport(check: CheckFn): void {
  // =========================================================================
  // 1 · Topologie: eine Verzweigung, zwei Heizkörper
  // =========================================================================
  const haus = baueNetzHaus();
  const netz = buildPipeNetwork(haus);
  check('Netzexport · zwei Fließwege gefunden', netz.paths.length, 2);
  // Gegenprobe, dass der Graph überhaupt trägt: kein Verbraucher ohne Weg.
  check('Netzexport · kein Verbraucher unverbunden', netz.unconnected.length, 0);
  // Jeder Abschnitt trägt sein Knotenpaar — ohne das gibt es keine Topologie.
  check('Netzexport · jeder Abschnitt kennt seine Knoten',
    netz.paths.every((p) => p.segments.every((s) => s.fromNode !== undefined && s.toNode !== undefined)), true);

  /*
   * Die Spreizung wird hier **ausdrücklich** gesetzt. Ohne Angabe nimmt der
   * Abgleich seine Vorgabe von 7 K, und dann hinge der Sollwert unten an einer
   * Vorbelegung statt an einer Rechnung: 10 K sind die Spreizung eines
   * Heizkörperkreises, und mit ihr ist 1 kW → 86 l/h von Hand nachzurechnen.
   */
  const abgleich = balanceNetwork({
    network: netz,
    fixtures: haus.fixtures,
    spread: 10,
    terminalLoss: 10000,
  });
  const graph = baueNetzExport(haus, netz, abgleich);

  /*
   * Drei Abschnitte: Hauptleitung (0|0)→(4|0), Abzweig zu HK 1 und Abzweig zu
   * HK 2. Die Hauptleitung liegt in **beiden** Wegen und darf trotzdem nur
   * einmal dastehen — das ist der Kern des ganzen Blocks.
   */
  check('Netzexport · drei Abschnitte, nicht vier', graph.segments.length, 3);
  const haupt = graph.segments.find((s) => s.runId === 'haupt');
  const zuHk1 = graph.segments.find((s) => s.runId === 'ab1');
  const zuHk2 = graph.segments.find((s) => s.runId === 'ab2');
  check('Netzexport · die Hauptleitung steht da', haupt !== undefined, true);
  check('Netzexport · und beide Abzweige', zuHk1 !== undefined && zuHk2 !== undefined, true);

  // Länge: (0|0) bis (4|0) sind 4,00 m — einfache Länge, nicht hin und zurück.
  check('Netzexport · Hauptleitung 4,00 m', haupt?.length ?? 0, 4.0, 1e-6);
  // Abzweig zu HK 1: (4|0) bis (5|0) = 1,00 m.
  check('Netzexport · Abzweig 1,00 m', zuHk1?.length ?? 0, 1.0, 1e-6);
  // Abzweig zu HK 2: (4|0) bis (5|3) = √(1+9) = 3,1623 m.
  check('Netzexport · schräger Abzweig 3,162 m', zuHk2?.length ?? 0, Math.sqrt(10), 0.01);

  // Beide Verbraucher hängen hinter der Hauptleitung, je einer hinter seinem Abzweig.
  check('Netzexport · zwei Verbraucher hinter der Hauptleitung', haupt?.consumers.length ?? 0, 2);
  check('Netzexport · einer hinter dem Abzweig', zuHk1?.consumers.length ?? 0, 1);
  check('Netzexport · und zwar der richtige', zuHk1?.consumers[0] ?? '', 'hk1');

  /*
   * Der Strom der Hauptleitung ist die **Summe** der beiden Heizkörper. Im
   * Fließweg steht je Verbraucher sein eigener Strom — physikalisch führt die
   * Hauptleitung beide. Beide Heizkörper tragen 1000 W bei 10 K Spreizung,
   * also je rund 0,086 m³/h; zusammen rund 0,172 m³/h.
   */
  const summe = (abgleich.consumers[0]?.flow ?? 0) + (abgleich.consumers[1]?.flow ?? 0);
  check('Netzexport · Strom der Hauptleitung ist die Summe', haupt?.flow ?? 0, summe, 1e-3);
  check('Netzexport · und größer als der eines Abzweigs',
    (haupt?.flow ?? 0) > (zuHk1?.flow ?? 0), true);
  /*
   * Gegenprobe gegen die Handrechnung: V̇ = Q · 3600 / (ρ·c_p · ΔT)
   *   = 1 kW · 3 600 000 / (4,19 MJ/(m³·K) · 10 K) = 85,9 l/h = 0,0859 m³/h.
   */
  check('Netzexport · ein Heizkörper rund 0,086 m³/h', zuHk1?.flow ?? 0, 0.086, 0.004);

  /*
   * Der Druckverlust hängt am Fließweg. Beim Abzweig mit genau einem
   * Verbraucher ist er eindeutig und steht da; bei der Hauptleitung mit zwei
   * Verbrauchern wäre er eine von zwei Zahlen und bleibt deshalb weg.
   */
  check('Netzexport · Druckverlust am eindeutigen Abschnitt', (zuHk1?.lossPa ?? 0) > 0, true);
  check('Netzexport · keiner am gemeinsamen Abschnitt', haupt?.lossPa === undefined, true);
  check('Netzexport · Innendurchmesser steht am Abschnitt', (zuHk1?.innerDiameter ?? 0) > 0, true);

  // Vorgänger: Der Abzweig folgt auf die Hauptleitung, die Hauptleitung auf nichts.
  check('Netzexport · der Abzweig folgt auf die Hauptleitung', zuHk1?.parentId ?? '', haupt?.id ?? 'x');
  check('Netzexport · die Hauptleitung hat keinen Vorgänger', haupt?.parentId === undefined, true);
  // Und der Vorgänger zeigt zur Quelle und nicht umgekehrt — die Gegenprobe.
  check('Netzexport · die Hauptleitung ist nicht Nachfolger des Abzweigs',
    haupt?.parentId === zuHk1?.id, false);

  // Knoten: Der Abzweigpunkt (4|0) hat zwei Abgänge und heißt Verzweigung.
  const verzweigung = graph.nodes.find((n) => n.kind === 'branch');
  check('Netzexport · es gibt genau eine Verzweigung',
    graph.nodes.filter((n) => n.kind === 'branch').length, 1);
  check('Netzexport · mit zwei Abgängen', verzweigung?.outgoing ?? 0, 2);
  check('Netzexport · eine Quelle', graph.nodes.filter((n) => n.kind === 'source').length, 1);
  check('Netzexport · zwei Verbraucherknoten', graph.nodes.filter((n) => n.kind === 'consumer').length, 2);
  // Jeder Knoten, den ein Abschnitt nennt, steht auch in der Knotenliste —
  // sonst zeigte die Topologie ins Leere.
  const kennungen = new Set(graph.nodes.map((n) => n.id));
  check('Netzexport · kein Abschnitt zeigt auf einen unbekannten Knoten',
    graph.segments.every((s) => kennungen.has(s.fromNode) && kennungen.has(s.toNode)), true);
  // Und jeder Vorgänger ist ein Abschnitt, den es gibt.
  const abschnittIds = new Set(graph.segments.map((s) => s.id));
  check('Netzexport · jeder Vorgänger existiert',
    graph.segments.every((s) => s.parentId === undefined || abschnittIds.has(s.parentId)), true);

  // =========================================================================
  // 2 · Flächenheizkreise
  // =========================================================================
  const fbhHaus = baueFbhHaus();
  const kreise = baueFlaechenkreise(fbhHaus);
  check('Netzexport · ein Flächenkreis', kreise.length, 1);
  const k = kreise[0];
  check('Netzexport · er hängt am richtigen Raum', k?.roomId ?? '', 'r1');
  check('Netzexport · zwei Kreise im Raum', k?.loops ?? 0, 2);
  check('Netzexport · Verlegeabstand 0,15 m', k?.spacing ?? 0, 0.15, 1e-9);
  /*
   * Raumfläche 5,00 × 4,00 = 20,00 m². Die versorgte Fläche ist kleiner: Nach
   * Randabstand bleibt weniger übrig. Beides muss dastehen, und die versorgte
   * muss kleiner sein — eine Flächenheizung, die den Randstreifen mitbelegt,
   * gibt es nicht.
   */
  check('Netzexport · Raumfläche 20 m²', k?.roomArea ?? 0, 20, 0.01);
  check('Netzexport · versorgte Fläche ist kleiner', (k?.servedArea ?? 99) < (k?.roomArea ?? 0), true);
  check('Netzexport · und nicht absurd klein', (k?.servedArea ?? 0) > 12, true);
  /*
   * Rohrlänge: Bei 0,15 m Verlegeabstand liegen auf einem Quadratmeter rund
   * 1/0,15 = 6,7 m Rohr. Auf gut 16 m² belegbarer Fläche sind das rund 110 m.
   * Geprüft wird die Größenordnung — die genaue Zahl folgt aus der Kurve.
   */
  check('Netzexport · Rohr in der Fläche über 80 m', (k?.fieldLength ?? 0) > 80, true);
  check('Netzexport · und unter 200 m', (k?.fieldLength ?? 0) < 200, true);
  // Kreislänge ist die Länge **eines** Kreises, also etwa die Hälfte.
  check('Netzexport · Kreislänge ist die Länge eines Kreises',
    (k?.loopLength ?? 0) < (k?.fieldLength ?? 0), true);
  check('Netzexport · Vorlauf 35 °C', k?.flowTemperature ?? 0, 35);
  check('Netzexport · Spreizung 7 K', k?.spread ?? 0, 7, 1e-9);
  /*
   * Volumenstrom: 1400 W bei 7 K. V̇ = 1,4 kW · 3600 / (ρ·c_p · 7 K); mit
   * ρ·c_p ≈ 4,15 MJ/(m³·K) bei 31,5 °C Mitteltemperatur ergibt das
   * 5040 / 29 050 = 0,173 m³/h.
   */
  check('Netzexport · Volumenstrom 0,173 m³/h', k?.flow ?? 0, 0.173, 0.01);
  check('Netzexport · am Verteiler angebunden', k?.manifoldId ?? '', 'vt1');
  check('Netzexport · mit Abgang 1', k?.manifoldPort ?? 0, 1);

  // Gegenprobe: ohne Fußbodenheizung gibt es keine Kreise.
  check('Netzexport · ohne FBH keine Kreise', baueFlaechenkreise(baueNetzHaus()).length, 0);

  // =========================================================================
  // 3 · Gemischt beheizte Räume
  // =========================================================================
  // Im FBH-Haus steht kein Heizkörper — also nichts zu melden.
  check('Netzexport · nur FBH ist nicht gemischt', gemischteRaeume(fbhHaus).length, 0);
  // Einen Heizkörper in denselben Raum, und es ist gemischt.
  const gemischt = {
    ...fbhHaus,
    fixtures: {
      ...fbhHaus.fixtures,
      hk: {
        id: 'hk', type: 'radiator', levelId: 'eg', roomId: 'r1',
        position: { x: 1, y: 0.2 }, rotation: 0, length: 1, depth: 0.1,
        elevation: 0.15, layerId: 'layer-tga', params: { powerW: 500 },
      } as unknown as Fixture,
    },
  } as unknown as BimDocument;
  const gm = gemischteRaeume(gemischt);
  check('Einmal gemischt beheizt', gm.length, 1);
  check('Netzexport · mit Raumnamen', gm[0]?.room ?? '', 'Wohnen');
  check('Netzexport · ein Heizkörper', gm[0]?.radiators ?? 0, 1);
  check('Netzexport · und ein Flächenkreis', gm[0]?.floorCircuits ?? 0, 1);
}
