/**
 * Rauchtest „Geschosse": Speichern und Öffnen eines mehrgeschossigen Projekts.
 *
 * Gemeldet am 22.09.2026: Nach Speichern und Öffnen heißen die oberen
 * Geschosse „Raum 1, Raum 2 …", der Keller ist beheizt, und die Heizlast des
 * Obergeschosses steht im Erdgeschoss. Ursache war die Zuordnung über den
 * Schwerpunkt über alle Geschosse hinweg (siehe `src/lib/raumZuordnung.ts`).
 *
 * Hier derselbe Weg durch die Oberfläche: Demo laden, zwei Geschosse darüber
 * kopieren, je Geschoss die Räume benennen, beheizt/unbeheizt setzen, eine
 * Heizlast eintragen — dann über `getExport()` speichern und über
 * `loadProject()` wieder öffnen. Danach muss jeder Wert dort stehen, wo er
 * hingehört.
 *
 * Mit `RAVIA_PROBE=<url>` läuft der Test gegen einen echten Server.
 */

import { chromium } from 'playwright';

const BASIS = process.env.RAVIA_PROBE ?? 'http://localhost:4177/';
const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
const errs = [];
p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
p.on('console', (m) => { if (m.type() === 'error' && !/ERR_CONNECTION_RESET/.test(m.text())) errs.push(m.text()); });

let failures = 0;
const expect = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? '✓' : '✗'} ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (erwartet ${JSON.stringify(expected)})`}`);
};

await p.addInitScript(() => {
  localStorage.clear();
  localStorage.setItem('ravia-einfuehrung', '1');
  localStorage.setItem('ravia-ui-mode', 'profi');
});
await p.goto(BASIS, { waitUntil: 'networkidle' });
await p.waitForTimeout(1500);

console.log('\n▸ Drei Geschosse anlegen und beschriften');
const vorher = await p.evaluate(() => {
  const S = () => window.__ravia.getState();
  S().loadDemo();
  // Aus dem Demo-Erdgeschoss ein KG darunter und ein OG darüber kopieren.
  const eg = S().doc.activeLevelId;
  const og = S().addLevel({ copyFrom: eg, name: 'OG' });
  const kg = S().addLevel({ copyFrom: eg, name: 'KG', below: true });
  S().setActiveLevel(eg);
  const namen = { [eg]: ['EG-Wohnen', 'EG-Küche', 'EG-Bad'], [og.id]: ['OG-Schlafen', 'OG-Kind', 'OG-Bad'], [kg.id]: ['KG-Keller', 'KG-Technik', 'KG-Lager'] };
  const stand = {};
  for (const [levelId, liste] of Object.entries(namen)) {
    // So wie im Raumbuch: Wer einen Raum eines anderen Geschosses anfasst,
    // wechselt zuerst dorthin.
    S().setActiveLevel(levelId);
    const raeume = Object.values(S().doc.rooms)
      .filter((r) => r.levelId === levelId)
      .sort((a, b2) => b2.area - a.area);
    raeume.forEach((r, i) => {
      if (!liste[i]) return;
      S().updateRoom(r.id, {
        name: liste[i],
        // Der Keller ist unbeheizt — genau der Wert, der beim Öffnen umsprang.
        isHeated: !levelId.includes(String(liste[i]).startsWith('KG') ? liste[i] : '\u0000') && !String(liste[i]).startsWith('KG'),
        setpointTemperature: String(liste[i]).startsWith('KG') ? 10 : String(liste[i]).endsWith('Bad') ? 24 : 20,
      });
      // Eine „von RaVia gerechnete" Heizlast, je Raum verschieden.
      S().setzeRaumHeizleistung(r.id, 500 + i * 100 + (levelId === og.id ? 1000 : levelId === kg.id ? 2000 : 0));
    });
  }
  for (const r of Object.values(S().doc.rooms)) {
    stand[r.name] = {
      level: S().doc.levels[r.levelId].name,
      beheizt: r.isHeated,
      soll: r.setpointTemperature,
      watt: Object.values(S().doc.fixtures).filter((f) => f.roomId === r.id).reduce((s, f) => s + (f.params.powerW ?? 0), 0),
    };
  }
  return { stand, geschosse: Object.keys(S().doc.levels).length, raeume: Object.keys(S().doc.rooms).length };
});
expect('Drei Geschosse', vorher.geschosse, 3);
expect('Neun Räume', vorher.raeume, 9);
expect('KG-Keller ist unbeheizt', vorher.stand['KG-Keller']?.beheizt, false);

console.log('\n▸ Speichern und wieder öffnen');
const nachher = await p.evaluate(() => {
  const S = () => window.__ravia.getState();
  const datei = JSON.parse(JSON.stringify(window.RaViaCAD.getExport()));
  S().neuesDokument('Leer');
  const erg = S().loadProject(datei);
  const stand = {};
  for (const r of Object.values(S().doc.rooms)) {
    stand[r.name] = {
      level: S().doc.levels[r.levelId].name,
      beheizt: r.isHeated,
      soll: r.setpointTemperature,
      watt: Object.values(S().doc.fixtures).filter((f) => f.roomId === r.id).reduce((s, f) => s + (f.params.powerW ?? 0), 0),
    };
  }
  return { ok: erg.ok, stand, namenlos: Object.values(S().doc.rooms).filter((r) => /^Raum \d+$/.test(r.name)).length };
});
expect('Die Datei lädt', nachher.ok, true);
expect('Kein Raum heißt wieder „Raum n"', nachher.namenlos, 0);
for (const name of Object.keys(vorher.stand)) {
  expect(`„${name}" steht wieder im ${vorher.stand[name].level}`, nachher.stand[name]?.level ?? 'fehlt', vorher.stand[name].level);
}
expect('Der Keller ist weiterhin unbeheizt', nachher.stand['KG-Keller']?.beheizt, false);
const feld = (stand, was) => Object.keys(stand).sort().map((k) => `${k}=${stand[k][was]}`).join(' · ');
expect('Die Solltemperaturen stehen richtig', feld(nachher.stand, 'soll'), feld(vorher.stand, 'soll'));
expect('Die Heizlasten sind bei ihrem Raum geblieben', feld(nachher.stand, 'watt'), feld(vorher.stand, 'watt'));

console.log('\n▸ Nichts in der Konsole');
expect('Keine Fehler im Browser', errs.slice(0, 3), []);

await b.close();
console.log(failures ? `\n✗ ${failures} Prüfung(en) fehlgeschlagen` : '\n✓ Geschosse: alles in Ordnung');
process.exit(failures ? 1 : 0);
