/**
 * Rauchtest für die sechs Anlagenfragen.
 *
 * Der Prüfblock `anlagenfragen` hält die Ableitung fest — was aus welcher
 * Antwort entsteht. Was er nicht sehen kann, ist das Blatt: ob das Feld
 * aufgeht, ob die alte Schemaauswahl wirklich verschwunden ist, ob eine
 * geänderte Antwort im Modell ankommt, ob sie das Öffnen übersteht und ob
 * der Abweichungshinweis erscheint, ohne die Antwort anzufassen.
 *
 * Die letzte Prüfung ist die wichtigste: „Die Antwort gilt" ist eine
 * Festlegung, die man nur am laufenden Programm nachweisen kann.
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
await aside.getByRole('button', { name: 'Anlage', exact: true }).click();
await p.waitForTimeout(800);

console.log('\n▸ Das Feld steht da, der Katalog nicht mehr');
{
  expect('Die sechs Fragen sind da', await p.locator('text=Was wird gebaut?').count(), 1);
  expect('Die Schemaauswahl ist weg', await p.locator('text=Passende Schemata').count(), 0);
  expect('„Diese Anbindung übernehmen" ist weg', await p.locator('text=Diese Anbindung übernehmen').count(), 0);
  expect('„nicht passende zeigen" ist weg', await p.locator('text=nicht passende zeigen').count(), 0);

  for (const frage of [
    'Bauart des Wärmeerzeugers',
    'Kältemittel',
    'Heizstab als Zusatzheizer',
    'Trinkwasserspeicher',
    'Heizkreise',
    'Pufferspeicher',
  ]) {
    expect(`Frage „${frage}" steht im Feld`, (await p.locator(`text=${frage}`).count()) > 0, true);
  }
}

console.log('\n▸ Eine Antwort kommt im Modell an');
{
  // Trinkwasserspeicher auf 300 l — das Auswahlfeld hinter der vierten Frage.
  const feld = p.locator('select').filter({ has: p.locator('option', { hasText: 'keiner' }) }).first();
  await feld.selectOption('300');
  await p.waitForTimeout(600);

  const stand = await p.evaluate(() => {
    const plant = window.__ravia.getState().doc.plant;
    const tww = Object.values(plant.storages).find((s) => s.kind === 'dhw-cylinder');
    return { antwort: plant.antworten?.trinkwasserLiter ?? null, speicher: tww?.volume ?? null };
  });
  expect('Die Antwort steht im Projekt', stand.antwort, 300);
  expect('Der Speicher ist entstanden', stand.speicher, 300);
}

console.log('\n▸ Und übersteht Speichern und Öffnen');
{
  const gleich = await p.evaluate(() => {
    const s = window.__ravia.getState();
    const json = JSON.parse(JSON.stringify(s.doc));
    s.loadProject(json);
    return window.__ravia.getState().doc.plant.antworten?.trinkwasserLiter ?? null;
  });
  expect('Nach dem Öffnen steht dieselbe Antwort da', gleich, 300);
}

console.log('\n▸ Zwei Heizkreise, einer gemischt');
{
  await p.getByRole('button', { name: 'zwei Kreise', exact: true }).click();
  await p.waitForTimeout(600);
  const kreise = await p.evaluate(() => {
    const c = Object.values(window.__ravia.getState().doc.plant.circuits);
    return { anzahl: c.length, gemischt: c.filter((x) => x.mixed).length };
  });
  expect('Es sind zwei Kreise', kreise.anzahl, 2);
  expect('Einer davon ist gemischt', kreise.gemischt, 1);
}

console.log('\n▸ Die Antwort gilt, auch wenn die Auslegung anders rechnet');
{
  /*
   * Puffer auf den kleinsten Wert stellen. Rechnet die Auslegung mehr,
   * erscheint ein Hinweis — die eingetragene Zahl darf er nicht anfassen.
   */
  const puffer = p.locator('select').filter({ has: p.locator('option', { hasText: '800 l' }) }).first();
  await puffer.selectOption('0');
  await p.waitForTimeout(700);

  const stand = await p.evaluate(() => {
    const plant = window.__ravia.getState().doc.plant;
    const puf = Object.values(plant.storages).find((s) => s.kind.startsWith('buffer'));
    return { antwort: plant.antworten?.pufferLiter ?? null, speicher: puf?.volume ?? null };
  });
  expect('„kein Puffer" steht im Projekt', stand.antwort, 0);
  expect('Und es ist keiner angelegt', stand.speicher, null);

  /*
   * Die Auslegung des Referenzhauses fordert einen Puffer (Mindestlaufzeit
   * bei 5 K Spreizung). Der Hinweis muss deshalb erscheinen — und die
   * Antwort trotzdem auf 0 stehen bleiben. Das ist die Festlegung „die
   * Antwort gilt", nachgewiesen am laufenden Programm.
   */
  expect('Der Abweichungshinweis erscheint', await p.locator('text=Was die Auslegung dazu sagt').count(), 1);
  const nachher = await p.evaluate(() => window.__ravia.getState().doc.plant.antworten?.pufferLiter ?? null);
  expect('Der Hinweis hat die Antwort nicht verändert', nachher, 0);
  expect(
    'Und er sagt ausdrücklich, dass es bei der Antwort bleibt',
    (await p.locator('text=Es bleibt bei Ihren Angaben').count()) > 0,
    true,
  );
}

await p.screenshot({ path: './screenshots/anlagenfragen.png' });

console.log(`\n${failures === 0 ? '✓' : '✗'} ${failures === 0 ? 'Anlagenfragen in Ordnung' : `${failures} Abweichung(en)`}`);
if (errs.length) {
  console.log('\nKonsolenfehler:');
  for (const e of errs.slice(0, 10)) console.log('  ' + e);
}
await b.close();
process.exit(failures === 0 && errs.length === 0 ? 0 : 1);
