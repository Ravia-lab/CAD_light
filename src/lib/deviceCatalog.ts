/**
 * Gerätekatalog — Wärmeerzeuger und Speicher als Typklassen.
 * ---------------------------------------------------------------------------
 * **Was hier steht und was nicht.**
 *
 * Es gibt keine öffentliche, vollständige, maschinenlesbare Datenbank aller
 * Wärmepumpen des deutschen Marktes. Was es gibt, sind Herstellerdatenblätter
 * und die Prüfergebnisse einzelner Institute — beides nicht in einer Form, die
 * man ungefragt in ein Programm gießen darf, und beides veraltet mit jeder
 * Baureihenpflege.
 *
 * Deshalb enthält dieser Katalog **Typklassen statt Produkte**: „Monoblock
 * 8 kW R290" ist kein Gerät, das man bestellen kann, sondern die Beschreibung
 * dessen, was ein Gerät dieser Bauart und Größe üblicherweise leistet. Damit
 * lässt sich alles tun, was vor der Geräteauswahl kommt — Leistung abschätzen,
 * Schall prüfen, Speicher dimensionieren, Rohre auslegen, Platz reservieren.
 * Sobald das Datenblatt vorliegt, wird die Typklasse durch die echten Werte
 * ersetzt (`provenance: 'hersteller'`), und die Auslegung wird belastbar.
 *
 * Jede Zahl in diesem Modul ist aus einer offengelegten Beziehung abgeleitet
 * (siehe die Kommentare an den Formeln), nicht abgeschrieben. Wo eine
 * Beziehung nur ein Erfahrungswert ist, steht das dabei.
 *
 * Grundlagen der Betriebspunkte:
 *  • EN 14511 — Betriebspunkte A-7/W35, A2/W35, A7/W35, B0/W35, W10/W35
 *  • EN 14825 — jahreszeitbedingte Raumheizungs-Effizienz (SCOP), mittleres Klima
 *  • DIN EN 378-1 — Sicherheitsgruppen und praktische Grenzwerte der Kältemittel
 *  • VO (EU) 2024/573 — GWP-Werte (AR4/AR5-Basis je nach Anhang)
 */

import type {
  DeviceRatingPoint,
  HeatPumpModel,
  HeatSourceKind,
  PumpForm,
  Refrigerant,
  RefrigerantProperties,
  StorageKind,
  StorageModel,
  UnitContents,
} from '../types/bim';
import { typklassenHydraulik } from './erzeugerHydraulik';

// ---------------------------------------------------------------------------
// Kältemittel
// ---------------------------------------------------------------------------

/**
 * Eigenschaften der Kältemittel, die für die Aufstellung zählen.
 *
 * `practicalLimit` ist der praktische Grenzwert nach DIN EN 378-1 Anhang C.
 * Er beantwortet die Frage, wie groß ein Aufstellraum mindestens sein muss:
 * V_min = Füllmenge / praktischer Grenzwert. Für Außenaufstellung ohne
 * Bedeutung, für jedes Innengerät entscheidend.
 */
export const REFRIGERANTS: Record<Refrigerant, RefrigerantProperties> = {
  R290: {
    group: 'A3',
    gwp: 3,
    flammable: true,
    practicalLimit: 0.008,
    note: 'Propan. Brennbar, dichter als Luft — sammelt sich in Schächten und Kellerabgängen.',
  },
  R32: {
    group: 'A2L',
    gwp: 675,
    flammable: true,
    practicalLimit: 0.061,
    note: 'Schwer entflammbar. Bei Split-Geräten liegt Kältemittel im Aufstellraum des Innengeräts.',
  },
  R410A: {
    group: 'A1',
    gwp: 2088,
    flammable: false,
    practicalLimit: 0.44,
    note: 'Nicht brennbar, hoher GWP. Neuanlagen werden durch die F-Gas-Verordnung verdrängt.',
  },
  R454C: {
    group: 'A2L',
    gwp: 148,
    flammable: true,
    practicalLimit: 0.058,
    note: 'Gemisch mit niedrigem GWP, Verhalten wie R32 in der Aufstellung.',
  },
  R744: {
    group: 'A1',
    gwp: 1,
    flammable: false,
    practicalLimit: 0.1,
    note: 'CO₂. Nicht brennbar, aber erstickend — Grenzwert kommt aus der Atemluft, nicht aus dem Brandschutz.',
  },
  R1234ze: {
    group: 'A2L',
    gwp: 7,
    flammable: true,
    practicalLimit: 0.061,
    note: 'Vor allem in Großanlagen und Hochtemperatur-Wärmepumpen.',
  },
  andere: {
    group: 'A1',
    gwp: 0,
    flammable: false,
    practicalLimit: 0.1,
    note: 'Unbekanntes Kältemittel — Eigenschaften aus dem Datenblatt eintragen.',
  },
};

/**
 * Mindestgröße des Aufstellraums nach DIN EN 378-1 [m³].
 *
 * V_min = m / c_prakt. Ergibt bei 1,5 kg R290 rund 190 m³ — der Grund, warum
 * R290 praktisch nie im Keller steht, sondern draußen.
 */
export function minimumRoomVolume(refrigerant: Refrigerant, mass: number): number {
  const limit = REFRIGERANTS[refrigerant].practicalLimit;
  return limit > 0 ? mass / limit : 0;
}

// ---------------------------------------------------------------------------
// Typklassen der Wärmepumpen
// ---------------------------------------------------------------------------

/**
 * Beschreibung einer Baureihe: was sich zwischen den Größen *nicht* ändert.
 * Die Größen selbst entstehen daraus über die Formeln weiter unten.
 */
