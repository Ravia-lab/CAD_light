/**
 * RaVia-Export — das Übergabeformat an die Heizlastberechnung.
 * ---------------------------------------------------------------------------
 * Leitgedanke: die Gegenstelle soll **rechnen können, ohne nachzufragen**.
 * Deshalb enthält der Export nicht nur Geometrie, sondern jede Größe, die
 * DIN EN 12831-1 für Transmission, Lüftung und Aufheizung verlangt — und zwar
 * bereits aufbereitet:
 *
 *   • je Raum **alle** Hüllbauteile in einer Liste (Wand, Boden, Decke),
 *     jeweils mit Fläche, U-Wert, Wärmebrückenzuschlag, Randbedingung *und*
 *     der Temperatur auf der anderen Seite. Der Temperatur-Korrekturfaktor
 *     ist damit eine Subtraktion, kein Nachschlagewerk.
 *   • Nachbarraum-Verweise für Innenbauteile — ohne sie lässt sich der
 *     Wärmestrom zwischen unterschiedlich temperierten Räumen nicht bilden.
 *   • Erdreich-Kennwerte: Umfang mit Erdkontakt und daraus B' = A/(0,5·P),
 *     dazu der Baugrund selbst — Bodenart und, falls erfasst, der
 *     Grundwasserstand.
 *   • Lüftung: n_min, daraus der Mindestvolumenstrom, dazu n50, Abschirmung,
 *     Zahl der Außenfassaden und die Höhenlage des Geschosses.
 *   • TGA-Bestand je Raum mit installierter Leistung und Volumenströmen.
 *   • Einheiten und Konventionen stehen **im Dokument**, nicht in einer Doku,
 *     die verloren geht.
 *   • Ein Prüfbericht sagt, worauf man sich verlassen kann.
 *
 * Die Rohgeometrie wandert mit, damit der Export zugleich als verlustfreie
 * Projektdatei taugt.
 */

import type {
  ExportPlant,
  BimDocument,
  BoundaryCondition,
  ExportBuildingTotals,
  ExportFixture,
  ExportHeatPump,
  ExportOpening,
  ExportRoom,
  ExportSurface,
  Fixture,
  Opening,
  FixtureCategory,
  Orientation,
  ExportPipe,
  ExportSolid,
  ExportSubsoil,
  ExportVertical,
  PipeRun,
  PipeScheduleEntry,
  RaviaExport,
  RoofDefinition,
  SetbackTotals,
  ThermalBridgeKind,
  ThermalBridgeTotals,
  Vec2,
  VentilationRole,
  VentilationTotals,
  Room,
  SolidElement,
  VerticalElement,
} from '../types/bim';
import { SOIL_LABELS } from '../types/bim';
import {
  azimuthFromNormal,
  distance,
  distanceToSegment,
  normalize,
  orientationFromAzimuth,
  pointInPolygon,
  polygonPerimeter,
  roundCm2,
  roundMm,
  sub,
} from './geometry';
import { solidFootprint } from './verticalSymbols';
import { getWallGeometry, indexOpeningsByWall, openingsOf, openingSpan } from './wallGeometry';
import { gradeSplit, isMassiveArea } from './roomDetection';
import { validateModel } from './validation';
import { buildRoofFrame, roofFaceAzimuthAt } from './roofGeometry';
import {
  envelopeArea,
  roomEnvelopeArea,
  roomEquivalentSupplement,
  roomThermalBridges,
  roomBridgeHeatLoss,
} from './thermalBridges';
import { buildPipeNetwork } from './pipeNetwork';
import { designPlant } from './plantDesign';
import {
  acousticReport,
  blockingFactor,
  IMMISSION_LIMITS,
  polygonArea,
  protectionIssues,
  sourceDemand,
} from './heatPump';

export const GENERATOR = 'RaVia CAD Light 1.14.0';

/** Fallback-U-Werte [W/(m²·K)], falls am Bauteil nichts hinterlegt ist. */
const DEFAULT_U = {
  exterior: 0.24,
  interior: 1.2,
  partition: 1.4,
  shaft: 1.4,
  window: 0.95,
  door: 1.6,
  /** Ein Durchgang ist keine Bauteilfläche — er wird nur als Loch abgezogen. */
  passage: 0,
} as const;

