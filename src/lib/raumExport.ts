/**
 * Raum-Flächen des RaVia-Exports — die Hülle je Raum.
 * ---------------------------------------------------------------------------
 * Aus `raviaExport.ts` herausgelöst (TD-23): `buildRoom` bildet je Raum die
 * Hüllflächen mit U-Wert, Randbedingung und Gegentemperatur. Der Export
 * (`buildRaviaExport`) und der Überschlag (`estimateHeatLoad` über
 * `raumFlaechen`) nutzen dieselbe Funktion, die Flächen gibt es also weiter
 * nur einmal (Festlegung F1).
 *
 * Dieses Modul importiert weder den Export noch die Heizlast-Vorschau. Damit
 * hängt `heatLoadEstimate` nicht mehr am Export, und der Laufzeit-Zyklus
 * heatLoadEstimate → raviaExport → verbraucherlast/validation/plantDesign →
 * heatLoadEstimate ist aufgelöst.
 */
import { heizleistung, istEn442, migriereParams } from './normleistung';
import {
  dachraumTemperatur,
  istUnbeheizterNachbar,
  nachbarTemperatur,
  unbeheizteTemperatur,
  unbeheizterRaumTemperatur,
} from './unbeheizt';
import type {
  FixtureParams,
  BimDocument,
  BoundaryCondition,
  ExportFixture,
  ExportOpening,
  ExportRoom,
  ExportRoomPipe,
  ExportSurface,
  Fixture,
  Opening,
  Orientation,
  RoofDefinition,
  Vec2,
  UWertQuelle,
  Room,
} from '../types/bim';
import { DACH_VORGABE } from '../types/bim';
import { huellflaechenbilanz } from './huellflaechenbilanz';
import type { RohrAnteil } from './rohrImRaum';
import { pruefsumme } from './pruefsumme';
/*
 * Der U-Wert kommt aus `uwert.ts` und nicht mehr aus einem eigenen Katalog.
 *
 * Bis 1.23.0 stand hier ein `DEFAULT_U` mit denselben sieben Zahlen wie
 * `VORGABE_U` — zwei Kataloge mit demselben Inhalt, und damit zwei Häuser,
 * sobald einer von beiden gepflegt wird und der andere nicht. Der Export war
 * dabei die Stelle, die es *richtig* machte (Aufbau, dann Bauteil, dann
 * Vorgabe); genau diese Rangfolge ist nach `uwert.ts` gewandert, damit
 * Stückliste, Heft und Prüfbericht auf dieselbe Zahl kommen.
 *
 * Ein Unterschied bleibt und ist beabsichtigt: `?? DEFAULT_U[...]` sprang nur
 * bei `undefined` ein, `uWertWand` zusätzlich bei 0, `NaN` und `Infinity`.
 * Eine Wand mit `uValue: 0` wurde deshalb bis 1.23.0 mit U = 0 übergeben —
 * sie war in der Bilanz der Gegenstelle nicht etwa schlecht gedämmt, sondern
 * gar nicht vorhanden. Jetzt bekommt sie den Vorgabewert ihrer Bauteilart,
 * und `validation.ts` meldet die Eingabe als Fehler.
 */
import type { UWertAuskunft } from './uwert';
import { VORGABE_U, istErfasst, uWertOeffnung, uWertWand } from './uwert';
import {
  distance,
  normalize,
  orientationFromAzimuth,
  pointInPolygon,
  roundCm2,
  roundMm,
  sub,
} from './geometry';
import { getWallGeometry, indexOpeningsByWall, openingsOf, openingSpan } from './wallGeometry';
import { gradeSplit, isMassiveArea } from './roomDetection';
import { roofFaceAzimuthAt } from './roofGeometry';
import { baueDachlandschaft, dachteilAn, dachUeberRaum } from './dachlandschaft';
import {
  roomEnvelopeArea,
  roomEquivalentSupplement,
  roomThermalBridges,
  roomBridgeHeatLoss,
} from './thermalBridges';

/**
 * Die Flächen je Raum, genau wie der Export sie bildet (Festlegung F1).
 *
 * Der eine Flächenaufbau für Übergabe und Überschlag: `estimateHeatLoad`
 * rechnet auf diesen Flächen, statt sie aus den Raumkanten ein zweites Mal
 * zu bilden. Heizflächen und Rohre gehören nicht zur Hülle und bleiben weg.
 */
export function raumFlaechen(doc: BimDocument, rooms: readonly Room[]): Map<string, ExportSurface[]> {
  const openingIndex = indexOpeningsByWall(Object.values(doc.openings));
  const heatedByLevel = heatedTemperatureByLevel(doc);
  const leer = new Map<string, never[]>();
  const out = new Map<string, ExportSurface[]>();
  for (const room of rooms) {
    out.set(room.id, buildRoom(doc, room, openingIndex, heatedByLevel, leer, leer).surfaces);
  }
  return out;
}

/** Temperatur auf der raumabgewandten Seite eines Bauteils. */
export function neighbourTemperature(
  doc: BimDocument,
  boundary: BoundaryCondition,
  neighbourRoomId: string | undefined,
  ownTemperature: number,
): number {
  switch (boundary) {
    case 'exterior':
      return doc.meta.designOutdoorTemperature;
    case 'ground':
      return doc.meta.groundTemperature;
    case 'unheated':
      return unbeheizterRaumTemperatur(doc, neighbourRoomId ? doc.rooms[neighbourRoomId] : undefined);
    case 'neighbour':
      // Fremde Nutzung oder Nachbargebäude (seit 2.15.0, Festlegung F4).
      return nachbarTemperatur(doc.meta);
    case 'adjacent-room': {
      const neighbour = neighbourRoomId ? doc.rooms[neighbourRoomId] : undefined;
      // Ein unbeheizter Nachbarraum zählt mit θ_u, nicht mit seiner
      // Solltemperatur (seit 1.72.0, siehe `lib/unbeheizt.ts`).
      if (istUnbeheizterNachbar(neighbour)) return unbeheizterRaumTemperatur(doc, neighbour);
      return neighbour?.setpointTemperature ?? unbeheizteTemperatur(doc.meta);
    }
    case 'adiabatic':
    default:
      // Adiabat heißt: kein Wärmestrom. Gleiche Temperatur auf beiden Seiten.
      return ownTemperature;
  }
}

/**
 * Leitet die Randbedingung von Boden und Decke aus dem Geschossstapel ab.
 *
 * Liegt über einem beheizten Geschoss ein weiteres beheiztes, ist die Decke
 * *adiabat* (gleiche Temperatur, kein Wärmestrom) — nicht „unbeheizt". Diese
 * Unterscheidung macht bei einem Mehrfamilienhaus einen erheblichen
 * Unterschied in der Heizlast.
 */
/**
 * Mittlere Solltemperatur der beheizten Räume je Geschoss.
 *
 * Einmal gebildet statt je Raum: `slabBoundary` läuft zweimal pro Raum, und
 * bei 700 Räumen wären das eine Million Durchläufe durch die Raumliste, nur
 * um zweimal dieselbe Zahl zu bekommen.
 */
