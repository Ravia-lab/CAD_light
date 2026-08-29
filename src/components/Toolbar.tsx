/**
 * Toolbar — Werkzeugleiste (vertikal) und Kopfzeile.
 * Beide teilen sich die Icon-Sprache: 1,4 px Vektorlinien, keine Flächen,
 * keine Beschriftung im Normalzustand. Erklärung liefert das Tooltip.
 */

import type { ReactNode } from 'react';
import type {
  AnnotationKind,
  OpeningKind,
  PipeRoutingMode,
  PipeService,
  ToolId,
  SolidKind,
  VerticalKind,
  ViewMode,
  WallType,
} from '../types/bim';
import {
  ANNOTATION_LABELS,
  OPENING_PRESETS,
  PIPE_SERVICE_COLORS,
  PIPE_SERVICE_LABELS,
  SOLID_LABELS,
  VERTICAL_LABELS,
  WALL_THICKNESS_PRESETS,
} from '../types/bim';
import { useBimStore } from '../store/useBimStore';
import { useRef, useState } from 'react';
import { buildRaviaExport, downloadJson, exportFilename } from '../lib/raviaExport';
import { buildIfc, downloadIfc, ifcFilename } from '../lib/ifcExport';
import LevelBar from './LevelBar';
import PlanPrintDialog from './PlanPrintDialog';
import RohrnetzDialog from './RohrnetzDialog';

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

const Icon = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 20 20" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);

const icons: Record<string, ReactNode> = {
  select: <><path d="M4 3l6.2 13 1.9-5.4 5.4-1.9L4 3z" /></>,
  wall: <><path d="M2 13h16M2 13V7h16v6" /><path d="M8 7v6M13 7v6" /></>,
  door: <><path d="M3 17h14" /><path d="M6 17V4l8 2v11" /><circle cx="8.4" cy="11" r=".7" fill="currentColor" /></>,
  window: <><rect x="3" y="5" width="14" height="10" rx="1" /><path d="M10 5v10M3 10h14" /></>,
  dimension: <><path d="M3 10h14" /><path d="M3 6v8M17 6v8" /></>,
  passage: <><path d="M2 16h4M14 16h4" /><path d="M6 16V6h8v10" strokeDasharray="2 2" /><path d="M6 6h8" /></>,
  fixture: <><rect x="3" y="6" width="14" height="8" rx="1" /><path d="M7 6v8M10 6v8M13 6v8" /></>,
  ortho: <><path d="M4 16V4h12" /><path d="M4 16h12" strokeDasharray="2 2" /></>,
  guides: <><path d="M10 2v16M2 10h16" strokeDasharray="3 3" /><circle cx="10" cy="10" r="2" /></>,
  warn: <><path d="M10 3l7 13H3l7-13z" /><path d="M10 8v4M10 14.2v.1" /></>,
  calibrate: <><path d="M3 12l6-6 8 8-6 6-8-8z" /><path d="M7 8l1.5 1.5M9.5 5.5L11 7M11.5 10.5L13 12" /></>,
  pan: <><path d="M10 3v9M10 12l-3-3M10 12l3-3" /><path d="M3 15a7 7 0 0014 0" /></>,
  undo: <><path d="M7 8H4V5" /><path d="M4.5 8A6.5 6.5 0 1110 16.5" /></>,
  redo: <><path d="M13 8h3V5" /><path d="M15.5 8A6.5 6.5 0 1010 16.5" /></>,
  grid: <><path d="M3 3h14v14H3z" /><path d="M8 3v14M13 3v14M3 8h14M3 13h14" /></>,
  dims: <><path d="M3 14h14M3 11v6M17 11v6" /><path d="M5 6h10" /></>,
  labels: <><path d="M3 5h14M3 10h9M3 15h11" /></>,
  trash: <><path d="M4 6h12M8 6V4h4v2M6 6l.8 10h6.4L15 6" /></>,
  demo: <><rect x="3" y="3" width="14" height="14" rx="1.5" /><path d="M3 8h14M8 8v9" /></>,
  export: <><path d="M10 3v9M10 3L7 6M10 3l3 3" /><path d="M4 13v3a1 1 0 001 1h10a1 1 0 001-1v-3" /></>,
  open: <><path d="M10 12V3M10 12l-3-3M10 12l3-3" /><path d="M4 13v3a1 1 0 001 1h10a1 1 0 001-1v-3" /></>,
  print: <><path d="M6 8V3h8v5" /><rect x="3" y="8" width="14" height="6" rx="1" /><path d="M6 12h8v5H6z" /></>,
  stair: <><path d="M3 17V13h4V9h4V5h6" /><path d="M3 17h14" /></>,
  shaft: <><rect x="6" y="3" width="8" height="14" rx="1" /><path d="M6 7l8 6M6 12l8 6M6 3l8 6" /></>,
  solid: <><path d="M4 4.5h12" strokeWidth="2" /><rect x="6" y="4.5" width="8" height="12.5" /><path d="M6 10l8-5.5M6 14l8-5.5M6 17.5l8-5.5" /></>,
  pipe: <><path d="M3 14h5a3 3 0 003-3V7a3 3 0 013-3h3" /><circle cx="3" cy="14" r="1.6" fill="currentColor" /><circle cx="17" cy="4" r="1.6" fill="currentColor" /></>,
  annotation: <><path d="M3 14h14" /><path d="M3 11.5v5M17 11.5v5" /><path d="M4 6h9M4 3h6" /></>,
  ifc: <><path d="M10 2.5l7 4v7l-7 4-7-4v-7l7-4z" /><path d="M3 6.5l7 4 7-4M10 10.5v7" /></>,
  // Rohrnetz: zwei Leitungen mit einem Abzweig und einer Armatur darauf.
  rohrnetz: <><path d="M2 6h6l3 3h5" /><path d="M2 14h9l3-3" /><circle cx="8" cy="6" r="1.6" /><circle cx="11" cy="14" r="1.6" /></>,
  heatpump: <><rect x="3" y="6" width="10" height="8" rx="1" /><path d="M14 8h4M14 10h4M14 12h4" /><path d="M6 9l2 2-2 2" /></>,
  site: <><path d="M2 15l5-11 5 6 3-3 3 8z" /><path d="M2 17h16" strokeDasharray="3 2" /></>,
  room: <><path d="M3 4h9v5h5v7H3z" /><path d="M12 4v5h5" /></>,
  projects: <><path d="M2.5 6.5V15a1 1 0 001 1h13a1 1 0 001-1V7.5a1 1 0 00-1-1h-6.2L8.6 4.5H3.5a1 1 0 00-1 1z" /><path d="M2.5 9.5h15" /></>,
  bericht: <><path d="M4.5 2.5h7l4 4V17a.5.5 0 01-.5.5H4.5a.5.5 0 01-.5-.5V3a.5.5 0 01.5-.5z" /><path d="M11.5 2.5v4h4" /><path d="M6.5 10h7M6.5 12.5h7M6.5 15h4" /></>,
};

