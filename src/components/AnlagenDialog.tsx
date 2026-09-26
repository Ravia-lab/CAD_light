/**
 * Der Anlagendialog — gefragt wird da, wo man hinsieht.
 * ---------------------------------------------------------------------------
 * **Der gemeldete Mangel.** Die Angaben zur Anlage standen nur im
 * Anlagenblatt des Inspektors, einem Reiter unter vierzehn. Sie sind aber
 * kein Reiter unter vierzehn, sondern die Voraussetzung dafür, dass überhaupt
 * ein Schema entsteht. Wer die Schema-Ansicht öffnete, fand bis 1.53.0 den
 * Satz „Im Reiter ‚Anlage' das Gerät wählen und auf ‚Schema erzeugen'
 * klicken": Das Programm wusste, was ihm fehlt, und schickte den Anwender
 * weg, statt ihn zu fragen.
 *
 * **Was dieser Dialog ist.** Derselbe Bogen, an der Stelle, an der er
 * gebraucht wird — und mit dem Knopf daneben, der das Bild erzeugt. Er ist
 * *der leere Zustand* der Schema-Ansicht und nicht ein Fenster davor.
 *
 * **Er kommt nicht bei jedem Klick.** Von selbst geht er nur auf, solange
 * kein Schema da ist. Danach führt der Knopf „Angaben ändern" am Bild
 * hierher. Ein Dialog, den man beim dritten Ansehen wieder wegtippt, wird
 * weggetippt — und dann auch beim zwanzigsten Mal, an dem er nötig gewesen
 * wäre.
 *
 * **Es gibt nichts abzubrechen.** Jede Eingabe steht sofort im Projekt, wie
 * im Anlagenblatt auch. Der Knopf heißt deshalb „Schließen" und nicht
 * „Abbrechen": Ein Dialog, dessen Änderungen bereits gespeichert sind und
 * der trotzdem ein Abbrechen anbietet, verspricht ein Zurück, das es nicht
 * gibt. Zurück geht es mit Strg+Z.
 */

import { useCallback, useMemo } from 'react';
import { useBimStore } from '../store/useBimStore';
import { buildSchematic, designPlant } from '../lib/plantDesign';
import { abweichungen, antwortenDes } from '../lib/anlagenFragen';
import { plantOf } from '../lib/plantDefaults';
import type { AnlagenAntworten } from '../types/bim';
import AnlagenFragen from './AnlagenFragen';

export default function AnlagenDialog({ onClose }: { onClose: () => void }) {
  const doc = useBimStore((s) => s.doc);
  const setSchematic = useBimStore((s) => s.setSchematic);
  const setStatus = useBimStore((s) => s.setStatus);
  const setzeAnlagenAntworten = useBimStore((s) => s.setzeAnlagenAntworten);

  const plant = plantOf(doc);
  const design = useMemo(() => designPlant(doc), [doc]);

  const antworten = useMemo(
    () => antwortenDes(plant, design.selected?.model.form, design.selected?.model.refrigerant),
    [plant, design.selected],
  );
  const setzeAntwort = useCallback(
    (patch: Partial<AnlagenAntworten>) => setzeAnlagenAntworten({ ...antworten, ...patch }),
    [antworten, setzeAnlagenAntworten],
  );

  /*
   * Dieselbe Abweichungsrechnung wie im Anlagenblatt — und aus denselben
   * Gründen gegen `buffer.required` und nicht gegen `buffer.selected`: Der
   * gewählte Speicher *ist* die Antwort des Anwenders, gegen sie zu
   * vergleichen ergäbe immer null.
   */
  const abweichungsliste = useMemo(
    () =>
      abweichungen(antworten, {
        pufferLiter: design.buffer.required > 0 ? design.buffer.required : undefined,
        pufferGrund: design.buffer.reason,
        kreiseImModell: design.circuits.length,
      }),
    [antworten, design],
  );

  const vorhanden = Object.keys(plant.schematic.components).length;

  const erzeugen = useCallback(() => {
    // Von Hand ergänzte Armaturen gehen beim Neuerzeugen verloren. Das darf
    // nicht stillschweigend passieren — wer eine halbe Stunde im Schema
    // gearbeitet hat, verliert sie sonst mit einem Klick.
    if (
      plant.schematic.manual &&
      !window.confirm('Das Schema wurde von Hand bearbeitet. Neu erzeugen verwirft alle Änderungen daran. Fortfahren?')
    ) {
      return;
    }
    const { components, links, notes } = buildSchematic(design);
    setSchematic(components, links, false, undefined);
    const wichtig = notes.filter((x) => x.severity !== 'info');
    setStatus(
      `Anlagenschema erzeugt — ${components.length} Bauteile, ${links.length} Verbindungen` +
        (notes.length ? ` · ${notes.length} Hinweis${notes.length === 1 ? '' : 'e'}` : '') +
        (wichtig.length ? `: ${wichtig[0].text}` : notes.length ? `: ${notes[0].text}` : ''),
    );
    onClose();
  }, [design, plant.schematic.manual, setSchematic, setStatus, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-graphite-950/70 p-6 backdrop-blur-sm"
      data-pruef="anlagendialog"
    >
      <div className="panel flex max-h-full w-[720px] max-w-full flex-col overflow-hidden">
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-white/[0.06] px-4 py-3">
          <div>
            <div className="text-[13px] font-semibold text-slate-100">Was steht im Technikraum?</div>
            <div className="mt-0.5 text-[10.5px] leading-relaxed text-slate-500">
              Aus diesen sieben Angaben entsteht das Anlagenschema. Was Sie eintragen, gilt — weicht die
              Auslegung ab, steht es daneben. Dieselben Felder stehen im Reiter „Anlage".
            </div>
          </div>
          <button
            className="chip shrink-0 bg-white/[0.05] text-slate-300 hover:bg-white/[0.1]"
            title="Schließen, ohne ein Schema zu erzeugen. Die Angaben bleiben gespeichert."
            onClick={onClose}
          >
            Schließen
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <AnlagenFragen
            antworten={antworten}
            setzeAntwort={setzeAntwort}
            abweichungsliste={abweichungsliste}
            breite="breit"
          />
        </div>

        <div className="shrink-0 border-t border-white/[0.06] px-4 py-3">
          <button
            className="chip w-full bg-accent/12 text-accent hover:bg-accent/20"
            data-pruef="dialog-erzeugen"
            onClick={erzeugen}
          >
            {vorhanden ? 'Schema neu erzeugen' : 'Schema erzeugen'}
          </button>
          <p className="mt-1.5 text-[10px] leading-relaxed text-slate-500">
            Erzeugt ein Prinzipschema aus der Auslegung — Erzeuger, Speicher, Armaturen, Kreise. Es sagt, was
            verbaut wird und woran es hängt, nicht wo es im Technikraum steht. Ihre Eingaben sind bereits
            gespeichert; zurück geht es mit Strg+Z.
          </p>
        </div>
      </div>
    </div>
  );
}
