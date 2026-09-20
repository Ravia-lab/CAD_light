/**
 * Rauchtest „Löschen": Auswahl, Aufstellgeschoss, Alles löschen.
 *
 * ---------------------------------------------------------------------------
 * **Warum dieser Test am Browser hängt und nicht am Rechenkern.** Die drei
 * Fehler, die er festhält, waren allesamt im Prüflauf unsichtbar, weil sie
 * nicht in einer Formel steckten, sondern im Zusammenspiel von Treffertest,
 * Auswahl und Tastendruck:
 *
 *  1. Strg+A fasste nur Wände und TGA-Objekte. Wer danach Entf drückte, hielt
 *     den Plan für leer — und die Grundstücksgrenze lag weiter darin.
 *  2. Die Wärmepumpe war in *jedem* Geschoss greifbar. Im Obergeschoss ließ
 *     sich damit ein Gerät löschen, das im Garten neben dem Erdgeschoss steht.
 *  3. Der Papierkorb hieß „Alle Geometrie löschen" und räumte das Gelände
 *     nicht mit.
 *
 * Jeder dieser Punkte wird hier so geprüft, wie er gemeldet wurde: am
 * laufenden Programm, mit Maus und Tastatur.
 *
 * Mit `RAVIA_PROBE=<url>` läuft der Test gegen einen echten Server.
 */

import { chromium } from 'playwright';

const BASIS = process.env.RAVIA_PROBE ?? 'http://localhost:4177/';

const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
const errs = [];
p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
p.on('console', (m) => {
  if (m.type() === 'error' && !/ERR_CONNECTION_RESET/.test(m.text())) errs.push(m.text());
});

let failures = 0;
const expect = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? '✓' : '✗'} ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (erwartet ${JSON.stringify(expected)})`}`);
};

await p.addInitScript(() => {
  localStorage.clear();
  localStorage.setItem('ravia-einfuehrung', '1');
  localStorage.setItem('ravia-ui-mode', 'profi');
});
await p.goto(BASIS, { waitUntil: 'networkidle' });
await p.waitForTimeout(1500);

/** Weltkoordinate → Punkt in der Zeichenfläche. */
const zumSchirm = (welt) =>
  p.evaluate(([wx, wy]) => {
    const st = window.__ravia.getState();
    const c = document.querySelector('main canvas');
    return {
      x: (wx - st.viewport.center.x) * st.viewport.zoom + c.clientWidth / 2,
      y: c.clientHeight / 2 - (wy - st.viewport.center.y) * st.viewport.zoom,
    };
  }, [welt.x, welt.y]);

const zustand = () => p.evaluate(() => {
  const st = window.__ravia.getState();
  return {
    waende: Object.keys(st.doc.walls).length,
    gelaende: Object.keys(st.doc.site.elements).length,
    pumpen: Object.keys(st.doc.site.pumps).length,
    masse: Object.keys(st.doc.annotations).length,
    auswahl: st.selections.length,
    art: st.selection ? st.selection.kind : null,
    geschoss: st.doc.activeLevelId,
    status: st.statusMessage,
  };
});

/**
 * Ein Prüfstand: ein Haus im EG, eine Grundstücksgrenze, eine Maßkette und
 * eine Wärmepumpe im Garten. Dazu ein Obergeschoss.
 */
const aufbauen = () => p.evaluate(() => {
  const st = window.__ravia.getState();
  st.clearAll();
  const eg = st.doc.activeLevelId;
  st.addWall({ x: 0, y: 0 }, { x: 6, y: 0 });
  st.addWall({ x: 6, y: 0 }, { x: 6, y: 5 });
  st.addWall({ x: 6, y: 5 }, { x: 0, y: 5 });
  st.addWall({ x: 0, y: 5 }, { x: 0, y: 0 });
  st.addSiteElement('boundary', [
    { x: -8, y: -8 }, { x: 14, y: -8 }, { x: 14, y: 13 }, { x: -8, y: 13 },
  ]);
  st.addHeatPump({ x: 9, y: 2.5 });
  // Das Obergeschoss nur einmal anlegen — der Prüfstand wird mehrfach
  // aufgebaut, und `clearAll` nimmt die Geschosse bewusst nicht mit.
  const vorhanden = Object.values(st.doc.levels).find((l) => l.id !== eg);
  const og = vorhanden ?? window.__ravia.getState().addLevel({ name: 'OG' });
  window.__ravia.getState().setActiveLevel(eg);
  window.__ravia.getState().setTool('select');
  window.__ravia.getState().setViewport({ center: { x: 3, y: 2.5 }, zoom: 28 });
  return { eg, og: og && og.id };
});

