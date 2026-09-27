/**
 * Prüfblock „Verbrauchsabgleich" — die zweite Zahl zur Heizlast.
 *
 * **Worum es geht.** Dieses Programm rechnet die Heizlast aus der
 * Gebäudehülle. Das ist der richtige Weg und hat eine Schwäche: Er prüft sich
 * an nichts. Ein zu günstiger U-Wert bleibt plausibel, weil das Ergebnis eine
 * Rechnung ist. Der gemessene Verbrauch dagegen ist gemessen worden — und wo
 * zwei Wege zu derselben Größe auseinanderlaufen, kann das Programm es sagen.
 *
 * **Was hier bewiesen wird.** Vor allem eines: dass die *Herleitung* den
 * Leitfaden trifft. Der BWP-Praxisratgeber nennt zwei Teiler — 250 für den
 * Jahresverbrauch in Litern oder Kubikmetern, 300 nach der Schweizer Formel,
 * wenn das Warmwasser mit drinsteckt. Dieses Modul rechnet nicht mit Teilern,
 * sondern mit Energie und Vollbenutzungsstunden, weil sich damit auch eine
 * Gasrechnung in Kilowattstunden verarbeiten lässt. Beide Wege **müssen auf
 * dieselbe Zahl kommen**, und genau das steht unten als Gleichung.
 *
 * Alle Sollwerte sind von Hand gerechnet und im Kommentar hergeleitet.
 *
 * Quelle: BWP-Praxisratgeber „Modernisieren mit Wärmepumpe", Schritt 2
 * (Heizlastermittlung), S. 18 — Einstiegsrechnung und die Grafik
 * „Endenergieverbrauch bei unterschiedlichen Baualtersklassen".
 */

import type { CheckFn } from './typ';
import {
  BAUALTERSKLASSEN,
  SCHWELLE,
  VOLLBENUTZUNGSSTUNDEN,
  heizlastAusBaualter,
  heizlastAusVerbrauch,
  verbrauchsabgleich,
} from '../../src/lib/verbrauchsabgleich';