interface SeriesTemplate {
  key: string;
  series: string;
  form: PumpForm;
  source: HeatSourceKind;
  refrigerant: Refrigerant;
  /** Nennleistungen der Baureihe [kW] im Bezugspunkt. */
  sizes: number[];
  /** Bezugspunkt der Nennleistung. */
  point: string;
  /** COP im Bezugspunkt bei der kleinsten Größe. */
  copAtPoint: number;
  /** SCOP bei 35 °C Vorlauf. */
  scop35: number;
  /** SCOP bei 55 °C Vorlauf; 0 = Baureihe erreicht 55 °C nicht sinnvoll. */
  scop55: number;
  maxFlow: number;
  /** Kältemittelfüllung: Achsenabschnitt [kg] und Steigung [kg/kW]. */
  charge: [number, number];
  /** Schallleistung außen bei 6 kW [dB(A)]; wächst mit 10·lg(P/6). */
  soundAt6: number;
  /** Bietet die Baureihe einen garantierten Flüsterbetrieb? Abschlag [dB]. */
  nightReduction: number;
  /**
   * Baugruppen, die das Gerät der Baureihe mitbringt.
   *
   * Sie entscheiden, was das Anlagenschema **nicht** ein zweites Mal zeichnet.
   * Die Angabe hängt bewusst an der Baureihe und nicht an der Bauform: die
   * Pumpenlage kippt innerhalb derselben Bauform — Vaillant aroTHERM plus hat
   * sie in der Außeneinheit, Buderus WLW176i in der Inneneinheit. Wer sie aus
   * der Bauform ableitet, zeichnet bei der Hälfte des Marktes eine Pumpe zu
   * viel oder zu wenig.
   */
  contains?: UnitContents;
  /** Eingebauter Trinkwasserspeicher [l] — nur beim Turmgerät. */
  cylinder?: number;
  /** Vorlauftemperatur bei Norm-Außentemperatur [°C], falls abweichend. */
  maxFlowAtDesign?: number;
  note: string;
}

/**
 * Hat das Gerät eine Außeneinheit?
 *
 * Die Frage stand bis 1.12.0 an fünf Stellen als `form === 'indoor'` im Code
 * — im Lageplan, in der Modellprüfung, im Katalog. Jede neue Bauform musste
 * an allen fünf nachgezogen werden, und wo das ausblieb, entstand kein Fehler,
 * sondern eine falsche Zeichnung. Deshalb hier einmal und nur hier.
 */
export function hatAusseneinheit(form: PumpForm): boolean {
  return form === 'monoblock-outdoor' || form === 'split' || form === 'hydrosplit' || form === 'tower';
}

/**
 * Steht ein Geräteteil im Gebäude?
 *
 * Beim Monoblock außen ist das die Hydraulikstation, beim Split die
 * Inneneinheit, beim Turmgerät das Gerät mit dem Speicher. Nur die reine
 * Außenaufstellung ohne Innenteil gibt es am Markt praktisch nicht.
 */
export function hatInnengeraet(form: PumpForm): boolean {
  void form;
  return true;
}

/**
 * Schallleistung über die Baugröße.
 *
 * Ein doppelt so großes Gerät bewegt etwa doppelt so viel Luft. Verdoppelte
 * Quellstärke sind +3 dB, in der Praxis wächst der Pegel wegen größerer,
 * langsamer drehender Ventilatoren schwächer — 10·lg trifft die Realität
 * besser als 3·lg₂. Erfahrungswert, kein Normzusammenhang.
 */
function soundPowerOfSize(base: number, kw: number): number {
  return Math.round((base + 10 * Math.log10(Math.max(kw, 1) / 6)) * 10) / 10;
}

/**
 * Leistungskurve über die Betriebspunkte.
 *
 * Luft-Wärmepumpen liefern bei −7 °C weniger als bei +7 °C; das Verhältnis
 * liegt bei modernen Invertergeräten mit ausgelegtem Verdichter nahe 1,0 bis
 * 1,2, weil das Gerät bei Kälte hochdreht. Der COP dagegen fällt deutlich.
 * Die Faktoren unten sind der Mittelwert marktüblicher Leistungstabellen und
 * dienen nur der Vordimensionierung.
 */
const AIR_CURVE: { point: string; capacity: number; cop: number }[] = [
  { point: 'A-15/W35', capacity: 0.86, cop: 0.72 },
  { point: 'A-7/W35', capacity: 1.0, cop: 1.0 },
  { point: 'A2/W35', capacity: 1.06, cop: 1.34 },
  { point: 'A7/W35', capacity: 1.15, cop: 1.72 },
  { point: 'A-7/W55', capacity: 0.92, cop: 0.71 },
  { point: 'A7/W55', capacity: 1.05, cop: 1.14 },
];

const BRINE_CURVE: { point: string; capacity: number; cop: number }[] = [
  { point: 'B-5/W35', capacity: 0.93, cop: 0.9 },
  { point: 'B0/W35', capacity: 1.0, cop: 1.0 },
  { point: 'B5/W35', capacity: 1.08, cop: 1.13 },
  { point: 'B0/W55', capacity: 0.95, cop: 0.63 },
];

const WATER_CURVE: { point: string; capacity: number; cop: number }[] = [
  { point: 'W10/W35', capacity: 1.0, cop: 1.0 },
  { point: 'W10/W55', capacity: 0.96, cop: 0.62 },
];

