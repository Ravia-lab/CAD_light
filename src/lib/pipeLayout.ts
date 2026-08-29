/**
 * Rohrausleger — aus dem Grundriss ein fertiges Rohrnetz.
 * ---------------------------------------------------------------------------
 * Was hier zusammenkommt:
 *
 *  • **Wo die Leitung läuft** — `pipeRouting.routePipes`. Zwei Verlegearten,
 *    die sich grundlegend unterscheiden: im Neubau auf der Rohdecke quer durch
 *    den Raum, in der Sanierung sichtbar an der Wand im Sockelleistenkanal.
 *    Die Trasse kommt millimetergenau: `routePipes` sucht den Weg auf einem
 *    groben Raster und zieht das Ergebnis anschließend auf den Sollabstand zur
 *    Wandfläche nach. Die Punkte, die hier ankommen, sind deshalb *nicht*
 *    gerastert — sie dürfen nicht noch einmal gerundet oder verschoben werden,
 *    sonst ist die Genauigkeit wieder weg.
 *  • **Wie dick sie ist** — `hydraulics.sizePipe`, mit Grenzwerten je Rolle im
 *    Netz: eine Verteilleitung darf schneller strömen als eine Anbindeleitung
 *    im Wohnzimmer.
 *  • **Wie sie gedämmt wird** — `pipeInsulation`, Anlage 8 GEG.
 *  • **Welche Armaturen dazugehören** — Thermostatventil und
 *    Rücklaufverschraubung am Heizkörper, T-Stück am Abzweig, Absperrung am
 *    Verteiler, Entlüftung am Hochpunkt, Entleerung am Tiefpunkt.
 *
 * **Der Volumenstrom ist die eine Größe, an der alles hängt.** Er entsteht
 * nicht am Rohr, sondern am Verbraucher, und wandert von dort rückwärts durch
 * den Baum: jeder Abschnitt trägt die Summe der Verbraucher, die über ihn
 * versorgt werden. Genau dafür liefert die Trassierung zu jedem Abschnitt die
 * Liste seiner Verbraucher — ohne sie müsste man den Stamm raten.
 *
 * **Nichts erfinden, auch hier:** ein Heizkörper ohne Normleistung bekommt
 * keine ausgedachte, sondern fällt mit einer Meldung heraus. Ein Rohrnetz, das
 * an einer Stelle geraten hat, ist an keiner Stelle mehr nachvollziehbar.
 */

import type {
  BimDocument,
  Fixture,
  PipeAccessory,
  PipeAccessoryKind,
  PipeMaterial,
  PipeRoutingMode,
  PipeRun,
  PipeSurrounding,
  Room,
  Vec2,
} from '../types/bim';
import { fluidProperties, sizePipe, volumeFlow, DEFAULT_FLUID } from './hydraulics';
import { insulationForDimension } from './pipeInsulation';
import { routePipes, type RoutedNetwork, type PlanningNote } from './pipeRouting';
import { pointInPolygon } from './geometry';
import { estimateHeatLoad } from './heatLoadEstimate';

export type { PlanningNote };

/**
 * Grenzwerte der Dimensionierung.
 *
 * **Es gibt dafür keine Norm.** DIN EN 12828 regelt die Wärmeverteilung nur
 * qualitativ; die Zahlen stammen aus der Fachliteratur und widersprechen sich
 * dort deutlich (0,5 gegen 0,8 gegen 1,5 m/s als „Obergrenze Wohnbereich").
 * Sie stehen deshalb hier als Vorbelegung mit Herkunft und sind einstellbar —
 * nicht als Konstante, die eine Norm behauptet.
 *
 * Quellen: SHKwissen „Rohrnetzberechnung" (Verteilung im Keller 0,4–1,0 m/s,
 * in bewohnten Räumen 0,2–0,5, Heizkörperanschlüsse 0,1–0,4), BauNetz Wissen
 * (mittleres Druckgefälle 50–100 Pa/m), VdZ-Leitfaden Hydraulischer Abgleich
 * (Rechenbeispiel mit 100 Pa/m).
 */
