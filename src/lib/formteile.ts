/**
 * Formteile des Rohrnetzes — Bögen, T-Stücke, Reduzierungen (seit 1.71.0).
 * ---------------------------------------------------------------------------
 *
 * **Warum es das gibt.** Gemeldet am 02.10.2026: „außerdem müssen auch die
 * Fittinge mitgezählt werden, Steigstränge ebenso." Bis 1.70.0 zählte das
 * Programm Armaturen und Meter, aber kein einziges Formteil. Für die
 * Bestellung fehlte damit ein ganzer Posten, und für den hydraulischen
 * Abgleich in RaVia fehlten die Einzelwiderstände, die an genau diesen
 * Stellen entstehen.
 *
 * **Gezählt wird aus der Geometrie, nicht aus dem Fließweg.** Ein Formteil
 * ist ein Bauteil im Rohr, und das Rohr liegt im Plan. Ob durch ein T-Stück
 * gerade Wasser zu einem Verbraucher fließt, ändert nichts daran, dass es
 * eingebaut wird. Deshalb hängt die Zählung nicht an einer Quelle und
 * stimmt auch dann, wenn das Netz noch nicht an einen Erzeuger angeschlossen
 * ist.
 *
 * **Die Regeln**, je Knoten im Plan (Enden, die auf 4 cm und in der Höhe
 * zusammenfallen, gleiches Medium):
 *
 *  - zwei Abschnitte, Richtungswechsel über 15° → **Bogen 90°**,
 *  - zwei Abschnitte, verschiedene Abmessung → **Reduzierung**,
 *  - drei Abschnitte → **T-Stück**, vier → **zwei T-Stücke**,
 *  - ein Abschnitt allein → Anschluss am Gerät, kein Formteil,
 *  - ein innerer Stützpunkt einer gezeichneten Polylinie mit Knick → Bogen.
 *
 * **Steigleitungen** liegen als senkrechte Leitung im Plan. Sie bekommen
 * unten und oben je einen Bogen — sitzt ein Ende an einer durchlaufenden
 * Leitung, ist es dort ein T-Stück statt eines Bogens. Gezählt werden sie
 * eigens (`steigleitung`), weil sie beim Bestellen getrennt gebraucht werden.
 *
 * **Was nicht gezählt wird:** Pressfittinge an geraden Stößen (die Stangen-
 * länge kennt das Programm nicht), Übergänge auf Armaturen (die stehen als
 * Armatur in der Liste), Wandscheiben und Verschraubungen am Heizkörper.
 */

import type { PipeAccessory, PipeRun, PipeService, Vec2 } from '../types/bim';
import { rohrbezeichnung } from './rohrbezeichnung';
import { trassenlaenge } from './rohrlaenge';

export type FormteilArt = 'bogen-90' | 't-stueck' | 'reduzierung';

export const FORMTEIL_LABELS: Record<FormteilArt, string> = {
  'bogen-90': 'Bogen 90°',
  't-stueck': 'T-Stück',
  reduzierung: 'Reduzierung',
};

export interface Formteil {
  art: FormteilArt;
  /** Rohrmaß, an dem das Formteil sitzt — beim T-Stück das größte. */
  abmessung: string;
  service: PipeService;
  levelId: string;
  /** Am Fuß oder Kopf einer Steigleitung. */
  steigleitung: boolean;
  anzahl: number;
}

/**
 * Fangabstand, in dem zwei Leitungsenden **desselben Mediums** ein Knoten
 * sind [m].
 *
 * Nicht 1 cm, wie man erwarten könnte: Der Rohrausleger legt Vor- und
 * Rücklauf als Paar mit 5 cm Abstand, und an einem Abzweig treffen sich die
 * versetzten Enden nicht in einem Punkt, sondern bis zu 3,5 cm daneben
 * (gemessen am Demohaus). Unter dem Paarabstand bleibt die Schranke trotzdem
 * — gezählt wird ohnehin je Medium, der Rücklauf kann also nicht mit dem
 * Vorlauf verschmelzen.
 */
