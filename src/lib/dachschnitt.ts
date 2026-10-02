/**
 * Polygonschnitt unter der Dachfläche — Wandoberseiten und Dachhaut.
 * ---------------------------------------------------------------------------
 *
 * **Der Befund (Feldscan 02.10.2026, Auftrag A2).** In der 3D-Ansicht hatten
 * die Wände unter dem Dach Treppenstufen, und Wände stachen durch die
 * Dachhaut. Zwei Ursachen, beide aus derselben Wurzel:
 *
 *  1. Jede Wand unter dem Dach wurde in 8-cm-Scheiben zerlegt, jede Scheibe
 *     bekam die Dachhöhe ihrer Mitte **auf der Wandachse**. Auf der
 *     Traufseite liegt die Dachfläche an der Wandfläche aber um
 *     ½ · Wandstärke · tan(Neigung) tiefer — bei 36,5 cm und 36° 13 cm.
 *  2. Die Dachhaut war ein Raster aus 12-cm-Zellen. Eine Zelle über dem
 *     First verbindet ihre Ecken gerade und liegt dort bis zu
 *     ½ · 12 cm · tan(Neigung) unter der Dachfläche; eine exakt geschnittene
 *     Wand stäche dort trotzdem durch.
 *
 * **Der Grundgedanke.** Die Dachfläche ist zwischen bekannten **Knickgeraden**
 * eben: First, Kehlbalken- und Kniestockkante, Mansardknick, Grat und Walmfuß
 * beim Krüppelwalm, und — wo das Dach seine Traufe gegen einen Umriss rechnet
 * — die Umrisskanten und die Fallinien durch die Umrissecken. Ein Polygon,
 * das an all diesen Geraden zerschnitten wird, zerfällt in Stücke, auf denen
 * die Höhe eine **Ebene** ist. Auf jedem Stück ist dann jede Höhe exakt; es
 * wird nichts abgetastet.
 *
 * Dieselbe Zerlegung liefert die **Oberseite einer Wand** (ihr Fußabdruck
 * zerschnitten) und die **Dachhaut** (der Umriss mit Überstand zerschnitten).
 * Weil beide aus denselben Ebenen stammen, können sie sich nicht
 * widersprechen.
 *
 * **Wo die Geraden nicht bekannt sind** — beim Walmdach über einem
 * beliebigen Umriss (dessen Grate sind das Straight Skeleton, das hier nicht
 * gebaut wird) und über einer Gaube (dort ist die Höhe das Größere aus Dach
 * und Gaubendecke) —, wird ein Stück, das sich als nicht eben erweist,
 * halbiert, bis es eben ist oder unter 1 mm Abweichung liegt. Das ist die
 * einzige Stelle mit einer Teilung ohne Gerade, und sie ist benannt.
 *
 * Schichtgrenze: nur `types` und andere `lib`-Bausteine.
 */

import type { Vec2 } from '../types/bim';
import type { WallGeometry } from './wallGeometry';
import { wallLocalToWorld } from './wallGeometry';
import { mansardKnick, type RoofFrame } from './roofGeometry';
import { offsetPolygonPerEdge, pointInPolygon } from './geometry';

/** Eine Gerade im Grundriss: n · p = c, mit |n| = 1. */
export interface Gerade {
  nx: number;
  ny: number;
  c: number;
}

/** Ein Punkt im Raum: Grundriss x, y und Höhe z [m]. */
export interface Punkt3 {
  x: number;
  y: number;
  z: number;
}

/** Eine Ebene über dem Grundriss: z = a·x + b·y + c. */
export interface Ebene {
  a: number;
  b: number;
  c: number;
}

/** Ein ebenes Stück: konvexes Polygon im Grundriss mit seiner Höhenebene. */
export interface EbenesStueck {
  ecken: Vec2[];
  ebene: Ebene;
  /** Nur aus der Halbierung ohne bekannte Gerade — Abweichung unter 1 mm. */
  naeherung?: boolean;
  /** Beim Kappen am Wandfuß entstanden: dort liegt das Dach unter dem Fuß. */
  unterFuss?: boolean;
}

const hoeheAuf = (e: Ebene, p: Vec2): number => e.a * p.x + e.b * p.y + e.c;

const gerade = (nx: number, ny: number, c: number): Gerade => {
  const l = Math.hypot(nx, ny);
  return { nx: nx / l, ny: ny / l, c: c / l };
};

// ---------------------------------------------------------------------------
// Die Knickgeraden eines Dachgerüsts
// ---------------------------------------------------------------------------

/**
 * Alle Geraden, an denen die Dachfläche dieses Gerüsts knicken oder springen
 * **kann**. Eine Gerade zu viel kostet ein Stück mehr; eine zu wenig kostet
 * Genauigkeit — die Liste ist deshalb großzügig.
 *
 * Im Gerüst ist t der Abstand in Fallrichtung (`dir`) und s der in
 * Firstrichtung (`along`), beide ab `centre`. Eine Gerade „t = T" ist im
 * Grundriss `dir · p = T + dir · centre`.
 */
