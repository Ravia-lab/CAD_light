/**
 * Automatische Rohrtrassierung — vom Verteiler zu jedem Verbraucher.
 * ---------------------------------------------------------------------------
 * **Warum es dieses Modul gibt.**
 *
 * Die Rohrlänge ist die Größe, an der die halbe Auslegung hängt: sie bestimmt
 * den Druckverlust, damit die Pumpe, damit die Dimension, damit die
 * Wärmeabgabe der Leitung und am Ende die Kosten. Sie wird in der Praxis
 * geschätzt („Luftlinie mal 1,3"), und der Schätzfehler wandert unbemerkt
 * durch die gesamte Rechnung. Dieses Modul ersetzt die Schätzung durch eine
 * Trasse, die man auf dem Plan nachmessen kann.
 *
 * **Warum zwei Verlegearten und nicht ein Verfahren mit Parametern.**
 *
 * Die beiden Verlegearten sind nicht zwei Einstellungen desselben Problems,
 * sie sind zwei verschiedene Probleme:
 *
 *  • `neubau` — die Leitung liegt auf der Rohdecke im Fußbodenaufbau. Sie darf
 *    quer durch den Raum. Die Fachregel (IKZ, „Rohrleitungen im
 *    Fußbodenaufbau") verlangt eine geordnete, wandparallele Verlegung, damit
 *    der Estrichleger und der spätere Bohrer wissen, woran sie sind. Kurzer
 *    Weg schlägt Wandnähe; nur die Randfuge ist tabu.
 *
 *  • `sanierung` — die Leitung liegt sichtbar im Sockelleistenkanal. Sie kann
 *    gar nicht quer durch den Raum, sie klebt an der Wand. Der handelsübliche
 *    Kanal misst 40 × 105 mm und nimmt Rohre bis 20 mm Außendurchmesser auf
 *    (OBO-Sockelleistenkanal, REHAU RAUDUO). Das ist eine harte Grenze für die
 *    nachgelagerte Dimensionierung, deshalb steht sie als Hinweis im Ergebnis.
 *
 * **Die Türöffnung — ausdrücklich eine Anwenderentscheidung.**
 *
 * Ein Sockelleistenkanal kann eine Türöffnung nicht durchlaufen; dort ist
 * keine Wand, an der er sitzen könnte. In der Praxis wird entweder unter der
 * Schwelle durchgebohrt (Bodendurchführung) oder die Zarge umfahren. Es gibt
 * dazu **keine** Fachregel und keinen Normsatz, aus dem sich die Wahl
 * ableiten ließe — sie hängt an Bodenaufbau, Zargenart und Optik und fällt
 * vor Ort. Dieses Modul entscheidet sie deshalb *nicht*. Es macht die Stelle
 * teuer (die Trasse weicht aus, wenn ein Umweg günstiger ist), meldet jeden
 * verbleibenden Durchgang als Befund und benennt ihn als das, was er ist:
 * eine offene Entscheidung des Anwenders.
 *
 * Wie teuer, ist eine Rangfolge und keine Rechnung: der Ersatzweg von
 * `TUER_ZUSCHLAG` ist so bemessen, dass er den üblichen Umweg um einen Raum
 * schlägt. Ein Durchgang wird damit nur genommen, wenn es keinen vernünftigen
 * anderen Weg gibt. Und wenn er genommen wird, dann *quer*: längs der Wand
 * innerhalb der Öffnung liegt kein Rohr, denn dort ist Schwelle oder Zarge und
 * kein Platz für eine Leitung (`sperreLaengsInOeffnung`).
 *
 * **Zwei Stufen: Weg und Lage.**
 *
 * Das Raster beantwortet die Frage „wo entlang". Die Frage „wie genau" kann es
 * nicht beantworten — eine Rasterzelle ist zehn Zentimeter groß, ein
 * Wandabstand wird in Millimetern gemessen. Die zweite Stufe zieht deshalb
 * jedes wandparallele Trassenstück auf seinen exakten Sollabstand zur
 * Wandfläche und setzt die Enden auf die Anschlusspunkte (`feinjustierung`).
 * Das ist der Grund, warum das Suchraster grob bleiben darf, ohne dass die
 * Leitung im Plan neben der Wand liegt.
 *
 * **Warum Rasterweg und nicht Sichtbarkeitsgraph.**
 *
 * Ein Sichtbarkeitsgraph liefert den kürzesten Weg, aber der ist hier gar
 * nicht gesucht: gesucht ist der *verlegbare* Weg, und dessen Güte hängt an
 * einer stetigen Ortsgröße (Wandabstand) und an der Zahl der Bögen. Beides
 * lässt sich auf einem Raster direkt als Kantenkosten hinschreiben, im
 * Sichtbarkeitsgraphen nicht. Das Raster liefert zudem den orthogonalen
 * Streckenzug, den die Verlegung ohnehin verlangt, geschenkt mit.
 *
 * **Warum das schnell genug ist.** Ein Einfamilienhaus misst rund 12 × 10 m;
 * bei 0,10 m Raster sind das etwa 12 000 Zellen. Der Suchraum wird um die
 * Anlaufrichtung erweitert (4 Zustände je Zelle, nötig für exakte
 * Bogenkosten), also rund 50 000 Zustände. Fünfzehn Dijkstra-Läufe darüber
 * bleiben deutlich unter 100 ms. Bei größeren Grundrissen wächst das Produkt
 * aus Zellen und Suchläufen schnell; die Vorbelegung des Rasters richtet sich
 * deshalb an der Größe der Aufgabe aus (`AUFWAND_MAX`). Deshalb ist
 * hier bewusst Dijkstra und nicht A* implementiert: die verbilligten Kanten
 * (siehe unten) drücken die untere Kantenschranke auf `raster · sharedFactor`
 * und entwerten damit jede zulässige Schätzfunktion. Der Gewinn wäre klein,
 * die Fehlerquelle groß.
 */

import type { BimNode, Opening, PipeRoutingMode, Room, RoomUsage, Vec2, Wall } from '../types/bim';
import { pointInPolygon } from './geometry';
import { getWallGeometry, openingSpan } from './wallGeometry';

// ===========================================================================
// Vertrag
// ===========================================================================

/**
 * Hinweis mit Gewicht.
 *
 * Gleiche Form wie in `plantDesign` und `domesticWater`. Der Typ wird hier neu
 * deklariert und nicht importiert, weil `src/types/bim` ihn nicht führt und
 * ein Import aus einem Nachbarmodul des Rechenkerns eine Abhängigkeit stiften
 * würde, die dieses Modul nicht braucht. TypeScript ist strukturell — die
 * Hinweise sind mit denen der anderen Module ohne Umweg austauschbar.
 */
export type PlanningNote = { severity: 'info' | 'warn' | 'error'; text: string };

export interface RoutingRequest {
  mode: PipeRoutingMode;
  levelId: string;
  /** `innerPolygon` ist die lichte Raumfläche und damit der begehbare Bereich. */
  rooms: Room[];
  walls: Wall[];
  nodes: Record<string, BimNode>;
  /** Türen und Durchgänge verbinden die Räume — ohne sie zerfällt der Grundriss. */
  openings: Opening[];
  /** Ausgangspunkt: Verteiler oder Erzeuger. */
  source: Vec2;
  /** Ziele: je Verbraucher eine Kennung und ein Punkt. */
  targets: { id: string; position: Vec2 }[];
  /**
   * Rasterweite der Wegsuche [m].
   *
   * Ohne Angabe wird sie aus der Größe des Geschosses abgeleitet (siehe
   * `RASTER_STANDARD` und `AUFWAND_MAX`). Die Weite bestimmt nur, *wo entlang*
   * die Trasse läuft — *wie genau* sie liegt, entscheidet die Feinjustierung.
   */
  grid?: number;
  /** Verbilligung schon benutzter Kanten [-]; Vorbelegung 0.15. */
  sharedFactor?: number;
}

export interface RoutedLeg {
  targetId: string;
  /** Trasse als Polylinie [m], erster Punkt = Quelle, letzter = Ziel. */
  points: Vec2[];
  /** Trassenlänge [m]. */
  length: number;
  /** Zahl der Richtungswechsel — daraus folgen die Bögen. */
  bends: number;
  /** Türöffnungen, die die Trasse passiert (Kennungen). */
  doorCrossings: string[];
}

export interface RoutedNetwork {
  legs: RoutedLeg[];
  /**
   * Die Trasse in Abschnitten, die sich mehrere Verbraucher teilen.
   * `targets` nennt alle Verbraucher, deren Weg über diesen Abschnitt läuft —
   * daraus folgt der Volumenstrom und damit die Dimension.
   */
  segments: { from: Vec2; to: Vec2; targets: string[] }[];
  notes: PlanningNote[];
}

// ===========================================================================
// Parameter der Kostenfunktion
// ===========================================================================

/**
 * Rasterweite der Wegsuche [m] — Vorbelegung.
 *
 * **Warum 0,10 m und nicht 0,25 m.** Das Raster hatte früher zwei Aufgaben in
 * einer: es sollte den *Weg* finden und zugleich die *Lage* des Rohres
 * festlegen. Für die Lage war es viel zu grob — im Plan saß die Leitung
 * sichtbar neben der Wand statt an ihr. Die Lage macht jetzt die
 * Feinjustierung auf den Millimeter (siehe `feinjustierung`); dem Raster
 * bleibt nur die Wegfindung. Dafür genügte auch 0,25 m — aber ein feineres
 * Raster findet Wege durch enge Stellen, die ein grobes gar nicht sieht (eine
 * 0,885-m-Tür hat bei 0,25 m Raster drei Zellen, bei 0,10 m neun), und es legt
 * die Abzweige näher an die Stelle, an der sie fachlich hingehören.
 *
 * **Warum nicht 0,01 m.** Ein Zentimeterraster über 20 × 10 m wären zwei
 * Millionen Zellen je Suchlauf — das ist keine Feinheit mehr, sondern
 * Rechenzeit ohne Gegenwert. Die Zentimeter kommen aus der Feinjustierung.
 */
const RASTER_STANDARD = 0.1;

/**
 * Gröbste Weite [m], auf die die Vorbelegung selbsttätig zurückfällt.
 *
 * Das ist die frühere Vorbelegung: bis hierher ist die Wegfindung erprobt.
 * Wird auch das noch zu teuer, greift `ZELLEN_MAX`.
 */
const RASTER_GROB = 0.25;

/** Verbilligung schon benutzter Kanten [-]. */
const TEILUNG_STANDARD = 0.15;

/**
 * Zeitziel der Wegsuche [s].
 *
 * Nielsen („Response Times: The 3 Important Limits") nennt 0,1 s als die
 * Grenze, bis zu der eine Reaktion als unmittelbar empfunden wird, und 1 s
 * als die, bis zu der der Gedankenfluss nicht abreißt. Die Trassierung läuft
 * bei jeder Änderung im Anlagenblatt neu; 0,15 s liegt dicht über der ersten
 * Grenze und weit unter der zweiten.
 */
const SUCHZEIT_ZIEL = 0.15;

/**
 * Gemessener Aufwand der Wegsuche [s je Zelle und Ziel].
 *
 * Aus der Belastungsprobe (`npm run bench`, Größen `normal` und `huge`):
 * 0,33 bis 0,37 µs je Zelle und Suchlauf, über eine Spanne von 5 000 bis
 * 100 000 Zellen und 18 bis 60 Zielen. Der Wert hängt am Rechner — er dient
 * nur dazu, die Vorbelegung an der Größe der Aufgabe auszurichten, nicht als
 * Zusage.
 */
const SUCHZEIT_JE_ZELLE_ZIEL = 0.35e-6;

/**
 * Aufwandsschranke der Vorbelegung [Zellen · Ziele].
 *
 * Die Laufzeit hängt am Produkt aus Zellenzahl und Zahl der Suchläufe (ein
 * Lauf je Verbraucher). Wird die Schranke überschritten, geht die
 * *Vorbelegung* selbsttätig gröber; ein vom Aufrufer ausdrücklich gewünschtes
 * Raster bleibt unangetastet (dort greift erst `ZELLEN_MAX`).
 */
