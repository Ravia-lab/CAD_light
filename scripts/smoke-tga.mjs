/**
 * Rauchtest für Dach, Treppen, Schächte und Rohrnetz.
 * Geprüft wird die Wirkung auf das Modell, nicht das Aussehen.
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


await p.goto(BASIS, { waitUntil: 'networkidle' });
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

  /*
   * **Ein Zug, zwei Rohre.**
   *
   * Seit 1.26.0 zeichnet das Rohrwerkzeug bei der Heizung eine
   * Doppelleitung: Der gezeichnete Weg ist die *Mitte* der Trasse, Vor- und
   * Rücklauf liegen je 25 mm daneben und tragen dieselbe Paarkennung. Bis
   * dahin stand hier `count === 1` — und genau das war der Zustand, in dem
   * man von Hand zwei Züge parallel ziehen musste und der Rücklauf am Ende
   * drei Meter länger war als der Vorlauf, ohne dass es jemand sah.
   *
   * Geprüft wird deshalb das Paar und nicht die Zahl allein: gleicher
   * Abstand, gleiche Stützpunktzahl, verschiedene Leitungsart, eine
   * Kennung.
   *
   * **Nicht geprüft wird gleiche Länge, und das mit Absicht.** Ein Seilpaar
   * um eine Ecke hat innen das kürzere Seil; bei rechtem Winkel und 25 mm
   * Versatz sind es 50 mm je Ecke. Was exakt gilt, ist der Abstand — und
   * dass er über den ganzen Zug derselbe bleibt, ist die Aussage, die im
   * Kanal zählt.
   */
  const pipes = await p.evaluate(() => {
    const d = window.__ravia.getState().doc;
    const list = Object.values(d.pipes);
    const len = (pts) => pts.reduce((s, q, i) => (i ? s + Math.hypot(q.x - pts[i - 1].x, q.y - pts[i - 1].y) : 0), 0);
    const paarId = list[0]?.pairId;
    const paar = list.filter((r) => paarId && r.pairId === paarId);
    return {
      count: list.length,
      points: list[0]?.points.length ?? 0,
      length: list[0] ? len(list[0].points) : 0,
      dn: list[0]?.nominalDiameter,
      paarGross: paar.length,
      arten: [...new Set(paar.map((r) => r.service))].sort().join('+'),
      punkteGleich: paar.length === 2 && paar[0].points.length === paar[1].points.length,
      /*
       * Abstand an Anfang und Ende.
       *
       * Nur dort sind die einander entsprechenden Stützpunkte auch die
       * nächstgelegenen. **An der Ecke nicht:** Die Gehrung schiebt den
       * Eckpunkt auf der Winkelhalbierenden nach außen, bei rechtem Winkel
       * um den Faktor 1/cos 45° — die beiden Eckpunkte liegen dann 70,7 mm
       * auseinander, obwohl die Strecken sauber 50 mm Abstand halten. Wer
       * hier stur Punkt gegen Punkt misst, misst die Gehrung und nennt sie
       * einen Fehler.
       */
      abstand:
        paar.length === 2 && paar[0].points.length === paar[1].points.length
          ? Math.max(
              ...[0, paar[0].points.length - 1].map((i) =>
                Math.abs(
                  Math.hypot(
                    paar[0].points[i].x - paar[1].points[i].x,
                    paar[0].points[i].y - paar[1].points[i].y,
                  ) - 0.05,
                ),
              ),
            )
          : 1,
    };
  });
  expect('Doppelleitung angelegt', pipes.count, 2);
  expect('Beide tragen dieselbe Paarkennung', pipes.paarGross, 2);
  expect('Vorlauf und Rücklauf', pipes.arten, 'heating-flow+heating-return');
  expect('Gleich viele Stützpunkte', pipes.punkteGleich, true);
  expect('Achsabstand 50 mm an Anfang und Ende', pipes.abstand < 0.001, true);
  expect('Drei Stützpunkte', pipes.points, 3);
  expect('Länge > 0', pipes.length > 1, true);
  expect('Nennweite vorbelegt', pipes.dn, 20);

  /*
   * **Eine gelöschte Armatur muss wiederkommen.**
   *
   * Dieser Fall ist nicht erfunden: Bis 1.26.0 fehlte `pipeAccessories` in
   * `cloneDoc`. Jede Kopie des Dokuments zeigte damit auf *dasselbe*
   * Armaturenverzeichnis — wer eine Armatur löschte, löschte sie auch aus
   * dem Stand, der in der Historie liegt, und Strg+Z holte sie nicht
   * zurück. Im Programm sah dabei alles richtig aus; aufgefallen ist es
   * erst bei der Abnahme am laufenden Server.
   *
   * Der Prüfblock im Rechenkern kann das nicht abdecken: `cloneDoc` gehört
   * zum Store, und ein Prüfblock, der aus `src/store` importiert, zerreißt
   * das Kernel-Paket. Also steht die Probe hier, wo ein echter Store läuft.
   */
  const armatur = await p.evaluate(() => {
    const st = () => window.__ravia.getState();
    const lauf = Object.values(st().doc.pipes)[0];
    st().setzeArmatur('shutoff', { x: lauf.points[0].x, y: lauf.points[0].y }, lauf.elevation);
    const nachSetzen = Object.keys(st().doc.pipeAccessories ?? {}).length;
    const id = Object.keys(st().doc.pipeAccessories ?? {})[0];
    st().setSelection({ kind: 'accessory', id });
    st().deleteSelection();
    const nachLoeschen = Object.keys(st().doc.pipeAccessories ?? {}).length;
    st().undo();
    return { nachSetzen, nachLoeschen, nachUndo: Object.keys(st().doc.pipeAccessories ?? {}).length };
  });
  expect('Eine Armatur lässt sich setzen', armatur.nachSetzen, 1);
  expect('… und löschen', armatur.nachLoeschen, 0);
  expect('… und ein Rückgängig holt sie zurück', armatur.nachUndo, 1);

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

