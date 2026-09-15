/**
 * Halten die Heizflächen noch mit der Heizlast Schritt?
 * ---------------------------------------------------------------------------
 * **Was dieses Modul entscheidet — und was nicht.** Es rechnet aus, welche
 * Normleistung jede Heizfläche haben müsste, vergleicht sie mit der, die am
 * Objekt steht, und sagt, welche davon **nachgezogen werden dürfen**. Es
 * schreibt selbst nichts; das tut der Speicher. Diese Trennung ist der
 * Grund, warum sich die Regel prüfen lässt, ohne eine Oberfläche zu starten.
 *
 * **Die Regel in einem Satz:** Nachgezogen wird nur, was das Programm selbst
 * gesetzt hat.
 *
 * Eine Zahl aus einem Datenblatt oder aus RaVia bleibt stehen, auch wenn sie
 * nicht zur Heizlast passt — sie ist dann nämlich nicht falsch, sondern eine
 * Aussage über den vorhandenen Heizkörper, und der Widerspruch zur Heizlast
 * ist genau das Ergebnis, das der Planer sehen will: *diese Fläche reicht
 * nicht*. Ein Werkzeug, das an dieser Stelle „hilfreich" korrigiert,
 * vernichtet den Befund, wegen dessen die Sanierung geplant wird.
 *
 * Schichtgrenze: nur Typen und andere lib-Bausteine.
 */

import type { BimDocument, Fixture } from '../types/bim';
import { leistungNachziehbar } from '../types/bim';
import { estimateHeatLoad } from './heatLoadEstimate';
import { systemtemperaturVon } from './systemtemperatur';
import {
  anteilJeHeizflaeche,
  istHeizflaeche,
  leistungsBegruendung,
  normleistungFuerHeizlast,
} from './heizflaechenLeistung';

/** Was an einer Heizfläche zu tun wäre. */
export interface Heizflaechenbefund {
  fixtureId: string;
  roomName: string;
  /** Leistung, die am Objekt steht [W] — `undefined`, wenn keine erfasst ist. */
  ist?: number;
  /** Leistung, die nötig wäre [W]. */
  soll: number;
  /** Begründung im Klartext, für Inspektor und Heft. */
  begruendung: string;
  /** Darf das Programm sie selbst setzen? */
  nachziehbar: boolean;
  /** Zahl der Heizflächen, auf die die Raumlast verteilt wurde. */
  anzahl: number;
}

/**
 * Um wie viel darf die vorhandene Leistung abweichen, ohne dass etwas
 * geschieht?
 *
 * **Zwei Prozent, und das ist kein Feinschliff.** Ohne Totzone schriebe jede
 * Rundung der Heizlast eine neue Leistung an jeden Heizkörper — und damit bei
 * jeder Eingabe einen neuen Schritt in die Historie. Zwei Prozent liegen
 * unter der Auflösung, mit der Heizflächen überhaupt lieferbar sind.
 */
const TOTZONE = 0.02;

/**
 * Die Auslegungstemperaturen, auf die sich der Vergleich bezieht.
 *
 * Sie kommen aus der Anlage und **nicht** aus einer festen Zahl: Ein
 * Heizkörperprojekt an einer Wärmepumpe fährt 50/40, ein Neubau mit
 * Flächenheizung 35/28, und genau dieser Unterschied ist der Grund, warum
 * derselbe Heizkörper einmal reicht und einmal nicht.
 */
function systemtemperaturen(doc: BimDocument): { vorlauf: number; ruecklauf: number } {
  /*
   * **Die maßgebliche Temperatur der Anlage, nicht die Zahl im Anlagenblatt.**
   *
   * Der erste Entwurf dieses Moduls las `doc.plant.design` — und stolperte
   * damit in genau den Fehler, den der Kommentar darüber beschrieb: Das
   * Anlagenblatt trägt bei einer Wärmepumpenanlage oft 35/28, weil es die
   * Flächenheizung beschreibt. Ein Heizkörperkreis wird davon auf mindestens
   * 50/40 angehoben, und nur diese angehobene Temperatur fährt die Anlage
   * wirklich.
   *
   * Mit 35/28 gerechnet wäre jede Heizfläche gegen eine Übertemperatur
   * bewertet worden, die nie anliegt: Die geforderte Normleistung fiele um
   * rund den Faktor drei zu groß aus, und das Programm meldete
   * reihenweise „Heizkörper zu klein" für Flächen, die reichen. Das ist die
   * gefährliche Richtung — sie erzeugt Austauschbedarf, den es nicht gibt.
   */
  return systemtemperaturVon(doc);
}

