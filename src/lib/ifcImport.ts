/**
 * IFC4-Import (STEP / ISO-10303-21).
 * ---------------------------------------------------------------------------
 * Der wertvollste Grundriss ist der, den jemand anderes schon gezeichnet hat.
 * Wer eine IFC-Datei vom Architekten bekommt, soll sie nicht abpausen müssen:
 * Geschosse, Wände und Öffnungen stehen darin bereits maßhaltig.
 *
 * Gelesen wird ein bewusst schmaler Ausschnitt — genau das, woraus sich ein
 * Grundriss rekonstruieren lässt:
 *
 *   IfcBuildingStorey  → Geschoss (Höhenlage, Name)
 *   IfcWall*           → Achse und Dicke aus Axis/Body-Repräsentation
 *   IfcOpeningElement  → Öffnung, über IfcRelVoidsElement der Wand zugeordnet
 *   IfcWindow/IfcDoor  → Art der Öffnung, über IfcRelFillsElement
 *
 * Was nicht gelesen wird — Materialien, Bauteilaufbauten, Bewehrung,
 * Möblierung — fehlt bewusst: es wäre Datenballast für ein Werkzeug, dessen
 * Zweck die Heizlast ist. Der Import liefert deshalb einen *Vorschlag*, kein
 * fertiges Modell; geprüft und ergänzt wird danach im Editor.
 *
 * Der Parser ist ein einfacher, aber vollständiger STEP-Leser: er kommt mit
 * mehrzeiligen Entities, Zeichenketten mit Apostrophen und geschachtelten
 * Listen zurecht. Genau daran scheitern naive Zeilen-Parser.
 */

import type { BimNode, Opening, OpeningKind, Vec2, Wall, WallType } from '../types/bim';
import { VORGABE_U } from './uwert';

/*
 * U-Werte beim Import — **eine Quelle für die Wand, eine begründete Ausnahme
 * für die Öffnung.**
 *
 * Die Wand bekommt den Vorgabewert ihrer Bauteilart aus `uwert.ts`. Vorher
 * stand hier `wallType === 'exterior' ? 0.24 : 1.2`: dieselben Zahlen wie im
 * Vorgabekatalog, nur an einer zweiten Stelle geschrieben und schon
 * auseinandergelaufen — „nicht außen" wurde pauschal mit dem Wert der
 * *Innenwand* belegt, auch wo `guessWallType` eine Trenn- oder Schachtwand
 * erkannt hatte. Der Katalog führt für die beiden 1,4 statt 1,2. Über
 * `VORGABE_U[wallType]` kann das nicht mehr auseinanderlaufen.
 *
 * **Warum überhaupt ein Wert am Bauteil steht.** Zahlengleich wäre es, gar
 * keinen zu schreiben: `uwert.ts` setzt denselben Vorgabewert ein, wenn am
 * Bauteil nichts steht. Der Unterschied liegt allein in der Herkunft —
 * geschrieben heißt „am Bauteil erfasst", weggelassen heißt „angenommen".
 * Ehrlicher wäre Weglassen, denn eine IFC-Datei ohne U-Wert-Pset hat nichts
 * erfasst. Es bleibt trotzdem beim Schreiben, weil `validation.ts` sonst für
 * **jede** importierte Wand und jede Öffnung eine Meldung erzeugt: An einem
 * mittleren Scan sind das über hundert Hinweise, die alle dasselbe sagen,
 * und eine Prüfliste, in der hundert gleiche Meldungen stehen, wird nicht
 * gelesen — damit auch die eine nicht, auf die es ankommt. Sobald der Import
 * die Herkunft je Bauteil führen kann, gehört diese Entscheidung umgedreht.
 *
 * **Die Öffnung folgt bewusst nicht `VORGABE_U`.** Dort stehen 0,95 für das
 * Fenster und 1,6 für die Tür — Werte eines heutigen Neubaus. Was hier
 * ankommt, ist Bestand: eine aufgemessene oder gescannte Wirklichkeit. 1,3
 * ist das Zweischeiben-Fenster (`c-fe-2fach` im Aufbaukatalog), 1,8 die
 * Innentür (`c-tu-innen`); beide sind für ein Bestandsgebäude die bessere
 * Annahme. Sie auf `VORGABE_U` zu ziehen hieße, jedes importierte Fenster um
 * 27 % besser zu rechnen, als es vermutlich ist — und zwar nach unten, in
 * die Richtung, in der ein zu kleines Gerät herauskommt. Die Zahlen bleiben
 * deshalb, wo sie sind, und heißen hier so, dass man sieht, dass sie gemeint
 * sind.
 *
 * Der **Durchgang** bekommt gar keinen mehr. `uWertOeffnung` beantwortet ihn
 * seit 1.23.0 selbst mit 0 aus dem Katalog — er ist ein Loch in der Wand und
 * kein Bauteil. Die 0 am Bauteil stehen zu lassen wäre nicht falsch, aber
 * überflüssig, und sie steht damit als „erfasster U-Wert 0" im Modell:
 * genau die Eingabe, die `validation.ts` seit 1.23.0 als unplausibel meldet.
 * Dass der Durchgang dort ausgenommen ist, ist eine Ausnahme mehr, auf die
 * sich niemand verlassen sollte.
 */
