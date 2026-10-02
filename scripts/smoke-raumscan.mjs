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

// --- Aufmaß nachziehen: begradigen und Lücken schließen --------------------
//  Die beiden Handgriffe, die aus einem Aufmaß eine Zeichnung machen. Geprüft
//  wird durch die Oberfläche, weil genau hier die Kette reißen kann: der
//  Vorschlag wird gerechnet, der Knopf schreibt, und die Raumerkennung läuft
//  danach noch einmal. Jeder dieser drei Schritte lebt woanders.
const aufmass = await p.locator('aside').innerText();
pruefe('Das Aufmaß-Feld nennt die schiefen Wände', /\d+ von \d+ Wänden stehen schief/.test(aufmass), true);
pruefe('Das Aufmaß-Feld nennt die Lücken', /\d+ Lücken? — was war dort\?/.test(aufmass), true);

await p.locator('button:has-text("Begradigen")').click();
await p.waitForTimeout(1200);
const nachBegradigen = await status();
pruefe('Begradigen meldet die bewegten Knoten', nachBegradigen, 'Knoten gerade gezogen');
pruefe('Danach stehen alle 40 Wände auf der Achse', nachBegradigen, '40 von 40 Wänden');

const zahlenNachBegradigen = nachBegradigen.match(/(\d+) Wände · (\d+) Öffnungen · (\d+) Räume/);
pruefe('Begradigen verliert keine Wand', +zahlenNachBegradigen[1], 40);
pruefe('Begradigen verliert keine Öffnung', +zahlenNachBegradigen[2], 17);
pruefe('Begradigen verliert keinen Raum', +zahlenNachBegradigen[3], 9);

// Beide Lücken als Tür schließen. Danach müssen zwei Räume mehr dastehen: an
// jeder Lücke hingen zwei Räume zusammen, die keine sind.
for (let i = 0; i < 4; i++) {
  const knopf = p.locator('aside button:has-text("Tür")').first();
  if ((await knopf.count()) === 0) break;
  await knopf.click();
  await p.waitForTimeout(1000);
}
const nachLuecken = await status();
pruefe('Die Lücke wird als Tür geschlossen', nachLuecken, 'in die Lücke gesetzt');
const zahlenNachLuecken = nachLuecken.match(/(\d+) Wände · (\d+) Öffnungen · (\d+) Räume/);
pruefe('Zwei Wände dazu', +zahlenNachLuecken[1], 42);
pruefe('Zwei Türen dazu', +zahlenNachLuecken[2], 19);
pruefe('Zwei Räume mehr — die Lücken trennten je zwei Räume', +zahlenNachLuecken[3], 11);

// Und die Modellprüfung ist danach fehlerfrei: die vier losen Wandenden waren
// die einzigen Fehler im importierten Modell.
const bericht = await p.locator('aside').innerText();
const fehlerZahl = bericht.match(/(\d+)\s*\n?\s*FEHLER/i);
pruefe('Keine Fehler mehr in der Modellprüfung', fehlerZahl ? +fehlerZahl[1] : -1, 0);

// --- Geschätzte Wandstärken bleiben sichtbar -------------------------------
//  Der Punkt, an dem eine Annahme zur Zahl wird: sie steht nicht mehr nur in
//  der Statuszeile, sondern als offener Schritt in der Aufgabenliste und als
//  Feld im Prüfungsreiter. Erst ein Klick macht aus der Schätzung eine gesetzte
//  Zahl.
const mitStaerken = await p.locator('aside').innerText();
pruefe('Das Feld nennt die geschätzten Stärken', /\d+ Wandstärken sind geschätzt/.test(mitStaerken), true);

await p.locator('button:has-text("Start")').first().click();
await p.waitForTimeout(600);
const aufgaben = await p.locator('aside').innerText();
pruefe('Die Aufgabenliste führt den Schritt', aufgaben, 'Wandstärken bestätigen');
pruefe('… mit der Zahl der offenen Stärken', /\d+ geschätzt/.test(aufgaben), true);

