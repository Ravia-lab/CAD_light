/**
 * Lücken im Grundriss finden — und sagen, was man daraus machen kann.
 * ---------------------------------------------------------------------------
 * Ein loses Wandende ist im Aufmaß fast nie ein Fehler, sondern eine Aussage:
 * *hier hat das Messgerät keine Wand gesehen.* Warum es keine gesehen hat,
 * weiß nur der Mensch davor — meistens, weil an der Stelle eine Tür ist, ein
 * Durchgang, oder weil ein Schrank die Sicht verstellt hat und die Wand sehr
 * wohl da ist.
 *
 * Genau diese drei Antworten soll man geben können, ohne von Hand zu zeichnen:
 * **Wand**, **Tür** oder **Durchgang**. Dieses Modul findet die Lücken und
 * schlägt für jede vor, wohin sie zu schließen wäre; das Setzen selbst
 * passiert im Speicher, weil dort die Historie liegt.
 *
 * **Wie das Gegenüber gesucht wird.** Eine Wand, die aufhört, geht in ihrer
 * eigenen Richtung weiter — das ist der Regelfall und bekommt Vorrang. Erst
 * wenn dort nichts ist, wird auch quer gesucht. Ohne diesen Vorrang klappt die
 * Wand in einem engen Flur zur Seite weg und schließt die Lücke gegen die
 * falsche Wand: geometrisch näher, baulich Unsinn.
 *
 * **Was nicht vorgeschlagen wird.** Ein Gegenüber weiter weg als
 * `MAX_WEITE` — jenseits davon fehlt kein Stück Wand, dort fehlt ein Raum, und
 * das soll niemand mit einem Klick erzeugen.
 */

import type { BimNode, Vec2, Wall } from '../types/bim';

/** Weiteste Lücke, die noch als Lücke gilt [m]. */
export const MAX_WEITE = 3.0;

/**
 * Wie stark ein Ziel „geradeaus" liegen muss, um als Fortsetzung zu gelten.
 * 0,7 entspricht etwa 45° — alles darin gilt als Verlängerung der Wand.
 */
const GERADEAUS = 0.7;

/** Ein Ziel näher als das an der Lücke ist derselbe Punkt, kein Gegenüber. */
const MIN_WEITE = 0.02;

export type LueckenSchluss = 'wand' | 'tuer' | 'durchgang' | 'fenster';

export interface Luecke {
  /** Der lose Knoten — Grad 1, nichts schließt dort an. */
  knotenId: string;
  punkt: Vec2;
  /** Wand, die an diesem Ende hängt. Gibt Dicke, Höhe und Art vor. */
  wandId: string;
  /** Wohin geschlossen würde. */
  ziel: Vec2;
  /** Wand, auf die getroffen wird — dann entsteht ein T-Stoß. */
  zielWandId?: string;
  /** Loses Ende, auf das getroffen wird — dann treffen sich zwei Lücken. */
  zielKnotenId?: string;
  weite: number;
  /** Liegt das Ziel in Verlängerung der Wand (true) oder quer dazu? */
  geradeaus: boolean;
}

const abstand = (a: Vec2, b: Vec2): number => Math.hypot(b.x - a.x, b.y - a.y);

/** Lotfußpunkt auf einer Strecke, mit Parameter t in [0,1]. */
function lotfuss(p: Vec2, a: Vec2, b: Vec2): { punkt: Vec2; t: number; abstand: number } {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const l2 = vx * vx + vy * vy;
  if (l2 < 1e-12) return { punkt: a, t: 0, abstand: abstand(p, a) };
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / l2));
  const punkt = { x: a.x + t * vx, y: a.y + t * vy };
  return { punkt, t, abstand: abstand(p, punkt) };
}

/**
 * Alle Lücken eines Geschosses.
 *
 * Treffen sich zwei lose Enden gegenseitig, wird daraus **eine** Lücke — sonst
 * stünden zwei Vorschläge für dasselbe Wandstück in der Liste, und wer beide
 * anklickt, hat die Wand doppelt.
 */
