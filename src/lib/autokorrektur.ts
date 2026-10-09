/**
 * Grundriss prüfen und korrigieren — ein Durchlauf, der vorher fragt.
 * ---------------------------------------------------------------------------
 * Ein aufgemessener oder eingelesener Grundriss hat immer dieselbe Handvoll
 * Mängel: Wandenden, die eine Wand um zwei Zentimeter verfehlen; Wandstummel
 * von wenigen Millimetern, die beim Zeichnen oder Einlesen übrig blieben;
 * Wände, die ein paar Grad schief stehen; Lücken, an denen das Messgerät keine
 * Wand gesehen hat; Leitungen ohne Länge oder doppelt gesetzt; Kammern unter
 * einem Quadratmeter, die als beheizt laufen. Jeder dieser Mängel ist für sich
 * mit einem Handgriff zu beheben — nur muss man ihn erst finden.
 *
 * Dieses Modul tut zwei Dinge, streng getrennt:
 *
 *  1. **`planeKorrektur`** sucht und ändert nichts. Das Ergebnis steht im
 *     Dialog, nach Art gruppiert, jede Stelle anspringbar.
 *  2. **`wendeKorrekturAn`** führt aus, was angehakt wurde — auf dem Entwurf,
 *     den der Speicher übergibt, damit alles zusammen **ein** Schritt in der
 *     Historie ist.
 *
 * **Was nie ohne Rückfrage geschieht.** Eine Lücke von 90 cm kann eine Tür,
 * ein Durchgang oder eine Wand hinter einem Schrank sein. Das weiß nur der
 * Mensch davor; raten wäre hier besonders teuer, weil eine Tür, die keine ist,
 * in der Heizlast ein Vielfaches der Wand kostet, die sie ersetzt. Lücken
 * werden deshalb **einzeln** beantwortet, und ohne Antwort bleiben sie offen.
 *
 * **Was hier bewusst nicht korrigiert wird.** Fenster und Türen, die an einer
 * seltsamen Stelle sitzen — das kann Absicht sein. Räume über große Lücken —
 * jenseits von `MAX_WEITE` fehlt kein Wandstück, sondern ein Raum. Schräge
 * Wände jenseits der Begradigungstoleranz — ein Erker ist kein Messfehler.
 *
 * **Warum bei der Ausführung neu gesucht wird.** Die Schritte hängen
 * voneinander ab: Wer zwei Knoten zusammenführt, kann eine Lücke schließen,
 * die danach nicht mehr da ist, oder eine Wand verdoppeln. Ausgeführt wird
 * deshalb je Schritt auf dem **aktuellen** Stand; der Bericht nennt, was
 * wirklich geschah, nicht was die Vorschau vermutet hat.
 */

import type {
  BimDocument,
  BimNode,
  Opening,
  PipeRun,
  Room,
  Vec2,
  Wall,
} from '../types/bim';
import { begradige } from './begradigen';
import { doppelteWaende, gespiegelt } from './doppelwaende';
import { findeLuecken, oeffnungFuerLuecke } from './luecken';
import type { Luecke, LueckenSchluss } from './luecken';
import { doppelteLeitungen, nullLeitungen } from './leitungsbefund';
import { roundMm } from './geometry';
import { WELD_TOLERANCE } from './roomDetection';

// ------------------------------------------------------------------ Grenzen

/**
 * Bis zu welchem Abstand zwei Punkte als „gemeint ist derselbe" gelten [m].
 *
 * Dieselbe Zahl wie die Schweißtoleranz der Raumerkennung (5 cm), und mit
 * Absicht von dort übernommen: Was die Raumerkennung als zusammenhängend
 * behandelt, wird hier im Modell wirklich zusammengefügt — nicht mehr und
 * nicht weniger. Darunter liegt kein Wandstück, das jemand bauen könnte,
 * sondern ein Mess- oder Zeichenfehler. Darüber beginnt die Lücke, und die
 * ist eine Frage an den Menschen (`luecken.ts`).
 */
export const ANSCHLUSS_TOLERANZ = WELD_TOLERANCE;

/** Wände kürzer als das sind Stummel [m] — dieselbe Grenze, aus demselben Grund. */
export const STUMMEL_LAENGE = 0.05;

/**
 * Ein loses Wandende, das bis zu dieser Länge über einen Wandknoten
 * hinausragt, ist ein Überstand [m].
 *
 * Typisch beim Einlesen: Die Wand läuft am Eck ein paar Zentimeter weiter,
 * als sie soll. 15 cm, weil ein echter Mauervorsprung in aller Regel als
 * geschlossene Form gezeichnet ist und nicht als einzelne lose Wand.
 */
export const UEBERSTAND_LAENGE = 0.15;

/** Beheizte Räume unter dieser Fläche werden als unbeheizt angeboten [m²]. */
export const KLEINRAUM_FLAECHE = 1;

