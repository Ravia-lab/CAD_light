/**
 * Rauchtest für die Anlagentechnik: Auslegung, Gerätewahl, Speicher,
 * Sicherheitstechnik, Anlagenschema und Export.
 *
 * Geprüft wird nicht die Rechnung — die steht in `npm run verify` und wird
 * dort mit Handrechnungen belegt. Hier geht es um den Weg durch die
 * Oberfläche: kommt die Zahl beim Nutzer an, und landet sie im Export.
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
const p = await b.newPage({ viewport: { width: 1700, height: 1000 }, deviceScaleFactor: 2 });
const errs = [];
p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
p.on('console', (m) => {
  if (m.type() === 'error' && !/ERR_CONNECTION_RESET/.test(m.text())) errs.push(m.text());
});

let failures = 0;
const expect = (label, actual, expected, tol = 0) => {
  const ok =
    typeof actual === 'number' && typeof expected === 'number' && tol > 0
      ? Math.abs(actual - expected) <= tol
      : JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? '✓' : '✗'} ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (erwartet ${JSON.stringify(expected)})`}`);
};

// Die Einführung beim allerersten Start würde jeden Klick abfangen. Sie
// gehört zur Anwendung und wird an genau einer Stelle geprüft
// (`smoke:ux`); überall sonst wird sie als „schon gesehen" markiert.
await p.addInitScript(() => {
  localStorage.setItem('ravia-ui-mode', 'profi');
  localStorage.setItem('ravia-einfuehrung', '1');
});
await p.goto(BASIS, { waitUntil: 'networkidle' });
await p.waitForFunction(() => typeof window.__ravia !== 'undefined', null, { timeout: 30000 });
await p.waitForTimeout(1200);
await p.evaluate(() => window.__ravia.getState().loadDemo());
await p.waitForTimeout(600);

const aside = p.locator('aside');

console.log('\n▸ Anlagenblatt öffnen');
{
  await aside.getByRole('button', { name: 'Anlage', exact: true }).click();
  await p.waitForTimeout(600);
  const text = await aside.innerText();
  expect('Heizlast wird angezeigt', /Heizlast/.test(text), true);
  expect('Erforderliche Leistung wird ausgewiesen', /Das Gerät muss können/.test(text), true);
  expect('Der Überschlag ist als solcher benannt', /überschlägig/.test(text), true);
  expect('Ein Gerät steht zur Wahl', /Monoblock|Split|Sole|Wasser\//.test(text), true);
}

console.log('\n▸ Norm-Heizlast übernehmen');
{
  const field = aside.locator('input[type="number"]').first();
  await field.fill('11');
  await p.waitForTimeout(600);
  const text = await aside.innerText();
  // Die Beschriftung sagt „eingetragen" und nicht „aus RaVia": eine von Hand
  // getippte Zahl kann von überall herkommen. „Aus RaVia übernommen" steht
  // erst dort, wo die Herkunft wirklich bekannt ist — bei der raumweisen
  // Summe aus dem Schreibvorgang der Gegenstelle.
  expect('Quelle wechselt auf „eingetragen"', /eingetragen/.test(text), true);
  expect('Und behauptet keine Herkunft', /aus RaVia übernommen/.test(text), false);
  expect('Der Rückweg wird angeboten', /zurück zum Überschlag/.test(text), true);
  expect('Im Modell gespeichert', await p.evaluate(() => window.__ravia.getState().doc.plant.heatLoadOverride), 11);
}

console.log('\n▸ Gerät wählen');
{
  // Der erste Vorschlag ist der bestbewertete; ein Klick macht ihn zur Wahl.
  const before = await p.evaluate(() => window.__ravia.getState().doc.plant.generatorModelId ?? null);
  expect('Vorher ist nichts festgelegt', before, null);
  // Die Geräteknöpfe tragen Bauart und Größe im Namen — der erste ist der
  // bestbewertete Vorschlag.
  await aside.locator('button').filter({ hasText: /^(Monoblock|Split|Sole|Wasser|Innenaufstellung)/ }).first().click();
  await p.waitForTimeout(500);
  const after = await p.evaluate(() => window.__ravia.getState().doc.plant.generatorModelId ?? null);
  expect('Nachher steht ein Gerät im Projekt', typeof after === 'string' && after.length > 0, true);
}

console.log('\n▸ Sicherheitstechnik');
{
  await aside.getByRole('button', { name: /^Sicherheitstechnik/ }).click();
  await p.waitForTimeout(400);
  const text = await aside.innerText();
  expect('Gefäßgröße wird genannt', /Gefäß/.test(text), true);
  expect('Vordruck wird genannt', /Vordruck/.test(text), true);
  expect('Armaturenliste ist da', /Armaturenliste/.test(text), true);
}

console.log('\n▸ Schema erzeugen');
{
  await p.getByRole('button', { name: /Schema erzeugen/ }).click();
  await p.waitForTimeout(600);
  const state = await p.evaluate(() => {
    const s = window.__ravia.getState().doc.plant.schematic;
    const ids = new Set(Object.keys(s.components));
    return {
      components: ids.size,
      links: Object.keys(s.links).length,
      dangling: Object.values(s.links).filter((l) => !ids.has(l.from) || !ids.has(l.to)).length,
    };
  });
  expect('Bauteile entstanden', state.components > 8, true);
  expect('Verbindungen entstanden', state.links > 8, true);
  expect('Keine Verbindung hängt in der Luft', state.dangling, 0);

  // Ansicht umschalten — das Schema muss sich ohne Fehler zeichnen lassen.
  await p.getByRole('button', { name: 'Schema', exact: true }).click();
  await p.waitForTimeout(1000);
  expect('Schema-Ansicht aktiv', await p.evaluate(() => window.__ravia.getState().viewMode), 'schema');
  expect('Legende sichtbar', await p.locator('text=Heizung Vorlauf').count() > 0, true);
}

/*
 * Das gedruckte Blatt war unlesbar: die Bauteilnamen standen waagerecht am
 * Symbol, und bei M 1:200 — dem Maßstab, in dem diese Anlage auf A4 quer
 * passt — überdeckten sie einander dutzendfach. Geprüft wird deshalb an der
 * Oberfläche, was das Rechenmodul entscheidet: dass der Druckdialog die Wahl
 * anbietet, dass er von sich aus Nummern wählt, und dass er sagt, was die
 * erzwungenen Namen kosten würden.
 */
