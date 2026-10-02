/**
 * Rauchtest „Geräte" — der Feldscan auf Telefon, Tablet und Rechner (1.70.0).
 *
 * **Was geprüft wird** (Auftrag A5): Nach `loadBuilding` ist CAD Light auf
 * jedem Gerät bedienbar, auf dem ein Monteur einen Scan ansieht.
 *
 *  - **Telefon** (375 und 430 px, hoch und quer): Prüfansicht statt
 *    Zeichenoberfläche — 3D, Grundriss, Prüfliste, Bearbeiten auf Wunsch und
 *    von dort zurück. Drehen verliert weder die Prüfansicht noch die
 *    gewählte Ansicht.
 *  - **Tablet** (768, 834, 1024, 1366 px; Split View 320 und 694 px): volle
 *    Oberfläche, keine Prüfansicht — die Form des Geräts ändert sich in der
 *    geteilten Ansicht nicht.
 *  - **Überall**: keine Seite breiter als das Fenster, und unter
 *    `pointer: coarse` jedes sichtbare Tippziel mindestens 44 px in beiden
 *    Richtungen, der Hauptknopf 56 px.
 *
 * Gerät heißt hier: Kennung des Browsers, Berührung, grober Zeiger — so wie
 * `lib/geraeteprofil.ts` es liest. Die Bildschirmgröße kommt aus dem
 * Emulator (`screen` = Fenster).
 *
 * Aufruf: npm run build && npx vite preview --port 4177 & npm run smoke:geraete
 */
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const BASIS = process.env.RAVIA_PROBE ?? 'http://localhost:4177/';
const SCAN = JSON.parse(readFileSync('./scripts/referenz/scan-wohnung-2026-10-02.json', 'utf8'));

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPAD =
  'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});

let fehler = 0;
const pruefe = (name, ist, soll) => {
  const ok = JSON.stringify(ist) === JSON.stringify(soll);
  if (!ok) fehler++;
  const kurz = JSON.stringify(ist);
  console.log(`  ${ok ? '✓' : '✗'} ${name}: ${kurz.length > 160 ? kurz.slice(0, 157) + '…' : kurz}${ok ? '' : `  (erwartet ${JSON.stringify(soll)})`}`);
};

/** Sichtbare Tippziele unter 44 px — mit Text, damit man sie findet. */
const zuKlein = (p, wurzel = 'body') =>
  p.evaluate((sel) => {
    const raus = [];
    const w = document.querySelector(sel);
    if (!w) return ['(Wurzel fehlt)'];
    for (const el of w.querySelectorAll('button, [role="button"], [role="tab"], input:not([type=hidden]), select, a[href]')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const st = getComputedStyle(el);
      if (st.visibility === 'hidden' || st.display === 'none') continue;
      // Nur, was im Fenster liegt — in einer scrollbaren Leiste zählt der
      // Teil, den man erreicht, und der hat dieselbe Größe.
      if (r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) continue;
      // Eine Datei-Eingabe ist versteckt und wird über ihren Knopf bedient.
      if (el instanceof HTMLInputElement && el.type === 'file') continue;
      // Was hinter einer geschlossenen Schublade liegt, ist nicht erreichbar.
      if (el.closest('[aria-hidden="true"]')) continue;
      if (r.height < 43.5 || r.width < 43.5) {
        raus.push(`${(el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 24)} ${Math.round(r.width)}×${Math.round(r.height)}`);
      }
    }
    return raus;
  }, wurzel);

const ohneQuerlauf = (p) =>
  p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1 && document.body.scrollWidth <= innerWidth + 1);

