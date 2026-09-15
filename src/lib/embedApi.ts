/**
 * Einbettungs-Schnittstelle für RaVia.
 * ---------------------------------------------------------------------------
 * Der Umweg über eine Exportdatei ist für den Menschen gedacht: herunterladen,
 * ablegen, hochladen. Wenn RaVia dieses Werkzeug einbettet, ist er überflüssig
 * und sogar schädlich — jede Datei ist ein Stand, der veralten kann.
 *
 * Deshalb zwei Wege, die dasselbe können:
 *
 *  1. **Direkt im selben Fenster** über `window.RaViaCAD`. Das ist der Fall,
 *     wenn RaVia die Anwendung als Skript einbindet.
 *  2. **Über `postMessage`**, wenn sie in einem `<iframe>` läuft. Dieselben
 *     Befehle, nur als Nachrichten.
 *
 * Wichtig für die Stabilität: diese Schnittstelle ist bewusst *schmal* und
 * von den inneren Datenstrukturen entkoppelt. `window.__ravia` (der rohe
 * Store) bleibt daneben bestehen, ist aber ausdrücklich kein Vertrag — wer
 * darauf baut, bricht beim nächsten Umbau. `RaViaCAD` bricht nicht.
 *
 * Antworten gehen immer an genau den Absender zurück, mit dessen eigenem
 * Origin als Ziel. Ein `*` als Ziel würde den Modellinhalt an jedes Fenster
 * ausliefern, das zufällig zuhört.
 */

import type { BimDocument, RaviaExport, ValidationReport } from '../types/bim';
import { buildRaviaExport } from './raviaExport';
import { buildIfc } from './ifcExport';
import { validateModel } from './validation';
import { writableFields } from './hostPatch';
import type { HostPatch, HostPatchReport } from './hostPatch';

/**
 * 1.1.0 — der Rückweg ist dazugekommen: `applyPatch` und
 * `getWritableFields`. Die lesenden Befehle sind unverändert geblieben,
 * deshalb die kleine Stelle: eine Gegenstelle, die gegen 1.0.0 gebaut wurde,
 * läuft weiter.
 *
 * 1.2.0 — der Export trägt zwei neue Blöcke, `emitters` und `hydraulics`,
 * und `applyPatch` nimmt zusätzlich `fixtures[]` entgegen. Auch das ist
 * ausschließlich Zuwachs: kein Feld ist weggefallen, keines hat seine
 * Bedeutung geändert. Wer gegen 1.1.0 gebaut hat, läuft unverändert weiter —
 * er sieht die neuen Blöcke nur nicht.
 */
export const EMBED_API_VERSION = '1.2.0';

/** Kurzfassung des Modells — das, was eine Gegenstelle meistens wissen will. */
export interface RaviaSummary {
  projectName: string;
  levels: number;
  rooms: number;
  walls: number;
  openings: number;
  /** Nettogrundfläche aller Räume [m²]. */
  netFloorArea: number;
  /** Luftvolumen aller Räume [m³]. */
  netVolume: number;
  /** Installierte Heizleistung [W]. */
  installedHeatingPower: number;
  /** Ist das Modell rechenfähig? */
  ready: boolean;
  errors: number;
  warnings: number;
}

