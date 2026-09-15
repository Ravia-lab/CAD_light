import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
// iPad hochkant und quer, mit Berührung als Eingabeart
for (const [name, w, h] of [['hoch', 820, 1180], ['quer', 1180, 820]]) {
  const ctx = await b.newContext({
    viewport: { width: w, height: h }, deviceScaleFactor: 2,
    hasTouch: true, isMobile: false,
  });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 300)));
  p.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 300)); });
  await p.addInitScript(() => { localStorage.setItem('ravia-ui-mode','profi'); localStorage.setItem('ravia-einfuehrung','1'); });
  await p.goto('http://localhost:4177/Cad_light/', { waitUntil: 'networkidle' });
  await p.waitForFunction(() => typeof window.__ravia !== 'undefined', null, { timeout: 30000 });
  await p.waitForTimeout(900);
  await p.screenshot({ path: `/tmp/ipad-${name}.png` });
  console.log(name, 'aufgenommen');
  await ctx.close();
}
await b.close();
