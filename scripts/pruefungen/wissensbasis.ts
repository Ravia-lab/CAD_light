/**
 * Prüfblock „Wissensbasis" — Retrieval-Maschine (`src/lib/wissensbasis.ts`)
 * und Korpus (`src/lib/wissenKorpus.ts`).
 * ---------------------------------------------------------------------------
 *
 * **Warum dieser Block gebraucht wird.** Ein Rechenkern fällt auf, wenn er
 * falsch rechnet: die Zahl im Bericht ist dann sichtbar falsch. Eine
 * Wissensbasis fällt nicht auf. Sie liefert *immer* etwas, und was sie
 * liefert, sieht *immer* aus wie eine Quelle. Die drei Fehlerklassen, die
 * dieser Block deshalb fängt, sind alle stumm:
 *
 *  1. **Der Korpus verrottet leise.** Ein falscher Eintrag sieht genauso aus
 *     wie ein richtiger — dieselben Felder, derselbe Ton, dieselbe Länge. Ein
 *     doppelt vergebener Schlüssel, ein Thema mit Tippfehler, ein Markdown-
 *     Sternchen aus einem kopierten Rechercheabschnitt, eine `url`, die keine
 *     ist: nichts davon wirft einen Fehler, nichts davon sieht man dem
 *     Bildschirm an. Sichtbar wird es erst, wenn der Eintrag im gedruckten
 *     Nachweis steht und jemand die Fundstelle nachschlägt. Deshalb ist
 *     Abschnitt 9 bis 13 der umfangreichste Teil dieses Blocks.
 *  2. **Die Annahme, die sich als Norm ausgibt.** `belastbarkeit` trennt
 *     Gesetzestext, Fachliteratur und die eigene Festlegung des Programms.
 *     Der gefährlichste Eintrag im ganzen Korpus ist der, der auf `annahme`
 *     steht, dessen Text das aber nicht sagt: im Bericht steht dann ein Satz
 *     ohne Vorbehalt, und die Kennzeichnung, die daneben stünde, liest kein
 *     Mensch. Abschnitt 12 prüft genau das.
 *  3. **Die Maschine trifft daneben und meldet es nicht.** Findet die Suche
 *     nichts, sieht das aus wie „dazu gibt es nichts im Korpus" — nicht wie
 *     „die Wortnormalisierung hat den Suchbegriff zerlegt". Ein Stemmer, der
 *     einen Buchstaben zu viel abschneidet, ein Stoppwort, das ein
 *     bedeutungstragendes Wort verschluckt, eine Rangfusion, in der der große
 *     Korpus den kleinen überstimmt: alles drei liefert eine plausible,
 *     nichtssagende Trefferliste.
 *
 * **Wie geprüft wird.** Die Eigenschaften der Maschine (Abschnitt 5 bis 7)
 * werden an **eigens gebauten Korpora** geprüft, nicht am echten. Das ist
 * Absicht: eine Prüfung, die „norm-60c-abs1-abgleichpflicht muss bei der
 * Frage nach dem Abgleich oben stehen" behauptet, prüft nicht die Maschine,
 * sondern friert eine Momentaufnahme des Inhalts ein und geht bei jedem neuen
 * Eintrag kaputt. Geprüft wird deshalb die *Eigenschaft* — „ein Titeltreffer
 * wiegt schwerer als ein Texttreffer", „ein seltener Term wiegt schwerer als
 * ein häufiger" — an Daten, deren Termhäufigkeiten dieser Block selbst kennt.
 * Am echten Korpus wird nur geprüft, was am echten Korpus hängt: die
 * Synonymliste (Abschnitt 8) und die Unversehrtheit der Daten.
 *
 * **Herleitung der BM25-Sollwerte.** Die Maschine rechnet
 *
 *   IDF(t) = ln(1 + (N − n + 0,5)/(n + 0,5))
 *   BM25   = Σ_t IDF(t) · f·(k₁+1) / (f + k₁·(1 − b + b·L/L̄))
 *
 * mit k₁ = 1,2 und b = 0,75. Sind alle Dokumente eines Prüfkorpus **gleich
 * lang**, ist L/L̄ = 1 und damit die Klammer 1 − 0,75 + 0,75 = 1. Der
 * Sättigungsterm hängt dann nur noch an f:
 *
 *   f = 1 →  1·2,2 / (1 + 1,2) = 2,2/2,2   = 1,0
 *   f = 2 →  2·2,2 / (2 + 1,2) = 4,4/3,2   = 1,375
 *
 * Genau darauf sind die Prüfkorpora gebaut: alle Einträge haben dieselbe
 * Wortzahl, damit die Sollwerte von Hand nachrechenbar bleiben.
 *
 *   • Abschnitt 5, Titelgewicht (N = 3, Term in n = 2 Dokumenten):
 *       IDF = ln(1 + (3 − 2 + 0,5)/2,5) = ln(1 + 0,6) = ln 1,6 = 0,4700036
 *       Titeltreffer (f = 2, Titel zählt doppelt): 0,4700036 · 1,375 = 0,6462550
 *       Texttreffer  (f = 1):                      0,4700036 · 1,0   = 0,4700036
 *       Das Verhältnis ist 1,375 — es kommt allein aus der Verdopplung.
 *
 *   • Abschnitt 5, IDF (N = 8):
 *       häufiger Term in allen 8: ln(1 + 0,5/8,5) = ln 1,0588235 = 0,0571584
 *       seltener Term in genau 1: ln(1 + 7,5/1,5) = ln 6         = 1,7917595
 *       Verhältnis 31,3 — bei gleicher Termhäufigkeit und gleicher Länge ist
 *       das der reine IDF-Beitrag.
 *
 *   • Abschnitt 6, Rangfusion: RRF(d) = Σ 1/(k + Rang) mit k = 60. Der erste
 *     Rang eines Korpus trägt 1/61 = 0,0163934 bei, der zweite 1/62 =
 *     0,0161290, der elfte 1/71 = 0,0140845. Der Abstand zwischen Rang 1 und
 *     Rang 11 ist damit kleiner als ein Sechstel des Beitrags selbst — das ist
 *     der ganze Zweck der Konstante: ein zweiter Korpus soll aufholen können.
 *
 * **Was hier bewusst nicht geprüft wird.** Ob ein Eintrag inhaltlich stimmt,
 * kann kein Prüfblock feststellen — dafür müsste er die Quelle lesen. Geprüft
 * wird deshalb die Form: dass jeder Eintrag auffindbar, eindeutig, zitierbar
 * und in seiner Belastbarkeit ehrlich gekennzeichnet ist. Das ist die einzige
 * Zusicherung, die eine Datensammlung maschinell geben kann.
 */