const SERIES: SeriesTemplate[] = [
  {
    key: 'mono-r290',
    series: 'Monoblock Luft/Wasser R290',
    form: 'monoblock-outdoor',
    source: 'air',
    refrigerant: 'R290',
    sizes: [4, 6, 8, 10, 12, 14, 16, 20, 25],
    point: 'A-7/W35',
    copAtPoint: 2.75,
    scop35: 4.9,
    scop55: 3.6,
    maxFlow: 70,
    charge: [0.35, 0.11],
    soundAt6: 52,
    nightReduction: 4,
    note: 'Kältekreis vollständig außen. Kein Kältemittel im Gebäude, dafür Frostschutz oder Entleerung in der Außenleitung.',
  },
  {
    key: 'mono-r32',
    series: 'Monoblock Luft/Wasser R32',
    form: 'monoblock-outdoor',
    source: 'air',
    refrigerant: 'R32',
    sizes: [4, 6, 8, 11, 14, 16],
    point: 'A-7/W35',
    copAtPoint: 2.6,
    scop35: 4.6,
    scop55: 3.2,
    maxFlow: 60,
    charge: [0.5, 0.18],
    soundAt6: 53,
    nightReduction: 3,
    note: 'Verbreitetste Bauart. Vorlauftemperatur begrenzt — im unsanierten Bestand prüfen.',
  },
  {
    key: 'split-r32',
    series: 'Split Luft/Wasser R32',
    form: 'split',
    source: 'air',
    refrigerant: 'R32',
    sizes: [4, 6, 8, 11, 14, 16],
    point: 'A-7/W35',
    copAtPoint: 2.65,
    scop35: 4.7,
    scop55: 3.3,
    maxFlow: 60,
    charge: [0.6, 0.22],
    soundAt6: 51,
    nightReduction: 4,
    note: 'Kältemittelleitungen ins Gebäude — Kälte-Sachkunde erforderlich, Aufstellraum des Innengeräts nach EN 378 prüfen.',
  },
  {
    key: 'hydrosplit-r290',
    series: 'Hydrosplit Luft/Wasser R290',
    form: 'hydrosplit',
    source: 'air',
    refrigerant: 'R290',
    sizes: [5, 7, 9, 12, 16],
    point: 'A-7/W35',
    copAtPoint: 2.8,
    scop35: 5.0,
    scop55: 3.8,
    maxFlow: 70,
    // Der Kältekreis liegt vollständig außen — dieselbe Füllmenge wie beim
    // Monoblock, nur die Hydraulik wandert ins Haus.
    charge: [0.35, 0.11],
    soundAt6: 51,
    nightReduction: 4,
    /*
     * Die Hydraulikstation nimmt auf, was sonst bauseits an die Wand kommt.
     * Belegt für sechs Hersteller (LG, Daikin, Panasonic, Viessmann, Bosch,
     * Buderus); die Zusammenstellung unterscheidet sich im Detail, der Kern
     * — Pumpe, Umschaltventil, Sicherheitsgruppe, Ausdehnungsgefäß,
     * Heizstab — ist überall derselbe.
     *
     * Der Grenzfall steht als Warnung im Katalogtext: Vaillants VWZ MEH
     * enthält Ausdehnungsgefäß, Dreiwegeventil, Sicherheitsventil und
     * Heizstab, aber **keine Pumpe** — die sitzt dort in der Außeneinheit.
     * Wer diese Typklasse für ein solches Gerät benutzt, muss `contains`
     * am importierten Datensatz berichtigen.
     */
    contains: {
      pump: true,
      diverter: true,
      safetyGroup: true,
      expansionVessel: 10,
      flowSwitch: true,
      location: 'innen',
    },
    note: 'Kältekreis vollständig außen, ins Haus geht Heizungswasser; die Hydraulik sitzt in einer Inneneinheit ohne Verdichter. Am Markt uneinheitlich benannt — LG und Daikin sagen Hydrosplit, Panasonic Bi-Bloc, Viessmann und Bosch „Monoblock mit Inneneinheit". Frostrisiko in der Außenleitung wie beim Monoblock.',
  },
  {
    key: 'tower-r290',
    series: 'Kompaktgerät R290 mit Trinkwasserspeicher',
    form: 'tower',
    source: 'air',
    refrigerant: 'R290',
    sizes: [5, 7, 9, 12],
    point: 'A-7/W35',
    copAtPoint: 2.75,
    scop35: 4.9,
    scop55: 3.7,
    maxFlow: 70,
    charge: [0.35, 0.11],
    soundAt6: 51,
    nightReduction: 4,
    /*
     * Turmgerät: Inneneinheit mit Trinkwasserspeicher im Sockel. Marktüblich
     * 170 bis 280 l — Vaillant 188, Viessmann 190, Buderus 180, Bosch 170,7,
     * NIBE 180, Daikin 180/230, Wolf 180/280. 190 l ist die Mitte dieser
     * Spanne und hier die Typklasse.
     *
     * Für das Anlagenschema ist `cylinder` die entscheidende Angabe: wer
     * daneben einen zweiten Speicher zeichnet, plant einen, den niemand
     * kauft.
     */
    contains: {
      pump: true,
      diverter: true,
      safetyGroup: true,
      expansionVessel: 12,
      cylinder: 190,
      flowSwitch: true,
      location: 'innen',
    },
    cylinder: 190,
    note: 'Inneneinheit mit eingebautem Trinkwasserspeicher im Sockel. Spart den zweiten Speicher und den Platz dafür; die Speichergröße ist damit aber festgelegt und nicht mehr Teil der Auslegung.',
  },
  /*
   * Hier stand bis 1.8.1 eine Baureihe „Split Luft/Wasser R290".
   *
   * Sie war ein Phantom: über den ganzen Markt gibt es Propan praktisch nur
   * als Monoblock außen oder als Hydrosplit — Kältekreis vollständig außen,
   * ins Gebäude geht Wasser. Ein echter Kältemittel-Split mit R290 und
   * Leitungen in den Keller wird so gut wie nicht gebaut; das brennbare
   * Kältemittel im Aufstellraum ist die Hürde, nicht die Technik.
   *
   * Schlimmer war die Wirkung: die Typklasse trug die besten Kennwerte des
   * ganzen Katalogs (COP 2,8 · SCOP 5,0 bei 75 °C Vorlauf) und gewann damit
   * die Geräteauswahl regelmäßig. Das Programm schlug also bevorzugt ein
   * Gerät vor, das es so nicht zu kaufen gibt, und zeichnete Propanleitungen
   * ins Haus. Wer ein solches Gerät wirklich hat, trägt sein Datenblatt ein.
   */
  {
    key: 'indoor-r290',
    series: 'Innenaufstellung mit Luftkanälen R290',
    form: 'monoblock-indoor',
    source: 'air',
    refrigerant: 'R290',
    sizes: [6, 8, 10, 12],
    point: 'A-7/W35',
    copAtPoint: 2.6,
    scop35: 4.6,
    scop55: 3.4,
    maxFlow: 70,
    charge: [0.4, 0.12],
    soundAt6: 47,
    nightReduction: 3,
    note: 'Nach außen fast lautlos, dafür zwei Kanaldurchbrüche à 600–800 mm und ein Aufstellraum, der nach EN 378 groß genug ist.',
  },
  {
    key: 'brine-r410a',
    series: 'Sole/Wasser',
    form: 'indoor',
    source: 'brine-borehole',
    refrigerant: 'R410A',
    sizes: [6, 8, 10, 12, 15, 17, 22],
    point: 'B0/W35',
    copAtPoint: 4.8,
    scop35: 5.4,
    scop55: 3.6,
    maxFlow: 62,
    charge: [1.2, 0.15],
    soundAt6: 42,
    nightReduction: 0,
    note: 'Höchste Effizienz, teuerste Quelle. Schall spielt außen keine Rolle, im Technikraum schon.',
  },
  {
    key: 'water-r410a',
    series: 'Wasser/Wasser',
    form: 'indoor',
    source: 'groundwater',
    refrigerant: 'R410A',
    sizes: [10, 15, 20, 30],
    point: 'W10/W35',
    copAtPoint: 5.6,
    scop35: 5.8,
    scop55: 3.9,
    maxFlow: 60,
    charge: [1.5, 0.16],
    soundAt6: 44,
    nightReduction: 0,
    note: 'Braucht eine wasserrechtliche Erlaubnis und eine Wasseranalyse. Eisen und Mangan sind der häufigste Ausschlussgrund.',
  },
];

