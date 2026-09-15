/**
 * Rauchtest: Bauteile in der 3D-Ansicht anfassen, ändern und entfernen.
 * ---------------------------------------------------------------------------
 * **Gemessen wird am Modell, nicht am Bild.** Ob eine Griffkugel gezeichnet
 * wird, sagt nichts darüber, ob sie das Maß ändert, das sie zu tragen
 * behauptet. Jede Zeile hier prüft deshalb den Speicher: Steht die Zahl
 * hinterher am Bauteil, ist es **ein** Schritt in der Historie, und nimmt ein
 * Rückgängig ihn vollständig zurück.
 *
 * Der Prüfblock `scripts/pruefungen/griffe.ts` prüft den Rechenkern — welche
 * Griffe es gibt, welche Grenzen gelten, was eine Änderung bedeutet. Dieser
 * Rauchtest prüft das Stück dazwischen: dass die Oberfläche den Rechenkern
 * tatsächlich erreicht.
 */
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
const errs = []; p.on('pageerror', e => errs.push(e.message));
p.on('console', m => { if (m.type()==='error' && !m.text().includes('Failed to load resource')) errs.push(m.text()); });
await p.addInitScript(() => { localStorage.setItem('ravia-ui-mode','profi'); localStorage.setItem('ravia-einfuehrung','1'); });
const BASIS = process.env.RAVIA_PROBE ?? 'http://localhost:4177/';
await p.goto(BASIS, { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1500);
let f = 0;
const pruef = (l, ist, soll) => { const ok = JSON.stringify(ist)===JSON.stringify(soll); if(!ok) f++; console.log(`  ${ok?'✓':'✗'} ${l}: ${JSON.stringify(ist)}${ok?'':` (erwartet ${JSON.stringify(soll)})`}`); };

await p.evaluate(() => { window.__ravia.getState().loadDemo(); });
await p.waitForTimeout(800);
await p.evaluate(() => window.__ravia.getState().setViewMode('3d'));
await p.waitForTimeout(3000);

console.log('\n▸ Griffe an der Wand');
const wand = await p.evaluate(() => {
  const s = window.__ravia.getState();
  const w = Object.values(s.doc.walls).filter(x => x.levelId === s.doc.activeLevelId)[0];
  s.setSelection({ kind: 'wall', id: w.id });
  return { id: w.id, hoehe: w.height, dicke: w.thickness };
});
await p.waitForTimeout(600);
const leiste = await p.evaluate(() => [...document.querySelectorAll('button')].map(b => b.textContent.trim()).filter(t => /Wand|Entfernen/.test(t)));
pruef('Die Maßleiste zeigt die vier Wandgriffe', leiste.filter(t=>/Wand/.test(t)).length, 4);
pruef('… und einen Knopf zum Entfernen', leiste.includes('Entfernen'), true);
const kugeln = await p.evaluate(() => {
  // Die Griffkugeln liegen in einer eigenen Szenengruppe.
  return window.__raviaGriffe ?? null;
});

console.log('\n▸ Maß eintippen');
const getippt = await p.evaluate(async (w) => {
  const s = () => window.__ravia.getState();
  const knopf = [...document.querySelectorAll('button')].find(b => /^Wandhöhe/.test(b.textContent.trim()));
  knopf.click();
  await new Promise(r => setTimeout(r, 300));
  const feld = document.querySelector('input.field');
  if (!feld) return { fehler: 'kein Feld' };
  const setzer = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setzer.call(feld, '2,625');
  feld.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 200));
  [...document.querySelectorAll('button')].find(b => b.textContent.trim()==='Übernehmen').click();
  await new Promise(r => setTimeout(r, 400));
  return { hoehe: s().doc.walls[w.id].height, status: s().statusMessage, historie: s().past.length };
}, wand);
pruef('Die eingetippte Höhe steht am Bauteil', getippt.hoehe, 2.625);
console.log('    Meldung:', getippt.status);

console.log('\n▸ Grenze greift');
const begrenzt = await p.evaluate(async (w) => {
  const s = () => window.__ravia.getState();
  [...document.querySelectorAll('button')].find(b => /^Wandhöhe/.test(b.textContent.trim())).click();
  await new Promise(r => setTimeout(r, 250));
  const feld = document.querySelector('input.field');
  const setzer = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setzer.call(feld, '0,40'); feld.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 150));
  [...document.querySelectorAll('button')].find(b => b.textContent.trim()==='Übernehmen').click();
  await new Promise(r => setTimeout(r, 350));
  return { hoehe: s().doc.walls[w.id].height, status: s().statusMessage };
}, wand);
pruef('0,40 m wird auf die kleinste Wandhöhe begrenzt', begrenzt.hoehe, 1.5);
pruef('… und die Meldung sagt warum', /begrenzt/.test(begrenzt.status), true);