console.log('\n▸ Der Druckdialog des Schemas');
{
  await p.locator('button[title="Maßstäblich drucken oder als PDF sichern"]').click();
  await p.waitForTimeout(300);
  const dialog = p.locator('text=Anlagenschema drucken').locator('xpath=ancestor::div[contains(@class,"panel")]').first();
  expect('Der Druckdialog geht auf', await dialog.isVisible(), true);
  expect('Die Beschriftungsart ist wählbar', await dialog.getByText('Bauteile benennen').count() > 0, true);

  const zustand = await dialog.innerText();
  expect('Von sich aus stehen Positionsnummern auf dem Blatt', /Positionsnummern/.test(zustand), true);
  expect('Das Blatt hat mehr als eine Seite', /\d+ Blatt/.test(zustand), true);

  // Namen erzwingen: dann muss der Dialog den Preis nennen, statt still ein
  // unlesbares Blatt zu drucken.
  await dialog.getByRole('button', { name: 'Namen', exact: true }).click();
  await p.waitForTimeout(300);
  const beiNamen = await dialog.innerText();
  expect('Erzwungene Namen werden als Überdeckung gemeldet', /überdecken einander/.test(beiNamen), true);

  await dialog.getByRole('button', { name: 'automatisch', exact: true }).click();
  await p.waitForTimeout(300);
  expect('Zurück auf automatisch stehen wieder Nummern', /Positionsnummern/.test(await dialog.innerText()), true);

  await dialog.getByText('schließen').click();
  await p.waitForTimeout(200);
}

