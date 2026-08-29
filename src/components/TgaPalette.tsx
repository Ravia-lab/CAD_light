/**
 * TgaPalette — Symbolbibliothek für Heizung, Sanitär und Lüftung.
 *
 * Jedes Symbol wird als echte Vorschau gerendert: dieselbe Zeichenroutine wie
 * im Plan, nur in ein kleines Canvas. Dadurch kann die Palette nie ein Symbol
 * zeigen, das im Grundriss anders aussieht — und neue Symbole erscheinen hier
 * automatisch, sobald sie in `FIXTURE_LIBRARY` stehen.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Fixture, FixtureCategory, FixtureDefinition, PipeService } from '../types/bim';
import {
  FIXTURE_CATEGORY_LABELS,
  FIXTURE_LIBRARY,
  PIPE_SERVICE_COLORS,
  PIPE_SERVICE_LABELS,
} from '../types/bim';
import { FIXTURE_COLORS, drawFixture } from '../lib/fixtureSymbols';
import { buildPipeNetwork } from '../lib/pipeNetwork';
import type { FloorLoopBatchReport } from '../store/useBimStore';
import { useBimStore } from '../store/useBimStore';

const CATEGORIES: FixtureCategory[] = ['heating', 'sanitary', 'ventilation'];

export default function TgaPalette() {
  const activeFixture = useBimStore((s) => s.activeFixture);
  const setActiveFixture = useBimStore((s) => s.setActiveFixture);
  const tool = useBimStore((s) => s.tool);
  const setTool = useBimStore((s) => s.setTool);
  const fixtures = useBimStore((s) => s.doc.fixtures);
  const layers = useBimStore((s) => s.doc.layers);
  const toggleLayer = useBimStore((s) => s.toggleLayer);

  const [category, setCategory] = useState<FixtureCategory>('heating');
  const items = useMemo(() => FIXTURE_LIBRARY.filter((f) => f.category === category), [category]);

  // Bestandszahlen je Gewerk — zeigt auf einen Blick, was schon geplant ist.
  const counts = useMemo(() => {
    const c: Record<FixtureCategory, number> = { heating: 0, sanitary: 0, ventilation: 0 };
    for (const f of Object.values(fixtures)) c[f.category]++;
    return c;
  }, [fixtures]);

  const installedPower = useMemo(
    () =>
      Object.values(fixtures)
        .filter((f) => f.category === 'heating')
        .reduce((sum, f) => sum + (f.params.powerW ?? 0), 0),
    [fixtures],
  );

  const layerId =
    category === 'heating' ? 'layer-heating' : category === 'sanitary' ? 'layer-sanitary' : 'layer-ventilation';
  const layerVisible = layers[layerId]?.visible !== false;

  return (
    <div className="space-y-3 p-3">
      <div>
        <div className="label-xs mb-2">TGA-Symbole</div>
        <div className="flex gap-0.5 rounded-lg bg-graphite-900/60 p-0.5">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={`chip flex-1 ${category === c ? 'bg-accent/15 text-accent' : 'text-slate-500 hover:text-slate-300'}`}
            >
              {FIXTURE_CATEGORY_LABELS[c]}
              {counts[c] > 0 && <span className="ml-1 opacity-60">{counts[c]}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        {items.map((def) => (
          <PaletteItem
            key={def.type}
            def={def}
            active={activeFixture === def.type && tool === 'fixture'}
            onClick={() => setActiveFixture(def.type)}
          />
        ))}
      </div>

      <div className="rounded-lg bg-graphite-900/60 px-2.5 py-2">
        <div className="flex items-baseline justify-between py-0.5">
          <span className="text-[10px] text-slate-500">Platziert</span>
          <span className="font-mono text-[11px] text-slate-300">
            {counts.heating + counts.sanitary + counts.ventilation}
          </span>
        </div>
        <div className="flex items-baseline justify-between py-0.5">
          <span className="text-[10px] text-slate-500">Installierte Heizleistung</span>
          <span className="font-mono text-[11px] text-accent">{installedPower.toLocaleString('de-DE')} W</span>
        </div>
      </div>

      {category === 'heating' && <FloorHeatingSection />}

      <PipeSchedule />

      <PipeStrands />

      <div className="flex gap-1.5">
        <button
          className={`chip flex-1 ${layerVisible ? 'bg-white/[0.05] text-slate-300' : 'bg-white/[0.03] text-slate-600'}`}
          onClick={() => toggleLayer(layerId)}
        >
          {layerVisible ? 'Ebene sichtbar' : 'Ebene aus'}
        </button>
        {tool === 'fixture' && (
          <button className="chip flex-1 bg-accent/15 text-accent" onClick={() => setTool('select')}>
            Platzieren beenden
          </button>
        )}
      </div>

      {activeFixture === 'underfloor' && (
        <p className="rounded-lg bg-graphite-900/60 px-2.5 py-2 text-[9.5px] leading-relaxed text-slate-400">
          <span className="text-accent">Fußbodenheizung:</span> ein Klick in einen Raum belegt
          dessen ganze Fläche — Verlegeabstand, Kreiszahl und Leistung werden aus der Raumheizlast
          ausgelegt und im Plan beschriftet. Ein zweiter Klick in denselben Raum entfernt sie.
          Ausgespart wird alles, was auf dem Estrich steht oder ihn durchdringt — Badewanne,
          Dusche, WC, Küchenzeile, Unterflurkonvektor, Bodenablauf, Stränge —, und zur Wand bleibt
          ein Randabstand. Mit gedrückter Alt-Taste — oder außerhalb jedes Raums — wird stattdessen
          wie bisher ein einzelnes Symbol gesetzt.
        </p>
      )}

      <p className="text-[9.5px] leading-relaxed text-slate-600">
        Symbol wählen, dann in den Plan klicken. Wandgebundene Objekte —
        Heizkörper, Waschtisch, Überströmelement — rasten automatisch an die
        nächste Wand und richten sich daran aus. Mit dem Auswahl-Werkzeug lassen
        sie sich verschieben; die Kennwerte stehen in den Eigenschaften.
      </p>
    </div>
  );
}

/**
 * Fußbodenheizung des Geschosses — auslegen und nachlesen, was dabei
 * herauskam.
 *
 * **Warum der Knopf hier steht und nicht im Anlagenblatt.** „Alles auslegen"
 * ist eine Zeichenhandlung: sie erzeugt Objekte im Grundriss des *aktiven
 * Geschosses*, und man will beim Drücken den Plan sehen. Genau das ist die
 * Aufgabe dieser Palette — hier wird das Werkzeug „FBH-Heizkreis" gewählt,
 * hier steht die Erklärung, dass ein Klick den ganzen Raum belegt, und der
 * Sammelknopf ist dieselbe Handlung für alle Räume auf einmal. Das
 * Anlagenblatt beschreibt dagegen die Anlage als Ganzes über alle Geschosse
 * hinweg — Erzeuger, Speicher, Kreise, Absicherung — und zeichnet nichts. Ein
 * geschossbezogener Zeichenbefehl dort wäre am falschen Ort und würde
 * außerdem eine Auswahl verlangen, die es dort gar nicht gibt.
 *
 * Der Bericht bleibt stehen, bis er weggeklickt wird: Was *nicht* belegt
 * wurde, ist die eigentliche Auskunft, und die darf nicht in einer
 * Statuszeile verschwinden. Jeder Eintrag ist anklickbar und wählt den Raum
 * im Plan aus.
 */
