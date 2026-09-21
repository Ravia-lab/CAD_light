/**
 * Rauchtest „Ring": Ringleitung, Wärmepumpe als Erzeuger, Badheizkörper,
 * Raumnamen zur Auswahl und das Heizsymbol am Raumstempel.
 *
 * Alles, was der Prüfblock `ringleitung.ts` am Rechenkern festhält, hier noch
 * einmal an der Oberfläche — mit Maus und Tastatur, so wie gemeldet:
 *  - der Knopf „Ring" in der Kopfzeile legt eine Ringleitung;
 *  - die Wärmepumpe im Garten ist der Erzeuger, ohne dass im Haus einer steht;
 *  - der Badheizkörper steht in der TGA-Palette;
 *  - das Namensfeld bietet Standardbezeichnungen an und setzt dabei die Nutzung;
 *  - ein Tipp auf das Heizsymbol schaltet beheizt/unbeheizt.
 *
 * Mit `RAVIA_PROBE=<url>` läuft der Test gegen einen echten Server.
 */

import { chromium } from 'playwright';

const BASIS = process.env.RAVIA_PROBE ?? 'http://localhost:4177/';
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

await p.evaluate(() => {
  const st = window.__ravia.getState();
  st.loadDemo();
  window.__ravia.getState().addHeatPump({ x: -3, y: 3.75 });
  const s2 = window.__ravia.getState();
  s2.setTool('select');
  s2.setSelection(null);
  s2.setViewport({ center: { x: 3, y: 3 }, zoom: 55 });
});
await p.waitForTimeout(500);

// ===========================================================================
console.log('\n▸ 1 · Ringleitung über den Knopf in der Kopfzeile');
// ===========================================================================
{
  await p.locator('header button', { hasText: /^Ring$/ }).click();
  await p.locator('header button[title^="Rohrnetz automatisch auslegen"]').click();
  await p.waitForTimeout(800);
  const r = await p.evaluate(() => {
    const runs = Object.values(window.__ravia.getState().doc.pipes).filter((x) => x.service === 'heating-flow');
    const art = (a) => runs.filter((x) => (x.label ?? '').startsWith(a));
    return {
      ring: art('Ringleitung').length,
      aussen: art('Außenleitung').length,
      zuleitung: art('Zuleitung').map((x) => x.label),
      anbindung: [...new Set(art('Anbindung').map((x) => (x.label ?? '').replace('Anbindung ', '')))],
      ringWeiten: [...new Set(art('Ringleitung').map((x) => (x.label ?? '').replace('Ringleitung ', '')))].sort(),
      status: window.__ravia.getState().statusMessage,
    };
  });
  expect('Es liegt eine Ringleitung', r.ring > 0, true);
  expect('Die Wärmepumpe im Garten ist der Erzeuger (Außenleitung)', r.aussen, 1);
  expect('Zuleitung in 1"', r.zuleitung.every((l) => l.includes('Cu 28')), true);
  expect('Ring in Cu 22 und Cu 18', r.ringWeiten, ['Cu 18 × 1', 'Cu 22 × 1']);
  expect('Heizkörper mit Cu 15 angebunden', r.anbindung, ['Cu 15 × 1']);
  await p.locator('main canvas').first().screenshot({ path: './screenshots/ring-1-ringleitung.png' });
}

// ===========================================================================
console.log('\n▸ 2 · Badheizkörper in der TGA-Palette');
// ===========================================================================
{
  await p.locator('aside button', { hasText: /^TGA$/ }).first().click();
  await p.waitForTimeout(400);
  const kacheln = await p.locator('aside .grid.grid-cols-3 button').allInnerTexts();
  expect('Der Badheizkörper steht in der Palette', kacheln.map((t) => t.trim()).includes('Badheizkörper'), true);
  expect('Der Speicher auch', kacheln.map((t) => t.trim()).includes('Speicher'), true);
}

