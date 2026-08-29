/**
 * Sicherheitstechnik der Heizungsanlage — Ausdehnungsgefäß, Sicherheitsventil,
 * Pflichtarmaturen nach DIN EN 12828 und DIN 4753.
 * ---------------------------------------------------------------------------
 * **Warum es dieses Modul gibt.**
 *
 * Die Sicherheitsausrüstung ist der Teil der Anlage, der niemals gebraucht
 * wird — bis er gebraucht wird. Sie wird deshalb in der Praxis oft nach
 * Gefühl gesetzt: „nehmen wir das 50er Gefäß, das reicht schon". Reicht es
 * nicht, geht das Sicherheitsventil im Winter ab, die Anlage verliert Wasser,
 * beim Nachfüllen kommt Sauerstoff hinein, und zwei Jahre später steht der
 * Plattenwärmetauscher voll Magnetit. Die Auslegung ist einfach genug, um sie
 * zu rechnen — sie besteht aus vier Drücken und zwei Volumina.
 *
 * **Umgang mit Normzahlen.** DIN-Volltexte sind nicht frei. Dieses Modul
 * enthält deshalb keine abgeschriebenen Normtabellen, sondern:
 *  • physikalisch hergeleitete Werte — der Ausdehnungskoeffizient wird aus
 *    der Dichte des Wassers gerechnet, nicht aus einer Tabelle gelesen;
 *  • die in Fachliteratur und Herstellerunterlagen frei zitierten Formeln
 *    (p_0, p_F, p_e, V_n) — sie sind Allgemeingut der Heizungstechnik;
 *  • Zuordnungstabellen (Nennweite ↔ Leistung), die ausdrücklich als
 *    **Richtwerte** geführt und als überschreibbare Konstanten exportiert
 *    werden. Maßgeblich ist immer die Bauteilkennzeichnung des Ventils.
 *
 * Grundlagen:
 *  • DIN EN 12828 — Heizungssysteme in Gebäuden, Sicherheitstechnik
 *  • DIN EN 13831 — geschlossene Ausdehnungsgefäße mit Membran
 *  • DIN 4753 — Trinkwassererwärmer, Sicherheitseinrichtungen
 *  • DIN EN 1717 / DIN 1988-100 — Schutz des Trinkwassers beim Befüllen
 *  • VDI 2035 — Füllwasserqualität, Luft- und Schlammabscheidung
 */

import type { PipeDimension, SafetyDesign, SchematicKind } from '../types/bim';

// ---------------------------------------------------------------------------
// Dichte des Wassers und Ausdehnungskoeffizient
// ---------------------------------------------------------------------------

/**
 * Dichte von reinem, luftfreiem Wasser bei Umgebungsdruck [kg/m³].
 *
 * Verwendet wird die Zustandsgleichung von Kell (1975), eine rationale
 * Funktion fünften Grades, die im Bereich 0–150 °C auf besser als 0,01 kg/m³
 * mit den Dampftafeln übereinstimmt. Sie ist frei publiziert und wird hier
 * bewusst als Formel geführt, damit der Ausdehnungskoeffizient *gerechnet*
 * und nicht abgeschrieben wird:
 *
 *   ρ(ϑ) = (a₀ + a₁ϑ + a₂ϑ² + a₃ϑ³ + a₄ϑ⁴ + a₅ϑ⁵) / (1 + bϑ)
 *
 * Prüfpunkte: ρ(0) = 999,840, ρ(4) = 999,975 (Dichtemaximum),
 * ρ(100) = 958,36 kg/m³.
 *
 * Der Druckeinfluss wird vernachlässigt: Wasser ist mit rund 5·10⁻⁵ 1/bar
 * kompressibel, über die 3 bar einer Hausanlage sind das 1,5·10⁻⁴ — zwei
 * Größenordnungen unter dem thermischen Effekt.
 */
export function waterDensity(temperature: number): number {
  const t = temperature;
  const numerator =
    999.83952 +
    16.945176 * t -
    7.9870401e-3 * t * t -
    46.170461e-6 * t * t * t +
    105.56302e-9 * t * t * t * t -
    280.54253e-12 * t * t * t * t * t;
  return numerator / (1 + 16.87985e-3 * t);
}

/**
 * Bezugstemperatur des Ausdehnungskoeffizienten [°C].
 *
 * DIN EN 12828 rechnet das Ausdehnungsvolumen gegen den kalten Zustand der
 * gefüllten Anlage. 10 °C ist die übliche Annahme für Füllwasser aus dem
 * Trinkwassernetz. Wer im Sommer mit 15 °C füllt, liegt mit dem gerechneten
 * Gefäß auf der sicheren Seite.
 */
export const EXPANSION_REFERENCE_TEMPERATURE = 10;

/** Ein Stützpunkt der Ausdehnungskurve. */
export interface ExpansionPoint {
  /** Temperatur [°C]. */
  temperature: number;
  /** Dichte des Mediums [kg/m³]. */
  density: number;
  /** Ausdehnungskoeffizient n = ρ(10)/ρ(ϑ) − 1 [-]. */
  n: number;
  /** Dasselbe in Prozent — so steht es in den Herstellerunterlagen. */
  percent: number;
}

/** Frostschutzmittel — die beiden im Heizungsbau gebräuchlichen Glykole. */
export type GlycolKind = 'ethylen' | 'propylen';

/**
 * Stoffwerte der reinen Glykole.
 *
 * **Herkunft.** Dichte und spezifische Wärmekapazität sind Handbuchwerte für
 * die Reinstoffe bei 20 °C und in jeder Stoffdatensammlung nachzulesen. Der
 * kubische Ausdehnungskoeffizient ist ein Mittelwert über 0–100 °C; Glykole
 * dehnen sich etwa doppelt so stark aus wie Wasser, was der eigentliche Grund
 * für das größere Gefäß ist.
 *
 * Die Gefrierpunkte sind **Richtwerte aus Herstellerdatenblättern** von
 * Fertiggemischen. Sie streuen zwischen den Produkten um 1–2 K, weil die
 * Inhibitorpakete unterschiedlich sind. Für die Auslegung genügt das; für die
 * Bestellung gilt das Datenblatt des tatsächlich eingesetzten Mittels.
 */
export interface GlycolProperties {
  label: string;
  /** Dichte des Reinstoffs bei 20 °C [kg/m³]. */
  density20: number;
  /** Kubischer Ausdehnungskoeffizient, Mittelwert 0–100 °C [1/K]. */
  cubicExpansion: number;
  /** Spezifische Wärmekapazität des Reinstoffs [kJ/(kg·K)]. */
  heatCapacity: number;
  /**
   * Exponent k des Viskositätsansatzes η_Gemisch/η_Wasser = exp(k·x) bei
   * 20 °C, x als Volumenanteil [-]. **Richtwert**, an Handbuchwerte
   * angepasst: 30 Vol-% Ethylenglykol ergeben damit das 2,1-fache, 30 Vol-%
   * Propylenglykol das 2,8-fache der Wasserviskosität. In der Kälte wird es
   * deutlich schlechter — ein Solekreis bei −5 °C liegt beim Vielfachen.
   */
  viscosityExponent: number;
  /** Gefrierpunkt-Stützstellen: Volumenanteil [%] → Temperatur [°C]. */
  freezePoints: readonly { fraction: number; temperature: number }[];
  note: string;
}

export const GLYCOLS: Record<GlycolKind, GlycolProperties> = {
  ethylen: {
    label: 'Ethylenglykol',
    density20: 1113,
    cubicExpansion: 6.2e-4,
    heatCapacity: 2.42,
    viscosityExponent: 2.6,
    freezePoints: [
      { fraction: 0, temperature: 0 },
      { fraction: 20, temperature: -9 },
      { fraction: 25, temperature: -12 },
      { fraction: 30, temperature: -15 },
      { fraction: 35, temperature: -19 },
      { fraction: 40, temperature: -24 },
      { fraction: 45, temperature: -29 },
      { fraction: 50, temperature: -36 },
      { fraction: 55, temperature: -41 },
      { fraction: 60, temperature: -48 },
    ],
    note: 'Giftig. In Anlagen mit Verbindung zum Trinkwasser unzulässig; für Solekreise üblich.',
  },
  propylen: {
    label: 'Propylenglykol',
    density20: 1036,
    cubicExpansion: 7.3e-4,
    heatCapacity: 2.5,
    viscosityExponent: 3.4,
    freezePoints: [
      { fraction: 0, temperature: 0 },
      { fraction: 20, temperature: -7 },
      { fraction: 25, temperature: -10 },
      { fraction: 30, temperature: -13 },
      { fraction: 35, temperature: -17 },
      { fraction: 40, temperature: -21 },
      { fraction: 45, temperature: -26 },
      { fraction: 50, temperature: -33 },
      { fraction: 55, temperature: -40 },
      { fraction: 60, temperature: -48 },
    ],
    note: 'Physiologisch unbedenklich, deshalb Standard in Wärmepumpen- und Solarkreisen. Zäher als Ethylenglykol.',
  },
};

/**
 * Dichte eines Wasser-Glykol-Gemisches [kg/m³].
 *
 * Angesetzt wird **ideale Mischung**: die Volumina addieren sich. Real ist das
 * Exzessvolumen von Wasser und Glykol leicht negativ (das Gemisch ist etwas
 * dichter als die Rechnung), der Fehler liegt bei 30 Vol-% unter 0,5 %. Für
 * die Gefäßauslegung ist das ohne Bedeutung; für eine Dichtemessung an der
 * Anlage wäre es zu ungenau.
 *
 * `fraction` ist der Volumenanteil Glykol [%] im Bezugszustand (10 °C).
 */
