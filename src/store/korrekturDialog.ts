/**
 * Ob der Dialog „Grundriss prüfen und korrigieren" offen ist.
 *
 * Ein eigener kleiner Zustand wie beim Scan-Dialog: Der Dialog gehört nicht
 * zum Gebäude, er darf weder in die Rückgängig-Kette noch in die Sicherung.
 */

import { create } from 'zustand';

interface KorrekturDialogZustand {
  offen: boolean;
  oeffnen: () => void;
  schliessen: () => void;
}

export const useKorrekturDialog = create<KorrekturDialogZustand>((set) => ({
  offen: false,
  oeffnen: () => set({ offen: true }),
  schliessen: () => set({ offen: false }),
}));
