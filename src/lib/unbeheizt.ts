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
 *
 * **Keller, Treppenhaus, Abstellraum (seit 1.73.0, Befund B1).** Bis 1.72.0
 * stand dafür fest θ_u = 10 °C, unabhängig von θ_e. Bei θ_i = 20 °C und
 * θ_e = −12 °C entspricht das einem Temperaturkorrekturfaktor von 0,31 — weit
 * unter allen Tabellenwerten; die Verluste über Kellerdecke und
 * Treppenhauswand waren um ein Viertel bis über die Hälfte zu klein, und bei
 * kälterem Standort ging θ_u nicht mit. Jetzt gilt wie beim Dachraum
 *
 *     θ_u = θ_i − b_u · (θ_i − θ_e)
 *
 * mit b_u nach Art des Bereichs (DIN EN 12831 Beiblatt 1 bzw. DIN/TS 12831-1,
 * Tabelle der Temperaturkorrekturfaktoren; die Einzelwerte bestätigt Manuel
 * noch). Ein eingetragener oder von RaVia übernommener Wert geht vor.
 * θ_e kommt nach Festlegung F1 von RaVia.
 */

import type { BimDocument, Room, UnbeheizteArt } from '../types/bim';

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

/**
 * Temperaturkorrekturfaktor b_u je Art des unbeheizten Bereichs [-]
 * (DIN EN 12831 Beiblatt 1, Tabelle 3; DIN/TS 12831-1).
 */
export const B_U: Record<UnbeheizteArt, number> = {
  'keller-ohne-oeffnung': 0.5,
  'keller-mit-oeffnung': 0.8,
  'aussenwand-1': 0.4,
  'aussenwaende-2': 0.5,
  'aussenwaende-2-tuer': 0.6,
  'aussenwaende-3': 0.8,
};

export const UNBEHEIZT_ART_LABELS: Record<UnbeheizteArt, string> = {
  'keller-ohne-oeffnung': 'Keller ohne Fenster/Außentür (b_u 0,5)',
  'keller-mit-oeffnung': 'Keller mit Fenster/Außentür (b_u 0,8)',
  'aussenwand-1': 'Raum mit 1 Außenwand (b_u 0,4)',
  'aussenwaende-2': 'Raum mit 2 Außenwänden (b_u 0,5)',
  'aussenwaende-2-tuer': '2 Außenwände mit Außentür (b_u 0,6)',
  'aussenwaende-3': 'Raum mit 3 und mehr Außenwänden (b_u 0,8)',
};

/** Art des unbeheizten Bereichs unter bzw. neben dem Gebäude, wenn nichts eingetragen ist. */
export const UNBEHEIZT_ART_VORGABE: UnbeheizteArt = 'keller-ohne-oeffnung';

/** θ_i − b_u · (θ_i − θ_e), auf eine Nachkommastelle [°C]. */
export function temperaturAusBu(meta: BimDocument['meta'], bu: number): number {
  const innen = meta.designIndoorTemperature;
  const aussen = meta.designOutdoorTemperature;
  return Math.round((innen - bu * (innen - aussen)) * 10) / 10;
}

/** Ist θ_u ausdrücklich eingetragen (von Hand oder von RaVia)? */
export function unbeheiztEingetragen(meta: BimDocument['meta']): boolean {
  return typeof meta.unheatedTemperature === 'number' && Number.isFinite(meta.unheatedTemperature);
}

/**
 * θ_u des unbeheizten Bereichs ohne eigenen Raum im Modell — Keller unter dem
 * untersten Geschoss, Treppenhaus hinter einer als „unbeheizt" markierten
 * Wand [°C].
 */
export function unbeheizteTemperatur(meta: BimDocument['meta']): number {
  if (unbeheiztEingetragen(meta)) return meta.unheatedTemperature as number;
  return temperaturAusBu(meta, B_U[meta.unheatedKind ?? UNBEHEIZT_ART_VORGABE]);
}

/**
 * Art eines unbeheizten Raums im Modell, aus seiner Lage und seinen Wänden:
 * unter Gelände ein Keller (mit Öffnung nach außen oder ohne), sonst nach der
 * Zahl der Außenwände.
 */
export function unbeheizteArtVonRaum(doc: BimDocument, raum: Room): UnbeheizteArt {
  const aussen = raum.boundaries.filter((b) => b.boundary === 'exterior');
  const aussenWaende = new Set(aussen.map((b) => b.wallId));
  const oeffnungen = Object.values(doc.openings ?? {}).filter((o) => aussenWaende.has(o.wallId));
  const geschoss = doc.levels?.[raum.levelId];
  if (geschoss && geschoss.elevation < 0) {
    return oeffnungen.length ? 'keller-mit-oeffnung' : 'keller-ohne-oeffnung';
  }
  const n = aussenWaende.size;
  if (n >= 3) return 'aussenwaende-3';
  if (n === 2) return oeffnungen.some((o) => o.kind === 'door') ? 'aussenwaende-2-tuer' : 'aussenwaende-2';
  // Ohne jede Außenwand (innenliegender Abstellraum) ist 0,4 die nächste Zeile.
  return 'aussenwand-1';
}

/** θ_u eines unbeheizten Nachbarraums [°C]: Eintrag, sonst b_u nach seiner Art. */
export function unbeheizterRaumTemperatur(doc: BimDocument, raum: Room | undefined): number {
  if (unbeheiztEingetragen(doc.meta) || !raum) return unbeheizteTemperatur(doc.meta);
  return temperaturAusBu(doc.meta, B_U[unbeheizteArtVonRaum(doc, raum)]);
}

/**
 * θ_u einer geladenen Datei einordnen. Bis 1.72.0 stand dort fest 10 °C —
 * die alte Vorgabe, keine Eingabe; seit 1.73.0 bleibt der Wert leer und wird
 * aus b_u gerechnet. Ebenso ein Wert, den der Export selbst aus b_u abgeleitet
 * hat. Jeder andere Wert ohne Herkunft gilt als Eingabe.
 */
export function migriereUnbeheizt(meta: BimDocument['meta']): BimDocument['meta'] {
  const quelle = meta.unheatedTemperatureSource;
  if (quelle === 'b_u' || (quelle === undefined && meta.unheatedTemperature === 10)) {
    const { unheatedTemperature: _u, unheatedTemperatureSource: _q, ...rest } = meta;
    void _u;
    void _q;
    return rest;
  }
  if (typeof meta.unheatedTemperature === 'number' && quelle === undefined) {
    return { ...meta, unheatedTemperatureSource: 'eingabe' };
  }
  return meta;
}

/**
 * Temperatur hinter einer Wand zu fremder Nutzung oder zum Nachbargebäude,
 * wenn nichts eingetragen ist [°C] (Randbedingung `neighbour`, seit 1.73.0).
 * 15 °C ist der Ansatz für Räume fremder Nutzung bzw. benachbarte Gebäude
 * aus der Praxis der DIN 4701/DIN EN 12831; den Wert bestätigt Manuel noch,
 * RaVia kann ihn per Patch setzen.
 */
export const NACHBAR_TEMPERATUR_VORGABE = 15;

/** θ hinter einer Wand mit Randbedingung `neighbour` [°C]. */
export function nachbarTemperatur(meta: BimDocument['meta']): number {
  const t = meta.neighbourTemperature;
  return typeof t === 'number' && Number.isFinite(t) ? t : NACHBAR_TEMPERATUR_VORGABE;
}
