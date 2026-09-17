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
  DurchbruchKind,
  DurchbruchPreset,
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
  DURCHBRUCH_PRESETS,
  VERTICAL_LABELS,
  WALL_THICKNESS_PRESETS,
} from '../types/bim';
import { verlegeartAus } from '../lib/plantDefaults';
import { UI_MODUS_LABELS, zeigtAnsicht, zeigtKopfknopf, zeigtWerkzeug, type UiModus } from '../lib/uimodus';
import { useBimStore } from '../store/useBimStore';
import { useRef, useState } from 'react';
import { buildRaviaExport, downloadJson, exportFilename } from '../lib/raviaExport';
import { buildIfc, downloadIfc, ifcFilename } from '../lib/ifcExport';
import { istRaumplanDatei } from '../lib/raumplanImport';
import LevelBar from './LevelBar';
import PlanPrintDialog from './PlanPrintDialog';
import RohrnetzDialog from './RohrnetzDialog';
import MappeDialog from './MappeDialog';

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
  /* Ein Stift über einer krakeligen Linie — Skizzieren. */
  sketch: <><path d="M3 16c2-4 4 2 6-2s3 3 5-1" /><path d="M13 8l4-4 2 2-4 4-3 1 1-3z" /></>,
  /* Derselbe Stift ohne Linie, dafür mit Notizblatt — Anmerkung. */
  ink: <><path d="M4 4h8l4 4v8H4z" /><path d="M12 4v4h4" /><path d="M7 12c1.5-2 2.5 1 4-1" /></>,
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
  durchbruch: <><path d="M3 5h14M3 15h14" /><circle cx="10" cy="10" r="3.6" /><path d="M7.5 7.5l5 5M12.5 7.5l-5 5" /></>,
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
  // Projektmappe: ein Stapel Blätter mit Heftrand — das Bild für „ein
  // Dokument statt vier Fenster".
  mappe: <><path d="M6.5 4.5h9a.5.5 0 01.5.5v12a.5.5 0 01-.5.5h-9a.5.5 0 01-.5-.5V5a.5.5 0 01.5-.5z" /><path d="M8.5 4.5V17.5" /><path d="M4 6.5v9" /><path d="M2.5 8.5v5" /><path d="M10.5 8h4M10.5 11h4M10.5 14h2.5" /></>,
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
  { id: 'sketch', icon: 'sketch', label: 'Freihand skizzieren', hotkey: 'Q', simple: true,
    hint: 'Mit dem Stift den Grundriss hinkrakeln — das Programm liest daraus gerade Wände und schlägt sie vor. Erst „Übernehmen" legt sie an.' },
  { id: 'ink', icon: 'ink', label: 'Auf den Plan schreiben', hotkey: 'K', simple: false,
    hint: 'Notizen, Pfeile, Maße von Hand. Bleibt als eigene Ebene über der Zeichnung und wird nie zu Geometrie.' },
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
  { id: 'durchbruch', icon: 'durchbruch', label: 'Durchbruch setzen', hotkey: 'U', simple: true,
    hint: 'Kernbohrung, Wanddurchbruch, Schlitz oder Deckenloch. Auf eine Wand tippen — der Durchbruch sitzt dann in der Wand und wandert mit ihr. Er mindert keine Wandfläche, aber er steht auf dem Plan und im Massenauszug.' },
  { id: 'pipe', icon: 'pipe', label: 'Leitung verlegen', hotkey: 'L',
    hint: 'Punkte im Plan setzen; ein Klick auf ein Symbol schließt die Leitung dort an.' },
  // Auch im einfachen Modus: „Text schreiben" ist keine Fachplanerfunktion,
  // sondern das Erste, was jemand auf einem Plan tun will. Ohne den Eintrag
  // war Beschriften auf dem Tablet gar nicht erreichbar — der Hotkey B hilft
  // nur dem, der eine Tastatur hat.
  { id: 'annotation', icon: 'annotation', label: 'Text & Maßkette', hotkey: 'B', simple: true,
    hint: 'Text auf den Plan schreiben, Maße von Hand ansetzen, Hinweisfahnen. Das Eingabefeld erscheint dort, wo Sie tippen. Geht nicht in die Berechnung ein.' },
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

  /*
      * Die Leiste darf rollen.
      *
      * Im Fachplanermodus stehen hier über zwanzig Werkzeuge. Auf einem
      * Rechner mit 1080 Bildpunkten Höhe passen sie; auf einem Tablet quer
      * (820 px) und erst recht mit 44-Pixel-Schaltflächen passen sie nicht,
      * und die letzten — darunter Rückgängig — wären nicht mehr erreichbar.
      * `overscroll-contain` hält das Rollen in der Leiste, statt es an die
      * Seite weiterzugeben.
     */
  return (
    <div
      className="panel m-2 flex w-[52px] shrink-0 flex-col items-center gap-1 overflow-y-auto overscroll-contain rounded-xl px-1.5 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      style={{ touchAction: 'pan-y' }}
    >
      {TOOLS.filter((t) => zeigtWerkzeug(uiMode, t.id, t.simple === true)).map((t) => (
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
  const uiMode = useBimStore((s) => s.uiMode);
  const setUiMode = useBimStore((s) => s.setUiMode);
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
  const loadRaumscan = useBimStore((s) => s.loadRaumscan);
  const fileRef = useRef<HTMLInputElement>(null);
  const [printOpen, setPrintOpen] = useState(false);
  /** Der Rohrnetzbericht — eigenes Fenster, weil er mehrere Blätter hat. */
  const [berichtOpen, setBerichtOpen] = useState(false);
  /** Die Projektmappe — sie setzt die vier Druckwege zu einem Dokument zusammen. */
  const [mappeOpen, setMappeOpen] = useState(false);
  /**
   * Die Verlegeart.
   *
   * Sie steht bewusst nicht im Dokument: sie beschreibt, wie der Anwender
   * arbeitet, nicht das Gebäude. Ihre **Vorbelegung** kommt aber sehr wohl
   * aus dem Gebäude — wer als Vorhaben „Sanierung" eingetragen hat, will
   * nicht bei jedem Auslegen daran denken, den Schalter umzulegen. Bis
   * 1.25.0 stand hier fest „Neubau"; eine Bestandssanierung wurde damit
   * stillschweigend mit Leitungen auf der Rohdecke ausgelegt, quer durch
   * Räume, in denen längst Estrich liegt.
   *
   * Ein Klick auf einen der beiden Knöpfe gewinnt ab dann. `null` heißt:
   * noch nichts gewählt, es gilt das Vorhaben.
   */
  const vorhaben = useBimStore((s) => s.doc.meta.vorhaben);
  const [verlegeartWahl, setVerlegeartWahl] = useState<PipeRoutingMode | null>(null);
  const verlegeart: PipeRoutingMode = verlegeartWahl ?? verlegeartAus(vorhaben);
  const setVerlegeart = setVerlegeartWahl;
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
   * Öffnet eine Projektdatei, eine IFC-Datei *oder* einen Raumscan. Welche es
   * ist, entscheidet der Inhalt, nicht die Endung: eine umbenannte Datei soll
   * trotzdem funktionieren, die STEP-Kopfzeile ist eindeutig, und ein Scan
   * aus RoomPlan ist zwar JSON — aber eines, das sich an seinen Feldern
   * sicher erkennen lässt. Die Reihenfolge ist wichtig: der Scan wird **vor**
   * der Projektdatei geprüft, weil beide JSON sind und `loadProject` einen
   * Scan sonst als leeres Projekt einlesen würde, ohne zu scheitern.
   */
  const handleOpen = async (file: File) => {
    const text = await file.text();

    if (istRaumplanDatei(text)) {
      if (
        Object.keys(doc.walls).length > 0 &&
        !confirm(
          'Der Raumscan ersetzt das aktuelle Modell. Fortfahren?\n\n' +
            'Rückgängig (Strg+Z) holt den jetzigen Stand zurück.',
        )
      ) {
        setStatus('Scan-Import abgebrochen');
        return;
      }
      const result = loadRaumscan(text);
      setStatus(result.message);
      return;
    }

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
      setStatus('Datei konnte nicht gelesen werden — weder RaVia-JSON, IFC noch Raumscan.');
    }
  };

  /*
   * Die Kopfzeile bricht um, statt nach rechts zu wachsen.
   * -------------------------------------------------------------------------
   * Bisher lag alles in **einer** Reihe, die waagerecht rollte. Auf einem iPad
   * hochkant (820 px) hieß das: die Kontextleiste des gewählten Werkzeugs —
   * vierzehn Regelmaße beim Durchbruch — schob Ansichtswahl und Ausgabeknöpfe
   * aus dem Bild, und wer sie brauchte, musste erst wischen. Gefunden hat das
   * niemand, der es nicht wusste.
   *
   * Jetzt sind es drei Blöcke, die **umbrechen** statt sich zu schieben:
   *
   *   1. Marke, Projektname, Geschoss   — bleibt immer links oben,
   *   2. die Kontextleiste zum Werkzeug — wächst in die Breite und, wenn die
   *      nicht reicht, in Reihen untereinander,
   *   3. Ansicht und Ausgabe            — bleibt zusammen, notfalls in einer
   *                                       eigenen Zeile.
   *
   * Kein Block schrumpft: die Knöpfe behalten ihre 44 px (siehe `index.css`,
   * `pointer: coarse`), und was nicht mehr in die Breite passt, rückt eine
   * Reihe tiefer. Jede Reihe ist deshalb gleich hoch.
   *
   * Ein Block wird dabei nur dann **in sich** umgebrochen, wenn er allein
   * schon breiter ist als das Gerät — auf dem iPad hochkant trifft das Block 3
   * mit seinen zehn Ausgabeknöpfen. Sonst wandert der ganze Block als Einheit
   * nach unten, und Zusammengehöriges bleibt beieinander.
   *
   * `flex-auto` an Block 2 ist die tragende Einstellung. Mit `flex-1`
   * (Grundbreite 0) fiele der Block nie in eine neue Zeile, sondern würde in
   * den Rest der ersten gequetscht — eine schmale Spalte mit fünf Reihen.
   * Mit `flex-auto` ist seine Grundbreite der Inhalt: passt er nicht mehr
   * daneben, rückt er ganz nach unten und füllt dort die volle Breite. Er
   * ersetzt zugleich den früheren Platzhalter (`flex-1`), der die rechte
   * Gruppe an den Rand geschoben hat.
   *
   * Die Höhe ist deshalb nicht mehr fest (`h-12`), sondern eine Untergrenze
   * (`min-h-[3rem]`). Das ist ungefährlich: die Kopfzeile sitzt in einer
   * senkrechten Flex-Spalte, die Zeichenfläche darunter bekommt den Rest
   * (`flex-1`) und meldet ihre neue Größe über den ResizeObserver an das
   * Canvas. Überlappen kann da nichts; die Zeichenfläche wird nur kleiner.
   *
   * Das waagerechte Rollen bleibt als letzter Rückfall stehen. Gebraucht wird
   * es nach dem Umbau nicht mehr (nachgemessen: 640 bis 1920 px, alle sieben
   * Werkzeuge, nichts liegt außerhalb) — aber ein Geschossumschalter mit acht
   * Geschossen ist irgendwann breiter als jedes Gerät, und dann ist Wischen
   * besser als Abschneiden.
   */
  return (
    <header
      className="flex min-h-[3rem] shrink-0 flex-wrap items-center gap-x-3 gap-y-1 overflow-x-auto overscroll-x-contain px-3 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      style={{ touchAction: 'pan-x' }}
    >
      {/* Block 1 — Marke, Projektname, Geschoss. */}
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        {/* Marke */}
        <div className="flex items-center gap-2.5 pl-1">
          <div className="relative flex h-6 w-6 items-center justify-center">
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="#38BDF8" strokeWidth="1.5">
              <path d="M4 20V9l8-5 8 5v11" strokeLinejoin="round" />
              <path d="M4 20h16" strokeLinecap="round" />
              <path d="M10 20v-6h4v6" />
            </svg>
          </div>
          {/*
            Unter dem Schriftzug steht die Fassungsnummer.

            Sie ist keine Zierde, sondern das einzige, woran sich eine Meldung
            aus dem Feld festmachen lässt: „geht nicht" ist ohne Fassung nicht
            nachstellbar. Deshalb steht sie dort, wo der Anwender ohnehin
            hinsieht, und nicht in einem Dialog unter „Über".

            Die Nummer kommt aus `package.json` (siehe `__RAVIA_FASSUNG__` in
            `vite.config.ts`) und steht bewusst **nicht** als Zeichenkette hier —
            eine von Hand gepflegte zweite Stelle wäre spätestens bei der
            übernächsten Auslieferung falsch.

            Klein, in Grau und eine Stufe unter dem Zusatz „Light": erkennbar für
            den, der sie sucht, und übersehbar für alle anderen.
            `whitespace-nowrap` hält sie auch auf dem schmalsten Gerät in einer
            Zeile — „1.23." über „0" wäre schlimmer als gar keine Angabe.
          */}
          <div className="leading-tight">
            <div className="text-[13px] font-semibold tracking-tight text-slate-100">RaVia CAD</div>
            <div className="text-[9px] font-medium uppercase tracking-[0.18em] text-accent/70">Light</div>
            <div
              className="whitespace-nowrap text-[9px] font-medium tabular-nums text-slate-500"
              title={`Fassung ${__RAVIA_FASSUNG__} — diese Nummer bitte bei jeder Rückmeldung mitschicken`}
            >
              {__RAVIA_FASSUNG__}
            </div>
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
      </div>

      {/*
        Block 2 — die Kontextleiste zum gewählten Werkzeug.

        `flex-auto`: sie füllt die Breite, die neben Block 1 übrig ist, und
        rückt ganz nach unten, sobald dort nichts mehr übrig ist. `min-w-0`
        gehört zwingend dazu — ein Flex-Element schrumpft von sich aus nie
        unter seine Inhaltsbreite, und ohne diese Angabe käme der Umbruch im
        Inneren der Leiste gar nicht erst zum Zuge.
      */}
      <div className="flex min-w-0 flex-auto flex-wrap items-center gap-x-3 gap-y-1">
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
        ) : tool === 'durchbruch' ? (
          <DurchbruchBar />
        ) : tool === 'annotation' ? (
          <AnnotationKindBar />
        ) : (
          <WallDefaultsBar />
        )}
      </div>

      {/*
        Block 3 — Ansicht und Ausgabe.

        Rechtsbündig, damit „RaVia JSON" dort bleibt, wo es immer stand: am
        rechten Rand. Auch dieser Block bricht im Inneren um — auf dem iPad
        hochkant ist er mit 44-px-Knöpfen breiter als das Gerät, und ohne
        Umbruch läge genau der Ausgabeknopf hinter dem Rand.
      */}
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-x-3 gap-y-1">
        {/* Ansichtsmodus */}
        {/*
          Der Ansichtsumschalter — und davor die Frage, wie viel vom Programm
          überhaupt zu sehen sein soll.

          Er stand bisher ausschließlich unten im Reiter „Start", hinter der
          ganzen Schrittliste: auf dem iPad quer 1531 Pixel Rollweg, also der
          gesamte Rollbereich. Ein Rollenumschalter, den man erst am Ende
          einer Aufgabenliste findet, existiert für den Anwender nicht. Hier
          oben steht er neben der Ansicht, weil er dieselbe Frage beantwortet:
          was sehe ich.

          Als `select` und nicht als Knopfgruppe, weil drei Knöpfe in einer
          ohnehin vollen Kopfleiste Platz kosten, den der Handwerkermodus
          gerade erst frei gemacht hat — und weil ein Tablet dafür seine
          eigene, große Auswahlliste öffnet.
        */}
        <select
          value={uiMode}
          onChange={(e) => setUiMode(e.target.value as UiModus)}
          title="Wie viel vom Programm zu sehen ist. Ausgeblendetes wird nicht gelöscht."
          className="h-8 rounded-lg bg-graphite-900/60 px-2 text-[11px] text-slate-400 transition-colors hover:text-slate-200 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:text-[16px]"
        >
          {(['handwerker', 'einfach', 'profi'] as const).map((m) => (
            <option key={m} value={m} className="bg-graphite-850">
              {UI_MODUS_LABELS[m]}
            </option>
          ))}
        </select>

        <div className="flex gap-0.5 rounded-lg bg-graphite-900/60 p-0.5">
          {VIEW_MODES.filter((mode) => zeigtAnsicht(uiMode, mode.id)).map((mode) => (
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
          title="Öffnen — RaVia-Projektdatei (JSON), IFC4-Modell vom Architekten oder Raumscan vom iPhone (RoomPlan)"
        >
          <Icon>{icons.open}</Icon>
        </button>

        {zeigtKopfknopf(uiMode, 'ifc') && (
          <button
            onClick={handleIfc}
            className="tool-btn h-8 w-8"
            title="Modell als IFC4 exportieren — für Architektur-CAD und Fachplanung"
          >
            <Icon>{icons.ifc}</Icon>
          </button>
        )}

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
        {zeigtKopfknopf(uiMode, 'rohrnetz') && (
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
        )}

        {zeigtKopfknopf(uiMode, 'bericht') && (
          <button
            onClick={() => setBerichtOpen(true)}
            className="tool-btn h-8 w-8"
            title="Rohrnetzberechnung — Grundriss, Teilstreckentabelle, Einstellwerte und Nachweis nach § 60c GModG als PDF"
          >
            <Icon>{icons.bericht}</Icon>
          </button>
        )}

        {zeigtKopfknopf(uiMode, 'mappe') && (
          <button
            onClick={() => setMappeOpen(true)}
            className="tool-btn h-8 w-8"
            title="Projektmappe — Grundrisse, Anlagenschema, Rohrnetz, Einstellwerte, Massenauszug, Anlagenbuch, Quellen und Nachweis in einem Dokument mit durchlaufender Blattnummer"
          >
            <Icon>{icons.mappe}</Icon>
          </button>
        )}

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
      </div>

      {printOpen && <PlanPrintDialog onClose={() => setPrintOpen(false)} />}
      {berichtOpen && <RohrnetzDialog onClose={() => setBerichtOpen(false)} />}
      {mappeOpen && <MappeDialog onClose={() => setMappeOpen(false)} />}
    </header>
  );
}

/**
 * Typenkatalog für Fenster, Türen und Durchgänge.
 *
 * **Warum die Reihe umbricht und nicht rollt.** Alle Kontextleisten hier
 * folgen demselben Bauplan: eine Aufschrift und daneben eine Reihe Knöpfe in
 * einem gemeinsamen Feld. Bis 1.23.0 war dieses Feld seitlich rollbar und der
 * Rahmen `shrink-0` — die Reihe wuchs also immer weiter nach rechts, und was
 * nicht mehr hineinpasste, lag hinter dem Rand. Auf dem Tablet hat das
 * niemand gefunden: eine Rollleiste ist dort nicht zu sehen, und dass man
 * innerhalb eines zwei Zentimeter hohen Streifens wischen kann, ahnt man
 * nicht.
 *
 * Deshalb: `flex-wrap` statt `overflow-x-auto`, und `min-w-0` statt
 * `shrink-0`. Beides gehört zusammen — ein Flex-Element schrumpft von sich
 * aus nie unter seine Inhaltsbreite, also käme es ohne `min-w-0` gar nicht
 * erst in die Lage, umbrechen zu müssen.
 *
 * Die Knöpfe selbst bleiben unangetastet: `.chip` steht unter
 * `pointer: coarse` auf `flex: none` und mindestens 36 px Höhe (`index.css`).
 * Sie werden also nicht gequetscht, sondern rücken eine Reihe tiefer — und
 * jede Reihe ist gleich hoch.
 */
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
      <div className="flex min-w-0 flex-wrap gap-0.5 rounded-lg bg-graphite-900/60 p-0.5">
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
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="label-xs shrink-0">Wandstärke</span>
        <div className="flex min-w-0 flex-wrap gap-0.5 rounded-lg bg-graphite-900/60 p-0.5">
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
  const doppel = useBimStore((s) => s.doppelleitung);
  const setDoppel = useBimStore((s) => s.setDoppelleitung);
  const services = Object.keys(PIPE_SERVICE_LABELS) as PipeService[];
  // Nur die Heizung hat einen Rücklauf. Bei Abwasser oder Zuluft stünde hier
  // ein Schalter, der nichts tut — und ein Schalter, der nichts tut, ist eine
  // Behauptung.
  const paarbar = service === 'heating-flow' || service === 'heating-return';

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className="label-xs shrink-0">Leitung</span>
      <div className="flex min-w-0 flex-wrap gap-0.5 rounded-lg bg-graphite-900/60 p-0.5">
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
      {paarbar && (
        <button
          onClick={() => setDoppel(!doppel)}
          title={
            doppel
              ? 'Doppelleitung: ein Zug legt Vor- und Rücklauf nebeneinander (Achsabstand 5 cm). Sie wandern und verschwinden gemeinsam.'
              : 'Einzelleitung: ein Zug legt eine Leitung.'
          }
          className={`chip shrink-0 whitespace-nowrap ${
            doppel ? 'bg-accent/15 text-accent' : 'text-slate-500 hover:text-slate-300'
          }`}
        >
          {doppel ? 'Doppelleitung' : 'Einzelleitung'}
        </button>
      )}
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
      <div className="flex min-w-0 flex-wrap gap-0.5 rounded-lg bg-graphite-900/60 p-0.5">
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
      <div className="flex min-w-0 flex-wrap gap-0.5 rounded-lg bg-graphite-900/60 p-0.5">
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

/**
 * Die Regelmaße der Durchbrüche.
 *
 * Anders als bei den massiven Bauteilen stehen hier **Regelmaße** und nicht
 * Arten zur Wahl — dieselbe Bauform wie beim Öffnungskatalog, und aus
 * demselben Grund: bei einer Kernbohrung entscheidet nicht die Art, sondern
 * die Bohrkrone. „Kernbohrung" allein sagt nichts; „Ø 152 (DN 100)" sagt alles.
 *
 * Gruppiert wird nach Art, damit die Liste bei vierzehn Einträgen noch
 * lesbar bleibt.
 */
function DurchbruchBar() {
  const preset = useBimStore((s) => s.durchbruchPreset);
  const setPreset = useBimStore((s) => s.setDurchbruchPreset);
  const arten: DurchbruchKind[] = ['kernbohrung', 'wanddurchbruch', 'schlitz', 'deckendurchbruch'];

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className="label-xs shrink-0">Durchbruch</span>
      {/*
        Vierzehn Regelmaße sind zu viele für eine Reihe. Bis 1.23.0 bekam das
        Feld deshalb eine Breitengrenze und rollte darin für sich — der Kopf
        blieb schmal, aber zehn der vierzehn Maße lagen außerhalb des Bildes,
        und gesucht hat sie dort niemand.

        Jetzt bricht die Reihe um: die vier Gruppen (Kernbohrung, Wand-
        durchbruch, Schlitz, Deckendurchbruch) rutschen untereinander, sobald
        die Breite nicht reicht. Die Gruppen selbst bleiben `shrink-0`, damit
        eine Gruppe nicht mitten in den Maßen auseinandergerissen wird.
      */}
      <div className="flex min-w-0 flex-wrap gap-1.5">
        {arten.map((art) => {
          const masse = DURCHBRUCH_PRESETS.filter((v) => v.kind === art);
          if (!masse.length) return null;
          return (
            <div key={art} className="flex shrink-0 gap-0.5 rounded-lg bg-graphite-900/60 p-0.5">
              {masse.map((v) => (
                <button
                  key={v.id}
                  onClick={() => setPreset(v)}
                  title={v.label}
                  className={`chip whitespace-nowrap ${
                    preset.id === v.id ? 'bg-accent/15 text-accent' : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {kurzmass(v)}
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Das Maß als Knopfbeschriftung.
 *
 * Auf dem Knopf steht das Maß und nicht der Name: „Ø 152" ist in einer Reihe
 * von sieben Bohrkronen unterscheidbar, „Kernbohrung" siebenmal nicht. Der
 * vollständige Name steht im Tooltip.
 */
function kurzmass(v: DurchbruchPreset): string {
  if (v.form === 'rund') return `Ø ${Math.round((v.diameter ?? 0) * 1000)}`;
  return `${Math.round((v.width ?? 0) * 1000)}×${Math.round((v.height ?? 0) * 1000)}`;
}

/** Art der Beschriftung: Maßkette, Text oder Hinweisfahne. */
function AnnotationKindBar() {
  const kind = useBimStore((s) => s.annotationKind);
  const setKind = useBimStore((s) => s.setAnnotationKind);
  const kinds: AnnotationKind[] = ['dimension', 'text', 'leader'];

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className="label-xs shrink-0">Beschriftung</span>
      {/* Wie die übrigen Kontextleisten umbrechend — siehe `OpeningTypeBar`. */}
      <div className="flex min-w-0 flex-wrap gap-0.5 rounded-lg bg-graphite-900/60 p-0.5">
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
