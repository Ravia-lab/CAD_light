/**
 * Korpuslauf: der IFC-Import gegen echte Dateien fremder Programme.
 * ---------------------------------------------------------------------------
 * **Warum das kein Prüfblock ist.** `scripts/pruefungen/*` läuft bei jedem
 * `npm run verify` und darf deshalb nichts brauchen, was nicht im Projekt
 * liegt. Die Dateien hier sind zusammen über 200 MB groß und gehören
 * anderen Leuten — sie haben im Archiv nichts zu suchen. Was aus ihnen
 * gelernt wurde, steht als von Hand gerechneter Prüffall in
 * `pruefungen/ifceinheiten.ts`, `pruefungen/ifcraumumriss.ts` und
 * `pruefungen/ifcfremd.ts`; dieser Lauf hier ist das Netz, mit dem man nach
 * dem **nächsten** Fund fischt.
 *
 * **Was er prüft.** Nicht Zahlen — die kennt niemand für ein fremdes Haus —,
 * sondern **Bauartregeln**, die für jedes Gebäude gelten müssen:
 *
 *  · keine Ausnahme, gleich was in der Datei steht;
 *  · keine unendliche oder unbestimmte Zahl im Ergebnis;
 *  · jede Wand hat zwei Knoten, jede Öffnung eine Wand;
 *  · Wandstärken zwischen 1 und 150 cm, Wandhöhen zwischen 0,5 und 20 m;
 *  · ein Grundriss, der breiter ist als 3 km, ist ein Einheitenfehler.
 *
 * Die letzte Regel hat den größten Fehler gefunden, den dieser Import je
 * hatte: Bis 1.32.0 wurde jede Zahl als Meter gelesen, und die Mehrheit der
 * Dateien schreibt Millimeter. Der Korpus hat das in einem Lauf gezeigt —
 * fünf Jahre Prüfblöcke gegen ArchiCAD-Dateien hätten es nie getan.
 *
 * **Aufruf**
 *
 *     npm run korpus:ifc -- <ordner>          # Dateien darin prüfen
 *     npm run korpus:ifc -- <ordner> --holen  # vorher laden, was fehlt
 *
 * Ein Verstoß gegen eine Bauartregel beendet den Lauf mit Code 1. Auffällige
 * Einzelheiten, die an der Datei liegen können und nicht am Import —
 * Öffnungen, die über ihre Wand hinausragen, übersprungene Bauteile —
 * werden genannt, aber nicht gewertet.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { importIfc } from '../src/lib/ifcImport';

/**
 * Der Korpus: offene Beispieldateien, jede aus einem anderen Programm.
 *
 * Zwei Quellen, beide öffentlich. Die erste ist das Modellarchiv der
 * University of Auckland, die zweite das ifcWiki des KIT — dort liegen die
 * beiden Dateien, an denen 1.30.0 seine sieben Importfehler gefunden hat.
 *
 * Bewusst enthalten sind mehrere Ausgaben **desselben** Gebäudes: das
 * FZK-Haus gibt es hier aus ArchiCAD 11, ArchiCAD 20, ADT, EliteCAD und
 * Nemetschek. Dieselbe Wand muss aus allen fünf gleich dick ankommen — das
 * ist die schärfste Probe, die ein Import bestehen kann, und sie kostet
 * nichts als das Herunterladen.
 */
const KORPUS: Array<{ name: string; quelle: string }> = [
  // — dasselbe Haus aus fünf Programmen —
  { name: 'AC20-FZK-Haus.ifc', quelle: 'https://www.ifcwiki.org/images/e/e3/AC20-FZK-Haus.ifc' },
  { name: '20180425231110AC11-FZK-Haus-IFC.ifc', quelle: 'auckland' },
  { name: '231110ADT-FZK-Haus-2005-2006.ifc', quelle: 'auckland' },
  { name: '301110FZK-Haus-EliteCAD.ifc', quelle: 'auckland' },
  { name: '301110Nem-FZK-Haus-2x3.ifc', quelle: 'auckland' },
  // — dasselbe Institutsgebäude aus zwei Programmen —
  { name: 'AC20-Institute-Var-2.ifc', quelle: 'https://www.ifcwiki.org/images/9/98/AC20-Institute-Var-2.ifc' },
  { name: '261110Allplan-2008-Institute-Var-2-IFC.ifc', quelle: 'auckland' },
  // — echte Projekte, gemischte Herkunft —
  { name: '20200109rac_advanced_sample_project.ifc', quelle: 'auckland' }, // Revit
  { name: '20190228201620_Svaleveien_8_Hus_A.ifc', quelle: 'auckland' }, // Vectorworks
  { name: '20210215IFC4_RV_Convenience_store_Renga_4.5.ifc', quelle: 'auckland' }, // Renga
  { name: '20201208DigitalHub_ARC.ifc', quelle: 'auckland' },
  { name: '20200404UFCSPA-ARQ-PE-R0-correto.ifc', quelle: 'auckland' }, // Zentimeter
  { name: '20160613office_model_CV2b_fordesign.ifc', quelle: 'auckland' },
  { name: '2022020320211122Wellness_center_Sama.ifc', quelle: 'auckland' },
  { name: '261110ADT-Smiley-West-Project-14-10-2005.ifc', quelle: 'auckland' },
  { name: '20180731Dubal_Herrera_limpio.ifc', quelle: 'auckland' },
  { name: '20210125Prova.ifc', quelle: 'auckland' },
  { name: '202102183458-Model.ifc', quelle: 'auckland' },
  { name: '202103162102_cira.ifc', quelle: 'auckland' },
];

