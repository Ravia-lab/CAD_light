/**
 * Prüfblock „Mit RaVia Scan scannen" (1.74.0).
 * ---------------------------------------------------------------------------
 * **Der Auftrag (07.10.2026):** „Funktion einbauen, wo man direkt zum RaVia
 * Scan kommt und diesen per QR öffnen kann und auch dann zurück bekommt vom
 * Scan."
 *
 * Geprüft wird `lib/scanDienst.ts` ohne Browser und ohne Server: `fetch` ist
 * nachgebaut und protokolliert jede Anfrage. Die Sollwerte stammen aus dem
 * Vertrag (Auftrag an RaVia, Abschnitt Schnittstelle) und aus der App RaVia
 * Scan (`PairingLink.swift`: erlaubte Server, Schema `raviascan://`), nicht
 * aus einem Lauf. Jede Sperre hat ihre Gegenprobe.
 */

import type { CheckFn } from './typ';
import {
  appLink,
  codeAnzeige,
  dienstBasis,
  gebaeudeHolen,
  istAppleMobil,
  kopplungslinkGueltig,
  kurzfassung,
  naechsterSchritt,
  rueckkehrErlaubt,
  rueckkehrUrl,
  ScanDienstFehler,
  scanEntfernen,
  sitzungAbbrechen,
  sitzungAnlegen,
  sitzungAusUrl,
  sitzungStand,
  tokenHolen,
  tokenMerken,
  tokenVergessen,
  uebernommenMelden,
  type Ablage,
  type FetchFn,
} from '../../src/lib/scanDienst';
import { qrMatrix, qrSvgPfad } from '../../src/services/qrBild';
import {
  registriereWirtMelder,
  scanBeimWirtAnfordern,
  setzeWirtFaehigkeiten,
  wirtKannScannen,
  wirtZuruecksetzen,
} from '../../src/lib/wirt';
import { SCAN_DIENST_AKTIV, scanVerfuegbar, scanWeg } from '../../src/lib/scanZugang';
import { readFileSync } from 'node:fs';

const LINK = 'https://test.ravia-tech.de/scan/p/K7QX-M2PA-9RTF';
const BASIS = 'https://ravia-tech.de/Cad_light/scan-dienst/';

interface Aufruf {
  url: string;
  method: string;
  headers: Record<string, string>;
  credentials?: string;
}

function json(status: number, daten: unknown): Response {
  return new Response(JSON.stringify(daten), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Ein nachgebauter Dienst: Antworten der Reihe nach, jede Anfrage protokolliert. */
function attrappe(antworten: (Response | Error)[]): { fetchFn: FetchFn; aufrufe: Aufruf[] } {
  const aufrufe: Aufruf[] = [];
  const fetchFn: FetchFn = async (url, init) => {
    const h: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (h[k] = v));
    aufrufe.push({ url, method: init?.method ?? 'GET', headers: h, credentials: init?.credentials });
    const a = antworten.shift();
    if (!a) throw new Error('keine Antwort mehr vorbereitet');
    if (a instanceof Error) throw a;
    return a;
  };
  return { fetchFn, aufrufe };
}

async function fehlerArt(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'kein Fehler';
  } catch (e) {
    return e instanceof ScanDienstFehler ? e.art : `fremd: ${String(e)}`;
  }
}

