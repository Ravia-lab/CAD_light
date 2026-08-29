/**
 * Raumvorlagen — fertige Grundformen zum Aufziehen.
 * ---------------------------------------------------------------------------
 * Wände einzeln zu ziehen ist der ehrliche Weg und der langsamste. Die
 * allermeisten Räume sind rechteckig, und die meisten der übrigen sind ein
 * Rechteck mit einer ausgeschnittenen Ecke. Wer das jedes Mal aus vier bis
 * acht Einzelwänden zusammensetzt, verbringt die Hälfte der Zeit mit
 * Aufgaben, die das Programm kennt.
 *
 * Deshalb liefert dieses Modul die **Achspolygone** fertiger Grundformen: man
 * zieht ein Rechteck auf, das Programm setzt die Wände. Was danach entsteht,
 * ist kein Sonderobjekt, sondern ganz normale Wände — jede einzeln
 * verschiebbar, in der Dicke änderbar, löschbar. Die Vorlage ist eine
 * Eingabehilfe, keine Datenstruktur.
 *
 * Alle Polygone laufen gegen den Uhrzeigersinn und liegen auf den
 * **Wandachsen**, nicht auf der lichten Kante. Das ist dieselbe Konvention
 * wie beim Zeichnen von Hand: wer 4,00 × 5,00 aufzieht, bekommt Achsmaße von
 * 4,00 × 5,00 und je nach Wandstärke ein lichtes Maß von 3,76 × 4,76.
 */

import type { Vec2 } from '../types/bim';

export type RoomTemplateKind =
  | 'rechteck'
  | 'l-form'
  | 'u-form'
  | 't-form'
  | 'trapez'
  | 'achteck'
  | 'sechseck'
  | 'rund';

export interface RoomTemplate {
  kind: RoomTemplateKind;
  label: string;
  /** Ein Satz, der einem Installateur sagt, wofür die Form gut ist. */
  hint: string;
  /** Zahl der Wände, die entstehen — bei `rund` abhängig von `segments`. */
  walls: number;
  /** Hat die Form eine Aussparung, deren Größe man einstellen kann? */
  adjustable: boolean;
}

export const ROOM_TEMPLATES: RoomTemplate[] = [
  { kind: 'rechteck', label: 'Rechteck', hint: 'Der Regelfall. Aufziehen, fertig.', walls: 4, adjustable: false },
  {
    kind: 'l-form',
    label: 'L-Form',
    hint: 'Rechteck mit ausgeschnittener Ecke — Wohnraum um einen Schacht oder eine Treppe herum.',
    walls: 6,
    adjustable: true,
  },
  {
    kind: 'u-form',
    label: 'U-Form',
    hint: 'Zwei Schenkel um einen Einschnitt — typisch für Grundrisse mit Innenhof oder Erker.',
    walls: 8,
    adjustable: true,
  },
  {
    kind: 't-form',
    label: 'T-Form',
    hint: 'Breiter Kopf mit schmalem Fuß — Flure mit Abgang, Anbauten.',
    walls: 8,
    adjustable: true,
  },
  {
    kind: 'trapez',
    label: 'Trapez',
    hint: 'Eine Seite eingezogen — Räume an schrägen Grundstücksgrenzen.',
    walls: 4,
    adjustable: true,
  },
  {
    kind: 'achteck',
    label: 'Achteck',
    hint: 'Rechteck mit abgeschrägten Ecken — Wintergärten, Erker.',
    walls: 8,
    adjustable: true,
  },
  { kind: 'sechseck', label: 'Sechseck', hint: 'Erker mit drei Fensterachsen.', walls: 6, adjustable: false },
  {
    kind: 'rund',
    label: 'Rund',
    hint: 'Als Vieleck angenähert — Turmzimmer. Mehr Segmente heißt runder und mehr Wände.',
    walls: 16,
    adjustable: true,
  },
];

export const ROOM_TEMPLATE_BY_KIND: Record<RoomTemplateKind, RoomTemplate> = Object.fromEntries(
  ROOM_TEMPLATES.map((t) => [t.kind, t]),
) as Record<RoomTemplateKind, RoomTemplate>;

