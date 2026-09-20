/**
 * Mehrere Dächer über einem Geschoss — die Dachlandschaft.
 * ---------------------------------------------------------------------------
 * **Der Befund, auf den dieses Modul antwortet.** Bis 1.35.0 trug ein
 * Geschoss genau ein Dach, und das lag über dem ganzen Grundriss. Beim
 * Rechteckhaus stimmt das. Beim L-Haus deckt es den Hauptbau, und der Flügel
 * steht ohne Dach da — im Modell als offene Schnittfläche an der Kante zu
 * sehen. Das Dach zu **drehen** hilft nicht: Es verschiebt das Problem auf
 * den anderen Flügel. Ein L-Haus braucht je Flügel ein Dach.
 *
 * **Die tragende Regel, und sie kommt nicht aus der Geometrie:**
 *
 *     Wo ein Geschoss darüberliegt, ist kein Dach, sondern eine Decke.
 *
 * Sie lässt sich nicht aus dem Grundriss ableiten, weil der Grundriss nichts
 * über das Geschoss darüber weiß. Sie muss deshalb doppelt abgesichert sein:
 * Der **Vorschlag** für ein neues Dach lässt Räume weg, über denen ein Raum
 * liegt (`raeumeOhneGeschossDarueber`), und die **Prüfung** meldet es, wenn
 * doch einer darin steht. Vorschlagen und Prüfen, nicht Erzwingen — wer ein
 * Vordach über einem Erker zeichnet, hat einen Grund, den dieses Modul nicht
 * kennt.
 *
 * **Warum ein Dach über Räume festgelegt wird und nicht über einen Umriss.**
 * Ein gezeichneter Umriss liefe entlang derselben Wände ein zweites Mal — und
 * stünde beim nächsten Verschieben einer Wand daneben, ohne dass es jemand
 * merkte. Über Räume hängt das Dach an der Geometrie und wandert mit.
 *
 * **Was dieses Modul nicht tut: die Kehle rechnen.** Wo zwei Dachflächen
 * aufeinandertreffen, entsteht im Bau eine Kehle. Hier stehen die beiden
 * Dachkörper nebeneinander, jeder über seinem eigenen Umriss; sie schneiden
 * sich, und die Schnittkante *ist* die Kehle. Ein eigener Kehlbalken, eine
 * Kehlrinne, ein Anschlussblech sind Ausführung und kein Aufmaß — sie
 * gehören nicht in ein Werkzeug, das Flächen für die Heizlast liefert.
 *
 * Schichtgrenze: nur `types` und andere `lib`-Bausteine.
 */

import type { BimNode, Level, RoofDefinition, RoofOpening, Room, Vec2, Wall } from '../types/bim';
import { buildRoofFrame, type RoofFrame } from './roofGeometry';
import { gebaeudeUmriss } from './roomDetection';
import { pointInPolygon } from './geometry';

/** Ein Dach mit dem Gerüst, das aus ihm und seinem Gebäudeteil entsteht. */
export interface Dachteil {
  roof: RoofDefinition;
  /** `null`, wenn sich aus den Räumen kein brauchbarer Umriss ergibt. */
  frame: RoofFrame | null;
  /** Die Räume, über denen es sitzt — leer heißt „das ganze Geschoss". */
  roomIds: string[];
  /**
   * Die Achspolygone der zugewiesenen Räume.
   *
   * **Warum die Zugehörigkeit hieran hängt und nicht am Umriss des Gerüsts.**
   * Der erste Versuch bildete den Umriss aus den Wandkennungen der
   * Raumränder. Das schlug fehl, und zwar lehrreich: `simplifyPolygon` fasst
   * kollineare Kanten zu **einer** zusammen, und `findWallForEdge` ordnet
   * dieser einen Kante genau **eine** Wand zu. Beim L-Haus verlor der
   * Hauptbau damit die Trennwand zum Flügel — seine Wandmenge schloss nicht
   * mehr, `gebaeudeUmriss` lieferte null Punkte, und ein Gerüst ohne Umriss
   * gilt für das ganze Geschoss. Damit deckten beide Dächer wieder alles,
   * und der ganze Umbau war wirkungslos.
   *
   * Die Raumpolygone haben dieses Problem nicht: Sie sind die Fläche selbst,
   * nicht ihre Beschreibung über ein zweites Bauteil.
   */
  polygone: Vec2[][];
}

