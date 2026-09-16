/**
 * Wie viele Rohrmeter liegen in welchem Raum?
 * ---------------------------------------------------------------------------
 * **Warum diese Frage überhaupt gestellt wird.** Ein Heizkreisverteiler in der
 * Diele sammelt alle Kreise des Geschosses; über den Flur laufen sie gebündelt
 * ab. Diese Leitungen geben Wärme ab — im Flur, nicht dort, wo sie hinführen.
 * Der Anwender hat es genau so gesagt: „In diesem Fall würde der Flur
 * mitgenommen werden, da dort verteilt wird."
 *
 * Für die Heizlast ist das keine Kleinigkeit. Ein ungedämmtes 16er Rohr im
 * Estrich gibt bei 55 °C Vorlauf und 20 °C Raumtemperatur eine
 * zweistellige Wattzahl je Meter ab; zwanzig Meter gebündelte Anbindeleitung
 * decken die Heizlast eines Flurs unter Umständen vollständig. Wer den Flur
 * trotzdem mit einem Heizkörper versieht, baut ihn doppelt beheizt.
 *
 * **Was hier *nicht* gerechnet wird — und warum.** Die Wärmeabgabe selbst.
 * Sie folgt aus Vorlauftemperatur, Dämmstärke, Rohrwerkstoff, Verlegeart und
 * der Umgebung des Rohres, und ihr Verfahren steht in DIN EN 12831-1 und
 * DIN EN 1264. Das ist die Aufgabe der Heizlastberechnung, nicht die der
 * Datenerfassung. CAD Light liefert das, was die Rechnung braucht und nur
 * die Zeichnung weiß: **wo** die Meter liegen, getrennt nach Gewerk,
 * Nennweite und Dämmstärke. Eine Wattzahl hier auszurechnen hieße, dieselbe
 * Physik an zwei Stellen zu führen — und die zweite Stelle altert.
 *
 * **Die Zuordnung ist geometrisch, nicht logisch.** Ein Abschnitt zählt zu
 * dem Raum, über dessen lichter Fläche er liegt, und nicht zu dem
 * Verbraucher, zu dem er führt. Das ist der Unterschied, um den es geht:
 * Die Anbindeleitung zum Bad gehört wärmetechnisch dem Flur, durch den sie
 * läuft.
 *
 * **Geometrisch heißt aber nicht geschossvergessen.** Ein Grundriss liegt über
 * dem anderen: Die lichte Fläche des Wohnzimmers im Erdgeschoss deckt sich in
 * x und y mit der des Zimmers darüber. Ein Abschnitt wird deshalb nur gegen
 * die Räume *seines* Geschosses gehalten. Ohne diese Einschränkung landen die
 * Meter des Obergeschosses im Erdgeschoss — je nachdem, welcher Raum in der
 * Liste zufällig zuerst steht. Genau das ist beim ersten Entwurf passiert und
 * dem Sollstand des Referenzhauses aufgefallen: Dort trug das Erdgeschoss
 * plötzlich die doppelte Rohrlänge und das Obergeschoss keine.
 *
 * **Teilstücke werden geteilt.** Ein Abschnitt, der durch drei Räume läuft,
 * wird an den Raumgrenzen zerlegt; jeder Raum bekommt seinen Anteil. Ohne das
 * hinge die Zuordnung daran, wo zufällig ein Stützpunkt gesetzt wurde.
 * Getroffen wird die Grenze durch Halbierung — der begehbare Bereich ist
 * abschnittsweise ein Polygon, und für ein Polygon ist der Schnittpunkt mit
 * einer Strecke monoton in der Laufvariablen, sobald man nahe genug ist.
 * Zwölf Halbierungen treffen ihn auf 0,25 mm genau bei einem Meter Strecke;
 * feiner als das misst niemand ein Rohr ein.
 */

import type { PipeRun, PipeService, Room, Vec2 } from '../types/bim';
import { pointInPolygon } from './geometry';

/** Rohrmeter eines Raums, nach Gewerk, Nennweite und Dämmstärke getrennt. */
export interface RohrAnteil {
  service: PipeService;
  /** Nennweite DN [mm]. */
  nominalDiameter: number;
  /** Dämmstärke [mm]; 0 = ungedämmt. */
  insulation: number;
  /** Trassenlänge in diesem Raum [m] — Grundriss, ohne Höhenversatz. */
  length: number;
}

/** Wie fein die Raumgrenze getroffen wird [Halbierungsschritte]. */
const HALBIERUNGEN = 12;
/** Feinheit der Abtastung entlang eines Abschnitts [m]. */
const ABTASTUNG = 0.05;