/** Der Vertrag, auf den RaVia bauen darf. */
export interface RaviaCadApi {
  readonly version: string;
  /** Vollständiger Export nach `ravia.bim.light` v2. */
  getExport(): RaviaExport;
  /** Dasselbe Modell als IFC4-Text (STEP). */
  getIfc(): string;
  /** Kurzfassung ohne die große Datenmenge. */
  getSummary(): RaviaSummary;
  /** Prüfbericht — dieselbe Prüfung wie im Reiter „Prüfung". */
  validate(): ValidationReport;
  /** Rohdokument, nur lesend gedacht. */
  getDocument(): BimDocument;
  /**
   * Fachdaten zurückschreiben — Solltemperaturen, Luftwechsel, U-Werte,
   * Norm-Heizlasten, Randbedingungen des Projekts.
   *
   * Geometrie ist ausgenommen und wird mit Begründung abgelehnt: Wände gehören
   * dem, der zeichnet. Der Bericht sagt für jeden einzelnen Wert, ob er
   * übernommen, unverändert geblieben oder abgelehnt worden ist — und warum.
   * Der ganze Vorgang ist ein Schritt in der Rückgängig-Kette.
   */
  applyPatch(patch: HostPatch): HostPatchReport;
  /**
   * Selbstauskunft: was ist schreibbar, in welcher Einheit, in welchen
   * Grenzen. Damit muss die Gegenstelle nicht ausprobieren, was geht, und
   * kann ihre eigene Maske daraus bauen.
   */
  getWritableFields(): ReturnType<typeof writableFields>;
  /** Projektdatei (RaVia-JSON) laden. */
  loadProject(data: unknown): { ok: boolean; message: string };
  /** IFC4-Datei laden. Ersetzt das aktuelle Modell. */
  loadIfc(text: string): { ok: boolean; message: string };
  /**
   * Auf Änderungen hören. Der Rückgabewert meldet den Hörer wieder ab.
   * Gemeldet wird entprellt die Kurzfassung, nicht das ganze Modell —
   * bei jedem gezogenen Wandende den vollen Export zu schicken wäre
   * Verschwendung.
   */
  onChange(listener: (summary: RaviaSummary) => void): () => void;
}

interface StoreLike {
  getState: () => {
    doc: BimDocument;
    loadProject: RaviaCadApi['loadProject'];
    loadIfc: RaviaCadApi['loadIfc'];
    applyHostPatch: (patch: HostPatch) => HostPatchReport;
  };
  subscribe: (listener: (state: { doc: BimDocument }, prev: { doc: BimDocument }) => void) => () => void;
}

export function buildSummary(doc: BimDocument): RaviaSummary {
  const report = validateModel(doc);
  const rooms = Object.values(doc.rooms);
  return {
    projectName: doc.meta.name,
    levels: Object.keys(doc.levels).length,
    rooms: rooms.length,
    walls: Object.keys(doc.walls).length,
    openings: Object.keys(doc.openings).length,
    netFloorArea: round2(
      rooms.reduce((sum, r) => sum + Math.max(0, r.area - (r.floorOpeningArea ?? 0)), 0),
    ),
    netVolume: round2(rooms.reduce((sum, r) => sum + r.volume, 0)),
    installedHeatingPower: Object.values(doc.fixtures).reduce(
      (sum, f) => sum + (f.category === 'heating' ? (f.params.powerW ?? 0) : 0),
      0,
    ),
    ready: report.ready,
    errors: report.errors,
    warnings: report.warnings,
  };
}

const round2 = (v: number): number => Math.round(v * 100) / 100;

/**
 * Hängt die Schnittstelle an das Fenster und richtet die Nachrichtenbrücke
 * ein. Liefert eine Abbaufunktion — im Test wichtig, im Betrieb nie nötig.
 */
