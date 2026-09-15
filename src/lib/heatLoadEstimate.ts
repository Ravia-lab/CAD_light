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

import type { BimDocument, Room, RoomBoundary, RoomHeatLoad as NormRoomHeatLoad } from '../types/bim';
import { gradeSplit, isMassiveArea } from './roomDetection';
import {
  BAUTEIL_BEZEICHNUNG,
  istErfasst,
  uWertBoden,
  uWertDecke,
  uWertWand,
  type UWertAuskunft,
} from './uwert';

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
  total: number;
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
  /** Gebäudeheizlast [kW]. */
  total: number;
  transmission: number;
  ventilation: number;
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
   * `false` heißt nicht „falsch", sondern „zu klein" — und das ist die
   * gefährlichere der beiden Aussagen, weil sie plausibel aussieht.
   */
  vollstaendig: boolean;
}

/**
 * Temperatur auf der anderen Seite eines Bauteils [°C].
 *
 * Dieselbe Zuordnung wie im Export, hier noch einmal ohne den Umweg über den
 * vollständigen Exportaufbau: der Überschlag soll auch dann funktionieren,
 * wenn das Dokument gerade bearbeitet wird.
 */
function neighbourTemperature(doc: BimDocument, boundary: RoomBoundary): number {
  switch (boundary.boundary) {
    case 'exterior':
      return doc.meta.designOutdoorTemperature;
    case 'ground':
      return doc.meta.groundTemperature;
    case 'unheated':
      return doc.meta.unheatedTemperature;
    case 'adjacent-room': {
      const other = boundary.neighbourRoomId ? doc.rooms[boundary.neighbourRoomId] : undefined;
      return other?.setpointTemperature ?? doc.meta.designIndoorTemperature;
    }
    default:
      return doc.meta.designOutdoorTemperature;
  }
}

/**
 * Fläche × U × Δθ eines Raums.
 *
 * Der Wärmebrückenzuschlag wird beim pauschalen Verfahren auf jeden U-Wert
 * aufgeschlagen; beim ausführlichen Verfahren steckt er in ψ·l und darf hier
 * nicht noch einmal auftauchen. Genau diese Fallunterscheidung ist der Grund,
 * warum der Zuschlag nicht einfach addiert wird.
 */