export function mixtureDensity(temperature: number, fraction: number, kind: GlycolKind): number {
  const x = clamp(fraction, 0, 100) / 100;
  if (x <= 0) return waterDensity(temperature);
  const glycol = GLYCOLS[kind];
  // Glykolanteil: Dichte über den kubischen Ausdehnungskoeffizienten von der
  // Bezugstemperatur 20 °C aus fortgeschrieben.
  const densityGlycol = glycol.density20 / (1 + glycol.cubicExpansion * (temperature - 20));
  const densityWater = waterDensity(temperature);
  // Volumenanteile verschieben sich mit der Temperatur; für die Masse zählt
  // der Zustand bei der Bezugstemperatur.
  const massGlycol = x * (glycol.density20 / (1 + glycol.cubicExpansion * (EXPANSION_REFERENCE_TEMPERATURE - 20)));
  const massWater = (1 - x) * waterDensity(EXPANSION_REFERENCE_TEMPERATURE);
  const volume = massGlycol / densityGlycol + massWater / densityWater;
  return (massGlycol + massWater) / volume;
}

/**
 * Ausdehnungskoeffizient n(ϑ) = ρ(ϑ_Bezug)/ρ(ϑ) − 1 [-].
 *
 * Das ist die Definition, aus der die bekannten Tabellenwerte stammen — sie
 * werden hier gerechnet statt abgeschrieben. Kontrollwerte dieser Funktion:
 * n(40) = 0,00754, n(60) = 0,01678, n(80) = 0,02871, n(90) = 0,03561,
 * n(110) = 0,05127.
 *
 * Die klassischen Tabellen der Heizungstechnik beziehen sich auf 4 °C, das
 * Dichtemaximum, und liegen deshalb um konstant 0,000275 höher — dort steht
 * n(80) = 0,0290. Bei 300 l Anlageninhalt sind das 0,08 l Unterschied im
 * Ausdehnungsvolumen; das verschwindet in der Baugrößenreihe. Gerechnet wird
 * hier gegen 10 °C, weil das die Temperatur des Füllwassers ist.
 *
 * Oberhalb von 110 °C wird die Rechnung nicht falsch, aber die Anlage: dort
 * beginnt der Bereich, in dem der Dampfdruck über 1,4 bar liegt und die
 * Sicherheitstechnik nach anderen Regeln ausgelegt wird.
 */
export function expansionCoefficient(temperature: number, glycol?: { fraction: number; kind: GlycolKind }): number {
  const reference =
    glycol && glycol.fraction > 0
      ? mixtureDensity(EXPANSION_REFERENCE_TEMPERATURE, glycol.fraction, glycol.kind)
      : waterDensity(EXPANSION_REFERENCE_TEMPERATURE);
  const actual =
    glycol && glycol.fraction > 0
      ? mixtureDensity(temperature, glycol.fraction, glycol.kind)
      : waterDensity(temperature);
  return reference / actual - 1;
}

/**
 * Stützstellen der Ausdehnungskurve von 10 bis 110 °C in 5-K-Schritten.
 *
 * Gedacht für Anzeige und Nachvollziehbarkeit — gerechnet wird in
 * `membraneVessel` immer mit der stetigen Funktion, nicht mit Interpolation
 * zwischen diesen Punkten.
 */
export function expansionTable(glycol?: { fraction: number; kind: GlycolKind }): ExpansionPoint[] {
  const points: ExpansionPoint[] = [];
  for (let t = EXPANSION_REFERENCE_TEMPERATURE; t <= 110; t += 5) {
    const density = glycol && glycol.fraction > 0 ? mixtureDensity(t, glycol.fraction, glycol.kind) : waterDensity(t);
    const n = expansionCoefficient(t, glycol);
    points.push({
      temperature: t,
      density: Math.round(density * 1000) / 1000,
      n: Math.round(n * 100000) / 100000,
      percent: Math.round(n * 10000) / 100,
    });
  }
  return points;
}

/** Die Kurve für reines Heizungswasser — der Normalfall. */
export const WATER_EXPANSION_TABLE: ExpansionPoint[] = expansionTable();

/**
 * Kennwerte eines Frostschutzgemisches.
 *
 * `flowFactor` ist der Faktor, um den der Volumenstrom gegenüber Wasser
 * steigen muss, um dieselbe Wärme zu transportieren:
 *
 *   f = (ρ·c)_Wasser / (ρ·c)_Gemisch
 *
 * mit der massenanteilig gemittelten Wärmekapazität. Bei 30 Vol-% Ethylen-
 * glykol ergibt das rund 1,12 — die Pumpe muss also 12 % mehr fördern, und
 * die Rohrleitung wird eine Nennweite größer, bevor die Geschwindigkeit
 * anläuft.
 *
 * `pressureDropFactor` ist ein **Richtwert**. Er beantwortet die Frage, die
 * bei der Pumpenauswahl zählt: um wieviel steigt der Druckverlust desselben
 * Netzes, wenn dieselbe Wärme mit Gemisch statt mit Wasser transportiert
 * wird? Nach Blasius gilt im turbulenten Bereich Δp ∝ ρ^0,75 · η^0,25 · w^1,75,
 * und die Geschwindigkeit steigt bereits um `flowFactor`:
 *
 *   f_Δp = (ρ_G/ρ_W)^0,75 · (η_G/η_W)^0,25 · f_V^1,75
 *
 * Bei 30 Vol-% Propylenglykol führt das auf rund das 1,6-fache, bei 25 Vol-%
 * auf 1,48. Die
 * Viskosität ist dabei die unsicherste Größe (siehe `viscosityExponent`) —
 * deshalb Richtwert und nicht Rechenwert.
 */
export interface GlycolMixture {
  fraction: number;
  kind: GlycolKind;
  /** Dichte bei 10 °C [kg/m³]. */
  density: number;
  /** Spezifische Wärmekapazität [kJ/(kg·K)]. */
  heatCapacity: number;
  /** Volumenstromfaktor gegenüber Wasser [-]. */
  flowFactor: number;
  /** Druckverlustfaktor gegenüber Wasser [-], Richtwert. */
  pressureDropFactor: number;
  /** Gefrierpunkt [°C], interpoliert aus den Stützstellen. */
  freezePoint: number;
  /** Ausdehnungskoeffizient bei 50 °C [-] — zum schnellen Vergleich. */
  expansionAt50: number;
  note: string;
}

export function glycolMixture(fraction: number, kind: GlycolKind): GlycolMixture {
  const x = clamp(fraction, 0, 100) / 100;
  const glycol = GLYCOLS[kind];
  const densityWater = waterDensity(EXPANSION_REFERENCE_TEMPERATURE);
  // Der Volumenanteil ist auf den Bezugszustand (10 °C) definiert, deshalb
  // muss auch die Glykoldichte auf 10 °C stehen — mit dem 20-°C-Wert wäre der
  // Massenanteil und damit die Wärmekapazität des Gemisches inkonsistent zu
  // `mixtureDensity`.
  const densityGlycolReference =
    glycol.density20 / (1 + glycol.cubicExpansion * (EXPANSION_REFERENCE_TEMPERATURE - 20));
  const massGlycol = x * densityGlycolReference;
  const massWater = (1 - x) * densityWater;
  const density = mixtureDensity(EXPANSION_REFERENCE_TEMPERATURE, fraction, kind);
  const massShare = massGlycol + massWater > 0 ? massGlycol / (massGlycol + massWater) : 0;
  // Wärmekapazität des Gemisches: massenanteilige Mischungsregel. Sie liegt
  // real 1–2 % über diesem Wert, unterschätzt die Leistung also leicht.
  const heatCapacity = massShare * glycol.heatCapacity + (1 - massShare) * 4.19;
  const flowFactor = (densityWater * 4.19) / (density * heatCapacity);
  return {
    fraction: clamp(fraction, 0, 100),
    kind,
    density: Math.round(density * 10) / 10,
    heatCapacity: Math.round(heatCapacity * 1000) / 1000,
    flowFactor: Math.round(flowFactor * 1000) / 1000,
    pressureDropFactor:
      Math.round(
        (density / densityWater) ** 0.75 * Math.exp(glycol.viscosityExponent * x) ** 0.25 * flowFactor ** 1.75 * 1000,
      ) / 1000,
    freezePoint: glycolFreezePoint(fraction, kind),
    expansionAt50: Math.round(expansionCoefficient(50, { fraction, kind }) * 100000) / 100000,
    note: glycol.note,
  };
}

/**
 * Gefrierpunkt [°C], linear zwischen den Stützstellen des Datenblatts.
 *
 * **Gültigkeitsgrenze.** Die Stützstellen enden bei 60 Vol-%, und das mit
 * Absicht: dort liegt das Eutektikum. Darüber steigt der Gefrierpunkt wieder
 * an — reines Ethylenglykol erstarrt bei rund −13 °C, ist also schlechter als
 * jedes Gemisch. Eine Extrapolation wäre hier nicht ungenau, sondern
 * gefährlich falsch. Für Anteile über der letzten Stützstelle wird deshalb
 * deren Wert zurückgegeben; `designSafety` weist auf den verlassenen
 * Gültigkeitsbereich hin. Höhere Konzentrationen sind ohnehin unsinnig: sie
 * kosten Wärmekapazität und Pumpenleistung ohne Frostschutzgewinn.
 */
