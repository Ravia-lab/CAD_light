/**
 * Projektverwaltung — mehrere benannte Projekte im Browser-Speicher.
 * ---------------------------------------------------------------------------
 * Die Sitzungssicherung (`autosave.ts`) schützt vor dem Absturz und vor dem
 * versehentlichen F5. Sie kennt genau einen Stand: den letzten. Wer eine
 * Wohnung über mehrere Abende aufmisst und nebenher noch den Anbau der Eltern
 * zeichnet, braucht etwas anderes — eine Ablage mit Namen, in der beide
 * nebeneinander liegen und keiner den anderen überschreibt. Genau das ist
 * dieses Modul: Anlegen, Auflisten, Umbenennen, Duplizieren, Löschen, Öffnen.
 *
 * Zwei Entscheidungen tragen den Entwurf:
 *
 * 1. **Ein Dokument, nicht zwei Kopien.** Ist ein Projekt geöffnet, schreibt
 *    die Sitzungssicherung in *dessen* Eintrag; im Autosave-Schlüssel bleibt
 *    nur ein Zeiger (welches Projekt, wann zuletzt). Würde beides das ganze
 *    Dokument ablegen, halbierte sich der ohnehin knappe Platz — und ein
 *    Grundriss mit hinterlegtem Foto ist megabytegroß.
 * 2. **Nichts wird stillschweigend gelöscht.** Jede Schreibfunktion gibt ein
 *    Ergebnis zurück, statt zu werfen. Ein `QuotaExceededError`, der bis in
 *    die Oberfläche durchschlägt, beendet die Anwendung mit einer weißen
 *    Fläche — und der Anwender hat gerade eine Stunde gezeichnet. Wird es
 *    eng, sagt die Oberfläche, was los ist, und bietet den Weg an: Projekt
 *    als Datei sichern, dann aus dem Speicher nehmen.
 *
 * Zum Platz: Browser geben je Ursprung typisch 5 MB für `localStorage`. Wie
 * sie zählen, ist nicht einheitlich. Gemessen in Chromium 1.62 (Rauchtest-
 * Browser dieses Projekts) nahm ein einzelner Eintrag 5 177 344 reine
 * ASCII-Zeichen auf — dort kostet ein solches Zeichen also ein Byte. Firefox
 * rechnet die UTF-16-Darstellung und damit zwei Byte je Zeichen; ein Umlaut
 * im Raumnamen kostet auch in Chromium zwei. Dieses Modul rechnet durchgehend
 * mit **zwei Byte je Zeichen**: wer sich verschätzt, soll sich zugunsten des
 * Anwenders verschätzen — die Anzeige „es passen noch 20 Projekte" darf nicht
 * optimistischer sein als der schlechteste Browser.
 *
 * Größenordnungen aus der Messung (Zeichen des JSON, also die Hälfte der
 * pessimistisch gerechneten Byte):
 *  - Demo-Grundriss, ein Geschoss, 10 Wände, 3 Räume …………………  15 000
 *  - Referenzhaus, drei Geschosse mit TGA und Anlagentechnik ……  20 100
 *  - Derselbe Grundriss über drei Geschosse, 30 Wände ……………  31 900
 *  - Dazu ein A4-Plan als hinterlegtes Bild (1190 × 1684 px PNG) …  99 100
 * Ein Handyfoto statt einer Strichzeichnung liegt bei mehreren Millionen
 * Zeichen und sprengt den Speicher im Alleingang — genau dafür gibt es den
 * gemeldeten Überlauf und den Weg über die Datei.
 *
 * Der Zugriff auf `localStorage` steht hier bewusst (wie in `autosave.ts`) —
 * das Modul bleibt sonst frei von React, Store und DOM. Für Prüfungen lässt
 * sich der Speicher über `setzeSpeicher` durch eine Attrappe ersetzen.
 */

import type { BimDocument } from '../types/bim';

/** Schlüssel der Projektliste. Version im Namen, damit ein späteres
 *  Format den alten Stand nicht falsch deutet, sondern ignoriert. */
