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
import { PNG } from 'pngjs';

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

console.log('\n▸ Steigleitung: Wärmepumpe und Speicher im KG, Heizkörper darüber');
{
  const r = await p.evaluate(() => {
    const S = () => window.__ravia.getState();
    const d0 = S().doc;
    const kg = Object.values(d0.levels).find((l) => l.name === 'KG');
    const eg = Object.values(d0.levels).find((l) => l.name === 'EG');
    const og = Object.values(d0.levels).find((l) => l.name === 'OG');
    // Technikraum im Keller: Pufferspeicher, dazu die Wärmepumpe im Garten.
    S().setActiveLevel(kg.id);
    const raumKg = Object.values(S().doc.rooms).filter((x) => x.levelId === kg.id).sort((a2, b2) => b2.area - a2.area)[0];
    S().addFixture('storage', { x: raumKg.centroid.x, y: raumKg.centroid.y }, { params: { volumeL: 300 } });
    S().addHeatPump({ x: -3, y: 2 });
    // Heizkörper in EG und OG, keiner im Keller.
    for (const lvl of [eg, og]) {
      S().setActiveLevel(lvl.id);
      for (const raum of Object.values(S().doc.rooms).filter((x) => x.levelId === lvl.id)) {
        S().setzeRaumHeizleistung(raum.id, 800);
      }
    }
    S().setActiveLevel(eg.id);
    const erg = S().legeRohrnetzAus('sanierung', 'ring');
    const d = S().doc;
    const rohre = Object.values(d.pipes).filter((x) => x.service === 'heating-flow');
    const straenge = rohre.filter((x) => (x.label ?? '').startsWith('Steigleitung'));
    const proGeschoss = {};
    for (const x of rohre) {
      const name = d.levels[x.levelId].name;
      proGeschoss[name] = (proGeschoss[name] ?? 0) + 1;
    }
    return {
      geschosse: erg.geschosse.map((g) => `${g.name}:${g.served}`).sort(),
      straenge: erg.straenge.map((x) => `${d.levels[x.vonLevelId].name}→${d.levels[x.nachLevelId].name}`),
      stroeme: erg.straenge.map((x) => x.strom),
      rohreProGeschoss: proGeschoss,
      strangRohre: straenge.length,
      senkrecht: straenge.every((x) => x.elevationTo !== undefined && Math.abs(x.elevationTo - x.elevation) > 1),
      fehler: erg.notes.filter((n) => n.severity === 'error').map((n) => n.text.slice(0, 100)),
      status: S().statusMessage,
    };
  });
  console.log(`  · ${r.status}`);
  expect('Drei Geschosse geplant', r.geschosse.length, 3);
  /*
   * **Von unten nach oben**, wie ein Strang gebaut und gelesen wird.
   *
   * Hier stand bis 1.56.0 ['EG→OG', 'KG→EG'] — die Reihenfolge, in der
   * gerechnet wird: das oberste Geschoss zuerst, damit jeder Abschnitt
   * weiß, was über ihm hängt. Diese Zusage hat die Schnittstelle nie
   * gegeben; sie sagt „von unten nach oben". Der Rauchtest hatte die
   * Rechenreihenfolge abgeschrieben statt die zugesagte zu prüfen.
   */
  expect('Zwei Strangabschnitte, von unten nach oben', r.straenge, ['KG→EG', 'EG→OG']);
  expect('Je Strang ein Vorlauf (Rücklauf paarweise dazu)', r.strangRohre, 2);
  expect('Die Stränge stehen senkrecht', r.senkrecht, true);
  /*
   * Der untere Strang trägt EG und OG, der obere nur das OG. Seit die Liste
   * von unten nach oben steht, lässt sich das an der **Reihenfolge**
   * festmachen statt am Größenvergleich zweier unsortierter Zahlen — und
   * damit prüft es zugleich, dass die Sortierung stimmt.
   */
  expect('Der untere Strang trägt mehr als der obere', r.stroeme[0] > r.stroeme[1], true);
  expect('Auf jedem Geschoss liegen Rohre', Object.keys(r.rohreProGeschoss).sort(), ['EG', 'KG', 'OG']);
  expect('Kein Befund der Stufe Fehler', r.fehler, []);
  await p.evaluate(() => { const S = window.__ravia.getState(); S.setTool('select'); S.setSelection(null); });
  await p.waitForTimeout(300);
  await p.locator('main canvas').first().screenshot({ path: './screenshots/geschosse-steigleitung.png' });
}

