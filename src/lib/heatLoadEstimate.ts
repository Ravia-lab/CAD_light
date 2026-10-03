/**
 * Überschlägige Heizlast — die Zahl, ohne die keine Anlage ausgelegt werden kann.
 * ---------------------------------------------------------------------------
 * **Warum es dieses Modul gibt und was es ausdrücklich nicht ist.**
 *
 * Die Norm-Heizlast nach DIN EN 12831-1 rechnet RaVia. Dieses Programm erfasst
 * die Eingangsdaten dafür und rechnet sie bewusst nicht nach — zwei Programme,
 * die dieselbe Zahl unterschiedlich ermitteln, sind schlimmer als eines.
 *
 * Nur: für die Anlagenauslegung — welches Gerät, wie groß der Puffer, welche
 * Rohrnennweite, welches Ausdehnungsgefäß — braucht man *eine* Leistungszahl,
 * und zwar bevor die Heizlastberechnung fertig ist. Genau dafür ist dieses
 * Modul da. Es rechnet die **Transmissions- und Lüftungsverluste** aus
 * denselben Flächen, U-Werten und Temperaturen, die ohnehin exportiert
 * werden, und liefert damit eine Zahl in der richtigen Größenordnung.
 *
 * Was fehlt und warum das Ergebnis deshalb ein Überschlag bleibt:
 *  • kein Wiederaufheizzuschlag (in Deutschland national 0, aber nicht überall),
 *  • keine raumweise Infiltration über die Gebäudedichtheit — es wird der
 *    Mindestluftwechsel n_min angesetzt, nicht der größere Wert aus n50,
 *  • keine solaren und internen Gewinne (die zählen in der Heizlast ohnehin
 *    nicht, wohl aber in der Jahresbilanz),
 *  • keine Zonierung, keine Nachbarraumbilanz über Geschossgrenzen hinweg.
 *
 * Jedes Ergebnis dieses Moduls trägt `istUeberschlag: true`. Wer die
 * Norm-Heizlast hat, trägt sie ein — dann rechnet nichts mehr hier, und die
 * Anlagenauslegung fußt auf der belastbaren Zahl.
 *
 * **Seit die Einbettung schreiben darf**, kommt diese belastbare Zahl nicht
 * mehr nur von Hand: RaVia schreibt sie raumweise als `Room.normHeatLoad` ins
 * Modell. Dieses Modul rechnet sie trotzdem nicht ein — `total` bleibt der
 * reine Überschlag, sonst wäre die Bilanz eine Mischung aus zwei Verfahren und
 * die Kennzahl W/m² ließe sich gegen nichts mehr prüfen. Es führt die
 * gerechnete Last je Raum nur *mit* und beantwortet die Frage, wie weit sie
 * trägt (`normHeatLoadCoverage`). Was daraus wird, entscheidet die
 * Anlagenauslegung.
 */

import type { BimDocument, ExportSurface, Room, RoomHeatLoad as NormRoomHeatLoad, VentilationRole } from '../types/bim';
import { isMassiveArea } from './roomDetection';
import { roomBridgeHeatLoss, roomThermalBridges } from './thermalBridges';
import { raumFlaechen } from './raviaExport';
import { BAUTEIL_BEZEICHNUNG } from './uwert';

/**
 * Volumenbezogener Wärmekapazitätsstrom der Luft [Wh/(m³·K)].
 *
 * ρ·c für Luft bei 20 °C: 1,204 kg/m³ × 1005 J/(kg·K) = 1210 J/(m³·K)
 * = 0,336 Wh/(m³·K). Der in der Praxis benutzte Wert 0,34 ist genau das,
 * auf zwei Stellen gerundet.
 */
export const AIR_CAPACITY = 0.34;