export function buildRaviaExport(doc: BimDocument): RaviaExport {
  /*
   * Massive Flächen sind keine Räume.
   *
   * Im Regelfall hat der Store sie schon aussortiert (siehe
   * `isMassiveArea`); ein von außen eingelesenes Dokument kann sie aber noch
   * führen. Sie hier stehen zu lassen hieße, den Kaminzug als Aufenthaltsraum
   * zu übergeben — mit Solltemperatur, Luftwechsel und Heizlast.
   */
  const rooms = Object.values(doc.rooms).filter((r) => !isMassiveArea(r));
  // Einmal indizieren statt je Wandabschnitt die ganze Liste zu durchsuchen.
  const openingIndex = indexOpeningsByWall(Object.values(doc.openings));
  const heatedByLevel = heatedTemperatureByLevel(doc);
  const fixturesByRoom = groupFixturesByRoom(doc);
  const exportRooms = rooms.map((room) =>
    buildRoom(doc, room, openingIndex, heatedByLevel, fixturesByRoom),
  );
  const subsoil = buildSubsoil(doc, exportRooms);

  return {
    schema: 'ravia.bim.light',
    version: '2.0.0',
    generator: GENERATOR,
    exportedAt: new Date().toISOString(),
    units: {
      length: 'm',
      area: 'm2',
      volume: 'm3',
      temperature: 'degC',
      uValue: 'W/(m2K)',
      power: 'W',
      airflow: 'm3/h',
      angle: 'deg',
    },
    conventions: {
      azimuth:
        'Azimut der raumabgewandten Bauteilnormalen in Grad: 0 = Nord, 90 = Ost, im Uhrzeigersinn. Die Nordabweichung des Grundrisses (project.northAngle) ist bereits eingerechnet.',
      coordinates:
        'Weltkoordinaten in Metern, +x = Osten, +y = Norden. Raumpolygone sind lichte Innenkanten, gegen den Uhrzeigersinn, ohne Wiederholung des Startpunkts.',
      areas:
        'grossArea = Rohbaufläche des Bauteils, netArea = abzüglich aller Öffnungen. Raumflächen sind lichte Maße (Achsmaße abzüglich der halben Wandstärken).',
      boundaries:
        'neighbourTemperature ist die Temperatur auf der raumabgewandten Seite: Norm-Außentemperatur bei exterior, Erdreichtemperatur bei ground, project.unheatedTemperature bei unheated, die Solltemperatur des Nachbarraums bei adjacent-room.',
      groundContact:
        'Was unter project.terrainElevation liegt, grenzt an Erdreich. Eine teilweise eingegrabene Wand erscheint deshalb als zwei Flächen: der Teil unter Gelände mit boundary "ground" und der ID <wandId>-ground, der Teil darüber mit boundary "exterior" und der ID der Wand. Ihre Flächen ergeben zusammen wieder die Wandfläche. groundContact.embedmentDepth ist die Tiefe der Bauteilunterkante unter Gelände; die Faktoren f_g1, f_g2 und G_w nach DIN EN 12831-1 werden hier bewusst nicht gebildet — geliefert werden nur ihre Eingangsgrößen. Fehlt project.terrainElevation, ist keine Geländeoberkante erfasst und nichts wird als erdberührt gerechnet. Die Beschaffenheit des Baugrunds — Bodenart und Grundwasserstand — steht in subsoil.',
      ventilation:
        'rooms[].airChangeRate ist n_min, der hygienische Mindestluftwechsel aus der Nutzung [1/h] — nicht die Infiltration. rooms[].ventilation.minimumAirflow ist derselbe Wert als Volumenstrom (Raumvolumen · n_min), dieselbe Größe und keine zweite. supplyAirflow, exhaustAirflow und transferAirflow sind die Summen der im Plan platzierten Zuluft-, Abluft- und Überströmelemente des Raums, also der Anlagenstrom. Mindeststrom und Anlagenstrom beschreiben denselben Luftwechsel und werden nicht addiert: maßgebend ist der größere von beiden — ein Mindeststrom ist eine Untergrenze, keine Zugabe. Bei Wärmerückgewinnung gilt entweder effectiveSupplyAirflow = supplyAirflow · (1 − η) — nur dieser Anteil trägt noch Außenlufttemperatur — oder supplyAirflow mit einer eigenen Rückgewinnungsrechnung aus totals.ventilation.heatRecovery; beides zusammen zieht η zweimal ab. η ist nur bei totals.ventilation.kind = "balanced" von 0 verschieden, weil eine reine Abluftanlage nichts zurückzugewinnen hat. Ein Abluftraum (ventilation.role = "exhaust", also Bad, WC, Küche) bezieht seine Luft über den Überströmweg aus den Zulufträumen; sie ist dort bereits erwärmt worden. Sein exhaustAirflow ist deshalb Fortluft und kein Außenluftstrom — wer ihn als Außenluft ansetzt, überschätzt die Heizlast dieses Raums erheblich. Die Außenluftbilanz des Gebäudes steht in totals.ventilation: balance = supplyAirflow − exhaustAirflow, und was dort nicht bei 0 steht, geht ungewärmt durch die Gebäudehülle. Die Infiltration rechnet dieser Export nicht; geliefert werden nur ihre Eingangsgrößen project.n50, project.shielding, rooms[].exposedFacadeCount und rooms[].levelElevation.',
      subsoil:
        'subsoil sind die Erfassungsgrößen des Baugrunds, nicht seine Kennwerte. soil ist die Bodenart aus dem Lageplan (dry = trocken/sandig, normal = bindig-feucht, conductive = Festgestein, saturated = wassergesättigter Sand/Kies), soilLabel derselbe Wert im Klartext; sie ist eine Eingabe mit der Vorbelegung "normal" — ob sie erkundet oder belassen wurde, unterscheidet dieser Export nicht und behauptet es auch nicht. groundwaterDepth dagegen hat keine Vorbelegung: es ist der Grundwasserstand als Tiefe unter Geländeoberkante [m], positiv nach unten, und fehlt, solange er nicht erfasst ist. Ohne ihn lässt sich nicht entscheiden, ob die Korrektur G_w nach DIN EN ISO 13370 überhaupt greift — zu halten ist er gegen deepestEmbedment, die größte Einbindetiefe eines erdberührten Bauteils. Wärmeleitfähigkeiten λ des Bodens liefert dieser Export nicht: ihre Tabelle gehört zur Norm und ist nicht frei zitierbar, die Bodenart benennt nur die Zeile. Der ganze Block fehlt, wenn das Gebäude das Erdreich nirgends berührt und kein Grundwasserstand erfasst ist — dann gibt es nichts zu korrigieren und nichts zu berichten.',
      solids:
        'solids sind massive Bauteile ohne Raumfunktion — Kamin, Pfeiler, Wandversatz, Installationsblock. Ihre Grundfläche ist aus der Raumfläche und aus dem Luftvolumen herausgerechnet (rooms[].floorOpeningArea enthält sie, rooms[].solidArea nennt ihren Anteil); die Deckenfläche des Raums bleibt ungeschmälert, weil dort Mauerwerk und kein Luftraum steht. thermalBridge liefert nur Eingangsgrößen: atExteriorWall und die Berührungslänge contactLength [m]. Ein ψ-Wert wird hier nicht gebildet — er hängt an Aufbau, Zug und Dämmung des Bauteils und steht in keiner frei zitierbaren Tabelle.',
    },
    project: { ...doc.meta },
    ...(subsoil ? { subsoil } : {}),
    levels: Object.values(doc.levels).sort((a, b) => a.order - b.order),
    constructions: Object.values(doc.constructions ?? {}),
    verticals: buildVerticals(doc),
    solids: buildSolids(doc),
    pipes: buildPipes(doc),
    pipeSchedule: buildPipeSchedule(doc),
    pipeNetwork: buildPipeNetwork(doc),
    ...(Object.keys(doc.site?.pumps ?? {}).length || Object.keys(doc.site?.elements ?? {}).length
      ? { heatPump: buildHeatPumpExport(doc) }
      : {}),
    ...(hasPlant(doc) ? { plant: buildPlantExport(doc) } : {}),
    rooms: exportRooms,
    totals: buildTotals(doc, exportRooms, Object.values(doc.fixtures)),
    validation: validateModel(doc),
    geometry: {
      nodes: Object.values(doc.nodes),
      walls: Object.values(doc.walls),
      openings: Object.values(doc.openings),
      fixtures: Object.values(doc.fixtures),
      verticals: Object.values(doc.verticals ?? {}),
      solids: Object.values(doc.solids ?? {}),
      pipes: Object.values(doc.pipes ?? {}),
      annotations: Object.values(doc.annotations ?? {}),
      roofOpenings: Object.values(doc.roofOpenings ?? {}),
    },
  };
}

