/**
 * Prüfblock „Werkzeugkiste" — setzen, während man im Haus steht.
 *
 * **Warum dieser Block gebraucht wird.** Im Begehen-Modus gibt es keine
 * Liste, keinen Inspektor und keine zweite Chance: Man zielt mit dem
 * Fadenkreuz, liest eine Zeile und drückt einen Knopf. Alles, was dieser
 * Knopf wissen muss — was in der Kiste liegt, worauf der Strahl gezeigt hat,
 * ob dort überhaupt gesetzt werden darf und mit welcher Zahl das Ergebnis
 * gemeldet wird —, steckt in `src/lib/werkzeugkiste.ts`. Ein Fehler darin
 * fällt in der Bedienung **nicht** auf: Ein Knopf, der nichts tut, sieht aus
 * wie ein Knopf, den man nicht richtig getroffen hat, und ein Heizkörper, der
 * vier Meter neben dem Zielpunkt landet, sieht in der 3D-Ansicht aus wie ein
 * Darstellungsfehler.
 *
 * **Die vier Aussagen, die hier festgenagelt werden.**
 *
 * 1. *Die Kiste ist in sich stimmig.* Jedes Werkzeug hat eine eindeutige
 *    Kennung, eine Beschriftung, eine Zielzeile — und die Felder passen zu
 *    seiner Art. Ein Tippfehler in einem Fixture-Typ (`radiatr` statt
 *    `radiator`) erzeugt sonst einen Knopf, der in der Leiste steht, sich
 *    drücken lässt und nichts anlegt.
 * 2. *Es wird vorher gesagt, was passiert.* `darfSetzen` urteilt **vor** dem
 *    Auslösen. Wer einen wandgebundenen Heizkörper mitten in den Raum setzt,
 *    bekommt keinen Heizkörper an der Wand hinter sich, sondern eine
 *    Begründung.
 * 3. *Die Deutung ist dieselbe wie im Grundriss.* `deuteZiel` reicht den Punkt
 *    an `deuteTreffer` weiter. Der Block prüft, dass dabei Wand, Wandabstand
 *    und Raum ankommen — und dass ein getroffenes Objekt die Deutung gar nicht
 *    erst auslöst.
 * 4. *Die Zahlen sind Maße, keine Anzeigen.* Sturzhöhe, Trassenlänge,
 *    Verlegehöhe und die Randlage eines Durchbruchs werden auf der Baustelle
 *    angerissen. Alle Sollwerte unten sind im Kommentar von Hand ausgerechnet;
 *    keiner stammt aus einem Probelauf.
 *
 * Schichtgrenze wie überall: nur `src/lib` und `src/types`, kein Store, keine
 * Oberfläche. Ob das Fadenkreuz sichtbar ist und der Knopf reagiert, ist Sache
 * des Rauchtests.
 */

import type { CheckFn } from './typ';
import type {
  BimDocument,
  BimNode,
  Durchbruch,
  Fixture,
  Level,
  Wall,
} from '../../src/types/bim';
import { FIXTURE_BY_TYPE } from '../../src/types/bim';
import { emptyPlant, emptySite } from '../../src/lib/plantDefaults';
import { detectRooms } from '../../src/lib/roomDetection';
import {
  ANSCHLUSS_AUSWAHL,
  VENTIL_AUSWAHL,
  WERKZEUGE,
  WERKZEUG_BY_ID,
  anschlussKurz,
  aufputz,
  darfSetzen,
  deuteZiel,
  durchbruchAmRand,
  durchbruchMeldung,
  durchbruchPreset,
  mediumName,
  rohrHoehe,
  rohrLaenge,
  rohrMeldung,
  sturzAusZiel,
  zielAuskunft,
} from '../../src/lib/werkzeugkiste';

// ---------------------------------------------------------------------------
// Das Prüfhaus — ein Zimmer, damit jede Zahl von Hand nachrechenbar bleibt
// ---------------------------------------------------------------------------