/** Wärmeverlust eines Raums, aufgeschlüsselt. */
export interface RoomHeatLoad {
  roomId: string;
  name: string;
  levelId: string;
  /** Solltemperatur [°C]. */
  setpoint: number;
  /** Transmission über Wände, Boden, Decke, Dach [W]. */
  transmission: number;
  /** Transmission über Fenster und Türen [W]. */
  openings: number;
  /** Lüftungsverlust aus n_min · V [W]. */
  ventilation: number;
  /** Summe [W]. */
  total: number;
  /** Grundfläche [m²] — für die Kennzahl W/m². */
  area: number;
  /** Spezifische Heizlast [W/m²]. */
  specific: number;
  /**
   * Gerechnete Norm-Heizlast dieses Raums, falls die Gegenstelle sie
   * geschrieben hat. Sie steht neben `total`, nicht darin: hier bleibt alles
   * Überschlag, damit die Summe ein einziges Verfahren abbildet. Wer die
   * bessere Zahl will, nimmt sie sich hier ab.
   */
  normHeatLoad?: NormRoomHeatLoad;
  /**
   * Bauteile dieses Raums, für die kein U-Wert zu ermitteln war — weder aus
   * einem Aufbau, noch am Bauteil, noch aus dem Vorgabekatalog.
   *
   * **Warum das eine eigene Angabe ist und nicht bloß ein Hinweis.** Ein
   * Bauteil ohne U-Wert geht mit 0 W in die Bilanz; die Zahl daneben ist
   * damit zu klein, und zwar unsichtbar zu klein. Gemessen am Referenzhaus:
   * 5,47 kW mit U-Werten, 3,88 kW ohne — Gerät 8 kW statt 6 kW. Wer `total`
   * liest, muss deshalb auch lesen können, ob `total` vollständig ist.
   *
   * Aufgeführt wird die **Bauteilart** („Außenwand", „Boden"), nicht jedes
   * einzelne Bauteil: Eine Liste mit vierzehnmal „Außenwand" sagt nichts, was
   * einmal „Außenwand" nicht auch sagt. Die einzelnen Bauteile benennt die
   * Modellprüfung, die dafür da ist.
   *
   * Leer, solange nichts fehlt. Gemeldet wird nur, was auch wirkt: ein Bauteil
   * ohne Temperaturunterschied oder ohne Fläche verfälscht nichts, und eine
   * Meldung ohne Folgen entwertet die daneben, die Folgen hat.
   */
  unvollstaendig: string[];
  /**
   * Die gerechnete Last wurde für einen anderen Modellstand ermittelt.
   *
   * Kein Fehler und kein Grund, die Zahl zu verwerfen: eine verschobene
   * Innenwand macht die Heizlast des Nachbarraums fraglich, nicht ungültig.
   * Aber es muss dranstehen.
   */
  normOutdated?: boolean;
}

/**
 * Wie weit die gerechneten Raum-Heizlasten tragen.
 *
 * Die Frage entscheidet, ob die Anlagenauslegung eine Gebäudeheizlast aus
 * gerechneten Zahlen bilden darf oder beim eigenen Überschlag bleiben muss.
 * Sie hat deshalb eine eigene Antwort und steckt nicht als Nebenprodukt im
 * Überschlag.
 */
export interface NormHeatLoadCoverage {
  /** Beheizte Räume im Modell. */
  heatedRooms: number;
  /** Davon mit gerechneter Norm-Heizlast. */
  withNorm: number;
  /** Davon für einen abweichenden Modellstand gerechnet. */
  outdated: number;
  /** Summe der gerechneten Lasten [kW] — nur aussagekräftig, wenn `complete`. */
  totalKw: number;
  /**
   * Gebäudeheizlast aus den Raumlasten [kW] (Befund B8): Σ(Last − Lüftung) +
   * Lüftung auf Gebäudeebene, wenn jede Raumlast ihren Lüftungsanteil
   * ausweist; sonst gleich `total`.
   */
  gebaeudeKw: number;
  /** Ist in `gebaeudeKw` die Lüftung auf Gebäudeebene gebildet? */
  lueftungGebaeude: boolean;
  /** Tragen alle beheizten Räume eine gerechnete Last? */
  complete: boolean;
  /** Namen der Räume ohne gerechnete Last — sie sind der Grund, wenn es nicht reicht. */
  missing: string[];
  /** Namen der Räume mit abweichendem Modellstand. */
  outdatedRooms: string[];
  /** Absender der jüngsten Übernahme, z. B. „RaVia 3.2". */
  source?: string;
  /** Zeitpunkt der jüngsten Übernahme (ISO-8601). */
  receivedAt?: string;
}

