/**
 * Von einem Raumnamen auf seine Nutzung schließen.
 * ---------------------------------------------------------------------------
 * Ein Raum, der „Bad" heißt, wird nach DIN EN 12831 mit 24 °C gerechnet,
 * einer, der „Flur" heißt, mit 15 °C. Der Unterschied ist keine Feinheit:
 * über eine Wohnung gerechnet trennen die beiden Annahmen zweistellige
 * Prozente der Heizlast — und damit die Baugröße des Geräts.
 *
 * Einen Namen gibt es reichlich: die IFC-Datei des Architekten liefert ihn
 * (`IfcSpace.LongName`), der RoomPlan-Scan liefert ihn, und der Handwerker
 * tippt ihn ohnehin. Eine Nutzung liefert **keine** dieser Quellen. Also
 * wird sie aus dem Namen erschlossen, und der Nutzer korrigiert, wo es
 * danebengeht.
 *
 * **Zwei Regeln, und sie ziehen in verschiedene Richtungen.**
 *
 * *Innerhalb* eines Wortes entscheidet der rechte Teil. Deutsche
 * Zusammensetzungen tragen ihre Bedeutung hinten — ein *Kellerflur* ist ein
 * Flur, kein Keller, ein *Gästebad* ein Bad, ein *Dachgeschossbüro* ein
 * Büro. Gesucht wird deshalb das Stichwort, dessen Treffer am weitesten
 * rechts endet; bei gleichem Ende gewinnt das längere Stichwort.
 *
 * *Zwischen* Wörtern entscheidet das **erste**. Raumschilder werden nach
 * dem Muster „Art, dann Lage" beschriftet: „Flur Keller West", „WC Damen",
 * „Büro Studenten III", „Labor K2". Das erste Wort sagt, was der Raum ist,
 * die folgenden sagen, welcher davon.
 *
 * Beides zusammen zu ignorieren rächt sich sofort. Am Institutsgebäude des
 * KIT wurde „Flur Keller West" ohne die zweite Regel zum *Abstellraum*,
 * weil „Keller" weiter rechts steht als „Flur" — ein Flur mit 15 °C und
 * Überströmung wäre zum Lager ohne Lüftung geworden.
 *
 * **Die Ausnahmen davor.** Ein paar Wörter meinen etwas anderes als ihr
 * rechter Teil. Eine *Waschküche* ist keine Küche, sondern ein
 * Hauswirtschaftsraum; ein *Heizungskeller* ist kein Abstellraum. Solche
 * Festfügungen stehen als Ganzes in einer eigenen Liste, die vorher
 * geprüft wird.
 *
 * **Was bewusst nicht erkannt wird.** „Galerie", „Zimmer", „Raum",
 * „Bereich" — Namen, die nichts über die Nutzung sagen. Sie bleiben
 * `other`, und `other` heißt in der Anwendung sichtbar „bitte einstufen".
 * Ein falsch geratener Raum ist schlechter als ein offen unbestimmter: den
 * unbestimmten sieht man in der Prüfliste, den falsch geratenen nicht.
 */

import type { RoomUsage, Vec2 } from '../types/bim';

