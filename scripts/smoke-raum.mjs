/**
 * Rauchtest für die Zeicheneingabe: Geländeumriss schließen, Raumvorlagen
 * aufziehen, Räume kopieren.
 *
 * Der Anlass für diesen Test war ein gemeldeter Fehler: eine
 * Grundstücksgrenze ließ sich umfahren, aber nicht abschließen — der
 * Rechtsklick, mit dem man in jedem CAD einen Zug beendet, hat sie
 * stattdessen verworfen. Alle vier Wege zum Abschluss werden deshalb hier
 * einzeln geprüft.
 */

import { chromium } from 'playwright';

const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const p = await b.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const errs = [];
p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
p.on('console', (m) => {
  if (m.type() === 'error' && !/ERR_CONNECTION_RESET/.test(m.text())) errs.push(m.text());
});

let failures = 0;
const expect = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? '✓' : '✗'} ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (erwartet ${JSON.stringify(expected)})`}`);
};
const near = (label, actual, expected, tol) => {
  const ok = Math.abs(actual - expected) <= tol;
  if (!ok) failures++;
  console.log(`  ${ok ? '✓' : '✗'} ${label}: ${actual}${ok ? '' : ` (erwartet ${expected} ± ${tol})`}`);
};

// Die Einführung beim allerersten Start würde jeden Klick abfangen. Sie
// gehört zur Anwendung und wird an genau einer Stelle geprüft
// (`smoke:ux`); überall sonst wird sie als „schon gesehen" markiert.
await p.addInitScript(() => {
  // Der Profi-Modus zeigt alle Werkzeuge; der einfache blendet einige aus.
  if (!sessionStorage.getItem('smoke-init')) {
    localStorage.clear();
    sessionStorage.setItem('smoke-init', '1');
  }
  localStorage.setItem('ravia-ui-mode', 'profi');
  localStorage.setItem('ravia-einfuehrung', '1');
});
await p.goto('http://localhost:4177/', { waitUntil: 'networkidle' });
// Auf den Store warten statt auf eine Wartezeit zu hoffen: beim ersten Start
// baut Vite seine Abhängigkeiten und lädt die Seite neu, und Klicks, die in
// diese Lücke fallen, gehen verloren.
await p.waitForFunction(() => typeof window.__ravia !== 'undefined', null, { timeout: 30000 });
await p.waitForTimeout(1200);

const canvas = p.locator('canvas').first();
const box = await canvas.boundingBox();
const reset = () => p.evaluate(() => window.__ravia.getState().clearAll());
const siteCount = () => p.evaluate(() => Object.keys(window.__ravia.getState().doc.site.elements).length);
const boundary = () =>
  p.evaluate(() => Object.values(window.__ravia.getState().doc.site.elements).find((e) => e.kind === 'boundary') ?? null);

/** Vier Ecken eines Rechtecks in Bildschirmkoordinaten. */
const corners = [
  { x: box.x + 300, y: box.y + 250 },
  { x: box.x + 900, y: box.y + 250 },
  { x: box.x + 900, y: box.y + 700 },
  { x: box.x + 300, y: box.y + 700 },
];

const armBoundary = async () => {
  await p.evaluate(() => {
    const s = window.__ravia.getState();
    s.setSiteKind('boundary');
    s.setTool('site');
  });
  await p.waitForTimeout(150);
};

console.log('\n▸ Geländeumriss — Abschluss auf dem Startpunkt');
{
  await reset();
  await armBoundary();
  for (const c of corners) {
    await p.mouse.click(c.x, c.y);
    await p.waitForTimeout(90);
  }
  // Zurück auf den Startpunkt: der Fangring greift in Bildschirmpixeln.
  await p.mouse.move(corners[0].x + 4, corners[0].y - 3);
  await p.waitForTimeout(120);
  await p.mouse.click(corners[0].x + 4, corners[0].y - 3);
  await p.waitForTimeout(400);
  const el = await boundary();
  expect('Grenze wurde angelegt', el !== null, true);
  if (el) expect('Vier Ecken, kein Duplikat am Ende', el.points.length, 4);
}

console.log('\n▸ Geländeumriss — Abschluss per Rechtsklick');
{
  await reset();
  await armBoundary();
  for (const c of corners) {
    await p.mouse.click(c.x, c.y);
    await p.waitForTimeout(90);
  }
  await p.mouse.click(corners[3].x + 60, corners[3].y, { button: 'right' });
  await p.waitForTimeout(400);
  const el = await boundary();
  expect('Rechtsklick übernimmt statt zu verwerfen', el !== null, true);
  if (el) expect('Alle vier Ecken erhalten', el.points.length, 4);
}

