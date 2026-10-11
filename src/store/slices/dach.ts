/**
 * Store-Slice „Dächer, Geschossdaten und Ebenen".
 *
 * TD-22: Aus `useBimStore.ts` herausgelöst; die Aktionen sind unverändert.
 * `useBimStore` setzt den Store aus diesen Slices zusammen und reicht
 * `set`, `get` und `mutate` (Dokumentänderung mit Historie) herein.
 */

import { dez } from '../../lib/zahl';
import { ROOF_KIND_LABELS } from '../../types/bim';
import { EPS } from '../../lib/geometry';
import { BESTANDS_EBENEN } from '../../lib/ebenen';
import { daecherVon, raeumeOhneGeschossDarueber } from '../../lib/dachlandschaft';
import type { BimState, Mutate, StoreGet, StoreSet } from '../bimZustand';
import { DEFAULT_ROOF } from '../bimZustand';

export type DachSchluessel =
  | 'addRoof'
  | 'entferneRoof'
  | 'setRoofById'
  | 'setRoof'
  | 'updateLevel'
  | 'toggleLayer'
  | 'sperreEbene'
  | 'sperreBestand'
  | 'ebenenSatz';

export function dachSlice(set: StoreSet, get: StoreGet, mutate: Mutate): Pick<BimState, DachSchluessel> {
  return {
    /**
     * Ein Dach hinzufügen.
     *
     * **Der Vorschlag für die Räume ist die halbe Funktion.** Ein neues Dach
     * bekommt die Räume, über denen **kein Geschoss liegt** und die noch
     * keinem anderen Dach gehören. Das ist die Regel „wo ein Geschoss
     * darüberliegt, ist eine Decke und kein Dach", als Vorbelegung statt als
     * Verbot: Wer ein Vordach über einem Erker will, hakt den Raum von Hand
     * dazu, und die Prüfung sagt, dass er es getan hat.
     */
    addRoof: (levelId) => {
      const doc0 = get().doc;
      const level0 = doc0.levels[levelId];
      if (!level0) return;
      const geschosse = Object.values(doc0.levels).sort((a, b) => a.order - b.order);
      const index = geschosse.findIndex((l) => l.id === levelId);
      const darueber = geschosse[index + 1];
      const hier = Object.values(doc0.rooms ?? {}).filter((r) => r.levelId === levelId);
      const oben = darueber
        ? Object.values(doc0.rooms ?? {}).filter((r) => r.levelId === darueber.id)
        : [];
      const vergeben = new Set(daecherVon(level0).flatMap((r) => r.roomIds ?? []));
      const frei = raeumeOhneGeschossDarueber(hier, oben).filter((id) => !vergeben.has(id));

      mutate((doc) => {
        const level = doc.levels[levelId];
        if (!level) return;
        const bisher = daecherVon(level);
        doc.levels[levelId] = {
          ...level,
          roof: undefined,
          roofs: [
            ...bisher,
            {
              ...DEFAULT_ROOF,
              id: `dach-${Date.now().toString(36)}`,
              name: `Dach ${bisher.length + 1}`,
              roomIds: frei,
            },
          ],
        };
      });
      set({
        statusMessage: frei.length
          ? `Dach angelegt über ${frei.length} ${frei.length === 1 ? 'Raum' : 'Räumen'} ohne Geschoss darüber.`
          : 'Dach angelegt — es deckt noch keinen Raum. Räume unten zuweisen.',
      });
    },

    /** Ein Dach entfernen. Das letzte zu entfernen heißt: waagerechte Decke. */
    entferneRoof: (levelId, roofId) => {
      mutate((doc) => {
        const level = doc.levels[levelId];
        if (!level) return;
        const rest = daecherVon(level).filter((r) => r.id !== roofId);
        doc.levels[levelId] = {
          ...level,
          roof: undefined,
          roofs: rest.length ? rest : undefined,
        };
      });
      set({ statusMessage: 'Dach entfernt.' });
    },

    /**
     * Ein einzelnes Dach ändern.
     *
     * **Warum jede Änderung auf `roofs` schreibt.** `level.roof` (eines) und
     * `level.roofs` (mehrere) stehen nebeneinander, damit alte Projekte
     * aufgehen. Zwei Quellen für dieselbe Sache sind aber ein Fehler, der
     * darauf wartet zu passieren — deshalb wandert ein Projekt beim ersten
     * Schreiben nach `roofs`, und `roof` wird geleert. Gelesen wird ohnehin
     * nur über `daecherVon`.
     */
    setRoofById: (levelId, roofId, patch) => {
      mutate((doc) => {
        const level = doc.levels[levelId];
        if (!level) return;
        const daecher = daecherVon(level).map((r) =>
          r.id === roofId ? { ...DEFAULT_ROOF, ...r, ...patch } : r,
        );
        doc.levels[levelId] = { ...level, roof: undefined, roofs: daecher };
      });
    },

    setRoof: (levelId, patch) => {
      mutate((doc) => {
        const level = doc.levels[levelId];
        if (!level) return;
        if (patch === null) {
          doc.levels[levelId] = { ...level, roof: undefined, roofs: undefined };
          return;
        }
        /*
         * Der alte Weg — er ändert **das erste** Dach. Er bleibt, weil ihn
         * der Dachreiter für den Regelfall (ein Haus, ein Dach) benutzt und
         * weil die Einbettungsschnittstelle ihn kennt.
         */
        const daecher = daecherVon(level);
        if (daecher.length > 1) {
          doc.levels[levelId] = {
            ...level,
            roof: undefined,
            roofs: daecher.map((r, i) => (i === 0 ? { ...DEFAULT_ROOF, ...r, ...patch } : r)),
          };
          return;
        }
        doc.levels[levelId] = { ...level, roof: { ...DEFAULT_ROOF, ...level.roof, ...patch }, roofs: undefined };
      });
      const roof = get().doc.levels[levelId]?.roof;
      set({
        statusMessage: roof
          ? `Dach: ${ROOF_KIND_LABELS[roof.kind]} · ${dez(roof.pitch, 0)}° · Kniestock ${dez(roof.kneeHeight, 2)} m`
          : 'Dach entfernt — Decke wieder waagerecht',
      });
    },

    updateLevel: (id, patch) =>
      mutate((doc) => {
        const level = doc.levels[id];
        if (!level) return;
        doc.levels[id] = { ...level, ...patch };
        // Wandhöhen dem Geschoss folgen lassen, solange sie nicht abweichen
        if (patch.height !== undefined) {
          for (const w of Object.values(doc.walls)) {
            if (Math.abs(w.height - level.height) < EPS) {
              doc.walls[w.id] = { ...w, height: patch.height };
            }
          }
        }
      }),

    toggleLayer: (id) =>
      mutate(
        (doc) => {
          const layer = doc.layers[id];
          if (layer) doc.layers[id] = { ...layer, visible: !layer.visible };
        },
        { skipRooms: true },
      ),

    sperreEbene: (id, gesperrt) =>
      mutate(
        (doc) => {
          const layer = doc.layers[id];
          if (layer) doc.layers[id] = { ...layer, locked: gesperrt };
        },
        { skipRooms: true },
      ),

    /*
     * Den Bestand sperren oder freigeben.
     *
     * Der Ablauf, für den es das gibt: Erst wird der Bestand aufgemessen,
     * dann steht man im Haus und setzt die Technik. In der zweiten Hälfte ist
     * jede Wandbewegung ein Unfall — und zwar einer, den man nicht bemerkt,
     * weil eine um zwei Zentimeter verschobene Wand im Plan aussieht wie
     * vorher und in der Heizlast nicht.
     */
    sperreBestand: (gesperrt) => {
      mutate(
        (doc) => {
          for (const id of BESTANDS_EBENEN) {
            const layer = doc.layers[id];
            if (layer) doc.layers[id] = { ...layer, locked: gesperrt };
          }
        },
        { skipRooms: true },
      );
      set({
        statusMessage: gesperrt
          ? 'Bestand gesperrt — Wände, Öffnungen, Räume und Durchbrüche lassen sich nicht mehr anfassen'
          : 'Bestand freigegeben',
      });
    },

    ebenenSatz: (satz) => {
      mutate(
        (doc) => {
          const an = new Set<string>(satz.sichtbar);
          for (const [id, layer] of Object.entries(doc.layers)) {
            // Das Referenzbild bleibt außen vor: Es ist keine Zeichnungsebene,
            // sondern die Vorlage, über der gezeichnet wird. Wer es
            // eingeblendet hat, will es beim Umschalten des Gewerks nicht
            // verlieren.
            if (id === 'layer-image') continue;
            doc.layers[id] = { ...layer, visible: an.has(id) };
          }
        },
        { skipRooms: true },
      );
      set({ statusMessage: `${satz.label}: ${satz.auskunft}` });
    },
  };
}
