/**
 * Treppenlogik — Steigung, Auftritt und das Loch in der Decke.
 * ---------------------------------------------------------------------------
 * **Der Anlass.** Im 3D-Modell war eine Treppe nur in dem Geschoss zu sehen,
 * dem sie gehört. Sah man von oben auf das Obergeschoss, lag dort ein
 * geschlossener Fußboden, und die Treppe darunter stieß gegen ihn. Gemeldet
 * als „Treppen sollten auch in 3D so dargestellt werden … da muss eine
 * Treppenlogik dahinter."
 *
 * Eine Treppe ist eben nicht ein Bauteil in einem Geschoss, sondern die
 * Verbindung zweier Geschosse. Dazu gehören drei Größen, und alle drei
 * folgen aus der **Geschosshöhe**:
 *
 *  · **Wie viele Steigungen** — die Geschosshöhe wird in gleiche Stufen
 *    geteilt. Alle Steigungen eines Laufs sind gleich hoch; eine einzelne
 *    abweichende Stufe ist die klassische Stolperstelle.
 *  · **Wie tief der Auftritt** — aus der Schrittmaßregel.
 *  · **Wo die Decke darüber aufhört** — die lichte Durchgangshöhe. Das ist
 *    die eigentliche Treppenlogik: Das Loch im oberen Fußboden ist kein
 *    Gestaltungsmaß, sondern genau der Bereich, in dem man sonst den Kopf
 *    anstößt.
 *
 * **Die Zahlen sind belegt, nicht gesetzt.** DIN 18065 „Gebäudetreppen —
 * Begriffe, Messregeln, Hauptmaße" gibt für die notwendige Treppe im
 * Wohngebäude mit bis zu zwei Wohnungen die nutzbare Laufbreite mit
 * mindestens 80 cm an, die Steigung mit 140 bis 200 mm und den Auftritt mit
 * 230 bis 370 mm. Die lichte Durchgangshöhe steht in Abschnitt 6.4 und gilt
 * **einheitlich für alle Gebäudearten mit 200 cm**; gemessen wird sie als
 * kleinstes senkrechtes Fertigmaß zwischen der Linie entlang der
 * Stufenvorderkanten und der Unterkante des darüber liegenden Bauteils.
 *
 * Die Schrittmaßregel `2s + a = 59 bis 65 cm` ist keine Norm, sondern die
 * anerkannte Planungsformel; sie steht hier als **Vorgabe** für den
 * Auftritt, wenn keiner gesetzt ist, und als Befund, wenn einer danebenliegt.
 *
 * Reine Geometrie und Arithmetik: keine Zeichenbibliothek, kein Zustand.
 */

import type { Vec2, VerticalElement } from '../types/bim';
import { stairPath, stairRunLength } from './verticalSymbols';

// ---------------------------------------------------------------------------
// Die Maße der DIN 18065
// ---------------------------------------------------------------------------

/**
 * Grenzwerte für die notwendige Treppe im Wohngebäude mit bis zu zwei
 * Wohnungen [m]. Andere Gebäudearten haben engere Grenzen; CAD Light plant
 * Ein- und Zweifamilienhäuser, und eine Grenze zu nennen, die für das
 * geplante Gebäude nicht gilt, wäre schlechter als keine.
 */
export const TREPPE_GRENZEN = {
  /** Kleinste nutzbare Laufbreite. */
  laufbreiteMin: 0.8,
  /** Steigung — kleinstes und größtes Maß. */
  steigungMin: 0.14,
  steigungMax: 0.2,
  /** Auftritt — kleinstes und größtes Maß. */
  auftrittMin: 0.23,
  auftrittMax: 0.37,
  /** Schrittmaß `2s + a`. */
  schrittmassMin: 0.59,
  schrittmassMax: 0.65,
} as const;

/**
 * Lichte Durchgangshöhe [m] — DIN 18065 Abschnitt 6.4, für alle Gebäudearten.
 *
 * Sie ist der Grund, warum es überhaupt ein Loch in der Decke gibt: Wo über
 * der Stufenvorderkante weniger als dieses Maß frei ist, muss die Decke
 * geöffnet werden.
 */
export const DURCHGANGSHOEHE = 2.0;

/**
 * Steigung, auf die hin geteilt wird, wenn nichts anderes gesagt ist [m].
 *
 * 17,5 cm liegt in der Mitte zwischen den beiden Grenzen und ergibt mit der
 * Schrittmaßregel einen Auftritt von 28 cm — die Treppe, die im Wohnungsbau
 * am häufigsten gebaut wird. Sie ist eine **Vorgabe** und keine Vorschrift:
 * Wer eine Stufenzahl einträgt, bekommt seine.
 */