/**
 * Baugröße → Abmessungen der Außeneinheit [m].
 *
 * Der Wärmeübertrager wächst mit der Leistung, das Gehäuse mit der dritten
 * Wurzel des Volumens. Die Bezugsgröße ist ein 8-kW-Gerät mit 1,10 × 0,50 ×
 * 1,05 m — der Mittelwert dessen, was in Prospekten steht.
 */
function outdoorSize(kw: number, form: PumpForm): { width: number; depth: number; height: number; weight: number } {
  const s = Math.cbrt(Math.max(kw, 2) / 8);
  const round = (v: number) => Math.round(v * 100) / 100;
  if (form === 'indoor') return { width: 0.6, depth: 0.65, height: 1.1, weight: Math.round(120 + 9 * kw) };
  return {
    width: round(1.1 * s),
    depth: round(0.5 * s),
    height: round(1.05 * s),
    weight: Math.round(85 * s ** 3 + 40),
  };
}

/** Nächstgrößerer Wert aus einer Reihe; darüber der größte Wert. */
function nextInSeries(value: number, series: readonly number[]): number {
  for (const s of series) if (s >= value) return s;
  return series[series.length - 1];
}

const FUSE_SERIES = [10, 13, 16, 20, 25, 32, 40, 50, 63];

/**
 * Elektrische Auslegung.
 *
 * Aufnahmeleistung ≈ Heizleistung / COP im Auslegungspunkt, dazu der
 * Heizstab. Bis etwa 5 kW Aufnahme ist einphasig üblich, darüber dreiphasig.
 * Der Absicherungswert ist der nächste Wert der Reihe über dem 1,25-fachen
 * Betriebsstrom — der Faktor deckt Anlauf und Toleranz ab (Erfahrungswert;
 * verbindlich ist die Herstellerangabe und VDE-AR-N 4100).
 */
function electricDesign(kw: number, cop: number, form: PumpForm): HeatPumpModel['electric'] {
  const backup = kw <= 8 ? 6 : kw <= 14 ? 9 : 9;
  const compressorInput = kw / cop;
  const phases: 1 | 3 = compressorInput > 4.5 || form === 'indoor' ? 3 : 1;
  const voltage = phases === 3 ? 400 * Math.sqrt(3) : 230;
  const current = (compressorInput * 1000) / voltage;
  return {
    phases,
    fuse: nextInSeries(current * 1.25, FUSE_SERIES),
    // Sanftanlauf ist bei Invertergeräten Standard: der Anlaufstrom liegt
    // nur wenig über dem Betriebsstrom, anders als bei alten Direktstartern.
    // Der maximale Betriebsstrom ist der Wert aus dem Anmeldeformular des
    // Netzbetreibers. Er liegt über dem Strom im Auslegungspunkt, weil der
    // Verdichter bei tiefer Außentemperatur mehr aufnimmt: angesetzt sind
    // 35 % Aufschlag. Der Heizstab ist darin nicht enthalten — er hat einen
    // eigenen Stromkreis und wird gesondert angemeldet.
    maxCurrent: Math.round(current * 1.35 * 10) / 10,
    startCurrent: Math.round(current * 1.6 * 10) / 10,
    backupHeater: backup,
  };
}

/** Anschlussgröße heizungsseitig aus dem Volumenstrom. */
function connectionOf(kw: number): string {
  if (kw <= 8) return 'G 1 AG';
  if (kw <= 16) return 'G 1¼ AG';
  if (kw <= 25) return 'G 1½ AG';
  return 'G 2 AG';
}

/** Kältemittelleitungen bei Split — Größen aus dem üblichen Sortiment. */
function refrigerantLinesOf(kw: number): NonNullable<HeatPumpModel['refrigerantLines']> {
  if (kw <= 6) return { liquid: '1/4"', gas: '1/2"', maxLength: 30, maxHeight: 20 };
  if (kw <= 11) return { liquid: '1/4"', gas: '5/8"', maxLength: 30, maxHeight: 20 };
  return { liquid: '3/8"', gas: '5/8"', maxLength: 50, maxHeight: 30 };
}

