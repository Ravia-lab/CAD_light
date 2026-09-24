/**
 * Bildprüfstand — der erste Rauchtest, der ein Pixel sieht.
 *
 * 2552 kopflose Prüfungen und fünfzehn Rauchtests rechnen nach, ob die Zahlen
 * stimmen. Drei aufeinanderfolgende Fehler haben sie alle durchgelassen, weil
 * sie **rechnerisch richtig und optisch falsch** waren: eine Lücke zwischen
 * den Geschossdecken im Modell (1.11), eine Decke eine ganze Plattenstärke zu
 * hoch (1.12), eine DN-Beschriftung doppelt an Vor- und Rücklauf (1.13). Alle
 * drei musste der Anwender selbst finden. Genau dorthin zielt dieser Test.
 *
 * Er tut zweierlei, und das Zweite ist das Wichtigere:
 *
 *  1. **Referenzvergleich.** Vier Ansichten werden aufgenommen und Pixel für
 *     Pixel gegen ein hinterlegtes Bild gehalten. Fehlt die Referenz, wird sie
 *     angelegt; der Lauf gilt dann für dieses Bild als bestanden und meldet
 *     das deutlich. Das findet *jede* ungewollte Änderung — aber es sagt
 *     nicht, was falsch ist, und es schlägt auch bei gewollten Änderungen an.
 *
 *  2. **Gezielte Messungen im Bild.** Drei Aussagen über die Zeichnung, die
 *     unabhängig von jeder Referenz gelten und benennen, was kaputt ist:
 *     die Fassade hat keine Fuge zwischen den Geschossen, eine Trasse trägt
 *     ihre Nennweite genau einmal, und die Zeichnung füllt das Blatt, ohne
 *     darüber hinauszulaufen.
 *
 * Determinismus ist die halbe Miete: fester Viewport, `deviceScaleFactor` 1,
 * abgeschaltete Bewegung, gewartete Schriften — und das Tagesdatum im
 * Schriftkopf wird vor der Aufnahme auf einen festen Wert gesetzt, sonst wäre
 * die Referenz jeden Tag um Mitternacht ungültig.
 */

import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Unter welcher Adresse geprüft wird.
 *
 * Vorgabe ist die Vorschau aus `vite preview`. Über `RAVIA_PROBE` lässt sich
 * stattdessen ein **echter Server** prüfen — und vor allem einer, der die
 * Anwendung unter einem **Unterpfad** ausliefert:
 *
 *     RAVIA_PROBE=http://localhost:8080/Cad_light/ node scripts/smoke-ui.mjs
 *
 * Das ist kein Beiwerk. Ein Build für einen Unterpfad schreibt andere
 * Adressen in die index.html, und ob die stimmen, zeigt sich nur, wenn man
 * genau dort prüft. Der abschließende Schrägstrich gehört dazu.
 */
const BASIS = process.env.RAVIA_PROBE ?? 'http://localhost:4177/';


const HIER = path.dirname(fileURLToPath(import.meta.url));
const REFERENZ = path.join(HIER, 'referenz');
/** Zulässiger Anteil abweichender Pixel, bevor ein Bild als geändert gilt. */
const SCHWELLE_PROZENT = 0.3;

fs.mkdirSync(REFERENZ, { recursive: true });

const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});

/**
 * Die Umgebung, in der die Referenzbilder entstanden sind.
 *
 * **Warum das mitgeschrieben wird.** Ein Pixelvergleich von Text ist an die
 * Maschine gebunden, die ihn erzeugt hat. Zieht das Projekt auf einen anderen
 * Rechner oder wechselt Chromium die Fassung, verrutscht der Textsatz um
 * ein, zwei Pixel — die Zahlen bleiben dieselben, die Bilder nicht. Genau das
 * ist hier passiert: nach einem Umzug wichen alle drei Blätter mit Text
 * systematisch ab (0,167 / 0,233 / 0,352 %), das Blatt ohne Text mit 0,000 %.
 *
 * Die Fehlersuche kostete eine Stunde, weil die Meldung nur „0,352 % ab-
 * weichende Pixel" sagte. Mit dieser Datei daneben steht die Antwort in der
 * ersten Zeile des Fehlers. Sie kostet nichts und spart genau diese Stunde.
 */