export async function pruefeScandienst(check: CheckFn): Promise<void> {
  // =========================================================================
  // 1 · Adressen
  // =========================================================================
  check('Dienst liegt neben der Anwendung', dienstBasis('https://ravia-tech.de/Cad_light/') ?? 'null', BASIS);
  check('… auch mit index.html und Abfrage', dienstBasis('https://ravia-tech.de/Cad_light/index.html?x=1') ?? 'null', BASIS);
  check('Einzeldatei (file://) hat keinen Dienst', dienstBasis('file:///C:/Users/x/RaVia-CAD-Light.html') ?? 'null', 'null');

  check('Kopplungslink auf test.ravia-tech.de gilt', kopplungslinkGueltig(LINK), true);
  check('Gegenprobe: http statt https', kopplungslinkGueltig(LINK.replace('https', 'http')), false);
  check('Gegenprobe: fremder Server', kopplungslinkGueltig('https://ravia-tech.de.evil.com/scan/p/K7QX-M2PA-9RTF'), false);
  check('Gegenprobe: Port', kopplungslinkGueltig('https://test.ravia-tech.de:8443/scan/p/K7QX-M2PA-9RTF'), false);
  check('Gegenprobe: Benutzer im Link', kopplungslinkGueltig('https://a@test.ravia-tech.de/scan/p/K7QX-M2PA-9RTF'), false);
  check('Gegenprobe: falscher Pfad', kopplungslinkGueltig('https://test.ravia-tech.de/login?next=/scan/p/K7QX'), false);

  /*
   * appLink, von Hand: Schema raviascan, Code groß, Host aus dem
   * Kopplungslink, return URL-kodiert (: → %3A, / → %2F, ? → %3F, = → %3D).
   */
  const zurueck = 'https://ravia-tech.de/Cad_light/?scan=s-123';
  check(
    'App-Link mit Rücksprung',
    appLink(LINK, 'k7qx-m2pa-9rtf', zurueck) ?? '',
    'raviascan://pair?code=K7QX-M2PA-9RTF&host=test.ravia-tech.de&return=https%3A%2F%2Fravia-tech.de%2FCad_light%2F%3Fscan%3Ds-123',
  );
  check(
    'Gegenprobe: Rücksprung auf fremden Server fällt weg',
    appLink(LINK, 'K7QX-M2PA-9RTF', 'https://evil.example/') ?? '',
    'raviascan://pair?code=K7QX-M2PA-9RTF&host=test.ravia-tech.de',
  );
  check('Gegenprobe: kein App-Link zu einem ungültigen Kopplungslink', appLink('https://evil.example/scan/p/K7QX-M2PA-9RTF', 'K7QX-M2PA-9RTF') ?? 'null', 'null');
  check('Rücksprung nur https', rueckkehrErlaubt('http://ravia-tech.de/Cad_light/'), false);

  check('?scan= anhängen, Rest bleibt', rueckkehrUrl('https://ravia-tech.de/Cad_light/?lang=de#plan', 's-1'), 'https://ravia-tech.de/Cad_light/?lang=de&scan=s-1#plan');
  check('?scan= ersetzen statt verdoppeln', rueckkehrUrl('https://ravia-tech.de/Cad_light/?scan=alt', 'neu-1'), 'https://ravia-tech.de/Cad_light/?scan=neu-1');
  check('Sitzung aus der Adresse', sitzungAusUrl('https://ravia-tech.de/Cad_light/?lang=de&scan=s-123#x') ?? '', 's-123');
  check('Gegenprobe: zu kurze Kennung', sitzungAusUrl('https://ravia-tech.de/Cad_light/?scan=ab') ?? 'null', 'null');
  check('Gegenprobe: Sitzung mit Schadzeichen', sitzungAusUrl('https://ravia-tech.de/Cad_light/?scan=%3Cscript%3E') ?? 'null', 'null');
  check('?scan= entfernen', scanEntfernen('https://ravia-tech.de/Cad_light/?lang=de&scan=s-1#plan'), 'https://ravia-tech.de/Cad_light/?lang=de#plan');

  check('iPhone erkannt', istAppleMobil('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 5), true);
  check('iPad (meldet sich als Mac, mit Touch) erkannt', istAppleMobil('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5), true);
  check('Gegenprobe: Mac ohne Touch', istAppleMobil('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0), false);
  check('Gegenprobe: Android', istAppleMobil('Mozilla/5.0 (Linux; Android 14)', 5), false);

  check('Code in Vierergruppen', codeAnzeige('k7qxm2pa9rtf'), 'K7QX-M2PA-9RTF');

  // =========================================================================
  // 2 · Das Lesetoken überlebt den Rücksprung
  // =========================================================================
  {
    const m = new Map<string, string>();
    const ablage: Ablage = {
      getItem: (k) => m.get(k) ?? null,
      setItem: (k, v) => void m.set(k, v),
      removeItem: (k) => void m.delete(k),
    };
    tokenMerken(ablage, { id: 's-1', status: 'offen', pairingCode: 'K7QX-M2PA-9RTF', pairingUrl: LINK, readToken: 'geheim' });
    check('Token wiedergefunden', tokenHolen(ablage, 's-1')?.token ?? '', 'geheim');
    check('… mit Kopplungslink', tokenHolen(ablage, 's-1')?.link ?? '', LINK);
    check('Gegenprobe: fremde Sitzung', tokenHolen(ablage, 's-2') === null, true);
    tokenVergessen(ablage, 's-1');
    check('Nach Übernahme vergessen', tokenHolen(ablage, 's-1') === null, true);
    const gesperrt: Ablage = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('SecurityError');
      },
      removeItem: () => {
        throw new Error('SecurityError');
      },
    };
    let wurf = false;
    try {
      tokenMerken(gesperrt, { id: 's', status: 'offen', pairingCode: 'X', pairingUrl: LINK, readToken: 't' });
      tokenHolen(gesperrt, 's');
      tokenVergessen(gesperrt, 's');
    } catch {
      wurf = true;
    }
    check('Gesperrter Speicher (privates Fenster) wirft nicht', wurf, false);
  }

  // =========================================================================
  // 3 · Der Ablauf gegen den nachgebauten Dienst
  // =========================================================================
  {
    const building = JSON.parse(readFileSync('public/beispiele/lidar-scan-beispiel.json', 'utf8')) as unknown;
    const { fetchFn, aufrufe } = attrappe([
      json(201, { id: 's-abc', status: 'offen', pairingCode: 'K7QX-M2PA-9RTF', pairingUrl: LINK, readToken: 'tok-1', expiresAt: '2026-10-08T20:00:00Z' }),
      json(200, { id: 's-abc', status: 'gekoppelt' }),
      json(200, { id: 's-abc', status: 'eingegangen', captureCount: 1 }),
      json(200, { captureId: 'c-1', receivedAt: '2026-10-07T19:00:00Z', building }),
      json(200, { id: 's-abc', status: 'uebernommen' }),
    ]);
    const s = await sitzungAnlegen(BASIS, fetchFn);
    check('Sitzung angelegt', s.id, 's-abc');
    check('Anlegen: POST auf …/sessions', `${aufrufe[0].method} ${aufrufe[0].url}`, `POST ${BASIS}sessions`);
    check('Anlegen ohne Cookies (credentials: omit)', aufrufe[0].credentials ?? '', 'omit');
    const a1 = await sitzungStand(BASIS, s.id, s.readToken, fetchFn);
    const a2 = await sitzungStand(BASIS, s.id, s.readToken, fetchFn);
    check('Stand gekoppelt', a1.status, 'gekoppelt');
    check('Stand eingegangen', a2.status, 'eingegangen');
    check('Abfrage trägt das Lesetoken', aufrufe[1].headers['x-scan-read-token'] ?? '', 'tok-1');
    const g = await gebaeudeHolen(BASIS, s.id, s.readToken, fetchFn);
    check('Gebäude geholt: …/sessions/s-abc/building', aufrufe[3].url, `${BASIS}sessions/s-abc/building`);
    /*
     * Kurzfassung, von Hand aus `summary` der Beispieldatei: 1 Geschoss,
     * netFloorArea 111,34 → „111,3", 39 Wände, 10 Fenster, 5 Türen,
     * 4 Heizkörper, Dach gable 36,5°.
     */
    check(
      'Kurzfassung des Beispielscans',
      kurzfassung(g.building),
      '1 Geschoss · 111,3 m² · 39 Wände · 10 Fenster · 5 Türen · 4 Heizkörper · Satteldach 36,5°',
    );
    await uebernommenMelden(BASIS, s.id, s.readToken, fetchFn);
    check('Übernahme gemeldet: POST …/consume', `${aufrufe[4].method} ${aufrufe[4].url}`, `POST ${BASIS}sessions/s-abc/consume`);
  }

  // =========================================================================
  // 4 · Fehler, wie der Anwender sie liest
  // =========================================================================
  {
    const html404 = new Response('<html>404</html>', { status: 404, headers: { 'Content-Type': 'text/html' } });
    check('Weiterleitung fehlt (404 als Seite)', await fehlerArt(sitzungAnlegen(BASIS, attrappe([html404]).fetchFn)), 'nicht-eingerichtet');
    const html502 = new Response('<html>502</html>', { status: 502, headers: { 'Content-Type': 'text/html' } });
    check('Dienst steht (502)', await fehlerArt(sitzungAnlegen(BASIS, attrappe([html502]).fetchFn)), 'nicht-eingerichtet');
    check('Kein Netz', await fehlerArt(sitzungAnlegen(BASIS, attrappe([new TypeError('Failed to fetch')]).fetchFn)), 'netz');
    check('Falsches Token (401)', await fehlerArt(sitzungStand(BASIS, 's', 'x', attrappe([json(401, { error: 'bad_token' })]).fetchFn)), 'fremd');
    check('Sitzung weg (404 JSON)', await fehlerArt(sitzungStand(BASIS, 's', 'x', attrappe([json(404, { error: 'unknown_session' })]).fetchFn)), 'unbekannt');
    check('Abgelaufen (410)', await fehlerArt(sitzungStand(BASIS, 's', 'x', attrappe([json(410, { error: 'expired' })]).fetchFn)), 'abgelaufen');
    check('Bremse (429)', await fehlerArt(sitzungAnlegen(BASIS, attrappe([json(429, { error: 'rate_limited' })]).fetchFn)), 'bremse');
    check(
      'Gegenprobe: Dienst liefert Link auf fremden Server — kein QR-Code',
      await fehlerArt(
        sitzungAnlegen(
          BASIS,
          attrappe([json(201, { id: 's-1', status: 'offen', pairingCode: 'K7QX-M2PA-9RTF', pairingUrl: 'https://evil.example/scan/p/K7QX-M2PA-9RTF', readToken: 't' })]).fetchFn,
        ),
      ),
      'antwort',
    );
    check(
      'Gegenprobe: Antwort ohne Lesetoken',
      await fehlerArt(sitzungAnlegen(BASIS, attrappe([json(201, { id: 's-1', status: 'offen', pairingCode: 'K7QX-M2PA-9RTF', pairingUrl: LINK })]).fetchFn)),
      'antwort',
    );
    check(
      'Gegenprobe: unbekannter Status',
      await fehlerArt(sitzungStand(BASIS, 's', 't', attrappe([json(200, { id: 's', status: 'irgendwas' })]).fetchFn)),
      'antwort',
    );
    const { fetchFn, aufrufe } = attrappe([json(200, { id: 's', status: 'abgebrochen' })]);
    await sitzungAbbrechen(BASIS, 's', 't', fetchFn);
    check('Abbrechen: DELETE …/sessions/s', `${aufrufe[0].method} ${aufrufe[0].url}`, `DELETE ${BASIS}sessions/s`);
  }

  // =========================================================================
  // 5 · Ablauf-Entscheidungen
  // =========================================================================
  check('offen → warten', naechsterSchritt('offen', false), 'warten');
  check('gekoppelt → warten', naechsterSchritt('gekoppelt', false), 'warten');
  check('eingegangen → laden', naechsterSchritt('eingegangen', false), 'laden');
  check('eingegangen, lädt schon → warten (nicht doppelt laden)', naechsterSchritt('eingegangen', true), 'warten');
  check('uebernommen → fertig', naechsterSchritt('uebernommen', false), 'fertig');
  check('abgelaufen → ende', naechsterSchritt('abgelaufen', false), 'ende');

  // =========================================================================
  // 6 · QR-Code
  // =========================================================================
  {
    /*
     * Der Link hat 48 Zeichen (8 „https://" + 18 Server + 8 „/scan/p/"
     * + 14 Code), Byte-Modus. Fassung 3 fasst bei Korrektur M 42 Byte — zu
     * wenig; Fassung 4 fasst 62. Fassung 4 hat 17 + 4·4 = 33
     * Module je Seite, mit Ruhezone 4 je Seite also 41.
     */
    check('Link hat 48 Zeichen', LINK.length, 48);
    const m = qrMatrix(LINK);
    check('QR Fassung 4: 33 Module', m.length, 33);
    const svg = qrSvgPfad(m);
    check('Mit Ruhezone 41 Einheiten', svg.groesse, 41);
    // Die drei Suchmuster: 7×7, Rand dunkel, Ring hell, Kern 3×3 dunkel.
    const muster = (r0: number, c0: number) => {
      for (let r = 0; r < 7; r++)
        for (let c = 0; c < 7; c++) {
          const rand = r === 0 || r === 6 || c === 0 || c === 6;
          const kern = r >= 2 && r <= 4 && c >= 2 && c <= 4;
          if (m[r0 + r][c0 + c] !== (rand || kern)) return false;
        }
      return true;
    };
    check('Suchmuster oben links', muster(0, 0), true);
    check('Suchmuster oben rechts', muster(0, 26), true);
    check('Suchmuster unten links', muster(26, 0), true);
    check('Gegenprobe: unten rechts kein Suchmuster', muster(26, 26), false);
    // Taktmuster in Zeile 6 zwischen den Suchmustern: abwechselnd, dunkel beginnend.
    let takt = true;
    for (let c = 8; c <= 24; c++) if (m[6][c] !== (c % 2 === 0)) takt = false;
    check('Taktmuster Zeile 6', takt, true);
    const dunkel = m.flat().filter(Boolean).length;
    const imPfad = [...svg.pfad.matchAll(/h(\d+)/g)].reduce((s, x) => s + Number(x[1]), 0);
    check('Pfad deckt genau die dunklen Module', imPfad, dunkel);
  }

  // =========================================================================
  // 7 · Eingebettet: der Wirt übernimmt
  // =========================================================================
  {
    wirtZuruecksetzen();
    check('Ohne Wirt: eigener Dialog', scanBeimWirtAnfordern(), false);
    let gesendet = '';
    registriereWirtMelder((type) => {
      gesendet = type;
      return 1;
    });
    check('Wirt ohne Fähigkeit: eigener Dialog', scanBeimWirtAnfordern(), false);
    check('Fähigkeit wird übernommen', setzeWirtFaehigkeiten({ scan: true }).scan, true);
    check('Wirt mit Fähigkeit übernimmt', scanBeimWirtAnfordern(), true);
    check('… mit dem Ereignis scanRequested', gesendet, 'scanRequested');
    registriereWirtMelder(() => 0);
    check('Gegenprobe: Wirt meldet Fähigkeit, hört aber nicht zu → eigener Dialog', scanBeimWirtAnfordern(), false);
    check('Gegenprobe: „scan: 1" ist kein true', setzeWirtFaehigkeiten({ scan: 1 }).scan, false);
    wirtZuruecksetzen();
  }

  // =========================================================================
  // 8 · Scan-Dienst abgeschaltet (TD-32): ohne Dienst und ohne Wirt kein Dialog
  // =========================================================================
  {
    wirtZuruecksetzen();
    check('Scan-Dienst ist ohne VITE_SCAN_DIENST aus', SCAN_DIENST_AKTIV, false);
    check('Ohne Dienst und Wirt: kein Weg zum Scan', scanVerfuegbar(false), false);
    check('Ohne Dienst und Wirt: Weg „aus" (kein Dialog)', scanWeg(false), 'aus');
    check('Mit Dienst: eigener Dialog', scanWeg(true), 'eigen');
    check('Mit Dienst ist der Scan verfügbar', scanVerfuegbar(true), true);
    let gemeldet = 0;
    registriereWirtMelder(() => {
      gemeldet++;
      return 1;
    });
    setzeWirtFaehigkeiten({ scan: true });
    check('Wirt kann scannen', wirtKannScannen(), true);
    check('Mit Wirt ist der Scan auch ohne Dienst da', scanVerfuegbar(false), true);
    check('Mit Wirt und ohne Dienst: der Wirt übernimmt', scanWeg(false), 'wirt');
    check('… und bekommt die Anforderung', gemeldet, 1);
    wirtZuruecksetzen();
    check('Gegenprobe: nach dem Zurücksetzen kein Wirt', wirtKannScannen(), false);
  }
}