/**
 * Alle Heizflächen gegen die Heizlast ihres Raums halten.
 *
 * Liefert eine leere Liste, wenn sich nichts vergleichen lässt — keine
 * Anlage, keine Räume, keine Heizflächen. Das ist kein Fehler: Im frühen
 * Aufmaß ist das der Normalzustand.
 */
export function heizflaechenBefunde(doc: BimDocument): Heizflaechenbefund[] {
  return befunde(doc, { totzone: TOTZONE });
}

/**
 * Der gemeinsame Kern beider Abfragen.
 *
 * `nurFixture` grenzt auf ein Bauteil ein — der Inspektor fragt nach einem
 * und soll nicht alle Räume durchrechnen lassen, um es zu bekommen.
 */
function befunde(
  doc: BimDocument,
  opt: { nurFixture?: string; totzone: number },
): Heizflaechenbefund[] {
  const temps = systemtemperaturen(doc);

  const heizflaechen = Object.values(doc.fixtures).filter((f) => istHeizflaeche(f.type));
  if (!heizflaechen.length) return [];

  /*
   * Je Raum zählen, wie viele Heizflächen darin stehen — **vor** der
   * Umrechnung. Wer das im Durchlauf zählte, gäbe dem ersten Heizkörper die
   * volle Last und dem zweiten die halbe, je nach Reihenfolge im Objekt.
   */
  const proRaum = new Map<string, Fixture[]>();
  for (const f of heizflaechen) {
    if (!f.roomId) continue;
    const liste = proRaum.get(f.roomId) ?? [];
    liste.push(f);
    proRaum.set(f.roomId, liste);
  }
  if (!proRaum.size) return [];

  const lasten = estimateHeatLoad(doc).rooms;
  const befunde: Heizflaechenbefund[] = [];

  for (const [roomId, flaechen] of proRaum) {
    const last = lasten.find((r) => r.roomId === roomId);
    if (!last) continue;
    /*
     * Vorrang hat die **gerechnete** Norm-Heizlast, falls RaVia sie
     * zurückgeschrieben hat; sonst der Überschlag dieses Programms. Dieselbe
     * Rangfolge wie beim Belegen mit Fußbodenheizung — zwei Stellen mit
     * verschiedener Rangfolge wären zwei verschiedene Anlagen.
     */
    const gesamt = last.normHeatLoad ? last.normHeatLoad.total : last.total;
    if (!Number.isFinite(gesamt) || gesamt <= 0) continue;
    const anteil = anteilJeHeizflaeche(gesamt, flaechen.length);

    for (const f of flaechen) {
      /*
       * **Die Temperatur der Anlage gilt, nicht die am Objekt.**
       *
       * Der erste Entwurf bevorzugte `f.params.flowTemperature`. Das klingt
       * vernünftig — das Objekt weiß es doch am besten — und war in der
       * Messung der Grund für ein stilles Falschergebnis: Die
       * Symbolbibliothek belegt jeden Heizkörper mit 55/45 vor. Eine Anlage,
       * die auf 35/28 ausgelegt ist, rechnete damit für jede ihrer
       * Heizflächen mit 55/45 weiter, und der Vorschlag lag um den Faktor
       * 3,6 zu niedrig. Derselbe Fehler wie bei der Leistung: eine
       * Katalogvorbelegung, die sich als Messwert ausgibt.
       *
       * Die Auslegungstemperatur ist eine Eigenschaft der **Anlage** — es
       * gibt sie genau einmal. Ein Kreis, der abweicht, wird über
       * `PlantCircuit` geführt und nicht über ein Feld am Symbol.
       */
      const n = normleistungFuerHeizlast({
        heizlast: anteil,
        vorlauf: temps.vorlauf,
        ruecklauf: temps.ruecklauf,
        raum: last.setpoint,
        type: f.type,
        exponent: f.params.radiatorExponent,
      });
      if (!n) continue;
      const ist = f.params.powerW;
      if (opt.nurFixture !== undefined && f.id !== opt.nurFixture) continue;
      const abweichung = ist === undefined ? Infinity : Math.abs(n.watt - ist) / Math.max(1, n.watt);
      /*
       * **`opt.totzone > 0` gehört dazu, und das ist kein Feinschliff.**
       *
       * Der Inspektorweg fragt mit Totzone null: Er will die Begründung auch
       * dann, wenn die Zahl genau passt — das ist ja der Normalfall direkt
       * nach dem Nachziehen. Ohne diese Bedingung ist `0 <= 0` wahr, der
       * Befund fällt heraus, und im Inspektor steht eine vom Programm
       * gesetzte Leistung ohne jede Herkunft da: ununterscheidbar von einer
       * abgelesenen. Die „Totzone null" schloss den Nullfall ein, statt ihn
       * auszunehmen.
       */
      if (opt.totzone > 0 && abweichung <= opt.totzone) continue;
      befunde.push({
        fixtureId: f.id,
        roomName: last.name,
        ist,
        soll: n.watt,
        begruendung: leistungsBegruendung(n, flaechen.length, anteil),
        nachziehbar: leistungNachziehbar(f.params.powerSource),
        anzahl: flaechen.length,
      });
    }
  }
  return befunde;
}

