/**
 * Hydraulik — Volumenströme, Rohrdimensionierung, Druckverluste, Pumpe.
 * ---------------------------------------------------------------------------
 * **Warum es dieses Modul gibt.**
 *
 * `pipeNetwork.ts` liest die gezeichneten Leitungen als Graph und liefert
 * Längen, Wege und den ungünstigsten Verbraucher — es rechnet aber bewusst
 * nichts. Hier ist die Gegenstelle: der Rechenkern, der aus einer Leistung
 * einen Volumenstrom macht, aus einem Volumenstrom eine Nennweite und aus
 * einem Strang eine Förderhöhe. Beides getrennt zu halten hat einen Grund —
 * die Geometrie ändert sich beim Zeichnen, die Physik nie.
 *
 * **Was hier steht und was nicht.**
 *
 * Alles in dieser Datei ist entweder eine physikalische Beziehung
 * (Kontinuität, Darcy-Weisbach, Colebrook-White) oder ein frei zitierter
 * Stoffwert (Wasserdaten, Rohrmaße, Rauheiten). Was aus einer kostenpflichtigen
 * Norm stammt und nicht öffentlich ist — allen voran das Kennlinienfeld der
 * Fußbodenheizung nach DIN EN 1264-2 —, wird **nicht nachgebaut**, sondern als
 * Eingabeparameter mit Vorbelegung und Herkunftsvermerk geführt. Wer den
 * echten Kennwert aus der Zulassung hat, setzt ihn ein und rechnet belastbar;
 * wer ihn nicht hat, bekommt eine Vordimensionierung, die sich als solche zu
 * erkennen gibt.
 *
 * **Einheiten.** Gerechnet wird durchgehend in SI (m, s, kg, Pa, W, K).
 * Nach außen gehen praxisübliche Einheiten: Volumenstrom in m³/h,
 * Druckgefälle in Pa/m, Einzeldrücke in Pa **und** mbar, Leistungen in kW,
 * Rohrmaße in mm. An jedem Feld und jedem Parameter steht die Einheit dabei.
 *
 * **Grundlagen.**
 *  • Kontinuität und Darcy-Weisbach — jedes Lehrbuch der Strömungsmechanik
 *  • Colebrook, C. F. (1939), J. Inst. Civ. Eng. 11, 133–156
 *  • Swamee, P. K. / Jain, A. K. (1976), J. Hydraul. Div. ASCE 102, 657–664
 *  • Rohrmaße: EN 1057 (Kupfer), EN 10255 (Gewinderohr), EN ISO 15875 (PE-X),
 *    EN ISO 21003 (Mehrschichtverbund), EN ISO 15874 (PP-R)
 *  • Wasserstoffwerte: IAPWS-IF97 bzw. VDI-Wärmeatlas, Stützstellen 0…100 °C
 */

import type { PipeDimension, PipeMaterial, PipeSizing, SchematicKind } from '../types/bim';

// ---------------------------------------------------------------------------
// Kleinkram
// ---------------------------------------------------------------------------

/** Erdbeschleunigung [m/s²] — Normwert nach ISO 80000-3. */
export const GRAVITY = 9.80665;

/** Deutsche Zahlschreibweise für Beschriftungen: Dezimalkomma statt Punkt. */
function de(value: number): string {
  return String(value).replace('.', ',');
}

function round(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

/**
 * Lineare Interpolation in einer Stützstellentabelle.
 *
 * Außerhalb der Tabelle wird **geklemmt, nicht extrapoliert**. Bei Stoffwerten
 * ist das die sichere Variante: eine Extrapolation der Viskosität unter 0 °C
 * sähe aus wie ein Ergebnis, wäre aber keines.
 */
function interpolate(x: number, xs: readonly number[], ys: readonly number[]): number {
  if (x <= xs[0]) return ys[0];
  const last = xs.length - 1;
  if (x >= xs[last]) return ys[last];
  let i = 0;
  while (i < last && xs[i + 1] < x) i += 1;
  const t = (x - xs[i]) / (xs[i + 1] - xs[i]);
  return ys[i] + t * (ys[i + 1] - ys[i]);
}

// ===========================================================================
// 1 — Werkstofftabellen
// ===========================================================================

/**
 * Nennweitenleiter zur Zuordnung von Armaturen [mm].
 *
 * Die Nennweite ist keine Abmessung, sondern eine Sortiernummer: sie sagt,
 * welcher Kugelhahn auf welches Rohr passt. Bei Stahl steht sie in der Norm,
 * bei Kupfer und Kunststoff nicht — dort wird sie zugeordnet. Die hier
 * verwendete Regel ist offengelegt und nachvollziehbar: **die Nennweite mit
 * dem geringsten Abstand zum lichten Innendurchmesser**. Das trifft die
 * Praxis (Cu 22 → DN 20, Cu 28 → DN 25, Verbund 32 → DN 25) und ist an keiner
 * Stelle geraten.
 */
const DN_LADDER = [8, 10, 12, 15, 20, 25, 32, 40, 50, 65, 80, 100, 125, 150] as const;

function nominalDiameter(inner: number): number {
  let best: number = DN_LADDER[0];
  let bestDelta = Math.abs(inner - best);
  for (const dn of DN_LADDER) {
    const delta = Math.abs(inner - dn);
    if (delta < bestDelta) {
      best = dn;
      bestDelta = delta;
    }
  }
  return best;
}

/**
 * Eine Dimension aus Außendurchmesser und Wanddicke aufbauen.
 *
 * Innendurchmesser d_i = d_a − 2·s. Wasserinhalt je Meter:
 * V' = π/4 · d_i² · L. Mit d_i in dm und L = 10 dm (ein Meter) fällt das
 * Ergebnis direkt in Litern an — deshalb der Faktor 10.
 */
function dimensionOf(material: PipeMaterial, outer: number, wall: number, dn?: number, label?: string): PipeDimension {
  const inner = round(outer - 2 * wall, 2);
  const innerDm = inner / 100;
  return {
    material,
    label: label ?? `${de(outer)} × ${de(wall)}`,
    outer,
    wall,
    inner,
    dn: dn ?? nominalDiameter(inner),
    content: round((Math.PI / 4) * innerDm * innerDm * 10, 4),
  };
}

/**
 * Kupfer nach EN 1057, Abmessungen aus dem frei veröffentlichten
 * Lieferprogramm der Halbzeugwerke.
 *
 * 15 bis 42 sind Hausinstallation, ab 54 Verteilung und Steigstrang. 76,1 und
 * 88,9 sind bereits Stahlmaße — Kupfer folgt oberhalb 64 der Rohrreihe des
 * Stahlbaus, damit Formstücke und Schellen passen.
 */
export const COPPER_PIPES: PipeDimension[] = [
  [15, 1],
  [18, 1],
  [22, 1],
  [28, 1.5],
  [35, 1.5],
  [42, 1.5],
  [54, 2],
  [64, 2],
  [76.1, 2],
  [88.9, 2],
].map(([d, s]) => dimensionOf('kupfer', d, s));

/**
 * Stahlrohr DN 10 bis DN 100.
 *
 * Verwendet ist die **mittlere Reihe des Gewinderohrs nach EN 10255** (früher
 * DIN 2440): Außendurchmesser und Wanddicke sind dort tabelliert und werden in
 * jedem Katalog frei zitiert. Für nahtloses Präzisionsrohr nach EN 10220 gilt
 * dieselbe Außenmaßreihe bei kleineren Wanddicken — wer damit rechnet, ersetzt
 * die Tabelle über `sizePipe({ table })`, weil der Innendurchmesser dann um
 * ein bis zwei Millimeter größer ausfällt.
 *
 * Die Nennweite steht hier ausnahmsweise fest und wird nicht zugeordnet: bei
 * Stahl ist sie Teil der Bestellbezeichnung.
 */
export const STEEL_PIPES: PipeDimension[] = [
  [10, 17.2, 2.35],
  [15, 21.3, 2.65],
  [20, 26.9, 2.65],
  [25, 33.7, 3.25],
  [32, 42.4, 3.25],
  [40, 48.3, 3.25],
  [50, 60.3, 3.65],
  [65, 76.1, 3.65],
  [80, 88.9, 4.05],
  [100, 114.3, 4.5],
].map(([dn, d, s]) => dimensionOf('stahl', d, s, dn, `DN ${dn} (${de(d)} × ${de(s)})`));

/**
 * Edelstahl-Pressrohr (1.4401/1.4521) nach EN 10312 Reihe 2.
 *
 * Dünnwandig, deshalb bei gleichem Außenmaß spürbar mehr lichter Querschnitt
 * als Kupfer — 28 × 1,2 hat 25,6 mm statt 25,0 mm. Das sind 2,4 % im
 * Durchmesser, im Druckgefälle aber **rund 11 %**: bei festem Volumenstrom
 * geht der Durchmesser mit R ~ d⁻⁴·⁷⁵ ein (w ~ d⁻², λ ~ Re⁻⁰·²⁵). Nachgerechnet
 * mit diesem Modul bei 50 °C: 1 m³/h ergibt 155,3 Pa/m in Cu 28 × 1,5 gegenüber
 * 138,7 Pa/m in 28 × 1,2. Beim Umschwenken des Werkstoffs ist das der Betrag,
 * um den die Dimensionierung kippen kann.
 */
export const STAINLESS_PIPES: PipeDimension[] = [
  [15, 1.0],
  [18, 1.0],
  [22, 1.2],
  [28, 1.2],
  [35, 1.5],
  [42, 1.5],
  [54, 1.5],
].map(([d, s]) => dimensionOf('edelstahl', d, s));

/**
 * PE-Xa nach EN ISO 15875, Rohrreihe SDR 7,4 (S 3,2).
 *
 * SDR ist das Verhältnis d_a/s; 7,4 ist die im Heizungsbau übliche Reihe.
 * Die dicke Wand kostet Querschnitt: 16 × 2,2 hat nur 11,6 mm licht. Deshalb
 * ist die Werkstoffwahl bei Kunststoff nie neutral — dieselbe „16" trägt je
 * nach Reihe deutlich verschiedene Volumenströme.
 */
export const PEX_PIPES: PipeDimension[] = [
  [16, 2.2],
  [20, 2.8],
  [25, 3.5],
  [32, 4.4],
  [40, 5.5],
  [50, 6.9],
  [63, 8.6],
].map(([d, s]) => dimensionOf('pex', d, s));

/**
 * Mehrschichtverbundrohr (PE-RT/Al/PE-RT) nach EN ISO 21003.
 *
 * Die Aluminiumschicht erlaubt dünnere Wände als bei reinem Kunststoff, was
 * das Verbundrohr hydraulisch näher an Kupfer rückt: 32 × 3 hat 26 mm licht
 * gegenüber 23,2 mm bei PE-Xa 32 × 4,4.
 */
export const MULTILAYER_PIPES: PipeDimension[] = [
  [16, 2],
  [20, 2],
  [26, 3],
  [32, 3],
  [40, 3.5],
  [50, 4],
  [63, 4.5],
].map(([d, s]) => dimensionOf('verbund', d, s));

/**
 * PP-R nach EN ISO 15874, Reihe SDR 7,4 (PN 16 bei 20 °C).
 *
 * Wanddicke = d_a / 7,4, aufgerundet auf die Normstufe — die Werte sind also
 * hergeleitet, nicht abgeschrieben. PP-R kommt im Heizungsbau vor allem in
 * Steigsträngen und Trinkwasserverteilungen vor; im Wärmepumpenkreis ist es
 * wegen der geringen Wärmedehnungsfestigkeit die Ausnahme.
 */
export const PPR_PIPES: PipeDimension[] = [
  [20, 2.8],
  [25, 3.5],
  [32, 4.4],
  [40, 5.5],
  [50, 6.9],
  [63, 8.6],
].map(([d, s]) => dimensionOf('ppr', d, s));

/** Alle Werkstofftabellen, nach Werkstoff greifbar. */
export const PIPE_TABLES: Record<PipeMaterial, PipeDimension[]> = {
  kupfer: COPPER_PIPES,
  stahl: STEEL_PIPES,
  edelstahl: STAINLESS_PIPES,
  pex: PEX_PIPES,
  verbund: MULTILAYER_PIPES,
  ppr: PPR_PIPES,
};

/** Dimension über Werkstoff und Bestellbezeichnung suchen, z. B. `('verbund', '16 × 2')`. */
export function findDimension(material: PipeMaterial, label: string): PipeDimension | undefined {
  const wanted = label.replace(/\s|x|×/gi, '').replace('.', ',');
  return PIPE_TABLES[material].find((d) => d.label.replace(/\s|×/g, '').replace('.', ',').includes(wanted));
}

// ===========================================================================
// 2 — Rohrrauheit
// ===========================================================================

/**
 * Zustand der Rohrinnenwand.
 *
 * Nur bei unlegiertem Stahl relevant. Kupfer, Edelstahl und Kunststoff altern
 * hydraulisch nicht messbar, solange das Anlagenwasser nach VDI 2035 gefahren
 * wird — dort ändert der Zustand die Rauheit nicht.
 */
export type PipeCondition = 'neu' | 'betrieblich' | 'alt';

export const PIPE_CONDITION_LABELS: Record<PipeCondition, string> = {
  neu: 'neu, fabrikfrisch',
  betrieblich: 'betrieblich gealtert',
  alt: 'alt, angerostet oder versintert',
};

/**
 * Absolute Rohrrauheit k [mm] im Neuzustand.
 *
 * Werte, wie sie in Rohrbüchern und Herstellerunterlagen durchgängig zitiert
 * werden (Moody-Diagramm, Recknagel/Sprenger, Katalogangaben der
 * Rohrhersteller):
 *  • gezogenes Kupfer, Edelstahl, Kunststoff: k = 0,0015 mm — „hydraulisch
 *    glatt", die Rauheit verschwindet unter der viskosen Unterschicht.
 *  • Stahl, neu und nahtlos: k = 0,045 mm.
 *
 * Für die praktische Auslegung ist die Streuung dieser Werte gutmütig: λ hängt
 * bei üblichen Reynoldszahlen nur schwach von k ab — schwach heißt aber nicht
 * vernachlässigbar. Nachgerechnet mit diesem Modul (DN 25, d_i 27,2 mm,
 * 0,8 m/s, Wasser 50 °C): k = 0,0015 mm ergibt 258 Pa/m, k = 0,045 mm ergibt
 * 307 Pa/m — **rund 19 %**. Die Werkstoffwahl ist damit im Druckgefälle
 * deutlich spürbar, im Vergleich zur Streuung der Zeta-Werte aber immer noch
 * die kleinere Unsicherheit.
 */
export const PIPE_ROUGHNESS: Record<PipeMaterial, number> = {
  kupfer: 0.0015,
  stahl: 0.045,
  edelstahl: 0.0015,
  pex: 0.0015,
  verbund: 0.0015,
  ppr: 0.0015,
};

/**
 * Rauheit von Stahl im Betrieb [mm].
 *
 * Nach einigen Betriebsjahren liegt die Rauheit eines Heizungsstahlrohrs bei
 * 0,1 bis 0,2 mm — Zunder, Magnetitschlamm, Ablagerungen an den Schweißnähten.
 * Bei der Nachrechnung einer Bestandsanlage ist das der ehrlichere Wert; bei
 * der Neuplanung rechnet man mit `neu`, weil die Anlage im Neuzustand
 * abgeglichen wird und die Reserve die Alterung abdeckt.
 */
export const STEEL_ROUGHNESS_BY_CONDITION: Record<PipeCondition, number> = {
  neu: 0.045,
  betrieblich: 0.1,
  alt: 0.2,
};

/** Rauheit k [mm] für Werkstoff und Zustand. */
export function pipeRoughness(material: PipeMaterial, condition: PipeCondition = 'neu'): number {
  if (material === 'stahl') return STEEL_ROUGHNESS_BY_CONDITION[condition];
  return PIPE_ROUGHNESS[material];
}

// ===========================================================================
// 3 — Stoffwerte: Wasser und Wasser-Glykol-Gemische
// ===========================================================================

/** Frostschutzmittel. Die beiden im Heizungsbau zugelassenen Glykole. */
export type GlycolKind = 'ethylen' | 'propylen';

export const GLYCOL_LABELS: Record<GlycolKind, string> = {
  ethylen: 'Ethylenglykol',
  propylen: 'Propylenglykol',
};

/** Stützstellen der Wassertabellen [°C]. */
export const WATER_TEMPERATURES = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100] as const;