async function geraet(name, ua, width, height, mobil = true) {
  const ctx = await b.newContext({
    viewport: { width, height },
    screen: { width, height },
    userAgent: ua,
    isMobile: mobil,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  await p.addInitScript(() => {
    localStorage.setItem('ravia-ui-mode', 'profi');
    localStorage.setItem('ravia-einfuehrung', '1');
  });
  await p.goto(BASIS, { waitUntil: 'networkidle' });
  await p.waitForTimeout(500);
  const ok = await p.evaluate((scan) => window.__ravia.getState().loadBuilding(scan).ok, SCAN);
  await p.waitForTimeout(1500);
  return { ctx, p, errs, ok, name };
}

// --- Telefon ----------------------------------------------------------------
for (const [w, h] of [[375, 812], [430, 932]]) {
  console.log(`\n▸ iPhone ${w}×${h}`);
  const { ctx, p, errs, ok } = await geraet('iPhone', IPHONE, w, h);
  pruefe('Scan übernommen', ok, true);
  pruefe('Prüfansicht statt Zeichenoberfläche', await p.locator('[data-pruefansicht]').count(), 1);
  pruefe('keine Werkzeugleiste sichtbar', await p.locator('.tool-btn:visible').count(), 0);
  pruefe('kein Querlauf', await ohneQuerlauf(p), true);
  const knopf = await p.locator('[data-hauptknopf]').boundingBox();
  pruefe('Hauptknopf ≥ 56 px hoch', knopf ? knopf.height >= 55.5 : null, true);
  pruefe('Hauptknopf über dem unteren Rand', knopf ? knopf.y + knopf.height <= h : null, true);
  pruefe('Tippziele der Prüfansicht ≥ 44 px', await zuKlein(p, '[data-pruefansicht]'), []);

  // Grundriss wählen, Prüfliste ansehen, dann drehen.
  await p.getByRole('tab', { name: 'Grundriss' }).click();
  await p.waitForTimeout(300);
  pruefe('Grundriss zeigt den Plan', await p.locator('[data-pruefansicht] canvas').count() > 0, true);
  await p.getByRole('tab', { name: /Prüfliste/ }).click();
  await p.waitForTimeout(300);
  pruefe('Prüfliste nennt den fehlenden Dachteil', (await p.locator('[data-pruefansicht-liste]').innerText()).includes('Dach'), true);
  await p.getByRole('tab', { name: 'Grundriss' }).click();

  await p.setViewportSize({ width: h, height: w });
  await p.waitForTimeout(600);
  pruefe('quer: weiter Prüfansicht', await p.locator('[data-pruefansicht]').count(), 1);
  pruefe('quer: Grundriss bleibt gewählt', await p.getByRole('tab', { name: 'Grundriss' }).getAttribute('aria-selected'), 'true');
  pruefe('quer: Prüfliste steht daneben', await p.locator('[data-pruefansicht-liste]').count(), 1);
  pruefe('quer: kein Querlauf', await ohneQuerlauf(p), true);
  pruefe('quer: Tippziele ≥ 44 px', await zuKlein(p, '[data-pruefansicht]'), []);
  await p.setViewportSize({ width: w, height: h });
  await p.waitForTimeout(600);
  pruefe('zurückgedreht: Grundriss weiter gewählt', await p.getByRole('tab', { name: 'Grundriss' }).getAttribute('aria-selected'), 'true');

  const waende = await p.evaluate(() => Object.keys(window.__ravia.getState().doc.walls).length);
  await p.locator('[data-hauptknopf]').click();
  await p.waitForTimeout(800);
  pruefe('Bearbeiten öffnet die Zeichenoberfläche', await p.locator('[data-pruefansicht]').count(), 0);
  pruefe('… mit Werkzeugleiste', (await p.locator('.tool-btn:visible').count()) > 0, true);
  pruefe('… das Modell ist dasselbe', await p.evaluate(() => Object.keys(window.__ravia.getState().doc.walls).length), waende);
  pruefe('… Weg zurück zur Prüfansicht', await p.locator('[data-zur-pruefansicht]').count(), 1);
  pruefe('… kein Querlauf', await ohneQuerlauf(p), true);
  await p.locator('[data-zur-pruefansicht]').click();
  await p.waitForTimeout(500);
  pruefe('zurück in der Prüfansicht', await p.locator('[data-pruefansicht]').count(), 1);
  pruefe('keine Fehler auf der Seite', errs, []);
  await ctx.close();
}

// --- Tablet -----------------------------------------------------------------
for (const [w, h, wie] of [
  [768, 1024, 'iPad mini hoch'],
  [834, 1194, 'iPad Air hoch'],
  [1024, 1366, 'iPad Pro hoch'],
  [1366, 1024, 'iPad Pro quer'],
  [320, 1024, 'Split View schmal'],
  [694, 1024, 'Split View breit'],
]) {
  console.log(`\n▸ ${wie} ${w}×${h}`);
  // Split View: das Fenster ist schmal, der Bildschirm nicht.
  const ctx = await b.newContext({
    viewport: { width: w, height: h },
    screen: { width: Math.max(w, 1024), height: Math.max(h, 1024) },
    userAgent: IPAD,
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  await p.addInitScript(() => {
    localStorage.setItem('ravia-ui-mode', 'profi');
    localStorage.setItem('ravia-einfuehrung', '1');
  });
  await p.goto(BASIS, { waitUntil: 'networkidle' });
  await p.waitForTimeout(500);
  const ok = await p.evaluate((scan) => window.__ravia.getState().loadBuilding(scan).ok, SCAN);
  await p.waitForTimeout(1500);
  pruefe('Scan übernommen', ok, true);
  pruefe('volle Oberfläche, keine Prüfansicht', await p.locator('[data-pruefansicht]').count(), 0);
  pruefe('kein Querlauf', await ohneQuerlauf(p), true);
  pruefe('Tippziele ≥ 44 px', await zuKlein(p), []);
  pruefe('keine Fehler auf der Seite', errs, []);
  await ctx.close();
}

await b.close();
console.log(fehler ? `\n✗ ${fehler} Prüfungen fehlgeschlagen` : '\n✓ alle Geräteprüfungen bestanden');
process.exit(fehler ? 1 : 0);