// ---------------------------------------------------------------------------
// Vertikale Werkzeugleiste
// ---------------------------------------------------------------------------

interface ToolDef {
  id: ToolId;
  icon: string;
  label: string;
  hotkey: string;
  /**
   * Was das Werkzeug tut, in einem Satz und ohne Fachwort. Steht im Tooltip
   * unter der Bezeichnung — „Durchgang in Wand" sagt einem Monteur nichts,
   * „Wandöffnung ohne Tür, etwa zwischen Wohnen und Essen" schon.
   */
  hint: string;
  /** Im einfachen Modus sichtbar? */
  simple?: boolean;
}

const TOOLS: ToolDef[] = [
  { id: 'select', icon: 'select', label: 'Auswählen & Bearbeiten', hotkey: 'V', simple: true,
    hint: 'Anklicken, verschieben, Eigenschaften ändern. Mit gezogenem Rahmen mehrere auf einmal.' },
  { id: 'wall', icon: 'wall', label: 'Wand zeichnen', hotkey: 'W', simple: true,
    hint: 'Klick für Klick einen Zug setzen, Esc beendet ihn. Geschlossene Umrisse werden von selbst als Raum erkannt.' },
  { id: 'room', icon: 'room', label: 'Raum aufziehen', hotkey: 'Z', simple: true,
    hint: 'Fertige Grundform wählen und im Plan aufziehen — die Wände entstehen von selbst und lassen sich danach einzeln ändern.' },
  { id: 'door', icon: 'door', label: 'Tür einsetzen', hotkey: 'D', simple: true,
    hint: 'Auf eine Wand klicken — die Tür sitzt dort, wo geklickt wurde.' },
  { id: 'window', icon: 'window', label: 'Fenster einsetzen', hotkey: 'F', simple: true,
    hint: 'Auf eine Wand klicken. Die Fensterfläche wird von der Wandfläche abgezogen.' },
  { id: 'passage', icon: 'passage', label: 'Durchgang in Wand', hotkey: 'E', simple: true,
    hint: 'Wandöffnung ohne Tür — etwa zwischen Wohnen und Essen. Zählt nur als Loch, nicht als Bauteil.' },
  { id: 'fixture', icon: 'fixture', label: 'Heizung, Sanitär, Lüftung setzen', hotkey: 'T', simple: true,
    hint: 'Symbol im Reiter „TGA" wählen, dann in den Plan klicken. Heizkörper rasten an die nächste Wand.' },
  { id: 'stair', icon: 'stair', label: 'Treppe einsetzen', hotkey: 'R', simple: true,
    hint: 'Eine Treppe nimmt Grundfläche weg und lässt die Decke darüber offen — beides zählt in der Heizlast.' },
  { id: 'shaft', icon: 'shaft', label: 'Schacht einsetzen', hotkey: 'S',
    hint: 'Wie eine Treppe eine Fläche, die kein Raum ist — Aufzug, Installationsschacht, Luftraum.' },
  { id: 'solid', icon: 'solid', label: 'Massives Bauteil setzen', hotkey: 'M', simple: true,
    hint: 'Kamin, Pfeiler, Wandversatz — Mauerwerk ohne Raumfunktion. Nimmt Fläche und Luftvolumen weg und wird von der Fußbodenheizung ausgespart.' },
  { id: 'pipe', icon: 'pipe', label: 'Leitung verlegen', hotkey: 'L',
    hint: 'Punkte im Plan setzen; ein Klick auf ein Symbol schließt die Leitung dort an.' },
  { id: 'annotation', icon: 'annotation', label: 'Maßkette & Beschriftung', hotkey: 'B',
    hint: 'Freie Maße und Texte für den Ausdruck. Sie gehen nicht in die Berechnung ein.' },
  { id: 'calibrate', icon: 'calibrate', label: 'Maßstab kalibrieren', hotkey: 'C',
    hint: 'Nur bei hinterlegtem Grundriss-Bild: eine bekannte Strecke abfahren und ihre Länge eintragen.' },
  { id: 'heatpump', icon: 'heatpump', label: 'Wärmepumpe aufstellen', hotkey: 'P', simple: true,
    hint: 'In den Garten klicken. Der Kreis um das Gerät zeigt, ab welchem Abstand der Nachtwert eingehalten ist.' },
  { id: 'site', icon: 'site', label: 'Außengelände zeichnen', hotkey: 'A', simple: true,
    hint: 'Grundstücksgrenze, Nachbarhaus, Lichtschacht, Baum, Erdsonde — Art im Reiter „Wärmepumpe" wählen.' },
  { id: 'pan', icon: 'pan', label: 'Ansicht verschieben', hotkey: 'Leertaste', simple: true,
    hint: 'Geht auch ohne Werkzeugwechsel: rechte Maustaste ziehen oder Leertaste halten.' },
];

