/**
 * Import des „RaVia Building Model" (Format `ravia.building`, Schema 1.x).
 * ---------------------------------------------------------------------------
 * Das Gegenstück zur App **RaVia Scan**: Das iPhone scannt mit **LiDAR**
 * (RoomPlan), die Transformation Engine der App rechnet den Scan auf dem
 * Gerät in dieses Format um, RaVia prüft es und reicht es über die
 * Einbettung (`loadBuilding`, Embed-API 1.3.0) hierher durch. CAD Light
 * bekommt **nie** RoomPlan-Rohdaten zu sehen.
 *
 * **Seit 1.63.0 kommt derselbe Scan auch als Datei.** Der Weg über die
 * Einbettung bleibt der Regelfall — er ist der, bei dem RaVia den Scan
 * geprüft hat. Aber er setzt voraus, dass RaVia daneben läuft, und das ist
 * beim Vorführen, beim Prüfen eines Scans und beim Arbeiten am Schreibtisch
 * gerade nicht so. Eine `.json` mit `format: "ravia.building"` wird deshalb
 * beim Öffnen erkannt (`istGebaeudescan`) und durch denselben Import
 * geschickt; ein Beispielscan liegt der Anwendung bei. Gelesen wird in
 * beiden Fällen **dieselbe** Datei mit demselben Code — es gibt keinen
 * zweiten Weg, der anders rechnen könnte.
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

import type { BimNode, BoundaryCondition, Fixture, RatedPowerSource, FixtureType, Opening, OpeningKind, RoofKind, RoomUsage, ScanDachHerkunft, Vec2, Wall, WallType } from '../types/bim';
import { BOUNDARY_CONDITIONS } from '../types/bim';
export type { ScanDachHerkunft } from '../types/bim';
import { U_FENSTER_BESTAND, U_TUER_BESTAND, VORGABE_U } from './uwert';
import {
  bauart,
  teileAnStoessen,
  type Annahme,
  type RaumHinweis,
  type RaumplanGeschoss,
  type RaumplanImportErgebnis,
} from './raumplanImport';

export const BUILDING_FORMAT = 'ravia.building';

/**
 * Ist diese Datei ein Gebäudescan?
 *
 * Gesucht wird im **ganzen** Text und nicht nur im Anfang — aus demselben
 * Grund wie bei `istRaumplanDatei`: Die Felder stehen alphabetisch, und
 * `format` kommt nach `emitters`, deren Fotoverweise und Maße bei einem
 * ganzen Haus einige Kilobytes füllen. Ein `indexOf` über die Zeichenkette
 * kostet dabei nichts.
 *
 * Geprüft wird das Formatkennzeichen und nicht die Dateiendung: Eine `.json`
 * ist zunächst nur eine Datei. Ob das Schema mitgelesen werden kann, sagt
 * danach `importBuildingModel` — mit einer Meldung, die die Fassung nennt.
 */

/**
 * B4: Die Scan-App schreibt die Leistungsquelle englisch (`catalog`, siehe
 * scan `APIModels.swift`), CAD Light kennt nur die deutschen Werte. Bisher
 * wurde jeder unbekannte Wert stillschweigend zu `datenblatt`.
 */
const LEISTUNGSQUELLE_SYNONYME: Readonly<Record<string, RatedPowerSource>> = {
  katalog: 'katalog', catalog: 'katalog',
  typenschild: 'typenschild', nameplate: 'typenschild',
  datenblatt: 'datenblatt', datasheet: 'datenblatt',
  schaetzung: 'schaetzung', estimate: 'schaetzung', estimated: 'schaetzung',
};

export function leistungsQuelle(roh: unknown): RatedPowerSource {
  const schluessel = typeof roh === 'string' ? roh.trim().toLowerCase() : '';
  return LEISTUNGSQUELLE_SYNONYME[schluessel] ?? 'datenblatt';
}

