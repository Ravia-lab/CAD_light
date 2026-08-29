/**
 * Armaturen mit Voreinstellung — vom erforderlichen kv zum Einstellwert.
 * ---------------------------------------------------------------------------
 * Der hydraulische Abgleich rechnet bis zum **erforderlichen kv-Wert** und
 * hört dort auf. Das ist die Stelle, an der jede Software den Monteur allein
 * lässt: „kv = 0,31" steht an keinem Ventil. Am Ventil steht eine Zahl von 1
 * bis 8, und welche das ist, sagt die Herstellertabelle.
 *
 * Dieses Modul hält genau diese Tabellen — vollständig, mit Quelle, und nur
 * für Baureihen, deren Werte als Tabelle veröffentlicht sind. Oventrop AV6/AV9
 * fehlt bewusst: Oventrop publiziert ausschließlich Auslegungsdiagramme, und
 * eine aus einem Diagramm abgelesene Zahl ohne Kennzeichnung wäre genau die
 * Sorte erfundener Wert, die dieses Projekt nicht produziert.
 *
 * Definitionen (delta-q/IfHK, „Druckverluste in thermostatischen
 * Heizkörperventilen", S. 4 f.):
 *
 *   kv  = Volumenstrom [m³/h] bei Δp₀ = 1 bar über der Armatur, ρ₀ = 1000 kg/m³
 *   kvs = kv bei voller Öffnung
 *   kv  = V̇ · sqrt(Δp₀/Δp · ρ/ρ₀)
 *   Δp  = (V̇/kv)² · (ρ/ρ₀) · Δp₀
 *
 * Der Proportionalbereich x_p gehört zu jeder kv-Angabe eines
 * Thermostatventils dazu: dasselbe Ventil hat bei x_p = 1 K einen anderen
 * kv als bei x_p = 2 K. Wer die Spalte nicht mitführt, vergleicht Zahlen,
 * die nicht zueinander gehören. Auslegungsempfehlung: x_p = 2 K
 * (delta-q/IfHK: „nicht kleiner als 1 K, ca. 2 K am günstigsten").
 */

/** Referenzdruck der kv-Definition [Pa] = 1 bar. */
export const KV_REFERENCE_PRESSURE = 100_000;

/** Referenzdichte der kv-Definition [kg/m³]. */
export const KV_REFERENCE_DENSITY = 1000;

/**
 * Mindest-Ventilautorität a_V.
 *
 * a_V = Δp_Ventil / (Δp_Ventil + Δp_Netz). Unter 0,3 verformt sich die
 * Grundkennlinie so stark, dass der Regelkreis in den Auf-Zu-Betrieb kippen
 * kann. Quelle: hydraulischer-abgleich.de, Wissensbox „Ventilautorität";
 * gleichlautend Haustec und IKZ/Resideo. Ein normativ verbindlicher Wert
 * existiert nicht — das ist ein Erfahrungswert der Fachliteratur.
 */
export const MIN_VALVE_AUTHORITY = 0.3;

/** Auslegungsziel der Ventilautorität (IKZ/Resideo: ideal 0,5). */
export const TARGET_VALVE_AUTHORITY = 0.5;

/**
 * Obere Grenze, ab der die Autorität unwirtschaftlich wird.
 *
 * Über 0,6 steigen Anlagendruckverlust und Pumpenstrom, ohne dass die
 * Regelgüte noch nennenswert besser wird (win-ing.de).
 */
export const MAX_VALVE_AUTHORITY = 0.6;

/**
 * Höchster Differenzdruck am Thermostatventil [Pa] — Geräuschgrenze.
 *
 * VdZ-Leitfaden „Hydraulischer Abgleich in Heizungsanlagen", S. 32: „Zur
 * Vermeidung von Strömungsgeräuschen dürfen Thermostatventile nur bis zu
 * einem max. Differenzdruck von 15 kPa betrieben werden (Betrachtung bei
 * Teillast)." SAENA nennt 20 kPa als schalltechnische Obergrenze.
 *
 * Der Zusatz „bei Teillast" ist der eigentliche Punkt: im Teillastfall
 * wandert Druck aus Rohren und festen Widerständen auf das Ventil. Die
 * Auslegung mit 10 kPa kann bei halbem Volumenstrom auf über 20 kPa laufen.
 */