export function glycolFreezePoint(fraction: number, kind: GlycolKind): number {
  const points = GLYCOLS[kind].freezePoints;
  const x = clamp(fraction, 0, points[points.length - 1].fraction);
  for (let i = 1; i < points.length; i += 1) {
    if (x <= points[i].fraction) {
      const a = points[i - 1];
      const b = points[i];
      const value = a.temperature + ((b.temperature - a.temperature) * (x - a.fraction)) / (b.fraction - a.fraction);
      return Math.round(value * 10) / 10;
    }
  }
  return points[points.length - 1].temperature;
}

// ---------------------------------------------------------------------------
// Dampfdruck — Grenze nach oben für den Vordruck
// ---------------------------------------------------------------------------

/**
 * Sättigungsdampfdruck von Wasser [bar absolut].
 *
 * Antoine-Gleichung mit den Koeffizienten von Stull für 1–100 °C
 * (log₁₀ p[mmHg] = 8,07131 − 1730,63/(233,426 + ϑ)). Sie trifft 100 °C mit
 * 1,013 bar und 110 °C mit 1,435 bar gegen einen Tafelwert von 1,433 bar; für
 * die Frage „reicht der Vordruck gegen Verdampfen" ist das genau genug.
 *
 * Gebraucht wird das nur bei Anlagen über 100 °C — im Wohnungsbau also nie,
 * in Bestandsanlagen mit alter Regelung gelegentlich doch.
 */
export function vapourPressure(temperature: number): number {
  const mmHg = 10 ** (8.07131 - 1730.63 / (233.426 + temperature));
  return (mmHg * 133.322) / 1e5;
}

// ---------------------------------------------------------------------------
// Membran-Ausdehnungsgefäß
// ---------------------------------------------------------------------------

/**
 * Lieferbare Nenninhalte [l].
 *
 * Die Reihe der handelsüblichen Heizungs-Ausdehnungsgefäße. Sie steht in
 * keiner Norm, sondern ist über die Hersteller hinweg eingespielt; einzelne
 * Zwischengrößen (z. B. 60 l) gibt es je nach Programm zusätzlich.
 */
export const VESSEL_SIZES: readonly number[] = [8, 12, 18, 25, 35, 50, 80, 100, 140, 200, 250, 300, 400, 500, 600, 800, 1000];

/**
 * Mindestvordruck [bar ü] unabhängig von der statischen Höhe.
 *
 * Begründung: unter etwa 0,5 bar arbeitet keine Umwälzpumpe mehr sicher
 * (Kavitation an der Saugseite), und die Membran des Gefäßes liegt am
 * Anschlag. Der Wert ist eine eingeführte Untergrenze der Praxis, keine
 * Normvorgabe — deshalb als Parameter überschreibbar.
 */
export const MINIMUM_PRE_PRESSURE = 0.5;

/**
 * Sicherheitszuschlag auf die statische Höhe [bar].
 *
 * Er hat zwei Aufgaben, die zufällig auf denselben Zahlenwert führen:
 *  1. **Verdampfungsschutz.** Am heißesten Punkt der Anlage — im Erzeuger —
 *     darf das Wasser auch bei Volllast nicht sieden. Der Zuschlag hält den
 *     Druck über dem Sättigungsdruck.
 *  2. **Unterdruckvermeidung am höchsten Punkt.** Fällt der Druck oben unter
 *     den Atmosphärendruck, zieht die Anlage über jede Verschraubung und
 *     jeden Entlüfter Luft. Sauerstoff im Heizwasser heißt Korrosion, und
 *     Korrosion heißt Magnetit im Wärmetauscher.
 */
export const PRE_PRESSURE_MARGIN = 0.2;

/**
 * Mindestabstand zwischen Vordruck und Fülldruck [bar].
 *
 * Der Fülldruck liegt um dieses Maß über dem Vordruck, damit im kalten
 * Zustand die **Wasservorlage** sicher im Gefäß steht. Ohne Vorlage sitzt die
 * Membran im kalten Zustand auf dem Anschlag; jeder Wasserverlust führt dann
 * sofort zu Unterdruck, und die Anlage merkt es erst, wenn sie Luft zieht.
 */
export const FILL_PRESSURE_MARGIN = 0.3;

/**
 * Schließdruckdifferenz des Sicherheitsventils — **Vorbelegung, kein
 * Normzitat**.
 *
 * Ein Sicherheitsventil schließt nicht am Ansprechdruck, sondern erst spürbar
 * darunter; der Enddruck der Gefäßrechnung muss deshalb unter dem
 * Ansprechdruck bleiben, sonst tropft das Ventil im Betrieb. Die
 * Staffelung — bis 5 bar Ansprechdruck pauschal 0,5 bar, darüber 10 % — ist
 * die in Herstellerunterlagen und Fachliteratur durchgängig zitierte
 * Vorgehensweise. Der DIN-Volltext ist nicht frei; die Werte sind deshalb als
 * überschreibbare Parameter geführt. **Maßgeblich ist das Datenblatt des
 * eingebauten Ventils**, das die Schließdruckdifferenz ausweist.
 */
export const CLOSING_DIFFERENCE_LIMIT = 5;
/** Pauschaler Abzug [bar] bis zum Ansprechdruck CLOSING_DIFFERENCE_LIMIT. */
export const CLOSING_DIFFERENCE_FLAT = 0.5;
/** Anteiliger Abzug [-] oberhalb von CLOSING_DIFFERENCE_LIMIT. */
export const CLOSING_DIFFERENCE_SHARE = 0.1;

/**
 * Wasservorlage — **Vorbelegung, kein Normzitat**.
 *
 * Sie gleicht kleine Leckverluste und die Wasseraufnahme beim Entlüften aus,
 * damit nicht nach jeder Heizperiode nachgespeist werden muss (jedes
 * Nachspeisen bringt Sauerstoff und Härtebildner ein, siehe VDI 2035). Die
 * geläufige Vorgabe „0,5 % des Anlageninhalts, mindestens 3 l" stammt aus den
 * Planungsunterlagen der Gefäßhersteller und ist hier überschreibbar.
 */
export const WATER_SEAL_SHARE = 0.005;
/** Mindestwasservorlage [l]. */
export const MINIMUM_WATER_SEAL = 3;

/** Eingabe der Gefäßauslegung. */
export interface VesselInput {
  /** Anlagenwasserinhalt V_A [l]. */
  systemVolume: number;
  /** Statische Höhe: höchster Anlagenpunkt über dem Gefäß [m]. */
  staticHeight: number;
  /** Ansprechdruck des Sicherheitsventils p_SV [bar ü]. */
  safetyPressure: number;
  /** Höchste Mediumtemperatur im Störfall [°C] — sie bestimmt n. */
  maxTemperature: number;
  /** Frostschutz, falls vorhanden. */
  glycol?: { fraction: number; kind: GlycolKind };
  /** Anlagenleistung [kW] für die Nennweite der Ausdehnungsleitung. */
  heatOutput?: number;
  /** Abweichender Mindestvordruck [bar ü]. */
  minimumPrePressure?: number;
  /** Abweichender Zuschlag auf die statische Höhe [bar]. */
  prePressureMargin?: number;
  /** Abweichender Abstand Vordruck → Fülldruck [bar]. */
  fillMargin?: number;
  /** Von Hand gesetzter Vordruck [bar ü] — überschreibt die Rechnung. */
  fixedPrePressure?: number;
  /** Schließdruckdifferenz [bar] aus dem Ventildatenblatt. */
  closingDifference?: number;
  /** Abweichender Anteil der Wasservorlage am Anlageninhalt [-]. */
  waterSealShare?: number;
  /** Abweichende Mindestwasservorlage [l]. */
  minimumWaterSeal?: number;
}

/** Ergebnis der Gefäßauslegung. */
export interface VesselDesign {
  /** Vordruck p_0 [bar ü]. */
  prePressure: number;
  /** Fülldruck p_F [bar ü]. */
  fillPressure: number;
  /** Ansprechdruck p_SV [bar ü]. */
  safetyPressure: number;
  /** Enddruck p_e [bar ü]. */
  endPressure: number;
  /** Abgezogene Schließdruckdifferenz [bar]. */
  closingDifference: number;
  /** Ausdehnungskoeffizient n [-] bei der Auslegungstemperatur. */
  expansionCoefficient: number;
  /** Ausdehnungsvolumen V_e [l]. */
  expansionVolume: number;
  /** Wasservorlage V_WV [l]. */
  waterSeal: number;
  /** Rechnerisches Nennvolumen V_n [l]. */
  requiredVolume: number;
  /** Gewählte Baugröße [l]; 0 = keine Auslegung möglich. */
  selectedVolume: number;
  /** Nutzbarer Anteil des Gefäßvolumens (p_e − p_0)/(p_e + 1) [-]. */
  utilisation: number;
  /** Nennweite der Ausdehnungsleitung [mm]. */
  expansionLine: number;
  notes: { severity: 'info' | 'warn' | 'error'; text: string }[];
}

