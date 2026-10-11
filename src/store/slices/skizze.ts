/**
 * Store-Slice „Skizzenseiten, Vollbild-Skizze und Annahmen".
 *
 * TD-22: Aus `useBimStore.ts` herausgelöst; die Aktionen sind unverändert.
 * `useBimStore` setzt den Store aus diesen Slices zusammen und reicht
 * `set`, `get` und `mutate` (Dokumentänderung mit Historie) herein.
 */

import type {
  BimNode,
  ToolId,
} from '../../types/bim';
import {
  MESSSTRECKE_MIN,
  duenneAus,
  meterJeMm,
  nachWelt,
  naechsterBlattname,
  neueSeite,
  strichZurueck,
  type Strich,
} from '../../lib/skizzenseite';
import { uid } from '../../lib/dokumentPflege';
import type { BimState, Mutate, StoreGet, StoreSet } from '../bimZustand';

/*
 * Was vor dem Skizzen-Vollbild galt.
 *
 * Bewusst zwei schlichte Variablen neben dem Store und keine Felder darin:
 * Sie sind reine Erinnerung für die Dauer eines Vollbilds, gehen in keine
 * Sicherung ein und haben in einem Dokument nichts verloren. Ein Feld im
 * Zustand hätte außerdem die Frage aufgeworfen, was beim Neuladen damit
 * geschieht — und die Antwort wäre „nichts", weil das Vollbild dann ohnehin
 * zu ist.
 */
let vorherigesWerkzeug: ToolId = 'select';
let vorherigerFinger = false;

export type SkizzeSchluessel =
  | 'waehleBlatt'
  | 'sorgeFuerBlatt'
  | 'neuesBlatt'
  | 'loescheBlatt'
  | 'benenneBlatt'
  | 'setzeBlattMassstab'
  | 'uebertrageBlatt'
  | 'zeichneAufBlatt'
  | 'nimmBlattstrichZurueck'
  | 'leereBlatt'
  | 'setzeVollbildSkizze'
  | 'vermerkeAnnahme'
  | 'entferneAnnahme';

