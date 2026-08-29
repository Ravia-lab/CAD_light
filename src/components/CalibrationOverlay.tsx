/**
 * CalibrationOverlay — interaktives 2-Punkt-Maßband.
 * ---------------------------------------------------------------------------
 * Bewusst als eigene Ereignis- und Render-Ebene über dem Canvas:
 *
 *  • Der Canvas-Renderpfad bleibt frei von Sonderfällen — im Kalibriermodus
 *    liegt einfach ein SVG darüber, das die Pointer-Events abfängt.
 *  • SVG statt Canvas, weil das Maßband wenige Elemente hat, dafür aber
 *    gestochen scharfe Beschriftung und einen echten Eingabe-Fokus braucht.
 *  • Ist das Werkzeug nicht aktiv, rendert die Komponente `null` — null
 *    Kosten im normalen Zeichenbetrieb.
 *
 * Ergebnis der Kalibrierung ist der Pixels-per-Meter-Faktor:
 *     ppm = gezogene Bildpixel / eingegebene Reallänge
 * Intern speichert das Dokument den Kehrwert (`FloorplanImage.scale`, m/px),
 * weil damit jede Bild→Welt-Umrechnung eine einzige Multiplikation ist.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Vec2 } from '../types/bim';
import { pixelsPerMeter } from '../types/bim';
import { distance, snapToAngle, snapToGrid } from '../lib/geometry';
import { useBimStore } from '../store/useBimStore';

interface TapeState {
  from: Vec2;
  to: Vec2 | null;
  /** Ziehen beendet — der Eingabedialog ist offen. */
  committed: boolean;
}

