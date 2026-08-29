/**
 * Trinkwassererwärmung und Trinkwasserinstallation.
 * ---------------------------------------------------------------------------
 * **Warum es dieses Modul gibt.**
 *
 * Die Trinkwasserseite ist bei einer Wärmepumpenanlage der Punkt, an dem
 * Hygiene und Effizienz direkt gegeneinander stehen. Der Hygieniker will
 * hohe Temperaturen und keine Stagnation, die Arbeitszahl will das Gegenteil.
 * Diese Abwägung lässt sich nicht wegrechnen — aber sie lässt sich sichtbar
 * machen. Deshalb liefert jede Funktion hier nicht nur eine Zahl, sondern die
 * Rechenschritte und die Begründung, welcher Weg maßgebend geworden ist.
 *
 * **Was hier steht und was nicht.**
 *
 * Die Regelwerke der Trinkwasserinstallation sind teils frei (TrinkwV und GEG
 * sind Gesetzestexte), teils kostenpflichtig (DIN 4708, DIN 1988-200,
 * DIN 1988-300, DVGW W 551). Aus den kostenpflichtigen Texten wird hier
 * ausschließlich verwendet, was in Fachliteratur und Herstellerunterlagen
 * durchgängig frei zitiert wird — die Formelstruktur, die Grenzwerte
 * (400 l, 3 l, 60/55 °C) und die Berechnungsdurchflüsse der Entnahmestellen.
 *
 * Die eigentlichen Tabellenwerte — die Wärmebedarfskennzahlen der Zapfstellen
 * nach DIN 4708-2 und die Spitzendurchflusskurven nach DIN 1988-300 — stehen
 * NICHT in diesem Modul. An ihrer Stelle stehen überschreibbare Parameter mit
 * offengelegter Herkunft:
 *  • Die Zapfstellen-Wärmebedarfe sind **physikalisch hergeleitet**
 *    (w = V · c · Δϑ) aus einer angenommenen Zapfmenge, nicht abgeschrieben.
 *    Der Bezugswert der Einheitswohnung (3,5 Personen, Normalbadewanne,
 *    5820 Wh) ist frei zitiert und wird verwendet.
 *  • Die Spitzendurchflusskurven sind als Potenzfunktion
 *    V_S = a · (ΣV_R − b)^c + d parametriert. Die Vorbelegung ist eine
 *    Vorbelegung und keine Normangabe; sie ist vor der Ausführungsplanung
 *    gegen den Normtext zu ersetzen. Jede Auswertung, die auf einer nicht
 *    ersetzten Vorbelegung beruht, trägt eine Warnung.
 *
 * Grundlagen:
 *  • DIN 4708-1/-2 — Bedarfskennzahl N, Leistungskennzahl N_L
 *  • DIN 1988-200 — Zirkulation, 3-Liter-Regel, Kaltwasserschutz
 *  • DIN 1988-300 — Berechnungsdurchflüsse, Spitzendurchfluss, Rohrweiten
 *  • DVGW W 551 — Klein-/Großanlage, 60/55 °C
 *  • TrinkwV §§ 31 ff. — Untersuchungspflicht bei Vermietung (Gesetzestext)
 *  • GEG Anlage 8 — Dämmschichtdicken (Gesetzestext)
 */

import type { DomesticHotWaterDesign, PipeMaterial, PipeSizing } from '../types/bim';
import { findDimension, fluidProperties, sizePipe, waterDensity, waterHeatCapacity } from './hydraulics';
import { selectStorage } from './deviceCatalog';

/** Hinweis mit Gewicht — gleiche Form wie in `SafetyDesign` und `DomesticHotWaterDesign`. */
export type PlanningNote = { severity: 'info' | 'warn' | 'error'; text: string };

/** Deutsche Zahlschreibweise für Beschriftungen und Rechenschritte. */
function de(value: number, digits = 2): string {
  return value.toFixed(digits).replace('.', ',');
}

