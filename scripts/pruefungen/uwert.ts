/**
 * Prüfblock „U-Wert" — die Zahl, die eine Wand in der Bilanz hält.
 *
 * **Der Fehler, gegen den dieser Block steht.** Bis 1.23.0 rechnete der
 * Heizlastüberschlag `const u = (b.uValue ?? 0) + flat`. Ein Bauteil ohne
 * U-Wert ging damit mit **0 W Transmission** in die Heizlast — es fiel nicht
 * auf, es fiel *heraus*. Gemessen am Referenzhaus, allen Wänden den U-Wert
 * genommen:
 *
 *     mit U-Werten   5,47 kW   →  Gerät 8 kW
 *     ohne U-Werte   3,88 kW   →  Gerät 6 kW      (−29 %)
 *
 * Die gefährlichere Hälfte des Fehlers war dabei nicht die Zahl, sondern die
 * Stille: Über einen Bauteilaufbau mit `uValue: 0` — so legte `hostPatch`
 * jeden neuen an — stand am Ende **kein einziger Hinweis** im Prüfbericht,
 * weil 0 kein fehlender Wert ist und keine Prüfung darauf sah.
 *
 * **Was hier geprüft wird**, in dieser Reihenfolge:
 *
 *  1. Die Rangfolge in allen vier Fällen: Aufbau, Bauteil, Katalog, fehlt.
 *  2. `uValue: 0` als eigener Fall — ausdrücklich **nicht** dasselbe wie
 *     `undefined`, und an drei Stellen unterschiedlich zu behandeln.
 *  3. Die Kernaussage: Eine Wand ohne U-Wert und ohne Aufbau verkleinert die
 *     Heizlast **nicht**, ohne dass es gemeldet wird.
 *  4. Wo auch der Katalog nichts hergibt — Boden und Decke —, wird der Raum
 *     als unvollständig geführt, und der Vorbehalt kommt an der Summe und im
 *     Anlagenbuch an.
 *
 * **Was hier nicht geprüft wird.** Ob die Vorgabewerte *richtig* sind. 0,24
 * für eine Außenwand ist eine marktübliche Größenordnung und keine Norm; ein
 * Prüfblock kann sie gegen nichts halten. Geprüft wird nur, dass sie
 * durchgängig benutzt und als Annahme kenntlich gemacht werden.
 */

import type { CheckFn } from './typ';
import type { BimDocument, BimNode, Construction, Level, Opening, Wall } from '../../src/types/bim';
import { emptyPlant, emptySite } from '../../src/lib/plantDefaults';
import { applyVerticalDeductions, detectRooms } from '../../src/lib/roomDetection';
import { estimateHeatLoad } from '../../src/lib/heatLoadEstimate';
import { validateModel } from '../../src/lib/validation';
import { applyHostPatch } from '../../src/lib/hostPatch';
import { buildPlantBook } from '../../src/lib/plantBook';
import { designPlant } from '../../src/lib/plantDesign';
import { VORGABE_U, uWertBoden, uWertOeffnung, uWertWand } from '../../src/lib/uwert';

// ---------------------------------------------------------------------------
// Ein Haus, an dem sich eine Wand ausmachen lässt
// ---------------------------------------------------------------------------

/**
 * Rechteck 5 × 4 m über Wandachsen, vier Außenwände, 2,75 m hoch.
 *
 * Bewusst ohne Fenster und ohne Dach: Geprüft wird der Weg des U-Werts, und
 * jede weitere Fläche in der Bilanz macht die Zahlen schwerer gegeneinander
 * zu halten. Der Boden grenzt ans Erdreich, die Decke an einen unbeheizten
 * Bereich — so tragen beide einen Temperaturunterschied und fallen auf, wenn
 * ihr U-Wert fehlt.
 *
 * `wandU` ist absichtlich **nicht** der Vorgabewert 0,24: Läge er darauf,
 * ließe sich „mit erfasstem Wert gerechnet" von „Vorgabewert angesetzt" an
 * keiner Zahl mehr unterscheiden, und der wichtigste Prüfsatz dieses Blocks
 * wäre eine Tautologie.
 */
