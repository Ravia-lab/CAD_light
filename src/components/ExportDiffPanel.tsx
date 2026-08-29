/**
 * ExportDiffPanel — „was hat sich seit der letzten Übergabe geändert?"
 *
 * Man lädt den zuletzt an RaVia übergebenen Export als Referenz; der aktuelle
 * Stand wird direkt aus dem Modell erzeugt. Angezeigt wird nur, was die
 * Heizlast bewegt — Fläche, Volumen, Höhe, Solltemperatur, Luftwechsel,
 * Außenwand-, Fensterfläche, installierte Leistung, Erdkontakt.
 *
 * Alternativ lässt sich auch eine zweite Datei laden, um zwei archivierte
 * Stände ohne das aktuelle Modell zu vergleichen.
 */

import { useMemo, useRef, useState } from 'react';
import type { RaviaExport } from '../types/bim';
import type { ChangeKind, ExportDiff, RoomDiff } from '../lib/exportDiff';
import { diffExports, isRaviaExport } from '../lib/exportDiff';
import { buildRaviaExport } from '../lib/raviaExport';
import { useBimStore } from '../store/useBimStore';

const KIND_STYLE: Record<ChangeKind, { dot: string; text: string; label: string }> = {
  added: { dot: 'bg-emerald-400', text: 'text-emerald-300', label: 'neu' },
  removed: { dot: 'bg-rose-400', text: 'text-rose-300', label: 'entfallen' },
  changed: { dot: 'bg-amber-400', text: 'text-amber-300', label: 'geändert' },
  unchanged: { dot: 'bg-slate-600', text: 'text-slate-500', label: 'unverändert' },
};

const fmt = (v: number | string | null): string => {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return v;
  return Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2);
};

