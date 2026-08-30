/**
 * Rauchtest für die Projektmappe.
 *
 * Der Prüfblock `scripts/pruefungen/projektmappe.ts` prüft den Aufbau ohne
 * Browser — Kapitel, Blattnummern, eingesetzte Zeichnungen, Textbausteine.
 * Was er nicht prüfen kann, ist der Weg dorthin: ob der Knopf in der
 * Kopfzeile den Dialog öffnet, ob die Vorschau dasselbe Dokument zeigt, das
 * gebaut wurde, und — das eigentlich Wichtige — ob der Browser die Blätter
 * so setzt, wie die Mappe es vorgibt.
 *
 * Der letzte Punkt ist der Grund für diesen Test. Die Mappe rechnet ihre
 * Blattnummern beim Aufbau aus, ohne DOM und ohne Textmetrik. Trifft ein
 * Zeichnungsblatt nicht genau die Druckseite, entsteht dahinter eine leere
 * Seite oder ein abgeschnittener Plan — und beides sieht im Programm nach
 * nichts aus. Geprüft wird deshalb am gerenderten Dokument: Blattbreite und
 * Blatthöhe der Zeichnungsblätter in Millimetern.
 *
 * Gegen `npx vite preview --port 4177` zu starten.
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
const p = await b.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
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
await p.evaluate(() => window.__ravia.getState().loadDemo());
await p.waitForTimeout(800);

// Eine Mappe ohne Rohrnetz und ohne Schema wäre zur Hälfte aus
// Lückenmeldungen gebaut. Beides wird deshalb zuerst erzeugt — genau in der
// Reihenfolge, in der jemand am Programm arbeitet.
console.log('\n▸ Vorbereitung: Rohrnetz auslegen und Schema erzeugen');
{
  await p.getByTitle(/Rohrnetz automatisch auslegen/).click();
  await p.waitForTimeout(1500);
  const leitungen = await p.evaluate(() => Object.keys(window.__ravia.getState().doc.pipes ?? {}).length);
  expect('Leitungen entstanden', leitungen > 0, true);

  await p.getByRole('button', { name: 'Anlage', exact: true }).click();
  await p.waitForTimeout(400);
  const schemaKnopf = p.getByRole('button', { name: /Schema (neu )?erzeugen/ });
  if (await schemaKnopf.count()) {
    await schemaKnopf.first().click();
    await p.waitForTimeout(1200);
  }
  const bauteile = await p.evaluate(
    () => Object.keys(window.__ravia.getState().doc.plant?.schematic?.components ?? {}).length,
  );
  expect('Schema-Bauteile entstanden', bauteile > 0, true);
}

console.log('\n▸ Die Mappe öffnen');
{
  await p.getByTitle(/^Projektmappe —/).click();
  await p.waitForTimeout(2500);
  expect('Dialog offen', await p.getByText('Projektmappe', { exact: true }).first().isVisible(), true);

  const kopf = await p.evaluate(() => document.querySelector('.panel .text-\\[10\\.5px\\]')?.textContent ?? '');
  expect('Der Kopf nennt Kapitel und Blätter', /\d+ Kapitel · \d+ Blätter/.test(kopf), true);
  expect('Der Kopf nennt das Blattformat', /A4 quer/.test(kopf), true);
}

console.log('\n▸ Inhaltsverzeichnis in der Steuerung');
{
  const seite = await p.evaluate(() => document.body.innerText);
  for (const kapitel of [
    'Grundriss je Geschoss',
    'Anlagenschema',
    'Rohrnetzbericht',
    'Einstellwerte je Heizfläche',
    'Pumpenauslegung und Erzeugerkreis',
    'Massenauszug',
    'Anlagenbuch',
    'Quellenverzeichnis',
    'Nachweiskatalog',
  ]) {
    expect(`Kapitel „${kapitel}" steht in der Übersicht`, seite.includes(kapitel), true);
  }
  expect('Das Anlagenschema meldet keine Lücke mehr', /Anlagenschema \(M 1:/.test(seite), true);
}

console.log('\n▸ Die Vorschau zeigt das gedruckte Dokument');
{
  const rahmen = p.frameLocator('iframe[title="Vorschau der Projektmappe"]');
  await rahmen.locator('#blatt-1').waitFor({ timeout: 15000 });

  const rahmenDaten = await p.evaluate(() => {
    const f = document.querySelector('iframe[title="Vorschau der Projektmappe"]');
    const d = f.contentDocument;
    const px = 96 / 25.4; // 1 mm in CSS-Pixeln
    const alle = [...d.querySelectorAll('.blatt')];
    const zeichnungen = [...d.querySelectorAll('.blatt.zeichnung')];
    return {
      anzahl: alle.length,
      nummern: alle.map((e) => Number(e.id.replace('blatt-', ''))),
      // Zeichnungsblätter müssen genau eine Druckseite füllen — auf den
      // halben Millimeter, sonst entsteht dahinter eine leere Seite.
      breiten: [...new Set(zeichnungen.map((e) => Math.round((e.getBoundingClientRect().width / px) * 2) / 2))],
      hoehen: [...new Set(zeichnungen.map((e) => Math.round((e.getBoundingClientRect().height / px) * 2) / 2))],
      svgs: zeichnungen.length,
      // Jedes Blatt trägt seine Nummer, damit ein herausgelöstes Blatt
      // zuordenbar bleibt.
      mitNummer: alle.filter((e) => /Blatt \d+ von \d+/.test(e.textContent ?? '')).length,
      titel: d.title,
      inhalt: d.querySelector('#blatt-2')?.innerText ?? '',
      nachweis: d.querySelector('.blatt:last-child')?.innerText ?? '',
    };
  });

  expect('Die Vorschau enthält Blätter', rahmenDaten.anzahl > 15, true);
  expect(
    'Die Blattnummern laufen lückenlos ab 1',
    rahmenDaten.nummern.every((n, i) => n === i + 1),
    true,
  );
  expect('Jedes Blatt trägt seine Nummer', rahmenDaten.mitNummer, rahmenDaten.anzahl);
  expect('Es gibt Zeichnungsblätter', rahmenDaten.svgs > 3, true);
  expect('Alle Zeichnungsblätter sind 297 mm breit', rahmenDaten.breiten, [297]);
  expect('Alle Zeichnungsblätter sind 210 mm hoch', rahmenDaten.hoehen, [210]);
  expect('Das Dokument trägt den Projektnamen im Titel', /^Projektmappe /.test(rahmenDaten.titel), true);

  expect('Blatt 2 ist das Inhaltsverzeichnis', rahmenDaten.inhalt.includes('Inhaltsverzeichnis'), true);
  expect('Das Inhaltsverzeichnis nennt die Blattzahl', /\d+ Blätter/.test(rahmenDaten.inhalt), true);
  expect(
    'Das letzte Blatt ist der Nachweiskatalog',
    rahmenDaten.nachweis.includes('§ 60c Abs. 4 GModG'),
    true,
  );
  expect(
    'Der Nachweiskatalog sagt bei jeder Angabe, ob sie vorliegt',
    (rahmenDaten.nachweis.match(/liegt vor|fehlt, weil/g) ?? []).length,
    7,
  );
}

console.log('\n▸ Das Format schlägt auf die Blätter durch');
{
  await p.getByRole('button', { name: 'A3 quer' }).click();
  await p.waitForTimeout(2500);
  const masse = await p.evaluate(() => {
    const d = document.querySelector('iframe[title="Vorschau der Projektmappe"]').contentDocument;
    const px = 96 / 25.4;
    const z = [...d.querySelectorAll('.blatt.zeichnung')];
    return {
      breiten: [...new Set(z.map((e) => Math.round((e.getBoundingClientRect().width / px) * 2) / 2))],
      hoehen: [...new Set(z.map((e) => Math.round((e.getBoundingClientRect().height / px) * 2) / 2))],
    };
  });
  expect('Auf A3 sind die Zeichnungsblätter 420 mm breit', masse.breiten, [420]);
  expect('Auf A3 sind die Zeichnungsblätter 297 mm hoch', masse.hoehen, [297]);
  await p.getByRole('button', { name: 'A4 quer' }).click();
  await p.waitForTimeout(2000);
}

console.log('\nERRORS:', errs.length ? errs.join(' | ') : 'keine');
if (errs.length) failures += errs.length;
console.log(`\n${failures === 0 ? '✓ RAUCHTEST BESTANDEN' : `✗ ${failures} FEHLER`}\n`);
await b.close();
process.exit(failures === 0 ? 0 : 1);