const AUFWAND_MAX = Math.round(SUCHZEIT_ZIEL / SUCHZEIT_JE_ZELLE_ZIEL);

/**
 * Obergrenze der Zellenzahl. Ein versehentlich zu feines Raster über einem
 * großen Grundriss würde die Laufzeit quadratisch sprengen; statt zu rechnen
 * wird das Raster dann gröber gewählt und der Eingriff gemeldet.
 */
const ZELLEN_MAX = 250_000;

/**
 * `sanierung`: Zuschlagsfaktor je Meter Wandabstand [1/m]. Bei 12 kostet ein
 * Meter Weg in 2 m Wandabstand das 25-fache eines Meters an der Wand — die
 * Trasse klebt damit sicher an der Wand, kann aber eine unvermeidbare freie
 * Strecke (etwa vom Verteiler in der Raummitte zur nächsten Wand) trotzdem
 * gehen, statt unauffindbar zu werden.
 */
const WAND_GEWICHT = 12;

/** Toleranz [m], innerhalb der eine Zelle als „an der Wand" gilt. */
const WAND_TOLERANZ = 0.05;

/**
 * `sanierung`: Ersatzweg [m] für das Passieren einer Türöffnung.
 *
 * **Warum 30 m und nicht 6 m.** Der frühere Wert von 6 m hieß: ein Umweg bis
 * 6 m ist billiger als ein Durchgang. Damit nahm die Trassierung den Türweg
 * auch dann, wenn ein ordentlicher Weg drumherum existierte — 6 m sind
 * weniger als der Umweg um einen einzigen Raum. Genau das wollte der
 * Anwender nicht: „Rohre werden nicht an Türen oder in Türen gelegt, wenn es
 * sich vermeiden lässt."
 *
 * Die Zahl ist deshalb an dem bemessen, was sie schlagen soll — dem üblichen
 * Umweg:
 *
 *  • Um einen Wohnraum von 5 × 4 m herum statt hindurch: bis rund 13 m
 *    Mehrweg (Umfang 18 m gegen 5 m Durchquerung).
 *  • Um zwei solche Räume herum: bis rund 26 m.
 *  • Einmal um ein Einfamilienhaus von 12 × 10 m herum: rund 44 m Umfang,
 *    also bis rund 32 m Mehrweg gegenüber der Durchquerung.
 *
 * 30 m liegt damit über dem Umweg um ein, zwei Räume und noch unter dem
 * Umweg um das ganze Geschoss: der Durchgang wird genommen, wenn es *keinen*
 * vernünftigen anderen Weg gibt, und sonst nicht. Das ist keine Normzahl —
 * es gibt zur Türdurchführung keine Fachregel (siehe Dateikopf) — sondern
 * eine bewusst gesetzte Rangfolge, die hier offen liegt statt versteckt.
 */
export const TUER_ZUSCHLAG = 30.0;

/**
 * Wegegewicht je Raumnutzung [-] — durch welchen Raum die Trasse laufen soll.
 * ---------------------------------------------------------------------------
 * **Der Befund, auf den diese Tabelle antwortet.** Bis 1.28.2 kannte die
 * Wegsuche nur „kurz" und „an der Wand". Ein Verteiler in der Diele schickte
 * damit seine Anbindeleitungen auf dem kürzesten Weg quer durch das
 * Wohnzimmer — rechnerisch einwandfrei und in der Sache falsch. Verlegt wird
 * anders: Die Kreise laufen gebündelt über den Flur und zweigen erst an der
 * Zimmertür ab. Der Flur ist die Verkehrsfläche des Hauses, und er ist es für
 * Menschen wie für Leitungen.
 *
 * **Warum der Aufenthaltsraum den Bezugswert 1 trägt und nicht der Flur.**
 * Das ist keine Geschmacksfrage, sondern Voraussetzung dafür, dass
 * `TUER_ZUSCHLAG` seine Bedeutung behält. Dessen 30 m sind gegen den *Umweg
 * um einen Raum* bemessen (siehe dort). Machte man die Wohnräume teurer,
 * statt den Flur billiger, wüchse jeder Umweg im selben Maß — und ein fest
 * in Metern angeschriebener Zuschlag wäre plötzlich ein Drittel wert. Der
 * Flur wird also günstiger; alles andere bleibt, wo es war.
 *
 * **Was die Zahl bedeutet.** Sie ist der Preis eines Meters *in diesem Raum*,
 * gemessen in Metern Wohnzimmer. 0,4 im Flur heißt: Der Umweg über den Flur
 * wird genommen, solange er weniger als zweieinhalbmal so lang ist wie die
 * Durchquerung.
 *
 * **Warum das Zweieinhalbfache und nicht das Zehnfache.** Die Zahl ist an
 * dem bemessen, was sie schlagen soll — dem üblichen Umweg. Um ein Zimmer von
 * 5 × 4 m herum statt hindurch sind rund 9 m statt 5 m, also Faktor 1,8. Zwei
 * Zimmer in Reihe kommen auf etwa 2,2. Bei 2,5 gewinnt der Flurweg in diesen
 * Fällen und verliert dort, wo er absurd würde — einmal um das halbe Geschoss
 * herum, um zwei Meter Wohnzimmer zu sparen, verlegt niemand.
 *
 * **Die Nebenräume liegen dazwischen.** Eine Leitung durch die Abstellkammer
 * stört niemanden, eine durch die Küche etwas. 0,67 heißt: Der Umweg wird
 * genommen, wenn er weniger als die Hälfte länger ist.
 *
 * Das ist **keine Normzahl** — es gibt zur Trassenführung durch Aufenthalts-
 * räume keine Fachregel. Es ist eine Rangfolge, und sie liegt hier offen.
 */
export const NUTZUNGS_GEWICHT: Record<RoomUsage, number> = {
  /** Verkehrsfläche — dafür ist sie da. 1/2,5. */
  hallway: 0.4,
  /** Nebenräume: eine Leitung stört, aber wenig. 1/1,5. */
  storage: 0.67,
  technical: 0.67,
  wc: 0.67,
  bath: 0.67,
  kitchen: 0.67,
  /** Aufenthaltsräume: der Bezugswert. Hier wird gewohnt, gearbeitet, geschlafen. */
  living: 1,
  bedroom: 1,
  office: 1,
  /**
   * Ohne erfasste Nutzung wird der Raum wie ein Nebenraum behandelt. „Nicht
   * erfasst" darf weder Freibrief noch Sperre sein: Ein Freibrief schickte
   * die Trasse durch jedes unbenannte Wohnzimmer, eine Sperre triebe sie um
   * jeden unbenannten Abstellraum herum.
   */
  other: 0.67,
};

/** `neubau`: Zuschlag [m] je Richtungswechsel — ein Bogen kostet ein Formstück. */
const BOGEN_NEUBAU = 0.35;

/**
 * `sanierung`: kleiner Bogenzuschlag. Fachlich spielt er kaum eine Rolle (der
 * Kanal folgt der Wand und biegt, wo die Wand biegt); er dient dazu, den
 * treppenförmigen Zickzack zu unterdrücken, den ein Raster bei gleichwertigen
 * Zellen sonst erzeugt.
 */
const BOGEN_SANIERUNG = 0.10;

/**
 * `neubau`: Sollabstand der Rohrachse zur Wandfläche [m].
 *
 * DIN EN 1264-4 nennt für Flächenheizrohre 50 mm Abstand zu senkrechten
 * Bauteilen, damit das Rohr nicht in der Randfuge und nicht im
 * Randdämmstreifen liegt. **Das ist kein unmittelbar einschlägiger Wert:**
 * die Norm regelt Flächenheizungen, nicht Anbindeleitungen. Sie ist der
 * nächstliegende belegbare Anhalt — es gibt für Anbindeleitungen im
 * Fußbodenaufbau keinen normierten Mindestabstand.
 *
 * Derselbe Wert dient der Wegsuche als Schwelle des Randfugen-Zuschlags. Das
 * ist Absicht: Wegsuche und Feinjustierung müssen dieselbe Grenze meinen,
 * sonst zieht die Feinjustierung die Trasse in einen Bereich, den die
 * Wegsuche gerade teuer gemacht hat.
 */
const SOLLABSTAND_NEUBAU = 0.05;

/** `neubau`: Gewicht des Randfugen-Zuschlags [-], bezogen auf die Kantenlänge. */
const RAND_GEWICHT = 3.0;

/**
 * `neubau`: Zuschlagsfaktor je Meter Wandabstand [1/m] — die Wandnähe.
 * ---------------------------------------------------------------------------
 * **Warum das nachgetragen wurde.** Der Dateikopf beruft sich seit jeher auf
 * die Fachregel (IKZ, „Rohrleitungen im Fußbodenaufbau"): geordnete,
 * wandparallele Verlegung, damit Estrichleger und der spätere Bohrer wissen,
 * woran sie sind. Umgesetzt war davon nichts — es galt „kurzer Weg schlägt
 * Wandnähe", und die Trasse schnitt quer durch die Zimmer. Der Anwender hat
 * genau das gemeldet: „Rohre quer durch den Raum ist auch doof."
 *
 * Zwischen der zitierten Regel und dem Verhalten klaffte also eine Lücke.
 * Diese Zahl schließt sie.
 *
 * **Warum 1,0 und nicht 12 wie in der Sanierung.** Im Sockelleistenkanal
 * *muss* das Rohr an die Wand — es gibt keinen anderen Ort. Im Fußbodenaufbau
 * ist die Wandnähe eine Ordnungsregel, kein Zwang: Wo der Umweg absurd würde,
 * darf die Leitung quer.
 *
 * **Woran 1,0 bemessen ist.** Ein Meter in der Raummitte, also rund 2 m von
 * der Wand, kostet damit 1 + 1,0 · (2 − 0,05) ≈ das Dreifache eines Meters an
 * der Wand. Der Weg am Rand gewinnt folglich, solange er nicht mehr als
 * dreimal so lang ist wie der Weg quer hindurch. Um ein quadratisches Zimmer
 * herum statt hindurch ist er doppelt so lang — der Rand gewinnt. Quer durch
 * eine sehr lange Halle, bei der der Rand das Vierfache kostete, gewinnt der
 * kurze Weg. Genau diese Rangfolge ist gemeint.
 *
 * Es ist **keine Normzahl**: Die Fachregel verlangt wandparallele Verlegung,
 * beziffert aber keinen Preis für die Abweichung.
 */
const WAND_GEWICHT_NEUBAU = 1.0;

/** Fangradius [m], in dem Quelle und Ziele auf eine begehbare Zelle gezogen werden. */
const FANGRADIUS = 1.5;

/** Lichtes Innenmaß des handelsüblichen Sockelleistenkanals [mm]. */
const KANAL_QUERSCHNITT_MM = { hoehe: 105, tiefe: 40, maxRohrAussen: 20 };

/**
 * `sanierung`: Sollabstand der Rohrachse zur Wandfläche [m].
 *
 * Der handelsübliche Sockelleistenkanal misst 40 × 105 mm (OBO
 * Sockelleistenkanal, REHAU RAUDUO). **Welche der beiden Kanten im Grundriss
 * erscheint, hängt an der Montage** — steht der Kanal hochkant an der Wand,
 * ragt er 40 mm in den Raum; liegt er flach auf dem Boden an der Wand, sind
 * es 105 mm. Der Plan braucht *eine* Zahl. Gewählt: 50 mm, aus drei Gründen:
 *
 *  • Es ist die halbe der beiden Kanten (105/2 = 52,5 mm), auf 5 mm gerundet —
 *    die Rohrachse liegt in der Mitte des Kanals.
 *  • Es liegt am oberen Rand der Spanne, die der Anwender für die Rohrachse
 *    genannt hat (30–50 mm vor der Wandfläche).
 *  • Mit dem Paarabstand von 50 mm aus `pipeLayout` liegen Vor- und Rücklauf
 *    bei 25 mm und 75 mm — beide innerhalb der 105 mm.
 *
 * Herkunft also: Produktmaß plus Anwendervorgabe. **Keine Norm** — für die
 * Lage eines Sockelleistenkanals gibt es keine.
 */