console.log('\n▸ Schema von Hand bearbeiten');
{
  /*
   * Bearbeitet wird in der **Ausführung**. Seit 1.50.0 öffnet die
   * Schema-Ansicht mit der Übersicht, und die ist abgeleitet: Sie nimmt
   * bewusst keine Änderung an. Ohne diesen Umschalter suchte der Lauf hier
   * ein anklickbares Bauteil, das es in dieser Ansicht nicht gibt.
   */
  await p.getByRole('button', { name: 'Ausführung', exact: true }).click();
  await p.waitForTimeout(900);

  const canvas = p.locator('main canvas').first();
  const box = await canvas.boundingBox();

  // Ein Bauteil suchen: die Ansichtstransformation liegt in der Komponente,
  // also wird die Fläche abgerastert, bis der Inspektor erscheint.
  let hit = null;
  for (let gx = 0.1; gx <= 0.9 && !hit; gx += 0.02) {
    for (let gy = 0.15; gy <= 0.9 && !hit; gy += 0.03) {
      await p.mouse.click(box.x + box.width * gx, box.y + box.height * gy);
      await p.waitForTimeout(30);
      if (await p.locator('text=Bauteil löschen').count()) hit = { gx, gy };
    }
  }
  expect('Ein Bauteil lässt sich anklicken', hit !== null, true);

  if (hit) {
    const before = await p.evaluate(() => Object.keys(window.__ravia.getState().doc.plant.schematic.components).length);

    // Verschieben: gedrückt ziehen, dann loslassen.
    const x = box.x + box.width * hit.gx;
    const y = box.y + box.height * hit.gy;
    await p.mouse.move(x, y);
    await p.mouse.down();
    await p.mouse.move(x + 90, y + 60, { steps: 10 });
    await p.mouse.up();
    await p.waitForTimeout(400);
    const manual = await p.evaluate(() => window.__ravia.getState().doc.plant.schematic.manual);
    expect('Verschieben markiert das Schema als von Hand bearbeitet', manual, true);

    // Löschen über die Schaltfläche im Inspektor.
    await p.locator('text=Bauteil löschen').first().click();
    await p.waitForTimeout(400);
    const state = await p.evaluate(() => {
      const s = window.__ravia.getState().doc.plant.schematic;
      const ids = new Set(Object.keys(s.components));
      return {
        components: ids.size,
        dangling: Object.values(s.links).filter((l) => !ids.has(l.from) || !ids.has(l.to)).length,
      };
    });
    expect('Ein Bauteil weniger', state.components, before - 1);
    expect('Und keine Verbindung hängt in der Luft', state.dangling, 0);

    // Rückgängig stellt beides wieder her.
    await p.keyboard.press('Control+z');
    await p.waitForTimeout(400);
    const restored = await p.evaluate(() => Object.keys(window.__ravia.getState().doc.plant.schematic.components).length);
    expect('Rückgängig holt das Bauteil zurück', restored, before);
  }
}

console.log('\n▸ Export');
{
  const plant = await p.evaluate(async () => {
    const mod = window.__ravia.getState();
    const doc = mod.doc;
    // Der Export läuft über dieselbe Funktion wie der Knopf in der Kopfzeile.
    const api = window.RaViaCAD;
    const data = api && api.getExport ? api.getExport() : null;
    return data
      ? {
          hasPlant: Boolean(data.plant),
          generator: data.plant?.generator?.label ?? null,
          storages: data.plant?.storages?.length ?? 0,
          circuits: data.plant?.circuits?.length ?? 0,
          schematic: data.plant?.schematic?.components?.length ?? 0,
          safety: Boolean(data.plant?.safety),
          dhw: Boolean(data.plant?.domesticHotWater),
        }
      : { hasPlant: false, note: 'keine Embed-API', docPlant: Boolean(doc.plant) };
  });
  if (plant.note) {
    console.log('  · Embed-API nicht verfügbar, Export über den Store geprüft');
    expect('Anlagenblatt im Dokument', plant.docPlant, true);
  } else {
    expect('Anlagenblock im Export', plant.hasPlant, true);
    expect('Gerät im Export', typeof plant.generator === 'string', true);
    expect('Heizkreise im Export', plant.circuits > 0, true);
    expect('Schema im Export', plant.schematic > 8, true);
    expect('Sicherheitstechnik im Export', plant.safety, true);
    expect('Trinkwasser im Export', plant.dhw, true);
  }
}

