import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1700, height: 1000 }, deviceScaleFactor: 1.5 });
await p.addInitScript(() => { localStorage.setItem('ravia-ui-mode','profi'); localStorage.setItem('ravia-einfuehrung','1'); });
await p.goto('http://localhost:4177/', { waitUntil: 'networkidle' });
await p.waitForFunction(() => typeof window.__ravia !== 'undefined', null, { timeout: 30000 });
await p.evaluate(() => window.__ravia.getState().loadDemo());
await p.waitForTimeout(800);
// Knopf in der Kopfzeile: Sanierung wählen, dann auslegen
await p.getByRole('button', { name: 'Sanierung', exact: true }).click();
await p.waitForTimeout(200);
await p.getByTitle(/Rohrnetz automatisch auslegen/).click();
await p.waitForTimeout(1500);
const info = await p.evaluate(() => {
  const d = window.__ravia.getState().doc;
  const runs = Object.values(d.pipes ?? {});
  return { runs: runs.length, arm: Object.keys(d.pipeAccessories ?? {}).length,
    status: window.__ravia.getState().statusMessage };
});
console.log(JSON.stringify(info));
await p.screenshot({ path: '/tmp/rohr-knopf.png' });
await b.close();
