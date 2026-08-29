/**
 * Wissensbasis — mehrere Korpora, getrennt indiziert, gemeinsam gewichtet.
 * ---------------------------------------------------------------------------
 * Das Programm trifft Entscheidungen, die begründet werden müssen: warum
 * DN 20 und nicht DN 16, warum 15 kPa am Thermostatventil, warum überhaupt
 * ein Überströmventil. Bis 1.11.0 standen diese Begründungen als Kommentar im
 * Quelltext — dort, wo sie beim Bauen helfen, aber nicht dort, wo der Anwender
 * sie braucht.
 *
 * Hier liegen sie als durchsuchbare Einträge. Der Aufbau ist bewusst
 * **mehrkorporal**: Normen und Recht, Rohr- und Armaturentabellen,
 * Hydraulikschemata und die Projektnotizen sind vier getrennte Sammlungen mit
 * getrennten Indizes. Das ist kein Ordnungsfimmel, sondern Rechenlogik:
 *
 *  • Ein Korpus mit 400 Rohrmaßen und ein Korpus mit 30 Rechtssätzen haben
 *    völlig verschiedene Termhäufigkeiten. In einem gemeinsamen BM25-Index
 *    verschluckt der große den kleinen — die Frage „muss ich abgleichen?"
 *    liefert dann Rohrdurchmesser.
 *  • Getrennt gerankt und anschließend über **Reciprocal Rank Fusion**
 *    zusammengeführt, kommt aus jedem Korpus sein bester Treffer nach oben.
 *    RRF vergleicht Ränge statt Punktzahlen und braucht deshalb keine
 *    Normierung zwischen unterschiedlich skalierten Indizes.
 *
 * Warum kein Vektorindex: das Programm läuft als Einzeldatei im Browser, ohne
 * Netz und ohne Modell. Ein Embedding-Index bräuchte entweder ein Modell im
 * Paket (zweistelliger MB-Bereich für ein paar hundert Sätze) oder einen
 * Server. BM25 mit deutscher Wortnormalisierung und einer fachlichen
 * Synonymliste trifft bei einem Korpus dieser Größe genauso gut — und man
 * kann jedem Treffer ansehen, warum er getroffen hat.
 */

/** Die Sammlungen. Jede hat ihren eigenen Index. */
export type KorpusId =
  /** Normen, Gesetze, Verordnungen, Fachregeln. */
  | 'normen'
  /** Rohr-, Armaturen- und Werkstofftabellen. */
  | 'tabellen'
  /** Hydraulikschemata und ihre Regeln. */
  | 'hydraulik'
  /** Entscheidungen und Annahmen dieses Programms. */
  | 'projekt';

export const KORPUS_LABELS: Record<KorpusId, string> = {
  normen: 'Normen und Recht',
  tabellen: 'Tabellenwerte',
  hydraulik: 'Hydraulikschemata',
  projekt: 'Programmentscheidungen',
};

/**
 * Wie belastbar ist der Eintrag?
 *
 * Die Unterscheidung ist der Kern des Ganzen. „Primär" heißt: im Volltext der
 * Quelle nachgelesen. „Sekundär" heißt: aus Fachliteratur übernommen, weil
 * die Norm kostenpflichtig ist. „Annahme" heißt: von diesem Programm gesetzt,
 * weil eine Zahl gebraucht wurde. Wer den Unterschied verwischt, verkauft
 * eine Annahme als Norm.
 */
export type Belastbarkeit = 'primaer' | 'sekundaer' | 'annahme';

export const BELASTBARKEIT_LABELS: Record<Belastbarkeit, string> = {
  primaer: 'Primärquelle',
  sekundaer: 'Sekundärquelle',
  annahme: 'Annahme dieses Programms',
};

export interface WissensEintrag {
  id: string;
  korpus: KorpusId;
  titel: string;
  /** Der Inhalt in ein bis fünf Sätzen — das, was gesucht und gezeigt wird. */
  text: string;
  /** Zusätzliche Suchbegriffe, die im Text nicht vorkommen. */
  schlagworte: string[];
  /** Quelle im Klartext (Norm, Datenblatt, Gesetz). */
  quelle: string;
  url?: string;
  belastbarkeit: Belastbarkeit;
  /**
   * Themenschlüssel, über die der Rechenkern gezielt zitiert.
   * Beispiel: 'ventilautoritaet', 'rohrdaemmung', 'ueberstroemventil'.
   */
  themen?: string[];
}