/** Umlaute und Sonderzeichen vereinheitlichen, damit „Buero" und „Büro" gleich sind. */
export function normalisiere(name: string): string {
  return name
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Festfügungen, die als Ganzes etwas anderes meinen als ihr rechter Teil.
 * Geprüft wird auf Vorkommen im normalisierten Namen.
 */
const FESTE_WENDUNGEN: Array<[string, RoomUsage]> = [
  ['waschkueche', 'technical'],
  ['heizungskeller', 'technical'],
  ['heizungsraum', 'technical'],
  ['hauswirtschaftsraum', 'technical'],
  ['technikzentrale', 'technical'],
  ['wohnkueche', 'kitchen'],
  ['teekueche', 'kitchen'],
];

/**
 * Stichwörter je Nutzung.
 *
 * Deutsch und Englisch nebeneinander, weil eine IFC-Datei beides führen
 * kann — dieselbe Vorlage wird in beiden Sprachen ausgeliefert.
 */
const STICHWORTE: Record<Exclude<RoomUsage, 'other'>, string[]> = {
  bath: ['bad', 'badezimmer', 'duschbad', 'dusche', 'bathroom', 'shower'],
  wc: ['wc', 'toilette', 'klo', 'toilet', 'restroom', 'lavatory'],
  kitchen: ['kueche', 'kochen', 'kitchen', 'pantry'],
  bedroom: [
    'schlafzimmer', 'schlafen', 'schlafraum', 'kinderzimmer', 'gaestezimmer',
    'bedroom', 'guestroom',
  ],
  living: [
    'wohnen', 'wohnzimmer', 'wohnraum', 'esszimmer', 'essen', 'esszimmerbereich',
    'wintergarten', 'living', 'livingroom', 'diningroom', 'dining', 'salon',
  ],
  // Seminar-, Hör- und Unterrichtsräume stehen hier, nicht in einer eigenen
  // Nutzung: für die Heizlast sind sie Aufenthaltsräume mit 20 °C wie ein
  // Büro. Der *innere Wärmegewinn* durch viele Menschen unterscheidet sie —
  // den führt die Heizlast nach DIN EN 12831 ohnehin nicht an.
  office: [
    'buero', 'arbeitszimmer', 'arbeiten', 'labor', 'werkstatt', 'besprechung',
    'besprechungsraum', 'seminar', 'seminarraum', 'hoersaal', 'unterricht',
    'klassenzimmer', 'schulungsraum',
    'office', 'study', 'laboratory', 'meeting', 'classroom', 'lecture',
  ],
  hallway: [
    'flur', 'diele', 'korridor', 'gang', 'treppenhaus', 'treppe', 'windfang',
    'eingang', 'vorraum', 'hallway', 'corridor', 'stair', 'staircase', 'lobby',
    'entrance',
  ],
  storage: [
    'abstellraum', 'abstell', 'lager', 'speisekammer', 'vorratsraum', 'vorrat',
    'keller', 'archiv', 'garderobe', 'storage', 'store', 'storeroom', 'closet',
  ],
  technical: [
    'technik', 'technikraum', 'heizung', 'haustechnik', 'hauswirtschaft', 'hwr',
    'hausanschlussraum', 'serverraum', 'technical', 'plant', 'boiler',
    'mechanical', 'utility',
  ],
};

/**
 * Nutzung aus einem Raumnamen erschließen.
 *
 * Gibt `undefined` zurück, wenn der Name nichts hergibt — das ist etwas
 * anderes als `'other'` und lässt den Aufrufer entscheiden, ob er eine
 * vorhandene Einstufung überschreibt.
 */
export function nutzungAusName(name: string): RoomUsage | undefined {
  const n = normalisiere(name);
  if (!n) return undefined;

  for (const [wort, usage] of FESTE_WENDUNGEN) {
    if (n.includes(wort)) return usage;
  }

  // Wort für Wort von links: das erste, das etwas hergibt, entscheidet.
  for (const teil of n.split(' ')) {
    const treffer = inEinemWort(teil);
    if (treffer) return treffer;
  }
  return undefined;
}

/** Das Stichwort, dessen Treffer in diesem einen Wort am weitesten rechts endet. */
function inEinemWort(wort: string): RoomUsage | undefined {
  let beste: { usage: RoomUsage; ende: number; laenge: number } | undefined;
  for (const [usage, worte] of Object.entries(STICHWORTE) as Array<[RoomUsage, string[]]>) {
    for (const stich of worte) {
      // Gesucht wird das **letzte** Vorkommen: in „Kellerflur" soll der
      // Flur gewinnen, nicht der Keller. Mitten im Wort zu treffen ist
      // dabei erwünscht und nicht die Ausnahme — deutsche Raumnamen sind
      // fast immer Zusammensetzungen („Gaestebad", „Dachgeschossbuero"),
      // und gerade dort steht das aussagekräftige Wort hinten.
      const i = wort.lastIndexOf(stich);
      if (i < 0) continue;
      const ende = i + stich.length;
      if (!beste || ende > beste.ende || (ende === beste.ende && stich.length > beste.laenge)) {
        beste = { usage, ende, laenge: stich.length };
      }
    }
  }
  return beste?.usage;
}

// ---------------------------------------------------------------------------
// Räume der Datei auf erkannte Räume abbilden
// ---------------------------------------------------------------------------

/** Ein Raum, wie er aus einer Fremddatei kommt. */
export interface BenannterRaum {
  name: string;
  levelId: string;
  polygon: Vec2[];
  area: number;
}

/** Ein erkannter Raum, so weit die Zuordnung ihn braucht. */
export interface ErkannterRaum {
  id: string;
  levelId: string;
  polygon: Vec2[];
  area: number;
}

export interface Raumzuordnung {
  roomId: string;
  /** Der Name aus der Datei. */
  name: string;
  /** Aus dem Namen erschlossene Nutzung, oder `undefined`. */
  usage?: RoomUsage;
  /**
   * Weitere Räume der Datei, die in denselben erkannten Raum fallen.
   *
   * Das ist kein Fehler, sondern eine Aussage über die Datei: der Architekt
   * hat dort Raumgrenzen gezogen, wo keine Wand steht. Beim FZK-Haus des KIT
   * sind „Wohnen", „Flur" und „Küche" ein einziger offener Bereich von
   * 54,79 m² — CAD Light erkennt ihn zu Recht als einen Raum, und wer das
   * anders haben will, zieht eine Wand oder teilt den Raum von Hand.
   */
  weitere: string[];
}

/** Flächenschwerpunkt eines Polygons. */
function schwerpunkt(p: Vec2[]): Vec2 {
  let a = 0;
  let x = 0;
  let y = 0;
  for (let i = 0; i < p.length; i += 1) {
    const q = p[(i + 1) % p.length];
    const kreuz = p[i].x * q.y - q.x * p[i].y;
    a += kreuz;
    x += (p[i].x + q.x) * kreuz;
    y += (p[i].y + q.y) * kreuz;
  }
  if (Math.abs(a) < 1e-12) {
    // Entartetes Polygon — dann tut es der Mittelwert der Ecken.
    return {
      x: p.reduce((s, v) => s + v.x, 0) / p.length,
      y: p.reduce((s, v) => s + v.y, 0) / p.length,
    };
  }
  return { x: x / (3 * a), y: y / (3 * a) };
}

function imPolygon(p: Vec2, poly: Vec2[]): boolean {
  let drin = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      drin = !drin;
    }
  }
  return drin;
}