export function knickgeraden(frame: RoofFrame): Gerade[] {
  const { dir, along, centre, ridgeT, ridgeHeight, slope, roof } = frame;
  const dc = dir.x * centre.x + dir.y * centre.y;
  const ac = along.x * centre.x + along.y * centre.y;
  const tGerade = (T: number) => gerade(dir.x, dir.y, T + dc);
  const sGerade = (S: number) => gerade(along.x, along.y, S + ac);
  const aus: Gerade[] = [];
  const knee = Math.max(0, roof.kneeHeight);
  const steigt = slope > 1e-9;

  // First
  aus.push(tGerade(ridgeT));
  // Kniestock (unten gekappt) und Kehlbalkenlage (oben gekappt), beidseits.
  if (steigt) {
    for (const h of [knee, roof.collarHeight]) {
      if (typeof h !== 'number' || !(h > 0)) continue;
      const d = (ridgeHeight - h) / slope;
      aus.push(tGerade(ridgeT + d), tGerade(ridgeT - d));
    }
  }
  if (roof.kind === 'mansard' && steigt) {
    const k = mansardKnick(roof, frame.halfSpanT + Math.abs(ridgeT), roof.kneeHeight, slope);
    const dKnee = k.abstand + (k.hoehe - knee) / slope;
    aus.push(tGerade(ridgeT + k.abstand), tGerade(ridgeT - k.abstand), tGerade(ridgeT + dKnee), tGerade(ridgeT - dKnee));
    if (typeof roof.collarHeight === 'number' && roof.collarHeight > 0 && k.slopeOben > 1e-9) {
      const d = (ridgeHeight - roof.collarHeight) / k.slopeOben;
      aus.push(tGerade(ridgeT + d), tGerade(ridgeT - d));
    }
  }
  // Krüppelwalm und Walm ohne Umriss: Mittellinie, Walmfuß und die Grate.
  if (roof.kind === 'krueppelwalm' || (roof.kind === 'hip' && frame.kanten.length < 3)) {
    aus.push(sGerade(0), sGerade(frame.halfSpanS), sGerade(-frame.halfSpanS));
    aus.push(tGerade(ridgeT + frame.halfSpanT), tGerade(ridgeT - frame.halfSpanT));
    let K: number;
    if (roof.kind === 'krueppelwalm') {
      const anteil = Math.min(Math.max(roof.hipRatio ?? 0.5, 0), 1);
      const walmfuss = ridgeHeight - anteil * (ridgeHeight - knee);
      K = steigt ? (ridgeHeight - walmfuss) / slope - frame.halfSpanS : 0;
    } else {
      K = frame.halfSpanT - frame.halfSpanS;
    }
    // Jenseits des Walmfußes (|s| > halbe Firstlänge) ist die Walmschräge
    // auf den Walmfuß gekappt; dort trifft sie die Giebelschräge längs
    // |t − ridgeT| = K + halbe Firstlänge — quer gesehen eine t-Gerade.
    if (steigt) aus.push(tGerade(ridgeT + K + frame.halfSpanS), tGerade(ridgeT - K - frame.halfSpanS));
    // ±(t − ridgeT) ± s = K  →  vier Geraden
    for (const st of [1, -1]) {
      for (const ss of [1, -1]) {
        aus.push(gerade(st * dir.x + ss * along.x, st * dir.y + ss * along.y, K + st * (ridgeT + dc) + ss * ac));
      }
    }
  }
  // Traufe gegen den Umriss: Umrisskanten und Fallinien durch die Ecken.
  const umriss = frame.umriss;
  if (umriss.length >= 3) {
    for (let i = 0; i < umriss.length; i++) {
      const v = umriss[i];
      const w = umriss[(i + 1) % umriss.length];
      // Fallinie durch v: along · p = along · v
      aus.push(gerade(along.x, along.y, along.x * v.x + along.y * v.y));
      // Die Kante selbst
      const ex = w.x - v.x;
      const ey = w.y - v.y;
      if (Math.hypot(ex, ey) > 1e-9) aus.push(gerade(-ey, ex, -ey * v.x + ex * v.y));
    }
  }
  /*
   * Wo die Traufe gegen eine **schräge** Kante gerechnet wird, ist ihre
   * Fläche eine eigene Ebene, und sie trifft die Dachschräge (und die
   * Kehlbalkenlage) auf einer Geraden, die keine der obigen ist. Bei einer
   * Traufkante quer zur Fallrichtung fallen beide zusammen — dann ist die
   * Differenz konstant und es entsteht keine Gerade. Seit 1.70.0 nötig,
   * weil der Boden eines Schlitzes an seiner Mündung gerechnet wird, und
   * die liegt schräg (`roofGeometry.ts`, `umrissKanten`).
   */
  if (steigt && frame.kanten.length >= 3 && roof.kind !== 'hip' && roof.kind !== 'mansard') {
    const seiten = roof.kind === 'monopitch' || roof.kind === 'flat-sloped' ? [1] : [1, -1];
    for (const k of frame.kanten) {
      const e = k.muendung ?? k;
      // Die Mündung selbst: dort endet die Traufe wie an einer Umrisskante.
      if (k.muendung) aus.push(gerade(-e.dy, e.dx, -e.dy * e.ax + e.dx * e.ay));
      for (const seite of seiten) {
        const fx = dir.x * seite;
        const fy = dir.y * seite;
        const nenner = fx * e.dy - fy * e.dx;
        if (Math.abs(nenner) < 1e-12) continue;
        // Traufhöhe: knee + slope · u(p), u(p) = ((a − p) × d) / (f × d)
        const traufe = (x: number, y: number) => knee + (slope * ((e.ax - x) * e.dy - (e.ay - y) * e.dx)) / nenner;
        const schraege = (x: number, y: number) => ridgeHeight - seite * (dir.x * x + dir.y * y - dc - ridgeT) * slope;
        const ziele: ((x: number, y: number) => number)[] = [schraege];
        const kehl = roof.collarHeight;
        if (typeof kehl === 'number' && kehl > 0) ziele.push(() => kehl);
        for (const ziel of ziele) {
          const g = (x: number, y: number) => traufe(x, y) - ziel(x, y);
          const g0 = g(0, 0);
          const gx = g(1, 0) - g0;
          const gy = g(0, 1) - g0;
          if (Math.hypot(gx, gy) < 1e-9) continue;
          aus.push(gerade(gx, gy, -g0));
        }
      }
    }
  }
  // Walmdach über einem Umriss: Grate und Kehlen liegen dort, wo zwei
  // Umrisskanten gleich weit weg sind — auf den Winkelhalbierenden ihrer
  // Geraden. Bei konvexem Umriss ist die Fläche damit vollständig an
  // Geraden zerlegt. Am einspringenden Winkel eines L rechnet die
  // Dachfunktion mit dem Abstand zur **Ecke**; dort ist die Fläche ein Kegel
  // und wird durch Halbieren angenähert (`naeherung`).
  if (roof.kind === 'hip' && umriss.length >= 3) {
    const kg = umriss.map((v, i) => {
      const w = umriss[(i + 1) % umriss.length];
      const ex = w.x - v.x;
      const ey = w.y - v.y;
      const l = Math.hypot(ex, ey) || 1;
      return { nx: -ey / l, ny: ex / l, c: (-ey * v.x + ex * v.y) / l };
    });
    for (let i = 0; i < kg.length; i++) {
      for (let j = i + 1; j < kg.length; j++) {
        const a = kg[i];
        const b = kg[j];
        // Punkte gleichen Abstands zu beiden Geraden: (a − b) und (a + b).
        for (const v of [-1, 1]) {
          const nx = a.nx + v * b.nx;
          const ny = a.ny + v * b.ny;
          if (Math.hypot(nx, ny) > 1e-9) aus.push(gerade(nx, ny, a.c + v * b.c));
        }
      }
    }
  }
  // Gauben: Grundfläche und Mittellinie.
  for (const o of frame.openings) {
    if (o.kind === 'skylight') continue;
    const pd = dir.x * o.position.x + dir.y * o.position.y;
    const pa = along.x * o.position.x + along.y * o.position.y;
    aus.push(
      gerade(dir.x, dir.y, pd + o.depth / 2),
      gerade(dir.x, dir.y, pd - o.depth / 2),
      gerade(along.x, along.y, pa + o.width / 2),
      gerade(along.x, along.y, pa - o.width / 2),
      gerade(along.x, along.y, pa),
    );
  }
  return aus;
}

