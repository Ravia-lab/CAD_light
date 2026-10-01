/**
 * Prüfblock „Handbuchstand" — beschreibt das ausgelieferte Handbuch den Stand?
 *
 * **Der Fehler, gegen den das hier steht.** Unter `server/app/handbuch.html`
 * liegt das Handbuch, das im Serverpaket mitgeht. Erzeugt wird es aus den
 * Kapiteldateien unter `handbuch/` — aber **nicht** vom Paketlauf: Der baut
 * die Anwendung neu und lässt das Handbuch ausdrücklich stehen
 * (`scripts/paket.mjs`, „Handbuch und Einbettungsbeispiel … bleiben
 * stehen"). Wer `npm run handbuch` vergisst, bekommt ein grünes
 * `✓ FREIGABEFÄHIG` und ein Paket, dessen Handbuch die neue Fassung nicht
 * beschreibt.
 *
 * Genau so ist es passiert: Im 1.49.0-Paket stand ein Handbuch auf 1.36.2 —
 * dreizehn Fassungen zurück —, und bei 1.54.0 fiel es nur auf, weil beim
 * Einchecken jemand nachgesehen hat, warum `server/app/handbuch.html` nicht
 * in der Änderungsliste steht. Kein Prüflauf hat je danach gefragt.
 *
 * **Zwei Prüfungen, weil eine nicht reicht.**
 *
 *  1. **Die Fassung.** Das Deckblatt trägt „Dieses Handbuch beschreibt den
 *     Programmstand X". Steht dort eine andere Zahl als in `FASSUNG`, ist das
 *     Handbuch aus einem anderen Lauf.
 *  2. **Die Sprungmarken.** Eine Fassung kann stimmen und der Inhalt
 *     trotzdem älter sein — wer nach dem Handbuchbau noch einen Abschnitt
 *     schreibt, hebt die Zahl nicht noch einmal an. Deshalb wird jede
 *     Sprungmarke `id="k…"` der Kapitelquellen im erzeugten Blatt gesucht.
 *     Fehlt eine, ist das Erzeugte älter als die Quelle.
 *
 * Beides ist Textsuche und rechnet nichts. Es ist die billigste Versicherung
 * gegen einen Fehler, der erst auf dem Server auffällt — und dort niemandem,
 * weil ein veraltetes Handbuch aussieht wie ein Handbuch.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import type { CheckFn } from './typ';
import { FASSUNG } from '../../src/lib/fassung';

/** Projektwurzel bestimmen — dieselbe Rückfallebene wie in `schichtgrenze`. */
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

/** Alle `id="k…"`-Sprungmarken eines Kapitelblatts. */
function sprungmarken(text: string): string[] {
  const treffer = text.match(/id="(k[0-9][^"]*)"/g) ?? [];
  return treffer.map((t) => t.slice(4, -1));
}