export function pruefeVerbrauchsabgleich(check: CheckFn): void {
  // =========================================================================
  // 1 · Die Herleitung trifft den Leitfaden
  // =========================================================================
  {
    /*
     * Der Leitfaden: „Bestehender Ölverbrauch pro Jahr in l : 250 = kW".
     * Dieses Modul: 2500 l · 10 kWh/l = 25 000 kWh, geteilt durch 2500 h.
     *
     *     25 000 / 2500 = 10,00 kW      und      2500 / 250 = 10,00 kW
     *
     * Die beiden Wege sind dieselbe Gleichung, einmal über den Teiler und
     * einmal über die Stunden. Wären sie es nicht, wäre die Herleitung der
     * Vollbenutzungsstunden falsch — und die ist die einzige Stelle, an der
     * dieses Modul über den Leitfaden hinausgeht.
     */
    const oel = heizlastAusVerbrauch({ brennstoff: 'oel', menge: 2500, mitWarmwasser: false });
    check('Verbrauch · 2500 l Öl ohne Warmwasser [kW]', oel?.wert ?? -1, 10);
    check('Verbrauch · derselbe Wert über den Teiler 250', oel?.wert ?? -1, 2500 / 250);
    check('Verbrauch · zugrunde gelegte Endenergie [kWh/a]', oel?.endenergie ?? -1, 25000);
    check('Verbrauch · Vollbenutzungsstunden ohne Warmwasser [h]', oel?.stunden ?? -1, 2500);

    /*
     * „Nach der sogenannten Schweizer Formel, bei der auch Warmwasser
     * berücksichtigt wird, ist der Divisor 300."
     *
     *     2500 / 300 = 8,3333… → auf zwei Stellen 8,33 kW
     *
     * Die Zahl wird **kleiner**, und das ist richtig: Ein Teil des
     * abgelesenen Verbrauchs war kein Heizen.
     */
    const mitWw = heizlastAusVerbrauch({ brennstoff: 'oel', menge: 2500, mitWarmwasser: true });
    check('Verbrauch · dieselben 2500 l mit Warmwasser [kW]', mitWw?.wert ?? -1, 8.33);
    check('Verbrauch · und das ist 2500/300', mitWw?.wert ?? -1, Math.round((2500 / 300) * 100) / 100);
    check('Verbrauch · Warmwasser macht die Heizlast kleiner', (mitWw?.wert ?? 0) < (oel?.wert ?? 0), true);
    check('Verbrauch · Vollbenutzungsstunden mit Warmwasser [h]', mitWw?.stunden ?? -1, 3000);

    /*
     * Derselbe Teiler gilt im Leitfaden für Kubikmeter Erdgas — das ist der
     * Grund, aus dem beide mit 10 kWh je Einheit angesetzt sind.
     *     2400 / 250 = 9,60 kW
     */
    const gas = heizlastAusVerbrauch({ brennstoff: 'erdgas', menge: 2400, mitWarmwasser: false });
    check('Verbrauch · 2400 m³ Erdgas ohne Warmwasser [kW]', gas?.wert ?? -1, 9.6);

    /*
     * Und wer die Kilowattstunden von der Rechnung hat, braucht keinen
     * Heizwert: 24 000 kWh / 3000 h = 8,00 kW.
     */
    const kwh = heizlastAusVerbrauch({ brennstoff: 'kwh', menge: 24000, mitWarmwasser: true });
    check('Verbrauch · 24 000 kWh mit Warmwasser [kW]', kwh?.wert ?? -1, 8);
    check('Verbrauch · Energie bleibt Energie', kwh?.endenergie ?? -1, 24000);

    check('Verbrauch · die beiden Stundenzahlen', `${VOLLBENUTZUNGSSTUNDEN.ohneWarmwasser}/${VOLLBENUTZUNGSSTUNDEN.mitWarmwasser}`, '2500/3000');

    /*
     * **Der Rechenweg steht im Klartext dabei.** Eine Zahl ohne ihren Weg ist
     * in diesem Programm keine Auskunft — wer sie nachrechnen will, soll
     * nicht im Quelltext suchen müssen.
     */
    check('Verbrauch · der Rechenweg nennt den Teiler', (oel?.rechenweg ?? '').includes('÷ 250'), true);
    check('Verbrauch · und die Stunden', (oel?.rechenweg ?? '').includes('2500 h'), true);
  }

  // =========================================================================
  // 2 · Ohne Angabe keine Zahl
  // =========================================================================
  {
    /*
     * Eine Gegenprobe, die aus dem Nichts eine 0 macht, ist schlimmer als
     * keine: „0,00 kW" liest sich wie ein Ergebnis.
     */
    check('Verbrauch · ohne Angabe nichts', heizlastAusVerbrauch(undefined) === undefined, true);
    check('Verbrauch · Menge 0 ergibt nichts', heizlastAusVerbrauch({ brennstoff: 'oel', menge: 0, mitWarmwasser: true }) === undefined, true);
    check('Baualter · ohne Klasse nichts', heizlastAusBaualter(undefined, 150) === undefined, true);
    check('Baualter · unbekannte Klasse ergibt nichts', heizlastAusBaualter('gibt-es-nicht', 150) === undefined, true);
    check('Baualter · ohne Fläche nichts', heizlastAusBaualter('efh-f', 0) === undefined, true);
  }

  // =========================================================================
  // 3 · Die acht Baualtersklassen
  // =========================================================================
  {
    /*
     * Die Zahlen der Grafik, von Hand abgeschrieben und hier gegengelesen.
     * Sie stehen doppelt, und das ist der Zweck: Wer den Katalog anfasst,
     * muss es hier noch einmal tun und dabei nachsehen, woher der Wert kommt.
     *
     * Die Reihe fällt **nicht** durchgehend — 249 für „bis 1948" liegt unter
     * 268 für „1949 bis 1957". Das ist kein Übertragungsfehler: Die
     * Nachkriegsjahre haben schlechter gebaut als die Zeit davor.
     */
    const soll: [string, number][] = [
      ['bis 1948', 249],
      ['1949 bis 1957', 268],
      ['1958 bis 1968', 266],
      ['1969 bis 1978', 237],
      ['ab WSchV 1977', 200],
      ['ab WSchV 1982', 159],
      ['ab WSchV 1995', 109],
      ['ab EnEV 2002/2007', 95.5],
    ];
    check('Baualter · acht Klassen', BAUALTERSKLASSEN.length, 8);
    for (const [i, [label, spez]] of soll.entries()) {
      check(`Baualter · ${label}`, BAUALTERSKLASSEN[i]?.label ?? 'fehlt', label);
      check(`Baualter · ${label} [kWh/(m²·a)]`, BAUALTERSKLASSEN[i]?.spezifisch ?? -1, spez);
    }
    check(
      'Baualter · die Nachkriegsklasse liegt über der Vorkriegsklasse',
      (BAUALTERSKLASSEN[1]?.spezifisch ?? 0) > (BAUALTERSKLASSEN[0]?.spezifisch ?? 0),
      true,
    );

    /*
     * 150 m² der Klasse „1969 bis 1978":
     *     150 · 237 = 35 550 kWh/a
     *     35 550 / 3000 h = 11,85 kW
     */
    const b = heizlastAusBaualter('efh-f', 150, true);
    check('Baualter · 150 m² Baujahr 1969–1978 [kW]', b?.wert ?? -1, 11.85);
    check('Baualter · zugrunde gelegte Endenergie [kWh/a]', b?.endenergie ?? -1, 35550);
    check('Baualter · der Rechenweg zeigt die Fläche', (b?.rechenweg ?? '').includes('150 m²'), true);
  }

  // =========================================================================
  // 4 · Der Abgleich und seine Schwellen
  // =========================================================================
  {
    check('Abgleich · die Schwellen dieses Programms [%]', `${SCHWELLE.deckung}/${SCHWELLE.warnung}`, '15/30');

    /*
     * Überschlag 10,00 kW, Gegenprobe 11,85 kW:
     *     (11,85 − 10,00) / 10,00 = 0,185 → +18,5 %
     * Das liegt über 15 und unter 30, also „nachsehen".
     */
    const a = verbrauchsabgleich(10, [heizlastAusBaualter('efh-f', 150, true)]);
    check('Abgleich · eine Zeile', a.zeilen.length, 1);
    check('Abgleich · Abweichung [%]', a.zeilen[0]?.abweichung ?? -999, 18.5);
    check('Abgleich · Urteil', a.zeilen[0]?.urteil ?? 'fehlt', 'nachsehen');
    check('Abgleich · und die Deutung nennt die Richtung', (a.zeilen[0]?.deutung ?? '').includes('höher'), true);

    /*
     * Die Schwellen **an ihrer Kante**. Ohne diese vier Zeilen prüft der
     * Block nur, dass irgendwo eine Grenze liegt, nicht wo.
     * Bezug ist jeweils ein Überschlag von 10 kW:
     *     11,50 → +15,0 %  (genau auf der Schwelle: deckt sich)
     *     11,60 → +16,0 %  (darüber: nachsehen)
     *     13,00 → +30,0 %  (genau auf der zweiten: nachsehen)
     *     13,10 → +31,0 %  (darüber: passt nicht)
     */
    const kante = (kw: number) =>
      verbrauchsabgleich(10, [heizlastAusVerbrauch({ brennstoff: 'kwh', menge: kw * 2500, mitWarmwasser: false })])
        .zeilen[0]?.urteil ?? 'fehlt';
    check('Abgleich · +15,0 % deckt sich noch', kante(11.5), 'deckt-sich');
    check('Abgleich · +16,0 % heißt nachsehen', kante(11.6), 'nachsehen');
    check('Abgleich · +30,0 % heißt noch nachsehen', kante(13), 'nachsehen');
    check('Abgleich · +31,0 % passt nicht', kante(13.1), 'passt-nicht');

    /*
     * **Auch nach unten.** Eine Schwelle, die nur in eine Richtung greift,
     * übersieht den halben Fehlerraum: Ein Überschlag, der viel zu hoch ist,
     * ist genauso falsch wie einer, der zu niedrig ist.
     *     6,90 kW gegen 10,00 → −31,0 %
     */
    const runter = verbrauchsabgleich(10, [heizlastAusVerbrauch({ brennstoff: 'kwh', menge: 6.9 * 2500, mitWarmwasser: false })]);
    check('Abgleich · −31,0 % passt ebenso wenig', runter.zeilen[0]?.urteil ?? 'fehlt', 'passt-nicht');
    check('Abgleich · Abweichung negativ [%]', runter.zeilen[0]?.abweichung ?? 999, -31);
    check('Abgleich · und die Deutung nennt die andere Richtung', (runter.zeilen[0]?.deutung ?? '').includes('niedriger'), true);

    /*
     * Das Gesamturteil ist das **strengste** der Zeilen, nicht der
     * Durchschnitt: Wer zwei Gegenproben hat und eine davon widerspricht,
     * hat ein Problem und keinen Mittelwert.
     */
    const zwei = verbrauchsabgleich(10, [
      heizlastAusVerbrauch({ brennstoff: 'kwh', menge: 10 * 2500, mitWarmwasser: false }),
      heizlastAusBaualter('efh-d', 150, true),
    ]);
    check('Abgleich · zwei Zeilen', zwei.zeilen.length, 2);
    check('Abgleich · die erste deckt sich', zwei.zeilen[0]?.urteil ?? 'fehlt', 'deckt-sich');
    check('Abgleich · das Gesamturteil ist das strengste', zwei.urteil ?? 'fehlt', 'passt-nicht');

    /*
     * Ohne Überschlag kein Abgleich — es gibt dann nichts, wogegen man
     * prüfen könnte, und eine Abweichung „gegenüber 0" wäre unendlich.
     */
    const ohne = verbrauchsabgleich(0, [heizlastAusBaualter('efh-f', 150)]);
    check('Abgleich · ohne Überschlag keine Zeile', ohne.zeilen.length, 0);
    check('Abgleich · und kein Urteil', ohne.urteil === undefined, true);
  }
}
