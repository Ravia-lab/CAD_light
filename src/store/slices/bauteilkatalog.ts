/**
 * Store-Slice „Bauteilkatalog (Konstruktionen)".
 *
 * TD-22: Aus `useBimStore.ts` herausgelöst; die Aktionen sind unverändert.
 * `useBimStore` setzt den Store aus diesen Slices zusammen und reicht
 * `set`, `get` und `mutate` (Dokumentänderung mit Historie) herein.
 */

import type { Construction } from '../../types/bim';
import { uid } from '../../lib/dokumentPflege';
import type { BimState, Mutate, StoreGet, StoreSet } from '../bimZustand';

export type BauteilkatalogSchluessel =
  | 'addConstruction'
  | 'updateConstruction'
  | 'deleteConstruction'
  | 'assignConstruction';

export function bauteilkatalogSlice(_set: StoreSet, _get: StoreGet, mutate: Mutate): Pick<BimState, BauteilkatalogSchluessel> {
  return {
    // ------------------------------------------------------- Bauteilkatalog
    addConstruction: (construction) => {
      const created: Construction = { ...construction, id: uid('c') };
      mutate((doc) => {
        doc.constructions[created.id] = created;
      }, { skipRooms: true });
      return created;
    },

    /**
     * Ändert einen Aufbau — und zieht alle zugewiesenen Bauteile mit. Genau
     * dafür gibt es den Katalog: eine Änderung an einer Stelle statt an
     * dreißig Wänden.
     */
    updateConstruction: (id, patch) =>
      mutate((doc) => {
        const current = doc.constructions[id];
        if (!current) return;
        const next = { ...current, ...patch };
        doc.constructions[id] = next;

        for (const wall of Object.values(doc.walls)) {
          if (wall.constructionId !== id) continue;
          doc.walls[wall.id] = {
            ...wall,
            uValue: next.uValue,
            thickness: next.thickness ?? wall.thickness,
            thermalBridgeSupplement: next.thermalBridgeSupplement ?? wall.thermalBridgeSupplement,
          };
        }
        for (const op of Object.values(doc.openings)) {
          if (op.constructionId !== id) continue;
          doc.openings[op.id] = { ...op, uValue: next.uValue, gValue: next.gValue ?? op.gValue };
        }
        for (const level of Object.values(doc.levels)) {
          if (level.floorConstructionId === id) doc.levels[level.id] = { ...level, floorUValue: next.uValue };
          if (level.ceilingConstructionId === id) {
            doc.levels[level.id] = { ...doc.levels[level.id], ceilingUValue: next.uValue };
          }
        }
      }),

    deleteConstruction: (id) =>
      mutate((doc) => {
        delete doc.constructions[id];
        // Zuweisungen lösen, U-Werte bleiben als Einzelwerte erhalten.
        for (const wall of Object.values(doc.walls)) {
          if (wall.constructionId === id) doc.walls[wall.id] = { ...wall, constructionId: undefined };
        }
        for (const op of Object.values(doc.openings)) {
          if (op.constructionId === id) doc.openings[op.id] = { ...op, constructionId: undefined };
        }
      }, { skipRooms: true }),

    assignConstruction: (targets, constructionId) =>
      mutate((doc) => {
        const c = doc.constructions[constructionId];
        if (!c) return;
        for (const t of targets) {
          if (t.kind === 'wall') {
            const wall = doc.walls[t.id];
            if (!wall) continue;
            doc.walls[t.id] = {
              ...wall,
              constructionId,
              uValue: c.uValue,
              thickness: c.thickness ?? wall.thickness,
              thermalBridgeSupplement: c.thermalBridgeSupplement ?? wall.thermalBridgeSupplement,
            };
          } else if (t.kind === 'opening') {
            const op = doc.openings[t.id];
            if (!op) continue;
            doc.openings[t.id] = { ...op, constructionId, uValue: c.uValue, gValue: c.gValue ?? op.gValue };
          }
        }
      }),
  };
}
