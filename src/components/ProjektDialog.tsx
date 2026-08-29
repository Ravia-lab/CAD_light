/**
 * ProjektDialog — die Projektverwaltung als Oberfläche.
 *
 * Der Anwender misst seine Wohnung über mehrere Abende auf und hat nebenher
 * den Anbau der Eltern angefangen. Dafür reicht „letzter Stand" nicht: er
 * braucht eine Liste mit Namen, in der beides nebeneinander liegt und aus der
 * er umschalten kann, ohne die Seite neu zu laden und ohne einen Dateidialog.
 *
 * Drei Haltungen prägen den Dialog:
 *
 *  - **Gesagt wird, wo die Daten liegen.** Der Browser-Speicher ist bequem,
 *    aber er lebt nur in diesem Browser auf diesem Rechner. Das steht oben im
 *    Dialog, nicht in einer Anleitung, die niemand liest. Der Dateiweg steht
 *    gleichberechtigt daneben.
 *  - **Keine Frage, die immer mit „ja" beantwortet wird.** Beim Wechsel wird
 *    der aktuelle Stand gesichert, ohne zu fragen. Gefragt wird nur beim
 *    Löschen — dort ist „nein" eine echte Antwort.
 *  - **Der volle Speicher ist ein Bedienfall, kein Absturz.** Läuft er über,
 *    steht hier, was los ist, und daneben der Ausweg: Projekt als Datei
 *    sichern und aus dem Speicher nehmen.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cancelAutosave, relativeTime, saveNow } from '../lib/autosave';
import { buildRaviaExport, downloadJson, exportFilename } from '../lib/raviaExport';
import {
  benenneProjektUm,
  dupliziereProjekt,
  formatBytes,
  ladeProjekt,
  legeProjektAn,
  listeProjekte,
  loescheProjekt,
  setzeAktivesProjekt,
  speichereProjekt,
  speicherBericht,
  type ProjektKopf,
  type SpeicherBericht,
  type Vorschau,
} from '../lib/projectStore';
import { useBimStore } from '../store/useBimStore';

export default function ProjektDialog({
  aktivId,
  onAktivChange,
  onClose,
}: {
  aktivId: string | null;
  onAktivChange: (id: string | null) => void;
  onClose: () => void;
}) {
  const doc = useBimStore((s) => s.doc);
  const replaceDocument = useBimStore((s) => s.replaceDocument);
  const neuesDokument = useBimStore((s) => s.neuesDokument);
  const loadProject = useBimStore((s) => s.loadProject);
  const setStatus = useBimStore((s) => s.setStatus);

  const [projekte, setProjekte] = useState<ProjektKopf[]>([]);
  const [probleme, setProbleme] = useState<string[]>([]);
  const [bericht, setBericht] = useState<SpeicherBericht | null>(null);
  const [meldung, setMeldung] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [neuName, setNeuName] = useState('');
  const [umbenennen, setUmbenennen] = useState<{ id: string; wert: string } | null>(null);
  const dateiRef = useRef<HTMLInputElement>(null);

  const auffrischen = useCallback(() => {
    const liste = listeProjekte();
    setProjekte(liste.projekte);
    setProbleme(liste.probleme);
    setBericht(speicherBericht());
  }, []);

  useEffect(auffrischen, [auffrischen]);

  /** Escape schließt — wie in jedem anderen Dialog der Anwendung. */
  useEffect(() => {
    const zu = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', zu);
    return () => window.removeEventListener('keydown', zu);
  }, [onClose]);

  /**
   * Den aktuellen Stand in sein Projekt schreiben.
   *
   * Vor jedem Wechsel, jedem Anlegen und jedem Import. Eine ausstehende
   * entprellte Sicherung wird vorher abgebrochen: sie träfe sonst nach dem
   * Wechsel ein und trüge das alte Dokument in das neue Projekt.
   */
  const sichereAktuellen = useCallback((): boolean => {
    cancelAutosave();
    if (!aktivId) return true;
    const ergebnis = speichereProjekt(aktivId, doc);
    if (!ergebnis.ok) {
      setFehler(ergebnis.meldung);
      return false;
    }
    return true;
  }, [aktivId, doc]);

  const oeffne = (kopf: ProjektKopf) => {
    if (kopf.id === aktivId) {
      onClose();
      return;
    }
    if (!sichereAktuellen()) return;
    const geladen = ladeProjekt(kopf.id);
    if (!geladen.ok) {
      setFehler(geladen.meldung);
      auffrischen();
      return;
    }
    replaceDocument(geladen.doc, `Projekt „${geladen.doc.meta.name}“ geöffnet`);
    setzeAktivesProjekt(kopf.id);
    onAktivChange(kopf.id);
    // Der Zeiger der Sitzungssicherung muss sofort auf das neue Projekt
    // zeigen — sonst böte ein Neustart in der Zwischenzeit den alten Stand an.
    saveNow(geladen.doc, kopf.id);
    onClose();
  };

  const legeAn = () => {
    if (!sichereAktuellen()) return;
    const frisch = neuesDokument(neuName.trim() || 'Neues Projekt');
    const angelegt = legeProjektAn(frisch, frisch.meta.name);
    if (!angelegt.ok) {
      setFehler(angelegt.meldung);
      return;
    }
    // Der eindeutige Name kann von der Eingabe abweichen (Kollision) — dann
    // muss ihn das Dokument im Arbeitsspeicher übernehmen, nicht nur die Liste.
    replaceDocument(angelegt.doc, `Neues Projekt „${angelegt.kopf.name}“`);
    onAktivChange(angelegt.kopf.id);
    saveNow(angelegt.doc, angelegt.kopf.id);
    setNeuName('');
    // Nach dem Anlegen will man zeichnen, nicht die Liste ansehen — der
    // Dialog geht zu, die Statuszeile trägt die Bestätigung.
    onClose();
  };

  /** Den aktuellen, noch namenlosen Stand zu einem Projekt machen. */
  const uebernehmeStand = () => {
    const angelegt = legeProjektAn(doc);
    if (!angelegt.ok) {
      setFehler(angelegt.meldung);
      return;
    }
    replaceDocument(angelegt.doc, `Projekt „${angelegt.kopf.name}“ angelegt`);
    onAktivChange(angelegt.kopf.id);
    saveNow(angelegt.doc, angelegt.kopf.id);
    setMeldung(`Der aktuelle Stand liegt jetzt als Projekt „${angelegt.kopf.name}“ vor.`);
    auffrischen();
  };

  const bestaetigeUmbenennen = () => {
    if (!umbenennen) return;
    const { id, wert } = umbenennen;
    setUmbenennen(null);
    if (!wert.trim()) return;
    if (id === aktivId) {
      // Am offenen Projekt führt das Dokument im Arbeitsspeicher: würde nur
      // der Eintrag umbenannt, schriebe die nächste Sicherung den alten Namen
      // zurück.
      const umbenannt = { ...doc, meta: { ...doc.meta, name: wert.trim() } };
      replaceDocument(umbenannt, `Projekt heißt jetzt „${wert.trim()}“`);
      const ergebnis = speichereProjekt(id, umbenannt);
      if (!ergebnis.ok) setFehler(ergebnis.meldung);
    } else {
      const ergebnis = benenneProjektUm(id, wert);
      if (!ergebnis.ok) setFehler(ergebnis.meldung);
    }
    auffrischen();
  };

  const dupliziere = (kopf: ProjektKopf) => {
    if (kopf.id === aktivId && !sichereAktuellen()) return;
    const ergebnis = dupliziereProjekt(kopf.id);
    if (!ergebnis.ok) {
      setFehler(ergebnis.meldung);
      return;
    }
    // `dupliziereProjekt` setzt die Kopie aktiv — geöffnet ist aber weiter
    // das Original. Also zurückstellen, damit die Sicherung nicht in die
    // Kopie schreibt.
    setzeAktivesProjekt(aktivId);
    setMeldung(`Kopie „${ergebnis.kopf.name}“ angelegt.`);
    auffrischen();
  };

  /** Als Datei sichern — der Weg aus dem Browser heraus. */
  const alsDatei = (kopf: ProjektKopf): boolean => {
    const geladen = kopf.id === aktivId ? { ok: true as const, doc } : ladeProjekt(kopf.id);
    if (!geladen.ok) {
      setFehler(geladen.meldung);
      return false;
    }
    downloadJson(buildRaviaExport(geladen.doc), exportFilename(geladen.doc.meta.name));
    setMeldung(`„${kopf.name}“ wurde als Datei gesichert.`);
    return true;
  };

  const loesche = (kopf: ProjektKopf, gesichert: boolean) => {
    const frage = gesichert
      ? `„${kopf.name}“ aus dem Browser-Speicher entfernen?\n\nDie soeben gesicherte Datei bleibt erhalten.`
      : `„${kopf.name}“ endgültig löschen?\n\nDas Projekt liegt nur in diesem Browser — ohne Datei ist es danach weg.`;
    if (!confirm(frage)) return;
    loescheProjekt(kopf.id);
    if (kopf.id === aktivId) {
      // Das Dokument bleibt offen, gehört aber zu keinem Projekt mehr. Das
      // ist ehrlicher, als es mitzulöschen, während jemand darin zeichnet.
      onAktivChange(null);
      setzeAktivesProjekt(null);
      setMeldung(`„${kopf.name}“ entfernt. Der Grundriss ist weiter offen, gehört aber zu keinem Projekt mehr.`);
    } else {
      setMeldung(`„${kopf.name}“ entfernt.`);
    }
    auffrischen();
  };

  /** Sichern und entfernen in einem Zug — der Ausweg beim vollen Speicher. */
  const lagereAus = (kopf: ProjektKopf) => {
    if (alsDatei(kopf)) loesche(kopf, true);
  };

  const ausDatei = async (datei: File) => {
    if (!sichereAktuellen()) return;
    let ergebnis: { ok: boolean; message: string };
    try {
      ergebnis = loadProject(JSON.parse(await datei.text()));
    } catch {
      setFehler('Die Datei ließ sich nicht lesen — sie ist kein RaVia-CAD-Light-Projekt.');
      return;
    }
    if (!ergebnis.ok) {
      setFehler(ergebnis.message);
      return;
    }
    const geladen = useBimStore.getState().doc;
    const angelegt = legeProjektAn(geladen, geladen.meta.name);
    if (!angelegt.ok) {
      setFehler(angelegt.meldung);
      return;
    }
    replaceDocument(angelegt.doc, `Projekt „${angelegt.kopf.name}“ aus Datei geladen`);
    onAktivChange(angelegt.kopf.id);
    saveNow(angelegt.doc, angelegt.kopf.id);
    setMeldung(`„${angelegt.kopf.name}“ aus der Datei übernommen und als Projekt abgelegt.`);
    setStatus(ergebnis.message);
    auffrischen();
  };

  const belegung = useMemo(() => {
    if (!bericht) return 0;
    return Math.min(100, Math.round((bericht.belegtBytes / bericht.grenzeBytes) * 100));
  }, [bericht]);

  const eng = bericht ? bericht.passenNoch <= 1 : false;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-graphite-950/70 p-6 backdrop-blur-sm">
      <div className="panel flex max-h-full w-[720px] max-w-full flex-col overflow-hidden">
        <div className="flex shrink-0 items-start justify-between border-b border-white/[0.06] px-4 py-3">
          <div>
            <div className="text-[13px] font-semibold text-slate-100">Projekte</div>
            <div className="text-[10.5px] leading-relaxed text-slate-500">
              Mehrere Grundrisse nebeneinander, jederzeit umschaltbar. Die Liste liegt{' '}
              <span className="text-slate-400">nur in diesem Browser auf diesem Rechner</span> — wer die Arbeit aus der
              Hand geben, auf einen anderen Rechner mitnehmen oder sichern will, nimmt den Dateiweg.
            </div>
          </div>
          <button className="tool-btn" onClick={onClose} title="Schließen">
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4">
              <path d="M3 3l10 10M13 3L3 13" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Speicherstand */}
        {bericht && (
          <div className="shrink-0 border-b border-white/[0.06] px-4 py-2.5">
            <div className="flex items-baseline justify-between text-[10.5px]">
              <span className="text-slate-400">
                Browser-Speicher: {formatBytes(bericht.belegtBytes)} von etwa {formatBytes(bericht.grenzeBytes)} belegt
              </span>
              <span className={eng ? 'text-orange-300' : 'text-slate-500'}>
                {bericht.passenNoch > 0
                  ? `Platz für etwa ${bericht.passenNoch} weitere Projekte dieser Größe (${formatBytes(
                      bericht.richtwertBytes,
                    )})`
                  : 'Kein Platz mehr für ein weiteres Projekt dieser Größe'}
              </span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className={`h-full rounded-full ${eng ? 'bg-orange-400' : 'bg-accent/70'}`}
                style={{ width: `${Math.max(2, belegung)}%` }}
              />
            </div>
          </div>
        )}

        {(fehler || meldung || probleme.length > 0) && (
          <div className="shrink-0 space-y-1.5 border-b border-white/[0.06] px-4 py-2.5">
            {fehler && (
              <div className="rounded-lg bg-rose-500/10 px-3 py-2 text-[11px] leading-relaxed text-rose-200">
                {fehler}
              </div>
            )}
            {probleme.map((p) => (
              <div key={p} className="rounded-lg bg-orange-500/10 px-3 py-2 text-[11px] leading-relaxed text-orange-200">
                {p}
              </div>
            ))}
            {meldung && <div className="px-1 text-[11px] text-slate-400">{meldung}</div>}
          </div>
        )}

        {/* Liste */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {projekte.length === 0 ? (
            <div className="rounded-lg bg-white/[0.03] px-3 py-4 text-[11px] leading-relaxed text-slate-400">
              Noch kein Projekt abgelegt. Der Grundriss, an dem Sie gerade arbeiten, liegt in der Sitzungssicherung —
              die überlebt ein F5, aber sie kennt nur einen Stand. Legen Sie ihn als Projekt ab, dann bleibt er unter
              seinem Namen erhalten, auch wenn Sie zwischendurch etwas anderes zeichnen.
            </div>
          ) : (
            <ul className="space-y-1.5">
              {projekte.map((kopf) => (
                <li
                  key={kopf.id}
                  className={`rounded-lg px-3 py-2.5 ${
                    kopf.id === aktivId ? 'bg-accent/[0.09] ring-1 ring-accent/30' : 'bg-white/[0.03]'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <UmrissVorschau vorschau={kopf.vorschau} />
                    <div className="min-w-0 flex-1">
                      {umbenennen?.id === kopf.id ? (
                        <input
                          autoFocus
                          className="w-full rounded-md bg-white/[0.07] px-2 py-1 text-[12px] text-slate-100 outline-none"
                          value={umbenennen.wert}
                          onChange={(e) => setUmbenennen({ id: kopf.id, wert: e.target.value })}
                          onBlur={bestaetigeUmbenennen}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') bestaetigeUmbenennen();
                            if (e.key === 'Escape') setUmbenennen(null);
                          }}
                          spellCheck={false}
                        />
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="truncate text-[12.5px] font-medium text-slate-100">{kopf.name}</span>
                          {kopf.id === aktivId && (
                            <span className="chip shrink-0 bg-accent/15 px-1.5 text-accent">geöffnet</span>
                          )}
                        </div>
                      )}
                      <div className="mt-0.5 text-[10.5px] text-slate-500">
                        {mehrzahl(kopf.umfang.geschosse, 'Geschoss', 'Geschosse')} ·{' '}
                        {mehrzahl(kopf.umfang.raeume, 'Raum', 'Räume')} ·{' '}
                        {mehrzahl(kopf.umfang.waende, 'Wand', 'Wände')} ·{' '}
                        {kopf.umfang.flaeche.toFixed(1).replace('.', ',')} m²
                        {kopf.hatBild ? ' · mit Referenzbild' : ''}
                      </div>
                      <div className="mt-0.5 text-[10.5px] text-slate-600">
                        Geändert {relativeTime(kopf.geaendertAm)} · angelegt am{' '}
                        {new Date(kopf.angelegtAm).toLocaleDateString('de-DE')} ·{' '}
                        {formatBytes(kopf.zeichen * 2)}
                      </div>

                      <div className="mt-1.5 flex flex-wrap gap-1">
                        <button
                          className="chip bg-white/[0.06] px-2 text-slate-200 hover:bg-white/[0.12]"
                          onClick={() => oeffne(kopf)}
                        >
                          {kopf.id === aktivId ? 'Weiterarbeiten' : 'Öffnen'}
                        </button>
                        <button
                          className="chip px-2 text-slate-500 hover:text-slate-200"
                          onClick={() => setUmbenennen({ id: kopf.id, wert: kopf.name })}
                        >
                          Umbenennen
                        </button>
                        <button
                          className="chip px-2 text-slate-500 hover:text-slate-200"
                          onClick={() => dupliziere(kopf)}
                        >
                          Duplizieren
                        </button>
                        <button
                          className="chip px-2 text-slate-500 hover:text-slate-200"
                          title="Projektdatei herunterladen — der Stand, den Sie weitergeben oder archivieren können"
                          onClick={() => alsDatei(kopf)}
                        >
                          Als Datei sichern
                        </button>
                        <button
                          className="chip px-2 text-slate-500 hover:text-slate-200"
                          title="Als Datei sichern und danach aus dem Browser-Speicher nehmen — macht Platz, ohne etwas zu verlieren"
                          onClick={() => lagereAus(kopf)}
                        >
                          Auslagern
                        </button>
                        <button
                          className="chip px-2 text-slate-600 hover:text-rose-300"
                          onClick={() => loesche(kopf, false)}
                        >
                          Löschen
                        </button>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Fußzeile: anlegen, übernehmen, aus Datei laden */}
        <div className="shrink-0 space-y-2 border-t border-white/[0.06] px-4 py-3">
          <div className="flex items-center gap-2">
            <input
              className="min-w-0 flex-1 rounded-md bg-white/[0.05] px-2.5 py-1.5 text-[11.5px] text-slate-200 outline-none placeholder:text-slate-600 focus:bg-white/[0.08]"
              placeholder="Name des neuen Projekts, z. B. „Wohnung Erdgeschoss“"
              value={neuName}
              onChange={(e) => setNeuName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') legeAn();
              }}
              spellCheck={false}
            />
            <button
              className="shrink-0 rounded-lg bg-accent/15 px-3 py-1.5 text-[11px] font-medium text-accent transition-colors hover:bg-accent/25"
              onClick={legeAn}
              title="Legt ein leeres Projekt an. Der aktuelle Stand wird vorher gesichert."
            >
              Neues Projekt
            </button>
            {!aktivId && (
              <button
                className="shrink-0 rounded-lg bg-white/[0.06] px-3 py-1.5 text-[11px] text-slate-200 transition-colors hover:bg-white/[0.12]"
                onClick={uebernehmeStand}
                title="Den gerade offenen Grundriss unter einem Namen ablegen"
              >
                Aktuellen Stand ablegen
              </button>
            )}
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[10.5px] text-slate-600">
              Dateiweg: eine Projektdatei (.json) liegt außerhalb des Browsers und lässt sich mitnehmen.
            </span>
            <input
              ref={dateiRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const datei = e.target.files?.[0];
                if (datei) void ausDatei(datei);
                e.target.value = '';
              }}
            />
            <button
              className="chip px-2 text-slate-400 hover:text-slate-200"
              onClick={() => dateiRef.current?.click()}
            >
              Projekt aus Datei laden
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** „1 Geschoss“ statt „1 Geschosse“ — Zahlwörter, über die niemand stolpert. */
function mehrzahl(anzahl: number, einzahl: string, mehrere: string): string {
  return `${anzahl} ${anzahl === 1 ? einzahl : mehrere}`;
}

/**
 * Der Umriss als Vorschau.
 *
 * Bewusst kein Bildchen aus dem Editor: eine Bitmap kostet im Speicher das
 * Vielfache der Strichdaten und nimmt genau den Platz weg, um den es hier
 * geht. Die Wandachsen des untersten Geschosses erkennt man ohnehin besser.
 */
function UmrissVorschau({ vorschau }: { vorschau?: Vorschau }) {
  if (!vorschau || vorschau.linien.length < 4) {
    return (
      <div className="flex h-12 w-16 shrink-0 items-center justify-center rounded-md bg-white/[0.03] text-[9px] text-slate-600">
        leer
      </div>
    );
  }
  const segmente: number[][] = [];
  for (let i = 0; i + 3 < vorschau.linien.length; i += 4) {
    segmente.push(vorschau.linien.slice(i, i + 4));
  }
  return (
    <svg viewBox="-0.05 -0.05 1.1 1.1" className="h-12 w-16 shrink-0 rounded-md bg-white/[0.03]" aria-hidden="true">
      {/* Im Modell wächst y nach oben, in SVG nach unten — ohne die
          Spiegelung stünde jeder Grundriss auf dem Kopf. */}
      <g transform="translate(0,1) scale(1,-1)">
        {segmente.map(([x1, y1, x2, y2], i) => (
          <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#7dd3fc" strokeWidth={0.03} strokeLinecap="round" />
        ))}
      </g>
    </svg>
  );
}
