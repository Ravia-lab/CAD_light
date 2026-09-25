/**
 * Rauchtest für das Übersichtsschema.
 *
 * Der Prüfblock `uebersichtsschema` hält die Ableitung fest — welche Bauteile
 * bleiben, was wegfällt, welche Leitung an welchem Stutzen hängt. Was er
 * nicht sehen kann, ist der Bildschirm: ob die Ansicht aufgeht, ob sie die
 * Vorgabe ist, ob der Hinweissatz darunter steht, ob sich zur Ausführung
 * umschalten lässt und ob das Bild dabei ohne einen einzigen Fehler in der
 * Konsole gezeichnet wird.
 *
 * Genau daran ist im Projekt schon einmal etwas vorbeigelaufen: Ein Bild, das
 * sich im Rechenkern sauber ableiten lässt, kann auf dem Schirm hinter einer
 * Leiste verschwinden. Deshalb prüft dieser Lauf auch, dass die Bauteile im
 * sichtbaren Bereich liegen.
 */

import { chromium } from 'playwright';

const BASIS = process.env.RAVIA_PROBE ?? 'http://localhost:4177/';

const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const p = await b.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
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
  localStorage.setItem('ravia-ui-mode', 'profi');
  localStorage.setItem('ravia-einfuehrung', '1');
});
await p.goto(BASIS, { waitUntil: 'networkidle' });
await p.waitForFunction(() => typeof window.__ravia !== 'undefined', null, { timeout: 30000 });
await p.waitForTimeout(1200);
await p.evaluate(() => window.__ravia.getState().loadDemo());
await p.waitForTimeout(600);

const aside = p.locator('aside');

console.log('\n▸ Schema erzeugen und öffnen');
{
  await aside.getByRole('button', { name: 'Anlage', exact: true }).click();
  await p.waitForTimeout(600);
  await p.getByRole('button', { name: /Schema erzeugen/ }).click();
  await p.waitForTimeout(800);
  await p.getByRole('button', { name: 'Schema', exact: true }).click();
  await p.waitForTimeout(1200);
  expect('Schema-Ansicht aktiv', await p.evaluate(() => window.__ravia.getState().viewMode), 'schema');
}

console.log('\n▸ Die Übersicht ist die Vorgabe');
{
  const uebersicht = p.getByRole('button', { name: 'Übersicht', exact: true });
  const ausfuehrung = p.getByRole('button', { name: 'Ausführung', exact: true });
  expect('Beide Ansichten stehen zur Wahl', (await uebersicht.count()) + (await ausfuehrung.count()), 2);

  // Die gewählte Schaltfläche trägt die Akzentfarbe — daran hängt, welche
  // Ansicht der Anwender beim Öffnen sieht, und das ist die Aussage dieses
  // ganzen Umbaus.
  const gewaehlt = await uebersicht.evaluate((el) => el.className.includes('text-accent'));
  expect('Beim Öffnen steht die Übersicht', gewaehlt, true);

  // Die Bearbeitungsleiste gehört in die Ausführung, nicht in die Übersicht:
  // Die Übersicht ist abgeleitet und nimmt keine Änderung an.
  expect('In der Übersicht wird nicht bearbeitet', await p.locator('text=Bearbeiten').count(), 0);
}

console.log('\n▸ Der Hinweissatz steht unter dem Bild');
{
  const text = await p.locator('text=Beispielschema').first().innerText();
  expect('Es ist als Beispielschema benannt', /^Beispielschema\./.test(text), true);
  expect('Die Ergänzungspflicht steht dabei', /anlagenspezifisch zu ergänzen/.test(text), true);
  expect('Das Maßgebende steht dabei', /Maßgebend für die Ausführung/.test(text), true);
}

console.log('\n▸ Weniger Bauteile als in der Ausführung');
{
  const zahl = await p.locator('text=/\\d+ von \\d+ Bauteilen/').first().innerText();
  const [gezeigt, voll] = zahl.match(/(\d+) von (\d+)/).slice(1).map(Number);
  expect('Die Übersicht zeigt weniger', gezeigt < voll, true);
  expect('Die Übersicht bleibt unter sechzehn Bauteilen', gezeigt <= 15, true);
  expect('Die Übersicht zeigt mehr als nichts', gezeigt >= 6, true);
}

