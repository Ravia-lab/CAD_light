/**
 * Der Freigabelauf — alles, was vor einer Auslieferung grün sein muss.
 * ---------------------------------------------------------------------------
 * **Warum es das gibt.** Der Rauchtest `smoke:raum` war über Wochen rot und
 * meldete einen echten Fehler — den Rechtsklick, der den Geländeumriss
 * verwarf. Niemand hat ihn gesehen, weil die Rauchtests bei einer Freigabe
 * nicht mitliefen: `npm run verify` allein prüft den Rechenkern, nicht die
 * Oberfläche. Gefunden wurde der Fehler erst beim End-to-End-Lauf über die
 * Testgebäude — Wochen später, live.
 *
 * Dieser Lauf schließt die Lücke. Er macht der Reihe nach:
 *
 *   1. `npm run verify`         — der Prüflauf über den Rechenkern
 *   2. `npm run build`          — die Vorschau, gegen die die Oberflächentests laufen
 *   3. `vite preview`           — der Server dazu, wird am Ende wieder beendet
 *   4. alle `smoke:*`-Tests     — der Reihe nach, mit Ergebnis je Test
 *   5. `RAVIA_BASE=… npm run paket` — das Auslieferungspaket, nur wenn alles grün war
 *
 * **Was er bewusst nicht tut:** aufspielen. Was in den laufenden Betrieb
 * eingreift, gehört an die Hand dessen, der die Freigabe verantwortet.
 *
 *     node scripts/freigabe.mjs              # alles, ohne Paket
 *     node scripts/freigabe.mjs --paket      # mit Auslieferungspaket
 *     node scripts/freigabe.mjs --schnell    # ohne die langsamen Rauchtests
 *
 * Rückgabewert 0 heißt freigabefähig, 1 heißt: oben steht, was rot ist.
 */

import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const mitPaket = args.includes('--paket');
const schnell = args.includes('--schnell');

const fassung = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

/*
 * Die Rauchtests, in der Reihenfolge ihrer Laufzeit — die kurzen zuerst.
 * Wer abbricht, sieht dann schon nach einer Minute, ob etwas Grundsätzliches
 * kaputt ist.
 *
 * `tga` fehlt mit Absicht: Die Software-3D der Prüfcontainer stirbt bei
 * Prüfung 144, und zwar seit 1.38.0 und unabhängig vom Programmstand. Auf
 * einem Rechner mit echter Grafik läuft er; dort gehört er dazu.
 */
const RAUCHTESTS = [
  'ui', 'feat', 'export', 'griffe', 'ebenen', 'scan', 'ux', 'handwerker',
  'tablet', 'wp', 'raum', 'anlage', 'rohrnetz', 'schema', 'spiegeln',
  'tueren', 'mappe', 'leisten', 'sprache', 'loeschen', 'ring', 'bestand',
  'geschosse', 'embed', 'round2', 'druck', 'fbh3d', 'bild',
];

const farbe = { rot: '\u001b[31m', gruen: '\u001b[32m', grau: '\u001b[90m', aus: '\u001b[0m' };
const zeile = (s = '') => console.log(s);

function lauf(befehl, argumente, optionen = {}) {
  const t0 = Date.now();
  const e = spawnSync(befehl, argumente, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...optionen });
  return { ...e, dauer: Math.round((Date.now() - t0) / 100) / 10 };
}

const fehlschläge = [];

zeile(`\nFreigabelauf RaVia CAD Light ${fassung}`);
zeile('═'.repeat(61));

// --- 1 Prüflauf -------------------------------------------------------------
zeile('\n1 · Prüflauf (Rechenkern)');
{
  const e = lauf('npm', ['run', 'verify']);
  const letzte = (e.stdout ?? '').trim().split('\n').pop() ?? '';
  const ok = e.status === 0;
  if (!ok) fehlschläge.push('verify');
  zeile(`  ${ok ? farbe.gruen + '✓' : farbe.rot + '✗'}${farbe.aus} ${letzte.replace(/^[✓✗]\s*/, '')} ${farbe.grau}(${e.dauer}s)${farbe.aus}`);
  if (!ok) {
    for (const z of (e.stdout ?? '').split('\n').filter((x) => x.includes('✗')).slice(0, 12)) zeile(`     ${z.trim()}`);
  }
}

