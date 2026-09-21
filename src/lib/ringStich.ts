/**
 * Stichleitung vom Ring zu einem Heizkörper ohne Außenwand.
 * ---------------------------------------------------------------------------
 * **Die Meldung dahinter:** „bei Ring haben wir einen Spezialfall: ein
 * Heizkörper im Flur. Das wird dann von der kürzesten Stelle als Stich an den
 * Innenwänden verlegt — das spart sehr viel Rohr und Bögen."
 *
 * Der Flur hat keine Außenwand, der Ring läuft also nicht durch ihn. Bis hier
 * wurde die Anbindung am luftlinien-nächsten Ringpunkt angesetzt und dann mit
 * der allgemeinen Trassierung verlegt. Die kennt nur Türen als Weg von Raum
 * zu Raum und bewertet jede mit einem Ersatzweg von 500 m — sie läuft deshalb
 * lieber einmal um den halben Grundriss, als eine Wand zu durchbohren. Der
 * Heizungsbauer macht es umgekehrt: Er bohrt einmal durch die Trennwand und
 * führt den Stich an einer Innenwand entlang zum Ring an der Außenwand.
 *
 * **Das Verfahren.** Ein Raster über dem Gebäudeumriss, darauf Dijkstra vom
 * Heizkörper aus, bis der erste Ringpunkt erreicht ist — das ist „die
 * kürzeste Stelle", und sie ergibt sich aus der Suche, nicht aus der
 * Luftlinie. Die Kosten je Schritt bilden die Verlegung im Sockelleistenkanal
 * ab:
 *
 *   · in der Kanalspur (bis `KANAL` vor der Wandfläche): die Länge selbst;
 *   · knapp daneben (bis `WANDNAH`): das `NAH_FAKTOR`-fache — der Stich soll
 *     an der Wand kleben, nicht zwei Handbreit davor laufen;
 *   · frei im Raum: das `FREI_FAKTOR`-fache — ein Kanal quer über den Boden
 *     ist keine Sanierungsverlegung;
 *   · durch eine Trennwand: einmal `KERNBOHRUNG` als Zuschlag, durch eine
 *     Türöffnung `BODENDURCHFUEHRUNG` (Schwelle); längs *in* der Wand zu
 *     laufen ist gesperrt (zehnfache Länge), durchbohrt wird quer;
 *   · jeder Richtungswechsel: `BOGEN` — ein Bogen kostet Rohr, Zeit und
 *     Druckverlust.
 *
 * Außenwände und alles außerhalb des Umrisses sind gesperrt: Der Stich geht
 * nicht außen herum.
 *
 * Die Zahlen sind eine **Rangfolge**, keine Rechnung. Sie sagen: lieber eine
 * Kernbohrung und 3 m an der Wand als 6 m um eine Tür herum; lieber 40 cm
 * Umweg an der Wand als 3 m quer durchs Zimmer.
 */

import type { BimNode, Opening, Vec2, Wall } from '../types/bim';
import { closestPointOnSegment, pointInPolygon } from './geometry';
import { getWallGeometry, openingSpan } from './wallGeometry';

/** Rasterweite [m]. */
export const STICH_RASTER = 0.05;
/**
 * Kanalspur: bis zu diesem Abstand vor der Wandfläche liegt das Rohr im
 * Sockelleistenkanal (Kanaltiefe 40 mm, Rohrachse 20–75 mm vor der Wand) [m].
 */
export const STICH_KANAL = 0.075;
/** Bis zu diesem Abstand vor der Wandfläche gilt ein Punkt noch als „an der Wand" [m]. */
export const STICH_WANDNAH = 0.2;
/** Kostenfaktor zwischen Kanalspur und `STICH_WANDNAH`. */
export const STICH_NAH_FAKTOR = 1.5;
/** Kostenfaktor frei im Raum. */
export const STICH_FREI_FAKTOR = 4;
/** Zuschlag je Kernbohrung durch eine Trennwand [m Ersatzweg]. */
export const STICH_KERNBOHRUNG = 1.0;
/** Zuschlag je Durchführung unter einer Türschwelle [m Ersatzweg]. */
export const STICH_BODENDURCHFUEHRUNG = 2.0;
/** Zuschlag je Bogen [m Ersatzweg]. */
export const STICH_BOGEN = 0.3;
/** Längs in der Wand: Faktor auf die Schrittlänge. */
const IN_WAND_FAKTOR = 10;