/**
 * Der Baugrund für den Export.
 *
 * Die Bodenart steht im Modell, seit die Wärmequelle der Wärmepumpe ausgelegt
 * wird — sie war dort aber eingesperrt. Für die Erdreichrechnung nach
 * DIN EN ISO 13370 ist sie ebenso eine Eingangsgröße, und der Grundwasserstand
 * ist diejenige, die die Korrektur G_w überhaupt erst auslöst. Beides gehört
 * deshalb in den Export, und zwar als Erfassung: gerechnet wird hier nichts.
 * λ-Werte kommen keine vor — ihre Tabelle gehört zur Norm.
 *
 * `undefined`, solange es nichts zu berichten gibt. Zwei Fälle lösen den Block
 * aus: das Gebäude berührt das Erdreich — dann braucht die Gegenstelle den
 * Baugrund, und sei es, um ihn zu verwerfen —, oder ein Grundwasserstand ist
 * erfasst; der wurde bewusst eingetragen und darf nicht unterschlagen werden.
 * Berührt kein Bauteil das Erdreich und ist nichts erfasst, verhält sich das
 * Dokument exakt wie vor der Einführung dieses Blocks: dann stünde dort nur
 * eine Vorbelegung ohne Frage, auf die sie antwortet.
 *
 * Die Bodenart selbst ist eine Eingabe mit Vorbelegung („normal"); dass sie
 * eine ist, steht in `conventions.subsoil` und wird mit ausgeliefert. Der
 * Grundwasserstand hat keine Vorbelegung — er fehlt lieber.
 */
function buildSubsoil(doc: BimDocument, rooms: ExportRoom[]): ExportSubsoil | undefined {
  const site = doc.site;
  if (!site) return undefined;

  // Beide Größen aus der fertigen Flächenliste statt aus einer zweiten
  // Rechnung: so können sie dem widersprechen, was daneben im Dokument steht.
  let groundContactArea = 0;
  let deepestEmbedment = 0;
  for (const room of rooms) {
    groundContactArea += room.groundContactArea;
    for (const surface of room.surfaces) {
      const depth = surface.groundContact?.embedmentDepth ?? 0;
      if (depth > deepestEmbedment) deepestEmbedment = depth;
    }
  }

  if (groundContactArea <= 0 && site.groundwaterDepth === undefined) return undefined;

  return {
    soil: site.soil,
    soilLabel: SOIL_LABELS[site.soil],
    ...(site.groundwaterDepth !== undefined
      ? { groundwaterDepth: roundMm(site.groundwaterDepth) }
      : {}),
    ...(site.groundwaterAzimuth !== undefined
      ? { groundwaterAzimuth: site.groundwaterAzimuth }
      : {}),
    ...(doc.meta.terrainElevation !== undefined
      ? { terrainElevation: roundMm(doc.meta.terrainElevation) }
      : {}),
    deepestEmbedment: roundMm(deepestEmbedment),
    groundContactArea: roundCm2(groundContactArea),
  };
}

/**
 * Ist überhaupt eine Anlage geplant?
 *
 * Ein leeres Anlagenblatt gehört nicht in den Export: die Gegenseite müsste
 * dann unterscheiden, ob „kein Gerät" heißt *es gibt keines* oder *es wurde
 * noch nicht ausgewählt*. Der Block fehlt lieber ganz.
 */
function hasPlant(doc: BimDocument): boolean {
  const p = doc.plant;
  if (!p) return false;
  return Boolean(
    p.generatorModelId ||
      Object.keys(p.storages).length ||
      Object.keys(p.circuits).length ||
      Object.keys(p.schematic.components).length,
  );
}

