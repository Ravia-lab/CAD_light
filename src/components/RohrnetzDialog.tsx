/**
 * RohrnetzDialog — Rohrnetzberechnung ansehen, prüfen und als PDF sichern.
 * ---------------------------------------------------------------------------
 * Drei Dinge in einem Fenster, weil sie beim Arbeiten zusammengehören:
 *
 *  • **Der Bericht** als Blattfolge — Grundriss, Teilstrecken, Fließwege,
 *    Einstellwerte, Nachweiskatalog. Was hier zu sehen ist, ist exakt das,
 *    was gedruckt wird; die Vorschau ist dasselbe SVG, nicht eine zweite
 *    Darstellung davon.
 *  • **Das Urteil**: nachweisfähig oder nicht, und woran es liegt. Ein
 *    Programm, das eine unvollständige Rechnung als fertig ausgibt, ist
 *    schlimmer als eines, das nichts rechnet.
 *  • **Die Wissenssuche**: zu jeder Zahl im Bericht die Quelle, offline
 *    durchsuchbar. Sie steht hier und nicht in einem eigenen Fenster, weil
 *    die Frage „woher kommt das?" immer beim Lesen des Berichts aufkommt.
 */

import { useMemo, useState } from 'react';
import { buildPipeReport, berichtsUrteil, wissensbasis } from '../lib/pipeReport';
import { buildPipeReportSheets, printPipeReport } from '../lib/pipeReportPrint';
import type { PaperFormat } from '../lib/planPrint';
import { BELASTBARKEIT_LABELS, KORPUS_LABELS, type KorpusId } from '../lib/wissensbasis';
import { useBimStore } from '../store/useBimStore';

const SCALES = [50, 100, 200];

