/**
 * Wärmebrücken — längenbezogen statt pauschal.
 * ---------------------------------------------------------------------------
 * Bisher trug jedes Bauteil einen pauschalen Zuschlag ΔU_WB auf seinen U-Wert.
 * Das ist zulässig und bequem, aber grob: 0,10 W/(m²·K) ohne Nachweis liegen
 * bei einem kompakten Neubau weit auf der sicheren Seite, bei einem zerklüfteten
 * Altbau mit vielen Fenstern können sie zu niedrig sein. Der Zuschlag hängt
 * eben nicht an der Fläche, sondern an *Kanten*: Gebäudeecken, Fensterlaibungen,
 * Deckenauflagern, Sockeln, Traufen.
 *
 * Diese Kanten stehen bereits im Modell — sie müssen nur gezählt werden. Genau
 * das tut dieses Modul: es leitet je Raum die Längen der Anschlüsse aus der
 * Geometrie ab und multipliziert sie mit einem ψ-Wert je Anschlussart. Ergebnis
 * ist der Wärmebrücken-Leitwert H_WB = Σ ψ·l in W/K — dieselbe Einheit, in der
 * auch die Transmission über die Flächen ankommt, und damit direkt vergleichbar.
 *
 * **Gerechnet wird hier nichts weiter.** Die Heizlast entsteht in RaVia; dieses
 * Werkzeug liefert Längen, ψ-Werte und ihre Herkunft. Der Vergleich „pauschal
 * gegen detailliert" ist trotzdem eingebaut, weil er die einzige Möglichkeit
 * ist, die eigene Annahme zu prüfen, bevor sie in die Rechnung geht.
 *
 * Die Vorgabewerte stammen der Größenordnung nach aus den Planungsbeispielen
 * zu DIN 4108 Beiblatt 2 und liegen bewusst auf der sicheren Seite; ein realer
 * Nachweis nimmt die Werte aus dem Wärmebrückenkatalog des Herstellers oder
 * aus einer eigenen Berechnung. Deshalb trägt jeder Wert seine Herkunft mit
 * (`source`) — ein geerbter Vorgabewert darf nicht wie ein gerechneter
 * aussehen.
 */

import { distance, normalize, sub } from './geometry';
import { getWallGeometry, indexOpeningsByWall, openingsOf, openingSpan } from './wallGeometry';
import type {
  BimDocument,
  Opening,
  Room,
  ThermalBridgeCatalogue,
  ThermalBridgeKind,
  RoomThermalBridge,
} from '../types/bim';

/** Pauschale Zuschläge nach DIN 4108 Beiblatt 2 [W/(m²·K)]. */
export const FLAT_SUPPLEMENT = {
  none: 0.1, // ohne Nachweis
  A: 0.05, // Planungsbeispiele Kategorie A
  B: 0.03, // Planungsbeispiele Kategorie B
} as const;

export interface BridgeTypeInfo {
  kind: ThermalBridgeKind;
  label: string;
  /** Vorgabewert ψ [W/(m·K)]. */
  psi: number;
  /** Woraus die Länge entsteht — im Panel als Erklärung sichtbar. */
  derivedFrom: string;
}

/**
 * Vorgabekatalog. Negative Werte sind kein Vorzeichenfehler: an einer
 * Außenwandecke ist die wärmeabgebende Außenfläche größer als die
 * Innenfläche, über die gerechnet wird — der Anschluss korrigiert eine
 * Übertreibung der Flächenrechnung nach unten.
 */
export const BRIDGE_TYPES: BridgeTypeInfo[] = [
  { kind: 'building-corner', label: 'Gebäudekante (Außenwandecke)', psi: -0.05, derivedFrom: 'Ecke zweier Außenwände × Raumhöhe' },
  { kind: 'interior-wall', label: 'Innenwand-Einbindung', psi: 0.05, derivedFrom: 'Innenwand trifft Außenwand × Raumhöhe' },
  { kind: 'window-reveal', label: 'Fenster-/Türlaibung', psi: 0.1, derivedFrom: '2 × Höhe je Öffnung in der Außenwand' },
  { kind: 'window-lintel', label: 'Sturz', psi: 0.18, derivedFrom: 'Breite je Öffnung in der Außenwand' },
  { kind: 'window-sill', label: 'Brüstung', psi: 0.1, derivedFrom: 'Breite je Fenster in der Außenwand' },
  { kind: 'base', label: 'Sockel / Bodenplatte', psi: 0.22, derivedFrom: 'Umfang mit Erdkontakt' },
  { kind: 'floor-slab', label: 'Geschossdecke an Außenwand', psi: 0.08, derivedFrom: 'Außenwandlänge, wenn ein Geschoss darüber liegt' },
  { kind: 'eaves', label: 'Traufe', psi: -0.02, derivedFrom: 'Außenwandlänge unter der Dachschräge' },
  { kind: 'verge', label: 'Ortgang', psi: 0.06, derivedFrom: 'Giebellänge ÷ cos(Neigung)' },
];

