/**
 * Prüfblock „Dachgeschoss" — das Dach gehört einem Geschoss, nicht allen.
 *
 * **Der Fehler, der hier nicht mehr passieren soll.** Bis 1.28.0 baute die
 * 3D-Ansicht den Dachrahmen aus *allen sichtbaren* Wänden und wandte ihn auf
 * *jede* Wand an — unabhängig davon, auf welchem Geschoss sie steht. Weil das
 * Kappen in den lokalen Höhen der jeweiligen Wand rechnet, bekam damit jedes
 * Stockwerk sein eigenes Dach: dieselbe Schräge, einmal je Geschoss, mitten
 * durch die Wände. Im Erdgeschoss stand ein Dach, das es nicht gibt.
 *
 * Es war ein Rückfall aus 1.27.0 und niemandem anzulasten außer der Änderung
 * selbst: Vorher wurde nur das aktive Geschoss gezeichnet, `walls` und „die
 * Wände des Dachgeschosses" waren dieselbe Menge, und die fehlende
 * Unterscheidung fiel nicht auf. Mit der Geschosssichtbarkeit fielen die
 * beiden Mengen auseinander — und der Dachpfad merkte es nicht.
 *
 * **Was dieser Block ist und was nicht.** Er liest `Viewer3D.tsx` als *Text*.
 * Er beweist nicht, dass die Geometrie stimmt — das kann nur ein Bild oder ein
 * Strahl im echten Browser. Er ist ein Stolperdraht: Er schlägt an, sobald die
 * Geschossunterscheidung aus dem Dachpfad verschwindet, und das ist genau die
 * eine Bewegung, mit der dieser Fehler zurückkommt.
 *
 * Warum überhaupt am Text? Weil `src/components` für die Prüfblöcke gesperrt
 * ist — der Rechenkern wird ohne Oberfläche ausgeliefert, und ein Prüfblock,
 * der die Ansicht importiert, bräche das Paket. Die Alternative wäre, gar
 * nichts zu prüfen.
 */

import { readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import type { CheckFn } from './typ';

/** Projektwurzel bestimmen — dieselbe Suche wie im Block „Schichtgrenze". */
function wurzel(): string | undefined {
  let pfad = process.cwd();
  for (let i = 0; i < 4; i++) {
    try {
      if (statSync(join(pfad, 'src', 'lib')).isDirectory()) return pfad;
    } catch {
      /* weiter oben suchen */
    }
    const eltern = pfad.slice(0, pfad.lastIndexOf(sep));
    if (!eltern || eltern === pfad) break;
    pfad = eltern;
  }
  return undefined;
}

/** Zeilen ohne Kommentare — ein Kommentar, der `roofFrame` erwähnt, zählt nicht. */
function code(text: string): string[] {
  const raus: string[] = [];
  let imBlock = false;
  for (const zeile of text.split('\n')) {
    const t = zeile.trim();
    if (imBlock) {
      if (t.includes('*/')) imBlock = false;
      continue;
    }
    if (t.startsWith('/*')) {
      if (!t.includes('*/')) imBlock = true;
      continue;
    }
    if (t.startsWith('//') || t.startsWith('*')) continue;
    raus.push(zeile.replace(/\/\/.*$/, ''));
  }
  return raus;
}

export function pruefeDachgeschoss(check: CheckFn): void {
  const basis = wurzel();
  check('Die Projektwurzel ist auffindbar', basis !== undefined, true);
  if (!basis) return;

  const text = readFileSync(join(basis, 'src', 'components', 'Viewer3D.tsx'), 'utf8');
  const zeilen = code(text);
  const quelltext = zeilen.join('\n');

  // === 1 — Die Unterscheidung existiert überhaupt ==========================
  check('Es gibt ein benanntes Dachgeschoss', quelltext.includes('const dachGeschoss ='), true);
  check('… und daraus abgeleitete Wände', quelltext.includes('const dachWaende ='), true);
  check('… und daraus abgeleitete Räume', quelltext.includes('const dachRaeume ='), true);

  // === 2 — Umriss und Raster kommen aus dem Dachgeschoss ==================
  //
  // Der Umriss bestimmt, wo First, Grat und Kehle liegen. Kommt er aus allen
  // sichtbaren Geschossen, liegt das Dach über einem Grundriss, den es so
  // nirgends gibt — und zwar auch dann, wenn das Kappen richtig wäre.
  check('Der Dachumriss wird aus den Wänden des Dachgeschosses gebildet',
    quelltext.includes('for (const w of dachWaende)'), true);
  check('Der Gebäudeumriss ebenfalls',
    quelltext.includes('gebaeudeUmriss(dachWaende'), true);
  check('Das Dachraster deckt nur die Räume des Dachgeschosses',
    quelltext.includes('dachRaeume.map((r) => r.polygon)'), true);

  // === 3 — Gekappt wird nur, was unter diesem Dach steht ===================
  check('Die Wand fragt nach ihrem eigenen Geschoss',
    quelltext.includes('wall.levelId === dachGeschoss'), true);
  check('… und kappt mit dem geschossgebundenen Rahmen',
    quelltext.includes('roofHeightAt(wandDach'), true);

  /*
   * Der eigentliche Stolperdraht: Ein *nackter* `roofHeightAt(roofFrame, …)`
   * ist die Schreibweise, die den Fehler hatte. Genau ein Vorkommen ist
   * erlaubt — das Dachraster selbst, denn das *ist* die Dachfläche des
   * Dachgeschosses. Jedes weitere bedeutet: irgendetwas wird wieder an einem
   * Dach gekappt, ohne nach dem Geschoss zu fragen.
   */
  const nackt = (quelltext.match(/roofHeightAt\(roofFrame\b/g) ?? []).length;
  check('Genau ein ungeschützter Aufruf — das Dachraster selbst', nackt, 1);

  // === 4 — Auch die TGA endet nur unter ihrem eigenen Dach =================
  //
  // Ein Lüftungsventil im Erdgeschoss wurde an der Schräge des Obergeschosses
  // gekappt und verschwand dadurch ganz, sobald das Dach tief genug saß.
  check('Die TGA-Körper kennen das Dachgeschoss',
    quelltext.includes('roofLevelId: string'), true);
  check('… und vergleichen es je Objekt',
    quelltext.includes('f.levelId === roofLevelId'), true);
}
