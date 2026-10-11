/**
 * Store-Slice „Oberfläche: Werkzeug, Auswahl, Ansicht, Voreinstellungen".
 *
 * TD-22: Aus `useBimStore.ts` herausgelöst; die Aktionen sind unverändert.
 * `useBimStore` setzt den Store aus diesen Slices zusammen und reicht
 * `set`, `get` und `mutate` (Dokumentänderung mit Historie) herein.
 */

import type {
  Selection,
  Vec2,
} from '../../types/bim';
import {
  ANNOTATION_LABELS,
  OPENING_PRESETS,
  PIPE_SERVICE_LABELS,
  SITE_ELEMENT_LABELS,
  SOLID_LABELS,
  VERTICAL_LABELS,
} from '../../types/bim';
import { auswahlGesperrt, istSichtbar } from '../../lib/ebenen';
import { stehtAufGeschoss } from '../../lib/aufstellgeschoss';
import { spracheSetzen, type Sprache } from '../../lib/sprache';
import { ROOM_TEMPLATE_BY_KIND } from '../../lib/roomTemplates';
import type { BimState, Mutate, StoreGet, StoreSet } from '../bimZustand';
import { SPRACH_SCHLUESSEL } from '../bimZustand';

export type UiSchluessel =
  | 'setTool'
  | 'setViewMode'
  | 'setPruefansicht'
  | 'setCameraMode'
  | 'setSelection'
  | 'setSelections'
  | 'toggleSelection'
  | 'selectInBox'
  | 'selectAll'
  | 'setHover'
  | 'setViewport'
  | 'hebeHervor'
  | 'setSnap'
  | 'toggleDimensions'
  | 'toggleRoofLines'
  | 'toggleCeiling'
  | 'setSprache'
  | 'setRoomTemplate'
  | 'setRoomTemplateOptions'
  | 'setPipeService'
  | 'setDoppelleitung'
  | 'setVerticalKind'
  | 'setSolidKind'
  | 'setDurchbruchPreset'
  | 'setAnnotationKind'
  | 'setSiteKind'
  | 'toggleRoomLabels'
  | 'setUiMode'
  | 'toggleDiagnostics'
  | 'toggleGuides'
  | 'setOrthoLock'
  | 'setOpeningPreset'
  | 'setActiveFixture'
  | 'setWallDefaults'
  | 'setOpeningDefaults'
  | 'setStatus'
  | 'setAiState';

