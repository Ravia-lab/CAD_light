/**
 * VentilationPanel — das Lüftungskonzept.
 *
 * In einem dichten Neubau entscheidet die Lüftung über einen guten Teil der
 * Heizlast. Ohne Wärmerückgewinnung geht die gesamte Zuluft mit
 * Außentemperatur ein; mit 80 % Rückgewinnung nur noch ein Fünftel davon.
 * Fehlt diese Angabe im Datensatz, muss die Gegenstelle raten — und zwar um
 * den Faktor fünf.
 *
 * Die zweite Zahl, die hier zählt, ist die **Luftbilanz**. Eine Zu-/Abluft-
 * anlage ist per Definition ausgeglichen. Klafft sie, geht die Differenz
 * durch die Gebäudehülle: bei Überdruck hinaus, bei Unterdruck herein, in
 * beiden Fällen ungewärmt und in keiner Rechnung.
 */

import { useMemo } from 'react';
import type { VentilationRole } from '../types/bim';
import { VENTILATION_ROLE_LABELS } from '../types/bim';
import { useBimStore } from '../store/useBimStore';
import Erklaerung from './Erklaerung';

const KINDS: { id: 'none' | 'exhaust' | 'balanced'; label: string; hint: string }[] = [
  { id: 'none', label: 'frei', hint: 'Fensterlüftung — kein Gerät, keine Rückgewinnung' },
  { id: 'exhaust', label: 'Abluft', hint: 'Abluftanlage; die Zuluft strömt durch Außenwandventile nach' },
  { id: 'balanced', label: 'Zu-/Abluft', hint: 'Gerät mit Zu- und Abluft, meist mit Wärmerückgewinnung' },
];

const ROLES: VentilationRole[] = ['supply', 'exhaust', 'transfer', 'none'];

const ROLE_SHORT: Record<VentilationRole, string> = {
  supply: 'ZU',
  exhaust: 'AB',
  transfer: 'ÜB',
  none: '—',
};

const fmt = (v: number, d = 0): string =>
  v.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });

export default function VentilationPanel() {
  // Stabile Referenzen selektieren, erst im useMemo verdichten.
  const doc = useBimStore((s) => s.doc);
  const updateMeta = useBimStore((s) => s.updateMeta);
  const updateRoom = useBimStore((s) => s.updateRoom);
  const setSelection = useBimStore((s) => s.setSelection);

  const system = doc.meta.ventilation;
  const kind = system?.kind ?? 'none';
  const recovery = kind === 'balanced' ? (system?.heatRecovery ?? 0) : 0;

  const air = useMemo(() => {
    const perRoom = new Map<string, { supply: number; exhaust: number; transfer: number }>();
    const bucket = (id: string) => {
      let b = perRoom.get(id);
      if (!b) {
        b = { supply: 0, exhaust: 0, transfer: 0 };
        perRoom.set(id, b);
      }
      return b;
    };
    let supply = 0;
    let exhaust = 0;
    let transfer = 0;
    for (const f of Object.values(doc.fixtures)) {
      const q = f.params.airflow ?? 0;
      if (!f.roomId) continue;
      if (f.type === 'air-supply') {
        bucket(f.roomId).supply += q;
        supply += q;
      } else if (f.type === 'air-exhaust') {
        bucket(f.roomId).exhaust += q;
        exhaust += q;
      } else if (f.type === 'air-transfer') {
        bucket(f.roomId).transfer += q;
        transfer += q;
      }
    }
    return { perRoom, supply, exhaust, transfer, balance: supply - exhaust };
  }, [doc.fixtures]);

  const rooms = useMemo(
    () => Object.values(doc.rooms).sort((a, b) => b.area - a.area),
    [doc.rooms],
  );

  const patch = (p: Partial<NonNullable<typeof system>>) =>
    updateMeta({
      ventilation: {
        kind,
        heatRecovery: system?.heatRecovery ?? 0.8,
        operation: system?.operation ?? 'continuous',
        ...(system ?? {}),
        ...p,
      },
    });

  return (
    <div className="space-y-3 p-3">
      <span className="label-xs block">Lüftungsanlage</span>

      <div className="flex gap-0.5 rounded-lg bg-graphite-900/60 p-0.5">
        {KINDS.map((k) => (
          <button
            key={k.id}
            title={k.hint}
            onClick={() => patch({ kind: k.id })}
            className={`chip flex-1 ${
              kind === k.id ? 'bg-accent/15 text-accent' : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            {k.label}
          </button>
        ))}
      </div>

      {kind === 'none' && (
        <p className="rounded-lg bg-white/[0.03] px-2.5 py-2 text-[10px] leading-relaxed text-slate-500">
          Freie Lüftung: der Lüftungswärmeverlust folgt allein aus n_min, n50 und der Abschirmung.
          Diese Werte stehen im Reiter „Objekt“ und gehen unverändert in den Export.
        </p>
      )}

      {kind === 'balanced' && (
        <>
          <div>
            <div className="flex items-baseline justify-between">
              <span className="flex items-center gap-1 text-[10.5px] text-slate-400">
                Wärmerückgewinnung η
                <Erklaerung term="wrg" />
              </span>
              <span className="tabular-nums text-[11px] text-accent">
                {fmt(recovery * 100)} %
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={95}
              step={1}
              value={Math.round(recovery * 100)}
              onChange={(e) => patch({ heatRecovery: Number(e.target.value) / 100 })}
              className="mt-1 w-full accent-accent"
            />
            <p className="mt-0.5 text-[9.5px] leading-relaxed text-slate-600">
              Wirkt unmittelbar: nur V̇<sub>zu</sub> · (1 − η) trägt noch Außentemperatur.
            </p>
          </div>

          <div className="flex gap-0.5 rounded-lg bg-graphite-900/60 p-0.5">
            {(['continuous', 'demand'] as const).map((o) => (
              <button
                key={o}
                onClick={() => patch({ operation: o })}
                className={`chip flex-1 ${
                  (system?.operation ?? 'continuous') === o
                    ? 'bg-accent/15 text-accent'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {o === 'continuous' ? 'Dauerbetrieb' : 'bedarfsgeführt'}
              </button>
            ))}
          </div>
        </>
      )}

      {/* --- Luftbilanz ---------------------------------------------------- */}
      {kind !== 'none' && (
        <div className="rounded-lg bg-white/[0.03] p-2.5">
          <div className="label-xs mb-1.5">Luftbilanz</div>
          <Row label="Zuluft" value={`${fmt(air.supply)} m³/h`} />
          <Row label="Abluft" value={`${fmt(air.exhaust)} m³/h`} />
          <Row label="Überströmung" value={`${fmt(air.transfer)} m³/h`} />
          {kind === 'balanced' && (
            <Row
              label="wirksame Zuluft"
              value={`${fmt(air.supply * (1 - recovery))} m³/h`}
              accent
            />
          )}
          <div className="mt-1 border-t border-white/[0.06] pt-1">
            <Row
              label="Differenz"
              value={`${air.balance > 0 ? '+' : ''}${fmt(air.balance)} m³/h`}
              tone={balanceTone(kind, air.supply, air.exhaust)}
            />
          </div>
          <p className="mt-1.5 text-[9.5px] leading-relaxed text-slate-500">
            {balanceVerdict(kind, air.supply, air.exhaust)}
          </p>
        </div>
      )}

      {/* --- Räume --------------------------------------------------------- */}
      <div>
        <div className="label-xs mb-1.5 flex items-center gap-1">
          Räume im Konzept
          <Erklaerung term="ueberstroemen" />
        </div>
        <div className="space-y-0.5">
          {rooms.map((r) => {
            const b = air.perRoom.get(r.id) ?? { supply: 0, exhaust: 0, transfer: 0 };
            const role = r.ventilationRole ?? 'none';
            const missing =
              (role === 'exhaust' && b.exhaust <= 0) ||
              (role === 'supply' && kind === 'balanced' && b.supply <= 0);
            return (
              <div key={r.id} className="rounded-lg bg-white/[0.02] px-2 py-1.5">
                <div className="flex items-baseline gap-2">
                  <button
                    onClick={() => setSelection({ kind: 'room', id: r.id })}
                    className="min-w-0 flex-1 truncate text-left text-[10.5px] text-slate-300 hover:text-accent"
                  >
                    {r.name}
                  </button>
                  <span className="tabular-nums text-[9.5px] text-slate-600">
                    n_min·V {fmt(r.volume * r.airChangeRate)} m³/h
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-0.5">
                  {ROLES.map((role2) => (
                    <button
                      key={role2}
                      title={VENTILATION_ROLE_LABELS[role2]}
                      onClick={() => updateRoom(r.id, { ventilationRole: role2 })}
                      className={`chip px-1.5 ${
                        role === role2 ? 'bg-accent/15 text-accent' : 'text-slate-600 hover:text-slate-300'
                      }`}
                    >
                      {ROLE_SHORT[role2]}
                    </button>
                  ))}
                  <span
                    className={`ml-auto tabular-nums text-[10px] ${
                      missing ? 'text-rose-400' : 'text-slate-400'
                    }`}
                  >
                    {missing
                      ? 'kein Ventil'
                      : `${b.supply ? `+${fmt(b.supply)}` : ''}${b.supply && b.exhaust ? ' / ' : ''}${
                          b.exhaust ? `−${fmt(b.exhaust)}` : ''
                        }${!b.supply && !b.exhaust ? (b.transfer ? `↔${fmt(b.transfer)}` : '—') : ''}`}
                  </span>
                </div>
              </div>
            );
          })}
          {rooms.length === 0 && (
            <p className="text-[10px] text-slate-500">Noch keine Räume erkannt.</p>
          )}
        </div>
        <p className="mt-1.5 text-[9.5px] leading-relaxed text-slate-600">
          Die Rolle folgt zunächst der Nutzung — Aufenthaltsräume bekommen Zuluft, Bad, WC und
          Küche sind Ablufträume, Flure strömen über. Die Volumenströme kommen von den gesetzten
          Ventilen, nicht aus einer Tabelle.
        </p>
      </div>
    </div>
  );
}