/**
 * Ab diesem Winkel gelten zwei Wände nicht mehr als parallel [°].
 *
 * Gebraucht, damit ein Wandende nicht an eine **parallel** daneben laufende
 * Wand gezogen wird: zwei Wände dicht nebeneinander sind eine Vorsatzschale
 * oder eine doppelt gezeichnete Wand, kein T-Stoß.
 */
const PARALLEL_GRAD = 20;

// ------------------------------------------------------------------- Typen

/** Was der Durchlauf liest und schreibt — ein Ausschnitt des Dokuments. */
export type KorrekturDokument = Pick<
  BimDocument,
  'nodes' | 'walls' | 'openings' | 'durchbrueche' | 'fixtures' | 'pipes' | 'pipeAccessories' | 'rooms' | 'levels'
>;

/** Zwei Wandknoten, die zusammengehören, oder ein Knoten, der auf eine Wand gehört. */
export type Anschluss =
  | { art: 'knoten'; levelId: string; weg: string; bleibt: string; abstand: number; stelle: Vec2 }
  | { art: 'wand'; levelId: string; knotenId: string; wandId: string; ziel: Vec2; abstand: number; stelle: Vec2 };

export interface Stummel {
  art: 'stummel' | 'ueberstand';
  levelId: string;
  wandId: string;
  laenge: number;
  stelle: Vec2;
}

export interface DoppelWand {
  levelId: string;
  behalten: string;
  weg: string;
  stelle: Vec2;
}

export interface SchiefGeschoss {
  levelId: string;
  bewegt: number;
  groessterVersatz: number;
  /** Wände, die danach genau auf der Achse stehen, die es vorher nicht taten. */
  gerichtet: number;
  schraeg: number;
  uebersprungen: number;
  stelle: Vec2;
}

export interface LueckenFund extends Luecke {
  levelId: string;
  stelle: Vec2;
  /** Ein Hinweis aus der Breite — **kein** Vorschlag, der ungefragt gilt. */
  hinweis: string;
}

export interface LeitungsFund {
  art: 'null' | 'doppelt';
  levelId: string;
  id: string;
  /** Bei `doppelt`: die Leitung, die bleibt. */
  bleibt?: string;
  laenge: number;
  stelle: Vec2;
}

export interface KleinraumFund {
  levelId: string;
  raumId: string;
  name: string;
  flaeche: number;
  stelle: Vec2;
}

export interface Korrekturplan {
  anschluesse: Anschluss[];
  stummel: Stummel[];
  doppelwaende: DoppelWand[];
  schief: SchiefGeschoss[];
  luecken: LueckenFund[];
  leitungen: LeitungsFund[];
  kleineRaeume: KleinraumFund[];
  /** Geschosse mit Wänden, in denen trotzdem kein Raum erkannt ist. */
  ohneRaum: { levelId: string; waende: number }[];
  /** Zahl aller angebotenen Korrekturen, Lücken eingeschlossen. */
  summe: number;
}

/** Was ausgeführt werden soll. Jede Gruppe für sich; Lücken je Stelle. */
export interface KorrekturAuswahl {
  anschluesse: boolean;
  stummel: boolean;
  begradigen: boolean;
  leitungen: boolean;
  kleineRaeume: boolean;
  /** Antwort je Lücke, geschlüsselt nach dem losen Knoten. Fehlt sie, bleibt die Lücke offen. */
  luecken: Record<string, LueckenSchluss>;
}

export interface KorrekturBericht {
  zusammengefuehrt: number;
  angeschlossen: number;
  stummelEntfernt: number;
  ueberstaendeEntfernt: number;
  doppelwaendeEntfernt: number;
  lueckenGeschlossen: number;
  oeffnungenGesetzt: number;
  /** Lücken, die angehakt waren, aber beim Ausführen nicht mehr da — meist durch einen früheren Schritt geschlossen. */
  lueckenEntfallen: number;
  begradigt: number;
  groessterVersatz: number;
  leitungenEntfernt: number;
  /** Räume, deren Beheizung umgestellt werden soll — das setzt der Speicher nach der Raumerkennung. */
  kleineRaeume: string[];
  /** Größte Strecke, um die ein Wandknoten insgesamt gewandert ist [m]. */
  maxBewegung: number;
}

// --------------------------------------------------------------- Werkzeuge

const abstand = (a: Vec2, b: Vec2): number => Math.hypot(b.x - a.x, b.y - a.y);
const mitte = (a: Vec2, b: Vec2): Vec2 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

function waendeIm(doc: KorrekturDokument, levelId: string): Wall[] {
  return Object.values(doc.walls).filter((w) => w.levelId === levelId && doc.nodes[w.a] && doc.nodes[w.b]);
}

function grade(waende: readonly Wall[]): Map<string, number> {
  const g = new Map<string, number>();
  for (const w of waende) {
    g.set(w.a, (g.get(w.a) ?? 0) + 1);
    g.set(w.b, (g.get(w.b) ?? 0) + 1);
  }
  return g;
}

