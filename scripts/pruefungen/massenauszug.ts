/**
 * Prüfblock für den Massen- und Materialauszug.
 * ---------------------------------------------------------------------------
 * Geprüft wird gegen das Referenzhaus, weil dessen Geometrie feststeht und
 * jede Menge daraus von Hand nachgerechnet werden kann: zwei Geschosse mit je
 * sieben Wänden, vier Öffnungen, fünf TGA-Objekten und zwei Leitungszügen.
 * Die Sollwerte hier stammen aus dieser Geometrie und aus den im Modul
 * beschriebenen Regeln — nicht aus einem Lauf des Moduls.
 *
 * Wo sich ein Sollwert nicht herleiten lässt (Gerätewahl, Sicherheitsarmaturen,
 * Auslegung der Flächenheizung), wird nicht die Zahl geprüft, sondern die
 * Bilanz: der Auszug muss dieselbe Menge führen, die in der Auslegung steht.
 * Damit fällt eine verlorene oder doppelt gezählte Position auf, ohne dass ein
 * Ergebnis abgeschrieben werden müsste.
 */

import type { CheckFn } from './typ';
import type { BimDocument, Fixture, PipeRun } from '../../src/types/bim';
import { PIPE_SERVICE_LABELS } from '../../src/types/bim';
import {
  MATERIAL_TRADE_LABELS,
  buildMaterialSchedule,
  materialScheduleCsv,
  type MaterialItem,
  type MaterialSchedule,
  type MaterialTrade,
  type MaterialUnit,
} from '../../src/lib/materialSchedule';
import { designPlant, type CircuitDesign } from '../../src/lib/plantDesign';
import { SCHEMATIC_LEGEND } from '../../src/lib/schematicSymbols';
import { buildReferenceDocument } from '../reference';

// ---------------------------------------------------------------------------
// Kleinkram
// ---------------------------------------------------------------------------

/**
 * Gewerke des Auszugs — dieselbe geschlossene Liste, die das Modul führt, und
 * zwar in der Reihenfolge des Bauablaufs, in der das Modul seine Gruppen
 * ausgibt. Beides wird unten geprüft.
 */
const GEWERKE: readonly MaterialTrade[] = [
  'rohr',
  'fbh',
  'heizflaeche',
  'geraet',
  'armatur',
  'sanitaer',
  'lueftung',
  'bauteil',
];

/** Die fünf zulässigen Einheiten einer Bestellliste. */
const EINHEITEN: readonly MaterialUnit[] = ['m', 'm²', 'Stk', 'l', 'kW'];

const positionen = (auszug: MaterialSchedule, passt: (i: MaterialItem) => boolean): MaterialItem[] =>
  auszug.items.filter(passt);

const menge = (auszug: MaterialSchedule, passt: (i: MaterialItem) => boolean): number =>
  positionen(auszug, passt).reduce((summe, i) => summe + i.quantity, 0);

const gruppe = (auszug: MaterialSchedule, trade: MaterialTrade) => auszug.groups.find((g) => g.trade === trade);

const gruppenmenge = (auszug: MaterialSchedule, trade: MaterialTrade, unit: MaterialUnit): number =>
  gruppe(auszug, trade)?.totals.find((t) => t.unit === unit)?.quantity ?? 0;

/** Der Schlüssel, nach dem das Modul zusammenfasst: Gewerk, Bezeichnung, Angabe, Einheit, Herkunft. */
const schluessel = (i: MaterialItem): string => [i.trade, i.name, i.spec, i.unit, i.origin].join('\u241F');

/**
 * CSV-Zeile in Felder zerlegen, mit Anführungszeichen als Schutz.
 * Ein blindes `split(';')` würde ein gequotetes Semikolon als Trenner lesen und
 * damit genau den Fall übersehen, um dessentwillen gequotet wird.
 */