export function findeLuecken(
  walls: Wall[],
  nodes: Record<string, BimNode>,
  levelId: string,
  maxWeite = MAX_WEITE,
): Luecke[] {
  const eigene = walls.filter((w) => w.levelId === levelId && nodes[w.a] && nodes[w.b]);

  const grad = new Map<string, number>();
  const wandAn = new Map<string, Wall>();
  for (const w of eigene) {
    for (const k of [w.a, w.b]) {
      grad.set(k, (grad.get(k) ?? 0) + 1);
      wandAn.set(k, w);
    }
  }
  const lose = [...grad.entries()].filter(([, g]) => g === 1).map(([id]) => id);

  const roh: Luecke[] = [];
  for (const knotenId of lose) {
    const p = nodes[knotenId];
    const wand = wandAn.get(knotenId);
    if (!p || !wand) continue;

    // Richtung, in der die Wand ausläuft: vom anderen Ende auf dieses zu.
    const anderes = nodes[wand.a === knotenId ? wand.b : wand.a];
    const laenge = abstand(anderes, p) || 1;
    const dx = (p.x - anderes.x) / laenge;
    const dy = (p.y - anderes.y) / laenge;

    let beste: Luecke | null = null;
    /** Kleiner ist besser. Geradeaus zählt doppelt so viel wie quer. */
    let bestesMass = Infinity;

    const pruefe = (
      ziel: Vec2,
      extra: { zielWandId?: string; zielKnotenId?: string },
    ): void => {
      const weite = abstand(p, ziel);
      if (weite < MIN_WEITE || weite > maxWeite) return;
      const richtung = ((ziel.x - p.x) * dx + (ziel.y - p.y) * dy) / weite;
      // Nach hinten wird nie geschlossen: dort liegt die eigene Wand.
      if (richtung < 0) return;
      const geradeaus = richtung >= GERADEAUS;
      const mass = geradeaus ? weite : weite * 2;
      if (mass >= bestesMass) return;
      bestesMass = mass;
      beste = { knotenId, punkt: p, wandId: wand.id, ziel, weite, geradeaus, ...extra };
    };

    for (const w of eigene) {
      if (w.id === wand.id) continue;
      const a = nodes[w.a];
      const b = nodes[w.b];
      // Auf ein anderes loses Ende treffen.
      for (const k of [w.a, w.b]) {
        if (k === knotenId) continue;
        if (grad.get(k) !== 1) continue;
        pruefe(nodes[k], { zielKnotenId: k });
      }
      // Oder mitten auf eine Wand — daraus wird ein T-Stoß.
      const f = lotfuss(p, a, b);
      if (f.t > 0.001 && f.t < 0.999) pruefe(f.punkt, { zielWandId: w.id });
    }

    if (beste) roh.push(beste);
  }

  // Zwei lose Enden, die aufeinander zeigen, sind eine Lücke.
  const raus: Luecke[] = [];
  const erledigt = new Set<string>();
  for (const l of roh) {
    if (erledigt.has(l.knotenId)) continue;
    erledigt.add(l.knotenId);
    if (l.zielKnotenId) erledigt.add(l.zielKnotenId);
    raus.push(l);
  }
  return raus.sort((a, b) => a.weite - b.weite);
}

/**
 * Maße der Öffnung, die in eine geschlossene Lücke gesetzt wird.
 *
 * Die Öffnung füllt die Lücke — das ist der Sinn der Sache: wer sagt „hier ist
 * eine Tür", meint die ganze Lücke und nicht eine 88,5-cm-Tür mit Mauerwerk
 * daneben. Zwei Zentimeter an jeder Seite bleiben stehen, weil eine Öffnung,
 * die genau so breit ist wie ihre Wand, keine Öffnung mehr ist, sondern ein
 * Loch, und die Wand dann rechnerisch verschwindet.
 *
 * Ist die Lücke breiter, als eine Tür sein kann, wird die Tür auf ein
 * übliches Maß begrenzt und mittig gesetzt — daneben bleibt Wand stehen. Ein
 * Durchgang darf dagegen so breit sein, wie er ist.
 */
export function oeffnungFuerLuecke(
  art: Exclude<LueckenSchluss, 'wand'>,
  weite: number,
  wandHoehe: number,
): { width: number; height: number; sillHeight: number } | null {
  const nutzbar = weite - 0.04;
  if (nutzbar < 0.2) return null;

  if (art === 'tuer') {
    const width = Math.min(nutzbar, 1.26);
    return { width, height: Math.min(2.135, wandHoehe - 0.1), sillHeight: 0 };
  }
  if (art === 'fenster') {
    const width = Math.min(nutzbar, 2.0);
    const sill = 0.9;
    return {
      width,
      height: Math.max(0.6, Math.min(1.385, wandHoehe - sill - 0.2)),
      sillHeight: sill,
    };
  }
  // Durchgang: so breit wie die Lücke.
  return { width: nutzbar, height: Math.min(2.135, wandHoehe - 0.1), sillHeight: 0 };
}
