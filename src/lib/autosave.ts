/**
 * Autosave — der Schutz gegen den versehentlichen Reload.
 * ---------------------------------------------------------------------------
 * Der gesamte Dokumentzustand liegt im Arbeitsspeicher. Ein F5 zur falschen
 * Zeit kostet sonst die Arbeit einer Stunde. Dieses Modul schreibt das
 * Dokument entprellt in den `localStorage` und bietet es beim nächsten Start
 * zur Wiederherstellung an.
 *
 * Bewusst `localStorage` statt IndexedDB: der Zustand ist reines JSON im
 * niedrigen dreistelligen Kilobyte-Bereich, und der synchrone Zugriff macht
 * die Wiederherstellung beim Start trivial. Wird es zu groß, meldet der
 * Browser eine Quota-Ausnahme — die wird abgefangen und *gemeldet*, statt die
 * Anwendung abstürzen zu lassen.
 *
 * Verhältnis zur Projektverwaltung (`projectStore.ts`)
 * ---------------------------------------------------------------------------
 * Die Sitzungssicherung schützt vor Absturz und Zufall, die Projektverwaltung
 * vor dem Vergessen. Beide schreiben in denselben knappen Speicher, deshalb
 * teilen sie sich das Dokument, statt es doppelt abzulegen:
 *
 *  - **Ohne offenes Projekt** (erster Start, niemand hat je eines angelegt)
 *    liegt das ganze Dokument im Autosave-Schlüssel — genau wie bisher.
 *  - **Mit offenem Projekt** schreibt die Sicherung in den Projekteintrag;
 *    hier bleibt nur ein Zeiger: welches Projekt, wann, wie groß. Damit kann
 *    beim Start nie die Sicherung eines *anderen* Projekts über dem gerade
 *    geöffneten landen — der Zeiger sagt, wozu der Stand gehört.
 *
 * `clearAutosave` wirft deshalb auch nur den Zeiger weg. Ein Projekt löscht
 * man in der Projektverwaltung, mit Rückfrage, und nicht aus Versehen im
 * Wiederherstellungsdialog.
 */

import type { BimDocument } from '../types/bim';
import { BYTES_JE_ZEICHEN, formatBytes, ladeProjekt, speichereProjekt, type Fehlschlag } from './projectStore';

const KEY = 'ravia-cad-light.autosave.v2';
/** Entprellung: ruhige 1,5 s nach der letzten Änderung. */
const DEBOUNCE_MS = 1500;

export interface AutosaveEntry {
  savedAt: string;
  projectName: string;
  /** Kennzahlen für die Wiederherstellungs-Abfrage, ohne alles zu laden. */
  summary: { walls: number; rooms: number; area: number; levels: number };
  doc: BimDocument;
  /** Gesetzt, wenn der Stand zu einem benannten Projekt gehört. */
  projektId?: string;
}

/** Was im Speicher steht — mit Dokument *oder* mit Projektbezug. */
interface AutosaveZeiger {
  savedAt: string;
  projectName: string;
  summary: AutosaveEntry['summary'];
  doc?: BimDocument;
  projektId?: string;
}

export type SicherungsErgebnis = { ok: true; savedAt: string } | Fehlschlag;

let timer: ReturnType<typeof setTimeout> | null = null;

/**
 * Speichert entprellt. Mehrfachaufrufe innerhalb der Wartezeit gewinnen.
 * `projektId` sagt, wohin: in den Projekteintrag oder in den Autosave-
 * Schlüssel selbst.
 */
export function scheduleAutosave(
  doc: BimDocument,
  projektId?: string | null,
  beiErgebnis?: (ergebnis: SicherungsErgebnis) => void,
): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    beiErgebnis?.(saveNow(doc, projektId));
  }, DEBOUNCE_MS);
}

/**
 * Bricht eine ausstehende Sicherung ab.
 *
 * Nötig beim Projektwechsel: ein noch laufender Zeitgeber trüge sonst das
 * Dokument des *alten* Projekts unter der Kennung des neuen ein — genau der
 * Fall, den die Projektverwaltung ausschließen soll.
 */
export function cancelAutosave(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}

export function saveNow(doc: BimDocument, projektId?: string | null): SicherungsErgebnis {
  const rooms = Object.values(doc.rooms ?? {});
  const savedAt = new Date().toISOString();
  const zeiger: AutosaveZeiger = {
    savedAt,
    projectName: doc.meta.name,
    summary: {
      walls: Object.keys(doc.walls).length,
      rooms: rooms.length,
      area: Math.round(rooms.reduce((sum, r) => sum + r.area, 0) * 100) / 100,
      levels: Object.keys(doc.levels).length,
    },
  };

  if (projektId) {
    // Das Dokument gehört in den Projekteintrag; scheitert das, ist der
    // Zeiger wertlos und wird gar nicht erst geschrieben.
    const ergebnis = speichereProjekt(projektId, doc);
    if (!ergebnis.ok) return mitBildhinweis(ergebnis, doc);
    zeiger.projektId = projektId;
  } else {
    zeiger.doc = doc;
  }

  try {
    localStorage.setItem(KEY, JSON.stringify(zeiger));
    return { ok: true, savedAt };
  } catch {
    // Quota überschritten oder Speicher gesperrt (privater Modus).
    return mitBildhinweis(
      {
        ok: false,
        grund: 'voll',
        meldung:
          'Der Browser-Speicher ist voll — der Stand wird nicht mehr gesichert. Sichern Sie ein Projekt als Datei und nehmen Sie es aus dem Speicher.',
      },
      doc,
    );
  }
}