function csvFelder(zeile: string): string[] {
  const felder: string[] = [];
  let feld = '';
  let imFeld = false;
  for (let i = 0; i < zeile.length; i += 1) {
    const zeichen = zeile[i];
    if (imFeld) {
      if (zeichen !== '"') {
        feld += zeichen;
      } else if (zeile[i + 1] === '"') {
        feld += '"';
        i += 1;
      } else {
        imFeld = false;
      }
      continue;
    }
    if (zeichen === '"') imFeld = true;
    else if (zeichen === ';') {
      felder.push(feld);
      feld = '';
    } else feld += zeichen;
  }
  felder.push(feld);
  return felder;
}

/** Leeres Dokument: dieselben Stammdaten, aber ohne jeden Modellinhalt. */
function leeresDokument(): BimDocument {
  const doc = buildReferenceDocument();
  return {
    ...doc,
    nodes: {},
    walls: {},
    openings: {},
    fixtures: {},
    pipes: {},
    rooms: {},
    verticals: {},
    roofOpenings: {},
    constructions: {},
  };
}

/**
 * Prüffall für die Grenzfälle: ein Dokument, das außer den übergebenen
 * Leitungen nichts enthält. Die Mengen sind damit von Hand nachzurechnen —
 * jede Leitung unten ist zehn Meter lang.
 */
function dokumentMitLeitungen(...leitungen: readonly PipeRun[]): BimDocument {
  return { ...leeresDokument(), pipes: Object.fromEntries(leitungen.map((l) => [l.id, l])) };
}

/**
 * Eine zehn Meter lange Leitung. Die Nennweite ist ein Parameter, weil sie in
 * die technische Angabe eingeht: Leitungen mit verschiedener Nennweite bleiben
 * getrennte Positionen, auch wenn ihr Dämmtext derselbe ist. Nur so lässt sich
 * zählen, an wie vielen Zeilen ein Dämmtext steht.
 */
const leitung = (id: string, insulation: number, elevation: number, nominalDiameter = 16): PipeRun => ({
  id,
  levelId: 'eg',
  service: 'heating-flow',
  points: [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
  ],
  nominalDiameter,
  insulation,
  elevation,
});

/** Dasselbe für Lüftungsobjekte: ein Dokument, das nur die übergebenen Kanäle führt. */
function dokumentMitKanaelen(...kanaele: readonly Fixture[]): BimDocument {
  return { ...leeresDokument(), fixtures: Object.fromEntries(kanaele.map((k) => [k.id, k])) };
}

const kanal = (id: string, length: number): Fixture => ({
  id,
  type: 'duct',
  category: 'ventilation',
  levelId: 'eg',
  position: { x: 0, y: 0 },
  rotation: 0,
  length,
  depth: 0.2,
  elevation: 2.5,
  params: { airflow: 300 },
});

/** Die drei Verlegearten im Klartext — so, wie sie in der technischen Angabe stünden. */
const VERLEGEARTEN: readonly string[] = ['im Fußbodenaufbau', 'an der Wand', 'unter der Decke'];

/**
 * Die Zahl, die ein Hinweis behauptet.
 *
 * Ein Hinweis wie „2 Leitungsabschnitte tragen keine belastbare Dämmstärke"
 * beginnt mit seiner Menge. Nur so lässt sich prüfen, dass Meldung und
 * Bestellzeilen dieselbe Zahl nennen. Gibt es den Hinweis nicht oder mehrfach,
 * liefert die Funktion `NaN` — dann fällt die Prüfung auf, statt zu schweigen.
 */
const zahlImHinweis = (auszug: MaterialSchedule, teil: string): number => {
  const treffer = auszug.notes.filter((n) => n.text.includes(teil));
  return treffer.length === 1 ? Number.parseInt(treffer[0].text, 10) : Number.NaN;
};

const flaechenkreise = (kreise: readonly CircuitDesign[]): CircuitDesign[] =>
  kreise.filter((k) => k.circuit.kind === 'floor');

