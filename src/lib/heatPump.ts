/**
 * Wärmepumpe und Außenanlage — die Aufstellung prüfbar machen.
 * ---------------------------------------------------------------------------
 * Wo eine Luft-Wärmepumpe stehen darf, entscheiden drei Dinge, die nichts
 * miteinander zu tun haben und trotzdem gleichzeitig erfüllt sein müssen:
 *
 *  1. **Schall.** Am maßgeblichen Immissionsort darf der Beurteilungspegel
 *     nachts den Immissionsrichtwert der TA Lärm nicht überschreiten. Das ist
 *     in aller Regel die härteste der drei Bedingungen — und die einzige, die
 *     man dem Gerät nicht ansieht.
 *  2. **Sicherheitsabstand.** Bei brennbaren Kältemitteln (R290) darf im
 *     Schutzbereich um das Gerät keine Öffnung liegen, durch die Gas ins
 *     Gebäude oder in einen Schacht sinken kann — und er darf nicht auf das
 *     Nachbargrundstück reichen.
 *  3. **Bauordnung.** Abstandsflächen sind Ländersache. Die meisten Länder
 *     haben Wärmepumpen inzwischen privilegiert, an Bedingungen geknüpft.
 *
 * Dieses Modul rechnet den ersten Punkt und prüft die anderen beiden
 * geometrisch. **Es ersetzt kein Schallgutachten:** das überschlägige
 * Verfahren der TA Lärm hat eine Genauigkeit von etwa ±3 dB, und in
 * Grenzfällen ist die ausführliche Prognose nach DIN ISO 9613-2 zu rechnen.
 * Was es leistet, ist die Frage zu beantworten, die auf der Baustelle zählt:
 * reicht der Platz an dieser Stelle, ja oder nein.
 *
 * Grundlagen und Herkunft der Zahlen:
 *  • TA Lärm Nr. 6.1 (Immissionsrichtwerte), Nr. 6.4 (Nachtzeit),
 *    Nr. 3.2.1 Abs. 2 (Irrelevanz 6 dB), Anhang A.1.3 (Immissionsort),
 *    Anhang A.2.4.3 Gleichung (G4) (Ausbreitungsrechnung)
 *  • VDI 2714 Abschnitt 5.2 (Raumwinkelmaß K0)
 *  • LAI-Leitfaden „Lärm bei stationären Geräten" (Modellannahmen)
 *  • VDI 4640 Blatt 2 (spezifische Entzugsleistung)
 *
 * Alle Zahlen sind im Programm überschreibbar. Verbindlich ist immer der
 * Bescheid der zuständigen Behörde, nicht diese Tabelle.
 */

import type {
  AreaCategory,
  BimDocument,
  HeatPump,
  MountingSituation,
  SiteElement,
  SoilKind,
  Vec2,
} from '../types/bim';

// ---------------------------------------------------------------------------
// Schall
// ---------------------------------------------------------------------------

/** Immissionsrichtwerte nach TA Lärm Nr. 6.1 [dB(A)]: [tags, nachts]. */
export const IMMISSION_LIMITS: Record<AreaCategory, [number, number]> = {
  GI: [70, 70], // Industriegebiet — ohne Nachtabsenkung
  GE: [65, 50],
  MU: [63, 45], // urbanes Gebiet, 2017 eingefügt — nicht 60
  MK: [60, 45],
  MD: [60, 45],
  MI: [60, 45],
  WA: [55, 40],
  WS: [55, 40],
  WR: [50, 35],
  KUR: [45, 35],
};

/**
 * Raumwinkelmaß K0 [dB] nach VDI 2714 Abschnitt 5.2.
 *
 * Der Boden zählt als eine der reflektierenden Flächen: ein Gerät, das frei
 * im Garten auf dem Boden steht, strahlt in den Halbraum und bekommt deshalb
 * bereits +3 dB, nicht 0.
 */
export const ROOM_ANGLE: Record<MountingSituation, number> = {
  free: 3, // Halbraum — Boden
  wall: 6, // Viertelraum — Boden und eine Wand
  corner: 9, // Achtelraum — Boden und zwei Wände
  niche: 9, // überdachte Nische; in der Praxis wie Achtelraum
};