const umgebung = {
  chromium: b.version(),
  plattform: `${process.platform}-${process.arch}`,
  node: process.version,
  angelegt: new Date().toISOString().slice(0, 10),
};
const UMGEBUNG_DATEI = path.join(REFERENZ, 'umgebung.json');
const umgebungAlt = fs.existsSync(UMGEBUNG_DATEI)
  ? JSON.parse(fs.readFileSync(UMGEBUNG_DATEI, 'utf-8'))
  : null;
const umgebungGleich =
  umgebungAlt !== null &&
  umgebungAlt.chromium === umgebung.chromium &&
  umgebungAlt.plattform === umgebung.plattform;
// `reducedMotion` schaltet Übergänge ab. Ohne das entscheidet der Zufall der
// Aufnahmezeit darüber, wie weit eine Einblendung fortgeschritten war.
const ctx = await b.newContext({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 1,
  reducedMotion: 'reduce',
});
const p = await ctx.newPage();

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

/** Zählt einen bestandenen Prüfpunkt ohne Erwartungswert (Referenz neu angelegt). */
const hinweis = (label, text) => console.log(`  ✓ ${label}: ${text}`);

// ---------------------------------------------------------------- Bildhilfen

/**
 * Vergleicht eine frische Aufnahme mit ihrer Referenz.
 *
 * Fehlt die Referenz, wird sie angelegt. Das ist der einzige Weg, wie ein
 * Bildprüfstand überhaupt anfangen kann — und er muss laut sein, sonst hält
 * jemand einen Erstlauf für eine bestandene Prüfung.
 */
const vergleicheMitReferenz = (name, ist) => {
  const ziel = path.join(REFERENZ, `${name}.png`);
  // Nach einer *gewollten* Änderung am Aussehen: `REFERENZ_NEU=1` setzen und
  // den Lauf einmal durchlassen. Der Weg über eine Umgebungsvariable ist
  // Absicht — wer die Referenz erneuert, soll das ausdrücklich tun und die
  // neuen Bilder im Diff sehen, nicht nebenbei ein rotes Ergebnis wegwischen.
  if (process.env.REFERENZ_NEU === '1' || !fs.existsSync(ziel)) {
    const neuAngelegt = !fs.existsSync(ziel);
    fs.writeFileSync(ziel, ist);
    fs.writeFileSync(UMGEBUNG_DATEI, JSON.stringify(umgebung, null, 2) + '\n');
    hinweis(
      `Referenz „${name}"`,
      `${neuAngelegt ? 'neu angelegt' : 'auf Wunsch erneuert'} — beim nächsten Lauf wird verglichen`,
    );
    return;
  }
  const soll = PNG.sync.read(fs.readFileSync(ziel));
  const neu = PNG.sync.read(ist);
  if (soll.width !== neu.width || soll.height !== neu.height) {
    failures++;
    console.log(
      `  ✗ Referenz „${name}": Bildmaß geändert ${soll.width}×${soll.height} → ${neu.width}×${neu.height}`,
    );
    return;
  }
  const diff = new PNG({ width: soll.width, height: soll.height });
  const abweichend = pixelmatch(soll.data, neu.data, diff.data, soll.width, soll.height, {
    threshold: 0.12,
  });
  const anteil = (abweichend / (soll.width * soll.height)) * 100;
  const ok = anteil <= SCHWELLE_PROZENT;
  if (!ok) {
    failures++;
    // Das Abweichungsbild ist die eigentliche Fehlermeldung: es zeigt, *wo*
    // sich etwas verschoben hat. Eine Prozentzahl allein ist ein Alarm ohne
    // Adresse.
    fs.writeFileSync(path.join(REFERENZ, `${name}.abweichung.png`), PNG.sync.write(diff));
    fs.writeFileSync(path.join(REFERENZ, `${name}.ist.png`), ist);
  }
  console.log(
    `  ${ok ? '✓' : '✗'} Referenz „${name}": ${anteil.toFixed(3)} % abweichende Pixel` +
      `${ok ? '' : ` (Schwelle ${SCHWELLE_PROZENT} % — siehe ${name}.abweichung.png)`}`,
  );
  // Die erste Frage bei einem roten Bildvergleich lautet: hat sich das
  // Programm geändert oder die Maschine? Wenn die Umgebung eine andere ist,
  // steht die Antwort hier, bevor jemand anfängt zu suchen.
  if (!ok && !umgebungGleich) {
    console.log(
      umgebungAlt
        ? `      Achtung: die Referenzen stammen aus einer anderen Umgebung —\n` +
          `      Referenz: Chromium ${umgebungAlt.chromium} auf ${umgebungAlt.plattform} (${umgebungAlt.angelegt})\n` +
          `      jetzt   : Chromium ${umgebung.chromium} auf ${umgebung.plattform}\n` +
          `      Textsatz verschiebt sich zwischen Fassungen um ein, zwei Pixel.\n` +
          `      Zahlen im Abweichungsbild prüfen: sind sie gleich und nur versetzt,\n` +
          `      ist es die Maschine. Dann: REFERENZ_NEU=1 npm run smoke:bild`
        : `      Hinweis: zu den Referenzen ist keine Umgebung hinterlegt.\n` +
          `      Einmal mit REFERENZ_NEU=1 laufen lassen legt sie an.`,
    );
  }
};