export function skizzeSlice(set: StoreSet, get: StoreGet, mutate: Mutate): Pick<BimState, SkizzeSchluessel> {
  return {
    // --- Skizzenseiten ----------------------------------------------------
    /*
     * Ein Blatt ist **kein** Modellteil: Es trägt keine Geometrie, keine
     * Länge in Metern und keinen Raum. Es gehört trotzdem ins Dokument, weil
     * es zum Projekt gehört — eine Handskizze, die beim Speichern verloren
     * geht, zeichnet niemand ein zweites Mal.
     */
    waehleBlatt: (id) => set({ aktivesBlatt: id }),

    sorgeFuerBlatt: () => {
      const da = Object.keys(get().doc.meta.skizzen ?? {});
      if (da.length) {
        if (!get().aktivesBlatt || !da.includes(get().aktivesBlatt as string)) set({ aktivesBlatt: da[0] });
        return da[0];
      }
      return get().neuesBlatt();
    },

    neuesBlatt: () => {
      const id = uid('sk');
      mutate((doc) => {
        const vorhanden = Object.values(doc.meta.skizzen ?? {});
        doc.meta.skizzen = {
          ...(doc.meta.skizzen ?? {}),
          [id]: neueSeite(id, naechsterBlattname(vorhanden), new Date().toISOString()),
        };
      });
      set({ aktivesBlatt: id, statusMessage: 'Neues Skizzenblatt angelegt' });
      return id;
    },

    loescheBlatt: (id) => {
      mutate((doc) => {
        if (!doc.meta.skizzen?.[id]) return;
        const rest = { ...doc.meta.skizzen };
        delete rest[id];
        doc.meta.skizzen = rest;
      });
      const uebrig = Object.keys(get().doc.meta.skizzen ?? {});
      set({
        aktivesBlatt: uebrig[0],
        statusMessage: uebrig.length ? 'Blatt entfernt' : 'Letztes Blatt entfernt',
      });
    },

    benenneBlatt: (id, name) =>
      mutate((doc) => {
        const seite = doc.meta.skizzen?.[id];
        if (!seite) return;
        const sauber = name.trim();
        // Ein leerer Name wäre ein Blatt ohne Aufschrift — im Ausdruck nicht
        // mehr zuzuordnen. Dann bleibt der alte stehen.
        if (!sauber) return;
        doc.meta.skizzen = { ...doc.meta.skizzen, [id]: { ...seite, name: sauber } };
      }),

    setzeBlattMassstab: (id, massstab) =>
      mutate((doc) => {
        const seite = doc.meta.skizzen?.[id];
        if (!seite) return;
        doc.meta.skizzen = {
          ...doc.meta.skizzen,
          [id]: massstab ? { ...seite, massstab } : { ...seite, massstab: undefined },
        };
      }),

    uebertrageBlatt: (id, optionen) => {
      const seite = get().doc.meta.skizzen?.[id];
      if (!seite) return { ok: false, message: 'Dieses Blatt gibt es nicht.', zuege: 0 };

      const faktor = meterJeMm(seite.massstab);
      if (faktor === undefined) {
        /*
         * Ohne Maßstab wird nicht geraten. Ein angenommener Maßstab — etwa
         * „das Blatt ist 10 m breit" — ergäbe einen Grundriss, der plausibel
         * aussieht und um einen beliebigen Faktor falsch ist. Das ist der
         * schlechteste Ausgang: Man sucht den Fehler dann in den Wänden.
         */
        const message = seite.massstab
          ? `Die Messstrecke ist zu kurz (unter ${MESSSTRECKE_MIN} mm Papier) oder ohne Länge — damit lässt sich kein Maßstab bilden.`
          : 'Dem Blatt fehlt der Maßstab. Ziehen Sie eine Messstrecke über eine Länge, die Sie kennen, und schreiben Sie das Maß dazu.';
        set({ statusMessage: message });
        return { ok: false, message, zuege: 0 };
      }

      const striche = seite.striche.filter((st) => !optionen?.nurSchwarz || st.farbe === 'schwarz');
      if (!striche.length) {
        const message = optionen?.nurSchwarz
          ? 'Auf diesem Blatt steht kein schwarzer Strich — schwarz ist die Farbe für das Bauliche.'
          : 'Das Blatt ist leer.';
        set({ statusMessage: message });
        return { ok: false, message, zuege: 0 };
      }

      /*
       * **Wohin im Grundriss?** Ist das Geschoss leer, beginnt der Vorschlag
       * im Ursprung. Steht schon etwas, wird er **neben** den Bestand gelegt,
       * mit einem Meter Abstand — nicht darüber. Ein Vorschlag, der in den
       * vorhandenen Wänden liegt, ist nicht zu prüfen: Man sieht nicht mehr,
       * was neu ist und was dastand.
       */
      const levelId = get().doc.activeLevelId;
      const knoten = Object.values(get().doc.walls)
        .filter((w) => w.levelId === levelId)
        .flatMap((w) => [get().doc.nodes[w.a], get().doc.nodes[w.b]])
        .filter((n): n is BimNode => Boolean(n));
      const ursprung =
        knoten.length > 0
          ? { x: Math.max(...knoten.map((n) => n.x)) + 1, y: Math.min(...knoten.map((n) => n.y)) }
          : { x: 0, y: 0 };

      let gelesen = 0;
      let letzte = '';
      for (const strich of striche) {
        const welt = nachWelt(strich.punkte, faktor, ursprung);
        const r = get().skizziere(welt);
        if (r.ok) gelesen += 1;
        else letzte = r.message;
      }

      if (gelesen === 0) {
        const message = `Aus den ${striche.length} Strichen ließ sich keine Wand lesen. ${letzte}`.trim();
        set({ statusMessage: message });
        return { ok: false, message, zuege: 0 };
      }

      // Der Vorschlag liegt im Grundriss — dort muss der Anwender auch
      // hinsehen können. Ein Vorschlag, den niemand sieht, ist keiner.
      const vorschlag = get().skizze;
      const message =
        `${gelesen} von ${striche.length} ${striche.length === 1 ? 'Strich' : 'Strichen'} übernommen: ` +
        `${vorschlag?.strecken.length ?? 0} Wandvorschläge bei ${(1 / faktor).toFixed(1).replace('.', ',')} mm je Meter. ` +
        'Jetzt im Grundriss prüfen und mit „Übernehmen" anlegen — das Blatt bleibt, wie es ist.';
      set({ viewMode: '2d', tool: 'select', statusMessage: message });
      return { ok: true, message, zuege: gelesen };
    },

    zeichneAufBlatt: (id, punkte, farbe, staerke) => {
      // Ein Zug aus einem einzigen Punkt ist ein Tippen, kein Strich.
      if (punkte.length < 2) return;
      mutate((doc) => {
        const seite = doc.meta.skizzen?.[id];
        if (!seite) return;
        /*
         * Ausgedünnt wird beim Ablegen und nicht beim Zeichnen: Während des
         * Zugs zählt die Darstellung, danach die Dateigröße. Ein Zug über das
         * halbe Blatt liefert mehrere hundert Punkte.
         */
        const strich: Strich = { id: uid('st'), punkte: duenneAus(punkte), farbe, staerke };
        doc.meta.skizzen = { ...doc.meta.skizzen, [id]: { ...seite, striche: [...seite.striche, strich] } };
      });
    },

    nimmBlattstrichZurueck: (id) =>
      mutate((doc) => {
        const seite = doc.meta.skizzen?.[id];
        if (!seite || !seite.striche.length) return;
        doc.meta.skizzen = { ...doc.meta.skizzen, [id]: strichZurueck(seite) };
      }),

    leereBlatt: (id) =>
      mutate((doc) => {
        const seite = doc.meta.skizzen?.[id];
        if (!seite || !seite.striche.length) return;
        doc.meta.skizzen = { ...doc.meta.skizzen, [id]: { ...seite, striche: [] } };
      }),

    /*
     * Das Vollbild schaltet zwei Dinge zugleich: das Werkzeug auf „Skizze"
     * und den Finger aufs Zeichnen. Beim Verlassen wird **beides**
     * zurückgenommen — wer vorher mit dem Auswahlwerkzeug gearbeitet hat,
     * soll danach nicht plötzlich skizzieren, und wer den Finger bewusst
     * aufs Schieben gestellt hatte, behält das.
     */
    setzeVollbildSkizze: (offen) => {
      const st = get();
      if (offen) {
        vorherigesWerkzeug = st.tool;
        vorherigerFinger = st.snap.fingerZeichnet ?? false;
        set({
          vollbildSkizze: true,
          tool: 'sketch',
          snap: { ...st.snap, fingerZeichnet: true },
          statusMessage: 'Zeichnen Sie den Grundriss, wie Sie es auf Papier täten — Finger oder Stift.',
        });
      } else {
        set({
          vollbildSkizze: false,
          tool: vorherigesWerkzeug,
          snap: { ...st.snap, fingerZeichnet: vorherigerFinger },
        });
      }
    },

    vermerkeAnnahme: (was, wert, grund) =>
      mutate((doc) => {
        const ohne = (doc.meta.annahmen ?? []).filter((a) => a.was !== was);
        doc.meta.annahmen = ohne.concat({ was, wert, grund, at: new Date().toISOString() });
      }),

    entferneAnnahme: (was) =>
      mutate((doc) => {
        const liste = doc.meta.annahmen;
        if (!liste || !liste.some((a) => a.was === was)) return;
        doc.meta.annahmen = liste.filter((a) => a.was !== was);
      }),
  };
}