/**
 * Jedem erkannten Raum den Namen zuordnen, den die Datei für ihn führt.
 *
 * **Warum über den Schwerpunkt und nicht über die Fläche.** Eine
 * Überschneidungsrechnung wäre genauer und wäre hier falsch am Platz: die
 * beiden Umrisse stammen aus verschiedenen Quellen und stimmen nie exakt
 * überein — der Architekt zieht die Raumgrenze mal an die Wandoberfläche,
 * mal an die Rohbaukante. Der Schwerpunkt ist unempfindlich gegen solche
 * Zentimeter und trifft trotzdem eindeutig.
 *
 * **Die Plausibilitätsschranke.** Ein Raum der Datei wird nur übernommen,
 * wenn er nicht *größer* ist als der erkannte Raum, in dem er liegen soll —
 * mit 5 % Luft für die genannten Zentimeter. Ohne das könnte ein Raum, den
 * der Architekt über mehrere Zimmer gezogen hat (etwa eine „Wohnung" als
 * Ganzes), einem einzelnen Zimmer seinen Namen aufdrücken.
 *
 * **Bei mehreren Treffern gewinnt der größte.** Er ist der, den man beim
 * Betreten sieht. Die anderen werden mitgeführt, damit die Rückmeldung sie
 * nennen kann, statt sie stillschweigend fallen zu lassen.
 */
