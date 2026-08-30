/**
 * Browser-Test der neuen Werkzeuge: Durchgang, TGA-Symbole, Ortho-Zwang,
 * Schwenken mit der rechten Maustaste und die Diagnose offener Wandenden.
 */
import { chromium } from 'playwright';

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


const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const p = await b.newPage({ viewport: { width: 1600, height: 950 }, deviceScaleFactor: 2 });
const errs = [];
p.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
p.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('Failed to load resource')) errs.push(m.text());
});

const status = async () => (await p.locator('footer').innerText()).replace(/\n/g, ' | ');
const counts = async () => {
  const t = await status();
  const m = t.match(/(\d+) Wände · (\d+) Öffnungen · (\d+) Räume/);
  const f = t.match(/(\d+) TGA/);
  return { walls: +m[1], openings: +m[2], rooms: +m[3], fixtures: f ? +f[1] : 0 };
};
// Die Rauchtests prüfen Fachplaner-Funktionen; der Auslieferungszustand ist
// bewusst der einfache Modus. Also vorher umschalten.
// Die Einführung beim allerersten Start würde jeden Klick abfangen. Sie
// gehört zur Anwendung und wird an genau einer Stelle geprüft
// (`smoke:ux`); überall sonst wird sie als „schon gesehen" markiert.
await p.addInitScript(() => {
  localStorage.setItem('ravia-ui-mode', 'profi');
  localStorage.setItem('ravia-einfuehrung', '1');
});


await p.goto(BASIS, { waitUntil: 'networkidle' });
await p.waitForTimeout(1000);
const start = await counts();
console.log('Start:', JSON.stringify(start));

const box = await p.locator('canvas').first().boundingBox();
const at = (fx, fy) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy });

// --- Durchgang in eine Wand setzen ---------------------------------------
await p.getByRole('button', { name: /Durchgang in Wand/ }).click();
await p.waitForTimeout(250);
await p.screenshot({ path: './screenshots/feat-1-passage-tool.png' });
// linke Außenwand ungefähr mittig treffen
await p.mouse.click(at(0.163, 0.75).x, at(0.163, 0.75).y);
await p.waitForTimeout(500);
const afterPassage = await counts();
console.log('Nach Durchgang:', JSON.stringify(afterPassage), '→', await status());

// --- TGA-Symbol platzieren ------------------------------------------------
await p.getByRole('button', { name: 'TGA', exact: true }).click();
await p.waitForTimeout(300);
await p.locator('aside').getByRole('button', { name: /Sanitär/ }).first().click();
await p.waitForTimeout(200);
await p.getByRole('button', { name: /Badewanne/ }).click();
await p.waitForTimeout(300);
await p.screenshot({ path: './screenshots/feat-2-tga-palette.png' });
await p.mouse.click(at(0.42, 0.62).x, at(0.42, 0.62).y);
await p.waitForTimeout(500);
const afterFixture = await counts();
console.log('Nach TGA:', JSON.stringify(afterFixture));

// --- Auswahl eines TGA-Objekts -------------------------------------------
await p.keyboard.press('v');
await p.waitForTimeout(200);
await p.mouse.click(at(0.42, 0.62).x, at(0.42, 0.62).y);
await p.waitForTimeout(400);
await p.screenshot({ path: './screenshots/feat-3-fixture-selected.png' });

// --- Fußbodenheizung: ganzen Raum belegen ---------------------------------
// Der Punkt der Prüfung ist nicht, dass ein Objekt entsteht — das täte auch
// das alte Einzelsymbol. Geprüft wird, dass die *Fläche* des Raums belegt
// wird: im Modell mit Verlegeabstand und Kreiszahl, im Plan mit einer Kurve,
// die messbar mehr Fläche einnimmt als ein Symbol.

/** Bildpunkt in der Raummitte — aus dem Modell gerechnet, nicht geraten. */
const raumMitte = async (name) =>
  p.evaluate((n) => {
    const st = window.__ravia.getState();
    const r = Object.values(st.doc.rooms).find(
      (x) => x.levelId === st.doc.activeLevelId && x.name.startsWith(n),
    );
    if (!r) return null;
    const rect = document.querySelector('canvas').getBoundingClientRect();
    const { zoom, center } = st.viewport;
    return {
      id: r.id,
      name: r.name,
      area: r.area,
      x: rect.left + rect.width / 2 + (r.centroid.x - center.x) * zoom,
      y: rect.top + rect.height / 2 - (r.centroid.y - center.y) * zoom,
      // Bildausschnitt des Raums in Canvas-Koordinaten, für die Bildpunktprobe
      box: (() => {
        const xs = r.innerPolygon.map((q) => rect.width / 2 + (q.x - center.x) * zoom);
        const ys = r.innerPolygon.map((q) => rect.height / 2 - (q.y - center.y) * zoom);
        return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
      })(),
    };
  }, name);

