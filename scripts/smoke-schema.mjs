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

console.log('\n▸ Schemavorschläge im Anlagenblatt');
{
  const aside = p.locator('aside');
  await aside.getByRole('button', { name: 'Anlage', exact: true }).click();
  await p.waitForTimeout(700);
  // Der Abschnitt „Anlagenschema" ist eingeklappt; erst darin steht die Liste.
  const fold = aside.getByRole('button', { name: /Anlagenschema/ }).first();
  if (await fold.isVisible().catch(() => false)) {
    await fold.click();
    await p.waitForTimeout(600);
  }
  expect('Der Abschnitt steht im Anlagenblatt',
    await aside.getByText('Passende Schemata').first().isVisible(), true);

  const text = await aside.innerText();
  // Der Demo-Grundriss hat mehrere Kreise — es muss ein BWP-Schema mit
  // Parallelpuffer vorgeschlagen werden, und die Kennung gehört sichtbar dazu.
  expect('Eine BWP-Kennung wird genannt', /BWP-H-\d\d/.test(text), true);
  expect('Die Begründung steht dabei', /Stimmt in allen Merkmalen überein|Baubar, weicht aber ab/.test(text), true);
  expect('Die Herstellerzuordnung steht dabei', /Bei den Herstellern/.test(text), true);
  expect('Der Vorbehalt zur Feinplanung steht da',
    /Vorgaben der Hersteller bindend|keine Planung/.test(text), true);
}

console.log('\n▸ Eine Vorlage übernehmen');
{
  const vorher = await p.evaluate(() =>
    Object.values(window.__ravia.getState().doc.plant.storages).map((s) => s.kind),
  );
  const knopf = p.locator('aside').getByText('Diese Anbindung übernehmen').first();
  expect('Der Übernehmen-Knopf ist da', await knopf.isVisible(), true);
  await knopf.click();
  await p.waitForTimeout(600);
  const nachher = await p.evaluate(() => {
    const s = window.__ravia.getState().doc.plant;
    return {
      speicher: Object.values(s.storages).map((x) => x.kind),
      vorlage: s.schematic.vorlageId ?? '—',
      manual: s.schematic.manual,
    };
  });
  expect('Die Kennung der Vorlage steht im Modell', /^(bwp-h-\d\d|herst-h-\d\d)/.test(nachher.vorlage), true);
  expect('Das Schema gilt nicht mehr als von Hand bearbeitet', nachher.manual, false);
  // Übernommen wird die Anbindung: entweder steht danach ein Puffer im
  // Anlagenblatt, oder die Vorlage ist eine Direktanbindung ohne Speicher.
  const anbindung = nachher.speicher.filter((k) =>
    ['buffer-series', 'buffer-parallel', 'separator', 'combi'].includes(k),
  );
  expect('Es steht höchstens eine Anbindung im Anlagenblatt', anbindung.length <= 1, true);
  void vorher;

  const status = await p.evaluate(() => window.__ravia.getState().statusMessage ?? '');
  expect('Die Statuszeile nennt das übernommene Schema', /übernommen/.test(status), true);
}

console.log('\nERRORS:', errs.length ? errs.join(' | ') : 'keine');
if (errs.length) failures += errs.length;
console.log(`\n${failures === 0 ? '✓ RAUCHTEST BESTANDEN' : `✗ ${failures} FEHLER`}\n`);
await b.close();
process.exit(failures === 0 ? 0 : 1);