/**
 * Dichte von Wasser bei 1 bar [kg/m³], Stützstellen nach IAPWS-IF97.
 *
 * Das Dichtemaximum bei 4 °C liegt zwischen den Stützstellen und wird von der
 * linearen Interpolation nicht abgebildet. Für die Heizungshydraulik ist das
 * ohne Belang — der Fehler beträgt dort weniger als 0,02 %.
 */
export const WATER_DENSITY = [999.84, 999.7, 998.21, 995.65, 992.22, 988.04, 983.2, 977.76, 971.79, 965.31, 958.35] as const;

/**
 * Spezifische Wärmekapazität von Wasser [J/(kg·K)], Stützstellen nach IAPWS-IF97.
 *
 * Die Kurve hat ein flaches Minimum bei rund 35 °C. Über den ganzen für eine
 * Wärmepumpe relevanten Bereich schwankt c_p um weniger als 0,2 % — deshalb
 * darf die Kurzformel mit einem festen Wert arbeiten (siehe `volumeFlowShort`).
 */
export const WATER_HEAT_CAPACITY = [4219, 4195, 4184, 4180, 4179, 4181, 4185, 4190, 4197, 4205, 4216] as const;

/**
 * Kinematische Viskosität von Wasser [m²/s], Stützstellen nach IAPWS-IF97.
 *
 * Anders als Dichte und Wärmekapazität ändert sich ν im Heizungsbereich um
 * den Faktor 6 zwischen 0 und 100 °C. Wer den Druckverlust einer Solekreis-
 * leitung mit den Stoffwerten von 60 °C rechnet, liegt grob daneben — deshalb
 * nimmt jede Funktion dieses Moduls die Temperatur als Parameter entgegen und
 * unterstellt sie nicht.
 */
export const WATER_KINEMATIC_VISCOSITY = [
  1.792e-6, 1.307e-6, 1.004e-6, 0.801e-6, 0.658e-6, 0.553e-6, 0.475e-6, 0.413e-6, 0.365e-6, 0.326e-6, 0.294e-6,
] as const;

/** Dichte von reinem Wasser [kg/m³] bei ϑ [°C]; interpoliert, außerhalb 0…100 °C geklemmt. */
export function waterDensity(temperature: number): number {
  return interpolate(temperature, WATER_TEMPERATURES, WATER_DENSITY);
}

/** Spezifische Wärmekapazität von reinem Wasser [J/(kg·K)] bei ϑ [°C]; interpoliert. */
export function waterHeatCapacity(temperature: number): number {
  return interpolate(temperature, WATER_TEMPERATURES, WATER_HEAT_CAPACITY);
}

/** Kinematische Viskosität von reinem Wasser [m²/s] bei ϑ [°C]; interpoliert. */
export function waterKinematicViscosity(temperature: number): number {
  return interpolate(temperature, WATER_TEMPERATURES, WATER_KINEMATIC_VISCOSITY);
}

/**
 * Gefrierpunkt über dem Volumenanteil Glykol.
 *
 * Stützstellen aus den frei veröffentlichten Datenblättern der Gemisch-
 * hersteller und dem ASHRAE Handbook Fundamentals, Kapitel „Secondary Coolants".
 * Zwischen den Stützstellen wird **linear interpoliert**; die reale Kurve ist
 * leicht konkav, der Interpolationsfehler bleibt unter 1 K.
 *
 * Über 60 Vol-% wird die Tabelle nicht fortgesetzt: dort steigt der
 * Gefrierpunkt wieder an (eutektischer Punkt bei rund 66 Vol-% Ethylenglykol),
 * und mehr Frostschutz macht die Sache schlechter statt besser. Wer mehr
 * einfüllt, bekommt hier den geklemmten Randwert und den Hinweis dazu.
 */
export const FREEZE_POINT_TABLE: Record<GlycolKind, { fractions: readonly number[]; points: readonly number[] }> = {
  ethylen: {
    fractions: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
    points: [0, -3.4, -8.9, -15.6, -24.4, -36.8, -52.8],
  },
  propylen: {
    fractions: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
    points: [0, -3.3, -7.8, -12.7, -20.6, -33.5, -51.1],
  },
};

/** Gefrierpunkt [°C] eines Gemisches mit dem Volumenanteil `fraction` [0…1]. */
export function freezePoint(fraction: number, kind: GlycolKind = 'ethylen'): number {
  const table = FREEZE_POINT_TABLE[kind];
  return round(interpolate(clamp(fraction, 0, 0.6), table.fractions, table.points), 1);
}

/**
 * Umkehrung: welcher Volumenanteil [0…1] hält bis zur geforderten Temperatur?
 *
 * Praxisnah gefragt wird andersherum — „ich brauche Frostsicherheit bis −15 °C".
 * Die Umkehrung geschieht durch Suche auf derselben Tabelle, damit Hin- und
 * Rückrechnung konsistent bleiben. Aufgerundet auf volle Prozent, weil im
 * Eimer nichts Genaueres abgemessen wird.
 */
export function glycolFractionForFreezePoint(target: number, kind: GlycolKind = 'ethylen'): number {
  const table = FREEZE_POINT_TABLE[kind];
  for (let f = 0; f <= 0.6001; f += 0.01) {
    if (interpolate(f, table.fractions, table.points) <= target) return round(f, 2);
  }
  return 0.6;
}

/**
 * Reinstoffdaten der Glykole bei 20 °C.
 *
 * Dichte und Wärmekapazität der reinen Stoffe sind Tabellenwerte aus jedem
 * Stoffdatenwerk. `expansion` ist die Dichteabnahme je Kelvin, aus dem
 * Volumenausdehnungskoeffizienten gerechnet (EG 6,2·10⁻⁴ 1/K, PG 7,2·10⁻⁴ 1/K).
 * `capacitySlope` ist der Anstieg von c_p mit der Temperatur [J/(kg·K²)].
 *
 * `contraction` ist der Korrekturterm für die Volumenkontraktion beim Mischen:
 * ein Liter Glykol plus ein Liter Wasser ergibt weniger als zwei Liter. Der
 * Term ρ + contraction·φ·(1−φ) ist an die veröffentlichten Dichtetabellen der
 * Gemischhersteller angepasst und trifft sie im Bereich 20…50 Vol-% auf
 * besser als 0,5 %. Er ist eine Anpassung, keine Ableitung — deshalb steht er
 * hier offen als Zahl und nicht versteckt in einer Formel.
 */
export const GLYCOL_PROPERTIES: Record<
  GlycolKind,
  { density: number; heatCapacity: number; expansion: number; capacitySlope: number; contraction: number }
> = {
  ethylen: { density: 1113, heatCapacity: 2410, expansion: 0.69, capacitySlope: 2.6, contraction: 30 },
  propylen: { density: 1036, heatCapacity: 2500, expansion: 0.75, capacitySlope: 2.5, contraction: 12 },
};

/**
 * Relative Viskosität des Gemisches gegenüber Wasser, bezogen auf 20 °C.
 *
 * Stützstellen aus den frei veröffentlichten Viskositätstabellen der
 * Gemischhersteller. Propylenglykol ist bei gleichem Frostschutz deutlich
 * zäher als Ethylenglykol — das ist der eigentliche Grund, warum in
 * Erdsondenkreisen trotz der schlechteren Toxizität oft Ethylenglykol steht.
 */
export const GLYCOL_VISCOSITY_FACTOR: Record<GlycolKind, { fractions: readonly number[]; factors: readonly number[] }> = {
  ethylen: {
    fractions: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
    factors: [1.0, 1.22, 1.55, 1.95, 2.6, 3.5, 4.8],
  },
  propylen: {
    fractions: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
    factors: [1.0, 1.3, 1.85, 2.6, 4.0, 6.0, 9.5],
  },
};

/**
 * Stoffwerte eines Wärmeträgers an einem Betriebspunkt.
 *
 * Alle Felder in SI. `flowFactor` ist die Größe, die im Alltag zählt: um
 * diesen Faktor muss der Volumenstrom gegenüber reinem Wasser steigen, um
 * dieselbe Leistung bei derselben Spreizung zu transportieren.
 */
export interface FluidProperties {
  /** Temperatur [°C], auf die sich alle Werte beziehen. */
  temperature: number;
  /** Volumenanteil Glykol [0…1]. */
  glycolFraction: number;
  glycolKind: GlycolKind;
  /** Dichte ρ [kg/m³]. */
  density: number;
  /** Spezifische Wärmekapazität c_p [J/(kg·K)]. */
  heatCapacity: number;
  /** Volumetrische Wärmekapazität ρ·c_p [J/(m³·K)]. */
  volumetricHeatCapacity: number;
  /** Kinematische Viskosität ν [m²/s]. */
  kinematicViscosity: number;
  /** Dynamische Viskosität η = ν·ρ [Pa·s]. */
  dynamicViscosity: number;
  /** Gefrierpunkt [°C]. */
  freezePoint: number;
  /** Volumenstromzuschlag gegenüber reinem Wasser gleicher Temperatur [-]. */
  flowFactor: number;
  /** Hinweise zur Belastbarkeit der Werte. */
  notes: string[];
}

