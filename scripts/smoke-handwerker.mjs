/**
 * Rauchtest „Handwerker" — der Weg, den ein Monteur mit einem Tablet geht.
 *
 * **Warum dieser Test auf Tabletmaß läuft und mit Fingerereignissen.** Die
 * fünf Änderungen der Fassung 1.32.0 sind alle erst auf einem Gerät ohne
 * Maus und ohne Stift zu prüfen:
 *
 *  1. Ein **Fingertipp** wählt aus und setzt — er zeichnet weiterhin nicht.
 *  2. Das **Raumbuch** nimmt Name, Nutzung und Heizleistung an.
 *  3. Die **Einführung** fragt nach der Rolle und stellt die Ansicht danach.
 *  4. Die **Kopfleiste** zeigt im Handwerkermodus nur noch, was zum Aufmaß
 *     gehört.
 *  5. Die **Tür** sagt, wohin sie aufgeht, statt „spiegeln" anzubieten.
 *
 * Jede dieser Zusagen lässt sich mit einem Klick-Rauchtest nicht prüfen: Ein
 * Playwright-Klick ist eine Maus, und die durfte immer alles. Deshalb werden
 * hier — wie in `smoke-tablet.mjs` — echte `PointerEvent`s mit `pointerType`
 * ausgelöst.
 *
 * Aufruf:
 *     npx vite preview --port 4177 &
 *     node scripts/smoke-handwerker.mjs
 *   oder gegen einen echten Server:
 *     RAVIA_PROBE=https://ravia-tech.de/Cad_light/ node scripts/smoke-handwerker.mjs
 */

import { chromium } from 'playwright';

const BASIS = process.env.RAVIA_PROBE ?? 'http://localhost:4177/';

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});

let failures = 0;
const expect = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? '✓' : '✗'} ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (erwartet ${JSON.stringify(expected)})`}`);
};

// iPad quer. Unter 1024 px wird der Inspektor zur Schublade; das ist ein
// eigener Fall und steht in `smoke-tablet.mjs`.
const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true });
const p = await ctx.newPage();
const fehler = [];
p.on('pageerror', (e) => fehler.push('PAGEERROR ' + e.message));
p.on('console', (m) => {
  if (m.type() === 'error' && !/ERR_CONNECTION_RESET/.test(m.text())) fehler.push(m.text());
});
p.on('dialog', (d) => d.accept());

/**
 * Ein Zeigerereignis auf dem Zeichenblatt, an einem Punkt im Modellraum.
 *
 * `art` ist 'touch' oder 'pen'. `weg` schiebt den Zeiger vor dem Abheben um
 * so viele Bildpunkte weiter — damit lässt sich ein Schwenk von einem Tipp
 * unterscheiden, ohne auf die Uhr zu sehen.
 *
 * Die Zeigerkennung ist bewusst 1: Chromium kennt nur zu dieser einen einen
 * echten Zeiger, und `setPointerCapture` wirft bei jeder anderen.
 */
const zeigen = (X, Y, art, weg = 0) =>
  p.evaluate(
    async ([X, Y, art, weg]) => {
      const cv = document.querySelector('main canvas');
      const r = cv.getBoundingClientRect();
      const vp = window.__ravia.getState().viewport;
      const s = {
        x: r.left + (X - vp.center.x) * vp.zoom + r.width / 2,
        y: r.top + r.height / 2 - (Y - vp.center.y) * vp.zoom,
      };
      const ev = (t, x) =>
        cv.dispatchEvent(
          new PointerEvent(t, {
            pointerId: 1,
            pointerType: art,
            isPrimary: true,
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: s.y,
            buttons: t === 'pointerup' ? 0 : 1,
            pressure: t === 'pointerup' ? 0 : 0.5,
          }),
        );
      ev('pointerdown', s.x);
      for (let i = 1; i <= (weg ? 6 : 0); i += 1) {
        ev('pointermove', s.x + (weg * i) / 6);
        await new Promise((res) => setTimeout(res, 10));
      }
      await new Promise((res) => setTimeout(res, 40));
      ev('pointerup', s.x + weg);
    },
    [X, Y, art, weg],
  );

const zustand = (fn, arg) => p.evaluate(fn, arg);
const auswahl = () => zustand(() => window.__ravia.getState().selection?.kind ?? null);
const zahlen = () =>
  zustand(() => {
    const d = window.__ravia.getState().doc;
    return { wände: Object.keys(d.walls).length, objekte: Object.keys(d.fixtures).length };
  });

