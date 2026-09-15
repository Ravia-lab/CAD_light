/**
 * SkizzenLeiste — was aus dem Freihandstrich geworden ist, und was damit
 * geschehen soll.
 *
 * **Dieselbe Regel wie bei der Bilderkennung: das Programm schlägt vor, der
 * Planer entscheidet.** Ein Strich mit dem Stift ist in einer halben Sekunde
 * gezogen; eine Erkennung, die daraus ungefragt Wände anlegt, hätte nach
 * drei Strichen ein Modell erzeugt, das niemand gezeichnet hat. Deshalb
 * dieselbe Leiste an derselben Stelle wie beim Auto-Trace — wer beides
 * benutzt, muss nichts Neues lernen.
 *
 * Die Leiste sagt drei Dinge, und zwar in dieser Reihenfolge: **was erkannt
 * wurde**, **womit es angelegt würde** (Stärke und Art lassen sich hier noch
 * ändern, ohne neu zu zeichnen) und **was zu tun ist**.
 */

import { useState } from 'react';
import { WALL_THICKNESS_PRESETS } from '../types/bim';
import type { WallType } from '../types/bim';
import { useBimStore } from '../store/useBimStore';

const ARTEN: { id: WallType; label: string }[] = [
  { id: 'exterior', label: 'Außen' },
  { id: 'interior', label: 'Innen' },
];

export default function SkizzenLeiste() {
  const skizze = useBimStore((s) => s.skizze);
  const uebernimm = useBimStore((s) => s.uebernimmSkizze);
  const verwirf = useBimStore((s) => s.verwirfSkizze);
  const zurueck = useBimStore((s) => s.nimmZugZurueck);
  const setzeWand = useBimStore((s) => s.setzeSkizzenwand);
  /*
   * Die Leiste lässt sich zusammenklappen — und das ist kein Zierrat.
   *
   * Sie liegt unten in der Mitte über der Zeichenfläche und fängt dort jede
   * Berührung ab. Wer weiterzeichnen will und dabei im unteren Blattbereich
   * ansetzt, trifft die Leiste statt den Plan; für den Anwender sieht das aus,
   * als ginge es „nicht mehr weiter". Zusammengeklappt bleibt nur eine
   * schmale Zeile stehen.
   */
  const [offen, setOffen] = useState(true);

  if (!skizze) return null;

  const gesamt = skizze.strecken.reduce((s, x) => s + x.laenge, 0);
  const schraeg = skizze.strecken.filter((x) => !x.ausgerichtet).length;
  const zuege = skizze.zuege.length;

  if (!offen) {
    return (
      <div className="pointer-events-none absolute bottom-5 left-1/2 z-10 -translate-x-1/2">
        <button
          className="panel pointer-events-auto flex items-center gap-2 px-3 py-2 text-[12px] text-slate-200"
          onClick={() => setOffen(true)}
          title="Skizzenleiste wieder aufklappen"
        >
          <span className="h-2 w-2 rounded-full bg-fuchsia-400" />
          {skizze.strecken.length} Wände im Vorschlag
          <span className="text-slate-500">▲</span>
        </button>
      </div>
    );
  }

  return (
    <div className="pointer-events-none absolute bottom-5 left-1/2 z-10 w-[min(94vw,44rem)] -translate-x-1/2">
      <div className="panel pointer-events-auto flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
        {/* Was erkannt wurde */}
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-fuchsia-400" />
          <span className="text-[12px] text-slate-200">
            {skizze.strecken.length} Wände · {gesamt.toFixed(2).replace('.', ',')} m
          </span>
          {zuege > 1 && <span className="chip bg-white/[0.06] text-slate-300">{zuege} Züge</span>}
          {skizze.ring && <span className="chip bg-emerald-400/15 text-emerald-300">Umriss zu</span>}
          {schraeg > 0 && <span className="chip bg-amber-400/15 text-amber-300">{schraeg}× schräg</span>}
          <button
            className="chip bg-white/[0.05] text-slate-400 hover:text-slate-200"
            onClick={() => setOffen(false)}
            title="Leiste zusammenklappen — sie liegt sonst über dem unteren Teil der Zeichenfläche."
          >
            ▼
          </button>
        </div>

        <div className="divider-v hidden sm:block" />

        {/* Womit sie angelegt würden */}
        <div className="flex items-center gap-1">
          <span className="label-xs mr-1">Stärke</span>
          {WALL_THICKNESS_PRESETS.map((t) => (
            <button
              key={t}
              className={`chip tabular-nums ${
                Math.abs(t - skizze.staerke) < 1e-6
                  ? 'bg-accent/15 text-accent'
                  : 'bg-white/[0.05] text-slate-400 hover:text-slate-200'
              }`}
              onClick={() => setzeWand({ staerke: t })}
              title={`Alle Vorschläge mit ${(t * 100).toFixed(1).replace('.', ',')} cm anlegen`}
            >
              {(t * 100).toFixed(1).replace('.', ',')}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          {ARTEN.map((a) => (
            <button
              key={a.id}
              className={`chip ${
                skizze.art === a.id ? 'bg-accent/15 text-accent' : 'bg-white/[0.05] text-slate-400 hover:text-slate-200'
              }`}
              onClick={() => setzeWand({ art: a.id })}
            >
              {a.label}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        {/* Was zu tun ist */}
        <div className="flex items-center gap-1.5">
          {zuege > 1 && (
            <button
              className="chip bg-white/[0.05] text-slate-300 hover:bg-white/[0.1]"
              onClick={zurueck}
              title="Nur den zuletzt gezogenen Strich aus dem Vorschlag nehmen."
            >
              Letzter Zug zurück
            </button>
          )}
          <button
            className="chip bg-white/[0.05] text-slate-300 hover:bg-white/[0.1]"
            onClick={verwirf}
            title="Den Vorschlag wegwerfen — im Modell ändert sich nichts."
          >
            Verwerfen
          </button>
          <button
            className="chip bg-accent/15 px-3 text-accent hover:bg-accent/25"
            onClick={() => uebernimm()}
            title="Aus den Vorschlägen echte Wände machen. Ein Schritt, mit Strg+Z zurücknehmbar."
          >
            Übernehmen
          </button>
        </div>

        {/* Was der Anwender wissen sollte */}
        <p className="w-full text-[10.5px] leading-snug text-slate-500">
          {skizze.hinweise.length > 0 && <>{skizze.hinweise.join(' ')} </>}
          Weiterzeichnen geht: jeder weitere Strich kommt zum Vorschlag dazu.
        </p>
      </div>
    </div>
  );
}
