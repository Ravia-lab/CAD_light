/**
 * Prüft den Export im echten Browser: Schema, Vollständigkeit der
 * Hüllflächen, Nachbarschaften — und den Roundtrip über Speichern/Öffnen.
 */
import { chromium } from 'playwright';
import fs from 'node:fs/promises';

/**
 * Unter welcher Adresse geprüft wird.
 *
 * Vorgabe ist die Vorschau aus `vite preview`. Über `RAVIA_PROBE` lässt sich
 * stattdessen ein **echter Server** prüfen — und vor allem einer, der die
 * Anwendung unter einem **Unterpfad** ausliefert:
 *
 *     RAVIA_PROBE=http://localhost:8080/Cad_light/ node scripts/smoke-ui.mjs
 *
 * Das ist kein Beiwerk. Ein Build für einen Unterpfad schreibt andere
 * Adressen in die index.html, und ob die stimmen, zeigt sich nur, wenn man
 * genau dort prüft. Der abschließende Schrägstrich gehört dazu.
 */
const BASIS = process.env.RAVIA_PROBE ?? 'http://localhost:4177/';


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


await p.goto(BASIS, { waitUntil: 'networkidle' });
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

/*
 * Die zwei Felder aus Fassung 2.1.0 — hier im ausgelieferten Bündel, nicht
 * nur im Rechenkern.
 *
 * Der Prüflauf prüft sie am Quelltext; dass sie auch durch Bau, Bündelung
 * und den Weg über die heruntergeladene Datei kommen, sieht man erst hier.
 * `uValueSource` ist ein String und `checksum` eine Zeichenkette — beides
 * übersteht `JSON.stringify` —, aber genau solche Annahmen sind es, die
 * einmal nicht stimmen.
 */
const alleFlaechen = json.rooms.flatMap((r) => r.surfaces);
const ohneQuelle = alleFlaechen.filter((s) => !s.uValueSource).length;
const oeffnungOhneQuelle = alleFlaechen.flatMap((s) => s.openings).filter((o) => !o.uValueSource).length;
const quellen = [...new Set(alleFlaechen.map((s) => s.uValueSource))].sort().join(' ');
const summen = json.rooms.map((r) => r.checksum);
const summenForm = summen.every((c) => /^[0-9a-f]{16}$/.test(c));
const summenVerschieden = new Set(summen).size === summen.length;
console.log(
  'QUELLEN    : ohne Quelle',
  ohneQuelle,
  '| Öffnungen ohne Quelle',
  oeffnungOhneQuelle,
  '|',
  quellen,
);
console.log(
  'PRÜFSUMMEN : Form',
  summenForm,
  '| je Raum verschieden',
  summenVerschieden,
  '|',
  summen.join(' '),
);
if (ohneQuelle || oeffnungOhneQuelle) {
  errs.push(`Felder ohne uValueSource: ${ohneQuelle} Flächen, ${oeffnungOhneQuelle} Öffnungen`);
}
if (!summenForm) errs.push(`Prüfsumme hat nicht die erwartete Form: ${summen.join(' ')}`);

// Roundtrip: Datei wieder einlesen
await fs.copyFile(path, '/tmp/roundtrip.json');
await p.setInputFiles('input[type=file][accept*="json"]', '/tmp/roundtrip.json');
await p.waitForTimeout(1500);
console.log('Roundtrip  :', (await p.locator('footer').innerText()).replace(/\n/g, ' | '));
await p.screenshot({ path: './screenshots/exp-3-roundtrip.png' });

console.log('ERRORS     :', errs.length ? errs.join('\n') : 'keine');
await b.close();