const INDEX_KEY = 'ravia-cad-light.projekte.v1';
/** Präfix der Dokumentschlüssel: ein Eintrag je Projekt. */
const DOK_PRAEFIX = 'ravia-cad-light.projekt.v1.';

/** Angenommene Obergrenze des Browser-Speichers je Ursprung. */
export const ANGENOMMENE_GRENZE_BYTES = 5 * 1024 * 1024;
/** Ein Zeichen kostet zwei Byte — siehe Dateikopf. */
export const BYTES_JE_ZEICHEN = 2;
/**
 * Richtwert für „passt noch ein Projekt hinein?", solange keines vorliegt,
 * an dem sich messen ließe: ein aufgemessenes Einfamilienhaus mit drei
 * Geschossen liegt ohne hinterlegtes Bild bei rund 60 000 Zeichen.
 * Hergeleitet aus dem Referenzhaus (20 kB) mit Reserve für Bauteilkatalog,
 * Anlagentechnik und die dreifache Raumzahl einer echten Aufnahme.
 */
export const RICHTWERT_ZEICHEN = 60_000;
/**
 * Höchstzahl der Linien in der Vorschau. 250 Segmente sind mehr, als ein
 * Wohnungsgrundriss je hat, und kosten rund 5 kB — Bitmap-Vorschauen kosten
 * das Zwei- bis Dreifache und fressen genau den Platz, den die Dokumente
 * brauchen.
 */
const VORSCHAU_MAX_LINIEN = 250;

// ---------------------------------------------------------------------------
// Speicher — echt oder Attrappe
// ---------------------------------------------------------------------------

/** Der Ausschnitt von `localStorage`, den dieses Modul benutzt. */
export interface SpeicherAdapter {
  getItem(schluessel: string): string | null;
  setItem(schluessel: string, wert: string): void;
  removeItem(schluessel: string): void;
  key(index: number): string | null;
  readonly length: number;
}

let ersatzSpeicher: SpeicherAdapter | null = null;

/**
 * Setzt einen Ersatzspeicher (Prüfungen) oder mit `null` wieder den echten.
 * Absichtlich keine Attrappe im Modul: eine mitgelieferte Attrappe landet
 * irgendwann versehentlich im Auslieferungsstand.
 */
export function setzeSpeicher(adapter: SpeicherAdapter | null): void {
  ersatzSpeicher = adapter;
}

