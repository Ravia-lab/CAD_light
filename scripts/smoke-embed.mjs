/**
 * Rauchtest der Einbettungs-Schnittstelle.
 *
 * Geprüft wird beides: der direkte Weg über `window.RaViaCAD` und die
 * Nachrichtenbrücke aus einem umgebenden Fenster — also genau der Weg, den
 * RaVia gehen würde.
 */
import { chromium } from 'playwright';

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

  await p.goto(BASIS, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);

  const api = await p.evaluate(() => ({
    present: typeof window.RaViaCAD === 'object',
    version: window.RaViaCAD?.version,
    methods: Object.keys(window.RaViaCAD ?? {}).sort(),
  }));
  expect('Schnittstelle vorhanden', api.present, true);
  // 1.2.0: `emitters` und `hydraulics` im Export, `fixtures[]` im Rückweg.
  // Auch das ist reiner Zuwachs — kein Feld ist weggefallen, keines hat seine
  // Bedeutung geändert. Geprüft wird deshalb weiterhin, dass die Befehle von
  // 1.1.0 unverändert antworten.
  //
  // 1.1.0: der Rückweg ist dazugekommen, die lesenden Befehle sind
  // unverändert geblieben.
  // 1.3.0: `loadBuilding` (Gebäudemodell aus RaVia Scan) — reiner Zuwachs.
  expect('Version gemeldet', api.version, '1.6.0');
  expect(
    'Alle Methoden da',
    api.methods,
    [
      'applyPatch', 'getDocument', 'getExport', 'getIfc', 'getSummary', 'getWritableFields',
      'loadBuilding', 'loadIfc', 'loadProject', 'onChange', 'reportDiscardedRooms', 'validate', 'version',
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
      version: ex.version,
      // Punkt 13: die Hüllflächenbilanz, an der die Gegenstelle prüfen kann,
      // ob Boden, Decke und Dach in ihrer Rechnung angekommen sind.
      envelopeKinds: Object.keys(ex.envelope?.byKind ?? {}).sort(),
      envelopeH: ex.envelope?.total?.heatTransferCoefficient ?? 0,
      envelopeShare: ex.envelope?.shareHorizontal ?? 0,
      raeumeMitBilanz: ex.rooms.filter((r) => r.envelope && r.envelope.total).length,
    };
  });
  expect('Export liefert das Schema', shapes.schema, 'ravia.bim.light');
  expect('Export enthält Räume', shapes.rooms > 0, true);
  expect('IFC ist STEP', shapes.ifcHead, 'ISO-10303-21');
  expect('Prüfbericht rechenfähig', shapes.ready, true);
  expect('Rohdokument erreichbar', shapes.docWalls > 0, true);
  expect('Exportfassung 2.4.0', shapes.version, '2.4.0');
  expect('Hüllflächenbilanz im Export', shapes.envelopeH > 0, true);
  expect('… je Raum', shapes.raeumeMitBilanz, shapes.rooms);
  expect('… mit Boden, Decke und Wand', ['ceiling', 'floor', 'wall'].every((k) => shapes.envelopeKinds.includes(k)), true);
  expect('… und dem Anteil der waagerechten Bauteile', shapes.envelopeShare > 0, true);
  console.log(`    Hüllflächenbilanz: ${shapes.envelopeH} W/K · ${Math.round(shapes.envelopeShare * 100)} % Boden/Decke/Dach`);

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
  await p.goto(BASIS + 'einbettung-beispiel.html', { waitUntil: 'networkidle' });

  /*
   * Auf den Handschlag warten statt auf die Uhr.
   *
   * Hier stand eine feste Wartezeit von 2,5 Sekunden. Gegen die Vorschau auf
   * demselben Rechner reichte sie immer; gegen den **echten Server** fiel der
   * Abschnitt reihenweise um — der eingebettete Editor lädt dort 1,8 MB über
   * die Leitung, und ob das in 2,5 Sekunden fertig ist, entscheidet nicht das
   * Programm, sondern die Verbindung. Ein Rauchtest, der bei langsamer
   * Leitung Alarm schlägt, meldet die Leitung und nicht den Fehler.
   *
   * Gewartet wird deshalb auf das Ereignis selbst: Sobald die Brücke steht,
   * schreibt die Beispielseite „verbunden" in `#status`. Zwanzig Sekunden
   * Obergrenze — was dann nicht steht, steht nicht wegen der Leitung.
   */
  await p.locator('#status').filter({ hasText: 'verbunden' }).waitFor({ timeout: 20000 }).catch(() => {});

  const status = await p.locator('#status').innerText();
  expect('Verbindung steht', status, 'verbunden');
  expect('Version angezeigt', await p.locator('#version').innerText(), '1.6.0');

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

  /*
   * `getDocument` über die Brücke. Bis 1.5.0 gab es den Befehl nur auf
   * `window.RaViaCAD` — und das ist aus einem Rahmen heraus unerreichbar.
   * Eine eingebettete Gegenstelle bekam „Unbekannter Befehl: getDocument".
   */
  const roh = await befehl('getDocument');
  expect('Antwort heißt document', roh.type, 'document');
  expect('Das Rohdokument bringt Räume mit', Object.keys(roh.payload?.rooms ?? {}).length > 0, true);
  expect('… und Wände', Object.keys(roh.payload?.walls ?? {}).length > 0, true);

  /*
   * Die Rückmeldung der Gegenstelle: Welche Räume hat sie verworfen?
   * Geschickt wird die Antwort in RaVias eigener Form (`verworfene_raeume`,
   * deutsche Feldnamen) — so, wie sie am 23.09.2026 abgestimmt wurde.
   */
  const verworfen = await p.evaluate(async () => {
    const cad = document.getElementById('cad').contentWindow;
    const ex = cad.RaViaCAD.getExport();
    const raum = ex.rooms[ex.rooms.length - 1];
    return { id: raum.id, name: raum.name };
  });
  const gemeldet = await befehl('reportDiscardedRooms', {
    raeume_ergebnis: [],
    verworfene_raeume: [
      { id: verworfen.id, name: verworfen.name, flaeche: 0.06, grund: 'flaeche_unter_mindestgroesse', geschoss: 'EG' },
      { id: 'room-gibts-nicht', name: 'Phantom', flaeche: 0.02, grund: 'flaeche_unter_mindestgroesse' },
    ],
  });
  expect('Antwort heißt discardedRoomsReported', gemeldet.type, 'discardedRoomsReported');
  expect('Ein Hinweis wurde gesetzt', gemeldet.payload?.hinweise, 1);
  expect('Der Raum ohne Entsprechung bleibt übrig', gemeldet.payload?.ohneRaum, 1);
  const hinweisImStore = await p.evaluate((id) => {
    const s = document.getElementById('cad').contentWindow.__ravia.getState();
    return s.verworfeneRaeume[id]?.text ?? null;
  }, verworfen.id);
  expect('Der Hinweis hängt am gezeichneten Raum',
    /wurde von RaVia nicht übernommen/.test(hinweisImStore ?? ''), true);
  expect('… und nennt die Mindestgröße', /Mindestgröße von 0,10 m²/.test(hinweisImStore ?? ''), true);

  /*
   * Und das Entscheidende: Steht die Marke auch **im Plan**? Gezählt werden
   * bernsteinfarbene Bildpunkte auf der Zeichenfläche — vorher keine,
   * nachher welche. Ein Hinweis, der nur im Zustand steht, hilft niemandem.
   */
  const bernstein = () => p.evaluate(() => {
    const dok = document.getElementById('cad').contentDocument;
    const cv = dok.querySelector('canvas');
    if (!cv) return -1;
    const g = cv.getContext('2d');
    const d = g.getImageData(0, 0, cv.width, cv.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      // rgba(245,158,11) mit Toleranz — die Marke und ihr Text.
      if (Math.abs(d[i] - 245) < 25 && Math.abs(d[i + 1] - 158) < 30 && d[i + 2] < 70) n++;
    }
    return n;
  });
  await p.waitForTimeout(600);
  const punkteMitHinweis = await bernstein();
  expect('Die Marke steht im Plan', punkteMitHinweis > 20, true);

  // Ein neuer Übernahmelauf ohne Verworfene räumt die Hinweise wieder ab.
  const leer = await befehl('reportDiscardedRooms', { verworfene_raeume: [] });
  expect('Leere Meldung räumt die Hinweise ab', leer.payload?.hinweise, 0);
  const danach = await p.evaluate(() =>
    Object.keys(document.getElementById('cad').contentWindow.__ravia.getState().verworfeneRaeume).length);
  expect('Kein Hinweis bleibt stehen', danach, 0);
  await p.waitForTimeout(600);
  const punkteDanach = await bernstein();
  // Bernstein kommt auch anderswo im Plan vor (Warnfarbe der Bemaßung);
  // gemessen wird deshalb der Rückgang, nicht der Nullwert.
  console.log(`    bernsteinfarbene Punkte: mit Hinweis ${punkteMitHinweis}, danach ${punkteDanach}`);
  expect('Und die Marke ist wieder weg', punkteDanach < punkteMitHinweis, true);

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

