/**
 * Prüfblock „Sitzungssicherung" — der Schutz gegen das versehentliche F5.
 * ---------------------------------------------------------------------------
 * **Warum dieser Block nachgereicht wurde.** `autosave.ts` war eines von
 * sechs Modulen in `src/lib`, die weder `verify.ts` noch ein Prüfblock je
 * berührt hat. Bei den anderen fünf geht es um Symbole und Druckränder; hier
 * geht es um **die Arbeit eines ganzen Aufmaßtages**. Ein Fehler in diesem
 * Modul fällt nicht auf, wenn er passiert, sondern eine Stunde später, wenn
 * der Stand nicht wieder da ist — und dann ist er nicht mehr zu beheben.
 *
 * **Die vier Zusagen, die das Modul macht, und die hier festgehalten werden:**
 *
 *  1. **Ein leerer Stand wird nicht angeboten.** Wer eine leere Zeichnung
 *     wiederhergestellt bekommt, hat nichts gewonnen und die Frage umsonst
 *     beantwortet — schlimmer: Er hält den Dialog für kaputt und klickt ihn
 *     beim nächsten Mal weg, wenn es zählt.
 *  2. **Der Zeiger sagt, wozu der Stand gehört.** Mit offenem Projekt liegt
 *     das Dokument im Projekteintrag und hier nur ein Verweis. Ohne das
 *     könnte beim Start die Sicherung eines *anderen* Projekts über dem
 *     gerade geöffneten landen.
 *  3. **Ein voller Speicher stürzt nicht ab, sondern meldet sich.** Der
 *     Browser gibt je Herkunft rund 5 MB; ein hinterlegter Grundriss füllt
 *     davon einen guten Teil. Die Ausnahme wird gefangen und in einen Satz
 *     verwandelt, den man lesen kann.
 *  4. **Gelöscht wird der Zeiger, nie ein Projekt.** Ein Projekt löscht man
 *     in der Projektverwaltung, mit Rückfrage.
 *
 * Dazu die Zeitangabe: „vor 3 Minuten" statt eines Zeitstempels, den niemand
 * einordnet. Alle Sollwerte sind von Hand gerechnet.
 */

import type { BimDocument } from '../../src/types/bim';
import {
  clearAutosave,
  loadAutosave,
  relativeTime,
  saveNow,
} from '../../src/lib/autosave';
import type { CheckFn } from './typ';

/**
 * Ein Speicher, wie der Browser ihn stellt — und wie er sich weigert.
 *
 * `grenze` ist die Zahl der Zeichen, die insgesamt hineinpassen. Darüber
 * wirft `setItem`, genau wie ein echter `localStorage` bei überschrittener
 * Quote. Ohne diese Nachbildung ließe sich der wichtigste Fall dieses
 * Moduls — der volle Speicher — überhaupt nicht prüfen, denn im Prüflauf
 * gibt es keinen Browser.
 */
function speicherAttrappe(grenze = Number.POSITIVE_INFINITY) {
  const daten = new Map<string, string>();
  return {
    daten,
    getItem: (k: string) => daten.get(k) ?? null,
    setItem: (k: string, v: string) => {
      let summe = v.length;
      for (const [kk, vv] of daten) if (kk !== k) summe += vv.length;
      if (summe > grenze) {
        const e = new Error('QuotaExceededError');
        e.name = 'QuotaExceededError';
        throw e;
      }
      daten.set(k, v);
    },
    removeItem: (k: string) => void daten.delete(k),
    clear: () => daten.clear(),
    key: (i: number) => [...daten.keys()][i] ?? null,
    get length() {
      return daten.size;
    },
  };
}

/** Ein Dokument mit `wandZahl` Wänden — genug, dass es nicht als leer gilt. */
function dokument(wandZahl: number, name = 'Prüfhaus'): BimDocument {
  const nodes: Record<string, unknown> = {};
  const walls: Record<string, unknown> = {};
  for (let i = 0; i < wandZahl; i += 1) {
    nodes[`n${i}`] = { id: `n${i}`, x: i * 3, y: 0, levelId: 'eg' };
    nodes[`m${i}`] = { id: `m${i}`, x: i * 3 + 3, y: 0, levelId: 'eg' };
    walls[`w${i}`] = {
      id: `w${i}`,
      levelId: 'eg',
      a: `n${i}`,
      b: `m${i}`,
      thickness: 0.24,
      height: 2.5,
      type: 'exterior',
      layerId: 'layer-walls',
    };
  }
  return {
    meta: { name, version: '1' },
    levels: { eg: { id: 'eg', name: 'EG', elevation: 0, height: 2.5 } },
    activeLevelId: 'eg',
    nodes,
    walls,
    rooms: {},
    openings: {},
    fixtures: {},
    verticals: {},
    solids: {},
    pipes: {},
    annotations: {},
    durchbrueche: {},
  } as unknown as BimDocument;
}

