/**
 * AufmassPanel — die Handgriffe nach einem Import.
 *
 * Ein eingelesener Grundriss ist fast fertig, aber eben nur fast: die Wände
 * stehen ein paar Grad schief, und an ein paar Stellen hört eine Wand auf,
 * ohne die nächste zu erreichen. Beides von Hand zu richten geht — es ist nur
 * mühsam und fehleranfällig, und niemand tut es gern zweimal.
 *
 * Deshalb hier Knöpfe statt einer Anleitung:
 *
 *  · **Spiegeln**, wenn der Plan seitenverkehrt hereinkam. Das passiert
 *    häufiger, als man denkt — ein von der Rückseite abfotografierter Plan,
 *    ein Scan mit vertauschter Achse — und es fällt erst auf, wenn man mit dem
 *    Aufmaß in der Wohnung steht und links rechts ist. Bis dahin war jede
 *    Eingabe darauf verloren.
 *  · **Wände begradigen** zieht alles auf die Achsen, was nah genug dran ist,
 *    und lässt in Ruhe, was es nicht ist.
 *  · **Für jede Lücke** die Frage, die nur der Mensch beantworten kann: war
 *    dort eine Wand, eine Tür oder ein Durchgang? Das Programm weiß es nicht,
 *    und raten wäre hier besonders schädlich — eine Tür, die keine ist, kostet
 *    in der Heizlast dreimal so viel wie die Wand, die sie ersetzt.
 *
 * Die Zeile zu einer Lücke ist anklickbar und rückt sie in den Blick. Das ist
 * der Unterschied zwischen einer Liste und einem Werkzeug: man liest nicht
 * „irgendwo fehlt eine Wand", sondern steht davor.
 */

import { useMemo, useState } from 'react';
import type { BimDocument } from '../types/bim';
import { begradige } from '../lib/begradigen';
import { findeLuecken } from '../lib/luecken';
import type { LueckenSchluss } from '../lib/luecken';
import { useBimStore } from '../store/useBimStore';
import { AUSNAHME_LABELS, befundSatz, type Hoehenbefund } from '../lib/wandhoehen';

const SCHLUSS: { art: LueckenSchluss; label: string; titel: string }[] = [
  { art: 'wand', label: 'Wand', titel: 'Dort steht eine Wand — der Scan hat sie nur nicht gesehen.' },
  { art: 'tuer', label: 'Tür', titel: 'Dort ist eine Tür. Die Öffnung füllt die Lücke, höchstens 1,26 m breit.' },
  { art: 'durchgang', label: 'Durchgang', titel: 'Wanddurchbruch ohne Tür — die Öffnung ist so breit wie die Lücke.' },
  { art: 'fenster', label: 'Fenster', titel: 'Dort sitzt ein Fenster, Brüstung 90 cm.' },
];

/**
 * Die Lagen, die zur Auswahl stehen.
 *
 * Bewusst eine kurze Liste und kein Zahlenfeld: Wer „7. OG" eintippt, bekommt
 * sieben erfundene Geschosse, die niemand aufgemessen hat. Für das Wohnhaus,
 * um das es hier geht, reicht Keller bis drittes Obergeschoss — und wer höher
 * hinaus will, legt die Geschosse einzeln an und weiß dann, was er tut.
 */
const LAGEN: { ordnung: number; label: string }[] = [
  { ordnung: -1, label: 'KG' },
  { ordnung: 0, label: 'EG' },
  { ordnung: 1, label: '1. OG' },
  { ordnung: 2, label: '2. OG' },
  { ordnung: 3, label: '3. OG' },
];