/*
 * ▸ Umsetzen in 3D — und zwar **wie weit**, nicht nur **dass**.
 *
 * Der Unterschied ist kein Feinschliff. Bis 1.21.1 starb ein Zug nach dem
 * ersten Zwischenschritt: ein Effekt baute sich mitten darin neu auf und
 * setzte den Zugzustand zurück. Ein Test, der nur „hat sich etwas bewegt?"
 * fragt, wäre grün geblieben — bewegt hatte es sich ja, um acht Zentimeter.
 * Gemeldet wurde es als „in 3D lässt sich nichts bewegen", und genau so sah
 * es auch aus.
 *
 * Deshalb misst dieser Block den zurückgelegten Weg gegen den Zug und prüft
 * zusätzlich, dass die ganze Bewegung **ein** Schritt in der Historie ist.
 */
console.log('\n▸ Umsetzen in 3D');
{
  const box = await p.evaluate(() => {
    const c = document.querySelector('canvas');
    const r = c.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  // Den Heizkörper über denselben Strahl suchen, den auch der Klick benutzt.
  const fund = await p.evaluate((bx) => {
    for (let y = bx.y + 12; y < bx.y + bx.h - 12; y += 5)
      for (let x = bx.x + 12; x < bx.x + bx.w - 12; x += 5) {
        const t = window.__raviaTreffer?.(x, y);
        if (t?.fixtureId) return { x, y, id: t.fixtureId };
      }
    return null;
  }, box);
  expect('Ein Objekt ist in 3D zu treffen', Boolean(fund), true);

  if (fund) {
    const vor = await p.evaluate((id) => ({
      pos: { ...window.__ravia.getState().doc.fixtures[id].position },
      historie: window.__ravia.getState().past.length,
    }), fund.id);

    const SCHRITTE = 12;
    const PRO_SCHRITT = 9;
    await p.mouse.move(fund.x, fund.y);
    await p.mouse.down();
    for (let i = 1; i <= SCHRITTE; i++) {
      await p.mouse.move(fund.x + i * PRO_SCHRITT, fund.y + i * 2);
      await p.waitForTimeout(30);
    }
    await p.waitForTimeout(200);
    const fahne = await p.evaluate(() =>
      [...document.querySelectorAll('div')]
        .filter((d) => d.childElementCount === 0)
        .map((d) => d.textContent.trim())
        .find((t) => /vom Wandanfang|frei im Raum/.test(t)) ?? null,
    );
    await p.mouse.up();
    await p.waitForTimeout(300);

    const nach = await p.evaluate((id) => {
      const s = window.__ravia.getState();
      return {
        pos: { ...s.doc.fixtures[id].position },
        historie: s.past.length,
        status: s.statusMessage,
      };
    }, fund.id);

    const weg = Math.hypot(nach.pos.x - vor.pos.x, nach.pos.y - vor.pos.y);
    console.log(`  · Zug ${SCHRITTE * PRO_SCHRITT} px → Weg ${weg.toFixed(2)} m`);
    // Ein halber Meter ist die Grenze, unter der ein Zug über hundert Bildpunkte
    // aussieht wie ein Fehler. Der alte Stand schaffte 0,08 m.
    expect('Der Zug lebt bis zum Loslassen (Weg > 0,5 m)', weg > 0.5, true);
    expect('Die Fahne zeigt Maß und Höhe', /(?:vom Wandanfang|frei im Raum).*h /.test(fahne ?? ''), true);
    expect('Die Meldung bleibt stehen', /umgesetzt/.test(nach.status), true);
    expect('Ein Zug ist ein Schritt in der Historie', nach.historie - vor.historie, 1);

    // Und einmal zurück: danach steht es wieder da, wo es war.
    await p.evaluate(() => window.__ravia.getState().undo());
    await p.waitForTimeout(300);
    const zurueck = await p.evaluate((id) => ({ ...window.__ravia.getState().doc.fixtures[id].position }), fund.id);
    expect('Ein Rückgängig stellt die Ausgangslage her', zurueck, vor.pos);
  }
}

/*
 * ▸ Die Werkzeugkiste im Haus.
 *
 * **Was hier wirklich geprüft wird.** Nicht, dass Knöpfe da sind — das sagt
 * nichts. Geprüft wird, dass ein Knopfdruck im Begehmodus ein Bauteil an
 * *der Stelle* anlegt, auf die das Fadenkreuz zeigt, und mit *der Höhe*, die
 * dort abgelesen wird. Das ist die ganze Behauptung der Fassung 1.23.0, und
 * sie lässt sich nur am Modell nachweisen: `window.__ravia` sagt, was
 * angelegt wurde, `window.__raviaGeher` sagt, wo man stand.
 *
 * Gezielt wird durch **Drehen der Kamera**, nicht durch einen Klick auf die
 * Leinwand — genau so, wie ein Mensch es täte, und genau so, wie es die
 * einzige Bedienung ist, die im Begehmodus zur Verfügung steht.
 */
console.log('\n▸ Werkzeugkiste im Begehen-Modus');
{
  /*
   * **Warum hier nicht mit der Maus geklickt wird.**
   *
   * Ein Playwright-Klick geht durch die Eingabekette des Browsers, und die
   * wartet auf den Renderer. Der rechnet in dieser Prüfumgebung aber ein
   * ganzes Haus in *Software* (SwiftShader, keine Grafikkarte): Ein Bild
   * dauert Sekunden, und der Klick läuft in die Zeitsperre, ohne dass mit
   * der Anwendung irgendetwas nicht stimmte. Auf einem Gerät mit
   * Grafikkarte tritt das nicht auf — der Fehler säße also in der Prüfung
   * und nicht im Programm.
   *
   * Stattdessen wird zweierlei getrennt geprüft, und beides zusammen sagt
   * mehr als ein Mausklick:
   *
   *  1. **Ist der Knopf erreichbar?** `elementFromPoint` auf seinem
   *     Mittelpunkt muss ihn selbst liefern. Genau das ist die Frage im
   *     Begehmodus, wo Fadenkreuz, Steuerkreuz und Auslöser übereinander
   *     liegen: Ein Knopf, über dem ein durchsichtiger Kasten hängt, ist
   *     unbedienbar, und man sieht es ihm nicht an.
   *  2. **Tut er, was er soll?** Der echte Ereignisbehandler wird über
   *     `HTMLElement.click()` ausgelöst — derselbe Weg, den auch eine
   *     Tastaturbedienung nimmt.
   */
  const tippe = async (text) => {
    const lage = await p.evaluate((t) => {
      const treffer = [...document.querySelectorAll('button')].filter((b) =>
        new RegExp(t).test(b.textContent.trim()),
      );
      if (!treffer.length) return { da: false };
      const knopf = treffer[0];
      const r = knopf.getBoundingClientRect();
      /*
       * Geprüft wird die Mitte **und** beide Ränder.
       *
       * Nur die Mitte zu prüfen hat in der Abnahme von 1.23.0 einen
       * echten Fehler durchgelassen: Der Griff zum Aufklappen des
       * Inspektors ist 44 px breit, sitzt fest am rechten Bildschirmrand
       * und lag über der rechten Hälfte zweier Einträge der
       * Werkzeugkiste. Die Mitte war frei, der Daumen traf trotzdem
       * daneben — und zwar reproduzierbar, aber nur auf einem schmaleren
       * Bildschirm als dem der Prüfumgebung.
       */
      const punkte = [
        [r.left + r.width / 2, r.top + r.height / 2],
        [r.left + 6, r.top + r.height / 2],
        [r.right - 6, r.top + r.height / 2],
      ];
      const verdeckt = punkte
        .map(([x, y]) => document.elementFromPoint(x, y))
        .filter((oben) => !(knopf === oben || knopf.contains(oben)));
      const frei = verdeckt.length === 0;
      knopf.click();
      return {
        da: true,
        frei,
        breit: Math.round(r.width),
        hoch: Math.round(r.height),
        daraufliegt: verdeckt[0] ? `${verdeckt[0].tagName} ${(verdeckt[0].textContent ?? '').trim().slice(0, 24)}` : null,
      };
    }, text.source ?? text);
    if (!lage.da) {
      failures += 1;
      console.log(`  ✗ Knopf „${text}" ist nicht da`);
      return lage;
    }
    if (!lage.frei) {
      failures += 1;
      console.log(`  ✗ Knopf „${text}" liegt unter etwas anderem und ist nicht zu treffen — darauf liegt: ${lage.daraufliegt}`);
    }
    await p.waitForTimeout(320);
    return lage;
  };

  /** Ist der Auslöser mit diesem Text da und scharf? */
  const scharfist = async (muster) =>
    p.evaluate(
      (m) => {
        const b = [...document.querySelectorAll('button')].find((b) => new RegExp(m).test(b.textContent));
        return Boolean(b) && !b.className.includes('cursor-not-allowed');
      },
      muster.source ?? muster,
    );

  /*
   * Drehen, bis der Auslöser scharf ist — und zwar **zweimal hintereinander**.
   *
   * Die Zeile am Fadenkreuz wird in ruhigem Takt (8 Hz) aus einem Strahl
   * gegen die Kamera gerechnet, und die Kamera bekommt ihre neue Blickrichtung
   * erst im nächsten *Bild*. In dieser Prüfumgebung rechnet die Grafik in
   * Software; ein Bild kann länger dauern als der Takt. Der Auslöser zeigt
   * dann für einen Augenblick noch das Ziel des **vorigen** Drehschritts.
   *
   * Genau daran ist der erste vollständige Durchlauf gescheitert: Die
   * Prüfung sah einen scharfen Knopf, hörte auf zu drehen — und im nächsten
   * Takt holte die Anzeige die wirkliche Blickrichtung ein, in der keine
   * Wand lag. Zwei Ablesungen mit Pause dazwischen schließen das aus, ohne
   * die Anwendung zu verbiegen: Auf einem Gerät mit Grafikkarte tritt der
   * Rückstand gar nicht erst auf.
   */
  /**
   * Nur warten, nicht drehen.
   *
   * Für die Fälle, in denen der Betrachter schon richtig steht — beim Rohr
   * und beim Beschriften. Dort wäre ein Drehschritt kein Rückfall, sondern
   * das Gegenteil der Prüfung: Er zerstörte gerade die Lage, die geprüft
   * werden soll.
   */
  const warteScharf = async (muster, versuche = 8) => {
    for (let i = 0; i < versuche; i += 1) {
      if (await scharfist(muster)) {
        await p.waitForTimeout(300);
        if (await scharfist(muster)) return true;
      }
      await p.waitForTimeout(300);
    }
    return false;
  };

  const dreheBis = async (muster, schritte = 24) => {
    for (let i = 0; i < schritte; i += 1) {
      if (await scharfist(muster)) {
        await p.waitForTimeout(420);
        if (await scharfist(muster)) return true;
      }
      await p.evaluate(() => {
        window.__raviaGeher.gier += Math.PI / 12;
      });
      await p.waitForTimeout(260);
    }
    return false;
  };

  await p.evaluate(() => window.__ravia.getState().setCameraMode('walk'));
  await p.waitForTimeout(900);

  const geht = await p.evaluate(() => Boolean(window.__raviaGeher));
  expect('Der Begehmodus läuft', geht, true);

  // Die Kiste aufklappen und ein Werkzeug in die Hand nehmen.
  // Der Name des Klappknopfes trägt das Klappzeichen mit — deshalb kein
  // `exact`, sondern ein Anker am Anfang.
  await tippe(/^Werkzeug/);
  await p.waitForTimeout(200);
  const kiste = await p.evaluate(() =>
    [...document.querySelectorAll('button')].map((b) => b.textContent.trim()),
  );
  for (const w of ['Heizkörper', 'Fußbodenheizung', 'Verteiler', 'Speicher', 'Rohr', 'Ventil', 'Durchbruch', 'Beschriften']) {
    expect(`Die Kiste hält „${w}" bereit`, kiste.includes(w), true);
  }

  const masz = await tippe(/^Heizkörper$/);
  await p.waitForTimeout(300);
  /*
   * Das Tippmaß.
   *
   * 44 px ist die Untergrenze, unter der ein Knopf mit dem Daumen nicht mehr
   * zuverlässig zu treffen ist. In der begehbaren Ansicht zählt sie doppelt:
   * Wer daneben tippt, dreht den Blick — und steht danach woanders, als er
   * zielen wollte.
   */
  expect('Die Einträge halten das Tippmaß (≥ 44 px hoch)', (masz.hoch ?? 0) >= 44, true);

  // Die Unterauswahl am Heizkörper — Anschlussart und Ventilseite.
  const unter = await p.evaluate(() =>
    [...document.querySelectorAll('button')].map((b) => b.textContent.trim()),
  );
  expect('Die Anschlussart steht in der Kiste', unter.includes('Mittelanschluss unten'), true);
  expect('Die Ventilseite steht in der Kiste', unter.includes('links') && unter.includes('rechts'), true);
  await tippe(/^Mittelanschluss unten$/);
  await tippe(/^links$/);
  await p.waitForTimeout(200);

  /*
   * Eine Wand suchen, indem gedreht wird.
   *
   * Der Auslöser ist gesperrt, solange das Fadenkreuz keine Wand trifft
   * (ein Heizkörper gehört an eine Wand). Genau daran lässt sich das Zielen
   * prüfen: Wir drehen den Betrachter in Schritten und schauen, wann der
   * Knopf scharf wird. Wird er nie scharf, steht der Betrachter nicht im
   * Haus — auch das wäre ein echter Fehler.
   */
  const scharf = await dreheBis(/Heizkörper setzen/);
  expect('Beim Drehen findet das Fadenkreuz eine Wand', scharf, true);

  if (scharf) {
    const vor = await p.evaluate(() => Object.keys(window.__ravia.getState().doc.fixtures).length);
    const auge = await p.evaluate(() => ({ ...window.__raviaGeher }));
    await tippe(/Heizkörper setzen/);
    await p.waitForTimeout(500);

    const erg = await p.evaluate(() => {
      const s = window.__ravia.getState();
      const alle = Object.values(s.doc.fixtures).filter((f) => f.type === 'radiator');
      const neu = alle[alle.length - 1];
      return {
        zahl: Object.keys(s.doc.fixtures).length,
        pos: neu ? { ...neu.position } : null,
        anschluss: neu?.params.radiatorConnection ?? null,
        hoehe: neu?.elevation ?? null,
        ventil: neu?.params.valveSide ?? null,
        wand: Boolean(neu?.wallId),
        status: s.statusMessage,
      };
    });

    expect('Ein Knopfdruck legt genau ein Bauteil an', erg.zahl - vor, 1);
    expect('Die Anschlussart aus der Kiste steht am Bauteil', erg.anschluss, 'mitte');
    /*
     * **Die Regelhöhe, nicht die Zielhöhe.**
     *
     * Gezielt wird beim Heizkörper aus Augenhöhe auf die Wand; das sind
     * 1,20 bis 1,50 m. Übernähme das Programm diese Zahl als Montagehöhe,
     * hinge der Heizkörper auf Brusthöhe — und die Zahl sähe abgelesen aus,
     * also glaubwürdig. Beim Durchbruch und beim Rohr ist die Ablesung
     * gewollt (das prüfen die beiden Blöcke darunter), hier nicht.
     */
    expect('Die Montagehöhe ist die Regelhöhe, nicht die Zielhöhe', erg.hoehe, 0.15);
    expect('Die Ventilseite aus der Kiste steht am Bauteil', erg.ventil, 'links');
    expect('Der Heizkörper hängt an einer Wand', erg.wand, true);
    if (erg.pos) {
      const weg = Math.hypot(erg.pos.x - auge.x, erg.pos.y - auge.y);
      console.log(`  · Auge (${auge.x.toFixed(2)}|${auge.y.toFixed(2)}) → Bauteil (${erg.pos.x.toFixed(2)}|${erg.pos.y.toFixed(2)}) = ${weg.toFixed(2)} m`);
      /*
       * Das Bauteil steht **vor** dem Betrachter, nicht auf ihm.
       *
       * Der Fehler, den das ausschließt: Wer den Strahl aus der Kameramitte
       * mit der Kameraposition verwechselt, setzt jedes Bauteil dorthin, wo
       * er selbst steht. Im Bild sieht das aus wie „nichts passiert" — man
       * steht ja darin. Ein halber Meter Abstand kann kein Zufall sein.
       */
      expect('Das Bauteil steht vor dem Betrachter, nicht auf ihm', weg > 0.5, true);
    }
    expect('Die Meldung nennt die Anschlussart', /Mittelanschluss/.test(erg.status), true);
    expect('Ein Setzen ist ein Schritt in der Historie', await p.evaluate(async () => {
      const s = window.__ravia.getState();
      const vorher = Object.keys(s.doc.fixtures).length;
      s.undo();
      return vorher - Object.keys(window.__ravia.getState().doc.fixtures).length;
    }), 1);
  }

  /*
   * Der Durchbruch aus der Kiste: Die Höhe muss vom Zielpunkt kommen.
   *
   * Das ist die eigentliche Neuerung gegenüber dem Grundriss — dort wird die
   * Unterkante getippt, hier abgelesen. Geprüft wird deshalb, dass die
   * Unterkante *nicht* der Voreinstellung des Regelmaßes entspricht: 0,30 m
   * stünde dort, wenn die Ablesung stillschweigend übergangen worden wäre.
   */
  await tippe(/^Durchbruch$/);
  await p.waitForTimeout(400);

  /*
   * Den Blick **vor** der Suche senken, nicht danach.
   *
   * Gesenkt wird, damit die Bohrung nicht auf Augenhöhe landet — nur dann
   * ist nachweisbar, dass die Unterkante wirklich abgelesen und nicht aus
   * der Voreinstellung genommen wurde. Senkt man den Blick aber erst,
   * nachdem eine Wand gefunden ist, zeigt das Fadenkreuz danach womöglich
   * auf den **Fußboden** vor der Wand, und der Auslöser ist zu Recht
   * gesperrt. Genau dieser Fehler hat den ersten Durchlauf rot gemacht: Der
   * Knopf war scharf, die Prüfung senkte den Blick, und der Knopf war es
   * nicht mehr.
   */
  await p.evaluate(() => {
    window.__raviaGeher.nick = -0.16;
  });
  await p.waitForTimeout(250);

  const bohrbar = await dreheBis(/Durchbruch in die Wand/);
  expect('Das Fadenkreuz findet eine Wandfläche zum Bohren', bohrbar, true);

  if (bohrbar) {
    await tippe(/Durchbruch in die Wand/);
    await p.waitForTimeout(500);

    const db = await p.evaluate(() => {
      const s = window.__ravia.getState();
      const alle = Object.values(s.doc.durchbrueche ?? {});
      const neu = alle[alle.length - 1];
      return neu
        ? { uk: neu.sillHeight, wand: Boolean(neu.wallId), abstand: neu.distance, status: s.statusMessage }
        : null;
    });
    if (!db) console.log(`  · Meldung: ${await p.evaluate(() => window.__ravia.getState().statusMessage)}`);
    expect('Der Durchbruch entsteht', Boolean(db), true);
    if (db) {
      console.log(`  · Unterkante abgelesen: ${db.uk} m (Voreinstellung wäre 0,3)`);
      expect('Er sitzt in einer Wand', db.wand, true);
      expect('Die Unterkante kommt vom Zielpunkt, nicht aus der Voreinstellung', db.uk !== 0.3, true);
      expect('Die Unterkante liegt über dem Boden', db.uk >= 0, true);
      expect('Die Meldung nennt das Anreißmaß', /ab Wandanfang/.test(db.status), true);
    }
  }

  /*
   * Die Leitung: zwei Auslöser, eine Leitung, und die Höhe vom Zielpunkt.
   *
   * Der Altbaufall — eine Aufputzleitung läuft dort, wo sie läuft. Geprüft
   * wird, dass sie **nicht** auf der Voreinstellung 0,05 m landet.
   */
  await tippe(/^Rohr$/);
  await p.waitForTimeout(400);

  const rohrVor = await p.evaluate(() => Object.keys(window.__ravia.getState().doc.pipes).length);
  const anfangDa = await warteScharf(/Anfang der Leitung setzen/);
  expect('Der Auslöser fragt zuerst nach dem Anfang', anfangDa, true);

  if (anfangDa) {
    await tippe(/Anfang der Leitung setzen/);
    await p.waitForTimeout(300);
    // Wegdrehen, damit Anfang und Ende auseinanderliegen.
    await p.evaluate(() => {
      window.__raviaGeher.gier += Math.PI / 2.2;
    });
    await p.waitForTimeout(400);
    const endeDa = await warteScharf(/Ende setzen/);
    expect('Danach fragt er nach dem Ende, mit Länge', endeDa, true);
    if (endeDa) {
      await tippe(/Ende setzen/);
      await p.waitForTimeout(500);
      const r = await p.evaluate(() => {
        const s = window.__ravia.getState();
        const alle = Object.values(s.doc.pipes);
        const neu = alle[alle.length - 1];
        const paar = neu?.pairId ? alle.filter((x) => x.pairId === neu.pairId) : [neu];
        return {
          zahl: alle.length,
          hoehe: neu?.elevation ?? null,
          hoehenGleich:
            paar.length === 2 &&
            paar[0].elevation === paar[1].elevation &&
            (paar[0].elevationTo ?? null) === (paar[1].elevationTo ?? null),
          status: s.statusMessage,
        };
      });
      /*
       * Auch hier entsteht ein Paar — und beide Rohre tragen dieselbe Höhe.
       *
       * Das ist der Punkt, an dem die Paarkennung sich beweisen muss: Die
       * begehbare Ansicht legt den Zug an und setzt die Höhe unmittelbar
       * danach am *angelegten* Lauf. Ohne das Nachziehen in `updatePipe`
       * blieb der Rücklauf auf der Voreinstellung 0,05 m liegen, während
       * der Vorlauf auf 2,45 m stieg — zwei Rohre in einem Kanal, zwei
       * Meter auseinander, und im Plan von oben nicht zu unterscheiden.
       */
      expect('Ein Paar entsteht', r.zahl - rohrVor, 2);
      console.log(`  · Verlegehöhe abgelesen: ${r.hoehe} m (Voreinstellung wäre 0,05)`);
      expect('Die Verlegehöhe kommt vom Zielpunkt', r.hoehe !== 0.05, true);
      expect('Beide Rohre des Paares liegen auf derselben Höhe', r.hoehenGleich, true);
      /*
       * **Zwei gültige Meldungen, nicht eine.**
       *
       * Seit die Leitung eine zweite Höhe tragen kann, gibt es zwei Fälle,
       * und die Meldung muss sie unterscheiden: Eine waagerechte Leitung
       * nennt ihre Lage („auf Putz" ab 0,20 m, sonst „im Aufbau"); eine
       * geneigte nennt **beide** Höhen („steigt von +0,05 m auf +2,45 m").
       * Die Alternative wäre eine Mittelhöhe gewesen — und die beschreibt
       * einen Steigstrang so, dass niemand merkt, dass es einer ist.
       */
      expect(
        'Die Meldung sagt, ob auf Putz, im Aufbau — oder wie weit sie steigt',
        /(auf Putz|im Aufbau|steigt von|fällt von)/.test(r.status),
        true,
      );

      /*
       * ▸ Der senkrechte Meter.
       *
       * Der Fallstrang in der Zimmerecke: im Grundriss ein Punkt, in
       * Wirklichkeit zweieinhalb Meter Rohr. Bis 1.23.0 gab es ihn nirgends —
       * nicht in der Zeichnung, nicht im Massenauszug, nicht im Druckverlust.
       * Geprüft wird deshalb nicht, ob er sich anlegen lässt, sondern ob er
       * danach in allen drei Zahlen auftaucht.
       */
      const strang = await p.evaluate(() => {
        const s = window.__ravia.getState();
        s.beginGesture();
        const run = s.addPipe('heating-flow', [{ x: 1.2, y: 1.2 }, { x: 1.22, y: 1.2 }]);
        if (!run) return null;
        s.updatePipe(run.id, { elevation: 0.05, elevationTo: 2.45 });
        s.endGesture();
        const d = window.__ravia.getState().doc;
        const r2 = d.pipes[run.id];
        /*
         * **`aus.pipes`, nicht `aus.geometry.pipes`.**
         *
         * Der Block `geometry` führt die **Rohgeometrie** — die
         * `PipeRun`-Objekte, wie sie im Dokument stehen. Eine Länge haben
         * sie gar nicht; sie wird gerechnet. Die gebaute Liste mit Länge,
         * Nennweite und Geschossnamen steht eine Ebene höher. Der erste
         * Entwurf dieser Prüfung sah an der falschen Stelle nach und meldete
         * „Länge null" für eine Leitung, die im Export korrekt stand.
         */
        const aus = window.RaViaCAD.getExport();
        const ex = aus.pipes.find((x) => x.id === run.id);
        const auszug = (aus.pipeSchedule ?? []).find((z) => z.service === 'heating-flow');
        return {
          versatz: Math.round(((r2.elevationTo ?? r2.elevation) - r2.elevation) * 100) / 100,
          trasse: Math.round(Math.hypot(0.02, 0) * 1000) / 1000,
          exportLaenge: ex?.length ?? null,
          exportBis: ex?.elevationTo ?? null,
          auszugSteig: auszug?.riseLength ?? null,
        };
      });
      expect('Der Strang entsteht', Boolean(strang), true);
      if (strang) {
        console.log(`  · Strang: Trasse ${strang.trasse} m, Versatz ${strang.versatz} m → Export ${strang.exportLaenge} m`);
        expect('Er trägt eine zweite Höhe', strang.exportBis, 2.45);
        /*
         * 2,40 m und nicht 0,02 m: Die wahre Länge ist √(Trasse² + Δh²).
         * Stünde hier die Trassenlänge, fehlten dem Besteller zweieinhalb
         * Meter Rohr, und der Druckverlust wäre null.
         */
        expect('Der Export nennt die wahre Länge, nicht die Trasse', strang.exportLaenge, 2.4);
        /*
         * Und der Längenauszug weist den senkrechten Anteil **getrennt** aus.
         * Wer eine Bestellung gegen den Plan prüft, misst dort die Trasse und
         * kommt auf eine kleinere Zahl — die Differenz muss benannt sein,
         * sonst hält er sie für einen Fehler.
         */
        expect('Der Längenauszug weist den senkrechten Anteil aus', (strang.auszugSteig ?? 0) >= 2.3, true);
      }
    }
  }

  /*
   * Beschriften in 3D.
   *
   * **Warum der Betrachter hier gestellt und nicht gedreht wird.** Ein
   * Heizkörper ist ein flacher Kasten an einer Wand; ihn durch blindes
   * Drehen zu finden, wäre ein Glücksspiel, und ein Test, der manchmal
   * gewinnt, prüft nichts. Stattdessen wird der Betrachter davorgestellt und
   * der Blick rechnerisch auf die Mitte des Heizkörpers gesenkt — dieselbe
   * Lage, die ein Mensch einnähme, nur ohne die Sucherei.
   */
  await tippe(/^Heizkörper$/);
  await p.waitForTimeout(300);
  const gesetzt = await dreheBis(/Heizkörper setzen/);
  if (gesetzt) await tippe(/Heizkörper setzen/);

  if (gesetzt) {
    const gesetztId = await p.evaluate(() => {
      const alle = Object.values(window.__ravia.getState().doc.fixtures).filter((f) => f.type === 'radiator');
      return alle[alle.length - 1]?.id ?? null;
    });

    // Vor den Heizkörper stellen und ihn anschauen.
    const steht = await p.evaluate(() => {
      const s = window.__ravia.getState();
      const alle = Object.values(s.doc.fixtures).filter((f) => f.type === 'radiator');
      const hk = alle[alle.length - 1];
      if (!hk) return false;
      // Die Flächennormale des Heizkörpers zeigt in den Raum; seine Drehung
      // ist die Wandrichtung. Zwei Meter davor ist weit genug, dass der
      // Strahl nicht in der Wand endet, und nah genug, dass nichts
      // dazwischenkommt.
      const a = (hk.rotation * Math.PI) / 180;
      const nx = -Math.sin(a);
      const ny = Math.cos(a);
      for (const vz of [1, -1]) {
        const px = hk.position.x + nx * 2 * vz;
        const py = hk.position.y + ny * 2 * vz;
        const raum = Object.values(s.doc.rooms).some((r) => {
          const poly = r.innerPolygon ?? r.polygon;
          if (!poly || poly.length < 3) return false;
          let drin = false;
          for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
            if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) drin = !drin;
          }
          return drin;
        });
        if (!raum && vz === 1) continue;
        window.__raviaGeher.x = px;
        window.__raviaGeher.y = py;
        window.__raviaGeher.gier = Math.atan2(hk.position.y - py, hk.position.x - px);
        const mitte = hk.elevation + 0.3;
        window.__raviaGeher.nick = Math.atan2(mitte - 1.65, 2);
        return true;
      }
      return false;
    });
    expect('Der Betrachter steht vor dem Heizkörper', steht, true);
    await p.waitForTimeout(500);

    await tippe(/^Beschriften$/);
    await p.waitForTimeout(400);
    const trifft = await warteScharf(/Werte zur Auswahl/);
    expect('Das Fadenkreuz erkennt das Bauteil', trifft, true);
    const gezielt = await p.evaluate(() => {
      const c = document.querySelector('canvas').getBoundingClientRect();
      return window.__raviaTreffer(c.x + c.width / 2, c.y + c.height / 2);
    });
    console.log(`  · Fadenkreuz trifft ${gezielt?.fixtureId ?? '—'} auf ${gezielt?.hoehe ?? '—'} m`);

    if (trifft) {
      await tippe(/Werte zur Auswahl/);
      await p.waitForTimeout(400);
      const liste = await p.evaluate(() =>
        [...document.querySelectorAll('button')].map((b) => b.textContent.trim()),
      );
      expect('Die Werteliste bietet die Leistung an', liste.some((t) => /^1200 W/.test(t)), true);
      expect('Die Werteliste bietet die Höhe über FFB an', liste.some((t) => /\+0,\d\d m/.test(t)), true);
      /*
       * **Kein Textfeld.** Genau das ist die Festlegung: Es wird nicht
       * getippt, sondern aus dem gewählt, was das Modell weiß. Ein
       * Eingabefeld an dieser Stelle wäre der Rückfall in die frei
       * erfundene Zahl, die still veraltet.
       */
      const felder = await p.evaluate(() => document.querySelectorAll('input[type=text], textarea').length);
      expect('Es gibt an dieser Stelle kein Textfeld zum Tippen', felder, 0);

      await tippe(/^1200 W/);
      await p.waitForTimeout(400);
      const fahne = await p.evaluate(() => {
        const s = window.__ravia.getState();
        const alle = Object.values(s.doc.annotations);
        const neu = alle[alle.length - 1];
        return neu
          ? {
              art: neu.kind,
              text: neu.text,
              hoehe: neu.elevation,
              anker: neu.anchor?.kind ?? null,
              ankerId: neu.anchor?.id ?? null,
              quelle: neu.anchor?.quelle ?? null,
              status: s.statusMessage,
            }
          : null;
      });
      expect('Die Fahne entsteht', Boolean(fahne), true);
      /*
       * **Sie hängt an *diesem* Heizkörper, nicht an irgendeinem.**
       *
       * Ohne diese Prüfung wäre der ganze Block auch dann grün, wenn der
       * Strahl durch die Wand hindurch das Bauteil im Nachbarzimmer
       * erwischte — die Vorgabeleistung ist dort dieselbe 1200 W. Genau
       * dieser Fall war bis 1.22.0 möglich: Die Gruppe der anfassbaren
       * Objekte hatte Vorrang vor der Entfernung.
       */
      expect('Sie hängt an dem Heizkörper, den wir gesetzt haben', fahne?.ankerId, gesetztId);
      if (fahne) {
        expect('Sie ist eine Hinweisfahne', fahne.art, 'leader');
        expect('Sie trägt den Modellwert', fahne.text, '1200 W');
        expect('Sie hängt am Bauteil', fahne.anker, 'fixture');
        expect('Sie weiß, woher der Wert stammt', fahne.quelle, 'leistung');
        expect('Sie hat eine Höhe über FFB', typeof fahne.hoehe === 'number' && fahne.hoehe > 0, true);
        expect('Die Meldung nennt die Höhe', /\+\d,\d\d m/.test(fahne.status), true);
      }

      /*
       * Und der Nachweis, dass die Höhe im **Grundriss** ankommt: Der
       * Plantext hängt sie an. Ohne diesen Schritt wäre die Fahne eine
       * Angabe, die nur in der 3D-Ansicht existiert — und der Plan ist das,
       * was auf die Baustelle geht.
       */
      const planzeile = await p.evaluate(() => {
        const s = window.__ravia.getState();
        const alle = Object.values(s.doc.annotations);
        const neu = alle[alle.length - 1];
        return neu ? `${neu.text} · ${neu.elevation}` : '';
      });
      console.log(`  · Fahne im Modell: ${planzeile}`);

      // Veralten und Nachziehen: Der Modellwert ändert sich, die Abschrift
      // nicht — und das muss auffallen.
      const veraltet = await p.evaluate(() => {
        const s = window.__ravia.getState();
        const alle = Object.values(s.doc.annotations);
        const note = alle[alle.length - 1];
        const hkId = note?.anchor?.id;
        if (!hkId) return null;
        const hk = s.doc.fixtures[hkId];
        s.updateFixture(hkId, { params: { ...hk.params, powerW: 1600 } });
        const nach = window.__ravia.getState().doc.annotations[note.id];
        return { text: nach.text, leistung: window.__ravia.getState().doc.fixtures[hkId].params.powerW };
      });
      expect('Die Abschrift ändert sich nicht von selbst', veraltet?.text, '1200 W');
      expect('Das Modell trägt den neuen Wert', veraltet?.leistung, 1600);
    }
  }

  await p.evaluate(() => window.__ravia.getState().setCameraMode('orbit'));
  await p.waitForTimeout(300);
  const abgelegt = await p.evaluate(() =>
    [...document.querySelectorAll('button')].some((b) => /^Werkzeug/.test(b.textContent.trim())),
  );
  expect('Beim Herausgehen verschwindet die Kiste', abgelegt, false);
}

console.log('\nERRORS:', errs.length ? errs.join('\n') : 'keine');
if (errs.length) failures += errs.length;
console.log(`\n${failures === 0 ? '✓ RAUCHTEST BESTANDEN' : `✗ ${failures} FEHLER`}\n`);
await b.close();
process.exit(failures === 0 ? 0 : 1);
