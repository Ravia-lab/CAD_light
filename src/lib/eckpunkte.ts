/**
 * eckpunkte — was beim Zeichnen außer Wandknoten noch gefangen werden soll.
 *
 * **Der Befund, aus dem das hier entstanden ist.** Von zwölf Objektfamilien
 * im Dokument war genau **eine** fangbar: der Wandknoten. Eine
 * Grundstücksgrenze ließ sich nicht an die Ecke des Nachbargebäudes legen,
 * eine Leitung nicht an den Punkt der Leitung daneben, eine Maßkette nicht an
 * die Ecke des Kamins — und der eigene, gerade gezogene Zug war ebenfalls kein
 * Ziel: Wer eine Fläche umfährt, konnte den vierten Punkt nicht auf die Höhe
 * des ersten legen, obwohl genau das die häufigste Absicht ist.
 *
 * **Warum es als eigene Einheit steht.** Die Sammlung der Kandidaten ist reine
 * Rechnerei über dem Dokument — kein Zeigergerät, keine Leinwand, kein React.
 * Damit ist sie prüfbar, und geprüft gehört sie: Ein Fang, der einen Punkt
 * zwei Zentimeter daneben liefert, erzeugt ein Modell, das *fast* stimmt, und
 * das ist die teuerste Sorte Fehler — sie fällt erst im Aufmaß auf.
 *
 * **Was hier nicht passiert.** Priorisiert wird nicht nach Art, sondern nach
 * Abstand. Eine Rangfolge („Gelände schlägt Leitung") wäre eine Behauptung
 * darüber, was der Zeichner meint; der Abstand ist eine Messung.
 */

import { distance } from './geometry';
import { solidFootprint, verticalCorners } from './verticalSymbols';
import { durchbruchMitte, durchbruchUmriss } from './durchbruchSymbols';
import type { BimDocument, LevelId, Vec2 } from '../types/bim';

/** Woher ein Fangpunkt stammt — für die Anzeige im Bild. */
export type Eckart =
  | 'gelaende'
  | 'leitung'
  | 'bauteil'
  | 'vertikal'
  | 'durchbruch'
  | 'raum'
  | 'zug'
  | 'objekt';

export const ECKART_LABELS: Record<Eckart, string> = {
  gelaende: 'Geländepunkt',
  leitung: 'Leitungspunkt',
  bauteil: 'Bauteilecke',
  vertikal: 'Treppe/Schacht',
  durchbruch: 'Durchbruch',
  raum: 'Raumecke',
  zug: 'eigener Zug',
  objekt: 'TGA-Objekt',
};

export interface Eckpunkt {
  punkt: Vec2;
  art: Eckart;
  /** Kennung des Objekts, zu dem der Punkt gehört — für Diagnose und Anzeige. */
  id?: string;
}

/**
 * Alle fangbaren Ecken eines Geschosses einsammeln.
 *
 * `laufenderZug` sind die Punkte, die im gerade gezogenen Zug schon gesetzt
 * wurden. Sie stehen noch in keinem Dokument und müssen deshalb von außen
 * hereingereicht werden — sie sind aber das mit Abstand wichtigste Ziel.
 *
 * **Geschossgrenze.** Alles Geschossgebundene wird gefiltert; das Gelände
 * nicht, denn es gehört zum Grundstück und nicht zu einer Etage. Wer im
 * Obergeschoss zeichnet, soll trotzdem auf die Grundstücksgrenze fangen
 * können — sie ist dort genauso gültig.
 */
export function sammleEckpunkte(
  doc: BimDocument,
  levelId: LevelId,
  laufenderZug: readonly Vec2[] = [],
): Eckpunkt[] {
  const raus: Eckpunkt[] = [];

  for (const el of Object.values(doc.site?.elements ?? {})) {
    for (const p of el.points) raus.push({ punkt: p, art: 'gelaende', id: el.id });
  }

  for (const rohr of Object.values(doc.pipes ?? {})) {
    if (rohr.levelId !== levelId) continue;
    for (const p of rohr.points) raus.push({ punkt: p, art: 'leitung', id: rohr.id });
  }

  // Kamin, Pfeiler, Wandversatz: der Umriss steht entweder frei im Objekt oder
  // folgt aus Maß und Drehung — `solidFootprint` kennt beide Fälle.
  for (const bauteil of Object.values(doc.solids ?? {})) {
    if (bauteil.levelId !== levelId) continue;
    for (const p of solidFootprint(bauteil)) raus.push({ punkt: p, art: 'bauteil', id: bauteil.id });
  }

  for (const v of Object.values(doc.verticals ?? {})) {
    if (v.levelId !== levelId) continue;
    for (const p of verticalCorners(v)) raus.push({ punkt: p, art: 'vertikal', id: v.id });
  }

  /*
   * Raumecken sind die **lichten** Ecken — die Innenkante der Wand, nicht die
   * Achse. Genau die braucht, wer eine Innenmaßkette ansetzt oder einen
   * Heizkörper in die Ecke stellt; der Wandknoten liegt dafür eine halbe
   * Wandstärke daneben.
   */
  for (const raum of Object.values(doc.rooms ?? {})) {
    if (raum.levelId !== levelId) continue;
    for (const p of raum.innerPolygon ?? raum.polygon) raus.push({ punkt: p, art: 'raum', id: raum.id });
  }

  /*
   * Der Durchbruch steuert **beide** Enden bei: seine Umrissecken und seine
   * Mitte. Die Mitte ist hier die Ausnahme von der Regel „nur Ecken" — nach
   * ihr wird bemaßt, denn eine Bohrung reißt man auf Achse an und nicht auf
   * Kante.
   */
  for (const db of Object.values(doc.durchbrueche ?? {})) {
    if (db.levelId !== levelId) continue;
    for (const p of durchbruchUmriss(db, doc)) raus.push({ punkt: p, art: 'durchbruch', id: db.id });
    const m = durchbruchMitte(db, doc);
    if (m) raus.push({ punkt: m, art: 'durchbruch', id: db.id });
  }

  for (const f of Object.values(doc.fixtures ?? {})) {
    if (f.levelId !== levelId) continue;
    raus.push({ punkt: f.position, art: 'objekt', id: f.id });
  }

  for (const p of laufenderZug) raus.push({ punkt: p, art: 'zug' });

  return raus;
}

/**
 * Den nächsten Kandidaten innerhalb der Toleranz suchen.
 *
 * Gibt `null` zurück, wenn keiner nah genug liegt — der Aufrufer fällt dann
 * auf Raster oder freien Punkt zurück. Bei Gleichstand gewinnt der zuerst
 * eingesammelte; das ist nicht schön, aber deterministisch, und zwei Punkte
 * auf demselben Fleck sind ohnehin derselbe Ort.
 */
export function naechsterEckpunkt(
  kandidaten: readonly Eckpunkt[],
  ziel: Vec2,
  toleranz: number,
): Eckpunkt | null {
  let best: Eckpunkt | null = null;
  let bestD = toleranz;
  for (const k of kandidaten) {
    const d = distance(k.punkt, ziel);
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  return best;
}