function buildModel(t: SeriesTemplate, kw: number): HeatPumpModel {
  const curve = t.source === 'air' ? AIR_CURVE : t.source === 'groundwater' ? WATER_CURVE : BRINE_CURVE;
  // Größere Geräte sind minimal effizienter (größerer Wärmeübertrager je kW),
  // der Effekt ist klein: +2 % über die ganze Baureihe.
  const sizeBonus = 1 + 0.02 * Math.log2(Math.max(kw, 1) / t.sizes[0]);
  const cop = Math.round(t.copAtPoint * sizeBonus * 100) / 100;
  const ratings: DeviceRatingPoint[] = curve.map((c) => ({
    point: c.point,
    capacity: Math.round(kw * c.capacity * 10) / 10,
    cop: Math.round(cop * c.cop * 100) / 100,
  }));
  const outdoor = outdoorSize(kw, t.form);
  const sound = soundPowerOfSize(t.soundAt6, kw);
  const split = t.form === 'split';
  /*
   * Zu jedem Gerät gehört ein Innenteil.
   *
   * Beim Splitgerät ist es die Inneneinheit, bei der Innenaufstellung das
   * Gerät selbst — und beim **Monoblock außen** die Hydraulikstation: Pumpe,
   * Umschaltventil, Sicherheitsgruppe, Heizstab, Regelung. Über den ganzen
   * Markt liefert jeder Hersteller eine dazu (Viessmann, Vaillant, Bosch,
   * Buderus, Wolf, Brötje, LG). Bis 1.8.1 kannte der Katalog sie nicht, und
   * das Schema zeichnete einen Monoblock, der mit nichts verbunden war.
   */
  const hasIndoor = true;
  const hasOutdoor = hatAusseneinheit(t.form);
  /*
   * Der Heizstab wird **einmal** bemessen, nicht zweimal.
   *
   * Bis 1.12.0 standen zwei verschiedene Zahlen im selben Gerät: `indoor`
   * stufte nach 6/12 kW, `electric` nach 8/14 kW. Bei 17 der 36 Geräte
   * widersprachen sie sich. Das Anlagenschema beschriftete daraufhin einen
   * anderen Heizstab, als die Materialliste bestellte und die
   * Elektroanmeldung anmeldete. Maßgeblich ist die Elektroauslegung — sie
   * hängt an der Phasenzahl und am Anschlusswert.
   */
  const elektro = electricDesign(kw, cop, t.form);
  const heizstab = elektro.backupHeater;
  // Mindestvolumenstrom: der Wert, unter dem die Abtauung nicht mehr
  // funktioniert. Er entspricht etwa dem Nennvolumenstrom bei 8 K
  // Spreizung — 0,86/8 = 0,1075 m³/(h·kW). Er steht hier vor dem
  // Modellobjekt, weil die Erzeugerhydraulik ihn als Bezugspunkt braucht:
  // ein Δp ohne seinen Volumenstrom ist keine Zahl.
  const mindestVolumenstrom = Math.round(kw * 0.1075 * 100) / 100;
  const model: HeatPumpModel = {
    id: `${t.key}-${String(kw).replace('.', '_')}`,
    label: `${t.series} ${kw} kW`,
    series: t.series,
    form: t.form,
    source: t.source,
    refrigerant: t.refrigerant,
    refrigerantMass: Math.round((t.charge[0] + t.charge[1] * kw) * 100) / 100,
    nominalCapacity: kw,
    nominalPoint: t.point,
    ratings,
    scop35: Math.round(t.scop35 * sizeBonus * 100) / 100,
    scop55: t.scop55 ? Math.round(t.scop55 * sizeBonus * 100) / 100 : undefined,
    maxFlowTemperature: t.maxFlow,
    // Geräte ohne Außeneinheit haben keinen Außenschallpegel. Dort steht
    // nichts statt einer Null: eine Null hieße „gemessen und lautlos".
    soundPowerOutdoor: hasOutdoor ? sound : undefined,
    soundPowerNight: hasOutdoor && t.nightReduction ? Math.round((sound - t.nightReduction) * 10) / 10 : undefined,
    // Bei Innenaufstellung ist der eigene Pegel der maßgebliche; bei Split
    // und Monoblock außen ist die Inneneinheit deutlich leiser als das
    // Außengerät, weil dort kein Ventilator und kein Verdichter sitzt.
    soundPowerIndoor: hasOutdoor ? (hasIndoor ? Math.round((sound - 12) * 10) / 10 : undefined) : sound,
    // Nur Geräte mit Außeneinheit bekommen deren Maße. Bis 1.12.0 prüfte
    // die Bedingung nur `'indoor'` — eine Innenaufstellung mit Luftkanälen
    // trug damit Maße einer Außeneinheit, die es nicht gibt.
    outdoor: hasOutdoor ? outdoor : undefined,
    indoor: hasIndoor
      ? {
          width: 0.6,
          depth: 0.65,
          // Ein Turmgerät ist höher und schwerer — der Speicher steht im
          // Sockel. 1,90 m ist die Bauhöhe, in der die marktüblichen Geräte
          // mit 170 bis 280 l liegen.
          height: t.cylinder ? 1.9 : t.form === 'indoor' ? 1.1 : 0.85,
          weight: Math.round(45 + 4 * kw + (t.cylinder ?? 0) * 0.35),
          // Marktübliche Stufung. Der Heizstab ist die Regel, nicht die
          // Ausnahme — und er ist hydraulisch von Belang: mit aktiviertem
          // Zusatzheizer sinkt bei mehreren Herstellern das geforderte
          // Mindestwasservolumen erheblich.
          backupHeater: heizstab,
          integratedCylinder: t.cylinder,
          integratedBuffer: t.contains?.buffer,
        }
      : undefined,
    contains: t.contains ? { ...t.contains, backupHeater: heizstab } : undefined,
    hydraulicConnection: connectionOf(kw),
    refrigerantLines: split ? refrigerantLinesOf(kw) : undefined,
    minVolumeFlow: mindestVolumenstrom,
    // Mindestwasserinhalt für die Abtauung: Erfahrungswert 12 l/kW bei
    // Luft-Wärmepumpen, bei Sole und Wasser entfällt die Abtauung.
    minSystemVolume: t.source === 'air' ? Math.round(kw * 12) : Math.round(kw * 4),
    /*
     * Mindestwasserinhalt **mit** eingeschaltetem Heizstab.
     *
     * Die Zahl ist der Grund, warum Puffer regelmäßig zu groß ausgelegt
     * werden: bei Vaillant sinkt die Forderung von 150 l auf 45 l, sobald
     * der Zusatzheizer freigegeben ist — der Heizstab liefert die
     * Abtauenergie, die sonst aus dem Wasserinhalt kommen muss. Angesetzt
     * ist derselbe Faktor wie bei Sole (4 l/kW), weil dort aus demselben
     * Grund keine Abtaureserve nötig ist. Erfahrungswert, keine
     * Herstellerangabe — deshalb nur bei Luft-Wärmepumpen, wo die Abtauung
     * überhaupt eine Rolle spielt.
     */
    minSystemVolumeWithHeater: t.source === 'air' ? Math.round(kw * 4) : undefined,
    /*
     * Vorlauftemperatur am kalten Tag.
     *
     * Die Prospektangabe gilt bei Nennbedingungen; mehrere Hersteller nennen
     * daneben einen niedrigeren Wert für die Norm-Außentemperatur. 10 K
     * Abschlag ist die Größenordnung, die sich über die Baureihen zeigt
     * (Buderus „75 °C (65 °C bei −10 °C)"). Erfahrungswert, keine
     * Herstellerangabe — er verhindert nur, dass die Auslegung mit einer
     * Temperatur rechnet, die genau am Auslegungspunkt nicht anliegt.
     */
    maxFlowTemperatureAtDesign: t.maxFlowAtDesign ?? Math.max(35, t.maxFlow - 10),
    /*
     * Heizungsseitiger Widerstand bzw. Restförderhöhe.
     *
     * Bis 1.13.2 stand hier nichts, und der Rohrnetzbericht rechnete mit
     * null. Das war ehrlich gemeint und trotzdem falsch: die fehlende Zahl
     * ist kein neutraler Fehler, sondern macht die Pumpe systematisch zu
     * klein — bei einem Einfamilienhaus um rund die Hälfte der erforderlichen
     * Förderhöhe.
     *
     * Welche der beiden Angabearten gilt, hängt an der eingebauten Pumpe und
     * **nicht** an der Bauform: eine Hydraulikstation hat eine, ein nackter
     * Monoblock nicht. Die Zahl selbst ist der Median bzw. das untere Quartil
     * der Markttabelle in `erzeugerHydraulik` — gerechnet, nicht gesetzt, und
     * mit `herkunft: 'abgeleitet'` als das ausgewiesen, was sie ist. Sobald
     * ein Datenblatt vorliegt, ersetzt der Geräteimport sie.
     */
    hydraulics: {
      ...typklassenHydraulik({
        internePumpe: Boolean(t.contains?.pump),
        minVolumeFlow: mindestVolumenstrom,
        form: t.form,
      }),
      vMin: mindestVolumenstrom,
    },
    electric: elektro,
    provenance: 'generisch',
    note: t.note,
  };
  return model;
}