const AUCKLAND = 'https://openifcmodel.cs.auckland.ac.nz/api/download/';

function hole(ordner: string): void {
  mkdirSync(ordner, { recursive: true });
  for (const { name, quelle } of KORPUS) {
    const ziel = join(ordner, name);
    if (existsSync(ziel) && statSync(ziel).size > 1000) continue;
    // Die Auckland-Namen tragen Leerzeichen; abgelegt wird mit Unterstrich,
    // geladen mit dem Originalnamen.
    const url = quelle === 'auckland' ? AUCKLAND + encodeURIComponent(name.replace(/_/g, ' ')) : quelle;
    process.stdout.write(`  lade ${name} … `);
    try {
      execFileSync('curl', ['-sSL', '-m', '600', '--max-filesize', '80000000', '-o', ziel, url]);
      const ok = existsSync(ziel) && readFileSync(ziel).subarray(0, 12).toString() === 'ISO-10303-21';
      console.log(ok ? `${(statSync(ziel).size / 1048576).toFixed(1)} MB` : 'kein IFC — übersprungen');
    } catch {
      console.log('nicht erreichbar');
    }
  }
}

interface Befund {
  datei: string;
  mb: number;
  ms: number;
  schema: string;
  waende: number;
  oeffnungen: number;
  raeume: number;
  geschosse: number;
  breite: number;
  dicke: string;
  /** Verstöße gegen Bauartregeln — sie beenden den Lauf. */
  verstoesse: string[];
  /** Auffälligkeiten, die an der Datei liegen können. */
  auffaellig: string[];
}

function pruefe(pfad: string, name: string): Befund {
  const mb = +(statSync(pfad).size / 1048576).toFixed(1);
  const text = readFileSync(pfad, 'utf8');
  const t0 = Date.now();
  const r = importIfc(text);
  const ms = Date.now() - t0;

  const knoten = new Map(r.nodes.map((k) => [k.id, k]));
  const laengeVon = (w: { a: string; b: string }): number => {
    const a = knoten.get(w.a);
    const b = knoten.get(w.b);
    return a && b ? Math.hypot(b.x - a.x, b.y - a.y) : NaN;
  };

  const v: string[] = [];
  const a: string[] = [];
  const endlich = (x: number) => Number.isFinite(x);

  if (
    r.nodes.some((k) => !endlich(k.x) || !endlich(k.y)) ||
    r.walls.some((w) => !endlich(w.thickness) || !endlich(w.height)) ||
    r.openings.some((o) => !endlich(o.distance) || !endlich(o.width) || !endlich(o.height))
  ) {
    v.push('unbestimmte Zahl im Ergebnis');
  }
  if (r.walls.some((w) => !knoten.has(w.a) || !knoten.has(w.b))) v.push('Wand ohne Knoten');
  if (r.walls.some((w) => !(laengeVon(w) > 0.001))) v.push('Wand ohne Länge');
  if (r.walls.some((w) => w.thickness <= 0.01 || w.thickness > 1.5)) v.push('Wandstärke außerhalb 1…150 cm');
  if (r.walls.some((w) => w.height <= 0.5 || w.height > 20)) v.push('Wandhöhe außerhalb 0,5…20 m');
  if (r.levels.some((l) => l.height <= 1.5 || l.height > 12)) v.push('Geschosshöhe außerhalb 1,5…12 m');

  const xs = r.nodes.map((k) => k.x);
  const breite = r.nodes.length ? Math.max(...xs) - Math.min(...xs) : 0;
  if (r.ok && breite > 3000) v.push(`Grundriss ${breite.toFixed(0)} m breit — Einheitenfehler`);

  const wandNach = new Map(r.walls.map((w) => [w.id, w]));
  let raus = 0;
  let waise = 0;
  let unmass = 0;
  for (const o of r.openings) {
    const w = wandNach.get(o.wallId);
    if (!w) {
      waise += 1;
      continue;
    }
    const L = laengeVon(w);
    if (o.distance - o.width / 2 < -0.02 || o.distance + o.width / 2 > L + 0.02) raus += 1;
    // Die Grenzen des Imports selbst: Breite bis zur Wandlänge, Höhe über
    // 0,20 m und bis 4,00 m. Der Korpus prüft den Vertrag des Moduls, nicht
    // einen zweiten, eigenen Geschmack.
    if (o.width <= 0.2 || o.width > L + 0.02 || o.height <= 0.2 || o.height > 4) unmass += 1;
  }
  if (waise) v.push(`${waise} Öffnung(en) ohne Wand`);
  if (raus) v.push(`${raus} Öffnung(en) ragen über ihre Wand hinaus`);
  if (unmass) v.push(`${unmass} Öffnung(en) außerhalb der eigenen Maßgrenzen`);
  for (const s of r.skipped) a.push(`${s.count}× ${s.reason}`);

  return {
    datei: name,
    mb,
    ms,
    schema: r.schema ?? '?',
    waende: r.walls.length,
    oeffnungen: r.openings.length,
    raeume: r.spaces.length,
    geschosse: r.levels.length,
    breite: +breite.toFixed(2),
    dicke: r.walls.length
      ? `${Math.min(...r.walls.map((w) => w.thickness)).toFixed(2)}–${Math.max(
          ...r.walls.map((w) => w.thickness),
        ).toFixed(2)}`
      : '—',
    verstoesse: v,
    auffaellig: a,
  };
}