/**
 * Auslegung des Membran-Ausdehnungsgefäßes.
 *
 * Der Rechengang ist der in jeder Herstellerbroschüre wiedergegebene:
 *
 *   p_0 = max(h_st/10 · ρ-Korrektur + p_D + 0,2 ; p_0,min)
 *   p_F = p_0 + 0,3
 *   p_e = p_SV − Δp_Schließ
 *   V_e = V_A · n(ϑ_max)
 *   V_WV = max(0,005 · V_A ; 3 l)
 *   V_n = (V_e + V_WV) · (p_e + 1)/(p_e − p_0)
 *
 * Die Drücke sind Überdrücke, deshalb das „+1" im Zähler: das Boyle-Mariotte-
 * Gesetz gilt für Absolutdrücke.
 *
 * Alle Zuschläge und Grenzwerte sind überschreibbare Parameter mit
 * offengelegter Herkunft (siehe die Konstanten oben); zitiert wird der Name
 * der Norm, nicht ihr Wortlaut oder ihre Abschnittsnummerierung.
 */
export function membraneVessel(input: VesselInput): VesselDesign {
  const notes: VesselDesign['notes'] = [];
  const minimumPre = input.minimumPrePressure ?? MINIMUM_PRE_PRESSURE;
  const margin = input.prePressureMargin ?? PRE_PRESSURE_MARGIN;
  const fillMargin = input.fillMargin ?? FILL_PRESSURE_MARGIN;
  const systemVolume = Math.max(0, input.systemVolume);

  // Statischer Druck: 10 m Wassersäule entsprechen 0,981 bar. Mit dem Faktor
  // 10 zu rechnen liegt um 2 % auf der sicheren Seite und ist die eingeführte
  // Praxis; mit Frostschutz ist das Medium schwerer, das wird berücksichtigt.
  const densityRatio =
    input.glycol && input.glycol.fraction > 0
      ? mixtureDensity(EXPANSION_REFERENCE_TEMPERATURE, input.glycol.fraction, input.glycol.kind) /
        waterDensity(EXPANSION_REFERENCE_TEMPERATURE)
      : 1;
  const staticPressure = (Math.max(0, input.staticHeight) / 10) * densityRatio;

  // Verdampfungsschutz: erst über 100 °C wird der Dampfdruck maßgebend.
  const vapourGauge = Math.max(0, vapourPressure(input.maxTemperature) - 1.013);

  // Statische Höhe und Dampfdruck **addieren** sich: der heißeste Punkt liegt
  // im Erzeuger, der niedrigste Druck am höchsten Anlagenpunkt. Beide
  // Bedingungen müssen gleichzeitig erfüllt sein, deshalb p_0 = p_st + p_D +
  // Zuschlag und nicht das Maximum der beiden. Unter 100 °C ist p_D null, dann
  // fallen beide Schreibweisen zusammen.
  const computedPre = Math.max(staticPressure + vapourGauge + margin, minimumPre);
  // Auf 0,1 bar aufgerundet — feiner lässt sich ein Gefäß am Manometer der
  // Füllpumpe ohnehin nicht einstellen. Das ε fängt die Rundungsreste der
  // Gleitkommarechnung ab: 0,4 + 0,2 ergibt binär 0,6000000000000001, und ohne
  // ε würde daraus ein Vordruck von 0,7 bar statt 0,6 bar.
  const prePressure = input.fixedPrePressure ?? ceilToTenth(computedPre);
  if (input.fixedPrePressure !== undefined && input.fixedPrePressure + 1e-9 < computedPre) {
    notes.push({
      severity: 'error',
      text: `Der von Hand gesetzte Vordruck von ${num(input.fixedPrePressure, 2)} bar liegt unter dem erforderlichen Wert von ${num(computedPre, 2)} bar. Am höchsten Punkt entsteht Unterdruck, die Anlage zieht Luft.`,
    });
  }
  if (computedPre <= minimumPre + 1e-9 && staticPressure + vapourGauge + margin < minimumPre) {
    notes.push({
      severity: 'info',
      text: `Maßgebend ist der Mindestvordruck von ${num(minimumPre, 2)} bar, nicht die statische Höhe (${num(staticPressure + vapourGauge + margin, 2)} bar). Darunter arbeitet die Umwälzpumpe nicht mehr kavitationsfrei.`,
    });
  }
  if (vapourGauge > 0) {
    notes.push({
      severity: 'warn',
      text: `Bei ${num(input.maxTemperature, 0)} °C beträgt der Sättigungsdruck ${num(vapourPressure(input.maxTemperature), 2)} bar absolut. Der Vordruck muss den Dampfdruck mit abdecken — die Anlage liegt im Bereich über 100 °C und ist gesondert zu betrachten.`,
    });
  }

  const fillPressure = Math.round((prePressure + fillMargin) * 100) / 100;

  // Schließdruckdifferenz — siehe CLOSING_DIFFERENCE_LIMIT.
  const closingDifference =
    input.closingDifference ??
    (input.safetyPressure <= CLOSING_DIFFERENCE_LIMIT
      ? CLOSING_DIFFERENCE_FLAT
      : CLOSING_DIFFERENCE_SHARE * input.safetyPressure);
  const endPressure = Math.round((input.safetyPressure - closingDifference) * 100) / 100;

  const n = expansionCoefficient(input.maxTemperature, input.glycol);
  // Unterhalb der Bezugstemperatur wird n negativ — das Medium zieht sich
  // gegenüber dem Füllzustand zusammen. Ein negatives Ausdehnungsvolumen wäre
  // in der Gefäßrechnung physikalisch sinnlos und würde das Gefäß rechnerisch
  // verkleinern, deshalb hier auf null begrenzt.
  const expansionVolume = systemVolume * Math.max(0, n);
  if (n < 0) {
    notes.push({
      severity: 'warn',
      text: `Die angesetzte Höchsttemperatur von ${num(input.maxTemperature, 0)} °C liegt unter der Bezugstemperatur des Füllwassers von ${num(EXPANSION_REFERENCE_TEMPERATURE, 0)} °C. Es entsteht kein Ausdehnungsvolumen; die Auslegung stützt sich allein auf die Wasservorlage. Höchsttemperatur prüfen.`,
    });
  }
  const waterSeal = Math.max(
    (input.waterSealShare ?? WATER_SEAL_SHARE) * systemVolume,
    input.minimumWaterSeal ?? MINIMUM_WATER_SEAL,
  );

  const span = endPressure - prePressure;
  const utilisation = span > 0 ? span / (endPressure + 1) : 0;

  if (span <= 0) {
    notes.push({
      severity: 'error',
      text: `Enddruck ${num(endPressure, 2)} bar liegt nicht über dem Vordruck ${num(prePressure, 2)} bar. Mit einer statischen Höhe von ${num(input.staticHeight, 1)} m ist ein Ansprechdruck von ${num(input.safetyPressure, 1)} bar zu niedrig — nächsthöheren Ansprechdruck wählen oder das Gefäß tiefer setzen.`,
    });
    return {
      prePressure,
      fillPressure,
      safetyPressure: input.safetyPressure,
      endPressure,
      closingDifference: Math.round(closingDifference * 100) / 100,
      expansionCoefficient: Math.round(n * 100000) / 100000,
      expansionVolume: Math.round(expansionVolume * 10) / 10,
      waterSeal: Math.round(waterSeal * 10) / 10,
      requiredVolume: 0,
      selectedVolume: 0,
      utilisation: 0,
      expansionLine: expansionLineDiameter(input.heatOutput ?? 0),
      notes,
    };
  }
  if (span < 0.5) {
    notes.push({
      severity: 'warn',
      text: `Zwischen Vordruck und Enddruck liegen nur ${num(span, 2)} bar. Das Gefäß nutzt davon ${Math.round(utilisation * 100)} % seines Volumens — die Auslegung wird sehr groß und reagiert empfindlich auf Abweichungen des Vordrucks.`,
    });
  }

  const requiredVolume = ((expansionVolume + waterSeal) * (endPressure + 1)) / span;
  const selectedVolume = VESSEL_SIZES.find((v) => v >= requiredVolume) ?? 0;
  if (selectedVolume === 0) {
    notes.push({
      severity: 'warn',
      text: `Das rechnerische Nennvolumen von ${Math.round(requiredVolume)} l überschreitet die größte Baugröße der Reihe (${VESSEL_SIZES[VESSEL_SIZES.length - 1]} l). Mehrere Gefäße parallel vorsehen; die Summe der Nennvolumina ist maßgebend, der Vordruck ist bei allen gleich einzustellen.`,
    });
  }

  return {
    prePressure,
    fillPressure,
    safetyPressure: input.safetyPressure,
    endPressure,
    closingDifference: Math.round(closingDifference * 100) / 100,
    expansionCoefficient: Math.round(n * 100000) / 100000,
    expansionVolume: Math.round(expansionVolume * 10) / 10,
    waterSeal: Math.round(waterSeal * 10) / 10,
    requiredVolume: Math.round(requiredVolume * 10) / 10,
    selectedVolume,
    utilisation: Math.round(utilisation * 1000) / 1000,
    expansionLine: expansionLineDiameter(input.heatOutput ?? 0),
    notes,
  };
}

/**
 * Nennweite der Ausdehnungsleitung — **Richtwerte**.
 *
 * Die Leitung zum Gefäß muss den Ausdehnungsstrom ohne nennenswerten
 * Druckverlust aufnehmen; maßgebend ist nicht der Volumenstrom des
 * Heizkreises, sondern die Trägheit beim Aufheizen. Die folgende Staffelung
 * ist die in Herstellerunterlagen und Fachliteratur übliche Zuordnung. Sie
 * steht so in keiner frei zugänglichen Norm und ist deshalb hier als
 * überschreibbare Tabelle geführt.
 *
 * Zusätzlich gilt: die Ausdehnungsleitung darf **nicht absperrbar** sein.
 * Zulässig ist allein ein gesichertes Kappenventil, das nur mit Werkzeug
 * betätigt werden kann.
 */
