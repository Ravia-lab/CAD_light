/**
 * Die Anschlussgröße des Wärmeerzeugers — und was sie für die Leitung bedeutet.
 * ---------------------------------------------------------------------------
 * **Warum es diese Datei gibt.** Ein Heizungsfachplaner formuliert den Befund
 * in einem Satz: „Bei der Wärmepumpe brauche ich eine Anschlussgröße; die
 * meisten Anbieter sagen hier mindestens 1 Zoll." Das Programm kannte die
 * Angabe bis 1.23.0 nur als Zierde. `HeatPumpModel.hydraulicConnection` stand
 * im Anlagenbuch, im Massenauszug und am Schemasymbol — und **nirgends in
 * einer Rechnung**. Die Nennweite der ersten Leitung ab dem Erzeuger entstand
 * rein hydraulisch aus der Leistung (`plantDesign.connectionDiameter`,
 * `pipeReport`), und `hydraulics.sizePipe` kannte zwar seit jeher einen
 * `minDn`-Parameter, bekam ihn vom Erzeuger aus aber nie gesetzt.
 *
 * **Der Schaden ist gemessen und kein Gedankenspiel.** Am Referenzhaus mit
 * gesetztem Erzeuger, 5,47 kW Heizlast, Gerät 8 kW, 10 K Spreizung:
 *
 *     hydraulisch gerechnet            DN 20   (Erzeugeranbindung)
 *     Trasse ab dem Erzeuger           DN 15   (Verbund 20 × 2)
 *     Anschluss laut Gerät             DN 32   (G 1¼ AG)
 *
 * Das Programm rechnete also eine Leitung, die **kleiner** ist als der
 * Stutzen, an dem sie hängt — und der Massenauszug bestellte sie so. Am Bau
 * wird daraus ein Reduzierstück unmittelbar am Gerät und danach 20 m zu enges
 * Rohr. Was daran hängt, ist nicht der Komfort: Gerätedruckverlust,
 * Mindestvolumenstrom und Abtauverhalten sind vom Hersteller **auf sein
 * Anschlussmaß bezogen** angegeben, und die Gewährleistung hängt daran.
 *
 * **Warum die Zoll-Tabelle eine Tabelle ist und keine Formel.** Es liegt
 * nahe, aus „G 1" die 25,4 mm des Zolls zu machen und daraus DN 25 — und es
 * geht auch bei genau diesem einen Fall gut. Schon eine Stufe weiter bricht
 * es: G 1¼ sind 31,75 mm, die Nennweite ist aber DN 32; G 2 sind 50,8 mm bei
 * DN 50; G ⅜ sind 9,5 mm bei DN 10. Der Grund ist, dass das Zollmaß am
 * Rohrgewinde nach EN 10226 der **Außendurchmesser des Rohres** ist, während
 * DN eine dimensionslose Ordnungszahl nahe am **lichten** Maß bezeichnet.
 * Beide Reihen sind historisch gewachsen und laufen nicht parallel. Wer
 * rechnet, liegt daneben; wer nachschlägt, nicht.
 *
 * **Was sich nicht deuten lässt, wird nicht geraten.** Eine Angabe wie
 * „Flansch", „bauseits" oder ein blankes „32" liefert `undefined` — und zwar
 * ausdrücklich auch die blanke Zahl: 32 kann DN 32 sein oder Cu 32 × 3 und
 * damit DN 25. Ein geratener Wert an dieser Stelle wäre schlimmer als keiner,
 * weil er die Prüfung unten scharf schaltet und die Leitung auf eine falsche
 * Größe zwingt.
 *
 * Schichtgrenze: nur Typen, kein Zustand, keine Oberfläche.
 */

/**
 * Ein Befund für den Bericht — dieselbe Form wie in `pipeInsulation`,
 * `domesticWater` und `pipeRouting`.
 *
 * Sie wird hier noch einmal geschrieben statt importiert, weil ein Import nur
 * der Form wegen eine Abhängigkeit zwischen zwei Modulen stiftet, die
 * fachlich nichts miteinander zu tun haben.
 */
export type PlanningNote = { severity: 'info' | 'warn' | 'error'; text: string };

// ---------------------------------------------------------------------------
// Die Tabellen
// ---------------------------------------------------------------------------

