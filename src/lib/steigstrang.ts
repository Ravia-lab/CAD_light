/**
 * Steigleitung — die Verbindung zwischen den Geschossen.
 * ---------------------------------------------------------------------------
 * **Die Meldung dahinter:** „Wenn der Wärmeerzeuger unten ist und die Abnahme
 * oben, oder der Speicher im Keller steht, gibt es keine Strecke nach oben.
 * Einfamilienhaus: Wärmepumpe im Garten, Verrohrung geht in den Technikraum im
 * Keller, wo Speicher und Verteiler stehen, und **von dort nach oben**."
 *
 * Genau das fehlte: Die Rohrauslegung hat je Geschoss getrennt geplant. Stand
 * auf einem Geschoss kein Erzeuger und kein Speicher, meldete sie „die
 * Zuleitung kommt von außerhalb dieses Geschosses" — und ließ sie weg. Für ein
 * zweigeschossiges Haus fehlte damit das wichtigste Rohr.
 *
 * **Was dieses Modul entscheidet:**
 *
 *  1. **Wo der Strang steht** (`steigpunkt`). In dieser Rangfolge:
 *     · ein **Installationsschacht**, der beide Geschosse verbindet — dafür
 *       ist er da; unter mehreren der Schacht, der der Quelle am nächsten
 *       liegt;
 *     · sonst **lotrecht über der Quelle**, wenn dieser Punkt oben in einem
 *       Raum liegt: kurzer Weg, eine Kernbohrung durch die Decke. Der Punkt
 *       wird an die nächste Wand gezogen (`WANDABSTAND`) — mitten im Zimmer
 *       steht kein Strang;
 *     · sonst der **wandnächste Punkt** des Raums, der der Quelle am
 *       nächsten liegt.
 *     Findet sich gar kein Raum, gibt es keinen Punkt und der Aufrufer sagt,
 *     was fehlt.
 *
 *  2. **Wie dick der Strang wird** (`steigRuns`). Er trägt **alles, was
 *     dahinter liegt** — bei drei Geschossen vom Keller aus also EG und OG
 *     zusammen. Bemessen wird mit denselben Grenzwerten wie die Verteilung
 *     (`SIZING_LIMITS.verteilung`), gedämmt nach derselben Regel wie jede
 *     andere Leitung. Vor- und Rücklauf sind zwei Rohre, seitlich versetzt
 *     wie überall.
 *
 * Die Höhe: Der Strang beginnt auf Verlegehöhe des unteren Geschosses und
 * endet an dessen Rohdecke (`level.height`). Das Stück durch den
 * Deckenaufbau ist Sache der Ausführung und wird nicht gezeichnet; oben
 * beginnt die Verteilung am selben Punkt im Grundriss.
 */

import type { BimDocument, Level, PipeRun, Room, VerticalElement, Vec2 } from '../types/bim';
import { closestPointOnSegment, pointInPolygon } from './geometry';
import { fluidProperties, sizePipe } from './hydraulics';
import { insulationForDimension } from './pipeInsulation';
import type { PipeMaterial, PipeSurrounding } from '../types/bim';

/** Abstand der Strangachse zur Wandfläche [m]. */
export const STRANG_WANDABSTAND = 0.12;
/** Höchste Fließgeschwindigkeit im Strang [m/s] — wie in der Verteilung. */
export const STRANG_MAX_V = 1.0;
/** Höchstes Druckgefälle im Strang [Pa/m]. */
export const STRANG_MAX_GEFAELLE = 150;
/** Abstand zwischen Vor- und Rücklauf im Grundriss [m]. */
const PAARABSTAND = 0.08;

export type SteigGrund = 'schacht' | 'lotrecht' | 'naechster-raum';

export interface Steigpunkt {
  position: Vec2;
  grund: SteigGrund;
  /** Der Schacht, falls einer genommen wurde. */
  schachtId?: string;
  /** Raum, in dem der Strang oben ankommt. */
  roomId?: string;
}

/** Erreicht das senkrechte Bauteil beide Geschosse? */
function verbindet(v: VerticalElement, levels: Record<string, Level>, a: string, b: string): boolean {
  const von = levels[v.levelId];
  const bis = levels[v.toLevelId ?? ''] ?? undefined;
  if (!von) return false;
  const untenOrder = von.order;
  // Ohne `toLevelId` reicht das Bauteil bis ins nächsthöhere Geschoss.
  const obenOrder = bis ? bis.order : untenOrder + 1;
  const oa = levels[a]?.order;
  const ob = levels[b]?.order;
  if (oa === undefined || ob === undefined) return false;
  const u = Math.min(oa, ob);
  const o = Math.max(oa, ob);
  return untenOrder <= u && obenOrder >= o;
}

/** Punkt an die nächste Wandfläche des Raums ziehen — ein Strang steht in der Ecke. */
function anDieWand(p: Vec2, raum: Room): Vec2 {
  const poly = raum.innerPolygon;
  if (poly.length < 3) return p;
  let beste = p;
  let bd = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const q = closestPointOnSegment(p, a, b);
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d >= bd) continue;
    // Vom Wandpunkt aus ein Stück ins Zimmer zurück.
    const laenge = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = -(b.y - a.y) / laenge;
    const ny = (b.x - a.x) / laenge;
    const kandidaten = [
      { x: q.x + nx * STRANG_WANDABSTAND, y: q.y + ny * STRANG_WANDABSTAND },
      { x: q.x - nx * STRANG_WANDABSTAND, y: q.y - ny * STRANG_WANDABSTAND },
    ];
    const drin = kandidaten.find((k) => pointInPolygon(k, poly));
    if (!drin) continue;
    bd = d;
    beste = drin;
  }
  return beste;
}

