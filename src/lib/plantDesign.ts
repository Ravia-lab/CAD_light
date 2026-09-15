/**
 * Anlagenauslegung — der Faden, der die Rechenkerne verbindet.
 * ---------------------------------------------------------------------------
 * Die einzelnen Kerne rechnen jeder für sich: `heatLoadEstimate` liefert die
 * Leistung, `deviceCatalog` das Gerät, `domesticWater` den Speicher,
 * `hydraulics` die Rohre, `safetyFittings` die Absicherung. Keiner davon kennt
 * die anderen — und genau das ist Absicht, denn jeder soll einzeln nach RaVia
 * übernehmbar sein.
 *
 * Was fehlt, ist die Reihenfolge. Die steht hier, und sie ist nicht beliebig:
 *
 *  1. **Heizlast** — ohne sie ist alles andere eine Vermutung.
 *  2. **Warmwasserzuschlag und Sperrzeitfaktor** — sie erhöhen die Leistung,
 *     die das Gerät können muss, bevor überhaupt ein Gerät gewählt wird.
 *  3. **Gerät** — aus der Leistung *im Auslegungspunkt*, nicht aus der
 *     Nennleistung.
 *  4. **Heizkreise** — sie bestimmen den Volumenstrom und den Wasserinhalt.
 *  5. **Puffer** — er folgt aus dem Gerät (Abtauung, Mindestlaufzeit) und aus
 *     dem, was ohnehin schon an Wasser in der Anlage steht.
 *  6. **Trinkwasser** — das Legionellenregime setzt die Speichertemperatur,
 *     und die Speichertemperatur entscheidet, ob das Gerät sie überhaupt
 *     erreicht.
 *  7. **Rohrnetz und Pumpe** — aus den Volumenströmen der Kreise.
 *  8. **Sicherheitsausrüstung** — sie braucht den fertigen Wasserinhalt.
 *
 * Seit die Einbettung schreiben darf, hat Schritt 1 drei mögliche Quellen: die
 * Vorgabe am Anlagenblatt, die Summe der gerechneten Raum-Heizlasten und den
 * eigenen Überschlag. Welche gegriffen hat, steht in `heatLoadProvenance`, und
 * warum bei Teildeckung nicht gemischt wird, steht bei Schritt 1 im Code.
 *
 * Wer die Reihenfolge dreht, bekommt Ergebnisse, die für sich stimmen und
 * zusammen nicht: ein Wärmetauscher, der für 50 °C ausgelegt wurde, während
 * die Anlage 60 °C fahren muss, oder ein Ausdehnungsgefäß ohne den Puffer,
 * den der Schritt danach hinzugefügt hat.
 */

import type {
  BimDocument,
  HeatPumpModel,
  HeatingCircuit,
  PipeMaterial,
  PipeSizing,
  PlantStorage,
  SafetyDesign,
  SchematicComponent,
  SchematicKind,
  SchematicLink,
  StorageKind,
  RoomHeatLoad as NormRoomHeatLoad,
} from '../types/bim';
import { capacityAt, findModel, hatAusseneinheit, matchModels, minimumBufferVolume, selectStorage, type ModelMatch } from './deviceCatalog';
import {
  domesticHotWaterSurcharge,
  estimateHeatLoad,
  normHeatLoadCoverage,
  type HeatLoadEstimate,
  type NormHeatLoadCoverage,
} from './heatLoadEstimate';
import { blockingFactor } from './heatPump';
import {
  DEFAULT_FLUID,
  PIPE_TABLES,
  designFloorHeating,
  designPump,
  fluidProperties,
  sizePipe,
  volumeFlow,
  type FloorHeatingDesign,
  type PumpDesign,
} from './hydraulics';
import { designDomesticHotWater, type DomesticWaterResult } from './domesticWater';
import {
  anschlussNotiz,
  anschlussVonGeraet,
  deutungsNotiz,
  pruefeAnschluss,
  type Anschlusspruefung,
} from './anschlussgroesse';
import { connectionDiameter, designSafety, systemVolume, type SystemVolumeInput } from './safetyFittings';
import { erzeugerBilanz, type Erzeugerbilanz } from './erzeugerHydraulik';
import { plantOf } from './plantDefaults';
import {
  SYSTEMTEMPERATUR_VORGABE,
  heizflaechenArten,
  heizflaechenart,
  kreistemperatur,
  systemtemperatur,
  type Auslegungstemperatur,
  type Heizflaechenart,
  type Systemtemperatur,
} from './systemtemperatur';

export type PlanningNote = { severity: 'info' | 'warn' | 'error'; text: string };

/**
 * Ein Raum am Verteiler.
 *
 * Die Fußbodenheizung wird raumweise gebaut, nicht geschossweise: jeder Raum
 * bekommt seine eigenen Kreise, seinen eigenen Verlegeabstand und seine eigene
 * Durchflussmenge am Durchflussmesser. Genau diese Tabelle braucht der
 * Monteur beim Einregulieren — eine Summe über das Geschoss hilft ihm nicht.
 */
export interface RoomLoopDesign {
  roomId: string;
  name: string;
  /** Belegbare Fläche [m²] — Grundfläche abzüglich Einbauten und Randstreifen. */
  area: number;
  /** Heizlast des Raums [W]. */
  load: number;
  /**
   * Welcher Weg für diese Last gegriffen hat.
   *
   * `norm` heißt: die Zahl ist in RaVia nach DIN EN 12831-1 gerechnet und in
   * das Modell geschrieben worden. `ueberschlag` heißt: sie stammt aus
   * Fläche, U-Wert und Mindestluftwechsel dieses Programms. Der Verlegeabstand
   * darunter sieht in beiden Fällen gleich aus — deshalb muss der Unterschied
   * am Ergebnis stehen und nicht nur im Kopf dessen, der es gerechnet hat.
   */
  loadSource: 'norm' | 'ueberschlag';
  /** Bei `norm`: die übernommene Last mit Absender, Zeitpunkt und Modellstand. */
  normHeatLoad?: NormRoomHeatLoad;
  /**
   * Bei `norm`: für einen abweichenden Modellstand gerechnet.
   * Die Zahl wird trotzdem benutzt — sie ist fraglich, nicht ungültig.
   */
  normOutdated?: boolean;
  /** Erforderliche Wärmestromdichte [W/m²]. */
  specificOutput: number;
  floor: FloorHeatingDesign;
  notes: PlanningNote[];
}

/** Auslegung eines Heizkreises mit allem, was daran hängt. */
export interface CircuitDesign {
  circuit: HeatingCircuit;
  /** Wärmebedarf des Kreises [kW]. */
  load: number;
  /**
   * Woraus dieser Wärmebedarf entstanden ist.
   *
   * `gemischt` ist der ehrliche Fall, nicht der verbotene: der Kreis versorgt
   * Räume, von denen ein Teil eine gerechnete Last trägt und ein Teil nicht.
   * Für den Volumenstrom des Kreises ist es richtig, je Raum die beste
   * verfügbare Zahl zu nehmen — der Kreis muss liefern, was die Räume
   * brauchen. Nur darf die Mischung nicht unbemerkt bleiben, sonst liest
   * jemand die Summe als Norm-Heizlast des Geschosses.
   * `vorgabe` heißt: die Last steht am Kreis gepflegt und wurde nicht gerechnet.
   */
  loadSource: 'norm' | 'ueberschlag' | 'gemischt' | 'vorgabe';
  /** Volumenstrom [m³/h]. */
  flow: number;
  /** Gewählte Anbindeleitung. */
  pipe: PipeSizing;
  /**
   * Nur bei Flächenheizung: die Auslegung über den ganzen Kreis. Sie ist die
   * Summe der Räume und dient dem Überblick — gebaut wird nach `rooms`.
   */
  floor?: FloorHeatingDesign;
  /** Nur bei Flächenheizung: ein Eintrag je versorgtem Raum. */
  rooms?: RoomLoopDesign[];
  /** Zahl der Heizkreise am Verteiler — Summe über die Räume. */
  loops?: number;
  notes: PlanningNote[];
}

export interface PlantDesignOptions {
  /** Norm-Heizlast [kW], falls sie vorliegt. Ohne sie wird überschlagen. */
  heatLoad?: number;
  /** Gerät festlegen statt vorschlagen. */
  modelId?: string;
  /** Zusätzliche Herstellergeräte. */
  extraModels?: readonly HeatPumpModel[];
  /** Wasserinhalt vorhandener Heizkörper [kW] — falls nicht aus dem Modell. */
  radiatorLoad?: number;
}

export interface PlantDesignResult {
  /** Woher die Leistungszahl stammt: gerechnet oder überschlagen. */
  heatLoadSource: 'norm' | 'überschlag';
  /**
   * Derselbe Sachverhalt, eine Stufe genauer — welcher der drei Wege gegriffen
   * hat. `vorgabe`: die Zahl steht als `plant.heatLoadOverride` im Modell,
   * eingetippt oder von der Gegenstelle geschrieben. `raumweise`: sie ist die
   * Summe der gerechneten Raum-Heizlasten. `überschlag`: sie stammt aus diesem
   * Programm.
   */
  heatLoadProvenance: 'vorgabe' | 'raumweise' | 'überschlag';
  /** Gebäudeheizlast [kW]. */
  heatLoad: number;
  /** Wie weit die gerechneten Raum-Heizlasten tragen — auch wenn sie nicht benutzt wurden. */
  normCoverage: NormHeatLoadCoverage;
  estimate?: HeatLoadEstimate;
  /** Warmwasserzuschlag [kW]. */
  dhwSurcharge: number;
  /** Sperrzeitfaktor [-]. */
  blocking: number;
  /** Was das Gerät können muss [kW]. */
  requiredCapacity: number;
  /** Vorschläge, bestes zuerst. */
  matches: ModelMatch[];
  selected?: ModelMatch;
  /** Heizkreise mit Volumenstrom und Rohrdimension. */
  circuits: CircuitDesign[];
  /**
   * Die maßgebliche Auslegungstemperatur der Anlage — mit Herkunft.
   *
   * Bis 1.23.0 gab es sie im Ergebnis nicht. Wer darunter rechnete — der
   * Rohrnetzbericht, die Trassenauslegung —, griff deshalb auf
   * `plant.design` zurück und bekam an einem Heizkörperhaus 35/28, während
   * die Kreise darüber mit 50/40 ausgelegt waren. Das Feld ist die Antwort
   * darauf: eine Zahl, ein Absender, ein Satz zur Begründung.
   */
  systemtemperatur: Systemtemperatur;
  /**
   * Nennweite der Erzeugeranbindung [mm].
   *
   * Sie stand bis 1.23.0 an zwei Stellen: einmal hier für die
   * Erzeugerbilanz, einmal im Rohrnetzbericht als eigene Rechnung. Beide
   * nahmen dieselbe Formel und dieselbe falsche Spreizung — dass sie
   * übereinstimmten, war Zufall und kein Beleg. Jetzt rechnet sie eine
   * Stelle, und der Bericht liest sie ab.
   */
  anschlussDn: number;
  /**
   * Wie diese Nennweite zustande kam — hydraulisch oder vom Gerät erzwungen.
   *
   * Das Feld ist optional, damit die Prüffixtures, die ein
   * `PlantDesignResult` von Hand aufbauen, weiter übersetzen. Die Auslegung
   * selbst setzt es immer. Wer nur die Zahl braucht, nimmt `anschlussDn`;
   * wer sie **begründen** muss — Anlagenbuch, Rohrnetzbericht —, braucht
   * `angehoben` und `hydraulisch` dazu, sonst steht im Nachweis eine
   * Nennweite, die zur Rechnung daneben nicht passt.
   */
  anschluss?: Anschlusspruefung;
  /** Gesamtvolumenstrom im Auslegungsfall [m³/h]. */
  totalFlow: number;
  /** Wasserinhalt der Anlage. */
  volume: { total: number; parts: { label: string; volume: number }[] };
  /** Puffer: erforderlich und gewählt. */
  buffer: { required: number; selected?: PlantStorage; reason: string };
  /** Trinkwasser. */
  dhw?: DomesticWaterResult;
  /** Vorgeschlagener Trinkwasserspeicher. */
  dhwStorage?: PlantStorage;
  /** Umwälzpumpe. */
  pump?: PumpDesign;
  /**
   * Der Erzeugerkreis: Gerät und Armaturen, die vor dem Rohrnetz liegen.
   *
   * Sie stand bis 1.13.2 als feste Zahl `20 000 Pa` in der Pumpenauslegung —
   * ein Platzhalter, den niemand belegen konnte und der zugleich nicht mit
   * dem Rohrnetzbericht übereinstimmte, der mit null rechnete. Zwei Zahlen
   * für dieselbe Größe an zwei Stellen: genau der Fehler, den dieses Projekt
   * dreimal an anderer Stelle gemacht hat. Jetzt gibt es eine.
   */
  generator: Erzeugerbilanz;
  /** Sicherheitsausrüstung. */
  safety?: SafetyDesign;
  notes: PlanningNote[];
}

// ---------------------------------------------------------------------------
// Heizkreise aus dem Modell ableiten
// ---------------------------------------------------------------------------

