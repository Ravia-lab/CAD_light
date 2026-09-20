/**
 * App — Layout-Shell im High-End-Dark-Theme.
 *
 * Aufbau: Kopfzeile · Werkzeugleiste links · Zeichenfläche(n) · Inspektor
 * rechts · Statuszeile. Der 3D-Viewer wird **lazy** geladen: wer nur im
 * 2D-Modus arbeitet, lädt die Three.js-Payload nie.
 *
 * Die Shell übernimmt zusätzlich die Sitzungssicherung: jede Modelländerung
 * wird entprellt in den lokalen Speicher geschrieben, und beim Start wird ein
 * gefundener Stand *angeboten* — nicht stillschweigend geladen. Automatisches
 * Überschreiben dessen, was jemand gerade öffnen wollte, ist keine Rettung.
 *
 * Hier hängt auch der Faden zur Projektverwaltung: welches Projekt gerade
 * offen ist, weiß nur diese Ebene, denn die Sicherung muss wissen, wohin sie
 * schreibt. Scheitert sie am vollen Speicher, erscheint ein Hinweisband —
 * eine Sicherung, die still aufhört zu sichern, ist schlimmer als keine.
 */

import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import ConstructionPanel from './components/ConstructionPanel';
import Editor2D from './components/Editor2D';
import ExportDiffPanel from './components/ExportDiffPanel';
import ImageUploader from './components/ImageUploader';
import LayerPanel from './components/LayerPanel';
import PropertiesPanel from './components/PropertiesPanel';
import RoofPanel from './components/RoofPanel';
import RoomBook from './components/RoomBook';
import StatusBar from './components/StatusBar';
import TgaPalette from './components/TgaPalette';
import GuidePanel from './components/GuidePanel';
import HeatPumpPanel from './components/HeatPumpPanel';
import ThermalBridgePanel from './components/ThermalBridgePanel';
import VentilationPanel from './components/VentilationPanel';
import AufmassPanel from './components/AufmassPanel';
import ValidationPanel from './components/ValidationPanel';
import AnlagenPanel from './components/AnlagenPanel';
import SchemaView from './components/SchemaView';
import ToolRail, { TopBar } from './components/Toolbar';
import ProjektDialog from './components/ProjektDialog';
import { clearAutosave, loadAutosave, relativeTime, scheduleAutosave } from './lib/autosave';
import type { AutosaveEntry, SicherungsErgebnis } from './lib/autosave';
import { aktivesProjekt, setzeAktivesProjekt } from './lib/projectStore';
import { zeigtReiter, type UiModus } from './lib/uimodus';
import { useBimStore } from './store/useBimStore';

const Viewer3D = lazy(() => import('./components/Viewer3D'));

/** Merker im lokalen Speicher: wurde die Einführung schon gezeigt? */
const WELCOME_KEY = 'ravia-einfuehrung';

type InspectorTab =
  | 'guide'
  | 'properties'
  | 'tga'
  | 'rooms'
  | 'roof'
  | 'constructions'
  | 'bridges'
  | 'ventilation'
  | 'heatpump'
  | 'anlage'
  | 'check'
  | 'reference'
  | 'layers';

/**
 * Reiter des Inspektors. `simple: true` heißt: auch im einfachen Modus
 * sichtbar. Die übrigen sind Fachplaner-Werkzeug — sie verschwinden nicht,
 * sie stehen nur nicht im Weg, solange niemand sie braucht.
 */
const TABS: { id: InspectorTab; label: string; simple?: boolean }[] = [
  { id: 'guide', label: 'Start', simple: true },
  { id: 'properties', label: 'Objekt', simple: true },
  { id: 'tga', label: 'TGA', simple: true },
  { id: 'rooms', label: 'Räume', simple: true },
  { id: 'roof', label: 'Dach' },
  { id: 'constructions', label: 'Aufbauten' },
  { id: 'bridges', label: 'Wärmebrücken' },
  { id: 'ventilation', label: 'Lüftung' },
  { id: 'heatpump', label: 'Wärmepumpe', simple: true },
  { id: 'anlage', label: 'Anlage', simple: true },
  { id: 'check', label: 'Prüfung', simple: true },
  { id: 'reference', label: 'Referenz', simple: true },
  /*
    Der Ebenen-Reiter trägt das Augensymbol — die einzige Stelle, an der sich
    Handnotizen und Ebenen ein- und ausblenden lassen. Ohne `simple` fehlte er
    auf dem Tablet vollständig: dort läuft das Programm im einfachen Modus,
    solange niemand etwas anderes einstellt, und ein Schalter, den man nur im
    Fachplanermodus findet, ist auf einem Gerät ohne Tastatur unauffindbar.
  */
  { id: 'layers', label: 'Ebenen', simple: true },
];

