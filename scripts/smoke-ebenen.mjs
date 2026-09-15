/**
 * Rauchtest: Ebenen, Geschosse und Bedienstufen.
 * ---------------------------------------------------------------------------
 *
 * **Was hier geprüft wird.** Die drei Handgriffe, mit denen man in diesem
 * Programm Sachen *wegnimmt*, ohne sie zu verlieren: eine Ebene sperren, ein
 * Geschoss ausblenden, eine Bedienstufe herunterschalten. Alle drei haben
 * dieselbe Gefahr — sie sehen aus wie Löschen. Ein Ebenensatz, der das
 * Referenzbild mitnimmt; ein Handwerkermodus, der beim Zurückschalten ein
 * Rohr weniger hat; ein gesperrter Bestand, der sich über die Tastatur doch
 * noch verschieben lässt: Das sind Fehler, die niemand bemerkt, bevor die
 * Heizlast danebenliegt.
 *
 * **Gemessen wird deshalb am Modell.** Ob ein Knopf im Plan grau wird, sagt
 * nichts. Jede Zeile hier fragt `window.__ravia.getState()`, was im Dokument
 * steht — und bei den Sperren zusätzlich, ob die Oberfläche den Weg dorthin
 * überhaupt zulässt.
 *
 * **Warum nicht mit der Maus geklickt wird (außer im Grundriss).** Die Probe
 * läuft unter Software-Grafik (SwiftShader). Ein Playwright-Klick wartet auf
 * den Renderer, der hier Sekunden je Bild braucht, und läuft in die
 * Zeitsperre, ohne dass mit dem Programm etwas nicht stimmte. Geprüft wird
 * darum wie in `smoke-tga.mjs` zweierlei getrennt: ob der Knopf über
 * `elementFromPoint` **erreichbar** ist (nichts Durchsichtiges liegt darauf),
 * und ob sein Behandler über `HTMLElement.click()` **tut, was er soll**.
 * Nur im Grundriss wird wirklich geklickt — dort zeichnet keine 3D-Grafik,
 * und dort ist der Mausklick die Behauptung, die geprüft werden soll.
 */
import { chromium } from 'playwright';

