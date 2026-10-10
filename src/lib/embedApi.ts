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

import { heizleistung } from './normleistung';
import type { BimDocument, RaviaExport, ValidationReport } from '../types/bim';
import { buildRaviaExport } from './raviaExport';
import { buildIfc } from './ifcExport';
import { validateModel } from './validation';
import { writableFields } from './hostPatch';
import type { HostPatch, HostPatchReport } from './hostPatch';
import { geraetemerkmale, geraeteprofil, type Geraeteprofil } from './geraeteprofil';
import { registriereWirtMelder, setzeWirtFaehigkeiten } from './wirt';

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
 *
 * 1.3.0 — `loadBuilding`: das Gebäudemodell der App RaVia Scan
 * (`ravia.building`, Schema 1.x) direkt übernehmen, ohne Datei.
 *
 * 1.4.0 — `loadBuilding` nimmt zusätzlich `{ building, merge: true }` an und
 * legt das gescannte Geschoss dann **neben** die vorhandenen, statt das
 * Modell zu ersetzen. Alles Zuwachs: Wer das nackte Modell schickt, bekommt
 * das Verhalten von 1.3.0.
 *
 * 1.6.0 — `reportDiscardedRooms`: Die Gegenstelle meldet, welche Räume sie
 * beim Übernehmen verworfen hat (RaVias `verworfene_raeume`). CAD Light
 * setzt daraufhin einen Hinweis an den gezeichneten Raum. Reiner Zuwachs.
 *
 * 1.5.0 — `getDocument` gibt es jetzt auch über die Nachrichtenbrücke. Auf
 * `window.RaViaCAD` stand es schon lange, nur war das aus einem Rahmen
 * heraus unerreichbar: Beide Seiten sind getrennte Fenster, und über die
 * Brücke war `getDocument` kein Befehl. Wieder reiner Zuwachs.
 */
/*
 * 1.8.0 — `getDeviceProfile`: CAD Light sagt, auf welchem Gerät es läuft
 * (`{ touch, form: "phone"|"tablet"|"desktop", width, height, grund }`).
 * Die RaVia-Seite richtet danach den Dialog „Gebäude scannen" aus, statt
 * das Gerät ein zweites Mal selbst zu raten — siehe `lib/geraeteprofil.ts`.
 * Reiner Zuwachs.
 */
/*
 * 1.9.0 — `setHostCapabilities`: Der Wirt meldet, was er selbst übernimmt
 * (`{ scan: true }`). Dann schickt der Knopf „Mit RaVia Scan scannen" das
 * Ereignis `scanRequested` an die angemeldeten Wirte, und RaVia öffnet
 * seinen eigenen Dialog — siehe `lib/wirt.ts`. Ohne Meldung zeigt CAD Light
 * seinen eigenen Dialog (`lib/scanDienst.ts`). Reiner Zuwachs.
 */
