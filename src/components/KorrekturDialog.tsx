/**
 * Der Dialog „Grundriss prüfen und korrigieren".
 * ---------------------------------------------------------------------------
 * Verdrahtet nur — was gesucht und wie korrigiert wird, steht in
 * `lib/autokorrektur.ts`.
 *
 * Aufbau: je Art von Mangel eine Gruppe mit Haken, Zahl und einem Satz, was
 * passiert. Jede Gruppe lässt sich aufklappen; jede Stelle darin rückt mit
 * einem Tipp in den Blick, auch in einem anderen Geschoss. Lücken stehen
 * einzeln da, jede mit der Frage, was dort war — ohne Antwort bleiben sie
 * offen. Unten ein Knopf, der alles Angehakte in **einem** Schritt ausführt;
 * Strg+Z nimmt es zusammen zurück.
 *
 * Der Dialog rechnet mit jedem Modellstand neu. Nach dem Ausführen steht also
 * da, was übrig ist — und im Regelfall ist das nur noch, was eine Antwort
 * braucht.
 */

import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useBimStore } from '../store/useBimStore';
import { useKorrekturDialog } from '../store/korrekturDialog';
import { planeKorrektur, type KorrekturAuswahl, type Korrekturplan } from '../lib/autokorrektur';
import type { LueckenSchluss } from '../lib/luecken';
import type { Vec2 } from '../types/bim';
import { dez } from '../lib/zahl';

const KNOPF =
  'min-h-[36px] rounded-lg px-3 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40';

type Gruppe = 'anschluesse' | 'stummel' | 'begradigen' | 'leitungen' | 'kleineRaeume';

/** Antworten auf eine Lücke. „offen" heißt: nichts tun. */
const ANTWORTEN: { art: LueckenSchluss | 'offen'; label: string }[] = [
  { art: 'offen', label: 'offen lassen' },
  { art: 'wand', label: 'Wand' },
  { art: 'tuer', label: 'Tür' },
  { art: 'durchgang', label: 'Durchgang' },
  { art: 'fenster', label: 'Fenster' },
];

const cm = (m: number): string => `${dez(m * 100, 1)} cm`;

export default function KorrekturDialog() {
  const { offen, schliessen } = useKorrekturDialog();
  if (!offen) return null;
  // Durch ein Portal an den Körper des Dokuments — siehe `pruefungen/dialoge.ts`.
  return createPortal(<Dialog onSchliessen={schliessen} />, document.body);
}