export function pruefeHandbuchstand(check: CheckFn): void {
  const basis = wurzel();
  check('Handbuchstand · die Projektwurzel ist auffindbar', basis !== undefined, true);
  if (!basis) return;

  /*
   * **Während das Handbuch gebaut wird, prüft dieser Block nicht.**
   *
   * `handbuch/bauen.py` ruft den Prüflauf auf, bevor es das Blatt schreibt —
   * es holt sich von dort die Zahl fürs Deckblatt und bricht ab, wenn der
   * Lauf rot ist. Dieser Block prüft aber genau das Blatt, das erst danach
   * entsteht. Ohne diese Ausnahme wäre die Prüfung eine Schlinge: Das
   * Handbuch ließe sich nie mehr bauen, weil es noch nicht gebaut ist.
   *
   * Die Absicherung geht dadurch nicht verloren. Der Freigabelauf ruft den
   * Prüflauf **ohne** diese Umgebungsvariable, und dort gilt der Block.
   */
  if (process.env.HANDBUCH_BAU === '1') {
    check('Handbuchstand · während des Handbuchbaus ausgesetzt', true, true);
    return;
  }

  const quellen = join(basis, 'handbuch');
  const erzeugt = join(basis, 'server', 'app', 'handbuch.html');

  /*
   * Im ausgelagerten Kernel-Paket gibt es weder Kapitelquellen noch
   * Serververzeichnis. Dort ist nichts zu prüfen — und ein Fehlschlag wäre
   * eine Meldung über eine Datei, die dort nie existieren soll.
   */
  if (!existsSync(quellen) || !existsSync(erzeugt)) {
    check('Handbuchstand · im Kernel-Paket nicht zu prüfen', true, true);
    return;
  }

  const blatt = readFileSync(erzeugt, 'utf8');

  // --- 1 · Die Fassung auf dem Deckblatt ------------------------------------
  {
    /*
     * Der Satz steht so in `handbuch/bauen.py`: „Dieses Handbuch beschreibt
     * den Programmstand {VERSION}." Gesucht wird die Zahl dahinter und nicht
     * bloß das Vorkommen der Fassung irgendwo im Blatt — die Zeichenkette
     * „1.54.0" steht auch in der Fassungsgeschichte, und zwar in jeder
     * Fassung, die einmal erschienen ist.
     */
    const m = blatt.match(/beschreibt den Programmstand ([0-9]+\.[0-9]+\.[0-9]+)/);
    check('Handbuchstand · das Deckblatt nennt eine Fassung', m !== null, true);
    check('Handbuchstand · und zwar die laufende', m?.[1] ?? '—', FASSUNG);
  }

  // --- 2 · Jede Sprungmarke der Quellen steht im Blatt -----------------------
  {
    const kapitel = readdirSync(quellen).filter((n) => /^kap-\d+\.html$/.test(n)).sort();
    check('Handbuchstand · es gibt Kapitelquellen', kapitel.length > 0, true);

    const fehlend: string[] = [];
    let gesamt = 0;
    for (const name of kapitel) {
      for (const marke of sprungmarken(readFileSync(join(quellen, name), 'utf8'))) {
        gesamt += 1;
        if (!blatt.includes(`id="${marke}"`)) fehlend.push(`${name}#${marke}`);
      }
    }
    check('Handbuchstand · es gibt Sprungmarken zu prüfen', gesamt > 0, true);
    /*
     * Die Zahl der fehlenden ist der Sollwert, nicht die Liste — sie soll
     * null sein. Die Namen stehen in der Meldung, damit der erste Blick
     * sagt, welches Kapitel neu ist.
     */
    check(`Handbuchstand · keine Sprungmarke fehlt im Paket${fehlend.length ? ` (${fehlend.slice(0, 5).join(', ')})` : ''}`, fehlend.length, 0);
  }

  // --- 3 · Jede Fassung steht genau einmal, und nur in 18.6 ------------------
  /*
   * **Warum das hier steht.** Die Patchliste wird aus der Fassungsgeschichte
   * erzeugt (`scripts/patchliste.mjs`). Beim ersten Lauf kam sie auf eine
   * Fassung zu viel: Eine Zeile der Fassungsgeschichte war in die
   * **Glossartabelle** von Abschnitt 18.1 geraten — 1.29.1 stand dort hinter
   * „Zirkulation" als Begriff mit der Erklärung „nur Fehlerkorrekturen".
   * Im ausgelieferten Handbuch war das zu lesen, und niemandem aufgefallen.
   *
   * Geprüft wird deshalb am **Quelltext** des Kapitels: Eine Tabellenzeile,
   * deren erste Zelle wie eine Fassungsnummer aussieht, gehört in die
   * Fassungsgeschichte und sonst nirgendwohin — und keine Fassung darf
   * zweimal vorkommen, sonst zählt die Patchliste falsch.
   */
  {
    const quelle = readFileSync(join(quellen, 'kap-18.html'), 'utf8');
    const marke = quelle.indexOf('id="k18-6"');
    check('Handbuchstand · Abschnitt 18.6 ist auffindbar', marke > 0, true);

    const zeilen = [...quelle.matchAll(/<tr><td>(\d+\.\d+\.\d+)<\/td>/g)];
    check('Handbuchstand · es gibt Fassungszeilen', zeilen.length > 50, true);

    const davor = zeilen.filter((m) => (m.index ?? 0) < marke).map((m) => m[1]);
    check(`Handbuchstand · keine Fassungszeile vor 18.6${davor.length ? ` (${davor.join(', ')})` : ''}`, davor.length, 0);

    const gesehen = new Set<string>();
    const doppelt = new Set<string>();
    for (const m of zeilen) {
      if (gesehen.has(m[1])) doppelt.add(m[1]);
      gesehen.add(m[1]);
    }
    check(`Handbuchstand · keine Fassung zweimal${doppelt.size ? ` (${[...doppelt].join(', ')})` : ''}`, doppelt.size, 0);
  }
}