/** Achsmaße [m]: Rechteck 6,00 × 4,00, Wandstärke 0,24, lichte Höhe 2,75. */
const BREITE = 6;
const TIEFE = 4;
const DICKE = 0.24;
const HOEHE = 2.75;

/** Die Südwand läuft von (0|0) nach (6|0) — ihre Achslänge ist damit 6,00 m. */
const SUEDWAND = 'w-s';
const SUEDWAND_LAENGE = BREITE;

function geschoss(): Level {
  return {
    id: 'eg',
    name: 'EG',
    order: 0,
    elevation: 0,
    height: HOEHE,
    floorUValue: 0.35,
    floorBoundary: 'ground',
    ceilingUValue: 0.2,
    ceilingBoundary: 'unheated',
  };
}

/**
 * Das Prüfhaus samt erkanntem Raum und einem Heizkörper an der Südwand.
 *
 * Die Räume kommen aus `detectRooms` und nicht aus der Hand: `deuteZiel`
 * fragt am Ende `pointInPolygon` gegen das **lichte** Polygon, und ein von
 * Hand hingeschriebenes Polygon würde genau die Umrechnung überspringen, an
 * der sich entscheidet, ob ein Punkt 12 cm vor der Wand noch im Raum liegt.
 */
function baueHaus(): BimDocument {
  const nodes: Record<string, BimNode> = {
    sw: { id: 'sw', x: 0, y: 0, levelId: 'eg' },
    se: { id: 'se', x: BREITE, y: 0, levelId: 'eg' },
    ne: { id: 'ne', x: BREITE, y: TIEFE, levelId: 'eg' },
    nw: { id: 'nw', x: 0, y: TIEFE, levelId: 'eg' },
  };
  const wand = (id: string, a: string, b: string): Wall => ({
    id,
    a,
    b,
    levelId: 'eg',
    type: 'exterior',
    thickness: DICKE,
    uValue: 0.28,
    height: HOEHE,
    layerId: 'layer-walls',
  });
  const walls: Record<string, Wall> = {
    [SUEDWAND]: wand(SUEDWAND, 'sw', 'se'),
    'w-o': wand('w-o', 'se', 'ne'),
    'w-n': wand('w-n', 'ne', 'nw'),
    'w-w': wand('w-w', 'nw', 'sw'),
  };

  const heizkoerper: Fixture = {
    id: 'hk',
    type: 'radiator',
    category: 'heating',
    levelId: 'eg',
    position: { x: 2, y: 0.17 },
    rotation: 0,
    length: 1,
    depth: 0.1,
    elevation: 0.15,
    wallId: SUEDWAND,
    label: 'Heizkörper Wohnen',
    params: { powerW: 1200 },
  };

  const doc: BimDocument = {
    site: emptySite(),
    plant: emptyPlant(),
    meta: {
      name: 'Prüfhaus Werkzeugkiste',
      createdAt: '2026-01-01T00:00:00.000Z',
      modifiedAt: '2026-01-01T00:00:00.000Z',
      northAngle: 0,
      designOutdoorTemperature: -12,
      designIndoorTemperature: 20,
      n50: 1.5,
      shielding: 'moderate',
      unheatedTemperature: 10,
      groundTemperature: 10,
      thermalBridgeSupplement: 0,
      thermalBridgeMethod: 'flat',
      thermalBridgeCategory: 'custom',
      reheatFactor: 0,
    },
    levels: { eg: geschoss() },
    layers: {},
    nodes,
    walls,
    openings: {},
    fixtures: { hk: heizkoerper },
    verticals: {},
    solids: {},
    durchbrueche: {},
    pipes: {},
    annotations: {},
    roofOpenings: {},
    rooms: {},
    constructions: {},
    diagnostics: { openEnds: [] },
    activeLevelId: 'eg',
  };

  for (const r of detectRooms({
    nodes: doc.nodes,
    walls: Object.values(doc.walls),
    openings: [],
    levelId: 'eg',
    defaultHeight: HOEHE,
    northAngle: 0,
  })) {
    r.name = 'Wohnen';
    r.setpointTemperature = 20;
    r.isHeated = true;
    doc.rooms[r.id] = r;
  }
  return doc;
}