/** Der vollständige Katalog der Typklassen. */
export const HEAT_PUMP_CATALOG: HeatPumpModel[] = SERIES.flatMap((t) => t.sizes.map((kw) => buildModel(t, kw)));

/** Alle Baureihen als Gruppierung für die Bedienoberfläche. */
export const HEAT_PUMP_SERIES: { key: string; series: string; form: PumpForm; source: HeatSourceKind; refrigerant: Refrigerant; note: string }[] =
  SERIES.map((t) => ({ key: t.key, series: t.series, form: t.form, source: t.source, refrigerant: t.refrigerant, note: t.note }));

export function findModel(id: string, extra: readonly HeatPumpModel[] = []): HeatPumpModel | undefined {
  return extra.find((m) => m.id === id) ?? HEAT_PUMP_CATALOG.find((m) => m.id === id);
}

/**
 * Passende Geräte zu einer Heizlast.
 *
 * Ausgewählt wird nach der Leistung **im Auslegungspunkt**, nicht nach der
 * Nennleistung: eine 8-kW-Wärmepumpe liefert bei −7 °C 8 kW, bei −15 °C aber
 * nur noch knapp 7. Ohne zweiten Wärmeerzeuger muss die Leistung bei der
 * Norm-Außentemperatur reichen, mit Heizstab genügt der Bivalenzpunkt.
 */
export interface ModelMatch {
  model: HeatPumpModel;
  /** Leistung bei der Norm-Außentemperatur [kW]. */
  capacityAtDesign: number;
  /** Deckungsgrad Leistung/Heizlast [-]. */
  coverage: number;
  /** Bewertung: 1,0 = ideal, kleiner = schlechter. */
  score: number;
  verdict: 'passt' | 'knapp' | 'zu klein' | 'überdimensioniert';
  reason: string;
}

/**
 * Leistung bei beliebiger Außentemperatur durch Interpolation der Kurve.
 *
 * Zwischen den Stützpunkten wird linear interpoliert, außerhalb wird der
 * Randgradient fortgeführt. Das ist für die Vordimensionierung genau genug;
 * die echte Kurve eines Inverters ist abschnittsweise gekrümmt.
 */
export function capacityAt(model: HeatPumpModel, outdoorTemperature: number, flowTemperature = 35): number {
  const wanted = flowTemperature >= 45 ? 'W55' : 'W35';
  const points = model.ratings
    .filter((r) => r.point.endsWith(wanted))
    .map((r) => ({ t: parseTemperature(r.point), c: r.capacity }))
    .filter((p) => Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t);
  if (points.length === 0) return model.nominalCapacity;
  if (points.length === 1) return points[0].c;
  if (outdoorTemperature <= points[0].t) {
    const g = (points[1].c - points[0].c) / (points[1].t - points[0].t);
    return Math.max(0, points[0].c + g * (outdoorTemperature - points[0].t));
  }
  const last = points[points.length - 1];
  if (outdoorTemperature >= last.t) {
    const prev = points[points.length - 2];
    const g = (last.c - prev.c) / (last.t - prev.t);
    return last.c + g * (outdoorTemperature - last.t);
  }
  for (let i = 1; i < points.length; i += 1) {
    if (outdoorTemperature <= points[i].t) {
      const a = points[i - 1];
      const b = points[i];
      return a.c + ((b.c - a.c) * (outdoorTemperature - a.t)) / (b.t - a.t);
    }
  }
  return last.c;
}

/** „A-7/W35" → −7. Für Sole „B0/W35" → 0, für Wasser „W10/W35" → 10. */
function parseTemperature(point: string): number {
  const m = /^[ABW](-?\d+(?:[.,]\d+)?)\//.exec(point);
  return m ? Number(m[1].replace(',', '.')) : NaN;
}

