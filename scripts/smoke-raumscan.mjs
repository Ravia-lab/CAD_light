/**
 * Browser-Test: einen echten iPhone-Raumscan im laufenden Programm öffnen.
 *
 * Was hier geprüft wird und in `scripts/pruefungen/raumscan.ts` nicht geprüft
 * werden kann: ob die Datei den ganzen Weg durch das Programm überlebt. Der
 * Prüfblock rechnet gegen die Bibliothek; hier wird die Datei in denselben
 * Dateidialog gelegt, den der Handwerker benutzt, und danach gefragt, was auf
 * dem Bildschirm steht.
 *
 * Drei Dinge, die nur hier auffallen:
 *
 *  · **Die Erkennung nach Inhalt.** Ein Scan ist JSON, eine Projektdatei auch.
 *    Wird die Reihenfolge der Prüfungen im Öffnen-Dialog vertauscht, liest
 *    `loadProject` den Scan als leeres Projekt ein — ohne Fehler, ohne Wände,
 *    ohne Meldung. Genau deshalb wird hier die Wandzahl abgefragt.
 *  · **Die Zeichnung.** Ob aus den Zahlen ein Grundriss wird, sagt kein
 *    Rechenblock. Der Bildvergleich unten zählt dunkle Bildpunkte — ein leerer
 *    Bildschirm hat keine.
 *  · **Die 3D-Ansicht.** Wandhöhen aus einem Scan sind pro Wand verschieden
 *    (1,19 bis 2,69 m im Beispiel). Das ist der Fall, an dem ein Modell
 *    scheitert, das eine Geschosshöhe voraussetzt.
 */
import { chromium } from 'playwright';

const BASIS = process.env.RAVIA_PROBE ?? 'http://localhost:4177/';
const DATEI = './scripts/referenz/raumscan-beispiel.json';

const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const p = await b.newPage({ viewport: { width: 1600, height: 950 }, deviceScaleFactor: 1 });
const errs = [];
p.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
p.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('Failed to load resource')) errs.push(m.text());
});

await p.addInitScript(() => {
  localStorage.setItem('ravia-ui-mode', 'profi');
  localStorage.setItem('ravia-einfuehrung', '1');
});

let fehler = 0;
const pruefe = (name, ist, soll, tol = 0) => {
  const ok =
    typeof soll === 'number' ? Math.abs(ist - soll) <= tol : typeof soll === 'boolean' ? ist === soll : String(ist).includes(soll);
  const kurz = String(ist).length > 60 ? String(ist).slice(0, 57) + '…' : String(ist);
  console.log(`  ${ok ? '✓' : '✗'} ${name}${typeof soll === 'string' ? '' : `: ${kurz}`}${ok ? '' : `  (erwartet ${soll}, erhalten ${kurz})`}`);
  if (!ok) fehler++;
};

await p.goto(BASIS, { waitUntil: 'networkidle' });
await p.waitForTimeout(800);

// Das Programm fragt vor dem Ersetzen nach. Beim Start steht der
// Demo-Grundriss, also kommt die Rückfrage — sie wird bejaht.
p.on('dialog', (d) => void d.accept());

const status = async () => (await p.locator('footer').innerText()).replace(/\n/g, ' | ');

// --- Scan öffnen -----------------------------------------------------------
await p.locator('header input[type=file][accept*="json"]').first().setInputFiles(DATEI);
await p.waitForTimeout(2500);

const zeile = await status();
console.log('\nStatuszeile:', zeile);

const zahlen = zeile.match(/(\d+) Wände · (\d+) Öffnungen · (\d+) Räume/);
pruefe('Statuszeile nennt Wände, Öffnungen, Räume', Boolean(zahlen), true);
if (zahlen) {
  pruefe('Wände im Modell', +zahlen[1], 40);
  pruefe('Öffnungen im Modell', +zahlen[2], 17);
  pruefe('Räume erkannt', +zahlen[3], 9);
}

