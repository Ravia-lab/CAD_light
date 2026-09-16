/**
 * `npm run ifc -- <datei.ifc>` — eine fremde IFC-Datei ansehen, ohne sie
 * einzuspielen.
 *
 * Gedacht für den Fall, der in der Praxis der häufigste ist: der Architekt
 * schickt eine Datei, und die Frage lautet nicht „läuft der Import durch",
 * sondern „**was genau kommt an, und was nicht**". Der Editor beantwortet
 * das nur als Grundriss; hier stehen die Zahlen nebeneinander, samt der
 * Liste dessen, was übersprungen wurde und was mit Vorbehalt kam.
 *
 * Die Zahl der Wände in der Datei zählt dieses Werkzeug bewusst selbst aus
 * dem Text mit, nicht über den Import — sonst könnte es einen Verlust gar
 * nicht bemerken. Genau daran ist es beim FZK-Haus des KIT aufgefallen: 13
 * Wände in der Datei, 9 im Import, und die Meldung las sich wie ein Erfolg.
 */

import { readFileSync } from 'node:fs';
import { importIfc } from '../src/lib/ifcImport';

const datei = process.argv[2];
if (!datei) {
  console.error('Aufruf: npm run ifc -- <datei.ifc>');
  process.exit(1);
}

const text = readFileSync(datei, 'utf8');
const t0 = Date.now();
const e = importIfc(text);
const ms = Date.now() - t0;

/** Entities eines Typs im Dateitext zählen — unabhängig vom Import. */
const inDatei = (typ: string) =>
  (text.match(new RegExp(`=\\s*${typ}\\s*\\(`, 'g')) ?? []).length;

const waendeInDatei =
  inDatei('IFCWALL') + inDatei('IFCWALLSTANDARDCASE') + inDatei('IFCWALLELEMENTEDCASE');
const oeffnungenInDatei = inDatei('IFCOPENINGELEMENT');

console.log(`${datei}  ${(text.length / 1e6).toFixed(1)} MB  ${ms} ms`);
console.log(`  ${e.ok ? 'gelesen' : 'FEHLGESCHLAGEN'}: ${e.message}`);
if (!e.ok) process.exit(0);

console.log(`  Schema    : ${e.schema ?? '—'}   Projekt: ${e.projectName ?? '—'}`);
console.log(
  `  Geschosse : ${e.levels
    .map((l) => `${l.name} @${l.elevation.toFixed(2)} h=${l.height.toFixed(2)}`)
    .join(' · ')}`,
);

const fehlendeWaende = waendeInDatei - e.walls.length;
const fehlendeOeffnungen = oeffnungenInDatei - e.openings.length;
console.log(
  `  Wände     : ${e.walls.length} von ${waendeInDatei}` +
    (fehlendeWaende ? `   ⚠ ${fehlendeWaende} fehlen` : '   vollständig'),
);
const arten = new Map<string, number>();
for (const w of e.walls) arten.set(w.type, (arten.get(w.type) ?? 0) + 1);
console.log(`              ${[...arten].map(([k, v]) => `${k} ${v}`).join(' · ')}`);
const dicken = [...new Set(e.walls.map((w) => w.thickness.toFixed(3)))].sort();
console.log(`              Dicken ${dicken.join(' ')}`);
console.log(
  `  Öffnungen : ${e.openings.length} von ${oeffnungenInDatei}` +
    (fehlendeOeffnungen ? `   ⚠ ${fehlendeOeffnungen} fehlen` : '   vollständig'),
);
console.log(`  Knoten    : ${e.nodes.length}`);

if (e.skipped.length) {
  console.log('  Übersprungen:');
  for (const s of e.skipped) console.log(`    ${String(s.count).padStart(4)}× ${s.reason}`);
}
if (e.hinweise.length) {
  console.log('  Mit Vorbehalt übernommen:');
  for (const h of e.hinweise) console.log(`    ${String(h.count).padStart(4)}× ${h.reason}`);
}
