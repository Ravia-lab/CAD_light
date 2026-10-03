import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1.5 });
await p.addInitScript(() => { localStorage.setItem('ravia-ui-mode','profi'); localStorage.setItem('ravia-einfuehrung','1'); });
await p.goto('http://localhost:4177/', { waitUntil: 'networkidle' });
await p.waitForFunction(() => typeof window.__ravia !== 'undefined', null, { timeout: 30000 });
await p.evaluate(() => window.__ravia.getState().loadDemo());
await p.waitForTimeout(800);
for (const mode of ['neubau', 'sanierung']) {
  const r = await p.evaluate((m) => {
    const s = window.__ravia.getState();
    const res = s.legeRohrnetzAus(m);
    return { served: res.served, route: res.routeLength, pipe: res.pipeLength, arm: res.accessories.length,
             runs: res.runs.length, notes: res.notes.map((n) => n.severity + ': ' + n.text.slice(0, 110)) };
  }, mode);
  console.log(mode, JSON.stringify(r, null, 1).slice(0, 900));
  await p.waitForTimeout(700);
  await p.screenshot({ path: `/tmp/rohr-2d-${mode}.png` });
}
await p.evaluate(() => window.__ravia.getState().setViewMode('3d'));
await p.waitForTimeout(2500);
await p.screenshot({ path: '/tmp/rohr-3d.png' });
await b.close();