// ===========================================================================
console.log('\n▸ 3 · Raumname tippen oder auswählen');
// ===========================================================================
{
  const raum = await p.evaluate(() => {
    const st = window.__ravia.getState();
    const r = Object.values(st.doc.rooms).find((x) => x.name.startsWith('Schlafen'));
    st.setSelection({ kind: 'room', id: r.id });
    return r.id;
  });
  await p.locator('aside button', { hasText: /^Objekt$/ }).first().click();
  await p.waitForTimeout(400);
  const feld = p.locator('aside input[list="ravia-raumnamen"]').first();
  expect('Das Namensfeld hat eine Vorschlagsliste', await feld.count(), 1);
  const vorschlaege = await p.locator('datalist#ravia-raumnamen option').count();
  expect('24 Standardbezeichnungen', vorschlaege, 24);
  await feld.fill('Bad');
  await p.waitForTimeout(300);
  const nachBad = await p.evaluate((id) => {
    const r = window.__ravia.getState().doc.rooms[id];
    return { name: r.name, usage: r.usage };
  }, raum);
  expect('Name aus der Liste übernommen', nachBad.name, 'Bad');
  expect('… und die Nutzung gleich mit', nachBad.usage, 'bath');
  await feld.fill('Bad Eltern');
  await p.waitForTimeout(300);
  const frei = await p.evaluate((id) => window.__ravia.getState().doc.rooms[id].usage, raum);
  expect('Freier Name ändert die Nutzung nicht', frei, 'bath');
  // Ein Schritt in der Rückgängig-Kette: Strg+Z nimmt Name und Nutzung zusammen zurück.
}

// ===========================================================================
console.log('\n▸ 4 · Heizsymbol am Raumstempel');
// ===========================================================================
{
  const ziel = await p.evaluate(() => {
    const st = window.__ravia.getState();
    st.setSelection(null);
    const r = Object.values(st.doc.rooms).find((x) => x.name.startsWith('Wohnen'));
    const c = document.querySelector('main canvas');
    const cx = (r.centroid.x - st.viewport.center.x) * st.viewport.zoom + c.clientWidth / 2;
    const cy = c.clientHeight / 2 - (r.centroid.y - st.viewport.center.y) * st.viewport.zoom;
    const m = document.createElement('canvas').getContext('2d');
    m.font = '500 12px Inter, system-ui, sans-serif';
    const breite = m.measureText(r.name).width + 15;
    // Voller Stempel (Zoom ≥ 34, drei Zeilen): Namenszeile 9 px über der Mitte.
    return { id: r.id, beheizt: r.isHeated, x: cx - breite / 2 + 5.5, y: cy - 9 };
  });
  expect('Wohnen ist beheizt', ziel.beheizt, true);
  await p.locator('main canvas').first().click({ position: { x: ziel.x, y: ziel.y } });
  await p.waitForTimeout(300);
  expect('Ein Tipp auf das Symbol: unbeheizt',
    await p.evaluate((id) => window.__ravia.getState().doc.rooms[id].isHeated, ziel.id), false);
  await p.locator('main canvas').first().screenshot({ path: './screenshots/ring-2-heizsymbol.png' });
  await p.locator('main canvas').first().click({ position: { x: ziel.x, y: ziel.y } });
  await p.waitForTimeout(300);
  expect('Noch ein Tipp: wieder beheizt',
    await p.evaluate((id) => window.__ravia.getState().doc.rooms[id].isHeated, ziel.id), true);
  await p.keyboard.press('Control+z');
  await p.waitForTimeout(300);
  expect('Strg+Z nimmt den letzten Wechsel zurück',
    await p.evaluate((id) => window.__ravia.getState().doc.rooms[id].isHeated, ziel.id), false);
}

console.log('\n▸ 5 · Nichts in der Konsole');
expect('Keine Fehler im Browser', errs.slice(0, 3), []);

await b.close();
console.log(failures ? `\n✗ ${failures} Prüfung(en) fehlgeschlagen` : '\n✓ Ring: alles in Ordnung');
process.exit(failures ? 1 : 0);
