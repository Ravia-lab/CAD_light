/**
 * RoomBook — das Raumbuch.
 *
 * Alle Räume in einer Tabelle statt Raum für Raum durchklicken. Genau die
 * Ansicht, in der Datenlücken auffallen: eine leere Nutzungsspalte oder eine
 * Null bei der Heizleistung sieht man hier auf einen Blick, im Inspektor erst
 * nach zehn Klicks.
 *
 * Der CSV-Export nutzt Semikolon und Komma als Dezimaltrenner — so öffnet
 * Excel in deutscher Einstellung die Datei ohne Import-Dialog.
 */

import { useMemo, useState } from 'react';
import type { RoomUsage } from '../types/bim';
import { useBimStore } from '../store/useBimStore';
import { downloadJson } from '../lib/raviaExport';

const USAGE_LABELS: Record<RoomUsage, string> = {
  living: 'Wohnen',
  bedroom: 'Schlafen',
  kitchen: 'Küche',
  bath: 'Bad',
  wc: 'WC',
  hallway: 'Flur',
  office: 'Arbeiten',
  storage: 'Abstellen',
  technical: 'Technik',
  other: '—',
};

type SortKey = 'name' | 'area' | 'volume' | 'temperature' | 'power' | 'level';

export default function RoomBook() {
  const doc = useBimStore((s) => s.doc);
  const setSelection = useBimStore((s) => s.setSelection);
  const setActiveLevel = useBimStore((s) => s.setActiveLevel);
  const selection = useBimStore((s) => s.selection);
  const setStatus = useBimStore((s) => s.setStatus);

  const [sort, setSort] = useState<SortKey>('level');
  const [desc, setDesc] = useState(false);
  const [allLevels, setAllLevels] = useState(true);

  const rows = useMemo(() => {
    const power: Record<string, number> = {};
    for (const f of Object.values(doc.fixtures)) {
      if (f.category === 'heating' && f.roomId) power[f.roomId] = (power[f.roomId] ?? 0) + (f.params.powerW ?? 0);
    }

    const list = Object.values(doc.rooms)
      .filter((r) => allLevels || r.levelId === doc.activeLevelId)
      .map((room) => ({
        room,
        level: doc.levels[room.levelId]?.name ?? '',
        order: doc.levels[room.levelId]?.order ?? 0,
        power: power[room.id] ?? 0,
        windowArea: room.boundaries.reduce((sum, b) => sum + b.openingArea, 0),
        exteriorArea: room.boundaries
          .filter((b) => b.boundary === 'exterior')
          .reduce((sum, b) => sum + b.netArea, 0),
      }));

    const factor = desc ? -1 : 1;
    list.sort((a, b) => {
      switch (sort) {
        case 'area':
          return factor * (a.room.area - b.room.area);
        case 'volume':
          return factor * (a.room.volume - b.room.volume);
        case 'temperature':
          return factor * (a.room.setpointTemperature - b.room.setpointTemperature);
        case 'power':
          return factor * (a.power - b.power);
        case 'level':
          return factor * (a.order - b.order || a.room.name.localeCompare(b.room.name, 'de'));
        default:
          return factor * a.room.name.localeCompare(b.room.name, 'de');
      }
    });
    return list;
  }, [allLevels, desc, doc, sort]);

  const totals = useMemo(
    () => ({
      area: rows.reduce((s, r) => s + r.room.area, 0),
      volume: rows.reduce((s, r) => s + r.room.volume, 0),
      power: rows.reduce((s, r) => s + r.power, 0),
      window: rows.reduce((s, r) => s + r.windowArea, 0),
    }),
    [rows],
  );

  const exportCsv = () => {
    const de = (n: number, digits = 2) => n.toFixed(digits).replace('.', ',');
    const head = [
      'Geschoss', 'Raum', 'Nutzung', 'Fläche [m²]', 'Höhe [m]', 'Volumen [m³]', 'Umfang [m]',
      'Solltemp. [°C]', 'Luftwechsel [1/h]', 'Außenwand [m²]', 'Öffnungen [m²]',
      'Erdkontakt [m]', 'Außenfassaden', 'Heizleistung [W]', 'beheizt',
      // Dachkennwerte stehen am Ende: bei Geschossen ohne Dach bleiben die
      // Spalten leer, statt die vorderen Spalten zu verschieben.
      'Dachfläche [m²]', 'Wohnfläche WoFlV [m²]', 'unter 1,00 m [m²]',
      'lichte Höhe min [m]', 'lichte Höhe max [m]',
    ].join(';');

    const body = rows.map((r) =>
      [
        r.level,
        r.room.name,
        USAGE_LABELS[r.room.usage],
        de(r.room.area),
        de(r.room.height, 3),
        de(r.room.volume),
        de(r.room.perimeter),
        de(r.room.setpointTemperature, 1),
        de(r.room.airChangeRate, 2),
        de(r.exteriorArea),
        de(r.windowArea),
        de(r.room.groundContactPerimeter),
        String(r.room.exposedFacadeCount),
        String(Math.round(r.power)),
        r.room.isHeated ? 'ja' : 'nein',
        r.room.roof ? de(r.room.roof.slopedArea) : '',
        r.room.roof ? de(r.room.roof.livingArea) : '',
        r.room.roof ? de(r.room.roof.areaBelow1m) : '',
        r.room.roof ? de(r.room.roof.minHeight, 3) : '',
        r.room.roof ? de(r.room.roof.maxHeight, 3) : '',
      ].join(';'),
    );

    const csv = '﻿' + [head, ...body].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${doc.meta.name.replace(/[^\wäöüß -]/gi, '')}_raumbuch.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus(`Raumbuch mit ${rows.length} Räumen als CSV exportiert`);
    void downloadJson;
  };

  const header = (key: SortKey, label: string, align: 'left' | 'right' = 'left') => (
    <button
      onClick={() => {
        if (sort === key) setDesc(!desc);
        else {
          setSort(key);
          setDesc(false);
        }
      }}
      className={`label-xs w-full ${align === 'right' ? 'text-right' : 'text-left'} ${
        sort === key ? 'text-accent' : 'hover:text-slate-300'
      }`}
    >
      {label}
      {sort === key ? (desc ? ' ↓' : ' ↑') : ''}
    </button>
  );

  return (
    <div className="space-y-3 p-3">
      <div className="flex items-baseline justify-between">
        <span className="label-xs">Raumbuch</span>
        <span className="font-mono text-[10px] text-slate-600">{rows.length} Räume</span>
      </div>

      <div className="flex gap-1.5">
        <button
          className={`chip flex-1 ${allLevels ? 'bg-accent/15 text-accent' : 'bg-white/[0.04] text-slate-500'}`}
          onClick={() => setAllLevels(true)}
        >
          Alle Geschosse
        </button>
        <button
          className={`chip flex-1 ${!allLevels ? 'bg-accent/15 text-accent' : 'bg-white/[0.04] text-slate-500'}`}
          onClick={() => setAllLevels(false)}
        >
          Nur aktuelles
        </button>
      </div>

      <div className="rounded-lg bg-graphite-900/60 px-1.5 py-1.5">
        <div className="grid grid-cols-[1fr_auto_auto] gap-x-2 border-b border-white/[0.06] pb-1.5">
          {header('name', 'Raum')}
          {header('area', 'm²', 'right')}
          {header('power', 'W', 'right')}
        </div>

        <div className="max-h-[42vh] overflow-y-auto">
          {rows.length === 0 && (
            <p className="px-1.5 py-3 text-[10px] leading-relaxed text-slate-600">
              Noch keine Räume. Sobald Wände einen geschlossenen Umriss bilden,
              erscheinen sie hier.
            </p>
          )}
          {rows.map((r) => {
            const active = selection?.kind === 'room' && selection.id === r.room.id;
            return (
              <button
                key={r.room.id}
                onClick={() => {
                  if (r.room.levelId !== doc.activeLevelId) setActiveLevel(r.room.levelId);
                  setSelection({ kind: 'room', id: r.room.id });
                }}
                className={`grid w-full grid-cols-[1fr_auto_auto] gap-x-2 rounded px-1.5 py-1 text-left transition-colors ${
                  active ? 'bg-accent/12' : 'hover:bg-white/[0.04]'
                }`}
              >
                <span className="min-w-0">
                  <span className={`block truncate text-[11px] ${active ? 'text-accent' : 'text-slate-200'}`}>
                    {r.room.name}
                  </span>
                  <span className="block truncate font-mono text-[9px] text-slate-500">
                    {r.level} · {USAGE_LABELS[r.room.usage]} · {r.room.setpointTemperature.toFixed(0)} °C
                    {!r.room.isHeated && ' · unbeheizt'}
                  </span>
                </span>
                <span className="self-center font-mono text-[10.5px] text-slate-300">{r.room.area.toFixed(2)}</span>
                <span
                  className={`self-center font-mono text-[10.5px] ${r.power > 0 ? 'text-accent' : 'text-slate-600'}`}
                >
                  {r.power > 0 ? Math.round(r.power) : '—'}
                </span>
              </button>
            );
          })}
        </div>

        {rows.length > 0 && (
          <div className="grid grid-cols-[1fr_auto_auto] gap-x-2 border-t border-white/[0.06] px-1.5 pt-1.5">
            <span className="text-[10px] text-slate-500">Summe</span>
            <span className="font-mono text-[10.5px] text-slate-200">{totals.area.toFixed(2)}</span>
            <span className="font-mono text-[10.5px] text-accent">{Math.round(totals.power)}</span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-lg bg-graphite-900/60 px-2.5 py-2">
        <Readout label="Volumen" value={`${totals.volume.toFixed(2)} m³`} />
        <Readout label="Öffnungen" value={`${totals.window.toFixed(2)} m²`} />
      </div>

      <button
        className="w-full rounded-lg bg-white/[0.05] px-3 py-2 text-[11px] text-slate-300 transition-colors hover:bg-white/[0.09]"
        onClick={exportCsv}
      >
        Raumbuch als CSV exportieren
      </button>
    </div>
  );
}

function Readout({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-1.5 py-0.5">
      <span className="min-w-0 truncate text-[10px] text-slate-500">{label}</span>
      <span className="shrink-0 whitespace-nowrap font-mono text-[11px] text-slate-300">{value}</span>
    </div>
  );
}