/**
 * Stoffwerte für Wasser oder ein Wasser-Glykol-Gemisch.
 *
 * **Herleitung, offen gelegt.**
 *  • Dichte: Volumenmischung ρ = (1−φ)·ρ_W + φ·ρ_G, plus Kontraktionsterm
 *    (siehe `GLYCOL_PROPERTIES`). Beides physikalisch begründet.
 *  • Wärmekapazität: Massenmischung. Dazu wird der Volumenanteil φ über die
 *    Dichten in den Massenanteil w = φ·ρ_G/ρ_Gemisch umgerechnet — das ist
 *    exakt, nicht genähert. Die Mischungsregel selbst ist eine Näherung, die
 *    die publizierten Gemischtabellen auf rund 1 % trifft.
 *  • Viskosität: **keine Mischungsregel möglich.** Die Viskosität eines
 *    Glykolgemisches ist stark nichtlinear. Verwendet wird ν = ν_W(ϑ) · f₂₀^e
 *    mit f₂₀ aus der Tabelle und dem Temperaturexponenten
 *    e = 1 + 0,75·(20−ϑ)/40, geklemmt auf 0,6…2,0. Diese Anpassung ist an die
 *    veröffentlichten Herstellertabellen gefittet und trifft sie im Bereich
 *    0…80 °C und 0…50 Vol-% auf etwa ±20 %. Für die Rohrdimensionierung
 *    reicht das: im turbulenten Bereich geht ν nur mit rund der 0,2-ten Potenz
 *    in λ ein, ±20 % in ν sind dort ±4 % im Druckverlust. Im **laminaren**
 *    Bereich — kalte Sole, kleine Querschnitte — schlägt der Fehler dagegen
 *    voll durch; dort gehört die Herstellertabelle eingesetzt. Der Hinweis
 *    steht in `notes`.
 *
 * @param temperature Mitteltemperatur des Abschnitts [°C]
 */
export function fluidProperties(
  temperature: number,
  options: { glycolFraction?: number; glycolKind?: GlycolKind } = {},
): FluidProperties {
  const kind = options.glycolKind ?? 'ethylen';
  const fractionRaw = options.glycolFraction ?? 0;
  const fraction = clamp(fractionRaw, 0, 0.6);
  const notes: string[] = [];
  if (fractionRaw > 0.6) {
    notes.push(
      `Glykolanteil ${Math.round(fractionRaw * 100)} Vol-% liegt über der Tabellengrenze von 60 Vol-%. ` +
        'Gerechnet wird mit 60 Vol-%. Oberhalb des eutektischen Punktes steigt der Gefrierpunkt wieder an.',
    );
  }

  if (temperature < 0 || temperature > 100) {
    // Die Stützstellen enden bei 0 und 100 °C, außerhalb wird geklemmt. Bei
    // Solekreisen unter 0 °C ist genau das die Falle: die Viskosität steigt
    // dort weiter an, die Rechnung nimmt aber den Wert von 0 °C. Das darf nicht
    // stillschweigend passieren.
    notes.push(
      `Betriebstemperatur ${de(round(temperature, 1))} °C liegt außerhalb der Stützstellen 0…100 °C. ` +
        'Dichte, Wärmekapazität und Viskosität werden mit dem Randwert gerechnet, nicht extrapoliert — ' +
        'unter 0 °C wird die Viskosität dadurch unterschätzt und der Druckverlust zu günstig.',
    );
  }

  const densityWater = waterDensity(temperature);
  const capacityWater = waterHeatCapacity(temperature);
  const viscosityWater = waterKinematicViscosity(temperature);

  if (fraction <= 0) {
    return {
      temperature,
      glycolFraction: 0,
      glycolKind: kind,
      density: round(densityWater, 2),
      heatCapacity: round(capacityWater, 1),
      volumetricHeatCapacity: round(densityWater * capacityWater, 0),
      kinematicViscosity: viscosityWater,
      dynamicViscosity: viscosityWater * densityWater,
      freezePoint: 0,
      flowFactor: 1,
      notes,
    };
  }

  const glycol = GLYCOL_PROPERTIES[kind];
  const densityGlycol = glycol.density - glycol.expansion * (temperature - 20);
  const density = (1 - fraction) * densityWater + fraction * densityGlycol + glycol.contraction * fraction * (1 - fraction);

  const massFractionGlycol = (fraction * densityGlycol) / density;
  const capacityGlycol = glycol.heatCapacity + glycol.capacitySlope * (temperature - 20);
  const heatCapacity = massFractionGlycol * capacityGlycol + (1 - massFractionGlycol) * capacityWater;

  const table = GLYCOL_VISCOSITY_FACTOR[kind];
  const factor20 = interpolate(fraction, table.fractions, table.factors);
  const exponent = clamp(1 + (0.75 * (20 - temperature)) / 40, 0.6, 2.0);
  const kinematicViscosity = viscosityWater * factor20 ** exponent;

  notes.push(
    `Stoffwerte für ${Math.round(fraction * 100)} Vol-% ${GLYCOL_LABELS[kind]} bei ${de(round(temperature, 1))} °C. ` +
      'Dichte und Wärmekapazität aus Mischungsregeln (Fehler rund 1 %), Viskosität aus einer Anpassung an ' +
      'Herstellertabellen (Fehler rund 20 %). Bei laminarer Strömung die Herstellerangabe verwenden.',
  );

  return {
    temperature,
    glycolFraction: fraction,
    glycolKind: kind,
    density: round(density, 2),
    heatCapacity: round(heatCapacity, 1),
    volumetricHeatCapacity: round(density * heatCapacity, 0),
    kinematicViscosity,
    dynamicViscosity: kinematicViscosity * density,
    freezePoint: freezePoint(fraction, kind),
    flowFactor: round((densityWater * capacityWater) / (density * heatCapacity), 3),
    notes,
  };
}

/** Reines Wasser bei 50 °C — der Vorgabezustand für Heizungsleitungen. */
export const DEFAULT_FLUID: FluidProperties = fluidProperties(50);

// ===========================================================================
// 4 — Volumenstrom aus Leistung und Spreizung
// ===========================================================================

/**
 * Massenstrom [kg/s] aus Leistung und Spreizung.
 *
 * Aus der Energiebilanz eines durchströmten Abschnitts: Q = ṁ · c_p · Δϑ.
 * Das ist keine Näherung, sondern der erste Hauptsatz für ein offenes System
 * ohne Arbeit und ohne Zustandsänderung außer der Temperatur.
 *
 * @param power Leistung [kW]
 * @param spread Spreizung Vorlauf minus Rücklauf [K]
 * @returns Massenstrom [kg/s]
 */
export function massFlow(power: number, spread: number, fluid: FluidProperties = DEFAULT_FLUID): number {
  if (spread <= 0) return 0;
  return (power * 1000) / (fluid.heatCapacity * spread);
}

/**
 * Volumenstrom [m³/h] aus Leistung und Spreizung.
 *
 * V̇ = Q / (ρ · c_p · Δϑ). Der Nenner ist die volumetrische Wärmekapazität —
 * genau die Größe, die das Glykol verschlechtert. Deshalb reicht es nicht,
 * einen Zuschlag auf den Wasserwert zu rechnen: die Spreizung muss mit den
 * Stoffwerten des tatsächlichen Mediums gerechnet werden.
 *
 * @param power Leistung [kW]
 * @param spread Spreizung [K]
 * @returns Volumenstrom [m³/h]
 */
export function volumeFlow(power: number, spread: number, fluid: FluidProperties = DEFAULT_FLUID): number {
  if (spread <= 0) return 0;
  return (power * 1000 * 3600) / (fluid.volumetricHeatCapacity * spread);
}

/** Umkehrung: welche Leistung transportiert ein Volumenstrom [m³/h] bei der Spreizung [K]? Ergebnis [kW]. */
export function powerFromVolumeFlow(flow: number, spread: number, fluid: FluidProperties = DEFAULT_FLUID): number {
  return (flow * fluid.volumetricHeatCapacity * spread) / (3600 * 1000);
}

/**
 * Der Faktor der Kurzformel [m³·K/(h·kW)].
 *
 * Die im Betrieb benutzte Faustformel lautet
 *
 *     V̇ [m³/h] = Q [kW] · 0,86 / Δϑ [K]
 *
 * und die 0,86 ist nicht gegriffen, sondern eine ausgerechnete Zahl:
 *
 *     V̇ = Q / (ρ · c_p · Δϑ)
 *        = 1 kW · 3600 s/h / (1000 kg/m³ · 4,187 kJ/(kg·K) · 1 K)
 *        = 3600 / 4187 m³/h
 *        = 0,860 m³/h
 *
 * Also: 3600 Sekunden je Stunde geteilt durch die volumetrische
 * Wärmekapazität von Wasser in kJ/(l·K). Die verwandte Zahl 1,163 ist
 * derselbe Zusammenhang andersherum — 1 kWh erwärmt 860 l um 1 K, und
 * 1 l·K entspricht 1,163 Wh.
 *
 * Die Zahlen 1000 kg/m³ und 4,187 kJ/(kg·K) sind die klassische Vereinfachung;
 * sie treffen Wasser bei rund **15 bis 20 °C**, nicht bei Auslegungstemperatur.
 * Mit den Stoffwerten dieses Moduls nachgerechnet ist der exakte Faktor
 * 3600/(ρ·c_p):
 *
 *     20 °C → 0,862   40 °C → 0,868   60 °C → 0,875   80 °C → 0,883
 *
 * Die Faustformel liegt im Heizungsbereich also rund 1 % zu niedrig — das ist
 * gleichgültig. Nicht gleichgültig wird es bei Glykol: 34 Vol-% Ethylenglykol
 * bei 50 °C ergeben 0,979, die Faustformel liegt dort **12 % zu niedrig**. Für
 * die Abschätzung im Kopf reicht sie, für die Auslegung nimmt man `volumeFlow`.
 */
export const SHORT_FORMULA_FACTOR = 0.86;

/**
 * Volumenstrom [m³/h] nach der Kurzformel V̇ = Q · 0,86 / Δϑ.
 *
 * Bewusst als eigene Funktion geführt, damit im Ausdruck nachvollziehbar
 * bleibt, welche Zahl womit entstanden ist. Für Glykolgemische und für
 * Temperaturen außerhalb 30…60 °C ist `volumeFlow` zu verwenden.
 *
 * @param power Leistung [kW]
 * @param spread Spreizung [K]
 */
export function volumeFlowShort(power: number, spread: number): number {
  if (spread <= 0) return 0;
  return (power * SHORT_FORMULA_FACTOR) / spread;
}

// ===========================================================================
// 5 — Druckverlust
// ===========================================================================

/** Grenze zwischen laminarer und beginnend turbulenter Strömung [-]. */
export const REYNOLDS_LAMINAR = 2320;

/** Ab hier gilt die Strömung als voll turbulent [-]. */
export const REYNOLDS_TURBULENT = 4000;

/**
 * Fließgeschwindigkeit [m/s] aus Volumenstrom und Innendurchmesser.
 *
 * w = V̇ / A mit A = π/4 · d_i². Die Umrechnung: m³/h → m³/s durch 3600,
 * mm → m durch 1000.
 *
 * @param flow Volumenstrom [m³/h]
 * @param inner lichter Innendurchmesser [mm]
 */
export function velocityOf(flow: number, inner: number): number {
  const area = (Math.PI / 4) * (inner / 1000) ** 2;
  if (area <= 0) return 0;
  return flow / 3600 / area;
}

/**
 * Reynoldszahl [-].
 *
 * Re = w · d / ν. Das Verhältnis von Trägheits- zu Zähigkeitskräften und die
 * einzige Kennzahl, die entscheidet, welche Reibungsformel gilt.
 *
 * @param velocity Fließgeschwindigkeit [m/s]
 * @param inner Innendurchmesser [mm]
 * @param kinematicViscosity ν [m²/s]
 */
export function reynolds(velocity: number, inner: number, kinematicViscosity: number): number {
  if (kinematicViscosity <= 0) return 0;
  return (velocity * (inner / 1000)) / kinematicViscosity;
}