// ---------------------------------------------------------------------------
// Wortnormalisierung
// ---------------------------------------------------------------------------

/**
 * Deutsche Füllwörter. Kurz gehalten: eine lange Stoppwortliste kostet bei
 * einem Fachkorpus mehr, als sie bringt — „nicht" und „ohne" sind hier
 * bedeutungstragend („Anlagen ohne Puffer").
 */
const STOPPWORTER = new Set([
  'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'einem', 'einer', 'eines',
  'und', 'oder', 'aber', 'ist', 'sind', 'war', 'wird', 'werden', 'wurde', 'wurden',
  'im', 'in', 'am', 'an', 'auf', 'aus', 'bei', 'mit', 'von', 'vom', 'zu', 'zum', 'zur',
  // Nach `entumlauten` steht hier „fur" — die Liste wird gegen den bereits
  // normalisierten Text geprüft, ein „für" mit Umlaut träfe nie zu.
  'fur', 'als', 'auch', 'noch', 'nur', 'so', 'wie', 'was', 'wer', 'wo', 'man', 'sich',
  'es', 'er', 'sie', 'ich', 'wir', 'ihr', 'diese', 'dieser', 'dieses', 'dann', 'da',
]);

/**
 * Sehr flache deutsche Endungsnormalisierung.
 *
 * Kein Porter-Stemmer: der verstümmelt Fachwörter („Ventil" → „Ventil",
 * aber „Rohre" → „Rohr" und „Rohres" → „Rohr" reicht völlig). Die Regeln
 * greifen nur ab fünf Zeichen, damit aus „Bogen" nicht „Bog" wird.
 */
function stamm(wort: string): string {
  let w = wort;
  if (w.length > 6) {
    for (const endung of ['ungen', 'ungs', 'erne', 'este']) {
      if (w.endsWith(endung)) return w.slice(0, -endung.length);
    }
  }
  if (w.length > 5) {
    for (const endung of ['ern', 'end', 'ung', 'nen', 'es', 'er', 'en', 'em', 'te']) {
      if (w.endsWith(endung)) return w.slice(0, -endung.length);
    }
  }
  if (w.length > 4 && (w.endsWith('e') || w.endsWith('n') || w.endsWith('s'))) {
    w = w.slice(0, -1);
  }
  return w;
}

/**
 * Fachliche Synonyme.
 *
 * Der Anwender fragt nach „Abgleich", im Text steht „hydraulischer Abgleich"
 * — das trifft. Er fragt nach „Pumpe", im Text steht „Umwälzpumpe" — das
 * trifft nur, weil hier steht, dass beides dasselbe meint. Die Liste
 * ersetzt keinen semantischen Index, sie deckt die Handvoll Wortpaare ab,
 * die im Gewerk tatsächlich auseinanderfallen.
 */
const SYNONYME: Record<string, string[]> = {
  Abgleich: ['Einregulierung', 'Einregulieren', 'balancing'],
  Pumpe: ['Umwälzpumpe', 'Heizungspumpe', 'Förderhöhe'],
  Puffer: ['Pufferspeicher', 'Speicher', 'Trennspeicher'],
  WP: ['Wärmepumpe'],
  Wärmepumpe: ['WP'],
  FBH: ['Fußbodenheizung', 'Flächenheizung'],
  Fußbodenheizung: ['FBH', 'Flächenheizung'],
  HK: ['Heizkörper', 'Heizfläche'],
  Heizkörper: ['HK', 'Heizfläche'],
  Ventil: ['Armatur', 'Thermostatventil', 'THV'],
  THV: ['Thermostatventil', 'Ventil'],
  Voreinstellung: ['Einstellwert', 'Stufe', 'kv'],
  Dämmung: ['Isolierung', 'Dämmstärke'],
  Druckverlust: ['Druckgefälle', 'Widerstand'],
  Rohr: ['Leitung', 'Teilstrecke', 'Strang'],
  GEG: ['GModG', 'Gebäudeenergiegesetz', 'Gebäudemodernisierungsgesetz'],
  GModG: ['GEG'],
  Überströmventil: ['ÜV', 'Bypass'],
  Warmwasser: ['Trinkwasser', 'TWW', 'Brauchwasser'],
  Volumenstrom: ['Durchfluss', 'Massenstrom'],
};