// ---------------------------------------------------------------------------
// Zerschneiden
// ---------------------------------------------------------------------------

const flaeche = (poly: readonly Vec2[]): number => {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
};

/** Ein konvexes Polygon an einer Geraden teilen — beide Teile, sofern vorhanden. */
function teileAn(poly: Vec2[], g: Gerade): Vec2[][] {
  const d = poly.map((p) => g.nx * p.x + g.ny * p.y - g.c);
  const EPS = 1e-9;
  if (d.every((x) => x >= -EPS) || d.every((x) => x <= EPS)) return [poly];
  const plus: Vec2[] = [];
  const minus: Vec2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const dp = d[i];
    const dq = d[(i + 1) % poly.length];
    if (dp >= -EPS) plus.push(p);
    if (dp <= EPS) minus.push(p);
    if ((dp > EPS && dq < -EPS) || (dp < -EPS && dq > EPS)) {
      const t = dp / (dp - dq);
      // Ein Schnittpunkt, **einmal** gerechnet und beiden Teilen gegeben —
      // so liegen die gemeinsamen Kanten zeichengleich aufeinander.
      const s = { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
      plus.push(s);
      minus.push(s);
    }
  }
  return [plus, minus].filter((x) => x.length >= 3 && Math.abs(flaeche(x)) > 1e-12);
}