export const EXPANSION_LINE_SIZES: readonly { maxOutput: number; dn: number }[] = [
  { maxOutput: 50, dn: 20 },
  { maxOutput: 100, dn: 25 },
  { maxOutput: 200, dn: 32 },
  { maxOutput: 600, dn: 40 },
  { maxOutput: 1000, dn: 50 },
];

export function expansionLineDiameter(heatOutput: number): number {
  const row = EXPANSION_LINE_SIZES.find((r) => heatOutput <= r.maxOutput);
  return row ? row.dn : EXPANSION_LINE_SIZES[EXPANSION_LINE_SIZES.length - 1].dn;
}

// ---------------------------------------------------------------------------
// Sicherheitsventile
// ---------------------------------------------------------------------------

/** Eine Zeile der Ventilzuordnung. */
export interface SafetyValveRow {
  dn: number;
  /** Anschluss, wie er bestellt wird. */
  connection: string;
  /** Höchste zulässige Wärmeleistung [kW]. */
  maxCapacity: number;
  /** Höchster zulässiger Speicherinhalt [l] — nur bei DIN 4753. */
  maxStorage?: number;
}

/**
 * Sicherheitsventile für Heizungsanlagen (Kennzeichnung „H") — **Richtwerte**.
 *
 * Diese Zuordnung von Nennweite zu Wärmeleistung ist in Fachliteratur und
 * Ventilkatalogen frei zitiert und wird hier in dieser Form übernommen. Sie
 * gilt für Ansprechdrücke bis 3 bar; bei höherem Ansprechdruck steigt die
 * Abblaseleistung, die Zuordnung liegt dann auf der sicheren Seite.
 *
 * **Maßgeblich ist die Bauteilkennzeichnung des tatsächlich eingebauten
 * Ventils.** Sie nennt Ansprechdruck und die geprüfte Leistung in kW; weicht
 * sie von dieser Tabelle ab, gilt das Typenschild.
 */
export const HEATING_SAFETY_VALVES: readonly SafetyValveRow[] = [
  { dn: 15, connection: 'R ½"', maxCapacity: 50 },
  { dn: 20, connection: 'R ¾"', maxCapacity: 100 },
  { dn: 25, connection: 'R 1"', maxCapacity: 200 },
  { dn: 32, connection: 'R 1¼"', maxCapacity: 350 },
  { dn: 40, connection: 'R 1½"', maxCapacity: 600 },
  { dn: 50, connection: 'R 2"', maxCapacity: 900 },
];

/**
 * Sicherheitsventile für Trinkwassererwärmer nach DIN 4753 — **Richtwerte**.
 *
 * Anders als in der Heizung entscheidet hier **beides**: der Speicherinhalt
 * (er bestimmt, wie viel Wasser sich ausdehnt) und die Heizleistung (sie
 * bestimmt, wie schnell). Die Zuordnung ist die geläufige, frei zitierte
 * Staffelung. Auch hier gilt die Bauteilkennzeichnung des Ventils, die bei
 * Trinkwasserventilen zusätzlich die Heizleistung in kW trägt.
 *
 * Der Ansprechdruck richtet sich nach dem zulässigen Betriebsüberdruck des
 * Speichers, üblich sind 6 bar bei einem 10-bar-Behälter.
 */
export const DHW_SAFETY_VALVES: readonly SafetyValveRow[] = [
  { dn: 15, connection: 'R ½"', maxCapacity: 75, maxStorage: 200 },
  { dn: 20, connection: 'R ¾"', maxCapacity: 150, maxStorage: 1000 },
  { dn: 25, connection: 'R 1"', maxCapacity: 250, maxStorage: 5000 },
];

/** Kleinstes Heizungs-Sicherheitsventil, das die Leistung abdeckt. */
export function selectHeatingSafetyValve(heatOutput: number): SafetyValveRow {
  return HEATING_SAFETY_VALVES.find((r) => heatOutput <= r.maxCapacity) ?? HEATING_SAFETY_VALVES[HEATING_SAFETY_VALVES.length - 1];
}

/** Kleinstes Trinkwasser-Sicherheitsventil, das Inhalt **und** Leistung abdeckt. */
export function selectDhwSafetyValve(storageVolume: number, heatingCapacity: number): SafetyValveRow {
  const row = DHW_SAFETY_VALVES.find((r) => storageVolume <= (r.maxStorage ?? 0) && heatingCapacity <= r.maxCapacity);
  return row ?? DHW_SAFETY_VALVES[DHW_SAFETY_VALVES.length - 1];
}

/**
 * Anschlussnennweite aus dem Volumenstrom — hergeleitet, kein Tabellenwert.
 *
 * V̇ = Q / (1,163 · Δϑ) mit 1,163 Wh/(l·K) als Wärmekapazität des Wassers,
 * d = √(4·V̇ / (3600·π·v)). Gerundet wird auf die nächstgrößere Nennweite der
 * Reihe. Bei Frostschutz steigt der Volumenstrom um den Faktor aus
 * `glycolMixture`.
 *
 * Die Vorgabewerte — 5 K Spreizung, 0,8 m/s — sind die für Wärmepumpen
 * üblichen: die kleine Spreizung, weil der Verdichter sonst zu hoch
 * verdichten muss, die Geschwindigkeit, weil darüber Strömungsgeräusche in
 * Wohnräumen hörbar werden.
 */
const DN_SERIES: readonly number[] = [15, 20, 25, 32, 40, 50, 65, 80, 100, 125, 150];

export function connectionDiameter(
  heatOutput: number,
  options: { spread?: number; velocity?: number; flowFactor?: number } = {},
): number {
  const spread = options.spread ?? 5;
  const velocity = options.velocity ?? 0.8;
  const flowFactor = options.flowFactor ?? 1;
  if (heatOutput <= 0 || spread <= 0 || velocity <= 0) return DN_SERIES[0];
  // 1,163 Wh/(l·K) ist die volumenbezogene Wärmekapazität des Wassers. Mit Q
  // in kW hebt sich der Faktor 1000 gegen die Umrechnung l/h → m³/h auf:
  // 10 kW bei 5 K ergeben 1,72 m³/h.
  const flow = (heatOutput / (1.163 * spread)) * flowFactor; // m³/h
  const diameter = Math.sqrt((4 * flow) / (3600 * Math.PI * velocity)) * 1000; // mm
  return DN_SERIES.find((dn) => dn >= diameter) ?? DN_SERIES[DN_SERIES.length - 1];
}

// ---------------------------------------------------------------------------
// Wasserinhalt der Anlage
// ---------------------------------------------------------------------------

/**
 * Richtwert für den Wasserinhalt von Heizkörpern [l/kW].
 *
 * **Herkunft.** Aus den Inhaltsangaben der Hersteller von Plattenheizkörpern:
 * ein Typ 22 mit 600 mm Bauhöhe fasst rund 5 l/m und leistet bei 55/45/20
 * etwa 0,7 kW/m — das sind gut 7 l/kW. Bei 75/65 leistet derselbe Körper
 * doppelt so viel, der spezifische Inhalt halbiert sich also. Der Vorgabewert
 * 8 l/kW passt zu Wärmepumpen-Auslegungstemperaturen; Gussradiatoren im
 * Bestand liegen bei 12–14 l/kW, Konvektoren bei 2–3 l/kW.
 *
 * Deshalb Parameter und nicht Konstante: die Streuung ist größer als die
 * Genauigkeit, die man ihr gern zuschreibt.
 */
export const RADIATOR_SPECIFIC_CONTENT = 8;

/**
 * Verlegeabstand der Fußbodenheizung [m], Vorgabewert.
 *
 * Rohrlänge je m² = 1/Verlegeabstand. Bei 0,15 m sind das 6,67 m/m² — die
 * übliche Größenordnung im Wohnungsbau. Randzonen mit 0,10 m und
 * Nebenräume mit 0,20 m gleichen sich in der Summe meist aus.
 */
export const FLOOR_LOOP_SPACING = 0.15;

export interface SystemVolumeInput {
  /** Wasserinhalt des Erzeugers [l] — aus dem Datenblatt. */
  generator?: { label?: string; volume: number };
  /**
   * Speicher. `heatingShare` ist der heizungsseitige Anteil: ein Puffer zählt
   * voll (1), ein Trinkwasserspeicher nur mit dem Inhalt seines
   * Wärmetauschers — dort steht kein Heizungswasser im Behälter.
   */
  storages?: { label: string; volume: number; heatingShare?: number }[];
  /** Rohrleitungen: Dimension aus der Werkstofftabelle × Länge. */
  pipes?: { label?: string; dimension: PipeDimension; length: number }[];
  /** Fußbodenheizkreise: entweder Rohrlänge oder Fläche mit Verlegeabstand. */
  floorLoops?: { label?: string; dimension: PipeDimension; length?: number; area?: number; spacing?: number }[];
  /** Heizkörper über die Leistung. */
  radiators?: { label?: string; load: number; specificContent?: number }[];
  /** Alles, was sonst noch Wasser hält — Weiche, Verteiler, Solarkreis. */
  extra?: { label: string; volume: number }[];
  /** Abweichender Richtwert für Heizkörper [l/kW]. */
  radiatorContent?: number;
}

export interface SystemVolumeResult {
  /** Gesamtinhalt [l]. */
  total: number;
  /** Aufschlüsselung, wie sie im Nachweis erscheint. */
  parts: { label: string; volume: number }[];
}

