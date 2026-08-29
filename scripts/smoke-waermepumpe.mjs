/**
 * Rauchtest für Außenanlage und Wärmepumpe: zeichnen, aufstellen,
 * Schallnachweis, Schutzbereich, Export.
 */

import { chromium } from 'playwright';

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

// Die Einführung beim allerersten Start würde jeden Klick abfangen. Sie
// gehört zur Anwendung und wird an genau einer Stelle geprüft
// (`smoke:ux`); überall sonst wird sie als „schon gesehen" markiert.
await p.addInitScript(() => {
  localStorage.clear();
  localStorage.setItem('ravia-einfuehrung', '1');
});
await p.goto('http://localhost:4177/', { waitUntil: 'networkidle' });
await p.waitForTimeout(1500);

// ---------------------------------------------------------------------------
// Nachweise am Bild statt am Zustand
// ---------------------------------------------------------------------------
// Der Zustand allein beweist nicht, dass der Plan neu gezeichnet wurde — genau
// das war der gemeldete Fehler: Objekt im Modell, leere Zeichenfläche. Wer nur
// den Store abfragt, prüft die Hälfte. Beide Helfer lesen deshalb den
// Bildinhalt der Zeichenfläche und werden von mehreren Abschnitten gebraucht;
// sie stehen darum hier oben und nicht in einem einzelnen Block.

/** Weltkoordinate → Punkt im Browserfenster. */
const zumSchirm = async (welt) => {
  const box = await p.locator('main canvas').first().boundingBox();
  const r = await p.evaluate(([wx, wy]) => {
    const st = window.__ravia.getState();
    const c = document.querySelector('main canvas');
    return {
      x: (wx - st.viewport.center.x) * st.viewport.zoom + c.clientWidth / 2,
      y: c.clientHeight / 2 - (wy - st.viewport.center.y) * st.viewport.zoom,
    };
  }, [welt.x, welt.y]);
  return { x: box.x + r.x, y: box.y + r.y };
};

/**
 * Wie viele Bildpunkte der gesuchten Farbe stehen rund um diese Weltkoordinate?
 *
 * Übergeben wird der *Name* einer Farbfamilie, kein Prüfausdruck: die Prüfung
 * läuft im Browser, und eine Funktion überquert diese Grenze nicht.
 *   geraet — das Blau der Wärmepumpe (#38BDF8)
 *   baum   — das Grün der Bepflanzung (#4ADE80)
 */
const farbPixel = (welt, farbe, radius = 30) =>
  p.evaluate(([wx, wy, r, name]) => {
    const trifft = {
      geraet: (R, G, B) => R < 120 && G > 140 && B > 200,
      baum: (R, G, B) => R < 140 && G > 170 && B < 170,
    }[name];
    const st = window.__ravia.getState();
    const c = document.querySelector('main canvas');
    const ctx = c.getContext('2d');
    const dpr = c.width / c.clientWidth;
    const sx = (wx - st.viewport.center.x) * st.viewport.zoom + c.clientWidth / 2;
    const sy = c.clientHeight / 2 - (wy - st.viewport.center.y) * st.viewport.zoom;
    const x0 = Math.max(0, Math.round((sx - r) * dpr));
    const y0 = Math.max(0, Math.round((sy - r) * dpr));
    const w = Math.min(c.width - x0, Math.round(2 * r * dpr));
    const h = Math.min(c.height - y0, Math.round(2 * r * dpr));
    if (w <= 0 || h <= 0) return -1;
    const d = ctx.getImageData(x0, y0, w, h).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (trifft(d[i], d[i + 1], d[i + 2])) n++;
    return n;
  }, [welt.x, welt.y, radius, farbe]);

console.log('\n▸ Werkzeuge');
{
  await p.keyboard.press('a');
  await p.waitForTimeout(300);
  expect('Taste A wählt das Außengelände', await p.evaluate(() => window.__ravia.getState().tool), 'site');
  await p.keyboard.press('p');
  await p.waitForTimeout(300);
  expect('Taste P wählt die Wärmepumpe', await p.evaluate(() => window.__ravia.getState().tool), 'heatpump');
}

