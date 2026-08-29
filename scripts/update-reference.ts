/**
 * Schreibt den Sollstand des Referenzprojekts neu.
 *
 * Nur aufrufen, wenn eine Abweichung *gewollt* ist — und dann den Unterschied
 * im Diff ansehen, bevor er eingecheckt wird. Ein blind erneuerter Sollstand
 * ist schlimmer als keiner: er sieht aus wie eine Prüfung und ist keine.
 *
 * Ausführen:  npm run reference:update
 */

import { writeFileSync } from 'node:fs';
import { buildReferenceDocument, buildReferenceReport } from './reference';

// Der Pfad geht vom Projektverzeichnis aus, nicht vom Bündel: esbuild legt
// das Ergebnis unter node_modules/.cache ab, und dort gehört der Sollstand
// nicht hin.
const path = 'scripts/fixtures/referenz-soll.json';
const report = buildReferenceReport(buildReferenceDocument());
writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
console.log(`Sollstand geschrieben: ${path}`);