/** Abschlag der TA Lärm für Irrelevanz (Nr. 3.2.1 Abs. 2) [dB]. */
export const IRRELEVANCE_MARGIN = 6;

/**
 * Kleinster Abstand, für den die Rechnung noch etwas taugt [m].
 * Der LAI-Leitfaden sagt dazu klar: „Abstandsberechnungen im Nahbereich sind
 * nicht belastbar."
 */
export const MIN_DISTANCE = 1;

/**
 * Schalldruckpegel in der Entfernung r — TA Lärm Anhang A.2.4.3 (G4):
 *
 *   L = L_WA + K_T + K0 − Abschirmung − 20·lg(r) − 11 dB
 *
 * Die 11 dB sind 10·lg(4π), also die Kugelabstrahlung; K0 holt davon
 * zurück, was der Boden und die Wände wieder zum Empfänger schicken.
 */
export function soundPressureAt(
  soundPower: number,
  roomAngle: number,
  distance: number,
  toneSurcharge = 0,
  shielding = 0,
): number {
  const r = Math.max(distance, MIN_DISTANCE);
  return soundPower + toneSurcharge + roomAngle - shielding - 20 * Math.log10(r) - 11;
}

/** Nach (G4) aufgelöst: welcher Abstand hält den Zielpegel gerade ein? */
export function requiredDistance(
  soundPower: number,
  roomAngle: number,
  target: number,
  toneSurcharge = 0,
  shielding = 0,
): number {
  const exponent = (soundPower + toneSurcharge + roomAngle - shielding - 11 - target) / 20;
  return Math.max(MIN_DISTANCE, 10 ** exponent);
}

/** Der Schallleistungspegel, mit dem gerechnet werden darf. */
export function ratedSoundPower(pump: HeatPump): number {
  // Ein abgesenkter Nachtbetrieb zählt nur, wenn er auch wirklich läuft.
  // Sonst gilt der lauteste Betriebszustand — so steht es in den
  // Landesmerkblättern, und so ist es auch vernünftig.
  if (pump.nightModeGuaranteed && typeof pump.soundPowerNight === 'number') {
    return pump.soundPowerNight;
  }
  return pump.soundPower;
}

export interface AcousticCheck {
  /** Woher der Immissionsort kommt. */
  origin: 'element' | 'boundary' | 'own-window';
  label: string;
  position: Vec2;
  distance: number;
  /** Beurteilungspegel nachts [dB(A)]. */
  level: number;
  /** Immissionsrichtwert nachts [dB(A)]. */
  limit: number;
  /** Bewertung: grün = auch die Irrelevanzschwelle gehalten. */
  verdict: 'ok' | 'tight' | 'exceeded';
  /** Abstand, der für die Irrelevanzschwelle nötig wäre [m]. */
  requiredForIrrelevance: number;
}

export interface AcousticReport {
  soundPower: number;
  roomAngle: number;
  limitNight: number;
  /** Zielwert der Planung: Richtwert minus Irrelevanzabschlag. */
  target: number;
  /** Abstand, ab dem der Zielwert eingehalten ist [m]. */
  safeDistance: number;
  /** Abstand, ab dem wenigstens der Richtwert eingehalten ist [m]. */
  limitDistance: number;
  points: AcousticCheck[];
  worst?: AcousticCheck;
}

const distanceOf = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Kürzester Abstand von einem Punkt zu einem Streckenzug. */
export function distanceToPolyline(point: Vec2, points: Vec2[], closed: boolean): number {
  if (points.length === 0) return Infinity;
  if (points.length === 1) return distanceOf(point, points[0]);
  let best = Infinity;
  const last = closed ? points.length : points.length - 1;
  for (let i = 0; i < last; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared > 0 ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared)) : 0;
    best = Math.min(best, distanceOf(point, { x: a.x + dx * t, y: a.y + dy * t }));
  }
  return best;
}

/** Nächster Punkt auf einem Streckenzug — für die Marke im Plan. */
export function closestPointOn(point: Vec2, points: Vec2[], closed: boolean): Vec2 | undefined {
  if (!points.length) return undefined;
  let best: Vec2 | undefined;
  let bestDistance = Infinity;
  const last = closed ? points.length : points.length - 1;
  for (let i = 0; i < last; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared > 0 ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared)) : 0;
    const candidate = { x: a.x + dx * t, y: a.y + dy * t };
    const d = distanceOf(point, candidate);
    if (d < bestDistance) {
      bestDistance = d;
      best = candidate;
    }
  }
  return best;
}