/** U-Wert eines importierten Fensters [W/(m²·K)] — Zweischeiben-Bestand. */
const U_FENSTER_BESTAND = 1.3;
/** U-Wert einer importierten Tür [W/(m²·K)] — Innentür aus dem Aufbaukatalog. */
const U_TUER_BESTAND = 1.8;

// ---------------------------------------------------------------------------
// STEP-Parser
// ---------------------------------------------------------------------------

export type StepValue = string | number | null | StepRef | StepValue[];

/** Verweis auf eine andere Entity (`#42`). */
export interface StepRef {
  ref: number;
}

export interface StepEntity {
  id: number;
  type: string;
  attributes: StepValue[];
}

const isRef = (v: StepValue): v is StepRef =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && 'ref' in v;

/**
 * Zerlegt eine STEP-Datei in Entities.
 *
 * Zeilenweise zu lesen reicht nicht: eine Entity darf über beliebig viele
 * Zeilen gehen, und in Zeichenketten stehen Semikolons und Klammern, die
 * nicht als Struktur zählen. Deshalb wird zeichenweise gescannt und der
 * Zustand „in einer Zeichenkette" mitgeführt.
 */
export function parseStep(text: string): Map<number, StepEntity> {
  const entities = new Map<number, StepEntity>();

  const dataStart = text.indexOf('DATA;');
  const body = dataStart >= 0 ? text.slice(dataStart + 5) : text;

  let i = 0;
  const n = body.length;

  while (i < n) {
    // Bis zum nächsten '#' am Anfang einer Entity springen.
    while (i < n && body[i] !== '#') i++;
    if (i >= n) break;

    const start = i;
    i++;
    let idText = '';
    while (i < n && body[i] >= '0' && body[i] <= '9') idText += body[i++];
    if (!idText) continue;
    while (i < n && /\s/.test(body[i])) i++;
    if (body[i] !== '=') {
      i = start + 1;
      continue;
    }
    i++;

    // Bis zum abschließenden Semikolon lesen, Zeichenketten überspringend.
    let depth = 0;
    let inString = false;
    let raw = '';
    while (i < n) {
      const c = body[i];
      if (inString) {
        if (c === "'") {
          // Verdoppelter Apostroph ist ein Zeichen, kein Ende.
          if (body[i + 1] === "'") {
            raw += "''";
            i += 2;
            continue;
          }
          inString = false;
        }
        raw += c;
        i++;
        continue;
      }
      if (c === "'") {
        inString = true;
        raw += c;
        i++;
        continue;
      }
      if (c === '(') depth++;
      if (c === ')') depth--;
      if (c === ';' && depth <= 0) {
        i++;
        break;
      }
      raw += c;
      i++;
    }

    const open = raw.indexOf('(');
    if (open < 0) continue;
    const type = raw.slice(0, open).trim().toUpperCase();
    const inner = raw.slice(open + 1, raw.lastIndexOf(')'));
    entities.set(Number(idText), { id: Number(idText), type, attributes: parseList(inner) });
  }

  return entities;
}

