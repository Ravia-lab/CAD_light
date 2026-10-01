/**
 * Der Volumenstrom der Primärseite — Sole- oder Brunnenkreis.
 *
 * **Die Lücke, die das hier schließt.** Der BWP-Leitfaden Hydraulik legt die
 * Sekundärseite nach der maximalen **Heizleistung** aus und die Primärseite
 * nach der höchsten **Kälteleistung**. Seine Gleichung (2) ist die Brücke
 * zwischen beiden:
 *
 *     Q̇_c = Q̇_H · (1 − 1/COP)
 *
 * Dieselbe Gleichung steht in `heatPump.ts` als Entzugsleistung
 * Q̇_0 = Q̇ · (COP−1)/COP — algebraisch identisch, nur anders geschrieben. Sie
 * wurde dort aber nur für Sondenmeter und Kollektorfläche benutzt; **der
 * einzustellende Volumenstrom des Primärkreises wurde nirgends gebildet.**
 * Damit fehlte die eine Zahl, die der Monteur am Sole-Verteiler tatsächlich
 * einstellt.
 *
 * **Warum eine zweite Zahl daneben steht.** Tabelle 1 des Leitfadens gibt den
 * Volumenstrom je kW für Wasser bei sechs Spreizungen vor. Dieses Modul
 * rechnet nicht aus der Tabelle, sondern aus den Stoffwerten
 * (`hydraulics.fluidProperties`) — und hält das Ergebnis **gegen** die
 * Tabelle. Zwei Wege zu derselben Größe: Laufen sie auseinander, stimmt etwas
 * nicht, und das lässt sich sagen. Eine Rechnung, die nur sich selbst gleicht,
 * könnte das nicht.
 *
 * **Was hier nicht passiert.** Es wird keine Spreizung erfunden. Der Leitfaden
 * nennt 3 bis 5 K bei maximaler Kälteleistung; liegt die Eingabe außerhalb,
 * sagt das Ergebnis es und rechnet trotzdem — die Anlage gehört dem Planer.
 */

import { fluidProperties, volumeFlow, type GlycolKind } from './hydraulics';

/**
 * Tabelle 1 des BWP-Leitfadens Hydraulik: einzustellender Volumenstrom je kW
 * für **Wasser** [l/(h·kW)], nach Spreizung [K].
 *
 * Von Hand abgeschrieben und nicht gerechnet — das ist der Zweck: Sie ist die
 * unabhängige Gegenprobe zur Stoffwertrechnung. Die Werte folgen
 * V̇ = 3600 · 1000 / (ρ·c_p·ΔT) mit ρ·c_p ≈ 4,19 MJ/(m³·K), sind im Leitfaden
 * aber gerundet veröffentlicht, und genau diese gerundeten Zahlen stehen hier.
 */
export const TABELLE1_WASSER: Readonly<Record<number, number>> = {
  3: 287,
  4: 215,
  5: 172,
  6: 144,
  8: 108,
  10: 86,
};

/** Spreizung der Primärseite bei maximaler Kälteleistung, Leitfaden. */
export const PRIMAER_SPREIZUNG: readonly [number, number] = [3, 5];

/**
 * Kälteleistung aus Heizleistung und COP — Gleichung (2) des Leitfadens.
 *
 * Bei COP ≤ 1 gibt es keine sinnvolle Antwort: Eine Wärmepumpe, die nicht mehr
 * Wärme abgibt als sie Strom aufnimmt, entzieht der Quelle nichts. Statt eine
 * negative Leistung zurückzugeben — die sich hinterher als Volumenstrom
 * tarnt — wird hier 0 geliefert, und der Aufrufer sieht am Hinweis, warum.
 */
export function kaelteleistung(heizleistungKw: number, cop: number): number {
  if (!Number.isFinite(cop) || cop <= 1) return 0;
  return heizleistungKw * (1 - 1 / cop);
}

export interface Primaerauslegung {
  /** Kälteleistung Q̇_c [kW]. */
  kaelteleistungKw: number;
  /** Einzustellender Volumenstrom [m³/h]. */
  volumenstromM3h: number;
  /** Derselbe Wert in Litern je Stunde — so steht er am Verteiler. */
  volumenstromLh: number;
  /** Bezogener Volumenstrom [l/(h·kW)] — vergleichbar mit Tabelle 1. */
  bezogenLhKw: number;
  /** Tabelle 1 für Wasser bei dieser Spreizung [l/(h·kW)], falls aufgeführt. */
  tabelleLhKw?: number;
  /**
   * Abweichung der Stoffwertrechnung von Tabelle 1 [%] — nur bei reinem
   * Wasser aussagekräftig, denn die Tabelle gilt für Wasser.
   */
  abweichungProzent?: number;
  hinweise: string[];
}

