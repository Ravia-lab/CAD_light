/**
 * Rauchtest für den Anlagendialog — wird gefragt, statt verwiesen?
 *
 * **Was der Prüfblock nicht sehen kann.** `anlagenfragen` hält fest, was aus
 * welcher Antwort entsteht, und `hatHeizstab` ist dort von Hand abgezählt.
 * Ob der Bogen aber **aufgeht**, wenn noch kein Schema da ist, ob er nach dem
 * Schließen in Ruhe lässt, ob der Weg zurück führt und ob der Knopf darin
 * wirklich ein Bild erzeugt — das steht in keinem Prüfblock. Es ist genau
 * das, was gemeldet wurde: „die abfragen in der seitenleiste, das geht
 * schnell unter".
 *
 * **Auf Tablet-Maß**, weil der Mangel dort auftrat und weil ein Dialog, der
 * am 1600er Schirm passt, auf 1180 Pixeln über den Rand laufen kann.
 *
 * Die wichtigste Prüfung ist die dritte: Ein Dialog, der beim zweiten
 * Ansehen wieder aufgeht, wird weggetippt — und dann auch beim zwanzigsten
 * Mal, an dem er nötig gewesen wäre.
 */

import { chromium } from 'playwright';

const BASIS = process.env.RAVIA_PROBE ?? 'http://localhost:4177/';

const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
// Tablet quer — dasselbe Maß wie in `smoke-entfernen`.
const p = await b.newPage({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, hasTouch: true });
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

/** Das Demohaus bringt ein Schema mit — für den leeren Fall wird es geleert. */
const leeren = () => p.evaluate(() => window.__ravia.getState().setSchematic([], [], false, undefined));
const dialog = () => p.locator('[data-pruef="anlagendialog"]');

const zurSchemaAnsicht = async () => {
  await p.getByRole('button', { name: 'Schema', exact: true }).first().click();
  await p.waitForTimeout(900);
};

