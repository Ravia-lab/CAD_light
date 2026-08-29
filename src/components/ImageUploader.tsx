/**
 * ImageUploader — Grundriss-Referenz: Upload, Overlay-Steuerung, KI-Analyse.
 * ---------------------------------------------------------------------------
 * Der Einstiegspunkt des Hybrid-Workflows:
 *
 *   Upload (PNG/JPG/PDF)  →  Kalibrieren (2-Punkt-Maßband)
 *                         →  Auto-Trace (Vision-Provider)
 *                         →  Prüfen & Übernehmen (TraceReviewBar)
 *                         →  manuelles Nachzeichnen mit Smart Snapping
 *
 * PDFs werden per `pdfjs-dist` gerastert — bewusst **lazy** importiert, damit
 * die rund 350 kB nur geladen werden, wenn tatsächlich ein PDF ankommt.
 */

import { useCallback, useRef, useState } from 'react';
import type { FloorplanImage } from '../types/bim';
import { pixelsPerMeter } from '../types/bim';
import { getVisionProvider, VisionError, type VisionProgress } from '../services/aiVisionService';
import { useBimStore } from '../store/useBimStore';

/** Zielbreite eines frisch importierten Plans im Modellraum [m]. */
const INITIAL_WIDTH_M = 12;
/** Rasterauflösung für PDF-Seiten — 2× reicht für scharfe Linien beim Zoomen. */
const PDF_RASTER_SCALE = 2;

