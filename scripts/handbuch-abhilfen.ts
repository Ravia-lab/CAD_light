/**
 * Die Abhilfetabelle des Handbuchs — aus dem Programm heraus erzeugt.
 * ---------------------------------------------------------------------------
 * **Warum dieses Skript existiert.** Zu jedem Befund des Prüfberichts steht in
 * `REMEDIES` ein Satz, der sagt, was zu tun ist. Dieselben Sätze gehören ins
 * Handbuch — und zwar nicht abgeschrieben. Eine abgeschriebene Liste stimmt am
 * Tag der Abschrift und danach nie wieder: es kommt ein Befund dazu, ein Satz
 * wird umformuliert, ein Reiter heißt anders. Im Handbuch stünde dann etwas
 * anderes als im Programm, und beide Fassungen sähen für sich richtig aus.
 *
 * Dieselbe Überlegung liegt `handbuch-symbole.ts` zugrunde, das die Symbole
 * nicht nachzeichnet, sondern mit den Zeichenroutinen des Programms rendert.
 *
 * Ausgabe: `/home/claude/handbuch/abhilfen.json` — je Befund ein Eintrag aus
 * Code, Gruppe und Abhilfetext. Der Handbuchbau setzt daraus an der Stelle,
 * wo `<!--ABHILFEN-->` steht, eine nach Gruppen gegliederte Tabelle.
 */

import { writeFileSync } from 'node:fs';
import { REMEDIES } from '../src/lib/validation';

interface Eintrag {
  /** Der Befund-Code, wie er im Prüfbericht und im Export steht. */
  code: string;
  /** Der Teil vor dem Punkt — `plant`, `wall`, `room` … */
  gruppe: string;
  /** Was zu tun ist, im Wortlaut des Programms. */
  abhilfe: string;
}

const eintraege: Eintrag[] = Object.entries(REMEDIES).map(([code, abhilfe]) => {
  const punkt = code.indexOf('.');
  return {
    code,
    // Ein Code ohne Punkt hätte keine Gruppe; er käme dann als eigene Gruppe
    // unter seinem vollen Namen heraus und fiele beim Setzen auf.
    gruppe: punkt > 0 ? code.slice(0, punkt) : code,
    abhilfe,
  };
});

writeFileSync('/home/claude/handbuch/abhilfen.json', JSON.stringify(eintraege, null, 1), 'utf8');

const gruppen = new Map<string, number>();
for (const e of eintraege) gruppen.set(e.gruppe, (gruppen.get(e.gruppe) ?? 0) + 1);
console.log(`  ${eintraege.length} Abhilfen in ${gruppen.size} Gruppen`);
for (const [name, anzahl] of [...gruppen].sort()) console.log(`  ${name}: ${anzahl}`);
