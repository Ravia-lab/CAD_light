/**
 * Rauchtest „Tablet" — Stift, Finger und Handballen auf dem iPad.
 *
 * **Warum dieser Test anders aussieht als die anderen.** Die übrigen
 * Rauchtests klicken. Ein Klick ist auf jedem Gerät ein Klick — er beweist
 * nichts über einen Stift. Was auf dem Tablet schiefgeht, geht in den
 * Zeigerereignissen schief: der Handballen, der als zweiter Finger
 * aufsetzt; die zwei Finger, die schwenken sollen und stattdessen zeichnen;
 * der Stift, der mitten in einer Zweifingergeste aufsetzt. Deshalb werden
 * hier **echte PointerEvents mit `pointerType`** geschickt und keine
 * Playwright-Klicks.
 *
 * Geprüft wird in beiden Lagen des Geräts, weil sich die Oberfläche bei
 * ≤ 1024 px umbaut: quer (1180×820) liegt darüber, hoch (820×1180)
 * darunter. Ein Test in nur einer Lage prüft den halben Umbau.
 *
 * Aufruf:
 *     RAVIA_BASE=/Cad_light/ npm run build && \
 *     RAVIA_BASE=/Cad_light/ npx vite preview --port 4177 &
 *     node scripts/smoke-tablet.mjs
 */

import { chromium } from 'playwright';

const BASIS = process.env.RAVIA_PROBE ?? 'http://localhost:4177/Cad_light/';

const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});

let failures = 0;
const expect = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? '✓' : '✗'} ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (erwartet ${JSON.stringify(expected)})`}`);
};

/**
 * Die Zeigerbahn im Browser abspielen.
 *
 * Läuft absichtlich **in der Seite** und nicht über Playwrights Maus: nur so
 * lassen sich `pointerType`, `pointerId` und `pressure` frei setzen — und
 * genau die entscheiden über Stift, Finger und Handballen.
 */
async function bahn(p, schritte) {
  await p.evaluate(async (folge) => {
    const cv = document.querySelector('main canvas');
    const r = cv.getBoundingClientRect();
    for (const s of folge) {
      const ev = new PointerEvent(s.t, {
        pointerId: s.id, pointerType: s.art, isPrimary: s.id === 1,
        bubbles: true, cancelable: true,
        clientX: r.left + r.width / 2 + s.x, clientY: r.top + r.height / 2 + s.y,
        buttons: s.t === 'pointerup' ? 0 : 1, pressure: s.t === 'pointerup' ? 0 : (s.d ?? 0.6),
      });
      cv.dispatchEvent(ev);
      await new Promise((res) => setTimeout(res, s.warte ?? 2));
    }
  }, schritte);
}

/** Einen geraden Zug in n Schritten — mit einem bekannten Zittern quer dazu. */
function zug(art, id, von, bis, n = 30, zittern = 0) {
  const raus = [{ t: 'pointerdown', art, id, x: von[0], y: von[1] }];
  for (let k = 1; k <= n; k++) {
    const t = k / n;
    const q = Math.sin(t * Math.PI * 6) * zittern;
    raus.push({ t: 'pointermove', art, id, x: von[0] + (bis[0] - von[0]) * t + q, y: von[1] + (bis[1] - von[1]) * t + q });
  }
  raus.push({ t: 'pointerup', art, id, x: bis[0], y: bis[1] });
  return raus;
}

const lese = (p) => p.evaluate(() => {
  const s = window.__ravia.getState();
  return {
    tool: s.tool,
    waende: Object.keys(s.doc.walls).length,
    raeume: Object.keys(s.doc.rooms).length,
    notizen: Object.values(s.doc.freihand ?? {}).filter((f) => f.levelId === s.doc.activeLevelId).length,
    skizze: s.skizze ? { n: s.skizze.strecken.length, ring: s.skizze.ring } : null,
    zuege: s.skizze ? s.skizze.zuege.length : 0,
    gelaende: Object.keys(s.doc.site?.elements ?? {}).length,
    texte: Object.values(s.doc.annotations ?? {}).filter((a) => a.kind === 'text').map((a) => a.text),
    zoom: Math.round(s.viewport.zoom * 100) / 100,
    mitte: { x: Math.round(s.viewport.center.x * 100) / 100, y: Math.round(s.viewport.center.y * 100) / 100 },
    status: s.statusMessage,
  };
});