const SOLLABSTAND_SANIERUNG = 0.05;

/** Sollabstand der Rohrachse zur Wandfläche [m] je Verlegeart. */
export const SOLLABSTAND = {
  sanierung: SOLLABSTAND_SANIERUNG,
  neubau: SOLLABSTAND_NEUBAU,
} as const;

/**
 * Größte Schrägstellung, bei der eine Wandfläche noch als Bezug eines
 * achsparallelen Trassenstücks gilt [-] (Sinus des Winkels).
 *
 * 0,02 sind gut 1°. Das Raster ist an der dominanten Wandrichtung
 * ausgerichtet (siehe `dominanteRichtung`); die tragenden Wände stehen darin
 * exakt parallel. Was mehr als ein Grad schräg steht, ist keine Bezugsfläche
 * für ein wandparalleles Stück — dort gehört das Rohr nicht „an die Wand
 * gezogen", sondern dorthin, wo die Wegsuche es hingelegt hat.
 */
const PARALLEL_TOLERANZ = 0.02;

/**
 * Abstand der Durchführung zur Laibung [m].
 *
 * Quer durch die Öffnung ist die halbe Antwort; die andere Hälfte ist *wo*
 * quer. `openingSpan` liefert das Rohbaumaß, und am Rand dieses Maßes sitzt
 * die Zarge: zwischen Rohbaubreite 885 mm und Türblattbreite 860 mm
 * (DIN 18101) liegen je Seite gut 12 mm Zargenspiegel, dazu die Bekleidung.
 * Eine Bodendurchführung in diesem Randstreifen läge in der Zarge — 40 mm
 * halten sie sicher heraus. Gerundet und **nicht normiert**: für die Lage
 * einer Rohrdurchführung in einer Türöffnung gibt es keine Norm.
 *
 * Gerückt wird nur, wer im Randstreifen liegt, und nur bis an dessen Kante.
 * Die Öffnungsmitte wäre keine bessere Antwort: sie verböge den Weg um bis zu
 * die halbe Öffnungsbreite, ohne dass dafür etwas spräche — frei von Zarge
 * und Falz ist jede Stelle jenseits des Randstreifens.
 */
const LAIBUNGSABSTAND = 0.04;

// ===========================================================================
// Kleinhelfer
// ===========================================================================

const WURZEL2 = Math.SQRT2;

function de(value: number, digits = 2): string {
  return value.toFixed(digits).replace('.', ',');
}

function round(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/**
 * Auf Millimeter runden.
 *
 * Der Millimeter ist die Einheit, in der auf der Baustelle gemessen wird, und
 * die feinste, die eine Trasse sinnvoll trägt. Alles darunter ist
 * Rechenrauschen, das sich beim Vergleich zweier Punkte als Lücke zeigt: der
 * Rohrausleger erkennt den Abzweig daran, dass drei Abschnitte *denselben*
 * Punkt nennen.
 */
function mm(p: Vec2): Vec2 {
  return { x: round(p.x, 3), y: round(p.y, 3) };
}

/**
 * Binärer Min-Heap über Zustandsindizes.
 *
 * Eigenbau statt Bibliothek, weil der Rechenkern ohne Laufzeitabhängigkeiten
 * ausgeliefert wird. Die Puffer werden einmal angelegt und über alle
 * Dijkstra-Läufe wiederverwendet — das spart bei fünfzehn Läufen die
 * Neuanlage von fünfzehn Feldern und den zugehörigen Aufräumdruck.
 */
class MinHeap {
  private schluessel: Float64Array;
  private werte: Int32Array;
  private groesse = 0;

  constructor(kapazitaet: number) {
    this.schluessel = new Float64Array(kapazitaet);
    this.werte = new Int32Array(kapazitaet);
  }

  leeren(): void {
    this.groesse = 0;
  }

  get leer(): boolean {
    return this.groesse === 0;
  }

  einfuegen(wert: number, schluessel: number): void {
    if (this.groesse === this.schluessel.length) this.wachsen();
    let i = this.groesse++;
    this.schluessel[i] = schluessel;
    this.werte[i] = wert;
    while (i > 0) {
      const eltern = (i - 1) >> 1;
      if (this.schluessel[eltern] <= this.schluessel[i]) break;
      this.tauschen(i, eltern);
      i = eltern;
    }
  }

  entnehmen(): { wert: number; schluessel: number } {
    const wert = this.werte[0];
    const schluessel = this.schluessel[0];
    this.groesse--;
    if (this.groesse > 0) {
      this.schluessel[0] = this.schluessel[this.groesse];
      this.werte[0] = this.werte[this.groesse];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let klein = i;
        if (l < this.groesse && this.schluessel[l] < this.schluessel[klein]) klein = l;
        if (r < this.groesse && this.schluessel[r] < this.schluessel[klein]) klein = r;
        if (klein === i) break;
        this.tauschen(i, klein);
        i = klein;
      }
    }
    return { wert, schluessel };
  }

  private tauschen(a: number, b: number): void {
    const ks = this.schluessel[a];
    this.schluessel[a] = this.schluessel[b];
    this.schluessel[b] = ks;
    const kw = this.werte[a];
    this.werte[a] = this.werte[b];
    this.werte[b] = kw;
  }

  private wachsen(): void {
    const s = new Float64Array(this.schluessel.length * 2);
    s.set(this.schluessel);
    this.schluessel = s;
    const w = new Int32Array(this.werte.length * 2);
    w.set(this.werte);
    this.werte = w;
  }
}

// ===========================================================================
// Rasterausrichtung
// ===========================================================================

/**
 * Dominante Wandrichtung [rad], reduziert auf das Viertelkreis-Intervall
 * (−45°, 45°].
 *
 * **Warum das Raster gedreht wird.** Die Fachregel verlangt wandparallele
 * Verlegung. Ein achsparalleles Raster erfüllt das nur, solange das Haus
 * achsparallel steht. Bei einem um 17° gedrehten Grundriss erzeugte es eine
 * Treppe statt einer Geraden — sichtbar falsch und mit mehr Bögen als nötig.
 * Die Drehung des gesamten Rechenraums um die dominante Wandrichtung kostet
 * zwei Koordinatentransformationen und löst das Problem vollständig.
 *
 * Gemittelt wird über den vierfachen Winkel, weil Wandrichtungen modulo 90°
 * gleichwertig sind: eine Wand bei 0° und eine bei 90° stützen dieselbe
 * Rasterlage. Gewichtet wird mit der Wandlänge — lange Wände bestimmen das
 * Verlegemuster, nicht kurze Schrägen.
 */
function dominanteRichtung(walls: Wall[], nodes: Record<string, BimNode>): number {
  let sx = 0;
  let sy = 0;
  for (const wall of walls) {
    const a = nodes[wall.a];
    const b = nodes[wall.b];
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const laenge = Math.hypot(dx, dy);
    if (laenge < 1e-6) continue;
    const winkel = Math.atan2(dy, dx);
    sx += laenge * Math.cos(4 * winkel);
    sy += laenge * Math.sin(4 * winkel);
  }
  if (Math.hypot(sx, sy) < 1e-9) return 0;
  const theta = Math.atan2(sy, sx) / 4;
  // Unter einem halben Grad ist die Drehung nur Rundungsrauschen; sie würde
  // Koordinaten unnötig „verschmieren" und Wiederholläufe unvergleichbar machen.
  return Math.abs(theta) < 0.5 * (Math.PI / 180) ? 0 : theta;
}

// ===========================================================================
// Rasteraufbau
// ===========================================================================

/** Alles, was die Wegsuche über den Grundriss wissen muss. */
interface Raster {
  /** Zellen in x- und y-Richtung (lokales, gedrehtes Koordinatensystem). */
  nx: number;
  ny: number;
  /** Rasterweite [m]. */
  h: number;
  /** Ursprung (Mitte der Zelle 0,0) im lokalen System. */
  x0: number;
  y0: number;
  /** Begehbar? 1 = ja. */
  begehbar: Uint8Array;
  /** Abstand der Zellenmitte zur nächsten Wandfläche [m]. */
  wandabstand: Float64Array;
  /**
   * Kosten je Kante [m-Ersatzweg], Länge und Ortszuschläge enthaltend.
   * Index: `zelle * 2` = Kante nach +x, `zelle * 2 + 1` = Kante nach +y.
   * `Infinity` bedeutet: nicht passierbar.
   */
  kantenKosten: Float64Array;
  /** Öffnungsindex der Kante, falls sie eine Tür-/Durchgangsebene quert; sonst −1. */
  kantenTuer: Int32Array;
}

/** Zellindex aus Rasterkoordinaten. */
const idx = (r: Raster, i: number, j: number): number => j * r.nx + i;

/** Mittelpunkt einer Zelle im lokalen System. */
function zellMitte(r: Raster, zelle: number): Vec2 {
  const i = zelle % r.nx;
  const j = (zelle - i) / r.nx;
  return { x: r.x0 + i * r.h, y: r.y0 + j * r.h };
}

/**
 * Abstand jeder begehbaren Zelle zur nächsten Wandfläche.
 *
 * **Warum Distanztransformation und nicht Abstand zu den Wandsegmenten.** Der
 * Rand des begehbaren Bereichs *ist* die Wandfläche — das Innenpolygon endet
 * genau dort. Eine Chamfer-Distanztransformation über die Zellen liefert
 * denselben Wert in O(Zellen) statt in O(Zellen · Wände) und ist damit auch
 * bei einem Mehrfamilienhaus mit hundert Wänden noch linear. Der Preis ist
 * ein Diskretisierungsfehler von wenigen Prozent, der für eine Gewichtung
 * ohne Belang ist.
 *
 * Der halbe Rasterschritt wird abgezogen, weil die nächste *nicht* begehbare
 * Zellenmitte im Mittel um diesen Betrag hinter der Wandfläche liegt.
 */
function distanztransformation(r: Raster): void {
  const { nx, ny, h, begehbar, wandabstand } = r;
  const gerade = h;
  const diagonal = h * WURZEL2;
  const gross = 1e9;

  for (let c = 0; c < begehbar.length; c++) wandabstand[c] = begehbar[c] === 1 ? gross : 0;

  // Vorwärts: links, unten, unten-links, unten-rechts.
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const c = j * nx + i;
      let d = wandabstand[c];
      if (d === 0) continue;
      if (i > 0) d = Math.min(d, wandabstand[c - 1] + gerade);
      if (j > 0) {
        d = Math.min(d, wandabstand[c - nx] + gerade);
        if (i > 0) d = Math.min(d, wandabstand[c - nx - 1] + diagonal);
        if (i < nx - 1) d = Math.min(d, wandabstand[c - nx + 1] + diagonal);
      }
      wandabstand[c] = d;
    }
  }
  // Rückwärts: rechts, oben, oben-rechts, oben-links.
  for (let j = ny - 1; j >= 0; j--) {
    for (let i = nx - 1; i >= 0; i--) {
      const c = j * nx + i;
      let d = wandabstand[c];
      if (d === 0) continue;
      if (i < nx - 1) d = Math.min(d, wandabstand[c + 1] + gerade);
      if (j < ny - 1) {
        d = Math.min(d, wandabstand[c + nx] + gerade);
        if (i < nx - 1) d = Math.min(d, wandabstand[c + nx + 1] + diagonal);
        if (i > 0) d = Math.min(d, wandabstand[c + nx - 1] + diagonal);
      }
      wandabstand[c] = d;
    }
  }

  for (let c = 0; c < wandabstand.length; c++) {
    wandabstand[c] = Math.max(0, wandabstand[c] - h / 2);
  }
}

/** Öffnung im lokalen System, aufbereitet für Begehbarkeit und Kantenprüfung. */
interface OeffnungsBand {
  opening: Opening;
  /** Achsanfang der Wand. */
  a: Vec2;
  /** Einheitsrichtung der Wandachse. */
  dir: Vec2;
  /** Linksnormale der Wandachse. */
  normal: Vec2;
  /** Lichter Bereich entlang der Achse [m]. */
  von: number;
  bis: number;
  /** Halbe Wandstärke [m]. */
  halbdicke: number;
}

