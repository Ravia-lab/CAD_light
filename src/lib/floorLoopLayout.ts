/**
 * Verlegekurve der Fußbodenheizung — vom Raumpolygon zur Rohrschlange.
 * ---------------------------------------------------------------------------
 * **Warum es dieses Modul gibt.**
 *
 * `hydraulics.ts` rechnet, wie viel Rohr in einen Raum gehört: Rohrbedarf
 * 1/Verlegeabstand, Feldlänge, Kreisanzahl, Volumenstrom, Druckverlust. Was
 * dort fehlt, ist die Frage des Verlegers: *wo* liegt das Rohr. Genau die
 * beantwortet dieses Modul — und nur die. Es rechnet keine Leistung, keine
 * Kreisanzahl und keinen Druckverlust; die Kreisanzahl bekommt es übergeben.
 * Damit bleibt der Rechenkern die eine Stelle, an der Physik steht, und diese
 * Datei die eine Stelle, an der Geometrie steht.
 *
 * **Warum die Kurve nicht gespeichert wird.** Sie ist vollständig aus dem
 * Raumpolygon, dem Verlegeabstand und dem Randabstand ableitbar. Wer eine
 * Wand verschiebt, bekommt eine neue Fläche und muss eine neue Kurve
 * bekommen — eine mitgespeicherte Kurve wäre nach dem ersten Wandzug falsch,
 * ohne dass es jemandem auffiele.
 *
 * **Zwei Muster, zwei Konstruktionen — und warum es nicht eine sein kann.**
 *
 *  • `maeander` entsteht aus **Schnittlinien**: die belegbare Fläche wird von
 *    parallelen Geraden im Abstand des Verlegeabstands geschnitten, und die
 *    Abschnitte werden der Reihe nach verkettet. Jeder Abschnitt liegt per
 *    Konstruktion innerhalb der Fläche. Bei einer U-Form zerfällt eine Gerade
 *    in zwei Abschnitte — kein Sonderfall, sondern ein Nebenprodukt. Deshalb
 *    ist der Mäander das Muster, das jede Raumform verträgt.
 *
 *  • `schnecke` entsteht aus **ineinanderliegenden Konturen**: das Raumpolygon
 *    wird fortlaufend nach innen versetzt, und die Kurve wandert dabei um zwei
 *    Verlegeabstände je Umlauf nach innen, kehrt in der Mitte um und läuft in
 *    den Lücken wieder heraus. Das ergibt die bifilare Verlegung: neben jeder
 *    Vorlaufwindung liegt eine Rücklaufwindung.
 *
 *    **Wo die Schnecke einrückt, entscheidet die Hauptrichtung.** Das ist
 *    nicht Kosmetik, sondern die Antwort auf den Befund „die Fußbodenheizung
 *    steht schief im Raum": früher wurde das Einrücken gleichmäßig über die
 *    Bogenlänge verteilt, und damit stand *jede* Bahn um arctan(2·a/U) schräg
 *    zur Wand — bei 13 m Umfang und 15 cm Verlegeabstand rund 1,3°, in
 *    dieselbe Richtung für alle Windungen, und das Auge liest das Ganze als
 *    gedrehtes Rechteck. Gemessen an einem Raum 3,50 × 3,54 m lagen 98 % der
 *    Rohrlänge schräg. Jetzt rückt das Rohr nur dort ein, wo es ohnehin quer
 *    durch den Raum läuft: die Bahnen entlang der Wände sind wandparallel per
 *    Konstruktion, das Einrücken sammelt sich an den Kehren. Siehe
 *    `driftProfile`.
 *
 * Warum die Schnecke *nicht* aus derselben Bahnenschar gebaut wird, obwohl das
 * viel einfacher wäre: sie ginge nicht. Ordnet man parallele Bahnen bifilar
 * (hin über 1, 3, 5, zurück über 6, 4, 2), müssen sich die Kehren an den
 * Bahnenden überschneiden — die Kehre von Bahn 1 nach Bahn 3 läuft über das
 * Ende von Bahn 2 hinweg. Das gilt für jede Anordnung paralleler Bahnen und
 * ist keine Frage der Sorgfalt: eine bifilare Verlegung ist topologisch eine
 * Spirale und braucht Konturen, keine Geraden. Zwei sich kreuzende Rohre im
 * Estrich sind kein Darstellungsfehler, sondern ein Bauteil, das es nicht
 * gibt — deshalb der Aufwand.
 *
 * **Wenn die Schnecke nicht trägt, wird es gesagt.** Versetzte Konturen laufen
 * bei L-, U- und V-Formen irgendwann ineinander und schneiden sich selbst.
 * Jede Kontur wird deshalb geprüft (überschneidungsfrei, ganz innerhalb,
 * Fläche nimmt ab), und die fertige Kurve wird gegen die Faustregel
 * Fläche/Verlegeabstand gehalten. Hält sie nicht, fällt das Ergebnis auf den
 * Mäander zurück und `notes` sagt warum — statt eine Schnecke zu zeichnen,
 * die aus dem Raum läuft oder ein Loch in der Mitte lässt.
 *
 * **Ein Heizkreis beginnt am Verteiler.** Nicht am Raumrand und nicht an der
 * ersten Polygonecke — die ist eine Nummer in einer Liste und hat mit dem
 * Bauwerk nichts zu tun. Wird `manifold` übergeben, dreht sich jede Kurve so,
 * dass sie an dem dem Verteiler zugewandten Ende beginnt, die Schnecke setzt
 * ihre Startecke dorthin, und es entsteht eine **Anbindeleitung**, die in die
 * Kreislänge eingeht (`supplyLength`, `circuitLength`). Sie ist der Grund,
 * warum ein weit entfernter Raum einen eigenen Kreis braucht: 20 m Entfernung
 * sind 40 m Rohr, bevor im Raum das erste Rohr liegt. Ohne Verteiler wird
 * keine Anbindung erfunden — dann sagt `notes`, dass die Kreislänge
 * unvollständig ist, und die Kurve fängt an, wo sie eben anfängt.
 *
 * **Randbedingungen der Praxis, die als Parameter geführt werden.** Die
 * Heizfläche endet nicht an der Wand: dort liegt der Randdämmstreifen, und
 * das erste Rohr hält Abstand. Unter fest eingebauten Sanitärobjekten wird
 * nicht verlegt. Beide Größen sind hier **Eingabeparameter mit Vorgabewert**
 * und stehen im Ergebnis (`edgeClearance`, `obstacleClearance`) — sie
 * verändern die belegbare Fläche und damit die Leistung und dürfen deshalb
 * nicht als unsichtbare Konstante im Zeichencode stecken.
 *
 * **Was das Modul nicht tut.** Es erfindet keine Kurve. Wo eine Form nicht
 * zusammenhängend belegbar ist, entstehen mehrere Kurvenstücke, `complete`
 * wird `false` und im Ergebnis steht, warum.
 *
 * **Einheiten.** Alles in Metern und Quadratmetern, Winkel in Grad (CCW,
 * 0° = +x) — dieselbe Konvention wie im übrigen Modellraum.
 */

import type { FixtureType, FloorLoopPattern, Vec2 } from '../types/bim';
import {
  distance,
  distanceToSegment,
  lerp,
  offsetPolygonPerEdge,
  pointInPolygon,
  polygonArea,
  polygonBounds,
  segmentIntersection,
  signedArea,
} from './geometry';

// ---------------------------------------------------------------------------
// Vorgabewerte — alle überschreibbar, alle im Ergebnis benannt
// ---------------------------------------------------------------------------

/**
 * Randabstand [m] — Abstand des äußersten Rohrs zur lichten Wandkante.
 *
 * **Herkunft: Praxis, keine Norm.** Der Randdämmstreifen ist 8 bis 10 mm
 * dick; darüber hinaus hält der Verleger Abstand, weil das Rohr am Rand vom
 * Estrich nicht mehr sicher umschlossen wäre und weil die Randzone ohnehin
 * eine andere Wärmestromdichte hat. Üblich sind 5 bis 10 cm. 10 cm ist die
 * vorsichtige Wahl: sie schätzt die belegbare Fläche eher zu klein als zu
 * groß, und eine zu klein geschätzte Fläche führt auf eine zu hohe
 * Wärmestromdichte — den Fall, den die Auslegung ohnehin prüft.
 */
export const DEFAULT_EDGE_CLEARANCE = 0.1;

/**
 * Abstand zu Einbauten [m]. Unter einer Badewanne oder einer Duschwanne wird
 * nicht verlegt; das Rohr endet mit etwas Abstand davor, damit es beim
 * Aufstellen nicht getroffen wird. 5 cm ist Erfahrungswert, keine Norm.
 */
export const DEFAULT_OBSTACLE_CLEARANCE = 0.05;

/**
 * Kürzeste Bahn, die noch verlegt wird [m].
 *
 * Ein 8 cm langer Rest in einer Ecke ist keine Rohrbahn, sondern eine Kehre,
 * die niemand legt. Ohne diese Schwelle erzeugt jede schräge Wand eine
 * Handvoll Stummel, die die Rohrlänge verfälschen und den Plan verschmutzen.
 * 30 cm entspricht ungefähr dem kleinsten Biegeradius eines 16er
 * Verbundrohrs samt Rückweg.
 */
export const DEFAULT_MIN_RUN_LENGTH = 0.3;

