/**
 * Zahlen für deutschen Text — Komma statt Punkt, echtes Minuszeichen.
 *
 * `toFixed` liefert „12.37" und „-12"; in einem deutschsprachigen
 * Ausdruck ist das ein Formfehler, der jedem Leser auffällt und den
 * Rest des Dokuments mit in Zweifel zieht. Vor 1.75.0 hatte fast jedes
 * Modul seinen eigenen Helfer — und einige Texte keinen.
 */
export function dez(wert: number, stellen = 2): string {
  const text = wert.toFixed(stellen);
  // „-0,00" ist keine negative Zahl.
  const null_ = /^-0(?:\.0+)?$/.test(text);
  return (null_ ? text.slice(1) : text).replace('.', ',').replace(/^-/, '−');
}

/**
 * Eine eingegebene Zahl so, wie sie steht — ohne Runden, mit Komma und
 * echtem Minuszeichen. Für Vorgaben wie die Norm-Außentemperatur (−12 °C,
 * −12,5 °C), die nicht gerechnet, sondern übernommen werden.
 */
export function wie(wert: number): string {
  return String(wert).replace('.', ',').replace(/^-/, '−');
}

/**
 * Datum für Ausdrucke: „08.10.2026" — zweistellig, wie in Schriftfeldern
 * üblich. `toLocaleDateString('de-DE')` allein liefert „8.10.2026", und zwei
 * Blätter derselben Mappe trugen bis 1.74.0 beide Schreibweisen.
 */
export function deDatum(d: Date = new Date()): string {
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
