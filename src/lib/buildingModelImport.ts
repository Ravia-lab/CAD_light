/**
 * Import des „RaVia Building Model" (Format `ravia.building`, Schema 1.x).
 * ---------------------------------------------------------------------------
 * Das Gegenstück zur App **RaVia Scan**: Das iPhone scannt mit RoomPlan, die
 * Transformation Engine der App rechnet den Scan auf dem Gerät in dieses
 * Format um, RaVia prüft es und reicht es über die Einbettung
 * (`loadBuilding`, Embed-API 1.3.0) hierher durch. Kein Datei-Export, kein
 * Datei-Import, und CAD Light bekommt **nie** RoomPlan-Rohdaten zu sehen.
 *
 * Anders als `raumplanImport.ts` wird hier nichts mehr erkannt oder
 * geradegerückt — das hat die App getan, und das Modell sagt, wie:
 *
 *   · Wände als Achsen, Außenwände bereits um die halbe Stärke nach außen
 *     versetzt; Stärke gemessen (Flächenpaar) oder geschätzt (`thicknessSource`).
 *   · Öffnungen mit Wandbezug und Mittenabstand vom Wandanfang.
 *   · Plan mit **y nach Norden-oben** und Nordrichtung als Planwinkel
 *     (`orientation.northPlanAngleDeg`, gegen den Uhrzeigersinn ab +x). Das
 *     ist dieselbe Achslage wie hier (Modell-y nach oben) — übernommen wird
 *     also ohne Spiegelung und ohne Drehung.
 *   · Dachschätzung je Geschoss (`levels[].roof`) aus den Dachschrägen.
 *   · Heizkörper (seit Schema 1.2.0) mit Maßen vom LiDAR und der Bauart,
 *     die der Monteur bestätigt hat (Via schlägt nur vor).
 *
 * Was hier noch geschieht, ist Übersetzung in die Begriffe dieses Modells:
 * Knoten aus Wandenden, T-Stöße (dieselbe Routine wie beim RoomPlan-Import,
 * sonst schließt die Raumerkennung nicht), Heizkörper als Objekte der
 * Symbolbibliothek. Eine **Heizleistung wird nicht gesetzt** — RaVia Scan
 * misst Geometrie und rechnet nichts; die Leistung ist Sache der Auslegung.
 */

import type { BimNode, Fixture, FixtureType, Opening, OpeningKind, RoofKind, RoomUsage, Vec2, Wall, WallType } from '../types/bim';
import { VORGABE_U } from './uwert';
import {
  bauart,
  teileAnStoessen,
  U_FENSTER_BESTAND,
  U_TUER_BESTAND,
  type Annahme,
  type RaumHinweis,
  type RaumplanGeschoss,
  type RaumplanImportErgebnis,
} from './raumplanImport';

export const BUILDING_FORMAT = 'ravia.building';

/** Dachvorschlag aus dem Scan, in den Begriffen von `RoofDefinition`. */
export interface DachVorschlag {
  kind: RoofKind;
  pitch: number;
  kneeHeight: number;
  azimuth: number;
  collarHeight?: number;
}

export interface BuildingImportErgebnis extends RaumplanImportErgebnis {
  /** Heizkörper, noch ohne Raumbezug — den setzt die Raumerkennung. */
  fixtures: Fixture[];
  /** Dach je Geschoss-ID. */
  daecher: Record<string, DachVorschlag>;
  /** Herkunft für die Meldung („RaVia Scan 0.4 · iPhone16,1"). */
  quelle?: string;
  heizkoerperUnbestaetigt: number;
}

// --- Gestalt des Modells (nur, was gelesen wird) ------------------------------

interface P { x: number; y: number }
interface RbmWall {
  id: string; levelId: string; start: P; end: P; height: number; thickness: number;
  thicknessSource?: string; type: string; confidence?: number;
}
interface RbmRoom {
  id: string; levelId: string; name?: string; usage?: string; polygon?: P[];
  nameSource?: string; raviaRoomId?: string;
}
interface RbmOpening {
  id: string; wallId: string; kind: string; width: number; height: number; sillHeight: number;
  centerOffset?: number; confidence?: number;
}
interface RbmLevel {
  id: string; name?: string; elevation: number; height: number;
  roof?: { kind?: string; pitchDeg?: number; kneeHeight?: number; slopeAzimuthsDeg?: number[]; collarHeight?: number };
}
interface RbmEmitter {
  id: string; levelId: string; wallId?: string | null; kind: string; position: P; rotationDeg: number;
  width: number; height: number; depth: number; bottomHeight: number;
  suggestion?: { panelType?: string | null; manufacturer?: string | null; model?: string | null; confirmed?: boolean } | null;
  photoIds?: string[];
}
interface Rbm {
  format?: string; schemaVersion?: string;
  project?: { name?: string; address?: string };
  location?: { latitude?: number; longitude?: number };
  source?: { app?: { name?: string; version?: string }; device?: { model?: string } };
  orientation?: { northPlanAngleDeg?: number; northAccuracyDeg?: number; northSource?: string };
  levels?: RbmLevel[]; walls?: RbmWall[]; openings?: RbmOpening[];
  roomHints?: { levelId: string; name: string; usage: string; point: P }[];
  rooms?: RbmRoom[];
  emitters?: RbmEmitter[];
}