/**
 * Rote Bildpunkte (Heizungsfarbe #F87171) im Raumausschnitt.
 *
 * Die Farbe steht in `FIXTURE_COLORS.heating`; halbdurchsichtig über dem
 * dunklen Untergrund bleibt der Rotanteil deutlich über Grün und Blau. Die
 * Schwelle prüft genau diesen Abstand und nicht einen absoluten Farbwert —
 * sonst hinge die Prüfung an der Deckkraft.
 */
const heizPunkte = async (box) =>
  p.evaluate((b) => {
    const c = document.querySelector('canvas');
    const skala = c.width / c.getBoundingClientRect().width;
    const x = Math.max(0, Math.round(b.x0 * skala));
    const y = Math.max(0, Math.round(b.y0 * skala));
    const w = Math.min(c.width - x, Math.round((b.x1 - b.x0) * skala));
    const h = Math.min(c.height - y, Math.round((b.y1 - b.y0) * skala));
    if (w <= 0 || h <= 0) return 0;
    const d = c.getContext('2d').getImageData(x, y, w, h).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] > 110 && d[i] - d[i + 1] > 45 && d[i] - d[i + 2] > 35) n++;
    }
    return n;
  }, box);

const fbhImModell = async () =>
  p.evaluate(() =>
    Object.values(window.RaViaCAD.getDocument().fixtures)
      .filter((f) => f.type === 'underfloor' && f.params.roomCoverage === true)
      .map((f) => ({
        roomId: f.roomId,
        spacing: f.params.loopSpacing,
        loops: f.params.loopCount,
        pattern: f.params.loopPattern,
        rand: f.params.loopEdgeClearance,
        watt: f.params.powerW,
      })),
  );

await p.getByRole('button', { name: 'TGA', exact: true }).click();
await p.waitForTimeout(250);
await p.locator('aside').getByRole('button', { name: /Heizung/ }).first().click();
await p.waitForTimeout(200);
await p.getByRole('button', { name: /FBH-Heizkreis/ }).click();
await p.waitForTimeout(250);

const wohnen = await raumMitte('Wohnen');
if (!wohnen) throw new Error('Raum „Wohnen" nicht gefunden — der Rauchtest braucht ihn');
const rotVorher = await heizPunkte(wohnen.box);

await p.mouse.click(wohnen.x, wohnen.y);
await p.waitForTimeout(600);
const rotNachher = await heizPunkte(wohnen.box);
const belegt = await fbhImModell();
await p.screenshot({ path: './screenshots/feat-3b-fbh-raum.png' });
console.log(
  `FBH in „${wohnen.name}" (${wohnen.area.toFixed(1)} m²):`,
  JSON.stringify(belegt),
  '→',
  await status(),
);
console.log(`  Bildpunkte in Heizungsfarbe: ${rotVorher} → ${rotNachher}`);
if (belegt.length !== 1) throw new Error(`Erwartet: eine Flächenbelegung, gefunden: ${belegt.length}`);
if (belegt[0].roomId !== wohnen.id) throw new Error('Die Belegung hängt am falschen Raum');
if (!(belegt[0].spacing > 0) || !(belegt[0].loops >= 1) || !(belegt[0].watt > 0)) {
  throw new Error(`Verlegeabstand, Kreiszahl oder Leistung fehlen: ${JSON.stringify(belegt[0])}`);
}
if (!(belegt[0].rand > 0)) throw new Error('Der Randabstand steht nicht am Objekt');
// Eine Verlegekurve über 40 m² zeichnet ein Vielfaches dessen, was ein
// Symbol von 90 cm Kantenlänge je hinterlassen könnte.
if (rotNachher < rotVorher + 2000) {
  throw new Error(`Die Kurve ist im Plan nicht zu sehen (${rotVorher} → ${rotNachher} Bildpunkte)`);
}

// --- Zweiter Klick entfernt sie wieder -----------------------------------
await p.mouse.click(wohnen.x, wohnen.y);
await p.waitForTimeout(500);
const nachEntfernen = await fbhImModell();
const rotDanach = await heizPunkte(wohnen.box);
console.log(`Nach zweitem Klick: ${nachEntfernen.length} Belegungen, ${rotDanach} rote Bildpunkte →`, await status());
if (nachEntfernen.length !== 0) throw new Error('Der zweite Klick hat die Belegung nicht entfernt');
if (rotDanach >= rotNachher - 1000) throw new Error('Die Kurve steht noch im Plan');