function wandLaenge(doc: KorrekturDokument, w: Wall): number {
  const a = doc.nodes[w.a];
  const b = doc.nodes[w.b];
  return a && b ? abstand(a, b) : 0;
}

/** Hängt etwas an der Wand, das mit ihr verschwände? */
function traegtEtwas(doc: KorrekturDokument, wandId: string): boolean {
  return (
    Object.values(doc.openings).some((o) => o.wallId === wandId) ||
    Object.values(doc.durchbrueche ?? {}).some((d) => d.wallId === wandId) ||
    Object.values(doc.fixtures).some((f) => f.wallId === wandId)
  );
}

/** Winkel zwischen zwei Richtungen, ohne Vorzeichen, 0…90° [°]. */
function zwischenwinkel(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): number {
  const ax = a2.x - a1.x, ay = a2.y - a1.y, bx = b2.x - b1.x, by = b2.y - b1.y;
  const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
  if (la < 1e-9 || lb < 1e-9) return 90;
  const c = Math.abs((ax * bx + ay * by) / (la * lb));
  return (Math.acos(Math.min(1, c)) * 180) / Math.PI;
}

function lotfuss(p: Vec2, a: Vec2, b: Vec2): { punkt: Vec2; t: number; abstand: number } {
  const vx = b.x - a.x, vy = b.y - a.y;
  const l2 = vx * vx + vy * vy;
  if (l2 < 1e-12) return { punkt: a, t: 0, abstand: abstand(p, a) };
  const t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / l2;
  const punkt = { x: a.x + t * vx, y: a.y + t * vy };
  return { punkt, t, abstand: abstand(p, punkt) };
}

function geschosse(doc: KorrekturDokument): string[] {
  const ids = new Set(Object.values(doc.walls).map((w) => w.levelId));
  return Object.values(doc.levels)
    .filter((l) => ids.has(l.id))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((l) => l.id);
}

// ------------------------------------------------------------------ Suchen

/**
 * Knoten, die zusammengehören, und Knoten, die knapp neben einer Wand enden.
 *
 * **Was das bringt, wenn die Raumerkennung es doch überbrückt.** Sie schweißt
 * bis 5 cm intern zusammen — der Raum wird erkannt. Das Modell selbst bleibt
 * aber offen: Im Plan und im 3D-Modell steht die Ecke offen, die Wandlänge
 * fehlt um den Spalt, und in die Übergabe und den IFC-Export gehen zwei
 * Wandenden, die sich nicht berühren. Hier wird der Spalt im Modell
 * geschlossen, sodass alles, was das Modell liest, dasselbe sieht wie die
 * Raumerkennung.
 *
 * Zwei Knoten, die schon durch eine Wand verbunden sind, gehören nicht
 * hierher — das ist ein Stummel, und der hat eigene Regeln. Gierig nach
 * Abstand: Ein Knoten wird höchstens einmal angefasst, sonst wanderten Ketten
 * von Knoten Schritt für Schritt weiter als die Toleranz.
 */
export function findeAnschluesse(doc: KorrekturDokument, levelId: string): Anschluss[] {
  const waende = waendeIm(doc, levelId);
  const grad = grade(waende);
  const knoten = [...grad.keys()].map((id) => doc.nodes[id]).filter((n): n is BimNode => !!n);
  const verbunden = new Set<string>();
  for (const w of waende) {
    verbunden.add(`${w.a}|${w.b}`);
    verbunden.add(`${w.b}|${w.a}`);
  }

  const paare: { a: BimNode; b: BimNode; d: number }[] = [];
  for (let i = 0; i < knoten.length; i++) {
    for (let j = i + 1; j < knoten.length; j++) {
      const d = abstand(knoten[i], knoten[j]);
      if (d > ANSCHLUSS_TOLERANZ) continue;
      if (verbunden.has(`${knoten[i].id}|${knoten[j].id}`)) continue;
      paare.push({ a: knoten[i], b: knoten[j], d });
    }
  }
  paare.sort((x, y) => x.d - y.d);

  const raus: Anschluss[] = [];
  const angefasst = new Set<string>();
  for (const { a, b, d } of paare) {
    if (angefasst.has(a.id) || angefasst.has(b.id)) continue;
    // Es bleibt der Knoten, an dem mehr hängt — er ist der verlässlichere.
    const ga = grad.get(a.id) ?? 0;
    const gb = grad.get(b.id) ?? 0;
    const [bleibt, weg] = ga >= gb ? [a, b] : [b, a];
    angefasst.add(a.id);
    angefasst.add(b.id);
    raus.push({ art: 'knoten', levelId, weg: weg.id, bleibt: bleibt.id, abstand: d, stelle: { x: bleibt.x, y: bleibt.y } });
  }

  for (const k of knoten) {
    if (angefasst.has(k.id)) continue;
    const eigene = waende.filter((w) => w.a === k.id || w.b === k.id);
    let beste: { w: Wall; ziel: Vec2; d: number } | null = null;
    for (const w of waende) {
      if (w.a === k.id || w.b === k.id) continue;
      const a = doc.nodes[w.a];
      const b = doc.nodes[w.b];
      const f = lotfuss(k, a, b);
      if (f.t <= 0 || f.t >= 1) continue;
      if (f.abstand > ANSCHLUSS_TOLERANZ) continue;
      // Liegt der Fußpunkt am Wandende, ist es ein Knotenpaar und kein T-Stoß.
      if (abstand(f.punkt, a) <= ANSCHLUSS_TOLERANZ || abstand(f.punkt, b) <= ANSCHLUSS_TOLERANZ) continue;
      // Alle eigenen Wände parallel zur Zielwand: Vorsatzschale, kein T-Stoß.
      const parallel = eigene.every((e) => {
        const p = doc.nodes[e.a === k.id ? e.b : e.a];
        return p ? zwischenwinkel(k, p, a, b) < PARALLEL_GRAD : true;
      });
      if (parallel) continue;
      if (!beste || f.abstand < beste.d) beste = { w, ziel: f.punkt, d: f.abstand };
    }
    if (beste) {
      angefasst.add(k.id);
      raus.push({
        art: 'wand',
        levelId,
        knotenId: k.id,
        wandId: beste.w.id,
        ziel: { x: roundMm(beste.ziel.x), y: roundMm(beste.ziel.y) },
        abstand: beste.d,
        stelle: { x: k.x, y: k.y },
      });
    }
  }
  return raus;
}

