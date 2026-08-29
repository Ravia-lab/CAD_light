/**
 * Vergleich zweier Exportstände.
 * ---------------------------------------------------------------------------
 * Die Frage, die vor jeder erneuten Übergabe an RaVia steht: *was hat sich
 * seit dem letzten Mal geändert?* Ohne Antwort darauf muss die Gegenstelle
 * jedes Mal alles neu rechnen und prüfen.
 *
 * Verglichen wird auf Raumebene — die Einheit, in der die Heizlast gerechnet
 * wird. Räume werden über ihre ID zugeordnet und, falls die IDs sich geändert
 * haben (Neuerkennung nach Umbau), hilfsweise über den Namen.
 */

import type { RaviaExport, ExportRoom } from '../types/bim';

export type ChangeKind = 'added' | 'removed' | 'changed' | 'unchanged';

export interface FieldChange {
  field: string;
  label: string;
  before: number | string | null;
  after: number | string | null;
  /** Relative Änderung, sofern beide Werte Zahlen sind. */
  delta?: number;
}

export interface RoomDiff {
  kind: ChangeKind;
  id: string;
  name: string;
  level: string;
  changes: FieldChange[];
}

export interface ExportDiff {
  before: { name: string; exportedAt: string; rooms: number; area: number };
  after: { name: string; exportedAt: string; rooms: number; area: number };
  rooms: RoomDiff[];
  summary: { added: number; removed: number; changed: number; unchanged: number };
  totals: FieldChange[];
}

/** Felder, deren Änderung die Heizlast beeinflusst — nur die zählen. */
const ROOM_FIELDS: { key: keyof ExportRoom; label: string; digits: number }[] = [
  { key: 'area', label: 'Fläche [m²]', digits: 2 },
  { key: 'volume', label: 'Volumen [m³]', digits: 2 },
  { key: 'height', label: 'Höhe [m]', digits: 3 },
  { key: 'setpointTemperature', label: 'Solltemperatur [°C]', digits: 1 },
  { key: 'airChangeRate', label: 'Luftwechsel [1/h]', digits: 2 },
  { key: 'exteriorWallArea', label: 'Außenwand [m²]', digits: 2 },
  { key: 'totalWindowArea', label: 'Fenster [m²]', digits: 2 },
  { key: 'installedHeatingPower', label: 'Heizleistung [W]', digits: 0 },
  { key: 'groundContactPerimeter', label: 'Erdkontakt [m]', digits: 2 },
];

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Spezifischer Transmissions-Leitwert der Raumhülle [W/K], ohne
 * Temperaturkorrektur: Σ A·(U + ΔU_WB) über alle Bauteile und Öffnungen.
 *
 * Der Wert wird nur für den Vergleich gebildet, nicht exportiert — es soll
 * keine zweite Wahrheit neben der Rechnung in RaVia geben. Er ist hier nötig,
 * weil ein gewechselter Bauteilaufbau *keine* Fläche verändert: ohne ihn
 * bliebe der Sprung von einer 0,24er auf eine 0,15er Außenwand unsichtbar.
 */
function envelopeUA(room: ExportRoom): number {
  let ua = 0;
  for (const s of room.surfaces) {
    const tb = typeof s.thermalBridgeSupplement === 'number' ? s.thermalBridgeSupplement : 0;
    ua += s.netArea * (s.uValue + tb);
    for (const o of s.openings) ua += o.area * (o.uValue + tb);
  }
  return ua;
}

