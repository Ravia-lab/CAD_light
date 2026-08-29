/**
 * Rauchtest der Einbettungs-Schnittstelle.
 *
 * Geprüft wird beides: der direkte Weg über `window.RaViaCAD` und die
 * Nachrichtenbrücke aus einem umgebenden Fenster — also genau der Weg, den
 * RaVia gehen würde.
 */
import { chromium } from 'playwright';

const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const p = await b.newPage({ viewport: { width: 1680, height: 980 }, deviceScaleFactor: 2 });
const errs = [];
p.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
p.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('Failed to load resource')) errs.push(m.text());
});

let failures = 0;
const expect = (label, actual, want) => {
  const ok = JSON.stringify(actual) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`  ${ok ? '✓' : '✗'} ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (erwartet ${JSON.stringify(want)})`}`);
};

console.log('\n▸ Direkter Zugriff (window.RaViaCAD)');
{
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

  const api = await p.evaluate(() => ({
    present: typeof window.RaViaCAD === 'object',
    version: window.RaViaCAD?.version,
    methods: Object.keys(window.RaViaCAD ?? {}).sort(),
  }));
  expect('Schnittstelle vorhanden', api.present, true);
  // 1.1.0: der Rückweg ist dazugekommen, die lesenden Befehle sind
  // unverändert geblieben.
  expect('Version gemeldet', api.version, '1.1.0');
  expect(
    'Alle Methoden da',
    api.methods,
    [
      'applyPatch', 'getDocument', 'getExport', 'getIfc', 'getSummary', 'getWritableFields',
      'loadIfc', 'loadProject', 'onChange', 'validate', 'version',
    ],
  );

  const summary = await p.evaluate(() => window.RaViaCAD.getSummary());
  expect('Kurzfassung mit Räumen', summary.rooms > 0, true);
  expect('Nutzfläche > 0', summary.netFloorArea > 0, true);
  expect('Rechenfähig', summary.ready, true);
  console.log(`    ${summary.projectName}: ${summary.rooms} Räume · ${summary.netFloorArea} m² · ${summary.installedHeatingPower} W`);

  const shapes = await p.evaluate(() => {
    const ex = window.RaViaCAD.getExport();
    const ifc = window.RaViaCAD.getIfc();
    const rep = window.RaViaCAD.validate();
    return {
      schema: ex.schema,
      rooms: ex.rooms.length,
      ifcHead: ifc.slice(0, 12),
      ready: rep.ready,
      docWalls: Object.keys(window.RaViaCAD.getDocument().walls).length,
    };
  });
  expect('Export liefert das Schema', shapes.schema, 'ravia.bim.light');
  expect('Export enthält Räume', shapes.rooms > 0, true);
  expect('IFC ist STEP', shapes.ifcHead, 'ISO-10303-21');
  expect('Prüfbericht rechenfähig', shapes.ready, true);
  expect('Rohdokument erreichbar', shapes.docWalls > 0, true);

  // Änderungsereignis: entprellt, deshalb warten wir kurz.
  const changed = await p.evaluate(async () => {
    const seen = [];
    const off = window.RaViaCAD.onChange((s) => seen.push(s.projectName));
    window.__ravia.getState().updateMeta({ name: 'Über die API umbenannt' });
    await new Promise((r) => setTimeout(r, 700));
    off();
    // Nach dem Abmelden darf nichts mehr kommen.
    window.__ravia.getState().updateMeta({ name: 'Danach' });
    await new Promise((r) => setTimeout(r, 700));
    return seen;
  });
  expect('Änderung gemeldet', changed.length, 1);
  expect('Mit neuem Namen', changed[0], 'Über die API umbenannt');
}

console.log('\n▸ Nachrichtenbrücke (postMessage aus dem umgebenden Fenster)');
{
  // Die Sitzungssicherung aus dem ersten Abschnitt würde im eingebetteten
  // Editor die Rückfrage „Letzten Stand fortsetzen?" auslösen — dann stünde
  // dort ein leeres Modell. Für den Test wird sie vorher geleert.
  await p.evaluate(() => localStorage.clear());
  await p.goto('http://localhost:4177/einbettung-beispiel.html', { waitUntil: 'networkidle' });
  await p.waitForTimeout(2500);

  const status = await p.locator('#status').innerText();
  expect('Verbindung steht', status, 'verbunden');
  expect('Version angezeigt', await p.locator('#version').innerText(), '1.1.0');

  const panel = await p.locator('#summary').innerText();
  expect('Kurzfassung angekommen', /Räume/.test(panel), true);
  expect('Rechenfähig gemeldet', /ja/.test(panel), true);

  await p.getByRole('button', { name: 'RaVia-JSON' }).click();
  await p.waitForTimeout(1200);
  const jsonOut = await p.locator('#out').innerText();
  expect('Export über postMessage', /ravia\.bim\.light/.test(jsonOut), true);

  await p.getByRole('button', { name: 'IFC4' }).click();
  await p.waitForTimeout(1200);
  expect('IFC über postMessage', (await p.locator('#out').innerText()).startsWith('ISO-10303-21'), true);

  await p.getByRole('button', { name: 'Prüfbericht' }).click();
  await p.waitForTimeout(900);
  expect('Prüfbericht über postMessage', /"ready"/.test(await p.locator('#out').innerText()), true);

  await p.screenshot({ path: './screenshots/embed-1-iframe.png' });

  // Änderung im Editor muss das umgebende Fenster erreichen.
  const before = await p.locator('#summary').innerText();
  await p.frameLocator('#cad').locator('canvas').first().waitFor();
  await p.evaluate(() => {
    const cad = document.getElementById('cad').contentWindow;
    cad.__ravia.getState().updateMeta({ name: 'Von außen beobachtet' });
  });
  await p.waitForTimeout(1200);
  const after = await p.locator('#summary').innerText();
  expect('Änderung wurde durchgereicht', after !== before && /Von außen beobachtet/.test(after), true);

  // Unbekannte Befehle dürfen nicht stillschweigend verschluckt werden.
  const unknown = await p.evaluate(async () => {
    const cad = document.getElementById('cad').contentWindow;
    return new Promise((resolve) => {
      const h = (e) => {
        if (e.data?.channel === 'ravia-cad' && e.data.type === 'error') {
          window.removeEventListener('message', h);
          resolve(e.data.payload.message);
        }
      };
      window.addEventListener('message', h);
      cad.postMessage({ channel: 'ravia-cad', type: 'quatsch', id: 99 }, '*');
      setTimeout(() => resolve('keine Antwort'), 3000);
    });
  });
  expect('Unbekannter Befehl wird beantwortet', /Unbekannter Befehl/.test(unknown), true);

  // Fremde Nachrichten ohne unseren Kanal müssen ignoriert werden.
  const foreign = await p.evaluate(async () => {
    const cad = document.getElementById('cad').contentWindow;
    let answered = false;
    const h = (e) => {
      if (e.data?.channel === 'ravia-cad') answered = true;
    };
    window.addEventListener('message', h);
    cad.postMessage({ type: 'getExport', id: 1 }, '*');
    cad.postMessage('hallo', '*');
    await new Promise((r) => setTimeout(r, 800));
    window.removeEventListener('message', h);
    return answered;
  });
  expect('Fremde Nachrichten ignoriert', foreign, false);
}

console.log('\n▸ Schreibweg (applyPatch über postMessage)');
{
  /** Ein Befehl an den eingebetteten Editor — genau so, wie RaVia ihn schickt. */
  const befehl = (type, payload) =>
    p.evaluate(
      ({ type, payload }) =>
        new Promise((resolve) => {
          const cad = document.getElementById('cad').contentWindow;
          const id = Math.floor(Math.random() * 1e9);
          const h = (e) => {
            if (e.data?.channel !== 'ravia-cad' || e.data.id !== id) return;
            window.removeEventListener('message', h);
            resolve({ type: e.data.type, payload: e.data.payload });
          };
          window.addEventListener('message', h);
          cad.postMessage({ channel: 'ravia-cad', type, id, payload }, '*');
          setTimeout(() => resolve({ type: 'keine Antwort', payload: null }), 5000);
        }),
      { type, payload },
    );

  // Ziel des Schreibvorgangs ist der erste Raum des Modells. Der neue Wert
  // muss vom heutigen abweichen, sonst wäre „übernommen" nicht von
  // „unverändert" zu unterscheiden — und die Prüfung könnte nicht scheitern.
  const raum = await p.evaluate(() => {
    const cad = document.getElementById('cad').contentWindow;
    const r = Object.values(cad.__ravia.getState().doc.rooms)[0];
    return { id: r.id, soll: r.setpointTemperature };
  });
  const neu = raum.soll === 22 ? 23 : 22;

  // Ein gültiger und ein geschützter Wert in einem Vorgang: der Tippfehler
  // darf den gültigen Wert nicht mitreißen.
  const antwort = await befehl('applyPatch', {
    source: 'Rauchtest',
    rooms: [
      { id: raum.id, setpointTemperature: neu },
      { id: raum.id, area: 42 },
    ],
  });
  expect('Antwort heißt patchApplied', antwort.type, 'patchApplied');
  expect('Der gültige Wert wurde übernommen', antwort.payload.applied, 1);
  expect('Der Geometriewert wurde abgelehnt', antwort.payload.rejected, 1);
  expect('Und der Vorgang gilt als nicht getragen', antwort.payload.ok, false);
  const ablehnung = antwort.payload.entries.find((e) => e.verdict === 'abgelehnt');
  expect('Die Ablehnung erklärt die Aufgabenteilung', /Geometrie/.test(ablehnung?.reason ?? ''), true);

  const wirkung = await p.evaluate((id) => {
    const doc = document.getElementById('cad').contentWindow.__ravia.getState().doc;
    return { soll: doc.rooms[id]?.setpointTemperature, spur: doc.meta.lastHostPatch?.source ?? 'fehlt' };
  }, raum.id);
  expect('Das Modell trägt den neuen Wert', wirkung.soll, neu);
  expect('Und die Spur nennt den Absender', wirkung.spur, 'Rauchtest');

  // Strg+Z — die Bedingung dafür, dass ein zweites Programm überhaupt
  // schreiben darf: der Mensch am Bildschirm behält das letzte Wort.
  await p.locator('#cad').focus();
  await p.keyboard.press('Control+z');
  await p.waitForTimeout(500);
  const zurueck = await p.evaluate(
    (id) => document.getElementById('cad').contentWindow.__ravia.getState().doc.rooms[id]?.setpointTemperature,
    raum.id,
  );
  expect('Strg+Z nimmt den Schreibvorgang zurück', zurueck, raum.soll);

  const felder = await befehl('getWritableFields');
  expect('Antwort heißt writableFields', felder.type, 'writableFields');
  expect(
    'Die Selbstauskunft nennt die Solltemperatur mit Bereich',
    (felder.payload ?? []).some((f) => f.path === 'rooms[].setpointTemperature' && Array.isArray(f.range)),
    true,
  );
  expect(
    'Und führt kein Geometriefeld',
    (felder.payload ?? []).some((f) => /\.(area|polygon|height|name)$/.test(f.path)),
    false,
  );

  // Der Bericht auf der Wirtsseite — der sichtbare Teil des Schreibwegs.
  await p.getByRole('button', { name: 'Fläche schreiben' }).click();
  await p.waitForTimeout(900);
  expect('Die Wirtsseite zeigt die Begründung', /Geometrie/.test(await p.locator('#report').innerText()), true);
  await p.screenshot({ path: './screenshots/embed-2-schreibweg.png' });
}

console.log('\n▸ Laden über die Schnittstelle');
{
  const loaded = await p.evaluate(async () => {
    const cad = document.getElementById('cad').contentWindow;
    const ex = cad.RaViaCAD.getExport();
    const before = cad.RaViaCAD.getSummary().rooms;
    // Erst leeren, dann denselben Stand über die Schnittstelle zurückladen.
    cad.__ravia.getState().clearAll();
    const empty = cad.RaViaCAD.getSummary().rooms;
    const res = cad.RaViaCAD.loadProject(ex);
    return { before, empty, ok: res.ok, after: cad.RaViaCAD.getSummary().rooms };
  });
  expect('Vorher Räume da', loaded.before > 0, true);
  expect('Nach dem Leeren keine', loaded.empty, 0);
  expect('Laden gemeldet', loaded.ok, true);
  expect('Räume wieder da', loaded.after, loaded.before);
}

console.log('\nERRORS:', errs.length ? errs.join('\n') : 'keine');
if (errs.length) failures += errs.length;
console.log(`\n${failures === 0 ? '✓ RAUCHTEST BESTANDEN' : `✗ ${failures} FEHLER`}\n`);
await b.close();
process.exit(failures === 0 ? 0 : 1);