export function heatedTemperatureByLevel(doc: BimDocument): Map<string, number> {
  const sums = new Map<string, { sum: number; count: number }>();
  for (const room of Object.values(doc.rooms)) {
    if (!room.isHeated || isMassiveArea(room)) continue;
    const entry = sums.get(room.levelId);
    if (entry) {
      entry.sum += room.setpointTemperature;
      entry.count++;
    } else {
      sums.set(room.levelId, { sum: room.setpointTemperature, count: 1 });
    }
  }
  const out = new Map<string, number>();
  for (const [levelId, { sum, count }] of sums) out.set(levelId, sum / count);
  return out;
}

/**
 * Randbedingung einer Wandfläche: An einen **unbeheizten** Nachbarraum
 * grenzt die Wand an „unbeheizt", nicht an „Nachbarraum" (seit 1.72.0). Die
 * Raumkennung bleibt am Datensatz, damit die Gegenstelle weiß, welcher Raum
 * es ist.
 */
function wandRand(doc: BimDocument, rand: BoundaryCondition, nachbarId: string | undefined): BoundaryCondition {
  if (rand === 'adjacent-room' && istUnbeheizterNachbar(nachbarId ? doc.rooms[nachbarId] : undefined)) return 'unheated';
  return rand;
}

function slabBoundary(
  doc: BimDocument,
  room: Room,
  which: 'floor' | 'ceiling',
  heatedByLevel: Map<string, number>,
): { boundary: BoundaryCondition; temperature: number } {
  const level = doc.levels[room.levelId];
  const explicit = which === 'floor' ? room.floorBoundary : room.ceilingBoundary;
  const levelValue = which === 'floor' ? level?.floorBoundary : level?.ceilingBoundary;

  const levels = Object.values(doc.levels).sort((a, b) => a.order - b.order);
  const index = levels.findIndex((l) => l.id === room.levelId);
  const neighbourLevel = which === 'floor' ? levels[index - 1] : levels[index + 1];

  // Nur ableiten, wenn weder Raum noch Geschoss etwas anderes vorgeben.
  if (!explicit && neighbourLevel && (!levelValue || levelValue === 'unheated')) {
    const avg = heatedByLevel.get(neighbourLevel.id);
    if (avg !== undefined) {
      const sameTemperature = Math.abs(avg - room.setpointTemperature) < 0.5;
      return {
        boundary: sameTemperature ? 'adiabatic' : 'adjacent-room',
        temperature: sameTemperature ? room.setpointTemperature : Math.round(avg * 10) / 10,
      };
    }
  }

  const boundary: BoundaryCondition =
    explicit ?? levelValue ?? (which === 'floor' ? 'ground' : 'unheated');

  // „Nachbarraum" an einer Geschossdecke hat keine Raum-ID — über einem Raum
  // liegen in der Regel mehrere. Ohne ID lieferte `neighbourTemperature` hier
  // den Rückfall für unbeheizte Bereiche: eine Decke, die ausdrücklich an
  // beheizten Wohnraum grenzt, wäre mit 10 °C dahinter exportiert worden.
  // Das ist kein kleiner Fehler — bei 20 °C innen und −12 °C außen wird aus
  // einem Temperaturfaktor von −0,06 (leichter Gewinn von oben) einer von
  // +0,31, und die Decke erscheint als Verlustfläche, die sie nicht ist.
  //
  // Maßgeblich ist deshalb die mittlere Solltemperatur des angrenzenden
  // Geschosses. Gibt es keines, ist die Angabe nicht haltbar: dann steht dort
  // „unbeheizt" mit θ_u — die vorsichtige Richtung, und sie sagt, was sie
  // meint, statt einen Nachbarn zu behaupten, den es nicht gibt.
  if (boundary === 'adjacent-room') {
    const avg = neighbourLevel ? heatedByLevel.get(neighbourLevel.id) : undefined;
    if (avg === undefined) {
      return {
        boundary: 'unheated',
        temperature: which === 'ceiling' && !neighbourLevel ? dachraumTemperatur(doc.meta) : unbeheizteTemperatur(doc.meta),
      };
    }
    const sameTemperature = Math.abs(avg - room.setpointTemperature) < 0.5;
    return {
      boundary: sameTemperature ? 'adiabatic' : 'adjacent-room',
      temperature: sameTemperature ? room.setpointTemperature : Math.round(avg * 10) / 10,
    };
  }

  // Über der obersten Decke liegt der Dachraum (seit 1.72.0).
  if (boundary === 'unheated' && which === 'ceiling' && !neighbourLevel) {
    return { boundary, temperature: dachraumTemperatur(doc.meta) };
  }
  return {
    boundary,
    temperature: neighbourTemperature(doc, boundary, undefined, room.setpointTemperature),
  };
}

/**
 * Liegt eine Öffnung ganz oder überwiegend oberhalb des Kniestocks, gehört
 * sie zum Giebel — ein Giebelfenster sitzt sonst rechnerisch in einer Wand,
 * die an dieser Stelle gar nicht mehr existiert.
 */
/**
 * Übersetzt die Herkunft aus `uwert.ts` in die Quelle des Exports.
 *
 * Ein Unterschied bleibt und ist beabsichtigt: `'fehlt'` gibt es hier nicht.
 * Wand und Öffnung enden in `uwert.ts` beide bei `VORGABE_U`, und genau diesen
 * Rückfall schreiben die Aufrufer hin — die Zahl kommt dann aus dem Katalog,
 * nicht aus dem Nichts, und heißt deshalb `'katalog'`.
 */
/**
 * Die heizlastrelevante Sicht auf einen Raum — Grundlage seiner Prüfsumme.
 *
 * Aufgezählt statt ausgeschlossen: Eine Liste, die sagt „alles außer Name und
 * Farbe", nimmt jedes künftige Feld automatisch mit auf — auch das nächste
 * Darstellungsfeld, und dann springt die Summe wieder ohne Grund an. Diese
 * Liste muss beim Erweitern von Hand angefasst werden, und das ist der Zweck:
 * Wer ein Feld hinzufügt, entscheidet dabei, ob es eine Heizlast ungültig
 * macht.
 *
 * Die Flächen werden **nach Kennung sortiert**. Ihre Reihenfolge entsteht aus
 * dem Umlauf des Raumpolygons, und dessen Startpunkt kann sich beim
 * Neuerkennen drehen, ohne dass sich am Haus etwas geändert hätte — ohne die
 * Sortierung wäre das ein Fehlalarm.
 */
