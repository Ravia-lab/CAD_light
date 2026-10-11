/**
 * Zentraler Anwendungszustand (Zustand-Store).
 *
 * Aufteilung mit Absicht:
 *   • `doc`  — alles, was ins Projekt gehört und in die Historie einfließt
 *   • `ui`   — Werkzeug, Selektion, Viewport, Snapping: flüchtig, kein Undo
 *
 * Nur Mutationen an `doc` erzeugen einen Undo-Schritt. Das verhindert die
 * typische Frustration, bei der ein Undo den Zoom zurücksetzt statt die
 * letzte Wand zu entfernen.
 *
 * TD-22: Die Aktionen stehen thematisch getrennt in `slices/`; Typ,
 * Vorgaben und Helfer in `bimZustand.ts`. Hier bleiben `mutate`, der
 * Anfangszustand und die Historie (Gesten, Undo/Redo).
 */

import { create } from 'zustand';
import type { BimDocument } from '../types/bim';
import {
  OPENING_PRESETS,
  DURCHBRUCH_PRESETS,
} from '../types/bim';
import { VORGABE_U } from '../lib/uwert';
import { zieheHeizflaechenNach } from '../lib/heizflaechenAbgleich';
import type { UiModus } from '../lib/uimodus';
import { DEFAULT_TEMPLATE_OPTIONS } from '../lib/roomTemplates';
import {
  cloneDoc,
  recomputeRooms,
  teileUnveraendertes,
} from '../lib/dokumentPflege';
import type { BimState } from './bimZustand';
import { DEFAULT_SNAP, emptyDocument, geladeneSprache } from './bimZustand';
import { uiSlice } from './slices/ui';
import { bauteileSlice } from './slices/bauteile';
import { geschosseSlice } from './slices/geschosse';
import { bauteilkatalogSlice } from './slices/bauteilkatalog';
import { gruppenSlice } from './slices/gruppen';
import { einheitenSlice } from './slices/einheiten';
import { skizzeSlice } from './slices/skizze';
import { installationSlice } from './slices/installation';
import { anlageSlice } from './slices/anlage';
import { dachSlice } from './slices/dach';
import { ladenSlice } from './slices/laden';
import { referenzbildSlice } from './slices/referenzbild';

export { DEFAULT_LAYERS, ergaenzeEbenen, pipeLength } from './bimZustand';
export type { ClipboardContent, FloorLoopBatchReport, FloorLoopBatchResult, FloorLoopBatchSkip, OpeningDefaults, WallDefaults } from './bimZustand';