/**
 * Größte Kreislänge [m] als Vorbelegung.
 *
 * **Herkunft: Verlegeanleitungen der Systemanbieter, keine Norm.** Für das
 * gängige Rohr 16 × 2 mm nennen sie übereinstimmend eine Größenordnung von
 * 100 m je Heizkreis — darüber wird der Druckverlust unwirtschaftlich und der
 * Kreis lässt sich am Verteiler kaum noch einregulieren. Der Wert hängt an
 * der Nennweite (17er tragen mehr, 20er noch mehr) und ist deshalb ein
 * überschreibbarer Parameter, keine Konstante. Er begrenzt nichts, er meldet
 * nur.
 */
export const DEFAULT_MAX_CIRCUIT_LENGTH = 100;

/** Vorgabe-Verlegemuster. Bifilar, weil das die übliche Verlegung ist. */
export const DEFAULT_LOOP_PATTERN: FloorLoopPattern = 'schnecke';

/**
 * Zulässige Unterschreitung des Randabstands bei der Prüfung von
 * Verbindungsstücken [m] = 2 mm.
 *
 * Die Bahnenden liegen durch die Intervallschachtelung *genau* auf der
 * Grenze der belegbaren Fläche. Ein Verbindungsstück zwischen zwei solchen
 * Punkten läuft an einer schrägen Wand rechnerisch um Bruchteile eines
 * Millimeters darüber hinaus. Ohne diese Nachsicht bräche der Zug an jeder
 * schrägen Wand ab, obwohl die Kurve in Wirklichkeit passt.
 */
const VALIDATION_SLACK = 0.002;

/**
 * Objekte, unter denen nicht verlegt wird.
 *
 * Die Regel dahinter ist eine einzige: **ein Objekt spart aus, wenn es auf
 * dem Estrich steht oder ihn durchdringt.** Alles, was an der Wand hängt,
 * spart nichts aus — unter einem Waschtisch oder einem Wandheizkörper liegt
 * Rohr wie überall sonst.
 *
 * Daraus folgen drei Gruppen:
 *
 *  • *Bodenstehende Sanitärobjekte* — Badewanne, Duschwanne, WC. Sie stehen
 *    auf dem Fertigfußboden; darunter wäre das Rohr weder erreichbar noch
 *    wirksam.
 *
 *  • *Fest eingebaute Möbel* — die Küchenzeile. Sachlich derselbe Fall wie
 *    die Badewanne, und der auffälligste Nachtrag: eine Zeile von 3 m Länge
 *    und 60 cm Tiefe sind 1,8 m², die als Heizfläche gar nicht zur Verfügung
 *    stehen — der Sockel schließt sie vom Raum ab —, und in die die
 *    Unterschränke am Boden befestigt werden. Wer dort Rohr legt, bohrt es
 *    beim Aufstellen an.
 *
 *  • *Durchdringungen des Estrichs* — Fall- und Steigstränge, Bodenablauf,
 *    Unterflurkonvektor. Sie sind keine Möbel, aber an ihrer Stelle ist kein
 *    Estrich, also auch kein Rohr. Der Unterflurkonvektor liegt sogar
 *    ausdrücklich *im* Boden. Die frühere Fassung hat den Bodenablauf mit dem
 *    Argument „Durchdringung, kein Hindernis" ausgenommen; das war
 *    inkonsequent — für die Verlegekurve ist beides dieselbe Aussparung.
 *
 * Nicht in der Liste und mit Absicht nicht: Waschtisch, Wärmeerzeuger,
 * Warmwasserbereiter, Lüftungsgerät, Verteiler, Thermostat. Sie hängen alle
 * an der Wand (`elevation > 0` im Katalog) und stehen dem Rohr nicht im Weg.
 *
 * **Nicht in dieser Liste, aber immer Aussparung: massive Bauteile.** Kamin,
 * Pfeiler, Wandversatz und Installationsblock (`SolidElement`) sind keine
 * Einbauten, sondern Mauerwerk — sie stehen auf dem Estrich oder durchstoßen
 * ihn. Für sie gibt es deshalb keine Ja/Nein-Frage und keinen Eintrag hier:
 * sie werden ausnahmslos als Aussparung übergeben. Die Liste unterscheidet,
 * was auf dem Boden steht, von dem, was an der Wand hängt; bei Mauerwerk
 * stellt sich diese Frage nicht.
 *
 * Die Liste ist eine Planungsregel und gehört deshalb hierher, nicht in die
 * Ansicht.
 */
export const FLOOR_OBSTACLE_TYPES: ReadonlySet<FixtureType> = new Set<FixtureType>([
  'bathtub',
  'shower',
  'wc',
  'kitchen-unit',
  'convector',
  'floor-drain',
  'riser-sanitary',
  'riser-heating',
]);

// ---------------------------------------------------------------------------
// Schnittstelle
// ---------------------------------------------------------------------------

export interface FloorLoopNote {
  severity: 'info' | 'warn' | 'error';
  text: string;
}

export interface FloorLoopOptions {
  /** Verlegeabstand [m]. Vorgabe 0,15 m — dieselbe wie in `designFloorHeating`. */
  spacing?: number;
  /** Gewünschte Zahl der Heizkreise [-]. Vorgabe 1. */
  loops?: number;
  /** Randabstand [m]; Vorgabe `DEFAULT_EDGE_CLEARANCE`. */
  edgeClearance?: number;
  /** Aussparungen (Einbauten) als Polygone im selben Koordinatensystem. */
  obstacles?: readonly (readonly Vec2[])[];
  /** Abstand zu den Aussparungen [m]; Vorgabe `DEFAULT_OBSTACLE_CLEARANCE`. */
  obstacleClearance?: number;
  /** Kürzeste noch verlegte Bahn [m]; Vorgabe `DEFAULT_MIN_RUN_LENGTH`. */
  minRunLength?: number;
  /** Verlegemuster; Vorgabe `DEFAULT_LOOP_PATTERN`. */
  pattern?: FloorLoopPattern;
  /**
   * Richtung der Bahnen [°]. Ohne Angabe die Hauptachse des Raums, siehe
   * `mainAxisDirection` — so laufen die Bahnen parallel zu den maßgeblichen
   * Wänden, was die wenigsten Kehren ergibt und dem entspricht, was von Hand
   * gelegt wird.
   */
  direction?: number;
  /**
   * Standort des Heizkreisverteilers im Modellraum [m].
   *
   * Ohne ihn hat ein Heizkreis keinen Anfang. Ist er gesetzt, beginnt jede
   * Kurve an dem Ende, das dem Verteiler zugewandt ist, und es entsteht eine
   * Anbindeleitung. Ist er nicht gesetzt, wird keine erfunden — dann sagt
   * `notes`, dass die Kreislänge unvollständig ist.
   */
  manifold?: Vec2;
  /**
   * Größte Kreislänge [m] — Anbindeleitung eingerechnet.
   *
   * **Herkunft: Herstellerangabe, keine Norm.** Für 16 × 2 mm Verbundrohr
   * nennen die Verlegeanleitungen der gängigen Systemanbieter rund 100 m je
   * Kreis; darüber wird der Druckverlust unwirtschaftlich und der Kreis
   * hydraulisch schwer einzuregulieren. Größere Nennweiten tragen mehr (17er
   * etwa 120 m, 20er etwa 130 m), deshalb ist der Wert ein überschreibbarer
   * Parameter und keine Konstante. Überschreitungen werden gemeldet, nicht
   * korrigiert: ob geteilt oder ein größeres Rohr gewählt wird, entscheidet
   * die Auslegung, nicht die Zeichnung.
   */
  maxCircuitLength?: number;
}

/**
 * Anbindeleitung eines Heizkreises: vom Verteiler zum Anfang der Verlegekurve.
 *
 * **Warum sie hier auftaucht und was sie ausdrücklich nicht ist.** Sie ist
 * die kürzeste Verbindung, nicht die verlegte Trasse — die läuft an Wänden
 * entlang, durch Türdurchgänge und im Bündel mit den Nachbarkreisen, und die
 * kennt dieses Modul nicht. Sie ist damit eine *untere Schranke* der
 * tatsächlichen Anbindelänge, und genau so steht sie in `notes`. Erfunden
 * wird nichts: kein Umwegzuschlag, keine Trassenführung.
 *
 * Gezählt wird sie doppelt, weil Vor- und Rücklauf denselben Weg gehen. Das
 * ist keine Schätzung, sondern die Definition der Kreislänge.
 */
export interface FloorSupplyLine {
  /** Nummer des Heizkreises (1-basiert). */
  loop: number;
  /** Verteiler → Kurvenanfang [m]. Vor- und Rücklauf liegen übereinander. */
  points: Vec2[];
  /** Rohr für diese Anbindung [m] = 2 × Weglänge. */
  length: number;
}

/** Eine zusammenhängende Verlegekurve. */
export interface FloorLoopCurve {
  /** Nummer des Heizkreises, zu dem das Stück gehört (1-basiert). */
  loop: number;
  /** Nummer des Stücks innerhalb des Kreises (1-basiert; > 1 nur bei Zerfall). */
  part: number;
  /** Die Verlegekurve als Polylinie im Modellraum [m]. */
  points: Vec2[];
  /** Gesamtlänge der Polylinie [m], einschließlich der Kehren. */
  length: number;
  /** Nur die geraden Bahnen [m] — ohne die Verbindungsstücke. */
  fieldLength: number;
  /** Von diesem Stück belegte Fläche [m²] = Bahnlänge × Verlegeabstand. */
  area: number;
}