/**
 * Wasserinhalt der Anlage V_A [l].
 *
 * Er geht zweimal in die Auslegung ein: in das Ausdehnungsvolumen (direkt)
 * und in die Wasservorlage (mit 0,5 %). Zu klein geschätzt heißt zu kleines
 * Gefäß heißt abblasendes Sicherheitsventil — der häufigste Fehler in der
 * Praxis, und der teuerste, weil er sich erst nach der ersten kalten Woche
 * zeigt.
 *
 * Der Estrich über der Fußbodenheizung enthält kein Wasser und zählt hier
 * nicht mit; für die Mindestlaufzeit des Verdichters ist er trotzdem
 * relevant, das steht in `minimumBufferVolume`.
 */
export function systemVolume(input: SystemVolumeInput): SystemVolumeResult {
  const parts: { label: string; volume: number }[] = [];
  const push = (label: string, volume: number): void => {
    if (volume > 0) parts.push({ label, volume: Math.round(volume * 10) / 10 });
  };

  if (input.generator && input.generator.volume > 0) {
    push(input.generator.label ?? 'Wärmeerzeuger', input.generator.volume);
  }
  for (const storage of input.storages ?? []) {
    const share = storage.heatingShare ?? 1;
    push(storage.label, storage.volume * share);
  }
  for (const pipe of input.pipes ?? []) {
    push(pipe.label ?? `Rohrleitung ${pipe.dimension.label}`, pipe.dimension.content * pipe.length);
  }
  for (const loop of input.floorLoops ?? []) {
    const spacing = loop.spacing ?? FLOOR_LOOP_SPACING;
    const length = loop.length ?? (loop.area && spacing > 0 ? loop.area / spacing : 0);
    push(loop.label ?? `Fußbodenheizung ${loop.dimension.label}`, loop.dimension.content * length);
  }
  for (const radiator of input.radiators ?? []) {
    const specific = radiator.specificContent ?? input.radiatorContent ?? RADIATOR_SPECIFIC_CONTENT;
    push(radiator.label ?? 'Heizkörper', radiator.load * specific);
  }
  for (const item of input.extra ?? []) {
    push(item.label, item.volume);
  }

  const total = parts.reduce((sum, part) => sum + part.volume, 0);
  return { total: Math.round(total * 10) / 10, parts };
}

// ---------------------------------------------------------------------------
// Gesamtauslegung
// ---------------------------------------------------------------------------

/** Eingabe der Gesamtauslegung. */
export interface SafetyDesignInput {
  /**
   * Anlagenwasserinhalt [l], die Aufschlüsselung, aus der er entsteht, oder
   * das fertige Ergebnis von `systemVolume`. Alle drei Formen sind zulässig,
   * damit der Aufrufer die Aufschlüsselung nicht zweimal rechnen muss.
   */
  systemVolume: number | SystemVolumeInput | SystemVolumeResult;
  /** Statische Höhe: höchster Punkt über dem Gefäß [m]. */
  staticHeight: number;
  /** Ansprechdruck des Sicherheitsventils [bar ü]. */
  safetyValvePressure: number;
  /** Höchste Vorlauftemperatur im Störfall [°C]. */
  maxTemperature: number;
  /** Wärmeleistung des Erzeugers [kW] — sie bestimmt die Ventilnennweite. */
  heatOutput: number;
  /** Frostschutzanteil [Vol-%]; 0 = reines Heizungswasser. */
  glycolFraction?: number;
  glycolKind?: GlycolKind;
  /**
   * Liegt die Materialfreigabe des Geräteherstellers für Glykol vor?
   * Ohne sie erlischt bei vielen Wärmepumpen die Gewährleistung, weil der
   * Plattenwärmetauscher auf Wasser ausgelegt ist. Vorbelegt mit `false`,
   * damit der Hinweis erscheint, solange niemand ihn quittiert hat.
   */
  glycolApproved?: boolean;
  /** Bereits vorhandenes Gefäß [l]; 0 = neu auslegen. */
  existingVessel?: number;
  /** Zulässiger Betriebsüberdruck des Gefäßes [bar ü], üblich 3. */
  vesselPressureRating?: number;
  /** Mindestwasserinhalt der Anlage nach Gerätedatenblatt [l]. */
  minSystemVolume?: number;
  /** Mindestvolumenstrom des Erzeugers [m³/h]. */
  minVolumeFlow?: number;
  /**
   * Kleinster Volumenstrom, der im Betrieb noch fließt [m³/h] — bei
   * Einzelraumregelung der Fall, dass nur ein Kreis offen ist.
   */
  lowestVolumeFlow?: number;
  /**
   * Ist die Erzeugerseite hydraulisch von der Verteilung getrennt
   * (Trennpuffer, hydraulische Weiche)?
   *
   * Dann entfällt das Überströmventil: die Primärpumpe fördert unabhängig
   * davon, wie viele Stellantriebe zufahren. **Ein Reihenpuffer leistet das
   * nicht** — er liegt in Reihe im selben Strang und liefert Wasserinhalt,
   * keinen Volumenstrom. Aus den Montageanleitungen: „Falls kein
   * Trennspeicher eingesetzt wird, Mindestheizwasserdurchsatz durch ein
   * Überströmventil sicherstellen."
   */
  hydraulicSeparation?: boolean;
  /** Ist der Erzeuger eine Wärmepumpe? Steuert die Magnetit-Begründung. */
  heatPump?: boolean;
  /** Trinkwassererwärmer, falls vorhanden. */
  dhw?: {
    /** Speicherinhalt [l]. */
    volume: number;
    /** Heizleistung am Wärmetauscher [kW]. */
    heatingCapacity: number;
    /** Zulässiger Betriebsüberdruck des Speichers [bar ü], üblich 10. */
    pressureRating?: number;
    /** Ansprechdruck des Trinkwasser-Sicherheitsventils [bar ü], üblich 6. */
    safetyPressure?: number;
    /** Ist der Speicher bereits abgesichert? Vorbelegt `false`. */
    secured?: boolean;
  };
  /**
   * Wird die Anlage gefördert (BEG-EM)? Dann ist ein Wärmemengenzähler
   * nachzuweisen. Vorbelegt `true`, weil der Zähler ohnehin die einzige
   * Möglichkeit ist, die Jahresarbeitszahl zu belegen.
   */
  subsidised?: boolean;
  /** Auslegungsspreizung [K] für die Anschlussnennweiten. */
  spread?: number;
  /** Von Hand gesetzter Vordruck [bar ü]. */
  fixedPrePressure?: number;
}

/**
 * Vollständige Auslegung der Sicherheitsausrüstung.
 *
 * Liefert Drücke, Volumina, Ventilnennweiten, die Liste der Pflichtarmaturen
 * mit Normbezug und die Hinweise. Die Armaturenliste ist bewusst vollständig
 * und nicht „nur das Wichtigste": sie ist zugleich die Vorlage für das
 * Anlagenschema und für die Massenermittlung.
 */