export const DEFAULT_BRIDGE_CATALOGUE: ThermalBridgeCatalogue = Object.fromEntries(
  BRIDGE_TYPES.map((t) => [t.kind, t.psi]),
) as ThermalBridgeCatalogue;

const LABEL = new Map(BRIDGE_TYPES.map((t) => [t.kind, t.label]));
export const bridgeLabel = (kind: ThermalBridgeKind): string => LABEL.get(kind) ?? kind;

const round = (v: number, d = 3): number => {
  const f = 10 ** d;
  return Math.round(v * f) / f;
};

/** Richtungswinkel einer Polygonkante [rad]. */
function edgeAngle(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.atan2(b.y - a.y, b.x - a.x);
}

/**
 * Längen je Anschlussart für einen Raum. Reine Geometrie — der ψ-Wert kommt
 * erst im nächsten Schritt dazu, damit ein geänderter Katalog nicht die
 * Längenermittlung anfasst.
 */
export function bridgeLengths(
  doc: BimDocument,
  room: Room,
  /** Vorbereiteter Öffnungsindex; ohne ihn wird er hier gebaut. */
  index: Map<string, Opening[]> = indexOpeningsByWall(Object.values(doc.openings)),
): Map<ThermalBridgeKind, number> {
  const out = new Map<ThermalBridgeKind, number>();
  const add = (kind: ThermalBridgeKind, length: number) => {
    if (length <= 1e-6) return;
    out.set(kind, (out.get(kind) ?? 0) + length);
  };

  const level = doc.levels[room.levelId];
  const roof = level?.roof && level.roof.kind !== 'flat' ? level.roof : undefined;
  const height = room.height;

  // Gibt es ein Geschoss darüber? Dann durchdringt dessen Deckenplatte die
  // Außenwand — auch wenn der Raum darüber beheizt ist und die Decke
  // deswegen adiabat gerechnet wird. Die Wärmebrücke bleibt.
  const hasLevelAbove =
    level !== undefined &&
    Object.values(doc.levels).some((l) => l.order === level.order + 1);

  const n = room.boundaries.length;
  for (let i = 0; i < n; i++) {
    const b = room.boundaries[i];
    if (!b) continue;
    const isExterior = b.boundary === 'exterior';

    if (isExterior) {
      // --- Anschlüsse entlang der Wand ------------------------------------
      if (hasLevelAbove) add('floor-slab', b.length);

      if (roof) {
        const gable = b.gableArea ?? 0;
        if (gable > 0.05) {
          // Giebelwand: der Ortgang läuft schräg über ihr, die waagerechte
          // Projektion ist die Wandlänge.
          const cos = Math.cos((roof.pitch * Math.PI) / 180);
          add('verge', cos > 0.05 ? b.length / cos : b.length);
        } else {
          add('eaves', b.length);
        }
      }
    }

    // --- Ecken ------------------------------------------------------------
    // Betrachtet wird der Knoten zwischen Abschnitt i und i+1.
    const next = room.boundaries[(i + 1) % n];
    const p0 = room.polygon[i];
    const p1 = room.polygon[(i + 1) % n];
    const p2 = room.polygon[(i + 2) % n];
    if (next && p0 && p1 && p2) {
      let turn = edgeAngle(p1, p2) - edgeAngle(p0, p1);
      while (turn > Math.PI) turn -= 2 * Math.PI;
      while (turn < -Math.PI) turn += 2 * Math.PI;
      const bends = Math.abs(turn) > (5 * Math.PI) / 180;
      const nextExterior = next.boundary === 'exterior';
      if (isExterior && nextExterior && bends) {
        add('building-corner', height);
      } else if (isExterior !== nextExterior) {
        // Eine Innenwand stößt an die Außenwand — in Altbauten der häufigste
        // Schimmelpunkt.
        //
        // Diesen Knoten sehen *beide* angrenzenden Räume, jeder von seiner
        // Seite. Ungeteilt gezählt stünde die Wärmebrücke zweimal in der
        // Bilanz. Trennt die Innenwand zwei erkannte Räume, bekommt daher
        // jeder die Hälfte; hängt sie frei oder liegt dahinter kein Raum,
        // bleibt sie ganz beim einzigen Anlieger.
        const inner = isExterior ? next : b;
        add('interior-wall', inner.neighbourRoomId ? height / 2 : height);
      }
    }
  }

  // --- Öffnungen ----------------------------------------------------------
  // Nur Öffnungen in Außenwänden, und nur die, die auch wirklich in *diesem*
  // Wandabschnitt liegen: eine lange Außenwand kann an zwei Räumen entlang
  // laufen, und dann gehört jedes Fenster genau einem davon. Dieselbe
  // Projektion wie im Export, damit beide Seiten dieselben Öffnungen sehen.
  const claimed = new Set<string>();
  for (let i = 0; i < n; i++) {
    const b = room.boundaries[i];
    if (!b || b.boundary !== 'exterior') continue;
    const wall = doc.walls[b.wallId];
    if (!wall) continue;
    const g = getWallGeometry(wall, doc.nodes);
    if (!g) continue;
    const p0 = room.polygon[i];
    const p1 = room.polygon[(i + 1) % n];
    if (!p0 || !p1) continue;
    const dir = normalize(sub(p1, p0));
    const segLength = distance(p0, p1);

    for (const op of openingsOf(index, wall.id)) {
      if (claimed.has(op.id)) continue;
      const span = openingSpan(g, op);
      const u = (span.from + span.to) / 2;
      const centre = { x: g.a.x + g.dir.x * u, y: g.a.y + g.dir.y * u };
      const along = (centre.x - p0.x) * dir.x + (centre.y - p0.y) * dir.y;
      if (along < -0.05 || along > segLength + 0.05) continue;
      claimed.add(op.id);

      add('window-reveal', 2 * op.height);
      add('window-lintel', op.width);
      // Eine Tür hat keine Brüstung — sie geht bis zum Boden.
      if (op.kind === 'window') add('window-sill', op.width);
    }
  }

  // --- Sockel -------------------------------------------------------------
  const floorBoundary = room.floorBoundary ?? level?.floorBoundary;
  if (floorBoundary === 'ground' && room.groundContactPerimeter > 0) {
    add('base', room.groundContactPerimeter);
  }

  return out;
}

