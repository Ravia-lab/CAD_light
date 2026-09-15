/**
 * Rauchtest für den Planausdruck.
 *
 * Anlass ist der gedruckte Grundriss einer echten Wohnung: dort standen die
 * Ecken offen, quer durch die Wände liefen Linien, Türen hatten keine
 * Symbolik, Fenstermaße fehlten, und eine Fläche, die in Wirklichkeit
 * Mauerwerk ist, ließ sich nicht als solche darstellen. Geprüft wird deshalb
 * nicht das Aussehen des Dialogs, sondern der Inhalt der Vorschau — sie ist
 * dasselbe SVG, das später auf dem Papier landet.
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
const p = await b.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
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

await p.addInitScript(() => {
  localStorage.setItem('ravia-ui-mode', 'profi');
  localStorage.setItem('ravia-einfuehrung', '1');
});
await p.goto(BASIS, { waitUntil: 'networkidle' });
await p.waitForFunction(() => typeof window.__ravia !== 'undefined', null, { timeout: 30000 });
await p.evaluate(() => window.__ravia.getState().loadDemo());
await p.waitForTimeout(800);

/** Der Inhalt der Druckvorschau als Text. */
const vorschau = async () => {
  const svg = p.locator('.panel svg').filter({ has: p.locator('polygon') }).first();
  return await svg.evaluate((el) => el.outerHTML);
};

const oeffneDruck = async () => {
  await p.getByTitle(/maßstäblich drucken/).click();
  await p.waitForTimeout(700);
};
const schliesseDruck = async () => {
  await p.getByTitle('Schließen').click();
  await p.waitForTimeout(300);
};

console.log('\n▸ Türsymbolik und Öffnungsmaße');
{
  await oeffneDruck();
  expect('Dialog offen', await p.getByText('Plan drucken').isVisible(), true);
  const svg = await vorschau();

  // Der Schwenkbogen ist der einzige Kreisbogen im Plan.
  expect('Türen haben einen Schwenkbogen', /<path[^>]+d="M[^"]*A/.test(svg), true);
  // Öffnungsmaße stehen als Bruch Breite/Höhe da.
  expect('Öffnungsmaße stehen im Plan', /\d,\d+\/\d,\d+/.test(svg), true);
  expect('Brüstungshöhen stehen im Plan', /B \d,\d\d/.test(svg), true);

  // Jede Wandfläche wird zweimal ausgegeben — einmal mit Umriss, einmal nur
  // gefüllt. Nur so verschwinden die Linien in den Überlappungen.
  const mitRand = (svg.match(/stroke-width="0.36"/g) ?? []).length;
  const ohneRand = (svg.match(/fill="#334155" stroke="none"/g) ?? []).length;
  expect('Wandflächen zweimal ausgegeben', mitRand === ohneRand && mitRand > 0, true);

  await p.screenshot({ path: './screenshots/druck-1-symbolik.png' });

  // Der Schalter blendet nur die Maße aus, nicht die Symbolik.
  await p.getByText('Fenster- und Türmaße').click();
  await p.waitForTimeout(500);
  const ohne = await vorschau();
  expect('Ohne Schalter keine Öffnungsmaße', /\d,\d+\/\d,\d+/.test(ohne), false);
  expect('Der Schwenkbogen bleibt', /<path[^>]+d="M[^"]*A/.test(ohne), true);
  await p.getByText('Fenster- und Türmaße').click();
  await p.waitForTimeout(400);
  await schliesseDruck();
}

console.log('\n▸ Eine Fläche, die kein Raum ist, sondern Mauerwerk');
{
  const vorher = await p.evaluate(() => Object.keys(window.__ravia.getState().doc.solids ?? {}).length);

  // Den kleinsten Raum auswählen — genau so trifft es den Kaminzug, den die
  // Raumerkennung für einen Raum hält.
  const raum = await p.evaluate(() => {
    const s = window.__ravia.getState();
    const r = Object.values(s.doc.rooms).sort((a, b) => a.area - b.area)[0];
    s.setSelection({ kind: 'room', id: r.id });
    return { id: r.id, name: r.name, ecken: r.innerPolygon.length };
  });
  await p.waitForTimeout(400);

  await p.getByTitle(new RegExp(`${raum.name} als .*Schornstein`)).click();
  await p.waitForTimeout(500);

  const massiv = await p.evaluate(() => {
    const solids = Object.values(window.__ravia.getState().doc.solids ?? {});
    const b2 = solids[solids.length - 1];
    return { anzahl: solids.length, kind: b2?.kind, ecken: b2?.outline?.length ?? 0, durch: b2?.throughAllLevels };
  });
  expect('Ein massives Bauteil ist entstanden', massiv.anzahl, vorher + 1);
  expect('… als Schornstein', massiv.kind, 'chimney');
  expect('… mit dem Umriss des Raums', massiv.ecken, raum.ecken);
  expect('… und durch alle Geschosse', massiv.durch, true);

  // Und die Fläche hört auf, ein Raum zu sein: keine Heizlast, kein Volumen,
  // kein Raumstempel. Sie verschwindet nicht — an ihrer Stelle steht das
  // Bauteil mit seiner Schraffur.
  const danach = await p.evaluate((id) => {
    const s = window.__ravia.getState();
    return { existiert: Boolean(s.doc.rooms[id]), raeume: Object.keys(s.doc.rooms).length };
  }, raum.id);
  expect('Die massive Fläche ist kein Raum mehr', danach.existiert, false);

  await oeffneDruck();
  const svg = await vorschau();
  expect('Das Mauerwerk ist im Ausdruck schraffiert', svg.includes('url(#massiv)'), true);
  await p.screenshot({ path: './screenshots/druck-2-massiv.png' });
  await schliesseDruck();
}

// --- 3 · Ein Durchbruch auf dem Blatt ---------------------------------------
//
// Ein Durchbruch muss auf dem Ausdruck stehen, sonst wird er nicht gebohrt.
// Geprüft wird beides, was ihn ausmacht: das gekreuzte Feld in der Wand und
// die Fahne mit Maß und Höhe daneben. Ein Loch ohne Maß ist eine Markierung,
// kein Auftrag.
{
  console.log('\n▸ Durchbruch auf dem Blatt');
  const gesetzt = await p.evaluate(() => {
    const s = window.__ravia.getState();
    const wand = Object.values(s.doc.walls).find((w) => w.levelId === s.doc.activeLevelId);
    if (!wand) return null;
    const db = s.addDurchbruch(s.durchbruchPreset, { wallId: wand.id, distance: 1.1 });
    window.__ravia.getState().updateDurchbruch(db.id, { brandschutz: 'R90' });
    return { id: db.id, form: db.form, d: db.diameter };
  });
  expect('Ein Durchbruch ist gesetzt', Boolean(gesetzt?.id), true);
  await p.waitForTimeout(300);

  await oeffneDruck();
  const svg2 = await vorschau();
  // Die Fahne trägt Durchmesser, Höhe über Fertigfußboden und die
  // Brandschutzklasse — in genau dieser Reihenfolge.
  expect('Die Maßfahne steht auf dem Blatt', /Ø152[^<]*0,15 m[^<]*R 90/.test(svg2), true);
  await p.screenshot({ path: './screenshots/druck-3-durchbruch.png' });
  await schliesseDruck();
}

console.log(`\n${failures === 0 && errs.length === 0 ? '✓ RAUCHTEST BESTANDEN' : '✗ FEHLGESCHLAGEN'}`);
if (errs.length) console.log('ERRORS:', errs.join(' | '));
await b.close();
process.exit(failures === 0 && errs.length === 0 ? 0 : 1);