console.log('\n▸ Grundstück und Gerät');
{
  // Grenze und Gerät über den Store setzen — das Zeichnen selbst prüft der
  // Klickpfad unten, hier geht es um die Rechnung.
  await p.evaluate(() => {
    const s = window.__ravia.getState();
    s.addSiteElement('boundary', [
      { x: -6, y: -6 }, { x: 16, y: -6 }, { x: 16, y: 14 }, { x: -6, y: 14 },
    ]);
    s.addHeatPump({ x: -2.6, y: 4 });
  });
  await p.waitForTimeout(600);

  const state = await p.evaluate(() => {
    const d = window.__ravia.getState().doc;
    return {
      elements: Object.keys(d.site.elements).length,
      pumps: Object.keys(d.site.pumps).length,
      area: d.site.areaCategory,
    };
  });
  expect('Grenze angelegt', state.elements, 1);
  expect('Wärmepumpe gesetzt', state.pumps, 1);
  expect('Allgemeines Wohngebiet voreingestellt', state.area, 'WA');

  await p.getByRole('button', { name: 'Wärmepumpe', exact: true }).click();
  await p.waitForTimeout(500);
  const panel = await p.locator('aside').innerText();
  expect('Schallnachweis im Panel', /SCHALLNACHWEIS NACHTS/.test(panel), true);
  expect('Rechenweg wird gezeigt', /20·lg\(Abstand\)/.test(panel), true);
  expect('Richtwert genannt', /Richtwert 40 dB\(A\)/.test(panel), true);
  await p.keyboard.press('0');
  await p.waitForTimeout(500);
  await p.screenshot({ path: './screenshots/wp-1-lageplan.png' });
  await p.locator('aside').screenshot({ path: './screenshots/wp-2-panel.png' });
}

console.log('\n▸ Schallnachweis');
{
  const near = await p.evaluate(() => {
    const s = window.__ravia.getState();
    const id = Object.keys(s.doc.site.pumps)[0];
    s.updateHeatPump(id, { position: { x: -5, y: 4 } });
    const ex = window.RaViaCAD.getExport();
    return ex.heatPump.pumps[0].acoustics;
  });
  expect('Zu nah: Richtwert überschritten', near.points[0].verdict, 'exceeded');
  expect('Nötiger Abstand ausgewiesen', near.limitDistance > 3, true);

  const codes = await p.evaluate(() => window.RaViaCAD.validate().issues.map((i) => i.code));
  expect('Prüfbericht meldet die Überschreitung', codes.includes('heatpump.noise-exceeded'), true);

  const far = await p.evaluate(() => {
    const s = window.__ravia.getState();
    const id = Object.keys(s.doc.site.pumps)[0];
    s.updateHeatPump(id, { position: { x: 4, y: 4 }, mounting: 'free' });
    return window.RaViaCAD.getExport().heatPump.pumps[0].acoustics;
  });
  expect('Mitten im Garten ist es eingehalten', far.points[0].verdict, 'ok');
  expect('Freie Aufstellung senkt das Raumwinkelmaß', far.roomAngle, 3);
}

console.log('\n▸ Schutzbereich');
{
  const issues = await p.evaluate(() => {
    const s = window.__ravia.getState();
    const pump = Object.values(s.doc.site.pumps)[0];
    s.addSiteElement('hazard-opening', [{ x: pump.position.x + 0.5, y: pump.position.y }]);
    return window.RaViaCAD.getExport().heatPump.pumps[0].protectionIssues;
  });
  expect('Öffnung im Schutzbereich gemeldet', issues.length >= 1, true);
  const codes = await p.evaluate(() => window.RaViaCAD.validate().issues.map((i) => i.code));
  expect('Als Fehler im Prüfbericht', codes.includes('heatpump.protection-zone'), true);
  await p.screenshot({ path: './screenshots/wp-3-schutzbereich.png' });
}

console.log('\n▸ Erdwärme');
{
  const demand = await p.evaluate(() => {
    const s = window.__ravia.getState();
    const id = Object.keys(s.doc.site.pumps)[0];
    s.updateHeatPump(id, { source: 'brine-borehole' });
    return window.RaViaCAD.getExport().heatPump.pumps[0].source_demand;
  });
  expect('Sondenmeter gerechnet', demand.boreholeMetres > 0, true);
  expect('Ohne Bohrung fehlt die Quelle', demand.sufficient, false);

  const covered = await p.evaluate(() => {
    const s = window.__ravia.getState();
    s.addSiteElement('borehole', [{ x: 12, y: 2 }]);
    s.addSiteElement('borehole', [{ x: 12, y: 9 }]);
    for (const e of Object.values(window.__ravia.getState().doc.site.elements)) {
      if (e.kind === 'borehole') window.__ravia.getState().updateSiteElement(e.id, { depth: 70 });
    }
    return window.RaViaCAD.getExport().heatPump.pumps[0].source_demand;
  });
  expect('Zwei Sonden decken den Bedarf', covered.sufficient, true);

  const zone = await p.evaluate(() => {
    window.__ravia.getState().updateSite({ waterProtection: 'II' });
    return window.RaViaCAD.validate().issues.map((i) => i.code);
  });
  expect('Wasserschutzzone II wird gemeldet', zone.includes('heatpump.water-protection'), true);
  await p.screenshot({ path: './screenshots/wp-4-erdwaerme.png' });
}

