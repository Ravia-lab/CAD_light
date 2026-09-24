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

import RaumnameFeld from './RaumnameFeld';
import { useEffect, useMemo, useState } from 'react';
import type { Room, RoomUsage } from '../types/bim';
import { useBimStore } from '../store/useBimStore';
import { downloadJson } from '../lib/raviaExport';
import { rohrmeterJeRaum } from '../lib/rohrImRaum';

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
  const updateRoom = useBimStore((s) => s.updateRoom);
  const setzeRaumHeizleistung = useBimStore((s) => s.setzeRaumHeizleistung);
  const uebernimmUeberschlag = useBimStore((s) => s.uebernimmUeberschlagAlsHeizleistung);
  const fuehreKleineRaeumeAlsUnbeheizt = useBimStore((s) => s.fuehreKleineRaeumeAlsUnbeheizt);
  /** Beheizte Räume unter 1 m² — fast immer Schächte oder Aufmaßrauschen. */
  const kleineRaeume = Object.values(doc.rooms).filter((r) => r.isHeated && r.area < 1).length;
  const uiMode = useBimStore((s) => s.uiMode);

  const [sort, setSort] = useState<SortKey>('level');
  const [desc, setDesc] = useState(false);
  const [allLevels, setAllLevels] = useState(true);
  /*
   * Ansehen oder Ausfüllen.
   * -------------------------------------------------------------------------
   * Das Raumbuch zeigte bisher genau die Angaben, die beim Aufmaß zu füllen
   * sind — Name, Nutzung, Solltemperatur, Fläche, Heizleistung —, nahm aber
   * keine davon an. Ein Klick wählte den Raum aus, eingetragen wurde im
   * Reiter „Objekt": pro Raum rund zehn Berührungen, bei sieben Räumen
   * siebzig. Und auf einem Tablet ohne Stift war der Weg über das
   * Zeichenblatt bis 1.32.0 überhaupt keiner.
   *
   * Jetzt ist die Tabelle zugleich die Maske. Zwei Zustände statt eines
   * dritten Reiters: Wer nur nachsieht, will die Übersicht in einer Zeile je
   * Raum; wer ausfüllt, braucht Felder, die ein Finger trifft (44 px, siehe
   * `index.css`) — und die passen nicht in dieselbe Zeile.
   *
   * Der Handwerkermodus fängt beim Ausfüllen an, weil genau das seine Arbeit
   * ist. Die anderen beiden beim Ansehen: Ein Fachplaner öffnet das Raumbuch,
   * um Lücken zu finden, nicht um sie hier zu schließen.
   */
  const [ausfuellen, setAusfuellen] = useState(uiMode === 'handwerker');

  /*
   * Die Rohrmeter je Raum.
   *
   * **Warum sie im Raumbuch stehen.** Ein Heizkreisverteiler in der Diele
   * schickt alle Kreise über den Flur, und diese Leitungen geben ihre Wärme
   * dort ab, wo sie liegen. Ein Flur mit zwanzig Metern Anbindeleitung im
   * Estrich kann darüber vollständig beheizt sein — wer ihm zusätzlich einen
   * Heizkörper gibt, baut ihn doppelt. Im Raumbuch fällt das auf, weil die
   * Zahl neben der Heizleistung steht; im Rohrnetzbericht nicht, weil dort
   * nach Nennweite summiert wird und nicht nach Raum.
   *
   * Gerechnet, nicht gerundet: Die Wärmeabgabe selbst gehört in die
   * Heizlastberechnung (siehe `rohrImRaum.ts`). Hier stehen die Meter.
   */
  const rohrJeRaum = useMemo(
    () => rohrmeterJeRaum(Object.values(doc.pipes ?? {}), Object.values(doc.rooms)),
    [doc.pipes, doc.rooms],
  );

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
        rohrmeter: (rohrJeRaum.get(room.id) ?? []).reduce((sum, e) => sum + e.length, 0),
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
  }, [allLevels, desc, doc, rohrJeRaum, sort]);

  const totals = useMemo(
    () => ({
      area: rows.reduce((s, r) => s + r.room.area, 0),
      volume: rows.reduce((s, r) => s + r.room.volume, 0),
      power: rows.reduce((s, r) => s + r.power, 0),
      window: rows.reduce((s, r) => s + r.windowArea, 0),
      rohr: rows.reduce((s, r) => s + r.rohrmeter, 0),
    }),
    [rows],
  );

  const exportCsv = () => {
    const de = (n: number, digits = 2) => n.toFixed(digits).replace('.', ',');
    const head = [
      'Geschoss', 'Raum', 'Nutzung', 'Fläche [m²]', 'Höhe [m]', 'Volumen [m³]', 'Umfang [m]',
      'Solltemp. [°C]', 'Luftwechsel [1/h]', 'Außenwand [m²]', 'Öffnungen [m²]',
      'Erdkontakt [m]', 'Außenfassaden', 'Heizleistung [W]', 'Rohr im Raum [m]', 'beheizt',
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
        de(r.rohrmeter),
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

      <div className="flex gap-1.5">
        <button
          className={`chip flex-1 ${!ausfuellen ? 'bg-accent/15 text-accent' : 'bg-white/[0.04] text-slate-500'}`}
          onClick={() => setAusfuellen(false)}
          title="Übersicht — eine Zeile je Raum"
        >
          Ansehen
        </button>
        <button
          className={`chip flex-1 ${ausfuellen ? 'bg-accent/15 text-accent' : 'bg-white/[0.04] text-slate-500'}`}
          onClick={() => setAusfuellen(true)}
          title="Name, Nutzung und Heizleistung hier eintragen — ohne Umweg über den Plan"
        >
          Ausfüllen
        </button>
      </div>

      {/*
        * Die zwei Knöpfe, die den Weg vom Grundriss zur Auslegung kurz machen.
        *
        * **Heizlast in einem Rutsch.** Die Leistung je Raum war bisher eine
        * Eingabe pro Zeile — beim Mehrfamilienhaus 42 Stück, bevor überhaupt
        * etwas ausgelegt werden kann. Gerechnet wird nicht mit einer
        * W/m²-Faustzahl, sondern mit dem Überschlag aus den Flächen und
        * U-Werten dieses Gebäudes. Eingetragene Zahlen bleiben stehen.
        *
        * **Kleine Räume.** Schächte und Digitalisierungsrauschen kommen als
        * winzige Räume ins Modell, bekommen Heizkörper, die nie eine Trasse
        * erreichen, und fallen auf der Gegenseite ohnehin weg. Der Knopf
        * erscheint nur, wenn es solche Räume überhaupt gibt.
        */}
      {ausfuellen && (
        <div className="space-y-1.5">
          <button
            className="chip w-full bg-accent/12 text-accent hover:bg-accent/20"
            title="Trägt in jeden beheizten Raum ohne Leistung den Überschlag aus Flächen, U-Werten und Temperaturen ein — auf 50 W gerundet. Vorhandene Zahlen bleiben stehen."
            onClick={() => uebernimmUeberschlag({ levelId: allLevels ? undefined : doc.activeLevelId })}
          >
            Heizlast überschlägig für alle Räume
          </button>
          {kleineRaeume > 0 && (
            <button
              className="chip w-full bg-amber-500/12 text-amber-200 hover:bg-amber-500/20"
              title="Räume unter 1 m² sind fast immer Schächte oder Aufmaßrauschen. Als unbeheizt geführt, bekommen sie keinen Heizkörper. Strg+Z nimmt es zurück."
              onClick={() => fuehreKleineRaeumeAlsUnbeheizt(1)}
            >
              {kleineRaeume} Raum/Räume unter 1 m² als unbeheizt führen
            </button>
          )}
        </div>
      )}

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
            const waehlen = () => {
              if (r.room.levelId !== doc.activeLevelId) setActiveLevel(r.room.levelId);
              setSelection({ kind: 'room', id: r.room.id }, 'liste');
            };
            if (ausfuellen) {
              return (
                <Ausfuellzeile
                  key={r.room.id}
                  room={r.room}
                  level={r.level}
                  power={r.power}
                  aktiv={active}
                  waehlen={waehlen}
                  umbenennen={(patch) => updateRoom(r.room.id, patch)}
                  nutzung={(usage) => updateRoom(r.room.id, { usage })}
                  leistung={(watt) => {
                    const ergebnis = setzeRaumHeizleistung(r.room.id, watt);
                    if (ergebnis.message) setStatus(ergebnis.message);
                  }}
                />
              );
            }
            return (
              <button
                key={r.room.id}
                onClick={() => {
                  if (r.room.levelId !== doc.activeLevelId) setActiveLevel(r.room.levelId);
                  setSelection({ kind: 'room', id: r.room.id }, 'liste');
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
                    {r.rohrmeter > 0.05 && ` · ${r.rohrmeter.toFixed(1).replace('.', ',')} m Rohr`}
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
        {totals.rohr > 0.05 && (
          <Readout label="Rohr in Räumen" value={`${totals.rohr.toFixed(1).replace('.', ',')} m`} />
        )}
      </div>
      {totals.rohr > 0.05 && (
        <p className="px-1 text-[10px] leading-snug text-slate-500">
          Die Rohrmeter stehen beim Raum, in dem sie <em>liegen</em> — nicht bei dem, zu dem sie
          führen. Ein Flur mit gebündelten Anbindeleitungen ist darüber mitbeheizt; die Wärmeabgabe
          rechnet RaVia, die Meter reist mit dem Export mit.
        </p>
      )}

      <button
        className="w-full rounded-lg bg-white/[0.05] px-3 py-2 text-[11px] text-slate-300 transition-colors hover:bg-white/[0.09]"
        onClick={exportCsv}
      >
        Raumbuch als CSV exportieren
      </button>
    </div>
  );
}

/**
 * Eine Zeile zum Ausfüllen: Name, Nutzung, Heizleistung.
 *
 * **Warum die Leistung erst beim Verlassen des Feldes gilt.** Wer „1400"
 * tippt, hat nach dem ersten Anschlag eine 1 im Feld stehen. Würde jede
 * Tastenbewegung durchgereicht, entstünde beim ersten Zeichen ein Heizkörper
 * mit einem Watt, der dann dreimal geändert wird — drei Schritte in der
 * Rückgängig-Kette für eine Eingabe. Deshalb hält die Zeile den Text
 * solange selbst und meldet ihn beim Verlassen oder auf Eingabetaste.
 *
 * Das leere Feld ist ein eigener Fall und **nicht** dasselbe wie 0 W: Es
 * heißt „nicht erfasst", und genau so steht es später in der Übergabe.
 */
function Ausfuellzeile({
  room,
  level,
  power,
  aktiv,
  waehlen,
  umbenennen,
  nutzung,
  leistung,
}: {
  room: Room;
  level: string;
  power: number;
  aktiv: boolean;
  waehlen: () => void;
  umbenennen: (patch: { name: string; usage?: RoomUsage }) => void;
  nutzung: (usage: RoomUsage) => void;
  leistung: (watt: number | undefined) => void;
}) {
  const [watt, setWatt] = useState(power > 0 ? String(Math.round(power)) : '');
  const [getippt, setGetippt] = useState(false);

  // Von außen geänderte Leistung übernehmen — aber nicht, während jemand
  // gerade in diesem Feld tippt.
  useEffect(() => {
    if (!getippt) setWatt(power > 0 ? String(Math.round(power)) : '');
  }, [power, getippt]);

  const uebernehmen = () => {
    setGetippt(false);
    const text = watt.trim().replace(',', '.');
    if (text === '') {
      leistung(undefined);
      return;
    }
    const zahl = Number.parseFloat(text);
    if (Number.isFinite(zahl) && zahl >= 0) leistung(zahl);
  };

  return (
    <div
      className={`space-y-1 rounded px-1.5 py-1.5 transition-colors ${aktiv ? 'bg-accent/12' : 'hover:bg-white/[0.03]'}`}
      onFocusCapture={waehlen}
    >
      <div className="flex items-center gap-1.5">
        <RaumnameFeld
          className="field min-w-0 flex-1 text-[11.5px]"
          wert={room.name}
          onAendern={umbenennen}
          ariaLabel={`Name des Raums ${room.name}`}
        />
        <span className="shrink-0 font-mono text-[10px] text-slate-500">{level}</span>
      </div>
      <div className="grid grid-cols-[1fr_auto_auto] items-center gap-1.5">
        <select
          className="field min-w-0 text-[11px]"
          value={room.usage}
          onChange={(e) => nutzung(e.target.value as RoomUsage)}
          aria-label={`Nutzung von ${room.name}`}
        >
          {(Object.keys(USAGE_LABELS) as RoomUsage[]).map((u) => (
            <option key={u} value={u} className="bg-graphite-850">
              {USAGE_LABELS[u]}
            </option>
          ))}
        </select>
        <span className="shrink-0 font-mono text-[10.5px] text-slate-400">
          {room.area.toFixed(2)} m²
        </span>
        <div className="flex shrink-0 items-center gap-1">
          <input
            className="field w-[4.5rem] text-right font-mono text-[11px]"
            inputMode="numeric"
            placeholder="—"
            value={watt}
            onChange={(e) => {
              setGetippt(true);
              setWatt(e.target.value);
            }}
            onBlur={uebernehmen}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
            aria-label={`Heizleistung von ${room.name} in Watt`}
          />
          <span className="font-mono text-[10px] text-slate-500">W</span>
        </div>
      </div>
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