console.log('\n▸ Bivalente Anlage: Deckungsanteile');
/*
 * Das Verfahren hat die RaVia-Seite am 01.10.2026 festgelegt: Bivalenzpunkt
 * und Jahresdauerlinie, Bivalenzpunkt **eingegeben**, zunächst **parallel**.
 * Die Rechnung selbst steht mit Handwerten im Prüflauf
 * (`pruefungen/bivalenz.ts`); hier geht es um den Weg: Kommt sie durch die
 * Oberfläche, steht sie im Export, und meldet die Prüfung den zu kleinen
 * zweiten Erzeuger?
 */
{
  const biv = await p.evaluate(() => {
    const s = window.__ravia.getState();
    // Heizgrenze und Heizlast festschreiben, damit die Zahlen reproduzierbar
    // sind: 10 kW bei −10 °C Norm-Außentemperatur, Heizgrenze 15 °C.
    s.updateMeta({ designOutdoorTemperature: -10 });
    s.updatePlant({ heatLoadOverride: 10, design: { heatingLimit: 15 } });
    // Gaskessel, parallel, Bivalenzpunkt −2 °C, 15 kW — reichlich bemessen.
    s.updatePlant({
      secondGenerator: {
        art: 'gas', leistung: 15, betrieb: 'bivalent-parallel',
        bivalenzpunkt: -2, einbindung: 'ruecklauf-seriell', eigenePumpe: false,
      },
    });
    const ex = window.RaViaCAD.getExport();
    const b = ex.plant?.bivalence;
    return {
      verfahren: b?.method,
      betrieb: b?.operation,
      wp: b?.heatPumpShare,
      zweit: b?.secondGeneratorShare,
      zeit: b?.timeShareBelowBivalence,
      verlangt: b?.secondGeneratorRequired,
      fehlt: b?.secondGeneratorShortfall,
      kennlinie: b?.curve,
      annahmen: b?.assumptions?.length ?? 0,
      befunde: ex.validation.issues.filter((i) => i.code === 'plant.bivalence-shortfall').length,
    };
  });
  expect('Das Verfahren steht dabei', biv.verfahren, 'duration-curve-linear');
  expect('Die Betriebsweise auch', biv.betrieb, 'bivalent-parallel');
  /*
   * Handwert: u = (−2 + 10)/25 = 0,32 → Anteil des zweiten Erzeugers 0,32² =
   * 0,1024, Wärmepumpe 0,8976. Dieselbe Zahl wie im Prüflauf — der Weg durch
   * Oberfläche und Export darf sie nicht verändern.
   */
  expect('Anteil der Wärmepumpe', biv.wp, 0.8976, 1e-9);
  expect('Anteil des zweiten Erzeugers', biv.zweit, 0.1024, 1e-9);
  expect('Zeitanteil unter dem Bivalenzpunkt', biv.zeit, 0.32, 1e-9);
  // 10,00 − 6,80 = 3,20 kW Spitze.
  expect('Verlangte Leistung', biv.verlangt, 3.2, 1e-9);
  expect('15 kW reichen — kein Fehlbetrag', biv.fehlt, 0);
  expect('Kein Befund in der Prüfung', biv.befunde, 0);
  // Die Eingangsgrößen stehen dabei, damit die Rechnung nachvollziehbar ist.
  expect('Die Kennlinie steht im Export', biv.kennlinie?.heatingLimit, 15);
  expect('Mit Norm-Außentemperatur', biv.kennlinie?.designOutdoorTemperature, -10);
  expect('Und Norm-Heizlast', biv.kennlinie?.designHeatLoad, 10);
  // Und jede Annahme im Klartext — ohne sie ist der Anteil eine Behauptung.
  expect('Die Annahmen stehen dabei', biv.annahmen >= 5, true);

  /*
   * **Die Gegenprobe, auf die es ankommt:** derselbe Heizstab mit 2 kW ist zu
   * klein für die Spitze von 3,20 kW. Die Prüfung muss das als **Fehler**
   * melden — ein Haus, das am Auslegungspunkt nicht warm wird, ist kein
   * Hinweis, sondern ein Mangel. Und der Anteil darf sich dadurch **nicht**
   * ändern: Die Fehlmenge wird nicht auf die Wärmepumpe umgerechnet.
   */
  const klein = await p.evaluate(() => {
    const s = window.__ravia.getState();
    s.updatePlant({ secondGenerator: { art: 'elektro-heizstab', leistung: 2, betrieb: 'monoenergetisch', bivalenzpunkt: -2, einbindung: 'vorlauf-parallel', eigenePumpe: false } });
    const ex = window.RaViaCAD.getExport();
    const treffer = ex.validation.issues.filter((i) => i.code === 'plant.bivalence-shortfall');
    return {
      fehlt: ex.plant?.bivalence?.secondGeneratorShortfall,
      anteil: ex.plant?.bivalence?.secondGeneratorShare,
      grad: treffer[0]?.severity,
      text: treffer[0]?.message ?? '',
      rat: Boolean(treffer[0]?.remedy),
    };
  });
  expect('Der zu kleine Heizstab fehlt um 1,20 kW', klein.fehlt, 1.2, 1e-9);
  expect('Der Anteil bleibt unverändert', klein.anteil, 0.1024, 1e-9);
  expect('Und die Prüfung meldet einen Fehler', klein.grad, 'error');
  expect('Die Meldung nennt den Fehlbetrag', /es fehlen 1,?\.?20 kW/.test(klein.text.replace(',', '.')), true);
  expect('Mit einem Rat, was zu tun ist', klein.rat, true);

  /*
   * Und noch eine Gegenprobe: **alternativ** verlangt die ganze Norm-Heizlast
   * und nicht die Spitze — derselbe 2-kW-Heizstab fehlt dann um 8 kW. Das ist
   * der Satz, der bei dieser Fahrweise regelmäßig untergeht.
   */
  const alternativ = await p.evaluate(() => {
    const s = window.__ravia.getState();
    s.updatePlant({ secondGenerator: { art: 'elektro-heizstab', leistung: 2, betrieb: 'bivalent-alternativ', bivalenzpunkt: -2, abschaltpunkt: -2, einbindung: 'vorlauf-parallel', eigenePumpe: false } });
    const ex = window.RaViaCAD.getExport();
    return {
      verlangt: ex.plant?.bivalence?.secondGeneratorRequired,
      fehlt: ex.plant?.bivalence?.secondGeneratorShortfall,
      zweit: ex.plant?.bivalence?.secondGeneratorShare,
      ohneWp: ex.plant?.bivalence?.timeShareWithoutHeatPump,
    };
  });
  expect('Alternativ verlangt die ganze Heizlast', alternativ.verlangt, 10);
  expect('Es fehlen 8 kW', alternativ.fehlt, 8, 1e-9);
  // 2·0,32 − 0,32² = 0,5376 — mehr als die Hälfte der Arbeit in 32 % der Zeit.
  expect('Und der zweite Erzeuger trägt 53,76 %', alternativ.zweit, 0.5376, 1e-9);
  expect('Die Wärmepumpe steht dabei 32 % der Heizzeit', alternativ.ohneWp, 0.32, 1e-9);

  // Aufräumen: zurück auf monovalent, damit die folgenden Abschnitte den
  // Zustand vorfinden, den sie erwarten.
  await p.evaluate(() => window.__ravia.getState().updatePlant({ secondGenerator: undefined }));
}

