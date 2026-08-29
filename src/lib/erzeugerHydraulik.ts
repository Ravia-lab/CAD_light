/**
 * Erzeugerhydraulik — was zwischen Rohrnetz und Pumpe sonst noch im Weg liegt.
 * ---------------------------------------------------------------------------
 * **Der Anlass.** Bis 1.13.2 rechnete der Rohrnetzbericht mit
 * `generatorLoss: 0`. Das war ehrlich gemeint — der Erzeugerdruckverlust ist
 * eine Herstellerkennlinie, und eine geratene Zahl wäre schlimmer als keine.
 * Nur war die Wirkung nicht neutral: eine fehlende Zahl macht die Pumpe
 * **systematisch zu klein**, und zwar nicht um ein paar Prozent.
 *
 * Für eine typische Einfamilienhaus-Wärmepumpe (Monoblock ~8 kW, 1,5 m³/h)
 * summiert sich, was ohne dieses Modul mit null angesetzt wurde:
 *
 * | Bauteil | Δp bei 1,5 m³/h |
 * |---|---|
 * | Wärmepumpe | ~10,5 kPa |
 * | 3-Wege-Umschaltventil DN 25 | ~6,9 kPa |
 * | Wärmemengenzähler qp 2,5 | ~3,6 kPa |
 * | Magnetitabscheider DN 25 mit Absperrung | ~4,0 kPa |
 * | **Summe** | **~25 kPa ≈ 2,5 m** |
 *
 * Ein Einfamilienhaus-Rohrnetz braucht 1,5 bis 3 m. Der fehlende Posten ist
 * also keine Korrektur, sondern eine **Verdopplung**.
 *
 * **Die zentrale Unterscheidung.** Der Markt liefert zwei fachlich
 * verschiedene, sich gegenseitig ausschließende Angaben — Δp des Geräts und
 * Restförderhöhe. Sie haben entgegengesetztes Vorzeichen in der Rechnung und
 * entgegengesetzte Steigung über dem Volumenstrom. Deshalb steht in
 * `GeneratorHydraulics` eine Unterscheidungsmarke und **kein** Zahlenfeld
 * `druckverlust_kpa`, in das mal das eine und mal das andere geriete. Wer sie
 * verwechselt, rechnet um 40 bis 70 kPa falsch, und zwar in beide Richtungen.
 *
 * **Wo die Zahlen herkommen.** Die Typklassen des Gerätekatalogs sind keine
 * Produkte; sie können auch keinen Herstellerwert tragen. Deshalb steht hier
 * die **Markttabelle** — 18 veröffentlichte Δp-Werte und 14 veröffentlichte
 * Restförderhöhen mit Quelle — und die Typklassenzahl wird daraus
 * **gerechnet**, nicht gesetzt. Sie ändert sich, wenn die Tabelle wächst.
 * Der Prüfblock rechnet den Median gegen.
 *
 * Grundlagen:
 *  • VdZ, „Leitfaden für Fachleute: Hydraulischer Abgleich in
 *    Heizungsanlagen" — Pumpenauslegung als Summe **inklusive Erzeuger**,
 *    Rückschlagklappen und Wärmemengenzähler ausdrücklich genannt
 *  • BWP, „Leitfaden Hydraulik" — „Berücksichtigung von Rohrleitungen,
 *    Wärmepumpendruckverlusten, Einzelwiderständen und Ventilen"
 *  • kvs-Definition: Δp = (V̇/kvs)² · 1 bar
 */

import type {
  ErzeugerAngabe,
  ErzeugerUmfang,
  GeneratorHydraulics,
  HeatPumpModel,
  PumpForm,
  SchematicKind,
  WertHerkunft,
} from '../types/bim';
import { KV_REFERENCE_PRESSURE } from './valveCatalog';

// ===========================================================================
// 1 — Die Markttabelle
// ===========================================================================

/** Ein veröffentlichter Kennwert eines konkreten Geräts. */
export interface Marktwert {
  hersteller: string;
  typ: string;
  /** Nennleistung [kW], soweit im Datenblatt derselben Zeile genannt. */
  kw?: number;
  angabe: 'druckverlust' | 'restfoerderhoehe';
  /** Der veröffentlichte Wert [Pa]. */
  wert: number;
  /** Zugehöriger Volumenstrom [m³/h] — ohne ihn wäre der Wert wertlos. */
  bezug: number;
  umfang: ErzeugerUmfang;
  /** Originalwortlaut des Herstellers. */
  begriff: string;
  quelle: string;
  herkunft: WertHerkunft;
}

/**
 * Veröffentlichte heizungsseitige Kennwerte marktüblicher Wärmepumpen.
 *
 * Die Tabelle ist keine Geräteauswahl, sondern die **Beleggrundlage** der
 * Typklassenzahl weiter unten. Jede Zeile ist im Volltext des genannten
 * Dokuments nachgelesen; wo ein Wert gerechnet und nicht publiziert ist,
 * steht `herkunft: 'abgeleitet'`.
 *
 * Auffällig und deshalb hier festgehalten: die spezifischen Widerstände
 * streuen über den Faktor sieben — LG liegt bei rund 1800 Pa/(m³/h)², Stiebel
 * Eltron bei über 12 000. Der Grund ist nicht die Bauart, sondern der
 * **Umfang**: Viessmann nennt ausdrücklich nur den Verflüssiger, Bosch die
 * „interne" Druckabnahme des ganzen Geräts. Wer eine dieser Zahlen ohne ihren
 * Umfang übernimmt, vergleicht Verschiedenes.
 */
