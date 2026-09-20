/**
 * Geschossdecken — die Platte zwischen zwei Geschossen.
 * ---------------------------------------------------------------------------
 * Bis 1.11.0 hob `levelBaseHeights` jedes Geschoss auf seine Höhe, und genau
 * dort entstand der Fehler, den man erst im Bild sieht: zwischen der Oberkante
 * der Wände eines Geschosses und der Unterkante des nächsten klaffte die
 * Deckenstärke als **Luft**. Das Haus stand in Scheiben übereinander.
 *
 * Die Platte gehört damit in dieselbe Rechnung wie die Höhenlage — nicht in
 * den Zeichenpfad. Dieses Modul liefert die Grundrisse der Decken als reine
 * Polygone; ob daraus ein Extrusionskörper in Three.js oder eine Schraffur im
 * Schnitt wird, entscheidet die Ansicht.
 *
 * Aufbau einer Deckenfläche:
 *
 *  • **Umriss** — die Achspolygone der Räume *plus* die Grundflächen aller
 *    Wände. Nur die Räume genügen nicht: das Achspolygon endet in der
 *    Wandmitte, die äußere Hälfte der Außenwand bliebe unbedeckt und die
 *    Decke endete sichtbar hinter der Fassade.
 *  • **Aussparungen** — Treppen und Schächte durchdringen die Decke. Wer die
 *    Öffnung wegläßt, deckelt sein Treppenhaus zu.
 *
 * Die Flächen dürfen sich überlappen (Raum und Wand tun das zwangsläufig).
 * Eine echte Vereinigung der Polygone wäre erheblich mehr Code für dasselbe
 * Bild: die Platten sind undurchsichtig, sie liegen in einer Ebene, und
 * Überlappung ist bei einem Volumenkörper folgenlos.
 */

import type { BimNode, Durchbruch, Level, Room, Vec2, VerticalElement, Wall } from '../types/bim';
import { durchbruchWirt } from '../types/bim';
import { deckendurchbruchUmriss } from './durchbruchSymbols';
import { getWallGeometry } from './wallGeometry';
import { verticalCorners } from './verticalSymbols';
import { DEFAULT_LEVEL_HEIGHT } from './levelGeometry';
import { polygonArea, pointInPolygon } from './geometry';

/**
 * Eine Deckenplatte über einem Geschoss.
 *
 * `top` ist die Oberkante — der Rohfußboden des darüberliegenden Geschosses.
 * Die Platte hängt also unter dem nächsten Geschoss, nicht über dem eigenen:
 * genau so, wie sie gebaut wird.
 */
export interface SlabPlan {
  /** Geschoss, über dem die Platte liegt. */
  levelId: string;
  /** Oberkante der Platte [m] über dem Bezugspunkt. */
  top: number;
  /**
   * Unterkante der Platte [m] — die Oberkante der Wände darunter.
   *
   * **Der Wert steht hier, damit ihn niemand mehr ausrechnen muss.** In 1.12.0
   * gab es nur `top` und `thickness`, und der Zeichenpfad zog die Differenz
   * selbst ab — beziehungsweise eben nicht: `ExtrudeGeometry` extrudiert nach
   * der Kippung in die Grundrissebene **nach oben**, nicht nach unten. Die
   * Platte saß dadurch eine volle Plattenstärke zu hoch: die Lücke zwischen
   * Wandoberkante und nächstem Geschoss blieb offen, und die Platte ragte
   * statt dessen 25 cm in das Geschoss darüber hinein. Der Fehler war im
   * Kommentar sogar beschrieben — „von ihrer Oberkante nach unten extrudiert"
   * —, nur stimmte die Beschreibung nicht mit dem, was die Bibliothek tut.
   *
   * Es gilt immer `bottom + thickness === top`. Wer zeichnet, nimmt `bottom`.
   */
  bottom: number;
  /** Plattenstärke [m]. */
  thickness: number;
  /** Umrisspolygone (dürfen sich überlappen). */
  outlines: Vec2[][];
  /** Aussparungen (Treppenauge, Schacht). */
  holes: Vec2[][];
  /**
   * Bodenplatte statt Geschossdecke?
   *
   * Sie liegt **unter** dem Geschoss, das sie nennt, nicht darüber — der
   * einzige Fall, in dem `levelId` das Geschoss über der Platte bezeichnet.
   * Deshalb steht das Merkmal hier und wird nicht aus der Lage geraten.
   */
  ground?: boolean;
  /**
   * Oberste Geschossdecke — der obere Raumabschluss des höchsten Geschosses.
   *
   * Sie wird gesondert gekennzeichnet, weil die Ansicht anders mit ihr
   * umgeht als mit einer Decke zwischen zwei Geschossen: Von oben auf das
   * Haus zu schauen und nur den Deckel zu sehen, hilft niemandem. Die
   * Umlaufansicht blendet sie deshalb aus, solange die Kamera über ihr
   * steht; in der begehbaren Ansicht steht sie immer.
   */
  oberste?: boolean;
}

