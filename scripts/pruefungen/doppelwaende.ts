/**
 * Prüfblock „Doppelte Wände".
 *
 * **Der Fehler, um den es geht.** Zwei Wandkanten zwischen denselben beiden
 * Knoten. Im Plan unsichtbar — die eine liegt exakt unter der anderen —, in
 * den Zahlen aber überall: Hüllfläche, Transmission, Massenauszug. Entstanden
 * ist er beim Anlegen zweier benachbarter Raumvorlagen, weil die
 * Dublettensperre der Vorlage gegen die noch *ungeteilte* Nachbarwand prüft
 * und der Schnitt erst danach läuft (siehe `src/lib/doppelwaende.ts`).
 *
 * **Warum die Prüfung hier und nicht im Rauchtest steht.** Der Rauchtest
 * zeigt, dass im fertigen Grundriss keine Dublette übrig ist — ein Ergebnis
 * über die ganze Kette. Hier steht die Regel selbst: welche Kante bleibt,
 * welche weicht, wann zwei Kanten *keine* Dublette sind. Jede Zeile hat
 * deshalb ihre Gegenprobe; eine Regel, die zu viel verschmilzt, ist
 * schlimmer als eine, die nichts findet — sie löscht Wände, die es gibt.
 *
 * **Alle Sollwerte sind hergeleitet, nicht abgeschrieben.**
 */

import type { CheckFn } from './typ';
import { doppelteWaende, gespiegelt, type WandKante } from '../../src/lib/doppelwaende';

export function pruefeDoppelwaende(check: CheckFn): void {
  const k = (id: string, a: string, b: string, levelId = 'E0'): WandKante => ({ id, a, b, levelId });

  // -------------------------------------------------------------------------
  // 1 · Gleichläufige Dublette
  // -------------------------------------------------------------------------
  // Zwei Kanten n1→n2. Die erste bleibt, die zweite weicht, nichts ist gedreht.
  const gleich = doppelteWaende([k('w1', 'n1', 'n2'), k('w2', 'n1', 'n2')]);
  check('Doppelwände · eine Dublette gefunden', gleich.length, 1);
  check('Doppelwände · die ältere bleibt', gleich[0].behalten, 'w1');
  check('Doppelwände · die jüngere weicht', gleich[0].weg, 'w2');
  check('Doppelwände · gleichläufig', gleich[0].gedreht, false);

  // -------------------------------------------------------------------------
  // 2 · Gegenläufige Dublette
  // -------------------------------------------------------------------------
  // n1→n2 und n2→n1 sind dieselbe Kante, nur andersherum gezählt.
  const dreh = doppelteWaende([k('w1', 'n1', 'n2'), k('w2', 'n2', 'n1')]);
  check('Doppelwände · auch andersherum erkannt', dreh.length, 1);
  check('Doppelwände · und als gedreht gemeldet', dreh[0].gedreht, true);

  // -------------------------------------------------------------------------
  // 3 · Die Reihenfolge entscheidet, nicht die Kennung
  // -------------------------------------------------------------------------
  // Dieselben zwei Kanten in umgekehrter Übergabe: jetzt bleibt w2.
  const umgekehrt = doppelteWaende([k('w2', 'n2', 'n1'), k('w1', 'n1', 'n2')]);
  check('Doppelwände · die zuerst übergebene bleibt', umgekehrt[0].behalten, 'w2');
  check('Doppelwände · die zweite weicht', umgekehrt[0].weg, 'w1');

  // -------------------------------------------------------------------------
  // 4 · Drei deckungsgleiche Kanten
  // -------------------------------------------------------------------------
  // Zwei Verschmelzungen, und **beide** zeigen auf die erste — nicht
  // kettenweise aufeinander, sonst zeigte eine auf eine gelöschte Wand.
  const drei = doppelteWaende([k('w1', 'n1', 'n2'), k('w2', 'n1', 'n2'), k('w3', 'n2', 'n1')]);
  check('Doppelwände · drei Kanten ergeben zwei Verschmelzungen', drei.length, 2);
  check('Doppelwände · beide zeigen auf dieselbe bleibende',
    drei.every((v) => v.behalten === 'w1'), true);

  // -------------------------------------------------------------------------
  // 5 · Gegenproben: was keine Dublette ist
  // -------------------------------------------------------------------------
  // Zwei Kanten mit einem gemeinsamen Knoten sind eine Ecke, keine Dublette.
  check('Doppelwände · gemeinsame Ecke ist keine Dublette',
    doppelteWaende([k('w1', 'n1', 'n2'), k('w2', 'n2', 'n3')]).length, 0);
  // Dasselbe Knotenpaar in zwei Geschossen: zwei Wände übereinander, beide echt.
  check('Doppelwände · verschiedene Geschosse bleiben verschont',
    doppelteWaende([k('w1', 'n1', 'n2', 'E0'), k('w2', 'n1', 'n2', 'E1')]).length, 0);
  // Eine entartete Kante (beide Enden derselbe Knoten) ist ein eigener Fehler
  // und wird hier nicht angefasst — auch nicht, wenn sie doppelt vorkommt.
  check('Doppelwände · entartete Kanten werden nicht verschmolzen',
    doppelteWaende([k('w1', 'n1', 'n1'), k('w2', 'n1', 'n1')]).length, 0);
  // Und die leere Liste bleibt leer.
  check('Doppelwände · nichts zu tun bei leerer Liste', doppelteWaende([]).length, 0);
  // Ein vollständiges Rechteck: vier Kanten, vier Knoten, keine Dublette.
  check('Doppelwände · ein Rechteck ist sauber',
    doppelteWaende([
      k('w1', 'n1', 'n2'), k('w2', 'n2', 'n3'), k('w3', 'n3', 'n4'), k('w4', 'n4', 'n1'),
    ]).length, 0);

  // -------------------------------------------------------------------------
  // 6 · Gespiegelte Maße
  // -------------------------------------------------------------------------
  // Wand 3,50 m, Öffnungsmitte 1,20 m vom Anfang → von der anderen Seite 2,30 m.
  check('Doppelwände · Maß gespiegelt', gespiegelt(3.5, 1.2), 2.3, 1e-9);
  // Mitte der Wand bleibt Mitte: 3,50 / 2 = 1,75 → 1,75.
  check('Doppelwände · die Mitte bleibt die Mitte', gespiegelt(3.5, 1.75), 1.75, 1e-9);
  // Am Anfang wird zum Ende: 0 → 3,50.
  check('Doppelwände · Anfang wird Ende', gespiegelt(3.5, 0), 3.5, 1e-9);
  // Ein Maß jenseits der Wandlänge war vorher falsch; 0 statt negativ.
  check('Doppelwände · kein negatives Maß', gespiegelt(2, 2.5), 0, 1e-9);
}
