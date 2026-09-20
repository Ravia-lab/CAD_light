/**
 * Rauchtest „Sprachwahl" — lässt sich die Sprache wirklich umstellen?
 *
 * **Der Anlass war ein Fehler, den keine Prüfung im Kern finden konnte.**
 * Die Sprachwahl stand als Flagge in der Kopfzeile, die Liste als
 * `absolute` darunter. Sie öffnete sich auch — nur sah man sie nicht: Die
 * Kopfzeile trägt `overflow-x-auto` (der Rückfall für einen
 * Geschossumschalter, der breiter ist als das Gerät), und sobald
 * `overflow-x` nicht `visible` ist, macht CSS aus `overflow-y: visible` ein
 * `auto`. Alles, was unten aus der Kopfzeile herausragt, wird damit
 * beschnitten. Der Knopf zeigte die türkische Flagge und ließ sich nicht
 * mehr verlassen — die Oberfläche war in einer Sprache gefangen, die der
 * Anwender nicht gewählt hatte.
 *
 * Das ist ein reiner Anzeigefehler: Zustand, Speicher und Übersetzung
 * arbeiteten fehlerfrei. Nur ein Browser sieht so etwas, und deshalb steht
 * dieser Test hier und nicht in `verify.ts`.
 *
 * **Der zweite Befund kam beim Schreiben dieses Tests.** Nach dem ersten
 * Umschalten ließ sich kein zweites auslösen: Die Anwendung hängt an einem
 * `key` mit der Sprache, wird beim Umschalten neu aufgebaut — und lief
 * dabei in die Startprüfung, die „Stand wiederherstellen?" fragt. Wer
 * mitten in der Arbeit die Sprache wechselte, bekam die Frage für einen
 * Stand vorgesetzt, an dem er gerade arbeitete. Behoben mit einem Merker
 * auf Modulebene (`App.tsx`).
 *
 * Geprüft wird deshalb ausdrücklich **zweimal** umschalten — hin und
 * zurück. Ein einzelner Wechsel hätte beide Fehler nicht gezeigt.
 *
 * Aufruf:
 *     npm run build && npx vite preview --port 4177 &
 *     node scripts/smoke-sprache.mjs
 */

import { chromium } from 'playwright';

const BASIS = process.env.RAVIA_PROBE ?? 'http://localhost:4177/';

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

const ctx = await b.newContext({ viewport: { width: 1500, height: 900 } });
await ctx.addInitScript(() => {
  localStorage.setItem('ravia-ui-mode', 'profi');
  localStorage.setItem('ravia-einfuehrung', '1');
  // Ein festgefahrener Stand aus 1.36.0, wie ihn ein Anwender im Browser hat.
  localStorage.setItem('ravia-cad-light.sprache.v1', 'tr');
});
const p = await ctx.newPage();
await p.goto(BASIS, { waitUntil: 'networkidle' });
await p.waitForTimeout(1800);

/** Der Knopf trägt die eingestellte Sprache in seinem Titel. */
const knopf = () => p.locator('header button[title^="Sprache:"]').first();
/** Die Liste hängt im Portal am Seitenkörper — nicht in der Kopfzeile. */
const liste = () => p.locator('body > div.panel.fixed').last();

/*
 * **Der Start steht auf Deutsch, auch wenn im Browser etwas anderes liegt.**
 *
 * In 1.36.0 war die Liste unsichtbar; wer eine Sprache gewählt hatte, kam
 * nicht zurück, und die Wahl blieb im Browser stehen. Einmalig wird sie
 * deshalb zurückgesetzt. Hier wird genau das nachgestellt: Im Speicher
 * liegt „tr", der Merker fehlt — das Programm muss trotzdem auf Deutsch
 * aufgehen.
 */
console.log('\n▸ Der Start steht auf Deutsch');
expect('Deutsch, obwohl „tr" im Browser lag',
  await p.locator('header button[title^="Sprache: Deutsch"]').count(), 1);

console.log('\n▸ Die Liste ist erreichbar');
expect('Der Sprachknopf steht in der Kopfzeile', await knopf().count(), 1);
await knopf().click();
await p.waitForTimeout(400);
expect('Die Liste öffnet sich', await liste().isVisible(), true);
expect('Achtzehn Sprachen', await liste().locator('button').count(), 18);

/*
 * **Der eigentliche Nachweis.** „Sichtbar" im Sinne des DOM war die Liste
 * auch vorher — sie stand nur außerhalb des Bildes. Gemessen wird deshalb
 * der Kasten: Er muss im Fenster liegen und Höhe haben.
 */