console.log('\n▸ Zeichnen im Plan');
{
  await p.evaluate(() => window.__ravia.getState().updateSite({ waterProtection: 'none' }));
  const before = await p.evaluate(() => Object.keys(window.__ravia.getState().doc.site.elements).length);
  // Im Panel, nicht in der Werkzeugleiste: deren Tooltip enthält das Wort
  // „Baum" ebenfalls und würde sonst zuerst treffen.
  await p.locator('aside').getByRole('button', { name: 'Baum', exact: true }).click();
  await p.waitForTimeout(300);
  const armed = await p.evaluate(() => {
    const s2 = window.__ravia.getState();
    return { tool: s2.tool, kind: s2.siteKind };
  });
  expect('Werkzeug scharf', `${armed.tool}/${armed.kind}`, 'site/tree');

  // Über eine Weltkoordinate klicken statt über einen Bruchteil der
  // Zeichenfläche: nur so lässt sich dieselbe Stelle vorher und nachher
  // ansehen — und genau darum geht es hier.
  const ortBaum = { x: -4, y: -4 };
  expect('Vor dem Zeichnen ist die Stelle leer', await farbPixel(ortBaum, 'baum'), 0);
  const zielBaumSetzen = await zumSchirm(ortBaum);
  await p.mouse.click(zielBaumSetzen.x, zielBaumSetzen.y);
  await p.waitForTimeout(500);
  const after = await p.evaluate(() => {
    const list = Object.values(window.__ravia.getState().doc.site.elements);
    const baum = list.find((e) => e.kind === 'tree');
    return { count: list.length, hasTree: Boolean(baum), punkt: baum?.points[0] };
  });
  expect('Ein Klick setzt den Baum', after.count, before + 1);
  expect('Und zwar als Baum', after.hasTree, true);
  // Der gemeldete Fehler traf nicht nur die Wärmepumpe, sondern jedes
  // gezeichnete Geländeobjekt. Deshalb auch hier der Blick aufs Bild.
  expect('Ohne Ansichtswechsel im Plan sichtbar', (await farbPixel(after.punkt, 'baum')) > 10, true);
}