console.log('\n▸ Ohne Schema wird gefragt, nicht verwiesen');
{
  await leeren();
  await p.waitForTimeout(300);
  await zurSchemaAnsicht();

  expect('Der Anlagendialog geht von selbst auf', await dialog().count(), 1);
  expect('Er fragt nach dem Technikraum', await p.locator('text=Was steht im Technikraum?').count(), 1);
  expect(
    'Der alte Verweis auf den Reiter „Anlage" ist weg',
    await p.locator('text=Im Reiter „Anlage“ das Gerät wählen').count(),
    0,
  );

  // Alle sieben Angaben liegen auf einem Blatt — kein Assistent.
  for (const feld of [
    'frage-bauform',
    'frage-kaeltemittel',
    'frage-inneneinheit',
    'frage-trinkwasser',
    'frage-puffer',
  ]) {
    expect(`Feld „${feld}" liegt im Dialog`, await dialog().locator(`[data-pruef="${feld}"]`).count(), 1);
  }
  expect('Die Heizkreise stehen auch darin', await dialog().locator('text=5 · Heizkreise').count(), 1);

  /*
   * **Und zwar sichtbar.** Der erste Entwurf setzte den Puffer aus
   * Platzgründen neben den Trinkwasserspeicher; damit stand auf dem Blatt
   * nach der 4 die 6, und die 5 lag unter der Faltkante — genau der Mangel,
   * gegen den dieser Dialog gebaut ist. Ein Feld, das man erst durch Scrollen
   * findet, geht ebenso unter wie eines in einem Reiter unter vierzehn.
   *
   * Geprüft wird deshalb am **Bildschirm** und nicht am Vorhandensein: Jede
   * der sieben Angaben muss beim Aufgehen des Dialogs im Fenster liegen.
   */
  /*
   * **Gemessen wird ohne Playwright zu Hilfe.** `locator.boundingBox()` rollt
   * das Feld erst ins Bild und meldet danach, dass es im Bild liegt — die
   * Prüfung wäre immer grün, auch für ein Feld unter der Faltkante. Genau so
   * ist der erste Entwurf durchgerutscht. `getBoundingClientRect` im Fenster
   * selbst rollt nichts.
   */
  const imFenster = await dialog().evaluate((el) => {
    const h = window.innerHeight;
    const lies = (auswahl) => {
      const k = el.querySelector(auswahl)?.getBoundingClientRect();
      return k ? k.top >= 0 && k.bottom <= h : null;
    };
    const kreise = Array.from(el.querySelectorAll('.label-xs')).find((x) => x.textContent?.startsWith('5 ·'));
    const block = kreise?.parentElement?.getBoundingClientRect();
    return {
      1: lies('[data-pruef="frage-bauform"]'),
      2: lies('[data-pruef="frage-kaeltemittel"]'),
      3: lies('[data-pruef="frage-inneneinheit"]'),
      4: lies('[data-pruef="frage-trinkwasser"]'),
      5: block ? block.top >= 0 && block.bottom <= h : null,
      6: lies('[data-pruef="frage-puffer"]'),
    };
  });
  for (const nr of [1, 2, 3, 4, 5, 6]) {
    expect(`Frage ${nr} liegt ohne Blättern im Fenster`, imFenster[nr], true);
  }

  /*
   * Und die Gegenprobe am Feld als Ganzem: Das **Raster der Fragen** muss
   * vollständig im Fenster liegen, nicht nur jedes Feld für sich. Einzeln
   * gemessene Felder könnten theoretisch je für sich sichtbar sein, während
   * das Raster unten abgeschnitten ist.
   *
   * Der Kasten „Was die Auslegung dazu sagt" darunter darf blättern. Er ist
   * kein Eingabefeld, sondern eine Auskunft, und seine Länge hängt daran,
   * wie viele Abweichungen es gibt — sie lässt sich nicht deckeln, ohne
   * Sätze wegzulassen.
   */
  const raster = await dialog().evaluate((el) => {
    const g = el.querySelector('[data-pruef="frage-bauform"]')?.closest('.grid');
    const b = el.querySelector('.overflow-y-auto');
    if (!g || !b) return null;
    const kg = g.getBoundingClientRect();
    const kb = b.getBoundingClientRect();
    // Gemessen wird gegen den **Behälter**, nicht gegen das Fenster: Ein
    // Raster kann im Fenster liegen und trotzdem vom Rollbereich unten
    // abgeschnitten sein. Genau daran ist der zweite Entwurf vorbeigelaufen.
    return { ueberstand: Math.round(kg.bottom - kb.bottom), oben: Math.round(kb.top - kg.top) };
  });
  expect(
    'Das Raster der Fragen wird unten nicht abgeschnitten',
    raster !== null && raster.ueberstand <= 1,
    true,
  );
  expect('Und oben auch nicht', raster !== null && raster.oben <= 1, true);

  // Und die Nummern stehen in ihrer Reihenfolge auf dem Blatt.
  const reihenfolge = await dialog().evaluate((el) =>
    Array.from(el.querySelectorAll('.label-xs'))
      .map((x) => x.textContent?.trim() ?? '')
      .filter((t) => /^\d+ · /.test(t))
      .map((t) => Number(t.split(' ')[0])),
  );
  expect('Die Fragen stehen in ihrer Nummernfolge', reihenfolge, [1, 2, 3, 4, 5, 6]);
  expect('Kein Weiter-Knopf — es ist ein Blatt', await dialog().getByRole('button', { name: 'Weiter' }).count(), 0);

  // Und er passt aufs Tablet: kein Rand außerhalb des Fensters.
  const kasten = await dialog().locator('> div').boundingBox();
  expect('Der Dialog passt in die Breite', kasten.x >= 0 && kasten.x + kasten.width <= 1180, true);
  expect('Und in die Höhe', kasten.y >= 0 && kasten.y + kasten.height <= 820, true);
}

console.log('\n▸ Eine Antwort darin kommt im Projekt an');
{
  await dialog().locator('[data-pruef="frage-inneneinheit"]').selectOption('heizstab-speicher');
  await p.waitForTimeout(500);
  const stand = await p.evaluate(() => window.__ravia.getState().doc.plant.antworten?.inneneinheit ?? null);
  expect('Die siebte Antwort steht im Projekt', stand, 'heizstab-speicher');
}

console.log('\n▸ Der Knopf erzeugt das Bild und schließt');
{
  await dialog().locator('[data-pruef="dialog-erzeugen"]').click();
  await p.waitForTimeout(900);
  const bauteile = await p.evaluate(
    () => Object.keys(window.__ravia.getState().doc.plant.schematic.components).length,
  );
  expect('Es sind Bauteile entstanden', bauteile > 0, true);
  expect('Der Dialog ist zu', await dialog().count(), 0);
}