/**
 * Umlaute, ß **und die Ersatzschreibweise** auf eine gemeinsame Form.
 *
 * Zwei Dinge müssen zusammenfallen, und sie ziehen in verschiedene
 * Richtungen:
 *
 *  • „Wärmepumpe" und „Waermepumpe" sind dasselbe Wort. Jede
 *    Herstellerdatei, die keine Umlaute verträgt, schreibt die zweite Form.
 *  • „Bögen" und „Bogen" sind derselbe Begriff. Bildet man ö auf „oe" ab,
 *    wird aus „Bögen" ein sechs Zeichen langes „boegen", das der Stemmer
 *    anders kürzt als das fünf Zeichen lange „bogen" — und die beiden
 *    treffen sich nie mehr.
 *
 * Beides zugleich geht nur über den kurzen Weg: Umlaut auf den
 * Grundbuchstaben, **und** die Ersatzschreibweise ebenfalls dorthin. „ae"
 * wird also zu „a" — aber nur, wenn davor kein Vokal steht. Ohne diese
 * Einschränkung würde aus „Bauer" ein „Bar" und aus „Steuerung" ein
 * „Sterung": dort gehört das u zum Diphthong „au" bzw. „eu" und das e zur
 * folgenden Silbe. Die Regel „Diphthong nur nach Konsonant" trennt beide
 * Fälle im Deutschen zuverlässig.
 */
function entumlauten(s: string): string {
  return s
    .replace(/ä/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/ü/g, 'u')
    .replace(/ß/g, 'ss')
    .replace(/Ä/g, 'A')
    .replace(/Ö/g, 'O')
    .replace(/Ü/g, 'U')
    // Am Wortanfang gibt es keinen Vorgänger; dort ist „Ue" praktisch immer
    // ein umschriebenes Ü („Ueberstroemventil"), ein deutsches Wort beginnt
    // sonst nicht so.
    .replace(/(^|[^a-zäöüA-ZÄÖÜ])([AaOoUu])e/g, (_treffer, vor: string, vokal: string) =>
      'AaOoUu'.includes(vokal) ? `${vor}${vokal}` : `${vor}${vokal}e`,
    )
    .replace(/([^aeiouäöüAEIOUÄÖÜ])ae/g, '$1a')
    .replace(/([^aeiouäöüAEIOUÄÖÜ])oe/g, '$1o')
    .replace(/([^aeiouäöüAEIOUÄÖÜ])ue/g, '$1u');
}