export default function RohrnetzDialog({ onClose }: { onClose: () => void }) {
  const doc = useBimStore((s) => s.doc);
  const setStatus = useBimStore((s) => s.setStatus);

  const [format, setFormat] = useState<PaperFormat>('A4');
  const [planScale, setPlanScale] = useState(50);
  const [grundriss, setGrundriss] = useState(true);
  const [ventildruck, setVentildruck] = useState(10);
  const [blatt, setBlatt] = useState(0);
  const [frage, setFrage] = useState('');
  const [reiter, setReiter] = useState<'bericht' | 'wissen'>('bericht');

  const bericht = useMemo(
    () => buildPipeReport(doc, { ventildruck: ventildruck * 1000 }),
    [doc, ventildruck],
  );

  const druck = useMemo(
    () => buildPipeReportSheets(doc, bericht, { format, planScale, grundriss }),
    [doc, bericht, format, planScale, grundriss],
  );

  const urteil = berichtsUrteil(bericht);
  const aktuell = Math.min(blatt, druck.sheets.length - 1);

  const treffer = useMemo(() => {
    if (frage.trim().length < 2) return [];
    return wissensbasis().suche(frage, { anzahl: 12 });
  }, [frage]);

  const umfang = useMemo(() => {
    const b = wissensbasis();
    return b.korpora().map((k) => ({ id: k, n: b.umfang(k) }));
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-graphite-950/70 p-6 backdrop-blur-sm">
      <div className="panel flex max-h-full w-[1080px] max-w-full flex-col overflow-hidden">
        <div className="flex shrink-0 items-center justify-between border-b border-white/[0.06] px-4 py-3">
          <div>
            <div className="text-[13px] font-semibold text-slate-100">Rohrnetzberechnung</div>
            <div className="text-[10.5px] text-slate-500">
              {bericht.teilstrecken.length} Teilstrecken · {bericht.heizflaechen.length} Heizflächen ·{' '}
              {druck.sheets.length} Blätter
            </div>
          </div>
          <button className="tool-btn" onClick={onClose} title="Schließen">
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4">
              <path d="M3 3l10 10M13 3L3 13" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* Steuerung */}
          <div className="w-[268px] shrink-0 space-y-3 overflow-y-auto border-r border-white/[0.06] p-3">
            <div className="flex gap-0.5 rounded-lg bg-graphite-900/60 p-0.5">
              <button
                onClick={() => setReiter('bericht')}
                className={`chip flex-1 ${reiter === 'bericht' ? 'bg-accent/15 text-accent' : 'text-slate-500'}`}
              >
                Bericht
              </button>
              <button
                onClick={() => setReiter('wissen')}
                className={`chip flex-1 ${reiter === 'wissen' ? 'bg-accent/15 text-accent' : 'text-slate-500'}`}
              >
                Wissen
              </button>
            </div>

            {reiter === 'bericht' ? (
              <>
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
                    {urteil.nachweisfaehig ? 'Nachweisfähig' : 'Nicht nachweisfähig'}
                  </p>
                  {!urteil.nachweisfaehig && (
                    <ul className="mt-1 space-y-0.5">
                      {urteil.offen.slice(0, 5).map((o) => (
                        <li key={o} className="text-[10px] leading-relaxed text-orange-200/90">
                          · {o}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="space-y-1 rounded-lg bg-white/[0.03] px-2.5 py-2">
                  <Kennzahl label="Heizlast" wert={`${bericht.heizlast.wert.toFixed(1)} kW`} zusatz={bericht.heizlast.herkunft} />
                  <Kennzahl label="Volumenstrom" wert={`${bericht.volumenstrom.toFixed(3)} m³/h`} />
                  <Kennzahl
                    label="Schlechtpunkt"
                    wert={bericht.schlechtpunkt ? `${(bericht.schlechtpunkt.gesamt / 1000).toFixed(1)} kPa` : '—'}
                    zusatz={bericht.schlechtpunkt?.bezeichnung}
                  />
                  <Kennzahl
                    label="Pumpe"
                    wert={bericht.pumpe ? `${bericht.pumpe.head.toFixed(2)} m` : '—'}
                    zusatz={bericht.pumpe ? `${bericht.pumpe.flow.toFixed(2)} m³/h` : undefined}
                  />
                </div>

                <div>
                  <span className="label-xs mb-1.5 block">Auslegungsdruck Thermostatventil</span>
                  <div className="flex gap-0.5 rounded-lg bg-graphite-900/60 p-0.5">
                    {[8, 10, 15].map((v) => (
                      <button
                        key={v}
                        onClick={() => setVentildruck(v)}
                        className={`chip flex-1 ${ventildruck === v ? 'bg-accent/15 text-accent' : 'text-slate-500'}`}
                        title={
                          v === 10
                            ? 'VdZ-Leitfaden S. 25: 8–10 kPa, wenn das Rohrnetz nicht nachvollziehbar ist'
                            : v === 15
                              ? 'Nahe der Heizzentrale; zugleich die Geräuschgrenze im Teillastfall'
                              : 'Untere Empfehlung des VdZ-Leitfadens'
                        }
                      >
                        {v} kPa
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="label-xs mb-1.5 block">Format</span>
                    <div className="flex gap-0.5 rounded-lg bg-graphite-900/60 p-0.5">
                      {(['A4', 'A3'] as PaperFormat[]).map((f) => (
                        <button
                          key={f}
                          onClick={() => setFormat(f)}
                          className={`chip flex-1 ${format === f ? 'bg-accent/15 text-accent' : 'text-slate-500'}`}
                        >
                          {f}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <span className="label-xs mb-1.5 block">Grundriss</span>
                    <div className="flex gap-0.5 rounded-lg bg-graphite-900/60 p-0.5">
                      {SCALES.map((s) => (
                        <button
                          key={s}
                          onClick={() => {
                            setPlanScale(s);
                            setGrundriss(true);
                          }}
                          className={`chip flex-1 ${grundriss && planScale === s ? 'bg-accent/15 text-accent' : 'text-slate-500'}`}
                        >
                          1:{s}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {!druck.planFits && grundriss && (
                  <div className="rounded-lg bg-orange-500/10 px-2.5 py-2">
                    <p className="text-[10.5px] leading-relaxed text-orange-300">
                      Der Grundriss passt bei 1:{planScale} nicht auf {format}.
                    </p>
                    <button
                      className="chip mt-1.5 w-full bg-orange-400/15 text-orange-200"
                      onClick={() => setPlanScale(druck.planSuggestedScale)}
                    >
                      Auf 1:{druck.planSuggestedScale} umstellen
                    </button>
                  </div>
                )}

                <div>
                  <span className="label-xs mb-1.5 block">Blatt {aktuell + 1} von {druck.sheets.length}</span>
                  <div className="flex gap-1">
                    <button
                      className="chip flex-1 text-slate-400 hover:text-slate-200"
                      onClick={() => setBlatt(Math.max(0, aktuell - 1))}
                    >
                      ◀ zurück
                    </button>
                    <button
                      className="chip flex-1 text-slate-400 hover:text-slate-200"
                      onClick={() => setBlatt(Math.min(druck.sheets.length - 1, aktuell + 1))}
                    >
                      weiter ▶
                    </button>
                  </div>
                </div>

                <button
                  className="w-full rounded-lg bg-accent/15 px-3 py-2 text-[11px] font-medium text-accent shadow-glow transition-colors hover:bg-accent/25"
                  onClick={() => {
                    const ok = printPipeReport(druck, `${bericht.titel} — Rohrnetzberechnung`);
                    setStatus(
                      ok
                        ? `Rohrnetzbericht mit ${druck.sheets.length} Blättern an den Druckdialog übergeben`
                        : 'Druckfenster wurde blockiert — Pop-ups für diese Seite erlauben',
                    );
                  }}
                >
                  Als PDF sichern
                </button>

                <p className="text-[9.5px] leading-relaxed text-slate-600">
                  Im Druckdialog „Als PDF speichern" wählen und die Skalierung auf 100 % stellen. Der
                  Grundriss ist nur dann maßstäblich, wenn nicht auf die Seite skaliert wird.
                </p>
              </>
            ) : (
              <>
                <input
                  className="field"
                  placeholder={'Frage stellen — z. B. Ventilautorität, Dämmung 22 mm, Überströmventil Puffer'}
                  value={frage}
                  onChange={(e) => setFrage(e.target.value)}
                />
                <p className="text-[9.5px] leading-relaxed text-slate-600">
                  Durchsucht {wissensbasis().umfang()} Einträge in {umfang.length} getrennten Sammlungen und
                  führt die Ergebnisse über eine Rangfusion zusammen — so kommt aus jeder Sammlung ihr bester
                  Treffer nach oben und nicht nur aus der größten.
                </p>
                <div className="space-y-1">
                  {umfang.map((k) => (
                    <div key={k.id} className="flex items-center justify-between text-[10px] text-slate-500">
                      <span>{KORPUS_LABELS[k.id as KorpusId]}</span>
                      <span className="tabular-nums text-slate-400">{k.n}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Vorschau bzw. Trefferliste */}
          <div className="min-w-0 flex-1 overflow-auto bg-graphite-950/60 p-5">
            {reiter === 'bericht' ? (
              <div
                className="mx-auto bg-white shadow-panel"
                style={{ maxWidth: '900px' }}
                dangerouslySetInnerHTML={{
                  __html: (druck.sheets[aktuell] ?? '').replace(
                    /width="[\d.]+mm" height="[\d.]+mm"/,
                    'style="width:100%;height:auto;display:block"',
                  ),
                }}
              />
            ) : (
              <div className="mx-auto max-w-[760px] space-y-2">
                {!treffer.length && (
                  <p className="text-[11px] text-slate-500">
                    {frage.trim().length < 2
                      ? 'Suchbegriff eingeben. Die Wissensbasis arbeitet vollständig offline — sie steckt im Programm.'
                      : 'Kein Treffer. Andere Begriffe versuchen; die Suche kennt Abkürzungen wie THV, FBH, WP.'}
                  </p>
                )}
                {treffer.map((t) => (
                  <div key={t.eintrag.id} className="rounded-lg bg-white/[0.04] px-3 py-2.5">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-[11.5px] font-semibold text-slate-200">{t.eintrag.titel}</span>
                      <span className="shrink-0 text-[9.5px] text-slate-500">
                        {KORPUS_LABELS[t.eintrag.korpus]}
                      </span>
                    </div>
                    <p className="mt-1 text-[10.5px] leading-relaxed text-slate-400">{t.eintrag.text}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="text-[9.5px] text-slate-500">{t.eintrag.quelle}</span>
                      <span
                        className={`text-[9.5px] ${
                          t.eintrag.belastbarkeit === 'primaer'
                            ? 'text-emerald-400/80'
                            : t.eintrag.belastbarkeit === 'sekundaer'
                              ? 'text-sky-400/80'
                              : 'text-orange-300/80'
                        }`}
                      >
                        {BELASTBARKEIT_LABELS[t.eintrag.belastbarkeit]}
                      </span>
                      {t.eintrag.url && (
                        <a
                          href={t.eintrag.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[9.5px] text-accent hover:underline"
                        >
                          Quelle öffnen
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Kennzahl({ label, wert, zusatz }: { label: string; wert: string; zusatz?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-[10px] text-slate-500">{label}</span>
      <span className="text-right">
        <span className="text-[11px] font-medium tabular-nums text-slate-200">{wert}</span>
        {zusatz && <span className="ml-1.5 text-[9.5px] text-slate-600">{zusatz}</span>}
      </span>
    </div>
  );
}
