/**
 * Auf welchem Geschoss ein Gerät des Außengeländes angefasst wird.
 *
 * **Das Problem, das dieses Modul löst.** Die Wärmepumpe liegt in
 * `doc.site.pumps` und damit im Gelände, nicht in einem Geschoss. Bis 1.36.2
 * folgte daraus, dass sie in jedem Grundriss gezeichnet, angetippt,
 * verschoben und **gelöscht** werden konnte. Im Obergeschoss stand damit ein
 * Kasten mitten im Zimmer, den man dort wegnehmen konnte, obwohl er im Garten
 * steht. Gemeldet wurde es genau so: „wenn ich die im eg setze kann ich die
 * in der zeichnung auch im og sehen und löschen, die ist dann weg".
 *
 * **Die Regel.** Ein Gerät gehört dem Geschoss, auf dem es aufgestellt wurde.
 * Dort ist es voll greifbar. Auf allen anderen Geschossen scheint es durch —
 * sichtbar, damit man den Aufstellort beim Planen der Leitung im Blick hat,
 * aber nicht anfassbar. Das ist dieselbe Regel, die im Grundriss schon für
 * Durchbrüche gilt („Was von unten durchscheint, ist nicht greifbar").
 *
 * **Warum das Gelände selbst nicht so behandelt wird.** Die
 * Grundstücksgrenze, der Nachbarbau, der Baum: Das ist der Untergrund, auf
 * dem das ganze Haus steht, und der ist in jedem Geschoss derselbe. Ein Gerät
 * dagegen stellt man an einer Stelle auf — es hat einen Aufstellort und damit
 * ein Geschoss.
 */

import type { BimDocument, HeatPump, LevelId } from '../types/bim';

/**
 * Das Geschoss, auf dem dieses Gerät aufgestellt ist.
 *
 * **Der Rückfall für ältere Projekte.** Ohne Eintrag gilt das Geschoss, das
 * am dichtesten an ±0,00 liegt — bei Gleichstand das untere. Das ist keine
 * Verlegenheitswahl: Eine Außeneinheit steht neben dem Haus auf dem Gelände,
 * und das Gelände liegt am Erdgeschoss. Die Alternative — das unterste
 * Geschoss — träfe in jedem Haus mit Keller daneben, und die andere
 * Alternative — das aktive Geschoss — hieße, dass das Gerät mitwandert und
 * sich damit überhaupt nicht mehr festmachen lässt.
 *
 * Gibt es kein Geschoss, gibt es auch keinen Aufstellort; dann `undefined`.
 */
export function aufstellgeschoss(doc: BimDocument, pump: HeatPump): LevelId | undefined {
  if (pump.levelId && doc.levels[pump.levelId]) return pump.levelId;
  let beste: { id: LevelId; abstand: number; order: number } | undefined;
  for (const level of Object.values(doc.levels)) {
    const abstand = Math.abs(level.elevation);
    if (
      !beste ||
      abstand < beste.abstand - 1e-9 ||
      (Math.abs(abstand - beste.abstand) <= 1e-9 && level.order < beste.order)
    ) {
      beste = { id: level.id, abstand, order: level.order };
    }
  }
  return beste?.id;
}

/**
 * Steht das Gerät auf *diesem* Geschoss — ist es hier also greifbar?
 *
 * Gibt es überhaupt kein Geschoss im Dokument, ist die Antwort `false`: Ein
 * Gerät ohne Aufstellgeschoss lässt sich nirgends anfassen, und das ist
 * richtiger, als es überall anfassbar zu machen.
 */
export function stehtAufGeschoss(doc: BimDocument, pump: HeatPump, levelId: LevelId): boolean {
  return aufstellgeschoss(doc, pump) === levelId;
}
