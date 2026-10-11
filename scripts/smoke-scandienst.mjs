/**
 * Browser-Test: „Mit RaVia Scan scannen" — QR-Code, Abfrage, Rücksprung.
 * ---------------------------------------------------------------------------
 * Der Scan-Dienst ist hier nachgebaut (`page.route` auf `scan-dienst/`), mit
 * genau dem Vertrag aus dem Auftrag an RaVia. Geprüft wird der Weg des
 * Anwenders, nicht die Bibliothek (die prüft `pruefungen/scandienst.ts`):
 *
 *  A · Schreibtisch: Knopf im Reiter „Referenz" → QR-Code. Der QR-Code wird
 *      **fotografiert und gelesen** (OpenCV) — er muss den Kopplungslink
 *      ergeben, nicht nur nach QR-Code aussehen. Dann koppelt das „iPhone",
 *      der Scan geht ein, der Dialog fragt „ersetzen oder dazulegen", und
 *      nach „Ersetzen" stehen die 40 Wände des Beispielscans im Plan.
 *  B · iPhone, Rücksprung aus der App: Die Seite öffnet mit `?scan=…`, das
 *      Lesetoken liegt im Speicher, der Scan ist schon da. Er wird ohne
 *      weiteren Handgriff geladen, und `?scan=` verschwindet aus der Adresse.
 *  C · iPhone, Start: statt des QR-Codes „In RaVia Scan öffnen"; der Knopf
 *      schreibt `?scan=` in die Adresse (damit B greift) und meldet nach
 *      2,5 s, wenn die App nicht aufging.
 *  D · Dienst fehlt (404 als Seite): ein Satz, der sagt, was stattdessen geht.
 *
 * Der QR-Weg ist seit TD-32 standardmäßig aus. Für diesen Test die Anwendung
 * mit `VITE_SCAN_DIENST=1` bauen, sonst fehlt der Knopf „scan-starten".
 */
import { chromium, devices } from 'playwright';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const BASIS = process.env.RAVIA_PROBE ?? 'http://localhost:4177/';
const LINK = 'https://test.ravia-tech.de/scan/p/K7QX-M2PA-9RTF';
const GEBAEUDE = JSON.parse(readFileSync('./public/beispiele/lidar-scan-beispiel.json', 'utf8'));

