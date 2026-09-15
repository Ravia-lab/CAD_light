/**
 * begehen — die Regel, nach der man sich im Modell bewegt.
 *
 * **Warum das eine eigene Einheit ist.** Die 3D-Ansicht war bisher eine
 * Ansicht: man dreht ein Modell auf dem Tisch. Begehen ist etwas anderes —
 * man steht *darin*, auf Augenhöhe, und die Frage „komme ich hier durch?"
 * bekommt eine Antwort, die der Anwender sofort gegen seine Erfahrung prüft.
 * Läuft man durch eine Wand, ist das Modell entwertet; bleibt man in einer
 * Tür hängen, ist es das Programm.
 *
 * Genau diese Frage ist reine Geometrie und gehört deshalb hierher — ohne
 * Three.js, ohne Leinwand, ohne React, und damit prüfbar.
 *
 * **Die drei Entscheidungen, die hier getroffen werden:**
 *
 *  1. **Der Körper ist ein Kreis.** Kein Kasten, keine Kapsel. Ein Kreis
 *     gleitet an Kanten entlang, statt sich zu verhaken, und ein Mensch, der
 *     an einer Wand entlangstreift, will genau das.
 *  2. **Türen und Durchgänge sind Löcher, Fenster nicht.** Eine Wand ist kein
 *     durchgehendes Hindernis: Wo eine Tür sitzt, fehlt das Hindernis auf
 *     ihrer Breite. Ein Fenster mit Brüstung bleibt stehen — sonst spaziert
 *     man durch die Fensterbank.
 *  3. **Verschoben wird zweimal.** Erst der ganze Schritt, dann eine
 *     Nachkorrektur. Ohne die zweite Runde bleibt man in Innenecken hängen:
 *     Das Herausdrücken aus der einen Wand schiebt einen in die andere.
 */

import { getWallGeometry, openingSpan } from './wallGeometry';
import type { BimDocument, LevelId, Opening, Vec2 } from '../types/bim';

/** Augenhöhe über Fertigfußboden [m] — Mittelwert eines stehenden Menschen. */
export const AUGENHOEHE = 1.65;

/** Gehgeschwindigkeit [m/s]. Ein ruhiger Gang, kein Eilschritt. */
export const TEMPO_GEHEN = 1.45;

/** Mit Umschalttaste [m/s] — schnell durch ein großes Haus, ohne zu rennen. */
export const TEMPO_SCHNELL = 3.4;

/**
 * Körperradius [m].
 *
 * 28 cm: schmaler als eine Schulter (rund 45 cm), und das mit Absicht. Der
 * Radius begrenzt, wo man durchkommt — bei einer 80er-Tür mit zwei Zargen
 * bleiben lichte 73 cm, und wer dort mit 45 cm Halbbreite hindurchwill,
 * bleibt hängen, obwohl ein Mensch sich dreht.
 */
export const KOERPER_RADIUS = 0.28;

/** Wie weit man bei einer Wand stehen bleibt: Wandhalbdicke + Körperradius. */
export interface Hindernis {
  a: Vec2;
  b: Vec2;
  /** Halbe Wandstärke [m] — der Abstand, den die Achse einhalten muss. */
  halbdicke: number;
}

/** Ist die Öffnung begehbar — also ein Loch, durch das man geht? */
export function begehbar(o: Opening): boolean {
  // Türen und Durchgänge ja, Fenster nein. Eine bodentiefe Verglasung ist
  // trotzdem kein Weg: sie ist zu, auch wenn sie bis zum Boden reicht.
  if (o.kind === 'window') return false;
  return (o.sillHeight ?? 0) <= 0.05;
}

/**
 * Die Hindernisse eines Geschosses: Wandstücke ohne die Löcher.
 *
 * Ein Wandzug wird an jeder begehbaren Öffnung aufgetrennt. Übrig bleiben die
 * massiven Stücke — und nur die halten auf.
 */
