/**
 * Deckungsanteile einer bivalenten Anlage — Bivalenzpunkt und Jahresdauerlinie.
 *
 * **Woher die Aufgabe kommt.** Die RaVia-Seite hat am 01.10.2026 das Verfahren
 * festgelegt: „Bivalenzpunkt + Jahresdauerlinie. Das ist das in der
 * Heizungsbranche verbreitetere Verfahren und passt besser zum Anspruch, den
 * wir an den offiziellen Nachweis stellen" — ausdrücklich **nicht** die
 * Monatsbilanz.
 *
 * **Das Modell, in vier Zeilen.** Zwei Geraden, mehr nicht:
 *
 *  1. Die **Gebäudekennlinie**: Die Last fällt linear von der Norm-Heizlast
 *     Q_N bei der Norm-Außentemperatur θ_norm auf **null** an der
 *     Heizgrenztemperatur θ_HG. Oberhalb θ_HG wird nicht geheizt — das ist die
 *     Bedeutung der Heizgrenze.
 *  2. Die **Jahresdauerlinie**, linear über die Heizzeit: am kältesten Punkt
 *     θ_norm, am wärmsten θ_HG. Als Stundenanteil u ∈ [0, 1] gelesen:
 *     θ(u) = θ_norm + (θ_HG − θ_norm) · u.
 *
 * Setzt man beides zusammen, wird die Last über der Zeit **ein Dreieck**:
 * Q(u) = Q_N · (1 − u). Die ganze Heizarbeit ist seine Fläche, ½ · Q_N · t.
 * Jeder Deckungsanteil unten ist ein Flächenverhältnis in diesem Dreieck —
 * deshalb sind die Formeln so kurz, und deshalb sind sie von Hand prüfbar.
 *
 * **Was dieses Modul ausdrücklich nicht tut.**
 *
 *  • Es **erfindet keine Klimadaten.** Die lineare Dauerlinie braucht nur
 *    θ_norm (steht am Projekt) und θ_HG (steht am Anlagenblatt). Eine
 *    stündliche Temperaturreihe — ein Testreferenzjahr — wäre genauer; sie
 *    liegt nicht vor und wird nicht geschätzt. Die wirkliche Dauerlinie ist
 *    S-förmig, die Gerade überschätzt die kalten Stunden leicht. Das steht in
 *    `annahmen` und nicht im Kleingedruckten.
 *  • Es **rechnet keine Kilowattstunden.** Die Anteile sind dimensionslos und
 *    brauchen die Jahresheizstunden nicht; absolute Arbeit bekommt man, indem
 *    man sie mit dem Jahreswärmebedarf multipliziert — den rechnet die
 *    Gegenstelle. Eine Stundenzahl zu behaupten, um kWh ausgeben zu können,
 *    wäre der teurere Weg zur schöneren Zahl.
 *  • Es **verteilt keine Fehlmenge um.** Reicht der zweite Erzeuger nicht,
 *    steht das als Fehlbetrag da. Eine Anlage, die rechnerisch aufgeht, weil
 *    das Programm die Lücke still auf die Wärmepumpe geschoben hat, ist der
 *    schlechteste Nachweis, den man schreiben kann.
 *
 * Quelle der Betriebsweisen: BDH-Infoblatt Nr. 57 (siehe `BivalenzBetrieb` in
 * `src/types/bim.ts`).
 */

import type { BivalenzBetrieb, SecondGenerator } from '../types/bim';

/** Die Gebäudekennlinie: zwei Punkte, dazwischen eine Gerade. */
export interface Gebaeudekennlinie {
  /** Norm-Heizlast [kW] bei der Norm-Außentemperatur. */
  heizlast: number;
  /** Norm-Außentemperatur θ_norm [°C]. */
  normAussen: number;
  /** Heizgrenztemperatur θ_HG [°C] — darüber wird nicht geheizt. */
  heizgrenze: number;
}

/**
 * Heizlast des Gebäudes bei einer Außentemperatur [kW].
 *
 * Linear zwischen Norm-Außentemperatur und Heizgrenze, außerhalb gekappt: Über
 * der Heizgrenze null (es wird nicht geheizt), unter der Norm-Außentemperatur
 * nicht weiter steigend — die Norm-Heizlast ist der Auslegungsfall und keine
 * Zwischengröße, die man extrapoliert.
 */
