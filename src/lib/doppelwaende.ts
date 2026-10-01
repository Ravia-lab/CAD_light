/**
 * Doppelte Wände finden — zwei Kanten zwischen denselben beiden Knoten.
 *
 * **Woher sie kommen.** Beim Anlegen einer Raumvorlage wird erst der Ring
 * gezogen und *danach* werden bestehende Wände an den neuen Ecken geteilt
 * (`splitWallsAtNode`). Diese Reihenfolge ist richtig — sonst zerteilten sich
 * die neuen Wände gegenseitig —, sie hat aber eine Folge: Legt man ein
 * Rechteck neben ein bestehendes, so prüft die Dublettensperre der Vorlage
 * noch gegen die *ungeteilte* Nachbarwand. Deren Knotenpaar ist ein anderes,
 * die Sperre greift nicht, und die gemeinsame Kante entsteht ein zweites Mal.
 * Erst der anschließende Schnitt macht aus der langen Wand zwei Stücke — und
 * eines davon liegt nun deckungsgleich auf der neuen Wand.
 *
 * **Warum das kein Schönheitsfehler ist.** Zwei Wände an derselben Stelle
 * sind zwei Raumgrenzen: Die Hüllfläche zählt die Scheibe zweimal, die
 * Heizlast rechnet mit der doppelten Transmission, und im Massenauszug steht
 * die doppelte Menge Mauerwerk. Im Plan sieht man nichts davon — die zweite
 * Wand liegt exakt unter der ersten. Ein Fehler, der sich nur in Zahlen
 * äußert, muss an der Quelle weg.
 *
 * **Was hier entschieden wird und was nicht.** Dieses Modul rechnet nur:
 * Es sagt, welche Kante bleibt, welche weicht und ob die weichende
 * *gegenläufig* liegt. Es fasst kein Dokument an. Das Umhängen der Öffnungen,
 * Einbauten und Durchbrüche und das Löschen der Wand macht der Aufrufer im
 * Zustand — hier wäre es ein Griff über die Schichtgrenze.
 *
 * **Welche bleibt.** Die **erste** der Reihenfolge. Der Aufrufer übergibt die
 * Wände in Entstehungsreihenfolge, damit ist die erste die ältere: Sie kann
 * längst Öffnungen tragen, eine andere Stärke bekommen haben oder in einem
 * Bauteilaufbau stecken. Die jüngere, eben erst entstandene weicht.
 */

/** Eine Wandkante, auf das Nötige reduziert: Kennung, Enden, Geschoss. */
export interface WandKante {
  id: string;
  /** Knoten am Anfang. */
  a: string;
  /** Knoten am Ende. */
  b: string;
  /** Geschoss — Wände verschiedener Geschosse liegen übereinander, nicht aufeinander. */
  levelId: string;
}

/** Ein Paar: Diese Kante bleibt, jene weicht. */
export interface Verschmelzung {
  /** Kennung der Wand, die bleibt. */
  behalten: string;
  /** Kennung der Wand, die weicht. */
  weg: string;
  /**
   * Liegt die weichende Wand **gegenläufig** zur bleibenden?
   *
   * Dann ist jedes Maß, das vom Anfangsknoten aus gezählt wird — die Lage
   * einer Öffnung, die Mitte eines Durchbruchs —, von der anderen Seite
   * gemessen und muss gespiegelt werden (siehe `gespiegelt`).
   */
  gedreht: boolean;
}

/** Schlüssel eines Knotenpaars, Richtung außen vor. */
function paar(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Alle Dubletten der Liste, in der Reihenfolge der weichenden Kanten.
 *
 * Eine Kante, deren beide Enden derselbe Knoten sind, ist entartet und wird
 * hier nicht angefasst: Sie ist keine Dublette, sondern ein eigener Fehler.
 */
export function doppelteWaende(kanten: readonly WandKante[]): Verschmelzung[] {
  const erste = new Map<string, WandKante>();
  const ergebnis: Verschmelzung[] = [];
  for (const k of kanten) {
    if (k.a === k.b) continue;
    const schluessel = `${k.levelId}#${paar(k.a, k.b)}`;
    const vorhanden = erste.get(schluessel);
    if (!vorhanden) {
      erste.set(schluessel, k);
      continue;
    }
    ergebnis.push({ behalten: vorhanden.id, weg: k.id, gedreht: vorhanden.a !== k.a });
  }
  return ergebnis;
}

/**
 * Ein vom Anfangsknoten gezähltes Maß auf die gegenläufige Wand umrechnen.
 *
 * Gezählt wird bis zur **Mitte** der Öffnung, deshalb genügt die Differenz
 * zur Wandlänge; die Breite spielt keine Rolle. Negativ wird das Ergebnis
 * nie: Ein Maß jenseits der Wandlänge wäre schon vorher falsch, und 0 ist
 * hier die ehrlichere Antwort als eine negative Strecke.
 */
export function gespiegelt(laenge: number, abstand: number): number {
  return Math.max(0, laenge - abstand);
}