export default function ImageUploader() {
  const image = useBimStore((s) => s.doc.image);
  const setImage = useBimStore((s) => s.setImage);
  const updateImage = useBimStore((s) => s.updateImage);
  const viewport = useBimStore((s) => s.viewport);
  const setTool = useBimStore((s) => s.setTool);
  const tool = useBimStore((s) => s.tool);
  const aiState = useBimStore((s) => s.aiState);
  const setAiState = useBimStore((s) => s.setAiState);
  const buildTrace = useBimStore((s) => s.buildTrace);
  const trace = useBimStore((s) => s.trace);
  const setStatus = useBimStore((s) => s.setStatus);

  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // -------------------------------------------------------------- Einlesen
  const loadFile = useCallback(
    async (file: File) => {
      try {
        setAiState({ status: 'uploading', progress: 0.2 });
        const { src, width, height } = file.type === 'application/pdf'
          ? await rasterizePdf(file)
          : await readBitmap(file);

        const scale = INITIAL_WIDTH_M / width;
        const next: FloorplanImage = {
          id: `img-${Date.now().toString(36)}`,
          src,
          name: file.name,
          naturalWidth: width,
          naturalHeight: height,
          // Bild um die aktuelle Bildschirmmitte platzieren
          origin: {
            x: viewport.center.x - INITIAL_WIDTH_M / 2,
            y: viewport.center.y + (height * scale) / 2,
          },
          scale,
          rotation: 0,
          opacity: 0.55,
          visible: true,
          locked: true, // standardmäßig gesperrt — Zeichnen soll nie das Bild verschieben
        };
        setImage(next);
        setAiState({ status: 'idle' });
        setStatus(`${file.name} geladen — jetzt kalibrieren`);
      } catch (error) {
        setAiState({
          status: 'error',
          message: error instanceof Error ? error.message : 'Datei konnte nicht gelesen werden',
        });
      }
    },
    [setAiState, setImage, setStatus, viewport.center],
  );

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void loadFile(file);
  };

  // ------------------------------------------------------------ KI-Analyse
  const runAnalysis = async () => {
    if (!image) return;
    const provider = getVisionProvider();
    const controller = new AbortController();
    abortRef.current = controller;

    setAiState({ status: 'analyzing', progress: 0.02, stage: 'Anfrage wird vorbereitet' });
    try {
      const result = await provider.analyze(
        {
          imageSrc: image.src,
          imageName: image.name,
          naturalWidth: image.naturalWidth,
          naturalHeight: image.naturalHeight,
          knownScale: image.scale,
          minConfidence: 0.35,
          signal: controller.signal,
        },
        (p: VisionProgress) => setAiState({ status: 'analyzing', progress: p.progress, stage: p.stage }),
      );

      setAiState({ status: 'done', result });
      buildTrace(result);
    } catch (error) {
      const message =
        error instanceof VisionError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Unbekannter Fehler';
      setAiState({ status: 'error', message });
      setStatus(`KI-Analyse fehlgeschlagen: ${message}`);
    } finally {
      abortRef.current = null;
    }
  };

  /** Übernimmt den von der KI vorgeschlagenen Maßstab aus erkannten Maßketten. */
  const applySuggestedScale = () => {
    if (!image || aiState.status !== 'done' || !aiState.result.suggestedScale) return;
    updateImage({ scale: aiState.result.suggestedScale });
    setStatus(`Maßstab aus Maßkette übernommen: ${(1 / aiState.result.suggestedScale).toFixed(1)} px/m`);
  };

  // ------------------------------------------------------------------ View
  if (!image) {
    return (
      <div className="p-3">
        <div className="label-xs mb-2">Grundriss-Referenz</div>
        <div
          className={`flex cursor-pointer flex-col items-center justify-center rounded-xl px-4 py-7 text-center transition-all ${
            dragOver ? 'bg-accent/10 shadow-glow' : 'bg-graphite-900/60 hover:bg-graphite-800/60'
          }`}
          style={{ border: `1px dashed ${dragOver ? 'rgba(56,189,248,0.6)' : 'rgba(148,163,184,0.18)'}` }}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          <UploadGlyph />
          <div className="mt-2.5 text-[11px] font-medium text-slate-300">Grundriss hierher ziehen</div>
          <div className="mt-1 text-[10px] text-slate-500">PNG · JPG · PDF</div>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,application/pdf"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void loadFile(file);
            e.target.value = '';
          }}
        />
        {aiState.status === 'error' && (
          <div className="mt-2 rounded-md bg-rose-500/10 px-2.5 py-1.5 text-[10px] text-rose-300">
            {aiState.message}
          </div>
        )}
      </div>
    );
  }

  const ppm = pixelsPerMeter(image);

  return (
    <div className="space-y-3 p-3">
      {/* Kopfzeile */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="label-xs">Grundriss-Referenz</div>
          <div className="truncate text-[11px] text-slate-300" title={image.name}>
            {image.name}
          </div>
          <div className="font-mono text-[9.5px] text-slate-500">
            {image.naturalWidth} × {image.naturalHeight} px · {ppm.toFixed(1)} px/m
          </div>
        </div>
        <button
          className="tool-btn h-7 w-7 text-slate-500 hover:text-rose-300"
          title="Referenz entfernen"
          onClick={() => {
            setImage(undefined);
            useBimStore.getState().clearTrace();
          }}
        >
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4">
            <path d="M3 3l10 10M13 3L3 13" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Deckkraft */}
      <div>
        <div className="mb-1.5 flex items-baseline justify-between">
          <span className="label-xs">Deckkraft</span>
          <span className="font-mono text-[10px] text-accent">{Math.round(image.opacity * 100)} %</span>
        </div>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={image.opacity}
          onChange={(e) => updateImage({ opacity: parseFloat(e.target.value) })}
        />
      </div>

      {/* Sichtbarkeit & Sperre */}
      <div className="grid grid-cols-2 gap-1.5">
        <ToggleChip
          active={image.visible}
          onClick={() => updateImage({ visible: !image.visible })}
          label={image.visible ? 'Sichtbar' : 'Ausgeblendet'}
        />
        <ToggleChip
          active={image.locked}
          tone="amber"
          onClick={() => updateImage({ locked: !image.locked })}
          label={image.locked ? 'Gesperrt' : 'Beweglich'}
          title="Gesperrt: Das Bild kann beim Zeichnen nicht versehentlich verschoben werden."
        />
      </div>

      {/* Feinjustage */}
      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label="Drehung °"
          value={image.rotation}
          step={0.5}
          onChange={(v) => updateImage({ rotation: v })}
        />
        <NumberField
          label="px / m"
          value={Number(ppm.toFixed(2))}
          step={1}
          min={0.1}
          onChange={(v) => v > 0 && updateImage({ scale: 1 / v })}
        />
      </div>

      {/* Kalibrierung */}
      <button
        className={`w-full rounded-lg px-3 py-2 text-[11px] font-medium transition-all ${
          tool === 'calibrate'
            ? 'bg-accent-teal/20 text-accent-teal shadow-glow'
            : 'bg-white/[0.05] text-slate-300 hover:bg-white/[0.09]'
        }`}
        onClick={() => setTool(tool === 'calibrate' ? 'select' : 'calibrate')}
      >
        {tool === 'calibrate' ? 'Kalibrierung aktiv — Linie ziehen' : 'Maßstab kalibrieren (2-Punkt)'}
      </button>
      {image.calibration && (
        <div className="rounded-md bg-graphite-900/70 px-2.5 py-1.5 font-mono text-[9.5px] text-slate-500">
          kalibriert auf {image.calibration.realLength.toFixed(2)} m
        </div>
      )}

      <div className="h-px bg-white/[0.06]" />

      {/* KI-Analyse */}
      <div>
        <div className="mb-1.5">
          <div className="label-xs">KI-Vorauswertung</div>
          <div className="truncate font-mono text-[9px] text-slate-600" title={getVisionProvider().description}>
            {getVisionProvider().label}
          </div>
        </div>

        {aiState.status === 'analyzing' || aiState.status === 'uploading' ? (
          <div className="space-y-2">
            <div className="h-1 overflow-hidden rounded-full bg-graphite-700">
              <div
                className="h-full rounded-full bg-accent transition-all duration-300"
                style={{ width: `${Math.round(aiState.progress * 100)}%` }}
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-slate-400">
                {aiState.status === 'analyzing' ? aiState.stage : 'Bild wird gelesen'}
              </span>
              <button
                className="text-[10px] text-slate-500 hover:text-rose-300"
                onClick={() => abortRef.current?.abort()}
              >
                Abbrechen
              </button>
            </div>
          </div>
        ) : (
          <button
            className="w-full rounded-lg bg-gradient-to-r from-accent/20 to-accent-teal/15 px-3 py-2 text-[11px] font-medium text-accent transition-all hover:from-accent/30 hover:to-accent-teal/25"
            onClick={() => void runAnalysis()}
          >
            {trace ? 'Analyse wiederholen' : 'Grundriss automatisch erkennen'}
          </button>
        )}

        {aiState.status === 'done' && (
          <div className="mt-2 space-y-1.5">
            <div className="rounded-md bg-graphite-900/70 px-2.5 py-2">
              <StatRow label="Wände" value={String(aiState.result.walls.length)} />
              <StatRow label="Öffnungen" value={String(aiState.result.openings.length)} />
              <StatRow label="Raumstempel" value={String(aiState.result.roomLabels.length)} />
              <StatRow
                label="Konfidenz"
                value={`${Math.round(aiState.result.confidence * 100)} %`}
                accent
              />
              <StatRow label="Laufzeit" value={`${aiState.result.durationMs} ms`} />
            </div>
            {aiState.result.suggestedScale && (
              <button
                className="w-full rounded-md bg-white/[0.05] px-2.5 py-1.5 text-[10px] text-slate-300 transition-colors hover:bg-white/[0.09]"
                onClick={applySuggestedScale}
              >
                Maßstab aus erkannter Maßkette übernehmen (
                {(1 / aiState.result.suggestedScale).toFixed(1)} px/m)
              </button>
            )}
          </div>
        )}

        {aiState.status === 'error' && (
          <div className="mt-2 rounded-md bg-rose-500/10 px-2.5 py-1.5 text-[10px] text-rose-300">
            {aiState.message}
          </div>
        )}

        <p className="mt-2 text-[9.5px] leading-relaxed text-slate-600">
          Erkannte Vektoren erscheinen magenta gestrichelt über dem Plan. Prüfen, einzelne
          Fehltreffer per Alt+Klick entfernen, dann übernehmen.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Datei-Einlesen
// ---------------------------------------------------------------------------

function readBitmap(file: File): Promise<{ src: string; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden'));
    reader.onload = () => {
      const src = reader.result as string;
      const img = new Image();
      img.onload = () => resolve({ src, width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => reject(new Error('Bildformat wird nicht unterstützt'));
      img.src = src;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Rastert die erste Seite eines PDFs. `pdfjs-dist` wird erst hier geladen —
 * wer nur PNGs importiert, zahlt die Bibliothek nie.
 */
async function rasterizePdf(file: File): Promise<{ src: string; width: number; height: number }> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString();

  const data = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data }).promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: PDF_RASTER_SCALE });

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas-Kontext nicht verfügbar');

  // Weißer Hintergrund: PDF-Seiten sind transparent, das sähe im Dark Mode
  // wie ein leeres Blatt aus.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport } as never).promise;

  return { src: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height };
}

