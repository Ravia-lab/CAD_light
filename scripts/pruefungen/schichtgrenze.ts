/**
 * Prüfblock „Schichtgrenze" — der Rechenkern muss für sich allein stehen.
 *
 * **Was hier schiefgehen kann und warum es niemandem auffällt.** `src/lib`,
 * `src/types` und `scripts` werden als eigenständiges Paket an die Gegenstelle
 * übergeben (`build_kernel.py`) — ohne Store, ohne Oberfläche, ohne React.
 * Genau das ist das Versprechen des Pakets. Im Hauptprojekt liegt aber alles
 * nebeneinander, und ein Import aus `src/store` übersetzt dort anstandslos.
 * Der Verstoß fällt erst beim Auslagern auf, in einem Bauschritt, den niemand
 * bei jeder Änderung fährt — zuletzt an einem Prüfblock, der den Store
 * benutzte, um `addLevel` zu prüfen. Zwanzig Folgefehler, und keiner davon
 * zeigte auf die Ursache.
 *
 * Diese Prüfung hält die Grenze deshalb selbst fest. Sie liest die
 * Modulangaben der Dateien unter `scripts/`, `src/lib/` und `src/types/` und
 * schlägt an, sobald dort ein Pfad steht, dessen Abschnitte `store` oder
 * `components` enthalten. Sie rechnet nichts und ersetzt keine Übersetzung —
 * sie ist die billigste Versicherung gegen einen Rückfall, der sonst erst
 * beim Ausliefern auffliegt.
 *
 * **Warum Textsuche und nicht der Übersetzer.** Der Übersetzer sieht im
 * Hauptprojekt beide Schichten und hat nichts zu beanstanden; die Grenze ist
 * eine Entwurfsentscheidung, keine Typfrage. Gelesen werden ausschließlich
 * die Modulangaben von `import`/`export … from` und `import(…)` — ein
 * Kommentar, der `src/store` erwähnt (wie dieser hier), löst nichts aus.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import type { CheckFn } from './typ';

/**
 * Verzeichnisse, die zum ausgelagerten Paket gehören und deshalb sauber
 * bleiben müssen. `src/components` und `src/store` stehen bewusst nicht
 * darin: sie dürfen alles benutzen, sie werden nicht mitgeliefert.
 */
const GEPRUEFT = ['scripts', join('src', 'lib'), join('src', 'types')];

/** Verzeichnisse, die es im Kernel-Paket nicht gibt — die Grenze selbst. */
const VERBOTEN = ['store', 'components'];

const ENDUNGEN = ['.ts', '.tsx', '.mts', '.mjs', '.js'];

/**
 * Modulangaben einer Quelldatei.
 *
 * Erfasst `import … from 'x'`, `export … from 'x'`, den Nebenwirkungsimport
 * `import 'x'` und die dynamische Form `import('x')`. Was in Zeichenketten
 * oder Kommentaren steht, bleibt außen vor — sonst könnte dieser Prüfblock
 * seinen eigenen Erklärtext nicht schreiben.
 */
function modulangaben(quelle: string): string[] {
  const treffer: string[] = [];
  const muster = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"]([^'"\n]+)['"]/g;
  let m = muster.exec(quelle);
  while (m !== null) {
    treffer.push(m[1]);
    m = muster.exec(quelle);
  }
  return treffer;
}

/** Zeigt die Angabe in ein verbotenes Verzeichnis? Geprüft wird abschnittsweise. */
function verletztGrenze(angabe: string): string | undefined {
  const abschnitte = angabe.split('/');
  return VERBOTEN.find((v) => abschnitte.includes(v));
}

function dateien(wurzel: string): string[] {
  const gefunden: string[] = [];
  const lauf = (pfad: string): void => {
    for (const eintrag of readdirSync(pfad)) {
      if (eintrag === 'node_modules' || eintrag.startsWith('.')) continue;
      const voll = join(pfad, eintrag);
      if (statSync(voll).isDirectory()) lauf(voll);
      else if (ENDUNGEN.some((e) => eintrag.endsWith(e))) gefunden.push(voll);
    }
  };
  lauf(wurzel);
  return gefunden.sort();
}

/**
 * Projektwurzel bestimmen.
 *
 * `npm run verify` startet im Paketverzeichnis — im Hauptprojekt wie im
 * ausgelagerten Kernel. Der Aufstieg über einige Ebenen ist die Rückfallebene
 * für den Aufruf aus einem Unterverzeichnis heraus.
 */
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

export function pruefeSchichtgrenze(check: CheckFn): void {
  const basis = wurzel();
  check('Die Projektwurzel ist auffindbar', basis !== undefined, true);
  if (!basis) return;

  const verstoesse: string[] = [];
  let geprueft = 0;

  for (const verzeichnis of GEPRUEFT) {
    let liste: string[];
    try {
      liste = dateien(join(basis, verzeichnis));
    } catch {
      // Ein Verzeichnis darf fehlen: das Kernel-Paket führt kein `src/store`,
      // und ein künftiger Zuschnitt darf auch `scripts` weglassen. Fehlt es,
      // gibt es dort nichts zu verletzen.
      continue;
    }
    for (const datei of liste) {
      geprueft++;
      const kurz = datei.slice(basis.length + 1);
      for (const angabe of modulangaben(readFileSync(datei, 'utf-8'))) {
        const treffer = verletztGrenze(angabe);
        if (treffer) verstoesse.push(`${kurz} → ${angabe} (${treffer})`);
      }
    }
  }

  check('Es gibt Dateien zu prüfen', geprueft > 0, true);
  check('Kein Import aus einer Schicht, die dem Kernel-Paket fehlt', verstoesse.join(' | '), '');
  // Die Zahl der Verstöße getrennt: sie steht auch dann im Protokoll, wenn die
  // Liste oben lang wird und im Terminal umbricht.
  check('Zahl der Grenzverletzungen', verstoesse.length, 0);
  console.log(`    ${geprueft} Dateien gelesen in ${GEPRUEFT.join(', ')}`);
}