export function hindernisse(doc: BimDocument, levelId: LevelId): Hindernis[] {
  const raus: Hindernis[] = [];
  const oeffnungenJeWand = new Map<string, Opening[]>();
  for (const o of Object.values(doc.openings ?? {})) {
    if (!begehbar(o)) continue;
    const liste = oeffnungenJeWand.get(o.wallId);
    if (liste) liste.push(o);
    else oeffnungenJeWand.set(o.wallId, [o]);
  }

  for (const wand of Object.values(doc.walls ?? {})) {
    if (wand.levelId !== levelId) continue;
    const g = getWallGeometry(wand, doc.nodes);
    if (!g) continue;
    const halb = wand.thickness / 2;

    // Die Löcher als Abschnitte auf der Achse, sortiert und zusammengefasst.
    const loecher = (oeffnungenJeWand.get(wand.id) ?? [])
      .map((o) => openingSpan(g, o))
      .sort((x, y) => x.from - y.from);

    let start = 0;
    for (const loch of loecher) {
      const von = Math.max(0, loch.from);
      const bis = Math.min(g.length, loch.to);
      if (bis <= start) continue;
      if (von > start) {
        raus.push({
          a: { x: g.a.x + g.dir.x * start, y: g.a.y + g.dir.y * start },
          b: { x: g.a.x + g.dir.x * von, y: g.a.y + g.dir.y * von },
          halbdicke: halb,
        });
      }
      start = Math.max(start, bis);
    }
    if (start < g.length) {
      raus.push({
        a: { x: g.a.x + g.dir.x * start, y: g.a.y + g.dir.y * start },
        b: { x: g.b.x, y: g.b.y },
        halbdicke: halb,
      });
    }
  }
  return raus;
}

/** Nächster Punkt auf einer Strecke — ohne Import, weil hier heiß gerechnet wird. */
function nahPunkt(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return a;
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return { x: a.x + dx * t, y: a.y + dy * t };
}

/**
 * Aus einer Lage herausdrücken, die im Hindernis liegt.
 *
 * Zwei Durchgänge, und das hat einen Grund: In einer Innenecke drückt die
 * erste Wand aus sich heraus — und zwar in die zweite hinein. Ein einzelner
 * Durchgang ließe einen dort stecken. Zwei genügen für rechte Winkel; mehr
 * braucht es erst bei spitzen Ecken, und die gibt es im Grundriss praktisch
 * nicht.
 */
export function loese(p: Vec2, hind: readonly Hindernis[], radius = KOERPER_RADIUS): Vec2 {
  let q = { ...p };
  for (let runde = 0; runde < 2; runde++) {
    let bewegt = false;
    for (const h of hind) {
      const abstand = h.halbdicke + radius;
      const nah = nahPunkt(q, h.a, h.b);
      const dx = q.x - nah.x;
      const dy = q.y - nah.y;
      const d = Math.hypot(dx, dy);
      if (d >= abstand) continue;
      if (d < 1e-6) {
        // Genau auf der Achse: senkrecht zur Wand herausschieben. Ohne diesen
        // Fall teilte man durch null und flöge ins Nichts.
        const wx = h.b.x - h.a.x;
        const wy = h.b.y - h.a.y;
        const l = Math.hypot(wx, wy) || 1;
        q = { x: nah.x - (wy / l) * abstand, y: nah.y + (wx / l) * abstand };
      } else {
        q = { x: nah.x + (dx / d) * abstand, y: nah.y + (dy / d) * abstand };
      }
      bewegt = true;
    }
    if (!bewegt) break;
  }
  return q;
}

/**
 * Steckt die Lage trotz Herausdrücken noch in einem Hindernis?
 *
 * Das ist der Fall der **zu engen Lücke**: Zwei Wandstücke drücken von links
 * und rechts, die beiden Anteile heben sich auf, und der Körper stünde
 * mittendrin — rechnerisch ruhig, tatsächlich in der Wand. Ein Mensch käme
 * dort nicht durch, also darf er es hier auch nicht.
 */
export function stecktFest(p: Vec2, hind: readonly Hindernis[], radius = KOERPER_RADIUS): boolean {
  for (const h of hind) {
    const nah = nahPunkt(p, h.a, h.b);
    // Ein Zehntelmillimeter Luft: `loese` setzt genau auf den Abstand, und
    // Fließkomma trifft „genau" nicht immer.
    if (Math.hypot(p.x - nah.x, p.y - nah.y) < h.halbdicke + radius - 1e-4) return true;
  }
  return false;
}

