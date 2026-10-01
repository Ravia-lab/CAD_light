/**
 * Rauchtest „Skizzenseite" — das Blatt Papier neben dem Modell.
 *
 * **Der Anlass, wörtlich:** „ergänze eine seite wenn man was zeichnen will,
 * die ist immer noch im hauptsystem, das muss so gehen, skizzirungsseite oder
 * so" (01.10.2026). Das Skizzenblatt aus 1.64.0 liegt **über dem Plan** —
 * dieselbe Zeichenfläche, dasselbe Koordinatensystem, und jeder Strich wird zu
 * einer Wand. Für ein Strangschema von Hand, ein Detail oder eine Notiz ist
 * das der falsche Ort.
 *
 * Geprüft wird in der Reihenfolge, in der es schiefgehen kann:
 *
 *  1. Die Ansicht ist erreichbar und legt von selbst ein Blatt an — wer ein
 *     leeres Blatt anlegen muss, bevor er zeichnen kann, hat einen Handgriff
 *     zu viel.
 *  2. Ein Zug landet als Strich auf dem Blatt, und zwar **ohne** eine Wand zu
 *     erzeugen. Das ist der Kern: hier Papier, dort Modell.
 *  3. Zurücknehmen nimmt einen Strich, Leeren nimmt alle, das Blatt bleibt.
 *  4. Mehrere Blätter, fortlaufend benannt.
 *  5. Das Blatt **überlebt Speichern und Öffnen** — sonst zeichnet es niemand
 *     ein zweites Mal.
 *
 * Mit `RAVIA_PROBE=<url>` läuft der Test gegen einen echten Server.
 */

import { chromium } from 'playwright';

const BASIS = process.env.RAVIA_PROBE ?? 'http://localhost:4177/';
const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
// Tabletgröße: Auf dem Blatt wird mit dem Finger gezeichnet.
const p = await b.newPage({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2 });
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

await p.addInitScript(() => {
  localStorage.clear();
  localStorage.setItem('ravia-einfuehrung', '1');
  localStorage.setItem('ravia-ui-mode', 'profi');
});
await p.goto(BASIS, { waitUntil: 'networkidle' });
await p.waitForTimeout(1300);

const stand = () => p.evaluate(() => {
  const s = window.__ravia.getState();
  const blaetter = Object.values(s.doc.meta.skizzen ?? {});
  const aktiv = blaetter.find((x) => x.id === s.aktivesBlatt) ?? blaetter[0];
  return {
    blaetter: blaetter.length,
    namen: blaetter.map((x) => x.name),
    striche: aktiv ? aktiv.striche.length : 0,
    punkte: aktiv ? aktiv.striche.reduce((n, x) => n + x.punkte.length, 0) : 0,
    waende: Object.keys(s.doc.walls).length,
    ansicht: s.viewMode,
  };
});

console.log('\n▸ Die Ansicht aufschlagen');
await p.getByRole('button', { name: 'Skizze', exact: true }).click();
await p.waitForTimeout(600);
{
  const s = await stand();
  expect('Die Ansicht steht auf Skizze', s.ansicht, 'skizze');
  expect('Ein Blatt ist von selbst da', s.blaetter, 1);
  expect('Es heißt Blatt 1', s.namen, ['Blatt 1']);
  expect('Und ist leer', s.striche, 0);
}

console.log('\n▸ Zeichnen — mit dem Finger');
/*
 * Der Stand **vor** dem Zug. Das Demoprojekt bringt Wände mit, deshalb ist die
 * Frage nicht „sind Wände da", sondern „kommt durch das Zeichnen eine dazu".
 */
const waendeVorher = (await stand()).waende;
/** Die sichtbare Zeichenfläche der Skizzenseite — die größte im Bild. */
const blatt = await p.evaluate(() => {
  const flaechen = [...document.querySelectorAll('canvas')]
    .map((el) => el.getBoundingClientRect())
    .filter((r) => r.width > 100 && r.height > 100)
    .sort((a, b) => b.width * b.height - a.width * a.height);
  const r = flaechen[0];
  return r ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
});
if (!blatt) { console.log('  ✗ Keine Zeichenfläche gefunden'); process.exit(1); }
/*
 * Ein Zug quer über das Blatt, in Schritten. Der Zeigertyp ist `touch`: Auf
 * dem Blatt darf der Finger zeichnen, anders als im Grundriss, wo er das Bild
 * schiebt und ein Handballen sonst Wände zöge.
 */
