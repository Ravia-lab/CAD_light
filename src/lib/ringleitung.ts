/**
 * Die Ringleitung — Vor- und Rücklauf einmal ums Haus, die Heizkörper hängen daran.
 * ---------------------------------------------------------------------------
 * **Was gewünscht war.** Aus einem echten Sanierungsfall, in den Worten des
 * Installateurs: „zum Verteiler hin (oder Speicher, Puffer) 1", dann von dort
 * 22er oder 18er Rohr Kreisleitung, für Heizkörper mit 15." Das ist die
 * übliche Verlegung im Bestand: Die Leitung läuft im Sockelleistenkanal an
 * den Außenwänden entlang einmal um das Geschoss, durch jede Trennwand mit
 * einer Kernbohrung, und jeder Heizkörper — fast immer unter einem Fenster,
 * also an einer Außenwand — hängt mit einer kurzen Anbindung daran.
 *
 * Die Baumtrassierung (`pipeRouting.ts`) sucht dagegen für jeden Heizkörper
 * den kürzesten Weg und lässt die Wege zusammenwachsen. Das ist im Neubau
 * richtig, wo die Leitung im Fußbodenaufbau quer durch den Raum darf. Im
 * Bestand erzeugt es ein Netz, das niemand so verlegt: Stränge quer durch
 * Türen, Stichleitungen durch halbe Wohnungen, jede anders.
 *
 * **Wie der Ring entsteht.**
 *
 *  1. Der Gebäudeumriss des Geschosses (`gebaeudeUmriss`, derselbe wie für das
 *     Dach), je Kante um die halbe Stärke *ihrer* Wand plus Wandabstand nach
 *     innen versetzt. Das ist die Linie, auf der die Leitung liegt.
 *  2. Der Ring beginnt am Punkt, der der Quelle (Erzeuger, Speicher,
 *     Hauseinführung) am nächsten liegt.
 *  3. Jeder Verbraucher hängt am nächsten Ringpunkt **in seinem eigenen Raum**.
 *     Nur wo sein Raum keine Außenwand hat, darf es ein Ringpunkt anderswo
 *     sein — dann wird die Anbindung trassiert und nicht gerade gezogen.
 *  4. Der Ring läuft **in eine Richtung** und endet am letzten Verbraucher.
 *     Welche Richtung, entscheidet die größere Lücke neben dem Anfang: Sie
 *     bleibt unverlegt. So ist der Ring so kurz, wie er bei einem Anfang an
 *     dieser Stelle sein kann.
 *  5. Jeder Ringabschnitt trägt alle Verbraucher, die **hinter** ihm hängen.
 *     Daraus folgt der Volumenstrom und die Dimension — der Ring wird zum
 *     Ende hin enger, so wie der Installateur von 22 auf 18 wechselt.
 *
 * **Was der Ring nicht entscheidet — und meldet.**
 *  - Eine **Tür in der Außenwand** (Haustür, Terrassentür) kann der
 *    Sockelleistenkanal nicht durchlaufen. Ob die Leitung über die Tür, im
 *    Boden oder außen herum geht, hängt an Zarge, Bodenaufbau und Optik; eine
 *    Fachregel dazu gibt es nicht. Jede solche Stelle wird genannt.
 *  - Jede **Trennwand**, durch die der Ring geht, ist eine Kernbohrung. Sie
 *    werden gezählt.
 */

import type { BimNode, Opening, Room, Vec2, Wall } from '../types/bim';
import { gebaeudeUmriss } from './roomDetection';
import { closestPointOnSegment, offsetPolygonPerEdge, pointInPolygon, segmentIntersection } from './geometry';
import { getWallGeometry } from './wallGeometry';
import { planeStich } from './ringStich';

/**
 * Abstand Rohrmitte zur Wandfläche [m].
 *
 * Dieselbe Setzung wie in der Feinjustierung der Baumtrassierung: der halbe
 * Sockelleistenkanal. Ein Produktmaß, keine Norm — siehe `pipeRouting.ts`.
 */
export const WANDABSTAND = 0.05;
/**
 * Bis zu dieser Entfernung wird ein Verbraucher gerade an den Ring angebunden
 * [m]. Weiter weg liegt er nicht an der Außenwand, und die Anbindung wird
 * trassiert.
 */
