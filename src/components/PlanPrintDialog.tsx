/**
 * PlanPrintDialog — maßstäblicher Planausdruck.
 *
 * Der Dialog zeigt vor dem Drucken, ob der Grundriss beim gewählten Maßstab
 * überhaupt aufs Blatt passt, und schlägt sonst den nächstpassenden vor.
 * Das ist der Unterschied zu „drucken und hoffen": man sieht das Ergebnis,
 * bevor Papier verbraucht ist.
 */

import { useMemo, useState } from 'react';
import type { PaperFormat, PaperOrientation } from '../lib/planPrint';
import { buildPlanSvg, printPlan } from '../lib/planPrint';
import { GEWERKESAETZE, type GewerkesatzId } from '../lib/ebenen';
import { useBimStore } from '../store/useBimStore';

const SCALES = [20, 25, 50, 100, 200];

export default function PlanPrintDialog({ onClose }: { onClose: () => void }) {
  const doc = useBimStore((s) => s.doc);
  const setStatus = useBimStore((s) => s.setStatus);

  const [scale, setScale] = useState(50);
  const [format, setFormat] = useState<PaperFormat>('A4');
  const [orientation, setOrientation] = useState<PaperOrientation>('landscape');
  const [levelId, setLevelId] = useState(doc.activeLevelId);
  const [showRoomLabels, setShowRoomLabels] = useState(true);
  const [showDimensions, setShowDimensions] = useState(true);
  const [showFixtures, setShowFixtures] = useState(true);
  const [showAnnotations, setShowAnnotations] = useState(true);
  // Handnotizen sind Randbemerkungen — auf einem Plan, der aus dem Haus
  // geht, nur wenn man sie ausdrücklich dazulegt.
  const [showNotizen, setShowNotizen] = useState(false);
  const [showInteriorDimensions, setShowInteriorDimensions] = useState(false);
  const [showLegend, setShowLegend] = useState(true);
  const [showOpeningDimensions, setShowOpeningDimensions] = useState(true);
  /*
   * Der Gewerkesatz schaltet die Ebenen im Dokument, nicht im Dialog.
   *
   * Das ist mit Absicht: Was auf dem Blatt steht, soll dasselbe sein, was
   * auf dem Bildschirm steht. Ein Dialog mit eigenem Gewerkezustand wäre
   * eine zweite Wahrheit — man druckte das Heizungsblatt und sähe im Plan
   * weiter alles, und beim nächsten Druck wäre der Zustand wieder weg.
   *
   * Verkürzt wird der Raumstempel dagegen nur fürs Blatt: Am Bildschirm
   * stört die Fläche nicht, dort kann man hineinzoomen.
   */
  const ebenenSatz = useBimStore((s) => s.ebenenSatz);
  const [satzId, setSatzId] = useState<GewerkesatzId | null>(null);

  const options = {
    raumstempelKurz: satzId !== null && satzId !== 'grundriss',
    scale,
    format,
    orientation,
    levelId,
    showRoomLabels,
    showDimensions,
    showFixtures,
    showAnnotations,
    showNotizen,
    showInteriorDimensions,
    showLegend,
    showOpeningDimensions,
  };
  const result = useMemo(
    () => buildPlanSvg(doc, options),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      doc,
      scale,
      format,
      orientation,
      levelId,
      showRoomLabels,
      showDimensions,
      showFixtures,
      showAnnotations,
      showNotizen,
      showInteriorDimensions,
      showLegend,
      showOpeningDimensions,
      satzId,
    ],
  );

  const levels = Object.values(doc.levels).sort((a, b) => b.order - a.order);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-graphite-950/70 p-6 backdrop-blur-sm">
      <div className="panel flex max-h-full w-[880px] max-w-full flex-col overflow-hidden">
        <div className="flex shrink-0 items-center justify-between border-b border-white/[0.06] px-4 py-3">
          <div>
            <div className="text-[13px] font-semibold text-slate-100">Plan drucken</div>
            <div className="text-[10.5px] text-slate-500">
              Maßstäbliche Ausgabe — 1 m wird bei 1:{scale} zu {(1000 / scale).toFixed(1)} mm auf dem Papier
            </div>
          </div>
          <button className="tool-btn" onClick={onClose} title="Schließen">
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4">
              <path d="M3 3l10 10M13 3L3 13" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* Einstellungen */}
          <div className="w-[240px] shrink-0 space-y-3 overflow-y-auto border-r border-white/[0.06] p-3">
            <div>
              <span className="label-xs mb-1.5 block">Geschoss</span>
              <select className="field" value={levelId} onChange={(e) => setLevelId(e.target.value)}>
                {levels.map((l) => (
                  <option key={l.id} value={l.id} className="bg-graphite-850">
                    {l.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <span className="label-xs mb-1.5 block">Maßstab</span>
              <div className="flex flex-wrap gap-0.5 rounded-lg bg-graphite-900/60 p-0.5">
                {SCALES.map((s) => (
                  <button
                    key={s}
                    onClick={() => setScale(s)}
                    className={`chip flex-1 ${scale === s ? 'bg-accent/15 text-accent' : 'text-slate-500 hover:text-slate-300'}`}
                  >
                    1:{s}
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
                <span className="label-xs mb-1.5 block">Lage</span>
                <div className="flex gap-0.5 rounded-lg bg-graphite-900/60 p-0.5">
                  <button
                    onClick={() => setOrientation('portrait')}
                    className={`chip flex-1 ${orientation === 'portrait' ? 'bg-accent/15 text-accent' : 'text-slate-500'}`}
                  >
                    Hoch
                  </button>
                  <button
                    onClick={() => setOrientation('landscape')}
                    className={`chip flex-1 ${orientation === 'landscape' ? 'bg-accent/15 text-accent' : 'text-slate-500'}`}
                  >
                    Quer
                  </button>
                </div>
              </div>
            </div>

            <div className="space-y-1">
              {/*
                Vier Blätter aus einem Modell.

                Ein Planungssatz ist in der Praxis: Grundriss, Grundriss +
                Heizung, Grundriss + Sanitär, Grundriss + Lüftung. Wer ihn
                über Einzelhäkchen zusammenstellt, klickt viermal durch acht
                Schalter und hat beim dritten Blatt das Kreuz bei „Lüftung"
                vergessen — am Bildschirm fällt das nicht auf, auf der
                Baustelle schon.
              */}
              <span className="label-xs mb-1 block">Blatt</span>
              <div className="mb-2 grid grid-cols-2 gap-1">
                {GEWERKESAETZE.map((satz) => (
                  <button
                    key={satz.id}
                    title={satz.auskunft}
                    onClick={() => {
                      ebenenSatz(satz);
                      setSatzId(satz.id);
                    }}
                    className={`chip justify-center text-[11px] ${
                      satzId === satz.id ? 'bg-accent/15 text-accent' : 'text-slate-400 hover:text-slate-200'
                    }`}
                    style={{ minHeight: 30 }}
                  >
                    {satz.label}
                  </button>
                ))}
              </div>
              {satzId !== null && satzId !== 'grundriss' && (
                <p className="mb-2 text-[9.5px] leading-relaxed text-slate-500">
                  Auf dem Gewerkeblatt steht im Raumstempel nur der Name — Fläche und Volumen
                  kämen sonst mit der Technikbeschriftung ins Gehege.
                </p>
              )}

              <span className="label-xs mb-1 block">Inhalt</span>
              <Toggle label="Raumstempel" value={showRoomLabels} onChange={setShowRoomLabels} />
              <Toggle label="Maßketten" value={showDimensions} onChange={setShowDimensions} />
              <Toggle label="TGA-Symbole" value={showFixtures} onChange={setShowFixtures} />
              <Toggle label="Beschriftungen" value={showAnnotations} onChange={setShowAnnotations} />
              <Toggle label="Handnotizen" value={showNotizen} onChange={setShowNotizen} />
              <Toggle
                label="Innenmaße (lichte Weiten)"
                value={showInteriorDimensions}
                onChange={setShowInteriorDimensions}
              />
              <Toggle
                label="Fenster- und Türmaße"
                value={showOpeningDimensions}
                onChange={setShowOpeningDimensions}
              />
              <Toggle label="Legende" value={showLegend} onChange={setShowLegend} />
            </div>

            {!result.fits && (
              <div className="rounded-lg bg-orange-500/10 px-2.5 py-2">
                <p className="text-[10.5px] leading-relaxed text-orange-300">
                  Passt bei 1:{scale} nicht auf {format} {orientation === 'landscape' ? 'quer' : 'hoch'}.
                </p>
                <button
                  className="chip mt-1.5 w-full bg-orange-400/15 text-orange-200"
                  onClick={() => setScale(result.suggestedScale)}
                >
                  Auf 1:{result.suggestedScale} umstellen
                </button>
              </div>
            )}

            <button
              className="w-full rounded-lg bg-accent/15 px-3 py-2 text-[11px] font-medium text-accent shadow-glow transition-colors hover:bg-accent/25"
              onClick={() => {
                const ok = printPlan(result.svg, options);
                setStatus(
                  ok
                    ? `Plan 1:${scale} an den Druckdialog übergeben`
                    : 'Druckfenster wurde blockiert — Pop-ups für diese Seite erlauben',
                );
                if (ok) onClose();
              }}
            >
              Drucken / als PDF sichern
            </button>

            <p className="text-[9.5px] leading-relaxed text-slate-600">
              Im Druckdialog „Tatsächliche Größe" bzw. Skalierung 100 % wählen —
              sonst stimmt der Maßstab nicht. Die Maßstabsleiste auf dem Blatt
              macht das überprüfbar.
            </p>
          </div>

          {/* Vorschau */}
          <div className="min-w-0 flex-1 overflow-auto bg-graphite-950/60 p-5">
            <div
              className="mx-auto bg-white shadow-panel"
              style={{ width: `${result.sheet.w * 2.2}px` }}
              dangerouslySetInnerHTML={{
                // Für die Bildschirmvorschau die Millimeter-Maße durch eine
                // CSS-Breite ersetzen: height="auto" ist als SVG-*Attribut*
                // ungültig — das Blatt skaliert über viewBox und Stylesheet.
                __html: result.svg.replace(
                  /width="[\d.]+mm" height="[\d.]+mm"/,
                  'style="width:100%;height:auto;display:block"',
                ),
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-[10.5px] transition-colors ${
        value ? 'bg-accent/12 text-accent' : 'bg-white/[0.04] text-slate-500 hover:bg-white/[0.07]'
      }`}
    >
      {label}
      <span className={`h-1.5 w-1.5 rounded-full ${value ? 'bg-accent' : 'bg-slate-600'}`} />
    </button>
  );
}
