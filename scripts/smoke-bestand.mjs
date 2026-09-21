/**
 * Rauchtest „Bestand": die automatische Ringverlegung an einem echten Haus.
 *
 * Grundlage ist ein echter Raumscan (RoomPlan, „Room Scanner"), den Manuel
 * am 21.09.2026 geschickt hat — mit allem, was ein Scan mitbringt: schiefe
 * Innenwände, vier offene Wandenden, eine Wand ohne Tür, 40,6° verdreht
 * aufgenommen. Anonymisiert: Adresse, Koordinaten und das 3D-Netz sind aus
 * der Datei entfernt (`scripts/referenz/raumscan-bestand-ring.json`),
 * übrig ist nur die Geometrie.
 *
 * Gemeldet war: „die autorohrverlegung war wieder komplett konfus … die
 * autoauslegung muss 100% sein". Dieser Test hält fest, was „richtig" hier
 * heißt — so, wie ein Heizungsbauer den Ring in dieses Haus legen würde:
 *
 *  - jeder Heizkörper hängt am Ring, keiner fehlt;
 *  - der Ring läuft an den Außenwänden, nicht quer durch Zimmer;
 *  - Außenleitung und Zuleitung 1" (Cu 28), Kreisleitung nur Cu 22 und
 *    Cu 18, Heizkörper mit Cu 15;
 *  - im Bad ein Badheizkörper;
 *  - kein Befund der Stufe „Fehler".
 *
 * Und das an zwei Aufstellorten der Wärmepumpe, damit es nicht an einem
 * glücklichen Punkt hängt.
 *
 * Mit `RAVIA_PROBE=<url>` läuft der Test gegen einen echten Server.
 */

import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const BASIS = process.env.RAVIA_PROBE ?? 'http://localhost:4177/';
const SCAN = readFileSync(new URL('./referenz/raumscan-bestand-ring.json', import.meta.url), 'utf8');

const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
const errs = [];
p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
p.on('console', (m) => { if (m.type() === 'error' && !/ERR_CONNECTION_RESET/.test(m.text())) errs.push(m.text()); });

let failures = 0;
const expect = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? '✓' : '✗'} ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (erwartet ${JSON.stringify(expected)})`}`);
};

await p.addInitScript(() => {
  localStorage.clear();
  localStorage.setItem('ravia-einfuehrung', '1');
  localStorage.setItem('ravia-ui-mode', 'profi');
});
await p.goto(BASIS, { waitUntil: 'networkidle' });
await p.waitForTimeout(1500);

/**
 * Scan laden, Heizlast je Raum eintragen (so kommt sie aus RaVia zurück:
 * `setzeRaumHeizleistung` setzt dann den Heizkörper an seinen Platz),
 * Wärmepumpe aufstellen und als Ring auslegen.
 */
