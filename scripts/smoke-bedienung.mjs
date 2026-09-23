/**
 * Rauchtest für die Bedienbarkeit: einfacher Modus, Aufgabenliste,
 * Erklärungen und Handlungsanweisungen im Prüfbericht.
 *
 * Der Test ersetzt keine Beobachtung am echten Menschen. Er stellt aber
 * sicher, dass die Hilfen da sind, wo sie sein sollen — und dass der
 * einfache Modus wirklich weniger zeigt statt nur anders.
 */

import { chromium } from 'playwright';

/**
 * Unter welcher Adresse geprüft wird.
 *
 * Vorgabe ist die Vorschau aus `vite preview`. Über `RAVIA_PROBE` lässt sich
 * stattdessen ein **echter Server** prüfen — und vor allem einer, der die
 * Anwendung unter einem **Unterpfad** ausliefert:
 *
 *     RAVIA_PROBE=http://localhost:8080/Cad_light/ node scripts/smoke-ui.mjs
 *
 * Das ist kein Beiwerk. Ein Build für einen Unterpfad schreibt andere
 * Adressen in die index.html, und ob die stimmen, zeigt sich nur, wenn man
 * genau dort prüft. Der abschließende Schrägstrich gehört dazu.
 */
const BASIS = process.env.RAVIA_PROBE ?? 'http://localhost:4177/';


const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const p = await b.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 2 });
const errs = [];
p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
p.on('console', (m) => {
  if (m.type() === 'error' && !/ERR_CONNECTION_RESET/.test(m.text())) errs.push(m.text());
});

let failures = 0;
let simpleTools = 0;
const expect = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? '✓' : '✗'} ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (erwartet ${JSON.stringify(expected)})`}`);
};

// Nur beim ersten Laden aufräumen — der Test lädt später absichtlich neu und
// will dann sehen, was gemerkt wurde.
// Die Einführung beim allerersten Start würde jeden Klick abfangen. Sie
// gehört zur Anwendung und wird an genau einer Stelle geprüft
// (`smoke:ux`); überall sonst wird sie als „schon gesehen" markiert.
await p.addInitScript(() => {
  if (!sessionStorage.getItem('ravia-smoke')) {
    localStorage.clear();
    sessionStorage.setItem('ravia-smoke', '1');
  }
  localStorage.setItem('ravia-einfuehrung', '1');
});
await p.goto(BASIS, { waitUntil: 'networkidle' });
await p.waitForTimeout(1500);

const tabs = () => p.locator('aside > div:first-child button').allInnerTexts();

console.log('\n▸ Einfacher Modus');
{
  expect('Startet im einfachen Modus', await p.evaluate(() => window.__ravia.getState().uiMode), 'einfach');
  const t = await tabs();
  /*
   * Neun seit 1.22.0, vorher acht: Der Reiter **Ebenen** ist dazugekommen.
   *
   * Er trägt das Augensymbol und ist die einzige Stelle, an der sich
   * Handnotizen und Ebenen ein- und ausblenden lassen. Ohne ihn fehlte diese
   * Möglichkeit auf dem Tablet vollständig — dort läuft das Programm im
   * einfachen Modus, und ein Schalter, den man nur im Fachplanermodus findet,
   * ist auf einem Gerät ohne Tastatur unauffindbar.
   */
  expect('Neun Reiter statt dreizehn', t.length, 9);
  expect('Darunter „Ebenen" mit dem Augensymbol', t.includes('Ebenen'), true);
  expect('„Start" steht vorn', t[0], 'Start');
  expect('Fachplaner-Reiter ausgeblendet', t.includes('Wärmebrücken'), false);

  simpleTools = await p.locator('div.panel button.tool-btn').count();
  expect('Werkzeugleiste vorhanden', simpleTools > 5, true);
  await p.screenshot({ path: './screenshots/bedienung-1-einfach.png' });
}

