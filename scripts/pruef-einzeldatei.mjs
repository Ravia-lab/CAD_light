/**
 * Rauchtest der Einzeldatei.
 *
 * Die Einzeldatei ist die Fassung, die weitergegeben wird — auf USB-Stick, per
 * E-Mail, auf einen Rechner ohne Node.js. Sie wird aus derselben Quelle gebaut
 * wie der normale Stand, aber über einen anderen Weg (ein Bündel statt
 * mehrerer, eingebettet statt verlinkt). Genau dort ist schon dreimal etwas
 * gebrochen, was im Entwicklungsstand lief: blockierte Module aus `file://`,
 * ein Skript, das vor seinem Wurzelelement lief, und eine Ersetzung, die
 * minifizierten Code zerschossen hat.
 *
 * Deshalb wird sie geöffnet wie ein Anwender sie öffnet: aus dem Dateisystem,
 * ohne Server, ohne Netz. Ein Verweis ins Netz gilt hier als Fehler.
 */
import { chromium } from 'playwright';

const url = 'file:///home/claude/ravia-cad-light/dist-einzeldatei/RaVia-CAD-Light.html';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
const fehler = [];
const extern = [];
page.on('console', (m) => {
  if (m.type() === 'error') fehler.push(m.text());
});
page.on('pageerror', (e) => fehler.push(String(e)));
page.on('request', (r) => {
  if (!r.url().startsWith('file:') && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) {
    extern.push(r.url());
  }
});
await page.addInitScript(() => {
  localStorage.setItem('ravia-ui-mode', 'profi');
  localStorage.setItem('ravia-einfuehrung', '1');
});
await page.goto(url, { waitUntil: 'load', timeout: 90000 });
await page.waitForSelector('canvas', { timeout: 30000 });

const status = ((await page.locator('text=Wände').first().textContent()) ?? '').trim();
console.log('Statuszeile   :', status.slice(0, 80));

// Anlagenblatt: die Auslegung rechnet im Bündel genauso wie im Entwicklungsstand?
const aside = page.locator('aside');
await aside.getByRole('button', { name: 'Anlage', exact: true }).click();
await page.waitForTimeout(1200);
const blatt = await aside.innerText();
const anlage = /Heizlast/.test(blatt) && /überschlägig/.test(blatt);
console.log('Anlagenblatt  :', anlage ? 'rechnet' : `FEHLT (${blatt.slice(0, 60)})`);

// 3D: der Viewer wird in dieser Fassung mitgeladen statt nachgeladen.
await page.getByRole('button', { name: '3D', exact: true }).first().click();
await page.waitForTimeout(3000);
const dreid = await page.locator('canvas').count();
console.log('Ansichten     :', dreid, 'Zeichenflächen');

console.log('Netzzugriffe  :', extern.length ? extern.join(' | ') : 'keine');
console.log('Fehler        :', fehler.length ? fehler.join(' | ') : 'keine');
await browser.close();

const ok = fehler.length === 0 && extern.length === 0 && anlage && dreid > 0;
console.log(ok ? '\n✓ RAUCHTEST BESTANDEN\n' : '\n✗ RAUCHTEST GESCHEITERT\n');
process.exit(ok ? 0 : 1);
