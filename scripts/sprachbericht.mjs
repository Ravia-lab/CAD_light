/**
 * Sprachbericht — wie weit ist die Oberfläche übersetzbar?
 *
 * **Wozu.** Die Umstellung auf `t()` sind rund 1.250 Textstellen. Das ist
 * keine Arbeit für einen Nachmittag, sondern eine, die über Wochen
 * nebenherläuft — und genau deshalb braucht sie eine Zahl, die man jeden
 * Tag ansehen kann. Ohne sie weiß nach drei Wochen niemand mehr, ob es
 * vorangeht.
 *
 * Gezählt werden zwei Dinge, und sie werden **nicht** voneinander
 * abgezogen — das wäre eine Zahl, die genauer aussieht als sie ist:
 *
 *   • **Textstellen**  — deutsche Literale im Quelltext. Sie bleiben auch
 *     nach der Umstellung stehen, denn der deutsche Text *ist* der
 *     Schlüssel. Diese Zahl ist die Landkarte: Sie sagt, wo die Texte
 *     liegen, nicht wie viel Arbeit noch offen ist.
 *   • **Aufrufe**      — `t(…)` und `fach(…)` im Quelltext. Das ist die
 *     Zahl, die wächst, während die Arbeit vorangeht.
 *
 * Warum kein Prozentsatz: Ein einziger `t()`-Aufruf kann eine ganze
 * Tabelle mit zwanzig Texten übersetzen (`t(wz.label)` in einer Schleife).
 * Eine Prozentzahl daraus wäre erfunden, und erfundene Fortschrittszahlen
 * sind schlimmer als gar keine.
 *
 * Kommentare zählen nicht: Sie erklären den Quelltext und werden nicht
 * übersetzt. Auch nicht gezählt werden Pfade, URLs und Ebenenkennungen.
 *
 * Aufruf:  npm run sprache:bericht
 *          npm run sprache:bericht -- --dateien    (je Datei statt Ordner)
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const WURZEL = process.cwd();
const ORDNER = ['src/components', 'src/store', 'src/lib', 'src/types'];
const JE_DATEI = process.argv.includes('--dateien');

/** Sieht der Text nach Deutsch aus? */
const DEUTSCH = /[äöüÄÖÜß]|\b(der|die|das|und|nicht|ist|wird|eine|einen|mit|für|von|dem|den|sich|auf|aus|kein|keine|Raum|Wand|Rohr|Leitung|Heiz|Fenster|Tür|Geschoss|Decke|Boden|Dach|Wände|Räume)\b/;
const LITERAL = /'((?:[^'\\\n]|\\.){3,})'|"((?:[^"\\\n]|\\.){3,})"|`((?:[^`\\]|\\.){3,})`/g;
const UNINTERESSANT = /^(https?:|\.\/|\.\.\/|#|layer-|data:|[a-z-]+\/[a-z-]+$)/;

function dateien(pfad) {
  const raus = [];
  for (const name of readdirSync(pfad)) {
    const p = join(pfad, name);
    if (statSync(p).isDirectory()) raus.push(...dateien(p));
    else if (/\.tsx?$/.test(name)) raus.push(p);
  }
  return raus;
}

/** Kommentare entfernen — sie werden nicht übersetzt. */
const ohneKommentare = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

let literaleGesamt = 0;
let aufrufeGesamt = 0;
const zeilen = [];

const AUFRUF = /\b(t|fach)\(/g;

for (const ordner of ORDNER) {
  let literale = 0;
  let aufrufe = 0;
  const jeDatei = [];
  for (const datei of dateien(join(WURZEL, ordner))) {
    const roh = ohneKommentare(readFileSync(datei, 'utf8'));
    let l = 0;
    for (const m of roh.matchAll(LITERAL)) {
      const text = (m[1] ?? m[2] ?? m[3] ?? '').trim();
      if (text.length < 3 || !DEUTSCH.test(text) || UNINTERESSANT.test(text)) continue;
      l += 1;
    }
    // Der eigene Quelltext der Sprachschicht zählt nicht mit — dort stehen
    // die Funktionen, nicht ihre Anwendung.
    const eigen = /src[\/\\]lib[\/\\](sprache\.ts|sprachen[\/\\])/.test(datei);
    const a = eigen ? 0 : [...roh.matchAll(AUFRUF)].length;
    literale += l;
    aufrufe += a;
    if (l + a > 0) jeDatei.push({ datei: relative(WURZEL, datei), l, a });
  }
  literaleGesamt += literale;
  aufrufeGesamt += aufrufe;
  zeilen.push({ ordner, literale, aufrufe, jeDatei });
}

console.log('\n  Sprachbericht\n');
console.log('  Texte  t()/fach()  Ordner');
console.log('  -----  ----------  -------------------------------------');
for (const z of zeilen.sort((a, b) => b.literale - a.literale)) {
  console.log(`  ${String(z.literale).padStart(5)}  ${String(z.aufrufe).padStart(10)}  ${z.ordner}`);
  if (JE_DATEI) {
    for (const d of z.jeDatei.sort((a, b) => b.l - a.l).slice(0, 12)) {
      console.log(`  ${String(d.l).padStart(5)}  ${String(d.a).padStart(10)}    ${d.datei}`);
    }
  }
}
console.log('  -----  ----------');
console.log(`  ${String(literaleGesamt).padStart(5)}  ${String(aufrufeGesamt).padStart(10)}  GESAMT`);
console.log('\n  „Texte" ist die Landkarte, „t()/fach()" der Fortschritt.');
console.log('  Ein Aufruf kann eine ganze Tabelle abdecken — deshalb kein Prozentsatz.\n');