/** Zerlegt eine Attributliste in Werte. */
function parseList(text: string): StepValue[] {
  const out: StepValue[] = [];
  let token = '';
  let depth = 0;
  let inString = false;

  const flush = () => {
    const t = token.trim();
    token = '';
    if (!t) {
      out.push(null);
      return;
    }
    out.push(parseValue(t));
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      token += c;
      if (c === "'") {
        if (text[i + 1] === "'") {
          token += "'";
          i++;
          continue;
        }
        inString = false;
      }
      continue;
    }
    if (c === "'") {
      inString = true;
      token += c;
      continue;
    }
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === ',' && depth === 0) {
      flush();
      continue;
    }
    token += c;
  }
  if (text.trim().length) flush();
  return out;
}

function parseValue(t: string): StepValue {
  if (t === '$' || t === '*') return null;
  if (t.startsWith('#')) return { ref: Number(t.slice(1)) };
  if (t.startsWith("'")) return t.slice(1, -1).replace(/''/g, "'");
  if (t.startsWith('(')) return parseList(t.slice(1, -1));
  if (t.startsWith('.') && t.endsWith('.')) return t.slice(1, -1);
  // Typisierte Werte wie IFCLENGTHMEASURE(2.5) — der Inhalt zählt.
  const typed = /^[A-Za-z_][A-Za-z0-9_]*\s*\((.*)\)$/s.exec(t);
  if (typed) {
    const inner = parseList(typed[1]);
    return inner.length === 1 ? inner[0] : inner;
  }
  const num = Number(t);
  return Number.isFinite(num) ? num : t;
}

// ---------------------------------------------------------------------------
// Geometrie-Auswertung
// ---------------------------------------------------------------------------

interface Placement {
  x: number;
  y: number;
  z: number;
  /** Drehung um die Hochachse [rad]. */
  angle: number;
}

const ORIGIN: Placement = { x: 0, y: 0, z: 0, angle: 0 };

/** Löst ein IfcLocalPlacement rekursiv bis zum Weltkoordinatensystem auf. */
function resolvePlacement(
  entities: Map<number, StepEntity>,
  ref: StepValue,
  cache = new Map<number, Placement>(),
): Placement {
  if (!isRef(ref)) return ORIGIN;
  const cached = cache.get(ref.ref);
  if (cached) return cached;

  const e = entities.get(ref.ref);
  if (!e) return ORIGIN;

  if (e.type === 'IFCLOCALPLACEMENT') {
    const parent = resolvePlacement(entities, e.attributes[0], cache);
    const local = resolvePlacement(entities, e.attributes[1], cache);
    const cos = Math.cos(parent.angle);
    const sin = Math.sin(parent.angle);
    const result: Placement = {
      x: parent.x + local.x * cos - local.y * sin,
      y: parent.y + local.x * sin + local.y * cos,
      z: parent.z + local.z,
      angle: parent.angle + local.angle,
    };
    cache.set(ref.ref, result);
    return result;
  }

  if (e.type === 'IFCAXIS2PLACEMENT3D' || e.type === 'IFCAXIS2PLACEMENT2D') {
    const p = point(entities, e.attributes[0]);
    // Bei 3D ist Attribut 1 die Z-Achse und 2 die X-Achse, bei 2D ist
    // Attribut 1 direkt die X-Achse.
    const dirRef = e.type === 'IFCAXIS2PLACEMENT3D' ? e.attributes[2] : e.attributes[1];
    const d = direction(entities, dirRef);
    const result: Placement = {
      x: p[0] ?? 0,
      y: p[1] ?? 0,
      z: p[2] ?? 0,
      angle: d ? Math.atan2(d[1] ?? 0, d[0] ?? 1) : 0,
    };
    cache.set(ref.ref, result);
    return result;
  }

  return ORIGIN;
}

function point(entities: Map<number, StepEntity>, ref: StepValue): number[] {
  if (!isRef(ref)) return [0, 0, 0];
  const e = entities.get(ref.ref);
  if (!e || e.type !== 'IFCCARTESIANPOINT') return [0, 0, 0];
  const coords = e.attributes[0];
  if (!Array.isArray(coords)) return [0, 0, 0];
  return coords.map((c) => (typeof c === 'number' ? c : 0));
}