console.log('\n▸ Der Rohrnetzbericht zeigt alle Geschosse');
{
  /*
   * Gemeldet am 27.09.2026: „das liegt bei der Rohrnetzberechnung, das zeigt
   * nur 1 Etage". Bis 1.57.0 zeichnete der Bericht genau einen Grundriss,
   * und zwar den des aktiven Geschosses — in einem Haus mit Keller also den
   * Bericht über eine Anlage, von der man zwei Drittel nicht sieht.
   *
   * Geprüft wird am fertigen Dialog: Die Kopfzeile nennt die gezeichneten
   * Geschosse, und die ersten drei Blätter sind drei verschiedene
   * Zeichnungen, jede mit ihrem Geschossnamen im Schriftfeld.
   */
  await p.getByTitle(/Rohrnetzberechnung/).first().click();
  await p.waitForTimeout(2000);
  const kopf = await p.evaluate(() => {
    const el = Array.from(document.querySelectorAll('.panel .text-\\[10\\.5px\\]'))
      .find((x) => /Teilstrecken/.test(x.textContent ?? ''));
    return el?.textContent ?? '';
  });
  console.log(`  · ${kopf}`);
  expect('Die Kopfzeile nennt drei Grundrisse', /3 Grundrisse \(KG, EG, OG\)/.test(kopf), true);

  const blattText = async () =>
    await p.evaluate(() => {
      const svg = document.querySelector('.panel .flex-1 svg');
      return svg ? Array.from(svg.querySelectorAll('text')).map((t) => t.textContent).join(' | ') : '';
    });
  const namen = [];
  for (let i = 0; i < 3; i++) {
    namen.push(await blattText());
    if (i < 2) {
      await p.getByText('weiter ▶').click();
      await p.waitForTimeout(700);
    }
  }
  expect('Blatt 1 ist der Keller', /Rohrnetz KG/.test(namen[0]), true);
  expect('Blatt 2 ist das Erdgeschoss', /Rohrnetz EG/.test(namen[1]), true);
  expect('Blatt 3 ist das Obergeschoss', /Rohrnetz OG/.test(namen[2]), true);
  expect('Drei verschiedene Zeichnungen', new Set(namen).size, 3);

  await p.locator('.panel button[title="Schließen"]').first().click();
  await p.waitForTimeout(400);
}

/*
 * ▸ Die Treppe steigen — und dabei das Geschoss wechseln.
 *
 * Gemeldet als „bei Treppen wäre es noch schön, wenn man effektiv die Treppe
 * steigen kann und dadurch das Geschoss wechselt". Bis 1.56.0 stand die
 * Augenhöhe im Begehmodus fest auf dem Fußboden des aktiven Geschosses; man
 * lief durch die Treppe hindurch wie durch Luft.
 *
 * Geprüft wird am **Geher** und nicht am Bild: Ob die Höhe mitsteigt und wo
 * das Geschoss wechselt, ist einer Leinwand nicht anzusehen. Der Haken
 * `__raviaGeher` gibt beides her und nimmt zugleich einen Standort entgegen —
 * damit muss der Rauchtest die vier Meter nicht wirklich ablaufen.
 */
