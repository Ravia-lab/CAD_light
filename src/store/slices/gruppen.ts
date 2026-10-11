/**
 * Store-Slice „Gruppenoperationen auf der Auswahl, Projektdaten und Aufnahme".
 *
 * TD-22: Aus `useBimStore.ts` herausgelöst; die Aktionen sind unverändert.
 * `useBimStore` setzt den Store aus diesen Slices zusammen und reicht
 * `set`, `get` und `mutate` (Dokumentänderung mit Historie) herein.
 */

import type {
  Selection,
  Vec2,
} from '../../types/bim';
import { roundMm } from '../../lib/geometry';
import { auswahlGesperrt } from '../../lib/ebenen';
import { partnerVon } from '../../lib/doppelleitung';
import { uid } from '../../lib/dokumentPflege';
import type { BimState, Mutate, StoreGet, StoreSet } from '../bimZustand';

export type GruppenSchluessel =
  | 'copySelection'
  | 'pasteClipboard'
  | 'moveSelection'
  | 'mirrorSelection'
  | 'arraySelection'
  | 'updateMeta'
  | 'setzeAufnahme'
  | 'passeEin'
  | 'setzeAssistent';

export function gruppenSlice(set: StoreSet, get: StoreGet, mutate: Mutate): Pick<BimState, GruppenSchluessel> {
  return {
    // -------------------------------------------------- Gruppenoperationen
    copySelection: () => {
      const { doc, selections } = get();
      const wallIds = selections.filter((s2) => s2.kind === 'wall').map((s2) => s2.id);
      const fixtureIds = selections.filter((s2) => s2.kind === 'fixture').map((s2) => s2.id);
      if (!wallIds.length && !fixtureIds.length) {
        set({ statusMessage: 'Nichts zum Kopieren ausgewählt' });
        return;
      }

      const walls = wallIds.map((id) => doc.walls[id]).filter(Boolean);
      const nodeIds = new Set(walls.flatMap((w) => [w.a, w.b]));
      const nodes = [...nodeIds].map((id) => doc.nodes[id]).filter(Boolean);
      const openings = Object.values(doc.openings).filter((o) => wallIds.includes(o.wallId));
      const fixtures = fixtureIds.map((id) => doc.fixtures[id]).filter(Boolean);

      // Bezugspunkt = linke untere Ecke der Auswahl.
      const points: Vec2[] = [...nodes, ...fixtures.map((f) => f.position)];
      const origin = points.reduce(
        (acc, p) => ({ x: Math.min(acc.x, p.x), y: Math.min(acc.y, p.y) }),
        { x: Infinity, y: Infinity },
      );

      set({
        clipboard: { origin, nodes, walls, openings, fixtures },
        statusMessage: `${walls.length} Wände, ${fixtures.length} TGA-Objekte kopiert`,
      });
    },

    pasteClipboard: (offset) => {
      const clip = get().clipboard;
      if (!clip) return;
      const d = offset ?? { x: 1, y: -1 };
      const created: Selection[] = [];

      mutate((doc) => {
        const nodeMap = new Map<string, string>();
        for (const node of clip.nodes) {
          const id = uid('n');
          nodeMap.set(node.id, id);
          doc.nodes[id] = {
            ...node,
            id,
            levelId: doc.activeLevelId,
            x: roundMm(node.x + d.x),
            y: roundMm(node.y + d.y),
          };
        }
        for (const wall of clip.walls) {
          const a = nodeMap.get(wall.a);
          const b = nodeMap.get(wall.b);
          if (!a || !b) continue;
          const id = uid('w');
          doc.walls[id] = { ...wall, id, a, b, levelId: doc.activeLevelId };
          created.push({ kind: 'wall', id });
          for (const op of clip.openings) {
            if (op.wallId !== wall.id) continue;
            const opId = uid('o');
            doc.openings[opId] = { ...op, id: opId, wallId: id };
          }
        }
        for (const f of clip.fixtures) {
          const id = uid('f');
          doc.fixtures[id] = {
            ...f,
            id,
            levelId: doc.activeLevelId,
            position: { x: roundMm(f.position.x + d.x), y: roundMm(f.position.y + d.y) },
          };
          created.push({ kind: 'fixture', id });
        }
      });

      set({
        selections: created,
        selection: created[created.length - 1] ?? null,
        statusMessage: `${created.length} Objekte eingefügt`,
      });
    },

    moveSelection: (delta) => {
      const { selections, doc: doc0 } = get();
      if (!selections.length) return;
      /*
       * Gesperrtes wandert nicht mit.
       *
       * Der Treffertest lässt ein gesperrtes Bauteil gar nicht erst fassen —
       * aber eine Auswahl kann auch aus einer Liste kommen, aus dem
       * Auswahlrahmen oder aus einem Prüfbefund. Ein zweites Sieb hier kostet
       * nichts und schließt den Weg, auf dem die Sperre sonst zu umgehen
       * wäre, ohne dass jemand es merkt.
       */
      const beweglich = selections.filter((s2) => !auswahlGesperrt(doc0, s2));
      if (!beweglich.length) {
        set({ statusMessage: 'Gesperrt — im Reiter „Ebenen" freigeben' });
        return;
      }
      mutate((doc) => {
        const moved = new Set<string>();
        for (const sel of beweglich) {
          if (sel.kind === 'wall') {
            const wall = doc.walls[sel.id];
            if (!wall) continue;
            for (const nid of [wall.a, wall.b]) {
              if (moved.has(nid)) continue;
              const node = doc.nodes[nid];
              if (!node) continue;
              doc.nodes[nid] = { ...node, x: roundMm(node.x + delta.x), y: roundMm(node.y + delta.y) };
              moved.add(nid);
            }
          } else if (sel.kind === 'fixture') {
            const f = doc.fixtures[sel.id];
            if (!f) continue;
            doc.fixtures[sel.id] = {
              ...f,
              position: { x: roundMm(f.position.x + delta.x), y: roundMm(f.position.y + delta.y) },
            };
          } else if (sel.kind === 'heatpump') {
            const pump = doc.site.pumps[sel.id];
            if (!pump) continue;
            doc.site.pumps[sel.id] = {
              ...pump,
              position: { x: roundMm(pump.position.x + delta.x), y: roundMm(pump.position.y + delta.y) },
            };
          } else if (sel.kind === 'site') {
            const element = doc.site.elements[sel.id];
            if (!element) continue;
            // Alle Stützpunkte um denselben Betrag: das Objekt wandert, es
            // verformt sich nicht. Das Anfassen eines einzelnen Punktes ist
            // eine andere Geste und läuft nicht über die Auswahl.
            doc.site.elements[sel.id] = {
              ...element,
              points: element.points.map((p) => ({ x: roundMm(p.x + delta.x), y: roundMm(p.y + delta.y) })),
            };
          } else if (sel.kind === 'accessory') {
            /*
             * Eine Armatur wandert mit — auch die ausgelegte.
             *
             * Sie zwar anklicken, aber nicht bewegen zu können ist die
             * Sorte Halbheit, die man dem Programm anlastet und nicht der
             * Absicht dahinter. Wer eine Armatur verschiebt, macht sie zu
             * seiner: `generated` fällt weg, damit die nächste Auslegung
             * seine Lage nicht wieder überschreibt.
             */
            const armatur = doc.pipeAccessories?.[sel.id];
            if (!armatur || !doc.pipeAccessories) continue;
            doc.pipeAccessories[sel.id] = {
              ...armatur,
              position: { x: roundMm(armatur.position.x + delta.x), y: roundMm(armatur.position.y + delta.y) },
              generated: undefined,
            };
          } else if (sel.kind === 'pipe') {
            // Die ganze Trasse wandert; die Form bleibt. Eine ausgelegte
            // Leitung wird damit zur gezogenen — sonst stünde sie nach der
            // nächsten Auslegung wieder an der alten Stelle.
            const run = doc.pipes[sel.id];
            if (!run) continue;
            // Eine Doppelleitung wandert als Ganzes — sonst läge nach der
            // Geste der Vorlauf im Flur und der Rücklauf im Zimmer.
            const paar = partnerVon(doc.pipes, run);
            for (const r of paar && !moved.has(paar.id) ? [run, paar] : [run]) {
              if (moved.has(r.id)) continue;
              doc.pipes[r.id] = {
                ...r,
                points: r.points.map((p) => ({ x: roundMm(p.x + delta.x), y: roundMm(p.y + delta.y) })),
                generated: undefined,
              };
              moved.add(r.id);
            }
          } else if (sel.kind === 'annotation') {
            const note = doc.annotations[sel.id];
            if (!note) continue;
            doc.annotations[sel.id] = {
              ...note,
              points: note.points.map((p) => ({ x: roundMm(p.x + delta.x), y: roundMm(p.y + delta.y) })),
            };
          }
        }
      });
    },

    /** Spiegelt die Auswahl an der Mittelachse ihrer eigenen Ausdehnung. */
    mirrorSelection: (axis) => {
      const { doc, selections } = get();
      const walls = selections.filter((s2) => s2.kind === 'wall').map((s2) => doc.walls[s2.id]).filter(Boolean);
      const fixtures = selections.filter((s2) => s2.kind === 'fixture').map((s2) => doc.fixtures[s2.id]).filter(Boolean);
      if (!walls.length && !fixtures.length) return;

      const pts: Vec2[] = [
        ...walls.flatMap((w) => [doc.nodes[w.a], doc.nodes[w.b]]).filter(Boolean),
        ...fixtures.map((f) => f.position),
      ];
      const min = pts.reduce((a, p) => ({ x: Math.min(a.x, p.x), y: Math.min(a.y, p.y) }), { x: Infinity, y: Infinity });
      const max = pts.reduce((a, p) => ({ x: Math.max(a.x, p.x), y: Math.max(a.y, p.y) }), { x: -Infinity, y: -Infinity });
      const centre = { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2 };

      mutate((d) => {
        const done = new Set<string>();
        for (const w of walls) {
          for (const nid of [w.a, w.b]) {
            if (done.has(nid)) continue;
            const node = d.nodes[nid];
            if (!node) continue;
            d.nodes[nid] = {
              ...node,
              x: axis === 'x' ? roundMm(2 * centre.x - node.x) : node.x,
              y: axis === 'y' ? roundMm(2 * centre.y - node.y) : node.y,
            };
            done.add(nid);
          }
        }
        for (const f of fixtures) {
          d.fixtures[f.id] = {
            ...f,
            position: {
              x: axis === 'x' ? roundMm(2 * centre.x - f.position.x) : f.position.x,
              y: axis === 'y' ? roundMm(2 * centre.y - f.position.y) : f.position.y,
            },
            // Symbole müssen mitgespiegelt werden, sonst zeigt ein Heizkörper
            // nach dem Spiegeln in die Wand statt in den Raum.
            rotation: axis === 'x' ? 180 - f.rotation : -f.rotation,
          };
        }
        // Die Tür schlägt zur Wandnormalen auf, und die kehrt sich beim
        // Spiegeln um: aus der Linksnormalen wird das *negative* Spiegelbild
        // der alten. Ohne diese Zeile schlägt jede gespiegelte Tür nach dem
        // Spiegeln in den Nachbarraum auf — dieselbe Regel wie in
        // `spiegleGrundriss`, nur für die Auswahl.
        const gespiegelteWaende = new Set(walls.map((w) => w.id));
        for (const o of Object.values(d.openings)) {
          if (!gespiegelteWaende.has(o.wallId)) continue;
          d.openings[o.id] = { ...o, flipSwing: !o.flipSwing };
        }
      });
      set({ statusMessage: `Auswahl an der ${axis === 'x' ? 'Vertikal' : 'Horizontal'}achse gespiegelt` });
    },

    /** Reiht die Auswahl `count`-mal mit konstantem Versatz aneinander. */
    arraySelection: (count, delta) => {
      const state = get();
      if (!state.selections.length || count < 1) return;
      state.copySelection();
      for (let i = 1; i <= count; i++) {
        get().pasteClipboard({ x: delta.x * i, y: delta.y * i });
      }
      set({ statusMessage: `${count} Kopien in Reihe erzeugt` });
    },

    updateMeta: (patch) => mutate((doc) => Object.assign(doc.meta, patch)),

    setzeAufnahme: (patch) =>
      mutate(
        (doc) => {
          /*
           * Wer etwas einträgt, hat aufgenommen — also wird der Zeitpunkt
           * mitgeschrieben, falls er noch fehlt. Ein Aufnahmebogen ohne Datum
           * ist als Anlage zu einem Nachweis wenig wert, und ihn eigens
           * einzutippen vergisst jeder.
           */
          const vorher = doc.meta.aufnahme ?? {};
          doc.meta.aufnahme = {
            ...vorher,
            ...patch,
            aufgenommenAm: patch.aufgenommenAm ?? vorher.aufgenommenAm ?? new Date().toISOString(),
          };
        },
        { skipRooms: true },
      ),

    passeEin: () => set({ einpassenZaehler: get().einpassenZaehler + 1 }),

    setzeAssistent: (offen) => set({ assistent: offen }),
  };
}