/**
 * Baut das Raster: Begehbarkeit, Wandabstand, Kantenkosten, Türkanten.
 *
 * Die Öffnungen sind hier nicht Beiwerk, sondern tragend: ohne sie ist jedes
 * Raumpolygon eine eigene Insel und keine einzige Trasse käme zustande.
 */
function baueRaster(
  rooms: Room[],
  baender: OeffnungsBand[],
  punkte: Vec2[],
  h: number,
  mode: PipeRoutingMode,
): Raster {
  // --- Ausdehnung -------------------------------------------------------
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const merke = (p: Vec2): void => {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  };
  for (const room of rooms) for (const p of room.innerPolygon) merke(p);
  for (const p of punkte) merke(p);

  // Zwei Zellen Rand: der Rand bleibt unbegehbar und liefert der
  // Distanztransformation eine saubere Nullkante.
  const rand = 2 * h;
  minX -= rand;
  minY -= rand;
  maxX += rand;
  maxY += rand;

  const nx = Math.max(2, Math.ceil((maxX - minX) / h) + 1);
  const ny = Math.max(2, Math.ceil((maxY - minY) / h) + 1);
  const anzahl = nx * ny;

  const r: Raster = {
    nx,
    ny,
    h,
    x0: minX,
    y0: minY,
    begehbar: new Uint8Array(anzahl),
    wandabstand: new Float64Array(anzahl),
    kantenKosten: new Float64Array(anzahl * 2),
    kantenTuer: new Int32Array(anzahl * 2).fill(-1),
  };

  // --- Begehbarkeit: Raumflächen ----------------------------------------
  // Die Umschließende je Raum spart den teuren Polygontest für die weitaus
  // meisten Zellen — ohne sie wäre dieser Schritt der Flaschenhals.
  for (const room of rooms) {
    const poly = room.innerPolygon;
    if (poly.length < 3) continue;
    let rminX = Infinity;
    let rminY = Infinity;
    let rmaxX = -Infinity;
    let rmaxY = -Infinity;
    for (const p of poly) {
      if (p.x < rminX) rminX = p.x;
      if (p.y < rminY) rminY = p.y;
      if (p.x > rmaxX) rmaxX = p.x;
      if (p.y > rmaxY) rmaxY = p.y;
    }
    const i0 = Math.max(0, Math.floor((rminX - r.x0) / h));
    const i1 = Math.min(nx - 1, Math.ceil((rmaxX - r.x0) / h));
    const j0 = Math.max(0, Math.floor((rminY - r.y0) / h));
    const j1 = Math.min(ny - 1, Math.ceil((rmaxY - r.y0) / h));
    for (let j = j0; j <= j1; j++) {
      const y = r.y0 + j * h;
      for (let i = i0; i <= i1; i++) {
        const c = j * nx + i;
        if (r.begehbar[c] === 1) continue;
        if (pointInPolygon({ x: r.x0 + i * h, y }, poly)) r.begehbar[c] = 1;
      }
    }
  }

  // --- Nutzungszuschlag je Zelle ----------------------------------------
  /*
   * Der Weg *durch* einen Aufenthaltsraum kostet mehr als der durch den Flur
   * (siehe `NUTZUNGS_GEWICHT`). Gefüllt wird in derselben Schleifenform wie
   * die Begehbarkeit — und bewusst **nach** ihr, in einem eigenen Durchgang:
   * Überlappen sich zwei Raumpolygone an einer Zelle (Verschweißtoleranz),
   * soll der *günstigere* Wert gewinnen. Bekäme der zuletzt geprüfte Raum das
   * letzte Wort, hinge das Ergebnis an der Reihenfolge im Objekt.
   */
  // 0 heißt „kein Raum trägt diese Zelle" — dort greift unten der Bezugswert.
  const nutzung = new Float64Array(anzahl);
  for (const room of rooms) {
    const poly = room.innerPolygon;
    if (poly.length < 3) continue;
    const gewicht = NUTZUNGS_GEWICHT[room.usage] ?? NUTZUNGS_GEWICHT.other;
    let rminX = Infinity;
    let rminY = Infinity;
    let rmaxX = -Infinity;
    let rmaxY = -Infinity;
    for (const p of poly) {
      if (p.x < rminX) rminX = p.x;
      if (p.y < rminY) rminY = p.y;
      if (p.x > rmaxX) rmaxX = p.x;
      if (p.y > rmaxY) rmaxY = p.y;
    }
    const i0 = Math.max(0, Math.floor((rminX - r.x0) / h));
    const i1 = Math.min(nx - 1, Math.ceil((rmaxX - r.x0) / h));
    const j0 = Math.max(0, Math.floor((rminY - r.y0) / h));
    const j1 = Math.min(ny - 1, Math.ceil((rmaxY - r.y0) / h));
    for (let j = j0; j <= j1; j++) {
      const y = r.y0 + j * h;
      for (let i = i0; i <= i1; i++) {
        const c = j * nx + i;
        if (nutzung[c] !== 0 && nutzung[c] <= gewicht) continue;
        if (!pointInPolygon({ x: r.x0 + i * h, y }, poly)) continue;
        nutzung[c] = gewicht;
      }
    }
  }

  // --- Begehbarkeit: lichte Öffnungen -----------------------------------
  // Das Band greift um einen Rasterschritt über die Wandflächen hinaus, damit
  // die Zellenkette sicher in beide Räume durchbindet. Ohne diesen Überstand
  // kann bei dünnen Wänden zwischen zwei Zellenmitten eine Lücke bleiben.
  for (const band of baender) {
    const halb = band.halbdicke + h;
    ueberBandZellen(r, band, halb, (c) => {
      r.begehbar[c] = 1;
    });
  }

  distanztransformation(r);

  // --- Türkanten --------------------------------------------------------
  // Getaggt wird die *Kante*, nicht die Zelle: nur so trifft der Zuschlag den
  // Durchgang genau einmal, unabhängig davon, wie viele Zellenmitten zufällig
  // in der Wandstärke liegen. Bei einer 11,5-cm-Wand und 25-cm-Raster liegt
  // oft gar keine darin.
  for (let k = 0; k < baender.length; k++) {
    const band = baender[k];
    const halb = band.halbdicke + 2 * h;
    ueberBandZellen(r, band, halb, (c) => {
      const i = c % nx;
      const j = (c - i) / nx;
      if (i < nx - 1) pruefeTuerkante(r, band, k, c, c + 1, c * 2);
      if (j < ny - 1) pruefeTuerkante(r, band, k, c, c + nx, c * 2 + 1);
    });
  }

  // --- Kantenkosten -----------------------------------------------------
  const faktor = new Float64Array(anzahl);
  for (let c = 0; c < anzahl; c++) {
    if (r.begehbar[c] === 0) continue;
    const d = r.wandabstand[c];
    if (mode === 'sanierung') {
      // Weg von der Wand wird teuer — die Trasse folgt zwangsläufig den Wänden.
      faktor[c] = 1 + WAND_GEWICHT * Math.max(0, d - WAND_TOLERANZ);
    } else {
      // Die Randfuge ist tabu, die Raummitte teuer — dazwischen liegt der
      // Sollabstand, an dem das Rohr liegen soll.
      faktor[c] =
        1 +
        RAND_GEWICHT * (Math.max(0, SOLLABSTAND_NEUBAU - d) / SOLLABSTAND_NEUBAU) +
        WAND_GEWICHT_NEUBAU * Math.max(0, d - SOLLABSTAND_NEUBAU);
    }
    /*
     * Und darüber, in beiden Verlegearten, der Nutzungszuschlag.
     *
     * **Warum mal und nicht plus.** Der Zuschlag beantwortet eine andere
     * Frage als die beiden Formeln darüber: die sagen, *wo im Raum* das Rohr
     * liegen soll, dieser sagt, *durch welchen Raum* es laufen soll. Als
     * Faktor lässt er die Rangfolge innerhalb eines Raums unberührt — im
     * Wohnzimmer wie im Flur liegt die Leitung weiterhin an der Wand — und
     * verschiebt nur die Rangfolge zwischen den Räumen. Als Summand täte er
     * beides und machte ausgerechnet die wandnahe Zelle im Flur teurer als
     * die raumferne im Wohnzimmer.
     *
     * Zellen, die zu keinem Raum gehören — die lichte Türöffnung, der
     * Überstand über die Wandflächen — behalten den Bezugswert 1, also den
     * des Aufenthaltsraums. Eine Türschwelle einem der beiden Räume
     * zuzuschlagen wäre eine Behauptung, und teuer ist sie in `sanierung`
     * ohnehin durch `TUER_ZUSCHLAG`.
     */
    const n = nutzung[c];
    if (n > 0) faktor[c] *= n;
  }

  const tuerZuschlag = mode === 'sanierung' ? TUER_ZUSCHLAG : 0;
  r.kantenKosten.fill(Infinity);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const c = j * nx + i;
      if (r.begehbar[c] === 0) continue;
      if (i < nx - 1 && r.begehbar[c + 1] === 1) {
        const kante = c * 2;
        r.kantenKosten[kante] =
          h * 0.5 * (faktor[c] + faktor[c + 1]) + (r.kantenTuer[kante] >= 0 ? tuerZuschlag : 0);
      }
      if (j < ny - 1 && r.begehbar[c + nx] === 1) {
        const kante = c * 2 + 1;
        r.kantenKosten[kante] =
          h * 0.5 * (faktor[c] + faktor[c + nx]) + (r.kantenTuer[kante] >= 0 ? tuerZuschlag : 0);
      }
    }
  }

  sperreLaengsInOeffnung(r, baender);

  return r;
}

/**
 * In der Türöffnung ist nur *quer* erlaubt.
 *
 * **Warum das nötig ist.** Der Zuschlag oben trifft die Kante, die die
 * Wandachse quert — er verteuert das Durchstoßen. Eine Kante, die *längs* der
 * Wand innerhalb der Öffnung läuft, quert die Achse nicht und kostete damit
 * gar nichts. Die Trassierung durfte also durch die Öffnung *hindurchfahren*
 * statt sie zu durchstoßen: die Leitung läge dann in der Schwelle oder in der
 * Zarge. Beides ist kein Rohrweg, sondern ein Bauteil.
 *
 * Gesperrt wird deshalb jede Kante, die innerhalb der Wandstärke der Öffnung
 * längs der Wandachse läuft. Übrig bleiben die Querkanten — und damit
 * zwangsläufig der kürzeste Weg durch die Öffnung, senkrecht zur Wand.
 *
 * Die Sperre kann die Öffnung nicht zumachen: die Durchbindung von Raum zu
 * Raum läuft ausschließlich über Querkanten, und die bleiben unangetastet.
 * Bei dünnen Wänden liegt oft überhaupt keine Zellenmitte in der Wandstärke;
 * dann gibt es auch keine Längskante zu sperren und nichts zu tun.
 */
function sperreLaengsInOeffnung(r: Raster, baender: OeffnungsBand[]): void {
  for (const band of baender) {
    // Längs ist die Rasterrichtung, die der Wandachse näher liegt. Bei genau
    // 45° ist „längs" nicht definiert — dann wird nichts gesperrt, statt
    // beide Richtungen zu sperren und die Öffnung zuzumauern.
    const laengsInX = Math.abs(band.dir.x) > Math.abs(band.dir.y);
    const laengsInY = Math.abs(band.dir.y) > Math.abs(band.dir.x);
    if (!laengsInX && !laengsInY) continue;
    ueberBandZellen(r, band, band.halbdicke, (c) => {
      const i = c % r.nx;
      const j = (c - i) / r.nx;
      if (laengsInX) {
        if (i < r.nx - 1) r.kantenKosten[c * 2] = Infinity;
        if (i > 0) r.kantenKosten[(c - 1) * 2] = Infinity;
      } else {
        if (j < r.ny - 1) r.kantenKosten[c * 2 + 1] = Infinity;
        if (j > 0) r.kantenKosten[(c - r.nx) * 2 + 1] = Infinity;
      }
    });
  }
}

