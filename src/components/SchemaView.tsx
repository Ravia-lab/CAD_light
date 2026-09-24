/**
 * SchemaView — das Anlagenschema als Zeichnung.
 * ---------------------------------------------------------------------------
 * Ein Grundriss sagt, wo etwas steht. Ein Anlagenschema sagt, woran es hängt.
 * Beides in ein Bild zu zwingen ist der Fehler, den viele Werkzeuge machen:
 * die Leitungsführung im Technikraum ist für die Hydraulik belanglos, und die
 * Reihenfolge der Armaturen lässt sich im Grundriss nicht ablesen.
 *
 * Deshalb eine eigene Ansicht, auf einem eigenen Raster. Die Bauteile kommen
 * aus `plant.schematic`; erzeugt werden sie im Anlagenblatt. Gezeichnet wird
 * mit den Symbolen nach DIN EN ISO 14617 aus `schematicSymbols.ts`.
 *
 * Leitungen laufen **rechtwinklig**: senkrecht aus dem Bauteil heraus, dann
 * waagerecht, dann wieder senkrecht hinein. Diagonalen wären kürzer und in
 * einem Schema falsch — ein Fließbild liest man an den Ecken.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PipeService, SchematicComponent, SchematicKind, SchematicLink, Vec2 } from '../types/bim';
import { PIPE_SERVICE_COLORS, PIPE_SERVICE_LABELS } from '../types/bim';
import { useBimStore } from '../store/useBimStore';
import type { SchemaBeschriftungsart } from '../lib/schemaBeschriftung';
import { SCHEMATIC_LEGEND, drawSymbol, hitTestSymbol } from '../lib/schematicSymbols';
import { leitungsverlauf } from '../lib/schemaLeitung';
import { uebersichtsschema } from '../lib/schemaUebersicht';
import { UEBERSICHT_MASSE, zeichneUebersicht } from '../lib/uebersichtZeichnen';
import {
  buildComponentTable,
  buildSchematicSvg,
  componentTableCsv,
  printSchematic,
  type SchematicOrientation,
  type SchematicPaperFormat,
} from '../lib/schematicPrint';

/** Rasterweite des Schemas [px bei Maßstab 1]. */
const GRID = 74;
/** Symbolgröße [px bei Maßstab 1]. */
const SIZE = 34;

/**
 * Was sich von Hand einfügen lässt.
 *
 * Bewusst nicht alle Symbolarten: Erzeuger, Speicher und Verteiler kommen aus
 * der Auslegung und gehören dort geändert, nicht im Bild. Von Hand ergänzt
 * werden Armaturen und Messstellen — das, was auf der Baustelle dazukommt.
 */
const INSERTABLE: SchematicKind[] = [
  'shutoff',
  'valve-2way',
  'valve-3way',
  'check-valve',
  'balancing-valve',
  'overflow-valve',
  'strainer',
  'dirt-separator',
  'air-separator',
  'pressure-gauge',
  'thermometer',
  'sensor',
  // Beide gehören zu dem, was auf der Baustelle dazukommt: der
  // Temperaturwächter an jeden ungemischten Flächenheizkreis, der
  // Volumenstromwächter überall dort, wo Glykol im Spiel ist.
  'temperature-limiter',
  'flow-switch',
  'pump',
  'circulation-pump',
  'heat-meter',
  'water-meter',
  'filling-valve',
  'backflow-preventer',
  'electric-heater',
  'boiler',
  'solar',
  'radiator',
  'manifold',
  'node',
];

const LINE = '#94A3B8';
const PAPER = '#0E1116';

