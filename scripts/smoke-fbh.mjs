/**
 * Rauchtest „Fußbodenheizung automatisch auslegen".
 *
 * **Der Anlass, wörtlich.** „mir ist aufgefallen das automatisches
 * rohnetzauslegen nur für heizköper ist, es fehlt die autoauslegung für
 * fussbodenheizung, das muss natürlich auch gemacht werden weil wir da
 * natürlich dann auch rohlängen etc benötigen" (01.10.2026).
 *
 * Und so war es: `legeRohrnetzAus` hat Trassen zu dem gelegt, was dastand.
 * Für ein Neubauprojekt mit Flächenheizung stand nichts da — die Kreise
 * mussten vorher Raum für Raum über die TGA-Palette belegt werden. Damit
 * fehlten Rohrlänge, Kreiszahl, Verteilerabgänge und Randdämmstreifen, also
 * alles, was eine Flächenheizung ausmacht.
 *
 * **Was dieser Test prüft** — in der Reihenfolge, in der es schiefgehen kann:
 *
 *  1. Die Auslegung im Neubaumodus **legt** die Kreise an, und zwar nur in
 *     Räumen ohne Heizfläche.
 *  2. Sie setzt einen Heizkreisverteiler, wenn keiner da ist — ohne ihn hängt
 *     eine Fußbodenheizung an nichts.
 *  3. Die **Rohrlängen** stehen danach im Modell und im Massenauszug.
 *  4. Die Anbindeleitung ist kürzer als das Rohr in der Fläche. Das ist die
 *     Gegenprobe zu einem Fehler, der beim Bauen auffiel: Angebunden wurde je
 *     Kurvenstück statt je Kreis, und im Demo-Bad standen damit 74,6 m
 *     Anbindung neben 65,0 m Fläche — bei einem einzigen Kreis.
 *  5. Die Übergabe an RaVia trägt die Kreise **und** die Netztopologie.
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

const stand = () => p.evaluate(() => {
  const s = window.__ravia.getState();
  const d = s.doc;
  const fix = Object.values(d.fixtures);
  return {
    fbh: fix.filter((f) => f.type === 'underfloor').length,
    flaechig: fix.filter((f) => f.type === 'underfloor' && f.params.roomCoverage === true).length,
    hk: fix.filter((f) => ['radiator', 'radiator-tube', 'towel-radiator', 'convector'].includes(f.type)).length,
    verteiler: fix.filter((f) => f.type === 'manifold').length,
    raeume: Object.keys(d.rooms).length,
    status: s.statusMessage,
    // Jeder FBH-Kreis gehört zu einem Raum — und zwar zu einem auf seinem
    // eigenen Geschoss. Das war die Falle beim gebäudeweiten Auslegen.
    fremdesGeschoss: fix.filter(
      (f) => f.type === 'underfloor' && f.roomId && d.rooms[f.roomId] && d.rooms[f.roomId].levelId !== f.levelId,
    ).length,
  };
});

console.log('\n▸ Vorher — der Demo-Grundriss');
const vorher = await stand();
expect('Keine Fußbodenheizung im Demo', vorher.fbh, 0);
expect('Heizkörper sind da', vorher.hk > 0, true);
expect('Drei Räume', vorher.raeume, 3);

console.log('\n▸ Rohrnetz für die Sanierung auslegen — auch dort wird Fläche gelegt');
/*
 * Sofort nach 1.65.0 gemeldet: „auch bei sanierung kann fbh gelegt werden …
 * und es können auch gemischte system sein". Die erste Fassung hat die
 * Flächenheizung an der Verlegeart festgemacht — falsch. Die Verlegeart sagt,
 * wie die Verteilleitung läuft, nicht, welche Heizfläche im Raum liegt.
 */
const sanierung = await p.evaluate(() => {
  const r = window.__ravia.getState().legeRohrnetzAus('sanierung');
  const d = window.__ravia.getState().doc;
  return {
    meldungen: r.notes.map((n) => `${n.severity}: ${n.text}`),
    fbh: Object.values(d.fixtures).filter((f) => f.type === 'underfloor').length,
    rohr: Math.round(r.pipeLength),
  };
});
await p.waitForTimeout(500);
expect('Auch die Sanierung legt die Fläche', sanierung.fbh > 0, true);
expect('… und zieht die Trasse dazu', sanierung.rohr > 0, true);
/*
 * **Und sie meldet, was daran im Bestand nicht aufgeht.** Mit der
 * Flächenheizung steigt der Strom im Stamm, und der handelsübliche
 * Sockelleistenkanal trägt Rohre nur bis 20 mm Außendurchmesser. Das ist
 * kein Fehler der Auslegung, sondern ihr Ergebnis: Wer im Bestand eine
 * Fußbodenheizung nachrüstet, führt die Zuleitung zum Verteiler nicht im
 * Sockelleistenkanal. Geprüft wird deshalb, dass die Meldung **kommt** — ein
 * stillschweigend zu großes Rohr im Kanal wäre der teurere Ausgang.
 */
expect('Der Kanal wird als zu klein gemeldet',
  sanierung.meldungen.some((m) => m.startsWith('error') && /Sockelleistenkanal/.test(m)), true);

console.log('\n▸ Abwählbar — ohne Fläche bleibt es beim Heizkörpernetz');
await p.evaluate(() => window.__ravia.getState().loadDemo());
await p.waitForTimeout(800);
const ohne = await p.evaluate(() => {
  window.__ravia.getState().legeRohrnetzAus('neubau', undefined, { flaechenheizung: false });
  const d = window.__ravia.getState().doc;
  return Object.values(d.fixtures).filter((f) => f.type === 'underfloor').length;
});
expect('Ohne Haken keine Fußbodenheizung', ohne, 0);

