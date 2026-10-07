/**
 * Die Aufnahme Zimmer für Zimmer — die Bedienung.
 *
 * **Wofür.** Wer noch nie ein CAD bedient hat, scheitert nicht an der Zahl
 * der Werkzeuge, sondern an der ersten Frage, die er nicht beantworten kann.
 * Deshalb gibt es neben dem Zeichnen einen zweiten Weg: Das Programm fragt,
 * der Anwender tippt eine Kachel an — und auf **jede** Frage darf „weiß ich
 * nicht" die Antwort sein. Das Programm nimmt dann einen Anhaltswert und
 * vermerkt ihn; die Liste steht danach in der Prüfung und geht mit in die
 * Übergabe.
 *
 * **Was hier nicht passiert.** Keine Geometrie. Jeder Raum entsteht über
 * `addRoomTemplate` — dieselbe Funktion wie beim Werkzeug „Raum aufziehen",
 * samt Knotenverschmelzung und Wandteilung. Damit ist das Ergebnis ein ganz
 * normales Modell: Nach der letzten Antwort lässt sich jede Wand einzeln
 * anfassen, und alles Weitere — Prüfung, Plan, Anlage, Übergabe — greift
 * unverändert.
 *
 * Der Assistent hält auch **keine Daten**: Was erfragt ist, steht nach jeder
 * Antwort im Dokument und damit in der Sitzungssicherung. Wer mittendrin
 * abbricht, verliert die laufende Frage und sonst nichts.
 */

import { dez } from '../lib/zahl';
import { useState } from 'react';
import {
  ANBAU_LABELS,
  type Achsrechteck,
  type Anbau,
  ecken,
  fensterLagen,
  fensterPlatz,
  fensterseite,
  fortschritt,
  GEBAEUDE_FRAGEN,
  platziere,
  raumart,
  RAUMARTEN,
  raumFragen,
  seitenkanten,
} from '../lib/aufnahme';
import { BAUALTERSKLASSEN } from '../lib/verbrauchsabgleich';
import { usageDefaults } from '../lib/roomDetection';
import { OPENING_PRESETS, type BoundaryCondition, type Vec2 } from '../types/bim';
import { useBimStore } from '../store/useBimStore';

/** Das Fenster, das der Assistent setzt — Dreh-Kipp, das häufigste im Wohnbau. */
const FENSTER = OPENING_PRESETS.find((p) => p.id === 'win-tilt-turn')!;

const UNTEN: { k: BoundaryCondition; titel: string; unter: string }[] = [
  { k: 'ground', titel: 'Erdreich', unter: 'Bodenplatte, kein Keller' },
  { k: 'unheated', titel: 'Unbeheizter Keller', unter: '' },
  { k: 'adiabatic', titel: 'Beheizte Wohnung', unter: 'darunter wohnt jemand' },
  { k: 'exterior', titel: 'Freie Luft', unter: 'Durchfahrt, Garage' },
];
const OBEN: { k: BoundaryCondition; titel: string; unter: string }[] = [
  { k: 'exterior', titel: 'Das Dach', unter: 'direkt darunter' },
  { k: 'unheated', titel: 'Unbeheizter Dachboden', unter: '' },
  { k: 'adiabatic', titel: 'Beheizte Wohnung', unter: 'darüber wohnt jemand' },
];

interface Entwurf {
  artId: string;
  l: number;
  b: number;
  fenster: number;
  hk: boolean;
  anbau: Anbau;
}
const LEER: Entwurf = { artId: '', l: 4, b: 4, fenster: 1, hk: true, anbau: 'rechts' };