console.log('\n▸ Rohrausleger');
{
  /*
   * Der Rohrausleger legt die Trasse vom Verteiler zu jedem Verbraucher.
   * Geprüft wird nicht das Bild, sondern was danach im Dokument steht: dass
   * Abschnitte und Armaturen entstanden sind, dass Vor- und Rücklauf paarweise
   * vorliegen und dass ein zweiter Lauf die erzeugten Leitungen ersetzt statt
   * sie zu verdoppeln.
   */
  const ergebnis = await p.evaluate(() => {
    const s = window.__ravia.getState();
    const r = s.legeRohrnetzAus('sanierung');
    const d = window.__ravia.getState().doc;
    const runs = Object.values(d.pipes ?? {});
    return {
      served: r.served,
      erzeugt: runs.filter((x) => x.generated).length,
      vor: runs.filter((x) => x.service === 'heating-flow' && x.generated).length,
      rueck: runs.filter((x) => x.service === 'heating-return' && x.generated).length,
      armaturen: Object.keys(d.pipeAccessories ?? {}).length,
      mitDn: runs.filter((x) => x.generated && x.nominalDiameter > 0).length,
      mitDaemmung: runs.filter((x) => x.generated && x.insulation > 0).length,
    };
  });
  expect('Verbraucher versorgt', ergebnis.served > 0, true);
  expect('Abschnitte erzeugt', ergebnis.erzeugt > 0, true);
  expect('Vorlauf und Rücklauf paarweise', ergebnis.vor === ergebnis.rueck, true);
  expect('Armaturen gesetzt', ergebnis.armaturen > 0, true);
  expect('Jeder Abschnitt hat eine Nennweite', ergebnis.mitDn === ergebnis.erzeugt, true);
  expect('Jeder Abschnitt ist gedämmt', ergebnis.mitDaemmung === ergebnis.erzeugt, true);

  // Ein zweiter Lauf ersetzt, er verdoppelt nicht.
  const zweiter = await p.evaluate(() => {
    const s = window.__ravia.getState();
    s.legeRohrnetzAus('neubau');
    const d = window.__ravia.getState().doc;
    return Object.values(d.pipes ?? {}).filter((x) => x.generated).length;
  });
  expect('Der zweite Lauf ersetzt statt zu verdoppeln', zweiter < ergebnis.erzeugt * 2, true);
  await p.screenshot({ path: './screenshots/anlage-rohrnetz.png' });
}

