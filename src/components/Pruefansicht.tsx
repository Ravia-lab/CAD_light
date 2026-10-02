/**
 * Prüfansicht — ein Gebäudescan auf dem Telefon (seit 1.70.0).
 * ---------------------------------------------------------------------------
 *
 * **Warum es diese Ansicht gibt.** Der Monteur scannt mit dem iPhone, RaVia
 * reicht das Modell mit `loadBuilding` an CAD Light durch — und bis 1.69.0
 * stand er danach vor der vollen Zeichenoberfläche: Werkzeugleiste,
 * Inspektor, Kopfleiste, auf 375 Pixeln Breite. Was er in diesem Moment
 * wissen will, ist etwas anderes: *Ist das mein Haus, und ist es vollständig?*
 * Dafür braucht er das Modell im Raum, den Grundriss und die Liste dessen,
 * was das Programm für fraglich hält — und nichts, womit er aus Versehen eine
 * Wand verschiebt.
 *
 * **Was hier bewusst fehlt.** Kein Werkzeug außer Verschieben und Zoomen.
 * Bearbeiten gibt es auf Wunsch, mit einem Knopf, und von dort mit einem
 * Knopf zurück. Gespeichert wird nichts Eigenes: Plan, 3D und Prüfliste sind
 * dieselben Bausteine wie in der vollen Oberfläche, nur anders angeordnet.
 *
 * **Anordnung.** Hochkant eine Ansicht zur Zeit mit Umschalter darüber; quer
 * (Breite > Höhe und mindestens 560 px) Ansicht und Prüfliste nebeneinander.
 * Der Zustand — welche Ansicht, ob überhaupt Prüfansicht — überlebt das
 * Drehen, weil er nicht an der Anordnung hängt: die Ansicht steht in diesem
 * Baustein, der beim Drehen nicht neu entsteht, die Prüfansicht im Store.
 *
 * **Maße.** Umschalter 44 px hoch (kleinstes Tippziel nach Apple), der
 * Hauptknopf 56 px. Den Abstand zu Kamerausschnitt und Home-Leiste
 * (`env(safe-area-inset-*)`) und die Höhe `100dvh` hält das Wurzelelement
 * (`index.css`) — für die Prüfansicht wie für die volle Oberfläche.
 */

import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import Editor2D from './Editor2D';
import ValidationPanel from './ValidationPanel';
import { validateModel } from '../lib/validation';
import { useBimStore } from '../store/useBimStore';

const Viewer3D = lazy(() => import('./Viewer3D'));

type Ansicht = '3d' | 'plan' | 'liste';

const ANSICHTEN: { id: Ansicht; label: string }[] = [
  { id: '3d', label: '3D' },
  { id: 'plan', label: 'Grundriss' },
  { id: 'liste', label: 'Prüfliste' },
];

/** Breite > Höhe und genug Platz für zwei Spalten. */
function useQuer(): boolean {
  const lies = () =>
    typeof window !== 'undefined' && window.innerWidth > window.innerHeight && window.innerWidth >= 560;
  const [quer, setQuer] = useState(lies);
  useEffect(() => {
    const neu = () => setQuer(lies());
    window.addEventListener('resize', neu);
    window.addEventListener('orientationchange', neu);
    return () => {
      window.removeEventListener('resize', neu);
      window.removeEventListener('orientationchange', neu);
    };
  }, []);
  return quer;
}