export interface FloorLoopLayout {
  /**
   * Tatsächlich gelegtes Muster. Kann vom gewünschten abweichen — eine
   * Schnecke, die die Form nicht trägt, wird zum Mäander, und das steht dann
   * hier und in `notes`, nicht nur im Bild.
   */
  pattern: FloorLoopPattern;
  /** Gewünschtes Muster. */
  requestedPattern: FloorLoopPattern;
  /** Angesetzter Verlegeabstand [m]. */
  spacing: number;
  /** Angesetzter Randabstand [m]. */
  edgeClearance: number;
  /** Angesetzter Abstand zu Einbauten [m]. */
  obstacleClearance: number;
  /** Angesetzte kürzeste Bahn [m]. */
  minRunLength: number;
  /** Richtung der Bahnen [°]. */
  direction: number;
  /** Lichte Grundfläche des Raums [m²]. */
  grossArea: number;
  /** Fläche, die nach Randabstand und Einbauten übrig bleibt [m²]. */
  layableArea: number;
  /** Tatsächlich angelegte Kreise [-]. */
  loops: number;
  /** Angeforderte Kreise [-] — weicht ab, wenn die Fläche nicht reicht. */
  requestedLoops: number;
  curves: FloorLoopCurve[];
  /** Anbindeleitungen zum Verteiler — leer, solange keiner gesetzt ist. */
  supplyLines: FloorSupplyLine[];
  /** Rohr in der Fläche [m] — Summe der geraden Bahnen. */
  fieldLength: number;
  /** Rohr insgesamt [m] — einschließlich Kehren, ohne Anbindeleitungen. */
  totalLength: number;
  /** Rohr in den Anbindeleitungen [m] — Vor- und Rücklauf. */
  supplyLength: number;
  /**
   * Kreislänge [m] = `totalLength` + `supplyLength`.
   *
   * Die Zahl, über die der Druckverlust entsteht, und die Zahl, an der man
   * sieht, warum ein weit entfernter Raum einen eigenen Kreis braucht: die
   * Anbindung eines 20 m entfernten Raums kostet 40 m Rohr, bevor im Raum
   * das erste Rohr liegt.
   */
  circuitLength: number;
  /** Angesetzte größte Kreislänge [m]. */
  maxCircuitLength: number;
  /** Stand ein Verteiler zur Verfügung? */
  manifoldConnected: boolean;
  /**
   * Ließ sich jeder Kreis als *ein* zusammenhängender Zug legen?
   * `false` heißt: die Form zerfällt; im Plan stehen mehrere Stücke, und in
   * `notes` steht der Grund.
   */
  complete: boolean;
  notes: FloorLoopNote[];
}

// ---------------------------------------------------------------------------
// Belegbarkeit — die eine Frage, auf der alles andere aufbaut
// ---------------------------------------------------------------------------

interface Field {
  poly: readonly Vec2[];
  obstacles: readonly (readonly Vec2[])[];
  edge: number;
  obstacleClearance: number;
}

/** Kürzester Abstand eines Punktes zum Polygonrand [m]. */
function boundaryDistance(p: Vec2, poly: readonly Vec2[]): number {
  let best = Infinity;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const d = distanceToSegment(p, poly[i], poly[(i + 1) % n]);
    if (d < best) best = d;
  }
  return best;
}

/**
 * Darf an dieser Stelle Rohr liegen?
 *
 * Bewusst als Punktprüfung und nicht als versetztes Polygon: die Prüfung
 * „innerhalb *und* weit genug von jeder Kante weg" ist für konkave Formen
 * genauso richtig wie für konvexe und kann nicht in sich zusammenfallen.
 * `slack` lässt die zulässige Unterschreitung zu, die Verbindungsstücke
 * brauchen (siehe `VALIDATION_SLACK`).
 */
function isLayable(field: Field, p: Vec2, slack = 0): boolean {
  if (!pointInPolygon(p, field.poly)) return false;
  if (boundaryDistance(p, field.poly) < field.edge - slack) return false;
  for (const o of field.obstacles) {
    if (o.length < 3) continue;
    if (pointInPolygon(p, o)) return false;
    if (boundaryDistance(p, o) < field.obstacleClearance - slack) return false;
  }
  return true;
}

/**
 * Grenze zwischen einem nicht belegbaren und einem belegbaren Punkt auf einer
 * waagerechten Linie, per Intervallschachtelung. Zwölf Halbierungen bringen
 * jeden Abtastschritt unter 1/4000 seiner Länge — deutlich feiner als jede
 * Zeichnungsgenauigkeit.
 */
function refineEdge(field: Field, y: number, xOutside: number, xInside: number): number {
  let out = xOutside;
  let inside = xInside;
  for (let i = 0; i < 12; i++) {
    const mid = (out + inside) / 2;
    if (isLayable(field, { x: mid, y })) inside = mid;
    else out = mid;
  }
  return inside;
}

/** Ein belegbarer Abschnitt auf einer Schnittlinie. */
interface Span {
  x0: number;
  x1: number;
}

/**
 * Belegbare Abschnitte einer waagerechten Schnittlinie.
 *
 * Abgetastet statt analytisch geschnitten: der analytische Schnitt kennt nur
 * das Polygon, die Abtastung kennt zusätzlich Randabstand und Einbauten — und
 * genau deren Zusammenspiel entscheidet, wo Rohr liegen darf. Bei einer
 * U-Form liefert dieselbe Linie zwei Abschnitte, ohne dass der Fall
 * irgendwo behandelt werden müsste.
 */
function scanRow(field: Field, y: number, xMin: number, xMax: number, step: number): Span[] {
  const spans: Span[] = [];
  let startX: number | null = null;
  let prevX = xMin;
  let prevInside = false;

  for (let x = xMin; ; x += step) {
    const at = x > xMax ? xMax : x;
    const inside = isLayable(field, { x: at, y });
    if (inside && !prevInside) {
      startX = at === xMin ? at : refineEdge(field, y, prevX, at);
    } else if (!inside && prevInside && startX !== null) {
      spans.push({ x0: startX, x1: refineEdge(field, y, at, prevX) });
      startX = null;
    }
    prevInside = inside;
    prevX = at;
    if (at >= xMax) break;
  }
  if (prevInside && startX !== null) spans.push({ x0: startX, x1: xMax });
  return spans;
}

/**
 * Belegbare Fläche [m²] durch Integration der Schnittlinien.
 *
 * Die Alternative — das Polygon nach innen versetzen und die Fläche des
 * Ergebnisses nehmen — ist bei konkaven Formen falsch, sobald sich die
 * versetzten Kanten überholen. Die Integration ist unempfindlich dagegen und
 * berücksichtigt die Einbauten gleich mit. Die Linien liegen mittig in
 * gleich hohen Streifen (Mittelpunktregel), deshalb ist das Ergebnis für
 * achsparallele Ränder exakt.
 */
function integrateLayableArea(field: Field, rows: number, yLo: number, yHi: number, xMin: number, xMax: number, step: number): number {
  if (yHi <= yLo || rows < 1) return 0;
  const dy = (yHi - yLo) / rows;
  let sum = 0;
  for (let k = 0; k < rows; k++) {
    const y = yLo + (k + 0.5) * dy;
    for (const s of scanRow(field, y, xMin, xMax, step)) sum += s.x1 - s.x0;
  }
  return sum * dy;
}

/**
 * Hauptrichtung eines Raums [°] — die Richtung, in der die Bahnen laufen.
 *
 * **Warum nicht die längste Kante.** Das war der frühere Ansatz, und er kippt
 * an der Stelle, an der Grundrisse tatsächlich aussehen: sobald ein
 * Wandversatz, eine Nische oder ein Schornsteinkopf die lange Wand in zwei
 * Stücke zerlegt, ist die längste *Kante* plötzlich die kurze Wand, und die
 * Bahnen stehen quer im Raum. Die Regel ist eine Auswahl aus einer diskreten
 * Menge: sie springt um 90°, sobald zwei Kanten ihre Reihenfolge tauschen.
 * Gemessen an einem Raum 5,00 × 2,50 m mit je einer 15-cm-Nische in beiden
 * Längswänden liefert sie 90° statt 0°.
 *
 * **Geprüfte Alternativen.**
 *
 *  • *Hauptträgheitsachse der Fläche* (größtes Flächenmoment 2. Grades).
 *    Verworfen, und zwar nicht aus Geschmack: sie beantwortet eine andere
 *    Frage — wie die Fläche verteilt ist, nicht wo die Wände stehen. An einer
 *    rechtwinkligen L-Form 6 × 5 m liefert sie 148°, an einem Rechteck mit
 *    abgeschrägter Ecke 158° bis 173°. Eine Diagonalverlegung in einem
 *    rechtwinkligen Raum legt niemand.
 *
 *  • *Kleinstes umschließendes Rechteck.* Deutlich besser — in allen hier
 *    geprüften Formen trifft es dieselbe Richtung wie die gewählte Regel.
 *    Trotzdem nicht genommen, aus zwei Gründen: es liest nur die konvexe
 *    Hülle, also gerade nicht die einspringenden Wände und Nischen, an denen
 *    die alte Regel zerbrochen ist; und es ist wieder eine Auswahl aus einer
 *    diskreten Menge (die Hüllkanten), die bei nahezu quadratischen Räumen
 *    zwischen zwei Lagen springen kann, während jemand eine Wand zieht.
 *
 * **Gewählt: längengewichtetes Mittel der Kantenrichtungen im 90°-Raster,
 * danach die längere Seite.** Jede Wand zählt mit ihrer Länge, und Winkel
 * werden im Raster gemittelt (Richtung mal vier, mitteln, durch vier) — das
 * ist das übliche Mittel für 90°-periodische Größen und sorgt dafür, dass
 * sich zwei zueinander senkrechte Wände *bestätigen* statt auszulöschen. Ein
 * Wandversatz parallel zur Hauptwand verstärkt damit das Raster, statt es zu
 * kippen; eine einzelne schräge Wand wird von der Länge der übrigen
 * überstimmt. Das Ergebnis ist außerdem stetig in den Eckpunkten: wer eine
 * Wand zieht, sieht die Bahnen mitwandern statt umspringen.
 *
 * Welche der beiden Rasterachsen es wird, entscheidet die Ausdehnung: die
 * Bahnen laufen entlang der längeren Seite des umschließenden Rechtecks im
 * Raster. Das ist die Achse mit den wenigsten Kehren — und die Achse, an der
 * sich der Verleger orientiert.
 */