export interface HeatLoadEstimate {
  /** Immer `true` — die Zahl ist kein Normnachweis. */
  istUeberschlag: true;
  rooms: RoomHeatLoad[];
  /**
   * Gebäudeheizlast [kW]. Seit 1.73.0 mit Einheit im Namen (Festlegung F6):
   * alle anderen Leistungen in diesem Objekt stehen in W.
   */
  totalKw: number;
  transmission: number;
  /** Lüftungswärmeverlust des Gebäudes [W] — nicht die Summe der Räume (Befund B8). */
  ventilation: number;
  /** Summe der Raum-Lüftungsverluste [W] — nur zum Vergleich. */
  ventilationRooms: number;
  /** Beheizte Nettogrundfläche [m²]. */
  heatedArea: number;
  /** Spezifische Heizlast des Gebäudes [W/m²] — die Plausibilitätsprobe. */
  specific: number;
  /** Norm-Außentemperatur, mit der gerechnet wurde [°C]. */
  designOutdoor: number;
  /** Einordnung der Kennzahl in bekannte Baualtersklassen. */
  klassifizierung: string;
  /**
   * Namen der Räume, in denen mindestens ein Bauteil ohne U-Wert steckt.
   *
   * Der Vorbehalt der Einzelzeile muss an der Summe ankommen, sonst trägt ihn
   * niemand weiter: Wer nur `total` weiterreicht — die Anlagenauslegung tut
   * genau das —, sähe eine glatte Zahl ohne Makel. Die Gerätewahl hinge dann
   * an einer Heizlast, die um ein Viertel zu klein ist.
   */
  unvollstaendigeRaeume: string[];
  /**
   * Ist die Gebäudeheizlast aus lückenlosen Angaben entstanden?
   *
   * `false` heißt: mindestens ein Bauteil geht mit einer Annahme des Exports
   * statt mit einem erfassten U-Wert ein (seit 1.73.0, Festlegung F1 — bis
   * 1.72.0 ging es mit 0 W ein, die Zahl war dann zu klein).
   */
  vollstaendig: boolean;
}


/** Klartext der Bauteilart einer Exportfläche — für die Lückenliste. */
function bauteilVon(f: ExportSurface): string {
  if (f.kind === 'wall') return f.component === 'slab' ? 'Wand' : BAUTEIL_BEZEICHNUNG[f.component];
  return { floor: 'Boden', ceiling: 'Decke', roof: 'Dach', gable: 'Giebel' }[f.kind];
}

/**
 * Fläche × U × Δθ eines Raums.
 *
 * Der Wärmebrückenzuschlag wird beim pauschalen Verfahren auf jeden U-Wert
 * aufgeschlagen; beim ausführlichen Verfahren steckt er in ψ·l und darf hier
 * nicht noch einmal auftauchen. Genau diese Fallunterscheidung ist der Grund,
 * warum der Zuschlag nicht einfach addiert wird.
 *
 * **Befund B4.** Bis 1.72.0 fiel beim ausführlichen Verfahren der Zuschlag
 * weg, ψ·l kam aber nirgends hinzu — der Überschlag lag typisch 5 … 15 % zu
 * niedrig. Jetzt H_T = Σ A·U + Σ ψ·l, die Anschlüsse mit (θ_i − θ_e).
 */
