/**
 * Rohrnetz und Flächenheizkreise für die Übergabe — mit Topologie.
 *
 * **Warum dieses Modul entstanden ist.** Die Anweisung der RaVia-Seite vom
 * 01.10.2026 ist eindeutig: RaVias eigener Rohrnetzrechner entfällt, das
 * Rohrnetz kommt künftig ausschließlich von hier, und für den hydraulischen
 * Abgleich braucht die Gegenstelle je Abschnitt Innendurchmesser, Durchfluss,
 * Länge, angeschlossenen Heizkörper bzw. Raum, Druckverlust — und
 * ausdrücklich **die Topologie: welches Segment folgt auf welches,
 * Verzweigungen, Verteilerzuordnung, nicht nur eine flache Segmentliste.**
 *
 * Bis 1.64.0 lieferte der Export genau diese flache Sicht: `hydraulics`
 * nennt je Verbraucher Strom, Leistung und Druckverlust, und der
 * Rohrnetzbericht führt die Teilstrecken **je Strang**. Dasselbe Rohr
 * erscheint damit in jedem Fließweg, der darüber läuft, ohne dass erkennbar
 * ist, dass es dasselbe ist. Ein Netz lässt sich daraus nicht wieder
 * zusammensetzen.
 *
 * **Die Lösung steht im Graphen, nicht in einer neuen Rechnung.** Jeder
 * Abschnitt trägt seit 1.65.0 sein Knotenpaar (`PipeSegment.fromNode/toNode`).
 * Zwei Wege über dieselbe Leitung nennen dasselbe Knotenpaar — und damit ist
 * der Abschnitt identifizierbar, die Reihenfolge ist die Fließrichtung, und
 * eine Verzweigung ist ein Knoten mit mehr als einem abgehenden Abschnitt.
 *
 * **Der Durchfluss eines gemeinsamen Abschnitts ist die Summe dahinter.**
 * Im Fließweg eines Verbrauchers steht sein eigener Strom — so rechnet der
 * Abgleich, und so steht es auf dem VdZ-Formular. Physikalisch führt die
 * Hauptleitung aber die Summe aller Verbraucher dahinter. Genau diese Summe
 * steht hier, und die Zahl der Verbraucher dazu, damit sie prüfbar ist.
 *
 * **Der Druckverlust steht nur, wo er eindeutig ist.** Er hängt am Durchfluss
 * und damit am Fließweg: Ein Abschnitt, über den drei Verbraucher laufen, hat
 * in drei Strängen drei verschiedene Werte. Für Abschnitte mit genau einem
 * Verbraucher dahinter ist er eindeutig und wird übergeben; für die übrigen
 * bleibt er weg, statt eine von drei Zahlen als die Zahl auszugeben. Die
 * Stranggesamtwerte stehen unverändert in `hydraulics`.
 */

import type {
  BimDocument,
  Fixture,
  PipeNetworkReport,
  PipeSegment,
} from '../types/bim';
import type { BalanceReport } from './hydraulicBalance';
import { verlegebilanz } from './fussbodenkurven';
import { volumeFlow, fluidProperties } from './hydraulics';

/** Was ein Knoten im Netz ist. */
export type KnotenArt = 'source' | 'branch' | 'consumer' | 'passage';

export interface NetzKnoten {
  id: string;
  kind: KnotenArt;
  /** Zahl der Abschnitte, die hier abgehen — bei `branch` mehr als einer. */
  outgoing: number;
  /** Verbraucher oder Quelle an diesem Knoten, falls einer dort sitzt. */
  fixtureId?: string;
}

export interface NetzAbschnitt {
  /** Kennung aus dem Knotenpaar — dasselbe Rohr hat in jedem Weg dieselbe. */
  id: string;
  /** Knoten stromaufwärts (Richtung Quelle). */
  fromNode: string;
  /** Knoten stromabwärts (Richtung Verbraucher). */
  toNode: string;
  /** Der Abschnitt davor in Fließrichtung; fehlt an der Quelle. */
  parentId?: string;
  /** Gezeichnete Leitung, aus der der Abschnitt stammt. */
  runId: string;
  service: string;
  levelId: string;
  /** Einfache Länge [m] — nicht Vor- und Rücklauf. */
  length: number;
  /** Innendurchmesser [mm], sobald eine Dimension ausgelegt ist. */
  innerDiameter?: number;
  nominalDiameter: number;
  material?: string;
  /** Dämmstärke [mm]; 0 = keine Anforderung erkannt. */
  insulation: number;
  /** Auslegungsdurchfluss [m³/h] — Summe aller Verbraucher dahinter. */
  flow?: number;
  /** Fließgeschwindigkeit [m/s], falls aus der Auslegung bekannt. */
  velocity?: number;
  /** Druckverlust [Pa] — nur bei genau einem Verbraucher dahinter. */
  lossPa?: number;
  /** Verbraucher, die über diesen Abschnitt versorgt werden. */
  consumers: string[];
  /** Quelle, von der aus dieser Abschnitt erreicht wird. */
  source: string;
  /** Senkrechter Abschnitt einer Steigleitung? */
  riser: boolean;
}