/**
 * Die Dächer eines Geschosses — in einer Form, mit der sich rechnen lässt.
 *
 * **Warum eine Funktion und kein Feldzugriff.** `Level.roof` (ein Dach) und
 * `Level.roofs` (mehrere) stehen nebeneinander, damit jedes vor 1.36.0
 * gespeicherte Projekt ohne Wandlung aufgeht. Läse jede Stelle selbst, gäbe
 * es zwei Dutzend Orte, an denen jemand `level.roof` schreibt und damit beim
 * L-Haus nur den ersten Flügel sieht. Hier ist die eine Stelle.
 */
export function daecherVon(level: Level | undefined): RoofDefinition[] {
  if (!level) return [];
  if (level.roofs && level.roofs.length) {
    return level.roofs.map((r, i) => ({ ...r, id: r.id ?? `dach-${i + 1}` }));
  }
  if (level.roof) return [{ ...level.roof, id: level.roof.id ?? 'dach-1' }];
  return [];
}

/** Trägt das Geschoss überhaupt ein geneigtes Dach? */
export function hatDach(level: Level | undefined): boolean {
  return daecherVon(level).some((r) => r.kind !== 'flat');
}

export interface LandschaftEingabe {
  level: Level | undefined;
  walls: Wall[];
  nodes: Record<string, BimNode>;
  rooms: readonly Room[];
  roofOpenings?: RoofOpening[];
}

/**
 * Die Wände, die zu einer Raumauswahl gehören.
 *
 * Genommen werden die Wandabschnitte der Raumränder — nicht etwa alle Wände
 * in der Nähe. Ein Dach über dem Nordflügel soll den Umriss des Nordflügels
 * bekommen und nicht den des ganzen Hauses, nur weil eine Wand zufällig
 * hineinragt.
 */
function waendeFuerRaeume(
  roomIds: readonly string[],
  rooms: readonly Room[],
  walls: Wall[],
): Wall[] {
  if (!roomIds.length) return walls;
  const gesucht = new Set(roomIds);
  const wandIds = new Set<string>();
  for (const r of rooms) {
    if (!gesucht.has(r.id)) continue;
    for (const b of r.boundaries) wandIds.add(b.wallId);
  }
  return walls.filter((w) => wandIds.has(w.id));
}

/**
 * Die Dachlandschaft eines Geschosses bauen.
 *
 * Jedes Dach bekommt **sein eigenes** Gerüst über **seinem** Gebäudeteil.
 * Damit stimmen Firstlage, Traufhöhe und Spannweite je Flügel — und nicht
 * einmal gemittelt über ein Haus, das es so nicht gibt.
 */