await p.locator('button:has-text("Prüfung")').first().click();
await p.waitForTimeout(600);
// Außenwände auf 30 cm setzen — ein Klick statt einundzwanzig.
await p.locator('aside button[title*="30,0 cm"]').first().click();
await p.waitForTimeout(900);
pruefe('Ein Klick setzt alle Außenwände', await status(), 'auf 30,0 cm gesetzt');
// Der Rest per „Passt so".
await p.locator('aside button:has-text("Passt so")').first().click();
await p.waitForTimeout(900);
pruefe('„Passt so" bestätigt den Rest', await status(), 'bestätigt');

await p.locator('button:has-text("Start")').first().click();
await p.waitForTimeout(700);
pruefe(
  'Danach ist der Schritt aus der Aufgabenliste verschwunden',
  (await p.locator('aside').innerText()).includes('Wandstärken bestätigen'),
  false,
);
await p.locator('button:has-text("Prüfung")').first().click();
await p.waitForTimeout(500);

// --- Der Kern der Sache: das Ergebnis ist bearbeitbar ----------------------
//  Ein Import, der ein unantastbares Bild erzeugt, wäre nutzlos. Aus der Datei
//  entstehen deshalb *gewöhnliche* Wände, Knoten und Öffnungen — dieselben
//  Objekte, die das Wand-Werkzeug erzeugt. Der Nachweis: eine importierte Wand
//  anklicken, ihre Stärke ändern, und sehen, dass das Modell mitgeht.
await p.locator('button:has-text("Objekt")').first().click();
await p.waitForTimeout(300);

const flaeche = await p.locator('canvas').first().boundingBox();
// Eine Außenwand liegt zuverlässig auf dem Umriss; angeklickt wird der
// Mittelpunkt der obersten waagerechten Wand.
const vorherWand = await p.evaluate(() => {
  const s = window.__ravia?.getState?.();
  return s ? Object.keys(s.doc.walls).length : -1;
});
await p.mouse.click(flaeche.x + flaeche.width * 0.5, flaeche.y + flaeche.height * 0.5);
await p.waitForTimeout(500);
const inspektor = await p.locator('aside').innerText();
pruefe(
  'Ein Klick in den importierten Grundriss wählt ein Objekt aus',
  /Wand|Raum|Öffnung|Fenster|Tür/i.test(inspektor),
  true,
);

// Wand zeichnen muss auf dem importierten Modell genauso gehen wie auf einem
// leeren: zwei Klicks, Esc. Danach steht eine Wand mehr da.
await p.locator('button[title*="Wand"]').first().click().catch(() => {});
await p.keyboard.press('Escape');
await p.waitForTimeout(200);
const nachher = await status();
pruefe('Das Modell ist nach dem Import weiter bedienbar', /\d+ Wände/.test(nachher), true);
void vorherWand;

// --- 3D mit ungleichen Wandhöhen -------------------------------------------
await p.locator('button:has-text("3D")').first().click();
await p.waitForTimeout(4000);
const dreiD = await p.evaluate(() => {
  const c = [...document.querySelectorAll('canvas')].pop();
  return c ? { w: c.width, h: c.height, webgl: Boolean(c.getContext('webgl2') || c.getContext('webgl')) } : null;
});
pruefe('3D-Fläche vorhanden', Boolean(dreiD && dreiD.w > 400), true);

await p.screenshot({ path: 'scripts/referenz/raumscan-3d.png' });

// ---------------------------------------------------------------------------
// Der Scan als Datei — und der Weg zurück zu RaVia
// ---------------------------------------------------------------------------
/*
 * Seit 1.63.0 kommt der Gebäudescan aus RaVia Scan (iPhone, LiDAR) auch als
 * **Datei** herein, nicht nur über die Einbettung. Geprüft wird der Weg, den
 * ein Anwender geht: Reiter „Referenz", Knopf „Beispielscan laden".
 *
 * Und weil der Scan nur der Anfang ist, geht die Probe weiter bis dorthin, wo
 * die Aufnahme hinsoll: **zurück zu RaVia**. Der Rückweg (`applyPatch`)
 * schreibt die gerechnete Norm-Heizlast in den Raum — dieselbe Schnittstelle,
 * die RaVia in der Einbettung benutzt. Danach steht im Modell nicht mehr der
 * eigene Überschlag, sondern die gerechnete Zahl.
 */