function direction(entities: Map<number, StepEntity>, ref: StepValue): number[] | null {
  if (!isRef(ref)) return null;
  const e = entities.get(ref.ref);
  if (!e || e.type !== 'IFCDIRECTION') return null;
  const ratios = e.attributes[0];
  if (!Array.isArray(ratios)) return null;
  return ratios.map((c) => (typeof c === 'number' ? c : 0));
}

/**
 * Alle Darstellungselemente einer Produkt-Repräsentation, wahlweise gefiltert
 * nach ihrer Kennung ('Body', 'Axis').
 */
function itemsOf(
  entities: Map<number, StepEntity>,
  ref: StepValue,
  identifier?: string,
): StepEntity[] {
  const out: StepEntity[] = [];
  if (!isRef(ref)) return out;
  const shape = entities.get(ref.ref);
  if (!shape) return out;

  const reps = shape.attributes[2];
  if (!Array.isArray(reps)) return out;

  for (const r of reps) {
    if (!isRef(r)) continue;
    const rep = entities.get(r.ref);
    if (!rep || rep.type !== 'IFCSHAPEREPRESENTATION') continue;
    if (identifier && rep.attributes[1] !== identifier) continue;
    const items = rep.attributes[3];
    if (!Array.isArray(items)) continue;
    for (const it of items) {
      if (!isRef(it)) continue;
      const item = entities.get(it.ref);
      if (item) out.push(item);
    }
  }
  return out;
}

const solidsOf = (entities: Map<number, StepEntity>, ref: StepValue): StepEntity[] =>
  itemsOf(entities, ref);

interface ProfileBox {
  /** Ausdehnung längs der lokalen x-Achse [m]. */
  xDim: number;
  /** Ausdehnung quer dazu [m]. */
  yDim: number;
  /** Zusätzliche Drehung des Profils [rad]. */
  angle: number;
  /** Versatz des Profilmittelpunkts [m]. */
  offset: { x: number; y: number };
}

/**
 * Reduziert ein Profil auf sein umschreibendes Rechteck.
 *
 * Wände sind in IFC fast immer Rechteckprofile; kommt doch ein Polygon,
 * genügt dessen Bounding-Box, um Achse und Dicke zu bestimmen. Mehr braucht
 * ein Grundriss nicht — und was er nicht braucht, sollte er nicht raten.
 */
function profileBox(entities: Map<number, StepEntity>, ref: StepValue): ProfileBox | null {
  if (!isRef(ref)) return null;
  const e = entities.get(ref.ref);
  if (!e) return null;

  if (e.type === 'IFCRECTANGLEPROFILEDEF') {
    const place = resolvePlacement(entities, e.attributes[2]);
    const xDim = typeof e.attributes[3] === 'number' ? e.attributes[3] : 0;
    const yDim = typeof e.attributes[4] === 'number' ? e.attributes[4] : 0;
    return { xDim, yDim, angle: place.angle, offset: { x: place.x, y: place.y } };
  }

  if (e.type === 'IFCARBITRARYCLOSEDPROFILEDEF' || e.type === 'IFCARBITRARYPROFILEDEFWITHVOIDS') {
    const pts = curvePoints(entities, e.attributes[2]);
    if (pts.length < 3) return null;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const c of pts) {
      minX = Math.min(minX, c[0] ?? 0);
      minY = Math.min(minY, c[1] ?? 0);
      maxX = Math.max(maxX, c[0] ?? 0);
      maxY = Math.max(maxY, c[1] ?? 0);
    }
    if (!Number.isFinite(minX)) return null;
    return {
      xDim: maxX - minX,
      yDim: maxY - minY,
      angle: 0,
      offset: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
    };
  }

  if (e.type === 'IFCCIRCLEPROFILEDEF') {
    const place = resolvePlacement(entities, e.attributes[2]);
    const r = typeof e.attributes[3] === 'number' ? e.attributes[3] : 0;
    return { xDim: 2 * r, yDim: 2 * r, angle: place.angle, offset: { x: place.x, y: place.y } };
  }

  return null;
}