export default function Pruefansicht() {
  const doc = useBimStore((s) => s.doc);
  const selection = useBimStore((s) => s.selection);
  const setPruefansicht = useBimStore((s) => s.setPruefansicht);
  const setViewMode = useBimStore((s) => s.setViewMode);
  const quer = useQuer();
  const [ansicht, setAnsicht] = useState<Ansicht>('3d');

  const bericht = useMemo(() => validateModel(doc), [doc]);
  const zahlen = useMemo(() => {
    const raeume = Object.values(doc.rooms);
    return {
      waende: Object.keys(doc.walls).length,
      raeume: raeume.length,
      flaeche: raeume.reduce((s, r) => s + r.area, 0),
    };
  }, [doc]);
  const offen = bericht.issues.filter((i) => i.severity !== 'info').length;

  /*
   * Ein Befund in der Liste ist anklickbar und wählt das betroffene Objekt.
   * Hochkant sieht man die Auswahl aber nur im Grundriss — also dorthin
   * wechseln, sonst passiert für den Finger nichts Sichtbares.
   */
  const vorher = useRef(selection);
  useEffect(() => {
    if (selection && selection !== vorher.current && !quer && ansicht === 'liste') setAnsicht('plan');
    vorher.current = selection;
  }, [selection, quer, ansicht]);

  // Quer steht die Liste ohnehin daneben; „Prüfliste" als Hauptansicht wäre
  // doppelt.
  const haupt: Ansicht = quer && ansicht === 'liste' ? 'plan' : ansicht;

  /*
   * Die Ansichtsart im Store mitführen: Das 3D zeichnet nur, solange sie
   * `3d` ist (es hält seine Bildschleife sonst an), und „Bearbeiten" landet
   * so in der Ansicht, die man gerade vor sich hatte.
   */
  useEffect(() => {
    if (haupt === '3d') setViewMode('3d');
    else if (haupt === 'plan') setViewMode('2d');
  }, [haupt, setViewMode]);

  const bearbeiten = () => setPruefansicht(false);

  const liste = (
    <div className="min-h-0 flex-1 overflow-y-auto" data-pruefansicht-liste>
      <ValidationPanel />
    </div>
  );

  const umschalter = (
    <nav className={`flex gap-1 ${quer ? 'shrink-0' : 'shrink-0 px-3 pb-2'}`} role="tablist" aria-label="Ansicht">
      {ANSICHTEN.filter((a) => !(quer && a.id === 'liste')).map((a) => (
        <button
          key={a.id}
          role="tab"
          aria-selected={haupt === a.id}
          onClick={() => setAnsicht(a.id)}
          className={`min-h-[44px] min-w-[56px] rounded-lg px-3 text-[14px] ${quer ? '' : 'flex-1'} ${
            haupt === a.id ? 'bg-accent/15 text-accent' : 'bg-graphite-800 text-slate-300'
          }`}
        >
          {a.label}
          {a.id === 'liste' && offen > 0 ? ` (${offen})` : ''}
        </button>
      ))}
    </nav>
  );

  const hauptknopf = (
    <button
      onClick={bearbeiten}
      className={`hauptknopf min-h-[56px] rounded-xl bg-accent px-5 text-[16px] font-medium text-graphite-950 ${quer ? 'shrink-0' : 'flex-1'}`}
      data-hauptknopf
    >
      Bearbeiten
    </button>
  );

  const titel = (
    <div className="min-w-0 flex-1">
      <div className="truncate text-[15px] font-medium text-slate-100">{doc.meta.name || 'Gebäudescan'} prüfen</div>
      <div className="truncate text-[12px] text-slate-400">
        {zahlen.waende} Wände · {zahlen.raeume} Räume · {zahlen.flaeche.toFixed(1).replace('.', ',')} m²
        {offen > 0 ? ` · ${offen} offene Punkte` : ' · keine offenen Punkte'}
      </div>
    </div>
  );

  /*
   * Quer ist die Höhe knapp (375 px beim iPhone): Kopf, Umschalter und
   * Hauptknopf teilen sich **eine** Zeile, sonst bliebe für das Modell ein
   * Streifen von 90 px. Hochkant stehen sie übereinander, der Knopf unten,
   * wo der Daumen ist.
   */
  return (
    <div className="flex h-full w-full flex-col bg-graphite-900" data-pruefansicht>
      {quer ? (
        <header className="flex shrink-0 items-center gap-2 px-3 py-1.5">
          {titel}
          {umschalter}
          {hauptknopf}
        </header>
      ) : (
        <>
          <header className="flex shrink-0 items-center gap-2 px-3 pb-1 pt-2">{titel}</header>
          {umschalter}
        </>
      )}

      <main className={`flex min-h-0 flex-1 gap-2 px-2 ${quer ? 'flex-row pb-2' : 'flex-col'}`}>
        <div className="panel relative min-h-0 min-w-0 flex-1 overflow-hidden">
          {haupt === '3d' && (
            <Suspense fallback={<div className="p-4 text-[13px] text-slate-400">3D wird geladen …</div>}>
              <Viewer3D />
            </Suspense>
          )}
          {haupt === 'plan' && <Editor2D />}
          {haupt === 'liste' && liste}
        </div>
        {quer && <div className="panel flex w-[40%] min-w-[240px] flex-col overflow-hidden">{liste}</div>}
      </main>

      {/* Fuß: der eine Hauptknopf, über der Home-Leiste */}
      {!quer && <footer className="flex shrink-0 gap-2 px-3 py-2">{hauptknopf}</footer>}
    </div>
  );
}
