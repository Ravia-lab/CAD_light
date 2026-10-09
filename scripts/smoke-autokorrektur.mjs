/**
 * Rauchtest „Grundriss prüfen und korrigieren" (1.76.0).
 *
 * Der Weg durch die Oberfläche: Plan mit vier eingebauten Mängeln zeichnen,
 * Reiter „Prüfung", Knopf, Dialog, Lücke beantworten, korrigieren — und
 * danach die Zahlen am Modell nachzählen. Dazu die beiden Zusagen, die nur am
 * laufenden Programm prüfbar sind: Alles ist **ein** Schritt in der Historie,
 * und eine Lücke ohne Antwort bleibt offen.
 *
 * **Der Plan, von Hand hergeleitet.** Zwei Räume nebeneinander, 4 × 3 m:
 *
 *  · Raum 1 schließt seine linke Wand 3 cm über der Ecke, bei (0 | 0,03) —
 *    **eine offene Ecke**. (Unter 2 cm fängt schon das Zeichnen; und auf der
 *    unteren Wand selbst würde das Zeichnen sie teilen.)
 *  · Raum 2 hat unten eine **Lücke von 0,90 m** zwischen x = 5,5 und 6,4.
 *  · Seine rechte Wand läuft von (8 | 0) nach (8,04 | 3) — **schief**.
 *  · An der Ecke (8,04 | 3) ragt eine Wand 8 cm weiter — **ein Überstand**.
 *
 * Ohne Antwort auf die Lücke: Ecke zu, Überstand weg, Wand gerade — und
 * Raum 2 bleibt offen. Mit „Tür": zwei Räume und eine Tür von 0,86 m.
 */

import { chromium } from 'playwright';