/** Ein konvexes Polygon an allen Geraden zerschneiden. */
export function zerteile(poly: Vec2[], geraden: readonly Gerade[]): Vec2[][] {
  let stuecke = [poly];
  for (const g of geraden) stuecke = stuecke.flatMap((s) => teileAn(s, g));
  return stuecke;
}

/**
 * Die Ebene eines Stücks — aus drei Punkten **im Inneren** bestimmt.
 *
 * Im Inneren, weil die Dachfunktion an einer Umrisskante springen kann: Auf
 * der Kante selbst ist sie je nach Rundung mal die eine, mal die andere
 * Seite. Im Inneren eines Stücks ist sie eindeutig. Gibt `null` zurück, wenn
 * das Stück nicht eben ist (an zwei weiteren Punkten geprüft).
 */
function ebeneVon(
  ecken: readonly Vec2[],
  hoeheAn: (p: Vec2) => number,
  toleranz: number,
  mehrdeutig: (p: Vec2) => boolean = () => false,
): Ebene | null {
  const n = ecken.length;
  const m = ecken.reduce((s, p) => ({ x: s.x + p.x / n, y: s.y + p.y / n }), { x: 0, y: 0 });
  const innen = (p: Vec2, f: number): Vec2 => ({ x: m.x + (p.x - m.x) * f, y: m.y + (p.y - m.y) * f });
  // Drei gut verteilte Ecken: die erste, die fernste davon, die mit der größten Dreiecksfläche.
  const e0 = ecken[0];
  let i1 = 1;
  for (let i = 1; i < n; i++) if (Math.hypot(ecken[i].x - e0.x, ecken[i].y - e0.y) > Math.hypot(ecken[i1].x - e0.x, ecken[i1].y - e0.y)) i1 = i;
  let i2 = -1;
  let best = -1;
  for (let i = 0; i < n; i++) {
    if (i === 0 || i === i1) continue;
    const a = Math.abs((ecken[i1].x - e0.x) * (ecken[i].y - e0.y) - (ecken[i1].y - e0.y) * (ecken[i].x - e0.x));
    if (a > best) {
      best = a;
      i2 = i;
    }
  }
  if (i2 < 0) return null;
  const P = [innen(e0, 0.5), innen(ecken[i1], 0.5), innen(ecken[i2], 0.5)];
  const z = P.map((p) => hoeheAn(p));
  if (z.some((x) => !Number.isFinite(x))) return null;
  // z = a x + b y + c  durch drei Punkte
  const det = (P[1].x - P[0].x) * (P[2].y - P[0].y) - (P[2].x - P[0].x) * (P[1].y - P[0].y);
  if (Math.abs(det) < 1e-16) return null;
  const a = ((z[1] - z[0]) * (P[2].y - P[0].y) - (z[2] - z[0]) * (P[1].y - P[0].y)) / det;
  const b = ((P[1].x - P[0].x) * (z[2] - z[0]) - (P[2].x - P[0].x) * (z[1] - z[0])) / det;
  const c = z[0] - a * P[0].x - b * P[0].y;
  const e = { a, b, c };
  /*
   * Prüfen: Mitte, alle Ecken und alle Kantenmitten — dicht am Rand (0,1 %
   * nach innen). Ein erster Entwurf prüfte nur um ein Viertel eingerückte
   * Punkte; schnitt eine Knickgerade nur eine Ecke ab, lag keiner dahinter,
   * und ein Walmdach lag an einer Ecke 0,34 m daneben.
   */
  const kantenMitten = ecken.map((p, i) => {
    const q = ecken[(i + 1) % n];
    return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
  });
  for (const q of [m, ...ecken.map((p) => innen(p, 0.75)), ...ecken.map((p) => innen(p, 0.999)), ...kantenMitten.map((p) => innen(p, 0.999))]) {
    if (mehrdeutig(q)) continue;
    if (Math.abs(hoeheAn(q) - hoeheAuf(e, q)) > toleranz) return null;
  }
  return e;
}

/**
 * Ein konvexes Polygon in ebene Stücke zerlegen.
 *
 * Erst an den Knickgeraden; erweist sich ein Stück trotzdem als nicht eben
 * (Walmdach über beliebigem Umriss, Gaube), wird es quer zu seiner längsten
 * Ausdehnung halbiert — bis es eben ist oder die Ebene es auf 1 mm trifft.
 */