export default function ToolRail() {
  const tool = useBimStore((s) => s.tool);
  const uiMode = useBimStore((s) => s.uiMode);
  const setTool = useBimStore((s) => s.setTool);
  const snap = useBimStore((s) => s.snap);
  const setSnap = useBimStore((s) => s.setSnap);
  const showDimensions = useBimStore((s) => s.showDimensions);
  const showRoomLabels = useBimStore((s) => s.showRoomLabels);
  const toggleDimensions = useBimStore((s) => s.toggleDimensions);
  const toggleRoomLabels = useBimStore((s) => s.toggleRoomLabels);
  const orthoLock = useBimStore((s) => s.orthoLock);
  const setOrthoLock = useBimStore((s) => s.setOrthoLock);
  const showGuides = useBimStore((s) => s.showGuides);
  const toggleGuides = useBimStore((s) => s.toggleGuides);
  const showDiagnostics = useBimStore((s) => s.showDiagnostics);
  const toggleDiagnostics = useBimStore((s) => s.toggleDiagnostics);
  const openEnds = useBimStore((s) => s.doc.diagnostics.openEnds.length);
  const undo = useBimStore((s) => s.undo);
  const redo = useBimStore((s) => s.redo);
  const past = useBimStore((s) => s.past.length);
  const future = useBimStore((s) => s.future.length);
  const clearAll = useBimStore((s) => s.clearAll);
  const loadDemo = useBimStore((s) => s.loadDemo);

  return (
    <div className="panel m-2 flex w-[52px] flex-col items-center gap-1 rounded-xl px-1.5 py-2">
      {TOOLS.filter((t) => uiMode === 'profi' || t.simple).map((t) => (
        <RailButton
          key={t.id}
          active={tool === t.id}
          title={`${t.label}  ·  ${t.hotkey}\n${t.hint}`}
          onClick={() => setTool(t.id)}
        >
          <Icon>{icons[t.icon]}</Icon>
        </RailButton>
      ))}

      <Separator />

      <RailButton active={snap.grid} title="Raster-Fang · G" onClick={() => setSnap({ grid: !snap.grid })}>
        <Icon>{icons.grid}</Icon>
      </RailButton>
      <RailButton
        active={orthoLock}
        title="Ortho-Zwang: nur 0/90° — verhindert schräge Wände · O"
        onClick={() => setOrthoLock(!orthoLock)}
      >
        <Icon>{icons.ortho}</Icon>
      </RailButton>
      <RailButton active={showGuides} title="Ausrichtungs-Hilfslinien · H" onClick={toggleGuides}>
        <Icon>{icons.guides}</Icon>
      </RailButton>
      <RailButton
        active={showDiagnostics}
        title={
          openEnds > 0
            ? `${openEnds} offene Wandenden — hier schließt der Raum nicht`
            : 'Prüfung offener Wandenden'
        }
        onClick={toggleDiagnostics}
      >
        <span className="relative">
          <Icon>{icons.warn}</Icon>
          {openEnds > 0 && showDiagnostics && (
            <span className="absolute -right-1 -top-1 flex h-3 min-w-3 items-center justify-center rounded-full bg-orange-400 px-0.5 text-[8px] font-semibold text-graphite-950">
              {openEnds}
            </span>
          )}
        </span>
      </RailButton>
      <RailButton active={showDimensions} title="Maßketten · M" onClick={toggleDimensions}>
        <Icon>{icons.dims}</Icon>
      </RailButton>
      <RailButton active={showRoomLabels} title="Raumstempel" onClick={toggleRoomLabels}>
        <Icon>{icons.labels}</Icon>
      </RailButton>

      <Separator />

      <RailButton disabled={past === 0} title="Rückgängig · Strg+Z" onClick={undo}>
        <Icon>{icons.undo}</Icon>
      </RailButton>
      <RailButton disabled={future === 0} title="Wiederholen · Strg+Umschalt+Z" onClick={redo}>
        <Icon>{icons.redo}</Icon>
      </RailButton>

      <div className="flex-1" />

      <RailButton title="Demo-Grundriss laden" onClick={loadDemo}>
        <Icon>{icons.demo}</Icon>
      </RailButton>
      <RailButton
        title="Alle Geometrie löschen"
        danger
        onClick={() => {
          if (confirm('Wirklich die gesamte Geometrie löschen?')) clearAll();
        }}
      >
        <Icon>{icons.trash}</Icon>
      </RailButton>
    </div>
  );
}