export function gebaeudelast(k: Gebaeudekennlinie, aussen: number): number {
  const spanne = k.heizgrenze - k.normAussen;
  if (spanne <= 0) return 0;
  if (aussen >= k.heizgrenze) return 0;
  if (aussen <= k.normAussen) return k.heizlast;
  return (k.heizlast * (k.heizgrenze - aussen)) / spanne;
}

/**
 * Anteil der Heizzeit, in dem es **kälter** ist als diese Temperatur [0 … 1].
 *
 * Die Umkehrung der linearen Dauerlinie. Bei θ_norm ist er 0 (kälter wird es
 * nicht), bei θ_HG ist er 1 (die ganze Heizzeit ist kälter als die Heizgrenze).
 */
export function zeitanteilUnter(k: Gebaeudekennlinie, aussen: number): number {
  const spanne = k.heizgrenze - k.normAussen;
  if (spanne <= 0) return 0;
  return Math.min(1, Math.max(0, (aussen - k.normAussen) / spanne));
}

/** Temperatur an einer Stelle der Dauerlinie [°C]; u = 0 ist der kälteste Punkt. */
export function dauerlinie(k: Gebaeudekennlinie, u: number): number {
  return k.normAussen + (k.heizgrenze - k.normAussen) * Math.min(1, Math.max(0, u));
}

export interface Bivalenzergebnis {
  /** Das angewandte Verfahren — steht im Export, damit es nachvollziehbar ist. */
  verfahren: 'dauerlinie-linear';
  betrieb: BivalenzBetrieb;
  bivalenzpunkt: number;
  /** Nur bei alternativ und teilparallel. */
  abschaltpunkt?: number;
  /** Deckungsanteil der Wärmepumpe an der Heizarbeit [0 … 1]. */
  anteilWaermepumpe: number;
  /** Deckungsanteil des zweiten Erzeugers [0 … 1]. */
  anteilZweiterzeuger: number;
  /** Anteil der Heizzeit unter dem Bivalenzpunkt [0 … 1]. */
  zeitanteilUnterBivalenz: number;
  /** Anteil der Heizzeit, in dem die Wärmepumpe aus ist [0 … 1]. */
  zeitanteilOhneWaermepumpe: number;
  /** Leistung der Wärmepumpe am Bivalenzpunkt [kW] — die Gebäudelast dort. */
  leistungAmBivalenzpunkt: number;
  /** Höchste Leistung, die der zweite Erzeuger tragen muss [kW]. */
  leistungZweiterzeuger: number;
  /** Eingetragene Leistung des zweiten Erzeugers [kW]. */
  leistungVorhanden: number;
  /** Fehlbetrag [kW]; 0, wenn die eingetragene Leistung reicht. */
  leistungFehlt: number;
  /** Jede Annahme, die in diese Zahlen eingegangen ist — im Klartext. */
  annahmen: string[];
}

/**
 * Warum keine Rechnung möglich ist. Jeder Grund ist ein Satz, der dem Anwender
 * gesagt wird — `undefined` ohne Begründung wäre eine Lücke, die niemand
 * schließen kann.
 */
export type BivalenzHindernis =
  | 'kein-zweiterzeuger'
  | 'keine-heizgrenze'
  | 'keine-heizlast'
  | 'heizgrenze-unter-norm'
  | 'solarthermie';

export const BIVALENZ_HINDERNIS_TEXT: Record<BivalenzHindernis, string> = {
  'kein-zweiterzeuger': 'Die Anlage ist monovalent — es gibt nichts aufzuteilen.',
  'keine-heizgrenze':
    'Ohne Heizgrenztemperatur gibt es keine Dauerlinie. Sie steht im Anlagenblatt unter „Verteilung" und ist eine Einstellung am Gerät — geraten wird sie nicht.',
  'keine-heizlast': 'Ohne Heizlast gibt es keine Gebäudekennlinie.',
  'heizgrenze-unter-norm':
    'Die Heizgrenztemperatur liegt nicht über der Norm-Außentemperatur. Dann gibt es keine Heizzeit, über die sich etwas aufteilen ließe — eine der beiden Angaben stimmt nicht.',
  solarthermie:
    'Solarthermie hat keinen Bivalenzpunkt im Sinne des BDH-Infoblatts 57: Ihr Beitrag hängt an der Einstrahlung und nicht an der Außentemperatur. Ihn über eine Dauerlinie der Temperatur zu verteilen wäre eine Zahl ohne Grundlage.',
};

