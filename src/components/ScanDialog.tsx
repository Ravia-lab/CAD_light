/**
 * Der Dialog „Mit RaVia Scan scannen".
 * ---------------------------------------------------------------------------
 * Verdrahtet nur — was er tut und warum, steht in `lib/scanDienst.ts`.
 *
 * Am Schreibtisch zeigt er den QR-Code; am iPhone/iPad stattdessen den Knopf
 * „In RaVia Scan öffnen" (dort gibt es keine zweite Kamera, die den eigenen
 * Bildschirm abfotografieren könnte), mit dem QR-Code als Ausweg für ein
 * anderes Gerät. In beiden Fällen fragt er alle zwei Sekunden den Stand ab
 * und lädt den Scan von selbst, sobald er da ist.
 *
 * Liegt schon ein Grundriss im Plan, fragt er vorher: ersetzen oder als
 * weiteres Geschoss dazulegen. Beides geht durch dieselbe Rückgängig-Kette
 * wie jede andere Handlung.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useBimStore } from '../store/useBimStore';
import { useScanDialog } from '../store/scanDialog';
import {
  ABFRAGE_MS,
  appLink,
  codeAnzeige,
  dienstBasis,
  gebaeudeHolen,
  istAppleMobil,
  kurzfassung,
  naechsterSchritt,
  rueckkehrUrl,
  ScanDienstFehler,
  scanEntfernen,
  sitzungAbbrechen,
  sitzungAnlegen,
  sitzungStand,
  statusText,
  tokenHolen,
  tokenMerken,
  tokenVergessen,
  uebernommenMelden,
  type Ablage,
  type ScanStatus,
} from '../lib/scanDienst';
import { qrMatrix, qrSvgPfad } from '../services/qrBild';

function ablage(): Ablage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Die Adresszeile anpassen, ohne die Seite neu zu laden. */
function adresseSetzen(href: string) {
  try {
    window.history.replaceState(window.history.state, '', href);
  } catch {
    // In einer Einbettung mit fremdem Ursprung kann das verweigert werden — dann eben nicht.
  }
}

interface Sitzungsdaten {
  id: string;
  token: string;
  code?: string;
  link?: string;
}

const KNOPF =
  'min-h-[44px] rounded-lg px-3.5 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50';

export default function ScanDialog() {
  const { offen, sitzungId: wiederaufnahme, beimWirt, schliessen } = useScanDialog();
  if (!offen) return null;
  // Durch ein Portal an den Körper des Dokuments — siehe `pruefungen/dialoge.ts`.
  return createPortal(
    beimWirt ? <BeimWirt onSchliessen={schliessen} /> : <EigenerDialog wiederaufnahme={wiederaufnahme} onSchliessen={schliessen} />,
    document.body,
  );
}

/** Eingebettet: RaVia öffnet seinen eigenen Dialog. Hier nur der Hinweis, wohin. */
function BeimWirt({ onSchliessen }: { onSchliessen: () => void }) {
  useEffect(() => {
    const t = setTimeout(onSchliessen, 6000);
    return () => clearTimeout(t);
  }, [onSchliessen]);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-14 z-50 flex justify-center px-4" data-pruef="scan-beim-wirt">
      <div className="pointer-events-auto rounded-lg bg-accent/15 px-4 py-2.5 text-[11.5px] text-slate-200 ring-1 ring-accent/30 backdrop-blur-sm">
        RaVia öffnet den Dialog „Gebäude scannen". Der Scan erscheint danach von selbst hier im Plan.
      </div>
    </div>
  );
}

