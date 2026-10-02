/**
 * Rauchtest „Nutzungseinheiten".
 *
 * **Worum es geht.** § 60c Abs. 1 GModG knüpft die Pflicht zum hydraulischen
 * Abgleich an „sechs Wohnungen oder sonstige selbständige Nutzungseinheiten".
 * Diese Zahl stand bisher nur als getippte Angabe im Anlagenblatt. Ab 1.66.0
 * zählt sie das Modell — und damit hängt an dieser Kette eine Rechtsfolge.
 *
 * Der Prüfblock `scripts/pruefungen/nutzungseinheiten.ts` prüft die Regeln:
 * was zählt, was nicht, und was „nicht erfasst" heißt. Hier läuft die **Kette
 * durch das Programm**, weil genau dort die Fehler sitzen, die eine Regel
 * nicht sieht:
 *
 *  1. Anlegen und Zuordnen über den Store — mit dem Namensvorschlag.
 *  2. Ein ganzes Geschoss in einem Schritt zuordnen.
 *  3. Der Widerspruch zur getippten Zahl **wird gemeldet** und lässt sich mit
 *     einem Griff auflösen.
 *  4. Die Übergabe an RaVia trägt `occupancyUnits`, `occupancy` und
 *     `rooms[].occupancyUnitId`.
 *  5. **Speichern und Öffnen:** Die Zuordnung ist am Raum, Räume werden beim
 *     Öffnen neu erkannt — die Zuordnung muss trotzdem zurückkommen. Das ist
 *     der Weg, auf dem eine Angabe am Raum still verloren geht.
 *  6. Eine gelöschte Einheit lässt keine Zuordnung zurück, die ins Leere zeigt.
 *
 * Mit `RAVIA_PROBE=<url>` läuft der Test gegen einen echten Server.
 */

import { chromium } from 'playwright';

const BASIS = process.env.RAVIA_PROBE ?? 'http://localhost:4177/';
const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const p = await b.newPage({ viewport: { width: 1600, height: 950 } });
const errs = [];
p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });

let failures = 0;
const expect = (label, actual, expected, tol = 0) => {
  const ok = typeof actual === 'number' && typeof expected === 'number'
    ? Math.abs(actual - expected) <= tol
    : JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? '✓' : '✗'} ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (erwartet ${JSON.stringify(expected)})`}`);
};

await p.addInitScript(() => {
  localStorage.clear();
  localStorage.setItem('ravia-einfuehrung', '1');
  localStorage.setItem('ravia-ui-mode', 'profi');
});
await p.goto(BASIS, { waitUntil: 'networkidle' });
await p.waitForTimeout(1200);
await p.evaluate(() => window.__ravia.getState().loadDemo());
await p.waitForTimeout(900);

console.log('\n▸ Vorher — im Demo ist keine Einheit erfasst');
const vorher = await p.evaluate(() => {
  const s = window.__ravia.getState();
  return {
    einheiten: Object.keys(s.doc.units ?? {}).length,
    raeume: Object.keys(s.doc.rooms).length,
  };
});
expect('Keine Einheiten', vorher.einheiten, 0);
expect('Drei Räume', vorher.raeume, 3);

console.log('\n▸ Keine Meldung, solange nichts erfasst ist');
/*
 * Die Gegenprobe zuerst: Eine Meldung „keine Nutzungseinheit erfasst" stünde
 * in jedem Einfamilienhaus und wäre damit wertlos.
 */
const leer = await p.evaluate(() => {
  const ex = window.RaViaCAD.getExport();
  return {
    codes: ex.validation.issues.filter((i) => i.code.startsWith('units.')).map((i) => i.code),
    einheitenBlock: 'occupancyUnits' in ex,
    standBlock: 'occupancy' in ex,
  };
});
expect('Kein Befund zu Einheiten', leer.codes, []);
expect('Und kein Block im Export', leer.einheitenBlock, false);
expect('Auch keine Zusammenzählung', leer.standBlock, false);

