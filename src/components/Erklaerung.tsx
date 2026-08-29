/**
 * Erklärung — das kleine Fragezeichen neben einem Fachbegriff.
 *
 * Ein Tooltip über `title` reicht dafür nicht: er kommt spät, verschwindet
 * beim Weiterbewegen und kann keine zwei Sätze fassen. Hier steht stattdessen
 * ein Kärtchen mit Begriff, Erklärung in Alltagssprache und — wo es sie gibt —
 * den üblichen Wertebereichen. Das ist die häufigste Rückfrage überhaupt:
 * nicht „was ist das", sondern „was trage ich denn da ein".
 *
 * Anklickbar, nicht nur bei Mausberührung: auf einem Tablet auf der Baustelle
 * gibt es kein Hover.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { GLOSSAR } from '../lib/glossar';

const CARD_WIDTH = 260;

export default function Erklaerung({ term, className = '' }: { term: string; className?: string }) {
  const entry = GLOSSAR[term];
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const box = useRef<HTMLSpanElement>(null);

  /**
   * Das Kärtchen hängt nicht im Panel, sondern am Fenster.
   *
   * Der Inspektor scrollt und schneidet ab, was über seinen Rand ragt — ein
   * Kärtchen an einem Feld in der linken Spalte wäre zur Hälfte weg. Also
   * wird es über einen Portal ins Dokument gehängt und aus der Lage des
   * Fragezeichens berechnet, an den Fensterrändern eingefangen.
   */
  useLayoutEffect(() => {
    if (!open || !box.current) return;
    const r = box.current.getBoundingClientRect();
    const left = Math.min(
      Math.max(8, r.right - CARD_WIDTH),
      window.innerWidth - CARD_WIDTH - 8,
    );
    setPos({ left, top: r.bottom + 6 });
  }, [open]);

  // Ein Klick daneben schließt das Kärtchen — sonst bleibt es stehen und
  // verdeckt genau das Feld, um das es ging.
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    // Beim Scrollen im Inspektor wandert der Bezugspunkt weg — dann lieber
    // schließen als daneben stehen bleiben.
    const scroll = () => setOpen(false);
    window.addEventListener('scroll', scroll, true);
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
      window.removeEventListener('scroll', scroll, true);
    };
  }, [open]);

  if (!entry) return null;

  return (
    <span ref={box} className={`relative inline-flex ${className}`}>
      <button
        type="button"
        aria-label={`Was bedeutet ${entry.term}?`}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={`flex h-[13px] w-[13px] shrink-0 items-center justify-center rounded-full border text-[8.5px] font-semibold leading-none transition-colors ${
          open
            ? 'border-accent/60 bg-accent/20 text-accent'
            : 'border-white/15 text-slate-500 hover:border-accent/40 hover:text-accent'
        }`}
      >
        ?
      </button>

      {open &&
        createPortal(
          // `normal-case` und `tracking-normal` sind nötig: die Beschriftungen
          // im Inspektor sind gesperrt und in Großbuchstaben gesetzt, und das
          // vererbt sich sonst auf den Erklärungstext.
          <div
            className="fixed z-[100] rounded-lg border border-white/10 bg-graphite-950 p-3 text-left normal-case tracking-normal shadow-panel"
            style={{ left: pos.left, top: pos.top, width: CARD_WIDTH }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="text-[11.5px] font-medium text-slate-200">{entry.term}</div>
            <div className="mt-0.5 text-[10.5px] leading-relaxed text-accent/80">{entry.short}</div>
            <div className="mt-1.5 text-[10.5px] leading-relaxed text-slate-400">{entry.long}</div>
            {entry.typical && (
              <div className="mt-2 rounded bg-white/[0.05] px-1.5 py-1 text-[10px] leading-relaxed text-slate-300">
                <span className="text-slate-500">Üblich: </span>
                {entry.typical}
              </div>
            )}
          </div>,
          document.body,
        )}
    </span>
  );
}

/** Beschriftung mit Fragezeichen — spart das Gefummel an jeder Einbaustelle. */
export function Beschriftung({
  text,
  term,
  className = '',
}: {
  text: string;
  term?: string;
  className?: string;
}) {
  return (
    <span className={`flex items-center gap-1 ${className}`}>
      <span className="min-w-0 truncate">{text}</span>
      {term && <Erklaerung term={term} />}
    </span>
  );
}