function EigenerDialog({ wiederaufnahme, onSchliessen }: { wiederaufnahme: string | null; onSchliessen: () => void }) {
  const loadBuilding = useBimStore((s) => s.loadBuilding);
  const setStatus = useBimStore((s) => s.setStatus);
  const wandZahl = useBimStore((s) => Object.keys(s.doc.walls).length);
  const raumZahl = useBimStore((s) => Object.keys(s.doc.rooms).length);

  const basis = useMemo(() => dienstBasis(document.baseURI), []);
  const mobil = useMemo(() => istAppleMobil(navigator.userAgent, navigator.maxTouchPoints ?? 0), []);

  const [sitzung, setSitzung] = useState<Sitzungsdaten | null>(null);
  const [status, setStatusWert] = useState<ScanStatus | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [frage, setFrage] = useState<{ building: unknown; kurz: string } | null>(null);
  const [ergebnis, setErgebnis] = useState<string | null>(null);
  const [qrZeigen, setQrZeigen] = useState(!mobil);
  const [appHinweis, setAppHinweis] = useState(false);
  const [lauf, setLauf] = useState(0);
  /** Zählt jede Abfrage — ein unveränderter Stand stößt damit die nächste an. */
  const [puls, setPuls] = useState(0);

  const laedt = useRef(false);
  const fetchFn = useCallback((url: string, init?: RequestInit) => fetch(url, init), []);

  // --- Sitzung anlegen oder wieder aufnehmen ---------------------------------
  useEffect(() => {
    let vorbei = false;
    setFehler(null);
    setErgebnis(null);
    setFrage(null);
    setStatusWert(null);
    setSitzung(null);
    if (!basis) {
      setFehler(
        'Diese Fassung läuft ohne Server (Einzeldatei). Den Scan holt nur die Fassung auf dem Server ab — ' +
          'oder RaVia. Eine Scan-Datei lässt sich hier trotzdem öffnen (Reiter „Referenz").',
      );
      return;
    }
    if (wiederaufnahme && lauf === 0) {
      const gemerkt = tokenHolen(ablage(), wiederaufnahme);
      if (!gemerkt) {
        setFehler(
          'Der Scan gehört zu einer Sitzung, die dieser Browser nicht kennt — etwa, weil die App in einen ' +
            'anderen Browser zurückgesprungen ist oder der Speicher gelöscht wurde. Der Scan ist sicher auf dem ' +
            'Server; hier bitte einen neuen QR-Code erzeugen oder ihn in RaVia übernehmen.',
        );
        adresseSetzen(scanEntfernen(window.location.href));
        return;
      }
      setSitzung({ id: wiederaufnahme, ...gemerkt });
      setStatusWert('offen');
      return;
    }
    void sitzungAnlegen(basis, fetchFn)
      .then((s) => {
        if (vorbei) return;
        tokenMerken(ablage(), s);
        setSitzung({ id: s.id, token: s.readToken, code: s.pairingCode, link: s.pairingUrl });
        setStatusWert(s.status);
      })
      .catch((e: unknown) => {
        if (!vorbei) setFehler(e instanceof ScanDienstFehler ? e.message : String(e));
      });
    return () => {
      vorbei = true;
    };
  }, [basis, fetchFn, wiederaufnahme, lauf]);

  // --- Laden, wenn der Scan da ist -------------------------------------------
  const laden = useCallback(
    (building: unknown, merge: boolean) => {
      if (!basis || !sitzung) return;
      const r = loadBuilding(building, merge ? { merge: true } : undefined);
      setFrage(null);
      if (!r.ok) {
        laedt.current = false;
        setFehler(`Der Scan ließ sich nicht übernehmen: ${r.message}`);
        return;
      }
      setStatus(r.message);
      setErgebnis(r.message);
      void uebernommenMelden(basis, sitzung.id, sitzung.token, fetchFn)
        .catch(() => undefined)
        .finally(() => {
          tokenVergessen(ablage(), sitzung.id);
          adresseSetzen(scanEntfernen(window.location.href));
          setStatusWert('uebernommen');
          laedt.current = false;
        });
    },
    [basis, sitzung, loadBuilding, setStatus, fetchFn],
  );

  // --- Abfragen ----------------------------------------------------------------
  useEffect(() => {
    if (!basis || !sitzung || !status) return;
    const schritt = naechsterSchritt(status, laedt.current || frage !== null);
    if (schritt === 'fertig' || schritt === 'ende') return;
    let vorbei = false;

    if (schritt === 'laden') {
      laedt.current = true;
      void gebaeudeHolen(basis, sitzung.id, sitzung.token, fetchFn)
        .then((g) => {
          if (vorbei) return;
          const kurz = kurzfassung(g.building);
          if (wandZahl > 0) setFrage({ building: g.building, kurz });
          else laden(g.building, false);
        })
        .catch((e: unknown) => {
          laedt.current = false;
          if (!vorbei) setFehler(e instanceof ScanDienstFehler ? e.message : String(e));
        });
      return () => {
        vorbei = true;
      };
    }

    const t = setTimeout(() => {
      void sitzungStand(basis, sitzung.id, sitzung.token, fetchFn)
        .then((s) => {
          if (vorbei) return;
          setFehler(null);
          if (s.status === status) setPuls((p) => p + 1);
          else setStatusWert(s.status);
        })
        .catch((e: unknown) => {
          if (vorbei) return;
          if (e instanceof ScanDienstFehler && e.art === 'netz') {
            // Kurzer Netzaussetzer — weiter abfragen, aber sagen, was los ist.
            setFehler(e.message);
            setPuls((p) => p + 1);
            return;
          }
          setFehler(e instanceof ScanDienstFehler ? e.message : String(e));
          if (e instanceof ScanDienstFehler && (e.art === 'abgelaufen' || e.art === 'unbekannt' || e.art === 'fremd')) {
            tokenVergessen(ablage(), sitzung.id);
            adresseSetzen(scanEntfernen(window.location.href));
            setStatusWert('abgelaufen');
          }
        });
    }, ABFRAGE_MS);
    return () => {
      vorbei = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basis, sitzung, status, frage, puls]);

  // --- Abbrechen ---------------------------------------------------------------
  const abbrechen = () => {
    if (basis && sitzung && status !== 'uebernommen') {
      void sitzungAbbrechen(basis, sitzung.id, sitzung.token, fetchFn).catch(() => undefined);
      tokenVergessen(ablage(), sitzung.id);
    }
    adresseSetzen(scanEntfernen(window.location.href));
    onSchliessen();
  };

  const neu = () => {
    if (basis && sitzung) {
      void sitzungAbbrechen(basis, sitzung.id, sitzung.token, fetchFn).catch(() => undefined);
      tokenVergessen(ablage(), sitzung.id);
    }
    adresseSetzen(scanEntfernen(window.location.href));
    setLauf((n) => n + 1);
  };

  // --- App direkt öffnen (iPhone/iPad) -----------------------------------------
  const zurueck = sitzung ? rueckkehrUrl(window.location.href, sitzung.id) : null;
  const direkt = sitzung?.link && sitzung.code ? appLink(sitzung.link, sitzung.code, zurueck ?? undefined) : null;
  /*
   * Ein echter Link statt `location.href = …`: iOS öffnet die App über einen
   * angetippten Link zuverlässig, und eine Seite, die ihr eigenes Fenster
   * auf ein fremdes Schema umleitet, bleibt in manchen Browsern hängen.
   */
  const appOeffnen = () => {
    if (!direkt || !zurueck) return;
    // Damit ein Neuladen nach dem Rücksprung die Sitzung wiederfindet.
    adresseSetzen(zurueck);
    setAppHinweis(false);
    const vorher = Date.now();
    window.setTimeout(() => {
      // Ist die Seite nach 2,5 s noch sichtbar, hat sich die App nicht geöffnet.
      if (document.visibilityState === 'visible' && Date.now() - vorher < 4000) setAppHinweis(true);
    }, 2500);
  };

  const qr = useMemo(() => (sitzung?.link ? qrSvgPfad(qrMatrix(sitzung.link)) : null), [sitzung?.link]);
  const fertig = status === 'uebernommen';
  const amEnde = status === 'abgelaufen' || status === 'abgebrochen';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-graphite-950/70 p-4 backdrop-blur-sm" data-pruef="scan-dialog">
      <div
        className="panel max-h-full w-[400px] max-w-full overflow-auto p-5"
        role="dialog"
        aria-modal="true"
        aria-labelledby="scan-titel"
      >
        <div id="scan-titel" className="text-[13px] font-semibold text-slate-100">
          Mit RaVia Scan scannen
        </div>
        <p className="mt-1 text-[10.5px] leading-relaxed text-slate-500">
          iPhone oder iPad mit LiDAR. Wände, Öffnungen, Geschosse, Dachschätzung und gemessene Heizkörper kommen
          ohne Datei hierher.
        </p>

        {sitzung && !fertig && !amEnde && !frage && (
          <div className="mt-4 grid gap-3">
            {mobil && direkt && (
              <a
                href={direkt}
                className={`${KNOPF} flex items-center justify-center bg-accent/20 text-accent hover:bg-accent/30`}
                data-pruef="scan-app-oeffnen"
                onClick={appOeffnen}
              >
                In RaVia Scan öffnen
              </a>
            )}
            {appHinweis && (
              <p className="text-[11px] leading-relaxed text-orange-300" data-pruef="scan-app-fehlt">
                RaVia Scan hat sich nicht geöffnet. Ist die App installiert? In der Testphase kommt sie über
                TestFlight. Sonst den QR-Code mit einem anderen Gerät scannen.
              </p>
            )}
            {mobil && !qrZeigen && sitzung.link && (
              <button
                className="text-[11px] text-slate-400 underline decoration-dotted hover:text-slate-200"
                onClick={() => setQrZeigen(true)}
              >
                Auf einem anderen Gerät scannen (QR-Code)
              </button>
            )}
            {qrZeigen && qr && (
              <div className="justify-self-center rounded-lg bg-white p-2" data-pruef="scan-qr">
                <svg
                  viewBox={`0 0 ${qr.groesse} ${qr.groesse}`}
                  width={232}
                  height={232}
                  shapeRendering="crispEdges"
                  role="img"
                  aria-label="QR-Code zum Koppeln mit RaVia Scan"
                >
                  <rect width={qr.groesse} height={qr.groesse} fill="#fff" />
                  <path d={qr.pfad} fill="#000" />
                </svg>
              </div>
            )}
            {sitzung.code && (qrZeigen || !mobil) && (
              <div className="text-center">
                <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Kopplungscode</div>
                <div className="font-mono text-[17px] font-semibold tracking-[0.08em] text-slate-100" data-pruef="scan-code">
                  {codeAnzeige(sitzung.code)}
                </div>
              </div>
            )}
          </div>
        )}

        {frage && (
          <div className="mt-4 rounded-lg bg-white/[0.04] p-3" data-pruef="scan-frage">
            <div className="text-[11.5px] text-slate-200">Der Scan ist da.</div>
            {frage.kurz && <div className="mt-1 text-[11px] text-accent" data-pruef="scan-kurz">{frage.kurz}</div>}
            <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
              Im Plan liegt schon ein Grundriss ({wandZahl} Wände{raumZahl ? `, ${raumZahl} Räume` : ''}). Soll der
              Scan ihn ersetzen oder als weiteres Geschoss dazukommen? Beides lässt sich rückgängig machen.
            </p>
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <button
                className={`${KNOPF} bg-white/[0.06] text-slate-200 hover:bg-white/[0.1]`}
                data-pruef="scan-ersetzen"
                onClick={() => laden(frage.building, false)}
              >
                Ersetzen
              </button>
              <button
                className={`${KNOPF} bg-accent/20 text-accent hover:bg-accent/30`}
                data-pruef="scan-hinzu"
                onClick={() => laden(frage.building, true)}
              >
                Als Geschoss hinzufügen
              </button>
            </div>
          </div>
        )}

        <p className="mt-4 text-[11.5px] leading-relaxed text-slate-300" data-pruef="scan-status" aria-live="polite">
          {fertig && ergebnis
            ? `Fertig. ${ergebnis}`
            : status
              ? statusText(status, mobil && !qrZeigen)
              : !fehler
                ? 'Kopplung wird vorbereitet …'
                : ''}
        </p>
        {fehler && !fertig && (
          <p className="mt-2 rounded-md bg-rose-500/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-rose-300" data-pruef="scan-fehler">
            {fehler}
          </p>
        )}

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {(amEnde || (fehler && !sitzung)) && basis && (
            <button className={`${KNOPF} bg-white/[0.06] text-slate-200 hover:bg-white/[0.1]`} data-pruef="scan-neu" onClick={neu}>
              Neuer QR-Code
            </button>
          )}
          {fertig ? (
            <button
              className={`${KNOPF} bg-accent/20 text-accent hover:bg-accent/30`}
              data-pruef="scan-schliessen"
              onClick={onSchliessen}
            >
              Schließen
            </button>
          ) : (
            <button
              className={`${KNOPF} bg-white/[0.06] text-slate-300 hover:bg-white/[0.1]`}
              data-pruef="scan-abbrechen"
              onClick={abbrechen}
            >
              Abbrechen
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