export default function AufnahmeAssistent({ onFertig }: { onFertig: () => void }) {
  const offen = useBimStore((s) => s.assistent);
  const schliessen = useBimStore((s) => s.setzeAssistent);
  const doc = useBimStore((s) => s.doc);
  const addRoomTemplate = useBimStore((s) => s.addRoomTemplate);
  const addOpening = useBimStore((s) => s.addOpening);
  const addFixture = useBimStore((s) => s.addFixture);
  const updateMeta = useBimStore((s) => s.updateMeta);
  const updateLevel = useBimStore((s) => s.updateLevel);
  const vermerke = useBimStore((s) => s.vermerkeAnnahme);
  const entferne = useBimStore((s) => s.entferneAnnahme);
  const setzeStatus = useBimStore((s) => s.setStatus);
  const passeEin = useBimStore((s) => s.passeEin);
  const legeGeschossAn = useBimStore((s) => s.addLevel);

  const [phase, setPhase] = useState<'gebaeude' | 'raeume' | 'fertig'>('gebaeude');
  const [gi, setGi] = useState(0);
  const [ri, setRi] = useState(0);
  const [e, setE] = useState<Entwurf>(LEER);
  const [letztes, setLetztes] = useState<Achsrechteck | undefined>(undefined);
  /** Alle bisher gesetzten Rechtecke — nötig, um eine freie Außenseite zu finden. */
  const [rechtecke, setRechtecke] = useState<Achsrechteck[]>([]);
  const [zahl, setZahl] = useState(0);
  const [hoehe, setHoehe] = useState(2.5);

  if (!offen) return null;

  const level = doc.levels[doc.activeLevelId];
  const getan =
    phase === 'gebaeude' ? gi : GEBAEUDE_FRAGEN.length + zahl * 5 + ri;
  const balken = Math.round(fortschritt(getan, zahl) * 100);

  // -------------------------------------------------------------------- Hilfen
  const kachel = (
    titel: string,
    unter: string | undefined,
    an: boolean,
    onClick: () => void,
    key: string,
  ) => (
    <button
      key={key}
      className={`flex min-h-[56px] flex-col items-center justify-center rounded-xl border px-2 py-2 text-[15px] font-semibold leading-tight transition ${
        an
          ? 'border-accent bg-accent/20 text-slate-50'
          : 'border-white/[0.08] bg-white/[0.04] text-slate-200 hover:bg-white/[0.08]'
      }`}
      onClick={onClick}
    >
      {titel}
      {unter ? <span className="mt-0.5 text-[11.5px] font-normal text-slate-400">{unter}</span> : null}
    </button>
  );

  const weissNicht = (text: string, onClick: () => void) => (
    <button
      className="mt-1 flex min-h-[46px] w-full items-center justify-center rounded-xl border border-dashed border-white/[0.14] px-3 text-[14px] font-medium text-slate-400 hover:text-slate-200"
      onClick={onClick}
    >
      {text}
    </button>
  );

  /**
   * Die Wand finden, die genau zwischen diesen beiden Punkten liegt.
   *
   * **Gelesen wird der frische Stand**, nicht der aus dem letzten
   * Bilddurchlauf: Die gesuchte Wand ist in derselben Behandlung gerade erst
   * entstanden. Mit dem Dokument aus der Hülle fände man sie nie — und die
   * Fenster fielen still aus, ohne dass irgendwo etwas rot würde.
   */
  const wandAn = (p: Vec2, q: Vec2): string | undefined => {
    const jetzt = useBimStore.getState().doc;
    const nah = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y) < 0.02;
    for (const w of Object.values(jetzt.walls)) {
      if (w.levelId !== jetzt.activeLevelId) continue;
      const a = jetzt.nodes[w.a];
      const b = jetzt.nodes[w.b];
      if (!a || !b) continue;
      if ((nah(a, p) && nah(b, q)) || (nah(a, q) && nah(b, p))) return w.id;
    }
    return undefined;
  };

  // ------------------------------------------------------------- Raum anlegen
  /**
   * Einen Raum anlegen — **mit dem Entwurf als Beiwert**, nicht aus dem Zustand.
   *
   * Die Antwort auf die *letzte* Frage eines Raums wird im selben Griff
   * gegeben, in dem der Raum entsteht. `setE` wirkt aber erst im nächsten
   * Bilddurchlauf. Wer hier aus dem Zustand liest, liest also noch die
   * vorige Antwort — ein „Nein" beim Heizkörper fiel so still unter den
   * Tisch, und in jedem Raum hing anschließend doch einer.
   */
  const legeRaumAn = (nimm: Entwurf) => {
    const art = raumart(nimm.artId);
    if (!art) return;
    const rect = platziere(letztes, nimm.anbau, nimm.l, nimm.b);
    const { from, to } = ecken(rect);
    const erg = addRoomTemplate('rechteck', from, to, { usage: art.usage, name: art.label });
    if (!erg) {
      setzeStatus('Dort steht schon eine Wand — bitte eine andere Seite wählen.');
      return;
    }

    /*
     * Die Fenster kommen in die Wand **gegenüber dem Anschluss**: Beim
     * ersten Raum die untere, sonst die dem Vorgänger abgewandte. Das ist
     * eine Annahme über die Lage und keine Messung — sie steht deshalb in
     * der Liste, und wer es genau braucht, schiebt die Öffnung danach im
     * Plan an ihren Platz.
     */
    /*
     * Die Fenster kommen in eine Seite, vor der **kein anderer Raum steht**.
     * Bevorzugt die Seite, die dem Anschluss gegenüberliegt; beim ersten Raum
     * die untere. Ist jede Seite verbaut, bekommt der Raum keine Fenster —
     * das steht dann in der Annahmenliste und nicht als stiller Ausfall.
     */
    const seite = fensterseite(rect, letztes ? nimm.anbau : 'unten', rechtecke);
    const aussen = seite ? seitenkanten(rect, seite) : undefined;
    const wandId = aussen ? wandAn(aussen[0], aussen[1]) : undefined;
    const laenge = aussen ? Math.hypot(aussen[1].x - aussen[0].x, aussen[1].y - aussen[0].y) : 0;
    const passt = Math.min(nimm.fenster, fensterPlatz(laenge, FENSTER.width));
    if (wandId && passt > 0) {
      for (const anteil of fensterLagen(passt)) {
        addOpening({
          wallId: wandId,
          kind: 'window',
          distance: laenge * anteil,
          width: FENSTER.width,
          height: FENSTER.height,
          sillHeight: FENSTER.sillHeight,
          uValue: FENSTER.uValue,
          gValue: FENSTER.gValue,
          windowType: FENSTER.windowType,
          panels: FENSTER.panels,
        });
      }
    }
    if (nimm.fenster > 0 && !aussen) {
      vermerke(
        `Fenster ${art.label}`,
        'keines gesetzt',
        'Vor jeder Seite dieses Raums steht ein anderer Raum — eine Außenwand war nicht zu finden. Die Fenster gehören von Hand in die richtige Wand.',
      );
    } else if (nimm.fenster > passt) {
      vermerke(
        'Fensterzahl',
        `${passt} statt ${nimm.fenster} gesetzt`,
        'In die Außenwand dieses Raums passen nicht mehr Regelfenster. Die übrigen gehören vermutlich in eine andere Wand.',
      );
    }

    /* Heizkörper unter das erste Fenster, 30 cm vor die Wand gerückt. */
    if (nimm.hk && aussen) {
      const mitte = { x: (aussen[0].x + aussen[1].x) / 2, y: (aussen[0].y + aussen[1].y) / 2 };
      const nachInnen = {
        x: mitte.x + (rect.x + rect.l / 2 - mitte.x) * (0.3 / Math.max(0.3, laenge / 2)),
        y: mitte.y + (rect.y + rect.b / 2 - mitte.y) * (0.3 / Math.max(0.3, laenge / 2)),
      };
      addFixture(art.usage === 'bath' ? 'towel-radiator' : 'radiator', nachInnen);
    }

    setLetztes(rect);
    setRechtecke((liste) => liste.concat(rect));
    setZahl((z) => z + 1);
    setE({ ...LEER, anbau: nimm.anbau });
    setRi(0);
    passeEin();
  };

  // ------------------------------------------------------------------ Ablauf
  const weiterG = () => {
    if (gi < GEBAEUDE_FRAGEN.length - 1) setGi(gi + 1);
    else {
      setPhase('raeume');
      setRi(0);
    }
  };
  const folge = raumFragen(zahl === 0);
  /**
   * Eine Frage weiter — und den Entwurf gleich mitnehmen.
   *
   * Der Beiwert ist der Grund, dass die letzte Antwort nicht verloren geht:
   * Sie wird hier sowohl in den Zustand geschrieben als auch unmittelbar an
   * `legeRaumAn` weitergegeben.
   */
  const weiterR = (naechste: Entwurf = e) => {
    setE(naechste);
    if (ri < folge.length - 1) setRi(ri + 1);
    else legeRaumAn(naechste);
  };

  // ------------------------------------------------------------------- Inhalt
  let kopf = '';
  let unterzeile = '';
  let inhalt: React.ReactNode = null;

  if (phase === 'gebaeude') {
    const f = GEBAEUDE_FRAGEN[gi];
    kopf = 'Das Gebäude';
    unterzeile = `Frage ${gi + 1} von ${GEBAEUDE_FRAGEN.length}`;
    if (f === 'umfang') {
      inhalt = (
        <>
          <h2 className="assi-frage">Was nehmen wir auf?</h2>
          <div className="grid grid-cols-2 gap-2">
            {kachel('Eine Wohnung', 'ein Geschoss', false, weiterG, 'w')}
            {kachel('Ein ganzes Haus', 'wir fangen unten an', false, weiterG, 'h')}
          </div>
        </>
      );
    } else if (f === 'baualter') {
      inhalt = (
        <>
          <h2 className="assi-frage">Wie alt ist das Haus ungefähr?</h2>
          <p className="assi-unter">Davon hängt ab, womit das Programm gegenrechnet. Grob genügt.</p>
          <div className="grid grid-cols-2 gap-2">
            {BAUALTERSKLASSEN.map((k) =>
              kachel(k.label, undefined, doc.meta.baualter === k.id, () => {
                updateMeta({ baualter: k.id });
                entferne('Baualter');
                weiterG();
              }, k.id),
            )}
          </div>
          {weissNicht('Weiß ich nicht — dann nehmen wir das Älteste', () => {
            updateMeta({ baualter: BAUALTERSKLASSEN[0].id });
            vermerke(
              'Baualter',
              `${BAUALTERSKLASSEN[0].label} angenommen`,
              'Der ungünstigste Fall — die Anlage fällt damit eher zu groß als zu klein aus.',
            );
            weiterG();
          })}
        </>
      );
    } else if (f === 'unten' || f === 'oben') {
      const liste = f === 'unten' ? UNTEN : OBEN;
      const jetzt = f === 'unten' ? level?.floorBoundary : level?.ceilingBoundary;
      const setze = (k: BoundaryCondition) =>
        updateLevel(doc.activeLevelId, f === 'unten' ? { floorBoundary: k } : { ceilingBoundary: k });
      const titel = f === 'unten' ? 'Was ist unter der Wohnung?' : 'Und was ist darüber?';
      const name = f === 'unten' ? 'Unter der Wohnung' : 'Über der Wohnung';
      const vorgabe = f === 'unten' ? UNTEN[1] : OBEN[2];
      inhalt = (
        <>
          <h2 className="assi-frage">{titel}</h2>
          <div className="grid grid-cols-2 gap-2">
            {liste.map((x) =>
              kachel(x.titel, x.unter || undefined, jetzt === x.k, () => {
                setze(x.k);
                entferne(name);
                weiterG();
              }, x.k + x.titel),
            )}
          </div>
          {weissNicht('Weiß ich nicht', () => {
            setze(vorgabe.k);
            vermerke(name, `${vorgabe.titel} angenommen`, 'Der häufigste Fall.');
            weiterG();
          })}
        </>
      );
    } else {
      inhalt = (
        <>
          <h2 className="assi-frage">Wie hoch sind die Räume?</h2>
          <p className="assi-unter">Vom Boden bis zur Decke. Zwei Meter fünfzig ist das Übliche.</p>
          <div className="flex items-center gap-3">
            <button className="assi-rund" onClick={() => setHoehe(Math.max(2, Math.round((hoehe - 0.05) * 100) / 100))}>−</button>
            <div className="flex-1 text-center text-[26px] font-bold tabular-nums text-slate-50">
              {hoehe.toFixed(2).replace('.', ',')} m
            </div>
            <button className="assi-rund" onClick={() => setHoehe(Math.min(4.5, Math.round((hoehe + 0.05) * 100) / 100))}>+</button>
          </div>
          <button
            className="assi-vor"
            onClick={() => {
              updateLevel(doc.activeLevelId, { height: hoehe });
              entferne('Raumhöhe');
              weiterG();
            }}
          >
            Passt
          </button>
          {weissNicht('Weiß ich nicht — dann 2,50 m', () => {
            updateLevel(doc.activeLevelId, { height: 2.5 });
            vermerke('Raumhöhe', '2,50 m angenommen', 'Das übliche Maß im Wohnungsbau.');
            weiterG();
          })}
        </>
      );
    }
  } else if (phase === 'raeume') {
    const f = folge[ri];
    const art = raumart(e.artId);
    kopf = `Raum ${zahl + 1}${art ? ' · ' + art.label : ''}`;
    unterzeile = `Frage ${ri + 1} von ${folge.length}`;
    if (f === 'anbau') {
      inhalt = (
        <>
          <h2 className="assi-frage">Wo liegt dieser Raum?</h2>
          <p className="assi-unter">Vom vorigen aus gesehen.</p>
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(ANBAU_LABELS) as Anbau[]).map((k) =>
              kachel(ANBAU_LABELS[k], undefined, e.anbau === k, () => weiterR({ ...e, anbau: k }), k),
            )}
          </div>
        </>
      );
    } else if (f === 'art') {
      inhalt = (
        <>
          <h2 className="assi-frage">Welcher Raum ist das?</h2>
          <div className="grid grid-cols-3 gap-2">
            {RAUMARTEN.map((a) =>
              kachel(a.label, `${usageDefaults(a.usage).temp} °C`, e.artId === a.id,
                () => weiterR({ ...e, artId: a.id, l: a.l, b: a.b }), a.id),
            )}
          </div>
        </>
      );
    } else if (f === 'groesse') {
      inhalt = (
        <>
          <h2 className="assi-frage">Wie groß ist er?</h2>
          <p className="assi-unter">Von Wand zu Wand. Schritte zählen genügt — ein Schritt ist etwa 70 cm.</p>
          <div className="flex gap-2">
            {([['Länge', 'l'], ['Breite', 'b']] as const).map(([label, key]) => (
              <div key={key} className="flex-1 rounded-xl border border-white/[0.08] bg-white/[0.04] p-2.5">
                <div className="label-xs">{label}</div>
                <div className="mt-1 flex items-center gap-2">
                  <button className="assi-rund" onClick={() => setE({ ...e, [key]: Math.max(0.8, Math.round((e[key] - 0.1) * 10) / 10) })}>−</button>
                  <div className="flex-1 text-center text-[22px] font-bold tabular-nums text-slate-50">
                    {e[key].toFixed(1).replace('.', ',')} m
                  </div>
                  <button className="assi-rund" onClick={() => setE({ ...e, [key]: Math.round((e[key] + 0.1) * 10) / 10 })}>+</button>
                </div>
              </div>
            ))}
          </div>
          <p className="assi-unter">ergibt {(e.l * e.b).toFixed(1).replace('.', ',')} m²</p>
          <button className="assi-vor" onClick={() => weiterR()}>Passt</button>
          {weissNicht('Nicht gemessen — dann das übliche Maß', () => {
            const a = raumart(e.artId);
            if (!a) { weiterR(); return; }
            vermerke(`Maße ${a.label}`, `${a.l} × ${a.b} m angenommen`, 'Übliches Maß für diesen Raum — nicht nachgemessen.');
            // Zurück auf das übliche Maß: Der Vermerk sagt „angenommen", und
            // dann muss auch das übliche Maß im Plan stehen, nicht die Zahl,
            // an der jemand vorher noch gedreht hat.
            weiterR({ ...e, l: a.l, b: a.b });
          })}
        </>
      );
    } else if (f === 'fenster') {
      inhalt = (
        <>
          <h2 className="assi-frage">Wie viele Fenster hat der Raum?</h2>
          <div className="grid grid-cols-5 gap-2">
            {[0, 1, 2, 3, 4].map((n) =>
              kachel(String(n), undefined, e.fenster === n, () => weiterR({ ...e, fenster: n }), 'f' + n),
            )}
          </div>
          {weissNicht('Weiß ich nicht — dann eines', () => {
            const a = raumart(e.artId);
            if (a) vermerke(`Fenster ${a.label}`, 'ein Fenster angenommen', 'Nicht gezählt.');
            weiterR({ ...e, fenster: 1 });
          })}
        </>
      );
    } else {
      inhalt = (
        <>
          <h2 className="assi-frage">Hängt dort ein Heizkörper?</h2>
          <div className="grid grid-cols-2 gap-2">
            {kachel('Ja', undefined, false, () => weiterR({ ...e, hk: true }), 'ja')}
            {kachel('Nein', undefined, false, () => weiterR({ ...e, hk: false }), 'nein')}
          </div>
        </>
      );
    }
  } else {
    const annahmen = doc.meta.annahmen ?? [];
    const flaeche = Object.values(doc.rooms).reduce((s, r) => s + (r.area ?? 0), 0);
    kopf = 'Fertig';
    inhalt = (
      <>
        <h2 className="assi-frage">
          {zahl} {zahl === 1 ? 'Raum' : 'Räume'} · {dez(flaeche, 0)} m²
        </h2>
        <p className="assi-unter">
          Alles Weitere steht jetzt im Plan — jede Wand einzeln anzufassen. Die Prüfung sagt, was noch fehlt.
        </p>
        {annahmen.length > 0 && (
          <div className="rounded-xl border border-amber-400/25 bg-amber-400/[0.07] p-3">
            <div className="label-xs text-amber-300">Angenommen, weil nichts vorlag</div>
            <ul className="mt-1.5 space-y-1.5 text-[13.5px] leading-snug text-slate-300">
              {annahmen.map((a) => (
                <li key={a.was}>
                  <b className="text-slate-100">{a.was}</b> — {a.wert}
                  <br />
                  <span className="text-slate-400">{a.grund}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <button
          className="assi-vor"
          onClick={() => {
            onFertig();
            schliessen(false);
            setzeStatus(`Aufnahme fertig — ${zahl} Räume angelegt.`);
          }}
        >
          Weiter zur Prüfung
        </button>
        <button className="assi-neben" onClick={() => { setPhase('raeume'); setRi(0); }}>
          Noch ein Raum
        </button>
        {/*
            Das nächste Stockwerk. Angelegt wird ein **leeres** Geschoss
            darüber — nicht eine Kopie dieses einen: Oben liegen andere Räume,
            und eine Kopie müsste Zimmer für Zimmer wieder auseinandergenommen
            werden. Wer wirklich dasselbe noch einmal braucht, kopiert das
            Geschoss im Geschossblatt; dort gehört diese Entscheidung hin.
        */}
        <button
          className="assi-neben"
          onClick={() => {
            const neu = legeGeschossAn();
            if (!neu) {
              setzeStatus('Das Geschoss ließ sich nicht anlegen.');
              return;
            }
            setLetztes(undefined);
            setRechtecke([]);
            setZahl(0);
            setPhase('raeume');
            setRi(0);
            setzeStatus(`${neu.name} angelegt — jetzt die Räume dieses Geschosses.`);
          }}
        >
          Noch ein Stockwerk
        </button>
      </>
    );
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-40 flex flex-col justify-end">
      <div className="pointer-events-auto panel mx-2 mb-2 max-h-[62%] overflow-y-auto rounded-2xl p-4 lg:ml-auto lg:mr-2 lg:max-h-none lg:w-[380px] lg:self-end">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-accent">{kopf}</span>
          <span className="ml-auto text-[12px] tabular-nums text-slate-400">{unterzeile}</span>
          <button
            className="rounded-lg px-2 py-1 text-[12px] text-slate-400 hover:text-slate-100"
            onClick={() => schliessen(false)}
          >
            Schließen
          </button>
        </div>
        <div className="mb-3 h-1 overflow-hidden rounded bg-white/[0.08]">
          <div className="h-full bg-accent transition-all" style={{ width: `${balken}%` }} />
        </div>
        <div className="flex flex-col gap-3">{inhalt}</div>
        {/*
            Ein Schritt zurück. Auf der Baustelle wird mit dem Handschuh
            getippt, und die Kacheln liegen dicht beieinander — ohne diesen
            Knopf bliebe nach einem Fehlgriff nur, den ganzen Raum falsch
            anzulegen und ihn später im Plan zu reparieren. Er geht nur
            innerhalb der laufenden Fragenfolge zurück: Ein Raum, der steht,
            steht — der wird im Plan geändert und nicht in diesem Blatt.
        */}
        {((phase === 'gebaeude' && gi > 0) || (phase === 'raeume' && ri > 0)) && (
          <button
            className="mt-3 min-h-[44px] w-full rounded-xl border border-white/[0.1] text-[14px] font-medium text-slate-400 hover:text-slate-100"
            onClick={() => (phase === 'gebaeude' ? setGi(gi - 1) : setRi(ri - 1))}
          >
            Zurück
          </button>
        )}
        {phase === 'raeume' && zahl > 0 && ri === 0 && (
          <button className="assi-neben mt-3" onClick={() => setPhase('fertig')}>
            Keine Räume mehr
          </button>
        )}
      </div>
    </div>
  );
}