/** Ruft `fn` für jede Zelle auf, deren Mitte im Rechteck des Öffnungsbandes liegt. */
function ueberBandZellen(
  r: Raster,
  band: OeffnungsBand,
  halbdicke: number,
  fn: (zelle: number) => void,
): void {
  // Umschließende des gedrehten Rechtecks.
  const ecken: Vec2[] = [];
  for (const u of [band.von, band.bis]) {
    for (const s of [-halbdicke, halbdicke]) {
      ecken.push({
        x: band.a.x + band.dir.x * u + band.normal.x * s,
        y: band.a.y + band.dir.y * u + band.normal.y * s,
      });
    }
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of ecken) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const i0 = Math.max(0, Math.floor((minX - r.x0) / r.h));
  const i1 = Math.min(r.nx - 1, Math.ceil((maxX - r.x0) / r.h));
  const j0 = Math.max(0, Math.floor((minY - r.y0) / r.h));
  const j1 = Math.min(r.ny - 1, Math.ceil((maxY - r.y0) / r.h));
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const px = r.x0 + i * r.h - band.a.x;
      const py = r.y0 + j * r.h - band.a.y;
      const u = px * band.dir.x + py * band.dir.y;
      if (u < band.von || u > band.bis) continue;
      const s = px * band.normal.x + py * band.normal.y;
      if (s < -halbdicke || s > halbdicke) continue;
      fn(idx(r, i, j));
    }
  }
}

/**
 * Quert die Kante zwischen zwei Zellen die Wandachse innerhalb der lichten
 * Öffnung? Der Schnittpunkt wird exakt bestimmt — das Raster spielt dabei
 * keine Rolle.
 */
function pruefeTuerkante(
  r: Raster,
  band: OeffnungsBand,
  bandIndex: number,
  zelleA: number,
  zelleB: number,
  kante: number,
): void {
  if (r.kantenTuer[kante] >= 0) return;
  const pa = zellMitte(r, zelleA);
  const pb = zellMitte(r, zelleB);
  const sa = (pa.x - band.a.x) * band.normal.x + (pa.y - band.a.y) * band.normal.y;
  const sb = (pb.x - band.a.x) * band.normal.x + (pb.y - band.a.y) * band.normal.y;
  if ((sa > 0 && sb > 0) || (sa < 0 && sb < 0)) return;
  const nenner = sa - sb;
  if (Math.abs(nenner) < 1e-12) return; // Kante liegt in der Wandachse — kein Queren.
  const t = sa / nenner;
  const cx = pa.x + (pb.x - pa.x) * t;
  const cy = pa.y + (pb.y - pa.y) * t;
  const u = (cx - band.a.x) * band.dir.x + (cy - band.a.y) * band.dir.y;
  if (u < band.von || u > band.bis) return;
  r.kantenTuer[kante] = bandIndex;
}

// ===========================================================================
// Wegsuche
// ===========================================================================

/**
 * Richtungen des orthogonalen Rasters. Die Anlaufrichtung wird Teil des
 * Suchzustands, weil sich der Bogenzuschlag sonst nicht korrekt bilden lässt:
 * ob eine Zelle einen Bogen kostet, hängt daran, woher man kommt. Vier
 * Zustände je Zelle sind billiger als jede nachträgliche Glättung, die den
 * gefundenen Weg wieder verlängern würde.
 */
const RICHTUNGEN = [
  { di: 1, dj: 0 },
  { di: 0, dj: 1 },
  { di: -1, dj: 0 },
  { di: 0, dj: -1 },
];

/** Wiederverwendete Puffer eines Suchlaufs. */
interface Suchraum {
  dist: Float64Array;
  vorher: Int32Array;
  heap: MinHeap;
}

/**
 * Dijkstra über (Zelle × Anlaufrichtung).
 *
 * Liefert die Zellenkette von `start` nach `ziel` oder `null`, wenn das Ziel
 * nicht erreichbar ist — etwa weil der Raum keine Türverbindung hat. In
 * diesem Fall wird nichts erfunden; der Aufrufer meldet den Befund.
 */
function suche(
  r: Raster,
  s: Suchraum,
  benutzt: Uint8Array,
  sharedFactor: number,
  bogen: number,
  start: number,
  ziel: number,
): number[] | null {
  if (start === ziel) return [start];
  s.dist.fill(Infinity);
  s.vorher.fill(-1);
  s.heap.leeren();

  // Alle vier Anlaufrichtungen starten kostenfrei: die erste Richtung zu
  // wählen ist kein Richtungswechsel.
  for (let d = 0; d < 4; d++) {
    s.dist[start * 4 + d] = 0;
    s.heap.einfuegen(start * 4 + d, 0);
  }

  let besterZustand = -1;
  while (!s.heap.leer) {
    const { wert, schluessel } = s.heap.entnehmen();
    if (schluessel > s.dist[wert]) continue; // veralteter Eintrag
    const zelle = wert >> 2;
    if (zelle === ziel) {
      besterZustand = wert;
      break; // Dijkstra: der erste Pop des Ziels ist optimal.
    }
    const richtung = wert & 3;
    const i = zelle % r.nx;
    const j = (zelle - i) / r.nx;

    for (let d = 0; d < 4; d++) {
      const ri = RICHTUNGEN[d];
      const ni = i + ri.di;
      const nj = j + ri.dj;
      if (ni < 0 || ni >= r.nx || nj < 0 || nj >= r.ny) continue;
      const nachbar = nj * r.nx + ni;
      // Kantenindex: immer über die kleinere Zelle, damit A→B und B→A
      // dieselbe Kante treffen.
      const kante = d === 0 ? zelle * 2 : d === 1 ? zelle * 2 + 1 : d === 2 ? nachbar * 2 : nachbar * 2 + 1;
      let kosten = r.kantenKosten[kante];
      if (!(kosten < Infinity)) continue;
      // Schon belegte Kante: die Verbilligung lässt die folgenden Wege auf den
      // bereits gefundenen Stamm zulaufen (Steiner-Heuristik, siehe routePipes).
      if (benutzt[kante] === 1) kosten *= sharedFactor;
      // Der Bogen wird *nicht* verbilligt: auch das zweite Rohr braucht im
      // Bogen ein eigenes Formstück.
      if (d !== richtung) kosten += bogen;
      const neu = s.dist[wert] + kosten;
      const zustand = nachbar * 4 + d;
      if (neu < s.dist[zustand]) {
        s.dist[zustand] = neu;
        s.vorher[zustand] = wert;
        s.heap.einfuegen(zustand, neu);
      }
    }
  }

  if (besterZustand < 0) {
    // Das Ziel wurde nie entnommen: prüfen, ob es überhaupt erreicht wurde.
    let best = Infinity;
    for (let d = 0; d < 4; d++) {
      const z = ziel * 4 + d;
      if (s.dist[z] < best) {
        best = s.dist[z];
        besterZustand = z;
      }
    }
    if (besterZustand < 0 || !(best < Infinity)) return null;
  }

  const kette: number[] = [];
  let z = besterZustand;
  while (z >= 0) {
    const zelle = z >> 2;
    if (kette.length === 0 || kette[kette.length - 1] !== zelle) kette.push(zelle);
    z = s.vorher[z];
  }
  kette.reverse();
  return kette;
}

// ===========================================================================
// Nachbereitung
// ===========================================================================

/** Kollineare und doppelte Stützpunkte entfernen — je weniger, desto weniger Bögen. */
function entferneKollinear(punkte: Vec2[], eps = 1e-3): Vec2[] {
  const roh: Vec2[] = [];
  for (const p of punkte) {
    const letzter = roh[roh.length - 1];
    if (letzter && Math.hypot(p.x - letzter.x, p.y - letzter.y) < 1e-6) continue;
    roh.push(p);
  }
  if (roh.length < 3) return roh;
  const out: Vec2[] = [roh[0]];
  for (let i = 1; i < roh.length - 1; i++) {
    const a = out[out.length - 1];
    const b = roh[i];
    const c = roh[i + 1];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const acx = c.x - a.x;
    const acy = c.y - a.y;
    const lac = Math.hypot(acx, acy);
    // Abstand von b zur Geraden a→c. Bleibt er unter eps, ist b überflüssig.
    if (lac > 1e-9 && Math.abs(abx * acy - aby * acx) / lac < eps) continue;
    out.push(b);
  }
  out.push(roh[roh.length - 1]);
  return out;
}

/** Zahl der Richtungswechsel einer Polylinie. */
function richtungswechsel(punkte: Vec2[]): number {
  let n = 0;
  for (let i = 1; i + 1 < punkte.length; i++) {
    const ax = punkte[i].x - punkte[i - 1].x;
    const ay = punkte[i].y - punkte[i - 1].y;
    const bx = punkte[i + 1].x - punkte[i].x;
    const by = punkte[i + 1].y - punkte[i].y;
    const la = Math.hypot(ax, ay);
    const lb = Math.hypot(bx, by);
    if (la < 1e-9 || lb < 1e-9) continue;
    if (Math.abs(ax * by - ay * bx) / (la * lb) > 1e-3) n++;
  }
  return n;
}

function polylinienLaenge(punkte: Vec2[]): number {
  let l = 0;
  for (let i = 1; i < punkte.length; i++) {
    l += Math.hypot(punkte[i].x - punkte[i - 1].x, punkte[i].y - punkte[i - 1].y);
  }
  return l;
}

// ===========================================================================
// Feinjustierung — vom Raster auf den Millimeter
// ===========================================================================

/**
 * **Warum es diese zweite Stufe gibt.**
 *
 * Die Wegsuche beantwortet die Frage „wo entlang". Sie beantwortet sie auf
 * einem Raster, und ein Raster kann eine Leitung nur auf ein Vielfaches
 * seiner Weite legen. Die Frage „wie genau" — sitzt das Rohr an der Wand oder
 * sichtbar daneben — beantwortet sie damit falsch: bei 0,10 m Raster steht
 * die Trasse irgendwo zwischen 0 und 10 cm vor der Wand, je nachdem, wo das
 * Raster zufällig liegt. Auf dem Plan sieht man das sofort, und der Monteur
 * misst es nach.
 *
 * Ein Zentimeterraster wäre die falsche Antwort (zwei Millionen Zellen je
 * Suchlauf über ein Geschoss). Die richtige ist: den *gefundenen* Weg
 * nachziehen. Jedes achsparallele Stück, das an einer Wand entlangläuft,
 * bekommt seinen exakten Sollabstand zur Wandfläche; die Enden setzen sich
 * exakt auf Verteiler und Verbraucher; alles wird auf Millimeter gerundet.
 * Das kostet einen Bruchteil der Wegsuche und liefert die Genauigkeit, die
 * die Wegsuche nie hätte liefern können.
 */
interface Wandflaeche {
  /** Ein Punkt auf der Fläche (lokales System). */
  p: Vec2;
  /** Einheitsrichtung der Fläche — die Wandachse. */
  dir: Vec2;
  /** Einheitsnormale, vom Wandkörper weg zeigend. */
  n: Vec2;
  /** Ausdehnung entlang `dir`, gemessen ab `p`. */
  von: number;
  bis: number;
}

/**
 * Beide Flächen jeder Wand als Geraden im lokalen System.
 *
 * Die Fläche reicht um die halbe Wandstärke über die Achsknoten hinaus: an
 * einem Stoß endet die sichtbare Wandfläche erst in der Flucht der
 * anschließenden Wand, nicht schon am Achsknoten. Ohne diesen Überstand
 * verlöre ein Trassenstück seinen Bezug genau in der Ecke.
 */
function wandflaechen(walls: Wall[], nodes: Record<string, BimNode>): Wandflaeche[] {
  const out: Wandflaeche[] = [];
  for (const wall of walls) {
    const g = getWallGeometry(wall, nodes);
    if (!g) continue;
    for (const seite of [1, -1] as const) {
      out.push({
        p: {
          x: g.a.x + g.normal.x * seite * g.halfThickness,
          y: g.a.y + g.normal.y * seite * g.halfThickness,
        },
        dir: g.dir,
        n: { x: g.normal.x * seite, y: g.normal.y * seite },
        von: -g.halfThickness,
        bis: g.length + g.halfThickness,
      });
    }
  }
  return out;
}