function balanceTone(kind: string, supply: number, exhaust: number): 'ok' | 'warn' | 'plain' {
  if (kind !== 'balanced' || supply + exhaust <= 0) return 'plain';
  return Math.abs(supply - exhaust) <= 0.1 * Math.max(supply, exhaust) ? 'ok' : 'warn';
}

function balanceVerdict(kind: string, supply: number, exhaust: number): string {
  if (kind === 'exhaust') {
    return 'Bei einer Abluftanlage ist der Unterdruck gewollt: die Zuluft strömt durch Außenwandventile nach.';
  }
  if (supply + exhaust <= 0) return 'Noch keine Ventile gesetzt.';
  const gap = supply - exhaust;
  if (Math.abs(gap) <= 0.1 * Math.max(supply, exhaust)) return 'Die Anlage ist ausgeglichen.';
  return gap > 0
    ? `Überdruck von ${Math.round(gap)} m³/h — so viel gewärmte Luft wird durch die Hülle gedrückt.`
    : `Unterdruck von ${Math.round(-gap)} m³/h — so viel kalte Luft wird ungewärmt durch die Hülle gezogen.`;
}

function Row({
  label,
  value,
  accent,
  tone = 'plain',
}: {
  label: string;
  value: string;
  accent?: boolean;
  tone?: 'ok' | 'warn' | 'plain';
}) {
  const color =
    tone === 'warn' ? 'text-rose-400' : tone === 'ok' ? 'text-emerald-400' : accent ? 'text-accent' : 'text-slate-300';
  return (
    <div className="flex items-baseline justify-between gap-2 py-0.5">
      <span className="text-[10px] text-slate-500">{label}</span>
      <span className={`tabular-nums text-[10.5px] ${color}`}>{value}</span>
    </div>
  );
}