/**
 * Die Deckungsanteile — oder der Grund, warum es keine gibt.
 *
 * **Die drei Formeln.** Mit u = Zeitanteil unter einer Temperatur und dem
 * Lastdreieck Q(u) = Q_N · (1 − u):
 *
 *  • **parallel** — unter dem Bivalenzpunkt trägt die Wärmepumpe weiter ihre
 *    Leistung vom Bivalenzpunkt, der zweite Erzeuger die Spitze darüber.
 *    Dessen Anteil ist das kleine Dreieck an der Spitze:
 *    **f₂ = u_biv²**.
 *  • **alternativ** — unter dem Abschaltpunkt trägt der zweite Erzeuger
 *    **alles**. Sein Anteil ist das Trapez bis dorthin:
 *    **f₂ = 2·u_ab − u_ab²**.
 *  • **teilparallel** — beides hintereinander: bis zum Abschaltpunkt alles,
 *    zwischen Abschalt- und Bivalenzpunkt nur die Spitze:
 *    **f₂ = 2·u_ab − u_ab² + (u_biv − u_ab)²**.
 *
 * Die drei Formeln gehen stetig ineinander über, und daran lassen sie sich
 * prüfen: Mit u_ab = u_biv wird teilparallel zu alternativ, mit u_ab = 0 wird
 * es zu parallel. Eine Formel, die diese zwei Proben nicht besteht, ist falsch.
 *
 * `monoenergetisch` rechnet wie parallel — der Heizstab läuft neben der
 * Wärmepumpe. Er ist nur meist zu klein für die Spitze, und genau das sagt
 * `leistungFehlt`.
 */
export function bivalenzanteile(
  zweit: SecondGenerator | undefined,
  k: Gebaeudekennlinie,
): { ergebnis: Bivalenzergebnis } | { hindernis: BivalenzHindernis } {
  if (!zweit) return { hindernis: 'kein-zweiterzeuger' };
  if (zweit.art === 'solarthermie') return { hindernis: 'solarthermie' };
  if (!Number.isFinite(k.heizgrenze)) return { hindernis: 'keine-heizgrenze' };
  if (!(k.heizlast > 0)) return { hindernis: 'keine-heizlast' };
  if (k.heizgrenze <= k.normAussen) return { hindernis: 'heizgrenze-unter-norm' };

  const uBiv = zeitanteilUnter(k, zweit.bivalenzpunkt);
  /*
   * Der Abschaltpunkt gilt nur, wo die Betriebsweise ihn kennt — und er kann
   * nicht über dem Bivalenzpunkt liegen: Die Wärmepumpe kann nicht abschalten,
   * bevor der zweite Erzeuger zugeschaltet hat. Steht es doch so im Blatt,
   * wird nicht gerechnet, als sei es anders gemeint: Der Wert wird auf den
   * Bivalenzpunkt begrenzt, und das ist dann der alternative Betrieb.
   */
  const kenntAbschaltung = zweit.betrieb === 'bivalent-alternativ' || zweit.betrieb === 'bivalent-teilparallel';
  const abschaltpunkt = kenntAbschaltung
    ? Math.min(zweit.abschaltpunkt ?? zweit.bivalenzpunkt, zweit.bivalenzpunkt)
    : undefined;
  const uAb = abschaltpunkt === undefined ? 0 : zeitanteilUnter(k, abschaltpunkt);

  const anteilZweit =
    zweit.betrieb === 'bivalent-alternativ'
      ? 2 * uAb - uAb * uAb
      : zweit.betrieb === 'bivalent-teilparallel'
        ? 2 * uAb - uAb * uAb + (uBiv - uAb) * (uBiv - uAb)
        : uBiv * uBiv;

  const lastAmBivalenzpunkt = gebaeudelast(k, zweit.bivalenzpunkt);
  /*
   * Die Leistung, die der zweite Erzeuger im Auslegungsfall tragen muss.
   * Parallel ist es die Spitze über der Wärmepumpenleistung; schaltet die
   * Wärmepumpe ab, ist es die **ganze** Norm-Heizlast. Das ist der Satz, der
   * beim alternativen Betrieb regelmäßig untergeht — und der Grund, warum ein
   * Heizstab dort nichts verloren hat.
   */
  const braucht =
    zweit.betrieb === 'bivalent-parallel' || zweit.betrieb === 'monoenergetisch'
      ? Math.max(0, k.heizlast - lastAmBivalenzpunkt)
      : k.heizlast;

  const annahmen = [
    'Lineare Jahresdauerlinie zwischen Norm-Außentemperatur und Heizgrenztemperatur. Die wirkliche Dauerlinie ist S-förmig; die Gerade überschätzt die kalten Stunden leicht und damit den Anteil des zweiten Erzeugers.',
    'Gebäudekennlinie linear von der Norm-Heizlast bei Norm-Außentemperatur auf null an der Heizgrenze.',
    'Unter dem Bivalenzpunkt trägt die Wärmepumpe weiter die Leistung, die sie dort hatte. Tatsächlich fällt die Leistung einer Luft-Wasser-Wärmepumpe mit der Außentemperatur weiter ab — der Anteil der Wärmepumpe ist damit eher die obere Schranke.',
    'Keine Klimadatenreihe: gerechnet wird mit θ_norm und der Heizgrenze, nicht mit einem Testreferenzjahr.',
    'Dimensionslose Anteile. Absolute Arbeit ergibt sich erst mit dem Jahreswärmebedarf; er wird hier nicht gebildet.',
  ];

  return {
    ergebnis: {
      verfahren: 'dauerlinie-linear',
      betrieb: zweit.betrieb,
      bivalenzpunkt: zweit.bivalenzpunkt,
      ...(abschaltpunkt === undefined ? {} : { abschaltpunkt }),
      anteilWaermepumpe: runde4(1 - anteilZweit),
      anteilZweiterzeuger: runde4(anteilZweit),
      zeitanteilUnterBivalenz: runde4(uBiv),
      zeitanteilOhneWaermepumpe: runde4(zweit.betrieb === 'bivalent-parallel' || zweit.betrieb === 'monoenergetisch' ? 0 : uAb),
      leistungAmBivalenzpunkt: runde2(lastAmBivalenzpunkt),
      leistungZweiterzeuger: runde2(braucht),
      leistungVorhanden: runde2(zweit.leistung),
      leistungFehlt: runde2(Math.max(0, braucht - zweit.leistung)),
      annahmen,
    },
  };
}