let fehler = 0;
const pruefe = (name, ist, soll) => {
  const ok = typeof soll === 'number' ? ist === soll : typeof soll === 'boolean' ? ist === soll : String(ist).includes(soll);
  const kurz = String(ist).length > 70 ? String(ist).slice(0, 67) + '…' : String(ist);
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `  (erwartet ${soll}, erhalten ${kurz})`}`);
  if (!ok) fehler++;
};

/** Der nachgebaute Dienst. `stand` schaltet der Test weiter. */
function dienst(sitzungId, anfangsStand) {
  const d = { stand: anfangsStand, aufrufe: [], fehlt: false };
  d.handler = async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const pfad = url.pathname.replace(/^.*scan-dienst\//, '');
    d.aufrufe.push({ methode: req.method(), pfad, token: req.headers()['x-scan-read-token'] ?? null, cookie: req.headers()['cookie'] ?? null });
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (d.fehlt) return route.fulfill({ status: 404, contentType: 'text/html', body: '<html><body>404 Not Found</body></html>' });
    if (req.method() === 'POST' && pfad === 'sessions') {
      return json(201, { id: sitzungId, status: 'offen', pairingCode: 'K7QX-M2PA-9RTF', pairingUrl: LINK, readToken: 'tok-smoke', expiresAt: '2099-01-01T00:00:00Z' });
    }
    if (req.headers()['x-scan-read-token'] !== 'tok-smoke') return json(401, { error: 'bad_token', message: 'falsches Token' });
    if (req.method() === 'GET' && pfad === `sessions/${sitzungId}`) return json(200, { id: sitzungId, status: d.stand });
    if (req.method() === 'GET' && pfad === `sessions/${sitzungId}/building`) return json(200, { captureId: 'c-1', building: GEBAEUDE });
    if (req.method() === 'POST' && pfad === `sessions/${sitzungId}/consume`) {
      d.stand = 'uebernommen';
      return json(200, { id: sitzungId, status: 'uebernommen' });
    }
    if (req.method() === 'DELETE' && pfad === `sessions/${sitzungId}`) {
      d.stand = 'abgebrochen';
      return json(200, { id: sitzungId, status: 'abgebrochen' });
    }
    return json(404, { error: 'unknown_session', message: 'unbekannt' });
  };
  return d;
}

const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});

const fehlerListe = [];
const beobachten = (p) => {
  p.on('pageerror', (e) => fehlerListe.push('PAGEERROR: ' + e.message));
  p.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('Failed to load resource')) fehlerListe.push(m.text());
  });
};
// Aus dem Zustand, nicht aus der Statuszeile: Am Telefon steht nach einem
// Scan die Prüfansicht, und die hat keine.
const wandzahl = (p) => p.evaluate(() => Object.keys(window.__ravia.getState().doc.walls).length);

// =============================================================================
console.log('\nA · Schreibtisch: QR-Code, koppeln, Scan geht ein, ersetzen');
{
  const ctx = await b.newContext({ viewport: { width: 1500, height: 920 } });
  await ctx.addInitScript(() => {
    localStorage.setItem('ravia-ui-mode', 'profi');
    localStorage.setItem('ravia-einfuehrung', '1');
  });
  const p = await ctx.newPage();
  beobachten(p);
  const d = dienst('s-smoke-a', 'offen');
  await p.route('**/scan-dienst/**', d.handler);
  await p.goto(BASIS, { waitUntil: 'networkidle' });
  await p.waitForTimeout(600);
  const vorher = await wandzahl(p);
  pruefe('Beispielgrundriss liegt (Wände > 0)', vorher > 0, true);

  await p.locator('aside').getByRole('button', { name: 'Referenz', exact: true }).click();
  await p.locator('[data-pruef="scan-starten"]').click();
  await p.locator('[data-pruef="scan-qr"]').waitFor({ timeout: 5000 });
  pruefe('Dialog offen', await p.locator('[data-pruef="scan-dialog"]').isVisible(), true);
  pruefe('Kopplungscode steht da', await p.locator('[data-pruef="scan-code"]').innerText(), 'K7QX-M2PA-9RTF');
  pruefe('Text sagt, was zu tun ist', await p.locator('[data-pruef="scan-status"]').innerText(), 'QR-Code mit der Kamera');
  pruefe('Am Schreibtisch kein „In RaVia Scan öffnen"', await p.locator('[data-pruef="scan-app-oeffnen"]').count(), 0);

  // Den QR-Code lesen wie eine Kamera.
  const ordner = mkdtempSync(join(tmpdir(), 'qr-'));
  const bild = join(ordner, 'qr.png');
  writeFileSync(bild, await p.locator('[data-pruef="scan-qr"]').screenshot());
  let gelesen = '';
  try {
    gelesen = execFileSync('python3', ['-c', 'import cv2,sys;print(cv2.QRCodeDetector().detectAndDecode(cv2.imread(sys.argv[1]))[0])', bild], { encoding: 'utf8' }).trim();
  } catch (e) {
    gelesen = 'Lesefehler: ' + e.message;
  }
  pruefe('QR-Code ergibt den Kopplungslink', gelesen, LINK);
  pruefe('… und nichts sonst', gelesen === LINK, true);

  d.stand = 'gekoppelt';
  await p.waitForFunction(() => document.querySelector('[data-pruef="scan-status"]')?.textContent?.includes('Verbunden'), null, { timeout: 6000 }).catch(() => {});
  pruefe('Kopplung wird angezeigt', await p.locator('[data-pruef="scan-status"]').innerText(), 'Verbunden');

  d.stand = 'eingegangen';
  await p.locator('[data-pruef="scan-frage"]').waitFor({ timeout: 6000 });
  pruefe('Kurzfassung vor der Frage', await p.locator('[data-pruef="scan-kurz"]').innerText(), '39 Wände · 10 Fenster · 5 Türen · 4 Heizkörper');
  await p.locator('[data-pruef="scan-ersetzen"]').click();
  await p.locator('[data-pruef="scan-schliessen"]').waitFor({ timeout: 6000 });
  pruefe('Fertig gemeldet', await p.locator('[data-pruef="scan-status"]').innerText(), 'Fertig');
  pruefe('40 Wände im Plan (39 + eine am T-Stoß geteilte)', await wandzahl(p), 40);
  pruefe('Übernahme an den Dienst gemeldet', d.aufrufe.some((a) => a.methode === 'POST' && a.pfad.endsWith('/consume')), true);
  pruefe('Jede Abfrage trug das Lesetoken', d.aufrufe.filter((a) => a.pfad !== 'sessions').every((a) => a.token === 'tok-smoke'), true);
  pruefe('Keine Cookies an den Dienst', d.aufrufe.every((a) => !a.cookie), true);
  const gemerkt = await p.evaluate(() => localStorage.getItem('ravia-cad-scan:s-smoke-a'));
  pruefe('Token nach Übernahme vergessen', gemerkt === null, true);
  await p.locator('[data-pruef="scan-schliessen"]').click();
  pruefe('Dialog zu', await p.locator('[data-pruef="scan-dialog"]').count(), 0);
  // Rückgängig holt den Beispielgrundriss zurück — mit der Taste, wie der Anwender.
  await p.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await p.keyboard.press('Control+z');
  await p.waitForTimeout(400);
  pruefe('Strg+Z nimmt den Scan zurück', await wandzahl(p), vorher);
  await ctx.close();
}

// =============================================================================
console.log('\nB · iPhone: Rücksprung aus der App mit ?scan=');
{
  const ctx = await b.newContext({ ...devices['iPhone 13'] });
  await ctx.addInitScript(() => {
    localStorage.setItem('ravia-einfuehrung', '1');
    localStorage.setItem(
      'ravia-cad-scan:s-smoke-b',
      JSON.stringify({ token: 'tok-smoke', code: 'K7QX-M2PA-9RTF', link: 'https://test.ravia-tech.de/scan/p/K7QX-M2PA-9RTF' }),
    );
  });
  const p = await ctx.newPage();
  beobachten(p);
  const d = dienst('s-smoke-b', 'eingegangen');
  await p.route('**/scan-dienst/**', d.handler);
  await p.goto(`${BASIS}?scan=s-smoke-b`, { waitUntil: 'networkidle' });
  await p.locator('[data-pruef="scan-schliessen"]').waitFor({ timeout: 8000 }).catch(() => {});
  pruefe('Scan ohne Handgriff geladen', await p.locator('[data-pruef="scan-status"]').innerText().catch(() => ''), 'Fertig');
  pruefe('Leerer Plan: keine Rückfrage', await p.locator('[data-pruef="scan-frage"]').count(), 0);
  pruefe('?scan= aus der Adresse entfernt', p.url().includes('scan='), false);
  pruefe('Schließen-Knopf mindestens 44 px hoch', (await p.locator('[data-pruef="scan-schliessen"]').boundingBox())?.height >= 44, true);
  await p.locator('[data-pruef="scan-schliessen"]').click();
  pruefe('40 Wände im Plan', await wandzahl(p), 40);
  await ctx.close();
}

// =============================================================================
console.log('\nB2 · Rücksprung in einen fremden Browser (Token fehlt)');
{
  const ctx = await b.newContext({ ...devices['iPhone 13'] });
  await ctx.addInitScript(() => localStorage.setItem('ravia-einfuehrung', '1'));
  const p = await ctx.newPage();
  beobachten(p);
  const d = dienst('s-smoke-x', 'eingegangen');
  await p.route('**/scan-dienst/**', d.handler);
  await p.goto(`${BASIS}?scan=s-smoke-x`, { waitUntil: 'networkidle' });
  await p.locator('[data-pruef="scan-fehler"]').waitFor({ timeout: 5000 }).catch(() => {});
  pruefe('Sagt, dass dieser Browser die Sitzung nicht kennt', await p.locator('[data-pruef="scan-fehler"]').innerText().catch(() => ''), 'nicht kennt');
  pruefe('Kein Zugriff ohne Token versucht', d.aufrufe.length, 0);
  await ctx.close();
}

// =============================================================================
console.log('\nC · iPhone: „In RaVia Scan öffnen" statt QR-Code');
{
  // Erster Start auf dem Telefon: über die Einführung, den Weg des Monteurs.
  const ctx = await b.newContext({ ...devices['iPhone 13'] });
  // Den Sprung in die App abfangen: Im Testbrowser gibt es keine App, und der
  // Link selbst ist das, was geprüft werden soll.
  await ctx.addInitScript(() => {
    document.addEventListener(
      'click',
      (e) => {
        const a = e.target instanceof Element ? e.target.closest('a') : null;
        if (a && a.href.startsWith('raviascan:')) {
          window.__appLink = a.href;
          e.preventDefault();
        }
      },
      true,
    );
  });
  const p = await ctx.newPage();
  beobachten(p);
  const d = dienst('s-smoke-c', 'offen');
  await p.route('**/scan-dienst/**', d.handler);
  await p.goto(BASIS, { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: /Aufmaß vor Ort/ }).click();
  await p.locator('[data-pruef="start-scan"]').click();
  await p.locator('[data-pruef="scan-app-oeffnen"]').waitFor({ timeout: 5000 });
  pruefe('„In RaVia Scan öffnen" da', await p.locator('[data-pruef="scan-app-oeffnen"]').isVisible(), true);
  pruefe('QR-Code zunächst verborgen', await p.locator('[data-pruef="scan-qr"]').count(), 0);
  pruefe('Text für das Gerät selbst', await p.locator('[data-pruef="scan-status"]').innerText(), 'In RaVia Scan öffnen');
  await p.locator('[data-pruef="scan-app-oeffnen"]').click();
  await p.waitForTimeout(300);
  /*
   * Von Hand: Schema raviascan, Code, Host aus dem Kopplungslink, return =
   * diese Seite mit ?scan=s-smoke-c. Der Testserver ist http://localhost —
   * die App nimmt nur https auf ravia-tech.de an, also fällt return hier
   * **zu Recht** weg (Gegenprobe der Sperre im laufenden Programm).
   */
  pruefe(
    'App-Link: Code und Server, ohne Rücksprung auf localhost',
    await p.evaluate(() => window.__appLink ?? ''),
    'raviascan://pair?code=K7QX-M2PA-9RTF&host=test.ravia-tech.de',
  );
  /*
   * Gegen den Live-Server (RAVIA_PROBE, https auf ravia-tech.de) ist der
   * Rücksprung erlaubt und muss dran sein — gegen localhost darf er es nicht.
   * Beides ist dieselbe Sperre, nur von zwei Seiten gesehen.
   */
  const httpsErlaubt = /^https:\/\/(www\.|test\.)?ravia-tech\.de\//i.test(BASIS);
  const link = await p.evaluate(() => window.__appLink ?? '');
  if (httpsErlaubt) {
    pruefe('… return auf die https-Seite angehängt', link.includes('return='), true);
    pruefe('… return trägt ?scan= der Sitzung', decodeURIComponent(link.split('return=')[1] ?? ''), 'scan=s-smoke-c');
  } else {
    pruefe('… return auf http://localhost nicht angehängt', link.includes('return='), false);
  }
  pruefe('Adresse trägt ?scan= für den Rücksprung', p.url(), 'scan=s-smoke-c');
  await p.locator('[data-pruef="scan-app-fehlt"]').waitFor({ timeout: 5000 }).catch(() => {});
  pruefe('Hinweis, wenn die App nicht aufgeht', await p.locator('[data-pruef="scan-app-fehlt"]').innerText().catch(() => ''), 'TestFlight');
  const gemerkt = await p.evaluate(() => localStorage.getItem('ravia-cad-scan:s-smoke-c'));
  pruefe('Lesetoken für den Rücksprung gemerkt', gemerkt ?? '', 'tok-smoke');
  await p.locator('[data-pruef="scan-abbrechen"]').click();
  await p.waitForTimeout(300);
  pruefe('Abbrechen meldet dem Dienst DELETE', d.aufrufe.some((a) => a.methode === 'DELETE'), true);
  pruefe('Abbrechen nimmt ?scan= aus der Adresse', p.url().includes('scan='), false);
  await ctx.close();
}

// =============================================================================
console.log('\nD · Der Dienst ist auf dem Server nicht eingerichtet');
{
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.addInitScript(() => {
    localStorage.setItem('ravia-ui-mode', 'profi');
    localStorage.setItem('ravia-einfuehrung', '1');
  });
  const p = await ctx.newPage();
  beobachten(p);
  const d = dienst('s-smoke-d', 'offen');
  d.fehlt = true;
  await p.route('**/scan-dienst/**', d.handler);
  await p.goto(BASIS, { waitUntil: 'networkidle' });
  await p.locator('aside').getByRole('button', { name: 'Referenz', exact: true }).click();
  await p.locator('[data-pruef="scan-starten"]').click();
  await p.locator('[data-pruef="scan-fehler"]').waitFor({ timeout: 5000 }).catch(() => {});
  pruefe('Sagt, dass der Dienst fehlt — und was stattdessen geht', await p.locator('[data-pruef="scan-fehler"]').innerText().catch(() => ''), 'noch nicht eingerichtet');
  pruefe('Kein QR-Code ohne Sitzung', await p.locator('[data-pruef="scan-qr"]').count(), 0);
  await ctx.close();
}

pruefe('Keine Fehler in der Konsole', fehlerListe.join(' | '), '');
if (fehlerListe.length) {
  console.log(fehlerListe.join('\n'));
  fehler++;
}
await b.close();
console.log(fehler ? `\n✗ ${fehler} FEHLER` : '\n✓ RAUCHTEST BESTANDEN');
process.exit(fehler ? 1 : 0);