console.log('\n▸ Die Treppe steigen');
{
  const treppe = await p.evaluate(() => {
    const S = window.__ravia.getState();
    const ordered = Object.values(S.doc.levels).sort((a, b) => a.order - b.order);
    const eg = ordered.find((l) => l.name === 'EG') ?? ordered[0];
    S.setActiveLevel(eg.id);
    const raeume = Object.values(S.doc.rooms).filter((r) => r.levelId === eg.id).sort((a, b) => (b.area ?? 0) - (a.area ?? 0));
    const t = S.addVertical('stair-straight', raeume[0].centroid);
    const oben = ordered[ordered.indexOf(eg) + 1];
    return {
      id: t.id,
      pos: t.position,
      len: t.length,
      steps: t.steps,
      rot: t.rotation,
      egName: eg.name,
      obenName: oben?.name ?? '',
    };
  });
  /*
   * **Die Stufenzahl folgt der Geschosshöhe.** Geteilt wird auf die
   * Regelsteigung von 17,5 cm und gerundet: Bei 3,05 m sind das
   * 3,05 / 0,175 = 17,43, also 17 Steigungen à 17,9 cm. Eine feste Zahl —
   * bis 1.56.0 waren es immer 15 — ergäbe hier 20,3 cm und läge über dem
   * Höchstmaß der DIN 18065.
   */
  expect('Die Steigung bleibt im zulässigen Bereich [cm]', treppe.steps >= 15 && treppe.steps <= 20, true);

  await p.getByRole('button', { name: '3D', exact: true }).first().click();
  await p.waitForTimeout(1200);
  await p.getByRole('button', { name: 'Begehen', exact: true }).first().click();
  await p.waitForTimeout(1500);

  /** Den Geher auf einen Punkt der Lauflinie setzen und ablesen, wo er steht. */
  const stelle = async (anteil) => {
    const st = await p.evaluate(({ t, anteil }) => {
      const a = (t.rot * Math.PI) / 180;
      const ex = { x: Math.cos(a), y: Math.sin(a) };
      const antritt = { x: t.pos.x - ex.x * (t.len / 2), y: t.pos.y - ex.y * (t.len / 2) };
      const g = window.__raviaGeher;
      g.x = antritt.x + ex.x * t.len * anteil;
      g.y = antritt.y + ex.y * t.len * anteil;
      return null;
    }, { t: treppe, anteil });
    void st;
    // Ein Bild abwarten: Die Höhe wird in der Zeichenschleife nachgeführt.
    await p.waitForTimeout(260);
    return p.evaluate(() => {
      const g = window.__raviaGeher;
      return { hoehe: Math.round(g.hoehe * 1000) / 1000, geschoss: g.geschoss };
    });
  };

  const unten = await stelle(0);
  const mitte = await stelle(0.5);
  const oben = await stelle(1);

  /*
   * **Die Erwartung kommt aus dem Modell, nicht aus einer Zahl im Test.**
   * Die Geschosshöhe dieses Prüfhauses steht in den Höhenlagen seiner
   * Geschosse; sie hier noch einmal hinzuschreiben hieße, sie an zwei
   * Stellen zu pflegen. Die Aussage ist ohnehin eine andere: Die Höhe ist
   * der **Bruchteil des zurückgelegten Wegs** an der Geschosshöhe — am
   * Antritt null, auf halbem Weg die Hälfte, am Austritt ganz.
   */
  const geschosshoehe = await p.evaluate((t) => {
    const S = window.__ravia.getState();
    const ordered = Object.values(S.doc.levels).sort((a, b) => a.order - b.order);
    const i = ordered.findIndex((l) => l.name === t.egName);
    return Math.round((ordered[i + 1].elevation - ordered[i].elevation) * 1000) / 1000;
  }, treppe);
  console.log(`  · Geschosshöhe ${geschosshoehe.toFixed(2)} m`);
  expect('Am Antritt steht man auf dem unteren Fußboden [m]', unten.hoehe, 0);
  expect('Auf halber Treppe auf halber Höhe [m]', mitte.hoehe, Math.round(geschosshoehe * 500) / 1000);
  expect('Am Austritt auf dem oberen Fußboden [m]', oben.hoehe, geschosshoehe);

  /*
   * **Und das Geschoss wechselt.** Das ist der Punkt, an dem die Wände des
   * Obergeschosses gelten müssen — sonst liefe man oben durch sie hindurch.
   * Auf halber Treppe noch nicht: Dort stehen die Wände unten.
   */
  const name = (id) => id;
  void name;
  const geschossNamen = await p.evaluate(() => {
    const S = window.__ravia.getState();
    return Object.fromEntries(Object.values(S.doc.levels).map((l) => [l.id, l.name]));
  });
  expect('Unten gehört man nach unten', geschossNamen[unten.geschoss], treppe.egName);
  expect('Auf halber Treppe auch', geschossNamen[mitte.geschoss], treppe.egName);
  expect('Oben angekommen wechselt das Geschoss', geschossNamen[oben.geschoss], treppe.obenName);

  /*
   * **Beim Verlassen des Begehmodus wandert es mit.** Wer die Treppe
   * hinaufgegangen ist, arbeitet oben weiter — alles andere wäre ein
   * Rückwurf: Man steht im Obergeschoss, drückt „Iso" und sieht wieder das
   * Erdgeschoss.
   */
  await p.getByRole('button', { name: 'Orbit', exact: true }).first().click();
  await p.waitForTimeout(900);
  const danach = await p.evaluate(() => {
    const S = window.__ravia.getState();
    return S.doc.levels[S.doc.activeLevelId]?.name ?? '';
  });
  expect('Nach dem Begehen arbeitet man oben weiter', danach, treppe.obenName);
}