/**
 * Heizkreise erzeugen, wenn keine gepflegt sind.
 *
 * Ein Kreis je Wärmeübergabeart und Geschoss — das ist die Aufteilung, die in
 * einem Einfamilienhaus tatsächlich gebaut wird: ein Verteiler je Etage. Wer
 * es anders will, legt die Kreise im Anlagenblatt selbst an; dann wird hier
 * nichts erzeugt.
 *
 * **Die Temperaturen stehen nicht mehr hier.** Bis 1.23.0 stand die Regel
 * „Heizkörper bekommt mindestens 50/40" als Ausdruck mitten in dieser
 * Funktion — und genau deshalb kannte sie außer dieser Funktion niemand. Der
 * Rohrnetzbericht, die Anschlussnennweite, die Sicherheitsausrüstung und die
 * Trassenauslegung griffen weiter auf `plant.design` zu und rechneten an
 * einem reinen Heizkörperhaus mit 35/28 statt 50/40. Die Regel steht jetzt in
 * `systemtemperatur.kreistemperatur`, und alle fünf Stellen lesen dort.
 *
 * **Räume ohne Heizfläche** gelten weiterhin als Fläche — man muss etwas
 * annehmen, um zu rechnen, und bei einer Wärmepumpe ist die Fläche der
 * Regelfall. Neu ist, dass die Annahme sichtbar wird: `designPlant` zählt sie
 * und meldet sie als Warnung.
 */
export function deriveCircuits(doc: BimDocument, loads: HeatLoadEstimate): HeatingCircuit[] {
  const existing = Object.values(doc.plant?.circuits ?? {});
  if (existing.length) return existing;

  const design = doc.plant?.design;
  const blatt: Auslegungstemperatur = {
    vorlauf: design?.flowTemperature ?? SYSTEMTEMPERATUR_VORGABE.vorlauf,
    ruecklauf: design?.returnTemperature ?? SYSTEMTEMPERATUR_VORGABE.ruecklauf,
  };
  const arten = heizflaechenArten(doc);
  const byKey = new Map<string, { art: Heizflaechenart; kind: 'floor' | 'radiator'; levelId: string; roomIds: string[] }>();
  for (const room of loads.rooms) {
    const art = heizflaechenart(arten, room.roomId);
    // `unbekannt` wird zur Fläche zusammengefasst — sonst entstünde ein
    // dritter Kreis je Geschoss, den niemand baut. Gemeldet wird die Annahme
    // trotzdem, siehe `unbekannteHeizflaechen`.
    const kind: 'floor' | 'radiator' = art === 'heizkoerper' ? 'radiator' : 'floor';
    const key = `${kind}-${room.levelId}`;
    const entry = byKey.get(key) ?? { art, kind, levelId: room.levelId, roomIds: [] };
    entry.roomIds.push(room.roomId);
    byKey.set(key, entry);
  }

  const levelName = (id: string) => doc.levels[id]?.name ?? id;
  const abgeleitet = [...byKey.entries()].map(([key, entry]) => {
    const t = kreistemperatur(entry.kind === 'radiator' ? 'heizkoerper' : 'flaeche', blatt, doc.meta?.vorhaben);
    return {
      id: `circuit-${key}`,
      label: `${entry.kind === 'floor' ? 'Fußbodenheizung' : 'Heizkörper'} ${levelName(entry.levelId)}`,
      kind: entry.kind,
      roomIds: entry.roomIds,
      flowTemperature: t.vorlauf,
      returnTemperature: t.ruecklauf,
      material: (design?.material ?? 'kupfer') as PipeMaterial,
      mixed: false,
    };
  });

  return markiereGemischteKreise(abgeleitet);
}

/**
 * Räume, in denen noch keine Heizfläche steht.
 *
 * Sie sind der Grund, warum `Heizflaechenart` einen dritten Zustand hat. Die
 * Liste ist nicht für die Rechnung da — für die gelten sie als Fläche —,
 * sondern für den Satz, der das sagt.
 */
function unbekannteHeizflaechen(doc: BimDocument, loads: HeatLoadEstimate): string[] {
  const arten = heizflaechenArten(doc);
  return loads.rooms
    .filter((r) => heizflaechenart(arten, r.roomId) === 'unbekannt')
    .map((r) => r.name);
}

/**
 * Welcher Kreis braucht einen Mischer?
 *
 * **Nicht der Heizkörperkreis — die Fläche.** Der Erzeuger kann nur eine
 * Vorlauftemperatur liefern, und sie muss den höchsten Bedarf decken; bei
 * Heizkörpern mit 50 °C und Fußbodenheizung mit 35 °C fährt der Erzeuger
 * also 50 °C. Hinaufmischen kann kein Mischer. Der Heizkörperkreis hängt
 * deshalb **direkt** am Erzeuger, und die Fläche wird über einen Mischer mit
 * eigener Pumpe auf ihre 35 °C heruntergemischt.
 *
 * Bis 1.8.1 stand hier `mixed: entry.kind === 'radiator'` — genau
 * seitenverkehrt. Im Schema war der Mischer damit am Heizkörper gezeichnet
 * und die Fußbodenheizung hing ungemischt am Erzeuger; auf 55 °C
 * Vorlauftemperatur im Estrich folgt im besten Fall ein Estrichschaden.
 *
 * Ein einzelner Kreis ist nie gemischt: er *ist* die Erzeugertemperatur.
 */
function markiereGemischteKreise(kreise: HeatingCircuit[]): HeatingCircuit[] {
  if (kreise.length === 0) return kreise;
  const hoechste = Math.max(...kreise.map((c) => c.flowTemperature));
  // 2 K Toleranz: zwei Kreise mit 35 und 34 °C sind derselbe Kreis, und ein
  // Mischer für 1 K ist ein Bauteil, das nur Geld kostet.
  return kreise.map((c) => ({ ...c, mixed: c.flowTemperature < hoechste - 2 }));
}

/** Belegbare Fläche eines Raums für die Fußbodenheizung. */
const LAYABLE_FRACTION = 0.85;

/**
 * Einen Heizkreis auslegen.
 *
 * Der Volumenstrom folgt aus Last und Spreizung, die Rohrdimension aus dem
 * Volumenstrom. Bei Flächenheizung kommt die Kreisaufteilung dazu — sie ist
 * der Punkt, an dem eine Auslegung im Wohnzimmer scheitert: 40 m² bei 10 cm
 * Abstand sind 400 m Rohr, also mindestens vier Kreise.
 */
export function designCircuit(
  circuit: HeatingCircuit,
  loads: HeatLoadEstimate,
  options: {
    material: PipeMaterial;
    maxVelocity: number;
    maxGradient: number;
    glycol?: { fraction: number; kind: 'ethylen' | 'propylen' };
    /**
     * Ist eine Wärmepumpe im Spiel?
     *
     * Der Hinweis „jedes Grad kostet 2,5 % Arbeitszahl" gilt für die
     * Wärmepumpe und für nichts sonst. An einem Bestandskessel, der mit
     * 75/60 fährt, ist er nicht nur überflüssig, sondern falsch: Ein Kessel
     * hat keine Arbeitszahl, und die Heizkörper „kommen" dort nicht „mit
     * weniger aus" — sie sind vor vierzig Jahren dafür ausgelegt worden.
     * Wer einen Befund liest, der auf seinen Fall nicht zutrifft, liest den
     * nächsten nicht mehr.
     */
    waermepumpe?: boolean;
  },
): CircuitDesign {
  const notes: PlanningNote[] = [];
  const rooms = loads.rooms.filter((r) => circuit.roomIds.includes(r.roomId));
  /**
   * Je Raum die beste verfügbare Zahl: die gerechnete Norm-Heizlast, wenn sie
   * vorliegt, sonst der Überschlag. Das ist keine Mischung zweier Verfahren zu
   * einer Aussage, sondern eine Auswahl je Raum — jeder Raum wird nach der
   * Zahl ausgelegt, die für ihn gilt.
   */
  const roomLoads = rooms.map((r) => ({
    room: r,
    watt: r.normHeatLoad ? r.normHeatLoad.total : r.total,
    source: (r.normHeatLoad ? 'norm' : 'ueberschlag') as 'norm' | 'ueberschlag',
  }));
  const load = circuit.load ?? Math.round(roomLoads.reduce((s, r) => s + r.watt, 0)) / 1000;
  const mitNorm = roomLoads.filter((r) => r.source === 'norm').length;
  const loadSource: CircuitDesign['loadSource'] =
    circuit.load !== undefined
      ? 'vorgabe'
      : mitNorm === 0
        ? 'ueberschlag'
        : mitNorm === roomLoads.length
          ? 'norm'
          : 'gemischt';
  const spread = Math.max(2, circuit.flowTemperature - circuit.returnTemperature);
  const fluid = fluidProperties(
    (circuit.flowTemperature + circuit.returnTemperature) / 2,
    options.glycol ? { glycolFraction: options.glycol.fraction, glycolKind: options.glycol.kind } : undefined,
  );
  const flow = volumeFlow(load, spread, fluid);
  const pipe = sizePipe(flow, {
    material: circuit.material ?? options.material,
    fluid,
    maxVelocity: options.maxVelocity,
    maxGradient: options.maxGradient,
  });
  if (pipe.warning) notes.push({ severity: 'warn', text: `${circuit.label}: ${pipe.warning}` });

  let floor: FloorHeatingDesign | undefined;
  let roomDesigns: RoomLoopDesign[] | undefined;
  if (circuit.kind === 'floor') {
    // Raumweise auslegen. Ein Bad mit 90 W/m² und ein Schlafzimmer mit 45
    // brauchen unterschiedliche Verlegeabstände; über das Geschoss gemittelt
    // bekäme das Bad zu wenig und das Schlafzimmer zu viel.
    roomDesigns = roomLoads.map(({ room: r, watt, source }) => {
      const area = r.area * LAYABLE_FRACTION;
      const design = designFloorHeating(area, {
        spacing: circuit.spacing,
        load: watt,
        flowTemperature: circuit.flowTemperature,
        returnTemperature: circuit.returnTemperature,
        fluid,
      });
      const roomNotes: PlanningNote[] = (design.notes ?? []).map((n) => ({
        severity: n.severity,
        text: `${r.name}: ${n.text}`,
      }));
      return {
        roomId: r.roomId,
        name: r.name,
        area: Math.round(area * 100) / 100,
        load: watt,
        loadSource: source,
        normHeatLoad: r.normHeatLoad,
        normOutdated: r.normOutdated,
        specificOutput: area > 0 ? Math.round(watt / area) : 0,
        floor: design,
        notes: roomNotes,
      };
    });
    for (const r of roomDesigns) notes.push(...r.notes);

    // Die Kreissumme dient dem Überblick und der Massenermittlung; gebaut
    // wird nach der Raumtabelle.
    const totalArea = rooms.reduce((s, r) => s + r.area, 0) * LAYABLE_FRACTION;
    floor = designFloorHeating(totalArea, {
      spacing: circuit.spacing,
      load: load * 1000,
      flowTemperature: circuit.flowTemperature,
      returnTemperature: circuit.returnTemperature,
      fluid,
    });
  }
  const loops = roomDesigns ? roomDesigns.reduce((s, r) => s + r.floor.loops, 0) : undefined;

  if (options.waermepumpe !== false && circuit.kind === 'radiator' && circuit.flowTemperature > 55) {
    notes.push({
      severity: 'warn',
      text: `${circuit.label}: ${circuit.flowTemperature} °C Vorlauf. Jedes Grad kostet rund 2,5 % Arbeitszahl — vor der Geräteauswahl prüfen, ob die Heizkörper nicht doch mit weniger auskommen.`,
    });
  }

  return {
    circuit: {
      ...circuit,
      load,
      volumeFlow: Math.round(flow * 1000) / 1000,
      spacing: floor?.spacing ?? circuit.spacing,
      loops: loops ?? floor?.loops,
      // Maßgebend für die Pumpe ist der *längste* Kreis, nicht der mittlere.
      loopLength: roomDesigns?.length ? Math.max(...roomDesigns.map((r) => r.floor.loopLength)) : floor?.loopLength,
      loopPressure: roomDesigns?.length ? Math.max(...roomDesigns.map((r) => r.floor.loopPressure)) : floor?.loopPressure,
    },
    load: Math.round(load * 100) / 100,
    loadSource,
    flow: Math.round(flow * 1000) / 1000,
    pipe,
    floor,
    rooms: roomDesigns,
    loops,
    notes,
  };
}

// ---------------------------------------------------------------------------
// Die Anlage als Ganzes
// ---------------------------------------------------------------------------

