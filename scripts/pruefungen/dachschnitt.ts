/**
 * Prüfblock: Polygonschnitt unter der Dachfläche (Auftrag A2, 1.70.0).
 * ---------------------------------------------------------------------------
 *
 * **Die Forderung.** Wandoberkanten exakt auf der Dachfläche (Polygonschnitt,
 * keine Abtastung), nichts ragt über die Dachhaut; größter Abstand Wandkrone
 * ↔ Dachfläche unter 1 mm.
 *
 * **Wie gemessen wird.** Gebaut wird ohne Raster (`lib/dachschnitt.ts`).
 * Gemessen wird dagegen sehr wohl an einem Raster — das ist die Prüfung,
 * nicht der Bau: Über den ganzen Fußabdruck jeder Wand, längs alle 2 cm und
 * quer an fünf Stellen (Außenfläche, Viertel, Achse, Viertel, Innenfläche),
 * wird die Höhe der gebauten Oberseite mit der Dachfläche verglichen. Ein
 * erster Entwurf dieser Fassung maß nur auf den beiden Wandflächen und hat
 * damit einen Fehler übersehen, den erst der Blick quer über die Wanddicke
 * zeigte: Auf der Achse einer Traufwand knickt die Dachfläche.
 *
 * **Die Gegenprobe.** Dieselbe Messung am alten Verfahren (8-cm-Scheiben,
 * Dachhöhe der Scheibenmitte auf der Wandachse) muss durchfallen.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CheckFn } from './typ';
import type { BimNode, Level, RoofDefinition, RoofKind, Room, Vec2, Wall } from '../../src/types/bim';
import { DACH_VORGABE } from '../../src/types/bim';
import { importBuildingModel } from '../../src/lib/buildingModelImport';
import { detectRooms } from '../../src/lib/roomDetection';
import { baueDachlandschaft, frameAn, frameUeberWand } from '../../src/lib/dachlandschaft';
import { scanDachZuordnen } from '../../src/lib/scanUebernahme';
import { buildRoofFrame, roofHeightAt, type RoofFrame } from '../../src/lib/roofGeometry';
import { getWallGeometry, wallLocalToWorld, type WallGeometry } from '../../src/lib/wallGeometry';
import { dachhaut, hoeheAufEbene, knickgeraden, ohrenschnitt, wandUnterDach, type EbenesStueck } from '../../src/lib/dachschnitt';
import { pointInPolygon } from '../../src/lib/geometry';

const MM = 0.001;

/** Die Oberseite einer Wand an einem Messraster mit der Dachfläche vergleichen. */
function messe(
  g: WallGeometry,
  oben: (p: Vec2) => number | undefined,
  zStart: number,
  zEnd: number,
  frame: RoofFrame,
): { groesster: number; kleinster: number; punkte: number } {
  let groesster = 0;
  let kleinster = Infinity;
  let punkte = 0;
  const n = Math.max(2, Math.ceil(g.length / 0.02));
  for (let i = 0; i <= n; i++) {
    // Nicht genau auf den Enden und Flächen messen: dort springt die
    // Dachfunktion je nach Seite, und welche Seite „die richtige" ist, ist
    // auf der Kante nicht definiert. 0,1 mm daneben ist sie es.
    const u = Math.min(g.length - 1e-4, Math.max(1e-4, (g.length * i) / n));
    for (const q of [-0.999, -0.5, 0.0003, 0.5, 0.999]) {
      const p = wallLocalToWorld(g, u, q * g.halfThickness);
      const ist = oben(p);
      if (ist === undefined) continue;
      const soll = Math.max(zStart, Math.min(zEnd, roofHeightAt(frame, p)));
      const d = soll - ist;
      groesster = Math.max(groesster, Math.abs(d));
      kleinster = Math.min(kleinster, d);
      punkte++;
    }
  }
  return { groesster, kleinster, punkte };
}

const obenAus = (stuecke: EbenesStueck[]) => (p: Vec2): number | undefined => {
  const s = stuecke.find((x) => pointInPolygon(p, x.ecken));
  return s ? hoeheAufEbene(s.ebene, p) : undefined;
};

/** Das Verfahren bis 1.69.0, als Oberseite — nur für die Gegenprobe. */
function alteOberseite(g: WallGeometry, zStart: number, zEnd: number, frame: RoofFrame) {
  const SLICE = 0.08;
  const n = Math.max(1, Math.ceil(g.length / SLICE));
  return (p: Vec2): number | undefined => {
    const u = (p.x - g.a.x) * g.dir.x + (p.y - g.a.y) * g.dir.y;
    const i = Math.min(n - 1, Math.max(0, Math.floor((u / g.length) * n)));
    const mitte = ((i + 0.5) / n) * g.length;
    return Math.max(zStart, Math.min(zEnd, roofHeightAt(frame, wallLocalToWorld(g, mitte, 0))));
  };
}

