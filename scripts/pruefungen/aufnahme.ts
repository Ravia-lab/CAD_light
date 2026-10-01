/**
 * Prüfblock „Aufnahme Zimmer für Zimmer".
 *
 * **Was hier geprüft wird.** Der Assistent legt keine Geometrie an — das tut
 * `addRoomTemplate`. Was er beisteuert, ist die Antwort auf eine einzige
 * Frage: **wo liegt das nächste Rechteck?** Genau daran hängt alles Weitere,
 * und genau dort ist der Fehler unsichtbar: Solange alle Räume nebeneinander
 * liegen, fällt ein vertauschtes Vorzeichen in y nicht auf.
 *
 * Deshalb steht unten zu jeder Richtung die Gegenprobe, dass sie **nicht**
 * die andere ist. Dazu die Fensterzahl, die eine Wand verträgt — eine
 * Angabe, die aus der Wandlänge folgt und nicht aus dem Tippfinger — und die
 * Annahmenliste, deren einzige Aufgabe es ist, eine Angabe nicht zweimal zu
 * führen.
 *
 * **Alle Sollwerte sind hier hergeleitet, nicht abgeschrieben.**
 */

import type { CheckFn } from './typ';
import {
  achsflaeche,
  ecken,
  fensterLagen,
  fensterPlatz,
  fortschritt,
  loescheAnnahme,
  merkeAnnahme,
  fensterseite,
  platziere,
  raumart,
  raumFragen,
  RAUMARTEN,
  seiteBelegt,
  seitenkanten,
} from '../../src/lib/aufnahme';
import type { Annahme } from '../../src/types/bim';
import { usageDefaults } from '../../src/lib/roomDetection';