export const ERZEUGER_MARKTWERTE: readonly Marktwert[] = [
  // --- Angabeart A: Δp des Geräts ------------------------------------------
  {
    hersteller: 'Bosch',
    typ: 'Compress 7001i AW 5 OR-S',
    kw: 4.7,
    angabe: 'druckverlust',
    wert: 9700,
    bezug: 1.15,
    umfang: 'gesamtes-geraet',
    begriff: 'Interne Druckabnahme',
    quelle: 'Bosch, Installationsanleitung CS7001iAW',
    herkunft: 'tabellenwert',
  },
  {
    hersteller: 'Bosch',
    typ: 'Compress 7001i AW 7 OR-S',
    kw: 5.93,
    angabe: 'druckverlust',
    wert: 7800,
    bezug: 1.19,
    umfang: 'gesamtes-geraet',
    begriff: 'Interne Druckabnahme',
    quelle: 'Bosch, Installationsanleitung CS7001iAW',
    herkunft: 'tabellenwert',
  },
  {
    hersteller: 'Bosch',
    typ: 'Compress 7001i AW 9 OR-S',
    kw: 6.21,
    angabe: 'druckverlust',
    wert: 10500,
    bezug: 1.55,
    umfang: 'gesamtes-geraet',
    begriff: 'Interne Druckabnahme',
    quelle: 'Bosch, Installationsanleitung CS7001iAW',
    herkunft: 'tabellenwert',
  },
  {
    hersteller: 'Bosch',
    typ: 'Compress 7001i AW 13 OR-T',
    kw: 10.73,
    angabe: 'druckverlust',
    wert: 15800,
    bezug: 2.23,
    umfang: 'gesamtes-geraet',
    begriff: 'Interne Druckabnahme',
    quelle: 'Bosch, Installationsanleitung CS7001iAW',
    herkunft: 'tabellenwert',
  },
  {
    hersteller: 'Bosch',
    typ: 'Compress 7001i AW 17 OR-T',
    kw: 13.02,
    angabe: 'druckverlust',
    wert: 22900,
    bezug: 2.92,
    umfang: 'gesamtes-geraet',
    begriff: 'Interne Druckabnahme',
    quelle: 'Bosch, Installationsanleitung CS7001iAW',
    herkunft: 'tabellenwert',
  },
  {
    hersteller: 'Stiebel Eltron',
    typ: 'WPL-A 05 HK 230 Premium',
    angabe: 'druckverlust',
    wert: 5100,
    bezug: 0.64,
    umfang: 'gesamtes-geraet',
    begriff: 'Interner Druckverlust Heizung nenn.',
    quelle: 'Stiebel Eltron, Planung und Installation WPL-A 05/07 HK 230',
    herkunft: 'tabellenwert',
  },
  {
    hersteller: 'Stiebel Eltron',
    typ: 'WPL-A 07 HK 230 Premium',
    angabe: 'druckverlust',
    wert: 8800,
    bezug: 0.842,
    umfang: 'gesamtes-geraet',
    begriff: 'Interner Druckverlust Heizung nenn.',
    quelle: 'Stiebel Eltron, Planung und Installation WPL-A 05/07 HK 230',
    herkunft: 'tabellenwert',
  },
  {
    hersteller: 'Stiebel Eltron',
    typ: 'WPL-A 13 HK 400 Premium',
    kw: 10.34,
    angabe: 'druckverlust',
    wert: 10000,
    bezug: 1.57,
    umfang: 'gesamtes-geraet',
    begriff: 'Interner Druckverlust Heizung nenn.',
    quelle: 'Stiebel Eltron, Technisches Datenblatt WPL-A 13 HK 400 Premium',
    herkunft: 'tabellenwert',
  },
  {
    hersteller: 'Viessmann',
    typ: 'Vitocal 300-A AWCI-AC 301.A09',
    kw: 9,
    angabe: 'druckverlust',
    wert: 4000,
    bezug: 0.9,
    umfang: 'nur-waermetauscher',
    begriff: 'Durchflusswiderstand Verflüssiger',
    quelle: 'Viessmann, Planungsanleitung Vitocal Luft/Wasser',
    herkunft: 'tabellenwert',
  },
  {
    hersteller: 'Viessmann',
    typ: 'Vitocal 350-A 351.A10',
    angabe: 'druckverlust',
    wert: 2000,
    bezug: 0.92,
    umfang: 'nur-waermetauscher',
    begriff: 'Durchflusswiderstand',
    quelle: 'Viessmann, Planungsanleitung Vitocal Luft/Wasser',
    herkunft: 'tabellenwert',
  },
  {
    hersteller: 'Viessmann',
    typ: 'Vitocal 350-A 351.A14',
    angabe: 'druckverlust',
    wert: 6000,
    bezug: 1.25,
    umfang: 'nur-waermetauscher',
    begriff: 'Durchflusswiderstand',
    quelle: 'Viessmann, Planungsanleitung Vitocal Luft/Wasser',
    herkunft: 'tabellenwert',
  },
  {
    hersteller: 'Viessmann',
    typ: 'Vitocal 350-A 351.A20',
    angabe: 'druckverlust',
    wert: 9000,
    bezug: 1.52,
    umfang: 'nur-waermetauscher',
    begriff: 'Durchflusswiderstand',
    quelle: 'Viessmann, Planungsanleitung Vitocal Luft/Wasser',
    herkunft: 'tabellenwert',
  },
  {
    hersteller: 'LG',
    typ: 'Therma V Monobloc S 5 kW',
    kw: 5,
    angabe: 'druckverlust',
    wert: 1962,
    bezug: 1.02,
    umfang: 'gesamtes-geraet',
    begriff: 'product pressure drop (0,2 m WS)',
    quelle: 'LG, Therma V Installation Manual S. 34',
    herkunft: 'abgeleitet',
  },
  {
    hersteller: 'LG',
    typ: 'Therma V Monobloc S 7 kW',
    kw: 7,
    angabe: 'druckverlust',
    wert: 2943,
    bezug: 1.2,
    umfang: 'gesamtes-geraet',
    begriff: 'product pressure drop (0,3 m WS)',
    quelle: 'LG, Therma V Installation Manual S. 34',
    herkunft: 'abgeleitet',
  },
  {
    hersteller: 'LG',
    typ: 'Therma V Monobloc S 9 kW',
    kw: 9,
    angabe: 'druckverlust',
    wert: 3924,
    bezug: 1.56,
    umfang: 'gesamtes-geraet',
    begriff: 'product pressure drop (0,4 m WS)',
    quelle: 'LG, Therma V Installation Manual S. 34',
    herkunft: 'abgeleitet',
  },
  {
    hersteller: 'LG',
    typ: 'Therma V Monobloc S 12 kW',
    kw: 12,
    angabe: 'druckverlust',
    wert: 7848,
    bezug: 2.04,
    umfang: 'gesamtes-geraet',
    begriff: 'product pressure drop (0,8 m WS)',
    quelle: 'LG, Therma V Installation Manual S. 34',
    herkunft: 'abgeleitet',
  },
  {
    hersteller: 'LG',
    typ: 'Therma V Monobloc S 14 kW',
    kw: 14,
    angabe: 'druckverlust',
    wert: 10791,
    bezug: 2.4,
    umfang: 'gesamtes-geraet',
    begriff: 'product pressure drop (1,1 m WS)',
    quelle: 'LG, Therma V Installation Manual S. 34',
    herkunft: 'abgeleitet',
  },
  {
    hersteller: 'LG',
    typ: 'Therma V Monobloc S 16 kW',
    kw: 16,
    angabe: 'druckverlust',
    wert: 13734,
    bezug: 2.76,
    umfang: 'gesamtes-geraet',
    begriff: 'product pressure drop (1,4 m WS)',
    quelle: 'LG, Therma V Installation Manual S. 34',
    herkunft: 'abgeleitet',
  },

  // --- Angabeart B: Restförderhöhe ----------------------------------------
  {
    hersteller: 'Viessmann',
    typ: 'Vitocal 200-A 201.A04–A08',
    angabe: 'restfoerderhoehe',
    wert: 70500,
    bezug: 0.7,
    umfang: 'gesamtes-geraet',
    begriff: 'Max. externer Druckverlust (RFH) bei Mindestvolumenstrom',
    quelle: 'Viessmann, Planungsanleitung Vitocal 200-A AWO-M-E',
    herkunft: 'tabellenwert',
  },
  {
    hersteller: 'Viessmann',
    typ: 'Vitocal 200-A 201.A10',
    angabe: 'restfoerderhoehe',
    wert: 50000,
    bezug: 1.4,
    umfang: 'gesamtes-geraet',
    begriff: 'Max. externer Druckverlust (RFH)',
    quelle: 'Viessmann, Planungsanleitung Vitocal 200-A AWO-M-E',
    herkunft: 'tabellenwert',
  },
  {
    hersteller: 'Viessmann',
    typ: 'Vitocal 222-A 221.A04–A08',
    angabe: 'restfoerderhoehe',
    wert: 70500,
    bezug: 0.7,
    umfang: 'gesamtes-geraet',
    begriff: 'Max. externer Druckverlust (RFH)',
    quelle: 'Viessmann, Planungsanleitung Vitocal 200-A AWO-M-E',
    herkunft: 'tabellenwert',
  },
  {
    hersteller: 'Viessmann',
    typ: 'Vitocal 222-A 221.A10',
    angabe: 'restfoerderhoehe',
    wert: 40000,
    bezug: 1.55,
    umfang: 'gesamtes-geraet',
    begriff: 'Max. externer Druckverlust (RFH)',
    quelle: 'Viessmann, Planungsanleitung Vitocal 200-A AWO-M-E',
    herkunft: 'tabellenwert',
  },
  {
    hersteller: 'Viessmann',
    typ: 'Vitocal 200-A AWCI-AC 201.A07',
    angabe: 'restfoerderhoehe',
    wert: 60000,
    bezug: 0.8,
    umfang: 'gesamtes-geraet',
    begriff: 'Restförderhöhe',
    quelle: 'Viessmann, Planungsanleitung Vitocal Luft/Wasser',
    herkunft: 'tabellenwert',
  },
  {
    hersteller: 'Viessmann',
    typ: 'Vitocal 200-A AWCI-AC 201.A10',
    angabe: 'restfoerderhoehe',
    wert: 60000,
    bezug: 0.92,
    umfang: 'gesamtes-geraet',
    begriff: 'Restförderhöhe',
    quelle: 'Viessmann, Planungsanleitung Vitocal Luft/Wasser',
    herkunft: 'tabellenwert',
  },
  {
    hersteller: 'Wolf',
    typ: 'CHA-07 (Ausgabe 2024)',
    angabe: 'restfoerderhoehe',
    wert: 42000,
    bezug: 1.62,
    umfang: 'gesamtes-geraet',
    begriff: 'Restförderhöhe',
    quelle: 'Wolf, Broschüre CHA-Monoblock, Ausgabe 2024',
    herkunft: 'tabellenwert',
  },
  {
    hersteller: 'Wolf',
    typ: 'CHA-10 (Ausgabe 2024)',
    angabe: 'restfoerderhoehe',
    wert: 40000,
    bezug: 1.62,
    umfang: 'gesamtes-geraet',
    begriff: 'Restförderhöhe',
    quelle: 'Wolf, Broschüre CHA-Monoblock, Ausgabe 2024',
    herkunft: 'tabellenwert',
  },
  {
    hersteller: 'LG',
    typ: 'Therma V Monobloc S 5 kW',
    kw: 5,
    angabe: 'restfoerderhoehe',
    wert: 113800,
    bezug: 1.02,
    umfang: 'gesamtes-geraet',
    begriff: 'available head (11,6 m)',
    quelle: 'LG, Therma V Installation Manual S. 34',
    herkunft: 'abgeleitet',
  },
  {
    hersteller: 'LG',
    typ: 'Therma V Monobloc S 7 kW',
    kw: 7,
    angabe: 'restfoerderhoehe',
    wert: 110800,
    bezug: 1.2,
    umfang: 'gesamtes-geraet',
    begriff: 'available head (11,3 m)',
    quelle: 'LG, Therma V Installation Manual S. 34',
    herkunft: 'abgeleitet',
  },
  {
    hersteller: 'LG',
    typ: 'Therma V Monobloc S 9 kW',
    kw: 9,
    angabe: 'restfoerderhoehe',
    wert: 106900,
    bezug: 1.56,
    umfang: 'gesamtes-geraet',
    begriff: 'available head (10,9 m)',
    quelle: 'LG, Therma V Installation Manual S. 34',
    herkunft: 'abgeleitet',
  },
  {
    hersteller: 'LG',
    typ: 'Therma V Monobloc S 12 kW',
    kw: 12,
    angabe: 'restfoerderhoehe',
    wert: 97100,
    bezug: 2.04,
    umfang: 'gesamtes-geraet',
    begriff: 'available head (9,9 m)',
    quelle: 'LG, Therma V Installation Manual S. 34',
    herkunft: 'abgeleitet',
  },
  {
    hersteller: 'LG',
    typ: 'Therma V Monobloc S 14 kW',
    kw: 14,
    angabe: 'restfoerderhoehe',
    wert: 87300,
    bezug: 2.4,
    umfang: 'gesamtes-geraet',
    begriff: 'available head (8,9 m)',
    quelle: 'LG, Therma V Installation Manual S. 34',
    herkunft: 'abgeleitet',
  },
  {
    hersteller: 'LG',
    typ: 'Therma V Monobloc S 16 kW',
    kw: 16,
    angabe: 'restfoerderhoehe',
    wert: 79400,
    bezug: 2.76,
    umfang: 'gesamtes-geraet',
    begriff: 'available head (8,1 m)',
    quelle: 'LG, Therma V Installation Manual S. 34',
    herkunft: 'abgeleitet',
  },
];