/**
 * Rohrreibungszahl λ im laminaren Bereich [-].
 *
 * λ = 64/Re, aus dem Hagen-Poiseuille-Gesetz. Exakt, nicht empirisch — und
 * bemerkenswerterweise unabhängig von der Rauheit: bei laminarer Strömung
 * liegt die Wand unter einer Schicht, die von den Erhebungen nichts merkt.
 */
export function lambdaLaminar(re: number): number {
  if (re <= 0) return 0;
  return 64 / re;
}

/**
 * Rohrreibungszahl λ nach Colebrook-White, iterativ gelöst [-].
 *
 *     1/√λ = −2 · log₁₀( 2,51/(Re·√λ) + k/(3,71·d) )
 *
 * Die Gleichung ist implizit, deshalb die Fixpunktiteration. Sie konvergiert
 * monoton und braucht von einem Swamee-Jain-Startwert aus typisch drei bis
 * fünf Schritte auf 1·10⁻¹⁰ genau; die Obergrenze von 40 Schritten ist reine
 * Absicherung gegen absurde Eingaben.
 *
 * @param re Reynoldszahl [-]
 * @param relativeRoughness k/d [-]
 */
export function colebrookWhite(re: number, relativeRoughness: number): number {
  if (re <= 0) return 0;
  // Unterhalb der kritischen Reynoldszahl hat eine Turbulenzkorrelation nichts
  // zu sagen; sie liefert dort Zahlen, die wie ein Ergebnis aussehen (λ > 1).
  // Zurück kommt der laminare Wert, der dort gilt. `frictionFactor` blendet
  // ohnehin erst ab Re = 2320 auf diesen Ast — die Rechenwege bleiben gleich.
  if (re < REYNOLDS_LAMINAR) return lambdaLaminar(re);
  let lambda = swameeJain(re, relativeRoughness);
  for (let i = 0; i < 40; i += 1) {
    const root = Math.sqrt(lambda);
    const next = (-2 * Math.log10(2.51 / (re * root) + relativeRoughness / 3.71)) ** -2;
    if (Math.abs(next - lambda) < 1e-10) return next;
    lambda = next;
  }
  return lambda;
}

/**
 * Rohrreibungszahl λ nach Swamee-Jain, explizit [-].
 *
 *     λ = 0,25 / [ log₁₀( k/(3,7·d) + 5,74/Re^0,9 ) ]²
 *
 * **Fehlerabschätzung, nachgerechnet.** Häufig wird für den Gültigkeitsbereich
 * 5·10³ ≤ Re ≤ 10⁸ und 10⁻⁶ ≤ k/d ≤ 10⁻² „unter 1 %" zitiert. Der Abgleich
 * gegen `colebrookWhite` über dieses Feld ergibt jedoch bis zu **2,9 %**, und
 * zwar in der Ecke Re = 5·10³ bei k/d = 10⁻², also bei rauem Rohr knapp
 * oberhalb des Umschlagbereichs. Im für die Hausinstallation typischen Fenster
 * (Re 5·10³…2·10⁵, glatte Rohre, k/d ≤ 10⁻⁴) bleibt die Abweichung unter
 * 0,5 %. Das ist deutlich
 * kleiner als die Unsicherheit der Rauheit selbst und um Größenordnungen
 * kleiner als die Unsicherheit der Zeta-Werte. Außerhalb des Gültigkeits-
 * bereichs — insbesondere bei Re unter 5000 — wird sie ungenau; dafür ist
 * `frictionFactor` zuständig, das dort auf die laminare Formel umschaltet.
 */
export function swameeJain(re: number, relativeRoughness: number): number {
  if (re <= 0) return 0;
  // Bei Re ≈ 7 wird das Argument des Logarithmus genau 1, der Nenner damit null
  // und λ unendlich; knapp daneben kommen Werte in der Größenordnung 10¹⁰
  // heraus. Das ist keine Ungenauigkeit mehr, sondern Unsinn, und er zöge sich
  // durch die ganze Rechnung. Unterhalb der kritischen Reynoldszahl gilt
  // ohnehin der laminare Ast — der kommt hier zurück. Auf den Umschlagbereich
  // hat das keinen Einfluss: `frictionFactor` wertet den turbulenten Ast dort
  // bei Re = 4000 aus.
  if (re < REYNOLDS_LAMINAR) return lambdaLaminar(re);
  const argument = relativeRoughness / 3.7 + 5.74 / re ** 0.9;
  return 0.25 / Math.log10(argument) ** 2;
}

/**
 * Rohrreibungszahl λ [-] über den gesamten Bereich.
 *
 * Unter Re = 2320 laminar, über Re = 4000 turbulent. Dazwischen liegt der
 * **Umschlagbereich, in dem es keine gültige Formel gibt**: ob die Strömung
 * dort umschlägt, hängt von Störungen, Einlauflänge und Vorgeschichte ab und
 * nicht von einer Kennzahl. Hier wird linear zwischen beiden Ästen geblendet,
 * damit die Funktion stetig bleibt und keine Sprünge in die Dimensionierung
 * trägt. Das Ergebnis ist in diesem Fenster eine Konvention, kein Messwert —
 * der zugehörige Hinweis wird in `pressureLoss` als Warnung ausgegeben.
 *
 * @param method `'colebrook'` (Vorgabe, iterativ) oder `'swamee-jain'` (explizit)
 */
export function frictionFactor(
  re: number,
  relativeRoughness: number,
  method: 'colebrook' | 'swamee-jain' = 'colebrook',
): number {
  if (re <= 0) return 0;
  const turbulent = (r: number): number =>
    method === 'swamee-jain' ? swameeJain(r, relativeRoughness) : colebrookWhite(r, relativeRoughness);
  if (re < REYNOLDS_LAMINAR) return lambdaLaminar(re);
  if (re > REYNOLDS_TURBULENT) return turbulent(re);
  const t = (re - REYNOLDS_LAMINAR) / (REYNOLDS_TURBULENT - REYNOLDS_LAMINAR);
  return (1 - t) * lambdaLaminar(REYNOLDS_LAMINAR) + t * turbulent(REYNOLDS_TURBULENT);
}

/** Zwischenergebnis der Strömungsrechnung für einen Querschnitt. */
export interface FlowState {
  /** Volumenstrom [m³/h]. */
  flow: number;
  /** Fließgeschwindigkeit [m/s]. */
  velocity: number;
  /** Reynoldszahl [-]. */
  reynolds: number;
  /** Rohrreibungszahl λ [-]. */
  lambda: number;
  /** Druckgefälle R [Pa/m]. */
  gradient: number;
  /** Staudruck ρ/2·w² [Pa] — Bezugsgröße der Zeta-Werte. */
  dynamicPressure: number;
}

/**
 * Druckgefälle R [Pa/m] nach Darcy-Weisbach.
 *
 *     R = λ/d · ρ/2 · w²
 *
 * Das Druckgefälle ist die Größe, in der Rohrnetze gedacht werden, weil sie
 * unabhängig von der Länge ist: 100 Pa/m sagt sofort, was ein zusätzlicher
 * Meter kostet. Der Gesamtdruckverlust folgt daraus durch Multiplikation mit
 * der Länge — deshalb ist `pressureLoss` nur eine Zeile mehr.
 *
 * @param flow Volumenstrom [m³/h]
 * @param dimension Rohrdimension aus einer Werkstofftabelle
 */
export function flowState(
  flow: number,
  dimension: PipeDimension,
  fluid: FluidProperties = DEFAULT_FLUID,
  options: { condition?: PipeCondition; method?: 'colebrook' | 'swamee-jain'; roughness?: number } = {},
): FlowState {
  const velocity = velocityOf(flow, dimension.inner);
  const re = reynolds(velocity, dimension.inner, fluid.kinematicViscosity);
  const k = options.roughness ?? pipeRoughness(dimension.material, options.condition ?? 'neu');
  const lambda = frictionFactor(re, k / dimension.inner, options.method ?? 'colebrook');
  const dynamicPressure = (fluid.density / 2) * velocity * velocity;
  const gradient = (lambda / (dimension.inner / 1000)) * dynamicPressure;
  return {
    flow,
    velocity: round(velocity, 4),
    reynolds: round(re, 0),
    lambda: round(lambda, 5),
    gradient: round(gradient, 2),
    dynamicPressure: round(dynamicPressure, 2),
  };
}

// ---------------------------------------------------------------------------
// Einzelwiderstände
// ---------------------------------------------------------------------------

/**
 * Ein Formstück oder eine Armatur mit ihrem Widerstandsbeiwert.
 *
 * Der Beiwert bezieht sich auf den Staudruck im **anschließenden Rohr**:
 * Δp = ζ · ρ/2 · w². Bei Reduzierungen und Abzweigen ist die Bezugsgeschwindigkeit
 * mehrdeutig; hier gilt durchgehend die Geschwindigkeit im Abschnitt, in dem
 * das Formstück gezählt wird.
 */
export interface FittingResistance {
  id: string;
  label: string;
  /** Widerstandsbeiwert ζ [-]. */
  zeta: number;
  /** Symbol im Anlagenschema, falls es eines gibt. */
  schematicKind?: SchematicKind;
  note?: string;
}

/**
 * Widerstandsbeiwerte gängiger Formstücke und Armaturen.
 *
 * **Herkunft und Warnung.** Diese Werte sind die in Rohrnetzberechnungen,
 * Fachliteratur (Recknagel/Sprenger, Wagner „Rohrleitungstechnik") und
 * Herstellerunterlagen durchgängig zitierten Richtwerte. Sie sind **keine
 * Normwerte** und dürfen nicht als solche behandelt werden:
 *
 *  • ζ streut bei Armaturen **um den Faktor drei und mehr** je nach Bauart.
 *    Ein Schrägsitzventil DN 25 kann 2,0 oder 6,0 haben — beides sind reale
 *    Katalogwerte verschiedener Hersteller.
 *  • ζ ist streng genommen von der Reynoldszahl abhängig. Im turbulenten
 *    Bereich ist die Abhängigkeit schwach, im laminaren nicht.
 *  • Bei Bögen hängt ζ am Krümmungsradius. Ein gepresster Winkel 90° ist
 *    doppelt so teuer wie ein weit gebogener.
 *
 * **Sobald der k_vs-Wert der Armatur vorliegt, ist er vorzuziehen.** Er ist
 * eine Messgröße des Herstellers; `zetaFromKvs` rechnet ihn um. Die Tabelle
 * hier ist für die Phase gedacht, in der noch kein Fabrikat feststeht.
 */