function mainAxisDirection(poly: readonly Vec2[]): number {
  const n = poly.length;
  let x = 0;
  let y = 0;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const len = distance(a, b);
    if (len < 1e-9) continue;
    const th = Math.atan2(b.y - a.y, b.x - a.x);
    x += len * Math.cos(4 * th);
    y += len * Math.sin(4 * th);
  }
  // Ohne jede Kantenlänge gibt es keine Vorzugsrichtung; 0° ist dann so gut
  // wie jede andere und hält das Ergebnis wenigstens reproduzierbar.
  const raster = Math.hypot(x, y) < 1e-12 ? 0 : Math.atan2(y, x) / 4;

  const c = Math.cos(-raster);
  const s = Math.sin(-raster);
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const p of poly) {
    const u = p.x * c - p.y * s;
    const vv = p.x * s + p.y * c;
    if (u < minU) minU = u;
    if (u > maxU) maxU = u;
    if (vv < minV) minV = vv;
    if (vv > maxV) maxV = vv;
  }
  const laengs = maxU - minU >= maxV - minV ? raster : raster + Math.PI / 2;
  return (laengs * 180) / Math.PI;
}

// ---------------------------------------------------------------------------
// Belegbare Fläche als eigene Auskunft
// ---------------------------------------------------------------------------

/**
 * Belegbare Fläche eines Raums [m²].
 *
 * Eigene Funktion, weil sie *vor* der Kurve gebraucht wird: die Kreisanzahl
 * kommt aus `designFloorHeating(belegbareFläche, …)`, und die Kurve braucht
 * die Kreisanzahl. Ohne diesen Zwischenschritt müsste entweder die Kurve die
 * Kreisanzahl selbst erfinden oder der Rechenkern die Geometrie kennen —
 * beides wäre die falsche Zuständigkeit.
 *
 * Sie ersetzt den pauschalen Belegungsgrad, mit dem die Anlagenauslegung
 * arbeitet, wenn kein Grundriss vorliegt: hier wird gemessen statt geschätzt.
 */
export function measureLayableArea(polygon: readonly Vec2[], options: FloorLoopOptions = {}): number {
  if (polygon.length < 3) return 0;
  const spacing = options.spacing ?? 0.15;
  if (!(spacing > 0)) return 0;
  const field: Field = {
    poly: polygon,
    obstacles: options.obstacles ?? [],
    edge: Math.max(0, options.edgeClearance ?? DEFAULT_EDGE_CLEARANCE),
    obstacleClearance: Math.max(0, options.obstacleClearance ?? DEFAULT_OBSTACLE_CLEARANCE),
  };
  const b = polygonBounds(polygon);
  const step = sampleStep(spacing);
  const yLo = b.minY + field.edge;
  const yHi = b.maxY - field.edge;
  const rows = Math.max(1, Math.ceil((yHi - yLo) / (spacing / 4)));
  return integrateLayableArea(field, rows, yLo, yHi, b.minX, b.maxX, step);
}

/**
 * Abtastschritt entlang einer Schnittlinie [m].
 *
 * Ein Viertel des Verlegeabstands, höchstens 5 cm: feiner als jede Nische,
 * die noch belegt werden könnte, und grob genug, dass ein Raum von 30 m² in
 * wenigen Millisekunden durchgerechnet ist. Die Endpunkte werden anschließend
 * ohnehin nachgeschärft, der Schritt bestimmt also nur, was gefunden wird,
 * nicht wie genau.
 */
function sampleStep(spacing: number): number {
  return Math.min(Math.max(spacing / 4, 0.01), 0.05);
}

// ---------------------------------------------------------------------------
// Schnecke — ineinanderliegende Konturen
// ---------------------------------------------------------------------------

/**
 * Länge eines Abschnitts auf einer einrückenden Kante [m].
 *
 * Auf den Kanten, an denen die Schnecke einrückt, ist die Kurve nicht mehr
 * deckungsgleich mit einer Kontur, sondern läuft schräg von der einen auf die
 * nächste. Dieses Stück wird unterteilt, damit die Schlussprüfung (jeder
 * Punkt und jede Sehnenmitte in der belegbaren Fläche) es überhaupt erfassen
 * kann. 40 cm ist die grobste Unterteilung, bei der eine Ecke von 45° noch
 * mit weniger als einem Millimeter Sehnenfehler angenähert wird.
 */
const SPIRAL_DRIFT_STEP = 0.4;

/** Kontur des Polygons, um `d` nach innen versetzt — oder `null`, wenn sie nicht trägt. */
function contour(poly: readonly Vec2[], field: Field, d: number, flaecheAussen: number): Vec2[] | null {
  const off = offsetPolygonPerEdge(poly, poly.map(() => d));
  if (off.length < 3) return null;
  const flaeche = signedArea(off);
  // Die versetzte Kontur muss denselben Umlaufsinn behalten und kleiner sein.
  // Kippt das Vorzeichen oder wächst die Fläche, hat sich die Kontur
  // überholt — das ist der Punkt, an dem ein naiver Offset eine Kurve
  // erzeugen würde, die aus dem Raum läuft.
  if (flaeche <= 1e-6 || flaeche >= flaecheAussen) return null;
  for (const p of off) {
    if (!isLayable(field, p, VALIDATION_SLACK)) return null;
  }
  if (!istEinfach(off)) return null;
  return off;
}

/** Schneidet sich das Polygon selbst? Nicht benachbarte Kanten dürfen sich nicht treffen. */
function istEinfach(poly: readonly Vec2[]): boolean {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      // Benachbarte Kanten teilen einen Eckpunkt und schneiden sich dort immer.
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      if (segmentIntersection(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n]) !== null) return false;
    }
  }
  return true;
}

/**
 * Verteilung des Einrückens auf die Kanten eines Umlaufs — die Größe, die
 * die Schnecke gerade in den Raum stellt.
 *
 * **Das Problem, das sie löst.** Eine bifilare Schnecke *muss* je Umlauf um
 * zwei Verlegeabstände einrücken, und sie muss es stetig tun: würde sie an
 * einer Stelle springen, liefe der Sprung über die dazwischenliegende
 * Rücklaufwindung hinweg — Rohr auf Rohr. Die Frage ist also nicht *ob*
 * eingerückt wird, sondern *wo*.
 *
 * Bisher wurde das Einrücken gleichmäßig über die Bogenlänge verteilt. Das
 * ist die Ursache der schiefen Bilder: bei einem Umlauf von 13 m und 15 cm
 * Verlegeabstand wandert das Rohr auf *jedem* Meter um 2,3 cm nach innen,
 * also auch entlang der langen Wände. Jede Bahn steht dadurch um
 * arctan(2·a/U) ≈ 1,3° schräg — für sich unauffällig, aber alle Windungen
 * kippen in dieselbe Richtung, und das Auge liest das Ganze als gedrehtes
 * Rechteck. Gemessen an einem Raum 3,50 × 3,54 m lagen 98 % der Rohrlänge
 * schräg zur Wand.
 *
 * **Die Verteilung, die hier gewählt ist:** das Rohr rückt dort ein, wo es
 * ohnehin quer durch den Raum läuft. Formal bekommt jede Kante den Anteil am
 * Einrücken, der ihrer Ausdehnung *senkrecht* zur Hauptrichtung entspricht.
 * Kanten parallel zur Hauptrichtung bekommen damit exakt null — die Bahnen
 * entlang der langen Wände liegen wandparallel, Millimeter für Millimeter.
 * Das Einrücken sammelt sich an den Kehren, und dort gehört es hin: dort
 * wechselt das Rohr ohnehin die Bahn.
 *
 * Ein geschlossenes Polygon hat immer Querweg — sonst wäre es keine
 * geschlossene Figur —, die Summe kann also nur im entarteten Fall null
 * werden.
 *
 * @returns Kumulierte Anteile, `cum[0] = 0` … `cum[n] = 1`.
 */