export function ebeneStuecke(
  poly: Vec2[],
  frame: RoofFrame,
  hoeheAn: (p: Vec2) => number,
  geraden: readonly Gerade[] = knickgeraden(frame),
): EbenesStueck[] {
  const aus: EbenesStueck[] = [];
  /*
   * Das Band, in dem die Dachfunktion selbst nicht eindeutig ist: Die
   * Traufrechnung (`randAbstandInRichtung`) zählt Punkte bis 1 µm außerhalb
   * einer Umrisskante noch als „auf der Kante". Ein Prüfpunkt darin sähe
   * einen Sprung, der an der Schnittkante 1 µm daneben liegt. Solche Punkte
   * prüfen nichts und werden übergangen; 2 µm geben Spielraum für Rundung.
   */
  const u = frame.umriss;
  // Die Sprungkanten: Umrisskanten und — seit 1.70.0 — die Mündungen von
  // Schlitzen, an denen die Traufe ebenso endet.
  const kantenSprung: [Vec2, Vec2][] = u.map((a, i) => [a, u[(i + 1) % u.length]]);
  for (const k of frame.kanten) {
    if (k.muendung) {
      const m = k.muendung;
      kantenSprung.push([{ x: m.ax, y: m.ay }, { x: m.ax + m.dx, y: m.ay + m.dy }]);
    }
  }
  const mehrdeutig = (p: Vec2): boolean => {
    for (const [a, b] of kantenSprung) {
      const ex = b.x - a.x;
      const ey = b.y - a.y;
      const l2 = ex * ex + ey * ey;
      if (l2 < 1e-18) continue;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / l2));
      if (Math.hypot(p.x - a.x - ex * t, p.y - a.y - ey * t) < 2e-6) return true;
    }
    return false;
  };
  const halbiere = (s: Vec2[], tiefe: number): void => {
    // Splitter unter 10 µm Breite tragen nichts zur Fläche bei; an einer
    // Sprungkante fände die Ebenenprüfung in ihnen keinen sauberen Punkt.
    // (Die Dachfunktion entscheidet „auf der Kante" mit 1 µm Spiel längs der
    // Fallrichtung; liegt eine Umrisskante fast parallel dazu, wird daraus
    // quer gemessen ein Band von einigen µm, in dem der Sprung irgendwo
    // liegt. Ein solcher Splitter bliebe sonst als Näherung stehen.)
    let laengste = 0;
    for (let i = 0; i < s.length; i++) {
      const q = s[(i + 1) % s.length];
      laengste = Math.max(laengste, Math.hypot(q.x - s[i].x, q.y - s[i].y));
    }
    if (laengste < 1e-9 || (2 * Math.abs(flaeche(s))) / laengste < 1e-5) return;
    const e = ebeneVon(s, hoeheAn, 1e-7, mehrdeutig);
    if (e) {
      aus.push({ ecken: s, ebene: e });
      return;
    }
    // Längste Ausdehnung, Schnitt durch die Mitte quer dazu.
    let li = 0;
    let lj = 1;
    let lang = 0;
    for (let i = 0; i < s.length; i++) {
      for (let j = i + 1; j < s.length; j++) {
        const d = Math.hypot(s[j].x - s[i].x, s[j].y - s[i].y);
        if (d > lang) {
          lang = d;
          li = i;
          lj = j;
        }
      }
    }
    const grob = ebeneVon(s, hoeheAn, 2e-4, mehrdeutig);
    if (grob && lang < 0.05) {
      // Klein genug und unter 0,2 mm: als Näherung annehmen.
      aus.push({ ecken: s, ebene: grob, naeherung: true });
      return;
    }
    if (tiefe >= 24 || lang < 1e-4) {
      // Am Ende der Teilung: die Ebene der Mitte, als Näherung gekennzeichnet.
      const notfalls = grob ?? ebeneVon(s, hoeheAn, Infinity);
      if (notfalls) aus.push({ ecken: s, ebene: notfalls, naeherung: true });
      return;
    }
    const nx = s[lj].x - s[li].x;
    const ny = s[lj].y - s[li].y;
    const mx = (s[li].x + s[lj].x) / 2;
    const my = (s[li].y + s[lj].y) / 2;
    for (const t of teileAn(s, gerade(nx, ny, nx * mx + ny * my))) halbiere(t, tiefe + 1);
  };
  for (const s of zerteile(poly, geraden)) halbiere(s, 0);
  return aus;
}

// ---------------------------------------------------------------------------
// Kappen an einer Höhe
// ---------------------------------------------------------------------------

/**
 * Ein ebenes Stück an einer waagerechten Höhe teilen: was darüber liegt,
 * bekommt die Höhe selbst als Ebene. So endet eine Wand an ihrer eigenen
 * Oberkante, wo das Dach höher ist, und am Wandfuß, wo es tiefer ist.
 */