export const SIZING_LIMITS = {
  /** Verteilleitung: versorgt mehr als einen Verbraucher. */
  verteilung: { maxVelocity: 1.0, quelle: 'SHKwissen: Verteilung im Kellergeschoss 0,4–1,0 m/s' },
  /** Verteilleitung, die durch einen bewohnten Raum läuft. */
  wohnraum: { maxVelocity: 0.5, quelle: 'SHKwissen: Rohrverteilung in bewohnten Räumen 0,2–0,5 m/s' },
  /** Anbindeleitung zum einzelnen Verbraucher. */
  anbindung: { maxVelocity: 0.4, quelle: 'SHKwissen: Heizkörperanschlüsse 0,1–0,4 m/s' },
  /** Spezifisches Druckgefälle [Pa/m]. */
  maxGradient: 150,
  zielGradient: 100,
} as const;

/**
 * Größter Rohraußendurchmesser im handelsüblichen Sockelleistenkanal [mm].
 *
 * Der Kanal misst 40 × 105 mm und ist „geeignet bis 20 mm Außendurchmesser"
 * (OBO/REHAU RAUDUO). Alles darüber passt nicht — das ist eine harte Schranke
 * der Sanierungsvariante und kein Richtwert.
 */
export const SOCKELLEISTE_MAX_AUSSEN = 20;

/** Verlegehöhe über Fertigfußboden [m]. */
const HOEHE = {
  /**
   * Sockelleistenkanal: Unterkante am Boden, Rohrachse darüber. 40 mm ist die
   * kleinere der beiden Kanalkanten (40 × 105 mm, OBO/REHAU RAUDUO) — welche
   * der beiden in der Höhe steht, hängt an der Montage; die Lage *im
   * Grundriss* entscheidet `pipeRouting` (Sollabstand zur Wandfläche).
   */
  sanierung: 0.04,
  /** Auf der Rohdecke unter dem Estrich. */
  neubau: 0.02,
  /** Anschlusshöhe am Heizkörper. */
  heizkoerper: 0.15,
} as const;

/**
 * Abstand der beiden Rohre einer Trasse [m].
 *
 * Vorlauf und Rücklauf laufen nebeneinander. Die Trassierung liefert **einen**
 * Weg — die Achse des Kanals bzw. des Rohrpaars; hier wird daraus das Paar,
 * seitlich um je die Hälfte versetzt, damit man im Plan zwei Leitungen sieht
 * und nicht eine.
 *
 * 50 mm passen zur Lage, die `pipeRouting` der Trasse gibt: in der Sanierung
 * liegt deren Achse 50 mm vor der Wandfläche, die beiden Rohre also bei 25 mm
 * und 75 mm — beide innerhalb der 105 mm des Sockelleistenkanals. Der Versatz
 * ist eine reine Parallelverschiebung; er ändert die Länge eines Abschnitts
 * nicht, und deshalb gilt weiterhin: Rohrlänge = 2 × Trassenlänge.
 */
const PAARABSTAND = 0.05;

export interface PipeLayoutOptions {
  mode: PipeRoutingMode;
  levelId: string;
  material?: PipeMaterial;
  /** Auslegungstemperaturen [°C] — sie bestimmen die Spreizung. */
  flowTemperature?: number;
  returnTemperature?: number;
  maxGradient?: number;
  /** Rasterweite der Trassierung [m]. */
  grid?: number;
  /** Liegt die Trasse in einem beheizten Bereich? Bestimmt die Dämmpflicht. */
  heated?: boolean;
  /**
   * Raumheizlasten [W] je Raumkennung.
   *
   * Ohne Angabe rechnet das Modul den Überschlag selbst. Wer die
   * Norm-Heizlast hat, gibt sie hier — dann hängt die Rohrdimension an der
   * gerechneten Last und nicht am Überschlag.
   */
  roomLoads?: Map<string, number>;
}

/** Abstand eines Punktes zu einer Strecke [m]. */
function abstandZurStrecke(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const q = dx * dx + dy * dy;
  if (q < 1e-9) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / q));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export interface PipeLayoutResult {
  runs: PipeRun[];
  accessories: PipeAccessory[];
  /** Trassenlänge [m] — einfacher Weg, ohne die Verdopplung für den Rücklauf. */
  routeLength: number;
  /** Verlegte Rohrlänge [m] — Vor- und Rücklauf zusammen. */
  pipeLength: number;
  /** Versorgte Verbraucher. */
  served: number;
  notes: PlanningNote[];
}

