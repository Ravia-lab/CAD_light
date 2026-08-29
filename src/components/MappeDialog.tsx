/**
 * MappeDialog — die Projektmappe ansehen und drucken.
 * ---------------------------------------------------------------------------
 * Drei Dinge in einem Fenster, weil sie beim Übergeben zusammengehören:
 *
 *  • **Das Inhaltsverzeichnis** links, mit denselben Blattnummern, die auch
 *    auf Blatt 2 stehen. Wer prüfen will, ob die Mappe vollständig ist,
 *    braucht diese Liste, bevor er druckt.
 *  • **Die Vorschau** rechts — dasselbe Dokument, das gedruckt wird, nicht
 *    eine zweite Darstellung davon. Sie steht in einem eigenen Rahmen, weil
 *    die Mappe ihr eigenes Stilblatt mitbringt: hineinkopiert in die
 *    Oberfläche würde sie deren Schrift und Farben überschreiben.
 *  • **Der Vorbehalt**: nachweisfähig oder nicht, und woran es liegt. Ein
 *    Programm, das eine unvollständige Rechnung als fertiges Übergabedokument
 *    ausgibt, ist schlimmer als eines, das nichts druckt.
 *
 * Der Dialog rechnet nichts. Alles, was er zeigt, kommt aus
 * `buildProjektMappe`; die Trennung ist dieselbe wie bei allen Druckwegen
 * dieses Programms und der Grund, warum sich die Mappe ohne Browser prüfen
 * lässt.
 */

import { useMemo, useState } from 'react';
import { buildPipeReport, berichtsUrteil } from '../lib/pipeReport';
import { buildProjektMappe, printProjektMappe, type MappeFormat } from '../lib/projektMappe';
import { useBimStore } from '../store/useBimStore';

/** Maßstäbe der Normreihe, die für einen Grundriss in Frage kommen. */
const MASSSTAEBE = [50, 100, 200];