export function raumPruefsumme(r: ExportRoom): string {
  return pruefsumme({
    level: r.level,
    usage: r.usage,
    isHeated: r.isHeated,
    levelElevation: r.levelElevation,
    area: r.area,
    netFloorArea: r.netFloorArea,
    floorOpeningArea: r.floorOpeningArea,
    solidArea: r.solidArea,
    height: r.height,
    volume: r.volume,
    perimeter: r.perimeter,
    roof: r.roof,
    setpointTemperature: r.setpointTemperature,
    airChangeRate: r.airChangeRate,
    minimumAirflow: r.minimumAirflow,
    ventilation: r.ventilation,
    exposedFacadeCount: r.exposedFacadeCount,
    groundContactPerimeter: r.groundContactPerimeter,
    groundContactArea: r.groundContactArea,
    characteristicGroundDimension: r.characteristicGroundDimension,
    thermalBridges: r.thermalBridges,
    thermalBridgeHeatLoss: r.thermalBridgeHeatLoss,
    surfaces: [...r.surfaces]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((f) => ({
        id: f.id,
        kind: f.kind,
        component: f.component,
        tilt: f.tilt,
        azimuth: f.azimuth,
        netArea: f.netArea,
        grossArea: f.grossArea,
        uValue: f.uValue,
        uValueSource: f.uValueSource,
        thermalBridgeSupplement: f.thermalBridgeSupplement,
        boundary: f.boundary,
        neighbourRoomId: f.neighbourRoomId,
        neighbourTemperature: f.neighbourTemperature,
        groundContact: f.groundContact,
        openings: [...f.openings]
          .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
          .map((o) => ({
            id: o.id,
            kind: o.kind,
            area: o.area,
            sillHeight: o.sillHeight,
            azimuth: o.azimuth,
            uValue: o.uValue,
            uValueSource: o.uValueSource,
            gValue: o.gValue,
          })),
      })),
  });
}

function quelleVon(a: UWertAuskunft): UWertQuelle {
  switch (a.herkunft) {
    case 'aufbau':
      return 'aufbau';
    case 'bauteil':
      return 'bauteil';
    case 'katalog':
      return 'katalog';
    case 'fehlt':
      return 'katalog';
  }
}

/**
 * Der U-Wert einer Fläche aus einer Rangfolge von Trägern — mit seiner Quelle.
 *
 * Genommen wird der erste Träger, dessen Wert **erfasst** ist. `istErfasst`
 * und nicht `??`: ein `uValue` von 0 ist keine Angabe, sondern eine Lücke —
 * so entstehen über `hostPatch` angelegte Aufbauten. Mit `??` verdrängte die
 * Lücke den nächsten Träger, und die Fläche verschwände mit U = 0 lautlos aus
 * der Bilanz. Genau diese Überlegung steht beim Giebel weiter unten; Boden
 * und Decke hatten sie bis hierher nicht.
 *
 * Greift kein Träger, steht `ersatz`. Dessen Quelle ist normalerweise
 * `'annahme'` — ein fester Wert dieses Exports, den niemand erfasst und kein
 * Katalog geliefert hat; genau diese Zeilen gehören auf der Gegenseite ins
 * Annahmenverzeichnis. `ersatzQuelle` gibt es für den einen Fall, in dem der
 * Rückfall selbst schon eine Herkunft hat: Der Giebel fällt auf die Wand
 * darunter zurück, und deren Quelle ist dann auch seine.
 */
function uWertAus(
  stufen: readonly (readonly [number | undefined, UWertQuelle])[],
  ersatz: number,
  ersatzQuelle: UWertQuelle = 'annahme',
): { uValue: number; uValueSource: UWertQuelle } {
  for (const [wert, quelle] of stufen) {
    if (istErfasst(wert)) return { uValue: wert, uValueSource: quelle };
  }
  return { uValue: ersatz, uValueSource: ersatzQuelle };
}

function isGableOpening(op: ExportOpening, roof: RoofDefinition | undefined): boolean {
  if (!roof) return false;
  const centre = (op.sillHeight ?? 0) + op.height / 2;
  return centre > roof.kneeHeight;
}

/**
 * Azimut der Dachfläche, auf der eine Dachöffnung sitzt.
 *
 * Beim Satteldach hängt das davon ab, auf welcher Seite des Firsts sie liegt;
 * beim Pultdach gibt es nur eine Antwort. Ohne diese Zuordnung landeten alle
 * Dachfenster auf derselben Fassade — und damit alle solaren Gewinne auf der
 * falschen Seite.
 */
function skylightAzimuth(doc: BimDocument, room: Room, opening: { position: Vec2 }): number {
  const level = doc.levels[room.levelId];
  const roof = dachUeberRaum(level, room.id);
  if (!roof) return 0;

  /*
   * Das Gerüst über **dem Dachteil, unter dem das Fenster sitzt** — gebaut
   * von derselben Dachlandschaft, die auch die 3D-Ansicht zeichnet. Bis
   * 1.69.0 stand hier ein Gerüst über allen Wänden des Geschosses und
   * `level.roof`; beim Geschoss mit zwei Dächern gab es `level.roof` nicht,
   * und jedes Dachfenster bekam den Azimut 0.
   *
   * Für ein Geschoss mit **einem** Dach ohne Raumliste ist das dieselbe
   * Rechnung wie vorher: alle Wände, deren Knoten als Punktwolke, der
   * geordnete Gebäudeumriss — sonst landete beim Walmdach jedes Dachfenster
   * auf einer der vier Flächen des umschließenden Rechtecks.
   */
  const levelWalls = Object.values(doc.walls).filter((w) => w.levelId === room.levelId);
  const teile = baueDachlandschaft({
    level,
    walls: levelWalls,
    nodes: doc.nodes,
    rooms: Object.values(doc.rooms).filter((r) => r.levelId === room.levelId),
  });
  const frame = dachteilAn(teile, opening.position)?.frame ?? null;
  return frame ? roofFaceAzimuthAt(frame, opening.position) : roof.azimuth;
}

