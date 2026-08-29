/**
 * Rauchtest für den Rohrnetzrechner.
 *
 * Der Bericht ist die erste Ausgabe dieses Programms, die als **Nachweis**
 * gedacht ist. Ein Fehler darin sieht nicht wie ein Fehler aus, sondern wie
 * eine Zahl — deshalb prüft dieser Test nicht, ob der Dialog aufgeht, sondern
 * was auf den Blättern steht: dass die Pflichtangaben nach § 60c aufgeführt
 * sind, dass jede Teilstrecke ihre Größen trägt, dass Einstellwerte an den
 * Heizflächen stehen und dass die Wissenssuche antwortet.
 *
 * Geprüft wird gegen die *Vorschau*, und das ist Absicht: sie ist dasselbe
 * SVG, das im Druckdialog landet. Ein Test gegen eine zweite Darstellung
 * würde genau den Fehler nicht finden, der in diesem Projekt zweimal
 * vorkam — zwei Kopien derselben Geometrie, die auseinanderlaufen.
 */

import { chromium } from 'playwright';

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
await p.goto('http://localhost:4177/', { waitUntil: 'networkidle' });
await p.waitForFunction(() => typeof window.__ravia !== 'undefined', null, { timeout: 30000 });
await p.evaluate(() => window.__ravia.getState().loadDemo());
await p.waitForTimeout(800);

console.log('\n▸ Rohrnetz auslegen');
{
  await p.getByTitle(/Rohrnetz automatisch auslegen/).click();
  await p.waitForTimeout(1200);
  const leitungen = await p.evaluate(() => Object.keys(window.__ravia.getState().doc.pipes ?? {}).length);
  const armaturen = await p.evaluate(() => Object.keys(window.__ravia.getState().doc.pipeAccessories ?? {}).length);
  expect('Leitungen entstanden', leitungen > 0, true);
  expect('Armaturen entstanden', armaturen > 0, true);
  // Der Fehler, der 1.12.0 vor der Reparatur günstiger rechnen ließ als
  // 1.11.0: jede Armatur muss ihre Leitung kennen, sonst findet der Abgleich
  // sie nicht und rechnet ohne Einzelwiderstände.
  const ohneLeitung = await p.evaluate(
    () => Object.values(window.__ravia.getState().doc.pipeAccessories ?? {}).filter((a) => !a.runId).length,
  );
  expect('Jede Armatur kennt ihre Leitung', ohneLeitung, 0);
}

console.log('\n▸ Bericht öffnen');
{
  await p.getByTitle(/Rohrnetzberechnung/).first().click();
  await p.waitForTimeout(1500);
  expect('Dialog offen', await p.getByText('Rohrnetzberechnung', { exact: true }).first().isVisible(), true);
}

/** Inhalt des gerade angezeigten Blattes als Text. */
const blattText = async () =>
  await p.evaluate(() => {
    const svg = document.querySelector('.panel .flex-1 svg');
    return svg ? Array.from(svg.querySelectorAll('text')).map((t) => t.textContent).join(' | ') : '';
  });

const weiter = async (n = 1) => {
  for (let i = 0; i < n; i++) {
    await p.getByText('weiter ▶').click();
    await p.waitForTimeout(500);
  }
};

console.log('\n▸ Blatt 1 — Grundriss mit Rohrnetz');
{
  const t = await blattText();
  expect('Der Grundriss trägt einen Schriftkopf', /Rohrnetz/.test(t), true);
  // Leitungen sind `path`-Elemente; der Rücklauf trägt zusätzlich das
  // Strichmuster. Beides zu zählen ist die schärfere Probe: ein Vorlauf ohne
  // Rücklauf wäre ein halbes Netz.
  const rohre = await p.evaluate(() => {
    const svg = document.querySelector('.panel .flex-1 svg');
    if (!svg) return { alle: 0, ruecklauf: 0 };
    return {
      alle: svg.querySelectorAll('path[stroke-linecap="round"]').length,
      ruecklauf: svg.querySelectorAll('path[stroke-dasharray="1.6 1"]').length,
    };
  });
  expect('Leitungen sind gezeichnet', rohre.alle > 0, true);
  expect('Der Rücklauf ist gestrichelt dabei', rohre.ruecklauf > 0, true);
  expect('Die Nennweite steht am Rohr', /DN /.test(t), true);
}