/** Spezifischer Widerstand R = Δp/V̇² [Pa/(m³/h)²] einer Marktzeile. */
export function spezifischerWiderstand(m: Marktwert): number {
  return m.bezug > 0 ? m.wert / m.bezug ** 2 : 0;
}

/** Median einer Zahlenreihe; leere Reihe ergibt 0. */
export function median(werte: readonly number[]): number {
  if (!werte.length) return 0;
  const s = [...werte].sort((a, b) => a - b);
  const mitte = s.length >> 1;
  return s.length % 2 ? s[mitte] : (s[mitte - 1] + s[mitte]) / 2;
}

/**
 * Empirisches Quantil mit linearer Interpolation.
 *
 * Gebraucht wird das untere Quartil der Restförderhöhen — siehe die
 * Begründung bei `TYPKLASSE_RESTFOERDERHOEHE`.
 */
export function quantil(werte: readonly number[], p: number): number {
  if (!werte.length) return 0;
  const s = [...werte].sort((a, b) => a - b);
  const pos = Math.min(Math.max(p, 0), 1) * (s.length - 1);
  const unten = Math.floor(pos);
  const oben = Math.ceil(pos);
  return unten === oben ? s[unten] : s[unten] + (s[oben] - s[unten]) * (pos - unten);
}