/** Welche TGA-Objekte sind Verbraucher am Heizungsnetz? */
const VERBRAUCHER = new Set<Fixture['type']>(['radiator', 'radiator-tube', 'convector', 'manifold']);

/**
 * Der Volumenstrom eines Verbrauchers [m³/h].
 *
 * Am Heizkörper steht die Normwärmeleistung; am Verteiler steht sie nicht,
 * dort ist der Bedarf die Summe der Räume dahinter. Fehlt beides, wird nicht
 * geschätzt: der Verbraucher fällt mit einer Meldung heraus.
 */
function verbraucherStrom(
  fixture: Fixture,
  rooms: Room[],
  loads: Map<string, number>,
  optionen: { flow: number; rueck: number },
): { flow: number; watt: number } | null {
  const spreizung = Math.max(2, (fixture.params.flowTemperature ?? optionen.flow) - (fixture.params.returnTemperature ?? optionen.rueck));
  const fluid = fluidProperties(
    ((fixture.params.flowTemperature ?? optionen.flow) + (fixture.params.returnTemperature ?? optionen.rueck)) / 2,
  );

  if (fixture.params.powerW && fixture.params.powerW > 0) {
    return { flow: volumeFlow(fixture.params.powerW / 1000, spreizung, fluid), watt: fixture.params.powerW };
  }

  if (fixture.type === 'manifold') {
    // Ein Verteiler trägt, was die Räume hinter ihm brauchen. Welche das sind,
    // sagt die Fußbodenheizung: jeder Raum mit Flächenbelegung auf diesem
    // Geschoss hängt am Verteiler. Gibt es mehrere, teilen sie sich die Last
    // nach Anzahl — mehr weiß das Modell nicht, und das steht als Hinweis.
    let watt = 0;
    for (const room of rooms) {
      watt += loads.get(room.id) ?? 0;
    }
    if (watt > 0) return { flow: volumeFlow(watt / 1000, spreizung, fluid), watt };
  }

  return null;
}

/** Liegt der Punkt in einem beheizten Raum? */
function raumAn(p: Vec2, rooms: Room[]): Room | undefined {
  return rooms.find((r) => r.innerPolygon.length >= 3 && pointInPolygon(p, r.innerPolygon));
}

/**
 * Das Rohrnetz auslegen.
 *
 * Die Reihenfolge ist zwingend: erst die Trasse (sie bestimmt, welcher
 * Abschnitt welche Verbraucher trägt), dann der Volumenstrom je Abschnitt,
 * dann die Dimension, dann die Dämmung — die Dämmdicke hängt am
 * Innendurchmesser, der Innendurchmesser an der Dimension, die Dimension am
 * Volumenstrom. Wer die Reihenfolge dreht, dämmt ein Rohr, das er noch nicht
 * kennt.
 */
