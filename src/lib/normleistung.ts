/**
 * Normwärmeleistung von Heizkörpern nach DIN EN 442-2 — die eine Stelle.
 * ---------------------------------------------------------------------------
 * **Festlegung F2 (gemeinsam mit RaVia und RaVia Scan).** Gespeichert und
 * ausgetauscht wird immer die Normwärmeleistung bei **75/65/20 °C** im Feld
 * `ratedPower` [W], zusammen mit `exponentN` und `ratedPowerSource`. Die
 * Leistung im Betriebspunkt wird nur gerechnet, nie gespeichert.
 *
 * **Warum das ein Rechenfehler war und kein Namensstreit (Befund A1).** Bis
 * 1.72.0 stand die Leistung in `powerW` und galt als „Normleistung bei
 * 55/45/20 °C". Katalog- und VDI-3805-Werte stehen aber bei 75/65/20. Wer
 * eine Katalogzahl ins Feld schrieb, bekam die Leistung bei Auslegungs-
 * temperatur um (49,8/29,7)^1,3 ≈ 1,96 zu hoch gerechnet — und Heizkörper,
 * die halb so groß waren wie nötig.
 *
 * **Übergang.** `powerW` an einem Heizkörper bleibt eine Fassung lang lesbar
 * und wird beim Laden umgerechnet: ratedPower = powerW · (49,8/29,7)^n.
 * Für Fußbodenheizkreise, Wärmeerzeuger und Warmwasserbereiter bleibt
 * `powerW` das Feld — dort gibt es keinen Normpunkt nach EN 442.
 *
 * Schichtgrenze: nur Typen.
 */

import type { Fixture, FixtureParams, FixtureType, RatedPowerSource } from '../types/bim';

/** Bauarten, deren Leistung nach DIN EN 442-2 angegeben wird. */
export const EN442_TYPEN: ReadonlySet<FixtureType> = new Set<FixtureType>([
  'radiator',
  'radiator-tube',
  'towel-radiator',
  'convector',
]);

export function istEn442(type: FixtureType): boolean {
  return EN442_TYPEN.has(type);
}

/** Normpunkt nach DIN EN 442-2 [°C]. */
export const NORMPUNKT_EN442 = { vorlauf: 75, ruecklauf: 65, raum: 20 } as const;

/** Norm-Übertemperatur bei 75/65/20 °C, logarithmisch, wie in Festlegung F2 [K]. */
export const NORM_UEBERTEMPERATUR_EN442 = 49.8;

/** Übertemperatur des alten CAD-Bezugspunkts 55/45/20 °C [K] — nur für den Übergang. */
export const ALT_UEBERTEMPERATUR_55_45 = 29.7;

/**
 * Branchenüblicher Heizkörperexponent je Bauart [-] — Annahme bis zum
 * Datenblatt. Steht hier, weil Umrechnung und Export denselben Wert brauchen.
 */
export const EXPONENT_RICHTWERT: Partial<Record<FixtureType, number>> = {
  radiator: 1.3,
  'radiator-tube': 1.3,
  'towel-radiator': 1.3,
  convector: 1.4,
  underfloor: 1.1,
};

export const RATED_POWER_SOURCE_LABELS: Record<RatedPowerSource, string> = {
  katalog: 'Katalog',
  typenschild: 'Typenschild',
  datenblatt: 'Datenblatt',
  schaetzung: 'Schätzung',
};

/** Exponent, mit dem gerechnet wird: erfasst, sonst Richtwert der Bauart. */
export function exponentFuer(type: FixtureType, params: FixtureParams): number {
  const n = params.exponentN;
  return typeof n === 'number' && n > 0 ? n : (EXPONENT_RICHTWERT[type] ?? 1.3);
}

/** Alte 55/45/20-Leistung → Normleistung 75/65/20 nach Festlegung F2 [W]. */
export function ratedPowerAusAlt(powerW: number, exponent: number): number {
  return Math.round(powerW * (NORM_UEBERTEMPERATUR_EN442 / ALT_UEBERTEMPERATUR_55_45) ** exponent);
}

/**
 * Die Leistung, die an einem Objekt steht [W].
 *
 * Heizkörper: Normleistung 75/65/20 (`ratedPower`); ein nicht umgerechnetes
 * `powerW` aus einer alten Datei wird dabei umgerechnet gelesen. Alle anderen
 * Bauarten: `powerW`.
 */
export function heizleistung(f: Pick<Fixture, 'type' | 'params'>): number | undefined {
  const p = f.params;
  if (!istEn442(f.type)) return p.powerW;
  if (typeof p.ratedPower === 'number') return p.ratedPower;
  if (typeof p.powerW === 'number' && p.powerW > 0) return ratedPowerAusAlt(p.powerW, exponentFuer(f.type, p));
  return undefined;
}

/**
 * Parameter einer Bauart auf die Felder nach Festlegung F2 heben.
 *
 * Unverändert zurück, wenn nichts zu tun ist (gleiche Referenz), damit
 * Aufrufer an der Identität erkennen, ob migriert wurde.
 */
export function migriereParams(type: FixtureType, params: FixtureParams): FixtureParams {
  const alt = params as FixtureParams & { radiatorExponent?: number };
  let p: FixtureParams & { radiatorExponent?: number } = params;
  if (typeof alt.radiatorExponent === 'number') {
    const { radiatorExponent, ...rest } = alt;
    p = { ...rest, ...(p.exponentN === undefined ? { exponentN: radiatorExponent } : {}) };
  }
  if (!istEn442(type) || p.powerW === undefined) return p;
  const { powerW, ...rest } = p;
  if (rest.ratedPower !== undefined || !(typeof powerW === 'number' && powerW > 0)) return rest;
  return {
    ...rest,
    ratedPower: ratedPowerAusAlt(powerW, exponentFuer(type, rest)),
    ...(rest.ratedPowerSource === undefined ? { ratedPowerSource: quelleAusHerkunft(rest.powerSource) } : {}),
  };
}

function quelleAusHerkunft(h: FixtureParams['powerSource']): RatedPowerSource {
  if (h === 'heizlast') return 'schaetzung';
  if (h === 'katalog' || h === 'ravia') return 'katalog';
  return 'datenblatt';
}

/** Alle Objekte eines Dokuments migrieren; dieselbe Sammlung, wenn nichts zu tun war. */
export function migriereFixtures<T extends Record<string, Fixture>>(fixtures: T): T {
  let geaendert = false;
  const neu: Record<string, Fixture> = {};
  for (const [id, f] of Object.entries(fixtures)) {
    const params = migriereParams(f.type, f.params ?? {});
    if (params !== f.params) {
      geaendert = true;
      neu[id] = { ...f, params };
    } else neu[id] = f;
  }
  return geaendert ? (neu as T) : fixtures;
}

/** Den Leistungswert schreiben — ins richtige Feld der Bauart. */
export function mitLeistung(
  type: FixtureType,
  params: FixtureParams,
  watt: number | undefined,
  quelle?: RatedPowerSource,
): FixtureParams {
  if (istEn442(type)) {
    const rest: FixtureParams = { ...params };
    delete rest.powerW;
    if (watt === undefined) {
      delete rest.ratedPower;
      delete rest.ratedPowerSource;
      return rest;
    }
    return { ...rest, ratedPower: watt, ...(quelle ? { ratedPowerSource: quelle } : {}) };
  }
  if (watt === undefined) {
    const ohne: FixtureParams = { ...params };
    delete ohne.powerW;
    return ohne;
  }
  return { ...params, powerW: watt };
}
