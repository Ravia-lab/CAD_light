/**
 * Prüfblock „Autokorrektur unter Last" (1.76.1).
 * ---------------------------------------------------------------------------
 * Vier echte Grundrisse (RoomPlan-Scan, Feldscan 02.10.2026, RaVia-Beispiel,
 * Referenzhaus) werden je 200-mal gezielt verdorben — Punkte gewackelt, Ecken
 * geöffnet, Wände verdoppelt, Stummel angesetzt, alles zusammen — mit festem
 * Startwert, also bei jedem Lauf gleich. Nach der Korrektur müssen gelten:
 * kein Raum weniger und höchstens 2 % weniger Fläche als im verdorbenen Stand,
 * keine zusätzlichen losen Enden, keine Wand auf fehlendem oder doppeltem
 * Knoten, keine Öffnung, die vorher in der Wand lag und jetzt herausragt,
 * kein Punkt weiter als 30 cm bewegt — und ein zweiter Lauf findet nichts
 * mehr. Dieser Test hat in 1.76.0 drei Fehler gefunden (siehe Handbuch 18,
 * Zeile 1.76.1); er bleibt, damit sie nicht wiederkommen.
 */
import { readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import type { CheckFn } from './typ';
import type { BimNode, Level, Wall } from '../../src/types/bim';
import { planeKorrektur, wendeKorrekturAn, type KorrekturDokument } from '../../src/lib/autokorrektur';
import { detectRooms } from '../../src/lib/roomDetection';
import { importRaumplan } from '../../src/lib/raumplanImport';
import { importBuildingModel } from '../../src/lib/buildingModelImport';
import { buildReferenceDocument } from '../reference';

function wurzel(): string | undefined {
  let pfad = process.cwd();
  for (let i = 0; i < 4; i++) {
    try {
      if (statSync(join(pfad, 'scripts', 'referenz')).isDirectory()) return pfad;
    } catch {
      /* weiter oben */
    }
    const eltern = pfad.slice(0, pfad.lastIndexOf(sep));
    if (!eltern || eltern === pfad) break;
    pfad = eltern;
  }
  return undefined;
}

let seed = 12345;
const zufall = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
let idz = 0;
const neueId = (p: string) => `${p}-b${idz++}`;

function leer(): KorrekturDokument {
  return { nodes: {}, walls: {}, openings: {}, durchbrueche: {}, fixtures: {}, pipes: {}, pipeAccessories: {}, rooms: {}, levels: {} };
}
function ausImport(levels: unknown[], nodes: BimNode[], walls: Wall[], openings: { id: string }[]): KorrekturDokument {
  const d = leer();
  d.levels = Object.fromEntries((levels as Level[]).map((l) => [l.id, ({ ...l, order: (l as Level).order ?? 0 }) as Level]));
  d.nodes = Object.fromEntries(nodes.map((n) => [n.id, n]));
  d.walls = Object.fromEntries(walls.map((w) => [w.id, w]));
  d.openings = Object.fromEntries(openings.map((o) => [o.id, o])) as KorrekturDokument['openings'];
  return d;
}
const klon = (d: KorrekturDokument): KorrekturDokument => JSON.parse(JSON.stringify(d));

function raeume(d: KorrekturDokument) {
  let anzahl = 0, flaeche = 0;
  for (const levelId of new Set(Object.values(d.walls).map((w) => w.levelId))) {
    const r = detectRooms({ walls: Object.values(d.walls), nodes: d.nodes, openings: Object.values(d.openings), levelId, defaultHeight: 2.5, northAngle: 0 });
    anzahl += r.length; flaeche += r.reduce((s, x) => s + x.area, 0);
  }
  return { anzahl, flaeche };
}
function loseEnden(d: KorrekturDokument) {
  // Je Knotenpaar nur eine Wand zählen — eine doppelte Wand ist kein Anschluss.
  const g = new Map<string, number>();
  const paare = new Set<string>();
  for (const w of Object.values(d.walls)) {
    const s = w.a < w.b ? `${w.a}|${w.b}` : `${w.b}|${w.a}`;
    if (paare.has(s)) continue; paare.add(s);
    for (const k of [w.a, w.b]) g.set(k, (g.get(k) ?? 0) + 1);
  }
  return [...g.values()].filter((n) => n === 1).length;
}
function grad(d: KorrekturDokument) {
  const g = new Map<string, number>();
  for (const w of Object.values(d.walls)) for (const k of [w.a, w.b]) g.set(k, (g.get(k) ?? 0) + 1);
  return g;
}

// ------------------------------------------------------------ Verderben
type Art = 'wackeln' | 'ecken-oeffnen' | 'doppelt' | 'stummel' | 'alles';
function verderbe(d: KorrekturDokument, art: Art): string {
  const knoten = Object.values(d.nodes);
  const waende = Object.values(d.walls);
  const notiz: string[] = [];
  if (art === 'wackeln' || art === 'alles') {
    // 30 % der Knoten um bis zu 4 cm verrücken — Topologie bleibt.
    let n = 0;
    for (const k of knoten) if (zufall() < 0.3) {
      const w = zufall() * 2 * Math.PI, r = zufall() * 0.04;
      d.nodes[k.id] = { ...k, x: k.x + r * Math.cos(w), y: k.y + r * Math.sin(w) }; n++;
    }
    notiz.push(`${n} Knoten gewackelt`);
  }
  if (art === 'ecken-oeffnen' || art === 'alles') {
    // An Knoten mit Grad 2 eine der Wände auf einen eigenen Knoten 1–4 cm daneben hängen.
    const g = grad(d); let n = 0;
    for (const k of knoten) {
      if (g.get(k.id) !== 2 || zufall() > 0.25) continue;
      const w = Object.values(d.walls).find((x) => x.a === k.id || x.b === k.id);
      if (!w) continue;
      const winkel = zufall() * 2 * Math.PI, r = 0.01 + zufall() * 0.03;
      const neu: BimNode = { id: neueId('n'), x: k.x + r * Math.cos(winkel), y: k.y + r * Math.sin(winkel), levelId: k.levelId };
      d.nodes[neu.id] = neu;
      d.walls[w.id] = w.a === k.id ? { ...w, a: neu.id } : { ...w, b: neu.id };
      n++;
    }
    notiz.push(`${n} Ecken geöffnet`);
  }
  if (art === 'doppelt' || art === 'alles') {
    let n = 0;
    for (const w of waende) if (zufall() < 0.15) {
      const id = neueId('w'); d.walls[id] = zufall() < 0.5 ? { ...w, id } : { ...w, id, a: w.b, b: w.a }; n++;
    }
    notiz.push(`${n} Wände verdoppelt`);
  }
  if (art === 'stummel' || art === 'alles') {
    let n = 0;
    for (const k of knoten) if (zufall() < 0.1 && d.nodes[k.id]) {
      const winkel = zufall() * 2 * Math.PI, r = 0.01 + zufall() * 0.035;
      const neu: BimNode = { id: neueId('n'), x: k.x + r * Math.cos(winkel), y: k.y + r * Math.sin(winkel), levelId: k.levelId };
      d.nodes[neu.id] = neu;
      const vorlage = Object.values(d.walls).find((x) => x.a === k.id || x.b === k.id);
      if (!vorlage) continue;
      const id = neueId('w'); d.walls[id] = { ...vorlage, id, a: k.id, b: neu.id }; n++;
    }
    notiz.push(`${n} Stummel`);
  }
  return notiz.join(', ');
}

// -------------------------------------------------------------- Prüfen
let fehler = 0, laeufe = 0;
let wiederhergestellt = 0;
const befunde: string[] = [];
function pruefe(name: string, basis: KorrekturDokument, art: Art, runde: number) {
  laeufe++;
  const ausgang = raeume(basis);
  const loseAusgang = loseEnden(basis);
  const d = klon(basis);
  const was = verderbe(d, art);
  const vorKorrektur = raeume(d);
  const loseVor = loseEnden(d);
  const melde = (s: string) => {
    fehler++; befunde.push(`${name} · ${art} #${runde} (${was}): ${s}`);
  };
  const passtVorher = new Set(Object.values(d.openings).filter((o) => {
    const w = d.walls[o.wallId]; if (!w) return false;
    const l = Math.hypot(d.nodes[w.b].x - d.nodes[w.a].x, d.nodes[w.b].y - d.nodes[w.a].y);
    return o.distance - o.width / 2 >= -0.01 && o.distance + o.width / 2 <= l + 0.01;
  }).map((o) => o.id));
  let b;
  try {
    planeKorrektur(d);
    b = wendeKorrekturAn(d, { anschluesse: true, stummel: true, begradigen: true, leitungen: true, kleineRaeume: false, luecken: {} }, neueId);
  } catch (e) { melde('ABSTURZ ' + (e as Error).stack?.split('\n').slice(0, 3).join(' | ')); return; }
  const nach = raeume(d);
  // Die Korrektur darf nichts verschlechtern, gemessen am verdorbenen Stand.
  if (nach.anzahl < vorKorrektur.anzahl) melde(`Räume ${vorKorrektur.anzahl} → ${nach.anzahl}`);
  if (vorKorrektur.flaeche > 0 && (vorKorrektur.flaeche - nach.flaeche) / vorKorrektur.flaeche > 0.02) melde(`Fläche ${vorKorrektur.flaeche.toFixed(2)} → ${nach.flaeche.toFixed(2)}`);
  const lose = loseEnden(d);
  if (lose > loseVor) melde(`lose Enden ${loseVor} → ${lose}`);
  // Und wie oft holt sie den Originalstand zurück?
  if (nach.anzahl >= ausgang.anzahl) wiederhergestellt++;
  void loseAusgang;
  for (const w of Object.values(d.walls)) {
    if (w.a === w.b) melde(`Wand ${w.id} hat zweimal denselben Knoten`);
    if (!d.nodes[w.a] || !d.nodes[w.b]) melde(`Wand ${w.id} zeigt auf fehlenden Knoten`);
  }
  for (const o of Object.values(d.openings)) {
    const w = d.walls[o.wallId];
    if (!w) { melde(`Öffnung ${o.id} ohne Wand`); continue; }
    const l = Math.hypot(d.nodes[w.b].x - d.nodes[w.a].x, d.nodes[w.b].y - d.nodes[w.a].y);
    if (passtVorher.has(o.id) && (o.distance - o.width / 2 < -0.01 || o.distance + o.width / 2 > l + 0.01)) melde(`Öffnung ${o.id} ragt aus der Wand (${o.distance.toFixed(3)} ± ${(o.width / 2).toFixed(3)} auf ${l.toFixed(3)} m)`);
  }
  const zweiter = planeKorrektur(d);
  const rest = zweiter.anschluesse.length + zweiter.stummel.length + zweiter.doppelwaende.length;
  if (rest) melde(`zweiter Lauf findet noch ${zweiter.anschluesse.length} Anschl., ${zweiter.stummel.length} Stummel, ${zweiter.doppelwaende.length} Doppel`);
  if (b.maxBewegung > 0.3) melde(`Knoten wandert ${b.maxBewegung.toFixed(3)} m`);
}

export function pruefeAutokorrekturBelastung(check: CheckFn): void {
  console.log('\n▸ Autokorrektur unter Last');
  seed = 12345; idz = 0; fehler = 0; laeufe = 0; wiederhergestellt = 0; befunde.length = 0;
  const basis = wurzel();
  check('Referenzordner gefunden', basis !== undefined, true);
  if (!basis) return;
  const R = join(basis, 'scripts', 'referenz');
  const quellen: [string, KorrekturDokument][] = [];
  {
    const s = importRaumplan(readFileSync(join(R, 'raumscan-beispiel.json'), 'utf-8'));
    quellen.push(['RoomPlan', ausImport(s.levels, s.nodes, s.walls, s.openings)]);
  }
  for (const f of ['scan-wohnung-2026-10-02.building-1.12.0.json', 'ravia-building-beispiel.json']) {
    const e = importBuildingModel(JSON.parse(readFileSync(join(R, f), 'utf-8')));
    check(`${f} eingelesen`, e.ok, true);
    if (e.ok) quellen.push([f.slice(0, 22), ausImport(e.levels, e.nodes, e.walls, e.openings)]);
  }
  {
    const r = buildReferenceDocument();
    const d = leer();
    Object.assign(d, { nodes: r.nodes, walls: r.walls, openings: r.openings, levels: r.levels, fixtures: r.fixtures, durchbrueche: r.durchbrueche ?? {}, pipes: r.pipes ?? {}, pipeAccessories: r.pipeAccessories ?? {} });
    quellen.push(['Referenzhaus', klon(d)]);
  }
  for (const [name, d] of quellen) {
    for (const art of ['wackeln', 'ecken-oeffnen', 'doppelt', 'stummel', 'alles'] as Art[]) {
      for (let i = 0; i < 40; i++) pruefe(name, d, art, i);
    }
  }
  console.log(`    ${laeufe} Läufe, ${fehler} Befunde, Raumzahl des Originals ${wiederhergestellt}× wieder erreicht`);
  for (const b of befunde.slice(0, 10)) console.log('    ' + b);
  check('800 Läufe über vier Grundrisse', laeufe, 800);
  check('kein Befund (Räume, Fläche, lose Enden, Öffnungen, zweiter Lauf, Bewegung, Absturz)', fehler, 0);
  // Gegenprobe, dass das Verderben überhaupt etwas tut: Ohne Korrektur
  // bleiben in fast jedem Lauf Stummel oder doppelte Wände stehen.
  seed = 777;
  let ungerichtet = 0;
  for (const [, d] of quellen) {
    const k = klon(d);
    verderbe(k, 'alles');
    const p = planeKorrektur(k);
    if (p.anschluesse.length + p.stummel.length + p.doppelwaende.length > 0) ungerichtet++;
  }
  check('Gegenprobe: verdorbene Grundrisse haben ohne Korrektur Befunde', ungerichtet, quellen.length);
}