function kappe(stuecke: EbenesStueck[], z: number, oben: boolean): EbenesStueck[] {
  const aus: EbenesStueck[] = [];
  for (const s of stuecke) {
    const { a, b, c } = s.ebene;
    if (Math.hypot(a, b) < 1e-14) {
      const ueber = c > z;
      aus.push(ueber === oben ? { ...s, ebene: { a: 0, b: 0, c: z }, unterFuss: !oben } : s);
      continue;
    }
    // a x + b y + c = z  →  Gerade (a, b) · p = z − c
    for (const t of teileAn(s.ecken, gerade(a, b, z - c))) {
      const m = t.reduce((q, p) => ({ x: q.x + p.x / t.length, y: q.y + p.y / t.length }), { x: 0, y: 0 });
      const ueber = hoeheAuf(s.ebene, m) > z;
      aus.push(ueber === oben ? { ecken: t, ebene: { a: 0, b: 0, c: z }, unterFuss: !oben } : { ...s, ecken: t });
    }
  }
  return aus;
}

// ---------------------------------------------------------------------------
// Die Wand unter dem Dach
// ---------------------------------------------------------------------------

/** Eine ebene Fläche eines Körpers, mit der Richtung, in die sie nach außen zeigt. */
export interface Koerperflaeche {
  punkte: Punkt3[];
  aussen: Punkt3;
}

export interface WandUnterDach {
  /** Die Oberseite: ebene Stücke, jedes exakt auf der Dachfläche (oder der Wandoberkante). */
  oben: EbenesStueck[];
  /** Alle Flächen des Körpers: Oberseite, Seiten, Stirnen, Unterseite. */
  flaechen: Koerperflaeche[];
}

/**
 * Den Körper eines Wandstücks [u0, u1] unter dem Dach bauen.
 *
 * Der Fußabdruck (Wandstärke × Länge) wird an den Knickgeraden zerschnitten;
 * jedes Stück trägt die Dachfläche als Ebene, oben gekappt an der Wandhöhe,
 * unten am Wandfuß. Die Seitenflächen laufen an den Rändern der Stücke
 * hinunter — dieselben Kanten wie oben, also ohne Fuge. Wo das Dach springt
 * (an einer Umrisskante), steht zwischen zwei Stücken eine senkrechte Stufe.
 */
export function wandUnterDach(
  g: WallGeometry,
  u0: number,
  u1: number,
  halbeStaerke: number,
  zStart: number,
  zEnd: number,
  frame: RoofFrame,
  hoeheAn: (p: Vec2) => number,
): WandUnterDach {
  const W = (u: number, s: number) => wallLocalToWorld(g, u, s);
  // Gegen den Uhrzeigersinn im Wandsystem (u nach vorn, s nach links).
  let fuss = [W(u0, -halbeStaerke), W(u1, -halbeStaerke), W(u1, halbeStaerke), W(u0, halbeStaerke)];
  if (flaeche(fuss) < 0) fuss = fuss.reverse();
  let stuecke = ebeneStuecke(fuss, frame, hoeheAn);
  stuecke = kappe(stuecke, zEnd, true);
  /*
   * Wo das Dach unter dem Wandfuß liegt, gibt es dort keine Wand — das Stück
   * fällt weg, statt (wie anfangs) als Fläche der Dicke null auf Fußhöhe
   * liegen zu bleiben. Das betrifft den Sturz über einem Fenster, dessen
   * Oberkante über der Traufe liegt: Er begann über der Dachfläche und lag
   * als dünne Platte über dem Dach (Feldscan, Traufwand mit 2,29 m hohem
   * Fenstersturz unter 1,24 m Kniestock).
   */
  stuecke = kappe(stuecke, zStart, false).filter((t) => !t.unterFuss);

  const flaechen: Koerperflaeche[] = [];
  const auf = (s: EbenesStueck, p: Vec2): Punkt3 => ({ x: p.x, y: p.y, z: hoeheAuf(s.ebene, p) });
  for (const s of stuecke) flaechen.push({ punkte: s.ecken.map((p) => auf(s, p)), aussen: { x: 0, y: 0, z: 1 } });

  // Ränder: Liegt eine Kante auf dem Rand des Fußabdrucks, läuft dort eine
  // Seitenfläche bis zum Wandfuß. Liegt sie innen und ist die Nachbarebene
  // tiefer, steht dort eine Stufe.
  const aufRand = (p: Vec2, q: Vec2): boolean => {
    for (let i = 0; i < fuss.length; i++) {
      const a = fuss[i];
      const b = fuss[(i + 1) % fuss.length];
      const ex = b.x - a.x;
      const ey = b.y - a.y;
      const l = Math.hypot(ex, ey);
      const d1 = Math.abs((p.x - a.x) * ey - (p.y - a.y) * ex) / l;
      const d2 = Math.abs((q.x - a.x) * ey - (q.y - a.y) * ex) / l;
      if (d1 < 1e-7 && d2 < 1e-7) return true;
    }
    return false;
  };
  for (const s of stuecke) {
    const n = s.ecken.length;
    const m = s.ecken.reduce((q, p) => ({ x: q.x + p.x / n, y: q.y + p.y / n }), { x: 0, y: 0 });
    for (let i = 0; i < n; i++) {
      const p = s.ecken[i];
      const q = s.ecken[(i + 1) % n];
      // Nach außen: weg von der Stückmitte, waagerecht.
      const ex = q.x - p.x;
      const ey = q.y - p.y;
      let ax = ey;
      let ay = -ex;
      if (ax * (p.x - m.x) + ay * (p.y - m.y) < 0) {
        ax = -ax;
        ay = -ay;
      }
      const aussen = { x: ax, y: ay, z: 0 };
      const hp = hoeheAuf(s.ebene, p);
      const hq = hoeheAuf(s.ebene, q);
      if (aufRand(p, q)) {
        flaechen.push({ punkte: [{ x: p.x, y: p.y, z: zStart }, { x: q.x, y: q.y, z: zStart }, { x: q.x, y: q.y, z: hq }, { x: p.x, y: p.y, z: hp }], aussen });
        continue;
      }
      // Innen: Nachbar jenseits der Kante suchen und dessen Höhe nehmen.
      const mitte = { x: (p.x + q.x) / 2 + ax * 1e-6 / Math.hypot(ax, ay), y: (p.y + q.y) / 2 + ay * 1e-6 / Math.hypot(ax, ay) };
      const nachbar = stuecke.find((t) => t !== s && pointInPolygon(mitte, t.ecken));
      if (!nachbar) {
        // Jenseits liegt nichts mehr (weggefallen, weil das Dach dort unter
        // dem Fuß liegt): Seitenfläche bis zum Fuß, damit der Körper zu ist.
        flaechen.push({ punkte: [{ x: p.x, y: p.y, z: zStart }, { x: q.x, y: q.y, z: zStart }, { x: q.x, y: q.y, z: hq }, { x: p.x, y: p.y, z: hp }], aussen });
        continue;
      }
      const np = hoeheAuf(nachbar.ebene, p);
      const nq = hoeheAuf(nachbar.ebene, q);
      // Die höhere Seite trägt die Stufe — so entsteht sie genau einmal.
      if (hp > np + 1e-7 || hq > nq + 1e-7) {
        flaechen.push({ punkte: [{ x: p.x, y: p.y, z: np }, { x: q.x, y: q.y, z: nq }, { x: q.x, y: q.y, z: hq }, { x: p.x, y: p.y, z: hp }], aussen });
      }
    }
  }
  // Unterseite: nur unter den Stücken, die geblieben sind.
  for (const s of stuecke) flaechen.push({ punkte: s.ecken.map((p) => ({ x: p.x, y: p.y, z: zStart })), aussen: { x: 0, y: 0, z: -1 } });
  return { oben: stuecke, flaechen };
}