/**
 * Rohrgewinde → Nennweite [mm].
 *
 * Schlüssel ist das Zollmaß als Bruch in Vierteln — also `1` für G 1,
 * `1.25` für G 1¼. Gespeichert wird die Zahl und nicht die Schreibweise,
 * weil dieselbe Größe in Datenblättern in mindestens vier Fassungen
 * vorkommt: „G 1¼", „G 1 1/4", „1¼"" und „1,25 Zoll".
 *
 * **Herkunft.** Die Zuordnung Gewinde ↔ Nennweite ist die des
 * Gewinderohrs nach EN 10255 (früher DIN 2440); sie steht in jedem
 * Installateurstabellenbuch und in `hydraulics.STEEL_PIPES` mit denselben
 * Werten — dort als Außenmaß-/Wanddickenreihe, hier als Bezeichnung. Wer
 * eine der beiden ändert, muss die andere mitändern.
 */
export const ZOLL_NENNWEITE: ReadonlyMap<number, number> = new Map([
  [0.25, 8],
  [0.375, 10],
  [0.5, 15],
  [0.75, 20],
  [1, 25],
  [1.25, 32],
  [1.5, 40],
  [2, 50],
  [2.5, 65],
  [3, 80],
  [4, 100],
]);

/**
 * Nennweite [mm] → übliche Gewindebezeichnung.
 *
 * Die Umkehrung wird von Hand geführt und nicht aus der Tabelle oben
 * erzeugt: Die Schreibweise mit dem Bruchzeichen („G 1¼") ist die, die auf
 * dem Gerät steht und die der Monteur wiederfindet. Aus der Zahl 1,25 ließe
 * sie sich nur über eine zweite Tabelle erzeugen — dann lieber gleich diese.
 */
export const NENNWEITE_GEWINDE: ReadonlyMap<number, string> = new Map([
  [8, 'G ¼'],
  [10, 'G ⅜'],
  [15, 'G ½'],
  [20, 'G ¾'],
  [25, 'G 1'],
  [32, 'G 1¼'],
  [40, 'G 1½'],
  [50, 'G 2'],
  [65, 'G 2½'],
  [80, 'G 3'],
  [100, 'G 4'],
]);

/**
 * Kupfer-/Edelstahl-Außendurchmesser [mm] → Nennweite [mm].
 *
 * **Warum diese Tabelle daneben stehen muss.** Viessmann gibt die Vitocal
 * 250-A über die ganze Baureihe von 2,6 bis 18,5 kW mit „Cu 28 × 1,0" an —
 * gar kein Gewinde, sondern ein Lötanschluss. Ohne diese Zeile wäre das ein
 * nicht deutbarer Text und die Prüfung unten liefe leer, obwohl im Datenblatt
 * eine völlig eindeutige Größe steht.
 *
 * Die Zuordnung folgt der Wanddicke **nicht**: Cu 28 × 1,0 hat 26 mm licht,
 * Cu 28 × 1,5 hat 25 mm — beide heißen DN 25. Das ist gewollt. Die Nennweite
 * ist eine Bezeichnung des Anschlusses und keine Rechengröße für den
 * Druckverlust; für den gibt es `hydraulics.PIPE_TABLES` mit den echten
 * lichten Maßen.
 */
export const KUPFER_NENNWEITE: ReadonlyMap<number, number> = new Map([
  [12, 10],
  [15, 12],
  [18, 15],
  [22, 20],
  [28, 25],
  [35, 32],
  [42, 40],
  [54, 50],
  [64, 60],
  [76.1, 65],
  [88.9, 80],
  [108, 100],
]);

/** Bruchzeichen, die in Datenblättern vorkommen → ihr Zahlenwert. */
const BRUCHZEICHEN: ReadonlyMap<string, number> = new Map([
  ['¼', 0.25],
  ['⅜', 0.375],
  ['½', 0.5],
  ['⅝', 0.625],
  ['¾', 0.75],
  ['⅞', 0.875],
]);

// ---------------------------------------------------------------------------
// Deutung: Klartext → Nennweite
// ---------------------------------------------------------------------------

