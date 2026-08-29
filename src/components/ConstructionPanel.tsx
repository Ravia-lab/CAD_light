/**
 * ConstructionPanel — der Bauteilkatalog.
 *
 * Der Katalog ersetzt das Pflegen von U-Werten an jeder einzelnen Wand.
 * Ändert sich ein Aufbau, ändern sich alle zugewiesenen Bauteile mit; im
 * Export steht neben dem U-Wert der Name des Aufbaus, damit in RaVia
 * nachvollziehbar bleibt, woher der Wert stammt.
 */

import { useMemo, useState } from 'react';
import type { Construction, ConstructionCategory } from '../types/bim';
import { useBimStore } from '../store/useBimStore';

const CATEGORY_LABELS: Record<ConstructionCategory, string> = {
  wall: 'Wände',
  floor: 'Böden',
  ceiling: 'Decken',
  roof: 'Dächer',
  window: 'Fenster',
  door: 'Türen',
};

const CATEGORIES: ConstructionCategory[] = ['wall', 'floor', 'ceiling', 'window', 'door'];

export default function ConstructionPanel() {
  const constructions = useBimStore((s) => s.doc.constructions);
  const walls = useBimStore((s) => s.doc.walls);
  const openings = useBimStore((s) => s.doc.openings);
  const selections = useBimStore((s) => s.selections);
  const addConstruction = useBimStore((s) => s.addConstruction);
  const updateConstruction = useBimStore((s) => s.updateConstruction);
  const deleteConstruction = useBimStore((s) => s.deleteConstruction);
  const assignConstruction = useBimStore((s) => s.assignConstruction);
  const setStatus = useBimStore((s) => s.setStatus);

  const [category, setCategory] = useState<ConstructionCategory>('wall');
  const [editing, setEditing] = useState<string | null>(null);

  const list = useMemo(
    () => Object.values(constructions).filter((c) => c.category === category),
    [category, constructions],
  );

  /** Wie oft ist ein Aufbau im Modell verwendet? */
  const usage = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const w of Object.values(walls)) if (w.constructionId) counts[w.constructionId] = (counts[w.constructionId] ?? 0) + 1;
    for (const o of Object.values(openings)) if (o.constructionId) counts[o.constructionId] = (counts[o.constructionId] ?? 0) + 1;
    return counts;
  }, [openings, walls]);

  const assignable = selections.filter((s) => s.kind === 'wall' || s.kind === 'opening');

  return (
    <div className="space-y-3 p-3">
      <div>
        <div className="label-xs mb-2">Bauteilkatalog</div>
        <div className="flex flex-wrap gap-0.5 rounded-lg bg-graphite-900/60 p-0.5">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={`chip flex-1 ${category === c ? 'bg-accent/15 text-accent' : 'text-slate-500 hover:text-slate-300'}`}
            >
              {CATEGORY_LABELS[c]}
            </button>
          ))}
        </div>
      </div>

      {assignable.length > 0 && (
        <div className="rounded-lg bg-accent/10 px-2.5 py-2">
          <p className="text-[10.5px] leading-relaxed text-accent">
            {assignable.length} Bauteil(e) ausgewählt — auf einen Aufbau klicken, um ihn zuzuweisen.
          </p>
        </div>
      )}

      <div className="space-y-1">
        {list.map((c) => (
          <ConstructionRow
            key={c.id}
            construction={c}
            usageCount={usage[c.id] ?? 0}
            editing={editing === c.id}
            assignable={assignable.length > 0}
            onEdit={() => setEditing(editing === c.id ? null : c.id)}
            onAssign={() => {
              assignConstruction(assignable, c.id);
              setStatus(`„${c.name}" auf ${assignable.length} Bauteil(e) angewendet`);
            }}
            onChange={(patch) => updateConstruction(c.id, patch)}
            onDelete={() => deleteConstruction(c.id)}
          />
        ))}
      </div>

      <button
        className="w-full rounded-lg bg-white/[0.05] px-3 py-2 text-[11px] text-slate-300 transition-colors hover:bg-white/[0.09]"
        onClick={() => {
          const created = addConstruction({
            name: `Neuer Aufbau ${CATEGORY_LABELS[category]}`,
            category,
            uValue: category === 'window' ? 1.1 : 0.3,
            thickness: category === 'wall' ? 0.24 : undefined,
          });
          setEditing(created.id);
        }}
      >
        Aufbau hinzufügen
      </button>

      <p className="text-[9.5px] leading-relaxed text-slate-600">
        Eine Änderung am Aufbau zieht alle zugewiesenen Bauteile mit. Der Name
        wandert in den Export, damit dort nachvollziehbar ist, woher ein U-Wert
        stammt.
      </p>
    </div>
  );
}