import type { CheckFn } from './typ';
import {
  Wissensbasis,
  quellenzeile,
  tokenisiere,
  type Belastbarkeit,
  type KorpusId,
  type WissensEintrag,
} from '../../src/lib/wissensbasis';
import { KORPUS_STAND, WISSEN_KORPUS, korpusUmfang } from '../../src/lib/wissenKorpus';

// ---------------------------------------------------------------------------
// Sollwerte des Korpus — hier hergeleitet, nicht aus dem Prüfling abgeschrieben
// ---------------------------------------------------------------------------

/**
 * Die vier Sammlungen. Sie stehen im Typ `KorpusId` und im Dateikopf von
 * wissenKorpus.ts; hier noch einmal als Datum, damit ein fünfter Wert
 * auffällt, statt sich still einzureihen.
 */
const ERLAUBTE_KORPORA: readonly KorpusId[] = ['normen', 'tabellen', 'hydraulik', 'projekt'];

/** Die drei Belastbarkeitsstufen — mehr darf es nicht geben, weniger auch nicht. */
const ERLAUBTE_BELASTBARKEIT: readonly Belastbarkeit[] = ['primaer', 'sekundaer', 'annahme'];

/**
 * Die zulässigen Themenschlüssel.
 *
 * `themen` ist ein `string[]` — der Übersetzer fängt hier gar nichts. Ein
 * Eintrag mit `'waermepumpen'` statt `'waermepumpe'` übersetzt sauber, wird
 * angezeigt, ist durchsuchbar, und fehlt trotzdem in jeder Belegliste, die
 * der Rechenkern über `belege('waermepumpe')` zieht. Sichtbar wird das nie:
 * die Belegliste ist dann eben um einen Eintrag kürzer.
 *
 * Diese Liste ist deshalb die Gegenprobe. Sie wird beim Ergänzen des Korpus
 * mitgepflegt; ein neues Thema kostet eine Zeile hier, ein vertipptes fällt
 * sofort auf. Die Reihenfolge ist alphabetisch, damit sich Einfügungen ohne
 * Nachdenken einsortieren lassen.
 */
const ERLAUBTE_THEMEN: readonly string[] = [
  'abgleich-recht',
  'abgleich-verfahren',
  'ausdehnungsgefaess',
  'dokumentation',
  'druckgefaelle',
  'druckverlust',
  'einzelwiderstand',
  'fussbodenheizung',
  'geschwindigkeit',
  'heizkoerper',
  'mischer',
  'programmannahme',
  'puffer',
  'pumpe',
  'rauigkeit',
  'rohrdaemmung',
  'rohrdimension',
  'rohrreibung',
  'schemafehler',
  'sicherheit',
  'stoffwerte',
  'trinkwasser',
  'ueberstroemventil',
  'ventilautoritaet',
  'voreinstellung',
  'waermemengenzaehler',
  'waermepumpe',
  'wasserqualitaet',
];

/**
 * Wörter, an denen ein Eintrag der Stufe `annahme` sich zu erkennen gibt.
 *
 * Die Kennzeichnung im Feld `belastbarkeit` steuert die Anzeige — der Text
 * dagegen wird zitiert, kopiert und in Berichte übernommen, oft ohne das Feld
 * daneben. Ein Annahmetext, der nicht selbst sagt, dass er eine Annahme ist,
 * wandert als Tatsachenbehauptung in fremde Dokumente.
 */
const ANNAHME_WORTE: readonly string[] = ['Annahme', 'angenommen', 'Vorgabe'];

// ---------------------------------------------------------------------------
// Prüfkorpora — eigene Daten mit bekannten Termhäufigkeiten
// ---------------------------------------------------------------------------

/**
 * Baut einen Prüfeintrag.
 *
 * Die drei Schlagworte sind immer dieselben und immer bedeutungslos: sie
 * gehen doppelt gewichtet in die Dokumentlänge ein, und damit die Sollwerte
 * oben stimmen, muss diese Länge in allen Einträgen eines Prüfkorpus gleich
 * sein. Wer hier ein viertes Schlagwort anfügt, verschiebt L̄ und damit jeden
 * BM25-Sollwert.
 */
function pe(
  id: string,
  korpus: KorpusId,
  titel: string,
  text: string,
  belastbarkeit: Belastbarkeit,
  themen: string[],
): WissensEintrag {
  return {
    id,
    korpus,
    titel,
    text,
    schlagworte: ['fuellwort', 'nebensache', 'randnotiz'],
    quelle: 'Prüfdaten dieses Blocks',
    belastbarkeit,
    themen,
  };
}

/**
 * Der Grundkorpus: zwölf Einträge auf vier Sammlungen.
 *
 * Er trägt die Suchoptionen, den Themenzugriff und die Zugriffsfunktionen.
 * Die Texte sind so gebaut, dass jedes Suchwort in genau bekannt vielen
 * Einträgen steht — `kavitation` in genau einem, `ventil` in mehreren.
 * Die Belastbarkeiten sind gemischt, damit `mindestens` etwas zu filtern hat,
 * und die Schlüssel sind absichtlich nicht in der Reihenfolge vergeben, in
 * der `belege` sie später ausgeben muss.
 */
const GRUNDKORPUS: WissensEintrag[] = [
  pe('pb-n-autoritaet', 'normen', 'Ventilautoritaet', 'Die ventilautoritaet setzt den druckverlust des ventils ins verhaeltnis.', 'primaer', ['probe-ventil', 'probe-quer']),
  pe('pb-n-kavitation', 'normen', 'Kavitation', 'Bei hohem differenzdruck entsteht kavitation im ventil und es wird laut.', 'sekundaer', ['probe-ventil']),
  pe('pb-n-daemmung', 'normen', 'Rohrdaemmung', 'Die daemmung einer leitung richtet sich nach dem innendurchmesser.', 'sekundaer', ['probe-rohr']),
  pe('pb-n-abnahme', 'normen', 'Abnahme', 'Bei der abnahme wird das ueberstroemventil auf seine wirkung geprueft.', 'annahme', ['probe-quer']),
  pe('pb-t-kupfer', 'tabellen', 'Kupfer', 'Kupferrohr hat eine glatte oberflaeche mit geringer rauigkeit.', 'primaer', ['probe-rohr']),
  pe('pb-t-stahl', 'tabellen', 'Stahl', 'Stahlrohr rostet ohne schutz und hat eine hoehere rauigkeit.', 'primaer', ['probe-rohr', 'probe-quer']),
  pe('pb-t-kunststoff', 'tabellen', 'Kunststoff', 'Kunststoffrohr braucht eine sauerstoffdichte sperrschicht im heizkreis.', 'sekundaer', ['probe-rohr']),
  pe('pb-t-kvwert', 'tabellen', 'Kvwert', 'Der kvwert eines ventils gilt bei einem bar druckdifferenz.', 'sekundaer', ['probe-ventil']),
  pe('pb-h-weiche', 'hydraulik', 'Weiche', 'Eine hydraulische weiche entkoppelt zwei kreise voneinander.', 'sekundaer', ['probe-schema']),
  pe('pb-h-puffer', 'hydraulik', 'Puffer', 'Der puffer haelt das mindestvolumen fuer den abtaubetrieb bereit.', 'sekundaer', ['probe-schema']),
  pe('pb-h-mischer', 'hydraulik', 'Mischer', 'Ein mischer senkt die vorlauftemperatur fuer den zweiten kreis.', 'annahme', ['probe-schema', 'probe-quer']),
  pe('pb-h-ueberstroem', 'hydraulik', 'Ueberstroemventil', 'Das ueberstroemventil ist ein ventil und sichert den mindestdurchfluss der pumpe.', 'primaer', ['probe-schema', 'probe-ventil']),
];