// --- 2 Bauen ----------------------------------------------------------------
zeile('\n2 · Bauen');
{
  const e = lauf('npm', ['run', 'build']);
  const ok = e.status === 0;
  if (!ok) fehlschläge.push('build');
  zeile(`  ${ok ? farbe.gruen + '✓' : farbe.rot + '✗'}${farbe.aus} dist gebaut ${farbe.grau}(${e.dauer}s)${farbe.aus}`);
  if (!ok) zeile((e.stderr ?? '').split('\n').slice(-8).join('\n'));
}

// --- 3+4 Vorschau und Rauchtests -------------------------------------------
let vorschau;
if (!schnell && !fehlschläge.length) {
  zeile('\n3 · Vorschau starten');
  vorschau = spawn('npx', ['vite', 'preview', '--port', '4177', '--strictPort'], {
    stdio: 'ignore', detached: true,
  });
  // Warten, bis der Server antwortet — nicht auf gut Glück eine Zahl schlafen.
  let steht = false;
  for (let i = 0; i < 40; i++) {
    const e = spawnSync('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', 'http://localhost:4177/'], { encoding: 'utf8' });
    if ((e.stdout ?? '').trim() === '200') { steht = true; break; }
    spawnSync('sleep', ['0.5']);
  }
  zeile(`  ${steht ? farbe.gruen + '✓' : farbe.rot + '✗'}${farbe.aus} http://localhost:4177/`);
  if (!steht) fehlschläge.push('vorschau');

  if (steht) {
    zeile('\n4 · Rauchtests (Oberfläche)');
    for (const t of RAUCHTESTS) {
      const e = lauf('npm', ['run', `smoke:${t}`]);
      const text = (e.stdout ?? '') + (e.stderr ?? '');
      const rot = (text.match(/✗/g) ?? []).length;
      const ok = e.status === 0 && rot === 0;
      if (!ok) fehlschläge.push(`smoke:${t}`);
      zeile(`  ${ok ? farbe.gruen + '✓' : farbe.rot + '✗'}${farbe.aus} smoke:${t.padEnd(11)} ${farbe.grau}${e.dauer}s${farbe.aus}` +
        (ok ? '' : `  ${farbe.rot}${rot} Prüfung(en) rot${farbe.aus}`));
      if (!ok) {
        for (const z of text.split('\n').filter((x) => x.includes('✗')).slice(0, 5)) zeile(`     ${z.trim()}`);
      }
    }
  }
} else if (schnell) {
  zeile('\n3+4 · Rauchtests übersprungen (--schnell)');
}

if (vorschau?.pid) {
  try { process.kill(-vorschau.pid); } catch { /* schon beendet */ }
}

// --- 5 Paket ----------------------------------------------------------------
if (mitPaket) {
  zeile('\n5 · Auslieferungspaket');
  if (fehlschläge.length) {
    zeile(`  ${farbe.rot}✗${farbe.aus} übersprungen — erst muss oben alles grün sein.`);
  } else {
    const e = lauf('npm', ['run', 'paket'], { env: { ...process.env, RAVIA_BASE: process.env.RAVIA_BASE ?? '/Cad_light/' } });
    const ok = e.status === 0;
    if (!ok) fehlschläge.push('paket');
    zeile(`  ${ok ? farbe.gruen + '✓' : farbe.rot + '✗'}${farbe.aus} ${ok ? (e.stdout ?? '').split('\n').filter((z) => z.includes('.tar.gz') || z.includes('.zip') || z.includes('.html')).map((z) => z.trim()).join('\n     ') : 'fehlgeschlagen'}`);
  }
}

// --- Ergebnis ---------------------------------------------------------------
zeile('\n' + '═'.repeat(61));
if (fehlschläge.length === 0) {
  zeile(`${farbe.gruen}✓ FREIGABEFÄHIG${farbe.aus} — Fassung ${fassung}`);
  zeile(`${farbe.grau}  Aufspielen macht dieser Lauf bewusst nicht. Das gehört an die Hand,${farbe.aus}`);
  zeile(`${farbe.grau}  die für den laufenden Betrieb geradesteht.${farbe.aus}`);
  process.exit(0);
} else {
  zeile(`${farbe.rot}✗ NICHT FREIGABEFÄHIG${farbe.aus} — ${fehlschläge.length} Schritt(e) rot:`);
  for (const f of fehlschläge) zeile(`    ${f}`);
  process.exit(1);
}