/**
 * Wandstummel und Überstände.
 *
 * Eine Wand, an der eine Öffnung, ein Durchbruch oder ein Einbau hängt, wird
 * nie angeboten — mit ihr verschwände etwas, das jemand absichtlich gesetzt
 * hat. Der Befund wäre dann ein anderer, und den trifft man von Hand.
 */
export function findeStummel(doc: KorrekturDokument, levelId: string): Stummel[] {
  const waende = waendeIm(doc, levelId);
  const grad = grade(waende);
  const raus: Stummel[] = [];
  for (const w of waende) {
    const l = wandLaenge(doc, w);
    if (traegtEtwas(doc, w.id)) continue;
    const stelle = mitte(doc.nodes[w.a], doc.nodes[w.b]);
    if (l < STUMMEL_LAENGE) {
      raus.push({ art: 'stummel', levelId, wandId: w.id, laenge: l, stelle });
      continue;
    }
    if (l >= UEBERSTAND_LAENGE) continue;
    const ga = grad.get(w.a) ?? 0;
    const gb = grad.get(w.b) ?? 0;
    if ((ga === 1 && gb >= 3) || (gb === 1 && ga >= 3)) {
      raus.push({ art: 'ueberstand', levelId, wandId: w.id, laenge: l, stelle });
    }
  }
  return raus;
}

/** Hinweis zur Breite einer Lücke. Er sagt, was üblich ist — entschieden wird im Dialog. */
export function lueckenHinweis(weite: number): string {
  if (weite < 0.6) return 'schmaler als jede Tür';
  if (weite <= 1.3) return 'Türbreite';
  return 'breiter als eine Tür';
}

