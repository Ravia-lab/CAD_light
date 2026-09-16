/**
 * Prüfblock „Raumnamen" — vom Schild an der Tür zur Solltemperatur.
 * ---------------------------------------------------------------------------
 * Zwei kleine Übersetzungen hängen zwischen einer fremden Datei und der
 * Heizlast, und beide sind still: wenn sie danebengehen, fällt nichts aus,
 * es steht nur eine andere Zahl im Ergebnis.
 *
 *  1. **Die Umschreibung.** ISO 10303-21 lässt in einer Zeichenkette nur
 *     ASCII zu. „Küche" steht als `K\X2\00FC\X0\che` in der Datei. Ohne
 *     Auflösung heißt der Raum hinterher wörtlich so — im Raumbuch, im
 *     Ausdruck, in der RaVia-Übergabe.
 *  2. **Der Schluss vom Namen auf die Nutzung.** „Bad" wird nach
 *     DIN EN 12831 mit 24 °C gerechnet, „Flur" mit 15 °C. Über eine Wohnung
 *     summiert trennen die beiden Annahmen zweistellige Prozente der
 *     Heizlast — und damit die Baugröße des Geräts.
 *
 * **Die Tabelle unten ist der eigentliche Prüfblock.** Jede Zeile ist ein
 * Name, wie er wirklich auf einem Raumschild oder in einer IFC-Datei steht;
 * die Namen aus den beiden KIT-Dateien sind dabei mit ihrer Herkunft
 * vermerkt. Eine Regel, die sich ändert, muss hier sichtbar werden — und
 * nicht erst in einem Heizlastergebnis, das niemand nachrechnet.
 *
 * **Warum `undefined` ein erwünschtes Ergebnis ist.** „Galerie", „Raum 3",
 * „Zimmer" sagen nichts über die Nutzung. Sie bleiben unbestimmt, und
 * unbestimmt heißt in der Anwendung sichtbar „bitte einstufen". Ein falsch
 * geratener Raum wäre schlechter: den sieht niemand mehr.
 */

import type { CheckFn } from './typ';
import { importIfc } from '../../src/lib/ifcImport';
import { normalisiere, nutzungAusName } from '../../src/lib/raumnutzung';

/** Eine Zeichenkette durch den STEP-Parser schicken und zurücklesen. */
function durchDenParser(roh: string): string {
  const r = importIfc(
    [
      'ISO-10303-21;',
      'HEADER;',
      "FILE_SCHEMA(('IFC4'));",
      'ENDSEC;',
      'DATA;',
      `#1=IFCPROJECT('0P00000000000000000000',$,'${roh}',$,$,$,$,$,$);`,
      'ENDSEC;',
      'END-ISO-10303-21;',
    ].join('\n'),
  );
  return r.projectName ?? '';
}