export const FITTING_RESISTANCES: FittingResistance[] = [
  { id: 'bogen-90', label: 'Bogen 90°', zeta: 0.5, note: 'Gepresst oder eng gebogen (R ≈ d). Weiter Bogen (R ≥ 2 d): rund 0,3.' },
  { id: 'bogen-45', label: 'Bogen 45°', zeta: 0.3, note: 'Halber Umlenkwinkel, aber nicht der halbe Verlust.' },
  { id: 't-durchgang', label: 'T-Stück, Durchgang', zeta: 0.3, note: 'Strömung läuft geradeaus durch, ein Teil zweigt ab.' },
  { id: 't-abzweig', label: 'T-Stück, Abzweig', zeta: 1.3, note: 'Die abzweigende Teilströmung muss um 90° umgelenkt werden.' },
  { id: 't-vereinigung-durchgang', label: 'T-Stück, Vereinigung Durchgang', zeta: 0.3 },
  { id: 't-vereinigung-abzweig', label: 'T-Stück, Vereinigung Abzweig', zeta: 1.0 },
  { id: 'reduzierung', label: 'Reduzierung (Querschnittsverengung)', zeta: 0.4, note: 'Bezogen auf die kleinere, also schnellere Seite.' },
  { id: 'erweiterung', label: 'Erweiterung (Querschnittserweiterung)', zeta: 0.5, note: 'Bezogen auf die schnellere Seite. Der Stoßverlust nach Borda-Carnot ist die Obergrenze.' },
  { id: 'absperrventil', label: 'Absperrventil (Geradsitz)', zeta: 4.0, schematicKind: 'shutoff', note: 'Zweimalige Umlenkung im Ventilkörper. Streut zwischen 2,5 und 8.' },
  { id: 'schraegsitzventil', label: 'Schrägsitzventil', zeta: 2.5, schematicKind: 'shutoff', note: 'Der schräge Sitz spart gegenüber dem Geradsitz etwa die Hälfte.' },
  { id: 'kugelhahn', label: 'Kugelhahn, voller Durchgang', zeta: 0.3, schematicKind: 'shutoff', note: 'Bei vollem Durchgang praktisch ein Rohrstück. Reduzierte Bohrung: deutlich mehr.' },
  { id: 'rueckflussverhinderer', label: 'Rückflussverhinderer', zeta: 3.0, schematicKind: 'check-valve', note: 'Feder- oder schwerkraftbelastet. Bei kleinen Volumenströmen öffnet er nicht voll, dann steigt ζ stark an.' },
  { id: 'schmutzfaenger', label: 'Schmutzfänger', zeta: 3.0, schematicKind: 'strainer', note: 'Wert für das **saubere** Sieb. Ein zugesetztes Sieb ist der häufigste Grund für eine Anlage, die plötzlich nicht mehr fördert.' },
  { id: 'waermemengenzaehler', label: 'Wärmemengenzähler', zeta: 5.0, schematicKind: 'heat-meter', note: 'Nur Platzhalter. Hersteller geben Δp bei Nenndurchfluss oder k_vs an — diese Angabe ist zu verwenden.' },
  { id: 'schmutzabscheider', label: 'Schlamm- oder Mikroblasenabscheider', zeta: 2.0, schematicKind: 'dirt-separator' },
  { id: 'strangregulierventil', label: 'Strangregulierventil, voll offen', zeta: 3.0, schematicKind: 'balancing-valve', note: 'Voreingestellt ist der Wert bewusst höher — das ist der Zweck der Armatur.' },
  { id: 'waermeuebergabe', label: 'Wärmeübergabestation / Verteilerbalken', zeta: 1.5, schematicKind: 'manifold' },
  // Ergänzt in 1.12.0 aus der Überschlagstabelle win-ing.de („Zeta Werte
  // Heizung, Sanitär, Gas"), die dort ausdrücklich als Überschlagswerte
  // deklariert ist. Sie decken die Bauarten ab, die der Rohrausleger setzt.
  { id: 'dehnungsbogen', label: 'Dehnungsbogen', zeta: 1.0, note: 'Pauschalwert. Der Lyra-Bogen liegt je nach r/d zwischen 0,6 und 1,6.' },
  { id: 'entlueftung', label: 'Entlüfter am Hochpunkt', zeta: 0.1, note: 'Sitzt im Nebenschluss; im Hauptstrom bleibt praktisch nur die Abzweigstelle.' },
  { id: 'festpunkt', label: 'Festpunkt', zeta: 0.0, note: 'Eine Halterung, kein Einbauteil im Strömungsweg.' },
];

const FITTING_BY_ID = new Map(FITTING_RESISTANCES.map((f) => [f.id, f]));

/** Beiwert ζ [-] eines Formstücks über seine Kennung. */
export function fittingZeta(id: string): number | undefined {
  return FITTING_BY_ID.get(id)?.zeta;
}

/**
 * ζ [-] aus dem k_vs-Wert einer Armatur.
 *
 * Der k_vs-Wert ist definiert als der Volumenstrom in m³/h, der bei 1 bar
 * Druckabfall durch die voll geöffnete Armatur fließt:
 *
 *     Δp = (V̇ / k_vs)² · 1 bar
 *
 * Gleichgesetzt mit Δp = ζ · ρ/2 · w² und w = V̇/(3600·A) kürzt sich der
 * Volumenstrom heraus:
 *
 *     ζ = 2 · 10⁵ Pa · (3600·A)² / (ρ · k_vs²)
 *
 * Dass V̇ herausfällt, ist kein Zufall: beide Ansätze sind quadratisch im
 * Volumenstrom. Genau deshalb ist die Umrechnung exakt und nicht genähert.
 *
 * @param kvs k_vs-Wert [m³/h]
 * @param inner Innendurchmesser des Bezugsquerschnitts [mm]
 * @param density Dichte [kg/m³]
 */
export function zetaFromKvs(kvs: number, inner: number, density = DEFAULT_FLUID.density): number {
  if (kvs <= 0) return 0;
  const area = (Math.PI / 4) * (inner / 1000) ** 2;
  return round((2e5 * (3600 * area) ** 2) / (density * kvs * kvs), 3);
}

// ===========================================================================
// 6 — Rohrdimensionierung
// ===========================================================================

/**
 * Vorbelegte Grenzwerte der Dimensionierung.
 *
 * **Keine Normwerte.** Für Heizungsleitungen gibt es keine verbindliche
 * Geschwindigkeits- oder Druckgefällegrenze; was es gibt, sind zwei
 * Randbedingungen, aus denen die Praxis Richtwerte gebildet hat:
 *
 *  • **Geschwindigkeit** begrenzt der Schall. Ab etwa 1 m/s wird Strömung in
 *    Kupfer- und Stahlrohren in ruhigen Räumen hörbar, ab 1,5 m/s auch in
 *    Steigsträngen. Der Wert 1,0 m/s ist der gebräuchliche Kompromiss;
 *    in Kellerverteilungen ohne Schallanspruch sind 1,5 m/s üblich, in
 *    Wohnungsleitungen eher 0,5 m/s.
 *  • **Druckgefälle** begrenzt die Pumpenleistung und damit die Betriebs-
 *    kosten. 100 bis 150 Pa/m ist der klassische Auslegungsbereich; bei
 *    Wärmepumpen mit ihren kleinen Spreizungen und großen Volumenströmen
 *    lohnt es sich, eher auf 100 Pa/m zu gehen.
 *
 * Beide Werte sind Parameter, keine Konstanten — sie gehören zur
 * Planungsentscheidung, nicht zur Physik.
 */
export const DEFAULT_SIZING_LIMITS = {
  /** Höchste Fließgeschwindigkeit [m/s]. */
  maxVelocity: 1.0,
  /** Höchstes Druckgefälle [Pa/m]. */
  maxGradient: 150,
} as const;

export interface SizingOptions {
  /** Werkstoff; wird ignoriert, wenn `table` gesetzt ist. */
  material?: PipeMaterial;
  /** Eigene Dimensionsreihe, z. B. nur die im Lager vorhandenen Größen. */
  table?: readonly PipeDimension[];
  /** Höchste Fließgeschwindigkeit [m/s]. */
  maxVelocity?: number;
  /** Höchstes Druckgefälle [Pa/m]. */
  maxGradient?: number;
  /** Kleinste zulässige Nennweite [mm] — etwa wegen Anschlussmaß am Gerät. */
  minDn?: number;
  /**
   * Größte zulässige Nennweite [mm] — eine Vorgabe aus der Verlegeart, nicht
   * aus der Hydraulik (Ringleitung: höchstens Cu 22). Reißt die größte
   * erlaubte Weite die Grenzen, bleibt es bei ihr, und `warning` sagt es.
   */
  maxDn?: number;
  fluid?: FluidProperties;
  condition?: PipeCondition;
}

/**
 * Kleinste Dimension, die Geschwindigkeit **und** Druckgefälle einhält.
 *
 * Die Reihenfolge ist bewusst „von klein nach groß": eine Dimensionierung
 * soll die billigste zulässige Lösung finden, nicht die sicherste. Welches
 * Kriterium den Ausschlag gegeben hat, steht in `reason` — das ist die
 * Information, die der Planer braucht, wenn er eine Größe von Hand ändern
 * will. Greift die Geschwindigkeit, hilft ein anderer Werkstoff nichts;
 * greift das Druckgefälle, kann eine höhere Spreizung die Sache lösen.
 *
 * `reason`-Werte:
 *  • `'kleinste'` — schon das kleinste Rohr der Reihe hält beide Grenzen ein.
 *    Die Dimensionierung ist damit nicht hydraulisch bestimmt, sondern durch
 *    das Sortiment.
 *  • `'geschwindigkeit'` / `'druckgefälle'` — die nächstkleinere Dimension
 *    hätte diese Grenze gerissen. Bei zwei gerissenen Grenzen gewinnt die mit
 *    der größeren relativen Überschreitung.
 *  • `'größte'` — keine Dimension der Reihe reicht aus. Dann kommt die größte
 *    zurück, zusammen mit einer Warnung; die Lösung ist eine zweite Leitung
 *    oder eine größere Spreizung.
 *
 * @param flow Volumenstrom [m³/h]
 */
export function sizePipe(flow: number, options: SizingOptions = {}): PipeSizing {
  const fluid = options.fluid ?? DEFAULT_FLUID;
  const maxVelocity = options.maxVelocity ?? DEFAULT_SIZING_LIMITS.maxVelocity;
  const maxGradient = options.maxGradient ?? DEFAULT_SIZING_LIMITS.maxGradient;
  const source = options.table ?? PIPE_TABLES[options.material ?? 'kupfer'];
  const table = [...source]
    .filter((d) => (options.minDn === undefined ? true : d.dn >= options.minDn))
    .filter((d) => (options.maxDn === undefined ? true : d.dn <= options.maxDn))
    .sort((a, b) => a.inner - b.inner);

  if (table.length === 0) {
    // Kann nur passieren, wenn `minDn` die ganze Reihe wegfiltert.
    const fallback = [...source].sort((a, b) => b.inner - a.inner)[0];
    const state = flowState(flow, fallback, fluid, { condition: options.condition });
    return {
      dimension: fallback,
      flow: round(flow, 4),
      velocity: state.velocity,
      gradient: state.gradient,
      reynolds: state.reynolds,
      lambda: state.lambda,
      reason: 'größte',
      warning: `Die geforderte Mindestnennweite DN ${de(options.minDn ?? 0)} kommt in der Reihe nicht vor.`,
    };
  }

  const states = table.map((d) => ({ dimension: d, state: flowState(flow, d, fluid, { condition: options.condition }) }));
  const index = states.findIndex((s) => s.state.velocity <= maxVelocity && s.state.gradient <= maxGradient);

  if (index < 0) {
    const worst = states[states.length - 1];
    return {
      dimension: worst.dimension,
      flow: round(flow, 4),
      velocity: worst.state.velocity,
      gradient: worst.state.gradient,
      reynolds: worst.state.reynolds,
      lambda: worst.state.lambda,
      reason: 'größte',
      warning:
        `Auch ${worst.dimension.label} reißt die Grenzen (${de(round(worst.state.velocity, 2))} m/s gegenüber ` +
        `${de(maxVelocity)} m/s, ${Math.round(worst.state.gradient)} Pa/m gegenüber ${de(maxGradient)} Pa/m). ` +
        'Zwei parallele Leitungen legen oder die Spreizung erhöhen.',
    };
  }

  const chosen = states[index];
  let reason: PipeSizing['reason'] = 'kleinste';
  if (index > 0) {
    const previous = states[index - 1].state;
    const velocityExcess = previous.velocity / maxVelocity;
    const gradientExcess = previous.gradient / maxGradient;
    reason = velocityExcess >= gradientExcess ? 'geschwindigkeit' : 'druckgefälle';
  }

  return {
    dimension: chosen.dimension,
    flow: round(flow, 4),
    velocity: chosen.state.velocity,
    gradient: chosen.state.gradient,
    reynolds: chosen.state.reynolds,
    lambda: chosen.state.lambda,
    reason,
  };
}

/** Erklärungstext zu einer Dimensionierung — für Ausdruck und Oberfläche. */
export function explainSizing(sizing: PipeSizing, limits: { maxVelocity?: number; maxGradient?: number } = {}): string {
  const v = limits.maxVelocity ?? DEFAULT_SIZING_LIMITS.maxVelocity;
  const r = limits.maxGradient ?? DEFAULT_SIZING_LIMITS.maxGradient;
  const head = `${sizing.dimension.label}: ${de(round(sizing.velocity, 2))} m/s, ${Math.round(sizing.gradient)} Pa/m`;
  switch (sizing.reason) {
    case 'geschwindigkeit':
      return `${head}. Maßgebend war die Höchstgeschwindigkeit von ${de(v)} m/s — die nächstkleinere Dimension wäre zu laut.`;
    case 'druckgefälle':
      return `${head}. Maßgebend war das Höchstdruckgefälle von ${de(r)} Pa/m — die nächstkleinere Dimension würde die Pumpe kosten.`;
    case 'kleinste':
      return `${head}. Schon die kleinste Dimension der Reihe hält beide Grenzen ein; die Wahl folgt dem Sortiment, nicht der Hydraulik.`;
    default:
      return `${head}. ${sizing.warning ?? 'Keine Dimension der Reihe reicht aus.'}`;
  }
}

// ===========================================================================
// 7 — Druckverlust eines Abschnitts, ungünstigster Strang, Pumpe
// ===========================================================================

