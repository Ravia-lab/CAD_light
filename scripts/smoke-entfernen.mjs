/**
 * Rauchtest „Entfernen ohne Tastatur".
 *
 * **Die Lücke, die dieser Test schließt.** Im Grundriss führte bis 1.52.0
 * genau ein Weg zum Entfernen: die Entf-Taste. Auf dem Tablet gibt es die
 * nicht — dort war Gezeichnetes anfassbar, verschiebbar, maßänderbar und
 * unlöschbar. Aufgefallen ist das nicht dem Prüfstand, sondern beim
 * Zeichnen am Gerät, und das ist der Grund für diesen Test: Der bestehende
 * `smoke:tablet` prüft, ob die Leisten in Hoch- und Querlage passen, nicht
 * ob sich mit dem Finger etwas wieder entfernen lässt.
 *
 * Deshalb läuft hier alles in einem Tablet-Fenster **mit Berührung und ohne
 * einen einzigen Tastendruck**. Ein Test, der zwischendurch `Delete` drückt,
 * beweist genau das nicht, worum es geht.
 */

import { chromium } from 'playwright';

const BASIS = process.env.RAVIA_PROBE ?? 'http://localhost:4177/';

const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
// Querformat eines 10-Zoll-Tablets, Berührung an, kein Zeigegerät.
const ctx = await b.newContext({
  viewport: { width: 1180, height: 820 },
  deviceScaleFactor: 2,
  hasTouch: true,
});
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
p.on('console', (m) => {
  if (m.type() === 'error' && !/ERR_CONNECTION_RESET/.test(m.text())) errs.push(m.text());
});