// ---------------------------------------------------------------------------
// Kleine UI-Bausteine
// ---------------------------------------------------------------------------

function ToggleChip({
  active,
  label,
  onClick,
  title,
  tone = 'accent',
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  title?: string;
  tone?: 'accent' | 'amber';
}) {
  const activeClass =
    tone === 'amber' ? 'bg-amber-400/15 text-amber-300' : 'bg-accent/15 text-accent';
  return (
    <button
      title={title}
      onClick={onClick}
      className={`rounded-md px-2 py-1.5 text-[10px] font-medium transition-colors ${
        active ? activeClass : 'bg-white/[0.04] text-slate-500 hover:bg-white/[0.08] hover:text-slate-300'
      }`}
    >
      {label}
    </button>
  );
}

function NumberField({
  label,
  value,
  onChange,
  step = 1,
  min,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: number;
  min?: number;
}) {
  return (
    <label className="block">
      <span className="label-xs mb-1 block">{label}</span>
      <input
        type="number"
        className="field font-mono"
        value={value}
        step={step}
        min={min}
        onChange={(e) => {
          const parsed = parseFloat(e.target.value);
          if (Number.isFinite(parsed)) onChange(parsed);
        }}
      />
    </label>
  );
}

function StatRow({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-baseline justify-between py-0.5">
      <span className="text-[10px] text-slate-500">{label}</span>
      <span className={`font-mono text-[10px] ${accent ? 'text-accent' : 'text-slate-300'}`}>{value}</span>
    </div>
  );
}

function UploadGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-7 w-7 text-slate-500" fill="none" stroke="currentColor" strokeWidth="1.2">
      <path d="M12 16V4m0 0L8 8m4-4l4 4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 15v3a2 2 0 002 2h14a2 2 0 002-2v-3" strokeLinecap="round" />
    </svg>
  );
}