export default function ExportDiffPanel() {
  const doc = useBimStore((s) => s.doc);
  const setSelection = useBimStore((s) => s.setSelection);
  const setStatus = useBimStore((s) => s.setStatus);

  const [reference, setReference] = useState<RaviaExport | null>(null);
  const [compareTo, setCompareTo] = useState<RaviaExport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showUnchanged, setShowUnchanged] = useState(false);

  const refInput = useRef<HTMLInputElement>(null);
  const cmpInput = useRef<HTMLInputElement>(null);

  const current = useMemo(() => compareTo ?? buildRaviaExport(doc), [doc, compareTo]);

  const diff: ExportDiff | null = useMemo(
    () => (reference ? diffExports(reference, current) : null),
    [reference, current],
  );

  const read = async (file: File, target: 'ref' | 'cmp') => {
    try {
      const parsed: unknown = JSON.parse(await file.text());
      if (!isRaviaExport(parsed)) {
        setError('Das ist kein RaVia-Export — erwartet wird eine Datei mit „schema", „rooms" und „totals".');
        return;
      }
      setError(null);
      if (target === 'ref') setReference(parsed);
      else setCompareTo(parsed);
      setStatus(`Vergleichsstand geladen: ${file.name}`);
    } catch {
      setError('Datei konnte nicht gelesen werden — ist es gültiges JSON?');
    }
  };

  const visible = diff
    ? diff.rooms.filter((r) => showUnchanged || r.kind !== 'unchanged')
    : [];

  return (
    <div className="space-y-3 p-3">
      <div className="label-xs">Export-Vergleich</div>

      <p className="text-[10px] leading-relaxed text-slate-500">
        Referenz laden (der zuletzt an RaVia übergebene Export). Verglichen wird gegen den aktuellen
        Modellstand — oder gegen eine zweite Datei.
      </p>

      <input
        ref={refInput}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void read(f, 'ref');
          e.target.value = '';
        }}
      />
      <input
        ref={cmpInput}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void read(f, 'cmp');
          e.target.value = '';
        }}
      />

      <div className="space-y-1.5">
        <FileSlot
          label="Referenz (vorher)"
          value={reference ? `${reference.project.name} · ${reference.rooms.length} Räume` : null}
          onPick={() => refInput.current?.click()}
          onClear={reference ? () => setReference(null) : undefined}
        />
        <FileSlot
          label="Vergleich (nachher)"
          value={
            compareTo
              ? `${compareTo.project.name} · ${compareTo.rooms.length} Räume`
              : `Aktueller Modellstand · ${current.rooms.length} Räume`
          }
          muted={!compareTo}
          onPick={() => cmpInput.current?.click()}
          onClear={compareTo ? () => setCompareTo(null) : undefined}
        />
      </div>

      {error && (
        <div className="rounded-lg bg-rose-500/10 px-2.5 py-2 text-[10px] leading-relaxed text-rose-300">{error}</div>
      )}

      {!diff && !error && (
        <div className="rounded-lg bg-white/[0.03] px-2.5 py-3 text-[10px] leading-relaxed text-slate-500">
          Noch keine Referenz geladen. Ohne Vorher-Stand gibt es nichts zu vergleichen.
        </div>
      )}

      {diff && (
        <>
          {/* Zusammenfassung */}
          <div className="grid grid-cols-4 gap-1">
            <Tally kind="added" n={diff.summary.added} />
            <Tally kind="removed" n={diff.summary.removed} />
            <Tally kind="changed" n={diff.summary.changed} />
            <Tally kind="unchanged" n={diff.summary.unchanged} />
          </div>

          {/* Gebäudesummen */}
          {diff.totals.length > 0 && (
            <div className="space-y-1 rounded-lg bg-white/[0.03] p-2.5">
              <div className="label-xs">Gebäudesummen</div>
              {diff.totals.map((c) => (
                <ChangeRow key={c.field} change={c} />
              ))}
            </div>
          )}

          <label className="flex cursor-pointer items-center gap-2 text-[10px] text-slate-500">
            <input
              type="checkbox"
              checked={showUnchanged}
              onChange={(e) => setShowUnchanged(e.target.checked)}
              className="accent-accent"
            />
            Unveränderte Räume anzeigen
          </label>

          {/* Räume */}
          <div className="space-y-1.5">
            {visible.length === 0 && (
              <div className="rounded-lg bg-emerald-500/10 px-2.5 py-2 text-[10px] text-emerald-300">
                Keine heizlastrelevante Änderung — der letzte Export ist noch gültig.
              </div>
            )}
            {visible.map((room) => (
              <RoomDiffCard
                key={`${room.kind}-${room.id}`}
                room={room}
                onSelect={() => {
                  if (room.kind !== 'removed') setSelection({ kind: 'room', id: room.id });
                }}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function FileSlot({
  label,
  value,
  muted,
  onPick,
  onClear,
}: {
  label: string;
  value: string | null;
  muted?: boolean;
  onPick: () => void;
  onClear?: () => void;
}) {
  return (
    <div className="flex items-center gap-1.5 rounded-lg bg-white/[0.03] px-2.5 py-2">
      <div className="min-w-0 flex-1">
        <div className="label-xs">{label}</div>
        <div className={`truncate text-[10px] ${muted ? 'italic text-slate-500' : 'text-slate-300'}`}>
          {value ?? 'nicht geladen'}
        </div>
      </div>
      {onClear && (
        <button onClick={onClear} className="chip text-slate-500 hover:text-rose-300" title="Zurücksetzen">
          ✕
        </button>
      )}
      <button onClick={onPick} className="chip bg-accent/12 text-accent hover:bg-accent/20">
        Laden
      </button>
    </div>
  );
}

function Tally({ kind, n }: { kind: ChangeKind; n: number }) {
  const s = KIND_STYLE[kind];
  return (
    <div className="rounded-lg bg-white/[0.03] px-1.5 py-2 text-center">
      <div className={`text-[15px] font-semibold tabular-nums ${n > 0 ? s.text : 'text-slate-600'}`}>{n}</div>
      <div className="label-xs">{s.label}</div>
    </div>
  );
}

function ChangeRow({ change }: { change: { label: string; before: number | string | null; after: number | string | null; delta?: number } }) {
  const up = typeof change.delta === 'number' && change.delta > 0;
  const down = typeof change.delta === 'number' && change.delta < 0;
  return (
    <div className="flex items-baseline gap-1.5 text-[10px]">
      <span className="min-w-0 flex-1 truncate text-slate-500">{change.label}</span>
      <span className="tabular-nums text-slate-600 line-through">{fmt(change.before)}</span>
      <span className="text-slate-600">→</span>
      <span className="tabular-nums font-medium text-slate-200">{fmt(change.after)}</span>
      {typeof change.delta === 'number' && Number.isFinite(change.delta) && (
        <span className={`tabular-nums ${up ? 'text-emerald-400' : down ? 'text-rose-400' : 'text-slate-600'}`}>
          {up ? '+' : ''}
          {change.delta.toFixed(1)}%
        </span>
      )}
    </div>
  );
}

function RoomDiffCard({ room, onSelect }: { room: RoomDiff; onSelect: () => void }) {
  const s = KIND_STYLE[room.kind];
  return (
    <button
      onClick={onSelect}
      className="w-full rounded-lg bg-white/[0.03] p-2.5 text-left transition-colors hover:bg-white/[0.06]"
    >
      <div className="flex items-center gap-2">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${s.dot}`} />
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-slate-200">{room.name}</span>
        <span className="label-xs shrink-0">{room.level}</span>
        <span className={`shrink-0 text-[9px] uppercase tracking-wider ${s.text}`}>{s.label}</span>
      </div>
      {room.changes.length > 0 && (
        <div className="mt-1.5 space-y-0.5 border-l border-white/[0.07] pl-2">
          {room.changes.map((c) => (
            <ChangeRow key={c.field} change={c} />
          ))}
        </div>
      )}
    </button>
  );
}