function ConstructionRow({
  construction,
  usageCount,
  editing,
  assignable,
  onEdit,
  onAssign,
  onChange,
  onDelete,
}: {
  construction: Construction;
  usageCount: number;
  editing: boolean;
  assignable: boolean;
  onEdit: () => void;
  onAssign: () => void;
  onChange: (patch: Partial<Construction>) => void;
  onDelete: () => void;
}) {
  return (
    <div className={`rounded-lg ${editing ? 'bg-graphite-900/80' : 'bg-white/[0.03]'}`}>
      <div className="flex items-center gap-2 px-2.5 py-2">
        <button className="min-w-0 flex-1 text-left" onClick={assignable ? onAssign : onEdit}>
          <div className="truncate text-[11px] text-slate-200">{construction.name}</div>
          <div className="font-mono text-[9.5px] text-slate-500">
            U {construction.uValue.toFixed(2)}
            {construction.thickness ? ` · ${(construction.thickness * 100).toFixed(1)} cm` : ''}
            {usageCount > 0 ? ` · ${usageCount}×` : ''}
          </div>
        </button>
        <button className="tool-btn h-6 w-6" title="Bearbeiten" onClick={onEdit}>
          <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.4">
            <path d="M11 2.5l2.5 2.5L6 12.5 3 13l.5-3z" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {editing && (
        <div className="space-y-2 border-t border-white/[0.06] px-2.5 py-2.5">
          <input
            className="field"
            value={construction.name}
            onChange={(e) => onChange({ name: e.target.value })}
          />
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="label-xs mb-1 block">U-Wert</span>
              <input
                type="number"
                step={0.01}
                className="field font-mono"
                value={construction.uValue}
                onChange={(e) => onChange({ uValue: Math.max(0, parseFloat(e.target.value) || 0) })}
              />
            </label>
            <label className="block">
              <span className="label-xs mb-1 block">Dicke [m]</span>
              <input
                type="number"
                step={0.005}
                className="field font-mono"
                value={construction.thickness ?? 0}
                onChange={(e) => onChange({ thickness: Math.max(0, parseFloat(e.target.value) || 0) })}
              />
            </label>
          </div>
          {(construction.category === 'window' || construction.category === 'door') && (
            <label className="block">
              <span className="label-xs mb-1 block">g-Wert</span>
              <input
                type="number"
                step={0.01}
                className="field font-mono"
                value={construction.gValue ?? 0.6}
                onChange={(e) => onChange({ gValue: parseFloat(e.target.value) || 0 })}
              />
            </label>
          )}
          <label className="block">
            <span className="label-xs mb-1 block">Schichten</span>
            <input
              className="field"
              value={construction.layers ?? ''}
              placeholder="z. B. 24 Ziegel + 14 WDVS"
              onChange={(e) => onChange({ layers: e.target.value })}
            />
          </label>
          <button
            className="chip w-full bg-rose-500/10 text-rose-300 hover:bg-rose-500/20"
            onClick={() => {
              if (usageCount === 0 || confirm(`„${construction.name}" ist ${usageCount}× zugewiesen. Wirklich löschen?`)) {
                onDelete();
              }
            }}
          >
            Aufbau löschen
          </button>
        </div>
      )}
    </div>
  );
}
