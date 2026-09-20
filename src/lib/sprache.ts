/**
 * Sprachen — und warum die deutschen Fachbegriffe stehen bleiben.
 * ---------------------------------------------------------------------------
 * **Wen das betrifft.** Nicht andere Märkte, sondern **Deutschland**. Rund
 * jeder fünfte Beschäftigte in einem Handwerksberuf hat keinen deutschen
 * Pass, bei den Auszubildenden im Handwerk sind es über 13 %, und die
 * eigentliche Zielgruppe ist noch größer: Wer in Duisburg geboren ist und
 * zu Hause Türkisch spricht, taucht in keiner dieser Statistiken auf und
 * liest technisches Deutsch trotzdem langsamer, als er es spricht.
 *
 * **Was daraus folgt — und es ist nicht das Naheliegende.**
 *
 * Die Baustelle bleibt deutsch. Auf dem Lieferschein steht „Vorlauf", der
 * Großhändler sagt „Vorlauf", der Bauleiter fragt nach dem „Vorlauf", und
 * im Rohrnetzbericht steht „Vorlauf". Wer dieses Wort in der Software
 * übersetzt, macht den Monteur in der Software mündig und auf der Baustelle
 * stumm. **Das ist keine Hilfe, das ist eine Falle.**
 *
 * Deshalb die Regel, die dieses Modul durchsetzt:
 *
 *     Der Fachbegriff bleibt deutsch. Der Satz drumherum wird übersetzt.
 *
 * Aus „Der Vorlauf ist die Leitung vom Erzeuger zum Heizkörper." wird
 * „**Vorlauf** — sıcak suyun kazandan radyatöre gittiği boru." Der Begriff
 * steht da, wo er steht, und nebenbei lernt man ihn.
 *
 * **Warum der deutsche Text selbst der Schlüssel ist.** Die Alternative
 * wären Schlüssel wie `toolbar.wall.draw`. Sie hätte den deutschen Text aus
 * dem Bauteil herausgezogen und durch eine Abkürzung ersetzt — 850-mal, und
 * danach liest sich kein Bauteil mehr von selbst. Hier ist der deutsche
 * Satz der Schlüssel: Im Quelltext bleibt alles lesbar, eine fehlende
 * Übersetzung fällt von allein auf Deutsch zurück, und die Umstellung eines
 * Textes ist ein Einzeiler statt einer Wanderung durch drei Dateien.
 *
 * Der Preis ist die Mehrdeutigkeit: „Decke" ist ein Bauteil und ein
 * Möbelstück. Dafür gibt es den zweiten Parameter `zusammenhang`.
 *
 * **Was dieses Modul nicht tut.** Es rät nicht. Fehlt eine Übersetzung,
 * kommt der deutsche Satz zurück — sichtbar und unverfälscht. Eine halb
 * übersetzte Oberfläche ist unangenehm; eine falsch übersetzte ist
 * gefährlich.
 *
 * **Eine Regel für den Aufrufort, und sie ist wichtiger als sie aussieht:**
 * `t()` gehört **dorthin, wo der Text angezeigt wird** — nie in eine
 * Konstante auf Modulebene. Eine Tabelle wie `TOOLS` oder
 * `PIPE_SERVICE_LABELS` wird genau einmal ausgewertet, beim Laden der
 * Datei. Stünde `t()` darin, wäre die Sprache eingefroren, die zufällig
 * beim Laden galt, und das Umschalten bliebe wirkungslos — bei einer
 * Tabelle sichtbar, bei der nächsten nicht. Die Tabellen bleiben deshalb
 * reine deutsche Datentabellen (das hält sie auch prüfbar), und übersetzt
 * wird an der Stelle, an der gezeichnet wird.
 *
 * Schichtgrenze: keine Abhängigkeiten außer den Katalogen daneben.
 */

import { KATALOGE } from './sprachen/katalog';

/**
 * Die Sprachen, die die Oberfläche sprechen kann.
 *
 * Die Auswahl folgt den Herkunftssprachen im deutschen Handwerk, nicht
 * einer Marktlandkarte: Türkisch, Polnisch, Russisch, Italienisch,
 * Rumänisch. Russisch steht dabei nicht nur für Russland — es ist für viele
 * aus den Nachfolgestaaten der Sowjetunion die gemeinsame Verkehrssprache
 * und hat damit den größten Wirkungsgrad je übersetztem Satz.
 */
export type Sprache = 'de' | 'tr' | 'pl' | 'ru' | 'it' | 'ro';

export interface Sprachangabe {
  code: Sprache;
  /**
   * Der Name der Sprache **in der Sprache selbst**.
   *
   * **Und keine Flagge.** Eine Flagge bezeichnet ein Land, keine Sprache.
   * Welche für Englisch — die britische oder die amerikanische? Für Deutsch
   * — DE, AT oder CH? Schlimmer noch in genau dieser Zielgruppe: Ein
   * russischsprachiger Kasache klickt nicht gern auf eine russische Flagge,
   * ein kurdischer Monteur nicht auf eine türkische. Der Eigenname fällt
   * genauso schnell ins Auge und tritt niemandem auf den Fuß.
   */
  eigenname: string;
  /** Derselbe Name auf Deutsch — für Listen, die ein Deutscher liest. */
  deutsch: string;
}

export const SPRACHEN: readonly Sprachangabe[] = [
  { code: 'de', eigenname: 'Deutsch', deutsch: 'Deutsch' },
  { code: 'tr', eigenname: 'Türkçe', deutsch: 'Türkisch' },
  { code: 'pl', eigenname: 'Polski', deutsch: 'Polnisch' },
  { code: 'ru', eigenname: 'Русский', deutsch: 'Russisch' },
  { code: 'it', eigenname: 'Italiano', deutsch: 'Italienisch' },
  { code: 'ro', eigenname: 'Română', deutsch: 'Rumänisch' },
];