/**
 * Spezifischer Widerstand einer Typklasse [Pa/(m³/h)²].
 *
 * **Der Median der Markttabelle, nicht der Mittelwert.** Die Reihe ist
 * schief: zwei Stiebel-Zeilen liegen bei über 12 000, sechs LG-Zeilen unter
 * 2 100. Ein Mittelwert folgt den Ausreißern, der Median beschreibt das
 * mittlere Gerät. Bei 1,5 m³/h ergibt er rund 8 kPa — dieselbe Größenordnung
 * wie die Bosch-Zeile, an der der Recherchebericht die Lücke aufgemacht hat.
 *
 * Die Zahl ist **gerechnet, nicht gesetzt**: sie wandert, wenn die Tabelle
 * wächst. Genau das ist der Sinn.
 */
export const TYPKLASSE_WIDERSTAND = median(
  ERZEUGER_MARKTWERTE.filter((m) => m.angabe === 'druckverlust').map(spezifischerWiderstand),
);

/**
 * Restförderhöhe einer Typklasse [Pa].
 *
 * **Hier ist der Median die falsche Wahl.** Ein Δp und eine Restförderhöhe
 * sind in ihrer Fehlerwirkung nicht symmetrisch: ein zu klein angesetztes Δp
 * macht die Pumpe zu klein und die Anlage laut, eine zu groß angesetzte
 * Restförderhöhe lässt eine Prüfung **bestehen, die durchfallen müsste** —
 * der Anwender bekommt ein grünes Ergebnis für ein Netz, das das Gerät nicht
 * fördern kann. Deshalb das **untere Quartil**: die Typklasse behauptet, was
 * das schwächere Viertel des Marktes noch schafft.
 */
export const TYPKLASSE_RESTFOERDERHOEHE = quantil(
  ERZEUGER_MARKTWERTE.filter((m) => m.angabe === 'restfoerderhoehe').map((m) => m.wert),
  0.25,
);

/**
 * Bezugsvolumenstrom der Typklassen-Restförderhöhe [m³/h].
 *
 * Der Median der Volumenströme, bei denen die Hersteller ihre Restförderhöhe
 * angeben. Ohne ihn wäre der Wert oben eine Behauptung — die Wolf-Halbierung
 * von 610 auf 420 mbar entstand allein durch einen gewechselten Bezugspunkt.
 */