/** Liefert den Speicher oder `null`, wenn keiner erreichbar ist. */
function speicher(): SpeicherAdapter | null {
  if (ersatzSpeicher) return ersatzSpeicher;
  try {
    // Privates Fenster oder gesperrte Website-Daten: der Zugriff wirft.
    const ls = (globalThis as { localStorage?: SpeicherAdapter }).localStorage;
    return ls ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Typen
// ---------------------------------------------------------------------------

/**
 * Umrissvorschau: Wandachsen des untersten Geschosses, auf 0…1 normiert.
 * Bewusst kein Bild — eine Bitmap-Vorschau bräuchte einen Canvas (und damit
 * DOM in einem reinen Modul) und kostete Platz, der den Dokumenten fehlt.
 * Ein Strichbild aus den Wänden ist obendrein aussagekräftiger als ein
 * 120 Pixel breiter Ausschnitt eines dunklen Editors.
 */
export interface Vorschau {
  /** Seitenverhältnis des Umrisses (Breite/Höhe), für die Darstellung. */
  seitenverhaeltnis: number;
  /** Flach: x1, y1, x2, y2 je Segment, jeweils 0…1, auf 2 Stellen gerundet. */
  linien: number[];
}

export interface ProjektUmfang {
  geschosse: number;
  raeume: number;
  waende: number;
  /** Netto-Grundfläche aller Räume [m²], auf 0,1 gerundet. */
  flaeche: number;
}

/** Der Steckbrief eines Projekts — alles, was die Liste zeigt. */
export interface ProjektKopf {
  id: string;
  /** Immer identisch mit `doc.meta.name`; es gibt keinen zweiten Namen. */
  name: string;
  angelegtAm: string;
  geaendertAm: string;
  umfang: ProjektUmfang;
  /** Liegt ein Referenzbild im Dokument? Es bestimmt die Größe. */
  hatBild: boolean;
  /** Länge des gespeicherten JSON in Zeichen. */
  zeichen: number;
  vorschau?: Vorschau;
}

export type Schreibfehler = 'voll' | 'gesperrt' | 'kaputt' | 'unbekannt';

export interface Fehlschlag {
  ok: false;
  grund: Schreibfehler;
  /** Deutscher Satz für die Oberfläche — fertig zum Anzeigen. */
  meldung: string;
}

export type Ergebnis<T> = ({ ok: true } & T) | Fehlschlag;

export interface SpeicherBericht {
  /** Belegte Byte über *alle* Schlüssel — die Grenze gilt für den Ursprung. */
  belegtBytes: number;
  /** Nur die Projektdokumente. */
  projekteBytes: number;
  grenzeBytes: number;
  freiBytes: number;
  /** Wie viele Projekte der Größe `richtwertBytes` noch hineinpassen. */
  passenNoch: number;
  /** Woran gemessen wurde: größtes vorhandenes Projekt oder Richtwert. */
  richtwertBytes: number;
  posten: { id: string; name: string; bytes: number }[];
}

interface ProjektIndex {
  version: 1;
  aktiv: string | null;
  koepfe: ProjektKopf[];
}

// ---------------------------------------------------------------------------
// Index lesen und schreiben
// ---------------------------------------------------------------------------

function leererIndex(): ProjektIndex {
  return { version: 1, aktiv: null, koepfe: [] };
}

/**
 * Liest die Projektliste. Ein beschädigter Eintrag wird gemeldet, nicht
 * repariert und nicht gelöscht: was hier steht, ist die Arbeit von Abenden.
 * Erst wenn jemand ein neues Projekt anlegt, wird der unlesbare Index
 * überschrieben — dann hat die Oberfläche das Problem längst angezeigt.
 */
function leseIndex(): { index: ProjektIndex; problem: string | null } {
  const s = speicher();
  if (!s) {
    return {
      index: leererIndex(),
      problem: 'Der Browser-Speicher ist nicht erreichbar (privates Fenster oder gesperrte Website-Daten).',
    };
  }
  let roh: string | null = null;
  try {
    roh = s.getItem(INDEX_KEY);
  } catch {
    return { index: leererIndex(), problem: 'Der Browser-Speicher ließ sich nicht lesen.' };
  }
  if (!roh) return { index: leererIndex(), problem: null };
  try {
    const gelesen = JSON.parse(roh) as Partial<ProjektIndex>;
    if (!gelesen || !Array.isArray(gelesen.koepfe)) {
      return { index: leererIndex(), problem: 'Die Projektliste im Speicher ist beschädigt und wurde übergangen.' };
    }
    // Einzelne unbrauchbare Köpfe kosten nicht die ganze Liste.
    const koepfe = gelesen.koepfe.filter(
      (k): k is ProjektKopf => Boolean(k && typeof k.id === 'string' && typeof k.name === 'string'),
    );
    const verloren = gelesen.koepfe.length - koepfe.length;
    return {
      index: { version: 1, aktiv: typeof gelesen.aktiv === 'string' ? gelesen.aktiv : null, koepfe },
      problem: verloren > 0 ? `${verloren} unlesbare Einträge in der Projektliste übergangen.` : null,
    };
  } catch {
    return { index: leererIndex(), problem: 'Die Projektliste im Speicher ist beschädigt und wurde übergangen.' };
  }
}

function schreibeIndex(index: ProjektIndex): Fehlschlag | null {
  return schreibe(INDEX_KEY, JSON.stringify(index));
}

/** Ein Schreibvorgang, der niemals wirft — der Kern des Überlaufschutzes. */
function schreibe(schluessel: string, wert: string): Fehlschlag | null {
  const s = speicher();
  if (!s) {
    return {
      ok: false,
      grund: 'gesperrt',
      meldung: 'Der Browser-Speicher ist gesperrt (privates Fenster). Sichern Sie das Projekt als Datei.',
    };
  }
  try {
    s.setItem(schluessel, wert);
    return null;
  } catch (fehler) {
    if (istVoll(fehler)) {
      return {
        ok: false,
        grund: 'voll',
        meldung:
          'Der Browser-Speicher ist voll. Sichern Sie ein Projekt als Datei und nehmen Sie es danach aus dem Speicher.',
      };
    }
    // Nicht jeder Fehlschlag ist ein voller Speicher. Ist der Speicher
    // überhaupt nicht ansprechbar — privates Fenster, gesperrte Website-Daten,
    // abgeschaltete Speicherung —, wirft schon das Lesen. Das ist ein anderer
    // Rat als „machen Sie Platz“, deshalb wird es unterschieden.
    try {
      s.getItem(schluessel);
    } catch {
      return {
        ok: false,
        grund: 'gesperrt',
        meldung: 'Der Browser-Speicher ist gesperrt (privates Fenster). Sichern Sie das Projekt als Datei.',
      };
    }
    return { ok: false, grund: 'unbekannt', meldung: 'Der Stand konnte nicht in den Browser-Speicher geschrieben werden.' };
  }
}

/**
 * Erkennt die Quota-Ausnahme. Die Browser melden sie uneinheitlich: Chrome
 * mit `QuotaExceededError` (Code 22), Firefox mit `NS_ERROR_DOM_QUOTA_REACHED`
 * (Code 1014), ältere Safari-Fassungen im privaten Modus ebenfalls über den
 * Namen. Wer nur auf einen Namen prüft, hält den Speicher anderswo für
 * kaputt statt für voll — und gibt den falschen Rat.
 */
function istVoll(fehler: unknown): boolean {
  const f = fehler as { name?: string; code?: number } | null;
  if (!f) return false;
  return (
    f.name === 'QuotaExceededError' ||
    f.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    f.code === 22 ||
    f.code === 1014
  );
}

function loesche(schluessel: string): void {
  try {
    speicher()?.removeItem(schluessel);
  } catch {
    /* nichts zu tun */
  }
}

// ---------------------------------------------------------------------------
// Steckbrief und Vorschau
// ---------------------------------------------------------------------------

/**
 * Zieht den Umriss aus den Wänden des untersten Geschosses.
 *
 * Warum nur eines: übereinandergelegte Geschosse ergeben ein Gewirr, in dem
 * niemand sein Projekt wiedererkennt. Das unterste ist in aller Regel das,
 * was man vor Augen hat, wenn man an „diesen Grundriss" denkt.
 */
export function baueVorschau(doc: BimDocument): Vorschau | undefined {
  const geschosse = Object.values(doc.levels ?? {});
  if (geschosse.length === 0) return undefined;
  const unterstes = geschosse.reduce((a, b) => ((a.order ?? 0) <= (b.order ?? 0) ? a : b));
  const waende = Object.values(doc.walls ?? {}).filter((w) => w.levelId === unterstes.id);
  if (waende.length === 0) return undefined;

  const strecken: [number, number, number, number][] = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const w of waende.slice(0, VORSCHAU_MAX_LINIEN)) {
    const a = doc.nodes?.[w.a];
    const b = doc.nodes?.[w.b];
    if (!a || !b) continue;
    strecken.push([a.x, a.y, b.x, b.y]);
    minX = Math.min(minX, a.x, b.x);
    maxX = Math.max(maxX, a.x, b.x);
    minY = Math.min(minY, a.y, b.y);
    maxY = Math.max(maxY, a.y, b.y);
  }
  if (strecken.length === 0) return undefined;

  const breite = maxX - minX;
  const hoehe = maxY - minY;
  // Ein Zug ohne Ausdehnung in einer Richtung (eine einzelne gerade Wand)
  // hätte sonst einen Nenner von 0.
  const nenner = Math.max(breite, hoehe, 1e-6);
  const linien: number[] = [];
  for (const [x1, y1, x2, y2] of strecken) {
    linien.push(
      runde2((x1 - minX) / nenner),
      runde2((y1 - minY) / nenner),
      runde2((x2 - minX) / nenner),
      runde2((y2 - minY) / nenner),
    );
  }
  return { seitenverhaeltnis: breite > 0 && hoehe > 0 ? runde2(breite / hoehe) : 1, linien };
}

function runde2(v: number): number {
  return Math.round(v * 100) / 100;
}

function umfangVon(doc: BimDocument): ProjektUmfang {
  const raeume = Object.values(doc.rooms ?? {});
  return {
    geschosse: Object.keys(doc.levels ?? {}).length,
    raeume: raeume.length,
    waende: Object.keys(doc.walls ?? {}).length,
    flaeche: Math.round(raeume.reduce((sum, r) => sum + (r.area ?? 0), 0) * 10) / 10,
  };
}

// ---------------------------------------------------------------------------
// Öffentliche Vorgänge
// ---------------------------------------------------------------------------

/**
 * Alle Projekte, das zuletzt geänderte zuerst — das ist die Reihenfolge, in
 * der ein Mensch sucht: „woran habe ich gestern gearbeitet?".
 * `probleme` sammelt, was im Speicher nicht stimmt; die Liste bleibt
 * benutzbar, auch wenn ein Eintrag fehlt.
 */
export function listeProjekte(): { projekte: ProjektKopf[]; probleme: string[] } {
  const { index, problem } = leseIndex();
  const probleme = problem ? [problem] : [];
  const s = speicher();
  const projekte: ProjektKopf[] = [];
  for (const kopf of index.koepfe) {
    let vorhanden = false;
    try {
      vorhanden = Boolean(s?.getItem(DOK_PRAEFIX + kopf.id));
    } catch {
      vorhanden = false;
    }
    if (!vorhanden) {
      probleme.push(`Zu „${kopf.name}" fehlt das Dokument im Speicher — der Eintrag lässt sich nur noch löschen.`);
    }
    projekte.push(kopf);
  }
  projekte.sort((a, b) => (a.geaendertAm < b.geaendertAm ? 1 : a.geaendertAm > b.geaendertAm ? -1 : 0));
  return { projekte, probleme };
}

export function aktivesProjekt(): string | null {
  return leseIndex().index.aktiv;
}

export function setzeAktivesProjekt(id: string | null): void {
  const { index } = leseIndex();
  index.aktiv = id;
  schreibeIndex(index);
}

/**
 * Legt aus einem Namenswunsch einen Namen, den es noch nicht gibt.
 * „Wohnung" wird zu „Wohnung (2)" — nicht zu „Wohnung1", denn die Zahl
 * gehört sichtbar zur Unterscheidung, nicht in den Namen hinein.
 */
export function eindeutigerName(wunsch: string, vorhandene: string[]): string {
  const basis = wunsch.trim() || 'Neues Projekt';
  const belegt = new Set(vorhandene.map((n) => n.trim().toLowerCase()));
  if (!belegt.has(basis.toLowerCase())) return basis;
  for (let i = 2; i < 1000; i++) {
    const kandidat = `${basis} (${i})`;
    if (!belegt.has(kandidat.toLowerCase())) return kandidat;
  }
  return `${basis} (${Date.now()})`;
}

function neueId(): string {
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Legt ein Projekt aus dem übergebenen Dokument an.
 *
 * Der Name kommt aus `doc.meta.name`, sofern keiner übergeben wird — der
 * Projektname *ist* der Dokumentname. Kollidiert er, bekommt er eine Zahl,
 * und das Dokument wird mit dem neuen Namen abgelegt: zwei Projekte, die
 * beide „Neues Projekt" heißen, sind eine Falle, keine Freiheit.
 */
export function legeProjektAn(doc: BimDocument, name?: string): Ergebnis<{ kopf: ProjektKopf; doc: BimDocument }> {
  const { index } = leseIndex();
  const gewuenscht = eindeutigerName(name ?? doc.meta?.name ?? 'Neues Projekt', index.koepfe.map((k) => k.name));
  const jetzt = new Date().toISOString();
  const id = neueId();
  const abgelegt: BimDocument = { ...doc, meta: { ...doc.meta, name: gewuenscht, modifiedAt: jetzt } };
  const json = JSON.stringify(abgelegt);

  const fehler = schreibe(DOK_PRAEFIX + id, json);
  if (fehler) return fehler;

  const kopf: ProjektKopf = {
    id,
    name: gewuenscht,
    angelegtAm: doc.meta?.createdAt ?? jetzt,
    geaendertAm: jetzt,
    umfang: umfangVon(abgelegt),
    hatBild: Boolean(abgelegt.image),
    zeichen: json.length,
    vorschau: baueVorschau(abgelegt),
  };
  index.koepfe.push(kopf);
  index.aktiv = id;
  const indexFehler = schreibeIndex(index);
  if (indexFehler) {
    // Ohne Eintrag in der Liste wäre das Dokument Speichermüll, den niemand
    // mehr findet — also wieder wegräumen.
    loesche(DOK_PRAEFIX + id);
    return indexFehler;
  }
  return { ok: true, kopf, doc: abgelegt };
}

/**
 * Schreibt den Stand eines bestehenden Projekts.
 *
 * Reihenfolge mit Absicht: erst das Dokument, dann die Liste. Scheitert das
 * Dokument am vollen Speicher, bleibt der alte Stand vollständig erhalten und
 * die Liste beschreibt ihn weiterhin richtig. Andersherum stünde in der Liste
 * ein Umfang, den das gespeicherte Dokument nicht hat.
 */
export function speichereProjekt(id: string, doc: BimDocument): Ergebnis<{ kopf: ProjektKopf }> {
  const { index } = leseIndex();
  const vorher = index.koepfe.find((k) => k.id === id);
  if (!vorher) {
    return { ok: false, grund: 'kaputt', meldung: 'Dieses Projekt steht nicht mehr in der Liste.' };
  }
  const json = JSON.stringify(doc);
  const fehler = schreibe(DOK_PRAEFIX + id, json);
  if (fehler) return fehler;

  const kopf: ProjektKopf = {
    ...vorher,
    // Der Dokumentname führt: wer oben in der Kopfzeile umbenennt, benennt
    // damit das Projekt um, ohne es zu wissen — und findet es trotzdem wieder.
    name: doc.meta?.name?.trim() || vorher.name,
    geaendertAm: new Date().toISOString(),
    umfang: umfangVon(doc),
    hatBild: Boolean(doc.image),
    zeichen: json.length,
    vorschau: baueVorschau(doc),
  };
  index.koepfe = index.koepfe.map((k) => (k.id === id ? kopf : k));
  const indexFehler = schreibeIndex(index);
  if (indexFehler) return indexFehler;
  return { ok: true, kopf };
}

/** Liest ein Projekt zurück — verlustfrei, es ist dasselbe Dokument. */
export function ladeProjekt(id: string): Ergebnis<{ doc: BimDocument; kopf: ProjektKopf | null }> {
  const s = speicher();
  if (!s) return { ok: false, grund: 'gesperrt', meldung: 'Der Browser-Speicher ist nicht erreichbar.' };
  let roh: string | null = null;
  try {
    roh = s.getItem(DOK_PRAEFIX + id);
  } catch {
    return { ok: false, grund: 'gesperrt', meldung: 'Der Browser-Speicher ließ sich nicht lesen.' };
  }
  if (!roh) {
    return { ok: false, grund: 'kaputt', meldung: 'Zu diesem Projekt liegt kein Dokument im Speicher.' };
  }
  try {
    const doc = JSON.parse(roh) as BimDocument;
    // Ein Dokument ohne Wandsammlung ist keins — lieber melden als die
    // Oberfläche mit `undefined` in der Hand losschicken.
    if (!doc || typeof doc !== 'object' || !doc.walls || !doc.meta) {
      return { ok: false, grund: 'kaputt', meldung: 'Das gespeicherte Projekt ist beschädigt und wurde nicht geöffnet.' };
    }
    const kopf = leseIndex().index.koepfe.find((k) => k.id === id) ?? null;
    return { ok: true, doc, kopf };
  } catch {
    return { ok: false, grund: 'kaputt', meldung: 'Das gespeicherte Projekt ist beschädigt und wurde nicht geöffnet.' };
  }
}

/**
 * Umbenennen. Der Name steht an zwei Stellen — im Kopf der Liste und im
 * Dokument —, und beide müssen dasselbe sagen, sonst heißt das Projekt in der
 * Liste anders als in der Kopfzeile und in der Exportdatei.
 */
export function benenneProjektUm(id: string, name: string): Ergebnis<{ kopf: ProjektKopf }> {
  const geladen = ladeProjekt(id);
  if (!geladen.ok) return geladen;
  const { index } = leseIndex();
  const eindeutig = eindeutigerName(
    name,
    index.koepfe.filter((k) => k.id !== id).map((k) => k.name),
  );
  return speichereProjekt(id, { ...geladen.doc, meta: { ...geladen.doc.meta, name: eindeutig } });
}

/** Dupliziert ein Projekt — die Sicherheitskopie vor dem großen Umbau. */
export function dupliziereProjekt(id: string, name?: string): Ergebnis<{ kopf: ProjektKopf; doc: BimDocument }> {
  const geladen = ladeProjekt(id);
  if (!geladen.ok) return geladen;
  const wunsch = name ?? `${geladen.doc.meta.name} (Kopie)`;
  const angelegt = legeProjektAn(geladen.doc, wunsch);
  if (!angelegt.ok) return angelegt;
  // Das Duplikat ist neu, auch wenn sein Inhalt alt ist. Das Anlagedatum des
  // Originals hier zu übernehmen, würde die Liste falsch sortieren.
  return angelegt;
}

/**
 * Löscht Dokument und Eintrag. Ohne Rückfrage — die stellt die Oberfläche,
 * denn nur dort weiß man, ob gerade jemand hinsieht.
 */
export function loescheProjekt(id: string): void {
  loesche(DOK_PRAEFIX + id);
  const { index } = leseIndex();
  index.koepfe = index.koepfe.filter((k) => k.id !== id);
  if (index.aktiv === id) index.aktiv = null;
  schreibeIndex(index);
}

/**
 * Was der Speicher hergibt und was noch hineinpasst.
 *
 * Gezählt wird über *alle* Schlüssel des Ursprungs, nicht nur über die
 * Projekte: die Grenze gilt für alles zusammen, und die Sitzungssicherung,
 * der Ansichtsmodus und der Merker der Einführung liegen daneben.
 */
export function speicherBericht(): SpeicherBericht {
  const s = speicher();
  let belegtZeichen = 0;
  if (s) {
    try {
      for (let i = 0; i < s.length; i++) {
        const k = s.key(i);
        if (k === null) continue;
        belegtZeichen += k.length + (s.getItem(k)?.length ?? 0);
      }
    } catch {
      belegtZeichen = 0;
    }
  }
  const { index } = leseIndex();
  const posten = index.koepfe.map((k) => ({ id: k.id, name: k.name, bytes: k.zeichen * BYTES_JE_ZEICHEN }));
  const projekteBytes = posten.reduce((sum, p) => sum + p.bytes, 0);
  const belegtBytes = belegtZeichen * BYTES_JE_ZEICHEN;
  const freiBytes = Math.max(0, ANGENOMMENE_GRENZE_BYTES - belegtBytes);
  // Gemessen wird am größten vorhandenen Projekt: wer eines mit hinterlegtem
  // Foto hat, soll nicht die Zahl für ein bildloses Projekt lesen.
  const richtwertBytes = Math.max(
    RICHTWERT_ZEICHEN * BYTES_JE_ZEICHEN,
    ...posten.map((p) => p.bytes),
  );
  return {
    belegtBytes,
    projekteBytes,
    grenzeBytes: ANGENOMMENE_GRENZE_BYTES,
    freiBytes,
    passenNoch: Math.floor(freiBytes / richtwertBytes),
    richtwertBytes,
    posten,
  };
}

/** „1,3 MB" statt „1363148" — Zahlen, die man vorlesen kann. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}
