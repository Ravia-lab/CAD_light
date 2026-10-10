/**
 * Dokumentpflege — die Fachfunktionen hinter dem Store.
 * ---------------------------------------------------------------------------
 * Aus `store/useBimStore.ts` herausgelöst (TD-22, erster Schritt): IDs,
 * Klonen und strukturelles Teilen des Dokuments, Knoten- und Wandpflege und
 * die Raumerkennung mit Übernahme der Raumeigenschaften. Alles Funktionen auf
 * dem Dokument; der Store ruft sie auf und kümmert sich um Zustand, Auswahl
 * und Undo.
 *
 * Dieses Modul importiert den Store nicht.
 */
import type {
  BimDocument,
  BimNode,
  ClosureIssue,
  Level,
  Room,
  SolidElement,
  Vec2,
  Wall,
} from '../types/bim';
import { doppelteWaende, gespiegelt } from './doppelwaende';
import { EPS, distance, pointInPolygon, roundMm } from './geometry';
import {
  applyVerticalDeductions,
  detectRooms,
  isMassiveArea,
  diagnoseClosure,
  findOpenEnds,
} from './roomDetection';
import { buildRoofFrame } from './roofGeometry';
import { baueDachlandschaft, daecherVon } from './dachlandschaft';

let idCounter = 0;