export const MAX_THERMOSTAT_PRESSURE = 15_000;

/** Schalltechnische Obergrenze [Pa] nach SAENA (200 mbar). */
export const NOISE_LIMIT_PRESSURE = 20_000;

/**
 * Auslegungsdifferenzdruck am Thermostatventil [Pa], wenn das Netz unbekannt
 * ist. VdZ-Leitfaden S. 25: 8–10 kPa; IKZ nennt 10–15 kPa.
 */
export const DEFAULT_THERMOSTAT_PRESSURE = 10_000;

/** Rolle der Armatur im Abgleich. */
export type ValveRole =
  /** Thermostatventil am Heizkörper (Vorlauf). */
  | 'thermostat'
  /** Rücklaufverschraubung. */
  | 'lockshield'
  /** Strangregulierventil. */
  | 'balancing';

/** Eine Voreinstellstufe mit ihrem kv-Wert. */
export interface ValveStep {
  /** Beschriftung, wie sie am Ventil steht ("1", "3,5", "N", "2 U"). */
  setting: string;
  /** kv [m³/h] bei dieser Stufe. */
  kv: number;
}

/** Eine Baureihe mit veröffentlichter kv-Tabelle. */
export interface ValveModel {
  id: string;
  label: string;
  role: ValveRole;
  /** Nennweiten, für die diese Tabelle gilt. */
  dn: number[];
  /**
   * Proportionalbereich, für den die kv-Werte gelten [K].
   * Nur beim Thermostatventil belegt; bei Regulier- und Absperrarmaturen
   * ohne Bedeutung (dort steht `undefined`).
   */
  xp?: number;
  steps: ValveStep[];
  /** kv bei voller Öffnung [m³/h]. */
  kvs: number;
  /** Quelle der Tabelle. */
  source: string;
}

/**
 * IMI Heimeier V-exact II, Ventilunterteile DN 10/15/20.
 *
 * Quelle: IMI Heimeier, Datenblatt V-exact II Thermostat-Ventilunterteile.
 * Zwei Tabellen, weil x_p die Werte verschiebt — die 2-K-Reihe ist die
 * Auslegungsreihe, die 1-K-Reihe die schärfere Betrachtung.
 */
export const HEIMEIER_V_EXACT_II_XP2: ValveModel = {
  id: 'heimeier-v-exact-ii-xp2',
  label: 'IMI Heimeier V-exact II (x_p = 2 K)',
  role: 'thermostat',
  dn: [10, 15, 20],
  xp: 2,
  steps: [
    { setting: '1', kv: 0.049 },
    { setting: '2', kv: 0.09 },
    { setting: '3', kv: 0.15 },
    { setting: '4', kv: 0.265 },
    { setting: '5', kv: 0.33 },
    { setting: '6', kv: 0.47 },
    { setting: '7', kv: 0.59 },
    { setting: '8', kv: 0.67 },
  ],
  kvs: 0.86,
  source: 'IMI Heimeier, Datenblatt V-exact II Thermostat-Ventilunterteile',
};

export const HEIMEIER_V_EXACT_II_XP1: ValveModel = {
  id: 'heimeier-v-exact-ii-xp1',
  label: 'IMI Heimeier V-exact II (x_p = 1 K)',
  role: 'thermostat',
  dn: [10, 15, 20],
  xp: 1,
  steps: [
    { setting: '1', kv: 0.049 },
    { setting: '2', kv: 0.082 },
    { setting: '3', kv: 0.13 },
    { setting: '4', kv: 0.215 },
    { setting: '5', kv: 0.246 },
    { setting: '6', kv: 0.303 },
    { setting: '7', kv: 0.335 },
    { setting: '8', kv: 0.343 },
  ],
  kvs: 0.86,
  source: 'IMI Heimeier, Datenblatt V-exact II Thermostat-Ventilunterteile',
};

/**
 * Danfoss RA-N, voreinstellbare Ventilgehäuse, kv mit RA-2000-Fühler.
 *
 * Quelle: Danfoss, Datenblatt „Voreinstellbare Ventilgehäuse Typ RA-N",
 * AI147386403838de-010402. Voreinstellung in 0,5er-Schritten zwischen 1
 * und N; hier sind die veröffentlichten Stützstellen hinterlegt.
 */