/**
 * Schallnachweis für eine Wärmepumpe.
 *
 * Immissionsorte kommen aus drei Quellen, und die Reihenfolge ist Absicht:
 *
 *  1. **Gesetzte Immissionsorte** — wenn der Planer weiß, wo das Schlafzimmer
 *     des Nachbarn liegt, ist das die richtige Stelle (0,5 m vor dem
 *     geöffneten Fenster, TA Lärm A.1.3 a).
 *  2. **Die Grundstücksgrenze**, wenn keine gesetzt sind. Auf einem
 *     unbebauten Nachbargrundstück gilt der Rand der überbaubaren Fläche
 *     (A.1.3 b) — die Grenze ist dafür die sichere Näherung, und sie ist
 *     immer bekannt.
 *  3. **Eigene Fenster** — nur als Hinweis. Die TA Lärm schützt das eigene
 *     Haus nicht; wer nachts unter dem eigenen Gerät schläft, merkt es
 *     trotzdem.
 */
export function acousticReport(doc: BimDocument, pump: HeatPump): AcousticReport {
  const site = doc.site;
  const soundPower = ratedSoundPower(pump);
  const roomAngle = ROOM_ANGLE[pump.mounting];
  const limitNight = IMMISSION_LIMITS[site.areaCategory][1];
  const target = limitNight - IRRELEVANCE_MARGIN;

  const evaluate = (
    origin: AcousticCheck['origin'],
    label: string,
    position: Vec2,
    distance: number,
    limit: number,
  ): AcousticCheck => {
    const level = soundPressureAt(soundPower, roomAngle, distance, pump.toneSurcharge);
    return {
      origin,
      label,
      position,
      distance: round2(distance),
      level: round1(level),
      limit,
      verdict: level > limit + 0.05 ? 'exceeded' : level > limit - IRRELEVANCE_MARGIN + 0.05 ? 'tight' : 'ok',
      requiredForIrrelevance: round2(
        requiredDistance(soundPower, roomAngle, limit - IRRELEVANCE_MARGIN, pump.toneSurcharge),
      ),
    };
  };

  const points: AcousticCheck[] = [];

  for (const element of Object.values(site.elements)) {
    if (element.kind !== 'immission-point' || !element.points[0]) continue;
    const limit = IMMISSION_LIMITS[element.areaCategory ?? site.areaCategory][1];
    points.push(
      evaluate(
        'element',
        element.label ?? 'Immissionsort',
        element.points[0],
        distanceOf(pump.position, element.points[0]),
        limit,
      ),
    );
  }

  if (!points.length) {
    const boundary = Object.values(site.elements).find((e) => e.kind === 'boundary');
    if (boundary && boundary.points.length >= 2) {
      const nearest = closestPointOn(pump.position, boundary.points, true);
      if (nearest) {
        points.push(
          evaluate(
            'boundary',
            'Grundstücksgrenze (Näherung)',
            nearest,
            distanceToPolyline(pump.position, boundary.points, true),
            limitNight,
          ),
        );
      }
    }
  }

  points.sort((a, b) => b.level - a.level);

  return {
    soundPower,
    roomAngle,
    limitNight,
    target,
    safeDistance: round2(requiredDistance(soundPower, roomAngle, target, pump.toneSurcharge)),
    limitDistance: round2(requiredDistance(soundPower, roomAngle, limitNight, pump.toneSurcharge)),
    points,
    worst: points[0],
  };
}

// ---------------------------------------------------------------------------
// Schutzbereich bei brennbarem Kältemittel
// ---------------------------------------------------------------------------

/** Kältemittel, die einen Schutzbereich brauchen (Sicherheitsgruppe A3/A2L). */
export const FLAMMABLE = new Set(['R290', 'R32']);

export interface ProtectionIssue {
  kind: 'opening' | 'boundary' | 'well';
  label: string;
  distance: number;
  required: number;
}