/**
 * Stützpunkte einer Profilkurve.
 *
 * IFC4 kennt für dieselbe Sache zwei Schreibweisen: die klassische
 * `IfcPolyline` mit einzelnen Punkten und die kompakte `IfcIndexedPolyCurve`,
 * die auf eine `IfcCartesianPointList` verweist. Programme wie IfcOpenShell
 * schreiben die zweite — wer nur die erste liest, findet in solchen Dateien
 * gar keine Wände.
 */
function curvePoints(entities: Map<number, StepEntity>, ref: StepValue): number[][] {
  if (!isRef(ref)) return [];
  const e = entities.get(ref.ref);
  if (!e) return [];

  if (e.type === 'IFCPOLYLINE') {
    const pts = e.attributes[0];
    if (!Array.isArray(pts)) return [];
    return pts.map((p) => point(entities, p));
  }

  if (e.type === 'IFCINDEXEDPOLYCURVE') {
    const listRef = e.attributes[0];
    if (!isRef(listRef)) return [];
    const list = entities.get(listRef.ref);
    if (!list) return [];
    if (list.type !== 'IFCCARTESIANPOINTLIST2D' && list.type !== 'IFCCARTESIANPOINTLIST3D') return [];
    const coords = list.attributes[0];
    if (!Array.isArray(coords)) return [];
    return coords
      .filter((c): c is StepValue[] => Array.isArray(c))
      .map((c) => c.map((v) => (typeof v === 'number' ? v : 0)));
  }

  if (e.type === 'IFCCOMPOSITECURVE') {
    // Zusammengesetzte Kurve: die Segmente einsammeln und aneinanderhängen.
    const segments = e.attributes[0];
    if (!Array.isArray(segments)) return [];
    const out: number[][] = [];
    for (const segRef of segments) {
      if (!isRef(segRef)) continue;
      const seg = entities.get(segRef.ref);
      if (!seg) continue;
      out.push(...curvePoints(entities, seg.attributes[2]));
    }
    return out;
  }

  return [];
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export interface ImportedLevel {
  id: string;
  name: string;
  elevation: number;
  height: number;
}

export interface IfcImportResult {
  ok: boolean;
  message: string;
  schema?: string;
  projectName?: string;
  levels: ImportedLevel[];
  nodes: BimNode[];
  walls: Wall[];
  openings: Opening[];
  /** Was gelesen, aber nicht übernommen wurde — für die Rückmeldung. */
  skipped: { reason: string; count: number }[];
}

const EMPTY: IfcImportResult = {
  ok: false,
  message: '',
  levels: [],
  nodes: [],
  walls: [],
  openings: [],
  skipped: [],
};

const WALL_TYPES = new Set([
  'IFCWALL',
  'IFCWALLSTANDARDCASE',
  'IFCWALLELEMENTEDCASE',
]);

/** Wandart aus Dicke und Name schätzen — IFC sagt es nicht direkt. */
function guessWallType(thickness: number, name: string): WallType {
  const lower = name.toLowerCase();
  if (lower.includes('schacht') || lower.includes('shaft')) return 'shaft';
  if (lower.includes('außen') || lower.includes('aussen') || lower.includes('exterior')) {
    return 'exterior';
  }
  if (lower.includes('innen') || lower.includes('interior') || lower.includes('partition')) {
    return thickness <= 0.12 ? 'partition' : 'interior';
  }
  // Ohne Hinweis im Namen entscheidet die Dicke: ab 24 cm ist es in
  // Wohngebäuden praktisch immer eine Außenwand.
  if (thickness >= 0.24) return 'exterior';
  return thickness <= 0.12 ? 'partition' : 'interior';
}

export function importIfc(text: string): IfcImportResult {
  if (!text.trimStart().startsWith('ISO-10303-21')) {
    return { ...EMPTY, message: 'Das ist keine STEP-/IFC-Datei (Kopfzeile fehlt).' };
  }

  const schemaMatch = /FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'/i.exec(text);
  const schema = schemaMatch?.[1];

  const entities = parseStep(text);
  if (entities.size === 0) {
    return { ...EMPTY, schema, message: 'Die Datei enthält keine lesbaren Entities.' };
  }

  const byType = new Map<string, StepEntity[]>();
  for (const e of entities.values()) {
    const list = byType.get(e.type);
    if (list) list.push(e);
    else byType.set(e.type, [e]);
  }

  const projectName = (() => {
    const p = byType.get('IFCPROJECT')?.[0];
    const name = p?.attributes[2];
    return typeof name === 'string' ? name : undefined;
  })();

  // --- Geschosse -------------------------------------------------------------
  const storeys = (byType.get('IFCBUILDINGSTOREY') ?? []).map((e, index) => {
    const name = typeof e.attributes[2] === 'string' ? e.attributes[2] : `Geschoss ${index + 1}`;
    const elevationAttr = e.attributes[9];
    const placement = resolvePlacement(entities, e.attributes[5]);
    const elevation = typeof elevationAttr === 'number' ? elevationAttr : placement.z;
    return { entity: e, id: `ifc-${e.id}`, name, elevation };
  });
  storeys.sort((a, b) => a.elevation - b.elevation);

  // Geschosshöhe aus dem Abstand zum nächsten Geschoss; das oberste erbt.
  const levels: ImportedLevel[] = storeys.map((s, i) => {
    const next = storeys[i + 1];
    const height = next ? Math.max(2, next.elevation - s.elevation - 0.3) : 2.75;
    return { id: s.id, name: s.name, elevation: s.elevation, height: Math.round(height * 1000) / 1000 };
  });

  // Bauteil → Geschoss über IfcRelContainedInSpatialStructure.
  const levelOfProduct = new Map<number, string>();
  for (const rel of byType.get('IFCRELCONTAINEDINSPATIALSTRUCTURE') ?? []) {
    const related = rel.attributes[4];
    const structure = rel.attributes[5];
    if (!Array.isArray(related) || !isRef(structure)) continue;
    const storey = storeys.find((s) => s.entity.id === structure.ref);
    if (!storey) continue;
    for (const r of related) if (isRef(r)) levelOfProduct.set(r.ref, storey.id);
  }

  const fallbackLevel = levels[0]?.id ?? 'ifc-level-0';
  if (!levels.length) {
    levels.push({ id: fallbackLevel, name: 'Geschoss', elevation: 0, height: 2.75 });
  }

  // --- Wände -----------------------------------------------------------------
  const nodes: BimNode[] = [];
  const walls: Wall[] = [];
  const openings: Opening[] = [];
  const skipped = new Map<string, number>();
  const note = (reason: string) => skipped.set(reason, (skipped.get(reason) ?? 0) + 1);

  let nodeCounter = 0;
  const nodeAt = (x: number, y: number, levelId: string): BimNode => {
    // Enden zusammenführen, die dichter als 2 cm beieinander liegen —
    // IFC-Dateien aus verschiedenen Programmen treffen sich selten exakt.
    for (const n of nodes) {
      if (n.levelId === levelId && Math.hypot(n.x - x, n.y - y) < 0.02) return n;
    }
    const node: BimNode = {
      id: `ifc-n${nodeCounter++}`,
      x: Math.round(x * 1000) / 1000,
      y: Math.round(y * 1000) / 1000,
      levelId,
    };
    nodes.push(node);
    return node;
  };

  /**
   * Die *echte* Wandachse, falls die Datei sie mitliefert.
   *
   * IFC kennt neben dem Körper eine eigene `Axis`-Repräsentation — eine
   * Linie, die die Wand meint, unabhängig davon, wie der Körper daneben
   * liegt. Programme wie Revit und ArchiCAD schreiben sie immer. Wo sie
   * steht, ist sie der Wahrheit näher als die Mitte des Volumenkörpers:
   * bei einer Wand, deren Körper einseitig zur Achse liegt, verschiebt sich
   * sonst der ganze Grundriss um eine halbe Wandstärke.
   */
  const axisCurveOf = (e: StepEntity): { a: Vec2; b: Vec2 } | null => {
    for (const item of itemsOf(entities, e.attributes[6], 'Axis')) {
      const pts = curvePoints(entities, { ref: item.id });
      if (pts.length < 2) continue;
      const place = resolvePlacement(entities, e.attributes[5]);
      const cos = Math.cos(place.angle);
      const sin = Math.sin(place.angle);
      const toWorld = (c: number[]) => ({
        x: place.x + (c[0] ?? 0) * cos - (c[1] ?? 0) * sin,
        y: place.y + (c[0] ?? 0) * sin + (c[1] ?? 0) * cos,
      });
      const a = toWorld(pts[0]);
      const b = toWorld(pts[pts.length - 1]);
      if (Math.hypot(b.x - a.x, b.y - a.y) > 0.05) return { a, b };
    }
    return null;
  };

  /** Mittelachse und Dicke eines Bauteils aus seiner Extrusion. */
  const axisOf = (e: StepEntity) => {
    const solids = solidsOf(entities, e.attributes[6]);
    const extruded = solids.find((s) => s.type === 'IFCEXTRUDEDAREASOLID');
    if (!extruded) return null;

    const profile = profileBox(entities, extruded.attributes[0]);
    if (!profile) return null;

    const objectPlacement = resolvePlacement(entities, e.attributes[5]);
    const solidPlacement = resolvePlacement(entities, extruded.attributes[1]);
    const depth = typeof extruded.attributes[3] === 'number' ? extruded.attributes[3] : 0;

    // Profilmitte in Weltkoordinaten.
    const angle = objectPlacement.angle + solidPlacement.angle + profile.angle;
    const cos = Math.cos(objectPlacement.angle);
    const sin = Math.sin(objectPlacement.angle);
    const localX = solidPlacement.x + profile.offset.x;
    const localY = solidPlacement.y + profile.offset.y;
    const cx = objectPlacement.x + localX * cos - localY * sin;
    const cy = objectPlacement.y + localX * sin + localY * cos;

    // Die längere Profilseite ist die Wandachse, die kürzere die Dicke.
    const along = Math.max(profile.xDim, profile.yDim);
    const thickness = Math.min(profile.xDim, profile.yDim);
    const axisAngle = profile.xDim >= profile.yDim ? angle : angle + Math.PI / 2;

    const fromBody = {
      centre: { x: cx, y: cy },
      angle: axisAngle,
      length: along,
      thickness,
      height: depth,
      zBase: objectPlacement.z + solidPlacement.z,
    };

    // Liegt eine Achsen-Repräsentation vor, gewinnt sie — die Dicke bleibt
    // aber aus dem Körper, denn die Achse allein sagt nichts darüber.
    const curve = axisCurveOf(e);
    if (curve) {
      const dx = curve.b.x - curve.a.x;
      const dy = curve.b.y - curve.a.y;
      return {
        ...fromBody,
        centre: { x: (curve.a.x + curve.b.x) / 2, y: (curve.a.y + curve.b.y) / 2 },
        angle: Math.atan2(dy, dx),
        length: Math.hypot(dx, dy),
      };
    }

    return fromBody;
  };

  for (const type of WALL_TYPES) {
    for (const e of byType.get(type) ?? []) {
      const axis = axisOf(e);
      if (!axis || axis.length < 0.05) {
        note('Wand ohne auswertbare Extrusionsgeometrie');
        continue;
      }

      const levelId = levelOfProduct.get(e.id) ?? fallbackLevel;
      const half = axis.length / 2;
      const dx = Math.cos(axis.angle) * half;
      const dy = Math.sin(axis.angle) * half;
      const a = nodeAt(axis.centre.x - dx, axis.centre.y - dy, levelId);
      const b = nodeAt(axis.centre.x + dx, axis.centre.y + dy, levelId);
      if (a.id === b.id) {
        note('Wand mit zusammenfallenden Enden');
        continue;
      }

      const name = typeof e.attributes[2] === 'string' ? e.attributes[2] : '';
      const wallType = guessWallType(axis.thickness, name);
      walls.push({
        id: `ifc-w${e.id}`,
        a: a.id,
        b: b.id,
        thickness: Math.round(Math.max(0.05, axis.thickness) * 1000) / 1000,
        height: Math.round(Math.max(1, axis.height || 2.75) * 1000) / 1000,
        type: wallType,
        layerId: 'layer-walls',
        uValue: VORGABE_U[wallType],
        levelId,
      });
    }
  }

  // --- Öffnungen -------------------------------------------------------------
  // Zuordnung Öffnung → Wand über IfcRelVoidsElement, Art über IfcRelFillsElement.
  const wallOfOpening = new Map<number, number>();
  for (const rel of byType.get('IFCRELVOIDSELEMENT') ?? []) {
    const host = rel.attributes[4];
    const opening = rel.attributes[5];
    if (isRef(host) && isRef(opening)) wallOfOpening.set(opening.ref, host.ref);
  }

  const fillOfOpening = new Map<number, OpeningKind>();
  for (const rel of byType.get('IFCRELFILLSELEMENT') ?? []) {
    const opening = rel.attributes[4];
    const filler = rel.attributes[5];
    if (!isRef(opening) || !isRef(filler)) continue;
    const f = entities.get(filler.ref);
    if (!f) continue;
    if (f.type === 'IFCWINDOW') fillOfOpening.set(opening.ref, 'window');
    else if (f.type === 'IFCDOOR') fillOfOpening.set(opening.ref, 'door');
  }

  const wallById = new Map(walls.map((w) => [w.id, w]));
  let openingCounter = 0;

  for (const e of byType.get('IFCOPENINGELEMENT') ?? []) {
    const hostId = wallOfOpening.get(e.id);
    const wall = hostId !== undefined ? wallById.get(`ifc-w${hostId}`) : undefined;
    if (!wall) {
      note('Öffnung ohne zugehörige Wand');
      continue;
    }

    const axis = axisOf(e);
    if (!axis) {
      note('Öffnung ohne auswertbare Geometrie');
      continue;
    }

    const na = nodes.find((n) => n.id === wall.a);
    const nb = nodes.find((n) => n.id === wall.b);
    if (!na || !nb) continue;

    // Abstand des Öffnungsmittelpunkts entlang der Wandachse.
    const wx = nb.x - na.x;
    const wy = nb.y - na.y;
    const wallLength = Math.hypot(wx, wy);
    if (wallLength < 1e-6) continue;
    const t = ((axis.centre.x - na.x) * wx + (axis.centre.y - na.y) * wy) / (wallLength * wallLength);
    const distance = t * wallLength;
    if (distance < 0 || distance > wallLength) {
      note('Öffnung außerhalb ihrer Wand');
      continue;
    }

    // Die Öffnungsbreite liegt längs der Wand, nicht quer — die kürzere
    // Profilseite ist die Wanddicke plus Zugabe.
    const width = axis.length;
    const kind: OpeningKind = fillOfOpening.get(e.id) ?? (axis.zBase > 0.3 ? 'window' : 'passage');
    const height = axis.height || (kind === 'window' ? 1.4 : 2.01);
    const sill = kind === 'window' ? Math.max(0, axis.zBase) : 0;

    if (width < 0.2 || width > wallLength) {
      note('Öffnung mit unplausibler Breite');
      continue;
    }

    openings.push({
      id: `ifc-o${openingCounter++}`,
      wallId: wall.id,
      kind,
      distance: Math.round(distance * 1000) / 1000,
      width: Math.round(width * 1000) / 1000,
      height: Math.round(height * 1000) / 1000,
      sillHeight: Math.round(sill * 1000) / 1000,
      layerId: 'layer-openings',
      ...(kind === 'window'
        ? { uValue: U_FENSTER_BESTAND }
        : kind === 'door'
          ? { uValue: U_TUER_BESTAND }
          : {}),
      gValue: kind === 'window' ? 0.6 : undefined,
    } as Opening);
  }

  const message = walls.length
    ? `${walls.length} Wände, ${openings.length} Öffnungen und ${levels.length} Geschoss(e) gelesen`
    : 'Keine auswertbaren Wände gefunden — enthält die Datei Extrusionskörper?';

  return {
    ok: walls.length > 0,
    message,
    schema,
    projectName,
    levels,
    nodes,
    walls,
    openings,
    skipped: [...skipped.entries()].map(([reason, count]) => ({ reason, count })),
  };
}