/**
 * Die Anlagentechnik für den Export zusammenstellen.
 *
 * Gerechnet wird hier nichts, was nicht ohnehin gerechnet würde: die
 * Auslegung läuft einmal über `designPlant` und wird abgeschrieben. Damit
 * steht in der Datei genau das, was im Anlagenblatt auf dem Bildschirm steht —
 * eine zweite Rechenstrecke im Export wäre eine zweite Fehlerquelle.
 */
function buildPlantExport(doc: BimDocument): ExportPlant {
  const p = doc.plant;
  const design = designPlant(doc, { heatLoad: p.heatLoadOverride, extraModels: p.extraModels });
  const model = design.selected?.model;
  return {
    generator: model
      ? {
          modelId: model.id,
          label: model.label,
          form: model.form,
          source: model.source,
          refrigerant: model.refrigerant,
          refrigerantMass: model.refrigerantMass,
          nominalCapacity: model.nominalCapacity,
          nominalPoint: model.nominalPoint,
          capacityAtDesign: design.selected?.capacityAtDesign ?? model.nominalCapacity,
          maxFlowTemperature: model.maxFlowTemperature,
          scop35: model.scop35,
          provenance: model.provenance,
          manufacturer: model.manufacturer,
        }
      : undefined,
    storages: Object.values(p.storages).map((s2) => ({
      id: s2.id,
      label: s2.label,
      kind: s2.kind,
      volume: s2.volume,
      roomId: s2.roomId,
      suggested: s2.suggested,
    })),
    design: p.design,
    circuits: design.circuits.map((c) => c.circuit),
    safety: design.safety,
    domesticHotWater: design.dhw,
    schematic: {
      components: Object.values(p.schematic.components),
      links: Object.values(p.schematic.links),
    },
  };
}