console.log('\n▸ Anfassen im Plan');
{
  // Ansicht einpassen, damit alles im Bild liegt — sonst zielt der Klick
  // neben die Zeichenfläche und der Test prüfte nichts.
  await p.keyboard.press('0');
  await p.waitForTimeout(500);

  // --- Setzen: sichtbar ohne Ansichtswechsel ------------------------------
  const ort = { x: 0, y: 12 };
  expect('Vor dem Setzen ist die Stelle leer', await farbPixel(ort, 'geraet'), 0);

  await p.keyboard.press('p');
  await p.waitForTimeout(200);
  const zielSetzen = await zumSchirm(ort);
  await p.mouse.click(zielSetzen.x, zielSetzen.y);
  await p.waitForTimeout(500);

  const gesetzt = await p.evaluate(() => {
    const pumpen = Object.values(window.__ravia.getState().doc.site.pumps);
    const neu = pumpen[pumpen.length - 1];
    return { anzahl: pumpen.length, id: neu.id, position: neu.position };
  });
  expect('Zweites Gerät im Modell', gesetzt.anzahl, 2);
  // Der eigentliche Prüfpunkt: kein Wechsel nach 3D und zurück, nur schauen.
  expect('Ohne Ansichtswechsel im Plan sichtbar', (await farbPixel(gesetzt.position, 'geraet')) > 20, true);

  // --- Anwählen -----------------------------------------------------------
  await p.keyboard.press('v');
  await p.waitForTimeout(200);
  await p.evaluate(() => window.__ravia.getState().setSelection(null));
  const zielKlick = await zumSchirm(gesetzt.position);
  await p.mouse.click(zielKlick.x, zielKlick.y);
  await p.waitForTimeout(400);
  const gewaehlt = await p.evaluate(() => window.__ravia.getState().selection);
  expect('Klick wählt die Wärmepumpe', gewaehlt && gewaehlt.kind, 'heatpump');
  expect('Und zwar die gerade gesetzte', gewaehlt && gewaehlt.id, gesetzt.id);

  // --- Eigenschaften rechts ------------------------------------------------
  // Anwählen ist nur die halbe Bedienung: wer ein Gerät greift, will es auch
  // ändern können. Die Auswahl schaltet das rechte Feld auf den Reiter
  // „Wärmepumpe" — dort steht der Nachweis für genau dieses Gerät.
  const panelWp = await p.locator('aside').innerText();
  expect('Auswahl öffnet die Eigenschaften des Geräts', /SCHALLNACHWEIS NACHTS/.test(panelWp), true);

  // --- Ziehen -------------------------------------------------------------
  await p.mouse.move(zielKlick.x, zielKlick.y);
  await p.mouse.down();
  await p.mouse.move(zielKlick.x + 70, zielKlick.y + 50, { steps: 8 });
  await p.mouse.up();
  await p.waitForTimeout(400);
  const gezogen = await p.evaluate((id) => window.__ravia.getState().doc.site.pumps[id].position, gesetzt.id);
  expect('Ziehen verschiebt das Gerät im Modell', gezogen.x !== gesetzt.position.x || gezogen.y !== gesetzt.position.y, true);
  expect('Es steht auch im Plan an der neuen Stelle', (await farbPixel(gezogen, 'geraet')) > 20, true);

  // --- Rückgängig ---------------------------------------------------------
  // Ein Zug ist eine Handlung, nicht zwanzig: ein Strg+Z muss reichen.
  await p.keyboard.press('Control+z');
  await p.waitForTimeout(400);
  const zurueck = await p.evaluate((id) => window.__ravia.getState().doc.site.pumps[id].position, gesetzt.id);
  expect('Strg+Z bringt das Gerät an den Ausgangsort', zurueck, gesetzt.position);

  // --- Entfernen -----------------------------------------------------------
  // Löschen und Zurückholen gehören zur selben Bedienkette wie Anwählen und
  // Ziehen; ein Objekt, das sich nicht wieder entfernen lässt, ist nur halb
  // bedienbar.
  await p.keyboard.press('Delete');
  await p.waitForTimeout(300);
  expect(
    'Entf löscht die Wärmepumpe',
    await p.evaluate((id) => id in window.__ravia.getState().doc.site.pumps, gesetzt.id),
    false,
  );
  expect('Und sie ist auch aus dem Plan verschwunden', await farbPixel(gesetzt.position, 'geraet'), 0);
  await p.keyboard.press('Control+z');
  await p.waitForTimeout(300);
  expect(
    'Strg+Z holt sie wieder',
    await p.evaluate((id) => id in window.__ravia.getState().doc.site.pumps, gesetzt.id),
    true,
  );
  expect('Und zwar sichtbar', (await farbPixel(gesetzt.position, 'geraet')) > 20, true);

  // --- Geländeobjekt: anwählen, verschieben, löschen -----------------------
  const baum = await p.evaluate(() => {
    const e = Object.values(window.__ravia.getState().doc.site.elements).find((x) => x.kind === 'tree');
    return { id: e.id, punkt: e.points[0] };
  });
  const zielBaum = await zumSchirm(baum.punkt);
  await p.mouse.click(zielBaum.x, zielBaum.y);
  await p.waitForTimeout(300);
  const baumWahl = await p.evaluate(() => window.__ravia.getState().selection);
  expect('Klick wählt den Baum', baumWahl && `${baumWahl.kind}:${baumWahl.id}`, `site:${baum.id}`);
  const panelBaum = await p.locator('aside').innerText();
  expect('Auswahl öffnet die Eigenschaften des Baums', /Kronenradius/.test(panelBaum), true);

  await p.mouse.move(zielBaum.x, zielBaum.y);
  await p.mouse.down();
  await p.mouse.move(zielBaum.x + 60, zielBaum.y - 40, { steps: 6 });
  await p.mouse.up();
  await p.waitForTimeout(300);
  const baumNeu = await p.evaluate((id) => window.__ravia.getState().doc.site.elements[id].points[0], baum.id);
  expect('Ziehen verschiebt den Baum', baumNeu.x !== baum.punkt.x || baumNeu.y !== baum.punkt.y, true);
  await p.keyboard.press('Control+z');
  await p.waitForTimeout(300);
  expect(
    'Strg+Z bringt ihn zurück',
    await p.evaluate((id) => window.__ravia.getState().doc.site.elements[id].points[0], baum.id),
    baum.punkt,
  );

  await p.keyboard.press('Delete');
  await p.waitForTimeout(300);
  expect('Entf löscht ihn', await p.evaluate((id) => id in window.__ravia.getState().doc.site.elements, baum.id), false);
  await p.keyboard.press('Control+z');
  await p.waitForTimeout(300);
  expect('Und Strg+Z holt ihn wieder', await p.evaluate((id) => id in window.__ravia.getState().doc.site.elements, baum.id), true);

  // --- Fläche verschieben: bleibt im Raster --------------------------------
  // Ein Grundstück wird als Ganzes umgesetzt, nicht Ecke für Ecke. Dabei muss
  // es im Raster bleiben — sonst trägt der Lageplan nach dem ersten
  // Verschieben krumme Koordinaten.
  const grenze = await p.evaluate(() => {
    const e = Object.values(window.__ravia.getState().doc.site.elements).find((x) => x.kind === 'boundary');
    return { id: e.id, punkte: e.points };
  });
  const kante = {
    x: (grenze.punkte[0].x + grenze.punkte[1].x) / 2,
    y: (grenze.punkte[0].y + grenze.punkte[1].y) / 2,
  };
  const zielGrenze = await zumSchirm(kante);
  await p.mouse.click(zielGrenze.x, zielGrenze.y);
  await p.waitForTimeout(300);
  const grenzWahl = await p.evaluate(() => window.__ravia.getState().selection);
  expect('Klick auf die Kante wählt die Grenze', grenzWahl && `${grenzWahl.kind}:${grenzWahl.id}`, `site:${grenze.id}`);

  await p.mouse.move(zielGrenze.x, zielGrenze.y);
  await p.mouse.down();
  await p.mouse.move(zielGrenze.x + 55, zielGrenze.y - 35, { steps: 6 });
  await p.mouse.up();
  await p.waitForTimeout(300);
  const grenzeNeu = await p.evaluate((id) => window.__ravia.getState().doc.site.elements[id].points, grenze.id);
  const raster = await p.evaluate(() => window.__ravia.getState().snap.gridSize);
  expect(
    'Die Grenze wandert als Ganzes',
    grenzeNeu[0].x !== grenze.punkte[0].x || grenzeNeu[0].y !== grenze.punkte[0].y,
    true,
  );
  expect(
    'Und behält ihre Form',
    grenzeNeu.every(
      (pt, i) =>
        Math.abs(pt.x - grenze.punkte[i].x - (grenzeNeu[0].x - grenze.punkte[0].x)) < 1e-6 &&
        Math.abs(pt.y - grenze.punkte[i].y - (grenzeNeu[0].y - grenze.punkte[0].y)) < 1e-6,
    ),
    true,
  );
  expect(
    'Und bleibt im Raster',
    grenzeNeu.every((pt) => Math.abs(pt.x / raster - Math.round(pt.x / raster)) < 1e-6 && Math.abs(pt.y / raster - Math.round(pt.y / raster)) < 1e-6),
    true,
  );
  await p.keyboard.press('Control+z');
  await p.waitForTimeout(300);
  expect(
    'Strg+Z setzt sie zurück',
    await p.evaluate((id) => window.__ravia.getState().doc.site.elements[id].points, grenze.id),
    grenze.punkte,
  );

  await p.screenshot({ path: './screenshots/wp-5-anfassen.png' });
}