/**
 * In welchem Raum liegt dieser Punkt? `-1`, wenn in keinem.
 *
 * Die Reihenfolge entscheidet bei Überschneidungen — die es bei sauber
 * erkannten Räumen nicht gibt, weil die lichten Flächen an den Wandflächen
 * enden.
 */
function raumAn(p: Vec2, polygone: readonly (readonly Vec2[])[]): number {
  for (let i = 0; i < polygone.length; i++) {
    if (pointInPolygon(p, polygone[i])) return i;
  }
  return -1;
}

const zwischen = (a: Vec2, b: Vec2, t: number): Vec2 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

/**
 * Die Rohrmeter je Raum.
 *
 * Rückgabe: Raumkennung → Anteile. Räume ohne Rohr fehlen. Meter über keinem
 * erkannten Raum — über einer Wand, in einem Schacht, außerhalb des
 * Grundrisses — fallen heraus; sie einem Nachbarraum zuzuschlagen wäre eine
 * Behauptung.
 */
export function rohrmeterJeRaum(
  pipes: readonly PipeRun[],
  rooms: readonly Room[],
): Map<string, RohrAnteil[]> {
  const brauchbar = rooms.filter((r) => r.innerPolygon.length >= 3);
  /** Räume je Geschoss — ein Abschnitt sieht nur sein eigenes. */
  const jeGeschoss = new Map<string, Room[]>();
  for (const r of brauchbar) {
    const liste = jeGeschoss.get(r.levelId);
    if (liste) liste.push(r);
    else jeGeschoss.set(r.levelId, [r]);
  }
  const ergebnis = new Map<string, Map<string, RohrAnteil>>();

  const buche = (raeume: readonly Room[], raumIndex: number, run: PipeRun, laenge: number): void => {
    if (raumIndex < 0 || laenge <= 0) return;
    const raum = raeume[raumIndex];
    const schluessel = `${run.service}|${run.nominalDiameter}|${run.insulation}`;
    let tabelle = ergebnis.get(raum.id);
    if (!tabelle) {
      tabelle = new Map();
      ergebnis.set(raum.id, tabelle);
    }
    const vorhanden = tabelle.get(schluessel);
    if (vorhanden) {
      vorhanden.length += laenge;
    } else {
      tabelle.set(schluessel, {
        service: run.service,
        nominalDiameter: run.nominalDiameter,
        insulation: run.insulation,
        length: laenge,
      });
    }
  };

  for (const run of pipes) {
    const raeume = jeGeschoss.get(run.levelId) ?? [];
    if (!raeume.length) continue;
    const polygone = raeume.map((r) => r.innerPolygon);

    for (let i = 1; i < run.points.length; i++) {
      const a = run.points[i - 1];
      const b = run.points[i];
      const gesamt = Math.hypot(b.x - a.x, b.y - a.y);
      if (gesamt < 1e-9) continue;

      // Der Abschnitt wird abgetastet; wechselt der Raum zwischen zwei
      // Proben, wird die Grenze dazwischen eingegabelt. Reine Abtastung ohne
      // Gabelung verschöbe jede Raumgrenze um bis zu einer halben Probe, und
      // das summiert sich über ein Rohrnetz zu Metern.
      const schritte = Math.max(1, Math.ceil(gesamt / ABTASTUNG));
      let tVon = 0;
      let raumVon = raumAn(a, polygone);

      for (let k = 1; k <= schritte; k++) {
        const t = k / schritte;
        const raumHier = raumAn(zwischen(a, b, t), polygone);
        if (raumHier === raumVon) continue;

        let lo = (k - 1) / schritte;
        let hi = t;
        for (let n = 0; n < HALBIERUNGEN; n++) {
          const m = (lo + hi) / 2;
          if (raumAn(zwischen(a, b, m), polygone) === raumVon) lo = m;
          else hi = m;
        }
        const grenze = (lo + hi) / 2;
        buche(raeume, raumVon, run, (grenze - tVon) * gesamt);
        tVon = grenze;
        raumVon = raumHier;
      }
      buche(raeume, raumVon, run, (1 - tVon) * gesamt);
    }
  }

  const raus = new Map<string, RohrAnteil[]>();
  for (const [raumId, tabelle] of ergebnis) {
    const liste = [...tabelle.values()].sort(
      (x, y) => x.service.localeCompare(y.service) || x.nominalDiameter - y.nominalDiameter,
    );
    raus.set(raumId, liste);
  }
  return raus;
}