export const EMBED_API_VERSION = '1.9.0';

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
   * Rückmeldung zum Übernahmelauf: Welche Räume hat die Gegenstelle
   * verworfen?
   *
   * Übergeben wird die Antwort, **wie sie kommt** — CAD Light liest daraus
   * `verworfene_raeume` (oder `rejected`). Entscheidend ist die Kennung: Sie
   * muss die aus `getExport().rooms[].id` sein, sonst lässt sich der Hinweis
   * an keinen gezeichneten Raum hängen.
   */
  reportDiscardedRooms(antwort: unknown): { hinweise: number; ohneRaum: number; message: string };
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
  /**
   * Auf welchem Gerät läuft CAD Light (seit 1.8.0)? Gelesen bei jedem
   * Aufruf neu — `width`/`height` sind das Fenster *jetzt*, nach einem
   * Drehen also die neuen Maße. Die Form bleibt beim Drehen gleich.
   */
  getDeviceProfile(): Geraeteprofil;
  /** Projektdatei (RaVia-JSON) laden. */
  loadProject(data: unknown): { ok: boolean; message: string };
  /** IFC4-Datei laden. Ersetzt das aktuelle Modell. */
  loadIfc(text: string): { ok: boolean; message: string };
  /**
   * Gebäudemodell aus RaVia Scan (`ravia.building`) laden — Wände, Öffnungen,
   * Raumnamen, Nordrichtung, Dachvorschlag, Heizkörper. Ersetzt das aktuelle
   * Modell; rückgängig machbar. Seit 1.3.0.
   *
   * Mit `{ merge: true }` (seit 1.4.0) bleibt alles stehen, was nicht zu den
   * Geschossen des Scans gehört — für das Haus, dessen Obergeschoss als
   * zweite Aufnahme kommt.
   */
  loadBuilding(data: unknown, optionen?: { merge?: boolean }): { ok: boolean; message: string };
  /**
   * Auf Änderungen hören. Der Rückgabewert meldet den Hörer wieder ab.
   * Gemeldet wird entprellt die Kurzfassung, nicht das ganze Modell —
   * bei jedem gezogenen Wandende den vollen Export zu schicken wäre
   * Verschwendung.
   */
  onChange(listener: (summary: RaviaSummary) => void): () => void;
  /**
   * **Auf einen abgeschlossenen Auslegungsstand hören** — seit 1.66.0.
   *
   * `onChange` meldet jede Änderung am Modell, entprellt. Für einen
   * hydraulischen Abgleich ist das zu viel: Er soll nicht auf jede
   * Zwischenänderung neu rechnen, sondern erst, wenn das Rohrnetz steht. So
   * hat es die RaVia-Seite am 01.10.2026 angefordert, und so ist es hier
   * umgesetzt.
   *
   * Gemeldet wird **nur** nach „Rohrnetz auslegen" — nicht beim Zeichnen
   * einzelner Leitungen, nicht beim Öffnen eines Projekts, nicht beim
   * Verschieben einer Wand. Der Rückgabewert meldet den Hörer wieder ab.
   *
   * Das Ereignis ist **nicht entprellt**: Es ist ein Vorgang und kein
   * Strom von Änderungen. Wer darauf rechnet, holt sich danach `getExport()`
   * — in der Nutzlast steht die Kurzfassung des Laufs, nicht das Netz selbst.
   */
  onNetzGelegt(listener: (stand: NetzStand) => void): () => void;
  /**
   * **Was der Wirt selbst übernimmt** — seit 1.9.0. `{ scan: true }` heißt:
   * Der Knopf „Mit RaVia Scan scannen" öffnet den Dialog des Wirts statt des
   * eigenen. Siehe `lib/wirt.ts`.
   */
  setHostCapabilities(faehigkeiten: { scan?: boolean }): { scan: boolean };
  /** Auf die Scan-Anforderung hören (Wirt im selben Dokument) — seit 1.9.0. */
  onScanRequested(listener: () => void): () => void;
}

/**
 * Die Kurzfassung eines Auslegungslaufs, wie sie mit `onNetzGelegt` kommt.
 *
 * Bewusst klein: Sie beantwortet „was wurde gerade gelegt und ist es etwas
 * geworden?". Das Netz selbst steht in `getExport().pipeGraph`, und es
 * zweimal zu übertragen wäre Verschwendung.
 */
export interface NetzStand {
  /** Fortlaufende Nummer des Laufs in dieser Sitzung. */
  lauf: number;
  at: string;
  mode: string;
  anordnung: 'baum' | 'ring';
  flaechenheizung: boolean;
  served: number;
  routeLength: number;
  pipeLength: number;
  accessories: number;
  durchbrueche: number;
  geschosse: number;
  straenge: number;
  flaechenraeume: number;
  /**
   * Schwerster Befund der Auslegung, falls einer vorliegt.
   *
   * Steht hier etwas, ist der Lauf **nicht** ohne Befund durchgelaufen — dann
   * ist der Auslegungsstand kein Stand, auf dem ein Nachweis aufbauen sollte.
   */
  fehler?: string;
}

interface StoreLike {
  getState: () => {
    doc: BimDocument;
    netzStand?: NetzStand;
    loadProject: RaviaCadApi['loadProject'];
    loadIfc: RaviaCadApi['loadIfc'];
    loadBuilding: RaviaCadApi['loadBuilding'];
    applyHostPatch: (patch: HostPatch) => HostPatchReport;
    meldeVerworfeneRaeume: RaviaCadApi['reportDiscardedRooms'];
  };
  subscribe: (
    listener: (
      state: { doc: BimDocument; netzStand?: NetzStand },
      prev: { doc: BimDocument; netzStand?: NetzStand },
    ) => void,
  ) => () => void;
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
      (sum, f) => sum + (f.category === 'heating' ? (heizleistung(f) ?? 0) : 0),
      0,
    ),
    ready: report.ready,
    errors: report.errors,
    warnings: report.warnings,
  };
}