console.log('\n▸ Zwei Wohnungen anlegen und zuordnen');
const angelegt = await p.evaluate(() => {
  const s = window.__ravia.getState();
  const w1 = s.neueEinheit('wohnung');
  const w2 = s.neueEinheit('wohnung');
  const d = window.__ravia.getState().doc;
  const raeume = Object.values(d.rooms);
  // Zwei Räume in die erste Wohnung, einen in die zweite.
  window.__ravia.getState().ordneRaumEinheitZu(raeume[0].id, w1);
  window.__ravia.getState().ordneRaumEinheitZu(raeume[1].id, w1);
  window.__ravia.getState().ordneRaumEinheitZu(raeume[2].id, w2);
  const nach = window.__ravia.getState().doc;
  return {
    namen: Object.values(nach.units ?? {}).map((e) => e.name),
    zuordnungen: Object.values(nach.rooms).filter((r) => r.unitId).length,
    w1,
    w2,
  };
});
expect('Fortlaufend benannt', angelegt.namen, ['Wohnung 1', 'Wohnung 2']);
expect('Alle drei Räume zugeordnet', angelegt.zuordnungen, 3);

console.log('\n▸ Der Stand im Export');
const mit = await p.evaluate(() => {
  const ex = window.RaViaCAD.getExport();
  return {
    einheiten: ex.occupancyUnits.length,
    namen: ex.occupancyUnits.map((e) => e.name),
    arten: ex.occupancyUnits.map((e) => e.kind),
    raeumeJeEinheit: ex.occupancyUnits.map((e) => e.roomIds.length),
    selbstaendig: ex.occupancy.independent,
    schwelle: ex.occupancy.threshold,
    pflicht: ex.occupancy.balancingRequired,
    amRaum: ex.rooms.filter((r) => typeof r.occupancyUnitId === 'string').length,
    // Die Fläche der ersten Einheit ist die Summe ihrer beiden Räume.
    flaecheEins: Math.round(ex.occupancyUnits[0].area * 100) / 100,
    summeIhrerRaeume:
      Math.round(
        ex.rooms
          .filter((r) => r.occupancyUnitId === ex.occupancyUnits[0].id)
          .reduce((s, r) => s + r.area, 0) * 100,
      ) / 100,
    fassung: ex.version,
  };
});
expect('Zwei Einheiten im Export', mit.einheiten, 2);
expect('Mit ihren Namen', mit.namen, ['Wohnung 1', 'Wohnung 2']);
expect('Als Wohnungen', mit.arten, ['dwelling', 'dwelling']);
expect('Zwei und ein Raum', mit.raeumeJeEinheit, [2, 1]);
expect('Zwei selbständige Einheiten', mit.selbstaendig, 2);
expect('Die Schwelle steht bei sechs', mit.schwelle, 6);
expect('Zwei lösen keine Pflicht aus', mit.pflicht, false);
expect('Die Zuordnung steht auch am Raum', mit.amRaum, 3);
/*
 * **Die Gegenprobe gegen eine falsche Summe.** Die Fläche der Einheit muss
 * dieselbe sein wie die Summe der Räume, die auf sie zeigen — gerechnet auf
 * zwei verschiedenen Wegen, aus `occupancyUnits` und aus `rooms`.
 */
expect('Einheitsfläche = Summe ihrer Räume', mit.flaecheEins, mit.summeIhrerRaeume, 0.02);
expect('Exportfassung 2.13.0', mit.fassung, '2.13.0');

console.log('\n▸ Der Widerspruch zur getippten Zahl');
/*
 * Das Anlagenblatt des Demoprojekts nennt eine Wohneinheit, gezählt sind
 * zwei. Genau dieser Widerspruch lief bisher unbemerkt in Trinkwasserbedarf,
 * Speichergröße und Gefäßauslegung.
 */