export function diffExports(before: RaviaExport, after: RaviaExport): ExportDiff {
  const byId = new Map<string, ExportRoom>();
  const byName = new Map<string, ExportRoom>();
  for (const room of before.rooms) {
    byId.set(room.id, room);
    byName.set(`${room.level}|${room.name}`, room);
  }

  const rooms: RoomDiff[] = [];
  const matched = new Set<string>();

  for (const room of after.rooms) {
    const previous = byId.get(room.id) ?? byName.get(`${room.level}|${room.name}`);
    if (!previous) {
      rooms.push({ kind: 'added', id: room.id, name: room.name, level: room.level, changes: [] });
      continue;
    }
    matched.add(previous.id);

    const changes: FieldChange[] = [];
    for (const f of ROOM_FIELDS) {
      const a = num(previous[f.key]);
      const b = num(room[f.key]);
      if (a === null || b === null) continue;
      const tolerance = Math.pow(10, -f.digits) / 2;
      if (Math.abs(a - b) <= tolerance) continue;
      changes.push({
        field: String(f.key),
        label: f.label,
        before: Math.round(a * 10 ** f.digits) / 10 ** f.digits,
        after: Math.round(b * 10 ** f.digits) / 10 ** f.digits,
        delta: a !== 0 ? Math.round(((b - a) / Math.abs(a)) * 1000) / 10 : undefined,
      });
    }

    // Hüllleitwert — die einzige Größe, die auf einen Aufbau- bzw.
    // U-Wert-Wechsel reagiert.
    const uaBefore = envelopeUA(previous);
    const uaAfter = envelopeUA(room);
    if (Math.abs(uaBefore - uaAfter) > 0.005) {
      changes.push({
        field: 'envelopeUA',
        label: 'Hüll-Leitwert [W/K]',
        before: Math.round(uaBefore * 100) / 100,
        after: Math.round(uaAfter * 100) / 100,
        delta: uaBefore !== 0 ? Math.round(((uaAfter - uaBefore) / Math.abs(uaBefore)) * 1000) / 10 : undefined,
      });
    }

    // Bauteilzahl je Raum — verrät hinzugefügte Fenster oder Wände.
    if (previous.surfaces.length !== room.surfaces.length) {
      changes.push({
        field: 'surfaces',
        label: 'Hüllbauteile',
        before: previous.surfaces.length,
        after: room.surfaces.length,
      });
    }

    rooms.push({
      kind: changes.length ? 'changed' : 'unchanged',
      id: room.id,
      name: room.name,
      level: room.level,
      changes,
    });
  }

  for (const room of before.rooms) {
    if (matched.has(room.id)) continue;
    if (after.rooms.some((r) => r.id === room.id)) continue;
    rooms.push({ kind: 'removed', id: room.id, name: room.name, level: room.level, changes: [] });
  }

  const totals: FieldChange[] = [
    tot('Nutzfläche [m²]', before.totals.netFloorArea, after.totals.netFloorArea, 2),
    tot('Volumen [m³]', before.totals.netVolume, after.totals.netVolume, 2),
    tot('Außenwand [m²]', before.totals.exteriorWallArea, after.totals.exteriorWallArea, 2),
    tot('Fenster [m²]', before.totals.windowArea, after.totals.windowArea, 2),
    tot('Heizleistung [W]', before.totals.installedHeatingPower, after.totals.installedHeatingPower, 0),
    tot('Räume', before.totals.roomCount, after.totals.roomCount, 0),
  ].filter((c): c is FieldChange => c !== null);

  return {
    before: {
      name: before.project.name,
      exportedAt: before.exportedAt,
      rooms: before.rooms.length,
      area: before.totals.netFloorArea,
    },
    after: {
      name: after.project.name,
      exportedAt: after.exportedAt,
      rooms: after.rooms.length,
      area: after.totals.netFloorArea,
    },
    rooms: rooms.sort((a, b) => order(a.kind) - order(b.kind) || a.name.localeCompare(b.name, 'de')),
    summary: {
      added: rooms.filter((r) => r.kind === 'added').length,
      removed: rooms.filter((r) => r.kind === 'removed').length,
      changed: rooms.filter((r) => r.kind === 'changed').length,
      unchanged: rooms.filter((r) => r.kind === 'unchanged').length,
    },
    totals,
  };
}

function tot(label: string, a: number, b: number, digits: number): FieldChange | null {
  if (Math.abs(a - b) <= Math.pow(10, -digits) / 2) return null;
  return {
    field: label,
    label,
    before: Math.round(a * 10 ** digits) / 10 ** digits,
    after: Math.round(b * 10 ** digits) / 10 ** digits,
    delta: a !== 0 ? Math.round(((b - a) / Math.abs(a)) * 1000) / 10 : undefined,
  };
}

const order = (kind: ChangeKind): number =>
  kind === 'removed' ? 0 : kind === 'added' ? 1 : kind === 'changed' ? 2 : 3;

/** Prüft grob, ob ein geladenes Objekt ein RaVia-Export ist. */
export function isRaviaExport(value: unknown): value is RaviaExport {
  const v = value as RaviaExport | null;
  return Boolean(v && v.schema === 'ravia.bim.light' && Array.isArray(v.rooms) && v.totals);
}