export function designSafety(input: SafetyDesignInput): SafetyDesign {
  const notes: SafetyDesign['notes'] = [];

  const volumeResult = resolveSystemVolume(input.systemVolume);

  const glycolFraction = input.glycolFraction ?? 0;
  const glycolKind = input.glycolKind ?? 'propylen';
  const mixture = glycolFraction > 0 ? glycolMixture(glycolFraction, glycolKind) : undefined;
  const glycolInput = glycolFraction > 0 ? { fraction: glycolFraction, kind: glycolKind } : undefined;

  const vessel = membraneVessel({
    systemVolume: volumeResult.total,
    staticHeight: input.staticHeight,
    safetyPressure: input.safetyValvePressure,
    maxTemperature: input.maxTemperature,
    glycol: glycolInput,
    heatOutput: input.heatOutput,
    fixedPrePressure: input.fixedPrePressure,
  });
  notes.push(...vessel.notes);

  const valve = selectHeatingSafetyValve(input.heatOutput);
  const mainDn = connectionDiameter(input.heatOutput, {
    spread: input.spread,
    flowFactor: mixture?.flowFactor,
  });

  // -------------------------------------------------------------------------
  // Pflichtarmaturen
  // -------------------------------------------------------------------------
  const fittings: SafetyDesign['fittings'] = [];
  const add = (kind: SchematicKind, label: string, spec: string, norm: string): void => {
    fittings.push({ kind, label, spec, norm });
  };

  add(
    'safety-valve',
    'Sicherheitsventil Heizung',
    `DN ${valve.dn} (${valve.connection}), Ansprechdruck ${num(input.safetyValvePressure, 1)} bar, Kennzeichnung „H", geprüft bis ${valve.maxCapacity} kW`,
    'DIN EN 12828 (Sicherheitseinrichtungen), Bauteilprüfung nach DIN EN ISO 4126-1',
  );
  add(
    'expansion-vessel',
    'Membran-Ausdehnungsgefäß',
    vessel.selectedVolume > 0
      ? `${vessel.selectedVolume} l, Vordruck ${num(vessel.prePressure, 1)} bar, PN ${input.vesselPressureRating ?? 3}`
      : `rechnerisch ${Math.round(vessel.requiredVolume)} l — Auslegung prüfen`,
    'DIN EN 12828, Bauart nach DIN EN 13831',
  );
  add(
    'shutoff',
    'Kappenventil vor dem Ausdehnungsgefäß',
    `DN ${vessel.expansionLine}, gegen unbeabsichtigtes Schließen gesichert, mit Entleerung`,
    'DIN EN 12828 — die Ausdehnungsleitung darf nicht absperrbar sein',
  );
  add(
    'pressure-gauge',
    'Manometer im Erzeugerkreis',
    `Ø 63 mm, Messbereich 0–${Math.ceil((input.safetyValvePressure + 1) * 2) / 2} bar, rote Marke bei ${num(input.safetyValvePressure, 1)} bar`,
    'DIN EN 12828 (Druckanzeige), Gerät nach DIN EN 837-1',
  );
  add(
    'thermometer',
    'Thermometer im Vorlauf',
    'Messbereich 0–120 °C, unmittelbar hinter dem Wärmeerzeuger',
    'DIN EN 12828 (Temperaturanzeige)',
  );
  add(
    'filling-valve',
    'Entleerung am tiefsten Punkt (KFE-Hahn)',
    'DN 15 (R ½") mit Schlauchtülle und Kappe, an jedem entleerbaren Abschnitt',
    'DIN EN 12828 (Entleerung)',
  );
  add(
    'filling-valve',
    'Füll- und Entleerungsarmatur',
    `DN ${Math.min(20, mainDn)} mit Schlauchanschluss, absperrbar, nach dem Füllen zu trennen`,
    'DIN EN 12828 (Befüllung), Füllwasser nach VDI 2035 Blatt 1',
  );
  // Flüssigkeitskategorie nach DIN EN 1717: Heizungswasser ohne Zusätze ist
  // Kategorie 3, mit Frostschutz oder Inhibitoren Kategorie 4. Die
  // Sicherungsarmatur richtet sich danach — CA reicht bis Kategorie 3, für
  // Kategorie 4 ist BA gefordert.
  const category = glycolFraction > 0 ? 4 : 3;
  add(
    'backflow-preventer',
    'Systemtrenner in der Füllleitung',
    category === 4
      ? 'Systemtrenner Typ BA, DN 15–20 — Flüssigkeitskategorie 4 wegen Frostschutzmittel im Heizwasser'
      : 'Systemtrenner Typ CA, DN 15–20 — Flüssigkeitskategorie 3 (Heizungswasser ohne Zusätze)',
    'DIN EN 1717, DIN 1988-100',
  );
  add(
    'water-meter',
    'Wasserzähler in der Füllleitung',
    'DN 15, Zählwerk zur Erfassung der Füll- und Ergänzungswassermenge',
    'VDI 2035 Blatt 1 — die eingebrachte Wassermenge ist zu dokumentieren',
  );
  add(
    'air-separator',
    'Mikroblasen-Luftabscheider',
    `DN ${mainDn}, im Vorlauf an der heißesten Stelle`,
    'DIN EN 12828 (Entlüftung), VDI 2035 Blatt 2',
  );
  add(
    'dirt-separator',
    input.heatPump === false ? 'Schlammabscheider' : 'Schlammabscheider mit Magnetit-Abscheidung',
    input.heatPump === false
      ? `DN ${mainDn}, im Rücklauf vor dem Wärmeerzeuger`
      : `DN ${mainDn}, im Rücklauf vor der Wärmepumpe, mit Magnetstab. Begründung: der Verflüssiger ist ein gelöteter Plattenwärmetauscher mit Spaltweiten im Zehntelmillimeterbereich. Der Schlamm aus Stahlheizkörpern und Stahlrohr ist überwiegend Magnetit (Fe₃O₄) — ferromagnetisch, feinkörnig und für einen rein gravimetrischen Abscheider zu leicht.`,
    'VDI 2035 Blatt 2, Herstellervorgaben zum Wärmetauscherschutz',
  );
  add(
    'check-valve',
    'Rückflussverhinderer',
    `DN ${mainDn}, in der Erzeugerzuleitung und in jedem parallel geführten Kreis gegen Schwerkraftzirkulation`,
    'DIN EN 13959, Einbaufall nach DIN EN 1717',
  );
  add(
    'shutoff',
    'Absperrarmaturen am Wärmeerzeuger',
    `2 × DN ${mainDn} (Vorlauf und Rücklauf). Zwischen Erzeuger und Sicherheitsventil bzw. Ausdehnungsgefäß darf keine absperrbare Armatur liegen.`,
    'DIN EN 12828 (Absperrung des Wärmeerzeugers)',
  );

  const minFlow = input.minVolumeFlow ?? 0;
  const lowestFlow = input.lowestVolumeFlow;
  const overflowNeeded =
    !input.hydraulicSeparation && minFlow > 0 && (lowestFlow === undefined || lowestFlow < minFlow);
  if (overflowNeeded) {
    add(
      'overflow-valve',
      'Überströmventil oder Differenzdruckregler',
      `DN ${connectionDiameter(input.heatOutput, { spread: input.spread, velocity: 1.2, flowFactor: mixture?.flowFactor })}, eingestellt auf einen Mindestvolumenstrom von ${num(minFlow, 2)} m³/h. Ein Differenzdruckregler ist vorzuziehen, wenn der Erzeuger drehzahlgeregelt fährt — er hält den Volumenstrom, ohne den Vorlauf in den Rücklauf kurzzuschließen.`,
      'Herstellervorgabe zum Mindestvolumenstrom; keine Normpflicht, aber Voraussetzung für die Abtauung',
    );
  }

  if (input.subsidised !== false) {
    add(
      'heat-meter',
      'Wärmemengenzähler',
      `DN ${mainDn}, Nenndurchfluss passend zum Auslegungsvolumenstrom, Einbau im Rücklauf mit Temperaturfühlerpaar`,
      'BEG-EM-Förderrichtlinie (Nachweis der Jahresarbeitszahl), Messgerät nach RL 2014/32/EU (MID)',
    );
  }

  if (input.dhw && input.dhw.volume > 0) {
    const dhwValve = selectDhwSafetyValve(input.dhw.volume, input.dhw.heatingCapacity);
    const dhwPressure = input.dhw.safetyPressure ?? 6;
    add(
      'safety-valve',
      'Sicherheitsventil Trinkwassererwärmer',
      `DN ${dhwValve.dn} (${dhwValve.connection}), Ansprechdruck ${num(dhwPressure, 1)} bar, Kennzeichnung „D" mit Heizleistungsangabe, Ablaufleitung mit freiem Auslauf und Schild „Während der Beheizung tritt Wasser aus"`,
      'DIN 4753-1, Sicherheitsgruppe nach DIN 1988-200',
    );
    add(
      'check-valve',
      'Rückflussverhinderer in der Kaltwasserzuleitung',
      `DN ${dhwValve.dn}, Bestandteil der Sicherheitsgruppe, mit Prüfventil`,
      'DIN 1988-200, DIN EN 13959',
    );
  }

  // -------------------------------------------------------------------------
  // Hinweise und Verstöße
  // -------------------------------------------------------------------------
  if (volumeResult.total <= 0) {
    notes.push({
      severity: 'error',
      text: 'Der Anlagenwasserinhalt ist null. Ohne ihn lässt sich kein Ausdehnungsgefäß auslegen — Erzeuger, Speicher, Leitungen und Heizflächen erfassen.',
    });
  }

  // Die Zuordnungstabellen enden bei der größten geläufigen Baugröße. Ohne
  // diesen Hinweis würde `selectHeatingSafetyValve` still das größte Ventil
  // zurückgeben und eine 2000-kW-Anlage bekäme rechnerisch ein Ventil, das für
  // 900 kW geprüft ist.
  if (input.heatOutput > valve.maxCapacity) {
    notes.push({
      severity: 'error',
      text: `Die Erzeugerleistung von ${num(input.heatOutput, 0)} kW liegt über der größten Zeile der Zuordnungstabelle (DN ${valve.dn}, ${valve.maxCapacity} kW). Das Ventil ist nach der Abblaseleistung des Herstellerdatenblatts zu wählen, gegebenenfalls sind mehrere Ventile vorzusehen.`,
    });
  }

  const rating = input.vesselPressureRating ?? 3;
  if (input.safetyValvePressure > rating) {
    notes.push({
      severity: 'error',
      text: `Der Ansprechdruck von ${num(input.safetyValvePressure, 1)} bar liegt über dem zulässigen Betriebsüberdruck des Gefäßes von ${num(rating, 1)} bar. Gefäß der nächsthöheren Druckstufe wählen.`,
    });
  }

  const existing = input.existingVessel ?? 0;
  // Der Vergleich läuft gegen das rechnerische Nennvolumen, nicht gegen die
  // gewählte Baugröße: liegt die Rechnung über der größten Baugröße, ist
  // `selectedVolume` null, und ein zu kleines Bestandsgefäß dürfte nicht als
  // ausreichend durchgehen. Bei requiredVolume = 0 hat die Gefäßrechnung
  // bereits einen Fehler gemeldet — dann sagt der Bestand gar nichts aus.
  if (existing > 0 && vessel.requiredVolume > 0) {
    if (existing < vessel.requiredVolume) {
      notes.push({
        severity: 'error',
        text: `Das vorhandene Gefäß mit ${existing} l ist zu klein: erforderlich sind ${Math.round(vessel.requiredVolume)} l. Ein zu kleines Gefäß treibt den Druck beim Aufheizen über den Ansprechdruck — das Sicherheitsventil bläst ab, die Anlage verliert Wasser und zieht beim Abkühlen Luft.`,
      });
    } else {
      notes.push({
        severity: 'info',
        text: `Das vorhandene Gefäß mit ${existing} l deckt die erforderlichen ${Math.round(vessel.requiredVolume)} l ab. Vordruck vor der Inbetriebnahme drucklos auf ${num(vessel.prePressure, 1)} bar prüfen — er sinkt über die Jahre.`,
      });
    }
  }

  const minSystem = input.minSystemVolume ?? 0;
  if (minSystem > 0 && volumeResult.total < minSystem) {
    notes.push({
      severity: 'warn',
      text: `Der Anlageninhalt von ${Math.round(volumeResult.total)} l unterschreitet den geforderten Mindestwasserinhalt von ${Math.round(minSystem)} l um ${Math.round(minSystem - volumeResult.total)} l. Ohne Puffer bricht beim Abtauen die Vorlauftemperatur ein, und der Verdichter taktet.`,
    });
  }

  if (overflowNeeded && lowestFlow !== undefined) {
    notes.push({
      severity: 'warn',
      text: `Im ungünstigsten Betriebsfall fließen nur ${num(lowestFlow, 2)} m³/h, gefordert sind ${num(minFlow, 2)} m³/h. Ohne Überströmventil oder Differenzdruckregler geht der Erzeuger auf Störung.`,
    });
  }

  if (mixture) {
    notes.push({
      severity: 'info',
      text: `Frostschutz ${GLYCOLS[glycolKind].label} ${num(mixture.fraction, 0)} Vol-%: Gefrierpunkt ${num(mixture.freezePoint, 0)} °C, Volumenstrom ×${num(mixture.flowFactor, 2)}, Druckverlust rund ×${num(mixture.pressureDropFactor, 2)} (Richtwert). Der Ausdehnungskoeffizient steigt auf ${num(vessel.expansionCoefficient * 100, 2)} % — das Gefäß wird entsprechend größer.`,
    });
    if (input.glycolApproved !== true) {
      notes.push({
        severity: 'warn',
        text: 'Für den Frostschutz liegt keine Materialfreigabe des Geräteherstellers vor. Glykol greift Dichtungen und Weichlot an, senkt die Leistung des Plattenwärmetauschers und kann bei Übertemperatur zu Säurebildung führen. Freigabe einholen und die Konzentration jährlich prüfen.',
      });
    }
    // Gültigkeitsgrenze der Gefrierpunktkurve: über dem Eutektikum steigt der
    // Gefrierpunkt wieder an, der interpolierte Wert wäre dort zu günstig.
    const highestFraction = GLYCOLS[glycolKind].freezePoints[GLYCOLS[glycolKind].freezePoints.length - 1].fraction;
    if (glycolFraction > highestFraction) {
      notes.push({
        severity: 'error',
        text: `Der Frostschutzanteil von ${num(glycolFraction, 0)} Vol-% liegt über der letzten Stützstelle des Datenblatts (${num(highestFraction, 0)} Vol-%). Dort liegt das Eutektikum — bei höherer Konzentration steigt der Gefrierpunkt wieder an, der angegebene Wert von ${num(mixture.freezePoint, 0)} °C gilt nicht. Konzentration zurücknehmen oder das Datenblatt des Mittels heranziehen.`,
      });
    }
    if (glycolKind === 'ethylen') {
      notes.push({
        severity: 'warn',
        text: 'Ethylenglykol ist giftig. In Anlagenteilen mit möglicher Verbindung zum Trinkwasser — Kombispeicher, Frischwasserstation — ist es unzulässig; dort ist Propylenglykol einzusetzen.',
      });
    }
  }

  if (input.dhw && input.dhw.volume > 0) {
    const dhwPressure = input.dhw.safetyPressure ?? 6;
    const dhwRating = input.dhw.pressureRating ?? 10;
    if (input.dhw.secured !== true) {
      notes.push({
        severity: 'error',
        text: `Der Trinkwassererwärmer mit ${Math.round(input.dhw.volume)} l ist noch nicht abgesichert. Nach DIN 4753 ist ein bauteilgeprüftes Sicherheitsventil mit Kennzeichnung „D" zwingend; ein Rückflussverhinderer in der Kaltwasserzuleitung ohne Sicherheitsventil schließt das Gefäß druckdicht ein.`,
      });
    }
    if (dhwPressure > dhwRating) {
      notes.push({
        severity: 'error',
        text: `Der Ansprechdruck des Trinkwasser-Sicherheitsventils (${num(dhwPressure, 1)} bar) liegt über dem zulässigen Betriebsüberdruck des Speichers (${num(dhwRating, 1)} bar).`,
      });
    }
    // Auch hier endet die Zuordnungstabelle; ohne Hinweis käme ein 8000-l-
    // Speicher stillschweigend mit dem Ventil für 5000 l davon.
    const largestDhw = DHW_SAFETY_VALVES[DHW_SAFETY_VALVES.length - 1];
    if (input.dhw.volume > (largestDhw.maxStorage ?? 0) || input.dhw.heatingCapacity > largestDhw.maxCapacity) {
      notes.push({
        severity: 'error',
        text: `Speicherinhalt (${Math.round(input.dhw.volume)} l) oder Heizleistung (${num(input.dhw.heatingCapacity, 0)} kW) liegen über der größten Zeile der Zuordnungstabelle (DN ${largestDhw.dn}, ${largestDhw.maxStorage} l, ${largestDhw.maxCapacity} kW). Das Ventil ist nach der Bauteilkennzeichnung zu wählen; Speicher über 5000 l fallen ohnehin unter eine gesonderte Betrachtung.`,
      });
    }
    notes.push({
      severity: 'info',
      text: `Liegt der Ruhedruck im Trinkwassernetz über ${num(dhwPressure * 0.8, 1)} bar, ist ein Druckminderer vorzusehen — sonst tropft das Sicherheitsventil bei jedem Aufheizen. Ein trinkwasserseitiges Ausdehnungsgefäß nach DIN 4807-5 vermeidet den Wasserverlust.`,
    });
  }

  if (input.maxTemperature > 105) {
    notes.push({
      severity: 'warn',
      text: `Die angesetzte Höchsttemperatur von ${num(input.maxTemperature, 0)} °C liegt über dem Bereich, für den die Auslegung nach DIN EN 12828 mit einem Sicherheitstemperaturbegrenzer von 110 °C üblich ist. Anlagen über 105 °C sind gesondert zu betrachten.`,
    });
  }

  notes.push({
    severity: 'info',
    text: `Die Zuordnung von Nennweite und Leistung des Sicherheitsventils ist ein Richtwert. Maßgeblich ist die Bauteilkennzeichnung des eingebauten Ventils: sie nennt Ansprechdruck und geprüfte Abblaseleistung. Die Abblaseleitung ist mindestens in der Nennweite des Ventilaustritts, ohne Absperrung und mit stetigem Gefälle zu führen.`,
  });

  const glycolResult = mixture
    ? { fraction: mixture.fraction, kind: mixture.kind, flowFactor: mixture.flowFactor, freezePoint: mixture.freezePoint }
    : undefined;

  return {
    systemVolume: volumeResult.total,
    volumeParts: volumeResult.parts,
    staticHeight: input.staticHeight,
    prePressure: vessel.prePressure,
    fillPressure: vessel.fillPressure,
    safetyPressure: input.safetyValvePressure,
    endPressure: vessel.endPressure,
    expansionVolume: vessel.expansionVolume,
    waterSeal: vessel.waterSeal,
    requiredVessel: vessel.requiredVolume,
    selectedVessel: vessel.selectedVolume,
    safetyValve: {
      dn: valve.dn,
      label: `DN ${valve.dn} (${valve.connection}), ${num(input.safetyValvePressure, 1)} bar, Kennzeichnung „H"`,
      maxCapacity: valve.maxCapacity,
    },
    expansionLine: vessel.expansionLine,
    glycol: glycolResult,
    fittings,
    notes,
  };
}

