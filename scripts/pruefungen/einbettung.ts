/**
 * Prüfblock für `src/lib/hostPatch.ts` — den Rückweg der Einbettung.
 *
 * Warum dieser Block überhaupt nötig ist: hier schreibt zum ersten Mal ein
 * fremdes Programm in ein Modell, an dem gerade jemand zeichnet. Ein Fehler
 * fällt dabei nicht auf wie ein Rechenfehler — er sieht aus wie eine Eingabe.
 * Wenn im Bad 24 °C stehen, die niemand eingetragen hat, oder wenn eine
 * Wandlänge sich ändert, ohne dass jemand die Wand angefasst hat, ist der
 * Schaden schon entstanden und die Ursache nicht mehr auffindbar.
 *
 * Geprüft werden deshalb genau die fünf Regeln, die der Dateikopf von
 * `hostPatch.ts` aufstellt, und zwar jede gegen den Fall, der sie verletzt:
 *
 *  1. Geometrie ist tabu — und die Ablehnung erklärt sich mit dem Text aus
 *     `PROTECTED_FIELDS`, nicht mit „unbekanntes Feld". Der Unterschied ist
 *     der zwischen „das kennen wir nicht" und „das darfst du nicht", und nur
 *     der zweite Satz hilft dem Entwickler auf der Gegenseite weiter.
 *  2. Nichts still — jeder Eintrag kommt mit Urteil und Begründung zurück.
 *  3. Teilweise anwenden — ein Tippfehler zwischen gültigen Werten reißt sie
 *     nicht mit.
 *  4. Gleich bleibt gleich — der zweite Schreibvorgang mit denselben Zahlen
 *     erzeugt kein `changed` und damit keinen Historieneintrag.
 *  5. Die Spur bleibt am Modell — `meta.lastHostPatch` und `meta.modifiedAt`.
 *
 * Dazu die Reinheit, die alles andere trägt: `applyHostPatch` bekommt ein
 * Dokument und liefert ein neues. Würde es das übergebene nebenbei ändern,
 * wäre die Rückgängig-Kette wertlos — der „alte Stand" im Verlauf wäre
 * derselbe wie der neue, und Strg+Z täte nichts. Deshalb wird das
 * Ausgangsdokument vor und nach jedem Vorgang als Ganzes verglichen.
 *
 * Alle Sollwerte sind aus dem Vertrag hergeleitet, nicht aus einem Probelauf
 * abgeschrieben:
 *  - Wertebereiche aus `PATCH_RANGES` (die Grenzen werden im Text der
 *    Begründung wiedererwartet, nicht als Zeichenkette eingetippt).
 *  - Begründungen geschützter Felder wörtlich aus `PROTECTED_FIELDS`.
 *  - Ausgangswerte aus dem Referenzhaus: „Wohnen EG" ist ein Wohnraum
 *    (20 °C, 0,5 1/h), „Bad EG" ein Bad (24 °C, 1,5 1/h), beide beheizt,
 *    beide ohne eigene U-Werte für Boden und Decke. Ein gesetzter Wert muss
 *    davon abweichen, sonst prüft die Zeile nur, dass nichts geschieht.
 *  - Die Toleranz der Heizlast-Aufteilung: `max(1 W, 1 % von total)`. Bei
 *    1200 W sind das 12 W; die abgelehnte Aufteilung weicht um 300 W ab.
 */

import type { CheckFn } from './typ';
import type { BimDocument } from '../../src/types/bim';
import {
  PATCH_RANGES,
  PROTECTED_FIELDS,
  applyHostPatch,
  writableFields,
  type HostPatch,
  type HostPatchReport,
  type RoomPatch,
} from '../../src/lib/hostPatch';
import { buildReferenceDocument } from '../reference';
import { buildRaviaExport } from '../../src/lib/raviaExport';

// ---------------------------------------------------------------------------
// Hilfen
// ---------------------------------------------------------------------------