export const GERADE_ANBINDUNG = 0.8;
/** Eine Öffnung mit Brüstung darunter unterbricht den Kanal nicht [m]. */
export const TUER_BRUESTUNG = 0.3;

export interface RingVerbraucher {
  id: string;
  position: Vec2;
  roomId?: string;
}

export interface RingAnschluss {
  id: string;
  /** Der Punkt auf dem Ring, an dem die Anbindung abgeht. */
  punkt: Vec2;
  /** Weg vom Ringanfang bis hierher, in Laufrichtung [m]. */
  weg: number;
  /** Gerade Anbindung möglich — sonst muss sie trassiert werden. */
  gerade: boolean;
  /** Länge der geraden Anbindung [m]. */
  abstand: number;
  /**
   * Stichleitung vom Ring zum Heizkörper, wenn er nicht an der Außenwand
   * hängt (Flur, Trennwand): Eckpunkte vom Heizkörper zum Ring, an den
   * Innenwänden entlang, mit Kernbohrung statt Türumweg. Siehe `ringStich`.
   */
  stich?: Vec2[];
  /** Durchbohrte Trennwände auf dem Stich. */
  stichKernbohrungen?: number;
}

export interface RingAbschnitt {
  from: Vec2;
  to: Vec2;
  /** Alle Verbraucher, die hinter diesem Abschnitt hängen. */
  targets: string[];
}

export interface RingPlan {
  /** Der geschlossene Umlauf, auf dem die Leitung liegt (gegen den Uhrzeigersinn). */
  umlauf: Vec2[];
  /** Anfang des Rings — der Ringpunkt neben der Quelle. */
  anfang: Vec2;
  /** +1: gegen den Uhrzeigersinn, −1: im Uhrzeigersinn. */
  richtung: 1 | -1;
  /** Verlegte Ringlänge vom Anfang bis zum letzten Verbraucher [m]. */
  laenge: number;
  anschluesse: RingAnschluss[];
  /** Der verlegte Ring in geraden Stücken, jedes mit seinen Verbrauchern. */
  abschnitte: RingAbschnitt[];
  /** Türen in Außenwänden, über die der Ring läuft. */
  tueren: { openingId: string; punkt: Vec2; breite: number }[];
  /** Zahl der Trennwände, durch die der Ring geht — je eine Kernbohrung. */
  kernbohrungen: number;
}

export type RingErgebnis = { ok: true; plan: RingPlan } | { ok: false; grund: string };

/** Ein geschlossener Umlauf mit Bogenlänge je Eckpunkt. */
interface Umlauf {
  punkte: Vec2[];
  /** kum[i] = Bogenlänge vom Punkt 0 bis Punkt i. kum[n] = Umfang. */
  kum: number[];
  umfang: number;
}

function baueUmlauf(punkte: Vec2[]): Umlauf {
  const kum = [0];
  for (let i = 0; i < punkte.length; i++) {
    const a = punkte[i];
    const b = punkte[(i + 1) % punkte.length];
    kum.push(kum[i] + Math.hypot(b.x - a.x, b.y - a.y));
  }
  return { punkte, kum, umfang: kum[punkte.length] };
}

/** Punkt auf dem Umlauf bei Bogenlänge s (s wird auf [0, Umfang) gefaltet). */
function punktBei(u: Umlauf, s: number): Vec2 {
  const t = ((s % u.umfang) + u.umfang) % u.umfang;
  for (let i = 0; i < u.punkte.length; i++) {
    if (t <= u.kum[i + 1] + 1e-12) {
      const a = u.punkte[i];
      const b = u.punkte[(i + 1) % u.punkte.length];
      const l = u.kum[i + 1] - u.kum[i];
      const f = l > 0 ? (t - u.kum[i]) / l : 0;
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    }
  }
  return { ...u.punkte[0] };
}