export function uiSlice(set: StoreSet, get: StoreGet, _mutate: Mutate): Pick<BimState, UiSchluessel> {
  return {
    // ----------------------------------------------------------------- UI
    setTool: (tool) => {
      const state = get();
      // Beim Wechsel auf ein Öffnungswerkzeug die Vorlage mitziehen: wer
      // „Durchgang" wählt, will keinen Durchgang mit Fensterparametern.
      let openingPreset = state.openingPreset;
      if ((tool === 'door' || tool === 'window' || tool === 'passage') && openingPreset.kind !== tool) {
        openingPreset = OPENING_PRESETS.find((p) => p.kind === tool) ?? openingPreset;
      }
      set({ tool, openingPreset, selection: tool === 'select' ? state.selection : null });
    },
    setViewMode: (viewMode) => set({ viewMode }),
    setPruefansicht: (an) =>
      // In der Prüfansicht verschiebt ein Finger den Plan und legt nichts an.
      set(an ? { pruefansicht: true, tool: 'pan', selection: null, selections: [] } : { pruefansicht: false, tool: 'select' }),
    setCameraMode: (cameraMode) => set({ cameraMode }),
    setSelection: (selection, quelle = 'plan') =>
      set({ selection, selections: selection ? [selection] : [], auswahlQuelle: quelle }),

    setSelections: (selections) =>
      set({ selections, selection: selections.length ? selections[selections.length - 1] : null }),

    /** Strg/Umschalt-Klick: Objekt zur Auswahl hinzunehmen oder herausnehmen. */
    toggleSelection: (sel) => {
      const current = get().selections;
      const exists = current.some((s2) => s2.kind === sel.kind && s2.id === sel.id);
      const next = exists
        ? current.filter((s2) => !(s2.kind === sel.kind && s2.id === sel.id))
        : [...current, sel];
      set({ selections: next, selection: next.length ? next[next.length - 1] : null });
    },

    /** Auswahlrahmen: alles im Rechteck fassen (nur das aktive Geschoss). */
    selectInBox: (min, max, additive) => {
      const doc = get().doc;
      const inBox = (p: Vec2) => p.x >= min.x && p.x <= max.x && p.y >= min.y && p.y <= max.y;
      const found: Selection[] = [];

      for (const wall of Object.values(doc.walls)) {
        if (wall.levelId !== doc.activeLevelId) continue;
        const a = doc.nodes[wall.a];
        const b = doc.nodes[wall.b];
        // Vollständig im Rahmen — wie in CAD üblich beim Aufziehen nach rechts.
        if (a && b && inBox(a) && inBox(b)) found.push({ kind: 'wall', id: wall.id });
      }
      for (const f of Object.values(doc.fixtures)) {
        if (f.levelId !== doc.activeLevelId) continue;
        if (inBox(f.position)) found.push({ kind: 'fixture', id: f.id });
      }
      /*
       * Von Hand gesetzte Armaturen fasst der Rahmen mit, erzeugte nicht.
       *
       * Dieselbe Regel wie beim Antippen im Grundriss: Was der Rohrausleger
       * beim nächsten Auslegen ohnehin neu anlegt, darf nicht in einer
       * Auswahl stehen, die man danach löschen oder verschieben will.
       */
      for (const a of Object.values(doc.pipeAccessories ?? {})) {
        if (a.levelId !== doc.activeLevelId || a.generated) continue;
        if (inBox(a.position)) found.push({ kind: 'accessory', id: a.id });
      }
      /*
       * Das Gelände gehört keinem Geschoss an und wird in jedem gezeigt —
       * also ist es auch in jedem Geschoss mit dem Rahmen zu fassen.
       *
       * Das **Gerät** darin nicht: Es steht auf dem Geschoss, auf dem es
       * aufgestellt wurde, und wird anderswo nur durchscheinend gezeigt. Ein
       * Rahmen, der es dort mitnimmt, nähme etwas mit, das man nicht sieht —
       * und löschte es beim nächsten Tastendruck.
       */
      for (const pump of Object.values(doc.site.pumps)) {
        if (pump.form === 'indoor') continue; // steht nicht im Lageplan
        if (!stehtAufGeschoss(doc, pump, doc.activeLevelId)) continue;
        if (inBox(pump.position)) found.push({ kind: 'heatpump', id: pump.id });
      }
      for (const element of Object.values(doc.site.elements)) {
        // Dieselbe Regel wie bei der Wand: vollständig im Rahmen. Ein Zug,
        // von dem nur ein Stützpunkt getroffen ist, würde sich beim
        // Verschieben verformen statt zu wandern.
        if (element.points.length && element.points.every(inBox)) {
          found.push({ kind: 'site', id: element.id });
        }
      }

      const next = additive ? [...get().selections, ...found] : found;
      set({ selections: next, selection: next.length ? next[next.length - 1] : null });
    },

    /*
     * Strg+A — und zwar wirklich alles.
     *
     * **Was hier falsch war.** Bis 1.36.2 fasste „Alles auswählen" nur Wände
     * und TGA-Objekte des aktiven Geschosses. Wer danach Entf drückte, sah
     * das Gebäude verschwinden — und die Grundstücksgrenze, die Leitungen,
     * die Maßketten und die Wärmepumpe stehen bleiben. Gemeldet wurde genau
     * das: „leider kann ich grundstückgrenzen beim löschen nicht entfernen".
     * Eine Auswahl, die „alles" heißt und die Hälfte meint, ist schlimmer als
     * keine: Man hält den Plan für leer und arbeitet auf Resten weiter.
     *
     * **Was jetzt darin ist.** Alles, was auf diesem Geschoss liegt und sich
     * einzeln anfassen lässt, dazu das Gelände — es gehört keinem Geschoss
     * und wird in jedem gezeigt.
     *
     * **Was bewusst nicht darin ist.**
     * - *Räume.* Sie sind abgeleitet; sie verschwinden mit ihren Wänden und
     *   nicht auf Zuruf. In der Auswahl stünden sie nur als Zahl, die beim
     *   Löschen nicht aufgeht.
     * - *Öffnungen.* Sie gehen mit ihrer Wand, und die ist schon dabei.
     * - *Erzeugte Armaturen.* Dieselbe Regel wie beim Rahmen: Was der
     *   Rohrausleger beim nächsten Lauf ohnehin neu setzt, gehört nicht in
     *   eine Auswahl, die man löschen oder verschieben will.
     * - *Die Wärmepumpe fremder Geschosse.* Sie scheint hier nur durch.
     * - *Gesperrtes und Ausgeblendetes.* Was man nicht sieht oder nicht
     *   anfassen darf, wählt man auch nicht mit aus — sonst meldete das
     *   Löschen hinterher „gesperrt" für etwas, das man nie gewählt hat.
     *
     * Für das Leeren des ganzen Projekts gibt es `allesLoeschen()`; Strg+A
     * bleibt eine Auswahl auf *einem* Geschoss.
     */
    selectAll: () => {
      const doc = get().doc;
      const hier = doc.activeLevelId;
      const roh: Selection[] = [
        ...Object.values(doc.walls)
          .filter((w) => w.levelId === hier)
          .map((w) => ({ kind: 'wall' as const, id: w.id })),
        ...Object.values(doc.fixtures)
          .filter((f) => f.levelId === hier)
          .map((f) => ({ kind: 'fixture' as const, id: f.id })),
        ...Object.values(doc.pipes)
          .filter((r) => r.levelId === hier)
          .map((r) => ({ kind: 'pipe' as const, id: r.id })),
        ...Object.values(doc.pipeAccessories ?? {})
          .filter((a) => a.levelId === hier && !a.generated)
          .map((a) => ({ kind: 'accessory' as const, id: a.id })),
        ...Object.values(doc.verticals ?? {})
          .filter((v) => v.levelId === hier)
          .map((v) => ({ kind: 'vertical' as const, id: v.id })),
        ...Object.values(doc.solids ?? {})
          .filter((b) => b.levelId === hier)
          .map((b) => ({ kind: 'solid' as const, id: b.id })),
        ...Object.values(doc.durchbrueche ?? {})
          .filter((d) => d.levelId === hier)
          .map((d) => ({ kind: 'durchbruch' as const, id: d.id })),
        ...Object.values(doc.annotations ?? {})
          .filter((a) => a.levelId === hier)
          .map((a) => ({ kind: 'annotation' as const, id: a.id })),
        ...Object.values(doc.site.elements).map((e) => ({ kind: 'site' as const, id: e.id })),
        ...Object.values(doc.site.pumps)
          .filter((p) => stehtAufGeschoss(doc, p, hier))
          .map((p) => ({ kind: 'heatpump' as const, id: p.id })),
      ];
      const next = roh.filter((sel) => !auswahlGesperrt(doc, sel) && istSichtbar(doc, sel.kind, sel.id));
      set({ selections: next, selection: next.length ? next[next.length - 1] : null });
    },
    setHover: (hover) => set({ hover }),
    setViewport: (vp) => set({ viewport: { ...get().viewport, ...vp } }),

    /**
     * Zu einer Stelle springen und sie markieren.
     *
     * **Warum herangezoomt wird und nicht nur verschoben.** Die Befunde,
     * die man anspringt, sind klein: eine Wand von 0,0 cm, eine Bohrung von
     * 68 mm, eine Öffnung, die zwei Zentimeter über die Wand ragt. Bei 60
     * Bildpunkten je Meter ist das ein Pixel. Wer eine Sache beheben soll,
     * muss sie greifen können.
     *
     * **Warum eine Untergrenze und kein fester Wert.** Wer schon bei 200
     * Bildpunkten je Meter arbeitet, will nicht auf 120 herausgezogen
     * werden — das wäre eine Ansicht, die sich gegen ihren Benutzer wehrt.
     * Herangezoomt wird nur, wer noch zu weit weg ist.
     */
    hebeHervor: (position, mindestZoom = 140) => {
      const vp = get().viewport;
      set({
        viewport: { ...vp, center: { ...position }, zoom: Math.max(vp.zoom, mindestZoom) },
        hervorhebung: { position: { ...position }, seit: Date.now() },
      });
    },
    setSnap: (patch) => set({ snap: { ...get().snap, ...patch } }),
    toggleDimensions: () => set({ showDimensions: !get().showDimensions }),
    toggleRoofLines: () => set({ showRoofLines: !get().showRoofLines }),
    toggleCeiling: () => set({ showCeiling: !get().showCeiling }),
    /**
     * Sprache umstellen.
     *
     * Drei Dinge in einem Schritt, und alle drei sind nötig: der
     * Modulzustand in `lib/sprache` (daraus liest `t()`), der Speicher
     * (daraus lesen die Bauteile und zeichnen neu) und der Browser (damit
     * die Wahl den nächsten Start überlebt). Fehlt der erste, übersetzt
     * nichts; fehlt der zweite, ändert sich das Bild nicht; fehlt der
     * dritte, fragt das Programm jeden Morgen erneut.
     */
    setSprache: (s2: Sprache) => {
      spracheSetzen(s2);
      try {
        localStorage.setItem(SPRACH_SCHLUESSEL, s2);
      } catch {
        // Privates Fenster oder gesperrter Speicher: die Wahl gilt für
        // diese Sitzung und wird eben nicht gemerkt. Kein Grund, die
        // Umstellung deshalb zu verweigern.
      }
      set({ sprache: s2 });
    },
    setRoomTemplate: (kind) =>
      set({ roomTemplate: kind, tool: 'room', statusMessage: `${ROOM_TEMPLATE_BY_KIND[kind].label} — im Plan aufziehen` }),
    setRoomTemplateOptions: (patch) =>
      set((st) => ({ roomTemplateOptions: { ...st.roomTemplateOptions, ...patch } })),
    setPipeService: (service) =>
      set({ pipeService: service, statusMessage: PIPE_SERVICE_LABELS[service] }),

    setDoppelleitung: (an) =>
      set({
        doppelleitung: an,
        statusMessage: an
          ? 'Doppelleitung: ein Zug legt Vor- und Rücklauf nebeneinander'
          : 'Einzelleitung: ein Zug legt eine Leitung',
      }),
    setVerticalKind: (kind) => set({ verticalKind: kind, statusMessage: VERTICAL_LABELS[kind] }),

    setSolidKind: (kind) => set({ solidKind: kind, statusMessage: SOLID_LABELS[kind] }),

    setDurchbruchPreset: (preset) =>
      set({
        durchbruchPreset: preset,
        durchbruchKind: preset.kind,
        statusMessage: preset.label,
      }),
    setAnnotationKind: (kind) => set({ annotationKind: kind, statusMessage: ANNOTATION_LABELS[kind] }),
    setSiteKind: (kind) => set({ siteKind: kind, statusMessage: SITE_ELEMENT_LABELS[kind] }),
    toggleRoomLabels: () => set({ showRoomLabels: !get().showRoomLabels }),
    setUiMode: (mode) => {
      // Bewusst über einen Neustart hinweg gemerkt: der Modus ist eine
      // Eigenschaft des Menschen, nicht des Projekts.
      try {
        localStorage.setItem('ravia-ui-mode', mode);
      } catch {
        // Privater Modus oder gesperrter Speicher — dann gilt er nur jetzt.
      }
      set({ uiMode: mode });
    },
    toggleDiagnostics: () => set({ showDiagnostics: !get().showDiagnostics }),
    toggleGuides: () => set({ showGuides: !get().showGuides }),
    setOrthoLock: (orthoLock) => set({ orthoLock }),
    setOpeningPreset: (openingPreset) => set({ openingPreset }),
    setActiveFixture: (activeFixture) => set({ activeFixture, tool: 'fixture' }),
    setWallDefaults: (patch) => set({ wallDefaults: { ...get().wallDefaults, ...patch } }),
    setOpeningDefaults: (patch) => set({ openingDefaults: { ...get().openingDefaults, ...patch } }),
    setStatus: (statusMessage) => set({ statusMessage }),
    setAiState: (aiState) => set({ aiState }),
  };
}
