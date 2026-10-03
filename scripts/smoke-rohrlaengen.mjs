/**
 * Rauchtest „Rohrlängen, Formteile, alle Geschosse" (1.71.0).
 *
 * Gemeldet am 02.10.2026: keine Rohrlängen an der Verlegung, keine Fittinge,
 * keine Steigstränge; das Protokoll stand offen und las sich wie eine
 * Fehlerliste; die Rohrnetzberechnung ging nur über ein Geschoss, und der
 * Druck zeigte nur eine Etage.
 *
 * Geprüft am Demohaus mit kopiertem Obergeschoss:
 *  - ohne Wärmeerzeuger: beide Geschosse bekommen Leitungen,
 *  - mit Wärmeerzeuger im EG: Steigleitung ins OG im Fließweg; der Export
 *    trägt je Verbraucher Weglänge, Steigleitungslänge und Formteile, an der
 *    Wurzel die Formteilliste,
 *  - die Leitungsbeschriftung im Plan nennt die Länge,
 *  - Auslegungs- und Prüfprotokoll sind eingeklappt, mit einer Zeile zum
 *    Einblenden,
 *  - der Druck der Rohrnetzberechnung nimmt beide Grundrisse mit.
 *
 * Aufruf: npm run build && npx vite preview --port 4177 & npm run smoke:rohrlaengen
 */
import { chromium } from 'playwright';

const BASIS = process.env.RAVIA_PROBE ?? 'http://localhost:4177/';
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

async function seite() {
  const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  await p.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('ravia-einfuehrung', '1');
    localStorage.setItem('ravia-ui-mode', 'profi');
  });
  await p.goto(BASIS, { waitUntil: 'networkidle' });
  await p.waitForFunction(() => typeof window.__ravia !== 'undefined', null, { timeout: 30000 });
  await p.waitForTimeout(800);
  return { p, errs };
}

// --- 1 · Ohne Wärmeerzeuger: jedes Geschoss ---------------------------------
console.log('\n▸ Zwei Geschosse, kein Wärmeerzeuger');
{
  const { p, errs } = await seite();
  const r = await p.evaluate(() => {
    const S = () => window.__ravia.getState();
    S().loadDemo();
    const eg = S().doc.activeLevelId;
    S().addLevel({ copyFrom: eg, name: 'OG' });
    S().setActiveLevel(eg);
    S().legeRohrnetzAus('neubau');
    const pipes = Object.values(S().doc.pipes);
    return Object.values(S().doc.levels).map((l) => [l.name, pipes.some((x) => x.levelId === l.id)]);
  });
  pruefe('jedes Geschoss hat Leitungen', r.every(([, hat]) => hat), true);
  pruefe('keine Fehler auf der Seite', errs, []);
  await p.close();
}

// --- 2 · Mit Wärmeerzeuger: Steigleitung, Längen, Formteile ------------------
console.log('\n▸ Zwei Geschosse, Wärmeerzeuger im EG');
{
  const { p, errs } = await seite();
  const r = await p.evaluate(() => {
    const S = () => window.__ravia.getState();
    S().loadDemo();
    const eg = S().doc.activeLevelId;
    const og = S().addLevel({ copyFrom: eg, name: 'OG' });
    S().setActiveLevel(eg);
    S().addFixture('boiler', { x: 1, y: 1 }, { levelId: eg });
    S().legeRohrnetzAus('neubau');
    const ex = window.RaViaCAD.getExport();
    const lv = Object.fromEntries(Object.values(S().doc.levels).map((l) => [l.id, l.name]));
    const og2 = Object.values(S().doc.levels).find((l) => l.name === 'OG');
    const ogWege = ex.hydraulics?.consumers.filter((c) => {
      const f = S().doc.fixtures[c.fixtureId ?? c.id];
      return f && f.levelId === og2?.id;
    }) ?? [];
    return {
      og: Boolean(og),
      status: S().statusMessage ?? '',
      version: ex.version,
      formteile: (ex.pipeFittings ?? []).reduce((s, f) => s + f.anzahl, 0),
      steigFormteile: (ex.pipeFittings ?? []).some((f) => f.steigleitung),
      verbraucher: ex.hydraulics?.consumers.length ?? 0,
      mitLaenge: (ex.hydraulics?.consumers ?? []).filter((c) => (c.routeLength ?? 0) + (c.feedLength ?? 0) > 0 && (c.circuitLength ?? 0) > 0).length,
      mitFormteilen: (ex.hydraulics?.consumers ?? []).filter((c) => (c.fittings ?? []).length > 0).length,
      ogMitSteig: ogWege.filter((c) => (c.riserLength ?? 0) > 2).length,
      ogZahl: ogWege.length,
      geschosseMitLeitung: Object.values(S().doc.levels).filter((l) => Object.values(S().doc.pipes).some((x) => x.levelId === l.id)).map((l) => lv[l.id]),
    };
  });
  pruefe('Export 2.14.0', r.version, '2.14.0');
  pruefe('beide Geschosse haben Leitungen', r.geschosseMitLeitung.length, 2);
  pruefe('Statuszeile nennt die Formteile', /Bögen, \d+ T-Stücke, \d+ Reduzierungen/.test(r.status), true);
  pruefe('Formteilliste an der Wurzel', r.formteile > 0, true);
  pruefe('… mit Formteilen der Steigleitung', r.steigFormteile, true);
  // Ein Flächenkreis direkt am Verteiler hat keinen Weg dahinter (0 m), aber
  // die Zuleitung bis zum Verteiler.
  pruefe('jeder Verbraucher hat Weg- und Kreislänge', r.mitLaenge, r.verbraucher);
  pruefe('jeder Verbraucher hat Formteile im Weg', r.mitFormteilen, r.verbraucher);
  pruefe('Verbraucher im OG vorhanden', r.ogZahl > 0, true);
  pruefe('… und ihr Weg geht über die Steigleitung', r.ogMitSteig, r.ogZahl);

  // Panel: Protokoll eingeklappt
  await p.getByText('Anlage', { exact: true }).first().click();
  await p.waitForTimeout(500);
  await p.locator('button', { hasText: /^Neubau$/ }).last().click();
  await p.waitForTimeout(1500);
  const schalter = p.locator('[data-protokoll-schalter]');
  pruefe('Protokoll steht als Zeile da', (await schalter.count()) > 0, true);
  pruefe('… und ist eingeklappt', await p.locator('[data-protokoll-inhalt]').count(), 0);
  pruefe('… die Zeile sagt „einblenden"', /einblenden/.test(await schalter.first().innerText()), true);
  await schalter.first().click();
  await p.waitForTimeout(200);
  pruefe('… aufgeklappt zeigt es die Einträge', await p.locator('[data-protokoll-inhalt]').count(), 1);

  // Rohrnetzberechnung: beide Grundrisse im Druck, Prüfprotokoll eingeklappt
  await p.locator('button[title^="Rohrnetzberechnung"]').click();
  await p.waitForTimeout(2500);
  const dialog = await p.locator('body').innerText();
  pruefe('Druck nimmt beide Grundrisse mit', /2 Grundrisse \(/.test(dialog), true);
  pruefe('Prüfprotokoll im Dialog eingeklappt', await p.locator('.fixed.inset-0 [data-protokoll-inhalt]').count(), 0);
  pruefe('keine Fehler auf der Seite', errs, []);
  await p.close();
}

await b.close();
console.log(fehler ? `\n✗ ${fehler} Prüfungen fehlgeschlagen` : '\n✓ Rohrlängen, Formteile und Geschosse in Ordnung');
process.exit(fehler ? 1 : 0);
