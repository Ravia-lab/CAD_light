import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
p.on('pageerror', e => console.log('PAGEERROR', e.message));
await p.addInitScript(() => { localStorage.clear(); localStorage.setItem('ravia-einfuehrung','1'); localStorage.setItem('ravia-ui-mode','profi'); });
await p.goto('http://localhost:4177/', { waitUntil: 'networkidle' });
await p.waitForTimeout(1500);

const el = await p.evaluate(() => {
  const st = window.__ravia.getState();
  const e = st.addSiteElement('boundary', [{x:-10,y:-10},{x:10,y:-10},{x:10,y:10},{x:-10,y:10}]);
  st.setViewport({ center: {x:0,y:0}, zoom: 20 }); st.setTool('select'); st.clearSelection && st.clearSelection();
  return { id: e && e.id };
});
console.log('angelegt:', JSON.stringify(el), 'zoom', await p.evaluate(()=>window.__ravia.getState().viewport.zoom));
await p.waitForTimeout(300);

const zumSchirm = async (welt) => p.evaluate(([wx,wy]) => {
  const st = window.__ravia.getState();
  const c = document.querySelector('main canvas');
  return { x: (wx-st.viewport.center.x)*st.viewport.zoom + c.clientWidth/2,
           y: c.clientHeight/2 - (wy-st.viewport.center.y)*st.viewport.zoom };
}, [welt.x, welt.y]);

// erst abwählen
const leer = await zumSchirm({x: 3, y: 3});
await p.locator('main canvas').first().click({ position: leer });
await p.waitForTimeout(200);
console.log('nach Klick ins Leere:', JSON.stringify(await p.evaluate(()=>window.__ravia.getState().selection)));

const pt = await zumSchirm({x:0, y:-10});
console.log('Schirmpunkt:', JSON.stringify(pt));
await p.locator('main canvas').first().click({ position: pt });
await p.waitForTimeout(300);
console.log('nach Klick auf Linie:', JSON.stringify(await p.evaluate(()=>window.__ravia.getState().selection)), '|', await p.evaluate(()=>window.__ravia.getState().statusMessage));

await p.keyboard.press('Delete');
await p.waitForTimeout(400);
console.log('nach Entf:', JSON.stringify(await p.evaluate(()=>({
  elemente: Object.keys(window.__ravia.getState().doc.site.elements),
  status: window.__ravia.getState().statusMessage,
}))));
await b.close();