export const TYPKLASSE_RFH_BEZUG = median(
  ERZEUGER_MARKTWERTE.filter((m) => m.angabe === 'restfoerderhoehe').map((m) => m.bezug),
);

/**
 * Vorgabe-Exponent der Skalierung Δp ∝ V̇^n.
 *
 * 2,0 aus zwei Gründen: er ist der in der deutschen TGA-Praxis übliche und
 * belegte Wert („der Volumenstrom geht quadratisch in die Berechnung ein"),
 * und er ist der konservative — oberhalb des Bezugspunktes liefert n = 2
 * mehr Δp als der an Plattenwärmetauschern gemessene n ≈ 1,78. Genau der
 * Fehler, der behoben werden soll, wird dadurch nicht wiederholt.
 */
export const DEFAULT_EXPONENT = 2.0;

/**
 * Spanne des fehlenden Betrags, wenn ein Gerät keinen Wert veröffentlicht [Pa].
 *
 * Klein- und Großwert der Δp-Zeilen der Markttabelle, umgerechnet auf einen
 * mittleren Auslegungsvolumenstrom. Sie steht im Bericht statt eines „0 kPa"
 * ohne Kommentar: wo ein Wert fehlt, gehört die **Größenordnung des
 * fehlenden Betrags** dazu, damit der Planer weiß, wie groß der Fehler ist.
 */
export function fehlbetragSpanne(flow: number): [number, number] {
  const r = ERZEUGER_MARKTWERTE.filter((m) => m.angabe === 'druckverlust').map(spezifischerWiderstand);
  const f = Math.max(flow, 0);
  return [Math.min(...r) * f ** 2, Math.max(...r) * f ** 2];
}

// ===========================================================================
// 2 — Typklassenwert für ein Katalogsgerät
// ===========================================================================

/**
 * Hydraulischer Kennwert für eine Typklasse des Gerätekatalogs.
 *
 * Welche der beiden Angabearten gilt, hängt **nicht an der Bauform**, sondern
 * daran, ob das Gerät eine Umwälzpumpe mitbringt: nur dann gibt es überhaupt
 * eine Restförderhöhe. Stiebel Eltron zeigt allerdings, dass der Umkehrschluss
 * nicht gilt — dort ist die Pumpe eingebaut und trotzdem nur ein Δp
 * veröffentlicht. Deshalb ist der eingebaute Pumpenstatus hier ein
 * *Argument* und keine Ableitung aus `form`.
 */
export function typklassenHydraulik(options: {
  /** Hat das Gerät eine eingebaute Umwälzpumpe? */
  internePumpe: boolean;
  /** Mindestvolumenstrom des Geräts [m³/h] — der übliche Bezugspunkt. */
  minVolumeFlow: number;
  form?: PumpForm;
}): GeneratorHydraulics {
  const bezug = Math.max(0.2, Math.round(options.minVolumeFlow * 100) / 100);
  if (options.internePumpe) {
    return {
      angabe: 'restfoerderhoehe',
      wert: Math.round(TYPKLASSE_RESTFOERDERHOEHE),
      bezugsvolumenstrom: Math.round(TYPKLASSE_RFH_BEZUG * 100) / 100,
      exponent: DEFAULT_EXPONENT,
      umfang: 'gesamtes-geraet',
      rfhBezug: 'mindestvolumenstrom',
      herstellerbegriff: 'Restförderhöhe (Typklasse)',
      herkunft: 'abgeleitet',
      quelle: `Unteres Quartil aus ${ERZEUGER_MARKTWERTE.filter((m) => m.angabe === 'restfoerderhoehe').length} veröffentlichten Restförderhöhen (Viessmann, Wolf, LG)`,
    };
  }
  return {
    angabe: 'druckverlust',
    wert: Math.round(TYPKLASSE_WIDERSTAND * bezug ** 2),
    bezugsvolumenstrom: bezug,
    exponent: DEFAULT_EXPONENT,
    // Die Markttabelle mischt „nur Verflüssiger" und „ganzes Gerät". Ein
    // Median über beide kann nur „unbekannt" sein — und muss es sagen,
    // damit der Abscheider nicht doppelt gezählt wird.
    umfang: 'unbekannt',
    herstellerbegriff: 'Heizungsseitiger Druckverlust (Typklasse)',
    herkunft: 'abgeleitet',
    quelle: `Median aus ${ERZEUGER_MARKTWERTE.filter((m) => m.angabe === 'druckverlust').length} veröffentlichten Δp-Werten (Bosch, Stiebel Eltron, Viessmann, LG)`,
  };
}

/**
 * Druckverlust des Erzeugers beim gefragten Volumenstrom [Pa].
 *
 * Auf eine Restförderhöhe wird der Exponent **nicht** angewendet: sie ist eine
 * Pumpenkennlinie und fällt mit steigendem Volumenstrom, statt zu steigen.
 * Ein quadratischer Ansatz darauf wäre grob falsch.
 */
export function skaliert(h: GeneratorHydraulics, flow: number): number {
  if (h.angabe === 'keine-angabe') return 0;
  if (h.bezugsvolumenstrom <= 0 || flow <= 0) return h.wert;
  if (h.angabe === 'restfoerderhoehe') return h.wert;
  return h.wert * (flow / h.bezugsvolumenstrom) ** (h.exponent || DEFAULT_EXPONENT);
}

/** Liegt der Volumenstrom außerhalb der Gültigkeitsgrenzen des Datensatzes? */
export function ausserhalbGrenzen(h: GeneratorHydraulics, flow: number): 'unter' | 'ueber' | undefined {
  if (h.vMin !== undefined && flow < h.vMin) return 'unter';
  if (h.vMax !== undefined && flow > h.vMax) return 'ueber';
  return undefined;
}

