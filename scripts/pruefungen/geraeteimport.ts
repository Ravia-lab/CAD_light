/**
 * Prüfblock für `src/lib/deviceImport.ts` — das Einlesen von Datenblättern.
 *
 * Warum dieser Block ausführlicher ausfällt als andere: das Modul ist die
 * einzige Stelle, an der eine Zahl ihre Kennzeichnung von „Typklasse" auf
 * „Herstellerangabe" wechselt. Ein Fehler beim Einlesen macht eine erfundene
 * Zahl belastbar aussehend — genau das, was das Modul verhindern soll. Geprüft
 * wird deshalb nicht nur, ob eine Zahl ankommt, sondern ob sie mit der
 * richtigen Bedeutung ankommt (Tausenderpunkt gegen Dezimalpunkt) und ob eine
 * Zeile, die nicht taugt, auch als untauglich zurückkommt.
 *
 * Alle Sollwerte sind aus den Regeln des Moduls hergeleitet, nicht aus einem
 * Probelauf abgeschrieben:
 *  - Zahlenformat: die im Modul beschriebene Staffelung Zelle → Spalte → Datei.
 *  - Ersatzwerte: 0,1075 m³/(h·kW) aus 8 K Spreizung und 4 l/kW für Sole,
 *    beides im Modul offengelegt.
 *  - Betriebsstrom: I = P/(√3·U) bei 400 V, I = P/U bei 230 V.
 *  - Wertebereiche: die Grenzen der Feldtabelle (COP 1 bis 8 usw.).
 *
 * Wo das Modul einen Ersatzwert kennt, reicht es nicht, den erwarteten Wert zu
 * prüfen: er wäre auch dann richtig, wenn gar nichts gelesen würde. Solche
 * Stellen — Phasenzahl (angenommen: drei) und Bauform (angenommen: Monoblock
 * außen) — werden deshalb gegen den Fall geprüft, der von der Annahme abweicht.
 */

import type { CheckFn } from './typ';
import type { HeatPumpModel } from '../../src/types/bim';
import { HEAT_PUMP_CATALOG } from '../../src/lib/deviceCatalog';
import {
  buildCsvTemplate,
  detectDecimalStyle,
  importDevices,
  mergeIntoCatalog,
  parseCsv,
  type DeviceImportReport,
} from '../../src/lib/deviceImport';

// ---------------------------------------------------------------------------
// Hilfen — sie halten die Prüfungen selbst frei von Fallunterscheidungen
// ---------------------------------------------------------------------------

/** Zahl aus einer eingelesenen Wärmepumpe; fehlt sie, scheitert die Prüfung. */
function wpZahl(bericht: DeviceImportReport, index: number, lies: (m: HeatPumpModel) => number | undefined): number {
  const modell = bericht.devices[index]?.heatPump;
  const wert = modell ? lies(modell) : undefined;
  return wert ?? Number.NaN;
}

/** Übernahmeentscheidung einer Zeile. */
function uebernehmbar(bericht: DeviceImportReport, index: number): boolean {
  return bericht.devices[index]?.accepted ?? false;
}

/** Steht zu diesem Feld ein Ausschlussgrund im Bericht? */
function fehlerZuFeld(bericht: DeviceImportReport, index: number, feld: string): boolean {
  const geraet = bericht.devices[index];
  return geraet !== undefined && geraet.issues.some((h) => h.severity === 'error' && h.field === feld);
}

/** Wird dieses Pflichtfeld als fehlend geführt? */
function fehltPflichtfeld(bericht: DeviceImportReport, index: number, feld: string): boolean {
  const geraet = bericht.devices[index];
  return geraet !== undefined && geraet.missing.some((m) => m.field === feld);
}

/**
 * Meldungslage zu einem Feld als Wort.
 *
 * Warum nicht `issues.some(...) === false`? Weil eine solche Prüfung auch dann
 * zufrieden ist, wenn die Zeile gar nicht erst aufgebaut wurde — sie kann nur
 * in eine Richtung scheitern. Der Dreiwert unterscheidet „keine Zeile" von
 * „Zeile ohne Meldung" und ist damit in beide Richtungen widerlegbar.
 */
function meldungslage(bericht: DeviceImportReport, index: number, feld: string): string {
  const geraet = bericht.devices[index];
  if (geraet === undefined) return 'keine Zeile';
  const treffer = geraet.issues.find((h) => h.field === feld);
  return treffer ? treffer.severity : 'ohne Meldung';
}

/** Zustand des Außenschallpegels — trennt „leer" von „Zeile fehlt". */
function aussenschall(bericht: DeviceImportReport, index: number): string {
  const modell = bericht.devices[index]?.heatPump;
  if (modell === undefined) return 'keine Zeile';
  return modell.soundPowerOutdoor === undefined ? 'leer' : 'belegt';
}

/**
 * Wortlaut der Meldung zu einem Feld.
 *
 * `meldungslage` sagt nur, ob gemeldet wurde. Wo die Meldung selbst die
 * Aussage trägt — etwa weil sie offenlegen muss, woraus eine Annahme
 * abgeleitet wurde — wird hier ihr Text geprüft.
 */