/** Nimmt einen Bildausschnitt auf; der Kopfstreifen der Ansicht bleibt außen vor. */
const nimmAuf = async (selektor, { kopf = 0 } = {}) => {
  const box = await p.locator(selektor).first().boundingBox();
  if (!box) throw new Error(`Kein Bildbereich für „${selektor}"`);
  return await p.screenshot({
    clip: {
      x: Math.round(box.x),
      y: Math.round(box.y + kopf),
      width: Math.round(box.width),
      height: Math.round(box.height - kopf),
    },
  });
};

/** Helligkeit eines Pixels — die Trennlinie zwischen Bauteil und Nichts. */
const helligkeit = (png, x, y) => {
  const i = (png.width * y + x) * 4;
  return 0.299 * png.data[i] + 0.587 * png.data[i + 1] + 0.114 * png.data[i + 2];
};

// -------------------------------------------------------------- Seite laden

await p.addInitScript(() => {
  localStorage.setItem('ravia-ui-mode', 'profi');
  localStorage.setItem('ravia-einfuehrung', '1');
});
await p.goto(BASIS, { waitUntil: 'networkidle' });
await p.waitForFunction(() => typeof window.__ravia !== 'undefined', null, { timeout: 30000 });
// Schriften abwarten: eine noch nicht geladene Schrift verschiebt jede
// Beschriftung im Bild und macht den Vergleich zum Glücksspiel.
await p.evaluate(() => document.fonts.ready);
await p.evaluate(() => window.__ravia.getState().loadDemo());
await p.waitForTimeout(900);

console.log('\n▸ Rohrnetz auslegen — ohne Leitungen gibt es nichts zu beschriften');
/** Zahl der Vorläufe — die Obergrenze für die Zahl der DN-Beschriftungen. */
let vorlaufAnzahl = 0;
{
  await p.getByTitle(/Rohrnetz automatisch auslegen/).click();
  await p.waitForTimeout(1500);
  const stand = await p.evaluate(() => {
    const runs = Object.values(window.__ravia.getState().doc.pipes ?? {});
    return {
      leitungen: runs.length,
      vorlauf: runs.filter((r) => r.service === 'heating-flow').length,
    };
  });
  expect('Es liegen Leitungen im Modell', stand.leitungen > 0, true);
  vorlaufAnzahl = stand.vorlauf;
}

console.log('\n▸ Bild 1 — Grundriss 2D');
{
  await p.evaluate(() => window.__ravia.getState().setViewMode('2d'));
  await p.waitForTimeout(1200);
  vergleicheMitReferenz('grundriss-2d', await nimmAuf('main canvas'));
}

