/**
 * Rauchtest: Grundriss spiegeln und einem Geschoss zuordnen — mit dem
 * Zeigegeraet, nicht am Store.
 * ---------------------------------------------------------------------------
 * Der Prüfblock `scripts/pruefungen/spiegeln.ts` rechnet die Spiegelung nach:
 * Koordinaten, Winkel, Azimute, Selbstumkehr. Er kann dabei nicht sehen, ob
 * der Knopf dafür ueberhaupt erreichbar ist — und genau das war zuletzt der
 * Fehler bei den Armaturen: Die Funktion lief, nur kam niemand an sie heran.
 *
 * Deshalb hier der ganze Weg: Reiter "Pruefung" oeffnen, den Knopf im Blatt
 * suchen, anklicken, und danach im Modell nachsehen. Zusaetzlich wird
 * Strg+Z geprueft — eine Spiegelung, die sich nicht zuruecknehmen laesst,
 * ist eine Drohung und keine Funktion.
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
const nahe = (l, ist, soll, tol=0.002) => { const ok = Math.abs(ist-soll) <= tol; if(!ok) f++; console.log(`  ${ok?'✓':'✗'} ${l}: ${ist}${ok?'':` (erwartet ${soll})`}`); };

await p.evaluate(() => { window.__ravia.getState().loadDemo(); });
await p.waitForTimeout(1200);

/** Die Eckwerte des aktiven Geschosses — Ausdehnung, Knotenlagen, Winkel. */
const stand = () => p.evaluate(() => {
  const s = window.__ravia.getState();
  const d = s.doc;
  const xs = Object.values(d.nodes).map(n => n.x);
  const hk = Object.values(d.fixtures).find(x => x.category === 'heating');
  const tuer = Object.values(d.openings).find(o => o.kind === 'door');
  return {
    minX: Math.min(...xs), maxX: Math.max(...xs),
    knoten: Object.fromEntries(Object.values(d.nodes).map(n => [n.id, n.x])),
    raeume: Object.keys(d.rooms).length,
    flaeche: Object.values(d.rooms).reduce((s2, r) => s2 + r.area, 0),
    hkX: hk ? hk.position.x : null, hkDreh: hk ? hk.rotation : null,
    tuerSeite: tuer ? tuer.flipSwing === true : null,
    tuerMitte: tuer ? tuer.distance : null,
  };
});

const vorher = await stand();
pruef('Die Demo bringt Raeume mit', vorher.raeume > 0, true);

// --- Der Knopf muss im Blatt zu finden sein ---------------------------------
console.log('\n▸ Den Knopf finden');
await p.evaluate(() => {
  const reiter = [...document.querySelectorAll('button')].find(b => /^Prüfung$/.test(b.textContent.trim()));
  if (reiter) reiter.click();
});
await p.waitForTimeout(600);
const knopfDa = await p.evaluate(() =>
  [...document.querySelectorAll('button')].some(b => b.textContent.includes('links/rechts')));
pruef('Der Reiter „Pruefung" zeigt den Spiegelknopf', knopfDa, true);

// --- Anklicken --------------------------------------------------------------
console.log('\n▸ Links und rechts tauschen');
const kasten = await p.evaluate(() => {
  const k = [...document.querySelectorAll('button')].find(b => b.textContent.includes('links/rechts'));
  const r = k.getBoundingClientRect();
  return { x: r.left + r.width/2, y: r.top + r.height/2 };
});
await p.mouse.click(kasten.x, kasten.y);
await p.waitForTimeout(1200);

const nachher = await stand();
// Die Achse liegt in der Mitte der Ausdehnung, die Ausdehnung bleibt deshalb
// dieselbe — der Grundriss bleibt liegen, wo er lag.
nahe('Die Ausdehnung links bleibt', nachher.minX, vorher.minX);
nahe('Die Ausdehnung rechts bleibt', nachher.maxX, vorher.maxX);
const mitte = (vorher.minX + vorher.maxX) / 2;
let groessteAbweichung = 0;
for (const [id, x] of Object.entries(vorher.knoten)) {
  groessteAbweichung = Math.max(groessteAbweichung, Math.abs((2*mitte - x) - nachher.knoten[id]));
}
nahe('Jeder Knoten liegt an der gespiegelten Stelle', groessteAbweichung, 0);
pruef('Es sind gleich viele Raeume', nachher.raeume, vorher.raeume);
nahe('Die Raumflaeche bleibt', nachher.flaeche, vorher.flaeche, 0.01);
nahe('Der Heizkoerper ist mitgewandert', nachher.hkX, 2*mitte - vorher.hkX);
nahe('… und hat sich mitgedreht', ((nachher.hkDreh - (180 - vorher.hkDreh)) % 360 + 360) % 360, 0);
pruef('Die Tuer schlaegt zur anderen Seite auf', nachher.tuerSeite, !vorher.tuerSeite);
nahe('Die Tuermitte bleibt, wo sie war', nachher.tuerMitte, vorher.tuerMitte);