/** Alles suchen, nichts ändern. */
export function planeKorrektur(doc: KorrekturDokument): Korrekturplan {
  const plan: Korrekturplan = {
    anschluesse: [],
    stummel: [],
    doppelwaende: [],
    schief: [],
    luecken: [],
    leitungen: [],
    kleineRaeume: [],
    ohneRaum: [],
    summe: 0,
  };

  for (const levelId of geschosse(doc)) {
    const waende = waendeIm(doc, levelId);
    const anschl = findeAnschluesse(doc, levelId);
    const stummel = findeStummel(doc, levelId);
    plan.anschluesse.push(...anschl);
    plan.stummel.push(...stummel);

    for (const v of doppelteWaende(waende.map((w) => ({ id: w.id, a: w.a, b: w.b, levelId: w.levelId })))) {
      const w = doc.walls[v.weg];
      plan.doppelwaende.push({ levelId, behalten: v.behalten, weg: v.weg, stelle: mitte(doc.nodes[w.a], doc.nodes[w.b]) });
    }

    const b = begradige(waende, doc.nodes);
    if (b.bewegt > 0) {
      const ids = Object.keys(b.knoten);
      const erster = doc.nodes[ids[0]];
      plan.schief.push({
        levelId,
        bewegt: b.bewegt,
        groessterVersatz: b.groessterVersatz,
        gerichtet: b.achsparallelNachher - b.achsparallelVorher,
        schraeg: b.schraeg,
        uebersprungen: b.uebersprungen,
        stelle: { x: erster.x, y: erster.y },
      });
    }

    // Was ohnehin angeschlossen oder entfernt wird, ist keine Lücke mehr.
    const schonErledigt = new Set<string>();
    for (const a of anschl) {
      if (a.art === 'knoten') {
        schonErledigt.add(a.weg);
        schonErledigt.add(a.bleibt);
      } else schonErledigt.add(a.knotenId);
    }
    const stummelWaende = new Set(stummel.map((s) => s.wandId));
    for (const l of findeLuecken(waende, doc.nodes, levelId)) {
      if (l.weite <= ANSCHLUSS_TOLERANZ) continue;
      if (schonErledigt.has(l.knotenId) || (l.zielKnotenId && schonErledigt.has(l.zielKnotenId))) continue;
      if (stummelWaende.has(l.wandId)) continue;
      plan.luecken.push({ ...l, levelId, stelle: mitte(l.punkt, l.ziel), hinweis: lueckenHinweis(l.weite) });
    }

    const raeume = Object.values(doc.rooms).filter((r) => r.levelId === levelId);
    if (waende.length >= 3 && raeume.length === 0) plan.ohneRaum.push({ levelId, waende: waende.length });
  }

  const runs = Object.values(doc.pipes ?? {});
  const startpunkt = (id: string): Vec2 => doc.pipes[id]?.points[0] ?? { x: 0, y: 0 };
  for (const n of nullLeitungen(runs)) {
    plan.leitungen.push({ art: 'null', levelId: n.levelId, id: n.id, laenge: 0, stelle: startpunkt(n.id) });
  }
  for (const d of doppelteLeitungen(runs)) {
    plan.leitungen.push({ art: 'doppelt', levelId: d.levelId, id: d.doppelId, bleibt: d.id, laenge: d.laenge, stelle: startpunkt(d.doppelId) });
  }

  plan.kleineRaeume = kleineRaeume(Object.values(doc.rooms)).map((r) => ({
    levelId: r.levelId,
    raumId: r.id,
    name: r.name,
    flaeche: r.area,
    stelle: r.centroid,
  }));

  plan.summe =
    plan.anschluesse.length +
    plan.stummel.length +
    plan.doppelwaende.length +
    plan.schief.reduce((s, g) => s + g.bewegt, 0) +
    plan.luecken.length +
    plan.leitungen.length +
    plan.kleineRaeume.length;
  return plan;
}

/** Beheizte Räume unter `KLEINRAUM_FLAECHE`. */
export function kleineRaeume(raeume: readonly Room[]): Room[] {
  return raeume.filter((r) => r.isHeated && r.area < KLEINRAUM_FLAECHE);
}

// -------------------------------------------------------------- Ausführen

/** Ein Knoten geht in einem anderen auf. Wände, die dabei zu einem Punkt würden, verschwinden. */
function ersetzeKnoten(doc: KorrekturDokument, weg: string, bleibt: string): void {
  for (const w of Object.values(doc.walls)) {
    if (w.a !== weg && w.b !== weg) continue;
    const a = w.a === weg ? bleibt : w.a;
    const b = w.b === weg ? bleibt : w.b;
    if (a === b) delete doc.walls[w.id];
    else doc.walls[w.id] = { ...w, a, b };
  }
  delete doc.nodes[weg];
}

/**
 * Teilt jede Wand des Geschosses, die durch den Knoten läuft.
 *
 * Wie `splitWallsAtNode` im Speicher, nur dass auch Durchbrüche auf das
 * richtige Teilstück wandern — beim Zeichnen gibt es an einer frischen Wand
 * noch keine, hier schon.
 */
function teileAn(doc: KorrekturDokument, knoten: BimNode, neueId: (p: string) => string, toleranz = 0.002): void {
  for (const wall of Object.values(doc.walls)) {
    if (wall.a === knoten.id || wall.b === knoten.id) continue;
    if (wall.levelId !== knoten.levelId) continue;
    const a = doc.nodes[wall.a];
    const b = doc.nodes[wall.b];
    if (!a || !b) continue;
    const f = lotfuss(knoten, a, b);
    if (f.t <= 0.001 || f.t >= 0.999 || f.abstand > toleranz) continue;
    const schnitt = f.t * abstand(a, b);
    const zweite: Wall = { ...wall, id: neueId('w'), a: knoten.id, b: wall.b };
    doc.walls[wall.id] = { ...wall, b: knoten.id };
    doc.walls[zweite.id] = zweite;
    for (const o of Object.values(doc.openings)) {
      if (o.wallId === wall.id && o.distance > schnitt) {
        doc.openings[o.id] = { ...o, wallId: zweite.id, distance: roundMm(o.distance - schnitt) };
      }
    }
    for (const d of Object.values(doc.durchbrueche ?? {})) {
      if (d.wallId === wall.id && d.distance !== undefined && d.distance > schnitt) {
        doc.durchbrueche![d.id] = { ...d, wallId: zweite.id, distance: roundMm(d.distance - schnitt) };
      }
    }
  }
}

