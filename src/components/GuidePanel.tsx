/**
 * GuidePanel — „Was ist als Nächstes zu tun?"
 *
 * Ein CAD-Fenster beantwortet diese Frage nicht von selbst. Wer zum ersten
 * Mal davorsitzt, sieht Werkzeuge und Reiter, aber keine Reihenfolge — und
 * merkt erst beim Export, dass die Hälfte fehlt.
 *
 * Diese Liste liest den Modellstand und sagt in Alltagssprache, was schon
 * steht und was noch fehlt. Jeder offene Punkt hat eine Schaltfläche, die
 * genau das Werkzeug oder den Reiter öffnet, um den es geht — Erklären und
 * Hinführen in einem.
 *
 * Bewusst kein Assistent, der durch Schritte zwingt: ein Bestand wird selten
 * in der Reihenfolge aufgenommen, in der ein Programm ihn gern hätte.
 */

import { useMemo, useState } from 'react';
import { glossaryList } from '../lib/glossar';
import { validateModel } from '../lib/validation';
import { useBimStore } from '../store/useBimStore';

type Tone = 'done' | 'open' | 'blocked' | 'optional';

interface Step {
  title: string;
  tone: Tone;
  /** Was zu tun ist — in einem Satz, ohne Fachbegriff. */
  hint: string;
  action?: { label: string; run: () => void };
  /** Zahl rechts, wenn es etwas zu zählen gibt. */
  badge?: string;
}