// ---------------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------------

/**
 * Nimmt die drei zulässigen Formen der Volumenangabe entgegen.
 *
 * Ein bereits gerechnetes `SystemVolumeResult` wird an seinen Feldern
 * erkannt. Ohne diese Unterscheidung würde ein versehentlich durchgereichtes
 * Ergebnisobjekt als leere Eingabe gelesen und stillschweigend null Liter
 * ergeben — der gefährlichste Fehler, den dieses Modul machen könnte.
 */
function resolveSystemVolume(value: number | SystemVolumeInput | SystemVolumeResult): SystemVolumeResult {
  if (typeof value === 'number') {
    return { total: value, parts: value > 0 ? [{ label: 'Anlagenwasserinhalt', volume: value }] : [] };
  }
  const candidate = value as SystemVolumeResult;
  if (typeof candidate.total === 'number' && Array.isArray(candidate.parts)) {
    return candidate;
  }
  return systemVolume(value as SystemVolumeInput);
}

/**
 * Aufrunden auf 0,1 bar mit Toleranz gegen Gleitkommareste.
 *
 * `Math.ceil(0.6000000000000001 * 10) / 10` ergibt 0,7 — der Vordruck spränge
 * allein wegen der Binärdarstellung eine Stufe zu hoch, und mit ihm der
 * Fülldruck und das Gefäßvolumen. Die Toleranz von 1·10⁻⁹ bar liegt sechs
 * Größenordnungen unter jeder ablesbaren Druckangabe.
 */
function ceilToTenth(value: number): number {
  return Math.ceil(value * 10 - 1e-9) / 10;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Zahl mit deutschem Dezimalkomma und typografischem Minus für Hinweistexte. */
function num(value: number, digits: number): string {
  return value.toFixed(digits).replace('.', ',').replace(/^-/, '\u2212');
}