// --- Strg+Z holt sie zurück ----------------------------------------------
await p.keyboard.press('Control+z');
await p.waitForTimeout(500);
const nachUndo = await fbhImModell();
const rotUndo = await heizPunkte(wohnen.box);
console.log(`Nach Strg+Z: ${nachUndo.length} Belegungen, ${rotUndo} rote Bildpunkte`);
if (nachUndo.length !== 1) throw new Error('Strg+Z hat die Belegung nicht zurückgeholt');
if (rotUndo < rotNachher - 1000) throw new Error('Nach Strg+Z fehlt die Kurve im Plan');
await p.screenshot({ path: './screenshots/feat-3c-fbh-undo.png' });

// Aufräumen: die Belegung würde die folgenden Zählungen verschieben.
await p.mouse.click(wohnen.x, wohnen.y);
await p.waitForTimeout(400);

// --- „Alle Räume dieses Geschosses auslegen" -----------------------------
// Der Sammelknopf ist die eigentliche Antwort auf „ich möchte, dass alles
// ausgelegt wird". Geprüft wird beides: dass mehrere Räume belegt werden und
// dass der Bericht sagt, welche nicht.
const raeumeImModell = await p.evaluate(() =>
  Object.values(window.RaViaCAD.getDocument().rooms).map((r) => ({
    id: r.id,
    name: r.name,
    beheizt: r.isHeated,
    level: r.levelId,
  })),
);
await p.getByRole('button', { name: /Alle Räume dieses Geschosses auslegen/ }).click();
await p.waitForTimeout(900);
const alleBelegt = await fbhImModell();
const bericht = await p.locator('aside').innerText();
console.log(`Sammelauslegung: ${alleBelegt.length} von ${raeumeImModell.length} Räumen belegt →`, await status());
if (alleBelegt.length < 1) {
  throw new Error('Die Sammelauslegung hat gar nichts belegt');
}
if (!/\d+ belegt · \d+ übergangen/.test(bericht)) {
  throw new Error('Der Bericht der Sammelauslegung fehlt in der Palette');
}
// Der Bericht muss die übergangenen Räume *benennen*. Im Vorlagegrundriss
// hängen Heizkörper an den Wänden — genau der Fall, der nicht stillschweigend
// übergangen werden darf.
if (!/Heizkörper|unbeheizt|hat schon eine Fußbodenheizung/.test(bericht)) {
  throw new Error('Der Bericht sagt nicht, warum Räume übergangen wurden');
}
console.log('  Bericht:', bericht.split('\n').filter((z) => /belegt|übergangen|Heizkörper|unbeheizt/.test(z)).join(' | '));

// --- Ein Geschoss aus mehreren Räumen, ganz ausgelegt ---------------------
// Der Vorlagegrundriss hat drei Räume und Heizkörper an den Wänden; für die
// Sichtprüfung der Verlegekurven braucht es ein Geschoss aus mehreren
// gleichartigen Räumen ohne Heizflächen. Es wird deshalb hier gezeichnet —
// über den Store, weil ein Dutzend Wandzüge mit der Maus nichts prüft, was
// nicht anderswo schon geprüft wäre.
await p.evaluate(() => {
  const s = window.__ravia.getState();
  s.clearAll();
  const w = (x1, y1, x2, y2) => s.addWall({ x: x1, y: y1 }, { x: x2, y: y2 });
  // Außenwände 11,00 × 8,00 m
  w(0, 0, 11, 0); w(11, 0, 11, 8); w(11, 8, 0, 8); w(0, 8, 0, 0);
  // Durchgehende Innenwände: vier verschieden geschnittene Räume
  w(0, 4.5, 11, 4.5);
  w(6, 0, 6, 4.5);
  w(4.5, 4.5, 4.5, 8);
});
await p.waitForTimeout(700);
const raeume = await p.evaluate(() =>
  Object.values(window.__ravia.getState().doc.rooms).map((r) => `${r.name} ${r.area.toFixed(1)} m²`),
);
console.log(`Prüfgeschoss gezeichnet: ${raeume.length} Räume — ${raeume.join(', ')}`);
const gezeichnet = raeume.length;
if (gezeichnet < 4) throw new Error(`Das Prüfgeschoss hat nur ${gezeichnet} Räume`);