console.log('\n▸ Gebäudescan aus RaVia Scan über die Nachrichtenbrücke (loadBuilding)');
{
  const { readFileSync } = await import('node:fs');
  const modell = JSON.parse(readFileSync(new URL('./referenz/ravia-building-beispiel.json', import.meta.url), 'utf-8'));
  const ergebnis = await p.evaluate(async (m) => {
    const cad = document.getElementById('cad').contentWindow;
    const vorher = Object.keys(cad.RaViaCAD.getDocument().walls).length;
    // Genau wie RaVia: postMessage, Antwort über die Kennung zuordnen.
    const antwort = await new Promise((resolve) => {
      const hoer = (e) => {
        if (e.data?.channel === 'ravia-cad' && e.data.id === 'scan-1') {
          window.removeEventListener('message', hoer);
          resolve(e.data);
        }
      };
      window.addEventListener('message', hoer);
      cad.postMessage({ channel: 'ravia-cad', type: 'loadBuilding', id: 'scan-1', payload: m }, '*');
    });
    const doc = cad.RaViaCAD.getDocument();
    const hk = Object.values(doc.fixtures).filter((f) => f.category === 'heating');
    const level = doc.levels[doc.activeLevelId];
    const benannt = Object.values(doc.rooms).map((r) => r.name);
    const ergebnis = {
      typ: antwort.type, ok: antwort.payload.ok, meldung: antwort.payload.message,
      vorher, waende: Object.keys(doc.walls).length, oeffnungen: Object.keys(doc.openings).length,
      raeume: Object.keys(doc.rooms).length, benannt,
      heizkoerper: hk.length, mitRaum: hk.filter((f) => !!f.roomId).length,
      typen: hk.map((f) => f.params.radiatorType).join(','),
      leistung: hk.reduce((s, f) => s + (f.params.powerW ?? 0), 0),
      dach: level?.roof ? `${level.roof.kind} ${level.roof.pitch}° KS ${level.roof.kneeHeight}` : null,
      nord: doc.meta.northAngle, geschoss: level?.name,
    };
    // Rückgängig bringt den vorigen Stand zurück.
    cad.__ravia.getState().undo();
    ergebnis.nachUndo = Object.keys(cad.RaViaCAD.getDocument().walls).length;
    cad.__ravia.getState().redo();
    // Falsches Format: klare Ablehnung, Modell bleibt.
    ergebnis.falsch = cad.RaViaCAD.loadBuilding({ format: 'ravia.capture' });
    ergebnis.nachFalsch = Object.keys(cad.RaViaCAD.getDocument().walls).length;
    return ergebnis;
  }, modell);
  console.log(`    ${ergebnis.meldung}`);
  expect('Antwort „loaded"', ergebnis.typ, 'loaded');
  expect('Übernahme gemeldet', ergebnis.ok, true);
  expect('40 Wände (39 + ein T-Stoß)', ergebnis.waende, 40);
  expect('17 Öffnungen', ergebnis.oeffnungen, 17);
  expect('Räume erkannt', ergebnis.raeume >= 7, true);
  expect('Raumnamen aus dem Scan', ergebnis.benannt.includes('Wohnen'), true);
  expect('Vier Heizkörper', ergebnis.heizkoerper, 4);
  expect('… jeder mit Raum', ergebnis.mitRaum, 4);
  expect('… mit bestätigter Bauart', ergebnis.typen, '22,33,21,11');
  expect('… ohne erfundene Leistung', ergebnis.leistung, 0);
  expect('Dach aus dem Scan', ergebnis.dach, 'gable 36.5° KS 1.19');
  expect('Nordabweichung', ergebnis.nord, 113.5);
  expect('Rückgängig stellt den vorigen Stand her', ergebnis.nachUndo, ergebnis.vorher);
  expect('Falsches Format abgelehnt', ergebnis.falsch.ok, false);
  expect('… Modell bleibt stehen', ergebnis.nachFalsch, 40);
  await p.waitForTimeout(600);
  await p.screenshot({ path: './screenshots/embed-3-gebaeudescan.png' });
}