/** Temperatur auf der raumabgewandten Seite eines Bauteils. */
function neighbourTemperature(
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
      return doc.meta.unheatedTemperature;
    case 'adjacent-room': {
      const neighbour = neighbourRoomId ? doc.rooms[neighbourRoomId] : undefined;
      return neighbour?.setpointTemperature ?? doc.meta.unheatedTemperature;
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
function heatedTemperatureByLevel(doc: BimDocument): Map<string, number> {
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
      return { boundary: 'unheated', temperature: doc.meta.unheatedTemperature };
    }
    const sameTemperature = Math.abs(avg - room.setpointTemperature) < 0.5;
    return {
      boundary: sameTemperature ? 'adiabatic' : 'adjacent-room',
      temperature: sameTemperature ? room.setpointTemperature : Math.round(avg * 10) / 10,
    };
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
function isGableOpening(op: ExportOpening, roof: RoofDefinition | undefined): boolean {
  if (!roof) return false;
  const centre = (op.sillHeight ?? 0) + op.height / 2;
  return centre > roof.kneeHeight;
}

/** Trassenlänge einer Polylinie [m]. */
function polylineLength(points: readonly { x: number; y: number }[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return total;
}

function buildVerticals(doc: BimDocument): ExportVertical[] {
  return Object.values(doc.verticals ?? {}).map((v: VerticalElement) => {
    const room = Object.values(doc.rooms).find(
      (r) => r.levelId === v.levelId && r.innerPolygon.length >= 3 && pointInPolygon(v.position, r.innerPolygon),
    );
    return {
      id: v.id,
      kind: v.kind,
      name: v.name,
      level: doc.levels[v.levelId]?.name ?? v.levelId,
      toLevel: v.toLevelId ? doc.levels[v.toLevelId]?.name : undefined,
      area: roundCm2(v.width * v.length),
      width: roundMm(v.width),
      length: roundMm(v.length),
      steps: v.steps,
      service: v.service,
      deductsArea: v.deductsArea,
      openToAbove: v.openToAbove,
      roomId: room?.id,
    };
  });
}

/**
 * Größte Abweichung [m], bei der eine Grundrisskante noch als „liegt an der
 * Wand" gilt.
 *
 * Keine Normgröße, sondern eine Zeichentoleranz: ein Kamin wird an die
 * Wandinnenkante gesetzt, nicht auf sie gerechnet. Sechs Zentimeter fangen
 * das Rastermaß (5 cm) mit ab und sind schmal genug, dass ein frei im Raum
 * stehender Pfeiler nicht versehentlich als Wärmebrücke erscheint.
 */
const SOLID_WALL_TOUCH_TOLERANCE = 0.06;

/**
 * Massive Bauteile für den Export — samt der Eingangsgrößen ihrer Wärmebrücke.
 *
 * **Was hier gerechnet wird und was nicht.** Ein Schornstein in der Außenwand
 * ist eine Wärmebrücke; sein längenbezogener Wärmedurchgangskoeffizient ψ
 * hängt an Zugquerschnitt, Schamotte, Dämmschale und Anschlussausbildung und
 * steht in keiner frei zitierbaren Tabelle. Er wird deshalb **nicht** gebildet.
 * Geliefert wird stattdessen, was die Gegenstelle braucht, um ihn zu bilden:
 * ob das Bauteil eine Außenwand berührt, wie lang die Berührung ist und
 * welche Wände es sind.
 *
 * Berührung heißt: eine Kante des Grundrisses liegt auf der raumseitigen
 * Fläche einer Außenwand, also im Abstand einer halben Wandstärke von deren
 * Achse. Gemessen wird an der Kantenmitte; die Toleranz steht darüber.
 */
function buildSolids(doc: BimDocument): ExportSolid[] {
  const order = Object.values(doc.levels).sort((a, b) => a.order - b.order);
  const rank = new Map(order.map((l, i) => [l.id, i]));

  return Object.values(doc.solids ?? {}).map((b: SolidElement) => {
    const outline = solidFootprint(b);
    const area = polygonArea(outline);
    const own = doc.levels[b.levelId];

    // Durchlaufene Geschosse: das eigene und — beim Schornstein — jedes
    // darüber. Aus ihnen folgt auch das Bauvolumen, denn die Geschosse sind
    // nicht gleich hoch (ein Keller ist niedriger als ein Wohngeschoss).
    const here = rank.get(b.levelId);
    const spanned = order.filter((l, i) => l.id === b.levelId || (b.throughAllLevels && here !== undefined && i > here));
    const volume = spanned.reduce((sum, l) => sum + area * (b.height ?? l.height), 0);

    // --- Wärmebrücke: Berührung mit Außenwänden ---------------------------
    const walls = Object.values(doc.walls).filter((w) => w.levelId === b.levelId && w.type === 'exterior');
    const touched = new Set<string>();
    let contactLength = 0;
    for (let i = 0; i < outline.length; i++) {
      const p = outline[i];
      const q = outline[(i + 1) % outline.length];
      const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
      let hit: string | undefined;
      for (const w of walls) {
        const g = getWallGeometry(w, doc.nodes);
        if (!g) continue;
        if (Math.abs(distanceToSegment(mid, g.a, g.b) - g.halfThickness) > SOLID_WALL_TOUCH_TOLERANCE) continue;
        hit = w.id;
        break;
      }
      if (!hit) continue;
      touched.add(hit);
      contactLength += distance(p, q);
    }

    const room = Object.values(doc.rooms).find(
      (r) => r.levelId === b.levelId && r.innerPolygon.length >= 3 && pointInPolygon(b.position, r.innerPolygon),
    );

    return {
      id: b.id,
      kind: b.kind,
      name: b.name,
      level: own?.name ?? b.levelId,
      levels: spanned.map((l) => l.name),
      outline: outline.map((p) => ({ x: roundMm(p.x), y: roundMm(p.y) })),
      area: roundCm2(area),
      perimeter: roundCm2(polygonPerimeter(outline)),
      height: roundMm(b.height ?? own?.height ?? 2.75),
      volume: roundCm2(volume),
      material: b.material,
      roomId: room?.id,
      thermalBridge: {
        atExteriorWall: touched.size > 0,
        contactLength: roundCm2(contactLength),
        wallIds: [...touched],
      },
    };
  });
}

function buildPipes(doc: BimDocument): ExportPipe[] {
  return Object.values(doc.pipes ?? {}).map((run: PipeRun) => ({
    id: run.id,
    service: run.service,
    level: doc.levels[run.levelId]?.name ?? run.levelId,
    nominalDiameter: run.nominalDiameter,
    insulation: run.insulation,
    elevation: roundMm(run.elevation),
    length: roundCm2(polylineLength(run.points)),
    points: run.points,
    fromFixtureId: run.fromFixtureId,
    toFixtureId: run.toFixtureId,
    label: run.label,
  }));
}

/**
 * Der Längenauszug: Meter je Gewerk, Nennweite und Dämmstärke.
 *
 * Das ist die Zahl, die man tatsächlich braucht — für den hydraulischen
 * Abgleich, für die Rohrwärmeabgabe und für die Massenermittlung. Einzelne
 * Abschnitte interessieren dort niemanden, die Summe je DN schon.
 */
function buildPipeSchedule(doc: BimDocument): PipeScheduleEntry[] {
  const map = new Map<string, PipeScheduleEntry>();
  for (const run of Object.values(doc.pipes ?? {})) {
    const key = `${run.service}|${run.nominalDiameter}|${run.insulation}`;
    const length = polylineLength(run.points);
    const entry = map.get(key);
    if (entry) {
      entry.length = roundCm2(entry.length + length);
      entry.runs += 1;
    } else {
      map.set(key, {
        service: run.service,
        nominalDiameter: run.nominalDiameter,
        insulation: run.insulation,
        length: roundCm2(length),
        runs: 1,
      });
    }
  }
  return [...map.values()].sort(
    (a, b) => a.service.localeCompare(b.service) || a.nominalDiameter - b.nominalDiameter,
  );
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
  const roof = level?.roof;
  if (!roof) return 0;

  const outline: Vec2[] = [];
  for (const w of Object.values(doc.walls)) {
    if (w.levelId !== room.levelId) continue;
    const a = doc.nodes[w.a];
    const b = doc.nodes[w.b];
    if (a) outline.push({ x: a.x, y: a.y });
    if (b) outline.push({ x: b.x, y: b.y });
  }
  const frame = buildRoofFrame(roof, outline);
  return frame ? roofFaceAzimuthAt(frame, opening.position) : roof.azimuth;
}

function buildRoom(
  doc: BimDocument,
  room: Room,
  openingIndex: Map<string, Opening[]>,
  heatedByLevel: Map<string, number>,
  fixturesByRoom: Map<string, Fixture[]>,
): ExportRoom {
  const surfaces: ExportSurface[] = [];
  const windowAreaByOrientation: Partial<Record<Orientation, number>> = {};
  let totalWindowArea = 0;
  let exteriorWallArea = 0;

  const level = doc.levels[room.levelId];
  // Im detaillierten Verfahren steckt der Zuschlag nicht mehr im U-Wert der
  // Fläche, sondern in den Anschlusslängen weiter unten. Bliebe er hier
  // stehen, wäre er doppelt gezählt.
  const detailedBridges = doc.meta.thermalBridgeMethod === 'detailed';
  const defaultTb = detailedBridges ? 0 : doc.meta.thermalBridgeSupplement;
  const roof = level?.roof && level.roof.kind !== 'flat' ? level.roof : undefined;
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
        uValue: opConstruction?.uValue ?? op.uValue ?? DEFAULT_U[op.kind],
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
    const wallOpenings = segmentOpenings.filter((o) => !isGableOpening(o, roof));
    // Unter einer Dachschräge endet die eigentliche Wand am Kniestock;
    // was darüber liegt, ist der Giebel und wird gleich eigens ausgewiesen.
    const wallGross = gable > 0 ? roundCm2(grossArea - gable) : grossArea;
    // Ist dem Bauteil ein Aufbau aus dem Katalog zugewiesen, gilt dessen
    // U-Wert. Sonst gäbe es zwei Wahrheiten, und die Katalogpflege ginge
    // an den Wänden vorbei, die sie eigentlich beschreibt.
    const wallU = wallConstruction?.uValue ?? wall.uValue ?? DEFAULT_U[wall.type];
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
        construction: wallConstruction?.name,
        constructionId: wall.constructionId,
        thermalBridgeSupplement: wallTb,
        boundary: boundary.boundary,
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
      const gableOpenings = segmentOpenings.filter((o) => isGableOpening(o, roof));
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
        uValue: gableConstruction?.uValue ?? roof?.gableUValue ?? wallConstruction?.uValue ?? wall.uValue ?? DEFAULT_U[wall.type],
        construction: gableConstruction?.name,
        constructionId: roof?.gableConstructionId,
        thermalBridgeSupplement: detailedBridges ? 0 : (wall.thermalBridgeSupplement ?? defaultTb),
        boundary: boundary.boundary,
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
    uValue: room.floorUValue ?? floorConstruction?.uValue ?? level?.floorUValue ?? 0.3,
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
        uValue: roofConstruction?.uValue ?? roof.uValue,
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
          uValue: dormer.frontUValue ?? 0.24,
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
          uValue: dormer.frontUValue ?? 0.24,
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
          uValue: dormer.uValue,
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
        uValue:
          collarConstruction?.uValue ??
          roof.collarUValue ??
          room.ceilingUValue ??
          ceilingConstruction?.uValue ??
          level?.ceilingUValue ??
          0.2,
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
      uValue: room.ceilingUValue ?? ceilingConstruction?.uValue ?? level?.ceilingUValue ?? 0.2,
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
    if (f.category === 'heating') installedHeatingPower += f.params.powerW ?? 0;
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
  const bridgeEnvelope = roomEnvelopeArea(room);

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
    name: room.name,
    usage: room.usage,
    level: level?.name ?? room.levelId,
    netFloorArea: roundCm2(Math.max(0, room.area - (room.floorOpeningArea ?? 0))),
    floorOpeningArea: roundCm2(room.floorOpeningArea ?? 0),
    solidArea: roundCm2(room.solidArea ?? 0),
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
    polygon: room.innerPolygon.map((p) => ({ x: roundMm(p.x), y: roundMm(p.y) })),
    fixtures,
    installedHeatingPower: Math.round(installedHeatingPower),
    supplyAirflow: Math.round(supplyAirflow),
    exhaustAirflow: Math.round(exhaustAirflow),
  };
}

/** TGA-Objekte einmal nach Raum sortieren statt je Raum alle zu filtern. */
function groupFixturesByRoom(doc: BimDocument): Map<string, Fixture[]> {
  const out = new Map<string, Fixture[]>();
  for (const f of Object.values(doc.fixtures)) {
    if (!f.roomId) continue;
    const list = out.get(f.roomId);
    if (list) list.push(f);
    else out.set(f.roomId, [f]);
  }
  return out;
}

/**
 * Wärmepumpe und Außenanlage für den Export.
 *
 * Bewusst mit *Nachweis*, nicht nur mit Gerätedaten: der Schallnachweis ist
 * die Angabe, die bei der Genehmigung verlangt wird, und sie lässt sich aus
 * den Rohdaten allein nicht wiederherstellen, ohne die Aufstellsituation zu
 * kennen. Die Rohgrößen stehen trotzdem daneben — die Gegenstelle soll
 * nachrechnen können.
 */
function buildHeatPumpExport(doc: BimDocument): ExportHeatPump {
  const site = doc.site;
  const boundary = Object.values(site.elements).find((e) => e.kind === 'boundary');
  return {
    site: {
      areaCategory: site.areaCategory,
      immissionLimits: IMMISSION_LIMITS[site.areaCategory],
      state: site.state,
      soil: site.soil,
      waterProtection: site.waterProtection,
      sourceRunHours: site.sourceRunHours,
      ...(boundary && boundary.points.length >= 3
        ? { plotArea: roundCm2(polygonArea(boundary.points)) }
        : {}),
    },
    pumps: Object.values(site.pumps).map((pump) => {
      const report = acousticReport(doc, pump);
      const demand = sourceDemand(doc, pump);
      return {
        id: pump.id,
        label: pump.label,
        source: pump.source,
        form: pump.form,
        heatingCapacity: pump.heatingCapacity,
        ratingPoint: pump.ratingPoint,
        cop: pump.cop,
        operation: pump.operation,
        bivalencePoint: pump.bivalencePoint,
        backupCapacity: pump.backupCapacity,
        flowTemperature: pump.flowTemperature,
        refrigerant: pump.refrigerant,
        refrigerantMass: pump.refrigerantMass,
        gridRegime: pump.gridRegime,
        blockedHours: pump.blockedHours,
        blockingFactor: pump.gridRegime === 'evu-3x2h' ? blockingFactor(pump.blockedHours) : 1,
        domesticHotWater: pump.domesticHotWater,
        occupants: pump.occupants,
        acoustics: {
          soundPower: report.soundPower,
          roomAngle: report.roomAngle,
          toneSurcharge: pump.toneSurcharge,
          limitNight: report.limitNight,
          limitDistance: report.limitDistance,
          safeDistance: report.safeDistance,
          points: report.points.map((p) => ({
            label: p.label,
            origin: p.origin,
            distance: p.distance,
            level: p.level,
            limit: p.limit,
            verdict: p.verdict,
          })),
        },
        protectionIssues: protectionIssues(doc, pump),
        ...(demand ? { source_demand: demand } : {}),
      };
    }),
    elements: Object.values(site.elements),
  };
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
    params: { ...f.params },
  };
}

function buildTotals(
  doc: BimDocument,
  rooms: ExportRoom[],
  allFixtures: Fixture[],
): ExportBuildingTotals {
  let netFloorArea = 0;
  let grossFloorArea = 0;
  let netVolume = 0;
  let exteriorWallArea = 0;
  let windowArea = 0;
  let installedHeatingPower = 0;
  let heatedRoomCount = 0;
  let heatedVolume = 0;

  for (const room of rooms) {
    installedHeatingPower += room.installedHeatingPower;
    netFloorArea += room.area;
    netVolume += room.volume;
    exteriorWallArea += room.exteriorWallArea;
    windowArea += room.totalWindowArea;
    if (room.isHeated) {
      heatedRoomCount++;
      heatedVolume += room.volume;
    }
    // Bruttofläche grob über den Umfang und eine mittlere Wandstärke von 24 cm
    grossFloorArea += room.area + room.perimeter * 0.12;
  }

  const envelope = exteriorWallArea + netFloorArea * 2; // Wände + Boden + Decke

  // Für die Wärmebrücken-Bilanz zählt die Hüllfläche, wie sie auch das
  // Panel bildet — sonst widerspräche der Vergleich auf dem Bildschirm dem
  // in der Datei.
  const bridgeEnvelope = envelopeArea(doc);

  return {
    thermalBridges: bridgeTotals(doc, rooms, bridgeEnvelope),
    setback: setbackTotals(doc, rooms, bridgeEnvelope),
    ventilation: ventilationTotals(doc, rooms),
    roomCount: rooms.length,
    heatedRoomCount,
    heatedVolume: roundCm2(heatedVolume),
    netFloorArea: roundCm2(netFloorArea),
    grossFloorArea: roundCm2(grossFloorArea),
    netVolume: roundCm2(netVolume),
    exteriorWallArea: roundCm2(exteriorWallArea),
    windowArea: roundCm2(windowArea),
    windowWallRatio:
      exteriorWallArea + windowArea > 0
        ? Math.round((windowArea / (exteriorWallArea + windowArea)) * 1000) / 1000
        : 0,
    compactness: netVolume > 0 ? Math.round((envelope / netVolume) * 1000) / 1000 : 0,
    installedHeatingPower,
    fixtureCount: countByCategory(allFixtures),
  };
}

/**
 * Wärmebrücken über alle Räume. Die Bilanz wird *immer* gebildet, auch im
 * pauschalen Verfahren — nur so lässt sich sehen, ob die gewählte Pauschale
 * für dieses Gebäude zu groß oder zu klein ist. Übernommen in die Rechnung
 * wird trotzdem nur eines von beiden.
 */
function bridgeTotals(
  doc: BimDocument,
  rooms: ExportRoom[],
  envelopeArea: number,
): ThermalBridgeTotals {
  const lengthsByKind: Partial<Record<ThermalBridgeKind, number>> = {};
  const openingIndex = indexOpeningsByWall(Object.values(doc.openings));
  let detailed = 0;

  for (const room of rooms) {
    const source = doc.rooms[room.id];
    const bridges = room.thermalBridges ?? (source ? roomThermalBridges(doc, source, openingIndex) : []);
    for (const b of bridges) {
      detailed += b.heatLossCoefficient;
      lengthsByKind[b.kind] = roundCm2((lengthsByKind[b.kind] ?? 0) + b.length);
    }
  }

  const supplement = doc.meta.thermalBridgeSupplement;
  return {
    method: doc.meta.thermalBridgeMethod ?? 'flat',
    category: doc.meta.thermalBridgeCategory ?? 'none',
    supplement,
    envelopeArea: roundCm2(envelopeArea),
    detailedHeatLoss: roundCm2(detailed),
    flatHeatLoss: roundCm2(supplement * envelopeArea),
    equivalentSupplement:
      envelopeArea > 0.01 ? Math.round((detailed / envelopeArea) * 10000) / 10000 : 0,
    lengthsByKind,
  };
}

/** Wirksame Speicherfähigkeit c_wirk je Bauart [Wh/(m³·K)]. */
const HEAT_CAPACITY = { light: 15, medium: 42, heavy: 70 } as const;

/**
 * Absenkbetrieb. Erfasst werden Eingangsgrößen; abgeleitet werden nur die
 * beiden Größen, die aus dem Modell selbst folgen — die Zeitkonstante des
 * Gebäudes und der Temperaturabfall, der sich in der Absenkzeit einstellt.
 *
 * Der Wiederaufheizfaktor f_RH selbst kommt aus einer Tabelle der geltenden
 * Norm und wird hier *nicht* geraten: in Deutschland ist er national auf 0
 * gesetzt, und eine erfundene Tabelle wäre schlimmer als gar keine. Wer einen
 * Wert vorgibt, bekommt die Leistung ausgewiesen.
 */
function setbackTotals(
  doc: BimDocument,
  rooms: ExportRoom[],
  envelopeArea: number,
): SetbackTotals | undefined {
  const setback = doc.meta.setback;
  if (!setback?.active) return undefined;

  const heatedVolume = rooms.reduce((sum, r) => sum + (r.isHeated ? r.volume : 0), 0);
  const floorArea = rooms.reduce((sum, r) => sum + (r.isHeated ? (r.netFloorArea ?? r.area) : 0), 0);

  // H_Abs: Transmission über die Hüllfläche plus Lüftung mit dem
  // Absenk-Luftwechsel. Ein mittlerer U-Wert reicht hier — die Zeitkonstante
  // reagiert darauf logarithmisch, nicht linear.
  const meanU = meanEnvelopeUValue(rooms);
  const transmission = meanU * envelopeArea;
  const ventilation = 0.34 * setback.airChangeRate * heatedVolume;
  const heatLossCoefficient = transmission + ventilation;

  const capacity = HEAT_CAPACITY[setback.massClass];
  const timeConstant = heatLossCoefficient > 0.01 ? (capacity * heatedVolume) / heatLossCoefficient : 0;
  const drop =
    timeConstant > 0.01
      ? (doc.meta.designIndoorTemperature - doc.meta.designOutdoorTemperature) *
        (1 - Math.exp(-setback.hours / timeConstant))
      : 0;

  const reheatFactor = doc.meta.reheatFactor ?? 0;
  return {
    active: true,
    hours: setback.hours,
    reheatHours: setback.reheatHours,
    airChangeRate: setback.airChangeRate,
    massClass: setback.massClass,
    effectiveHeatCapacity: capacity,
    heatLossCoefficient: roundCm2(heatLossCoefficient),
    timeConstant: roundCm2(timeConstant),
    temperatureDrop: roundCm2(drop),
    reheatFactor,
    reheatPower: Math.round(floorArea * reheatFactor),
  };
}

/**
 * Luftbilanz des Gebäudes. Die interessante Zahl ist `balance`: eine
 * ausgeglichene Anlage steht bei 0. Steht sie nicht bei 0, geht die Differenz
 * durch die Gebäudehülle — bei Überdruck hinaus, bei Unterdruck herein, und
 * zwar ungewärmt. Das ist kein Rundungsfehler, sondern eine Heizlast, die in
 * keiner Rechnung auftaucht, solange niemand nachzählt.
 */
function ventilationTotals(doc: BimDocument, rooms: ExportRoom[]): VentilationTotals {
  const system = doc.meta.ventilation;
  const kind = system?.kind ?? 'none';
  const recovery = kind === 'balanced' ? Math.min(0.95, Math.max(0, system?.heatRecovery ?? 0)) : 0;

  const roomsByRole: Record<VentilationRole, number> = { supply: 0, exhaust: 0, transfer: 0, none: 0 };
  let supply = 0;
  let exhaust = 0;
  let transfer = 0;
  for (const room of rooms) {
    roomsByRole[room.ventilation.role]++;
    supply += room.ventilation.supplyAirflow;
    exhaust += room.ventilation.exhaustAirflow;
    transfer += room.ventilation.transferAirflow;
  }

  return {
    kind,
    heatRecovery: recovery,
    operation: system?.operation ?? 'continuous',
    ...(system?.preheatTemperature !== undefined
      ? { preheatTemperature: system.preheatTemperature }
      : {}),
    supplyAirflow: Math.round(supply),
    exhaustAirflow: Math.round(exhaust),
    transferAirflow: Math.round(transfer),
    effectiveSupplyAirflow: Math.round(supply * (1 - recovery)),
    balance: Math.round(supply - exhaust),
    roomsByRole,
  };
}

/** Flächengewichteter U-Wert aller Hüllbauteile gegen Außenluft oder Erdreich. */
function meanEnvelopeUValue(rooms: ExportRoom[]): number {
  let area = 0;
  let sum = 0;
  for (const room of rooms) {
    for (const s of room.surfaces) {
      if (s.boundary === 'adjacent-room' || s.boundary === 'adiabatic') continue;
      area += s.netArea;
      sum += s.netArea * (s.uValue + (s.thermalBridgeSupplement ?? 0));
      for (const o of s.openings ?? []) {
        area += o.area;
        sum += o.area * o.uValue;
      }
    }
  }
  return area > 0.01 ? sum / area : 0;
}

function countByCategory(fixtures: Fixture[]): Record<FixtureCategory, number> {
  const counts: Record<FixtureCategory, number> = { heating: 0, sanitary: 0, ventilation: 0 };
  for (const f of fixtures) counts[f.category]++;
  return counts;
}

/** Orientierung einer beliebigen Richtung — für Ad-hoc-Auswertungen im UI. */
export function orientationOf(dx: number, dy: number, northAngle = 0): Orientation {
  return orientationFromAzimuth(azimuthFromNormal({ x: dx, y: dy }, northAngle));
}

/** Löst den Download der Exportdatei aus. */
export function downloadJson(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Object-URLs leben bis zum Reload weiter, wenn man sie nicht freigibt.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Dateiname aus Projektname + Datum — ohne Sonderzeichen. */
export function exportFilename(projectName: string): string {
  const slug = projectName
    .toLowerCase()
    .replace(/[äöüß]/g, (c) => ({ ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' })[c] ?? c)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  const date = new Date().toISOString().slice(0, 10);
  return `${slug || 'projekt'}_ravia-bim_${date}.json`;
}
