/**
 * Hydraulischer Abgleich — die Brücke zwischen Zeichnung und Rechenkern.
 * ---------------------------------------------------------------------------
 * **Warum es dieses Modul gibt.**
 *
 * `pipeNetwork.ts` liest die gezeichneten Leitungen als Graph und rechnet
 * bewusst nichts. `hydraulics.ts` rechnet und kennt die Zeichnung bewusst
 * nicht. Zwischen beiden klafft eine Lücke, die keines der Module schließen
 * darf, ohne seine Aufgabe zu verlieren: aus einer Geometrie eine **Last** zu
 * machen. Genau das passiert hier — und nur hier. Dieses Modul ist die einzige
 * Stelle im Programm, die beide Seiten kennt.
 *
 * **Was der Abgleich ist.**
 *
 * Alle Stränge einer Verteilung liegen parallel zwischen denselben zwei
 * Punkten, also liegt über allen dieselbe Druckdifferenz. Wer den kürzeren
 * Weg hat, bekommt deshalb ohne Zutun zu viel Wasser, und der ungünstigste
 * Strang bekommt zu wenig — nicht ein bisschen, sondern quadratisch. Der
 * Abgleich behebt das nicht durch mehr Pumpe, sondern durch Vernichtung:
 *
 *     Δp_Drossel = Δp_ungünstigster Strang − Δp_eigener Strang
 *
 * Der ungünstigste Strang wird nicht gedrosselt; er ist das Maß. Jeder andere
 * bekommt genau so viel künstlichen Widerstand, dass alle gleich schwer zu
 * durchströmen sind. Der dafür nötige Ventilkennwert folgt aus der Definition
 * des k_v-Wertes:
 *
 *     k_v = V̇ / √(Δp / 1 bar)      V̇ in m³/h, Δp in bar
 *
 * **Die schwächste Stelle.** Siehe `dimensionForDn`. Die Zeichnung kennt nur
 * eine Nennweite, die Rechnung braucht einen lichten Innendurchmesser. Diese
 * Zuordnung ist eine Annahme, keine Messung — sie ist im Ergebnis an jedem
 * betroffenen Abschnitt vermerkt und darf nicht überlesen werden.
 *
 * **Einheiten.** Gerechnet wird in SI (m, s, kg, Pa, W, K). Nach außen gehen
 * praxisübliche Einheiten: Volumenstrom in m³/h, Leistung in W beim einzelnen
 * Verbraucher und in kW in der Summe, Drücke in Pa **und** kPa, k_v in m³/h
 * bei 1 bar Druckabfall, Längen in m, Nennweiten in mm. An jedem Feld und
 * jedem Parameter steht die Einheit dabei.
 *
 * **Grundlagen.**
 *  • Parallelschaltung und Δp-Bilanz — Strömungsmechanik, keine Norm nötig
 *  • k_v-Definition: DIN EN 60534-2-3 bzw. VDI/VDE 2173; die Definition
 *    selbst (V̇ bei 1 bar) ist frei zitiert und in jedem Ventildatenblatt
 *    abgedruckt
 *  • Rohrreibung, Stoffwerte, Dimensionierung: `hydraulics.ts`
 *  • Die Einstellgrenzen voreinstellbarer Thermostatventile sind
 *    **Erfahrungswerte** aus Ventildatenblättern, keine Normwerte — siehe
 *    `MIN_PRESET_PRESSURE` und `MAX_PRESET_PRESSURE`.
 */

import type {
  Fixture,
  PipeDimension,
  PipeMaterial,
  PipeAccessoryKind,
  PipeNetworkReport,
  PipePath,
  PipeSegment,
  PipeService,
  PipeSizing,
} from '../types/bim';
import { FIXTURE_LIBRARY, PIPE_MATERIAL_LABELS, PIPE_SERVICE_LABELS } from '../types/bim';
import type {
  FittingCount,
  FluidProperties,
  PathResult,
  PipeCondition,
  PipePathLoad,
  PipeSegmentLoad,
  PumpDesign,
} from './hydraulics';
import type { PresetSelection } from './valveCatalog';
import {
  DEFAULT_MODEL_BY_ROLE,
  MAX_THERMOSTAT_PRESSURE,
  MIN_VALVE_AUTHORITY,
  authorityVerdict,
  findValveModel,
  modelFor,
  requiredKv as catalogKv,
  selectPreset,
  valveAuthority,
} from './valveCatalog';
import {
  DEFAULT_FLUID,
  DEFAULT_SIZING_LIMITS,
  PIPE_TABLES,
  designPump,
  evaluatePath,
  fittingZeta,
  flowState,
  sizePipe,
  volumeFlow,
} from './hydraulics';

// ---------------------------------------------------------------------------
// Kleinkram
// ---------------------------------------------------------------------------

/** Deutsche Zahlschreibweise für Meldungstexte: Dezimalkomma statt Punkt. */
function de(value: number): string {
  return String(value).replace('.', ',');
}