const BASIS = process.env.RAVIA_PROBE ?? 'http://localhost:4177/';
const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const ctx = await b.newContext({ viewport: { width: 1500, height: 920 } });
await ctx.addInitScript(() => {
  localStorage.setItem('ravia-ui-mode', 'profi');
  localStorage.setItem('ravia-einfuehrung', '1');
});
const p = await ctx.newPage();
const fehler = [];
p.on('pageerror', (e) => fehler.push('PAGEERROR: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('Failed to load resource')) fehler.push(m.text()); });

let failures = 0;
const pruefe = (label, ist, soll, tol = 0) => {
  const ok = typeof ist === 'number' && typeof soll === 'number' ? Math.abs(ist - soll) <= tol : JSON.stringify(ist) === JSON.stringify(soll);
  if (!ok) failures++;
  console.log(`  ${ok ? '✓' : '✗'} ${label}: ${JSON.stringify(ist)}${ok ? '' : ` (erwartet ${JSON.stringify(soll)})`}`);
};

await p.goto(BASIS, { waitUntil: 'networkidle' });
await p.waitForTimeout(600);

const zeichne = () => p.evaluate(() => {
  const s = window.__ravia.getState();
  s.neuesDokument('Korrekturprobe');
  const w = (a, b) => window.__ravia.getState().addWall({ x: a[0], y: a[1] }, { x: b[0], y: b[1] });
  // Raum 1 — die letzte Wand endet 3 cm neben der Ecke.
  w([0, 0], [4, 0]); w([4, 0], [4, 3]); w([4, 3], [0, 3]); w([0, 3], [0, 0.03]);
  // Raum 2 — Lücke unten, rechte Wand schief, Überstand an der Ecke.
  w([4, 0], [5.5, 0]); w([6.4, 0], [8, 0]); w([8, 0], [8.04, 3]); w([8.04, 3], [4, 3]); w([8.04, 3], [8.12, 3]);
});
const stand = () => p.evaluate(() => {
  const d = window.__ravia.getState().doc;
  const g = new Map();
  for (const w of Object.values(d.walls)) for (const k of [w.a, w.b]) g.set(k, (g.get(k) ?? 0) + 1);
  const schief = Object.values(d.walls).filter((w) => {
    const a = d.nodes[w.a], b = d.nodes[w.b];
    return Math.abs(a.x - b.x) > 1e-6 && Math.abs(a.y - b.y) > 1e-6;
  }).length;
  return {
    waende: Object.keys(d.walls).length,
    raeume: Object.keys(d.rooms).length,
    lose: [...g.values()].filter((n) => n === 1).length,
    schief,
    tueren: Object.values(d.openings).filter((o) => o.kind === 'door').map((o) => Math.round(o.width * 100) / 100),
    historie: window.__ravia.getState().past.length,
  };
});

console.log('\nA · Dialog öffnen und lesen');
await zeichne();
const vorher = await stand();
pruefe('9 Wände gezeichnet', vorher.waende, 9);
// Lose Enden: (0|0) und (0|0,03) an der Ecke, Lücke 2×, Überstand (8,12|3) — 5.
pruefe('5 lose Wandenden', vorher.lose, 5);
pruefe('1 schiefe Wand', vorher.schief, 1);

await p.getByRole('button', { name: 'Prüfung', exact: true }).click();
await p.locator('[data-pruef="korrektur-oeffnen"]').click();
await p.locator('[data-pruef="korrektur-dialog"]').waitFor({ timeout: 4000 });
pruefe('Dialog offen', await p.locator('[data-pruef="korrektur-dialog"]').isVisible(), true);
const zahl = async (id) => {
  const el = p.locator(`[data-pruef="korrektur-zahl-${id}"]`);
  return (await el.count()) ? Number(await el.innerText()) : 0;
};
pruefe('Anschlüsse: 1 (die offene Ecke)', await zahl('anschluesse'), 1);
pruefe('Stummel/Überstände: 1', await zahl('stummel'), 1);
pruefe('Schief: Wandpunkte > 0', (await zahl('begradigen')) > 0, true);
pruefe('Eine Lücke zur Frage', await p.locator('[data-pruef="korrektur-luecke"]').count(), 1);
pruefe('Die Lücke steht auf „offen lassen"', await p.locator('[data-pruef="korrektur-luecke"] [data-pruef="korrektur-antwort-offen"]').getAttribute('aria-pressed'), 'true');
pruefe('„Kleine Räume" ist nicht vorbelegt (nur wenn es welche gibt)', await p.locator('[data-pruef="korrektur-haken-kleineRaeume"]').count(), 0);

console.log('\nB · Korrigieren ohne Antwort auf die Lücke');
await p.locator('[data-pruef="korrektur-ausfuehren"]').click();
await p.locator('[data-pruef="korrektur-meldung"]').waitFor({ timeout: 4000 });
const mitte = await stand();
console.log('    Meldung: ' + (await p.locator('[data-pruef="korrektur-meldung"]').innerText()));
pruefe('Genau ein neuer Schritt in der Historie', mitte.historie - vorher.historie, 1);
pruefe('Keine schiefe Wand mehr', mitte.schief, 0);
// Übrig: nur die beiden Enden an der Lücke.
pruefe('Nur noch die 2 losen Enden der Lücke', mitte.lose, 2);
pruefe('Raum 1 da, Raum 2 offen → 1 Raum', mitte.raeume, 1);
pruefe('Die Lücke steht weiter im Dialog', await p.locator('[data-pruef="korrektur-luecke"]').count(), 1);
pruefe('Sonst nichts mehr angeboten', (await zahl('anschluesse')) + (await zahl('stummel')) + (await zahl('begradigen')), 0);

console.log('\nC · Lücke als Tür');
await p.locator('[data-pruef="korrektur-luecke"] [data-pruef="korrektur-antwort-tuer"]').click();
await p.locator('[data-pruef="korrektur-ausfuehren"]').click();
await p.waitForTimeout(300);
const nachher = await stand();
pruefe('Zwei Räume', nachher.raeume, 2);
pruefe('Kein loses Ende mehr', nachher.lose, 0);
pruefe('Eine Tür von 0,86 m', nachher.tueren, [0.86]);
pruefe('Keine Lücke mehr im Dialog', await p.locator('[data-pruef="korrektur-luecke"]').count(), 0);

console.log('\nD · Strg+Z nimmt den Schritt zusammen zurück');
await p.locator('[data-pruef="korrektur-dialog"]').getByRole('button', { name: 'Schließen', exact: true }).click();
await p.evaluate(() => window.__ravia.getState().undo());
const zurueck = await stand();
pruefe('Wieder ein Raum und zwei lose Enden', [zurueck.raeume, zurueck.lose], [1, 2]);
await p.evaluate(() => window.__ravia.getState().undo());
const ganzZurueck = await stand();
pruefe('Noch einmal: wie gezeichnet (5 lose Enden, 1 schief)', [ganzZurueck.lose, ganzZurueck.schief, ganzZurueck.waende], [5, 1, 9]);

console.log('\nE · Sauberer Plan: nichts zu tun, kein Schritt in der Historie');
await p.evaluate(() => {
  const s = window.__ravia.getState();
  s.neuesDokument('Sauber');
  const w = (a, b) => window.__ravia.getState().addWall({ x: a[0], y: a[1] }, { x: b[0], y: b[1] });
  w([0, 0], [4, 0]); w([4, 0], [4, 3]); w([4, 3], [0, 3]); w([0, 3], [0, 0]);
});
await p.locator('[data-pruef="korrektur-oeffnen"]').click();
await p.locator('[data-pruef="korrektur-dialog"]').waitFor({ timeout: 4000 });
pruefe('Knopf „Korrigieren" gesperrt', await p.locator('[data-pruef="korrektur-ausfuehren"]').isDisabled(), true);
pruefe('Dialog sagt „Nichts gefunden"', (await p.locator('[data-pruef="korrektur-dialog"]').innerText()).includes('Nichts gefunden'), true);

pruefe('Keine Fehler in der Konsole', fehler, []);
await b.close();
console.log(failures ? `\n✗ ${failures} Prüfungen fehlgeschlagen` : '\n✓ Rauchtest Autokorrektur bestanden');
process.exit(failures ? 1 : 0);
