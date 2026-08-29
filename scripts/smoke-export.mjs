/**
 * Prüft den Export im echten Browser: Schema, Vollständigkeit der
 * Hüllflächen, Nachbarschaften — und den Roundtrip über Speichern/Öffnen.
 */
import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const p = await b.newPage({ viewport: { width: 1600, height: 950 }, deviceScaleFactor: 2 });
const errs = [];
p.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
p.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('Failed to load resource')) errs.push(m.text());
});
// Die Rauchtests prüfen Fachplaner-Funktionen; der Auslieferungszustand ist
// bewusst der einfache Modus. Also vorher umschalten.
// Die Einführung beim allerersten Start würde jeden Klick abfangen. Sie
// gehört zur Anwendung und wird an genau einer Stelle geprüft
// (`smoke:ux`); überall sonst wird sie als „schon gesehen" markiert.
await p.addInitScript(() => {
  localStorage.setItem('ravia-ui-mode', 'profi');
  localStorage.setItem('ravia-einfuehrung', '1');
});


await p.goto('http://localhost:4177/', { waitUntil: 'networkidle' });
await p.waitForTimeout(1200);

// Prüf-Tab ansehen
await p.getByRole('button', { name: 'Prüfung', exact: true }).click();
await p.waitForTimeout(400);
await p.screenshot({ path: './screenshots/exp-1-validation.png' });

// Raum auswählen, um die neuen Bauphysik-Felder zu zeigen
await p.getByRole('button', { name: 'Ebenen', exact: true }).click();
await p.waitForTimeout(300);
await p.getByRole('button', { name: /Wohnen/ }).first().click();
await p.waitForTimeout(500);
await p.screenshot({ path: './screenshots/exp-2-room-physics.png' });

// Export abgreifen
const [download] = await Promise.all([
  p.waitForEvent('download'),
  p.getByRole('button', { name: 'RaVia JSON' }).click(),
]);
const path = await download.path();
const json = JSON.parse(await fs.readFile(path, 'utf8'));

const room = json.rooms[0];
console.log('Schema     :', json.schema, json.version);
console.log('Räume      :', json.rooms.length);
console.log(
  'Prüfung    :',
  JSON.stringify({
    errors: json.validation.errors,
    warnings: json.validation.warnings,
    infos: json.validation.infos,
    ready: json.validation.ready,
  }),
);
console.log('Raum 1     :', room.name, '|', room.area, 'm² |', room.surfaces.length, 'Hüllbauteile');
console.log(
  'Bauteile   :',
  room.surfaces.map((s) => `${s.kind}/${s.boundary}@${s.neighbourTemperature}`).join('  '),
);
console.log('Erdkontakt :', room.groundContactPerimeter, 'm | B′', room.characteristicGroundDimension);
console.log('Lüftung    :', room.minimumAirflow, 'm³/h | Fassaden', room.exposedFacadeCount);
console.log('TGA        :', room.fixtures.length, 'Objekte |', room.installedHeatingPower, 'W');

const hasFloor = json.rooms.every((r) => r.surfaces.some((s) => s.kind === 'floor'));
const hasCeiling = json.rooms.every((r) => r.surfaces.some((s) => s.kind === 'ceiling'));
const adjacency = json.rooms.flatMap((r) => r.surfaces).filter((s) => s.boundary === 'adjacent-room').length;
const missingTemp = json.rooms
  .flatMap((r) => r.surfaces)
  .filter((s) => typeof s.neighbourTemperature !== 'number').length;
console.log(
  'CHECK      : Boden je Raum',
  hasFloor,
  '| Decke je Raum',
  hasCeiling,
  '| Nachbarbauteile',
  adjacency,
  '| ohne Nachbartemperatur',
  missingTemp,
);

// Roundtrip: Datei wieder einlesen
await fs.copyFile(path, '/tmp/roundtrip.json');
await p.setInputFiles('input[type=file][accept*="json"]', '/tmp/roundtrip.json');
await p.waitForTimeout(1500);
console.log('Roundtrip  :', (await p.locator('footer').innerText()).replace(/\n/g, ' | '));
await p.screenshot({ path: './screenshots/exp-3-roundtrip.png' });

console.log('ERRORS     :', errs.length ? errs.join('\n') : 'keine');
await b.close();