/**
 * Einen Schritt gehen und dabei an Wänden abgleiten.
 *
 * **Warum der Weg zählt und nicht nur das Ziel.** Die erste Fassung prüfte
 * allein den Zielpunkt: Liegt er in einer Wand, wird er herausgedrückt. Das
 * ist falsch, und der Prüflauf hat es sofort gezeigt — wer mit einem großen
 * Schritt *durch* eine Wand hindurch zielt, landet dahinter im Freien, und
 * dort gibt es nichts mehr, was ihn zurückhielte. Bei 3,4 m/s und einem
 * Bildabstand von einer Zehntelsekunde sind das 34 cm je Schritt; eine 11,5er-
 * Wand ist schmaler als das.
 *
 * Gegangen wird deshalb in **Teilschritten**, jeder höchstens einen halben
 * Körperradius lang, und nach jedem wird herausgedrückt. Damit kann kein
 * Hindernis übersprungen werden, dessen Fangbreite größer ist als ein
 * Teilschritt — und das ist jedes, denn die Fangbreite ist mindestens der
 * Körperradius selbst.
 *
 * Der jeweils gelöste Punkt trägt den nächsten Teilschritt: nur so entsteht
 * das Gleiten an der Wand entlang. Rechnete jeder Teilschritt wieder von der
 * ursprünglichen Geraden, drückte es einen bei jedem Schritt aufs Neue quer
 * heraus, und man klebte fest.
 */
export function gehe(
  von: Vec2,
  nach: Vec2,
  hind: readonly Hindernis[],
  radius = KOERPER_RADIUS,
): Vec2 {
  const dx = nach.x - von.x;
  const dy = nach.y - von.y;
  const weite = Math.hypot(dx, dy);
  if (weite < 1e-9) return loese(von, hind, radius);
  const teile = Math.max(1, Math.ceil(weite / Math.max(radius * 0.5, 1e-3)));
  const sx = dx / teile;
  const sy = dy / teile;
  let p = { ...von };
  for (let i = 0; i < teile; i++) {
    const versuch = loese({ x: p.x + sx, y: p.y + sy }, hind, radius);
    // Bleibt der Versuch trotz Herausdrücken im Hindernis, ist der Weg zu
    // eng — dann endet der Schritt hier. Ohne diese Prüfung schlüpft man
    // durch eine 50er-Öffnung, weil sich die Kräfte von links und rechts
    // aufheben und die Bewegung quer dazu ungebremst weiterläuft.
    if (stecktFest(versuch, hind, radius)) break;
    p = versuch;
  }
  return p;
}

/**
 * Blickrichtung aus den beiden Winkeln.
 *
 * `gier` dreht um die Hochachse (0 = Blick nach +x), `nick` hebt und senkt
 * den Blick. Beide in Bogenmaß. Zurück kommt ein Einheitsvektor in
 * **Modellkoordinaten** (x, y in der Ebene, z nach oben) — die Umrechnung in
 * die Szene macht `modelToScene`, hier wird nicht gedreht und nicht
 * gespiegelt.
 */
export function blickrichtung(gier: number, nick: number): { x: number; y: number; z: number } {
  const cos = Math.cos(nick);
  return { x: Math.cos(gier) * cos, y: Math.sin(gier) * cos, z: Math.sin(nick) };
}

/** Der Nickwinkel wird begrenzt: knapp unter senkrecht, sonst kippt das Bild. */
export const NICK_GRENZE = (Math.PI / 2) * 0.98;

export function begrenzeNick(nick: number): number {
  return Math.max(-NICK_GRENZE, Math.min(NICK_GRENZE, nick));
}

/**
 * Aus Tasten- oder Steuerkreuzeingabe wird ein Schritt in Weltkoordinaten.
 *
 * `vor` und `seit` liegen zwischen −1 und 1 und beschreiben die Absicht in
 * **Blickrichtung**, nicht in Weltrichtung. Diagonal ist nicht schneller als
 * geradeaus: die Länge wird auf 1 begrenzt, bevor das Tempo darauf wirkt.
 */
export function schritt(gier: number, vor: number, seit: number, tempo: number, dt: number): Vec2 {
  const laenge = Math.hypot(vor, seit);
  if (laenge < 1e-6) return { x: 0, y: 0 };
  const f = (laenge > 1 ? 1 / laenge : 1) * tempo * dt;
  const vx = Math.cos(gier);
  const vy = Math.sin(gier);
  // Rechts von der Blickrichtung: um 90° im Uhrzeigersinn gedreht.
  const rx = vy;
  const ry = -vx;
  return { x: (vx * vor + rx * seit) * f, y: (vy * vor + ry * seit) * f };
}