export default function SchemaView({ className = '' }: { className?: string }) {
  const plant = useBimStore((s) => s.doc.plant);
  const projectName = useBimStore((s) => s.doc.meta.name);
  const moveComponent = useBimStore((s) => s.updateSchematicComponent);
  const addComponent = useBimStore((s) => s.addSchematicComponent);
  const removeComponent = useBimStore((s) => s.deleteSchematicComponent);
  const addLink = useBimStore((s) => s.addSchematicLink);
  const removeLink = useBimStore((s) => s.deleteSchematicLink);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const sizeRef = useRef({ w: 0, h: 0 });
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });
  const [selected, setSelected] = useState<string | null>(null);
  const panRef = useRef<{ x: number; y: number } | null>(null);
  const [showLegend, setShowLegend] = useState(true);
  const [printOpen, setPrintOpen] = useState(false);
  const [paper, setPaper] = useState<{ format: SchematicPaperFormat; orientation: SchematicOrientation }>({
    format: 'A3',
    orientation: 'landscape',
  });
  const [printColour, setPrintColour] = useState(true);
  const [printTable, setPrintTable] = useState(true);
  /**
   * Was ein Klick auf ein Bauteil bedeutet.
   *
   * Ein Werkzeugmodus statt eines Zusatzknopfes an jedem Bauteil: das Schema
   * ist eng, und ein Kontextmenü an einem 34 Pixel großen Symbol trifft
   * niemand zuverlässig.
   */
  const [mode, setMode] = useState<'auswahl' | 'verbinden' | 'einfuegen'>('auswahl');
  /**
   * Welches der beiden Bilder auf dem Schirm steht.
   *
   * **Die Übersicht ist der Regelfall** — sie ist das, was der Monteur liest.
   * Die Ausführung ist das vollständige Fließbild; sie wird gebraucht, wenn
   * jemand das Schema *bearbeitet*, denn Armaturen von Hand einfügen,
   * verbinden und löschen geht nur dort. Die Übersicht wird abgeleitet und
   * lässt sich deshalb nicht bearbeiten — was man in ihr ändern wollte,
   * ändert man in der Ausführung, und sie folgt.
   */
  const [ansicht, setAnsicht] = useState<'uebersicht' | 'ausfuehrung'>('uebersicht');
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const [linkService, setLinkService] = useState<PipeService>('heating-flow');
  const [insertKind, setInsertKind] = useState<SchematicKind>('shutoff');
  /** Läuft gerade ein Verschieben? Dann ist der Zeiger gefangen. */
  const dragRef = useRef<{ id: string; dx: number; dy: number; moved: boolean } | null>(null);

  const components = useMemo(() => Object.values(plant.schematic.components), [plant.schematic.components]);
  const links = useMemo(() => Object.values(plant.schematic.links), [plant.schematic.links]);
  const byId = useMemo(() => new Map(components.map((c) => [c.id, c])), [components]);
  const uebersicht = useMemo(() => uebersichtsschema(components, links), [components, links]);

  /** Ausdehnung des Schemas im Raster — daraus folgt die Einpassung. */
  const extent = useMemo(() => {
    const quelle: { x: number; y: number }[] = ansicht === 'uebersicht' ? uebersicht.bauteile : components;
    if (!quelle.length) return null;
    const xs = quelle.map((c) => c.x);
    const ys = quelle.map((c) => c.y);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  }, [ansicht, components, uebersicht]);

  const fit = useCallback((): boolean => {
    const { w, h } = sizeRef.current;
    // Solange der ResizeObserver die Fläche noch nicht gemeldet hat, ist
    // jede Einpassung eine Division durch null. Der Aufrufer erfährt das am
    // Rückgabewert und versucht es beim nächsten Messwert erneut — sonst
    // bleibt das Schema für immer im Ausgangszustand stehen.
    if (!extent || !w || !h) return false;
    // Rand von zwei Rasterfeldern: die Beschriftungen ragen über die Symbole
    // hinaus, und ein „Monoblock Luft/Wasser R290 6 kW" am linken Rand wäre
    // sonst angeschnitten.
    const raster = ansicht === 'uebersicht' ? UEBERSICHT_MASSE.grid : GRID;
    /*
     * Rand um das Bild. In der Übersicht größer: Über dem Bild liegen die
     * Umschaltleiste und die Leitungslegende, unter ihm der Hinweissatz. Mit
     * dem knappen Rand der Ausführung verschwand die Fußbodenheizung hinter
     * der Legende — sichtbar ist sie damit nur, wer scrollt.
     */
    const luftX = ansicht === 'uebersicht' ? 6 : 4;
    const luftY = ansicht === 'uebersicht' ? 6 : 3;
    const spanX = (extent.maxX - extent.minX + luftX) * raster;
    const spanY = (extent.maxY - extent.minY + luftY) * raster;
    const zoom = Math.min(w / spanX, h / spanY, 1.4);
    /*
     * In der Übersicht rückt das Bild um einen Rasterschritt nach oben.
     *
     * Unten liegt der Hinweissatz über der Zeichenfläche, oben ist der Rand
     * frei. Mittig eingepasst verschwand deshalb der Trinkwasserspeicher
     * hinter dem Hinweis — ausgerechnet das unterste Bauteil des Bildes.
     */
    const mitteY = (extent.minY + extent.maxY) / 2 + (ansicht === 'uebersicht' ? 1 : 0);
    setView({
      zoom,
      x: w / 2 - ((extent.minX + extent.maxX) / 2) * raster * zoom,
      y: h / 2 - mitteY * raster * zoom,
    });
    return true;
  }, [ansicht, extent]);

  // Der Einpassvorgang wird über eine Referenz erreichbar gehalten, damit der
  // ResizeObserver ihn aufrufen kann, ohne selbst neu aufgesetzt zu werden.
  const fitRef = useRef(fit);
  fitRef.current = fit;
  const fittedRef = useRef(false);

  // Größe verfolgen und beim ersten Aufbau einpassen.
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect();
      sizeRef.current = { w: rect.width, h: rect.height };
      const canvas = canvasRef.current;
      if (canvas) {
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.round(rect.width * dpr);
        canvas.height = Math.round(rect.height * dpr);
        canvas.style.width = `${rect.width}px`;
        canvas.style.height = `${rect.height}px`;
      }
      if (!fittedRef.current && fitRef.current()) fittedRef.current = true;
      render();
    });
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (fittedRef.current || !components.length) return;
    const id = requestAnimationFrame(() => {
      if (fit()) fittedRef.current = true;
    });
    return () => cancelAnimationFrame(id);
  }, [components.length, fit]);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const { w, h } = sizeRef.current;
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, w, h);

    ctx.translate(view.x, view.y);
    ctx.scale(view.zoom, view.zoom);

    if (ansicht === 'uebersicht') {
      zeichneUebersicht(ctx, uebersicht, {
        papier: PAPER,
        strich: LINE,
        rahmen: '#64748B',
      });
      ctx.restore();
      return;
    }

    // --- Leitungen zuerst, damit die Symbole darüber freistellen ----------
    for (const link of links) {
      const a = byId.get(link.from);
      const b = byId.get(link.to);
      if (!a || !b) continue;
      drawLink(ctx, a, b, link, links.indexOf(link));
    }

    // --- Symbole ----------------------------------------------------------
    for (const c of components) {
      const x = c.x * GRID;
      const y = c.y * GRID;
      if (c.id === linkFrom) {
        // Der gewählte Ausgangspunkt einer Verbindung bekommt einen eigenen,
        // deutlich anderen Rahmen — sonst weiß man nach dem ersten Klick
        // nicht, ob er gesessen hat.
        ctx.save();
        ctx.strokeStyle = '#4ADE80';
        ctx.lineWidth = 2 / view.zoom;
        ctx.strokeRect(x - SIZE * 0.95, y - SIZE * 0.95, SIZE * 1.9, SIZE * 1.9);
        ctx.restore();
      }
      if (c.id === selected) {
        ctx.save();
        ctx.strokeStyle = '#7DD3FC';
        ctx.lineWidth = 1.5 / view.zoom;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(x - SIZE * 0.85, y - SIZE * 0.85, SIZE * 1.7, SIZE * 1.7);
        ctx.restore();
      }
      drawSymbol(ctx, c.kind, x, y, SIZE, {
        color: c.id === selected ? '#E2E8F0' : LINE,
        background: PAPER,
        label: c.label,
        spec: c.spec ?? null,
        lineWidth: 1.3,
      });
    }

    ctx.restore();
  }, [ansicht, byId, components, linkFrom, links, selected, uebersicht, view]);

  useEffect(() => {
    render();
  }, [render]);

  // -------------------------------------------------------------------------
  // Bedienung
  // -------------------------------------------------------------------------

  const toWorld = (screen: Vec2): Vec2 => ({
    x: (screen.x - view.x) / view.zoom,
    y: (screen.y - view.y) / view.zoom,
  });

  /** Rasterplatz aus einem Weltpunkt — halbe Felder, damit Enges noch passt. */
  const toCell = (world: Vec2) => ({
    x: Math.round((world.x / GRID) * 2) / 2,
    y: Math.round((world.y / GRID) * 2) / 2,
  });

  const componentAt = (world: Vec2) =>
    components.find((c) => hitTestSymbol(c.kind, SIZE, { x: world.x - c.x * GRID, y: world.y - c.y * GRID }, 4));

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    if (e.button === 1 || e.button === 2) {
      panRef.current = screen;
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    /*
     * In der Übersicht wird **nicht** bearbeitet, nur geschoben.
     *
     * Sie ist abgeleitet: Ein hier verschobenes Symbol wäre beim nächsten
     * Erzeugen wieder an seinem Platz, und ein hier gelöschtes stünde weiter
     * im Ausführungsschema. Ein Bild, das Änderungen annimmt und dann
     * vergisst, ist schlimmer als eines, das sie ablehnt.
     */
    if (ansicht === 'uebersicht') {
      panRef.current = screen;
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    const world = toWorld(screen);
    const hit = componentAt(world);

    if (mode === 'einfuegen') {
      const cell = toCell(world);
      const created = addComponent(insertKind, cell.x, cell.y);
      setSelected(created.id);
      setMode('auswahl');
      return;
    }

    if (mode === 'verbinden') {
      if (!hit) {
        setLinkFrom(null);
        return;
      }
      if (!linkFrom) {
        setLinkFrom(hit.id);
        setSelected(hit.id);
        return;
      }
      addLink(linkFrom, hit.id, linkService);
      setLinkFrom(null);
      setSelected(hit.id);
      return;
    }

    if (hit) {
      setSelected(hit.id);
      // Verschieben beginnt sofort; ob es eines wird, entscheidet erst die
      // Bewegung. Ein Klick ohne Bewegung bleibt eine reine Auswahl.
      dragRef.current = { id: hit.id, dx: world.x - hit.x * GRID, dy: world.y - hit.y * GRID, moved: false };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    setSelected(null);
    panRef.current = screen;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };

    const drag = dragRef.current;
    if (drag) {
      const world = toWorld(screen);
      const cell = toCell({ x: world.x - drag.dx, y: world.y - drag.dy });
      const current = byId.get(drag.id);
      if (current && (current.x !== cell.x || current.y !== cell.y)) {
        drag.moved = true;
        moveComponent(drag.id, cell);
      }
      return;
    }

    if (!panRef.current) return;
    setView((v) => ({ ...v, x: v.x + (screen.x - panRef.current!.x), y: v.y + (screen.y - panRef.current!.y) }));
    panRef.current = screen;
  };

  const onPointerUp = () => {
    panRef.current = null;
    dragRef.current = null;
  };

  // Tastatur: Entfernen löscht das gefasste Bauteil, Esc bricht das
  // Verbinden ab. Beides nur, solange die Ansicht den Fokus hat.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.isContentEditable)) return;
      // Rückgängig gehört in jede Ansicht, in der man etwas ändern kann.
      // Der Grundriss-Editor bringt es mit — er ist hier aber gar nicht
      // eingehängt, und ohne diese Zeilen wäre ein gelöschtes Bauteil
      // endgültig weg.
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        const store = useBimStore.getState();
        if (e.shiftKey) store.redo();
        else store.undo();
        setSelected(null);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        useBimStore.getState().redo();
        setSelected(null);
        return;
      }
      if (e.key === 'Escape') {
        setLinkFrom(null);
        setMode('auswahl');
        setSelected(null);
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
        e.preventDefault();
        removeComponent(selected);
        setSelected(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [removeComponent, selected]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      setView((v) => {
        const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
        const zoom = Math.min(4, Math.max(0.2, v.zoom * factor));
        // Der Punkt unter dem Zeiger bleibt stehen — sonst wandert das
        // Schema beim Zoomen aus dem Bild.
        return { zoom, x: sx - ((sx - v.x) / v.zoom) * zoom, y: sy - ((sy - v.y) / v.zoom) * zoom };
      });
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, []);

  const selectedComponent = selected ? byId.get(selected) : undefined;
  const connectedLinks = useMemo(
    () => (selected ? links.filter((l) => l.from === selected || l.to === selected) : []),
    [links, selected],
  );

  /** Das Schema als PNG sichern — für den Anhang zum Angebot. */
  const savePng = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `${projectName.replace(/[^\wäöüÄÖÜß -]/g, '_')} — Anlagenschema.png`;
    a.click();
  };

  return (
    <div ref={wrapRef} className={`relative h-full w-full overflow-hidden ${className}`}>
      <canvas
        ref={canvasRef}
        className="touch-none"
        style={{ cursor: panRef.current ? 'grabbing' : 'default' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onContextMenu={(e) => e.preventDefault()}
      />

      {/* Welches Bild — die Übersicht ist der Regelfall */}
      {components.length > 0 && (
        <div className="panel absolute left-3 top-11 flex items-center gap-1 px-2.5 py-1.5">
          {(
            [
              ['uebersicht', 'Übersicht', 'Das Prinzipbild: Erzeugung, Speicherung, Übergabe'],
              ['ausfuehrung', 'Ausführung', 'Das vollständige Fließbild — hier wird bearbeitet'],
            ] as const
          ).map(([id, label, hint]) => (
            <button
              key={id}
              title={hint}
              className={`chip whitespace-nowrap ${
                ansicht === id ? 'bg-accent/15 text-accent' : 'bg-white/[0.05] text-slate-300 hover:bg-white/[0.1]'
              }`}
              onClick={() => {
                setAnsicht(id);
                setSelected(null);
                setLinkFrom(null);
                setMode('auswahl');
                fittedRef.current = false;
              }}
            >
              {label}
            </button>
          ))}
          {ansicht === 'uebersicht' && (
            <span className="ml-1 text-[10px] text-slate-500">
              {uebersicht.bauteile.filter((b) => b.kind !== 'node').length} von {uebersicht.vollstaendig} Bauteilen
            </span>
          )}
        </div>
      )}

      {/* Der Satz gehört zum Bild, nicht zur Oberfläche */}
      {ansicht === 'uebersicht' && components.length > 0 && (
        <div className="panel pointer-events-none absolute bottom-3 left-3 right-14 px-3 py-2">
          <p className="text-[10px] leading-relaxed text-slate-400">{uebersicht.hinweis}</p>
        </div>
      )}

      {components.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="panel pointer-events-auto max-w-[26rem] px-4 py-3 text-center">
            <p className="text-[12px] text-slate-300">Noch kein Anlagenschema</p>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
              Im Reiter „Anlage“ das Gerät wählen und auf „Schema erzeugen“ klicken. Das Schema entsteht aus der
              Auslegung — Erzeuger, Speicher, Sicherheitsarmaturen und Heizkreise stehen dann mit ihren Kennwerten
              darin.
            </p>
          </div>
        </div>
      )}

      {/* Legende der Leitungsarten */}
      {showLegend && components.length > 0 && (
        /*
         * In der Übersicht sitzt sie **unten links**. Oben rechts steht der
         * letzte Verbraucherzweig, unten rechts der Trinkwasserzweig — an
         * beiden Stellen verdeckte sie eine Beschriftung. Unten links ist in
         * diesem Bildaufbau nur Rücklauf, und der trägt keine Schrift.
         */
        <div
          className={`panel absolute max-w-[15rem] px-2.5 py-2 ${
            ansicht === 'uebersicht' ? 'bottom-[5.5rem] left-3' : 'top-3 right-3'
          }`}
        >
          <div className="mb-1 flex items-baseline justify-between">
            <span className="label-xs pr-3">Leitungen</span>
            <button className="text-[10px] text-slate-600 hover:text-slate-300" onClick={() => setShowLegend(false)}>
              ausblenden
            </button>
          </div>
          {usedServices(links).map((s) => (
            <div key={s} className="flex items-center gap-2 py-0.5">
              <span className="h-0.5 w-5 shrink-0 rounded" style={{ background: PIPE_SERVICE_COLORS[s] }} />
              <span className="text-[10px] text-slate-400">{PIPE_SERVICE_LABELS[s]}</span>
            </div>
          ))}
        </div>
      )}

      {/* Bearbeitungsleiste — nur dort, wo bearbeitet wird */}
      {components.length > 0 && ansicht === 'ausfuehrung' && (
        <div className="panel absolute left-3 top-[5.25rem] flex flex-col gap-2 px-2.5 py-2">
          <div className="flex items-center gap-1">
            <span className="label-xs mr-1 shrink-0">Bearbeiten</span>
            {(
              [
                ['auswahl', 'Auswählen', 'Anklicken, verschieben, mit Entf löschen'],
                ['verbinden', 'Verbinden', 'Erst das eine Bauteil anklicken, dann das andere'],
                ['einfuegen', 'Einfügen', 'Bauteil wählen und in das Schema klicken'],
              ] as const
            ).map(([id, label, hint]) => (
              <button
                key={id}
                title={hint}
                className={`chip whitespace-nowrap ${
                  mode === id ? 'bg-accent/15 text-accent' : 'bg-white/[0.05] text-slate-300 hover:bg-white/[0.1]'
                }`}
                onClick={() => {
                  setMode(id);
                  setLinkFrom(null);
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {mode === 'verbinden' && (
            <div className="flex items-center gap-2">
              <select
                className="field h-7 py-0 text-[11px]"
                value={linkService}
                onChange={(e) => setLinkService(e.target.value as PipeService)}
              >
                {(Object.keys(PIPE_SERVICE_LABELS) as PipeService[]).map((k) => (
                  <option key={k} value={k} className="bg-graphite-850">
                    {PIPE_SERVICE_LABELS[k]}
                  </option>
                ))}
              </select>
              <span className="text-[10px] text-slate-500">
                {linkFrom ? 'Ziel anklicken' : 'Ausgangspunkt anklicken'}
              </span>
            </div>
          )}

          {mode === 'einfuegen' && (
            <select
              className="field h-7 py-0 text-[11px]"
              value={insertKind}
              onChange={(e) => setInsertKind(e.target.value as SchematicKind)}
            >
              {INSERTABLE.map((k) => (
                <option key={k} value={k} className="bg-graphite-850">
                  {SCHEMATIC_LEGEND[k].name}
                </option>
              ))}
            </select>
          )}

          {plant.schematic.manual && (
            <p className="max-w-[16rem] text-[10px] leading-snug text-amber-200/80">
              Von Hand bearbeitet. „Schema neu erzeugen" im Reiter „Anlage" verwirft diese Änderungen.
            </p>
          )}
        </div>
      )}

      {/* Erklärung und Bearbeitung des angeklickten Bauteils */}
      {selectedComponent && (
        <div className="panel absolute bottom-3 left-3 max-w-[26rem] px-3 py-2">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[12px] text-slate-200">{SCHEMATIC_LEGEND[selectedComponent.kind].name}</span>
            <span className="shrink-0 text-[10px] text-slate-600">
              {selectedComponent.generated ? 'erzeugt' : 'von Hand'}
            </span>
          </div>
          <p className="mt-1 text-[10.5px] leading-relaxed text-slate-500">
            {SCHEMATIC_LEGEND[selectedComponent.kind].description}
          </p>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            <input
              className="field h-7 py-0 text-[11px]"
              value={selectedComponent.label}
              title="Beschriftung über dem Symbol"
              onChange={(e) => moveComponent(selectedComponent.id, { label: e.target.value })}
            />
            <input
              className="field h-7 py-0 text-[11px]"
              value={selectedComponent.spec ?? ''}
              placeholder="z. B. DN 25"
              title="Technische Angabe unter dem Symbol"
              onChange={(e) => moveComponent(selectedComponent.id, { spec: e.target.value })}
            />
          </div>
          <div className="mt-1.5 flex items-center gap-1.5">
            <button
              className="chip bg-white/[0.05] text-slate-300 hover:bg-white/[0.1]"
              onClick={() => {
                removeComponent(selectedComponent.id);
                setSelected(null);
              }}
            >
              Bauteil löschen
            </button>
            {connectedLinks.length > 0 && (
              <span className="text-[10px] text-slate-500">
                {connectedLinks.length} Verbindung{connectedLinks.length === 1 ? '' : 'en'}
              </span>
            )}
          </div>
          {connectedLinks.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {connectedLinks.map((l) => (
                <button
                  key={l.id}
                  className="chip bg-white/[0.03] text-[10px] text-slate-400 hover:bg-rose-400/15 hover:text-rose-200"
                  title="Diese Verbindung entfernen"
                  onClick={() => removeLink(l.id)}
                >
                  {PIPE_SERVICE_LABELS[l.service]} →{' '}
                  {byId.get(l.from === selectedComponent.id ? l.to : l.from)?.label ?? '?'} ✕
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {printOpen && (
        <SchematicPrintDialog
          components={components}
          links={links}
          projectName={projectName}
          paper={paper}
          onPaper={setPaper}
          colour={printColour}
          onColour={setPrintColour}
          table={printTable}
          onTable={setPrintTable}
          onClose={() => setPrintOpen(false)}
        />
      )}

      {/* Bedienelemente */}
      <div className="panel absolute bottom-3 right-3 flex flex-col overflow-hidden p-0.5">
        <button className="tool-btn h-7 w-7 text-base leading-none" title="Vergrößern" onClick={() => setView((v) => ({ ...v, zoom: Math.min(4, v.zoom * 1.25) }))}>
          +
        </button>
        <button className="tool-btn h-7 w-7 text-base leading-none" title="Verkleinern" onClick={() => setView((v) => ({ ...v, zoom: Math.max(0.2, v.zoom / 1.25) }))}>
          −
        </button>
        <div className="mx-auto my-0.5 h-px w-4 bg-white/[0.08]" />
        <button className="tool-btn h-7 w-7 text-[10px]" title="Einpassen" onClick={fit}>
          ⤢
        </button>
        <button className="tool-btn h-7 w-7 text-[10px]" title="Als Bild sichern" onClick={savePng}>
          ⤓
        </button>
        <button
          className="tool-btn h-7 w-7 text-[10px]"
          title="Maßstäblich drucken oder als PDF sichern"
          onClick={() => setPrintOpen(true)}
        >
          ⎙
        </button>
      </div>
    </div>
  );
}

/** Welche Leitungsarten kommen im Schema überhaupt vor? */
function usedServices(links: SchematicLink[]): PipeService[] {
  const set = new Set<PipeService>();
  for (const l of links) set.add(l.service);
  return [...set];
}

/**
 * Eine Verbindung rechtwinklig zeichnen.
 *
 * Gewählt werden die beiden Anschlüsse, die einander am nächsten liegen —
 * damit läuft die Leitung nicht quer durch das Symbol, aus dem sie kommt.
 * Die Führung ist dreiteilig: heraus, quer, hinein. Liegt beides auf einer
 * Achse, bleibt die Leitung gerade.
 */
function drawLink(
  ctx: CanvasRenderingContext2D,
  a: SchematicComponent,
  b: SchematicComponent,
  link: SchematicLink,
  index: number,
): void {
  // Wo die Leitung langläuft, rechnet `schemaLeitung` — dieselbe Routine,
  // die auch die Übersicht benutzt. Hier wird nur noch gemalt.
  const verlauf = leitungsverlauf(a, b, link, { grid: GRID, size: SIZE });
  if (!verlauf) return;

  ctx.save();
  ctx.strokeStyle = PIPE_SERVICE_COLORS[link.service];
  ctx.lineWidth = 1.6;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  verlauf.punkte.forEach((pt, i) => (i === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y)));
  ctx.stroke();

  drawArrow(ctx, verlauf.pfeil.at, verlauf.pfeil.winkel);

  if (link.label) {
    // Beschriftungen wandern abwechselnd auf ein Drittel und zwei Drittel
    // des Zwischenstücks. Sitzen sie alle in der Mitte, überschreiben sich
    // an jeder Kreuzung zwei Texte — genau dort, wo das Schema ohnehin am
    // dichtesten ist.
    const t = index % 2 === 0 ? 0.32 : 0.68;
    const { von, bis } = verlauf.zwischenstueck;
    const at = verlauf.waagerechtZuerst
      ? { x: von.x + (bis.x - von.x) * t, y: von.y }
      : { x: von.x, y: von.y + (bis.y - von.y) * t };
    ctx.font = '10px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    // Freistellen: die Beschriftung liegt fast immer über einer Leitung, und
    // Text auf Strich ist in einem Schema die häufigste Unleserlichkeit.
    const w = ctx.measureText(link.label).width;
    ctx.fillStyle = PAPER;
    ctx.fillRect(at.x - w / 2 - 2, at.y - 15, w + 4, 11);
    ctx.fillStyle = PIPE_SERVICE_COLORS[link.service];
    ctx.fillText(link.label, at.x, at.y - 5);
  }
  ctx.restore();
}

function drawArrow(ctx: CanvasRenderingContext2D, at: { x: number; y: number }, angle: number): void {
  const s = 5;
  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(-s, -s * 0.6);
  ctx.lineTo(s * 0.6, 0);
  ctx.lineTo(-s, s * 0.6);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Druckdialog
// ---------------------------------------------------------------------------

/**
 * Blattformat wählen, Vorschau der Einpassung, drucken.
 *
 * Der Maßstab wird nicht abgefragt, sondern eingepasst — bei einem Schema
 * gibt es keinen Grund, ihn vorzugeben: es ist kein Bauplan, aus dem jemand
 * Maße abgreift. Angezeigt wird er trotzdem, denn er steht auch im
 * Schriftfeld.
 */
function SchematicPrintDialog({
  components,
  links,
  projectName,
  paper,
  onPaper,
  colour,
  onColour,
  table,
  onTable,
  onClose,
}: {
  components: SchematicComponent[];
  links: SchematicLink[];
  projectName: string;
  paper: { format: SchematicPaperFormat; orientation: SchematicOrientation };
  onPaper: (p: { format: SchematicPaperFormat; orientation: SchematicOrientation }) => void;
  colour: boolean;
  onColour: (v: boolean) => void;
  table: boolean;
  onTable: (v: boolean) => void;
  onClose: () => void;
}) {
  // Das Datum kommt von hier, nicht aus dem Rechenmodul — dort ist keine Uhr.
  const today = new Date().toLocaleDateString('de-DE');

  // Die Beschriftungsart bleibt beim Dialog: sie gehört zu diesem Ausdruck,
  // nicht zum Modell. Vorgabe ist die Messung („automatisch"), weil sie in
  // fast allen Fällen richtig entscheidet — wer es anders will, sieht sofort,
  // was es kostet.
  const [labelMode, setLabelMode] = useState<SchemaBeschriftungsart>('auto');

  const result = useMemo(
    () =>
      buildSchematicSvg(components, links, {
        format: paper.format,
        orientation: paper.orientation,
        projectName,
        plantName: 'Wärmepumpenanlage',
        author: 'RaVia CAD Light',
        date: today,
        scale: 'auto',
        showLegend: true,
        colour,
        componentTable: table,
        labelMode,
      }),
    [colour, components, labelMode, links, paper, projectName, table, today],
  );

  const rows = useMemo(() => buildComponentTable(components), [components]);

  const saveCsv = () => {
    const blob = new Blob(['\ufeff' + componentTableCsv(rows)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${projectName.replace(/[^\wäöüÄÖÜß -]/g, '_')} — Stückliste.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="panel w-[24rem] p-4" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-baseline justify-between">
          <span className="text-[13px] text-slate-200">Anlagenschema drucken</span>
          <button className="text-[11px] text-slate-500 hover:text-slate-300" onClick={onClose}>
            schließen
          </button>
        </div>

        <div className="space-y-2">
          <div>
            <span className="label-xs">Blattformat</span>
            <div className="mt-1 flex gap-1">
              {(['A4', 'A3', 'A2'] as SchematicPaperFormat[]).map((f) => (
                <button
                  key={f}
                  className={`chip flex-1 ${
                    paper.format === f ? 'bg-accent/15 text-accent' : 'bg-white/[0.05] text-slate-300 hover:bg-white/[0.1]'
                  }`}
                  onClick={() => onPaper({ ...paper, format: f })}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="label-xs">Ausrichtung</span>
            <div className="mt-1 flex gap-1">
              {(
                [
                  ['landscape', 'quer'],
                  ['portrait', 'hoch'],
                ] as [SchematicOrientation, string][]
              ).map(([id, label]) => (
                <button
                  key={id}
                  className={`chip flex-1 ${
                    paper.orientation === id
                      ? 'bg-accent/15 text-accent'
                      : 'bg-white/[0.05] text-slate-300 hover:bg-white/[0.1]'
                  }`}
                  onClick={() => onPaper({ ...paper, orientation: id })}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="label-xs">Bauteile benennen</span>
            <div className="mt-1 flex gap-1">
              {(
                [
                  ['auto', 'automatisch'],
                  ['position', 'Nummern'],
                  ['name', 'Namen'],
                ] as [SchemaBeschriftungsart, string][]
              ).map(([id, label]) => (
                <button
                  key={id}
                  title={
                    id === 'auto'
                      ? 'Namen ans Symbol, solange sie sich nicht überdecken — sonst Positionsnummern.'
                      : id === 'position'
                        ? 'Nummer ans Symbol, Name ins Positionsblatt. Bei kleinem Maßstab die einzige lesbare Darstellung.'
                        : 'Namen ans Symbol, auch wenn sie sich überdecken.'
                  }
                  className={`chip flex-1 ${
                    labelMode === id ? 'bg-accent/15 text-accent' : 'bg-white/[0.05] text-slate-300 hover:bg-white/[0.1]'
                  }`}
                  onClick={() => setLabelMode(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            {result.labelMode === 'name' && result.labelCollisions > 0 && (
              <div className="mt-1 text-[10.5px] leading-snug text-rose-300">
                {result.labelCollisions} Bauteilnamen überdecken einander. Mit „Nummern" steht jeder Name lesbar im
                Positionsblatt.
              </div>
            )}
          </div>

          <label className="flex items-center gap-2 text-[11px] text-slate-400">
            <input type="checkbox" checked={colour} onChange={(e) => onColour(e.target.checked)} />
            Leitungen farbig
            <span className="text-slate-600">— sonst Stricharten für den Schwarzweißdruck</span>
          </label>

          <label className="flex items-center gap-2 text-[11px] text-slate-400">
            <input
              type="checkbox"
              checked={table}
              disabled={result.labelMode === 'position'}
              onChange={(e) => onTable(e.target.checked)}
            />
            Stückliste anhängen
            {result.labelMode === 'position' && (
              <span className="text-slate-600">— steckt schon im Positionsblatt</span>
            )}
          </label>

          <div className="rounded-lg bg-graphite-900/60 px-2.5 py-2 text-[10.5px] leading-relaxed text-slate-400">
            Maßstab 1:{result.scale} · {result.sheets.length} Blatt · {rows.length} Positionen
            {result.notes.map((n, i) => (
              <div key={i} className="mt-1 text-amber-200/80">
                {n}
              </div>
            ))}
            {!result.fits && (
              <div className="mt-1 text-rose-300">
                Passt in diesem Format nicht — nötig wäre mindestens 1:{result.suggestedScale}.
              </div>
            )}
          </div>

          <div className="flex gap-1.5">
            <button
              className="chip flex-1 bg-accent/12 text-accent hover:bg-accent/20"
              onClick={() => {
                printSchematic(result, projectName);
                onClose();
              }}
            >
              Drucken / als PDF
            </button>
            <button className="chip bg-white/[0.05] text-slate-300 hover:bg-white/[0.1]" onClick={saveCsv}>
              Stückliste als CSV
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
