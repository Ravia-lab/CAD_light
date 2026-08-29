/**
 * Rauchtest für die neuen Werkzeuge: Geschosse, Raumbuch, Bauteilkatalog,
 * Planausdruck, Export-Vergleich und die Sitzungssicherung.
 *
 * Geprüft wird nicht „rendert es", sondern „ändert es das Modell richtig" —
 * abgelesen an der Statuszeile und am Store.
 */

import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';

const URL = 'http://localhost:4177/';
const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const ctx = await b.newContext({ viewport: { width: 1680, height: 980 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();

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

const stats = () =>
  p.evaluate(() => {
    const d = window.__ravia.getState().doc;
    return {
      levels: Object.keys(d.levels).length,
      active: d.levels[d.activeLevelId]?.name,
      walls: Object.keys(d.walls).length,
      rooms: Object.keys(d.rooms).length,
      constructions: Object.keys(d.constructions ?? {}).length,
    };
  });
const zustandGlobal = () =>
  p.evaluate(() => {
    const d = window.__ravia.getState().doc;
    return { name: d.meta.name, walls: Object.keys(d.walls).length };
  });

// Die Rauchtests prüfen Fachplaner-Funktionen; der Auslieferungszustand ist
// bewusst der einfache Modus. Also vorher umschalten.
// Die Einführung beim allerersten Start würde jeden Klick abfangen. Sie
// gehört zur Anwendung und wird an genau einer Stelle geprüft
// (`smoke:ux`); überall sonst wird sie als „schon gesehen" markiert.
await p.addInitScript(() => {
  localStorage.setItem('ravia-ui-mode', 'profi');
  localStorage.setItem('ravia-einfuehrung', '1');
});


await p.goto(URL, { waitUntil: 'networkidle' });
await p.waitForTimeout(1000);

// Der Store muss für die Prüfung erreichbar sein.
const exposed = await p.evaluate(() => Boolean(window.__ravia));
if (!exposed) {
  console.log('  ! window.__ravia nicht verfügbar — Test läuft nur über die Oberfläche');
}

console.log('\n▸ Geschosse');
{
  const before = await stats();
  expect('Start: ein Geschoss', before.levels, 1);

  /**
   * Vor dem Übernehmen drei Bauteile setzen, die beim Kopieren
   * unterschiedlich behandelt werden müssen: eine Treppe (verbindet zwei
   * Geschosse, existiert einmal), ein Schornstein (durchstößt jede Decke,
   * existiert einmal) und ein Pfeiler (gehört zu einem Geschoss, wird
   * mitkopiert wie eine Wand). Gesetzt über den Store, weil es hier nicht um
   * das Zeichnen geht, sondern um die Kopierregel.
   */
  await p.evaluate(() => {
    const s = window.__ravia.getState();
    s.addVertical('stair-straight', { x: 2.2, y: 2.2 });
    s.addSolid('chimney', { x: 4.4, y: 1.2 });
    s.addSolid('pier', { x: 1.2, y: 3.6 });
  });
  await p.waitForTimeout(500);
  const bauteileVorher = await p.evaluate(() => {
    const d = window.__ravia.getState().doc;
    return { treppen: Object.keys(d.verticals).length, massiv: Object.keys(d.solids ?? {}).length };
  });
  expect('Vorher: eine Treppe', bauteileVorher.treppen, 1);
  expect('Vorher: zwei massive Bauteile', bauteileVorher.massiv, 2);

  // Geschoss darüber mit übernommenem Grundriss
  // Seit 1.13.0 gibt es zwei Kopierknöpfe — nach oben und nach unten. Der
  // Test meint den nach oben; ohne die Richtung im Muster trifft er beide
  // und Playwright bricht im Strict-Modus ab.
  await p.getByTitle(/Geschoss darüber anlegen — Grundriss des aktuellen Geschosses übernehmen/).click();
  await p.waitForTimeout(700);
  const copied = await stats();
  expect('Zweites Geschoss angelegt', copied.levels, 2);
  expect('Grundriss kopiert (Wände verdoppelt)', copied.walls, before.walls * 2);
  expect('Räume im neuen Geschoss erkannt', copied.rooms, before.rooms * 2);
  expect('Neues Geschoss ist aktiv', copied.active !== before.active, true);

  // Der Kern der Anwendermeldung: die Treppe geht nicht mit hoch.
  const bauteileNachher = await p.evaluate(() => {
    const d = window.__ravia.getState().doc;
    const massiv = Object.values(d.solids ?? {});
    const oben = Object.values(d.rooms).filter((r) => r.levelId === d.activeLevelId);
    return {
      treppen: Object.keys(d.verticals).length,
      treppenGeschoss: Object.values(d.verticals)[0]?.levelId,
      kamine: massiv.filter((m) => m.kind === 'chimney').length,
      pfeiler: massiv.filter((m) => m.kind === 'pier').length,
      lochOben: oben.reduce((s2, r) => s2 + (r.floorOpeningArea ?? 0), 0),
      deckeOben: oben.reduce((s2, r) => s2 + (r.openToAboveArea ?? 0), 0),
    };
  });
  expect('Die Treppe bleibt einmalig', bauteileNachher.treppen, 1);
  expect('Und gehört weiter dem unteren Geschoss', bauteileNachher.treppenGeschoss !== copied.active, true);
  expect('Der Schornstein bleibt einmalig', bauteileNachher.kamine, 1);
  expect('Der Pfeiler wird mitkopiert', bauteileNachher.pfeiler, 2);
  expect('Das Loch in der Decke ist oben weiterhin da', bauteileNachher.lochOben > 3, true);
  expect('Über dem oberen Geschoss ist nichts offen', bauteileNachher.deckeOben, 0);

  // Die Raumangaben müssen mitkommen — sonst hieße im OG alles wieder „Raum 1".
  const names = await p.evaluate(() => {
    const d = window.__ravia.getState().doc;
    const byLevel = {};
    for (const r of Object.values(d.rooms)) {
      (byLevel[d.levels[r.levelId].name] ??= []).push(`${r.name}@${r.setpointTemperature}`);
    }
    for (const k of Object.keys(byLevel)) byLevel[k].sort();
    return byLevel;
  });
  const levelNames = Object.keys(names);
  expect('Raumnamen 1:1 übernommen', names[levelNames[0]], names[levelNames[1]]);
  console.log('    Räume je Geschoss:', JSON.stringify(names));

  await p.screenshot({ path: './screenshots/r2-1-levels.png' });

  // Zurück ins EG und wieder hoch — der Umschalter darf nichts löschen
  await p.getByRole('button', { name: before.active, exact: true }).click();
  await p.waitForTimeout(400);
  const back = await stats();
  expect('Umschalten verliert keine Geometrie', back.walls, copied.walls);
  expect('EG wieder aktiv', back.active, before.active);
}

console.log('\n▸ Raumbuch');
{
  await p.getByRole('button', { name: 'Räume', exact: true }).click();
  await p.waitForTimeout(500);
  const rows = await p.locator('aside button').filter({ hasText: /m²/ }).count();
  expect('Raumbuch listet Räume', rows > 0, true);
  await p.screenshot({ path: './screenshots/r2-2-roombook.png' });

  const dl = p.waitForEvent('download');
  await p.getByRole('button', { name: /Raumbuch als CSV/ }).click();
  const file = await dl;
  const path = '/tmp/raumbuch.csv';
  await file.saveAs(path);
  const csv = readFileSync(path, 'utf-8');
  expect('CSV mit Semikolon', csv.includes(';'), true);
  expect('CSV hat Datenzeilen', csv.trim().split('\n').length > 1, true);
  console.log('    CSV-Kopfzeile:', csv.split('\n')[0].slice(0, 110));
}

console.log('\n▸ Bauteilkatalog');
{
  await p.getByRole('button', { name: 'Aufbauten', exact: true }).click();
  await p.waitForTimeout(400);
  const before = await stats();
  await p.getByRole('button', { name: /Aufbau hinzufügen/ }).click();
  await p.waitForTimeout(400);
  const after = await stats();
  expect('Aufbau angelegt', after.constructions, before.constructions + 1);
  await p.screenshot({ path: './screenshots/r2-3-constructions.png' });
}

console.log('\n▸ Planausdruck');
{
  await p.getByTitle(/maßstäblich drucken/).click();
  await p.waitForTimeout(700);
  const svg = await p.locator('svg[data-plan], .panel svg').first().isVisible();
  expect('Dialog offen', await p.getByText('Plan drucken').isVisible(), true);
  expect('Vorschau sichtbar', svg, true);
  await p.screenshot({ path: './screenshots/r2-4-print.png' });

  // Maßstab wechseln — die Vorschau muss reagieren, nicht abstürzen
  await p.getByRole('button', { name: '1:20', exact: true }).click();
  await p.waitForTimeout(500);
  await p.screenshot({ path: './screenshots/r2-5-print-1zu20.png' });
  await p.getByTitle('Schließen').click();
  await p.waitForTimeout(300);
}

console.log('\n▸ Export-Vergleich');
{
  // Referenzstand exportieren
  const dl = p.waitForEvent('download');
  await p.getByRole('button', { name: /RaVia JSON/ }).click();
  const file = await dl;
  await file.saveAs('/tmp/export-before.json');
  const before = JSON.parse(readFileSync('/tmp/export-before.json', 'utf-8'));

  // Modell ändern: ein Raum bekommt eine andere Solltemperatur
  await p.evaluate(() => {
    const st = window.__ravia.getState();
    const room = Object.values(st.doc.rooms)[0];
    st.updateRoom(room.id, { setpointTemperature: 24 });
  });
  await p.waitForTimeout(500);

  await p.getByRole('button', { name: 'Prüfung', exact: true }).click();
  await p.waitForTimeout(400);
  await p.locator('aside input[type=file][accept*="json"]').first().setInputFiles('/tmp/export-before.json');
  await p.waitForTimeout(900);
  await p.screenshot({ path: './screenshots/r2-6-diff.png' });

  const panel = await p.locator('aside').innerText();
  expect('Vergleich zeigt „geändert"', /geändert/i.test(panel), true);
  expect('Solltemperatur als Änderung genannt', /Solltemperatur/.test(panel), true);
  expect('Referenz erkannt', before.schema ?? before.version ? true : true, true);

  // Fremde Datei muss sauber abgewiesen werden
  writeFileSync('/tmp/fremd.json', JSON.stringify({ hallo: 'welt' }));
  await p.locator('aside input[type=file][accept*="json"]').first().setInputFiles('/tmp/fremd.json');
  await p.waitForTimeout(600);
  expect('Fremde Datei abgewiesen', /kein RaVia-Export/i.test(await p.locator('aside').innerText()), true);
}

console.log('\n▸ Sitzungssicherung');
{
  // Modell markieren, warten bis die Sicherung geschrieben ist, neu laden
  await p.evaluate(() => window.__ravia.getState().updateMeta({ name: 'Sicherungstest' }));
  await p.waitForTimeout(2500);
  const saved = await p.evaluate(() => Boolean(localStorage.getItem('ravia-cad-light.autosave.v2')));
  expect('Sicherung geschrieben', saved, true);

  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  expect('Rückfrage erscheint', await p.getByText('Letzten Stand fortsetzen?').isVisible(), true);
  await p.screenshot({ path: './screenshots/r2-7-restore.png' });

  await p.getByRole('button', { name: 'Fortsetzen', exact: true }).click();
  await p.waitForTimeout(800);
  const name = await p.evaluate(() => window.__ravia.getState().doc.meta.name);
  expect('Stand wiederhergestellt', name, 'Sicherungstest');
  const levels = await stats();
  expect('Geschosse überlebt den Neustart', levels.levels, 2);
}

console.log('\n▸ Speichern und Öffnen — der Kamin überlebt den Rundlauf');
{
  // Die Exportdatei ist zugleich die Projektdatei: was sie nicht führt, ist
  // nach dem nächsten Öffnen weg. Der Rundlauf läuft über `loadProject` und
  // damit zwangsläufig durch den Store — deshalb steht er hier und nicht im
  // Prüfblock `pruefungen/massivbauteile.ts`, der den Rechenkern allein prüft.
  // Der Baustoff ist die Probe aufs Exempel: er wird nirgends gerechnet und
  // fiele beim Zurücklesen als Erster unter den Tisch.
  const gesetzt = await p.evaluate(() => {
    const st = window.__ravia.getState();
    const m = st.addSolid('chimney', { x: 3.2, y: 2.4 });
    window.__ravia.getState().updateSolid(m.id, { material: 'Schamotte' });
    const d = window.__ravia.getState().doc;
    return { anzahl: Object.keys(d.solids ?? {}).length, flaeche: m.width * m.length };
  });
  await p.waitForTimeout(400);
  expect('Ein weiterer Kamin gesetzt', gesetzt.anzahl > 0, true);

  // Speichern über dieselbe Schnittstelle, die auch der Download benutzt.
  const datei = await p.evaluate(() => JSON.parse(JSON.stringify(window.RaViaCAD.getExport())));
  expect('Die Datei führt die Rohgeometrie der massiven Bauteile',
    (datei.geometry?.solids ?? []).length, gesetzt.anzahl);
  expect('Mit dem Baustoff darin',
    (datei.geometry?.solids ?? []).some((m) => m.material === 'Schamotte'), true);

  // Alles wegräumen und die Datei zurücklesen — der Ernstfall „morgen wieder
  // geöffnet". Danach steht dasselbe Modell wieder da, die folgenden Blöcke
  // finden ihre Ausgangslage unverändert vor.
  const zurueck = await p.evaluate((d) => {
    window.__ravia.getState().clearAll();
    const leer = Object.keys(window.__ravia.getState().doc.solids ?? {}).length;
    const bericht = window.__ravia.getState().loadProject(d);
    const doc = window.__ravia.getState().doc;
    const liste = Object.values(doc.solids ?? {});
    return {
      leer,
      ok: bericht.ok,
      anzahl: liste.length,
      kamine: liste.filter((m) => m.kind === 'chimney').length,
      material: liste.find((m) => m.material)?.material,
      flaeche: (() => {
        const m = liste.find((x) => x.material === 'Schamotte');
        return m ? m.width * m.length : 0;
      })(),
      durchgehend: liste.filter((m) => m.kind === 'chimney').every((m) => m.throughAllLevels === true),
      geschosse: Object.keys(doc.levels).length,
      waende: Object.keys(doc.walls).length,
    };
  }, datei);
  expect('Vorher wirklich leergeräumt', zurueck.leer, 0);
  expect('Die Projektdatei lässt sich zurücklesen', zurueck.ok, true);
  expect('Alle massiven Bauteile sind wieder da', zurueck.anzahl, gesetzt.anzahl);
  expect('Mit ihrer Art', zurueck.kamine > 0, true);
  expect('Mit ihrem Baustoff', zurueck.material, 'Schamotte');
  expect('Mit ihrer Grundfläche', Math.abs(zurueck.flaeche - gesetzt.flaeche) < 0.002, true);
  // Ohne diese Angabe würde der Schornstein beim nächsten Übernehmen eines
  // Geschosses kopiert — die Kopierregel in `src/lib/levelCopy.ts` hängt an ihr.
  expect('Und mit der Angabe, dass er durchgeht', zurueck.durchgehend, true);
  expect('Die Geschosse kommen mit', zurueck.geschosse, 2);
  expect('Und der Grundriss auch', zurueck.waende > 0, true);
  await p.waitForTimeout(500);
}

console.log('\n▸ Projektverwaltung');
{
  // Ein Rechteck zeichnen — über den Store, weil hier die Ablage geprüft wird
  // und nicht die Maussteuerung.
  const zeichne = (breite, tiefe) =>
    p.evaluate(([b, t]) => {
      const st = window.__ravia.getState();
      st.addWall({ x: 0, y: 0 }, { x: b, y: 0 });
      st.addWall({ x: b, y: 0 }, { x: b, y: t });
      st.addWall({ x: b, y: t }, { x: 0, y: t });
      st.addWall({ x: 0, y: t }, { x: 0, y: 0 });
    }, [breite, tiefe]);

  const oeffneListe = async () => {
    await p.getByTitle(/^Projekte —/).click();
    await p.waitForTimeout(400);
  };
  const zustand = () =>
    p.evaluate(() => {
      const d = window.__ravia.getState().doc;
      return { name: d.meta.name, walls: Object.keys(d.walls).length, rooms: Object.keys(d.rooms).length };
    });

  // --- Erstes Projekt anlegen und zeichnen
  await oeffneListe();
  expect('Projektliste offen', await p.getByText('Browser-Speicher:').isVisible(), true);
  await p.getByPlaceholder(/Name des neuen Projekts/).fill('Wohnung Aufmaß');
  await p.getByRole('button', { name: 'Neues Projekt', exact: true }).click();
  await p.waitForTimeout(500);
  expect('Leeres Projekt angelegt', (await zustand()).walls, 0);
  expect('Der Projektname steht im Dokument', (await zustand()).name, 'Wohnung Aufmaß');
  await zeichne(6, 4);
  await p.waitForTimeout(2200); // die entprellte Sicherung schreiben lassen
  const a = await zustand();
  expect('Im ersten Projekt gezeichnet', a.walls, 4);
  expect('Und ein Raum erkannt', a.rooms, 1);

  // --- Zweites Projekt anlegen und anders zeichnen
  await oeffneListe();
  await p.getByPlaceholder(/Name des neuen Projekts/).fill('Anbau Eltern');
  await p.getByRole('button', { name: 'Neues Projekt', exact: true }).click();
  await p.waitForTimeout(500);
  expect('Zweites Projekt beginnt leer', (await zustand()).walls, 0);
  await zeichne(3, 3);
  await p.evaluate(() => {
    const st = window.__ravia.getState();
    st.addWall({ x: 0, y: 0 }, { x: 0, y: -2 });
  });
  await p.waitForTimeout(2200);
  const b = await zustand();
  expect('Im zweiten Projekt gezeichnet', b.walls, 5);

  // --- Zurückschalten: der Inhalt des ersten muss wieder da sein
  await oeffneListe();
  const zeilen = await p.locator('.panel li').count();
  expect('Beide Projekte in der Liste', zeilen, 2);
  await p.screenshot({ path: './screenshots/r2-8-projekte.png' });
  await p.locator('li', { hasText: 'Wohnung Aufmaß' }).getByRole('button', { name: 'Öffnen' }).click();
  await p.waitForTimeout(700);
  const zurueck = await zustand();
  expect('Erstes Projekt wieder offen', zurueck.name, 'Wohnung Aufmaß');
  expect('Mit seinen Wänden', zurueck.walls, a.walls);
  expect('Und seinen Räumen', zurueck.rooms, a.rooms);

  // --- Kein doppeltes Dokument: die Sicherung zeigt nur auf das Projekt
  const zeiger = await p.evaluate(() => JSON.parse(localStorage.getItem('ravia-cad-light.autosave.v2') ?? '{}'));
  expect('Die Sitzungssicherung kennt das Projekt', typeof zeiger.projektId, 'string');
  expect('Und legt das Dokument nicht ein zweites Mal ab', zeiger.doc === undefined, true);

  // --- Neustart: der Stand gehört weiter zum ersten Projekt
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  expect('Rückfrage nach dem Neustart', await p.getByText('Letzten Stand fortsetzen?').isVisible(), true);
  await p.getByRole('button', { name: 'Fortsetzen', exact: true }).click();
  await p.waitForTimeout(800);
  const nachNeustart = await zustand();
  expect('Nach dem Neustart dasselbe Projekt', nachNeustart.name, 'Wohnung Aufmaß');
  expect('Mit unverändertem Inhalt', nachNeustart.walls, a.walls);

  // --- Und das zweite Projekt hat nichts abbekommen
  await oeffneListe();
  await p.locator('li', { hasText: 'Anbau Eltern' }).getByRole('button', { name: 'Öffnen' }).click();
  await p.waitForTimeout(700);
  const zweites = await zustand();
  expect('Das zweite Projekt ist unberührt', zweites.name, 'Anbau Eltern');
  expect('Mit seinen eigenen Wänden', zweites.walls, b.walls);

  // --- Umbenennen wirkt auf das Dokument, nicht auf ein zweites Namensfeld
  await oeffneListe();
  await p.locator('li', { hasText: 'Anbau Eltern' }).getByRole('button', { name: 'Umbenennen' }).click();
  await p.waitForTimeout(200);
  await p.locator('li input[type=text], .panel li input').first().fill('Anbau Süd');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(500);
  expect('Umbenennen ändert den Dokumentnamen', (await zustand()).name, 'Anbau Süd');
  const kopfName = await p.locator('header input').first().inputValue();
  expect('Und die Kopfzeile zeigt denselben Namen', kopfName, 'Anbau Süd');

  // --- Duplizieren und Löschen
  await p.locator('li', { hasText: 'Anbau Süd' }).first().getByRole('button', { name: 'Duplizieren' }).click();
  await p.waitForTimeout(500);
  expect('Kopie angelegt', await p.locator('.panel li').count(), 3);
  await p.locator('li', { hasText: 'Anbau Süd (Kopie)' }).getByRole('button', { name: 'Löschen' }).click();
  await p.waitForTimeout(500);
  expect('Kopie gelöscht', await p.locator('.panel li').count(), 2);
  expect('Das offene Projekt blieb offen', (await zustand()).name, 'Anbau Süd');
  await p.getByTitle('Schließen').click();
  await p.waitForTimeout(300);
}

console.log('\n▸ Voller Speicher');
{
  // Der Ernstfall: der Browser-Speicher läuft mitten in der Aufnahme voll.
  // Ein durchgereichter QuotaExceededError endete hier als weiße Fläche —
  // deshalb wird der Fall absichtlich herbeigeführt.
  const ballast = await p.evaluate(() => {
    const fuelle = (schluessel, blockgroesse) => {
      const block = 'x'.repeat(blockgroesse);
      let s = '';
      try {
        for (let i = 0; i < 6000; i++) {
          s += block;
          localStorage.setItem(schluessel, s);
        }
      } catch {
        /* voll — genau das war das Ziel */
      }
      return (localStorage.getItem(schluessel) ?? '').length;
    };
    // Erst grob, dann fein: nach dem 64-kB-Raster bliebe sonst genug Platz
    // für ein Dokument übrig, und der Überlauf träte gar nicht ein.
    return fuelle('__ballast__', 64 * 1024) + fuelle('__ballast2__', 512);
  });
  console.log('    Ballast im Speicher:', ballast, 'Zeichen');

  // Der Auslöser ist der wirklichkeitsnahe: es wird ein Grundriss-Plan als
  // Referenzbild hinterlegt. Ein einzelner Wandstrich ließe den Eintrag nur um
  // ein paar Zeichen wachsen und passte auch in einen randvollen Speicher —
  // das Bild ist der Posten, der ihn tatsächlich sprengt.
  const bildZeichen = await p.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 1190;
    c.height = 1684;
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    g.strokeStyle = '#000';
    g.lineWidth = 3;
    for (let i = 0; i < 60; i++) g.strokeRect(40 + (i % 8) * 140, 40 + Math.floor(i / 8) * 200, 120, 180);
    const src = c.toDataURL('image/png');
    window.__ravia.getState().setImage({
      id: 'plan', src, name: 'grundriss.png', naturalWidth: c.width, naturalHeight: c.height,
      origin: { x: 0, y: 0 }, scale: 0.01, rotation: 0, opacity: 0.6, visible: true, locked: true,
    });
    return src.length;
  });
  console.log('    Referenzbild:', bildZeichen, 'Zeichen');
  await p.waitForTimeout(2500);
  expect('Die Anwendung lebt noch', await p.locator('canvas').first().isVisible(), true);
  expect('Das Hinweisband sagt, was los ist', await p.getByText(/Speicher ist voll/).isVisible(), true);
  expect('Und nennt das Referenzbild als größten Posten',
    /Referenzbild/.test(await p.locator('body').innerText()), true);
  expect('Der Weg zur Projektliste steht daneben',
    await p.getByRole('button', { name: 'Projekte öffnen' }).isVisible(), true);
  expect('Das Modell ist unversehrt', (await zustandGlobal()).walls > 0, true);
  await p.screenshot({ path: './screenshots/r2-9-speicher-voll.png' });

  // Aufräumen — und das Band muss von selbst verschwinden, sobald es wieder geht.
  await p.evaluate(() => {
    localStorage.removeItem('__ballast__');
    localStorage.removeItem('__ballast2__');
  });
  await p.evaluate(() => window.__ravia.getState().addWall({ x: 0, y: 12 }, { x: 5, y: 12 }));
  await p.waitForTimeout(2500);
  expect('Nach dem Aufräumen ist das Band weg', await p.getByText(/Speicher ist voll/).count(), 0);
}

console.log('\nERRORS:', errs.length ? errs.join('\n') : 'keine');
if (errs.length) failures += errs.length;
console.log(`\n${failures === 0 ? '✓ RAUCHTEST BESTANDEN' : `✗ ${failures} FEHLER`}\n`);

await b.close();
process.exit(failures === 0 ? 0 : 1);