// Die Meldung muss sagen, was geschätzt wurde, und was offen blieb. Ein
// Import, der beides verschweigt, liefert Zahlen ohne Herkunft.
pruefe('Meldung nennt die geschätzten Wandstärken', zeile, 'Wandstärken geschätzt');
pruefe('Meldung nennt die offenen Wandenden', zeile, 'offene Wandenden');
pruefe('Meldung nennt das Geraderücken', zeile, 'geradegerückt');

// --- Projektname und Adresse aus der Datei ---------------------------------
const name = await p.locator('header input:not([type])').first().inputValue();
pruefe('Projektname aus der Datei', name, 'Zuhause');

// --- Die Zeichnung ---------------------------------------------------------
const dunkel = await p.evaluate(() => {
  const c = document.querySelector('canvas');
  if (!c) return -1;
  const g = c.getContext('2d');
  if (!g) return -2;
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  // Wände werden hell auf dunklem Grund gezeichnet; gezählt wird alles, was
  // sich deutlich vom Hintergrund abhebt.
  for (let i = 0; i < d.length; i += 4) if (d[i] > 120 && d[i + 1] > 120) n++;
  return n;
});
// Die Schwelle ist nicht geraten, sondern an dem Fehler geeicht, den diese
// Zeile gefunden hat: bis zur Einführung des Einpass-Zählers blieb die
// Ansicht nach dem Import im alten Ausschnitt stehen. Sichtbar war eine
// einzelne Wandecke — 826 helle Bildpunkte. Der eingepasste Grundriss hat
// rund 9600. Zwischen beidem liegt eine Größenordnung; 4000 trennt sie mit
// Abstand nach beiden Seiten.
pruefe('Der Grundriss ist gezeichnet und eingepasst', dunkel > 4000, true);
console.log(`    ${dunkel} helle Bildpunkte (leerer Ausschnitt: unter 1000)`);

// --- Räume tragen die Nutzung aus dem Scan ---------------------------------
//  Vier der fünf benannten Bereiche landen in je einem erkannten Raum. Der
//  fünfte — die Küche — nicht: im Scan fehlt die Wand zwischen Küche und
//  Essbereich, beide liegen deshalb in *einem* Raum, und der trägt den
//  erstgenannten Namen. Das ist kein Fehler des Imports, sondern eine Lücke im
//  Aufmaß; sie wird gemeldet statt überspielt. Die Prüfung unten zeigt genau
//  dort ein offenes Wandende.
await p.locator('button:has-text("Räume")').first().click();
await p.waitForTimeout(600);
const raumbuch = await p.locator('aside').innerText();
for (const wort of ['Wohnen', 'Schlafen', 'Bad', 'Essen']) {
  pruefe(`Raumbuch nennt „${wort}"`, raumbuch, wort);
}
pruefe(
  'Der doppelt belegte Raum wird in der Meldung genannt',
  zeile.includes('zwei Bereiche in einem Raum'),
  true,
);

// --- Die Prüfung zeigt die offenen Enden -----------------------------------
await p.locator('button:has-text("Prüfung")').first().click();
await p.waitForTimeout(800);
const pruefung = await p.locator('aside').innerText();
pruefe(
  'Die Prüfung weist auf die offene Topologie hin',
  /offen|Lücke|Wandende|schließ/i.test(pruefung),
  true,
);

// --- 3D mit ungleichen Wandhöhen -------------------------------------------
await p.locator('button:has-text("3D")').first().click();
await p.waitForTimeout(4000);
const dreiD = await p.evaluate(() => {
  const c = [...document.querySelectorAll('canvas')].pop();
  return c ? { w: c.width, h: c.height, webgl: Boolean(c.getContext('webgl2') || c.getContext('webgl')) } : null;
});
pruefe('3D-Fläche vorhanden', Boolean(dreiD && dreiD.w > 400), true);

await p.screenshot({ path: 'scripts/referenz/raumscan-3d.png' });

// --- Fehlerfreiheit --------------------------------------------------------
pruefe('Keine Fehler in der Konsole', errs.length, 0);
if (errs.length) errs.slice(0, 5).forEach((e) => console.log('     ' + e));

await b.close();
console.log(fehler ? `\n✗ ${fehler} Prüfungen fehlgeschlagen` : '\n✓ Raumscan-Rauchtest bestanden');
process.exit(fehler ? 1 : 0);
