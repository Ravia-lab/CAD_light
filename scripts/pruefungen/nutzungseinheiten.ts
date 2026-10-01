/**
 * Prüfblock „Nutzungseinheiten".
 *
 * **Worum es geht.** § 60c Abs. 1 GModG knüpft die Pflicht zum hydraulischen
 * Abgleich an „sechs Wohnungen oder sonstige selbständige Nutzungseinheiten".
 * Diese Zahl stand bisher als getippte Angabe im Anlagenblatt; jetzt zählt sie
 * das Modell. Damit hängt an diesem Block eine Rechtsfolge, und jede Regel
 * braucht ihre Gegenprobe: Eine Zählung, die eine Einheit zu viel findet,
 * erfindet eine Pflicht; eine, die eine zu wenig findet, verschweigt sie.
 *
 * **Die drei Regeln, auf die es ankommt.**
 * 1. Eine Gemeinschaftsfläche ist **keine** selbständige Nutzungseinheit —
 *    ein Treppenhaus wird nicht bewohnt.
 * 2. Eine Einheit über zwei Geschosse ist **eine** Einheit — die Maisonette
 *    ist der Grund, warum die Zuordnung am Raum hängt und nicht am Geschoss.
 * 3. „Nicht erfasst" ist nicht „eins". Ein Gebäude ohne Zuordnung hat keine
 *    erfassten Einheiten, und daraus folgt keine Zahl.
 *
 * **Alle Sollwerte sind von Hand hergeleitet** — die Flächen stehen im
 * Aufbau des Prüfhauses unten, jede Summe ist dort nachzurechnen.
 */

import type { CheckFn } from './typ';
import type { BimDocument, Room } from '../../src/types/bim';
import {
  ABGLEICHPFLICHT_AB,
  EINHEIT_LABELS,
  einheitenAbgleich,
  einheitenstand,
  einheitsbilanzen,
  naechsterName,
  ohneEinheit,
  type EinheitArt,
} from '../../src/lib/nutzungseinheiten';

/**
 * Das Prüfhaus: zwei Geschosse, sechs Räume, vier Einheiten.
 *
 * ```
 * Einheit          Art              Räume                 Fläche    beheizt
 * Wohnung 1        wohnung          r1 (30), r2 (20)      50 m²     50 m²
 * Wohnung 2        wohnung          r3 (40 EG), r4 (25 OG) 65 m²    65 m²   ← Maisonette
 * Praxis           gewerbe          r5 (60)               60 m²     60 m²
 * Treppenhaus      gemeinschaft     r6 (12, unbeheizt)    12 m²      0 m²
 * ohne Zuordnung   —                r7 (8, unbeheizt)
 * ```
 *
 * Heizlast ist nur an r1 (900 W) und r3 (1100 W) zurückgeschrieben.
 */
function baueEinheitenhaus(): BimDocument {
  const raum = (
    id: string,
    levelId: string,
    area: number,
    isHeated: boolean,
    unitId?: string,
    normHeatLoad?: number,
  ): Room =>
    ({
      id,
      levelId,
      name: id,
      usage: 'living',
      area,
      isHeated,
      setpointTemperature: 20,
      airChangeRate: 0.5,
      innerPolygon: [],
      centroid: { x: 0, y: 0 },
      perimeter: 0,
      ...(unitId ? { unitId } : {}),
      ...(normHeatLoad === undefined ? {} : { normHeatLoad: { total: normHeatLoad } }),
    }) as unknown as Room;

  return {
    schemaVersion: 1,
    activeLevelId: 'eg',
    levels: {
      eg: { id: 'eg', name: 'EG', order: 0, elevation: 0, height: 2.5 },
      og: { id: 'og', name: 'OG', order: 1, elevation: 2.75, height: 2.5 },
    },
    nodes: {},
    walls: {},
    openings: {},
    fixtures: {},
    rooms: {
      r1: raum('r1', 'eg', 30, true, 'w1', 900),
      r2: raum('r2', 'eg', 20, true, 'w1'),
      r3: raum('r3', 'eg', 40, true, 'w2', 1100),
      r4: raum('r4', 'og', 25, true, 'w2'),
      r5: raum('r5', 'eg', 60, true, 'g1'),
      r6: raum('r6', 'eg', 12, false, 'gm1'),
      r7: raum('r7', 'og', 8, false),
    },
    units: {
      w1: { id: 'w1', name: 'Wohnung 1', art: 'wohnung' },
      w2: { id: 'w2', name: 'Wohnung 2', art: 'wohnung' },
      g1: { id: 'g1', name: 'Praxis', art: 'gewerbe' },
      gm1: { id: 'gm1', name: 'Treppenhaus', art: 'gemeinschaft' },
    },
    diagnostics: { openEnds: [], gaps: [], nearMisses: [] },
    meta: {},
  } as unknown as BimDocument;
}

