/**
 * Welcher Weg zum Scan offensteht — Wirt, eigener Dienst oder keiner.
 * ---------------------------------------------------------------------------
 * **TD-32.** Die Gegenstelle in RaVia (der Relay hinter `scan-dienst/`,
 * siehe `scanDienst.ts`) gibt es noch nicht; der eigene Dialog endete
 * deshalb immer in „noch nicht eingerichtet". Bis sie steht, bietet CAD
 * Light den QR-Weg nur an, wenn der Build ihn mit `VITE_SCAN_DIENST=1`
 * ausdrücklich einschaltet. Übernimmt ein Wirt den Scan
 * (`setHostCapabilities`, siehe `wirt.ts`), geht es unabhängig davon über
 * ihn. Die Scan-Datei und der Beispielscan bleiben immer.
 */

import { scanBeimWirtAnfordern, wirtKannScannen } from './wirt';

/** Ob der eigene Scan-Dienst eingerichtet ist. Standard: aus. */
export const SCAN_DIENST_AKTIV: boolean = import.meta.env?.VITE_SCAN_DIENST === '1';

/** Gibt es überhaupt einen Weg, den Scan anzustoßen? */
export function scanVerfuegbar(dienstAktiv: boolean = SCAN_DIENST_AKTIV): boolean {
  return dienstAktiv || wirtKannScannen();
}

/**
 * Den Weg wählen und, falls es der Wirt ist, die Anforderung an ihn
 * schicken. `'eigen'` heißt: der eigene Dialog soll aufgehen; `'aus'`:
 * es gibt keinen Weg, also nichts tun.
 */
export function scanWeg(dienstAktiv: boolean = SCAN_DIENST_AKTIV): 'wirt' | 'eigen' | 'aus' {
  if (scanBeimWirtAnfordern()) return 'wirt';
  return dienstAktiv ? 'eigen' : 'aus';
}