const STEIGUNG_VORGABE = 0.175;

/** Mitte des Schrittmaßbereichs [m] — daraus folgt der Auftritt. */
const SCHRITTMASS_VORGABE = 0.63;

// ---------------------------------------------------------------------------
// Die Maße einer Treppe
// ---------------------------------------------------------------------------

export interface Treppenbefund {
  schwere: 'info' | 'warn';
  text: string;
}

export interface Treppenmasse {
  /** Überwundene Höhe [m] — von Oberkante Fußboden bis Oberkante Fußboden. */
  geschosshoehe: number;
  /** Anzahl der Steigungen. */
  steigungen: number;
  /** Höhe einer Steigung [m]. */
  steigung: number;
  /** Tiefe eines Auftritts [m]. */
  auftritt: number;
  /**
   * Zahl der Auftritte — **eine weniger als Steigungen**.
   *
   * Die oberste Trittfläche ist der Fußboden des oberen Geschosses; sie
   * gehört zur Decke und nicht zur Treppe. Wer hier gleich viele zählt,
   * baut die Treppe einen Auftritt zu lang und trifft den Austritt nicht.
   */
  auftritte: number;
  /** Lauflänge im Grundriss [m] — `auftritte · auftritt`. */
  laufLaenge: number;
  /** Schrittmaß `2s + a` [m]. */
  schrittmass: number;
  /** Was an dieser Treppe zu sagen ist. */
  befunde: Treppenbefund[];
}

/*
 * **Hier wird nicht gerundet**, und das ist keine Nachlässigkeit.
 *
 * Sechzehn Steigungen auf 3,00 m sind 187,5 mm. Rundete man sie auf 188 mm,
 * ergäbe die Treppe 3008 mm und passte nicht mehr zwischen die Geschosse —
 * die letzte Stufe wäre 8 mm niedriger, genau die Stolperstelle, die die
 * Regel „alle Steigungen gleich hoch" verhindern soll. Die Steigung ist eine
 * Rechengröße; gerundet wird erst bei der Anzeige.
 */

/**
 * Die Maße einer Treppe aus der Geschosshöhe.
 *
 * `steigungen` aus dem Bauteil geht vor: Wer die Stufen gezählt hat, hat
 * recht, auch wenn die Steigung dann außerhalb der Grenzen liegt — das steht
 * dann als Befund da und wird nicht stillschweigend korrigiert. Ohne Angabe
 * wird auf die Vorgabesteigung geteilt und **gerundet**: Eine Treppe hat
 * ganze Stufen.
 *
 * `auftritt` kommt aus der Schrittmaßregel und wird auf die Grenzen der
 * Norm beschnitten. Ist im Bauteil eine Lauflänge erfasst, die kürzer ist
 * als der so gerechnete Lauf, bleibt sie stehen — das Bauteil steht im
 * Grundriss und hat dort seinen Platz; der zu knappe Auftritt ist dann der
 * Befund.
 */