/**
 * Die tiefste Dachhöhe über einem Kasten in der Wand [m] — für Rahmen und
 * Glas, die oben waagerecht sind. Auf ebenen Stücken liegt das Minimum an
 * einer Ecke eines Stücks; die Ecken der Stücke sind also genau die Stellen,
 * an denen gesucht werden muss.
 */
export function tiefsteDachhoehe(
  g: WallGeometry,
  u0: number,
  u1: number,
  halbeTiefe: number,
  frame: RoofFrame,
  hoeheAn: (p: Vec2) => number,
): number {
  let fuss = [
    wallLocalToWorld(g, u0, -halbeTiefe),
    wallLocalToWorld(g, u1, -halbeTiefe),
    wallLocalToWorld(g, u1, halbeTiefe),
    wallLocalToWorld(g, u0, halbeTiefe),
  ];
  if (flaeche(fuss) < 0) fuss = fuss.reverse();
  let min = Infinity;
  for (const s of ebeneStuecke(fuss, frame, hoeheAn)) for (const p of s.ecken) min = Math.min(min, hoeheAuf(s.ebene, p));
  return min;
}

// ---------------------------------------------------------------------------
// Die Dachhaut
// ---------------------------------------------------------------------------

/**
 * Ein einfaches Polygon in Dreiecke zerlegen (Ohrenschnitt).
 *
 * Für die Dachhaut über einem L- oder U-förmigen Umriss — der ist nicht
 * konvex, und die Zerlegung an den Knickgeraden setzt konvexe Stücke voraus.
 * Die Dreiecke sind konvex; jedes wird danach für sich zerschnitten.
 */
