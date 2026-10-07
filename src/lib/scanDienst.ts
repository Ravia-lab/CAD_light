/**
 * Mit RaVia Scan scannen — der Weg ohne Datei.
 * ---------------------------------------------------------------------------
 * **Der Auftrag (07.10.2026):** „Funktion einbauen, wo man direkt zum RaVia
 * Scan kommt und diesen per QR öffnen kann und auch dann zurück bekommt vom
 * Scan."
 *
 * Bis 1.72.0 gab es zwei Wege, einen Scan hereinzubekommen: als Datei
 * (`ScanUebernahme`) oder über RaVia, das den Scan in der Testumgebung mit
 * eigenem Dialog abholt und per `loadBuilding` durchreicht. Das eigenständige
 * CAD Light konnte den Scan nicht **anstoßen**: Die Scan-Schnittstelle in RaVia
 * verlangt Anmeldung und Projekt, und CAD Light hat beides nicht.
 *
 * **Der Ablauf, den dieses Modul trägt:**
 *
 *  1. CAD Light legt beim Scan-Dienst eine Sitzung an und bekommt einen
 *     Kopplungscode, den Kopplungslink und ein **Lesetoken** zurück.
 *  2. Der Link wird als QR-Code gezeigt. Am iPhone/iPad gibt es statt des
 *     QR-Codes „In RaVia Scan öffnen" — das eigene Schema `raviascan://` mit
 *     `return=` auf genau diese Seite und `?scan=<Sitzung>`.
 *  3. CAD Light fragt alle zwei Sekunden den Stand ab. Ist der Scan
 *     eingegangen, holt es das Gebäudemodell, lädt es durch **denselben**
 *     Import wie Datei und Einbettung und meldet die Sitzung als übernommen.
 *  4. Springt die App nach dem Hochladen zurück, lädt die Seite mit
 *     `?scan=<Sitzung>` neu. Das Lesetoken liegt im Speicher des Browsers;
 *     damit nimmt der Dialog die Sitzung wieder auf. iOS verwirft die
 *     Safari-Seite während des LiDAR-Scans oft — ohne diesen Schritt wäre der
 *     Scan dann auf dem Server und nicht im Plan.
 *
 * **Warum der Dienst unter derselben Adresse liegt** (`scan-dienst/` neben
 * der Anwendung): Die Inhaltsrichtlinie dieses Programms erlaubt seit 1.14.0
 * nur Verbindungen zum eigenen Server (`connect-src 'self'`), und das bleibt
 * so. Der Server reicht `scan-dienst/` an die Scan-Schnittstelle von RaVia
 * weiter. Kein CORS, keine fremde Adresse im Browser.
 *
 * **Warum ein Lesetoken statt Anmeldung.** Wer die Sitzung angelegt hat, hat
 * das Token — und nur er. Es steht nicht im QR-Code und nicht im
 * Rücksprunglink; der Server speichert nur seinen Hash. Wer einen
 * Kopplungslink abfotografiert, kann damit koppeln (das ist der Zweck),
 * aber nicht den Scan eines anderen abholen.
 *
 * Alles hier ist ohne DOM prüfbar: `fetch` und der Speicher werden
 * hereingereicht. Der Dialog (`ScanDialog.tsx`) verdrahtet nur.
 */

/** Relativ zur Anwendung — stimmt unter jedem Grundpfad. */
export const SCAN_DIENST_PFAD = 'scan-dienst/';

/** Abfrageabstand in Millisekunden. */
export const ABFRAGE_MS = 2000;

/**
 * Server, auf die ein Kopplungslink zeigen darf. Dieselbe Liste nimmt die
 * App an (`PairingLink.defaultAllowedHosts` in RaVia Scan). Ein Link auf
 * einen anderen Server wird **nicht** als QR-Code gezeigt: Er schickte das
 * iPhone dorthin, und die App lehnte ihn ohnehin ab.
 */
export const ERLAUBTE_SERVER = ['ravia-tech.de', 'www.ravia-tech.de', 'test.ravia-tech.de'] as const;

export type ScanStatus = 'offen' | 'gekoppelt' | 'eingegangen' | 'uebernommen' | 'abgelaufen' | 'abgebrochen';

const STATUS: readonly ScanStatus[] = ['offen', 'gekoppelt', 'eingegangen', 'uebernommen', 'abgelaufen', 'abgebrochen'];

