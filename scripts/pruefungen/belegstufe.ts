/**
 * Prüfblock „Belegstufe des Schemakatalogs" (BWP-Vorhaben 1.2).
 *
 * **Worum es geht.** `src/lib/schemaKatalog.ts` trägt die elf Schemata des
 * BWP-Leitfadens Hydraulik mit ihren Auslegungswerten. Diese Zahlen sind das
 * Gerüst der Anlagenvorbemessung — und ein Katalog, der sich von seiner Quelle
 * entfernt, tut das **still**: Niemand merkt, wenn aus „20 bis 25 l je kW"
 * irgendwann „20 bis 30" wird, weil die Zahl plausibel bleibt.
 *
 * **Was hier geprüft wird, ist nicht die Rechnung, sondern die Herkunft.** Die
 * Tabelle unten ist von Hand aus dem Leitfaden (Ausgabe August 2023)
 * abgeschrieben — gegengelesen am 27.09.2026 gegen das Original, das Manuel
 * übergeben hat, festgehalten in `claude/bwp-leitfaeden-auswertung.md`. Jede
 * Zeile nennt die Zahlen, die im Katalog **wörtlich** stehen müssen.
 *
 * Damit kann der Katalog seine Quelle nicht mehr verlassen, ohne dass der
 * Prüflauf fällt. Das ist der ganze Zweck dieses Blocks: Er findet keinen
 * Rechenfehler, sondern eine **Abweichung vom Beleg**.
 *
 * **Und die Gegenprobe zur Prüfung selbst:** Die Tabelle muss gefüllt sein,
 * jede Zeile muss eine Zahl führen, und jeder gesuchte Text muss irgendwo im
 * Katalog vorkommen. Ein Suchmuster, das nichts trifft, wäre immer grün.
 */

import type { CheckFn } from './typ';
import type { BimDocument, Room } from '../../src/types/bim';
import { SCHEMA_KATALOG } from '../../src/lib/schemaKatalog';
import { aufnahmestand } from '../../src/lib/objektaufnahme';

/**
 * Die tragenden Zahlen des Leitfadens, von Hand abgeschrieben.
 *
 * `teile` sind die Zeichenfolgen, die im Katalogtext stehen müssen. Geschrieben
 * in der **Schreibweise des Katalogs**: Der führt deutschen Fließtext und
 * schreibt Einheiten aus — „75 Prozent", „20 Grad Celsius" —, während der
 * Leitfaden „75 %" und „20 °C" setzt. Gesucht wird nach dem Text, der
 * dastehen soll, nicht nach dem, der im PDF steht; die **Zahl** ist in beiden
 * Fällen dieselbe, und nur um sie geht es.
 */
const LEITFADEN: { groesse: string; teile: string[] }[] = [
  { groesse: 'Spreizung Primärseite', teile: ['3 bis 5 K'] },
  { groesse: 'Spreizung Heizungsseite', teile: ['5 bis 7 K', '10 K'] },
  { groesse: 'Spreizung Trinkwassererwärmung', teile: ['maximal 10 K'] },
  { groesse: 'Mindestvolumen Heizsystem', teile: ['3 bis 5 l'] },
  { groesse: 'Pufferspeicher', teile: ['20 bis 25 l', '30 bis 40 l'] },
  { groesse: 'Wärmeübertragerfläche im Trinkwassererwärmer', teile: ['0,25 m²'] },
  { groesse: 'Biomassekessel', teile: ['30 l', '55 l'] },
  { groesse: 'Kombispeicher', teile: ['1,1'] },
  { groesse: 'Kühlpuffer', teile: ['20 bis 25 l'] },
  { groesse: 'Kühlung', teile: ['4 bis 5 K', '4 K'] },
  { groesse: 'Erdsonde beim Kühlen', teile: ['75 Prozent', '300 Stunden'] },
  { groesse: 'Schluckbrunnen', teile: ['20 Grad Celsius'] },
];