// Raumweise Auslegung führt; nur wenn sie fehlt, gilt der Kreis als Ganzes.
const kreisRohrlaenge = (k: CircuitDesign): number =>
  k.rooms?.length ? k.rooms.reduce((s, r) => s + r.floor.totalLength, 0) : (k.floor?.totalLength ?? 0);

const kreisAbgaenge = (k: CircuitDesign): number =>
  k.rooms?.length ? k.rooms.reduce((s, r) => s + r.floor.loops, 0) : (k.floor?.loops ?? 0);

const kreisFlaeche = (k: CircuitDesign): number =>
  k.rooms?.length ? k.rooms.reduce((s, r) => s + r.area, 0) : (k.floor?.area ?? 0);

const kreisRaumIds = (k: CircuitDesign): string[] =>
  k.rooms?.length ? k.rooms.map((r) => r.roomId) : (k.circuit.roomIds ?? []);

// ---------------------------------------------------------------------------
// Prüfungen
// ---------------------------------------------------------------------------

export function pruefeMassenauszug(check: CheckFn): void {
  const doc = buildReferenceDocument();
  const plan = designPlant(doc);
  const ohne = buildMaterialSchedule(doc);
  const mit = buildMaterialSchedule(doc, plan);
  const leer = buildMaterialSchedule(leeresDokument());

  // === 1 — Referenzhaus ohne Anlagenauslegung ===============================
  // Ohne Auslegung bleibt der reine Grundrissauszug: Leitungen, Heizflächen,
  // Lüftung, Bauteile und die gesetzten Objekte der Flächenheizung. Jede Menge
  // in diesem Abschnitt ist aus der Geometrie des Referenzhauses gerechnet.

  check('Projektname wird aus den Stammdaten übernommen', ohne.projectName, 'Referenzhaus');
  // 2 Rohr + 1 Verteilerobjekt + 4 Heizfläche + 2 Lüftung + 9 Bauteil.
  // Neun Bauteilpositionen, seit das Referenzhaus einen Keller hat: dessen
  // Außenwand trägt einen eigenen U-Wert und steht deshalb getrennt, und
  // seine beiden Kellerfenster haben ein eigenes Format.
  check('Ohne Auslegung stehen 18 Positionen im Auszug', ohne.positionCount, 18);

  // Leitungen: je Geschoss (2,4 + 0,2) + (7,4 + 0,2) m, zwei Geschosse.
  check(
    'Trassenlänge des Rohrnetzes aus der Polyliniengeometrie',
    menge(ohne, (i) => i.trade === 'rohr' && i.name === PIPE_SERVICE_LABELS['heating-flow']),
    20.4,
    0.01,
  );
  check(
    'Rohrdämmung liegt auf der ganzen Trasse — alle Leitungen sind mit 9 mm erfasst',
    menge(ohne, (i) => i.name === 'Rohrdämmung'),
    20.4,
    0.01,
  );
  check(
    'Alle vier gleichartigen Leitungsabschnitte stehen in einer Position',
    positionen(ohne, (i) => i.trade === 'rohr' && i.name === PIPE_SERVICE_LABELS['heating-flow']).length,
    1,
  );

  // Heizflächen: zwei Heizkörper je Geschoss, dazu je Heizfläche eine Garnitur.
  check('Heizkörper: vier Stück aus zwei Geschossen', menge(ohne, (i) => i.name === 'Heizkörper'), 4);
  check('Je Heizfläche ein Thermostatventil', menge(ohne, (i) => i.name === 'Thermostatventil mit Kopf'), 4);

  // Lüftung: je Geschoss ein Zuluft- und ein Abluftventil.
  check('Lüftung: vier Ventile aus zwei Geschossen', menge(ohne, (i) => i.trade === 'lueftung'), 4);

  // Bauteile: elf Öffnungen und einundzwanzig Wände.
  check('Fenster: acht Stück, drei je Wohngeschoss und zwei im Keller', menge(ohne, (i) => i.name === 'Fenster'), 8);
  check('Türen: drei Stück, eine je Geschoss', menge(ohne, (i) => i.name === 'Tür'), 3);
  // Außenwand EG und OG: 2 × (13,80 + 9,38 + 22,00 + 11,00 + 16,50 + 20,65) = 186,66 m².
  // Außenwand KG bei 2,30 m Höhe: 13,20 + 9,20 + 18,40 + 9,20 + 13,80 + 17,80 = 81,60 m².
  //
  // Der Massenauszug beschreibt das Bauteil, nicht die Wärmebilanz: eine
  // halb eingegrabene Kellerwand wird als *eine* Wand gemauert und steht
  // deshalb hier als eine Fläche — die Teilung an der Geländeoberkante
  // gehört in den Heizlastexport und hat im Leistungsverzeichnis nichts
  // verloren. Genau das hält diese Zahl fest.
  check(
    'Außenwandfläche über die Achsen, abzüglich der Öffnungen',
    menge(ohne, (i) => i.name.startsWith('Außenwand')),
    268.26,
    0.01,
  );
  // Innenwand: 2 × (8,00 × 2,75 − 0,885 × 2,01) + (8,00 × 2,30 − 0,885 × 2,01) m².
  check(
    'Innenwandfläche über die Achse, abzüglich der Türöffnung',
    menge(ohne, (i) => i.name.startsWith('Innenwand')),
    57.06,
    0.01,
  );

  // Ohne Anlagenplanung fehlen die Anlagenteile — ohne dass etwas abstürzt.
  check('Ohne Auslegung kein Gewerk „Geräte und Speicher"', Boolean(gruppe(ohne, 'geraet')), false);
  check('Ohne Auslegung kein Gewerk „Armaturen und Sicherheitstechnik"', Boolean(gruppe(ohne, 'armatur')), false);
  check(
    'Ohne Auslegung zählen wenigstens die gesetzten Verteilerobjekte',
    menge(ohne, (i) => i.trade === 'fbh' && i.name === 'Heizkreisverteiler'),
    2,
  );

  // === 2 — Formale Eigenschaften jeder Position ============================
  // Über beide Auszüge zusammen gezählt, damit ein Verstoß in genau einem der
  // beiden Wege nicht durchrutscht.

  const alle: MaterialItem[] = [...ohne.items, ...mit.items];

  check(
    'Jede Menge ist endlich und größer null',
    alle.filter((i) => !Number.isFinite(i.quantity) || i.quantity <= 0).length,
    0,
  );
  check(
    'Jede Position trägt ein Gewerk mit dem dazu passenden Klartextnamen',
    alle.filter((i) => !GEWERKE.includes(i.trade) || i.tradeLabel !== MATERIAL_TRADE_LABELS[i.trade]).length,
    0,
  );
  check('Jede Position trägt eine der fünf zulässigen Einheiten', alle.filter((i) => !EINHEITEN.includes(i.unit)).length, 0);
  check(
    'Jede Position trägt eine Bezeichnung und eine Herkunft im Klartext',
    alle.filter((i) => i.name.trim().length === 0 || i.origin.trim().length === 0).length,
    0,
  );
  check(
    'Kein Rechenrest im Text (NaN, Infinity, undefined)',
    alle.filter((i) => /NaN|Infinity|undefined/.test(`${i.name}|${i.spec}|${i.origin}|${i.remark ?? ''}`)).length,
    0,
  );
  check(
    'Die laufenden Nummern sind lückenlos und beginnen bei 1',
    mit.items.filter((i, index) => i.position !== index + 1).length,
    0,
  );
  check(
    'Gleichartige Positionen sind zusammengefasst — kein Schlüssel steht doppelt',
    new Set(mit.items.map(schluessel)).size,
    mit.positionCount,
  );
  /*
   * Die Summe der `itemCount` gegen `positionCount` zu halten sagt nichts:
   * Gruppe und Liste entstehen im Modul aus derselben Schleife, die Gleichheit
   * kann gar nicht verletzt werden. Geprüft wird deshalb die Zuordnung selbst
   * und die Reihenfolge, die das Modul zusagt — Gewerke im Bauablauf, innerhalb
   * des Gewerks nach Bezeichnung mit deutscher Kollation.
   */
  check(
    'Jede Position steht in der Gruppe ihres Gewerks',
    mit.items.filter((i) => !gruppe(mit, i.trade)?.items.includes(i)).length,
    0,
  );
  check(
    'Keine Gruppe führt eine Position, die nicht in der Liste steht',
    mit.groups.filter((g) => g.items.some((i) => i.trade !== g.trade || !mit.items.includes(i))).length,
    0,
  );
  check(
    'Die Gewerke stehen in der Reihenfolge des Bauablaufs',
    mit.groups.map((g) => g.trade).join(','),
    GEWERKE.filter((t) => mit.groups.some((g) => g.trade === t)).join(','),
  );
  check(
    'Innerhalb eines Gewerks ist nach Bezeichnung sortiert',
    mit.groups.filter((g) => g.items.some((i, n) => n > 0 && g.items[n - 1].name.localeCompare(i.name, 'de') > 0)).length,
    0,
  );
  check(
    'Jede in einer Gruppe vorkommende Einheit hat dort eine Summenzeile',
    mit.groups.filter((g) => g.totals.length !== new Set(g.items.map((i) => i.unit)).size).length,
    0,
  );
  check(
    'Die Gruppensummen je Einheit sind die Summen ihrer Positionen',
    mit.groups.filter((g) =>
      g.totals.some(
        (t) => Math.abs(t.quantity - g.items.filter((i) => i.unit === t.unit).reduce((s, i) => s + i.quantity, 0)) > 0.02,
      ),
    ).length,
    0,
  );

  // === 3 — Mengenbilanz gegen die Anlagenauslegung =========================
  // Für Gerät, Speicher und Armaturen gibt es keinen herleitbaren Sollwert.
  // Geprüft wird deshalb, dass der Auszug genau das führt, was die Auslegung
  // ausweist — nicht mehr (Doppelzählung) und nicht weniger (stille Lücke).

  const kreise = flaechenkreise(plan.circuits);

  // Die Gewerksumme in Metern ist Trasse (20,40 m) plus Dämmung (20,40 m);
  // beide Zahlen sind oben aus der Polyliniengeometrie hergeleitet.
  check('Rohrsumme des Gewerks: Trasse und Dämmung, je 20,40 m', gruppenmenge(mit, 'rohr', 'm'), 40.8, 0.01);
  // Und dieselbe Menge, gleich ob eine Auslegung vorliegt oder nicht — das
  // Rohrnetz im Grundriss ist von der Anlagenauslegung unabhängig.
  check(
    'Die Rohrmengen des Grundrisses hängen nicht an der Auslegung',
    gruppenmenge(mit, 'rohr', 'm'),
    gruppenmenge(ohne, 'rohr', 'm'),
    0.01,
  );
  // Satzform der Gruppe: Positionszahl, dann jede Menge in der Schreibweise
  // ihrer Einheit (Meter auf zwei Stellen, Dezimalkomma).
  check(
    'Der Gewerksatz nennt Positionszahl und Menge im Klartext',
    gruppe(mit, 'rohr')?.summary ?? '',
    '2 Positionen · 40,80 m',
  );
  check(
    'Gewerk „Geräte" erscheint genau dann, wenn Gerät oder Speicher ausgelegt sind',
    Boolean(gruppe(mit, 'geraet')),
    Boolean(plan.selected ?? plan.buffer.selected ?? plan.dhwStorage),
  );
  check(
    'Gewerk „Armaturen" erscheint genau dann, wenn eine Sicherheitsauslegung vorliegt',
    Boolean(gruppe(mit, 'armatur')),
    Boolean(plan.safety),
  );
  check(
    'Jede Pflichtarmatur der Sicherheitsauslegung steht genau einmal in der Liste',
    positionen(mit, (i) => i.origin === 'Sicherheitsauslegung der Anlage (Pflichtarmatur)').length,
    new Set((plan.safety?.fittings ?? []).map((f) => `${f.label}\u241F${f.spec}`)).size,
  );
  {
    // Doppelzählungsregel: eine Bauteilart, die die Sicherheitsliste führt,
    // darf nicht zusätzlich als erzeugtes Schema-Bauteil auftauchen.
    const gedeckt = new Set((plan.safety?.fittings ?? []).map((f) => SCHEMATIC_LEGEND[f.kind]?.name ?? ''));
    check(
      'Keine Pflichtarmatur wird über das erzeugte Anlagenschema ein zweites Mal gezählt',
      positionen(mit, (i) => i.origin === 'Anlagenschema, aus der Auslegung erzeugte Bauteile' && gedeckt.has(i.name)).length,
      0,
    );
  }
  check(
    'Fußbodenheizrohr: der Auszug führt die Rohrlänge der Auslegung',
    menge(mit, (i) => i.name === 'Fußbodenheizrohr'),
    kreise.reduce((s, k) => s + kreisRohrlaenge(k), 0),
    0.05,
  );
  check(
    'Heizkreise am Verteiler: der Auszug führt die Abgangszahl der Auslegung',
    menge(mit, (i) => i.name === 'Heizkreis am Verteiler'),
    kreise.reduce((s, k) => s + kreisAbgaenge(k), 0),
  );
  check(
    'Systemplatte: der Auszug führt die belegbare Fläche der Auslegung',
    menge(mit, (i) => i.name === 'Systemplatte oder Tackerbahn'),
    kreise.reduce((s, k) => s + kreisFlaeche(k), 0),
    0.05,
  );
  check(
    'Randdämmstreifen: der Auszug führt den lichten Umfang der versorgten Räume',
    menge(mit, (i) => i.name === 'Randdämmstreifen'),
    kreise.reduce((s, k) => s + kreisRaumIds(k).reduce((r, id) => r + (doc.rooms?.[id]?.perimeter ?? 0), 0), 0),
    0.05,
  );
  check(
    'Mit ausgelegter Flächenheizung entfällt die Notzählung der gesetzten Objekte',
    positionen(mit, (i) => i.trade === 'fbh' && i.name === 'Heizkreisverteiler').length,
    0,
  );

  // === 4 — Leeres Dokument =================================================

  check('Leeres Dokument: keine Position', leer.positionCount, 0);
  check(
    'Leeres Dokument: der Befund steht als Fehlerhinweis in der Liste, nicht als Ausnahme',
    leer.notes.some((n) => n.severity === 'error'),
    true,
  );

  // === 5 — Grenzfälle: fehlende Angaben ====================================
  // Die drei Fälle, in denen das Modell eine Zahl schuldig bleibt. Die Regel
  // des Dateikopfs gilt in allen dreien: was fehlt, wird gemeldet und nicht
  // überspielt — und keine Zeile behauptet eine Angabe, die es nicht gibt.

  {
    // Kanaltrasse: Länge statt Stückzahl. 4 m sind bestellbar, NaN und 0 nicht.
    const kanaele = buildMaterialSchedule(
      dokumentMitKanaelen(kanal('k-mass', 4), kanal('k-nan', Number.NaN), kanal('k-null', 0)),
    );
    check(
      'Kanaltrasse mit Baulänge steht mit ihren Metern in der Liste',
      menge(kanaele, (i) => i.trade === 'lueftung' && i.unit === 'm'),
      4,
      0.01,
    );
    check(
      'Ein Kanal ohne belastbare Baulänge erzeugt keine Bestellzeile',
      positionen(kanaele, (i) => i.trade === 'lueftung').length,
      1,
    );
    check(
      'Jeder weggefallene Kanal wird gemeldet, und die Meldung nennt das Objekt',
      kanaele.notes.filter((n) => n.severity === 'warn' && (n.text.includes('k-nan') || n.text.includes('k-null'))).length,
      2,
    );
  }

  {
    /*
     * Dämmung: ein Kriterium für Bestellzeile und Hinweis. Vier Leitungen,
     * davon eine gedämmt (9 mm), eine ausdrücklich ungedämmt (0) und zwei ohne
     * belastbare Angabe (NaN und ein negativer Wert). Jede hat ihre eigene
     * Nennweite, damit jede eine eigene Zeile bekommt und der Vergleich von
     * Zeilenzahl und Hinweiszahl überhaupt etwas aussagt.
     */
    const daemmung = buildMaterialSchedule(
      dokumentMitLeitungen(
        leitung('l-9', 9, 0.5, 16),
        leitung('l-0', 0, 0.5, 20),
        leitung('l-nan', Number.NaN, 0.5, 25),
        leitung('l-negativ', -20, 0.5, 32),
      ),
    );
    const ungedaemmt = positionen(daemmung, (i) => i.trade === 'rohr' && i.spec.includes('ungedämmt'));
    check('„ungedämmt" steht nur an der ausdrücklich mit 0 erfassten Leitung', ungedaemmt.length, 1);
    check(
      'Der Hinweis „ohne Dämmung" nennt genau die Zahl der Zeilen, die „ungedämmt" tragen',
      zahlImHinweis(daemmung, 'ohne Dämmung erfasst'),
      ungedaemmt.length,
    );
    check(
      'Eine unbrauchbare Dämmstärke wird als fehlende Angabe ausgewiesen, nicht als „ungedämmt"',
      positionen(daemmung, (i) => i.spec.includes('Dämmstärke nicht angegeben')).length,
      2,
    );
    check(
      'Die fehlenden Dämmstärken werden getrennt gemeldet, mit der Zahl der betroffenen Abschnitte',
      zahlImHinweis(daemmung, 'keine belastbare Dämmstärke'),
      2,
    );
    check(
      'Nur die wirklich gedämmte Leitung erzeugt eine Dämmposition — zehn Meter',
      menge(daemmung, (i) => i.name === 'Rohrdämmung'),
      10,
      0.01,
    );
  }

  {
    // Verlegehöhe, gleiche Höhe plus ein Rechenrest: die Trennung nach
    // Verlegeart darf davon nicht ausgelöst werden.
    const gleicheHoehe = buildMaterialSchedule(
      dokumentMitLeitungen(leitung('l-a', 9, 0.5), leitung('l-b', 9, 0.5), leitung('l-nan', 9, Number.NaN)),
    );
    check(
      'Eine unbrauchbare Verlegehöhe löst die Trennung nach Verlegeart nicht aus',
      positionen(gleicheHoehe, (i) => i.trade === 'rohr' && VERLEGEARTEN.some((v) => i.spec.includes(v))).length,
      0,
    );
    check(
      'Ohne Trennung stehen die drei Abschnitte als eine Position mit dreißig Metern',
      menge(gleicheHoehe, (i) => i.trade === 'rohr' && i.name === PIPE_SERVICE_LABELS['heating-flow']),
      30,
      0.01,
    );
    check('Die unbrauchbare Verlegehöhe wird gemeldet', zahlImHinweis(gleicheHoehe, 'keine belastbare Verlegehöhe'), 1);

    // Und mit tatsächlich verschiedenen Höhen: 0,05 m liegt im Fußboden,
    // 2,50 m unter der Decke — die dritte Leitung sagt gar nichts.
    const verschiedeneHoehen = buildMaterialSchedule(
      dokumentMitLeitungen(leitung('l-boden', 9, 0.05), leitung('l-decke', 9, 2.5), leitung('l-nan', 9, Number.NaN)),
    );
    const trassen = positionen(
      verschiedeneHoehen,
      (i) => i.trade === 'rohr' && i.name === PIPE_SERVICE_LABELS['heating-flow'],
    );
    check('Verschiedene Verlegehöhen trennen die Trassen in drei Positionen', trassen.length, 3);
    check(
      'Die belastbaren Höhen tragen ihre Verlegeart',
      trassen.filter((i) => VERLEGEARTEN.some((v) => i.spec.includes(v))).length,
      2,
    );
    check(
      'Eine Leitung ohne belastbare Höhe wird nicht zur Wandleitung erklärt',
      positionen(verschiedeneHoehen, (i) => i.spec.includes('an der Wand')).length,
      0,
    );
  }

  // === 6 — CSV =============================================================

  const csv = materialScheduleCsv(mit);
  const zeilen = csv.split('\r\n');
  const kopf = zeilen[0].replace(/^﻿/, '');

  check('CSV beginnt mit dem BOM, damit das deutsche Excel sie ohne Dialog öffnet', csv.startsWith('﻿'), true);
  check(
    'CSV-Zeilenzahl: Kopf, Positionen, Zusammenfassung und Hinweise',
    zeilen.length,
    mit.positionCount + mit.groups.length + mit.notes.length + 5,
  );
  check(
    'CSV-Kopfzeile benennt acht Spalten, getrennt durch Semikolon',
    kopf,
    'Pos;Gewerk;Bezeichnung;Technische Angabe;Menge;Einheit;Herkunft;Bemerkung',
  );
  check(
    'Jede Positionszeile hat dieselbe Spaltenzahl wie der Kopf',
    zeilen.slice(1, 1 + mit.positionCount).filter((z) => csvFelder(z).length !== csvFelder(kopf).length).length,
    0,
  );
  {
    const zeile = zeilen.slice(1, 1 + mit.positionCount).find((z) => csvFelder(z)[2] === PIPE_SERVICE_LABELS['heating-flow']);
    check('CSV-Menge in Meter: deutsches Dezimalkomma, zwei Nachkommastellen', csvFelder(zeile ?? '')[4], '20,40');
  }
  {
    const zeile = zeilen.slice(1, 1 + mit.positionCount).find((z) => csvFelder(z)[2] === 'Thermostatventil mit Kopf');
    check('CSV-Menge in Stück: ganzzahlig, ohne Dezimalkomma', csvFelder(zeile ?? '')[4], '4');
  }

  {
    /*
     * Das Quoting lässt sich am Referenzhaus nicht auslösen — dort kommt in
     * keinem Feld ein Semikolon vor. Deshalb ein Auszug von Hand, der genau
     * die Zeichen enthält, wegen derer gequotet wird.
     */
    const kuenstlich: MaterialSchedule = {
      projectName: 'Prüffall',
      groups: [],
      items: [
        {
          position: 1,
          trade: 'rohr',
          tradeLabel: MATERIAL_TRADE_LABELS.rohr,
          name: 'Rohr; mit Trennzeichen',
          spec: 'Bezeichnung "in Anführungszeichen"',
          quantity: 1.5,
          unit: 'm',
          origin: 'Prüffall',
        },
      ],
      positionCount: 1,
      notes: [],
    };
    const zeile = materialScheduleCsv(kuenstlich).split('\r\n')[1];
    const felder = csvFelder(zeile);
    check('Ein Feld mit Semikolon wird gequotet und bleibt ein Feld', felder.length, 8);
    check(
      'Anführungszeichen im Feld werden verdoppelt und lassen sich wieder lesen',
      felder[3],
      'Bezeichnung "in Anführungszeichen"',
    );
  }
}