export function baueDachlandschaft(eingabe: LandschaftEingabe): Dachteil[] {
  const { level, walls, nodes, rooms } = eingabe;
  const oeffnungen = eingabe.roofOpenings ?? [];
  const teile: Dachteil[] = [];

  for (const roof of daecherVon(level)) {
    const roomIds = roof.roomIds ?? [];
    const teilWaende = waendeFuerRaeume(roomIds, rooms, walls);
    const punkte: Vec2[] = [];
    for (const w of teilWaende) {
      const a = nodes[w.a];
      const b = nodes[w.b];
      if (a) punkte.push({ x: a.x, y: a.y });
      if (b) punkte.push({ x: b.x, y: b.y });
    }
    /*
     * Die Flächen dieses Dachs. Ohne Raumauswahl sind es alle Räume des
     * Geschosses — der Zustand eines Projekts von vor 1.36.0.
     */
    const gesucht = new Set(roomIds);
    const polygone = rooms
      .filter((r) => !roomIds.length || gesucht.has(r.id))
      .map((r) => (r.polygon.length >= 3 ? r.polygon : r.innerPolygon))
      .filter((p) => p.length >= 3);

    /*
     * Der geordnete Umriss für die Dachgeometrie. Er entscheidet über Grat
     * und Kehle beim Walmdach; gelingt er nicht, rechnet `buildRoofFrame`
     * auf dem umschließenden Rechteck der übergebenen Punkte — und das ist
     * je **Flügel** immer noch richtig, weil die Punkte nur aus diesem
     * Flügel stammen. Der Rückfall ist also nicht mehr der alte Fehler
     * („Walmdach über der Bounding Box des ganzen Hauses"), sondern ein
     * Walmdach über der Bounding Box eines Flügels.
     */
    const umriss = gebaeudeUmriss(teilWaende, nodes);
    // Als Punktwolke die Ecken der Räume, nicht die Wandknoten: Eine Wand,
    // die an beide Flügel grenzt, brächte sonst Punkte des anderen mit.
    const eckPunkte = roomIds.length ? polygone.flat() : punkte;
    const frame =
      eckPunkte.length >= 3 ? buildRoofFrame(roof, eckPunkte, oeffnungen, umriss) : null;
    teile.push({ roof, frame, roomIds, polygone });
  }
  return teile;
}

/**
 * Welcher Dachteil deckt diesen Punkt?
 *
 * **Warum der Umriss entscheidet und nicht die Nähe.** `roofHeightAt`
 * rechnet für jeden Punkt eine Höhe aus, auch weit außerhalb — die Ebene
 * hört ja nicht auf. Ein Dach über dem Nordflügel lieferte damit auch über
 * dem Wohnzimmer eine Zahl, und zwar eine falsche. Gefragt wird deshalb
 * zuerst, ob der Punkt überhaupt unter diesem Dach liegt.
 *
 * Liegt er unter mehreren — zwei Dächer, die sich überlappen —, gewinnt das
 * **zuerst eingetragene**. Das ist keine Physik, sondern eine
 * Reproduzierbarkeitsregel: Zwei sich überlappende Dächer sind ein
 * Eingabefehler, den die Prüfung meldet; bis dahin soll wenigstens jedes
 * Bild dasselbe zeigen.
 */
export function dachteilAn(teile: readonly Dachteil[], p: Vec2): Dachteil | undefined {
  for (const t of teile) {
    if (!t.frame) continue;
    // Ohne zugewiesene Räume gilt das Dach für das ganze Geschoss — der
    // Zustand eines Projekts von vor 1.36.0.
    if (!t.roomIds.length) return t;
    if (t.polygone.some((poly) => imUmriss(p, poly))) return t;
  }
  return undefined;
}

/**
 * Punkt im Umriss — mit einem Zentimeter Nachsicht zur Kante hin.
 *
 * **Warum die Nachsicht nötig ist.** Viele der Punkte, die hier gefragt
 * werden, liegen auf dem Umriss statt darin: eine Wandmitte, ein Eckknoten,
 * der Mittelpunkt einer Randwand. Die Wände *sind* der Umriss. Genau dort
 * ist `pointInPolygon` nicht definiert, und das ist keine Theorie — beim
 * Rechteckhaus galt damit die Westwand als drinnen und die Ostwand als
 * draußen. Dasselbe Haus, dieselbe Lage, zwei Antworten.
 *
 * Gerückt wird zur Mitte des Umrisses, weil das die einzige Richtung ist,
 * die ohne Kenntnis der Kante immer nach innen zeigt. Ein Zentimeter ist
 * weniger als jede Wandstärke und mehr als jede Rundung.
 */