export function installEmbedApi(store: StoreLike, target: Window = window): () => void {
  const listeners = new Set<(summary: RaviaSummary) => void>();
  let debounce: ReturnType<typeof setTimeout> | undefined;

  const notify = () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      if (!listeners.size) return;
      const summary = buildSummary(store.getState().doc);
      for (const l of listeners) {
        try {
          l(summary);
        } catch {
          // Ein fehlerhafter Hörer darf die anderen nicht mitreißen.
        }
      }
    }, 250);
  };

  const unsubscribeStore = store.subscribe((state, prev) => {
    if (state.doc !== prev.doc) notify();
  });

  const api: RaviaCadApi = {
    version: EMBED_API_VERSION,
    getExport: () => buildRaviaExport(store.getState().doc),
    getIfc: () => buildIfc(store.getState().doc),
    getSummary: () => buildSummary(store.getState().doc),
    validate: () => validateModel(store.getState().doc),
    getDocument: () => store.getState().doc,
    loadProject: (data) => store.getState().loadProject(data),
    loadIfc: (text) => store.getState().loadIfc(text),
    applyPatch: (patch) => store.getState().applyHostPatch(patch),
    getWritableFields: () => writableFields(),
    onChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  (target as Window & { RaViaCAD?: RaviaCadApi }).RaViaCAD = api;

  // --- Nachrichtenbrücke ----------------------------------------------------
  const subscribers = new Set<{ source: MessageEventSource; origin: string }>();

  const reply = (event: MessageEvent, type: string, id: unknown, payload: unknown) => {
    const source = event.source as Window | null;
    if (!source) return;
    // Zurück an genau den Absender, mit seinem eigenen Origin als Ziel.
    // `*` würde den Modellinhalt an jedes zuhörende Fenster ausliefern.
    const origin = event.origin && event.origin !== 'null' ? event.origin : '*';
    source.postMessage({ channel: 'ravia-cad', type, id, payload }, { targetOrigin: origin });
  };

  const onMessage = (event: MessageEvent) => {
    const data = event.data as { channel?: string; type?: string; id?: unknown; payload?: unknown };
    if (!data || data.channel !== 'ravia-cad' || typeof data.type !== 'string') return;

    switch (data.type) {
      case 'ping':
        reply(event, 'pong', data.id, { version: EMBED_API_VERSION });
        break;
      case 'getSummary':
        reply(event, 'summary', data.id, api.getSummary());
        break;
      case 'getExport':
        reply(event, 'export', data.id, api.getExport());
        break;
      case 'getIfc':
        reply(event, 'ifc', data.id, api.getIfc());
        break;
      case 'validate':
        reply(event, 'validation', data.id, api.validate());
        break;
      case 'loadProject':
        reply(event, 'loaded', data.id, api.loadProject(data.payload));
        break;
      case 'loadIfc':
        reply(event, 'loaded', data.id, api.loadIfc(String(data.payload ?? '')));
        break;
      case 'applyPatch':
        // Die Prüfung der Nutzlast steckt vollständig in `hostPatch.ts`. Hier
        // wird nichts vorgefiltert: eine Nachricht mit unbrauchbarem Inhalt
        // soll denselben begründeten Bericht bekommen wie ein Aufruf über
        // `window.RaViaCAD` — sonst verhalten sich die beiden Wege
        // unterschiedlich, und genau das sucht später niemand.
        reply(event, 'patchApplied', data.id, api.applyPatch(data.payload as HostPatch));
        break;
      case 'getWritableFields':
        reply(event, 'writableFields', data.id, api.getWritableFields());
        break;
      case 'subscribe': {
        const source = event.source;
        if (source) {
          subscribers.add({ source, origin: event.origin });
          reply(event, 'subscribed', data.id, { version: EMBED_API_VERSION });
        }
        break;
      }
      case 'unsubscribe': {
        for (const s of [...subscribers]) if (s.source === event.source) subscribers.delete(s);
        reply(event, 'unsubscribed', data.id, null);
        break;
      }
      default:
        reply(event, 'error', data.id, { message: `Unbekannter Befehl: ${data.type}` });
    }
  };

  target.addEventListener('message', onMessage);

  const unsubscribeBroadcast = api.onChange((summary) => {
    for (const s of [...subscribers]) {
      const win = s.source as Window;
      try {
        // Geschlossene Fenster halten sonst die Liste voll.
        if (win.closed) {
          subscribers.delete(s);
          continue;
        }
        win.postMessage(
          { channel: 'ravia-cad', type: 'changed', id: null, payload: summary },
          { targetOrigin: s.origin && s.origin !== 'null' ? s.origin : '*' },
        );
      } catch {
        subscribers.delete(s);
      }
    }
  });

  return () => {
    target.removeEventListener('message', onMessage);
    unsubscribeBroadcast();
    unsubscribeStore();
    if (debounce) clearTimeout(debounce);
    listeners.clear();
    subscribers.clear();
    delete (target as Window & { RaViaCAD?: RaviaCadApi }).RaViaCAD;
  };
}
