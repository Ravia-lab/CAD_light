/**
 * Rauchtest „Aufnahme Zimmer für Zimmer".
 *
 * **Was hier geprüft wird.** Der Weg, den jemand geht, der zum ersten Mal vor
 * dem Programm sitzt: Einführung → „Aufmaß vor Ort" → „Zimmer für Zimmer
 * eintippen" → drei Räume antippen → fertig. Am Ende muss ein Grundriss
 * stehen, mit dem gerechnet werden kann.
 *
 * **Warum der Block so genau zählt.** Drei Fehler dieses Weges waren beim
 * Bauen still — keiner warf, keiner malte etwas Falsches:
 *
 *  1. **Keine Fenster.** Die Wand, in die sie gehören, wurde im Dokument des
 *     vorigen Bilddurchlaufs gesucht; dort gab es sie noch nicht.
 *  2. **„Nein" beim Heizkörper wirkte nicht.** Die Antwort auf die letzte
 *     Frage eines Raums wird im selben Griff gegeben, in dem der Raum
 *     entsteht — `setE` wirkt erst danach. In jedem Raum hing also einer.
 *  3. **Doppelte Wände.** Zwei Kanten zwischen denselben Knoten, weil der
 *     Schnitt der Nachbarwand erst nach der Dublettensperre läuft. Im Plan
 *     unsichtbar, in der Heizlast doppelte Transmission.
 *
 * Jeder dieser Fehler fiel nur durch Nachzählen auf. Deshalb steht hier nicht
 * „es hat geklappt", sondern die Zahl — und zu den Wänden die Gegenprobe, dass
 * keine zweimal dasteht.
 *
 * **Die Sollwerte sind von Hand hergeleitet.** Angetippt werden Wohnen
 * (4,50 × 5,00), Küche rechts daneben (3,00 × 3,50) und ein Bad darunter
 * (2,40 × 3,00, nicht gemessen). Daraus folgt:
 *
 *  · Wände: Wohnen 4. Die Küche teilt die rechte Wand des Wohnzimmers bei
 *    y = 3,50 (+1) und bringt drei eigene (ihre vierte liegt auf der
 *    geteilten) → 8. Das Bad teilt die untere Wand der Küche bei x = 6,90
 *    (+1) und bringt drei eigene → **12**.
 *  · Knoten: (0|0) (4,5|0) (4,5|5) (0|5) (7,5|0) (7,5|3,5) (4,5|3,5)
 *    (6,9|0) (6,9|−3) (4,5|−3) → **10**.
 *  · Flächen lichte Maße bei 24 cm Wandstärke: Wohnen 4,26 × 4,76 = 20,28 m²,
 *    Küche 2,76 × 3,26 = 9,00 m², Bad 2,16 × 2,76 = 5,96 m².
 *  · Fenster: Wohnen 2 (untere Wand, 4,50 m), Küche 1 (rechte, 3,50 m),
 *    Bad 1 (untere, angenommen) → **4**, jedes in einer Außenwand.
 *  · Heizflächen: Wohnen „Ja" → Heizkörper, Küche „Nein" → keiner, Bad „Ja"
 *    → Handtuchheizkörper → **2**.
 *  · Annahmen: Maße Bad, Fenster Bad → **2**.
 *
 * Mit `RAVIA_PROBE=<url>` läuft der Test gegen einen echten Server.
 */

import { chromium } from 'playwright';

const BASIS = process.env.RAVIA_PROBE ?? 'http://localhost:4177/';
const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
// Tabletgröße: Der Weg ist für die Baustelle gedacht, und die Antwortkacheln
// liegen dort in der unteren Hälfte des Bildes.
const p = await b.newPage({ viewport: { width: 1180, height: 820 } });
const errs = [];
p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });

let failures = 0;
const expect = (label, actual, expected, tol = 0) => {
  const ok = typeof actual === 'number' && typeof expected === 'number'
    ? Math.abs(actual - expected) <= tol
    : JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? '✓' : '✗'} ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (erwartet ${JSON.stringify(expected)})`}`);
};

/*
 * Die Einführung wird hier **nicht** übersprungen: Sie ist der Eingang zum
 * Assistenten. Deshalb startet der Test mit leerem Speicher.
 */
await p.addInitScript(() => { try { localStorage.clear(); } catch { /* privates Fenster */ } });
await p.goto(BASIS, { waitUntil: 'networkidle' });
await p.waitForTimeout(1600);

