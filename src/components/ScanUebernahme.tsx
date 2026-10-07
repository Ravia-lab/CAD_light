/**
 * Den LiDAR-Scan übernehmen — als Datei.
 * ---------------------------------------------------------------------------
 * **Warum es diesen Block gibt.** Ein Gebäudescan aus **RaVia Scan** (iPhone,
 * LiDAR/RoomPlan) kam bis 1.62.0 ausschließlich über die Einbettung herein:
 * RaVia prüft ihn und reicht ihn mit `loadBuilding` durch. Das bleibt der
 * Regelfall und der Weg, für den die Prüfung spricht.
 *
 * Nur setzt er voraus, dass RaVia daneben läuft. Beim Vorführen, beim
 * Nachsehen eines Scans, den ein Monteur geschickt hat, und beim Arbeiten am
 * Schreibtisch ist das nicht so — und dann liegt da eine Datei, die dieses
 * Programm lesen kann und nicht annahm.
 *
 * Gelesen wird **derselbe** Import (`importBuildingModel`) wie über die
 * Einbettung; ein zweiter Weg, der anders rechnet, wäre die schlechtere
 * Antwort auf eine Bequemlichkeit.
 *
 * Der **Beispielscan** liegt der Anwendung bei (`beispiele/…`). Er ist eine
 * echte Testaufnahme im Format `ravia.building` 1.3.0 — mit Gerät,
 * Aufnahmezeit, Nordrichtung aus dem Kompass, gemessenen Heizkörpern und der
 * Liste dessen, was die App geschätzt hat. Aus der Einzeldatei-Fassung heraus
 * gibt es ihn nicht; dann sagt der Block das, statt einen Fehler zu zeigen.
 */

import { useRef, useState } from 'react';
import { useBimStore } from '../store/useBimStore';
import { scanStarten } from '../store/scanDialog';

const BEISPIEL = 'beispiele/lidar-scan-beispiel.json';

export default function ScanUebernahme() {
  const loadBuilding = useBimStore((s) => s.loadBuilding);
  const setStatus = useBimStore((s) => s.setStatus);
  const wandZahl = useBimStore((s) => Object.keys(s.doc.walls).length);
  const inputRef = useRef<HTMLInputElement>(null);
  const [meldung, setMeldung] = useState<{ ok: boolean; text: string } | null>(null);
  const [laeuft, setLaeuft] = useState(false);

  /** Ein Scan ersetzt das Modell — bei gezeichneten Wänden wird gefragt. */
  const darfErsetzen = (): boolean =>
    wandZahl === 0 ||
    confirm(
      'Der Gebäudescan ersetzt das aktuelle Modell. Fortfahren?\n\n' +
        'Rückgängig (Strg+Z) holt den jetzigen Stand zurück.',
    );

  const uebernehmen = (text: string) => {
    let daten: unknown;
    try {
      daten = JSON.parse(text);
    } catch {
      setMeldung({ ok: false, text: 'Die Datei ist kein lesbares JSON.' });
      return;
    }
    const ergebnis = loadBuilding(daten);
    setMeldung({ ok: ergebnis.ok, text: ergebnis.message });
    setStatus(ergebnis.message);
  };

  const beispiel = async () => {
    if (!darfErsetzen()) return;
    setLaeuft(true);
    try {
      // Relativ zur Anwendung, damit es unter jedem Basispfad stimmt.
      const antwort = await fetch(new URL(BEISPIEL, document.baseURI).toString());
      if (!antwort.ok) throw new Error(String(antwort.status));
      uebernehmen(await antwort.text());
    } catch {
      setMeldung({
        ok: false,
        text:
          'Der Beispielscan liegt neben der Anwendung und ist hier nicht erreichbar — ' +
          'in der Einzeldatei-Fassung gibt es ihn nicht. Eine eigene Scan-Datei lässt sich trotzdem öffnen.',
      });
    } finally {
      setLaeuft(false);
    }
  };

  return (
    <div className="mt-4">
      <div className="label-xs mb-2">LiDAR-Scan übernehmen</div>
      <div className="rounded-xl bg-graphite-900/60 p-3" style={{ border: '1px solid rgba(148,163,184,0.14)' }}>
        <p className="text-[10.5px] leading-relaxed text-slate-400">
          Aufnahme aus <b className="text-slate-300">RaVia Scan</b> (iPhone, LiDAR). Übernommen werden Wände,
          Öffnungen, Geschosse, die Dachschätzung und gemessene Heizkörper — samt der Liste dessen, was die App
          dabei geschätzt hat. Direkt per QR-Code ohne Datei, oder eine Scan-Datei öffnen.
        </p>
        <div className="mt-2.5 flex flex-wrap gap-2">
          <button
            className="chip bg-accent/25 text-accent"
            data-pruef="scan-starten"
            onClick={() => scanStarten()}
          >
            Mit RaVia Scan scannen (QR)
          </button>
          <button
            className="chip bg-accent/15 text-accent"
            data-pruef="scan-datei"
            onClick={() => inputRef.current?.click()}
          >
            Scan-Datei öffnen
          </button>
          <button
            className="chip text-slate-300 hover:text-slate-100"
            data-pruef="scan-beispiel"
            disabled={laeuft}
            onClick={() => void beispiel()}
          >
            {laeuft ? 'wird geladen …' : 'Beispielscan laden'}
          </button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const datei = e.target.files?.[0];
            e.target.value = '';
            if (!datei) return;
            if (!darfErsetzen()) return;
            void datei.text().then(uebernehmen);
          }}
        />
        {meldung && (
          <div
            className={`mt-2.5 rounded-md px-2.5 py-1.5 text-[10px] leading-relaxed ${
              meldung.ok ? 'bg-accent/10 text-slate-300' : 'bg-rose-500/10 text-rose-300'
            }`}
            data-pruef="scan-meldung"
          >
            {meldung.text}
          </div>
        )}
      </div>
    </div>
  );
}