const FANG = 0.04;
/** Ab diesem Richtungswechsel ist ein Stoß ein Bogen [°]. */
const KNICK_GRAD = 15;
/** Höchstens so lang im Grundriss ist eine senkrechte Leitung [m]. */
const SENKRECHT_PLAN = 0.05;
/** Mindestens so hoch steigt sie [m]. */
const SENKRECHT_HOEHE = 0.1;

interface Ende {
  run: PipeRun;
  /** Richtung vom Knoten weg in die Leitung hinein (Einheitsvektor). */
  richtung: Vec2 | undefined;
  senkrecht: boolean;
}

const einheit = (a: Vec2, b: Vec2): Vec2 | undefined => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l = Math.hypot(dx, dy);
  return l < 1e-9 ? undefined : { x: dx / l, y: dy / l };
};

function istSenkrecht(run: PipeRun): boolean {
  if (run.elevationTo === undefined) return false;
  return trassenlaenge(run.points) <= SENKRECHT_PLAN && Math.abs(run.elevationTo - run.elevation) >= SENKRECHT_HOEHE;
}

/**
 * Alle Formteile des Modells, zusammengefasst nach Art, Medium, Maß und
 * Geschoss. Leitungen mit ungültiger Lage zählen nicht mit — sie stehen als
 * Befund in der Modellprüfung.
 */
