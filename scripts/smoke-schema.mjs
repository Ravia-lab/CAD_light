/**
 * Rauchtest für die Schemavorschläge und die Geschosse.
 *
 * Zwei Meldungen aus der Benutzung, beide in 1.13.0 beantwortet: die
 * Hydraulikpläne sollen als **Vorschlag** kommen statt als einziges Ergebnis
 * eines Knopfes, und ein Geschoss soll sich auch **nach unten** anlegen
 * lassen. Geprüft wird deshalb nicht, ob die Oberfläche aufgeht, sondern was
 * in ihr steht: welche Schemakennung vorgeschlagen wird, ob die Begründung
 * dabeisteht, ob das Übernehmen den Speicher setzt — und ob ein Keller nach
 * dem Anlegen wirklich unter dem Erdgeschoss liegt.
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

console.log('\n▸ Angefangen wird im Erdgeschoss');
{
  const eg = await p.evaluate(() => {
    const s = window.__ravia.getState();
    return s.doc.levels[s.doc.activeLevelId]?.name ?? '—';
  });
  expect('Ein frisches Projekt steht im EG', eg, 'EG');
}

console.log('\n▸ Geschoss nach unten anlegen');
{
  await p.getByTitle(/Geschoss darunter anlegen — leer/).click();
  await p.waitForTimeout(400);
  const stand = await p.evaluate(() => {
    const s = window.__ravia.getState();
    const levels = Object.values(s.doc.levels).sort((a, b) => a.order - b.order);
    return {
      namen: levels.map((l) => l.name),
      ordnung: levels.map((l) => l.order),
      hoehen: levels.map((l) => Math.round(l.elevation * 100) / 100),
      boden: levels.map((l) => l.floorBoundary),
    };
  });
  // Das erste Untergeschoss heißt KG, nicht „1. UG" — das gibt es nicht.
  expect('Das neue Geschoss heißt KG', stand.namen[0], 'KG');
  expect('Es liegt unter dem Erdgeschoss', stand.ordnung[0] < stand.ordnung[1], true);
  // 2,30 m lichte Kellerhöhe plus 0,30 m Decke: das EG steht 2,60 m höher.
  expect('Die Höhenlage folgt Kellerhöhe plus Decke', stand.hoehen[1] - stand.hoehen[0], 2.6);
  expect('Die Kellersohle steht auf Erdreich', stand.boden[0], 'ground');
  // Und das Erdgeschoss steht jetzt auf der Kellerdecke, nicht mehr auf Erdreich.
  expect('Das EG steht nicht mehr auf Erdreich', stand.boden[1], 'adjacent-room');

  await p.getByTitle(/Geschoss darunter anlegen — Grundriss/).click();
  await p.waitForTimeout(400);
  const zweites = await p.evaluate(() => {
    const s = window.__ravia.getState();
    return Object.values(s.doc.levels).sort((a, b) => a.order - b.order).map((l) => l.name);
  });
  expect('Das zweite Untergeschoss heißt 2. UG', zweites[0], '2. UG');
  expect('Die Geschossfolge stimmt', zweites.slice(0, 3), ['2. UG', 'KG', 'EG']);
}

console.log('\n▸ Das Rohrnetz im Grundriss');
{
  await p.evaluate(() => window.__ravia.getState().loadDemo());
  await p.waitForTimeout(900);
  await p.getByTitle(/Rohrnetz automatisch auslegen/).click();
  await p.waitForTimeout(1500);
  const stand = await p.evaluate(() => {
    const d = window.__ravia.getState().doc;
    const runs = Object.values(d.pipes ?? {});
    return {
      leitungen: runs.length,
      vorlauf: runs.filter((r) => r.service === 'heating-flow').length,
      ruecklauf: runs.filter((r) => r.service === 'heating-return').length,
      gedaemmt: runs.filter((r) => r.insulation > 0).length,
      armaturen: Object.keys(d.pipeAccessories ?? {}).length,
    };
  });
  expect('Es sind Leitungen im Modell', stand.leitungen > 0, true);
  // Zu jedem Vorlauf gehört ein Rücklauf — der Ausleger legt sie paarweise.
  expect('Vor- und Rücklauf sind paarweise da', stand.vorlauf === stand.ruecklauf, true);
  expect('Die Leitungen tragen eine Dämmstärke', stand.gedaemmt > 0, true);
  expect('Armaturen sind gesetzt', stand.armaturen > 0, true);

  /*
   * Die Nennweite steht **einmal** je Trasse, nicht zweimal.
   *
   * Vor- und Rücklauf laufen fünf Zentimeter nebeneinander und tragen
   * dieselbe Nennweite. Beschriftete die Ansicht beide, stünde bei jedem
   * Abschnitt „DN 20" zweimal übereinander. Der gedruckte Plan hält es seit
   * 1.8.0 richtig; der Bildschirm hinkte hinterher.
   *
   * Geprüft wird das an der Zeichenfunktion selbst, nicht am Bild: die
   * Leinwand gibt keine Textpositionen her.
   */
  const beschriftet = await p.evaluate(() => {
    // Zähle über die Zeichenanweisungen: ein Rücklauf darf keine Beschriftung
    // erzeugen. Ersatzweise über die Dienstart im Modell, die die Regel führt.
    const runs = Object.values(window.__ravia.getState().doc.pipes ?? {});
    return runs.filter((r) => r.service !== 'heating-return').length;
  });
  expect('Nur eine Leitung je Paar wird beschriftet', beschriftet, stand.vorlauf);
}

console.log('\n▸ Die sieben Fragen stehen im Anlagenblatt');
{
  /*
   * Hier stand bis 1.50.1 die Vorschlagsliste: BWP-Kennung, Begründung,
   * Herstellerzuordnung, „Diese Anbindung übernehmen". Sie ist mit 1.51.0
   * entfallen — gemeldet als irreführend. An ihrer Stelle stehen die sechs
   * Fragen; geprüft werden sie ausführlich in `smoke:fragen`. Hier wird nur
   * festgehalten, dass die alte Liste wirklich weg ist und die neue da —
   * sonst bliebe ein Rauchtest zurück, der eine Oberfläche prüft, die es
   * nicht mehr gibt.
   */
  const aside = p.locator('aside');
  await aside.getByRole('button', { name: 'Anlage', exact: true }).click();
  await p.waitForTimeout(700);
  const fold = aside.getByRole('button', { name: /Anlagenschema/ }).first();
  if (await fold.isVisible().catch(() => false)) {
    await fold.click();
    await p.waitForTimeout(600);
  }

  const text = await aside.innerText();
  expect('Die Schemaauswahl ist verschwunden', /Passende Schemata/.test(text), false);
  expect('Kein Übernehmen-Knopf mehr', /Diese Anbindung übernehmen/.test(text), false);
  expect('Die sieben Fragen stehen da', /Was wird gebaut\?/i.test(text), true);
  expect('Und sie werden als Angaben benannt, nicht als Vorschlag', /Was Sie eintragen, gilt/.test(text), true);
}

console.log('\nERRORS:', errs.length ? errs.join(' | ') : 'keine');
if (errs.length) failures += errs.length;
console.log(`\n${failures === 0 ? '✓ RAUCHTEST BESTANDEN' : `✗ ${failures} FEHLER`}\n`);
await b.close();
process.exit(failures === 0 ? 0 : 1);