export function istGebaeudescan(text: string): boolean {
  if (!text.trimStart().startsWith('{')) return false;
  return /"format"\s*:\s*"ravia\.building"/.test(text);
}

/** Dachvorschlag aus dem Scan, in den Begriffen von `RoofDefinition`. */
export interface DachVorschlag {
  kind: RoofKind;
  pitch: number;
  kneeHeight: number;
  azimuth: number;
  collarHeight?: number;
  /**
   * Umriss der Schräge im Plan (`roof.footprint`, seit Schema 1.12.0): vier
   * Punkte [m], gegen den Uhrzeigersinn, offen. Fehlt er, entscheiden die
   * Wandbelege (`dachBelege`), welche Räume unter dem Dach liegen.
   */
  umriss?: Vec2[];
  /** Was der Scan über die Herkunft der Dachmaße sagt (Schema 1.10.0). */
  scan: ScanDachHerkunft;
}

/** Ein Prüfpunkt aus der Prüfliste der App, mit Ort im Grundriss. */
export interface ScanPruefpunkt {
  levelId: string;
  punkt: Vec2;
  text: string;
  schwere: 'error' | 'warning' | 'info';
  code: string;
}

export interface BuildingImportErgebnis extends RaumplanImportErgebnis {
  /** Heizkörper, noch ohne Raumbezug — den setzt die Raumerkennung. */
  fixtures: Fixture[];
  /** Dach je Geschoss-ID. */
  daecher: Record<string, DachVorschlag>;
  /** Herkunft für die Meldung („RaVia Scan 0.4 · iPhone16,1"). */
  quelle?: string;
  heizkoerperUnbestaetigt: number;
  /**
   * Die Wände (Kennungen dieses Modells, nach dem Teilen an T-Stößen), die
   * belegen, dass über ihnen eine Dachschräge liegt — je Geschoss.
   * Siehe `scanDachZuordnen` in `lib/scanUebernahme.ts`.
   */
  dachBelege: Record<string, string[]>;
  /** Prüfpunkte der App mit Ort — werden Hinweisfahnen im Grundriss. */
  pruefpunkte: ScanPruefpunkt[];
  /** Prüfpunkte der App ohne Ort — für die Übernahmemeldung. */
  pruefhinweise: { text: string; schwere: 'error' | 'warning' | 'info'; code: string }[];
  /** „± 3,0 % (angenommen, kein Kontrollmaß)" — oder undefiniert, wenn der Scan nichts sagt. */
  toleranz?: string;
  /**
   * Netto-Wandflächen aus dem Scan [m²] je Quellwand (`walls[].netArea`).
   * Gelesen für die Gegenprobe im Prüfblock, nicht für die Rechnung: Die
   * Flächen rechnet dieses Programm aus seiner eigenen Geometrie, und zwei
   * Quellen für dieselbe Fläche wären zwei Wahrheiten.
   */
  wandNettoflaechen: Record<string, number>;
  /**
   * Luftvolumen je Geschoss, wie der Scan es rechnet (`rooms[].volume`,
   * `volumeFlat`, `volumeSource`, Schema 1.10.0) — summiert über die Räume
   * des Scans. Gelesen für die Gegenprobe in der Übernahmemeldung: Die
   * Räume entstehen hier aus der eigenen Erkennung, ihr Volumen auch; das
   * des Scans steht daneben, damit eine große Abweichung auffällt.
   */
  scanVolumen: { levelId: string; volumen: number; volumenGerade?: number; quelle?: string }[];
  /**
   * Beheizt oder nicht je Scanraum (`rooms[].heated`, Brücke K2). Die Räume
   * entstehen aus der eigenen Erkennung; übertragen wird über die Lage, wie
   * beim Namen — siehe `uebernimmBeheizung` in `lib/scanUebernahme.ts`.
   */
  raumBeheizung: { levelId: string; punkt: Vec2; flaeche: Vec2[]; heated: boolean }[];
}