export default function GuidePanel({ onOpenTab }: { onOpenTab: (tab: string) => void }) {
  const doc = useBimStore((s) => s.doc);
  const setTool = useBimStore((s) => s.setTool);
  const setActiveFixture = useBimStore((s) => s.setActiveFixture);
  const loadDemo = useBimStore((s) => s.loadDemo);
  const uiMode = useBimStore((s) => s.uiMode);
  const setUiMode = useBimStore((s) => s.setUiMode);

  const state = useMemo(() => {
    const report = validateModel(doc);
    const rooms = Object.values(doc.rooms);
    const walls = Object.values(doc.walls);
    const openings = Object.values(doc.openings);
    const fixtures = Object.values(doc.fixtures);
    return {
      report,
      walls: walls.length,
      rooms: rooms.length,
      openEnds: doc.diagnostics.openEnds.length,
      /**
       * Lücken zwischen zwei sauber angeschlossenen Wandenden.
       *
       * Der Schritt hing bisher allein an `openEnds` — an losen Enden mit
       * Grad 1. Genau der häufigste Fall aus der Praxis hat aber keins: an
       * einer vergessenen Wand zwischen zwei T-Stößen hat jedes Ende einen
       * Anschluss, und der Umriss ist trotzdem offen. Der Plan markiert die
       * Stelle längst (`diagnostics.closure`), die Liste meldete „alles zu".
       */
      gaps: (doc.diagnostics.closure ?? []).filter((c) => c.kind === 'gap').length,
      openings: openings.length,
      unnamed: rooms.filter((r) => r.usage === 'other').length,
      missingU: report.issues.filter((i) => i.code.includes('u-value') || i.code.includes('missing-u')).length,
      heaters: fixtures.filter((f) => f.category === 'heating' && f.params.powerW).length,
      heatingPower: fixtures.reduce((sum, f) => sum + (f.params.powerW ?? 0), 0),
      generator: doc.plant?.generatorModelId,
      schematic: Object.keys(doc.plant?.schematic.components ?? {}).length,
    };
  }, [doc]);

  const steps: Step[] = [
    {
      title: 'Grundriss zeichnen',
      tone: state.rooms > 0 ? 'done' : 'open',
      badge: state.walls ? `${state.walls} Wände` : undefined,
      hint:
        state.rooms > 0
          ? 'Die Wände stehen, die Räume wurden von selbst erkannt.'
          : 'Mit dem Wand-Werkzeug einen geschlossenen Umriss zeichnen. Jeder Klick setzt einen Punkt, Esc beendet den Zug. Sobald der Umriss zu ist, erkennt das Programm den Raum selbst.',
      action: state.rooms > 0 ? undefined : { label: 'Wand zeichnen', run: () => setTool('wall') },
    },
    {
      title: 'Alle Räume geschlossen',
      tone: state.walls === 0 ? 'blocked' : state.openEnds + state.gaps > 0 ? 'open' : 'done',
      badge:
        state.openEnds + state.gaps > 0
          ? [state.openEnds > 0 ? `${state.openEnds} offen` : '', state.gaps > 0 ? `${state.gaps} Lücke${state.gaps === 1 ? '' : 'n'}` : '']
              .filter(Boolean)
              .join(', ')
          : undefined,
      hint:
        state.openEnds > 0
          ? 'An den orangefarbenen Punkten im Plan hört eine Wand auf, ohne die nächste zu berühren. Dort wird kein Raum erkannt. Wand bis an die nächste heranziehen — sie verbindet sich dann von selbst.'
          : state.gaps > 0
            ? 'Zwischen zwei sauber angeschlossenen Wandenden fehlt ein Wandstück. Der Plan zeichnet die fehlende Wand gestrichelt — dort ist der Umriss offen, obwohl kein Wandende lose ist.'
            : 'Kein loses Wandende, keine Lücke. Jeder Umriss ist zu.',
      action:
        state.openEnds + state.gaps > 0
          ? { label: state.openEnds > 0 ? 'Wand verlängern' : 'Wand ergänzen', run: () => setTool('wall') }
          : undefined,
    },
    {
      title: 'Fenster und Türen setzen',
      tone: state.walls === 0 ? 'blocked' : state.openings > 0 ? 'done' : 'open',
      badge: state.openings ? `${state.openings} Stück` : undefined,
      hint:
        state.openings > 0
          ? 'Fenster und Türen sitzen in den Wänden und werden von der Wandfläche abgezogen.'
          : 'Fenster-Werkzeug wählen und auf die Wand klicken. Ohne Fenster rechnet die Heizlast mit einer geschlossenen Wand — und fällt zu klein aus.',
      action:
        state.openings > 0 ? undefined : { label: 'Fenster setzen', run: () => setTool('window') },
    },
    {
      title: 'Räume benennen und Nutzung wählen',
      tone: state.rooms === 0 ? 'blocked' : state.unnamed > 0 ? 'open' : 'done',
      badge: state.unnamed > 0 ? `${state.unnamed} offen` : undefined,
      hint:
        state.unnamed > 0
          ? 'Raum im Plan anklicken und im Reiter „Objekt" die Nutzung wählen — Wohnen, Bad, Schlafen. Daraus ergeben sich Solltemperatur und Luftwechsel von selbst; im Bad sind 24 °C üblich, im Flur 15.'
          : 'Jeder Raum hat eine Nutzung und damit eine Solltemperatur.',
      action:
        state.unnamed > 0 ? { label: 'Räume ansehen', run: () => onOpenTab('rooms') } : undefined,
    },
    {
      title: 'Heizkörper eintragen',
      tone: state.heaters > 0 ? 'done' : 'optional',
      badge: state.heatingPower ? `${state.heatingPower.toLocaleString('de-DE')} W` : undefined,
      hint:
        state.heaters > 0
          ? 'Die vorhandene Leistung steht je Raum im Export — damit sieht die Gegenstelle sofort, wo es knapp wird.'
          : 'Nur für den Bestand nötig: Wer erfassen will, was heute schon hängt, setzt die Heizkörper mit ihrer Leistung. Für eine reine Neuplanung kann der Schritt entfallen.',
      action:
        state.heaters > 0
          ? undefined
          : {
              label: 'Heizkörper setzen',
              run: () => {
                setActiveFixture('radiator');
                onOpenTab('tga');
              },
            },
    },
    {
      title: 'Anlage auslegen',
      tone: state.rooms === 0 ? 'blocked' : state.generator ? 'done' : 'optional',
      badge: state.schematic ? `${state.schematic} Bauteile` : undefined,
      hint: state.generator
        ? 'Gerät, Speicher, Rohre und Sicherheitsarmaturen sind gerechnet. Das Anlagenschema zeigt, woran was hängt.'
        : 'Nur nötig, wenn die Anlage mitgeplant werden soll: Im Reiter „Anlage" schlägt das Programm ein Gerät zur Heizlast vor und rechnet daraus Speicher, Rohrgrößen, Ausdehnungsgefäß und Sicherheitsventil. Für die reine Datenerfassung kann der Schritt entfallen.',
      action: { label: state.generator ? 'Anlage ansehen' : 'Anlage auslegen', run: () => onOpenTab('anlage') },
    },
    {
      title: 'Prüfung ohne Fehler',
      tone: state.rooms === 0 ? 'blocked' : state.report.errors > 0 ? 'open' : 'done',
      badge:
        state.report.errors > 0
          ? `${state.report.errors} Fehler`
          : state.report.warnings > 0
            ? `${state.report.warnings} Warnungen`
            : undefined,
      hint:
        state.report.errors > 0
          ? 'Es gibt Stellen, an denen die Rechnung nachweislich falsch würde. Der Reiter „Prüfung" nennt jede einzeln — mit einem Satz dazu, wie sie zu beheben ist.'
          : state.report.warnings > 0
            ? 'Keine Fehler. An den Warnstellen wird mit Standardannahmen gerechnet statt mit Ihren Angaben — ansehen lohnt sich, nötig ist es nicht.'
            : 'Alles vollständig. Nichts wird angenommen.',
      action: { label: 'Prüfung öffnen', run: () => onOpenTab('check') },
    },
    {
      title: 'An RaVia übergeben',
      tone: state.report.ready && state.rooms > 0 ? 'done' : 'blocked',
      hint:
        state.report.ready && state.rooms > 0
          ? 'Oben rechts „RaVia JSON" — die Datei enthält alles, was für die Heizlast gebraucht wird, samt Prüfbericht.'
          : 'Sobald die Prüfung keine Fehler mehr zeigt, steht die Übergabe bereit.',
    },
  ];

  const done = steps.filter((s) => s.tone === 'done').length;
  const relevant = steps.filter((s) => s.tone !== 'optional').length;

  return (
    <div className="space-y-3 p-3">
      <div className="flex items-baseline justify-between">
        <span className="label-xs">Was ist zu tun?</span>
        <span className="text-[10px] text-slate-500">
          {done} von {relevant} erledigt
        </span>
      </div>

      <div className="h-1 overflow-hidden rounded-full bg-white/[0.07]">
        <div
          className="h-full rounded-full bg-accent transition-all"
          style={{ width: `${Math.round((done / Math.max(1, relevant)) * 100)}%` }}
        />
      </div>

      {state.walls === 0 && (
        <div className="rounded-lg bg-accent/10 p-2.5">
          <p className="text-[10.5px] leading-relaxed text-slate-300">
            Noch nichts gezeichnet. Wer erst einmal sehen will, wie ein fertiges Projekt
            aussieht, lädt den Beispielgrundriss — er lässt sich jederzeit wieder löschen.
          </p>
          <button className="chip mt-2 bg-accent/15 text-accent" onClick={loadDemo}>
            Beispiel laden
          </button>
        </div>
      )}

      <div className="space-y-1">
        {steps.map((step) => (
          <StepRow key={step.title} step={step} />
        ))}
      </div>

      <Begriffe />

      <div className="border-t border-white/[0.06] pt-3">
        <div className="label-xs mb-1.5">Ansicht</div>
        <div className="flex gap-0.5 rounded-lg bg-graphite-900/60 p-0.5">
          {(['einfach', 'profi'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setUiMode(m)}
              className={`chip flex-1 ${
                uiMode === m ? 'bg-accent/15 text-accent' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {m === 'einfach' ? 'Einfach' : 'Fachplaner'}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[9.5px] leading-relaxed text-slate-600">
          {uiMode === 'einfach'
            ? 'Zeigt, was für die Aufnahme eines Gebäudes gebraucht wird. Wärmebrücken, Lüftung, Bauteilkatalog, Geschosse und Rohrnetz sind ausgeblendet — sie werden nicht gelöscht, nur nicht angezeigt.'
            : 'Alle Reiter und Werkzeuge sind sichtbar.'}
        </p>
      </div>
    </div>
  );
}

const TONE: Record<Tone, { mark: string; ring: string; text: string }> = {
  done: { mark: '✓', ring: 'border-emerald-400/50 text-emerald-400', text: 'text-slate-400' },
  open: { mark: '', ring: 'border-accent/60 text-accent', text: 'text-slate-300' },
  blocked: { mark: '', ring: 'border-white/10 text-slate-700', text: 'text-slate-600' },
  optional: { mark: '·', ring: 'border-white/15 text-slate-600', text: 'text-slate-500' },
};

function StepRow({ step }: { step: Step }) {
  const tone = TONE[step.tone];
  return (
    <div className="rounded-lg bg-white/[0.02] px-2.5 py-2">
      <div className="flex items-baseline gap-2">
        <span
          className={`mt-0.5 flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-full border text-[9px] leading-none ${tone.ring}`}
        >
          {tone.mark}
        </span>
        <span className={`min-w-0 flex-1 text-[11px] leading-snug ${tone.text}`}>{step.title}</span>
        {step.badge && (
          <span className="shrink-0 text-[9.5px] tabular-nums text-slate-600">{step.badge}</span>
        )}
      </div>
      <p className="ml-[23px] mt-1 text-[10px] leading-relaxed text-slate-500">{step.hint}</p>
      {step.action && step.tone !== 'blocked' && (
        <button
          onClick={step.action.run}
          className="chip ml-[23px] mt-1.5 bg-accent/12 text-accent hover:bg-accent/20"
        >
          {step.action.label}
        </button>
      )}
    </div>
  );
}

/**
 * Das Glossar als durchsuchbare Übersicht.
 *
 * Bisher stand jeder Begriff nur an dem Feld, zu dem er gehört — man fand ihn
 * also nur, wenn man ohnehin schon dort war. Wer „B-Strich" im Prüfbericht
 * liest und wissen will, was das ist, hatte keinen Weg dorthin. Diese Liste
 * ist dieser Weg, und sie steht bewusst im Start-Reiter: dort schaut nach,
 * wer nicht weiterweiß.
 */
function Begriffe() {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const alle = useMemo(() => glossaryList(), []);

  const treffer = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return alle;
    // Gesucht wird auch im Erklärtext, nicht nur im Begriff: wer „warum ist
    // mein Bad so warm" sucht, findet über das Wort „Bad" die Solltemperatur.
    return alle.filter(
      (e) =>
        e.term.toLowerCase().includes(q) ||
        e.short.toLowerCase().includes(q) ||
        e.long.toLowerCase().includes(q),
    );
  }, [alle, query]);

  return (
    <div className="border-t border-white/[0.06] pt-3">
      <button className="flex w-full items-baseline justify-between" onClick={() => setOpen((v) => !v)}>
        <span className="label-xs">Begriffe nachschlagen</span>
        <span className="text-[10px] text-slate-600">
          {alle.length} · {open ? '▾' : '▸'}
        </span>
      </button>

      {open && (
        <>
          <input
            className="field mt-1.5"
            placeholder="Begriff oder Stichwort …"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="mt-1.5 max-h-[22rem] space-y-1 overflow-y-auto pr-0.5">
            {treffer.map((e) => (
              <details key={e.id} className="rounded-lg bg-white/[0.03] px-2.5 py-1.5">
                <summary className="cursor-pointer text-[11px] text-slate-300">
                  {e.term}
                  <span className="ml-1 text-[10px] text-slate-600">{e.short}</span>
                </summary>
                <p className="mt-1 text-[10px] leading-relaxed text-slate-500">{e.long}</p>
                {e.typical && (
                  <p className="mt-1 text-[10px] leading-relaxed text-slate-600">
                    Übliche Werte: <span className="tabular-nums text-slate-400">{e.typical}</span>
                  </p>
                )}
              </details>
            ))}
            {treffer.length === 0 && (
              <p className="rounded-lg bg-white/[0.03] px-2.5 py-2 text-[10px] leading-relaxed text-slate-500">
                Nichts gefunden. Das Glossar erklärt die Begriffe, die im Programm vorkommen — steht ein Wort nicht
                darin, kommt es hier auch nicht vor.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