console.log('\n▸ Die Baugrube — in den Keller sehen, ohne das Grundstück zu verlieren');
{
  /*
   * Gemeldet am 27.09.2026: „im 3d modus wenn ich andere stockwerke
   * ausblende will ich auch die raumgeometrie sehen die unterhalb des
   * grundstückes ist, ich sehe nur die umrisse."
   *
   * Das Grundstück ist eine gedeckte Fläche auf der Geländeoberkante. Wer
   * die Geschosse über dem Keller ausblendet, schaut seither auf den Rasen;
   * vom Keller ragt nur der Teil der Wände heraus, der über Gelände steht.
   *
   * Der Test misst genau das — am Pixel, nicht am Zustand. Zwei Aussagen
   * zusammen, weil jede allein zu billig zu erfüllen wäre:
   *
   *  1. **In der Mitte ist kein Rasen mehr.** Dort steht der Keller.
   *  2. **Am Rand ist weiter Rasen.** Das Grundstück ist nicht verschwunden
   *     — es ist ausgehoben. Ein Test ohne diese zweite Aussage ginge auch
   *     grün, wenn das Gelände einfach abgeschaltet würde.
   */
  await p.getByRole('button', { name: '3D', exact: true }).first().click();
  await p.waitForTimeout(900);

  const lage = await p.evaluate(() => {
    const S = () => window.__ravia.getState();
    /*
     * Ein Grundstück um das Haus — ohne Grundstücksfläche gäbe es nichts,
     * was den Keller verdecken könnte, und der Test prüfte nichts.
     *
     * Es folgt dem Haus mit 3 m Abstand und ist deshalb nicht viel größer
     * als dieses: Die Ansicht wird auf **Haus und Grundstück zusammen**
     * eingepasst, und bei einem großen Grundstück wäre das Haus danach ein
     * Fleck in der Mitte — die Messung in der Bildmitte träfe dann Rasen
     * statt Keller und sagte nichts mehr aus.
     */
    const xs = Object.values(S().doc.nodes).map((n) => n.x);
    const ys = Object.values(S().doc.nodes).map((n) => n.y);
    const rand = 3;
    const x0 = Math.min(...xs) - rand;
    const x1 = Math.max(...xs) + rand;
    const y0 = Math.min(...ys) - rand;
    const y1 = Math.max(...ys) + rand;
    S().addSiteElement('boundary', [
      { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 },
    ]);
    const geschosse = Object.values(S().doc.levels).sort((a, b) => a.order - b.order);
    const kg = geschosse[0];
    S().setActiveLevel(kg.id);
    for (const l of geschosse) if (l.id !== kg.id) S().zeigeGeschoss(l.id, false);
    return {
      kg: kg.name,
      kgHoehe: Math.round(kg.elevation * 1000) / 1000,
      gelaende: S().doc.meta.terrainElevation ?? null,
      sichtbar: geschosse.filter((l) => S().doc.levels[l.id].visible !== false).map((l) => l.name),
    };
  });
  console.log(`  · sichtbar: ${lage.sichtbar.join(', ')} · Fußboden ${lage.kgHoehe} m · Gelände ${lage.gelaende} m`);
  expect('Nur das Kellergeschoss steht im Bild', lage.sichtbar, [lage.kg]);
  expect('Der Kellerfußboden liegt unter der Geländeoberkante', lage.kgHoehe < lage.gelaende, true);

  /*
   * Gemessen wird von **oben**. Nicht, weil die Draufsicht die
   * interessantere Ansicht wäre — sie ist die eindeutige: Nach dem
   * Einpassen steht das Haus in der Bildmitte, und was in der Mitte liegt,
   * ist der Keller. In der Isometrie hinge dieselbe Messung daran, wie weit
   * das Haus im Bild nach oben rutscht.
   */
  await p.getByRole('button', { name: 'Top', exact: true }).first().click();
  await p.waitForTimeout(1200);
  await p.getByRole('button', { name: 'Einpassen', exact: true }).first().click();
  await p.waitForTimeout(1500);

  /*
   * **Der Aushub steht in der Szene.** `__raviaSzene` zählt die Eckpunkte je
   * Bauteilart; ein Quader hat 24. Das ist die Gegenprobe zum Bild: Wäre
   * die Mitte nur deshalb grünfrei, weil das Gelände fehlt, stünde hier
   * eine Null.
   */
  const szene = await p.evaluate(() => window.__raviaSzene());
  expect('Der Erdkörper der Baugrube steht im Modell', (szene.baugrube ?? 0) > 0, true);

  /*
   * **Was als Rasen zählt.** Die Grundstücksfläche (0x4A6B3D) ist das
   * einzige grün getönte Element im Bild. Von oben gemessen liegt sie bei
   * (17, 28, 35); der Hintergrund bei (11, 17, 32), der Kellerfußboden bei
   * (18, 24, 40), eine Kellerwand bei (23, 30, 45). Die ganze Szene ist
   * blaustichig — der Rasen ist die einzige Fläche, bei der Grün deutlich
   * über Rot liegt **und** Blau nicht davonzieht. Genau das wird geprüft
   * und nicht ein Farbwert, der sich mit jeder Lichtänderung verschiebt:
   *
   *     Rasen         28 − 17 = 11 ≥ 9   ·  35 − 28 =  7 ≤ 11   → Rasen
   *     Hintergrund   17 − 11 =  6 < 9                          → nein
   *     Kellerboden   24 − 18 =  6 < 9                          → nein
   *     Kellerwand    30 − 23 =  7 < 9                          → nein
   */
  if (process.env.RAVIA_BILD) await p.screenshot({ path: process.env.RAVIA_BILD });
  const box = await p.locator('main canvas').first().boundingBox();
  const bild = PNG.sync.read(
    await p.screenshot({
      clip: {
        x: Math.round(box.x),
        y: Math.round(box.y),
        width: Math.round(box.width),
        height: Math.round(box.height),
      },
    }),
  );
  const rasen = (x, y) => {
    const i = (bild.width * y + x) * 4;
    const [r, g, bl] = [bild.data[i], bild.data[i + 1], bild.data[i + 2]];
    return g - r >= 9 && bl - g <= 11;
  };
  const anteil = (x0, y0, x1, y1) => {
    let treffer = 0;
    let gesamt = 0;
    for (let y = y0; y < y1; y += 2) {
      for (let x = x0; x < x1; x += 2) {
        gesamt++;
        if (rasen(x, y)) treffer++;
      }
    }
    return gesamt ? treffer / gesamt : 0;
  };
  const mx = Math.round(bild.width / 2);
  const my = Math.round(bild.height / 2);
  const dw = Math.round(bild.width / 12);
  const dh = Math.round(bild.height / 12);
  const mitte = anteil(mx - dw, my - dh, mx + dw, my + dh);
  const ganz = anteil(0, 0, bild.width, bild.height);
  console.log(`  · Rasenanteil: über dem Haus ${(mitte * 100).toFixed(1)} % · ganzes Bild ${(ganz * 100).toFixed(1)} %`);
  /*
   * Zwei Aussagen, und jede allein wäre zu billig: Über dem Haus **kein**
   * Rasen (vorher lag dort der ganze Garten), im Bild insgesamt aber
   * weiterhin welcher — sonst ginge der Test auch grün, wenn das Gelände
   * einfach abgeschaltet würde.
   */
  expect('Über dem Keller liegt kein Rasen mehr', mitte < 0.02, true);
  // Gemessen: 12,5 % des Bildes sind Rasen. Geprüft wird auf 5 % — die
  // Aussage lautet „es ist noch Grundstück da", nicht „es ist genau so viel".
  expect('Das Grundstück steht weiter im Bild', ganz > 0.05, true);
}

console.log('\n▸ Nichts in der Konsole');
expect('Keine Fehler im Browser', errs.slice(0, 3), []);

await b.close();
console.log(failures ? `\n✗ ${failures} Prüfung(en) fehlgeschlagen` : '\n✓ Geschosse: alles in Ordnung');
process.exit(failures ? 1 : 0);