/** Nächster Punkt auf dem Umlauf — nur über die Kanten, die `zulassen` erlaubt. */
function naechster(
  u: Umlauf,
  q: Vec2,
  zulassen: (a: Vec2, b: Vec2) => boolean = () => true,
): { punkt: Vec2; s: number; abstand: number } | undefined {
  let beste: { punkt: Vec2; s: number; abstand: number } | undefined;
  for (let i = 0; i < u.punkte.length; i++) {
    const a = u.punkte[i];
    const b = u.punkte[(i + 1) % u.punkte.length];
    if (!zulassen(a, b)) continue;
    const p = closestPointOnSegment(q, a, b);
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (!beste || d < beste.abstand - 1e-9) {
      beste = { punkt: p, s: u.kum[i] + Math.hypot(p.x - a.x, p.y - a.y), abstand: d };
    }
  }
  return beste;
}

/**
 * Die Stücke der Strecke a→b, die innerhalb des Polygons liegen — als
 * Parameterbereiche [t0, t1] auf der Strecke.
 *
 * Eine Ringkante läuft oft durch mehrere Räume (sie folgt einer Außenwand,
 * an der drei Zimmer liegen). Für den Anschluss eines Heizkörpers zählt nur
 * das Stück in *seinem* Raum — sonst hinge der Heizkörper im Bad am Ring im
 * Flur, durch die Wand hindurch.
 */
function stueckeImPolygon(a: Vec2, b: Vec2, poly: readonly Vec2[]): Array<[number, number]> {
  const ts = [0, 1];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const x = segmentIntersection(a, b, p, q, true);
    if (!x) continue;
    const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
    if (l2 <= 0) continue;
    ts.push(((x.x - a.x) * (b.x - a.x) + (x.y - a.y) * (b.y - a.y)) / l2);
  }
  ts.sort((x, y) => x - y);
  const stuecke: Array<[number, number]> = [];
  for (let i = 0; i + 1 < ts.length; i++) {
    const t0 = Math.max(0, ts[i]);
    const t1 = Math.min(1, ts[i + 1]);
    if (t1 - t0 < 1e-9) continue;
    const m = (t0 + t1) / 2;
    if (pointInPolygon({ x: a.x + (b.x - a.x) * m, y: a.y + (b.y - a.y) * m }, poly)) stuecke.push([t0, t1]);
  }
  return stuecke;
}

/** Nächster Ringpunkt, der im gegebenen Raum liegt. */
function naechsterImRaum(
  u: Umlauf,
  q: Vec2,
  poly: readonly Vec2[],
): { punkt: Vec2; s: number; abstand: number } | undefined {
  let beste: { punkt: Vec2; s: number; abstand: number } | undefined;
  for (let i = 0; i < u.punkte.length; i++) {
    const a = u.punkte[i];
    const b = u.punkte[(i + 1) % u.punkte.length];
    const l = u.kum[i + 1] - u.kum[i];
    for (const [t0, t1] of stueckeImPolygon(a, b, poly)) {
      const p0 = { x: a.x + (b.x - a.x) * t0, y: a.y + (b.y - a.y) * t0 };
      const p1 = { x: a.x + (b.x - a.x) * t1, y: a.y + (b.y - a.y) * t1 };
      const p = closestPointOnSegment(q, p0, p1);
      const d = Math.hypot(p.x - q.x, p.y - q.y);
      if (!beste || d < beste.abstand - 1e-9) {
        const t = l > 0 ? Math.hypot(p.x - a.x, p.y - a.y) / l : 0;
        beste = { punkt: p, s: u.kum[i] + t * l, abstand: d };
      }
    }
  }
  return beste;
}

/**
 * Den Ring um ein Geschoss planen.
 *
 * Reine Geometrie: Volumenströme, Dimensionen und Dämmung macht der
 * Rohrausleger. Hier steht nur, wo die Leitung liegt und was an welchem
 * Abschnitt hängt.
 */
