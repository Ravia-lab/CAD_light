/**
 * Protokoll — eingeklappt, mit einer Zeile zum Aufklappen (seit 1.71.0).
 * ---------------------------------------------------------------------------
 *
 * Gemeldet am 02.10.2026: „Das Protokoll sollte immer ausgeblendet sein, nur
 * eine Nachricht unten zum Einblenden — das impliziert, dass da Fehler sind."
 * Ein offen stehender Block aus orangefarbenen Sätzen liest sich wie eine
 * Fehlerliste, auch wenn darin nur steht, wie gerechnet wurde. Deshalb ist
 * das Protokoll zu und steht als **eine** Zeile unter dem Ergebnis.
 *
 * Was ein echter Fehler ist, verschwindet dabei nicht: Die Zeile nennt die
 * Zahl der Fehler und Warnungen, und der Fehler, an dem eine Auslegung
 * scheitert, steht ohnehin in der Statuszeile.
 */

import { useState } from 'react';

export interface ProtokollEintrag {
  severity: 'info' | 'warn' | 'error';
  text: string;
}

export default function Protokoll({
  eintraege,
  titel = 'Protokoll',
}: {
  eintraege: readonly ProtokollEintrag[];
  titel?: string;
}) {
  const [offen, setOffen] = useState(false);
  if (!eintraege.length) return null;
  const fehler = eintraege.filter((e) => e.severity === 'error').length;
  const warnungen = eintraege.filter((e) => e.severity === 'warn').length;
  const zusatz = [
    fehler ? `${fehler} ${fehler === 1 ? 'Fehler' : 'Fehler'}` : '',
    warnungen ? `${warnungen} ${warnungen === 1 ? 'Hinweis zur Prüfung' : 'Hinweise zur Prüfung'}` : '',
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <div className="mt-2" data-protokoll>
      <button
        type="button"
        className="w-full text-left text-[10px] text-slate-500 underline decoration-dotted underline-offset-2 hover:text-slate-300"
        onClick={() => setOffen((o) => !o)}
        aria-expanded={offen}
        data-protokoll-schalter
      >
        {offen ? `${titel} ausblenden` : `${titel} einblenden`} · {eintraege.length}{' '}
        {eintraege.length === 1 ? 'Eintrag' : 'Einträge'}
        {zusatz ? <span className={fehler ? ' text-red-300' : ''}> ({zusatz})</span> : null}
      </button>
      {offen && (
        <div className="mt-1 space-y-1" data-protokoll-inhalt>
          {eintraege.map((e, i) => (
            <p
              key={i}
              className={`text-[10px] leading-relaxed ${
                e.severity === 'error' ? 'text-red-300' : e.severity === 'warn' ? 'text-orange-200/90' : 'text-slate-400'
              }`}
            >
              {e.text}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