export interface NetzFlaechenkreis {
  /** Kennung der Heizfläche im Modell. */
  fixtureId: string;
  label: string;
  roomId: string;
  room: string;
  levelId: string;
  /** Zahl der Einzelkreise in diesem Raum. */
  loops: number;
  /** Verlegeabstand [m]. */
  spacing: number;
  /** Rohr in der Fläche [m] — Bahnen und Kehren, ohne Anbindung. */
  fieldLength: number;
  /** Rohr in den Anbindeleitungen [m], Vor- und Rücklauf. */
  supplyLength: number;
  /** Kreislänge [m] = Fläche + Anbindung, geteilt durch die Kreiszahl. */
  loopLength: number;
  /** Versorgte Fläche [m²] — nach Randabstand und Einbauten. */
  servedArea: number;
  /** Lichte Raumfläche [m²]. */
  roomArea: number;
  /** Auslegungs-Vorlauftemperatur [°C]. */
  flowTemperature: number;
  /** Spreizung [K]. */
  spread: number;
  /** Wärmeleistung des Raums über die Fläche [W]. */
  powerW: number;
  /** Auslegungsvolumenstrom [m³/h] — aus Leistung und Spreizung. */
  flow: number;
  /** Verteiler, an dem der Kreis hängt. */
  manifoldId?: string;
  /** Abgang am Verteiler, 1-basiert — fortlaufend in der Reihenfolge der Kreise. */
  manifoldPort?: number;
  /** Konnte die Anbindung an einen Verteiler gerechnet werden? */
  manifoldConnected: boolean;
  /** Ließ sich jeder Kreis als ein Zug legen? */
  complete: boolean;
}

export interface NetzExport {
  nodes: NetzKnoten[];
  segments: NetzAbschnitt[];
  floorCircuits: NetzFlaechenkreis[];
  /**
   * Räume mit **beiden** Heizflächenarten — Heizkörper und Flächenheizung
   * zugleich.
   *
   * Ausdrücklich angefragt, und zu Recht: Zwei Heizflächen mit verschiedenen
   * Systemtemperaturen in einem Raum sind hydraulisch kein Nebeneinander,
   * sondern eine Entscheidung. Für die raumweise Abstimmung der Heizlast muss
   * die Gegenstelle wissen, dass sie die Leistung auf zwei Kreise mit
   * verschiedenen Temperaturen verteilt.
   */
  mixedHeating: { roomId: string; room: string; radiators: number; floorCircuits: number }[];
}

const HEIZKOERPER = new Set(['radiator', 'radiator-tube', 'towel-radiator', 'convector']);

/** Kennung eines Abschnitts aus seinem Knotenpaar — richtungsunabhängig. */
function abschnittId(a: number, b: number): string {
  return a < b ? `s${a}-${b}` : `s${b}-${a}`;
}

const knotenId = (n: number): string => `k${n}`;
const r = (v: number, n = 3): number => Math.round(v * 10 ** n) / 10 ** n;

/**
 * Netz und Flächenkreise für den Export zusammenstellen.
 *
 * @param netz     Ergebnis von `buildPipeNetwork` — die Wege und ihre Abschnitte.
 * @param abgleich Ergebnis von `balanceNetwork`, falls gerechnet. Er liefert je
 *                 Abschnitt die ausgelegte Dimension, den Strom, die
 *                 Geschwindigkeit und den Druckverlust — dieselbe Rechnung, die
 *                 der Export für `hydraulics` ohnehin fährt. Ein zweiter Weg
 *                 über den Rohrnetzbericht würde dieselben Zahlen ein zweites
 *                 Mal bilden, und zwei Wege laufen auseinander.
 */
