/**
 * Von der Raumheizlast zur Normleistung des Heizkörpers.
 * ---------------------------------------------------------------------------
 * **Die Forderung, aus der dieses Modul entstanden ist:** „Bei den
 * Heizkörpern sollten die automatisch die kW-Zahl des Raumes annehmen."
 * Fachlich richtig — die Heizfläche eines Raums muss dessen Heizlast decken.
 * Nur ist „annehmen" nicht „abschreiben".
 *
 * **Warum man die Zahl nicht einfach übernehmen darf.** `params.powerW` ist
 * die **Normwärmeleistung nach DIN EN 442-2**, also die Leistung bei 55/45/20 °C.
 * Die Raumheizlast ist die Leistung, die im **Auslegungsbetriebspunkt** der
 * Anlage gebraucht wird — bei einer Wärmepumpe mit ertüchtigten Heizkörpern
 * etwa 50/40, bei einer Flächenheizung 35/28. Beides sind Leistungen, aber
 * nicht dieselbe Leistung.
 *
 * Schreibt man die Heizlast unverändert ins Feld, ist der Heizkörper zu
 * klein — und zwar umso deutlicher, je niedriger die Anlage fährt:
 *
 *     1600 W Raumheizlast bei 50/40/20  →  2040 W Normleistung  (+28 %)
 *     1600 W Raumheizlast bei 45/38/20  →  2470 W Normleistung  (+54 %)
 *     1600 W Raumheizlast bei 35/28/20  →  5730 W Normleistung  (+258 %)
 *
 * (Nachgerechnet mit diesem Modul, n = 1,3; die Zahlen stehen so auch im
 * Prüfblock. Wer sie hier ändert, muss dort nachziehen — und umgekehrt.)
 *
 * Die letzte Zeile ist zugleich die Antwort auf die Frage, warum ein
 * Altbauheizkörper an einer Wärmepumpe oft nicht reicht: Nicht der
 * Heizkörper ist schlechter geworden, die Übertemperatur ist kleiner.
 *
 * **Die Umrechnung** (DIN EN 442-2):
 *
 *     Q = Q_norm · (Δϑ / Δϑ_norm)^n
 *
 * nach Q_norm aufgelöst, mit Δϑ als logarithmisch gemittelter Übertemperatur
 * und n als Heizkörperexponent aus dem Datenblatt. Für n gibt es hier keinen
 * eigenen Wert: Es gilt der am Objekt erfasste, und ersatzweise der
 * ausgewiesene Richtwert aus `auslegungExport` — dieselbe Zahl, die auch die
 * Übergabe an RaVia als Annahme kennzeichnet.
 *
 * Schichtgrenze: nur Typen und andere lib-Bausteine.
 */

import type { FixtureType } from '../types/bim';
import { EMITTER_EXPONENT_ANNAHME, NORM_TEMPERATUREN } from './auslegungExport';
import { logMeanOverTemperature } from './hydraulics';

/** Das Ergebnis einer Umrechnung — mit allem, was zur Beurteilung nötig ist. */
export interface Normleistung {
  /** Die gesuchte Normleistung bei 55/45/20 °C [W]. */
  watt: number;
  /** Übertemperatur im Betriebspunkt [K]. */
  uebertemperatur: number;
  /** Verwendeter Heizkörperexponent [-]. */
  exponent: number;
  /** Stammt der Exponent vom Objekt oder aus dem Richtwert? */
  exponentAngenommen: boolean;
  /** Faktor zwischen Raumheizlast und Normleistung — für die Begründung. */
  faktor: number;
}

/** Die Übertemperatur am Normpunkt 55/45/20 °C — rund 29,7 K. */
export const NORM_UEBERTEMPERATUR = logMeanOverTemperature(
  NORM_TEMPERATUREN.vorlauf,
  NORM_TEMPERATUREN.ruecklauf,
  NORM_TEMPERATUREN.raum,
);

/**
 * Die Normleistung, die ein Heizkörper haben muss, um eine Heizlast zu decken.
 *
 * `null` bei allem, was sich nicht rechnen lässt — keine Heizlast, keine
 * brauchbaren Systemtemperaturen, unbekannte Bauart. **Kein Ersatzwert:** Ein
 * Vorschlag, der auf geratenen Temperaturen beruht, sieht genauso aus wie
 * einer auf erfassten, und der Anwender kann die beiden dann nicht mehr
 * auseinanderhalten.
 */