export function pruefeAutosave(check: CheckFn): void {
  const global = globalThis as unknown as { localStorage?: unknown };
  const vorher = global.localStorage;

  const mitSpeicher = <T>(grenze: number, was: () => T): T => {
    global.localStorage = speicherAttrappe(grenze);
    try {
      return was();
    } finally {
      global.localStorage = vorher;
    }
  };

  // =========================================================================
  // 1 · Sichern und wiederfinden
  // =========================================================================
  mitSpeicher(Number.POSITIVE_INFINITY, () => {
    const doc = dokument(4, 'Haus Nord');
    const erg = saveNow(doc);
    check('Ein Stand lässt sich sichern', erg.ok, true);

    const geladen = loadAutosave();
    check('Er wird wiedergefunden', geladen !== null, true);
    check('Der Projektname kommt mit', geladen?.projectName ?? '', 'Haus Nord');
    // Vier Wände waren es, und die Kennzahlen stehen im Zeiger, damit die
    // Rückfrage sie zeigen kann, ohne das ganze Dokument zu laden.
    check('Die Kennzahl „Wände" stimmt', geladen?.summary.walls ?? -1, 4);
    check('Das Dokument ist vollständig', Object.keys(geladen?.doc.walls ?? {}).length, 4);
  });

  // =========================================================================
  // 2 · Ein leerer Stand wird nicht angeboten
  // =========================================================================
  mitSpeicher(Number.POSITIVE_INFINITY, () => {
    const erg = saveNow(dokument(0));
    check('Auch ein leeres Dokument wird gesichert', erg.ok, true);
    check('… aber beim Start nicht angeboten', loadAutosave() === null, true);

    /*
     * Die Gegenprobe: **eine** Wand genügt, damit es kein leerer Stand mehr
     * ist. Ohne sie wäre die Prüfung oben auch dann grün, wenn `loadAutosave`
     * grundsätzlich nichts zurückgäbe — und dann wäre die Sicherung wertlos,
     * ohne dass es jemand merkte.
     */
    saveNow(dokument(1));
    check('Eine einzige Wand genügt', loadAutosave() !== null, true);
  });

  // =========================================================================
  // 3 · Ein voller Speicher meldet sich, statt abzustürzen
  // =========================================================================
  mitSpeicher(500, () => {
    /*
     * Die Attrappe fasst 500 Zeichen. Ein Dokument mit zwölf Wänden ist als
     * JSON deutlich größer — der Versuch muss also scheitern, und zwar mit
     * einem Satz und nicht mit einer Ausnahme.
     */
    let geworfen = '';
    let erg: ReturnType<typeof saveNow> | null = null;
    try {
      erg = saveNow(dokument(12));
    } catch (e) {
      geworfen = (e as Error).message;
    }
    check('Ein voller Speicher wirft nicht', geworfen, '');
    // Dreiwertig: fehlt das Ergebnis ganz, steht dort 'fehlt' und nicht false —
    // sonst bestünde die Prüfung auch dann, wenn gar nichts zurückkommt.
    check('Er meldet einen Fehlschlag', erg?.ok ?? 'fehlt', false);
    check(
      'Und sagt, was zu tun ist',
      erg && !erg.ok ? erg.meldung.length > 30 : false,
      true,
    );
  });

  // =========================================================================
  // 4 · Ein gesperrter Speicher (privates Fenster) bringt nichts zum Absturz
  // =========================================================================
  {
    /*
     * Im privaten Fenster mancher Browser ist `localStorage` vorhanden, wirft
     * aber bei jedem Zugriff. Das ist kein erfundener Fall: Er trifft jeden,
     * der die Anwendung zum ersten Mal ausprobiert, ohne Spuren zu
     * hinterlassen.
     */
    global.localStorage = {
      getItem() {
        throw new Error('gesperrt');
      },
      setItem() {
        throw new Error('gesperrt');
      },
      removeItem() {
        throw new Error('gesperrt');
      },
      clear() {},
      key: () => null,
      length: 0,
    } as unknown as Storage;
    let geworfen = '';
    try {
      const erg = saveNow(dokument(3));
      check('Gesperrter Speicher: Sichern meldet einen Fehlschlag', erg.ok, false);
      check('Gesperrter Speicher: Laden gibt nichts zurück', loadAutosave() === null, true);
      clearAutosave();
    } catch (e) {
      geworfen = (e as Error).message;
    }
    check('Gesperrter Speicher: nichts wird geworfen', geworfen, '');
    global.localStorage = vorher;
  }

  // =========================================================================
  // 5 · Löschen wirft den Zeiger weg
  // =========================================================================
  mitSpeicher(Number.POSITIVE_INFINITY, () => {
    saveNow(dokument(5));
    check('Vor dem Löschen ist ein Stand da', loadAutosave() !== null, true);
    clearAutosave();
    check('Danach nicht mehr', loadAutosave() === null, true);
  });

  // =========================================================================
  // 6 · Die Zeitangabe, die ein Mensch einordnen kann
  // =========================================================================
  {
    const vorMinuten = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
    check('Unter einer Minute', relativeTime(vorMinuten(0.2)), 'gerade eben');
    check('Eine Minute, Einzahl', relativeTime(vorMinuten(1)), 'vor 1 Minute');
    check('Mehrere Minuten', relativeTime(vorMinuten(7)), 'vor 7 Minuten');
    // 90 Minuten sind gerundet 2 Stunden — 90/60 = 1,5, und `Math.round`
    // rundet auf.
    check('Anderthalb Stunden werden zwei', relativeTime(vorMinuten(90)), 'vor 2 Stunden');
    check('Eine Stunde, Einzahl', relativeTime(vorMinuten(60)), 'vor 1 Stunde');
    // 36 Stunden = 2160 Minuten; 36/24 = 1,5 → gerundet 2 Tage.
    check('Anderthalb Tage werden zwei', relativeTime(vorMinuten(36 * 60)), 'vor 2 Tagen');
    check('Ein Tag, Einzahl', relativeTime(vorMinuten(24 * 60)), 'vor 1 Tag');
  }
}