/** Ein Formstück mit Anzahl, so wie es im Auszug steht. */
export interface FittingCount {
  /** Kennung aus `FITTING_RESISTANCES` oder eigener Bezeichner. */
  id: string;
  count: number;
  /** Eigener Beiwert ζ [-]; überschreibt die Tabelle. Für k_vs-Angaben `zetaFromKvs` verwenden. */
  zeta?: number;
}

/** Ein Rohrabschnitt konstanter Nennweite und konstanten Volumenstroms. */
export interface PipeSegmentLoad {
  label?: string;
  /** Volumenstrom [m³/h]. */
  flow: number;
  /**
   * Länge [m]. **Vor- und Rücklauf zählen beide.** Wer nur die Trassenlänge
   * kennt, gibt die doppelte Länge an oder setzt `bothWays`.
   */
  length: number;
  /** Vor- und Rücklauf gemeinsam abrechnen: `length` wird verdoppelt. */
  bothWays?: boolean;
  dimension: PipeDimension;
  /** Formstücke im Abschnitt. */
  fittings?: FittingCount[];
  /** Zusätzliche Summe ζ [-], falls sie pauschal bekannt ist. */
  zetaSum?: number;
  /** Fester Zusatzverlust [Pa], etwa ein Wärmetauscher mit Herstellerkennlinie. */
  fixedLoss?: number;
  condition?: PipeCondition;
}

/** Ergebnis für einen Abschnitt. Drücke in Pa, zusätzlich in mbar. */
export interface PipeSegmentResult {
  label: string;
  /** Volumenstrom [m³/h]. */
  flow: number;
  /** Abgerechnete Länge [m]. */
  length: number;
  dimension: PipeDimension;
  /** Fließgeschwindigkeit [m/s]. */
  velocity: number;
  /** Reynoldszahl [-]. */
  reynolds: number;
  /** Rohrreibungszahl λ [-]. */
  lambda: number;
  /** Druckgefälle R [Pa/m]. */
  gradient: number;
  /** Summe der Widerstandsbeiwerte [-]. */
  zetaSum: number;
  /** Reibungsanteil R·l [Pa]. */
  pipeLoss: number;
  /** Einzelwiderstände Σζ·ρ/2·w² [Pa]. */
  fittingLoss: number;
  /** Fester Zusatzverlust [Pa]. */
  fixedLoss: number;
  /** Gesamtverlust [Pa]. */
  loss: number;
  /** Gesamtverlust [mbar] — die Einheit, in der Pumpenkennlinien gelesen werden. */
  lossMbar: number;
  warnings: string[];
}

/**
 * Druckverlust eines Abschnitts einschließlich Einzelwiderständen.
 *
 *     Δp = R · l + Σζ · ρ/2 · w²
 *
 * Der erste Term ist die Rohrreibung, der zweite sind Formstücke und
 * Armaturen. Beide beziehen sich auf denselben Staudruck; deshalb ist der
 * Vergleich der beiden Zahlen im Ergebnis aussagekräftig. Überwiegt der
 * Einzelwiderstand deutlich, ist die Leitung zu kurz oder zu groß gewählt —
 * dann bringt eine Dimension weniger nichts.
 */
export function pressureLoss(segment: PipeSegmentLoad, fluid: FluidProperties = DEFAULT_FLUID): PipeSegmentResult {
  const length = segment.bothWays ? segment.length * 2 : segment.length;
  const state = flowState(segment.flow, segment.dimension, fluid, { condition: segment.condition });
  const warnings: string[] = [];

  let zetaSum = segment.zetaSum ?? 0;
  for (const fitting of segment.fittings ?? []) {
    const zeta = fitting.zeta ?? fittingZeta(fitting.id);
    if (zeta === undefined) {
      warnings.push(`Unbekanntes Formstück „${fitting.id}“ — mit ζ = 0 gerechnet.`);
      continue;
    }
    zetaSum += zeta * fitting.count;
  }

  const pipeLoss = state.gradient * length;
  const fittingLoss = zetaSum * state.dynamicPressure;
  const fixedLoss = segment.fixedLoss ?? 0;
  const loss = pipeLoss + fittingLoss + fixedLoss;

  if (state.reynolds >= REYNOLDS_LAMINAR && state.reynolds < REYNOLDS_TURBULENT) {
    warnings.push(
      `Re = ${Math.round(state.reynolds)} liegt im Umschlagbereich. Dort gibt es keine gültige Reibungsformel; ` +
        'das Ergebnis ist eine Interpolation und kann in beide Richtungen um ein Drittel danebenliegen.',
    );
  }
  if (state.reynolds > 0 && state.reynolds < REYNOLDS_LAMINAR) {
    warnings.push(
      `Re = ${Math.round(state.reynolds)}: laminare Strömung. Der Wärmeübergang bricht dabei ein — ` +
        'bei Heizflächen und Wärmetauschern ist das ein Auslegungsfehler, in reinen Transportleitungen nicht.',
    );
  }
  if (fittingLoss > pipeLoss * 3 && pipeLoss > 0) {
    warnings.push('Die Einzelwiderstände übersteigen die Rohrreibung um mehr als das Dreifache — der Abschnitt wird von Armaturen bestimmt.');
  }

  return {
    label: segment.label ?? segment.dimension.label,
    flow: round(segment.flow, 4),
    length: round(length, 3),
    dimension: segment.dimension,
    velocity: state.velocity,
    reynolds: state.reynolds,
    lambda: state.lambda,
    gradient: state.gradient,
    zetaSum: round(zetaSum, 3),
    pipeLoss: round(pipeLoss, 1),
    fittingLoss: round(fittingLoss, 1),
    fixedLoss: round(fixedLoss, 1),
    loss: round(loss, 1),
    lossMbar: round(loss / 100, 2),
    warnings,
  };
}

/** Ein Strang: die Kette von Abschnitten von der Pumpe bis zum Verbraucher. */
export interface PipePathLoad {
  id: string;
  label: string;
  segments: PipeSegmentLoad[];
  /**
   * Verlust des Verbrauchers am Ende [Pa] — Heizkörperventil, Fußbodenkreis,
   * Wärmetauscher. Er gehört zum Strang, ist aber kein Rohr, deshalb getrennt.
   */
  terminalLoss?: number;
  /** Bezeichnung des Verbrauchers, für die Begründung im Ergebnis. */
  terminalLabel?: string;
}

/** Bewertung eines einzelnen Strangs. */
export interface PathResult {
  id: string;
  label: string;
  segments: PipeSegmentResult[];
  /** Summe der abgerechneten Längen [m]. */
  length: number;
  /** Verlust der Rohrstrecke einschließlich Armaturen [Pa]. */
  pipeLoss: number;
  /** Verlust des Verbrauchers [Pa]. */
  terminalLoss: number;
  /** Gesamtverlust des Strangs [Pa]. */
  loss: number;
  /** Gesamtverlust [mbar]. */
  lossMbar: number;
  /** Mittleres Druckgefälle über die Strecke [Pa/m] — Kennzahl für die Güte der Dimensionierung. */
  averageGradient: number;
  warnings: string[];
}

/** Einen Strang durchrechnen. */
export function evaluatePath(path: PipePathLoad, fluid: FluidProperties = DEFAULT_FLUID): PathResult {
  const segments = path.segments.map((s) => pressureLoss(s, fluid));
  const length = segments.reduce((sum, s) => sum + s.length, 0);
  const pipeLoss = segments.reduce((sum, s) => sum + s.loss, 0);
  const terminalLoss = path.terminalLoss ?? 0;
  const loss = pipeLoss + terminalLoss;
  return {
    id: path.id,
    label: path.label,
    segments,
    length: round(length, 2),
    pipeLoss: round(pipeLoss, 1),
    terminalLoss: round(terminalLoss, 1),
    loss: round(loss, 1),
    lossMbar: round(loss / 100, 2),
    averageGradient: length > 0 ? round(pipeLoss / length, 1) : 0,
    warnings: segments.flatMap((s) => s.warnings),
  };
}

/**
 * Auslegung der Umwälzpumpe.
 *
 * Alle Drücke in Pa, zusätzlich in mbar und kPa; Förderhöhen in m;
 * Leistungen hydraulisch in W, elektrisch in W.
 */
export interface PumpDesign {
  /** Förderstrom [m³/h]. */
  flow: number;
  /** Erforderliche Förderhöhe [m]. */
  head: number;
  /** Erforderliche Druckdifferenz [Pa]. */
  pressure: number;
  /** Dieselbe Druckdifferenz [mbar]. */
  pressureMbar: number;
  /** Dieselbe Druckdifferenz [kPa]. */
  pressureKpa: number;
  /** Angesetzter Sicherheitszuschlag [-], 1,0 = kein Zuschlag. */
  safetyFactor: number;
  /** Verlust des ungünstigsten Strangs vor dem Zuschlag [Pa]. */
  worstPathLoss: number;
  /** Der ungünstigste Strang mit allen Abschnitten. */
  worstPath?: PathResult;
  /** Alle Stränge, absteigend nach Verlust — die Liste für den hydraulischen Abgleich. */
  ranking: { id: string; label: string; loss: number; lossMbar: number; length: number }[];
  /** Differenz zum zweitschlechtesten Strang [Pa] — so viel muss dort abgedrosselt werden. */
  balancingSpread: number;
  /** Verlust im Erzeuger, Speicher und in der Kesselgruppe [Pa]. */
  generatorLoss: number;
  /** Verfügbare Förderhöhe der eingebauten Pumpe [m], falls bekannt. */
  availableHead?: number;
  /** Restförderhöhe [m]: verfügbar minus erforderlich. Negativ heißt: Pumpe zu klein. */
  residualHead?: number;
  sufficient?: boolean;
  /** Hydraulische Leistung [W]. */
  hydraulicPower: number;
  /** Angesetzter Gesamtwirkungsgrad der Pumpe [-]. */
  efficiency: number;
  /** Elektrische Leistungsaufnahme [W]. */
  electricPower: number;
  notes: { severity: 'info' | 'warn' | 'error'; text: string }[];
}

/**
 * Wirkungsgrad einer Nassläufer-Umwälzpumpe im Auslegungspunkt [-].
 *
 * Eine Nassläuferpumpe ist ein schlechter Motor mit einem mäßigen Laufrad:
 * das Spaltrohr sitzt im Luftspalt, das Fördermedium schmiert und bremst den
 * Rotor. Der Gesamtwirkungsgrad — Strom hinein, hydraulische Leistung
 * heraus — liegt bei Heizungspumpen der Baugröße bis 1 m³/h bei 10 bis 20 %,
 * bei größeren Hocheffizienzpumpen bei 25 bis 40 %.
 *
 * Der Vorgabewert 0,22 ist ein Erfahrungswert für eine
 * Einfamilienhaus-Hocheffizienzpumpe im Auslegungspunkt. Er ist **keine
 * Herstellerangabe** und dient nur der Größenordnung des Stromverbrauchs.
 * Der Energieeffizienzindex EEI nach VO (EG) Nr. 641/2009 in der Fassung der
 * VO (EU) Nr. 622/2012 sagt etwas anderes aus — er ist ein Vergleichswert über
 * ein Lastprofil, kein Wirkungsgrad — und ist mit dieser Zahl nicht zu
 * verwechseln.
 */
export const DEFAULT_PUMP_EFFICIENCY = 0.22;

/**
 * Kleinste sinnvolle elektrische Aufnahme einer Nassläuferpumpe [W].
 *
 * Unterhalb weniger Watt dominieren Elektronik- und Lagerverluste; die
 * Rechnung P_el = P_hyd/η liefert dort Zahlen, die kein Gerät unterbietet.
 * Moderne Hocheffizienzpumpen liegen im kleinsten Betriebspunkt bei 3 bis 5 W.
 */
export const MIN_PUMP_ELECTRIC_POWER = 3;

export interface PumpOptions {
  /** Förderstrom [m³/h]; Vorgabe: die **Summe** der Strangvolumenströme. */
  flow?: number;
  /** Sicherheitszuschlag auf den Druckverlust [-]. Vorgabe 1,15. */
  safetyFactor?: number;
  /** Verlust in Erzeuger, Speicher, Weiche, Kesselgruppe [Pa]. */
  generatorLoss?: number;
  /** Verfügbare Förderhöhe der vorhandenen oder eingebauten Pumpe [m]. */
  availableHead?: number;
  /** Gesamtwirkungsgrad [-]. */
  efficiency?: number;
}