const imBild = async (w, h) => {
  const k = await liste().boundingBox();
  if (!k) return { ok: false, grund: 'kein Kasten' };
  if (k.height < 100) return { ok: false, grund: `nur ${Math.round(k.height)} px hoch` };
  if (k.x < 0) return { ok: false, grund: `${Math.round(-k.x)} px links draußen` };
  if (k.y < 0) return { ok: false, grund: `${Math.round(-k.y)} px oben draußen` };
  if (k.x + k.width > w + 1) return { ok: false, grund: `${Math.round(k.x + k.width - w)} px rechts draußen` };
  if (k.y + k.height > h + 1) return { ok: false, grund: `${Math.round(k.y + k.height - h)} px unten draußen` };
  return { ok: true, grund: '' };
};
expect('Sie liegt vollständig im Bild', await imBild(1500, 900), { ok: true, grund: '' });

console.log('\n▸ Zweimal umschalten — hin und zurück');
await liste().locator('button', { hasText: 'Türkçe' }).click();
await p.waitForTimeout(900);
expect('Umgestellt auf Türkisch', await p.locator('header button[title^="Sprache: Türkisch"]').count(), 1);

// Kein Dialog darf den Weg versperren — das war der zweite Befund.
expect('Kein Dialog liegt davor', await p.locator('div.fixed.inset-0.z-50').count(), 0);

await knopf().click();
await p.waitForTimeout(400);
expect('Die Liste öffnet sich auch auf Türkisch', await liste().isVisible(), true);
await liste().locator('button', { hasText: 'Deutsch' }).click();
await p.waitForTimeout(900);
expect('Und zurück auf Deutsch', await p.locator('header button[title^="Sprache: Deutsch"]').count(), 1);

/*
 * **Der Fall, der in 1.36.1 durchgerutscht ist.**
 *
 * Die Liste band ihre *rechte* Kante an die rechte Kante des Knopfes. Das
 * stimmt, solange der Knopf rechts steht — er steht dort aber nur, solange
 * die Kopfzeile nicht umbricht. Auf einem schmalen Fenster rutscht der
 * rechte Block in eine eigene Zeile und beginnt **links**; die Liste schob
 * sich damit nach links aus dem Bild. Der erste Rauchtest hat das nicht
 * gesehen, weil er nur die Höhe geprüft hat und nicht die Seite.
 *
 * Geprüft wird deshalb bei drei Fensterbreiten, und zwar auf **alle vier**
 * Kanten.
 */
console.log('\n▸ Auch dort, wo die Kopfzeile umbricht');
for (const [w, h] of [[760, 900], [1024, 800], [1920, 1000]]) {
  await p.setViewportSize({ width: w, height: h });
  await p.waitForTimeout(400);
  await knopf().click();
  await p.waitForTimeout(400);
  const erg = await imBild(w, h);
  expect(`${w} × ${h} px: die Liste liegt vollständig im Bild`, erg, { ok: true, grund: '' });
  await p.keyboard.press('Escape');
  await p.mouse.click(w / 2, h - 20);
  await p.waitForTimeout(300);
}
await p.setViewportSize({ width: 1500, height: 900 });
await p.waitForTimeout(400);

console.log('\n▸ Die Zusage: nichts ist falsch, manches noch nicht übersetzt');
/*
 * Auf Türkisch steht der deutsche Satz da, weil der Katalog leer ist. Das
 * ist der zugesagte Zustand — und er ist prüfbar: Der Werkzeugtitel muss
 * **derselbe** sein wie auf Deutsch, nicht leer und nicht ein Schlüssel.
 */
const titelDe = await p.locator('header button[title^="Sprache:"]').first().getAttribute('title');
await knopf().click();
await p.waitForTimeout(300);
await liste().locator('button', { hasText: 'Русский' }).click();
await p.waitForTimeout(900);
const titelRu = await p.locator('header button[title^="Sprache:"]').first().getAttribute('title');
expect('Der Titel bleibt deutsch und vollständig', (titelRu ?? '').includes('Fachbegriffe'), true);
expect('… und ist nicht derselbe Satz wie vorher', titelRu !== titelDe, true);

await b.close();
console.log(`\n${failures === 0 ? '✓ RAUCHTEST BESTANDEN' : `✗ ${failures} FEHLER`}`);
process.exit(failures === 0 ? 0 : 1);