console.log('\n▸ Zweites Geschoss dazuladen (loadBuilding mit merge)');
{
  const { readFileSync } = await import('node:fs');
  const eg = JSON.parse(readFileSync(new URL('./referenz/ravia-building-beispiel.json', import.meta.url), 'utf-8'));
  // Das Obergeschoss als eigene Aufnahme: gleicher Grundriss, 2,75 m höher.
  // So kommt es aus der App, wenn das Tracking auf der Treppe gerissen ist.
  const og = JSON.parse(JSON.stringify(eg));
  og.id = 'og-scan';
  og.levels[0].id = 'level-1';
  og.levels[0].index = 1;
  og.levels[0].name = 'OG';
  og.levels[0].elevation = 2.75;
  og.levels[0].elevationSource = 'barometer';
  for (const liste of ['walls', 'openings', 'rooms', 'emitters', 'roomHints']) {
    for (const x of og[liste] ?? []) if (x.levelId) x.levelId = 'level-1';
  }
  for (const r of og.rooms ?? []) { r.name = 'Schlafen'; r.nameSource = 'user'; r.raviaRoomId = 'og-1'; }

  const ergebnis = await p.evaluate(async ([eg, og]) => {
    const cad = document.getElementById('cad').contentWindow;
    const schick = (payload) => new Promise((resolve) => {
      const id = 'merge-' + Math.random().toString(36).slice(2);
      const hoer = (e) => {
        if (e.data?.channel === 'ravia-cad' && e.data.id === id) {
          window.removeEventListener('message', hoer);
          resolve(e.data.payload);
        }
      };
      window.addEventListener('message', hoer);
      cad.postMessage({ channel: 'ravia-cad', type: 'loadBuilding', id, payload }, '*');
    });
    const ersteAntwort = await schick(eg);
    const nachEG = Object.keys(cad.RaViaCAD.getDocument().levels).length;
    const zweiteAntwort = await schick({ building: og, merge: true });
    const doc = cad.RaViaCAD.getDocument();
    const raeume = Object.values(doc.rooms);
    const ersetzt = await schick(eg);            // ohne merge: wieder nur ein Geschoss
    return {
      ersteOk: ersteAntwort.ok, nachEG,
      zweiteOk: zweiteAntwort.ok, meldung: zweiteAntwort.message,
      geschosse: Object.values(doc.levels).map((l) => l.name).sort(),
      waendeEG: Object.values(doc.walls).filter((w) => w.levelId === 'level-0').length,
      waendeOG: Object.values(doc.walls).filter((w) => w.levelId === 'level-1').length,
      raviaIds: raeume.filter((r) => r.raviaRoomId === 'og-1').length,
      namenOG: raeume.filter((r) => r.levelId === 'level-1').map((r) => r.name),
      ersetztOk: ersetzt.ok,
      nachErsetzen: Object.keys(cad.RaViaCAD.getDocument().levels).length,
    };
  }, [eg, og]);
  console.log(`    ${ergebnis.meldung}`);
  expect('Erdgeschoss geladen', ergebnis.ersteOk && ergebnis.nachEG === 1, true);
  expect('Obergeschoss dazugeladen', ergebnis.zweiteOk, true);
  expect('Zwei Geschosse', ergebnis.geschosse, ['EG', 'OG']);
  expect('Erdgeschoss steht noch', ergebnis.waendeEG > 0, true);
  expect('Obergeschoss hat Wände', ergebnis.waendeOG > 0, true);
  expect('Raumname aus der App übernommen', ergebnis.namenOG.includes('Schlafen'), true);
  expect('RaVia-Raumkennung übernommen', ergebnis.raviaIds > 0, true);
  expect('Ohne merge wird wieder ersetzt', ergebnis.ersetztOk && ergebnis.nachErsetzen === 1, true);
}