console.log('\n▸ Öffnung anwählen und ändern');
// Die Wand von oben wieder auf Geschosshöhe bringen: Der vorige Abschnitt hat
// sie auf 1,50 m gestaucht, und in eine 1,50-m-Wand passt unter einem
// 1,385-m-Fenster nur noch 0,115 m Brüstung. Die Grenze wäre dann richtig und
// die Probe trotzdem rot — ein Messfehler der Probe, kein Fehler im Programm.
await p.evaluate((id) => window.__ravia.getState().updateWall(id, { height: 2.75 }), wand.id);
await p.waitForTimeout(300);
const oeffnung = await p.evaluate(async () => {
  const s = () => window.__ravia.getState();
  const op = Object.values(s().doc.openings).find(o => o.kind === 'window');
  s().setSelection({ kind: 'opening', id: op.id });
  await new Promise(r => setTimeout(r, 500));
  const knoepfe = [...document.querySelectorAll('button')].map(b => b.textContent.trim());
  const brue = knoepfe.filter(t => /Brüstung/.test(t)).length;
  [...document.querySelectorAll('button')].find(b => /^Brüstungshöhe/.test(b.textContent.trim()))?.click();
  await new Promise(r => setTimeout(r, 250));
  const fang = [...document.querySelectorAll('button')].map(b => b.textContent.trim()).filter(t => /^\d,\d\d m$/.test(t));
  const feld = document.querySelector('input.field');
  const setzer = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setzer.call(feld, '1,255'); feld.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 150));
  [...document.querySelectorAll('button')].find(b => b.textContent.trim()==='Übernehmen').click();
  await new Promise(r => setTimeout(r, 350));
  return { id: op.id, bruestungsgriffe: brue, fangmasse: fang, neu: s().doc.openings[op.id].sillHeight };
});
pruef('Ein Fenster hat einen Brüstungsgriff', oeffnung.bruestungsgriffe, 1);
pruef('Das abgelesene Maß bleibt genau erhalten', oeffnung.neu, 1.255);
console.log('    angebotene Fangmaße:', oeffnung.fangmasse);

console.log('\n▸ Tür hat keinen Brüstungsgriff');
const tuer = await p.evaluate(async () => {
  const s = () => window.__ravia.getState();
  const op = Object.values(s().doc.openings).find(o => o.kind === 'door');
  s().setSelection({ kind: 'opening', id: op.id });
  await new Promise(r => setTimeout(r, 450));
  return [...document.querySelectorAll('button')].map(b => b.textContent.trim()).filter(t => /Brüstung/.test(t)).length;
});
pruef('An der Tür wird keine Brüstung angeboten', tuer, 0);

console.log('\n▸ Ein Maß auf alle gleichartigen übertragen');
const uebertragen = await p.evaluate(async () => {
  const s = () => window.__ravia.getState();
  const fenster = Object.values(s().doc.openings).filter(o => o.kind === 'window');
  const vorher = fenster.map(o => o.sillHeight);
  s().setSelection({ kind: 'opening', id: fenster[0].id });
  await new Promise(r => setTimeout(r, 450));
  [...document.querySelectorAll('button')].find(b => /^Brüstungshöhe/.test(b.textContent.trim()))?.click();
  await new Promise(r => setTimeout(r, 250));
  const feld = document.querySelector('input.field');
  const setzer = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setzer.call(feld, '1,26'); feld.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 250));
  const knopf = [...document.querySelectorAll('button')].find(b => /übertragen/.test(b.textContent));
  const beschriftung = knopf?.textContent.trim() ?? null;
  const historieVor = s().past.length;
  knopf?.click();
  await new Promise(r => setTimeout(r, 500));
  const nachher = Object.values(s().doc.openings).filter(o => o.kind === 'window').map(o => o.sillHeight);
  const schritte = s().past.length - historieVor;
  s().undo();
  await new Promise(r => setTimeout(r, 300));
  const zurueck = Object.values(s().doc.openings).filter(o => o.kind === 'window').map(o => o.sillHeight);
  return { beschriftung, vorher, nachher, schritte, zurueck, anzahl: fenster.length };
});
console.log('    Knopf:', uebertragen.beschriftung);
console.log('    vorher:', uebertragen.vorher, '→ nachher:', uebertragen.nachher);
pruef('Alle Fenster tragen danach dasselbe Maß', [...new Set(uebertragen.nachher)], [1.26]);
pruef('Die Übertragung ist EIN Schritt in der Historie', uebertragen.schritte, 1);
pruef('Ein Rückgängig nimmt alle zurück', uebertragen.zurueck, uebertragen.vorher);

console.log('\n▸ Entfernen');
const entfernt = await p.evaluate(async () => {
  const s = () => window.__ravia.getState();
  const vor = Object.keys(s().doc.openings).length;
  const op = Object.values(s().doc.openings)[0];
  s().setSelection({ kind: 'opening', id: op.id });
  await new Promise(r => setTimeout(r, 400));
  [...document.querySelectorAll('button')].find(b => b.textContent.trim()==='Entfernen').click();
  await new Promise(r => setTimeout(r, 400));
  const nach = Object.keys(s().doc.openings).length;
  s().undo();
  await new Promise(r => setTimeout(r, 300));
  return { vor, nach, zurueck: Object.keys(s().doc.openings).length };
});
pruef('Der Knopf entfernt genau ein Bauteil', entfernt.vor - entfernt.nach, 1);
pruef('Ein Rückgängig bringt es zurück', entfernt.zurueck, entfernt.vor);

console.log('\nFEHLER auf der Seite:', errs.length ? errs.join(' | ') : 'keine');
if (errs.length) f += errs.length;
console.log(`\n${f===0 ? '✓ RAUCHTEST BESTANDEN' : `✗ ${f} FEHLER`}\n`);
await b.close();
process.exit(f===0?0:1);