// ===========================================================================
console.log('\n▸ 1 · Strg+A fasst wirklich alles');
// ===========================================================================
const geschosse = await aufbauen();
await p.waitForTimeout(400);
{
  const vor = await zustand();
  expect('Vier Wände stehen', vor.waende, 4);
  expect('Eine Grundstücksgrenze liegt im Plan', vor.gelaende, 1);
  expect('Eine Wärmepumpe steht im Garten', vor.pumpen, 1);

  await p.locator('main canvas').first().click({ position: await zumSchirm({ x: 3, y: 2.5 }) });
  await p.keyboard.press('Control+a');
  await p.waitForTimeout(200);
  const gewaehlt = await p.evaluate(() =>
    window.__ravia.getState().selections.map((s) => s.kind).sort().join(','));
  // Vier Wände + ein Geländeobjekt + eine Wärmepumpe = sechs Einträge.
  expect('Sechs Objekte in der Auswahl', gewaehlt.split(',').length, 6);
  expect('Die Grundstücksgrenze ist dabei', gewaehlt.includes('site'), true);
  expect('Die Wärmepumpe ist dabei', gewaehlt.includes('heatpump'), true);

  await p.keyboard.press('Delete');
  await p.waitForTimeout(400);
  const nach = await zustand();
  expect('Keine Wand mehr', nach.waende, 0);
  expect('Kein Geländeobjekt mehr', nach.gelaende, 0);
  expect('Keine Wärmepumpe mehr', nach.pumpen, 0);
}

// ===========================================================================
console.log('\n▸ 2 · Die Wärmepumpe gehört ihrem Aufstellgeschoss');
// ===========================================================================
await aufbauen();
await p.waitForTimeout(400);
{
  const aufPumpe = await zumSchirm({ x: 9, y: 2.5 });

  // Im EG: greifbar.
  await p.locator('main canvas').first().click({ position: aufPumpe });
  await p.waitForTimeout(200);
  expect('Im EG wird die Pumpe getroffen', (await zustand()).art, 'heatpump');

  // Im OG: sichtbar, aber nicht greifbar.
  await p.evaluate((og) => window.__ravia.getState().setActiveLevel(og), geschosse.og);
  await p.waitForTimeout(300);
  await p.locator('main canvas').first().click({ position: aufPumpe });
  await p.waitForTimeout(200);
  const imOg = await zustand();
  expect('Im OG steht man auf dem OG', imOg.geschoss, geschosse.og);
  expect('Im OG wird sie nicht getroffen', imOg.art === 'heatpump', false);

  // Und lässt sich dort auch nicht löschen — auch nicht über Strg+A.
  await p.keyboard.press('Control+a');
  await p.keyboard.press('Delete');
  await p.waitForTimeout(400);
  expect('Die Pumpe steht noch', (await zustand()).pumpen, 1);

  // Zurück im EG: löschbar.
  await p.evaluate((eg) => window.__ravia.getState().setActiveLevel(eg), geschosse.eg);
  await p.waitForTimeout(300);
  await p.locator('main canvas').first().click({ position: aufPumpe });
  await p.keyboard.press('Delete');
  await p.waitForTimeout(400);
  expect('Im EG ist sie weg', (await zustand()).pumpen, 0);
}

// ===========================================================================
console.log('\n▸ 3 · „Alles löschen" räumt auch das Gelände');
// ===========================================================================
await aufbauen();
await p.waitForTimeout(400);
{
  // Der Papierkorb steht ganz unten in der Werkzeugleiste.
  await p.locator('button[title^="Alles löschen"]').click();
  await p.waitForTimeout(300);

  const dialog = p.locator('.panel', { hasText: 'Alles löschen?' }).last();
  expect('Die Rückfrage steht', await dialog.isVisible(), true);
  const text = await dialog.innerText();
  expect('Sie nennt die Grundstücksgrenze', text.includes('Objekte im Gelände'), true);
  expect('Sie nennt die Wärmepumpe', text.includes('Wärmepumpen'), true);
  expect('Sie sagt, was bleibt', text.includes('Geschosse'), true);
  expect('Und dass Strg+Z alles zurückholt', text.includes('Strg+Z'), true);

  await p.locator('button', { hasText: /^Alles löschen$/ }).last().click();
  await p.waitForTimeout(500);
  const nach = await zustand();
  expect('Der Plan ist leer', nach.waende, 0);
  expect('Das Gelände auch', nach.gelaende, 0);
  expect('Die Wärmepumpe auch', nach.pumpen, 0);
  expect('Die Geschosse stehen noch',
    await p.evaluate(() => Object.keys(window.__ravia.getState().doc.levels).length), 2);

  // Und der Rückweg steht offen.
  await p.keyboard.press('Control+z');
  await p.waitForTimeout(500);
  const zurueck = await zustand();
  expect('Strg+Z holt die Wände zurück', zurueck.waende, 4);
  expect('Und die Grundstücksgrenze', zurueck.gelaende, 1);
  expect('Und die Wärmepumpe', zurueck.pumpen, 1);
}

// ===========================================================================
console.log('\n▸ 4 · Nichts in der Konsole');
// ===========================================================================
expect('Keine Fehler im Browser', errs.slice(0, 3), []);

await b.close();
console.log(failures ? `\n✗ ${failures} Prüfung(en) fehlgeschlagen` : '\n✓ Löschen: alles in Ordnung');
process.exit(failures ? 1 : 0);