export function pruefeNutzungseinheiten(check: CheckFn): void {
  const doc = baueEinheitenhaus();
  const bilanzen = einheitsbilanzen(doc);
  const von = (id: string) => bilanzen.find((b) => b.einheit.id === id);

  // -------------------------------------------------------------------------
  // 1 · Die Bilanz je Einheit
  // -------------------------------------------------------------------------
  check('Nutzungseinheiten · vier Einheiten', bilanzen.length, 4);

  // Wohnung 1: r1 (30) + r2 (20) = 50 m², beide beheizt.
  const w1 = von('w1');
  check('Nutzungseinheiten · Wohnung 1 hat zwei Räume', w1?.raeume ?? -1, 2);
  check('Nutzungseinheiten · Wohnung 1 50 m²', w1?.flaeche ?? -1, 50);
  check('Nutzungseinheiten · davon 50 m² beheizt', w1?.beheizteFlaeche ?? -1, 50);
  // Nur r1 trägt eine zurückgeschriebene Heizlast: 900 W. r2 trägt nichts
  // bei — und zwar 0 und nicht geschätzt.
  check('Nutzungseinheiten · Heizlast ist die Summe des Vorliegenden', w1?.heizlastW ?? -1, 900);
  check('Nutzungseinheiten · ein Geschoss', w1?.geschosse.length ?? -1, 1);
  check('Nutzungseinheiten · keine Maisonette', w1?.maisonette ?? true, false);

  // -------------------------------------------------------------------------
  // 2 · Die Maisonette — der Grund für die Zuordnung am Raum
  // -------------------------------------------------------------------------
  // Wohnung 2: r3 (40 m², EG) + r4 (25 m², OG) = 65 m² über zwei Geschosse.
  const w2 = von('w2');
  check('Nutzungseinheiten · Maisonette 65 m²', w2?.flaeche ?? -1, 65);
  check('Nutzungseinheiten · über zwei Geschosse', w2?.geschosse.length ?? -1, 2);
  check('Nutzungseinheiten · und als Maisonette gemeldet', w2?.maisonette ?? false, true);
  // **Die Gegenprobe:** Sie ist eine Einheit und nicht zwei. Würde die
  // Zuordnung am Geschoss hängen, stünde hier 2 — und das Haus hätte eine
  // Wohnung zu viel.
  check('Nutzungseinheiten · Maisonette zählt einmal',
    bilanzen.filter((b) => b.einheit.id === 'w2').length, 1);
  check('Nutzungseinheiten · Heizlast quer über die Geschosse', w2?.heizlastW ?? -1, 1100);

  // -------------------------------------------------------------------------
  // 3 · Die Gemeinschaftsfläche zählt nicht mit
  // -------------------------------------------------------------------------
  // Treppenhaus: 12 m² Fläche, 0 m² beheizt — unbeheizt zugeordnet.
  const gm = von('gm1');
  check('Nutzungseinheiten · Treppenhaus 12 m²', gm?.flaeche ?? -1, 12);
  check('Nutzungseinheiten · davon nichts beheizt', gm?.beheizteFlaeche ?? -1, 0);
  check('Nutzungseinheiten · und kein beheizter Raum', gm?.beheizteRaeume ?? -1, 0);

  // -------------------------------------------------------------------------
  // 4 · Der Stand des Gebäudes
  // -------------------------------------------------------------------------
  // Gezählt: 2 Wohnungen + 1 Gewerbe + 1 Gemeinschaft = 4 Einheiten,
  // davon selbständig im Sinne des § 60c: 2 + 1 = 3.
  const stand = einheitenstand(doc);
  check('Nutzungseinheiten · gesamt vier', stand.gesamt, 4);
  check('Nutzungseinheiten · zwei Wohnungen', stand.wohnungen, 2);
  check('Nutzungseinheiten · eine Gewerbeeinheit', stand.gewerbe, 1);
  check('Nutzungseinheiten · eine Gemeinschaftsfläche', stand.gemeinschaft, 1);
  check('Nutzungseinheiten · drei selbständige', stand.selbstaendig, 3);
  // **Die Gegenprobe zur Schwelle:** 3 < 6, also keine Pflicht. Eine Regel,
  // die hier `true` ergäbe, erfände eine Rechtspflicht.
  check('Nutzungseinheiten · drei lösen keine Abgleichpflicht aus', stand.abgleichpflicht, false);
  check('Nutzungseinheiten · die Schwelle steht bei sechs', ABGLEICHPFLICHT_AB, 6);
  check('Nutzungseinheiten · die Maisonette ist benannt', stand.maisonetten.join(', '), 'Wohnung 2');
  check('Nutzungseinheiten · keine leere Einheit', stand.leer.length, 0);
  // r7 ist der einzige Raum ohne Zuordnung.
  check('Nutzungseinheiten · ein Raum ohne Zuordnung', stand.raeumeOhne, 1);
  check('Nutzungseinheiten · und zwar r7', ohneEinheit(doc).map((r) => r.id).join(', '), 'r7');

  // -------------------------------------------------------------------------
  // 5 · Die Schwelle, von unten und von oben
  // -------------------------------------------------------------------------
  // Fünf Wohnungen plus eine Gemeinschaftsfläche: sechs Einheiten, aber nur
  // fünf selbständige — **keine** Pflicht. Genau dieser Fall ist der, bei dem
  // eine Zählung „alles, was da ist" falsch läge.
  const fuenf = baueEinheitenhaus();
  fuenf.units = Object.fromEntries([
    ...[1, 2, 3, 4, 5].map((i) => [`w${i}`, { id: `w${i}`, name: `Wohnung ${i}`, art: 'wohnung' as EinheitArt }]),
    ['gm1', { id: 'gm1', name: 'Treppenhaus', art: 'gemeinschaft' as EinheitArt }],
  ]);
  const standFuenf = einheitenstand(fuenf);
  check('Nutzungseinheiten · sechs Einheiten …', standFuenf.gesamt, 6);
  check('Nutzungseinheiten · … aber nur fünf selbständige', standFuenf.selbstaendig, 5);
  check('Nutzungseinheiten · und damit keine Pflicht', standFuenf.abgleichpflicht, false);

  // Eine Wohnung mehr: sechs selbständige — jetzt greift § 60c Abs. 1.
  const sechs = baueEinheitenhaus();
  sechs.units = Object.fromEntries(
    [1, 2, 3, 4, 5, 6].map((i) => [`w${i}`, { id: `w${i}`, name: `Wohnung ${i}`, art: 'wohnung' as EinheitArt }]),
  );
  check('Nutzungseinheiten · sechs selbständige lösen sie aus',
    einheitenstand(sechs).abgleichpflicht, true);

  // Fünf Wohnungen und eine Gewerbeeinheit: auch sechs selbständige. Die
  // Praxis im Erdgeschoss ist eine „sonstige selbständige Nutzungseinheit".
  const gemischt = baueEinheitenhaus();
  gemischt.units = Object.fromEntries([
    ...[1, 2, 3, 4, 5].map((i) => [`w${i}`, { id: `w${i}`, name: `Wohnung ${i}`, art: 'wohnung' as EinheitArt }]),
    ['g1', { id: 'g1', name: 'Praxis', art: 'gewerbe' as EinheitArt }],
  ]);
  check('Nutzungseinheiten · Wohnung und Gewerbe zählen zusammen',
    einheitenstand(gemischt).abgleichpflicht, true);

  // -------------------------------------------------------------------------
  // 6 · Leere Einheiten — angelegt ist nicht belegt
  // -------------------------------------------------------------------------
  const leer = baueEinheitenhaus();
  leer.units = { ...leer.units, w9: { id: 'w9', name: 'Wohnung 9', art: 'wohnung' } };
  const standLeer = einheitenstand(leer);
  // Sie zählt mit — sie ist erfasst. Aber sie wird als leer benannt, damit
  // niemand eine Wohnung im Nachweis hat, zu der kein Raum gehört.
  check('Nutzungseinheiten · die leere Einheit zählt mit', standLeer.selbstaendig, 4);
  check('Nutzungseinheiten · und wird benannt', standLeer.leer.join(', '), 'Wohnung 9');
  check('Nutzungseinheiten · mit leerer Raumliste',
    einheitsbilanzen(leer).find((b) => b.einheit.id === 'w9')?.roomIds.length ?? -1, 0);

  // -------------------------------------------------------------------------
  // 7 · „Nicht erfasst" ist nicht „eins"
  // -------------------------------------------------------------------------
  const ohne = baueEinheitenhaus();
  ohne.units = {};
  check('Nutzungseinheiten · ohne Zuordnung keine Bilanz', einheitsbilanzen(ohne).length, 0);
  check('Nutzungseinheiten · und keine Einheit', einheitenstand(ohne).gesamt, 0);
  check('Nutzungseinheiten · erst recht keine Pflicht', einheitenstand(ohne).abgleichpflicht, false);
  // Und kein Vergleich: Wer nichts zuordnet, bekommt keine Rückfrage zu einer
  // Zahl, die er von Hand gesetzt hat.
  check('Nutzungseinheiten · kein Abgleich ohne Einheiten', einheitenAbgleich(ohne, 4) === undefined, true);

  // -------------------------------------------------------------------------
  // 8 · Der Vergleich mit der getippten Zahl
  // -------------------------------------------------------------------------
  // Das Haus hat 3 selbständige Einheiten. Eingetragen sind 4 → Widerspruch.
  const falsch = einheitenAbgleich(doc, 4);
  check('Nutzungseinheiten · Widerspruch erkannt', falsch?.stimmt ?? true, false);
  check('Nutzungseinheiten · gezählt drei', falsch?.gezaehlt ?? -1, 3);
  check('Nutzungseinheiten · eingetragen vier', falsch?.eingetragen ?? -1, 4);
  // Gegenprobe: Steht 3 im Anlagenblatt, ist nichts zu melden.
  check('Nutzungseinheiten · und bei drei stimmt es', einheitenAbgleich(doc, 3)?.stimmt ?? false, true);
  // Die Gemeinschaftsfläche ist dabei **nicht** mitgezählt: Wer sie mitzählte,
  // käme auf 4 und hielte den falschen Eintrag für richtig.
  check('Nutzungseinheiten · die Gemeinschaftsfläche bleibt draußen',
    einheitenAbgleich(doc, 4)?.gezaehlt ?? -1, 3);

  // -------------------------------------------------------------------------
  // 9 · Der Namensvorschlag
  // -------------------------------------------------------------------------
  // Vorhanden sind „Wohnung 1" und „Wohnung 2" → der Vorschlag ist 3.
  check('Nutzungseinheiten · nächste Wohnung', naechsterName(doc, 'wohnung'), 'Wohnung 3');
  // „Praxis" passt auf kein Muster „Gewerbeeinheit <n>" → der Vorschlag
  // beginnt bei 1. Ein Name, den jemand selbst gesetzt hat, wird nicht
  // umgedeutet, nur weil er zur Art gehört.
  check('Nutzungseinheiten · erste Gewerbeeinheit', naechsterName(doc, 'gewerbe'), 'Gewerbeeinheit 1');
  // Nummern werden nicht wiederverwendet: „Wohnung 1" bis „Wohnung 4", die 2
  // gelöscht → der Vorschlag ist 5 und nicht 2. Zwei verschiedene Wohnungen
  // dürfen im Schriftverkehr nicht gleich heißen.
  const nachLoeschen = baueEinheitenhaus();
  nachLoeschen.units = {
    w1: { id: 'w1', name: 'Wohnung 1', art: 'wohnung' },
    w3: { id: 'w3', name: 'Wohnung 3', art: 'wohnung' },
    w4: { id: 'w4', name: 'Wohnung 4', art: 'wohnung' },
  };
  check('Nutzungseinheiten · Nummern werden nicht wiederverwendet',
    naechsterName(nachLoeschen, 'wohnung'), 'Wohnung 5');

  // -------------------------------------------------------------------------
  // 10 · Die Beschriftungen
  // -------------------------------------------------------------------------
  check('Nutzungseinheiten · drei Arten', Object.keys(EINHEIT_LABELS).length, 3);
  check('Nutzungseinheiten · Wohnung heißt Wohnung', EINHEIT_LABELS.wohnung, 'Wohnung');
  check('Nutzungseinheiten · Gemeinschaft heißt Gemeinschaftsfläche',
    EINHEIT_LABELS.gemeinschaft, 'Gemeinschaftsfläche');
}