export default function AufmassPanel() {
  const doc = useBimStore((s) => s.doc);
  const begradigeWaende = useBimStore((s) => s.begradigeWaende);
  const spiegleGrundriss = useBimStore((s) => s.spiegleGrundriss);
  const ordneGrundrissZu = useBimStore((s) => s.ordneGrundrissZu);
  const schliesseLuecke = useBimStore((s) => s.schliesseLuecke);
  const bestaetigeWandstaerken = useBimStore((s) => s.bestaetigeWandstaerken);
  const wandhoehenVorschau = useBimStore((s) => s.wandhoehenVorschau);
  const gleicheWandhoehenAn = useBimStore((s) => s.gleicheWandhoehenAn);
  const setViewport = useBimStore((s) => s.setViewport);
  const viewport = useBimStore((s) => s.viewport);
  const [meldung, setMeldung] = useState<string | null>(null);
  /*
   * **Warum der Umfang vorbelegt ist und nicht gefragt wird.**
   *
   * Das ganze Gebäude ist die einzige Antwort, die nie schadet: Danach stehen
   * die Geschosse wieder übereinander. Nur ein Geschoss zu spiegeln ist
   * richtig, wenn gerade *ein* Plan eingelesen wurde und die übrigen schon
   * stimmen — das weiß aber nur der Mensch davor. Also steht das Sichere als
   * Vorgabe da und das andere als Haken daneben.
   */
  const [nurGeschoss, setNurGeschoss] = useState(false);
  /*
   * **Warum die Zuordnung vorbelegt ist mit dem, was schon gilt.**
   * Das Feld zeigt die Lage des aktiven Geschosses. Wer nichts ändern will,
   * sieht damit sofort, dass nichts zu ändern ist — und wer den Grundriss
   * einer Wohnung im ersten Stock eingelesen hat, stellt eine Zeile um statt
   * ein Geschoss anzulegen, Höhen nachzuziehen und Randbedingungen zu ändern.
   */
  const [zielOrdnung, setZielOrdnung] = useState<number | null>(null);
  const [aussenwaende, setAussenwaende] = useState(true);

  const waende = useMemo(
    () => Object.values(doc.walls).filter((w) => w.levelId === doc.activeLevelId),
    [doc.walls, doc.activeLevelId],
  );

  // Wie viel Begradigen brächte? Gerechnet wird der Vorschlag, geschrieben
  // wird nichts — sonst stünde hier ein Knopf, von dem niemand weiß, was er tut.
  const vorschau = useMemo(
    () => begradige(waende, doc.nodes),
    [waende, doc.nodes],
  );

  const luecken = useMemo(
    () => findeLuecken(Object.values(doc.walls), doc.nodes, doc.activeLevelId),
    [doc.walls, doc.nodes, doc.activeLevelId],
  );

  const offeneEnden = doc.diagnostics.openEnds.length;

  // Die Lage, die das aktive Geschoss heute hat. Liegt sie außerhalb der
  // Auswahlliste, steht das Feld auf EG — dann ist die Zuordnung ohnehin
  // nicht der richtige Weg.
  const aktuelleOrdnung = LAGEN.some((l) => l.ordnung === doc.levels[doc.activeLevelId]?.order)
    ? (doc.levels[doc.activeLevelId]?.order ?? 0)
    : 0;

  // Geschätzte Stärken, nach Wandart getrennt — die Frage stellt sich für
  // Außen- und Innenwände verschieden.
  const geschaetzt = useMemo(() => waende.filter((w) => w.thicknessEstimated), [waende]);
  const aussen = geschaetzt.filter((w) => w.type === 'exterior');
  const innen = geschaetzt.filter((w) => w.type !== 'exterior');

  if (waende.length === 0) return null;

  const schief = waende.length - vorschau.achsparallelVorher;
  /*
   * **Das Feld bleibt stehen, auch wenn nichts zu tun ist.**
   *
   * Vorher blendete es sich in genau dem Fall aus, in dem der Plan sauber
   * war. Das klingt aufgeräumt und ist ein Fehler: Wer die Funktion nie
   * gesehen hat, weiß auch nicht, dass es sie gibt — und sucht sie
   * vergeblich, sobald er sie das erste Mal braucht. „Ich sehe die
   * Begradigungsfunktion nicht" war genau das.
   *
   * Ein Werkzeugkasten zeigt seine Werkzeuge auch dann, wenn gerade nichts
   * kaputt ist. Was fehlt, ist nicht das Feld, sondern die Arbeit — und das
   * steht dann dort: „Alle Wände stehen auf der Achse."
   */

  return (
    <div className="space-y-2.5 rounded-lg border border-white/[0.07] bg-white/[0.02] p-3">
      <div className="label-xs">Aufmaß nachziehen</div>

      {/* --------------------------------------------- Wandhöhen angleichen */}
      <Wandhoehen
        vorschau={wandhoehenVorschau}
        angleichen={() => setMeldung(gleicheWandhoehenAn().message)}
        doc={doc}
      />

      {/* ------------------------------------------------------- Spiegeln */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[11.5px] text-slate-300">Grundriss spiegeln</div>
          <div className="flex gap-1">
            <button
              className="rounded-md bg-accent/15 px-2.5 py-1 text-[11px] text-accent transition hover:bg-accent/25"
              title="Links und rechts tauschen — der Regelfall beim seitenverkehrt eingelesenen Plan."
              onClick={() =>
                setMeldung(spiegleGrundriss('senkrecht', nurGeschoss ? 'geschoss' : 'alles').message)
              }
            >
              ↔ links/rechts
            </button>
            <button
              className="rounded-md bg-white/[0.06] px-2.5 py-1 text-[11px] text-slate-300 transition hover:bg-white/[0.1]"
              title="Oben und unten tauschen."
              onClick={() =>
                setMeldung(spiegleGrundriss('waagerecht', nurGeschoss ? 'geschoss' : 'alles').message)
              }
            >
              ↕ oben/unten
            </button>
          </div>
        </div>
        <label className="flex cursor-pointer items-center gap-1.5 text-[10.5px] text-slate-500">
          <input
            type="checkbox"
            className="h-3 w-3 accent-sky-400"
            checked={nurGeschoss}
            onChange={(e) => setNurGeschoss(e.target.checked)}
          />
          nur dieses Geschoss (sonst das ganze Gebäude samt Grundstück und Referenzbild)
        </label>
        <p className="text-[10.5px] leading-snug text-slate-500">
          Türanschläge, Heizkörperdrehungen, Dachrichtung und die Ausblasrichtung der Wärmepumpe
          gehen mit. Die Lage im Plan bleibt: gespiegelt wird um die Mitte dessen, was da ist.
        </p>
      </div>

      {/* --------------------------------------------- Geschosszuordnung */}
      <div className="space-y-1.5 border-t border-white/[0.06] pt-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[11.5px] text-slate-300">Dieser Grundriss ist das …</div>
          <div className="flex items-center gap-1">
            <select
              className="rounded-md border border-white/10 bg-slate-900/70 px-1.5 py-1 text-[11px] text-slate-200"
              value={zielOrdnung ?? aktuelleOrdnung}
              onChange={(e) => setZielOrdnung(Number(e.target.value))}
            >
              {LAGEN.map((l) => (
                <option key={l.ordnung} value={l.ordnung}>
                  {l.label}
                </option>
              ))}
            </select>
            <button
              className="rounded-md bg-accent/15 px-2.5 py-1 text-[11px] text-accent transition hover:bg-accent/25 disabled:opacity-40"
              disabled={(zielOrdnung ?? aktuelleOrdnung) === aktuelleOrdnung}
              onClick={() =>
                setMeldung(
                  ordneGrundrissZu(zielOrdnung ?? aktuelleOrdnung, aussenwaende).message,
                )
              }
            >
              Zuordnen
            </button>
          </div>
        </div>
        <label className="flex cursor-pointer items-center gap-1.5 text-[10.5px] text-slate-500">
          <input
            type="checkbox"
            className="h-3 w-3 accent-sky-400"
            checked={aussenwaende}
            onChange={(e) => setAussenwaende(e.target.checked)}
          />
          neue Geschosse mit dem Außenwandumriss anlegen
        </label>
        <p className="text-[10.5px] leading-snug text-slate-500">
          Die fehlenden Geschosse darunter entstehen mit, Höhenlagen und Namen werden nachgezogen,
          und der Boden dieser Wohnung grenzt danach an einen Raum statt an Erdreich. Öffnungen
          werden nicht übernommen — die sitzen im Geschoss darunter anders.
        </p>
      </div>

      {/* ---------------------------------------------------- Begradigen */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[11.5px] text-slate-300">Wände gerade ziehen</div>
          <button
            className="rounded-md bg-accent/15 px-2.5 py-1 text-[11px] text-accent transition hover:bg-accent/25 disabled:opacity-40 disabled:hover:bg-accent/15"
            disabled={vorschau.bewegt === 0}
            onClick={() => setMeldung(begradigeWaende().message)}
          >
            Begradigen
          </button>
        </div>
        <p className="text-[10.5px] leading-snug text-slate-500">
          {vorschau.bewegt > 0 ? (
            <>
              {schief} von {waende.length} Wänden stehen schief. Das Begradigen bewegt{' '}
              {vorschau.bewegt} Knoten, den weitesten um{' '}
              {vorschau.groessterVersatz.toFixed(3).replace('.', ',')} m.
              {vorschau.schraeg > 0 && (
                <> {vorschau.schraeg} bewusst schräge Wände bleiben, wie sie sind.</>
              )}
              {vorschau.uebersprungen > 0 && (
                <>
                  {' '}
                  {vorschau.uebersprungen} Wandzüge bleiben stehen — sie würden sich dabei zu weit
                  verschieben.
                </>
              )}
            </>
          ) : (
            <>Alle Wände stehen auf der Achse.</>
          )}
        </p>
      </div>

      {/* -------------------------------------------------------- Lücken */}
      {luecken.length > 0 && (
        <div className="space-y-1.5 border-t border-white/[0.06] pt-2.5">
          <div className="text-[11.5px] text-slate-300">
            {luecken.length} Lücke{luecken.length === 1 ? '' : 'n'} — was war dort?
          </div>
          <p className="text-[10.5px] leading-snug text-slate-500">
            An diesen Stellen hört eine Wand auf, ohne die nächste zu berühren. Das Aufmaß sagt
            nicht, warum. Solange die Frage offen ist, wird dort kein Raum erkannt.
          </p>
          <div className="space-y-1">
            {luecken.map((l) => (
              <div
                key={l.knotenId}
                className="rounded-md bg-white/[0.03] px-2 py-1.5 transition hover:bg-white/[0.06]"
              >
                <button
                  className="mb-1 block w-full text-left text-[11px] text-slate-400"
                  title="In den Blick rücken"
                  onClick={() =>
                    setViewport({
                      center: { x: (l.punkt.x + l.ziel.x) / 2, y: (l.punkt.y + l.ziel.y) / 2 },
                      zoom: Math.max(viewport.zoom, 90),
                    })
                  }
                >
                  {l.weite.toFixed(2).replace('.', ',')} m {l.geradeaus ? 'geradeaus' : 'quer'} ·{' '}
                  {l.zielKnotenId ? 'auf ein zweites loses Ende' : 'auf eine Wand'}
                </button>
                <div className="flex flex-wrap gap-1">
                  {SCHLUSS.map((s) => (
                    <button
                      key={s.art}
                      title={s.titel}
                      className="rounded bg-white/[0.06] px-2 py-0.5 text-[10.5px] text-slate-300 transition hover:bg-accent/25 hover:text-accent"
                      onClick={() => setMeldung(schliesseLuecke(l.knotenId, s.art).message)}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {luecken.length === 0 && offeneEnden > 0 && (
        <p className="border-t border-white/[0.06] pt-2.5 text-[10.5px] leading-snug text-slate-500">
          {offeneEnden} loses Wandende, aber kein Gegenüber in Reichweite. Dort fehlt kein
          Wandstück, sondern ein ganzer Zug — mit dem Wand-Werkzeug zeichnen.
        </p>
      )}

      {/* ------------------------------------------- Geschätzte Wandstärken */}
      {geschaetzt.length > 0 && (
        <div className="space-y-1.5 border-t border-white/[0.06] pt-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[11.5px] text-slate-300">
              {geschaetzt.length} Wandstärken sind geschätzt
            </div>
            <button
              className="rounded-md bg-accent/15 px-2.5 py-1 text-[11px] text-accent transition hover:bg-accent/25"
              title="Die Schätzung stimmt so — den Schritt abhaken."
              onClick={() => setMeldung(bestaetigeWandstaerken('alle').message)}
            >
              Passt so
            </button>
          </div>
          <p className="text-[10.5px] leading-snug text-slate-500">
            Ein Scan misst Wände als Flächen ohne Dicke. Angenommen sind{' '}
            {aussen.length > 0 && <>{aussen.length}× außen </>}
            {aussen.length > 0 && innen.length > 0 && <>und </>}
            {innen.length > 0 && <>{innen.length}× innen</>}. Die Zahl geht über die Bauteilfläche
            unmittelbar in die Heizlast — sie ist es wert, einmal angesehen zu werden.
          </p>
          {aussen.length > 0 && (
            <StaerkenZeile
              label={`Außenwand (${aussen.length})`}
              werte={[0.24, 0.3, 0.365, 0.425]}
              aktuell={aussen[0].thickness}
              setzen={(v) => setMeldung(bestaetigeWandstaerken('exterior', v).message)}
            />
          )}
          {innen.length > 0 && (
            <StaerkenZeile
              label={`Innenwand (${innen.length})`}
              werte={[0.115, 0.175, 0.24]}
              aktuell={innen[0].thickness}
              setzen={(v) => setMeldung(bestaetigeWandstaerken('interior', v).message)}
            />
          )}
        </div>
      )}

      {meldung && <div className="text-[10.5px] leading-snug text-accent/80">{meldung}</div>}
    </div>
  );
}

/**
 * Eine Reihe Stärken zum Anklicken. Der Wert, der gerade gilt, ist
 * hervorgehoben — sonst weiß niemand, wovon er ausgeht.
 */
function StaerkenZeile({
  label,
  werte,
  aktuell,
  setzen,
}: {
  label: string;
  werte: number[];
  aktuell: number;
  setzen: (v: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="mr-1 text-[10.5px] text-slate-500">{label}</span>
      {werte.map((v) => {
        const gleich = Math.abs(v - aktuell) < 1e-6;
        return (
          <button
            key={v}
            title={`Alle auf ${(v * 100).toFixed(1).replace('.', ',')} cm setzen und bestätigen`}
            className={
              'rounded px-2 py-0.5 text-[10.5px] transition ' +
              (gleich
                ? 'bg-accent/25 text-accent'
                : 'bg-white/[0.06] text-slate-300 hover:bg-accent/20 hover:text-accent')
            }
            onClick={() => setzen(v)}
          >
            {(v * 100).toFixed(1).replace('.', ',')}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Wandhöhen angleichen — Vorschau und ein Knopf.
 *
 * **Warum das Feld auch dann dasteht, wenn nichts zu tun ist.** Dieselbe
 * Überlegung wie beim Begradigen weiter unten: Wer eine Funktion nie gesehen
 * hat, sucht sie nicht, wenn er sie braucht. Steht nichts an, sagt das Feld
 * das — „Alle Wände stehen auf 250 cm." — und der Knopf bleibt aus.
 *
 * **Warum die Vorschau die Ausnahmen mitnennt.** Im Dachgeschoss bleiben
 * Kniestockwände stehen, und das ist richtig so. Ein Knopf, der „12 Wände
 * angleichen" verspricht und danach 12 von 18 angleicht, sieht aus wie ein
 * Fehler. Die Zahl der stehen bleibenden Wände gehört deshalb in denselben
 * Satz wie die der geänderten.
 */
function Wandhoehen({
  vorschau,
  angleichen,
  doc,
}: {
  vorschau: () => Hoehenbefund;
  angleichen: () => void;
  doc: BimDocument;
}) {
  // `doc` steht in der Abhängigkeitsliste, damit die Vorschau nach jeder
  // Änderung am Modell neu gerechnet wird — sonst trüge der Knopf eine
  // Zahl von vorhin.
  const befund = useMemo(() => vorschau(), [vorschau, doc]);
  const cm = (m: number): string => `${Math.round(m * 100)} cm`;
  const dach = befund.ausnahmen.filter((a) => a.grund === 'dachschraege').length;

  return (
    <div className="space-y-1.5 border-b border-white/[0.06] pb-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11.5px] text-slate-300">Wandhöhen angleichen</div>
        <button
          disabled={befund.aenderungen.length === 0}
          className={`rounded-md px-2.5 py-1 text-[11px] transition ${
            befund.aenderungen.length
              ? 'bg-accent/15 text-accent hover:bg-accent/25'
              : 'cursor-default bg-white/[0.03] text-slate-600'
          }`}
          title={
            befund.aenderungen.length
              ? `Alle Raumwände dieses Geschosses auf ${cm(befund.soll)} ziehen. Wände unter der Dachschräge und Brüstungen bleiben stehen. Rückgängig machbar.`
              : 'Nichts anzugleichen.'
          }
          onClick={angleichen}
        >
          {befund.aenderungen.length ? `${befund.aenderungen.length} Wände auf ${cm(befund.soll)}` : 'nichts zu tun'}
        </button>
      </div>
      <p className="text-[10.5px] leading-snug text-slate-500">{befundSatz(befund)}</p>
      {dach > 0 && (
        <p className="text-[10.5px] leading-snug text-slate-600">
          {dach} Wand{dach === 1 ? '' : 'e'} {AUSNAHME_LABELS.dachschraege} — dort ist die Höhe
          keine Nachlässigkeit, sondern das Dach.
        </p>
      )}
      <p className="text-[10.5px] leading-snug text-slate-600">
        Die Raumhöhe ist die <b>niedrigste</b> Wand des Raums. Eine einzelne Wand, die beim
        Zeichnen stehen geblieben ist, zieht damit Volumen und Lüftungsverlust des ganzen Raums
        herunter — ohne dass die Zahl falsch aussähe.
      </p>
    </div>
  );
}