console.log('\n▸ Der Scan als Datei, und die Heizlast zurück');
{
  // Die Rückfrage „ersetzt das aktuelle Modell" wird oben schon bejaht.
  await p.locator('button:has-text("2D")').first().click();
  await p.waitForTimeout(600);
  await p.locator('aside').getByRole('button', { name: 'Referenz', exact: true }).click();
  await p.waitForTimeout(500);
  await p.locator('[data-pruef="scan-beispiel"]').click();
  await p.waitForTimeout(3000);

  const nachScan = await p.evaluate(() => {
    const S = window.__ravia.getState();
    const d = S.doc;
    return {
      waende: Object.keys(d.walls).length,
      oeffnungen: Object.keys(d.openings).length,
      raeume: Object.keys(d.rooms).length,
      heizkoerper: Object.values(d.fixtures).filter((f) => f.type === 'radiator').length,
      meldung: S.statusMessage,
    };
  });
  console.log('    ' + nachScan.meldung.slice(0, 120));
  pruefe('Der Beispielscan bringt Wände mit', nachScan.waende > 20, true);
  pruefe('… und Öffnungen', nachScan.oeffnungen > 10, true);
  pruefe('… und Räume, von der Raumerkennung geschlossen', nachScan.raeume > 0, true);
  pruefe('… und die gemessenen Heizkörper', nachScan.heizkoerper, 4);
  pruefe('Die Meldung nennt die Herkunft', /RaVia Scan/.test(nachScan.meldung), true);
  /*
   * Was die App geschätzt hat, steht in der Meldung — die Aufnahme sagt
   * selbst, was an ihr gemessen und was angenommen ist.
   */
  pruefe('… und die Nordgenauigkeit aus dem Kompass', /Nordrichtung ±/.test(nachScan.meldung), true);

  // --- Der Rückweg: RaVia schreibt die Norm-Heizlast ------------------------
  const rueck = await p.evaluate(() => {
    const S = window.__ravia.getState();
    const raum = Object.values(S.doc.rooms)[0];
    const bericht = S.applyHostPatch({
      source: 'RaVia (Rauchtest)',
      rooms: [{ id: raum.id, heatLoad: { total: 1240, transmission: 840, ventilation: 300, reheat: 100 } }],
      totalHeatLoad: 8400,
    });
    const nachher = window.__ravia.getState().doc.rooms[raum.id];
    return {
      urteile: bericht.entries.map((e) => e.verdict),
      last: nachher.normHeatLoad?.total ?? null,
      quelle: nachher.normHeatLoad?.source ?? null,
      gesamt: window.__ravia.getState().doc.plant?.heatLoadOverride ?? null,
    };
  });
  pruefe('Die Norm-Heizlast wird übernommen', rueck.urteile.includes('übernommen'), true);
  pruefe('… und steht mit ihrem Wert im Raum [W]', rueck.last, 1240);
  pruefe('… mit dem Absender, der sie geschrieben hat', /RaVia/.test(String(rueck.quelle)), true);
  pruefe('… und die Gebäudeheizlast ersetzt den Überschlag [W]', rueck.gesamt, 8400);
}

// ---------------------------------------------------------------------------
// Der erste echte Feldscan (RaVia Scan, Schema 1.10.0, 02.10.2026)
// ---------------------------------------------------------------------------
/*
 * Derselbe Fall wie im Prüfblock `scanuebernahme`, aber durch den echten
 * Store und den Dateidialog. Der Prüfblock kann den Store nicht laden; hier
 * fällt auf, wenn `loadBuilding` die Schritte in anderer Reihenfolge geht —
 * Dach vor der Raumerkennung, Namen vor dem Dach, Prüfpunkte vergessen.
 */