/** Text in normalisierte Wortstämme zerlegen. */
export function tokenisiere(text: string): string[] {
  const roh = entumlauten(text.toLowerCase())
    .replace(/[^a-z0-9äöüß§.,-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const raus: string[] = [];
  for (const w of roh) {
    // Zahlen mit Einheit bleiben, wie sie sind: „15" und „kpa" getrennt zu
    // suchen findet nichts, „15 kpa" als Paar sehr wohl.
    const rein = w.replace(/^[.,-]+|[.,-]+$/g, '');
    if (!rein || rein.length < 2) continue;
    if (STOPPWORTER.has(rein)) continue;
    raus.push(stamm(rein));
  }
  return raus;
}

/**
 * Die Synonymliste in Stammform.
 *
 * Von Hand gepflegte Stämme wären ein Wartungsloch: ändert sich eine Regel im
 * Stemmer, passen die Schlüssel nicht mehr, und die Synonyme greifen still
 * nicht mehr. Deshalb läuft die Liste beim Laden einmal durch dieselbe
 * Normalisierung wie jeder Text — Schlüssel wie Werte.
 */
const SYNONYM_INDEX: Map<string, string[]> = (() => {
  const map = new Map<string, string[]>();
  for (const [wort, gleiche] of Object.entries(SYNONYME)) {
    const schluessel = tokenisiere(wort)[0];
    if (!schluessel) continue;
    const werte = gleiche.flatMap((g) => tokenisiere(g));
    const bisher = map.get(schluessel) ?? [];
    map.set(schluessel, [...new Set([...bisher, ...werte])]);
  }
  return map;
})();

/** Suchbegriffe um Synonyme erweitern. */
function erweitere(begriffe: readonly string[]): string[] {
  const raus = new Set(begriffe);
  for (const b of begriffe) {
    for (const s of SYNONYM_INDEX.get(b) ?? []) raus.add(s);
  }
  return [...raus];
}

// ---------------------------------------------------------------------------
// BM25 je Korpus
// ---------------------------------------------------------------------------

/** BM25-Parameter. Die Standardwerte der Literatur (Robertson/Sparck Jones). */
const K1 = 1.2;
const B = 0.75;

interface Index {
  korpus: KorpusId;
  eintraege: WissensEintrag[];
  /** Termhäufigkeit je Dokument. */
  tf: Map<string, number>[];
  /** Länge je Dokument in Wörtern. */
  laenge: number[];
  /** Mittlere Dokumentlänge. */
  mittel: number;
  /** Dokumenthäufigkeit je Term. */
  df: Map<string, number>;
}

function baueIndex(korpus: KorpusId, eintraege: WissensEintrag[]): Index {
  const tf: Map<string, number>[] = [];
  const laenge: number[] = [];
  const df = new Map<string, number>();
  for (const e of eintraege) {
    // Titel und Schlagworte zählen doppelt: sie sind die verdichtete Form
    // des Eintrags, und ein Treffer dort ist mehr wert als einer im Fließtext.
    const worte = [
      ...tokenisiere(e.titel),
      ...tokenisiere(e.titel),
      ...tokenisiere(e.schlagworte.join(' ')),
      ...tokenisiere(e.schlagworte.join(' ')),
      ...tokenisiere(e.text),
      ...tokenisiere((e.themen ?? []).join(' ')),
    ];
    const map = new Map<string, number>();
    for (const w of worte) map.set(w, (map.get(w) ?? 0) + 1);
    tf.push(map);
    laenge.push(worte.length);
    for (const w of map.keys()) df.set(w, (df.get(w) ?? 0) + 1);
  }
  const mittel = laenge.length ? laenge.reduce((a, b) => a + b, 0) / laenge.length : 1;
  return { korpus, eintraege, tf, laenge, mittel, df };
}

function bm25(index: Index, begriffe: readonly string[], dok: number): number {
  const N = index.eintraege.length;
  let punkte = 0;
  for (const t of begriffe) {
    const f = index.tf[dok].get(t);
    if (!f) continue;
    const n = index.df.get(t) ?? 0;
    // Der +1 im Zähler hält die IDF positiv, auch wenn ein Term in mehr als
    // der Hälfte der Dokumente steht — sonst zieht ein häufiges Fachwort den
    // Treffer ins Minus.
    const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
    const norm = 1 - B + (B * index.laenge[dok]) / index.mittel;
    punkte += idf * ((f * (K1 + 1)) / (f + K1 * norm));
  }
  return punkte;
}

// ---------------------------------------------------------------------------
// Suche
// ---------------------------------------------------------------------------

export interface Treffer {
  eintrag: WissensEintrag;
  /** Fusionspunktzahl über alle Korpora. */
  score: number;
  /** Rang innerhalb des eigenen Korpus (1 = bester). */
  rangImKorpus: number;
  /** BM25-Punktzahl im eigenen Korpus — für die Nachvollziehbarkeit. */
  bm25: number;
}

export interface SuchOptionen {
  /** Nur in diesen Korpora suchen. Leer = alle. */
  korpora?: KorpusId[];
  /** Höchstzahl der Treffer. */
  anzahl?: number;
  /** Nur Einträge mit mindestens dieser Belastbarkeit. */
  mindestens?: Belastbarkeit;
}

/**
 * Konstante der Reciprocal Rank Fusion.
 *
 * RRF(d) = Σ_korpora 1/(k + rang). Mit k = 60 (der in der Literatur
 * gebräuchliche Wert, Cormack et al. 2009) hat der erste Rang eines Korpus
 * nicht so viel Vorsprung, dass ein zweiter Korpus ihn nie einholen kann —
 * genau das soll die Fusion ja verhindern.
 */
const RRF_K = 60;

const RANG_BELASTBARKEIT: Record<Belastbarkeit, number> = { primaer: 3, sekundaer: 2, annahme: 1 };

/**
 * Eine Suchmaschine über mehrere Korpora.
 *
 * Der Index wird einmal gebaut und dann wiederverwendet; ein Neuaufbau je
 * Tastendruck wäre bei einigen hundert Einträgen zwar auch schnell genug,
 * aber unnötig.
 */
export class Wissensbasis {
  private readonly indizes: Index[];

  constructor(eintraege: readonly WissensEintrag[]) {
    const nach = new Map<KorpusId, WissensEintrag[]>();
    for (const e of eintraege) {
      const liste = nach.get(e.korpus) ?? [];
      liste.push(e);
      nach.set(e.korpus, liste);
    }
    this.indizes = [...nach.entries()].map(([k, liste]) => baueIndex(k, liste));
  }

  /** Zahl der Einträge, gesamt oder je Korpus. */
  umfang(korpus?: KorpusId): number {
    return this.indizes
      .filter((i) => !korpus || i.korpus === korpus)
      .reduce((a, i) => a + i.eintraege.length, 0);
  }

  korpora(): KorpusId[] {
    return this.indizes.map((i) => i.korpus);
  }

  /**
   * Volltextsuche mit Rangfusion über die Korpora.
   */
  suche(frage: string, opt: SuchOptionen = {}): Treffer[] {
    const begriffe = erweitere(tokenisiere(frage));
    if (!begriffe.length) return [];
    const schranke = opt.mindestens ? RANG_BELASTBARKEIT[opt.mindestens] : 0;
    const fusion = new Map<string, Treffer>();

    for (const index of this.indizes) {
      if (opt.korpora?.length && !opt.korpora.includes(index.korpus)) continue;
      const punkte: { i: number; s: number }[] = [];
      for (let i = 0; i < index.eintraege.length; i++) {
        if (RANG_BELASTBARKEIT[index.eintraege[i].belastbarkeit] < schranke) continue;
        const s = bm25(index, begriffe, i);
        if (s > 0) punkte.push({ i, s });
      }
      punkte.sort((a, b) => b.s - a.s);
      punkte.forEach((p, rang) => {
        const e = index.eintraege[p.i];
        const bisher = fusion.get(e.id);
        const zuwachs = 1 / (RRF_K + rang + 1);
        if (bisher) {
          bisher.score += zuwachs;
        } else {
          fusion.set(e.id, { eintrag: e, score: zuwachs, rangImKorpus: rang + 1, bm25: p.s });
        }
      });
    }

    return [...fusion.values()]
      .sort((a, b) => b.score - a.score || b.bm25 - a.bm25)
      .slice(0, opt.anzahl ?? 8);
  }

  /**
   * Belege zu einem Themenschlüssel.
   *
   * Anders als `suche` ist das kein Ranking, sondern ein exakter Zugriff:
   * der Rechenkern weiß, welches Thema er gerade belegt, und will genau die
   * Einträge dazu — vollständig und in stabiler Reihenfolge, damit ein
   * gedruckter Bericht zweimal gleich aussieht.
   */
  belege(thema: string): WissensEintrag[] {
    const raus: WissensEintrag[] = [];
    for (const index of this.indizes) {
      for (const e of index.eintraege) {
        if (e.themen?.includes(thema)) raus.push(e);
      }
    }
    return raus.sort(
      (a, b) =>
        RANG_BELASTBARKEIT[b.belastbarkeit] - RANG_BELASTBARKEIT[a.belastbarkeit] ||
        a.id.localeCompare(b.id),
    );
  }

  /** Alle Themenschlüssel, die tatsächlich belegt sind. */
  themen(): string[] {
    const raus = new Set<string>();
    for (const index of this.indizes) {
      for (const e of index.eintraege) for (const t of e.themen ?? []) raus.add(t);
    }
    return [...raus].sort();
  }

  eintrag(id: string): WissensEintrag | undefined {
    for (const index of this.indizes) {
      const t = index.eintraege.find((e) => e.id === id);
      if (t) return t;
    }
    return undefined;
  }
}

/** Kurzform einer Quellenangabe für Fußnoten im Druck. */
export function quellenzeile(e: WissensEintrag): string {
  const art = e.belastbarkeit === 'primaer' ? '' : ` (${BELASTBARKEIT_LABELS[e.belastbarkeit]})`;
  return `${e.quelle}${art}`;
}
