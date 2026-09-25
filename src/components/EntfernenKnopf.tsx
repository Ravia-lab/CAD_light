/**
 * Der Entfernen-Knopf in der Statuszeile — löschen ohne Tastatur.
 *
 * **Warum es ihn gibt.** Im Grundriss führte bis 1.52.0 genau ein Weg zum
 * Entfernen: die Taste <kbd>Entf</kbd>. Auf dem Tablet gibt es die nicht —
 * dort ließ sich Gezeichnetes anfassen, verschieben und in den Maßen ändern,
 * aber nicht mehr loswerden. Der einzige Löschknopf war „Alles löschen" in
 * der Werkzeugleiste, und das ist das Gegenteil dessen, was man will. In der
 * 3D-Ansicht steht der Knopf seit 1.25.0 aus genau diesem Grund; im
 * Grundriss war er nie nachgezogen worden.
 *
 * **Warum in der Statuszeile und nicht über dem Plan.** Der erste Anlauf
 * setzte ihn wie in 3D als schwebende Leiste unten in die Mitte der
 * Zeichenfläche. Dort verläuft bei einem Grundriss die untere Außenwand. Der
 * Rauchtest `smoke:wp` zieht die Grundstücksgrenze an dieser Kante und blieb
 * stehen; nachgemessen lag der Griffpunkt (x 676, y 916) mitten auf dem
 * Knopf (x 556…714, y 898…934). In 3D fällt das nicht auf, weil ein Zug dort
 * nur die Kamera dreht — im Grundriss ist Verschieben die häufigste Handlung
 * nach dem Auswählen.
 *
 * Die Statuszeile deckt nichts zu. Sie steht immer an derselben Stelle, am
 * unteren Bildschirmrand, wo der Daumen ohnehin liegt. Dass der Knopf damit
 * woanders sitzt als in 3D, ist der Preis; er ist kleiner als eine
 * Handbewegung, die im Grundriss nicht mehr geht.
 *
 * **Warum ohne Rückfrage.** Der Knopf tut, was die Taste tut: sofort.
 * Rückgängig macht es rückgängig, und die Statuszeile sagt, was weg ist. Ein
 * Dialog, den man beim Aufmaß zwanzigmal am Tag wegtippt, erzieht zum
 * Wegtippen und schützt beim einundzwanzigsten Mal auch nicht mehr.
 */

import { useBimStore } from '../store/useBimStore';
import { auswahlGesperrt } from '../lib/ebenen';
import { entfernenAufschrift } from '../lib/auswahlNamen';

export default function EntfernenKnopf() {
  const tool = useBimStore((s) => s.tool);
  const selections = useBimStore((s) => s.selections);
  const selection = useBimStore((s) => s.selection);
  const doc = useBimStore((s) => s.doc);
  const trace = useBimStore((s) => s.trace);
  const skizze = useBimStore((s) => s.skizze);
  const deleteSelection = useBimStore((s) => s.deleteSelection);
  const setSelection = useBimStore((s) => s.setSelection);

  /*
   * Ein Vorschlag der Bilderkennung oder eine wartende Skizze hat Vorrang.
   * Beide haben eine eigene Leiste mit eigenen Wörtern („verwerfen",
   * „übernehmen"); ein zweites Verb daneben, das etwas anderes meint, ist
   * eine Falle.
   */
  if (trace || skizze) return null;
  // Auswahl gibt es nur mit dem Auswahlwerkzeug.
  if (tool !== 'select') return null;

  const gewaehlt = selections.length ? selections : selection ? [selection] : [];
  if (gewaehlt.length === 0) return null;

  /*
   * Das Referenzbild wird hier nicht angeboten. Es ist kein Bauteil, sondern
   * die Vorlage, auf der gezeichnet wird; es verschwindet über den Reiter
   * „Ebenen". Eine Wand ist in zehn Sekunden neu gezeichnet, ein eingepasstes
   * Bild nicht — und in einer Reihe mit „Wand entfernen" sähe beides gleich
   * harmlos aus.
   */
  const entfernbar = gewaehlt.filter((s) => s.kind !== 'image');
  if (entfernbar.length === 0) return null;

  const gesperrt = entfernbar.filter((s) => auswahlGesperrt(doc, s));
  const allesGesperrt = gesperrt.length === entfernbar.length;

  if (allesGesperrt) {
    /*
     * Gesperrtes stillschweigend nicht zu löschen ist schlimmer, als es gar
     * nicht anzubieten: Man drückt, nichts geschieht, und man drückt fester.
     * Hier steht stattdessen, wo man es löst.
     */
    return (
      <span className="shrink-0 whitespace-nowrap px-2 text-amber-300/90" data-pruef="gesperrt">
        Gesperrt — im Reiter „Ebenen" freigeben
      </span>
    );
  }

  return (
    <span className="flex shrink-0 items-stretch gap-1">
      {gesperrt.length > 0 && (
        // Teilweise gesperrt: Die Zahl im Knopf und die Zahl in der Meldung
        // danach gehen auseinander. Wer das vorher liest, ist nicht überrascht.
        <span className="flex items-center whitespace-nowrap px-1 text-amber-300/80">
          {gesperrt.length} gesperrt
        </span>
      )}
      <button
        className="rounded px-2.5 text-[11px] text-rose-300 transition hover:bg-rose-500/15 hover:text-rose-200"
        title="Entfernt das Angewählte aus dem Plan. Strg+Z holt es zurück. (Taste: Entf)"
        onClick={() => deleteSelection()}
      >
        {entfernenAufschrift(entfernbar.map((s) => s.kind))}
      </button>
      <button
        className="rounded px-2.5 text-[11px] text-slate-400 transition hover:bg-white/[0.06] hover:text-slate-200"
        title="Auswahl aufheben, ohne etwas zu ändern (Taste: Esc)"
        onClick={() => setSelection(null)}
      >
        Abwählen
      </button>
    </span>
  );
}