console.log('\n▸ Bild 2 — Anlagenschema');
{
  const aside = p.locator('aside');
  await aside.getByRole('button', { name: 'Anlage', exact: true }).click();
  await p.waitForTimeout(600);
  const erzeugen = aside.getByRole('button', { name: /Schema erzeugen/ }).first();
  if (await erzeugen.isVisible().catch(() => false)) {
    await erzeugen.click();
    await p.waitForTimeout(800);
  }
  const bauteile = await p.evaluate(
    () => Object.keys(window.__ravia.getState().doc.plant.schematic.components).length,
  );
  expect('Das Schema hat Bauteile', bauteile > 4, true);

  await p.evaluate(() => window.__ravia.getState().setViewMode('schema'));
  await p.waitForTimeout(1400);
  vergleicheMitReferenz('anlagenschema', await nimmAuf('main canvas'));
}

console.log('\n▸ Bild 3 — Druckblatt (Rohrnetzbericht, Blatt 1)');
let blattMasse = null;
{
  await p.evaluate(() => window.__ravia.getState().setViewMode('2d'));
  await p.waitForTimeout(500);
  await p.getByTitle(/Rohrnetzberechnung/).first().click();
  await p.waitForTimeout(1800);
  expect('Der Berichtsdialog steht offen',
    await p.getByText('Rohrnetzberechnung', { exact: true }).first().isVisible(), true);

  const blatt = () => p.locator('.panel .flex-1 svg').first();

  /*
   * Das Tagesdatum im Schriftkopf auf einen festen Wert setzen.
   *
   * `buildTitleBlock` schreibt `new Date()` aufs Blatt. Ohne diesen Griff
   * wäre die Referenz jede Nacht um null Uhr ungültig — und ein Prüfstand,
   * der ohne Anlass rot wird, wird nach der zweiten Woche ignoriert.
   * Der Griff muss nach *jedem* Neuzeichnen wiederholt werden.
   */
  const datumFestsetzen = async () => {
    await blatt().evaluate((svg) => {
      for (const t of svg.querySelectorAll('text')) {
        if (/\d{1,2}\.\d{1,2}\.\d{4}/.test(t.textContent ?? '')) {
          t.textContent = (t.textContent ?? '').replace(/\d{1,2}\.\d{1,2}\.\d{4}/, '01.01.2020');
        }
      }
    });
  };

  /**
   * Ausdehnung der Zeichnung im Anwenderkoordinatensystem des SVG — also in
   * Millimetern auf dem Papier.
   */
  const messeBlatt = async () =>
    await blatt().evaluate((svg) => {
      const vb = svg.viewBox.baseVal;
      // Die Zeichnung besteht aus Wandflächen (`polygon`) und Leitungen
      // (`path` mit runden Enden). Rahmen, Raster und Schriftkopf bleiben
      // außen vor — sie füllen das Blatt per Definition und würden jede
      // Messung schönrechnen.
      const teile = [
        ...svg.querySelectorAll('polygon'),
        ...svg.querySelectorAll('path[stroke-linecap="round"]'),
      ];
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const el of teile) {
        const bb = el.getBBox();
        if (!bb.width && !bb.height) continue;
        x0 = Math.min(x0, bb.x); y0 = Math.min(y0, bb.y);
        x1 = Math.max(x1, bb.x + bb.width); y1 = Math.max(y1, bb.y + bb.height);
      }
      return { blatt: { w: vb.width, h: vb.height }, teile: teile.length, x0, y0, x1, y1 };
    });

  /** Satzspiegel: links/oben/rechts 12 mm, unten 34 mm für den Schriftkopf. */
  const satzspiegel = (m) => ({
    x0: 12,
    y0: 12,
    x1: m.blatt.w - 12,
    y1: m.blatt.h - 34,
  });
  /** Liegt die Zeichnung im Satzspiegel? Ein halber Millimeter Toleranz für
   *  die Strichbreiten, die `getBBox` mitzählt. */
  const imFeld = (m) => {
    const f = satzspiegel(m);
    return m.x0 >= f.x0 - 0.5 && m.y0 >= f.y0 - 0.5 && m.x1 <= f.x1 + 0.5 && m.y1 <= f.y1 + 0.5;
  };

  /*
   * Erst der Voreinstellung auf den Zahn fühlen.
   *
   * Der Demo-Grundriss ist 10 m breit und passt im voreingestellten Maßstab
   * 1:50 nicht auf A4 hoch. Das ist kein Fehler, solange das Blatt es sagt —
   * und genau das wird hier geprüft: **die Warnung erscheint genau dann, wenn
   * die Zeichnung den Satzspiegel verlässt.** Ein Blatt, das schweigend über
   * den Rand läuft, wäre der schlimmere Fall.
   */
  const roh = await messeBlatt();
  const warnung = await p.getByText(/passt bei 1:\d+ nicht auf/).isVisible().catch(() => false);
  console.log(
    `    Bei Voreinstellung: Blatt ${roh.blatt.w}×${roh.blatt.h} mm, Zeichnung ` +
      `x ${roh.x0.toFixed(1)}…${roh.x1.toFixed(1)}, y ${roh.y0.toFixed(1)}…${roh.y1.toFixed(1)} mm`,
  );
  expect('Der Überstand wird gemeldet, statt still gedruckt zu werden', warnung, !imFeld(roh));

  // Den angebotenen Maßstab übernehmen — geprüft wird danach, ob das
  // Versprechen „ab 1:x passt er" auch stimmt.
  if (warnung) {
    await p.getByRole('button', { name: /Auf 1:\d+ umstellen/ }).click();
    await p.waitForTimeout(1200);
  }
  await datumFestsetzen();

  // --- Messung: eine Trasse trägt ihre Nennweite genau einmal ---------------
  //
  // Der Fehler aus 1.13: Vor- und Rücklauf laufen fünf Zentimeter nebeneinander
  // und tragen dieselbe Nennweite. Beschriftet die Zeichnung beide, steht
  // „DN 20" zweimal fast übereinander — rechnerisch richtig, optisch Matsch.
  // Gezählt wird im SVG statt im Pixelbild: `text`-Elemente tragen ihre
  // Koordinaten mit sich, ein Pixelhaufen nicht.
  const dn = await blatt().evaluate((svg) =>
    Array.from(svg.querySelectorAll('text'))
      .map((t) => ({
        text: (t.textContent ?? '').trim(),
        x: Number(t.getAttribute('x') ?? NaN),
        y: Number(t.getAttribute('y') ?? NaN),
      }))
      /*
       * **Diese Prüfung suchte „DN 20" und war seit 1.28.0 rot.** Seitdem
       * steht im Plan die Handelsbezeichnung — `Cu 22 × 1`, `PE-X 16 × 2`
       * —, weil der Handwerker danach bestellt; die Nennweite steht im
       * Inspektor und in der Legende daneben. Gesehen hat das niemand,
       * weil `smoke:bild` bei keiner Freigabe mitlief. Gefunden beim
       * ersten vollständigen Lauf von `npm run freigabe` (24.09.2026).
       *
       * Gesucht wird deshalb beides: die Handelsbezeichnung *und* die alte
       * Schreibweise, denn ein Rohr ohne bekannten Werkstoff trägt weiter
       * „DN 20".
       */
      .filter((o) => /^(DN \d+|Cu |St |ES |PE-Xa |MSV |PP-R )/.test(o.text)
        && Number.isFinite(o.x) && Number.isFinite(o.y)),
  );
  expect('Rohrbezeichnungen stehen im Plan', dn.length > 0, true);
  // Zwei gleiche Beschriftungen näher als 3 mm beieinander sind ein Doppel.
  // Der Abstand von Vor- zu Rücklauf beträgt 5 cm im Modell; auf dem Blatt
  // sind das im Maßstab 1:50 genau ein Millimeter.
  let doppelt = 0;
  for (let i = 0; i < dn.length; i++) {
    for (let j = i + 1; j < dn.length; j++) {
      if (dn[i].text !== dn[j].text) continue;
      if (Math.hypot(dn[i].x - dn[j].x, dn[i].y - dn[j].y) < 3) doppelt++;
    }
  }
  expect('Keine Rohrbezeichnung steht zweimal am selben Ort', doppelt, 0);
  // Und der Gegenbeweis von der anderen Seite: es kann höchstens so viele
  // Beschriftungen geben wie Vorläufe. Wären Vor- *und* Rücklauf beschriftet,
  // stünde hier ungefähr das Doppelte.
  expect('Höchstens eine Beschriftung je Vorlauf', dn.length <= vorlaufAnzahl, true);

  // --- Messung: das Blatt ist gefüllt, aber nicht übergelaufen -------------
  //
  // Ein Plan, der über den Rand hinausragt, wird beim Drucken beschnitten;
  // einer, der in einer Ecke kauert, ist unlesbar. Gemessen wird im
  // Anwenderkoordinatensystem des SVG — also in Millimetern auf dem Papier.
  blattMasse = await messeBlatt();
  const feld = satzspiegel(blattMasse);
  expect('Es steht eine Zeichnung auf dem Blatt', blattMasse.teile > 10, true);
  console.log(
    `    Nach Umstellung: Blatt ${blattMasse.blatt.w}×${blattMasse.blatt.h} mm, Zeichnung ` +
      `x ${blattMasse.x0.toFixed(1)}…${blattMasse.x1.toFixed(1)}, ` +
      `y ${blattMasse.y0.toFixed(1)}…${blattMasse.y1.toFixed(1)} mm`,
  );
  // Ein halber Millimeter Toleranz: Linienbreiten zählen in `getBBox` mit.
  const t = 0.5;
  expect('Die Zeichnung bleibt links im Satzspiegel', blattMasse.x0 >= feld.x0 - t, true);
  expect('… oben', blattMasse.y0 >= feld.y0 - t, true);
  expect('… rechts', blattMasse.x1 <= feld.x1 + t, true);
  expect('… unten (über dem Schriftkopf)', blattMasse.y1 <= feld.y1 + t, true);

  const fuellung =
    ((blattMasse.x1 - blattMasse.x0) * (blattMasse.y1 - blattMasse.y0)) /
    ((feld.x1 - feld.x0) * (feld.y1 - feld.y0));
  console.log(`    Füllgrad des Satzspiegels: ${(fuellung * 100).toFixed(1)} %`);
  // Unter 15 % kauert die Zeichnung in einer Ecke und ist unlesbar; über
  // 100 % ginge nur, wenn sie den Rahmen sprengt — das fangen schon die vier
  // Prüfungen darüber ab.
  expect('Das Blatt ist plausibel gefüllt', fuellung >= 0.15 && fuellung <= 1.0, true);

  await datumFestsetzen();
  vergleicheMitReferenz('druckblatt-rohrnetz', await nimmAuf('.panel .flex-1 svg'));

  await p.getByTitle('Schließen').first().click();
  await p.waitForTimeout(400);
}