function roomLoad(
  doc: BimDocument,
  room: Room,
  istAktuell: (load: NormRoomHeatLoad) => boolean,
  flaechen: readonly ExportSurface[],
): RoomHeatLoad {
  const inside = room.setpointTemperature;
  let transmission = 0;
  let openings = 0;

  /*
   * Die Lücken dieses Raums: Bauteil**arten**, deren U-Wert nur eine Annahme
   * des Exports ist (weder Aufbau noch Eintrag noch Katalog). Ein `Set`, weil
   * vierzehn Außenwände ohne U-Wert eine Aussage sind, nicht vierzehn.
   * Gemeldet wird nur, was auch wirkt: Fläche > 0 und Δθ > 0.
   */
  const luecken = new Set<string>();

  /*
   * **Festlegung F1 (seit 1.73.0).** Die Flächen sind dieselben, die der
   * Export an RaVia übergibt (`raumFlaechen`): Giebel, Dach, Gaube,
   * Treppenloch, Erdreich-Split, U-Wert je Öffnung, ΔU_WB je Wand, θ_u und
   * Nachbartemperatur. Bis 1.72.0 bildete der Überschlag sie ein zweites Mal
   * aus den Raumkanten — mit anderer U-Rangfolge an Boden und Decke, Fenstern
   * pauschal mit 1,3 und ohne Treppenloch. Dasselbe Gebäude hatte damit im
   * Anlagenblatt eine andere Hülle als in der Übergabe.
   *
   * Hier bleibt nur die Rechnung: A · (U + ΔU_WB) · (θ_i − θ_Nachbar), ohne
   * die Temperaturkorrekturfaktoren der Norm — die rechnet RaVia.
   */
  for (const f of flaechen) {
    const dt = inside - f.neighbourTemperature;
    if (!(dt > 0)) continue;
    const tb = Number.isFinite(f.thermalBridgeSupplement) ? f.thermalBridgeSupplement : 0;
    if (f.uValueSource === 'annahme' && f.netArea > 1e-6) luecken.add(bauteilVon(f));
    transmission += f.netArea * (f.uValue + tb) * dt;
    for (const o of f.openings) {
      if (o.uValueSource === 'annahme' && o.area > 1e-6) luecken.add(o.kind === 'door' ? 'Tür' : 'Fenster');
      openings += o.area * (o.uValue + tb) * dt;
    }
  }

  const dtOutside = inside - doc.meta.designOutdoorTemperature;
  if (doc.meta.thermalBridgeMethod === 'detailed' && room.isHeated && dtOutside > 0) {
    transmission += roomBridgeHeatLoss(roomThermalBridges(doc, room)) * dtOutside;
  }
  const ventilation = Math.max(0, AIR_CAPACITY * room.airChangeRate * room.volume * dtOutside);
  const total = transmission + openings + ventilation;
  return {
    roomId: room.id,
    name: room.name,
    levelId: room.levelId,
    setpoint: inside,
    transmission: Math.round(transmission),
    openings: Math.round(openings),
    ventilation: Math.round(ventilation),
    total: Math.round(total),
    area: room.area,
    specific: room.area > 0 ? Math.round(total / room.area) : 0,
    // Sortiert, damit zwei Läufe über dasselbe Modell dieselbe Reihenfolge
    // liefern: Die Liste wird gedruckt und gegen einen Sollstand gehalten,
    // und eine Reihenfolge, die an der Einfügereihenfolge einer Menge hängt,
    // erzeugt Abweichungen ohne Sachgrund.
    unvollstaendig: [...luecken].sort((a, b2) => a.localeCompare(b2, 'de')),
    normHeatLoad: room.normHeatLoad,
    normOutdated: room.normHeatLoad ? !istAktuell(room.normHeatLoad) : undefined,
  };
}


/**
 * Einordnung der spezifischen Heizlast.
 *
 * Die Grenzen sind Erfahrungswerte des deutschen Wohnungsbaus, keine Norm.
 * Sie dienen einem einzigen Zweck: einen Eingabefehler sichtbar zu machen,
 * bevor er ein Gerät zu groß macht. 250 W/m² ist keine Heizlast, sondern ein
 * vergessener U-Wert.
 */
function classify(specific: number, vollstaendig: boolean): string {
  if (specific <= 0) return 'Keine beheizten Räume erkannt.';
  /*
   * Fehlt irgendwo ein U-Wert, ist die Kennzahl zu klein — und damit genau
   * die Einordnung falsch, für die sie da ist: Ein Altbau, dem die Hälfte der
   * Bauteile fehlt, landet in der Klasse „Neubau nach heutigem Standard" und
   * bestätigt dem Leser, dass alles stimmt. Die Einordnung deshalb gar nicht
   * erst zu drucken wäre der falsche Weg — die Zahl steht ohnehin daneben —,
   * aber sie muss sagen, worauf sie beruht.
   */
  if (!vollstaendig) {
    return (
      `${specific} W/m² — ohne Einordnung: In mindestens einem Raum fehlt der U-Wert eines Bauteils, ` +
      'die Kennzahl ist deshalb zu klein. Erst nachtragen, dann einordnen.'
    );
  }
  if (specific < 25) return `${specific} W/m² — Passivhausniveau. Ungewöhnlich niedrig; U-Werte prüfen.`;
  if (specific < 45) return `${specific} W/m² — Neubau nach heutigem Standard.`;
  if (specific < 70) return `${specific} W/m² — saniert oder Baujahr ab etwa 1995.`;
  if (specific < 100) return `${specific} W/m² — teilsaniert, Baujahr etwa 1978–1995.`;
  if (specific < 150) return `${specific} W/m² — unsaniert. Für eine Wärmepumpe ist die Vorlauftemperatur zu prüfen.`;
  return `${specific} W/m² — auffällig hoch. Das ist eher ein Eingabefehler als ein Gebäude.`;
}