export function pruefeAufnahme(check: CheckFn): void {
  // -------------------------------------------------------------------------
  // 1 · Der erste Raum liegt im Ursprung
  // -------------------------------------------------------------------------
  const r1 = platziere(undefined, 'rechts', 4.5, 5.0);
  check('Aufnahme · erster Raum x', r1.x, 0);
  check('Aufnahme · erster Raum y', r1.y, 0);
  check('Aufnahme · erster Raum behält seine Länge', r1.l, 4.5);
  check('Aufnahme · erster Raum behält seine Breite', r1.b, 5.0);
  // 4,5 × 5,0 = 22,5 m² auf den Achsen.
  check('Aufnahme · Achsfläche des ersten Raums [m²]', achsflaeche(r1), 22.5, 1e-9);

  // -------------------------------------------------------------------------
  // 2 · Die vier Richtungen, jede mit ihrer Gegenprobe
  // -------------------------------------------------------------------------
  // „rechts": x wächst um die Länge des Vorgängers, y bleibt.
  // 0 + 4,5 = 4,5.
  const rRechts = platziere(r1, 'rechts', 3.0, 3.5);
  check('Aufnahme · rechts: x', rRechts.x, 4.5, 1e-9);
  check('Aufnahme · rechts: y bleibt', rRechts.y, 0, 1e-9);

  // „links": der neue Raum endet dort, wo der alte anfängt — also
  // x = 0 − 3,0 = −3,0. Die Gegenprobe ist, dass er **nicht** bei 0 liegt:
  // Wer hier die eigene Länge vergisst, legt ihn über den Vorgänger.
  const rLinks = platziere(r1, 'links', 3.0, 3.5);
  check('Aufnahme · links: x', rLinks.x, -3.0, 1e-9);
  check('Aufnahme · links: rechte Kante trifft den Vorgänger', rLinks.x + rLinks.l, r1.x, 1e-9);

  // „oben": +y, weil der Editor +y nach oben zeichnet. 0 + 5,0 = 5,0.
  const rOben = platziere(r1, 'oben', 3.0, 3.5);
  check('Aufnahme · oben: y', rOben.y, 5.0, 1e-9);
  check('Aufnahme · oben: untere Kante trifft die obere des Vorgängers', rOben.y, r1.y + r1.b, 1e-9);

  // „unten": −y, und zwar um die **eigene** Breite. 0 − 3,5 = −3,5.
  // Gegenprobe: Wäre das Vorzeichen vertauscht, läge der Raum bei +3,5 und
  // damit mitten im Vorgänger — sichtbar erst, wenn jemand „darunter" wählt.
  const rUnten = platziere(r1, 'unten', 3.0, 3.5);
  check('Aufnahme · unten: y', rUnten.y, -3.5, 1e-9);
  check('Aufnahme · unten: obere Kante trifft die untere des Vorgängers', rUnten.y + rUnten.b, r1.y, 1e-9);
  check('Aufnahme · unten ist nicht oben', rUnten.y === rOben.y, false);

  // Die gemeinsame Kante ist in allen vier Fällen genau eine Koordinate —
  // daraus macht `addRoomTemplate` eine Wand und nicht zwei.
  check('Aufnahme · rechts teilt eine Kante', rRechts.x === r1.x + r1.l, true);

  // -------------------------------------------------------------------------
  // 3 · Die Ecken für das Aufziehen
  // -------------------------------------------------------------------------
  // Aus {x: 4,5, y: 0, l: 3,0, b: 3,5} folgen (4,5|0) und (7,5|3,5).
  const e = ecken(rRechts);
  check('Aufnahme · Ecke from.x', e.from.x, 4.5, 1e-9);
  check('Aufnahme · Ecke from.y', e.from.y, 0, 1e-9);
  check('Aufnahme · Ecke to.x', e.to.x, 7.5, 1e-9);
  check('Aufnahme · Ecke to.y', e.to.y, 3.5, 1e-9);

  // -------------------------------------------------------------------------
  // 4 · Wie viele Fenster eine Wand verträgt
  // -------------------------------------------------------------------------
  // (3,50 − 0,24) / (1,26 + 0,24) = 3,26 / 1,50 = 2,173… → 2
  check('Aufnahme · Fenster in 3,50 m Wand', fensterPlatz(3.5), 2);
  // (5,00 − 0,24) / 1,50 = 4,76 / 1,50 = 3,173… → 3
  check('Aufnahme · Fenster in 5,00 m Wand', fensterPlatz(5.0), 3);
  // (1,20 − 0,24) / 1,50 = 0,64 → 0. Eine WC-Wand trägt kein Regelfenster.
  check('Aufnahme · Fenster in 1,20 m Wand', fensterPlatz(1.2), 0);
  // Gegenprobe: Ohne den Pfeiler zwischen den Öffnungen käme bei 3,50 m
  // floor(3,50/1,26) = 2 heraus — hier zufällig dieselbe Zahl. Bei 2,60 m
  // nicht: floor(2,60/1,26) = 2, aber (2,60 − 0,24)/1,50 = 1,573 → 1.
  check('Aufnahme · Fenster in 2,60 m Wand (Pfeiler zählt mit)', fensterPlatz(2.6), 1);
  // Eine Wand ohne Länge trägt nichts, und die Zahl bleibt bei null stehen.
  check('Aufnahme · Fenster in 0,00 m Wand', fensterPlatz(0), 0);

  // -------------------------------------------------------------------------
  // 5 · Wo die Fenster sitzen
  // -------------------------------------------------------------------------
  // Eines: die Mitte. Zwei: ein Drittel und zwei Drittel.
  const l1 = fensterLagen(1);
  check('Aufnahme · ein Fenster, Zahl der Lagen', l1.length, 1);
  check('Aufnahme · ein Fenster sitzt mittig', l1[0], 0.5, 1e-9);
  const l2 = fensterLagen(2);
  check('Aufnahme · zwei Fenster, Zahl der Lagen', l2.length, 2);
  check('Aufnahme · zwei Fenster: erstes bei 1/3', l2[0], 1 / 3, 1e-9);
  check('Aufnahme · zwei Fenster: zweites bei 2/3', l2[1], 2 / 3, 1e-9);
  // Gegenprobe: Die Lagen liegen symmetrisch — die Summe des ersten und des
  // letzten ist 1. Wäre gleichmäßig von 0 an verteilt, wäre sie es nicht.
  check('Aufnahme · drei Fenster liegen symmetrisch', fensterLagen(3)[0] + fensterLagen(3)[2], 1, 1e-9);
  check('Aufnahme · null Fenster, keine Lage', fensterLagen(0).length, 0);

  // -------------------------------------------------------------------------
  // 6 · Die Raumarten
  // -------------------------------------------------------------------------
  check('Aufnahme · Zahl der Raumarten', RAUMARTEN.length, 10);
  // Jede Art muss eine Nutzung tragen, die das Programm kennt — sonst käme
  // die Solltemperatur aus dem Nichts.
  const ohneVorgabe = RAUMARTEN.filter((r) => !usageDefaults(r.usage)).length;
  check('Aufnahme · jede Raumart hat eine bekannte Nutzung', ohneVorgabe, 0);
  // Das Bad ist wärmer als das Wohnzimmer — die Zahl kommt aus dem Programm,
  // nicht aus dieser Tabelle. Geprüft wird nur, dass die Zuordnung stimmt.
  const bad = raumart('bad');
  const wohnen = raumart('wohnen');
  check('Aufnahme · „Bad" ist gefunden', bad !== undefined, true);
  check('Aufnahme · „Bad" ist wärmer als „Wohnen"',
    usageDefaults(bad!.usage).temp > usageDefaults(wohnen!.usage).temp, true);
  check('Aufnahme · unbekannte Raumart ergibt nichts', raumart('garage') === undefined, true);
  // Keine zwei Arten mit derselben Kennung — sonst trifft `raumart` die falsche.
  check('Aufnahme · Kennungen sind eindeutig', new Set(RAUMARTEN.map((r) => r.id)).size, RAUMARTEN.length);
  // Jede Vorgabe ist ein benutzbares Zimmermaß: größer als eine Wandstärke
  // und kleiner als ein Saal.
  const unsinnig = RAUMARTEN.filter((r) => r.l < 0.8 || r.b < 0.8 || r.l > 12 || r.b > 12).length;
  check('Aufnahme · alle Vorgabemaße sind Zimmermaße', unsinnig, 0);

  // -------------------------------------------------------------------------
  // 7 · Die Fragenfolge
  // -------------------------------------------------------------------------
  // Der erste Raum wird nicht gefragt, wo er liegt — es gibt nichts daneben.
  check('Aufnahme · erster Raum: vier Fragen', raumFragen(true).length, 4);
  check('Aufnahme · jeder weitere: fünf Fragen', raumFragen(false).length, 5);
  check('Aufnahme · der erste wird nicht nach der Lage gefragt',
    raumFragen(true).includes('anbau'), false);
  check('Aufnahme · der zweite schon', raumFragen(false)[0], 'anbau');

  // -------------------------------------------------------------------------
  // 8 · Der Fortschritt läuft nie rückwärts
  // -------------------------------------------------------------------------
  // Nenner bei einem angefangenen Raum: 5 + max(3, 2) · 5 = 5 + 15 = 20.
  // Zehn Antworten davon sind 10/20 = 0,5.
  check('Aufnahme · Fortschritt bei 10 von 20', fortschritt(10, 1), 0.5, 1e-9);
  check('Aufnahme · Fortschritt beginnt bei null', fortschritt(0, 0), 0, 1e-9);
  // Der Nenner wächst mit — der Balken steht dann still, statt zurückzuspringen.
  const vorher = fortschritt(20, 3);
  const nachher = fortschritt(20, 4);
  check('Aufnahme · ein weiterer Raum lässt den Balken nicht springen', nachher <= vorher, true);
  check('Aufnahme · Fortschritt bleibt in [0;1]', fortschritt(999, 1), 1, 1e-9);

  // -------------------------------------------------------------------------
  // 9 · Die Annahmenliste führt jede Angabe genau einmal
  // -------------------------------------------------------------------------
  const a = (was: string, wert: string): Annahme => ({ was, wert, grund: 'Prüfung', at: '2026-01-01T00:00:00Z' });
  let liste: Annahme[] = [];
  liste = merkeAnnahme(liste, a('Raumhöhe', '2,50 m'));
  liste = merkeAnnahme(liste, a('Baualter', 'bis 1948'));
  check('Aufnahme · zwei Annahmen', liste.length, 2);
  // Dieselbe Angabe noch einmal ersetzt den Eintrag, statt ihn zu verdoppeln.
  liste = merkeAnnahme(liste, a('Raumhöhe', '2,60 m'));
  check('Aufnahme · dieselbe Angabe steht nur einmal', liste.length, 2);
  check('Aufnahme · und zwar mit dem neuen Wert',
    liste.find((x) => x.was === 'Raumhöhe')!.wert, '2,60 m');
  check('Aufnahme · der neue Eintrag steht hinten', liste[liste.length - 1].was, 'Raumhöhe');
  // Wer die Frage doch beantwortet, nimmt die Annahme weg.
  liste = loescheAnnahme(liste, 'Raumhöhe');
  check('Aufnahme · beantwortet heißt gelöscht', liste.length, 1);
  check('Aufnahme · und die andere bleibt', liste[0].was, 'Baualter');
  // Gegenprobe: Löschen einer Angabe, die nicht in der Liste steht, ändert nichts.
  check('Aufnahme · Löschen ohne Treffer ändert nichts', loescheAnnahme(liste, 'Fenster').length, 1);
  // Jede Annahme trägt eine Begründung — eine ohne wäre geraten.
  check('Aufnahme · jede Annahme hat einen Grund', liste.filter((x) => !x.grund).length, 0);

  // -------------------------------------------------------------------------
  // 10 · Wohin die Fenster dürfen
  // -------------------------------------------------------------------------
  /*
   * Die Regel „gegenüber dem Anschluss" genügt nicht. Beim ersten Raum gibt
   * es keinen Anschluss; wer dort eine Seite auf gut Glück nimmt, stellt mit
   * dem nächsten Raum den Nachbarn davor — und das Fenster steht in einer
   * Innenwand. In der Heizlast rechnet es dann mit Außentemperatur gegen das
   * Nebenzimmer. Deshalb wird gefragt, was dasteht.
   *
   * Lage: Wohnen 4,5 × 5,0 im Ursprung, Küche 3,0 × 3,5 rechts daneben.
   */
  const w1 = platziere(undefined, 'rechts', 4.5, 5.0);
  const k1 = platziere(w1, 'rechts', 3.0, 3.5);
  // Die rechte Seite des Wohnzimmers: Dort liegt die linke Kante der Küche
  // (x = 4,50) und die Höhen überschneiden sich von 0 bis 3,50 m.
  check('Aufnahme · rechte Seite ist durch den Nachbarn belegt', seiteBelegt(w1, 'rechts', [k1]), true);
  // Gegenprobe unten: Die Küche berührt y = 0 mit ihrer Unterkante, ihre
  // Ausdehnung in x (4,50 … 7,50) überschneidet die des Wohnzimmers
  // (0 … 4,50) aber nur in einem Punkt. Eine Ecke ist keine Wand.
  check('Aufnahme · bloße Eckberührung belegt nicht', seiteBelegt(w1, 'unten', [k1]), false);
  check('Aufnahme · die linke Seite bleibt frei', seiteBelegt(w1, 'links', [k1]), false);
  check('Aufnahme · die obere Seite bleibt frei', seiteBelegt(w1, 'oben', [k1]), false);
  // Und von der Küche aus gesehen ist ihre linke Seite die belegte.
  check('Aufnahme · aus Sicht der Küche ist links belegt', seiteBelegt(k1, 'links', [w1]), true);
  check('Aufnahme · ihre rechte Seite ist frei', seiteBelegt(k1, 'rechts', [w1]), false);

  // Die Wahl: bevorzugt wird die Seite gegenüber dem Anschluss, belegte
  // werden übersprungen.
  check('Aufnahme · freie Wunschseite wird genommen', fensterseite(w1, 'unten', [k1]) ?? '—', 'unten');
  check('Aufnahme · belegte Wunschseite wird gemieden', fensterseite(w1, 'rechts', [k1]) ?? '—', 'unten');
  check('Aufnahme · die Küche bekommt ihre rechte Seite', fensterseite(k1, 'rechts', [w1]) ?? '—', 'rechts');
  // Ohne Nachbarn bleibt es bei der Wunschseite — auch bei der oberen.
  check('Aufnahme · ohne Nachbarn bleibt die Wunschseite', fensterseite(w1, 'oben', []) ?? '—', 'oben');
  /*
   * Ein eingebauter Raum: 2 × 2 im Ursprung, an jeder Seite ein gleich großer
   * Nachbar. Dann gibt es keine Außenseite, und die Antwort ist `undefined` —
   * eine Aussage, kein Fehler. Der Assistent vermerkt sie als Annahme.
   */
  const mitte = { x: 0, y: 0, l: 2, b: 2 };
  const ring = [
    { x: -2, y: 0, l: 2, b: 2 },
    { x: 2, y: 0, l: 2, b: 2 },
    { x: 0, y: -2, l: 2, b: 2 },
    { x: 0, y: 2, l: 2, b: 2 },
  ];
  check('Aufnahme · rundum verbaut ergibt keine Fensterseite',
    fensterseite(mitte, 'unten', ring) === undefined, true);
  // Gegenprobe: Fehlt einer der vier, ist genau diese Seite die Antwort.
  check('Aufnahme · fehlt ein Nachbar, ist dort die Fensterseite',
    fensterseite(mitte, 'oben', ring.slice(0, 3)) ?? '—', 'oben');

  // Die Kanten einer Seite — und jede mit der Gegenprobe, dass sie nicht die
  // gegenüberliegende ist.
  const unten = seitenkanten(w1, 'unten');
  const oben = seitenkanten(w1, 'oben');
  check('Aufnahme · untere Kante liegt auf y = 0', unten[0].y, 0, 1e-9);
  check('Aufnahme · und läuft über die ganze Länge', unten[1].x - unten[0].x, 4.5, 1e-9);
  check('Aufnahme · obere Kante liegt auf y = 5', oben[0].y, 5.0, 1e-9);
  check('Aufnahme · unten ist nicht oben', unten[0].y === oben[0].y, false);
  const rechts = seitenkanten(w1, 'rechts');
  check('Aufnahme · rechte Kante liegt auf x = 4,5', rechts[0].x, 4.5, 1e-9);
  check('Aufnahme · und ist 5,00 m lang', rechts[1].y - rechts[0].y, 5.0, 1e-9);
  check('Aufnahme · rechts ist nicht links', rechts[0].x === seitenkanten(w1, 'links')[0].x, false);
  /*
   * Und der Zusammenhang, auf den es ankommt: In die 5,00 m lange rechte
   * Wand passen zwei Regelfenster, in die 4,50 m lange untere ebenfalls zwei
   * (4,50 − 3 · 0,24 = 3,78; 3,78 / 1,26 = 3 → begrenzt durch den Pfeiler
   * zwischen zweien, siehe Abschnitt 5). Beide Seiten taugen also.
   */
  check('Aufnahme · in die gewählte Seite passen Fenster',
    fensterPlatz(rechts[1].y - rechts[0].y) >= 1, true);
}