/**
 * Prüft den Schutzbereich: keine Öffnung, kein Schacht, kein Ablauf darin —
 * und er darf nicht über die Grundstücksgrenze reichen.
 *
 * Propan ist schwerer als Luft. Es sinkt und sammelt sich unten: im
 * Lichtschacht, im Kellerabgang, im Bodenablauf. Deshalb zählen gerade die
 * Öffnungen, die man beim Aufstellen am wenigsten im Blick hat.
 *
 * Der Radius ist kein Normwert. Es gibt keine Tabelle „Füllmenge → Radius";
 * jeder Hersteller weist ihn für sein Gerät aus. 1,00 m waagerecht ist der
 * in der Praxis verbreitete Wert — er ersetzt nicht das Datenblatt.
 */
export function protectionIssues(doc: BimDocument, pump: HeatPump): ProtectionIssue[] {
  if (!FLAMMABLE.has(pump.refrigerant) || pump.protectionRadius <= 0) return [];
  const issues: ProtectionIssue[] = [];
  const radius = pump.protectionRadius;

  for (const element of Object.values(doc.site.elements)) {
    if (element.kind === 'hazard-opening' && element.points[0]) {
      const distance = distanceOf(pump.position, element.points[0]) - (element.radius ?? 0);
      if (distance < radius) {
        issues.push({
          kind: 'opening',
          label: element.label ?? 'Öffnung / Schacht / Ablauf',
          distance: round2(Math.max(0, distance)),
          required: radius,
        });
      }
    }
    if (element.kind === 'boundary' && element.points.length >= 2) {
      const distance = distanceToPolyline(pump.position, element.points, true);
      if (distance < radius) {
        issues.push({
          kind: 'boundary',
          label: 'Grundstücksgrenze',
          distance: round2(distance),
          required: radius,
        });
      }
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Wärmequelle
// ---------------------------------------------------------------------------

/**
 * Spezifische Entzugsleistung nach VDI 4640 Blatt 2 (Ausgabe 2001):
 * Sonde in W je Meter, Kollektor in W je Quadratmeter, je nach
 * Jahresbetriebsstunden.
 *
 * Die Ausgabe 2019 hat diese Pauschaltabelle durch Kennfelder ersetzt und
 * die Tabellenauslegung auf 30 kW und fünf Sonden begrenzt. Für die
 * Vorbemessung eines Einfamilienhauses ist sie trotzdem das, womit in der
 * Praxis gerechnet wird — darüber hinaus muss simuliert werden, und genau
 * das sagt das Programm dann auch.
 */
export const EXTRACTION: Record<SoilKind, { borehole: [number, number]; collector: [number, number] }> = {
  //                                   1800 h  2400 h
  dry: { borehole: [25, 20], collector: [10, 8] },
  normal: { borehole: [60, 50], collector: [25, 20] },
  conductive: { borehole: [84, 70], collector: [30, 24] },
  saturated: { borehole: [80, 65], collector: [40, 32] },
};

/** Ab hier reicht die Tabellenauslegung nicht mehr (VDI 4640-2:2019). */
export const TABLE_LIMIT_KW = 30;
export const TABLE_LIMIT_BOREHOLES = 5;

export interface SourceDemand {
  /** Entzugsleistung Q̇_0 = Q̇_Heiz · (COP−1)/COP [kW]. */
  extraction: number;
  /** Spezifische Entzugsleistung [W/m] bzw. [W/m²]. */
  specific: number;
  /** Erforderliche Sondenmeter [m] — nur bei Sonde. */
  boreholeMetres?: number;
  /** Erforderliche Kollektorfläche [m²] — nur bei Kollektor. */
  collectorArea?: number;
  /** Erforderliche Fördermenge [m³/h] — nur bei Grundwasser. */
  flowRate?: number;
  /** Vorhanden laut Zeichnung. */
  plannedMetres?: number;
  plannedArea?: number;
  /** Reicht das Gezeichnete? */
  sufficient: boolean;
  /** Tabellenauslegung noch zulässig? */
  tableApplicable: boolean;
}

export function sourceDemand(doc: BimDocument, pump: HeatPump): SourceDemand | undefined {
  if (pump.source === 'air') return undefined;
  const site = doc.site;
  const hours = site.sourceRunHours === 2400 ? 1 : 0;
  const cop = Math.max(1.5, pump.cop);
  // Was die Quelle liefern muss, ist die Heizleistung ohne den Anteil, den
  // der Verdichter selbst als Strom einbringt.
  const extraction = pump.heatingCapacity * ((cop - 1) / cop);

  const elements = Object.values(site.elements);
  if (pump.source === 'groundwater') {
    // V̇ = Q̇_0 / (1,163 · ΔT), mit ΔT = 4 K der übliche Auslegungswert.
    const flowRate = extraction / (1.163 * 4);
    return {
      extraction: round2(extraction),
      specific: 0,
      flowRate: round2(flowRate),
      sufficient: elements.some((e) => e.kind === 'well-supply') && elements.some((e) => e.kind === 'well-injection'),
      tableApplicable: true,
    };
  }

  const isBorehole = pump.source === 'brine-borehole';
  const specific = EXTRACTION[site.soil][isBorehole ? 'borehole' : 'collector'][hours];

  if (isBorehole) {
    const metres = (extraction * 1000) / specific;
    const planned = elements
      .filter((e) => e.kind === 'borehole')
      .reduce((sum, e) => sum + (e.depth ?? 0), 0);
    const count = elements.filter((e) => e.kind === 'borehole').length;
    return {
      extraction: round2(extraction),
      specific,
      boreholeMetres: round2(metres),
      plannedMetres: round2(planned),
      sufficient: planned >= metres - 0.5,
      tableApplicable: pump.heatingCapacity <= TABLE_LIMIT_KW && count <= TABLE_LIMIT_BOREHOLES,
    };
  }

  const area = (extraction * 1000) / specific;
  const planned = elements
    .filter((e) => e.kind === 'collector')
    .reduce((sum, e) => sum + polygonArea(e.points), 0);
  return {
    extraction: round2(extraction),
    specific,
    collectorArea: round2(area),
    plannedArea: round2(planned),
    sufficient: planned >= area - 0.5,
    tableApplicable: pump.heatingCapacity <= TABLE_LIMIT_KW,
  };
}

/** Fläche eines Polygons [m²] — Betrag, Umlaufrichtung egal. */
export function polygonArea(points: Vec2[]): number {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

// ---------------------------------------------------------------------------
// Abstandsregeln der Wärmequelle
// ---------------------------------------------------------------------------

export interface DistanceRule {
  id: string;
  /** Was geprüft wird. */
  label: string;
  /** Mindestabstand [m]. */
  minimum: number;
  /** Woher der Wert kommt — für die Anzeige im Programm. */
  source: string;
  /** Wie verbindlich: Gesetz, Norm, Leitfaden, Faustwert. */
  binding: 'gesetz' | 'norm' | 'leitfaden' | 'faustwert';
}

/**
 * Abstandsregeln für erdgekoppelte Quellen.
 *
 * Wichtig und im Programm ausdrücklich vermerkt: **keine dieser Zahlen ist
 * ein Bundesgesetz.** Verbindlich ist der Bescheid der unteren Wasserbehörde;
 * die Länderleitfäden weichen voneinander ab (Grenzabstand einer Sonde: 3 m
 * nach VDI, 4 m in Hessen ab 8 kW, 5 m nach LAWA und in Hamburg). Deshalb
 * sind die Werte Vorgaben, keine Grenzen — und jede trägt ihre Herkunft mit.
 */
export const DISTANCE_RULES: DistanceRule[] = [
  { id: 'borehole-borehole', label: 'Sonde ↔ Sonde', minimum: 6, source: 'VDI 4640 Blatt 2', binding: 'norm' },
  { id: 'borehole-boundary', label: 'Sonde ↔ Grundstücksgrenze', minimum: 3, source: 'VDI 4640 (LAWA/Hamburg: 5 m)', binding: 'norm' },
  { id: 'borehole-building', label: 'Sonde ↔ Gebäude', minimum: 2, source: 'Länderleitfäden (Standsicherheit)', binding: 'leitfaden' },
  { id: 'borehole-utility', label: 'Sonde ↔ Leitung', minimum: 0.7, source: 'VDI 4640 Blatt 2', binding: 'norm' },
  { id: 'collector-boundary', label: 'Kollektor ↔ Grundstücksgrenze', minimum: 1, source: 'BWP-Infoblatt 43', binding: 'leitfaden' },
  { id: 'collector-building', label: 'Kollektor ↔ Gebäude', minimum: 1.2, source: 'Länderleitfäden (Frosthebung)', binding: 'leitfaden' },
  { id: 'collector-tree', label: 'Kollektor ↔ Baum', minimum: 2, source: 'Praxiswert (Wurzelschutz)', binding: 'faustwert' },
  { id: 'collector-water', label: 'Kollektor ↔ Wasserleitung', minimum: 1.5, source: 'Praxiswert (Frostschutz)', binding: 'faustwert' },
  { id: 'well-well', label: 'Förder- ↔ Schluckbrunnen', minimum: 15, source: 'Praxiswert, Fließrichtung beachten', binding: 'faustwert' },
];

export const ruleById = (id: string): DistanceRule | undefined => DISTANCE_RULES.find((r) => r.id === id);

const round1 = (v: number): number => Math.round(v * 10) / 10;
const round2 = (v: number): number => Math.round(v * 100) / 100;

/**
 * Wasserschutzgebiet: was dort mit einer erdgekoppelten Quelle geht.
 * Grundlage ist § 49 Abs. 2 AwSV zusammen mit den LAWA-Empfehlungen; die
 * verbindlichen Verbote stehen in der Schutzgebietsverordnung vor Ort.
 */
export function waterProtectionVerdict(
  zone: BimDocument['site']['waterProtection'],
  source: HeatPump['source'],
): { allowed: 'ja' | 'einzelfall' | 'nein'; note: string } | undefined {
  if (source === 'air' || zone === 'none') return undefined;
  switch (zone) {
    case 'I':
    case 'II':
      return {
        allowed: 'nein',
        note: 'In den Zonen I und II sind Erdwärmeanlagen nach § 49 Abs. 2 AwSV unzulässig.',
      };
    case 'III':
    case 'IIIA':
      return {
        allowed: 'nein',
        note: 'In Zone III bzw. III A ist die Errichtung nach § 49 Abs. 2 AwSV grundsätzlich unzulässig. Eine Ausnahme ist möglich, wenn die Anlage den geschützten Grundwasserleiter nicht berührt — das entscheidet die untere Wasserbehörde.',
      };
    case 'IIIB':
      return {
        allowed: 'einzelfall',
        note: 'In Zone III B ist eine Ausnahme möglich, wenn keine nachteilige Veränderung zu besorgen ist und als Wärmeträger ausschließlich Wasser ohne Zusätze verwendet wird.',
      };
    default:
      return undefined;
  }
}

/** Sperrzeitfaktor 24/(24−t) — der klassische Zuschlag für die Auslegung. */
export function blockingFactor(hours: number): number {
  const t = Math.min(8, Math.max(0, hours));
  return round2(24 / (24 - t));
}

/**
 * Erforderliche Wärmepumpen-Heizleistung, überschlägig:
 * (Gebäudeheizlast + Warmwasserzuschlag) × Sperrzeitfaktor.
 *
 * Bewusst der einfache Weg und nicht die 24-Stunden-Energiebilanz nach
 * VDI 4645 — die rechnet die Gegenstelle. Exportiert werden ohnehin die
 * Rohgrößen, damit dort *beide* Wege möglich bleiben.
 */
export function requiredCapacity(heatLoadKw: number, pump: HeatPump): number {
  const water = pump.domesticHotWater ? 0.2 * Math.max(0, pump.occupants) : 0;
  const factor = pump.gridRegime === 'evu-3x2h' ? blockingFactor(pump.blockedHours) : 1;
  return round2((heatLoadKw + water) * factor);
}

/** Abstand eines Objekts zu einem Punkt — Punkt, Zug oder Fläche. */
export function elementDistance(element: SiteElement, point: Vec2): number {
  if (!element.points.length) return Infinity;
  if (element.points.length === 1) return distanceOf(point, element.points[0]);
  const closed = element.kind === 'boundary' || element.kind === 'collector' || element.kind === 'neighbour-building' || element.kind === 'paved';
  return distanceToPolyline(point, element.points, closed);
}