const WAND_U = 1.4;

interface HausOptionen {
  /** U-Wert an den vier Außenwänden. `undefined`: gar kein Feld. */
  wandU?: number;
  /** Zugewiesener Bauteilaufbau an allen vier Wänden. */
  constructionId?: string;
  /** Der Katalog der Aufbauten. */
  constructions?: Record<string, Construction>;
  /** U-Wert des Bodens am Geschoss. */
  bodenU?: number;
  /** U-Wert der Decke am Geschoss. */
  deckenU?: number;
}

function baueHaus(opt: HausOptionen = {}): BimDocument {
  const ecken: [number, number][] = [
    [0, 0],
    [5, 0],
    [5, 4],
    [0, 4],
  ];
  const nodes: Record<string, BimNode> = {};
  ecken.forEach(([x, y], i) => {
    nodes[`n${i}`] = { id: `n${i}`, x, y, levelId: 'eg' };
  });
  const walls: Record<string, Wall> = {};
  for (let i = 0; i < 4; i++) {
    const w: Wall = {
      id: `w${i}`,
      a: `n${i}`,
      b: `n${(i + 1) % 4}`,
      levelId: 'eg',
      type: 'exterior',
      thickness: 0.365,
      height: 2.75,
      layerId: 'layer-walls',
    };
    if (opt.wandU !== undefined) w.uValue = opt.wandU;
    if (opt.constructionId !== undefined) w.constructionId = opt.constructionId;
    walls[w.id] = w;
  }
  const eg: Level = {
    id: 'eg',
    name: 'EG',
    order: 0,
    elevation: 0,
    height: 2.75,
    floorUValue: opt.bodenU ?? 0.3,
    floorBoundary: 'ground',
    ceilingUValue: opt.deckenU ?? 0.2,
    ceilingBoundary: 'unheated',
  };
  const doc: BimDocument = {
    site: emptySite(),
    plant: emptyPlant(),
    meta: {
      name: 'Prüfhaus U-Wert',
      createdAt: '2026-01-01T00:00:00.000Z',
      modifiedAt: '2026-01-01T00:00:00.000Z',
      northAngle: 0,
      designOutdoorTemperature: -12,
      designIndoorTemperature: 20,
      n50: 1.5,
      shielding: 'moderate',
      unheatedTemperature: 10,
      groundTemperature: 10,
      // Ohne Wärmebrückenzuschlag: Er käme auf jeden U-Wert obendrauf und
      // machte damit auch aus einem fehlenden Bauteil eine Fläche mit
      // Verlust — genau die Vermischung, die dieser Block auseinanderhalten
      // muss.
      thermalBridgeSupplement: 0,
      thermalBridgeMethod: 'flat',
      thermalBridgeCategory: 'custom',
      reheatFactor: 0,
    },
    levels: { eg },
    layers: {},
    nodes,
    walls,
    openings: {} as Record<string, Opening>,
    fixtures: {},
    verticals: {},
    solids: {},
    durchbrueche: {},
    pipes: {},
    annotations: {},
    roofOpenings: {},
    rooms: {},
    constructions: opt.constructions ?? {},
    diagnostics: { openEnds: [] },
    activeLevelId: 'eg',
  };

  const raeume = detectRooms({
    nodes: doc.nodes,
    walls: Object.values(doc.walls),
    openings: [],
    levelId: 'eg',
    defaultHeight: eg.height,
    northAngle: 0,
    constructions: doc.constructions,
  });
  applyVerticalDeductions(raeume, [], ['eg']);
  doc.rooms = Object.fromEntries(raeume.map((r) => [r.id, r]));
  return doc;
}

/** Transmission des ersten (und einzigen) Raums [W]. */
const transmission = (doc: BimDocument): number => estimateHeatLoad(doc).rooms[0]?.transmission ?? -1;

/** Die Lücken des ersten Raums als Text — leichter zu vergleichen als ein Feld. */
const luecken = (doc: BimDocument): string =>
  (estimateHeatLoad(doc).rooms[0]?.unvollstaendig ?? ['(kein Raum)']).join(', ');

