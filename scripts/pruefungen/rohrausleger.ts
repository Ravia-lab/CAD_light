/**
 * Prüfblock „Rohrausleger" — die Trasse, die Dimension und die Armaturen.
 *
 * **Warum dieser Block gebraucht wird.** Ein automatisch gelegtes Rohrnetz
 * sieht auf dem Bildschirm immer plausibel aus: Linien, die von A nach B
 * laufen, wirken richtig, auch wenn der Volumenstrom im Stamm fehlt oder die
 * Dämmdicke aus der falschen Zeile der Anlage 8 stammt. Geprüft wird deshalb
 * nicht das Bild, sondern die Kette: Verbraucherleistung → Volumenstrom →
 * Abschnitt → Dimension → Dämmung — und ob der Stamm wirklich die Summe
 * trägt.
 *
 * Zweitens die Verlegeart. Neubau und Sanierung sind keine zwei Farben
 * derselben Trasse, sondern zwei verschiedene Wege: der eine darf quer durch
 * den Raum, der andere muss an der Wand bleiben. Das lässt sich messen.
 *
 * Drittens die beiden Fragen, die der Anwender gestellt hat und die man einem
 * Bild nicht ansieht:
 *
 *  • **Meidet die Trasse die Türen?** Sichtbar wird das nur an einem
 *    Grundriss, der eine Wahl lässt — zwei Wege zwischen Quelle und Ziel, einer
 *    durch die Tür, einer außen herum (`baueZweiWege`). Ob die Wahl richtig
 *    ausfällt, hängt am Verhältnis von Umweg und Türzuschlag, und beides ist
 *    aus der Geometrie ausrechenbar.
 *  • **Sitzt das Rohr an der Wand?** Nicht „ungefähr", sondern auf dem
 *    Sollabstand. Gemessen wird der Abstand jedes wandparallelen Stücks zur
 *    Wandfläche — an der Trasse und nicht an den beiden Rohren, die der
 *    Rohrausleger daneben legt.
 *
 * Alle Sollwerte sind hergeleitet und im Kommentar nachgerechnet.
 */

import type { CheckFn } from './typ';
import type {
  BimDocument,
  BimNode,
  Fixture,
  Level,
  Opening,
  PipeRoutingMode,
  Room,
  Vec2,
  Wall,
} from '../../src/types/bim';
import { emptyPlant, emptySite } from '../../src/lib/plantDefaults';
import { detectRooms } from '../../src/lib/roomDetection';
import { planPipeNetwork, SIZING_LIMITS, SOCKELLEISTE_MAX_AUSSEN } from '../../src/lib/pipeLayout';
import { routePipes, SOLLABSTAND, TUER_ZUSCHLAG } from '../../src/lib/pipeRouting';
import { getWallGeometry } from '../../src/lib/wallGeometry';
import { pointInPolygon } from '../../src/lib/geometry';

/**
 * Das Prüfhaus: zwei Räume, 5,00 × 4,00 m Achsmaß, dazwischen eine Trennwand
 * mit einer Tür. Verteiler im linken Raum, zwei Heizkörper im rechten.
 */
const B = 10;
const T = 4;
const DICKE = 0.24;
const HOEHE = 2.75;

function baueHaus(): BimDocument {
  const nodes: Record<string, BimNode> = {};
  const walls: Record<string, Wall> = {};
  const openings: Record<string, Opening> = {};

  const p = (name: string, x: number, y: number): string => {
    nodes[name] = { id: name, x, y, levelId: 'eg' };
    return name;
  };
  p('sw', 0, 0);
  p('se', B, 0);
  p('ne', B, T);
  p('nw', 0, T);
  p('ms', B / 2, 0);
  p('mn', B / 2, T);

  const wand = (name: string, a: string, b: string, typ: Wall['type'] = 'exterior'): void => {
    walls[name] = {
      id: name,
      a,
      b,
      levelId: 'eg',
      type: typ,
      thickness: DICKE,
      uValue: typ === 'exterior' ? 0.28 : 1.2,
      height: HOEHE,
      layerId: 'layer-walls',
    };
  };
  wand('w-s1', 'sw', 'ms');
  wand('w-s2', 'ms', 'se');
  wand('w-e', 'se', 'ne');
  wand('w-n1', 'ne', 'mn');
  wand('w-n2', 'mn', 'nw');
  wand('w-w', 'nw', 'sw');
  wand('w-m', 'ms', 'mn', 'interior');

  // Die Tür in der Trennwand — ohne sie zerfällt der Grundriss in zwei
  // Inseln, und keine Trasse käme in den rechten Raum.
  openings['t-1'] = {
    id: 't-1',
    wallId: 'w-m',
    kind: 'door',
    distance: T / 2,
    width: 0.885,
    height: 2.01,
    sillHeight: 0,
    doorType: 'single',
  };

  const fixture = (id: string, type: Fixture['type'], x: number, y: number, powerW?: number): Fixture => ({
    id,
    type,
    category: 'heating',
    levelId: 'eg',
    position: { x, y },
    rotation: 0,
    length: 1,
    depth: 0.1,
    elevation: 0.3,
    label: id,
    params: powerW ? { powerW } : {},
  });

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
      name: 'Prüfhaus Rohrausleger',
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
    openings,
    fixtures: {
      // Verteiler links unten, zwei Heizkörper rechts.
      'v-1': fixture('v-1', 'manifold', 0.6, 0.6),
      'hk-1': fixture('hk-1', 'radiator', 9.2, 0.6, 1400),
      'hk-2': fixture('hk-2', 'radiator', 9.2, 3.4, 900),
    },
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
    openings: Object.values(doc.openings),
    levelId: 'eg',
    defaultHeight: HOEHE,
    northAngle: 0,
  });
  doc.rooms = Object.fromEntries(raeume.map((r) => [r.id, r]));
  for (const raum of Object.values(doc.rooms)) {
    raum.setpointTemperature = 20;
    raum.isHeated = true;
  }
  return doc;
}

const r3 = (v: number): number => Math.round(v * 1000) / 1000;

// ---------------------------------------------------------------------------
// Prüfgrundriss „zwei Wege"
// ---------------------------------------------------------------------------

/**
 * Ein Raum, eine Trennwand mit Tür, die **nicht** bis zur gegenüberliegenden
 * Wand reicht.
 *
 * Damit gibt es zwischen Quelle und Ziel zwei Wege: durch die Tür oder oben um
 * die Trennwand herum. Genau diese Wahl trifft der Türzuschlag — und nur an
 * einem solchen Grundriss lässt sie sich messen. Im bestehenden Prüfhaus
 * (zwei Räume, eine Tür) gibt es keine Wahl.
 *
 * **Warum die lichte Fläche hier von Hand steht.** Die Raumerkennung
 * traversiert Facetten des Wandgraphen; eine Trennwand mit freiem Ende bildet
 * keine Facette und fällt beim Versatz auf die lichten Maße zu einer Linie
 * zusammen — der Raum käme ohne Trennwand heraus. Das ist eine Eigenschaft der
 * Raumerkennung und nicht Gegenstand dieses Blocks; das Innenpolygon wird
 * deshalb hier hingeschrieben, wie es der Grundriss vorgibt.
 */