/**
 * Der Titelkorpus: drei gleich lange Einträge.
 *
 * `kavitatio` (der Stamm von „Kavitation") steht in Eintrag 1 im **Titel**,
 * in Eintrag 2 im **Text** und in Eintrag 3 gar nicht. Alle drei haben
 * dieselbe Wortzahl — Titel ein Wort, Text acht Wörter, dieselben drei
 * Schlagworte, ein Thema —, damit die Längennormierung wegfällt und der
 * Unterschied allein aus der Verdopplung des Titels kommt.
 */
const TITELKORPUS: WissensEintrag[] = [
  pe('tk-im-titel', 'normen', 'Kavitation', 'satz ohne besonderheit rundum probe pruefung heizung leitung', 'primaer', ['tk']),
  pe('tk-im-text', 'normen', 'Nebensache', 'satz ohne kavitation rundum probe pruefung heizung leitung', 'primaer', ['tk']),
  pe('tk-gar-nicht', 'normen', 'Beiwerk', 'satz ohne besonderheit rundum probe pruefung heizung leitung', 'primaer', ['tk']),
];

/**
 * Der IDF-Korpus: acht gleich lange Einträge.
 *
 * `haeufigwort` steht in allen acht, `seltenwort` in genau einem. Der Titel
 * trägt in allen Einträgen genau ein Wort („Blatt" — die Ziffer dahinter ist
 * einzeichig und fällt bei der Zerlegung weg), der Text in allen sechs. Damit
 * sind alle Dokumentlängen gleich, die Termhäufigkeit ist überall 1, und die
 * BM25-Punktzahl reduziert sich auf den reinen IDF-Beitrag.
 */
const IDF_KORPUS: WissensEintrag[] = Array.from({ length: 8 }, (_, i) =>
  pe(
    `idf-${i}`,
    'tabellen',
    `Blatt ${i}`,
    i === 0
      ? 'haeufigwort seltenwort fuelltext dauertext ruhetext restwort'
      : 'haeufigwort andereswort fuelltext dauertext ruhetext restwort',
    'sekundaer',
    ['idf'],
  ),
);

/**
 * Der Fusionskorpus: zwei Einträge gegen vierzig.
 *
 * Das ist die Lage, für die die Rangfusion überhaupt gebaut wurde. Im großen
 * Korpus tragen **zehn** Einträge den Suchbegriff im Titel und zweimal im
 * Text, im kleinen Korpus trägt **einer** ihn einmal im Text. In einem
 * gemeinsamen Index läge der kleine Eintrag damit hinter zehn anderen — in
 * getrennten Indizes ist er Rang 1 seines Korpus und kommt über RRF nach oben.
 *
 * Damit die Prüfung diesen Unterschied auch zeigt und nicht nur behauptet,
 * baut Abschnitt 6 aus **denselben Texten** zwei Wissensbasen: einmal mit der
 * echten Zuordnung, einmal mit allen 42 Einträgen im selben Korpus.
 */
function fusionsdaten(getrennt: boolean): WissensEintrag[] {
  const klein: KorpusId = getrennt ? 'projekt' : 'tabellen';
  const raus: WissensEintrag[] = [
    // Der Titel trägt bewusst KEIN Wort, das über die Synonymliste mit der
    // Frage verwandt ist. „Bypass" stand hier ursprünglich — und ist ein
    // eingetragenes Synonym des Überströmventils. Der Eintrag wäre damit
    // auch im gemeinsamen Index vorn gelandet, und die Gegenprobe hätte
    // nicht die Rangfusion gemessen, sondern die Synonymliste.
    pe('klein-treffer', klein, 'Kappe ohne Funktion', 'Hier wird das ueberstroemventil einmal genannt und sonst nichts.', 'primaer', ['fusion']),
    pe('klein-abseits', klein, 'Etwas ganz anderes', 'Ein satz ganz ohne bezug zur gestellten frage.', 'primaer', ['fusion']),
  ];
  for (let i = 0; i < 40; i++) {
    const stark = i < 10;
    raus.push(
      pe(
        `gross-${i}`,
        'tabellen',
        stark ? `Ueberstroemventil Baureihe ${i}` : `Tabellenblatt ${i}`,
        stark
          ? 'Das ueberstroemventil in dieser reihe, ueberstroemventil mit federvorspannung.'
          : `Ein tabellenwert der reihe ${i} ohne jeden bezug zur frage.`,
        'sekundaer',
        ['fusion'],
      ),
    );
  }
  return raus;
}

// ---------------------------------------------------------------------------
// Hilfsmittel
// ---------------------------------------------------------------------------

/** Erster Stamm eines Wortes — für die Prüfungen der Wortnormalisierung. */
function stammVon(wort: string): string {
  return tokenisiere(wort)[0] ?? '';
}

/** Trefferliste als Schlüsselkette — vergleichbar in einem einzigen `check`. */
function kette(basis: Wissensbasis, frage: string, anzahl: number): string {
  return basis
    .suche(frage, { anzahl })
    .map((t) => t.eintrag.id)
    .join(',');
}

