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

/*
 * Escape in zwei Stufen — und die Armatur, die daran haengt.
 *
 * Gemeldet wurde "gesetzte Armaturen sind nicht loeschbar". Das Loeschen war
 * nie das Problem: Das Programm startet im Werkzeug "Wand", Escape beendete
 * bis 1.28.1 nur die angefangene Kette und liess das Werkzeug stehen. Jeder
 * Klick zeichnete also, statt auszuwaehlen — man kam an gar kein Bauteil
 * heran, solange man nicht von Hand den Pfeil anklickte.
 *
 * Geprueft wird deshalb der ganze Weg mit echten Ereignissen: auslegen,
 * zweimal Escape, auf das Symbol klicken, Entf. Im Store allein waere der
 * Fehler unsichtbar geblieben — dort ging Loeschen die ganze Zeit.
 */
console.log('\n▸ Escape kehrt zur Auswahl zurueck');
await p.evaluate(() => window.__ravia.getState().setViewMode('2d'));
await p.waitForTimeout(600);
await p.evaluate(() => window.__ravia.getState().legeRohrnetzAus());
await p.waitForTimeout(1500);
const werkzeug = () => p.evaluate(() => window.__ravia.getState().tool);
const armaturen = () => p.evaluate(() => Object.keys(window.__ravia.getState().doc.pipeAccessories ?? {}).length);

/*
 * Zwei Faelle, und sie verhalten sich absichtlich verschieden.
 *
 * a) Nichts angefangen: EIN Escape genuegt. Wer ein Werkzeug aus Versehen
 *    erwischt hat, ist mit einem Tastendruck wieder heraus.
 * b) Kette laeuft: Das erste Escape beendet die Kette und laesst das
 *    Werkzeug stehen — wer eine Wand fertig hat, will meist die naechste
 *    zeichnen. Erst das zweite geht zur Auswahl.
 */
const mitte = await p.evaluate(() => {
  const r = document.querySelector('canvas').getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});

await p.evaluate(() => window.__ravia.getState().setTool('wall'));
await p.waitForTimeout(200);
pruef('a) Ein Zeichenwerkzeug ist aktiv', await werkzeug(), 'wall');
await p.keyboard.press('Escape');
await p.waitForTimeout(300);
pruef('a) Ohne Kette genuegt ein Escape', await werkzeug(), 'select');

await p.evaluate(() => window.__ravia.getState().setTool('wall'));
await p.waitForTimeout(200);
await p.mouse.click(mitte.x - 120, mitte.y - 120);
await p.waitForTimeout(300);
await p.mouse.move(mitte.x, mitte.y);
await p.waitForTimeout(200);
pruef('b) Werkzeug aktiv, Kette angefangen', await werkzeug(), 'wall');
await p.keyboard.press('Escape');
await p.waitForTimeout(300);
pruef('b) Erstes Escape laesst das Werkzeug stehen', await werkzeug(), 'wall');
await p.keyboard.press('Escape');
await p.waitForTimeout(300);
pruef('b) Zweites Escape kehrt zur Auswahl zurueck', await werkzeug(), 'select');

console.log('\n▸ Armatur anklicken und entfernen');
const vorArm = await armaturen();
pruef('Die Auslegung hat Armaturen gesetzt', vorArm > 0, true);
const ziel = await p.evaluate(() => {
  const s = window.__ravia.getState();
  const a = Object.values(s.doc.pipeAccessories)[0];
  const vp = s.viewport;
  const r = document.querySelector('canvas').getBoundingClientRect();
  return { x: r.left + (a.position.x - vp.center.x) * vp.zoom + r.width / 2,
           y: r.top + r.height / 2 - (a.position.y - vp.center.y) * vp.zoom };
});
await p.mouse.click(ziel.x, ziel.y);
await p.waitForTimeout(500);
const gewaehlt = await p.evaluate(() => window.__ravia.getState().selection?.kind ?? 'nichts');
pruef('Der Klick trifft die Armatur', gewaehlt, 'accessory');
await p.keyboard.press('Delete');
await p.waitForTimeout(600);
pruef('Entf entfernt genau eine', vorArm - (await armaturen()), 1);

console.log('\nFEHLER auf der Seite:', errs.length ? errs.join(' | ') : 'keine');
if (errs.length) f += errs.length;
console.log(`\n${f===0 ? '✓ RAUCHTEST BESTANDEN' : `✗ ${f} FEHLER`}\n`);
await b.close();
process.exit(f===0?0:1);