// --- Gestalt des Modells (nur, was gelesen wird) ------------------------------

interface P { x: number; y: number }
interface RbmWall {
  id: string; levelId: string; start: P; end: P; height: number; thickness: number;
  thicknessSource?: string; type: string; confidence?: number;
  /** Seit Schema 1.10.0: Kniestockwand unter der Traufe. */
  kneeWall?: boolean;
  /** Seit Schema 1.10.0: Schrägumriss einer Giebel- oder Innenwand unter dem Dach. */
  profile?: unknown[];
  netArea?: number;
  /** Randbedingung nach Festlegung F4 (Scan-Brücke K2). */
  boundary?: string;
}
interface RbmRoom {
  id: string; levelId: string; name?: string; usage?: string; polygon?: P[];
  nameSource?: string; raviaRoomId?: string;
  volumeSource?: string; volumeFlat?: number; volume?: number;
  /** Beheizt (Festlegung F4: `heated` im Scan = `isHeated` hier, Brücke K2). */
  heated?: boolean;
}
interface RbmOpening {
  id: string; wallId: string; kind: string; width: number; height: number; sillHeight: number;
  centerOffset?: number; confidence?: number;
}
interface RbmLevel {
  id: string; name?: string; elevation: number; height: number;
  roof?: {
    kind?: string; pitchDeg?: number; kneeHeight?: number; slopeAzimuthsDeg?: number[]; collarHeight?: number;
    kneeWallIds?: string[];
    /** Seit Schema 1.10.0: „user" (gemessen) oder „scan" (geschätzt). */
    source?: string; ridgeHeight?: number; userDelta?: number;
    /** Seit Schema 1.12.0: Umriss der Schräge (4 Planpunkte) und Fallrichtung als Planvektor. */
    footprint?: P[]; fallDirection?: P;
  };
  /** Seit Schema 1.4.0: Dachflächen getrennt nach Fallrichtung. */
  roofSegments?: { azimuthDeg?: number; pitchDeg?: number }[];
}
interface RbmCheck {
  code?: string; severity?: string; text?: string; count?: number; points?: P[]; roomIds?: string[];
}
interface RbmAccuracy {
  basis?: string; roomAreaUncertaintyPct?: number; scaleChecked?: boolean;
}
interface RbmEmitter {
  id: string; levelId: string; wallId?: string | null; kind: string; position: P; rotationDeg: number;
  width: number; height: number; depth: number; bottomHeight: number;
  suggestion?: { panelType?: string | null; manufacturer?: string | null; model?: string | null; confirmed?: boolean } | null;
  photoIds?: string[];
  /**
   * Von RaVia beim `loadBuilding` mitgegeben (Brücke H1, Festlegung F2):
   * Normleistung bei 75/65/20 °C [W], Exponent, Herkunft und Bauart.
   */
  ratedPower?: number;
  exponentN?: number;
  ratedPowerSource?: string;
  panelType?: string | null;
}
interface Rbm {
  format?: string; schemaVersion?: string;
  project?: { name?: string; address?: string; location?: { latitude?: number; longitude?: number } };
  location?: { latitude?: number; longitude?: number };
  checklist?: RbmCheck[];
  accuracy?: RbmAccuracy;
  source?: { app?: { name?: string; version?: string }; device?: { model?: string } };
  orientation?: { northPlanAngleDeg?: number; northAccuracyDeg?: number; northSource?: string };
  levels?: RbmLevel[]; walls?: RbmWall[]; openings?: RbmOpening[];
  roomHints?: { levelId: string; name: string; usage: string; point: P }[];
  rooms?: RbmRoom[];
  emitters?: RbmEmitter[];
}