/**
 * Geräte zu einer Heizlast vorschlagen.
 *
 * `heatLoad` ist die Gebäudeheizlast einschließlich Trinkwasserzuschlag und
 * Sperrzeitfaktor — also das, was das Gerät wirklich können muss.
 */
export function matchModels(
  heatLoad: number,
  options: {
    designTemperature: number;
    flowTemperature: number;
    source?: HeatSourceKind;
    form?: PumpForm;
    refrigerant?: Refrigerant;
    allowBackup?: boolean;
    extra?: readonly HeatPumpModel[];
  },
): ModelMatch[] {
  const { designTemperature, flowTemperature, allowBackup = true } = options;
  const pool = [...(options.extra ?? []), ...HEAT_PUMP_CATALOG].filter((m) => {
    if (options.source && m.source !== options.source) return false;
    if (options.form && m.form !== options.form) return false;
    if (options.refrigerant && m.refrigerant !== options.refrigerant) return false;
    return true;
  });
  const matches: ModelMatch[] = pool.map((model) => {
    const capacityAtDesign = Math.round(capacityAt(model, designTemperature, flowTemperature) * 10) / 10;
    const coverage = heatLoad > 0 ? capacityAtDesign / heatLoad : 0;
    let verdict: ModelMatch['verdict'];
    let reason: string;
    if (model.maxFlowTemperature < flowTemperature) {
      verdict = 'zu klein';
      reason = `Erreicht nur ${model.maxFlowTemperature} °C Vorlauf, gefordert sind ${flowTemperature} °C.`;
    } else if (coverage >= 0.98) {
      verdict = coverage > 1.45 ? 'überdimensioniert' : 'passt';
      reason =
        coverage > 1.45
          ? `Deckt ${Math.round(coverage * 100)} % der Heizlast — taktet im Teillastbetrieb.`
          : `Deckt ${Math.round(coverage * 100)} % der Heizlast bei ${designTemperature} °C.`;
    } else if (coverage >= 0.75 && allowBackup) {
      verdict = 'knapp';
      reason = `Deckt ${Math.round(coverage * 100)} %; die Restleistung von ${
        Math.round((heatLoad - capacityAtDesign) * 10) / 10
      } kW muss der Heizstab liefern.`;
    } else {
      verdict = 'zu klein';
      reason = `Deckt nur ${Math.round(coverage * 100)} % der Heizlast.`;
    }
    // Ideal ist eine Deckung von rund 110 %: genug Leistung am kältesten Tag,
    // ohne den Verdichter im Winter dauernd in die Taktung zu treiben.
    //
    // Die Bewertung ist bewusst *unsymmetrisch*. Zu wenig Leistung wird
    // doppelt so hart bestraft wie zu viel: ein zu großes Gerät taktet und
    // kostet Arbeitszahl, ein zu kleines lässt das Haus kalt und heizt die
    // Fehlmenge mit dem Heizstab — also mit Strom zum Preis von Wärme
    // geteilt durch eins. Ohne diese Gewichtung gewinnt bei knappen
    // Verhältnissen regelmäßig das kleinere Gerät um Haaresbreite.
    const ideal = 1.1;
    const error = coverage < ideal ? (ideal - coverage) * 4 : (coverage - ideal) * 2;
    const score = verdict === 'zu klein' ? 0 : 1 / (1 + error);
    return { model, capacityAtDesign, coverage: Math.round(coverage * 1000) / 1000, score: Math.round(score * 1000) / 1000, verdict, reason };
  });
  return matches.sort((a, b) => b.score - a.score);
}

// ---------------------------------------------------------------------------
// Speicher
// ---------------------------------------------------------------------------

/** Baureihen der Reihe: die Nenninhalte, die tatsächlich lieferbar sind. */
const CYLINDER_SIZES = [120, 150, 200, 250, 300, 400, 500, 750, 1000];
const BUFFER_SIZES = [25, 50, 80, 100, 200, 300, 500, 800, 1000];
const COMBI_SIZES = [600, 800, 1000];

/**
 * Abmessungen eines Speichers.
 *
 * Der Behälter ist ein Zylinder mit gewölbten Böden; das Wasservolumen sitzt
 * im lichten Durchmesser, außen kommt die Dämmung dazu (50 mm bis 500 l,
 * darüber 100 mm). Das Kippmaß ist die Raumdiagonale — daran scheitert der
 * Einbau öfter als am Platzbedarf.
 */
function cylinderGeometry(volume: number): { diameter: number; height: number; tiltHeight: number } {
  const innerDiameter = volume <= 200 ? 0.5 : volume <= 400 ? 0.6 : volume <= 750 ? 0.75 : 0.85;
  const insulation = volume <= 500 ? 0.05 : 0.1;
  const shellHeight = volume / 1000 / (Math.PI * (innerDiameter / 2) ** 2);
  const diameter = Math.round((innerDiameter + 2 * insulation) * 100) / 100;
  // Böden und Anschlussraum: rund 25 cm über der reinen Zylinderhöhe.
  const height = Math.round((shellHeight + 0.25) * 100) / 100;
  const tiltHeight = Math.round(Math.hypot(height, diameter) * 100) / 100;
  return { diameter, height, tiltHeight };
}

/**
 * Wärmetauscherfläche eines Trinkwasserspeichers für Wärmepumpen.
 *
 * Ein Speicher für einen Gaskessel kommt mit 0,1 m² je 100 l aus, weil das
 * Heizwasser 80 °C hat. Eine Wärmepumpe liefert 50–55 °C; damit die
 * Übertragung trotzdem funktioniert, braucht es die etwa zehnfache Fläche.
 * Der Richtwert der Praxis ist 1,4 m² je 100 l — darunter fällt die
 * Aufheizleistung so weit ab, dass der Heizstab einspringt.
 */
function coilAreaOf(volume: number): number {
  return Math.round((volume / 100) * 1.4 * 10) / 10;
}