const lauf = (wp) => p.evaluate(({ scan, wp }) => {
  const S = () => window.__ravia.getState();
  const imp = S().loadRaumscan(scan);
  for (const r of Object.values(S().doc.rooms)) S().setzeRaumHeizleistung(r.id, r.usage === 'bath' ? 600 : 1000);
  S().addHeatPump(wp);
  const erg = S().legeRohrnetzAus('sanierung', 'ring');
  const d = S().doc;

  const runs = Object.values(d.pipes).filter((x) => x.service === 'heating-flow');
  const art = (a) => runs.filter((x) => (x.label ?? '').startsWith(a));
  const weiten = (a) => [...new Set(art(a).map((x) => (x.label ?? '').slice(a.length).trim()))].sort();

  // Abstand eines Punktes zur nächsten Außenwand-Achse [m].
  const aussen = Object.values(d.walls).filter((w) => w.type === 'exterior');
  const zurAussenwand = (q) => Math.min(...aussen.map((w) => {
    const a = d.nodes[w.a].position ?? d.nodes[w.a];
    const e = d.nodes[w.b].position ?? d.nodes[w.b];
    const vx = e.x - a.x, vy = e.y - a.y;
    const t = Math.max(0, Math.min(1, ((q.x - a.x) * vx + (q.y - a.y) * vy) / (vx * vx + vy * vy || 1)));
    return Math.hypot(q.x - a.x - t * vx, q.y - a.y - t * vy);
  }));
  let weitester = 0;
  for (const x of art('Ringleitung')) {
    for (let i = 1; i < x.points.length; i++) {
      for (const f of [0, 0.25, 0.5, 0.75, 1]) {
        const q = {
          x: x.points[i - 1].x + f * (x.points[i].x - x.points[i - 1].x),
          y: x.points[i - 1].y + f * (x.points[i].y - x.points[i - 1].y),
        };
        weitester = Math.max(weitester, zurAussenwand(q));
      }
    }
  }
  const heizflaechen = Object.values(d.fixtures).filter((f) => ['radiator', 'towel-radiator'].includes(f.type));
  const bad = Object.values(d.rooms).find((r) => r.usage === 'bath');
  return {
    imp: imp.ok,
    raeume: Object.keys(d.rooms).length,
    heizflaechen: heizflaechen.length,
    imBad: heizflaechen.filter((f) => f.roomId === bad?.id).map((f) => f.type),
    served: erg.served,
    fehler: erg.notes.filter((n) => n.severity === 'error').map((n) => n.text.slice(0, 120)),
    richtwert: erg.notes.some((n) => n.severity === 'warn' && n.text.startsWith('Ringanfang über den Richtwerten')),
    aussen: weiten('Außenleitung Wärmepumpe'),
    zuleitung: weiten('Zuleitung'),
    ring: weiten('Ringleitung'),
    anbindung: weiten('Anbindung'),
    weitester: Math.round(weitester * 100) / 100,
  };
}, { scan: SCAN, wp });

for (const [ort, wp] of [
  ['Wärmepumpe an der Ostseite', { x: 13.3, y: -2 }],
  ['Wärmepumpe an der Westseite', { x: -4.5, y: -5 }],
]) {
  console.log(`\n▸ ${ort}`);
  const r = await lauf(wp);
  expect('Scan eingelesen', r.imp, true);
  expect('Neun Räume erkannt', r.raeume, 9);
  expect('Neun Heizflächen gesetzt', r.heizflaechen, 9);
  expect('Im Bad ein Badheizkörper', r.imBad, ['towel-radiator']);
  expect('Alle neun am Ring', r.served, 9);
  expect('Kein Befund der Stufe „Fehler"', r.fehler, []);
  expect('Außenleitung 1"', r.aussen, ['Cu 28 × 1,5']);
  expect('Zuleitung 1"', r.zuleitung.every((w) => w === 'Cu 28 × 1,5'), true);
  expect('Kreisleitung nur Cu 22 und Cu 18', r.ring.every((w) => ['Cu 22 × 1', 'Cu 18 × 1'].includes(w)), true);
  expect('Heizkörper mit Cu 15', r.anbindung, ['Cu 15 × 1']);
  // Halbe Außenwand (0,18 m) + Wandabstand 0,05 m = 0,23 m; mit Toleranz
  // für die schiefen Scanwände 0,4 m. Quer durch ein Zimmer wären es Meter.
  expect('Der Ring bleibt an den Außenwänden (≤ 0,4 m von der Achse)', r.weitester <= 0.4, true);
  console.log(`  · weitester Ringpunkt von der Außenwandachse: ${r.weitester} m · Richtwerthinweis: ${r.richtwert}`);
  await p.evaluate(() => { const S = window.__ravia.getState(); S.setTool('select'); S.setSelection(null); });
  await p.waitForTimeout(300);
  await p.locator('main canvas').first().screenshot({ path: `./screenshots/bestand-${wp.x > 0 ? 'ost' : 'west'}.png` });
}

console.log('\n▸ Nichts in der Konsole');
expect('Keine Fehler im Browser', errs.slice(0, 3), []);

await b.close();
console.log(failures ? `\n✗ ${failures} Prüfung(en) fehlgeschlagen` : '\n✓ Bestand: alles in Ordnung');
process.exit(failures ? 1 : 0);