export function buildRoom(
  doc: BimDocument,
  room: Room,
  openingIndex: Map<string, Opening[]>,
  heatedByLevel: Map<string, number>,
  fixturesByRoom: Map<string, Fixture[]>,
  rohrJeRaum: Map<string, RohrAnteil[]>,
): ExportRoom {
  const surfaces: ExportSurface[] = [];
  const windowAreaByOrientation: Partial<Record<Orientation, number>> = {};
  let totalWindowArea = 0;
  let exteriorWallArea = 0;

  const rohre: ExportRoomPipe[] = (rohrJeRaum.get(room.id) ?? []).map((r) => ({
    service: r.service,
    nominalDiameter: r.nominalDiameter,
    insulation: r.insulation,
    length: roundCm2(r.length),
  }));

  const level = doc.levels[room.levelId];
  // Im detaillierten Verfahren steckt der Zuschlag nicht mehr im U-Wert der
  // Fläche, sondern in den Anschlusslängen weiter unten. Bliebe er hier
  // stehen, wäre er doppelt gezählt.
  const detailedBridges = doc.meta.thermalBridgeMethod === 'detailed';
  const defaultTb = detailedBridges ? 0 : doc.meta.thermalBridgeSupplement;
  // Das Dach über **diesem** Raum, nicht `level.roof` — siehe `dachUeberRaum`.
  const dachHier = dachUeberRaum(level, room.id);
  const roof = dachHier && dachHier.kind !== 'flat' ? dachHier : undefined;
  const gableConstruction = roof?.gableConstructionId
    ? (doc.constructions ?? {})[roof.gableConstructionId]
    : undefined;

  // Jede Öffnung darf pro Raum nur einmal zählen, auch wenn zwei
  // Wandabschnitte auf derselben Wand liegen.
  const claimed = new Set<string>();

  // --- Wände --------------------------------------------------------------
  for (let i = 0; i < room.boundaries.length; i++) {
    const boundary = room.boundaries[i];
    const wall = doc.walls[boundary.wallId];
    if (!wall) continue;
    const g = getWallGeometry(wall, doc.nodes);
    if (!g) continue;

    // Weltposition des Abschnitts, um Öffnungen korrekt zuzuordnen
    const a = room.polygon[i];
    const b = room.polygon[(i + 1) % room.polygon.length];
    const dir = normalize(sub(b, a));
    const segLength = distance(a, b);

    const segmentOpenings: ExportOpening[] = [];

    for (const op of openingsOf(openingIndex, wall.id)) {
      if (claimed.has(op.id)) continue;
      const span = openingSpan(g, op);
      const centerU = (span.from + span.to) / 2;
      const center = { x: g.a.x + g.dir.x * centerU, y: g.a.y + g.dir.y * centerU };
      const along = (center.x - a.x) * dir.x + (center.y - a.y) * dir.y;
      if (along < -0.05 || along > segLength + 0.05) continue;

      claimed.add(op.id);
      const opConstruction = op.constructionId ? (doc.constructions ?? {})[op.constructionId] : undefined;
      const area = roundCm2(op.width * op.height);
      segmentOpenings.push({
        id: op.id,
        kind: op.kind,
        width: roundMm(op.width),
        height: roundMm(op.height),
        area,
        sillHeight: roundMm(op.sillHeight),
        orientation: boundary.orientation,
        azimuth: Math.round(boundary.azimuth * 10) / 10,
        // `wert` ist hier nie undefiniert: `uWertOeffnung` endet für jede
        // Öffnungsart bei einem Vorgabewert, und `'fehlt'` gibt es nur ohne
        // Öffnung. Der Rückfall steht trotzdem da, weil `ExportOpening.uValue`
        // eine Zahl verlangt und ein `?? 0` an dieser Stelle genau der Fehler
        // wäre, den `uwert.ts` verhindern soll — 0 rechnet sich klaglos
        // weiter und macht das Fenster aus der Bilanz verschwinden.
        ...(() => {
          const a = uWertOeffnung(op, doc.constructions);
          return { uValue: a.wert ?? VORGABE_U[op.kind], uValueSource: quelleVon(a) };
        })(),
        gValue: op.gValue,
        construction: opConstruction?.name,
        constructionId: op.constructionId,
      });

      if (op.kind === 'window') {
        totalWindowArea += area;
        windowAreaByOrientation[boundary.orientation] =
          roundCm2((windowAreaByOrientation[boundary.orientation] ?? 0) + area);
      }
    }

    const openingArea = segmentOpenings.reduce((sum, o) => sum + o.area, 0);
    const grossArea = roundCm2(boundary.grossArea);
    const netArea = roundCm2(Math.max(0, grossArea - openingArea));
    const wallConstruction = wall.constructionId ? (doc.constructions ?? {})[wall.constructionId] : undefined;
    const gable = roof ? (boundary.gableArea ?? 0) : 0;
    /*
     * Öffnungen über dem Kniestock gehören zum Giebel — **wenn die Wand
     * einen hat**.
     *
     * Ohne diese Bedingung ging eine solche Öffnung verloren: `isGableOpening`
     * fragt allein nach der Höhe ihrer Mitte, die Giebelfläche entsteht aber
     * nur, wenn `boundary.gableArea` etwas hergibt. Bei einem Satteldach hat
     * genau die Hälfte der Außenwände einen Giebel — die anderen liegen an der
     * Traufe. Ein Fenster hoch in einer Traufwand wurde deshalb aus der
     * Wandliste gefiltert und landete auf einer Giebelfläche, die für diese
     * Wand nie gebaut wurde.
     *
     * Der Verlust war doppelt und in beide Richtungen zu klein: Das Fenster
     * fehlte in der Bilanz **und** seine Fläche war von der Wand längst
     * abgezogen (`netArea` rechnet mit `segmentOpenings`, nicht mit
     * `wallOpenings`). Übergeben wurde also eine kleinere Wand ohne das
     * Fenster darin — bei U 1,1 gegen U 0,28 fällt die Heizlast des Raums
     * spürbar zu niedrig aus, und nichts daran sieht falsch aus.
     *
     * Die Gegenprobe steht im Prüfblock „Exportvertrag": Über alle Flächen
     * eines Raums muss jede Öffnung genau einmal vorkommen.
     */
    const hatGiebel = gable > 0.05;
    const wallOpenings = segmentOpenings.filter((o) => !(hatGiebel && isGableOpening(o, roof)));
    // Unter einer Dachschräge endet die eigentliche Wand am Kniestock;
    // was darüber liegt, ist der Giebel und wird gleich eigens ausgewiesen.
    const wallGross = gable > 0 ? roundCm2(grossArea - gable) : grossArea;
    // Ist dem Bauteil ein Aufbau aus dem Katalog zugewiesen, gilt dessen
    // U-Wert. Sonst gäbe es zwei Wahrheiten, und die Katalogpflege ginge
    // an den Wänden vorbei, die sie eigentlich beschreibt. Die Rangfolge
    // steht in `uwert.ts` und gilt für Export, Stückliste und Heft
    // gemeinsam — dieselbe Wand darf nicht in zwei Papieren zwei U-Werte
    // haben. Zum Rückfall auf `VORGABE_U` siehe die Öffnung oben.
    const wallAuskunft = uWertWand(wall, doc.constructions);
    const wallU = wallAuskunft.wert ?? VORGABE_U[wall.type];
    const wallUQuelle = quelleVon(wallAuskunft);
    const wallTb = detailedBridges ? 0 : (wall.thermalBridgeSupplement ?? defaultTb);

    // --- Geländeoberkante: steckt ein Teil dieser Wand im Erdreich? -------
    // Der erdberührte Teil sitzt immer unten. Er wird als eigene Hüllfläche
    // mit `boundary: 'ground'` geführt, der Rest bleibt `exterior`. Beide
    // behandelt die Transmissionsrechnung identisch (A·U·f); nur der
    // Temperaturfaktor fällt anders aus. Genau deshalb ist die Teilung
    // sauber und kein Sonderfall.
    //
    // Ohne erfasste Geländeoberkante liefert `gradeSplit` eine eingebundene
    // Höhe von 0 — dann läuft dieser Zweig gar nicht an, und die Wand wird
    // Feld für Feld so geschrieben wie vor Einführung der Geländeoberkante.
    const split = gradeSplit(level?.elevation ?? 0, wall.height, doc.meta.terrainElevation);
    const buriedGross = roundCm2(Math.min(boundary.length * split.buriedHeight, wallGross));
    const aboveGross = roundCm2(wallGross - buriedGross);
    const isBuried = split.buriedHeight > 1e-6 && buriedGross > 0.005 && boundary.boundary === 'exterior';
    const isSplit = isBuried && split.exposedHeight > 1e-6 && aboveGross > 0.005;

    if (!isBuried) {
      if (boundary.boundary === 'exterior') exteriorWallArea += Math.max(0, netArea - gable);
      // Hat jemand die Wand von Hand auf „Erdreich" gestellt, gilt das für
      // die ganze Wand — hier wird nichts geteilt und nichts übersteuert.
      // Die Tiefe folgt aber trotzdem aus der Höhenlage, sofern eine
      // Geländeoberkante erfasst ist; sonst bleibt sie unbekannt und wird
      // nicht geraten.
      const erklaerteErdberuehrung =
        boundary.boundary === 'ground' && split.buriedHeight > 1e-6
          ? {
              groundContact: {
                embedmentDepth: roundMm(split.embedmentDepth),
                buriedHeight: roundMm(split.buriedHeight),
              },
            }
          : {};
      surfaces.push({
        id: wall.id,
        kind: 'wall',
        component: wall.type,
        length: roundMm(boundary.length),
        height: roundMm(wall.height),
        thickness: roundMm(wall.thickness),
        tilt: 90,
        orientation: boundary.orientation,
        azimuth: Math.round(boundary.azimuth * 10) / 10,
        grossArea: wallGross,
        netArea,
        uValue: wallU,
        uValueSource: wallUQuelle,
        construction: wallConstruction?.name,
        constructionId: wall.constructionId,
        thermalBridgeSupplement: wallTb,
        boundary: wandRand(doc, boundary.boundary, boundary.neighbourRoomId),
        ...erklaerteErdberuehrung,
        neighbourRoomId: boundary.neighbourRoomId,
        neighbourTemperature: neighbourTemperature(
          doc,
          boundary.boundary,
          boundary.neighbourRoomId,
          room.setpointTemperature,
        ),
        openings: wallOpenings,
      });
    } else {
      // Eine Öffnung gehört dem Teil, in dem ihre Mitte liegt. Liegt sie
      // unter Gelände, ist das ein Lichtschacht — zulässig, aber die
      // Modellprüfung sagt es, weil es selten Absicht ist.
      const belowOpenings = wallOpenings.filter((o) => (o.sillHeight ?? 0) + o.height / 2 < split.buriedHeight);
      const aboveOpenings = wallOpenings.filter((o) => !belowOpenings.includes(o));
      const belowOpeningArea = belowOpenings.reduce((sum, o) => sum + o.area, 0);
      const aboveOpeningArea = aboveOpenings.reduce((sum, o) => sum + o.area, 0);

      if (isSplit) {
        const aboveNet = roundCm2(Math.max(0, aboveGross - aboveOpeningArea));
        exteriorWallArea += Math.max(0, aboveNet - gable);
        surfaces.push({
          id: wall.id,
          kind: 'wall',
          component: wall.type,
          length: roundMm(boundary.length),
          height: roundMm(split.exposedHeight),
          thickness: roundMm(wall.thickness),
          tilt: 90,
          orientation: boundary.orientation,
          azimuth: Math.round(boundary.azimuth * 10) / 10,
          grossArea: aboveGross,
          netArea: aboveNet,
          uValue: wallU,
          uValueSource: wallUQuelle,
          construction: wallConstruction?.name,
          constructionId: wall.constructionId,
          thermalBridgeSupplement: wallTb,
          boundary: 'exterior',
          neighbourRoomId: boundary.neighbourRoomId,
          neighbourTemperature: doc.meta.designOutdoorTemperature,
          openings: aboveOpenings,
        });
      }

      // Die ID bleibt die der Wand, solange es nur *eine* Fläche gibt: eine
      // vollständig eingegrabene Wand ist keine geteilte Wand. Erst die
      // Teilung braucht einen zweiten Namen — nach demselben Muster wie der
      // Giebel, damit die Herkunft der Fläche ablesbar bleibt.
      surfaces.push({
        id: isSplit ? `${wall.id}-ground` : wall.id,
        kind: 'wall',
        component: wall.type,
        length: roundMm(boundary.length),
        height: roundMm(split.buriedHeight),
        thickness: roundMm(wall.thickness),
        tilt: 90,
        orientation: boundary.orientation,
        azimuth: Math.round(boundary.azimuth * 10) / 10,
        grossArea: buriedGross,
        netArea: roundCm2(Math.max(0, buriedGross - belowOpeningArea)),
        uValue: wallU,
        uValueSource: wallUQuelle,
        construction: wallConstruction?.name,
        constructionId: wall.constructionId,
        thermalBridgeSupplement: wallTb,
        boundary: 'ground',
        neighbourTemperature: doc.meta.groundTemperature,
        groundContact: {
          embedmentDepth: roundMm(split.embedmentDepth),
          buriedHeight: roundMm(split.buriedHeight),
        },
        openings: belowOpenings,
      });
    }

    // Giebel als eigenes Bauteil: er ist in der Regel anders aufgebaut als
    // die Wand darunter (Holz, Vorhangfassade) und hat einen eigenen U-Wert.
    if (gable > 0.05) {
      // Dieselbe Bedingung wie bei `wallOpenings`, nur andersherum — die
      // beiden Listen müssen zusammen wieder `segmentOpenings` ergeben.
      const gableOpenings = segmentOpenings.filter((o) => hatGiebel && isGableOpening(o, roof));
      const gableOpeningArea = gableOpenings.reduce((sum, o) => sum + o.area, 0);
      surfaces.push({
        id: `${wall.id}-gable`,
        kind: 'gable',
        component: wall.type,
        length: roundMm(boundary.length),
        tilt: 90,
        orientation: boundary.orientation,
        azimuth: Math.round(boundary.azimuth * 10) / 10,
        grossArea: roundCm2(gable),
        netArea: roundCm2(Math.max(0, gable - gableOpeningArea)),
        // Der Giebel hat eine eigene Rangfolge über zwei zusätzliche
        // Träger — Giebelaufbau, dann der am Dach erfasste Giebel-U-Wert —
        // und fällt erst danach auf die Wand darunter zurück. Deren Kette
        // ist `wallU` und damit schon die aus `uwert.ts`; hier steht sie
        // nicht noch einmal.
        //
        // `istErfasst` statt `??` bei den ersten beiden: Ein Giebelaufbau
        // mit `uValue: 0` ist keine Angabe, sondern eine Lücke (so entstehen
        // über `hostPatch` angelegte Aufbauten). Mit `??` hätte er die Wand
        // darunter verdrängt und den ganzen Giebel mit U = 0 übergeben.
        ...uWertAus(
          [
            [gableConstruction?.uValue, 'aufbau'],
            [roof?.gableUValue, 'bauteil'],
          ],
          wallU,
          wallUQuelle,
        ),
        construction: gableConstruction?.name,
        constructionId: roof?.gableConstructionId,
        thermalBridgeSupplement: detailedBridges ? 0 : (wall.thermalBridgeSupplement ?? defaultTb),
        boundary: wandRand(doc, boundary.boundary, boundary.neighbourRoomId),
        neighbourRoomId: boundary.neighbourRoomId,
        neighbourTemperature: neighbourTemperature(
          doc,
          boundary.boundary,
          boundary.neighbourRoomId,
          room.setpointTemperature,
        ),
        openings: gableOpenings,
      });
      if (boundary.boundary === 'exterior') {
        exteriorWallArea += roundCm2(Math.max(0, gable - gableOpeningArea));
      }
    }
  }

  // --- Boden und Decke ----------------------------------------------------
  // Ohne diese beiden Flächen wäre die Transmissionsrechnung unvollständig;
  // bei einem Eckraum im Erdgeschoss machen sie leicht ein Drittel aus.
  const floor = slabBoundary(doc, room, 'floor', heatedByLevel);
  const ceiling = slabBoundary(doc, room, 'ceiling', heatedByLevel);
  const area = roundCm2(room.area);
  const floorConstruction = level?.floorConstructionId
    ? (doc.constructions ?? {})[level.floorConstructionId]
    : undefined;
  const ceilingConstruction = level?.ceilingConstructionId
    ? (doc.constructions ?? {})[level.ceilingConstructionId]
    : undefined;

  // Die Fläche eines Treppenlochs trägt kein Bauteil — weder Boden noch
  // Decke. Sie mitzurechnen wäre ein Verlust durch eine Öffnung, die keine
  // Bauteilschicht hat.
  const floorArea = roundCm2(Math.max(0, room.area - (room.floorOpeningArea ?? 0)));
  const ceilingArea = roundCm2(Math.max(0, room.area - (room.openToAboveArea ?? 0)));

  // Die Sohle eines erdberührten Geschosses trägt dieselbe Kenngröße wie
  // seine Wände: die Tiefe unter Gelände. Bei einer waagerechten Fläche ist
  // die Unterkante die Fläche selbst — eingebundene Höhe 0, Einbindetiefe
  // gleich dem Abstand zwischen Geländeoberkante und Fußbodenhöhe.
  // Eine Bodenplatte auf Geländeniveau hat damit z = 0; das ist eine Angabe,
  // keine Lücke.
  const floorGround =
    floor.boundary === 'ground' && doc.meta.terrainElevation !== undefined
      ? {
          groundContact: {
            embedmentDepth: roundMm(Math.max(0, doc.meta.terrainElevation - (level?.elevation ?? 0))),
            buriedHeight: 0,
          },
        }
      : {};
  surfaces.push({
    id: `${room.id}-floor`,
    kind: 'floor',
    component: 'slab',
    tilt: 0,
    grossArea: floorArea,
    netArea: floorArea,
    ...uWertAus(
      [
        [room.floorUValue, 'bauteil'],
        [floorConstruction?.uValue, 'aufbau'],
        [level?.floorUValue, 'bauteil'],
      ],
      0.3,
    ),
    construction: floorConstruction?.name,
    constructionId: floorConstruction?.id,
    thermalBridgeSupplement: defaultTb,
    boundary: floor.boundary,
    ...floorGround,
    neighbourTemperature: floor.temperature,
    openings: [],
  });

  // Unter einem geneigten Dach ist die obere Begrenzung keine waagerechte
  // Decke, sondern eine oder mehrere Dachflächen — plus, falls vorhanden,
  // die waagerechte Kehlbalkenlage. Die Dachfläche ist im Dachgeschoss der
  // größte Verlustweg überhaupt; sie als Decke mit Grundflächenmaß zu führen
  // wäre gleich doppelt falsch (zu klein und mit falschem U-Wert).
  const metrics = room.roof;
  if (roof && metrics && metrics.slopedArea > 0.05) {
    const roofConstruction = roof.constructionId
      ? (doc.constructions ?? {})[roof.constructionId]
      : undefined;
    const faces = metrics.slopedAreaByFace.length
      ? metrics.slopedAreaByFace
      : [{ azimuth: roof.azimuth, area: metrics.slopedArea }];

    // Dachflächenfenster diesem Raum zuordnen: sie liegen mit ihrem
    // Mittelpunkt im Raumpolygon und gehören zu der Dachfläche, über der sie
    // sitzen. Ihre Fläche wird von der Dachfläche abgezogen, nicht addiert.
    const roomSkylights = Object.values(doc.roofOpenings ?? {}).filter(
      (o) =>
        o.levelId === room.levelId &&
        o.kind === 'skylight' &&
        room.innerPolygon.length >= 3 &&
        pointInPolygon(o.position, room.innerPolygon),
    );

    for (const face of faces) {
      const azimuth = Math.round(((face.azimuth - doc.meta.northAngle) % 360 + 360) % 360 * 10) / 10;
      // Ein Fenster gehört zu der Dachfläche, deren Azimut es teilt.
      const windows = roomSkylights.filter(
        (o) => Math.abs(((skylightAzimuth(doc, room, o) - face.azimuth) % 360 + 540) % 360 - 180) < 1,
      );
      const windowArea = windows.reduce((sum, o) => sum + o.width * o.depth, 0);

      surfaces.push({
        id: `${room.id}-roof-${Math.round(face.azimuth)}`,
        kind: 'roof',
        component: 'slab',
        tilt: Math.round(roof.pitch * 10) / 10,
        orientation: orientationFromAzimuth(azimuth),
        azimuth,
        grossArea: roundCm2(face.area),
        netArea: roundCm2(Math.max(0, face.area - windowArea)),
        /*
         * Der Ersatzwert war einmal `roof.uValue` selbst — also genau der
         * Wert, dessen Fehlen er auffangen sollte. Führte eine Projektdatei
         * das Dach ohne Aufbau, stand im Export `uValue: undefined` und
         * daneben „Annahme": eine Fläche, die auf der Gegenseite stumm mit
         * 0 W/K in die Rechnung geht. Jetzt steht dort eine Zahl, und sie
         * heißt ehrlich Annahme.
         */
        ...uWertAus(
          [
            [roofConstruction?.uValue, 'aufbau'],
            [roof.uValue, 'bauteil'],
          ],
          DACH_VORGABE.uValue,
        ),
        construction: roofConstruction?.name,
        constructionId: roof.constructionId,
        thermalBridgeSupplement: defaultTb,
        boundary: 'exterior',
        neighbourTemperature: doc.meta.designOutdoorTemperature,
        openings: windows.map((o) => {
          const area = roundCm2(o.width * o.depth);
          totalWindowArea += area;
          const orient = orientationFromAzimuth(azimuth);
          windowAreaByOrientation[orient] = roundCm2((windowAreaByOrientation[orient] ?? 0) + area);
          return {
            id: o.id,
            kind: 'window' as const,
            width: roundMm(o.width),
            height: roundMm(o.depth),
            area,
            sillHeight: 0,
            orientation: orient,
            azimuth,
            uValue: o.uValue,
            // Ein Dachfenster trägt seinen U-Wert am Bauteil; einen Katalog
            // für Dachflächenfenster gibt es nicht.
            uValueSource: 'bauteil' as const,
            gValue: o.gValue,
            construction: o.constructionId ? (doc.constructions ?? {})[o.constructionId]?.name : undefined,
            constructionId: o.constructionId,
          };
        }),
      });
    }

    // Gauben: Front, Wangen und eigenes Dach. Die Front ist senkrecht und
    // schaut in Fallrichtung des Hauptdachs — der Azimut der Dachfläche,
    // auf der sie sitzt.
    for (const dormer of Object.values(doc.roofOpenings ?? {})) {
      if (dormer.levelId !== room.levelId || dormer.kind === 'skylight') continue;
      if (room.innerPolygon.length < 3 || !pointInPolygon(dormer.position, room.innerPolygon)) continue;

      const azimuth =
        Math.round(((skylightAzimuth(doc, room, dormer) - doc.meta.northAngle) % 360 + 360) % 360 * 10) / 10;
      const orient = orientationFromAzimuth(azimuth);
      const glass = Math.min(dormer.frontWindowArea ?? 0, metrics.dormerFrontArea);

      if (metrics.dormerFrontArea > 0.02) {
        if (glass > 0) {
          totalWindowArea += roundCm2(glass);
          windowAreaByOrientation[orient] = roundCm2((windowAreaByOrientation[orient] ?? 0) + glass);
          exteriorWallArea += roundCm2(Math.max(0, metrics.dormerFrontArea - glass));
        }
        surfaces.push({
          id: `${dormer.id}-front`,
          kind: 'wall',
          component: 'exterior',
          height: roundMm(dormer.frontHeight ?? 0),
          length: roundMm(dormer.width),
          tilt: 90,
          orientation: orient,
          azimuth,
          grossArea: roundCm2(metrics.dormerFrontArea),
          netArea: roundCm2(Math.max(0, metrics.dormerFrontArea - glass)),
          ...uWertAus([[dormer.frontUValue, 'bauteil']], 0.24),
          thermalBridgeSupplement: defaultTb,
          boundary: 'exterior',
          neighbourTemperature: doc.meta.designOutdoorTemperature,
          openings:
            glass > 0
              ? [
                  {
                    id: `${dormer.id}-glass`,
                    kind: 'window' as const,
                    width: roundMm(dormer.width),
                    height: roundMm(glass / Math.max(dormer.width, 0.01)),
                    area: roundCm2(glass),
                    sillHeight: 0.9,
                    orientation: orient,
                    azimuth,
                    uValue: dormer.uValue,
                    uValueSource: 'bauteil' as const,
                    gValue: dormer.gValue ?? 0.5,
                  },
                ]
              : [],
        });
      }

      if (metrics.dormerCheekArea > 0.02) {
        surfaces.push({
          id: `${dormer.id}-cheeks`,
          kind: 'wall',
          component: 'exterior',
          tilt: 90,
          orientation: orientationFromAzimuth((azimuth + 90) % 360),
          azimuth: (azimuth + 90) % 360,
          grossArea: roundCm2(metrics.dormerCheekArea),
          netArea: roundCm2(metrics.dormerCheekArea),
          ...uWertAus([[dormer.frontUValue, 'bauteil']], 0.24),
          thermalBridgeSupplement: defaultTb,
          boundary: 'exterior',
          neighbourTemperature: doc.meta.designOutdoorTemperature,
          openings: [],
        });
        exteriorWallArea += roundCm2(metrics.dormerCheekArea);
      }

      if (metrics.dormerRoofArea > 0.02) {
        surfaces.push({
          id: `${dormer.id}-roof`,
          kind: 'roof',
          component: 'slab',
          // Die Gaubendachneigung folgt aus Tiefe und Höhenunterschied.
          tilt: Math.round(
            (Math.atan2(Math.max(0.05, (dormer.frontHeight ?? 2.2) - roof.kneeHeight), dormer.depth) * 180) /
              Math.PI *
              10,
          ) / 10,
          orientation: orient,
          azimuth,
          grossArea: roundCm2(metrics.dormerRoofArea),
          netArea: roundCm2(metrics.dormerRoofArea),
          ...uWertAus([[dormer.uValue, 'bauteil']], dormer.uValue),
          thermalBridgeSupplement: defaultTb,
          boundary: 'exterior',
          neighbourTemperature: doc.meta.designOutdoorTemperature,
          openings: [],
        });
      }
    }

    if (metrics.flatCeilingArea > 0.05) {
      const collarConstruction = roof.collarConstructionId
        ? (doc.constructions ?? {})[roof.collarConstructionId]
        : undefined;
      surfaces.push({
        id: `${room.id}-collar`,
        kind: 'ceiling',
        component: 'slab',
        tilt: 0,
        grossArea: roundCm2(metrics.flatCeilingArea),
        netArea: roundCm2(metrics.flatCeilingArea),
        ...uWertAus(
          [
            [collarConstruction?.uValue, 'aufbau'],
            [roof.collarUValue, 'bauteil'],
            [room.ceilingUValue, 'bauteil'],
            [ceilingConstruction?.uValue, 'aufbau'],
            [level?.ceilingUValue, 'bauteil'],
          ],
          0.2,
        ),
        construction: collarConstruction?.name ?? ceilingConstruction?.name,
        constructionId: roof.collarConstructionId ?? ceilingConstruction?.id,
        thermalBridgeSupplement: defaultTb,
        boundary: ceiling.boundary,
        neighbourTemperature: ceiling.temperature,
        openings: [],
      });
    }
  } else {
    surfaces.push({
      id: `${room.id}-ceiling`,
      kind: 'ceiling',
      component: 'slab',
      tilt: 0,
      grossArea: ceilingArea,
      netArea: ceilingArea,
      ...uWertAus(
        [
          [room.ceilingUValue, 'bauteil'],
          [ceilingConstruction?.uValue, 'aufbau'],
          [level?.ceilingUValue, 'bauteil'],
        ],
        0.2,
      ),
      construction: ceilingConstruction?.name,
      constructionId: ceilingConstruction?.id,
      thermalBridgeSupplement: defaultTb,
      boundary: ceiling.boundary,
      neighbourTemperature: ceiling.temperature,
      openings: [],
    });
  }

  // --- TGA-Bestand --------------------------------------------------------
  const fixtures = (fixturesByRoom.get(room.id) ?? []).map(toExportFixture);

  let installedHeatingPower = 0;
  let supplyAirflow = 0;
  let exhaustAirflow = 0;
  let transferAirflow = 0;
  for (const f of fixtures) {
    if (f.category === 'heating') installedHeatingPower += heizleistung(f) ?? 0;
    if (f.type === 'air-supply') supplyAirflow += f.params.airflow ?? 0;
    if (f.type === 'air-exhaust') exhaustAirflow += f.params.airflow ?? 0;
    if (f.type === 'air-transfer') transferAirflow += f.params.airflow ?? 0;
  }

  const bridges = detailedBridges ? roomThermalBridges(doc, room, openingIndex) : [];
  // Σψ·l und Hüllfläche dieses Raums. Beide wandern in den Export, weil der
  // gleichwertige Zuschlag sonst nicht nachrechenbar wäre: eine Gegenstelle,
  // die nur einen pauschalen Zuschlag kennt, multipliziert ihn wieder mit
  // der Bezugsfläche — und muss dafür wissen, welche gemeint ist.
  const bridgeHeatLoss = roomBridgeHeatLoss(bridges);
  const bridgeEnvelope = roomEnvelopeArea(doc, room);

  // Wärmerückgewinnung wirkt nur bei einer Zu-/Abluftanlage; eine reine
  // Abluftanlage hat nichts, woraus sie zurückgewinnen könnte.
  const system = doc.meta.ventilation;
  const recovery =
    system?.kind === 'balanced' ? Math.min(0.95, Math.max(0, system.heatRecovery ?? 0)) : 0;

  // B' = A / (0,5 · P). Ohne Erdkontakt bleibt der Wert 0 statt unendlich.
  const characteristicGroundDimension =
    room.groundContactPerimeter > 0 ? roundCm2(room.area / (0.5 * room.groundContactPerimeter)) : 0;

  // Erdberührte Fläche aus der fertigen Flächenliste statt aus einer zweiten
  // Rechnung: so ist sie per Konstruktion die Summe dessen, was exportiert
  // wird, und kann ihr nicht widersprechen.
  const groundContactArea = roundCm2(
    surfaces.reduce((sum, s) => (s.boundary === 'ground' ? sum + s.netArea : sum), 0),
  );

  return {
    id: room.id,
    // Frühere Kennungen nur, wenn es welche gibt: ein leeres Feld an jedem
    // Raum wäre Rauschen in einer Datei, die ohnehin groß genug ist.
    ...(room.altKennungen?.length ? { formerIds: [...room.altKennungen] } : {}),
    // Seit 2.15.0 (Festlegung F5): die Kennung des Raums in RaVia.
    ...(room.raviaRoomId ? { raviaRoomId: room.raviaRoomId } : {}),
    // Steht hier nur, damit der Typ vollständig ist; gebildet wird sie eine
    // Ebene höher über den fertigen Raum. Siehe `raumPruefsumme`.
    checksum: '',
    name: room.name,
    usage: room.usage,
    level: level?.name ?? room.levelId,
    netFloorArea: roundCm2(Math.max(0, room.area - (room.floorOpeningArea ?? 0))),
    floorOpeningArea: roundCm2(room.floorOpeningArea ?? 0),
    solidArea: roundCm2(room.solidArea ?? 0),
    ...(room.unitId ? { occupancyUnitId: room.unitId } : {}),
    roof: metrics
      ? {
          pitch: roof?.pitch ?? 0,
          kneeHeight: roof?.kneeHeight ?? 0,
          minHeight: metrics.minHeight,
          maxHeight: metrics.maxHeight,
          averageHeight: metrics.averageHeight,
          slopedArea: metrics.slopedArea,
          flatCeilingArea: metrics.flatCeilingArea,
          livingArea: metrics.livingArea,
          areaBelow1m: metrics.areaBelow1m,
          skylightArea: metrics.skylightArea,
          dormerVolume: metrics.dormerVolume,
        }
      : undefined,
    levelElevation: roundMm(level?.elevation ?? 0),
    isHeated: room.isHeated,
    area,
    height: roundMm(room.height),
    volume: roundCm2(room.volume),
    perimeter: roundCm2(room.perimeter),
    groundContactPerimeter: roundCm2(room.groundContactPerimeter),
    groundContactArea,
    characteristicGroundDimension,
    exposedFacadeCount: room.exposedFacadeCount,
    setpointTemperature: room.setpointTemperature,
    airChangeRate: room.airChangeRate,
    minimumAirflow: roundCm2(room.volume * room.airChangeRate),
    ...(room.normHeatLoad ? { normHeatLoad: room.normHeatLoad } : {}),
    ...(detailedBridges
      ? {
          thermalBridges: bridges,
          thermalBridgeHeatLoss: bridgeHeatLoss,
          thermalBridgeEnvelopeArea: roundCm2(bridgeEnvelope),
          thermalBridgeEquivalentSupplement: roomEquivalentSupplement(bridgeHeatLoss, bridgeEnvelope),
        }
      : {}),
    ventilation: {
      role: room.ventilationRole ?? 'none',
      supplyAirflow: Math.round(supplyAirflow),
      exhaustAirflow: Math.round(exhaustAirflow),
      transferAirflow: Math.round(transferAirflow),
      // Nur dieser Anteil trägt noch Außenlufttemperatur. Ohne die
      // Rückgewinnung im Datensatz müsste die Gegenstelle den vollen
      // Zuluftstrom rechnen — bei η = 0,8 das Fünffache.
      effectiveSupplyAirflow: Math.round(supplyAirflow * (1 - recovery)),
      minimumAirflow: roundCm2(room.volume * room.airChangeRate),
    },
    windowAreaByOrientation,
    totalWindowArea: roundCm2(totalWindowArea),
    exteriorWallArea: roundCm2(exteriorWallArea),
    surfaces,
    /*
     * Punkt 13: Die Bilanz steht **neben** den Flächen, nicht statt ihrer.
     * Wer die Flächen einzeln übernimmt, braucht sie nicht; wer prüfen will,
     * ob er alle übernommen hat, hat mit ihr eine Zahl statt einer Liste.
     */
    envelope: huellflaechenbilanz(surfaces),
    polygon: room.innerPolygon.map((p) => ({ x: roundMm(p.x), y: roundMm(p.y) })),
    fixtures,
    installedHeatingPower: Math.round(installedHeatingPower),
    supplyAirflow: Math.round(supplyAirflow),
    exhaustAirflow: Math.round(exhaustAirflow),
    // Nur wenn in diesem Raum wirklich Rohr liegt. Eine leere Liste wäre
    // dieselbe Aussage in mehr Zeichen — und im Vergleich zweier Exporte ein
    // Unterschied, der keiner ist.
    ...(rohre.length ? { pipeLengths: rohre } : {}),
  };
}

/**
 * Parameter im Exportformat: an Heizkörpern nach Festlegung F2 die
 * Normleistung 75/65/20 °C (`ratedPower`, auch aus einem nicht migrierten
 * `powerW` umgerechnet) und die Bauart als `panelType` (seit 2.15.0).
 */
function exportParams(f: Fixture): FixtureParams {
  if (!istEn442(f.type)) return { ...f.params };
  const p = migriereParams(f.type, f.params);
  return { ...p, ...(p.radiatorType ? { panelType: p.radiatorType } : {}) };
}

/** Wandelt ein platziertes TGA-Objekt ins Exportformat. */
function toExportFixture(f: Fixture): ExportFixture {
  return {
    id: f.id,
    type: f.type,
    category: f.category,
    label: f.label ?? f.type,
    position: { x: roundMm(f.position.x), y: roundMm(f.position.y) },
    rotation: Math.round(f.rotation * 10) / 10,
    length: roundMm(f.length),
    elevation: roundMm(f.elevation),
    params: exportParams(f),
  };
}
