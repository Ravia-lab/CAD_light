/**
 * Prüfhilfe: Raumlast aus der Leistung, die am Objekt steht.
 *
 * **Warum es diese Hilfe gibt (Befund A2).** Bis 1.72.0 rechnete das
 * Rohrnetz den Volumenstrom einer Heizfläche aus ihrer Leistung am Objekt
 * (`powerW`). Seit 1.73.0 trägt jede Heizfläche ihren Anteil an der
 * **Raumheizlast**. Die Rohrnetz-Prüfhäuser sind aber mit runden Leistungen
 * am Objekt gebaut (1400 W, 900 W …), und ihre von Hand gerechneten
 * Volumenströme hängen an genau diesen Zahlen.
 *
 * Statt die Handrechnungen auf die zufällige Überschlags-Heizlast der
 * Prüfhäuser umzuschreiben, setzt diese Hilfe die Raumlast so, wie RaVia sie
 * zurückschreiben würde: als Norm-Heizlast des Raums, gleich der Summe der
 * Leistungen, die in ihm stehen. Damit prüfen die Blöcke weiter dasselbe —
 * dass der Strom der Last folgt —, und die Last kommt auf dem Weg, den das
 * Programm jetzt vorschreibt.
 *
 * Heizflächen ohne Raumzuordnung bekommen sie über die Lage im Raumpolygon.
 */

import type { BimDocument } from '../../src/types/bim';
import { pointInPolygon } from '../../src/lib/geometry';
import { traegtRaumlast } from '../../src/lib/verbraucherlast';

export function raumlastAusLeistung(doc: BimDocument): BimDocument {
  const rooms = Object.values(doc.rooms ?? {});
  const summe = new Map<string, number>();
  // Eine frühere Anwendung derselben Hilfe zählt nicht mit.
  for (const r of rooms) if (r.normHeatLoad?.source === 'Prüfung') delete r.normHeatLoad;
  for (const f of Object.values(doc.fixtures ?? {})) {
    if (!traegtRaumlast(f)) continue;
    if (!f.roomId) {
      const raum = rooms.find(
        (r) => r.levelId === f.levelId && r.innerPolygon.length >= 3 && pointInPolygon(f.position, r.innerPolygon),
      );
      if (raum) f.roomId = raum.id;
    }
    const w = f.params.powerW ?? f.params.ratedPower;
    if (f.roomId && typeof w === 'number' && w > 0) summe.set(f.roomId, (summe.get(f.roomId) ?? 0) + w);
  }
  for (const [id, total] of summe) {
    const r = doc.rooms[id];
    if (r) r.normHeatLoad = { total, source: 'Prüfung', receivedAt: '2026-01-01T00:00:00.000Z' };
  }
  return doc;
}