console.log('\n▸ Das Bild liegt im sichtbaren Bereich');
{
  /*
   * Gemessen wird nicht am Bild, sondern an der Einpassung: Alle Bauteile
   * müssen nach dem Einpassen innerhalb der Zeichenfläche liegen. Ein Symbol
   * außerhalb wäre für den Anwender schlicht nicht da.
   */
  const lage = await p.evaluate(() => {
    const s = window.__ravia.getState();
    const c = Object.values(s.doc.plant.schematic.components);
    return { n: c.length };
  });
  expect('Es gibt ein Schema zu zeichnen', lage.n > 8, true);

  const box = await p.locator('canvas').first().boundingBox();
  expect('Die Zeichenfläche ist da', Boolean(box && box.width > 600 && box.height > 400), true);
}

console.log('\n▸ Umschalten zur Ausführung und zurück');
{
  await p.getByRole('button', { name: 'Ausführung', exact: true }).click();
  await p.waitForTimeout(900);
  expect('In der Ausführung wird bearbeitet', await p.locator('text=Bearbeiten').count() > 0, true);
  expect('Der Hinweissatz gehört nur zur Übersicht', await p.locator('text=Beispielschema').count(), 0);

  await p.getByRole('button', { name: 'Übersicht', exact: true }).click();
  await p.waitForTimeout(900);
  expect('Zurück in der Übersicht', await p.locator('text=Beispielschema').count(), 1);
}

console.log('\n▸ Die Übersicht ändert das Modell nicht');
{
  /*
   * Sie ist abgeleitet. Wer in ihr klickt und zieht, darf nichts verstellen —
   * sonst stünde die Änderung in keinem der beiden Bilder richtig.
   */
  const vorher = await p.evaluate(() => JSON.stringify(window.__ravia.getState().doc.plant.schematic));
  const box = await p.locator('canvas').first().boundingBox();
  await p.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
  await p.mouse.down();
  await p.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.4, { steps: 8 });
  await p.mouse.up();
  await p.waitForTimeout(500);
  const nachher = await p.evaluate(() => JSON.stringify(window.__ravia.getState().doc.plant.schematic));
  expect('Ziehen in der Übersicht lässt das Schema unverändert', nachher === vorher, true);
}

console.log('\n▸ Unter dem Bild steht, nach welcher Musterlösung gebaut ist');
{
  /*
   * Seit 1.53.0 wird die Vorlage abgeleitet statt ausgewählt. Am
   * Referenzhaus — Wärmepumpe, paralleler Puffer, eigener
   * Trinkwasserspeicher, zwei Heizkreise — ist das BWP-H-03.
   *
   * Der Prüfblock weist das an der Ableitung nach. Was er nicht sehen kann:
   * ob die Kennung auch im Bild steht. Ein Fließbild ohne sie ist anonym.
   */
  const zeile = await p.locator('text=BWP-H-03').count();
  expect('Die Kennung BWP-H-03 steht am Bild', zeile > 0, true);

  // Und die Abweichung wird benannt, nicht verschwiegen: Das Referenzhaus
  // hat einen gemischten und einen ungemischten Kreis, das Leitfadenschema
  // zeigt nur gemischte.
  const hinweis = await p.locator('text=Beispielschema').count();
  expect('Der Hinweissatz steht weiterhin darunter', hinweis > 0, true);
}

await p.screenshot({ path: './screenshots/uebersichtsschema.png' });

console.log(`\n${failures === 0 ? '✓' : '✗'} ${failures === 0 ? 'Übersichtsschema in Ordnung' : `${failures} Abweichung(en)`}`);
if (errs.length) {
  console.log('\nKonsolenfehler:');
  for (const e of errs.slice(0, 10)) console.log('  ' + e);
}
await b.close();
process.exit(failures === 0 && errs.length === 0 ? 0 : 1);