export function designPlant(doc: BimDocument, options: PlantDesignOptions = {}): PlantDesignResult {
  const notes: PlanningNote[] = [];
  const plant = plantOf(doc);
  const design = plant.design;

  // 1 — Heizlast.
  //
  // Drei Quellen, in dieser Reihenfolge von stark nach schwach:
  //
  //  (a) die Vorgabe `plant.heatLoadOverride` — sie ist die Aussage eines
  //      Menschen oder der Gegenstelle über das ganze Gebäude und schlägt
  //      alles andere, auch die Summe der Räume: wer sie setzt, weiß, warum.
  //  (b) die Summe der gerechneten Raum-Heizlasten, aber nur, wenn *jeder*
  //      beheizte Raum eine trägt.
  //  (c) der eigene Überschlag.
  //
  // **Teildeckung fällt auf (c) zurück, statt zu mischen.** Eine Summe aus
  // gerechneten und überschlagenen Räumen wäre weder Norm-Heizlast noch
  // Überschlag: sie ließe sich gegen keine Kennzahl prüfen, denn die
  // Einordnung in W/m² setzt ein durchgehendes Verfahren voraus, und sie wäre
  // im Anlagenbuch nicht redlich zu benennen — „teilweise Norm" ist kein
  // Nachweis. Der Überschlag ist dagegen eine in sich geschlossene Zahl mit
  // bekannten Grenzen. Raumweise bleibt die gerechnete Last trotzdem
  // maßgebend: dort steht sie für ihren Raum allein und mischt sich mit
  // nichts. Der Hinweis unten nennt Zahl und Namen der fehlenden Räume, damit
  // der Weg zur vollen Deckung kurz ist.
  const estimate = estimateHeatLoad(doc);
  const normCoverage = normHeatLoadCoverage(doc);
  const raumweiseTraegt = normCoverage.complete && normCoverage.total > 0;
  const heatLoadProvenance: PlantDesignResult['heatLoadProvenance'] =
    options.heatLoad !== undefined ? 'vorgabe' : raumweiseTraegt ? 'raumweise' : 'überschlag';
  const heatLoad =
    heatLoadProvenance === 'vorgabe'
      ? (options.heatLoad ?? estimate.total)
      : heatLoadProvenance === 'raumweise'
        ? normCoverage.total
        : estimate.total;
  const heatLoadSource: 'norm' | 'überschlag' = heatLoadProvenance === 'überschlag' ? 'überschlag' : 'norm';

  if (heatLoadProvenance === 'raumweise') {
    notes.push({
      severity: 'info',
      text: `Gerechnet wird mit ${heatLoad.toFixed(2)} kW aus den Norm-Heizlasten aller ${normCoverage.heatedRooms} beheizten Räume${herkunft(normCoverage)}. Der eigene Überschlag käme auf ${estimate.total.toFixed(2)} kW; er wird nicht verwendet.`,
    });
  }
  if (heatLoadProvenance === 'überschlag') {
    notes.push({
      severity: 'info',
      text: `Gerechnet wird mit ${heatLoad.toFixed(2)} kW aus dem Überschlag (${estimate.klassifizierung}). Sobald die Norm-Heizlast aus RaVia vorliegt, sie hier eintragen — alle Folgegrößen rechnen sich neu.`,
    });
    if (normCoverage.withNorm > 0) {
      notes.push({
        severity: 'info',
        text:
          `${normCoverage.withNorm} von ${normCoverage.heatedRooms} beheizten Räumen tragen eine gerechnete Norm-Heizlast${herkunft(normCoverage)}. ` +
          `Für die Gebäudeheizlast bleibt es trotzdem beim Überschlag: eine Summe aus gerechneten und überschlagenen Räumen wäre keines von beidem und gegen keine Kennzahl zu prüfen. ` +
          `Die Räume mit gerechneter Last werden raumweise trotzdem damit ausgelegt. Es fehlen: ${aufzaehlung(normCoverage.missing)}.`,
      });
    }
  }
  if (heatLoadProvenance === 'vorgabe' && normCoverage.withNorm > 0) {
    // Die Gegenprobe kostet nichts und fängt den häufigsten Fehler ab: eine
    // stehen gebliebene Vorgabe aus einem früheren Stand, während die
    // raumweisen Lasten längst neu gerechnet sind.
    const abweichung = normCoverage.complete && heatLoad > 0 ? Math.abs(normCoverage.total - heatLoad) / heatLoad : 0;
    if (abweichung > 0.05) {
      notes.push({
        severity: 'warn',
        text: `Die eingetragene Heizlast von ${heatLoad.toFixed(2)} kW steht gegen ${normCoverage.total.toFixed(2)} kW aus den gerechneten Raum-Heizlasten${herkunft(normCoverage)}. Gerechnet wird mit der Eintragung; welche der beiden Zahlen gilt, entscheidet nicht das Programm.`,
      });
    }
  }
  if (normCoverage.outdated > 0) {
    notes.push({
      severity: 'info',
      text:
        `${normCoverage.outdated} ${normCoverage.outdated === 1 ? 'Raum trägt' : 'Räume tragen'} eine Heizlast, die für einen früheren Modellstand gerechnet wurde: ${aufzaehlung(normCoverage.outdatedRooms)}. ` +
        `Sie wird weiter verwendet — eine verschobene Innenwand macht die Heizlast des Nachbarraums fraglich, nicht ungültig. Vor der Ausführung in RaVia neu rechnen lassen.`,
    });
  }
  if (estimate.rooms.length === 0) {
    notes.push({ severity: 'error', text: 'Keine beheizten Räume im Modell. Ohne Räume gibt es keine Heizlast und keine Auslegung.' });
  }

  // 2 — Zuschläge.
  const pumps = doc.site?.pumps ?? {};
  const pump = plant.pumpId ? pumps[plant.pumpId] : Object.values(pumps)[0];
  /*
   * Gibt es überhaupt Warmwasser?
   *
   * Bis 1.8.1 hing das allein an einem Feld der aufgestellten Wärmepumpe.
   * Ohne aufgestelltes Gerät — der Regelfall beim ersten Aufmaß — galt
   * „Warmwasser ja", und das Programm erfand einen Trinkwasserspeicher samt
   * Zuschlag auf die Geräteleistung. Null Wohneinheiten heißt jetzt: kein
   * Warmwasser, kein Zuschlag, kein Speicher, kein Umschaltventil. Übrig
   * bleibt ein reines Heizungsschema.
   */
  const warmwasser = plant.dhw.units > 0 && pump?.domesticHotWater !== false;
  const occupants = warmwasser ? plant.dhw.units * plant.dhw.occupantsPerUnit : 0;
  const dhwSurcharge = warmwasser ? domesticHotWaterSurcharge(occupants, plant.dhw.comfort) : 0;
  const blocking = pump?.gridRegime === 'evu-3x2h' ? blockingFactor(pump.blockedHours) : 1;
  const requiredCapacity = Math.round((heatLoad + dhwSurcharge) * blocking * 100) / 100;
  if (blocking > 1) {
    notes.push({
      severity: 'info',
      text: `Sperrzeit ${pump?.blockedHours ?? 0} h/Tag: die Leistung wächst um den Faktor ${blocking.toFixed(2)} auf ${requiredCapacity.toFixed(2)} kW. Seit § 14a EnWG ist statt der Sperrung meist eine Leistungsreduzierung auf 4,2 kW vorgesehen — dann entfällt dieser Faktor.`,
    });
  }

  // 3 — Heizkreise zuerst, dann das Gerät.
  //
  // Die Reihenfolge ist keine Geschmacksfrage: die Vorlauftemperatur des
  // Erzeugers folgt aus dem heißesten Kreis, und danach richtet sich die
  // Leistungskurve, nach der das Gerät ausgewählt wird. Bis 1.8.1 wurden hier
  // nur die *gepflegten* Kreise berücksichtigt (`plant.circuits`) — im
  // Regelfall ist die Liste leer, weil die Kreise aus dem Modell abgeleitet
  // werden. Das Gerät wurde damit nach W35 gewählt und lieferte anschließend
  // 50 °C an die Heizkörper; zwischen W35 und W55 liegt rund ein Drittel
  // Leistung.
  const circuits = deriveCircuits(doc, estimate);
  /*
   * Die eine Temperatur, mit der diese Anlage ausgelegt wird.
   *
   * Sie stand bis 1.23.0 hier als `Math.max(design.flowTemperature, …)` — und
   * zwar **nur** hier: Die Geräteauswahl benutzte sie, alles darunter nicht.
   * Sie kommt jetzt aus `systemtemperatur`, steht als `systemtemperatur` im
   * Ergebnis und ist damit für den Rohrnetzbericht, die Anschlussnennweite
   * und die Sicherheitsausrüstung dieselbe Zahl. Die Rücklauftemperatur wird
   * dort mitgeführt, nicht nur der Vorlauf — ohne sie gäbe es keine
   * Spreizung, und die Spreizung ist die Größe, an der der Volumenstrom
   * hängt.
   */
  const temperatur = systemtemperatur({
    anlagenblatt: { vorlauf: design.flowTemperature, ruecklauf: design.returnTemperature },
    kreise: circuits.map((c) => ({
      label: c.label,
      vorlauf: c.flowTemperature,
      ruecklauf: c.returnTemperature,
    })),
  });
  const flowTemperature = temperatur.vorlauf;
  if (temperatur.herkunft === 'angehoben') {
    notes.push({ severity: 'info', text: temperatur.begruendung });
  }
  /*
   * Räume ohne Heizfläche — die Annahme, die bis 1.23.0 stumm blieb.
   *
   * `?? 'floor'` hieß: Ein Heizkörperprojekt, an dem die TGA-Objekte noch
   * fehlen, wurde durchgehend mit 35/28 ausgelegt, Gerät nach W35 gewählt,
   * Nennweiten danach — und niemand erfuhr davon. Die Annahme bleibt (etwas
   * muss man annehmen), aber sie steht jetzt am Ergebnis. Nur bei
   * abgeleiteten Kreisen: Wer seine Kreise selbst pflegt, hat die Frage
   * bereits beantwortet.
   */
  if (Object.values(plant.circuits).length === 0) {
    const ohne = unbekannteHeizflaechen(doc, estimate);
    if (ohne.length) {
      notes.push({
        severity: 'warn',
        text:
          `In ${ohne.length} ${ohne.length === 1 ? 'Raum' : 'Räumen'} steht noch keine Heizfläche: ${aufzaehlung(ohne)}. ` +
          `Für die Auslegung wurde Fläche angenommen; solange das so ist, gilt die Anlage als Flächenheizsystem und ` +
          `rechnet mit ${temperatur.vorlauf}/${temperatur.ruecklauf} °C. Kommt dort ein Heizkörper hin, ändern sich ` +
          `Vorlauftemperatur, Volumenstrom, Nennweiten und die Gerätewahl.`,
      });
    }
  }
  // Ein gepflegter Kreis, der kälter fährt als der Erzeuger und trotzdem
  // nicht als gemischt geführt ist, kann seine Auslegungstemperatur nicht
  // halten. Das ist kein Hinweis, sondern ein Fehler in der Anlage.
  for (const c of circuits) {
    if (!c.mixed && c.flowTemperature < flowTemperature - 2) {
      notes.push({
        severity: 'error',
        text: `„${c.label}“ ist auf ${c.flowTemperature} °C ausgelegt, der Erzeuger fährt ${flowTemperature} °C. Ohne Mischer mit eigener Pumpe kommt die volle Vorlauftemperatur im Kreis an.`,
      });
    }
  }
  const matches = matchModels(requiredCapacity, {
    designTemperature: doc.meta.designOutdoorTemperature,
    flowTemperature,
    // Ohne aufgestellte Wärmepumpe wird die Luft-Wärmepumpe angenommen —
    // sie ist der Regelfall, und eine Erdsonde stellt niemand versehentlich auf.
    source: pump?.source ?? 'air',
    extra: options.extraModels,
  });
  const chosen = options.modelId ?? plant.generatorModelId;
  const selected = chosen
    ? (matches.find((m) => m.model.id === chosen) ?? wrapModel(chosen, requiredCapacity, doc, flowTemperature, options.extraModels))
    : matches[0];
  if (selected && selected.model.provenance === 'generisch') {
    notes.push({
      severity: 'warn',
      text: `„${selected.model.label}" ist eine Typklasse, kein Produkt. Zum Bestellen und für den Schallnachweis das Datenblatt des tatsächlichen Geräts eintragen.`,
    });
  }
  /*
   * Die maximale Vorlauftemperatur ist kein Skalar.
   *
   * Der Prospektwert gilt bei Nennbedingungen; am kalten Tag liegt er bei
   * mehreren Herstellern rund 10 K niedriger. Ausgerechnet am
   * Auslegungspunkt zählt der niedrigere Wert. Führt das Datenblatt ihn,
   * wird damit gerechnet; sonst wird gesagt, dass hier optimistisch
   * gerechnet wird.
   */
  const maxVorlauf = selected?.model.maxFlowTemperatureAtDesign ?? selected?.model.maxFlowTemperature;
  if (selected && selected.model.maxFlowTemperatureAtDesign === undefined && flowTemperature > 45) {
    notes.push({
      severity: 'warn',
      text: `${selected.model.maxFlowTemperature} °C maximale Vorlauftemperatur gelten bei Nennbedingungen. Bei Norm-Außentemperatur liegt der Wert je nach Fabrikat rund 10 K niedriger — für ${flowTemperature} °C Auslegungsvorlauf im Datenblatt nachsehen.`,
    });
  }
  if (selected && maxVorlauf !== undefined && maxVorlauf < flowTemperature) {
    notes.push({
      severity: 'error',
      text: `Das Gerät erreicht ${selected.model.maxFlowTemperature} °C, der wärmste Kreis verlangt ${flowTemperature} °C.`,
    });
  }

  // 4 — Heizkreise.
  const glycol = design.glycolFraction > 0 ? { fraction: design.glycolFraction, kind: design.glycolKind } : undefined;
  const designs = circuits.map((c) =>
    designCircuit(c, estimate, {
      material: design.material,
      maxVelocity: design.maxVelocity,
      maxGradient: design.maxGradient,
      glycol,
      // Im unsanierten Bestand wird nicht über die Arbeitszahl belehrt —
      // siehe `waermepumpe` in `designCircuit`.
      waermepumpe: doc.meta.vorhaben !== 'bestand',
    }),
  );
  for (const d of designs) notes.push(...d.notes);
  const totalFlow = Math.round(designs.reduce((s, d) => s + d.flow, 0) * 1000) / 1000;

  // 5 — Wasserinhalt und Puffer.
  const volumeInput: SystemVolumeInput = {
    generator: selected ? { label: selected.model.label, volume: 5 } : undefined,
    pipes: designs.map((d) => ({
      label: `Anbindung ${d.circuit.label}`,
      dimension: d.pipe.dimension,
      // Ohne verlegte Trasse im Modell wird mit 25 m je Kreis gerechnet —
      // ein Richtwert, der im Einfamilienhaus meist zu hoch statt zu niedrig
      // liegt und damit auf der sicheren Seite ist.
      length: pipeLengthOfCircuit(doc, d.circuit.id) ?? 25,
    })),
    floorLoops: designs
      .filter((d) => d.floor)
      .map((d) => ({
        label: d.circuit.label,
        dimension: d.floor?.dimension ?? PIPE_TABLES.verbund[0],
        // Die Rohrlänge kommt aus den Raumkreisen, weil dort die
        // Anbindeleitungen je Raum einzeln stecken.
        length: d.rooms?.length
          ? d.rooms.reduce((sum, r) => sum + r.floor.totalLength, 0)
          : d.floor?.totalLength,
      })),
    radiators: designs.filter((d) => d.circuit.kind === 'radiator').map((d) => ({ label: d.circuit.label, load: d.load })),
    storages: Object.values(plant.storages).map((s) => ({
      label: s.label,
      volume: s.volume,
      heatingShare: s.kind === 'dhw-cylinder' ? 0.06 : 1,
    })),
  };
  const volume = systemVolume(volumeInput);

  const capacity = selected ? selected.capacityAtDesign : requiredCapacity;
  const bufferNeed = minimumBufferVolume(capacity, volume.total, {
    specificContent: selected?.model.source === 'air' ? 12 : 0,
  });
  const existingBuffer = Object.values(plant.storages).find((s) => s.kind === 'buffer-series' || s.kind === 'buffer-parallel');
  let bufferStorage: PlantStorage | undefined = existingBuffer;
  if (!existingBuffer && bufferNeed.required > 0) {
    /*
     * **Reihenpuffer oder Parallelpuffer?** Diese Entscheidung fiel bis
     * 1.12.0 gar nicht — es wurde immer ein Reihenpuffer gewählt. Das ist
     * bei genau einem ungemischten Kreis richtig und sonst falsch, und der
     * Unterschied ist keine Nuance:
     *
     *  • Der **Reihenpuffer** liegt im Rücklauf und stellt nur Volumen
     *    bereit. Er trennt nicht: es gibt genau einen Volumenstrom, den die
     *    Erzeugerpumpe fördert. Der BWP zeigt ihn deshalb ausschließlich in
     *    Schema 2 — ein ungemischter Kreis.
     *  • Der **Parallelpuffer** hat vier Anschlüsse und trennt Erzeuger- von
     *    Verteilerkreis. Erst damit dürfen Kreise eigene Pumpen haben.
     *
     * Läuft eine Anlage mit mehreren Kreisen oder mit Mischern auf einem
     * Reihenpuffer, arbeiten Kreispumpen und Erzeugerpumpe gegeneinander;
     * jede Kreispumpe fördert dann durch den Wärmetauscher des Erzeugers
     * mit. Genau diese Anlage hat das Programm bis 1.12.0 vorgeschlagen.
     *
     * Die Bedingung ist deshalb: **hydraulisch trennen, sobald mehr als ein
     * Kreis fördert oder ein Kreis gemischt ist.** Beides folgt aus der
     * Zuordnung des BWP-Leitfadens (Schema 2 gegen Schema 3); der
     * Bosch-Zusatz „nur Mischerkreise ⇒ Puffer zwingend" zeigt in dieselbe
     * Richtung.
     */
    const mehrereKreise = designs.length > 1;
    const mitMischer = designs.some((d) => d.circuit.mixed);
    const trennen = mehrereKreise || mitMischer;
    const art: StorageKind = trennen ? 'buffer-parallel' : 'buffer-series';
    const model = selectStorage(art, bufferNeed.required);
    if (model) {
      bufferStorage = {
        id: 'buffer-suggested',
        modelId: model.id,
        label: model.label,
        kind: art,
        volume: model.volume,
        suggested: true,
      };
      notes.push({
        severity: 'info',
        text: trennen
          ? `Parallelpuffer statt Reihenpuffer: ${mehrereKreise ? `${designs.length} Heizkreise` : 'ein gemischter Kreis'}` +
            ' brauchen eigene Pumpen, und die dürfen nicht gegen die Erzeugerpumpe arbeiten. Ein Reihenpuffer ' +
            'liegt im Rücklauf und trennt nicht (BWP-Leitfaden Hydraulik, Schema 2 gegen Schema 3).'
          : 'Reihenpuffer im Rücklauf: ein ungemischter Kreis braucht keine hydraulische Trennung, ' +
            'nur Volumen (BWP-Leitfaden Hydraulik, Schema 2).',
      });
    }
  }
  if (bufferNeed.required <= 0) {
    notes.push({ severity: 'info', text: bufferNeed.reason });
  }

  // 6 — Trinkwasser.
  let dhw: DomesticWaterResult | undefined;
  let dhwStorage: PlantStorage | undefined = Object.values(plant.storages).find(
    (s) => s.kind === 'dhw-cylinder' || s.kind === 'combi',
  );
  if (warmwasser) {
    dhw = designDomesticHotWater({
      units: plant.dhw.units,
      occupantsPerUnit: plant.dhw.occupantsPerUnit,
      comfort: plant.dhw.comfort,
      storageTemperature: design.dhwTemperature,
      tapTemperature: design.tapTemperature,
      coldWaterTemperature: design.coldWaterTemperature,
      reheatTime: plant.dhw.reheatTime,
      longestBranchContent: plant.dhw.longestBranchContent,
      storageVolume: dhwStorage?.volume,
      generatorCapacity: capacity,
      singleOrTwoFamilyHouse: plant.dhw.units <= 2,
    });
    for (const n of dhw.notes) notes.push(n);
    if (!dhwStorage) {
      const kind: StorageKind = 'dhw-cylinder';
      const model = selectStorage(kind, dhw.recommendedVolume);
      if (model) {
        dhwStorage = {
          id: 'dhw-suggested',
          modelId: model.id,
          label: model.label,
          kind,
          volume: model.volume,
          suggested: true,
        };
      }
    }
    if (selected && dhw.storageTemperature > selected.model.maxFlowTemperature) {
      notes.push({
        severity: 'error',
        text: `Der Speicher muss auf ${dhw.storageTemperature} °C gehalten werden, das Gerät erreicht ${selected.model.maxFlowTemperature} °C. Ohne Heizstab oder Frischwasserstation geht das nicht auf.`,
      });
    }
  }

  // 7 — Pumpe.
  /*
   * Zuerst der Erzeugerkreis, dann die Pumpe — nicht umgekehrt.
   *
   * Die Bauteile hier sind dieselben, die `designSafety` weiter unten in die
   * Armaturenliste schreibt: Wärmemengenzähler (BEG-Nachweis),
   * Schlammabscheider (Schutz des Plattenwärmetauschers) und, sobald ein
   * Trinkwasserspeicher über den Erzeuger geladen wird, das
   * 3-Wege-Umschaltventil. Was das Gerät selbst schon mitbringt, wird nicht
   * doppelt gezählt.
   */
  /*
   * Die Anschlussnennweite des Erzeugers — hydraulisch gerechnet, am Gerät
   * geprüft.
   *
   * Bis 1.23.0 stand hier nur die erste Zeile. Sie sucht die kleinste
   * Nennweite, die Geschwindigkeit und Druckgefälle einhält, und kennt den
   * Stutzen nicht, an dem die Leitung hängt: Am Referenzhaus mit 8-kW-Gerät
   * und 10 K Spreizung kam DN 20 heraus, während das Gerät G 1¼ AG (DN 32)
   * hat. Der Massenauszug bestellte daraufhin eine Leitung, die schmaler ist
   * als ihr Anschluss.
   *
   * Maßgeblich ist zuerst das **aufgestellte** Gerät (`HeatPump`), dann das
   * **ausdrücklich gewählte** Katalogmodell. Fehlt beides, bleibt es bei der
   * hydraulischen Zahl — angenommen wird nichts. Die Begründung steht in
   * `anschlussgroesse.pruefeAnschluss`.
   *
   * **Warum der Vorschlag nicht zählt.** `selected` ist ohne Eintrag im
   * Anlagenblatt der beste Treffer aus `matchModels` — ein Vorschlag des
   * Programms und keine Aussage über das Gerät, das gebaut wird. Ihn hier
   * gelten zu lassen, hätte an einem 2,4-kW-Prüfhaus die Erzeugeranbindung
   * von DN 15 auf DN 25 gehoben, nur weil das Programm sich versuchsweise
   * für ein 4-kW-Gerät entschieden hat. Das ist genau die Annahme, die
   * dieses Modul nicht treffen soll — und es wäre zudem eine andere Antwort
   * als die der Trassenauslegung, die ebenfalls nur das gewählte Modell
   * kennt.
   */
  const hydraulischDn = connectionDiameter(capacity, { spread: temperatur.spreizung, velocity: 0.8 });
  const gewaehltesModell = chosen ? selected?.model : undefined;
  const anschluss = anschlussVonGeraet(pump, gewaehltesModell);
  const anschlussPruefung = pruefeAnschluss(hydraulischDn, anschluss.dn);
  const anschlussDn = anschlussPruefung.dn;
  const anhebung = anschlussNotiz(anschlussPruefung, anschluss);
  if (anhebung) notes.push(anhebung);
  const unlesbar = deutungsNotiz(anschluss);
  if (unlesbar) notes.push(unlesbar);
  const erzeuger = erzeugerBilanz({
    model: selected?.model,
    // `temperatur.spreizung` statt `design.…`: Durch den Erzeuger fließt, was
    // die Kreise verlangen. An einem reinen Heizkörperhaus mit 35/28 im
    // Anlagenblatt waren das 7 K statt 10 K — 43 % zu viel Volumenstrom und
    // eine Nennweite zu groß.
    flow: totalFlow || capacity / (1.163 * temperatur.spreizung),
    dn: anschlussDn,
    umschaltung: Boolean(dhwStorage) && !selected?.model.contains?.diverter,
    waermezaehler: true,
    abscheiderVorhanden: !selected?.model.contains?.dirtSeparator,
  });
  for (const n of erzeuger.hinweise) notes.push(n);

  // Stoffwerte bei der **mittleren** Temperatur der Anlage, nicht bei der des
  // Anlagenblatts: Die Zähigkeit ändert sich zwischen 31,5 °C und 45 °C um
  // rund ein Drittel und geht über die Reynoldszahl in jeden Druckverlust ein.
  const fluid = glycol
    ? fluidProperties((temperatur.vorlauf + temperatur.ruecklauf) / 2, {
        glycolFraction: glycol.fraction,
        glycolKind: glycol.kind,
      })
    : DEFAULT_FLUID;
  // Der Förderstrom ist die Summe der Kreise, nicht der größte Kreis — siehe
  // `designPump`. Er wird hier ausdrücklich übergeben, damit im Ergebnis
  // steht, worauf die Pumpe ausgelegt wurde.
  const pumpDesign = designs.length
    ? designPump(
        designs.map((d) => ({
          id: d.circuit.id,
          label: d.circuit.label,
          segments: [
            {
              label: `Anbindung ${d.circuit.label}`,
              dimension: d.pipe.dimension,
              length: pipeLengthOfCircuit(doc, d.circuit.id) ?? 25,
              flow: d.flow,
              bothWays: true,
              fittings: [
                { id: 'bogen-90', count: 8 },
                { id: 'absperrventil', count: 2 },
              ],
            },
          ],
          // Der Verbraucherwiderstand: bei Flächenheizung der ungünstigste
          // Kreis samt Verteiler, bei Heizkörpern das Ventil.
          // Der ungünstigste Kreis bestimmt die Pumpe, nicht der mittlere.
          // 12 kPa sind der übliche Ansatz für Verteiler samt
          // Durchflussmesser und Stellantrieb — Erfahrungswert.
          terminalLoss: d.rooms?.length
            ? Math.max(...d.rooms.map((r) => r.floor.loopPressure)) + 12000
            : d.floor
              ? d.floor.loopPressure + 12000
              : 10000,
        })),
        fluid,
        {
          generatorLoss: erzeuger.zusatz,
          flow: totalFlow,
          availableHead:
            erzeuger.verfuegbar !== undefined ? erzeuger.verfuegbar / (fluid.density * 9.80665) : undefined,
        },
      )
    : undefined;
  for (const n of pumpDesign?.notes ?? []) notes.push(n);

  // 8 — Sicherheitsausrüstung.
  const totalVolume =
    volume.total + (bufferStorage && bufferStorage.suggested ? bufferStorage.volume : 0);
  const safety = selected
    ? designSafety({
        systemVolume: totalVolume,
        staticHeight: plant.safety.staticHeight,
        safetyValvePressure: plant.safety.safetyValvePressure,
        maxTemperature: plant.safety.maxTemperature,
        heatOutput: capacity,
        glycolFraction: design.glycolFraction,
        glycolKind: design.glycolKind,
        existingVessel: plant.safety.existingVessel,
        minSystemVolume: selected.model.minSystemVolume,
        minVolumeFlow: selected.model.minVolumeFlow,
        lowestVolumeFlow: designs.length ? Math.min(...designs.map((d) => d.flow)) : undefined,
        // Nur die echte hydraulische Trennung macht das Überströmventil
        // entbehrlich — der Reihenpuffer nicht.
        hydraulicSeparation: Boolean(bufferStorage) && bufferStorage?.kind !== 'buffer-series',
        heatPump: true,
        dhw:
          dhwStorage && dhw
            ? {
                volume: dhwStorage.volume,
                heatingCapacity: dhw.reheatCapacity,
                secured: plant.safety.dhwSecured,
              }
            : undefined,
        // Die Spreizung bestimmt hier die Nennweite des Überströmventils.
        // Mit der des Anlagenblatts fiel es an einem Heizkörperhaus eine
        // Stufe zu groß aus — ein zu großes Überströmventil schließt nicht
        // sauber und schließt den Vorlauf in den Rücklauf kurz.
        spread: temperatur.spreizung,
      })
    : undefined;
  for (const n of safety?.notes ?? []) notes.push(n);

  return {
    heatLoadSource,
    heatLoadProvenance,
    heatLoad: Math.round(heatLoad * 100) / 100,
    normCoverage,
    estimate,
    dhwSurcharge,
    blocking,
    requiredCapacity,
    matches: matches.slice(0, 8),
    selected,
    circuits: designs,
    systemtemperatur: temperatur,
    anschlussDn,
    anschluss: anschlussPruefung,
    totalFlow,
    volume: { total: Math.round(totalVolume), parts: volume.parts },
    buffer: { required: bufferNeed.required, selected: bufferStorage, reason: bufferNeed.reason },
    dhw,
    dhwStorage,
    generator: erzeuger,
    pump: pumpDesign,
    safety,
    notes: dedupe(notes),
  };
}