// ===========================================================================
console.log('\n▸ Die Einführung fragt nach der Rolle');
// ===========================================================================
await p.goto(BASIS, { waitUntil: 'networkidle' });
await p.waitForTimeout(1500);
{
  expect('Die Rollenfrage steht vorn', await p.getByText('Was machen Sie heute?').count(), 1);
  await p.getByRole('button', { name: /Aufmaß vor Ort/ }).click();
  await p.waitForTimeout(300);
  expect('Danach die Frage nach dem Anfang', await p.getByText('Womit fangen wir an?').count(), 1);
  await p.getByRole('button', { name: /Beispiel ansehen/ }).click();
  await p.waitForTimeout(1200);
  expect('Die Wahl stellt die Ansicht', await zustand(() => window.__ravia.getState().uiMode), 'handwerker');
  expect('Und lädt das Beispiel', (await zahlen()).wände > 0, true);
}

// ===========================================================================
console.log('\n▸ Die Kopfleiste räumt mit auf');
// ===========================================================================
{
  const titel = () =>
    p.locator('header button').evaluateAll((es) =>
      es.map((e) => (e.getAttribute('title') || e.textContent || '').split('\n')[0].trim()),
    );
  const imHandwerker = await titel();
  const hat = (teil) => imHandwerker.some((t) => t.startsWith(teil));
  expect('Kein Anlagenschema', imHandwerker.includes('Schema'), false);
  expect('Kein Rohrnetzausleger', hat('Rohrnetz automatisch auslegen'), false);
  expect('Keine Rohrnetzberechnung', hat('Rohrnetzberechnung'), false);
  expect('Keine Projektmappe', hat('Projektmappe'), false);
  expect('Kein IFC-Export', hat('Modell als IFC4 exportieren'), false);
  expect('Öffnen bleibt — dort kommt der Raumscan herein', hat('Öffnen'), true);
  expect('Die Übergabe bleibt', hat('Gebäudedaten als RaVia-BIM-JSON'), true);
  expect('Der Ansichtsumschalter steht oben', await p.locator('header select').count() >= 2, true);

  await p.selectOption('header select:below(:text("WANDSTÄRKE"))', 'profi').catch(async () => {
    // Die zweite Auswahlliste der Kopfzeile ist die Ansicht; beim ersten
    // Versuch kann die Reihenfolge anders sein.
    await p.locator('header select').last().selectOption('profi');
  });
  await p.waitForTimeout(400);
  const imProfi = await titel();
  expect('Im Fachplanermodus ist alles wieder da', imProfi.includes('Schema'), true);
  await p.locator('header select').last().selectOption('handwerker');
  await p.waitForTimeout(400);
}

// ===========================================================================
console.log('\n▸ Ein Fingertipp wählt aus und setzt — gezeichnet wird er nicht');
// ===========================================================================
{
  const raum = await zustand(() => {
    const r = Object.values(window.__ravia.getState().doc.rooms).sort((a, b) => b.area - a.area)[0];
    return { x: r.centroid.x, y: r.centroid.y, name: r.name };
  });

  await p.locator('button.tool-btn[title^="Auswählen"]').click();
  await zustand(() => window.__ravia.getState().setSelection(null));
  await zeigen(raum.x - 1.6, raum.y + 0.9, 'touch');
  await p.waitForTimeout(400);
  expect('Tippen wählt den Raum', await auswahl(), 'room');

  await zustand(() => window.__ravia.getState().setSelection(null));
  await zeigen(raum.x - 1.6, raum.y + 0.9, 'touch', 60);
  await p.waitForTimeout(400);
  expect('Ziehen schiebt nur das Bild', await auswahl(), null);

  const vorher = (await zahlen()).objekte;
  await p.locator('aside > div:first-child button', { hasText: /^TGA$/ }).first().click();
  await p.waitForTimeout(400);
  await p.locator('aside button[title^="Heizkörper ·"]').first().click();
  await p.waitForTimeout(300);
  await zeigen(raum.x, raum.y - 1.0, 'touch');
  await p.waitForTimeout(600);
  expect('Tippen setzt ein TGA-Symbol', (await zahlen()).objekte, vorher + 1);

  await p.locator('button.tool-btn[title^="Wand zeichnen"]').click();
  await p.waitForTimeout(200);
  const wände = (await zahlen()).wände;
  await zeigen(raum.x - 3, raum.y + 3, 'touch');
  await zeigen(raum.x + 3, raum.y + 3, 'touch');
  await p.waitForTimeout(400);
  expect('Zeichnen bleibt dem Stift vorbehalten', (await zahlen()).wände, wände);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
}