/** Deckungsgleiche Wände zusammenlegen — wie im Speicher, siehe `doppelwaende.ts`. */
function verschmelzeDoppelte(doc: KorrekturDokument): number {
  const plan = doppelteWaende(Object.values(doc.walls).map((w) => ({ id: w.id, a: w.a, b: w.b, levelId: w.levelId })));
  let n = 0;
  for (const v of plan) {
    const bleibt = doc.walls[v.behalten];
    const geht = doc.walls[v.weg];
    if (!bleibt || !geht) continue;
    const laenge = wandLaenge(doc, bleibt);
    for (const o of Object.values(doc.openings)) {
      if (o.wallId !== geht.id) continue;
      doc.openings[o.id] = { ...o, wallId: bleibt.id, distance: v.gedreht ? roundMm(gespiegelt(laenge, o.distance)) : o.distance };
    }
    for (const f of Object.values(doc.fixtures)) {
      if (f.wallId === geht.id) doc.fixtures[f.id] = { ...f, wallId: bleibt.id };
    }
    for (const d of Object.values(doc.durchbrueche ?? {})) {
      if (d.wallId !== geht.id) continue;
      doc.durchbrueche![d.id] = {
        ...d,
        wallId: bleibt.id,
        distance: v.gedreht && d.distance !== undefined ? roundMm(gespiegelt(laenge, d.distance)) : d.distance,
      };
    }
    delete doc.walls[geht.id];
    n++;
  }
  return n;
}

/** Knoten ohne Wand entfernen. */
function raeumeKnoten(doc: KorrekturDokument): void {
  const benutzt = new Set<string>();
  for (const w of Object.values(doc.walls)) {
    benutzt.add(w.a);
    benutzt.add(w.b);
  }
  for (const id of Object.keys(doc.nodes)) if (!benutzt.has(id)) delete doc.nodes[id];
}

/**
 * Öffnungen in ihrer Wand halten.
 *
 * Wandert ein Wandende um ein paar Zentimeter, ändert sich die Wandlänge. Eine
 * Öffnung, die vorher knapp am Ende saß, stünde dann über die Kante hinaus —
 * und verschwände beim nächsten Zeichnen. Geschoben wird nur so weit wie
 * nötig.
 */
function haltOeffnungen(doc: KorrekturDokument): void {
  for (const o of Object.values(doc.openings)) {
    const w = doc.walls[o.wallId];
    if (!w) continue;
    const l = wandLaenge(doc, w);
    if (l <= o.width) continue;
    const d = Math.min(Math.max(o.distance, o.width / 2), l - o.width / 2);
    if (Math.abs(d - o.distance) > 1e-6) doc.openings[o.id] = { ...o, distance: roundMm(d) };
  }
}

function schliesse(
  doc: KorrekturDokument,
  l: Luecke,
  art: LueckenSchluss,
  neueId: (p: string) => string,
): { geschlossen: boolean; oeffnung: boolean } {
  const quelle = doc.walls[l.wandId];
  const start = doc.nodes[l.knotenId];
  if (!quelle || !start) return { geschlossen: false, oeffnung: false };

  let ende: BimNode | undefined = l.zielKnotenId ? doc.nodes[l.zielKnotenId] : undefined;
  if (!ende) {
    ende = { id: neueId('n'), x: roundMm(l.ziel.x), y: roundMm(l.ziel.y), levelId: quelle.levelId };
    doc.nodes[ende.id] = ende;
    teileAn(doc, ende, neueId, 0.005);
  }
  const gibtEs = Object.values(doc.walls).some(
    (w) => (w.a === start.id && w.b === ende!.id) || (w.a === ende!.id && w.b === start.id),
  );
  if (gibtEs) return { geschlossen: false, oeffnung: false };

  const wand: Wall = {
    id: neueId('w'),
    levelId: quelle.levelId,
    a: start.id,
    b: ende.id,
    thickness: quelle.thickness,
    height: quelle.height,
    type: quelle.type,
    layerId: quelle.layerId ?? 'layer-walls',
    uValue: quelle.uValue,
    ...(quelle.constructionId ? { constructionId: quelle.constructionId } : {}),
  };
  doc.walls[wand.id] = wand;
  if (art === 'wand') return { geschlossen: true, oeffnung: false };

  const weite = abstand(start, ende);
  const masse = oeffnungFuerLuecke(art, weite, quelle.height);
  if (!masse) return { geschlossen: true, oeffnung: false };
  const kind = art === 'tuer' ? 'door' : art === 'fenster' ? 'window' : 'passage';
  const o: Opening = {
    id: neueId('o'),
    wallId: wand.id,
    kind,
    distance: roundMm(weite / 2),
    width: roundMm(masse.width),
    height: masse.height,
    sillHeight: masse.sillHeight,
    uValue: kind === 'window' ? 1.3 : kind === 'door' ? 1.8 : 0,
    ...(kind === 'window' ? { gValue: 0.6, windowType: 'tilt-turn' as const } : {}),
    ...(kind === 'door' ? { doorType: 'single' as const } : {}),
    ...(kind === 'passage' ? { passageType: 'lintel' as const } : {}),
  };
  doc.openings[o.id] = o;
  return { geschlossen: true, oeffnung: true };
}

