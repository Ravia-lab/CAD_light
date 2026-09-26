/**
 * Die sieben Angaben zur Anlage — ein Blatt, zwei Orte.
 * ---------------------------------------------------------------------------
 * **Warum es diese Datei gibt.** Die Felder standen bis 1.53.0 nur im
 * Anlagenblatt des Inspektors. Gemeldet aus der Benutzung: Dort gehen sie
 * unter — sie konkurrieren mit vierzehn anderen Reitern, obwohl sie die
 * *Voraussetzung* dafür sind, dass überhaupt ein Schema entsteht. Wer auf die
 * Schema-Ansicht ging, fand dort bis 1.53.0 den Satz „Im Reiter ‚Anlage' das
 * Gerät wählen und auf ‚Schema erzeugen' klicken": Das Programm wusste, was
 * es braucht, und schickte den Anwender weg, statt zu fragen.
 *
 * Seit 1.54.0 fragt es an der Stelle, an der man ohnehin hinsieht — im
 * Anlagendialog am leeren Schema. Die Felder gibt es aber weiterhin auch im
 * Anlagenblatt: Wer dort sitzt, weil er das Gerät wählt, soll sie nicht
 * suchen müssen. **Der Dialog ist die Tür, nicht der einzige Raum.**
 *
 * **Und genau deshalb stehen sie hier und nicht zweimal.** Zwei Abschriften
 * derselben sieben Felder wären zwei Stellen, an denen ein achtes Feld
 * nachgetragen werden muss — und eine, an der es vergessen wird. Was diese
 * Datei zeigt, ist an beiden Orten dasselbe, weil es dasselbe *ist*.
 *
 * **Alles gleichzeitig, nicht nacheinander.** Die Angaben hängen voneinander
 * ab: Die Bauart entscheidet über das Kältemittel, der Speicher über den
 * Einbauort des Heizstabs. Wer den vierten Schritt ausfüllt, muss den zweiten
 * noch sehen — und beim zweiten Gebäude ändert man zwei Felder, statt sieben
 * Schritte durchzuklicken. Diese Festlegung stammt aus 1.51.0 und gilt im
 * Dialog unverändert weiter; ein Assistent mit Weiter-Knopf wäre ein
 * Rückschritt.
 */

import type { Abweichung } from '../lib/anlagenFragen';
import { kaeltemittelImHaus } from '../lib/anlagenFragen';
import type { AnlagenAntworten, HeizkreisArt, Inneneinheit, PumpForm, Refrigerant } from '../types/bim';
import { INNENEINHEIT_LABELS, PUMP_FORM_LABELS } from '../types/bim';

/** Die Kältemittel zur Auswahl — dieselbe Reihenfolge wie im Gerätekatalog. */
const KAELTEMITTEL: readonly Refrigerant[] = ['R290', 'R32', 'R454C', 'R410A', 'R744', 'R1234ze', 'andere'];

/** Die angebotenen Speicherinhalte [l]. */
const TRINKWASSER_LITER = [120, 150, 180, 200, 250, 300, 400, 500] as const;
const PUFFER_LITER = [50, 80, 100, 120, 200, 300, 400, 500, 800] as const;

/**
 * Was unter der Inneneinheit steht — ein Satz je Fall.
 *
 * Die Beschriftung sagt, *was* gewählt ist; dieser Satz sagt, *was es
 * bedeutet*. Beim Einbauort des Heizstabs ist das keine Beigabe: Im Vorlauf
 * bedient er Heizung und Warmwasser, im Speicher nur den Behälter, in dem er
 * sitzt. Wer das erst am fertigen Schema merkt, hat die falsche Anlage
 * beschrieben.
 */
const INNENEINHEIT_SATZ: Record<Inneneinheit, string> = {
  keine:
    'Im Haus steht nur die Verteilung. Am Markt die Ausnahme — zum Monoblock liefert praktisch jeder ' +
    'Hersteller eine Hydraulikstation oder einen Turm.',
  'ohne-heizstab':
    'Pumpe, Umschaltventil, Sicherheitsgruppe und Regelung im Haus, kein elektrischer Zuheizer. Die ' +
    'Wärmepumpe trägt den Bivalenzpunkt allein.',
  'mit-heizstab':
    'Der Regelfall des monoenergetischen Betriebs. Der Stab sitzt im Vorlauf nach dem Gerät und vor dem ' +
    'Warmwasser-Umschaltventil — damit bedient er Heizung und Warmwasser.',
  'heizstab-speicher':
    'Flanschheizung im Trinkwasser- oder Tauchheizkörper im Pufferspeicher. Er erwärmt dann den Behälter, ' +
    'in dem er sitzt, und nicht den Vorlauf.',
};

export interface AnlagenFragenProps {
  antworten: AnlagenAntworten;
  setzeAntwort: (patch: Partial<AnlagenAntworten>) => void;
  /** Wo die Antworten von der Auslegung abweichen — Sätze, keine Korrekturen. */
  abweichungsliste: readonly Abweichung[];
  /**
   * Wie breit das Blatt liegt.
   *
   * `schmal` ist die Spalte des Inspektors, `breit` der Dialog. Nur die
   * Anordnung unterscheidet sich, nie die Felder oder ihre Zahl — sonst wäre
   * die gemeinsame Datei ihren Zweck los.
   */
  breite?: 'schmal' | 'breit';
}