/**
 * Stärke der Bodenplatte [m].
 *
 * 25 cm Stahlbeton mit Perimeterdämmung ist die Größenordnung, in der eine
 * Bodenplatte im Wohnungsbau ausgeführt wird. Sie ist eine Annahme dieses
 * Programms und geht in keine Rechnung ein — sie schließt das Modell nach
 * unten, mehr nicht. Der U-Wert des Bodens steht am Geschoss und wird davon
 * nicht berührt.
 */
export const GROUND_SLAB = 0.25;

/** Kleinste Plattenstärke, die noch gezeichnet wird [m]. */
const MIN_THICKNESS = 0.02;

/**
 * Überstand der Deckenplatte über die Wandaußenkante [m].
 *
 * Null wäre geometrisch richtig, führt aber zu Z-Fighting zwischen
 * Deckenkante und Wandfläche. Ein Millimeter ist im Modell unsichtbar und
 * beendet das Flimmern.
 */
const OVERSHOOT = 0.001;

/** Grundfläche einer Wand als Rechteck. */
function wallFootprint(wall: Wall, nodes: Record<string, BimNode>): Vec2[] | null {
  const g = getWallGeometry(wall, nodes);
  if (!g) return null;
  const h = g.halfThickness + OVERSHOOT;
  const n = g.normal;
  return [
    { x: g.a.x + n.x * h, y: g.a.y + n.y * h },
    { x: g.b.x + n.x * h, y: g.b.y + n.y * h },
    { x: g.b.x - n.x * h, y: g.b.y - n.y * h },
    { x: g.a.x - n.x * h, y: g.a.y - n.y * h },
  ];
}

export interface SlabInput {
  levels: readonly Level[];
  rooms: readonly Room[];
  walls: readonly Wall[];
  nodes: Record<string, BimNode>;
  verticals: readonly VerticalElement[];
  /**
   * Durchbrüche. Nur die Deckendurchbrüche wirken hier — ein Wanddurchbruch
   * ist ein Loch in der Wand und nicht in der Platte.
   */
  durchbrueche?: readonly Durchbruch[];
  /** Höhenlage je Geschoss aus `levelBaseHeights`. */
  base: Map<string, number>;
}

/**
 * Deckenplatten zwischen den Geschossen.
 *
 * Eine Platte entsteht nur dort, wo tatsächlich ein Geschoss darüber steht.
 * Über dem obersten Geschoss endet das Haus — dort sitzt das Dach, und eine
 * Platte darin würde im Dachraum schweben.
 */