const LEER: BuildingImportErgebnis = {
  ok: false, message: '', drehung: 0, levels: [], nodes: [], walls: [], openings: [],
  raumHinweise: [], geschaetzt: [], skipped: [], fixtures: [], daecher: {}, heizkoerperUnbestaetigt: 0,
};

const KNOTEN_TOLERANZ = 0.05;
const BRUESTUNGS_HOEHE = 1.6;
const USAGES: RoomUsage[] = ['living', 'bedroom', 'kitchen', 'bath', 'wc', 'hallway', 'office', 'storage', 'technical', 'other'];
const DACHFORMEN: Record<string, RoofKind> = { gable: 'gable', monopitch: 'monopitch', hip: 'hip', flat: 'flat' };

const rund = (v: number, stellen = 3): number => {
  const f = 10 ** stellen;
  return Math.round(v * f) / f;
};
const zahl = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const punkt = (p: unknown): p is P => !!p && zahl((p as P).x) && zahl((p as P).y);
const normGrad = (d: number): number => rund(((d % 360) + 360) % 360, 2);

/** Ist das ein RaVia Building Model? Für Dateiwahl und Einbettung. */
export function istBuildingModel(data: unknown): boolean {
  return !!data && typeof data === 'object' && (data as Rbm).format === BUILDING_FORMAT;
}