function imUmriss(p: Vec2, umriss: readonly Vec2[]): boolean {
  let sx = 0;
  let sy = 0;
  for (const q of umriss) {
    sx += q.x;
    sy += q.y;
  }
  const dx = sx / umriss.length - p.x;
  const dy = sy / umriss.length - p.y;
  const l = Math.hypot(dx, dy);
  const innen = l > 1e-9 ? { x: p.x + (dx / l) * 0.01, y: p.y + (dy / l) * 0.01 } : p;
  return pointInPolygon(innen, umriss);
}

/** Das Gerüst über einem Punkt — oder `null`, wenn dort kein Dach sitzt. */
export function frameAn(teile: readonly Dachteil[], p: Vec2): RoofFrame | null {
  return dachteilAn(teile, p)?.frame ?? null;
}

/**
 * Das Gerüst über einem Raum.
 *
 * Gefragt wird am **Schwerpunkt des Raumpolygons**, nicht an einer Ecke: Eine
 * Ecke liegt in der Wand und damit je nach Rundung mal innerhalb, mal
 * außerhalb des Umrisses. Ein Raum, der unter zwei Dächern liegt, bekommt
 * das, unter dem seine Mitte liegt — genauer wird es erst, wenn die Fläche
 * geteilt wird, und eine geteilte Raumhöhe ist keine Größe, die die Norm
 * kennt.
 */
export function frameFuerRaum(teile: readonly Dachteil[], room: Room): RoofFrame | null {
  const poly = room.innerPolygon.length >= 3 ? room.innerPolygon : room.polygon;
  if (poly.length < 3) return null;
  let sx = 0;
  let sy = 0;
  for (const p of poly) {
    sx += p.x;
    sy += p.y;
  }
  return frameAn(teile, { x: sx / poly.length, y: sy / poly.length });
}

/**
 * Räume, über denen **kein** Geschoss liegt — der Vorschlag für ein neues Dach.
 *
 * **Die Regel in Code.** Geprüft wird der Schwerpunkt jedes Raums gegen die
 * Raumpolygone des Geschosses darüber. Liegt er in einem davon, ist dort
 * eine Decke und kein Dach.
 *
 * **Warum das nur ein Vorschlag ist.** Ein Vordach über einem Erker, ein
 * Pultdach über einem Anbau, der an das Obergeschoss stößt — es gibt Fälle,
 * in denen ein Dach unter einem Geschoss richtig ist. Das Programm schlägt
 * vor; entschieden wird vom Planer, und die Prüfung sagt es, wenn der
 * Vorschlag übergangen wurde.
 */
export function raeumeOhneGeschossDarueber(
  raeumeHier: readonly Room[],
  raeumeDarueber: readonly Room[],
): string[] {
  const raus: string[] = [];
  for (const r of raeumeHier) {
    const poly = r.innerPolygon.length >= 3 ? r.innerPolygon : r.polygon;
    if (poly.length < 3) continue;
    let sx = 0;
    let sy = 0;
    for (const p of poly) {
      sx += p.x;
      sy += p.y;
    }
    const mitte = { x: sx / poly.length, y: sy / poly.length };
    const drueber = raeumeDarueber.some((o) => {
      const op = o.innerPolygon.length >= 3 ? o.innerPolygon : o.polygon;
      return op.length >= 3 && pointInPolygon(mitte, op);
    });
    if (!drueber) raus.push(r.id);
  }
  return raus;
}

/**
 * Räume eines Dachs, über denen doch ein Geschoss liegt — für die Prüfung.
 *
 * Die Gegenrichtung zu `raeumeOhneGeschossDarueber`: nicht „was gehört
 * hinein", sondern „was steht darin, obwohl es nicht hineingehört".
 */
export function raeumeMitGeschossDarueber(
  roomIds: readonly string[],
  raeumeHier: readonly Room[],
  raeumeDarueber: readonly Room[],
): string[] {
  if (!roomIds.length) return [];
  const ohne = new Set(raeumeOhneGeschossDarueber(raeumeHier, raeumeDarueber));
  return roomIds.filter((id) => raeumeHier.some((r) => r.id === id) && !ohne.has(id));
}