const widerspruch = await p.evaluate(() => {
  const s = window.__ravia.getState();
  s.updatePlant({ dhw: { units: 1 } });
  const ex = window.RaViaCAD.getExport();
  return {
    codes: ex.validation.issues.filter((i) => i.code.startsWith('units.')).map((i) => i.code),
    deklariert: ex.occupancy.declared,
    gezaehlt: ex.occupancy.independent,
  };
});
expect('Der Widerspruch wird gemeldet', widerspruch.codes.includes('units.count-mismatch'), true);
expect('Die getippte Zahl steht im Export', widerspruch.deklariert, 1);
expect('Daneben die gezählte', widerspruch.gezaehlt, 2);

const aufgeloest = await p.evaluate(() => {
  const r = window.__ravia.getState().uebernehmeEinheitenzahl();
  const ex = window.RaViaCAD.getExport();
  return {
    gezaehlt: r.gezaehlt,
    getippt: ex.occupancy.declared,
    codes: ex.validation.issues.filter((i) => i.code === 'units.count-mismatch').length,
  };
});
expect('Aus dem Modell übernommen', aufgeloest.gezaehlt, 2);
expect('Jetzt stehen beide auf zwei', aufgeloest.getippt, 2);
expect('Und die Meldung ist weg', aufgeloest.codes, 0);

console.log('\n▸ Speichern und wieder öffnen');
/*
 * Der Weg, auf dem eine Angabe am Raum still verloren geht: Räume werden beim
 * Öffnen **neu erkannt**, ihre Kennung kann sich dabei ändern. Die Zuordnung
 * muss über die Geometrie zurückfinden.
 */
const rund = await p.evaluate(() => {
  const ex = window.RaViaCAD.getExport();
  const datei = JSON.parse(JSON.stringify(ex));
  const r = window.__ravia.getState().loadProject(datei);
  const d = window.__ravia.getState().doc;
  const zuordnung = {};
  for (const raum of Object.values(d.rooms)) {
    if (raum.unitId) zuordnung[d.units[raum.unitId].name] = (zuordnung[d.units[raum.unitId].name] ?? 0) + 1;
  }
  return {
    ok: r.ok,
    einheiten: Object.values(d.units ?? {}).map((e) => e.name).sort(),
    arten: Object.values(d.units ?? {}).map((e) => e.art).sort(),
    zuordnung,
    // Keine Zuordnung darf auf eine Einheit zeigen, die es nicht gibt.
    verwaist: Object.values(d.rooms).filter((raum) => raum.unitId && !d.units?.[raum.unitId]).length,
  };
});
expect('Geladen', rund.ok, true);
expect('Die Einheiten sind wieder da', rund.einheiten, ['Wohnung 1', 'Wohnung 2']);
expect('Mit ihrer Art', rund.arten, ['wohnung', 'wohnung']);
expect('Und die Räume wieder bei ihnen', rund.zuordnung, { 'Wohnung 1': 2, 'Wohnung 2': 1 });
expect('Keine Zuordnung ins Leere', rund.verwaist, 0);

console.log('\n▸ Ein ganzes Geschoss in einem Schritt');
const geschoss = await p.evaluate(() => {
  const s = window.__ravia.getState();
  // Alle Zuordnungen lösen, dann das Geschoss in einem Griff zuordnen.
  const d0 = s.doc;
  for (const raum of Object.values(d0.rooms)) s.ordneRaumEinheitZu(raum.id, undefined);
  const einheitId = Object.keys(window.__ravia.getState().doc.units)[0];
  const levelId = Object.values(window.__ravia.getState().doc.rooms)[0].levelId;
  const gezaehlt = window.__ravia.getState().ordneGeschossEinheitZu(levelId, einheitId);
  const nochmal = window.__ravia.getState().ordneGeschossEinheitZu(levelId, einheitId);
  const d = window.__ravia.getState().doc;
  return {
    gezaehlt,
    // Ein zweiter Griff darf nichts mehr finden — sonst zählte er doppelt.
    nochmal,
    zugeordnet: Object.values(d.rooms).filter((r) => r.unitId === einheitId).length,
  };
});
expect('Drei Räume in einem Schritt', geschoss.gezaehlt, 3);
expect('Der zweite Griff findet nichts mehr', geschoss.nochmal, 0);
expect('Und alle hängen an derselben Einheit', geschoss.zugeordnet, 3);

