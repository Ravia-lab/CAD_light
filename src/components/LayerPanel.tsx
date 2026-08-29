/**
 * LayerPanel — Ebenensteuerung, Raumliste und Fang-Einstellungen.
 * Alles, was den *Zustand der Zeichenfläche* betrifft, an einem Ort.
 */

import { useBimStore } from '../store/useBimStore';

export default function LayerPanel() {
  const doc = useBimStore((s) => s.doc);
  const toggleLayer = useBimStore((s) => s.toggleLayer);
  const snap = useBimStore((s) => s.snap);
  const setSnap = useBimStore((s) => s.setSnap);
  const selection = useBimStore((s) => s.selection);
  const setSelection = useBimStore((s) => s.setSelection);
  const layers = Object.values(doc.layers);
  const rooms = Object.values(doc.rooms);

  return (
    <div className="space-y-4 p-3">
      {/* Ebenen */}
      <div>
        <div className="label-xs mb-2">Ebenen</div>
        <div className="space-y-0.5">
          {layers.map((layer) => (
            <button
              key={layer.id}
              onClick={() => toggleLayer(layer.id)}
              className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 transition-colors hover:bg-white/[0.04]"
            >
              <EyeIcon open={layer.visible} />
              <span
                className="h-2 w-2 shrink-0 rounded-sm"
                style={{ background: layer.color, opacity: layer.visible ? 1 : 0.25 }}
              />
              <span className={`text-[11px] ${layer.visible ? 'text-slate-300' : 'text-slate-600'}`}>
                {layer.name}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="h-px bg-white/[0.06]" />

      {/* Fang */}
      <div>
        <div className="label-xs mb-2">Fang & Raster</div>
        <div className="grid grid-cols-2 gap-1.5">
          <SnapToggle label="Raster" active={snap.grid} onClick={() => setSnap({ grid: !snap.grid })} />
          <SnapToggle label="Knoten" active={snap.nodes} onClick={() => setSnap({ nodes: !snap.nodes })} />
          <SnapToggle label="Wandachse" active={snap.walls} onClick={() => setSnap({ walls: !snap.walls })} />
          <SnapToggle label="Winkel" active={snap.angle} onClick={() => setSnap({ angle: !snap.angle })} />
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <label className="block">
            <span className="label-xs mb-1 block">Rasterweite [m]</span>
            <select
              className="field"
              value={snap.gridSize}
              onChange={(e) => setSnap({ gridSize: parseFloat(e.target.value) })}
            >
              {[0.05, 0.125, 0.25, 0.5, 1].map((size) => (
                <option key={size} value={size} className="bg-graphite-850">
                  {size.toFixed(3)}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="label-xs mb-1 block">Winkelschritt [°]</span>
            <select
              className="field"
              value={snap.angleStep}
              onChange={(e) => setSnap({ angleStep: parseFloat(e.target.value) })}
            >
              {[15, 22.5, 30, 45, 90].map((step) => (
                <option key={step} value={step} className="bg-graphite-850">
                  {step}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="h-px bg-white/[0.06]" />

      {/* Raumliste */}
      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <span className="label-xs">Räume</span>
          <span className="font-mono text-[10px] text-slate-600">{rooms.length}</span>
        </div>

        {rooms.length === 0 ? (
          <p className="text-[10px] leading-relaxed text-slate-600">
            Sobald Wände einen geschlossenen Umriss bilden, erscheint der Raum hier automatisch
            mit Fläche und Volumen.
          </p>
        ) : (
          <div className="space-y-0.5">
            {rooms.map((room) => {
              const active = selection?.kind === 'room' && selection.id === room.id;
              return (
                <button
                  key={room.id}
                  onClick={() => setSelection({ kind: 'room', id: room.id })}
                  className={`flex w-full items-baseline justify-between rounded-md px-2 py-1.5 text-left transition-colors ${
                    active ? 'bg-accent/12' : 'hover:bg-white/[0.04]'
                  }`}
                >
                  <span className={`truncate text-[11px] ${active ? 'text-accent' : 'text-slate-300'}`}>
                    {room.name}
                  </span>
                  <span className="ml-2 shrink-0 font-mono text-[10px] text-slate-500">
                    {room.area.toFixed(2)} m²
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function SnapToggle({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-2 py-1.5 text-[10px] font-medium transition-colors ${
        active ? 'bg-accent/15 text-accent' : 'bg-white/[0.04] text-slate-500 hover:bg-white/[0.08]'
      }`}
    >
      {label}
    </button>
  );
}

function EyeIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={`h-3.5 w-3.5 shrink-0 ${open ? 'text-slate-400' : 'text-slate-700'}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
    >
      <path d="M1.5 8s2.4-4 6.5-4 6.5 4 6.5 4-2.4 4-6.5 4-6.5-4-6.5-4z" />
      <circle cx="8" cy="8" r="1.6" />
      {!open && <path d="M2.5 2.5l11 11" strokeLinecap="round" />}
    </svg>
  );
}
