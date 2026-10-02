/**
 * Die Skizzenseite — ein Blatt Papier im Hauptbereich.
 *
 * **Der Unterschied zum Skizzenblatt über dem Plan.** Dort zeichnet man in das
 * Gebäude: Jeder Strich hat eine Länge in Metern, und aus den Strichen werden
 * Wände. Hier zeichnet man auf Papier: ein Strangschema von Hand, ein Detail
 * am Anschluss, eine Notiz für den Kollegen. Gemeldet wurde genau dieser
 * Unterschied — „die ist immer noch im hauptsystem, das muss so gehen".
 *
 * **Warum eine eigene Ansicht und kein Reiter.** Zeichnen braucht Fläche. Die
 * Reiterspalte ist 380 px breit; ein Blatt darin wäre ein Briefmarkenalbum.
 * Die Seite steht deshalb da, wo sonst der Grundriss steht, und wird über
 * denselben Umschalter erreicht.
 *
 * **Finger ist hier erlaubt.** Im Grundriss schiebt der Finger das Bild, und
 * ein aufliegender Handballen zöge sonst Wände — deshalb ist er dort
 * abgeschaltet. Auf einem Blatt Papier gibt es nichts zu verschieben: Das
 * Blatt liegt ganz im Bild, und der Finger zeichnet.
 *
 * **Und doch führt ein Weg vom Blatt in den Grundriss** — seit 1.68.0.
 * Gemeldet wurde: „bei skizze wird nur skizziert, hier sollte dann auch die
 * funktion der räume also wände erzeugen und dergleichen gegeben sein das man
 * es übertragen kann". Das ist berechtigt: Ein leeres Blatt ist die
 * naheliegendste Fläche, um eine Wohnung aufzuzeichnen, und danach war der
 * Strich ein Bild.
 *
 * Gefehlt hat dafür genau eine Angabe: **der Maßstab.** Ein Blatt hat
 * Millimeter, ein Gebäude hat Meter. Deshalb gibt es hier eine Messstrecke —
 * dieselbe Idee wie beim Referenzbild —, und mit ihr den Knopf „In den
 * Grundriss". Dort entsteht ein **Vorschlag** und keine Wand: geprüft wird im
 * Plan, mit derselben Leiste wie beim Skizzenblatt. Das Blatt bleibt Papier.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useBimStore } from '../store/useBimStore';
import {
  BLATT,
  MESSSTRECKE_MIN,
  STIFTFARBEN,
  STRICHSTAERKEN,
  istLeer,
  meterJeMm,
  punktzahl,
  type StiftfarbeId,
} from '../lib/skizzenseite';
import type { Vec2 } from '../types/bim';

export default function SkizzenSeite() {
  const doc = useBimStore((s) => s.doc);
  const aktivesBlatt = useBimStore((s) => s.aktivesBlatt);
  const waehleBlatt = useBimStore((s) => s.waehleBlatt);
  const neuesBlatt = useBimStore((s) => s.neuesBlatt);
  const sorgeFuerBlatt = useBimStore((s) => s.sorgeFuerBlatt);
  const loescheBlatt = useBimStore((s) => s.loescheBlatt);
  const benenneBlatt = useBimStore((s) => s.benenneBlatt);
  const zeichneAufBlatt = useBimStore((s) => s.zeichneAufBlatt);
  const nimmZurueck = useBimStore((s) => s.nimmBlattstrichZurueck);
  const leere = useBimStore((s) => s.leereBlatt);
  const setzeMassstab = useBimStore((s) => s.setzeBlattMassstab);
  const uebertrage = useBimStore((s) => s.uebertrageBlatt);

  const blaetter = Object.values(doc.meta.skizzen ?? {}).sort((a, b) => a.at.localeCompare(b.at));
  const seite = blaetter.find((b) => b.id === aktivesBlatt) ?? blaetter[0];

  const [farbe, setFarbe] = useState<StiftfarbeId>('schwarz');
  const [staerke, setStaerke] = useState<number>(1);
  const [radierer, setRadierer] = useState(false);
  /**
   * Der Messmodus. Er ist kein Stift: Der Zug legt keinen Strich auf das
   * Blatt, sondern setzt den Maßstab — und danach schaltet er sich selbst
   * wieder aus, damit niemand aus Versehen das Maß überschreibt, während er
   * weiterzeichnet.
   */
  const [messen, setMessen] = useState(false);
  const [nurSchwarz, setNurSchwarz] = useState(false);

  const flaeche = useRef<HTMLDivElement>(null);
  const leinwand = useRef<HTMLCanvasElement>(null);
  /** Der Zug, der gerade entsteht — in Blattkoordinaten. */
  const zug = useRef<Vec2[]>([]);
  const [zeichnet, setZeichnet] = useState(false);

  /*
   * Es gibt immer ein Blatt. Wer die Seite aufschlägt und ein leeres Blatt
   * anlegen muss, bevor er zeichnen kann, hat einen Handgriff zu viel.
   */
  useEffect(() => {
    // Mehrfach aufrufbar, ohne mehrfach zu wirken — siehe `sorgeFuerBlatt`.
    sorgeFuerBlatt();
  }, [sorgeFuerBlatt]);

  /** Blattkoordinaten [mm] aus einem Zeigerereignis. */
  const zuBlatt = useCallback((e: { clientX: number; clientY: number }): Vec2 | undefined => {
    const el = leinwand.current;
    if (!el) return undefined;
    const r = el.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * BLATT.breite,
      y: ((e.clientY - r.top) / r.height) * BLATT.hoehe,
    };
  }, []);

  /** Das Blatt neu zeichnen — Striche und, während des Zugs, der laufende. */
  const male = useCallback(() => {
    const el = leinwand.current;
    if (!el || !seite) return;
    const ctx = el.getContext('2d');
    if (!ctx) return;

    // Die Leinwand hat Gerätepixel, das Blatt Millimeter. Der Faktor dazwischen
    // wird einmal gesetzt und gilt für alles Weitere.
    const dpr = window.devicePixelRatio || 1;
    const breite = el.clientWidth;
    const hoehe = el.clientHeight;
    if (el.width !== Math.round(breite * dpr) || el.height !== Math.round(hoehe * dpr)) {
      el.width = Math.round(breite * dpr);
      el.height = Math.round(hoehe * dpr);
    }
    const f = (breite * dpr) / BLATT.breite;
    ctx.setTransform(f, 0, 0, f, 0, 0);
    ctx.clearRect(0, 0, BLATT.breite, BLATT.hoehe);

    // Papier mit einem feinen Raster — es hilft beim Maßhalten und steht im
    // Ausdruck nicht mit drauf.
    ctx.fillStyle = '#0F172A';
    ctx.fillRect(0, 0, BLATT.breite, BLATT.hoehe);
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 0.15;
    for (let x = 10; x < BLATT.breite; x += 10) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, BLATT.hoehe);
      ctx.stroke();
    }
    for (let y = 10; y < BLATT.hoehe; y += 10) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(BLATT.breite, y);
      ctx.stroke();
    }

    const zeichneZug = (punkte: readonly Vec2[], farbwert: string, dicke: number) => {
      if (punkte.length < 2) return;
      ctx.strokeStyle = farbwert;
      ctx.lineWidth = dicke;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(punkte[0].x, punkte[0].y);
      for (let i = 1; i < punkte.length; i++) ctx.lineTo(punkte[i].x, punkte[i].y);
      ctx.stroke();
    };

    for (const strich of seite.striche) {
      const wert = STIFTFARBEN.find((f2) => f2.id === strich.farbe)?.wert ?? '#E2E8F0';
      zeichneZug(strich.punkte, wert, strich.staerke);
    }
    /*
     * Die Messstrecke liegt **über** den Strichen, gestrichelt und in der
     * Akzentfarbe: Sie gehört nicht zur Zeichnung, sondern sagt etwas über
     * sie. Wer sie für einen Strich hielte, würde sie mit „Strich zurück"
     * suchen — deshalb sieht sie aus wie ein Werkzeug und nicht wie ein Stift.
     */
    if (seite.massstab) {
      const { von, nach } = seite.massstab;
      ctx.save();
      ctx.strokeStyle = '#38BDF8';
      ctx.lineWidth = 0.6;
      ctx.setLineDash([3, 2]);
      ctx.beginPath();
      ctx.moveTo(von.x, von.y);
      ctx.lineTo(nach.x, nach.y);
      ctx.stroke();
      ctx.setLineDash([]);
      for (const p of [von, nach]) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.2, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = '#38BDF8';
      ctx.font = '4px sans-serif';
      ctx.fillText(
        `${seite.massstab.laenge.toFixed(2).replace('.', ',')} m`,
        (von.x + nach.x) / 2 + 2,
        (von.y + nach.y) / 2 - 2,
      );
      ctx.restore();
    }

    if (zug.current.length > 1) {
      const messend = messen;
      const wert = messend ? '#38BDF8' : STIFTFARBEN.find((f2) => f2.id === farbe)?.wert ?? '#E2E8F0';
      zeichneZug(zug.current, wert, messend ? 0.6 : staerke);
    }
  }, [seite, farbe, staerke, messen]);

  useEffect(() => {
    male();
  }, [male, seite?.striche.length, zeichnet]);

  useEffect(() => {
    const beiGroesse = () => male();
    window.addEventListener('resize', beiGroesse);
    return () => window.removeEventListener('resize', beiGroesse);
  }, [male]);

  if (!seite) return <div className="flex h-full items-center justify-center text-slate-500">Blatt wird angelegt …</div>;

  /** Meter je Millimeter Papier — `undefined` heißt: noch kein brauchbarer Maßstab. */
  const faktor = meterJeMm(seite.massstab);

  const beginn = (e: React.PointerEvent) => {
    if (radierer) return;
    const p = zuBlatt(e);
    if (!p) return;
    zug.current = [p];
    setZeichnet(true);
    try {
      (e.target as Element).setPointerCapture(e.pointerId);
    } catch {
      /* Ein synthetisches Ereignis kennt keinen Zeiger — dann eben ohne. */
    }
  };

  const weiter = (e: React.PointerEvent) => {
    if (!zeichnet) return;
    const p = zuBlatt(e);
    if (!p) return;
    const letzter = zug.current[zug.current.length - 1];
    // Punkte, die näher liegen als ein Zehntelmillimeter, bringen nichts.
    if (letzter && Math.hypot(p.x - letzter.x, p.y - letzter.y) < 0.1) return;
    zug.current.push(p);
    male();
  };

  const ende = () => {
    if (!zeichnet) return;
    setZeichnet(false);
    const punkte = zug.current;
    zug.current = [];
    if (punkte.length < 2) {
      male();
      return;
    }

    if (messen) {
      /*
       * Gemessen wird die **Luftlinie** zwischen Anfang und Ende des Zugs und
       * nicht seine Länge: Wer eine Messstrecke zieht, meint die Strecke und
       * nicht den Weg, den seine Hand dabei genommen hat.
       */
      const von = punkte[0];
      const nach = punkte[punkte.length - 1];
      const papier = Math.hypot(nach.x - von.x, nach.y - von.y);
      if (papier < MESSSTRECKE_MIN) {
        setMessen(false);
        male();
        window.alert(
          `Die Messstrecke ist nur ${papier.toFixed(0)} mm lang. Unter ${MESSSTRECKE_MIN} mm wird jeder ` +
            'Zeichenfehler zu groß umgelegt — ziehen Sie sie über eine längere Strecke, deren Maß Sie kennen.',
        );
        return;
      }
      const eingabe = window.prompt(
        `Wie lang ist diese Strecke in Wirklichkeit? Angabe in Metern.\n` +
          `Auf dem Papier sind es ${papier.toFixed(0)} mm.`,
        seite.massstab ? seite.massstab.laenge.toString().replace('.', ',') : '',
      );
      setMessen(false);
      male();
      if (eingabe === null) return;
      const laenge = Number(eingabe.replace(',', '.').trim());
      if (!Number.isFinite(laenge) || laenge <= 0) {
        window.alert('Das war keine Länge in Metern. Der Maßstab bleibt, wie er war.');
        return;
      }
      setzeMassstab(seite.id, { von, nach, laenge });
      return;
    }

    zeichneAufBlatt(seite.id, punkte, farbe, staerke);
  };

  return (
    <div className="flex h-full flex-col">
      {/* --- Kopfleiste: Blätter --------------------------------------- */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-white/[0.07] px-2.5 py-1.5">
        <span className="label-xs mr-1">Skizzenseite</span>
        {blaetter.map((b) => (
          <button
            key={b.id}
            onClick={() => waehleBlatt(b.id)}
            onDoubleClick={() => {
              const name = window.prompt('Blatt benennen', b.name);
              if (name !== null) benenneBlatt(b.id, name);
            }}
            title="Doppelklick benennt das Blatt"
            className={`chip ${b.id === seite.id ? 'bg-accent/15 text-accent' : 'text-slate-400 hover:text-slate-200'}`}
          >
            {b.name}
            {!istLeer(b) && <span className="ml-1 text-[9px] opacity-60">{b.striche.length}</span>}
          </button>
        ))}
        <button className="chip text-slate-400 hover:text-slate-100" onClick={() => neuesBlatt()}>
          + Blatt
        </button>
        {blaetter.length > 1 && (
          <button
            className="chip text-slate-500 hover:text-rose-300"
            onClick={() => loescheBlatt(seite.id)}
            title="Dieses Blatt entfernen"
          >
            Blatt weg
          </button>
        )}
        <span className="ml-auto text-[10px] text-slate-600">
          {seite.striche.length} {seite.striche.length === 1 ? 'Strich' : 'Striche'} · {punktzahl(seite)} Punkte
        </span>
      </div>

      {/* --- Das Blatt --------------------------------------------------- */}
      <div ref={flaeche} className="flex min-h-0 flex-1 items-center justify-center p-3">
        <div
          className="relative w-full max-w-[1100px] overflow-hidden rounded-lg border border-white/[0.1] shadow-lg"
          style={{ aspectRatio: `${BLATT.breite} / ${BLATT.hoehe}` }}
        >
          <canvas
            ref={leinwand}
            className="h-full w-full touch-none"
            style={{ cursor: radierer ? 'cell' : 'crosshair' }}
            onPointerDown={beginn}
            onPointerMove={weiter}
            onPointerUp={ende}
            onPointerCancel={ende}
            onPointerLeave={ende}
          />
          {istLeer(seite) && !zeichnet && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <p className="max-w-[46ch] text-center text-[13px] leading-relaxed text-slate-600">
                Leeres Blatt. Zeichnen Sie mit Finger, Stift oder Maus — ein Strangschema, ein
                Detail, eine Notiz. Das Blatt gehört zum Projekt und wird mitgespeichert.
                <br />
                Wer eine Wohnung aufzeichnet, legt danach ein <b>Maß</b> an und übernimmt sie
                <b> in den Grundriss</b>: dort wird daraus ein Wandvorschlag.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* --- Werkzeuge ---------------------------------------------------- */}
      <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.07] px-2.5 py-2">
        <div className="flex gap-1">
          {STIFTFARBEN.map((f) => (
            <button
              key={f.id}
              title={f.label}
              onClick={() => {
                setFarbe(f.id);
                setRadierer(false);
              }}
              className={`h-7 w-7 rounded-full border-2 transition ${
                farbe === f.id && !radierer ? 'border-white/70' : 'border-white/10'
              }`}
              style={{ background: f.wert }}
            />
          ))}
        </div>
        <div className="flex gap-1">
          {STRICHSTAERKEN.map((d) => (
            <button
              key={d}
              onClick={() => {
                setStaerke(d);
                setRadierer(false);
              }}
              title={`${d.toString().replace('.', ',')} mm`}
              className={`chip ${staerke === d && !radierer ? 'bg-accent/15 text-accent' : 'text-slate-400'}`}
            >
              {d.toString().replace('.', ',')}
            </button>
          ))}
        </div>
        <button
          className="chip text-slate-400 hover:text-slate-100"
          onClick={() => nimmZurueck(seite.id)}
          disabled={istLeer(seite)}
        >
          Strich zurück
        </button>
        <button
          className="chip text-slate-400 hover:text-slate-100"
          onClick={() => leere(seite.id)}
          disabled={istLeer(seite)}
        >
          Blatt leeren
        </button>

        {/* --- Vom Blatt in den Grundriss ------------------------------- */}
        <span className="mx-1 h-5 w-px bg-white/[0.12]" />
        <button
          className={`chip ${messen ? 'bg-accent/20 text-accent' : 'text-slate-400 hover:text-slate-100'}`}
          onClick={() => {
            setMessen((x) => !x);
            setRadierer(false);
          }}
          title="Eine Strecke über etwas ziehen, dessen Maß Sie kennen — danach das Maß eintippen"
        >
          {seite.massstab ? 'Maß ändern' : 'Maß anlegen'}
        </button>
        {seite.massstab && (
          <span className="text-[10px] tabular-nums text-slate-500">
            {faktor === undefined
              ? 'Messstrecke zu kurz'
              : `1 m = ${(1 / faktor).toFixed(1).replace('.', ',')} mm`}
          </span>
        )}
        <button
          className="chip bg-accent/12 text-accent hover:bg-accent/20"
          onClick={() => uebertrage(seite.id, { nurSchwarz })}
          disabled={istLeer(seite) || faktor === undefined}
          title={
            faktor === undefined
              ? 'Dafür braucht das Blatt erst einen Maßstab'
              : 'Die Striche als Wandvorschlag in den Grundriss legen — geprüft wird dort'
          }
        >
          In den Grundriss
        </button>
        <label className="flex items-center gap-1 text-[10px] text-slate-500">
          <input
            type="checkbox"
            checked={nurSchwarz}
            onChange={(e) => setNurSchwarz(e.target.checked)}
            className="h-3 w-3 accent-accent"
          />
          nur schwarze
        </label>

        <p className="ml-auto max-w-[52ch] text-[10px] leading-relaxed text-slate-600">
          {faktor === undefined
            ? 'Mit einem Maßstab wird aus dem Blatt ein Grundrissvorschlag: eine Strecke über ein bekanntes Maß ziehen, Länge eintippen, übernehmen.'
            : 'Übernehmen legt einen Vorschlag in den Grundriss — geprüft und angelegt wird er dort. Das Blatt bleibt, wie es ist. Eine Handskizze ist dabei nur so genau wie die Hand; das Maß richtet eine Länge, den Rest richtet die Erkennung auf rechte Winkel.'}
        </p>
      </div>
    </div>
  );
}