export const useBimStore = create<BimState>()((set, get) => {
  /**
   * Läuft gerade eine geklammerte Geste, und wurde ihr Ausgangsstand schon
   * abgelegt? Bewusst zwei Variablen im Abschluss statt Feldern im Zustand:
   * das ist reine Buchführung der Historie, kein Zustand, auf den die
   * Oberfläche reagieren soll — ein `set` dafür würde nur Neuzeichnen
   * auslösen.
   */
  let gestureActive = false;
  let gestureRecorded = false;

  /** Führt eine Dokumentmutation aus, schreibt Historie und erneuert Räume. */
  const mutate = (
    fn: (doc: BimDocument) => void,
    options?: { skipRooms?: boolean; ziehenachHeizflaechen?: boolean },
  ) => {
    const { doc, past } = get();
    const next = cloneDoc(doc);
    fn(next);
    // Während einer Geste nur das sichtbare Geschoss — siehe `recomputeRooms`.
    if (!options?.skipRooms) recomputeRooms(next, gestureActive);
    // Unveränderte Sammlungen behalten ihre Kennung — siehe oben.
    teileUnveraendertes(doc, next);
    /*
     * **Heizflächen nachziehen — aber nicht bei jedem Tastendruck.**
     *
     * `heizflaechenBefunde` rechnet die Heizlast aller Räume neu; das kostet
     * am Referenzhaus einige Millisekunden und am großen Projekt ein
     * Vielfaches davon. In `mutate` hängt aber *jede* Eingabe — jede
     * verschobene Wand, jeder getippte Buchstabe im Raumnamen. Blind
     * mitzurechnen hieße, die Oberfläche für eine Zahl zu verlangsamen, die
     * sich in neun von zehn Fällen gar nicht geändert hat.
     *
     * Deshalb muss der Aufrufer es ausdrücklich verlangen — und zwar an den
     * Stellen, an denen sich die Heizlast oder die Zahl der Heizflächen
     * wirklich ändern kann: beim Setzen und Löschen einer Heizfläche, beim
     * Ändern der Systemtemperaturen und auf Zuruf aus dem Anlagenblatt.
     * Läuft eine Änderung durch, die keiner dieser Fälle ist, bleibt die
     * Abweichung stehen — und wird in der Prüfliste gemeldet statt still
     * korrigiert.
     */
    if (options?.ziehenachHeizflaechen) zieheHeizflaechenNach(next);
    next.meta.modifiedAt = new Date().toISOString();
    // Innerhalb einer Geste wandert nur der erste Zwischenstand in die
    // Historie — alle folgenden Schritte gehören zu derselben Bewegung.
    const record = !gestureActive || !gestureRecorded;
    if (gestureActive) gestureRecorded = true;
    set({
      doc: next,
      past: record ? [...past.slice(-49), doc] : past, // max. 50 Schritte
      future: [],
    });
  };

  return {
    doc: emptyDocument(),
    past: [],
    future: [],

    tool: 'wall',
    viewMode: '2d',
    pruefansicht: false,
    cameraMode: 'orbit',
    selection: null,
    auswahlQuelle: 'plan',
    selections: [],
    clipboard: null,
    hover: null,
    viewport: { zoom: 60, center: { x: 4, y: 3 } },
    hervorhebung: null,
    einpassenZaehler: 0,
    snap: DEFAULT_SNAP,
    showDimensions: true,
    showRoofLines: true,
    showCeiling: false,
    sprache: geladeneSprache(),
    pipeService: 'heating-flow',
    doppelleitung: true,
    roomTemplate: 'rechteck',
    roomTemplateOptions: { ...DEFAULT_TEMPLATE_OPTIONS },
    verticalKind: 'stair-straight',
    solidKind: 'chimney',
    durchbruchKind: 'kernbohrung',
    durchbruchPreset: DURCHBRUCH_PRESETS[4],
    /*
     * Vorgabe ist **Text**, nicht die Maßkette.
     *
     * Das Werkzeug heißt „Text & Maßkette", und wer es greift, will in den
     * allermeisten Fällen etwas auf den Plan schreiben. Stand die Vorgabe auf
     * „Maßkette", bekam er beim ersten Tippen eine angefangene Bemaßung und
     * musste erst einen Umschalter finden, der auf dem Tablet aus der
     * Kopfzeile herausgescrollt war.
     */
    annotationKind: 'text',
    siteKind: 'boundary',
    showRoomLabels: true,
    /*
     * Der Einstieg ist der einfache Modus. Wer mehr braucht, schaltet um —
     * umgekehrt sucht niemand nach dem Schalter, der ihm die Hälfte wegnimmt.
     *
     * Der Handwerkermodus ist **nicht** der Einstieg, obwohl er der
     * schmalste ist: Wer das Programm zum ersten Mal öffnet, weiß noch
     * nicht, ob er nur aufmisst. Eine Oberfläche, die von sich aus die
     * Hälfte wegnimmt, wirkt kaputt; eine, die man bewusst schmaler stellt,
     * wirkt aufgeräumt.
     */
    uiMode: ((): UiModus => {
      const gespeichert = typeof localStorage !== 'undefined' ? localStorage.getItem('ravia-ui-mode') : null;
      return gespeichert === 'profi' || gespeichert === 'handwerker' || gespeichert === 'einfach'
        ? gespeichert
        : 'einfach';
    })(),
    showDiagnostics: true,
    showGuides: true,
    orthoLock: false,
    openingPreset: OPENING_PRESETS[2],
    activeFixture: 'radiator',
    wallDefaults: { thickness: 0.24, height: 2.75, type: 'exterior', uValue: VORGABE_U.exterior },
    openingDefaults: {
      doorWidth: 0.885,
      doorHeight: 2.01,
      windowWidth: 1.26,
      windowHeight: 1.385,
      windowSill: 0.9,
    },
    aiState: { status: 'idle' },
    statusMessage: 'Bereit',
    verworfeneRaeume: {},
    skizze: null,
    assistent: false,
    vollbildSkizze: false,
    radiergummi: false,
    notizenSichtbar: true,
    ...uiSlice(set, get, mutate),
    ...bauteileSlice(set, get, mutate),
    ...geschosseSlice(set, get, mutate),
    ...bauteilkatalogSlice(set, get, mutate),
    ...gruppenSlice(set, get, mutate),
    ...einheitenSlice(set, get, mutate),
    ...skizzeSlice(set, get, mutate),
    ...installationSlice(set, get, mutate),
    ...anlageSlice(set, get, mutate),
    ...dachSlice(set, get, mutate),
    ...ladenSlice(set, get, mutate),
    ...referenzbildSlice(set, get, mutate),

    // ----------------------------------------------------------- Historie
    beginGesture: () => {
      gestureActive = true;
      gestureRecorded = false;
    },
    endGesture: () => {
      const lief = gestureActive;
      gestureActive = false;
      gestureRecorded = false;
      /*
       * Einmal vollständig nachrechnen.
       *
       * Während des Zuges lief die Raumerkennung nur über das sichtbare
       * Geschoss. Das ist richtig, solange gezogen wird — aber nur solange:
       * Eine Wand, die zwei Geschosse begrenzt (ein Luftraum über dem
       * Wohnzimmer), oder ein verschobener Schacht wirkt nach oben, und
       * dieser Anteil muss nach dem Loslassen stimmen. Ohne diesen Durchlauf
       * bliebe die Abweichung bis zur nächsten beliebigen Änderung stehen —
       * und niemand sähe sie.
       *
       * Ohne Geste passiert nichts: `endGesture` wird auch dann gerufen,
       * wenn gar nicht gezogen wurde.
       */
      if (!lief) return;
      const doc = cloneDoc(get().doc);
      recomputeRooms(doc);
      // Kein Historieneintrag: Die Geste hat ihren schon.
      set({ doc });
    },

    undo: () => {
      // Eine offene Geste würde den zurückgeholten Stand gleich wieder
      // überschreiben, ohne ihn abzulegen. Rückgängig beendet sie deshalb.
      gestureActive = false;
      gestureRecorded = false;
      const { past, doc, future } = get();
      if (!past.length) return;
      set({
        doc: past[past.length - 1],
        past: past.slice(0, -1),
        future: [doc, ...future].slice(0, 50),
        selection: null,
      });
    },

    redo: () => {
      const { future, doc, past } = get();
      if (!future.length) return;
      set({
        doc: future[0],
        future: future.slice(1),
        past: [...past, doc],
        selection: null,
      });
    },

    canUndo: () => get().past.length > 0,
    canRedo: () => get().future.length > 0,
  };
});

// ---------------------------------------------------------------------------
// Selektoren — verhindern unnötige Re-Renders in den Panels
// ---------------------------------------------------------------------------