/**
 * Den Knopf antippen, dessen **erste Zeile** genau so heißt.
 *
 * Die Kacheln tragen zwei Zeilen („Wohnen" und „20 °C"), ein Treffer auf den
 * ganzen Text geht deshalb daneben — und ein Treffer auf einen Teiltext
 * erwischte „Wohnen" auch in „Wohnen/Essen".
 */
const tippe = async (text) => {
  const ok = await p.evaluate((s) => {
    const btn = [...document.querySelectorAll('button')].find((el) => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      return (el.innerText || '').split('\n')[0].trim() === s;
    });
    if (!btn) return false;
    btn.click();
    return true;
  }, text);
  if (!ok) { failures++; console.log(`  ✗ Antwort nicht gefunden: „${text}"`); }
  await p.waitForTimeout(280);
  return ok;
};

const stand = () => p.evaluate(() => {
  const d = window.__ravia.getState().doc;
  const n = d.nodes;
  const kanten = Object.values(d.walls).map((w) => [w.a, w.b].sort().join('|'));
  return {
    waende: Object.values(d.walls).length,
    knoten: Object.keys(n).length,
    doppelt: kanten.length - new Set(kanten).size,
    raeume: Object.values(d.rooms).map((r) => ({ name: r.name, usage: r.usage, a: Math.round((r.area ?? 0) * 100) / 100 })),
    fenster: Object.values(d.openings).filter((o) => o.kind === 'window').length,
    heizflaechen: Object.values(d.fixtures).map((f) => f.type).sort(),
    annahmen: (d.meta.annahmen ?? []).map((a) => a.was),
    ohneGrund: (d.meta.annahmen ?? []).filter((a) => !a.grund).length,
    baualter: d.meta.baualter ?? '',
    hoehe: d.levels[d.activeLevelId].height,
    unten: d.levels[d.activeLevelId].floorBoundary,
    // Jede Öffnung muss in einer Wand liegen, die es gibt.
    verwaist: Object.values(d.openings).filter((o) => !d.walls[o.wallId]).length,
  };
});

console.log('\n▸ Einstieg über die Einführung');
await tippe('Aufmaß vor Ort');
await tippe('Zimmer für Zimmer eintippen');
expect('Der Assistent ist offen', await p.evaluate(() => window.__ravia.getState().assistent), true);

console.log('\n▸ Das Gebäude — fünf Fragen');
/** Die Frage, die gerade dasteht. */
const frage = () => p.evaluate(() => (document.querySelector('.assi-frage')?.textContent ?? '').trim());
await tippe('Eine Wohnung');
await tippe('bis 1948');
expect('Nach zwei Antworten steht die dritte Frage da',
  (await frage()).startsWith('Was ist unter der'), true, 0);
/*
 * Ein Schritt zurück. Auf der Baustelle wird mit dem Handschuh getippt — ohne
 * diesen Knopf bliebe nach einem Fehlgriff nur, falsch weiterzumachen. Geprüft
 * wird, dass er wirklich eine Frage zurückgeht und nicht bloß dasteht.
 */
await tippe('Zurück');
expect('Zurück führt auf die Baualtersfrage', await frage(), 'Wie alt ist das Haus ungefähr?');
await tippe('bis 1948');
for (const t of ['Unbeheizter Keller', 'Das Dach', 'Passt']) await tippe(t);

console.log('\n▸ Raum 1 · Wohnen 4,50 × 5,00 · zwei Fenster · Heizkörper');
for (const t of ['Wohnen', 'Passt', '2', 'Ja']) await tippe(t);
{
  const s = await stand();
  expect('Vier Wände', s.waende, 4);
  expect('Ein Raum', s.raeume.length, 1);
  expect('Er heißt Wohnen', s.raeume[0].name, 'Wohnen');
  expect('Er ist ein Wohnraum', s.raeume[0].usage, 'living');
  // 4,50 − 0,24 = 4,26 · 5,00 − 0,24 = 4,76 → 20,2776 m², gerundet 20,28
  expect('Lichte Fläche 20,28 m²', s.raeume[0].a, 20.28, 0.01);
  expect('Zwei Fenster', s.fenster, 2);
  expect('Ein Heizkörper', s.heizflaechen, ['radiator']);
}

console.log('\n▸ Raum 2 · Küche rechts daneben · ein Fenster · kein Heizkörper');
for (const t of ['rechts daneben', 'Küche', 'Passt', '1', 'Nein']) await tippe(t);
{
  const s = await stand();
  expect('Acht Wände', s.waende, 8);
  expect('Keine Wand steht doppelt', s.doppelt, 0);
  // 2,76 × 3,26 = 8,9976 → 9,00
  expect('Die Küche hat 9,00 m²', s.raeume[1].a, 9.0, 0.01);
  expect('Drei Fenster', s.fenster, 3);
  // Das „Nein" muss wirken: Es bleibt bei dem einen Heizkörper im Wohnzimmer.
  expect('Weiter nur ein Heizkörper', s.heizflaechen, ['radiator']);
}