export const uid = (prefix: string): string => `${prefix}-${(idCounter++).toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

/**
 * Flache Kopie mit neuen Entity-Maps — günstig und React-freundlich.
 *
 * „React-freundlich" heißt: *jede* Sammlung, in die eine Mutation
 * hineinschreibt, bekommt hier eine neue Identität. Wird eine vergessen,
 * bricht gleich zweierlei, und beides sieht nicht nach demselben Fehler aus:
 *
 *  1. Die Oberfläche merkt nichts. Ein `useMemo`, das an dieser Sammlung
 *     hängt, rechnet nicht neu und liefert weiter den alten Stand — das
 *     Objekt ist im Modell, aber nicht im Plan.
 *  2. Die Historie wird unbrauchbar. `past` legt das *alte* Dokument ab; teilt
 *     es die Sammlung mit dem neuen, schreibt die Mutation rückwärts in die
 *     Vergangenheit, und Rückgängig führt zurück auf denselben Stand.
 *
 * Genau das ist mit `site` passiert: Außenanlage und Wärmepumpe wurden über
 * `doc.site.pumps[id] = …` verändert, während `site` hier nur als Referenz aus
 * `...doc` durchgereicht wurde.
 *
 * `plant` steht bewusst nicht in der Liste: die Anlagentechnik wird
 * ausnahmslos als Ganzes ersetzt (`doc.plant = { ...doc.plant, … }`), damit
 * genügt die Referenzkopie aus `...doc`. Wer das ändert, muss `plant` hier
 * nachziehen.
 */
export function cloneDoc(doc: BimDocument): BimDocument {
  return {
    ...doc,
    meta: { ...doc.meta },
    levels: { ...doc.levels },
    layers: { ...doc.layers },
    constructions: { ...doc.constructions },
    nodes: { ...doc.nodes },
    walls: { ...doc.walls },
    openings: { ...doc.openings },
    fixtures: { ...doc.fixtures },
    verticals: { ...(doc.verticals ?? {}) },
    solids: { ...(doc.solids ?? {}) },
    durchbrueche: { ...(doc.durchbrueche ?? {}) },
    pipes: { ...(doc.pipes ?? {}) },
    /*
     * **Die Armaturen haben hier gefehlt — und das war kein Schönheitsfehler.**
     *
     * Ohne diese Zeile zeigte jede Kopie des Dokuments auf *dasselbe*
     * Armaturenverzeichnis wie das Original. Wer eine Armatur löschte,
     * löschte sie damit auch aus dem Stand, der in der Historie liegt: Strg+Z
     * holte sie nicht zurück. Aufgefallen ist es erst bei der Abnahme am
     * laufenden Server — im Programm sah alles richtig aus, weil der Fehler
     * genau dort sitzt, wo man ihn nicht sucht.
     *
     * `legeRohrnetzAus` war nie betroffen: die Aktion setzt ein neues Objekt
     * ein, statt im alten zu löschen. Das ist der Grund, warum die Lücke so
     * lange unbemerkt blieb.
     */
    pipeAccessories: { ...(doc.pipeAccessories ?? {}) },
    annotations: { ...(doc.annotations ?? {}) },
    freihand: { ...(doc.freihand ?? {}) },
    roofOpenings: { ...(doc.roofOpenings ?? {}) },
    rooms: { ...doc.rooms },
    site: { ...doc.site, elements: { ...doc.site.elements }, pumps: { ...doc.site.pumps } },
    diagnostics: { openEnds: doc.diagnostics.openEnds, closure: doc.diagnostics.closure },
    image: doc.image ? { ...doc.image } : undefined,
  };
}

/**
 * Sammlungen, an denen sich nichts geändert hat, bekommen ihre alte Kennung
 * zurück.
 * ---------------------------------------------------------------------------
 *
 * **Warum das nötig ist.** `cloneDoc` legt jede Sammlung flach neu an — es
 * muss das tun, weil die Mutationen unmittelbar in `next.walls[…]` schreiben.
 * Die Folge: Nach *jeder* Änderung hat `doc.walls` eine neue Kennung, auch
 * wenn keine einzige Wand angefasst wurde. Für React und für `useMemo` heißt
 * das „alles hat sich geändert".
 *
 * Was daran teuer ist, sieht man erst beim Ziehen. Die 3D-Ansicht baut ihren
 * Inhalt neu auf, sobald sich `walls`, `rooms`, `pipes` oder `doc.nodes`
 * ändern — Wände, Decken, Dach, Rohre, Gelände, alles. Beim Verschieben eines
 * Heizkörpers ändert sich davon nichts, und trotzdem lief der ganze Aufbau
 * fünfzigmal je Sekunde. Es gab dazu schon einen Kommentar im Viewer, der das
 * beschreibt und für `fixtures` behoben hat; die Ursache lag aber eine Ebene
 * tiefer und machte die Abhilfe wirkungslos.
 *
 * **Was hier passiert.** Nach der Änderung wird jede Sammlung mit ihrem
 * Vorzustand verglichen — Zahl der Einträge und Kennungsgleichheit je
 * Eintrag, kein tiefer Vergleich. Sind sie gleich, bekommt das neue Dokument
 * die *alte* Sammlung zurück. Das kostet einen Durchlauf über ein paar
 * hundert Verweise und spart eine Geometrie.
 *
 * **Warum der flache Vergleich genügt.** Eine geänderte Wand wird im Store
 * nirgends an Ort und Stelle verändert, sondern immer ersetzt
 * (`doc.walls[id] = { ...wall, … }`). Ein geänderter Eintrag hat damit
 * zwangsläufig eine neue Kennung. Wo doch einmal an Ort und Stelle geändert
 * würde, käme das Dokument hier unverändert durch — und die Anzeige bliebe
 * stehen. Das ist der Preis, und er ist derselbe, den React überall zahlt.
 *
 * `meta` bleibt außen vor: dort steht `modifiedAt`, das sich bei jeder
 * Änderung ändert — mit Absicht.
 */
export function teileUnveraendertes(alt: BimDocument, neu: BimDocument): void {
  const gleich = (a: Record<string, unknown>, b: Record<string, unknown>): boolean => {
    const ka = Object.keys(a);
    if (ka.length !== Object.keys(b).length) return false;
    for (const k of ka) if (a[k] !== b[k]) return false;
    return true;
  };

  const sammlungen = [
    'levels',
    'layers',
    'constructions',
    'nodes',
    'walls',
    'openings',
    'fixtures',
    'verticals',
    'solids',
    'durchbrueche',
    'pipes',
    'pipeAccessories',
    'annotations',
    'freihand',
    'roofOpenings',
    'rooms',
  ] as const;

  const a = alt as unknown as Record<string, Record<string, unknown> | undefined>;
  const b = neu as unknown as Record<string, Record<string, unknown> | undefined>;
  for (const k of sammlungen) {
    const va = a[k];
    const vb = b[k];
    if (va && vb && va !== vb && gleich(va, vb)) b[k] = va;
  }

  // Die Außenanlage hat zwei Sammlungen in einem Objekt — erst die inneren,
  // dann das äußere, sonst bliebe `site` immer neu.
  if (alt.site && neu.site && alt.site !== neu.site) {
    if (alt.site.elements !== neu.site.elements && gleich(alt.site.elements, neu.site.elements)) {
      neu.site.elements = alt.site.elements;
    }
    if (alt.site.pumps !== neu.site.pumps && gleich(alt.site.pumps, neu.site.pumps)) {
      neu.site.pumps = alt.site.pumps;
    }
    const s1 = alt.site as unknown as Record<string, unknown>;
    const s2 = neu.site as unknown as Record<string, unknown>;
    if (gleich(s1, s2)) neu.site = alt.site;
  }
}

/** Sucht einen Knoten im Toleranzradius oder legt einen neuen an. */
export function nodeAt(doc: BimDocument, p: Vec2, tolerance = 0.02, levelId?: string): BimNode {
  const level = levelId ?? doc.activeLevelId;
  let best: BimNode | undefined;
  let bestDist = tolerance;
  for (const node of Object.values(doc.nodes)) {
    // Knoten werden nur innerhalb desselben Geschosses verschmolzen —
    // sonst würde eine Wand im OG an einer Wand im EG hängen bleiben.
    if (node.levelId !== level) continue;
    const d = distance(node, p);
    if (d < bestDist) {
      bestDist = d;
      best = node;
    }
  }
  if (best) return best;
  const created: BimNode = { id: uid('n'), x: roundMm(p.x), y: roundMm(p.y), levelId: level };
  doc.nodes[created.id] = created;
  return created;
}

/**
 * Teilt jede Wand, die durch den Knoten hindurchläuft, an genau dieser Stelle.
 *
 * Das ist der Unterschied zwischen „sieht aus wie ein T-Stoß" und „ist ein
 * T-Stoß": ohne diesen Schritt bleibt die durchlaufende Wand eine einzige
 * Kante, der Raum dahinter ist topologisch offen und wird nicht erkannt.
 * Wir erledigen das direkt beim Zeichnen — nicht erst als Reparatur.
 */
export function splitWallsAtNode(doc: BimDocument, node: BimNode, tolerance = 0.02): void {
  for (const wall of Object.values(doc.walls)) {
    if (wall.a === node.id || wall.b === node.id) continue;
    if (wall.levelId !== node.levelId) continue;
    const a = doc.nodes[wall.a];
    const b = doc.nodes[wall.b];
    if (!a || !b) continue;

    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const lenSq = abx * abx + aby * aby;
    if (lenSq < EPS) continue;
    const t = ((node.x - a.x) * abx + (node.y - a.y) * aby) / lenSq;
    if (t <= 0.001 || t >= 0.999) continue;

    const px = a.x + abx * t;
    const py = a.y + aby * t;
    if (Math.hypot(px - node.x, py - node.y) > tolerance) continue;

    const len = Math.sqrt(lenSq);
    const splitDistance = t * len;
    const second: Wall = { ...wall, id: uid('w'), a: node.id, b: wall.b };
    doc.walls[wall.id] = { ...wall, b: node.id };
    doc.walls[second.id] = second;

    for (const op of Object.values(doc.openings)) {
      if (op.wallId !== wall.id) continue;
      if (op.distance > splitDistance) {
        doc.openings[op.id] = {
          ...op,
          wallId: second.id,
          distance: roundMm(op.distance - splitDistance),
        };
      }
    }
  }
}

/**
 * Deckungsgleiche Wände zusammenlegen — eine bleibt, die andere geht.
 *
 * Nötig nach jedem `splitWallsAtNode`: Der Schnitt kann aus einer langen Wand
 * ein Stück machen, das genau auf einer eben erst angelegten Wand liegt. Die
 * Dublettensperre beim Anlegen konnte das nicht sehen, weil das Stück damals
 * noch nicht existierte. Zwei Wände an derselben Stelle sind zwei Raumgrenzen
 * — doppelte Hüllfläche, doppelte Transmission, doppelter Massenauszug —, und
 * im Plan sieht man es nicht.
 *
 * Mitgenommen wird alles, was an der weichenden Wand hängt: Öffnungen,
 * wandgebundene Einbauten, Durchbrüche. Liegt die weichende Wand gegenläufig,
 * werden die vom Anfangsknoten gezählten Maße gespiegelt.
 *
 * @returns Kennungen der entfernten Wände.
 */
export function verschmelzeDoppelteWaende(doc: BimDocument): string[] {
  const plan = doppelteWaende(Object.values(doc.walls).map((w) => ({
    id: w.id, a: w.a, b: w.b, levelId: w.levelId,
  })));
  const weg: string[] = [];
  for (const v of plan) {
    const bleibt = doc.walls[v.behalten];
    const geht = doc.walls[v.weg];
    if (!bleibt || !geht) continue;
    const a = doc.nodes[bleibt.a];
    const b = doc.nodes[bleibt.b];
    const laenge = a && b ? Math.hypot(b.x - a.x, b.y - a.y) : 0;

    for (const op of Object.values(doc.openings)) {
      if (op.wallId !== geht.id) continue;
      doc.openings[op.id] = {
        ...op,
        wallId: bleibt.id,
        distance: v.gedreht ? roundMm(gespiegelt(laenge, op.distance)) : op.distance,
      };
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
    weg.push(geht.id);
  }
  return weg;
}

/** Entfernt Knoten ohne angeschlossene Wand. */
export function pruneNodes(doc: BimDocument): void {
  const used = new Set<string>();
  for (const w of Object.values(doc.walls)) {
    used.add(w.a);
    used.add(w.b);
  }
  for (const id of Object.keys(doc.nodes)) {
    if (!used.has(id)) delete doc.nodes[id];
  }
}

/**
 * Raumerkennung neu ausführen — für **jedes** Geschoss getrennt.
 *
 * Getrennt deshalb, weil Wände verschiedener Geschosse übereinander liegen:
 * würde man sie gemeinsam planarisieren, entstünden Schnittpunkte zwischen
 * Bauteilen, die einander nie berühren.
 */
/**
 * Übernimmt die Raumangaben eines Geschosses auf ein deckungsgleich kopiertes.
 *
 * Ohne diesen Schritt hieße jeder Raum im neuen Geschoss wieder „Raum 1" und
 * stünde auf 20 °C — man müsste ein Bad, das an derselben Stelle liegt, ein
 * zweites Mal von Hand beschreiben. Zugeordnet wird über den Schwerpunkt: die
 * Kopie ist geometrisch identisch, daher ist die Zuordnung eindeutig.
 */
export function transferRoomProperties(doc: BimDocument, fromLevelId: string, toLevelId: string): void {
  const key = (r: Room) => `${r.centroid.x.toFixed(3)}|${r.centroid.y.toFixed(3)}`;
  const source = new Map<string, Room>();
  for (const r of Object.values(doc.rooms)) {
    if (r.levelId === fromLevelId) source.set(key(r), r);
  }
  if (!source.size) return;

  for (const r of Object.values(doc.rooms)) {
    if (r.levelId !== toLevelId) continue;
    const origin = source.get(key(r));
    if (!origin) continue;
    doc.rooms[r.id] = {
      ...r,
      name: origin.name,
      usage: origin.usage,
      setpointTemperature: origin.setpointTemperature,
      airChangeRate: origin.airChangeRate,
      isHeated: origin.isHeated,
      heightOverride: origin.heightOverride,
    };
  }
}

/**
 * Räume, Topologiebefunde und Raumzuordnung neu bilden.
 *
 * @param nurAktivesGeschoss Nur das sichtbare Geschoss neu erkennen; die
 *   übrigen behalten ihre Räume unverändert.
 *
 * **Wofür die Abkürzung da ist.** Beim Ziehen einer Wand läuft `mutate` bei
 * jedem Zeigerereignis — auf einem Stift sind das 120 in der Sekunde. Die
 * volle Raumerkennung geht dabei über *alle* Geschosse; am Referenzhaus mit
 * vier Geschossen sind das rund zehn Millisekunden je Ereignis, und die
 * fehlen dem Bild. Während eines Zuges ändert sich aber nur das sichtbare
 * Geschoss: Die Wand, die man anfasst, liegt dort, und keine Geste bewegt
 * etwas in einem anderen Geschoss mit.
 *
 * **Warum die übernommenen Räume nicht noch einmal durch
 * `applyVerticalDeductions` laufen dürfen.** Diese Funktion zieht das
 * Treppenloch vom Luftvolumen ab — `room.volume = room.volume − …`. Sie ist
 * damit *nicht* wiederholbar: Ein zweiter Durchlauf über dieselben Räume
 * zöge dasselbe Loch ein zweites Mal ab, und der Lüftungswärmeverlust des
 * Raums wäre zu klein. Die übernommenen Räume sind bereits abgezogen und
 * bleiben deshalb außen vor.
 *
 * Nach dem Loslassen läuft `endGesture` und rechnet einmal vollständig nach.
 */
/**
 * Sind zwei Räume inhaltlich derselbe?
 *
 * Verglichen wird alles, was die Anzeige und die Rechnung benutzen. Nicht
 * verglichen wird, was aus den Feldern folgt (`grossArea` aus `polygon`,
 * `volume` aus Fläche und Höhe) — zwei Räume mit gleichem Polygon und
 * gleicher Höhe haben dieselben abgeleiteten Zahlen, und ein Vergleich
 * darüber wäre doppelt gemoppelt und keine zusätzliche Sicherheit.
 *
 * Bewusst **kein** allgemeiner Tiefenvergleich: Der wäre langsamer als das
 * Raumerkennen selbst und würde bei jeder neuen Eigenschaft still falsch —
 * er verglichen ja auch die neue mit. Diese Liste muss wachsen, wenn `Room`
 * wächst; dass man sie dabei übersieht, ist der Preis. Er ist sichtbar: Ein
 * vergessenes Feld führt dazu, dass eine Änderung daran im Bild nicht
 * ankommt, und das fällt beim ersten Ausprobieren auf.
 */
/* `benenneRaeume` steht seit 1.70.0 in `lib/scanUebernahme.ts` — dort prüfbar. */

/**
 * Die Dachkennwerte eines Raums vergleichen.
 *
 * Eigene Funktion, weil `roof` bei jedem Erkennen neu gerechnet wird und
 * deshalb nie kennungsgleich ist. Ein Kennungsvergleich hätte an dieser
 * Stelle bedeutet: In jedem Haus mit geneigtem Dach wäre jeder Raum bei
 * jeder Änderung „neu" — und die ganze Ersparnis dahin, ausgerechnet dort,
 * wo das Rechnen am teuersten ist.
 */
function gleicheDachwerte(a: Room['roof'], b: Room['roof']): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.volume === b.volume &&
    a.averageHeight === b.averageHeight &&
    a.minHeight === b.minHeight &&
    a.maxHeight === b.maxHeight &&
    a.slopedArea === b.slopedArea &&
    a.flatCeilingArea === b.flatCeilingArea &&
    a.gableArea === b.gableArea &&
    a.livingArea === b.livingArea &&
    a.skylightArea === b.skylightArea &&
    a.dormerFrontArea === b.dormerFrontArea &&
    a.slopedAreaByFace.length === b.slopedAreaByFace.length &&
    a.slopedAreaByFace.every(
      (f, i) => f.azimuth === b.slopedAreaByFace[i].azimuth && f.area === b.slopedAreaByFace[i].area,
    )
  );
}

function gleicherRaum(a: Room, b: Room): boolean {
  if (a === b) return true;
  const punkteGleich = (p: readonly Vec2[], q: readonly Vec2[]): boolean => {
    if (p.length !== q.length) return false;
    for (let i = 0; i < p.length; i++) {
      if (p[i].x !== q[i].x || p[i].y !== q[i].y) return false;
    }
    return true;
  };
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.usage === b.usage &&
    a.levelId === b.levelId &&
    a.area === b.area &&
    a.perimeter === b.perimeter &&
    a.height === b.height &&
    a.volume === b.volume &&
    a.setpointTemperature === b.setpointTemperature &&
    a.airChangeRate === b.airChangeRate &&
    a.ventilationRole === b.ventilationRole &&
    a.isHeated === b.isHeated &&
    a.floorUValue === b.floorUValue &&
    a.floorBoundary === b.floorBoundary &&
    a.ceilingUValue === b.ceilingUValue &&
    a.ceilingBoundary === b.ceilingBoundary &&
    a.groundContactPerimeter === b.groundContactPerimeter &&
    a.exposedFacadeCount === b.exposedFacadeCount &&
    a.heightOverride === b.heightOverride &&
    a.floorCovering === b.floorCovering &&
    a.floorOpeningArea === b.floorOpeningArea &&
    a.openToAboveArea === b.openToAboveArea &&
    a.solidArea === b.solidArea &&
    a.grossArea === b.grossArea &&
    a.normHeatLoad === b.normHeatLoad &&
    gleicheDachwerte(a.roof, b.roof) &&
    a.boundaries.length === b.boundaries.length &&
    /*
     * Alle Felder des Wandabschnitts, nicht eine Auswahl.
     *
     * Die naheliegende Abkürzung — Länge und U-Wert genügen doch — ist
     * falsch: Ein eingesetztes Fenster ändert `openingArea` und `netArea`,
     * die Länge aber nicht. Der Raum sähe damit gleich aus, behielte seinen
     * alten Verweis, und im Modell stünde ein Wandabschnitt ohne das
     * Fenster, das man gerade gesetzt hat. Die Heizlast rechnete dann über
     * die volle Wandfläche.
     */
    a.boundaries.every((s1, i) => {
      const s2 = b.boundaries[i];
      return (
        s1.wallId === s2.wallId &&
        s1.length === s2.length &&
        s1.netArea === s2.netArea &&
        s1.grossArea === s2.grossArea &&
        s1.openingArea === s2.openingArea &&
        s1.orientation === s2.orientation &&
        s1.azimuth === s2.azimuth &&
        s1.isExterior === s2.isExterior &&
        s1.uValue === s2.uValue &&
        s1.boundary === s2.boundary &&
        s1.neighbourRoomId === s2.neighbourRoomId &&
        s1.gableArea === s2.gableArea
      );
    }) &&
    punkteGleich(a.polygon, b.polygon) &&
    punkteGleich(a.innerPolygon, b.innerPolygon) &&
    a.centroid.x === b.centroid.x &&
    a.centroid.y === b.centroid.y
  );
}

export function recomputeRooms(doc: BimDocument, nurAktivesGeschoss = false): void {
  const previousAll = Object.values(doc.rooms);
  const allWalls = Object.values(doc.walls);
  const allOpenings = Object.values(doc.openings);
  const rooms: Room[] = [];
  /** Räume, die unverändert übernommen werden — schon abgezogen. */
  const uebernommen: Room[] = [];
  const openEnds: Vec2[] = [];
  // Topologie-Befunde nur des sichtbaren Geschosses — genau wie `openEnds`.
  // Sie werden im Plan gezeichnet, und der Plan zeigt ein Geschoss.
  const closure: ClosureIssue[] = [];

  for (const level of Object.values(doc.levels)) {
    if (nurAktivesGeschoss && level.id !== doc.activeLevelId) {
      uebernommen.push(...previousAll.filter((r) => r.levelId === level.id));
      continue;
    }
    const walls = allWalls.filter((w) => w.levelId === level.id);
    if (!walls.length) continue;
    const wallIds = new Set(walls.map((w) => w.id));
    const openings = allOpenings.filter((o) => wallIds.has(o.wallId));

    rooms.push(
      ...detectRooms({
        walls,
        nodes: doc.nodes,
        openings,
        /*
         * Die Bauteilaufbauten gehören mit hinein.
         *
         * Ohne sie führt jeder Wandabschnitt eines Raums nur den am Bauteil
         * erfassten U-Wert — ein zugewiesener Aufbau mit gerechnetem U-Wert
         * wurde gar nicht erst gesehen. Die Heizlast stimmte trotzdem, weil
         * sie `doc.walls` direkt fragt; alles, was den Abschnitt-Schnappschuss
         * liest, arbeitete dagegen mit einer veralteten Zahl.
         */
        constructions: doc.constructions,
        levelId: level.id,
        defaultHeight: level.height,
        northAngle: doc.meta.northAngle,
        previous: previousAll.filter((r) => r.levelId === level.id),
        roof: level.roof,
        /*
         * **Die Dachlandschaft aus dem vorigen Stand.**
         *
         * Welcher Gebäudeteil unter welchem Dach liegt, hängt an einer
         * Raumauswahl — also an dem Ergebnis, das die Raumerkennung gerade
         * erst erzeugt. Das Henne-Ei-Problem wird hier aufgelöst: Die
         * Landschaft entsteht aus den Räumen des **vorigen** Durchgangs.
         *
         * Das ist kein Kunstgriff, sondern die Reihenfolge, in der auch
         * gearbeitet wird: Erst stehen die Räume, dann legt man das Dach
         * darüber. Nur im allerersten Durchgang eines frisch gezeichneten
         * Geschosses fehlt die Zuordnung — dann deckt das Dach das ganze
         * Geschoss, was ohne Raumauswahl ohnehin gilt.
         */
        roofFrames: baueDachlandschaft({
          level,
          walls,
          nodes: doc.nodes,
          rooms: previousAll.filter((r) => r.levelId === level.id),
          roofOpenings: Object.values(doc.roofOpenings ?? {}).filter((o) => o.levelId === level.id),
        })
          .map((t) => t.frame)
          .filter((fr): fr is NonNullable<typeof fr> => fr !== null),
        roofOpenings: Object.values(doc.roofOpenings ?? {}).filter((o) => o.levelId === level.id),
      }),
    );
    if (level.id === doc.activeLevelId) {
      openEnds.push(...findOpenEnds(walls, doc.nodes));
      closure.push(...diagnoseClosure({ walls, nodes: doc.nodes }));
    }
  }

  // Treppen und Schächte belegen Grundfläche und nehmen — wenn sie offen
  // sind — die Decke darüber weg. Massive Bauteile belegen dieselbe
  // Grundfläche, lassen die Decke aber stehen.
  applyVerticalDeductions(
    rooms,
    Object.values(doc.verticals ?? {}),
    Object.values(doc.levels)
      .sort((a, b) => a.order - b.order)
      .map((l) => l.id),
    Object.values(doc.solids ?? {}),
  );

  /*
   * Eine Fläche, die zu vier Fünfteln Mauerwerk ist, hört auf, ein Raum zu
   * sein.
   *
   * Das ist der Abschluss von „Fläche ist kein Raum, sondern massiv": der
   * Anwender erklärt den Kaminzug zum massiven Bauteil, und danach darf die
   * Fläche keine Heizlast, kein Luftvolumen, keine Fußbodenheizung und keinen
   * Raumstempel mehr tragen. Sie verschwindet nicht — an ihrer Stelle steht
   * das Bauteil mit seiner Schraffur. Wer das Bauteil wieder löscht, bekommt
   * beim nächsten Rechnen seinen Raum zurück.
   */
  /*
   * Ein unveränderter Raum behält seinen alten Verweis.
   *
   * `detectRooms` baut bei jedem Durchlauf neue Raumobjekte — auch dann,
   * wenn sich an ihnen nichts geändert hat. Für die Rechnung ist das egal,
   * für die Anzeige nicht: Die 3D-Ansicht baut ihren ganzen Inhalt neu auf,
   * sobald `rooms` eine neue Kennung hat. Beim Verschieben eines Heizkörpers
   * ändert sich kein Raum, und trotzdem entstand fünfzigmal je Sekunde das
   * ganze Haus neu.
   *
   * Verglichen wird auf Inhalt, nicht auf Kennung — die Punkte eines
   * Polygons sind bei jedem Durchlauf neue Objekte mit denselben Zahlen.
   * Der Vergleich kostet zwei Durchläufe über die Stützpunkte; `detectRooms`
   * kostet ein Vielfaches davon.
   */
  const vorherNach = new Map(previousAll.map((r) => [r.id, r]));
  const echteRaeume = [...rooms.filter((r) => !isMassiveArea(r)), ...uebernommen].map((r) => {
    const alt = vorherNach.get(r.id);
    return alt && gleicherRaum(alt, r) ? alt : r;
  });
  doc.rooms = Object.fromEntries(echteRaeume.map((r) => [r.id, r]));
  doc.diagnostics = { openEnds, closure };

  // TGA-Objekte ihrem Raum zuordnen — abgeleitet, nie manuell gepflegt.
  for (const fixture of Object.values(doc.fixtures)) {
    const room = echteRaeume.find(
      (r) =>
        r.levelId === fixture.levelId &&
        r.innerPolygon.length >= 3 &&
        pointInPolygon(fixture.position, r.innerPolygon),
    );
    if (fixture.roomId !== room?.id) {
      doc.fixtures[fixture.id] = { ...fixture, roomId: room?.id };
    }
  }
}

/**
 * Einen Raum belegen — die eine Stelle, an der eine Fußbodenheizung entsteht.
 *
 * Sie wird von zwei Aufrufern gebraucht: vom Klick in einen einzelnen Raum
 * und von der Sammelauslegung. Beide müssen dieselbe Auslegung bekommen,
 * sonst hängt das Ergebnis davon ab, wie man es ausgelöst hat. Deshalb steht
 * die Auslegung hier und nicht zweimal in den Aktionen.
 *
 * Bewusst kein `set` und keine Statusmeldung: was auf dem Bildschirm steht,
 * entscheidet der Aufrufer — bei einem Raum ist es die Auslegung, bei zehn
 * Räumen die Bilanz.
 *
 * @returns Kennwerte des angelegten Objekts, oder `null`, wenn im Raum nach
 *   Randabstand und Einbauten nichts belegbar bleibt.
 */
/**
 * Die massiven Bauteile, die in einem Raum stehen — auch die, die nur
 * hindurchlaufen.
 *
 * Ein Schornstein steht im Erdgeschoss am Kamin und durchstößt jede Decke
 * darüber. Im Obergeschoss ist er trotzdem Mauerwerk im Raum: er nimmt dort
 * Fläche weg und die Fußbodenheizung muss ihn aussparen. Genau diese Frage
 * beantwortet die Funktion, und zwar an einer Stelle statt an dreien.
 */
export function massiveInRoom(doc: BimDocument, room: Room): SolidElement[] {
  const order = Object.values(doc.levels).sort((a, b) => a.order - b.order);
  const rank = new Map(order.map((l, i) => [l.id, i]));
  const here = rank.get(room.levelId);
  return Object.values(doc.solids ?? {}).filter((b) => {
    const from = rank.get(b.levelId);
    const reaches =
      b.levelId === room.levelId ||
      (b.throughAllLevels && from !== undefined && here !== undefined && here > from);
    return reaches && room.innerPolygon.length >= 3 && pointInPolygon(b.position, room.innerPolygon);
  });
}

/**
 * Das Dachgerüst eines Geschosses — oder `null`, wenn dort kein Dach sitzt.
 *
 * Ausgelagert, weil es an zwei Stellen gebraucht wird (Vorschau und
 * Ausführung der Höhenangleichung) und beide dasselbe sehen müssen. Liefen
 * sie auseinander, zeigte der Knopf eine andere Zahl, als er anschließend
 * ändert.
 */
export function dachGeruest(doc: BimDocument, level: Level): ReturnType<typeof buildRoofFrame>[] {
  if (!daecherVon(level).length) return [];
  const levelWalls = Object.values(doc.walls).filter((w) => w.levelId === level.id);
  return baueDachlandschaft({
    level,
    walls: levelWalls,
    nodes: doc.nodes,
    rooms: Object.values(doc.rooms ?? {}).filter((r) => r.levelId === level.id),
    roofOpenings: Object.values(doc.roofOpenings ?? {}).filter((o) => o.levelId === level.id),
  }).map((t) => t.frame);
}
