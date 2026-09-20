/**
 * Den Grundriss spiegeln — seitenverkehrt eingelesene Pläne geraderücken.
 * ---------------------------------------------------------------------------
 * Ein Grundriss kommt oft seitenverkehrt herein: ein abfotografierter Plan von
 * der Rückseite, ein Scan mit vertauschter Achse, ein Raumscan, der die Wohnung
 * gedreht sieht. Bis dahin war das nicht zu retten — jedes Aufmaß darauf war
 * spiegelbildlich und damit unbrauchbar, sobald es an der Wirklichkeit gemessen
 * wurde („links vom Flur" wurde rechts).
 *
 * **Warum das eine eigene Datei im Rechenkern ist.** Spiegeln ist keine
 * Koordinatenrechnung, sondern eine Reihe fachlicher Entscheidungen, und jede
 * davon lässt sich falsch treffen:
 *
 *  - Eine Wand behält ihre Knoten `a` und `b`. Damit bleibt jede Angabe, die
 *    *entlang* der Wandachse gemessen wird, unverändert — die Öffnungsmitte
 *    `distance`, der Türanschlag `hinge`, die Lage eines Durchbruchs. Wer hier
 *    zusätzlich `distance` spiegelt, verschiebt jede Tür an die falsche Stelle.
 *  - Die **Quer**richtung dreht sich dagegen um. Die Wandnormale ist die
 *    Linksnormale zur Achse: n = (−d_y, d_x). Spiegelt man x, wird aus d
 *    (−d_x, d_y) und daraus n′ = (−d_y, −d_x) — das ist das *negative*
 *    Spiegelbild der alten Normalen (d_y, d_x). Alles, was auf dieser Normalen
 *    ein Vorzeichen trägt, kippt deshalb mit: `flipSwing` an der Tür und
 *    `offset` an der Maßkette. Ohne das schlägt jede Tür nach dem Spiegeln in
 *    den Nachbarraum auf.
 *  - Eine Drehung θ wird an der Senkrechtachse zu 180° − θ und an der
 *    Waagerechtachse zu −θ. Das gilt für Heizkörper, Treppen, massive Bauteile
 *    und rechteckige Deckendurchbrüche gleichermaßen.
 *  - Der Dachazimut ist von Nord im Uhrzeigersinn gezählt, die Fallrichtung
 *    also (sin a, cos a). An der Senkrechtachse wird daraus (−sin a, cos a),
 *    das ist der Azimut −a; an der Waagerechtachse (sin a, −cos a), also
 *    180° − a. Der Firstversatz bleibt: er wird in Fallrichtung ab der
 *    Grundrissmitte gemessen, und beide wandern mit.
 *
 * **Was hier bewusst *nicht* passiert.** Räume, Diagnose und Heizlast werden
 * nicht angefasst — sie sind abgeleitet und entstehen nach dem Spiegeln neu.
 * Und es wird nichts gelöscht und nichts angelegt: Spiegeln verschiebt, mehr
 * nicht. Deshalb ist es rücknehmbar, ohne dass diese Datei etwas davon wissen
 * müsste.
 *
 * Die Funktion ist rein: Eingang ist ein Dokument, Ausgang ein Stapel neuer
 * Sammlungen. Sie schreibt nicht in das übergebene Dokument.
 */

import type {
  Annotation,
  BimDocument,
  BimNode,
  Durchbruch,
  Fixture,
  FloorplanImage,
  Freihandstrich,
  HeatPump,
  Level,
  Opening,
  PipeAccessory,
  PipeRun,
  RoofOpening,
  SiteElement,
  SitePlan,
  SolidElement,
  Vec2,
  VerticalElement,
} from '../types/bim';
import { normalizeDeg, roundMm } from './geometry';
import { daecherVon } from './dachlandschaft';

/**
 * An welcher Achse gespiegelt wird.
 *
 * `senkrecht` ist der Regelfall: die Achse steht senkrecht im Plan, links und
 * rechts tauschen. Genau das behebt den seitenverkehrt eingelesenen Grundriss.
 * `waagerecht` tauscht oben und unten.
 */
