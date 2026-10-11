/**
 * Store-Slice „Referenzbild".
 *
 * TD-22: Aus `useBimStore.ts` herausgelöst; die Aktionen sind unverändert.
 * `useBimStore` setzt den Store aus diesen Slices zusammen und reicht
 * `set`, `get` und `mutate` (Dokumentänderung mit Historie) herein.
 */

import { dez } from '../../lib/zahl';
import type {
  Freihandstrich,
  Wall,
} from '../../types/bim';
import { erkenneSkizze } from '../../lib/skizze';
import { getroffene } from '../../lib/notizen';
import { vorzugsrichtung, EPS, distance } from '../../lib/geometry';
import {
  nodeAt,
  uid,
} from '../../lib/dokumentPflege';
import type { BimState, Mutate, StoreGet, StoreSet } from '../bimZustand';

export type ReferenzbildSchluessel =
  | 'setImage'
  | 'updateImage'
  | 'moveImage'
  | 'applyCalibration'
  | 'skizziere'
  | 'nimmZugZurueck'
  | 'uebernimmSkizze'
  | 'verwirfSkizze'
  | 'setzeSkizzenwand'
  | 'notiere'
  | 'loescheNotiz'
  | 'loescheNotizen'
  | 'radiere'
  | 'setzeRadiergummi'
  | 'setzeNotizenSichtbar';

