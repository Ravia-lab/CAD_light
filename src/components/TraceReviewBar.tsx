/**
 * TraceReviewBar — Kontrollleiste der Auto-Trace-Vorschau.
 *
 * Der Kern des Hybrid-Ansatzes: die KI schlägt vor, der Planer entscheidet.
 * Nichts wandert ins Modell, bevor hier bewusst bestätigt wurde. Die Leiste
 * erscheint nur, solange eine Vorschau existiert, und verschwindet nach der
 * Übernahme wieder — sie belegt keinen dauerhaften Bildschirmplatz.
 */

import { useBimStore } from '../store/useBimStore';

export default function TraceReviewBar() {
  const trace = useBimStore((s) => s.trace);
  const selection = useBimStore((s) => s.selection);
  const setTraceVisible = useBimStore((s) => s.setTraceVisible);
  const setTraceMinConfidence = useBimStore((s) => s.setTraceMinConfidence);
  const rejectTraceCandidate = useBimStore((s) => s.rejectTraceCandidate);
  const restoreTraceCandidate = useBimStore((s) => s.restoreTraceCandidate);
  const acceptTrace = useBimStore((s) => s.acceptTrace);
  const clearTrace = useBimStore((s) => s.clearTrace);

  if (!trace) return null;

  const threshold = trace.minConfidence;
  const activeWalls = trace.walls.filter((w) => !w.rejected && w.confidence >= threshold);
  const activeOpenings = trace.openings.filter((o) => !o.rejected && o.confidence >= threshold);
  const rejectedCount =
    trace.walls.filter((w) => w.rejected).length + trace.openings.filter((o) => o.rejected).length;

  const selectedId = selection?.kind === 'trace' ? selection.id : null;
  const selectedCandidate = selectedId
    ? trace.walls.find((w) => w.id === selectedId) ?? trace.openings.find((o) => o.id === selectedId)
    : null;

  return (
    <div className="pointer-events-none absolute bottom-5 left-1/2 z-10 -translate-x-1/2">
      <div className="panel pointer-events-auto flex items-center gap-3 whitespace-nowrap px-3 py-2.5">
        {/* Status */}
        <div className="flex items-center gap-2 pr-1">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-fuchsia-400 opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-fuchsia-400" />
          </span>
          <div className="leading-tight">
            <div className="whitespace-nowrap text-[11px] font-medium text-slate-200">
              Auto-Trace Vorschau
            </div>
            <div className="font-mono text-[9.5px] text-slate-500">
              {trace.source} · {trace.durationMs} ms · Ø {Math.round(trace.overallConfidence * 100)} %
            </div>
          </div>
        </div>

        <div className="divider-v" />

        {/* Trefferzahlen */}
        <div className="flex items-center gap-2">
          <Count label="Wände" value={activeWalls.length} />
          <Count label="Öffnungen" value={activeOpenings.length} />
          {rejectedCount > 0 && <Count label="verworfen" value={rejectedCount} muted />}
        </div>

        <div className="divider-v" />

        {/* Konfidenz-Schwelle */}
        <div className="w-[136px] shrink-0">
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <span className="label-xs">Konfidenz</span>
            <span className="font-mono text-[10px] text-accent">{Math.round(threshold * 100)} %</span>
          </div>
          <input
            type="range"
            min={0}
            max={0.95}
            step={0.05}
            value={threshold}
            onChange={(e) => setTraceMinConfidence(parseFloat(e.target.value))}
          />
        </div>

        <div className="divider-v" />

        {/* Sichtbarkeit */}
        <button
          className={`chip ${trace.visible ? 'bg-accent/15 text-accent' : 'text-slate-500 hover:text-slate-300'}`}
          onClick={() => setTraceVisible(!trace.visible)}
          title="Vorschau-Ebene ein-/ausblenden"
        >
          {trace.visible ? 'Sichtbar' : 'Ausgeblendet'}
        </button>

        {/* Aktionen zum ausgewählten Vektor */}
        {selectedCandidate && (
          <>
            <div className="divider-v" />
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-[10px] text-fuchsia-300">
                {Math.round(selectedCandidate.confidence * 100)} %
              </span>
              {selectedCandidate.rejected ? (
                <button
                  className="chip bg-white/[0.06] text-slate-300 hover:bg-white/10"
                  onClick={() => restoreTraceCandidate(selectedCandidate.id)}
                >
                  Wiederherstellen
                </button>
              ) : (
                <button
                  className="chip bg-rose-500/10 text-rose-300 hover:bg-rose-500/20"
                  onClick={() => rejectTraceCandidate(selectedCandidate.id)}
                >
                  Vektor löschen
                </button>
              )}
            </div>
          </>
        )}

        <div className="divider-v" />

        <button
          className="rounded-md px-2.5 py-1.5 text-[11px] text-slate-400 transition-colors hover:text-slate-200"
          onClick={clearTrace}
        >
          Verwerfen
        </button>
        <button
          className="rounded-md bg-accent/15 px-3 py-1.5 text-[11px] font-medium text-accent shadow-glow transition-colors hover:bg-accent/25 disabled:opacity-35"
          disabled={activeWalls.length === 0}
          onClick={acceptTrace}
        >
          Vorschlag übernehmen
        </button>
      </div>

      <div className="pointer-events-none mt-1.5 text-center font-mono text-[9.5px] text-slate-600">
        Klick wählt einen Vektor · Alt+Klick oder Entf verwirft ihn
      </div>
    </div>
  );
}

function Count({ label, value, muted }: { label: string; value: number; muted?: boolean }) {
  return (
    <div className="text-center">
      <div className={`font-mono text-sm leading-none ${muted ? 'text-slate-600' : 'text-slate-100'}`}>
        {value}
      </div>
      <div className="label-xs mt-0.5 whitespace-nowrap">{label}</div>
    </div>
  );
}