/**
 * Ungünstigster Strang, Förderhöhe, Pumpenauslegung.
 *
 * **Warum der ungünstigste Strang und nicht die Summe.** Alle Stränge liegen
 * parallel zwischen denselben zwei Punkten. Über parallelen Zweigen liegt
 * dieselbe Druckdifferenz — die Pumpe muss also genau den einen Strang
 * bedienen können, der am meisten verlangt. Alle übrigen bekommen zu viel
 * und werden abgedrosselt; genau das ist der hydraulische Abgleich, und
 * `balancingSpread` sagt, wie viel dabei zu vernichten ist.
 *
 * Der Sicherheitszuschlag von 15 % deckt ab, was die Rechnung nicht kennt:
 * Zeta-Streuung, nicht gezeichnete Formstücke, Alterung. Er ist ein
 * Erfahrungswert und als Parameter geführt. Größere Zuschläge sind keine
 * Sicherheit, sondern eine zu große Pumpe — und die kostet dauerhaft Strom
 * und macht Strömungsgeräusche.
 *
 * Umrechnung Druck in Förderhöhe: H = Δp / (ρ·g). Die Förderhöhe ist also
 * mediumabhängig — dieselbe Pumpe schafft in Sole weniger Meter als in
 * Wasser, weil das Medium schwerer ist.
 */
export function designPump(
  paths: readonly PipePathLoad[],
  fluid: FluidProperties = DEFAULT_FLUID,
  options: PumpOptions = {},
): PumpDesign {
  const safetyFactor = options.safetyFactor ?? 1.15;
  const generatorLoss = options.generatorLoss ?? 0;
  const efficiency = clamp(options.efficiency ?? DEFAULT_PUMP_EFFICIENCY, 0.02, 0.9);
  const notes: PumpDesign['notes'] = [];

  const results = paths.map((p) => evaluatePath(p, fluid)).sort((a, b) => b.loss - a.loss);
  const worst = results[0];
  const worstPathLoss = worst ? worst.loss : 0;

  /*
   * Förderstrom: die **Summe** über alle Stränge.
   *
   * Das ist die andere Hälfte der Parallelschaltung und darf nicht mit der
   * Förderhöhe verwechselt werden. Über parallelen Zweigen liegt dieselbe
   * Druckdifferenz — deshalb bestimmt der *ungünstigste* Strang die Höhe.
   * Durch die Pumpe fließt dagegen alles, was in die Zweige abzweigt,
   * also die Summe. Bis 1.8.1 stand hier das Maximum: bei zwei gleich
   * großen Kreisen war die Pumpe damit um die Hälfte zu klein, und der
   * Fehler wächst mit jedem weiteren Kreis.
   */
  const flow = options.flow ?? paths.reduce((sum, p) => sum + (p.segments[0]?.flow ?? 0), 0);

  const pressure = (worstPathLoss + generatorLoss) * safetyFactor;
  const head = pressure / (fluid.density * GRAVITY);
  const hydraulicPower = (pressure * flow) / 3600;
  const electricPower = Math.max(MIN_PUMP_ELECTRIC_POWER, hydraulicPower / efficiency);

  if (!worst) {
    notes.push({ severity: 'error', text: 'Kein Strang übergeben — es gibt nichts auszulegen.' });
  }
  if (flow <= 0) {
    notes.push({ severity: 'error', text: 'Förderstrom null. Ohne Volumenstrom lässt sich keine Pumpe wählen.' });
  }
  const second = results[1];
  const balancingSpread = worst && second ? worst.loss - second.loss : 0;
  // Für die Frage, wie weit die Stränge auseinanderliegen, zählt der
  // **günstigste** Strang — das ist der letzte der absteigend sortierten Liste,
  // nicht der zweitschlechteste.
  const cheapest = results.length > 1 ? results[results.length - 1] : undefined;
  if (worst && cheapest && cheapest.loss < worst.loss * 0.35) {
    notes.push({
      severity: 'warn',
      text:
        `Der günstigste Strang („${cheapest.label}“, ${Math.round(cheapest.loss / 100)} mbar) und der ungünstigste ` +
        `(„${worst.label}“, ${Math.round(worst.loss / 100)} mbar) liegen weit auseinander. Ohne Abgleich läuft das ` +
        `Wasser fast vollständig über die kurzen Wege; abzudrosseln sind dort ${Math.round((worst.loss - cheapest.loss) / 100)} mbar.`,
    });
  }
  if (head > 6) {
    notes.push({
      severity: 'warn',
      text: `Erforderliche Förderhöhe ${de(round(head, 1))} m. Das ist für ein Einfamilienhaus viel — Dimensionen und Armaturen prüfen, bevor eine größere Pumpe gewählt wird.`,
    });
  }

  let residualHead: number | undefined;
  let sufficient: boolean | undefined;
  if (options.availableHead !== undefined) {
    residualHead = round(options.availableHead - head, 3);
    sufficient = residualHead >= 0;
    notes.push({
      severity: sufficient ? 'info' : 'error',
      text: sufficient
        ? `Restförderhöhe ${de(round(residualHead, 2))} m bei ${de(round(flow, 2))} m³/h — die vorhandene Pumpe reicht.`
        : `Die vorhandene Pumpe fehlt ${de(round(-residualHead, 2))} m Förderhöhe. Der ungünstigste Strang wird nicht versorgt.`,
    });
  }

  const worstWarnings = worst ? worst.warnings : [];
  for (const text of worstWarnings) notes.push({ severity: 'warn', text });

  return {
    flow: round(flow, 3),
    head: round(head, 3),
    pressure: round(pressure, 0),
    pressureMbar: round(pressure / 100, 1),
    pressureKpa: round(pressure / 1000, 2),
    safetyFactor,
    worstPathLoss: round(worstPathLoss, 1),
    worstPath: worst,
    ranking: results.map((r) => ({ id: r.id, label: r.label, loss: r.loss, lossMbar: r.lossMbar, length: r.length })),
    balancingSpread: round(balancingSpread, 1),
    generatorLoss: round(generatorLoss, 1),
    availableHead: options.availableHead,
    residualHead,
    sufficient,
    hydraulicPower: round(hydraulicPower, 2),
    efficiency,
    electricPower: round(electricPower, 1),
    notes,
  };
}

// ===========================================================================
// 8 — Fußbodenheizung
// ===========================================================================

/**
 * Grundcharakteristik der Fußbodenheizung.
 *
 * q = 8,92 · (ϑ_F,m − ϑ_i)^1,1  [W/m²]
 *
 * Der Zusammenhang zwischen mittlerer Oberflächentemperatur und Wärmestrom
 * nach oben. Er beschreibt den kombinierten Wärmeübergang durch Strahlung und
 * freie Konvektion einer waagerechten, nach oben gerichteten warmen Fläche und
 * ist in der Fachliteratur und in Herstellerunterlagen frei zitiert. Er ist
 * **nicht** das Kennlinienfeld der Auslegung — er sagt nur, was eine Fläche
 * bei gegebener Oberflächentemperatur abgibt, nicht welche Oberflächen-
 * temperatur sich bei gegebenem Rohrabstand einstellt.
 */
export function surfaceHeatFlux(surfaceTemperature: number, roomTemperature: number): number {
  const delta = surfaceTemperature - roomTemperature;
  if (delta <= 0) return 0;
  return 8.92 * delta ** 1.1;
}

/** Umkehrung: mittlere Oberflächentemperatur [°C] bei gegebener Wärmestromdichte [W/m²]. */
export function surfaceTemperatureFor(heatFlux: number, roomTemperature: number): number {
  if (heatFlux <= 0) return roomTemperature;
  return roomTemperature + (heatFlux / 8.92) ** (1 / 1.1);
}

/**
 * Höchste zulässige mittlere Oberflächentemperatur [°C].
 *
 * Die Werte 29 °C im Aufenthaltsbereich, 33 °C in Bädern und 35 °C in der
 * Randzone stammen aus DIN EN 1264-2 und sind in der Fachliteratur, in
 * Herstellerunterlagen und in Schulungsmaterial durchgängig frei zitiert.
 * Sie sind physiologisch begründet — oberhalb wird der Boden barfuß
 * unangenehm und die Fußdurchblutung leidet. Sie sind hier trotzdem nur die
 * **Vorbelegung**: `FloorHeatingOptions.maxSurfaceTemperature` überschreibt sie,
 * damit die Zahl aus der Norm nicht als Konstante zementiert ist. Alles Weitere
 * aus DIN EN 1264 (Kennlinienfeld, Kennwert K_H) steht bewusst **nicht** in
 * diesem Modul.
 *
 * Gegenprobe zur Grundcharakteristik: 29 °C bei 20 °C Raumtemperatur ergeben
 * 8,92 · 9^1,1 = 100 W/m², 35 °C in der Randzone 8,92 · 15^1,1 = 175 W/m² —
 * genau die beiden Zahlen, die in der Fachliteratur als Grenzwärmestromdichte
 * zitiert werden. Die Konstanten passen also zusammen.
 */
export const MAX_SURFACE_TEMPERATURE = {
  /** Aufenthaltsbereich [°C]. */
  aufenthalt: 29,
  /** Bad und Duschbereich [°C]. */
  bad: 33,
  /** Randzone, höchstens 1 m breit [°C]. */
  randzone: 35,
} as const;

export type FloorZone = keyof typeof MAX_SURFACE_TEMPERATURE;

/**
 * Übertemperatur des Heizmittels Δϑ_H [K], logarithmisch gemittelt.
 *
 *     Δϑ_H = (ϑ_V − ϑ_R) / ln[(ϑ_V − ϑ_i)/(ϑ_R − ϑ_i)]
 *
 * Die logarithmische Mittelung folgt daraus, dass die Wassertemperatur längs
 * des Kreises exponentiell abfällt — das arithmetische Mittel überschätzt die
 * Leistung. Bei kleinen Spreizungen sind beide fast gleich, deshalb der
 * Grenzübergang für Δϑ → 0.
 */
export function logMeanOverTemperature(flowTemperature: number, returnTemperature: number, roomTemperature: number): number {
  const a = flowTemperature - roomTemperature;
  const b = returnTemperature - roomTemperature;
  if (a <= 0 || b <= 0) return 0;
  if (Math.abs(a - b) < 1e-6) return a;
  return (a - b) / Math.log(a / b);
}

/**
 * Vorbelegte spezifische Wärmestromdichte einer Fußbodenheizung [W/m²].
 *
 * **Herkunft: keine Norm, sondern eine Planungsannahme.** Das Kennlinienfeld
 * nach DIN EN 1264-2, aus dem sich q aus Rohrabstand, Estrichüberdeckung,
 * Bodenbelag und Δϑ_H ergibt, ist Bestandteil einer kostenpflichtigen Norm und
 * wird hier nicht nachgebaut oder geschätzt. 60 W/m² entspricht dem, was eine
 * Fußbodenheizung in einem Neubau nach heutigem Dämmstandard bei üblichem
 * Rohrabstand und 35/28 °C abgibt. Der Wert ist als Größenordnung brauchbar
 * und als Auslegungsgrundlage nicht.
 *
 * **Was stattdessen zu tun ist:** Entweder den Kennwert K_H aus der
 * Systemzulassung des gewählten Fabrikats einsetzen (`kh`, dann rechnet das
 * Modul q = K_H · Δϑ_H, was die Norm selbst so vorsieht), oder die
 * Wärmestromdichte aus der Raumheizlast und der belegbaren Fläche vorgeben
 * (`load`). Beide Wege sind belastbar; die Vorbelegung ist es nicht.
 */
export const DEFAULT_FLOOR_HEAT_FLUX = 60;

/**
 * Vorbelegte größte Heizkreislänge [m].
 *
 * Auch das ist **keine Norm**, sondern eine Folge des Druckverlusts. Mit
 * diesem Modul nachgerechnet, 16 × 2 Verbundrohr, 15 cm Verlegeabstand,
 * 60 W/m², Kreislänge 106 m einschließlich Anbindung:
 *
 *     Spreizung 5 K → 156 l/h → 298 mbar
 *     Spreizung 7 K → 111 l/h →  168 mbar
 *     Spreizung 10 K →  78 l/h →   66 mbar
 *
 * Die Länge allein sagt also wenig — bei kleiner Spreizung reißt schon ein
 * 100-m-Kreis die üblichen 250 mbar, bei großer Spreizung wäre deutlich mehr
 * möglich. Der Wert wird deshalb im Ergebnis **nachgerechnet** und nicht bloß
 * eingehalten: maßgebend ist `maxLoopPressure`, nicht die Länge.
 */
export const DEFAULT_MAX_LOOP_LENGTH = 100;