/**
 * Nennt den größten Posten beim Namen.
 *
 * Ein hinterlegtes Referenzbild ist in aller Regel um ein Vielfaches größer
 * als der gesamte übrige Grundriss: eine Strichzeichnung in A4 kostet rund
 * 70 000 Zeichen, ein Handyfoto ein Vielfaches davon. Wer beim vollen
 * Speicher nur liest „machen Sie Platz", räumt Projekte weg und wundert sich,
 * dass es nichts bringt.
 */
function mitBildhinweis(fehler: Fehlschlag, doc: BimDocument): Fehlschlag {
  if (fehler.grund !== 'voll' || !doc.image?.src) return fehler;
  // Unter 20 000 Zeichen ist das Bild nicht die Ursache und der Hinweis nur
  // eine Ablenkung; darüber ist es fast immer der größte Posten im Dokument.
  if (doc.image.src.length < 20_000) return fehler;
  const groesse = formatBytes(doc.image.src.length * BYTES_JE_ZEICHEN);
  return {
    ...fehler,
    meldung: `${fehler.meldung} Den größten Anteil hat hier das hinterlegte Referenzbild (rund ${groesse}) — ein kleineres oder schwächer aufgelöstes Bild schafft am meisten Platz.`,
  };
}

/**
 * Holt den letzten Stand zurück — mit Dokument, gleich woher es kommt.
 *
 * Zeigt der Eintrag auf ein Projekt, dessen Dokument nicht mehr lesbar ist,
 * gibt es nichts anzubieten: dann `null`, und die Anwendung startet wie
 * gewohnt, statt eine Wiederherstellung zu versprechen, die leer ist.
 */
/**
 * Ist an diesem Dokument überhaupt etwas dran?
 *
 * Gezählt wurden früher nur Wände. Wer mit dem Grundstück angefangen hat —
 * Grenze, Nachbarhaus, Aufstellort der Wärmepumpe — und dann die Seite neu
 * lud, bekam **keine** Wiederherstellung angeboten und stand wieder vor einem
 * leeren Blatt. Die Sicherung lag da, sie wurde nur verworfen.
 */
function leer(doc: BimDocument): boolean {
  return (
    Object.keys(doc.walls ?? {}).length === 0 &&
    Object.keys(doc.site?.elements ?? {}).length === 0 &&
    Object.keys(doc.site?.pumps ?? {}).length === 0 &&
    Object.keys(doc.freihand ?? {}).length === 0 &&
    Object.keys(doc.annotations ?? {}).length === 0 &&
    Object.keys(doc.durchbrueche ?? {}).length === 0
  );
}

export function loadAutosave(): AutosaveEntry | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const zeiger = JSON.parse(raw) as AutosaveZeiger | null;
    if (!zeiger) return null;

    if (zeiger.projektId) {
      const geladen = ladeProjekt(zeiger.projektId);
      if (!geladen.ok) return null;
      if (leer(geladen.doc)) return null;
      return {
        savedAt: zeiger.savedAt,
        projectName: geladen.doc.meta?.name ?? zeiger.projectName,
        summary: zeiger.summary,
        doc: geladen.doc,
        projektId: zeiger.projektId,
      };
    }

    // Nur brauchbare Stände anbieten — ein leeres Dokument hilft niemandem.
    if (!zeiger.doc || leer(zeiger.doc)) return null;
    return {
      savedAt: zeiger.savedAt,
      projectName: zeiger.projectName,
      summary: zeiger.summary,
      doc: zeiger.doc,
    };
  } catch {
    return null;
  }
}

/** Wirft den Zeiger weg — nie ein Projekt. */
export function clearAutosave(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nichts zu tun */
  }
}

/** „vor 3 Minuten" statt eines Zeitstempels, den niemand einordnen kann. */
export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return 'gerade eben';
  if (min < 60) return `vor ${min} Minute${min === 1 ? '' : 'n'}`;
  const h = Math.round(min / 60);
  if (h < 24) return `vor ${h} Stunde${h === 1 ? '' : 'n'}`;
  const d = Math.round(h / 24);
  return `vor ${d} Tag${d === 1 ? '' : 'en'}`;
}