console.log('\n▸ Bild 4 — Modell 3D, zwei Geschosse');
{
  // Ein Geschoss mit übernommenem Grundriss darüber. Erst mit zwei Geschossen
  // gibt es überhaupt eine Geschossfuge, und genau die war zweimal kaputt.
  await p.evaluate(() => {
    const s = window.__ravia.getState();
    s.addLevel({ copyFrom: s.doc.activeLevelId });
  });
  await p.waitForTimeout(700);
  const geschosse = await p.evaluate(() =>
    Object.values(window.__ravia.getState().doc.levels)
      .sort((a, b) => a.order - b.order)
      .map((l) => l.name),
  );
  expect('Es stehen zwei Geschosse im Modell', geschosse, ['EG', '1. OG']);

  await p.evaluate(() => window.__ravia.getState().setViewMode('3d'));
  await p.waitForTimeout(3000);
  await p.evaluate(() => window.__ravia.getState().setCameraMode('iso'));
  await p.waitForTimeout(2000);

  // Das Gelände muss aus dem Bild: Rasenflächen und Beläge sind so hell wie
  // Wände und würden die Fassadenmessung unterlaufen.
  const gelaende = p.getByRole('button', { name: 'Gelände', exact: true });
  const anGewesen = await gelaende.evaluate((el) => el.className.includes('text-accent'));
  if (anGewesen) {
    await gelaende.click();
    await p.waitForTimeout(900);
  }
  // Kamera nach dem Anlegen des Obergeschosses neu einpassen, sonst hängt der
  // Ausschnitt von der Reihenfolge der Bedienschritte ab.
  await p.getByRole('button', { name: 'Einpassen', exact: true }).click();
  await p.waitForTimeout(1600);

  // Der Kopfstreifen mit den Kameraknöpfen bleibt außen vor — er gehört zur
  // Bedienung, nicht zum Modell.
  const bild = await nimmAuf('main canvas', { kopf: 52 });
  vergleicheMitReferenz('modell-3d-iso', bild);

  // --- Messung: keine Lücke zwischen den Geschossen ------------------------
  //
  // Der Fehler, den der Anwender zweimal melden musste. Gemessen wird an der
  // Fassade selbst, nicht am Modell:
  //
  //  • Bauteilpixel sind hell (Wand 0xD8DEE9, Decke 0x9AA5B5); Hintergrund,
  //    Fensterlaibungen und Türblätter sind dunkel.
  //  • Für jede Spalte wird von unten aufwärts der ununterbrochene Lauf aus
  //    Bauteilpixeln genommen — die stehende Fassade.
  //  • Innerhalb dieses Laufes muss das Deckenband liegen: ein Streifen in
  //    Deckenhelligkeit mit Wand darüber *und* darunter. Genau das ist die
  //    Aussage „zwischen den Geschossen liegt Beton und kein Nichts".
  //
  // Reißt die Fuge auf, trennt der dunkle Streifen den Lauf in zwei Teile;
  // dann findet keine einzige Spalte mehr ein eingebettetes Deckenband. Der
  // Wert fällt von rund 70 % auf 0 % — dazwischen liegt nichts, was zufällig
  // entstehen könnte.
  const fuge = await (async () => {
    const png = PNG.sync.read(bild);
    const BAUTEIL = 70; // alles darunter ist Hintergrund, Laibung oder Glasrahmen
    const DECKE = [110, 152]; // Deckenband, seitenabhängig beleuchtet
    const WAND = 160; // Wandfläche darüber und darunter

    let x0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let y = 0; y < png.height; y++) {
      for (let x = 0; x < png.width; x++) {
        if (helligkeit(png, x, y) >= BAUTEIL) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y > y1) y1 = y;
        }
      }
    }
    if (!Number.isFinite(x0)) return { spalten: 0, mitDecke: 0, anteil: 0 };

    let spalten = 0;
    let mitDecke = 0;
    for (let x = x0; x <= x1; x++) {
      let unten = -1;
      for (let y = y1; y >= 0; y--) if (helligkeit(png, x, y) >= BAUTEIL) { unten = y; break; }
      if (unten < 0) continue;
      let oben = unten;
      while (oben > 0 && helligkeit(png, x, oben - 1) >= BAUTEIL) oben--;
      // Kürzer als 40 Pixel ist keine Fassade, sondern eine Kante.
      if (unten - oben < 40) continue;
      spalten++;
      for (let y = oben + 3; y < unten - 3; y++) {
        const h = helligkeit(png, x, y);
        if (h < DECKE[0] || h > DECKE[1]) continue;
        let ende = y;
        while (ende < unten && helligkeit(png, x, ende) >= DECKE[0] && helligkeit(png, x, ende) <= DECKE[1]) ende++;
        const dicke = ende - y;
        const drueber = helligkeit(png, x, y - 2);
        const drunter = ende < unten ? helligkeit(png, x, ende + 2) : 0;
        if (dicke >= 5 && drueber >= WAND && drunter >= WAND) { mitDecke++; break; }
        y = ende;
      }
    }
    return { spalten, mitDecke, anteil: spalten ? mitDecke / spalten : 0 };
  })();

  console.log(
    `    Fassadenspalten: ${fuge.spalten}, davon mit eingebettetem Deckenband: ${fuge.mitDecke}` +
      ` (${(fuge.anteil * 100).toFixed(1)} %)`,
  );
  expect('Die Fassade wird über die volle Breite abgetastet', fuge.spalten > 200, true);
  expect('Zwischen den Geschossen liegt kein Hintergrund', fuge.anteil >= 0.5, true);
}

console.log('\nERRORS:', errs.length ? errs.join(' | ') : 'keine');
if (errs.length) failures += errs.length;
console.log(`\n${failures === 0 ? '✓ RAUCHTEST BESTANDEN' : `✗ ${failures} FEHLER`}\n`);
await b.close();
process.exit(failures === 0 ? 0 : 1);