export function ordneRaumnamenZu(
  raeume: ErkannterRaum[],
  ausDatei: BenannterRaum[],
): Raumzuordnung[] {
  const treffer = new Map<string, BenannterRaum[]>();

  for (const s of ausDatei) {
    if (s.polygon.length < 3) continue;
    const mitte = schwerpunkt(s.polygon);
    const raum = raeume.find(
      (r) =>
        r.levelId === s.levelId &&
        r.polygon.length >= 3 &&
        s.area <= r.area * 1.05 &&
        imPolygon(mitte, r.polygon),
    );
    if (!raum) continue;
    const liste = treffer.get(raum.id);
    if (liste) liste.push(s);
    else treffer.set(raum.id, [s]);
  }

  const aus: Raumzuordnung[] = [];
  for (const [roomId, liste] of treffer) {
    const sortiert = [...liste].sort((a, b) => b.area - a.area);
    aus.push({
      roomId,
      name: sortiert[0].name,
      usage: nutzungAusName(sortiert[0].name),
      weitere: sortiert.slice(1).map((s) => s.name),
    });
  }
  return aus;
}

/**
 * Die Standardbezeichnungen, die das Namensfeld zur Auswahl anbietet.
 * ---------------------------------------------------------------------------
 * **Wozu.** Wer im Raum steht und tippt, schreibt „wz2", „janner", „kueche"
 * — genau so standen die Namen in einem echten Aufmaß. Das ist sein gutes
 * Recht, und das Feld nimmt weiterhin jeden Text. Daneben bietet es die
 * Bezeichnungen an, die auf jedem Grundriss stehen: ein Griff statt zwölf
 * Tastendrücke auf dem Tablet, und der Name ist so geschrieben, dass die
 * Nutzung sicher erkannt wird.
 *
 * **Hier steht nur der Name, keine Nutzung.** Die Nutzung eines gewählten
 * Namens kommt aus `nutzungAusName` — derselben Regel, die auch den IFC-Import
 * und den Scan einstuft. Eine zweite Tabelle „Name → Nutzung" neben den
 * Stichworten wäre genau die zweite Wahrheit, die irgendwann abweicht. Dass
 * jeder Eintrag hier eine Nutzung ergibt, hält der Prüfblock `raumnamen` fest.
 *
 * **Was bewusst fehlt.** Namen, die keine Nutzung hergeben („Ankleide",
 * „Galerie"): Wer sie aus einer Liste wählt, erwartet, dass damit etwas
 * entschieden ist — und das wäre es nicht. Wer sie braucht, tippt sie; dann
 * bleibt die Nutzung offen und die Prüfliste fragt danach.
 *
 * Die Reihenfolge folgt dem Weg durch eine Wohnung, nicht dem Alphabet — so
 * findet man beim Aufmaß den nächsten Raum dort, wo man ihn erwartet.
 */
export const STANDARD_RAUMNAMEN: readonly string[] = [
  'Wohnzimmer',
  'Wohnen / Essen',
  'Esszimmer',
  'Küche',
  'Wohnküche',
  'Schlafzimmer',
  'Kinderzimmer',
  'Gästezimmer',
  'Arbeitszimmer',
  'Büro',
  'Bad',
  'Duschbad',
  'Gäste-WC',
  'WC',
  'Flur',
  'Diele',
  'Windfang',
  'Treppenhaus',
  'Abstellraum',
  'Speisekammer',
  'Hauswirtschaftsraum',
  'Heizungsraum',
  'Technikraum',
  'Keller',
];

/**
 * Ist dieser Name eine der Standardbezeichnungen — so gewählt, nicht getippt?
 *
 * Verglichen wird genau, nur ohne Rand-Leerzeichen und ohne Groß-/Klein-
 * schreibung. „bad" aus der Liste gewählt ist dasselbe wie „Bad"; „Bad OG"
 * ist eine eigene Bezeichnung und wird nicht angefasst.
 */
export function istStandardraumname(name: string): boolean {
  const n = name.trim().toLocaleLowerCase('de');
  return STANDARD_RAUMNAMEN.some((s) => s.toLocaleLowerCase('de') === n);
}