export function treppenmasse(
  geschosshoehe: number,
  bauteil?: { steps?: number; laufLaenge?: number; laufbreite?: number },
): Treppenmasse {
  const befunde: Treppenbefund[] = [];
  const h = Number.isFinite(geschosshoehe) && geschosshoehe > 0 ? geschosshoehe : 0;

  const gesetzt = bauteil?.steps;
  const steigungen =
    gesetzt !== undefined && Number.isFinite(gesetzt) && gesetzt >= 2
      ? Math.round(gesetzt)
      : Math.max(2, Math.round(h / STEIGUNG_VORGABE));
  const steigung = h > 0 ? h / steigungen : 0;

  // Der Auftritt aus der Schrittmaßregel, beschnitten auf die Grenzen.
  const ausRegel = SCHRITTMASS_VORGABE - 2 * steigung;
  const auftritt = Math.min(
    TREPPE_GRENZEN.auftrittMax,
    Math.max(TREPPE_GRENZEN.auftrittMin, ausRegel),
  );
  const auftritte = Math.max(1, steigungen - 1);
  const laufLaenge = auftritte * auftritt;
  const schrittmass = 2 * steigung + auftritt;

  if (h <= 0) {
    befunde.push({
      schwere: 'warn',
      text: 'Ohne Geschosshöhe lässt sich keine Treppe teilen — die Höhenlage der Geschosse fehlt.',
    });
    return { geschosshoehe: 0, steigungen, steigung: 0, auftritt, auftritte, laufLaenge, schrittmass, befunde };
  }

  if (steigung > TREPPE_GRENZEN.steigungMax + 1e-9) {
    befunde.push({
      schwere: 'warn',
      text:
        `Die Steigung ist ${(steigung * 100).toFixed(1).replace('.', ',')} cm und damit über dem Höchstmaß von ` +
        `${(TREPPE_GRENZEN.steigungMax * 100).toFixed(0)} cm (DIN 18065, Wohngebäude bis zwei Wohnungen). ` +
        `Bei ${steigungen + 1} Steigungen wären es ${((h / (steigungen + 1)) * 100).toFixed(1).replace('.', ',')} cm.`,
    });
  }
  if (steigung < TREPPE_GRENZEN.steigungMin - 1e-9) {
    befunde.push({
      schwere: 'warn',
      text:
        `Die Steigung ist ${(steigung * 100).toFixed(1).replace('.', ',')} cm und damit unter dem Kleinstmaß von ` +
        `${(TREPPE_GRENZEN.steigungMin * 100).toFixed(0)} cm (DIN 18065). Eine flachere Treppe braucht mehr Platz, als sie nützt.`,
    });
  }
  if (ausRegel < TREPPE_GRENZEN.auftrittMin - 1e-9) {
    befunde.push({
      schwere: 'info',
      text:
        `Der Auftritt steht auf dem Kleinstmaß von ${(TREPPE_GRENZEN.auftrittMin * 100).toFixed(0)} cm; ` +
        `die Schrittmaßregel gäbe ${(ausRegel * 100).toFixed(1).replace('.', ',')} cm. Das Schrittmaß beträgt damit ` +
        `${(schrittmass * 100).toFixed(1).replace('.', ',')} cm.`,
    });
  }
  if (schrittmass < TREPPE_GRENZEN.schrittmassMin - 1e-9 || schrittmass > TREPPE_GRENZEN.schrittmassMax + 1e-9) {
    befunde.push({
      schwere: 'info',
      text:
        `Das Schrittmaß 2s + a beträgt ${(schrittmass * 100).toFixed(1).replace('.', ',')} cm und liegt außerhalb der ` +
        `Planungsregel von ${(TREPPE_GRENZEN.schrittmassMin * 100).toFixed(0)} bis ` +
        `${(TREPPE_GRENZEN.schrittmassMax * 100).toFixed(0)} cm.`,
    });
  }
  if (bauteil?.laufbreite !== undefined && bauteil.laufbreite < TREPPE_GRENZEN.laufbreiteMin - 1e-9) {
    befunde.push({
      schwere: 'warn',
      text:
        `Die Laufbreite ist ${(bauteil.laufbreite * 100).toFixed(0)} cm; DIN 18065 fordert für die notwendige Treppe ` +
        `im Wohngebäude mindestens ${(TREPPE_GRENZEN.laufbreiteMin * 100).toFixed(0)} cm.`,
    });
  }
  if (bauteil?.laufLaenge !== undefined && bauteil.laufLaenge + 1e-6 < laufLaenge) {
    befunde.push({
      schwere: 'warn',
      text:
        `Der Lauf misst im Grundriss ${bauteil.laufLaenge.toFixed(2).replace('.', ',')} m; für ${auftritte} Auftritte ` +
        `à ${(auftritt * 100).toFixed(1).replace('.', ',')} cm wären ${laufLaenge.toFixed(2).replace('.', ',')} m nötig. ` +
        'Entweder wird die Treppe gewendelt oder der Auftritt fällt kleiner aus.',
    });
  }

  return {
    geschosshoehe: h,
    steigungen,
    steigung: steigung,
    auftritt: auftritt,
    auftritte,
    laufLaenge: laufLaenge,
    schrittmass: schrittmass,
    befunde,
  };
}

// ---------------------------------------------------------------------------
// Das Loch in der Decke
// ---------------------------------------------------------------------------

/**
 * Ab welcher Weglänge auf der Lauflinie die Decke offen sein muss [m].
 *
 * Die Stufenvorderkante liegt nach der Weglänge `d` auf der Höhe
 * `d · s / a` über dem unteren Fußboden. Offen sein muss es, sobald darüber
 * weniger als die lichte Durchgangshöhe bleibt:
 *
 *     d · s / a + 2,00 m > Unterkante der Decke
 *
 * Aufgelöst nach `d`. Ist die Decke niedriger als die Durchgangshöhe — beim
 * Zwischenpodest oder einer sehr flachen Geschosshöhe —, ist der ganze Lauf
 * offen; dann kommt null heraus, und das ist richtig.
 */
