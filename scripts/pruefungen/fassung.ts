/**
 * Prüfblock „Fassung" — eine Nummer, ein Ort.
 *
 * **Der Fehler, der hier nicht mehr passieren soll.** Die Fassungsnummer
 * stand an vier Stellen: in `package.json`, als `GENERATOR` im RaVia-Export
 * und zweimal wörtlich im IFC-Export. Beim Freigeben wurde die erste
 * gepflegt. Fassung 1.27.0 schrieb deshalb in jede Exportdatei „RaVia CAD
 * Light 1.25.0" — zwei Fassungen zu alt, über Monate, und niemandem
 * aufgefallen, weil die Zahl in keiner Prüfung vorkam.
 *
 * Das wiegt schwerer, seit eine Gegenstelle mit den Dateien arbeitet: Der
 * Erzeugervermerk ist das Einzige, woran später ablesbar ist, welches
 * Programm eine Datei geschrieben hat. Wer einen Rechenfehler auf eine
 * Fassung zurückführen will, hat sonst eine Zahl, die lügt — und sucht in
 * der falschen Fassung.
 *
 * Geprüft wird deshalb nicht, *welche* Nummer dort steht, sondern dass alle
 * Stellen dieselbe nennen und dass sie aus `src/lib/fassung.ts` kommt.
 */

import { readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import type { CheckFn } from './typ';
import { ERZEUGER, FASSUNG } from '../../src/lib/fassung';
import { GENERATOR } from '../../src/lib/raviaExport';

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

export function pruefeFassung(check: CheckFn): void {
  const basis = wurzel();
  check('Die Projektwurzel ist auffindbar', basis !== undefined, true);
  if (!basis) return;

  // === 1 — Die Form ========================================================
  check('Die Fassung hat die Form major.minor.patch', /^\d+\.\d+\.\d+$/.test(FASSUNG), true);
  check('Der Erzeugervermerk nennt sie', ERZEUGER, `RaVia CAD Light ${FASSUNG}`);

  // === 2 — package.json sagt dasselbe ======================================
  const paket = JSON.parse(readFileSync(join(basis, 'package.json'), 'utf8')) as { version?: string };
  check('package.json nennt dieselbe Fassung', paket.version ?? 'fehlt', FASSUNG);

  // === 3 — Das Handbuch trägt dieselbe Nummer ===============================
  /*
   * **Der vierte Ort, an dem die Nummer stand.** `handbuch/bauen.py` hatte
   * bis 1.34.0 eine eigene Zeichenkette `VERSION = '1.31.0'`, und niemand
   * pflegte sie. Das Handbuch behauptete damit über drei Fassungen hinweg,
   * es beschreibe 1.31.0 — auf dem Deckblatt, im Seitentitel, im Fußtext
   * jeder Seite. Ausgeliefert wurde das auch: Auf `ravia-tech.de/Cad_light/`
   * stand 1.31.0 im Handbuch, während 1.32.0 lief.
   *
   * Genau dieser Fehler hat 1.28.0 diesen Prüfblock ausgelöst — nur war das
   * Handbuchskript damals nicht dabei. Geprüft wird deshalb nicht, welche
   * Nummer dort steht, sondern **dass dort keine steht**: Das Skript muss
   * sie aus `src/lib/fassung.ts` lesen.
   */
  const bauen = readFileSync(join(basis, 'handbuch', 'bauen.py'), 'utf8');
  check(
    'Das Handbuchskript liest die Fassung aus fassung.ts',
    /fassung\.ts/.test(bauen) && /VERSION = fassung\(\)/.test(bauen),
    true,
  );
  check(
    'Es trägt keine eigene Fassungsnummer mehr',
    /VERSION\s*=\s*'[0-9]+\.[0-9]+\.[0-9]+'/.test(bauen),
    false,
  );

  // === 4 — Der RaVia-Export auch ===========================================
  check('Der RaVia-Export nennt dieselbe Fassung', GENERATOR, ERZEUGER);

  // === 5 — Und keine Datei trägt sie noch wörtlich =========================
  //
  // Die eigentliche Ursache war nicht die falsche Zahl, sondern dass sie
  // mehrfach dastand. Hier schlägt deshalb schon an, *dass* jemand wieder
  // eine Fassungsnummer in eine Quelldatei schreibt — gleich welche.
  //
  // Ausgenommen ist `fassung.ts` selbst, denn dort gehört sie hin, und
  // Kommentare bleiben außen vor: Sätze wie „bis 1.27.0 lief das anders"
  // sind die Begründung einer Änderung und genau das, was erhalten bleiben
  // soll.
  const dateien = ['src/lib/raviaExport.ts', 'src/lib/ifcExport.ts'];
  let wörtlich = '';
  for (const datei of dateien) {
    const text = readFileSync(join(basis, datei), 'utf8');
    for (const zeile of text.split('\n')) {
      const ohneKommentar = zeile.replace(/\/\/.*$/, '').trimStart();
      if (ohneKommentar.startsWith('*') || ohneKommentar.startsWith('/*')) continue;
      if (/'RaVia CAD Light \d+\.\d+\.\d+'|"RaVia CAD Light \d+\.\d+\.\d+"/.test(ohneKommentar)) {
        wörtlich = `${datei}: ${zeile.trim()}`;
      }
    }
  }
  check('Keine Quelldatei trägt die Fassung wörtlich', wörtlich, '');
}