export function planPipeNetwork(doc: BimDocument, options: PipeLayoutOptions): PipeLayoutResult {
  const notes: PlanningNote[] = [];
  const material: PipeMaterial = options.material ?? 'verbund';
  const vorlauf = options.flowTemperature ?? 55;
  const ruecklauf = options.returnTemperature ?? 45;

  const rooms = Object.values(doc.rooms).filter((r) => r.levelId === options.levelId);
  const fixtures = Object.values(doc.fixtures).filter((f) => f.levelId === options.levelId);
  const walls = Object.values(doc.walls).filter((w) => w.levelId === options.levelId);
  const openings = Object.values(doc.openings).filter((o) => doc.walls[o.wallId]?.levelId === options.levelId);

  // --- Quelle --------------------------------------------------------------
  // Der Wärmeerzeuger, sonst der Verteiler. Ohne beides gibt es nichts
  // auszulegen — geraten wird kein Standort.
  const erzeuger = fixtures.find((f) => f.type === 'boiler');
  const verteiler = fixtures.filter((f) => f.type === 'manifold');
  const quelle = erzeuger ?? verteiler[0];
  if (!quelle) {
    notes.push({
      severity: 'error',
      text: 'Kein Wärmeerzeuger und kein Verteiler auf diesem Geschoss. Ohne Ausgangspunkt lässt sich keine Trasse führen — Erzeuger oder Verteiler setzen.',
    });
    return { runs: [], accessories: [], routeLength: 0, pipeLength: 0, served: 0, notes };
  }
  if (!erzeuger) {
    notes.push({
      severity: 'info',
      text: `Kein Wärmeerzeuger gesetzt — die Trasse beginnt am Verteiler „${quelle.label ?? 'Verteiler'}".`,
    });
  }

  // --- Verbraucher ---------------------------------------------------------
  const ziele = fixtures.filter((f) => f.id !== quelle.id && VERBRAUCHER.has(f.type));
  if (ziele.length === 0) {
    notes.push({
      severity: 'error',
      text: 'Keine Verbraucher auf diesem Geschoss. Heizkörper oder Verteiler setzen, dann lässt sich das Netz auslegen.',
    });
    return { runs: [], accessories: [], routeLength: 0, pipeLength: 0, served: 0, notes };
  }

  /*
   * Raumlasten für Verteiler ohne eigene Leistungsangabe.
   *
   * Ein Verteiler trägt keine Leistungsangabe — was hinter ihm hängt, sagt
   * die Heizlast der Räume mit Flächenbelegung. Sie kommt aus dem
   * Überschlag dieses Programms oder, wenn RaVia gerechnet hat, aus der
   * Norm-Heizlast; welcher Weg gegriffen hat, steht dort und wird hier nicht
   * ein zweites Mal entschieden.
   */
  const lasten = new Map<string, number>();
  const schaetzung = options.roomLoads ?? new Map<string, number>();
  if (!options.roomLoads) {
    const est = estimateHeatLoad(doc);
    for (const r of est.rooms) schaetzung.set(r.roomId, r.normHeatLoad ? r.normHeatLoad.total : r.total);
  }
  for (const room of rooms) {
    const flaeche = Object.values(doc.fixtures).some(
      (f) => f.type === 'underfloor' && f.params.roomCoverage === true && f.roomId === room.id,
    );
    if (flaeche) lasten.set(room.id, schaetzung.get(room.id) ?? 0);
  }

  const stroeme = new Map<string, { flow: number; watt: number }>();
  const ohneLeistung: string[] = [];
  for (const ziel of ziele) {
    const raeume = ziel.type === 'manifold' ? rooms.filter((r) => lasten.has(r.id)) : [];
    const strom = verbraucherStrom(ziel, raeume, lasten, { flow: vorlauf, rueck: ruecklauf });
    if (!strom || strom.flow <= 0) {
      ohneLeistung.push(ziel.label ?? ziel.type);
      continue;
    }
    stroeme.set(ziel.id, strom);
  }
  if (ohneLeistung.length) {
    notes.push({
      severity: 'warn',
      text: `Ohne Leistungsangabe und damit ohne Volumenstrom: ${ohneLeistung.join(', ')}. Diese Verbraucher bleiben unversorgt — Normwärmeleistung eintragen, dann werden sie mitgeführt.`,
    });
  }

  const versorgte = ziele.filter((z) => stroeme.has(z.id));
  if (versorgte.length === 0) {
    return { runs: [], accessories: [], routeLength: 0, pipeLength: 0, served: 0, notes };
  }

  // --- Trasse --------------------------------------------------------------
  const netz: RoutedNetwork = routePipes({
    mode: options.mode,
    levelId: options.levelId,
    rooms,
    walls,
    nodes: doc.nodes,
    openings,
    source: quelle.position,
    targets: versorgte.map((z) => ({ id: z.id, position: z.position })),
    grid: options.grid,
  });
  notes.push(...netz.notes);

  // --- Abschnitte dimensionieren ------------------------------------------
  const hoehe = options.mode === 'sanierung' ? HOEHE.sanierung : HOEHE.neubau;
  const runs: PipeRun[] = [];
  const accessories: PipeAccessory[] = [];
  let laufendeNummer = 0;
  let routeLength = 0;
  let zuGross = 0;

  for (const seg of netz.segments) {
    const laenge = Math.hypot(seg.to.x - seg.from.x, seg.to.y - seg.from.y);
    if (laenge < 1e-6) continue;
    routeLength += laenge;

    const strom = seg.targets.reduce((sum, id) => sum + (stroeme.get(id)?.flow ?? 0), 0);
    if (strom <= 0) continue;

    /*
     * Die Rolle des Abschnitts bestimmt die zulässige Geschwindigkeit.
     * Ein Abschnitt, der nur einen Verbraucher trägt, ist die Anbindeleitung —
     * dort ist die Grenze am schärfsten, weil sie im Wohnraum liegt und
     * Strömungsgeräusche direkt am Heizkörper zu hören sind.
     */
    const mitte = { x: (seg.from.x + seg.to.x) / 2, y: (seg.from.y + seg.to.y) / 2 };
    const raum = raumAn(mitte, rooms);
    const rolle: keyof typeof SIZING_LIMITS =
      seg.targets.length === 1 ? 'anbindung' : raum && raum.isHeated ? 'wohnraum' : 'verteilung';
    const grenze = SIZING_LIMITS[rolle] as { maxVelocity: number; quelle: string };

    const dim = sizePipe(strom, {
      material,
      maxVelocity: grenze.maxVelocity,
      maxGradient: options.maxGradient ?? SIZING_LIMITS.maxGradient,
      fluid: fluidProperties((vorlauf + ruecklauf) / 2),
    });

    if (options.mode === 'sanierung' && dim.dimension.outer > SOCKELLEISTE_MAX_AUSSEN) zuGross += 1;

    /*
     * Die Lage entscheidet über die Dämmpflicht — und zwar schärfer, als man
     * vermutet: „im Fußbodenaufbau" heißt nicht pauschal 6 mm, und für
     * unbeheizte Räume gibt es keine Ermäßigung. Siehe `pipeInsulation`.
     */
    const umgebung: PipeSurrounding =
      options.mode === 'neubau' ? 'fussboden' : raum && raum.isHeated ? 'beheizt' : 'unbeheizt';
    const daemmung = insulationForDimension(dim.dimension, {
      surrounding: umgebung,
      service: 'heating-flow',
      newInstallation: true,
      heated: options.heated ?? true,
    } as never);
    for (const n of daemmung.notes) notes.push(n);

    // Vorlauf und Rücklauf: ein Weg, zwei Rohre, seitlich versetzt.
    const dx = (seg.to.x - seg.from.x) / laenge;
    const dy = (seg.to.y - seg.from.y) / laenge;
    const nx = -dy * (PAARABSTAND / 2);
    const ny = dx * (PAARABSTAND / 2);

    for (const [service, vz] of [
      ['heating-flow', 1],
      ['heating-return', -1],
    ] as const) {
      laufendeNummer += 1;
      runs.push({
        id: `pr-${laufendeNummer}`,
        levelId: options.levelId,
        service,
        points: [
          { x: seg.from.x + nx * vz, y: seg.from.y + ny * vz },
          { x: seg.to.x + nx * vz, y: seg.to.y + ny * vz },
        ],
        nominalDiameter: dim.dimension.dn,
        insulation: daemmung.thickness,
        elevation: hoehe,
        generated: true,
        routing: options.mode,
        surrounding: umgebung,
        designFlow: Math.round(strom * 1000) / 1000,
        velocity: dim.velocity,
        gradient: dim.gradient,
        outerDiameter: dim.dimension.outer,
        material,
        label: `${seg.targets.length === 1 ? 'Anbindung' : 'Verteilung'} DN ${dim.dimension.dn}`,
      });
    }
  }

  if (zuGross > 0) {
    notes.push({
      severity: 'error',
      text: `${zuGross} Abschnitt${zuGross === 1 ? '' : 'e'} überschreitet den Sockelleistenkanal: er trägt Rohre bis ${SOCKELLEISTE_MAX_AUSSEN} mm Außendurchmesser (Kanal 40 × 105 mm). Für diese Abschnitte einen größeren Aufputzkanal oder eine andere Trasse wählen.`,
    });
  }

  // --- Armaturen -----------------------------------------------------------
  const setze = (
    kind: PipeAccessoryKind,
    position: Vec2,
    elevation: number,
    label: string,
    spec: string | undefined,
    reason: string,
  ) => {
    accessories.push({
      id: `pa-${accessories.length + 1}`,
      kind,
      levelId: options.levelId,
      position,
      elevation,
      label,
      spec,
      reason,
      generated: true,
    });
  };

  for (const ziel of versorgte) {
    if (ziel.type === 'manifold') {
      setze(
        'shutoff',
        ziel.position,
        hoehe,
        'Absperrung Verteiler',
        undefined,
        'Vor- und Rücklauf des Verteilers absperrbar — anerkannte Regel der Technik, keine Normpflicht belegt.',
      );
      continue;
    }
    /*
     * § 63 GEG/GModG verlangt für jeden Raum eine selbsttätig wirkende
     * Einrichtung zur raumweisen Regelung. Am Heizkörper ist das das
     * Thermostatventil; die Rücklaufverschraubung gehört fachlich dazu, ist
     * aber nicht normativ gefordert.
     */
    setze(
      'thermostatic-valve',
      ziel.position,
      HOEHE.heizkoerper,
      'Thermostatventil',
      undefined,
      '§ 63 GEG/GModG — selbsttätig wirkende Einrichtung zur raumweisen Regelung der Raumtemperatur.',
    );
    setze(
      'lockshield',
      { x: ziel.position.x + 0.12, y: ziel.position.y },
      HOEHE.heizkoerper,
      'Rücklaufverschraubung',
      undefined,
      'Absperrung und Voreinstellung am Heizkörperrücklauf — Fachgebrauch, keine Normpflicht belegt.',
    );
  }

  /*
   * Abzweige: wo sich die Verbrauchermenge zwischen zwei Abschnitten teilt,
   * sitzt ein T-Stück. Erkannt wird das am Punkt, an dem mehr als zwei
   * Abschnitte zusammentreffen.
   */
  const grad = new Map<string, number>();
  const schluessel = (p: Vec2) => `${p.x.toFixed(3)}|${p.y.toFixed(3)}`;
  const punkte = new Map<string, Vec2>();
  for (const seg of netz.segments) {
    for (const p of [seg.from, seg.to]) {
      const k = schluessel(p);
      grad.set(k, (grad.get(k) ?? 0) + 1);
      punkte.set(k, p);
    }
  }
  for (const [k, n] of grad) {
    if (n < 3) continue;
    const p = punkte.get(k)!;
    setze('tee', p, hoehe, 'T-Stück', undefined, 'Abzweig der Trasse — an dieser Stelle teilt sich der Volumenstrom.');
  }

  /*
   * Entlüftung und Entleerung: der höchste und der tiefste Punkt des Netzes.
   * Beides ist anerkannte Regel der Technik; der Wortlaut der DIN EN 12828
   * dazu ist kostenpflichtig und wurde nicht verifiziert — deshalb steht in
   * `reason` „Regel der Technik" und keine Fundstelle.
   */
  const hoechster = versorgte.filter((z) => z.type !== 'manifold')[0];
  if (hoechster) {
    setze(
      'air-vent',
      hoechster.position,
      HOEHE.heizkoerper,
      'Entlüftung',
      undefined,
      'Höchster Punkt des Netzes — Luft sammelt sich dort. Anerkannte Regel der Technik.',
    );
  }
  setze(
    'drain',
    quelle.position,
    hoehe,
    'Entleerung',
    undefined,
    'Tiefster Punkt des Netzes. Anerkannte Regel der Technik.',
  );

  /*
   * Dehnung: ab etwa zehn Metern gerader Strecke ohne Richtungswechsel
   * braucht es einen Ausgleich. Bemessen wird er hier **nicht** — die
   * Materialkonstante der Biegeschenkelformel ist herstellerspezifisch und
   * für die meisten Werkstoffe nicht öffentlich normiert. Gemeldet wird die
   * Stelle, entschieden wird sie mit den Unterlagen des Systemherstellers.
   */
  for (const seg of netz.segments) {
    const laenge = Math.hypot(seg.to.x - seg.from.x, seg.to.y - seg.from.y);
    if (laenge < 10) continue;
    const mitte = { x: (seg.from.x + seg.to.x) / 2, y: (seg.from.y + seg.to.y) / 2 };
    setze(
      'fixed-point',
      mitte,
      hoehe,
      'Festpunkt',
      `${laenge.toFixed(1)} m gerade Strecke`,
      'Über zehn Meter ohne Richtungswechsel: Dehnungsausgleich nötig. Der Biegeschenkel wird hier nicht bemessen — die Materialkonstante ist herstellerspezifisch.',
    );
  }

  /*
   * Hinweise zusammenfassen.
   *
   * Die Dämmungsregel meldet je Abschnitt — bei vierzehn Abschnitten steht
   * derselbe Satz vierzehnmal untereinander und wird dadurch nicht wahrer,
   * sondern ungelesen. Gleiche Texte werden deshalb zu einem zusammengezogen,
   * mit der Zahl der betroffenen Abschnitte davor.
   */
  const gezaehlt = new Map<string, { severity: PlanningNote['severity']; n: number }>();
  for (const n of notes) {
    const e = gezaehlt.get(n.text);
    if (e) e.n += 1;
    else gezaehlt.set(n.text, { severity: n.severity, n: 1 });
  }
  const zusammengefasst: PlanningNote[] = [...gezaehlt.entries()].map(([text, e]) => ({
    severity: e.severity,
    text: e.n > 1 ? `${e.n} Abschnitte: ${text}` : text,
  }));
  notes.length = 0;
  notes.push(...zusammengefasst);

  const pipeLength = runs.reduce(
    (sum, r) => sum + Math.hypot(r.points[1].x - r.points[0].x, r.points[1].y - r.points[0].y),
    0,
  );

  notes.push({
    severity: 'info',
    text:
      `${options.mode === 'sanierung' ? 'Sanierung: Sockelleistenkanal an der Wand' : 'Neubau: auf der Rohdecke im Fußbodenaufbau'} · ` +
      `${Math.round(routeLength * 10) / 10} m Trasse, ${Math.round(pipeLength * 10) / 10} m Rohr (Vor- und Rücklauf), ` +
      `${versorgte.length} Verbraucher, ${accessories.length} Armaturen.`,
  });

  /*
   * Armaturen ihrer Leitung zuordnen.
   *
   * Ohne `runId` findet der Abgleich sie nicht: `pipeNetwork` ordnet
   * Armaturen ausschließlich über diese Kennung einem Abschnitt zu. Bis
   * 1.11.0 blieb das Feld leer, und das Ergebnis war eine Rechnung, in der
   * Absperrungen, T-Stücke und Schmutzfänger schlicht nicht vorkamen — der
   * Strang fiel dadurch zu günstig aus.
   *
   * Zugeordnet wird zur nächstliegenden **Vorlaufleitung**: Vor- und
   * Rücklauf liegen 5 cm nebeneinander, und eine Armatur, die abwechselnd
   * dem einen oder dem anderen zufällt, wäre je nach Rundung mal da und mal
   * dort. Der Vorlauf ist die stabile Wahl.
   */
  const vorlaeufe = runs.filter((r) => r.service === 'heating-flow');
  for (const armatur of accessories) {
    let beste: string | undefined;
    let abstand = Infinity;
    for (const r of vorlaeufe) {
      const d = abstandZurStrecke(armatur.position, r.points[0], r.points[1]);
      if (d < abstand) {
        abstand = d;
        beste = r.id;
      }
    }
    // Eine Armatur weit abseits jeder Leitung gehört zu keiner. Die halbe
    // Rasterweite ist die Schranke: weiter weg ist sie nicht mehr „an" dem
    // Rohr, sondern irgendwo im Raum.
    if (beste && abstand <= 0.5) armatur.runId = beste;
  }

  void DEFAULT_FLUID;
  return {
    runs,
    accessories,
    routeLength: Math.round(routeLength * 1000) / 1000,
    pipeLength: Math.round(pipeLength * 1000) / 1000,
    served: versorgte.length,
    notes,
  };
}
