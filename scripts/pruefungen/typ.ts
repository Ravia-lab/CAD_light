/**
 * Vertrag für ausgelagerte Prüfblöcke.
 *
 * `npm run verify` bleibt der eine Einstiegspunkt. Damit mehrere Blöcke
 * unabhängig voneinander entstehen können, ohne sich in einer Datei zu
 * überschreiben, bekommt jeder Block eine eigene Datei und diese eine
 * Funktion. Gezählt und ausgegeben wird weiterhin zentral in verify.ts.
 */
export type CheckFn = (
  label: string,
  actual: number | string | boolean,
  expected: number | string | boolean,
  tol?: number,
) => void;
