/**
 * Prüfblock „Exportvertrag" — das Format, gegen das die Gegenstelle baut.
 *
 * **Wozu.** RaVia implementiert gegen diesen Export. Von dem Tag an ist die
 * Feldliste kein Implementierungsdetail mehr, sondern eine Zusage: Wer dort
 * `surface.uValue` liest, muss das auch nach der nächsten Fassung noch
 * können. Ohne Wächter wandert ein Format still weiter — ein Feld wird
 * umbenannt, weil der neue Name schöner ist, und auf der Gegenseite fällt
 * eine Transmissionsfläche lautlos aus der Bilanz. Lautlos, weil `undefined`
 * in einer Summe wie eine 0 wirkt und das Ergebnis plausibel bleibt.
 *
 * **Wie er wirkt.** Die Listen unten werden von Hand geführt. Kommt ein Feld
 * dazu oder fällt eines weg, ohne dass jemand sie anfasst, fällt der
 * Prüflauf. Wer sie anfasst, muss dabei über die Version entscheiden — und
 * genau das ist der Zweck: Die Entscheidung soll nicht ausbleiben können.
 *
 * **Die Versionsregel**, aus der Sicht der Gegenstelle:
 *
 *   • Feld weg oder Bedeutung anders → **major**. Muss abgestimmt werden.
 *   • Feld dazu, alte unverändert     → **minor**. Kann überlesen werden.
 *   • Feldliste unverändert           → **patch**.
 *
 * **Was dieser Block nicht ist.** Keine Prüfung der Zahlen — die stehen in
 * den Blöcken „Übergabe", „U-Wert-Quelle", „Prüfsumme" und im Kern von
 * `verify.ts`. Hier geht es allein um Gestalt und Benennung.
 */

import type { CheckFn } from './typ';
import type { BimDocument, BimNode, Level, RaviaExport, Wall } from '../../src/types/bim';
import { emptyPlant, emptySite } from '../../src/lib/plantDefaults';
import { detectRooms } from '../../src/lib/roomDetection';
import { buildRaviaExport } from '../../src/lib/raviaExport';

// ---------------------------------------------------------------------------
// Die Listen — von Hand geführt
// ---------------------------------------------------------------------------

/**
 * Oberste Ebene. `PFLICHT` steht in jedem Export, `WAHLFREI` nur, wenn das
 * Modell den Abschnitt hergibt — ohne Wärmepumpe kein `heatPump`, ohne
 * Erdkontakt kein `subsoil`.
 */
const WURZEL_PFLICHT = [
  'schema',
  'version',
  'generator',
  'exportedAt',
  'units',
  'conventions',
  'project',
  'levels',
  'constructions',
  'verticals',
  'solids',
  'durchbrueche',
  'pipes',
  'pipeSchedule',
  'pipeNetwork',
  'emitters',
  'rooms',
  'totals',
  'validation',
  'geometry',
] as const;

const WURZEL_WAHLFREI = ['subsoil', 'hydraulics', 'heatPump', 'plant'] as const;

/**
 * Ein Raum. Die Reihenfolge ist ohne Bedeutung, die Namen sind es nicht.
 *
 * `checksum` ist seit 2.1.0 dabei und beantwortet die Frage, ob eine
 * gerechnete Heizlast noch gilt. `normHeatLoad` steht nur, wenn eine Norm-
 * Heizlast zurückgekommen ist — dieser Export rechnet keine.
 */
const RAUM_PFLICHT = [
  'id',
  'checksum',
  'name',
  'usage',
  'level',
  'levelElevation',
  'area',
  'netFloorArea',
  'floorOpeningArea',
  'solidArea',
  'height',
  'volume',
  'perimeter',
  'isHeated',
  'setpointTemperature',
  'airChangeRate',
  'minimumAirflow',
  'ventilation',
  'windowAreaByOrientation',
  'totalWindowArea',
  'exteriorWallArea',
  'exposedFacadeCount',
  'groundContactPerimeter',
  'groundContactArea',
  'characteristicGroundDimension',
  'surfaces',
  'polygon',
] as const;

const RAUM_WAHLFREI = [
  'roof',
  /*
   * Die drei hier standen bis 1.28.0 in keiner Liste — dieser Block hat sie
   * beim ersten Lauf selbst gefunden. Sie gehören zum TGA-Bestand des Raums
   * und stehen nur, wenn welcher erfasst ist.
   */
  'installedHeatingPower',
  'supplyAirflow',
  'exhaustAirflow',
  'normHeatLoad',
  'thermalBridges',
  'thermalBridgeHeatLoss',
  'thermalBridgeEnvelopeArea',
  'thermalBridgeEquivalentSupplement',
  'fixtures',
  'installedPower',
  'floorCovering',
  'floorCoveringResistance',
] as const;