const round2 = (v: number): number => Math.round(v * 100) / 100;

/**
 * Liest die erlaubten Herkünfte für die Nachrichtenbrücke aus einer
 * kommagetrennten Liste (`VITE_EMBED_HERKUNFT`, z. B.
 * `https://app.example.de,https://test.example.de`). Leer oder nicht gesetzt
 * ergibt `null`: keine Einschränkung, wie bis 1.x.
 */
export function parseHerkunftListe(text: string | undefined | null): string[] | null {
  const liste = String(text ?? '')
    .split(',')
    .map((h) => {
      let t = h.trim();
      while (t.endsWith('/')) t = t.slice(0, -1);
      return t;
    })
    .filter(Boolean);
  return liste.length ? liste : null;
}

/**
 * Darf eine Nachricht dieser Herkunft Befehle geben?
 *
 * Ohne Liste antwortet die Brücke jedem Fenster — jede fremde Seite, die
 * CAD Light einbettet, könnte dann Modelle laden, lesen und patchen. Mit
 * Liste zählt nur ein exakter Treffer; `null` (Datei, Sandbox) nie.
 */
export function herkunftErlaubt(origin: string, erlaubt: readonly string[] | null): boolean {
  if (!erlaubt) return true;
  if (!origin || origin === 'null') return false;
  return erlaubt.includes(origin);
}

/**
 * Hängt die Schnittstelle an das Fenster und richtet die Nachrichtenbrücke
 * ein. Liefert eine Abbaufunktion — im Test wichtig, im Betrieb nie nötig.
 *
 * `erlaubteHerkunft` begrenzt, welche Fenster über `postMessage` Befehle
 * geben dürfen (siehe `herkunftErlaubt`). Nachrichten anderer Herkunft
 * bleiben unbeantwortet.
 */