export function importBuildingModel(data: unknown): BuildingImportErgebnis {
  let m: Rbm;
  try {
    m = (typeof data === 'string' ? JSON.parse(data) : data) as Rbm;
  } catch {
    return { ...LEER, message: 'Das Gebäudemodell ist kein lesbares JSON.' };
  }
  if (!m || typeof m !== 'object' || m.format !== BUILDING_FORMAT) {
    return { ...LEER, message: 'Das ist kein RaVia Building Model (format „ravia.building").' };
  }
  const haupt = String(m.schemaVersion ?? '').split('.')[0];
  if (haupt !== '1') {
    return { ...LEER, message: `Schema ${m.schemaVersion ?? '(fehlt)'} wird nicht unterstützt — diese Fassung liest 1.x.` };
  }
  const rbmLevels = Array.isArray(m.levels) ? m.levels : [];
  const rbmWalls = Array.isArray(m.walls) ? m.walls : [];
  if (rbmLevels.length === 0 || rbmWalls.length === 0) {
    return { ...LEER, message: 'Das Gebäudemodell enthält keine Wände.' };
  }

  const uebersprungen = new Map<string, number>();
  const merke = (grund: string): void => { uebersprungen.set(grund, (uebersprungen.get(grund) ?? 0) + 1); };

  // --- Geschosse ------------------------------------------------------------
  const levelIds = new Set<string>();
  const levels: RaumplanGeschoss[] = [];
  const daecher: Record<string, DachVorschlag> = {};
  for (const l of rbmLevels) {
    if (!l || typeof l.id !== 'string' || !zahl(l.elevation) || !zahl(l.height)) continue;
    levelIds.add(l.id);
    // Platzhaltername: die Benennung nach Höhenlage macht der Store (wie beim Scan).
    levels.push({ id: l.id, name: l.name || l.id, elevation: rund(l.elevation), height: rund(l.height) });
    const r = l.roof;
    const form = r?.kind ? DACHFORMEN[r.kind] : undefined;
    if (r && form && zahl(r.pitchDeg)) {
      daecher[l.id] = {
        kind: form,
        pitch: rund(Math.min(75, Math.max(0, r.pitchDeg)), 1),
        kneeHeight: zahl(r.kneeHeight) ? rund(r.kneeHeight, 2) : 0,
        // Beim Satteldach die Richtung der *einen* Dachfläche — im Modell
        // stehen beide, die erste genügt (die Firstachse steht senkrecht dazu).
        azimuth: normGrad(r.slopeAzimuthsDeg?.[0] ?? 90),
        ...(zahl(r.collarHeight) && r.collarHeight < l.height - 0.05 ? { collarHeight: rund(r.collarHeight, 2) } : {}),
      };
    }
  }

  // --- Knoten und Wände -----------------------------------------------------
  const knoten: BimNode[] = [];
  const knotenAn = (p: Vec2, levelId: string): BimNode => {
    for (const k of knoten) {
      if (k.levelId === levelId && Math.hypot(k.x - p.x, k.y - p.y) <= KNOTEN_TOLERANZ) return k;
    }
    const neu: BimNode = { id: `sc-n${knoten.length}`, x: rund(p.x), y: rund(p.y), levelId };
    knoten.push(neu);
    return neu;
  };
  const walls: Wall[] = [];
  const unten = new Map<string, number>();
  const wandZuQuelle = new Map<string, Wall[]>();
  /** Für Öffnungen und Heizkörper: Anfangspunkt und Richtung der Originalwand. */
  const quellAchse = new Map<string, { start: P; dx: number; dy: number; laenge: number; levelId: string }>();
  let geschaetzteStaerken = 0;
  let aussenZahl = 0;

  for (const w of rbmWalls) {
    if (!w || typeof w.id !== 'string' || !levelIds.has(w.levelId) || !punkt(w.start) || !punkt(w.end) ||
        !zahl(w.height) || !zahl(w.thickness)) {
      merke('Wand unvollständig');
      continue;
    }
    const laenge = Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y);
    if (laenge < 0.05) { merke('Wand kürzer als 5 cm'); continue; }
    const a = knotenAn(w.start, w.levelId);
    const b = knotenAn(w.end, w.levelId);
    if (a.id === b.id) { merke('Wand kürzer als die Knotentoleranz'); continue; }
    const aussen = w.type === 'exterior';
    const typ: WallType = aussen ? 'exterior' : w.height < BRUESTUNGS_HOEHE ? 'partition' : 'interior';
    if (aussen) aussenZahl++;
    // `measuredFacePair` (beide Wandseiten gescannt) und `measuredJamb` (an
    // der Türlaibung gemessen) sind Messungen; `fromJambSample` und
    // `estimated` sind es nicht.
    const geschaetzt = !String(w.thicknessSource ?? '').startsWith('measured');
    if (geschaetzt) geschaetzteStaerken++;
    const wand: Wall = {
      id: w.id,
      levelId: w.levelId,
      a: a.id,
      b: b.id,
      thickness: rund(Math.max(0.05, w.thickness)),
      ...(geschaetzt ? { thicknessEstimated: true } : {}),
      height: rund(w.height),
      type: typ,
      layerId: 'layer-walls',
      uValue: VORGABE_U[typ],
      ...(zahl(w.confidence) ? { confidence: rund(w.confidence, 2) } : {}),
    };
    walls.push(wand);
    unten.set(wand.id, 0);
    wandZuQuelle.set(w.id, [wand]);
    quellAchse.set(w.id, {
      start: w.start, dx: (w.end.x - w.start.x) / laenge, dy: (w.end.y - w.start.y) / laenge, laenge, levelId: w.levelId,
    });
  }
  if (walls.length === 0) return { ...LEER, message: 'Keine Wand des Gebäudemodells war verwendbar.' };

  const stoesse = teileAnStoessen(walls, knoten, unten, wandZuQuelle);
  const benutzt = new Set(walls.flatMap((w) => [w.a, w.b]));
  const knotenRein = knoten.filter((k) => benutzt.has(k.id));
  const knotenNach = new Map(knotenRein.map((k) => [k.id, k]));

  /** Das Teilstück einer (evtl. geteilten) Wand, das `p` am nächsten liegt, mit Abstand vom Teilanfang. */
  const teilstueck = (quelle: string, p: Vec2): { wand: Wall; distance: number; laenge: number; ab: number } | null => {
    let best: { wand: Wall; distance: number; laenge: number; ab: number } | null = null;
    for (const wand of wandZuQuelle.get(quelle) ?? []) {
      const a = knotenNach.get(wand.a);
      const b = knotenNach.get(wand.b);
      if (!a || !b) continue;
      const vx = b.x - a.x;
      const vy = b.y - a.y;
      const laenge = Math.hypot(vx, vy);
      if (laenge < 1e-6) continue;
      const t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / laenge;
      const ab = t < 0 ? -t : t > laenge ? t - laenge : 0;
      if (!best || ab < best.ab) best = { wand, distance: t, laenge, ab };
    }
    return best;
  };

  // --- Öffnungen ------------------------------------------------------------
  const openings: Opening[] = [];
  for (const o of Array.isArray(m.openings) ? m.openings : []) {
    const kind = o?.kind as OpeningKind;
    if (!o || !['door', 'window', 'passage'].includes(kind) || !zahl(o.width) || !zahl(o.height) || !zahl(o.sillHeight)) {
      merke('Öffnung unvollständig');
      continue;
    }
    const achse = quellAchse.get(o.wallId);
    if (!achse) { merke('Öffnung ohne zugehörige Wand'); continue; }
    const off = zahl(o.centerOffset) ? o.centerOffset : achse.laenge / 2;
    const mitte = { x: achse.start.x + achse.dx * off, y: achse.start.y + achse.dy * off };
    const teil = teilstueck(o.wallId, mitte);
    if (!teil || teil.ab > 0.16) { merke('Öffnung liegt außerhalb ihrer Wand'); continue; }
    if (o.width > teil.laenge + 0.16) { merke('Öffnung breiter als ihre Wand'); continue; }
    openings.push({
      id: `sc-${o.id}`,
      wallId: teil.wand.id,
      kind,
      distance: rund(Math.max(0, Math.min(teil.laenge, teil.distance))),
      width: rund(o.width),
      height: rund(o.height),
      sillHeight: rund(kind === 'window' ? Math.max(0, o.sillHeight) : 0),
      layerId: 'layer-openings',
      ...(kind === 'window' ? { uValue: U_FENSTER_BESTAND, gValue: 0.6 } : kind === 'door' ? { uValue: U_TUER_BESTAND } : {}),
      ...(zahl(o.confidence) ? { confidence: rund(o.confidence, 2) } : {}),
      ...bauart(kind, o.width, o.height, o.sillHeight),
    } as unknown as Opening);
  }

  // --- Raumnutzung ----------------------------------------------------------
  //
  // Zwei Quellen, klare Rangfolge: Was der Monteur beim Scannen benannt hat,
  // geht vor die Bereichsbezeichnung, die RoomPlan geraten hat. Zugeordnet
  // wird über die Lage — die Raumerkennung hier arbeitet an den Wandachsen
  // und muss nicht dieselben Grenzen finden wie der Scan.
  const raumHinweise: RaumHinweis[] = [];
  let benannteRaeume = 0;
  for (const r of Array.isArray(m.rooms) ? m.rooms : []) {
    if (!r || r.nameSource !== 'user' || typeof r.name !== 'string') continue;
    if (!levelIds.has(r.levelId) || !Array.isArray(r.polygon) || r.polygon.length < 3) continue;
    const gueltig = r.polygon.filter(punkt);
    if (gueltig.length < 3) continue;
    const mitte = gueltig.reduce((a, p) => ({ x: a.x + p.x / gueltig.length, y: a.y + p.y / gueltig.length }), { x: 0, y: 0 });
    raumHinweise.push({
      punkt: { x: rund(mitte.x), y: rund(mitte.y) },
      usage: (USAGES as string[]).includes(r.usage ?? '') ? (r.usage as RoomUsage) : 'other',
      name: r.name,
      levelId: r.levelId,
      ...(typeof r.raviaRoomId === 'string' ? { raviaRoomId: r.raviaRoomId } : {}),
      vomNutzer: true,
    });
    benannteRaeume += 1;
  }
  for (const h of Array.isArray(m.roomHints) ? m.roomHints : []) {
    if (!h || !punkt(h.point) || !levelIds.has(h.levelId) || typeof h.name !== 'string') continue;
    raumHinweise.push({
      punkt: { x: rund(h.point.x), y: rund(h.point.y) },
      usage: (USAGES as string[]).includes(h.usage) ? (h.usage as RoomUsage) : 'other',
      name: h.name,
      levelId: h.levelId,
    });
  }

  // --- Heizkörper -----------------------------------------------------------
  const fixtures: Fixture[] = [];
  let unbestaetigt = 0;
  for (const e of Array.isArray(m.emitters) ? m.emitters : []) {
    if (!e || typeof e.id !== 'string' || !levelIds.has(e.levelId) || !punkt(e.position) ||
        ![e.width, e.height, e.depth, e.bottomHeight, e.rotationDeg].every(zahl)) {
      merke('Heizkörper unvollständig');
      continue;
    }
    const s = e.suggestion ?? undefined;
    const bestaetigt = !!s?.confirmed;
    if (!bestaetigt) unbestaetigt++;
    const typ: FixtureType =
      e.kind === 'tube' ? 'radiator-tube'
        : e.kind === 'convector' ? 'convector'
          : e.kind === 'towel' ? 'towel-radiator'
            : 'radiator';
    const bauartText =
      e.kind === 'towel' ? 'Badheizkörper'
        : e.kind === 'tube' ? 'Röhren'
          : e.kind === 'panel' && bestaetigt && s?.panelType ? s.panelType : undefined;
    const wand = e.wallId ? teilstueck(e.wallId, e.position) : null;
    const hersteller = [s?.manufacturer, s?.model].filter(Boolean).join(' ');
    const label =
      (bauartText && e.kind === 'panel' ? `HK Typ ${bauartText}` : e.kind === 'towel' ? 'Badheizkörper' : 'Heizkörper') +
      (hersteller ? ` · ${hersteller}` : '') +
      (bestaetigt ? '' : ' (Bauart offen)');
    fixtures.push({
      id: `sc-${e.id}`,
      type: typ,
      category: 'heating',
      levelId: e.levelId,
      position: { x: rund(e.position.x), y: rund(e.position.y) },
      rotation: normGrad(e.rotationDeg),
      length: rund(e.width),
      depth: rund(e.depth),
      elevation: rund(e.bottomHeight),
      ...(wand && wand.ab < 0.2 ? { wallId: wand.wand.id } : {}),
      label,
      params: {
        ...(bauartText ? { radiatorType: bauartText } : {}),
        radiatorHeight: rund(e.height),
      },
    });
  }

  // --- Rechenschaft ---------------------------------------------------------
  const geschaetzt: Annahme[] = [];
  if (geschaetzteStaerken) {
    geschaetzt.push({
      was: 'Wandstärke', anzahl: geschaetzteStaerken,
      begruendung:
        'In RaVia Scan nicht gemessen, sondern angenommen — entweder pauschal nach Wandart oder von einer ' +
        'Laibungsmessung derselben Wandart übernommen. Die gemessenen Wände sind in der Prüfung erkennbar.',
    });
  }
  geschaetzt.push({
    was: 'U-Werte', anzahl: walls.length + openings.length,
    begruendung: 'Vorgabewerte der Anwendung; ein Scan misst keine Bauteilaufbauten.',
  });
  const tueren = openings.filter((o) => o.kind === 'door').length;
  if (tueren) {
    geschaetzt.push({ was: 'Türanschlag', anzahl: tueren, begruendung: 'Der Scan kennt die Bandseite nicht. Anschlag von Hand setzen.' });
  }
  const dachZahl = Object.keys(daecher).length;
  if (dachZahl) {
    geschaetzt.push({
      was: 'Dach', anzahl: dachZahl,
      begruendung: 'Neigung und Kniestock aus den gescannten Dachschrägen geschätzt. Dachaufbau und Firstlage prüfen.',
    });
  }
  if (fixtures.length) {
    geschaetzt.push({
      was: 'Heizleistung', anzahl: fixtures.length,
      begruendung: 'Der Scan misst Maße und Lage der Heizkörper, keine Leistung. Leistung in der Auslegung eintragen.',
    });
  }

  const o = m.orientation;
  const hatNorden = !!o && zahl(o.northPlanAngleDeg);
  const app = m.source?.app;
  const message =
    `${walls.length} Wände, ${openings.length} Öffnungen, ${levels.length} Geschoss(e)` +
    (benannteRaeume ? `, ${benannteRaeume} Räume benannt` : '') +
    (fixtures.length ? `, ${fixtures.length} Heizkörper` + (unbestaetigt ? ` (${unbestaetigt} Bauart offen)` : '') : '') +
    (stoesse ? `, ${stoesse} T-Stöße hergestellt` : '') +
    (dachZahl ? `, Dach aus dem Scan übernommen` : '') +
    (aussenZahl ? '' : ' · keine Außenwand im Scan');

  return {
    ok: true,
    message,
    projektName: m.project?.name?.trim() || undefined,
    adresse: m.project?.address?.trim() || undefined,
    koordinaten: zahl(m.location?.latitude) && zahl(m.location?.longitude)
      ? { breite: m.location!.latitude!, laenge: m.location!.longitude! } : undefined,
    drehung: 0,
    nordrichtung: hatNorden ? (o!.northPlanAngleDeg! * Math.PI) / 180 : undefined,
    nordGenauigkeitGrad: hatNorden && zahl(o!.northAccuracyDeg) ? rund(o!.northAccuracyDeg!, 1) : undefined,
    levels,
    nodes: knotenRein,
    walls,
    openings,
    raumHinweise,
    geschaetzt,
    skipped: [...uebersprungen].map(([reason, count]) => ({ reason, count })),
    fixtures,
    daecher,
    quelle: [app?.name, app?.version, m.source?.device?.model].filter(Boolean).join(' · ') || undefined,
    heizkoerperUnbestaetigt: unbestaetigt,
  };
}