export interface ScanSitzung {
  id: string;
  status: ScanStatus;
  pairingCode: string;
  pairingUrl: string;
  readToken: string;
  expiresAt?: string;
}

export interface ScanStand {
  id: string;
  status: ScanStatus;
  expiresAt?: string;
  captureCount?: number;
}

export interface ScanGebaeude {
  captureId?: string;
  receivedAt?: string;
  building: unknown;
}

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

/** Fehler des Dienstes — mit dem Satz, den der Anwender liest. */
export class ScanDienstFehler extends Error {
  constructor(
    readonly art: 'nicht-eingerichtet' | 'netz' | 'fremd' | 'unbekannt' | 'abgelaufen' | 'bremse' | 'antwort',
    message: string,
    readonly http?: number,
  ) {
    super(message);
    this.name = 'ScanDienstFehler';
  }
}

// ---------------------------------------------------------------------------
// Adressen
// ---------------------------------------------------------------------------

/**
 * Die Adresse des Dienstes relativ zur Anwendung — oder `null`, wenn die
 * Anwendung nicht von einem Server kommt (Einzeldatei über `file://`). Dann
 * gibt es keinen Server, der weiterreichen könnte, und der Dialog sagt das,
 * statt eine Verbindung zu versuchen, die die Richtlinie ohnehin sperrt.
 */
export function dienstBasis(baseURI: string): string | null {
  let url: URL;
  try {
    url = new URL(SCAN_DIENST_PFAD, baseURI);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  return url.toString();
}

/** Ist der Kopplungslink einer, dem die App folgt? https, erlaubter Server, kein Benutzer. */
export function kopplungslinkGueltig(link: string): boolean {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return false;
  }
  return (
    url.protocol === 'https:' &&
    !url.username &&
    !url.password &&
    !url.port &&
    (ERLAUBTE_SERVER as readonly string[]).includes(url.hostname.toLowerCase()) &&
    /^\/scan\/p\/[A-Za-z0-9-]{8,64}$/.test(url.pathname)
  );
}

/**
 * Der Link, der die App direkt öffnet — am iPhone/iPad statt des QR-Codes.
 *
 * Safari öffnet einen https-Link derselben Domain im Browser und nicht in der
 * App (Universal Links greifen nur beim Wechsel der Domain). Deshalb das
 * eigene Schema. Der Server kommt aus dem Kopplungslink, nicht aus der
 * eigenen Adresse: Nur so koppelt die App bei genau dem Server, der die
 * Sitzung kennt. `rueckkehr` ist die Seite, auf die die App nach dem
 * Hochladen zurückspringt; sie nimmt nur https auf den erlaubten Servern an.
 */
export function appLink(pairingUrl: string, code: string, rueckkehr?: string): string | null {
  if (!kopplungslinkGueltig(pairingUrl) || !/^[A-Za-z0-9-]{8,64}$/.test(code)) return null;
  const host = new URL(pairingUrl).hostname.toLowerCase();
  let url = `raviascan://pair?code=${encodeURIComponent(code.toUpperCase())}&host=${encodeURIComponent(host)}`;
  if (rueckkehr && rueckkehrErlaubt(rueckkehr)) url += `&return=${encodeURIComponent(rueckkehr)}`;
  return url;
}