/**
 * Der Versatz quer zur Laufrichtung, mit dem ein Trassenstück auf seinen
 * Sollabstand zur nächsten Wandfläche käme — oder `null`, wenn das Stück gar
 * nicht an einer Wand entlangläuft (dann bleibt es, wo es ist).
 *
 * Bedingungen an die Bezugsfläche: sie muss parallel zum Stück liegen, das
 * Stück muss auf ihrer *Außenseite* liegen (nicht im Wandkörper), sie muss
 * das Stück über mindestens die halbe Länge begleiten — ein Stück, das nur an
 * einem kurzen Wandstummel vorbeikommt, läuft nicht „an der Wand" — und sie
 * muss innerhalb des Fensters liegen, in dem die Rasterquantisierung überhaupt
 * gelandet sein kann.
 */
function versatzZurWand(
  flaechen: Wandflaeche[],
  achse: 0 | 1,
  a: Vec2,
  b: Vec2,
  soll: number,
  fenster: number,
): number | null {
  const laenge = Math.hypot(b.x - a.x, b.y - a.y);
  const mitte = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  // Laufrichtung des Stücks im lokalen System.
  const ux = achse === 0 ? 1 : 0;
  const uy = achse === 0 ? 0 : 1;
  let besterAbstand = Infinity;
  let bestesDelta: number | null = null;
  for (const f of flaechen) {
    if (Math.abs(f.dir.x * uy - f.dir.y * ux) > PARALLEL_TOLERANZ) continue;
    // Anteil der Flächennormalen quer zur Laufrichtung: nur damit lässt sich
    // der Abstand durch Verschieben in der Querachse überhaupt einstellen.
    const nq = achse === 0 ? f.n.y : f.n.x;
    if (Math.abs(nq) < 0.9) continue;
    const abstand = (mitte.x - f.p.x) * f.n.x + (mitte.y - f.p.y) * f.n.y;
    if (abstand < -1e-9 || abstand > fenster || abstand >= besterAbstand) continue;
    const ua = (a.x - f.p.x) * f.dir.x + (a.y - f.p.y) * f.dir.y;
    const ub = (b.x - f.p.x) * f.dir.x + (b.y - f.p.y) * f.dir.y;
    const ueberdeckung = Math.min(Math.max(ua, ub), f.bis) - Math.max(Math.min(ua, ub), f.von);
    if (ueberdeckung < 0.5 * laenge - 1e-9) continue;
    besterAbstand = abstand;
    bestesDelta = (soll - abstand) / nq;
  }
  return bestesDelta;
}

/**
 * Der Versatz, mit dem eine Durchführung aus dem Zargenstreifen der Öffnung
 * herauskäme — oder `null`, wenn sie ohnehin frei liegt.
 *
 * Das Stück steht quer zur Wand; sein Versatz quer zur eigenen Laufrichtung
 * ist also eine Verschiebung *entlang* der Wandachse, und genau darin liegt
 * die Öffnungsbreite.
 */
function versatzAusDerZarge(band: OeffnungsBand, achse: 0 | 1, a: Vec2, b: Vec2): number | null {
  // Anteil der Wandachse quer zur Laufrichtung des Stücks.
  const dq = achse === 0 ? band.dir.y : band.dir.x;
  if (Math.abs(dq) < 0.9) return null;
  const von = band.von + LAIBUNGSABSTAND;
  const bis = band.bis - LAIBUNGSABSTAND;
  if (bis <= von) return null; // Öffnung schmaler als zwei Randstreifen.
  const mitte = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const u = (mitte.x - band.a.x) * band.dir.x + (mitte.y - band.a.y) * band.dir.y;
  const ziel = Math.min(bis, Math.max(von, u));
  return (ziel - u) / dq;
}

/**
 * Feinjustierung aller benutzten Rasterkanten.
 *
 * Ergebnis ist ein Versatz **je Kante**, quer zu ihrer Laufrichtung. Der
 * Versatz wird nicht je Trassenstück, sondern je *zusammenhängendem Lauf* auf
 * einer Rasterlinie bestimmt und dann auf alle Kanten dieses Laufs
 * geschrieben. Das ist der Grund, warum Einzelwege (`legs`) und Abschnitte
 * (`segments`) hinterher deckungsgleich sind: beide bestehen aus Kanten
 * desselben Laufs und erben denselben Versatz. Würde jedes Stück für sich
 * gezogen, klafften an jedem Abzweig zwei Zentimeter Lücke — und die
 * Abzweigerkennung im Rohrausleger, die Punkte auf den Millimeter vergleicht,
 * fände das T-Stück nicht mehr.
 */
function feinjustierung(
  r: Raster,
  benutzt: Uint8Array,
  baender: OeffnungsBand[],
  flaechen: Wandflaeche[],
  soll: number,
  istBegehbar: (p: Vec2) => boolean,
): Float64Array {
  const versatz = new Float64Array(benutzt.length);
  // Kanten nach Rasterlinie sammeln: Schlüssel = Linienindex und Achse.
  const linien = new Map<number, number[]>();
  for (let kante = 0; kante < benutzt.length; kante++) {
    if (benutzt[kante] !== 1) continue;
    const zelle = kante >> 1;
    const achse = kante & 1;
    const i = zelle % r.nx;
    const j = (zelle - i) / r.nx;
    const schluessel = ((achse === 0 ? j : i) << 1) | achse;
    const liste = linien.get(schluessel);
    if (liste) liste.push(achse === 0 ? i : j);
    else linien.set(schluessel, [achse === 0 ? i : j]);
  }

  // Das Fenster, in dem eine Wandfläche noch als Bezug gilt: die Wegsuche kann
  // ein wandnahes Stück nur auf eine Rasterlinie legen und liegt damit
  // höchstens eine Rasterweite neben dem Sollabstand.
  const fenster = soll + r.h;

  for (const [schluessel, laeufe] of linien) {
    const achse = (schluessel & 1) as 0 | 1;
    const linie = schluessel >> 1;
    laeufe.sort((x, y) => x - y);
    let start = laeufe[0];
    let vorher = start;
    const abschliessen = (ende: number): void => {
      // Kanten des Laufs einsammeln und prüfen, ob eine davon eine Öffnung quert.
      const kanten: number[] = [];
      let bandIndex = -1;
      for (let l = start; l <= ende; l++) {
        const zelle = achse === 0 ? linie * r.nx + l : l * r.nx + linie;
        const kante = zelle * 2 + achse;
        kanten.push(kante);
        if (bandIndex < 0 && r.kantenTuer[kante] >= 0) bandIndex = r.kantenTuer[kante];
      }
      const a = zellMitte(r, achse === 0 ? linie * r.nx + start : start * r.nx + linie);
      const b = zellMitte(r, achse === 0 ? linie * r.nx + ende + 1 : (ende + 1) * r.nx + linie);
      /*
       * Ein Lauf durch eine Öffnung wird *nicht* an eine Wandfläche gezogen:
       * er steht quer zur Wand, und ihn an die nächste Fläche zu ziehen hieße,
       * ihn längs der Öffnung in die Zarge zu schieben — genau das, was
       * verhindert werden soll. Er bekommt stattdessen die eine Korrektur, die
       * für eine Durchführung zählt: heraus aus dem Randstreifen der Laibung.
       */
      const delta =
        bandIndex >= 0
          ? versatzAusDerZarge(baender[bandIndex], achse, a, b)
          : versatzZurWand(flaechen, achse, a, b, soll, fenster);
      // Die Trasse darf nicht durch eine Wand geschoben werden: liegt auch nur
      // ein Punkt des gezogenen Stücks außerhalb des begehbaren Bereichs,
      // bleibt das Stück, wo es war.
      if (delta !== null && Math.abs(delta) > 1e-9 && stueckBegehbar(a, b, achse, delta, r.h, istBegehbar)) {
        for (const kante of kanten) versatz[kante] = delta;
      }
    };
    for (let n = 1; n < laeufe.length; n++) {
      if (laeufe[n] === vorher + 1) {
        vorher = laeufe[n];
        continue;
      }
      abschliessen(vorher);
      start = laeufe[n];
      vorher = laeufe[n];
    }
    abschliessen(vorher);
  }
  return versatz;
}

/** Liegt das um `delta` verschobene Stück durchgehend im begehbaren Bereich? */
function stueckBegehbar(
  a: Vec2,
  b: Vec2,
  achse: 0 | 1,
  delta: number,
  h: number,
  istBegehbar: (p: Vec2) => boolean,
): boolean {
  const laenge = Math.hypot(b.x - a.x, b.y - a.y);
  // Eine Probe je Rasterweite: feiner kann der begehbare Bereich zwischen zwei
  // Proben gar nicht wechseln, denn er ist aus Raumpolygonen zusammengesetzt,
  // die um ein Vielfaches gröber sind. Die Deckelung hält die Kosten linear.
  const schritte = Math.max(1, Math.min(64, Math.ceil(laenge / h)));
  for (let s = 0; s <= schritte; s++) {
    const t = s / schritte;
    const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    if (achse === 0) p.y += delta;
    else p.x += delta;
    if (!istBegehbar(p)) return false;
  }
  return true;
}

/**
 * Der feinjustierte Punkt einer Rasterzelle.
 *
 * Der Versatz der x-laufenden Kante an dieser Zelle verschiebt y, der der
 * y-laufenden verschiebt x — an einer Ecke greifen beide, und die Ecke bleibt
 * dadurch geschlossen. Zwei benutzte Kanten derselben Achse an einer Zelle
 * gehören zwangsläufig demselben Lauf an und tragen denselben Versatz; welche
 * von beiden gelesen wird, ist deshalb gleichgültig.
 */
/**
 * Der begehbare Bereich, exakt statt gerastert.
 *
 * Die Feinjustierung verschiebt um Zentimeter — das Raster sähe eine solche
 * Verschiebung gar nicht, weil sie die Zelle meist nicht wechselt. Geprüft
 * wird deshalb gegen die Polygone selbst. Die Umschließende je Raum spart den
 * teuren Polygontest für fast alle Proben; der zuletzt treffende Raum wird
 * zuerst versucht, weil aufeinanderfolgende Proben eines Trassenstücks fast
 * immer im selben Raum liegen.
 */
function begehbarkeitstest(rooms: Room[], baender: OeffnungsBand[]): (p: Vec2) => boolean {
  const kaesten = rooms.map((room) => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const q of room.innerPolygon) {
      if (q.x < minX) minX = q.x;
      if (q.y < minY) minY = q.y;
      if (q.x > maxX) maxX = q.x;
      if (q.y > maxY) maxY = q.y;
    }
    return { poly: room.innerPolygon, minX, minY, maxX, maxY };
  });
  let zuletzt = 0;
  return (p: Vec2): boolean => {
    for (let n = 0; n < kaesten.length; n++) {
      const k = kaesten[(zuletzt + n) % kaesten.length];
      if (p.x < k.minX || p.x > k.maxX || p.y < k.minY || p.y > k.maxY) continue;
      if (pointInPolygon(p, k.poly)) {
        zuletzt = (zuletzt + n) % kaesten.length;
        return true;
      }
    }
    // Die lichte Öffnung gehört zu keinem Raumpolygon, ist aber begehbar —
    // sonst gälte jede Durchführung als „durch die Wand geschoben".
    for (const band of baender) {
      const px = p.x - band.a.x;
      const py = p.y - band.a.y;
      const u = px * band.dir.x + py * band.dir.y;
      if (u < band.von || u > band.bis) continue;
      const s = px * band.normal.x + py * band.normal.y;
      if (s >= -band.halbdicke && s <= band.halbdicke) return true;
    }
    return false;
  };
}