console.log('\n▸ Der Heizstab folgt der Antwort');
{
  /*
   * „Heizstab im Speicher" steht noch aus dem Schritt davor. Im Bild muss
   * der Stab deshalb am Behälter hängen und nicht in der Leitung — der
   * zweite Einbauort der BWP-Legende. Nachgewiesen am Beitext, weil er die
   * Entscheidung benennt.
   */
  const stab = await p.evaluate(() => {
    const c = Object.values(window.__ravia.getState().doc.plant.schematic.components);
    const s = c.find((x) => x.kind === 'electric-heater');
    return s ? { da: true, spec: s.spec ?? '' } : { da: false, spec: '' };
  });
  expect('Der Heizstab ist gezeichnet', stab.da, true);
  expect('Und er sitzt im Speicher', /[Ss]peicher/.test(stab.spec), true);

  // Jetzt „ohne Heizstab" — dann darf er nicht mehr im Bild stehen, auch
  // wenn das gewählte Gerät einen führt. Das ist die Festlegung „was
  // eingetragen ist, gilt", am Bild nachgewiesen.
  await p.locator('[data-pruef="angaben-aendern"]').click();
  await p.waitForTimeout(600);
  await dialog().locator('[data-pruef="frage-inneneinheit"]').selectOption('ohne-heizstab');
  await p.waitForTimeout(400);
  await dialog().locator('[data-pruef="dialog-erzeugen"]').click();
  await p.waitForTimeout(900);

  const ohne = await p.evaluate(
    () =>
      Object.values(window.__ravia.getState().doc.plant.schematic.components).filter(
        (x) => x.kind === 'electric-heater',
      ).length,
  );
  expect('Ohne Heizstab steht keiner im Bild', ohne, 0);
}

console.log('\n▸ Beim zweiten Ansehen bleibt er zu');
{
  // Weg von der Schema-Ansicht und zurück — mit vorhandenem Schema darf
  // nichts von selbst aufgehen.
  await p.getByRole('button', { name: '2D', exact: true }).first().click();
  await p.waitForTimeout(500);
  await zurSchemaAnsicht();
  expect('Kein Dialog über dem fertigen Bild', await dialog().count(), 0);
  expect('Aber der Weg zurück steht da', await p.locator('[data-pruef="angaben-aendern"]').count(), 1);

  await p.locator('[data-pruef="angaben-aendern"]').click();
  await p.waitForTimeout(600);
  expect('Und er führt zu denselben Feldern', await dialog().locator('[data-pruef="frage-inneneinheit"]').count(), 1);
}

console.log('\n▸ Wer nur schauen will, wird nicht festgehalten');
{
  await dialog().getByRole('button', { name: 'Schließen', exact: true }).click();
  await p.waitForTimeout(400);
  expect('Schließen schließt', await dialog().count(), 0);

  // Und der leere Fall: einmal von selbst, danach nicht mehr.
  await leeren();
  await p.waitForTimeout(600);
  expect('Über dem leeren Blatt geht er wieder auf', await dialog().count(), 1);
  await dialog().getByRole('button', { name: 'Schließen', exact: true }).click();
  await p.waitForTimeout(500);
  expect('Nach dem Schließen bleibt er zu', await dialog().count(), 0);
  expect('Das leere Blatt bietet ihn weiter an', await p.locator('[data-pruef="leer-angaben"]').count(), 1);
  await p.locator('[data-pruef="leer-angaben"]').click();
  await p.waitForTimeout(500);
  expect('Und der Knopf holt ihn zurück', await dialog().count(), 1);
}

await p.screenshot({ path: './screenshots/anlagendialog.png' });

console.log(`\n${failures === 0 ? '✓' : '✗'} ${failures === 0 ? 'Anlagendialog in Ordnung' : `${failures} Abweichung(en)`}`);
if (errs.length) {
  console.log('\nKonsolenfehler:');
  for (const e of errs.slice(0, 10)) console.log('  ' + e);
}
await b.close();
process.exit(failures === 0 && errs.length === 0 ? 0 : 1);