function Dialog({ onSchliessen }: { onSchliessen: () => void }) {
  const doc = useBimStore((s) => s.doc);
  const autokorrigiere = useBimStore((s) => s.autokorrigiere);
  const setActiveLevel = useBimStore((s) => s.setActiveLevel);
  const hebeHervor = useBimStore((s) => s.hebeHervor);

  const plan: Korrekturplan = useMemo(() => planeKorrektur(doc), [doc]);

  /*
   * Vorbelegt sind die Korrekturen, die nur Geometrie richten, die niemand so
   * gewollt haben kann. „Kleine Räume unbeheizt" ändert dagegen eine Angabe
   * zum Raum — das hakt man selbst an.
   */
  const [haken, setHaken] = useState<Record<Gruppe, boolean>>({
    anschluesse: true,
    stummel: true,
    begradigen: true,
    leitungen: true,
    kleineRaeume: false,
  });
  const [antworten, setAntworten] = useState<Record<string, LueckenSchluss | 'offen'>>({});
  const [auf, setAuf] = useState<Record<string, boolean>>({});
  const [meldung, setMeldung] = useState<string | null>(null);

  const mehrereGeschosse = new Set(Object.values(doc.walls).map((w) => w.levelId)).size > 1;
  const geschoss = (id: string): string => (mehrereGeschosse ? `${doc.levels[id]?.name ?? id} · ` : '');

  const zeige = (levelId: string, stelle: Vec2): void => {
    if (doc.activeLevelId !== levelId) setActiveLevel(levelId);
    hebeHervor(stelle);
  };

  const anzahl: Record<Gruppe, number> = {
    anschluesse: plan.anschluesse.length,
    stummel: plan.stummel.length,
    begradigen: plan.schief.reduce((s, g) => s + g.bewegt, 0),
    leitungen: plan.leitungen.length,
    kleineRaeume: plan.kleineRaeume.length,
  };
  const beantwortet = Object.values(antworten).filter((a) => a !== 'offen').length;
  const auszufuehren =
    (Object.keys(anzahl) as Gruppe[]).reduce((s, g) => s + (haken[g] ? anzahl[g] : 0), 0) +
    beantwortet +
    plan.doppelwaende.length;

  const ausfuehren = (): void => {
    const luecken: Record<string, LueckenSchluss> = {};
    for (const [k, a] of Object.entries(antworten)) if (a !== 'offen') luecken[k] = a;
    const auswahl: KorrekturAuswahl = {
      anschluesse: haken.anschluesse,
      stummel: haken.stummel,
      begradigen: haken.begradigen,
      leitungen: haken.leitungen,
      kleineRaeume: haken.kleineRaeume,
      luecken,
    };
    setMeldung(autokorrigiere(auswahl).message);
    setAntworten({});
  };

  const zeile = (key: string, text: string, levelId: string, stelle: Vec2) => (
    <button
      key={key}
      className="block w-full rounded px-2 py-1 text-left text-[11px] text-slate-400 hover:bg-white/[0.06] hover:text-slate-200"
      title="In den Blick rücken"
      onClick={() => zeige(levelId, stelle)}
    >
      {geschoss(levelId)}
      {text}
    </button>
  );

  const gruppe = (
    id: Gruppe | 'doppelwaende',
    titel: string,
    satz: string,
    n: number,
    eintraege: JSX.Element[],
  ) => {
    if (n === 0) return null;
    const fest = id === 'doppelwaende';
    return (
      <div className="rounded-lg bg-white/[0.03] p-2.5" data-pruef={`korrektur-gruppe-${id}`}>
        <div className="flex items-start gap-2">
          {fest ? (
            <span className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[11px] text-accent">✓</span>
          ) : (
            <input
              type="checkbox"
              className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-sky-400"
              checked={haken[id as Gruppe]}
              onChange={(e) => setHaken({ ...haken, [id]: e.target.checked })}
              aria-label={titel}
              data-pruef={`korrektur-haken-${id}`}
            />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[12px] text-slate-200">{titel}</span>
              <span className="shrink-0 text-[11px] tabular-nums text-slate-400" data-pruef={`korrektur-zahl-${id}`}>
                {n}
              </span>
            </div>
            <p className="mt-0.5 text-[10.5px] leading-snug text-slate-500">{satz}</p>
            <button
              className="mt-1 text-[10.5px] text-slate-400 underline decoration-dotted hover:text-slate-200"
              onClick={() => setAuf({ ...auf, [id]: !auf[id] })}
            >
              {auf[id] ? 'Stellen ausblenden' : 'Stellen zeigen'}
            </button>
            {auf[id] && <div className="mt-1 max-h-40 overflow-auto">{eintraege}</div>}
          </div>
        </div>
      </div>
    );
  };

  const nichtsZuTun = plan.summe === 0;

  return (
    /*
     * Rechts statt in der Mitte und ohne Weichzeichner: Wer eine Stelle
     * anspringt, will sie im Plan daneben sehen, nicht hinter Milchglas.
     */
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-graphite-950/30 p-4 md:justify-end" data-pruef="korrektur-dialog">
      <div
        className="panel flex max-h-full w-[480px] max-w-full flex-col overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="korrektur-titel"
      >
        <div className="border-b border-white/[0.06] p-4">
          <div id="korrektur-titel" className="text-[13px] font-semibold text-slate-100">
            Grundriss prüfen und korrigieren
          </div>
          <p className="mt-1 text-[10.5px] leading-relaxed text-slate-500">
            {nichtsZuTun
              ? 'Nichts gefunden: keine offenen Ecken, keine Stummel, keine schiefen Wände, keine Lücken.'
              : 'Angehakt ist, was nur Geometrie richtet. Lücken beantworten Sie einzeln — ohne Antwort bleiben sie offen. Alles zusammen ist ein Schritt; Strg+Z nimmt ihn zurück.'}
          </p>
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-auto p-4">
          {gruppe(
            'anschluesse',
            'Offene Ecken und Anschlüsse schließen',
            `Wandenden, die einen anderen Wandpunkt oder eine Wand um weniger als ${cm(0.05)} verfehlen, werden angeschlossen. Die Raumerkennung überbrückt das zwar, im Plan, im 3D-Modell und in der Übergabe bleibt die Ecke aber offen.`,
            anzahl.anschluesse,
            plan.anschluesse.map((a, i) =>
              zeile(`a${i}`, `${a.art === 'knoten' ? 'Ecke' : 'Anschluss an Wand'} · ${cm(a.abstand)} Spalt`, a.levelId, a.stelle),
            ),
          )}
          {gruppe(
            'stummel',
            'Wandstummel und Überstände entfernen',
            'Wandstücke unter 5 cm und lose Enden bis 15 cm, die über eine Ecke hinausragen. Wände mit Öffnung, Durchbruch oder Einbau sind nie dabei.',
            anzahl.stummel,
            plan.stummel.map((s, i) =>
              zeile(`s${i}`, `${s.art === 'stummel' ? 'Stummel' : 'Überstand'} · ${cm(s.laenge)}`, s.levelId, s.stelle),
            ),
          )}
          {gruppe(
            'doppelwaende',
            'Doppelte Wände zusammenlegen',
            'Zwei Wände an derselben Stelle verdoppeln Hüllfläche, Transmission und Mauerwerk. Sie werden immer zusammengelegt; Öffnungen wandern auf die bleibende.',
            plan.doppelwaende.length,
            plan.doppelwaende.map((d, i) => zeile(`d${i}`, 'doppelte Wand', d.levelId, d.stelle)),
          )}
          {gruppe(
            'begradigen',
            'Schiefe Wände gerade ziehen',
            'Wände bis 8° Abweichung kommen auf die Achse. Bewusst schräge Wände bleiben, und kein Wandpunkt wandert weiter als 30 cm.',
            anzahl.begradigen,
            plan.schief.map((g, i) =>
              zeile(
                `g${i}`,
                `${g.bewegt} Wandpunkte, weitester ${cm(g.groessterVersatz)}` +
                  (g.schraeg ? ` · ${g.schraeg} schräge bleiben` : '') +
                  (g.uebersprungen ? ` · ${g.uebersprungen} Wandzüge zu weit, bleiben` : ''),
                g.levelId,
                g.stelle,
              ),
            ),
          )}
          {gruppe(
            'leitungen',
            'Leitungen ohne Länge und doppelte Leitungen entfernen',
            'Sie stehen sonst im Massenauszug doppelt oder gar nicht. Armaturen einer doppelten Leitung wandern auf die bleibende.',
            anzahl.leitungen,
            plan.leitungen.map((l, i) =>
              zeile(`l${i}`, l.art === 'null' ? 'Leitung ohne Länge' : `doppelte Leitung · ${dez(l.laenge, 2)} m`, l.levelId, l.stelle),
            ),
          )}
          {gruppe(
            'kleineRaeume',
            'Kleine Räume als unbeheizt führen',
            'Beheizte Räume unter 1 m² — meist ein Schacht, eine Nische oder ein Rest aus dem Aufmaß.',
            anzahl.kleineRaeume,
            plan.kleineRaeume.map((r, i) =>
              zeile(`k${i}`, `„${r.name}" · ${dez(r.flaeche, 2)} m²`, r.levelId, r.stelle),
            ),
          )}

          {plan.luecken.length > 0 && (
            <div className="rounded-lg bg-white/[0.03] p-2.5" data-pruef="korrektur-luecken">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[12px] text-slate-200">Lücken — was war dort?</span>
                <span className="text-[11px] tabular-nums text-slate-400">{plan.luecken.length}</span>
              </div>
              <p className="mt-0.5 text-[10.5px] leading-snug text-slate-500">
                Hier hört eine Wand auf, ohne die nächste zu erreichen. Das weiß nur, wer vor Ort war.
              </p>
              <div className="mt-1.5 space-y-1.5">
                {plan.luecken.map((l) => {
                  const gewaehlt = antworten[l.knotenId] ?? 'offen';
                  return (
                    <div key={l.knotenId} className="rounded-md bg-white/[0.03] px-2 py-1.5" data-pruef="korrektur-luecke">
                      <button
                        className="mb-1 block w-full text-left text-[11px] text-slate-400 hover:text-slate-200"
                        title="In den Blick rücken"
                        onClick={() => zeige(l.levelId, l.stelle)}
                      >
                        {geschoss(l.levelId)}
                        {dez(l.weite, 2)} m · {l.hinweis}
                      </button>
                      <div className="flex flex-wrap gap-1">
                        {ANTWORTEN.map((a) => (
                          <button
                            key={a.art}
                            className={`rounded px-2.5 py-1 text-[11px] transition ${
                              gewaehlt === a.art
                                ? 'bg-accent/25 text-accent'
                                : 'bg-white/[0.06] text-slate-300 hover:bg-white/[0.1]'
                            }`}
                            aria-pressed={gewaehlt === a.art}
                            data-pruef={`korrektur-antwort-${a.art}`}
                            onClick={() => setAntworten({ ...antworten, [l.knotenId]: a.art })}
                          >
                            {a.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {plan.ohneRaum.map((o) => (
            <p key={o.levelId} className="rounded-lg bg-orange-400/10 p-2.5 text-[10.5px] leading-snug text-orange-200">
              {doc.levels[o.levelId]?.name ?? o.levelId}: {o.waende} Wände, aber kein Raum erkannt. Meist fehlt eine
              Wand über mehr als 3 m — das ergänzt man von Hand.
            </p>
          ))}

          {meldung && (
            <p className="rounded-lg bg-accent/10 p-2.5 text-[11px] leading-snug text-slate-200" data-pruef="korrektur-meldung">
              {meldung}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-white/[0.06] p-3">
          <button className={`${KNOPF} bg-white/[0.06] text-slate-300 hover:bg-white/[0.1]`} onClick={onSchliessen}>
            Schließen
          </button>
          <button
            className={`${KNOPF} bg-accent/20 text-accent hover:bg-accent/30`}
            disabled={auszufuehren === 0}
            onClick={ausfuehren}
            data-pruef="korrektur-ausfuehren"
          >
            Korrigieren{auszufuehren > 0 ? ` (${auszufuehren})` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