/** Ein Zieltreffer, wie ihn der Strahl liefert — vor der Deutung. */
function roh(x: number, y: number, hoehe: number, entfernung: number, fixtureId?: string) {
  return { punkt: { x, y }, hoehe, entfernung, fixtureId };
}

const r3 = (v: number): number => Math.round(v * 1000) / 1000;

// ---------------------------------------------------------------------------

export function pruefeWerkzeugkiste(check: CheckFn): void {
  const doc = baueHaus();

  // =========================================================================
  // 1 · Die Kiste selbst
  // =========================================================================
  //
  // Warum das eine Prüfung wert ist: Die Leiste im Begehen-Modus wird aus
  // `WERKZEUGE` erzeugt. Steht dort ein Fixture-Typ, den es nicht gibt, so
  // entsteht trotzdem ein Knopf — er sieht aus wie die anderen, lässt sich
  // drücken und legt nichts an. In der Bedienung ist das nicht von einem
  // Fehlgriff zu unterscheiden; hier ist es eine Zeile im Protokoll.

  check('Die Kiste ist nicht leer', WERKZEUGE.length > 0, true);
  check(
    'Jedes Werkzeug hat eine eigene Kennung',
    new Set(WERKZEUGE.map((w) => w.id)).size,
    WERKZEUGE.length,
  );
  check(
    'Der Zugriff über die Kennung findet jedes Werkzeug',
    WERKZEUGE.every((w) => WERKZEUG_BY_ID[w.id] === w),
    true,
  );

  {
    // Gesammelt statt je Werkzeug einzeln geprüft: So nennt die eine
    // scheiternde Zeile im Protokoll die Kennung des schuldigen Werkzeugs
    // und den Grund — bei acht Einzelzeilen müsste man erst nachzählen.
    const maengel: string[] = [];
    for (const w of WERKZEUGE) {
      if (!w.id.trim()) maengel.push('Werkzeug ohne Kennung');
      if (!w.label.trim()) maengel.push(`${w.id}: ohne Beschriftung`);
      if (!w.ziel.trim()) maengel.push(`${w.id}: ohne Zielzeile`);

      if (w.art === 'objekt') {
        if (!w.fixture) maengel.push(`${w.id}: Objekt ohne Fixture-Typ`);
        else if (!FIXTURE_BY_TYPE[w.fixture]) maengel.push(`${w.id}: Fixture-Typ „${w.fixture}" gibt es nicht`);
      } else if (w.fixture) {
        maengel.push(`${w.id}: Fixture-Typ an einem Werkzeug der Art „${w.art}"`);
      }

      if (w.art === 'armatur') {
        if (!w.armatur) maengel.push(`${w.id}: Armatur ohne Armaturenart`);
      } else if (w.armatur) {
        maengel.push(`${w.id}: Armaturenart an einem Werkzeug der Art „${w.art}"`);
      }

      if (w.art === 'durchbruch') {
        if (!w.preset) maengel.push(`${w.id}: Durchbruch ohne Regelmaß`);
        else if (!durchbruchPreset(w.preset)) maengel.push(`${w.id}: Regelmaß „${w.preset}" gibt es nicht`);
      } else if (w.preset) {
        maengel.push(`${w.id}: Regelmaß an einem Werkzeug der Art „${w.art}"`);
      }
    }
    check('Jedes Werkzeug ist vollständig und passt zu seiner Art', maengel.join(' | ') || 'ohne Mängel', 'ohne Mängel');
  }

  // Gegenprobe: Die Prüfung oben fällt nur auf, wenn ein falscher Typ
  // tatsächlich als unbekannt erkannt wird. Wäre `FIXTURE_BY_TYPE` etwa eine
  // Map mit Vorgabewert, ginge jeder Tippfehler durch und die Schleife wäre
  // eine leere Behauptung.
  check('Ein Tippfehler im Fixture-Typ gilt als unbekannt', Boolean(FIXTURE_BY_TYPE['radiatr']), false);
  check('Ein Tippfehler im Regelmaß liefert nichts', durchbruchPreset('kb-dn25x') === null, true);
  check('Ohne Regelmaß-Kennung gibt es keinen stillen Rückfall', durchbruchPreset(undefined) === null, true);

  // Die Unterauswahl am Heizkörper.
  check('Alle vier Anschlussarten stehen zur Wahl', ANSCHLUSS_AUSWAHL.length, 4);
  check(
    'Jede Anschlussart ist eine eigene',
    new Set(ANSCHLUSS_AUSWAHL).size,
    ANSCHLUSS_AUSWAHL.length,
  );
  // „nicht erfasst" muss in der Liste stehen und an erster Stelle: Wer die
  // Ventilseite im Bestand nicht ablesen kann, darf sie nicht raten müssen.
  check('Die Ventilseite darf offen bleiben', VENTIL_AUSWAHL[0] === null, true);
  check('Und sonst gibt es links und rechts', VENTIL_AUSWAHL.length, 3);

  // =========================================================================
  // 2 · Die Kurzform des Anschlusses
  // =========================================================================
  //
  // Die Ventilseite wird nur angehängt, wenn sie erfasst ist. Ein
  // „Mittelanschluss unten · " mit leerem Ende sähe aus wie ein Datenfehler,
  // ein erfundenes „Ventil rechts" wäre einer.
  check('Anschluss ohne erfasste Ventilseite', anschlussKurz('mitte', null), 'Mittelanschluss unten');
  check('Anschluss mit Ventilseite', anschlussKurz('mitte', 'links'), 'Mittelanschluss unten · Ventil links');
  check(
    'Auch beim wechselseitigen Anschluss',
    anschlussKurz('wechselseitig', 'rechts'),
    'oben/unten wechselseitig · Ventil rechts',
  );

  // =========================================================================
  // 3 · Was das Fadenkreuz getroffen hat
  // =========================================================================
  {
    // Ein Punkt auf der Achse der Südwand bei u = 2,00 m, Zielhöhe 1,2344 m,
    // Entfernung 3,216 m. Höhe wird auf Millimeter, Entfernung auf Zentimeter
    // gerundet — mehr ist beim Zielen von Hand nicht abzulesen.
    const anWand = deuteZiel(doc, 'eg', roh(2, 0, 1.2344, 3.216));
    check('An der Wand steht die Wand', anWand.wallId ?? 'keine', SUEDWAND);
    check('… mit dem Abstand vom Wandanfang', r3(anWand.wandAbstand ?? -1), 2);
    check(
      '… und der liegt zwischen null und Wandlänge',
      (anWand.wandAbstand ?? -1) >= 0 && (anWand.wandAbstand ?? -1) <= SUEDWAND_LAENGE,
      true,
    );
    check('An der Wand gibt es keinen Raumtreffer', anWand.roomId === undefined, true);
    check('Die Höhe wird auf Millimeter gerundet', anWand.hoehe, 1.234, 1e-12);
    check('Die Entfernung auf Zentimeter', anWand.entfernung, 3.22, 1e-12);

    // Am Wandanfang und am Wandende: die Randwerte der Achsmessung.
    check('Am Wandanfang ist der Abstand null', r3(deuteZiel(doc, 'eg', roh(0, 0, 1, 1)).wandAbstand ?? -1), 0);
    check(
      'Am Wandende ist er die Wandlänge',
      r3(deuteZiel(doc, 'eg', roh(BREITE, 0, 1, 1)).wandAbstand ?? -1),
      SUEDWAND_LAENGE,
    );

    // Mitten im Zimmer: jetzt ist der Raum gemeint (Boden, Decke, Luftraum).
    const imRaum = deuteZiel(doc, 'eg', roh(3, 2, 0, 2.5));
    check('Mitten im Raum steht der Raum', Boolean(imRaum.roomId), true);
    check('… und keine Wand', imRaum.wallId === undefined, true);

    // Ein getroffenes Objekt wird gar nicht erst gedeutet. Sonst bekäme ein
    // Heizkörper, der an der Wand hängt, zusätzlich deren Kennung — und das
    // Beschriften träfe die Wand statt des Heizkörpers.
    const aufObjekt = deuteZiel(doc, 'eg', roh(2, 0, 0.6, 1.8, 'hk'));
    check('Auf einem Objekt zählt das Objekt', aufObjekt.fixtureId ?? 'keines', 'hk');
    check('… und die Wand dahinter wird nicht gedeutet', aufObjekt.wallId === undefined, true);
    check('… der Raum ebenso wenig', aufObjekt.roomId === undefined, true);

    // Weit außerhalb: weder Wand noch Raum. Gesetzt werden darf trotzdem —
    // nur eben nichts Wandgebundenes.
    const draussen = deuteZiel(doc, 'eg', roh(20, 20, 1, 9));
    check('Weit draußen gibt es nichts zu deuten', draussen.wallId === undefined && draussen.roomId === undefined, true);
  }

  // =========================================================================
  // 4 · Die Zeile am Fadenkreuz
  // =========================================================================
  {
    const anWand = deuteZiel(doc, 'eg', roh(2, 0, 1, 3.2));
    // Die Wandstärke in Millimeter, weil danach die Bohrkrone gewählt wird —
    // „0,24 m" liest niemand auf der Baustelle.
    check('Die Wand nennt ihre Dicke, die Entfernung und die Höhe', zielAuskunft(doc, anWand), 'Wand 240 mm · 3,20 m · +1,00 m');

    const imRaum = deuteZiel(doc, 'eg', roh(3, 2, 0, 2.5));
    check('Der Raum nennt seinen Namen', zielAuskunft(doc, imRaum), 'Wohnen · 2,50 m · +0,00 m');

    const aufObjekt = deuteZiel(doc, 'eg', roh(2, 0, 0.6, 1.8, 'hk'));
    check('Das Objekt nennt seine Bezeichnung', zielAuskunft(doc, aufObjekt), 'Heizkörper Wohnen · 1,80 m · +0,60 m');

    // Ohne Ziel eine Zeile, die den Zustand benennt — nicht ein leeres Feld,
    // bei dem man nicht weiß, ob das Programm noch rechnet.
    check('Ohne Ziel eine verständliche Zeile', zielAuskunft(doc, null), 'kein Ziel — es liegt nichts in Blickrichtung');
  }

  // =========================================================================
  // 5 · Darf hier gesetzt werden?
  // =========================================================================
  {
    const anWand = deuteZiel(doc, 'eg', roh(2, 0, 0.5, 3.2));
    const imRaum = deuteZiel(doc, 'eg', roh(3, 2, 0, 2.5));
    const aufObjekt = deuteZiel(doc, 'eg', roh(2, 0, 0.6, 1.8, 'hk'));

    const heizkoerper = WERKZEUG_BY_ID['heizkoerper'];
    const speicher = WERKZEUG_BY_ID['speicher'];
    const rohr = WERKZEUG_BY_ID['rohr'];
    const durchbruch = WERKZEUG_BY_ID['durchbruch'];
    const beschriften = WERKZEUG_BY_ID['beschriften'];

    // Ohne Ziel tut der Knopf nichts und sagt, was fehlt.
    check('Ohne Ziel wird nicht gesetzt', darfSetzen(heizkoerper, null).moeglich, false);
    check('… und der Knopf sagt, was zu tun ist', darfSetzen(heizkoerper, null).text, 'Erst auf eine Fläche zielen');

    /*
     * Der Fall, um den es eigentlich geht.
     *
     * `addFixture` bindet ein wandgebundenes Objekt an die nächste Wand in
     * Reichweite. Zielt man mitten in den Raum, ist das die Wand hinter dem
     * Rücken — der Heizkörper springt beim Setzen um mehrere Meter. Das sah
     * in der 3D-Ansicht aus wie ein Fehler in der Umrechnung und war in
     * Wahrheit ein Zielfehler. Deshalb muss die Sperre **hier** greifen, vor
     * dem Auslösen, und nicht erst im Speicher.
     */
    const ohneWand = darfSetzen(heizkoerper, imRaum);
    check('Ein Heizkörper ohne Wand wird gesperrt', ohneWand.moeglich, false);
    check('… mit Begründung statt Fehlermeldung', ohneWand.text, 'Heizkörper gehört an eine Wand — auf die Wandfläche zielen');
    const mitWand = darfSetzen(heizkoerper, anWand);
    check('An der Wand ist er frei', mitWand.moeglich, true);
    check('… und der Knopf sagt, was er tut', mitWand.text, 'Heizkörper setzen');

    // Ein Speicher steht frei; an einer Wand steht er davor, nicht darin.
    check('Ein Speicher darf mitten im Raum stehen', darfSetzen(speicher, imRaum).moeglich, true);
    check('Vor der Wand steht er davor', darfSetzen(speicher, anWand).text, 'Speicher vor die Wand setzen');

    // Der Durchbruch braucht eine Wand — ein Loch im Boden ist ein anderes
    // Bauteil, und eines in der Luft gibt es nicht.
    check('Ein Durchbruch mitten im Raum wird gesperrt', darfSetzen(durchbruch, imRaum).moeglich, false);
    check('… mit Begründung', darfSetzen(durchbruch, imRaum).text, 'Ein Durchbruch braucht eine Wandfläche');
    check('An der Wand ist er frei', darfSetzen(durchbruch, anWand).moeglich, true);
    check('… und die Zeile nennt die Zielhöhe', darfSetzen(durchbruch, anWand).text, 'Durchbruch in die Wand auf +0,50 m');

    // Beschriften braucht ein Bauteil: eine Fahne an einer Wandfläche hätte
    // keinen Anker, und damit keinen Modellwert, den sie abschreiben könnte.
    check('Beschriften ohne Bauteil wird gesperrt', darfSetzen(beschriften, anWand).moeglich, false);
    check('… mit Begründung', darfSetzen(beschriften, anWand).text, 'Auf ein Bauteil zielen, das benannt werden soll');
    check('Am Bauteil ist es frei', darfSetzen(beschriften, aufObjekt).moeglich, true);

    /*
     * Das Rohr ist der einzige Zweipunkt-Fall. Der Knopf muss deshalb zwei
     * verschiedene Dinge ankündigen, sonst weiß man nach dem ersten Druck
     * nicht, ob man gerade den Anfang gesetzt hat oder ob nichts passiert
     * ist. Beim zweiten Druck steht die Länge dabei — sie ist das Maß, nach
     * dem später Material bestellt wird.
     */
    check('Zuerst fragt das Rohr nach dem Anfang', darfSetzen(rohr, anWand).text, 'Anfang der Leitung setzen');
    // Anfang bei (2|0), Ende bei (3|2): √(1² + 2²) = √5 = 2,2360679… → 2,24 m.
    const mitAnfang = darfSetzen(rohr, imRaum, { punkt: { x: 2, y: 0 }, hoehe: 0.5 });
    check('Dann nach dem Ende — mit der Länge', mitAnfang.text, 'Ende setzen — 2,24 m');
    check('Und beides ist erlaubt', mitAnfang.moeglich, true);
  }

  // =========================================================================
  // 6 · Die Maße
  // =========================================================================
  {
    // --- Trassenlänge ------------------------------------------------------
    // 3-4-5-Dreieck: von (1|2) nach (4|6) sind es genau 5,00 m.
    check('Die Trassenlänge ist die Strecke im Grundriss', rohrLaenge({ x: 1, y: 2 }, { x: 4, y: 6 }), 5, 1e-12);
    check('Auf sich selbst ist sie null', rohrLaenge({ x: 1, y: 2 }, { x: 1, y: 2 }), 0, 1e-12);

    // --- Verlegehöhe -------------------------------------------------------
    // Der Mittelwert, nicht der Anfang: Beide Ablesungen sind Zielgenauigkeit,
    // keine der beiden ist die richtigere.
    check('Die Verlegehöhe ist der Mittelwert', rohrHoehe(1.0, 1.3), 1.15, 1e-12);
    check('Auch bei gleicher Höhe', rohrHoehe(2.4, 2.4), 2.4, 1e-12);
    // Auf Millimeter gerundet: 0,123456 m ist eine Scheingenauigkeit, die
    // aus dem Strahl kommt und nicht aus der Wirklichkeit.
    check('Und auf Millimeter gerundet', rohrHoehe(0.123456, 0.123456), 0.123, 1e-12);
    check('Auch beim Mitteln zweier krummer Ablesungen', rohrHoehe(0.1234, 0.1236), 0.124, 1e-12);

    // --- Auf Putz oder im Aufbau ------------------------------------------
    // Die Grenze liegt bei 0,20 m, und sie ist ausschließend: 0,20 ist noch
    // Sockelbereich (im Aufbau), 0,21 ist sichtbar verlegt. Ohne diese
    // Festlegung entschiede die Rundung der Zielhöhe über die Dämmpflicht
    // nach Anlage 8 GEG.
    check('0,20 m ist noch nicht auf Putz', aufputz(0.2), false);
    check('0,21 m ist es', aufputz(0.21), true);
    check('Am Boden erst recht nicht', aufputz(0), false);
    check('Unter der Decke sehr wohl', aufputz(2.4), true);
  }

  // =========================================================================
  // 7 · Der Durchbruch: von der Zielhöhe zur Unterkante
  // =========================================================================
  {
    /*
     * Gezielt wird auf die **Mitte** der Bohrung — so schaut man eine Wand an.
     * Im Modell steht die Unterkante, weil im Plan alles von unten bemaßt
     * wird. Die Umrechnung ist eine Subtraktion des halben Maßes, und sie
     * muss stimmen: Ein um den halben Durchmesser verschobenes Loch trifft
     * bei einer Kernbohrung Ø 152 die Nachbarschale.
     *
     * Von Hand: Ø 152 mm → halber Durchmesser 0,076 m.
     *   1,000 − 0,076 = 0,924 m.
     * Der Erwartungswert steht bewusst als Zahl da und nicht als Formel —
     * eine Formel prüfte nur sich selbst.
     */
    const kb152 = durchbruchPreset('kb-dn100');
    check('Das Regelmaß Ø 152 gibt es', kb152 !== null, true);
    if (kb152) {
      check('Mitte 1,00 m ergibt Unterkante 0,924 m', sturzAusZiel(1, kb152), 0.924, 1e-12);
      // Unter dem Fußboden gibt es keine Unterkante: gezielt wurde zu tief,
      // die Bohrung rutscht auf den Boden statt in den Estrich.
      check('Unter null wird auf null begrenzt', sturzAusZiel(0.05, kb152), 0, 1e-12);
      check('Genau auf dem halben Durchmesser ist es null', sturzAusZiel(0.076, kb152), 0, 1e-12);
    }

    // Beim rechteckigen Durchbruch zählt die Höhe, nicht der Durchmesser:
    // 30 × 30 auf Zielhöhe 1,00 m ⇒ 1,000 − 0,150 = 0,850 m.
    const wd = durchbruchPreset('wd-klein');
    check('Das Regelmaß 30 × 30 gibt es', wd !== null, true);
    if (wd) check('Rechteckig zählt die Höhe: 1,00 − 0,15 = 0,85', sturzAusZiel(1, wd), 0.85, 1e-12);
  }

  // =========================================================================
  // 8 · Der Durchbruch am Wandende
  // =========================================================================
  {
    /*
     * Der Fall aus dem Haus: Man zielt schräg auf eine kurze Wand, der Strahl
     * trifft sie zwei Zentimeter vor der Ecke, und die Bohrkrone läge zur
     * Hälfte in der anstoßenden Wand. Im Bild sieht das unauffällig aus —
     * der Durchbruch ist ja nur ein Loch, und Löcher zeichnet man klein.
     *
     * Südwand 6,00 m, Bohrung Ø 0,152 m, halbe Breite 0,076 m. Damit:
     *   zulässig ist 0,076 … 5,924 m.
     */
    const D = 0.152;
    check('Mitten in der Wand passt sie', durchbruchAmRand(doc, SUEDWAND, 3, D) === null, true);
    check(
      'Am linken Rand ragt sie hinaus',
      durchbruchAmRand(doc, SUEDWAND, 0.03, D) ?? 'passt',
      'Zu dicht an der Ecke — die Wand ist 6,00 m lang',
    );
    check(
      'Am rechten Rand ebenso',
      durchbruchAmRand(doc, SUEDWAND, 5.97, D) ?? 'passt',
      'Zu dicht an der Ecke — die Wand ist 6,00 m lang',
    );
    // Genau auf der Grenze passt sie noch — bündig mit der Ecke ist baubar,
    // ein Millimeter darüber nicht mehr.
    check('Genau bündig links passt noch', durchbruchAmRand(doc, SUEDWAND, 0.076, D) === null, true);
    check('Genau bündig rechts auch', durchbruchAmRand(doc, SUEDWAND, SUEDWAND_LAENGE - 0.076, D) === null, true);
    check('Einen Millimeter darüber nicht mehr', durchbruchAmRand(doc, SUEDWAND, 0.075, D) !== null, true);

    // Eine Wand, die es nicht mehr gibt: kein Absturz, sondern ein Satz.
    check(
      'Eine gelöschte Wand wird benannt',
      durchbruchAmRand(doc, 'w-fort', 3, D) ?? 'passt',
      'Die Wand gibt es nicht mehr',
    );
  }

  // =========================================================================
  // 9 · Die Meldungen
  // =========================================================================
  {
    /*
     * Eine Meldung ohne Maß ist im Haus wertlos: Das Bauteil sieht man ja
     * ohnehin stehen — was man nicht sieht, ist, wo genau es steht. Deshalb
     * nennt jede Meldung die Zahl, nach der jemand anreißt.
     */
    const kb: Durchbruch = {
      id: 'db-1',
      kind: 'kernbohrung',
      name: 'Kernbohrung Ø 152 (DN 100)',
      levelId: 'eg',
      wallId: SUEDWAND,
      distance: 2,
      form: 'rund',
      diameter: 0.152,
      sillHeight: 0.924,
      service: 'sanitary',
      dn: 100,
    };
    check(
      'Die Kernbohrung meldet Maß, Anriss, Unterkante und Wandlänge',
      durchbruchMeldung(kb, SUEDWAND_LAENGE),
      'Kernbohrung Ø 152 (DN 100) Ø152 — 2,00 m ab Wandanfang, UK +0,92 m (Wand 6,00 m)',
    );

    const wd: Durchbruch = {
      id: 'db-2',
      kind: 'wanddurchbruch',
      name: 'Wanddurchbruch 50 × 30',
      levelId: 'eg',
      wallId: SUEDWAND,
      distance: 4.5,
      form: 'rechteckig',
      width: 0.5,
      height: 0.3,
      sillHeight: 0.1,
      service: 'mixed',
    };
    check(
      'Der rechteckige Durchbruch nennt beide Maße in Millimeter',
      durchbruchMeldung(wd, SUEDWAND_LAENGE),
      'Wanddurchbruch 50 × 30 500 × 300 — 4,50 m ab Wandanfang, UK +0,10 m (Wand 6,00 m)',
    );

    // Die Rohrmeldung entscheidet mit über die Dämmpflicht: „auf Putz" und
    // „im Aufbau" sind nach Anlage 8 GEG verschiedene Zeilen in der Tabelle.
    check(
      'Die Leitung meldet Medium, Länge, Lage und Höhe',
      rohrMeldung(mediumName('heating-flow'), 3.456, 2.4),
      'Heizung Vorlauf: 3,46 m auf Putz auf +2,40 m',
    );
    check(
      'Im Fußbodenaufbau steht es auch so da',
      rohrMeldung(mediumName('cold-water'), 12, 0.05),
      'Trinkwasser kalt: 12,00 m im Aufbau auf +0,05 m',
    );
    check('Der Medienname kommt aus der einen Liste', mediumName('ventilation-exhaust'), 'Abluft');
  }
}
