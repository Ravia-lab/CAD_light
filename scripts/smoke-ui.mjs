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


const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 }, deviceScaleFactor: 2 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
// Die Rauchtests prüfen Fachplaner-Funktionen; der Auslieferungszustand ist
// bewusst der einfache Modus. Also vorher umschalten.
// Die Einführung beim allerersten Start würde jeden Klick abfangen. Sie
// gehört zur Anwendung und wird an genau einer Stelle geprüft
// (`smoke:ux`); überall sonst wird sie als „schon gesehen" markiert.
await page.addInitScript(() => {
  localStorage.setItem('ravia-ui-mode', 'profi');
  localStorage.setItem('ravia-einfuehrung', '1');
});


await page.goto(BASIS, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

// Statuszeile auslesen
const status = await page.locator('footer').innerText();
console.log('STATUS:', status.replace(/\n/g, ' | '));

await page.screenshot({ path: './screenshots/ui-2d.png' });

// Split-Ansicht (3D lazy laden)
await page.getByRole('button', { name: 'Split', exact: true }).click();
await page.waitForTimeout(2500);
await page.screenshot({ path: './screenshots/ui-split.png' });

// 3D voll
await page.getByRole('button', { name: '3D', exact: true }).click();
await page.waitForTimeout(2000);
await page.screenshot({ path: './screenshots/ui-3d.png', timeout: 90000 });

// Referenz-Tab + Auto-Trace ohne Bild (soll sauber bleiben)
await page.getByRole('button', { name: '2D', exact: true }).click();
await page.getByRole('button', { name: 'Referenz' }).click();
await page.waitForTimeout(400);
await page.screenshot({ path: './screenshots/ui-ref.png' });

console.log('ERRORS:', errors.length ? errors.join('\n') : 'keine');
await browser.close();
