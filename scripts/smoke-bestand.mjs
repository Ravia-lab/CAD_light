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
p.on('console', (m) => { if (m.text().startsWith('DIFF ')) console.log('  · ' + m.text()); });
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

console.log('\n▸ Heizkörper an der Innenwand: Stich von der kürzesten Stelle (gemeldet: „spart sehr viel Rohr und Bögen")');
{
  const r = await p.evaluate((scan) => {
    const S = () => window.__ravia.getState();
    S().loadRaumscan(scan);
    for (const raum of Object.values(S().doc.rooms)) S().setzeRaumHeizleistung(raum.id, raum.usage === 'bath' ? 600 : 1000);
    // Im Flurbereich von „Raum 2", an der Innenwand unter „Raum 9".
    const f = S().addFixture('radiator', { x: 3.6, y: -5.6 }, { params: { powerW: 500 } });
    const id = typeof f === 'string' ? f : f?.id;
    S().addHeatPump({ x: 13.3, y: -2 });
    const erg = S().legeRohrnetzAus('sanierung', 'ring');
    const stueck = Object.values(S().doc.pipes).filter((x) => x.service === 'heating-flow' && x.label?.startsWith('Anbindung'));
    // Die Stücke des Stichs: an einem Ende liegt der Heizkörper, der Rest hängt dran.
    const fx = S().doc.fixtures[id];
    const len = (x) => Math.hypot(x.points[1].x - x.points[0].x, x.points[1].y - x.points[0].y);
    const nahe = stueck.filter((x) => x.points.some((q) => Math.hypot(q.x - fx.position.x, q.y - fx.position.y) < 3.2));
    return {
      served: erg.served,
      hinweis: erg.notes.find((n) => n.text.startsWith('Nicht an einer Außenwand, deshalb als Stich'))?.text ?? '',
      fehler: erg.notes.filter((n) => n.severity === 'error').length,
      weiten: [...new Set(nahe.map((x) => x.label))],
      laengeStich: Math.round(nahe.reduce((s0, x) => s0 + len(x), 0) * 100) / 100,
    };
  }, SCAN);
  console.log(`  · ${r.hinweis}`);
  expect('Alle zehn Heizkörper versorgt', r.served, 10);
  expect('Der Innenwand-Heizkörper hängt an einem Stich', /Heizkörper \d+,\d+ m/.test(r.hinweis), true);
  const m = Number((r.hinweis.match(/Heizkörper (\d+,\d+) m/)?.[1] ?? '99').replace(',', '.'));
  // Luftlinie zum Ring an der Nordwand ≈ 2,6 m; an der Wand entlang ≈ 2,8 m.
  expect('Der Stich ist kurz (< 3,5 m)', m < 3.5, true);
  expect('Der Stich in Cu 15', r.weiten.every((w) => w === 'Anbindung Cu 15 × 1'), true);
  expect('Kein Fehler', r.fehler, 0);
  await p.evaluate(() => { const S = window.__ravia.getState(); S.setTool('select'); S.setSelection(null); S.setViewport({ center: { x: 4.5, y: -5 }, zoom: 110 }); });
  await p.waitForTimeout(300);
  await p.locator('main canvas').first().screenshot({ path: './screenshots/bestand-stich.png' });
  await p.evaluate(() => window.__ravia.getState().setViewport({ center: { x: 5, y: -3 }, zoom: 55 }));
}

console.log('\n▸ Raumnamen gehen beim Spiegeln mit (gemeldet: „werden durcheinandergewürfelt")');
{
  const r = await p.evaluate((scan) => {
    const S = () => window.__ravia.getState();
    S().loadRaumscan(scan);
    // Jeden Raum eindeutig benennen und die Nutzung merken.
    let i = 0;
    for (const raum of Object.values(S().doc.rooms)) S().updateRoom(raum.id, { name: `Prüfraum ${++i}` });
    const vorher = Object.fromEntries(Object.values(S().doc.rooms).map((x) => [x.id, [x.name, x.usage]]));
    const vergleiche = () => {
      const jetzt = Object.fromEntries(Object.values(S().doc.rooms).map((x) => [x.id, [x.name, x.usage]]));
      const diff = Object.keys(vorher).filter((id) => JSON.stringify(vorher[id]) !== JSON.stringify(jetzt[id]));
      if (diff.length) console.log("DIFF " + JSON.stringify(diff.map((id) => [id, vorher[id], jetzt[id]])));
      return diff.length;
    };
    const ergebnis = {};
    S().spiegleGrundriss('senkrecht', 'alles'); ergebnis.lr = vergleiche();
    S().spiegleGrundriss('waagerecht', 'alles'); ergebnis.ou = vergleiche();
    // Ganze Zeichnung auswählen und über die Auswahl spiegeln und verschieben.
    const waende = Object.keys(S().doc.walls).map((id) => ({ kind: 'wall', id }));
    S().setSelections?.(waende);
    if (!S().setSelections) window.__ravia.setState({ selections: waende });
    S().mirrorSelection('x'); ergebnis.auswahl = vergleiche();
    S().moveSelection({ x: 25, y: -18 }); ergebnis.verschoben = vergleiche();
    S().undo(); S().undo(); S().undo(); S().undo(); ergebnis.zurueck = vergleiche();
    ergebnis.anzahl = Object.keys(vorher).length;
    return ergebnis;
  }, SCAN);
  expect('Neun benannte Räume', r.anzahl, 9);
  expect('Links/rechts gespiegelt: kein Name verrutscht', r.lr, 0);
  expect('Oben/unten gespiegelt: kein Name verrutscht', r.ou, 0);
  expect('Über die Auswahl gespiegelt: kein Name verrutscht', r.auswahl, 0);
  expect('Weit verschoben: kein Name verrutscht', r.verschoben, 0);
  expect('Viermal Strg+Z: alles wie vorher', r.zurueck, 0);
}

console.log('\n▸ Nichts in der Konsole');
expect('Keine Fehler im Browser', errs.slice(0, 3), []);

await b.close();
console.log(failures ? `\n✗ ${failures} Prüfung(en) fehlgeschlagen` : '\n✓ Bestand: alles in Ordnung');
process.exit(failures ? 1 : 0);
