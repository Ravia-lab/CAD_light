/**
 * Prüfsummen für den Export — damit die Gegenstelle erkennt, *was* sich
 * geändert hat, und nicht nur *dass* sich etwas geändert hat.
 * ---------------------------------------------------------------------------
 * **Das Problem, für das es sie gibt.** Der Export trägt seit jeher einen
 * Zeitstempel. Der sagt der Gegenstelle: dieses Modell ist neuer als das, was
 * du hast. Was er nicht sagt: ob der Raum, für den du gestern eine Heizlast
 * gerechnet hast, davon überhaupt betroffen ist. Wer nur den Zeitstempel hat,
 * muss beim erneuten Abgleich entweder alles verwerfen — dann ist jede
 * gerechnete Heizlast weg, weil jemand im Nachbargeschoss eine Steckdose
 * verschoben hat — oder alles behalten und stillschweigend mit veralteten
 * Zahlen weiterrechnen. Beides ist falsch, und das zweite fällt niemandem auf.
 *
 * **Was die Prüfsumme deckt.** Genau die Größen, aus denen sich die Heizlast
 * des Raums ergibt: Geometrie, Hüllbauteile mit ihren U-Werten und
 * Randbedingungen, Öffnungen, Solltemperatur, Luftwechsel, Wärmebrücken. Sie
 * ist damit die Antwort auf eine einzige, sehr konkrete Frage:
 *
 *   > Ist die Heizlast, die ich für diesen Raum gerechnet habe, noch gültig?
 *
 * **Was sie bewusst nicht deckt.** Den Namen des Raums, seine Farbe, die
 * Beschriftung, die Lage des Stempels im Plan. Wer „Kind 1" in „Emma"
 * umbenennt, hat nichts gerechnet, was ungültig würde; eine Prüfsumme, die
 * darauf anspringt, erzeugt Fehlalarme, und nach dem dritten Fehlalarm schaut
 * niemand mehr hin. Ebenso wenig deckt sie den Zeitstempel des Exports —
 * sonst wäre jeder Export anders als der vorige, und die ganze Übung wäre
 * umsonst.
 *
 * **Warum ein eigener Hash und keine Bibliothek.** Es geht um
 * Änderungserkennung, nicht um Kryptografie: niemand versucht, zwei Modelle
 * zu bauen, die dieselbe Summe ergeben. Gebraucht wird, dass dasselbe Modell
 * immer dieselbe Summe ergibt — auch in einem anderen Browser, auch nach
 * einem Neustart, auch auf der Gegenseite, wenn sie nachrechnen will. Ein
 * Abhängigkeitspaket dafür wäre teurer als die zwanzig Zeilen hier, und
 * `crypto.subtle` ist asynchron und im Prüflauf nicht ohne Weiteres da.
 */

/**
 * FNV-1a, 32 Bit, zweimal mit verschiedenen Startwerten — zusammen 64 Bit.
 *
 * Ein einzelner 32-Bit-Hash ist für Änderungserkennung zu knapp: Bei einigen
 * hundert Räumen liegt die Wahrscheinlichkeit einer zufälligen Kollision nach
 * dem Geburtstagsproblem schon im Promillebereich, und eine Kollision hieße
 * hier „Änderung nicht bemerkt" — also genau der Fehler, den die Prüfsumme
 * verhindern soll. Mit 64 Bit ist sie verschwindend.
 *
 * `Math.imul` statt `*`: Die FNV-Multiplikation läuft über 2^53 hinaus, und
 * eine Gleitkommamultiplikation verlöre dort die unteren Bits — der Hash wäre
 * dann auf verschiedenen Rechnern derselbe, aber deutlich schwächer, als er
 * aussieht.
 */
export function hash64(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x85ebca6b) >>> 0;
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}

/**
 * Kanonische Textform eines Werts — die Grundlage jeder Prüfsumme.
 *
 * `JSON.stringify` allein reicht nicht: Es schreibt die Felder eines Objekts
 * in Einfügereihenfolge. Zwei Modelle mit gleichem Inhalt, aber anders
 * entstandenen Objekten ergäben dann verschiedene Summen — ein Fehlalarm bei
 * jedem zweiten Export. Hier werden die Schlüssel deshalb sortiert.
 *
 * Zahlen werden auf sechs Nachkommastellen gerundet. Ohne das springt die
 * Summe auf Rechenrauschen im Bereich 1e-15 an, das beim Planarisieren der
 * Wandachsen entsteht und keine Fläche um ein Mikrometer ändert. Mit sechs
 * Stellen bleibt ein Millimeter noch drei Größenordnungen über der Schwelle.
 *
 * `-0` wird zu `0`: Beides ist dieselbe Zahl, und ein Vorzeichen, das aus
 * einer Drehung um 180° stammt, darf keine Änderung melden.
 *
 * Felder mit dem Wert `undefined` fallen heraus — ein nicht gesetztes Feld
 * und ein fehlendes Feld sind dasselbe. `null` dagegen bleibt stehen.
 *
 * **Zur Bauart.** Eine stückweise Fassung, die den Hash direkt füttert statt
 * die Zeichenkette zu bauen, liegt nahe und war auch einmal da — sie war in
 * der Belastungsprobe *langsamer* (305 statt 258 ms bei 720 Räumen). Der
 * Aufruf je Teilstück kostet mehr als die Zeichenketten, die V8 intern als
 * Seil hält und erst beim Lesen zusammenzieht. Also bleibt es bei der
 * einfachen Fassung; sie ist die schnellere und dazu die lesbarere.
 */
export function kanonisch(wert: unknown): string {
  if (wert === null || wert === undefined) return 'null';
  if (typeof wert === 'number') {
    if (!Number.isFinite(wert)) return String(wert);
    const g = Math.round(wert * 1e6) / 1e6;
    return Object.is(g, -0) ? '0' : String(g);
  }
  if (typeof wert === 'boolean' || typeof wert === 'string') return JSON.stringify(wert);
  if (Array.isArray(wert)) return `[${wert.map(kanonisch).join(',')}]`;
  const obj = wert as Record<string, unknown>;
  const schluessel = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${schluessel.map((k) => `${JSON.stringify(k)}:${kanonisch(obj[k])}`).join(',')}}`;
}

/** Prüfsumme über einen beliebigen Wert, kanonisch serialisiert. */
export function pruefsumme(wert: unknown): string {
  return hash64(kanonisch(wert));
}