// ===========================================================================
// 3 — Die übrigen Bauteile im Fließweg
// ===========================================================================

/**
 * Ein Einbauteil mit kvs-Kennwert.
 *
 * `kvsBezugsdruck` ist kein Beiwerk. Kamstrup führt im Datenblatt eine Spalte
 * „kv q@ 0,25 bar" — das ist der Durchfluss bei 0,25 bar, **nicht** der kvs
 * bei 1 bar. Ein blind übernommener Wert wäre um den Faktor 2 falsch, der
 * daraus gerechnete Δp um den Faktor 4.
 */
export interface EinbauteilTyp {
  art: SchematicKind;
  label: string;
  /** Durchfluss beim Bezugsdruck [m³/h]. */
  kvs: number;
  /** Druck, auf den sich `kvs` bezieht [bar]. Normalfall 1,0. */
  kvsBezugsdruck: number;
  quelle: string;
  herkunft: WertHerkunft;
  note?: string;
}

/**
 * Auf 1 bar normierter kvs [m³/h].
 *
 * kvs_normiert = kvs_angegeben / √(Bezugsdruck[bar]) — damit lässt sich die
 * Kamstrup-Falle sauber auflösen, statt sie zu umgehen.
 */
export function normierterKvs(t: EinbauteilTyp): number {
  const p = t.kvsBezugsdruck > 0 ? t.kvsBezugsdruck : 1;
  return t.kvs / Math.sqrt(p);
}

/** Druckverlust eines Einbauteils [Pa]: Δp = (V̇/kvs)² · 1 bar. */
export function einbauteilDruck(t: EinbauteilTyp, flow: number): number {
  const kvs = normierterKvs(t);
  if (!(kvs > 0) || !(flow > 0)) return 0;
  return (flow / kvs) ** 2 * KV_REFERENCE_PRESSURE;
}

/** 3-Wege-Umschaltventile Heizung/Warmwasser nach Nennweite (ESBE ZRS230/234). */
export const UMSCHALTVENTILE: readonly (EinbauteilTyp & { dn: number })[] = [
  { dn: 15, art: 'valve-diverter', label: '3-Wege-Umschaltventil DN 15', kvs: 3.2, kvsBezugsdruck: 1, quelle: 'ESBE ZRS230/ZRS234', herkunft: 'tabellenwert' },
  { dn: 20, art: 'valve-diverter', label: '3-Wege-Umschaltventil DN 20', kvs: 4.6, kvsBezugsdruck: 1, quelle: 'ESBE ZRS230/ZRS234', herkunft: 'tabellenwert' },
  { dn: 25, art: 'valve-diverter', label: '3-Wege-Umschaltventil DN 25', kvs: 5.7, kvsBezugsdruck: 1, quelle: 'ESBE ZRS230/ZRS234', herkunft: 'tabellenwert' },
  { dn: 32, art: 'valve-diverter', label: '3-Wege-Umschaltventil DN 32', kvs: 8.4, kvsBezugsdruck: 1, quelle: 'ESBE ZRS230/ZRS234', herkunft: 'tabellenwert' },
];

/**
 * Wärmemengenzähler nach Nenndurchfluss (Diehl Sharky 775, Ultraschall).
 *
 * Die Reihe ist **nicht monoton** — qp 3,5 hat weniger Δp als qp 2,5. Das ist
 * real und liegt an der größeren Baunennweite dieser Variante; es ist kein
 * Übertragungsfehler und darf nicht „geglättet" werden.
 */
export const WAERMEMENGENZAEHLER: readonly (EinbauteilTyp & { qp: number })[] = [
  { qp: 0.6, art: 'heat-meter', label: 'Wärmemengenzähler qp 0,6', kvs: 2.06, kvsBezugsdruck: 1, quelle: 'Diehl Sharky 775', herkunft: 'abgeleitet' },
  { qp: 1.5, art: 'heat-meter', label: 'Wärmemengenzähler qp 1,5', kvs: 5.48, kvsBezugsdruck: 1, quelle: 'Diehl Sharky 775', herkunft: 'abgeleitet' },
  { qp: 2.5, art: 'heat-meter', label: 'Wärmemengenzähler qp 2,5', kvs: 7.91, kvsBezugsdruck: 1, quelle: 'Diehl Sharky 775', herkunft: 'abgeleitet' },
  { qp: 3.5, art: 'heat-meter', label: 'Wärmemengenzähler qp 3,5', kvs: 16.69, kvsBezugsdruck: 1, quelle: 'Diehl Sharky 775', herkunft: 'abgeleitet' },
  { qp: 6, art: 'heat-meter', label: 'Wärmemengenzähler qp 6', kvs: 16.77, kvsBezugsdruck: 1, quelle: 'Diehl Sharky 775', herkunft: 'abgeleitet' },
  { qp: 10, art: 'heat-meter', label: 'Wärmemengenzähler qp 10', kvs: 32.44, kvsBezugsdruck: 1, quelle: 'Diehl Sharky 775', herkunft: 'abgeleitet' },
];

/**
 * Schlamm- und Magnetitabscheider (Caleffi DIRTMAG 5453).
 *
 * Die Variante **mit Absperrkugelhähnen** hat einen um rund 28 % kleineren
 * Kv als der Abscheider allein — Baugruppe und Bauteil sind zwei Datensätze.
 * Angesetzt ist die Baugruppe, weil sie so eingebaut wird: ohne Absperrung
 * lässt sich der Schmutzfänger nicht reinigen, ohne die Anlage zu entleeren.
 */