export default function MappeDialog({ onClose }: { onClose: () => void }) {
  const doc = useBimStore((s) => s.doc);
  const setStatus = useBimStore((s) => s.setStatus);

  const [format, setFormat] = useState<MappeFormat>('A4');
  const [planMassstab, setPlanMassstab] = useState(100);
  const [anlagenName, setAnlagenName] = useState('Heizungsanlage');
  const [bearbeiter, setBearbeiter] = useState('');

  /*
   * Das Datum wird einmal je geöffnetem Fenster genommen.
   *
   * Der Aufbau liest keine Uhr — sonst trüge eine Mappe, die man zweimal
   * druckt, zwei Daten, und niemand könnte sagen, welche die aktuelle ist.
   */
  const datum = useMemo(() => new Date().toLocaleDateString('de-DE'), []);

  /*
   * Der Rohrnetzbericht wird hier gebaut und hineingereicht, nicht in der
   * Mappe selbst: das Berichtsfenster daneben rechnet mit derselben Funktion,
   * und beide sollen dieselben Zahlen zeigen.
   */
  const bericht = useMemo(() => buildPipeReport(doc), [doc]);
  const urteil = useMemo(() => berichtsUrteil(bericht), [bericht]);

  /*
   * Verkleinerungsfaktor der Vorschau.
   *
   * Er hängt am Blattformat und nicht an der Fenstergröße: die Steuerspalte
   * ist fest, das Fenster ebenfalls, und ein gemessener Faktor brächte einen
   * Beobachter mit, der bei jedem Zeichenstrich neu rechnet. A4 quer braucht
   * 297 mm Ansichtsbreite, A3 quer 420 mm — daher das Verhältnis.
   */
  const vorschauFaktor = format === 'A3' ? 0.5 : 0.7;

  const mappe = useMemo(
    () =>
      buildProjektMappe(doc, {
        datum,
        bericht,
        format,
        planMassstab,
        anlagenName: anlagenName.trim() || 'Heizungsanlage',
        bearbeiter: bearbeiter.trim() || undefined,
      }),
    [doc, bericht, datum, format, planMassstab, anlagenName, bearbeiter],
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-graphite-950/70 p-6 backdrop-blur-sm">
      <div className="panel flex max-h-full w-[1120px] max-w-full flex-col overflow-hidden">
        <div className="flex shrink-0 items-center justify-between border-b border-white/[0.06] px-4 py-3">
          <div>
            <div className="text-[13px] font-semibold text-slate-100">Projektmappe</div>
            <div className="text-[10.5px] text-slate-500">
              {mappe.kapitel.length} Kapitel · {mappe.blaetter.length} Blätter · {format} quer · Grundrisse M 1:
              {mappe.planMassstab}
            </div>
          </div>
          <button className="tool-btn" onClick={onClose} title="Schließen">
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4">
              <path d="M3 3l10 10M13 3L3 13" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* Steuerung und Inhaltsverzeichnis */}
          <div className="w-[300px] shrink-0 space-y-3 overflow-y-auto border-r border-white/[0.06] p-3">
            <div
              className={`rounded-lg px-2.5 py-2 ${
                urteil.nachweisfaehig ? 'bg-emerald-500/10' : 'bg-orange-500/10'
              }`}
            >
              <p
                className={`text-[11px] font-semibold ${
                  urteil.nachweisfaehig ? 'text-emerald-300' : 'text-orange-300'
                }`}
              >
                {urteil.nachweisfaehig ? 'Nachweisfähig' : 'Vorbemessung, kein Nachweis'}
              </p>
              <p className="mt-1 text-[10px] leading-relaxed text-slate-400">
                {urteil.nachweisfaehig
                  ? 'Alle sieben Pflichtangaben nach § 60c Abs. 4 GModG liegen vor. Das Deckblatt sagt es, der Nachweiskatalog belegt es.'
                  : `Offen: ${urteil.offen.join('; ')}.`}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="label-xs mb-1.5 block">Format</span>
                <div className="flex gap-0.5 rounded-lg bg-graphite-900/60 p-0.5">
                  {(['A4', 'A3'] as MappeFormat[]).map((f) => (
                    <button
                      key={f}
                      onClick={() => setFormat(f)}
                      className={`chip flex-1 ${format === f ? 'bg-accent/15 text-accent' : 'text-slate-500'}`}
                      title="Die ganze Mappe steht quer — die Teilstreckentabelle führt sechzehn Spalten und passt hochkant nicht."
                    >
                      {f} quer
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <span className="label-xs mb-1.5 block">Grundriss</span>
                <div className="flex gap-0.5 rounded-lg bg-graphite-900/60 p-0.5">
                  {MASSSTAEBE.map((s) => (
                    <button
                      key={s}
                      onClick={() => setPlanMassstab(s)}
                      className={`chip flex-1 ${planMassstab === s ? 'bg-accent/15 text-accent' : 'text-slate-500'}`}
                    >
                      1:{s}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <span className="label-xs mb-1.5 block">Anlagenbezeichnung</span>
              <input
                className="field"
                value={anlagenName}
                onChange={(e) => setAnlagenName(e.target.value)}
                placeholder="Heizungsanlage"
              />
            </div>
            <div>
              <span className="label-xs mb-1.5 block">Bearbeiter</span>
              <input
                className="field"
                value={bearbeiter}
                onChange={(e) => setBearbeiter(e.target.value)}
                placeholder="RaVia CAD Light"
              />
            </div>

            {mappe.hinweise.map((h) => (
              <div key={h} className="rounded-lg bg-orange-500/10 px-2.5 py-2">
                <p className="text-[10.5px] leading-relaxed text-orange-300">{h}</p>
              </div>
            ))}

            <div>
              <span className="label-xs mb-1.5 block">Inhalt</span>
              <div className="space-y-0.5">
                {mappe.kapitel.map((k) => (
                  <div key={k.id} className="flex items-baseline justify-between gap-2 py-0.5">
                    <span className="min-w-0">
                      <span className="mr-1.5 text-[10px] tabular-nums text-slate-600">{k.nummer}</span>
                      <span className={`text-[10.5px] ${k.inhalt ? 'text-slate-300' : 'text-slate-500'}`}>
                        {k.titel}
                      </span>
                      {!k.inhalt && (
                        <span className="block pl-4 text-[9.5px] leading-snug text-orange-300/70">{k.grund}</span>
                      )}
                    </span>
                    <span className="shrink-0 text-[10px] tabular-nums text-slate-500">{k.blattBereich}</span>
                  </div>
                ))}
              </div>
            </div>

            <button
              className="w-full rounded-lg bg-accent/15 px-3 py-2 text-[11px] font-medium text-accent shadow-glow transition-colors hover:bg-accent/25"
              onClick={() => {
                const ok = printProjektMappe(mappe.html, mappe.titel);
                setStatus(
                  ok
                    ? `Projektmappe mit ${mappe.blaetter.length} Blättern an den Druckdialog übergeben`
                    : 'Druckfenster wurde blockiert — Pop-ups für diese Seite erlauben',
                );
              }}
            >
              Als PDF sichern
            </button>

            <p className="text-[9.5px] leading-relaxed text-slate-600">
              Im Druckdialog „Als PDF speichern" wählen und die Skalierung auf 100 % stellen. Die Grundrisse sind
              nur dann maßstäblich, wenn nicht auf die Seite skaliert wird. Gezählt werden Blätter, nicht
              Druckseiten: ein Zeichnungsblatt belegt genau eine Seite, ein Textkapitel darf überlaufen.
            </p>
          </div>

          {/* Vorschau — im eigenen Rahmen, damit das Stilblatt der Mappe die
              Oberfläche nicht mitgestaltet.

              Verkleinert wird der Rahmen und nicht das Dokument: ein Blatt ist
              297 bzw. 420 mm breit und passt in kein Fenster dieser Größe. Der
              Rahmen bekommt deshalb die volle Blattbreite als Ansichtsfläche
              und wird als Ganzes herunterskaliert — dieselbe Zeichnung, nur
              kleiner. Würde stattdessen das Blatt im Stilblatt schmaler
              gesetzt, zeigte die Vorschau ein anderes Layout als der Druck,
              und genau das soll sie nicht. */}
          <div className="relative min-w-0 flex-1 overflow-hidden bg-graphite-950/60">
            <iframe
              title="Vorschau der Projektmappe"
              className="absolute left-0 top-0 origin-top-left border-0"
              style={{
                width: `calc(100% / ${vorschauFaktor})`,
                height: `calc(100% / ${vorschauFaktor})`,
                transform: `scale(${vorschauFaktor})`,
              }}
              srcDoc={mappe.html}
              /*
               * `allow-same-origin` ohne `allow-scripts`: die Vorschau bleibt
               * ein totes Dokument — kein Skript läuft, auch keines, das über
               * einen frei eingetippten Projektnamen hineingeraten wäre —,
               * und die Oberfläche darf trotzdem hineinsehen. Das braucht der
               * Rauchtest, der die Blattmaße am gerenderten Blatt misst statt
               * an der Zeichenkette daneben.
               */
              sandbox="allow-same-origin"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