/** Wie oft ein Befundschlüssel im Prüfbericht vorkommt. */
const anzahl = (doc: BimDocument, code: string): number =>
  validateModel(doc).issues.filter((i) => i.code === code).length;

const schwere = (doc: BimDocument, code: string): string =>
  validateModel(doc).issues.find((i) => i.code === code)?.severity ?? '—';

const AUFBAU: Record<string, Construction> = {
  'c-gut': { id: 'c-gut', name: 'AW 36,5 + WDVS', category: 'wall', uValue: 0.18 },
  'c-leer': { id: 'c-leer', name: 'Aufbau ohne U-Wert', category: 'wall', uValue: 0 },
};

export function pruefeUwert(check: CheckFn): void {
  // =======================================================================
  // 1 — Die Rangfolge in allen vier Fällen
  // =======================================================================

  const mitBeidem = uWertWand({ type: 'exterior', uValue: WAND_U, constructionId: 'c-gut' }, AUFBAU);
  check('Der Aufbau schlägt den Wert am Bauteil', mitBeidem.wert ?? -1, 0.18);
  check('… und sagt es auch', mitBeidem.herkunft, 'aufbau');
  check('… und nennt den Aufbau beim Namen', mitBeidem.aufbau ?? '—', 'AW 36,5 + WDVS');

  const nurBauteil = uWertWand({ type: 'exterior', uValue: WAND_U }, AUFBAU);
  check('Ohne Aufbau gilt der Wert am Bauteil', nurBauteil.wert ?? -1, WAND_U);
  check('… mit der Herkunft „bauteil"', nurBauteil.herkunft, 'bauteil');

  const nurKatalog = uWertWand({ type: 'exterior' }, AUFBAU);
  check('Ohne beides greift der Vorgabekatalog', nurKatalog.wert ?? -1, VORGABE_U.exterior);
  check('… und weist sich als Annahme aus', nurKatalog.herkunft, 'katalog');
  check('Der Katalog kennt jede Wandart', uWertWand({ type: 'shaft' }, AUFBAU).wert ?? -1, VORGABE_U.shaft);

  check('Ohne Wand gibt es keinen U-Wert', uWertWand(undefined, AUFBAU).herkunft, 'fehlt');
  // `undefined` und nicht 0: Eine 0 wäre eine Zahl, mit der sich weiterrechnen
  // ließe — und genau das darf hier niemand.
  check('… und auch keine Ersatzzahl', uWertWand(undefined, AUFBAU).wert === undefined, true);

  // Eine Kennung, zu der es keinen Aufbau gibt, ist kein Aufbau. Sie darf die
  // Rangfolge nicht abbrechen, sonst verlöre eine Wand ihren eigenen U-Wert,
  // weil jemand einen Katalogeintrag gelöscht hat.
  const verwaist = uWertWand({ type: 'exterior', uValue: WAND_U, constructionId: 'c-fort' }, AUFBAU);
  check('Eine verwaiste Aufbaukennung fällt auf den Bauteilwert zurück', verwaist.wert ?? -1, WAND_U);
  check('… mit der ehrlichen Herkunft', verwaist.herkunft, 'bauteil');

  // Öffnungen laufen durch dieselbe Rangfolge.
  check('Fenster ohne Angabe: Vorgabewert', uWertOeffnung({ kind: 'window' }).wert ?? -1, VORGABE_U.window);
  check('Tür ohne Angabe: Vorgabewert', uWertOeffnung({ kind: 'door' }).wert ?? -1, VORGABE_U.door);
  // Der Durchgang ist ein Loch und kein Bauteil — seine 0 ist eine Aussage
  // und keine Lücke. Stünde er als „fehlt" da, meldete jeder offene Übergang
  // im Grundriss einen Mangel, den es nicht gibt.
  check('Der Durchgang ist keine Lücke', uWertOeffnung({ kind: 'passage' }).herkunft, 'katalog');
  check('… und hat mit Recht keinen Widerstand', uWertOeffnung({ kind: 'passage' }).wert ?? -1, 0);

  // Boden und Decke haben keinen Vorgabewert — zwischen gedämmter
  // Bodenplatte (0,28) und Geschossdecke (0,9) liegt der Faktor drei.
  check('Der Boden kennt keinen Vorgabewert', uWertBoden({}, { floorUValue: 0 }).herkunft, 'fehlt');
  check('Mit Angabe schon', uWertBoden({}, { floorUValue: 0.3 }).wert ?? -1, 0.3);
  check(
    'Der Raum übersteuert das Geschoss',
    uWertBoden({ floorUValue: 0.15 }, { floorUValue: 0.3 }).wert ?? -1,
    0.15,
  );
  check(
    'Der Aufbau am Geschoss schlägt beide',
    uWertBoden({ floorUValue: 0.15 }, { floorUValue: 0.3, floorConstructionId: 'c-gut' }, AUFBAU).wert ?? -1,
    0.18,
  );

  // =======================================================================
  // 2 — `uValue: 0` ist ein eigener Fall
  // =======================================================================

  const nullWand = uWertWand({ type: 'exterior', uValue: 0 }, AUFBAU);
  check('Eine erfasste 0 gilt nicht als U-Wert', nullWand.herkunft, 'katalog');
  check('… gerechnet wird mit dem Vorgabewert', nullWand.wert ?? -1, VORGABE_U.exterior);
  // Ein Aufbau mit 0 — so legte `hostPatch` bis 1.23.0 jeden neuen an — darf
  // die Wand nicht mitreißen.
  const leererAufbau = uWertWand({ type: 'exterior', uValue: WAND_U, constructionId: 'c-leer' }, AUFBAU);
  check('Ein Aufbau ohne U-Wert wird übersprungen', leererAufbau.wert ?? -1, WAND_U);
  check('… und nicht als Aufbau ausgegeben', leererAufbau.herkunft, 'bauteil');
  // Negative Werte und NaN sind dieselbe Sorte Unfug.
  check('Ein negativer U-Wert zählt nicht', uWertWand({ type: 'exterior', uValue: -1 }).herkunft, 'katalog');
  check('NaN ebenso wenig', uWertWand({ type: 'exterior', uValue: Number.NaN }).herkunft, 'katalog');

  // Und in der Modellprüfung sind die beiden Fälle **nicht** dasselbe:
  // Fehlt der Wert, wird eine Annahme angesetzt — eine Warnung. Steht eine 0
  // da, ist eine Angabe vorhanden und nachweislich falsch — ein Fehler.
  const ohneWert = baueHaus();
  const mitNull = baueHaus({ wandU: 0 });
  check('Vier Wände ohne U-Wert: vier Warnungen', anzahl(ohneWert, 'wall.missing-u-value'), 4);
  check('… als Warnung, nicht als Fehler', schwere(ohneWert, 'wall.missing-u-value'), 'warning');
  check('Vier Wände mit U = 0: vier Befunde', anzahl(mitNull, 'wall.implausible-u-value'), 4);
  check('… und die sind Fehler', schwere(mitNull, 'wall.implausible-u-value'), 'error');
  // Der stille Fall von früher: `uValue: 0` erzeugte gar keinen Befund.
  check('Eine 0 läuft nicht mehr stumm durch', anzahl(mitNull, 'wall.implausible-u-value') > 0, true);
  check('Mit erfasstem Wert ist Ruhe', anzahl(baueHaus({ wandU: WAND_U }), 'wall.missing-u-value'), 0);

  // =======================================================================
  // 3 — Die Kernaussage: keine kleinere Heizlast ohne Meldung
  // =======================================================================

  const mitU = baueHaus({ wandU: WAND_U });
  const ohneU = baueHaus();
  const alsKatalog = baueHaus({ wandU: VORGABE_U.exterior });

  check('Mit erfasstem U-Wert steckt Transmission in der Bilanz', transmission(mitU) > 0, true);
  // Der eigentliche Satz dieses Blocks. Vor 1.23.1 stand hier die
  // Transmission der Wände auf 0 und nur Boden und Decke blieben übrig.
  check(
    'Ohne U-Wert fällt die Wand nicht aus der Bilanz',
    transmission(ohneU),
    transmission(alsKatalog),
  );
  check(
    '… die Wand rechnet also mit dem Vorgabewert',
    transmission(ohneU) > transmission(baueHaus({ wandU: 0.001 })),
    true,
  );
  // Der Vorgabewert ist trotzdem kein Freifahrtschein: Er liegt unter dem
  // erfassten Bestandswert, und deshalb muss die Annahme gemeldet werden.
  check('Der Vorgabewert ist nicht der erfasste', transmission(ohneU) < transmission(mitU), true);
  check('Und die Annahme steht im Bericht', anzahl(ohneU, 'wall.missing-u-value') > 0, true);
  // Genau die Kombination, die es nicht geben darf: kleiner **und** stumm.
  const kleinerUndStumm =
    transmission(ohneU) < transmission(mitU) && anzahl(ohneU, 'wall.missing-u-value') === 0;
  check('Kleiner geworden und niemand sagt es: kommt nicht vor', kleinerUndStumm, false);

  // =======================================================================
  // 4 — Der Bauteilaufbau wird überhaupt erst gesehen
  // =======================================================================

  // Bis 1.23.0 reichte die Raumerkennung stur `wall.uValue` durch. Eine Wand,
  // deren U-Wert im zugewiesenen Aufbau steht, kam damit ohne U-Wert heraus —
  // während die Übergabe an RaVia denselben Aufbau längst auswertete.
  const perAufbau = baueHaus({ constructionId: 'c-gut', constructions: AUFBAU });
  const perHand = baueHaus({ wandU: 0.18 });
  check('Der Aufbau kommt in der Heizlast an', transmission(perAufbau), transmission(perHand));
  check('Der Abschnitt führt den Aufbauwert mit', perAufbau.rooms[Object.keys(perAufbau.rooms)[0]].boundaries[0].uValue ?? -1, 0.18);
  // Und er gilt auch gegenüber einem am Bauteil erfassten Wert.
  const beides = baueHaus({ wandU: WAND_U, constructionId: 'c-gut', constructions: AUFBAU });
  check('Aufbau vor Bauteilwert, auch in der Bilanz', transmission(beides), transmission(perHand));
  check('Mit Aufbau ist die Modellprüfung zufrieden', anzahl(perAufbau, 'wall.missing-u-value'), 0);

  // =======================================================================
  // 5 — Wo der Katalog nichts hergibt: der Raum wird als unvollständig geführt
  // =======================================================================

  const ohneBoden = baueHaus({ wandU: WAND_U, bodenU: 0 });
  check('Ein Boden ohne U-Wert wird als Lücke geführt', luecken(ohneBoden), 'Boden');
  check('Mit Boden ist der Raum vollständig', luecken(baueHaus({ wandU: WAND_U })), '');
  check('Die Lücke erreicht die Gebäudesumme', estimateHeatLoad(ohneBoden).vollstaendig, false);
  check('Und nennt den Raum beim Namen', estimateHeatLoad(ohneBoden).unvollstaendigeRaeume.join(', '), 'Raum 1');
  check('Ein vollständiges Haus meldet nichts', estimateHeatLoad(baueHaus({ wandU: WAND_U })).vollstaendig, true);
  check('Die Modellprüfung sagt es ebenfalls', anzahl(ohneBoden, 'level.missing-floor-u'), 1);

  // Boden **und** Decke fehlen: zwei Bauteile, eine Meldung je Geschoss.
  const ohneBeides = baueHaus({ wandU: WAND_U, bodenU: 0, deckenU: 0 });
  check('Beide Lücken werden aufgeführt', luecken(ohneBeides), 'Boden, Decke');

  // Gemeldet wird nur, was auch wirkt. Die Decke dieses Hauses grenzt an
  // „unbeheizt" und trägt deshalb einen Temperaturunterschied. Steht sie auf
  // „adiabat", ist Δϑ = 0 — die fehlende Angabe kostet dann kein Watt, und ein
  // Vorbehalt ohne Folgen entwertet die daneben, die Folgen haben. (Anders als
  // man vermuten würde, ist „an Nachbarraum" hier **kein** folgenloser Fall:
  // Liegt über dem Geschoss gar keines, gilt θ_u — siehe `heatLoadEstimate`.)
  const deckeOhneWirkung = baueHaus({ wandU: WAND_U, deckenU: 0 });
  deckeOhneWirkung.levels.eg = { ...deckeOhneWirkung.levels.eg, ceilingBoundary: 'adiabatic' };
  check('Eine folgenlose Lücke wird nicht gemeldet', luecken(deckeOhneWirkung), '');

  // =======================================================================
  // 6 — `hostPatch` legt keinen Aufbau mit 0 mehr an
  // =======================================================================

  const basis = baueHaus({ wandU: WAND_U });
  const ohneAngabe = applyHostPatch(
    basis,
    {
      source: 'Prüfblock',
      constructions: [{ id: 'c-neu', createIfMissing: { name: 'Neuer Aufbau', category: 'wall' } }],
    },
    '2026-01-02T00:00:00.000Z',
  );
  check('Ein Aufbau ohne U-Wert wird nicht angelegt', ohneAngabe.report.rejected, 1);
  check('… und das Modell bleibt unverändert', ohneAngabe.changed, false);
  check('… kein Aufbau mit 0 im Katalog', Object.keys(ohneAngabe.doc.constructions ?? {}).length, 0);

  const mitAngabe = applyHostPatch(
    basis,
    {
      source: 'Prüfblock',
      constructions: [
        { id: 'c-neu', uValue: 0.22, createIfMissing: { name: 'Neuer Aufbau', category: 'wall' } },
      ],
    },
    '2026-01-02T00:00:00.000Z',
  );
  check('Mit U-Wert entsteht er', (mitAngabe.doc.constructions ?? {})['c-neu']?.uValue ?? -1, 0.22);
  check('… ohne Ablehnung', mitAngabe.report.rejected, 0);
  // Der U-Wert steht einmal in der Historie, nicht zweimal.
  check(
    'Der Anlegevorgang wird einmal verbucht',
    mitAngabe.report.entries.filter((e) => e.path.startsWith('constructions.c-neu')).length,
    1,
  );
  // Der Wertebereich fängt die Null ohnehin ab — hier steht es als Zusage.
  const mitNullPatch = applyHostPatch(
    basis,
    {
      source: 'Prüfblock',
      constructions: [{ id: 'c-null', uValue: 0, createIfMissing: { name: 'Null', category: 'wall' } }],
    },
    '2026-01-02T00:00:00.000Z',
  );
  check('Eine 0 als U-Wert wird abgelehnt', mitNullPatch.report.rejected, 1);

  // =======================================================================
  // 7 — Der Vorbehalt kommt im Anlagenbuch an
  // =======================================================================

  const heft = (doc: BimDocument): string =>
    buildPlantBook({
      design: designPlant(doc),
      projectName: 'Prüfhaus',
      plantName: 'Prüfanlage',
      author: 'Prüfblock',
      date: '01.01.2026',
    }).html;

  const heftVollstaendig = heft(baueHaus({ wandU: WAND_U }));
  const heftLueckig = heft(ohneBoden);
  check('Ein vollständiges Heft trägt keinen Vorbehalt', heftVollstaendig.includes('<sup>*</sup>'), false);
  check('Ein lückiges Heft trägt ihn', heftLueckig.includes('<sup>*</sup>'), true);
  check('… und sagt, welches Bauteil fehlt', heftLueckig.includes('fehlt der U-Wert einzelner Bauteile'), true);
  check('… und benennt den Raum', heftLueckig.includes('Raum 1'), true);
  // Die spezifische Heizlast der Summenzeile ist ein Quotient aus einer
  // vollständigen Fläche und einer unvollständigen Last — sie bekommt einen
  // Strich und keinen Stern.
  check('Kein „NaN" und kein „undefined" im lückigen Heft', /NaN|undefined/.test(heftLueckig), false);
}
