/**
 * Das Namensfeld eines Raums — frei tippen oder aus der Liste wählen.
 *
 * **Warum `<datalist>` und kein eigenes Aufklappmenü.** Die Liste ist ein
 * Vorschlag, keine Auswahl: Wer „wz2" tippen will, soll das dürfen, ohne
 * dass ein Menü dazwischenfährt. Genau das leistet das Bauteil des Browsers
 * — ein Textfeld, das beim Hineintippen passende Vorschläge zeigt und auf
 * dem Rechner einen Pfeil zum Aufklappen hat. Auf dem iPad bietet Safari die
 * Vorschläge über der Tastatur an. Ein nachgebautes Menü müsste Tastatur,
 * Fokus, Bildlauf und Bildschirmleser selbst erledigen und würde auf dem
 * Tablet genau an der Stelle schlechter, für die es gedacht ist.
 *
 * **Die Nutzung zieht mit — aber nur beim gewählten Standardnamen.** Wer
 * „Bad" aus der Liste nimmt, meint ein Bad; die Nutzung wird dann mit
 * derselben Regel gesetzt, die auch Import und Scan einstufen. Getippte
 * Namen ändern die Nutzung nicht: „Bad-Abstellraum" beim dritten Buchstaben
 * zum Bad zu machen, wäre ein Feld, das mitredet, während man schreibt.
 *
 * Die Liste selbst steht **einmal** im Dokument (`RaumnamenListe`, in
 * `App.tsx`) und nicht in jedem Feld — im Raumbuch stehen sonst zwanzig
 * gleiche Listen mit derselben Kennung.
 */

import type { RoomUsage } from '../types/bim';
import { STANDARD_RAUMNAMEN, istStandardraumname, nutzungAusName } from '../lib/raumnutzung';

/** Die Kennung der gemeinsamen Vorschlagsliste. */
export const RAUMNAMEN_LISTE = 'ravia-raumnamen';

export function RaumnamenListe() {
  return (
    <datalist id={RAUMNAMEN_LISTE}>
      {STANDARD_RAUMNAMEN.map((n) => (
        <option key={n} value={n} />
      ))}
    </datalist>
  );
}

/**
 * `onAendern` bekommt Name und — beim Standardnamen — die Nutzung in
 * **einem** Aufruf. Zwei getrennte Aufrufe wären zwei Schritte in der
 * Rückgängig-Kette: Strg+Z nähme erst die Nutzung zurück und ließe den
 * neuen Namen stehen.
 */
export default function RaumnameFeld({
  wert,
  onAendern,
  className = 'field',
  ariaLabel,
}: {
  wert: string;
  onAendern: (patch: { name: string; usage?: RoomUsage }) => void;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <input
      className={className}
      value={wert}
      list={RAUMNAMEN_LISTE}
      autoComplete="off"
      spellCheck={false}
      aria-label={ariaLabel}
      placeholder="Name tippen oder auswählen"
      onChange={(e) => {
        const name = e.target.value;
        const usage = istStandardraumname(name) ? nutzungAusName(name) : undefined;
        onAendern(usage ? { name, usage } : { name });
      }}
    />
  );
}