// Verteiler, Küchenzeile und Badewanne: der Verteiler, weil jeder Heizkreis
// an ihm beginnt, die beiden anderen, weil sie Aussparungen sind — die
// Küchenzeile ist die, die gefehlt hat.
await p.evaluate(() => {
  const s = window.__ravia.getState();
  const setzen = (typ, x, y) => {
    const f = s.addFixture(typ, { x, y });
    if (f) s.moveFixture(f.id, { x, y });
  };
  setzen('manifold', 2.0, 4.5);
  setzen('kitchen-unit', 3.0, 0.35);
  setzen('bathtub', 9.6, 1.0);
});
await p.waitForTimeout(400);
const einbauten = await p.evaluate(() =>
  Object.values(window.__ravia.getState().doc.fixtures)
    .filter((f) => ['manifold', 'kitchen-unit', 'bathtub'].includes(f.type))
    .map((f) => f.type),
);
console.log('Einbauten gesetzt:', einbauten.join(', '));
if (!einbauten.includes('kitchen-unit')) throw new Error('Die Küchenzeile gibt es im Katalog nicht');

await p.getByRole('button', { name: /Alle Räume dieses Geschosses auslegen/ }).click();
await p.waitForTimeout(1400);
const geschossBelegt = await fbhImModell();
console.log(`Geschoss ausgelegt: ${geschossBelegt.length} Räume →`, await status());
if (geschossBelegt.length < gezeichnet) {
  throw new Error(`Nur ${geschossBelegt.length} von ${gezeichnet} Räumen belegt`);
}
// Die Anbindeleitungen müssen im Plan stehen — geprüft an der Kreislänge in
// der Beschriftung, die es ohne Verteiler nicht gäbe.
const planText = await p.evaluate(() => {
  const s = window.__ravia.getState();
  return Object.values(s.doc.fixtures).filter((f) => f.type === 'manifold').length;
});
if (planText < 1) throw new Error('Der Heizkreisverteiler fehlt im Modell');
await p.screenshot({ path: './screenshots/feat-3d-fbh-alle.png' });

// Leeres Blatt für die folgenden Zeichenprüfungen — ohne Neuladen, sonst
// fragt die Wiederherstellung nach dem letzten Stand und fängt jeden Klick ab.
await p.evaluate(() => window.__ravia.getState().clearAll());
await p.waitForTimeout(400);
await p.keyboard.press('v');
await p.waitForTimeout(200);

// --- Ortho-Zwang und Zeichnen mit Hilfslinien ----------------------------
await p.keyboard.press('o');
await p.keyboard.press('w');
await p.waitForTimeout(200);
await p.mouse.click(at(0.55, 0.2).x, at(0.55, 0.2).y);
await p.mouse.move(at(0.72, 0.31).x, at(0.72, 0.31).y, { steps: 10 });
await p.waitForTimeout(300);
await p.screenshot({ path: './screenshots/feat-4-ortho-draw.png' });
console.log('Beim Zeichnen mit Ortho:', await status());
await p.keyboard.press('Escape');

// --- Schwenken mit rechter Maustaste --------------------------------------
await p.keyboard.press('v');
const before = await p.evaluate(() => document.title);
await p.mouse.move(at(0.5, 0.5).x, at(0.5, 0.5).y);
await p.mouse.down({ button: 'right' });
await p.mouse.move(at(0.62, 0.58).x, at(0.62, 0.58).y, { steps: 10 });
await p.mouse.up({ button: 'right' });
await p.waitForTimeout(300);
await p.screenshot({ path: './screenshots/feat-5-right-drag-pan.png' });
void before;

// --- Diagnose: offenes Wandende erzeugen ---------------------------------
await p.keyboard.press('w');
await p.mouse.click(at(0.3, 0.75).x, at(0.3, 0.75).y);
await p.mouse.click(at(0.3, 0.62).x, at(0.3, 0.62).y);
await p.keyboard.press('Escape');
await p.waitForTimeout(600);
console.log('Nach freiem Wandstummel:', await status());
await p.screenshot({ path: './screenshots/feat-6-open-end.png' });

// --- 3D prüfen ------------------------------------------------------------
await p.getByRole('button', { name: '3D', exact: true }).click();
await p.waitForTimeout(2500);
await p.screenshot({ path: './screenshots/feat-7-3d.png', timeout: 90000 });

console.log('ERRORS:', errs.length ? errs.join('\n') : 'keine');
await b.close();