function entferneLeitung(doc: KorrekturDokument, id: string, zubehoerNach?: string): void {
  const run: PipeRun | undefined = doc.pipes[id];
  if (!run) return;
  delete doc.pipes[id];
  for (const a of Object.values(doc.pipeAccessories ?? {})) {
    if (a.runId !== id) continue;
    if (zubehoerNach && doc.pipes[zubehoerNach]) doc.pipeAccessories![a.id] = { ...a, runId: zubehoerNach };
    else delete doc.pipeAccessories![a.id];
  }
}

/**
 * Führt die Auswahl aus — auf dem übergebenen Entwurf.
 *
 * Reihenfolge mit Absicht: Erst schließen, was sich nur knapp verfehlt
 * (Anschlüsse), dann wegnehmen, was übrig ist (Stummel), dann doppelt
 * Liegendes zusammenlegen — erst danach stehen die Lücken fest, die wirklich
 * offen sind. Begradigt wird zuletzt, damit auch die eben gezogenen Wände
 * mit auf die Achse kommen.
 *
 * Kleine Räume werden **nicht** hier umgestellt: Ein Raum, der erst durch
 * eine geschlossene Lücke entsteht, gibt es auf dem Entwurf noch nicht. Der
 * Bericht nennt sie; der Speicher setzt sie nach der Raumerkennung.
 */
export function wendeKorrekturAn(
  doc: KorrekturDokument,
  auswahl: KorrekturAuswahl,
  neueId: (prefix: string) => string,
): KorrekturBericht {
  const bericht: KorrekturBericht = {
    zusammengefuehrt: 0,
    angeschlossen: 0,
    stummelEntfernt: 0,
    ueberstaendeEntfernt: 0,
    doppelwaendeEntfernt: 0,
    lueckenGeschlossen: 0,
    oeffnungenGesetzt: 0,
    lueckenEntfallen: 0,
    begradigt: 0,
    groessterVersatz: 0,
    leitungenEntfernt: 0,
    kleineRaeume: [],
    maxBewegung: 0,
  };
  const ausgang = new Map(Object.values(doc.nodes).map((n) => [n.id, { x: n.x, y: n.y }]));
  const wohin = new Map<string, string>(); // Knoten, die in einem anderen aufgingen

  for (const levelId of geschosse(doc)) {
    if (auswahl.anschluesse) {
      for (const a of findeAnschluesse(doc, levelId)) {
        if (a.art === 'knoten') {
          if (!doc.nodes[a.weg] || !doc.nodes[a.bleibt]) continue;
          ersetzeKnoten(doc, a.weg, a.bleibt);
          wohin.set(a.weg, a.bleibt);
          bericht.zusammengefuehrt++;
        } else {
          const k = doc.nodes[a.knotenId];
          if (!k) continue;
          doc.nodes[k.id] = { ...k, x: a.ziel.x, y: a.ziel.y };
          teileAn(doc, doc.nodes[k.id], neueId);
          bericht.angeschlossen++;
        }
      }
    }

    if (auswahl.stummel) {
      for (const s of findeStummel(doc, levelId)) {
        const w = doc.walls[s.wandId];
        if (!w) continue;
        if (s.art === 'stummel') {
          // Das Ende mit mehr Anschlüssen bleibt, das andere geht darin auf.
          const g = grade(waendeIm(doc, levelId));
          const [bleibt, weg] = (g.get(w.a) ?? 0) >= (g.get(w.b) ?? 0) ? [w.a, w.b] : [w.b, w.a];
          ersetzeKnoten(doc, weg, bleibt);
          wohin.set(weg, bleibt);
          bericht.stummelEntfernt++;
        } else {
          delete doc.walls[w.id];
          bericht.ueberstaendeEntfernt++;
        }
      }
    }
  }

  // Zwei Wände an derselben Stelle sind nie gewollt — auch dann nicht, wenn
  // sie erst durch das Zusammenführen entstehen. Deshalb immer.
  bericht.doppelwaendeEntfernt = verschmelzeDoppelte(doc);
  raeumeKnoten(doc);

  const gewuenscht = Object.entries(auswahl.luecken);
  if (gewuenscht.length) {
    for (const levelId of geschosse(doc)) {
      for (const [knotenId, art] of gewuenscht) {
        if (doc.nodes[knotenId]?.levelId !== levelId) continue;
        const aktuell = findeLuecken(waendeIm(doc, levelId), doc.nodes, levelId).find((l) => l.knotenId === knotenId);
        if (!aktuell) continue;
        const r = schliesse(doc, aktuell, art, neueId);
        if (r.geschlossen) bericht.lueckenGeschlossen++;
        if (r.oeffnung) bericht.oeffnungenGesetzt++;
      }
    }
    bericht.lueckenEntfallen = gewuenscht.length - bericht.lueckenGeschlossen;
  }

  if (auswahl.begradigen) {
    for (const levelId of geschosse(doc)) {
      const waende = waendeIm(doc, levelId);
      const e = begradige(waende, doc.nodes);
      if (!e.bewegt) continue;
      for (const [id, p] of Object.entries(e.knoten)) {
        const n = doc.nodes[id];
        if (n) doc.nodes[id] = { ...n, x: p.x, y: p.y };
      }
      // Öffnungen und Durchbrüche wandern verhältnisgleich mit — siehe `begradigeWaende`.
      for (const o of Object.values(doc.openings)) {
        const l = e.laengen[o.wallId];
        if (!l || l.vorher <= 0) continue;
        doc.openings[o.id] = { ...o, distance: roundMm(o.distance * (l.nachher / l.vorher)) };
      }
      for (const d of Object.values(doc.durchbrueche ?? {})) {
        const l = d.wallId ? e.laengen[d.wallId] : undefined;
        if (!l || l.vorher <= 0 || d.distance === undefined) continue;
        doc.durchbrueche![d.id] = { ...d, distance: roundMm(d.distance * (l.nachher / l.vorher)) };
      }
      bericht.begradigt += e.bewegt;
      bericht.groessterVersatz = Math.max(bericht.groessterVersatz, e.groessterVersatz);
    }
  }

  haltOeffnungen(doc);

  if (auswahl.leitungen) {
    const runs = Object.values(doc.pipes ?? {});
    for (const n of nullLeitungen(runs)) {
      entferneLeitung(doc, n.id);
      bericht.leitungenEntfernt++;
    }
    for (const d of doppelteLeitungen(Object.values(doc.pipes ?? {}))) {
      entferneLeitung(doc, d.doppelId, d.id);
      bericht.leitungenEntfernt++;
    }
  }

  // Wie weit ist ein Knoten insgesamt gewandert? Bei zusammengeführten
  // Knoten zählt der Weg zum Knoten, in dem sie aufgingen.
  for (const [id, vorher] of ausgang) {
    let ziel = id;
    for (let i = 0; i < 10 && !doc.nodes[ziel] && wohin.has(ziel); i++) ziel = wohin.get(ziel)!;
    const n = doc.nodes[ziel];
    if (n) bericht.maxBewegung = Math.max(bericht.maxBewegung, abstand(vorher, n));
  }
  return bericht;
}