function meldungstext(bericht: DeviceImportReport, index: number, feld: string): string {
  const geraet = bericht.devices[index];
  if (geraet === undefined) return 'keine Zeile';
  const treffer = geraet.issues.find((h) => h.field === feld);
  return treffer ? treffer.text : 'ohne Meldung';
}

/**
 * Notiz zum erkannten Feld — sie trägt die Lesart der Zelle.
 *
 * Drei Zustände statt zweier: „kein Treffer" (Spalte gar nicht zugeordnet)
 * ist etwas anderes als „ohne Notiz" (Zelle ohne Besonderheit), und beides
 * darf nicht als bestandene Prüfung durchgehen.
 */
function notiz(bericht: DeviceImportReport, index: number, feld: string): string {
  const geraet = bericht.devices[index];
  if (geraet === undefined) return 'keine Zeile';
  const treffer = geraet.matches.find((m) => m.field === feld);
  if (treffer === undefined) return 'kein Treffer';
  return treffer.note ?? 'ohne Notiz';
}

/** Zustand des Innengeräts — trennt „nicht aufgebaut" von „Zeile fehlt". */
function innengeraet(bericht: DeviceImportReport, index: number): string {
  const modell = bericht.devices[index]?.heatPump;
  if (modell === undefined) return 'keine Zeile';
  return modell.indoor === undefined ? 'ohne Innengerät' : 'mit Innengerät';
}

/** Erkanntes Zahlenformat einer Spalte, über ihre Überschrift gesucht. */
function spaltenformat(bericht: DeviceImportReport, ueberschrift: string): string {
  const spalte = bericht.columns.find((s) => s.heading === ueberschrift);
  return spalte ? spalte.decimalStyle : 'keine Spalte';
}

// ---------------------------------------------------------------------------
// Prüfdateien
// ---------------------------------------------------------------------------

const KOPF = [
  'Bezeichnung',
  'Kältemittel',
  'Füllmenge [kg]',
  'Heizleistung [kW]',
  'COP',
  'max. Vorlauftemperatur [°C]',
  'Schallleistungspegel [dB(A)]',
];

/** Zeilen mit einem Trennzeichen zu einer Datei fügen. */
function datei(zeilen: string[][], trenner: string): string {
  return zeilen.map((zeile) => zeile.join(trenner)).join('\n');
}

const CSV_SEMIKOLON = datei([KOPF, ['Muster WP 8', 'R290', '1,25', '8,2', '4,10', '70', '54,0']], ';');
const CSV_TABULATOR = datei([KOPF, ['Muster Tab', 'R290', '1,25', '8,2', '4,10', '70', '54,0']], '\t');
// Englische Datei: Trennzeichen Komma, deshalb zwingend Dezimalpunkt.
const CSV_KOMMA = datei([KOPF, ['Muster Komma', 'R290', '1.25', '8.2', '4.10', '70', '54.0']], ',');

// Über der Kopfzeile steht eine Titelzeile ohne Trennzeichen, wie sie beim
// Kopieren aus einem Prospekt entsteht.
const CSV_TITELZEILE = datei(
  [['Technische Daten 2026'], KOPF, ['Muster WP 8', 'R290', '1,25', '8,2', '4,10', '70', '54,0']],
  ';',
);

// „1.234" in einer Spalte, die durch „850,5" als deutsch belegt ist: der Punkt
// ist Tausendertrennzeichen, der Wert also 1234 l.
const CSV_TAUSENDERPUNKT = datei(
  [
    [...KOPF, 'Mindestwasserinhalt [l]'],
    ['Muster A', 'R290', '1,25', '8,2', '4,10', '70', '54,0', '1.234'],
    ['Muster B', 'R290', '1,25', '8,2', '4,10', '70', '54,0', '850,5'],
  ],
  ';',
);

// Dieselbe Zelle in einer Spalte, die durch „850.5" als englisch belegt ist:
// der Punkt ist Dezimaltrennzeichen, der Wert also 1,234 l — und damit
// unterhalb des plausiblen Bereichs von 5 l.
const CSV_DEZIMALPUNKT = datei(
  [
    [...KOPF, 'Mindestwasserinhalt [l]'],
    ['Muster A', 'R290', '1,25', '8,2', '4,10', '70', '54,0', '1.234'],
    ['Muster B', 'R290', '1,25', '8,2', '4,10', '70', '54,0', '850.5'],
  ],
  ';',
);

// Gemischte Datei: Füllmenge deutsch, Heizleistung und COP englisch.
const CSV_GEMISCHT = datei(
  [
    KOPF,
    ['Muster A', 'R290', '1,25', '8.20', '4.10', '70', '54,0'],
    ['Muster B', 'R290', '1,40', '9.60', '4.05', '70', '55,0'],
  ],
  ';',
);

const CSV_EINHEITEN = datei(
  [
    [...KOPF, 'Absicherung [A]', 'Phasen'],
    ['Muster Einheiten', 'R290', '1,25 kg', '12,5 kW', '4,10', '70 °C', '55 dB(A)', '3 x 16 A', '3 x 400 V'],
  ],
  ';',
);