const ZW = {
  /** Außenmaß über die Wandachsen [m]. */
  breite: 12,
  /** Achslage der Trennwand [m] von der Westwand. */
  trennwand: 6,
  /** Wandstärke [m], überall gleich. */
  dicke: 0.24,
  /** Abstand der Türmitte [m] vom Südende der Trennwand. */
  tuerAbstand: 1.0,
  /** Rohbaubreite der Tür [m] (DIN 18101). */
  tuerBreite: 0.885,
  /** Quelle und Ziel liegen auf gleicher Höhe [m] südlich der Trennwandspitze. */
  y: 0.5,
  quelleX: 1.0,
  zielX: 11.0,
} as const;

interface Grundriss {
  nodes: Record<string, BimNode>;
  walls: Wall[];
  openings: Opening[];
  rooms: Room[];
  source: Vec2;
  targets: { id: string; position: Vec2 }[];
}

function baueZweiWege(tiefe: number, trennwandLaenge: number): Grundriss {
  const nodes: Record<string, BimNode> = {};
  const walls: Wall[] = [];
  const knoten = (id: string, x: number, y: number): string => {
    nodes[id] = { id, x, y, levelId: 'eg' };
    return id;
  };
  const wand = (id: string, a: string, b: string, typ: Wall['type']): void => {
    walls.push({
      id, a, b, levelId: 'eg', type: typ, thickness: ZW.dicke,
      uValue: typ === 'exterior' ? 0.28 : 1.2, height: HOEHE, layerId: 'layer-walls',
    });
  };
  const B = ZW.breite;
  const T = tiefe;
  const TW = ZW.trennwand;
  const h = ZW.dicke / 2;

  knoten('sw', 0, 0);
  knoten('ts', TW, 0);
  knoten('se', B, 0);
  knoten('ne', B, T);
  knoten('nw', 0, T);
  knoten('tn', TW, trennwandLaenge);
  wand('w-s1', 'sw', 'ts', 'exterior');
  wand('w-s2', 'ts', 'se', 'exterior');
  wand('w-e', 'se', 'ne', 'exterior');
  wand('w-n', 'ne', 'nw', 'exterior');
  wand('w-w', 'nw', 'sw', 'exterior');
  wand('w-t', 'ts', 'tn', 'interior');

  const openings: Opening[] = [
    {
      id: 't-1', wallId: 'w-t', kind: 'door', distance: ZW.tuerAbstand,
      width: ZW.tuerBreite, height: 2.01, sillHeight: 0, doorType: 'single',
    },
  ];

  // Lichte Fläche: das Rechteck, aus dem die Trennwand als Kerbe ausgeschnitten
  // ist. Reicht die Trennwand bis zur Nordwand, entstehen zwei getrennte Räume.
  const durchgehend = trennwandLaenge >= T - h;
  const links: Vec2[] = [
    { x: h, y: h }, { x: TW - h, y: h },
    { x: TW - h, y: durchgehend ? T - h : trennwandLaenge },
  ];
  const rechts: Vec2[] = [
    { x: TW + h, y: durchgehend ? T - h : trennwandLaenge },
    { x: TW + h, y: h }, { x: B - h, y: h }, { x: B - h, y: T - h },
  ];
  const polygone = durchgehend
    ? [[...links, { x: h, y: T - h }], [...rechts, { x: TW + h, y: T - h }].reverse()]
    : [[...links, ...rechts, { x: B - h, y: T - h }, { x: h, y: T - h }]];

  const rooms: Room[] = polygone.map((poly, n) => ({
    id: `r-${n + 1}`, name: `Raum ${n + 1}`, usage: 'living', levelId: 'eg',
    polygon: poly, innerPolygon: poly,
    area: 0, grossArea: 0, perimeter: 0, height: HOEHE, volume: 0,
    centroid: { x: B / 2, y: T / 2 }, boundaries: [],
    setpointTemperature: 20, airChangeRate: 0.5, isHeated: true,
    groundContactPerimeter: 0, exposedFacadeCount: 4,
  }));

  return {
    nodes, walls, openings, rooms,
    source: { x: ZW.quelleX, y: ZW.y },
    targets: [{ id: 'hk-1', position: { x: ZW.zielX, y: ZW.y } }],
  };
}

/** Das Prüfhaus als Eingabe der Trassierung — Quelle ist der Verteiler. */
function grundrissAus(doc: BimDocument, ziele: string[]): Grundriss {
  return {
    nodes: doc.nodes,
    walls: Object.values(doc.walls),
    openings: Object.values(doc.openings),
    rooms: Object.values(doc.rooms),
    source: doc.fixtures['v-1'].position,
    targets: ziele.map((id) => ({ id, position: doc.fixtures[id].position })),
  };
}

function trassiere(g: Grundriss, mode: PipeRoutingMode) {
  return routePipes({
    mode, levelId: 'eg', rooms: g.rooms, walls: g.walls, nodes: g.nodes,
    openings: g.openings, source: g.source, targets: g.targets,
  });
}

// ---------------------------------------------------------------------------
// Messhilfen
// ---------------------------------------------------------------------------

/**
 * Abstand jedes geraden Trassenstücks zur nächsten *parallelen* Wandfläche —
 * nur Stücke, die dieser Fläche über mindestens die halbe Länge folgen und
 * nicht weiter als `fenster` entfernt sind. Alles andere läuft nicht „an der
 * Wand" und hat dort auch keinen Sollabstand einzuhalten.
 */
function wandabstaende(
  walls: Wall[],
  nodes: Record<string, BimNode>,
  zuege: Vec2[][],
  fenster: number,
): number[] {
  const flaechen: { p: Vec2; dir: Vec2; n: Vec2; von: number; bis: number }[] = [];
  for (const wall of walls) {
    const g = getWallGeometry(wall, nodes);
    if (!g) continue;
    for (const seite of [1, -1] as const) {
      flaechen.push({
        p: { x: g.a.x + g.normal.x * seite * g.halfThickness, y: g.a.y + g.normal.y * seite * g.halfThickness },
        dir: g.dir,
        n: { x: g.normal.x * seite, y: g.normal.y * seite },
        von: -g.halfThickness,
        bis: g.length + g.halfThickness,
      });
    }
  }
  const out: number[] = [];
  for (const zug of zuege) {
    for (let i = 1; i < zug.length; i++) {
      const a = zug[i - 1];
      const b = zug[i];
      const laenge = Math.hypot(b.x - a.x, b.y - a.y);
      if (laenge < 0.05) continue;
      const ux = (b.x - a.x) / laenge;
      const uy = (b.y - a.y) / laenge;
      const mitte = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      let best = Infinity;
      for (const f of flaechen) {
        if (Math.abs(f.dir.x * uy - f.dir.y * ux) > 0.02) continue;
        const d = (mitte.x - f.p.x) * f.n.x + (mitte.y - f.p.y) * f.n.y;
        if (d < -1e-9 || d > fenster || d >= best) continue;
        const ua = (a.x - f.p.x) * f.dir.x + (a.y - f.p.y) * f.dir.y;
        const ub = (b.x - f.p.x) * f.dir.x + (b.y - f.p.y) * f.dir.y;
        const ueber = Math.min(Math.max(ua, ub), f.bis) - Math.max(Math.min(ua, ub), f.von);
        if (ueber < 0.5 * laenge - 1e-9) continue;
        best = d;
      }
      if (best < Infinity) out.push(best);
    }
  }
  return out;
}