const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
p.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('Failed to load resource')) errs.push(m.text());
});
await p.addInitScript(() => {
  localStorage.setItem('ravia-ui-mode', 'profi');
  localStorage.setItem('ravia-einfuehrung', '1');
});
const BASIS = process.env.RAVIA_PROBE ?? 'http://localhost:4177/';
await p.goto(BASIS, { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1500);

let f = 0;
const pruef = (l, ist, soll) => {
  const ok = JSON.stringify(ist) === JSON.stringify(soll);
  if (!ok) f += 1;
  console.log(`  ${ok ? '✓' : '✗'} ${l}: ${JSON.stringify(ist)}${ok ? '' : ` (erwartet ${JSON.stringify(soll)})`}`);
};

/**
 * Einen Knopf antippen — erreichbar **und** wirksam.
 *
 * Dieselbe Hilfe wie in `smoke-tga.mjs`, und aus demselben Grund: Geprüft
 * wird die Mitte und beide Ränder, weil ein durchsichtiger Kasten über der
 * rechten Hälfte eines Knopfes ihn unbedienbar macht, ohne dass man es ihm
 * ansieht. Erst danach löst `HTMLElement.click()` den echten Behandler aus —
 * derselbe Weg, den auch eine Tastaturbedienung nimmt.
 */
const tippe = async (muster, warte = 350) => {
  const lage = await p.evaluate((t) => {
    const knopf = [...document.querySelectorAll('button')].find((x) => new RegExp(t).test(x.textContent.trim()));
    if (!knopf) return { da: false };
    const r = knopf.getBoundingClientRect();
    const punkte = [
      [r.left + r.width / 2, r.top + r.height / 2],
      [r.left + 6, r.top + r.height / 2],
      [r.right - 6, r.top + r.height / 2],
    ];
    const verdeckt = punkte
      .map(([x, y]) => document.elementFromPoint(x, y))
      .filter((oben) => !(knopf === oben || knopf.contains(oben)));
    knopf.click();
    return {
      da: true,
      frei: verdeckt.length === 0,
      hoch: Math.round(r.height),
      daraufliegt: verdeckt[0]
        ? `${verdeckt[0].tagName} ${(verdeckt[0].textContent ?? '').trim().slice(0, 24)}`
        : null,
    };
  }, muster.source ?? muster);
  if (!lage.da) {
    f += 1;
    console.log(`  ✗ Knopf „${muster}" ist nicht da`);
    return lage;
  }
  if (!lage.frei) {
    f += 1;
    console.log(`  ✗ Knopf „${muster}" liegt unter etwas anderem und ist nicht zu treffen — darauf liegt: ${lage.daraufliegt}`);
  }
  await p.waitForTimeout(warte);
  return lage;
};

await p.evaluate(() => window.__ravia.getState().loadDemo());
await p.waitForTimeout(900);
await p.evaluate(() => window.__ravia.getState().setTool('select'));
await p.waitForTimeout(200);

/*
 * ▸ 1 — Der gesperrte Bestand lässt sich nicht anfassen.
 *
 * Gezielt wird auf eine Wand **ohne Öffnung**. Eine Wand mit Fenster liefert
 * beim Klick die Öffnung (die hat im Treffertest Vorrang), und die läge zwar
 * ebenfalls auf einer Bestandsebene — die Probe prüfte dann aber etwas
 * anderes, als sie behauptet.
 */
console.log('\n▸ Bestand sperren — sichtbar, aber unantastbar');
const wandZiel = await p.evaluate(() => {
  const s = window.__ravia.getState();
  const belegt = new Set(Object.values(s.doc.openings).map((o) => o.wallId));
  const w = Object.values(s.doc.walls).find((x) => x.levelId === s.doc.activeLevelId && !belegt.has(x.id));
  const a = s.doc.nodes[w.a];
  const c = s.doc.nodes[w.b];
  const mitte = { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 };
  const leinwand = document.querySelector('canvas').getBoundingClientRect();
  const vp = s.viewport;
  return {
    id: w.id,
    x: leinwand.left + (mitte.x - vp.center.x) * vp.zoom + leinwand.width / 2,
    y: leinwand.top + leinwand.height / 2 - (mitte.y - vp.center.y) * vp.zoom,
  };
});

// Erst der Gegenbeweis: Ungesperrt trifft derselbe Klick die Wand. Ohne ihn
// wäre „keine Auswahl" auch dann grün, wenn der Klick am Ziel vorbeiginge.
await p.mouse.click(wandZiel.x, wandZiel.y);
await p.waitForTimeout(400);
const offenGewaehlt = await p.evaluate(() => window.__ravia.getState().selection);
pruef('Ungesperrt wählt ein Klick im Plan die Wand', offenGewaehlt, { kind: 'wall', id: wandZiel.id });

const waendeVorherSperre = await p.evaluate(() => Object.keys(window.__ravia.getState().doc.walls).length);
await p.evaluate(() => window.__ravia.getState().setSelection(null));
await p.evaluate(() => window.__ravia.getState().sperreBestand(true));
await p.waitForTimeout(400);

const gesperrt = await p.evaluate(() => {
  const s = window.__ravia.getState();
  return {
    ebenen: ['layer-walls', 'layer-openings', 'layer-rooms', 'layer-durchbrueche'].map((id) => s.doc.layers[id].locked),
    status: s.statusMessage,
    waende: Object.keys(s.doc.walls).length,
    sichtbar: s.doc.layers['layer-walls'].visible,
  };
});
pruef('Die vier Bestandsebenen tragen das Schloss', gesperrt.ebenen, [true, true, true, true]);
console.log('    Meldung:', gesperrt.status);

await p.mouse.click(wandZiel.x, wandZiel.y);
await p.waitForTimeout(400);
pruef('Ein Klick im Plan fasst die gesperrte Wand nicht mehr', await p.evaluate(() => window.__ravia.getState().selection), null);

// Zweites Sieb: die Auswahl von Hand gesetzt, wie sie aus einer Liste käme.
const bewegt = await p.evaluate((id) => {
  const s = () => window.__ravia.getState();
  s().setSelection({ kind: 'wall', id });
  const w = s().doc.walls[id];
  const vor = { ...s().doc.nodes[w.a] };
  s().moveSelection({ x: 0.5, y: 0.25 });
  const nach = s().doc.nodes[w.a];
  return { vor: { x: vor.x, y: vor.y }, nach: { x: nach.x, y: nach.y }, status: s().statusMessage };
}, wandZiel.id);
pruef('moveSelection bewegt die gesperrte Wand nicht', bewegt.nach, bewegt.vor);
pruef('… und die Statuszeile sagt, warum', /Gesperrt — im Reiter/.test(bewegt.status), true);
console.log('    Meldung:', bewegt.status);

/*
 * ▸ 2 — Gesperrt heißt sichtbar.
 *
 * Der Unterschied zwischen Sperren und Löschen in einer Zeile: Das Dokument
 * führt danach genauso viele Wände wie vorher, und die Wandebene ist weiter
 * eingeblendet. Ein Sperren, das etwas verschwinden ließe, wäre die
 * gefährlichere Hälfte eines Löschens — ohne Rückgängig.
 */
console.log('\n▸ Gesperrtes bleibt sichtbar');
pruef('Die Zahl der Wände ändert sich beim Sperren nicht', gesperrt.waende, waendeVorherSperre);
pruef('Die Wandebene bleibt eingeblendet', gesperrt.sichtbar, true);

await p.evaluate(() => window.__ravia.getState().sperreBestand(false));
await p.waitForTimeout(350);
const frei = await p.evaluate(() => {
  const s = window.__ravia.getState();
  return {
    ebenen: ['layer-walls', 'layer-openings', 'layer-rooms', 'layer-durchbrueche'].map((id) => s.doc.layers[id].locked),
    status: s.statusMessage,
  };
});
pruef('Freigeben nimmt alle vier Schlösser wieder ab', frei.ebenen, [false, false, false, false]);
console.log('    Meldung:', frei.status);

await p.evaluate(() => window.__ravia.getState().setSelection(null));
await p.waitForTimeout(200);

/*
 * ▸ 3 — Ein Gewerkeblatt auf Knopfdruck.
 *
 * Gedrückt wird der echte Knopf im Reiter „Ebenen", nicht die Aktion im
 * Speicher: Die Frage ist gerade, ob die vier Blätter über die Oberfläche
 * erreichbar sind.
 *
 * Die schärfste Zeile ist die letzte. `layer-image` steht in **keinem**
 * Gewerkesatz — eine Umschaltung, die stumpf „alles aus, was nicht in der
 * Liste steht" macht, nähme das Referenzbild mit. Wer über einem
 * abfotografierten Grundriss zeichnet, verlöre beim Wechsel aufs
 * Heizungsblatt seine Vorlage und wüsste nicht, warum.
 */
console.log('\n▸ Gewerkesatz „Heizung"');
await tippe(/^Ebenen$/, 450);
const bildVorher = await p.evaluate(() => window.__ravia.getState().doc.layers['layer-image'].visible);
pruef('Das Referenzbild ist vor dem Umschalten eingeblendet', bildVorher, true);
const satzKnopf = await tippe(/^Heizung$/, 500);
pruef('Der Knopf „Heizung" hält das Tippmaß (≥ 32 px hoch)', (satzKnopf.hoch ?? 0) >= 32, true);

const satz = await p.evaluate(() => {
  const s = window.__ravia.getState();
  const v = (id) => s.doc.layers[id].visible;
  return {
    aus: [v('layer-sanitary'), v('layer-ventilation')],
    an: [v('layer-heating'), v('layer-walls'), v('layer-openings'), v('layer-rooms'), v('layer-dimensions')],
    bild: v('layer-image'),
    status: s.statusMessage,
  };
});
pruef('Sanitär und Lüftung sind ausgeblendet', satz.aus, [false, false]);
pruef('Heizung, Wände, Öffnungen, Räume und Maße sind sichtbar', satz.an, [true, true, true, true, true]);
pruef('Das Referenzbild bleibt, wie es war', satz.bild, bildVorher);
console.log('    Meldung:', satz.status);

/*
 * ▸ 4 — Ein Geschoss ausblenden, aber nicht das, in dem man steht.
 */
console.log('\n▸ Geschoss ausblenden');
const geschosse = await p.evaluate(() => {
  const s = () => window.__ravia.getState();
  const eg = s().doc.activeLevelId;
  const neu = s().addLevel();
  s().setActiveLevel(eg);
  return { eg, og: neu.id, ogName: neu.name, aktiv: s().doc.activeLevelId };
});
await p.waitForTimeout(600);
pruef('Nach dem Anlegen steht man wieder im Erdgeschoss', geschosse.aktiv, geschosse.eg);

const versteckt = await p.evaluate((g) => {
  const s = () => window.__ravia.getState();
  s().zeigeGeschoss(g.og, false);
  return { sichtbar: s().doc.levels[g.og].visible, status: s().statusMessage };
}, geschosse);
pruef(`„${geschosse.ogName}" lässt sich ausblenden`, versteckt.sichtbar, false);
console.log('    Meldung:', versteckt.status);

const aktivesGeschoss = await p.evaluate((g) => {
  const s = () => window.__ravia.getState();
  const vor = s().doc.levels[g.eg].visible ?? null;
  s().zeigeGeschoss(g.eg, false);
  return { vor, nach: s().doc.levels[g.eg].visible ?? null, status: s().statusMessage };
}, geschosse);
pruef('Das aktive Geschoss lässt sich nicht ausblenden', aktivesGeschoss.nach, aktivesGeschoss.vor);
pruef('… und es steht eine Meldung dazu', /aktive Geschoss/.test(aktivesGeschoss.status), true);
console.log('    Meldung:', aktivesGeschoss.status);

/*
 * ▸ 5 — Die Außenwände aus dem Geschoss darunter übernehmen.
 *
 * Geprüft wird nicht nur, dass Wände entstehen, sondern **welche**: genau
 * die Außenwände des Erdgeschosses, ohne Öffnungen. Ein mitkopiertes Fenster
 * wäre eine Behauptung über ein Geschoss, das niemand aufgemessen hat, und
 * eine mitkopierte Innenwand eine Grundrissbehauptung dazu.
 */
console.log('\n▸ Außenwände aus dem Erdgeschoss übernehmen');
await p.evaluate((g) => {
  const s = () => window.__ravia.getState();
  s().zeigeGeschoss(g.og, true);
  s().setActiveLevel(g.og);
}, geschosse);
await p.waitForTimeout(700);

const vorUebernahme = await p.evaluate((g) => {
  const s = window.__ravia.getState();
  const waende = Object.values(s.doc.walls);
  return {
    egAussen: waende.filter((w) => w.levelId === g.eg && w.type === 'exterior').length,
    egGesamt: waende.filter((w) => w.levelId === g.eg).length,
    ogWaende: waende.filter((w) => w.levelId === g.og).length,
  };
}, geschosse);
pruef('Das Obergeschoss ist vor der Übernahme leer', vorUebernahme.ogWaende, 0);
console.log(`    Erdgeschoss: ${vorUebernahme.egGesamt} Wände, davon ${vorUebernahme.egAussen} außen`);

const angebot = await p.evaluate(() =>
  [...document.querySelectorAll('button')].map((x) => x.textContent.trim()).filter((t) => /Außenwände/.test(t)),
);
pruef('Im leeren Obergeschoss steht das Angebot in der Geschossleiste', angebot, ['Außenwände aus EG übernehmen']);

await tippe(/^Außenwände aus .* übernehmen$/, 800);
const uebernommen = await p.evaluate((g) => {
  const s = window.__ravia.getState();
  const oben = Object.values(s.doc.walls).filter((w) => w.levelId === g.og);
  const obenIds = new Set(oben.map((w) => w.id));
  return {
    zahl: oben.length,
    typen: [...new Set(oben.map((w) => w.type))],
    oeffnungen: Object.values(s.doc.openings).filter((o) => obenIds.has(o.wallId)).length,
    status: s.statusMessage,
  };
}, geschosse);
pruef('Im Obergeschoss sind Wände entstanden', uebernommen.zahl > 0, true);
pruef('Es sind ausschließlich Außenwände', uebernommen.typen, ['exterior']);
pruef('Ihre Zahl entspricht den Außenwänden des Erdgeschosses', uebernommen.zahl, vorUebernahme.egAussen);
pruef('Öffnungen kommen nicht mit', uebernommen.oeffnungen, 0);
console.log('    Meldung:', uebernommen.status);

const zweiter = await p.evaluate((g) => {
  const s = () => window.__ravia.getState();
  const knopf = [...document.querySelectorAll('button')].map((x) => x.textContent.trim()).filter((t) => /Außenwände/.test(t));
  const vor = Object.values(s().doc.walls).filter((w) => w.levelId === g.og).length;
  const angelegt = s().uebernehmeAussenwaende(g.eg, g.og);
  return {
    knopf,
    angelegt,
    nach: Object.values(s().doc.walls).filter((w) => w.levelId === g.og).length,
    vor,
    status: s().statusMessage,
  };
}, geschosse);
pruef('Danach verschwindet das Angebot aus der Geschossleiste', zweiter.knopf, []);
pruef('Ein zweiter Durchgang legt keine Wand mehr an', zweiter.angelegt, 0);
pruef('… und die Zahl der Wände im Obergeschoss bleibt gleich', zweiter.nach, zweiter.vor);
console.log('    Meldung:', zweiter.status);

/*
 * ▸ 6 — Im begangenen Haus ein Maß ändern.
 *
 * Der Weg, den ein Aufmaß wirklich nimmt: Man steht vor der Wand, misst, und
 * trägt die Zahl ein, ohne herauszugehen und den Grundriss zu suchen.
 * Gezielt wird durch **Drehen der Kamera** — im Begehmodus gibt es keine
 * andere Bedienung, und ein Klick auf die Leinwand liefe hier ohnehin in die
 * Zeitsperre der Software-Grafik.
 */
console.log('\n▸ Ändern im Begehen-Modus');
await p.evaluate((g) => window.__ravia.getState().setActiveLevel(g.eg), geschosse);
await p.waitForTimeout(400);
await p.evaluate(() => window.__ravia.getState().setViewMode('3d'));
await p.waitForTimeout(4000);
await p.evaluate(() => window.__ravia.getState().setCameraMode('walk'));
await p.waitForTimeout(1200);
pruef('Der Begehmodus läuft', await p.evaluate(() => Boolean(window.__raviaGeher)), true);

await tippe(/^Werkzeug/, 400);
const kiste = await p.evaluate(() => [...document.querySelectorAll('button')].map((x) => x.textContent.trim()));
pruef('Die Werkzeugkiste hält „Ändern" bereit', kiste.includes('Ändern'), true);
const aendern = await tippe(/^Ändern$/, 400);
pruef('Der Eintrag hält das Tippmaß (≥ 44 px hoch)', (aendern.hoch ?? 0) >= 44, true);

/*
 * Drehen, bis der Auslöser „Wand fassen" scharf ist — zweimal abgelesen mit
 * Pause dazwischen. Die Zeile am Fadenkreuz wird in ruhigem Takt aus einem
 * Strahl gerechnet, die Kamera bekommt ihre neue Blickrichtung aber erst im
 * nächsten Bild; unter Software-Grafik kann ein Bild länger dauern als der
 * Takt. Eine einzelne Ablesung sähe dann das Ziel des *vorigen* Schritts.
 */
const scharfIst = async (muster) =>
  p.evaluate((m) => {
    const x = [...document.querySelectorAll('button')].find((y) => new RegExp(m).test(y.textContent));
    return Boolean(x) && !x.className.includes('cursor-not-allowed');
  }, muster.source ?? muster);

let trifftWand = false;
for (let i = 0; i < 24; i += 1) {
  if (await scharfIst(/Wand fassen/)) {
    await p.waitForTimeout(420);
    if (await scharfIst(/Wand fassen/)) {
      trifftWand = true;
      break;
    }
  }
  await p.evaluate(() => {
    window.__raviaGeher.gier += Math.PI / 12;
  });
  await p.waitForTimeout(260);
}
pruef('Beim Drehen findet das Fadenkreuz eine Wand', trifftWand, true);

await tippe(/Wand fassen/, 600);
const gefasst = await p.evaluate(() => {
  const s = window.__ravia.getState();
  const marke = [...document.querySelectorAll('span')].find((x) => x.textContent.trim() === 'Maß ändern:');
  return {
    auswahl: s.selection,
    leiste: Boolean(marke),
    griffe: marke ? [...marke.parentElement.querySelectorAll('button')].map((x) => x.textContent.trim()) : [],
    status: s.statusMessage,
  };
});
pruef('Der Auslöser fasst eine Wand', gefasst.auswahl?.kind ?? null, 'wall');
pruef('Die Maßleiste „Maß ändern" steht da', gefasst.leiste, true);
console.log('    Griffe:', JSON.stringify(gefasst.griffe));
console.log('    Meldung:', gefasst.status);

const eingetippt = await p.evaluate(async () => {
  const s = () => window.__ravia.getState();
  const id = s().selection.id;
  const griff = [...document.querySelectorAll('button')].find((x) => /^Wandhöhe/.test(x.textContent.trim()));
  if (!griff) return { fehler: 'kein Griff „Wandhöhe" in der Maßleiste' };
  griff.click();
  await new Promise((r) => setTimeout(r, 400));
  const feld = document.querySelector('input.field');
  if (!feld) return { fehler: 'kein Eingabefeld' };
  // Über den Setzer des Prototyps, damit React die Änderung mitbekommt.
  const setzer = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setzer.call(feld, '2,535');
  feld.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 250));
  [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Übernehmen').click();
  await new Promise((r) => setTimeout(r, 500));
  return { hoehe: s().doc.walls[id].height, status: s().statusMessage };
});
pruef('Die mit deutschem Komma eingetippte Höhe steht am Bauteil', eingetippt.hoehe, 2.535);
console.log('    Meldung:', eingetippt.status);

