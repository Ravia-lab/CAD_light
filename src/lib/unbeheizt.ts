/**
 * Temperaturen unbeheizter Nachbarbereiche (seit 1.72.0).
 * ---------------------------------------------------------------------------
 *
 * **Warum es das gibt.** Bis 1.71.0 kannte das Programm genau eine
 * Temperatur für alles Unbeheizte, θ_u = 10 °C — für den Keller wie für den
 * Spitzboden. Gefunden an einem Bungalow von 1965 (TABULA SFH.05): Die Decke
 * zum unbeheizten, belüfteten Dachraum ging mit 10 °C dahinter in die
 * Rechnung. An einem Auslegungstag mit −12 °C ist es dort fast so kalt wie
 * draußen; die Deckenverluste waren um rund zwei Drittel zu klein.
 *
 * **Der Dachraum.** Fehlt eine eigene Angabe, gilt
 *
 *     θ_D = θ_i − f · (θ_i − θ_e),   f = 0,9
 *
 * mit dem Temperaturkorrekturfaktor für Dachböden. Jagnow/Wolff (Manuskript
 * für Recknagel/Sprenger, Taschenbuch, 2020, Tafel 0-6) nennen 1,0 für
 * offene bzw. stark belüftete Dächer, 0,8 … 0,9 für geschlossene, undichte
 * Dächer und 0,4 … 0,9 für geschlossene, dichte. Gewählt ist der obere Wert
 * des Regelfalls „geschlossen, undicht" — die vorsichtige Richtung für eine
 * Heizlast. Wer den Dachraum kennt, trägt seine Temperatur ein.
 *
 * **Unbeheizte Räume im Modell.** Ein Raum, der als unbeheizt markiert ist
 * (Treppenhaus, Abstellraum, Schacht), hat trotzdem eine Solltemperatur im
 * Datensatz. Bis 1.71.0 ging eine Wand dorthin mit dieser Solltemperatur in
 * die Rechnung — mit 20 °C, also ohne jeden Verlust. Gefunden an einem
 * Mehrfamilienhaus (TABULA MFH.08): Die Wohnungen grenzen an ein unbeheiztes
 * Treppenhaus, und keine einzige dieser Wände kam in der Bilanz vor. Jetzt
 * gilt dort θ_u.
 */

import type { BimDocument, Room } from '../types/bim';

/** Temperaturkorrekturfaktor des Dachraums, wenn nichts eingetragen ist. */
export const DACHRAUM_FAKTOR = 0.9;

/** Temperatur des unbeheizten Dachraums [°C] — eingetragen oder abgeleitet. */
export function dachraumTemperatur(meta: BimDocument['meta']): number {
  if (meta.atticTemperature !== undefined && Number.isFinite(meta.atticTemperature)) return meta.atticTemperature;
  const innen = meta.designIndoorTemperature;
  const aussen = meta.designOutdoorTemperature;
  return Math.round((innen - DACHRAUM_FAKTOR * (innen - aussen)) * 10) / 10;
}

/** Ist der Nachbarraum unbeheizt — und zählt deshalb mit θ_u statt mit seiner Solltemperatur? */
export function istUnbeheizterNachbar(nachbar: Room | undefined): boolean {
  return nachbar !== undefined && nachbar.isHeated === false;
}
