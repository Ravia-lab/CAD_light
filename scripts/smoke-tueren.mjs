/**
 * Rauchtest: Tueren im begehbaren Modus.
 * ---------------------------------------------------------------------------
 * Gemessen wird am Modell, nicht am Bild: `window.__raviaGeher` sagt, wo der
 * Betrachter steht, und der Standort nach einem Schritt sagt, ob er
 * durchgekommen ist. Eine geschlossene Tuer muss ihn aufhalten, eine
 * geoeffnete nicht — das ist der ganze Sinn der Sache, und es ist am Bild
 * nicht zu beweisen.
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
await p.evaluate(() => { window.__ravia.getState().setViewMode('3d'); window.__ravia.getState().setCameraMode('walk'); });
await p.waitForTimeout(2500);

/** Vor eine Tuer stellen, mit Blick darauf. */
const stellDichVorDieTuer = async () => p.evaluate(() => {
  const s = window.__ravia.getState();
  const d = s.doc;
  // Eine Innentuer des aktiven Geschosses.
  const tuer = Object.values(d.openings).find(o => {
    const w = d.walls[o.wallId];
    return o.kind === 'door' && w && w.levelId === d.activeLevelId && w.type !== 'exterior';
  });
  if (!tuer) return null;
  const w = d.walls[tuer.wallId];
  const a = d.nodes[w.a], bb = d.nodes[w.b];
  const len = Math.hypot(bb.x-a.x, bb.y-a.y);
  const dir = { x: (bb.x-a.x)/len, y: (bb.y-a.y)/len };
  const n = { x: -dir.y, y: dir.x };
  const mitte = { x: a.x + dir.x*tuer.distance, y: a.y + dir.y*tuer.distance };
  // Einen Meter vor der Tuer, auf der +Normalenseite, mit Blick zur Tuer.
  const g = window.__raviaGeher;
  g.x = mitte.x + n.x*1.0; g.y = mitte.y + n.y*1.0;
  g.gier = Math.atan2(-n.y, -n.x);
  g.nick = 0;
  return { tuerId: tuer.id, mitte, n, stand: { x: g.x, y: g.y } };
});

const lage = await stellDichVorDieTuer();
pruef('Eine Innentuer ist gefunden', lage !== null, true);
await p.waitForTimeout(400);

/** Zwei Sekunden vorwaerts gehen und sagen, wie weit es ging. */
const geheVor = async (ms) => {
  const vor = await p.evaluate(() => ({ ...window.__raviaGeher }));
  await p.keyboard.down('w');
  await p.waitForTimeout(ms);
  await p.keyboard.up('w');
  await p.waitForTimeout(200);
  const nach = await p.evaluate(() => ({ ...window.__raviaGeher }));
  return { vor, nach, weg: Math.hypot(nach.x-vor.x, nach.y-vor.y) };
};

console.log('\n▸ Die geschlossene Tuer haelt auf');
const zu = await geheVor(2000);
console.log('  ·', JSON.stringify({ von: [zu.vor.x.toFixed(2), zu.vor.y.toFixed(2)], nach: [zu.nach.x.toFixed(2), zu.nach.y.toFixed(2)], weg: zu.weg.toFixed(2) }));
// Zwei Sekunden Gehen sind rund 2,90 m. Vor der Tuer steht man 1,00 m
// entfernt; mit Koerperradius 0,28 und halber Wandstaerke bleibt weniger als
// ein Meter Weg, bevor es nicht mehr weitergeht.
pruef('Er kommt nicht durch die zu Tuer', zu.weg < 1.0, true);
const seiteZu = await p.evaluate((l) => {
  const g = window.__raviaGeher;
  return (g.x - l.mitte.x)*l.n.x + (g.y - l.mitte.y)*l.n.y;
}, lage);
// Positiv heisst: noch auf der Ausgangsseite der Wandebene.
pruef('Er steht noch auf seiner Seite der Wand', seiteZu > 0, true);

console.log('\n▸ E oeffnet sie');
await p.keyboard.press('e');
await p.waitForTimeout(1400);
const meldung = await p.evaluate(() => window.__ravia.getState().statusMessage);
console.log('  ·', meldung);
pruef('Die Statuszeile meldet die geoeffnete Tuer', /geöffnet/i.test(meldung), true);

const auf = await geheVor(2000);
console.log('  ·', JSON.stringify({ von: [auf.vor.x.toFixed(2), auf.vor.y.toFixed(2)], nach: [auf.nach.x.toFixed(2), auf.nach.y.toFixed(2)], weg: auf.weg.toFixed(2) }));
/*
 * Entscheidend ist nicht der zurueckgelegte Weg, sondern die Seite: Wie weit
 * es dahinter weitergeht, haengt am Grundriss (im Demohaus steht gleich die
 * naechste Wand), ob er ueberhaupt hindurchkommt, haengt an der Tuer.
 */
const seite = await p.evaluate((l) => {
  const g = window.__raviaGeher;
  return (g.x - l.mitte.x)*l.n.x + (g.y - l.mitte.y)*l.n.y;
}, lage);
pruef('Jetzt steht er auf der anderen Seite der Wand', seite < 0, true);
pruef('… und ist dabei weitergekommen als vorher', auf.weg > zu.weg * 1.1, true);

console.log('\n▸ E schliesst sie wieder');
// Umdrehen: Die Tuer liegt jetzt im Ruecken, und `tuerInReichweite` sieht
// bewusst nur nach vorn — wer in einem Flur zwischen zwei Tueren steht, meint
// die, auf die er schaut.
await p.evaluate((l) => {
  const g = window.__raviaGeher;
  g.gier = Math.atan2(l.n.y, l.n.x);
}, lage);
await p.waitForTimeout(300);
await p.keyboard.press('e');
await p.waitForTimeout(1400);
const meldung2 = await p.evaluate(() => window.__ravia.getState().statusMessage);
pruef('Die Statuszeile meldet die geschlossene Tuer', /geschlossen/i.test(meldung2), true);
const zurueck = await geheVor(2000);
const seiteZurueck = await p.evaluate((l) => {
  const g = window.__raviaGeher;
  return (g.x - l.mitte.x)*l.n.x + (g.y - l.mitte.y)*l.n.y;
}, lage);
pruef('Und er kommt nicht mehr zurueck', seiteZurueck < 0, true);
console.log('  ·', JSON.stringify({ weg: zurueck.weg.toFixed(2), seite: seiteZurueck.toFixed(2) }));

console.log('\n▸ In der Uebersicht stehen die Tueren wieder offen');
await p.evaluate(() => window.__ravia.getState().setCameraMode('orbit'));
await p.waitForTimeout(1500);
const winkel = await p.evaluate(() => window.__raviaTueren?.() ?? null);
pruef('Der Diagnosehaken antwortet', winkel !== null, true);
pruef('Jedes Blatt steht offen', winkel && winkel.every(w => w > 0.9), true);

console.log('\nFEHLER auf der Seite:', errs.length ? errs.join(' | ') : 'keine');
if (errs.length) f += errs.length;
console.log(`\n${f===0 ? '✓ RAUCHTEST BESTANDEN' : `✗ ${f} FEHLER`}\n`);
await b.close();
process.exit(f===0?0:1);