// Phasenzahl steht in Datenblättern als Anschlussangabe, nicht als Ziffer.
// Zwei Zeilen, weil erst der Gegensatz belegt, dass die Angabe gelesen wird:
// die Ersatzannahme des Moduls ist der dreiphasige Anschluss, eine geprüfte
// Drei allein wäre also auch dann richtig, wenn nichts gelesen würde.
const CSV_PHASEN = datei(
  [
    [...KOPF, 'Absicherung [A]', 'Phasen'],
    ['Muster Drehstrom', 'R290', '1,25', '8,2', '4,10', '70', '54,0', '20', '3 x 400 V'],
    ['Muster Wechselstrom', 'R290', '1,25', '8,2', '4,10', '70', '54,0', '16', '1 x 230 V'],
  ],
  ';',
);

// Ohne Spalte „Max. Betriebsstrom" rechnet das Modul den Strom aus Heizleistung
// und COP: P_el = P_th / COP, daraus einphasig I = P_el / 230 V und dreiphasig
// I = P_el / (√3 · 400 V). Die drei Zeilen sind so gewählt, dass jede Zeile
// eine andere Aussage festnagelt:
//   Zeile 1: 30 kW bei COP 3,00 → 10 kW Aufnahme → 14,4 A. 10 A tragen das nicht.
//   Zeile 2: derselbe Strom, 20 A. Nur mit dem Faktor √3 reicht das; ohne ihn
//            wären es 43,5 A und die Zeile fiele durch.
//   Zeile 3: 12 kW bei COP 3,00 → 4 kW Aufnahme, einphasig 17,4 A. 16 A tragen
//            das nicht — dreiphasig gerechnet wären es 5,8 A und unauffällig.
const CSV_BETRIEBSSTROM = datei(
  [
    [...KOPF, 'Absicherung [A]', 'Phasen'],
    ['Muster Drehstrom knapp', 'R290', '1,25', '30', '3,00', '70', '54,0', '10', '3'],
    ['Muster Drehstrom gut', 'R290', '1,25', '30', '3,00', '70', '54,0', '20', '3'],
    ['Muster Wechselstrom knapp', 'R290', '1,25', '12', '3,00', '70', '54,0', '16', '1'],
  ],
  ';',
);

// Kältemittel fehlt — eine Pflichtangabe.
const CSV_OHNE_KAELTEMITTEL = datei([KOPF, ['Muster ohne', '', '1,25', '8,2', '4,10', '70', '54,0']], ';');

// COP 20 liegt außerhalb von 1 bis 8.
const CSV_COP_20 = datei([KOPF, ['Muster Unsinn', 'R290', '1,25', '8,2', '20', '70', '54,0']], ';');

// Zeile 1: Absicherung unter dem angegebenen Betriebsstrom. Zeile 2: passend.
const CSV_ABSICHERUNG = datei(
  [
    [...KOPF, 'Absicherung [A]', 'Max. Betriebsstrom [A]', 'Phasen'],
    ['Muster knapp', 'R290', '1,25', '8,2', '4,10', '70', '54,0', '10', '14,5', '1'],
    ['Muster gut', 'R290', '1,25', '8,2', '4,10', '70', '54,0', '20', '14,5', '1'],
  ],
  ';',
);

// Zeile 1: Innenaufstellung ohne Außenschallpegel — dort gibt es keinen.
// Zeile 2: Außenaufstellung ohne Außenschallpegel — dort fehlt er.
const CSV_AUFSTELLUNG = datei(
  [
    ['Bezeichnung', 'Bauform', ...KOPF.slice(1)],
    ['Muster Innen', 'Innenaufstellung', 'R290', '1,25', '8,2', '4,10', '70', ''],
    ['Muster Außen', 'Monoblock Außenaufstellung', 'R290', '1,25', '8,2', '4,10', '70', ''],
  ],
  ';',
);

// Ohne Spalte „Bauform", dafür mit Wärmequelle. Zeile 1 nennt Sole: ein
// solches Gerät steht im Technikraum und hat keine Außeneinheit. Zeile 2 nennt
// Luft und ist die Gegenprobe — dort gibt es eine Außeneinheit, deren
// Schallleistungspegel fehlt. Beide Zeilen sind sonst gleich aufgebaut, damit
// allein die Wärmequelle den Unterschied macht.
const CSV_OHNE_BAUFORM = datei(
  [
    ['Bezeichnung', 'Wärmequelle', ...KOPF.slice(1, 6)],
    ['Muster Sole', 'Sole', 'R410A', '1,25', '8,2', '4,10', '60'],
    ['Muster Luft', 'Luft', 'R290', '1,25', '8,2', '4,10', '60'],
  ],
  ';',
);