function RailButton({
  children,
  active,
  disabled,
  danger,
  title,
  onClick,
}: {
  children: ReactNode;
  active?: boolean;
  disabled?: boolean;
  danger?: boolean;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`tool-btn ${active ? 'tool-btn-active' : ''} ${
        disabled ? 'pointer-events-none opacity-25' : ''
      } ${danger ? 'hover:text-rose-300' : ''}`}
    >
      {children}
    </button>
  );
}

const Separator = () => <div className="my-1 h-px w-7 bg-white/[0.07]" />;

// ---------------------------------------------------------------------------
// Kopfzeile
// ---------------------------------------------------------------------------

const VIEW_MODES: { id: ViewMode; label: string }[] = [
  { id: '2d', label: '2D' },
  { id: 'split', label: 'Split' },
  { id: '3d', label: '3D' },
  { id: 'schema', label: 'Schema' },
];

const WALL_TYPE_LABELS: Record<WallType, string> = {
  exterior: 'Außenwand',
  interior: 'Innenwand',
  partition: 'Trennwand',
  shaft: 'Schacht',
};

/**
 * Kopfzeile. `onProjekte` öffnet die Projektverwaltung — sie lebt in der
 * Shell, weil dort bekannt ist, welches Projekt gerade offen ist und wohin
 * die Sitzungssicherung schreibt.
 */