/** Die App springt nur auf https zurück, nur auf erlaubte Server, ohne Benutzer und Port. */
export function rueckkehrErlaubt(link: string): boolean {
  try {
    const url = new URL(link);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      (ERLAUBTE_SERVER as readonly string[]).includes(url.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
}

const SITZUNG_MUSTER = /^[A-Za-z0-9_-]{4,80}$/;

/** Die Seite mit `?scan=<Sitzung>` — dahin springt die App zurück. */
export function rueckkehrUrl(href: string, sitzungId: string): string {
  const url = new URL(scanEntfernen(href));
  url.searchParams.set('scan', sitzungId);
  return url.toString();
}

/** Sitzungskennung aus `?scan=…` — nur harmlose Zeichen, sonst `null`. */
export function sitzungAusUrl(href: string): string | null {
  try {
    const wert = new URL(href).searchParams.get('scan');
    return wert && SITZUNG_MUSTER.test(wert) ? wert : null;
  } catch {
    return null;
  }
}

/** `?scan=…` wieder entfernen — nach Abschluss oder Abbruch. */
export function scanEntfernen(href: string): string {
  try {
    const url = new URL(href);
    url.searchParams.delete('scan');
    return url.toString();
  } catch {
    return href;
  }
}

/** iPhone/iPad? iPadOS meldet sich als Mac, verrät sich aber über die Touchpunkte. */
export function istAppleMobil(userAgent: string, maxTouchPoints: number): boolean {
  if (/iPhone|iPad|iPod/.test(userAgent)) return true;
  return /Macintosh/.test(userAgent) && maxTouchPoints > 1;
}

// ---------------------------------------------------------------------------
// Das Lesetoken im Speicher des Browsers
// ---------------------------------------------------------------------------

export interface Ablage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const ABLAGE_PRAEFIX = 'ravia-cad-scan:';

/**
 * Das Token überlebt den Rücksprung aus der App — es ist das Einzige, was der
 * Browser über die Sitzung wissen muss. Ein gesperrter Speicher (privates
 * Fenster) ist kein Fehler: Dann geht der Dialog eben nur, solange die Seite
 * offen bleibt, und sagt das beim Rücksprung.
 */
export function tokenMerken(ablage: Ablage | null, sitzung: ScanSitzung): void {
  try {
    ablage?.setItem(
      ABLAGE_PRAEFIX + sitzung.id,
      JSON.stringify({ token: sitzung.readToken, code: sitzung.pairingCode, link: sitzung.pairingUrl }),
    );
  } catch {
    // Speicher gesperrt — siehe oben.
  }
}

export function tokenHolen(
  ablage: Ablage | null,
  sitzungId: string,
): { token: string; code?: string; link?: string } | null {
  try {
    const roh = ablage?.getItem(ABLAGE_PRAEFIX + sitzungId);
    if (!roh) return null;
    const d = JSON.parse(roh) as { token?: unknown; code?: unknown; link?: unknown };
    if (typeof d.token !== 'string' || !d.token) return null;
    return {
      token: d.token,
      code: typeof d.code === 'string' ? d.code : undefined,
      link: typeof d.link === 'string' ? d.link : undefined,
    };
  } catch {
    return null;
  }
}

export function tokenVergessen(ablage: Ablage | null, sitzungId: string): void {
  try {
    ablage?.removeItem(ABLAGE_PRAEFIX + sitzungId);
  } catch {
    // egal
  }
}

// ---------------------------------------------------------------------------
// Der Dienst
// ---------------------------------------------------------------------------

const TEXT_NICHT_EINGERICHTET =
  'Der Scan-Dienst ist auf diesem Server noch nicht eingerichtet. Bis dahin: in RaVia scannen ' +
  '(dort oben „Gebäude scannen") oder die Scan-Datei hier öffnen.';

async function anfrage<T>(
  fetchFn: FetchFn,
  url: string,
  init: RequestInit,
  pruefen: (d: unknown) => T,
): Promise<T> {
  let antwort: Response;
  try {
    antwort = await fetchFn(url, { ...init, credentials: 'omit', cache: 'no-store' });
  } catch {
    throw new ScanDienstFehler('netz', 'Keine Verbindung zum Server. Ist das Gerät online?');
  }
  const typ = antwort.headers.get('content-type') ?? '';
  let daten: unknown = null;
  if (typ.includes('json')) {
    try {
      daten = await antwort.json();
    } catch {
      daten = null;
    }
  }
  if (!antwort.ok) {
    const meldung =
      daten && typeof daten === 'object' && typeof (daten as { message?: unknown }).message === 'string'
        ? (daten as { message: string }).message
        : '';
    const code =
      daten && typeof daten === 'object' && typeof (daten as { error?: unknown }).error === 'string'
        ? (daten as { error: string }).error
        : '';
    // Eine Seite statt JSON (404 von nginx, 502 bei stehendem Dienst) heißt:
    // die Weiterleitung fehlt oder der Dienst läuft nicht.
    if (!typ.includes('json') && (antwort.status === 404 || antwort.status >= 500)) {
      throw new ScanDienstFehler('nicht-eingerichtet', TEXT_NICHT_EINGERICHTET, antwort.status);
    }
    if (antwort.status === 401 || antwort.status === 403) {
      throw new ScanDienstFehler(
        'fremd',
        'Diese Scan-Sitzung gehört zu einem anderen Gerät oder Browser. Bitte hier einen neuen QR-Code erzeugen.',
        antwort.status,
      );
    }
    if (antwort.status === 404 && code === 'unknown_session') {
      throw new ScanDienstFehler('unbekannt', 'Diese Scan-Sitzung gibt es nicht mehr. Bitte neu beginnen.', 404);
    }
    if (antwort.status === 410) {
      throw new ScanDienstFehler('abgelaufen', 'Die Scan-Sitzung ist abgelaufen. Bitte einen neuen QR-Code erzeugen.', 410);
    }
    if (antwort.status === 429) {
      throw new ScanDienstFehler(
        'bremse',
        'Zu viele Scan-Sitzungen in kurzer Zeit. Bitte eine Minute warten.',
        429,
      );
    }
    throw new ScanDienstFehler('antwort', meldung || `Der Scan-Dienst antwortet mit Fehler ${antwort.status}.`, antwort.status);
  }
  try {
    return pruefen(daten);
  } catch (e) {
    throw new ScanDienstFehler('antwort', `Unerwartete Antwort des Scan-Dienstes: ${(e as Error).message}`);
  }
}

function statusLesen(wert: unknown): ScanStatus {
  if (typeof wert === 'string' && (STATUS as readonly string[]).includes(wert)) return wert as ScanStatus;
  throw new Error(`unbekannter Status ${String(wert)}`);
}

function zeichen(wert: unknown, feld: string): string {
  if (typeof wert !== 'string' || !wert) throw new Error(`${feld} fehlt`);
  return wert;
}

const lesen = (token: string): HeadersInit => ({ 'X-Scan-Read-Token': token });

/** Eine neue Sitzung anlegen. */
export async function sitzungAnlegen(basis: string, fetchFn: FetchFn): Promise<ScanSitzung> {
  return anfrage(
    fetchFn,
    `${basis}sessions`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
    (d) => {
      const o = (d ?? {}) as Record<string, unknown>;
      const s: ScanSitzung = {
        id: zeichen(o.id, 'id'),
        status: statusLesen(o.status ?? 'offen'),
        pairingCode: zeichen(o.pairingCode, 'pairingCode'),
        pairingUrl: zeichen(o.pairingUrl, 'pairingUrl'),
        readToken: zeichen(o.readToken, 'readToken'),
        expiresAt: typeof o.expiresAt === 'string' ? o.expiresAt : undefined,
      };
      if (!SITZUNG_MUSTER.test(s.id)) throw new Error('Sitzungskennung mit unerlaubten Zeichen');
      if (!kopplungslinkGueltig(s.pairingUrl)) {
        throw new Error(`Kopplungslink zeigt auf keinen erlaubten Server (${s.pairingUrl})`);
      }
      return s;
    },
  );
}

/** Stand einer Sitzung abfragen. */
export async function sitzungStand(basis: string, id: string, token: string, fetchFn: FetchFn): Promise<ScanStand> {
  return anfrage(fetchFn, `${basis}sessions/${encodeURIComponent(id)}`, { headers: lesen(token) }, (d) => {
    const o = (d ?? {}) as Record<string, unknown>;
    return {
      id: zeichen(o.id, 'id'),
      status: statusLesen(o.status),
      expiresAt: typeof o.expiresAt === 'string' ? o.expiresAt : undefined,
      captureCount: typeof o.captureCount === 'number' ? o.captureCount : undefined,
    };
  });
}

/** Das Gebäudemodell der neuesten Aufnahme holen. */
export async function gebaeudeHolen(basis: string, id: string, token: string, fetchFn: FetchFn): Promise<ScanGebaeude> {
  return anfrage(fetchFn, `${basis}sessions/${encodeURIComponent(id)}/building`, { headers: lesen(token) }, (d) => {
    const o = (d ?? {}) as Record<string, unknown>;
    if (!o.building || typeof o.building !== 'object') throw new Error('building fehlt');
    return {
      captureId: typeof o.captureId === 'string' ? o.captureId : undefined,
      receivedAt: typeof o.receivedAt === 'string' ? o.receivedAt : undefined,
      building: o.building,
    };
  });
}

/** Melden, dass der Scan im Plan ist. */
export async function uebernommenMelden(basis: string, id: string, token: string, fetchFn: FetchFn): Promise<void> {
  await anfrage(
    fetchFn,
    `${basis}sessions/${encodeURIComponent(id)}/consume`,
    { method: 'POST', headers: { ...lesen(token), 'Content-Type': 'application/json' }, body: '{}' },
    () => undefined,
  );
}

/** Abbrechen — der Kopplungscode wird damit wertlos. */
export async function sitzungAbbrechen(basis: string, id: string, token: string, fetchFn: FetchFn): Promise<void> {
  await anfrage(
    fetchFn,
    `${basis}sessions/${encodeURIComponent(id)}`,
    { method: 'DELETE', headers: lesen(token) },
    () => undefined,
  );
}

// ---------------------------------------------------------------------------
// Ablauf
// ---------------------------------------------------------------------------

export type Schritt = 'warten' | 'laden' | 'fertig' | 'ende';

/** Was der Dialog als Nächstes tut. */
export function naechsterSchritt(status: ScanStatus, ladenLaeuft: boolean): Schritt {
  if (status === 'eingegangen') return ladenLaeuft ? 'warten' : 'laden';
  if (status === 'offen' || status === 'gekoppelt') return 'warten';
  if (status === 'uebernommen') return 'fertig';
  return 'ende';
}

export function statusText(status: ScanStatus, mobil: boolean): string {
  switch (status) {
    case 'offen':
      return mobil
        ? 'Auf „In RaVia Scan öffnen" tippen. Nach dem Hochladen springt die App hierher zurück, und der Grundriss lädt von selbst.'
        : 'Den QR-Code mit der Kamera des iPhone oder iPad scannen. RaVia Scan öffnet sich dann von selbst.';
    case 'gekoppelt':
      return 'Verbunden. Jetzt die Räume mit RaVia Scan aufnehmen und dort auf „Fertig" tippen.';
    case 'eingegangen':
      return 'Der Scan ist angekommen und wird geladen …';
    case 'uebernommen':
      return 'Fertig. Der Scan ist im Plan.';
    case 'abgelaufen':
      return 'Der Kopplungscode ist abgelaufen. Bitte einen neuen QR-Code erzeugen.';
    case 'abgebrochen':
      return 'Dieser Scan wurde abgebrochen.';
  }
}

/** Schreibweise des Codes zum Abtippen: in Vierergruppen. */
export function codeAnzeige(code: string): string {
  const rein = code.replace(/-/g, '').toUpperCase();
  return rein.match(/.{1,4}/g)?.join('-') ?? rein;
}

/**
 * Einzeilige Zusammenfassung eines Gebäudemodells für den Dialog. Sie steht
 * **vor** der Frage „ersetzen oder dazulegen" — wer sie liest, soll wissen,
 * was er gleich in den Plan holt.
 */
export function kurzfassung(building: unknown): string {
  const b = building as {
    summary?: Record<string, unknown>;
    levels?: { roof?: { kind?: string; pitchDeg?: number } }[];
  } | null;
  const s = b?.summary;
  if (!s) return '';
  const zahl = (n: unknown, stellen: number) =>
    typeof n === 'number' && Number.isFinite(n)
      ? n.toLocaleString('de-DE', { minimumFractionDigits: stellen, maximumFractionDigits: stellen })
      : null;
  const teile: string[] = [];
  if (typeof s.levelCount === 'number') teile.push(`${s.levelCount} ${s.levelCount === 1 ? 'Geschoss' : 'Geschosse'}`);
  const flaeche = zahl(s.netFloorArea, 1);
  if (flaeche) teile.push(`${flaeche} m²`);
  if (typeof s.wallCount === 'number') teile.push(`${s.wallCount} Wände`);
  if (typeof s.windowCount === 'number') teile.push(`${s.windowCount} Fenster`);
  if (typeof s.doorCount === 'number') teile.push(`${s.doorCount} Türen`);
  if (typeof s.emitterCount === 'number' && s.emitterCount > 0) teile.push(`${s.emitterCount} Heizkörper`);
  const dach = (b?.levels ?? []).map((l) => l.roof).find(Boolean);
  if (dach && typeof dach.pitchDeg === 'number') {
    const form = ({ gable: 'Satteldach', monopitch: 'Pultdach' } as Record<string, string>)[dach.kind ?? ''] ?? 'Dachschräge';
    teile.push(`${form} ${zahl(dach.pitchDeg, 1)}°`);
  }
  return teile.join(' · ');
}