/** Eine Hüllfläche. `uValueSource` ist seit 2.1.0 dabei. */
const FLAECHE_PFLICHT = [
  'id',
  'kind',
  'component',
  'tilt',
  'grossArea',
  'netArea',
  'uValue',
  'uValueSource',
  'thermalBridgeSupplement',
  'boundary',
  'neighbourTemperature',
  'openings',
] as const;

const FLAECHE_WAHLFREI = [
  'length',
  'height',
  'thickness',
  'orientation',
  'azimuth',
  'construction',
  'constructionId',
  'groundContact',
  'neighbourRoomId',
] as const;

/** Eine Öffnung. `uValueSource` ist seit 2.1.0 dabei. */
const OEFFNUNG_PFLICHT = [
  'id',
  'kind',
  'width',
  'height',
  'area',
  'sillHeight',
  'orientation',
  'azimuth',
  'uValue',
  'uValueSource',
] as const;

const OEFFNUNG_WAHLFREI = ['gValue', 'construction', 'constructionId'] as const;

/** Die Einheiten stehen im Dokument und sind selbst Teil des Vertrags. */
const EINHEITEN: Record<string, string> = {
  length: 'm',
  area: 'm2',
  volume: 'm3',
  temperature: 'degC',
  uValue: 'W/(m2K)',
  power: 'W',
  airflow: 'm3/h',
  airChangeRate: '1/h',
  pressure: 'Pa',
  massFlow: 'kg/h',
  length_mm: 'mm',
};

// ---------------------------------------------------------------------------
// Ein Haus, das möglichst viele Abschnitte anfasst
// ---------------------------------------------------------------------------

function baueHaus(): BimDocument {
  const nodes: Record<string, BimNode> = {};
  const walls: Record<string, Wall> = {};
  const p = (name: string, x: number, y: number): string => {
    nodes[name] = { id: name, x, y, levelId: 'eg' };
    return name;
  };
  const sw = p('sw', 0, 0);
  const se = p('se', 8, 0);
  const ne = p('ne', 8, 5);
  const nw = p('nw', 0, 5);
  const wand = (name: string, a: string, b: string): void => {
    walls[name] = {
      id: name,
      a,
      b,
      levelId: 'eg',
      type: 'exterior',
      thickness: 0.3,
      uValue: 0.28,
      height: 2.5,
      layerId: 'layer-walls',
    } as Wall;
  };
  wand('w-s', sw, se);
  wand('w-e', se, ne);
  wand('w-n', ne, nw);
  wand('w-w', nw, sw);

  const levels: Record<string, Level> = {
    eg: {
      id: 'eg',
      name: 'EG',
      order: 0,
      elevation: 0,
      height: 2.5,
      floorUValue: 0.35,
      floorBoundary: 'ground',
      ceilingUValue: 0.2,
      ceilingBoundary: 'unheated',
      // Ein Dach, damit die Dachflächen und der Giebel im Vertrag vorkommen.
      roof: {
        kind: 'gable',
        pitch: 38,
        kneeHeight: 0.8,
        azimuth: 180,
        ridgeOffset: 0,
        uValue: 0.18,
        gableUValue: 0.24,
      },
    } as Level,
  };

  const doc: BimDocument = {
    site: emptySite(),
    plant: emptyPlant(),
    meta: {
      name: 'Prüfhaus Exportvertrag',
      createdAt: '2026-01-01T00:00:00.000Z',
      modifiedAt: '2026-01-01T00:00:00.000Z',
      northAngle: 0,
      designOutdoorTemperature: -12,
      designIndoorTemperature: 20,
      n50: 1.5,
      shielding: 'moderate',
      unheatedTemperature: 10,
      groundTemperature: 10,
      terrainElevation: 0.3,
      thermalBridgeSupplement: 0.1,
      thermalBridgeMethod: 'flat',
      thermalBridgeCategory: 'custom',
      reheatFactor: 0,
      ventilation: { kind: 'none', heatRecovery: 0, operation: 'continuous' },
    },
    levels,
    layers: {},
    nodes,
    walls,
    openings: {
      'o-1': {
        id: 'o-1',
        wallId: 'w-s',
        kind: 'window',
        subtype: 'turn-tilt',
        distance: 3,
        width: 1.2,
        height: 1.35,
        sillHeight: 0.9,
        uValue: 1.1,
        gValue: 0.6,
      },
    } as BimDocument['openings'],
    fixtures: {},
    verticals: {},
    pipes: {},
    annotations: {},
    roofOpenings: {},
    rooms: {},
    constructions: {},
    diagnostics: { openEnds: [] },
    activeLevelId: 'eg',
  } as BimDocument;

  const raeume = detectRooms({
    nodes: doc.nodes,
    walls: Object.values(doc.walls),
    openings: Object.values(doc.openings),
    levelId: 'eg',
    defaultHeight: 2.5,
    northAngle: 0,
    // Ohne das Dach hier bleibt `room.roof` leer, und die Dachflächen
    // entstehen im Export nicht — der Vertrag prüfte dann weniger, als er
    // zu prüfen vorgibt. Abschnitt 5 hält das ausdrücklich nach.
    roof: levels.eg.roof,
  });
  doc.rooms = Object.fromEntries(raeume.map((r) => [r.id, r]));
  for (const raum of Object.values(doc.rooms)) {
    raum.name = 'Wohnen';
    raum.usage = 'living' as never;
    raum.setpointTemperature = 20;
    raum.airChangeRate = 0.5;
  }
  return doc;
}