export function TopBar({ onProjekte }: { onProjekte: () => void }) {
  const doc = useBimStore((s) => s.doc);
  const tool = useBimStore((s) => s.tool);
  const openingPreset = useBimStore((s) => s.openingPreset);
  const setOpeningPreset = useBimStore((s) => s.setOpeningPreset);
  const viewMode = useBimStore((s) => s.viewMode);
  const setViewMode = useBimStore((s) => s.setViewMode);
  const updateMeta = useBimStore((s) => s.updateMeta);
  const setStatus = useBimStore((s) => s.setStatus);
  const loadProject = useBimStore((s) => s.loadProject);
  const loadIfc = useBimStore((s) => s.loadIfc);
  const fileRef = useRef<HTMLInputElement>(null);
  const [printOpen, setPrintOpen] = useState(false);
  /** Der Rohrnetzbericht — eigenes Fenster, weil er mehrere Blätter hat. */
  const [berichtOpen, setBerichtOpen] = useState(false);
  /**
   * Zuletzt gewählte Verlegeart.
   *
   * Sie steht bewusst nicht im Dokument: sie beschreibt, wie der Anwender
   * arbeitet, nicht das Gebäude. Wer ein Bestandsgebäude aufmisst, drückt
   * einmal „Sanierung" und danach nur noch den Knopf.
   */
  const [verlegeart, setVerlegeart] = useState<PipeRoutingMode>('neubau');
  const legeRohrnetzAus = useBimStore((s) => s.legeRohrnetzAus);

  const handleExport = () => {
    const data = buildRaviaExport(doc);
    downloadJson(data, exportFilename(doc.meta.name));
    const v = data.validation;
    setStatus(
      v.errors > 0
        ? `Export erzeugt — aber ${v.errors} Fehler im Modell, siehe Prüfung`
        : `Export: ${data.rooms.length} Räume · ${data.totals.netFloorArea.toFixed(2)} m² · ${data.totals.installedHeatingPower} W installiert`,
    );
  };

  const handleIfc = () => {
    const ifc = buildIfc(doc);
    downloadIfc(ifc, ifcFilename(doc.meta.name));
    const entities = (ifc.match(/^#\d+=/gm) ?? []).length;
    setStatus(
      `IFC4 erzeugt — ${Object.keys(doc.levels).length} Geschosse, ${Object.keys(doc.walls).length} Wände, ${
        Object.keys(doc.rooms).length
      } Räume · ${entities} Objekte`,
    );
  };

  /**
   * Öffnet eine Projektdatei *oder* eine IFC-Datei. Welche es ist, entscheidet
   * der Inhalt, nicht die Endung: eine umbenannte Datei soll trotzdem
   * funktionieren, und die STEP-Kopfzeile ist eindeutig.
   */
  const handleOpen = async (file: File) => {
    const text = await file.text();
    if (text.trimStart().startsWith('ISO-10303-21')) {
      if (
        Object.keys(doc.walls).length > 0 &&
        !confirm(
          'Die IFC-Datei ersetzt das aktuelle Modell. Fortfahren?\n\n' +
            'Rückgängig (Strg+Z) holt den jetzigen Stand zurück.',
        )
      ) {
        setStatus('IFC-Import abgebrochen');
        return;
      }
      const result = loadIfc(text);
      setStatus(result.message);
      return;
    }

    try {
      const result = loadProject(JSON.parse(text));
      setStatus(result.message);
    } catch {
      setStatus('Datei konnte nicht gelesen werden — weder RaVia-JSON noch IFC.');
    }
  };

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 px-3">
      {/* Marke */}
      <div className="flex items-center gap-2.5 pl-1">
        <div className="relative flex h-6 w-6 items-center justify-center">
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="#38BDF8" strokeWidth="1.5">
            <path d="M4 20V9l8-5 8 5v11" strokeLinejoin="round" />
            <path d="M4 20h16" strokeLinecap="round" />
            <path d="M10 20v-6h4v6" />
          </svg>
        </div>
        <div className="leading-tight">
          <div className="text-[13px] font-semibold tracking-tight text-slate-100">RaVia CAD</div>
          <div className="text-[9px] font-medium uppercase tracking-[0.18em] text-accent/70">Light</div>
        </div>
      </div>

      <div className="divider-v" />

      {/* Projektname */}
      <input
        className="w-48 rounded-md bg-transparent px-2 py-1 text-xs text-slate-200 outline-none transition-colors hover:bg-white/[0.04] focus:bg-white/[0.06]"
        value={doc.meta.name}
        onChange={(e) => updateMeta({ name: e.target.value })}
        spellCheck={false}
      />

      {/* Der Name im Feld ist zugleich der Projektname — deshalb steht der
          Zugang zur Projektliste unmittelbar daneben. */}
      <button
        onClick={onProjekte}
        className="tool-btn h-8 w-8"
        title="Projekte — mehrere Grundrisse nebeneinander, umschalten ohne Dateidialog. Liegt nur in diesem Browser; zum Mitnehmen die Projektdatei sichern."
      >
        <Icon>{icons.projects}</Icon>
      </button>

      <div className="divider-v" />

      <LevelBar />

      <div className="divider-v" />

      {/* Kontextleiste: bei aktivem Öffnungswerkzeug der Typenkatalog,
          sonst die Wand-Voreinstellungen. Die Leiste zeigt immer das,
          was zum gerade gewählten Werkzeug gehört. */}
      {tool === 'door' || tool === 'window' || tool === 'passage' ? (
        <OpeningTypeBar
          kind={tool as OpeningKind}
          activeId={openingPreset.id}
          onSelect={(preset) => setOpeningPreset(preset)}
        />
      ) : tool === 'pipe' ? (
        <PipeServiceBar />
      ) : tool === 'stair' ? (
        <VerticalKindBar />
      ) : tool === 'solid' ? (
        <SolidKindBar />
      ) : tool === 'annotation' ? (
        <AnnotationKindBar />
      ) : (
        <WallDefaultsBar />
      )}

      <div className="flex-1" />

      {/* Ansichtsmodus */}
      <div className="flex gap-0.5 rounded-lg bg-graphite-900/60 p-0.5">
        {VIEW_MODES.map((mode) => (
          <button
            key={mode.id}
            className={`chip px-2.5 ${
              viewMode === mode.id ? 'bg-accent/15 text-accent' : 'text-slate-500 hover:text-slate-300'
            }`}
            onClick={() => setViewMode(mode.id)}
          >
            {mode.label}
          </button>
        ))}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json,.ifc,.step,.stp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleOpen(file);
          e.target.value = '';
        }}
      />
      <button
        onClick={() => fileRef.current?.click()}
        className="tool-btn h-8 w-8"
        title="Öffnen — RaVia-Projektdatei (JSON) oder IFC4-Modell vom Architekten"
      >
        <Icon>{icons.open}</Icon>
      </button>

      <button
        onClick={handleIfc}
        className="tool-btn h-8 w-8"
        title="Modell als IFC4 exportieren — für Architektur-CAD und Fachplanung"
      >
        <Icon>{icons.ifc}</Icon>
      </button>

      {/*
        Rohrausleger in der Kopfzeile.
        ---------------------------------------------------------------
        Er stand bisher nur im Anlagenblatt. Das ist der falsche Ort für
        etwas, das den **Grundriss** verändert: wer die Trasse sehen will,
        steht im Plan und nicht im Formular. Der Knopf legt in der zuletzt
        gewählten Verlegeart aus; die Wahl zwischen Neubau und Sanierung
        steht daneben, weil sie das Ergebnis vollständig bestimmt und nicht
        in einem Untermenü versteckt gehört.
      */}
      <div className="flex items-center gap-0.5 rounded-lg bg-graphite-900/60 p-0.5">
        {(['neubau', 'sanierung'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setVerlegeart(m)}
            title={
              m === 'neubau'
                ? 'Neubau — Leitungen auf der Rohdecke im Fußbodenaufbau, der Weg darf quer durch den Raum'
                : 'Sanierung — Leitungen sichtbar an der Wand im Sockelleistenkanal, die Trasse folgt den Wänden'
            }
            className={`chip px-2 ${verlegeart === m ? 'bg-accent/15 text-accent' : 'text-slate-500 hover:text-slate-300'}`}
          >
            {m === 'neubau' ? 'Neubau' : 'Sanierung'}
          </button>
        ))}
        <button
          onClick={() => legeRohrnetzAus(verlegeart)}
          className="tool-btn h-8 w-8"
          title="Rohrnetz automatisch auslegen — Trasse, Nennweiten, Dämmung nach Anlage 8 GEG und Armaturen. Von Hand gezogene Leitungen bleiben stehen."
        >
          <Icon>{icons.rohrnetz}</Icon>
        </button>
      </div>

      <button
        onClick={() => setBerichtOpen(true)}
        className="tool-btn h-8 w-8"
        title="Rohrnetzberechnung — Grundriss, Teilstreckentabelle, Einstellwerte und Nachweis nach § 60c GModG als PDF"
      >
        <Icon>{icons.bericht}</Icon>
      </button>

      <button
        onClick={() => setPrintOpen(true)}
        className="tool-btn h-8 w-8"
        title="Grundriss maßstäblich drucken (1:50, 1:100 …) — A4/A3, komplettes Geschoss"
      >
        <Icon>{icons.print}</Icon>
      </button>

      <button
        onClick={handleExport}
        className="flex items-center gap-1.5 rounded-lg bg-accent/15 px-3 py-1.5 text-[11px] font-medium text-accent shadow-glow transition-colors hover:bg-accent/25"
        title="Gebäudedaten als RaVia-BIM-JSON exportieren (DIN EN 12831) — dient zugleich als Projektdatei"
      >
        <Icon>{icons.export}</Icon>
        RaVia JSON
      </button>

      {printOpen && <PlanPrintDialog onClose={() => setPrintOpen(false)} />}
      {berichtOpen && <RohrnetzDialog onClose={() => setBerichtOpen(false)} />}
    </header>
  );
}

