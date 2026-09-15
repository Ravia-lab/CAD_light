/**
 * NotizLeiste — der Werkzeugkasten der Notizebene.
 *
 * **Warum es sie überhaupt gibt.** Auf dem Tablet fehlt alles, worüber man
 * am Rechner nebenbei umschaltet: keine zweite Maustaste, keine Alt-Taste,
 * und der Apple Pencil hat kein Radierende, das der Browser meldet. Wer mit
 * dem Stift arbeitet, hat nur den Bildschirm — also muss auf dem Bildschirm
 * stehen, was das Werkzeug gerade tut.
 *
 * Sie sagt drei Dinge: **was der Stift gerade macht** (schreiben oder
 * radieren), **wie viel auf dem Geschoss liegt**, und **wie man alles wieder
 * loswird**. Mehr braucht eine Randbemerkung nicht.
 *
 * Sie steht an derselben Stelle wie die Skizzenleiste, weil beide dasselbe
 * beantworten: „Was passiert, wenn ich jetzt den Stift aufsetze?"
 */

import { useBimStore } from '../store/useBimStore';

export default function NotizLeiste() {
  const tool = useBimStore((s) => s.tool);
  const doc = useBimStore((s) => s.doc);
  const radiergummi = useBimStore((s) => s.radiergummi);
  const setzeRadiergummi = useBimStore((s) => s.setzeRadiergummi);
  const notizenSichtbar = useBimStore((s) => s.notizenSichtbar);
  const setzeNotizenSichtbar = useBimStore((s) => s.setzeNotizenSichtbar);
  const loescheNotizen = useBimStore((s) => s.loescheNotizen);
  const skizze = useBimStore((s) => s.skizze);

  // Ein Vorschlag hat Vorrang: zwei Leisten übereinander wären eine zu viel.
  if (tool !== 'ink' || skizze) return null;

  const anzahl = Object.values(doc.freihand ?? {}).filter((f) => f.levelId === doc.activeLevelId).length;

  return (
    <div className="pointer-events-none absolute bottom-5 left-1/2 z-10 w-[min(94vw,36rem)] -translate-x-1/2">
      <div className="panel pointer-events-auto flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-amber-400" />
          <span className="text-[12px] text-slate-200">Handnotiz</span>
        </div>

        <div className="divider-v hidden sm:block" />

        <div className="flex items-center gap-1">
          <button
            className={`chip ${
              !radiergummi ? 'bg-accent/15 text-accent' : 'bg-white/[0.05] text-slate-400 hover:text-slate-200'
            }`}
            onClick={() => setzeRadiergummi(false)}
            title="Schreiben — der Strich bleibt als Notiz liegen."
          >
            Schreiben
          </button>
          <button
            className={`chip ${
              radiergummi ? 'bg-accent/15 text-accent' : 'bg-white/[0.05] text-slate-400 hover:text-slate-200'
            }`}
            onClick={() => setzeRadiergummi(true)}
            title="Radieren — was die Bahn berührt, fällt ganz. Mit Strg+Z zurückzunehmen."
          >
            Radieren
          </button>
        </div>

        <div className="divider-v hidden sm:block" />

        <button
          className={`chip ${
            notizenSichtbar ? 'bg-white/[0.05] text-slate-300' : 'bg-amber-400/15 text-amber-300'
          }`}
          onClick={() => setzeNotizenSichtbar(!notizenSichtbar)}
          title="Die Notizebene ein- oder ausblenden. Gelöscht wird dabei nichts."
        >
          {notizenSichtbar ? 'Sichtbar' : 'Ausgeblendet'}
        </button>

        <span className="font-mono text-[11px] text-slate-500">{anzahl} auf diesem Geschoss</span>

        <div className="flex-1" />

        <button
          className="chip bg-white/[0.05] text-slate-300 hover:bg-white/[0.1] disabled:opacity-40"
          onClick={loescheNotizen}
          disabled={anzahl === 0}
          title="Alle Notizen dieses Geschosses löschen. Ein Schritt, mit Strg+Z zurücknehmbar."
        >
          Alle löschen
        </button>

        <p className="w-full text-[10.5px] leading-snug text-slate-500">
          Notizen sind Randbemerkungen: Sie stehen in der Projektdatei, gehen aber nicht in Massen,
          Heizlast oder Export. Auf dem Plan erscheinen sie nur, wenn im Druckdialog „Handnotizen"
          angehakt ist.
        </p>
      </div>
    </div>
  );
}