export function pruefeWissensbasis(check: CheckFn): void {
  const echt = new Wissensbasis(WISSEN_KORPUS);
  const probe = new Wissensbasis(GRUNDKORPUS);

  // === 1 — Wortnormalisierung: Umlaute ====================================
  // Der Kommentar an `entumlauten` nennt den Zweck ausdrücklich: „damit
  // ‚Wärmepumpe' und ‚Waermepumpe' treffen". Beide Schreibweisen kommen im
  // Betrieb vor — die eine aus einer Tastatur mit Umlauten, die andere aus
  // einem Datenbestand ohne. Sie müssen auf denselben Stamm fallen, sonst
  // findet die zweite Schreibweise nichts, ohne dass es jemand merkt.
  check('„Wärmepumpe" und „Waermepumpe" fallen auf denselben Stamm', stammVon('Wärmepumpe'), stammVon('Waermepumpe'));
  check('„Größe" und „Groesse" fallen auf denselben Stamm', stammVon('Größe'), stammVon('Groesse'));
  check('ß wird zu ss', stammVon('Straße').includes('ss'), true);
  check('Die Zerlegung ist unempfindlich gegen Großschreibung', stammVon('WÄRMEPUMPE'), stammVon('wärmepumpe'));
  check('Umlaute überleben die Zerlegung nicht', /[äöüß]/.test(stammVon('Fußbodenheizung')), false);

  // === 2 — Stoppwörter und die zwei Ausnahmen =============================
  // Eine reine Stoppwortkette muss leer zurückkommen: sonst rankt die Suche
  // nach Artikeln, und jede Frage träfe jeden Eintrag.
  check('Eine Kette aus Füllwörtern bleibt leer', tokenisiere('der die das und oder ist mit von').length, 0);
  // „für" steht in der Stoppwortliste — mit Umlaut. Die Zerlegung bildet aber
  // erst auf ASCII ab und schlägt danach nach; nachgeschlagen wird also „fur".
  // Die Prüfung hängt an der Absicht der Liste, nicht an ihrer Schreibweise:
  // ein Wort, das dort steht, muss auch herausfallen.
  check('„für" ist ein Füllwort', tokenisiere('für').length, 0);
  check('… ebenso wie sein umlautfreier Zwilling', tokenisiere('fuer').length, 0);
  // „nicht" und „ohne" sind im Gewerk bedeutungstragend: „Anlagen ohne
  // Puffer" und „Anlagen mit Puffer" sind gegensätzliche Sachverhalte, und
  // ohne das Wort „ohne" sind die beiden Fragen dieselbe Frage.
  check('„nicht" bleibt erhalten', tokenisiere('nicht').join(','), 'nicht');
  check('„ohne" bleibt erhalten', tokenisiere('ohne').join(','), 'ohne');
  check('„Anlagen ohne Puffer" behält alle drei Begriffe', tokenisiere('Anlagen ohne Puffer').length, 3);
  check('… und das „ohne" steht an zweiter Stelle', tokenisiere('Anlagen ohne Puffer')[1], 'ohne');
  check('… „mit" dagegen fällt weg', tokenisiere('Anlagen mit Puffer').length, 2);

  // === 3 — Endungen nur ab der jeweiligen Mindestlänge ====================
  // Die Regeln sind gestaffelt: fünf Buchstaben lange Endungen erst ab sieben
  // Zeichen, drei- und zweibuchstabige ab sechs, der einzelne Auslaut ab
  // fünf. Jede Staffel wird beidseitig geprüft — eine Grenze, die um eins
  // verrutscht, verstümmelt Fachwörter oder lässt Flexionen stehen.
  check('„Steuerungen" verliert die Endung -ungen', stammVon('Steuerungen'), 'steuer');
  check('„Leitungen" ebenso', stammVon('Leitungen'), 'leit');
  // „Zungen" hat sechs Zeichen und fällt damit unter die Sieben-Zeichen-
  // Schwelle der -ungen-Regel; es bleibt die kürzere -en-Regel übrig.
  check('„Zungen" ist zu kurz für die -ungen-Regel', stammVon('Zungen'), 'zung');
  check('„Heizungen" verliert -ung nach der -en-Regel', stammVon('Heizungen'), 'heiz');
  check('„Rohres" und „Rohre" fallen zusammen', stammVon('Rohres'), stammVon('Rohre'));
  check('… und zwar auf „rohr"', stammVon('Rohre'), 'rohr');
  check('„Rohr" selbst bleibt unangetastet', stammVon('Rohr'), 'rohr');
  // Das ist die Grenze, um die es geht: „Bogen" hat fünf Zeichen. Die
  // -en-Regel greift erst ab sechs, sonst bliebe von dem Fachwort „Bog"
  // übrig — und „Bogen" fände seine eigenen Einträge nicht mehr.
  check('Aus „Bogen" wird nicht „Bog"', stammVon('Bogen') === 'bog', false);
  check('… sondern der Auslaut fällt einzeln', stammVon('Bogen'), 'boge');
  check('„Bögen" fällt mit „Bogen" zusammen', stammVon('Bögen'), stammVon('Bogen'));
  check('Ein Vierbuchstabenwort bleibt ganz', stammVon('Ende'), 'ende');
  check('Ein Fachwort ohne passende Endung bleibt ganz', stammVon('Ventil'), 'ventil');
  check('… auch als Mehrzahl trifft es denselben Stamm', stammVon('Ventile'), 'ventil');

  // === 4 — Randfälle der Zerlegung ========================================
  check('Leere Eingabe liefert nichts', tokenisiere('').length, 0);
  check('Nur Leerzeichen liefern nichts', tokenisiere('     ').length, 0);
  check('Reine Satzzeichen liefern nichts', tokenisiere('!!! ??? ... ,,, ---').length, 0);
  check('Ein Einzelbuchstabe ist zu kurz', tokenisiere('x').length, 0);
  check('Das Paragrafenzeichen allein zählt nicht als Wort', tokenisiere('§').length, 0);
  check('Zwei Zeichen genügen', tokenisiere('ab').join(','), 'ab');
  // Zahl und Einheit bleiben getrennte Begriffe — beide zweizeichig, beide
  // erhalten. „15" allein findet nichts, „15 kpa" als Paar sehr wohl.
  check('„15 kPa" zerfällt in zwei Begriffe', tokenisiere('15 kPa').join(','), '15,kpa');
  check('„§ 60c Abs. 1" behält die Fundstellennummer', tokenisiere('§ 60c Abs. 1').includes('60c'), true);
  check('… und wirft die einstellige Absatznummer weg', tokenisiere('§ 60c Abs. 1').includes('1'), false);
  // Ein sehr langes Kompositum darf nicht zerbröseln: genau eine Endung geht
  // ab, der Rest bleibt als ein Begriff stehen.
  check('Ein langes Kompositum bleibt ein einziger Begriff', tokenisiere('Trinkwassererwaermungsanlagen').length, 1);
  // Das „ae" fällt dabei auf „a" zusammen — genau dafür ist die
  // Normalisierung da: „Trinkwassererwärmungsanlagen" und die
  // umlautfreie Schreibweise ergeben denselben Begriff.
  check('… und verliert nur die Mehrzahlendung', stammVon('Trinkwassererwaermungsanlagen'), 'trinkwassererwarmungsanlag');
  check('… und trifft die Schreibweise mit Umlaut', stammVon('Trinkwassererwärmungsanlagen'), stammVon('Trinkwassererwaermungsanlagen'));
  check('Ein 60-Zeichen-Wort übersteht die Zerlegung', tokenisiere('a'.repeat(60)).length, 1);
  check('… ohne gekürzt zu werden', stammVon('a'.repeat(60)).length, 60);

  // === 5 — BM25: Vorkommen, Titelgewicht, Seltenheit ======================

  // Ein Dokument ohne den Suchbegriff bekommt die Punktzahl 0 und wird gar
  // nicht erst aufgenommen — die Trefferliste ist keine Rangliste aller
  // Einträge, sondern eine Liste der Einträge, die überhaupt getroffen haben.
  const kav = probe.suche('Kavitation');
  check('Ein Suchwort trifft nur die Einträge, die es führen', kav.length, 1);
  check('… und zwar den richtigen', kav[0].eintrag.id, 'pb-n-kavitation');
  check('… während elf Einträge ohne das Wort gar nicht erscheinen', kav.length < GRUNDKORPUS.length, true);

  // Titelgewicht. Beide Einträge sind gleich lang, der Term steht einmal im
  // Titel (dort doppelt gezählt) beziehungsweise einmal im Text. Sollwerte
  // aus dem Dateikopf: 0,6462550 gegen 0,4700036, Verhältnis genau 1,375.
  const titelbasis = new Wissensbasis(TITELKORPUS);
  const tk = titelbasis.suche('Kavitation');
  check('Titel- und Texttreffer stehen beide in der Liste', tk.length, 2);
  check('Der Titeltreffer steht vorn', tk[0].eintrag.id, 'tk-im-titel');
  check('… der Texttreffer dahinter', tk[1].eintrag.id, 'tk-im-text');
  check('Die Punktzahl des Titeltreffers ist 0,6462550', tk[0].bm25, 0.6462550, 5e-6);
  check('Die des Texttreffers ist 0,4700036', tk[1].bm25, 0.4700036, 5e-6);
  check('Das Verhältnis ist genau 1,375 — die Verdopplung des Titels', tk[0].bm25 / tk[1].bm25, 1.375, 1e-9);
  check('Der Eintrag ohne den Begriff fehlt ganz', tk.some((t) => t.eintrag.id === 'tk-gar-nicht'), false);

  // Seltenheit (IDF). Acht gleich lange Einträge, ein Wort in allen, eines in
  // genau einem. Sollwerte: 0,0571584 gegen 1,7917595 (= ln 6).
  const idfbasis = new Wissensbasis(IDF_KORPUS);
  const haeufig = idfbasis.suche('haeufigwort');
  const selten = idfbasis.suche('seltenwort');
  check('Das häufige Wort trifft alle acht Einträge', haeufig.length, 8);
  check('Das seltene genau einen', selten.length, 1);
  check('… nämlich idf-0', selten[0].eintrag.id, 'idf-0');
  check('Der häufige Term wiegt 0,0571584', haeufig[0].bm25, 0.0571584, 5e-7);
  check('Der seltene Term wiegt ln 6 = 1,7917595', selten[0].bm25, 1.7917595, 5e-7);
  check('Der seltene wiegt mehr als das Dreißigfache', selten[0].bm25 / haeufig[0].bm25 > 30, true);
  // Derselbe Eintrag, zwei Fragen: die Punktzahl hängt am Term, nicht am
  // Dokument. Ohne diese Gegenprobe könnte der Unterschied auch von der
  // Dokumentlänge kommen.
  check('Beide Punktzahlen stammen aus demselben Dokument', haeufig[0].eintrag.id === 'idf-0' || selten[0].eintrag.id === 'idf-0', true);

  // === 6 — Rangfusion: der kleine Korpus wird nicht verschluckt ===========
  // Zwei Wissensbasen aus denselben 42 Texten. Einmal getrennt (2 Einträge im
  // Korpus `projekt`, 40 in `tabellen`), einmal alles in einem Korpus.
  const getrennt = new Wissensbasis(fusionsdaten(true));
  const zusammen = new Wissensbasis(fusionsdaten(false));

  check('Der kleine Korpus hat zwei Einträge', getrennt.umfang('projekt'), 2);
  check('Der große hat vierzig', getrennt.umfang('tabellen'), 40);
  check('Zusammen sind es 42', getrennt.umfang(), 42);
  check('Die zusammengelegte Fassung kennt nur einen Korpus', zusammen.korpora().length, 1);

  const drei = getrennt.suche('Ueberstroemventil', { anzahl: 3 });
  check('Getrennt indiziert liefert die Suche drei Treffer', drei.length, 3);
  check('… und mindestens einer davon stammt aus dem kleinen Korpus', drei.some((t) => t.eintrag.korpus === 'projekt'), true);
  check('… nämlich sein einziger Treffer', drei.some((t) => t.eintrag.id === 'klein-treffer'), true);
  check('… der in seinem Korpus auf Rang 1 steht', drei.filter((t) => t.eintrag.id === 'klein-treffer')[0].rangImKorpus, 1);
  check('… und dafür 1/61 = 0,0163934 beisteuert', drei.filter((t) => t.eintrag.id === 'klein-treffer')[0].score, 0.0163934, 5e-7);
  // Die Gegenprobe. Dieselben Texte in einem Index: dort liegen die zehn
  // starken Einträge des großen Korpus vor dem kleinen, und der verschwindet
  // aus den ersten drei Rängen. Genau dieser Verlust ist es, den die Trennung
  // verhindert — ohne die Gegenprobe wäre die Prüfung oben nur eine Aussage
  // über diesen einen Datensatz.
  const dreiZusammen = zusammen.suche('Ueberstroemventil', { anzahl: 3 });
  check('In einem gemeinsamen Index fällt der kleine Eintrag heraus', dreiZusammen.some((t) => t.eintrag.id === 'klein-treffer'), false);
  check('… dort stehen nur die starken Einträge des großen Korpus vorn', dreiZusammen.every((t) => t.eintrag.id.startsWith('gross-')), true);
  const alleZusammen = zusammen.suche('Ueberstroemventil', { anzahl: 50 });
  check('… der kleine Eintrag ist dort erst weiter hinten zu finden', alleZusammen.findIndex((t) => t.eintrag.id === 'klein-treffer') >= 3, true);

  // === 7 — Suchoptionen, Zugriff und Determinismus ========================

  // Eine leere Frage darf nicht „alles" bedeuten. Der Unterschied ist der
  // zwischen einer leeren Trefferliste und einer Liste, in der jeder Eintrag
  // gleich gut passt — die zweite sieht aus wie ein Ergebnis.
  check('Eine leere Frage liefert nichts', probe.suche('').length, 0);
  check('Eine Frage aus lauter Füllwörtern ebenso', probe.suche('der die das und').length, 0);
  check('… und nicht etwa alle zwölf Einträge', probe.suche('   ').length === GRUNDKORPUS.length, false);

  check('`anzahl` wird eingehalten', probe.suche('ventil', { anzahl: 2 }).length, 2);
  check('… auch bei eins', probe.suche('ventil', { anzahl: 1 }).length, 1);
  check('… und ohne Angabe liegt die Obergrenze bei acht', echt.suche('Pumpe').length, 8);

  const nurTabellen = probe.suche('rauigkeit', { korpora: ['tabellen'] });
  check('`korpora` filtert auf die genannte Sammlung', nurTabellen.length > 0, true);
  check('… und lässt nichts anderes durch', nurTabellen.every((t) => t.eintrag.korpus === 'tabellen'), true);
  const zweiKorpora = probe.suche('ventil', { korpora: ['normen', 'hydraulik'] });
  check('Zwei genannte Korpora liefern aus beiden', new Set(zweiKorpora.map((t) => t.eintrag.korpus)).size, 2);
  check('… und aus keinem dritten', zweiKorpora.every((t) => t.eintrag.korpus !== 'tabellen'), true);
  check('Ein Korpus ohne Treffer liefert leer, nicht alles', probe.suche('rauigkeit', { korpora: ['hydraulik'] }).length, 0);

  const nurPrimaer = echt.suche('Puffer Volumen', { mindestens: 'primaer', anzahl: 8 });
  check('`mindestens: primaer` liefert überhaupt Treffer', nurPrimaer.length > 0, true);
  check('… und ausschließlich Primärquellen', nurPrimaer.every((t) => t.eintrag.belastbarkeit === 'primaer'), true);
  const abSekundaer = echt.suche('Puffer Volumen', { mindestens: 'sekundaer', anzahl: 8 });
  check('`mindestens: sekundaer` lässt keine Annahmen durch', abSekundaer.every((t) => t.eintrag.belastbarkeit !== 'annahme'), true);
  check('… und ist nicht enger als die Primärstufe', abSekundaer.length >= nurPrimaer.length, true);

  // Determinismus. Ein gedruckter Nachweis, der beim zweiten Druck eine
  // andere Reihenfolge zeigt, ist kein Nachweis. Verglichen wird die
  // Schlüsselkette, nicht die Länge — eine vertauschte Reihenfolge bei
  // gleicher Trefferzahl wäre sonst unsichtbar.
  const frage = 'Puffer und Volumenstrom bei der Waermepumpe';
  check('Zweimal dieselbe Frage, dieselbe Reihenfolge', kette(echt, frage, 8), kette(echt, frage, 8));
  check('… auch im Prüfkorpus', kette(probe, 'ventil rohr', 12), kette(probe, 'ventil rohr', 12));
  // Eine zweite Wissensbasis über denselben Daten muss dasselbe liefern:
  // sonst hinge die Reihenfolge an der Einfügereihenfolge einer Map.
  check('… und in einer frisch gebauten Basis über denselben Daten', kette(new Wissensbasis(WISSEN_KORPUS), frage, 8), kette(echt, frage, 8));

  check('`umfang` zählt den ganzen Prüfkorpus', probe.umfang(), 12);
  check('… und je Sammlung getrennt', probe.umfang('normen'), 4);
  check('… auch für die Hydraulik', probe.umfang('hydraulik'), 4);
  check('`korpora` nennt alle vier Sammlungen des echten Korpus', echt.korpora().length, 4);
  check('… und keine, die es nicht gibt', echt.korpora().every((k) => ERLAUBTE_KORPORA.includes(k)), true);
  check('`eintrag` findet über den Schlüssel', probe.eintrag('pb-h-puffer')?.titel ?? '', 'Puffer');
  check('… korpusübergreifend', probe.eintrag('pb-t-kupfer')?.korpus ?? '', 'tabellen');
  check('… und liefert für einen unbekannten Schlüssel nichts', probe.eintrag('gibt-es-nicht') === undefined, true);

  // === 8 — Synonyme am echten Korpus =====================================
  // Diese drei Kürzel sind der Grund, warum die Synonymliste überhaupt
  // existiert: der Anwender tippt das Kürzel, im Korpus steht das Wort.
  // Geprüft wird deshalb am echten Korpus — die Liste hilft nur, wenn sie zu
  // den tatsächlich vorhandenen Texten passt.
  const thv = echt.suche('THV', { anzahl: 5 });
  check('„THV" liefert Treffer', thv.length > 0, true);
  check('… und findet Einträge über Thermostatventile', thv.some((t) => /thermostatventil/i.test(t.eintrag.text)), true);
  check('… mit dem Ventilbezug ganz oben', thv.some((t) => (t.eintrag.themen ?? []).includes('ventilautoritaet')), true);
  const fbh = echt.suche('FBH', { anzahl: 5 });
  check('„FBH" liefert Treffer', fbh.length > 0, true);
  check('… und findet Einträge zur Fußbodenheizung', fbh.some((t) => (t.eintrag.themen ?? []).includes('fussbodenheizung')), true);
  check('… quer über mehrere Sammlungen', new Set(fbh.map((t) => t.eintrag.korpus)).size > 1, true);
  const geg = echt.suche('GEG', { anzahl: 5 });
  check('„GEG" liefert Treffer', geg.length > 0, true);
  check('… und findet Einträge zum GModG', geg.some((t) => t.eintrag.text.includes('GModG')), true);
  check('… allen voran die Umbenennung selbst', geg[0].eintrag.id, 'norm-gmodg-umbenennung');
  // Die Gegenrichtung: wer das neue Kürzel tippt, muss dieselben Einträge
  // finden. Die Liste führt beide Richtungen, weil sie nicht symmetrisch
  // ausgewertet wird.
  check('„GModG" findet ebenfalls die Umbenennung', echt.suche('GModG', { anzahl: 5 }).some((t) => t.eintrag.id === 'norm-gmodg-umbenennung'), true);
  check('„Abgleich" findet die Abgleichpflicht', echt.suche('Abgleich Pflicht', { anzahl: 8 }).some((t) => (t.eintrag.themen ?? []).includes('abgleich-recht')), true);

  // === 9 — Unversehrtheit: Schlüssel und Pflichtfelder ====================
  // Ab hier geht es nur noch um die Daten. Ein Korpus verrottet leise: der
  // falsche Eintrag sieht aus wie der richtige.
  const schluessel = new Set<string>();
  let doppelt = 0;
  let nichtKebab = '';
  let leereFelder = '';
  let schlagwortfehler = '';
  for (const e of WISSEN_KORPUS) {
    if (schluessel.has(e.id)) doppelt++;
    schluessel.add(e.id);
    // kebab-case: Kleinbuchstaben und Ziffern, durch einzelne Bindestriche
    // getrennt, ohne führenden oder nachgestellten Strich. Der Schlüssel
    // steht in Verweisen und in gedruckten Fußnoten; Groß-/Kleinschreibung
    // oder ein Unterstrich darin ist eine Fehlerquelle beim Nachschlagen.
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(e.id)) nichtKebab += `${e.id} `;
    if (!e.titel.trim() || !e.text.trim() || !e.quelle.trim()) leereFelder += `${e.id} `;
    // Drei bis acht Schlagworte: unter drei trägt das Feld nichts zur Suche
    // bei (und wiegt doch doppelt), über acht verschiebt es die Gewichtung
    // des Eintrags gegenüber allen anderen.
    if (e.schlagworte.length < 3 || e.schlagworte.length > 8) schlagwortfehler += `${e.id}(${e.schlagworte.length}) `;
  }
  check('Der Korpus ist nicht leer', WISSEN_KORPUS.length > 100, true);
  check('Alle Schlüssel sind eindeutig', doppelt, 0);
  check('… und die Menge der Schlüssel so groß wie der Korpus', schluessel.size, WISSEN_KORPUS.length);
  check('Alle Schlüssel sind kebab-case', nichtKebab.trim(), '');
  check('Titel, Text und Quelle sind überall gefüllt', leereFelder.trim(), '');
  check('Jeder Eintrag führt drei bis acht Schlagworte', schlagwortfehler.trim(), '');

  // === 10 — Unversehrtheit: Schreibweise der Texte ========================
  // Der `text` wird unverändert angezeigt und unverändert in Berichte
  // übernommen. Ein Zeilenumbruch zerreißt dort den Satz, ein Sternchenpaar
  // oder ein Rautenpaar aus einem kopierten Rechercheabschnitt steht als
  // Zeichenfolge im Fließtext, und ein senkrechter Strich zerlegt in einer
  // Tabellenausgabe die Spalte.
  let umbrueche = '';
  let markdown = '';
  let kurztexte = '';
  for (const e of WISSEN_KORPUS) {
    if (/[\r\n]/.test(e.text)) umbrueche += `${e.id} `;
    if (e.text.includes('**') || e.text.includes('##') || e.text.includes('|')) markdown += `${e.id} `;
    if (e.text.length < 40) kurztexte += `${e.id} `;
  }
  check('Kein Text enthält einen Zeilenumbruch', umbrueche.trim(), '');
  check('Kein Text enthält Markdown-Auszeichnung', markdown.trim(), '');
  check('Kein Text ist ein Fragment', kurztexte.trim(), '');
  check('Auch die Titel bleiben einzeilig', WISSEN_KORPUS.some((e) => /[\r\n]/.test(e.titel)), false);

  // === 11 — Unversehrtheit: Einordnung ====================================
  let fremderKorpus = '';
  let fremdeStufe = '';
  let fremdesThema = '';
  let ohneThema = '';
  let schlechteUrl = '';
  const themenzaehler = new Map<string, number>();
  for (const e of WISSEN_KORPUS) {
    if (!ERLAUBTE_KORPORA.includes(e.korpus)) fremderKorpus += `${e.id} `;
    if (!ERLAUBTE_BELASTBARKEIT.includes(e.belastbarkeit)) fremdeStufe += `${e.id} `;
    const themen = e.themen ?? [];
    if (!themen.length) ohneThema += `${e.id} `;
    for (const t of themen) {
      if (!ERLAUBTE_THEMEN.includes(t)) fremdesThema += `${e.id}:${t} `;
      themenzaehler.set(t, (themenzaehler.get(t) ?? 0) + 1);
    }
    // Eine `url` ist ein Angebot zum Nachschlagen. Was nicht mit http
    // beginnt, ist im Browser kein Verweis, sondern ein toter Text.
    if (e.url !== undefined && !e.url.startsWith('http')) schlechteUrl += `${e.id} `;
  }
  check('Jeder Eintrag liegt in einer der vier Sammlungen', fremderKorpus.trim(), '');
  check('Jeder Eintrag trägt eine der drei Belastbarkeitsstufen', fremdeStufe.trim(), '');
  check('Jedes Thema stammt aus der erlaubten Liste', fremdesThema.trim(), '');
  check('Jeder Eintrag ist mindestens einem Thema zugeordnet', ohneThema.trim(), '');
  check('Jede angegebene url ist ein Verweis', schlechteUrl.trim(), '');
  check('Es gibt Einträge mit url', WISSEN_KORPUS.some((e) => e.url !== undefined), true);
  // Ein Thema mit einem einzigen Eintrag ist kein Thema, sondern ein
  // Tippfehler oder ein halb angefangener Ausbau: die Belegliste dazu
  // besteht aus einer einzigen Quelle und trägt keine Aussage.
  let duenneThemen = '';
  for (const [t, n] of themenzaehler) if (n < 2) duenneThemen += `${t}(${n}) `;
  check('Jedes belegte Thema hat mindestens zwei Einträge', duenneThemen.trim(), '');
  check('Die Themenliste des Blocks deckt alle belegten Themen', themenzaehler.size <= ERLAUBTE_THEMEN.length, true);
  check('`themen()` meldet genau die belegten Themen', echt.themen().length, themenzaehler.size);
  check('… in alphabetischer Reihenfolge', echt.themen().join(',') === [...echt.themen()].sort().join(','), true);

  // === 12 — Annahmen müssen sich im Text zu erkennen geben ================
  // Der gefährlichste Eintrag im ganzen Korpus. `belastbarkeit: 'annahme'`
  // steuert die Anzeige — der Text aber wird zitiert, kopiert und in fremde
  // Dokumente übernommen, meist ohne das Feld daneben. Sagt der Text nicht
  // selbst, dass er eine Festlegung dieses Programms ist, wandert er als
  // Tatsachenbehauptung weiter. Die Kennzeichnung im Feld nützt dann
  // niemandem mehr.
  const annahmen = WISSEN_KORPUS.filter((e) => e.belastbarkeit === 'annahme');
  check('Es gibt Einträge der Stufe „Annahme"', annahmen.length > 0, true);
  let stummeAnnahmen = '';
  for (const e of annahmen) {
    if (!ANNAHME_WORTE.some((w) => e.text.includes(w))) stummeAnnahmen += `${e.id} `;
  }
  check('Jede Annahme sagt im Text, dass sie eine ist', stummeAnnahmen.trim(), '');
  check('Die Quellenzeile kennzeichnet eine Annahme', quellenzeile(annahmen[0]).includes('Annahme'), true);
  // Bei einer Primärquelle wird die Quelle unverändert durchgereicht — nicht
  // etwa „ohne Klammer": Quellenangaben tragen selbst Klammern („GModG
  // (vormals GEG)"), ein Klammertest würde also am falschen Merkmal hängen.
  const ersteHauptquelle = WISSEN_KORPUS.filter((e) => e.belastbarkeit === 'primaer')[0];
  check('… und reicht die Primärquelle unverändert durch', quellenzeile(ersteHauptquelle), ersteHauptquelle.quelle);
  check('… die Sekundärquelle dagegen nicht', quellenzeile(WISSEN_KORPUS.filter((e) => e.belastbarkeit === 'sekundaer')[0]).includes('Sekundärquelle'), true);
  // Eine Annahme, die zwischen Gesetzestexten oder Tabellenwerten steht, wird
  // beim Überfliegen für einen Norminhalt gehalten. Der Regelfall ist deshalb
  // der Projektkorpus — zwingend ist er nicht, denn ein Tabellenwert, der in
  // Wahrheit gesetzt ist, gehört sachlich zu den Tabellen. Was zwingend ist:
  // jede Annahme muss über das Thema „programmannahme" auffindbar sein, sonst
  // fehlt sie in der Liste der Festlegungen, die der Bericht ausweist.
  check('Alle Annahmen tragen das Thema „programmannahme"', annahmen.every((e) => (e.themen ?? []).includes('programmannahme')), true);
  check('… und die Themenliste führt sie vollzählig', echt.belege('programmannahme').length >= annahmen.length, true);
  check('Der Regelfall ist der Projektkorpus', annahmen.filter((e) => e.korpus === 'projekt').length >= annahmen.length - 1, true);
  check('… und im Projektkorpus steht nichts als Primärquelle', WISSEN_KORPUS.some((e) => e.korpus === 'projekt' && e.belastbarkeit === 'primaer'), false);

  // === 13 — Umfang und Stand ==============================================
  // `korpusUmfang()` wird angezeigt („89 Sätze aus Normen und Recht"). Die
  // Zahl wird hier unabhängig nachgezählt, damit ein Zählfehler nicht
  // dieselbe Quelle hat wie die geprüfte Funktion.
  const umfang = korpusUmfang();
  let eigeneSumme = 0;
  let umfangsfehler = '';
  for (const k of ERLAUBTE_KORPORA) {
    const eigen = WISSEN_KORPUS.filter((e) => e.korpus === k).length;
    eigeneSumme += eigen;
    if ((umfang[k] ?? 0) !== eigen) umfangsfehler += `${k}(${umfang[k] ?? 0}≠${eigen}) `;
  }
  check('`korpusUmfang()` stimmt je Sammlung', umfangsfehler.trim(), '');
  check('… und in der Summe mit dem Korpus', eigeneSumme, WISSEN_KORPUS.length);
  check('… und meldet keine Sammlung zuviel', Object.keys(umfang).length, ERLAUBTE_KORPORA.length);
  check('Jede der vier Sammlungen ist besetzt', ERLAUBTE_KORPORA.every((k) => (umfang[k] ?? 0) > 0), true);
  check('Die Wissensbasis indiziert alle Einträge', echt.umfang(), WISSEN_KORPUS.length);
  check('… und verliert beim Aufteilen keinen', ERLAUBTE_KORPORA.reduce((a, k) => a + echt.umfang(k), 0), WISSEN_KORPUS.length);
  // JJJJ-MM: der Stand wird im Bericht als Rechercheversion gedruckt. Ein
  // Datum in anderer Schreibweise sortiert falsch und liest sich falsch.
  check('`KORPUS_STAND` hat die Form JJJJ-MM', /^\d{4}-(0[1-9]|1[0-2])$/.test(KORPUS_STAND), true);
  check('… und liegt nicht vor 2020', Number(KORPUS_STAND.slice(0, 4)) >= 2020, true);
  check('… und nicht in ferner Zukunft', Number(KORPUS_STAND.slice(0, 4)) <= 2100, true);

  // === 14 — Themenzugriff =================================================
  // `belege` ist kein Ranking, sondern ein exakter Zugriff. Der Rechenkern
  // weiß, welches Thema er belegt, und will genau die Einträge dazu —
  // vollständig und in stabiler Reihenfolge, damit ein zweiter Ausdruck
  // desselben Berichts Zeile für Zeile gleich aussieht.
  //
  // Die Sollreihenfolge für 'probe-quer' ist von Hand hergeleitet: erst nach
  // Belastbarkeit absteigend (primär 3, sekundär 2, Annahme 1), bei gleicher
  // Stufe nach Schlüssel aufsteigend. Träger des Themas sind
  //   pb-n-autoritaet (primär, normen), pb-t-stahl (primär, tabellen),
  //   pb-n-abnahme (Annahme, normen), pb-h-mischer (Annahme, hydraulik).
  // Erwartet also: pb-n-autoritaet, pb-t-stahl, pb-h-mischer, pb-n-abnahme —
  // die Reihenfolge springt zwischen den Sammlungen hin und her, und genau
  // das muss sie: sortiert wird nach Belastbarkeit und Schlüssel, nicht nach
  // der Sammlung, in der ein Eintrag zufällig liegt.
  const quer = probe.belege('probe-quer');
  check('`belege` findet alle Träger des Themas', quer.length, 4);
  check('… in der hergeleiteten Reihenfolge', quer.map((e) => e.id).join(','), 'pb-n-autoritaet,pb-t-stahl,pb-h-mischer,pb-n-abnahme');
  check('… Primärquellen zuerst', quer[0].belastbarkeit, 'primaer');
  check('… Annahmen zuletzt', quer[quer.length - 1].belastbarkeit, 'annahme');
  check('… und ausschließlich Träger des Themas', quer.every((e) => (e.themen ?? []).includes('probe-quer')), true);
  check('… korpusübergreifend', new Set(quer.map((e) => e.korpus)).size, 3);
  check('Zweimal aufgerufen dieselbe Reihenfolge', probe.belege('probe-quer').map((e) => e.id).join(','), quer.map((e) => e.id).join(','));
  check('Ein anderes Thema liefert eine andere Menge', probe.belege('probe-schema').length, 4);
  check('… und keinen Eintrag ohne dieses Thema', probe.belege('probe-schema').every((e) => (e.themen ?? []).includes('probe-schema')), true);
  // Ein unbekanntes Thema ist keine Ausnahme, sondern ein leeres Ergebnis:
  // der Rechenkern fragt auch nach Themen, zu denen noch nichts recherchiert
  // ist, und darf daran nicht abbrechen.
  check('Ein unbekanntes Thema liefert ein leeres Feld', probe.belege('gibt-es-nicht').length, 0);
  check('… auch die leere Zeichenkette', probe.belege('').length, 0);
  check('Am echten Korpus liefert jedes gemeldete Thema Belege', echt.themen().every((t) => echt.belege(t).length >= 2), true);
  check('… und keiner davon ist doppelt', echt.belege('waermepumpe').length, new Set(echt.belege('waermepumpe').map((e) => e.id)).size);
}
