/**
 * Store-Slice „Nutzungseinheiten".
 *
 * TD-22: Aus `useBimStore.ts` herausgelöst; die Aktionen sind unverändert.
 * `useBimStore` setzt den Store aus diesen Slices zusammen und reicht
 * `set`, `get` und `mutate` (Dokumentänderung mit Historie) herein.
 */

import {
  EINHEIT_LABELS,
  einheitenstand,
  naechsterName,
  type Nutzungseinheit,
} from '../../lib/nutzungseinheiten';
import { uid } from '../../lib/dokumentPflege';
import type { BimState, Mutate, StoreGet, StoreSet } from '../bimZustand';

export type EinheitenSchluessel =
  | 'neueEinheit'
  | 'benenneEinheit'
  | 'setzeEinheitArt'
  | 'loescheEinheit'
  | 'ordneRaumEinheitZu'
  | 'ordneGeschossEinheitZu'
  | 'uebernehmeEinheitenzahl';

export function einheitenSlice(set: StoreSet, get: StoreGet, mutate: Mutate): Pick<BimState, EinheitenSchluessel> {
  return {
    // --- Nutzungseinheiten ------------------------------------------------
    /*
     * Die Einheit ist eine **Zuordnung am Raum** und keine Stufe zwischen
     * Geschoss und Raum. Warum, steht in `lib/nutzungseinheiten.ts`: Eine
     * Maisonette passt nicht unter ein Geschoss.
     */
    neueEinheit: (art = 'wohnung', name) => {
      const id = uid('eh');
      mutate(
        (doc) => {
          const einheit: Nutzungseinheit = {
            id,
            name: name?.trim() || naechsterName(doc, art),
            art,
          };
          doc.units = { ...(doc.units ?? {}), [id]: einheit };
        },
        { skipRooms: true },
      );
      set({ statusMessage: `${EINHEIT_LABELS[art]} angelegt: ${get().doc.units?.[id]?.name ?? ''}` });
      return id;
    },

    benenneEinheit: (id, name) =>
      mutate(
        (doc) => {
          const einheit = doc.units?.[id];
          if (!einheit) return;
          const sauber = name.trim();
          // Eine Wohnung ohne Namen steht im Nachweis als leere Zeile.
          if (!sauber) return;
          doc.units = { ...doc.units, [id]: { ...einheit, name: sauber } };
        },
        { skipRooms: true },
      ),

    setzeEinheitArt: (id, art) =>
      mutate(
        (doc) => {
          const einheit = doc.units?.[id];
          if (!einheit) return;
          doc.units = { ...doc.units, [id]: { ...einheit, art } };
        },
        { skipRooms: true },
      ),

    loescheEinheit: (id) => {
      mutate(
        (doc) => {
          if (!doc.units?.[id]) return;
          const rest = { ...doc.units };
          delete rest[id];
          doc.units = rest;
          for (const raum of Object.values(doc.rooms)) {
            if (raum.unitId === id) doc.rooms[raum.id] = { ...raum, unitId: undefined };
          }
        },
        { skipRooms: true },
      );
      set({ statusMessage: 'Nutzungseinheit entfernt' });
    },

    ordneRaumEinheitZu: (roomId, einheitId) =>
      mutate(
        (doc) => {
          const raum = doc.rooms[roomId];
          if (!raum) return;
          // Eine Kennung, zu der es keine Einheit gibt, wird nicht gesetzt.
          if (einheitId && !doc.units?.[einheitId]) return;
          doc.rooms[roomId] = { ...raum, unitId: einheitId };
        },
        { skipRooms: true },
      ),

    ordneGeschossEinheitZu: (levelId, einheitId) => {
      let gezaehlt = 0;
      mutate(
        (doc) => {
          if (!doc.units?.[einheitId]) return;
          for (const raum of Object.values(doc.rooms)) {
            if (raum.levelId !== levelId) continue;
            if (raum.unitId && raum.unitId !== einheitId) continue;
            if (raum.unitId === einheitId) continue;
            doc.rooms[raum.id] = { ...raum, unitId: einheitId };
            gezaehlt++;
          }
        },
        { skipRooms: true },
      );
      const name = get().doc.units?.[einheitId]?.name ?? 'Einheit';
      set({
        statusMessage: gezaehlt
          ? `${gezaehlt} ${gezaehlt === 1 ? 'Raum' : 'Räume'} zu „${name}" zugeordnet`
          : `Nichts zuzuordnen — alle Räume des Geschosses gehören schon zu einer Einheit`,
      });
      return gezaehlt;
    },

    uebernehmeEinheitenzahl: () => {
      const stand = einheitenstand(get().doc);
      if (!stand.gesamt) {
        const message = 'Es ist keine Nutzungseinheit erfasst — es gibt nichts zu übernehmen.';
        set({ statusMessage: message });
        return { gezaehlt: 0, message };
      }
      /*
       * Nur Wohnungen und Gewerbe zählen; sind ausschließlich
       * Gemeinschaftsflächen erfasst, wäre die Zahl 0 — und 0 Wohneinheiten
       * im Anlagenblatt hieße „kein Trinkwasserbedarf". Dann wird nichts
       * übernommen und das gesagt.
       */
      if (stand.selbstaendig < 1) {
        const message =
          'Es ist keine Wohnung und keine Gewerbeeinheit erfasst — nur Gemeinschaftsflächen. Daraus folgt keine Zahl für das Anlagenblatt.';
        set({ statusMessage: message });
        return { gezaehlt: 0, message };
      }
      mutate(
        (doc) => {
          if (!doc.plant) return;
          doc.plant = { ...doc.plant, dhw: { ...doc.plant.dhw, units: stand.selbstaendig } };
        },
        { skipRooms: true },
      );
      const message = `Wohneinheiten im Anlagenblatt auf ${stand.selbstaendig} gesetzt — aus dem Modell gezählt.`;
      set({ statusMessage: message });
      return { gezaehlt: stand.selbstaendig, message };
    },
  };
}