function roomLoad(
  doc: BimDocument,
  room: Room,
  istAktuell: (load: NormRoomHeatLoad) => boolean,
  heatedByLevel: Map<string, number>,
): RoomHeatLoad {
  const inside = room.setpointTemperature;
  const flat = doc.meta.thermalBridgeMethod === 'flat' ? doc.meta.thermalBridgeSupplement : 0;
  let transmission = 0;
  let openings = 0;

  /*
   * Die Lücken dieses Raums.
   *
   * Ein `Set`, weil hier Bauteil**arten** gesammelt werden: vierzehn
   * Außenwände ohne U-Wert sind eine Aussage, nicht vierzehn.
   */
  const luecken = new Set<string>();

  /**
   * Eine Lücke festhalten — aber nur, wenn sie die Zahl auch verfälscht.
   *
   * Die beiden Bedingungen sind kein Feinschliff. Ohne die Flächenprüfung
   * meldete jede Wandscheibe, die vollständig aus Fenster besteht, einen
   * fehlenden Wand-U-Wert; ohne die Temperaturprüfung meldete jede Innenwand
   * zwischen zwei gleich temperierten Räumen dasselbe. Beides ändert an der
   * Heizlast kein Watt — und ein Heft, in dem unter jedem Raum eine Handvoll
   * folgenloser Vorbehalte steht, wird nach der zweiten Seite überblättert.
   * Dann fällt auch der eine auf, der zählt, nicht mehr auf.
   */
  const meldeLuecke = (auskunft: UWertAuskunft, flaeche: number, bezeichnung: string): void => {
    if (auskunft.herkunft !== 'fehlt') return;
    if (flaeche <= 1e-6) return;
    luecken.add(bezeichnung);
  };

  // Höhenlage des Geschosses und Geländeoberkante entscheiden, welcher Teil
  // einer Außenwand gegen Erdreich statt gegen Außenluft grenzt. Das ist
  // kein Feinschliff: bei −12 °C außen, 10 °C im Erdreich und 20 °C innen
  // liegt der Temperaturfaktor der erdberührten Fläche bei 10/32 = 0,31
  // statt 1,0. Ohne diese Unterscheidung zeigt das Anlagenblatt bei einem
  // Keller das Dreifache.
  const levelElevation = doc.levels[room.levelId]?.elevation ?? 0;
  const groundTemperature = doc.meta.groundTemperature;

  for (const b of room.boundaries) {
    const outside = neighbourTemperature(doc, b);
    const dt = inside - outside;
    /*
     * Der U-Wert kommt aus `uwert.ts` und nicht mehr aus `b.uValue ?? 0`.
     *
     * Zwei Fehler stecken in dem alten Ausdruck. Der eine: Die Raumerkennung
     * reichte bis 1.23.0 nur `wall.uValue` durch — ein zugewiesener
     * Bauteilaufbau mit gerechnetem U-Wert wurde hier nie gesehen, obwohl die
     * Übergabe an RaVia ihn längst benutzte. Dieselbe Wand hatte damit im Heft
     * und in der Gegenstelle verschiedene U-Werte. Der andere: `?? 0` machte
     * aus einer fehlenden Angabe ein Bauteil ohne Verlust. Die Wand fiel aus
     * der Bilanz, statt eine Lücke zu melden.
     *
     * Gefragt wird deshalb die Wand selbst, nicht der mitgeführte Abschnitt:
     * sie kennt ihren Aufbau. Nur wenn es keine Wand mehr gibt — eine
     * Raumkante, deren Wand zwischenzeitlich gelöscht wurde —, bleibt der im
     * Abschnitt festgehaltene Wert die letzte Auskunft.
     */
    const wand = b.wallId ? doc.walls[b.wallId] : undefined;
    const auskunft: UWertAuskunft = wand
      ? uWertWand(wand, doc.constructions)
      : istErfasst(b.uValue)
        ? { wert: b.uValue, herkunft: 'bauteil' }
        : { herkunft: 'fehlt' };
    const bauteilName = wand ? BAUTEIL_BEZEICHNUNG[wand.type] : 'Raumkante ohne Wand';
    const u = (auskunft.wert ?? 0) + flat;
    // Öffnungen stecken in `openingArea`; ihr U-Wert liegt an der Öffnung
    // selbst. Ohne Zugriff darauf wird hier der Flächenanteil mit dem
    // Fenster-Regelwert gerechnet — deshalb ist das ein Überschlag.
    const uOpening = DEFAULT_WINDOW_U + flat;

    // Nur Außenwände können im Erdreich stecken; eine Innenwand hat kein
    // Gelände hinter sich. Die mittlere Höhe des Abschnitts folgt aus
    // Bruttofläche ÷ Länge — unter einer Dachschräge ist das die einzige
    // Höhe, die zur Fläche passt.
    const wallHeight = b.length > 1e-6 ? b.grossArea / b.length : 0;
    const split =
      b.boundary === 'exterior'
        ? gradeSplit(levelElevation, wallHeight, doc.meta.terrainElevation)
        : { buriedHeight: 0, exposedHeight: wallHeight, embedmentDepth: 0 };

    if (split.buriedHeight <= 1e-6) {
      if (dt <= 0) continue;
      meldeLuecke(auskunft, b.netArea, bauteilName);
      transmission += b.netArea * u * dt;
      openings += b.openingArea * uOpening * dt;
      continue;
    }

    // Aufteilung an der Geländeoberkante. Öffnungen bleiben oberhalb, solange
    // dort Platz für sie ist; erst was nicht mehr hineinpasst, liegt unter
    // Gelände. Der `RoomBoundary` führt nur die Summe der Öffnungsflächen,
    // keine Brüstungshöhen — die genaue Zuordnung leistet der Export. Beide
    // Wege ergeben dieselbe Gesamtfläche, und mehr braucht ein Überschlag
    // nicht.
    const buriedGross = Math.min(b.length * split.buriedHeight, b.grossArea);
    const aboveGross = Math.max(0, b.grossArea - buriedGross);
    const openingsBelow = Math.max(0, b.openingArea - aboveGross);
    const openingsAbove = b.openingArea - openingsBelow;
    const dtGround = inside - groundTemperature;

    if (dt > 0) {
      meldeLuecke(auskunft, Math.max(0, aboveGross - openingsAbove), bauteilName);
      transmission += Math.max(0, aboveGross - openingsAbove) * u * dt;
      openings += openingsAbove * uOpening * dt;
    }
    if (dtGround > 0) {
      meldeLuecke(auskunft, Math.max(0, buriedGross - openingsBelow), bauteilName);
      transmission += Math.max(0, buriedGross - openingsBelow) * u * dtGround;
      openings += openingsBelow * uOpening * dtGround;
    }
  }

  // Boden und Decke des Raums.
  const level = doc.levels[room.levelId];
  if (level) {
    // Auch hier über `uwert.ts`: Boden und Decke tragen am Geschoss einen
    // Bauteilaufbau (`floorConstructionId`, `ceilingConstructionId`), den
    // dieses Modul bis 1.23.0 nicht einmal angesehen hat. Und ein
    // `floorUValue: 0` — der Vorgabewert eines frisch angelegten Geschosses —
    // lief als gültige Zahl durch und machte die Bodenplatte verlustfrei.
    const bodenU = uWertBoden(room, level, doc.constructions);
    const deckeU = uWertDecke(room, level, doc.constructions);
    const floorU = bodenU.wert ?? 0;
    const floorBoundary = room.floorBoundary ?? level.floorBoundary;
    const ceilingU = deckeU.wert ?? 0;
    const ceilingBoundary = room.ceilingBoundary ?? level.ceilingBoundary;
    // Was hinter Boden und Decke liegt.
    //
    // „An Nachbarraum" galt hier bisher bedingungslos als gleich temperiert
    // und damit verlustfrei. Zwischen zwei *beheizten* Geschossen bleibt das
    // so — dieses Modul führt ausdrücklich keine Bilanz über Geschossgrenzen
    // hinweg (siehe Kopf), und ein halber Kelvin Unterschied zwischen zwei
    // Wohnebenen ist kein Wärmeverlust des Gebäudes.
    //
    // Falsch wird es erst, wenn im angrenzenden Geschoss gar nicht geheizt
    // wird: ein unbeheizter Keller unter beheiztem Erdgeschoss macht die
    // Kellerdecke zum am stärksten belasteten Bauteil dieses Geschosses, und
    // sie stünde mit 0 W in der Bilanz. Fehlen dort beheizte Räume — oder
    // fehlt das Geschoss ganz —, gilt deshalb θ_u. Dieselbe Entscheidung
    // trifft der Export in `slabBoundary`.
    const levelsSorted = Object.values(doc.levels).sort((a, b) => a.order - b.order);
    const levelIndex = levelsSorted.findIndex((l) => l.id === level.id);
    const temperatureOf = (kind: string, which: 'floor' | 'ceiling') => {
      if (kind === 'ground') return doc.meta.groundTemperature;
      if (kind === 'unheated') return doc.meta.unheatedTemperature;
      if (kind === 'exterior') return doc.meta.designOutdoorTemperature;
      if (kind === 'adjacent-room') {
        const neighbour = levelsSorted[which === 'floor' ? levelIndex - 1 : levelIndex + 1];
        const heated = neighbour ? heatedByLevel.get(neighbour.id) : undefined;
        return heated !== undefined ? inside : doc.meta.unheatedTemperature;
      }
      return inside;
    };
    const dtFloor = inside - temperatureOf(floorBoundary, 'floor');
    const dtCeiling = inside - temperatureOf(ceilingBoundary, 'ceiling');
    if (dtFloor > 0) {
      meldeLuecke(bodenU, room.area, 'Boden');
      transmission += room.area * (floorU + flat) * dtFloor;
    }
    if (dtCeiling > 0) {
      meldeLuecke(deckeU, room.area, 'Decke');
      transmission += room.area * (ceilingU + flat) * dtCeiling;
    }
  }

  const dtOutside = inside - doc.meta.designOutdoorTemperature;
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
 * U-Wert, mit dem Öffnungen im Überschlag gerechnet werden [W/(m²·K)].
 *
 * 1,3 ist der Wert eines Zweischeiben-Wärmeschutzfensters mittleren Alters —
 * bewusst nicht der Neubauwert 0,9, damit der Überschlag im Bestand nicht
 * systematisch zu niedrig liegt. Wer es genauer braucht, exportiert und lässt
 * RaVia rechnen: dort steht der U-Wert jeder einzelnen Öffnung.
 */
export const DEFAULT_WINDOW_U = 1.3;

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
    total: Math.round((watt / 1000) * 100) / 100,
    complete: heated.length > 0 && withNorm === heated.length,
    missing,
    outdatedRooms,
    source,
    receivedAt,
  };
}

