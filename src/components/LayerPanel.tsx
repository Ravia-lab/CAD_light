/**
 * LayerPanel — Ebenensteuerung, Raumliste und Fang-Einstellungen.
 * Alles, was den *Zustand der Zeichenfläche* betrifft, an einem Ort.
 *
 * **Sehen, sperren, drucken — drei Dinge, eine Liste.** Bis 1.26.0 konnte
 * man hier nur ein- und ausblenden; `locked` stand im Modell und tat
 * nirgends etwas. Das Sperren ist aber der Grund, aus dem ein
 * Erfassungswerkzeug Ebenen überhaupt braucht: Erst wird der Bestand
 * aufgemessen, dann steht man im Haus und setzt die Technik — und in der
 * zweiten Hälfte ist jede Wandbewegung ein Unfall, den man nicht bemerkt.
 */

import { BESTANDS_EBENEN, GEWERKESAETZE } from '../lib/ebenen';
import { useBimStore } from '../store/useBimStore';

export default function LayerPanel() {
  const doc = useBimStore((s) => s.doc);
  const toggleLayer = useBimStore((s) => s.toggleLayer);
  const sperreEbene = useBimStore((s) => s.sperreEbene);
  const sperreBestand = useBimStore((s) => s.sperreBestand);
  const ebenenSatz = useBimStore((s) => s.ebenenSatz);
  const snap = useBimStore((s) => s.snap);
  const setSnap = useBimStore((s) => s.setSnap);
  const selection = useBimStore((s) => s.selection);
  const setSelection = useBimStore((s) => s.setSelection);
  const notizenSichtbar = useBimStore((s) => s.notizenSichtbar);
  const setzeNotizenSichtbar = useBimStore((s) => s.setzeNotizenSichtbar);
  const layers = Object.values(doc.layers);
  const bestandGesperrt = BESTANDS_EBENEN.every((id) => doc.layers[id]?.locked);
  const rooms = Object.values(doc.rooms);
  const notizen = Object.values(doc.freihand ?? {}).filter((f) => f.levelId === doc.activeLevelId).length;

  return (
    <div className="space-y-4 p-3">
      {/* Gewerkessätze — vier Blätter aus einem Modell */}
      <div>
        <div className="label-xs mb-1.5">Blatt</div>
        <div className="grid grid-cols-2 gap-1">
          {GEWERKESAETZE.map((satz) => (
            <button
              key={satz.id}
              onClick={() => ebenenSatz(satz)}
              title={satz.auskunft}
              className="chip justify-center text-[11px] text-slate-400 hover:text-slate-200"
              style={{ minHeight: 32 }}
            >
              {satz.label}
            </button>
          ))}
        </div>
        <p className="mt-1 text-[9.5px] leading-relaxed text-slate-600">
          Stellt die Ebenen auf ein Gewerkeblatt. Das Referenzbild bleibt, wie es ist.
        </p>
      </div>

      {/* Bestand sperren */}
      <div className="rounded-lg bg-white/[0.03] px-2.5 py-2">
        <button
          onClick={() => sperreBestand(!bestandGesperrt)}
          className={`chip w-full justify-center text-[11px] ${
            bestandGesperrt ? 'bg-amber-500/15 text-amber-300' : 'text-slate-400 hover:text-slate-200'
          }`}
          style={{ minHeight: 34 }}
        >
          {bestandGesperrt ? 'Bestand freigeben' : 'Bestand sperren'}
        </button>
        <p className="mt-1.5 text-[9.5px] leading-relaxed text-slate-500">
          {bestandGesperrt
            ? 'Wände, Öffnungen, Räume und Durchbrüche sind sichtbar, lassen sich aber nicht anfassen. Der Zeiger greift durch sie hindurch auf das, was davor steht.'
            : 'Sperrt Wände, Öffnungen, Räume und Durchbrüche. Gedacht für den Augenblick, in dem das Aufmaß steht und die Technik gesetzt wird.'}
        </p>
      </div>

      {/* Ebenen */}
      <div>
        <div className="label-xs mb-2">Ebenen · sehen und sperren</div>
        <div className="space-y-0.5">
          {layers.map((layer) => (
            <div
              key={layer.id}
              className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-white/[0.04]"
            >
              <button
                onClick={() => toggleLayer(layer.id)}
                title={layer.visible ? 'Ausblenden' : 'Einblenden'}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                style={{ minHeight: 30 }}
              >
                <EyeIcon open={layer.visible} />
                <span
                  className="h-2 w-2 shrink-0 rounded-sm"
                  style={{ background: layer.color, opacity: layer.visible ? 1 : 0.25 }}
                />
                <span className={`truncate text-[11px] ${layer.visible ? 'text-slate-300' : 'text-slate-600'}`}>
                  {layer.name}
                </span>
              </button>
              <button
                onClick={() => sperreEbene(layer.id, !layer.locked)}
                title={
                  layer.locked
                    ? 'Gesperrt — antippen gibt frei'
                    : 'Sperren: sichtbar, aber nicht anfassbar'
                }
                className={`shrink-0 rounded px-1 ${layer.locked ? 'text-amber-300' : 'text-slate-700 hover:text-slate-400'}`}
                style={{ minHeight: 30, minWidth: 26 }}
              >
                <SchlossIcon zu={layer.locked} />
              </button>
            </div>
          ))}

          {/*
            Die Notizebene steht bei den Ebenen, gehört aber nicht zu ihnen:
            Die Ebenen darüber sind Modellebenen und liegen im Dokument, die
            Handnotizen sind eine Ansichtssache. Deshalb der eigene Eintrag
            mit Zähler statt einer Zeile mehr in der Liste — wer sie
            ausblendet, ändert nichts am Modell.
          */}
          <button
            onClick={() => setzeNotizenSichtbar(!notizenSichtbar)}
            className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 transition-colors hover:bg-white/[0.04]"
            title="Handnotizen ein- oder ausblenden. Gelöscht wird dabei nichts; auf den Plan kommen sie nur, wenn im Druckdialog „Handnotizen“ angehakt ist."
          >
            <EyeIcon open={notizenSichtbar} />
            <span
              className="h-2 w-2 shrink-0 rounded-sm"
              style={{ background: '#FBBF24', opacity: notizenSichtbar ? 1 : 0.25 }}
            />
            <span className={`text-[11px] ${notizenSichtbar ? 'text-slate-300' : 'text-slate-600'}`}>
              Handnotizen
            </span>
            <span className="ml-auto font-mono text-[10px] text-slate-600">{notizen}</span>
          </button>
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
          {/*
            „Ecken" meint alles, was kein Wandknoten ist: Geländeecken,
            Leitungspunkte, Kamin- und Treppenecken, lichte Raumecken,
            TGA-Objekte — und die Punkte des Zuges, den man gerade zieht.
          */}
          <SnapToggle
            label="Ecken"
            active={snap.points !== false}
            onClick={() => setSnap({ points: snap.points === false })}
          />
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

/**
 * Schloss — offen oder zu.
 *
 * Der Bügel steht beim offenen Schloss nach links versetzt, nicht nur
 * aufgeklappt: Bei 14 Pixeln Kantenlänge ist ein aufgeklappter Bügel vom
 * geschlossenen nicht zu unterscheiden, und ein Zustandssymbol, das seinen
 * Zustand nicht zeigt, ist schlimmer als keins.
 */
function SchlossIcon({ zu }: { zu: boolean }) {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.3">
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.2" />
      {zu ? (
        <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
      ) : (
        <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0" />
      )}
    </svg>
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