export interface TemplateOptions {
  /**
   * Größe der Aussparung quer und längs, jeweils als Anteil der Gesamtseite.
   * 0,4 heißt: der Einschnitt nimmt 40 % der Breite ein.
   */
  notchX: number;
  notchY: number;
  /** Vierteldrehungen gegen den Uhrzeigersinn — dreht die Aussparung herum. */
  quarterTurns: number;
  /** Segmentzahl der runden Form. */
  segments: number;
}

export const DEFAULT_TEMPLATE_OPTIONS: TemplateOptions = {
  notchX: 0.4,
  notchY: 0.4,
  quarterTurns: 0,
  segments: 16,
};

/** Begrenzt die Aussparung so, dass immer ein zusammenhängender Raum bleibt. */
function clampNotch(value: number): number {
  return Math.min(0.85, Math.max(0.1, value));
}

/**
 * Achspolygon einer Vorlage aus dem aufgezogenen Rechteck.
 *
 * `from` und `to` sind zwei gegenüberliegende Ecken in beliebiger Reihenfolge;
 * die Funktion sortiert sie selbst. Ein zu kleines Rechteck liefert ein leeres
 * Polygon — der Aufrufer soll dann nichts erzeugen statt einen Raum von
 * wenigen Zentimetern anzulegen.
 */
export function templatePolygon(
  kind: RoomTemplateKind,
  from: Vec2,
  to: Vec2,
  options: Partial<TemplateOptions> = {},
): Vec2[] {
  const o = { ...DEFAULT_TEMPLATE_OPTIONS, ...options };
  const x0 = Math.min(from.x, to.x);
  const x1 = Math.max(from.x, to.x);
  const y0 = Math.min(from.y, to.y);
  const y1 = Math.max(from.y, to.y);
  const w = x1 - x0;
  const h = y1 - y0;
  // Unter einem halben Meter Kantenlänge ist keine Vorlage sinnvoll: da
  // entstünden Wände, die kürzer sind als ihre eigene Dicke.
  if (w < 0.5 || h < 0.5) return [];

  const nx = clampNotch(o.notchX);
  const ny = clampNotch(o.notchY);
  const raw = buildPolygon(kind, w, h, nx, ny, o.segments);
  const turned = rotateInUnitBox(raw, o.quarterTurns);
  return turned.map((p) => ({ x: x0 + p.x * w, y: y0 + p.y * h }));
}

/**
 * Die Formen im Einheitsquadrat 0…1 — dadurch bleibt das Drehen einfach und
 * die Formeln lesbar. Alle laufen gegen den Uhrzeigersinn.
 */
function buildPolygon(
  kind: RoomTemplateKind,
  width: number,
  height: number,
  nx: number,
  ny: number,
  segments: number,
): Vec2[] {
  switch (kind) {
    case 'rechteck':
      return [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ];

    case 'l-form':
      // Ausgeschnitten wird die Ecke oben rechts.
      return [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 - ny },
        { x: 1 - nx, y: 1 - ny },
        { x: 1 - nx, y: 1 },
        { x: 0, y: 1 },
      ];

    case 'u-form': {
      // Der Einschnitt sitzt mittig an der Oberkante.
      const half = nx / 2;
      return [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0.5 + half, y: 1 },
        { x: 0.5 + half, y: 1 - ny },
        { x: 0.5 - half, y: 1 - ny },
        { x: 0.5 - half, y: 1 },
        { x: 0, y: 1 },
      ];
    }

    case 't-form': {
      // Schmaler Fuß unten, breiter Kopf oben.
      const half = (1 - nx) / 2;
      return [
        { x: half, y: 0 },
        { x: 1 - half, y: 0 },
        { x: 1 - half, y: 1 - ny },
        { x: 1, y: 1 - ny },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
        { x: 0, y: 1 - ny },
        { x: half, y: 1 - ny },
      ];
    }

    case 'trapez':
      // Die Oberkante ist beidseitig eingezogen.
      return [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1 - nx / 2, y: 1 },
        { x: nx / 2, y: 1 },
      ];

    case 'achteck': {
      // Abgeschrägt wird auf beiden Achsen dieselbe *Länge*, nicht derselbe
      // Anteil — sonst sähen die Schrägen bei länglichen Räumen schief aus.
      const cut = Math.min(nx, 0.45);
      const cutX = (cut * Math.min(width, height)) / width;
      const cutY = (cut * Math.min(width, height)) / height;
      return [
        { x: cutX, y: 0 },
        { x: 1 - cutX, y: 0 },
        { x: 1, y: cutY },
        { x: 1, y: 1 - cutY },
        { x: 1 - cutX, y: 1 },
        { x: cutX, y: 1 },
        { x: 0, y: 1 - cutY },
        { x: 0, y: cutY },
      ];
    }

    case 'sechseck':
      return [
        { x: 0.25, y: 0 },
        { x: 0.75, y: 0 },
        { x: 1, y: 0.5 },
        { x: 0.75, y: 1 },
        { x: 0.25, y: 1 },
        { x: 0, y: 0.5 },
      ];

    case 'rund': {
      const n = Math.max(6, Math.min(48, Math.round(segments)));
      const points: Vec2[] = [];
      for (let i = 0; i < n; i += 1) {
        // Der Startwinkel liegt zwischen zwei Segmenten, damit unten eine
        // waagerechte Wand entsteht statt einer Ecke — daran lässt sich eine
        // Tür setzen.
        const a = (2 * Math.PI * (i + 0.5)) / n - Math.PI / 2;
        points.push({ x: 0.5 + 0.5 * Math.cos(a), y: 0.5 + 0.5 * Math.sin(a) });
      }
      return points;
    }

    default:
      return [];
  }
}