export const DANFOSS_RA_N_15_XP2: ValveModel = {
  id: 'danfoss-ra-n-15-xp2',
  label: 'Danfoss RA-N 15 (x_p = 2 K)',
  role: 'thermostat',
  dn: [15],
  xp: 2,
  steps: [
    { setting: '1', kv: 0.04 },
    { setting: '2', kv: 0.09 },
    { setting: '3', kv: 0.16 },
    { setting: '4', kv: 0.25 },
    { setting: '5', kv: 0.36 },
    { setting: '6', kv: 0.43 },
    { setting: '7', kv: 0.52 },
    { setting: 'N', kv: 0.73 },
  ],
  kvs: 0.9,
  source: 'Danfoss, Datenblatt RA-N, AI147386403838de-010402',
};

export const DANFOSS_RA_N_10_XP2: ValveModel = {
  id: 'danfoss-ra-n-10-xp2',
  label: 'Danfoss RA-N 10 (x_p = 2 K)',
  role: 'thermostat',
  dn: [10],
  xp: 2,
  steps: [
    { setting: '1', kv: 0.04 },
    { setting: '2', kv: 0.09 },
    { setting: '3', kv: 0.16 },
    { setting: '4', kv: 0.25 },
    { setting: '5', kv: 0.32 },
    { setting: '6', kv: 0.38 },
    { setting: '7', kv: 0.42 },
    { setting: 'N', kv: 0.56 },
  ],
  kvs: 0.65,
  source: 'Danfoss, Datenblatt RA-N, AI147386403838de-010402',
};

export const DANFOSS_RA_N_20_XP2: ValveModel = {
  id: 'danfoss-ra-n-20-xp2',
  label: 'Danfoss RA-N 20/25 (x_p = 2 K)',
  role: 'thermostat',
  dn: [20, 25],
  xp: 2,
  steps: [
    { setting: '1', kv: 0.1 },
    { setting: '2', kv: 0.16 },
    { setting: '3', kv: 0.24 },
    { setting: '4', kv: 0.33 },
    { setting: '5', kv: 0.44 },
    { setting: '6', kv: 0.56 },
    { setting: '7', kv: 0.73 },
    { setting: 'N', kv: 1.04 },
  ],
  kvs: 1.4,
  source: 'Danfoss, Datenblatt RA-N, AI147386403838de-010402',
};

/**
 * IMI Heimeier Regulux — Rücklaufverschraubung, Voreinstellung über
 * Schraubendreher-Umdrehungen.
 *
 * Quelle: IMI Heimeier, Datenblatt Regulux, Abschnitt „Technische Daten".
 */
export const HEIMEIER_REGULUX: ValveModel = {
  id: 'heimeier-regulux',
  label: 'IMI Heimeier Regulux (Umdrehungen)',
  role: 'lockshield',
  dn: [10, 15, 20],
  steps: [
    { setting: '0', kv: 0.09 },
    { setting: '0,5', kv: 0.19 },
    { setting: '1', kv: 0.3 },
    { setting: '2', kv: 0.65 },
    { setting: '3', kv: 1.01 },
    { setting: '4', kv: 1.31 },
  ],
  kvs: 1.31,
  source: 'IMI Heimeier, Datenblatt Regulux',
};

/**
 * IMI TA STAD — Strangregulierventil, kv je Handradumdrehung.
 *
 * Quelle: IMI TA, Datenblatt STAD Einregulierungsventile DN 15–50.
 * Einbauhinweis aus derselben Quelle: Beruhigungsstrecken 2 D vor und 5 D
 * nach Armaturen, 10 D nach Pumpen.
 */
const STAD_TURNS = ['0,5', '1,0', '1,5', '2,0', '2,5', '3,0', '3,5', '4,0'];