/**
 * Ist eine übernommene Last für den heutigen Modellstand gerechnet worden?
 *
 * Naheliegend wäre `modelState === meta.modifiedAt`. Das wäre falsch, und zwar
 * sofort: der Schreibvorgang, der die Last bringt, datiert das Dokument selbst
 * um — die Zahl wäre in der Sekunde ihrer Ankunft „veraltet". Ein Hinweis, der
 * immer leuchtet, wird nach dem dritten Mal nicht mehr gelesen.
 *
 * Ein Schreibvorgang der Gegenstelle ändert aber keine Geometrie; das
 * verhindert `hostPatch`. Er setzt nur den Zeitstempel weiter. Jede übernommene
 * Last erzählt genau einen solchen Sprung: von ihrem `modelState` zu ihrem
 * `receivedAt`. Alle Lasten des Dokuments zusammen ergeben eine Kette bekannter
 * und harmloser Sprünge. Eine Last ist aktuell, wenn diese Kette von ihrem
 * `modelState` bis zum heutigen `modifiedAt` durchläuft. Fehlt ein Glied, hat
 * dazwischen jemand gezeichnet — und nur dann steht der Hinweis da.
 */
function patchHops(doc: BimDocument): Map<string, string> {
  const hops = new Map<string, string>();
  for (const room of Object.values(doc.rooms)) {
    const load = room.normHeatLoad;
    if (!load?.modelState || load.modelState === load.receivedAt) continue;
    hops.set(load.modelState, load.receivedAt);
  }
  return hops;
}

function currentAgainst(modifiedAt: string, hops: Map<string, string>): (load: NormRoomHeatLoad) => boolean {
  return (load) => {
    // Ohne festgehaltenen Modellstand lässt sich nichts behaupten. Dann gilt
    // die Last als aktuell: ein Hinweis ohne Grundlage wäre eine Vermutung,
    // und Vermutungen gehören nicht ins Anlagenblatt.
    if (!load.modelState) return true;
    const gesehen = new Set<string>();
    let at: string | undefined = load.modelState;
    while (at !== undefined && !gesehen.has(at)) {
      if (at === modifiedAt) return true;
      gesehen.add(at);
      at = hops.get(at);
    }
    return false;
  };
}

/**
 * Wie viele beheizte Räume eine gerechnete Norm-Heizlast tragen.
 *
 * Rein aus dem Dokument, ohne den Überschlag zu rechnen: die Frage stellt sich
 * auch dort, wo nur die Herkunft der Zahlen angezeigt wird.
 */
export function normHeatLoadCoverage(doc: BimDocument): NormHeatLoadCoverage {
  const istAktuell = currentAgainst(doc.meta.modifiedAt, patchHops(doc));
  // Eine Fläche, die Mauerwerk ist, trägt keine Heizlast.
  const heated = Object.values(doc.rooms).filter((r) => r.isHeated && !isMassiveArea(r));
  const missing: string[] = [];
  const outdatedRooms: string[] = [];
  let watt = 0;
  let ohneLueftung = 0;
  const lueftung: { rolle: VentilationRole | undefined; watt: number }[] = [];
  let mitAnteil = true;
  let withNorm = 0;
  let source: string | undefined;
  let receivedAt: string | undefined;

  for (const room of heated) {
    const load = room.normHeatLoad;
    if (!load) {
      missing.push(room.name);
      continue;
    }
    withNorm += 1;
    watt += load.total;
    if (typeof load.ventilation === 'number' && Number.isFinite(load.ventilation)) {
      ohneLueftung += load.total - load.ventilation;
      lueftung.push({ rolle: room.ventilationRole, watt: load.ventilation });
    } else mitAnteil = false;
    if (!istAktuell(load)) outdatedRooms.push(room.name);
    // Jüngste Übernahme gewinnt: sie ist die, nach der der Anwender sucht,
    // wenn er wissen will, wie alt der Stand ist.
    if (receivedAt === undefined || load.receivedAt > receivedAt) {
      receivedAt = load.receivedAt;
      source = load.source;
    }
  }

  return {
    heatedRooms: heated.length,
    withNorm,
    outdated: outdatedRooms.length,
    totalKw: Math.round((watt / 1000) * 100) / 100,
    gebaeudeKw: Math.round(((mitAnteil && withNorm > 0 ? ohneLueftung + gebaeudeLueftung(lueftung) : watt) / 1000) * 100) / 100,
    lueftungGebaeude: mitAnteil && withNorm > 0,
    complete: heated.length > 0 && withNorm === heated.length,
    missing,
    outdatedRooms,
    source,
    receivedAt,
  };
}