export function levelSlabs(input: SlabInput): SlabPlan[] {
  const sortiert = [...input.levels].sort((a, b) => a.order - b.order);
  const platten: SlabPlan[] = [];

  for (let i = 0; i < sortiert.length - 1; i++) {
    const unten = sortiert[i];
    const oben = sortiert[i + 1];
    const basisUnten = input.base.get(unten.id) ?? 0;
    const basisOben = input.base.get(oben.id) ?? 0;
    // Derselbe Vorgabewert wie in `levelBaseHeights` — und zwar zwingend
    // derselbe: dort wird mit ihm gestapelt, hier wird er wieder abgezogen.
    // Liefen die beiden Zahlen auseinander, klaffte die Deckenlücke erneut,
    // und niemand sähe warum. Deshalb der Import statt eines zweiten Literals.
    const lichte =
      Number.isFinite(unten.height) && unten.height > 0 ? unten.height : DEFAULT_LEVEL_HEIGHT;
    const oberkante = basisOben;
    const staerke = oberkante - (basisUnten + lichte);
    // Negativ heißt: die Geschosse überschneiden sich (von Hand gesetzte
    // Höhenlagen). Dann ist keine Platte die ehrlichere Antwort.
    if (!Number.isFinite(staerke) || staerke < MIN_THICKNESS) continue;

    const outlines: Vec2[][] = [];
    for (const r of input.rooms) {
      if (r.levelId !== unten.id) continue;
      if (r.polygon.length >= 3) outlines.push(r.polygon);
    }
    for (const w of input.walls) {
      if (w.levelId !== unten.id) continue;
      const f = wallFootprint(w, input.nodes);
      if (f) outlines.push(f);
    }
    if (!outlines.length) continue;

    const holes: Vec2[][] = [];
    for (const v of input.verticals) {
      // Ein Bauteil durchdringt die Decke *über* dem Geschoss, in dem es
      // beginnt. Ein Schacht, der weiter nach oben läuft, durchdringt jede
      // Decke bis zu seinem Zielgeschoss.
      if (!durchdringt(v, unten.id, sortiert)) continue;
      const ecken = verticalCorners(v);
      if (ecken.length >= 3) holes.push(ecken);
    }
    // Deckendurchbrüche schneiden dieselbe Platte. Sie gehören dem Geschoss
    // **unter** der Decke — deshalb `unten.id` und nicht `oben.id`; genau die
    // Verwechslung liefe sonst ein Geschoss zu hoch, und zwar unbemerkt, weil
    // in beiden Fällen ein Loch entsteht.
    for (const db of input.durchbrueche ?? []) {
      if (db.levelId !== unten.id) continue;
      if (durchbruchWirt(db.kind) !== 'decke') continue;
      const ecken = deckendurchbruchUmriss(db);
      if (ecken.length >= 3) holes.push(ecken);
    }

    platten.push({
      levelId: unten.id,
      top: oberkante,
      bottom: oberkante - staerke,
      thickness: staerke,
      outlines,
      holes,
    });
  }

  return platten;
}

/**
 * Stärke der obersten Geschossdecke [m].
 *
 * Sie ist keine Tragdecke wie die zwischen zwei Geschossen, sondern der
 * obere Raumabschluss: Rohdecke plus Dämmung im Deckenaufbau. 20 cm ist der
 * Wert, der im Bestand am häufigsten danebenliegt und am seltensten weit
 * daneben — und er ist hier nur eine **Darstellungsgröße**. In die Heizlast
 * geht nicht diese Stärke ein, sondern `level.ceilingUValue`; das Bauteil
 * hier macht den Raum im Bild zu einem Raum und sonst nichts.
 */
export const TOP_SLAB = 0.2;

/**
 * Die oberste Geschossdecke — der Deckel, den das Modell bisher nicht hatte.
 *
 * **Warum sie in `levelSlabs` fehlt und hier steht.** `levelSlabs` legt eine
 * Platte nur dort, wo tatsächlich ein Geschoss darüber steht; über dem
 * obersten endet das Haus. Das ist für die *Trag*decke richtig — aber es
 * hat zur Folge, dass ein eingeschossiges Haus im Modell nach oben offen
 * ist. In der begehbaren Ansicht steht man dann in einem Zimmer ohne Decke
 * und sieht in den Nachthimmel; das ist kein Schönheitsfehler, sondern der
 * Grund, warum Räume dort nicht wie Räume wirken.
 *
 * Sie bekommt **dieselben Aussparungen** wie eine Geschossdecke: Ein
 * Schacht, der über das oberste Geschoss hinausläuft, und ein
 * Deckendurchbruch im obersten Geschoss durchstoßen auch sie. Nur der
 * Treppenlauf, der nirgendwo hinführt, tut es nicht — er hat kein
 * Zielgeschoss über sich und wird von `durchdringt` folgerichtig nicht
 * gemeldet.
 *
 * **Warum sie eine eigene Funktion ist und keine Option.** `levelSlabs`
 * gibt eine Zusage, an der ein Prüfblock hängt: Zahl der Platten =
 * Geschosse − 1. Ein Schalter, der diese Zahl manchmal um eins erhöht,
 * machte die Zusage unprüfbar. Getrennte Funktion, getrennte Zusage —
 * dieselbe Überlegung wie bei `groundSlab`.
 */