/** Typenkatalog für Fenster, Türen und Durchgänge. */
function OpeningTypeBar({
  kind,
  activeId,
  onSelect,
}: {
  kind: OpeningKind;
  activeId: string;
  onSelect: (preset: (typeof OPENING_PRESETS)[number]) => void;
}) {
  const presets = OPENING_PRESETS.filter((p) => p.kind === kind);
  const label = kind === 'window' ? 'Fenstertyp' : kind === 'door' ? 'Türtyp' : 'Durchgang';

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className="label-xs shrink-0">{label}</span>
      <div className="flex min-w-0 gap-0.5 overflow-x-auto rounded-lg bg-graphite-900/60 p-0.5">
        {presets.map((preset) => (
          <button
            key={preset.id}
            onClick={() => onSelect(preset)}
            title={`${preset.label} · ${(preset.width * 100).toFixed(1)} × ${(preset.height * 100).toFixed(1)} cm${
              preset.sillHeight ? ` · Brüstung ${(preset.sillHeight * 100).toFixed(0)} cm` : ''
            }`}
            className={`chip whitespace-nowrap ${
              activeId === preset.id ? 'bg-accent/15 text-accent' : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            {preset.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Wandstärke und Bauteiltyp für das Zeichnen. */
function WallDefaultsBar() {
  const wallDefaults = useBimStore((s) => s.wallDefaults);
  const setWallDefaults = useBimStore((s) => s.setWallDefaults);

  return (
    <>
      <div className="flex items-center gap-1.5">
        <span className="label-xs">Wandstärke</span>
        <div className="flex gap-0.5 rounded-lg bg-graphite-900/60 p-0.5">
          {WALL_THICKNESS_PRESETS.map((t) => (
            <button
              key={t}
              className={`chip ${
                Math.abs(wallDefaults.thickness - t) < 1e-6
                  ? 'bg-accent/15 text-accent'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
              onClick={() => setWallDefaults({ thickness: t })}
              title={`${(t * 100).toFixed(1)} cm`}
            >
              {(t * 100).toFixed(1)}
            </button>
          ))}
        </div>
      </div>

      <select
        className="rounded-md bg-graphite-900/60 px-2 py-1.5 text-[11px] text-slate-300 outline-none"
        value={wallDefaults.type}
        onChange={(e) => {
          const type = e.target.value as WallType;
          setWallDefaults({ type, uValue: type === 'exterior' ? 0.24 : 1.2 });
        }}
      >
        {(Object.keys(WALL_TYPE_LABELS) as WallType[]).map((type) => (
          <option key={type} value={type} className="bg-graphite-850">
            {WALL_TYPE_LABELS[type]}
          </option>
        ))}
      </select>
    </>
  );
}

/** Leitungsart für das Rohr-Werkzeug — die Farbe im Plan folgt der Auswahl. */
function PipeServiceBar() {
  const service = useBimStore((s) => s.pipeService);
  const setService = useBimStore((s) => s.setPipeService);
  const services = Object.keys(PIPE_SERVICE_LABELS) as PipeService[];

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className="label-xs shrink-0">Leitung</span>
      <div className="flex min-w-0 gap-0.5 overflow-x-auto rounded-lg bg-graphite-900/60 p-0.5">
        {services.map((s2) => (
          <button
            key={s2}
            onClick={() => setService(s2)}
            title={PIPE_SERVICE_LABELS[s2]}
            className={`chip flex items-center gap-1.5 whitespace-nowrap ${
              service === s2 ? 'bg-white/[0.08] text-slate-100' : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: PIPE_SERVICE_COLORS[s2] }}
            />
            {PIPE_SERVICE_LABELS[s2]}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Treppenform für das Treppen-Werkzeug. */
function VerticalKindBar() {
  const kind = useBimStore((s) => s.verticalKind);
  const setKind = useBimStore((s) => s.setVerticalKind);
  const kinds: VerticalKind[] = ['stair-straight', 'stair-l', 'stair-u', 'stair-spiral'];

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className="label-xs shrink-0">Treppe</span>
      <div className="flex min-w-0 gap-0.5 overflow-x-auto rounded-lg bg-graphite-900/60 p-0.5">
        {kinds.map((k) => (
          <button
            key={k}
            onClick={() => setKind(k)}
            title={VERTICAL_LABELS[k]}
            className={`chip whitespace-nowrap ${
              kind === k ? 'bg-accent/15 text-accent' : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            {VERTICAL_LABELS[k].replace(' Treppe', '')}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Art des massiven Bauteils.
 *
 * Die vier Arten unterscheiden sich für die Rechnung nicht — Fläche ist
 * Fläche. Sie unterscheiden sich in der Beschriftung des Plans und in dem,
 * was die Gegenstelle daraus liest: ein Schornstein an der Außenwand ist eine
 * Wärmebrücke, ein Installationsblock ist keine.
 */
function SolidKindBar() {
  const kind = useBimStore((s) => s.solidKind);
  const setKind = useBimStore((s) => s.setSolidKind);
  const kinds: SolidKind[] = ['chimney', 'pier', 'wall-offset', 'service-block'];

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className="label-xs shrink-0">Massiv</span>
      <div className="flex min-w-0 gap-0.5 overflow-x-auto rounded-lg bg-graphite-900/60 p-0.5">
        {kinds.map((k) => (
          <button
            key={k}
            onClick={() => setKind(k)}
            title={SOLID_LABELS[k]}
            className={`chip whitespace-nowrap ${
              kind === k ? 'bg-accent/15 text-accent' : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            {SOLID_LABELS[k].replace(' / Schornstein', '')}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Art der Beschriftung: Maßkette, Text oder Hinweisfahne. */
function AnnotationKindBar() {
  const kind = useBimStore((s) => s.annotationKind);
  const setKind = useBimStore((s) => s.setAnnotationKind);
  const kinds: AnnotationKind[] = ['dimension', 'text', 'leader'];

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className="label-xs shrink-0">Beschriftung</span>
      <div className="flex min-w-0 gap-0.5 rounded-lg bg-graphite-900/60 p-0.5">
        {kinds.map((k) => (
          <button
            key={k}
            onClick={() => setKind(k)}
            className={`chip whitespace-nowrap ${
              kind === k ? 'bg-accent/15 text-accent' : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            {ANNOTATION_LABELS[k]}
          </button>
        ))}
      </div>
    </div>
  );
}