/**
 * Wärmebrücken eines Raums mit ψ-Wert und Leitwert. Reihenfolge wie im
 * Katalog, damit zwei Räume vergleichbar untereinander stehen.
 */
export function roomThermalBridges(
  doc: BimDocument,
  room: Room,
  index?: Map<string, Opening[]>,
): RoomThermalBridge[] {
  const lengths = bridgeLengths(doc, room, index);
  const catalogue = doc.meta.thermalBridgeCatalogue ?? DEFAULT_BRIDGE_CATALOGUE;
  const custom = doc.meta.thermalBridgeCatalogue;

  const out: RoomThermalBridge[] = [];
  for (const type of BRIDGE_TYPES) {
    const length = lengths.get(type.kind);
    if (!length) continue;
    const psi = catalogue[type.kind] ?? type.psi;
    out.push({
      kind: type.kind,
      label: type.label,
      psi: round(psi, 3),
      length: round(length, 2),
      heatLossCoefficient: round(psi * length, 3),
      source: custom && custom[type.kind] !== undefined && custom[type.kind] !== type.psi ? 'user' : 'default',
    });
  }
  return out;
}

/** Σ ψ·l eines Raums [W/K]. */
export function roomBridgeHeatLoss(bridges: RoomThermalBridge[]): number {
  return round(bridges.reduce((sum, b) => sum + b.heatLossCoefficient, 0), 3);
}

/**
 * Wärmeübertragende Hüllfläche eines einzelnen Raums [m²] — seine
 * Außenwände (netto, samt Giebel und Fenstern) plus Boden und Decke.
 *
 * Ungerundet, weil das Ergebnis sowohl einzeln ausgewiesen als auch
 * aufsummiert wird; gerundet wird erst dort, wo die Zahl das Modul verlässt.
 * Boden und Decke zählen auch bei einem innenliegenden Raum mit, weil die
 * Gebäudebilanz sie ebenfalls zählt — beide Ebenen müssen dieselbe
 * Bezugsfläche benutzen, sonst passt die Aufteilung nicht mehr zur Summe.
 */
export function roomEnvelopeArea(room: Room): number {
  let area = 0;
  for (const b of room.boundaries) {
    if (b.boundary === 'exterior') area += b.grossArea;
  }
  return area + 2 * room.area;
}

