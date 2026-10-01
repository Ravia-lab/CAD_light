/**
 * Das Skizzenblatt — Vollbild, vier Knöpfe, Finger oder Stift.
 *
 * **Der Anlass.** Das Werkzeug „Freihand skizzieren" gibt es seit langem, und
 * es tut genau das Richtige: hinkrakeln, Vorschlag ansehen, übernehmen oder
 * verwerfen. Nur kam der Monteur nicht heran. Gemessen am laufenden Programm
 * auf dem Tablet: **mit dem Stift ein Zug und zwei erkannte Strecken, mit dem
 * Finger gar nichts** — und keinen Schalter, der das ändert. Wer keinen Stift
 * dabeihat, konnte nicht skizzieren, und das ist auf der Baustelle der
 * Normalfall.
 *
 * **Warum ein Vollbild und nicht einfach der Finger im Plan.** Auf dem Plan
 * ist ein Finger zweideutig: Er muss auch schieben können, und genau deshalb
 * steht dort die Vorgabe „der Finger schiebt". Auf einem Blatt, das nichts
 * anderes zulässt, besteht die Zweideutigkeit nicht — der Grund für das
 * Verbot fällt weg, nicht das Verbot. Nebenbei verschwinden die Leisten, und
 * übrig bleibt, was ein Blatt Papier auch hat: Fläche.
 *
 * Gezeichnet wird weiter von `Editor2D` und erkannt von `lib/skizze.ts`. Diese
 * Datei ist **nur die Bedienung** — kein zweiter Zeichenweg und keine zweite
 * Erkennung.
 */

import { useBimStore } from '../store/useBimStore';

export default function Skizzenblatt() {
  const offen = useBimStore((s) => s.vollbildSkizze);
  const schliessen = useBimStore((s) => s.setzeVollbildSkizze);
  const skizze = useBimStore((s) => s.skizze);
  const uebernimm = useBimStore((s) => s.uebernimmSkizze);
  const verwirf = useBimStore((s) => s.verwirfSkizze);
  const zurueck = useBimStore((s) => s.nimmZugZurueck);
  const setzeStatus = useBimStore((s) => s.setStatus);

  if (!offen) return null;

  const zuege = skizze?.zuege.length ?? 0;
  const strecken = skizze?.strecken.length ?? 0;
  const schraeg = skizze?.strecken.filter((s) => !s.ausgerichtet).length ?? 0;

  return (
    <>
      {/* Kopfstreifen — sagt, wo man ist, und was bisher erkannt wurde. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center gap-3 px-4 py-2.5">
        <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-accent">Skizzenblatt</span>
        <span className="text-[11.5px] text-slate-400">Finger oder Stift — beides geht</span>
        <span className="ml-auto text-[12px] tabular-nums text-slate-400">
          {zuege === 0
            ? 'noch leer'
            : `${zuege} ${zuege === 1 ? 'Strich' : 'Striche'} · ${strecken} ${strecken === 1 ? 'Wand' : 'Wände'}` +
              (schraeg ? ` (${schraeg} schräg)` : '')}
        </span>
      </div>

      {/*
        * Die Leiste liegt **unten**: Dort liegt der Daumen, wenn jemand ein
        * Tablet hält. Oben wäre sie hübscher und unerreichbar.
        */}
      <div className="absolute inset-x-0 bottom-0 z-30 flex items-center gap-2 px-3 pb-3 pt-2">
        <button
          className="panel flex h-13 min-h-[52px] items-center justify-center rounded-xl px-4 text-[14px] font-semibold text-slate-200 disabled:opacity-35"
          disabled={zuege === 0}
          onClick={() => zurueck()}
        >
          Strich zurück
        </button>
        <button
          className="panel flex h-13 min-h-[52px] items-center justify-center rounded-xl px-4 text-[14px] font-semibold text-slate-400 disabled:opacity-35"
          disabled={zuege === 0}
          onClick={() => verwirf()}
        >
          Alles weg
        </button>
        <button
          className="flex h-13 min-h-[52px] flex-1 items-center justify-center gap-2 rounded-xl bg-accent px-4 text-[15px] font-bold text-graphite-950 disabled:opacity-35"
          disabled={strecken === 0}
          onClick={() => {
            const a = uebernimm();
            setzeStatus(a.message);
            if (a.ok) schliessen(false);
          }}
        >
          Daraus Wände machen
        </button>
        <button
          className="panel flex h-13 min-h-[52px] items-center justify-center rounded-xl px-4 text-[14px] font-semibold text-slate-300"
          onClick={() => {
            /*
             * Zuklappen wirft den Vorschlag **nicht** weg. Wer das Blatt
             * verlässt, ohne zu übernehmen, findet seine Striche im Plan
             * wieder — ein Ausgang, der nebenbei löscht, ist eine Falle.
             */
            schliessen(false);
          }}
          aria-label="Skizzenblatt schließen"
        >
          Schließen
        </button>
      </div>
    </>
  );
}