export function formteile(runs: readonly PipeRun[], armaturen: readonly PipeAccessory[] = []): Formteil[] {
  const zaehler = new Map<string, Formteil>();
  const zaehle = (f: Omit<Formteil, 'anzahl'>, n = 1): void => {
    if (n <= 0) return;
    const key = `${f.art}|${f.service}|${f.abmessung}|${f.levelId}|${f.steigleitung ? 1 : 0}`;
    const da = zaehler.get(key);
    if (da) da.anzahl += n;
    else zaehler.set(key, { ...f, anzahl: n });
  };

  const gueltig = runs.filter(
    (r) => r.points.length >= 2 && r.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)),
  );

  // --- Knoten aus den Leitungsenden ----------------------------------------
  // Enden werden zu Gruppen verschmolzen, wenn sie desselben Mediums auf
  // demselben Geschoss näher als `FANG` beieinander liegen (Union-Find über
  // ein Raster). Der Schlüssel eines Endes ist danach die Wurzel seiner Gruppe.
  const punkte: { run: PipeRun; p: Vec2; h: number }[] = [];
  for (const run of gueltig) {
    const n = run.points.length;
    punkte.push({ run, p: run.points[0], h: run.elevation });
    punkte.push({ run, p: run.points[n - 1], h: run.elevationTo ?? run.elevation });
  }
  const eltern = punkte.map((_, i) => i);
  const wurzel = (i: number): number => {
    while (eltern[i] !== i) {
      eltern[i] = eltern[eltern[i]];
      i = eltern[i];
    }
    return i;
  };
  const raster = new Map<string, number[]>();
  const zelle = (q: { run: PipeRun; p: Vec2 }, dx = 0, dy = 0): string =>
    `${q.run.levelId}|${q.run.service}|${Math.floor(q.p.x / FANG) + dx}|${Math.floor(q.p.y / FANG) + dy}`;
  punkte.forEach((q, i) => {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const j of raster.get(zelle(q, dx, dy)) ?? []) {
          const o = punkte[j];
          if (Math.hypot(o.p.x - q.p.x, o.p.y - q.p.y) <= FANG && Math.abs(o.h - q.h) <= FANG) {
            eltern[wurzel(i)] = wurzel(j);
          }
        }
      }
    }
    const k = zelle(q);
    raster.set(k, [...(raster.get(k) ?? []), i]);
  });
  const indexVon = new Map<string, number>();
  punkte.forEach((q, i) => indexVon.set(`${q.run.id}|${q.p.x}|${q.p.y}|${q.h}`, i));
  const knoten = new Map<string, Ende[]>();
  const schluessel = (run: PipeRun, p: Vec2, hoehe: number): string =>
    String(wurzel(indexVon.get(`${run.id}|${p.x}|${p.y}|${hoehe}`) ?? -1));

  for (const run of gueltig) {
    const senkrecht = istSenkrecht(run);
    const n = run.points.length;
    const hoeheAnfang = run.elevation;
    const hoeheEnde = run.elevationTo ?? run.elevation;
    const anfang: Ende = { run, richtung: einheit(run.points[0], run.points[1]), senkrecht };
    const ende: Ende = { run, richtung: einheit(run.points[n - 1], run.points[n - 2]), senkrecht };
    for (const [p, h, e] of [
      [run.points[0], hoeheAnfang, anfang],
      [run.points[n - 1], hoeheEnde, ende],
    ] as const) {
      const k = schluessel(run, p, h);
      const liste = knoten.get(k) ?? [];
      liste.push(e);
      knoten.set(k, liste);
    }

    // Innere Stützpunkte einer gezeichneten Polylinie.
    if (!senkrecht) {
      const schranke = Math.cos((KNICK_GRAD * Math.PI) / 180);
      for (let i = 1; i < n - 1; i++) {
        const a = einheit(run.points[i - 1], run.points[i]);
        const b = einheit(run.points[i], run.points[i + 1]);
        if (a && b && a.x * b.x + a.y * b.y < schranke) {
          zaehle({ art: 'bogen-90', abmessung: rohrbezeichnung(run), service: run.service, levelId: run.levelId, steigleitung: false });
        }
      }
    }
  }

  // --- Steigleitungen: Fuß und Kopf -----------------------------------------
  // Eine senkrechte Leitung hat an jedem Ende einen Bogen — es sei denn, dort
  // läuft eine waagerechte Leitung durch; dann ist es ein T-Stück, und das
  // zählt der Knoten selbst.
  for (const run of gueltig) {
    if (!istSenkrecht(run)) continue;
    const n = run.points.length;
    for (const [p, h] of [
      [run.points[0], run.elevation],
      [run.points[n - 1], run.elevationTo ?? run.elevation],
    ] as const) {
      const waagerecht = (knoten.get(schluessel(run, p, h)) ?? []).filter((e) => !e.senkrecht).length;
      if (waagerecht < 2) {
        zaehle({ art: 'bogen-90', abmessung: rohrbezeichnung(run), service: run.service, levelId: run.levelId, steigleitung: true });
      }
    }
  }

  /*
   * --- T-Stücke des Rohrauslegers ------------------------------------------
   *
   * Der Rohrausleger setzt an jedem Abzweig seiner Trasse ein T-Stück als
   * Armatur — an der Mittellinie, bevor Vor- und Rücklauf als Paar
   * auseinandergelegt werden. Das ist die genauere Quelle: An einem Abzweig
   * kreuzen sich die beiden Leitungen des Paares, und die Enden liegen dort
   * so, dass eine Zählung aus der Geometrie Abzweige doppelt sähe. Gezählt
   * wird je Armatur ein T-Stück im Vorlauf und eins im Rücklauf; die Knoten
   * erzeugter Leitungen tragen dann selbst kein T-Stück mehr bei.
   */
  const laufNach = new Map(gueltig.map((r) => [r.id, r] as const));
  for (const a of armaturen) {
    if (a.kind !== 'tee' || !a.generated || !a.runId) continue;
    const run = laufNach.get(a.runId);
    if (!run) continue;
    zaehle({ art: 't-stueck', abmessung: rohrbezeichnung(run), service: run.service, levelId: run.levelId, steigleitung: false });
    const partner = run.pairId ? gueltig.find((r) => r.pairId === run.pairId && r.id !== run.id) : undefined;
    if (partner) {
      zaehle({ art: 't-stueck', abmessung: rohrbezeichnung(partner), service: partner.service, levelId: partner.levelId, steigleitung: false });
    }
  }

  // --- Knoten auswerten -----------------------------------------------------
  const geradeSchranke = -Math.cos((KNICK_GRAD * Math.PI) / 180);
  for (const enden of knoten.values()) {
    const waagerecht = enden.filter((e) => !e.senkrecht);
    const senkrecht = enden.filter((e) => e.senkrecht);
    const alle = waagerecht.length + senkrecht.length;
    if (alle < 2) continue;
    const mass = (r: PipeRun): number => r.outerDiameter ?? r.nominalDiameter;
    const groesste = [...enden].sort((a, b) => mass(b.run) - mass(a.run))[0].run;
    const basis = {
      abmessung: rohrbezeichnung(groesste),
      service: groesste.service,
      levelId: groesste.levelId,
    };
    // Mit Steigleitung: Ab zwei waagerechten Leitungen ist der Fuß ein T.
    if (senkrecht.length && waagerecht.length >= 2) {
      zaehle({ ...basis, art: 't-stueck', steigleitung: true }, alle - 2);
      continue;
    }
    if (senkrecht.length) continue; // Bogen am Strangende ist oben gezählt.

    if (alle === 2) {
      const [a, b] = waagerecht;
      /*
       * Beide Leitungen verlassen den Knoten in **dieselbe** Richtung: Sie
       * liegen übereinander (zwei Stränge ab demselben Punkt, nebeneinander
       * geführt). Das ist kein Bogen und keine Reduzierung — welches
       * Formteil dort sitzt, sagt die Geometrie nicht, also wird keins
       * gezählt. Am Referenzhaus wären es sonst Bögen um 180°.
       */
      if (a.richtung && b.richtung && a.richtung.x * b.richtung.x + a.richtung.y * b.richtung.y >= -geradeSchranke) continue;
      // Gerade weiter: die beiden Richtungen vom Knoten weg zeigen entgegen.
      const gerade = a.richtung && b.richtung ? a.richtung.x * b.richtung.x + a.richtung.y * b.richtung.y <= geradeSchranke : true;
      if (!gerade) zaehle({ ...basis, art: 'bogen-90', steigleitung: false });
      if (rohrbezeichnung(a.run) !== rohrbezeichnung(b.run)) {
        const [gross, klein] = mass(a.run) >= mass(b.run) ? [a.run, b.run] : [b.run, a.run];
        zaehle({ ...basis, abmessung: `${rohrbezeichnung(gross)} auf ${rohrbezeichnung(klein)}`, art: 'reduzierung', steigleitung: false });
      }
      continue;
    }
    // Drei Enden ein T-Stück, vier zwei — jedes weitere ein weiteres. Nur bei
    // gezeichneten Leitungen; erzeugte bringen ihr T-Stück als Armatur mit.
    if (waagerecht.every((e) => e.run.generated)) continue;
    zaehle({ ...basis, art: 't-stueck', steigleitung: false }, alle - 2);
  }

  const reihenfolge: FormteilArt[] = ['bogen-90', 't-stueck', 'reduzierung'];
  return [...zaehler.values()].sort(
    (a, b) =>
      reihenfolge.indexOf(a.art) - reihenfolge.indexOf(b.art) ||
      a.service.localeCompare(b.service) ||
      a.abmessung.localeCompare(b.abmessung, 'de', { numeric: true }) ||
      a.levelId.localeCompare(b.levelId),
  );
}

/** Summe je Art — für Meldung und Bericht. */
export function formteilSumme(liste: readonly Formteil[]): Record<FormteilArt, number> {
  const s: Record<FormteilArt, number> = { 'bogen-90': 0, 't-stueck': 0, reduzierung: 0 };
  for (const f of liste) s[f.art] += f.anzahl;
  return s;
}