function driftProfile(poly: readonly Vec2[], directionRad: number): number[] {
  const n = poly.length;
  const sin = Math.sin(directionRad);
  const cos = Math.cos(directionRad);
  const quer: number[] = [];
  let summe = 0;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const q = Math.abs(-(b.x - a.x) * sin + (b.y - a.y) * cos);
    quer.push(q);
    summe += q;
  }
  const cum: number[] = [0];
  if (summe < 1e-9) {
    for (let i = 0; i < n; i++) cum.push((i + 1) / n);
    return cum;
  }
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += quer[i] / summe;
    cum.push(acc);
  }
  // Rundungsfehler dürfen den letzten Umlauf nicht anschneiden.
  cum[n] = 1;
  return cum;
}

/**
 * Die Schnecke als eine durchgehende Kurve — oder `null`, wenn die Form sie
 * nicht trägt.
 *
 * Der Hinweg rückt je Umlauf um **zwei** Verlegeabstände ein, der Rückweg
 * läuft um einen Verlegeabstand versetzt wieder heraus. Dadurch liegt zwischen
 * zwei Windungen des Hinwegs genau eine Windung des Rückwegs — die bifilare
 * Verlegung.
 *
 * Geführt wird die Kurve nicht über die Bogenlänge, sondern **Kante für
 * Kante**: für Kante `j` sagt `cum`, bei welchem Umlaufmaß sie beginnt und
 * endet, und die Kurve läuft auf der Kontur, die zu diesem Maß gehört. Wo
 * `cum` flach ist — auf jeder Kante parallel zur Hauptrichtung —, ist die
 * Kontur über die ganze Kante dieselbe, und das Kurvenstück ist damit
 * *exakt* ein Stück dieser Kontur: wandparallel per Konstruktion, nicht per
 * Näherung.
 *
 * Die Kehre in der Mitte ist der Übergang vom Hin- auf den Rückweg beim
 * selben Umlaufmaß; sie ist genau einen Verlegeabstand lang und läuft radial.
 */
function buildSpiral(
  poly: readonly Vec2[],
  field: Field,
  spacing: number,
  edge: number,
  directionRad: number,
): { points: Vec2[]; coreArea: number } | null {
  const flaecheAussen = signedArea(poly);
  if (flaecheAussen <= 0) return null;

  // Größte tragfähige Einrückung suchen: erst grob in Schritten eines halben
  // Verlegeabstands vortasten, dann die Grenze einschachteln. Ein einfaches
  // Durchprobieren in feinen Schritten wäre bei großen Räumen unnötig teuer.
  const traegt = (d: number) => contour(poly, field, d, flaecheAussen) !== null;
  if (!traegt(edge)) return null;
  let gut = edge;
  let schlecht = Number.NaN;
  for (let d = edge + spacing / 2; d < 1e3; d += spacing / 2) {
    if (traegt(d)) gut = d;
    else {
      schlecht = d;
      break;
    }
  }
  if (!Number.isFinite(schlecht)) return null;
  for (let i = 0; i < 8; i++) {
    const mid = (gut + schlecht) / 2;
    if (traegt(mid)) gut = mid;
    else schlecht = mid;
  }
  // Die innerste noch tragfähige Kontur ist entartet — sie hat rechnerisch
  // Fläche, aber keine Breite mehr. Um einen vollen Verlegeabstand
  // zurückgenommen, ist der Bereich innerhalb der innersten Windung noch
  // mindestens zwei Verlegeabstände breit. Das ist die Bedingung dafür, dass
  // sich die Schnecke nicht selbst einholt: sie rückt je halbem Umlauf um
  // einen Verlegeabstand ein, und wäre der Kern schmaler, träfe die Windung
  // auf ihre eigene Gegenseite.
  const maxInset = gut - spacing;
  const kern = maxInset > edge ? contour(poly, field, maxInset, flaecheAussen) : null;
  if (!kern) return null;
  const coreArea = signedArea(kern);

  // Umläufe des Hinwegs. Unter einem vollen Umlauf ist es keine Schnecke,
  // sondern ein Ring — dann taugt der Mäander besser.
  const umlaeufe = (maxInset - edge) / (2 * spacing);
  if (umlaeufe < 1) return null;

  const cache = new Map<number, Vec2[] | null>();
  const konturBei = (d: number): Vec2[] | null => {
    const key = Math.round(d * 10000);
    const vorhanden = cache.get(key);
    if (vorhanden !== undefined) return vorhanden;
    const c = contour(poly, field, d, flaecheAussen);
    cache.set(key, c);
    return c;
  };

  const n = poly.length;
  const cum = driftProfile(poly, directionRad);

  /**
   * Ein Zug von außen nach innen bis zum Umlaufmaß `gMax`, um `versatz` nach
   * innen verschoben. `versatz = 0` ist der Hinweg, `versatz = a` der Rückweg.
   */
  const zug = (versatz: number, gMax: number): Vec2[] | null => {
    const out: Vec2[] = [];
    for (let umlauf = 0; umlauf <= Math.ceil(gMax) + 1; umlauf++) {
      for (let j = 0; j < n; j++) {
        const g0 = umlauf + cum[j];
        const g1 = umlauf + cum[j + 1];
        if (g0 >= gMax) return out;
        const tauMax = g1 <= gMax ? 1 : (gMax - g0) / (g1 - g0);
        // Ohne Einrücken genügen die beiden Endpunkte: das Stück liegt exakt
        // auf einer Kontur und ist damit eine Gerade.
        const teile =
          g1 > g0 + 1e-12
            ? Math.max(2, Math.ceil(distance(poly[j], poly[(j + 1) % n]) / SPIRAL_DRIFT_STEP))
            : 1;
        for (let k = out.length === 0 ? 0 : 1; k <= teile; k++) {
          const tau = (k / teile) * tauMax;
          const c = konturBei(edge + versatz + 2 * spacing * (g0 + (g1 - g0) * tau));
          if (!c) return null;
          out.push(lerp(c[j], c[(j + 1) % n], tau));
        }
        if (tauMax < 1) return out;
      }
    }
    return out;
  };

  const hin = zug(0, umlaeufe);
  // Der Rückweg endet einen Umlauf früher: die innerste Windung gehört allein
  // dem Hinweg, dort liegt die Kehre.
  const rueck = zug(spacing, umlaeufe - 1);
  if (!hin || !rueck || hin.length < 2 || rueck.length < 2) return null;

  const punkte = [...hin, ...rueck.reverse()];

  // Letzte Gegenprobe an der fertigen Kurve: jeder Punkt und jede
  // Sehnenmitte muss in der belegbaren Fläche liegen. Die Konturen sind
  // einzeln geprüft, aber eine Sehne über eine einspringende Ecke könnte
  // trotzdem hinauslaufen.
  for (let i = 0; i < punkte.length; i++) {
    if (!isLayable(field, punkte[i], VALIDATION_SLACK)) return null;
    if (i > 0) {
      const m = lerp(punkte[i - 1], punkte[i], 0.5);
      if (!isLayable(field, m, VALIDATION_SLACK)) return null;
    }
  }
  return { points: punkte, coreArea };
}

// ---------------------------------------------------------------------------
// Bahnen, Kreise, Kurven
// ---------------------------------------------------------------------------

/** Eine gerade Rohrbahn im gedrehten Bezugssystem. */
interface Bahn {
  /** Nummer der Schnittlinie, 0 = erste. */
  row: number;
  y: number;
  x0: number;
  x1: number;
  length: number;
}

const round = (n: number, digits: number): number => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

const leerErgebnis = (
  requestedPattern: FloorLoopPattern,
  spacing: number,
  edge: number,
  obstacleClearance: number,
  minRunLength: number,
  direction: number,
  grossArea: number,
  layableArea: number,
  requestedLoops: number,
  maxCircuitLength: number,
  manifoldConnected: boolean,
  notes: FloorLoopNote[],
): FloorLoopLayout => ({
  pattern: requestedPattern,
  requestedPattern,
  spacing,
  edgeClearance: edge,
  obstacleClearance,
  minRunLength,
  direction,
  grossArea: round(grossArea, 2),
  layableArea: round(layableArea, 2),
  loops: 0,
  requestedLoops,
  curves: [],
  supplyLines: [],
  fieldLength: 0,
  totalLength: 0,
  supplyLength: 0,
  circuitLength: 0,
  maxCircuitLength,
  manifoldConnected,
  complete: false,
  notes,
});

/**
 * Darf die Schlange von Bahn `a` nach Bahn `b` weiterlaufen?
 *
 * Drei Bedingungen, und alle drei sind nötig:
 *
 *  1. **Benachbarte Schnittlinien.** Eine Kehre überspringt keine Zeile.
 *     Ohne diese Bedingung sucht sich der Zug irgendeinen freien Weg quer
 *     durch den Raum und läuft dabei über schon verlegte Bahnen hinweg —
 *     zwei Rohre in derselben Estrichebene, die es nicht geben kann.
 *  2. **Überlappende Abschnitte.** Sonst wäre die Kehre keine Kehre, sondern
 *     eine Diagonale durch die Fläche.
 *  3. **Innerhalb der belegbaren Fläche.** Bei schrägen Wänden ist auch eine
 *     kurze Kehre nicht selbstverständlich.
 *
 * Die Kehre selbst ist immer die Gerade zwischen den beiden Bahnenden.
 * Rechtwinklige Umwege wären verlockend, wenn die Gerade nicht passt — sie
 * liefen aber zwangsläufig ein Stück auf einer der beiden Bahnen entlang,
 * also Rohr auf Rohr. Passt die Gerade nicht, bricht der Zug ab.
 */