/**
 * Dauerleistung 10/45 °C bei 55 °C Heizwasser [kW].
 *
 * Q = k · A · Δϑ_log. Mit k ≈ 700 W/(m²·K) für ein Glattrohr in Wasser und
 * einer logarithmischen Temperaturdifferenz von rund 14 K bei diesem
 * Betriebsfall ergibt sich Q ≈ 9,8 kW je m². Das ist die theoretische
 * Obergrenze; real erreichte Werte liegen bei 60–70 % davon.
 */
function continuousOutputOf(coilArea: number): number {
  return Math.round(coilArea * 9.8 * 0.65 * 10) / 10;
}

function buildStorage(kind: StorageKind, volume: number): StorageModel {
  const geo = cylinderGeometry(volume);
  const potable = kind === 'dhw-cylinder' || kind === 'combi';
  const coil = kind === 'dhw-cylinder' ? coilAreaOf(volume) : kind === 'combi' ? coilAreaOf(volume * 0.3) : undefined;
  return {
    id: `${kind}-${volume}`,
    label: `${STORAGE_LABELS[kind]} ${volume} l`,
    kind,
    volume,
    potableVolume: kind === 'combi' ? Math.round(volume * 0.3) : undefined,
    coilArea: coil,
    continuousOutput: coil ? continuousOutputOf(coil) : undefined,
    // Bereitschaftsverlust nach ErP-Kennzeichnung: er wächst mit der
    // Oberfläche, also mit V^(2/3). Bezug: 300 l ≈ 1,4 kWh/24 h (Klasse B).
    standbyLoss: Math.round(1.4 * (volume / 300) ** (2 / 3) * 100) / 100,
    diameter: geo.diameter,
    height: geo.height,
    tiltHeight: geo.tiltHeight,
    material: potable ? 'emailliert' : 'stahl-unlegiert',
    maxPressure: { potable: potable ? 10 : 0, heating: 3 },
    provenance: 'generisch',
    note:
      kind === 'buffer-series'
        ? 'Im Rücklauf: erhöht den Wasserinhalt für die Abtauung, ohne die Schichtung im Vorlauf zu stören.'
        : kind === 'separator'
          ? 'Hydraulische Weiche: entkoppelt Erzeuger- und Verbraucherkreis. Kein Speicher — sie erhöht den Anlageninhalt kaum.'
          : kind === 'fresh-water-station'
            ? 'Trinkwarmwasser im Durchfluss. Kein stehendes Trinkwasser, deshalb kein Legionellenthema — dafür hohe Spitzenleistung nötig.'
            : undefined,
  };
}

const STORAGE_LABELS: Record<StorageKind, string> = {
  'dhw-cylinder': 'Trinkwasserspeicher',
  'buffer-series': 'Reihenpuffer',
  'buffer-parallel': 'Parallelpuffer',
  separator: 'Hydraulische Weiche',
  combi: 'Kombispeicher',
  'fresh-water-station': 'Frischwasserstation',
};

export const STORAGE_CATALOG: StorageModel[] = [
  ...CYLINDER_SIZES.map((v) => buildStorage('dhw-cylinder', v)),
  ...BUFFER_SIZES.map((v) => buildStorage('buffer-series', v)),
  ...BUFFER_SIZES.filter((v) => v >= 100).map((v) => buildStorage('buffer-parallel', v)),
  ...COMBI_SIZES.map((v) => buildStorage('combi', v)),
  ...[50, 100, 200].map((v) => buildStorage('separator', v)),
];

export function findStorage(id: string, extra: readonly StorageModel[] = []): StorageModel | undefined {
  return extra.find((s) => s.id === id) ?? STORAGE_CATALOG.find((s) => s.id === id);
}

/** Nächstgrößerer Speicher einer Art. */
export function selectStorage(kind: StorageKind, minimumVolume: number, extra: readonly StorageModel[] = []): StorageModel | undefined {
  const pool = [...extra, ...STORAGE_CATALOG].filter((s) => s.kind === kind).sort((a, b) => a.volume - b.volume);
  return pool.find((s) => s.volume >= minimumVolume) ?? pool[pool.length - 1];
}

/**
 * Mindestpuffervolumen für eine Luft-Wärmepumpe [l].
 *
 * Zwei Anforderungen, die größere gewinnt:
 *  1. **Abtauung.** Die Wärme zum Abtauen kommt aus dem Anlagenwasser. Reicht
 *     der Inhalt nicht, bricht die Vorlauftemperatur ein. Richtwert 12 l/kW,
 *     abzüglich des Wassers, das ohnehin in Heizflächen und Leitungen steht.
 *  2. **Taktung.** Der Verdichter soll pro Start mindestens einige Minuten
 *     laufen. V = P · t / (1,163 · Δϑ) mit t als Mindestlaufzeit.
 *
 * Bei einer Fußbodenheizung ohne Einzelraumregelung ist beides oft schon
 * durch den Estrich erfüllt — dann braucht es gar keinen Puffer.
 */
export function minimumBufferVolume(
  capacity: number,
  existingWaterContent: number,
  options: { minimumRuntime?: number; spread?: number; specificContent?: number } = {},
): { required: number; byDefrost: number; byCycling: number; reason: string } {
  const specific = options.specificContent ?? 12;
  const runtime = options.minimumRuntime ?? 6;
  const spread = options.spread ?? 5;
  const byDefrost = Math.max(0, capacity * specific - existingWaterContent);
  const byCycling = Math.max(0, (capacity * (runtime / 60)) / (1.163 * spread) * 1000 - existingWaterContent);
  const required = Math.max(byDefrost, byCycling);
  const reason =
    required <= 0
      ? `Der Anlageninhalt von ${Math.round(existingWaterContent)} l reicht bereits — ein Puffer ist nicht erforderlich.`
      : byDefrost >= byCycling
        ? `Maßgebend ist die Abtauung: ${specific} l/kW × ${capacity} kW = ${Math.round(capacity * specific)} l, vorhanden sind ${Math.round(existingWaterContent)} l.`
        : `Maßgebend ist die Mindestlaufzeit von ${runtime} min bei ${spread} K Spreizung.`;
  return {
    required: Math.round(required),
    byDefrost: Math.round(byDefrost),
    byCycling: Math.round(byCycling),
    reason,
  };
}