/**
 * Lüftungswärmeverlust des Gebäudes aus den Raumwerten [W].
 *
 * **Befund B8.** Bis 1.72.0 war die Gebäudeheizlast die Summe der Raumlasten,
 * die Lüftung also Σ n_min · V aller Räume. Ein Abluftraum (Bad, WC, Küche)
 * bezieht seine Luft aber über den Überströmweg aus den Zulufträumen; die
 * Außenluft dafür ist dort schon gezählt. Für den Raum gehört sie in die
 * Heizlast — die Heizfläche im Bad muss sie erwärmen können —, für das
 * Gebäude nicht ein zweites Mal (DIN EN 12831-1, 6.3.3: Lüftung auf
 * Gebäudeebene aus der Luftbilanz).
 *
 * Außenluft des Gebäudes = max(Zuluftseite, Abluftseite) + Räume ohne Rolle.
 * Überströmräume zählen zur Zuluftseite (die vorsichtige Richtung). Ohne
 * Lüftungsrollen — kein Raum Zu- oder Abluftraum — bleibt es die Summe.
 */
export function gebaeudeLueftung(eintraege: { rolle: VentilationRole | undefined; watt: number }[]): number {
  let zu = 0;
  let ab = 0;
  let sonst = 0;
  for (const e of eintraege) {
    if (e.rolle === 'supply' || e.rolle === 'transfer') zu += e.watt;
    else if (e.rolle === 'exhaust') ab += e.watt;
    else sonst += e.watt;
  }
  return Math.max(zu, ab) + sonst;
}

/** Überschlägige Heizlast des ganzen Gebäudes. */
export function estimateHeatLoad(doc: BimDocument): HeatLoadEstimate {
  const istAktuell = currentAgainst(doc.meta.modifiedAt, patchHops(doc));
  const beheizt = Object.values(doc.rooms).filter((r) => !isMassiveArea(r) && r.isHeated);
  const flaechen = raumFlaechen(doc, beheizt);
  const rooms = beheizt
    .map((r) => roomLoad(doc, r, istAktuell, flaechen.get(r.id) ?? []))
    .sort((a, b) => b.total - a.total);

  const transmission = rooms.reduce((s, r) => s + r.transmission + r.openings, 0);
  // Befund B8: auf Gebäudeebene nicht die Summe der Raumwerte, siehe
  // `gebaeudeLueftung`.
  const ventilationRooms = rooms.reduce((s, r) => s + r.ventilation, 0);
  const ventilation = gebaeudeLueftung(
    rooms.map((r) => ({ rolle: doc.rooms[r.roomId]?.ventilationRole, watt: r.ventilation })),
  );
  const heatedArea = rooms.reduce((s, r) => s + r.area, 0);
  const totalW = transmission + ventilation;
  const specific = heatedArea > 0 ? Math.round(totalW / heatedArea) : 0;
  // Die Namen und nicht die Anzahl: Wer den Vorbehalt liest, will wissen, wo
  // er nachtragen muss. „3 Räume unvollständig" schickt ihn suchen.
  const unvollstaendigeRaeume = rooms.filter((r) => r.unvollstaendig.length > 0).map((r) => r.name);

  return {
    istUeberschlag: true,
    rooms,
    totalKw: Math.round((totalW / 1000) * 100) / 100,
    transmission: Math.round(transmission),
    ventilation: Math.round(ventilation),
    ventilationRooms: Math.round(ventilationRooms),
    heatedArea: Math.round(heatedArea * 100) / 100,
    specific,
    designOutdoor: doc.meta.designOutdoorTemperature,
    klassifizierung: classify(specific, unvollstaendigeRaeume.length === 0),
    unvollstaendigeRaeume,
    vollstaendig: unvollstaendigeRaeume.length === 0,
  };
}

/**
 * Zuschlag für die Trinkwassererwärmung [kW].
 *
 * Für Ein- und Zweifamilienhäuser ist 0,2 kW je Person der Richtwert, mit
 * dem in der Praxis gerechnet wird; er stammt aus dem Tagesbedarf und einer
 * Aufheizzeit über den ganzen Tag, nicht aus einer Norm. Bei Anlagen mit
 * kurzer Aufheizzeit oder hohem Komfortanspruch ist er zu klein — dann
 * bestimmt nicht dieser Zuschlag die Gerätegröße, sondern die Speicherladung,
 * und die rechnet `domesticWater.ts`.
 */
export function domesticHotWaterSurcharge(occupants: number, comfort: 'sparsam' | 'normal' | 'komfort' = 'normal'): number {
  const perPerson = comfort === 'sparsam' ? 0.15 : comfort === 'komfort' ? 0.3 : 0.2;
  return Math.round(Math.max(0, occupants) * perPerson * 100) / 100;
}