export default function CalibrationOverlay() {
  const tool = useBimStore((s) => s.tool);
  const viewport = useBimStore((s) => s.viewport);
  const snap = useBimStore((s) => s.snap);
  const image = useBimStore((s) => s.doc.image);
  const applyCalibration = useBimStore((s) => s.applyCalibration);
  const setTool = useBimStore((s) => s.setTool);

  const hostRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [tape, setTape] = useState<TapeState | null>(null);
  const [value, setValue] = useState('5.00');

  const active = tool === 'calibrate';

  // --- Maße der Ebene ------------------------------------------------------
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !active) return;
    const measure = () => {
      const rect = host.getBoundingClientRect();
      setSize({ w: rect.width, h: rect.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    return () => ro.disconnect();
  }, [active]);

  // Werkzeugwechsel setzt ein angefangenes Maßband zurück.
  useEffect(() => {
    if (!active) setTape(null);
  }, [active]);

  // --- Transformation ------------------------------------------------------
  const toWorld = useCallback(
    (screen: Vec2): Vec2 => ({
      x: (screen.x - size.w / 2) / viewport.zoom + viewport.center.x,
      y: (size.h / 2 - screen.y) / viewport.zoom + viewport.center.y,
    }),
    [size.h, size.w, viewport],
  );

  const toScreen = useCallback(
    (world: Vec2): Vec2 => ({
      x: (world.x - viewport.center.x) * viewport.zoom + size.w / 2,
      y: size.h / 2 - (world.y - viewport.center.y) * viewport.zoom,
    }),
    [size.h, size.w, viewport],
  );

  /** Beim Ziehen gelten Winkelraster und Raster — sonst wird die Messung ungenau. */
  const constrain = useCallback(
    (world: Vec2, origin: Vec2 | null): Vec2 => {
      if (origin && snap.angle) return snapToAngle(origin, world, snap.angleStep).point;
      if (snap.grid) return snapToGrid(world, snap.gridSize);
      return world;
    },
    [snap.angle, snap.angleStep, snap.grid, snap.gridSize],
  );

  const pointFrom = (e: React.PointerEvent): Vec2 => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  // --- Interaktion ---------------------------------------------------------
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (tape?.committed) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const world = constrain(toWorld(pointFrom(e)), null);
    setTape({ from: world, to: null, committed: false });
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!tape || tape.committed) return;
    const world = constrain(toWorld(pointFrom(e)), tape.from);
    setTape({ ...tape, to: world });
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (!tape || tape.committed) return;
    const to = tape.to;
    if (!to || distance(tape.from, to) < 0.05) {
      setTape(null);
      return;
    }
    setTape({ ...tape, to, committed: true });
  };

  const drawnLength = tape?.to ? distance(tape.from, tape.to) : 0;
  const parsedValue = parseFloat(value.replace(',', '.'));
  const valid = Number.isFinite(parsedValue) && parsedValue > 0;

  /** Vorschau des neuen Maßstabs, bevor der Nutzer bestätigt. */
  const preview = useMemo(() => {
    if (!image || !valid || drawnLength < 1e-6) return null;
    const factor = parsedValue / drawnLength;
    const newScale = image.scale * factor;
    return {
      factor,
      ppmBefore: pixelsPerMeter(image),
      ppmAfter: newScale > 0 ? 1 / newScale : 0,
    };
  }, [drawnLength, image, parsedValue, valid]);

  const confirm = () => {
    if (!tape?.to || !valid) return;
    applyCalibration(tape.from, tape.to, parsedValue);
    setTape(null);
  };

  const cancel = () => setTape(null);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (tape) setTape(null);
        else setTool('select');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, setTool, tape]);

  if (!active) return null;

  const a = tape ? toScreen(tape.from) : null;
  const b = tape?.to ? toScreen(tape.to) : null;

  return (
    <div
      ref={hostRef}
      className="absolute inset-0 z-10"
      style={{ cursor: 'crosshair' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {/* Hinweisbanner */}
      {!tape && (
        <div className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2">
          <div className="panel flex items-center gap-2 px-3 py-2">
            <span className="h-1.5 w-1.5 rounded-full bg-accent-teal" />
            <span className="text-[11px] text-slate-300">
              Ziehen Sie eine Linie über eine bekannte Bemaßung im Grundriss
            </span>
          </div>
        </div>
      )}

      {a && (
        <svg className="pointer-events-none absolute inset-0 h-full w-full" width={size.w} height={size.h}>
          <defs>
            <marker id="cal-tick" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
              <line x1="4" y1="0" x2="4" y2="8" stroke="#2DD4BF" strokeWidth="1.5" />
            </marker>
          </defs>

          {b && (
            <>
              {/* Führungslinie */}
              <line
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="#2DD4BF"
                strokeWidth={1.75}
                strokeDasharray="7 4"
                markerStart="url(#cal-tick)"
                markerEnd="url(#cal-tick)"
              />
              {/* Maßband-Beschriftung */}
              <g transform={`translate(${(a.x + b.x) / 2}, ${(a.y + b.y) / 2 - 16})`}>
                <rect x={-46} y={-11} width={92} height={22} rx={6} fill="rgba(11,17,32,0.92)" stroke="rgba(45,212,191,0.4)" />
                <text
                  x={0}
                  y={4}
                  textAnchor="middle"
                  fill="#2DD4BF"
                  fontFamily="JetBrains Mono, ui-monospace, monospace"
                  fontSize="11"
                >
                  {drawnLength.toFixed(3)} m
                </text>
              </g>
            </>
          )}

          <circle cx={a.x} cy={a.y} r={4} fill="#2DD4BF" />
          {b && <circle cx={b.x} cy={b.y} r={4} fill="#2DD4BF" />}
        </svg>
      )}

      {/* Eingabe der Reallänge */}
      {tape?.committed && b && (
        <div
          className="absolute"
          style={{
            left: Math.min(Math.max(((a?.x ?? 0) + b.x) / 2 - 132, 12), Math.max(12, size.w - 276)),
            // 300 px = tatsächliche Panelhöhe inkl. Maßstabsvorschau; sonst
            // rutschen die Schaltflächen unter den Rand der Zeichenfläche.
            top: Math.min(Math.max(((a?.y ?? 0) + b.y) / 2 + 24, 12), Math.max(12, size.h - 300)),
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="panel w-[264px] p-4">
            <div className="label-xs mb-2">Maßstab festlegen</div>

            <div className="mb-3 flex items-baseline justify-between">
              <span className="text-[11px] text-slate-500">Gezogene Strecke</span>
              <span className="font-mono text-xs text-accent-teal">{drawnLength.toFixed(3)} m</span>
            </div>

            <label className="label-xs mb-1 block">Reale Länge</label>
            <div className="flex items-center gap-2">
              <input
                autoFocus
                inputMode="decimal"
                className="field font-mono"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') confirm();
                  if (e.key === 'Escape') cancel();
                }}
              />
              <span className="text-xs text-slate-500">m</span>
            </div>

            {preview && (
              <div className="mt-3 space-y-1 rounded-md bg-graphite-900/70 px-2.5 py-2">
                <Row label="Faktor" value={`× ${preview.factor.toFixed(4)}`} />
                <Row label="px / m vorher" value={preview.ppmBefore.toFixed(1)} />
                <Row label="px / m nachher" value={preview.ppmAfter.toFixed(1)} accent />
              </div>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <button
                className="rounded-md px-3 py-1.5 text-xs text-slate-400 transition-colors hover:text-slate-200"
                onClick={cancel}
              >
                Abbrechen
              </button>
              <button
                disabled={!valid}
                className="rounded-md bg-accent/15 px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/25 disabled:opacity-35"
                onClick={confirm}
              >
                Skalieren
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-[10px] text-slate-500">{label}</span>
      <span className={`font-mono text-[11px] ${accent ? 'text-accent-teal' : 'text-slate-300'}`}>{value}</span>
    </div>
  );
}