console.log('\n▸ Eine Einheit löschen');
const geloescht = await p.evaluate(() => {
  const s = window.__ravia.getState();
  const einheitId = Object.keys(s.doc.units)[0];
  s.loescheEinheit(einheitId);
  const d = window.__ravia.getState().doc;
  return {
    einheiten: Object.keys(d.units ?? {}).length,
    // **Der Kern:** Kein Raum zeigt noch auf die gelöschte Einheit. Ein Raum,
    // der zugeordnet aussieht und nirgends mitzählt, ist der stillste Fehler.
    verwaist: Object.values(d.rooms).filter((r) => r.unitId === einheitId).length,
    ohne: Object.values(d.rooms).filter((r) => !r.unitId).length,
  };
});
expect('Eine Einheit übrig', geloescht.einheiten, 1);
expect('Keine Zuordnung zeigt ins Leere', geloescht.verwaist, 0);
expect('Die Räume sind wieder frei', geloescht.ohne, 3);

console.log('\n▸ Heizkreise je Wohnung');
/*
 * Der Fall, auf den sich die RaVia-Seite am 01.10.2026 festgelegt hat:
 * zentrale Versorgung, **Heizkreise je Wohnung**. Die Zuordnung Kreis →
 * Einheit ist abgeleitet (Kreis → Räume → Einheit) und steht nicht am Kreis;
 * geprüft wird, dass sie im Export ankommt — und dass ein Kreis über zwei
 * Wohnungen **nicht** stillschweigend einer davon zugeschlagen wird.
 */
const kreise = await p.evaluate(() => {
  const s = window.__ravia.getState();
  const d = s.doc;
  const raeume = Object.values(d.rooms);
  const einheiten = Object.keys(d.units);
  // Erst jeden Raum einer eigenen Einheit zuordnen: drei Räume, zwei Einheiten.
  s.ordneRaumEinheitZu(raeume[0].id, einheiten[0]);
  s.ordneRaumEinheitZu(raeume[1].id, einheiten[0]);
  const zweite = s.neueEinheit('wohnung');
  window.__ravia.getState().ordneRaumEinheitZu(raeume[2].id, zweite);
  // Ein Kreis je Wohnung, und ein dritter quer über beide.
  window.__ravia.getState().setPlantCircuits([
    { id: 'k-a', label: 'Wohnung A', kind: 'radiator', roomIds: [raeume[0].id, raeume[1].id],
      flowTemperature: 55, returnTemperature: 45, material: 'verbund', mixed: false },
    { id: 'k-b', label: 'Wohnung B', kind: 'radiator', roomIds: [raeume[2].id],
      flowTemperature: 55, returnTemperature: 45, material: 'verbund', mixed: false },
    { id: 'k-quer', label: 'Quer', kind: 'radiator', roomIds: [raeume[1].id, raeume[2].id],
      flowTemperature: 55, returnTemperature: 45, material: 'verbund', mixed: false },
  ]);
  const ex = window.RaViaCAD.getExport();
  const k = Object.fromEntries((ex.plant?.circuits ?? []).map((c) => [c.id, c]));
  const befunde = ex.validation.issues.filter((i) => i.code === 'units.circuit-across-units');
  return {
    a: k['k-a']?.occupancyUnitId === einheiten[0],
    b: k['k-b']?.occupancyUnitId === zweite,
    // **Der Kern:** Der Kreis über beide Wohnungen hat **keine** eindeutige
    // Einheit, sondern nennt beide.
    querEindeutig: k['k-quer']?.occupancyUnitId,
    querBeide: (k['k-quer']?.occupancyUnitIds ?? []).length,
    befunde: befunde.length,
    befundText: befunde[0]?.message ?? '',
    // Und von der anderen Seite: je Einheit die Kreise.
    kreiseErsteEinheit: (ex.occupancyUnits.find((u) => u.id === einheiten[0])?.circuitIds ?? []).sort(),
  };
});
expect('Kreis A hängt an Wohnung 1', kreise.a, true);
expect('Kreis B an der zweiten Wohnung', kreise.b, true);
expect('Der Kreis über beide hat keine eindeutige Einheit', kreise.querEindeutig, undefined);
expect('Er nennt stattdessen beide', kreise.querBeide, 2);
expect('Und wird als Befund gemeldet', kreise.befunde, 1);
expect('Die Meldung nennt beide Wohnungen', /2 Nutzungseinheiten/.test(kreise.befundText), true);
expect('Je Einheit stehen ihre Kreise', kreise.kreiseErsteEinheit, ['k-a', 'k-quer']);