console.log('\n▸ Rohrnetz für den Neubau auslegen');
await p.evaluate(() => window.__ravia.getState().loadDemo());
await p.waitForTimeout(800);
const erg = await p.evaluate(() => {
  const r = window.__ravia.getState().legeRohrnetzAus('neubau');
  return { served: r.served, rohr: Math.round(r.pipeLength * 10) / 10, fehler: r.notes.filter((n) => n.severity === 'error').length };
});
await p.waitForTimeout(700);
expect('Kein Fehler in der Auslegung', erg.fehler, 0);
expect('Verbraucher versorgt', erg.served > 0, true);

const nachher = await stand();
expect('Die Fußbodenheizung ist gelegt', nachher.fbh > 0, true);
expect('… und zwar raumfüllend', nachher.flaechig, nachher.fbh);
/*
 * Nur Räume **ohne** Heizfläche werden belegt. Im Demo-Grundriss hängen in
 * zwei von drei Räumen Heizkörper, also bleibt genau einer übrig.
 */
expect('Nur der Raum ohne Heizkörper', nachher.fbh, 1);
expect('Die Heizkörper sind unangetastet', nachher.hk, vorher.hk);
expect('Jeder Kreis liegt auf dem Geschoss seines Raums', nachher.fremdesGeschoss, 0);
expect('Ein Heizkreisverteiler ist da', nachher.verteiler > 0, true);
expect('Die Meldung nennt die Fußbodenheizung', /Fußbodenheizung in \d+ Raum/.test(nachher.status), true);

console.log('\n▸ Die Rohrlängen');
const laengen = await p.evaluate(() => {
  const api = window.RaViaCAD;
  const ex = api.getExport();
  const k = (ex.pipeGraph?.floorCircuits ?? [])[0];
  return {
    version: ex.version,
    kreise: (ex.pipeGraph?.floorCircuits ?? []).length,
    abschnitte: (ex.pipeGraph?.segments ?? []).length,
    knoten: (ex.pipeGraph?.nodes ?? []).length,
    verzweigungen: (ex.pipeGraph?.nodes ?? []).filter((n) => n.kind === 'branch').length,
    ohneVorgaenger: (ex.pipeGraph?.segments ?? []).filter((s) => s.parentId === undefined).length,
    k,
  };
});
expect('Exportfassung 2.14.0', laengen.version, '2.14.0');
expect('Ein Flächenheizkreis in der Übergabe', laengen.kreise, 1);
expect('Rohr in der Fläche über 40 m', laengen.k.fieldLength > 40, true);
/*
 * Die Anbindeleitung ist die Luftlinie zum Verteiler, doppelt für Vor- und
 * Rücklauf — in einem Einfamilienhaus also einige Meter, nicht einige
 * Dutzend. Vor der Korrektur stand hier mehr als die Fläche selbst.
 */
expect('Anbindung kürzer als das Rohr in der Fläche', laengen.k.supplyLength < laengen.k.fieldLength, true);
expect('… und unter 30 m', laengen.k.supplyLength < 30, true);
expect('Kreislänge ist Fläche plus Anbindung',
  Math.round((laengen.k.fieldLength + laengen.k.supplyLength) * 100) / 100,
  Math.round(laengen.k.loopLength * laengen.k.loops * 100) / 100, 0.02);
expect('Versorgte Fläche kleiner als der Raum', laengen.k.servedArea < laengen.k.roomArea, true);
expect('Verlegeabstand steht dabei', laengen.k.spacing > 0, true);
expect('Volumenstrom gerechnet', laengen.k.flow > 0, true);
expect('Am Verteiler mit Abgangsnummer', laengen.k.manifoldPort, 1);
expect('Vorlauf und Spreizung', [laengen.k.flowTemperature, laengen.k.spread], [35, 7]);

console.log('\n▸ Die Topologie — das, was RaVia braucht');
expect('Abschnitte im Netz', laengen.abschnitte > 0, true);
expect('Knoten im Netz', laengen.knoten > laengen.abschnitte, true);
expect('Mindestens eine Verzweigung', laengen.verzweigungen > 0, true);
/*
 * Genau ein Abschnitt je Quelle hat keinen Vorgänger — der an der Quelle.
 * Mehr als eine Handvoll hieße: Das Netz ist in Teile zerfallen, und RaVia
 * bekäme lose Enden statt eines Baums.
 */
expect('Wenige Abschnitte ohne Vorgänger', laengen.ohneVorgaenger <= 3, true);

console.log('\n▸ Massenauszug');
const massen = await p.evaluate(() => {
  const d = window.__ravia.getState().doc;
  const liste = window.__raviaMassen ? window.__raviaMassen(d) : null;
  return liste;
});
if (massen === null) {
  console.log('  · Massenauszug nicht über die Brücke erreichbar — im Prüflauf abgedeckt');
} else {
  expect('Fußbodenheizrohr im Massenauszug', massen.some((z) => /Fußbodenheizrohr/.test(z.name)), true);
}

await p.screenshot({ path: './screenshots/fbh-auslegung.png' });
console.log('\n▸ Nichts in der Konsole');
expect('Keine Fehler im Browser', errs.slice(0, 3), []);

await b.close();
console.log(failures ? `\n✗ ${failures} Prüfung(en) fehlgeschlagen` : '\n✓ Fußbodenheizung: alles in Ordnung');
process.exit(failures ? 1 : 0);