/** Dreht ein Polygon im Einheitsquadrat um Vielfache von 90°. */
function rotateInUnitBox(points: Vec2[], quarterTurns: number): Vec2[] {
  const turns = ((Math.round(quarterTurns) % 4) + 4) % 4;
  let result = points;
  for (let t = 0; t < turns; t += 1) result = result.map((p) => ({ x: p.y, y: 1 - p.x }));
  return result;
}

/**
 * Übliche Raumgrößen als Startmaß.
 *
 * Die Werte sind Erfahrungswerte des Wohnungsbaus, keine Norm. Sie ersparen
 * das Aufziehen, wenn ohnehin klar ist, wie groß ein Hauswirtschaftsraum wird.
 * Zwei Ausnahmen mit Normbezug sind vermerkt.
 */
export interface RoomSizePreset {
  label: string;
  width: number;
  depth: number;
  usage: string;
  note?: string;
}

export const ROOM_SIZE_PRESETS: RoomSizePreset[] = [
  { label: 'Gäste-WC', width: 1.6, depth: 1.2, usage: 'bathroom', note: 'Kleinstmaß; für einen Rollstuhl reicht es nicht.' },
  { label: 'Bad', width: 2.6, depth: 2.2, usage: 'bathroom' },
  { label: 'Bad, barrierefrei', width: 2.6, depth: 2.6, usage: 'bathroom', note: 'Bewegungsfläche 1,50 × 1,50 m nach DIN 18040-2 (R-Anforderung).' },
  { label: 'Schlafzimmer', width: 4.0, depth: 3.5, usage: 'bedroom' },
  { label: 'Kinderzimmer', width: 3.5, depth: 3.0, usage: 'bedroom' },
  { label: 'Wohnzimmer', width: 5.5, depth: 4.5, usage: 'living' },
  { label: 'Küche', width: 3.5, depth: 3.0, usage: 'kitchen' },
  { label: 'Flur', width: 4.0, depth: 1.4, usage: 'corridor' },
  { label: 'Hauswirtschaftsraum', width: 2.5, depth: 2.0, usage: 'utility' },
  { label: 'Technikraum', width: 2.5, depth: 2.5, usage: 'technical', note: 'Für Wärmepumpe mit Speicher eher knapp — Kippmaß des Speichers prüfen.' },
  { label: 'Abstellraum', width: 2.0, depth: 1.5, usage: 'storage' },
  { label: 'Büro', width: 4.0, depth: 3.0, usage: 'office' },
];

/**
 * Fläche eines Achspolygons [m²] — für die Vorschau beim Aufziehen.
 *
 * Das ist die **Achsfläche**, nicht die Wohnfläche: die lichte Fläche liegt
 * um den halben Wandumfang darunter und wird erst von der Raumerkennung
 * berechnet, wenn die Wände stehen.
 */
export function polygonArea(points: readonly Vec2[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}
