/**
 * Ob der Dialog „Mit RaVia Scan scannen" offen ist — und für welche Sitzung.
 *
 * Ein eigener kleiner Zustand statt eines Felds im Modellzustand: Der Dialog
 * gehört nicht zum Gebäude, er darf weder in die Rückgängig-Kette noch in die
 * Sicherung. Drei Stellen öffnen ihn — der Block im Reiter „Referenz", die
 * Einführung und der Rücksprung aus der App mit `?scan=…`.
 */

import { useSyncExternalStore } from 'react';
import { create } from 'zustand';
import { abonniereWirt } from '../lib/wirt';
import { SCAN_DIENST_AKTIV, scanVerfuegbar, scanWeg } from '../lib/scanZugang';

export { SCAN_DIENST_AKTIV };

/** Wie `scanVerfuegbar`, aber neu gerendert, wenn der Wirt seine Fähigkeit meldet. */
export function useScanVerfuegbar(): boolean {
  return useSyncExternalStore(abonniereWirt, () => scanVerfuegbar());
}

interface ScanDialogZustand {
  offen: boolean;
  /** Gesetzt beim Wiederaufnehmen nach dem Rücksprung aus der App. */
  sitzungId: string | null;
  /** Hat der Wirt (RaVia) den Scan übernommen? Dann zeigt CAD Light nur einen Hinweis. */
  beimWirt: boolean;
  oeffnen: (sitzungId?: string | null) => void;
  schliessen: () => void;
}

export const useScanDialog = create<ScanDialogZustand>((set) => ({
  offen: false,
  sitzungId: null,
  beimWirt: false,
  oeffnen: (sitzungId) => set({ offen: true, sitzungId: sitzungId ?? null, beimWirt: false }),
  schliessen: () => set({ offen: false, sitzungId: null, beimWirt: false }),
}));

/**
 * Den Scan anstoßen. Eingebettet in einen Wirt, der den Scan selbst kann,
 * geht die Anforderung an ihn; sonst öffnet der eigene Dialog, falls der
 * Scan-Dienst eingeschaltet ist. Sonst passiert nichts (`'aus'`).
 */
export function scanStarten(dienstAktiv: boolean = SCAN_DIENST_AKTIV): 'wirt' | 'eigen' | 'aus' {
  const weg = scanWeg(dienstAktiv);
  if (weg === 'wirt') useScanDialog.setState({ offen: true, sitzungId: null, beimWirt: true });
  if (weg === 'eigen') useScanDialog.getState().oeffnen(null);
  return weg;
}