export function baueNetzExport(
  doc: BimDocument,
  netz: PipeNetworkReport,
  abgleich?: BalanceReport,
): NetzExport {
  /** Je Abschnittskennung: der Abschnitt, wie er entsteht und wächst. */
  const abschnitte = new Map<string, NetzAbschnitt>();
  /** Je Knoten: wie viele verschiedene Abschnitte dort abgehen. */
  const abgaenge = new Map<number, Set<string>>();
  /** Je Verbraucher sein Strom [m³/h] aus dem Abgleich. */
  const stromJeVerbraucher = new Map<string, number>();
  /** Je Verbraucher die gerechneten Abschnitte — indexgleich mit den Wegen. */
  const gerechnetJeWeg = new Map<string, BalanceReport['consumers'][number]['path']['segments']>();

  if (abgleich) {
    for (const c of abgleich.consumers) {
      gerechnetJeWeg.set(c.fixtureId, c.path.segments);
      stromJeVerbraucher.set(c.fixtureId, c.flow);
    }
  }

  for (const weg of netz.paths) {
    const strom = stromJeVerbraucher.get(weg.fixtureId);
    const gerechnet = gerechnetJeWeg.get(weg.fixtureId);

    weg.segments.forEach((seg: PipeSegment, i: number) => {
      if (seg.fromNode === undefined || seg.toNode === undefined) return;
      const id = abschnittId(seg.fromNode, seg.toNode);
      const rechnung = gerechnet?.[i];

      const vorher = weg.segments[i - 1];
      const vorgaenger =
        vorher && vorher.fromNode !== undefined && vorher.toNode !== undefined
          ? abschnittId(vorher.fromNode, vorher.toNode)
          : undefined;

      const da = abschnitte.get(id);
      if (da) {
        if (!da.consumers.includes(weg.fixtureId)) da.consumers.push(weg.fixtureId);
        if (strom !== undefined) da.flow = r((da.flow ?? 0) + strom, 4);
        // Ein Abschnitt, der von mehreren Verbrauchern benutzt wird, hat
        // keinen eindeutigen Druckverlust — siehe Dateikopf.
        da.lossPa = undefined;
        da.velocity = undefined;
        return;
      }

      abschnitte.set(id, {
        id,
        fromNode: knotenId(seg.fromNode),
        toNode: knotenId(seg.toNode),
        parentId: vorgaenger,
        runId: seg.runId,
        service: seg.service,
        levelId: weg.levelId,
        length: r(seg.length, 2),
        nominalDiameter: seg.nominalDiameter,
        material: seg.material,
        insulation: seg.insulation,
        ...(rechnung ? { innerDiameter: r(rechnung.dimension.inner, 2) } : {}),
        ...(strom !== undefined ? { flow: r(strom, 4) } : {}),
        ...(rechnung
          ? { velocity: r(rechnung.velocity, 3), lossPa: Math.round(rechnung.loss) }
          : {}),
        consumers: [weg.fixtureId],
        source: weg.sourceFixtureId,
        riser: seg.runId.startsWith('riser-'),
      });
    });

    // Abgänge zählen: Ein Knoten mit mehr als einem abgehenden Abschnitt ist
    // eine Verzweigung.
    for (const seg of weg.segments) {
      if (seg.fromNode === undefined || seg.toNode === undefined) continue;
      const satz = abgaenge.get(seg.fromNode) ?? new Set<string>();
      satz.add(abschnittId(seg.fromNode, seg.toNode));
      abgaenge.set(seg.fromNode, satz);
    }
  }

  /** Knoten, an denen ein Verbraucher oder eine Quelle sitzt. */
  const verbraucherKnoten = new Map<number, string>();
  const quellKnoten = new Set<number>();
  for (const weg of netz.paths) {
    const letzter = weg.segments[weg.segments.length - 1];
    if (letzter?.toNode !== undefined) verbraucherKnoten.set(letzter.toNode, weg.fixtureId);
    const erster = weg.segments[0];
    if (erster?.fromNode !== undefined) quellKnoten.add(erster.fromNode);
  }

  const knotenNummern = new Set<number>();
  for (const a of abschnitte.values()) {
    knotenNummern.add(Number(a.fromNode.slice(1)));
    knotenNummern.add(Number(a.toNode.slice(1)));
  }

  const knoten: NetzKnoten[] = [...knotenNummern].sort((a, b) => a - b).map((n) => {
    const ab = abgaenge.get(n)?.size ?? 0;
    const art: KnotenArt = quellKnoten.has(n)
      ? 'source'
      : verbraucherKnoten.has(n)
        ? 'consumer'
        : ab > 1
          ? 'branch'
          : 'passage';
    return {
      id: knotenId(n),
      kind: art,
      outgoing: ab,
      ...(verbraucherKnoten.get(n) ? { fixtureId: verbraucherKnoten.get(n) } : {}),
    };
  });

  return {
    nodes: knoten,
    segments: [...abschnitte.values()],
    floorCircuits: baueFlaechenkreise(doc),
    mixedHeating: gemischteRaeume(doc),
  };
}