// --- Zuruecknehmen ----------------------------------------------------------
console.log('\n▸ Strg+Z');
await p.mouse.click(750, 500);           // Fokus zurueck in die Zeichenflaeche
await p.waitForTimeout(200);
await p.keyboard.press('Control+z');
await p.waitForTimeout(900);
const zurueck = await stand();
let abweichungZurueck = 0;
for (const [id, x] of Object.entries(vorher.knoten)) {
  abweichungZurueck = Math.max(abweichungZurueck, Math.abs(x - zurueck.knoten[id]));
}
nahe('Rueckgaengig stellt jeden Knoten wieder her', abweichungZurueck, 0);
pruef('… und die Tuer schlaegt wieder wie zuvor auf', zurueck.tuerSeite, vorher.tuerSeite);

/*
 * Geschosszuordnung — „dieser Grundriss ist das 1. OG".
 *
 * Auch das ist ein Weg, der nur ueber die Oberflaeche prueft, was er
 * behauptet: Der Store kann das Geschoss seit jeher anlegen, aber der Knopf
 * dafuer stand bis 1.29.0 nirgends.
 */
console.log('\n▸ Den Grundriss dem 1. OG zuordnen');
const geschosse = () => p.evaluate(() => {
  const d = window.__ravia.getState().doc;
  return Object.values(d.levels)
    .sort((a, b) => a.order - b.order)
    .map(l => ({ name: l.name, order: l.order, elevation: Math.round(l.elevation*1000)/1000,
                 boden: l.floorBoundary,
                 waende: Object.values(d.walls).filter(w => w.levelId === l.id).length }));
});
const vorGeschosse = await geschosse();
pruef('Vorher gibt es genau ein Geschoss', vorGeschosse.length, 1);
pruef('… und es steht auf Erdreich', vorGeschosse[0].boden, 'ground');

const gesetzt = await p.evaluate(() => {
  const feld = [...document.querySelectorAll('select')]
    .find(s => [...s.options].some(o => o.textContent.trim() === '1. OG'));
  if (!feld) return 'kein Feld';
  const setzer = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
  setzer.call(feld, '1');
  feld.dispatchEvent(new Event('change', { bubbles: true }));
  return 'ok';
});
pruef('Das Auswahlfeld ist da', gesetzt, 'ok');
await p.waitForTimeout(300);
const zuordnen = await p.evaluate(() => {
  const k = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Zuordnen');
  if (!k || k.disabled) return null;
  const r = k.getBoundingClientRect();
  return { x: r.left + r.width/2, y: r.top + r.height/2 };
});
pruef('Der Knopf „Zuordnen" ist anklickbar', zuordnen !== null, true);
await p.mouse.click(zuordnen.x, zuordnen.y);
await p.waitForTimeout(1500);

const nachGeschosse = await geschosse();
pruef('Jetzt gibt es zwei Geschosse', nachGeschosse.length, 2);
pruef('Unten das EG', nachGeschosse[0].name, 'EG');
pruef('Oben das 1. OG', nachGeschosse[1].name, '1. OG');
pruef('Das EG steht auf Erdreich', nachGeschosse[0].boden, 'ground');
pruef('Das 1. OG nicht mehr', nachGeschosse[1].boden, 'adjacent-room');
nahe('Das EG liegt auf 0,00 m', nachGeschosse[0].elevation, 0);
nahe('Das 1. OG eine Geschosshoehe darueber', nachGeschosse[1].elevation - nachGeschosse[0].elevation,
     await p.evaluate(() => {
       const d = window.__ravia.getState().doc;
       const og = Object.values(d.levels).sort((a,b)=>a.order-b.order)[1];
       return og.height + 0.25;
     }));
pruef('Das EG hat Aussenwaende bekommen', nachGeschosse[0].waende > 0, true);
pruef('… aber weniger als das 1. OG (nur der Umriss)',
      nachGeschosse[0].waende < nachGeschosse[1].waende, true);
const egOeffnungen = await p.evaluate(() => {
  const d = window.__ravia.getState().doc;
  const eg = Object.values(d.levels).sort((a,b)=>a.order-b.order)[0];
  const ids = new Set(Object.values(d.walls).filter(w => w.levelId === eg.id).map(w => w.id));
  return Object.values(d.openings).filter(o => ids.has(o.wallId)).length;
});
pruef('Im EG steht keine erfundene Oeffnung', egOeffnungen, 0);

console.log('\n▸ Strg+Z nimmt auch die Zuordnung zurueck');
await p.mouse.click(750, 500);
await p.waitForTimeout(200);
await p.keyboard.press('Control+z');
await p.waitForTimeout(900);
pruef('Wieder ein Geschoss', (await geschosse()).length, 1);

console.log('\nFEHLER auf der Seite:', errs.length ? errs.join(' | ') : 'keine');
if (errs.length) f += errs.length;
console.log(`\n${f===0 ? '✓ RAUCHTEST BESTANDEN' : `✗ ${f} FEHLER`}\n`);
await b.close();
process.exit(f===0?0:1);