console.log('\n▸ Mausbewegung allein ändert nichts');
{
  // Gegenprobe zur Behebung von Fehler A: die Zeichenfläche hängt jetzt am
  // *Dokument als Ganzem*. Das wäre teuer erkauft, wenn schon das Bewegen der
  // Maus das Dokument anfasste — dann liefe bei jedem Pixel ein React-Durchlauf
  // samt Historieneintrag. Geprüft wird deshalb beides: die Identität des
  // Dokuments (sie steuert den Neuaufbau) und die Länge der Historie.
  await p.keyboard.press('v');
  await p.waitForTimeout(200);
  const box = await p.locator('main canvas').first().boundingBox();
  const vorher = await p.evaluate(() => {
    window.__docVorher = window.__ravia.getState().doc;
    return window.__ravia.getState().past.length;
  });
  for (let i = 0; i < 40; i++) {
    await p.mouse.move(box.x + 200 + i * 6, box.y + 200 + (i % 9) * 4);
  }
  await p.waitForTimeout(400);
  const nachher = await p.evaluate(() => ({
    gleich: window.__docVorher === window.__ravia.getState().doc,
    historie: window.__ravia.getState().past.length,
  }));
  expect('Vierzig Mausbewegungen lassen das Dokument unberührt', nachher.gleich, true);
  expect('Und legen keinen Historieneintrag an', nachher.historie, vorher);
}

console.log('\nERRORS:', errs.length ? errs.join('\n') : 'keine');
if (errs.length) failures += errs.length;
console.log(`\n${failures === 0 ? '✓ RAUCHTEST BESTANDEN' : `✗ ${failures} FEHLER`}\n`);
await b.close();
process.exit(failures === 0 ? 0 : 1);