export function pruefeBelegstufe(check: CheckFn): void {
  // Alle Auslegungszeilen und alle Bedingungen des Katalogs als ein Text —
  // gesucht wird im Ganzen, weil dieselbe Zahl in mehreren Schemata steht.
  const auslegung = SCHEMA_KATALOG.flatMap((v) => v.auslegung);
  const bedingungen = SCHEMA_KATALOG.flatMap((v) => v.bedingungen);
  const alleWerte = auslegung.map((a) => `${a.groesse} ${a.wert}`).join(' | ');
  const alleBelege = [
    ...auslegung.map((a) => a.quelle),
    ...bedingungen.map((b) => b.beleg),
    ...SCHEMA_KATALOG.map((v) => v.quelle),
  ];

  // -------------------------------------------------------------------------
  // 1 · Die Prüfung selbst muss etwas zu prüfen haben
  // -------------------------------------------------------------------------
  check('Belegstufe · die Leitfadentabelle ist gefüllt', LEITFADEN.length, 12);
  check('Belegstufe · jede Zeile führt eine Zahl',
    LEITFADEN.every((z) => z.teile.every((t) => /\d/.test(t))), true);
  check('Belegstufe · es gibt Auslegungszeilen im Katalog', auslegung.length > 30, true);
  check('Belegstufe · es gibt Belege im Katalog', alleBelege.length > 50, true);

  // -------------------------------------------------------------------------
  // 2 · Jede Zahl des Leitfadens steht im Katalog
  // -------------------------------------------------------------------------
  /*
   * Gesucht wird wörtlich. Das ist Absicht: Eine Prüfung, die „20–25" und
   * „20 bis 25" als dasselbe durchgehen lässt, lässt auch „20 bis 30" durch,
   * sobald jemand das Suchmuster aufweicht.
   */
  const fehlend = LEITFADEN.flatMap((z) =>
    z.teile.filter((t) => !alleWerte.includes(t)).map((t) => `${z.groesse}: ${t}`),
  );
  check('Belegstufe · keine Zahl des Leitfadens fehlt im Katalog', fehlend.join(' · '), '');

  // Und die Gegenprobe zum Suchverfahren: Eine Zahl, die der Leitfaden
  // **nicht** nennt, darf auch nicht gefunden werden. Sonst wäre oben jede
  // beliebige Folge grün.
  check('Belegstufe · eine erfundene Zahl wird nicht gefunden',
    alleWerte.includes('17 bis 23 l'), false);

  // -------------------------------------------------------------------------
  // 3 · Jeder Beleg nennt eine Quelle, und zwar die richtige
  // -------------------------------------------------------------------------
  check('Belegstufe · kein Beleg ist leer',
    alleBelege.filter((b) => !b || b.trim().length < 10).length, 0);

  /*
   * **Der Kern von Vorhaben 1.2.** Der Katalog war ursprünglich aus vier
   * Rechercheberichten gebaut — also aus Berichten *über* den Leitfaden. Seit
   * das Original vorliegt (gegengelesen am 27.09.2026), darf für alles, was im
   * Leitfaden steht, kein Beleg mehr auf einen solchen Bericht zeigen: Eine
   * Quelle zweiter Hand ist in einem Nachweis keine Quelle.
   *
   * Gemeint sind die **drei Schemaberichte**. Der vierte Bericht, „Recherche
   * Bauformen", ist etwas anderes: eine Marktübersicht aus
   * Herstellerunterlagen darüber, was in einem Turm- oder Kompaktgerät schon
   * eingebaut ist. Der Leitfaden sagt dazu nichts, also kann er sie nicht
   * ersetzen. Diese Belege bleiben — und sie sagen offen, dass sie aus einem
   * Bericht stammen. Das ist richtiger, als ein Herstellerdatenblatt zu
   * zitieren, das niemand im Volltext gelesen hat.
   */
  const schemaberichte = alleBelege.filter((b) => /Recherche Schemata|recherche-schemata/.test(b));
  check('Belegstufe · kein Beleg zeigt auf einen Schema-Recherchebericht', schemaberichte.join(' · '), '');

  /*
   * Und die Gegenprobe zu dieser Ausnahme: Die Bauformen-Belege sind noch da.
   * Verschwänden sie stillschweigend, wäre oben eine Regel ohne Gegenstand —
   * und niemand wüsste mehr, woher die Aussage „im Turmgerät steckt das
   * Ausdehnungsgefäß schon" kommt.
   */
  check('Belegstufe · die Bauformen-Belege nennen ihren Bericht',
    alleBelege.filter((b) => /Recherche Bauformen/.test(b)).length > 5, true);

  /*
   * **Wer `primaer` behauptet, muss ein Herstellerdokument nennen.** So ist
   * die Stufe definiert: „Herstellerdatenblatt oder Planungsunterlage im
   * Volltext". Eine Vorlage, die sich nur auf eine Marktübersicht stützt und
   * trotzdem `primaer` trägt, behauptet eine Belegstufe, die sie nicht hat —
   * und genau das soll dieser Block unmöglich machen.
   */
  const herstellerwort = /Planungs(unterlage|information)|Datenblatt|Kurzanleitung|Montageanleitung|Projektierung/;
  const primaerOhneDokument = SCHEMA_KATALOG.filter(
    (v) => v.belastbarkeit === 'primaer' && !herstellerwort.test(v.quelle),
  ).map((v) => v.kennung);
  check('Belegstufe · jede primäre Vorlage nennt ein Herstellerdokument',
    primaerOhneDokument.join(', '), '');
  // Dass es überhaupt primäre Vorlagen gibt, gehört zur Prüfung: sonst wäre
  // die Regel oben leer.
  check('Belegstufe · es gibt primär belegte Vorlagen',
    SCHEMA_KATALOG.filter((v) => v.belastbarkeit === 'primaer').length > 0, true);

  /*
   * Wer den BWP-Leitfaden zitiert, muss sagen **wo**: Schema, Zeile, Tabelle
   * oder Seite. „Steht im Leitfaden" ist keine Fundstelle — und wer es später
   * nachschlagen will, findet es sonst nicht.
   */
  const bwpOhneStelle = alleBelege.filter(
    (b) =>
      b.includes('BWP Leitfaden Hydraulik') &&
      !/(Schema|Zeile|Tabelle|Auslegungstabelle|Seite|S\. ?\d|Hinweise|Abbildung)/.test(b),
  );
  check('Belegstufe · jeder BWP-Beleg nennt seine Fundstelle', bwpOhneStelle.length, 0);

  // Die Ausgabe ist mitzuzählen: Ein Leitfaden ohne Jahr ist in fünf Jahren
  // nicht mehr derselbe.
  const bwpBelege = alleBelege.filter((b) => b.includes('BWP Leitfaden Hydraulik'));
  check('Belegstufe · es wird überhaupt aus dem Leitfaden belegt', bwpBelege.length > 20, true);
  check('Belegstufe · jeder BWP-Beleg nennt die Ausgabe',
    bwpBelege.filter((b) => !b.includes('August 2023')).length, 0);

  // -------------------------------------------------------------------------
  // 4 · Die drei Redaktionsfehler des Leitfadens bleiben vermerkt
  // -------------------------------------------------------------------------
  /*
   * Der Leitfaden hat drei Fehler, die beim Gegenlesen bestätigt wurden:
   * Schema 5 spricht beim Gas- oder Ölkessel vom „Festbrennstoff-Wärmeerzeuger",
   * Schema 10 bemisst den Puffer „nach Planung der Solaranlage", und die
   * Schemata 8 und 9 heißen im Inhaltsverzeichnis anders als auf der Seite.
   *
   * **Warum das hier geprüft wird:** Wer einen Katalog aus einer Quelle
   * nachführt, verliert leicht den Fehler *und* die Korrektur. Steht der
   * Vermerk nicht mehr da, sieht der Katalog aus wie ein Abschreibfehler —
   * und der nächste, der ihn „berichtigt", baut den Fehler des Leitfadens ein.
   */
  const text = [...alleBelege, alleWerte].join(' | ');
  check('Belegstufe · der Vermerk zum Festbrennstoff-Wortlaut steht noch da',
    /Festbrennstoff/.test(text), true);
  check('Belegstufe · der Vermerk zur Solaranlagen-Bemessung steht noch da',
    /nach Planung der Solaranlage/.test(text), true);
}