/**
 * Die Nennweite [mm] zu einer Anschlussangabe im Klartext — oder `undefined`.
 *
 * Gedeutet wird in drei Durchgängen, und die Reihenfolge ist bewusst:
 *
 *  1. **„DN 32"** — die ausdrückliche Nennweite. Sie ist die einzige Angabe,
 *     die keine Umrechnung braucht, und sie schlägt alles andere: Wer „DN 32
 *     (G 1¼)" schreibt, hat die Nennweite genannt und die Gewindegröße
 *     erläutert, nicht umgekehrt.
 *  2. **Gewinde** — „G 1¼ AG", „R 1 1/4", „Rp 1", „1¼\"", „1 1/4 Zoll".
 *     Erkannt wird an einem der Präfixe G/R/Rp, an einem Zollzeichen oder am
 *     Wort „Zoll"; ein Bruch allein genügt ebenfalls, denn „1 1/4" ist ohne
 *     Zoll nicht lesbar.
 *  3. **Lötanschluss** — „Cu 28 × 1,0", „28 × 1,5", „Ø 28".
 *
 * **Was ausdrücklich nicht gedeutet wird:** eine blanke Zahl ohne jede
 * Einheit. „28" ist ein Kupferaußenmaß (DN 25), „32" wäre als DN gelesen
 * DN 32 und als Kupfer gelesen DN 25 — dieselbe Ziffernfolge, zwei Stufen
 * Unterschied. Hier ist `undefined` die einzige redliche Antwort.
 */
export function nennweiteAusText(text: string | undefined): number | undefined {
  if (!text) return undefined;
  // Vereinheitlichen, bevor gesucht wird: Groß-/Kleinschreibung, die drei
  // gebräuchlichen Malzeichen (×, x, X) und das Dezimalkomma. Ohne diesen
  // Schritt bräuchte jeder der Ausdrücke unten drei Fassungen.
  const roh = text.trim().toLowerCase().replace(/[×x]/g, '×').replace(',', '.');
  if (roh.length === 0) return undefined;

  // --- 1. Ausdrückliche Nennweite ------------------------------------------
  const dn = /\bdn\s*(\d{1,3})\b/.exec(roh);
  if (dn) {
    const wert = Number(dn[1]);
    // Geprüft gegen die Reihe: „DN 33" gibt es nicht, und eine Nennweite, die
    // in keiner Tabelle vorkommt, ist ein Tippfehler und keine Größe.
    if ([...ZOLL_NENNWEITE.values()].includes(wert) || [...KUPFER_NENNWEITE.values()].includes(wert)) {
      return wert;
    }
    return undefined;
  }

  // --- 2. Gewinde -----------------------------------------------------------
  const zoll = zollmassAusText(roh);
  if (zoll !== undefined) return ZOLL_NENNWEITE.get(zoll);

  // --- 3. Lötanschluss ------------------------------------------------------
  // „cu 28 × 1.0", „28 × 1.5" oder „ø 28": maßgeblich ist die erste Zahl, der
  // Außendurchmesser. Ein Malzeichen mit zweiter Zahl dahinter ist die
  // Wanddicke und wird verworfen — sie ändert die Bezeichnung nicht.
  const cu = /(?:^|\b)(?:cu\s*|ø\s*)?(\d{2,3}(?:\.\d)?)\s*(?:×\s*\d)/.exec(roh) ?? /(?:cu|ø)\s*(\d{2,3}(?:\.\d)?)/.exec(roh);
  if (cu) return KUPFER_NENNWEITE.get(Number(cu[1]));

  return undefined;
}

/**
 * Das Zollmaß aus einer Gewindeangabe — oder `undefined`.
 *
 * Ausgelagert, weil der Ausdruck sonst dreimal in `nennweiteAusText` stünde:
 * Ein Gewinde kann als Bruchzeichen („1¼"), als Schrägstrichbruch („1 1/4")
 * oder als Dezimalzahl („1.25 zoll") geschrieben sein, und nur eines davon
 * lässt sich mit einem einzigen Ausdruck fassen.
 */