export interface StichErgebnis {
  /** Streckenzug vom Heizkörper zum Ring, nur die Eckpunkte. */
  punkte: Vec2[];
  /** Anschlusspunkt auf dem Ring (= letzter Punkt). */
  ende: Vec2;
  /** Verlegte Länge in der Ebene [m]. */
  laenge: number;
  /** Richtungswechsel. */
  boegen: number;
  /** Durchbohrte Trennwände. */
  kernbohrungen: number;
  /** Durchführungen unter einer Türschwelle. */
  schwellen: number;
}

const enum Zelle {
  Gesperrt = 0,
  Frei = 1,
  Wand = 2,
  Tuer = 3,
}

/** Min-Heap über (Kosten, Zustand). */
class Heap {
  private k: number[] = [];
  private v: number[] = [];
  get size() { return this.k.length; }
  push(kosten: number, zustand: number) {
    const k = this.k, v = this.v;
    let i = k.length;
    k.push(kosten); v.push(zustand);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= kosten) break;
      k[i] = k[p]; v[i] = v[p]; i = p;
    }
    k[i] = kosten; v[i] = zustand;
  }
  pop(): [number, number] {
    const k = this.k, v = this.v;
    const topK = k[0], topV = v[0];
    const lk = k.pop()!, lv = v.pop()!;
    if (k.length) {
      let i = 0;
      const n = k.length;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && k[r] < k[l] ? r : l;
        if (k[c] >= lk) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = lk; v[i] = lv;
    }
    return [topK, topV];
  }
}