export function planeRing(eingabe: {
  walls: readonly Wall[];
  nodes: Record<string, BimNode>;
  openings: readonly Opening[];
  rooms: readonly Room[];
  quelle: Vec2;
  verbraucher: readonly RingVerbraucher[];
}): RingErgebnis {
  const { walls, nodes, openings, rooms, quelle, verbraucher } = eingabe;
  if (!verbraucher.length) return { ok: false, grund: 'Keine Verbraucher, die an einen Ring gehängt werden könnten.' };

  const umriss = gebaeudeUmriss([...walls], nodes);
  if (umriss.length < 3) {
    return {
      ok: false,
      grund: 'Das Geschoss hat keinen geschlossenen Umriss — ohne ihn gibt es keine Linie, an der der Ring entlanglaufen kann. Offene Wandenden schließen, dann geht es.',
    };
  }

  // Versatz je Umrisskante: halbe Stärke der Wand, auf der sie liegt, plus
  // Wandabstand. Gemischte Wandstärken ergeben so eine Linie, die überall
  // gleich weit vor der Wandfläche liegt.
  const versatz = umriss.map((a, i) => {
    const b = umriss[(i + 1) % umriss.length];
    const mitte = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    let halb = 0.18;
    for (const w of walls) {
      const g = getWallGeometry(w, nodes);
      if (!g) continue;
      const p = closestPointOnSegment(mitte, g.a, g.b);
      if (Math.hypot(p.x - mitte.x, p.y - mitte.y) < 0.02) {
        halb = g.halfThickness;
        break;
      }
    }
    return halb + WANDABSTAND;
  });
  const u = baueUmlauf(offsetPolygonPerEdge(umriss, versatz));
  if (u.umfang <= 0) return { ok: false, grund: 'Der Umriss ist entartet.' };

  const start = naechster(u, quelle);
  if (!start) return { ok: false, grund: 'Kein Ringpunkt neben der Quelle.' };

  // --- Anschlusspunkte ------------------------------------------------------
  const raumVon = new Map(rooms.map((r) => [r.id, r]));
  const basis = verbraucher.map((v) => {
    const raum = v.roomId ? raumVon.get(v.roomId) : undefined;
    const imRaum = raum && raum.innerPolygon.length >= 3 ? naechsterImRaum(u, v.position, raum.innerPolygon) : undefined;
    const ziel = imRaum ?? naechster(u, v.position)!;
    return { v, ziel, gerade: !!imRaum && ziel.abstand <= GERADE_ANBINDUNG };
  });

  /*
   * Welches Ringstück ohnehin liegt, bestimmen die Heizkörper an den
   * Außenwänden. Ein Stich, der an ein Stück dahinter ginge, müsste den Ring
   * dorthin verlängern — diese Verlängerung zählt beim Suchen des Stichs mit.
   */
  const geradeVorwaerts = basis
    .filter((b) => b.gerade)
    .map((b) => (((b.ziel.s - start.s) % u.umfang) + u.umfang) % u.umfang);
  const verlaengerung = (() => {
    if (!geradeVorwaerts.length) return undefined;
    const letzterG = Math.max(...geradeVorwaerts);
    const ersterG = Math.min(...geradeVorwaerts.map((d) => (d < 1e-6 ? u.umfang : d)));
    const ccw = u.umfang - letzterG >= (ersterG >= u.umfang ? 0 : ersterG);
    const reicht = ccw ? letzterG : ersterG >= u.umfang ? 0 : u.umfang - ersterG;
    return (p: Vec2) => {
      const am = naechster(u, p);
      if (!am) return 0;
      const vor = (((am.s - start.s) % u.umfang) + u.umfang) % u.umfang;
      const d = ccw ? vor : (u.umfang - vor) % u.umfang;
      return Math.max(0, d - reicht);
    };
  })();

  const roh = basis.map(({ v, ziel, gerade }) => {
    if (!gerade) {
      /*
       * Nicht an der Außenwand: Stich von der kürzesten Stelle des Rings,
       * gesucht über die verlegbaren Wege (an den Wänden, durch Trennwände),
       * nicht über die Luftlinie. Der Anschlusspunkt ist das Ende des Stichs.
       */
      const stich = planeStich({ walls, nodes, openings, umriss, ring: u.punkte, von: v.position, zielKosten: verlaengerung });
      const am = stich ? naechster(u, stich.ende) : undefined;
      if (stich && am) {
        return {
          id: v.id, punkt: stich.ende, s: am.s, abstand: stich.laenge, gerade: false,
          stich: stich.punkte, stichKernbohrungen: stich.kernbohrungen,
        };
      }
    }
    return {
      id: v.id,
      punkt: ziel.punkt,
      s: ziel.s,
      abstand: ziel.abstand,
      gerade,
    };
  });

  // --- Laufrichtung ---------------------------------------------------------
  // Gegen den Uhrzeigersinn gemessen: wie weit liegt jeder Anschluss hinter
  // dem Anfang? Die unverlegte Lücke ist beim Lauf gegen den Uhrzeigersinn
  // das Stück hinter dem letzten Anschluss, beim Lauf im Uhrzeigersinn das
  // vor dem ersten. Die größere bleibt frei.
  const vorwaerts = roh.map((r) => (((r.s - start.s) % u.umfang) + u.umfang) % u.umfang);
  const letzter = Math.max(...vorwaerts);
  const ersterPositiv = Math.min(...vorwaerts.map((d) => (d < 1e-6 ? u.umfang : d)));
  const lueckeCcw = u.umfang - letzter;
  const lueckeCw = ersterPositiv >= u.umfang ? 0 : ersterPositiv;
  const richtung: 1 | -1 = lueckeCcw >= lueckeCw ? 1 : -1;
  const weg = (s: number): number => {
    const d = (((s - start.s) * richtung) % u.umfang + u.umfang) % u.umfang;
    return d < 1e-6 ? 0 : d;
  };

  const anschluesse: RingAnschluss[] = roh
    .map((r) => ({
      id: r.id, punkt: r.punkt, weg: weg(r.s), gerade: r.gerade, abstand: r.abstand,
      ...('stich' in r && r.stich ? { stich: r.stich, stichKernbohrungen: r.stichKernbohrungen } : {}),
    }))
    .sort((a, b) => a.weg - b.weg);
  const laenge = anschluesse[anschluesse.length - 1].weg;

  // --- Abschnitte -----------------------------------------------------------
  // Bruchstellen: jede Ecke des Umlaufs und jeder Anschluss, beide als Weg
  // vom Anfang. Zwischen zwei Bruchstellen liegt ein gerades Stück, und alle
  // Anschlüsse dahinter hängen daran.
  const ecken = u.punkte.map((_, i) => weg(u.kum[i]));
  const brueche = [...new Set([0, laenge, ...ecken.filter((e) => e > 1e-6 && e < laenge), ...anschluesse.map((a) => a.weg)])]
    .map((b) => Math.round(b * 1e6) / 1e6)
    .sort((a, b) => a - b)
    .filter((b, i, arr) => i === 0 || b - arr[i - 1] > 1e-6);
  const abschnitte: RingAbschnitt[] = [];
  for (let i = 0; i + 1 < brueche.length; i++) {
    const w0 = brueche[i];
    const w1 = brueche[i + 1];
    const targets = anschluesse.filter((a) => a.weg >= w1 - 1e-6).map((a) => a.id);
    if (!targets.length) continue;
    abschnitte.push({
      from: punktBei(u, start.s + richtung * w0),
      to: punktBei(u, start.s + richtung * w1),
      targets,
    });
  }

  // --- Türen und Kernbohrungen ----------------------------------------------
  const wallById = new Map(walls.map((w) => [w.id, w]));
  const tueren: RingPlan['tueren'] = [];
  for (const o of openings) {
    const wand = wallById.get(o.wallId);
    if (!wand || wand.type !== 'exterior' || o.sillHeight >= TUER_BRUESTUNG) continue;
    const g = getWallGeometry(wand, nodes);
    if (!g) continue;
    const mitte = { x: g.a.x + g.dir.x * o.distance, y: g.a.y + g.dir.y * o.distance };
    const n = naechster(u, mitte);
    if (!n || n.abstand > g.halfThickness + WANDABSTAND + 0.05) continue;
    const w = weg(n.s);
    if (w > 1e-6 && w < laenge - 1e-6) tueren.push({ openingId: o.id, punkt: n.punkt, breite: o.width });
  }
  let kernbohrungen = 0;
  for (const wand of walls) {
    if (wand.type === 'exterior') continue;
    const g = getWallGeometry(wand, nodes);
    if (!g) continue;
    if (abschnitte.some((a) => segmentIntersection(a.from, a.to, g.a, g.b, true))) kernbohrungen += 1;
  }

  return {
    ok: true,
    plan: { umlauf: u.punkte, anfang: start.punkt, richtung, laenge, anschluesse, abschnitte, tueren, kernbohrungen },
  };
}