const STAD_KV: Record<number, (number | null)[]> = {
  10: [null, 0.09, 0.137, 0.26, 0.48, 0.826, 1.26, 1.47],
  15: [0.127, 0.212, 0.314, 0.571, 0.877, 1.38, 1.98, 2.52],
  20: [0.511, 0.757, 1.19, 1.9, 2.8, 3.87, 4.75, 5.7],
  25: [0.6, 1.03, 2.1, 3.62, 5.3, 6.9, 8.0, 8.7],
  32: [1.14, 1.9, 3.1, 4.66, 7.1, 9.5, 11.8, 14.2],
  40: [1.75, 3.3, 4.6, 6.1, 8.8, 12.6, 16.0, 19.2],
  50: [2.56, 4.2, 7.2, 11.7, 16.2, 21.5, 26.5, 33.0],
};

/** Alle STAD-Baugrößen als Baureihen. */
export const IMI_TA_STAD: ValveModel[] = Object.entries(STAD_KV).map(([dn, werte]) => ({
  id: `imi-ta-stad-dn${dn}`,
  label: `IMI TA STAD DN ${dn} (Umdrehungen)`,
  role: 'balancing' as ValveRole,
  dn: [Number(dn)],
  steps: werte
    .map((kv, i) => (kv === null ? null : { setting: STAD_TURNS[i], kv }))
    .filter((s): s is ValveStep => s !== null),
  kvs: werte[werte.length - 1] ?? 0,
  source: 'IMI TA, Datenblatt STAD Einregulierungsventile DN 15–50',
}));

/** Alle hinterlegten Baureihen. */
export const VALVE_MODELS: ValveModel[] = [
  HEIMEIER_V_EXACT_II_XP2,
  HEIMEIER_V_EXACT_II_XP1,
  DANFOSS_RA_N_10_XP2,
  DANFOSS_RA_N_15_XP2,
  DANFOSS_RA_N_20_XP2,
  HEIMEIER_REGULUX,
  ...IMI_TA_STAD,
];

/** Vorgabebaureihe je Rolle — die mit der breitesten Marktverbreitung. */
export const DEFAULT_MODEL_BY_ROLE: Record<ValveRole, string> = {
  thermostat: 'heimeier-v-exact-ii-xp2',
  lockshield: 'heimeier-regulux',
  balancing: 'imi-ta-stad-dn15',
};

export function findValveModel(id: string): ValveModel | undefined {
  return VALVE_MODELS.find((m) => m.id === id);
}

/**
 * Passende Baureihe für Rolle und Nennweite.
 *
 * Gibt es für die Nennweite keine eigene Tabelle, wird die nächstkleinere
 * genommen und das im Ergebnis vermerkt — eine Baureihe zu erfinden wäre
 * schlimmer als eine gekennzeichnete Näherung.
 */
export function modelFor(role: ValveRole, dn: number): ValveModel | undefined {
  const passend = VALVE_MODELS.filter((m) => m.role === role);
  if (!passend.length) return undefined;
  const exakt = passend.find((m) => m.dn.includes(dn));
  if (exakt) return exakt;
  if (role === 'balancing') {
    // Strangregulierventile gibt es je Nennweite. Die nächstkleinere Tabelle
    // ist die konservative Wahl: sie drosselt eher zu viel als zu wenig.
    const sortiert = [...passend].sort((a, b) => Math.max(...a.dn) - Math.max(...b.dn));
    let treffer = sortiert[0];
    for (const m of sortiert) if (Math.max(...m.dn) <= dn) treffer = m;
    return treffer;
  }
  return passend.find((m) => m.id === DEFAULT_MODEL_BY_ROLE[role]) ?? passend[0];
}

/** Urteil zur gewählten Voreinstellung. */
export type PresetFit =
  /** Der erforderliche kv liegt im Stufenbereich. */
  | 'passt'
  /** Kleiner als die kleinste Stufe: das Ventil drosselt nicht genug. */
  | 'unter-bereich'
  /** Größer als die größte Stufe: das Ventil ist zu klein. */
  | 'ueber-bereich';

export interface PresetSelection {
  model: ValveModel;
  /** Beschriftung der gewählten Stufe. */
  setting: string;
  /** kv der gewählten Stufe [m³/h]. */
  kv: number;
  /** Erforderlicher kv [m³/h]. */
  requiredKv: number;
  /** Relative Abweichung (kv_Stufe − kv_erf) / kv_erf. */
  deviation: number;
  fit: PresetFit;
  /**
   * Tatsächlicher Druckverlust über der Armatur mit der gewählten Stufe [Pa].
   * Er weicht vom geforderten ab, weil die Stufen diskret sind — genau diese
   * Differenz ist der Grund, warum ein Abgleich nie exakt aufgeht.
   */
  actualPressure: number;
}