console.log('\n▸ Die Zuordnung am Raum, über die Oberfläche');
/*
 * Der Weg, den der Anwender geht: Raum auswählen, Einheit im Auswahlfeld
 * setzen. Die Store-Aktion ist oben geprüft — hier geht es darum, dass das
 * Feld überhaupt da ist und auf den richtigen Raum wirkt.
 */
const vorAuswahl = await p.evaluate(() => {
  const s = window.__ravia.getState();
  const r = Object.values(s.doc.rooms)[0];
  s.setSelection({ kind: 'room', id: r.id });
  return { einheiten: Object.keys(s.doc.units ?? {}).length, namen: Object.values(s.doc.units ?? {}).map((e) => e.name) };
});
await p.waitForTimeout(500);
const feld = p.locator('select').filter({ hasText: 'keine' }).first();
expect('Das Auswahlfeld ist da', await p.getByText('Nutzungseinheit', { exact: true }).count() > 0, true);

// „+ Neue Wohnung …" legt an **und** ordnet zu — in einem Griff.
await feld.selectOption('neu:wohnung');
await p.waitForTimeout(500);
const ueberOberflaeche = await p.evaluate(() => {
  const d = window.__ravia.getState().doc;
  const gewaehlt = window.__ravia.getState().selection;
  const raum = d.rooms[gewaehlt.id];
  return {
    einheiten: Object.keys(d.units ?? {}).length,
    name: raum.unitId ? d.units[raum.unitId].name : undefined,
    // Nur **dieser** Raum, nicht alle.
    zugeordnet: Object.values(d.rooms).filter((r) => r.unitId === raum.unitId).length,
  };
});
expect('Eine Einheit dazu', ueberOberflaeche.einheiten, vorAuswahl.einheiten + 1);
/*
 * Der Name wird **fortlaufend** vergeben und über gelöschte Nummern hinweg
 * weitergezählt — zwei verschiedene Wohnungen dürfen im Schriftverkehr nicht
 * gleich heißen. Geprüft wird deshalb die Regel und nicht die Zahl: ein
 * Wohnungsname, den es noch nicht gab.
 */
expect('Es ist eine Wohnung', /^Wohnung \d+$/.test(ueberOberflaeche.name ?? ''), true);
expect('Mit einem Namen, den es noch nicht gab', vorAuswahl.namen.includes(ueberOberflaeche.name), false);
expect('Und nur der gewählte Raum hängt daran', ueberOberflaeche.zugeordnet, 1);

console.log('\n▸ Nichts in der Konsole');
expect('Keine Fehler im Browser', errs.slice(0, 3), []);

await b.close();
console.log(failures ? `\n✗ ${failures} Prüfung(en) fehlgeschlagen` : '\n✓ Nutzungseinheiten: alles in Ordnung');
process.exit(failures ? 1 : 0);
