/**
 * ThermalBridgePanel — Wärmebrücken pauschal oder längenbezogen.
 *
 * Der Kern dieses Panels ist nicht die Eingabe, sondern die **Gegenprobe**:
 * links der pauschale Zuschlag, rechts die Bilanz aus Anschlusslängen, und
 * darunter der Zuschlag, der dieselbe Bilanz ergäbe. Erst damit lässt sich
 * die Frage „reichen 0,05?" beantworten, statt sie zu beantworten, indem man
 * 0,10 nimmt und hofft.
 *
 * Die Längen kommen aus der Geometrie und sind nicht editierbar — wer sie
 * ändern will, ändert den Grundriss. Editierbar sind die ψ-Werte, denn die
 * hängen an der Konstruktion und nicht am Modell.
 */

import { useMemo } from 'react';
import type { ThermalBridgeKind } from '../types/bim';
import {
  BRIDGE_TYPES,
  FLAT_SUPPLEMENT,
  documentBridgeLengths,
  envelopeArea,
  roomBridgeHeatLoss,
  roomThermalBridges,
} from '../lib/thermalBridges';
import { useBimStore } from '../store/useBimStore';
import Erklaerung from './Erklaerung';

const CATEGORIES: { id: 'none' | 'A' | 'B' | 'custom'; label: string; hint: string }[] = [
  { id: 'none', label: 'ohne Nachweis', hint: 'ΔU_WB = 0,10 W/(m²·K)' },
  { id: 'A', label: 'Kategorie A', hint: 'ΔU_WB = 0,05 W/(m²·K)' },
  { id: 'B', label: 'Kategorie B', hint: 'ΔU_WB = 0,03 W/(m²·K)' },
  { id: 'custom', label: 'frei', hint: 'eigener Wert' },
];

const MASS: { id: 'light' | 'medium' | 'heavy'; label: string; hint: string }[] = [
  { id: 'light', label: 'leicht', hint: '15 Wh/(m³·K) — Holzbau, Trockenbau' },
  { id: 'medium', label: 'mittel', hint: '42 Wh/(m³·K) — Regelfall Massivbau' },
  { id: 'heavy', label: 'schwer', hint: '70 Wh/(m³·K) — massiv, wenig Dämmung innen' },
];

const fmt = (v: number, d = 2): string =>
  v.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });

export default function ThermalBridgePanel() {
  // Wichtig: stabile Referenzen selektieren und erst in useMemo verdichten.
  // Ein Selektor, der bei jedem Aufruf ein neues Objekt baut, dreht React in
  // eine Endlosschleife — genau daran ist der Geschossumschalter schon
  // einmal gestorben.
  const doc = useBimStore((s) => s.doc);
  const updateMeta = useBimStore((s) => s.updateMeta);

  const method = doc.meta.thermalBridgeMethod ?? 'flat';
  const category = doc.meta.thermalBridgeCategory ?? 'none';
  const catalogue = doc.meta.thermalBridgeCatalogue ?? {};

  const balance = useMemo(() => {
    const rooms = Object.values(doc.rooms);
    const area = envelopeArea(doc);
    const detailed = rooms.reduce((sum, r) => sum + roomBridgeHeatLoss(roomThermalBridges(doc, r)), 0);
    const lengths = documentBridgeLengths(doc);
    return {
      area,
      detailed,
      flat: doc.meta.thermalBridgeSupplement * area,
      equivalent: area > 0.01 ? detailed / area : 0,
      lengths,
      roomCount: rooms.length,
    };
  }, [doc]);

  const setPsi = (kind: ThermalBridgeKind, value: number) =>
    updateMeta({ thermalBridgeCatalogue: { ...catalogue, [kind]: value } });

  const setback = doc.meta.setback;

  return (
    <div className="space-y-3 p-3">
      <span className="label-xs flex items-center gap-1">
        Wärmebrücken
        <Erklaerung term="delta-u-wb" />
      </span>

      {/* --- Verfahren -------------------------------------------------- */}
      <div className="flex gap-0.5 rounded-lg bg-graphite-900/60 p-0.5">
        {(['flat', 'detailed'] as const).map((m) => (
          <button
            key={m}
            onClick={() => updateMeta({ thermalBridgeMethod: m })}
            className={`chip flex-1 ${
              method === m ? 'bg-accent/15 text-accent' : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            {m === 'flat' ? 'pauschal' : 'längenbezogen'}
          </button>
        ))}
      </div>

      {method === 'flat' ? (
        <>
          <div className="flex flex-wrap gap-0.5 rounded-lg bg-graphite-900/60 p-0.5">
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                title={c.hint}
                onClick={() =>
                  updateMeta({
                    thermalBridgeCategory: c.id,
                    ...(c.id === 'custom' ? {} : { thermalBridgeSupplement: FLAT_SUPPLEMENT[c.id] }),
                  })
                }
                className={`chip flex-1 ${
                  category === c.id ? 'bg-accent/15 text-accent' : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
          <NumberField
            label="ΔU_WB"
            unit="W/(m²·K)"
            value={doc.meta.thermalBridgeSupplement}
            step={0.01}
            min={0}
            max={0.3}
            onChange={(v) => updateMeta({ thermalBridgeSupplement: v, thermalBridgeCategory: 'custom' })}
          />
        </>
      ) : (
        <p className="rounded-lg bg-white/[0.03] px-2.5 py-2 text-[10px] leading-relaxed text-slate-500">
          Der pauschale Zuschlag entfällt in den U-Werten; stattdessen gehen die Anschlusslängen
          unten in den Export. Beides zusammen wäre doppelt gezählt.
        </p>
      )}

      {/* --- Gegenprobe -------------------------------------------------- */}
      <div className="rounded-lg bg-white/[0.03] p-2.5">
        <div className="label-xs mb-1.5">Gegenprobe</div>
        <Row label="Hüllfläche" value={`${fmt(balance.area)} m²`} />
        <Row label="pauschal" value={`${fmt(balance.flat, 1)} W/K`} />
        <Row label="längenbezogen" value={`${fmt(balance.detailed, 1)} W/K`} accent />
        <Row label="gleichwertig ΔU_WB" value={`${fmt(balance.equivalent, 3)} W/(m²·K)`} />
        <p className="mt-1.5 text-[9.5px] leading-relaxed text-slate-500">{verdict(balance)}</p>
      </div>

      {/* --- Anschlussarten ---------------------------------------------- */}
      <div>
        <div className="label-xs mb-1.5">Anschlüsse aus der Geometrie</div>
        <div className="space-y-0.5">
          {BRIDGE_TYPES.map((t) => {
            const length = balance.lengths.get(t.kind) ?? 0;
            const psi = catalogue[t.kind] ?? t.psi;
            if (length <= 0) return null;
            return (
              <div key={t.kind} className="rounded-lg bg-white/[0.02] px-2 py-1.5" title={t.derivedFrom}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 flex-1 truncate text-[10.5px] text-slate-300">{t.label}</span>
                  <span className="tabular-nums text-[10px] text-slate-500">{fmt(length)} m</span>
                </div>
                <div className="mt-1 flex items-center gap-1.5">
                  <input
                    type="number"
                    value={psi}
                    step={0.01}
                    onChange={(e) => setPsi(t.kind, Number(e.target.value))}
                    className="input h-6 w-16 text-[10px]"
                  />
                  <span className="text-[9.5px] text-slate-600">ψ W/(m·K)</span>
                  <span className="ml-auto tabular-nums text-[10px] text-accent">
                    {fmt(psi * length, 2)} W/K
                  </span>
                </div>
              </div>
            );
          })}
          {balance.lengths.size === 0 && (
            <p className="text-[10px] text-slate-500">
              Noch keine Außenbauteile — Anschlüsse entstehen erst mit erkannten Räumen.
            </p>
          )}
        </div>
        <p className="mt-1.5 text-[9.5px] leading-relaxed text-slate-600">
          Vorgabewerte in der Größenordnung der Planungsbeispiele zu DIN 4108 Beiblatt 2; sie liegen
          bewusst auf der sicheren Seite. Für einen Nachweis gehören die Werte aus dem
          Wärmebrückenkatalog des Herstellers hier hinein.
        </p>
      </div>

      {/* --- Absenkbetrieb ----------------------------------------------- */}
      <div className="border-t border-white/[0.06] pt-3">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="label-xs">Absenkbetrieb</span>
          <button
            onClick={() =>
              updateMeta({
                setback: setback?.active
                  ? { ...setback, active: false }
                  : {
                      active: true,
                      hours: setback?.hours ?? 8,
                      reheatHours: setback?.reheatHours ?? 2,
                      airChangeRate: setback?.airChangeRate ?? 0.1,
                      massClass: setback?.massClass ?? 'medium',
                    },
              })
            }
            className={`chip ${setback?.active ? 'bg-accent/12 text-accent' : 'text-slate-500 hover:text-slate-300'}`}
          >
            {setback?.active ? 'aktiv' : 'aus'}
          </button>
        </div>

        {!setback?.active ? (
          <p className="text-[9.5px] leading-relaxed text-slate-600">
            Ohne Absenkung entfällt die Zusatz-Aufheizleistung. Das ist in Deutschland der
            Regelfall — der Wiederaufheizfaktor ist national auf 0 gesetzt.
          </p>
        ) : (
          <div className="space-y-2">
            <NumberField
              label="Absenkzeit"
              unit="h"
              value={setback.hours}
              step={1}
              min={0}
              max={24}
              onChange={(v) => updateMeta({ setback: { ...setback, hours: v } })}
            />
            <NumberField
              label="Aufheizzeit"
              unit="h"
              value={setback.reheatHours}
              step={0.5}
              min={0}
              max={12}
              onChange={(v) => updateMeta({ setback: { ...setback, reheatHours: v } })}
            />
            <NumberField
              label="Luftwechsel dabei"
              unit="1/h"
              value={setback.airChangeRate}
              step={0.05}
              min={0}
              max={2}
              onChange={(v) => updateMeta({ setback: { ...setback, airChangeRate: v } })}
            />
            <div>
              <span className="label-xs mb-1 block">Bauart</span>
              <div className="flex gap-0.5 rounded-lg bg-graphite-900/60 p-0.5">
                {MASS.map((m) => (
                  <button
                    key={m.id}
                    title={m.hint}
                    onClick={() => updateMeta({ setback: { ...setback, massClass: m.id } })}
                    className={`chip flex-1 ${
                      setback.massClass === m.id
                        ? 'bg-accent/15 text-accent'
                        : 'text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
            <NumberField
              label="f_RH"
              term="f-rh"
              unit="W/m²"
              value={doc.meta.reheatFactor}
              step={1}
              min={0}
              max={60}
              onChange={(v) => updateMeta({ reheatFactor: v })}
              hint="Aus der Tabelle der geltenden Norm. 0 lässt die Zusatzleistung entfallen."
            />
            <p className="text-[9.5px] leading-relaxed text-slate-600">
              Zeitkonstante und Temperaturabfall werden im Export ausgewiesen; die
              Aufheizleistung selbst rechnet RaVia.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function verdict(b: { flat: number; detailed: number; roomCount: number }): string {
  if (b.roomCount === 0) return 'Noch keine Räume erkannt.';
  if (Math.abs(b.flat) < 0.01) return 'Ohne pauschalen Zuschlag gibt es nichts zu vergleichen.';
  const ratio = b.detailed / b.flat;
  const pct = Math.round(Math.abs(1 - ratio) * 100);
  if (pct < 10) return 'Pauschale und Bilanz liegen dicht beieinander — die Annahme passt.';
  return ratio < 1
    ? `Die Bilanz liegt rund ${pct} % unter der Pauschale: der Zuschlag ist für dieses Gebäude auf der sicheren Seite.`
    : `Die Bilanz liegt rund ${pct} % über der Pauschale: der Zuschlag unterschätzt die Anschlüsse dieses Gebäudes.`;
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-0.5">
      <span className="text-[10px] text-slate-500">{label}</span>
      <span className={`tabular-nums text-[10.5px] ${accent ? 'text-accent' : 'text-slate-300'}`}>
        {value}
      </span>
    </div>
  );
}

function NumberField({
  label,
  term,
  unit,
  value,
  step,
  min,
  max,
  onChange,
  hint,
}: {
  label: string;
  term?: string;
  unit: string;
  value: number;
  step: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  hint?: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="flex min-w-0 flex-1 items-center gap-1 truncate text-[10.5px] text-slate-400">
          <span className="min-w-0 truncate">{label}</span>
          {term && <Erklaerung term={term} />}
        </span>
        <input
          type="number"
          value={value}
          step={step}
          min={min}
          max={max}
          onChange={(e) => onChange(Math.min(max, Math.max(min, Number(e.target.value))))}
          className="input h-6 w-20 text-[10px]"
        />
        <span className="w-16 shrink-0 text-[9.5px] text-slate-600">{unit}</span>
      </div>
      {hint && <p className="mt-0.5 text-[9.5px] leading-relaxed text-slate-600">{hint}</p>}
    </div>
  );
}