/**
 * Wo der Strang zwischen zwei Geschossen steht.
 *
 * `quelle` ist der Ausgangspunkt im unteren Geschoss (Speicher, Verteiler,
 * Hauseinführung), `raeumeOben` sind die Räume des Geschosses, das versorgt
 * werden soll.
 */
export function steigpunkt(eingabe: {
  quelle: Vec2;
  levels: Record<string, Level>;
  vonLevelId: string;
  nachLevelId: string;
  verticals: readonly VerticalElement[];
  raeumeOben: readonly Room[];
}): Steigpunkt | undefined {
  const { quelle, levels, vonLevelId, nachLevelId, verticals, raeumeOben } = eingabe;

  // 1 · Installationsschacht, der beide Geschosse verbindet.
  const schaechte = verticals
    .filter((v) => v.kind === 'shaft' && verbindet(v, levels, vonLevelId, nachLevelId))
    .sort(
      (a, b) =>
        Math.hypot(a.position.x - quelle.x, a.position.y - quelle.y) -
        Math.hypot(b.position.x - quelle.x, b.position.y - quelle.y),
    );
  if (schaechte.length) {
    const s = schaechte[0];
    return { position: { ...s.position }, grund: 'schacht', schachtId: s.id };
  }

  const mitFlaeche = raeumeOben.filter((r) => r.innerPolygon.length >= 3);
  if (!mitFlaeche.length) return undefined;

  // 2 · Lotrecht über der Quelle, wenn dort oben ein Raum ist.
  const darueber = mitFlaeche.find((r) => pointInPolygon(quelle, r.innerPolygon));
  if (darueber) {
    return { position: anDieWand(quelle, darueber), grund: 'lotrecht', roomId: darueber.id };
  }

  // 3 · Sonst der Raum, der der Quelle am nächsten liegt.
  let bester: { raum: Room; punkt: Vec2; abstand: number } | undefined;
  for (const r of mitFlaeche) {
    const poly = r.innerPolygon;
    for (let i = 0; i < poly.length; i++) {
      const q = closestPointOnSegment(quelle, poly[i], poly[(i + 1) % poly.length]);
      const d = Math.hypot(q.x - quelle.x, q.y - quelle.y);
      if (!bester || d < bester.abstand) bester = { raum: r, punkt: q, abstand: d };
    }
  }
  if (!bester) return undefined;
  return { position: anDieWand(bester.punkt, bester.raum), grund: 'naechster-raum', roomId: bester.raum.id };
}

export interface SteigErgebnis {
  runs: PipeRun[];
  /** Nennweite DN [mm]. */
  dn: number;
  /** Fließgeschwindigkeit [m/s]. */
  velocity: number;
  /** Bezeichnung der gewählten Dimension, z. B. „Cu 28 × 1,5". */
  bezeichnung: string;
  /** Warnung der Dimensionierung, falls die Grenzen gerissen wurden. */
  warnung?: string;
}

/**
 * Vor- und Rücklauf eines Strangs durch **ein** Geschoss.
 *
 * `strom` ist der Volumenstrom [m³/h] von allem, was oberhalb hängt.
 */
export function steigRuns(eingabe: {
  doc: BimDocument;
  levelId: string;
  position: Vec2;
  /** Verlegehöhe unten [m] und Oberkante des Strangs in diesem Geschoss [m]. */
  vonHoehe: number;
  bisHoehe: number;
  strom: number;
  material: PipeMaterial;
  vorlauf: number;
  ruecklauf: number;
  /** Nummernkreis, damit die Kennungen eindeutig bleiben. */
  nummer: number;
  /** Beschriftung, z. B. „Steigleitung ins OG". */
  label: string;
  surrounding?: PipeSurrounding;
  /** Untergrenze der Nennweite [mm]. */
  minDn?: number;
}): SteigErgebnis {
  const { doc, levelId, position, vonHoehe, bisHoehe, strom, material, vorlauf, ruecklauf, nummer, label } = eingabe;
  void doc;
  const dim = sizePipe(strom, {
    material,
    maxVelocity: STRANG_MAX_V,
    maxGradient: STRANG_MAX_GEFAELLE,
    fluid: fluidProperties((vorlauf + ruecklauf) / 2),
    minDn: eingabe.minDn,
  });
  const daemmung = insulationForDimension(dim.dimension, {
    surrounding: eingabe.surrounding ?? 'beheizt',
    service: 'heating-flow',
    newInstallation: true,
    heated: true,
  } as never);

  // Ein senkrechtes Stück hat keine Richtung in der Ebene — Vor- und Rücklauf
  // liegen deshalb nebeneinander in x, wie bei jeder anderen Steigleitung.
  const runs: PipeRun[] = (['heating-flow', 'heating-return'] as const).map((service, i) => {
    const vz = i === 0 ? 1 : -1;
    const x = position.x + (PAARABSTAND / 2) * vz;
    return {
      id: `pr-steig-${nummer}-${i}`,
      pairId: `pp-steig-${nummer}`,
      levelId,
      service,
      points: [
        { x, y: position.y },
        { x, y: position.y },
      ],
      nominalDiameter: dim.dimension.dn,
      insulation: daemmung.thickness,
      elevation: vonHoehe,
      elevationTo: bisHoehe,
      generated: true,
      surrounding: eingabe.surrounding ?? 'beheizt',
      designFlow: Math.round(strom * 1000) / 1000,
      velocity: dim.velocity,
      gradient: dim.gradient,
      outerDiameter: dim.dimension.outer,
      material,
      label: `${label} ${dim.dimension.label}`,
    } as PipeRun;
  });

  return {
    runs,
    dn: dim.dimension.dn,
    velocity: dim.velocity,
    bezeichnung: dim.dimension.label,
    warnung: dim.warning,
  };
}