export type SpiegelAchse = 'senkrecht' | 'waagerecht';

export interface SpiegelAuftrag {
  achse: SpiegelAchse;
  /**
   * Geschosse, die gespiegelt werden. `'alle'` nimmt das ganze Gebäude samt
   * Grundstück — das ist der sichere Umfang, weil die Geschosse danach wieder
   * übereinanderstehen. Eine Auswahl einzelner Geschosse ist zulässig, aber
   * sie verschiebt die Geschosse gegeneinander; das ist eine Entscheidung des
   * Aufrufers und keine dieses Moduls.
   */
  geschosse: 'alle' | readonly string[];
  /**
   * Lage der Spiegelachse [m] — x bei `senkrecht`, y bei `waagerecht`.
   * Ohne Angabe die Mitte dessen, was gespiegelt wird; der Grundriss bleibt
   * dann liegen, wo er liegt.
   */
  lage?: number;
}

export interface SpiegelErgebnis {
  /** Die benutzte Achsenlage [m] — auch dann, wenn sie berechnet wurde. */
  lage: number;
  nodes: Record<string, BimNode>;
  openings: Record<string, Opening>;
  fixtures: Record<string, Fixture>;
  verticals: Record<string, VerticalElement>;
  solids: Record<string, SolidElement>;
  durchbrueche: Record<string, Durchbruch>;
  pipes: Record<string, PipeRun>;
  pipeAccessories: Record<string, PipeAccessory>;
  annotations: Record<string, Annotation>;
  freihand: Record<string, Freihandstrich>;
  roofOpenings: Record<string, RoofOpening>;
  levels: Record<string, Level>;
  site: SitePlan;
  image?: FloorplanImage;
  /** Wie viele Bauteile angefasst wurden — für die Rückmeldung an den Nutzer. */
  anzahl: number;
  /** Wurde überhaupt etwas gefunden, das gespiegelt werden konnte? */
  leer: boolean;
}

// ---------------------------------------------------------------------------
// Bausteine
// ---------------------------------------------------------------------------

/** Spiegelt eine Drehung [°] und bringt sie nach [0, 360). */
export function spiegleWinkel(grad: number, achse: SpiegelAchse): number {
  return normalizeDeg(achse === 'senkrecht' ? 180 - grad : -grad);
}

/**
 * Spiegelt einen Azimut [°] — Nord = 0, im Uhrzeigersinn.
 *
 * Nicht dasselbe wie `spiegleWinkel`: der Azimut zählt von der anderen Achse
 * und in die andere Richtung. Aus der Fallrichtung (sin a, cos a) wird an der
 * Senkrechtachse (−sin a, cos a) — Azimut −a —, an der Waagerechtachse
 * (sin a, −cos a) — Azimut 180° − a. Die beiden Formeln sind gegenüber
 * `spiegleWinkel` vertauscht, und genau deshalb steht das hier als eigene
 * Funktion und nicht als Fallunterscheidung im Aufrufer.
 */
export function spiegleAzimut(grad: number, achse: SpiegelAchse): number {
  return normalizeDeg(achse === 'senkrecht' ? -grad : 180 - grad);
}

function punktSpiegler(achse: SpiegelAchse, lage: number): (p: Vec2) => Vec2 {
  return achse === 'senkrecht'
    ? (p) => ({ x: roundMm(2 * lage - p.x), y: p.y })
    : (p) => ({ x: p.x, y: roundMm(2 * lage - p.y) });
}

