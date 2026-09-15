import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, hasTouch: true });
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0,200)));
await p.addInitScript(() => { localStorage.setItem('ravia-ui-mode','profi'); localStorage.setItem('ravia-einfuehrung','1'); });
await p.goto('http://localhost:4177/Cad_light/', { waitUntil: 'networkidle' });
await p.waitForFunction(() => typeof window.__ravia !== 'undefined', null, { timeout: 30000 });
// Leeres Projekt, damit die Skizze allein steht
await p.evaluate(() => window.__ravia.getState().neuesDokument?.('Skizzenprobe'));
await p.waitForTimeout(500);
// Skizzenwerkzeug
await p.keyboard.press('q');
await p.waitForTimeout(200);
console.log('Werkzeug:', await p.evaluate(() => window.__ravia.getState().tool));

// Mit dem "Stift" ein krakeliges Rechteck ziehen (Pointer-Ereignisse vom Typ pen)
const box = await p.locator('main canvas').first().boundingBox();
const cx = box.x + box.width/2, cy = box.y + box.height/2;
const ecken = [[-180,-130],[180,-120],[172,120],[-176,128],[-170,-124]];
await p.evaluate(async ([bx, by, pts]) => {
  const cv = document.querySelector('main canvas');
  const send = (t, x, y, buttons) => cv.dispatchEvent(new PointerEvent(t, {
    pointerId: 1, pointerType: 'pen', isPrimary: true, bubbles: true, cancelable: true,
    clientX: x, clientY: y, buttons, pressure: buttons ? 0.6 : 0,
  }));
  let [px, py] = [bx + pts[0][0], by + pts[0][1]];
  send('pointerdown', px, py, 1);
  for (let i = 1; i < pts.length; i++) {
    const [tx, ty] = [bx + pts[i][0], by + pts[i][1]];
    const n = 40;
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const zitter = Math.sin(t * 9) * 2.5;
      send('pointermove', px + (tx - px) * t + zitter, py + (ty - py) * t + zitter, 1);
      await new Promise((r) => setTimeout(r, 1));
    }
    [px, py] = [tx, ty];
  }
  send('pointerup', px, py, 0);
}, [cx, cy, ecken]);
await p.waitForTimeout(700);
const st = await p.evaluate(() => {
  const s = window.__ravia.getState();
  return { skizze: s.skizze ? { n: s.skizze.strecken.length, ring: s.skizze.ring, dreh: s.skizze.drehungGrad } : null,
           status: s.statusMessage, waende: Object.keys(s.doc.walls).length };
});
console.log('Nach dem Strich:', JSON.stringify(st));
await p.screenshot({ path: '/tmp/skizze-vorschlag.png' });
// Übernehmen
// Der Knopf in der Skizzenleiste — nicht irgendein „Übernehmen" im Inspektor.
const leiste = p.locator('main').getByText('Umriss zu').locator('xpath=ancestor::div[contains(@class,"panel")]').first();
await leiste.getByRole('button', { name: 'Übernehmen' }).click();
await p.waitForTimeout(800);
const nach = await p.evaluate(() => {
  const s = window.__ravia.getState();
  return { waende: Object.keys(s.doc.walls).length, raeume: Object.keys(s.doc.rooms).length, skizze: s.skizze, status: s.statusMessage };
});
console.log('Nach dem Übernehmen:', JSON.stringify(nach));
await p.screenshot({ path: '/tmp/skizze-uebernommen.png' });
await b.close();