export function topSlab(input: SlabInput): SlabPlan | undefined {
  const sortiert = [...input.levels].sort((a, b) => a.order - b.order);
  const oberstes = sortiert[sortiert.length - 1];
  if (!oberstes) return undefined;

  const basis = input.base.get(oberstes.id) ?? 0;
  const lichte =
    Number.isFinite(oberstes.height) && oberstes.height > 0 ? oberstes.height : DEFAULT_LEVEL_HEIGHT;
  const unterkante = basis + lichte;

  const outlines: Vec2[][] = [];
  for (const r of input.rooms) {
    if (r.levelId !== oberstes.id) continue;
    if (r.polygon.length >= 3) outlines.push(r.polygon);
  }
  for (const w of input.walls) {
    if (w.levelId !== oberstes.id) continue;
    const f = wallFootprint(w, input.nodes);
    if (f) outlines.push(f);
  }
  if (!outlines.length) return undefined;

  const holes: Vec2[][] = [];
  for (const v of input.verticals) {
    if (!durchdringt(v, oberstes.id, sortiert)) continue;
    const ecken = verticalCorners(v);
    if (ecken.length >= 3) holes.push(ecken);
  }
  for (const db of input.durchbrueche ?? []) {
    if (db.levelId !== oberstes.id) continue;
    if (durchbruchWirt(db.kind) !== 'decke') continue;
    const ecken = deckendurchbruchUmriss(db);
    if (ecken.length >= 3) holes.push(ecken);
  }

  return {
    levelId: oberstes.id,
    top: unterkante + TOP_SLAB,
    bottom: unterkante,
    thickness: TOP_SLAB,
    outlines,
    holes,
    oberste: true,
  };
}

/**
 * Die Bodenplatte unter dem untersten Geschoss.
 *
 * Ohne sie steht das Haus im Modell buchstäblich in der Luft: die Wände
 * beginnen bei null, darunter ist nichts, und von schräg unten sieht man durch
 * den Grundriss hindurch. Es ist derselbe Mangel wie die Deckenlücke, nur an
 * der anderen Seite — die Rechnung stimmte, das Bauteil fehlte.
 *
 * Sie steht bewusst **nicht** in `levelSlabs`: eine Bodenplatte ist keine
 * Geschossdecke. Sie liegt unter dem Geschoss statt darüber, sie bekommt keine
 * Aussparungen (ein Treppenauge im Erdreich wäre ein Loch ins Nichts), und die
 * Zusage „Zahl der Platten = Geschosse − 1" bliebe sonst nicht bestehen.
 */
export function groundSlab(input: SlabInput): SlabPlan | undefined {
  const sortiert = [...input.levels].sort((a, b) => a.order - b.order);
  const unterstes = sortiert[0];
  if (!unterstes) return undefined;

  const oberkante = input.base.get(unterstes.id) ?? 0;
  const outlines: Vec2[][] = [];
  for (const r of input.rooms) {
    if (r.levelId !== unterstes.id) continue;
    if (r.polygon.length >= 3) outlines.push(r.polygon);
  }
  for (const w of input.walls) {
    if (w.levelId !== unterstes.id) continue;
    const f = wallFootprint(w, input.nodes);
    if (f) outlines.push(f);
  }
  if (!outlines.length) return undefined;

  return {
    levelId: unterstes.id,
    top: oberkante,
    bottom: oberkante - GROUND_SLAB,
    thickness: GROUND_SLAB,
    outlines,
    holes: [],
    ground: true,
  };
}

/** Durchdringt das Bauteil die Decke über `levelId`? */
function durchdringt(v: VerticalElement, levelId: string, sortiert: readonly Level[]): boolean {
  const start = sortiert.findIndex((l) => l.id === v.levelId);
  if (start < 0) return false;
  const decke = sortiert.findIndex((l) => l.id === levelId);
  if (decke < start) return false;
  // Ohne Zielgeschoss endet das Bauteil im nächsthöheren Geschoss — es
  // durchdringt also genau eine Decke.
  if (!v.toLevelId) return decke === start;
  const ziel = sortiert.findIndex((l) => l.id === v.toLevelId);
  if (ziel < 0) return decke === start;
  return decke >= start && decke < ziel;
}

/**
 * Liegt die Aussparung innerhalb des Umrisses?
 *
 * Three.js hängt Löcher an *eine* Kontur. Ein Treppenauge, das gar nicht im
 * betrachteten Raumpolygon liegt, würde dort ein Loch ins Nichts schneiden.
 */
export function holeFitsOutline(hole: readonly Vec2[], outline: readonly Vec2[]): boolean {
  if (hole.length < 3 || outline.length < 3) return false;
  return hole.every((p) => pointInPolygon(p, outline));
}

/** Gesamtfläche aller Platten [m²] — für Prüfung und Massenauszug. */
export function slabArea(plan: SlabPlan): number {
  let flaeche = 0;
  for (const p of plan.outlines) flaeche += Math.abs(polygonArea(p));
  for (const h of plan.holes) flaeche -= Math.abs(polygonArea(h));
  return Math.max(0, flaeche);
}