for (const [lage, w, h] of [['quer', 1180, 820], ['hoch', 820, 1180]]) {
  console.log(`\n▸ iPad ${lage} (${w}×${h})`);
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_CONNECTION_RESET/.test(m.text())) errs.push(m.text()); });
  await p.addInitScript(() => {
    localStorage.setItem('ravia-ui-mode', 'profi');
    localStorage.setItem('ravia-einfuehrung', '1');
    /*
     * `setPointerCapture` wirft bei nachgestellten Ereignissen.
     *
     * Chromium führt Buch über die *echten* Zeiger des Geräts. Ein per
     * `dispatchEvent` erzeugtes PointerEvent taucht in diesem Buch nicht
     * auf, also kennt der Browser die Kennung nicht und wirft. Auf dem
     * echten iPad gibt es den Zeiger, und der Aufruf gelingt.
     *
     * Ohne diese Hülle bricht der Ereignisbehandler mitten drin ab und der
     * Test prüft nicht mehr die Regel, sondern die Buchhaltung des
     * Browsers. Deshalb wird hier **nur** die Ausnahme geschluckt — an der
     * Anwendung ändert sich nichts.
     */
    for (const name of ['setPointerCapture', 'releasePointerCapture']) {
      const echt = Element.prototype[name];
      Element.prototype[name] = function (id) {
        try { return echt.call(this, id); } catch { /* nachgestellter Zeiger */ }
      };
    }
  });
  await p.goto(BASIS, { waitUntil: 'networkidle' });
  await p.waitForFunction(() => typeof window.__ravia !== 'undefined', null, { timeout: 30000 });
  await p.evaluate(() => window.__ravia.getState().neuesDokument?.(`Tablet ${Date.now()}`));
  await p.waitForTimeout(400);

  // --- Nichts läuft über den Rand -----------------------------------------
  {
    const ueber = await p.evaluate(() => ({
      quer: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      hoch: document.body.scrollHeight - window.innerHeight,
    }));
    expect('Kein waagerechter Überlauf', ueber.quer <= 1, true);
    expect('Kein senkrechter Überlauf der Seite', ueber.hoch <= 1, true);
    // Tippziele: 44 px ist das Maß, unter dem der Finger danebengreift.
    const klein = await p.evaluate(() => {
      const raus = [];
      for (const el of document.querySelectorAll('button.tool-btn')) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && (r.width < 43.5 || r.height < 43.5)) raus.push(`${el.title || el.textContent}: ${Math.round(r.width)}×${Math.round(r.height)}`);
      }
      return raus;
    });
    expect('Alle Werkzeugknöpfe mindestens 44 px', klein, []);
  }

  // --- Der Stift zeichnet, der Handballen nicht ----------------------------
  console.log('  · Skizze mit dem Stift');
  await p.keyboard.press('q');
  expect('Skizzenwerkzeug aktiv', (await lese(p)).tool, 'sketch');
  {
    // Ein Rechteck im Uhrzeigersinn, krakelig. Zwischendrin setzt der
    // Handballen auf (Finger, zweite Kennung) — er darf den Strich nicht
    // stören und keine eigene Spur ziehen.
    const ecken = [[-180, -120], [180, -120], [180, 120], [-180, 120], [-180, -120]];
    const folge = [{ t: 'pointerdown', art: 'pen', id: 1, x: ecken[0][0], y: ecken[0][1] }];
    for (let i = 1; i < ecken.length; i++) {
      const [ax, ay] = ecken[i - 1];
      const [bx, by] = ecken[i];
      for (let k = 1; k <= 25; k++) {
        const t = k / 25;
        const q = Math.sin(t * Math.PI * 5) * 2.5;
        folge.push({ t: 'pointermove', art: 'pen', id: 1, x: ax + (bx - ax) * t + q, y: ay + (by - ay) * t + q });
        // Nach dem ersten Viertel legt sich die Hand ab.
        if (i === 2 && k === 5) folge.push({ t: 'pointerdown', art: 'touch', id: 9, x: 60, y: 200 });
      }
    }
    folge.push({ t: 'pointerup', art: 'touch', id: 9, x: 60, y: 200 });
    folge.push({ t: 'pointerup', art: 'pen', id: 1, x: ecken[4][0], y: ecken[4][1] });
    await bahn(p, folge);
    await p.waitForTimeout(500);
    const s = await lese(p);
    expect('Vier Wände erkannt', s.skizze?.n, 4);
    expect('Der Umriss ist geschlossen', s.skizze?.ring, true);
    expect('Noch keine Wand im Modell', s.waende, 0);
  }

  console.log('  · Übernehmen');
  {
    const leiste = p.locator('main').getByText('Umriss zu').locator('xpath=ancestor::div[contains(@class,"panel")]').first();
    await leiste.getByRole('button', { name: 'Übernehmen' }).click();
    await p.waitForTimeout(600);
    const s = await lese(p);
    expect('Vier Wände angelegt', s.waende, 4);
    expect('Ein Raum entstanden', s.raeume, 1);
    expect('Der Vorschlag ist weg', s.skizze, null);
    // Ein Schritt in der Historie, nicht vier.
    await p.keyboard.press('Control+z');
    await p.waitForTimeout(400);
    expect('Ein Rückgängig nimmt alles zurück', (await lese(p)).waende, 0);
    await p.keyboard.press('Control+y');
    await p.waitForTimeout(400);
    expect('Wiederherstellen bringt alles zurück', (await lese(p)).waende, 4);
  }

  // --- Notiz und Radierer ---------------------------------------------------
  console.log('  · Notiz schreiben und radieren');
  await p.keyboard.press('k');
  expect('Notizwerkzeug aktiv', (await lese(p)).tool, 'ink');
  {
    await bahn(p, zug('pen', 1, [-120, -40], [120, -40], 20, 1.5));
    await p.waitForTimeout(300);
    await bahn(p, zug('pen', 1, [-120, 60], [120, 60], 20, 1.5));
    await p.waitForTimeout(300);
    const s = await lese(p);
    expect('Zwei Notizen liegen im Plan', s.notizen, 2);
    expect('Sie ändern nichts am Modell', s.waende, 4);

    // Umschalten auf Radieren und einmal quer durch die obere Notiz.
    const leiste = p.locator('main').getByText('Handnotiz').locator('xpath=ancestor::div[contains(@class,"panel")]').first();
    await leiste.getByRole('button', { name: 'Radieren' }).click();
    await p.waitForTimeout(200);
    await bahn(p, zug('pen', 1, [0, -70], [0, -10], 8));
    await p.waitForTimeout(400);
    const nach = await lese(p);
    expect('Die getroffene Notiz ist weg', nach.notizen, 1);
    await p.keyboard.press('Control+z');
    await p.waitForTimeout(400);
    expect('Radieren ist ein Schritt in der Historie', (await lese(p)).notizen, 2);
    // Zurück auf Schreiben, damit die Lage für den nächsten Durchlauf klar ist.
    await leiste.getByRole('button', { name: 'Schreiben' }).click();
  }

  // --- Ein Finger schwenkt, zwei zoomen ------------------------------------
  console.log('  · Finger: schwenken und zoomen');
  {
    const vor = await lese(p);
    await bahn(p, zug('touch', 3, [-100, 0], [100, 0], 20));
    await p.waitForTimeout(300);
    const nachSchwenk = await lese(p);
    expect('Ein Finger schwenkt statt zu zeichnen', nachSchwenk.notizen, vor.notizen);
    expect('… und die Mitte wandert', nachSchwenk.mitte.x !== vor.mitte.x, true);

    // Zwei Finger auseinander: das muss vergrößern, nicht zeichnen.
    const auf = [
      { t: 'pointerdown', art: 'touch', id: 4, x: -60, y: 0 },
      { t: 'pointerdown', art: 'touch', id: 5, x: 60, y: 0 },
    ];
    for (let k = 1; k <= 12; k++) {
      auf.push({ t: 'pointermove', art: 'touch', id: 4, x: -60 - k * 8, y: 0 });
      auf.push({ t: 'pointermove', art: 'touch', id: 5, x: 60 + k * 8, y: 0 });
    }
    auf.push({ t: 'pointerup', art: 'touch', id: 4, x: -156, y: 0 });
    auf.push({ t: 'pointerup', art: 'touch', id: 5, x: 156, y: 0 });
    await bahn(p, auf);
    await p.waitForTimeout(300);
    const nachZoom = await lese(p);
    expect('Zwei Finger auseinander vergrößern', nachZoom.zoom > nachSchwenk.zoom, true);
    expect('… ohne eine Notiz zu hinterlassen', nachZoom.notizen, nachSchwenk.notizen);
    expect('… und ohne eine Wand anzulegen', nachZoom.waende, 4);
  }

  // --- Durchzeichnen: der Handballen hebt mitten im Strich ab --------------
  console.log('  · Durchzeichnen mit abhebendem Handballen');
  await p.keyboard.press('q');
  {
    // Ein Strich, währenddessen der Handballen aufsetzt UND wieder abhebt.
    // Genau daran ist der Zug bisher zerbrochen: das `pointerup` des Ballens
    // hat den Stiftstrich ausgewertet und beendet.
    const folge = [{ t: 'pointerdown', art: 'pen', id: 1, x: -200, y: -160 }];
    for (let k = 1; k <= 30; k++) {
      folge.push({ t: 'pointermove', art: 'pen', id: 1, x: -200 + k * 10, y: -160 });
      if (k === 8) folge.push({ t: 'pointerdown', art: 'touch', id: 21, x: -240, y: 90 });
      if (k === 14) folge.push({ t: 'pointerup', art: 'touch', id: 21, x: -240, y: 90 });
    }
    folge.push({ t: 'pointerup', art: 'pen', id: 1, x: 100, y: -160 });
    await bahn(p, folge);
    await p.waitForTimeout(400);
    const s = await lese(p);
    expect('Der Strich überlebt den Handballen', s.skizze?.n, 1);
    // Und ein zweiter Zug kommt dazu, statt den ersten zu ersetzen.
    await bahn(p, zug('pen', 1, [100, -160], [100, 60], 25, 1.5));
    await p.waitForTimeout(400);
    const zwei = await lese(p);
    expect('Der zweite Zug kommt dazu', zwei.skizze?.n, 2);
    expect('… und wird als zweiter Zug gezählt', zwei.zuege, 2);
    // Ein misslungener Kurzstrich darf die beiden nicht mitnehmen.
    await bahn(p, zug('pen', 1, [-260, 120], [-255, 121], 3));
    await p.waitForTimeout(400);
    expect('Ein misslungener Strich löscht nichts', (await lese(p)).skizze?.n, 2);
    await p.locator('main').getByRole('button', { name: 'Verwerfen' }).first().click();
    await p.waitForTimeout(300);
  }

  // --- Grundstück in mehreren Tipps ---------------------------------------
  console.log('  · Grundstück umfahren, Zeiger verlässt zwischendurch das Bild');
  {
    await p.keyboard.press('a');
    expect('Geländewerkzeug aktiv', (await lese(p)).tool, 'site');
    // Vier Ecken, jede als eigener Tipp. Nach jedem Tipp verlässt der Zeiger
    // das Bild — bei Stift und Finger meldet der Browser genau das, und daran
    // verschwand die angefangene Umfahrung.
    for (const [x, y] of [[-220, -150], [220, -150], [220, 150], [-220, 150]]) {
      await bahn(p, [
        { t: 'pointerdown', art: 'pen', id: 1, x, y },
        { t: 'pointerup', art: 'pen', id: 1, x, y },
      ]);
      await p.evaluate(() => {
        const cv = document.querySelector('main canvas');
        cv.dispatchEvent(new PointerEvent('pointerleave', { pointerId: 1, pointerType: 'pen', bubbles: true }));
      });
      await p.waitForTimeout(120);
    }
    await p.keyboard.press('Enter');
    await p.waitForTimeout(400);
    const s = await lese(p);
    expect('Die Grundstücksgrenze steht', s.gelaende, 1);
    // Eine zweite Grenze ersetzt die erste — das muss dastehen.
    for (const [x, y] of [[-180, -120], [180, -120], [180, 120], [-180, 120]]) {
      await bahn(p, [
        { t: 'pointerdown', art: 'pen', id: 1, x, y },
        { t: 'pointerup', art: 'pen', id: 1, x, y },
      ]);
    }
    await p.keyboard.press('Enter');
    await p.waitForTimeout(400);
    const zwei = await lese(p);
    expect('Es bleibt bei einer Grenze', zwei.gelaende, 1);
    expect('… und das Ersetzen wird gesagt', /ersetzt/i.test(zwei.status), true);
  }

  // --- Text auf den Plan schreiben ----------------------------------------
  console.log('  · Text schreiben');
  {
    await p.keyboard.press('b');
    const s0 = await lese(p);
    expect('Beschriftungswerkzeug aktiv', s0.tool, 'annotation');
    await bahn(p, [
      { t: 'pointerdown', art: 'pen', id: 1, x: -60, y: -40 },
      { t: 'pointerup', art: 'pen', id: 1, x: -60, y: -40 },
    ]);
    await p.waitForTimeout(300);
    const feld = p.locator('main input[placeholder^="z. B."]');
    expect('Das Eingabefeld steht im Plan', await feld.count(), 1);
    await feld.fill('Steigleitung');
    await feld.press('Enter');
    await p.waitForTimeout(400);
    const s = await lese(p);
    expect('Der Text steht im Modell', s.texte.includes('Steigleitung'), true);
    expect('… und kein Platzhalter daneben', s.texte.filter((t) => t === 'Text').length, 0);
    // Abbrechen darf nichts hinterlassen.
    await bahn(p, [
      { t: 'pointerdown', art: 'pen', id: 1, x: 120, y: -40 },
      { t: 'pointerup', art: 'pen', id: 1, x: 120, y: -40 },
    ]);
    await p.waitForTimeout(250);
    await p.locator('main input[placeholder^="z. B."]').press('Escape');
    await p.waitForTimeout(300);
    expect('Abgebrochen bleibt keine leere Beschriftung', (await lese(p)).texte.length, 1);
  }

  // --- Begradigen ist auffindbar ------------------------------------------
  console.log('  · Begradigen finden');
  {
    // Im schmalen Layout ist der Inspektor eine Schublade mit Griff am Rand.
    const griff = p.getByRole('button', { name: 'Inspektor öffnen' });
    if (await griff.count()) {
      await griff.click();
      await p.waitForTimeout(300);
    }
    const auf = p.getByRole('button', { name: 'Prüfung', exact: true }).first();
    if (await auf.count()) {
      await auf.click();
      await p.waitForTimeout(400);
    }
    expect('„Aufmaß nachziehen" steht da', await p.getByText('Aufmaß nachziehen').count(), 1);
    expect('… mit dem Knopf „Begradigen"', await p.getByRole('button', { name: 'Begradigen' }).count(), 1);
  }

  // --- 3D begehen ----------------------------------------------------------
  console.log('  · 3D begehen');
  {
    // Die Inspektor-Schublade steht aus dem vorigen Abschnitt offen und liegt
    // über der Zeichenfläche. Zumachen, sonst fängt sie den Tipp ab — genau
    // wie am Gerät.
    // Der Kopf der Schublade selbst, nicht der Schatten dahinter: den deckt
    // die Schublade ab, und ein Klick darauf wird abgefangen.
    const zu = p.locator('aside').getByText('schließen ✕');
    if (await zu.count()) {
      await zu.first().click();
      await p.waitForTimeout(400);
    }
    await p.evaluate(() => window.__ravia.getState().setViewMode('3d'));
    await p.waitForTimeout(1200);
    await p.getByRole('button', { name: 'Begehen' }).click();
    await p.waitForTimeout(500);
    expect('Begehmodus aktiv', await p.evaluate(() => window.__ravia.getState().cameraMode), 'walk');
    const stand = () =>
      p.evaluate(() => {
        const g = window.__raviaGeher;
        return g ? { x: +g.x.toFixed(3), y: +g.y.toFixed(3), gier: +g.gier.toFixed(3) } : null;
      });
    const vorher = await stand();
    expect('Der Betrachter steht im Modell', vorher !== null, true);

    /*
     * Das Steuerkreuz — auf dem Tablet der einzige Weg, vorwärts zu kommen.
     *
     * Gezogen wird mit einem **Finger**, nicht mit der Maus: Der Knopf hängt
     * an Zeigerereignissen mit Erfassung, und ob die auch für Berührungen
     * greifen, ist genau die Frage, die hier beantwortet werden soll.
     */
    const stick = p.locator('div[title="Schieben zum Gehen"]');
    expect('Das Steuerkreuz ist da', await stick.count(), 1);
    const box = await stick.boundingBox();
    expect('… und mindestens 100 px groß', (box?.width ?? 0) >= 100, true);
    if (box) {
      const mx = box.x + box.width / 2;
      const my = box.y + box.height / 2;
      await p.evaluate(
        async ([x, y]) => {
          const el = document.elementFromPoint(x, y);
          if (!el) return;
          const senden = (t, cy) =>
            el.dispatchEvent(
              new PointerEvent(t, {
                pointerId: 7,
                pointerType: 'touch',
                isPrimary: true,
                bubbles: true,
                cancelable: true,
                clientX: x,
                clientY: cy,
                buttons: t === 'pointerup' ? 0 : 1,
              }),
            );
          senden('pointerdown', y);
          for (let k = 1; k <= 8; k++) senden('pointermove', y - k * 5);
          await new Promise((r) => setTimeout(r, 2500));
          senden('pointerup', y - 40);
        },
        [mx, my],
      );
    }
    await p.waitForTimeout(300);
    const nachher = await stand();
    const weg = Math.hypot((nachher?.x ?? 0) - (vorher?.x ?? 0), (nachher?.y ?? 0) - (vorher?.y ?? 0));
    expect('Mit dem Steuerkreuz kommt man voran', weg > 0.2, true);

    // Und man bleibt im Haus: der Weg ist begrenzt, weil Wände halten.
    expect('… aber nicht beliebig weit', weg < 40, true);

    // Herausgehen über den Knopf — und der Haken verschwindet mit.
    await p.getByRole('button', { name: 'Herausgehen' }).click();
    await p.waitForTimeout(300);
    expect('Herausgehen führt zurück', await p.evaluate(() => window.__ravia.getState().cameraMode), 'orbit');
    expect('… und der Betrachter ist weg', await p.evaluate(() => window.__raviaGeher === undefined), true);
    await p.evaluate(() => window.__ravia.getState().setViewMode('2d'));
    await p.waitForTimeout(400);
  }

  await p.screenshot({ path: `./screenshots/tablet-${lage}.png`, fullPage: false });
  console.log('  ERRORS:', errs.length ? errs.join('\n') : 'keine');
  if (errs.length) failures += errs.length;
  await ctx.close();
}

console.log(`\n${failures === 0 ? '✓ RAUCHTEST TABLET BESTANDEN' : `✗ ${failures} FEHLER`}\n`);
await b.close();
process.exit(failures === 0 ? 0 : 1);