const LEER: BuildingImportErgebnis = {
  ok: false, message: '', drehung: 0, levels: [], nodes: [], walls: [], openings: [],
  raumHinweise: [], geschaetzt: [], skipped: [], fixtures: [], daecher: {}, heizkoerperUnbestaetigt: 0, scanVolumen: [], raumBeheizung: [],
  dachBelege: {}, pruefpunkte: [], pruefhinweise: [], wandNettoflaechen: {},
};

/**
 * Randbedingung einer Scanwand übernehmen (Festlegung F4, Brücke K2).
 *
 * Gesetzt wird sie nur, wo sie von der eigenen Ableitung abweicht: eine
 * Außenwand ist ohnehin `exterior`, eine Innenwand mit Raum dahinter ohnehin
 * `adjacent-room`. Was der Scan darüber hinaus weiß — Erdreich, unbeheizt,
 * fremde Nutzung, adiabat —, kann die Geometrie nicht hergeben.
 */
export function randAusScan(rand: unknown, typ: WallType): BoundaryCondition | undefined {
  if (typeof rand !== 'string' || !(BOUNDARY_CONDITIONS as readonly string[]).includes(rand)) return undefined;
  const r = rand as BoundaryCondition;
  if (typ === 'exterior' && r === 'exterior') return undefined;
  if (typ !== 'exterior' && r === 'adjacent-room') return undefined;
  return r;
}

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

  // --- Nordrichtung --------------------------------------------------------
  //
  // Die Dachrichtung aus dem Scan ist eine **Kompassrichtung** (0° =
  // geografisch Nord). `RoofDefinition.azimuth` ist dagegen **planbezogen**
  // (0° = Plan-oben); erst der Export rechnet mit der Nordabweichung des
  // Projekts in die Kompassrichtung um (`Planazimut − Nordabweichung`). Der
  // Import muss also umgekehrt rechnen: `Kompass + Nordabweichung`.
  //
  // Bis 1.69.0 ging die Kompasszahl unverändert in den Plan. Beim Feldscan
  // vom 02.10.2026 zeigt Norden im Plan nach 205° statt 90° — das Dach lag
  // um diese Abweichung schief über dem Haus, die Dachflächen kreuzten sich
  // mit den Wänden. Bei einem Scan ohne Kompasswert gilt Plan-oben als Nord
  // (Abweichung 0), wie überall sonst im Programm.
  const nordPlan = m.orientation?.northPlanAngleDeg;
  const nordAbweichung = zahl(nordPlan) ? 90 - nordPlan : 0;
  const zumPlan = (kompass: number): number => normGrad(kompass + nordAbweichung);

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
      /*
       * Schema 1.12.0 (Brücke H3): `fallDirection` ist ein Einheitsvektor im
       * Plan — kein Kompasswinkel, braucht also keine Nordrichtung. Im Plan
       * gilt 0° = Plan-oben, im Uhrzeigersinn: atan2(x, y). Beim Satteldach
       * ist das Vorzeichen bedeutungslos (beide Hälften fallen gegenläufig),
       * beim Pultdach kann es bis Scan-Build 18 verkehrt sein — dann
       * korrigiert man es wie bisher am Dach. Ohne Vektor: Kompass +
       * Nordabweichung, ohne beides Plan-Ost.
       */
      const fall = punkt(r.fallDirection) && Math.hypot(r.fallDirection.x, r.fallDirection.y) > 0.5 ? r.fallDirection : null;
      const umriss = Array.isArray(r.footprint) && r.footprint.length >= 3 && r.footprint.every(punkt)
        ? r.footprint.map((p) => ({ x: rund(p.x), y: rund(p.y) }))
        : undefined;
      const segmente = (Array.isArray(l.roofSegments) ? l.roofSegments : [])
        .filter((s) => s && zahl(s.azimuthDeg) && zahl(s.pitchDeg))
        .map((s) => ({ azimuth: normGrad(s.azimuthDeg!), pitch: rund(s.pitchDeg!, 1) }));
      daecher[l.id] = {
        kind: form,
        pitch: rund(Math.min(75, Math.max(0, r.pitchDeg)), 1),
        kneeHeight: zahl(r.kneeHeight) ? rund(r.kneeHeight, 2) : 0,
        // Beim Satteldach die Richtung der *einen* Dachfläche — im Modell
        // stehen beide, die erste genügt (die Firstachse steht senkrecht dazu).
        // Ohne Angabe: nach Plan-Ost wie bisher, ohne Umrechnung.
        azimuth: fall
          ? normGrad((Math.atan2(fall.x, fall.y) * 180) / Math.PI)
          : zahl(r.slopeAzimuthsDeg?.[0]) ? zumPlan(r.slopeAzimuthsDeg![0]) : 90,
        ...(umriss ? { umriss } : {}),
        // Kehlbalkenlage: Liegt sie auf Geschosshöhe (bis 0,30 m darüber, so
        // weit streut die Schätzung aus den Wandumrissen), ist sie die
        // waagerechte Decke des Dachgeschosses und wird auf die Geschosshöhe
        // begrenzt. Bis 1.73.0 fiel sie dann weg, und die Räume rechneten bis
        // unter den First: im Feldscan vom 02.10.2026 (2,43 m bei 2,41 m
        // Geschosshöhe) mittlere Raumhöhen von 4,7–5,8 m statt rund 2,2 m.
        // Deutlich höher (Galerie, offener Dachraum) bleibt sie, wie gemessen.
        ...(zahl(r.collarHeight) && r.collarHeight > 0.5
          ? { collarHeight: rund(r.collarHeight <= l.height + 0.3 ? Math.min(r.collarHeight, l.height) : r.collarHeight, 2) }
          : {}),
        scan: {
          herkunft: r.source === 'user' ? 'gemessen' : r.source === 'scan' ? 'geschaetzt' : 'unbekannt',
          ...(zahl(r.ridgeHeight) ? { firsthoehe: rund(r.ridgeHeight, 2) } : {}),
          ...(zahl(r.userDelta) ? { korrektur: rund(r.userDelta, 2) } : {}),
          segmente,
          // Wird unten gesetzt, sobald die Wände gelesen sind.
          lageBelegt: false,
        },
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
      ...(randAusScan(w.boundary, typ) ? { boundary: randAusScan(w.boundary, typ) } : {}),
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

  // --- Wo sitzt das Dach? (Schema 1.10.0) ---------------------------------
  //
  // Bis 1.69.0 legte der Import das eine Dach eines Geschosses über den
  // **ganzen** Grundriss. Beim ersten echten Feldscan (eine Wohnung mit
  // L-Grundriss, 02.10.2026) zog das Satteldach damit über einen Flügel, der
  // gar nicht unter der Schräge liegt, und die Dachflächen kreuzten sich.
  //
  // Der Scan sagt aber, **wo** die Schräge ist — an den Wänden:
  //
  //   · `kneeWall`            Kniestockwand unter der Traufe,
  //   · `profile`             Giebel- oder Innenwand mit Schrägumriss,
  //   · `roof.kneeWallIds`    dieselbe Aussage am Dach (älter als `kneeWall`),
  //   · Wandhöhe > Geschosshöhe   die Wand reicht in den Dachraum.
  //
  // Das letzte Merkmal steht nicht in der Schnittstellenbeschreibung der App;
  // es ist hier dazugekommen, weil der Feldscan es braucht: Ein Raum an der
  // Nordtraufe hat dort eine voll hohe Außenwand ohne Kniestockkennung — aber
  // seine Innenwand ist 2,65 m hoch bei 2,41 m Geschosshöhe. Eine Wand, die
  // über das Geschoss hinausreicht, steht unter dem Dach und nicht unter
  // einer Decke. Es gilt nur, wenn der Scan für das Geschoss überhaupt ein
  // Dach meldet; fünf Zentimeter Spielraum, damit Messrauschen an einer
  // geraden Decke nicht zum Dachbeleg wird.
  //
  // Welche Räume daraus unter das Dach kommen, entscheidet
  // `scanDachZuordnen` nach der Raumerkennung — hier werden nur die Wände
  // gesammelt, in den Kennungen dieses Modells.
  const dachBelege: Record<string, string[]> = {};
  const geschossHoehe = new Map(levels.map((l) => [l.id, l.height]));
  const kniestockAmDach = new Map<string, Set<string>>();
  for (const l of rbmLevels) {
    if (l?.roof && Array.isArray(l.roof.kneeWallIds)) kniestockAmDach.set(l.id, new Set(l.roof.kneeWallIds));
  }
  for (const w of rbmWalls) {
    if (!w || typeof w.id !== 'string' || !daecher[w.levelId]) continue;
    const hoch = geschossHoehe.get(w.levelId) ?? Infinity;
    const beleg =
      w.kneeWall === true ||
      (Array.isArray(w.profile) && w.profile.length > 0) ||
      (kniestockAmDach.get(w.levelId)?.has(w.id) ?? false) ||
      (zahl(w.height) && w.height > hoch + 0.05);
    if (!beleg) continue;
    const teile = wandZuQuelle.get(w.id) ?? [];
    (dachBelege[w.levelId] ??= []).push(...teile.map((t) => t.id));
  }
  for (const [levelId, dach] of Object.entries(daecher)) {
    dach.scan.lageBelegt = (dachBelege[levelId] ?? []).length > 0;
  }
  const wandNettoflaechen: Record<string, number> = {};
  for (const w of rbmWalls) {
    if (w && typeof w.id === 'string' && zahl(w.netArea)) wandNettoflaechen[w.id] = rund(w.netArea, 2);
  }

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
      flaeche: gueltig.map((p) => ({ x: rund(p.x), y: rund(p.y) })),
    });
    benannteRaeume += 1;
  }
  // Beheizung je Scanraum (K2) — alle Räume mit Angabe, nicht nur benannte.
  const raumBeheizung: BuildingImportErgebnis['raumBeheizung'] = [];
  for (const r of Array.isArray(m.rooms) ? m.rooms : []) {
    if (!r || typeof r.heated !== 'boolean' || !levelIds.has(r.levelId) || !Array.isArray(r.polygon)) continue;
    const gueltig = r.polygon.filter(punkt);
    if (gueltig.length < 3) continue;
    const mitte = gueltig.reduce((a, p) => ({ x: a.x + p.x / gueltig.length, y: a.y + p.y / gueltig.length }), { x: 0, y: 0 });
    raumBeheizung.push({
      levelId: r.levelId,
      punkt: { x: rund(mitte.x), y: rund(mitte.y) },
      flaeche: gueltig.map((p) => ({ x: rund(p.x), y: rund(p.y) })),
      heated: r.heated,
    });
  }
  // Volumen je Geschoss aus den Räumen des Scans (Gegenprobe, siehe oben).
  const volumenJe = new Map<string, { volumen: number; volumenGerade?: number; quellen: Set<string> }>();
  for (const r of Array.isArray(m.rooms) ? m.rooms : []) {
    if (!r || !levelIds.has(r.levelId) || !zahl(r.volume)) continue;
    const v = volumenJe.get(r.levelId) ?? { volumen: 0, quellen: new Set<string>() };
    v.volumen += r.volume!;
    if (zahl(r.volumeFlat)) v.volumenGerade = (v.volumenGerade ?? 0) + r.volumeFlat!;
    if (typeof r.volumeSource === 'string') v.quellen.add(r.volumeSource);
    volumenJe.set(r.levelId, v);
  }
  const scanVolumen = [...volumenJe].map(([levelId, v]) => ({
    levelId,
    volumen: rund(v.volumen, 1),
    ...(v.volumenGerade !== undefined ? { volumenGerade: rund(v.volumenGerade, 1) } : {}),
    ...(v.quellen.size === 1 ? { quelle: [...v.quellen][0] } : {}),
  }));

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
    // Die Bauart von RaVia geht der Vermutung der App vor; eine Vermutung
    // zählt erst, wenn der Monteur sie bestätigt hat.
    const panelType =
      typeof e.panelType === 'string' && e.panelType.trim() ? e.panelType.trim()
        : bestaetigt && s?.panelType ? s.panelType : undefined;
    const bauartText =
      e.kind === 'towel' ? 'Badheizkörper'
        : e.kind === 'tube' ? 'Röhren'
          : e.kind === 'panel' && panelType ? panelType : undefined;
    // H1: Leistungsangaben nach Festlegung F2 übernehmen, nicht verwerfen.
    const leistung =
      zahl(e.ratedPower) && e.ratedPower! > 0
        ? { ratedPower: Math.round(e.ratedPower!), ratedPowerSource: leistungsQuelle(e.ratedPowerSource) }
        : {};
    const exponent = zahl(e.exponentN) && e.exponentN! > 0 ? { exponentN: e.exponentN! } : {};
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
        ...leistung,
        ...exponent,
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
  const dachGemessen = Object.values(daecher).filter((d) => d.scan.herkunft === 'gemessen').length;
  if (dachZahl > dachGemessen) {
    geschaetzt.push({
      was: 'Dach', anzahl: dachZahl - dachGemessen,
      begruendung: 'Neigung und Kniestock aus den gescannten Dachschrägen geschätzt. Dachaufbau und Firstlage prüfen.',
    });
  }

  // --- Prüfliste der App ----------------------------------------------------
  //
  // Was die App selbst bemängelt, gehört nicht in eine Meldung, die nach zehn
  // Sekunden verschwindet. Mit Ort wird es eine Hinweisfahne im Grundriss —
  // dort, wo der Monteur hingehen muss —, ohne Ort steht es in der Meldung.
  const schwere = (s: unknown): 'error' | 'warning' | 'info' =>
    s === 'error' ? 'error' : s === 'warning' ? 'warning' : 'info';
  const pruefpunkte: ScanPruefpunkt[] = [];
  const pruefhinweise: BuildingImportErgebnis['pruefhinweise'] = [];
  const ersteEbene = levels[0]?.id;
  for (const c of Array.isArray(m.checklist) ? m.checklist : []) {
    if (!c || typeof c.text !== 'string' || !c.text.trim()) continue;
    const orte = (Array.isArray(c.points) ? c.points : []).filter(punkt);
    // Die Prüfliste nennt kein Geschoss je Punkt. Bei einem Geschoss ist das
    // eindeutig; bei mehreren ordnet die Raumkennung zu, sonst das erste.
    const raumEbene = c.roomIds
      ?.map((id) => (Array.isArray(m.rooms) ? m.rooms : []).find((x) => x?.id === id)?.levelId)
      .find((id): id is string => typeof id === 'string' && levelIds.has(id));
    const ebene = raumEbene ?? ersteEbene;
    if (orte.length && ebene) {
      for (const o of orte) {
        pruefpunkte.push({ levelId: ebene, punkt: { x: rund(o.x), y: rund(o.y) }, text: c.text.trim(), schwere: schwere(c.severity), code: String(c.code ?? '') });
      }
    } else {
      pruefhinweise.push({ text: c.text.trim(), schwere: schwere(c.severity), code: String(c.code ?? '') });
    }
  }

  /*
   * Die Herkunft der Dachmaße steht seit Schema 1.10.0 in `roof.source`. Der
   * Feldscan vom 02.10.2026 hat das Feld nicht — sagt es aber in der
   * Prüfliste: „roof.notAimed" heißt, Kniestock und First sind geschätzt.
   * Das ist dieselbe Aussage an anderer Stelle; sie zu überlesen hieße,
   * „unbekannt" anzuzeigen, wo die App es weiß.
   */
  if ((Array.isArray(m.checklist) ? m.checklist : []).some((c) => c?.code === 'roof.notAimed')) {
    for (const d of Object.values(daecher)) if (d.scan.herkunft === 'unbekannt') d.scan.herkunft = 'geschaetzt';
  }

  // --- Toleranz -------------------------------------------------------------
  //
  // Die Zahl, mit der jede Fläche aus diesem Scan zu lesen ist. „Angenommen"
  // heißt: Die App hat keine nachgemessene Strecke und setzt den üblichen
  // Maßstabsfehler eines LiDAR-Scans an; „gemessen" heißt, ein Kontrollmaß
  // hat ihn bestimmt. Der Unterschied gehört in die Meldung, weil 3 % auf
  // 120 m² fast vier Quadratmeter sind — ein ganzes Bad.
  const acc = m.accuracy;
  const gemessen = !!acc && (acc.basis === 'measured' || acc.scaleChecked === true);
  const toleranz =
    acc && zahl(acc.roomAreaUncertaintyPct)
      ? `± ${acc.roomAreaUncertaintyPct.toFixed(1).replace('.', ',')} % ` +
        (gemessen ? '(gemessen)' : '(angenommen, kein Kontrollmaß)')
      : undefined;
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
    (benannteRaeume ? `, ${benannteRaeume} ${benannteRaeume === 1 ? 'Raumname' : 'Raumnamen'} vom Monteur` : '') +
    (fixtures.length ? `, ${fixtures.length} Heizkörper` + (unbestaetigt ? ` (${unbestaetigt} Bauart offen)` : '') : '') +
    (stoesse ? `, ${stoesse} T-Stöße hergestellt` : '') +
    (dachZahl ? `, Dach aus dem Scan übernommen` : '') +
    (toleranz ? ` · Toleranz ${toleranz}` : '') +
    (pruefpunkte.length ? ` · ${pruefpunkte.length} ${pruefpunkte.length === 1 ? 'Prüfpunkt' : 'Prüfpunkte'} der App im Plan markiert` : '') +
    (aussenZahl ? '' : ' · keine Außenwand im Scan');

  return {
    ok: true,
    message,
    projektName: m.project?.name?.trim() || undefined,
    adresse: m.project?.address?.trim() || undefined,
    /*
     * Die Lage steht seit Schema 1.10.0 unter `project.location`, davor auf
     * oberster Ebene. Bis 1.69.0 wurde nur die alte Stelle gelesen — beim
     * Feldscan vom 02.10.2026 ging die Lage damit still verloren.
     */
    koordinaten: (() => {
      const ort = zahl(m.project?.location?.latitude) && zahl(m.project?.location?.longitude) ? m.project!.location! : m.location;
      return ort && zahl(ort.latitude) && zahl(ort.longitude) ? { breite: ort.latitude, laenge: ort.longitude } : undefined;
    })(),
    drehung: 0,
    nordrichtung: hatNorden ? (o!.northPlanAngleDeg! * Math.PI) / 180 : undefined,
    nordGenauigkeitGrad: hatNorden && zahl(o!.northAccuracyDeg) ? rund(o!.northAccuracyDeg!, 1) : undefined,
    levels,
    nodes: knotenRein,
    walls,
    openings,
    raumHinweise,
    raumBeheizung,
    geschaetzt,
    skipped: [...uebersprungen].map(([reason, count]) => ({ reason, count })),
    fixtures,
    daecher,
    quelle: [app?.name, app?.version, m.source?.device?.model].filter(Boolean).join(' · ') || undefined,
    heizkoerperUnbestaetigt: unbestaetigt,
    dachBelege,
    pruefpunkte,
    pruefhinweise,
    ...(toleranz ? { toleranz } : {}),
    wandNettoflaechen,
    scanVolumen,
  };
}