export function normleistungFuerHeizlast(opt: {
  /** Heizlast, die dieser eine Heizkörper decken soll [W]. */
  heizlast: number;
  /** Auslegungs-Vorlauftemperatur der Anlage [°C]. */
  vorlauf: number;
  /** Auslegungs-Rücklauftemperatur [°C]. */
  ruecklauf: number;
  /** Raumtemperatur im Auslegungsfall [°C]. */
  raum: number;
  /** Bauart — bestimmt den Richtwert des Exponenten. */
  type: FixtureType;
  /** Am Objekt erfasster Exponent, falls vorhanden. */
  exponent?: number;
}): Normleistung | null {
  if (!Number.isFinite(opt.heizlast) || opt.heizlast <= 0) return null;

  const dt = logMeanOverTemperature(opt.vorlauf, opt.ruecklauf, opt.raum);
  /*
   * Eine Übertemperatur unter 5 K ist keine Auslegung, sondern ein
   * Eingabefehler — etwa ein Vorlauf von 22 °C bei 20 °C Raumtemperatur. Der
   * Faktor liefe gegen unendlich, und der Vorschlag stünde bei 40 kW für ein
   * Schlafzimmer. Lieber gar kein Vorschlag.
   */
  if (dt < 5) return null;

  const richtwert = EMITTER_EXPONENT_ANNAHME[opt.type];
  const exponent = opt.exponent ?? richtwert;
  if (exponent === undefined) return null;

  const faktor = Math.pow(NORM_UEBERTEMPERATUR / dt, exponent);
  return {
    // Auf 10 W gerundet: Eine Heizfläche wird ohnehin aus einer Baureihe
    // gewählt, und eine Zahl wie „2037 W" behauptet eine Genauigkeit, die
    // eine geschätzte Heizlast nicht hat.
    watt: Math.round((opt.heizlast * faktor) / 10) * 10,
    uebertemperatur: Math.round(dt * 10) / 10,
    exponent,
    exponentAngenommen: opt.exponent === undefined,
    faktor: Math.round(faktor * 1000) / 1000,
  };
}

/**
 * Wie sich eine Raumheizlast auf mehrere Heizflächen im selben Raum verteilt.
 *
 * **Gleichmäßig — und das ist eine Annahme, keine Rechnung.** Wie die Last
 * sich in Wirklichkeit teilt, hängt davon ab, wo die Heizkörper stehen, wie
 * groß sie sind und welche Fenster sie abschirmen. Nichts davon steht im
 * Modell. Gleichmäßig zu teilen ist die einzige Aufteilung, die sich ohne
 * weitere Angabe begründen lässt — sie muss deshalb im Heft als Annahme
 * stehen und nicht als Ergebnis.
 *
 * Der praktische Grund, es trotzdem zu tun: Ohne Teilung bekäme jeder von
 * zwei Heizkörpern die volle Raumheizlast, und der Raum wäre auf dem Papier
 * doppelt beheizt. Das ist die schlechtere Annahme.
 */
export function anteilJeHeizflaeche(heizlast: number, anzahl: number): number {
  if (anzahl <= 0) return 0;
  return heizlast / anzahl;
}

/** Die Bauarten, die als Heizfläche im Sinne dieser Umrechnung gelten. */
export const HEIZFLAECHEN_BAUARTEN: readonly FixtureType[] = ['radiator', 'radiator-tube', 'convector'];

export function istHeizflaeche(type: FixtureType): boolean {
  return HEIZFLAECHEN_BAUARTEN.includes(type);
}

/**
 * Die Begründung, die neben einer abgeleiteten Leistung steht.
 *
 * Sie ist kein Schmuck. Eine Zahl, die das Programm gesetzt hat, muss sich
 * von einer unterscheiden lassen, die jemand abgelesen hat — und der
 * Unterschied muss **lesbar** sein, nicht nur im Datensatz vermerkt.
 */
export function leistungsBegruendung(n: Normleistung, anzahl: number, heizlast: number): string {
  const teil = anzahl > 1 ? ` (${anzahl} Heizflächen, Last gleichmäßig geteilt)` : '';
  // Deutsches Dezimalkomma auch beim Exponenten: „n = 1.3" in einem sonst
  // durchgehend deutschen Satz liest sich wie ein Tippfehler.
  const nStr = n.exponent.toFixed(2).replace('.', ',');
  const exp = n.exponentAngenommen ? ` n = ${nStr} angenommen` : ` n = ${nStr}`;
  return (
    `Aus ${Math.round(heizlast)} W Raumheizlast${teil} bei Δϑ = ${n.uebertemperatur
      .toFixed(1)
      .replace('.', ',')} K;` +
    ` Faktor ${n.faktor.toFixed(3).replace('.', ',')} auf 55/45/20,${exp}.`
  );
}