/**
 * Prüfblock „Objektaufnahmebogen" (BWP-Vorhaben 4.2).
 *
 * **Die Regel, um die es geht: keine zweite Wahrheit.** Der Bogen liest, was
 * Modell, Projekt und Anlagenblatt hergeben, und lässt nur eintippen, was dort
 * keinen Platz hat. Zwei Felder für dieselbe Angabe wären zwei Wahrheiten, die
 * sich widersprechen können — genau der Fehler, den dieses Programm an anderen
 * Stellen vermeidet.
 *
 * Geprüft wird deshalb vor allem die **Herkunft** jeder Zeile: Was aus dem
 * Modell kommt, darf nicht eintippbar sein, und was eintippbar ist, darf nicht
 * aus dem Modell kommen.
 *
 * Alle Sollwerte sind am Prüfhaus unten von Hand abgezählt.
 */
export function pruefeObjektaufnahme(check: CheckFn): void {
  const leer = baueAufnahmehaus();
  const stand = aufnahmestand(leer);

  // -------------------------------------------------------------------------
  // 1 · Der Bogen ist vollständig und gruppiert
  // -------------------------------------------------------------------------
  // Fünf Gruppen nach der Checkliste des Praxisratgebers: Gebäude, Hülle,
  // Nutzung, bestehende Anlage, Wärmeverteilung.
  check('Objektaufnahme · fünf Gruppen', stand.gruppen.length, 5);
  check('Objektaufnahme · die Gruppen heißen wie die Checkliste',
    stand.gruppen.map((g) => g.titel).join(' | '),
    'Gebäude | Gebäudehülle | Nutzung | Bestehende Anlage | Wärmeverteilung');
  // 4 + 5 + 3 + 6 + 2 = 20 Positionen, von Hand abgezählt.
  check('Objektaufnahme · zwanzig Positionen', stand.gesamt, 20);
  check('Objektaufnahme · die Summe stimmt mit den Gruppen',
    stand.gruppen.reduce((n, g) => n + g.zeilen.length, 0), stand.gesamt);
  // Jede Kennung nur einmal — die Oberfläche hängt daran.
  check('Objektaufnahme · Kennungen eindeutig',
    new Set(stand.gruppen.flatMap((g) => g.zeilen.map((z) => z.id))).size, stand.gesamt);
  check('Objektaufnahme · jede Position hat eine Frage',
    stand.gruppen.flatMap((g) => g.zeilen).filter((z) => z.frage.trim().length < 5).length, 0);

  // -------------------------------------------------------------------------
  // 2 · Herkunft: was aus dem Modell kommt, wird nicht eingetippt
  // -------------------------------------------------------------------------
  const zeilen = stand.gruppen.flatMap((g) => g.zeilen);
  const ausAufnahme = zeilen.filter((z) => z.herkunft === 'aufnahme').map((z) => z.id).sort();
  /*
   * Genau diese neun Positionen haben im Modell keinen Platz: die drei
   * Dämmzustände, die Verglasung, die vier Angaben zur bestehenden Heizung und
   * die Warmwasserbereitung. Alles andere steht im Modell oder am Projekt.
   *
   * Käme eine Position dazu, die es schon gibt, fiele diese Prüfung — und das
   * ist ihr Zweck.
   */
  check('Objektaufnahme · neun Positionen werden eingetippt', ausAufnahme.length, 9);
  check('Objektaufnahme · und zwar genau diese',
    ausAufnahme.join(', '),
    'daemmung-dach, daemmung-keller, daemmung-wand, heizung-art, heizung-baujahr, heizung-leistung, typenschild, verglasung, warmwasser');
  // Elf Positionen liest der Bogen — aus Modell, Projekt oder Anlagenblatt.
  check('Objektaufnahme · elf Positionen werden gelesen',
    zeilen.filter((z) => z.herkunft !== 'aufnahme').length, 11);
  check('Objektaufnahme · die Fläche wird gelesen und nicht getippt',
    zeilen.find((z) => z.id === 'wohnflaeche')?.herkunft ?? '—', 'modell');
  check('Objektaufnahme · das Baujahr kommt vom Projekt',
    zeilen.find((z) => z.id === 'baujahr')?.herkunft ?? '—', 'projekt');

  // -------------------------------------------------------------------------
  // 3 · Am leeren Haus steht „nicht erfasst" — und nichts wird geraten
  // -------------------------------------------------------------------------
  /*
   * Das Prüfhaus hat zwei Geschosse, drei Räume (davon ein Bad, 20 + 15 + 8 =
   * 43 m², alle beheizt) und sonst nichts: keine Aufnahme, kein Baujahr, kein
   * Verbrauch, keine Anlage. Belegt sind damit **vier** Positionen:
   * Geschosse (2), beheizte Fläche (43,0 m²), Bäder (1) und die Zeile
   * „beheizte Räume mit Heizfläche" (0 von 3).
   */
  check('Objektaufnahme · am leeren Haus vier belegte Positionen', stand.belegt, 4);
  check('Objektaufnahme · sechzehn offene', stand.offen.length, 16);
  check('Objektaufnahme · die Geschosse stehen da',
    zeilen.find((z) => z.id === 'geschosse')?.wert ?? '—', '2');
  check('Objektaufnahme · die Fläche steht da',
    zeilen.find((z) => z.id === 'wohnflaeche')?.wert ?? '—', '43,0 m²');
  check('Objektaufnahme · ein Bad', zeilen.find((z) => z.id === 'baeder')?.wert ?? '—', '1');
  // **Die Gegenprobe:** Ohne Heizfläche steht „0 von 3" und nicht gar nichts.
  // Ein beheizter Raum ohne Heizfläche ist der häufigste Aufnahmefehler.
  check('Objektaufnahme · Räume ohne Heizfläche fallen auf',
    zeilen.find((z) => z.id === 'raeume-mit-heizflaeche')?.wert ?? '—', '0 von 3');
  // Und nichts ist geraten: Die Dämmung ist leer und nicht „ungedämmt".
  check('Objektaufnahme · die Dämmung wird nicht geraten',
    zeilen.find((z) => z.id === 'daemmung-dach')?.wert === undefined, true);
  check('Objektaufnahme · die bestehende Heizung wird nicht geraten',
    zeilen.find((z) => z.id === 'heizung-art')?.wert === undefined, true);

  // -------------------------------------------------------------------------
  // 4 · Eingetragene Angaben erscheinen — mit ihrer Beschriftung
  // -------------------------------------------------------------------------
  const gefuellt = baueAufnahmehaus();
  gefuellt.meta = {
    ...gefuellt.meta,
    baualter: 'efh-c',
    verbrauch: { brennstoff: 'oel', menge: 2800, mitWarmwasser: true, jahr: 2025 },
    aufnahme: {
      daemmungDach: 'gedaemmt',
      daemmungKeller: 'ungedaemmt',
      verglasung: '2-fach, 1998',
      heizungArt: 'oel-niedertemperatur',
      heizungBaujahr: 1994,
      heizungLeistung: 24,
      typenschild: 'Viessmann Vitola 200, 24 kW',
      warmwasser: 'speicher-am-kessel',
    },
  };
  const voll = aufnahmestand(gefuellt);
  const z2 = voll.gruppen.flatMap((g) => g.zeilen);
  check('Objektaufnahme · die Dämmung steht im Klartext',
    z2.find((z) => z.id === 'daemmung-dach')?.wert ?? '—', 'gedämmt');
  check('Objektaufnahme · die Heizungsart im Klartext',
    z2.find((z) => z.id === 'heizung-art')?.wert ?? '—', 'Ölkessel, Niedertemperatur');
  check('Objektaufnahme · die Leistung mit Einheit',
    z2.find((z) => z.id === 'heizung-leistung')?.wert ?? '—', '24,0 kW');
  // Baualtersklasse 'efh-c' ist „bis 1948" — der Bogen nennt die Klasse und
  // nicht ihre Kennung.
  check('Objektaufnahme · das Baujahr als Klasse',
    z2.find((z) => z.id === 'baujahr')?.wert ?? '—', 'bis 1948');
  // Der Verbrauch mit Einheit, Träger, Warmwasservermerk und Jahr.
  check('Objektaufnahme · der Verbrauch vollständig',
    z2.find((z) => z.id === 'verbrauch')?.wert ?? '—', '2800 l/a Heizöl, mit Warmwasser (2025)');
  /*
   * Dazugekommen sind **zehn** Angaben: acht in der Aufnahme (zwei
   * Dämmzustände, Verglasung, vier zur Heizung, Warmwasser) und zwei am
   * Projekt (Baualtersklasse und Verbrauch). 4 + 10 = 14.
   *
   * Beim ersten Herleiten hatte ich die beiden Projektangaben vergessen und
   * 12 erwartet — die Prüfung hat meinen Zählfehler gefunden, nicht einen im
   * Programm. Genau dafür wird hier von Hand gezählt.
   */
  check('Objektaufnahme · jetzt vierzehn belegte Positionen', voll.belegt, 14);
  check('Objektaufnahme · und sechs offene', voll.offen.length, 6);
  check('Objektaufnahme · belegt und offen ergeben die Gesamtzahl',
    voll.belegt + voll.offen.length, voll.gesamt);
  /*
   * **Die Gegenprobe zur Zählung:** Wer eine Angabe wieder leert, verliert sie
   * auch in der Zahl. Eine Vollständigkeit, die nur steigt, wäre keine.
   */
  const geleert = { ...gefuellt, meta: { ...gefuellt.meta, aufnahme: { ...gefuellt.meta.aufnahme, verglasung: '' } } };
  check('Objektaufnahme · eine geleerte Angabe zählt nicht mehr',
    aufnahmestand(geleert as typeof gefuellt).belegt, 13);
}

/**
 * Das Prüfhaus: zwei Geschosse, drei beheizte Räume (20 + 15 + 8 = 43 m²),
 * davon ein Bad. Keine Aufnahme, kein Baujahr, kein Verbrauch, keine Anlage,
 * keine Heizfläche — damit ist jede belegte Position unten von Hand
 * nachzuzählen.
 */
function baueAufnahmehaus(): BimDocument {
  const raum = (id: string, levelId: string, area: number, usage: string): Room =>
    ({
      id,
      levelId,
      name: id,
      usage,
      area,
      isHeated: true,
      setpointTemperature: 20,
      airChangeRate: 0.5,
      innerPolygon: [],
      centroid: { x: 0, y: 0 },
      perimeter: 0,
      boundaries: [],
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
      r1: raum('r1', 'eg', 20, 'living'),
      r2: raum('r2', 'eg', 15, 'bedroom'),
      r3: raum('r3', 'og', 8, 'bath'),
    },
    diagnostics: { openEnds: [], gaps: [], nearMisses: [] },
    meta: { name: 'Prüfhaus' },
  } as unknown as BimDocument;
}