export const ABSCHEIDER: readonly (EinbauteilTyp & { dn: number })[] = [
  { dn: 20, art: 'dirt-separator', label: 'Magnetitabscheider DN 20 mit Absperrung', kvs: 7.5, kvsBezugsdruck: 1, quelle: 'Caleffi DIRTMAG 5453 (545345)', herkunft: 'tabellenwert' },
  { dn: 25, art: 'dirt-separator', label: 'Magnetitabscheider DN 25 mit Absperrung', kvs: 7.5, kvsBezugsdruck: 1, quelle: 'Caleffi DIRTMAG 5453 (545346)', herkunft: 'tabellenwert' },
  { dn: 32, art: 'dirt-separator', label: 'Magnetitabscheider DN 32 mit Absperrung', kvs: 10.5, kvsBezugsdruck: 1, quelle: 'Caleffi DIRTMAG 5453 (545306), ohne Absperrung — für DN 32 ist keine Baugruppe publiziert', herkunft: 'tabellenwert' },
];

/**
 * Durchflussmesser im Fußbodenheizungs-Verteiler, je Kreis.
 *
 * Er liegt **nicht** im Erzeugerkreis, sondern im ungünstigsten Heizkreis.
 * Deshalb steht er hier als Kennwert, wird aber nicht in die Erzeugerbilanz
 * addiert — sonst stünde er zweimal im Strang, wenn jemand den
 * Heizflächenverlust setzt.
 */
export const FBH_DURCHFLUSSMESSER: EinbauteilTyp = {
  art: 'manifold',
  label: 'Verteiler-Durchflussmesser je Kreis',
  kvs: 0.9,
  kvsBezugsdruck: 1,
  quelle: 'Oventrop Multidis SF mit Durchfluss-, Mess- und Reguliereinsatz',
  herkunft: 'tabellenwert',
  note: 'Bei 100 l/h rund 1,2 kPa, bei 200 l/h bereits 4,9 kPa — der Wert wächst quadratisch und ist im ungünstigsten Kreis auslegungsrelevant.',
};

/** Passendes Umschaltventil zur Nennweite. */
export function umschaltventil(dn: number): EinbauteilTyp {
  return UMSCHALTVENTILE.find((v) => v.dn >= dn) ?? UMSCHALTVENTILE[UMSCHALTVENTILE.length - 1];
}

/**
 * Passender Wärmemengenzähler zum Auslegungsvolumenstrom.
 *
 * Gewählt wird die kleinste Baugröße, deren Nenndurchfluss **über** dem
 * Auslegungsvolumenstrom liegt — nicht die erste, die ihn gerade noch
 * erreicht. qp ist der Dauerdurchfluss: ein Zähler, der im Heizbetrieb
 * genau auf qp läuft, hat für die Speicherladung keinen Spielraum mehr, und
 * die liegt bei jeder Wärmepumpe über dem Heizvolumenstrom. Bei 1,5 m³/h
 * ergibt das qp 2,5 und rund 3,6 kPa.
 */
export function waermemengenzaehler(flow: number): EinbauteilTyp {
  return WAERMEMENGENZAEHLER.find((z) => z.qp > flow) ?? WAERMEMENGENZAEHLER[WAERMEMENGENZAEHLER.length - 1];
}

/** Passender Abscheider zur Nennweite. */
export function abscheider(dn: number): EinbauteilTyp {
  return ABSCHEIDER.find((a) => a.dn >= dn) ?? ABSCHEIDER[ABSCHEIDER.length - 1];
}

// ===========================================================================
// 4 — Die Bilanz des Erzeugerkreises
// ===========================================================================

/** Ein Posten der Erzeugerbilanz. */
export interface FliesswegPosten {
  art: SchematicKind | 'generator';
  label: string;
  /** Druckverlust beim Auslegungsvolumenstrom [Pa]. */
  druck: number;
  /** Wie der Wert zustande kommt — ein Satz für den Bericht. */
  grundlage: string;
  herkunft: WertHerkunft;
  quelle: string;
}

export interface Erzeugerbilanz {
  angabe: ErzeugerAngabe;
  /** Volumenstrom, für den gerechnet wurde [m³/h]. */
  volumenstrom: number;
  /** Alle Posten, größter zuerst. */
  posten: FliesswegPosten[];
  /**
   * Summe, die zum Rohrnetz **addiert** wird [Pa].
   *
   * Bei `restfoerderhoehe` enthält sie die Einbauten, aber nicht das Gerät —
   * dessen Wert ist eine Obergrenze und kein Widerstand.
   */
  zusatz: number;
  /** Verfügbare Restförderhöhe [Pa], falls das Gerät eine veröffentlicht. */
  verfuegbar?: number;
  /** Kennwert des Geräts, wie er angesetzt wurde. */
  hydraulik?: GeneratorHydraulics;
  hinweise: { severity: 'info' | 'warn' | 'error'; text: string }[];
}

const kpa = (pa: number) => (Math.round(pa / 10) / 100).toLocaleString('de-DE', { maximumFractionDigits: 2 });
const m3h = (v: number) => v.toLocaleString('de-DE', { maximumFractionDigits: 2 });

export interface BilanzEingabe {
  /** Gewähltes Gerät; ohne Gerät gibt es keinen Erzeugerposten. */
  model?: HeatPumpModel;
  /** Auslegungsvolumenstrom des Erzeugerkreises [m³/h]. */
  flow: number;
  /** Nennweite der Erzeugeranbindung [mm]. */
  dn: number;
  /** Gibt es eine Trinkwasserbereitung über ein Umschaltventil? */
  umschaltung: boolean;
  /** Ist ein Wärmemengenzähler vorgesehen? */
  waermezaehler: boolean;
  /** Ist ein Schlamm-/Magnetitabscheider vorgesehen? */
  abscheiderVorhanden: boolean;
}