/** Sammelt alle Punkte, die die Ausdehnung des Gespiegelten bestimmen. */
function punkteVon(doc: BimDocument, gehoert: (levelId: string) => boolean, mitSite: boolean): Vec2[] {
  const pts: Vec2[] = [];
  for (const n of Object.values(doc.nodes)) if (gehoert(n.levelId)) pts.push(n);
  for (const f of Object.values(doc.fixtures)) if (gehoert(f.levelId)) pts.push(f.position);
  for (const v of Object.values(doc.verticals)) if (gehoert(v.levelId)) pts.push(v.position);
  for (const s of Object.values(doc.solids ?? {})) if (gehoert(s.levelId)) pts.push(s.position);
  for (const p of Object.values(doc.pipes)) if (gehoert(p.levelId)) pts.push(...p.points);
  for (const r of Object.values(doc.roofOpenings)) if (gehoert(r.levelId)) pts.push(r.position);
  if (mitSite) for (const e of Object.values(doc.site.elements)) pts.push(...e.points);
  return pts;
}

// ---------------------------------------------------------------------------
// Die Spiegelung
// ---------------------------------------------------------------------------

export function spiegleDokument(doc: BimDocument, auftrag: SpiegelAuftrag): SpiegelErgebnis {
  const alle = auftrag.geschosse === 'alle';
  const erlaubt = alle ? null : new Set(auftrag.geschosse as readonly string[]);
  const gehoert = (levelId: string): boolean => (erlaubt ? erlaubt.has(levelId) : true);

  const pts = punkteVon(doc, gehoert, alle);
  const leer = pts.length === 0;

  let lage = auftrag.lage;
  if (lage === undefined) {
    if (leer) {
      lage = 0;
    } else if (auftrag.achse === 'senkrecht') {
      let min = Infinity;
      let max = -Infinity;
      for (const p of pts) {
        if (p.x < min) min = p.x;
        if (p.x > max) max = p.x;
      }
      lage = (min + max) / 2;
    } else {
      let min = Infinity;
      let max = -Infinity;
      for (const p of pts) {
        if (p.y < min) min = p.y;
        if (p.y > max) max = p.y;
      }
      lage = (min + max) / 2;
    }
  }

  const sp = punktSpiegler(auftrag.achse, lage);
  const drehe = (grad: number): number => spiegleWinkel(grad, auftrag.achse);
  let anzahl = 0;

  // --- Knoten ---------------------------------------------------------------
  // Die Wände selbst bleiben unangetastet: sie tragen keine Koordinate, nur
  // die beiden Knoten. Damit bleibt `a` auch nach dem Spiegeln `a` — und alles,
  // was ab `a` gemessen wird, stimmt weiter.
  const nodes: Record<string, BimNode> = { ...doc.nodes };
  for (const n of Object.values(doc.nodes)) {
    if (!gehoert(n.levelId)) continue;
    nodes[n.id] = { ...n, ...sp(n) };
    anzahl++;
  }

  // --- Öffnungen ------------------------------------------------------------
  // `distance` und `hinge` messen längs der Wandachse und bleiben. Die
  // Aufschlagseite steht auf der Normalen und kippt.
  const openings: Record<string, Opening> = { ...doc.openings };
  for (const o of Object.values(doc.openings)) {
    const wand = doc.walls[o.wallId];
    if (!wand || !gehoert(wand.levelId)) continue;
    openings[o.id] = { ...o, flipSwing: !o.flipSwing };
    anzahl++;
  }

  // --- Einbauten ------------------------------------------------------------
  const fixtures: Record<string, Fixture> = { ...doc.fixtures };
  for (const f of Object.values(doc.fixtures)) {
    if (!gehoert(f.levelId)) continue;
    fixtures[f.id] = { ...f, position: sp(f.position), rotation: drehe(f.rotation) };
    anzahl++;
  }

  const verticals: Record<string, VerticalElement> = { ...doc.verticals };
  for (const v of Object.values(doc.verticals)) {
    if (!gehoert(v.levelId)) continue;
    verticals[v.id] = { ...v, position: sp(v.position), rotation: drehe(v.rotation) };
    anzahl++;
  }

  // Beim freien Umriss kehrt sich der Umlaufsinn um. Die Punktreihenfolge wird
  // deshalb umgedreht: ein gegen den Uhrzeigersinn geführtes Polygon bleibt
  // eines, und jede Flächenformel behält ihr Vorzeichen.
  const solids: Record<string, SolidElement> = { ...(doc.solids ?? {}) };
  for (const s of Object.values(doc.solids ?? {})) {
    if (!gehoert(s.levelId)) continue;
    solids[s.id] = {
      ...s,
      position: sp(s.position),
      rotation: drehe(s.rotation),
      ...(s.outline ? { outline: s.outline.map(sp).reverse() } : {}),
    };
    anzahl++;
  }

  // --- Durchbrüche ----------------------------------------------------------
  // Wandgebunden: `distance` misst längs der Achse und bleibt. Deckengebunden:
  // Mittelpunkt und Drehung wandern mit.
  const durchbrueche: Record<string, Durchbruch> = { ...(doc.durchbrueche ?? {}) };
  for (const d of Object.values(doc.durchbrueche ?? {})) {
    if (!gehoert(d.levelId)) continue;
    durchbrueche[d.id] = {
      ...d,
      ...(d.position ? { position: sp(d.position) } : {}),
      ...(d.rotation === undefined ? {} : { rotation: drehe(d.rotation) }),
    };
    anzahl++;
  }

  // --- Leitungen ------------------------------------------------------------
  const pipes: Record<string, PipeRun> = { ...doc.pipes };
  for (const p of Object.values(doc.pipes)) {
    if (!gehoert(p.levelId)) continue;
    pipes[p.id] = { ...p, points: p.points.map(sp) };
    anzahl++;
  }

  const pipeAccessories: Record<string, PipeAccessory> = { ...(doc.pipeAccessories ?? {}) };
  for (const a of Object.values(doc.pipeAccessories ?? {})) {
    if (!gehoert(a.levelId)) continue;
    pipeAccessories[a.id] = { ...a, position: sp(a.position) };
    anzahl++;
  }

  // --- Plangrafik -----------------------------------------------------------
  // `offset` ist der Versatz der Maßlinie quer zur Messrichtung, positiv nach
  // links. Links und rechts tauschen beim Spiegeln, also kippt das Vorzeichen.
  const annotations: Record<string, Annotation> = { ...doc.annotations };
  for (const a of Object.values(doc.annotations)) {
    if (!gehoert(a.levelId)) continue;
    annotations[a.id] = { ...a, points: a.points.map(sp), offset: -a.offset };
    anzahl++;
  }

  const freihand: Record<string, Freihandstrich> = { ...(doc.freihand ?? {}) };
  for (const f of Object.values(doc.freihand ?? {})) {
    if (!gehoert(f.levelId)) continue;
    freihand[f.id] = { ...f, punkte: f.punkte.map(sp) };
    anzahl++;
  }

  // --- Dach -----------------------------------------------------------------
  const roofOpenings: Record<string, RoofOpening> = { ...doc.roofOpenings };
  for (const r of Object.values(doc.roofOpenings)) {
    if (!gehoert(r.levelId)) continue;
    roofOpenings[r.id] = { ...r, position: sp(r.position) };
    anzahl++;
  }

  const levels: Record<string, Level> = { ...doc.levels };
  for (const l of Object.values(doc.levels)) {
    if (!gehoert(l.id)) continue;
    /*
     * **Alle Dächer, nicht nur das erste.** Seit 1.36.0 kann ein Geschoss
     * mehrere tragen — beim L-Haus je Flügel eines. Spiegelte man nur das
     * erste, stünde der Hauptbau seitenverkehrt und der Anbau unverändert:
     * ein Haus, das es so nicht gibt, und niemand sähe warum.
     */
    const daecher = daecherVon(l);
    if (!daecher.length) continue;
    const gespiegelt = daecher.map((r) => ({
      ...r,
      azimuth: spiegleAzimut(r.azimuth, auftrag.achse),
    }));
    levels[l.id] =
      gespiegelt.length === 1 && !l.roofs
        ? { ...l, roof: gespiegelt[0] }
        : { ...l, roof: undefined, roofs: gespiegelt };
    anzahl += gespiegelt.length;
  }

  // --- Grundstück -----------------------------------------------------------
  // Nur beim ganzen Gebäude. Ein einzelnes Geschoss zu spiegeln und das
  // Grundstück mitzudrehen wäre falsch: das Grundstück gehört keinem Geschoss.
  let site = doc.site;
  if (alle) {
    const elements: Record<string, SiteElement> = {};
    for (const [id, e] of Object.entries(doc.site.elements)) {
      elements[id] = { ...e, points: e.points.map(sp) };
      anzahl++;
    }
    const pumps: Record<string, HeatPump> = {};
    for (const [id, p] of Object.entries(doc.site.pumps)) {
      // Die Ausblasrichtung ist ein Azimut und kippt wie der Dachazimut — sie
      // entscheidet über den Schallpegel am Nachbarfenster, also darf sie beim
      // Spiegeln nicht stehen bleiben.
      pumps[id] = { ...p, position: sp(p.position), azimuth: spiegleAzimut(p.azimuth, auftrag.achse) };
      anzahl++;
    }
    site = {
      ...doc.site,
      elements,
      pumps,
      ...(doc.site.groundwaterAzimuth === undefined
        ? {}
        : { groundwaterAzimuth: spiegleAzimut(doc.site.groundwaterAzimuth, auftrag.achse) }),
    };
  }

  // --- Referenzbild ---------------------------------------------------------
  // Das Bitmap selbst wird nicht umgerechnet — es wird beim Zeichnen
  // seitenverkehrt aufgetragen (`gespiegelt`). Was hier wandert, ist der
  // Bezugsrahmen.
  //
  // Der Rahmen hängt an `origin` mit den Achsen e = R(r)·(1,0) in Bildbreite
  // und v = R(r)·(0,−1) in Bildhöhe (`origin` ist die Ecke, die am Bildschirm
  // links oben liegt — der Zeichenweg setzt dort an). Gesucht ist die
  // Darstellung des gespiegelten Rahmens in derselben Form.
  //
  //   Senkrechtachse: die v-Achse bleibt bei r′ = −r erhalten, die e-Achse
  //   kehrt sich um. Also wird das Bild seitenverkehrt und der Ursprung
  //   wandert um eine Bildbreite entgegen der neuen e-Achse.
  //   Waagerechtachse: dasselbe mit r′ = 180° − r, und der Ursprung wandert
  //   um eine Bildbreite *in* Richtung der alten e-Achse.
  //
  // In beiden Fällen ist die Verschiebung ±breite · R(−r)·(1,0) — deshalb
  // steht dieser Vektor einmal da und nicht zweimal.
  let image = doc.image;
  if (image && alle) {
    const breite = image.naturalWidth * image.scale;
    const bog = (image.rotation * Math.PI) / 180;
    const ex = { x: Math.cos(bog), y: -Math.sin(bog) };
    const ecke = sp(image.origin);
    const vz = auftrag.achse === 'senkrecht' ? -1 : 1;
    image = {
      ...image,
      origin: {
        x: roundMm(ecke.x + vz * breite * ex.x),
        y: roundMm(ecke.y + vz * breite * ex.y),
      },
      // Nicht `spiegleWinkel`: der Rahmen wird nicht als Ganzes gedreht,
      // sondern neu aufgehängt. Bei der Senkrechtachse bleibt die Höhenachse
      // stehen (r′ = −r), bei der Waagerechtachse die Breitenachse
      // (r′ = 180° − r) — genau umgekehrt zum Bauteil.
      rotation: normalizeDeg(auftrag.achse === 'senkrecht' ? -image.rotation : 180 - image.rotation),
      gespiegelt: !image.gespiegelt,
    };
    anzahl++;
  }

  return {
    lage,
    nodes,
    openings,
    fixtures,
    verticals,
    solids,
    durchbrueche,
    pipes,
    pipeAccessories,
    annotations,
    freihand,
    roofOpenings,
    levels,
    site,
    image,
    anzahl,
    leer,
  };
}