function zellPunkt(r: Raster, benutzt: Uint8Array, versatz: Float64Array, zelle: number): Vec2 {
  const i = zelle % r.nx;
  const j = (zelle - i) / r.nx;
  let dx = 0;
  let dy = 0;
  if (i < r.nx - 1 && benutzt[zelle * 2] === 1) dy = versatz[zelle * 2];
  else if (i > 0 && benutzt[(zelle - 1) * 2] === 1) dy = versatz[(zelle - 1) * 2];
  if (j < r.ny - 1 && benutzt[zelle * 2 + 1] === 1) dx = versatz[zelle * 2 + 1];
  else if (j > 0 && benutzt[(zelle - r.nx) * 2 + 1] === 1) dx = versatz[(zelle - r.nx) * 2 + 1];
  return { x: r.x0 + i * r.h + dx, y: r.y0 + j * r.h + dy };
}

// ===========================================================================
// Hauptfunktion
// ===========================================================================

export function routePipes(request: RoutingRequest): RoutedNetwork {
  const notes: PlanningNote[] = [];
  const legs: RoutedLeg[] = [];
  const segments: { from: Vec2; to: Vec2; targets: string[] }[] = [];

  const mode = request.mode;
  const sharedFactor = Math.min(1, Math.max(0.01, request.sharedFactor ?? TEILUNG_STANDARD));
  const rooms = request.rooms.filter(
    (r) => r.levelId === request.levelId && r.innerPolygon.length >= 3,
  );

  if (rooms.length === 0) {
    notes.push({
      severity: 'error',
      text:
        `Keine Räume im Geschoss „${request.levelId}" — ohne lichte Raumflächen gibt es ` +
        'keine begehbare Fläche und damit keine Trasse. Zuerst die Raumerkennung laufen lassen.',
    });
    return { legs, segments, notes };
  }
  if (request.targets.length === 0) {
    notes.push({ severity: 'warn', text: 'Keine Verbraucher übergeben — nichts zu trassieren.' });
    return { legs, segments, notes };
  }

  // --- Lokales, an der dominanten Wandrichtung ausgerichtetes System ------
  const wallsHier = request.walls.filter((w) => w.levelId === request.levelId);
  const theta = dominanteRichtung(wallsHier, request.nodes);
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  /** Welt → lokal (Drehung um −θ). */
  const nachLokal = (p: Vec2): Vec2 => ({ x: p.x * cos + p.y * sin, y: -p.x * sin + p.y * cos });
  /** Lokal → Welt (Drehung um +θ), auf Millimeter gerundet. */
  const nachWelt = (p: Vec2): Vec2 => ({
    x: round(p.x * cos - p.y * sin, 3),
    y: round(p.x * sin + p.y * cos, 3),
  });

  const raeumeLokal: Room[] = rooms.map((r) => ({ ...r, innerPolygon: r.innerPolygon.map(nachLokal) }));
  const knotenLokal: Record<string, BimNode> = {};
  for (const [id, n] of Object.entries(request.nodes)) {
    const p = nachLokal(n);
    knotenLokal[id] = { ...n, x: p.x, y: p.y };
  }
  const quelleLokal = nachLokal(request.source);
  const zieleLokal = request.targets.map((t) => ({ id: t.id, position: nachLokal(t.position) }));

  // --- Öffnungsbänder ----------------------------------------------------
  // Nur Türen und Durchgänge verbinden; ein Fenster ist keine Verbindung.
  const wandNachId = new Map<string, Wall>();
  for (const w of wallsHier) wandNachId.set(w.id, w);
  const baender: OeffnungsBand[] = [];
  for (const opening of request.openings) {
    if (opening.kind !== 'door' && opening.kind !== 'passage') continue;
    const wall = wandNachId.get(opening.wallId);
    if (!wall) continue;
    const g = getWallGeometry(wall, knotenLokal);
    if (!g) continue;
    const span = openingSpan(g, opening);
    if (span.to - span.from <= 1e-6) continue;
    baender.push({
      opening,
      a: g.a,
      dir: g.dir,
      normal: g.normal,
      von: span.from,
      bis: span.to,
      halbdicke: g.halfThickness,
    });
  }
  if (baender.length === 0 && rooms.length > 1) {
    notes.push({
      severity: 'warn',
      text:
        'Kein Türdurchgang und kein Durchgang im Geschoss gefunden. Die Räume sind ' +
        'damit unverbunden; Ziele in anderen Räumen sind nicht erreichbar.',
    });
  }

  // --- Rasterweite -------------------------------------------------------
  let h = Math.min(1, Math.max(0.05, request.grid ?? RASTER_STANDARD));
  {
    // Grobabschätzung der Zellenzahl, bevor das Feld angelegt wird.
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const room of raeumeLokal) {
      for (const p of room.innerPolygon) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
    }
    const flaeche = (maxX - minX + 4 * h) * (maxY - minY + 4 * h);

    /*
     * Die Vorbelegung richtet sich nach der Größe der Aufgabe.
     *
     * Die Laufzeit hängt am Produkt aus Zellenzahl und Zahl der Suchläufe.
     * Ein feines Raster, das auf einer Wohnung in Sekundenbruchteilen läuft,
     * hält ein ganzes Geschossriegel-Grundriss mit sechzig Heizkörpern
     * spürbar auf. Statt eine Weite zu wählen, die überall passt (und damit
     * überall zu grob ist), wird sie hier aus der Aufgabe abgeleitet — nach
     * unten nur bis zur früheren Vorbelegung, bis zu der die Wegfindung
     * erprobt ist. Das ist *keine* Meldung wert: es ist die Vorbelegung, die
     * sich anpasst, nicht ein Wunsch des Aufrufers, der übergangen wird.
     */
    if (request.grid === undefined) {
      const aufwand = (flaeche / (h * h)) * request.targets.length;
      if (aufwand > AUFWAND_MAX) {
        h = Math.min(RASTER_GROB, round(h * Math.sqrt(aufwand / AUFWAND_MAX), 3));
      }
    }

    const zellen = flaeche / (h * h);
    if (zellen > ZELLEN_MAX) {
      const neu = round(h * Math.sqrt(zellen / ZELLEN_MAX), 3);
      notes.push({
        severity: 'warn',
        text:
          `Rasterweite von ${de(h)} m auf ${de(neu)} m vergröbert — bei der gewünschten ` +
          `Weite entstünden über ${ZELLEN_MAX.toLocaleString('de-DE')} Zellen und die ` +
          'Trassierung würde die Auslegung spürbar aufhalten.',
      });
      h = neu;
    }
  }

  const raster = baueRaster(
    raeumeLokal,
    baender,
    [quelleLokal, ...zieleLokal.map((t) => t.position)],
    h,
    mode,
  );

  // --- Quelle und Ziele auf begehbare Zellen ziehen -----------------------
  const fangen = (p: Vec2): number => {
    const i0 = Math.round((p.x - raster.x0) / raster.h);
    const j0 = Math.round((p.y - raster.y0) / raster.h);
    const ringe = Math.ceil(FANGRADIUS / raster.h);
    let beste = -1;
    let besterAbstand = Infinity;
    for (let ring = 0; ring <= ringe; ring++) {
      for (let dj = -ring; dj <= ring; dj++) {
        for (let di = -ring; di <= ring; di++) {
          // Nur der neue Ring, die inneren wurden schon geprüft.
          if (ring > 0 && Math.max(Math.abs(di), Math.abs(dj)) !== ring) continue;
          const i = i0 + di;
          const j = j0 + dj;
          if (i < 0 || i >= raster.nx || j < 0 || j >= raster.ny) continue;
          const c = j * raster.nx + i;
          if (raster.begehbar[c] === 0) continue;
          const m = zellMitte(raster, c);
          const abstand = Math.hypot(m.x - p.x, m.y - p.y);
          if (abstand < besterAbstand) {
            besterAbstand = abstand;
            beste = c;
          }
        }
      }
      // Sobald im Ring etwas gefunden wurde, kann ein weiterer Ring nur noch
      // Schlechteres liefern — ein Ring Sicherheitsabstand genügt.
      if (beste >= 0 && besterAbstand <= ring * raster.h) break;
    }
    return besterAbstand <= FANGRADIUS ? beste : -1;
  };

  const quellZelle = fangen(quelleLokal);
  if (quellZelle < 0) {
    notes.push({
      severity: 'error',
      text:
        `Der Verteiler bei (${de(request.source.x)} | ${de(request.source.y)}) liegt in keinem ` +
        `Raum und auch nicht innerhalb von ${de(FANGRADIUS)} m einer Raumfläche. ` +
        'Ohne Ausgangspunkt gibt es keine Trasse.',
    });
    return { legs, segments, notes };
  }

  // --- Ziele absteigend nach Entfernung ---------------------------------
  // Der weiteste Verbraucher legt den Stamm; die näheren hängen sich daran.
  // Umgekehrt entstünde ein Stern statt eines Baumes.
  const reihenfolge = zieleLokal
    .map((t, i) => ({ t, i, d: Math.hypot(t.position.x - quelleLokal.x, t.position.y - quelleLokal.y) }))
    .sort((a, b) => b.d - a.d || a.i - b.i);

  const anzahlZellen = raster.begehbar.length;
  const suchraum: Suchraum = {
    dist: new Float64Array(anzahlZellen * 4),
    vorher: new Int32Array(anzahlZellen * 4),
    heap: new MinHeap(Math.max(64, anzahlZellen)),
  };
  const benutzt = new Uint8Array(anzahlZellen * 2);
  const bogen = mode === 'sanierung' ? BOGEN_SANIERUNG : BOGEN_NEUBAU;

  /** Kante → Verbraucher, die darüber versorgt werden. */
  const kantenZiele = new Map<number, string[]>();
  /** Ziel-Kennung → gefangene Zelle, für die Stichstrecke am Ende. */
  const zielZellen = new Map<string, number>();
  const erreichteZiele: string[] = [];
  /**
   * Die gefundenen Zellenketten. Die Polylinien entstehen erst *nach* dem
   * letzten Suchlauf — die Feinjustierung braucht das fertige Netz, weil sie
   * je zusammenhängendem Lauf zieht und nicht je Einzelweg.
   */
  const ketten: { id: string; kette: number[]; weltPos: Vec2; tueren: string[] }[] = [];

  for (const eintrag of reihenfolge) {
    const zielZelle = fangen(eintrag.t.position);
    const welt = request.targets.find((t) => t.id === eintrag.t.id);
    const weltPos = welt ? welt.position : { x: 0, y: 0 };
    if (zielZelle < 0) {
      notes.push({
        severity: 'error',
        text:
          `Verbraucher „${eintrag.t.id}" bei (${de(weltPos.x)} | ${de(weltPos.y)}) liegt in ` +
          `keinem Raum und auch nicht innerhalb von ${de(FANGRADIUS)} m einer Raumfläche — ` +
          'keine Trasse ermittelt.',
      });
      continue;
    }

    const kette = suche(raster, suchraum, benutzt, sharedFactor, bogen, quellZelle, zielZelle);
    if (!kette) {
      notes.push({
        severity: 'error',
        text:
          `Verbraucher „${eintrag.t.id}" ist vom Verteiler aus nicht erreichbar. Der Raum ` +
          'hat keine Tür- oder Durchgangsverbindung zum übrigen Grundriss — keine Trasse ' +
          'ermittelt.',
      });
      continue;
    }

    // Kanten belegen und dem Verbraucher zuordnen.
    const tueren: string[] = [];
    for (let n = 1; n < kette.length; n++) {
      const a = kette[n - 1];
      const b = kette[n];
      const diff = b - a;
      const kante = diff === 1 ? a * 2 : diff === -1 ? b * 2 : diff > 0 ? a * 2 + 1 : b * 2 + 1;
      benutzt[kante] = 1;
      const liste = kantenZiele.get(kante);
      if (liste) liste.push(eintrag.t.id);
      else kantenZiele.set(kante, [eintrag.t.id]);
      const bandIndex = raster.kantenTuer[kante];
      if (bandIndex >= 0) {
        const id = baender[bandIndex].opening.id;
        if (!tueren.includes(id)) tueren.push(id);
      }
    }

    ketten.push({ id: eintrag.t.id, kette, weltPos, tueren });
    zielZellen.set(eintrag.t.id, zielZelle);
    erreichteZiele.push(eintrag.t.id);
  }

  // --- Feinjustierung ----------------------------------------------------
  // Erst jetzt, mit dem fertigen Netz: die Trassenstücke auf ihren exakten
  // Sollabstand zur Wandfläche ziehen (siehe `feinjustierung`).
  const flaechen = wandflaechen(wallsHier, knotenLokal);
  const istBegehbar = begehbarkeitstest(raeumeLokal, baender);
  const versatz = feinjustierung(
    raster,
    benutzt,
    baender,
    flaechen,
    mode === 'sanierung' ? SOLLABSTAND_SANIERUNG : SOLLABSTAND_NEUBAU,
    istBegehbar,
  );
  const punktVon = (zelle: number): Vec2 => zellPunkt(raster, benutzt, versatz, zelle);

  // --- Einzelwege --------------------------------------------------------
  for (const eintrag of ketten) {
    // Zellenkette → Polylinie: erst kollineare Rasterpunkte weg, dann in die
    // Welt drehen, dann die exakten Anschlusspunkte davor und dahinter.
    const lokal = entferneKollinear(eintrag.kette.map(punktVon), 1e-6);
    const punkte = entferneKollinear([
      mm(request.source),
      ...lokal.map(nachWelt),
      mm(eintrag.weltPos),
    ]);

    legs.push({
      targetId: eintrag.id,
      points: punkte,
      length: round(polylinienLaenge(punkte), 3),
      bends: richtungswechsel(punkte),
      doorCrossings: eintrag.tueren,
    });
  }

  // --- Abschnitte --------------------------------------------------------
  segments.push(
    ...baueAbschnitte(raster, kantenZiele, punktVon, nachWelt),
    ...stichstrecken(request, quellZelle, zielZellen, erreichteZiele, punktVon, nachWelt),
  );

  // --- Befunde -----------------------------------------------------------
  notes.push(...befunde(mode, legs, baender, sharedFactor, h, theta));

  // Die Legs sind nach absteigender Entfernung entstanden; für den Aufrufer
  // ist die Reihenfolge der Eingabe die erwartbare.
  const rang = new Map(request.targets.map((t, i) => [t.id, i]));
  legs.sort((a, b) => (rang.get(a.targetId) ?? 0) - (rang.get(b.targetId) ?? 0));

  return { legs, segments, notes };
}

