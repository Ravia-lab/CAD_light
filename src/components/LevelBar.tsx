/**
 * LevelBar — Geschossumschalter in der Kopfzeile.
 *
 * Geschosse sind in einem Gebäudemodell keine Ebene wie eine Layer-Ebene,
 * sondern eigenständige Grundrisse übereinander. Deshalb sitzt der Umschalter
 * prominent in der Kopfzeile und nicht in der Ebenenliste — man wechselt
 * ständig zwischen ihnen, und man muss jederzeit sehen, wo man ist.
 */

import { useMemo } from 'react';
import { useBimStore } from '../store/useBimStore';

export default function LevelBar() {
  const levels = useBimStore((s) => s.doc.levels);
  const activeId = useBimStore((s) => s.doc.activeLevelId);
  const setActiveLevel = useBimStore((s) => s.setActiveLevel);
  const addLevel = useBimStore((s) => s.addLevel);
  const deleteLevel = useBimStore((s) => s.deleteLevel);
  // Wichtig: der Selektor gibt eine *stabile* Referenz zurück (doc.walls) und
  // die Zählung passiert im Memo. Ein Selektor, der bei jedem Aufruf ein neues
  // Objekt baut, lässt den Store-Abgleich immer „geändert" melden — und React
  // rendert endlos.
  const walls = useBimStore((s) => s.doc.walls);
  const wallsPerLevel = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const w of Object.values(walls)) counts[w.levelId] = (counts[w.levelId] ?? 0) + 1;
    return counts;
  }, [walls]);

  // Von oben nach unten anzeigen — so, wie ein Gebäude gedacht wird.
  const ordered = Object.values(levels).sort((a, b) => b.order - a.order);

  return (
    <div className="flex items-center gap-1.5">
      <span className="label-xs shrink-0">Geschoss</span>
      <div className="flex gap-0.5 rounded-lg bg-graphite-900/60 p-0.5">
        {ordered.map((level) => (
          <button
            key={level.id}
            onClick={() => setActiveLevel(level.id)}
            title={`${level.name} · OK FFB ${level.elevation.toFixed(2)} m · ${wallsPerLevel[level.id] ?? 0} Wände`}
            className={`chip whitespace-nowrap ${
              activeId === level.id ? 'bg-accent/15 text-accent' : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            {level.name}
          </button>
        ))}
      </div>

      {/*
        Nach oben und nach unten anlegen, je leer und je mit übernommenem
        Grundriss. Der Weg nach unten war im Kern längst da (`addLevel({ below
        })` legt Kellerhöhe, Sohle auf Erdreich und Geländeoberkante mit an) —
        er hatte nur keinen Knopf. Ein Keller lässt sich nicht „oben anlegen
        und dann verschieben": mit der Reihenfolge hängen Höhenlage,
        Bodenanschluss und Deckenanschluss zusammen.

        Die Pfeile zeigen die Richtung, in der das neue Geschoss entsteht.
      */}
      <button
        className="tool-btn h-7 w-7"
        title="Geschoss darüber anlegen — leer"
        onClick={() => addLevel()}
      >
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 2.5v7M5 5.5l3-3 3 3" />
          <path d="M2.5 13h11" />
        </svg>
      </button>
      <button
        className="tool-btn h-7 w-7"
        title="Geschoss darüber anlegen — Grundriss des aktuellen Geschosses übernehmen"
        onClick={() => addLevel({ copyFrom: activeId })}
      >
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
          <rect x="2.5" y="5.5" width="8" height="8" rx="1" />
          <path d="M5.5 5.5v-3h8v8h-3" />
        </svg>
      </button>

      <div className="divider-v" />

      <button
        className="tool-btn h-7 w-7"
        title="Geschoss darunter anlegen — leer. Das erste heißt KG, jedes weitere 2. UG, 3. UG …; die Sohle steht auf Erdreich, das Geschoss darüber bekommt eine Kellerdecke."
        onClick={() => addLevel({ below: true })}
      >
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2.5 3h11" />
          <path d="M8 6.5v7M5 10.5l3 3 3-3" />
        </svg>
      </button>
      <button
        className="tool-btn h-7 w-7"
        title="Geschoss darunter anlegen — Grundriss des aktuellen Geschosses übernehmen"
        onClick={() => addLevel({ below: true, copyFrom: activeId })}
      >
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
          <rect x="5.5" y="2.5" width="8" height="8" rx="1" />
          <path d="M10.5 10.5v3h-8v-8h3" />
        </svg>
      </button>
      {Object.keys(levels).length > 1 && (
        <button
          className="tool-btn h-7 w-7 hover:text-rose-300"
          title="Aktuelles Geschoss mit allem Inhalt löschen"
          onClick={() => {
            const level = levels[activeId];
            if (confirm(`Geschoss „${level?.name}" mit allen Wänden und Objekten löschen?`)) {
              deleteLevel(activeId);
            }
          }}
        >
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
            <path d="M3 5h10M6.5 5V3.5h3V5M5 5l.6 8h4.8L11 5" />
          </svg>
        </button>
      )}
    </div>
  );
}