let failures = 0;
const expect = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `  ${ok ? '✓' : '✗'} ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (erwartet ${JSON.stringify(expected)})`}`,
  );
};

await p.addInitScript(() => {
  localStorage.setItem('ravia-ui-mode', 'profi');
  localStorage.setItem('ravia-einfuehrung', '1');
});
await p.goto(BASIS, { waitUntil: 'networkidle' });
await p.waitForFunction(() => typeof window.__ravia !== 'undefined', null, { timeout: 30000 });
await p.waitForTimeout(1200);
await p.evaluate(() => window.__ravia.getState().loadDemo());
await p.waitForTimeout(800);

/** Der Knopf wird über sein Verb gesucht — der Prüfblock sichert zu, dass
 *  jede Aufschrift darauf endet. Damit findet ihn dieser Test unabhängig
 *  davon, was gerade gewählt ist. */
const entfernenKnopf = p.getByRole('button', { name: /entfernen$/i });

console.log('\n▸ Ohne Auswahl steht nichts im Weg');
{
  await p.evaluate(() => {
    const s = window.__ravia.getState();
    s.setTool('select');
    s.setSelection(null);
  });
  await p.waitForTimeout(300);
  expect('Kein Entfernen-Knopf ohne Auswahl', await entfernenKnopf.count(), 0);
  expect('Kein „Abwählen" ohne Auswahl', await p.getByRole('button', { name: 'Abwählen' }).count(), 0);
}

console.log('\n▸ Eine Wand anwählen — der Knopf sagt, was er entfernt');
let wandId = null;
let wandeVorher = 0;
{
  const stand = await p.evaluate(() => {
    const s = window.__ravia.getState();
    const ids = Object.keys(s.doc.walls);
    s.setTool('select');
    s.setSelection({ kind: 'wall', id: ids[0] });
    return { id: ids[0], anzahl: ids.length };
  });
  wandId = stand.id;
  wandeVorher = stand.anzahl;
  await p.waitForTimeout(300);

  expect('Das Beispielhaus hat Wände', wandeVorher > 0, true);
  expect('Der Knopf steht da', await entfernenKnopf.count(), 1);
  expect('Er nennt die Wand', (await entfernenKnopf.innerText()).trim(), 'Wand entfernen');
  expect('Daneben steht „Abwählen"', await p.getByRole('button', { name: 'Abwählen' }).count(), 1);
}

console.log('\n▸ Tippen entfernt sie — ohne Tastatur');
{
  await entfernenKnopf.click();
  await p.waitForTimeout(500);

  const nachher = await p.evaluate(
    (id) => {
      const s = window.__ravia.getState();
      return {
        anzahl: Object.keys(s.doc.walls).length,
        nochDa: id in s.doc.walls,
        meldung: s.statusMessage,
      };
    },
    wandId,
  );

  expect('Die Wand ist weg', nachher.nochDa, false);
  expect('Genau eine weniger', nachher.anzahl, wandeVorher - 1);
  expect('Die Statuszeile sagt etwas dazu', nachher.meldung.length > 0, true);
  expect('Der Knopf ist danach verschwunden', await entfernenKnopf.count(), 0);
}

console.log('\n▸ Rückgängig holt sie zurück — auch das ohne Tastatur');
{
  await p.evaluate(() => window.__ravia.getState().undo());
  await p.waitForTimeout(400);
  const zurueck = await p.evaluate((id) => id in window.__ravia.getState().doc.walls, wandId);
  expect('Die Wand steht wieder', zurueck, true);
}

console.log('\n▸ Mehrere: die Zahl steht im Knopf');
{
  await p.evaluate(() => {
    const s = window.__ravia.getState();
    const ids = Object.keys(s.doc.walls).slice(0, 3);
    s.setTool('select');
    s.setSelections(ids.map((id) => ({ kind: 'wall', id })));
  });
  await p.waitForTimeout(300);
  expect('Drei Wände', (await entfernenKnopf.innerText()).trim(), '3 Wände entfernen');

  // Gemischt: Wand und Öffnung zusammen heißen „Bauteile".
  const gemischt = await p.evaluate(() => {
    const s = window.__ravia.getState();
    const wand = Object.keys(s.doc.walls)[0];
    const oeffnung = Object.keys(s.doc.openings)[0];
    if (!oeffnung) return false;
    s.setSelections([
      { kind: 'wall', id: wand },
      { kind: 'opening', id: oeffnung },
    ]);
    return true;
  });
  await p.waitForTimeout(300);
  if (gemischt) {
    expect('Gemischt sind Bauteile', (await entfernenKnopf.innerText()).trim(), '2 Bauteile entfernen');
  } else {
    expect('Das Beispielhaus hat Öffnungen', gemischt, true);
  }
}

console.log('\n▸ Gesperrtes bietet keinen toten Knopf an');
{
  await p.evaluate(() => {
    const s = window.__ravia.getState();
    s.sperreBestand(true);
    s.setTool('select');
    s.setSelection({ kind: 'wall', id: Object.keys(s.doc.walls)[0] });
  });
  await p.waitForTimeout(400);

  expect('Kein Entfernen-Knopf bei Gesperrtem', await entfernenKnopf.count(), 0);
  expect(
    'Stattdessen steht da, wo man es freigibt',
    (await p.locator('text=Gesperrt — im Reiter').count()) > 0,
    true,
  );

  const wandeBei = await p.evaluate(() => Object.keys(window.__ravia.getState().doc.walls).length);
  await p.evaluate(() => window.__ravia.getState().sperreBestand(false));
  await p.waitForTimeout(300);
  const wandeDanach = await p.evaluate(() => Object.keys(window.__ravia.getState().doc.walls).length);
  expect('Gesperrt heißt: nichts ist passiert', wandeDanach, wandeBei);
}

console.log('▸ Der Knopf deckt den Plan nicht zu');
{
  /*
   * Der erste Anlauf setzte den Knopf als schwebende Leiste unten in die
   * Mitte der Zeichenfläche — dort, wo bei einem Grundriss die untere
   * Außenwand verläuft. `smoke:wp` zog die Grundstücksgrenze an dieser Kante
   * und blieb stehen: Der Griffpunkt lag mitten auf dem Knopf. Seitdem sitzt
   * er in der Statuszeile. Geprüft wird beides — dass über dem Plan nichts
   * schwebt, und dass der Knopf in der Zeile darunter steht.
   */
  await p.evaluate(() => {
    const s = window.__ravia.getState();
    s.setTool('select');
    s.setSelection({ kind: 'wall', id: Object.keys(s.doc.walls)[0] });
  });
  await p.waitForTimeout(300);

  const lage = await p.evaluate(() => {
    const c = document.querySelector('main canvas');
    const r = c.getBoundingClientRect();
    // Drei Punkte am unteren Rand der Zeichenfläche: links, Mitte, rechts.
    const proben = [0.25, 0.5, 0.75].map((f) => {
      const el = document.elementFromPoint(r.left + r.width * f, r.bottom - 18);
      return el ? el.tagName : null;
    });
    const knopf = [...document.querySelectorAll('button')].find((b) => /entfernen$/i.test(b.textContent.trim()));
    const fuss = knopf ? knopf.closest('footer') : null;
    // Der Knopf darf nicht im waagerecht wischenden Teil der Zeile liegen —
    // sonst kann er aus dem Bild scrollen.
    const imRollfeld = knopf ? Boolean(knopf.closest('.overflow-x-auto')) : null;
    return { proben, imFuss: Boolean(fuss), imRollfeld };
  });

  expect('Am unteren Rand des Plans liegt überall die Zeichenfläche', lage.proben, ['CANVAS', 'CANVAS', 'CANVAS']);
  expect('Der Knopf steht in der Statuszeile', lage.imFuss, true);
  expect('Und wischt dort nicht mit aus dem Bild', lage.imRollfeld, false);
}

console.log('\n▸ Beim Zeichnen ist der Knopf weg');
{
  await p.evaluate(() => {
    const s = window.__ravia.getState();
    s.setSelection({ kind: 'wall', id: Object.keys(s.doc.walls)[0] });
    s.setTool('wall');
  });
  await p.waitForTimeout(300);
  expect('Kein Entfernen-Knopf beim Zeichnen', await entfernenKnopf.count(), 0);
}

console.log('\n▸ Die Statuszeile nennt keine Taste mehr, die es nicht gibt');
{
  await p.evaluate(() => {
    const s = window.__ravia.getState();
    s.setTool('select');
    s.setSelection(null);
    // Der Hinweis tritt nur hervor, solange nichts zu melden ist: Die
    // Statuszeile zeigt ihn genau bei „Bereit".
    s.setStatus('Bereit');
  });
  await p.waitForTimeout(400);
  const zeile = await p.locator('text=Anklicken zum Bearbeiten').first().innerText();
  expect('Der Hinweis nennt den Knopf', zeile.includes('Entfernen-Knopf'), true);
  expect('„Entf löscht" steht nicht mehr da', zeile.includes('Entf löscht'), false);
}

console.log('\n▸ In der 3D-Ansicht bleibt alles, wie es war');
{
  await p.evaluate(() => {
    const s = window.__ravia.getState();
    s.setViewMode('3d');
    s.setTool('select');
    s.setSelection({ kind: 'wall', id: Object.keys(s.doc.walls)[0] });
  });
  await p.waitForTimeout(1500);
  // Die 3D-Leiste heißt schlicht „Entfernen" — sie wird hier nicht
  // umbenannt, nur nachgewiesen: derselbe Griff, an derselben Stelle.
  expect(
    'Der Entfernen-Knopf in 3D steht weiter',
    (await p.getByRole('button', { name: /^Entfernen$/ }).count()) > 0,
    true,
  );
}

await p.evaluate(() => {
  const s = window.__ravia.getState();
  s.setViewMode('2d');
  s.setTool('select');
  s.setSelection({ kind: 'wall', id: Object.keys(s.doc.walls)[0] });
});
await p.waitForTimeout(600);
await p.screenshot({ path: './screenshots/entfernen-tablet.png' });

console.log(`\n${failures === 0 ? '✓' : '✗'} ${failures === 0 ? 'Entfernen ohne Tastatur in Ordnung' : `${failures} Abweichung(en)`}`);
if (errs.length) {
  console.log('\nKonsolenfehler:');
  for (const e of errs.slice(0, 10)) console.log('  ' + e);
}
await b.close();
process.exit(failures === 0 && errs.length === 0 ? 0 : 1);