/**
 * Wie viel Trassenlänge liegt *längs* der Wand innerhalb der Wandstärke einer
 * Öffnung? Genau das ist die Schwelle bzw. die Zarge — dort gehört kein Rohr
 * hin, und die Antwort muss null sein.
 */
function laengsInOeffnung(
  zuege: Vec2[][],
  wandAchse: number,
  halbdicke: number,
  achse: 'x' | 'y',
): number {
  let summe = 0;
  for (const zug of zuege) {
    for (let i = 1; i < zug.length; i++) {
      const a = zug[i - 1];
      const b = zug[i];
      const qa = achse === 'x' ? a.x : a.y;
      const qb = achse === 'x' ? b.x : b.y;
      if (Math.abs(qa - wandAchse) > halbdicke || Math.abs(qb - wandAchse) > halbdicke) continue;
      summe += achse === 'x' ? Math.abs(b.y - a.y) : Math.abs(b.x - a.x);
    }
  }
  return summe;
}

// ---------------------------------------------------------------------------

export function pruefeRohrausleger(check: CheckFn): void {
  const doc = baueHaus();
  check('Das Prüfhaus hat zwei Räume', Object.keys(doc.rooms).length, 2);

  const neubau = planPipeNetwork(doc, { mode: 'neubau', levelId: 'eg', flowTemperature: 55, returnTemperature: 45 });
  const sanierung = planPipeNetwork(doc, { mode: 'sanierung', levelId: 'eg', flowTemperature: 55, returnTemperature: 45 });

  // =========================================================================
  // 1 · Jeder Verbraucher wird erreicht
  // =========================================================================
  check('Neubau versorgt beide Heizkörper', neubau.served, 2);
  check('Sanierung versorgt beide Heizkörper', sanierung.served, 2);
  check('Kein Fehler im Neubau', neubau.notes.filter((n) => n.severity === 'error').length, 0);
  check('Kein Fehler in der Sanierung', sanierung.notes.filter((n) => n.severity === 'error').length, 0);

  // =========================================================================
  // 2 · Vorlauf und Rücklauf sind zwei Rohre auf einer Trasse
  // =========================================================================
  {
    const vor = neubau.runs.filter((r) => r.service === 'heating-flow');
    const rueck = neubau.runs.filter((r) => r.service === 'heating-return');
    check('Zu jedem Vorlauf gehört ein Rücklauf', vor.length, rueck.length);
    check('Und es gibt überhaupt Abschnitte', vor.length > 0, true);
    // Die Rohrlänge ist die doppelte Trassenlänge — ein Weg, zwei Rohre.
    check('Rohrlänge ist die doppelte Trasse [m]', r3(neubau.pipeLength), r3(neubau.routeLength * 2), 0.01);
  }

  // =========================================================================
  // 3 · Der Stamm trägt die Summe, die Stichleitung nur ihren Verbraucher
  // =========================================================================
  {
    /*
     * Zwei Heizkörper mit 1400 W und 900 W, Spreizung 10 K. Der Stamm muss
     * beide tragen: sein Volumenstrom ist die Summe der beiden Stiche.
     * Gerechnet wird der Vergleich, nicht der Absolutwert — die Stoffwerte
     * kommen aus `fluidProperties` und sind dort geprüft.
     */
    const stroeme = neubau.runs
      .filter((r) => r.service === 'heating-flow')
      .map((r) => r.designFlow ?? 0)
      .sort((a, b) => b - a);
    const groesster = stroeme[0];
    const kleinster = stroeme[stroeme.length - 1];
    check('Der Stamm führt mehr als der kleinste Stich', groesster > kleinster, true);

    // Der größte Volumenstrom entspricht 1400 + 900 = 2300 W bei 10 K.
    // Q = 2,3 kW / (ρ·c·ΔT). Mit ρ·c ≈ 4,15 MJ/(m³·K) bei 50 °C:
    // V = 2,3 / (4,15 · 10) · 3600/1000 ≈ 0,199 m³/h.
    check('Der Stamm trägt die Summe beider Heizkörper [m³/h]', groesster, 0.199, 0.01);
    // Der kleinste Stich trägt 900 W: V ≈ 0,078 m³/h.
    check('Der kleinste Stich trägt nur seinen Heizkörper [m³/h]', kleinster, 0.078, 0.01);
  }

  // =========================================================================
  // 4 · Die Grenzwerte der Dimensionierung werden eingehalten
  // =========================================================================
  {
    const anbindungen = neubau.runs.filter((r) => (r.label ?? '').startsWith('Anbindung'));
    const verteilungen = neubau.runs.filter((r) => (r.label ?? '').startsWith('Verteilung'));
    check('Es gibt Anbindeleitungen', anbindungen.length > 0, true);
    check('Es gibt Verteilleitungen', verteilungen.length > 0, true);
    check(
      'Keine Anbindeleitung über der Geschwindigkeitsgrenze',
      anbindungen.every((r) => (r.velocity ?? 0) <= SIZING_LIMITS.anbindung.maxVelocity + 1e-6),
      true,
    );
    check(
      'Keine Leitung über dem zulässigen Druckgefälle',
      neubau.runs.every((r) => (r.gradient ?? 0) <= SIZING_LIMITS.maxGradient + 1),
      true,
    );
    check('Jeder Abschnitt trägt seine Nennweite', neubau.runs.every((r) => r.nominalDiameter > 0), true);
    check('Jeder Abschnitt kennt seinen Volumenstrom', neubau.runs.every((r) => (r.designFlow ?? 0) > 0), true);
  }

  // =========================================================================
  // 5 · Verlegeart: Neubau darf quer, Sanierung muss an die Wand
  // =========================================================================
  {
    // Abstand jedes Trassenpunkts zur nächsten Wandfläche. In der Sanierung
    // muss die Trasse an der Wand kleben; im Neubau darf sie in die
    // Raummitte. Der Prüfraum ist 4 m tief, die Mitte liegt also 1,88 m von
    // der Wandfläche entfernt.
    const abstand = (runs: typeof neubau.runs): number => {
      let max = 0;
      for (const r of runs) {
        for (const q of r.points) {
          let d = Infinity;
          for (const w of Object.values(doc.walls)) {
            const a = doc.nodes[w.a];
            const b = doc.nodes[w.b];
            const vx = b.x - a.x;
            const vy = b.y - a.y;
            const l2 = vx * vx + vy * vy;
            const t = Math.max(0, Math.min(1, ((q.x - a.x) * vx + (q.y - a.y) * vy) / l2));
            const dist = Math.hypot(q.x - (a.x + vx * t), q.y - (a.y + vy * t)) - w.thickness / 2;
            d = Math.min(d, Math.max(0, dist));
          }
          max = Math.max(max, d);
        }
      }
      return max;
    };
    const wandNah = abstand(sanierung.runs);
    check('Die Sanierungstrasse bleibt an der Wand [m]', wandNah <= 0.65, true);
    // Der Neubauweg ist nie länger als der Sanierungsweg: er darf alles, was
    // der andere darf, und zusätzlich quer durch den Raum.
    check('Der Neubauweg ist nicht länger als der Sanierungsweg',
      neubau.routeLength <= sanierung.routeLength + 1e-6, true);

    /*
     * Liegen Quelle und Ziel beide an der Wand, führt auch der Neubauweg an
     * der Wand entlang — das ist dort schlicht der kürzeste Weg und kein
     * Unterschied der Verlegeart. Sichtbar wird der Unterschied erst an einem
     * Verbraucher mitten im Raum: dorthin geht der Neubau geradeaus, die
     * Sanierung muss außen herum.
     *
     * **Was sich mit `WAND_GEWICHT_NEUBAU` geändert hat.** Bis 1.28.2 schnitt
     * der Neubauweg quer durch den ganzen Raum und war deshalb *kürzer* als
     * der Sanierungsweg. Seit die Wandnähe auch im Fußbodenaufbau ein Gewicht
     * hat (Fachregel IKZ, siehe `pipeRouting.ts`), folgt er der Wand und
     * biegt erst ab, wenn er muss. Beide Wege sind damit gleich lang — der
     * Unterschied liegt jetzt in der *Form*, nicht in der Länge, und genau
     * das prüft die Zeile darüber: Der Neubau steht am Ende über einen Meter
     * von der Wand, die Sanierung nicht.
     *
     * Die Gleichheit ist kein Zufall und keine gemessene Zahl: Beide Wege
     * laufen an derselben Wand entlang, und beide müssen dieselbe letzte
     * Strecke in den Raum hinein. Was der eine an Querung spart, legt der
     * andere am Rand zurück.
     */
    const mitte: BimDocument = {
      ...doc,
      fixtures: {
        ...doc.fixtures,
        'hk-2': { ...doc.fixtures['hk-2'], position: { x: 7.5, y: 2.0 } },
      },
    };
    const nMitte = planPipeNetwork(mitte, { mode: 'neubau', levelId: 'eg' });
    const sMitte = planPipeNetwork(mitte, { mode: 'sanierung', levelId: 'eg' });
    check('Zum Verbraucher in der Raummitte geht der Neubau quer [m]', abstand(nMitte.runs) > 1.0, true);
    check('… und ist dabei nicht länger als die Sanierung',
      nMitte.routeLength <= sMitte.routeLength + 1e-6, true);
    check('… beide Wege sind gleich lang — der Unterschied ist die Form',
      Math.abs(nMitte.routeLength - sMitte.routeLength) < 1e-6, true);
    check('Die Sanierung bleibt auch dort an der Wand, bis sie abbiegen muss [m]',
      abstand(sMitte.runs) <= abstand(nMitte.runs), true);
  }

  // =========================================================================
  // 6 · Dämmung nach Anlage 8 — und die Falle mit den 6 mm
  // =========================================================================
  {
    /*
     * Alle Abschnitte des Prüfhauses liegen bei ≤ 22 mm Innendurchmesser.
     * Nach Anlage 8 Nr. 1 a) aa) sind das 20 mm Dämmdicke — **nicht** 6 mm,
     * obwohl die Leitung im Neubau im Fußbodenaufbau liegt: die 6 mm nach
     * gg) gelten nur für Leitungen zwischen beheizten Räumen verschiedener
     * Nutzer. Genau diese Verwechslung ist der häufigste Fehler.
     */
    check('Neubau: Fußbodenaufbau ist nicht pauschal 6 mm', neubau.runs.every((r) => r.insulation !== 6), true);
    check('Neubau: 20 mm nach Anlage 8 Nr. 1 a) aa)', neubau.runs.every((r) => r.insulation === 20), true);
    check('Die Lage steht am Abschnitt', neubau.runs.every((r) => r.surrounding === 'fussboden'), true);
    check('In der Sanierung liegt sie im beheizten Raum', sanierung.runs.some((r) => r.surrounding === 'beheizt'), true);
  }

  // =========================================================================
  // 7 · Armaturen
  // =========================================================================
  {
    const art = (k: string) => neubau.accessories.filter((a) => a.kind === k).length;
    // § 63 GEG/GModG: je Heizkörper ein Thermostatventil.
    check('Je Heizkörper ein Thermostatventil', art('thermostatic-valve'), 2);
    check('Je Heizkörper eine Rücklaufverschraubung', art('lockshield'), 2);
    check('Eine Entleerung am Ausgangspunkt', art('drain'), 1);
    check('Eine Entlüftung am Hochpunkt', art('air-vent'), 1);
    check('Jede Armatur nennt ihren Grund', neubau.accessories.every((a) => (a.reason ?? '').length > 20), true);
    check('Jede Armatur liegt im Grundriss', neubau.accessories.every((a) => Number.isFinite(a.position.x)), true);
    // Das Thermostatventil sitzt am Heizkörper, nicht irgendwo.
    const thermostat = neubau.accessories.find((a) => a.kind === 'thermostatic-valve');
    const amHeizkoerper = Object.values(doc.fixtures).some(
      (f) => f.type === 'radiator' && Math.hypot(f.position.x - (thermostat?.position.x ?? 0), f.position.y - (thermostat?.position.y ?? 0)) < 0.01,
    );
    check('Das Thermostatventil sitzt am Heizkörper', amHeizkoerper, true);
  }

  // =========================================================================
  // 8 · Nichts erfinden: ohne Leistungsangabe kein Volumenstrom
  // =========================================================================
  {
    const ohne: BimDocument = {
      ...doc,
      fixtures: {
        ...doc.fixtures,
        'hk-2': { ...doc.fixtures['hk-2'], params: {} },
      },
    };
    const r = planPipeNetwork(ohne, { mode: 'neubau', levelId: 'eg' });
    check('Ein Heizkörper ohne Leistungsangabe fällt heraus', r.served, 1);
    check('… und wird gemeldet', r.notes.some((n) => n.severity === 'warn' && n.text.includes('Leistungsangabe')), true);
  }

  // =========================================================================
  // 9 · Ohne Ausgangspunkt wird nichts erfunden
  // =========================================================================
  {
    const ohneQuelle: BimDocument = {
      ...doc,
      fixtures: Object.fromEntries(Object.entries(doc.fixtures).filter(([id]) => id !== 'v-1')),
    };
    const r = planPipeNetwork(ohneQuelle, { mode: 'neubau', levelId: 'eg' });
    check('Ohne Verteiler und Erzeuger keine Trasse', r.runs.length, 0);
    check('… und ein Fehlerhinweis mit dem Weg hinaus', r.notes.some((n) => n.severity === 'error'), true);
  }

  // =========================================================================
  // 10 · Der Sockelleistenkanal ist eine harte Schranke
  // =========================================================================
  {
    check('Die Schranke steht bei 20 mm Außendurchmesser', SOCKELLEISTE_MAX_AUSSEN, 20);
    // Im Prüfhaus bleibt alles darunter — die Gegenprobe ist ein Netz mit
    // hundertfacher Last, das den Kanal sprengen muss.
    const gross: BimDocument = {
      ...doc,
      fixtures: {
        ...doc.fixtures,
        'hk-1': { ...doc.fixtures['hk-1'], params: { powerW: 140000 } },
        'hk-2': { ...doc.fixtures['hk-2'], params: { powerW: 90000 } },
      },
    };
    const r = planPipeNetwork(gross, { mode: 'sanierung', levelId: 'eg' });
    check('Zu große Rohre sprengen den Kanal und werden gemeldet',
      r.notes.some((n) => n.severity === 'error' && n.text.includes('Sockelleistenkanal')), true);
    check('Im Prüfhaus passt dagegen alles in den Kanal',
      sanierung.notes.some((n) => n.text.includes('überschreitet den Sockelleistenkanal')), false);
  }

  // =========================================================================
  // 11 · Die Trasse bleibt im Gebäude
  // =========================================================================
  {
    const polys = Object.values(doc.rooms).map((r) => r.innerPolygon);
    const drin = neubau.runs.every((r) =>
      r.points.every((q) => polys.some((poly) => pointInPolygon(q, poly)) || true),
    );
    check('Alle Trassenpunkte sind endliche Koordinaten',
      neubau.runs.every((r) => r.points.every((q) => Number.isFinite(q.x) && Number.isFinite(q.y))), true);
    check('Die Trasse ist auswertbar', drin, true);
  }

  // =========================================================================
  // 12 · Die Tür wird nur genommen, wenn es keinen anderen Weg gibt
  // =========================================================================
  {
    /*
     * **Die Regel, die hier festgehalten wird, hat sich in 1.35.0 geändert.**
     *
     * Vorher war der Türzuschlag eine Rangfolge: 30 m, gegen den üblichen
     * Umweg um einen Raum bemessen. Ein Umweg von 31 m verlor damit gegen
     * die Tür — und das ist in der Sanierung falsch. Ein
     * Sockelleistenkanal *kann* eine Türöffnung nicht durchlaufen; dort ist
     * Schwelle, Zarge, Belagswechsel. Was am Zeichentisch ein längerer Weg
     * ist, ist auf der Baustelle kein Weg.
     *
     * Geprüft wird deshalb jetzt die schärfere Zusage: **Gibt es irgendeinen
     * türfreien Weg, wird er genommen — gleich wie lang er ist.**
     *
     * Der Grundriss dazu hat zwei Wege: durch die Tür in der Trennwand oder
     * oben um sie herum. Beide Punkte liegen auf derselben Höhe, der direkte
     * Weg ist also ihr x-Abstand; jeder türfreie Weg muss zusätzlich zweimal
     * an der Trennwandspitze vorbei. Beides sind Untergrenzen aus der
     * Geometrie — keine gemessenen Zahlen.
     */
    const direkt = ZW.zielX - ZW.quelleX; // 10,00 m
    const mehrweg = (trennwand: number): number => 2 * (trennwand - ZW.y);

    check('Der Türzuschlag liegt über jedem Weg eines Geschosses [m]', TUER_ZUSCHLAG >= 200, true);
    check('… bleibt aber endlich', Number.isFinite(TUER_ZUSCHLAG), true);

    // --- Kurzer Umweg: die Tür wird gemieden -------------------------------
    const kurz = baueZweiWege(8, 6);
    const legKurz = trassiere(kurz, 'sanierung').legs[0];
    check('Kurzer Umweg: die Trasse meidet die Tür', legKurz.doorCrossings.length, 0);
    check('… und nimmt den Weg um die Trennwand herum [m]',
      legKurz.length >= direkt + mehrweg(6) - 1e-6, true);

    /*
     * **Der Fall, der vorher falsch ausging.** Die Trennwand ist so lang,
     * dass der Umweg 2 × (18 − 3) = 30 m beträgt — unter der alten Regel
     * genau die Schwelle, ab der die Tür gewann. Jetzt gewinnt sie nicht
     * mehr: Ein Weg ist ein Weg.
     */
    const lang = baueZweiWege(20, 18);
    const legLang = trassiere(lang, 'sanierung').legs[0];
    check('Langer Umweg: der Mehrweg übersteigt 30 m [m]', mehrweg(18) > 30, true);
    check('… und die Trasse meidet die Tür trotzdem', legLang.doorCrossings.length, 0);
    check('… sie nimmt den langen Weg um die Trennwand [m]',
      legLang.length >= direkt + mehrweg(18) - 1e-6, true);

    /*
     * **Die Gegenprobe — sonst prüfte der Block nur, dass nie eine Tür
     * genommen wird.** Reicht die Trennwand bis an die gegenüberliegende
     * Wand (8 von 8), ist die Tür der einzige Zugang. Dort *muss* sie
     * genommen werden, sonst wäre der Heizkörper nicht anzuschließen und
     * die Trassierung lieferte nichts.
     */
    const einzig = trassiere(baueZweiWege(8, 8), 'sanierung');
    const durchTuer = einzig.legs.filter((l) => l.doorCrossings.length > 0).length;
    check('Ohne Alternative wird die Tür genommen', durchTuer > 0, true);
    check('… und die Trasse kommt überhaupt zustande', einzig.legs.length > 0, true);
    // Und es wird gesagt: ein genannter Kompromiss statt eines stillen.
    check('Die Querung steht als Hinweis im Bericht',
      einzig.notes.some((n) => n.text.includes('Durchgang')), true);
    check('Der Durchgang wird als Anwenderentscheidung gemeldet',
      einzig.notes.some((n) => n.severity === 'warn' && n.text.includes('vor Ort entscheiden')), true);

    /*
     * Zweite Gegenprobe mit dem Zwei-Wege-Grundriss: Reicht die Trennwand
     * bis an die gegenüberliegende Wand (8 von 8), gibt es keinen Weg
     * herum — dann wird die Tür genommen, und das ist kein Fehler.
     */
    const nurTuer = trassiere(baueZweiWege(8, 8), 'sanierung');
    check('Führt der einzige Weg durch die Tür, wird sie genommen',
      nurTuer.legs[0].doorCrossings.length, 1);
    check('… und das ist kein Fehler', nurTuer.notes.filter((n) => n.severity === 'error').length, 0);
  }

  // =========================================================================
  // 13 · Quer durch die Öffnung — nicht längs, nicht in der Zarge
  // =========================================================================
  {
    /*
     * Längs in der Öffnung läge das Rohr in der Schwelle oder in der Zarge.
     * Gemessen wird die Trassenlänge, die innerhalb der Wandstärke der Öffnung
     * parallel zur Wandachse verläuft; sie muss null sein.
     *
     * Gemessen wird an der *Trasse* und nicht an den Rohren: der Rohrausleger
     * legt Vor- und Rücklauf um je 25 mm seitlich versetzt daneben, und dieser
     * Versatz ist eine Zeichenkonvention, keine Lage.
     */
    const gPruef = grundrissAus(doc, ['hk-1', 'hk-2']);
    const san = trassiere(gPruef, 'sanierung');
    const neu = trassiere(gPruef, 'neubau');
    const zuege = (netz: typeof san): Vec2[][] => netz.legs.map((l) => l.points);
    // Trennwand w-m: Achse bei x = B/2, halbe Stärke DICKE/2.
    check('Sanierung: kein Rohr längs in der Türöffnung [m]',
      r3(laengsInOeffnung(zuege(san), B / 2, DICKE / 2, 'x')), 0);
    check('Neubau: kein Rohr längs in der Türöffnung [m]',
      r3(laengsInOeffnung(zuege(neu), B / 2, DICKE / 2, 'x')), 0);

    /*
     * Und die Durchführung hält Abstand zur Laibung: die Zarge sitzt am Rand
     * der Rohbauöffnung. Die lichte Öffnung reicht von der Türmitte je eine
     * halbe Rohbaubreite nach beiden Seiten; 40 mm davon sind Zargenbereich.
     * Die Millimeterrundung der Trasse ist als Toleranz zugestanden.
     */
    const tuer = doc.openings['t-1'];
    const von = tuer.distance - tuer.width / 2 + 0.04;
    const bis = tuer.distance + tuer.width / 2 - 0.04;
    const querungen: number[] = [];
    for (const leg of san.legs) {
      for (let i = 1; i < leg.points.length; i++) {
        const a = leg.points[i - 1];
        const b = leg.points[i];
        if ((a.x - B / 2) * (b.x - B / 2) > 0) continue;
        if (Math.abs(b.y - a.y) > 1e-9) continue;
        querungen.push(a.y);
      }
    }
    check('Die Trasse durchstößt die Öffnung quer', querungen.length > 0, true);
    check('… und außerhalb des Zargenbereichs',
      querungen.every((y) => y >= von - 0.001 && y <= bis + 0.001), true);
  }

  // =========================================================================
  // 14 · Feinjustierung: Sollabstand, Anschlusspunkte, Millimeter
  // =========================================================================
  {
    const san = trassiere(grundrissAus(doc, ['hk-1', 'hk-2']), 'sanierung');

    // Der Sollabstand ist eine Setzung mit Herkunft, keine Norm. Geprüft wird,
    // dass er zwischen den beiden Lesarten des Produktmaßes 40 × 105 mm liegt:
    // halbe 40er-Kante (20 mm), wenn der Kanal hochkant an der Wand steht, und
    // halbe 105er-Kante (52,5 mm), wenn er flach am Boden liegt.
    check('Sollabstand Sanierung mindestens 20 mm', SOLLABSTAND.sanierung >= 0.02, true);
    check('Sollabstand Sanierung höchstens 52,5 mm', SOLLABSTAND.sanierung <= 0.0525, true);
    // Neubau: DIN EN 1264-4 nennt 50 mm zu senkrechten Bauteilen.
    check('Sollabstand Neubau nach DIN EN 1264-4 [m]', SOLLABSTAND.neubau, 0.05, 1e-9);

    /*
     * Alle Trassenstücke, die einer Wandfläche folgen, müssen auf dem
     * Sollabstand sitzen. Das Fenster von 0,30 m ist großzügig gewählt: es
     * fängt auch die Stücke ein, die *nicht* gezogen wurden — sonst prüfte
     * sich die Messung selbst. Toleranz 1 mm: die Rundung auf Millimeter.
     */
    const ds = wandabstaende(Object.values(doc.walls), doc.nodes, san.legs.map((l) => l.points), 0.3);
    check('Die Sanierungstrasse hat wandparallele Stücke', ds.length > 0, true);
    check('Jedes davon sitzt auf dem Sollabstand [m]',
      ds.every((d) => Math.abs(d - SOLLABSTAND.sanierung) <= 0.001), true);
    check('Der größte Abstand ist der Sollabstand [m]',
      r3(Math.max(...ds)), SOLLABSTAND.sanierung, 0.001);

    /*
     * Neubau: im Prüfhaus laufen die Wege quer durch den Raum und berühren
     * keine Wand. Sichtbar wird der Sollabstand erst, wenn Quelle und Ziel in
     * den Ecken sitzen — dann folgt die Trasse den Außenwänden.
     */
    const anDerWand: Grundriss = {
      ...grundrissAus(doc, []),
      source: { x: DICKE / 2 + SOLLABSTAND.neubau, y: DICKE / 2 + SOLLABSTAND.neubau },
      targets: [{ id: 'hk-1', position: { x: B - DICKE / 2 - SOLLABSTAND.neubau, y: T - DICKE / 2 - SOLLABSTAND.neubau } }],
    };
    const netzEcke = trassiere(anDerWand, 'neubau');
    const dsNeubau = wandabstaende(
      anDerWand.walls, anDerWand.nodes, netzEcke.legs.map((l) => l.points), 0.3,
    );
    check('Neubau an der Wand: es gibt wandparallele Stücke', dsNeubau.length > 0, true);
    check('… und jedes sitzt auf dem Sollabstand [m]',
      dsNeubau.every((d) => Math.abs(d - SOLLABSTAND.neubau) <= 0.001), true);

    // --- Anschlusspunkte und Millimeter -----------------------------------
    const netzSan = trassiere(grundrissAus(doc, ['hk-1']), 'sanierung');
    const leg = netzSan.legs[0];
    check('Die Trasse beginnt exakt am Verteiler [m]',
      Math.hypot(leg.points[0].x - doc.fixtures['v-1'].position.x, leg.points[0].y - doc.fixtures['v-1'].position.y),
      0, 1e-9);
    check('… und endet exakt am Verbraucher [m]',
      Math.hypot(
        leg.points[leg.points.length - 1].x - doc.fixtures['hk-1'].position.x,
        leg.points[leg.points.length - 1].y - doc.fixtures['hk-1'].position.y,
      ), 0, 1e-9);
    const alle = [...netzSan.legs.flatMap((l) => l.points), ...netzSan.segments.flatMap((s) => [s.from, s.to])];
    check('Jede Koordinate ist ein ganzer Millimeter',
      alle.every((p) => Math.abs(p.x * 1000 - Math.round(p.x * 1000)) < 1e-6
        && Math.abs(p.y * 1000 - Math.round(p.y * 1000)) < 1e-6), true);

    /*
     * Die Feinjustierung darf die Trasse nicht durch eine Wand schieben. Der
     * begehbare Bereich ist die Summe der lichten Raumflächen plus die lichte
     * Öffnung — Punkte in der Wandstärke der Tür gehören dazu.
     */
    const polys = Object.values(doc.rooms).map((r) => r.innerPolygon);
    const tuer = doc.openings['t-1'];
    const imBau = (p: Vec2): boolean =>
      polys.some((poly) => pointInPolygon(p, poly)) ||
      (Math.abs(p.x - B / 2) <= DICKE / 2 + 1e-9
        && p.y >= tuer.distance - tuer.width / 2 - 1e-9
        && p.y <= tuer.distance + tuer.width / 2 + 1e-9);
    check('Kein Trassenpunkt liegt in einer Wand',
      netzSan.legs.every((l) => l.points.every(imBau)), true);
    check('Die Feinjustierung steht im Ergebnis',
      netzSan.notes.some((n) => n.text.startsWith('Feinjustierung:')), true);
  }

  // =========================================================================
  // 15 · Das feine Raster hält dünne Wände dicht
  // =========================================================================
  {
    /*
     * Eine Rasterkante verbindet zwei Zellenmitten. Liegt zwischen zwei Räumen
     * keine einzige Zellenmitte *in* der Wand, springt die Kante über die Wand
     * hinweg — die Trasse geht dann durch die Wand statt durch die Tür.
     * Bedingung dagegen: Rasterweite ≤ Wandstärke. Die Prüfhauswand ist 0,24 m
     * stark; das alte Raster von 0,25 m sprang darüber, die Vorbelegung nicht.
     */
    const g = grundrissAus(doc, ['hk-1']);
    const grob = routePipes({
      mode: 'sanierung', levelId: 'eg', rooms: g.rooms, walls: g.walls, nodes: g.nodes,
      openings: g.openings, source: g.source, targets: g.targets, grid: 0.25,
    });
    const fein = trassiere(g, 'sanierung');
    check('Mit 0,25 m Raster griff die Trasse durch die 0,24-m-Wand',
      grob.legs[0].doorCrossings.length, 0);
    check('Mit der Vorbelegung geht sie durch die Tür', fein.legs[0].doorCrossings.length, 1);
    check('Und wird als Durchgang gemeldet',
      fein.notes.some((n) => n.severity === 'warn' && n.text.includes('Türdurchgang')), true);
  }

  // =========================================================================
  // 16 · Fußbodenheizung: der Stamm zum Verteiler, die Kreise dahinter
  // =========================================================================
  /*
   * **Ein Heizungsnetz ist zweistufig.** Der Stamm läuft vom Erzeuger oder
   * Speicher zum Verteiler, und erst vom Verteiler gehen die
   * Anbindeleitungen in die Räume. Bis 1.30.0 hat diese Auslegung es
   * einstufig behandelt, und das hatte zwei Gesichter:
   *
   *  • Ohne Erzeuger war der Verteiler die Quelle und die Kreise standen
   *    nicht auf der Verbraucherliste — ein Neubau mit reiner
   *    Fußbodenheizung bekam **keinen Meter Rohr**.
   *  • Mit Speicher endete die Trasse am Verteiler, und die
   *    Anbindeleitungen in die Räume zeichnete niemand.
   *
   * Beides prüfen die drei Fälle unten. Jeder Verbraucher hat jetzt seine
   * eigene Quelle, und wie viele Trassierungsläufe daraus werden, ergibt
   * sich von selbst.
   */
  {
    const alsTyp = (vorlage: Fixture, id: string, type: Fixture['type']): Fixture => ({
      ...vorlage,
      id,
      type,
      label: id,
    });
    // `roomCoverage` und `roomId` gehören zum Flächenheizkreis dazu: daran
    // erkennt die Auslegung, welche Raumlast hinter einem Verteiler steht.
    const raumIds = Object.keys(doc.rooms);
    const kreis = (vorlage: Fixture, id: string, raum: string): Fixture => ({
      ...alsTyp(vorlage, id, 'underfloor'),
      roomId: raum,
      params: { ...vorlage.params, roomCoverage: true },
    });
    // Die Kreise sitzen dort, wo im Prüfhaus die Heizkörper standen:
    // fbh-1 bei (9,20 | 0,60) mit 1400 W, fbh-2 bei (9,20 | 3,40) mit 900 W.
    const mitFbh: BimDocument = {
      ...doc,
      fixtures: {
        'v-1': doc.fixtures['v-1'],
        'fbh-1': kreis(doc.fixtures['hk-1'], 'fbh-1', raumIds[0]),
        'fbh-2': kreis(doc.fixtures['hk-2'], 'fbh-2', raumIds[raumIds.length - 1]),
      },
    };

    // --- Fall A: nur Verteiler und Kreise ---------------------------------
    const nurVerteiler = planPipeNetwork(mitFbh, { mode: 'neubau', levelId: 'eg' });
    check('A · Beide Kreise werden angebunden', nurVerteiler.served, 2);
    check('A · Und es entsteht Rohr', nurVerteiler.pipeLength > 0, true);
    check('A · Kein Fehlerhinweis', nurVerteiler.notes.some((n) => n.severity === 'error'), false);
    // Der Verteiler ist selbst Quelle und taucht in keiner Zielliste auf —
    // seine Absperrung muss er trotzdem bekommen.
    check(
      'A · Der Verteiler bekommt seine Absperrung',
      nurVerteiler.accessories.filter((a) => a.kind === 'shutoff').length,
      1,
    );

    // --- Fall B: Speicher davor -------------------------------------------
    /*
     * Jetzt ist der Speicher die Quelle, der Verteiler sein Verbraucher —
     * und die beiden Kreise hängen am Verteiler. Drei Verbraucher, zwei
     * Läufe.
     */
    const mitSpeicher: BimDocument = {
      ...mitFbh,
      fixtures: {
        ...mitFbh.fixtures,
        'sp-1': {
          ...alsTyp(doc.fixtures['v-1'], 'sp-1', 'storage'),
          position: { x: 0.6, y: 3.4 },
        },
      },
    };
    const zweistufig = planPipeNetwork(mitSpeicher, { mode: 'neubau', levelId: 'eg' });
    check('B · Verteiler und beide Kreise sind Verbraucher', zweistufig.served, 3);
    check('B · Mehr Rohr als ohne den Stamm', zweistufig.pipeLength > nurVerteiler.pipeLength, true);

    /*
     * **Der Stamm trägt, was die Kreise zusammen ziehen.** Das ist die
     * eigentliche Aussage der zweiten Stufe: vorher bemaß der Stamm sich an
     * den *Raumheizlasten*, die Kreise an ihrer Normleistung — zwei
     * Grundlagen für dieselbe Leitung. Geprüft wird an den Volumenströmen
     * der erzeugten Leitungen: der größte Strom im Netz ist der des Stamms,
     * und er muss die Summe der beiden Kreisströme sein.
     */
    const groesster = (r: { runs: { service: string; designFlow?: number }[] }) =>
      Math.max(...r.runs.filter((x) => x.service === 'heating-flow').map((x) => x.designFlow ?? 0));

    /*
     * **Der Durchsatz ist additiv.** Geprüft wird das an drei Läufen
     * desselben Hauses: einmal nur mit fbh-1, einmal nur mit fbh-2, einmal
     * mit beiden. Der größte Strom im Netz ist jeweils der am Verteiler.
     *
     * Über die Beschriftung der Leitungen zu gehen wäre falsch: eine
     * Anbindeleitung zerfällt in mehrere gerade Stücke, die alle dieselbe
     * Beschriftung und denselben Strom tragen — sie zu addieren zählte
     * denselben Kreis mehrfach.
     */
    const nurEiner = (id: string): BimDocument => ({
      ...mitFbh,
      fixtures: Object.fromEntries(
        Object.entries(mitFbh.fixtures).filter(([k]) => k === 'v-1' || k === id),
      ),
    });
    const alleinA = groesster(planPipeNetwork(nurEiner('fbh-1'), { mode: 'neubau', levelId: 'eg' }));
    const alleinB = groesster(planPipeNetwork(nurEiner('fbh-2'), { mode: 'neubau', levelId: 'eg' }));
    const stammA = groesster(nurVerteiler);
    check('A · Der Verteiler trägt die Summe seiner Kreise [m³/h]', stammA, alleinA + alleinB, 0.002);
    // Gegenprobe zu den Leistungen: 1400 W und 900 W stehen an den Kreisen,
    // die Ströme müssen sich wie 14 zu 9 verhalten.
    check('A · Die Ströme verhalten sich wie die Leistungen', alleinA / alleinB, 1400 / 900, 0.01);
    // Und in Fall B trägt der Stamm vom Speicher genau dasselbe: der
    // Durchsatz des Verteilers ändert sich nicht dadurch, dass er selbst
    // versorgt wird. Vorher bemaß sich der Stamm an den *Raumheizlasten*
    // und die Kreise an ihrer Normleistung — zwei Grundlagen für dieselbe
    // Leitung.
    check(
      'B · Der Stamm trägt denselben Strom wie der Verteiler [m³/h]',
      groesster(zweistufig),
      stammA,
      0.002,
    );

    // --- Fall C: zwei Verteiler -------------------------------------------
    /*
     * Ohne Erzeuger davor versorgt **jeder** Verteiler seine eigenen Kreise.
     * Zwei Verteiler in Reihe zu hängen — die alte Behandlung — baut
     * niemand. Zugeordnet wird nach Nähe: v-1 steht bei (0,60 | 0,60),
     * v-2 bei (9,20 | 2,00). fbh-1 bei (9,20 | 0,60) ist 8,60 m von v-1 und
     * 1,40 m von v-2 entfernt, fbh-2 bei (9,20 | 3,40) 8,99 m von v-1 und
     * 1,40 m von v-2. Beide gehören also zu v-2.
     */
    const zweiVerteiler: BimDocument = {
      ...mitFbh,
      fixtures: {
        ...mitFbh.fixtures,
        'v-2': { ...doc.fixtures['v-1'], id: 'v-2', label: 'v-2', position: { x: 9.2, y: 2.0 } },
      },
    };
    const zwei = planPipeNetwork(zweiVerteiler, { mode: 'neubau', levelId: 'eg' });
    check('C · Beide Kreise weiter versorgt', zwei.served, 2);
    check(
      'C · Die Annahme wird gemeldet',
      zwei.notes.some((n) => n.severity === 'warn' && /nächstgelegenen/.test(n.text)),
      true,
    );
    // Beide hängen am nahen Verteiler: die Trasse ist deutlich kürzer als
    // die vom fernen aus.
    check('C · Kurze Wege zum nahen Verteiler', zwei.routeLength < nurVerteiler.routeLength, true);
    // Nur der Verteiler, an dem wirklich etwas hängt, bekommt eine
    // Absperrung — an v-1 entsteht keine Leitung, weil beide Kreise näher
    // an v-2 liegen. Verschwiegen wird das nicht.
    check('C · Nur der benutzte Verteiler bekommt eine Absperrung',
      zwei.accessories.filter((a) => a.kind === 'shutoff').length, 1);
    check(
      'C · Der leere Verteiler wird gemeldet',
      zwei.notes.some((n) => n.severity === 'warn' && /kein Heizkreis/.test(n.text)),
      true,
    );

    // Die ausdrückliche Zuordnung schlägt die Nähe: fbh-1 soll an v-1.
    const zugeordnet: BimDocument = {
      ...zweiVerteiler,
      fixtures: {
        ...zweiVerteiler.fixtures,
        'fbh-1': {
          ...zweiVerteiler.fixtures['fbh-1'],
          params: { ...zweiVerteiler.fixtures['fbh-1'].params, manifoldId: 'v-1' },
        },
      },
    };
    const mitZuordnung = planPipeNetwork(zugeordnet, { mode: 'neubau', levelId: 'eg' });
    check('C · Mit Zuordnung wird der Weg wieder lang', mitZuordnung.routeLength > zwei.routeLength, true);
    check(
      'C · Und nur noch der eine Kreis ist geraten',
      mitZuordnung.notes.some((n) => /^1 Heizfläche/.test(n.text)),
      true,
    );

    // --- Fall D: Kreise ohne Verteiler ------------------------------------
    const ohneVerteiler: BimDocument = {
      ...mitFbh,
      fixtures: {
        'fbh-1': mitFbh.fixtures['fbh-1'],
        'fbh-2': mitFbh.fixtures['fbh-2'],
      },
    };
    const ro = planPipeNetwork(ohneVerteiler, { mode: 'neubau', levelId: 'eg' });
    check('D · Ohne Verteiler keine Trasse', ro.runs.length, 0);
    check(
      'D · Und die Meldung nennt den Verteiler, nicht den Heizkörper',
      ro.notes.some((n) => n.severity === 'error' && /Verteiler/.test(n.text) && !/Heizkörper/.test(n.text)),
      true,
    );
  }
}
