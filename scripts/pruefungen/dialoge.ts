/**
 * Prüfblock „Dialoge hängen am Fenster, nicht am Plan".
 *
 * **Der Fehler, um den es geht — und er war echt.** Ein Dialog, der sich über
 * das ganze Fenster legen soll, trägt `fixed inset-0`. Das ist richtig und
 * genügt doch nicht: `fixed` bezieht sich auf das Fenster nur, solange **kein
 * Vorfahr einen eigenen Bezugsrahmen aufspannt**. Ein Element mit `transform`,
 * `filter`, `perspective`, `contain` oder — und das war es hier —
 * `backdrop-filter` tut genau das (CSS, „containing block for fixed
 * positioned descendants"). Der Planbereich dieses Programms trägt
 * `backdrop-blur`. Ein Dialog darin richtet sich also am Planbereich aus, und
 * dessen Höhe hängt daran, wie hoch die Kopfzeile gerade ist.
 *
 * **Wie es aufgefallen ist.** Beim Einbau der fünften Ansicht in 1.66.0 wurde
 * die Knopfreihe oben bei 1180 px um 34 px zu breit und brach um. Die
 * Kopfzeile wuchs von 148 auf 182 px — und im Anlagendialog lag die sechste
 * Frage danach unter der Faltkante. Also der Mangel, gegen den dieser Dialog
 * überhaupt gebaut wurde, ausgelöst von einer Änderung an einer völlig
 * anderen Stelle. Gefunden hat ihn `scripts/smoke-anlagendialog.mjs`.
 *
 * **Was hier geprüft wird.** Die Regel, nicht der Einzelfall: Wer einen
 * Vollbildüberzug zeichnet, muss ihn durch ein Portal in den Körper des
 * Dokuments hängen. Gelesen wird der Quelltext selbst — ein neuer Dialog kann
 * damit nicht mehr unbemerkt in den Planbereich geraten.
 *
 * Geprüft wird am Text und nicht am gebauten Modul: `src/components` ist für
 * Prüfblöcke gesperrt (Schichtgrenze, siehe `pruefungen/schichtgrenze.ts`) —
 * und ein Rauchtest sieht nur die Dialoge, die er zufällig öffnet.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CheckFn } from './typ';

/** Der Überzug: ein Element, das sich über das ganze Fenster legt. */
const UEBERZUG = /className="fixed inset-0/;

export function pruefeDialoge(check: CheckFn): void {
  const hier = dirname(fileURLToPath(import.meta.url));
  const ordner = resolve(hier, '..', '..', 'src', 'components');
  const dateien = readdirSync(ordner).filter((n) => n.endsWith('.tsx')).sort();

  check('Dialoge · es gibt Bausteine zu prüfen', dateien.length > 10, true);

  const mitUeberzug: string[] = [];
  const ohnePortal: string[] = [];
  for (const name of dateien) {
    const quelle = readFileSync(join(ordner, name), 'utf8');
    if (!UEBERZUG.test(quelle)) continue;
    mitUeberzug.push(name);
    if (!/createPortal\(/.test(quelle)) ohnePortal.push(name);
  }

  // Dass überhaupt welche gefunden werden, ist Teil der Prüfung: Ein
  // Suchmuster, das nichts trifft, ist immer grün.
  check('Dialoge · Vollbildüberzüge gefunden', mitUeberzug.length >= 5, true);
  check('Dialoge · jeder Überzug geht durch ein Portal', ohnePortal.join(', '), '');

  /*
   * Die Gegenprobe zum Suchmuster: Ein Baustein **ohne** Überzug soll hier
   * nicht mitgezählt werden. `StatusBar` ist ein solcher — zeichnete das
   * Muster auf alles, wäre die Liste oben wertlos.
   */
  check('Dialoge · die Statuszeile ist kein Dialog', mitUeberzug.includes('StatusBar.tsx'), false);

  /*
   * Und die Gegenprobe zur Ursache: Der Planbereich trägt weiterhin
   * `backdrop-blur`. Verschwände es, wäre dieser Prüfblock eine Vorsorge ohne
   * Anlass — bleibt es, ist er notwendig. Beides ist in Ordnung; stillschweigend
   * soll es nur nicht umkippen.
   */
  const app = readFileSync(resolve(hier, '..', '..', 'src', 'App.tsx'), 'utf8');
  const stil = readFileSync(resolve(hier, '..', '..', 'src', 'index.css'), 'utf8');
  check(
    'Dialoge · der Grund besteht weiterhin (ein Vorfahr mit backdrop-blur)',
    /backdrop-blur/.test(app) || /backdrop-filter/.test(stil),
    true,
  );
}