/*
 * ---------------------------------------------------------------------------
 * Der Erzeuger-Assistent
 * ---------------------------------------------------------------------------
 * **Der Anlass.** Im End-to-End-Lauf über die 54 Testgebäude war „kein
 * Ausgangspunkt" in *jedem einzelnen* Fall der Abbruchgrund beim ersten
 * Auslegen. Geprüft wird hier der ganze Weg, den der Anwender geht: Modell
 * ohne Erzeuger → der Vorschlag steht sichtbar da → ein Klick setzt ihn →
 * das Auslegen läuft durch.
 */
console.log('\n▸ Erzeuger-Assistent');
{
  // Alle Erzeuger, Speicher und Verteiler entfernen — der Ausgangszustand
  // eines frisch aufgenommenen Bestandsgebäudes.
  const vorher = await p.evaluate(() => {
    const s = window.__ravia.getState();
    const weg = Object.values(s.doc.fixtures)
      .filter((f) => ['boiler', 'storage', 'manifold'].includes(f.type))
      .map((f) => f.id);
    // `deleteSelection` löscht die Auswahl — also erst auswählen, dann löschen.
    for (const id of weg) {
      window.__ravia.getState().setSelection({ kind: 'fixture', id });
      window.__ravia.getState().deleteSelection();
    }
    const d = window.__ravia.getState().doc;
    return {
      entfernt: weg.length,
      nochDa: Object.values(d.fixtures).filter((f) => ['boiler', 'storage', 'manifold'].includes(f.type)).length,
      pumpen: Object.keys(d.site?.pumps ?? {}).length,
    };
  });
  expect('Erzeuger und Speicher entfernt', vorher.nochDa, 0);

  if (vorher.pumpen === 0) {
    // Der Vorschlag muss in der Oberfläche stehen, nicht nur im Zustand.
    const aside = p.locator('aside');
    await p.waitForTimeout(400);
    const text = await aside.innerText();
    expect('Der Vorschlag steht im Anlagenblatt', /Es steht noch kein Wärmeerzeuger/.test(text), true);
    expect('… und nennt einen Ort', /Vorschlag:/.test(text), true);

    await aside.getByRole('button', { name: 'Hier setzen' }).click();
    await p.waitForTimeout(500);

    const danach = await p.evaluate(() => {
      const d = window.__ravia.getState().doc;
      const kessel = Object.values(d.fixtures).find((f) => f.type === 'boiler');
      const raum = kessel ? Object.values(d.rooms).find((r) => r.levelId === kessel.levelId
        && r.innerPolygon.length >= 3
        && r.innerPolygon.some(() => true)) : undefined;
      return {
        gesetzt: !!kessel,
        aufGeschoss: kessel?.levelId ?? null,
        aktivesGeschoss: d.activeLevelId,
        hatRaum: !!raum,
        status: window.__ravia.getState().statusMessage,
      };
    });
    expect('Ein Klick setzt den Erzeuger', danach.gesetzt, true);
    expect('Das aktive Geschoss wandert mit', danach.aufGeschoss, danach.aktivesGeschoss);
    expect('Die Statuszeile sagt, wo er steht', /Wärmeerzeuger gesetzt/.test(danach.status ?? ''), true);

    // Und jetzt läuft die Auslegung durch, die vorher abbrach.
    const nachSetzen = await p.evaluate(() => {
      const r = window.__ravia.getState().legeRohrnetzAus('neubau');
      return { served: r.served, laenge: Math.round(r.pipeLength), fehler: r.notes.filter((n) => n.severity === 'error').length };
    });
    expect('Danach werden Verbraucher versorgt', nachSetzen.served > 0, true);
    expect('… und es liegt Rohr', nachSetzen.laenge > 0, true);
    expect('Kein „kein Ausgangspunkt" mehr', nachSetzen.fehler, 0);

    // Steht einer, verschwindet der Vorschlag wieder.
    await p.waitForTimeout(400);
    const jetzt = await aside.innerText();
    expect('Der Vorschlag verschwindet, sobald einer steht',
      /Es steht noch kein Wärmeerzeuger/.test(jetzt), false);
  } else {
    console.log('    (Wärmepumpe im Gelände — sie ist der Erzeuger, kein Vorschlag nötig)');
  }
}