function darfVerbinden(field: Field, a: Bahn, b: Bahn, from: Vec2, to: Vec2, step: number): boolean {
  if (Math.abs(a.row - b.row) !== 1) return false;
  if (Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) <= 0) return false;
  return segmentLayable(field, from, to, step);
}

/**
 * Liegt die ganze Strecke in der belegbaren Fläche?
 *
 * Die Endpunkte selbst sind ausgenommen: sie liegen auf der Grenze und
 * würden je nach Rundung mal drinnen, mal draußen liegen. Geprüft wird das
 * Innere in Schritten des Abtastmaßes, mindestens an drei Stellen.
 */
function segmentLayable(field: Field, a: Vec2, b: Vec2, step: number): boolean {
  const len = distance(a, b);
  if (len < 1e-9) return true;
  const n = Math.max(3, Math.ceil(len / step));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    if (!isLayable(field, p, VALIDATION_SLACK)) return false;
  }
  return true;
}

/**
 * Kurven an den Verteiler anschließen.
 *
 * **Zwei Dinge geschehen hier, und beide sind fachlich, nicht kosmetisch.**
 *
 * Erstens wird jede Kurve so herum gedreht, dass sie an dem Ende beginnt, das
 * dem Verteiler zugewandt ist. Eine Verlegekurve ist ein Rohr; sie rückwärts
 * zu durchlaufen ergibt dieselbe Verlegung. Welches Ende der Anfang ist,
 * entscheidet deshalb nicht die Rechnung, sondern der Verteiler — sonst
 * kreuzt die Anbindeleitung den halben Raum, um zum falschen Ende zu kommen.
 *
 * Zweitens entsteht die Anbindeleitung. Sie ist die Luftlinie vom Verteiler
 * zum Kurvenanfang, doppelt gezählt für Vor- und Rücklauf. Was sie nicht ist:
 * die tatsächliche Trasse. Die läuft an den Wänden entlang und ist länger —
 * deshalb ist die Kreislänge eine untere Schranke, und deshalb steht das in
 * `notes` und nicht im Kleingedruckten.
 *
 * Ohne Verteiler geschieht nichts von beidem, und `notes` sagt warum. Eine
 * Anbindung an einen Punkt, den niemand gesetzt hat, wäre erfunden.
 */
function anbinden(
  curves: FloorLoopCurve[],
  manifold: Vec2 | undefined,
): { supplyLines: FloorSupplyLine[]; supplyLength: number } {
  if (!manifold) return { supplyLines: [], supplyLength: 0 };
  const supplyLines: FloorSupplyLine[] = [];
  let supplyLength = 0;
  for (const curve of curves) {
    const pts = curve.points;
    if (pts.length < 2) continue;
    if (distance(manifold, pts[pts.length - 1]) < distance(manifold, pts[0])) pts.reverse();
    const weg = distance(manifold, pts[0]);
    const laenge = 2 * weg;
    supplyLines.push({
      loop: curve.loop,
      points: [{ ...manifold }, { ...pts[0] }],
      length: round(laenge, 2),
    });
    supplyLength += laenge;
  }
  return { supplyLines, supplyLength };
}

/**
 * Meldungen zur Anbindung — der Teil, den die Zeichnung allein nicht sagt.
 */
function anbindeHinweise(
  notes: FloorLoopNote[],
  manifold: Vec2 | undefined,
  supplyLength: number,
  circuitLength: number,
  loops: number,
  maxCircuitLength: number,
): void {
  if (!manifold) {
    notes.push({
      severity: 'warn',
      text:
        'Kein Heizkreisverteiler im Geschoss — ein Heizkreis beginnt und endet aber am Verteiler. ' +
        'Die Kurve fängt deshalb an einer beliebigen Raumecke an, und in der Kreislänge fehlt die ' +
        'Anbindeleitung. Verteiler setzen: TGA → Heizung → Heizkreisverteiler.',
    });
    return;
  }
  notes.push({
    severity: 'info',
    text:
      `Anbindeleitung zum Verteiler: ${zahl(round(supplyLength, 1))} m Rohr für Vor- und Rücklauf, ` +
      `Kreislänge damit ${zahl(round(circuitLength, 1))} m. Gemessen ist die kürzeste Verbindung ` +
      'Verteiler–Kurvenanfang; die verlegte Trasse läuft an den Wänden entlang und ist länger. Die ' +
      'Kreislänge ist damit eine untere Schranke.',
  });
  if (maxCircuitLength > 0 && circuitLength > maxCircuitLength * loops) {
    notes.push({
      severity: 'warn',
      text:
        `${zahl(round(circuitLength, 1))} m Kreislänge auf ${loops} ${loops === 1 ? 'Kreis' : 'Kreise'} ` +
        `überschreiten die angesetzten ${zahl(maxCircuitLength)} m je Kreis. Der Raum liegt weit vom ` +
        'Verteiler entfernt oder ist zu groß für diese Kreiszahl — mehr Kreise, größere Nennweite oder ' +
        'ein näher gesetzter Verteiler.',
    });
  }
}

/**
 * Verlegekurve(n) für ein Raumpolygon.
 *
 * @param polygon lichtes Raumpolygon [m] — nicht das Achspolygon; der
 *   Randabstand wird davon aus gemessen
 */