/**
 * Wärmeübertragende Hüllfläche [m²] — Außenwände (netto, samt Giebel und
 * Fenstern) plus Boden und Decke. Bezugsfläche des pauschalen Zuschlags.
 *
 * Bewusst hier und nicht im Export: Panel und Export müssen dieselbe Zahl
 * benutzen, sonst widerspricht der Vergleich auf dem Bildschirm dem, was in
 * der Datei steht. Die Summe läuft über `roomEnvelopeArea`, damit die
 * Gebäudefläche per Konstruktion die Summe der Raumflächen ist.
 */
export function envelopeArea(doc: BimDocument): number {
  let area = 0;
  for (const room of Object.values(doc.rooms)) area += roomEnvelopeArea(room);
  return round(area, 2);
}

/**
 * Gleichwertiger pauschaler Zuschlag ΔU_WB,äq = Σψ·l ÷ A_Hülle [W/(m²·K)].
 *
 * Dieselbe Definition wie auf Gebäudeebene (`BridgeComparison`), nur mit den
 * Größen eines einzelnen Raums. Der Wert ist die Brücke zu einer Gegenstelle,
 * die keine freien ψ-Werte annehmen kann: sie multipliziert ihn wieder mit
 * der Hüllfläche und bekommt denselben Leitwert zurück.
 *
 * Ohne Hüllfläche steht 0. Das ist keine Aussage über die Wärmebrücken des
 * Raums, sondern die Feststellung, dass es keine Bezugsfläche gibt: ein
 * Zuschlag je m² ist dort nicht darstellbar, und ein Quotient durch null wäre
 * `Infinity` — eine Zahl, die durch jede Weiterverarbeitung durchschlägt.
 * Ein Raum ohne Außenbauteil trägt ohnehin keine längenbezogene Wärmebrücke:
 * jede Anschlussart in `bridgeLengths` setzt einen Außenwandabschnitt voraus,
 * und ohne Außenwandabschnitt bleibt auch der Umfang mit Erdkontakt 0.
 */
export function roomEquivalentSupplement(heatLoss: number, envelope: number): number {
  return envelope > 0.01 ? round(heatLoss / envelope, 4) : 0;
}

/** Σ ψ·l über alle Räume [W/K]. */
export function documentBridgeHeatLoss(doc: BimDocument): number {
  const index = indexOpeningsByWall(Object.values(doc.openings));
  let sum = 0;
  for (const room of Object.values(doc.rooms)) {
    sum += roomBridgeHeatLoss(roomThermalBridges(doc, room, index));
  }
  return round(sum, 2);
}

/** Anschlusslängen je Art über alle Räume [m]. */
export function documentBridgeLengths(doc: BimDocument): Map<ThermalBridgeKind, number> {
  const index = indexOpeningsByWall(Object.values(doc.openings));
  const out = new Map<ThermalBridgeKind, number>();
  for (const room of Object.values(doc.rooms)) {
    for (const b of roomThermalBridges(doc, room, index)) {
      out.set(b.kind, round((out.get(b.kind) ?? 0) + b.length, 2));
    }
  }
  return out;
}

export interface BridgeComparison {
  /** Σ ψ·l über alle Räume [W/K]. */
  detailed: number;
  /** ΔU_WB × Σ Hüllfläche [W/K]. */
  flat: number;
  /** Wärmeübertragende Hüllfläche, auf die der pauschale Zuschlag wirkt [m²]. */
  envelopeArea: number;
  /** Gleichwertiger Zuschlag: Σ ψ·l ÷ Hüllfläche [W/(m²·K)]. */
  equivalentSupplement: number;
}

/**
 * Der eigentliche Nutzen der Rechnerei: sieht der pauschale Zuschlag für
 * *dieses* Gebäude zu groß oder zu klein aus? Ohne diesen Vergleich bliebe
 * die Wahl zwischen 0,10 und 0,05 ein Bauchgefühl.
 */
export function compareBridgeMethods(
  doc: BimDocument,
  envelopeArea: number,
  detailed: number,
): BridgeComparison {
  const flatPsi = doc.meta.thermalBridgeSupplement;
  return {
    detailed: round(detailed, 2),
    flat: round(flatPsi * envelopeArea, 2),
    envelopeArea: round(envelopeArea, 2),
    equivalentSupplement: envelopeArea > 0.01 ? round(detailed / envelopeArea, 4) : 0,
  };
}