/**
 * Rasterkanten zu Abschnitten zusammenfassen.
 *
 * Zusammengefasst wird nur, was *dieselben* Verbraucher versorgt und in
 * derselben Achse liegt. Damit bricht ein Abschnitt genau dort, wo ein Strang
 * abzweigt — und genau dort ändert sich der Volumenstrom. Ein Abschnitt kommt
 * dadurch einmal vor und nennt alle Verbraucher, die über ihn laufen; A→B und
 * B→A sind dieselbe Kante, weil der Kantenindex immer über die kleinere Zelle
 * gebildet wird.
 */
function baueAbschnitte(
  raster: Raster,
  kantenZiele: Map<number, string[]>,
  punktVon: (zelle: number) => Vec2,
  nachWelt: (p: Vec2) => Vec2,
): { from: Vec2; to: Vec2; targets: string[] }[] {
  // Gruppenschlüssel: Achse, feste Rasterlinie, Verbrauchermenge.
  const gruppen = new Map<string, { lauf: number[]; targets: string[] }>();
  for (const [kante, ziele] of kantenZiele) {
    const zelle = kante >> 1;
    const achse = kante & 1; // 0 = in x, 1 = in y
    const i = zelle % raster.nx;
    const j = (zelle - i) / raster.nx;
    const sortiert = [...new Set(ziele)].sort();
    const schluessel = `${achse}|${achse === 0 ? j : i}|${sortiert.join('')}`;
    const eintrag = gruppen.get(schluessel);
    const lauf = achse === 0 ? i : j;
    if (eintrag) eintrag.lauf.push(lauf);
    else gruppen.set(schluessel, { lauf: [lauf], targets: sortiert });
  }

  const out: { from: Vec2; to: Vec2; targets: string[] }[] = [];
  for (const [schluessel, eintrag] of gruppen) {
    const [achseText, festText] = schluessel.split('|');
    const achse = Number(achseText);
    const fest = Number(festText);
    eintrag.lauf.sort((a, b) => a - b);
    let start = eintrag.lauf[0];
    let vorher = start;
    const schliessen = (ende: number): void => {
      const from =
        achse === 0 ? punktVon(idx(raster, start, fest)) : punktVon(idx(raster, fest, start));
      const to =
        achse === 0 ? punktVon(idx(raster, ende + 1, fest)) : punktVon(idx(raster, fest, ende + 1));
      out.push({ from: nachWelt(from), to: nachWelt(to), targets: [...eintrag.targets] });
    };
    for (let n = 1; n < eintrag.lauf.length; n++) {
      const l = eintrag.lauf[n];
      if (l === vorher + 1) {
        vorher = l;
        continue;
      }
      schliessen(vorher);
      start = l;
      vorher = l;
    }
    schliessen(vorher);
  }
  return out;
}

/**
 * Anschlussstücke zwischen den exakten Punkten und der Rastermitte.
 *
 * Sie gehören in `segments`, weil sonst der Volumenstrom am Verteiler und am
 * Verbraucher fehlte. Das Stück am Verteiler trägt alle erreichten Ziele.
 */
function stichstrecken(
  request: RoutingRequest,
  quellZelle: number,
  zielZellen: Map<string, number>,
  erreichteZiele: string[],
  punktVon: (zelle: number) => Vec2,
  nachWelt: (p: Vec2) => Vec2,
): { from: Vec2; to: Vec2; targets: string[] }[] {
  const out: { from: Vec2; to: Vec2; targets: string[] }[] = [];
  if (erreichteZiele.length === 0) return out;

  // Die Anschlusspunkte selbst sind exakt: hier wird nichts gerastert, nur auf
  // Millimeter gerundet.
  const quelle = mm(request.source);
  const quellMitte = nachWelt(punktVon(quellZelle));
  if (Math.hypot(quellMitte.x - quelle.x, quellMitte.y - quelle.y) > 1e-6) {
    out.push({
      from: quelle,
      to: quellMitte,
      targets: [...erreichteZiele].sort(),
    });
  }
  for (const target of request.targets) {
    const zelle = zielZellen.get(target.id);
    if (zelle === undefined) continue;
    const ziel = mm(target.position);
    const mitte = nachWelt(punktVon(zelle));
    if (Math.hypot(mitte.x - ziel.x, mitte.y - ziel.y) <= 1e-6) continue;
    out.push({ from: mitte, to: ziel, targets: [target.id] });
  }
  return out;
}

/** Hinweise zu Verlegeart, Durchgängen und den benutzten Parametern. */
function befunde(
  mode: PipeRoutingMode,
  legs: RoutedLeg[],
  baender: OeffnungsBand[],
  sharedFactor: number,
  h: number,
  theta: number,
): PlanningNote[] {
  const notes: PlanningNote[] = [];

  if (mode === 'sanierung') {
    notes.push({
      severity: 'info',
      text:
        'Verlegeart Sanierung: Trasse an der Wand im Sockelleistenkanal. Der handelsübliche ' +
        `Kanal misst ${KANAL_QUERSCHNITT_MM.tiefe} × ${KANAL_QUERSCHNITT_MM.hoehe} mm und nimmt ` +
        `Rohre bis ${KANAL_QUERSCHNITT_MM.maxRohrAussen} mm Außendurchmesser auf ` +
        '(OBO-Sockelleistenkanal, REHAU RAUDUO). Größere Dimensionen passen nicht — die ' +
        'Rohrweitenbestimmung muss das als Obergrenze führen.',
    });

    // Jeden Durchgang genau einmal melden, mit den Verbrauchern, die ihn nutzen.
    const proTuer = new Map<string, string[]>();
    for (const leg of legs) {
      for (const id of leg.doorCrossings) {
        const liste = proTuer.get(id);
        if (liste) liste.push(leg.targetId);
        else proTuer.set(id, [leg.targetId]);
      }
    }
    for (const [openingId, unsortiert] of proTuer) {
      const ziele = [...unsortiert].sort();
      const band = baender.find((b) => b.opening.id === openingId);
      const istTuer = band?.opening.kind === 'door';
      const breite = band ? band.bis - band.von : 0;
      notes.push({
        severity: 'warn',
        text:
          (istTuer
            ? 'Türdurchgang — Bodendurchführung oder Zargenumfahrung vor Ort entscheiden. '
            : 'Wanddurchgang ohne Tür — Bodendurchführung oder Umfahrung vor Ort entscheiden. ') +
          `Öffnung „${openingId}" (lichte Breite ${de(breite)} m), betrifft ${ziele.length} ` +
          `Verbraucher (${ziele.join(', ')}). Der Sockelleistenkanal kann die Öffnung nicht ` +
          'durchlaufen. Hierzu gibt es keine Fachregel: die Wahl hängt an Bodenaufbau, Zarge ' +
          'und Optik und ist ausdrücklich eine Anwenderentscheidung. Die Trassierung hat den ' +
          `Durchgang mit einem Ersatzweg von ${de(TUER_ZUSCHLAG)} m bewertet — das ist mehr ` +
          'als der übliche Umweg um einen Raum — und ihn nur gewählt, weil jeder Umweg noch ' +
          'teurer gewesen wäre. Die Trasse durchstößt die Öffnung quer auf kürzestem Weg; ' +
          'längs in der Öffnung, also in Schwelle oder Zarge, liegt kein Rohr.',
      });
    }
  } else {
    notes.push({
      severity: 'info',
      text:
        'Verlegeart Neubau: Trasse auf der Rohdecke im Fußbodenaufbau, wandparallel geführt ' +
        `(IKZ „Rohrleitungen im Fußbodenaufbau"). Abstand zur Wandfläche ${de(SOLLABSTAND_NEUBAU * 1000, 0)} mm, ` +
        'damit kein Rohr in der Randfuge liegt — DIN EN 1264-4 nennt diesen Wert für ' +
        'Flächenheizrohre gegenüber senkrechten Bauteilen; für Anbindeleitungen ist er der ' +
        'nächstliegende belegbare Anhalt, kein unmittelbar einschlägiger Wert. Türöffnungen ' +
        'sind hier unkritisch — die Leitung läuft unter der Schwelle durch; sie werden quer ' +
        'durchstoßen und sind in `doorCrossings` aufgeführt, weil dort die Aufbauhöhe und die ' +
        'Estrich-Bewegungsfuge zu prüfen sind.',
    });
  }

  const gesamt = legs.reduce((s, l) => s + l.length, 0);
  const bogenSumme = legs.reduce((s, l) => s + l.bends, 0);
  const soll = mode === 'sanierung' ? SOLLABSTAND_SANIERUNG : SOLLABSTAND_NEUBAU;
  notes.push({
    severity: 'info',
    text:
      `Trassierung: ${legs.length} Verbraucher, ${de(gesamt)} m Einzelweglänge, ${bogenSumme} ` +
      `Richtungswechsel. Raster ${de(h, 3)} m` +
      (theta !== 0 ? `, um ${de((theta * 180) / Math.PI, 1)}° an die Wandrichtung gedreht` : '') +
      `, gemeinsam benutzte Kanten mit Faktor ${de(sharedFactor, 2)} bewertet. Die ` +
      'Zusammenführung auf einen gemeinsamen Stamm ist eine Heuristik (verbilligte Kanten), ' +
      'kein exakt minimaler Steiner-Baum — der ist NP-schwer und für die Auslegung nicht nötig.',
  });
  notes.push({
    severity: 'info',
    text:
      `Feinjustierung: Das Raster von ${de(h, 3)} m bestimmt nur den Weg. Die Lage der ` +
      `wandparallelen Trassenstücke ist auf ${de(soll * 1000, 0)} mm Achsabstand zur ` +
      'Wandfläche nachgezogen, die Enden sitzen exakt auf Verteiler und Verbraucher, alle ' +
      'Koordinaten sind auf Millimeter gerundet. Ein Stück, das dabei aus dem begehbaren ' +
      'Bereich liefe, bleibt ungezogen — die Feinjustierung schiebt keine Leitung in eine Wand.',
  });

  return notes;
}
