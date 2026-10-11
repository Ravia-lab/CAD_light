/**
 * Embed-Befehl `createRoom` — ein Raum aus der Raumliste des Wirts.
 *
 * Der Wirt (RaVia) zeigt seine bereits erfassten Räume als Vorschlagsliste
 * neben dem Editor. Ein Klick darauf schickt `createRoom` mit Name, Nutzung
 * und, wenn bekannt, der Fläche. Bis 1.9.0 gab es den Befehl nicht: Die
 * Brücke antwortete „Unbekannter Befehl", und der Wirt meldete jeden Raum
 * als „nicht platziert".
 *
 * **Geometrie gehört dem, der zeichnet.** Der Wirt bestimmt deshalb keine
 * Lage. Der Raum entsteht als Rechteck rechts neben allem, was auf dem
 * aktiven Geschoss schon steht, mit der gewünschten Fläche als Quadrat. Wer
 * ihn an die richtige Stelle schieben will, tut das im Editor. Ohne
 * Flächenangabe gilt `RAUM_STANDARDFLAECHE`.
 *
 * Angelegt wird über dieselbe Funktion wie beim Werkzeug „Raum aufziehen"
 * (`addRoomTemplate`), die Datei hier rechnet nur Lage und Größe aus und
 * prüft die Anfrage. Sie importiert nichts aus `src/store`, damit der
 * Rechenkern ein eigenständiges Paket bleibt.
 */
import type { BimDocument, RoomUsage, Vec2 } from '../types/bim';
import { pointInPolygon } from './geometry';

export interface CreateRoomRequest {
  name: string;
  usage?: string;
  /** Gewünschte Fläche [m²]. */
  areaHint?: number;
  /** Wer anfragt — nur zur Nachvollziehbarkeit, wird nicht gespeichert. */
  source?: string;
}

export interface CreateRoomResult {
  ok: boolean;
  roomId?: string;
  /** Achsfläche des angelegten Rechtecks [m²]. */
  area?: number;
  message?: string;
}

/** Fläche ohne Angabe des Wirts [m²] — ein mittleres Zimmer, keine Normvorgabe. */
export const RAUM_STANDARDFLAECHE = 12;
/** Größte angenommene Fläche [m²]; darüber liegt eher ein Tippfehler vor. */
export const RAUM_HOECHSTFLAECHE = 1000;
/** Abstand zum bestehenden Grundriss [m]. */
const ABSTAND = 1;

const NUTZUNGEN: readonly RoomUsage[] = [
  'living', 'bedroom', 'kitchen', 'bath', 'wc', 'hallway', 'office', 'storage', 'technical', 'other',
];

export type RaumVorlageAnlegen = (
  kind: 'rechteck',
  from: Vec2,
  to: Vec2,
  options: { usage?: RoomUsage; name?: string },
) => { walls: number; area: number } | null;

/** Freies Rechteck rechts neben dem Bestand des aktiven Geschosses. */
export function freiesRechteck(doc: BimDocument, flaeche: number): { from: Vec2; to: Vec2 } {
  const seite = Math.round(Math.sqrt(flaeche) * 100) / 100;
  const knoten = Object.values(doc.nodes).filter((n) => n.levelId === doc.activeLevelId);
  const x0 = knoten.length ? Math.max(...knoten.map((n) => n.x)) + ABSTAND : 0;
  const y0 = knoten.length ? Math.min(...knoten.map((n) => n.y)) : 0;
  return { from: { x: x0, y: y0 }, to: { x: x0 + seite, y: y0 + seite } };
}

export function createRoom(
  holeDoc: () => BimDocument,
  anlegen: RaumVorlageAnlegen,
  anfrage: unknown,
): CreateRoomResult {
  const a = (anfrage ?? {}) as Partial<CreateRoomRequest>;
  const name = typeof a.name === 'string' ? a.name.trim() : '';
  if (!name) return { ok: false, message: 'Raum ohne Namen' };

  const usage: RoomUsage = (NUTZUNGEN as readonly string[]).includes(a.usage ?? '')
    ? (a.usage as RoomUsage)
    : 'other';

  let flaeche = RAUM_STANDARDFLAECHE;
  if (a.areaHint !== undefined && a.areaHint !== null) {
    if (typeof a.areaHint !== 'number' || !Number.isFinite(a.areaHint) || a.areaHint <= 0
        || a.areaHint > RAUM_HOECHSTFLAECHE) {
      return { ok: false, message: `Fläche ungültig: ${String(a.areaHint)}` };
    }
    flaeche = Math.max(a.areaHint, 1);
  }

  const { from, to } = freiesRechteck(holeDoc(), flaeche);
  const ergebnis = anlegen('rechteck', from, to, { name, usage });
  if (!ergebnis) return { ok: false, message: 'Raum konnte nicht angelegt werden' };

  const mitte = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  const doc = holeDoc();
  const raum = Object.values(doc.rooms).find(
    (r) => r.levelId === doc.activeLevelId && r.innerPolygon.length >= 3 && pointInPolygon(mitte, r.innerPolygon),
  );
  if (!raum) return { ok: false, message: 'Wände angelegt, aber kein geschlossener Raum erkannt' };
  return { ok: true, roomId: raum.id, area: ergebnis.area };
}