// ===========================================================================
console.log('\n▸ Das Raumbuch nimmt an, was es zeigt');
// ===========================================================================
{
  await p.locator('aside > div:first-child button', { hasText: /^Räume$/ }).first().click();
  await p.waitForTimeout(500);
  expect('Der Handwerkermodus fängt beim Ausfüllen an', await p.locator('aside input.field').count() > 0, true);

  const raumname = await zustand(
    () => Object.values(window.__ravia.getState().doc.rooms).sort((a, b) => a.area - b.area)[0].name,
  );
  const feld = p.locator(`aside input[aria-label="Name des Raums ${raumname}"]`);
  expect('Jede Zeile hat ein Namensfeld', await feld.count(), 1);
  await feld.click();
  await p.keyboard.press('Control+a');
  await p.keyboard.type('Duschbad');
  await p.waitForTimeout(400);
  expect('Der Name wandert ins Modell', await zustand(() => Object.values(window.__ravia.getState().doc.rooms).some((r) => r.name === 'Duschbad')), true);
  expect('Das Feld wählt den Raum aus', await auswahl(), 'room');

  const watt = p.locator('aside input[aria-label="Heizleistung von Duschbad in Watt"]');
  expect('Und ein Leistungsfeld', await watt.count(), 1);
  const vorher = (await zahlen()).objekte;
  await watt.click();
  await p.keyboard.press('Control+a');
  await p.keyboard.type('850');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(700);
  expect('Aus einer Zahl entsteht ein Heizkörper', (await zahlen()).objekte, vorher + 1);
  const hk = await zustand(() => {
    const d = window.__ravia.getState().doc;
    const raum = Object.values(d.rooms).find((r) => r.name === 'Duschbad');
    const f = Object.values(d.fixtures).filter((x) => x.roomId === raum?.id && x.type === 'radiator');
    const neu = f[f.length - 1];
    return { watt: neu?.params.powerW ?? 0, herkunft: neu?.params.powerSource ?? '', anWand: Boolean(neu?.wallId) };
  });
  expect('Mit der eingetragenen Leistung', hk.watt, 850);
  expect('Als Angabe, nicht als Vorbelegung', hk.herkunft, 'datenblatt');
  expect('An einer Wand, nicht im Nichts', hk.anWand, true);
  expect(
    'Die Statuszeile sagt, wo er gelandet ist',
    /Heizkörper mit 850 W (unter das breiteste Fenster|an die längste Außenwand|in die Raummitte)/.test(
      await p.locator('footer').innerText(),
    ),
    true,
  );
}

// ===========================================================================
console.log('\n▸ Die Tür sagt, wohin sie aufgeht');
// ===========================================================================
{
  const tuer = await zustand(() => {
    const d = window.__ravia.getState().doc;
    const t = Object.values(d.openings).find((o) => o.kind === 'door' && d.walls[o.wallId]?.type === 'interior');
    return t ? t.id : null;
  });
  expect('Eine Innentür im Beispiel', tuer !== null, true);
  await zustand((id) => window.__ravia.getState().setSelection({ kind: 'opening', id }), tuer);
  await p.waitForTimeout(500);
  const panel = (await p.locator('aside').innerText()).replace(/\n+/g, ' | ');
  expect('Kein „spiegeln" mehr', /Öffnungsrichtung spiegeln/.test(panel), false);
  expect('Zwei benannte Richtungen', (panel.match(/öffnet nach /g) ?? []).length >= 2, true);
  expect('Die DIN-Bezeichnung steht dabei', /DIN (links|rechts), öffnet nach /.test(panel), true);
  expect('Und die Bandseite heißt Band', /Band links/.test(panel) && /Band rechts/.test(panel), true);

  // Umschalten muss die Bezeichnung mitnehmen — und es in der Statuszeile
  // sagen, weil auf dem Tablet die Schublade den Plan verdeckt.
  const vorher = await zustand((id) => Boolean(window.__ravia.getState().doc.openings[id].flipSwing), tuer);
  const knoepfe = p.locator('aside button').filter({ hasText: /^öffnet nach / });
  await knoepfe.nth(vorher ? 0 : 1).click();
  await p.waitForTimeout(500);
  expect(
    'Der Knopf dreht die Tür',
    await zustand((id) => Boolean(window.__ravia.getState().doc.openings[id].flipSwing), tuer),
    !vorher,
  );
  expect(
    'Und die Statuszeile nennt Ziel und DIN',
    /Tür öffnet nach .+ · DIN (links|rechts)/.test(await p.locator('footer').innerText()),
    true,
  );
}

console.log('\nFEHLER auf der Seite:', fehler.length ? fehler.join('\n') : 'keine');
if (fehler.length) failures += fehler.length;
console.log(`\n${failures === 0 ? '✓ RAUCHTEST BESTANDEN' : `✗ ${failures} FEHLER`}\n`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
