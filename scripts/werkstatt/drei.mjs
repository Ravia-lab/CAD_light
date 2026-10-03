import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 1.5 });
await p.addInitScript(() => { localStorage.setItem('ravia-ui-mode','profi'); localStorage.setItem('ravia-einfuehrung','1'); });
await p.goto('http://localhost:4177/', { waitUntil: 'networkidle' });
await p.waitForFunction(() => typeof window.__ravia !== 'undefined', null, { timeout: 30000 });
await p.evaluate(() => window.__ravia.getState().loadDemo());
await p.waitForTimeout(700);
const info = await p.evaluate(() => {
  const s = window.__ravia.getState();
  s.addLevel({ copyFrom: s.doc.activeLevelId });
  const t = window.__ravia.getState();
  return { levels: Object.values(t.doc.levels).map((l) => `${l.name} @${l.elevation} h${l.height}`), walls: Object.keys(t.doc.walls).length };
});
console.log(JSON.stringify(info));
await p.waitForTimeout(900);
await p.evaluate(() => {
  const s = window.__ravia.getState();
  s.setRoof(s.doc.activeLevelId, { kind: 'gable', pitch: 38, kneeHeight: 0.8 });
  s.setViewMode('3d');
});
await p.waitForTimeout(2500);
await p.screenshot({ path: '/tmp/dach.png' });
await b.close();