// Turmgerät: der integrierte Trinkwasserspeicher steht im Datenblatt, die Maße
// des Innengeräts nicht. Zeile 2 trägt dieselbe Angabe samt Maßen und ist die
// Gegenprobe — ohne sie wäre auch ein Modul zufriedenzustellen, das die Spalte
// grundsätzlich verwirft.
const CSV_TURMGERAET = datei(
  [
    [...KOPF, 'Integrierter Trinkwasserspeicher [l]', 'Breite Innengerät [m]', 'Tiefe Innengerät [m]', 'Höhe Innengerät [m]'],
    ['Muster Turm ohne Maße', 'R290', '1,25', '8,2', '4,10', '70', '54,0', '190', '', '', ''],
    ['Muster Turm mit Maßen', 'R290', '1,25', '8,2', '4,10', '70', '54,0', '190', '0,60', '0,65', '1,80'],
  ],
  ';',
);

const JSON_WAERMEPUMPE = JSON.stringify([
  {
    label: 'Muster WP 8',
    refrigerant: 'R290',
    refrigerantMass: 1.25,
    nominalCapacity: 8.2,
    nominalPoint: 'A-7/W35',
    maxFlowTemperature: 70,
    soundPowerOutdoor: 54,
    electric: { phases: 3, fuse: 20, maxCurrent: 14.5 },
    outdoor: { width: 1.1, depth: 0.5, height: 1.05, weight: 135 },
    ratings: [
      { point: 'A-7/W35', capacity: 8.2, cop: 2.85 },
      { point: 'A7/W35', capacity: 9.4, cop: 4.9 },
    ],
  },
]);

// Für den Zusammenführungslauf: eine vorhandene Typklasse, die von der
// Herstellerangabe verdrängt werden soll.
const TYPKLASSE: HeatPumpModel = {
  id: 'muster-8',
  label: 'Typklasse 8 kW',
  series: 'Typklasse',
  form: 'monoblock-outdoor',
  source: 'air',
  refrigerant: 'R290',
  refrigerantMass: 1.2,
  nominalCapacity: 8,
  nominalPoint: 'A-7/W35',
  ratings: [{ point: 'A-7/W35', capacity: 8, cop: 2.8 }],
  maxFlowTemperature: 60,
  hydraulicConnection: 'G 1 AG',
  minVolumeFlow: 0.86,
  minSystemVolume: 96,
  electric: { phases: 3, fuse: 16 },
  provenance: 'generisch',
};

// Zeile 1 trägt die Id der Typklasse, Zeile 2 ist ohne Kältemittel und damit
// nicht übernehmbar.
const CSV_ZUSAMMENFUEHREN = datei(
  [
    ['Artikelnummer', ...KOPF],
    ['muster-8', 'Muster WP 8', 'R290', '1,25', '8,2', '4,10', '70', '54,0'],
    ['muster-9', 'Muster WP 9', '', '1,25', '9,0', '4,10', '70', '54,0'],
  ],
  ';',
);

// ---------------------------------------------------------------------------
// Prüfungen
// ---------------------------------------------------------------------------

