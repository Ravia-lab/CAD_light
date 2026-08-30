/**
 * Das Druckfenster — ein Weg für alle fünf Ausdrucke.
 * ---------------------------------------------------------------------------
 * **Der Anlass.** Bis 1.14.0 schrieb jeder der fünf Druckwege
 * (`planPrint`, `schematicPrint`, `pipeReportPrint`, `plantBook`,
 * `projektMappe`) ein eigenes `<script>` in das neue Fenster, das nach dem
 * Laden `window.print()` rief. Das funktioniert — solange niemand eine
 * Inhaltsrichtlinie setzt.
 *
 * Genau das ändert sich mit dem Serverbetrieb. Ein Fenster aus
 * `window.open('', '_blank')` erbt die Richtlinie des Öffners, und ein
 * Server, der `script-src 'self'` ausliefert, verwirft ein eingebettetes
 * Skript. Der Ausdruck erschiene dann als Seite, aber **der Druckdialog ginge
 * nicht auf**. Das ist der unangenehmste Fehlertyp, den dieses Projekt kennt:
 * er tritt auf dem Entwicklungsrechner nie auf, weil dort keine Richtlinie
 * gilt, und beim Kunden immer.
 *
 * **Die Lösung ist keine Ausnahme in der Richtlinie, sondern eine weggenommene
 * Zeile.** Der Druck wird vom **Öffner** ausgelöst. Er darf das ohne jede
 * Ausnahme: es ist dasselbe Fenster mit derselben Herkunft, und der Aufruf
 * steht in gewöhnlichem Anwendungscode statt im Dokument. Die Richtlinie
 * bleibt dadurch bei `script-src 'self'`, ohne `'unsafe-inline'`.
 *
 * **Und ein zweites Problem verschwindet mit.** Zwei der fünf Wege setzten den
 * Fenstertitel über dasselbe eingebettete Skript und mussten den Projektnamen
 * dafür doppelt entschärfen — einmal gegen `</script>` im Titel, einmal gegen
 * die Sonderzeichen der Ersatzfunktion von `String.replace`. Ein Titel, der
 * als Eigenschaft gesetzt wird, ist keine Zeichenkette in einem Dokument und
 * braucht diese Entschärfung nicht.
 */

/**
 * Öffnet ein Fenster, schreibt das Dokument hinein und löst den Druck aus.
 *
 * Gibt `false` zurück, wenn das Fenster nicht geöffnet werden konnte — das
 * ist der Regelfall, wenn ein Blocker für Pop-up-Fenster zuschlägt, und der
 * Aufrufer muss es dem Anwender sagen können.
 */
export function druckeDokument(html: string, titel: string): boolean {
  const win = window.open('', '_blank');
  if (!win) return false;

  win.document.write(html);
  win.document.close();

  /*
   * Der Titel steht im Druckbild: die meisten Browser setzen ihn in die Kopf-
   * oder Fußzeile des Ausdrucks. Er wird als Eigenschaft gesetzt und nicht in
   * das Dokument geschrieben — damit ist jedes Sonderzeichen im Projektnamen
   * unbedenklich, auch `</script>` und `$&`.
   */
  if (titel) {
    try {
      win.document.title = titel;
    } catch {
      // Ein Fenster, das inzwischen geschlossen wurde, hat kein Dokument mehr.
    }
  }

  loeseDruckAus(win);
  return true;
}

/**
 * Den Druckdialog auslösen, sobald das Fenster fertig aufgebaut ist.
 *
 * Die Verzögerung von 250 ms ist geblieben und hat einen Grund: Schriften und
 * Bilder brauchen einen Moment, und ein Druckdialog über einem halb
 * aufgebauten Blatt liefert ein halbes Blatt.
 *
 * Die Abfrage auf `readyState` davor ist der eigentliche Fallstrick. Ein
 * Fenster, das gerade mit `document.write` beschrieben und mit
 * `document.close()` abgeschlossen wurde, ist in aller Regel schon
 * `'complete'` — das `load`-Ereignis ist dann **bereits gefallen** und feuert
 * kein zweites Mal. Wer nur darauf horcht, wartet vergeblich.
 */
export function loeseDruckAus(win: Window): void {
  const drucken = (): void => {
    window.setTimeout(() => {
      try {
        win.focus();
        win.print();
      } catch {
        // Kein Fehlerfall, nur kein Ausdruck: der Anwender hat das Fenster
        // in der Zwischenzeit geschlossen.
      }
    }, 250);
  };

  try {
    if (win.document.readyState === 'complete') drucken();
    else win.addEventListener('load', drucken, { once: true });
  } catch {
    // Fenster weg — nichts zu drucken.
  }
}