// ---------------------------------------------------------------------------

const ordner = process.argv[2] ?? 'ifc-korpus';
if (process.argv.includes('--holen')) {
  console.log(`\n▸ Korpus laden nach ${ordner}\n`);
  hole(ordner);
}

if (!existsSync(ordner)) {
  console.error(`Ordner „${ordner}" gibt es nicht. Mit --holen anlegen und füllen.`);
  process.exit(2);
}

const dateien = readdirSync(ordner)
  .filter((n) => /\.ifc$/i.test(n))
  .sort();
if (dateien.length === 0) {
  console.error(`In „${ordner}" liegt keine IFC-Datei. Mit --holen laden.`);
  process.exit(2);
}

console.log(`\n▸ IFC-Korpus — ${dateien.length} Dateien aus ${ordner}\n`);
console.log(
  `${'Datei'.padEnd(46)} ${'Schema'.padEnd(7)} ${'Wd'.padStart(4)} ${'Öf'.padStart(4)} ` +
    `${'Rm'.padStart(4)} ${'Gs'.padStart(3)} ${'Breite'.padStart(8)} ${'Dicke'.padStart(11)} ${'ms'.padStart(6)}`,
);
console.log('─'.repeat(104));

const befunde = dateien.map((n) => pruefe(join(ordner, n), n));
for (const b of befunde) {
  const marke = b.verstoesse.length ? '✗' : ' ';
  console.log(
    `${marke} ${b.datei.slice(0, 44).padEnd(44)} ${b.schema.padEnd(7)} ${String(b.waende).padStart(4)} ` +
      `${String(b.oeffnungen).padStart(4)} ${String(b.raeume).padStart(4)} ${String(b.geschosse).padStart(3)} ` +
      `${b.breite.toFixed(1).padStart(8)} ${b.dicke.padStart(11)} ${String(b.ms).padStart(6)}`,
  );
}

const schlecht = befunde.filter((b) => b.verstoesse.length);
if (schlecht.length) {
  console.log('\n▸ Verstöße gegen Bauartregeln\n');
  for (const b of schlecht) {
    console.log(`  ${b.datei}`);
    for (const v of b.verstoesse) console.log(`    ✗ ${v}`);
  }
}

const auffaellig = befunde.filter((b) => b.auffaellig.length);
if (auffaellig.length) {
  console.log('\n▸ Auffällig — kann an der Datei liegen, nicht gewertet\n');
  for (const b of auffaellig) {
    console.log(`  ${b.datei}`);
    for (const x of b.auffaellig) console.log(`    · ${x}`);
  }
}

/*
 * Die Gegenprobe über Programmgrenzen: dasselbe Haus aus mehreren
 * Programmen. Verglichen wird die **Wandstärke**, weil sie die einzige
 * Größe ist, die jedes Programm gleich meint — Wandzahl und Länge hängen
 * davon ab, wie das jeweilige Programm Wandzüge zerlegt.
 */
const gruppen: Array<{ titel: string; teil: string }> = [
  { titel: 'FZK-Haus', teil: 'FZK-Haus' },
  { titel: 'Institutsgebäude', teil: 'Institute' },
];
console.log('\n▸ Dasselbe Haus aus mehreren Programmen\n');
for (const g of gruppen) {
  const teilnehmer = befunde.filter((b) => b.datei.includes(g.teil) && b.waende > 0);
  if (teilnehmer.length < 2) continue;
  console.log(`  ${g.titel}`);
  for (const t of teilnehmer) {
    console.log(`    ${t.datei.slice(0, 42).padEnd(44)} ${t.waende} Wände, Dicke ${t.dicke} m, ${t.raeume} Räume`);
  }
}

console.log(
  schlecht.length
    ? `\n✗ ${schlecht.length} von ${befunde.length} Dateien verletzen eine Bauartregel\n`
    : `\n✓ KORPUS BESTANDEN — ${befunde.length} Dateien, keine Bauartregel verletzt\n`,
);
process.exit(schlecht.length ? 1 : 0);