/**
 * Erforderlicher kv-Wert aus Volumenstrom und Drosseldruck.
 *
 * kv = V̇ · sqrt(Δp₀/Δp · ρ/ρ₀).
 *
 * @param flow      Volumenstrom [m³/h]
 * @param pressure  abzudrosselnder Differenzdruck [Pa]
 * @param density   Dichte des Heizmittels [kg/m³]
 */
export function requiredKv(flow: number, pressure: number, density = KV_REFERENCE_DENSITY): number {
  if (!(pressure > 0) || !(flow > 0)) return 0;
  return flow * Math.sqrt((KV_REFERENCE_PRESSURE / pressure) * (density / KV_REFERENCE_DENSITY));
}

/**
 * Druckverlust über einer Armatur mit bekanntem kv.
 *
 * Δp = (V̇/kv)² · (ρ/ρ₀) · Δp₀.
 */
export function pressureFromKv(flow: number, kv: number, density = KV_REFERENCE_DENSITY): number {
  if (!(kv > 0) || !(flow > 0)) return 0;
  return (flow / kv) ** 2 * (density / KV_REFERENCE_DENSITY) * KV_REFERENCE_PRESSURE;
}

/**
 * Voreinstellstufe zu einem erforderlichen kv.
 *
 * Gewählt wird die Stufe mit dem **kleinsten kv, der noch mindestens den
 * erforderlichen Durchfluss liefert** — also die nächstgrößere. Die
 * umgekehrte Wahl wäre die kleinere Stufe: sie drosselt stärker, der
 * Heizkörper bekommt zu wenig, und der Raum wird nicht warm. Zu viel
 * Durchfluss kostet Energie, zu wenig kostet Behaglichkeit; im Zweifel
 * gewinnt der warme Raum.
 */
export function selectPreset(
  required: number,
  model: ValveModel,
  flow: number,
  density = KV_REFERENCE_DENSITY,
): PresetSelection {
  const stufen = [...model.steps].sort((a, b) => a.kv - b.kv);
  let gewaehlt = stufen[stufen.length - 1];
  let fit: PresetFit = 'ueber-bereich';
  if (required <= stufen[0].kv) {
    gewaehlt = stufen[0];
    // Unter der kleinsten Stufe kann die Armatur nicht genug drosseln: sie
    // lässt mehr durch als gewollt.
    fit = required < stufen[0].kv * 0.98 ? 'unter-bereich' : 'passt';
  } else {
    for (const s of stufen) {
      if (s.kv >= required) {
        gewaehlt = s;
        fit = 'passt';
        break;
      }
    }
  }
  return {
    model,
    setting: gewaehlt.setting,
    kv: gewaehlt.kv,
    requiredKv: required,
    deviation: required > 0 ? (gewaehlt.kv - required) / required : 0,
    fit,
    actualPressure: pressureFromKv(flow, gewaehlt.kv, density),
  };
}

/**
 * Ventilautorität a_V = Δp_Ventil / (Δp_Ventil + Δp_Netz).
 *
 * `networkLoss` ist der Druckverlust des volumenstromvariablen Netzteils,
 * also der Kreis ohne das Ventil selbst.
 */
export function valveAuthority(valveLoss: number, networkLoss: number): number {
  const gesamt = valveLoss + networkLoss;
  if (!(gesamt > 0)) return 0;
  return valveLoss / gesamt;
}

/** Urteil zur Autorität in Worten. */
export function authorityVerdict(a: number): 'gut' | 'grenzwertig' | 'zu klein' | 'unwirtschaftlich' {
  if (a < MIN_VALVE_AUTHORITY) return 'zu klein';
  if (a > MAX_VALVE_AUTHORITY) return 'unwirtschaftlich';
  if (a < TARGET_VALVE_AUTHORITY) return 'grenzwertig';
  return 'gut';
}