export function ohrenschnitt(poly: readonly Vec2[]): Vec2[][] {
  const pts = flaeche(poly) < 0 ? [...poly].reverse() : [...poly];
  const idx = pts.map((_, i) => i);
  const aus: Vec2[][] = [];
  const kreuz = (a: Vec2, b: Vec2, c: Vec2) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const imDreieck = (p: Vec2, a: Vec2, b: Vec2, c: Vec2) =>
    kreuz(a, b, p) > 1e-12 && kreuz(b, c, p) > 1e-12 && kreuz(c, a, p) > 1e-12;
  let schutz = 0;
  while (idx.length > 3 && schutz++ < 10000) {
    let geschnitten = false;
    for (let i = 0; i < idx.length; i++) {
      const a = pts[idx[(i + idx.length - 1) % idx.length]];
      const b = pts[idx[i]];
      const c = pts[idx[(i + 1) % idx.length]];
      if (kreuz(a, b, c) <= 1e-12) continue; // spitze Ecke nach innen
      let frei = true;
      for (const j of idx) {
        const p = pts[j];
        if (p === a || p === b || p === c) continue;
        if (imDreieck(p, a, b, c)) {
          frei = false;
          break;
        }
      }
      if (!frei) continue;
      aus.push([a, b, c]);
      idx.splice(i, 1);
      geschnitten = true;
      break;
    }
    if (!geschnitten) {
      // Entartetes Polygon (kollineare Ecken): die nächste Ecke entfernen.
      idx.splice(0, 1);
    }
  }
  if (idx.length === 3) aus.push(idx.map((i) => pts[i]));
  return aus.filter((t) => Math.abs(flaeche(t)) > 1e-12);
}

/**
 * Die Dachhaut über einem Umriss mit Überstand — exakt.
 *
 * `ueberstand` je Umrisskante [m]: 0,50 m wie bisher, 0 an einer Kante, hinter
 * der ein Raum desselben Geschosses liegt, der nicht unter diesem Dach steht
 * (sonst schnitte das Dach in ihn hinein). Die Haut liegt `abstand` über der
 * Dachfläche, damit sie die Oberseiten der Wände darunter nicht flimmernd
 * überdeckt.
 */
export function dachhaut(
  frame: RoofFrame,
  ueberstand: readonly number[],
  hoeheAn: (p: Vec2) => number,
  abstand = 0.02,
): Punkt3[][] {
  if (frame.umriss.length < 3) return [];
  const zu = schlitzeZu(frame, ueberstand);
  // offsetPolygonPerEdge versetzt bei positivem Wert nach innen (Umriss gegen den Uhrzeigersinn).
  const aussen = offsetPolygonPerEdge(zu.umriss, zu.ueberstand.map((u) => -u));
  const geraden = knickgeraden(frame);
  const dreiecke: Punkt3[][] = [];
  for (const d of ohrenschnitt(aussen)) {
    for (const s of ebeneStuecke(d, frame, hoeheAn, geraden)) {
      const pkt = s.ecken.map((p) => ({ x: p.x, y: p.y, z: hoeheAuf(s.ebene, p) + abstand }));
      for (let i = 1; i + 1 < pkt.length; i++) dreiecke.push([pkt[0], pkt[i], pkt[i + 1]]);
    }
  }
  return dreiecke;
}

/**
 * Der Umriss für die Dachhaut, mit geschlossenen Schlitzen (seit 1.70.0).
 *
 * Die Dachfläche überspannt einen Schlitz im Umriss (`roofGeometry.ts`,
 * `umrissKanten`); die Haut tut es auch. Sonst blieb über ihm eine offene
 * Rinne, aus der die Seitenwände des Schlitzes wie ein Schornstein ragten.
 * Je Schlitz fallen seine beiden inneren Ecken weg; die neue Kante ist die
 * Mündung, ihr Überstand der größere der beiden Traufkanten daneben.
 */
function schlitzeZu(frame: RoofFrame, ueberstand: readonly number[]): { umriss: Vec2[]; ueberstand: number[] } {
  const u = frame.umriss;
  const n = u.length;
  const weg = new Set<number>();
  for (const k of frame.kanten) {
    if (!k.muendung) continue;
    const i = u.findIndex((p) => Math.abs(p.x - k.ax) < 1e-9 && Math.abs(p.y - k.ay) < 1e-9);
    if (i < 0 || n - weg.size < 6) continue;
    weg.add(i);
    weg.add((i + 1) % n);
  }
  if (!weg.size) return { umriss: [...u], ueberstand: [...ueberstand] };
  const umriss: Vec2[] = [];
  const ue: number[] = [];
  for (let i = 0; i < n; i++) {
    if (weg.has(i)) continue;
    umriss.push(u[i]);
    // Kante ab Ecke i: führt sie über weggefallene Ecken, ist sie die Mündung.
    if (weg.has((i + 1) % n)) {
      let j = (i + 1) % n;
      while (weg.has(j)) j = (j + 1) % n;
      ue.push(Math.max(ueberstand[(i - 1 + n) % n] ?? 0, ueberstand[j] ?? 0));
    } else {
      ue.push(ueberstand[i] ?? 0);
    }
  }
  return { umriss, ueberstand: ue };
}

/** Höhe einer Ebene an einem Punkt — für Prüfblock und Ansicht. */
export function hoeheAufEbene(e: Ebene, p: Vec2): number {
  return hoeheAuf(e, p);
}