/**
 * Ein **Vorschlag** für den Bivalenzpunkt aus der Leistung der Wärmepumpe.
 *
 * Der Bivalenzpunkt ist graphisch der Schnittpunkt der Gerätekennlinie mit der
 * Gebäudekennlinie: die Temperatur, unter der das Gerät die Last nicht mehr
 * allein trägt. Genau das wird hier aufgelöst — mit der Leistung, die das
 * Gerät im Auslegungspunkt hat.
 *
 * **Warum ein Vorschlag und keine Festlegung.** Der eingetragene
 * Bivalenzpunkt ist eine Planungsentscheidung: Wer ihn höher legt, kauft
 * Betriebskosten gegen Investition. Das Programm stellt den gerechneten
 * daneben — wie bei der Zahl der Wohneinheiten —, damit ein Widerspruch
 * sichtbar wird, und wählt nicht aus.
 *
 * `undefined`, wenn das Gerät die Norm-Heizlast allein trägt: Dann gibt es
 * keinen Schnittpunkt im Heizbereich, und die Anlage ist monovalent fähig.
 */
export function vorschlagBivalenzpunkt(
  k: Gebaeudekennlinie,
  leistungImAuslegungspunkt: number,
): number | undefined {
  if (!(k.heizlast > 0) || k.heizgrenze <= k.normAussen) return undefined;
  if (leistungImAuslegungspunkt >= k.heizlast) return undefined;
  if (leistungImAuslegungspunkt <= 0) return k.heizgrenze;
  // Gebäudekennlinie nach θ aufgelöst: θ = θ_HG − (Q/Q_N)·(θ_HG − θ_norm)
  const theta = k.heizgrenze - (leistungImAuslegungspunkt / k.heizlast) * (k.heizgrenze - k.normAussen);
  return Math.round(theta * 10) / 10;
}

const runde2 = (v: number): number => Math.round(v * 100) / 100;
const runde4 = (v: number): number => Math.round(v * 10000) / 10000;