await p.evaluate(async ({ x, y, w, h }) => {
  const el = document.elementFromPoint(x + w / 2, y + h / 2);
  const senden = (typ, px, py) => {
    el.dispatchEvent(new PointerEvent(typ, {
      pointerId: 7, pointerType: 'touch', isPrimary: true,
      clientX: px, clientY: py, bubbles: true, cancelable: true,
    }));
  };
  senden('pointerdown', x + w * 0.2, y + h * 0.3);
  for (let i = 1; i <= 20; i++) {
    senden('pointermove', x + w * (0.2 + 0.03 * i), y + h * (0.3 + 0.015 * i));
    await new Promise((r) => setTimeout(r, 8));
  }
  senden('pointerup', x + w * 0.8, y + h * 0.6);
}, blatt);
await p.waitForTimeout(400);
{
  const s = await stand();
  expect('Ein Strich liegt auf dem Blatt', s.striche, 1);
  expect('Mit mehreren Stützpunkten', s.punkte >= 2, true);
  /*
   * **Der Kern des Ganzen:** Auf dem Blatt entsteht keine Wand. Das Blatt ist
   * Papier und kein Grundriss — wer einen Grundriss zeichnen will, nimmt das
   * Skizzenblatt über dem Plan.
   */
  expect('Und keine Wand ist dazugekommen', s.waende, waendeVorher);
}

console.log('\n▸ Zurücknehmen und leeren');
await p.getByRole('button', { name: 'Strich zurück' }).click();
await p.waitForTimeout(250);
expect('Der Strich ist weg', (await stand()).striche, 0);
expect('Das Blatt ist geblieben', (await stand()).blaetter, 1);

console.log('\n▸ Mehrere Blätter');
await p.getByRole('button', { name: '+ Blatt' }).click();
await p.waitForTimeout(300);
await p.getByRole('button', { name: '+ Blatt' }).click();
await p.waitForTimeout(300);
{
  const s = await stand();
  expect('Drei Blätter', s.blaetter, 3);
  expect('Fortlaufend benannt', s.namen, ['Blatt 1', 'Blatt 2', 'Blatt 3']);
}

console.log('\n▸ Speichern und wieder öffnen');
/*
 * Das Blatt steht in den **Projektangaben** und nicht neben den Wänden: Die
 * Projektangaben gehen unverändert durch die Datei. Ein Blatt, das das
 * Speichern nicht überlebt, zeichnet niemand ein zweites Mal.
 */
const ueberlebt = await p.evaluate(() => {
  const s = window.__ravia.getState();
  const id = s.aktivesBlatt ?? Object.keys(s.doc.meta.skizzen ?? {})[0];
  s.zeichneAufBlatt(id, [{ x: 10, y: 10 }, { x: 100, y: 60 }, { x: 180, y: 20 }], 'rot', 2);
  const datei = JSON.parse(JSON.stringify(window.RaViaCAD.getExport()));
  const vorher = Object.values(window.__ravia.getState().doc.meta.skizzen ?? {});
  window.__ravia.getState().loadProject(datei);
  const nachher = Object.values(window.__ravia.getState().doc.meta.skizzen ?? {});
  return {
    inDerDatei: Object.keys(datei.project.skizzen ?? {}).length,
    vorher: vorher.length,
    nachher: nachher.length,
    stricheVorher: vorher.reduce((n, x) => n + x.striche.length, 0),
    stricheNachher: nachher.reduce((n, x) => n + x.striche.length, 0),
    namen: nachher.map((x) => x.name).sort(),
  };
});
expect('Die Blätter stehen in der Datei', ueberlebt.inDerDatei, 3);
expect('Nach dem Öffnen sind sie wieder da', ueberlebt.nachher, ueberlebt.vorher);
expect('Mit ihren Strichen', ueberlebt.stricheNachher, ueberlebt.stricheVorher);
expect('Und ihren Namen', ueberlebt.namen, ['Blatt 1', 'Blatt 2', 'Blatt 3']);

await p.screenshot({ path: './screenshots/skizzenseite.png' });
console.log('\n▸ Nichts in der Konsole');
expect('Keine Fehler im Browser', errs.slice(0, 3), []);

await b.close();
console.log(failures ? `\n✗ ${failures} Prüfung(en) fehlgeschlagen` : '\n✓ Skizzenseite: alles in Ordnung');
process.exit(failures ? 1 : 0);