/**
 * Absender und Zeitpunkt der übernommenen Lasten als Einschub.
 *
 * Ohne diese Angabe ist „gerechnete Heizlast" eine Behauptung: wer sie später
 * liest, muss erkennen können, welches Programm sie wann geliefert hat.
 */
function herkunft(coverage: NormHeatLoadCoverage): string {
  if (!coverage.source) return '';
  const datum = coverage.receivedAt ? datumDe(coverage.receivedAt) : undefined;
  return datum ? ` (${coverage.source}, ${datum})` : ` (${coverage.source})`;
}

/** ISO-Zeitstempel als deutsches Datum. Unlesbares bleibt weg statt „Invalid Date". */
function datumDe(iso: string): string | undefined {
  const zeit = new Date(iso);
  if (Number.isNaN(zeit.getTime())) return undefined;
  return zeit.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/**
 * Namen aufzählen, ohne den Hinweis zu sprengen.
 *
 * Bei vierzig fehlenden Räumen hilft die vollständige Liste niemandem; die
 * ersten vier und die Zahl der übrigen sagen dasselbe in einer Zeile.
 */
function aufzaehlung(namen: readonly string[], sichtbar = 4): string {
  if (namen.length === 0) return '—';
  if (namen.length <= sichtbar) return namen.join(', ');
  const rest = namen.length - sichtbar;
  return `${namen.slice(0, sichtbar).join(', ')} und ${rest} weitere`;
}

/** Ein festgelegtes Gerät als Treffer verpacken, auch wenn es nicht zur Liste passt. */
function wrapModel(
  id: string,
  load: number,
  doc: BimDocument,
  flowTemperature: number,
  extra?: readonly HeatPumpModel[],
): ModelMatch | undefined {
  const model = findModel(id, extra ?? []);
  if (!model) return undefined;
  const capacityAtDesign = Math.round(capacityAt(model, doc.meta.designOutdoorTemperature, flowTemperature) * 10) / 10;
  const coverage = load > 0 ? capacityAtDesign / load : 0;
  return {
    model,
    capacityAtDesign,
    coverage: Math.round(coverage * 1000) / 1000,
    score: 1,
    verdict: coverage >= 0.98 ? 'passt' : coverage >= 0.75 ? 'knapp' : 'zu klein',
    reason: `Von Hand gewählt — deckt ${Math.round(coverage * 100)} % der erforderlichen Leistung.`,
  };
}

/** Verlegte Trassenlänge eines Kreises aus dem Modell, falls gezeichnet [m]. */
function pipeLengthOfCircuit(doc: BimDocument, circuitId: string): number | undefined {
  const runs = Object.values(doc.pipes ?? {}).filter(
    (p) => p.label === circuitId && (p.service === 'heating-flow' || p.service === 'heating-return'),
  );
  if (!runs.length) return undefined;
  let sum = 0;
  for (const run of runs) {
    for (let i = 1; i < run.points.length; i += 1) {
      sum += Math.hypot(run.points[i].x - run.points[i - 1].x, run.points[i].y - run.points[i - 1].y);
    }
  }
  return Math.round(sum * 100) / 100;
}

/** Gleiche Hinweise nur einmal — sonst steht derselbe Satz achtmal untereinander. */
function dedupe(notes: PlanningNote[]): PlanningNote[] {
  const seen = new Set<string>();
  const out: PlanningNote[] = [];
  for (const n of notes) {
    const key = `${n.severity}|${n.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(n);
  }
  const rank = { error: 0, warn: 1, info: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

// ---------------------------------------------------------------------------
// Anlagenschema
// ---------------------------------------------------------------------------

/**
 * Das Schema aus der Auslegung erzeugen.
 *
 * **Warum das Schema erzeugt und nicht gezeichnet wird.** Ein Anlagenschema
 * von Hand zu zeichnen ist eine halbe Stunde Arbeit, in der man dreimal
 * dasselbe abschreibt, was ohnehin schon berechnet wurde. Und wenn sich der
 * Speicher ändert, stimmt es nicht mehr. Erzeugt wird es in einer Zehntel-
 * sekunde und stimmt immer.
 *
 * Der Preis: das Ergebnis ist ein *Prinzipschema*, kein Ausführungsplan. Es
 * sagt, was verbaut wird und in welcher Reihenfolge es hängt — nicht, wo im
 * Technikraum es steht. Wer von Hand eingreift, setzt `manual` und ab dann
 * wird nichts mehr überschrieben.
 *
 * Die Koordinaten sind Rasterplätze, kein Meter. Gerechnet wird in Spalten
 * (x) und Zeilen (y), die Ansicht multipliziert mit der Symbolgröße.
 */
/**
 * Das Anlagenschema aus der Auslegung.
 *
 * **Die Regel, an der sich alles ausrichtet:** gezeichnet wird, was ausgelegt
 * wurde — nicht, was der Zeichner für richtig hält. Bis 1.8.1 traf diese
 * Funktion ihre eigenen Entscheidungen: sie setzte den Mischer an den
 * Heizkörper (statt an die Fläche), zeichnete einen namenlosen „Luftabscheider"
 * in den Rücklauf, obwohl die Sicherheitsauslegung einen Mikroblasenabscheider
 * im Vorlauf verlangt, ließ den Heizstab weg, den die Geräteauswahl
 * einrechnet, und hängte den Reihenpuffer mit einer einzigen Leitung ins
 * Nichts. Jede dieser Entscheidungen war eine zweite Meinung zu einer Frage,
 * die vorher schon beantwortet war.
 *
 * **Anschlussstutzen werden ausnahmslos benannt.** Ohne Namen sucht der
 * Zeichner das geometrisch nächste Stutzenpaar — so kam die Speicherladeleitung
 * an den Trinkwasser-Kaltwasserstutzen, das Ausdehnungsgefäß an die
 * Abblaseleitung des Sicherheitsventils und die Füllleitung an das
 * Abschlämmventil. Siehe `SchematicLink.fromPort`.
 *
 * **Systemgrenzen sind Bauteile.** Trinkwasseranschluss, Zapfstelle,
 * Abblaseleitung und Entwässerung stehen als benannte Knoten im Schema. Ein
 * offenes Leitungsende, das nichts benennt, ist in einem Fließbild ein Fehler.
 *
 * **Das Schema zeigt die Anlage, nicht den Vollausbau.** Bis 1.10 zeichnete
 * diese Funktion unabhängig von der Anlagengröße immer denselben Satz:
 * Vorlaufbalken, Rücklaufbalken, Wärmemengenzähler, Umwälzpumpe,
 * Schlammabscheider, Füllleitung mit Systemtrenner, Entwässerungen. Für eine
 * Wärmepumpe mit einem einzigen Heizkörper ist das ein Blatt voller Bauteile,
 * die den Blick auf die Anlage verstellen — und der Verteilbalken behauptet
 * dort sogar eine Verteilung, die es nicht gibt. Die Regeln lauten jetzt:
 *
 *  • **Verteilbalken nur bei mehr als einem Heizkreis.** Sonst läuft der
 *    Vorlauf vom Erzeuger (oder vom Trennpuffer) unmittelbar zum Verbraucher
 *    und der Rücklauf zurück.
 *  • **Armaturen nur, wenn die Auslegung sie führt.** Luft- und
 *    Schlammabscheider, Wärmemengenzähler, Füllarmatur, Systemtrenner und
 *    Überströmventil kommen aus `SafetyDesign.fittings`; die Umwälzpumpe aus
 *    `PumpDesign`. Ohne Auslegung standen sie hier bisher mit erfundener
 *    Beschriftung — ein Bauteil ohne Herkunft ist eine Behauptung.
 *  • **Sicherheitsrelevantes bleibt immer.** Sicherheitsventil,
 *    Ausdehnungsgefäß und Manometer werden nie weggelassen; fehlt die
 *    Sicherheitsauslegung, sagt das ein Fehlerhinweis statt eines leeren
 *    Blattes.
 *  • **Der Puffer bestimmt den Weg.** Ohne Puffer geht der Vorlauf direkt
 *    weiter, der Reihenpuffer liegt im Rücklauf, der Trennpuffer trennt
 *    Erzeuger- und Verteilseite und bekommt alle vier Anschlüsse.
 *
 * **Die Übergabe hat Armaturen.** Jeder Heizkörper bekommt sein
 * Thermostatventil im Vorlauf (§ 63 GEG/GModG: selbsttätig wirkende
 * Einrichtung zur raumweisen Regelung) und seine Rücklaufverschraubung im
 * Rücklauf (Fachgebrauch). Der Flächenheizungsverteiler trägt seine Ventile
 * selbst und bekommt dafür die Absperrung, dazu ein Regulierventil, wenn
 * mehrere Kreise ohne eigene Pumpe an derselben Förderhöhe hängen. Damit
 * zeigen Grundriss (`pipeLayout`) und Schema dieselbe Anlage.
 */
export function buildSchematic(result: PlantDesignResult): {
  components: SchematicComponent[];
  links: SchematicLink[];
  notes: PlanningNote[];
} {
  const components: SchematicComponent[] = [];
  const links: SchematicLink[] = [];
  const notes: PlanningNote[] = [];
  let n = 0;

  const put = (kind: SchematicKind, label: string, x: number, y: number, spec?: string): SchematicComponent => {
    n += 1;
    const c: SchematicComponent = { id: `sc-${n}`, kind, label, x, y, spec, generated: true };
    components.push(c);
    return c;
  };
  /** Eine Leitung mit benannten Stutzen. */
  const link = (
    from: SchematicComponent,
    fromPort: string,
    to: SchematicComponent,
    toPort: string,
    service: SchematicLink['service'],
    label?: string,
  ) => {
    links.push({
      id: `sl-${links.length + 1}`,
      from: from.id,
      to: to.id,
      fromPort,
      toPort,
      service,
      label,
      generated: true,
    });
  };

  /**
   * Die ausgelegte Pflichtarmatur zu einer Bauteilart.
   *
   * `hinweis` unterscheidet die Fälle, in denen dieselbe Bauteilart zweimal
   * vorkommt: Sicherheitsventil der Heizung gegen das des
   * Trinkwassererwärmers, Rückflussverhinderer im Erzeugerkreis gegen den in
   * der Kaltwasserzuleitung.
   */
  const armatur = (kind: SchematicKind, hinweis?: string) =>
    result.safety?.fittings.find((f) => f.kind === kind && (!hinweis || f.label.includes(hinweis)));

  /**
   * Die Kurzform einer technischen Angabe fürs Blatt.
   *
   * Die Auslegung schreibt vollständige Sätze samt Begründung — richtig für
   * die Stückliste und das Anlagenbuch, unbrauchbar unter einem Symbol: der
   * Satz zum Schlammabscheider ist 340 Zeichen lang und hat das Schema bei
   * der ersten Fassung auf M 1:500 gedrückt. Auf dem Symbol steht deshalb nur
   * das erste Glied — „DN 20", „18 l" —, der ganze Text bleibt in der
   * Stückliste.
   */
  const kurz = (spec?: string): string | undefined => {
    if (!spec) return undefined;
    const erstes = spec.split(/[,.;—]/)[0].trim();
    return erstes.length > 28 ? `${erstes.slice(0, 27)}…` : erstes;
  };

  const model = result.selected?.model;
  const form = model?.form ?? 'monoblock-outdoor';
  /*
   * Steht ein Teil des Geräts draußen?
   *
   * Die Frage stand hier bis 1.12.0 als Aufzählung zweier Bauformen. Als
   * `hydrosplit` und `tower` dazukamen, fielen sie stillschweigend in den
   * Zweig „alles im Haus" — das Schema zeichnete keine Außeneinheit für ein
   * Gerät, dessen Kältekreis draußen steht. Kein Fehler, keine Meldung, nur
   * ein falsches Bild. Die Antwort steht jetzt an einer Stelle, im Katalog.
   */
  const draussen = hatAusseneinheit(form);
  /** Ein Splitgerät führt Kältemittel ins Haus; alle anderen führen Wasser. */
  const kaeltemittelInsHaus = form === 'split';
  /** Was das Gerät bereits enthält — es wird nicht ein zweites Mal gezeichnet. */
  const enthalten = model?.contains;

  /*
   * Das Raster.
   *
   * Spalten laufen mit der Fließrichtung: im Vorlauf von links nach rechts,
   * im Rücklauf von rechts nach links — deshalb steht der Schlammabscheider
   * links, unmittelbar vor dem Erzeuger, und nicht am Anfang des Bandes.
   * Zeilen: Sicherheitsgruppe über dem Vorlauf, Heizkreise darüber gestapelt,
   * Rücklauf darunter, Trinkwasser ganz unten.
   */
  const COL = {
    outdoor: 0, indoor: 4, heater: 7, air: 10, vlNode: 13, divert: 17, buffer: 20,
    vlBar: 23, mixer: 27, cpump: 31, manifold: 35, terminal: 39,
    meter: 16, circ: 11, dirt: 6, fill: 12, over: 25,
    dhwIn: 8, dhwSafety: 12, cylinder: 17, tapMix: 22, tap: 26,
    // Übergabearmaturen: sie sitzen zwischen Anbindung und Heizfläche.
    // `mArm` gehört zum Verteiler, `hArm` zum Heizkörper — beide belegen
    // denselben Zeilenblock wie ihr Kreis, deshalb zwei eigene Spalten.
    mArm: 33, hArm: 35,
  };
  const ROW = { blow: -11, safety: -6, flow: 0, ret: 5, service: 9, dhw: 14, tap: 18 };
  /**
   * Höhenversatz der Rücklaufarmatur gegenüber ihrem Kreis.
   *
   * Die Kreise stehen im Abstand von vier Zeilen. Die Armatur im Rücklauf
   * liegt zwei Zeilen unter ihrem Kreis — damit bleibt sie sichtbar dem Kreis
   * zugeordnet und fällt nicht auf den Platz des nächsten.
   */
  const RUECKLAUF_VERSATZ = 2;

  // =========================================================================
  // Erzeuger
  // =========================================================================
  let erzeugerVor: { c: SchematicComponent; port: string };
  let erzeugerRueck: { c: SchematicComponent; port: string };

  if (draussen) {
    const aussen = put(
      'heatpump-outdoor',
      model ? model.label : 'Wärmepumpe',
      COL.outdoor,
      ROW.flow,
      model
        ? `${result.selected?.capacityAtDesign ?? model.nominalCapacity} kW bei ${result.selected ? 'Auslegung' : model.nominalPoint} · ${model.refrigerant}`
        : undefined,
    );

    /*
     * Die Inneneinheit ist kein Sonderfall des Splitgeräts.
     *
     * Über den ganzen Markt — Viessmann, Vaillant, Bosch, Buderus, Wolf,
     * Brötje, LG — liefert jeder Hersteller zum Monoblock außen eine
     * Hydraulikstation oder einen Turm: Pumpe, Umschaltventil,
     * Sicherheitsgruppe, Heizstab, Regelung. Ein Monoblock ohne Innenteil ist
     * kein Regelfall, sondern eine Ausnahme, die es zu benennen gilt.
     */
    /*
     * Die Inneneinheit bekommt das Symbol, das ihrem Inhalt entspricht.
     *
     * Beim Splitgerät steht drinnen der Verflüssiger — ein Kältekreis, also
     * `heatpump-indoor`. Bei Hydrosplit, Monoblock und Turmgerät steht
     * drinnen eine **Hydraulikstation ohne Verdichter**. Bis 1.12.0 trugen
     * beide dasselbe Symbol mit Verdichterkreis, und wer das Bild las, suchte
     * einen zweiten Erzeuger.
     */
    const innenArt: SchematicKind = kaeltemittelInsHaus ? 'heatpump-indoor' : 'hydraulic-station';
    const innenName =
      form === 'split'
        ? 'Inneneinheit'
        : form === 'tower'
          ? 'Kompaktgerät mit Speicher'
          : 'Hydraulikstation';
    const innenText = [
      model?.hydraulicConnection,
      enthalten?.cylinder ? `${enthalten.cylinder} l Speicher` : undefined,
    ]
      .filter(Boolean)
      .join(' · ');
    const innen = put(innenArt, innenName, COL.indoor, ROW.flow, innenText || undefined);
    if (kaeltemittelInsHaus) {
      // Zwischen den Einheiten laufen Kältemittelleitungen. Sie tragen eine
      // eigene Leitungsart — als „Heizung Vorlauf" gezeichnet behauptete die
      // Legende bisher Heizungswasser zwischen Außen- und Inneneinheit.
      link(
        aussen,
        'flow',
        innen,
        'source-in',
        'refrigerant',
        model?.refrigerantLines
          ? `Kältemittel ${model.refrigerantLines.liquid} / ${model.refrigerantLines.gas}`
          : 'Kältemittel',
      );
    } else {
      link(aussen, 'flow', innen, 'source-in', 'heating-flow');
      link(innen, 'source-out', aussen, 'return', 'heating-return');
    }
    erzeugerVor = { c: innen, port: 'flow' };
    erzeugerRueck = { c: innen, port: 'return' };
  } else {
    const innen = put('heatpump-indoor', model ? model.label : 'Wärmepumpe', COL.indoor, ROW.flow, model?.hydraulicConnection);
    erzeugerVor = { c: innen, port: 'flow' };
    erzeugerRueck = { c: innen, port: 'return' };
  }

  // --- Elektro-Heizstab ----------------------------------------------------
  // Die Geräteauswahl rechnet mit ihm („die Restleistung muss der Heizstab
  // liefern"), die Materialliste bestellt ihn — nur gezeichnet wurde er nie.
  // Er ist außerdem hydraulisch von Belang: mit aktiviertem Heizstab sinkt bei
  // mehreren Herstellern das geforderte Mindestwasservolumen erheblich.
  const heizstabKw = model?.indoor?.backupHeater ?? model?.electric.backupHeater ?? 0;
  let vorlauf = erzeugerVor;
  if (heizstabKw > 0) {
    const stab = put('electric-heater', 'Elektro-Heizstab', COL.heater, ROW.flow, `${heizstabKw.toFixed(1)} kW`);
    link(vorlauf.c, vorlauf.port, stab, 'in', 'heating-flow');
    vorlauf = { c: stab, port: 'out' };
  } else if (model) {
    notes.push({
      severity: 'info',
      text: `„${model.label}“ führt keinen Elektro-Heizstab. Ohne ihn deckt das Gerät den Bivalenzpunkt allein ab — und das geforderte Mindestwasservolumen bleibt der volle Wert.`,
    });
  }

  /*
   * Rückschlagklappe im Erzeugervorlauf.
   *
   * Der BWP-Leitfaden zeichnet sie in **jedem** Erzeuger- und Heizkreiszweig,
   * unmittelbar hinter der Pumpe. Ihr Zweck ist die Schwerkraftzirkulation:
   * steht die Pumpe, wandert warmes Wasser von selbst nach oben und kühlt
   * über die Heizflächen aus — im Sommer heizt eine Anlage ohne sie den
   * Speicher rückwärts leer. Enthält das Gerät sie bereits, entfällt sie.
   */
  {
    const absperrVor = put('shutoff', 'Absperrung Erzeuger Vorlauf', COL.heater - 1, ROW.flow);
    link(vorlauf.c, vorlauf.port, absperrVor, 'in', 'heating-flow');
    vorlauf = { c: absperrVor, port: 'out' };
  }
  if (!enthalten?.pump) {
    const klappe = put('check-valve', 'Rückschlagklappe', COL.heater + 1, ROW.flow, 'gegen Schwerkraftzirkulation');
    link(vorlauf.c, vorlauf.port, klappe, 'in', 'heating-flow');
    vorlauf = { c: klappe, port: 'out' };
  }

  /*
   * Volumenstromwächter bei Frostschutzmittel.
   *
   * Daikin fordert ihn ausdrücklich, sobald Glykol im Kreis ist (EKFLSW1):
   * Glykol senkt die Wärmeübertragung und erhöht die Viskosität, ein
   * schleichender Volumenstromverlust bleibt sonst unbemerkt, bis der
   * Wärmetauscher einfriert. Ohne Glykol wird er nicht gezeichnet — die
   * Hersteller sind sich hier uneinig, und ein Bauteil ohne Anlass ist eine
   * Behauptung.
   */
  const glykol = result.safety?.glycol?.fraction ?? 0;
  if (glykol > 0 && !enthalten?.flowSwitch) {
    const waechter = put(
      'flow-switch',
      'Volumenstromwächter',
      COL.heater + 2,
      ROW.flow,
      `Frostschutz ${Math.round(glykol * 100)} Vol-%`,
    );
    link(vorlauf.c, vorlauf.port, waechter, 'in', 'heating-flow');
    vorlauf = { c: waechter, port: 'out' };
  }

  // --- Mikroblasenabscheider im Vorlauf ------------------------------------
  // Er gehört an die heißeste Stelle: die Gaslöslichkeit fällt mit steigender
  // Temperatur, und nur dort perlt gelöstes Gas aus. Genau das steht auch in
  // der Sicherheitsauslegung — das Schema hat es bisher ignoriert und ihn in
  // den Rücklauf gesetzt.
  //
  // **Gezeichnet wird er nur, wenn die Auslegung ihn führt.** Bis 1.10 setzte
  // das Schema ihn auch dann, wenn gar keine Sicherheitsauslegung vorlag —
  // mit erfundener Beschriftung und ohne Nennweite. Ein Bauteil ohne Herkunft
  // ist auf einem Fließbild eine Behauptung.
  const luftArmatur = armatur('air-separator');
  if (luftArmatur) {
    const luft = put('air-separator', luftArmatur.label, COL.air, ROW.flow, kurz(luftArmatur.spec));
    link(vorlauf.c, vorlauf.port, luft, 'in', 'heating-flow');
    vorlauf = { c: luft, port: 'out' };
  }

  // --- Verteilpunkt Vorlauf mit Sicherheitsgruppe --------------------------
  const vlKnoten = put('node', 'Vorlauf', COL.vlNode, ROW.flow);
  link(vorlauf.c, vorlauf.port, vlKnoten, 'west', 'heating-flow');

  if (result.safety) {
    /*
     * Sicherheitsventil, Ausdehnungsgefäß und Manometer sind **Abzweige vom
     * selben Punkt**, keine Reihe. Bis 1.8.1 waren sie hintereinander
     * gezeichnet: der Vorlauf endete im Manometer, und die Ausdehnungsleitung
     * hing am Abblasestutzen des Sicherheitsventils — beides hätte die
     * Sicherheitseinrichtung außer Funktion gesetzt.
     */
    const sv = put(
      'safety-valve',
      'Sicherheitsventil',
      COL.vlNode - 3,
      ROW.safety,
      `DN ${result.safety.safetyValve.dn} · ${result.safety.safetyPressure.toFixed(1)} bar`,
    );
    const mag = put(
      'expansion-vessel',
      'Ausdehnungsgefäß',
      COL.vlNode + 1,
      ROW.safety,
      `${result.safety.selectedVessel} l · p₀ ${result.safety.prePressure.toFixed(1)} bar`,
    );
    const gauge = put('pressure-gauge', 'Manometer', COL.vlNode + 5, ROW.safety, `${result.safety.fillPressure.toFixed(1)} bar Fülldruck`);
    link(vlKnoten, 'north', sv, 'in', 'heating-flow');
    link(vlKnoten, 'north', mag, 'in', 'heating-flow', `Ausdehnungsleitung DN ${result.safety.expansionLine}`);
    link(vlKnoten, 'north', gauge, 'in', 'heating-flow');

    // Die Abblaseleitung ist eine Systemgrenze und gehört benannt aufs Blatt.
    const abblas = put('node', 'Abblaseleitung', COL.vlNode - 3, ROW.blow, 'freier Auslauf, sichtbar');
    link(sv, 'blow', abblas, 'south', 'waste');
  } else {
    notes.push({
      severity: 'error',
      text: 'Ohne Sicherheitsauslegung fehlen dem Schema Sicherheitsventil, Ausdehnungsgefäß und Manometer. Eine Anlage darf so nicht gebaut werden.',
    });
  }

  // =========================================================================
  // Warmwasser
  // =========================================================================
  const hatWw = Boolean(result.dhwStorage);
  let heizungAb: { c: SchematicComponent; port: string } = { c: vlKnoten, port: 'east' };

  if (hatWw) {
    const umschalt = put('valve-diverter', 'Umschaltventil', COL.divert, ROW.flow, '3-Wege · Heizung / Warmwasser');
    link(vlKnoten, 'east', umschalt, 'in', 'heating-flow');
    heizungAb = { c: umschalt, port: 'heating' };

    /*
     * Der Speicher wird über seinen **Wärmetauscher** geladen. Heizungswasser
     * und Trinkwasser berühren sich nicht — deshalb gehen Ladeleitung und
     * Rücklauf an die Stutzen `flow`/`return` und nicht an `cold`.
     */
    const speicher = put(
      'cylinder',
      result.dhwStorage?.label ?? 'Trinkwasserspeicher',
      COL.cylinder,
      ROW.dhw,
      result.dhw ? `${result.dhwStorage?.volume} l · ${result.dhw.storageTemperature} °C` : `${result.dhwStorage?.volume} l`,
    );
    link(umschalt, 'dhw', speicher, 'flow', 'heating-flow', 'Speicherladung');

    /*
     * Die Trinkwasserseite: Anschluss, Sicherheitsgruppe nach DIN 1988-200 /
     * DIN 4753-1, Speicher, Verbrühschutz, Zapfstelle. Bis 1.8.1 stand hier
     * ein einzelner „Systemtrenner" — das ist die Armatur der Heizungs-
     * füllleitung, nicht die des Trinkwassererwärmers, und das Sicherheits-
     * ventil des Speichers fehlte ganz.
     */
    const netz = put('node', 'Trinkwasser', COL.dhwIn, ROW.dhw, 'Hausanschluss');
    const kwSv = armatur('safety-valve', 'Trinkwasser');
    const speicherSv = put(
      'safety-valve',
      'Sicherheitsventil',
      COL.dhwSafety,
      ROW.dhw - 3,
      kurz(kwSv?.spec) ?? 'DIN 1988-200',
    );
    const rv = put('check-valve', 'Rückflussverhinderer', COL.dhwSafety, ROW.dhw, kurz(armatur('check-valve', 'Kaltwasser')?.spec));
    link(netz, 'east', rv, 'in', 'cold-water');
    link(rv, 'out', speicher, 'cold', 'cold-water');
    link(rv, 'out', speicherSv, 'in', 'cold-water');
    const trichter = put('node', 'Entwässerung', COL.dhwSafety - 3, ROW.dhw - 3, 'freier Auslauf');
    link(speicherSv, 'blow', trichter, 'south', 'waste');

    const mischer = put('mixing-valve-dhw', 'Verbrühschutz', COL.tapMix, ROW.dhw, `${result.dhw?.tapTemperature ?? 45} °C`);
    link(speicher, 'dhw', mischer, 'hot', 'hot-water');
    // Ein thermostatischer Mischer ohne Kaltwasser kann nicht mischen.
    link(netz, 'south', mischer, 'cold', 'cold-water');
    const zapf = put('node', 'Zapfstellen', COL.tap, ROW.dhw, 'Verteilung im Gebäude');
    link(mischer, 'mixed', zapf, 'west', 'hot-water');

    if (result.dhw?.circulationRequired) {
      const zirk = put(
        'circulation-pump',
        'Zirkulationspumpe',
        COL.tapMix,
        ROW.tap,
        result.dhw?.circulation?.circulationFlow
          ? `${Math.round(result.dhw.circulation.circulationFlow)} l/h · Δϑ ${result.dhw.circulation.circulationSpread ?? '—'} K`
          : undefined,
      );
      link(zapf, 'south', zirk, 'in', 'circulation');
      link(zirk, 'out', speicher, 'cold', 'circulation');
    }
  }

  // =========================================================================
  // Puffer
  // =========================================================================
  const puffer = result.buffer.selected;
  const reihe = puffer?.kind === 'buffer-series';
  const getrennt = Boolean(puffer) && !reihe;
  let verteilerQuelle = heizungAb;
  let pufferBauteil: SchematicComponent | undefined;

  if (puffer) {
    pufferBauteil = put(
      'buffer',
      puffer.label,
      COL.buffer,
      reihe ? ROW.ret : ROW.flow + 2,
      `${puffer.volume} l · ${reihe ? 'Reihenpuffer im Rücklauf' : 'hydraulisch getrennt'}`,
    );
    if (!reihe) {
      /*
       * Trennpuffer: **alle vier** Anschlüsse. Erzeugerseite links, Anlagenseite
       * rechts. Erst diese Trennung macht das Überströmventil entbehrlich —
       * der Reihenpuffer tut das nicht, er liefert Wasserinhalt, nicht
       * Volumenstrom.
       */
      link(heizungAb.c, heizungAb.port, pufferBauteil, 'gen-flow', 'heating-flow');
      verteilerQuelle = { c: pufferBauteil, port: 'sys-flow' };
    }
  }

  // =========================================================================
  // Rücklaufstrang — von hinten aufgebaut
  // =========================================================================
  /*
   * **Warum rückwärts.** Am Erzeuger steht die Reihenfolge fest: das letzte
   * Bauteil vor dem Wärmetauscher ist der Schlammabscheider, davor die Pumpe,
   * davor der Zähler, davor der Puffer. Was davor kommt, hängt an der Anlage —
   * bei mehreren Kreisen ein Rücklaufbalken, bei einem einzigen der Verbraucher
   * selbst. Wer vorwärts baut, muss diesen Anfang kennen, bevor er ihn kennt.
   *
   * `rueckEin` ist deshalb immer der Stutzen, an dem der Anlagenrücklauf
   * ankommt. Er wandert mit jedem vorgeschalteten Bauteil nach vorn.
   */
  let rueckEin: { c: SchematicComponent; port: string } = erzeugerRueck;
  const vorschalten = (c: SchematicComponent, ein: string, aus: string): void => {
    link(c, aus, rueckEin.c, rueckEin.port, 'heating-return');
    rueckEin = { c, port: ein };
  };

  // --- Schlammabscheider ---------------------------------------------------
  // Er bleibt, solange die Auslegung ihn führt — und sie führt ihn immer,
  // wenn eine Wärmepumpe im Spiel ist: der Verflüssiger ist ein gelöteter
  // Plattenwärmetauscher, den Magnetit aus Stahlheizkörpern zusetzt. Er ist
  // das **letzte** Bauteil vor dem Erzeuger; was danach käme, liefe ungefiltert
  // in den Wärmetauscher.
  /*
   * Absperrung unmittelbar am Erzeuger.
   *
   * DIN EN 12828 verlangt, dass sich der Wärmeerzeuger ohne Entleerung der
   * Anlage ausbauen lässt; der BWP-Leitfaden zeichnet beidseitige
   * Absperrventile in jedem Erzeugerzweig. Bis 1.12.0 zeichnete dieses
   * Programm keine einzige — die Schemaprüfung meldete das bei **jedem**
   * erzeugten Bild, und sie hatte recht. Eine Pumpe, die man ohne Absperrung
   * tauschen soll, entleert die Anlage.
   *
   * Sie ist die **erste** Vorschaltung und sitzt damit am Gerät. Alles
   * Weitere — Schlammabscheider, Pumpe, Zähler, Puffer — liegt dahinter und
   * lässt sich mit ihr abtrennen.
   */
  {
    const absperrRueck = put('shutoff', 'Absperrung Erzeuger Rücklauf', COL.dirt - 3, ROW.ret);
    vorschalten(absperrRueck, 'in', 'out');
  }

  const schlammArmatur = armatur('dirt-separator');
  if (schlammArmatur) {
    const schlamm = put('dirt-separator', schlammArmatur.label, COL.dirt, ROW.ret, kurz(schlammArmatur.spec));
    vorschalten(schlamm, 'in', 'out');
    // Das Abschlämmventil führt ins Freie — eine Systemgrenze, und die gehört
    // benannt aufs Blatt. Sie entsteht mit ihrem Bauteil und verschwindet mit
    // ihm; ein Trichter ohne Abscheider darüber wäre ein Bauteil aus Gewohnheit.
    const abschlamm = put('node', 'Entwässerung', COL.dirt, ROW.service + 2, 'freier Auslauf');
    link(schlamm, 'drain', abschlamm, 'north', 'waste');
  }

  // --- Umwälzpumpe ---------------------------------------------------------
  // Nur, wenn eine ausgelegt ist. `designPump` liefert ohne Heizkreis kein
  // Ergebnis — und eine Pumpe ohne Förderstrom und Förderhöhe wäre eine Zahl,
  // die niemand gerechnet hat.
  let umwaelz: SchematicComponent | undefined;
  if (result.pump) {
    umwaelz = put(
      'pump',
      'Umwälzpumpe',
      COL.circ,
      ROW.ret,
      `erf. ${result.pump.flow.toFixed(2)} m³/h · ${result.pump.head.toFixed(1)} m`,
    );
    vorschalten(umwaelz, 'in', 'out');
    // Zweite Absperrung auf der Anlagenseite: erst mit ihr liegt die Pumpe
    // zwischen zwei Absperrungen und lässt sich ohne Entleeren tauschen.
    // Die erste sitzt am Erzeuger, siehe oben.
    const absperrPumpe = put('shutoff', 'Absperrung Pumpe', COL.circ - 2, ROW.ret);
    vorschalten(absperrPumpe, 'in', 'out');
  }

  // --- Wärmemengenzähler ---------------------------------------------------
  // Er steht in der Sicherheitsliste, solange die Anlage gefördert wird
  // (BEG-EM: Nachweis der Jahresarbeitszahl). Sagt die Auslegung nichts von
  // ihm, zeichnet ihn das Schema auch nicht — ein Zähler ist keine
  // Pflichtarmatur der DIN EN 12828.
  const wmzArmatur = armatur('heat-meter');
  if (wmzArmatur) {
    const wmz = put('heat-meter', wmzArmatur.label, COL.meter, ROW.ret, kurz(wmzArmatur.spec));
    vorschalten(wmz, 'in', 'out');
  }

  // --- Puffer im Rücklauf --------------------------------------------------
  /*
   * Beide Bauarten hängen im Rücklauf mit denselben zwei Stutzen: der
   * Reihenpuffer liegt **in** der Leitung, der Trennpuffer nimmt hier die
   * Anlagenseite auf, deren Vorlauf oben schon abgegriffen wurde. Erst damit
   * hat der Trennpuffer alle vier Anschlüsse.
   */
  if (pufferBauteil) vorschalten(pufferBauteil, 'sys-return', 'gen-return');

  // =========================================================================
  // Verteilung — Balken nur, wenn verteilt wird
  // =========================================================================
  /*
   * **Die Regel.** Ein Verteilbalken ist die Stelle, an der sich ein
   * Volumenstrom auf mehrere Wege teilt. Bei genau einem Heizkreis teilt sich
   * nichts: der Vorlauf läuft vom Erzeuger — oder vom Trennpuffer — unmittelbar
   * zum Verbraucher und der Rücklauf zurück. Der Balken war dort ein Knoten mit
   * je einer Leitung auf beiden Seiten, also ein gezeichnetes Nichts, das dem
   * Heizungsbauer eine Verteilung vorspiegelte, die es nicht gibt.
   *
   * Bei mehreren Kreisen bleibt er: dann ist er die Aussage, dass alle Kreise
   * an derselben Vorlauftemperatur und demselben Differenzdruck hängen.
   */
  const mehrereKreise = result.circuits.length > 1;
  let vlBalken: SchematicComponent | undefined;
  let rlBalken: SchematicComponent | undefined;
  if (mehrereKreise) {
    vlBalken = put('node', 'Vorlaufbalken', COL.vlBar, ROW.flow);
    rlBalken = put('node', 'Rücklaufbalken', COL.vlBar, ROW.ret);
    link(verteilerQuelle.c, verteilerQuelle.port, vlBalken, 'west', 'heating-flow');
    link(rlBalken, 'west', rueckEin.c, rueckEin.port, 'heating-return');
  }
  /** Woher ein Kreis seinen Vorlauf nimmt. */
  const vlAb: { c: SchematicComponent; port: string } = vlBalken
    ? { c: vlBalken, port: 'north' }
    : verteilerQuelle;
  /** Wohin ein Kreis seinen Rücklauf gibt. */
  const rlAn: { c: SchematicComponent; port: string } = rlBalken
    ? { c: rlBalken, port: 'north' }
    : rueckEin;

  // Der Speicherrücklauf mündet in denselben Sammler wie die Heizkreise — die
  // Wärmemenge für Heizung und Warmwasser wird damit gemeinsam erfasst.
  if (hatWw) {
    const speicher = components.find((x) => x.kind === 'cylinder');
    if (speicher) {
      if (rlBalken) link(speicher, 'return', rlBalken, 'south', 'heating-return');
      else link(speicher, 'return', rueckEin.c, rueckEin.port, 'heating-return');
    }
  }

  // =========================================================================
  // Heizkreise samt Übergabearmaturen
  // =========================================================================
  let row = ROW.flow - 4;
  for (const c of result.circuits) {
    const kreis = c.circuit;
    let ab: { c: SchematicComponent; port: string } = vlAb;
    /*
     * Bekommt der Kreis seinen Volumenstrom aus einer **eigenen** Pumpe?
     * Dann ist er hydraulisch für sich, und am Verteiler ist nichts
     * einzuregulieren. Teilt er sich dagegen eine Pumpe mit anderen Kreisen,
     * muss die Aufteilung festgelegt werden — sonst nimmt der kurze Weg das
     * Wasser und der lange bleibt kalt.
     */
    const eigenePumpe = kreis.mixed || getrennt;

    if (kreis.mixed) {
      /*
       * Gemischt ist die **Fläche**, nicht der Heizkörper: der Erzeuger fährt
       * die höchste geforderte Temperatur, und heruntergemischt wird der
       * kältere Kreis. Zum Mischer gehört immer eine eigene Pumpe — ohne sie
       * steht der Kreis, sobald der Mischer zufährt.
       */
      const mix = put('valve-3way', 'Mischer', COL.mixer, row, `${kreis.flowTemperature}/${kreis.returnTemperature} °C`);
      link(vlAb.c, vlAb.port, mix, 'hot', 'heating-flow', c.pipe.dimension.label);
      // Die Beimischung kommt aus dem Anlagenrücklauf — mit Balken von dort,
      // ohne Balken unmittelbar aus der Rücklaufleitung.
      link(rlAn.c, rlAn.port, mix, 'cold', 'heating-return', 'Beimischung');
      const kp = put('pump', 'Kreispumpe', COL.cpump, row, `${c.flow.toFixed(2)} m³/h`);
      link(mix, 'mixed', kp, 'in', 'heating-flow');
      ab = { c: kp, port: 'out' };
    } else if (getrennt) {
      // Hinter der hydraulischen Trennung braucht auch der ungemischte Kreis
      // seine eigene Pumpe — die Primärpumpe fördert nur bis zum Puffer.
      const kp = put('pump', 'Kreispumpe', COL.cpump, row, `${c.flow.toFixed(2)} m³/h`);
      link(vlAb.c, vlAb.port, kp, 'in', 'heating-flow', c.pipe.dimension.label);
      ab = { c: kp, port: 'out' };
    }
    /*
     * Rückschlagklappe hinter jeder Kreispumpe.
     *
     * Der BWP-Leitfaden zeichnet sie in **jedem** Heizkreiszweig unmittelbar
     * hinter der Pumpe — ungemischt wie gemischt. Ohne sie durchströmt ein
     * stehender Kreis rückwärts, sobald ein anderer fördert: der abgeschaltete
     * Raum wird mitgeheizt, und die Regelung greift ins Leere.
     */
    if (ab.c.kind === 'pump') {
      const klappe = put('check-valve', 'Rückschlagklappe', COL.cpump + 1, row);
      link(ab.c, ab.port, klappe, 'in', 'heating-flow');
      ab = { c: klappe, port: 'out' };
    }
    /** Die Anbindeleitung wird nur dort beschriftet, wo sie vom Sammler abgeht. */
    const anbindung = ab === vlAb ? c.pipe.dimension.label : undefined;

    if (kreis.kind === 'floor') {
      /*
       * **Am Flächenheizungsverteiler sitzt kein Thermostatventil.** Der
       * Verteiler trägt seine Ventile selbst: Durchflussmesser im Vorlauf,
       * Stellantriebe im Rücklauf, angesteuert von der Einzelraumregelung.
       * Was im Schema fehlte, ist die **Absperrung** des ganzen Verteilers —
       * ohne sie lässt sich kein Kreis nachrüsten und kein Stellantrieb
       * wechseln, ohne die Anlage zu entleeren. Der Rohrausleger setzt sie im
       * Grundriss längst (siehe `pipeLayout`, „Absperrung Verteiler"); im
       * Schema stand der Verteiler nackt an der Leitung.
       *
       * Fachgebrauch, keine Normpflicht — deshalb steht das auch so in der
       * technischen Angabe.
       */
      const absperr = put(
        'shutoff',
        'Absperrung Verteiler',
        COL.mArm,
        row,
        'Vor- und Rücklauf absperrbar (Fachgebrauch)',
      );
      link(ab.c, ab.port, absperr, 'in', 'heating-flow', anbindung);

      const verteiler = put(
        'manifold',
        'Verteiler',
        COL.manifold,
        row,
        `${kreis.loops ?? c.floor?.loops ?? '—'} Kreise · ${kreis.flowTemperature}/${kreis.returnTemperature} °C · ${c.flow.toFixed(2)} m³/h`,
      );
      const flaeche = put('floor-loop', kreis.label, COL.terminal, row, c.floor ? `${Math.round(c.floor.totalLength)} m Rohr` : undefined);
      link(absperr, 'out', verteiler, 'flow', 'heating-flow');
      link(verteiler, 'circuit-1', flaeche, 'flow', 'heating-flow');
      link(flaeche, 'return', verteiler, 'circuit-2', 'heating-return');

      if (mehrereKreise && !eigenePumpe) {
        /*
         * Ein Strangregulierventil im Rücklauf des Verteilers — aber nur hier:
         * mehrere Kreise an derselben Pumpe, und dieser hat keine eigene. Nur
         * dann verteilt sich eine Förderhöhe auf mehrere Wege und die
         * Aufteilung muss eingestellt werden. Hat der Kreis seine eigene
         * Pumpe, gibt sie den Volumenstrom vor, und ein Regulierventil davor
         * würde nur Förderhöhe vernichten.
         */
        const regel = put(
          'balancing-valve',
          'Regulierventil',
          COL.mArm,
          row + RUECKLAUF_VERSATZ,
          `${c.flow.toFixed(2)} m³/h`,
        );
        link(verteiler, 'return', regel, 'in', 'heating-return');
        link(regel, 'out', rlAn.c, rlAn.port, 'heating-return', c.pipe.dimension.label);
      } else {
        link(verteiler, 'return', rlAn.c, rlAn.port, 'heating-return', c.pipe.dimension.label);
      }
    } else {
      /*
       * **Der Heizkörper hängt nicht nackt an der Leitung.**
       *
       * § 63 GEG/GModG verlangt für jeden Raum eine selbsttätig wirkende
       * Einrichtung zur raumweisen Regelung der Raumtemperatur; am Heizkörper
       * ist das das Thermostatventil im Vorlauf. Die Rücklaufverschraubung
       * gehört fachlich dazu — sie sperrt ab und stellt voreinstellbar den
       * Volumenstrom ein —, ist aber nicht normativ gefordert. Genau diese
       * beiden setzt der Rohrausleger im Grundriss (`pipeLayout`); im Schema
       * fehlten sie, und damit widersprachen sich die beiden Darstellungen
       * derselben Anlage.
       *
       * Die Bauteilarten sind die vorhandenen: das Thermostatventil ist ein
       * Zweiwege-Regelventil (es drosselt selbsttätig statt fremdbetätigt),
       * die Rücklaufverschraubung ein Regulierventil mit Voreinstellung.
       */
      const thermostat = put(
        'valve-2way',
        'Thermostatventil',
        COL.hArm,
        row,
        'voreinstellbar (§ 63 GEG/GModG)',
      );
      link(ab.c, ab.port, thermostat, 'in', 'heating-flow', anbindung);

      const hk = put('radiator', kreis.label, COL.terminal, row, `${c.load.toFixed(1)} kW · ${kreis.flowTemperature}/${kreis.returnTemperature} °C`);
      link(thermostat, 'out', hk, 'flow', 'heating-flow');

      const verschraubung = put(
        'balancing-valve',
        'Rücklaufverschraubung',
        COL.hArm,
        row + RUECKLAUF_VERSATZ,
        'absperr- und entleerbar (Fachgebrauch)',
      );
      link(hk, 'return', verschraubung, 'in', 'heating-return');
      link(verschraubung, 'out', rlAn.c, rlAn.port, 'heating-return', c.pipe.dimension.label);
    }

    /*
     * Temperaturwächter am **ungemischten** Flächenheizkreis.
     *
     * Ohne Mischer liegt am Estrich die Vorlauftemperatur des Erzeugers an.
     * Steigt sie — Warmwasserladung, Estrichaufheizung, Störung —, bekommt
     * der Fußboden sie ungebremst ab; Viessmann, Wolf, Panasonic und Stiebel
     * fordern deshalb übereinstimmend einen Temperaturwächter, der die
     * Kreispumpe abschaltet. Bei einem gemischten Kreis übernimmt das der
     * Mischer, dort entfällt er.
     *
     * Er sitzt **an** der Leitung, nicht darin: ein einziger Stutzen, wie
     * beim Thermometer. Deshalb wird er angehängt und nicht eingeschleift —
     * und zwar **nach** dem Kreis, damit die erste abgehende Leitung des
     * Vorlaufs weiterhin die zum Verbraucher ist und nicht die zum Fühler.
     */
    if (kreis.kind === 'floor' && !kreis.mixed) {
      const waechter = put(
        'temperature-limiter',
        'Temperaturwächter',
        COL.mixer,
        row - 2,
        `Abschaltung über ${Math.round(kreis.flowTemperature + 10)} °C`,
      );
      link(ab.c, ab.port, waechter, 'in', 'heating-flow');
    }

    row -= 4;
  }

  if (result.circuits.length === 0) {
    notes.push({ severity: 'warn', text: 'Kein Heizkreis ausgelegt — das Schema zeigt nur den Erzeugerteil.' });
  }

  // =========================================================================
  // Füllen und Entleeren
  // =========================================================================
  /*
   * Jede Anlage muss befüllt werden, und zwischen Trinkwassernetz und
   * Heizungswasser steht dabei eine Systemtrennung — das ist keine Frage der
   * Anlagengröße. Gezeichnet wird die Strecke trotzdem nur, wenn die Auslegung
   * beide Armaturen führt: ohne Sicherheitsauslegung gibt es weder Nennweite
   * noch Flüssigkeitskategorie, und ein „Typ CA" ohne Herkunft wäre geraten.
   *
   * Angeschlossen wird an die **Anlagenleitung**, nicht an das Abschlämmventil
   * des Abscheiders: vor der Pumpe, wo der Druck am niedrigsten ist. Fehlt die
   * Pumpe, geht sie an den Anlagenrücklauf.
   */
  const fuellArmatur = armatur('filling-valve', 'Füll- und Entleerungsarmatur');
  const trenner = armatur('backflow-preventer');
  if (fuellArmatur && trenner) {
    const fuellKnoten = put('node', 'Anschluss Füllleitung', COL.fill, ROW.service);
    const fuellung = put('filling-valve', 'Füll- und Entleerarmatur', COL.fill + 5, ROW.service, kurz(fuellArmatur.spec));
    const systemtrenner = put('backflow-preventer', 'Systemtrenner', COL.fill + 10, ROW.service, kurz(trenner.spec));
    const fuellNetz = put('node', 'Trinkwasser', COL.fill + 14, ROW.service, 'Hausanschluss');
    link(fuellNetz, 'west', systemtrenner, 'in', 'cold-water');
    link(systemtrenner, 'out', fuellung, 'in', 'cold-water');
    link(fuellung, 'hose', fuellKnoten, 'east', 'heating-return');
    if (umwaelz) link(fuellKnoten, 'north', umwaelz, 'in', 'heating-return');
    else link(fuellKnoten, 'north', rueckEin.c, rueckEin.port, 'heating-return');
  }

  // =========================================================================
  // Überströmventil — gezeichnet wird, was die Sicherheitsauslegung fordert
  // =========================================================================
  /*
   * Die Regel steht in `safetyFittings` und nicht hier: sie entscheidet aus
   * Mindestvolumenstrom, kleinstem Kreis und hydraulischer Trennung. Zwei
   * Stellen, die dieselbe Frage beantworten, geben irgendwann zwei Antworten.
   *
   * Belegt ist sie aus den Montageanleitungen: „Falls kein Trennspeicher
   * eingesetzt wird, Mindestheizwasserdurchsatz durch ein Überströmventil
   * sicherstellen." Entscheidend ist die hydraulische Trennung, nicht der
   * Behälter — ein Reihenpuffer liegt im selben Strang und liefert
   * Wasserinhalt, keinen Volumenstrom.
   *
   * Der Kurzschluss läuft zwischen Vor- und Rücklauf der Verteilseite: mit
   * Balken von Balken zu Balken, ohne Balken unmittelbar zwischen den beiden
   * Leitungen.
   */
  const ueberArmatur = armatur('overflow-valve');
  if (ueberArmatur) {
    const ueber = put('overflow-valve', 'Überströmventil', COL.over, ROW.flow + 2, kurz(ueberArmatur.spec));
    if (vlBalken) link(vlBalken, 'south', ueber, 'in', 'heating-flow');
    else link(verteilerQuelle.c, verteilerQuelle.port, ueber, 'in', 'heating-flow');
    if (rlBalken) link(ueber, 'out', rlBalken, 'east', 'heating-return');
    else link(ueber, 'out', rueckEin.c, rueckEin.port, 'heating-return');
    if (reihe) {
      notes.push({
        severity: 'info',
        text: `Der ${puffer?.label} liegt in Reihe im Rücklauf: er sichert den Wasserinhalt für die Abtauung, nicht den Mindestvolumenstrom. Deshalb steht zusätzlich ein Überströmventil im Schema. Mit einem Trennpuffer entfiele es.`,
      });
    }
  } else if (getrennt) {
    notes.push({
      severity: 'info',
      text: `Kein Überströmventil: der ${puffer?.label ?? 'Trennpuffer'} trennt hydraulisch, die Erzeugerseite behält ihren Volumenstrom unabhängig von den Stellantrieben.`,
    });
  }

  return { components, links, notes };
}