function round(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

// ===========================================================================
// 1 — Stoffwerte und Mischungsregel
// ===========================================================================

/**
 * Wärme, um einen Liter Wasser um ein Kelvin zu erwärmen [Wh/(l·K)].
 *
 * Hergeleitet, nicht abgeschrieben: 1,163 Wh/(l·K) · 3600 s/h = 4186,8 J/(l·K).
 * Das ist die historische Kilokalorie — 1 kcal/(kg·K) bei ρ = 1,0 kg/l — und
 * damit eine Definition, kein Messwert. Die echten Stoffwerte liegen leicht
 * darunter: mit c und ρ aus `hydraulics` sind es bei 30 °C 4180 J/(kg·K) ·
 * 0,9957 kg/l = 4162 J/(l·K), also 1,156 Wh/(l·K) und damit 0,6 % weniger.
 * Die Kurzform bleibt trotzdem stehen, weil die Branche mit ihr rechnet und
 * jede Prüfung darauf stößt; wo es auf ein Prozent ankommt, wird unten mit den
 * temperaturabhängigen Stoffwerten gerechnet und die Kurzform nur als
 * Kontrollzeile mitgeführt.
 */
export const HEAT_PER_LITRE_KELVIN = 1.163;

/**
 * Bezugs-Kaltwassertemperatur [°C].
 *
 * 10 °C ist der in der Trinkwassererwärmung übliche Rechenwert und zugleich
 * die Temperatur, auf die sich der Bezugswert der Einheitswohnung stützt.
 * Real liegt Kaltwasser je nach Jahreszeit und Leitungsführung zwischen 8 und
 * 16 °C — der Wert ist deshalb überall überschreibbar.
 */
export const COLD_WATER_REFERENCE = 10;

/**
 * Mischungsregel: dieselbe Wärmemenge, andere Temperatur.
 *
 * V₂ = V₁ · (ϑ₁ − ϑ_K) / (ϑ₂ − ϑ_K). Der Kaltwasseranteil ist der Grund,
 * warum ein 300-l-Speicher bei 60 °C deutlich mehr Duschwasser liefert als
 * bei 45 °C: nicht das Volumen zählt, sondern der Temperaturhub darüber.
 *
 * @param volume Volumen bei `from` [l]
 * @returns Volumen bei `to` [l]; 0, wenn `to` nicht über der Kaltwasser-
 *          temperatur liegt (dann ist keine Umrechnung definiert).
 */
export function mixedVolume(volume: number, from: number, to: number, cold = COLD_WATER_REFERENCE): number {
  if (to <= cold) return 0;
  return (volume * (from - cold)) / (to - cold);
}

// ===========================================================================
// 2 — Bedarfskennzahl N nach DIN 4708
// ===========================================================================

/**
 * Die Einheitswohnung als Bezugsgröße.
 *
 * **Frei zitiert und damit verwendbar:** DIN 4708 bezieht alles auf eine
 * Wohnung mit 3,5 Personen und einer Normalbadewanne, deren Wärmebedarf mit
 * 5820 Wh angesetzt wird. N = 1 heißt: das Gebäude verlangt so viel wie eine
 * solche Wohnung. Die Benutzungshäufigkeit v der Bezugszapfstelle ist 1.
 *
 * Kontrolle der Größenordnung: 5820 Wh / (1,163 Wh/(l·K) · 35 K) = 143 l bei
 * 45 °C aus 10 °C Kaltwasser. Das ist eine plausible Wannenfüllung — der
 * Bezugswert ist also mit der Physik konsistent.
 */
export interface UnitDwelling {
  /** Personen je Einheitswohnung p_E [-]. */
  persons: number;
  /** Wärmebedarf der Bezugszapfstelle w_E [Wh]. */
  heatDemand: number;
  /** Benutzungshäufigkeit der Bezugszapfstelle v_E [-]. */
  frequency: number;
}

export const UNIT_DWELLING: UnitDwelling = { persons: 3.5, heatDemand: 5820, frequency: 1 };

/** Zapfstellenarten, die in die Bedarfskennzahl eingehen. */
export type TapPointKind =
  | 'wanne-normal'
  | 'wanne-groß'
  | 'brause-normal'
  | 'brause-komfort'
  | 'waschtisch'
  | 'spüle'
  | 'bidet';

/**
 * Eine Zapfstelle mit ihrem Wärmebedarf.
 *
 * **Herkunft der Zahlen — bitte lesen.** DIN 4708-2 enthält eine Tabelle mit
 * Wärmebedarfskennzahlen w und Benutzungshäufigkeiten v je Zapfstellenart.
 * Diese Tabelle ist nicht frei verfügbar und steht deshalb nicht hier.
 * Stattdessen ist `heatDemand` aus `drawVolume` und `drawTemperature`
 * **hergeleitet**: w = V · 1,163 Wh/(l·K) · (ϑ_Zapf − ϑ_Kalt). Die Zapfmengen
 * sind Praxiswerte, die sich in Herstellerunterlagen und Fachliteratur
 * durchgängig finden; sie sind Vorbelegung, keine Normangabe.
 *
 * Wer die Normwerte hat, überschreibt die Einträge über
 * `demandIndex(..., { tapPoints })`. Die Rechenschritte im Ergebnis zeigen an,
 * mit welchem w gerechnet wurde — die Auslegung bleibt damit prüfbar.
 */
export interface TapPointProfile {
  kind: TapPointKind;
  label: string;
  /** Zapfmenge je Benutzung [l] bei `drawTemperature`. */
  drawVolume: number;
  /** Mischwassertemperatur an der Zapfstelle [°C]. */
  drawTemperature: number;
  /** Wärmebedarf w [Wh]. */
  heatDemand: number;
  /** Benutzungshäufigkeit v [-]. */
  frequency: number;
  provenance: 'bezugswert' | 'hergeleitet';
  note: string;
}

/** w = V · c · Δϑ — die Herleitung, die hinter jeder Vorbelegung steht. */
function heatDemandOf(drawVolume: number, drawTemperature: number, cold = COLD_WATER_REFERENCE): number {
  return Math.round(drawVolume * HEAT_PER_LITRE_KELVIN * (drawTemperature - cold));
}

/**
 * Vorbelegung der Zapfstellen.
 *
 * Die Normalbadewanne trägt bewusst den frei zitierten Bezugswert 5820 Wh und
 * nicht das Ergebnis der Herleitung — dadurch ist w/w_E für sie exakt 1, und
 * alle anderen Zapfstellen liegen relativ dazu richtig, auch wenn die
 * absoluten Werte der Norm abweichen.
 */
export const TAP_POINTS: Record<TapPointKind, TapPointProfile> = {
  'wanne-normal': {
    kind: 'wanne-normal',
    label: 'Normalbadewanne',
    drawVolume: 143,
    drawTemperature: 45,
    heatDemand: UNIT_DWELLING.heatDemand,
    frequency: 1,
    provenance: 'bezugswert',
    note: 'Bezugszapfstelle der Einheitswohnung; 5820 Wh sind frei zitiert, die Zapfmenge ist daraus zurückgerechnet.',
  },
  'wanne-groß': {
    kind: 'wanne-groß',
    label: 'Große Badewanne / Eckwanne',
    drawVolume: 180,
    drawTemperature: 45,
    heatDemand: heatDemandOf(180, 45),
    frequency: 1,
    provenance: 'hergeleitet',
    note: 'Zapfmenge 180 l als Vorbelegung; freistehende Wannen liegen deutlich darüber und sind einzutragen.',
  },
  'brause-normal': {
    kind: 'brause-normal',
    label: 'Brause, normale Armatur',
    drawVolume: 40,
    drawTemperature: 40,
    heatDemand: heatDemandOf(40, 40),
    frequency: 1,
    provenance: 'hergeleitet',
    note: 'Rund 8 l/min über 5 min. Der Wert reagiert empfindlich auf die Duschdauer — er gehört zu den Annahmen, die man dokumentiert.',
  },
  'brause-komfort': {
    kind: 'brause-komfort',
    label: 'Komfortbrause / Regenbrause',
    drawVolume: 75,
    drawTemperature: 40,
    heatDemand: heatDemandOf(75, 40),
    frequency: 1,
    provenance: 'hergeleitet',
    note: 'Rund 15 l/min über 5 min. Große Kopfbrausen erreichen 20 l/min und mehr; dann wird die Brause zur maßgebenden Zapfstelle.',
  },
  waschtisch: {
    kind: 'waschtisch',
    label: 'Waschtisch',
    drawVolume: 10,
    drawTemperature: 40,
    heatDemand: heatDemandOf(10, 40),
    frequency: 1,
    provenance: 'hergeleitet',
    note: 'Warmwasseranteil einer Handwäsche. Für die Bedarfskennzahl nachrangig, für die Rohrweite trotzdem relevant.',
  },
  spüle: {
    kind: 'spüle',
    label: 'Spüle',
    drawVolume: 12,
    drawTemperature: 45,
    heatDemand: heatDemandOf(12, 45),
    frequency: 1,
    provenance: 'hergeleitet',
    note: 'Handspülgang. Geschirrspüler zählen hier nicht mit, sie erzeugen ihr Warmwasser selbst.',
  },
  bidet: {
    kind: 'bidet',
    label: 'Bidet',
    drawVolume: 8,
    drawTemperature: 38,
    heatDemand: heatDemandOf(8, 38),
    frequency: 1,
    provenance: 'hergeleitet',
    note: 'Vorbelegung; im Wohnungsbau selten maßgebend.',
  },
};

/** Eine Gruppe gleichartiger Wohnungen. */
export interface DwellingGroup {
  label?: string;
  /** Anzahl gleichartiger Wohnungen n [-]. */
  count: number;
  /** Personen je Wohnung p [-]. */
  persons: number;
  /** Zapfstellen einer dieser Wohnungen. */
  tapPoints: { kind: TapPointKind; count?: number }[];
}

export interface DemandIndexOptions {
  /** Abweichende Zapfstellenwerte, etwa die echten Werte aus DIN 4708-2. */
  tapPoints?: Partial<Record<TapPointKind, TapPointProfile>>;
  /** Abweichende Einheitswohnung. */
  reference?: UnitDwelling;
  /**
   * Lesart der Summe.
   *  • `alle-zapfstellen` — über alle Warmwasser-Zapfstellen der Wohnung
   *    summieren. Das ist die wörtliche Lesart der Formel.
   *  • `größte-zapfstelle` — nur die stärkste Zapfstelle der Wohnung ansetzen.
   *    Diese Vereinfachung ist in der Praxis verbreitet und liefert kleinere N.
   * Die beiden Lesarten unterscheiden sich um bis zu 40 %; welche gilt,
   * entscheidet der Planer, nicht das Programm.
   */
  mode?: 'alle-zapfstellen' | 'größte-zapfstelle';
}

export interface DemandIndexGroupResult {
  label: string;
  count: number;
  persons: number;
  /** Summe der Wärmebedarfe der angesetzten Zapfstellen [Wh]. */
  heatDemand: number;
  /** p/p_E [-]. */
  personFactor: number;
  /** Σ (w/w_E · v/v_E) [-]. */
  heatFactor: number;
  /** Beitrag dieser Gruppe zu N [-]. */
  value: number;
}

export interface DemandIndexResult {
  /** Bedarfskennzahl N [-]. */
  demandIndex: number;
  units: number;
  occupants: number;
  groups: DemandIndexGroupResult[];
  /** Nachvollziehbare Rechenschritte, Zeile für Zeile. */
  steps: string[];
  notes: PlanningNote[];
}

/**
 * Bedarfskennzahl N nach DIN 4708-1.
 *
 * N = Σ n · (p/p_E) · (w/w_E) · (v/v_E)
 *
 * Die Summe läuft über die Zapfstellen; n ist die Anzahl gleichartiger
 * Wohnungen, p die Personenzahl der Wohnung, w der Wärmebedarf der Zapfstelle,
 * v ihre Benutzungshäufigkeit. Alles mit Index E bezieht sich auf die
 * Einheitswohnung.
 *
 * N ist keine Literangabe. N geht in die Leistungskennzahl N_L des Speichers
 * ein, die der Hersteller misst — ein Speicher „passt", wenn sein N_L die
 * Bedarfskennzahl erreicht. Die Volumenberechnung weiter unten ist ein
 * zweiter, unabhängiger Weg; beide gehören nebeneinander auf den Tisch.
 */
export function demandIndex(groups: readonly DwellingGroup[], options: DemandIndexOptions = {}): DemandIndexResult {
  const reference = options.reference ?? UNIT_DWELLING;
  const profiles: Record<TapPointKind, TapPointProfile> = { ...TAP_POINTS, ...(options.tapPoints ?? {}) };
  const mode = options.mode ?? 'alle-zapfstellen';
  const steps: string[] = [];
  const notes: PlanningNote[] = [];

  if (reference.persons <= 0 || reference.heatDemand <= 0 || reference.frequency <= 0) {
    return {
      demandIndex: 0,
      units: 0,
      occupants: 0,
      groups: [],
      steps: [],
      notes: [{ severity: 'error', text: 'Die Einheitswohnung ist unbrauchbar parametriert (Personen, Wärmebedarf oder Häufigkeit ≤ 0).' }],
    };
  }

  steps.push(
    `Bezug: Einheitswohnung mit p_E = ${de(reference.persons, 1)} Personen, w_E = ${Math.round(reference.heatDemand)} Wh, v_E = ${de(reference.frequency, 1)}.`,
  );
  steps.push(`Lesart der Summe: ${mode === 'alle-zapfstellen' ? 'alle Warmwasser-Zapfstellen der Wohnung' : 'nur die stärkste Zapfstelle der Wohnung'}.`);

  let total = 0;
  let units = 0;
  let occupants = 0;
  const results: DemandIndexGroupResult[] = [];

  groups.forEach((group, index) => {
    const label = group.label ?? `Wohnungstyp ${index + 1}`;
    const entries = group.tapPoints.map((tp) => {
      const profile = profiles[tp.kind];
      const count = Math.max(1, Math.round(tp.count ?? 1));
      // `unitShare` ist der Beitrag einer einzelnen Zapfstelle, `share` der der
      // ganzen Position. Beides wird getrennt gehalten, weil die Lesart
      // „größte Zapfstelle" eine einzelne Zapfstelle meint und nicht eine
      // Position mit mehreren gleichen Objekten.
      const unitShare = ((profile.heatDemand / reference.heatDemand) * profile.frequency) / reference.frequency;
      return { profile, count, share: count * unitShare, unitShare };
    });

    if (entries.length === 0) {
      notes.push({ severity: 'warn', text: `${label}: keine Zapfstellen angegeben — die Gruppe geht mit N = 0 ein.` });
      results.push({ label, count: group.count, persons: group.persons, heatDemand: 0, personFactor: 0, heatFactor: 0, value: 0 });
      return;
    }

    // Bei „größte-zapfstelle" wird genau eine Zapfstelle angesetzt, deshalb
    // `count: 1`. Ausgewählt wird nach dem Beitrag einer einzelnen Zapfstelle;
    // sonst würden drei Waschtische eine Badewanne verdrängen.
    const strongest = entries.reduce((a, b) => (b.unitShare > a.unitShare ? b : a));
    const relevant =
      mode === 'größte-zapfstelle' ? [{ profile: strongest.profile, count: 1, share: strongest.unitShare, unitShare: strongest.unitShare }] : entries;
    const heatFactor = relevant.reduce((sum, e) => sum + e.share, 0);
    const heatDemand = relevant.reduce((sum, e) => sum + e.count * e.profile.heatDemand, 0);
    const personFactor = group.persons / reference.persons;
    const value = group.count * personFactor * heatFactor;

    steps.push(`${label}: ${group.count} × Wohnung mit ${de(group.persons, 1)} Personen → p/p_E = ${de(group.persons, 1)}/${de(reference.persons, 1)} = ${de(personFactor, 3)}`);
    relevant.forEach((e) => {
      steps.push(
        `   ${e.count} × ${e.profile.label}: w = ${Math.round(e.profile.heatDemand)} Wh (${e.profile.provenance === 'bezugswert' ? 'Bezugswert' : 'hergeleitet'}), ` +
          `v = ${de(e.profile.frequency, 1)} → Beitrag ${de(e.share, 3)}`,
      );
    });
    steps.push(`   Σ(w/w_E · v/v_E) = ${de(heatFactor, 3)}  →  N_Gruppe = ${group.count} × ${de(personFactor, 3)} × ${de(heatFactor, 3)} = ${de(value, 2)}`);

    total += value;
    units += group.count;
    occupants += group.count * group.persons;
    results.push({ label, count: group.count, persons: group.persons, heatDemand: Math.round(heatDemand), personFactor: round(personFactor, 3), heatFactor: round(heatFactor, 3), value: round(value, 2) });
  });

  steps.push(`N = ${results.map((r) => de(r.value, 2)).join(' + ')} = ${de(total, 2)}`);

  const usedDerived = groups.some((g) => g.tapPoints.some((tp) => (profiles[tp.kind]?.provenance ?? 'hergeleitet') === 'hergeleitet'));
  if (usedDerived) {
    notes.push({
      severity: 'info',
      text:
        'Die Wärmebedarfe der Zapfstellen sind aus Zapfmenge und Temperaturhub hergeleitet, nicht der Tabelle DIN 4708-2 entnommen. ' +
        'Für die Ausführungsplanung sind die Normwerte einzutragen; die Struktur der Rechnung bleibt dieselbe.',
    });
  }
  if (total > 0 && total < 0.3) {
    notes.push({ severity: 'warn', text: `N = ${de(total, 2)} liegt unter dem Bereich, für den Hersteller N_L angeben. Die Speicherwahl stützt sich dann besser auf die Volumenrechnung.` });
  }

  return { demandIndex: round(total, 2), units, occupants: round(occupants, 1), groups: results, steps, notes };
}

/**
 * Standardausstattung einer Wohnung je Komfortanspruch.
 *
 * Vorbelegung, damit aus den wenigen Angaben des Modells (Wohnungen, Personen,
 * Komfort) überhaupt eine Bedarfskennzahl entstehen kann. Sobald die
 * Sanitärobjekte im Grundriss stehen, gehört die echte Ausstattung hierher.
 */
export function defaultTapPoints(comfort: ComfortLevel): { kind: TapPointKind; count?: number }[] {
  if (comfort === 'sparsam') return [{ kind: 'brause-normal' }, { kind: 'waschtisch' }, { kind: 'spüle' }];
  if (comfort === 'komfort') return [{ kind: 'wanne-groß' }, { kind: 'brause-komfort' }, { kind: 'waschtisch', count: 2 }, { kind: 'spüle' }];
  return [{ kind: 'wanne-normal' }, { kind: 'brause-normal' }, { kind: 'waschtisch' }, { kind: 'spüle' }];
}

// ===========================================================================
// 3 — Speichervolumen: zwei Wege nebeneinander
// ===========================================================================

export type ComfortLevel = 'sparsam' | 'normal' | 'komfort';

/**
 * Warmwasserbedarf je Person und Tag [l/(P·d)] bei 45 °C.
 *
 * **Richtwerte**, keine Normwerte. Sie stammen aus der Verbrauchsstatistik des
 * Wohnungsbaus und werden in Fachliteratur und Herstellerunterlagen in dieser
 * Bandbreite zitiert. Die Streuung zwischen zwei Haushalten gleicher Größe ist
 * größer als der Abstand zwischen zwei Stufen dieser Tabelle — wer Messwerte
 * hat, nimmt die Messwerte.
 */
export const DAILY_DEMAND_PER_PERSON: Record<ComfortLevel, number> = {
  sparsam: 25,
  normal: 40,
  komfort: 60,
};

/** Bezugstemperatur der Tagesbedarfswerte [°C]. */
export const DAILY_DEMAND_TEMPERATURE = 45;

export const COMFORT_LABELS: Record<ComfortLevel, string> = {
  sparsam: 'sparsam (25 l/(P·d) bei 45 °C)',
  normal: 'normal (40 l/(P·d) bei 45 °C)',
  komfort: 'komfortabel (60 l/(P·d) bei 45 °C)',
};

/** Die Bedarfsspitze: was in einer Stunde gleichzeitig gezapft wird. */
export interface PeakDrawInput {
  /** Duschvorgänge in der Spitze. */
  showers: number;
  /** Wannenfüllungen in der Spitze. */
  baths: number;
  /** Zapfmenge je Duschvorgang [l] — Richtwert 40 l. */
  showerVolume?: number;
  /** Mischwassertemperatur der Dusche [°C]. */
  showerTemperature?: number;
  /** Zapfmenge je Wannenfüllung [l] — Richtwert 140 l. */
  bathVolume?: number;
  bathTemperature?: number;
  /** Dauer der Bedarfsspitze [h] — Vorbelegung 1 h. */
  duration?: number;
  /** Leistung, die während der Spitze nachheizt [kW]; 0 = reiner Vorrat. */
  reheatDuringPeak?: number;
}

export interface StorageSizingInput {
  occupants: number;
  comfort: ComfortLevel;
  /** Speichertemperatur [°C]. */
  storageTemperature: number;
  coldWaterTemperature?: number;
  /**
   * Anteil des Tagesbedarfs, den der Speicher vorhalten soll [-].
   * 1,0 = der Speicher trägt den ganzen Tag ohne Nachladung. Wer zweimal
   * täglich in der PV-Zeit nachlädt, kommt mit 0,5 bis 0,7 aus.
   */
  dailyCoverage?: number;
  /**
   * Nutzbarer Anteil des Speicherinhalts [-].
   * Unter dem Wärmetauscher steht kaltes Wasser, und die Schichtung ist nie
   * ideal. 0,85 ist ein Erfahrungswert für stehende Speicher mit Glattrohr;
   * bei Speichern mit schlechter Schichtung sind es eher 0,75.
   */
  usableFraction?: number;
  peak?: PeakDrawInput;
  /** Abweichender Tagesbedarf je Person [l/(P·d)] bei 45 °C. */
  demandPerPerson?: number;
}

export interface StorageSizingResult {
  /** Speicherinhalt über den Tagesbedarf [l]. */
  byDailyDemand: number;
  /** Speicherinhalt über die Bedarfsspitze [l]. */
  byPeakDraw: number;
  /** Der größere der beiden [l]. */
  required: number;
  governing: 'tagesbedarf' | 'spitzenentnahme';
  reason: string;
  /** Tagesbedarf bei 45 °C [l]. */
  dailyDemand: number;
  /** Zapfmenge der Spitze, auf Speichertemperatur umgerechnet [l]. */
  peakVolume: number;
  usableFraction: number;
  steps: string[];
  notes: PlanningNote[];
}

/**
 * Speichervolumen über zwei unabhängige Wege.
 *
 * **Warum zwei Wege.** Der Tagesbedarf beschreibt die Energiemenge, die
 * Bedarfsspitze die Gleichzeitigkeit. In einem Einfamilienhaus mit vier
 * Personen gewinnt fast immer der Tagesbedarf; in einer Wohnung mit zwei
 * Personen und zwei Bädern gewinnt die Spitze. Ein Verfahren allein würde die
 * jeweils andere Situation still falsch machen, deshalb stehen beide Zahlen im
 * Ergebnis und der maßgebende Weg wird benannt.
 *
 * Beide Wege rechnen zuerst in Zapfmenge und dann über die Mischungsregel auf
 * die Speichertemperatur zurück; erst danach wird durch den nutzbaren Anteil
 * geteilt.
 */
export function sizeStorage(input: StorageSizingInput): StorageSizingResult {
  const cold = input.coldWaterTemperature ?? COLD_WATER_REFERENCE;
  // Geklemmt, weil durch diesen Wert geteilt wird: 0 ergäbe ein unendliches
  // Volumen, Werte über 1 einen Speicher, der mehr hergibt als er fasst.
  const usable = Math.min(1, Math.max(0.3, input.usableFraction ?? 0.85));
  const coverage = input.dailyCoverage ?? 1;
  const perPerson = input.demandPerPerson ?? DAILY_DEMAND_PER_PERSON[input.comfort];
  const steps: string[] = [];
  const notes: PlanningNote[] = [];

  if (input.storageTemperature <= cold) {
    return {
      byDailyDemand: 0,
      byPeakDraw: 0,
      required: 0,
      governing: 'tagesbedarf',
      reason: 'Die Speichertemperatur liegt nicht über der Kaltwassertemperatur — es lässt sich nichts auslegen.',
      dailyDemand: 0,
      peakVolume: 0,
      usableFraction: usable,
      steps: [],
      notes: [{ severity: 'error', text: `Speichertemperatur ${de(input.storageTemperature, 0)} °C ≤ Kaltwasser ${de(cold, 0)} °C.` }],
    };
  }

  // Weg a — Tagesbedarf.
  const dailyDemand = input.occupants * perPerson * coverage;
  const dailyAtStorage = mixedVolume(dailyDemand, DAILY_DEMAND_TEMPERATURE, input.storageTemperature, cold);
  const byDailyDemand = dailyAtStorage / usable;
  steps.push(
    `Weg a — Tagesbedarf: ${de(input.occupants, 1)} Personen × ${de(perPerson, 0)} l/(P·d) × Deckung ${de(coverage, 2)} = ${Math.round(dailyDemand)} l bei ${DAILY_DEMAND_TEMPERATURE} °C.`,
  );
  steps.push(
    `   Mischungsregel auf ${de(input.storageTemperature, 0)} °C: ${Math.round(dailyDemand)} l × (${DAILY_DEMAND_TEMPERATURE} − ${de(cold, 0)}) / (${de(input.storageTemperature, 0)} − ${de(cold, 0)}) = ${Math.round(dailyAtStorage)} l.`,
  );
  steps.push(`   Nutzbarer Anteil ${de(usable, 2)} → ${Math.round(byDailyDemand)} l Speicherinhalt.`);

  // Weg b — Bedarfsspitze.
  const peak = input.peak;
  let byPeakDraw = 0;
  let peakAtStorage = 0;
  if (peak && (peak.showers > 0 || peak.baths > 0)) {
    const showerVolume = peak.showerVolume ?? 40;
    const showerTemperature = peak.showerTemperature ?? 40;
    const bathVolume = peak.bathVolume ?? 140;
    const bathTemperature = peak.bathTemperature ?? 40;
    const duration = Math.max(0, peak.duration ?? 1);
    const showerPart = mixedVolume(peak.showers * showerVolume, showerTemperature, input.storageTemperature, cold);
    const bathPart = mixedVolume(peak.baths * bathVolume, bathTemperature, input.storageTemperature, cold);
    peakAtStorage = showerPart + bathPart;
    steps.push(
      `Weg b — Bedarfsspitze über ${de(duration, 1)} h: ${peak.showers} × ${de(showerVolume, 0)} l bei ${de(showerTemperature, 0)} °C ` +
        `+ ${peak.baths} × ${de(bathVolume, 0)} l bei ${de(bathTemperature, 0)} °C.`,
    );
    steps.push(`   Auf ${de(input.storageTemperature, 0)} °C umgerechnet: ${Math.round(showerPart)} l + ${Math.round(bathPart)} l = ${Math.round(peakAtStorage)} l.`);

    // Was während der Spitze nachgeheizt wird, muss nicht bevorratet werden —
    // aber nur, soweit sich die Entnahme über die Spitze verteilt. Eine
    // Wannenfüllung läuft mit 15 l/min in acht Minuten durch; in dieser Zeit
    // liefert der Erzeuger nur einen Bruchteil seiner Stundenarbeit. Der
    // Vorrat darf deshalb nie unter die größte einzelne Entnahme fallen,
    // sonst rechnet sich ein ausreichend starker Erzeuger den Speicher weg.
    const singleBath = peak.baths > 0 ? mixedVolume(bathVolume, bathTemperature, input.storageTemperature, cold) : 0;
    const singleShower = peak.showers > 0 ? mixedVolume(showerVolume, showerTemperature, input.storageTemperature, cold) : 0;
    const largestSingleDraw = Math.max(singleBath, singleShower);
    const reheat = peak.reheatDuringPeak ?? 0;
    if (reheat > 0 && duration > 0) {
      const covered = (reheat * 1000 * duration) / (HEAT_PER_LITRE_KELVIN * (input.storageTemperature - cold));
      const credited = Math.min(covered, Math.max(0, peakAtStorage - largestSingleDraw));
      peakAtStorage = peakAtStorage - credited;
      steps.push(
        `   Nachheizung ${de(reheat, 1)} kW über ${de(duration, 1)} h entspricht ${Math.round(covered)} l; angerechnet ${Math.round(credited)} l → Vorrat ${Math.round(peakAtStorage)} l.`,
      );
      if (credited < covered - 1) {
        notes.push({
          severity: 'info',
          text:
            `Die Nachheizung könnte rechnerisch ${Math.round(covered)} l der Spitze decken, angerechnet sind nur ${Math.round(credited)} l: ` +
            `die größte einzelne Entnahme von ${Math.round(largestSingleDraw)} l läuft in wenigen Minuten ab und muss bevorratet sein. ` +
            'Wer die Entnahme über die volle Spitzendauer als gleichmäßig ansehen will, gibt die Spitze über `peak` selbst vor.',
        });
      }
    }
    byPeakDraw = peakAtStorage / usable;
    steps.push(`   Nutzbarer Anteil ${de(usable, 2)} → ${Math.round(byPeakDraw)} l Speicherinhalt.`);
  } else {
    notes.push({ severity: 'info', text: 'Keine Bedarfsspitze angegeben — es zählt allein der Tagesbedarf. Bei mehreren Bädern gehört die Spitze geprüft.' });
  }

  const governing: 'tagesbedarf' | 'spitzenentnahme' = byPeakDraw > byDailyDemand ? 'spitzenentnahme' : 'tagesbedarf';
  const required = Math.max(byDailyDemand, byPeakDraw);
  const reason =
    governing === 'spitzenentnahme'
      ? `Maßgebend ist die Bedarfsspitze mit ${Math.round(byPeakDraw)} l; der Tagesbedarf verlangt nur ${Math.round(byDailyDemand)} l.`
      : byPeakDraw > 0
        ? `Maßgebend ist der Tagesbedarf mit ${Math.round(byDailyDemand)} l; die Bedarfsspitze verlangt ${Math.round(byPeakDraw)} l.`
        : `Maßgebend ist der Tagesbedarf mit ${Math.round(byDailyDemand)} l.`;
  steps.push(reason);

  if (byPeakDraw > 0 && Math.abs(byPeakDraw - byDailyDemand) / Math.max(byPeakDraw, byDailyDemand) < 0.1) {
    notes.push({ severity: 'info', text: 'Beide Wege liegen weniger als 10 % auseinander — die Auslegung ist unempfindlich gegen die Wahl des Verfahrens.' });
  }

  return {
    byDailyDemand: Math.round(byDailyDemand),
    byPeakDraw: Math.round(byPeakDraw),
    required: Math.round(required),
    governing,
    reason,
    dailyDemand: Math.round(dailyDemand),
    peakVolume: Math.round(peakAtStorage),
    usableFraction: usable,
    steps,
    notes,
  };
}

// ===========================================================================
// 4 — Aufheizleistung
// ===========================================================================

export interface ReheatInput {
  /** Speicherinhalt [l]. */
  volume: number;
  storageTemperature: number;
  coldWaterTemperature?: number;
  /** Gewünschte Aufheizzeit [h]. */
  reheatTime: number;
  /** Dauerleistung des Speicher-Wärmetauschers [kW] — aus dem Katalog. */
  coilOutput?: number;
  /** Leistung des Erzeugers im Warmwasserbetrieb [kW]. */
  generatorCapacity?: number;
}

export interface ReheatResult {
  /** Erforderliche Aufheizleistung [kW]. */
  required: number;
  /** Zugrunde gelegte Aufheizzeit [h]. */
  time: number;
  /** Tatsächlich verfügbare Leistung [kW], falls angegeben. */
  available?: number;
  /** Aufheizzeit, die mit der verfügbaren Leistung erreichbar ist [h]. */
  achievableTime?: number;
  limitedBy: 'wärmetauscher' | 'erzeuger' | 'keine';
  steps: string[];
  notes: PlanningNote[];
}

/**
 * Aufheizleistung Q = V · ρ · c · Δϑ / t.
 *
 * Gerechnet wird mit den temperaturabhängigen Stoffwerten aus `hydraulics`,
 * ausgewertet bei der mittleren Wassertemperatur (ϑ_kalt + ϑ_Speicher)/2 —
 * über den Hub von 10 auf 60 °C ändert sich c um rund 0,1 %, die Dichte um
 * 1,7 %. Die Kurzform mit 1,163 Wh/(l·K) liegt deshalb etwa 1 % daneben; das
 * ist für die Geräteauswahl gleichgültig und für die Nachvollziehbarkeit
 * trotzdem erwähnenswert.
 *
 * Der Abgleich mit der Dauerleistung des Wärmetauschers ist der Punkt, an dem
 * Wärmepumpenanlagen scheitern: der Speicher kann die Leistung oft gar nicht
 * aufnehmen, weil die Glattrohrfläche für 55 °C Heizwasser zu klein ist. Dann
 * springt der Heizstab ein, und die Jahresarbeitszahl bricht ein, ohne dass
 * jemand einen Fehler bemerkt.
 */
export function reheatPower(input: ReheatInput): ReheatResult {
  const cold = input.coldWaterTemperature ?? COLD_WATER_REFERENCE;
  const delta = input.storageTemperature - cold;
  const time = input.reheatTime;
  const steps: string[] = [];
  const notes: PlanningNote[] = [];

  if (delta <= 0 || time <= 0 || input.volume <= 0) {
    return {
      required: 0,
      time: Math.max(0, time),
      limitedBy: 'keine',
      steps: [],
      notes: [{ severity: 'error', text: 'Aufheizleistung nicht bestimmbar: Volumen, Temperaturhub oder Aufheizzeit ist null oder negativ.' }],
    };
  }

  const mean = cold + delta / 2;
  const rho = waterDensity(mean); // [kg/m³]
  const c = waterHeatCapacity(mean); // [J/(kg·K)]
  // V in m³, Q in W: Q = V · ρ · c · Δϑ / (t · 3600)
  const required = ((input.volume / 1000) * rho * c * delta) / (time * 3600) / 1000;
  steps.push(
    `Q = V · ρ · c · Δϑ / t = ${de(input.volume / 1000, 3)} m³ × ${de(rho, 1)} kg/m³ × ${Math.round(c)} J/(kg·K) × ${de(delta, 1)} K / ${de(time, 2)} h = ${de(required, 2)} kW.`,
  );
  steps.push(`   Kurzformel zur Kontrolle: ${Math.round(input.volume)} l × 1,163 Wh/(l·K) × ${de(delta, 1)} K / ${de(time, 2)} h = ${de((input.volume * HEAT_PER_LITRE_KELVIN * delta) / time / 1000, 2)} kW.`);

  const limits: { label: 'wärmetauscher' | 'erzeuger'; value: number }[] = [];
  if (input.coilOutput !== undefined && input.coilOutput > 0) limits.push({ label: 'wärmetauscher', value: input.coilOutput });
  if (input.generatorCapacity !== undefined && input.generatorCapacity > 0) limits.push({ label: 'erzeuger', value: input.generatorCapacity });

  if (limits.length === 0) {
    return { required: round(required, 2), time, limitedBy: 'keine', steps, notes };
  }

  const weakest = limits.reduce((a, b) => (b.value < a.value ? b : a));
  const available = weakest.value;
  steps.push(
    `Verfügbar: ${limits.map((l) => `${l.label === 'wärmetauscher' ? 'Wärmetauscher-Dauerleistung' : 'Erzeugerleistung im WW-Betrieb'} ${de(l.value, 2)} kW`).join(', ')} → maßgebend ${de(available, 2)} kW.`,
  );

  if (available >= required) {
    notes.push({ severity: 'info', text: `Die Aufheizzeit von ${de(time, 1)} h wird eingehalten; es stehen ${de(available, 1)} kW gegenüber ${de(required, 1)} kW Bedarf zur Verfügung.` });
    return { required: round(required, 2), time, available: round(available, 2), achievableTime: round((required * time) / available, 2), limitedBy: 'keine', steps, notes };
  }

  const achievable = (required * time) / available;
  steps.push(`   Erreichbare Aufheizzeit: ${de(time, 2)} h × ${de(required, 2)} / ${de(available, 2)} = ${de(achievable, 2)} h.`);
  notes.push({
    severity: 'warn',
    text:
      `Die gewünschte Aufheizzeit von ${de(time, 1)} h wird nicht erreicht: erforderlich ${de(required, 1)} kW, verfügbar ${de(available, 1)} kW ` +
      `(${weakest.label === 'wärmetauscher' ? 'begrenzt durch den Speicher-Wärmetauscher' : 'begrenzt durch den Erzeuger'}). ` +
      `Es werden ${de(achievable, 1)} h. Wege: größere Wärmetauscherfläche, längere Aufheizzeit oder kleinerer Speicher.`,
  });
  if (weakest.label === 'wärmetauscher') {
    notes.push({
      severity: 'info',
      text:
        'Ein Trinkwasserspeicher für Wärmepumpen braucht rund 1,4 m² Glattrohrfläche je 100 l. Wird die Fläche kleiner gewählt, sinkt nicht nur die ' +
        'Leistung, sondern auch die erreichbare Speichertemperatur — der Heizstab übernimmt, und die Arbeitszahl der Warmwasserbereitung fällt auf 1.',
    });
  }

  return { required: round(required, 2), time, available: round(available, 2), achievableTime: round(achievable, 2), limitedBy: weakest.label, steps, notes };
}

// ===========================================================================
// 5 — Legionellen nach DVGW W 551
// ===========================================================================

/** Grenze des Speicherinhalts zwischen Klein- und Großanlage [l], DVGW W 551. */
export const LARGE_PLANT_VOLUME_LIMIT = 400;

/**
 * Grenze des Leitungsinhalts zwischen Erwärmer und Entnahmestelle [l].
 *
 * Dieselbe Zahl trägt zwei Regeln: sie trennt nach DVGW W 551 Klein- von
 * Großanlage und löst nach DIN 1988-200 die Zirkulationspflicht aus. Der
 * Inhalt der Zirkulationsleitung selbst zählt in beiden Fällen nicht mit.
 */
export const THREE_LITRE_LIMIT = 3;

export interface LegionellaInput {
  /** Trinkwasserinhalt des Speichers [l]; Puffer auf der Heizungsseite zählen nicht. */
  storageVolume: number;
  /** Inhalt der längsten Leitung Erwärmer → Entnahmestelle [l], ohne Zirkulation. */
  longestBranchContent: number;
  /** Ein- oder Zweifamilienhaus? Diese Anlagen gelten unabhängig von der Größe als Kleinanlagen. */
  singleOrTwoFamilyHouse?: boolean;
  /** Wird vermietet oder sonst gewerblich/öffentlich abgegeben? */
  rented?: boolean;
  /** Trinkwarmwasser im Durchfluss statt aus dem Speicher? */
  freshWaterStation?: boolean;
  /** Geplante Speichertemperatur [°C]. */
  storageTemperature: number;
}

export interface LegionellaAssessment {
  regime: 'kleinanlage' | 'großanlage';
  reason: string;
  /**
   * Maßgebende Temperatur am Speicheraustritt [°C].
   *
   * Bei Großanlagen sind die 60 °C eine Forderung aus DVGW W 551. Bei
   * Kleinanlagen stellt das Regelwerk keine Temperaturforderung; die 50 °C
   * sind eine Empfehlung — unterhalb davon wächst Legionella pneumophila,
   * oberhalb 55 °C stirbt sie ab. Wer den Wert als Grenzwert weitergibt,
   * gibt eine Empfehlung als Norm aus.
   */
  requiredStorageTemperature: number;
  /** Geforderte Rücklauftemperatur der Zirkulation [°C]; nur bei Großanlagen. */
  requiredCirculationReturn?: number;
  /** Untersuchungspflicht nach TrinkwV. */
  inspectionDuty: boolean;
  notes: PlanningNote[];
}

/**
 * Einstufung nach DVGW W 551 und die Folgen für die Wärmepumpe.
 *
 * **Die Regel** (frei zitiert, weil in jeder Fachveröffentlichung enthalten):
 * Großanlage ist eine Anlage mit mehr als 400 l Speicherinhalt ODER mehr als
 * 3 l Inhalt in einer Leitung zwischen Erwärmer und Entnahmestelle; der
 * Inhalt der Zirkulationsleitung wird nicht mitgerechnet. Anlagen in Ein- und
 * Zweifamilienhäusern gelten unabhängig davon als Kleinanlagen. Bei
 * Großanlagen: 60 °C am Speicheraustritt, mindestens 55 °C im Rücklauf der
 * Zirkulation, bei Vermietung dazu die Untersuchungspflicht nach TrinkwV.
 *
 * **Der Konflikt mit der Wärmepumpe.** Jedes Grad Speichertemperatur kostet
 * Arbeitszahl: die Verdichtungsarbeit steigt mit der Temperaturspreizung
 * zwischen Quelle und Senke, grob 2 bis 2,5 % COP je Kelvin. Zwischen 50 und
 * 60 °C liegen damit rund 20 bis 25 % Mehrverbrauch für das Warmwasser, und
 * viele Geräte erreichen 60 °C überhaupt nur mit dem Heizstab — dort fällt die
 * Arbeitszahl auf 1. Der Ausweg ist nicht, die Temperatur zu senken, sondern
 * das stehende Warmwasser zu vermeiden: eine Frischwasserstation erwärmt im
 * Durchfluss aus einem Heizungspuffer. Trinkwasser steht dann nur noch im
 * Plattenwärmetauscher und in den Anbindeleitungen, der Puffer ist kein
 * Trinkwasserspeicher, und die 400-l-Grenze greift nicht. Die 3-Liter-Regel
 * für die Leitungen bleibt bestehen.
 */
export function assessLegionella(input: LegionellaInput): LegionellaAssessment {
  const notes: PlanningNote[] = [];
  const byVolume = input.storageVolume > LARGE_PLANT_VOLUME_LIMIT;
  const byBranch = input.longestBranchContent > THREE_LITRE_LIMIT;

  if (input.singleOrTwoFamilyHouse && (byVolume || byBranch)) {
    notes.push({
      severity: 'info',
      text:
        `Die Anlage überschreitet zwar die Grenzwerte (${Math.round(input.storageVolume)} l Speicher, ${de(input.longestBranchContent, 1)} l Leitungsinhalt), ` +
        'gilt als Anlage in einem Ein- oder Zweifamilienhaus nach DVGW W 551 aber als Kleinanlage. Die Empfehlung, ' +
        'den Speicher regelmäßig auf 60 °C zu bringen, bleibt davon unberührt.',
    });
  }

  const large = !input.singleOrTwoFamilyHouse && (byVolume || byBranch);
  const reasonParts: string[] = [];
  if (byVolume) reasonParts.push(`Speicherinhalt ${Math.round(input.storageVolume)} l > ${LARGE_PLANT_VOLUME_LIMIT} l`);
  if (byBranch) reasonParts.push(`Leitungsinhalt Erwärmer → Entnahmestelle ${de(input.longestBranchContent, 1)} l > ${THREE_LITRE_LIMIT} l (Zirkulation nicht gerechnet)`);

  const reason = input.singleOrTwoFamilyHouse
    ? 'Kleinanlage: Anlagen in Ein- und Zweifamilienhäusern gelten nach DVGW W 551 unabhängig von Speicher- und Leitungsinhalt als Kleinanlagen.'
    : large
      ? `Großanlage nach DVGW W 551 — ${reasonParts.join(' und ')}.`
      : `Kleinanlage nach DVGW W 551 — Speicherinhalt ${Math.round(input.storageVolume)} l ≤ ${LARGE_PLANT_VOLUME_LIMIT} l und Leitungsinhalt ${de(input.longestBranchContent, 1)} l ≤ ${THREE_LITRE_LIMIT} l.`;

  // 60 °C: Forderung der W 551 für Großanlagen. 50 °C: Empfehlung für
  // Kleinanlagen, keine Forderung — siehe Feldkommentar oben.
  const requiredStorageTemperature = large ? 60 : 50;

  if (large) {
    notes.push({
      severity: 'warn',
      text: 'Großanlage: 60 °C am Speicheraustritt einhalten, im Rücklauf der Zirkulation mindestens 55 °C. Das Zirkulationssystem darf sich um höchstens 5 K abkühlen.',
    });
    if (input.rented) {
      notes.push({
        severity: 'warn',
        text:
          'Bei Vermietung oder sonstiger gewerblicher Abgabe besteht für Großanlagen die Untersuchungspflicht auf Legionellen nach TrinkwV ' +
          '(gewerblich in der Regel alle drei Jahre, öffentlich jährlich), dazu Probenahmestellen am Austritt, im Zirkulationsrücklauf und an peripheren Strängen. ' +
          'Die Probenahmestellen sind bereits in der Planung vorzusehen — nachträglich sind sie teuer.',
      });
    }
    if (input.storageTemperature < 60) {
      notes.push({
        severity: 'error',
        text: `Die geplante Speichertemperatur von ${de(input.storageTemperature, 0)} °C unterschreitet die für Großanlagen geforderten 60 °C.`,
      });
    }
    notes.push({
      severity: 'info',
      text:
        'Effizienzfolge: 60 °C statt 50 °C kosten rund 20 bis 25 % der Arbeitszahl im Warmwasserbetrieb (etwa 2 bis 2,5 % je Kelvin Hub), ' +
        'und viele Wärmepumpen erreichen 60 °C nur mit dem Heizstab. Eine Frischwasserstation umgeht das Problem: der Puffer ist kein ' +
        'Trinkwasserspeicher, die 400-l-Grenze greift nicht mehr, und die Speichertemperatur kann bei 50 bis 55 °C bleiben.',
    });
  } else {
    notes.push({
      severity: 'info',
      text:
        'Kleinanlage: keine feste Temperaturvorgabe aus DVGW W 551. Der Speicher sollte trotzdem mindestens 50 °C führen und regelmäßig ' +
        'vollständig auf 60 °C gebracht werden. Für eine Wärmepumpe ist eine wöchentliche Anhebung der Kompromiss, der die Arbeitszahl kaum kostet.',
    });
  }

  if (input.freshWaterStation) {
    notes.push({
      severity: 'info',
      text:
        'Frischwasserstation: Trinkwarmwasser entsteht im Durchfluss, es steht kein Trinkwasser bevorratet. Der Puffer zählt nicht zum ' +
        'Speicherinhalt im Sinne von DVGW W 551. Dafür muss die Station die volle Zapfleistung liefern — bei einer Wanne sind das ' +
        'schnell 40 bis 60 kW für wenige Minuten, was den Puffer und dessen Schichtung zur eigentlichen Auslegungsaufgabe macht.',
    });
  }

  return {
    regime: large ? 'großanlage' : 'kleinanlage',
    reason,
    requiredStorageTemperature,
    requiredCirculationReturn: large ? 55 : undefined,
    inspectionDuty: large && input.rented === true,
    notes,
  };
}

// ===========================================================================
// 6 — Zirkulation nach DIN 1988-200
// ===========================================================================

/** Ein Leitungsabschnitt vom Erwärmer zur entferntesten Entnahmestelle. */
export interface BranchSegment {
  label?: string;
  material: PipeMaterial;
  /** Bestellbezeichnung, z. B. „22 × 1" oder „DN 25". */
  dimension: string;
  /** Länge [m]. */
  length: number;
  /** Lichter Innendurchmesser [mm], falls die Dimension nicht in der Tabelle steht. */
  inner?: number;
}

/**
 * Wasserinhalt je Meter [l/m] aus dem lichten Durchmesser.
 *
 * V' = π/4 · d_i². Mit d_i in dm und einem Meter Länge (10 dm) fällt das
 * Ergebnis unmittelbar in Litern an. Diese Hilfsfunktion greift nur, wenn die
 * Dimension nicht in den Werkstofftabellen von `hydraulics` steht — dort ist
 * `content` bereits enthalten und wird bevorzugt verwendet.
 */
export function contentPerMetre(inner: number): number {
  if (inner <= 0) return 0;
  const innerDm = inner / 100;
  return (Math.PI / 4) * innerDm * innerDm * 10;
}

export interface BranchContentResult {
  /** Gesamtinhalt [l]. */
  content: number;
  parts: { label: string; length: number; contentPerMetre: number; content: number }[];
  notes: PlanningNote[];
}

/**
 * Wasserinhalt einer Leitungsstrecke.
 *
 * Die Dimensionen kommen aus den Werkstofftabellen von `src/lib/hydraulics.ts`
 * (`findDimension`), damit Innendurchmesser und Inhalt hier und in der
 * Heizungsberechnung dieselben sind. Findet sich eine Bezeichnung nicht,
 * rettet `contentPerMetre` die Rechnung über den angegebenen Innendurchmesser,
 * und der Fall wird als Hinweis ausgewiesen statt still unterschlagen.
 */
export function branchContent(segments: readonly BranchSegment[]): BranchContentResult {
  const notes: PlanningNote[] = [];
  const parts = segments.map((segment, index) => {
    const label = segment.label ?? `Abschnitt ${index + 1}`;
    const found = findDimension(segment.material, segment.dimension);
    let perMetre: number;
    if (found) {
      perMetre = found.content;
    } else if (segment.inner !== undefined && segment.inner > 0) {
      perMetre = contentPerMetre(segment.inner);
      notes.push({
        severity: 'info',
        text: `${label}: „${segment.dimension}" steht nicht in der Werkstofftabelle; gerechnet wurde mit dem angegebenen Innendurchmesser von ${de(segment.inner, 1)} mm.`,
      });
    } else {
      perMetre = 0;
      notes.push({
        severity: 'warn',
        text: `${label}: Dimension „${segment.dimension}" (${segment.material}) ist unbekannt und kein Innendurchmesser angegeben — der Abschnitt geht mit 0 l ein.`,
      });
    }
    return { label, length: segment.length, contentPerMetre: round(perMetre, 4), content: round(perMetre * segment.length, 3) };
  });
  return { content: round(parts.reduce((sum, p) => sum + p.content, 0), 2), parts, notes };
}

export interface CirculationAssessment {
  required: boolean;
  reason: string;
  /** Maßgebender Leitungsinhalt [l], Zirkulationsleitung nicht gerechnet. */
  content: number;
  /** Wärmeverlust der zirkulierenden Leitung [W], falls berechenbar. */
  heatLoss?: number;
  /** Zirkulationsvolumenstrom [l/h] für die gewählte Abkühlung. */
  circulationFlow?: number;
  /** Zugrunde gelegte Abkühlung im Zirkulationssystem [K]. */
  circulationSpread?: number;
  notes: PlanningNote[];
}

/**
 * Wärmeverlust einer gedämmten Leitung [W/m].
 *
 * Zwei Widerstände in Reihe, je Meter Rohr:
 *  • Leitung durch die Dämmschicht  R_λ = ln(d_D/d_R) / (2π·λ)
 *  • Übergang an der Oberfläche     R_α = 1 / (π·d_D·α)
 * daraus q = Δϑ / (R_λ + R_α) = π·Δϑ / ( ln(d_D/d_R)/(2λ) + 1/(d_D·α) ).
 *
 * **Warum der Übergangsterm nicht fehlen darf.** Die verkürzte Form
 * q = 2π·λ·Δϑ/ln(d_D/d_R) läuft für dünne Dämmung gegen unendlich: 0,5 mm auf
 * einem 22er Rohr ergäben 186 W/m, während das blanke Rohr real bei rund
 * 26 W/m liegt. Der Oberflächenübergang begrenzt das und macht den Grenzfall
 * „keine Dämmung" überhaupt erst rechenbar — dort bleibt q = π·d·α·Δϑ stehen.
 *
 * Herkunft der Zahlen: λ = 0,035 W/(m·K) ist der Bezugswert, auf den auch GEG
 * Anlage 8 die Dämmdicken bezieht. α = 10 W/(m²·K) ist der übliche Ansatz für
 * freie Konvektion und Strahlung an einer waagerechten Rohroberfläche im
 * Raum — kein Normwert, sondern ein Erfahrungswert, deshalb Parameter. Die
 * Wand des Rohres selbst bleibt vernachlässigt; ihr Widerstand ist gegenüber
 * der Dämmung um Größenordnungen kleiner.
 *
 * @param outerDiameter Außendurchmesser des Rohres d_R [mm]
 * @param thickness Dämmschichtdicke [mm]; 0 = ungedämmt
 * @param deltaT Temperaturdifferenz Medium − Umgebung [K]
 * @param lambda Wärmeleitfähigkeit der Dämmung [W/(m·K)]
 * @param alphaOuter Wärmeübergang an der Dämmoberfläche [W/(m²·K)]; 0 = nur
 *        Leitung rechnen (dann ist die Dämmdicke zwingend größer null)
 */
export function insulatedPipeLoss(outerDiameter: number, thickness: number, deltaT: number, lambda = 0.035, alphaOuter = 10): number {
  if (outerDiameter <= 0 || lambda <= 0) return 0;
  const pipe = outerDiameter / 1000;
  const insulated = (outerDiameter + 2 * Math.max(0, thickness)) / 1000;
  const conduction = Math.log(insulated / pipe) / (2 * lambda);
  if (alphaOuter <= 0) {
    return conduction > 0 ? (Math.PI * deltaT) / conduction : 0;
  }
  return (Math.PI * deltaT) / (conduction + 1 / (insulated * alphaOuter));
}

export interface CirculationInput {
  /** Inhalt der Leitung Erwärmer → entfernteste Entnahmestelle [l]. */
  content: number;
  /** Länge des zirkulierenden Netzes, Vor- und Rücklauf [m]. */
  circulatingLength?: number;
  /** Außendurchmesser der zirkulierenden Leitung [mm]. */
  outerDiameter?: number;
  /** Dämmschichtdicke [mm]. */
  insulation?: number;
  /** Warmwassertemperatur [°C]. */
  hotTemperature?: number;
  /** Umgebungstemperatur der Leitung [°C]. */
  ambientTemperature?: number;
  /** Zulässige Abkühlung im Zirkulationssystem [K] — bei Großanlagen höchstens 5 K. */
  spread?: number;
}

/**
 * Zirkulationspflicht nach DIN 1988-200.
 *
 * **Die Regel** (frei zitiert): Überschreitet der Inhalt der Leitung vom
 * Trinkwassererwärmer bis zur entferntesten Entnahmestelle drei Liter, ist die
 * Leitung mit einer Zirkulation oder einer Begleitheizung auszustatten. Der
 * Inhalt der Zirkulationsleitung selbst zählt nicht mit.
 *
 * Drei Liter sind wenig: DN 20 (26,9 × 2,65) hat 21,6 mm licht und damit
 * π/4 · 2,16² cm² · 100 cm = 0,37 l/m — drei Liter sind rund acht Meter. Die
 * Regel entscheidet damit faktisch die Grundrissfrage, ob das Bad neben dem
 * Technikraum liegt oder nicht.
 *
 * Die Zirkulation ist kein kostenloser Komfort: sie hält das Netz dauerhaft
 * warm, und der Verlust läuft rund um die Uhr. Bei einer Wärmepumpe verlangt
 * er obendrein Vorlauftemperatur, sobald der Rücklauf 55 °C halten muss.
 */
export function assessCirculation(input: CirculationInput): CirculationAssessment {
  const notes: PlanningNote[] = [];
  const required = input.content > THREE_LITRE_LIMIT;
  const reason = required
    ? `Zirkulation erforderlich: der Inhalt der Leitung vom Erwärmer bis zur entferntesten Entnahmestelle beträgt ${de(input.content, 1)} l und überschreitet die ${THREE_LITRE_LIMIT} l nach DIN 1988-200.`
    : `Keine Zirkulation erforderlich: der Leitungsinhalt beträgt ${de(input.content, 1)} l und bleibt unter den ${THREE_LITRE_LIMIT} l nach DIN 1988-200.`;

  const result: CirculationAssessment = { required, reason, content: round(input.content, 2), notes };

  if (!required) {
    notes.push({
      severity: 'info',
      text: 'Ohne Zirkulation entfallen Verlust, Pumpe und Regelung. Dafür gilt: die Leitung muss regelmäßig durchströmt werden — eine selten benutzte Entnahmestelle wird zur Stagnationsstelle.',
    });
    return result;
  }

  const spread = input.spread ?? 5;
  const hot = input.hotTemperature ?? 60;
  const ambient = input.ambientTemperature ?? 20;

  if (input.circulatingLength !== undefined && input.outerDiameter !== undefined && input.insulation !== undefined) {
    const perMetre = insulatedPipeLoss(input.outerDiameter, input.insulation, hot - spread / 2 - ambient);
    const heatLoss = perMetre * input.circulatingLength;
    // Q = V̇ · c · Δϑ, umgestellt: V̇ [l/h] = Q [W] / (1,163 Wh/(l·K) · Δϑ)
    const flow = heatLoss / (HEAT_PER_LITRE_KELVIN * spread);
    result.heatLoss = Math.round(heatLoss);
    result.circulationFlow = Math.round(flow);
    result.circulationSpread = spread;
    notes.push({
      severity: 'info',
      text:
        `Wärmeverlust des zirkulierenden Netzes: ${de(perMetre, 1)} W/m × ${de(input.circulatingLength, 1)} m = ${Math.round(heatLoss)} W. ` +
        `Daraus folgt bei ${de(spread, 1)} K Abkühlung ein Zirkulationsvolumenstrom von ${Math.round(flow)} l/h. ` +
        `Über das Jahr sind das rund ${Math.round((heatLoss * 8760) / 1000)} kWh. Zum Vergleich: der Nutzwärmebedarf für Warmwasser liegt bei ` +
        'vier Personen und 40 l/(P·d) bei etwa 2400 kWh im Jahr — eine Zirkulation in einem Einfamilienhaus erreicht diese Größenordnung ohne Weiteres.',
    });
  } else {
    notes.push({
      severity: 'info',
      text: 'Für den Zirkulationsvolumenstrom fehlen Länge, Rohraußendurchmesser oder Dämmdicke des zirkulierenden Netzes. Ohne sie lässt sich der Verlust nicht beziffern.',
    });
  }

  notes.push({
    severity: 'info',
    text:
      'Zirkulationsleitungen sind hydraulisch abzugleichen (thermostatische Zirkulationsventile), sonst kommt der kürzeste Strang warm zurück und der ' +
      'längste kalt — genau dort, wo die Temperatur hygienisch gebraucht wird.',
  });

  return result;
}

// ===========================================================================
// 7 — Spitzenvolumenstrom und Rohrweiten nach DIN 1988-300
// ===========================================================================

/** Entnahmestellen, für die Berechnungsdurchflüsse geführt werden. */
export type DrawOffKind =
  | 'waschtisch'
  | 'spüle'
  | 'dusche'
  | 'wanne'
  | 'wc-druckspüler'
  | 'wc-spülkasten'
  | 'waschmaschine'
  | 'geschirrspüler'
  | 'ausgussbecken'
  | 'gartenzapfstelle';

/**
 * Berechnungsdurchfluss einer Entnahmestelle.
 *
 * `provenance: 'frei-zitiert'` heißt: der Wert findet sich unverändert in
 * Herstellerunterlagen, Fachbüchern und Planungshilfen und ist damit
 * verwendbar. `'vorbelegung'` heißt: der Wert ist eine begründete Annahme und
 * gehört vor der Ausführungsplanung geprüft.
 */
export interface DrawOffProfile {
  kind: DrawOffKind;
  label: string;
  /** Berechnungsdurchfluss kalt V_R [l/s]. */
  cold: number;
  /** Berechnungsdurchfluss warm V_R [l/s]; 0 = keine Warmwasserentnahme. */
  hot: number;
  provenance: 'frei-zitiert' | 'vorbelegung';
  note?: string;
}

/**
 * Berechnungsdurchflüsse der Entnahmestellen [l/s].
 *
 * Bei Mischarmaturen steht derselbe Wert auf beiden Seiten — das ist der Punkt,
 * den die Norm bewusst so setzt: die Armatur kann in jeder Stellung stehen, und
 * jede Seite muss die volle Menge liefern können.
 */
export const DESIGN_FLOWS: Record<DrawOffKind, DrawOffProfile> = {
  waschtisch: { kind: 'waschtisch', label: 'Waschtisch, Mischarmatur', cold: 0.07, hot: 0.07, provenance: 'frei-zitiert' },
  spüle: { kind: 'spüle', label: 'Spüle, Mischarmatur', cold: 0.07, hot: 0.07, provenance: 'frei-zitiert' },
  dusche: { kind: 'dusche', label: 'Brause, Mischarmatur', cold: 0.15, hot: 0.15, provenance: 'frei-zitiert' },
  wanne: { kind: 'wanne', label: 'Badewanne, Mischarmatur', cold: 0.15, hot: 0.15, provenance: 'frei-zitiert' },
  'wc-druckspüler': {
    kind: 'wc-druckspüler',
    label: 'WC mit Druckspüler',
    cold: 1.0,
    hot: 0,
    provenance: 'vorbelegung',
    note: 'Der Druckspüler ist die einzige Entnahmestelle, die einen ganzen Strang dominiert; je nach Bauart 0,7 bis 1,0 l/s. Der Wert ist aus dem Datenblatt des Spülers zu übernehmen.',
  },
  'wc-spülkasten': { kind: 'wc-spülkasten', label: 'WC mit Spülkasten', cold: 0.13, hot: 0, provenance: 'frei-zitiert' },
  waschmaschine: { kind: 'waschmaschine', label: 'Waschmaschine', cold: 0.15, hot: 0, provenance: 'frei-zitiert' },
  geschirrspüler: { kind: 'geschirrspüler', label: 'Geschirrspüler', cold: 0.07, hot: 0, provenance: 'frei-zitiert' },
  ausgussbecken: {
    kind: 'ausgussbecken',
    label: 'Ausgussbecken',
    cold: 0.15,
    hot: 0.15,
    provenance: 'vorbelegung',
    note: 'Wie eine Brausearmatur angesetzt; Normwert prüfen.',
  },
  gartenzapfstelle: {
    kind: 'gartenzapfstelle',
    label: 'Gartenzapfstelle / Schlauchanschluss',
    cold: 0.3,
    hot: 0,
    provenance: 'vorbelegung',
    note: 'Angesetzt für einen freien Auslauf DN 20; Normwert prüfen. Zapfstellen im Freien brauchen zusätzlich einen Rohrbelüfter.',
  },
};

/** Gebäudeart für die Spitzendurchflusskurve. */
export type BuildingUse = 'wohngebäude' | 'bürogebäude' | 'hotel' | 'krankenhaus' | 'schule' | 'pflegeheim' | 'sportstätte';

/**
 * Parametrierte Spitzendurchflusskurve V_S = a · (ΣV_R − b)^c + d.
 *
 * **Diese Parameter sind KEINE Normwerte.** DIN 1988-300 gibt je Gebäudeart
 * eine eigene Kurve dieser Bauform mit eigenem Gültigkeitsbereich an; der
 * Normtext ist kostenpflichtig und wird hier nicht wiedergegeben. Die
 * Vorbelegung entspricht der in der Fachliteratur für Wohngebäude verbreiteten
 * Form und ist bewusst für alle Gebäudearten gleich gesetzt — sie ist ein
 * Platzhalter, kein Rechenwert. Wer ein anderes Gebäude als ein Wohngebäude
 * rechnet, ersetzt a, b, c, d aus dem Normtext und setzt `provenance` auf
 * `'norm'`; erst dann verschwindet die Warnung aus dem Ergebnis.
 */
export interface PeakFlowCurve {
  use: BuildingUse;
  label: string;
  a: number;
  b: number;
  c: number;
  d: number;
  /** Gültigkeitsbereich des Summendurchflusses ΣV_R [l/s]. */
  range: [number, number];
  provenance: 'vorbelegung' | 'norm';
  note: string;
}

const PLACEHOLDER_CURVE = { a: 0.682, b: 0, c: 0.45, d: -0.14, range: [0.2, 500] as [number, number] };

function curveFor(use: BuildingUse, label: string, note: string): PeakFlowCurve {
  return { use, label, ...PLACEHOLDER_CURVE, provenance: 'vorbelegung', note };
}

export const PEAK_FLOW_CURVES: Record<BuildingUse, PeakFlowCurve> = {
  wohngebäude: curveFor(
    'wohngebäude',
    'Wohngebäude',
    'Vorbelegung in der für Wohngebäude verbreiteten Form. Vor der Ausführungsplanung gegen den Normtext prüfen.',
  ),
  bürogebäude: curveFor('bürogebäude', 'Bürogebäude', 'Platzhalter — DIN 1988-300 führt für Bürogebäude eine eigene Kurve. Parameter aus der Norm eintragen.'),
  hotel: curveFor('hotel', 'Hotel', 'Platzhalter — Hotels haben eine ausgeprägtere Morgenspitze als Wohngebäude. Parameter aus der Norm eintragen.'),
  krankenhaus: curveFor('krankenhaus', 'Krankenhaus', 'Platzhalter — Parameter aus der Norm eintragen. Zusätzlich gelten erhöhte hygienische Anforderungen.'),
  schule: curveFor('schule', 'Schule', 'Platzhalter — Schulen haben kurze, sehr hohe Pausenspitzen. Parameter aus der Norm eintragen.'),
  pflegeheim: curveFor('pflegeheim', 'Pflegeheim', 'Platzhalter — Parameter aus der Norm eintragen.'),
  sportstätte: curveFor('sportstätte', 'Sportstätte', 'Platzhalter — Sammelduschen laufen nahezu gleichzeitig; die Gleichzeitigkeit liegt weit über der von Wohngebäuden.'),
};

export interface PeakFlowResult {
  /** Summendurchfluss ΣV_R [l/s]. */
  sumFlow: number;
  /** Spitzendurchfluss V_S [l/s]. */
  peakFlow: number;
  /** Gleichzeitigkeit V_S/ΣV_R [-]. */
  simultaneity: number;
  curve: PeakFlowCurve;
  steps: string[];
  notes: PlanningNote[];
}

/**
 * Spitzendurchfluss aus dem Summendurchfluss.
 *
 * V_S = a · (ΣV_R − b)^c + d, begrenzt auf sinnvolle Werte:
 *  • V_S kann nie größer sein als ΣV_R (alles gleichzeitig offen).
 *  • V_S kann nie kleiner sein als der größte einzelne Berechnungsdurchfluss —
 *    eine Leitung muss mindestens die stärkste Entnahmestelle versorgen, die an
 *    ihr hängt. Diese Untergrenze ist der Grund, warum ein Strang mit einem
 *    Druckspüler nie klein wird.
 *  • Unterhalb des Gültigkeitsbereichs der Kurve gilt V_S = ΣV_R. Die
 *    Potenzfunktion mit negativem d läuft dort gegen null und schließlich
 *    darunter — mit der Vorbelegung wird sie unterhalb von 0,03 l/s negativ.
 *    Physikalisch ist der Fall trivial: hängen ein oder zwei Entnahmestellen
 *    am Abschnitt, ist die Gleichzeitigkeit eins.
 */
export function peakFlow(sumFlow: number, curve: PeakFlowCurve, largestSingle = 0): PeakFlowResult {
  const steps: string[] = [];
  const notes: PlanningNote[] = [];

  if (sumFlow <= 0) {
    return { sumFlow: 0, peakFlow: 0, simultaneity: 0, curve, steps, notes: [{ severity: 'warn', text: 'Kein Summendurchfluss — an diesem Abschnitt hängt keine Entnahmestelle.' }] };
  }

  const base = Math.max(0, sumFlow - curve.b);
  const raw = curve.a * base ** curve.c + curve.d;
  const belowRange = sumFlow < curve.range[0];
  const floor = belowRange ? sumFlow : Math.max(0, largestSingle);
  const capped = Math.min(sumFlow, Math.max(raw, floor));
  steps.push(
    `ΣV_R = ${de(sumFlow, 3)} l/s → V_S = ${de(curve.a, 3)} · (${de(sumFlow, 3)} − ${de(curve.b, 3)})^${de(curve.c, 3)} + ${de(curve.d, 3)} = ${de(raw, 3)} l/s.`,
  );
  if (capped !== raw) {
    steps.push(
      belowRange
        ? `   Auf ΣV_R = ${de(sumFlow, 3)} l/s gesetzt — unterhalb des Gültigkeitsbereichs der Kurve gilt volle Gleichzeitigkeit.`
        : capped === sumFlow
          ? `   Begrenzt auf ΣV_R = ${de(sumFlow, 3)} l/s — mehr als alle Entnahmestellen zusammen kann nicht fließen.`
          : `   Angehoben auf ${de(capped, 3)} l/s — die stärkste einzelne Entnahmestelle verlangt so viel.`,
    );
  }
  if (sumFlow < curve.range[0] || sumFlow > curve.range[1]) {
    notes.push({
      severity: 'warn',
      text: `ΣV_R = ${de(sumFlow, 2)} l/s liegt außerhalb des Gültigkeitsbereichs der Kurve (${de(curve.range[0], 2)} bis ${de(curve.range[1], 2)} l/s). Der Wert ist eine Extrapolation.`,
    });
  }
  if (curve.provenance === 'vorbelegung') {
    notes.push({
      severity: 'warn',
      text: `Die Spitzendurchflusskurve für „${curve.label}" ist eine Vorbelegung, kein Normwert. ${curve.note}`,
    });
  }

  return { sumFlow: round(sumFlow, 3), peakFlow: round(capped, 3), simultaneity: round(capped / sumFlow, 3), curve, steps, notes };
}

/** Ein Abschnitt der Trinkwasserinstallation. */
export interface InstallationSection {
  id: string;
  label: string;
  /** Kalt-, Warm- oder Zirkulationsleitung. */
  service: 'kalt' | 'warm' | 'zirkulation';
  /** Alle Entnahmestellen, die über diesen Abschnitt versorgt werden. */
  drawOffs: { kind: DrawOffKind; count: number }[];
  /** Länge des Abschnitts [m]. */
  length: number;
  material: PipeMaterial;
  /** Kleinste zulässige Nennweite [mm], etwa wegen Anschlussmaß. */
  minDn?: number;
}

export interface InstallationSectionResult {
  id: string;
  label: string;
  service: 'kalt' | 'warm' | 'zirkulation';
  /** Summendurchfluss [l/s]. */
  sumFlow: number;
  /** Spitzendurchfluss [l/s]. */
  peakFlow: number;
  simultaneity: number;
  sizing: PipeSizing;
  /** Wasserinhalt des Abschnitts [l]. */
  content: number;
  /** Ausstauschzeit bei Spitzendurchfluss [s] — Maß für die Stagnationsgefahr. */
  exchangeTime: number;
  steps: string[];
  notes: PlanningNote[];
}

export interface InstallationOptions {
  use?: BuildingUse;
  /** Eigene Kurve, etwa mit den echten Normparametern. */
  curve?: PeakFlowCurve;
  /** Abweichende Berechnungsdurchflüsse. */
  designFlows?: Partial<Record<DrawOffKind, DrawOffProfile>>;
  /**
   * Höchste Fließgeschwindigkeit [m/s].
   * 2 m/s ist der in der Trinkwasserinstallation gebräuchliche Wert für
   * durchströmte Leitungen; in Einzelzuleitungen mit kurzer Betriebszeit sind
   * höhere Werte üblich, in schallempfindlichen Bereichen niedrigere. Der Wert
   * ist eine Planungsentscheidung und kein Naturgesetz.
   */
  maxVelocity?: number;
  /**
   * Höchstes Druckgefälle [Pa/m]. DIN 1988-300 begrenzt nicht das Gefälle,
   * sondern die Summe der Druckverluste gegen den verfügbaren Druck. Der Wert
   * dient hier nur als Fangnetz, damit die Dimensionierung nicht in absurde
   * Bereiche läuft.
   */
  maxGradient?: number;
  /** Kaltwassertemperatur [°C] für die Stoffwerte. */
  coldTemperature?: number;
  /** Warmwassertemperatur [°C] für die Stoffwerte. */
  hotTemperature?: number;
}

export interface InstallationResult {
  sections: InstallationSectionResult[];
  /** Größter Spitzendurchfluss aller Abschnitte [l/s] — der Wert für den Hausanschluss. */
  maxPeakFlow: number;
  /** Gesamtinhalt aller Warmwasserabschnitte [l]. */
  hotContent: number;
  notes: PlanningNote[];
}

/**
 * Rohrweiten der Trinkwasserinstallation nach dem Verfahren von DIN 1988-300.
 *
 * Der Ablauf je Abschnitt: Berechnungsdurchflüsse der versorgten
 * Entnahmestellen summieren, daraus über die Kurve den Spitzendurchfluss
 * bilden, damit die Dimension bestimmen. Die eigentliche Dimensionierung
 * erledigt `sizePipe` aus `hydraulics` — dieselbe Colebrook-Rechnung wie im
 * Heizkreis, nur mit den Stoffwerten von kaltem beziehungsweise warmem
 * Trinkwasser und anderen Grenzwerten.
 *
 * Was dieses Verfahren NICHT ersetzt: den Druckverlustnachweis über den
 * ungünstigsten Fließweg gegen den Versorgungsdruck. Erst der entscheidet, ob
 * die Installation funktioniert; die Dimensionen hier sind die Eingangsgröße
 * dafür.
 */
export function sizeInstallation(sections: readonly InstallationSection[], options: InstallationOptions = {}): InstallationResult {
  const use = options.use ?? 'wohngebäude';
  const curve = options.curve ?? PEAK_FLOW_CURVES[use];
  const flows: Record<DrawOffKind, DrawOffProfile> = { ...DESIGN_FLOWS, ...(options.designFlows ?? {}) };
  const maxVelocity = options.maxVelocity ?? 2.0;
  const maxGradient = options.maxGradient ?? 1500;
  const coldFluid = fluidProperties(options.coldTemperature ?? COLD_WATER_REFERENCE);
  const hotFluid = fluidProperties(options.hotTemperature ?? 60);
  const notes: PlanningNote[] = [];
  let curveWarned = false;

  const results = sections.map((section) => {
    const steps: string[] = [];
    const sectionNotes: PlanningNote[] = [];
    let sum = 0;
    let largest = 0;
    section.drawOffs.forEach((entry) => {
      const profile = flows[entry.kind];
      // Zirkulationsleitungen führen Warmwasser; sie werden deshalb wie die
      // Warmwasserleitung behandelt und nicht mit den Kaltwasserwerten
      // gerechnet — dieselbe Zuordnung wie bei den Stoffwerten unten.
      const value = section.service === 'kalt' ? profile.cold : profile.hot;
      if (value <= 0) return;
      sum += value * entry.count;
      largest = Math.max(largest, value);
      steps.push(`${entry.count} × ${profile.label}: ${de(value, 2)} l/s → ${de(value * entry.count, 3)} l/s`);
      if (profile.provenance === 'vorbelegung' && profile.note) {
        sectionNotes.push({ severity: 'info', text: `${profile.label}: ${profile.note}` });
      }
    });

    const peak = peakFlow(sum, curve, largest);
    steps.push(...peak.steps);
    peak.notes.forEach((note) => {
      // Die Kurvenwarnung ist für alle Abschnitte dieselbe — einmal genügt.
      if (note.text.startsWith('Die Spitzendurchflusskurve')) {
        if (!curveWarned) {
          notes.push(note);
          curveWarned = true;
        }
        return;
      }
      // Dass an einer Zirkulationsleitung keine Entnahmestelle hängt, ist kein
      // Mangel, sondern ihr Wesen; der Hinweis darauf steht unten präziser.
      if (section.service === 'zirkulation' && note.text.startsWith('Kein Summendurchfluss')) return;
      sectionNotes.push(note);
    });

    if (section.service === 'zirkulation') {
      sectionNotes.push({
        severity: 'warn',
        text:
          `${section.label}: Eine Zirkulationsleitung wird nicht über Berechnungsdurchflüsse dimensioniert, sondern über den ` +
          'Zirkulationsvolumenstrom aus dem Wärmeverlust des Netzes — er kommt aus `assessCirculation`. Die hier gewählte Dimension ist ' +
          'nur die kleinste der Reihe und ohne diesen Volumenstrom kein Nachweis.',
      });
    }

    // sizePipe rechnet in m³/h, die Trinkwasserinstallation in l/s.
    const sizing = sizePipe(peak.peakFlow * 3.6, {
      material: section.material,
      maxVelocity,
      maxGradient,
      minDn: section.minDn,
      fluid: section.service === 'kalt' ? coldFluid : hotFluid,
    });
    if (sizing.warning) sectionNotes.push({ severity: 'warn', text: `${section.label}: ${sizing.warning}` });

    const content = sizing.dimension.content * section.length;
    const exchangeTime = peak.peakFlow > 0 ? content / peak.peakFlow : Number.POSITIVE_INFINITY;
    steps.push(
      `Gewählt ${sizing.dimension.label} (${section.material}): v = ${de(sizing.velocity, 2)} m/s, R = ${Math.round(sizing.gradient)} Pa/m, ` +
        `Inhalt ${de(content, 2)} l auf ${de(section.length, 1)} m.`,
    );

    return {
      id: section.id,
      label: section.label,
      service: section.service,
      sumFlow: peak.sumFlow,
      peakFlow: peak.peakFlow,
      simultaneity: peak.simultaneity,
      sizing,
      content: round(content, 2),
      exchangeTime: Number.isFinite(exchangeTime) ? round(exchangeTime, 1) : 0,
      steps,
      notes: sectionNotes,
    };
  });

  const hotContent = round(results.filter((r) => r.service === 'warm').reduce((sum, r) => sum + r.content, 0), 2);
  if (hotContent > THREE_LITRE_LIMIT) {
    // Bewusst nur ein Hinweis: maßgebend sind nicht alle Warmwasserabschnitte
    // zusammen, sondern der eine Weg vom Erwärmer bis zur entferntesten
    // Entnahmestelle. Als Warnung gelesen wäre der Satz in jedem Gebäude mit
    // mehr als einer Steigleitung ein Fehlalarm.
    notes.push({
      severity: 'info',
      text:
        `Die Warmwasserabschnitte fassen zusammen ${de(hotContent, 1)} l. Das ist nicht das Kriterium — maßgebend ist der Inhalt des einen ` +
        `Weges vom Erwärmer bis zur entferntesten Entnahmestelle. Überschreitet er ${THREE_LITRE_LIMIT} l, ist eine Zirkulation erforderlich; ` +
        'diesen Weg rechnet `branchContent` aus den Abschnitten, die tatsächlich hintereinander liegen.',
    });
  }
  // Die Herkunft der Berechnungsdurchflüsse gehört in das Ergebnis und nicht
  // nur in den Quelltext: sie sind die Eingangsgröße jeder Rohrweite.
  notes.push({
    severity: 'info',
    text:
      'Die Berechnungsdurchflüsse der Entnahmestellen sind die in Herstellerunterlagen und Planungshilfen durchgängig zitierten Werte ' +
      '(Mischarmatur 0,07 l/s, Brause und Wanne 0,15 l/s, Spülkasten 0,13 l/s). Wo sie als Vorbelegung geführt sind — Druckspüler, ' +
      'Ausgussbecken, Gartenzapfstelle — steht der Grund am Eintrag; diese Werte gehören vor der Ausführungsplanung gegen das Datenblatt ' +
      'der Armatur geprüft und über `designFlows` ersetzt.',
  });
  notes.push({
    severity: 'info',
    text:
      'Die Dimensionen ersetzen nicht den Druckverlustnachweis über den ungünstigsten Fließweg: Versorgungsdruck minus geodätische Höhe, ' +
      'Rohrreibung, Einzelwiderstände, Apparate (Wasserzähler, Filter, Enthärtung) und Mindestfließdruck an der Armatur.',
  });

  return {
    sections: results,
    maxPeakFlow: round(results.reduce((max, r) => Math.max(max, r.peakFlow), 0), 3),
    hotContent,
    notes,
  };
}

// ===========================================================================
// 8 — Dämmung und Hygiene
// ===========================================================================

/**
 * Dämmschichtdicke nach GEG Anlage 8, bezogen auf λ = 0,035 W/(m·K).
 *
 * Der Gesetzestext ist frei zugänglich und wird deshalb direkt abgebildet:
 * bis DN 22 → 20 mm, über DN 22 bis DN 35 → 30 mm, über DN 35 bis DN 100 →
 * Dämmdicke gleich der Nennweite in Millimetern, über DN 100 → 100 mm.
 * Halbierung für Leitungen in Bauteilen zwischen beheizten Räumen
 * verschiedener Nutzer, in Wand- und Deckendurchbrüchen, an Kreuzungen und
 * für Verteilerleitungen innerhalb der Dämmung.
 *
 * Für Kaltwasserleitungen regelt das GEG nichts — dort geht es nicht um
 * Wärmeverlust, sondern um Erwärmung. Der Kaltwasserschutz nach DIN 1988-200
 * ist als eigene Situation geführt.
 */
export type InsulationSituation = 'standard' | 'halbiert' | 'kaltwasser';

export interface InsulationResult {
  /** Dämmschichtdicke [mm] bei λ = 0,035 W/(m·K). */
  thickness: number;
  basis: string;
  note?: string;
}

export function insulationThickness(dn: number, situation: InsulationSituation = 'standard'): InsulationResult {
  if (situation === 'kaltwasser') {
    return {
      thickness: 13,
      basis: 'DIN 1988-200 — Schutz gegen Erwärmung, nicht gegen Wärmeverlust.',
      note:
        'Richtwert. Maßgebend ist nicht eine Dicke, sondern das Ziel: das Kaltwasser bleibt unter 25 °C. In warmen Schächten, neben ' +
        'Warmwasser- oder Zirkulationsleitungen und im Fußbodenaufbau über der Heizung reicht auch 13 mm oft nicht — dort hilft nur Abstand ' +
        'oder eine getrennte Führung.',
    };
  }
  const base = dn <= 22 ? 20 : dn <= 35 ? 30 : dn <= 100 ? dn : 100;
  const thickness = situation === 'halbiert' ? base / 2 : base;
  return {
    thickness,
    basis: `GEG Anlage 8${situation === 'halbiert' ? ', halbierte Anforderung' : ''} (λ = 0,035 W/(m·K))`,
    note:
      situation === 'halbiert'
        ? 'Die Halbierung gilt für Leitungen in Bauteilen zwischen beheizten Räumen verschiedener Nutzer, in Durchbrüchen, an Kreuzungen und für Verteilerleitungen innerhalb der Dämmung.'
        : 'Bei anderem λ ist die Dicke umzurechnen; die Anforderung ist ein Dämmwert, keine Dicke.',
  };
}

/**
 * Hygienehinweise zur Trinkwasserinstallation.
 *
 * Diese Punkte entscheiden über die Qualität einer Anlage mehr als jede
 * Speicherberechnung — und sie kosten in der Planung nichts, in der
 * Nachbesserung dagegen alles. Sie stehen deshalb als feste Liste im Ergebnis.
 */
export function hygieneNotes(context: { circulationRequired: boolean; regime: 'kleinanlage' | 'großanlage'; freshWaterStation?: boolean } ): PlanningNote[] {
  const notes: PlanningNote[] = [
    {
      severity: 'info',
      text:
        'Stagnation: der bestimmungsgemäße Betrieb verlangt einen vollständigen Wasseraustausch in allen Leitungsteilen spätestens alle 72 Stunden. ' +
        'Selten genutzte Entnahmestellen (Gästebad, Waschküche) brauchen eine Spülung von Hand oder eine automatische Spüleinrichtung.',
    },
    {
      severity: 'info',
      text:
        'Totleitungen: nicht mehr genutzte Leitungen sind bis zur durchströmten Leitung zurückzubauen, nicht nur abzusperren. Eine abgesperrte ' +
        'Stichleitung bleibt ein Wasservolumen auf Umgebungstemperatur — der klassische Ausgangspunkt einer Kontamination.',
    },
    {
      severity: 'info',
      text:
        'Kaltwasser unter 25 °C halten: getrennte Schächte oder ausreichender Abstand zu Warmwasser-, Zirkulations- und Heizleitungen, keine ' +
        'gemeinsame Führung im Fußbodenaufbau über der Heizung, Kaltwasserleitungen nicht in unbelüfteten warmen Vorwandinstallationen bündeln.',
    },
    {
      severity: 'info',
      text: 'Dämmung nach GEG Anlage 8 für die Warmwasser- und Zirkulationsleitungen; für Kaltwasser die Dämmung gegen Erwärmung nach DIN 1988-200.',
    },
    {
      severity: 'info',
      text: 'Rohrweiten so klein wie zulässig wählen: kleinere Querschnitte bedeuten kürzere Austauschzeiten und weniger stehendes Wasser. Großzügige Dimensionierung ist hier ein Hygienefehler, kein Sicherheitszuschlag.',
    },
  ];

  if (context.circulationRequired) {
    notes.push({
      severity: 'info',
      text:
        context.regime === 'großanlage'
          ? 'Die Zirkulation darf nach DVGW W 551 höchstens 8 Stunden am Tag unterbrochen werden und muss mindestens 55 °C zurückführen.'
          : 'Eine Zeitschaltung der Zirkulationspumpe spart Energie; die Abschaltdauer bleibt hygienisch begrenzt, und die Stränge sollen in der Betriebszeit vollständig durchwärmt werden.',
    });
  }
  if (context.freshWaterStation) {
    notes.push({
      severity: 'info',
      text: 'Frischwasserstation: der Plattenwärmetauscher ist trinkwasserseitig klein, aber kalkempfindlich. Ab rund 14 °dH gehört eine Enthärtung oder eine Begrenzung der Puffertemperatur dazu.',
    });
  }
  return notes;
}

// ===========================================================================
// 9 — Gesamtauslegung
// ===========================================================================

export interface DomesticWaterInput {
  /** Wohneinheiten. */
  units: number;
  /** Personen je Wohneinheit. */
  occupantsPerUnit: number;
  comfort: ComfortLevel;
  /** Speichertemperatur [°C]. */
  storageTemperature: number;
  /** Zapftemperatur an der Entnahmestelle [°C]. */
  tapTemperature: number;
  coldWaterTemperature?: number;
  /** Gewünschte Aufheizzeit [h]. */
  reheatTime: number;
  /** Inhalt der längsten Warmwasserleitung ab Erwärmer [l]. */
  longestBranchContent?: number;
  /** Alternativ: die Leitung abschnittsweise, dann wird der Inhalt gerechnet. */
  branch?: BranchSegment[];
  /** Abweichende Wohnungszusammensetzung; sonst aus `units`/`occupantsPerUnit` gebildet. */
  dwellings?: DwellingGroup[];
  /** Bereits gewählter Speicher [l]; sonst gilt die Empfehlung. */
  storageVolume?: number;
  /** Dauerleistung des Speicher-Wärmetauschers [kW]. */
  coilOutput?: number;
  /** Erzeugerleistung im Warmwasserbetrieb [kW]. */
  generatorCapacity?: number;
  singleOrTwoFamilyHouse?: boolean;
  rented?: boolean;
  freshWaterStation?: boolean;
  peak?: PeakDrawInput;
  circulation?: Omit<CirculationInput, 'content'>;
}

/**
 * Vollständiges Ergebnis.
 *
 * `DomesticHotWaterDesign` ist die Schnittstelle zum Modell und trägt die
 * Kennzahlen; die Zusatzfelder tragen die Herleitung. Beides zusammen, damit
 * ein Ergebnis nicht ohne seine Begründung weitergereicht werden kann.
 */
export interface DomesticWaterResult extends DomesticHotWaterDesign {
  demand: DemandIndexResult;
  storage: StorageSizingResult;
  reheat: ReheatResult;
  legionella: LegionellaAssessment;
  circulation: CirculationAssessment;
  /** Nächste Speichergröße aus dem Katalog [l], falls vorhanden. */
  catalogVolume?: number;
  /** Alle Rechenschritte in Reihenfolge. */
  steps: string[];
}

/**
 * Trinkwasserauslegung in einem Durchgang.
 *
 * Reihenfolge der Entscheidungen — sie ist nicht beliebig:
 *  1. Bedarfskennzahl N (beschreibt den Bedarf, nicht das Gerät),
 *  2. Speichervolumen über beide Wege, der größere gewinnt,
 *  3. Legionellenregime aus diesem Volumen, weil es die Speichertemperatur
 *     setzt,
 *  4. Volumen und Aufheizleistung mit der maßgebenden Temperatur,
 *  5. Zirkulation aus dem Leitungsinhalt,
 *  6. Hygienehinweise.
 *
 * Schritt 3 vor Schritt 4 ist der Punkt, an dem viele Auslegungen schiefgehen:
 * wer die Aufheizleistung mit 50 °C rechnet und danach feststellt, dass 60 °C
 * gefordert sind, hat den Wärmetauscher um ein Viertel zu klein. Die Temperatur
 * wirkt aber auf beide Größen — bei 60 °C statt 50 °C deckt derselbe Liter
 * Speicherinhalt ein Viertel mehr Zapfmenge ab. Deshalb wird in Schritt 4 auch
 * das Volumen neu gerechnet; die Einstufung aus Schritt 3 bleibt dabei stehen,
 * damit die Rechnung nicht zwischen zwei Zuständen hin- und herspringt.
 */
export function designDomesticHotWater(input: DomesticWaterInput): DomesticWaterResult {
  const cold = input.coldWaterTemperature ?? COLD_WATER_REFERENCE;
  const steps: string[] = [];
  const notes: PlanningNote[] = [];
  const occupants = input.units * input.occupantsPerUnit;

  // 1 — Bedarfskennzahl.
  const groups: DwellingGroup[] = input.dwellings ?? [
    { label: 'Wohnung', count: input.units, persons: input.occupantsPerUnit, tapPoints: defaultTapPoints(input.comfort) },
  ];
  const demand = demandIndex(groups);
  steps.push('— Bedarfskennzahl N nach DIN 4708 —', ...demand.steps);
  notes.push(...demand.notes);

  // 2 — Speichervolumen.
  // Vorbelegung der Bedarfsspitze nur für Ein- und Zweifamilienhäuser: dort ist
  // der Abendfall „jeder duscht, einmal wird gebadet" realistisch. Im
  // Geschosswohnungsbau wäre dieselbe Annahme eine erfundene Gleichzeitigkeit —
  // die bildet DIN 4708 über N und die Leistungskennzahl N_L des Speichers ab.
  // Deshalb bleibt die Spitze dort leer, bis sie jemand angibt.
  const peak: PeakDrawInput | undefined =
    input.peak ??
    (input.units <= 2
      ? {
          showers: Math.ceil(occupants / 2),
          baths: input.comfort === 'sparsam' ? 0 : input.units,
          duration: 1,
          reheatDuringPeak: input.generatorCapacity,
        }
      : undefined);
  if (!peak) {
    notes.push({
      severity: 'info',
      text:
        `Für ${input.units} Wohneinheiten wird keine Bedarfsspitze vorbelegt — die Gleichzeitigkeit im Geschosswohnungsbau ist keine ` +
        `Annahme, die das Programm treffen darf. Maßgebend ist hier der Vergleich der Bedarfskennzahl N = ${de(demand.demandIndex, 2)} mit ` +
        'der Leistungskennzahl N_L des Speichers aus dem Herstellerdatenblatt. Eine eigene Spitze kann über `peak` angegeben werden.',
    });
  }
  const sizeAt = (temperature: number): StorageSizingResult =>
    sizeStorage({
      occupants,
      comfort: input.comfort,
      storageTemperature: temperature,
      coldWaterTemperature: cold,
      peak,
    });

  const firstPass = sizeAt(input.storageTemperature);
  steps.push('— Speichervolumen —', ...firstPass.steps);
  notes.push(...firstPass.notes);

  const firstVolume = input.storageVolume ?? firstPass.required;
  const firstCatalog = selectStorage('dhw-cylinder', firstVolume);

  // 3 — Legionellenregime; es setzt die Speichertemperatur.
  const branchContentResult = input.branch ? branchContent(input.branch) : undefined;
  if (branchContentResult) {
    steps.push('— Leitungsinhalt Erwärmer → entfernteste Entnahmestelle —');
    branchContentResult.parts.forEach((p) => steps.push(`   ${p.label}: ${de(p.length, 1)} m × ${de(p.contentPerMetre, 3)} l/m = ${de(p.content, 2)} l`));
    steps.push(`   Summe ${de(branchContentResult.content, 2)} l`);
    notes.push(...branchContentResult.notes);
  }
  const branchVolume = branchContentResult?.content ?? input.longestBranchContent ?? 0;

  // Beurteilt wird der Speicher, der tatsächlich aufgestellt wird — also die
  // Kataloggröße und nicht der rechnerische Zwischenwert. Zwischen 400 l
  // Bedarf und einem 500-l-Behälter liegt die Grenze der W 551.
  const legionella = assessLegionella({
    storageVolume: input.freshWaterStation ? 0 : (firstCatalog?.volume ?? firstVolume),
    longestBranchContent: branchVolume,
    singleOrTwoFamilyHouse: input.singleOrTwoFamilyHouse,
    rented: input.rented,
    freshWaterStation: input.freshWaterStation,
    storageTemperature: input.storageTemperature,
  });
  steps.push('— Legionellen nach DVGW W 551 —', legionella.reason);
  notes.push(...legionella.notes);

  const storageTemperature = Math.max(input.storageTemperature, legionella.regime === 'großanlage' ? legionella.requiredStorageTemperature : 0);

  // Die angehobene Temperatur wirkt auf beides: auf die Aufheizleistung *und*
  // auf das Volumen. Wer nur die Leistung nachzieht, legt einen Speicher aus,
  // der für 60 °C um ein Viertel zu groß ist — und rechnet sich damit
  // anschließend eine Aufheizleistung heraus, die kein Erzeuger liefert.
  // Deshalb wird das Volumen mit der maßgebenden Temperatur neu gerechnet.
  // Die Einstufung bleibt dabei stehen: dass der Speicher durch die höhere
  // Temperatur kleiner wird, ist eine Folge der Einstufung und darf sie nicht
  // aufheben — sonst schwingt die Rechnung zwischen beiden Zuständen.
  let storage = firstPass;
  if (storageTemperature > input.storageTemperature) {
    steps.push(
      `Die Speichertemperatur wird von ${de(input.storageTemperature, 0)} °C auf die geforderten ${de(storageTemperature, 0)} °C angehoben. ` +
        'Volumen und Aufheizleistung rechnen mit diesem Wert; die Einstufung als Großanlage bleibt bestehen, auch wenn der Speicher dadurch kleiner ausfällt.',
    );
    if (input.storageVolume === undefined) {
      storage = sizeAt(storageTemperature);
      steps.push(`— Speichervolumen bei ${de(storageTemperature, 0)} °C —`, ...storage.steps);
      // Nur die Hinweise nachtragen, die im ersten Durchgang nicht schon standen.
      storage.notes.filter((n) => !notes.some((existing) => existing.text === n.text)).forEach((n) => notes.push(n));
    }
  }

  const recommendedVolume = input.storageVolume ?? storage.required;
  const catalog = selectStorage('dhw-cylinder', recommendedVolume);
  if (catalog) {
    steps.push(`Nächste Kataloggröße: ${catalog.label} (${catalog.volume} l, Wärmetauscher ${de(catalog.coilArea ?? 0, 1)} m², Dauerleistung ${de(catalog.continuousOutput ?? 0, 1)} kW).`);
    // Der Katalog endet bei 1000 l. Ohne diesen Hinweis würde die Empfehlung
    // stillschweigend unter den rechnerischen Bedarf rutschen.
    if (catalog.volume < recommendedVolume - 1) {
      notes.push({
        severity: 'warn',
        text:
          `Der rechnerische Bedarf von ${Math.round(recommendedVolume)} l übersteigt die größte Kataloggröße von ${catalog.volume} l. ` +
          'Zu prüfen sind mehrere Speicher in Reihe, eine Speicherladung mit höherer Leistung und kürzerer Vorhaltezeit oder eine ' +
          'Frischwasserstation an einem Heizungspuffer.',
      });
    }
  }

  // 4 — Aufheizleistung mit der maßgebenden Temperatur.
  const reheat = reheatPower({
    volume: catalog?.volume ?? recommendedVolume,
    storageTemperature,
    coldWaterTemperature: cold,
    reheatTime: input.reheatTime,
    coilOutput: input.coilOutput ?? catalog?.continuousOutput,
    generatorCapacity: input.generatorCapacity,
  });
  steps.push('— Aufheizleistung —', ...reheat.steps);
  notes.push(...reheat.notes);

  // 5 — Zirkulation.
  const circulation = assessCirculation({ ...(input.circulation ?? {}), content: branchVolume, hotTemperature: storageTemperature });
  steps.push('— Zirkulation nach DIN 1988-200 —', circulation.reason);
  notes.push(...circulation.notes);

  // 6 — Hygiene.
  notes.push(...hygieneNotes({ circulationRequired: circulation.required, regime: legionella.regime, freshWaterStation: input.freshWaterStation }));

  if (input.tapTemperature > storageTemperature) {
    notes.push({ severity: 'error', text: `Die Zapftemperatur von ${de(input.tapTemperature, 0)} °C liegt über der Speichertemperatur von ${de(storageTemperature, 0)} °C — das ist ohne Nacherwärmung nicht darstellbar.` });
  }
  if (storageTemperature >= 60 && input.tapTemperature < 55) {
    notes.push({
      severity: 'info',
      text: 'Ab 60 °C Speichertemperatur ist ein thermostatischer Verbrühschutz vorzusehen (Zentralmischer oder Mischer je Wohnung). Er senkt die Zapftemperatur, ohne die Hygienetemperatur im Speicher anzutasten.',
    });
  }

  return {
    demandIndex: demand.demandIndex,
    occupants: round(occupants, 1),
    units: input.units,
    recommendedVolume: catalog?.volume ?? Math.round(recommendedVolume),
    reheatCapacity: reheat.required,
    reheatTime: reheat.time,
    storageTemperature,
    tapTemperature: input.tapTemperature,
    legionellaRegime: legionella.regime,
    legionellaReason: legionella.reason,
    circulationRequired: circulation.required,
    circulationReason: circulation.reason,
    notes,
    demand,
    storage,
    reheat,
    legionella,
    circulation,
    catalogVolume: catalog?.volume,
    steps,
  };
}