console.log('\n▸ Aufgabenliste');
{
  const text = await p.locator('aside').innerText();
  expect('Überschrift in Alltagssprache', /WAS IST ZU TUN\?/.test(text), true);
  expect('Fortschritt wird gezeigt', /von \d+ erledigt/.test(text), true);
  expect('Schritte benannt', /Grundriss zeichnen/.test(text) && /An RaVia übergeben/.test(text), true);

  // Eine Schaltfläche in der Liste führt in den passenden Reiter.
  await p.getByRole('button', { name: 'Prüfung öffnen' }).click();
  await p.waitForTimeout(600);
  const afterJump = await p.locator('aside').innerText();
  expect('Schaltfläche öffnet die Prüfung', /Modellprüfung|MODELLPRÜFUNG/.test(afterJump), true);
}

console.log('\n▸ Handlungsanweisungen');
{
  // Einen Fehler erzeugen: ein Fenster breiter als seine Wand.
  await p.evaluate(() => {
    const s = window.__ravia.getState();
    const op = Object.values(s.doc.openings)[0];
    s.updateOpening(op.id, { width: 40 });
  });
  await p.waitForTimeout(600);
  const text = await p.locator('aside').innerText();
  expect('Fehler wird gemeldet', /Nicht rechenfähig/.test(text), true);
  expect('Mit Handlungsanweisung', /So beheben Sie das:/.test(text), true);
  // Der Wortlaut des Hinweises stand hier einmal wörtlich drin und wurde in
  // der Oberfläche später genauer gefasst („springt hin, zoomt heran und
  // markiert die Stelle"). Geprüft wird deshalb, was die Zusage ausmacht:
  // Anklicken führt zur Stelle.
  expect('Sprunghinweis', /Anklicken springt hin/.test(text), true);
  await p.locator('aside').screenshot({ path: './screenshots/bedienung-2-pruefung.png' });

  await p.keyboard.press('Control+z');
  await p.waitForTimeout(400);
}

console.log('\n▸ Erklärungen');
{
  await p.getByRole('button', { name: 'Objekt', exact: true }).click();
  await p.waitForTimeout(400);
  const marks = p.locator('aside button[aria-label^="Was bedeutet"]');
  expect('Fragezeichen an den Fachbegriffen', (await marks.count()) >= 4, true);

  await marks.nth(2).click();
  await p.waitForTimeout(300);
  const card = await p.locator('body > div.fixed').innerText();
  expect('Karte erklärt in ganzen Sätzen', card.length > 120, true);
  expect('Mit üblichen Werten', /Üblich:/.test(card), true);
  // Nicht in Großbuchstaben geerbt vom Beschriftungsstil.
  expect('Nicht in Versalien', card !== card.toUpperCase(), true);
  await p.screenshot({ path: './screenshots/bedienung-3-erklaerung.png' });

  await p.keyboard.press('Escape');
  await p.waitForTimeout(200);
  expect('Escape schließt die Karte', await p.locator('body > div.fixed').count(), 0);
}

console.log('\n▸ Fachplaner-Modus');
{
  await p.getByRole('button', { name: 'Start', exact: true }).click();
  await p.waitForTimeout(300);
  await p.getByRole('button', { name: 'Fachplaner' }).click();
  await p.waitForTimeout(400);
  const t = await tabs();
  expect('Alle Reiter sichtbar', t.length, 13);
  expect('Wärmebrücken wieder da', t.includes('Wärmebrücken'), true);
  const profiTools = await p.locator('div.panel button.tool-btn').count();
  expect('Mehr Werkzeuge als im einfachen Modus', profiTools > simpleTools, true);
  expect('Modus gemerkt', await p.evaluate(() => localStorage.getItem('ravia-ui-mode')), 'profi');
  await p.screenshot({ path: './screenshots/bedienung-4-profi.png' });

  // Nach dem Neuladen bleibt der Modus stehen.
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  const restored = await p.evaluate(() => window.__ravia.getState().uiMode);
  expect('Modus überlebt den Neustart', restored, 'profi');
}

console.log('\nERRORS:', errs.length ? errs.join('\n') : 'keine');
if (errs.length) failures += errs.length;
console.log(`\n${failures === 0 ? '✓ RAUCHTEST BESTANDEN' : `✗ ${failures} FEHLER`}\n`);
await b.close();
process.exit(failures === 0 ? 0 : 1);