console.log('\n▸ Gegenprobe zur Heizlast');
{
  /*
   * Der Überschlag aus der Gebäudehülle prüft sich an nichts — ein zu
   * günstiger U-Wert bleibt plausibel, weil das Ergebnis eine Rechnung ist.
   * Die Gegenprobe stellt eine gemessene Zahl daneben. Geprüft wird hier der
   * ganze Weg: eingeben, rechnen, anzeigen, melden, übergeben.
   *
   * Von Hand nachgerechnet: 2500 l Heizöl ohne Warmwasser sind nach dem
   * BWP-Praxisratgeber 2500 / 250 = 10,00 kW.
   */
  await aside.getByRole('button', { name: 'Anlage', exact: true }).click();
  await p.waitForTimeout(400);
  await p.getByText('Gegenprobe', { exact: false }).first().click();
  await p.waitForTimeout(400);
  const offen = await aside.innerText();
  expect('Die Gegenprobe klappt auf', /Warmwasser steckt im Verbrauch/.test(offen), true);
  expect('Ohne Angabe sagt sie es', /Noch keine Gegenprobe/.test(offen), true);

  const lauf = await p.evaluate(() => {
    const S = () => window.__ravia.getState();
    S().updateMeta({ verbrauch: { brennstoff: 'oel', menge: 2500, mitWarmwasser: false } });
    const ex = window.RaViaCAD.getExport();
    return {
      gegenprobe: ex.totals.heatLoadCrosscheck,
      ueberschlag: ex.totals.heatLoadCrosscheck?.ueberschlag,
      codes: window.RaViaCAD.validate().issues.map((i) => i.code),
    };
  });
  await p.waitForTimeout(500);

  expect('Die Gegenprobe steht im Export', !!lauf.gegenprobe, true);
  expect('Eine Zeile daraus', lauf.gegenprobe?.zeilen.length, 1);
  expect('2500 l Öl ohne Warmwasser sind 10,00 kW', lauf.gegenprobe?.zeilen[0]?.probe.wert, 10);
  expect('Der Rechenweg steht dabei', /÷ 250/.test(lauf.gegenprobe?.zeilen[0]?.probe.rechenweg ?? ''), true);

  const text = await aside.innerText();
  expect('Und im Blatt steht sie auch', /10,00 kW|10.00 kW/.test(text), true);
  expect('Mit der Abweichung gegenüber dem Überschlag', /% gegenüber/.test(text), true);

  /*
   * Das Demo-Haus ist klein; 10 kW liegen deutlich über seinem Überschlag.
   * Geprüft wird deshalb nicht ein bestimmtes Urteil, sondern dass die
   * Abweichung überhaupt gerechnet und — wenn sie groß ist — auch gemeldet
   * wird. Welche der beiden Zahlen näher an der Wahrheit liegt, entscheidet
   * dieses Programm nicht.
   */
  const abw = lauf.gegenprobe?.zeilen[0]?.abweichung ?? 0;
  console.log(`  · Überschlag ${lauf.ueberschlag} kW, Gegenprobe 10 kW, Abweichung ${abw} %`);
  expect('Die Abweichung ist gerechnet', typeof abw === 'number' && abw !== 0, true);
  if (Math.abs(abw) > 15) {
    expect('Und die Prüfung meldet sie', lauf.codes.includes('plant.load-crosscheck'), true);
  }

  /*
   * Die zweite Gegenprobe braucht nur das Baualter — die Fläche steht im
   * Modell. Das ist der Punkt: Der Ratgeber lässt den Anwender die
   * Wohnfläche nachschlagen, hier ist sie schon da.
   */
  const zwei = await p.evaluate(() => {
    window.__ravia.getState().updateMeta({ baualter: 'efh-f' });
    const g = window.RaViaCAD.getExport().totals.heatLoadCrosscheck;
    return { zeilen: g?.zeilen.length, weg: g?.zeilen[1]?.probe.rechenweg ?? '' };
  });
  expect('Jetzt zwei Gegenproben', zwei.zeilen, 2);
  expect('Die zweite rechnet mit der Fläche aus dem Modell', /m² × 237/.test(zwei.weg), true);

  await aside.screenshot({ path: './screenshots/anlage-gegenprobe.png' });
}

console.log('\nERRORS:', errs.length ? errs.join('\n') : 'keine');
if (errs.length) failures += errs.length;
console.log(`\n${failures === 0 ? '✓ RAUCHTEST BESTANDEN' : `✗ ${failures} FEHLER`}\n`);
await b.close();
process.exit(failures === 0 ? 0 : 1);