function round(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/** Eine Meldung, wie sie alle Module dieses Projekts führen. */
export interface BalanceNote {
  severity: 'info' | 'warn' | 'error';
  text: string;
}

// ===========================================================================
// 1 — Nennweite zu Dimension: die schwächste Stelle dieses Moduls
// ===========================================================================

/**
 * Ergebnis der Zuordnung Nennweite → Rohrdimension.
 *
 * `exact` ist das Feld, auf das es ankommt: nur dort ist der gerechnete
 * Druckverlust so belastbar wie die Zeichnung. Überall sonst ist er eine
 * Annahme über ein Rohr, das so nicht gezeichnet wurde.
 */
export interface DimensionMatch {
  /** Angeforderte Nennweite DN [mm]. */
  dn: number;
  /** Gefundene oder ersatzweise gewählte Dimension. */
  dimension: PipeDimension;
  /** Die Reihe enthält genau diese Nennweite. */
  exact: boolean;
  /** Es wurde auf die nächstgrößere Nennweite aufgerundet. */
  roundedUp: boolean;
  /** Mehrere Dimensionen der Reihe tragen dieselbe Nennweite. */
  ambiguous: boolean;
  /** Begründung, falls die Zuordnung nicht eindeutig war. */
  note?: string;
}

/**
 * Rohrdimension zu einer gezeichneten Nennweite.
 *
 * ## Das ist die schwächste Stelle des ganzen Moduls. Bitte lesen.
 *
 * `PipeRun.nominalDiameter` ist eine **Nennweite** — eine Sortiernummer, die
 * sagt, welche Armatur auf welches Rohr passt. Sie ist keine Abmessung. Für
 * den Druckverlust zählt aber ausschließlich der lichte Innendurchmesser, und
 * der geht mit rund der fünften Potenz ein: R ~ d⁻⁴·⁷⁵ bei festem
 * Volumenstrom. Zwei Rohre derselben Nennweite können sich im Druckgefälle um
 * mehr als 20 % unterscheiden (Kupfer 28 × 1,5 gegenüber Edelstahl 28 × 1,2,
 * beide DN 25 — nachgerechnet in `hydraulics.ts`: 155,3 gegenüber
 * 138,7 Pa/m).
 *
 * Daraus folgt:
 *
 *  1. **Der Werkstoff ist eine Eingabe, keine Eigenschaft der Zeichnung.**
 *     Wer im Grundriss „DN 20" zeichnet, hat nicht gesagt, ob das Kupfer,
 *     Verbund oder PE-Xa wird. Wird der Werkstoff falsch angenommen, ist das
 *     Ergebnis falsch, ohne dass die Rechnung es merkt.
 *  2. **Nicht jede Nennweite kommt in jeder Reihe vor.** Kupfer hat keine
 *     DN 10, Verbundrohr keine DN 65. Es wird dann auf die nächstgrößere
 *     Dimension aufgerundet — die Richtung ist bewusst gewählt, weil ein
 *     Installateur ebenso aufrundet. Der gerechnete Druckverlust fällt
 *     dadurch aber **zu günstig** aus. Das steht in `note` und wird im
 *     Bericht gezählt.
 *  3. **Nennweiten sind nicht eindeutig.** In der Kupferreihe tragen 64 × 2
 *     und 76,1 × 2 beide DN 65. Gewählt wird die Dimension mit der kleineren
 *     lichten Weite, weil sie die ungünstigere und damit sichere Rechnung
 *     liefert. `ambiguous` markiert diesen Fall.
 *
 * Sobald die tatsächliche Abmessung bekannt ist, gehört sie über
 * `findDimension` aus `hydraulics.ts` in die Rechnung — nicht über diese
 * Funktion. Sie ist ein Notbehelf für die Phase, in der nur der Grundriss
 * vorliegt.
 *
 * @param dn Nennweite [mm], wie sie an der Leitung steht
 * @param material Werkstoff, dessen Reihe durchsucht wird
 */
export function dimensionForDn(dn: number, material: PipeMaterial = 'kupfer'): DimensionMatch {
  const table = [...PIPE_TABLES[material]].sort((a, b) => a.inner - b.inner);
  const smallest = table[0];
  const largest = table[table.length - 1];
  const werkstoff = PIPE_MATERIAL_LABELS[material];

  if (!Number.isFinite(dn) || dn <= 0) {
    return {
      dn,
      dimension: smallest,
      exact: false,
      roundedUp: false,
      ambiguous: false,
      note:
        'An der Leitung steht keine brauchbare Nennweite. Gerechnet wird mit der kleinsten Dimension ' +
        `der Reihe (${smallest.label}); das Ergebnis ist eine Untergrenze, kein Nachweis.`,
    };
  }

  const hits = table.filter((d) => d.dn === dn);
  if (hits.length > 0) {
    return {
      dn,
      dimension: hits[0],
      exact: true,
      roundedUp: false,
      ambiguous: hits.length > 1,
      note:
        hits.length > 1
          ? `DN ${de(dn)} kommt in der Reihe ${werkstoff} mehrfach vor (${hits.map((h) => h.label).join(', ')}). ` +
            `Gerechnet wird mit ${hits[0].label} — die kleinere lichte Weite ist die ungünstigere Annahme.`
          : undefined,
    };
  }

  const larger = table.find((d) => d.dn > dn);
  if (larger) {
    return {
      dn,
      dimension: larger,
      exact: false,
      roundedUp: true,
      ambiguous: false,
      note:
        `DN ${de(dn)} kommt in der Reihe ${werkstoff} nicht vor. Gerechnet wird mit der nächstgrößeren ` +
        `Dimension ${larger.label} (DN ${de(larger.dn)}). Der Druckverlust fällt dadurch zu günstig aus.`,
    };
  }

  return {
    dn,
    dimension: largest,
    exact: false,
    roundedUp: false,
    ambiguous: false,
    note:
      `DN ${de(dn)} liegt über der größten Dimension der Reihe ${werkstoff} (${largest.label}). ` +
      'Gerechnet wird mit dieser; für größere Nennweiten ist die Werkstofftabelle zu erweitern.',
  };
}

// ===========================================================================
// 2 — Vorbelegungen und Erfahrungswerte
// ===========================================================================

/**
 * Verbrauchertypen, die am Heizungsabgleich teilnehmen.
 *
 * Trinkwasser und Lüftung stehen bewusst nicht in dieser Liste. Beide haben
 * ein eigenes Verfahren — Trinkwasser den Spitzendurchfluss aus der
 * Berechnungsdurchflusssumme, Lüftung den Volumenstrom je Ventil. Beides über
 * Leistung und Spreizung zu rechnen wäre nicht ungenau, sondern falsch.
 */
export const HEATING_CONSUMER_TYPES: readonly string[] = [
  'radiator',
  'radiator-tube',
  'convector',
  'underfloor',
];

/**
 * Vorbelegte Normwärmeleistung je Verbrauchertyp [W].
 *
 * **Nicht erfunden, sondern übernommen:** die Werte stammen aus der
 * Symbolbibliothek `FIXTURE_LIBRARY` in `src/types/bim.ts` — also aus genau
 * der Vorbelegung, die beim Setzen des Symbols ohnehin eingetragen wird. Sie
 * sind eine Platzhaltergröße für „ein üblicher Heizkörper", keine Auslegung.
 * Wo sie greifen, steht `powerAssumed: true` am Verbraucher und eine Warnung
 * im Bericht.
 */
export const DEFAULT_POWER_BY_TYPE: Record<string, number> = Object.fromEntries(
  FIXTURE_LIBRARY.filter((d) => d.params.powerW !== undefined).map((d) => [d.type, d.params.powerW ?? 0]),
);

/**
 * Letzte Vorbelegung, wenn auch die Symbolbibliothek nichts hergibt [W].
 *
 * Ein Kilowatt ist die Größenordnung eines einzelnen Raumheizkörpers im
 * Bestand. Der Wert dient nur dazu, dass ein unvollständiges Modell eine
 * Rechnung liefert statt eines Absturzes — er ist als Parameter
 * `fallbackPower` überschreibbar und **nie** stillschweigend: jeder damit
 * gerechnete Verbraucher trägt `powerAssumed: true`.
 */
export const FALLBACK_POWER = 1000;

/**
 * Vorbelegte Spreizung Vorlauf minus Rücklauf [K].
 *
 * 7 K ist der im Wärmepumpenbetrieb übliche Auslegungswert für
 * Heizkörperkreise; Fußbodenheizungen laufen eher mit 5 bis 7 K. Der Wert ist
 * eine **Planungsentscheidung**, keine Norm — er bestimmt den Volumenstrom
 * linear und damit den Druckverlust quadratisch. Deshalb Parameter.
 */
export const DEFAULT_SPREAD = 7;

/**
 * Kleinster Drosseldruck, der an einem Thermostatventil sicher einstellbar
 * ist [Pa].
 *
 * **Erfahrungswert, kein Normwert.** Voreinstellbare Thermostatventileinsätze
 * arbeiten in ihren unteren Stufen mit sehr kleinen Spaltquerschnitten; dort
 * streuen Fertigungstoleranz, Ventilautorität und Verschmutzung so stark,
 * dass eine gerechnete Drosselung von wenigen Kilopascal am Gerät nicht
 * wiederzufinden ist. Unterhalb von rund 3 kPa ist die Einstellung damit
 * nicht mehr sicher darstellbar. Wer belastbarer rechnen will, nimmt das
 * k_v-Diagramm des Ventils aus dem Datenblatt und setzt die Grenze über
 * `minPresetPressure` auf den dort ablesbaren Wert.
 */
export const MIN_PRESET_PRESSURE = 3000;

/**
 * Größter Drosseldruck, der über die Ventilvoreinstellung noch sinnvoll
 * darstellbar ist [Pa].
 *
 * **Erfahrungswert, kein Normwert.** Übliche voreinstellbare
 * Thermostatventile decken über ihre Stufen einen Bereich von etwa 2 bis
 * 25 kPa ab. Wird mehr verlangt, ist die kleinste Stufe erreicht und das
 * Ventil arbeitet als Blende — die Regelung stirbt, weil der Hub keinen
 * Einfluss mehr hat. Der Ausweg ist dann kein anderes Thermostatventil,
 * sondern ein Strangregulierventil, eine andere Rohrdimension oder eine
 * drehzahlgeregelte Pumpe mit kleinerer Förderhöhe.
 */
export const MAX_PRESET_PRESSURE = 25000;

/**
 * Widerstandsbeiwert, der je gezeichnetem Abschnitt pauschal angesetzt wird [-].
 *
 * Ein Abschnitt im Strangschema ist die gerade Strecke zwischen zwei
 * Stützpunkten der gezeichneten Polylinie. Jeder innere Stützpunkt ist ein
 * Richtungswechsel, also im gebauten Zustand ein Bogen. Deshalb wird je
 * Abschnitt genau ein Bogen 90° aus der Formstücktabelle angesetzt — das ist
 * keine Pauschale ins Blaue, sondern die Übersetzung dessen, was gezeichnet
 * wurde. T-Stücke, Absperrungen und Verschraubungen sind darin **nicht**
 * enthalten; wer sie kennt, übergibt `zetaPerSegment`.
 */
export const DEFAULT_SEGMENT_ZETA = fittingZeta('bogen-90') ?? 0.5;

/**
 * Zuordnung der gezeichneten Armatur zu ihrem Widerstandsbeiwert.
 *
 * Bis 1.11.0 setzte der Abgleich je Abschnitt pauschal einen Bogen an und
 * ignorierte, dass `doc.pipeAccessories` die tatsächlich gesetzten Bauteile
 * mit Ort und Bauart kennt. Ein Netz mit acht Absperrungen, zwei
 * Schmutzfängern und einem Wärmemengenzähler wurde damit gerechnet, als gäbe
 * es sie nicht — und der ungünstigste Strang fiel um ein Vielfaches zu
 * günstig aus.
 *
 * Nicht in der Liste stehen die **Abgleichorgane selbst**: Thermostatventil,
 * Rücklaufverschraubung und Differenzdruckregler. Ihr Druckverlust ist nicht
 * fest, sondern genau das, was der Abgleich ausrechnet. Sie hier mitzuzählen
 * hieße, den Drosseldruck zweimal anzusetzen.
 */
export const ACCESSORY_FITTING: Partial<Record<PipeAccessoryKind, string>> = {
  // Absperrungen werden heute als Kugelhahn ausgeführt; das alte
  // Geradsitzventil mit ζ = 4 wäre für einen Neubau die falsche Annahme.
  shutoff: 'kugelhahn',
  'balancing-valve': 'strangregulierventil',
  strainer: 'schmutzfaenger',
  tee: 't-abzweig',
  elbow: 'bogen-90',
  'expansion-bend': 'dehnungsbogen',
  'air-vent': 'entlueftung',
  'fixed-point': 'festpunkt',
  // drain: ein Entleerhahn sitzt im Nebenschluss und hat im Hauptstrom
  // keinen nennenswerten Widerstand.
};

// ===========================================================================
// 3 — Eingabe
// ===========================================================================

export interface BalanceInput {
  /** Das gezeichnete Netz aus `buildPipeNetwork`. */
  network: PipeNetworkReport;
  /**
   * Die Objekte des Modells, für Leistung und Beschriftung. Record oder Liste,
   * beides wird angenommen — der Store hält sie als Record, Exporte als Liste.
   */
  fixtures?: Record<string, Fixture> | readonly Fixture[];
  /** Leistung je Verbraucher [W]; überschreibt `Fixture.params.powerW`. */
  powerByFixture?: Record<string, number>;
  /** Spreizung Vorlauf minus Rücklauf [K]. Vorgabe `DEFAULT_SPREAD`. */
  spread?: number;
  /** Werkstoff der Leitungen — siehe die Warnung bei `dimensionForDn`. */
  material?: PipeMaterial;
  /** Stoffwerte; Vorgabe Wasser 50 °C aus `hydraulics.ts`. */
  fluid?: FluidProperties;
  /** Zustand der Rohrinnenwand (nur bei Stahl wirksam). */
  condition?: PipeCondition;
  /** Summe ζ je gezeichnetem Abschnitt [-]. Vorgabe `DEFAULT_SEGMENT_ZETA`. */
  zetaPerSegment?: number;
  /**
   * Druckverlust des Verbrauchers selbst [Pa] — Heizfläche, Ventilunterteil,
   * Fußbodenkreis. Gilt für alle, wenn nicht einzeln gesetzt. Vorgabe 0 mit
   * Hinweis: ohne diesen Anteil fehlt dem ungünstigsten Strang der größte
   * Einzelposten, und der Abgleich fällt zu optimistisch aus.
   */
  terminalLoss?: number;
  /** Druckverlust des Verbrauchers je Objekt [Pa]; überschreibt `terminalLoss`. */
  terminalLossByFixture?: Record<string, number>;
  /** Höchste Fließgeschwindigkeit für die Nachdimensionierung [m/s]. */
  maxVelocity?: number;
  /** Höchstes Druckgefälle für die Nachdimensionierung [Pa/m]. */
  maxGradient?: number;
  /** Untere Grenze der Ventilvoreinstellung [Pa]. Vorgabe `MIN_PRESET_PRESSURE`. */
  minPresetPressure?: number;
  /** Obere Grenze der Ventilvoreinstellung [Pa]. Vorgabe `MAX_PRESET_PRESSURE`. */
  maxPresetPressure?: number;
  /** Leistungsvorbelegung, wenn nichts hinterlegt ist [W]. */
  fallbackPower?: number;
  /** Verlust in Erzeuger, Speicher, Weiche [Pa] — wird an `designPump` gereicht. */
  generatorLoss?: number;
  /** Sicherheitszuschlag der Pumpenauslegung [-]. */
  safetyFactor?: number;
  /** Verfügbare Förderhöhe der vorgesehenen Pumpe [m]. */
  availableHead?: number;
  /** Verbrauchertypen, die mitgerechnet werden. Vorgabe `HEATING_CONSUMER_TYPES`. */
  consumerTypes?: readonly string[];
  /**
   * Auslegungsdifferenzdruck am Thermostatventil [Pa].
   *
   * **Vorgabe 0 — und das ist Absicht.** Der Wert verändert jede Kennzahl des
   * Berichts; er wird deshalb nicht stillschweigend gesetzt, sondern nur von
   * dem, der ihn verantworten will. Der Rohrnetzbericht übergibt
   * `DEFAULT_THERMOSTAT_PRESSURE` (10 kPa nach VdZ-Leitfaden S. 25), weil eine
   * Auslegung ohne Ventildruck kein Nachweis ist: das Ventil ist der größte
   * Einzelposten im Strang und bestimmt Ventilautorität wie Pumpenförderhöhe.
   *
   * Ist der Wert 0, bleiben Autorität und Voreinstellwert leer statt falsch.
   */
  thermostatPressure?: number;
  /**
   * Baureihe des Thermostatventils aus `valveCatalog`.
   * Vorgabe: die Baureihe mit der breitesten Marktverbreitung, deren kv-Werte
   * als Tabelle veröffentlicht sind.
   */
  valveModelId?: string;
}

// ===========================================================================
// 4 — Ergebnis
// ===========================================================================

/** Einordnung der Ventilvoreinstellung eines Strangs. */
export type PresetVerdict =
  /** Ungünstigster Strang der Quelle — er bleibt offen, er ist das Maß. */
  | 'ungedrosselt'
  /** Der Drosselbedarf liegt im darstellbaren Bereich. */
  | 'einstellbar'
  /** Zu wenig zu drosseln, um es am Ventil sicher einzustellen. */
  | 'unterhalb-einstellgrenze'
  /** Mehr zu drosseln, als ein Thermostatventil hergibt. */
  | 'oberhalb-einstellbereich'
  /** Ohne Volumenstrom gibt es keinen Einstellwert. */
  | 'ohne-volumenstrom';

export const PRESET_VERDICT_LABELS: Record<PresetVerdict, string> = {
  ungedrosselt: 'ungünstigster Strang, keine Drosselung',
  einstellbar: 'einstellbar',
  'unterhalb-einstellgrenze': 'Drosselbedarf zu gering für eine sichere Einstellung',
  'oberhalb-einstellbereich': 'Drosselbedarf übersteigt den Voreinstellbereich',
  'ohne-volumenstrom': 'ohne Volumenstrom nicht einstellbar',
};

/** Urteil der Nachdimensionierung eines Abschnitts. */
export type SegmentVerdict = 'passt' | 'zu klein' | 'unnötig groß' | 'unbewertet';

/** Nachrechnung eines gezeichneten Abschnitts gegen den Volumenstrom, den er trägt. */
export interface SegmentSizingCheck {
  /** Kennung des Abschnitts im Netz — Quelle und Weg bis hierher. */
  key: string;
  /** Leitung, aus der der Abschnitt stammt. */
  runId: string;
  service: PipeService;
  label: string;
  /** Zahl der Verbraucher hinter diesem Abschnitt. */
  consumers: number;
  /** Trassenlänge einfach [m]; abgerechnet wird das Doppelte (Vor- und Rücklauf). */
  length: number;
  /** Summierter Volumenstrom aller dahinterliegenden Verbraucher [m³/h]. */
  flow: number;
  /** Gezeichnete Nennweite DN [mm]. */
  drawnDn: number;
  /** Ist-Dimension: die Zuordnung der gezeichneten Nennweite. */
  drawn: DimensionMatch;
  /** Fließgeschwindigkeit in der Ist-Dimension [m/s]. */
  velocity: number;
  /** Druckgefälle in der Ist-Dimension [Pa/m]. */
  gradient: number;
  /** Soll-Dimension nach `sizePipe`. */
  proposed: PipeDimension;
  /** Warum die Soll-Dimension so ausfällt. */
  proposedReason: PipeSizing['reason'];
  verdict: SegmentVerdict;
  note?: string;
}

/** Der Abgleich eines einzelnen Verbrauchers. */
export interface ConsumerBalance {
  fixtureId: string;
  fixtureType: string;
  label: string;
  levelId: string;
  roomId?: string;
  sourceFixtureId: string;
  sourceLabel: string;
  /** Angesetzte Leistung [W]. */
  power: number;
  /** Die Leistung stammt aus einer Vorbelegung, nicht aus dem Modell. */
  powerAssumed: boolean;
  /** Volumenstrom [m³/h]. */
  flow: number;
  /** Einfache Trassenlänge bis zur Quelle [m]. */
  routeLength: number;
  /** Abgerechnete Länge Vor- und Rücklauf [m]. */
  circuitLength: number;
  /** Kleinste Nennweite auf dem Weg [mm]. */
  minimumDiameter: number;
  /** Eigener Strangwiderstand einschließlich Verbraucher [Pa]. */
  ownLoss: number;
  /** Derselbe Wert [kPa]. */
  ownLossKpa: number;
  /** Erforderlicher Drosseldruck [Pa]; 0 beim ungünstigsten Strang. */
  throttle: number;
  /** Derselbe Wert [kPa]. */
  throttleKpa: number;
  /**
   * Erforderlicher k_v-Wert des Ventils [m³/h bei 1 bar]. Undefiniert, wenn
   * nicht gedrosselt wird oder kein Volumenstrom fließt — ein k_v ohne
   * Volumenstrom wäre keine Zahl, sondern eine Division durch null.
   */
  requiredKv?: number;
  preset: PresetVerdict;
  /**
   * Gesamter Druckverlust über dem Thermostatventil [Pa] — Auslegungsdruck
   * des Ventils plus Drosselbedarf. Das ist die Zahl, die am Ventil ankommt,
   * und die Zahl, gegen die die Geräuschgrenze von 15 kPa (VdZ) zu prüfen ist.
   * Undefiniert, solange kein Auslegungsdruck übergeben wurde.
   */
  valvePressure?: number;
  /** Erforderlicher k_v des Ventils für `valvePressure` [m³/h]. */
  valveKv?: number;
  /**
   * Ventilautorität a_V = Δp_Ventil / (Δp_Ventil + Δp_Kreis) [-].
   * Unter 0,3 wird der Regelkreis instabil (hydraulischer-abgleich.de).
   */
  authority?: number;
  /** Urteil zur Autorität in Worten. */
  authorityNote?: 'gut' | 'grenzwertig' | 'zu klein' | 'unwirtschaftlich';
  /** Gewählte Voreinstellstufe aus dem Armaturenkatalog. */
  presetSelection?: PresetSelection;
  /** Ungünstigster Strang seiner Quelle. */
  worst: boolean;
  /** Das Ergebnis des Rechenkerns für diesen Strang. */
  path: PathResult;
  notes: BalanceNote[];
}

/** Der Abgleich einer Quelle — nur Stränge derselben Quelle liegen parallel. */
export interface SourceBalance {
  fixtureId: string;
  label: string;
  /** Zahl der versorgten Verbraucher. */
  consumers: number;
  /** Summe der Volumenströme [m³/h]. */
  flow: number;
  /** Verlust des ungünstigsten Strangs [Pa]. */
  worstLoss: number;
  /** Verlust des günstigsten Strangs [Pa]. */
  bestLoss: number;
  /** Unterschied zwischen beiden [Pa] — so viel ist am kurzen Weg zu vernichten. */
  lossSpread: number;
  /** Verhältnis ungünstigster zu günstigster Strang [-]. */
  lossRatio: number;
}

export interface BalanceReport {
  consumers: ConsumerBalance[];
  /** Jeder Abschnitt des Netzes einmal, mit Ist- und Soll-Dimension. */
  segments: SegmentSizingCheck[];
  sources: SourceBalance[];
  /** Summe der Volumenströme aller Verbraucher [m³/h]. */
  totalFlow: number;
  /** Summe der angesetzten Leistungen [kW]. */
  totalPower: number;
  /** Angesetzte Spreizung [K]. */
  spread: number;
  /** Angesetzte Stoffwerte. */
  fluid: FluidProperties;
  /** Angesetzter Werkstoff. */
  material: PipeMaterial;
  /** Ungünstigster Strang des ganzen Netzes. */
  worst?: { fixtureId: string; label: string; loss: number; lossKpa: number };
  /** Günstigster Strang des ganzen Netzes. */
  best?: { fixtureId: string; label: string; loss: number; lossKpa: number };
  /** Unterschied zwischen beiden [Pa]. */
  lossSpread: number;
  /** Verhältnis ungünstigster zu günstigster Strang [-]; 1 = bereits abgeglichen. */
  lossRatio: number;
  /** Stränge, deren Drosselbedarf unter der Einstellgrenze liegt. */
  notAdjustable: number;
  /** Stränge, deren Drosselbedarf den Voreinstellbereich übersteigt. */
  beyondPreset: number;
  /** Abschnitte mit zu kleiner gezeichneter Nennweite. */
  undersized: number;
  /** Abschnitte, die kleiner ausgeführt werden könnten. */
  oversized: number;
  /** Abschnitte, deren Nennweite in der Werkstoffreihe nicht vorkam. */
  dimensionGuesses: number;
  /** Pumpenauslegung über alle Stränge. */
  pump: PumpDesign;
  notes: BalanceNote[];
}

// ===========================================================================
// 5 — Adapter Geometrie → Last
// ===========================================================================

/** Objekte in eine Nachschlagekarte bringen, egal wie sie hereinkommen. */
function fixtureMap(input: BalanceInput): Map<string, Fixture> {
  const source = input.fixtures;
  if (!source) return new Map();
  const list = Array.isArray(source) ? source : Object.values(source);
  return new Map(list.map((f) => [f.id, f]));
}

/**
 * Kennung eines Abschnitts im Netz.
 *
 * Die Wege aller Verbraucher einer Quelle bilden einen Baum. Zwei Verbraucher
 * teilen sich ein Rohrstück genau dann, wenn ihre Abschnittsfolge von der
 * Quelle an bis dorthin übereinstimmt. Deshalb ist der **kumulierte** Weg die
 * Kennung und nicht die Leitungsnummer: eine gezeichnete Leitung zerfällt in
 * viele Abschnitte, und dieselbe Leitung kann in mehreren Ästen vorkommen.
 *
 * Die Kennung schließt die Quelle ein, weil Stränge verschiedener Verteiler
 * hydraulisch nichts miteinander zu tun haben.
 */
function segmentKey(previous: string, segment: PipeSegment): string {
  return `${previous}>${segment.runId}@${segment.length.toFixed(2)}`;
}

/** Sammelmappe eines Abschnitts über alle Verbraucher, die ihn benutzen. */
interface SegmentAggregate {
  key: string;
  segment: PipeSegment;
  /** Summierter Volumenstrom [m³/h]. */
  flow: number;
  consumers: number;
}

/**
 * Volumenstrom eines Verbrauchers [m³/h] aus Leistung und Spreizung.
 *
 * V̇ = Q / (ρ·c_p·Δϑ) über `hydraulics.volumeFlow` — bewusst nicht über die
 * Kurzformel mit 0,86, weil die bei Glykol um 12 % danebenliegt.
 *
 * @param power Leistung [W]
 * @param spread Spreizung [K]
 */
function consumerFlow(power: number, spread: number, fluid: FluidProperties): number {
  if (!(power > 0) || !(spread > 0)) return 0;
  return volumeFlow(power / 1000, spread, fluid);
}

/**
 * Leistung eines Verbrauchers [W] ermitteln — und offenlegen, woher sie kommt.
 *
 * Reihenfolge: ausdrückliche Übergabe, dann das Objekt selbst, dann die
 * Vorbelegung der Symbolbibliothek, dann `fallbackPower`. Die letzten beiden
 * setzen `assumed`, damit im Bericht steht, dass hier nicht gerechnet, sondern
 * geraten wurde. Eine stillschweigende 0 gibt es nicht: sie sähe aus wie ein
 * Verbraucher ohne Bedarf und würde den ganzen Strang aus der Auslegung
 * nehmen.
 */
function consumerPower(
  path: PipePath,
  fixture: Fixture | undefined,
  input: BalanceInput,
): { power: number; assumed: boolean } {
  const given = input.powerByFixture?.[path.fixtureId];
  if (given !== undefined && Number.isFinite(given) && given > 0) return { power: given, assumed: false };

  const own = fixture?.params.powerW;
  if (own !== undefined && Number.isFinite(own) && own > 0) return { power: own, assumed: false };

  const byType = DEFAULT_POWER_BY_TYPE[path.fixtureType];
  if (byType !== undefined && byType > 0) return { power: byType, assumed: true };

  return { power: input.fallbackPower ?? FALLBACK_POWER, assumed: true };
}

/**
 * Aus einem Weg im Netz die Lastbeschreibung bauen, die `hydraulics` erwartet.
 *
 * **Die drei Übersetzungen, die hier passieren:**
 *
 *  1. Nennweite → Dimension über `dimensionForDn` (siehe die Warnung dort).
 *  2. Trassenlänge → abgerechnete Länge: `bothWays` verdoppelt sie, weil der
 *     Rücklauf dieselbe Strecke zurückläuft. `PipePath.circuitLength` sagt
 *     dasselbe und dient als Gegenprobe.
 *  3. Gezeichneter Knick → Formstück: je Abschnitt ein Bogen, siehe
 *     `DEFAULT_SEGMENT_ZETA`.
 *
 * **Was hier bewusst nicht passiert:** der Höhenversatz aus
 * `PipePath.elevationChange` geht nicht in den Druckverlust ein. Im
 * geschlossenen Kreis hebt sich die statische Höhe zwischen Vor- und Rücklauf
 * exakt auf — sie zählt für den Anlagendruck und das Ausdehnungsgefäß, nicht
 * für die Pumpe.
 *
 * @param flowOf Volumenstrom je Abschnittskennung [m³/h]
 */
/**
 * Rohrdimension eines Abschnitts — mit Vorrang für das, was am Modell steht.
 *
 * Der Rohrausleger schreibt Werkstoff und Außendurchmesser an jede erzeugte
 * Leitung. Wer sie ignoriert und stattdessen aus der Nennweite eine Dimension
 * schätzt, rechnet ein anderes Rohr nach, als er gezeichnet hat. Erst wenn am
 * Abschnitt nichts steht — von Hand gezeichnete Leitungen, Importe — greift
 * die Schätzung über `dimensionForDn`.
 */
function segmentDimension(segment: PipeSegment, fallback: PipeMaterial): DimensionMatch {
  const werkstoff = segment.material ?? fallback;
  if (segment.material && segment.outerDiameter && segment.outerDiameter > 0) {
    const reihe = PIPE_TABLES[segment.material];
    // Der Außendurchmesser ist eindeutig, die Nennweite ist es nicht. Gesucht
    // wird die Abmessung, deren Außenmaß am besten passt — mit einer engen
    // Schranke, damit eine unpassende Zahl nicht stillschweigend gerundet wird.
    let treffer: PipeDimension | undefined;
    let abstand = Infinity;
    for (const d of reihe) {
      const delta = Math.abs(d.outer - segment.outerDiameter);
      if (delta < abstand) {
        abstand = delta;
        treffer = d;
      }
    }
    if (treffer && abstand <= 0.6) {
      return { dn: segment.nominalDiameter, dimension: treffer, exact: true, roundedUp: false, ambiguous: false };
    }
  }
  return dimensionForDn(segment.nominalDiameter, werkstoff);
}

/**
 * Formstücke eines Abschnitts.
 *
 * Zwei Quellen: die **Bögen**, die sich aus den Richtungswechseln der
 * gezeichneten Polylinie ergeben, und die **Armaturen**, die tatsächlich auf
 * dem Abschnitt sitzen. Trägt der Abschnitt keine dieser Angaben — alte
 * Dokumente, von Hand gezeichnete Leitungen —, bleibt es beim pauschalen
 * ζ je Abschnitt; das ist dieselbe Rechnung wie bisher und damit kein
 * Rückschritt, nur keine Verbesserung.
 */
function segmentFittings(
  segment: PipeSegment,
  fallbackZeta: number,
): { fittings: FittingCount[]; zetaSum: number } {
  const hatAngaben = segment.bends !== undefined || segment.accessories !== undefined;
  if (!hatAngaben) return { fittings: [], zetaSum: fallbackZeta };

  const zaehler = new Map<string, number>();
  if (segment.bends && segment.bends > 0) zaehler.set('bogen-90', segment.bends);
  for (const kind of segment.accessories ?? []) {
    const id = ACCESSORY_FITTING[kind];
    if (!id) continue;
    zaehler.set(id, (zaehler.get(id) ?? 0) + 1);
  }
  const fittings: FittingCount[] = [...zaehler.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([id, count]) => ({ id, count }));
  return { fittings, zetaSum: 0 };
}

function pathLoad(
  path: PipePath,
  flowOf: Map<string, number>,
  sourceKeys: Map<string, string[]>,
  input: BalanceInput,
  material: PipeMaterial,
): { load: PipePathLoad; matches: DimensionMatch[] } {
  const zeta = input.zetaPerSegment ?? DEFAULT_SEGMENT_ZETA;
  const keys = sourceKeys.get(path.fixtureId) ?? [];
  const matches: DimensionMatch[] = [];

  const segments: PipeSegmentLoad[] = path.segments.map((segment, index) => {
    const match = segmentDimension(segment, material);
    matches.push(match);
    const key = keys[index] ?? '';
    const { fittings, zetaSum } = segmentFittings(segment, zeta);
    return {
      label: `${PIPE_SERVICE_LABELS[segment.service]} DN ${de(segment.nominalDiameter)}`,
      flow: flowOf.get(key) ?? 0,
      length: segment.length,
      bothWays: true,
      dimension: match.dimension,
      fittings,
      zetaSum,
      condition: input.condition,
    };
  });

  const terminalLoss =
    input.terminalLossByFixture?.[path.fixtureId] ?? input.terminalLoss ?? 0;

  return {
    load: {
      id: path.fixtureId,
      label: path.label,
      segments,
      terminalLoss,
      terminalLabel: path.label,
    },
    matches,
  };
}

// ===========================================================================
// 6 — Der Abgleich
// ===========================================================================

/**
 * Erforderlicher k_v-Wert eines Drosselventils [m³/h bei 1 bar].
 *
 *     k_v = V̇ / √(Δp / 1 bar)
 *
 * Die Definition ist eine Festlegung, keine Näherung: der k_v-Wert **ist** der
 * Volumenstrom in m³/h, der bei 1 bar Druckabfall durch die Armatur läuft.
 * Aus der quadratischen Kennlinie Δp = (V̇/k_v)²·1 bar folgt die Umkehrung
 * unmittelbar. Kleinerer k_v heißt stärkere Drosselung.
 *
 * @param flow Volumenstrom [m³/h]
 * @param pressure Zu vernichtender Druck [Pa]
 * @returns k_v [m³/h]; undefiniert, wenn nichts zu drosseln ist oder nichts fließt
 */
export function requiredKv(flow: number, pressure: number): number | undefined {
  if (!(flow > 0) || !(pressure > 0)) return undefined;
  const bar = pressure / 1e5;
  return round(flow / Math.sqrt(bar), 3);
}

/** Einordnung des Drosselbedarfs. */
function presetVerdict(
  worst: boolean,
  flow: number,
  throttle: number,
  minPreset: number,
  maxPreset: number,
): PresetVerdict {
  if (!(flow > 0)) return 'ohne-volumenstrom';
  if (worst || throttle <= 0) return 'ungedrosselt';
  if (throttle < minPreset) return 'unterhalb-einstellgrenze';
  if (throttle > maxPreset) return 'oberhalb-einstellbereich';
  return 'einstellbar';
}

/**
 * Hydraulischer Abgleich eines gezeichneten Netzes.
 *
 * Ablauf, in dieser Reihenfolge und aus diesem Grund:
 *
 *  1. **Volumenströme je Verbraucher** aus Leistung und Spreizung.
 *  2. **Teilströme je Abschnitt** durch Summierung aller dahinterliegenden
 *     Verbraucher. Ohne diesen Schritt bekäme die Sammelleitung den
 *     Volumenstrom eines einzelnen Heizkörpers und wäre um Größenordnungen zu
 *     günstig gerechnet. Ein Gleichzeitigkeitsfaktor wird **nicht** angesetzt:
 *     in der Heizung laufen am Auslegungspunkt alle Verbraucher gleichzeitig.
 *  3. **Druckverlust je Strang** über `evaluatePath`.
 *  4. **Abgleich je Quelle.** Stränge verschiedener Verteiler liegen nicht
 *     parallel; sie miteinander zu vergleichen ergäbe Drosselwerte, die keine
 *     Armatur einstellen kann.
 *  5. **Nachdimensionierung** je Abschnitt gegen den summierten Teilstrom.
 *  6. **Pumpe** über alle Stränge — `designPump` sucht den ungünstigsten.
 *
 * Grenzfälle, die hier ohne Absturz durchlaufen: leeres Netz, Verbraucher ohne
 * Weg zur Quelle, Volumenstrom null, gleich lange Stränge, ein einziger
 * Verbraucher, mehrere Quellen.
 */
export function balanceNetwork(input: BalanceInput): BalanceReport {
  const fluid = input.fluid ?? DEFAULT_FLUID;
  const material = input.material ?? 'kupfer';
  const spread = input.spread ?? DEFAULT_SPREAD;
  const minPreset = input.minPresetPressure ?? MIN_PRESET_PRESSURE;
  const maxPreset = input.maxPresetPressure ?? MAX_PRESET_PRESSURE;
  const maxVelocity = input.maxVelocity ?? DEFAULT_SIZING_LIMITS.maxVelocity;
  const maxGradient = input.maxGradient ?? DEFAULT_SIZING_LIMITS.maxGradient;
  const types = input.consumerTypes ?? HEATING_CONSUMER_TYPES;
  const thermostatPressure = input.thermostatPressure ?? 0;
  const valveModelId = input.valveModelId ?? DEFAULT_MODEL_BY_ROLE.thermostat;
  const notes: BalanceNote[] = [];
  const fixtures = fixtureMap(input);

  const allPaths = input.network.paths ?? [];
  const paths = allPaths.filter((p) => types.includes(p.fixtureType));
  const skipped = allPaths.length - paths.length;

  // --- 1: Leistung und Volumenstrom je Verbraucher ------------------------
  interface Prepared {
    path: PipePath;
    power: number;
    powerAssumed: boolean;
    flow: number;
  }
  const prepared: Prepared[] = paths.map((path) => {
    const { power, assumed } = consumerPower(path, fixtures.get(path.fixtureId), input);
    return { path, power, powerAssumed: assumed, flow: consumerFlow(power, spread, fluid) };
  });

  // --- 2: Teilströme je Abschnitt -----------------------------------------
  const aggregates = new Map<string, SegmentAggregate>();
  const keysOfPath = new Map<string, string[]>();
  for (const item of prepared) {
    let cursor = item.path.sourceFixtureId;
    const keys: string[] = [];
    for (const segment of item.path.segments) {
      cursor = segmentKey(cursor, segment);
      keys.push(cursor);
      const known = aggregates.get(cursor);
      if (known) {
        known.flow += item.flow;
        known.consumers += 1;
      } else {
        aggregates.set(cursor, { key: cursor, segment, flow: item.flow, consumers: 1 });
      }
    }
    keysOfPath.set(item.path.fixtureId, keys);
  }
  const flowOf = new Map<string, number>();
  for (const [key, aggregate] of aggregates) flowOf.set(key, aggregate.flow);

  // --- 3: Druckverlust je Strang ------------------------------------------
  let dimensionGuesses = 0;
  const loads: PipePathLoad[] = [];
  const results = new Map<string, PathResult>();
  for (const item of prepared) {
    const { load, matches } = pathLoad(item.path, flowOf, keysOfPath, input, material);
    dimensionGuesses += matches.filter((m) => !m.exact).length;
    loads.push(load);
    results.set(item.path.fixtureId, evaluatePath(load, fluid));
  }

  // --- 4: Abgleich je Quelle ----------------------------------------------
  const worstOfSource = new Map<string, { id: string; loss: number }>();
  const bestOfSource = new Map<string, { id: string; loss: number }>();
  for (const item of prepared) {
    const result = results.get(item.path.fixtureId);
    if (!result) continue;
    const source = item.path.sourceFixtureId;
    const worst = worstOfSource.get(source);
    if (!worst || result.loss > worst.loss) worstOfSource.set(source, { id: item.path.fixtureId, loss: result.loss });
    const best = bestOfSource.get(source);
    if (!best || result.loss < best.loss) bestOfSource.set(source, { id: item.path.fixtureId, loss: result.loss });
  }

  const consumers: ConsumerBalance[] = [];
  for (const item of prepared) {
    const path = item.path;
    const result = results.get(path.fixtureId);
    if (!result) continue;
    const reference = worstOfSource.get(path.sourceFixtureId);
    const isWorst = reference?.id === path.fixtureId;
    // Der Drosseldruck ist der Rest zum ungünstigsten Strang derselben Quelle.
    // Beim ungünstigsten selbst ist er null — er ist das Maß, nicht das Ziel.
    const throttle = Math.max(0, (reference?.loss ?? result.loss) - result.loss);
    const preset = presetVerdict(isWorst, item.flow, throttle, minPreset, maxPreset);
    const kv = requiredKv(item.flow, throttle);
    const own: BalanceNote[] = [];

    // --- Ventil: Autorität und Voreinstellstufe ---------------------------
    // Das Ventil vernichtet zweierlei: seinen Auslegungsdruck (den es braucht,
    // damit es überhaupt regeln kann) und den Drosselbedarf gegenüber dem
    // ungünstigsten Strang. Beides zusammen steht am Ventil an.
    let valvePressure: number | undefined;
    let valveKv: number | undefined;
    let authority: number | undefined;
    let authorityNote: ReturnType<typeof authorityVerdict> | undefined;
    let presetSelection: PresetSelection | undefined;
    if (thermostatPressure > 0 && item.flow > 0) {
      valvePressure = thermostatPressure + throttle;
      valveKv = round(catalogKv(item.flow, valvePressure, fluid.density), 3);
      // Der Nenner ist der Kreis **ohne** das Ventil: `result.loss` enthält
      // Rohre, Formstücke und Heizfläche, aber nicht den Ventildruck.
      authority = round(valveAuthority(valvePressure, result.loss), 3);
      authorityNote = authorityVerdict(authority);
      const modell = findValveModel(valveModelId) ?? modelFor('thermostat', path.minimumDiameter || 15);
      if (modell) presetSelection = selectPreset(valveKv, modell, item.flow, fluid.density);

      if (valvePressure > MAX_THERMOSTAT_PRESSURE) {
        own.push({
          severity: 'warn',
          text:
            `Am Thermostatventil stehen ${de(round(valvePressure / 1000, 1))} kPa an. Der VdZ-Leitfaden nennt ` +
            `${de(MAX_THERMOSTAT_PRESSURE / 1000)} kPa als Grenze zur Vermeidung von Strömungsgeräuschen — und ` +
            'zwar im Teillastfall, in dem der Wert noch steigt. Hier gehört ein Strangregulierventil oder ein ' +
            'Differenzdruckregler davor.',
        });
      }
      if (authority !== undefined && authority < MIN_VALVE_AUTHORITY && !isWorst) {
        own.push({
          severity: 'warn',
          text:
            `Ventilautorität a_V = ${de(round(authority, 2))}. Unter ${de(MIN_VALVE_AUTHORITY)} verformt sich die ` +
            'Grundkennlinie so stark, dass der Kreis in den Auf-Zu-Betrieb kippen kann (Fachliteratur, kein Normwert). ' +
            'Abhilfe: Ventil mit kleinerem Grund-k_v, damit sich eine größere Voreinstellung ergibt.',
        });
      }
      if (presetSelection && presetSelection.fit !== 'passt') {
        own.push({
          severity: 'warn',
          text:
            presetSelection.fit === 'ueber-bereich'
              ? `Erforderlich ist k_v = ${de(round(valveKv, 2))}; die größte Stufe von ${presetSelection.model.label} ` +
                `liefert nur ${de(presetSelection.kv)}. Das Ventil ist zu klein — eine Nennweite größer wählen.`
              : `Erforderlich ist k_v = ${de(round(valveKv, 2))}; die kleinste Stufe von ${presetSelection.model.label} ` +
                `liefert bereits ${de(presetSelection.kv)}. Das Ventil kann nicht so weit drosseln.`,
        });
      }
    }

    if (item.powerAssumed) {
      own.push({
        severity: 'warn',
        text:
          `Für „${path.label}“ ist keine Leistung hinterlegt. Gerechnet wird mit der Vorbelegung ` +
          `${Math.round(item.power)} W; Volumenstrom und Voreinstellung sind damit eine Schätzung.`,
      });
    }
    if (!(item.flow > 0)) {
      own.push({
        severity: 'error',
        text:
          `„${path.label}“ führt keinen Volumenstrom (Leistung ${Math.round(item.power)} W, Spreizung ` +
          `${de(round(spread, 1))} K). Ohne Volumenstrom gibt es weder Druckverlust noch Voreinstellwert.`,
      });
    }
    if (preset === 'unterhalb-einstellgrenze') {
      own.push({
        severity: 'warn',
        text:
          `Abzudrosseln sind nur ${de(round(throttle / 1000, 2))} kPa. Unterhalb von etwa ` +
          `${de(round(minPreset / 1000, 1))} kPa ist die Voreinstellung an einem Thermostatventil nicht sicher ` +
          'darstellbar (Erfahrungswert). Der Strang läuft praktisch ungedrosselt.',
      });
    }
    if (preset === 'oberhalb-einstellbereich') {
      own.push({
        severity: 'warn',
        text:
          `Abzudrosseln sind ${de(round(throttle / 1000, 1))} kPa — mehr, als der übliche Voreinstellbereich ` +
          `bis etwa ${de(round(maxPreset / 1000, 0))} kPa hergibt (Erfahrungswert). Hier gehört ein ` +
          'Strangregulierventil hin oder eine kleinere Rohrdimension im kurzen Ast.',
      });
    }
    for (const text of result.warnings) own.push({ severity: 'warn', text });

    consumers.push({
      fixtureId: path.fixtureId,
      fixtureType: path.fixtureType,
      label: path.label,
      levelId: path.levelId,
      roomId: path.roomId,
      sourceFixtureId: path.sourceFixtureId,
      sourceLabel: path.sourceLabel,
      power: round(item.power, 1),
      powerAssumed: item.powerAssumed,
      flow: round(item.flow, 4),
      routeLength: path.routeLength,
      circuitLength: result.length,
      minimumDiameter: path.minimumDiameter,
      ownLoss: result.loss,
      ownLossKpa: round(result.loss / 1000, 2),
      throttle: round(throttle, 1),
      throttleKpa: round(throttle / 1000, 2),
      requiredKv: kv,
      preset,
      valvePressure: valvePressure === undefined ? undefined : round(valvePressure, 1),
      valveKv,
      authority,
      authorityNote,
      presetSelection,
      worst: isWorst,
      path: result,
      notes: own,
    });
  }
  consumers.sort((a, b) => b.ownLoss - a.ownLoss);

  // --- 5: Nachdimensionierung je Abschnitt --------------------------------
  const segments: SegmentSizingCheck[] = [];
  let undersized = 0;
  let oversized = 0;
  for (const aggregate of aggregates.values()) {
    const check = checkSegment(aggregate, material, fluid, {
      maxVelocity,
      maxGradient,
      condition: input.condition,
    });
    if (check.verdict === 'zu klein') undersized += 1;
    if (check.verdict === 'unnötig groß') oversized += 1;
    segments.push(check);
  }
  segments.sort((a, b) => b.flow - a.flow);

  // --- 6: Pumpe -----------------------------------------------------------
  // Förderstrom ist die Summe der Verbraucher der **größten** Quelle, nicht die
  // Summe über alle: mehrere Verteiler sind mehrere Pumpen.
  const flowPerSource = new Map<string, number>();
  for (const item of prepared) {
    flowPerSource.set(item.path.sourceFixtureId, (flowPerSource.get(item.path.sourceFixtureId) ?? 0) + item.flow);
  }
  const pumpFlow = Math.max(0, ...flowPerSource.values());
  const pump = designPump(loads, fluid, {
    flow: pumpFlow,
    generatorLoss: input.generatorLoss,
    safetyFactor: input.safetyFactor,
    availableHead: input.availableHead,
  });

  // --- Kennzahlen und Meldungen -------------------------------------------
  const sources: SourceBalance[] = [...flowPerSource.keys()].map((id) => {
    const worst = worstOfSource.get(id);
    const best = bestOfSource.get(id);
    const worstLoss = worst?.loss ?? 0;
    const bestLoss = best?.loss ?? 0;
    const label = prepared.find((p) => p.path.sourceFixtureId === id)?.path.sourceLabel ?? id;
    return {
      fixtureId: id,
      label,
      consumers: prepared.filter((p) => p.path.sourceFixtureId === id).length,
      flow: round(flowPerSource.get(id) ?? 0, 4),
      worstLoss: round(worstLoss, 1),
      bestLoss: round(bestLoss, 1),
      lossSpread: round(worstLoss - bestLoss, 1),
      lossRatio: bestLoss > 0 ? round(worstLoss / bestLoss, 2) : 0,
    };
  });

  const ranked = [...consumers];
  const worstOverall = ranked[0];
  const bestOverall = ranked[ranked.length - 1];
  const lossSpread = worstOverall && bestOverall ? worstOverall.ownLoss - bestOverall.ownLoss : 0;
  const lossRatio = worstOverall && bestOverall && bestOverall.ownLoss > 0
    ? round(worstOverall.ownLoss / bestOverall.ownLoss, 2)
    : 0;

  const notAdjustable = consumers.filter((c) => c.preset === 'unterhalb-einstellgrenze').length;
  const beyondPreset = consumers.filter((c) => c.preset === 'oberhalb-einstellbereich').length;
  const totalFlow = prepared.reduce((sum, p) => sum + p.flow, 0);
  const totalPower = prepared.reduce((sum, p) => sum + p.power, 0) / 1000;

  collectNotes(notes, {
    input,
    consumers,
    sources,
    prepared: prepared.length,
    skipped,
    lossSpread,
    lossRatio,
    notAdjustable,
    beyondPreset,
    undersized,
    oversized,
    dimensionGuesses,
    material,
    fluid,
    minPreset,
  });

  return {
    consumers,
    segments,
    sources,
    totalFlow: round(totalFlow, 4),
    totalPower: round(totalPower, 3),
    spread,
    fluid,
    material,
    worst: worstOverall
      ? {
          fixtureId: worstOverall.fixtureId,
          label: worstOverall.label,
          loss: worstOverall.ownLoss,
          lossKpa: worstOverall.ownLossKpa,
        }
      : undefined,
    best: bestOverall
      ? {
          fixtureId: bestOverall.fixtureId,
          label: bestOverall.label,
          loss: bestOverall.ownLoss,
          lossKpa: bestOverall.ownLossKpa,
        }
      : undefined,
    lossSpread: round(lossSpread, 1),
    lossRatio,
    notAdjustable,
    beyondPreset,
    undersized,
    oversized,
    dimensionGuesses,
    pump,
    notes,
  };
}

// ===========================================================================
// 7 — Nachdimensionierung eines Abschnitts
// ===========================================================================

/**
 * Trägt die gezeichnete Nennweite den Volumenstrom, den sie tragen muss?
 *
 * Verglichen werden Ist-Dimension und die kleinste Dimension, die
 * Geschwindigkeit und Druckgefälle einhält (`sizePipe`). Das Urteil folgt
 * daraus:
 *
 *  • **zu klein** — die Ist-Dimension reißt eine der beiden Grenzen. Das ist
 *    hörbar (Geschwindigkeit) oder teuer (Druckgefälle).
 *  • **unnötig groß** — es gäbe eine kleinere Dimension, die beide Grenzen
 *    einhält. Kein Fehler, aber Material, Platz und Wasserinhalt.
 *  • **passt** — die gezeichnete Dimension ist genau die, die man auslegen
 *    würde.
 *  • **unbewertet** — ohne Volumenstrom lässt sich nichts sagen. Das ist kein
 *    Mangel des Abschnitts, sondern eine fehlende Leistungsangabe dahinter.
 *
 * Die Grenzwerte sind Planungsentscheidungen aus `DEFAULT_SIZING_LIMITS`,
 * keine Normwerte — die Begründung steht dort.
 */
function checkSegment(
  aggregate: SegmentAggregate,
  material: PipeMaterial,
  fluid: FluidProperties,
  limits: { maxVelocity: number; maxGradient: number; condition?: PipeCondition },
): SegmentSizingCheck {
  const segment = aggregate.segment;
  // Dieselbe Zuordnung wie im Druckverlust. Stünde hier `dimensionForDn`,
  // rechnete derselbe Bericht eine Teilstrecke einmal in Verbund (Druckverlust)
  // und einmal in Kupfer (Urteil „passt / zu klein") — zwei Zahlen über
  // dasselbe Rohr, die sich widersprechen.
  const drawn = segmentDimension(segment, material);
  // Verglichen wird gegen den Werkstoff, der tatsächlich verlegt ist: ein
  // Verbundrohr durch eine Kupferreihe nachzudimensionieren ergibt eine
  // Empfehlung, die es im Regal nicht gibt.
  const werkstoff = segment.material ?? material;
  const state = flowState(aggregate.flow, drawn.dimension, fluid, { condition: limits.condition });
  const sizing = sizePipe(aggregate.flow, {
    material: werkstoff,
    fluid,
    condition: limits.condition,
    maxVelocity: limits.maxVelocity,
    maxGradient: limits.maxGradient,
  });

  let verdict: SegmentVerdict;
  let note: string | undefined;
  if (!(aggregate.flow > 0)) {
    verdict = 'unbewertet';
    note = 'Kein Volumenstrom hinter diesem Abschnitt — die Verbraucher dahinter haben keine Leistung.';
  } else if (state.velocity > limits.maxVelocity || state.gradient > limits.maxGradient) {
    verdict = 'zu klein';
    note =
      `${de(round(state.velocity, 2))} m/s und ${Math.round(state.gradient)} Pa/m gegenüber den Grenzen ` +
      `${de(limits.maxVelocity)} m/s und ${de(limits.maxGradient)} Pa/m. Vorschlag: ${sizing.dimension.label}.`;
  } else if (sizing.dimension.inner < drawn.dimension.inner) {
    verdict = 'unnötig groß';
    note =
      `${sizing.dimension.label} würde die Grenzen ebenfalls einhalten ` +
      `(${de(round(sizing.velocity, 2))} m/s, ${Math.round(sizing.gradient)} Pa/m).`;
  } else {
    verdict = 'passt';
  }

  if (sizing.warning) note = note ? `${note} ${sizing.warning}` : sizing.warning;
  if (drawn.note) note = note ? `${note} ${drawn.note}` : drawn.note;

  return {
    key: aggregate.key,
    runId: segment.runId,
    service: segment.service,
    label: `${PIPE_SERVICE_LABELS[segment.service]} DN ${de(segment.nominalDiameter)}`,
    consumers: aggregate.consumers,
    length: round(segment.length, 3),
    flow: round(aggregate.flow, 4),
    drawnDn: segment.nominalDiameter,
    drawn,
    velocity: state.velocity,
    gradient: state.gradient,
    proposed: sizing.dimension,
    proposedReason: sizing.reason,
    verdict,
    note,
  };
}

// ===========================================================================
// 8 — Bewertung des Netzes
// ===========================================================================

interface NoteContext {
  input: BalanceInput;
  consumers: ConsumerBalance[];
  sources: SourceBalance[];
  prepared: number;
  skipped: number;
  lossSpread: number;
  lossRatio: number;
  notAdjustable: number;
  beyondPreset: number;
  undersized: number;
  oversized: number;
  dimensionGuesses: number;
  material: PipeMaterial;
  fluid: FluidProperties;
  minPreset: number;
}

/**
 * Die Meldungen des Berichts.
 *
 * Getrennt geführt, weil die Bewertung eines Netzes eine andere Frage ist als
 * seine Berechnung: hier steht, was ein Planer beim Durchsehen wissen muss,
 * und zwar in der Reihenfolge, in der es ihn interessiert — erst, ob überhaupt
 * etwas zu rechnen war, dann die Annahmen, dann das Ergebnis.
 */
/**
 * Bauart eines TGA-Objekts, leer wenn unbekannt.
 *
 * `BalanceInput.fixtures` nimmt beide Formen an — Record aus dem Store,
 * Liste aus einem Export. Beide werden hier auf dieselbe Frage reduziert.
 */
function fixtureTypeOf(input: BalanceInput, fixtureId: string | undefined): string {
  if (!fixtureId || !input.fixtures) return '';
  const list = Array.isArray(input.fixtures) ? input.fixtures : Object.values(input.fixtures);
  return list.find((f) => f.id === fixtureId)?.type ?? '';
}

function collectNotes(notes: BalanceNote[], context: NoteContext): void {
  const { input, consumers } = context;
  const unconnected = input.network.unconnected ?? [];

  if (consumers.length === 0) {
    notes.push({
      severity: 'error',
      text:
        'Kein anzuschließender Verbraucher im Netz. Ohne Verbraucher gibt es keinen Abgleich — ' +
        'zu prüfen ist, ob Heizflächen gesetzt und an eine Leitung angebunden sind.',
    });
  }

  // Gemeldet wird nur, was in diesen Abgleich gehört. Ein Zuluftventil ohne
  // Kanal ist ein Befund der Lüftungsprüfung, nicht des hydraulischen
  // Abgleichs — hier stünde er als Fehler, den niemand hier beheben kann.
  const heatingUnconnected = unconnected.filter((entry) =>
    HEATING_CONSUMER_TYPES.includes(fixtureTypeOf(input, entry.fixtureId)),
  );
  for (const entry of heatingUnconnected.slice(0, 5)) {
    notes.push({
      severity: 'error',
      text: `„${entry.label}“ hängt an keiner Quelle (${entry.reason}) und ist im Abgleich nicht enthalten.`,
    });
  }
  if (heatingUnconnected.length > 5) {
    notes.push({
      severity: 'error',
      text: `Insgesamt ${heatingUnconnected.length} Heizflächen ohne Weg zu einer Quelle — nur die ersten fünf sind einzeln genannt.`,
    });
  }
  const others = unconnected.length - heatingUnconnected.length;
  if (others > 0) {
    notes.push({
      severity: 'info',
      text: `${others} nicht angeschlossene Objekte aus Sanitär und Lüftung bleiben hier außen vor; sie stehen im Prüfbericht.`,
    });
  }

  if (context.skipped > 0) {
    notes.push({
      severity: 'info',
      text:
        `${context.skipped} angeschlossene Objekte sind keine Heizflächen und bleiben außen vor. ` +
        'Trinkwasser und Lüftung werden nicht über Leistung und Spreizung abgeglichen, sondern über ihre ' +
        'eigenen Verfahren.',
    });
  }

  const assumed = consumers.filter((c) => c.powerAssumed).length;
  if (assumed > 0) {
    notes.push({
      severity: 'warn',
      text:
        `Bei ${assumed} von ${consumers.length} Verbrauchern ist keine Leistung hinterlegt; dort greift die ` +
        'Vorbelegung. Volumenströme, Voreinstellwerte und Pumpenauslegung sind insoweit eine Schätzung.',
    });
  }

  if (context.dimensionGuesses > 0) {
    notes.push({
      severity: 'warn',
      text:
        `${context.dimensionGuesses} Abschnitte tragen eine Nennweite, die in der Reihe ` +
        `${PIPE_MATERIAL_LABELS[context.material]} nicht vorkommt. Dort wurde auf die nächstgrößere Dimension ` +
        'aufgerundet — der Druckverlust fällt zu günstig aus. Der Werkstoff ist eine Annahme dieses Moduls und ' +
        'keine Angabe der Zeichnung.',
    });
  }

  const terminal = input.terminalLoss ?? 0;
  if (terminal <= 0 && !input.terminalLossByFixture && consumers.length > 0) {
    notes.push({
      severity: 'warn',
      text:
        'Für die Heizflächen selbst ist kein Druckverlust angesetzt (Ventilunterteil, Heizkörper, ' +
        'Fußbodenkreis). Damit fehlt dem ungünstigsten Strang sein größter Einzelposten, und der ' +
        'Drosselbedarf der übrigen Stränge fällt zu klein aus. Bei Fußbodenheizung ist der Kreis der ' +
        'Druckverlust — Rohrleitung bis zum Verteiler ist dagegen ein Nebenposten.',
    });
  }

  if (consumers.length === 1) {
    notes.push({
      severity: 'info',
      text:
        'Ein einziger Verbraucher: es gibt nichts abzugleichen. Der Strang bestimmt die Pumpe allein; ' +
        'eine Voreinstellung ist nur dann sinnvoll, wenn die Pumpe nicht kleiner gefahren werden kann.',
    });
  }

  if (context.sources.length > 1) {
    notes.push({
      severity: 'info',
      text:
        `${context.sources.length} Quellen im Modell. Der Abgleich wurde je Quelle gerechnet — nur Stränge ` +
        'derselben Verteilung liegen parallel. Die Pumpenauslegung bezieht sich auf die Quelle mit dem ' +
        'größten Volumenstrom; für die übrigen ist eine eigene Pumpe zu betrachten.',
    });
  }

  if (consumers.length > 1 && context.lossSpread < context.minPreset) {
    notes.push({
      severity: 'info',
      text:
        `Alle Stränge liegen innerhalb von ${de(round(context.lossSpread / 1000, 2))} kPa beieinander. Das Netz ` +
        'ist von sich aus abgeglichen; Voreinstellwerte wären kleiner als die Streuung der Ventile.',
    });
  } else if (context.lossRatio > 3) {
    notes.push({
      severity: 'warn',
      text:
        `Der ungünstigste Strang verlangt das ${de(context.lossRatio)}-fache des günstigsten ` +
        `(${de(round(context.lossSpread / 1000, 1))} kPa Unterschied). Ohne Abgleich läuft das Wasser fast ` +
        'vollständig über die kurzen Wege.',
    });
  }

  if (context.notAdjustable > 0) {
    notes.push({
      severity: 'warn',
      text:
        `${context.notAdjustable} Stränge brauchen weniger als ${de(round(context.minPreset / 1000, 1))} kPa ` +
        'Drosselung. So wenig lässt sich an einem Thermostatventil nicht sicher einstellen (Erfahrungswert) — ' +
        'diese Stränge bleiben praktisch offen.',
    });
  }

  if (context.beyondPreset > 0) {
    notes.push({
      severity: 'error',
      text:
        `${context.beyondPreset} Stränge verlangen mehr Drosselung, als eine Ventilvoreinstellung hergibt. ` +
        'Die Voreinstellung allein reicht hier nicht: nötig sind Strangregulierventile, kleinere Nennweiten in ' +
        'den kurzen Ästen oder eine geringere Förderhöhe. Ein Ventil, das nur noch als Blende arbeitet, regelt ' +
        'die Raumtemperatur nicht mehr.',
    });
  }

  if (context.undersized > 0) {
    notes.push({
      severity: 'warn',
      text:
        `${context.undersized} Abschnitte sind für den Volumenstrom, den sie tragen, zu klein gezeichnet. ` +
        'Das kostet Förderhöhe an genau der Stelle, an der sie allen Verbrauchern dahinter fehlt.',
    });
  }
  if (context.oversized > 0) {
    notes.push({
      severity: 'info',
      text: `${context.oversized} Abschnitte könnten eine Nummer kleiner ausgeführt werden.`,
    });
  }

  for (const text of context.fluid.notes) notes.push({ severity: 'info', text });
}
