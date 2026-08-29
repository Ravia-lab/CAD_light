/**
 * Rauchtest für Dach, Treppen, Schächte und Rohrnetz.
 * Geprüft wird die Wirkung auf das Modell, nicht das Aussehen.
 */
import { chromium } from 'playwright';

const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const p = await b.newPage({ viewport: { width: 1680, height: 980 }, deviceScaleFactor: 2 });
const errs = [];
p.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
p.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('Failed to load resource')) errs.push(m.text());
});
p.on('dialog', (d) => d.accept());

let failures = 0;
const expect = (label, actual, want) => {
  const ok = JSON.stringify(actual) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`  ${ok ? '✓' : '✗'} ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (erwartet ${JSON.stringify(want)})`}`);
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


await p.goto('http://localhost:4177/', { waitUntil: 'networkidle' });
await p.waitForTimeout(1200);
const box = await p.locator('canvas').first().boundingBox();
const at = (fx, fy) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy });

console.log('\n▸ Dach');
{
  await p.getByRole('button', { name: 'Dach', exact: true }).click();
  await p.waitForTimeout(300);
  await p.getByRole('button', { name: /Satteldach/ }).click();
  await p.waitForTimeout(1000);

  const m = await p.evaluate(() => {
    const d = window.__ravia.getState().doc;
    const rooms = Object.values(d.rooms);
    return {
      hasRoof: Boolean(d.levels[d.activeLevelId].roof),
      withMetrics: rooms.filter((r) => r.roof).length,
      totalRooms: rooms.length,
      volume: rooms.reduce((s, r) => s + r.volume, 0),
      living: rooms.reduce((s, r) => s + (r.roof?.livingArea ?? 0), 0),
      area: rooms.reduce((s, r) => s + r.area, 0),
      areaTimesMean: rooms.reduce((s, r) => s + r.area * r.height, 0),
      meanOk: rooms.every((r) => r.roof && r.height > r.roof.minHeight && r.height < r.roof.maxHeight),
    };
  });
  expect('Dach am Geschoss', m.hasRoof, true);
  expect('Alle Räume mit Dachkennwerten', m.withMetrics, m.totalRooms);
  expect('Wohnfläche kleiner als Grundfläche', m.living < m.area, true);
  // Unter der Schräge ist das Volumen nicht mehr Fläche × Geschosshöhe,
  // sondern Fläche × *mittlerer* Höhe — der Prüfpunkt ist die Konsistenz.
  expect('Volumen = Fläche × mittlere Höhe', Math.abs(m.volume - m.areaTimesMean) < 0.6, true);
  expect('Mittlere Höhe zwischen Kniestock und First', m.meanOk, true);
  console.log(`    Grundfläche ${m.area.toFixed(2)} m² · WoFlV ${m.living.toFixed(2)} m² · ${m.volume.toFixed(2)} m³`);

  await p.screenshot({ path: './screenshots/tga-1-dach.png' });

  // Pultdach und Walmdach dürfen nicht abstürzen
  for (const name of ['Pultdach', 'Walmdach']) {
    await p.getByRole('button', { name, exact: true }).click();
    await p.waitForTimeout(700);
  }
  await p.getByRole('button', { name: 'Satteldach', exact: true }).click();
  await p.waitForTimeout(700);
  expect('Dachformen ohne Fehler durchgeschaltet', errs.length, 0);
}

console.log('\n▸ Gauben und Dachflächenfenster');
{
  await p.getByRole('button', { name: 'Dach', exact: true }).click();
  await p.waitForTimeout(300);
  const before = await p.evaluate(() => {
    const rooms = Object.values(window.__ravia.getState().doc.rooms);
    return { volume: rooms.reduce((s, r) => s + r.volume, 0) };
  });

  await p.getByRole('button', { name: 'Schleppg.', exact: true }).click();
  await p.waitForTimeout(900);
  await p.getByRole('button', { name: 'Dach', exact: true }).click();
  await p.waitForTimeout(300);
  await p.getByRole('button', { name: 'Fenster', exact: true }).click();
  await p.waitForTimeout(900);

  const after = await p.evaluate(() => {
    const d = window.__ravia.getState().doc;
    const rooms = Object.values(d.rooms);
    const sum = (f) => rooms.reduce((s, r) => s + (r.roof ? f(r.roof) : 0), 0);
    return {
      count: Object.keys(d.roofOpenings).length,
      volume: rooms.reduce((s, r) => s + r.volume, 0),
      dormerVolume: sum((x) => x.dormerVolume),
      front: sum((x) => x.dormerFrontArea),
      cheek: sum((x) => x.dormerCheekArea),
      sky: sum((x) => x.skylightArea),
    };
  });
  expect('Zwei Dachöffnungen', after.count, 2);
  expect('Gaube schafft Volumen', after.volume > before.volume, true);
  expect('Gaubenvolumen ausgewiesen', after.dormerVolume > 0.2, true);
  expect('Gaubenfront ausgewiesen', after.front > 0.2, true);
  expect('Gaubenwangen ausgewiesen', after.cheek > 0.05, true);
  expect('Dachfenster ausgewiesen', Math.abs(after.sky - 0.78 * 1.18) < 0.02, true);
  console.log(`    Gaube +${after.dormerVolume.toFixed(2)} m³ · Front ${after.front.toFixed(2)} m² · Fenster ${after.sky.toFixed(2)} m²`);
  await p.screenshot({ path: './screenshots/tga-1b-dachoeffnungen.png' });
}

console.log('\n▸ Treppe und Schacht');
{
  const before = await p.evaluate(() => {
    const d = window.__ravia.getState().doc;
    const r = Object.values(d.rooms).sort((a, b) => b.area - a.area)[0];
    return { area: r.area, volume: r.volume, id: r.id };
  });

  await p.keyboard.press('r');
  await p.mouse.click(at(0.28, 0.55).x, at(0.28, 0.55).y);
  await p.waitForTimeout(700);
  await p.screenshot({ path: './screenshots/tga-2-treppe.png' });

  const after = await p.evaluate(() => {
    const d = window.__ravia.getState().doc;
    const vs = Object.values(d.verticals);
    const r = Object.values(d.rooms).sort((a, b) => b.area - a.area)[0];
    return {
      count: vs.length,
      kind: vs[0]?.kind,
      opening: r.floorOpeningArea ?? 0,
      openAbove: r.openToAboveArea ?? 0,
      volume: r.volume,
    };
  });
  expect('Treppe eingesetzt', after.count, 1);
  expect('als gerade Treppe', after.kind, 'stair-straight');
  expect('Grundfläche abgezogen', after.opening > 3, true);
  expect('Decke darüber offen', after.openAbove > 3, true);
  expect('Volumen geschrumpft', after.volume < before.volume, true);

  await p.keyboard.press('s');
  await p.mouse.click(at(0.2, 0.3).x, at(0.2, 0.3).y);
  await p.waitForTimeout(600);
  const shafts = await p.evaluate(
    () => Object.values(window.__ravia.getState().doc.verticals).filter((v) => v.kind === 'shaft').length,
  );
  expect('Schacht eingesetzt', shafts, 1);
}

console.log('\n▸ Massives Bauteil');
{
  // Ein Kamin ist kein Loch: er nimmt Fläche und Luftvolumen weg wie eine
  // Treppe, lässt die Decke darüber aber stehen. Genau das wird hier
  // abgelesen — und dass er im Plan als eigenes Bauteil erscheint.
  const vorher = await p.evaluate(() => {
    const d = window.__ravia.getState().doc;
    const r = Object.values(d.rooms).sort((a, b) => b.area - a.area)[0];
    return {
      volume: r.volume,
      opening: r.floorOpeningArea ?? 0,
      solid: r.solidArea ?? 0,
      openAbove: r.openToAboveArea ?? 0,
    };
  });

  await p.keyboard.press('m');
  await p.waitForTimeout(200);
  await p.mouse.click(at(0.42, 0.62).x, at(0.42, 0.62).y);
  await p.waitForTimeout(700);
  await p.screenshot({ path: './screenshots/tga-2b-kamin.png' });

  const nachher = await p.evaluate(() => {
    const d = window.__ravia.getState().doc;
    const list = Object.values(d.solids ?? {});
    const r = Object.values(d.rooms).sort((a, b) => b.area - a.area)[0];
    return {
      count: list.length,
      kind: list[0]?.kind,
      durchgehend: list[0]?.throughAllLevels,
      flaeche: list[0] ? list[0].width * list[0].length : 0,
      volume: r.volume,
      opening: r.floorOpeningArea ?? 0,
      solid: r.solidArea ?? 0,
      openAbove: r.openToAboveArea ?? 0,
    };
  });
  expect('Kamin eingesetzt', nachher.count, 1);
  expect('als Schornstein', nachher.kind, 'chimney');
  expect('der durch alle Geschosse geht', nachher.durchgehend, true);
  expect('Grundfläche als massiver Anteil gebucht', Math.abs(nachher.solid - vorher.solid - nachher.flaeche) < 0.01, true);
  expect('Grundfläche vom Raum abgezogen', Math.abs(nachher.opening - vorher.opening - nachher.flaeche) < 0.01, true);
  expect('Luftvolumen geschrumpft', nachher.volume < vorher.volume, true);
  // Der Unterschied zur Treppe: die Decke über dem Kamin bleibt stehen.
  expect('Die Deckenöffnung bleibt unverändert', nachher.openAbove, vorher.openAbove);
}

console.log('\n▸ Rohrnetz');
{
  await p.keyboard.press('l');
  await p.waitForTimeout(200);
  await p.mouse.click(at(0.2, 0.75).x, at(0.2, 0.75).y);
  await p.waitForTimeout(200);
  await p.mouse.click(at(0.45, 0.75).x, at(0.45, 0.75).y);
  await p.waitForTimeout(200);
  await p.mouse.click(at(0.45, 0.45).x, at(0.45, 0.45).y);
  await p.waitForTimeout(200);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(600);
  await p.screenshot({ path: './screenshots/tga-3-rohre.png' });

  const pipes = await p.evaluate(() => {
    const d = window.__ravia.getState().doc;
    const list = Object.values(d.pipes);
    const len = (pts) => pts.reduce((s, q, i) => (i ? s + Math.hypot(q.x - pts[i - 1].x, q.y - pts[i - 1].y) : 0), 0);
    return { count: list.length, points: list[0]?.points.length ?? 0, length: list[0] ? len(list[0].points) : 0, dn: list[0]?.nominalDiameter };
  });
  expect('Leitung angelegt', pipes.count, 1);
  expect('Drei Stützpunkte', pipes.points, 3);
  expect('Länge > 0', pipes.length > 1, true);
  expect('Nennweite vorbelegt', pipes.dn, 20);

  await p.getByRole('button', { name: 'TGA', exact: true }).click();
  await p.waitForTimeout(500);
  const panel = await p.locator('aside').innerText();
  expect('Längenauszug zeigt die Leitung', /Heizung Vorlauf · DN 20/.test(panel), true);
  await p.screenshot({ path: './screenshots/tga-4-auszug.png' });

  // Strangschema: die frei verlegte Leitung hängt an keiner Quelle — genau
  // das soll sie sagen, statt sie stillschweigend zu übergehen.
  expect('Strangliste erscheint', /STRÄNGE|Stränge/i.test(panel), true);
  const net = await p.evaluate(() => window.RaViaCAD.getExport().pipeNetwork);
  expect('Netz im Export', Boolean(net), true);
  expect('Trassenlängen als Kreislänge', net.paths.every((x) => x.circuitLength >= x.routeLength), true);
  await p.locator('aside').screenshot({ path: './screenshots/tga-10-straenge.png' });
}

console.log('\n▸ Export');
{
  const ex = await p.evaluate(() => {
    const d = window.__ravia.getState().doc;
    return {
      verticals: Object.keys(d.verticals).length,
      solids: Object.keys(d.solids ?? {}).length,
      pipes: Object.keys(d.pipes).length,
    };
  });
  const dl = p.waitForEvent('download');
  await p.getByRole('button', { name: /RaVia JSON/ }).click();
  const file = await dl;
  await file.saveAs('/tmp/export-tga.json');
  const { readFileSync } = await import('node:fs');
  const json = JSON.parse(readFileSync('/tmp/export-tga.json', 'utf-8'));
  expect('Treppen im Export', json.verticals.length, ex.verticals);
  expect('Massive Bauteile im Export', json.solids.length, ex.solids);
  expect('Mit Grundfläche und Höhe', json.solids.every((m) => m.area > 0 && m.height > 0), true);
  expect('Mit Wärmebrückenangabe', json.solids.every((m) => typeof m.thermalBridge.contactLength === 'number'), true);
  expect('Und in der Rohgeometrie', json.geometry.solids.length, ex.solids);
  expect('Leitungen im Export', json.pipes.length, ex.pipes);
  expect('Längenauszug vorhanden', json.pipeSchedule.length > 0, true);
  expect('Dachflächen im Export', json.rooms.some((r) => r.surfaces.some((s) => s.kind === 'roof')), true);
  expect('Giebel im Export', json.rooms.some((r) => r.surfaces.some((s) => s.kind === 'gable')), true);
  expect('Wohnfläche WoFlV im Export', json.rooms.every((r) => typeof r.roof?.livingArea === 'number'), true);

  // IFC daneben: dieselbe Geometrie, anderes Format.
  const dl2 = p.waitForEvent('download');
  await p.getByTitle(/als IFC4 exportieren/).click();
  const ifcFile = await dl2;
  await ifcFile.saveAs('/tmp/export-tga.ifc');
  const ifc = readFileSync('/tmp/export-tga.ifc', 'utf-8');
  expect('IFC-Kopf', ifc.startsWith('ISO-10303-21;'), true);
  expect('IFC4-Schema', ifc.includes("FILE_SCHEMA(('IFC4'))"), true);
  expect('Wände im IFC', (ifc.match(/IFCWALLSTANDARDCASE\(/g) ?? []).length, json.geometry.walls.length);
  expect('Räume im IFC', (ifc.match(/IFCSPACE\(/g) ?? []).length, json.rooms.length);
  expect('Treppe im IFC', (ifc.match(/IFCSTAIR\(/g) ?? []).length >= 1, true);
  expect('Dach im IFC', (ifc.match(/IFCROOF\(/g) ?? []).length >= 1, true);
  expect('Dachfenster im IFC', (ifc.match(/IFCWINDOW\(/g) ?? []).length >= 1, true);
}

console.log('\n▸ IFC-Import');
{
  // Dieselbe Datei, die eben exportiert wurde, wieder einlesen: was
  // hineingeschrieben wurde, muss wieder herauskommen.
  const before = await p.evaluate(() => {
    const d = window.__ravia.getState().doc;
    return { walls: Object.keys(d.walls).length, name: d.meta.name };
  });

  await p.locator('input[type=file][accept*="ifc"]').setInputFiles('/tmp/export-tga.ifc');
  await p.waitForTimeout(1800);

  const status = (await p.locator('footer').innerText()).replace(/\n/g, ' | ');
  expect('Import gemeldet', /IFC IFC4/.test(status), true);

  const after = await p.evaluate(() => {
    const d = window.__ravia.getState().doc;
    return {
      walls: Object.keys(d.walls).length,
      openings: Object.keys(d.openings).length,
      rooms: Object.keys(d.rooms).length,
      levels: Object.keys(d.levels).length,
    };
  });
  expect('Alle Wände zurückgelesen', after.walls, before.walls);
  expect('Öffnungen zurückgelesen', after.openings > 0, true);
  expect('Räume aus Importgeometrie erkannt', after.rooms > 0, true);
  await p.screenshot({ path: './screenshots/tga-6-ifc-import.png' });

  // Undo muss den Stand von vor dem Import zurückholen.
  await p.keyboard.press('Control+z');
  await p.waitForTimeout(800);
  const undone = await p.evaluate(() => window.__ravia.getState().doc.meta.name);
  expect('Undo holt das alte Modell zurück', undone, before.name);
}

console.log('\n▸ Lüftung');
{
  await p.getByRole('button', { name: 'Lüftung', exact: true }).click();
  await p.waitForTimeout(400);

  const free = await p.evaluate(() => window.RaViaCAD.getExport().totals.ventilation);
  expect('Ohne Anlage: freie Lüftung', free.kind, 'none');
  expect('Ohne Anlage: keine Rückgewinnung', free.heatRecovery, 0);

  await p.getByRole('button', { name: 'Zu-/Abluft' }).click();
  await p.waitForTimeout(500);

  const vt = await p.evaluate(() => {
    const ex = window.RaViaCAD.getExport();
    return {
      totals: ex.totals.ventilation,
      roles: ex.rooms.map((r) => r.ventilation.role),
      effective: ex.rooms.reduce((s, r) => s + r.ventilation.effectiveSupplyAirflow, 0),
    };
  });
  expect('Anlagenart im Export', vt.totals.kind, 'balanced');
  expect('Rückgewinnung voreingestellt', vt.totals.heatRecovery, 0.8);
  expect('Wirksame Zuluft = Σ Räume', vt.totals.effectiveSupplyAirflow, vt.effective);
  expect('Rollen je Raum gesetzt', vt.roles.every((r) => typeof r === 'string'), true);
  expect(
    'Bilanz = Zuluft − Abluft',
    vt.totals.balance,
    vt.totals.supplyAirflow - vt.totals.exhaustAirflow,
  );

  const panelText = await p.locator('aside').innerText();
  expect('Luftbilanz sichtbar', /LUFTBILANZ/.test(panelText), true);
  await p.locator('aside').screenshot({ path: './screenshots/tga-11-lueftung.png' });

  // Der Prüfbericht muss die klaffende Bilanz des Demo-Grundrisses melden.
  const codes = await p.evaluate(() => window.RaViaCAD.validate().issues.map((i) => i.code));
  expect('Klaffende Luftbilanz gemeldet', codes.includes('ventilation.unbalanced'), true);
}

console.log('\n▸ Wärmebrücken');
{
  await p.getByRole('button', { name: 'Wärmebrücken' }).click();
  await p.waitForTimeout(500);

  // Pauschal: Zuschlag steckt in den Flächen, keine Anschlussliste am Raum.
  const before = await p.evaluate(() => {
    const s = window.__ravia.getState();
    return { method: s.doc.meta.thermalBridgeMethod, supplement: s.doc.meta.thermalBridgeSupplement };
  });
  expect('Standard ist pauschal', before.method, 'flat');
  expect('Ohne Nachweis 0,10 W/(m²·K)', before.supplement, 0.1);

  const panel = await p.locator('aside').innerText();
  expect('Gegenprobe sichtbar', /GEGENPROBE/.test(panel), true);
  expect('Anschlüsse aufgelistet', /Sockel \/ Bodenplatte/.test(panel), true);
  await p.locator('aside').screenshot({ path: './screenshots/tga-7-bridges.png' });

  // Kategorie B setzt den Zuschlag auf 0,03.
  await p.getByRole('button', { name: 'Kategorie B' }).click();
  await p.waitForTimeout(300);
  const cat = await p.evaluate(() => window.__ravia.getState().doc.meta.thermalBridgeSupplement);
  expect('Kategorie B setzt 0,03', cat, 0.03);

  // Umschalten auf längenbezogen: die Flächen tragen keinen Zuschlag mehr.
  await p.getByRole('button', { name: 'längenbezogen' }).click();
  await p.waitForTimeout(400);
  const detailed = await p.evaluate(() => {
    const api = window.RaViaCAD;
    const ex = api.getExport();
    const room = ex.rooms[0];
    return {
      method: ex.totals.thermalBridges.method,
      supplementsZero: room.surfaces.every((s) => s.thermalBridgeSupplement === 0),
      bridges: (room.thermalBridges ?? []).length,
      roomHeatLoss: room.thermalBridgeHeatLoss ?? 0,
      total: ex.totals.thermalBridges.detailedHeatLoss,
      equivalent: ex.totals.thermalBridges.equivalentSupplement,
      kinds: Object.keys(ex.totals.thermalBridges.lengthsByKind).length,
    };
  });
  expect('Export kennt das Verfahren', detailed.method, 'detailed');
  expect('Keine Flächenzuschläge mehr', detailed.supplementsZero, true);
  expect('Anschlussliste am Raum', detailed.bridges > 0, true);
  expect('Raumbilanz gesetzt', detailed.roomHeatLoss !== 0, true);
  expect('Gesamtbilanz gesetzt', detailed.total > 0, true);
  expect('Gleichwertiger Zuschlag ausgewiesen', detailed.equivalent > 0, true);
  expect('Mehrere Anschlussarten gefunden', detailed.kinds >= 4, true);
  await p.locator('aside').screenshot({ path: './screenshots/tga-8-bridges-detail.png' });

  // Absenkbetrieb: Eingaben landen im Export, τ und ΔΘ werden abgeleitet.
  await p.getByRole('button', { name: 'aus', exact: true }).click();
  await p.waitForTimeout(400);
  const sb = await p.evaluate(() => window.RaViaCAD.getExport().totals.setback);
  expect('Absenkbetrieb im Export', sb?.active, true);
  expect('Zeitkonstante abgeleitet', sb.timeConstant > 0, true);
  expect('Temperaturabfall abgeleitet', sb.temperatureDrop > 0, true);
  expect('Ohne f_RH keine Aufheizleistung', sb.reheatPower, 0);
  await p.locator('aside').screenshot({ path: './screenshots/tga-9-setback.png' });
}

console.log('\n▸ 3D');
{
  await p.getByRole('button', { name: '3D', exact: true }).click();
  await p.waitForTimeout(3200);
  await p.screenshot({ path: './screenshots/tga-5-3d.png', timeout: 90000 });
  expect('3D ohne Fehler', errs.length, 0);
}

console.log('\nERRORS:', errs.length ? errs.join('\n') : 'keine');
if (errs.length) failures += errs.length;
console.log(`\n${failures === 0 ? '✓ RAUCHTEST BESTANDEN' : `✗ ${failures} FEHLER`}\n`);
await b.close();
process.exit(failures === 0 ? 0 : 1);