console.log('\n▸ Raum 3 · Bad darunter · nicht gemessen · Fenster unbekannt');
for (const t of ['darunter', 'Bad', 'Nicht gemessen — dann das übliche Maß', 'Weiß ich nicht — dann eines', 'Ja']) await tippe(t);
{
  const s = await stand();
  expect('Zwölf Wände', s.waende, 12);
  expect('Keine Wand steht doppelt', s.doppelt, 0);
  expect('Zehn Knoten', s.knoten, 10);
  expect('Drei Räume', s.raeume.length, 3);
  // 2,16 × 2,76 = 5,9616 → 5,96
  expect('Das Bad hat 5,96 m²', s.raeume[2].a, 5.96, 0.01);
  expect('Vier Fenster', s.fenster, 4);
  expect('Keine Öffnung ohne Wand', s.verwaist, 0);
  expect('Heizkörper und Handtuchheizkörper', s.heizflaechen, ['radiator', 'towel-radiator']);
  expect('Zwei Annahmen', s.annahmen, ['Maße Bad', 'Fenster Bad']);
  expect('Jede Annahme hat einen Grund', s.ohneGrund, 0);
  expect('Das Baualter steht im Projekt', s.baualter.length > 0, true);
  expect('Die Raumhöhe steht im Geschoss', s.hoehe, 2.5, 0.001);
  expect('Der Keller gilt als unbeheizt', s.unten, 'unheated');
}

console.log('\n▸ Abschluss');
await tippe('Keine Räume mehr');
await p.waitForTimeout(400);
const abschluss = await p.evaluate(() => {
  // Die Kopfzeile steht in einem <span> und wird vom Stil in Großbuchstaben
  // gesetzt — `innerText` liefert deshalb „FERTIG".
  const el = [...document.querySelectorAll('span')].find((e) => /^fertig$/i.test((e.innerText || '').trim()));
  const txt = document.body.innerText || '';
  return {
    kopf: !!el,
    raeume: /3 Räume/.test(txt),
    annahme: /Maße Bad/.test(txt),
    weiter: /Weiter zur Prüfung/.test(txt),
    satz: /Alles Weitere steht jetzt im Plan/.test(txt),
  };
});
expect('Der Abschluss steht da', abschluss.kopf, true);
expect('Er nennt die drei Räume', abschluss.raeume, true);
expect('Er zeigt die Annahmen', abschluss.annahme, true);
expect('Er führt zur Prüfung', abschluss.weiter, true);
expect('Und sagt, wie es weitergeht', abschluss.satz, true);
await p.screenshot({ path: './screenshots/aufnahme-abschluss.png' });

console.log('\n▸ Noch ein Stockwerk');
/*
 * Das nächste Geschoss ist **leer** — nicht eine Kopie dieses einen. Geprüft
 * wird beides: dass ein Geschoss entsteht und dass es aktiv ist, denn sonst
 * landeten die Räume des Obergeschosses im Erdgeschoss.
 */
const vorher = await p.evaluate(() => window.__ravia.getState().doc.activeLevelId);
await tippe('Noch ein Stockwerk');
await p.waitForTimeout(400);
const geschoss = await p.evaluate(() => {
  const d = window.__ravia.getState().doc;
  return {
    anzahl: Object.keys(d.levels).length,
    aktiv: d.activeLevelId,
    waendeHier: Object.values(d.walls).filter((w) => w.levelId === d.activeLevelId).length,
    waendeGesamt: Object.values(d.walls).length,
  };
});
expect('Zwei Geschosse', geschoss.anzahl, 2);
expect('Das neue ist aktiv', geschoss.aktiv !== vorher, true);
expect('Und es ist leer', geschoss.waendeHier, 0);
expect('Unten steht alles unverändert', geschoss.waendeGesamt, 12);
expect('Gefragt wird nach dem ersten Raum', await frage(), 'Welcher Raum ist das?');

console.log('\n▸ Nichts in der Konsole');
expect('Keine Fehler im Browser', errs.slice(0, 3), []);

await b.close();
console.log(failures ? `\n✗ ${failures} Prüfung(en) fehlgeschlagen` : '\n✓ Aufnahme: alles in Ordnung');
process.exit(failures ? 1 : 0);
