/**
 * Auslegungsleistung je Heizfläche — die Größe, aus der der Volumenstrom folgt.
 * ---------------------------------------------------------------------------
 * **Befund A2.** Der hydraulische Abgleich rechnete den Volumenstrom jeder
 * Heizfläche aus ihrer **installierten Normleistung** (`powerW`). Maßgebend
 * ist aber die Leistung im Auslegungsfall, also die **Raumheizlast**:
 *
 *     V̇ = Φ_Raum / (ρ · c · σ)
 *
 * (VdZ-Leitfaden Hydraulischer Abgleich, Verfahren B; DIN EN 14336). Eine
 * Normleistung bei 75/65/20 °C liegt bei einer Wärmepumpe mit 50/40 °C um
 * das Zweieinhalbfache über der Leistung, die der Heizkörper im
 * Auslegungsfall abgibt; ein überdimensionierter Bestandsheizkörper noch
 * mehr. Volumenstrom, Druckverlust (quadratisch), Voreinstellung,
 * Ventilautorität und Förderhöhe waren entsprechend zu groß.
 *
 * **Rangfolge je Heizfläche.**
 *  1. Raumheizlast — gerechnete Norm-Heizlast aus RaVia vor dem Überschlag —,
 *     auf mehrere Heizflächen eines Raums nach ihrer Leistung im
 *     Betriebspunkt geteilt, ohne Angaben gleichmäßig.
 *  2. Ohne Raumlast: die Leistung der Heizfläche **im Betriebspunkt** —
 *     beim Heizkörper aus der Normleistung über DIN EN 442-2 umgerechnet,
 *     beim Fußbodenheizkreis seine Auslegungsleistung.
 *  3. Sonst nichts. Der Aufrufer entscheidet über den Rückfall und macht ihn
 *     sichtbar.
 *
 * Schichtgrenze: lib-Bausteine ohne Store.
 */

import type { BimDocument, Fixture } from '../types/bim';
import { estimateHeatLoad } from './heatLoadEstimate';
import { logMeanOverTemperature } from './hydraulics';
import { exponentFuer, heizleistung, istEn442, NORM_UEBERTEMPERATUR_EN442 } from './normleistung';
import { systemtemperaturVon } from './systemtemperatur';

export type VerbraucherlastQuelle = 'raumlast' | 'betriebspunkt';

export interface Verbraucherlast {
  /** Leistung im Auslegungsfall [W]. */
  watt: number;
  quelle: VerbraucherlastQuelle;
  /** Zahl der Heizflächen, auf die die Raumlast geteilt wurde. */
  anteile?: number;
}

/** Bauarten, die eine Raumlast tragen: Heizkörper und Fußbodenheizkreis. */
export function traegtRaumlast(f: Pick<Fixture, 'type' | 'category'>): boolean {
  return istEn442(f.type) || f.type === 'underfloor';
}

/**
 * Leistung eines Heizkörpers im Betriebspunkt aus seiner Normleistung [W]:
 * Φ = Φ₇₅/₆₅/₂₀ · (Δθ_ln / 49,8)^n.
 */
export function leistungImBetriebspunkt(
  f: Pick<Fixture, 'type' | 'params'>,
  vorlauf: number,
  ruecklauf: number,
  raum = 20,
): number | undefined {
  const norm = heizleistung(f);
  if (!(typeof norm === 'number' && norm > 0)) return undefined;
  if (!istEn442(f.type)) return norm;
  const dt = logMeanOverTemperature(vorlauf, ruecklauf, raum);
  if (!(dt > 0)) return undefined;
  return norm * (dt / NORM_UEBERTEMPERATUR_EN442) ** exponentFuer(f.type, f.params);
}

/**
 * Auslegungsleistung je Heizfläche des Dokuments.
 *
 * @param raumlasten Raumheizlasten [W] je Raumkennung; ohne Angabe aus dem
 *   Überschlag bzw. der zurückgeschriebenen Norm-Heizlast.
 */
export function verbraucherLasten(
  doc: BimDocument,
  raumlasten?: Map<string, number>,
): Map<string, Verbraucherlast> {
  const lasten = raumlasten ?? raumlastenVon(doc);
  const temps = systemtemperaturVon(doc);
  const heizflaechen = (Object.values(doc.fixtures ?? {}) as Fixture[]).filter(traegtRaumlast);

  const jeRaum = new Map<string, Fixture[]>();
  for (const f of heizflaechen) {
    if (!f.roomId) continue;
    const liste = jeRaum.get(f.roomId) ?? [];
    liste.push(f);
    jeRaum.set(f.roomId, liste);
  }

  const raus = new Map<string, Verbraucherlast>();
  for (const f of heizflaechen) {
    const imRaum = f.roomId ? jeRaum.get(f.roomId) : undefined;
    const raumlast = f.roomId ? lasten.get(f.roomId) : undefined;
    if (imRaum && typeof raumlast === 'number' && raumlast > 0) {
      raus.set(f.id, { watt: raumlast * anteil(f, imRaum), quelle: 'raumlast', anteile: imRaum.length });
      continue;
    }
    const watt = betrieb(f);
    if (watt !== undefined && watt > 0) raus.set(f.id, { watt, quelle: 'betriebspunkt' });
  }
  return raus;

  function betrieb(f: Fixture): number | undefined {
    const raum = f.roomId ? doc.rooms?.[f.roomId]?.setpointTemperature : undefined;
    const vorlauf = f.type === 'underfloor' ? (f.params.flowTemperature ?? temps.vorlauf) : temps.vorlauf;
    const ruecklauf = f.type === 'underfloor' ? (f.params.returnTemperature ?? temps.ruecklauf) : temps.ruecklauf;
    return leistungImBetriebspunkt(f, vorlauf, ruecklauf, raum ?? 20);
  }

  /**
   * Anteil einer Heizfläche an der Raumlast: nach ihrer Leistung im
   * Betriebspunkt, wenn alle Flächen des Raums eine haben — zwei Heizkörper
   * mit 1400 und 900 W teilen die Last 14 : 9, wie sie es im Betrieb auch
   * tun. Fehlt auch nur eine Angabe, gleichmäßig; das ist eine Annahme.
   */
  function anteil(f: Fixture, imRaum: Fixture[]): number {
    if (imRaum.length === 1) return 1;
    const werte = imRaum.map((x) => betrieb(x) ?? 0);
    const summe = werte.reduce((a, b) => a + b, 0);
    if (werte.every((w) => w > 0) && summe > 0) return (betrieb(f) ?? 0) / summe;
    return 1 / imRaum.length;
  }
}

/** Raumheizlast [W] je Raum: Norm-Heizlast aus RaVia vor dem Überschlag. */
export function raumlastenVon(doc: BimDocument): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of estimateHeatLoad(doc).rooms) {
    const w = r.normHeatLoad ? r.normHeatLoad.total : r.total;
    if (Number.isFinite(w) && w > 0) m.set(r.roomId, w);
  }
  return m;
}

/** Für `balanceNetwork({ powerByFixture })`. */
export function leistungJeVerbraucher(doc: BimDocument, raumlasten?: Map<string, number>): Record<string, number> {
  const raus: Record<string, number> = {};
  for (const [id, l] of verbraucherLasten(doc, raumlasten)) raus[id] = l.watt;
  return raus;
}