export function pruefeRaumnamen(check: CheckFn): void {
  // --- Umschreibungen ------------------------------------------------------
  const umschrift: Array<[string, string, string]> = [
    // roh in der Datei          erwartet     woher
    ['K\\X2\\00FC\\X0\\che',     'Küche',     'ArchiCAD, FZK-Haus'],
    ['gr\\X2\\00F600FC\\X0\\n',  'gröün',     'mehrere Zeichen in einer Folge'],
    ['B\\X\\FCro',               'Büro',      'Einzelbyte, Latin-1'],
    ['Stra\\S\\_e',              'Straße',    'achtes Bit gesetzt: _ + 128 = ß'],
    ['C:\\\\Pfad',               'C:\\Pfad',  'doppelter Rückwärtsstrich'],
    ['Wohnen',                   'Wohnen',    'ohne Umschreibung unverändert'],
  ];
  for (const [roh, erwartet, woher] of umschrift) {
    check(`Umschrift ${JSON.stringify(roh)} (${woher})`, durchDenParser(roh), erwartet);
  }
  // Die Auflösung darf nichts anfassen, was keine Umschreibung ist.
  check('Ohne Rückwärtsstrich unverändert', durchDenParser('Projekt-FZK-Haus'), 'Projekt-FZK-Haus');

  // --- Vereinheitlichung ---------------------------------------------------
  check('Umlaute werden umschrieben', normalisiere('Küche'), 'kueche');
  check('ß wird zu ss', normalisiere('Großraum'), 'grossraum');
  check('Bindestrich trennt', normalisiere('Gäste-WC'), 'gaeste wc');
  check('„Büro" und „Buero" sind gleich', normalisiere('Büro'), normalisiere('Buero'));

  // --- Name → Nutzung ------------------------------------------------------
  const tabelle: Array<[string, string, string]> = [
    // Name                    erwartete Nutzung  Herkunft / was der Fall zeigt
    ['Bad', 'bath', 'FZK-Haus'],
    ['Schlafzimmer', 'bedroom', 'FZK-Haus'],
    ['Buero', 'office', 'FZK-Haus'],
    ['Wohnen', 'living', 'FZK-Haus'],
    ['Flur', 'hallway', 'FZK-Haus'],
    ['Küche', 'kitchen', 'FZK-Haus, nach der Umschrift'],
    ['Galerie', '—', 'FZK-Haus: sagt nichts über die Nutzung'],
    ['Seminarraum', 'office', 'Institut: Aufenthaltsraum mit 20 °C'],
    ['Besprechungsraum II', 'office', 'Institut'],
    ['Technikraum IV', 'technical', 'Institut'],
    ['Labor K5', 'office', 'Institut'],
    ['WC Damen', 'wc', 'Institut'],
    ['Flur EG West', 'hallway', 'Institut: erstes Wort entscheidet'],
    ['Flur Keller West', 'hallway', 'Institut: ohne die Wortregel wäre es „Abstellraum"'],
    ['Buero Studenten III', 'office', 'Institut'],
    ['Raum 3', '—', 'Vorgabename der Raumerkennung — bleibt unbestimmt'],
    ['Kellerflur', 'hallway', 'Zusammensetzung: der rechte Teil entscheidet'],
    ['Gästebad', 'bath', 'Zusammensetzung'],
    ['Fahrradkeller', 'storage', 'Zusammensetzung'],
    ['Dachgeschossbüro', 'office', 'Zusammensetzung'],
    ['Waschküche', 'technical', 'Festfügung: keine Küche'],
    ['Teeküche', 'kitchen', 'Festfügung: doch eine Küche'],
    ['Wohnküche', 'kitchen', 'Festfügung'],
    ['Heizungskeller', 'technical', 'Festfügung'],
    ['Hauswirtschaftsraum', 'technical', ''],
    ['Treppenhaus', 'hallway', ''],
    ['Kinderzimmer', 'bedroom', ''],
    ['Wintergarten', 'living', ''],
    ['Abstellraum', 'storage', ''],
    ['01 Wohnen', 'living', 'Nummer vorweg stört nicht'],
    ['02 Bad oben', 'bath', 'Nummer vorweg, Lage hinterher'],
    ['', '—', 'leerer Name'],
  ];
  for (const [name, erwartet, warum] of tabelle) {
    check(
      `„${name}" → ${erwartet}${warum ? ` (${warum})` : ''}`,
      nutzungAusName(name) ?? '—',
      erwartet,
    );
  }

  // --- Die Gegenprobe zur Temperatur ---------------------------------------
  // Der Sinn der ganzen Übung: Bad und Flur dürfen nicht dieselbe
  // Solltemperatur bekommen. 24 gegen 15 °C ist der Unterschied, um den es
  // geht; steht er nicht mehr da, ist die Zuordnung wirkungslos geworden.
  check('Bad und Flur werden verschieden eingestuft',
    nutzungAusName('Bad') === nutzungAusName('Flur'), false);
}