export function pruefeGeraeteimport(check: CheckFn): void {
  // -- Trennzeichen und Kopfzeile -------------------------------------------
  check('parseCsv erkennt Semikolon als Trennzeichen', parseCsv(CSV_SEMIKOLON).delimiter, ';');
  check('parseCsv erkennt Tabulator als Trennzeichen', parseCsv(CSV_TABULATOR).delimiter, '\t');
  check('parseCsv erkennt Komma als Trennzeichen', parseCsv(CSV_KOMMA).delimiter, ',');

  const kommaDatei = importDevices(CSV_KOMMA);
  // In einer kommagetrennten Datei ist der Punkt zwangsläufig das
  // Dezimaltrennzeichen: „8.2" sind 8,2 kW.
  check('Kommagetrennte Datei liest „8.2" als 8,2 kW', wpZahl(kommaDatei, 0, (m) => m.nominalCapacity), 8.2, 0.001);

  const mitTitel = importDevices(CSV_TITELZEILE);
  // Kopfzeile in physischer Zeile 2, erster Datensatz in Zeile 3.
  check('Titelzeile über der Kopfzeile: Fundstelle ist Zeile 3', mitTitel.devices[0]?.rowLabel ?? '', 'Zeile 3');
  check(
    'Titelzeile über der Kopfzeile wird im Bericht benannt',
    mitTitel.issues.some((h) => h.text.includes('Kopfzeile steht in Zeile 2')),
    true,
  );

  // -- Dezimaltrennung -------------------------------------------------------
  // „1.234" allein ist zweideutig: Tausenderpunkt oder Dezimalpunkt.
  check('„1.234" allein belegt kein Zahlenformat', detectDecimalStyle(['1.234']), 'unklar');
  // Zwei Dreiergruppen können nur Tausendertrennzeichen sein — also deutsch.
  check('„1.234.567" belegt deutsches Format', detectDecimalStyle(['1.234.567']), 'komma');

  const tausender = importDevices(CSV_TAUSENDERPUNKT);
  // Die Spalte ist über „850,5" als deutsch belegt; „1.234" sind damit 1234 l.
  check(
    'Deutsch belegte Spalte liest „1.234" als 1234',
    wpZahl(tausender, 0, (m) => m.minSystemVolume),
    1234,
    0.001,
  );

  const dezimal = importDevices(CSV_DEZIMALPUNKT);
  // Dieselbe Zelle, Spalte über „850.5" als englisch belegt: 1,234 l.
  check(
    'Englisch belegte Spalte liest „1.234" als 1,234',
    wpZahl(dezimal, 0, (m) => m.minSystemVolume),
    1.234,
    0.0001,
  );

  const gemischt = importDevices(CSV_GEMISCHT);
  check('Gemischte Datei: deutsche Spalte bleibt deutsch', wpZahl(gemischt, 0, (m) => m.refrigerantMass), 1.25, 0.001);
  check('Gemischte Datei: englische Spalte bleibt englisch', wpZahl(gemischt, 0, (m) => m.nominalCapacity), 8.2, 0.001);
  // Vier deutsche und vier englische Belege heben sich auf — dateiweit bleibt
  // das Format unbelegt, entschieden wird je Spalte.
  check('Gemischte Datei hat kein dateiweites Zahlenformat', gemischt.decimalStyle, 'unklar');
  // „unklar" ist zugleich der Wert, den eine gar nicht stattfindende Erkennung
  // liefern würde. Deshalb zusätzlich die Gegenprobe an den Spalten: „1,25"
  // und „1,40" belegen die eine als deutsch, „8.20" und „9.60" die andere als
  // englisch — beides eindeutig, weil auf das Zeichen keine Dreiergruppe folgt.
  check('Gemischte Datei: Spalte „Füllmenge" ist deutsch belegt', spaltenformat(gemischt, 'Füllmenge [kg]'), 'komma');
  check('Gemischte Datei: Spalte „Heizleistung" ist englisch belegt', spaltenformat(gemischt, 'Heizleistung [kW]'), 'punkt');

  // -- Einheiten in den Zellen ----------------------------------------------
  const einheiten = importDevices(CSV_EINHEITEN);
  check('Einheit in der Zelle: „12,5 kW" ergibt 12,5', wpZahl(einheiten, 0, (m) => m.nominalCapacity), 12.5, 0.001);
  // „3 x 16 A" ist eine Absicherung von 16 A, nicht von 3 A.
  check('Stückzahl vor der Angabe: „3 x 16 A" ergibt 16 A', wpZahl(einheiten, 0, (m) => m.electric.fuse), 16, 0.001);
  check('Einheit in der Zelle: „55 dB(A)" ergibt 55', wpZahl(einheiten, 0, (m) => m.soundPowerOutdoor), 55, 0.001);

  // -- Phasenzahl aus der Anschlussangabe ------------------------------------
  const phasen = importDevices(CSV_PHASEN);
  // „3 x 400 V" beschreibt den Drehstromanschluss, also drei Phasen. Die Drei
  // allein belegt das nicht — sie ist auch die Ersatzannahme des Moduls.
  // Belegend ist erst, dass zum Feld keine Meldung steht: die Ersatzannahme
  // trägt eine Warnung mit sich.
  check('„3 x 400 V" ergibt drei Phasen', wpZahl(phasen, 0, (m) => m.electric.phases), 3, 0.001);
  check('„3 x 400 V" wird gelesen, nicht angenommen', meldungslage(phasen, 0, 'electric.phases'), 'ohne Meldung');
  // „1 x 230 V" ist der Wechselstromanschluss. Diese Eins kann nur aus der
  // Zelle stammen, denn angenommen würde die Drei.
  check('„1 x 230 V" ergibt eine Phase', wpZahl(phasen, 1, (m) => m.electric.phases), 1, 0.001);

  // -- Pflichtfelder ---------------------------------------------------------
  const ohneKaeltemittel = importDevices(CSV_OHNE_KAELTEMITTEL);
  check('Fehlendes Pflichtfeld macht die Zeile nicht übernehmbar', uebernehmbar(ohneKaeltemittel, 0), false);
  check('Fehlendes Kältemittel steht in missing', fehltPflichtfeld(ohneKaeltemittel, 0, 'refrigerant'), true);
  check('Nur das eine Pflichtfeld fehlt', ohneKaeltemittel.devices[0]?.missing.length ?? -1, 1);

  // -- Unplausible Werte -----------------------------------------------------
  const cop20 = importDevices(CSV_COP_20);
  check('COP 20 macht die Zeile nicht übernehmbar', uebernehmbar(cop20, 0), false);
  check('COP 20 wird als Ausschlussgrund geführt', fehlerZuFeld(cop20, 0, 'copNominal'), true);

  const absicherung = importDevices(CSV_ABSICHERUNG);
  check('Absicherung unter dem Betriebsstrom: nicht übernehmbar', uebernehmbar(absicherung, 0), false);
  check('Absicherung unter dem Betriebsstrom ist ein Ausschlussgrund', fehlerZuFeld(absicherung, 0, 'electric.fuse'), true);
  check('Ausreichende Absicherung: Zeile übernehmbar', uebernehmbar(absicherung, 1), true);
  check(
    'Maximaler Betriebsstrom wird gelesen',
    wpZahl(absicherung, 1, (m) => m.electric.maxCurrent),
    14.5,
    0.001,
  );

  // -- Rechnerischer Betriebsstrom ------------------------------------------
  // Steht kein maximaler Betriebsstrom im Datenblatt, bildet ihn das Modul aus
  // Aufnahmeleistung und Spannung. Geprüft wird an der Grenze, damit beide
  // Formeln festliegen und nicht nur eine davon.
  const strom = importDevices(CSV_BETRIEBSSTROM);
  // 30 kW / COP 3,00 = 10 kW; 10 kW / (√3 · 400 V) = 14,4 A > 10 A.
  check('Dreiphasig: 10 A tragen 14,4 A rechnerischen Betriebsstrom nicht', fehlerZuFeld(strom, 0, 'electric.fuse'), true);
  // Derselbe Strom gegen 20 A. Ohne den Faktor √3 wären es 43,5 A und auch
  // diese Zeile fiele durch — die Zeile hält also die Formel fest.
  check('Dreiphasig: 20 A tragen 14,4 A, Zeile übernehmbar', uebernehmbar(strom, 1), true);
  // 12 kW / COP 3,00 = 4 kW; einphasig 4 kW / 230 V = 17,4 A > 16 A.
  // Dreiphasig gerechnet wären es 5,8 A — die Zeile hält die zweite Formel fest.
  check('Einphasig: 16 A tragen 17,4 A rechnerischen Betriebsstrom nicht', fehlerZuFeld(strom, 2, 'electric.fuse'), true);

  // -- Schallleistung und Aufstellungsart ------------------------------------
  const aufstellung = importDevices(CSV_AUFSTELLUNG);
  // Ein Gerät ohne Außeneinheit hat keinen Außenschallpegel. Dort steht nichts
  // statt einer Null — eine Null hieße „gemessen und lautlos".
  check('Innenaufstellung lässt den Außenschallpegel leer', aussenschall(aufstellung, 0), 'leer');
  // Und der leere Wert ist kein Mangel: das Fehlende darf die Zeile nicht
  // zurückweisen, sonst ist ein Innengerät grundsätzlich nicht einlesbar.
  check('Innenaufstellung ohne Außenschallpegel bleibt übernehmbar', uebernehmbar(aufstellung, 0), true);
  check(
    'Außenaufstellung ohne Schallleistungspegel: Pflichtangabe fehlt',
    fehltPflichtfeld(aufstellung, 1, 'soundPowerOutdoor'),
    true,
  );
  // Ersatzwert aus dem Modul: 8,2 kW · 0,1075 m³/(h·kW) = 0,8815 m³/h, vom
  // Modul auf zwei Nachkommastellen gerundet — 0,88 m³/h.
  check(
    'Fehlender Mindestvolumenstrom folgt 0,1075 m³/(h·kW)',
    wpZahl(aufstellung, 0, (m) => m.minVolumeFlow),
    0.88,
    0.001,
  );
  // „Innenaufstellung" ohne Spalte „Wärmequelle" führt im Modul auf Sole; dort
  // gilt der Ersatzwert 4 l/kW: 8,2 · 4 = 32,8 l, auf ganze Liter gerundet 33 l.
  // Mit Luft als Quelle wären es 12 l/kW und damit 98 l — die Prüfung hält also
  // beides fest, den Ersatzwert und die angenommene Wärmequelle.
  check(
    'Fehlender Mindestwasserinhalt folgt 4 l/kW bei Sole',
    wpZahl(aufstellung, 0, (m) => m.minSystemVolume),
    33,
    0.001,
  );

  // -- Bauform aus der Wärmequelle ------------------------------------------
  // Fehlt die Spalte „Bauform", wird die Bauart angenommen. Diese Annahme darf
  // der ausdrücklich genannten Wärmequelle nicht widersprechen: eine Sole-
  // Wärmepumpe hat keine Außeneinheit, also auch keinen Außenschallpegel — und
  // eine vollständige Zeile darf daran nicht scheitern.
  const ohneBauform = importDevices(CSV_OHNE_BAUFORM);
  check('Sole ohne Bauform: kein Außenschallpegel gefordert', fehltPflichtfeld(ohneBauform, 0, 'soundPowerOutdoor'), false);
  check('Sole ohne Bauform: Zeile bleibt übernehmbar', uebernehmbar(ohneBauform, 0), true);
  check('Sole ohne Bauform: Außenschallpegel bleibt leer statt 0 dB(A)', aussenschall(ohneBauform, 0), 'leer');
  // Die Annahme selbst bleibt eine Annahme und muss im Bericht stehen — samt
  // dem, woraus sie stammt. Ohne diese Prüfung wäre auch ein Modul zufrieden,
  // das die Bauform stillschweigend setzt.
  check(
    'Sole ohne Bauform: die Annahme nennt ihre Herkunft',
    meldungstext(ohneBauform, 0, 'form').includes('Wärmequelle „Sole"'),
    true,
  );
  // Gegenprobe: bei Luft als Quelle gibt es eine Außeneinheit, ihr
  // Schallleistungspegel fehlt und die Zeile ist damit nicht übernehmbar.
  // Sonst wäre die Prüfung oben auch dann erfüllt, wenn die Pflichtangabe
  // gar nicht mehr gefordert würde.
  check('Luft ohne Bauform: Außenschallpegel bleibt Pflicht', fehltPflichtfeld(ohneBauform, 1, 'soundPowerOutdoor'), true);
  check('Luft ohne Bauform: Zeile ist nicht übernehmbar', uebernehmbar(ohneBauform, 1), false);

  // -- Angaben zum Innengerät ------------------------------------------------
  // Ohne vollständige Maße entsteht kein Innengerät. Der gelesene Speicher-
  // inhalt darf dabei nicht spurlos verschwinden: er steht dann als Meldung im
  // Bericht. Beides gehört zusammen — der Wert ist weg, und man erfährt es.
  const turm = importDevices(CSV_TURMGERAET);
  check('Innengerät ohne Maße wird nicht aufgebaut', innengeraet(turm, 0), 'ohne Innengerät');
  check(
    'Verworfener Speicherinhalt wird gemeldet',
    meldungslage(turm, 0, 'indoor.integratedCylinder'),
    'warn',
  );
  check(
    'Die Meldung nennt den verworfenen Wert',
    meldungstext(turm, 0, 'indoor.integratedCylinder').includes('190 l'),
    true,
  );
  // Eine Warnung weist die Zeile nicht zurück: das Innengerät ist keine
  // Pflichtangabe, der Rest der Zeile bleibt brauchbar.
  check('Fehlendes Innengerät weist die Zeile nicht zurück', uebernehmbar(turm, 0), true);
  // Gegenprobe mit Maßen: derselbe Wert kommt im Modell an und wird nicht
  // gemeldet. Damit ist belegt, dass die Meldung an den fehlenden Maßen hängt
  // und nicht daran, dass die Spalte grundsätzlich verworfen würde.
  check('Mit Maßen kommt der Speicherinhalt an', wpZahl(turm, 1, (m) => m.indoor?.integratedCylinder), 190, 0.001);
  check('Angekommener Speicherinhalt wird nicht gemeldet', meldungslage(turm, 1, 'indoor.integratedCylinder'), 'ohne Meldung');

  // -- Offengelegte Lesart der Stückzahl -------------------------------------
  // Dass „3 x 16 A" als 16 A gelesen wurde und nicht als 3 A, ist die Lesart,
  // die im Zweifel schiefgeht — sie muss deshalb im Bericht stehen und nicht
  // nur der entfernte Rest der Zelle. Erwartet wird der Wortlaut, den die Regel
  // des Moduls vorgibt: Zelle, übernommener Wert, Bedeutung der Stückzahl.
  check(
    'Die Lesart von „3 x 16 A" steht im Bericht',
    notiz(einheiten, 0, 'electric.fuse'),
    '„3 x 16 A" gelesen als 16 A je Phase bei 3 Phasen.',
  );
  // Bei der Spannung lautet dieselbe Offenlegung anders: 400 V liegen zwischen
  // zwei Außenleitern, nicht „je Phase". Die Prüfung hält fest, dass der
  // Wortlaut dem Zielfeld folgt und nicht schematisch angehängt wird.
  check(
    'Die Lesart von „3 x 400 V" nennt keine Spannung je Phase',
    notiz(einheiten, 0, 'electric.phases'),
    '„3 x 400 V" gelesen als 400 V bei 3 Phasen.',
  );

  // -- JSON ------------------------------------------------------------------
  const ausJson = importDevices(JSON_WAERMEPUMPE);
  check('JSON-Eintrag heißt „Eintrag 1", nicht „Zeile 1"', ausJson.devices[0]?.rowLabel ?? '', 'Eintrag 1');
  // JSON-Zahlen sind sprachneutral und tragen immer einen Dezimalpunkt.
  check('JSON wird punktbasiert gelesen', ausJson.decimalStyle, 'punkt');
  check(
    'Verschachteltes Objekt: outdoor.weight kommt an',
    wpZahl(ausJson, 0, (m) => m.outdoor?.weight),
    135,
    0.001,
  );
  check(
    'Verschachteltes Objekt: electric.maxCurrent kommt an',
    wpZahl(ausJson, 0, (m) => m.electric.maxCurrent),
    14.5,
    0.001,
  );
  check('Beide Betriebspunkte der Liste kommen an', ausJson.devices[0]?.heatPump?.ratings.length ?? -1, 2);

  // -- Zusammenführen mit dem Katalog ----------------------------------------
  const zuFuehren = importDevices(CSV_ZUSAMMENFUEHREN);
  const zusammen = mergeIntoCatalog(zuFuehren, { heatPumps: [TYPKLASSE], storages: [] });
  check('Gleiche Id verdrängt den vorhandenen Eintrag', zusammen.replaced.join(','), 'muster-8');
  check('Der verdrängte Eintrag wird ersetzt, nicht angehängt', zusammen.heatPumps.length, 1);
  check('Das übernommene Gerät trägt Herstellerherkunft', zusammen.heatPumps[0]?.provenance ?? '', 'hersteller');
  // Die Herkunft setzt `mergeIntoCatalog` von sich aus; sie allein belegt noch
  // nicht, dass auch die Zahlen gewechselt haben. Die Füllmenge trennt beide
  // Stände: 1,2 kg in der Typklasse, 1,25 kg in der eingelesenen Zeile.
  check(
    'Der ersetzte Eintrag trägt die eingelesene Füllmenge',
    zusammen.heatPumps[0]?.refrigerantMass ?? -1,
    1.25,
    0.001,
  );
  check('extraModels enthält genau das eingelesene Gerät', zusammen.extraModels.length, 1);
  check('Die zurückgewiesene Zeile bleibt außen vor', zusammen.skipped.join(','), 'muster-9');

  // -- Importvorlage ---------------------------------------------------------
  const vorlageWp = buildCsvTemplate('waermepumpe');
  check(
    'Vorlage Wärmepumpe enthält jede Pflichtspalte',
    ['Bezeichnung', 'Kältemittel', 'Füllmenge [kg]', 'Heizleistung [kW]', 'max. Vorlauftemperatur [°C]'].every((spalte) =>
      vorlageWp.includes(spalte),
    ),
    true,
  );
  const vorlageGelesen = importDevices(vorlageWp);
  // Die Beispielzeile der Vorlage muss den eigenen Prüfungen des Moduls
  // standhalten — sonst führt die Vorlage in einen Bericht voller Meldungen.
  check('Vorlage Wärmepumpe lässt sich wieder einlesen', vorlageGelesen.acceptedCount, 1);

  const vorlageSpeicher = buildCsvTemplate('speicher');
  check(
    'Vorlage Speicher enthält jede Pflichtspalte',
    ['Bezeichnung', 'Nenninhalt [l]', 'Durchmesser [m]', 'Höhe [m]'].every((spalte) => vorlageSpeicher.includes(spalte)),
    true,
  );
  // Die Speichervorlage muss denselben Rundlauf überstehen wie die
  // Wärmepumpenvorlage: Beispielzeile hinein, übernehmbarer Datensatz heraus.
  check('Vorlage Speicher lässt sich wieder einlesen', importDevices(vorlageSpeicher).acceptedCount, 1);

  // =========================================================================
  // Der SCOP ist ein Prüfergebnis, keine Eigenschaft einer Größenklasse
  // =========================================================================
  /*
   * Bis 1.30.0 trug jede Typklasse einen SCOP — 4,9 für den R290-Monoblock.
   * Es waren die einzigen Zahlen des Moduls, die aus keiner offengelegten
   * Beziehung stammten, und die Gegenprobe an drei Datenblättern hat sie
   * über allen Messwerten gefunden: 4,9 gegen 4,48 (Viessmann Vitocal
   * 250-A, ηs = 176 %) und 4,77 (Bosch Compress AW 10 OR-T).
   *
   * Der Einwand ist aber nicht die Höhe. COP und Leistung lassen sich aus
   * der Kennlinie einer Bauart ableiten; der SCOP nach EN 14825 ist das
   * Ergebnis einer Prüfung an einem bestimmten Gerät, mit seiner Regelung
   * und seinem Abtauverhalten. Eine Größenklasse hat keinen SCOP, so wie
   * eine Baureihe keine Seriennummer hat.
   *
   * Geprüft wird beides: dass keine Typklasse einen trägt, und dass ein
   * eingelesenes Datenblatt seinen behält. Sonst wäre die Änderung nicht
   * „ehrlicher", sondern nur „weniger".
   */
  check(
    'Keine Typklasse trägt einen SCOP bei 35 °C',
    HEAT_PUMP_CATALOG.filter((m) => m.scop35 !== undefined).length,
    0,
  );
  check(
    'Keine Typklasse trägt einen SCOP bei 55 °C',
    HEAT_PUMP_CATALOG.filter((m) => m.scop55 !== undefined).length,
    0,
  );
  check(
    'Und alle sind als Typklasse gekennzeichnet',
    HEAT_PUMP_CATALOG.every((m) => m.provenance === 'generisch'),
    true,
  );
  // Die übrigen Kennwerte bleiben — sie stammen aus der Kennlinie der
  // Bauart und sind damit begründbar.
  check(
    'Leistung und COP bleiben an jeder Typklasse',
    HEAT_PUMP_CATALOG.every((m) => m.ratings.length > 0 && m.nominalCapacity > 0),
    true,
  );

  {
    // Dasselbe Gerät mit Datenblatt: der SCOP kommt an und ist als
    // Herstellerangabe gekennzeichnet.
    // Dieselbe Kopfzeile wie oben, nur um die SCOP-Spalte erweitert — damit
    // der Datensatz vollständig ist und die Prüfung wirklich am SCOP hängt
    // und nicht an einer fehlenden Pflichtspalte.
    const mitBlatt = datei(
      [
        [...KOPF, 'SCOP 35'],
        ['Muster mit Blatt', 'R290', '1,2', '8,0', '2,70', '70', '49,0', '4,48'],
      ],
      ';',
    );
    const gelesen = importDevices(mitBlatt);
    const modell = gelesen.devices[0]?.heatPump;
    check('Datenblatt wird angenommen', gelesen.acceptedCount, 1);
    check('Sein SCOP kommt an', modell?.scop35 ?? 0, 4.48, 1e-9);
    check('Und ist als Herstellerangabe gekennzeichnet', modell?.provenance ?? '', 'hersteller');
  }
}