/**
 * Was im Erzeugerkreis zusätzlich zum gezeichneten Rohrnetz im Weg liegt.
 *
 * Die Bauteilliste kommt **nicht** aus einer eigenen Annahme, sondern aus der
 * Anlagenauslegung: das Umschaltventil gibt es, wenn ein Trinkwasserspeicher
 * geladen wird, den Zähler, wenn die Armaturenliste ihn führt, den Abscheider
 * ebenso. Damit zeigen Bild, Materialliste und Rechnung dieselbe Anlage —
 * die Lehre aus drei Fehlern dieses Projekts.
 */
export function erzeugerBilanz(e: BilanzEingabe): Erzeugerbilanz {
  const flow = Math.max(0, e.flow);
  const posten: FliesswegPosten[] = [];
  const hinweise: Erzeugerbilanz['hinweise'] = [];

  const h =
    e.model?.hydraulics ??
    (e.model
      ? typklassenHydraulik({
          internePumpe: Boolean(e.model.contains?.pump),
          minVolumeFlow: e.model.minVolumeFlow,
          form: e.model.form,
        })
      : undefined);

  let verfuegbar: number | undefined;
  if (h && h.angabe === 'druckverlust') {
    const druck = skaliert(h, flow);
    posten.push({
      art: 'generator',
      label: e.model?.label ?? 'Wärmeerzeuger',
      druck,
      grundlage: `${kpa(h.wert)} kPa bei ${m3h(h.bezugsvolumenstrom)} m³/h, skaliert auf ${m3h(flow)} m³/h mit n = ${h.exponent.toLocaleString('de-DE')}`,
      herkunft: h.herkunft,
      quelle: `${h.herstellerbegriff} — ${h.quelle}`,
    });
    const grenze = ausserhalbGrenzen(h, flow);
    if (grenze) {
      hinweise.push({
        severity: 'warn',
        text:
          grenze === 'unter'
            ? `Der Auslegungsvolumenstrom ${m3h(flow)} m³/h liegt unter dem Mindestvolumenstrom des Geräts. Die Anlage ist damit unzulässig — der hochgerechnete Druckverlust ist die kleinere Sorge.`
            : `Der Auslegungsvolumenstrom ${m3h(flow)} m³/h liegt über dem Höchstvolumenstrom des Geräts; der Erzeugerdruckverlust ist über den belegten Bereich hinaus hochgerechnet.`,
      });
    }
  } else if (h && h.angabe === 'restfoerderhoehe') {
    verfuegbar = h.wert;
    hinweise.push({
      severity: 'info',
      text:
        `Das Gerät hat eine eingebaute Umwälzpumpe. Statt einer Pumpenauslegung wird geprüft: Rohrnetz und ` +
        `Armaturen müssen unter der Restförderhöhe von ${kpa(h.wert)} kPa bei ${m3h(h.bezugsvolumenstrom)} m³/h bleiben. ` +
        `Der Wert wird nicht addiert — er ist eine Pumpenkennlinie, kein Widerstand. Quelle: ${h.quelle}.`,
    });
  } else if (e.model) {
    const [klein, gross] = fehlbetragSpanne(flow);
    hinweise.push({
      severity: 'warn',
      text:
        `Für dieses Gerät ist heizungsseitig kein Druckverlust hinterlegt. Die Förderhöhe ist um genau diesen ` +
        `Betrag zu klein; bei ${m3h(flow)} m³/h liegen vergleichbare Geräte zwischen ${kpa(klein)} und ${kpa(gross)} kPa.`,
    });
  }

  if (e.umschaltung) {
    const v = umschaltventil(e.dn);
    posten.push({
      art: v.art,
      label: v.label,
      druck: einbauteilDruck(v, flow),
      grundlage: `kvs ${v.kvs.toLocaleString('de-DE')} m³/h bei ${v.kvsBezugsdruck.toLocaleString('de-DE')} bar → Δp = (V̇/kvs)² · 1 bar`,
      herkunft: v.herkunft,
      quelle: v.quelle,
    });
  }
  if (e.waermezaehler) {
    const z = waermemengenzaehler(flow);
    posten.push({
      art: z.art,
      label: z.label,
      druck: einbauteilDruck(z, flow),
      grundlage: `kvs ${z.kvs.toLocaleString('de-DE')} m³/h bei ${z.kvsBezugsdruck.toLocaleString('de-DE')} bar`,
      herkunft: z.herkunft,
      quelle: z.quelle,
    });
  }
  if (e.abscheiderVorhanden) {
    if (h?.umfang === 'geraet-mit-abscheider') {
      hinweise.push({
        severity: 'info',
        text: 'Der Abscheider steckt bereits im Gerätedruckverlust und wird deshalb nicht ein zweites Mal angesetzt.',
      });
    } else {
      const a = abscheider(e.dn);
      posten.push({
        art: a.art,
        label: a.label,
        druck: einbauteilDruck(a, flow),
        grundlage: `Kv ${a.kvs.toLocaleString('de-DE')} m³/h — Baugruppe mit Absperrung, nicht der Abscheider allein`,
        herkunft: a.herkunft,
        quelle: a.quelle,
      });
      if (h?.umfang === 'unbekannt') {
        hinweise.push({
          severity: 'info',
          text:
            'Der Umfang des Gerätedruckverlusts ist unbekannt (die Typklasse mittelt über Angaben „nur Verflüssiger" ' +
            'und „ganzes Gerät"). Der Abscheider ist deshalb gesondert angesetzt; bei Geräten, deren Datenblatt ihn ' +
            'einschließt, ist er im Anlagenblatt abzuwählen.',
        });
      }
    }
  }

  posten.sort((a, b) => b.druck - a.druck);
  const zusatz = posten.reduce((s, p) => s + p.druck, 0);

  return {
    angabe: h?.angabe ?? 'keine-angabe',
    volumenstrom: flow,
    posten,
    zusatz,
    verfuegbar,
    hydraulik: h,
    hinweise,
  };
}
