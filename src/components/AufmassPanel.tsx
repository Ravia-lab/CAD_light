/**
 * AufmassPanel — die beiden Handgriffe nach einem Import.
 *
 * Ein eingelesener Grundriss ist fast fertig, aber eben nur fast: die Wände
 * stehen ein paar Grad schief, und an ein paar Stellen hört eine Wand auf,
 * ohne die nächste zu erreichen. Beides von Hand zu richten geht — es ist nur
 * mühsam und fehleranfällig, und niemand tut es gern zweimal.
 *
 * Deshalb hier zwei Knöpfe statt einer Anleitung:
 *
 *  · **Wände begradigen** zieht alles auf die Achsen, was nah genug dran ist,
 *    und lässt in Ruhe, was es nicht ist.
 *  · **Für jede Lücke** die Frage, die nur der Mensch beantworten kann: war
 *    dort eine Wand, eine Tür oder ein Durchgang? Das Programm weiß es nicht,
 *    und raten wäre hier besonders schädlich — eine Tür, die keine ist, kostet
 *    in der Heizlast dreimal so viel wie die Wand, die sie ersetzt.
 *
 * Die Zeile zu einer Lücke ist anklickbar und rückt sie in den Blick. Das ist
 * der Unterschied zwischen einer Liste und einem Werkzeug: man liest nicht
 * „irgendwo fehlt eine Wand", sondern steht davor.
 */

import { useMemo, useState } from 'react';
import { begradige } from '../lib/begradigen';
import { findeLuecken } from '../lib/luecken';
import type { LueckenSchluss } from '../lib/luecken';
import { useBimStore } from '../store/useBimStore';

const SCHLUSS: { art: LueckenSchluss; label: string; titel: string }[] = [
  { art: 'wand', label: 'Wand', titel: 'Dort steht eine Wand — der Scan hat sie nur nicht gesehen.' },
  { art: 'tuer', label: 'Tür', titel: 'Dort ist eine Tür. Die Öffnung füllt die Lücke, höchstens 1,26 m breit.' },
  { art: 'durchgang', label: 'Durchgang', titel: 'Wanddurchbruch ohne Tür — die Öffnung ist so breit wie die Lücke.' },
  { art: 'fenster', label: 'Fenster', titel: 'Dort sitzt ein Fenster, Brüstung 90 cm.' },
];

export default function AufmassPanel() {
  const doc = useBimStore((s) => s.doc);
  const begradigeWaende = useBimStore((s) => s.begradigeWaende);
  const schliesseLuecke = useBimStore((s) => s.schliesseLuecke);
  const setViewport = useBimStore((s) => s.setViewport);
  const viewport = useBimStore((s) => s.viewport);
  const [meldung, setMeldung] = useState<string | null>(null);

  const waende = useMemo(
    () => Object.values(doc.walls).filter((w) => w.levelId === doc.activeLevelId),
    [doc.walls, doc.activeLevelId],
  );

  // Wie viel Begradigen brächte? Gerechnet wird der Vorschlag, geschrieben
  // wird nichts — sonst stünde hier ein Knopf, von dem niemand weiß, was er tut.
  const vorschau = useMemo(
    () => begradige(waende, doc.nodes),
    [waende, doc.nodes],
  );

  const luecken = useMemo(
    () => findeLuecken(Object.values(doc.walls), doc.nodes, doc.activeLevelId),
    [doc.walls, doc.nodes, doc.activeLevelId],
  );

  const offeneEnden = doc.diagnostics.openEnds.length;
  if (waende.length === 0) return null;

  const schief = waende.length - vorschau.achsparallelVorher;
  const nichtsZuTun = vorschau.bewegt === 0 && luecken.length === 0;
  if (nichtsZuTun && offeneEnden === 0) return null;

  return (
    <div className="space-y-2.5 rounded-lg border border-white/[0.07] bg-white/[0.02] p-3">
      <div className="label-xs">Aufmaß nachziehen</div>

      {/* ---------------------------------------------------- Begradigen */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[11.5px] text-slate-300">Wände gerade ziehen</div>
          <button
            className="rounded-md bg-accent/15 px-2.5 py-1 text-[11px] text-accent transition hover:bg-accent/25 disabled:opacity-40 disabled:hover:bg-accent/15"
            disabled={vorschau.bewegt === 0}
            onClick={() => setMeldung(begradigeWaende().message)}
          >
            Begradigen
          </button>
        </div>
        <p className="text-[10.5px] leading-snug text-slate-500">
          {vorschau.bewegt > 0 ? (
            <>
              {schief} von {waende.length} Wänden stehen schief. Das Begradigen bewegt{' '}
              {vorschau.bewegt} Knoten, den weitesten um{' '}
              {vorschau.groessterVersatz.toFixed(3).replace('.', ',')} m.
              {vorschau.schraeg > 0 && (
                <> {vorschau.schraeg} bewusst schräge Wände bleiben, wie sie sind.</>
              )}
              {vorschau.uebersprungen > 0 && (
                <>
                  {' '}
                  {vorschau.uebersprungen} Wandzüge bleiben stehen — sie würden sich dabei zu weit
                  verschieben.
                </>
              )}
            </>
          ) : (
            <>Alle Wände stehen auf der Achse.</>
          )}
        </p>
      </div>

      {/* -------------------------------------------------------- Lücken */}
      {luecken.length > 0 && (
        <div className="space-y-1.5 border-t border-white/[0.06] pt-2.5">
          <div className="text-[11.5px] text-slate-300">
            {luecken.length} Lücke{luecken.length === 1 ? '' : 'n'} — was war dort?
          </div>
          <p className="text-[10.5px] leading-snug text-slate-500">
            An diesen Stellen hört eine Wand auf, ohne die nächste zu berühren. Das Aufmaß sagt
            nicht, warum. Solange die Frage offen ist, wird dort kein Raum erkannt.
          </p>
          <div className="space-y-1">
            {luecken.map((l) => (
              <div
                key={l.knotenId}
                className="rounded-md bg-white/[0.03] px-2 py-1.5 transition hover:bg-white/[0.06]"
              >
                <button
                  className="mb-1 block w-full text-left text-[11px] text-slate-400"
                  title="In den Blick rücken"
                  onClick={() =>
                    setViewport({
                      center: { x: (l.punkt.x + l.ziel.x) / 2, y: (l.punkt.y + l.ziel.y) / 2 },
                      zoom: Math.max(viewport.zoom, 90),
                    })
                  }
                >
                  {l.weite.toFixed(2).replace('.', ',')} m {l.geradeaus ? 'geradeaus' : 'quer'} ·{' '}
                  {l.zielKnotenId ? 'auf ein zweites loses Ende' : 'auf eine Wand'}
                </button>
                <div className="flex flex-wrap gap-1">
                  {SCHLUSS.map((s) => (
                    <button
                      key={s.art}
                      title={s.titel}
                      className="rounded bg-white/[0.06] px-2 py-0.5 text-[10.5px] text-slate-300 transition hover:bg-accent/25 hover:text-accent"
                      onClick={() => setMeldung(schliesseLuecke(l.knotenId, s.art).message)}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {luecken.length === 0 && offeneEnden > 0 && (
        <p className="border-t border-white/[0.06] pt-2.5 text-[10.5px] leading-snug text-slate-500">
          {offeneEnden} loses Wandende, aber kein Gegenüber in Reichweite. Dort fehlt kein
          Wandstück, sondern ein ganzer Zug — mit dem Wand-Werkzeug zeichnen.
        </p>
      )}

      {meldung && <div className="text-[10.5px] leading-snug text-accent/80">{meldung}</div>}
    </div>
  );
}