/**
 * Ein optionales Feld prüfbar machen, ohne die Lücke zuzuschütten.
 *
 * `?? 0` würde aus „nicht gesetzt" eine Null machen; die Zeile könnte dann
 * nicht mehr scheitern, wenn das Feld gar nicht erst geschrieben wird.
 */
function angabe<T extends string | number | boolean>(value: T | undefined): T | 'fehlt' {
  return value === undefined ? 'fehlt' : value;
}

/**
 * Urteil zu einem Pfad — mit „kein Eintrag" als drittem Zustand.
 *
 * Ohne diesen dritten Zustand wäre ein stillschweigend übergangener Eintrag
 * von einem abgelehnten nicht zu unterscheiden, und genau das Stillschweigen
 * soll die Schnittstelle ja verhindern.
 */
function urteil(bericht: HostPatchReport, pfad: string): string {
  return bericht.entries.find((e) => e.path === pfad)?.verdict ?? 'kein Eintrag';
}

/** Begründung zu einem Pfad; „ohne Begründung" trennt sie vom fehlenden Eintrag. */
function grund(bericht: HostPatchReport, pfad: string): string {
  const eintrag = bericht.entries.find((e) => e.path === pfad);
  if (eintrag === undefined) return 'kein Eintrag';
  return eintrag.reason ?? 'ohne Begründung';
}

/** Alter Wert, wie ihn der Bericht ausweist. */
function vorher(bericht: HostPatchReport, pfad: string): string | number | boolean {
  const eintrag = bericht.entries.find((e) => e.path === pfad);
  if (eintrag === undefined) return 'kein Eintrag';
  return angabe(eintrag.before);
}

/** Bilanz eines Vorgangs als ein Wort — sie fällt in beide Richtungen auf. */
function bilanz(bericht: HostPatchReport): string {
  return `${bericht.applied} übernommen, ${bericht.unchanged} unverändert, ${bericht.rejected} abgelehnt`;
}

/**
 * Vollständiger Abdruck der Teile, in die geschrieben werden kann.
 *
 * Er dient allein der Reinheitsprüfung: verändert `applyHostPatch` das
 * übergebene Dokument, unterscheidet sich der Abdruck davor und danach.
 */
function abdruck(doc: BimDocument): string {
  return JSON.stringify({ rooms: doc.rooms, constructions: doc.constructions, meta: doc.meta, plant: doc.plant });
}

/** Kennung eines Raums über seinen Namen; „fehlt" scheitert gegen jeden Sollwert. */
function raumId(doc: BimDocument, name: string): string {
  return Object.values(doc.rooms).find((r) => r.name === name)?.id ?? 'fehlt';
}

/**
 * Ein Raumeintrag mit einem Feld, das der Vertrag nicht kennt.
 *
 * Der Umweg über den Typ ist Absicht: geprüft wird gerade das Verhalten bei
 * einem Feld, das `RoomPatch` nicht führt — mit gültigem Typ ließe es sich gar
 * nicht erst abschicken, und über die Nachrichtenbrücke kommt es trotzdem an.
 */
function raumFeld(id: string, felder: Record<string, unknown>): RoomPatch {
  return { id, ...felder } as unknown as RoomPatch;
}

// ---------------------------------------------------------------------------
// Prüfungen
// ---------------------------------------------------------------------------