export function oeffnungAb(masse: Treppenmasse, deckenUnterkante: number): number {
  if (masse.steigung <= 1e-9) return 0;
  const frei = deckenUnterkante - DURCHGANGSHOEHE;
  if (frei <= 0) return 0;
  return Math.max(0, (frei * masse.auftritt) / masse.steigung);
}

/**
 * Der Umriss des Lochs, das die Treppe in die Decke über sich schneidet.
 * ---------------------------------------------------------------------------
 * Das Loch folgt der **Lauflinie**, nicht dem Rechteck des Bauteils: Bei der
 * gewendelten Treppe biegt der Lauf ab, und das Loch biegt mit. Gebildet wird
 * es als Streifen der Laufbreite links und rechts der Lauflinie, von der
 * Stelle an, ab der die Kopffreiheit fehlt, bis zum Austritt.
 *
 * **Warum die volle Breite** und nicht die halbe bei der halbgewendelten
 * Treppe: Das Loch muss den Lauf freigeben, und der belegt bei zwei Läufen
 * nebeneinander die ganze Grundrissbreite. Ein Loch über nur einem Lauf
 * ließe den Aufsteigenden am zweiten anstoßen.
 *
 * Weniger als drei Punkte gibt es nicht — dann ist das Ergebnis leer, und
 * der Aufrufer schneidet nichts. Ein Loch, das keine Fläche hat, ist keins.
 */
export function treppenoeffnung(
  v: VerticalElement,
  masse: Treppenmasse,
  deckenUnterkante: number,
): Vec2[] {
  if (v.kind === 'shaft') return [];
  const gesamt = stairRunLength(v);
  if (gesamt < 1e-6) return [];

  const ab = Math.min(oeffnungAb(masse, deckenUnterkante), gesamt);
  const halb = Math.max(0.05, v.width / 2);

  /** Punkt und Richtung auf der Lauflinie bei der Weglänge `d`. */
  const path = stairPath(v);
  const an = (d: number): { p: Vec2; dir: Vec2 } => {
    let rest = Math.max(0, Math.min(gesamt, d));
    for (let i = 1; i < path.length; i += 1) {
      const seg = Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.y - path[i - 1]!.y);
      if (rest <= seg || i === path.length - 1) {
        const t = seg > 1e-9 ? rest / seg : 0;
        return {
          p: {
            x: path[i - 1]!.x + (path[i]!.x - path[i - 1]!.x) * t,
            y: path[i - 1]!.y + (path[i]!.y - path[i - 1]!.y) * t,
          },
          dir: { x: (path[i]!.x - path[i - 1]!.x) / (seg || 1), y: (path[i]!.y - path[i - 1]!.y) / (seg || 1) },
        };
      }
      rest -= seg;
    }
    const letzt = path[path.length - 1]!;
    return { p: letzt, dir: { x: 1, y: 0 } };
  };

  /*
   * Stützstellen: die beiden Enden und die Knicke der Lauflinie dazwischen.
   * Ohne die Knicke schnitte das Loch bei der gewendelten Treppe die Kurve
   * ab — genau dort, wo der Kopf sitzt.
   */
  const stellen: number[] = [ab];
  let weg = 0;
  for (let i = 1; i < path.length - 1; i += 1) {
    weg += Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.y - path[i - 1]!.y);
    if (weg > ab + 1e-6 && weg < gesamt - 1e-6) stellen.push(weg);
  }
  stellen.push(gesamt);
  if (stellen[stellen.length - 1]! - stellen[0]! < 1e-6) return [];

  const links: Vec2[] = [];
  const rechts: Vec2[] = [];
  for (const d of stellen) {
    const { p, dir } = an(d);
    const nx = -dir.y * halb;
    const ny = dir.x * halb;
    links.push({ x: p.x + nx, y: p.y + ny });
    rechts.push({ x: p.x - nx, y: p.y - ny });
  }
  return [...links, ...rechts.reverse()];
}

/**
 * Die Fläche eines Polygons [m²] — als Maß dafür, dass ein Loch eines ist.
 *
 * Der Betrag der Gaußschen Trapezformel; die Umlaufrichtung ist gleichgültig,
 * weil ein Loch keine Orientierung hat.
 */
export function polygonflaeche(punkte: readonly Vec2[]): number {
  if (punkte.length < 3) return 0;
  let zwei = 0;
  for (let i = 0; i < punkte.length; i += 1) {
    const a = punkte[i]!;
    const b = punkte[(i + 1) % punkte.length]!;
    zwei += a.x * b.y - b.x * a.y;
  }
  return Math.abs(zwei) / 2;
}