/**
 * Lief die Startprüfung — Sitzungssicherung und Willkommenskarte — in
 * dieser Sitzung schon?
 *
 * Sie gehört zum *Seitenaufruf*, nicht zum Bauteilbaum. Siehe die
 * Begründung im Effekt weiter unten.
 */
let startpruefungGelaufen = false;

export default function App() {
  const doc = useBimStore((s) => s.doc);
  const viewMode = useBimStore((s) => s.viewMode);
  const selection = useBimStore((s) => s.selection);
  const loadDemo = useBimStore((s) => s.loadDemo);
  const replaceDocument = useBimStore((s) => s.replaceDocument);
  const wallCount = Object.keys(doc.walls).length;
  const tool = useBimStore((s) => s.tool);
  const uiMode = useBimStore((s) => s.uiMode);
  const setUiMode = useBimStore((s) => s.setUiMode);
  const [tab, setTab] = useState<InspectorTab>('guide');
  const [restore, setRestore] = useState<AutosaveEntry | null>(null);
  const [welcome, setWelcome] = useState(false);
  /** Kennung des offenen Projekts — `null`, solange keines angelegt wurde. */
  const [projektId, setProjektId] = useState<string | null>(() => aktivesProjekt());
  const [projekteOffen, setProjekteOffen] = useState(false);
  const [speicherProblem, setSpeicherProblem] = useState<string | null>(null);

  /**
   * Beim allerersten Start: erst erklären, dann anfangen.
   *
   * Bisher lud das Programm sofort den Beispielgrundriss. Das ist besser als
   * eine leere Fläche, beantwortet aber die erste Frage nicht — *wofür* ist
   * das hier, und was soll ich damit tun. Wer mit einem fremden Grundriss auf
   * dem Bildschirm sitzt, traut sich nicht, ihn zu löschen.
   *
   * Also einmal eine Karte mit drei Wegen. Danach nie wieder; der Merker
   * liegt neben dem Ansichtsmodus im lokalen Speicher.
   */
  useEffect(() => {
    /*
     * **Nur beim echten Start, nicht bei jedem Neuaufbau.**
     *
     * Die Anwendung hängt an einem `key` mit der Sprache (siehe `main.tsx`):
     * Beim Umschalten wirft React den Baum weg und baut ihn neu auf. Damit
     * lief dieser Effekt erneut — und wer mitten in der Arbeit die Sprache
     * wechselte, bekam die Frage „Stand wiederherstellen?" vorgesetzt, für
     * einen Stand, an dem er gerade arbeitet. Gefunden hat das der
     * Prüfstand: Nach dem ersten Umschalten ließ sich kein zweites
     * auslösen, weil ein Dialog davor lag.
     *
     * Der Merker steht auf **Modulebene** und nicht im Zustand: Ein
     * Zustandswert stirbt mit dem Baum, das Modul überlebt ihn. Ein
     * wirklicher Seitenaufruf lädt das Modul neu — dann fragt das Programm
     * wieder, und genau dann soll es das.
     */
    if (startpruefungGelaufen) return;
    startpruefungGelaufen = true;

    const entry = loadAutosave();
    if (entry) {
      setRestore(entry);
      return;
    }
    let gesehen = false;
    try {
      gesehen = localStorage.getItem(WELCOME_KEY) === '1';
    } catch {
      // Privates Fenster oder gesperrter Speicher: dann eben jedes Mal.
      gesehen = false;
    }
    if (!gesehen) {
      setWelcome(true);
      return;
    }
    if (wallCount === 0) loadDemo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Die Einführung schließen, die Rolle übernehmen und beides merken.
   *
   * Die Rolle wird gesetzt, bevor das Modell geladen wird: Sonst sähe der
   * Monteur den Beispielgrundriss für einen Augenblick mit dreizehn Reitern.
   */
  const closeWelcome = (dann: 'demo' | 'leer' | 'bild', rolle: UiModus) => {
    setUiMode(rolle);
    try {
      localStorage.setItem(WELCOME_KEY, '1');
    } catch {
      // Nicht schlimm — dann erscheint sie beim nächsten Mal noch einmal.
    }
    setWelcome(false);
    if (dann === 'demo') loadDemo();
    if (dann === 'bild') setTab('reference');
  };

  /*
   * Kommt ein Modell von außen herein, während die Einführung offen ist —
   * etwa ein Gebäudescan, den RaVia über `loadBuilding` schickt —, ist die
   * Frage „wie anfangen?" beantwortet. Die Karte stünde sonst über dem
   * gerade geladenen Grundriss.
   */
  useEffect(() => {
    if (welcome && wallCount > 0) closeWelcome('leer', uiMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [welcome, wallCount]);

  // Sitzungssicherung: entprellt, damit das Zeichnen nicht ins Stocken gerät.
  // Mit offenem Projekt landet der Stand in dessen Eintrag, sonst im
  // Autosave-Schlüssel selbst — siehe `lib/autosave.ts`.
  useEffect(() => {
    if (restore) return; // solange die Rückfrage offen ist, nichts überschreiben
    scheduleAutosave(doc, projektId, (ergebnis: SicherungsErgebnis) =>
      setSpeicherProblem(ergebnis.ok ? null : ergebnis.meldung),
    );
  }, [doc, restore, projektId]);

  /*
   * Eine Auswahl schaltet automatisch auf den Eigenschaften-Tab; das
   * TGA-Werkzeug öffnet umgekehrt die Symbolpalette.
   *
   * Nicht aber, wenn die Auswahl aus einer Liste kam. Wer die Prüfliste
   * abarbeitet, klickt einen Befund an, um die Stelle im Plan zu sehen —
   * und stand danach vor dem Objektreiter, ohne die Liste, die er gerade
   * durchgeht. Nach jedem Befund zurückklicken zu müssen macht aus einem
   * Werkzeug eine Zumutung. Die Liste behält darum den Reiter; der Plan
   * springt trotzdem an die Stelle.
   */
  useEffect(() => {
    if (!selection) return;
    if (useBimStore.getState().auswahlQuelle === 'liste') return;
    // Außenanlage und Wärmepumpe haben ihren eigenen Reiter — dorthin zu
    // springen ist richtiger, als den Inspektor zu öffnen, der für sie
    // nichts zu zeigen hat.
    setTab(selection.kind === 'site' || selection.kind === 'heatpump' ? 'heatpump' : 'properties');
  }, [selection]);

  useEffect(() => {
    if (tool === 'fixture') setTab('tga');
  }, [tool]);

  // Wer auf die Schema-Ansicht umschaltet, will das Anlagenblatt daneben —
  // dort wird das Schema erzeugt und dort stehen die Zahlen dazu.
  useEffect(() => {
    if (viewMode === 'schema') setTab('anlage');
  }, [viewMode]);

  // Im einfachen Modus zeigt nur ein Teil der Reiter. Steht der aktive
  // gerade nicht mehr zur Verfügung, landet man auf „Start" statt vor einer
  // leeren Fläche.
  const visibleTabs = useMemo(
    () => TABS.filter((t) => zeigtReiter(uiMode, t.id, t.simple === true)),
    [uiMode],
  );
  useEffect(() => {
    if (!visibleTabs.some((t) => t.id === tab)) setTab('guide');
  }, [visibleTabs, tab]);

  /*
   * Schmal heißt: der Inspektor passt nicht mehr neben die Zeichnung.
   *
   * 1024 px ist die Grenze, weil ein iPad hochkant 820 px breit ist und quer
   * 1180. Hochkant nähme das 300-Pixel-Feld mehr als ein Drittel der Breite
   * weg — dann bleibt für den Grundriss weniger Platz als für die Liste
   * daneben. Quer ist genug Raum, und der Inspektor bleibt stehen.
   *
   * Gemessen wird das Fenster und nicht das Gerät: wer am Rechner das
   * Fenster schmal zieht, bekommt dieselbe Anordnung, und das ist richtig.
   */
  const [schmal, setSchmal] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 1024px)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1024px)');
    const merke = (e: MediaQueryListEvent | MediaQueryList) => setSchmal(e.matches);
    merke(mq);
    mq.addEventListener('change', merke);
    return () => mq.removeEventListener('change', merke);
  }, []);
  const [inspektorOffen, setInspektorOffen] = useState(false);

  /*
   * Im schmalen Layout ist der Inspektor eine Schublade, die geschlossen
   * startet. Auf den richtigen Reiter zu schalten, während niemand ihn sieht,
   * hilft keinem: Meldungen wie „im Inspektor eingeben" liefen auf dem Tablet
   * ins Leere. Wer mit dem **Auswahlwerkzeug** etwas anfasst, will die
   * Eigenschaften sehen — dann geht die Schublade auf. Beim Zeichnen bleibt
   * sie zu, sonst verdeckte sie nach jedem gesetzten Objekt den Plan.
   */
  useEffect(() => {
    if (!selection || !schmal) return;
    if (useBimStore.getState().tool === 'select') setInspektorOffen(true);
  }, [selection, schmal]);
  // Beim Wechsel ins Breite geht die Schublade zu — sonst bliebe der
  // Verdunkler über einem Inspektor stehen, der ohnehin schon danebensteht.
  useEffect(() => {
    if (!schmal) setInspektorOffen(false);
  }, [schmal]);

  const show2D = viewMode === '2d' || viewMode === 'split';
  const show3D = viewMode === '3d' || viewMode === 'split';
  const showSchema = viewMode === 'schema';

  return (
    <div className="flex h-full w-full flex-col bg-graphite-900">
      <TopBar onProjekte={() => setProjekteOffen(true)} />

      <div className="flex min-h-0 flex-1">
        <ToolRail />

        {/* Zeichenflächen */}
        <main className="flex min-w-0 flex-1 gap-2 py-2 pr-2">
          {show2D && (
            <div className="panel relative min-w-0 flex-1 overflow-hidden">
              <Editor2D />
              <ViewportBadge label="Grundriss 2D" />
            </div>
          )}

          {showSchema && (
            <div className="panel relative min-w-0 flex-1 overflow-hidden">
              <SchemaView />
              <ViewportBadge label="Anlagenschema" />
            </div>
          )}

          {show3D && (
            <div className="panel relative min-w-0 flex-1 overflow-hidden">
              <Suspense fallback={<ViewerFallback />}>
                <Viewer3D />
              </Suspense>
              <ViewportBadge label="Modell 3D" />
            </div>
          )}
        </main>

        {/*
          * Inspektor. Breit steht er daneben, schmal fährt er als Schublade
          * über die Zeichnung — 88 % der Breite, damit der Plan dahinter
          * sichtbar bleibt und klar ist, dass die Schublade wieder zugeht.
          */}
        {schmal && inspektorOffen && (
          <button
            aria-label="Inspektor schließen"
            className="fixed inset-0 z-30 bg-graphite-950/60 backdrop-blur-[2px]"
            onClick={() => setInspektorOffen(false)}
          />
        )}
        <aside
          className={
            schmal
              ? `panel fixed inset-y-2 right-2 z-40 flex w-[88vw] max-w-[420px] flex-col overflow-hidden transition-transform duration-200 ${
                  inspektorOffen ? 'translate-x-0' : 'translate-x-[calc(100%+1rem)]'
                }`
              : 'panel my-2 mr-2 flex w-[300px] shrink-0 flex-col overflow-hidden'
          }
          aria-hidden={schmal && !inspektorOffen}
        >
          {schmal && (
            <button
              className="flex h-11 shrink-0 items-center justify-between border-b border-white/[0.06] px-3 text-[12px] text-slate-300"
              onClick={() => setInspektorOffen(false)}
            >
              <span>Inspektor</span>
              <span className="text-slate-500">schließen ✕</span>
            </button>
          )}
          <div className="flex shrink-0 flex-wrap gap-0.5 border-b border-white/[0.06] p-1.5">
            {visibleTabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`chip px-1.5 ${
                  tab === t.id ? 'bg-accent/12 text-accent' : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {tab === 'guide' && <GuidePanel onOpenTab={(id) => setTab(id as InspectorTab)} />}
            {tab === 'properties' && <PropertiesPanel />}
            {tab === 'tga' && <TgaPalette />}
            {tab === 'rooms' && <RoomBook />}
            {tab === 'roof' && <RoofPanel />}
            {tab === 'constructions' && <ConstructionPanel />}
            {tab === 'bridges' && <ThermalBridgePanel />}
            {tab === 'ventilation' && <VentilationPanel />}
            {tab === 'heatpump' && <HeatPumpPanel />}
            {tab === 'anlage' && <AnlagenPanel />}
            {tab === 'check' && (
              <>
                {/* Zuerst das, was sich mit einem Klick richten lässt —
                    danach der Bericht über alles Übrige. Umgekehrt läse man
                    erst zwanzig Befunde und fände die zwei Knöpfe darunter
                    nicht mehr. */}
                <div className="px-3 pt-3">
                  <AufmassPanel />
                </div>
                <ValidationPanel />
                <div className="mx-3 border-t border-white/[0.06]" />
                <ExportDiffPanel />
              </>
            )}
            {tab === 'reference' && <ImageUploader />}
            {tab === 'layers' && <LayerPanel />}
          </div>
        </aside>

        {/*
          * Der Griff zur Schublade. Er sitzt am rechten Rand auf halber Höhe,
          * weil dort der Daumen liegt, wenn man das Tablet hält — und nicht
          * oben in einer Leiste, wo man hingreifen müsste.
          */}
        {schmal && !inspektorOffen && (
          <button
            className="panel fixed right-2 top-1/2 z-30 flex h-24 w-11 -translate-y-1/2 flex-col items-center justify-center gap-1 text-[11px] text-slate-300"
            onClick={() => setInspektorOffen(true)}
            aria-label="Inspektor öffnen"
          >
            <span aria-hidden="true">‹</span>
            <span className="[writing-mode:vertical-rl] tracking-wide">Inspektor</span>
          </button>
        )}
      </div>

      <StatusBar />

      {welcome && <Einfuehrung onChoose={closeWelcome} />}

      {restore && (
        <RestoreDialog
          entry={restore}
          onRestore={() => {
            replaceDocument(restore.doc, `Letzter Stand von ${relativeTime(restore.savedAt)} wiederhergestellt`);
            // Der Stand bringt mit, zu welchem Projekt er gehört. Ohne diese
            // Zeile schriebe die nächste Sicherung ihn in den Autosave-
            // Schlüssel statt zurück in sein Projekt.
            setProjektId(restore.projektId ?? null);
            setzeAktivesProjekt(restore.projektId ?? null);
            setRestore(null);
          }}
          onDiscard={() => {
            clearAutosave();
            // Verworfen wird der *Stand*, nicht das Projekt: es bleibt in der
            // Liste. Es aber offen zu lassen, hieße, den Demo-Grundriss beim
            // nächsten Zeichenstrich hineinzuschreiben.
            setProjektId(null);
            setzeAktivesProjekt(null);
            setRestore(null);
            if (wallCount === 0) loadDemo();
          }}
        />
      )}

      {speicherProblem && (
        <SpeicherBand meldung={speicherProblem} onOeffnen={() => setProjekteOffen(true)} />
      )}

      {projekteOffen && (
        <ProjektDialog
          aktivId={projektId}
          onAktivChange={(id) => {
            setProjektId(id);
            setSpeicherProblem(null);
          }}
          onClose={() => setProjekteOffen(false)}
        />
      )}
    </div>
  );
}

/**
 * Rückfrage beim Start. Bewusst modal: die Entscheidung „weiterarbeiten oder
 * neu beginnen" darf nicht versehentlich getroffen werden.
 */
function RestoreDialog({
  entry,
  onRestore,
  onDiscard,
}: {
  entry: AutosaveEntry;
  onRestore: () => void;
  onDiscard: () => void;
}) {
  const rooms = Object.keys(entry.doc.rooms ?? {}).length;
  const walls = Object.keys(entry.doc.walls ?? {}).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-graphite-950/70 p-6 backdrop-blur-sm">
      <div className="panel w-[420px] max-w-full p-5">
        <div className="text-[13px] font-semibold text-slate-100">Letzten Stand fortsetzen?</div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">
          Es liegt eine automatische Sicherung von{' '}
          <span className="text-slate-200">{relativeTime(entry.savedAt)}</span> vor.
        </p>
        <div className="mt-3 space-y-1 rounded-lg bg-white/[0.03] px-3 py-2.5 text-[11px] text-slate-300">
          <div className="flex justify-between">
            <span className="text-slate-500">Projekt</span>
            <span className="truncate pl-2">{entry.doc.meta?.name ?? '—'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Wände</span>
            <span className="tabular-nums">{walls}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Räume</span>
            <span className="tabular-nums">{rooms}</span>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onDiscard}
            className="chip px-3 py-1.5 text-slate-400 hover:bg-white/[0.06] hover:text-slate-200"
          >
            Verwerfen
          </button>
          <button
            onClick={onRestore}
            className="rounded-lg bg-accent/15 px-3 py-1.5 text-[11px] font-medium text-accent shadow-glow transition-colors hover:bg-accent/25"
          >
            Fortsetzen
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Das Hinweisband beim vollen Speicher.
 *
 * Es liegt über allem und geht nicht von selbst weg, denn es beschreibt einen
 * Zustand, in dem jeder weitere Strich ungesichert bleibt. Der Ausweg steht
 * daneben: Projekte öffnen, eines als Datei sichern, aus dem Speicher nehmen.
 */
function SpeicherBand({ meldung, onOeffnen }: { meldung: string; onOeffnen: () => void }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 top-2 z-[60] flex justify-center px-4">
      <div className="pointer-events-auto flex max-w-[46rem] items-center gap-3 rounded-lg bg-orange-500/15 px-4 py-2.5 ring-1 ring-orange-400/30 backdrop-blur-sm">
        <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-orange-300" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M10 3l7 13H3l7-13z" strokeLinejoin="round" />
          <path d="M10 8v4M10 14.2v.1" strokeLinecap="round" />
        </svg>
        <span className="text-[11.5px] leading-relaxed text-orange-100">{meldung}</span>
        <button
          onClick={onOeffnen}
          className="shrink-0 rounded-md bg-orange-400/20 px-2.5 py-1 text-[11px] font-medium text-orange-100 transition-colors hover:bg-orange-400/30"
        >
          Projekte öffnen
        </button>
      </div>
    </div>
  );
}

function ViewportBadge({ label }: { label: string }) {
  return (
    <div className="pointer-events-none absolute left-3 top-3">
      <span className="label-xs rounded-md bg-graphite-950/60 px-2 py-1 backdrop-blur-sm">{label}</span>
    </div>
  );
}

function ViewerFallback() {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="flex items-center gap-2.5">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
        <span className="text-[11px] text-slate-500">3D-Renderer wird geladen …</span>
      </div>
    </div>
  );
}

/**
 * Die Einführung beim allerersten Start.
 *
 * Drei Sätze, was das Werkzeug tut und wo die Grenze verläuft, dann drei
 * Wege hinein. Bewusst kein mehrseitiger Rundgang mit Pfeilen: den klickt
 * jeder weg, und was darin stand, weiß danach niemand.
 */
/**
 * Die Einführung beim allerersten Start — zwei Fragen, nicht drei Absätze.
 *
 * **Was sich gegenüber 1.31.0 geändert hat und warum.** Die Karte begann mit
 * rund 120 Wörtern, in denen U-Werte, Wärmebrücken, Lüftung, Heizkreise,
 * Speicher, Sicherheitsarmaturen und das Anlagenschema vorkamen. Für einen
 * Fachplaner ist das eine Leistungsschau. Für den Monteur, der in einer
 * fremden Wohnung steht, ist es der Satz „das hier ist nichts für dich" —
 * und er ist der Anwender, für den die schmalste Ansicht überhaupt gebaut
 * wurde.
 *
 * Jetzt steht die **Rollenfrage vorn**: Aufmaß oder Planung. Sie ist die
 * einzige Stelle, an der sie ohne Suchen zu beantworten ist; der Umschalter
 * dafür lag bisher unter einer fünfzehnstufigen Schrittliste (auf dem iPad
 * 1531 Pixel Rollweg) und seit dieser Fassung zusätzlich in der Kopfleiste.
 *
 * Erst danach die alte Frage, womit man anfängt. Zwei Fragen nacheinander
 * sind ein Fingertipp mehr als eine — und ersparen dem einen Anwender neun
 * Reiter, die er nie braucht, und dem anderen die Suche nach ihnen.
 */
function Einfuehrung({ onChoose }: { onChoose: (dann: 'demo' | 'leer' | 'bild', rolle: UiModus) => void }) {
  const [rolle, setRolle] = useState<UiModus | null>(null);

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-graphite-950/80 backdrop-blur-sm">
      <div className="panel max-w-[34rem] p-6">
        <div className="flex items-start gap-3">
          <svg viewBox="0 0 24 24" className="mt-0.5 h-8 w-8 shrink-0" fill="none" stroke="#38BDF8" strokeWidth="1.4">
            <path d="M4 20V9l8-5 8 5v11" strokeLinejoin="round" />
            <path d="M4 20h16" strokeLinecap="round" />
            <path d="M10 20v-6h4v6" />
          </svg>
          <div>
            <h2 className="text-[16px] font-semibold text-slate-100">RaVia CAD Light</h2>
            <p className="text-[11px] uppercase tracking-[0.16em] text-accent">Grundriss aufnehmen · Anlage auslegen</p>
          </div>
        </div>

        <div className="mt-4 space-y-2.5 text-[12.5px] leading-relaxed text-slate-300">
          <p>
            Sie nehmen ein Gebäude auf — gezeichnet, aus einem Foto, aus der IFC-Datei des Architekten oder aus einem
            Raumscan vom iPhone. Räume erkennt das Programm selbst, sobald die Wände geschlossen sind.
          </p>
          <p className="text-slate-400">
            <b className="text-slate-300">Was es nicht tut:</b> die Heizlast berechnen. Das macht RaVia. Dieses
            Werkzeug erfasst — und jede Zahl, die nur geschätzt ist, sagt das von sich aus.
          </p>
        </div>

        {rolle === null ? (
          <>
            <p className="mt-5 text-[12px] font-medium text-slate-200">Was machen Sie heute?</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                className="rounded-lg bg-accent/12 px-3 py-2.5 text-left transition hover:bg-accent/20"
                onClick={() => setRolle('handwerker')}
              >
                <div className="text-[12px] text-accent">Aufmaß vor Ort</div>
                <div className="mt-0.5 text-[10px] leading-snug text-slate-500">
                  Ich nehme auf, gerechnet wird später. Zeigt nur, was zur Übergabe gehört.
                </div>
              </button>
              <button
                className="rounded-lg bg-white/[0.05] px-3 py-2.5 text-left transition hover:bg-white/[0.1]"
                onClick={() => setRolle('einfach')}
              >
                <div className="text-[12px] text-slate-200">Planung</div>
                <div className="mt-0.5 text-[10px] leading-snug text-slate-500">
                  Anlage, Rohrnetz, Nachweise. Zeigt zusätzlich Gerät, Speicher und Schema.
                </div>
              </button>
            </div>
            <p className="mt-4 text-[10.5px] leading-relaxed text-slate-600">
              Die Wahl ändert nur, wie viel zu sehen ist — gelöscht wird nichts. Oben rechts lässt sie sich jederzeit
              umstellen.
            </p>
          </>
        ) : (
          <>
            <p className="mt-5 text-[12px] font-medium text-slate-200">Womit fangen wir an?</p>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <button
                className="rounded-lg bg-accent/12 px-3 py-2.5 text-left transition hover:bg-accent/20"
                onClick={() => onChoose('demo', rolle)}
              >
                <div className="text-[12px] text-accent">Beispiel ansehen</div>
                <div className="mt-0.5 text-[10px] leading-snug text-slate-500">
                  Ein fertiges Projekt zum Anfassen. Lässt sich jederzeit löschen.
                </div>
              </button>
              <button
                className="rounded-lg bg-white/[0.05] px-3 py-2.5 text-left transition hover:bg-white/[0.1]"
                onClick={() => onChoose('leer', rolle)}
              >
                <div className="text-[12px] text-slate-200">Leer anfangen</div>
                <div className="mt-0.5 text-[10px] leading-snug text-slate-500">
                  Mit dem Wand-Werkzeug oder einer Raumvorlage loslegen.
                </div>
              </button>
              <button
                className="rounded-lg bg-white/[0.05] px-3 py-2.5 text-left transition hover:bg-white/[0.1]"
                onClick={() => onChoose('bild', rolle)}
              >
                <div className="text-[12px] text-slate-200">Grundriss laden</div>
                <div className="mt-0.5 text-[10px] leading-snug text-slate-500">
                  Foto oder PDF nachzeichnen — oder IFC und Raumscan fertig übernehmen.
                </div>
              </button>
            </div>
            <p className="mt-4 text-[10.5px] leading-relaxed text-slate-600">
              Der Reiter <span className="text-slate-400">„Start"</span> sagt jederzeit, was als Nächstes zu tun ist, und
              schlägt Fachbegriffe nach. Jedes Fragezeichen im Programm erklärt den Begriff daneben in einem Satz.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
