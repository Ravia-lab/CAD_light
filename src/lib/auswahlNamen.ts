/**
 * Wie heißt das, was gerade angefasst ist?
 *
 * **Warum das eine eigene Datei ist.** Der Entfernen-Knopf soll nicht
 * „Entfernen" sagen, sondern *was* entfernt wird. Der Unterschied zwischen
 * „Entfernen" und „Wand entfernen" ist auf dem Tablet der Unterschied
 * zwischen einem Knopf, den man prüfend anschaut, und einem, den man drückt:
 * Wer mit dem Finger gewählt hat, weiß nicht immer, was er getroffen hat —
 * ein Rohr und die Wand darunter liegen im Plan zwei Millimeter auseinander.
 * Der Knopf ist die letzte Stelle, an der das Programm sagen kann, was
 * gleich verschwindet.
 *
 * Die Namen stehen hier und nicht in der Oberfläche, weil sie an mehreren
 * Stellen gebraucht werden und weil sie sich so prüfen lassen, ohne einen
 * Browser zu starten. Die Schichtgrenze bleibt gewahrt: Diese Datei kennt
 * nur Typen, keinen Speicher und keine Anzeige.
 */

import type { SelectionKind } from '../types/bim';

/**
 * Ein Wort je Auswahlart — dasselbe Wort, das im Plan und im Inspektor steht.
 *
 * Bewusst Einzahl und ohne Artikel: Der Knopf setzt „entfernen" dahinter,
 * die Statuszeile setzt etwas anderes dahinter, und ein Name, der schon
 * einen Artikel mitbringt, passt dann an einer der beiden Stellen nicht.
 */
export const AUSWAHL_NAME: Record<SelectionKind, string> = {
  node: 'Punkt',
  wall: 'Wand',
  opening: 'Öffnung',
  room: 'Raum',
  trace: 'Vorschlag',
  image: 'Referenzbild',
  fixture: 'TGA-Objekt',
  vertical: 'Durchgang',
  solid: 'Bauteil',
  durchbruch: 'Durchbruch',
  pipe: 'Leitung',
  accessory: 'Armatur',
  annotation: 'Maßkette',
  roofOpening: 'Dachfenster',
  site: 'Geländefläche',
  heatpump: 'Wärmepumpe',
};

/**
 * Die Mehrzahl — nur dort, wo sie nicht der Einzahl gleicht.
 *
 * Deutsch ist beim Plural unregelmäßig genug, dass eine Regel („+ e", „+ n")
 * mehr Fälle falsch als richtig macht: aus „Wand" würde „Wande". Deshalb
 * eine Liste. Was hier fehlt, ist in der Mehrzahl gleich geschrieben wie in
 * der Einzahl — „zwei Referenzbild" gibt es nicht, „zwei Durchbrüche" schon.
 */
const MEHRZAHL: Partial<Record<SelectionKind, string>> = {
  node: 'Punkte',
  wall: 'Wände',
  opening: 'Öffnungen',
  room: 'Räume',
  trace: 'Vorschläge',
  image: 'Referenzbilder',
  fixture: 'TGA-Objekte',
  vertical: 'Durchgänge',
  solid: 'Bauteile',
  durchbruch: 'Durchbrüche',
  pipe: 'Leitungen',
  accessory: 'Armaturen',
  annotation: 'Maßketten',
  roofOpening: 'Dachfenster',
  site: 'Geländeflächen',
  heatpump: 'Wärmepumpen',
};

/** Der Name in der passenden Zahl. */
export function auswahlName(kind: SelectionKind, anzahl = 1): string {
  return anzahl === 1 ? AUSWAHL_NAME[kind] : MEHRZAHL[kind] ?? AUSWAHL_NAME[kind];
}

/**
 * Die Aufschrift des Entfernen-Knopfes.
 *
 * Drei Fälle, und jeder sagt etwas anderes:
 *
 * * **Eines** — „Wand entfernen". Man weiß, was weggeht.
 * * **Mehrere derselben Art** — „3 Wände entfernen". Auch das ist eindeutig.
 * * **Gemischt** — „5 Bauteile entfernen". Hier wäre jede Aufzählung länger
 *   als der Knopf breit ist; die Zahl ist die Auskunft, die zählt, und
 *   „Bauteile" ist das Wort, unter dem im Programm ohnehin alles läuft, was
 *   im Plan steht.
 *
 * Leer gibt es nicht: Ohne Auswahl wird der Knopf nicht angezeigt. Die
 * Funktion liefert für den leeren Fall trotzdem etwas Sinnvolles, statt zu
 * werfen — ein Knopf, der wegen einer Ausnahme die ganze Ansicht mitreißt,
 * wäre ein schlechterer Tausch als eine Aufschrift, die niemand sieht.
 */
export function entfernenAufschrift(kinds: readonly SelectionKind[]): string {
  if (kinds.length === 0) return 'Entfernen';
  if (kinds.length === 1) return `${auswahlName(kinds[0])} entfernen`;
  const einheitlich = kinds.every((k) => k === kinds[0]);
  const wort = einheitlich ? auswahlName(kinds[0], kinds.length) : 'Bauteile';
  return `${kinds.length} ${wort} entfernen`;
}