function zollmassAusText(roh: string): number | undefined {
  // Als Gewinde gilt nur, was sich als solches zu erkennen gibt: ein Präfix
  // (G, R, Rp — Rp ist das zylindrische Innengewinde), ein Zollzeichen oder
  // das Wort „Zoll". Andernfalls wäre „1" jede beliebige Eins.
  // Hinter dem Präfix darf eine Ziffer **oder** ein Bruchzeichen stehen:
  // „G ½" ist eine vollständige Angabe und hat keine führende Ziffer.
  const alsGewinde =
    /(^|\s)(g|r|rp)\s*[\d¼⅜½⅝¾⅞]/.test(roh) || /["'′″]/.test(roh) || /zoll/.test(roh);
  if (!alsGewinde) {
    // Ein Schrägstrichbruch ist auch ohne Präfix eindeutig: „1 1/4" ist keine
    // Nennweite und kein Kupfermaß, sondern ein Gewinde.
    if (!/\d\s*\/\s*\d/.test(roh)) return undefined;
  }

  // a) Ganzzahl mit Bruchzeichen: „1¼", „1 ½"
  const mitZeichen = /(\d)\s*([¼⅜½⅝¾⅞])/.exec(roh);
  if (mitZeichen) return Number(mitZeichen[1]) + (BRUCHZEICHEN.get(mitZeichen[2]) ?? 0);
  // b) Bruchzeichen allein: „½"", „G ¾"
  const nurZeichen = /([¼⅜½⅝¾⅞])/.exec(roh);
  if (nurZeichen) return BRUCHZEICHEN.get(nurZeichen[1]);
  // c) Ganzzahl mit Schrägstrichbruch: „1 1/4", „1-1/4"
  const gemischt = /(\d)\s*[-\s]\s*(\d)\s*\/\s*(\d)/.exec(roh);
  if (gemischt) return Number(gemischt[1]) + Number(gemischt[2]) / Number(gemischt[3]);
  // d) Schrägstrichbruch allein: „3/4"", „1/2 Zoll"
  const bruch = /(\d)\s*\/\s*(\d)/.exec(roh);
  if (bruch) return Number(bruch[1]) / Number(bruch[2]);
  // e) Ganze oder dezimale Zoll: „G 1 AG", „2 Zoll", „1.25 zoll"
  const ganz = /(?:^|\s)(?:g|r|rp)?\s*(\d(?:\.\d{1,2})?)(?=\s|["'′″]|$|\s*zoll|\s*ag|\s*ig)/.exec(roh);
  if (ganz) return Number(ganz[1]);
  return undefined;
}

/**
 * Die übliche Gewindebezeichnung zu einer Nennweite — oder `undefined`.
 *
 * Ohne Zusatz „AG"/„IG": Ob am Gerät ein Außen- oder ein Innengewinde sitzt,
 * steht im Datenblatt und lässt sich aus der Nennweite nicht ableiten. Wer
 * die Angabe hat, hängt sie an; wer sie nicht hat, schreibt sie auch nicht
 * hin. Eine erfundene Gewinderichtung führt zur falschen Verschraubung im
 * Materialauszug.
 */
export function anschlusstext(dn: number): string | undefined {
  return NENNWEITE_GEWINDE.get(dn);
}

// ---------------------------------------------------------------------------
// Woher die Anschlussgröße kommt
// ---------------------------------------------------------------------------

/** Alles, was ein Gerät über seinen Heizungsanschluss sagen kann. */
export interface Geraeteanschluss {
  /** Klartext, so wie er im Datenblatt steht. */
  hydraulicConnection?: string;
  /** Dieselbe Größe als rechenbare Nennweite [mm]. */
  connectionDn?: number;
}

/** Woher die verwendete Anschlussgröße stammt. */
export type AnschlussHerkunft = 'gerät' | 'katalog' | 'fehlt';

export interface Anschluss {
  /** Nennweite [mm] — `undefined`, wenn sich keine ermitteln ließ. */
  dn?: number;
  /** Der Klartext, der dazu gehört. */
  text?: string;
  herkunft: AnschlussHerkunft;
  /**
   * Ein Text, der da war und sich nicht deuten ließ.
   *
   * Er ist der Grund, warum diese Rückgabe kein blankes `number | undefined`
   * ist: „keine Angabe" und „eine Angabe, die niemand lesen kann" sind zwei
   * verschiedene Zustände, und nur der zweite gehört gemeldet.
   */
  unlesbar?: string;
}

/**
 * Die Anschlussgröße des Erzeugers — aufgestelltes Gerät vor Katalogmodell.
 *
 * **Die Rangfolge.** Das im Lageplan aufgestellte Gerät schlägt das
 * Katalogmodell, weil es das Gerät ist, das gebaut wird: Das Katalogmodell
 * ist der Vorschlag des Programms, die Eintragung am Gerät ist die Aussage
 * des Planers, der das Datenblatt vor sich hat. Innerhalb des Geräts schlägt
 * die ausdrückliche Nennweite den Klartext — wer beides einträgt und sich
 * widerspricht, meint die Zahl, mit der gerechnet wird.
 *
 * **Fehlt beides, wird nichts angenommen.** `dn` bleibt `undefined`, und die
 * Auslegung rechnet weiter rein hydraulisch, genau wie bisher. Eine
 * Vorbelegung „mindestens DN 25, das hat ja jeder" wäre bequem und an jeder
 * kleinen Anlage falsch.
 */
export function anschlussVonGeraet(
  geraet: Geraeteanschluss | undefined,
  katalog: Geraeteanschluss | undefined,
): Anschluss {
  const vomGeraet = deute(geraet, 'gerät');
  if (vomGeraet?.dn !== undefined) return vomGeraet;
  const vomKatalog = deute(katalog, 'katalog');
  // Der unlesbare Text des Geräts wird mitgenommen, auch wenn die Nennweite
  // am Ende aus dem Katalog kommt: Sonst verschwände die Fehleingabe genau
  // dann aus dem Bericht, wenn das Programm sie still überbrückt hat — und
  // das ist der Fall, in dem sie am dringendsten hingehört.
  if (vomKatalog?.dn !== undefined) {
    return vomGeraet?.unlesbar ? { ...vomKatalog, unlesbar: vomGeraet.unlesbar } : vomKatalog;
  }
  return vomGeraet ?? vomKatalog ?? { herkunft: 'fehlt' };
}

/**
 * Eine einzelne Quelle auslesen — `undefined`, wenn sie zu allem schweigt.
 *
 * Der Unterschied zwischen „schweigt" und „sagt etwas Unlesbares" ist der
 * ganze Zweck dieser Funktion: Nur das zweite ist ein Befund.
 */
function deute(quelle: Geraeteanschluss | undefined, herkunft: 'gerät' | 'katalog'): Anschluss | undefined {
  if (!quelle) return undefined;
  if (quelle.connectionDn !== undefined && Number.isFinite(quelle.connectionDn) && quelle.connectionDn > 0) {
    return {
      dn: quelle.connectionDn,
      text: quelle.hydraulicConnection?.trim() || anschlusstext(quelle.connectionDn),
      herkunft,
    };
  }
  const text = quelle.hydraulicConnection?.trim();
  if (!text) return undefined;
  const dn = nennweiteAusText(text);
  if (dn !== undefined) return { dn, text, herkunft };
  return { text, herkunft, unlesbar: text };
}

// ---------------------------------------------------------------------------
// Die Regel
// ---------------------------------------------------------------------------

/** Das Ergebnis der Prüfung „darf die Leitung so klein sein?" */
export interface Anschlusspruefung {
  /** Die Nennweite, mit der zu bauen ist [mm]. */
  dn: number;
  /** Was die Hydraulik allein ergeben hätte [mm]. */
  hydraulisch: number;
  /** Was das Gerät verlangt [mm] — `undefined`, wenn nichts bekannt ist. */
  geraet?: number;
  /** Wurde wegen des Geräteanschlusses angehoben? */
  angehoben: boolean;
  /** Ein Satz, der sagt, warum die Zahl so ist. */
  begruendung: string;
}

/**
 * Die Leitung ab dem Erzeuger darf den Geräteanschluss nicht unterschreiten.
 *
 * **Warum das keine hydraulische Regel ist.** Die Hydraulik kennt den
 * Stutzen nicht; sie sieht einen Volumenstrom und sucht das billigste Rohr,
 * das Geschwindigkeit und Druckgefälle einhält. Bei 8 kW und 10 K Spreizung
 * findet sie DN 20 — und rechnerisch ist daran nichts falsch. Falsch wird es
 * erst dadurch, dass der Hersteller **alle** seine Angaben auf sein
 * Anschlussmaß bezieht:
 *
 *  • der **Gerätedruckverlust** im Datenblatt gilt für den Anschluss, den das
 *    Gerät hat — eine Verjüngung direkt dahinter liegt zusätzlich im Fließweg
 *    und fehlt in jeder Pumpenauslegung, die aus dem Datenblatt kommt;
 *  • der **Mindestvolumenstrom** ist die Bedingung, unter der der Verdichter
 *    überhaupt freigegeben wird; eine zu enge Anbindung erreicht ihn bei der
 *    verfügbaren Restförderhöhe nicht;
 *  • beim **Abtauen** kehrt der Kreis um und holt seine Energie in wenigen
 *    Minuten aus dem Anlagenwasser — das ist der Betriebsfall mit dem
 *    höchsten Volumenstrom überhaupt, und er ist der Grund, warum viele
 *    Hersteller den Anschlussquerschnitt ausdrücklich bis in die Anlage
 *    hinein fortgeführt sehen wollen (Daikin schreibt es für die Altherma 4 H
 *    Hydrosplit so hin);
 *  • und die **Gewährleistung** hängt daran: Wer unter dem Anschlussmaß
 *    baut, weicht von der Montageanleitung ab.
 *
 * Angehoben wird nur nach oben. Ist die Hydraulik bereits größer als der
 * Stutzen — bei langen Trassen der Normalfall —, bleibt sie stehen: die
 * Vorgabe ist eine Untergrenze und keine Vorschrift zur Verjüngung.
 *
 * **Ohne Geräteangabe passiert nichts.** `geraet === undefined` liefert
 * unverändert die hydraulische Nennweite zurück. Das ist die
 * Nichtregressionszusage an alle Modelle, in denen nie ein Datenblatt
 * hinterlegt wurde.
 */
export function pruefeAnschluss(hydraulisch: number, geraet: number | undefined): Anschlusspruefung {
  if (geraet === undefined || !Number.isFinite(geraet) || geraet <= 0) {
    return {
      dn: hydraulisch,
      hydraulisch,
      angehoben: false,
      begruendung: `DN ${hydraulisch} rein hydraulisch. Zum Erzeuger liegt keine verwertbare Anschlussgröße vor — es wird keine angenommen.`,
    };
  }
  if (geraet <= hydraulisch) {
    return {
      dn: hydraulisch,
      hydraulisch,
      geraet,
      angehoben: false,
      begruendung: `DN ${hydraulisch} hydraulisch; der Geräteanschluss DN ${geraet} liegt darunter und ist damit nicht maßgeblich.`,
    };
  }
  return {
    dn: geraet,
    hydraulisch,
    geraet,
    angehoben: true,
    begruendung: `DN ${geraet} nach Geräteanschluss statt DN ${hydraulisch} hydraulisch — die Herstellervorgabe ist die Untergrenze.`,
  };
}

/**
 * Der Befund zur Anhebung — für `notes` in Auslegung und Trassenplanung.
 *
 * `warn` und nicht `info`: Die Zahl weicht von der ab, die derselbe Planer
 * bei einer Handrechnung herausbekäme, und eine Abweichung, die niemand
 * erklärt, wird für einen Fehler gehalten. `error` wäre falsch — die Anlage
 * ist mit der angehobenen Nennweite ja gerade in Ordnung.
 *
 * Ohne Anhebung gibt es keinen Befund. Eine Meldung, die bei jeder Auslegung
 * kommt, liest nach der dritten niemand mehr.
 */
export function anschlussNotiz(
  pruefung: Anschlusspruefung,
  anschluss?: Anschluss,
  ort = 'Die Leitung ab dem Erzeuger',
): PlanningNote | undefined {
  if (!pruefung.angehoben) return undefined;
  const woher =
    anschluss?.herkunft === 'katalog'
      ? ' Die Größe stammt aus dem gewählten Katalogmodell; ein Datenblattwert am Gerät schlägt sie.'
      : '';
  const text = anschluss?.text ? ` (${anschluss.text})` : '';
  return {
    severity: 'warn',
    text:
      `${ort} wird auf DN ${pruefung.geraet} angehoben. Hydraulisch nötig wäre DN ${pruefung.hydraulisch}; ` +
      `der Geräteanschluss${text} verlangt DN ${pruefung.geraet}, und die Herstellervorgabe gewinnt: ` +
      `Gerätedruckverlust, Mindestvolumenstrom und Abtauverhalten sind auf das Anschlussmaß bezogen, und die Gewährleistung hängt daran. ` +
      `Verjüngt wird erst hinter der ersten Abzweigung.${woher}`,
  };
}

/**
 * Der Befund zu einer Angabe, die sich nicht deuten ließ.
 *
 * Ohne ihn wäre der häufigste Bedienfehler unsichtbar: Wer „1 1/4 Zoll"
 * schreibt, wird verstanden; wer „G1-1/4AG" ohne Trennzeichen schreibt,
 * vielleicht nicht — und dann läuft die Auslegung stillschweigend so weiter,
 * als hätte er gar nichts eingetragen.
 */
export function deutungsNotiz(anschluss: Anschluss): PlanningNote | undefined {
  if (!anschluss.unlesbar) return undefined;
  return {
    severity: 'warn',
    text:
      `Die Anschlussgröße „${anschluss.unlesbar}" lässt sich nicht in eine Nennweite umsetzen. ` +
      `Sie steht im Anlagenbuch, wirkt aber nicht auf die Rohrauslegung. ` +
      `Nennweite von Hand eintragen (DN 25, DN 32 …) oder die Angabe in einer gebräuchlichen Schreibweise erfassen — „G 1¼ AG", „DN 32", „Cu 28 × 1,0".`,
  };
}