export function planFloorLoops(polygon: readonly Vec2[], options: FloorLoopOptions = {}): FloorLoopLayout {
  const spacing = options.spacing ?? 0.15;
  const edge = Math.max(0, options.edgeClearance ?? DEFAULT_EDGE_CLEARANCE);
  const obstacleClearance = Math.max(0, options.obstacleClearance ?? DEFAULT_OBSTACLE_CLEARANCE);
  const minRunLength = Math.max(0, options.minRunLength ?? DEFAULT_MIN_RUN_LENGTH);
  const pattern = options.pattern ?? DEFAULT_LOOP_PATTERN;
  const requestedLoops = Math.max(1, Math.round(options.loops ?? 1));
  const manifold = options.manifold;
  const maxCircuitLength = Math.max(0, options.maxCircuitLength ?? DEFAULT_MAX_CIRCUIT_LENGTH);
  const notes: FloorLoopNote[] = [];

  const grossArea = polygon.length >= 3 ? polygonArea(polygon) : 0;

  if (polygon.length < 3 || grossArea < 1e-6) {
    notes.push({ severity: 'error', text: 'Ohne Raumfläche lässt sich nichts verlegen — das Polygon hat keine Ausdehnung.' });
    return leerErgebnis(pattern, spacing, edge, obstacleClearance, minRunLength, 0, 0, 0, requestedLoops, maxCircuitLength, manifold !== undefined, notes);
  }
  if (!(spacing > 0)) {
    notes.push({ severity: 'error', text: 'Ein Verlegeabstand von null oder weniger ergibt keine Bahnen.' });
    return leerErgebnis(pattern, spacing, edge, obstacleClearance, minRunLength, 0, grossArea, 0, requestedLoops, maxCircuitLength, manifold !== undefined, notes);
  }

  const direction = options.direction ?? mainAxisDirection(polygon);
  const rad = (direction * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // In das Bezugssystem der Bahnen drehen: dort laufen sie waagerecht, und
  // eine Schnittlinie ist eine Zeile. Zurückgedreht wird erst das Ergebnis.
  const local = (p: Vec2): Vec2 => ({ x: p.x * cos + p.y * sin, y: -p.x * sin + p.y * cos });
  const world = (p: Vec2): Vec2 => ({ x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos });

  const field: Field = {
    poly: polygon.map(local),
    obstacles: (options.obstacles ?? []).filter((o) => o.length >= 3).map((o) => o.map(local)),
    edge,
    obstacleClearance,
  };

  const b = polygonBounds(field.poly);
  const step = sampleStep(spacing);
  const yLo = b.minY + edge;
  const yHi = b.maxY - edge;

  const areaRows = Math.max(1, Math.ceil((yHi - yLo) / (spacing / 4)));
  const layableArea = integrateLayableArea(field, areaRows, yLo, yHi, b.minX, b.maxX, step);

  if (yHi <= yLo || layableArea < 1e-4) {
    notes.push({
      severity: 'error',
      text:
        `Nach ${zahl(edge * 100)} cm Randabstand bleibt keine belegbare Fläche übrig — der Raum ist dafür zu schmal. ` +
        'Randabstand verringern oder den Raum von Hand belegen.',
    });
    return leerErgebnis(pattern, spacing, edge, obstacleClearance, minRunLength, direction, grossArea, layableArea, requestedLoops, maxCircuitLength, manifold !== undefined, notes);
  }

  // --- Schnecke: eine durchgehende Spirale aus Konturen --------------------
  // Sie wird nur versucht, wo sie überhaupt eine sein kann. Danach entscheidet
  // nicht die Absicht, sondern die Gegenprobe: hält die Kurve die Faustregel
  // Fläche/Verlegeabstand nicht ein, ist irgendwo ein Loch, und dann wird der
  // Mäander gelegt und gesagt warum.
  if (pattern === 'schnecke') {
    const hindernis =
      requestedLoops > 1
        ? 'Eine Schnecke läuft von außen bis in die Mitte und lässt sich nicht in zwei Kreise teilen, ohne dass beide bis in die Raummitte geführt werden. Der Raum wird deshalb in Streifen geteilt und jeder Streifen als Mäander gelegt.'
        : field.obstacles.length > 0
          ? 'Um die Einbauten in diesem Raum herum ist die Fläche nicht mehr ringförmig; eine Schnecke müsste sie umfahren. Gelegt wird ein Mäander.'
          : null;
    if (hindernis) {
      notes.push({ severity: 'info', text: hindernis });
    } else {
      // `offsetPolygonPerEdge` setzt CCW voraus — sonst versetzt es nach außen.
      const ccw = signedArea(polygon) >= 0 ? polygon.map((q) => ({ ...q })) : polygon.map((q) => ({ ...q })).reverse();
      /**
       * Die Schnecke beginnt an der Ecke, mit der das Polygon anfängt — und
       * die ist willkürlich. Steht ein Verteiler, wird die Ecknummerierung so
       * gedreht, dass sie an der ihm nächsten Ecke beginnt: der Kurvenanfang
       * liegt dann auf der dem Verteiler zugewandten Seite und die
       * Anbindeleitung läuft nicht quer durch den Raum.
       */
      const startEcke = manifold
        ? ccw.reduce((best, q, i) => (distance(q, manifold) < distance(ccw[best], manifold) ? i : best), 0)
        : 0;
      const gedreht = startEcke === 0 ? ccw : [...ccw.slice(startEcke), ...ccw.slice(0, startEcke)];
      const spirale = buildSpiral(
        gedreht,
        { poly: gedreht, obstacles: [], edge, obstacleClearance },
        spacing,
        edge,
        rad,
      );
      const laenge = spirale ? polylineLength(spirale.points) : 0;
      // Angenommen wird nicht nach Länge, sondern nach Lücke: die Schnecke
      // läuft von außen nach innen, und das einzige, was sie auslassen kann,
      // ist der Kern in der Mitte — dort, wo die versetzten Konturen entartet
      // sind. Ein Längenvergleich taugt hier nicht: eine Schnecke ist von
      // Natur aus rund ein Zehntel kürzer als Fläche/Verlegeabstand, weil die
      // äußerste Windung schon nach innen wandert, während sie den Raum
      // umrundet. Der Kern dagegen ist die Lücke, die man im Plan sieht.
      const kernGrenze = Math.max(4 * spacing * spacing, 0.05 * layableArea);
      if (spirale && spirale.coreArea <= kernGrenze) {
        // Die gezeichnete Schnecke ist regelmäßig kürzer als Fläche durch
        // Verlegeabstand, und das ist kein Fehler: die äußerste Windung wandert
        // schon nach innen, während sie den Raum umrundet, und in der Mitte
        // bleibt der Kern der letzten Kehre. Wer die Zahlen nebeneinander
        // sieht, soll den Unterschied erklärt bekommen, statt ihn für einen
        // Rechenfehler zu halten. Maßgebend für Kreisaufteilung und Leistung
        // bleibt der Rechenkern, nicht die gezeichnete Länge.
        const soll = layableArea / spacing;
        if (soll > 0 && (soll - laenge) / soll > 0.05) {
          notes.push({
            severity: 'info',
            text:
              `Die Schnecke ist ${zahl(round(laenge, 1))} m lang; aus Fläche und Verlegeabstand folgen ${zahl(round(soll, 1))} m. ` +
              `Der Unterschied steckt in der äußersten Windung, die schon einrückt, während sie den Raum umläuft, und im Kern ` +
              `von ${zahl(round(spirale.coreArea, 2))} m² in der Raummitte. Für Kreisaufteilung und Leistung gilt die Auslegung, nicht die gezeichnete Länge.`,
          });
        }
        // Bei der Schnecke gibt es keine Verbindungsstücke: die ganze Kurve
        // liegt in der Fläche, deshalb sind Feldlänge und Gesamtlänge gleich.
        const schneckenKurven: FloorLoopCurve[] = [
          {
            loop: 1,
            part: 1,
            points: spirale.points.map((q) => ({ x: round(q.x, 4), y: round(q.y, 4) })),
            length: round(laenge, 2),
            fieldLength: round(laenge, 2),
            area: round(laenge * spacing, 2),
          },
        ];
        const anschluss = anbinden(schneckenKurven, manifold);
        const kreislaenge = laenge + anschluss.supplyLength;
        anbindeHinweise(notes, manifold, anschluss.supplyLength, kreislaenge, 1, maxCircuitLength);
        return {
          pattern: 'schnecke',
          requestedPattern: pattern,
          spacing,
          edgeClearance: edge,
          obstacleClearance,
          minRunLength,
          direction: round(direction, 2),
          grossArea: round(grossArea, 2),
          layableArea: round(layableArea, 2),
          loops: 1,
          requestedLoops,
          curves: schneckenKurven,
          supplyLines: anschluss.supplyLines,
          fieldLength: round(laenge, 2),
          totalLength: round(laenge, 2),
          supplyLength: round(anschluss.supplyLength, 2),
          circuitLength: round(kreislaenge, 2),
          maxCircuitLength,
          manifoldConnected: manifold !== undefined,
          complete: true,
          notes,
        };
      }
      notes.push({
        severity: 'info',
        text: spirale
          ? `Die Schnecke ließe in der Raummitte ${zahl(round(spirale.coreArea, 1))} m² unbelegt — die nach innen ` +
            `versetzten Konturen entarten, bevor sie die Mitte erreichen (zulässig wären ${zahl(round(kernGrenze, 1))} m²). ` +
            `Gelegt wird ein Mäander. Zur Einordnung: die Schnecke wäre ${zahl(round(laenge, 1))} m lang geworden.`
          : 'Diese Raumform trägt keine Schnecke: die nach innen versetzten Konturen laufen ineinander. Gelegt wird ein Mäander.',
      });
    }
  }

  // Bahnenschar mittig in das belegbare Band legen: dann ist der Abstand zur
  // ersten und zur letzten Wand gleich groß und nie kleiner als der Randabstand.
  const band = yHi - yLo;
  const rowCount = Math.floor(band / spacing) + 1;
  const y0 = yLo + (band - (rowCount - 1) * spacing) / 2;

  const bahnen: Bahn[] = [];
  for (let r = 0; r < rowCount; r++) {
    const y = y0 + r * spacing;
    for (const s of scanRow(field, y, b.minX, b.maxX, step)) {
      const len = s.x1 - s.x0;
      if (len < minRunLength) continue;
      bahnen.push({ row: r, y, x0: s.x0, x1: s.x1, length: len });
    }
  }

  if (bahnen.length === 0) {
    notes.push({
      severity: 'error',
      text:
        `Keine Bahn wird ${zahl(minRunLength * 100)} cm lang — bei ${zahl(spacing * 100)} cm Verlegeabstand ist für diesen ` +
        'Raum keine Schlange darstellbar.',
    });
    return leerErgebnis(pattern, spacing, edge, obstacleClearance, minRunLength, direction, grossArea, layableArea, requestedLoops, maxCircuitLength, manifold !== undefined, notes);
  }

  // --- Kreise als Bänder ---------------------------------------------------
  // Ein zweiter Heizkreis bekommt nicht jede zweite Bahn, sondern einen
  // eigenen Streifen des Raums. Das ist die Verlegung, die man tatsächlich
  // baut, und sie garantiert nebenbei, dass sich zwei Kreise nicht
  // überlagern: verschiedene Kreise benutzen verschiedene Schnittlinien, und
  // die liegen mindestens einen Verlegeabstand auseinander.
  const rowsUsed = [...new Set(bahnen.map((x) => x.row))].sort((p, q) => p - q);
  const loops = Math.min(requestedLoops, rowsUsed.length);
  if (loops < requestedLoops) {
    notes.push({
      severity: 'warn',
      text: `${requestedLoops} Kreise gefordert, aber nur ${rowsUsed.length} Bahnen vorhanden — es werden ${loops} Kreise gelegt.`,
    });
  }
  const totalRun = bahnen.reduce((s, x) => s + x.length, 0);
  const target = totalRun / loops;
  const bandOfRow = new Map<number, number>();
  let acc = 0;
  for (const r of rowsUsed) {
    const rowLen = bahnen.filter((x) => x.row === r).reduce((s, x) => s + x.length, 0);
    // Die Bahn wird dem Kreis zugeschlagen, in dessen Sollbereich ihre Mitte
    // fällt — sonst kippt eine einzelne lange Bahn den ganzen Schnitt.
    bandOfRow.set(r, Math.min(loops - 1, Math.floor((acc + rowLen / 2) / target)));
    acc += rowLen;
  }

  const curves: FloorLoopCurve[] = [];
  let complete = true;

  for (let loopIndex = 0; loopIndex < loops; loopIndex++) {
    const eigene = bahnen.filter((x) => bandOfRow.get(x.row) === loopIndex);
    if (eigene.length === 0) continue;
    const stuecke = buildRuns(field, eigene, step, manifold ? local(manifold) : undefined);
    if (stuecke.length > 1) complete = false;
    stuecke.forEach((zug, i) => {
      const pts = zug.points.map(world);
      curves.push({
        loop: loopIndex + 1,
        part: i + 1,
        points: pts.map((p) => ({ x: round(p.x, 4), y: round(p.y, 4) })),
        length: round(polylineLength(pts), 2),
        fieldLength: round(zug.fieldLength, 2),
        area: round(zug.fieldLength * spacing, 2),
      });
    });
  }

  const angelegt = new Set(curves.map((c) => c.loop)).size;
  if (!complete) {
    notes.push({
      severity: 'warn',
      text:
        `Die Fläche zerfällt in ${curves.length} nicht verbundene Bereiche — meist um einen Einbau an der Wand herum, ` +
        'der eine Bahn in zwei Abschnitte teilt. Im Plan stehen deshalb mehrere Kurvenstücke, und jedes braucht eine ' +
        'eigene Anbindung zum Verteiler. Wer weniger Anbindungen will, teilt den Raum von Hand oder rückt den Einbau.',
    });
  }
  const fieldLength = curves.reduce((s, c) => s + c.fieldLength, 0);
  const totalLength = curves.reduce((s, c) => s + c.length, 0);

  // Erst jetzt, mit fertigen Kurven: Laufrichtung am Verteiler ausrichten und
  // die Anbindeleitungen bilden.
  const anschluss = anbinden(curves, manifold);
  const circuitLength = totalLength + anschluss.supplyLength;
  anbindeHinweise(notes, manifold, anschluss.supplyLength, circuitLength, Math.max(1, angelegt), maxCircuitLength);

  // Gegenprobe zur Faustregel 1/Verlegeabstand: sie muss aufgehen, sonst
  // stimmt entweder die Fläche oder die Bahnenschar nicht.
  const erwartet = layableArea / spacing;
  if (erwartet > 0 && Math.abs(fieldLength - erwartet) / erwartet > 0.15) {
    notes.push({
      severity: 'info',
      text:
        `In der Fläche liegen ${zahl(round(fieldLength, 1))} m Rohr; aus Fläche und Verlegeabstand folgen ` +
        `${zahl(round(erwartet, 1))} m. Die Abweichung kommt von Nischen, die keine volle Bahn mehr tragen.`,
    });
  }

  return {
    pattern: 'maeander',
    requestedPattern: pattern,
    spacing,
    edgeClearance: edge,
    obstacleClearance,
    minRunLength,
    direction: round(direction, 2),
    grossArea: round(grossArea, 2),
    layableArea: round(layableArea, 2),
    loops: angelegt,
    requestedLoops,
    curves,
    supplyLines: anschluss.supplyLines,
    fieldLength: round(fieldLength, 2),
    totalLength: round(totalLength, 2),
    supplyLength: round(anschluss.supplyLength, 2),
    circuitLength: round(circuitLength, 2),
    maxCircuitLength,
    manifoldConnected: manifold !== undefined,
    complete: complete && angelegt === requestedLoops,
    notes,
  };
}

/** Zusammenhängende Züge aus einer Bahnenmenge. */
interface Run {
  points: Vec2[];
  fieldLength: number;
}

/**
 * Bahnen zu Zügen verketten.
 *
 * **Warum nicht einfach Zeile für Zeile.** Bei einer U-Form zerfällt jede
 * Schnittlinie oberhalb des Einschnitts in zwei Abschnitte. Wer sie in der
 * Reihenfolge links–rechts–links–rechts verkettet, springt bei jedem Wechsel
 * über die Wand dazwischen und bricht den Zug — aus einem Raum werden
 * Dutzende Bruchstücke.
 *
 * Deshalb zuerst eine **Zellenzerlegung**: eine Zelle ist ein Bereich, über
 * den die Bahnen eins zu eins von Zeile zu Zeile durchlaufen. Wo sich eine
 * Bahn aufspaltet oder zwei zusammenlaufen, endet die Zelle und es beginnen
 * neue. Innerhalb einer Zelle liegt je Zeile genau eine Bahn, die sich mit
 * der darunter überlappt — dort ist die Schlange immer verkettbar. Beim
 * Übergang von einer Zelle zur nächsten wird die Verbindung geprüft: geht
 * sie, läuft der Zug weiter (die U-Form wird also unten und in einem Schenkel
 * am Stück gelegt); geht sie nicht, beginnt ein neues Stück, statt eine
 * Kurve durch die Wand zu erfinden.
 *
 * `startNahe` — der Verteiler im gedrehten Bezugssystem — entscheidet, an
 * welchem Ende die erste Bahn angefahren wird. Das ist nicht dasselbe wie die
 * fertige Kurve umzudrehen: bei einer geraden Bahnenzahl liegen Anfang und
 * Ende des Mäanders auf *derselben* Seite des Raums, und Umdrehen bringt den
 * Anfang deshalb nie auf die andere Seite. Die Seite entscheidet sich hier
 * oder gar nicht.
 */
function buildRuns(field: Field, bahnen: readonly Bahn[], step: number, startNahe?: Vec2): Run[] {
  const nachZeile = new Map<number, Bahn[]>();
  for (const b of bahnen) {
    const list = nachZeile.get(b.row);
    if (list) list.push(b);
    else nachZeile.set(b.row, [b]);
  }
  for (const list of nachZeile.values()) list.sort((a, b) => a.x0 - b.x0);
  const zeilen = [...nachZeile.keys()].sort((a, b) => a - b);

  const zellen: Bahn[][] = [];
  let vorher: { bahn: Bahn; zelle: number }[] = [];
  const ueberlappt = (a: Bahn, b: Bahn) => Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 0;

  for (const r of zeilen) {
    const jetzt = nachZeile.get(r) ?? [];
    const anschluss = vorher.filter((v) => v.bahn.row === r - 1);
    const naechste: { bahn: Bahn; zelle: number }[] = [];
    for (const b of jetzt) {
      const vorgaenger = anschluss.filter((v) => ueberlappt(v.bahn, b));
      let zelle = -1;
      // Fortgesetzt wird nur bei eindeutiger Zuordnung in beide Richtungen —
      // sonst ist es eine Verzweigung oder ein Zusammenlauf.
      if (vorgaenger.length === 1) {
        const nachfolger = jetzt.filter((x) => ueberlappt(vorgaenger[0].bahn, x));
        if (nachfolger.length === 1) zelle = vorgaenger[0].zelle;
      }
      if (zelle < 0) {
        zelle = zellen.length;
        zellen.push([]);
      }
      zellen[zelle].push(b);
      naechste.push({ bahn: b, zelle });
    }
    vorher = naechste;
  }

  const runs: Run[] = [];
  let points: Vec2[] = [];
  let laenge = 0;
  let cursor: Vec2 | null = null;
  const abschliessen = () => {
    if (points.length >= 2) runs.push({ points, fieldLength: laenge });
    points = [];
    laenge = 0;
  };

  let letzte: Bahn | null = null;
  for (const zelle of zellen) {
    for (const bahn of zelle) {
      const e1 = { x: bahn.x0, y: bahn.y };
      const e2 = { x: bahn.x1, y: bahn.y };
      if (cursor === null || letzte === null) {
        // Erste Bahn: an dem Ende einsteigen, das dem Verteiler zugewandt ist.
        const vonE1 = startNahe ? distance(startNahe, e1) <= distance(startNahe, e2) : true;
        points = vonE1 ? [e1, e2] : [e2, e1];
        laenge = bahn.length;
        cursor = points[1];
        letzte = bahn;
        continue;
      }
      // Am näher liegenden Ende einsteigen und bis zum anderen durchfahren —
      // so wird jede Bahn ganz belegt, und die Laufrichtung wechselt von
      // selbst, ohne Sonderfall für „gerade" und „ungerade".
      const zuE1 = distance(cursor, e1) <= distance(cursor, e2);
      const nah: Vec2 = zuE1 ? e1 : e2;
      const fern: Vec2 = zuE1 ? e2 : e1;
      if (darfVerbinden(field, letzte, bahn, cursor, nah, step)) {
        points.push(nah, fern);
        laenge += bahn.length;
      } else {
        abschliessen();
        points = [nah, fern];
        laenge = bahn.length;
      }
      cursor = fern;
      letzte = bahn;
    }
  }
  abschliessen();
  return runs;
}

function polylineLength(points: readonly Vec2[]): number {
  let sum = 0;
  for (let i = 1; i < points.length; i++) sum += distance(points[i - 1], points[i]);
  return sum;
}

/** Zahl in deutscher Schreibweise für die Meldungstexte. */
function zahl(n: number): string {
  return n.toLocaleString('de-DE', { maximumFractionDigits: 1 });
}

// ---------------------------------------------------------------------------
// Einbauten
// ---------------------------------------------------------------------------

/**
 * Grundriss eines TGA-Objekts als Rechteck im Modellraum.
 *
 * Die Symbolik führt Baulänge und Bautiefe um die Objektmitte, gedreht um
 * `rotation`. Genau dieses Rechteck ist die Fläche, unter der kein Rohr
 * liegt — mehr Genauigkeit wäre Schein: eine Badewanne steht ohnehin nie
 * millimetergenau da, wo sie gezeichnet ist.
 */
export function fixtureFootprint(fixture: {
  position: Vec2;
  rotation: number;
  length: number;
  depth: number;
}): Vec2[] {
  const rad = (fixture.rotation * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const hx = fixture.length / 2;
  const hy = Math.max(fixture.depth, 0.05) / 2;
  const ecken: Vec2[] = [
    { x: -hx, y: -hy },
    { x: hx, y: -hy },
    { x: hx, y: hy },
    { x: -hx, y: hy },
  ];
  return ecken.map((p) => ({
    x: fixture.position.x + p.x * c - p.y * s,
    y: fixture.position.y + p.x * s + p.y * c,
  }));
}
