/**
 * Die Fassung des Programms — an einer Stelle.
 *
 * **Warum das eine eigene Datei ist.** Die Nummer stand bis 1.28.0 an drei
 * Orten: in `package.json`, als `GENERATOR` im RaVia-Export und zweimal
 * wörtlich im IFC-Export. Gepflegt wurde beim Freigeben nur die erste. Der
 * RaVia-Export meldete deshalb in der Fassung 1.27.0 als Erzeuger noch
 * „RaVia CAD Light 1.25.0" — zwei Fassungen zu alt, und niemandem gefallen,
 * weil die Zahl nirgends geprüft wurde.
 *
 * Das ist keine Kleinigkeit, sobald eine Gegenstelle mit den Dateien
 * arbeitet: Der Erzeugervermerk ist das Einzige, woran sich später ablesen
 * lässt, welches Programm eine Datei geschrieben hat. Wer einen Fehler auf
 * eine Fassung zurückführen will, hat sonst nur eine Zahl, die lügt.
 *
 * `scripts/pruefungen/fassung.ts` hält diese Zahl gegen `package.json`. Damit
 * kann sie nicht mehr auseinanderlaufen, ohne dass der Prüflauf fällt.
 */
export const FASSUNG = '1.46.0';

/** Der Erzeugervermerk, wie er in Exportdateien steht. */
export const ERZEUGER = `RaVia CAD Light ${FASSUNG}`;
