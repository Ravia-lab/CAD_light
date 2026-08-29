/**
 * Was beim Übernehmen eines Geschosses mitwandert — und was nicht.
 * ---------------------------------------------------------------------------
 * „Grundriss des aktuellen Geschosses übernehmen" ist eine Geste, aber drei
 * verschiedene Antworten. Wände, Knoten und Öffnungen beschreiben den
 * Grundriss und werden kopiert; ein Pfeiler oder ein Wandversatz gehört zu
 * genau diesem Grundriss und wird deshalb wie eine Wand behandelt. Eine
 * Treppe dagegen *verbindet* zwei Geschosse und existiert genau einmal —
 * kopiert man sie, steht im Obergeschoss eine zweite Treppe, die dort nichts
 * verbindet und die Deckenöffnung ein zweites Mal abzieht. Ein Schornstein
 * durchstößt jede Decke und ist aus demselben Grund einmalig: er ist im
 * Geschoss darüber schon da, weil `throughAllLevels` ihn dorthin trägt.
 *
 * Warum das eine eigene Datei im Rechenkern ist und nicht im Store steht:
 * die Regel ist fachlich, nicht Zustandsverwaltung. Sie lässt sich als
 * Funktion vollständig prüfen — Eingang sind die Bauteile eines Geschosses,
 * Ausgang die Kopien und die begründete Liste dessen, was liegen bleibt.
 * Im Store bliebe sie nur zusammen mit React, Historie und Raumerkennung
 * prüfbar, und der Prüfblock müsste eine Schicht anfassen, die er nicht
 * prüfen will.
 *
 * Die Funktion vergibt keine IDs selbst. Wer sie aufruft, reicht seinen
 * eigenen ID-Erzeuger herein — sonst müsste dieses Modul einen Zähler
 * mitführen, also Zustand halten, und wäre nicht mehr wiederholbar prüfbar.
 */

import type { BimNode, Opening, SolidElement, VerticalElement, Wall } from '../types/bim';

/** Warum ein Bauteil beim Übernehmen liegen bleibt. */
export type LevelCopySkipReason =
  /** Verbindet zwei Geschosse — eine Treppe gibt es einmal, nicht je Geschoss. */
  | 'verbindet-geschosse'
  /** Läuft ohnehin durch alle Geschosse darüber (Schornstein, Steigschacht). */
  | 'durchgehend';

export interface LevelCopySkip {
  id: string;
  art: 'vertikal' | 'massiv';
  grund: LevelCopySkipReason;
}

export interface LevelCopyInput {
  /** Geschoss, dessen Grundriss übernommen wird. */
  sourceLevelId: string;
  /** Das neu angelegte Geschoss, in das die Kopien gehören. */
  targetLevelId: string;
  /**
   * Lichte Höhe des neuen Geschosses [m]. Die kopierten Wände bekommen sie
   * gesetzt: eine Wand ist so hoch wie das Geschoss, in dem sie steht, und
   * nicht so hoch wie ihre Vorlage.
   */
  targetHeight: number;
  nodes: readonly BimNode[];
  walls: readonly Wall[];
  openings: readonly Opening[];
  verticals: readonly VerticalElement[];
  solids: readonly SolidElement[];
  /** ID-Erzeuger des Aufrufers; bekommt das übliche Präfix ('n', 'w', 'o', 'm'). */
  newId: (prefix: string) => string;
}

export interface LevelCopyResult {
  nodes: BimNode[];
  walls: Wall[];
  openings: Opening[];
  solids: SolidElement[];
  /** Was bewusst nicht kopiert wurde, mit Begründung. */
  skipped: LevelCopySkip[];
}

/**
 * Wandert ein massives Bauteil beim Übernehmen mit?
 *
 * Ja, solange es zu genau einem Geschoss gehört. Ein durchgehendes Bauteil
 * steht im Geschoss darüber ohnehin — es zusätzlich zu kopieren hieße, es
 * doppelt zu führen und seine Grundfläche zweimal abzuziehen.
 */
export function copiesWithLevel(solid: Pick<SolidElement, 'throughAllLevels'>): boolean {
  return !solid.throughAllLevels;
}

/**
 * Erzeugt die Kopien für ein übernommenes Geschoss.
 *
 * Die Eingangslisten dürfen ruhig alle Geschosse enthalten; gefiltert wird
 * hier. Nichts wird verändert — das Ergebnis besteht ausschließlich aus neuen
 * Objekten, die der Aufrufer in sein Dokument einhängt.
 */
export function copyLevelContents(input: LevelCopyInput): LevelCopyResult {
  const { sourceLevelId, targetLevelId, targetHeight, newId } = input;
  const result: LevelCopyResult = { nodes: [], walls: [], openings: [], solids: [], skipped: [] };

  // Knoten zuerst: die Wände brauchen die neuen IDs ihrer Endpunkte.
  const nodeMap = new Map<string, string>();
  for (const node of input.nodes) {
    if (node.levelId !== sourceLevelId) continue;
    const id = newId('n');
    nodeMap.set(node.id, id);
    result.nodes.push({ ...node, id, levelId: targetLevelId });
  }

  for (const wall of input.walls) {
    if (wall.levelId !== sourceLevelId) continue;
    const a = nodeMap.get(wall.a);
    const b = nodeMap.get(wall.b);
    // Eine Wand ohne beide Endpunkte im selben Geschoss ist ein Datenfehler.
    // Sie wird übergangen und nicht repariert: eine geratene Lage wäre
    // schlimmer als eine fehlende Wand, die im Plan sofort auffällt.
    if (!a || !b) continue;
    const id = newId('w');
    result.walls.push({ ...wall, id, a, b, levelId: targetLevelId, height: targetHeight });
    for (const op of input.openings) {
      if (op.wallId !== wall.id) continue;
      result.openings.push({ ...op, id: newId('o'), wallId: id });
    }
  }

  // Treppen und Schächte gehen nie mit hoch — siehe Kopfkommentar.
  for (const vertikal of input.verticals) {
    if (vertikal.levelId !== sourceLevelId) continue;
    result.skipped.push({ id: vertikal.id, art: 'vertikal', grund: 'verbindet-geschosse' });
  }

  for (const massiv of input.solids) {
    if (massiv.levelId !== sourceLevelId) continue;
    if (!copiesWithLevel(massiv)) {
      result.skipped.push({ id: massiv.id, art: 'massiv', grund: 'durchgehend' });
      continue;
    }
    result.solids.push({ ...massiv, id: newId('m'), levelId: targetLevelId });
  }

  return result;
}