/**
 * Mittlere Solltemperatur der beheizten Räume je Geschoss.
 *
 * Dieselbe Größe, die der Export für Boden- und Deckenanschlüsse bildet.
 * Einmal je Dokument statt je Raum: bei 700 Räumen liefe die Raumliste sonst
 * zweimal je Raum durch.
 */
function heatedTemperatureByLevel(doc: BimDocument): Map<string, number> {
  const sums = new Map<string, { sum: number; count: number }>();
  for (const room of Object.values(doc.rooms)) {
    if (!room.isHeated) continue;
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

/** Überschlägige Heizlast des ganzen Gebäudes. */
export function estimateHeatLoad(doc: BimDocument): HeatLoadEstimate {
  const istAktuell = currentAgainst(doc.meta.modifiedAt, patchHops(doc));
  const heatedByLevel = heatedTemperatureByLevel(doc);
  const rooms = Object.values(doc.rooms)
    .filter((r) => !isMassiveArea(r))
    .filter((r) => r.isHeated)
    .map((r) => roomLoad(doc, r, istAktuell, heatedByLevel))
    .sort((a, b) => b.total - a.total);

  const transmission = rooms.reduce((s, r) => s + r.transmission + r.openings, 0);
  const ventilation = rooms.reduce((s, r) => s + r.ventilation, 0);
  const heatedArea = rooms.reduce((s, r) => s + r.area, 0);
  const totalW = transmission + ventilation;
  const specific = heatedArea > 0 ? Math.round(totalW / heatedArea) : 0;
  // Die Namen und nicht die Anzahl: Wer den Vorbehalt liest, will wissen, wo
  // er nachtragen muss. „3 Räume unvollständig" schickt ihn suchen.
  const unvollstaendigeRaeume = rooms.filter((r) => r.unvollstaendig.length > 0).map((r) => r.name);

  return {
    istUeberschlag: true,
    rooms,
    total: Math.round((totalW / 1000) * 100) / 100,
    transmission: Math.round(transmission),
    ventilation: Math.round(ventilation),
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