export function pruefeEinbettung(check: CheckFn): void {
  // Feste Zeitstempel: die Spur am Modell muss gegen einen bekannten Wert
  // prüfbar sein, nicht gegen „irgendwann".
  const JETZT = '2026-03-01T09:00:00.000Z';
  const SPAETER = '2026-03-01T09:05:00.000Z';
  const ABSENDER = 'RaVia 3.2';

  const basis = buildReferenceDocument();
  const wohnen = raumId(basis, 'Wohnen EG');
  const bad = raumId(basis, 'Bad EG');
  const modellstand = basis.meta.modifiedAt;

  // -- Übernahme der Fachdaten und Reinheit ---------------------------------
  {
    const vorAbdruck = abdruck(basis);
    const patch: HostPatch = {
      source: ABSENDER,
      rooms: [
        // Alle vier Werte weichen vom Referenzhaus ab (20 °C, 0,5 1/h, keine
        // eigenen U-Werte), sonst wäre „übernommen" nicht von „unverändert"
        // zu unterscheiden.
        { id: wohnen, setpointTemperature: 22, airChangeRate: 0.6, floorUValue: 0.28, ceilingUValue: 0.19 },
        { id: bad, isHeated: false },
      ],
    };
    const ergebnis = applyHostPatch(basis, patch, JETZT);

    check('Solltemperatur wird übernommen', angabe(ergebnis.doc.rooms[wohnen]?.setpointTemperature), 22);
    check('Luftwechsel wird übernommen', angabe(ergebnis.doc.rooms[wohnen]?.airChangeRate), 0.6, 1e-9);
    check(
      'U-Werte von Boden und Decke werden übernommen',
      `${angabe(ergebnis.doc.rooms[wohnen]?.floorUValue)}/${angabe(ergebnis.doc.rooms[wohnen]?.ceilingUValue)}`,
      '0.28/0.19',
    );
    check('„beheizt" wird übernommen', angabe(ergebnis.doc.rooms[bad]?.isHeated), false);
    check('Fünf Werte übernommen, nichts abgelehnt', bilanz(ergebnis.report), '5 übernommen, 0 unverändert, 0 abgelehnt');
    check('Der Vorgang gilt als Änderung', ergebnis.changed, true);
    // Die eigentliche Bedingung dafür, dass Strg+Z etwas zurücknehmen kann.
    check('Das übergebene Dokument bleibt unangetastet', abdruck(basis) === vorAbdruck, true);

    check('Der Modellstand trägt den Zeitpunkt des Vorgangs', ergebnis.doc.meta.modifiedAt, JETZT);
    check('Die Spur nennt den Absender', angabe(ergebnis.doc.meta.lastHostPatch?.source), ABSENDER);
  }

  // -- Wertebereiche --------------------------------------------------------
  {
    const vorAbdruck = abdruck(basis);
    const [min, max] = PATCH_RANGES.setpointTemperature;
    const zuHeiss = applyHostPatch(basis, { source: ABSENDER, rooms: [{ id: wohnen, setpointTemperature: 200 }] }, JETZT);
    check('200 °C Solltemperatur wird abgelehnt', urteil(zuHeiss.report, `rooms.${wohnen}.setpointTemperature`), 'abgelehnt');
    check(
      'Die Begründung nennt den zulässigen Bereich',
      grund(zuHeiss.report, `rooms.${wohnen}.setpointTemperature`).includes(`${min} bis ${max}`),
      true,
    );

    // Über die Nachrichtenbrücke kommt an, was die Gegenstelle schickt — auch
    // eine Zeichenkette, wo eine Zahl stehen müsste.
    const text = applyHostPatch(
      basis,
      { source: ABSENDER, rooms: [raumFeld(wohnen, { setpointTemperature: '22' })] },
      JETZT,
    );
    check('Text statt Zahl wird abgelehnt', urteil(text.report, `rooms.${wohnen}.setpointTemperature`), 'abgelehnt');

    const nichtEndlich = applyHostPatch(
      basis,
      { source: ABSENDER, rooms: [{ id: wohnen, setpointTemperature: Number.NaN }] },
      JETZT,
    );
    check('NaN wird abgelehnt', urteil(nichtEndlich.report, `rooms.${wohnen}.setpointTemperature`), 'abgelehnt');
    check('Ein abgelehnter Vorgang lässt das Dokument in Ruhe', abdruck(basis) === vorAbdruck, true);
  }

  // -- Unbekannte Kennung, geschützte und unbekannte Felder -----------------
  {
    const fremd = applyHostPatch(basis, { source: ABSENDER, rooms: [{ id: 'gibt-es-nicht', setpointTemperature: 22 }] }, JETZT);
    check('Unbekannte Raum-Kennung wird abgelehnt', urteil(fremd.report, 'rooms.gibt-es-nicht'), 'abgelehnt');
    check('Und die Begründung verweist auf den Export', grund(fremd.report, 'rooms.gibt-es-nicht').includes('Export'), true);

    const geschuetzt = applyHostPatch(
      basis,
      {
        source: ABSENDER,
        rooms: [
          raumFeld(wohnen, {
            polygon: [{ x: 0, y: 0 }],
            area: 42,
            height: 2.5,
            name: 'Wohnzimmer',
            farbe: 'blau',
          }),
        ],
      },
      JETZT,
    );
    // Wörtlich der Text aus PROTECTED_FIELDS: die Ablehnung soll die
    // Aufgabenteilung erklären, nicht nur abweisen.
    for (const feld of ['polygon', 'area', 'height', 'name'] as const) {
      check(
        `Geometriefeld „${feld}" wird mit dem Grund aus PROTECTED_FIELDS abgelehnt`,
        grund(geschuetzt.report, `rooms.${wohnen}.${feld}`),
        PROTECTED_FIELDS[feld],
      );
    }
    check(
      'Ein unbekanntes Feld verweist stattdessen auf getWritableFields',
      grund(geschuetzt.report, `rooms.${wohnen}.farbe`).includes('getWritableFields'),
      true,
    );
  }

  // -- Teilweise anwenden, Wiederholung, fehlender Absender -----------------
  {
    const gemischt = applyHostPatch(
      basis,
      {
        source: ABSENDER,
        rooms: [
          { id: wohnen, setpointTemperature: 22 },
          { id: bad, setpointTemperature: 200 },
          { id: wohnen, airChangeRate: 0.6 },
        ],
      },
      JETZT,
    );
    check('Ein ungültiger Eintrag reißt die gültigen nicht mit', bilanz(gemischt.report), '2 übernommen, 0 unverändert, 1 abgelehnt');
    check('Der Vorgang gilt trotzdem als nicht getragen', gemischt.report.ok, false);

    // Derselbe Vorgang ein zweites Mal: die Werte stehen schon so im Modell.
    const nochmal = applyHostPatch(
      gemischt.doc,
      { source: ABSENDER, rooms: [{ id: wohnen, setpointTemperature: 22 }] },
      SPAETER,
    );
    check('Derselbe Wert gilt beim zweiten Mal als unverändert', urteil(nochmal.report, `rooms.${wohnen}.setpointTemperature`), 'unverändert');
    check('Und erzeugt keinen Historieneintrag', nochmal.changed, false);
    // Sonst würde eine im Sekundentakt schreibende Gegenstelle die Spur
    // fortlaufend überschreiben, ohne dass sich etwas geändert hätte.
    check('Die Spur bleibt vom ersten Vorgang stehen', angabe(nochmal.doc.meta.lastHostPatch?.at), JETZT);

    const ohneAbsender = applyHostPatch(
      basis,
      { source: '   ', rooms: [{ id: wohnen, setpointTemperature: 22 }] },
      JETZT,
    );
    check('Ohne Absender wird nichts übernommen', bilanz(ohneAbsender.report), '0 übernommen, 0 unverändert, 1 abgelehnt');
    check('Und der Grund nennt den fehlenden Absender', grund(ohneAbsender.report, 'source').includes('wer schreibt'), true);
  }

  // -- Norm-Heizlast --------------------------------------------------------
  {
    const last = applyHostPatch(
      basis,
      {
        source: ABSENDER,
        rooms: [{ id: wohnen, heatLoad: { total: 1200, transmission: 800, ventilation: 300, reheat: 100 } }],
      },
      JETZT,
    );
    check('Die Norm-Heizlast wird übernommen', angabe(last.doc.rooms[wohnen]?.normHeatLoad?.total), 1200);
    check('Sie trägt ihren Absender', angabe(last.doc.rooms[wohnen]?.normHeatLoad?.source), ABSENDER);
    check('Sie trägt den Zeitpunkt der Übernahme', angabe(last.doc.rooms[wohnen]?.normHeatLoad?.receivedAt), JETZT);
    // Der Modellstand *vor* dem Vorgang: für diese Geometrie ist gerechnet
    // worden. Stünde hier der neue, ließe sich später nicht mehr erkennen,
    // ob die Last zur heutigen Geometrie passt.
    check('Sie trägt den Modellstand, für den gerechnet wurde', angabe(last.doc.rooms[wohnen]?.normHeatLoad?.modelState), modellstand);

    // 800 + 100 = 900 gegen 1200 angegeben: 300 W Abweichung bei 12 W Toleranz.
    const schief = applyHostPatch(
      basis,
      { source: ABSENDER, rooms: [{ id: wohnen, heatLoad: { total: 1200, transmission: 800, ventilation: 100 } }] },
      JETZT,
    );
    check('Eine nicht aufgehende Aufteilung wird abgelehnt', urteil(schief.report, `rooms.${wohnen}.heatLoad`), 'abgelehnt');
    check(
      'Und die Begründung sagt, dass die Aufteilung nicht aufgeht',
      grund(schief.report, `rooms.${wohnen}.heatLoad`).includes('Aufteilung geht nicht auf'),
      true,
    );

    // Ohne Lüftungsanteil lässt sich die Summe gar nicht gegenprüfen — eine
    // unvollständige Aufteilung ist deshalb erlaubt, nicht verdächtig.
    const teilweise = applyHostPatch(
      basis,
      { source: ABSENDER, rooms: [{ id: wohnen, heatLoad: { total: 1000, transmission: 700 } }] },
      JETZT,
    );
    check('Eine unvollständige Aufteilung ist erlaubt', urteil(teilweise.report, `rooms.${wohnen}.heatLoad`), 'übernommen');

    const gebaeude = applyHostPatch(basis, { source: ABSENDER, totalHeatLoad: 8400 }, JETZT);
    check('Die Gesamtlast landet im Anlagenblatt', angabe(gebaeude.doc.plant.heatLoadOverride), 8400);
  }

  // -- Bauteilaufbauten -----------------------------------------------------
  {
    // Das Referenzhaus führt keinen Katalog; jeder Aufbau ist hier unbekannt.
    const ohneAnlegen = applyHostPatch(basis, { source: ABSENDER, constructions: [{ id: 'c-aw', uValue: 0.21 }] }, JETZT);
    check('Unbekannte Aufbau-Kennung ohne createIfMissing wird abgelehnt', urteil(ohneAnlegen.report, 'constructions.c-aw'), 'abgelehnt');

    const angelegt = applyHostPatch(
      basis,
      {
        source: ABSENDER,
        constructions: [{ id: 'c-aw', uValue: 0.21, createIfMissing: { name: 'AW 36,5 + WDVS 14', category: 'wall' } }],
      },
      JETZT,
    );
    check('Mit createIfMissing wird der Aufbau angelegt', angabe(angelegt.doc.constructions['c-aw']?.name), 'AW 36,5 + WDVS 14');

    const geaendert = applyHostPatch(angelegt.doc, { source: ABSENDER, constructions: [{ id: 'c-aw', uValue: 0.19 }] }, SPAETER);
    check('Der U-Wert lässt sich ändern', angabe(geaendert.doc.constructions['c-aw']?.uValue), 0.19, 1e-9);
    check('Und der Bericht weist den alten Wert aus', vorher(geaendert.report, 'constructions.c-aw.uValue'), 0.21);

    const namenlos = applyHostPatch(
      basis,
      { source: ABSENDER, constructions: [{ id: 'c-neu', uValue: 0.21, createIfMissing: { name: '   ', category: 'wall' } }] },
      JETZT,
    );
    check('Ohne Namen wird kein Aufbau angelegt', urteil(namenlos.report, 'constructions.c-neu'), 'abgelehnt');
  }

  // -- Selbstauskunft -------------------------------------------------------
  {
    const felder = writableFields();
    const pfade = felder.map((f) => f.path);
    check('Jedes schreibbare Feld steht genau einmal in der Selbstauskunft', new Set(pfade).size, pfade.length);
    const geschuetzt = Object.keys(PROTECTED_FIELDS);
    check(
      'Kein geschütztes Feld ist als schreibbar geführt',
      pfade.some((p) => geschuetzt.includes(p.split('.').pop() ?? '')),
      false,
    );
    // Ohne Bereich wäre die Auskunft für eine Eingabemaske wertlos: die
    // Gegenstelle müsste die Grenzen erneut raten, die hier schon feststehen.
    check(
      'Jedes Feld mit Einheit nennt seinen Bereich',
      felder.filter((f) => f.unit !== undefined).every((f) => f.range !== undefined),
      true,
    );
    check(
      'Der genannte Bereich ist der, gegen den geprüft wird',
      JSON.stringify(felder.find((f) => f.path === 'rooms[].setpointTemperature')?.range ?? 'fehlt'),
      JSON.stringify(PATCH_RANGES.setpointTemperature),
    );
    check(
      'Jedes Raumfeld des Vertrags ist genannt',
      (['setpointTemperature', 'airChangeRate', 'isHeated', 'floorUValue', 'ceilingUValue'] as const).every((k) =>
        pfade.includes(`rooms[].${k}`),
      ),
      true,
    );
  }

  // -------------------------------------------------------------------------
  // Der Weg zurück in die Datei
  //
  // Der Export ist zugleich die Projektdatei. Eine gerechnete Heizlast, die
  // beim Speichern verschwindet, wäre nach dem nächsten Öffnen weg — ohne
  // Meldung, und die Auslegung stünde wieder auf dem Überschlag, ohne dass es
  // jemandem auffiele. Deshalb muss sie im Export stehen.
  // -------------------------------------------------------------------------
  {
    const doc = buildReferenceDocument();
    const raum = Object.values(doc.rooms).find((r) => r.isHeated);
    const id = raum?.id ?? '';
    const ergebnis = applyHostPatch(
      doc,
      { source: 'RaVia 3.2', rooms: [{ id, heatLoad: { total: 1234 } }] },
      '2026-03-01T09:00:00.000Z',
    );
    const exportiert = buildRaviaExport(ergebnis.doc);
    const exportRaum = exportiert.rooms.find((r) => r.id === id);
    check('Die gerechnete Heizlast steht im Export', angabe(exportRaum?.normHeatLoad?.total), 1234);
    check('Mit Absender', angabe(exportRaum?.normHeatLoad?.source), 'RaVia 3.2');
    check('Und mit dem Modellstand, für den sie gilt', angabe(exportRaum?.normHeatLoad?.modelState), doc.meta.modifiedAt);
    // Räume ohne gerechnete Last tragen das Feld nicht — ein leeres Feld
    // würde in der Datei so aussehen, als sei dort etwas gerechnet worden.
    const ohne = exportiert.rooms.filter((r) => r.id !== id).every((r) => r.normHeatLoad === undefined);
    check('Räume ohne gerechnete Last tragen kein leeres Feld', ohne, true);
    // Die Spur des Schreibvorgangs hängt am Projektkopf und geht denselben Weg.
    check('Die Spur des Vorgangs steht im Export', angabe(exportiert.project.lastHostPatch?.source), 'RaVia 3.2');
  }
}