export function referenzbildSlice(set: StoreSet, get: StoreGet, mutate: Mutate): Pick<BimState, ReferenzbildSchluessel> {
  return {
    // ------------------------------------------------------- Referenzbild
    setImage: (image) => mutate((doc) => { doc.image = image; }, { skipRooms: true }),

    updateImage: (patch) =>
      mutate(
        (doc) => {
          if (doc.image) doc.image = { ...doc.image, ...patch };
        },
        { skipRooms: true },
      ),

    /** Verschiebt das Referenzbild — nur, solange es nicht gesperrt ist. */
    moveImage: (delta) =>
      mutate(
        (doc) => {
          if (!doc.image || doc.image.locked) return;
          doc.image = {
            ...doc.image,
            origin: { x: doc.image.origin.x + delta.x, y: doc.image.origin.y + delta.y },
          };
        },
        { skipRooms: true },
      ),

    applyCalibration: (from, to, realLength) => {
      mutate(
        (doc) => {
          if (!doc.image || realLength <= 0) return;
          const drawn = distance(from, to);
          if (drawn < EPS) return;
          const factor = realLength / drawn;
          // Bild um den Startpunkt der Messstrecke skalieren, damit dieser fix bleibt.
          const origin = doc.image.origin;
          doc.image = {
            ...doc.image,
            scale: doc.image.scale * factor,
            origin: {
              x: from.x + (origin.x - from.x) * factor,
              y: from.y + (origin.y - from.y) * factor,
            },
            calibration: { from, to, realLength },
          };
        },
        { skipRooms: true },
      );
      set({ statusMessage: `Kalibriert auf ${dez(realLength, 2)} m`, tool: 'select' });
    },

    /** Übernimmt alle nicht verworfenen Vorschläge als echte CAD-Objekte. */
    // --- Freihand ---------------------------------------------------------

    /**
     * Einen Freihandstrich auswerten.
     *
     * Es entsteht ein **Vorschlag** und kein Modellinhalt. Die Wandstärke
     * kommt aus der Werkzeugleiste, damit der Strich dieselbe Stärke bekommt
     * wie eine von Hand gezogene Wand — wer 24 cm eingestellt hat, meint
     * 24 cm, auch wenn er skizziert.
     *
     * Die Ausrichtung folgt dem **Bestand**, wenn welcher da ist: eine
     * angebaute Wand soll zum Haus passen und nicht zu dem Strich, mit dem
     * sie gerade gezogen wurde.
     */
    skizziere: (punkte) => {
      const st = get();
      const levelId = st.doc.activeLevelId;
      // Ein Vorschlag, der schon steht, wird **fortgeschrieben** und nicht
      // ersetzt — solange er zum selben Geschoss gehört.
      const vorher = st.skizze && st.skizze.levelId === levelId ? st.skizze : null;
      const bestand = Object.values(st.doc.walls).filter((w) => w.levelId === levelId);
      const richtungGrad =
        bestand.length > 0
          ? (vorzugsrichtung(
              bestand
                .map((w) => {
                  const a = st.doc.nodes[w.a];
                  const b = st.doc.nodes[w.b];
                  if (!a || !b) return null;
                  return { dx: b.x - a.x, dy: b.y - a.y, laenge: Math.hypot(b.x - a.x, b.y - a.y) };
                })
                .filter((x): x is { dx: number; dy: number; laenge: number } => x !== null),
            ) *
              180) /
            Math.PI
          : undefined;

      /*
       * Steht schon ein Vorschlag, gilt **seine** Richtung — nicht die des
       * neuen Strichs. Sonst richtete sich die Innenwand nach sich selbst
       * aus, während die Außenwand daneben eine andere Vorzugsrichtung
       * behielt, und die beiden stünden im Plan schief zueinander.
       */
      const richtung = richtungGrad ?? vorher?.drehungGrad;
      const ergebnis = erkenneSkizze(punkte, richtung !== undefined ? { richtungGrad: richtung } : {});
      if (ergebnis.strecken.length === 0) {
        // Ein misslungener Strich nimmt den guten davor **nicht** mit. Wer
        // beim vierten Zug abrutscht, hat sonst die ersten drei verloren.
        const grund = ergebnis.hinweise[0] ?? 'Aus dem Strich ließ sich keine Wand lesen.';
        const zusatz = vorher ? ' Der bisherige Vorschlag bleibt stehen.' : '';
        if (!vorher) set({ skizze: null });
        get().setStatus(grund + zusatz);
        return { ok: false, message: grund + zusatz };
      }

      // Hinweise zusammenführen, ohne sie zu wiederholen: „2 sehr kurze
      // Stücke …" dreimal untereinander sagt nicht mehr als einmal.
      const hinweise = [...new Set([...(vorher?.hinweise ?? []), ...ergebnis.hinweise])];
      const strecken = [...(vorher?.strecken ?? []), ...ergebnis.strecken];
      const zuege = [
        ...(vorher?.zuege ?? []),
        { strich: [...punkte], anzahl: ergebnis.strecken.length, ring: ergebnis.ring },
      ];

      set({
        skizze: {
          strecken,
          zuege,
          levelId,
          ring: (vorher?.ring ?? false) || ergebnis.ring,
          drehungGrad: vorher?.drehungGrad ?? ergebnis.drehungGrad,
          hinweise,
          // Stärke und Art bleiben, was der Anwender am Vorschlag eingestellt
          // hat — sonst setzte jeder neue Zug seine Wahl zurück.
          staerke: vorher?.staerke ?? st.wallDefaults.thickness,
          art: vorher?.art ?? st.wallDefaults.type,
        },
      });
      const message =
        `${strecken.length} Wände erkannt` +
        (zuege.length > 1 ? ` aus ${zuege.length} Zügen` : '') +
        (ergebnis.ring ? ', geschlossener Umriss' : '') +
        ' — noch nicht übernommen';
      get().setStatus(message);
      return { ok: true, message };
    },

    /**
     * Den zuletzt gezogenen Strich aus dem Vorschlag nehmen.
     *
     * Der Gegenzug zum Sammeln: Wer vier Züge gezeichnet hat und mit dem
     * vierten unzufrieden ist, soll nicht alles verwerfen müssen.
     */
    nimmZugZurueck: () => {
      const v = get().skizze;
      if (!v || v.zuege.length === 0) return;
      if (v.zuege.length === 1) {
        set({ skizze: null });
        get().setStatus('Skizze verworfen.');
        return;
      }
      const letzter = v.zuege[v.zuege.length - 1];
      const zuege = v.zuege.slice(0, -1);
      const strecken = v.strecken.slice(0, v.strecken.length - letzter.anzahl);
      set({
        skizze: { ...v, zuege, strecken, ring: zuege.some((z) => z.ring) },
      });
      get().setStatus(`Letzter Zug zurückgenommen — ${strecken.length} Wände bleiben im Vorschlag.`);
    },

    /**
     * Die vorgeschlagenen Wände anlegen.
     *
     * **Ein** Schritt in der Rückgängig-Kette, nicht einer je Wand: Wer eine
     * Skizze übernimmt und es sich anders überlegt, will die Skizze zurück
     * und nicht sechsmal Strg+Z drücken.
     *
     * Angeschlossen wird an den Bestand: Endpunkte, die nah genug an einem
     * vorhandenen Knoten liegen, bekommen diesen Knoten. Sonst stünde die
     * skizzierte Wand neben der gezeichneten statt an ihr, und die
     * Raumerkennung fände keinen geschlossenen Umriss.
     */
    uebernimmSkizze: () => {
      const vorschlag = get().skizze;
      if (!vorschlag || vorschlag.strecken.length === 0) {
        return { ok: false, message: 'Es liegt keine Skizze vor.' };
      }
      let angelegt = 0;
      mutate((doc) => {
        const level = doc.levels[doc.activeLevelId];
        for (const strecke of vorschlag.strecken) {
          // 12 cm: großzügiger als beim Bildimport (8 cm), weil eine
          // Handskizze gröber ist als eine erkannte Linie — aber enger als
          // die halbe kleinste Wand, damit nichts zusammenfällt, was
          // getrennt gemeint war.
          const a = nodeAt(doc, strecke.a, 0.12);
          const b = nodeAt(doc, strecke.b, 0.12);
          if (a.id === b.id) continue;
          const gibtEs = Object.values(doc.walls).some(
            (w) => (w.a === a.id && w.b === b.id) || (w.a === b.id && w.b === a.id),
          );
          if (gibtEs) continue;
          const wall: Wall = {
            id: uid('w'),
            levelId: doc.activeLevelId,
            a: a.id,
            b: b.id,
            thickness: vorschlag.staerke,
            height: level?.height ?? 2.75,
            type: vorschlag.art,
            layerId: 'layer-walls',
            uValue: vorschlag.art === 'exterior' ? 0.24 : 1.2,
          };
          doc.walls[wall.id] = wall;
          angelegt += 1;
        }
      });
      set({ skizze: null });
      const message =
        angelegt === vorschlag.strecken.length
          ? `${angelegt} Wände aus der Skizze übernommen.`
          : `${angelegt} von ${vorschlag.strecken.length} Wänden übernommen — die übrigen gab es schon.`;
      get().setStatus(message);
      return { ok: true, message };
    },

    verwirfSkizze: () => {
      set({ skizze: null });
      get().setStatus('Skizze verworfen.');
    },

    setzeSkizzenwand: (patch) => {
      const s2 = get().skizze;
      if (s2) set({ skizze: { ...s2, ...patch } });
    },

    /**
     * Eine Freihandnotiz ablegen.
     *
     * Sie geht ins Dokument und damit in die Projektdatei — eine Notiz, die
     * beim Speichern verschwindet, schreibt niemand ein zweites Mal. Sie geht
     * **nicht** in Massenauszug, Heizlast oder Export: sie ist eine
     * Randbemerkung und keine Geometrie.
     */
    notiere: (punkte, druck) => {
      if (punkte.length < 2) return;
      mutate((doc) => {
        const strich: Freihandstrich = {
          id: uid('fh'),
          levelId: doc.activeLevelId,
          punkte: punkte.map((p) => ({ x: p.x, y: p.y })),
          ...(druck && druck.length === punkte.length ? { druck: [...druck] } : {}),
          createdAt: new Date().toISOString(),
        };
        doc.freihand = { ...(doc.freihand ?? {}), [strich.id]: strich };
      });
    },

    loescheNotiz: (id) => {
      mutate((doc) => {
        if (!doc.freihand?.[id]) return;
        const rest = { ...doc.freihand };
        delete rest[id];
        doc.freihand = rest;
      });
    },

    loescheNotizen: () => {
      const aktiv = get().doc.activeLevelId;
      let weg = 0;
      mutate((doc) => {
        const rest: Record<string, Freihandstrich> = {};
        for (const [id, f] of Object.entries(doc.freihand ?? {})) {
          if (f.levelId === aktiv) weg += 1;
          else rest[id] = f;
        }
        doc.freihand = rest;
      });
      get().setStatus(weg > 0 ? `${weg} Notizen gelöscht.` : 'Keine Notizen in diesem Geschoss.');
    },

    radiere: (bahn) => {
      if (bahn.length === 0) return;
      const doc0 = get().doc;
      const treffer = getroffene(doc0.freihand ?? {}, bahn, doc0.activeLevelId);
      if (treffer.length === 0) {
        // Kein Treffer ist kein Fehler — aber auch kein Schritt in der
        // Historie. Wer daneben radiert, soll mit „Rückgängig" nicht ins
        // Leere greifen.
        get().setStatus('Nichts getroffen.');
        return;
      }
      mutate((doc) => {
        const rest = { ...(doc.freihand ?? {}) };
        for (const id of treffer) delete rest[id];
        doc.freihand = rest;
      });
      get().setStatus(treffer.length === 1 ? 'Notiz radiert.' : `${treffer.length} Notizen radiert.`);
    },

    setzeRadiergummi: (an) => set({ radiergummi: an }),

    setzeNotizenSichtbar: (sichtbar) => set({ notizenSichtbar: sichtbar }),
  };
}