function FloorHeatingSection() {
  const layAll = useBimStore((s) => s.layAllFloorLoops);
  const rooms = useBimStore((s) => s.doc.rooms);
  const level = useBimStore((s) => s.doc.activeLevelId);
  const fixtures = useBimStore((s) => s.doc.fixtures);
  const setSelection = useBimStore((s) => s.setSelection);
  const [report, setReport] = useState<FloorLoopBatchReport | null>(null);

  const offen = useMemo(() => {
    const belegt = new Set(
      Object.values(fixtures)
        .filter((f) => f.type === 'underfloor' && f.params.roomCoverage === true)
        .map((f) => f.roomId),
    );
    return Object.values(rooms).filter(
      (r) => r.levelId === level && r.isHeated && r.innerPolygon.length >= 3 && !belegt.has(r.id),
    ).length;
  }, [rooms, fixtures, level]);

  const verteiler = useMemo(
    () => Object.values(fixtures).some((f) => f.type === 'manifold' && f.levelId === level),
    [fixtures, level],
  );

  return (
    <div className="space-y-1.5 rounded-lg bg-graphite-900/60 px-2.5 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="label-xs shrink-0">Fußbodenheizung</span>
        <span className="truncate text-right text-[9.5px] text-slate-600">
          {offen === 0 ? 'alle belegt' : `${offen} offen`}
        </span>
      </div>

      <button
        className="chip w-full bg-accent/12 text-accent hover:bg-accent/20 disabled:opacity-40"
        disabled={offen === 0}
        onClick={() => setReport(layAll())}
        title="Belegt jeden beheizten Raum dieses Geschosses, der noch keine Heizfläche hat"
      >
        Alle Räume dieses Geschosses auslegen
      </button>

      {!verteiler && (
        <p className="text-[9.5px] leading-relaxed text-amber-300/80">
          Kein Heizkreisverteiler im Geschoss. Jeder Heizkreis beginnt und endet an ihm — ohne ihn
          fehlt die Anbindeleitung in der Kreislänge, und die Kurven fangen an einer beliebigen
          Raumecke an.
        </p>
      )}

      {report && (
        <div className="space-y-1 border-t border-white/[0.07] pt-1">
          <div className="flex items-baseline justify-between">
            <span className="text-[10px] text-slate-500">
              {report.laid.length} belegt · {report.skipped.length} übergangen
            </span>
            <button className="text-[9.5px] text-slate-600 hover:text-slate-400" onClick={() => setReport(null)}>
              schließen
            </button>
          </div>
          {report.laid.map((r) => (
            <button
              key={r.roomId}
              onClick={() => setSelection({ kind: 'room', id: r.roomId })}
              className="flex w-full items-baseline gap-1.5 rounded px-1 py-0.5 text-left transition-colors hover:bg-white/[0.05]"
            >
              <span className="shrink-0 text-[9px] text-accent">✓</span>
              <span className="min-w-0 flex-1 truncate text-[10px] text-slate-400">{r.room}</span>
              <span className="shrink-0 font-mono text-[10.5px] text-slate-300">
                {r.area.toFixed(1).replace('.', ',')} m²
              </span>
              <span className="shrink-0 font-mono text-[10.5px] text-slate-500">{r.powerW} W</span>
            </button>
          ))}
          {report.skipped.map((r) => (
            <button
              key={r.roomId}
              onClick={() => setSelection({ kind: 'room', id: r.roomId })}
              className="flex w-full items-baseline gap-1.5 rounded px-1 py-0.5 text-left transition-colors hover:bg-white/[0.05]"
              title={r.reason}
            >
              <span className="shrink-0 text-[9px] text-slate-600">–</span>
              <span className="min-w-0 shrink-0 max-w-[45%] truncate text-[10px] text-slate-500">{r.room}</span>
              <span className="min-w-0 flex-1 truncate text-right text-[9.5px] text-slate-600">{r.reason}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Längenauszug des Rohrnetzes — Meter je Gewerk und Nennweite.
 *
 * Bewusst hier und nicht in einem eigenen Tab: wer Heizkörper setzt, verlegt
 * gleich danach die Leitungen dorthin, und die Frage „wie viele Meter DN 20"
 * stellt sich genau in diesem Moment.
 */
function PipeSchedule() {
  const pipes = useBimStore((s) => s.doc.pipes);
  const setTool = useBimStore((s) => s.setTool);
  const setSelection = useBimStore((s) => s.setSelection);

  const rows = useMemo(() => {
    const map = new Map<string, { service: PipeService; dn: number; insulation: number; length: number; runs: number }>();
    for (const run of Object.values(pipes ?? {})) {
      let length = 0;
      for (let i = 1; i < run.points.length; i++) {
        length += Math.hypot(run.points[i].x - run.points[i - 1].x, run.points[i].y - run.points[i - 1].y);
      }
      const key = `${run.service}|${run.nominalDiameter}|${run.insulation}`;
      const entry = map.get(key);
      if (entry) {
        entry.length += length;
        entry.runs += 1;
      } else {
        map.set(key, {
          service: run.service,
          dn: run.nominalDiameter,
          insulation: run.insulation,
          length,
          runs: 1,
        });
      }
    }
    return [...map.values()].sort((a, b) => a.service.localeCompare(b.service) || a.dn - b.dn);
  }, [pipes]);

  const total = rows.reduce((sum, r) => sum + r.length, 0);

  return (
    <div className="space-y-1.5 rounded-lg bg-graphite-900/60 px-2.5 py-2">
      <div className="flex items-baseline justify-between">
        <span className="label-xs">Rohrnetz</span>
        <button
          className="chip bg-accent/12 text-accent hover:bg-accent/20"
          onClick={() => setTool('pipe')}
          title="Leitung verlegen · L"
        >
          Verlegen
        </button>
      </div>

      {rows.length === 0 && (
        <p className="text-[9.5px] leading-relaxed text-slate-600">
          Noch keine Leitungen. Mit „Verlegen“ Punkte im Plan setzen — ein Klick auf ein TGA-Objekt
          schließt die Leitung dort an und beendet den Zug.
        </p>
      )}

      {rows.map((r) => (
        <button
          key={`${r.service}-${r.dn}-${r.insulation}`}
          onClick={() => {
            const first = Object.values(pipes ?? {}).find(
              (p2) => p2.service === r.service && p2.nominalDiameter === r.dn && p2.insulation === r.insulation,
            );
            if (first) setSelection({ kind: 'pipe', id: first.id });
          }}
          className="flex w-full items-baseline gap-1.5 rounded px-1 py-0.5 text-left transition-colors hover:bg-white/[0.05]"
        >
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ background: PIPE_SERVICE_COLORS[r.service] }}
          />
          <span className="min-w-0 flex-1 truncate text-[10px] text-slate-400">
            {PIPE_SERVICE_LABELS[r.service]} · DN {r.dn}
            {r.insulation > 0 ? ` · ${r.insulation} mm` : ''}
          </span>
          <span className="shrink-0 font-mono text-[10.5px] text-slate-300">{r.length.toFixed(2)} m</span>
        </button>
      ))}

      {rows.length > 0 && (
        <div className="flex items-baseline justify-between border-t border-white/[0.07] pt-1">
          <span className="text-[10px] text-slate-500">Gesamt</span>
          <span className="font-mono text-[11px] text-accent">{total.toFixed(2)} m</span>
        </div>
      )}
    </div>
  );
}

/**
 * Strangschema — wer hängt wo dran.
 *
 * Der Längenauszug darüber beantwortet die Frage des Einkaufs; diese Liste
 * beantwortet die des Hydraulikers. Die oberste Zeile ist der ungünstigste
 * Strang, und der bestimmt die Pumpe.
 */
function PipeStrands() {
  const doc = useBimStore((s) => s.doc);
  const setSelection = useBimStore((s) => s.setSelection);

  const network = useMemo(() => buildPipeNetwork(doc), [doc]);
  if (!Object.keys(doc.pipes ?? {}).length) return null;

  return (
    <div className="space-y-1.5 rounded-lg bg-graphite-900/60 px-2.5 py-2">
      <div className="flex items-baseline justify-between">
        <span className="label-xs">Stränge</span>
        <span className="text-[9.5px] text-slate-600">
          {network.sources.length} Quelle{network.sources.length === 1 ? '' : 'n'}
          {network.risers > 0 ? ` · ${network.risers} Steigstrang` : ''}
        </span>
      </div>

      {network.paths.length === 0 && network.unconnected.length === 0 && (
        <p className="text-[9.5px] leading-relaxed text-slate-600">
          Noch kein Verbraucher an einer Leitung. Beim Verlegen auf ein Symbol klicken — damit
          hängt es am Strang.
        </p>
      )}

      {network.paths.slice(0, 8).map((path, i) => (
        <button
          key={path.fixtureId}
          onClick={() => setSelection({ kind: 'fixture', id: path.fixtureId })}
          className="flex w-full items-baseline gap-1.5 rounded px-1 py-0.5 text-left transition-colors hover:bg-white/[0.05]"
          title={`über ${path.sourceLabel} · kleinste Nennweite DN ${path.minimumDiameter}`}
        >
          <span className={`shrink-0 text-[9px] ${i === 0 ? 'text-amber-400' : 'text-slate-600'}`}>
            {i === 0 ? '▲' : '·'}
          </span>
          <span className="min-w-0 flex-1 truncate text-[10px] text-slate-400">{path.label}</span>
          <span className="shrink-0 text-[9px] text-slate-600">DN {path.minimumDiameter}</span>
          <span className="shrink-0 font-mono text-[10.5px] text-slate-300">
            {path.circuitLength.toFixed(1)} m
          </span>
        </button>
      ))}

      {network.paths.length > 8 && (
        <div className="text-[9.5px] text-slate-600">… und {network.paths.length - 8} weitere</div>
      )}

      {network.unconnected.map((miss) => (
        <button
          key={miss.fixtureId}
          onClick={() => setSelection({ kind: 'fixture', id: miss.fixtureId })}
          className="flex w-full items-baseline gap-1.5 rounded px-1 py-0.5 text-left transition-colors hover:bg-white/[0.05]"
        >
          <span className="shrink-0 text-[9px] text-rose-400">✕</span>
          <span className="min-w-0 flex-1 truncate text-[10px] text-rose-300/80">{miss.label}</span>
          <span className="shrink-0 text-[9px] text-slate-600">{miss.reason}</span>
        </button>
      ))}

      {network.paths.length > 0 && (
        <p className="border-t border-white/[0.07] pt-1 text-[9.5px] leading-relaxed text-slate-600">
          Angegeben ist die Kreislänge — hin und zurück. Über sie entsteht der Druckverlust;
          gerechnet wird er in RaVia.
        </p>
      )}
    </div>
  );
}

function PaletteItem({
  def,
  active,
  onClick,
}: {
  def: FixtureDefinition;
  active: boolean;
  onClick: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = 62;
    const h = 40;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // Symbol formatfüllend einpassen — unabhängig von seiner Baugröße.
    const size = Math.max(def.length, def.depth, 0.2);
    const zoom = Math.min((w - 14) / size, (h - 14) / size);

    const preview: Fixture = {
      id: 'preview',
      type: def.type,
      category: def.category,
      levelId: 'preview',
      position: { x: 0, y: 0 },
      rotation: 0,
      length: def.length,
      depth: Math.max(def.depth, 0.05),
      elevation: def.elevation,
      label: def.label,
      params: {},
    };

    drawFixture(ctx, preview, (x) => w / 2 + x * zoom, (y) => h / 2 - y * zoom, zoom, {
      selected: false,
      hovered: false,
    });
  }, [def]);

  return (
    <button
      onClick={onClick}
      title={`${def.label}${def.params.powerW ? ` · ${def.params.powerW} W` : ''}${
        def.params.airflow ? ` · ${def.params.airflow} m³/h` : ''
      }`}
      className={`flex flex-col items-center gap-1 rounded-lg px-1 py-1.5 transition-all ${
        active ? 'bg-accent/12 shadow-glow' : 'bg-white/[0.03] hover:bg-white/[0.07]'
      }`}
      style={active ? { boxShadow: `inset 0 0 0 1px ${FIXTURE_COLORS[def.category]}55` } : undefined}
    >
      <canvas ref={canvasRef} />
      <span className="w-full truncate text-center text-[9px] leading-tight text-slate-400">{def.label}</span>
    </button>
  );
}