console.log('\n▸ Geländeumriss — Abschluss per Eingabetaste');
{
  await reset();
  await armBoundary();
  for (const c of corners) {
    await p.mouse.click(c.x, c.y);
    await p.waitForTimeout(90);
  }
  await p.keyboard.press('Enter');
  await p.waitForTimeout(400);
  expect('Enter schließt den Zug ab', await siteCount(), 1);
}

console.log('\n▸ Geländeumriss — Rücktaste nimmt den letzten Punkt zurück');
{
  await reset();
  await armBoundary();
  for (const c of corners) {
    await p.mouse.click(c.x, c.y);
    await p.waitForTimeout(90);
  }
  await p.keyboard.press('Backspace');
  await p.waitForTimeout(150);
  await p.keyboard.press('Enter');
  await p.waitForTimeout(400);
  const el = await boundary();
  expect('Nur noch drei Ecken', el ? el.points.length : 0, 3);
}

console.log('\n▸ Raumvorlagen');
{
  await reset();
  await p.keyboard.press('z');
  await p.waitForTimeout(200);
  expect('Taste Z wählt die Raumvorlage', await p.evaluate(() => window.__ravia.getState().tool), 'room');

  // Rechteck aufziehen.
  await p.mouse.move(box.x + 400, box.y + 300);
  await p.mouse.down();
  await p.mouse.move(box.x + 800, box.y + 600, { steps: 8 });
  await p.mouse.up();
  await p.waitForTimeout(500);
  const rect = await p.evaluate(() => {
    const d = window.__ravia.getState().doc;
    return { walls: Object.keys(d.walls).length, rooms: Object.keys(d.rooms).length };
  });
  expect('Vier Wände entstanden', rect.walls, 4);
  expect('Und daraus genau ein Raum', rect.rooms, 1);

  // L-Form daneben, über den Store, damit die Geometrie exakt prüfbar ist.
  await reset();
  const l = await p.evaluate(() => {
    const s = window.__ravia.getState();
    s.setRoomTemplate('l-form');
    const r = s.addRoomTemplate('l-form', { x: 0, y: 0 }, { x: 10, y: 8 }, { notchX: 0.5, notchY: 0.5 });
    const d = window.__ravia.getState().doc;
    return { created: r, walls: Object.keys(d.walls).length, rooms: Object.keys(d.rooms).length };
  });
  expect('L-Form hat sechs Wände', l.walls, 6);
  expect('Und ergibt einen Raum', l.rooms, 1);
  // 10 × 8 minus die halbe Ecke 5 × 4 = 80 − 20 = 60 m² Achsfläche.
  near('Achsfläche der L-Form', l.created.area, 60, 0.01);

  // Runde Form.
  await reset();
  const round = await p.evaluate(() => {
    const s = window.__ravia.getState();
    s.addRoomTemplate('rund', { x: 0, y: 0 }, { x: 6, y: 6 }, { segments: 12 });
    return Object.keys(window.__ravia.getState().doc.walls).length;
  });
  expect('Zwölf Segmente ergeben zwölf Wände', round, 12);
}

console.log('\n▸ Raum kopieren');
{
  await reset();
  const result = await p.evaluate(() => {
    const s = window.__ravia.getState();
    s.addRoomTemplate('rechteck', { x: 0, y: 0 }, { x: 5, y: 4 });
    const st = window.__ravia.getState();
    const room = Object.values(st.doc.rooms)[0];
    // Ein Fenster und ein Heizkörper, damit sich zeigt, dass beides mitkommt.
    const wall = st.doc.walls[room.boundaries[0].wallId];
    st.addOpening({ wallId: wall.id, kind: 'window', width: 1.2, height: 1.4, sillHeight: 0.9, distance: 1.5, uValue: 1.1 });
    window.__ravia.getState().addFixture('radiator', { x: 2.5, y: 2 });
    const before = window.__ravia.getState().doc;
    const roomId = Object.values(before.rooms)[0].id;
    const dup = window.__ravia.getState().duplicateRoom(roomId);
    const after = window.__ravia.getState().doc;
    return {
      dup,
      walls: Object.keys(after.walls).length,
      rooms: Object.keys(after.rooms).length,
      openings: Object.keys(after.openings).length,
      fixtures: Object.keys(after.fixtures).length,
    };
  });
  expect('Aus vier Wänden werden acht', result.walls, 8);
  expect('Aus einem Raum werden zwei', result.rooms, 2);
  expect('Das Fenster kommt mit', result.openings, 2);
  expect('Der Heizkörper auch', result.fixtures, 2);
}

console.log('\nERRORS:', errs.length ? errs.join('\n') : 'keine');
if (errs.length) failures += errs.length;
console.log(`\n${failures === 0 ? '✓ RAUCHTEST BESTANDEN' : `✗ ${failures} FEHLER`}\n`);
await b.close();
process.exit(failures === 0 ? 0 : 1);