/** Vorbelegter Höchstdruckverlust je Heizkreis [Pa] = 250 mbar. Erfahrungswert, keine Norm. */
export const DEFAULT_MAX_LOOP_PRESSURE = 25000;

export interface FloorHeatingOptions {
  /** Verlegeabstand [m]. Vorgabe 0,15 m. */
  spacing?: number;
  /** Wärmestromdichte [W/m²]; Vorgabe siehe `DEFAULT_FLOOR_HEAT_FLUX`. */
  specificOutput?: number;
  /**
   * Kennwert K_H [W/(m²·K)] aus der Systemzulassung nach DIN EN 1264.
   * Wenn gesetzt, gilt q = K_H · Δϑ_H und `specificOutput` wird ignoriert.
   */
  kh?: number;
  /** Heizlast des Raums [W]; wenn gesetzt, bestimmt sie q = Last/Fläche. */
  load?: number;
  /** Auslegungstemperaturen [°C]. */
  flowTemperature?: number;
  returnTemperature?: number;
  roomTemperature?: number;
  /** Nutzungsart für die Oberflächentemperaturgrenze. */
  zone?: FloorZone;
  /**
   * Höchste mittlere Oberflächentemperatur [°C]; überschreibt die Vorbelegung
   * aus `MAX_SURFACE_TEMPERATURE`. Gedacht für abweichende Nutzungen und für
   * den Fall, dass der Anwender die Grenze aus der Norm selbst kennt und
   * setzen will, statt sich auf die frei zitierte Zahl zu verlassen.
   */
  maxSurfaceTemperature?: number;
  /** Größte Kreislänge [m]. */
  maxLoopLength?: number;
  /** Höchstdruckverlust je Kreis [Pa]. */
  maxLoopPressure?: number;
  /** Anbindeleitung je Kreis zum Verteiler, hin und zurück [m]. */
  leadLength?: number;
  /** Rohr des Heizkreises. Vorgabe: Mehrschichtverbund 16 × 2. */
  dimension?: PipeDimension;
  /**
   * Zuschlag auf die Rohrreibung für die Bögen der Verlegeschlange [-].
   * Vorgabe 1,3. Erfahrungswert: ein Schneckenkreis besteht fast nur aus
   * Bögen, die als Einzelwiderstände zu zählen unpraktikabel wäre.
   */
  bendSurcharge?: number;
  fluid?: FluidProperties;
}

/** Ergebnis der Fußbodenheizungsauslegung eines Raums. */
export interface FloorHeatingDesign {
  /** Belegbare Fläche [m²]. */
  area: number;
  /** Verlegeabstand [m]. */
  spacing: number;
  /** Rohrbedarf je Quadratmeter [m/m²] = 1/Abstand. */
  pipePerSquareMetre: number;
  /** Rohr in der Fläche [m], ohne Anbindeleitungen. */
  fieldLength: number;
  /** Anzahl Heizkreise [-]. */
  loops: number;
  /** Länge eines Kreises einschließlich Anbindung [m]. */
  loopLength: number;
  /** Gesamte Rohrlänge einschließlich Anbindungen [m]. */
  totalLength: number;
  /** Wasserinhalt aller Kreise [l]. */
  waterContent: number;
  /** Angesetzte Wärmestromdichte [W/m²]. */
  specificOutput: number;
  /** Woher sie stammt. */
  specificOutputSource: 'heizlast' | 'kennwert' | 'vorbelegung' | 'parameter';
  /** Wärmeabgabe der Fläche [W]. */
  output: number;
  /** Übertemperatur des Heizmittels Δϑ_H [K]. */
  logMeanOverTemperature: number;
  /** Rechnerische mittlere Oberflächentemperatur [°C]. */
  surfaceTemperature: number;
  /** Grenze der Oberflächentemperatur [°C] und daraus die größte Wärmestromdichte [W/m²]. */
  maxSurfaceTemperature: number;
  maxSpecificOutput: number;
  /** Spreizung [K]. */
  spread: number;
  /** Volumenstrom aller Kreise [m³/h]. */
  totalFlow: number;
  /** Volumenstrom je Kreis [l/h] — die Einheit, in der Durchflussmesser am Verteiler beschriftet sind. */
  flowPerLoop: number;
  /** Fließgeschwindigkeit im Kreis [m/s]. */
  velocity: number;
  /** Druckverlust des ungünstigsten Kreises [Pa] und [mbar]. */
  loopPressure: number;
  loopPressureMbar: number;
  dimension: PipeDimension;
  notes: { severity: 'info' | 'warn' | 'error'; text: string }[];
}

/**
 * Auslegung der Fußbodenheizung eines Raums.
 *
 * **Rechenweg, offen gelegt.**
 *  1. Rohrbedarf: l' = 1/Verlegeabstand [m/m²]. Das ist Geometrie, keine
 *     Annahme — eine Schlange mit 15 cm Abstand braucht 6,67 m je m².
 *  2. Wärmestromdichte q: aus der Heizlast, falls übergeben; sonst aus dem
 *     Kennwert K_H der Systemzulassung; sonst aus der Vorbelegung. Welcher
 *     Weg gegriffen hat, steht in `specificOutputSource` — das ist die
 *     wichtigste Information des ganzen Ergebnisses.
 *  3. Prüfung gegen die Oberflächentemperaturgrenze über die
 *     Grundcharakteristik. Reißt die Fläche die Grenze, hilft kein engerer
 *     Rohrabstand — dann fehlt Fläche oder es fehlt Dämmung.
 *  4. Kreisanzahl aus Feldlänge und größter Kreislänge, aufgerundet.
 *  5. Volumenstrom aus Leistung und Spreizung, aufgeteilt auf die Kreise.
 *  6. Druckverlust des Kreises über Darcy-Weisbach mit Bogenzuschlag.
 *
 * @param area belegbare Fläche [m²] — nicht die Grundfläche des Raums,
 *   sondern das, was nach Abzug von Einbauten und Randstreifen bleibt
 */
export function designFloorHeating(area: number, options: FloorHeatingOptions = {}): FloorHeatingDesign {
  const spacing = options.spacing ?? 0.15;
  const flowTemperature = options.flowTemperature ?? 35;
  const returnTemperature = options.returnTemperature ?? 28;
  const roomTemperature = options.roomTemperature ?? 20;
  const zone = options.zone ?? 'aufenthalt';
  const dimension = options.dimension ?? findDimension('verbund', '16 × 2') ?? MULTILAYER_PIPES[0];
  const leadLength = options.leadLength ?? 6;
  const maxLoopLength = options.maxLoopLength ?? DEFAULT_MAX_LOOP_LENGTH;
  const maxLoopPressure = options.maxLoopPressure ?? DEFAULT_MAX_LOOP_PRESSURE;
  const bendSurcharge = options.bendSurcharge ?? 1.3;
  const spread = flowTemperature - returnTemperature;
  const fluid = options.fluid ?? fluidProperties((flowTemperature + returnTemperature) / 2);
  const notes: FloorHeatingDesign['notes'] = [];

  const deltaH = logMeanOverTemperature(flowTemperature, returnTemperature, roomTemperature);

  let specificOutput: number;
  let source: FloorHeatingDesign['specificOutputSource'];
  if (options.load !== undefined && area > 0) {
    specificOutput = options.load / area;
    source = 'heizlast';
  } else if (options.kh !== undefined) {
    specificOutput = options.kh * deltaH;
    source = 'kennwert';
    notes.push({
      severity: 'info',
      text: `Wärmestromdichte aus dem Kennwert K_H = ${de(options.kh)} W/(m²·K) der Systemzulassung und Δϑ_H = ${de(round(deltaH, 1))} K gerechnet.`,
    });
  } else if (options.specificOutput !== undefined) {
    specificOutput = options.specificOutput;
    source = 'parameter';
  } else {
    specificOutput = DEFAULT_FLOOR_HEAT_FLUX;
    source = 'vorbelegung';
    notes.push({
      severity: 'warn',
      text:
        `Es ist ${DEFAULT_FLOOR_HEAT_FLUX} W/m² angesetzt — eine Vorbelegung, keine Auslegung. Das Kennlinienfeld nach ` +
        'DIN EN 1264-2 ist nicht frei verfügbar und wird hier nicht nachgebildet. Für eine belastbare Auslegung die ' +
        'Raumheizlast oder den Kennwert K_H aus der Systemzulassung übergeben.',
    });
  }

  const maxSurface = options.maxSurfaceTemperature ?? MAX_SURFACE_TEMPERATURE[zone];
  const maxSpecificOutput = surfaceHeatFlux(maxSurface, roomTemperature);
  const surfaceTemperature = surfaceTemperatureFor(specificOutput, roomTemperature);
  if (specificOutput > maxSpecificOutput) {
    notes.push({
      severity: 'error',
      text:
        `Die geforderten ${Math.round(specificOutput)} W/m² führen auf ${de(round(surfaceTemperature, 1))} °C Oberflächentemperatur ` +
        `und überschreiten die Grenze von ${de(maxSurface)} °C (höchstens ${Math.round(maxSpecificOutput)} W/m²). ` +
        'Ein engerer Rohrabstand hilft dabei nicht — es fehlt Fläche, Dämmung oder eine zusätzliche Heizfläche.',
    });
  }

  const output = specificOutput * area;
  const fieldLength = area > 0 ? area / spacing : 0;

  const usableLoopLength = Math.max(maxLoopLength - leadLength, 10);
  const loops = fieldLength > 0 ? Math.max(1, Math.ceil(fieldLength / usableLoopLength)) : 0;
  const loopLength = loops > 0 ? fieldLength / loops + leadLength : 0;
  const totalLength = loops * loopLength;

  const totalFlow = volumeFlow(output / 1000, spread, fluid);
  const flowPerLoop = loops > 0 ? totalFlow / loops : 0;

  const loop = pressureLoss(
    { label: 'Heizkreis', flow: flowPerLoop, length: loopLength, dimension },
    fluid,
  );
  const loopPressure = loop.pipeLoss * bendSurcharge;

  if (spread <= 0) {
    notes.push({ severity: 'error', text: 'Vorlauf- und Rücklauftemperatur ergeben keine Spreizung — ohne Spreizung kein Volumenstrom.' });
  }
  if (loopPressure > maxLoopPressure) {
    notes.push({
      severity: 'warn',
      text:
        `Der Kreis kommt auf ${Math.round(loopPressure / 100)} mbar und liegt über der Vorgabe von ` +
        `${Math.round(maxLoopPressure / 100)} mbar. Kreise teilen, größeres Rohr wählen oder die Spreizung erhöhen.`,
    });
  }
  if (loop.velocity > 0.5) {
    notes.push({
      severity: 'warn',
      text: `${de(round(loop.velocity, 2))} m/s im Heizkreis. Über 0,5 m/s wird die Strömung im Estrich hörbar und die Verteilerventile rauschen.`,
    });
  }
  if (loop.reynolds > 0 && loop.reynolds < REYNOLDS_TURBULENT) {
    notes.push({
      severity: 'info',
      text:
        `Re = ${Math.round(loop.reynolds)}: der Kreis läuft nicht sicher turbulent. Der Wärmeübergang vom Wasser an das Rohr ` +
        'fällt dabei ab; bei kleinen Kreisen mit geringer Last ist das normal und wird durch die große Fläche ausgeglichen.',
    });
  }
  if (loopLength > maxLoopLength + 0.01) {
    notes.push({
      severity: 'info',
      text: `Kreislänge ${Math.round(loopLength)} m einschließlich ${de(leadLength)} m Anbindung — die Vorgabe von ${de(maxLoopLength)} m bezieht sich auf die Kreislänge insgesamt.`,
    });
  }

  return {
    area: round(area, 2),
    spacing,
    pipePerSquareMetre: round(1 / spacing, 2),
    fieldLength: round(fieldLength, 1),
    loops,
    loopLength: round(loopLength, 1),
    totalLength: round(totalLength, 1),
    waterContent: round(totalLength * dimension.content, 2),
    specificOutput: round(specificOutput, 1),
    specificOutputSource: source,
    output: round(output, 0),
    logMeanOverTemperature: round(deltaH, 2),
    surfaceTemperature: round(surfaceTemperature, 1),
    maxSurfaceTemperature: maxSurface,
    maxSpecificOutput: round(maxSpecificOutput, 1),
    spread: round(spread, 2),
    totalFlow: round(totalFlow, 4),
    flowPerLoop: round(flowPerLoop * 1000, 1),
    velocity: loop.velocity,
    loopPressure: round(loopPressure, 0),
    loopPressureMbar: round(loopPressure / 100, 1),
    dimension,
    notes,
  };
}