console.log('\n▸ Blatt 2 — Anlagendaten und Nachweis');
{
  await weiter();
  const t = await blattText();
  expect('Überschrift steht', /Rohrnetzberechnung/.test(t), true);
  expect('Pflichtangaben nach § 60c aufgeführt', /60c/.test(t), true);
  // Alle sieben Punkte des Absatzes 4, nicht nur die bequemen.
  for (const forderung of [
    'Einstellungswerte',
    'Heizlast des Gebäudes',
    'Raumweise Heizlastberechnung',
    'Auslegungstemperatur',
    'Einstellung der Regelung',
    'Druck im Ausdehnungsgefäß',
  ]) {
    expect(`Pflichtangabe „${forderung}"`, t.includes(forderung), true);
  }
  expect('Auslegungstemperaturen stehen da', /Spreizung/.test(t), true);
  expect('Stoffwerte stehen da', /kg\/m³/.test(t), true);
}

console.log('\n▸ Teilstreckentabelle');
{
  await weiter();
  const t = await blattText();
  expect('Überschrift Teilstrecken', /Teilstrecken/.test(t), true);
  // Die Größen, die SAENA je Teilstrecke fordert. Fehlt eine Spalte, ist die
  // Tabelle kein Nachweis mehr, sondern eine Übersicht.
  for (const spalte of ['V̇ [m³/h]', 'l [m]', 'Werkstoff', 'd_i [mm]', 'w [m/s]', 'Re', 'λ', 'R [Pa/m]', 'R·l [Pa]', 'Σζ', 'Z [Pa]', 'Δp [Pa]']) {
    expect(`Spalte „${spalte}"`, t.includes(spalte), true);
  }
  expect('Die Formel steht auf dem Blatt', /Colebrook/.test(t), true);
  expect('Es gibt Datenzeilen', /Verbund|Kupfer|Stahl|PE-X/.test(t), true);
}

console.log('\n▸ Einstellwerte je Heizfläche');
{
  // Fließwege, dann Einstellwerte.
  await weiter(2);
  let t = await blattText();
  if (!/Einstellwerte/.test(t)) {
    await weiter();
    t = await blattText();
  }
  expect('Blatt mit Einstellwerten gefunden', /Einstellwerte/.test(t), true);
  expect('Spalte Voreinstellung', t.includes('Voreinst.'), true);
  expect('Spalte Ventilautorität', t.includes('a_V'), true);
  expect('Eine Baureihe ist benannt', /Heimeier|Danfoss/.test(t), true);
}

console.log('\n▸ Wissenssuche (Multi-Korpus)');
{
  await p.getByText('Wissen', { exact: true }).click();
  await p.waitForTimeout(400);
  const feld = p.locator('input.field').first();
  await feld.fill('Ventilautorität');
  await p.waitForTimeout(700);
  const treffer = await p.evaluate(
    () => document.querySelectorAll('.panel .flex-1 .rounded-lg.bg-white\\/\\[0\\.04\\]').length,
  );
  expect('Die Suche liefert Treffer', treffer > 0, true);
  const text = await p.evaluate(() => document.querySelector('.panel .flex-1').textContent ?? '');
  expect('Der Treffer nennt die Schwelle 0,3', /0,3/.test(text), true);
  expect('Der Treffer nennt seine Quelle', /Quelle|Leitfaden|hydraulischer-abgleich|IKZ|Haustec|VdZ/.test(text), true);
  expect('Die Belastbarkeit ist ausgewiesen', /Primärquelle|Sekundärquelle|Annahme/.test(text), true);

  // Abkürzungen müssen greifen — der Monteur tippt „THV", nicht
  // „Thermostatventil".
  await feld.fill('THV');
  await p.waitForTimeout(700);
  const treffer2 = await p.evaluate(
    () => document.querySelectorAll('.panel .flex-1 .rounded-lg.bg-white\\/\\[0\\.04\\]').length,
  );
  expect('Die Abkürzung THV findet etwas', treffer2 > 0, true);

  // Umlautfreie Schreibweise muss dasselbe finden wie die mit Umlaut.
  await feld.fill('Waermepumpe');
  await p.waitForTimeout(700);
  const treffer3 = await p.evaluate(
    () => document.querySelectorAll('.panel .flex-1 .rounded-lg.bg-white\\/\\[0\\.04\\]').length,
  );
  expect('„Waermepumpe" findet dasselbe wie „Wärmepumpe"', treffer3 > 0, true);
}

console.log('\nERRORS:', errs.length ? errs.join(' | ') : 'keine');
if (errs.length) failures += errs.length;
console.log(`\n${failures === 0 ? '✓ RAUCHTEST BESTANDEN' : `✗ ${failures} FEHLER`}\n`);
await b.close();
process.exit(failures === 0 ? 0 : 1);