// Zurück in den Grundriss — der Rest der Probe braucht keine 3D-Grafik.
await p.evaluate(() => {
  const s = window.__ravia.getState();
  s.setCameraMode('orbit');
  s.setViewMode('2d');
});
await p.waitForTimeout(800);

/*
 * ▸ 7 — Der Handwerkermodus blendet aus und löscht nicht.
 *
 * Vorher wird ein Rohrzug angelegt. Ohne ihn wäre „gleich viele Leitungen"
 * ein Vergleich von null mit null — und damit grün, auch wenn der
 * Moduswechsel das Rohrnetz abräumte.
 */
console.log('\n▸ Handwerker-Modus');
await p.evaluate(() => {
  window.__ravia.getState().addPipe('heating-flow', [
    { x: 0.5, y: 0.5 },
    { x: 3.5, y: 0.5 },
  ]);
});
await p.waitForTimeout(400);

const lesen = () => ({
  reiter: (() => {
    const start = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Start');
    return start ? [...start.parentElement.children].map((c) => c.textContent.trim()) : [];
  })(),
  rohrwerkzeug: [...document.querySelectorAll('button[title]')].some((x) => /^Leitung verlegen/.test(x.title)),
  zahl: (() => {
    const d = window.__ravia.getState().doc;
    return {
      waende: Object.keys(d.walls).length,
      raeume: Object.keys(d.rooms).length,
      leitungen: Object.keys(d.pipes).length,
    };
  })(),
});