export default function AnlagenFragen({
  antworten,
  setzeAntwort,
  abweichungsliste,
  breite = 'schmal',
}: AnlagenFragenProps) {
  const zweispaltig = breite === 'breit';

  return (
    <div className="space-y-2">
      {/*
        Die Überschrift steht nur im schmalen Blatt.

        Im Dialog sagt die Kopfzeile bereits dasselbe — „Aus diesen Angaben
        entsteht das Anlagenschema … Was Sie eintragen, gilt". Beides
        übereinander wäre nicht nur doppelt, sondern kostet die Zeilen, die
        der siebten Frage fehlen: Auf dem Tablet fiel damit das letzte Feld
        unter die Faltkante. Im Inspektor gibt es keine Kopfzeile, dort trägt
        dieser Absatz die Auskunft.
      */}
      {!zweispaltig && (
        <div>
          <span className="label-xs">Was wird gebaut?</span>
          <p className="mt-0.5 text-[9.5px] leading-relaxed text-slate-600">
            Sieben Angaben. Sie werden mit dem Projekt gespeichert, und aus ihnen entstehen Speicher und
            Heizkreise. Was Sie eintragen, gilt — weicht die Auslegung ab, steht es daneben.
          </p>
        </div>
      )}

      <div className={zweispaltig ? 'grid grid-cols-2 gap-x-4 gap-y-2' : 'space-y-2'}>
        {/* 1 · Bauart */}
        <label className="block">
          <span className="label-xs">1 · Bauart des Wärmeerzeugers</span>
          <select
            className="field mt-1 w-full"
            data-pruef="frage-bauform"
            value={antworten.bauform}
            onChange={(e) => setzeAntwort({ bauform: e.target.value as PumpForm })}
          >
            {(Object.keys(PUMP_FORM_LABELS) as PumpForm[]).map((f) => (
              <option key={f} value={f} className="bg-graphite-850">
                {PUMP_FORM_LABELS[f]}
              </option>
            ))}
          </select>
          <p className="mt-0.5 text-[9.5px] leading-relaxed text-slate-600">
            {kaeltemittelImHaus(antworten.bauform)
              ? 'Bei dieser Bauart geht der Kältekreis mit ins Haus — bei brennbarem Kältemittel gilt drinnen der Schutzbereich nach DIN EN 378.'
              : 'Ins Haus geht nur Heizungswasser; der Kältekreis bleibt draußen. Die Hydraulikstation steht trotzdem im Technikraum.'}
          </p>
        </label>

        {/* 2 · Kältemittel */}
        <label className="block">
          <span className="label-xs">2 · Kältemittel</span>
          <select
            className="field mt-1 w-full"
            data-pruef="frage-kaeltemittel"
            value={antworten.kaeltemittel}
            onChange={(e) => setzeAntwort({ kaeltemittel: e.target.value as Refrigerant })}
          >
            {KAELTEMITTEL.map((k) => (
              <option key={k} value={k} className="bg-graphite-850">
                {k}
              </option>
            ))}
          </select>
        </label>

        {/*
          3 · Inneneinheit

          Hier stand bis 1.53.0 ein Kästchen „Heizstab als Zusatzheizer".
          Ersetzt, weil es die falsche Frage war: Der Stab steckt am Markt
          fast immer *in* der Inneneinheit, und ob eine im Haus steht, war
          überhaupt nicht erfragt — das Schema zeichnete sie einfach immer.
          Ein Kästchen „Heizstab" neben einer unerfragten Inneneinheit ließ
          außerdem den Widerspruch zu, den niemand zeichnen kann.
        */}
        <label className="block">
          <span className="label-xs">3 · Inneneinheit</span>
          <select
            className="field mt-1 w-full"
            data-pruef="frage-inneneinheit"
            value={antworten.inneneinheit}
            onChange={(e) => setzeAntwort({ inneneinheit: e.target.value as Inneneinheit })}
          >
            {(Object.keys(INNENEINHEIT_LABELS) as Inneneinheit[]).map((i) => (
              <option key={i} value={i} className="bg-graphite-850">
                {INNENEINHEIT_LABELS[i]}
              </option>
            ))}
          </select>
          <p className="mt-0.5 text-[9.5px] leading-relaxed text-slate-600">
            {INNENEINHEIT_SATZ[antworten.inneneinheit]}
          </p>
        </label>

        {/* 4 · Trinkwasserspeicher */}
        <div>
          <span className="label-xs">4 · Trinkwasserspeicher</span>
          <div className="mt-1 flex items-center gap-2">
            <select
              className="field w-full"
              data-pruef="frage-trinkwasser"
              value={antworten.trinkwasserLiter}
              onChange={(e) => setzeAntwort({ trinkwasserLiter: Number(e.target.value) })}
            >
              <option value={0} className="bg-graphite-850">keiner</option>
              {TRINKWASSER_LITER.map((l) => (
                <option key={l} value={l} className="bg-graphite-850">
                  {l} l
                </option>
              ))}
            </select>
          </div>
        </div>

        {/*
          5 · Heizkreise

          **Die Reihenfolge folgt den Nummern, nicht dem Platzbedarf.** Der
          erste Entwurf setzte den Puffer aus Platzgründen neben den
          Trinkwasserspeicher; damit stand auf dem Blatt nach der 4 die 6, und
          die 5 rutschte ans Ende — unter die Faltkante. Ein Blatt, auf dem
          nach der 4 die 6 kommt, liest sich wie ein Fehler, und wer die 5
          sucht, sucht sie am falschen Ende.

          Drei Reihen zu zwei Feldern statt zwei Reihen und zwei vollen: So
          passen alle sieben Angaben auf ein Tablet, ohne dass eine davon
          erblättert werden muss. Der Rauchtest misst das am Fenster.
        */}
        <div>
          <span className="label-xs">5 · Heizkreise</span>
          <div className="mt-1 flex gap-1">
            {([1, 2] as const).map((n) => (
              <button
                key={n}
                className={`chip flex-1 ${
                  antworten.kreise.length === n
                    ? 'bg-accent/15 text-accent'
                    : 'bg-white/[0.05] text-slate-300 hover:bg-white/[0.1]'
                }`}
                onClick={() =>
                  setzeAntwort({
                    kreise:
                      n === 1
                        ? [antworten.kreise[0] ?? 'ungemischt']
                        : [antworten.kreise[0] ?? 'ungemischt', antworten.kreise[1] ?? 'gemischt'],
                  })
                }
              >
                {n === 1 ? 'ein Kreis' : 'zwei Kreise'}
              </button>
            ))}
          </div>
          <div className="mt-1 space-y-1">
            {antworten.kreise.map((art, i) => (
              <div key={i} className="flex items-center gap-1">
                <span className="w-14 shrink-0 text-[10px] text-slate-500">Kreis {i + 1}</span>
                {(['ungemischt', 'gemischt'] as HeizkreisArt[]).map((a) => (
                  <button
                    key={a}
                    className={`chip flex-1 ${
                      art === a ? 'bg-accent/15 text-accent' : 'bg-white/[0.05] text-slate-300 hover:bg-white/[0.1]'
                    }`}
                    onClick={() => {
                      const kreise = [...antworten.kreise];
                      kreise[i] = a;
                      setzeAntwort({ kreise });
                    }}
                  >
                    {a}
                  </button>
                ))}
              </div>
            ))}
          </div>
          <p className="mt-0.5 text-[9.5px] leading-relaxed text-slate-600">
            Gemischt heißt: eigener Mischer, eigene Umwälzpumpe, eigene Vorlauftemperatur — der Fall
            Fußbodenheizung neben Heizkörpern.
          </p>
        </div>
        {/* 6 · Pufferspeicher */}
        <div>
          <span className="label-xs">6 · Pufferspeicher</span>
          <div className="mt-1 flex gap-1">
            <select
              className="field flex-1"
              data-pruef="frage-puffer"
              value={antworten.pufferLiter}
              onChange={(e) => setzeAntwort({ pufferLiter: Number(e.target.value) })}
            >
              <option value={0} className="bg-graphite-850">keiner</option>
              {PUFFER_LITER.map((l) => (
                <option key={l} value={l} className="bg-graphite-850">
                  {l} l
                </option>
              ))}
            </select>
            {antworten.pufferLiter > 0 && (
              <select
                className="field flex-1"
                value={antworten.pufferArt}
                onChange={(e) => setzeAntwort({ pufferArt: e.target.value as 'buffer-parallel' | 'buffer-series' })}
              >
                <option value="buffer-parallel" className="bg-graphite-850">parallel (hydraulisch getrennt)</option>
                <option value="buffer-series" className="bg-graphite-850">in Reihe im Rücklauf</option>
              </select>
            )}
          </div>
        </div>

      </div>

      {/*
        Was die Auslegung dazu sagt.

        Er steht auf **demselben** Blatt wie die Felder und nicht auf einer
        zweiten Seite. Sonst trägt man eine Zahl ein, bestätigt — und erfährt
        erst danach, dass die Auslegung anderer Meinung ist.
      */}
      {abweichungsliste.length > 0 && (
        <div className="rounded-lg bg-amber-500/[0.07] px-2.5 py-2" data-pruef="abweichungen">
          <span className="text-[10px] font-medium text-amber-200">Was die Auslegung dazu sagt</span>
          {abweichungsliste.map((a, i) => (
            <p key={i} className="mt-1 text-[9.5px] leading-relaxed text-amber-100/70">
              {a.text}
            </p>
          ))}
          <p className="mt-1.5 text-[9px] leading-relaxed text-slate-500">
            Es bleibt bei Ihren Angaben. Diese Sätze stehen hier, damit die Abweichung bekannt ist — nicht, um
            sie zu ändern.
          </p>
        </div>
      )}
    </div>
  );
}