/**
 * Der Befund zu **einer** Heizfläche — ohne Totzone.
 *
 * **Warum es diesen zweiten Weg gibt.** `heizflaechenBefunde` beantwortet die
 * Frage *ob nachgezogen wird*, und unterdrückt dafür Abweichungen unter zwei
 * Prozent. Der Inspektor stellt die andere Frage: *warum steht diese Zahl
 * da*. Für eine gerade nachgezogene Leistung ist die Abweichung null — und
 * genau dann fehlte die Begründung, die den Unterschied zwischen abgeleitet
 * und abgelesen überhaupt sichtbar macht. Die Zahl stand da, und niemand
 * konnte sehen, woher.
 */
export function heizflaechenbefundFuer(
  doc: BimDocument,
  fixtureId: string,
): Heizflaechenbefund | undefined {
  return befunde(doc, { nurFixture: fixtureId, totzone: 0 })[0];
}

/**
 * Die Heizflächen nachziehen, die nachgezogen werden dürfen — an Ort und Stelle.
 *
 * Gibt zurück, wie viele geändert wurden. Null heißt: nichts zu tun, und der
 * Aufrufer darf dann gar keinen Schritt in die Historie schreiben.
 */
export function zieheHeizflaechenNach(doc: BimDocument): number {
  let zahl = 0;
  for (const b of heizflaechenBefunde(doc)) {
    if (!b.nachziehbar) continue;
    const f = doc.fixtures[b.fixtureId];
    if (!f) continue;
    doc.fixtures[b.fixtureId] = {
      ...f,
      params: { ...f.params, powerW: b.soll, powerSource: 'heizlast' },
    };
    zahl += 1;
  }
  return zahl;
}

/**
 * Die Befunde, die **nicht** nachgezogen werden dürfen.
 *
 * Das ist die Liste, die den Planer wirklich interessiert: vorhandene
 * Heizkörper, die die Raumheizlast nicht decken. Sie gehört in die Prüfliste
 * und ins Heft — nicht als Fehler des Programms, sondern als Ergebnis.
 */
export function unterdeckteHeizflaechen(doc: BimDocument): Heizflaechenbefund[] {
  return heizflaechenBefunde(doc).filter(
    (b) => !b.nachziehbar && b.ist !== undefined && b.ist < b.soll,
  );
}