const vorher = await p.evaluate(lesen);
pruef('Es liegen Leitungen im Modell, an denen sich das Ausblenden zeigen lässt', vorher.zahl.leitungen > 0, true);

await p.evaluate(() => window.__ravia.getState().setUiMode('handwerker'));
await p.waitForTimeout(600);
const handwerker = await p.evaluate(lesen);
pruef('Der Reiter „Anlage" ist nicht mehr in der Kopfzeile', handwerker.reiter.includes('Anlage'), false);
pruef('Der Reiter „Prüfung" steht weiter da', handwerker.reiter.includes('Prüfung'), true);
pruef('In der Werkzeugleiste fehlt das Rohrwerkzeug', handwerker.rohrwerkzeug, false);
pruef('Ausgeblendet heißt nicht gelöscht — Wände, Räume, Leitungen unverändert', handwerker.zahl, vorher.zahl);
console.log('    Reiter:', JSON.stringify(handwerker.reiter));

await p.evaluate(() => window.__ravia.getState().setUiMode('profi'));
await p.waitForTimeout(600);
const zurueck = await p.evaluate(lesen);
pruef('Zurück auf „Fachplaner" bringt den Reiter „Anlage" wieder', zurueck.reiter.includes('Anlage'), true);
pruef('… und das Rohrwerkzeug ebenfalls', zurueck.rohrwerkzeug, true);
pruef('… und das Dokument hat sich dabei nicht geändert', zurueck.zahl, vorher.zahl);

console.log('\nFEHLER auf der Seite:', errs.length ? errs.join(' | ') : 'keine');
if (errs.length) f += errs.length;
console.log(`\n${f === 0 ? '✓ RAUCHTEST BESTANDEN' : `✗ ${f} FEHLER`}\n`);
await b.close();
process.exit(f === 0 ? 0 : 1);
