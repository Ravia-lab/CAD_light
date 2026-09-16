/**
 * Rauchtest: die Fussbodenheizung im Modell.
 * ---------------------------------------------------------------------------
 * „Wenn Fussboden gelegt wird, moechte ich die Rohre sehen." Bis 1.28.2 zeigte
 * das Modell an dieser Stelle eine glatte Platte, obwohl das Programm jeden
 * Meter Rohr kannte.
 *
 * Geprueft wird am Modell und nicht am Bild: `window.__raviaSzene()` zaehlt
 * die Eckpunkte je Bauteilart in der Szene. Ein Bild beweist nicht, dass ein
 * Rohr gebaut wurde — eine Null an dieser Stelle beweist, dass keines gebaut
 * wurde.
 */
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
const errs = []; p.on('pageerror', e => errs.push(e.message));
p.on('console', m => { if (m.type()==='error' && !m.text().includes('Failed to load resource')) errs.push(m.text()); });
await p.addInitScript(() => { localStorage.setItem('ravia-ui-mode','profi'); localStorage.setItem('ravia-einfuehrung','1'); });
await p.goto(process.env.RAVIA_PROBE ?? 'http://localhost:4177/', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1500);
let f = 0;
const pruef = (l, ist, soll) => { const ok = JSON.stringify(ist)===JSON.stringify(soll); if(!ok) f++; console.log(`  ${ok?'✓':'✗'} ${l}: ${JSON.stringify(ist)}${ok?'':` (erwartet ${JSON.stringify(soll)})`}`); };

await p.evaluate(() => { window.__ravia.getState().loadDemo(); });
await p.waitForTimeout(1000);
await p.evaluate(() => window.__ravia.getState().setViewMode('3d'));
await p.waitForTimeout(3000);

const szene = () => p.evaluate(() => window.__raviaSzene?.() ?? null);

console.log('\n▸ Ohne Fussbodenheizung kein Rohr im Estrich');
const leer = await szene();
pruef('Der Diagnosehaken antwortet', leer !== null, true);
pruef('Kein Estrichrohr im Modell', leer.fbh ?? 0, 0);

console.log('\n▸ Einen Raum belegen');
const gelegt = await p.evaluate(() => {
  const s = window.__ravia.getState();
  const d = s.doc;
  // Der groesste Raum des aktiven Geschosses — dort passt eine Schnecke hin.
  const raum = Object.values(d.rooms)
    .filter(r => r.levelId === d.activeLevelId && r.innerPolygon.length >= 3)
    .sort((a, b2) => b2.area - a.area)[0];
  if (!raum) return { fehler: 'kein Raum' };
  s.toggleFloorLoopArea(raum.id);
  const heiz = Object.values(window.__ravia.getState().doc.fixtures)
    .filter(x => x.type === 'underfloor' && x.params.roomCoverage === true);
  return { raum: raum.name, flaeche: Math.round(raum.area*100)/100, belegt: heiz.length };
});
console.log('  ·', JSON.stringify(gelegt));
pruef('Eine raumfuellende Fussbodenheizung liegt', gelegt.belegt > 0, true);
await p.waitForTimeout(2500);

const mit = await szene();
pruef('Jetzt stehen Rohre im Estrich', (mit.fbh ?? 0) > 0, true);
// Eine Schnecke in einem Wohnraum hat einige hundert Stuetzpunkte; je
// Teilstrecke ein Zylinder mit sechs Seitenflaechen. Unter tausend Eckpunkten
// waere keine Verlegung, sondern ein Strich.
pruef('… und zwar eine ganze Verlegung, kein Strich', (mit.fbh ?? 0) > 1000, true);

console.log('\n▸ Die Rohre haengen an der Ebene „Heizung"');
await p.evaluate(() => {
  const s = window.__ravia.getState();
  const heiz = Object.values(s.doc.layers).find(l => /heiz/i.test(l.name) || l.id === 'layer-heating');
  s.toggleLayer(heiz.id);
});
await p.waitForTimeout(2500);
const aus = await szene();
pruef('Ausgeblendet ist auch der Estrich leer', aus.fbh ?? 0, 0);
await p.evaluate(() => {
  const s = window.__ravia.getState();
  const heiz = Object.values(s.doc.layers).find(l => /heiz/i.test(l.name) || l.id === 'layer-heating');
  s.toggleLayer(heiz.id);
});
await p.waitForTimeout(2500);
pruef('Wieder eingeblendet sind sie zurueck', ((await szene()).fbh ?? 0) > 1000, true);

console.log('\nFEHLER auf der Seite:', errs.length ? errs.join(' | ') : 'keine');
if (errs.length) f += errs.length;
console.log(`\n${f===0 ? '✓ RAUCHTEST BESTANDEN' : `✗ ${f} FEHLER`}\n`);
await b.close();
process.exit(f===0?0:1);
