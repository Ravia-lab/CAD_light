/**
 * Ob der Dialog „Mit RaVia Scan scannen" offen ist — und für welche Sitzung.
 *
 * Ein eigener kleiner Zustand statt eines Felds im Modellzustand: Der Dialog
 * gehört nicht zum Gebäude, er darf weder in die Rückgängig-Kette noch in die
 * Sicherung. Drei Stellen öffnen ihn — der Block im Reiter „Referenz", die
 * Einführung und der Rücksprung aus der App mit `?scan=…`.
 */

import { create } from 'zustand';
import { scanBeimWirtAnfordern } from '../lib/wirt';

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
 * geht die Anforderung an ihn; sonst öffnet der eigene Dialog.
 */
export function scanStarten(): 'wirt' | 'eigen' {
  if (scanBeimWirtAnfordern()) {
    useScanDialog.setState({ offen: true, sitzungId: null, beimWirt: true });
    return 'wirt';
  }
  useScanDialog.getState().oeffnen(null);
  return 'eigen';
}