export function planeStich(eingabe: {
  walls: readonly Wall[];
  nodes: Record<string, BimNode>;
  openings: readonly Opening[];
  /** Gebäudeumriss über die Wandachsen. */
  umriss: readonly Vec2[];
  /** Der Ring als geschlossener Streckenzug. */
  ring: readonly Vec2[];
  /** Anschlusspunkt am Heizkörper. */
  von: Vec2;
  /**
   * Zuschlag je Ringpunkt [m]: wie viel Ring zusätzlich verlegt werden
   * müsste, damit er bis hierher reicht. Ein Stich an ein Ringstück, das
   * sonst gar nicht läge, ist nicht „kurz" — der Ring dorthin zählt mit.
   */
  zielKosten?: (p: Vec2) => number;
  raster?: number;
}): StichErgebnis | undefined {
  const { walls, nodes, openings, umriss, ring, von } = eingabe;
  const h = eingabe.raster ?? STICH_RASTER;
  if (umriss.length < 3 || ring.length < 2) return undefined;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of umriss) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  minX -= 2 * h; minY -= 2 * h; maxX += 2 * h; maxY += 2 * h;
  const nx = Math.ceil((maxX - minX) / h) + 1;
  const ny = Math.ceil((maxY - minY) / h) + 1;
  if (nx * ny > 400_000) return undefined;
  const mitte = (i: number, j: number): Vec2 => ({ x: minX + i * h, y: minY + j * h });

  const geo = walls.map((w) => getWallGeometry(w, nodes)).filter((g): g is NonNullable<typeof g> => !!g);
  const spannen = new Map<string, { from: number; to: number }[]>();
  for (const o of openings) {
    const g = geo.find((x) => x.wall.id === o.wallId);
    if (!g) continue;
    const l = spannen.get(o.wallId) ?? [];
    l.push(openingSpan(g, o));
    spannen.set(o.wallId, l);
  }

  // --- Zellen einordnen ------------------------------------------------------
  const art = new Uint8Array(nx * ny);
  /** 2 = Kanalspur, 1 = wandnah, 0 = frei im Raum. */
  const wandnah = new Uint8Array(nx * ny);
  const wandVon = new Int32Array(nx * ny).fill(-1);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const p = mitte(i, j);
      const idx = j * nx + i;
      if (!pointInPolygon(p, umriss as Vec2[])) continue;
      let zelle: Zelle = Zelle.Frei;
      let flaeche = Infinity;
      for (let k = 0; k < geo.length; k++) {
        const g = geo[k];
        const q = closestPointOnSegment(p, g.a, g.b);
        const d = Math.hypot(p.x - q.x, p.y - q.y);
        const u = (p.x - g.a.x) * g.dir.x + (p.y - g.a.y) * g.dir.y;
        const imVerlauf = u >= -g.halfThickness && u <= g.length + g.halfThickness;
        if (d <= g.halfThickness + 1e-9 && imVerlauf) {
          if (g.wall.type === 'exterior') { zelle = Zelle.Gesperrt; break; }
          const offen = (spannen.get(g.wall.id) ?? []).some((s) => u >= s.from && u <= s.to);
          if (zelle !== Zelle.Wand) zelle = offen ? Zelle.Tuer : Zelle.Wand;
          wandVon[idx] = k;
        } else {
          flaeche = Math.min(flaeche, d - g.halfThickness);
        }
      }
      art[idx] = zelle;
      if (zelle === Zelle.Frei) wandnah[idx] = flaeche <= STICH_KANAL ? 2 : flaeche <= STICH_WANDNAH ? 1 : 0;
    }
  }

  // --- Ziel: Zellen auf dem Ring -----------------------------------------------
  const ziel = new Uint8Array(nx * ny);
  const zuschlag = new Float64Array(nx * ny);
  let zieleGesamt = 0;
  for (let s = 0; s < ring.length; s++) {
    const a = ring[s];
    const b = ring[(s + 1) % ring.length];
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    const schritte = Math.max(1, Math.ceil(l / (h / 2)));
    for (let t = 0; t <= schritte; t++) {
      const x = a.x + ((b.x - a.x) * t) / schritte;
      const y = a.y + ((b.y - a.y) * t) / schritte;
      const i = Math.round((x - minX) / h);
      const j = Math.round((y - minY) / h);
      if (i < 0 || j < 0 || i >= nx || j >= ny) continue;
      const idx = j * nx + i;
      if (art[idx] === Zelle.Frei && !ziel[idx]) {
        ziel[idx] = 1;
        zieleGesamt++;
        zuschlag[idx] = eingabe.zielKosten ? Math.max(0, eingabe.zielKosten({ x, y })) : 0;
      }
    }
  }
  if (!zieleGesamt) return undefined;

  // --- Start -----------------------------------------------------------------
  let si = Math.round((von.x - minX) / h);
  let sj = Math.round((von.y - minY) / h);
  if (si < 0 || sj < 0 || si >= nx || sj >= ny || art[sj * nx + si] !== Zelle.Frei) {
    // Der Anschlusspunkt kann eine Rasterzelle in der Wand liegen: die
    // nächste freie Zelle im Umkreis von 0,3 m nehmen.
    let beste = -1, bd = Infinity;
    const r = Math.ceil(0.3 / h);
    for (let dj = -r; dj <= r; dj++) {
      for (let di = -r; di <= r; di++) {
        const i = si + di, j = sj + dj;
        if (i < 0 || j < 0 || i >= nx || j >= ny) continue;
        if (art[j * nx + i] !== Zelle.Frei) continue;
        const d = di * di + dj * dj;
        if (d < bd) { bd = d; beste = j * nx + i; }
      }
    }
    if (beste < 0) return undefined;
    si = beste % nx; sj = Math.floor(beste / nx);
  }

  // --- Dijkstra über (Zelle, Richtung) ---------------------------------------
  const DI = [1, 0, -1, 0];
  const DJ = [0, 1, 0, -1];
  const n = nx * ny;
  const kosten = new Float64Array(n * 4).fill(Infinity);
  const vor = new Int32Array(n * 4).fill(-1);
  const heap = new Heap();
  const start = sj * nx + si;
  for (let d = 0; d < 4; d++) { kosten[start * 4 + d] = 0; heap.push(0, start * 4 + d); }
  let gefunden = -1;
  let bestesGesamt = Infinity;
  while (heap.size) {
    const [c, z] = heap.pop();
    if (c > kosten[z]) continue;
    // Ab hier kann kein Weg mehr samt Zuschlag das Beste schlagen.
    if (c >= bestesGesamt) break;
    const idx = z >> 2, d0 = z & 3;
    if (ziel[idx] && idx !== start) {
      const gesamt = c + zuschlag[idx];
      if (gesamt < bestesGesamt) { bestesGesamt = gesamt; gefunden = z; }
      continue;
    }
    const i0 = idx % nx, j0 = (idx - i0) / nx;
    for (let d = 0; d < 4; d++) {
      if (d === ((d0 + 2) & 3) && idx !== start) continue;
      const i = i0 + DI[d], j = j0 + DJ[d];
      if (i < 0 || j < 0 || i >= nx || j >= ny) continue;
      const nidx = j * nx + i;
      const a = art[nidx];
      if (a === Zelle.Gesperrt) continue;
      const aVor = art[idx];
      let schritt: number;
      if (a === Zelle.Frei) {
        schritt = h * (wandnah[nidx] === 2 ? 1 : wandnah[nidx] === 1 ? STICH_NAH_FAKTOR : STICH_FREI_FAKTOR);
      } else if (aVor === Zelle.Frei) {
        schritt = h + (a === Zelle.Tuer ? STICH_BODENDURCHFUEHRUNG : STICH_KERNBOHRUNG);
      } else {
        // Weiter in der Wand: quer ist billig, längs gesperrt.
        const g = geo[wandVon[nidx]] ?? geo[wandVon[idx]];
        const quer = g ? Math.abs(DI[d] * g.normal.x + DJ[d] * g.normal.y) > 0.7 : true;
        schritt = quer ? h : h * IN_WAND_FAKTOR;
      }
      if (d !== d0 && idx !== start) schritt += STICH_BOGEN;
      const nz = nidx * 4 + d;
      const nc = c + schritt;
      if (nc < kosten[nz] - 1e-12) {
        kosten[nz] = nc;
        vor[nz] = z;
        heap.push(nc, nz);
      }
    }
  }
  if (gefunden < 0) return undefined;

  // --- Weg zurückverfolgen -----------------------------------------------------
  const zellen: number[] = [];
  for (let z = gefunden; z >= 0; z = vor[z]) zellen.push(z >> 2);
  zellen.reverse();
  const roh = zellen.map((idx) => mitte(idx % nx, Math.floor(idx / nx)));

  // Anschlusspunkt auf dem Ring: der Lotfußpunkt der letzten Zelle.
  const letzte = roh[roh.length - 1];
  let ende = letzte, bd = Infinity;
  for (let s = 0; s < ring.length; s++) {
    const q = closestPointOnSegment(letzte, ring[s], ring[(s + 1) % ring.length]);
    const d = Math.hypot(q.x - letzte.x, q.y - letzte.y);
    if (d < bd) { bd = d; ende = q; }
  }

  // Nur die Ecken behalten.
  const ecken: Vec2[] = [roh[0]];
  for (let k = 1; k < roh.length - 1; k++) {
    const a = roh[k - 1], b = roh[k], c = roh[k + 1];
    const gerade = Math.abs((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)) < 1e-9;
    if (!gerade) ecken.push(b);
  }
  ecken.push(roh[roh.length - 1]);

  // Enden auf die echten Punkte setzen und das jeweils anliegende Stück
  // achsparallel halten: die erste/letzte Ecke rückt mit.
  const setzeEnde = (liste: Vec2[], vorne: boolean, p: Vec2) => {
    const k = vorne ? 0 : liste.length - 1;
    const nb = vorne ? 1 : liste.length - 2;
    if (nb >= 0 && nb < liste.length && liste.length > 2) {
      const alt = liste[k], nachbar = liste[nb];
      if (Math.abs(alt.x - nachbar.x) < 1e-9) liste[nb] = { x: p.x, y: nachbar.y };
      else if (Math.abs(alt.y - nachbar.y) < 1e-9) liste[nb] = { x: nachbar.x, y: p.y };
    }
    liste[k] = p;
  };
  setzeEnde(ecken, true, { ...von });
  // Das letzte Stück läuft achsparallel auf den Ring zu: den Fußpunkt auf
  // dem Ring in Verlängerung der vorletzten Ecke suchen, nicht neben ihr —
  // sonst endet ein gerader Stich um eine halbe Rasterzelle schief.
  {
    const vorletzte = ecken.length > 1 ? ecken[ecken.length - 2] : ecken[0];
    const senkrecht = Math.abs(letzte.x - vorletzte.x) < Math.abs(letzte.y - vorletzte.y);
    const probe = senkrecht ? { x: vorletzte.x, y: ende.y } : { x: ende.x, y: vorletzte.y };
    let beste = ende, d0 = Infinity;
    for (let s = 0; s < ring.length; s++) {
      const q = closestPointOnSegment(probe, ring[s], ring[(s + 1) % ring.length]);
      const d = Math.hypot(q.x - probe.x, q.y - probe.y);
      if (d < d0) { d0 = d; beste = q; }
    }
    if (d0 < h) ende = beste;
  }
  setzeEnde(ecken, false, ende);
  const punkte = ecken.filter((p, k) => k === 0 || Math.hypot(p.x - ecken[k - 1].x, p.y - ecken[k - 1].y) > 1e-6);

  let laenge = 0;
  for (let k = 1; k < punkte.length; k++) laenge += Math.hypot(punkte[k].x - punkte[k - 1].x, punkte[k].y - punkte[k - 1].y);

  // Wände und Schwellen auf dem Weg zählen: jeder Eintritt aus dem Freien.
  let kernbohrungen = 0, schwellen = 0;
  for (let k = 1; k < zellen.length; k++) {
    const a = art[zellen[k - 1]], b = art[zellen[k]];
    if (a === Zelle.Frei && b === Zelle.Wand) kernbohrungen++;
    if (a === Zelle.Frei && b === Zelle.Tuer) schwellen++;
  }

  return { punkte, ende, laenge, boegen: Math.max(0, punkte.length - 2), kernbohrungen, schwellen };
}