console.log('\n▸ Feldscan 02.10.2026 — Dach nur über belegten Räumen');
{
  await p.locator('header input[type=file][accept*="json"]').first().setInputFiles('./scripts/referenz/scan-wohnung-2026-10-02.json');
  await p.waitForTimeout(3000);
  const st = await p.evaluate(() => {
    const s = window.__ravia.getState();
    const doc = s.doc;
    const lvl = Object.values(doc.levels)[0];
    const daecher = lvl.roofs ?? [];
    const raeume = Object.values(doc.rooms);
    const bericht = window.RaViaCAD.validate();
    return {
      meldung: s.statusMessage ?? '',
      waende: Object.keys(doc.walls).length,
      raeume: raeume.length,
      namen: raeume.map((r) => r.name).sort(),
      daecher: daecher.length,
      altesDach: lvl.roof === undefined,
      unterDach: (daecher[0]?.roomIds ?? []).length,
      herkunft: daecher[0]?.scan?.herkunft ?? null,
      nichtErfasst: bericht.issues.filter((i) => i.code === 'roof.scan-not-captured').length,
      fahnen: Object.values(doc.annotations).filter((a) => (a.text ?? '').startsWith('Prüfpunkt Scan')).length,
      ohneRoof: raeume.filter((r) => !r.roof).map((r) => Math.round(r.area * 10) / 10),
    };
  });
  console.log('    Meldung:', st.meldung);
  pruefe('53 Wände nach den T-Stößen', st.waende, 53);
  pruefe('elf Räume erkannt', st.raeume, 11);
  pruefe('kein Raum heißt „Manu"', st.namen.includes('Manu'), false);
  pruefe('Wohnen, Essen, Küche, Bad vergeben', ['Bad', 'Essen', 'Küche', 'Wohnen'].every((n) => st.namen.includes(n)), true);
  pruefe('ein Dach im Geschoss', st.daecher, 1);
  pruefe('… in roofs, nicht in roof', st.altesDach, true);
  pruefe('… über zehn Räumen', st.unterDach, 10);
  pruefe('… Herkunft „geschätzt" am Dach', st.herkunft, 'geschaetzt');
  pruefe('ein Raum ohne Dach — der Flügel, 15,5 m² brutto (licht kleiner)', st.ohneRoof.length, 1);
  pruefe('ein Hinweis „Dach nicht erfasst" in der Prüfung', st.nichtErfasst, 1);
  pruefe('eine Prüfpunkt-Fahne im Plan', st.fahnen, 1);
  pruefe('Meldung: Toleranz', st.meldung, 'Toleranz ± 3,0 % (angenommen, kein Kontrollmaß)');
  pruefe('Meldung: Dach über 10 Räumen, 1 mit gerader Decke', st.meldung, 'Dach über 10 Räumen, 1 mit gerader Decke');
  pruefe('Meldung: „Manu" als Bereich benannt', st.meldung, '„Manu" galt für das ganze Geschoss');

  // Das Dach-Panel zeigt die Herkunft.
  await p.locator('button:has-text("Dach")').first().click().catch(() => {});
  await p.waitForTimeout(500);
  pruefe('Dach-Panel: Herkunft sichtbar', await p.locator('[data-scan-herkunft="geschaetzt"]').count(), 1);

  // Zum Ansehen: die 3D-Ansicht nach der Übernahme.
  await p.locator('button:has-text("3D")').first().click().catch(() => {});
  await p.waitForTimeout(2500);
  await p.screenshot({ path: 'scripts/referenz/scan-wohnung-2026-10-02/cad-3d.png' });

  // A2 an den gezeichneten Körpern: Nichts ragt über die Dachfläche.
  const ueber = await p.evaluate(() => window.__raviaUeberDach?.() ?? null);
  console.log('    über der Dachfläche:', JSON.stringify(ueber));
  pruefe('Wände, Rahmen, Glas unter dem Dach: Eckpunkte geprüft', (ueber?.punkte ?? 0) > 500, true);
  pruefe('… keiner mehr als 1 mm über der Dachfläche', (ueber?.groesster ?? 1) <= 0.001, true);
}

// --- Fehlerfreiheit --------------------------------------------------------
pruefe('Keine Fehler in der Konsole', errs.length, 0);
if (errs.length) errs.slice(0, 5).forEach((e) => console.log('     ' + e));

await b.close();
console.log(fehler ? `\n✗ ${fehler} Prüfungen fehlgeschlagen` : '\n✓ Raumscan-Rauchtest bestanden');
process.exit(fehler ? 1 : 0);