/**
 * Begriffe, die **nie** übersetzt werden.
 *
 * Das ist keine Bequemlichkeitsliste, sondern eine Schutzliste. Jeder
 * Eintrag hier ist ein Wort, das der Monteur auf der Baustelle **hören und
 * sagen** muss: Es steht auf dem Lieferschein, im Angebot, im Bericht, im
 * Prüfprotokoll. Ein Wort, das die Software anders nennt als die Baustelle,
 * kostet ihn genau dort etwas, wo er es sich nicht leisten kann.
 *
 * `scripts/pruefungen/sprache.ts` hält jeden Katalog dagegen: Taucht einer
 * dieser Begriffe als übersetzter Eintrag auf, fällt der Prüflauf. Die
 * Liste ist damit nicht nur Dokumentation, sondern eine Schranke.
 */
export const FACHBEGRIFFE: readonly string[] = [
  // Heizung
  'Vorlauf', 'Rücklauf', 'Heizlast', 'Heizkörper', 'Fußbodenheizung',
  'Wärmepumpe', 'Estrich', 'Kniestock', 'Kesselleistung', 'Systemtemperatur',
  'Thermostatventil', 'Voreinstellung', 'Ventilautorität', 'Hydraulischer Abgleich',
  'Nennweite', 'Volumenstrom', 'Restförderhöhe', 'Norm-Außentemperatur',
  'Doppelleitung', 'Strang', 'Teilstrecke', 'Verteiler', 'Puffer',
  // Bau
  'Kniestock', 'Brüstung', 'Sturz', 'Laibung', 'Geschossdecke', 'Bodenplatte',
  'Kernbohrung', 'Wanddurchbruch', 'Wandschlitz', 'Rohdecke', 'Fertigfußboden',
  'Gaube', 'Traufe', 'First', 'Dachschräge', 'Kehlbalken', 'Krüppelwalm',
  // Bauphysik und Nachweise
  'U-Wert', 'Wärmebrücke', 'Lüftungswärmeverlust', 'Transmissionswärmeverlust',
  'Blower-Door', 'Hüllfläche', 'Absenkbetrieb', 'Erdreich',
  // Dokumente und Recht
  'GEG', 'GModG', 'DIN', 'VDI', 'TA Lärm', 'Massenauszug', 'Aufmaß',
  'Anlagenbuch', 'Rohrnetzbericht', 'Projektmappe', 'Raumbuch',
];

/**
 * Die gerade eingestellte Sprache.
 *
 * Sie steht hier als Modulzustand und nicht im Dokument: Sie beschreibt,
 * **wer gerade davorsitzt**, nicht das Gebäude. Zwei Monteure am selben
 * Projekt dürfen es in verschiedenen Sprachen bedienen, ohne sich
 * gegenseitig die Einstellung zu überschreiben — und ein Projekt, das aus
 * einer türkischen Sitzung kommt, darf beim nächsten nicht plötzlich
 * türkisch aufgehen.
 */
let aktiv: Sprache = 'de';

export function spracheSetzen(s: Sprache): void {
  aktiv = SPRACHEN.some((x) => x.code === s) ? s : 'de';
}

export function spracheHolen(): Sprache {
  return aktiv;
}

/** Schlüssel eines Eintrags — Text, bei Bedarf mit Zusammenhang. */
export function schluessel(text: string, zusammenhang?: string): string {
  return zusammenhang ? `${text}\u0000${zusammenhang}` : text;
}

/**
 * Einen Text in die eingestellte Sprache bringen.
 *
 * **Der Rückfall ist Deutsch und das ist die Zusage.** Fehlt ein Eintrag,
 * steht der deutsche Satz da — vollständig, richtig und erkennbar deutsch.
 * Er ist damit nie falsch, nur manchmal noch nicht übersetzt. Der
 * umgekehrte Weg, ein maschinell erzeugter Platzhalter, wäre in einem
 * Werkzeug, aus dem eine Heizlast fällt, nicht zu verantworten.
 *
 * `zusammenhang` trennt gleiche Wörter mit verschiedener Bedeutung —
 * `t('Decke', 'Bauteil')` gegen `t('Decke', 'Textil')`. Er erscheint
 * nirgends in der Oberfläche; er ist nur ein Unterscheidungsmerkmal für
 * den Katalog.
 */
export function t(text: string, zusammenhang?: string): string {
  if (aktiv === 'de') return text;
  const katalog = KATALOGE[aktiv];
  if (!katalog) return text;
  return katalog[schluessel(text, zusammenhang)] ?? katalog[text] ?? text;
}

/**
 * Ein Fachbegriff — bleibt in jeder Sprache stehen.
 *
 * **Warum es diese Funktion gibt, obwohl sie nichts tut.** Sie tut genau
 * deshalb nichts, weil hier nichts geschehen darf. Ihr Zweck ist die
 * *Absicht im Quelltext*: Wer `fach('Vorlauf')` liest, sieht, dass das Wort
 * bewusst deutsch bleibt, und wickelt es nicht beim nächsten Durchgang in
 * ein `t()`. Ohne sie wäre ein nicht übersetzter Fachbegriff von einem
 * vergessenen Text nicht zu unterscheiden — und jemand, der aufräumt,
 * würde genau das Falsche aufräumen.
 */
export function fach(begriff: string): string {
  return begriff;
}

/** Ist dieser Text ein geschützter Fachbegriff? */
export function istFachbegriff(text: string): boolean {
  return FACHBEGRIFFE.includes(text.trim());
}