// ---------------------------------------------------------------------------
// Der Vergleich
// ---------------------------------------------------------------------------

/**
 * Felder, die da sind, aber in keiner Liste stehen.
 *
 * Das ist die Richtung, die von allein passiert: Jemand ergänzt ein Feld, der
 * Prüflauf bleibt grün, und die Gegenstelle erfährt nie davon.
 */
function unbekannte(obj: object, pflicht: readonly string[], wahlfrei: readonly string[]): string {
  const bekannt = new Set<string>([...pflicht, ...wahlfrei]);
  return Object.keys(obj)
    .filter((k) => !bekannt.has(k))
    .sort()
    .join(', ');
}

/** Pflichtfelder, die fehlen — die Richtung, die auf der Gegenseite bricht. */
function fehlende(obj: object, pflicht: readonly string[]): string {
  const da = new Set(Object.keys(obj));
  return pflicht.filter((k) => !da.has(k)).join(', ');
}

export function pruefeExportvertrag(check: CheckFn): void {
  const ex: RaviaExport = buildRaviaExport(baueHaus());

  // === 1 — Kennung und Version ============================================
  check('Schemakennung', ex.schema, 'ravia.bim.light');
  check('Fassung', ex.version, '2.1.0');
  check('Der Erzeuger steht im Dokument', ex.generator.length > 0, true);
  check('Und der Zeitpunkt', /^\d{4}-\d{2}-\d{2}T/.test(ex.exportedAt), true);

  // === 2 — Oberste Ebene ==================================================
  check('Keine unbekannten Felder an der Wurzel', unbekannte(ex, WURZEL_PFLICHT, WURZEL_WAHLFREI), '');
  check('Kein Pflichtfeld fehlt an der Wurzel', fehlende(ex, WURZEL_PFLICHT), '');

  // === 3 — Einheiten ======================================================
  //
  // Sie stehen im Dokument, damit sie nicht in einer Doku verloren gehen
  // können. Dann müssen sie aber auch stimmen — eine falsche Einheit ist
  // schlimmer als keine, weil sie geglaubt wird.
  let falscheEinheit = '';
  const einheiten = ex.units as unknown as Record<string, string>;
  for (const [feld, soll] of Object.entries(EINHEITEN)) {
    if (einheiten[feld] !== undefined && einheiten[feld] !== soll) {
      falscheEinheit = `${feld}: ${einheiten[feld]} statt ${soll}`;
    }
  }
  check('Keine Einheit weicht ab', falscheEinheit, '');
  check('Länge in Metern', ex.units.length, 'm');
  check('U-Wert in W/(m²K)', ex.units.uValue, 'W/(m2K)');

  // === 4 — Der Raum =======================================================
  const raum = ex.rooms[0];
  check('Das Prüfhaus hat einen Raum', ex.rooms.length, 1);
  check('Keine unbekannten Felder am Raum', unbekannte(raum, RAUM_PFLICHT, RAUM_WAHLFREI), '');
  check('Kein Pflichtfeld fehlt am Raum', fehlende(raum, RAUM_PFLICHT), '');

  // === 5 — Flächen und Öffnungen ==========================================
  //
  // Über *alle* Flächen, nicht über die erste: Wand, Boden, Decke, Dach und
  // Giebel entstehen an verschiedenen Stellen im Erzeuger, und ein Feld, das
  // nur der Wand mitgegeben wird, ist genau die Art Unterschied, die der
  // Gegenstelle später auffällt und niemandem hier.
  let flaechenUnbekannt = '';
  let flaechenFehlend = '';
  let oeffnungUnbekannt = '';
  let oeffnungFehlend = '';
  const arten = new Set<string>();
  for (const f of raum.surfaces) {
    arten.add(f.kind);
    flaechenUnbekannt ||= unbekannte(f, FLAECHE_PFLICHT, FLAECHE_WAHLFREI);
    flaechenFehlend ||= fehlende(f, FLAECHE_PFLICHT);
    for (const o of f.openings) {
      oeffnungUnbekannt ||= unbekannte(o, OEFFNUNG_PFLICHT, OEFFNUNG_WAHLFREI);
      oeffnungFehlend ||= fehlende(o, OEFFNUNG_PFLICHT);
    }
  }
  check('Keine unbekannten Felder an einer Fläche', flaechenUnbekannt, '');
  check('Kein Pflichtfeld fehlt an einer Fläche', flaechenFehlend, '');
  check('Keine unbekannten Felder an einer Öffnung', oeffnungUnbekannt, '');
  check('Kein Pflichtfeld fehlt an einer Öffnung', oeffnungFehlend, '');

  // Das Prüfhaus muss die Arten auch wirklich erzeugen — sonst prüft
  // Abschnitt 5 weniger, als er zu prüfen vorgibt.
  check('Wandflächen kommen vor', arten.has('wall'), true);
  check('Boden kommt vor', arten.has('floor'), true);
  check('Dachflächen kommen vor', arten.has('roof'), true);
  check('Giebel kommt vor', arten.has('gable'), true);
  check('Und eine Öffnung ist dabei', raum.surfaces.some((f) => f.openings.length > 0), true);

  // === 5b — Keine Öffnung geht verloren ===================================
  //
  // Die Zusage, die stillschweigend gebrochen werden kann. Jede Öffnung des
  // Modells muss über alle Flächen des Raums **genau einmal** vorkommen.
  //
  // Der Fehler, der hier nicht mehr passieren soll: Bis 1.27.0 wanderte eine
  // Öffnung, deren Mitte über dem Kniestock liegt, auf die Giebelfläche —
  // auch dann, wenn die Wand gar keinen Giebel hat. Bei einem Satteldach hat
  // nur die Hälfte der Außenwände einen; in einer Traufwand fiel das Fenster
  // ersatzlos heraus. Und weil `netArea` seine Fläche trotzdem abzog, kam bei
  // der Gegenstelle eine kleinere Wand ohne das Fenster darin an: bei U 1,1
  // gegen U 0,28 eine Heizlast, die zu niedrig ist und plausibel aussieht.
  //
  // Das Prüfhaus hat genau diese Lage — Fenster mit Brüstung 0,90 m und
  // 1,35 m Höhe, Mitte also 1,575 m, über dem Kniestock von 0,80 m, und das
  // in der Südwand, die bei einem Satteldach mit Azimut 180 an der Traufe
  // liegt.
  const imModell = Object.keys(baueHaus().openings);
  const imExport = raum.surfaces.flatMap((f) => f.openings.map((o) => o.id));
  check('Das Modell hat eine Öffnung', imModell.length, 1);
  check('Sie kommt im Export genau einmal vor', imExport.filter((id) => id === imModell[0]).length, 1);
  check('Und keine andere kommt dazu', imExport.length, imModell.length);
  check('Sie sitzt in der Traufwand, nicht im Giebel', 
    raum.surfaces.find((f) => f.openings.length > 0)?.kind ?? 'fehlt', 'wall');

  // === 6 — Der Weg durch die Datei ========================================
  //
  // Was `JSON.stringify` nicht mitnimmt, kommt bei der Gegenstelle nicht an.
  // Geprüft wird die Wurzel, weil dort die Abschnitte hängen; die Räume
  // prüft der Rückweg-Block.
  const zurueck = JSON.parse(JSON.stringify(ex)) as RaviaExport;
  check('Die Wurzel übersteht die Datei', fehlende(zurueck, WURZEL_PFLICHT), '');
  check('… und bringt nichts Neues mit', unbekannte(zurueck, WURZEL_PFLICHT, WURZEL_WAHLFREI), '');
  check('Die Fassung steht auch danach da', zurueck.version, '2.1.0');
}