/**
 * Den Primärkreis auslegen.
 *
 * @param heizleistungKw Maximale Heizleistung des Geräts [kW]
 * @param cop            COP im maßgebenden Betriebspunkt
 * @param spreizungK     Spreizung der Primärseite [K]
 * @param mittelC        Mitteltemperatur des Solekreises [°C] — Stoffwerte
 *                       hängen stark daran; 0 °C ist der übliche Ansatz für
 *                       einen Sondenkreis im Winter.
 */
export function primaerauslegung(
  heizleistungKw: number,
  cop: number,
  spreizungK: number,
  optionen: { glykolAnteil?: number; glykolArt?: GlycolKind; mittelC?: number } = {},
): Primaerauslegung {
  const hinweise: string[] = [];
  const qc = kaelteleistung(heizleistungKw, cop);
  if (qc <= 0) {
    hinweise.push(
      `Mit COP ${cop} lässt sich keine Kälteleistung bilden — Gleichung (2) des Leitfadens ` +
        'setzt einen COP über 1 voraus.',
    );
    return { kaelteleistungKw: 0, volumenstromM3h: 0, volumenstromLh: 0, bezogenLhKw: 0, hinweise };
  }

  const spreizung = spreizungK > 0 ? spreizungK : 1;
  if (spreizungK <= 0) {
    hinweise.push('Eine Spreizung von 0 K ergibt keinen Volumenstrom. Gerechnet wird mit 1 K.');
  } else if (spreizungK < PRIMAER_SPREIZUNG[0] || spreizungK > PRIMAER_SPREIZUNG[1]) {
    hinweise.push(
      `Der Leitfaden nennt für die Primärseite ${PRIMAER_SPREIZUNG[0]} bis ${PRIMAER_SPREIZUNG[1]} K ` +
        `bei maximaler Kälteleistung. Eingetragen sind ${spreizungK} K — gerechnet wird damit.`,
    );
  }

  const anteil = optionen.glykolAnteil ?? 0;
  const stoff = fluidProperties(optionen.mittelC ?? 0, {
    glycolFraction: anteil,
    glycolKind: optionen.glykolArt,
  });
  // `volumeFlow` nimmt **Kilowatt** und liefert m³/h (siehe dort). Beim
  // ersten Anlauf stand hier `qc * 1000`, und der Volumenstrom war um den
  // Faktor tausend zu groß — gefunden hat es nicht der Blick auf die Zeile,
  // sondern die Gegenprobe gegen Tabelle 1 im Prüfblock.
  const m3h = volumeFlow(qc, spreizung, stoff);
  const lh = m3h * 1000;
  const bezogen = lh / qc;

  const tabelle = TABELLE1_WASSER[spreizungK];
  let abweichung: number | undefined;
  if (tabelle !== undefined) {
    abweichung = ((bezogen - tabelle) / tabelle) * 100;
    if (anteil > 0) {
      hinweise.push(
        `Tabelle 1 des Leitfadens gilt für Wasser (${tabelle} l/h je kW bei ${spreizungK} K). ` +
          `Mit ${Math.round(anteil * 100)} Vol-% Glykol liegt der Volumenstrom um den Faktor ` +
          `${stoff.flowFactor.toFixed(2).replace('.', ',')} darüber — das ist kein Widerspruch, ` +
          'sondern die kleinere Wärmekapazität des Gemisches.',
      );
    } else if (Math.abs(abweichung) > 5) {
      hinweise.push(
        `Die Stoffwertrechnung liegt ${abweichung > 0 ? '' : '−'}${Math.abs(abweichung).toFixed(1).replace('.', ',')} % ` +
          `neben Tabelle 1 (${tabelle} l/h je kW). Mehr als 5 % Abweichung bei reinem Wasser ` +
          'deutet auf einen Fehler in einer der beiden Zahlen hin.',
      );
    }
  } else {
    hinweise.push(
      `Für ${spreizungK} K führt Tabelle 1 des Leitfadens keinen Wert (aufgeführt sind ` +
        `${Object.keys(TABELLE1_WASSER).join(', ')} K). Die Gegenprobe entfällt.`,
    );
  }

  return {
    kaelteleistungKw: qc,
    volumenstromM3h: m3h,
    volumenstromLh: lh,
    bezogenLhKw: bezogen,
    tabelleLhKw: tabelle,
    abweichungProzent: abweichung,
    hinweise,
  };
}