console.log('\n▸ Zweiter Aufruf mit warmem Zwischenspeicher');
{
  /*
   * Derselbe Handschlag noch einmal — jetzt mit **warmem** Zwischenspeicher.
   *
   * Das ist kein doppelter Test, sondern ein anderer Fall. Beim ersten Aufruf
   * lädt der eingebettete Editor 1,8 MB; die Seite drumherum steht längst,
   * wenn sein Rahmen fertig meldet. Beim zweiten liegt alles im
   * Zwischenspeicher — der Rahmen ist fertig, **bevor** das Skript der
   * Beispielseite läuft, und ein `load`-Ereignis, das schon vorbei ist, kommt
   * nicht wieder. Genau daran hing der Handschlag bis 1.38.0: Die Seite
   * blieb auf „verbinde …", während jeder Knopf daneben antwortete.
   *
   * Gefunden wurde das gegen den echten Server, wo mehrere Abschnitte
   * nacheinander laufen und der Zwischenspeicher warm ist. Gegen die Vorschau
   * war nie etwas zu sehen. Deshalb steht der Fall jetzt ausdrücklich hier.
   */
  // Erst die Anwendung selbst aufrufen — damit liegt ihr Bündel im
  // Zwischenspeicher. Dann die Beispielseite: Ihr Rahmen ist sofort fertig.
  await p.goto(BASIS, { waitUntil: 'networkidle' });
  await p.goto(BASIS + 'einbettung-beispiel.html', { waitUntil: 'networkidle' });
  await p.locator('#status').filter({ hasText: 'verbunden' }).waitFor({ timeout: 20000 }).catch(() => {});
  expect('Auch mit warmem Zwischenspeicher verbunden', await p.locator('#status').innerText(), 'verbunden');
  expect('… mit Version', await p.locator('#version').innerText(), '1.6.0');
}

console.log('\nERRORS:', errs.length ? errs.join('\n') : 'keine');
if (errs.length) failures += errs.length;
console.log(`\n${failures === 0 ? '✓ RAUCHTEST BESTANDEN' : `✗ ${failures} FEHLER`}\n`);
await b.close();
process.exit(failures === 0 ? 0 : 1);