/** Der Bericht in einem Satz — für Statuszeile und Dialog. */
export function berichtSatz(b: KorrekturBericht): string {
  const teile: string[] = [];
  const zahl = (n: number, eins: string, viele: string) => `${n} ${n === 1 ? eins : viele}`;
  if (b.zusammengefuehrt) teile.push(zahl(b.zusammengefuehrt, 'Wandecke zusammengeführt', 'Wandecken zusammengeführt'));
  if (b.angeschlossen) teile.push(zahl(b.angeschlossen, 'Wandende angeschlossen', 'Wandenden angeschlossen'));
  if (b.stummelEntfernt) teile.push(zahl(b.stummelEntfernt, 'Stummel entfernt', 'Stummel entfernt'));
  if (b.ueberstaendeEntfernt) teile.push(zahl(b.ueberstaendeEntfernt, 'Überstand entfernt', 'Überstände entfernt'));
  if (b.doppelwaendeEntfernt) teile.push(zahl(b.doppelwaendeEntfernt, 'doppelte Wand entfernt', 'doppelte Wände entfernt'));
  if (b.lueckenGeschlossen) {
    teile.push(
      zahl(b.lueckenGeschlossen, 'Lücke geschlossen', 'Lücken geschlossen') +
        (b.oeffnungenGesetzt ? `, davon ${b.oeffnungenGesetzt} mit Öffnung` : ''),
    );
  }
  if (b.lueckenEntfallen > 0) teile.push(zahl(b.lueckenEntfallen, 'Lücke war schon zu', 'Lücken waren schon zu'));
  if (b.begradigt) teile.push(`${zahl(b.begradigt, 'Knoten', 'Knoten')} gerade gezogen`);
  if (b.leitungenEntfernt) teile.push(zahl(b.leitungenEntfernt, 'Leitung entfernt', 'Leitungen entfernt'));
  if (b.kleineRaeume.length) teile.push(zahl(b.kleineRaeume.length, 'kleiner Raum unbeheizt', 'kleine Räume unbeheizt'));
  if (!teile.length) return 'Nichts geändert.';
  const weg = b.maxBewegung > 0.0005 ? ` Größte Bewegung eines Wandpunkts: ${(b.maxBewegung * 100).toFixed(1).replace('.', ',')} cm.` : '';
  return `${teile.join(' · ')}.${weg}`;
}
