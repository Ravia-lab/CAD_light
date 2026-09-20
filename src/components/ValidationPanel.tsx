/**
 * ValidationPanel — der Prüfbericht vor der Übergabe.
 *
 * Jeder Befund ist anklickbar und springt auf das betroffene Objekt. Das ist
 * der Unterschied zwischen einer Fehlerliste und einem Werkzeug: man liest
 * nicht „irgendeine Wand hat keinen U-Wert", sondern klickt und steht davor.
 */

import { useMemo } from 'react';
import type { ValidationIssue } from '../types/bim';
import { validateModel } from '../lib/validation';
import { mindestens } from '../lib/uimodus';
import { useBimStore } from '../store/useBimStore';

const SEVERITY_STYLE: Record<ValidationIssue['severity'], { dot: string; text: string; bg: string; label: string }> = {
  error: { dot: 'bg-rose-400', text: 'text-rose-300', bg: 'hover:bg-rose-500/10', label: 'Fehler' },
  warning: { dot: 'bg-orange-400', text: 'text-orange-300', bg: 'hover:bg-orange-500/10', label: 'Warnung' },
  info: { dot: 'bg-sky-400', text: 'text-sky-300', bg: 'hover:bg-sky-500/10', label: 'Hinweis' },
};

export default function ValidationPanel() {
  const doc = useBimStore((s) => s.doc);
  const uiMode = useBimStore((s) => s.uiMode);
  const setSelection = useBimStore((s) => s.setSelection);
  const setStatus = useBimStore((s) => s.setStatus);
  const hebeHervor = useBimStore((s) => s.hebeHervor);
  const showDiagnostics = useBimStore((s) => s.showDiagnostics);
  const toggleDiagnostics = useBimStore((s) => s.toggleDiagnostics);

  const report = useMemo(() => validateModel(doc), [doc]);

  const grouped = useMemo(() => {
    const order: ValidationIssue['severity'][] = ['error', 'warning', 'info'];
    return order
      .map((severity) => ({ severity, items: report.issues.filter((i) => i.severity === severity) }))
      .filter((g) => g.items.length > 0);
  }, [report]);

  return (
    <div className="space-y-3 p-3">
      <div className="label-xs">Modellprüfung</div>

      {/* Ampel */}
      <div
        className={`rounded-lg px-2.5 py-2.5 ${
          report.errors > 0
            ? 'bg-rose-500/10'
            : report.warnings > 0
              ? 'bg-orange-500/10'
              : 'bg-emerald-500/10'
        }`}
      >
        <div className="flex items-center gap-2">
          <span
            className={`h-2 w-2 rounded-full ${
              report.errors > 0 ? 'bg-rose-400' : report.warnings > 0 ? 'bg-orange-400' : 'bg-emerald-400'
            }`}
          />
          <span
            className={`text-[11px] font-medium ${
              report.errors > 0 ? 'text-rose-300' : report.warnings > 0 ? 'text-orange-300' : 'text-emerald-300'
            }`}
          >
            {report.errors > 0
              ? 'Nicht rechenfähig'
              : report.warnings > 0
                ? 'Rechenfähig mit Annahmen'
                : 'Vollständig'}
          </span>
        </div>
        <p className="mt-1 text-[10px] leading-relaxed text-slate-400">
          {report.errors > 0
            ? 'Fehler führen zu falschen Ergebnissen in der Heizlast. Bitte zuerst beheben.'
            : report.warnings > 0
              ? 'Es wird gerechnet, aber an den markierten Stellen mit Standardannahmen statt mit Ihren Angaben.'
              : 'Alle für die Heizlastberechnung nötigen Angaben liegen vor.'}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        <Counter label="Fehler" value={report.errors} tone="error" />
        <Counter label="Warnungen" value={report.warnings} tone="warning" />
        <Counter label="Hinweise" value={report.infos} tone="info" />
      </div>

      {grouped.length === 0 && (
        <p className="text-[10px] leading-relaxed text-slate-600">
          Keine Beanstandungen. Der Export enthält für jeden Raum alle Hüllbauteile
          mit U-Wert, Randbedingung und Nachbartemperatur.
        </p>
      )}

      {grouped.map((group) => (
        <div key={group.severity}>
          <div className="label-xs mb-1.5">
            {SEVERITY_STYLE[group.severity].label} · {group.items.length}
          </div>
          <div className="space-y-0.5">
            {group.items.map((issue, index) => {
              const style = SEVERITY_STYLE[issue.severity];
              // Anspringbar ist auch, was kein Objekt hat: eine fehlende Wand
              // hat nur einen Ort. Dann rückt die Ansicht dorthin.
              const clickable = Boolean(issue.target || issue.position);
              return (
                <button
                  key={`${issue.code}-${index}`}
                  disabled={!clickable}
                  onClick={() => {
                    if (!issue.target && !issue.position) return;
                    /*
                     * **Hinrücken reicht nicht.** Die Befunde, die man
                     * anspringt, sind klein: eine Wand von 0,0 cm Länge,
                     * eine Bohrung von 68 mm, eine Öffnung, die zwei
                     * Zentimeter über die Wand ragt. Bei 60 Bildpunkten je
                     * Meter ist das ein Pixel — man steht davor und sieht
                     * nichts. `hebeHervor` rückt hin, zoomt heran (aber
                     * zieht niemanden heraus, der schon näher dran ist) und
                     * setzt für vier Sekunden eine gelbe Marke.
                     */
                    if (issue.position) hebeHervor(issue.position);
                    // 'liste': der Inspektor bleibt auf der Prüfung stehen,
                    // damit man den nächsten Befund noch findet.
                    if (issue.target) setSelection(issue.target, 'liste');
                    // Die Marke im Plan nützt nichts, wenn die Diagnoseanzeige
                    // gerade aus ist — wer den Befund anspringt, will ihn sehen.
                    if (issue.position && !showDiagnostics) toggleDiagnostics();
                    setStatus(issue.message);
                  }}
                  className={`flex w-full gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${style.bg} ${
                    clickable ? 'cursor-pointer' : 'cursor-default'
                  }`}
                >
                  <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${style.dot}`} />
                  <span className="min-w-0">
                    <span className="block text-[10.5px] leading-snug text-slate-300">{issue.message}</span>
                    {issue.remedy && (
                      <span className="mt-1 block text-[10px] leading-relaxed text-slate-500">
                        <span className="text-slate-600">So beheben Sie das: </span>
                        {issue.remedy}
                      </span>
                    )}
                    {/* Der Code ist für die Fehlersuche im Programm da, nicht
                        für den Anwender — im einfachen Modus bleibt er weg. */}
                    {mindestens(uiMode, 'profi') && (
                      <span className="mt-0.5 block font-mono text-[9px] text-slate-700">{issue.code}</span>
                    )}
                    {clickable && (
                      <span className="mt-0.5 block text-[9px] text-accent/70">
                        Anklicken springt hin, zoomt heran und markiert die Stelle
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function Counter({ label, value, tone }: { label: string; value: number; tone: ValidationIssue['severity'] }) {
  const style = SEVERITY_STYLE[tone];
  return (
    <div className="rounded-lg bg-graphite-900/60 px-2 py-1.5 text-center">
      <div className={`font-mono text-sm leading-none ${value > 0 ? style.text : 'text-slate-600'}`}>{value}</div>
      <div className="label-xs mt-1 whitespace-nowrap">{label}</div>
    </div>
  );
}
