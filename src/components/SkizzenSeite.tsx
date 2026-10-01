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
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useBimStore } from '../store/useBimStore';
import {
  BLATT,
  STIFTFARBEN,
  STRICHSTAERKEN,
  istLeer,
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

  const blaetter = Object.values(doc.meta.skizzen ?? {}).sort((a, b) => a.at.localeCompare(b.at));
  const seite = blaetter.find((b) => b.id === aktivesBlatt) ?? blaetter[0];

  const [farbe, setFarbe] = useState<StiftfarbeId>('schwarz');
  const [staerke, setStaerke] = useState<number>(1);
  const [radierer, setRadierer] = useState(false);

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
    if (zug.current.length > 1) {
      const wert = STIFTFARBEN.find((f2) => f2.id === farbe)?.wert ?? '#E2E8F0';
      zeichneZug(zug.current, wert, staerke);
    }
  }, [seite, farbe, staerke]);

  useEffect(() => {
    male();
  }, [male, seite?.striche.length, zeichnet]);

  useEffect(() => {
    const beiGroesse = () => male();
    window.addEventListener('resize', beiGroesse);
    return () => window.removeEventListener('resize', beiGroesse);
  }, [male]);

  if (!seite) return <div className="flex h-full items-center justify-center text-slate-500">Blatt wird angelegt …</div>;

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
    if (punkte.length >= 2) zeichneAufBlatt(seite.id, punkte, farbe, staerke);
    else male();
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
                Detail, eine Notiz. Dieses Blatt gehört zum Projekt und wird mitgespeichert; es ist
                <b> kein Grundriss</b> und wird zu keiner Wand.
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
        <p className="ml-auto max-w-[52ch] text-[10px] leading-relaxed text-slate-600">
          Finger und Stift zeichnen hier beide — auf einem Blatt gibt es nichts zu verschieben.
          Für einen Grundriss, aus dem Wände werden, nehmen Sie das Skizzenblatt über dem Plan.
        </p>
      </div>
    </div>
  );
}
