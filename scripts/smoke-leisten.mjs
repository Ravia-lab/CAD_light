/**
 * Rauchtest „Leisten" — steht wirklich alles da, oder liegt etwas hinter dem Rand?
 *
 * **Der Anlass.** Im eingebetteten Betrieb war die Leitungsleiste nach
 * „Trinkwa…" abgeschnitten. Die Kopfzeile trägt seit 1.23.0 `flex-wrap`,
 * damit genau das nicht passiert — aber geprüft wurde es einmal von Hand
 * („nachgemessen: 640 bis 1920 px"), und eine Handmessung verfällt mit dem
 * nächsten Knopf, den jemand hinzufügt.
 *
 * Dieser Test misst es bei jedem Lauf, und zwar für **jedes Werkzeug**: Die
 * Kontextleiste wechselt mit dem Werkzeug, und die breiteste von ihnen
 * bestimmt, ob die Zusage „es ist alles zu sehen" hält. Wand, Tür, Fenster,
 * Durchgang, Leitung und TGA-Objekt bringen jeweils eine eigene Reihe mit.
 *
 * **Was als Fehler gilt — drei Dinge, und alle drei sind stilles Verschwinden:**
 *
 *  1. Ein Element ragt über den Rand der Kopfzeile hinaus.
 *  2. Ein Element ist in sich abgeschnitten (`scrollWidth > clientWidth`) —
 *     das ist der Fall „Trinkwa…".
 *  3. Die Kopfzeile selbst rollt waagerecht. Das ist der gefährlichste der
 *     drei: Auf dem Tablet ist eine Rollleiste unsichtbar, und dass man in
 *     einem zwei Zentimeter hohen Streifen wischen kann, ahnt niemand.
 *
 * Umbrechen ist erlaubt und erwünscht — die Kopfzeile darf höher werden.
 * Die Zeichenfläche darunter bekommt den Rest und meldet ihre Größe über
 * den ResizeObserver; überlappen kann nichts.
 *
 * Aufruf:
 *     npm run build && npx vite preview --port 4177 &
 *     node scripts/smoke-leisten.mjs
 */

import { chromium } from 'playwright';

const BASIS = process.env.RAVIA_PROBE ?? 'http://localhost:4177/';

/** Gerätebreiten vom kleinen Telefon quer bis zum großen Bildschirm. */
const BREITEN = [640, 768, 820, 900, 1024, 1180, 1280, 1440, 1600, 1920];

/** Werkzeuge mit eigener Kontextleiste — die anderen zeigen keine. */
const WERKZEUGE = [
  ['v', 'Auswählen'],
  ['w', 'Wand'],
  ['z', 'Raum'],
  ['d', 'Tür'],
  ['f', 'Fenster'],
  ['e', 'Durchgang'],
  ['t', 'TGA-Objekt'],
  ['l', 'Leitung'],
  ['b', 'Text & Maßkette'],
  ['u', 'Durchbruch'],
  ['p', 'Wärmepumpe'],
];

const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});

let failures = 0;
const expect = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? '✓' : '✗'} ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (erwartet ${JSON.stringify(expected)})`}`);
};

/**
 * Die Kopfzeile ausmessen.
 *
 * Gemessen werden nur **Blattknoten** — Knöpfe und Beschriftungen, also das,
 * was ein Mensch liest. Ein umbrechender Zwischenbehälter meldet sonst
 * seinerseits `scrollWidth > clientWidth`, ohne dass irgendetwas fehlte.
 * 1 px Spiel, weil Layoutbreiten gebrochene Zahlen sind.
 */
const messen = async (p) =>
  p.evaluate(() => {
    const kopf = document.querySelector('header');
    if (!kopf) return { fehlt: true };
    const k = kopf.getBoundingClientRect();
    const raus = [];
    for (const el of kopf.querySelectorAll('button, span, a')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (el.querySelector('button, span, a')) continue;
      const ueber = Math.round(Math.max(0, r.right - k.right) + Math.max(0, k.left - r.left));
      const beschnitten = el.scrollWidth > el.clientWidth + 1;
      if (ueber > 1 || beschnitten) {
        raus.push({
          text: (el.textContent || el.getAttribute('title') || '?').trim().slice(0, 24),
          ueber,
          beschnitten,
        });
      }
    }
    return {
      hoehe: Math.round(k.height),
      rollt: kopf.scrollWidth > kopf.clientWidth + 1,
      raus,
    };
  });

const ctx = await b.newContext({ viewport: { width: 1280, height: 880 } });
const p = await ctx.newPage();
await p.goto(BASIS, { waitUntil: 'networkidle' });
await p.waitForTimeout(1200);

for (const [taste, name] of WERKZEUGE) {
  console.log(`\n▸ Werkzeug „${name}"`);
  await p.keyboard.press(taste);
  await p.waitForTimeout(250);
  const fehler = [];
  let hoechste = 0;
  for (const w of BREITEN) {
    await p.setViewportSize({ width: w, height: 880 });
    await p.waitForTimeout(220);
    const m = await messen(p);
    if (m.fehlt) { fehler.push(`${w}px: keine Kopfzeile`); continue; }
    hoechste = Math.max(hoechste, m.hoehe);
    if (m.rollt) fehler.push(`${w}px: Kopfzeile rollt waagerecht`);
    for (const r of m.raus) {
      fehler.push(`${w}px: „${r.text}"${r.ueber ? ` ragt ${r.ueber}px hinaus` : ''}${r.beschnitten ? ' ist abgeschnitten' : ''}`);
    }
  }
  expect(`Nichts liegt hinter dem Rand (${BREITEN.length} Breiten)`, fehler, []);
  // Eine Kopfzeile, die bei 640 px höher als ein Drittel des Bildes wird,
  // frisst die Zeichenfläche auf. 880/3 = 293 px.
  expect('Die Kopfzeile bleibt unter einem Drittel der Höhe', hoechste < 293, true);
  await p.setViewportSize({ width: 1280, height: 880 });
}

await b.close();
console.log(`\n${failures === 0 ? '✓ RAUCHTEST BESTANDEN' : `✗ ${failures} FEHLER`}`);
process.exit(failures === 0 ? 0 : 1);