/**
 * Die Flächenheizkreise mit allem, was der hydraulische Abgleich braucht.
 *
 * Die Längen kommen aus den Verlegekurven — denselben, die im Plan liegen —
 * und nicht aus einer Eingabe. Der Volumenstrom folgt aus der Leistung und der
 * Spreizung des Kreises mit den Stoffwerten des Heizwassers; das ist dieselbe
 * Rechnung, die die Trassenauslegung für jeden Heizkörper fährt.
 */
export function baueFlaechenkreise(doc: BimDocument): NetzFlaechenkreis[] {
  const bilanz = verlegebilanz(doc);
  if (!bilanz.length) return [];

  /** Abgangsnummern je Verteiler, fortlaufend in der Reihenfolge der Kreise. */
  const abgangZaehler = new Map<string, number>();
  const raus: NetzFlaechenkreis[] = [];

  for (const b of bilanz) {
    const fixture = Object.values(doc.fixtures).find(
      (f: Fixture) => f.type === 'underfloor' && f.params.roomCoverage === true && f.roomId === b.roomId,
    );
    if (!fixture) continue;

    const vorlauf = fixture.params.flowTemperature ?? 35;
    const ruecklauf = fixture.params.returnTemperature ?? 28;
    const spreizung = Math.max(1, vorlauf - ruecklauf);
    const leistung = fixture.params.powerW ?? 0;
    const stoff = fluidProperties((vorlauf + ruecklauf) / 2);
    const durchfluss = volumeFlow(leistung / 1000, spreizung, stoff);

    const verteiler = fixture.params.manifoldId
      ?? Object.values(doc.fixtures).find((f: Fixture) => f.type === 'manifold' && f.levelId === b.levelId)?.id;
    let abgang: number | undefined;
    if (verteiler) {
      const naechste = (abgangZaehler.get(verteiler) ?? 0) + 1;
      abgangZaehler.set(verteiler, naechste);
      abgang = naechste;
    }

    raus.push({
      fixtureId: fixture.id,
      label: fixture.label ?? `FBH ${b.raum}`,
      roomId: b.roomId,
      room: b.raum,
      levelId: b.levelId,
      loops: b.kreise,
      spacing: r(b.abstand, 3),
      fieldLength: r(b.flaechenLaenge, 2),
      supplyLength: r(b.anbindung, 2),
      loopLength: r(b.kreise > 0 ? b.gesamtLaenge / b.kreise : b.gesamtLaenge, 2),
      servedArea: r(b.belegteFlaeche, 2),
      roomArea: r(b.raumFlaeche, 2),
      flowTemperature: vorlauf,
      spread: r(spreizung, 1),
      powerW: Math.round(leistung),
      flow: r(durchfluss, 4),
      ...(verteiler ? { manifoldId: verteiler, manifoldPort: abgang } : {}),
      manifoldConnected: b.amVerteiler,
      complete: b.vollstaendig,
    });
  }
  return raus;
}

/** Räume mit Heizkörper **und** Flächenheizung. */
export function gemischteRaeume(doc: BimDocument): NetzExport['mixedHeating'] {
  const je = new Map<string, { hk: number; fbh: number }>();
  for (const f of Object.values(doc.fixtures)) {
    if (!f.roomId) continue;
    const eintrag = je.get(f.roomId) ?? { hk: 0, fbh: 0 };
    if (HEIZKOERPER.has(f.type)) eintrag.hk += 1;
    else if (f.type === 'underfloor') eintrag.fbh += 1;
    je.set(f.roomId, eintrag);
  }
  const raus: NetzExport['mixedHeating'] = [];
  for (const [roomId, z] of je) {
    if (z.hk > 0 && z.fbh > 0) {
      raus.push({
        roomId,
        room: doc.rooms[roomId]?.name ?? roomId,
        radiators: z.hk,
        floorCircuits: z.fbh,
      });
    }
  }
  return raus;
}