export function installEmbedApi(
  store: StoreLike,
  target: Window = window,
  erlaubteHerkunft: readonly string[] | null = null,
): () => void {
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

  /*
   * Der Auslegungsstand — ein Vorgang, kein Änderungsstrom.
   *
   * Deshalb ohne Entprellung und mit eigener Hörerliste: Wer auf
   * „Rohrnetz wurde neu gelegt" wartet, will genau einmal rechnen und nicht
   * 250 ms später noch einmal.
   */
  const netzHoerer = new Set<(stand: NetzStand) => void>();
  const scanHoerer = new Set<() => void>();
  const meldeNetz = (stand: NetzStand) => {
    for (const l of [...netzHoerer]) {
      try {
        l(stand);
      } catch {
        // Ein fehlerhafter Hörer darf die anderen nicht mitreißen.
      }
    }
  };

  const unsubscribeStore = store.subscribe((state, prev) => {
    if (state.doc !== prev.doc) notify();
    /*
     * Verglichen wird die **Laufnummer** und nicht das Objekt: Zwei Läufe mit
     * demselben Ergebnis sind zwei Läufe, und ein neues Objekt mit derselben
     * Nummer gibt es nicht.
     */
    const stand = state.netzStand;
    if (stand && stand.lauf !== prev.netzStand?.lauf) meldeNetz(stand);
  });

  const api: RaviaCadApi = {
    version: EMBED_API_VERSION,
    getExport: () => buildRaviaExport(store.getState().doc),
    getIfc: () => buildIfc(store.getState().doc),
    getSummary: () => buildSummary(store.getState().doc),
    validate: () => validateModel(store.getState().doc),
    getDocument: () => store.getState().doc,
    reportDiscardedRooms: (antwort) => store.getState().meldeVerworfeneRaeume(antwort),
    loadProject: (data) => store.getState().loadProject(data),
    loadIfc: (text) => store.getState().loadIfc(text),
    loadBuilding: (data, optionen) => store.getState().loadBuilding(data, optionen),
    applyPatch: (patch) => store.getState().applyHostPatch(patch),
    getWritableFields: () => writableFields(),
    getDeviceProfile: () => geraeteprofil(geraetemerkmale(target as Window)),
    onChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onNetzGelegt: (listener) => {
      netzHoerer.add(listener);
      return () => netzHoerer.delete(listener);
    },
    setHostCapabilities: (f) => setzeWirtFaehigkeiten(f),
    onScanRequested: (listener) => {
      scanHoerer.add(listener);
      return () => scanHoerer.delete(listener);
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
    if (!herkunftErlaubt(event.origin, erlaubteHerkunft)) return;

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
      /*
       * Das Rohdokument. Stand bis 1.4.0 nur auf `window.RaViaCAD` — und das
       * ist aus einem Rahmen heraus gar nicht erreichbar, weil beide Seiten
       * getrennte Fenster sind. Wer eingebettet arbeitet, hat also einen
       * Befehl vor sich gehabt, den es für ihn nicht gab: Die Antwort war
       * „Unbekannter Befehl: getDocument". Aufgefallen beim Schreiben der
       * Befehlsliste für die RaVia-Testumgebung.
       */
      case 'getDocument':
        reply(event, 'document', data.id, api.getDocument());
        break;
      case 'reportDiscardedRooms':
        reply(event, 'discardedRoomsReported', data.id, api.reportDiscardedRooms(data.payload));
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
      case 'loadBuilding': {
        // Zwei Gestalten: das nackte Modell (wie 1.3.0) oder
        // `{ building, merge }`. Beides beantwortet dieselbe Nachricht.
        const p = data.payload as { building?: unknown; merge?: boolean } | undefined;
        const mitHuelle = !!p && typeof p === 'object' && 'building' in p;
        reply(event, 'loaded', data.id,
              api.loadBuilding(mitHuelle ? p!.building : data.payload,
                               mitHuelle ? { merge: !!p!.merge } : undefined));
        break;
      }
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
      case 'getDeviceProfile':
        reply(event, 'deviceProfile', data.id, api.getDeviceProfile());
        break;
      case 'setHostCapabilities':
        reply(event, 'hostCapabilities', data.id, setzeWirtFaehigkeiten(data.payload));
        break;
      case 'subscribe': {
        const source = event.source;
        if (source) {
          // Ein Fenster, das sich zweimal anmeldet, bekommt jedes Ereignis
          // trotzdem nur einmal (gefunden in 1.74.0: `scanRequested` kam
          // doppelt an, weil die Gegenstelle nach einem Neuaufbau erneut
          // abonnierte).
          for (const s of [...subscribers]) if (s.source === source) subscribers.delete(s);
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

  /**
   * Dieselbe Nachricht über die Fensterbrücke — für eine Gegenstelle, die
   * nicht im selben Dokument sitzt, sondern im Rahmen darüber.
   */
  const sendeAnAlle = (type: string, payload: unknown): number => {
    let erreicht = 0;
    for (const s of [...subscribers]) {
      const win = s.source as Window;
      try {
        // Geschlossene Fenster halten sonst die Liste voll.
        if (win.closed) {
          subscribers.delete(s);
          continue;
        }
        win.postMessage(
          { channel: 'ravia-cad', type, id: null, payload },
          { targetOrigin: s.origin && s.origin !== 'null' ? s.origin : '*' },
        );
        erreicht++;
      } catch {
        subscribers.delete(s);
      }
    }
    return erreicht;
  };
  registriereWirtMelder((type, payload) => {
    let erreicht = sendeAnAlle(type, payload);
    if (type === 'scanRequested') {
      for (const h of [...scanHoerer]) {
        try {
          h();
          erreicht++;
        } catch {
          // Ein fehlerhafter Hörer darf die anderen nicht aufhalten.
        }
      }
    }
    return erreicht;
  });

  const unsubscribeNetz = api.onNetzGelegt((stand) => sendeAnAlle('netzgelegt', stand));

  const unsubscribeBroadcast = api.onChange((summary) => sendeAnAlle('changed', summary));

  return () => {
    target.removeEventListener('message', onMessage);
    unsubscribeBroadcast();
    unsubscribeNetz();
    unsubscribeStore();
    if (debounce) clearTimeout(debounce);
    listeners.clear();
    netzHoerer.clear();
    scanHoerer.clear();
    subscribers.clear();
    registriereWirtMelder(null);
    delete (target as Window & { RaViaCAD?: RaviaCadApi }).RaViaCAD;
  };
}