export function pruefeDachschnitt(check: CheckFn): void {
  console.log('\n▸ Polygonschnitt unter der Dachfläche — Wandoberseiten und Dachhaut');

  // --- 1. Der Feldscan ------------------------------------------------------
  {
    const roh = JSON.parse(readFileSync(join(process.cwd(), 'scripts', 'referenz', 'scan-wohnung-2026-10-02.json'), 'utf8'));
    const r = importBuildingModel(roh);
    const nodes: Record<string, BimNode> = Object.fromEntries(r.nodes.map((n) => [n.id, n]));
    const levels: Record<string, Level> = {
      'level-0': { id: 'level-0', name: 'EG', order: 0, elevation: 0, height: r.levels[0].height } as Level,
    };
    const erste = detectRooms({ walls: r.walls, nodes, openings: r.openings, levelId: 'level-0', defaultHeight: r.levels[0].height, northAngle: 0 });
    scanDachZuordnen(levels, erste, r);
    const teile = baueDachlandschaft({ level: levels['level-0'], walls: r.walls, nodes, rooms: erste as Room[] });

    let unterDach = 0;
    let messpunkte = 0;
    let groesster = 0;
    let tiefster = Infinity;
    let altTiefster = Infinity;
    let naeherungen = 0;
    for (const w of r.walls) {
      const g = getWallGeometry(w, nodes);
      if (!g) continue;
      const frame = frameUeberWand(teile, g);
      if (!frame) continue;
      unterDach++;
      const k = wandUnterDach(g, 0, g.length, g.halfThickness, 0, w.height, frame, (p) => roofHeightAt(frame, p));
      naeherungen += k.oben.filter((s) => s.naeherung).length;
      const m = messe(g, obenAus(k.oben), 0, w.height, frame);
      messpunkte += m.punkte;
      groesster = Math.max(groesster, m.groesster);
      tiefster = Math.min(tiefster, m.kleinster);
      altTiefster = Math.min(altTiefster, messe(g, alteOberseite(g, 0, w.height, frame), 0, w.height, frame).kleinster);
    }
    console.log(`    ${unterDach} Wände, ${messpunkte} Messpunkte · neu: größter Abstand ${(groesster * 1000).toFixed(4)} mm · alt: durchgestochen bis ${(-altTiefster * 100).toFixed(1)} cm`);
    check('Feldscan · Wände unter dem Dach geprüft (mehr als 30)', unterDach > 30, true);
    {
      // Die Seitenwand des Schlitzes: Achse genau auf dem Umriss. Bis zum Fund
      // galt sie als „ohne Dach" und stand 2,40 m hoch durch die Traufe.
      const w = r.walls.find((x) => x.id === 'w-003');
      const g = w ? getWallGeometry(w, nodes) : null;
      check('Feldscan · Schlitzwand w-003 hat ein Dach über sich', g ? frameUeberWand(teile, g) !== null : false, true);
      check('Gegenprobe · an der Wandmitte allein findet sich keines', g ? frameAn(teile, { x: (g.a.x + g.b.x) / 2, y: (g.a.y + g.b.y) / 2 }) === null : false, true);
    }
    check('Feldscan · Messpunkte über die ganze Wanddicke (mehr als 10 000)', messpunkte > 10000, true);
    check('Feldscan · größter Abstand Oberseite ↔ Dachfläche < 1 mm', groesster < MM, true);
    check('Feldscan · nirgends über der Dachfläche (≥ −0,001 mm)', tiefster >= -1e-6, true);
    check('Feldscan · beim Satteldach keine Näherungsstücke — alles an Knickgeraden geschnitten', naeherungen, 0);
    check('Gegenprobe · das alte Verfahren sticht mehr als 10 cm durch', -altTiefster > 0.1, true);

    /*
     * Der Schlitz im Umriss (x −3,03 … −2,75, von der Traufe 1,6 m ins Haus):
     * Bis zum Fund rechnete jeder Punkt hinter ihm die Traufe an seinem
     * Boden, und quer über die Dachhälfte lief eine Rinne bis zum Kniestock.
     * Quer zum Schlitz gemessen darf die Dachfläche jetzt nur so viel
     * springen, wie die schiefe Traufe ohnehin hergibt (wenige Millimeter).
     */
    const ueberSchlitz = frameAn(teile, { x: -2.9, y: -3 });
    check('Schlitz · über dem Schlitz liegt das Dach', ueberSchlitz !== null, true);
    if (ueberSchlitz) {
      let sprung = 0;
      for (const y of [-4, -5, -6]) {
        let vorher: number | undefined;
        for (let x = -3.4; x <= -2.4; x += 0.02) {
          const h = roofHeightAt(ueberSchlitz, { x, y });
          if (vorher !== undefined) sprung = Math.max(sprung, Math.abs(h - vorher));
          vorher = h;
        }
      }
      check('Schlitz · quer darüber keine Rinne (Sprung < 1 cm je 2 cm)', sprung < 0.01, true);
    }
  }

  // --- 2. Jede Dachform, schräge und dicke Wände ----------------------------
  const umriss: Vec2[] = [
    { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 8 }, { x: 0, y: 8 },
  ];
  const lUmriss: Vec2[] = [
    { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 4 }, { x: 5, y: 4 }, { x: 5, y: 9 }, { x: 0, y: 9 },
  ];
  const nodes: Record<string, BimNode> = {};
  const knoten = (id: string, x: number, y: number) => (nodes[id] = { id, x, y, levelId: 'l' } as BimNode);
  const linien: [Vec2, Vec2][] = [
    [{ x: 0, y: 0 }, { x: 10, y: 0 }],
    [{ x: 0, y: 0 }, { x: 0, y: 8 }],
    [{ x: 0.3, y: 0.4 }, { x: 9.7, y: 7.6 }],
    [{ x: 2.13, y: 0 }, { x: 2.13, y: 8 }],
    [{ x: 0, y: 3.97 }, { x: 10, y: 4.03 }],
    [{ x: 1, y: 6.5 }, { x: 8.2, y: 1.1 }],
    [{ x: 5, y: 4 }, { x: 10, y: 4 }], // im L: Kante am einspringenden Winkel
  ];
  const walls: Wall[] = linien.map(([a, b], i) => {
    knoten(`a${i}`, a.x, a.y);
    knoten(`b${i}`, b.x, b.y);
    return { id: `w${i}`, levelId: 'l', a: `a${i}`, b: `b${i}`, thickness: i % 2 ? 0.365 : 0.24, height: 6, type: 'interior' } as Wall;
  });
  const faelle: { name: string; roof: Partial<RoofDefinition> & { kind: RoofKind }; umriss: Vec2[]; exakt: boolean }[] = [
    { name: 'Satteldach 38°', roof: { kind: 'gable', pitch: 38 }, umriss, exakt: true },
    { name: 'Satteldach mit Kehlbalkendecke 2,6 m', roof: { kind: 'gable', pitch: 45, collarHeight: 2.6 }, umriss, exakt: true },
    { name: 'Satteldach, First versetzt', roof: { kind: 'gable', pitch: 30, ridgeOffset: 1.2 }, umriss, exakt: true },
    { name: 'Satteldach über L-Umriss', roof: { kind: 'gable', pitch: 35 }, umriss: lUmriss, exakt: true },
    { name: 'Satteldach, schräg zum Grundriss (63°)', roof: { kind: 'gable', pitch: 38, azimuth: 63 }, umriss, exakt: true },
    { name: 'Pultdach 15°', roof: { kind: 'monopitch', pitch: 15 }, umriss, exakt: true },
    { name: 'Krüppelwalmdach', roof: { kind: 'krueppelwalm', pitch: 40, hipRatio: 0.5 }, umriss, exakt: true },
    { name: 'Mansarddach', roof: { kind: 'mansard', pitch: 70, upperPitch: 25, knickHeight: 2.4 }, umriss, exakt: true },
    // Walm über Umriss: Grate aus dem Straight Skeleton, nicht als Geraden bekannt.
    { name: 'Walmdach über Rechteck', roof: { kind: 'hip', pitch: 35 }, umriss, exakt: false },
    { name: 'Walmdach über L-Umriss', roof: { kind: 'hip', pitch: 35 }, umriss: lUmriss, exakt: false },
  ];
  for (const f of faelle) {
    const roof: RoofDefinition = { ...DACH_VORGABE, kneeHeight: 1, ...f.roof };
    const frame = buildRoofFrame(roof, f.umriss, [], f.umriss);
    check(`${f.name} · Gerüst gebaut`, frame !== null, true);
    if (!frame) continue;
    const hoehe = (p: Vec2) => roofHeightAt(frame, p);
    let groesster = 0;
    let tiefster = Infinity;
    let naeherungen = 0;
    for (const w of walls) {
      const g = getWallGeometry(w, nodes)!;
      const k = wandUnterDach(g, 0, g.length, g.halfThickness, 0, w.height, frame, hoehe);
      naeherungen += k.oben.filter((s) => s.naeherung).length;
      const m = messe(g, obenAus(k.oben), 0, w.height, frame);
      groesster = Math.max(groesster, m.groesster);
      tiefster = Math.min(tiefster, m.kleinster);
    }
    check(`${f.name} · Wandoberseiten: größter Abstand < 1 mm`, groesster < MM, true);
    check(`${f.name} · Wandoberseiten: nirgends mehr als 1 mm über der Dachfläche`, tiefster >= -MM, true);
    if (f.exakt) check(`${f.name} · ohne Näherungsstücke`, naeherungen, 0);

    // Die Dachhaut: Zufallspunkte in jedem Dreieck, gegen Dachfläche + 2 cm.
    const haut = dachhaut(frame, frame.umriss.map(() => 0.5), hoehe);
    let hautGroesster = 0;
    let zufall = 12345;
    const rnd = () => ((zufall = (zufall * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (const d of haut) {
      for (let k = 0; k < 6; k++) {
        let a = rnd();
        let b = rnd();
        if (a + b > 1) {
          a = 1 - a;
          b = 1 - b;
        }
        const p = { x: d[0].x + a * (d[1].x - d[0].x) + b * (d[2].x - d[0].x), y: d[0].y + a * (d[1].y - d[0].y) + b * (d[2].y - d[0].y) };
        const z = d[0].z + a * (d[1].z - d[0].z) + b * (d[2].z - d[0].z);
        hautGroesster = Math.max(hautGroesster, Math.abs(z - (hoehe(p) + 0.02)));
      }
    }
    check(`${f.name} · Dachhaut: Dreiecke gebaut`, haut.length > 0, true);
    check(`${f.name} · Dachhaut: größter Abstand zu Dachfläche + 2 cm < 1 mm`, hautGroesster < MM, true);
  }

  // --- 3. Bausteine ---------------------------------------------------------
  {
    // Ohrenschnitt: Fläche bleibt erhalten, L hat vier Dreiecke.
    const fl = (t: Vec2[]) => Math.abs((t[1].x - t[0].x) * (t[2].y - t[0].y) - (t[2].x - t[0].x) * (t[1].y - t[0].y)) / 2;
    const dr = ohrenschnitt(lUmriss);
    // L: 10 × 4 + 5 × 5 = 65 m²
    check('Ohrenschnitt · L-Umriss: Fläche 65 m² erhalten', dr.reduce((s, t) => s + fl(t), 0), 65, 1e-9);
    check('Ohrenschnitt · L-Umriss (6 Ecken) → 4 Dreiecke', dr.length, 4);
  }
  {
    // Satteldach über Rechteck: First + 2 Kniestockkanten + 4 Fallinien + 4 Kanten = 11 Geraden.
    const frame = buildRoofFrame({ ...DACH_VORGABE, kind: 'gable', pitch: 38, kneeHeight: 1 }, umriss, [], umriss)!;
    check('Knickgeraden · Satteldach über Rechteck: 11', knickgeraden(frame).length, 11);
  }
  {
    // Gerades Wandstück unter einer ebenen Fläche: eine Oberseite aus einem Stück.
    const frame = buildRoofFrame({ ...DACH_VORGABE, kind: 'monopitch', pitch: 20, kneeHeight: 1 }, umriss, [], umriss)!;
    const g = getWallGeometry(walls[3], nodes)!; // x = 2,13, längs der Fallrichtung nicht geknickt
    const k = wandUnterDach(g, 0.5, 7.5, g.halfThickness, 0, 6, frame, (p) => roofHeightAt(frame, p));
    check('Pultdach · Wand ganz innen: Oberseite aus einem ebenen Stück', k.oben.length, 1);
  }
  {
    // Sturz über einem Fenster, das über die Traufe reicht: Das Wandstück
    // beginnt (zStart) über der Dachfläche. Dort darf nichts entstehen —
    // bis zum Fund im Feldscan lag hier eine Platte der Dicke null über dem
    // Dach. Satteldach mit First längs y: Am Wandstück x = 0,2 … 1,0 der
    // Wand y = 0 liegt die Dachfläche bei 1,2 … 1,8 m, der Sturz bei 2,2 m.
    const frame = buildRoofFrame({ ...DACH_VORGABE, kind: 'gable', pitch: 38, kneeHeight: 1 }, umriss, [], umriss)!;
    const g = getWallGeometry(walls[0], nodes)!;
    const k = wandUnterDach(g, 0.2, 1.0, g.halfThickness, 2.2, 2.5, frame, (p) => roofHeightAt(frame, p));
    let hoechster = -Infinity;
    for (const f of k.flaechen) for (const q of f.punkte) {
      const d = q.z - roofHeightAt(frame, { x: q.x, y: q.y });
      if (pointInPolygon({ x: q.x, y: q.y }, umriss) && d > hoechster) hoechster = d;
    }
    check('Sturz über der Traufe · innen nichts über der Dachfläche', hoechster <= 1e-6, true);
    check('Sturz über der Traufe · innen kein Stück auf Fußhöhe', k.oben.every((s) => !s.unterFuss), true);
  }
}
