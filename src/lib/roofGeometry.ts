/**
 * Dachgeometrie — die ortsabhängige Raumhöhe unter einer Schräge.
 * ---------------------------------------------------------------------------
 * Im Dachgeschoss stimmt nichts mehr, was im Regelgeschoss selbstverständlich
 * ist: Das Luftvolumen ist nicht Fläche × Höhe, eine Außenwand ist nicht
 * Länge × Geschosshöhe, und die Decke ist keine waagerechte Fläche, sondern
 * eine geneigte mit Giebeln an den Enden. Wer das Dachgeschoss wie ein
 * Regelgeschoss rechnet, bekommt zu viel Volumen (Lüftungsverlust zu hoch)
 * und zu viel Wandfläche (Transmission zu hoch) — bei gleichzeitig fehlender
 * Dachfläche, dem größten Verlustweg überhaupt.
 *
 * Deshalb wird hier alles über *eine* Funktion abgeleitet: die Höhe h(p) an
 * jedem Punkt des Grundrisses. Volumen, Dachfläche, Wandflächen und die
 * Wohnfläche nach WoFlV sind Integrale über diese Funktion.
 *
 * Die Integration läuft numerisch über ein Raster. Das ist bewusst gewählt:
 * eine geschlossene Lösung müsste das Raumpolygon an jeder Höhenlinie
 * zerschneiden — viel Code für Fälle, die in der Praxis nie auftreten. Das
 * Raster ist bei 5 cm auf zwei Nachkommastellen genau und bleibt bei
 * beliebig verwinkelten Räumen richtig.
 */

import type { RoofDefinition, RoofOpening, RoomRoofMetrics, Vec2 } from '../types/bim';
import { pointInPolygon, polygonArea } from './geometry';

const TO_RAD = Math.PI / 180;

/** Rasterweite der numerischen Integration [m]. */
export const ROOF_SAMPLE_STEP = 0.05;

// ---------------------------------------------------------------------------
// Der Gebäudeumriss als Rechengrundlage
// ---------------------------------------------------------------------------

/**
 * Eine Kante des Gebäudeumrisses, für den Punkt-Strecken-Abstand vorbereitet.
 *
 * **Warum vorberechnet.** Die Raumerkennung rastert das Dach mit 5 cm; ein
 * Zimmer von 20 m² sind 8000 Rasterpunkte, und für jeden wird der Abstand zu
 * *jeder* Umrisskante gebraucht — beim Walmdach für die Höhe, beim Sattel- und
 * Pultdach für die Traufe, und noch einmal für die Himmelsrichtung der
 * Dachfläche. Richtungsvektor und Längenquadrat je Kante immer wieder neu zu
 * bilden wäre der ganze Unterschied zwischen „unmerklich" und „das Werkzeug
 * hakt beim Zeichnen". Sie ändern sich nur mit dem Grundriss, also gehören sie
 * in den Rahmen und nicht in die Schleife.
 */
interface UmrissKante {
  ax: number;
  ay: number;
  /** b − a. */
  dx: number;
  dy: number;
  /** |b − a|², nie 0 (Nullkanten werden beim Aufbau verworfen). */
  len2: number;
  /** Außennormale, normiert. Gilt nur für einen Umriss gegen den Uhrzeigersinn. */
  nx: number;
  ny: number;
}

/**
 * Bereitet die Kanten eines Umrisspolygons auf.
 *
 * Die Außennormale folgt aus dem Umlaufsinn: bei CCW zeigt (dy, −dx) nach
 * außen. `gebaeudeUmriss` liefert genau diesen Umlaufsinn — deshalb steht die
 * Bedingung dort im Kommentar und hier in der Formel.
 */
function umrissKanten(umriss: readonly Vec2[]): UmrissKante[] {
  const kanten: UmrissKante[] = [];
  const n = umriss.length;
  if (n < 3) return kanten;
  for (let i = 0; i < n; i++) {
    const a = umriss[i];
    const b = umriss[(i + 1) % n];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1e-12) continue;
    const len = Math.sqrt(len2);
    kanten.push({ ax: a.x, ay: a.y, dx, dy, len2, nx: dy / len, ny: -dx / len });
  }
  return kanten;
}

/**
 * Quadrierter Abstand eines Punktes zu *einer* Umrisskante — Punkt zu
 * Strecke, nicht zu Gerade.
 *
 * Quadriert, weil beide Aufrufer unten nur Abstände *vergleichen*: Bei acht
 * Kanten und 8000 Rasterpunkten je Zimmer sind das 64 000 Wurzeln, von denen
 * genau eine gebraucht wird. Gezogen wird sie deshalb erst am Ende, außerhalb
 * der Kantenschleife.
 */
function abstandQuadratZuKante(k: UmrissKante, px: number, py: number): number {
  let u = ((px - k.ax) * k.dx + (py - k.ay) * k.dy) / k.len2;
  // Die Begrenzung auf [0,1] ist der ganze Unterschied zur Geraden: ohne sie
  // läge ein Punkt im Innenwinkel eines L näher an der *Verlängerung* einer
  // weit entfernten Kante als an der Kante, die wirklich neben ihm liegt.
  if (u < 0) u = 0;
  else if (u > 1) u = 1;
  const qx = k.ax + k.dx * u - px;
  const qy = k.ay + k.dy * u - py;
  return qx * qx + qy * qy;
}

/**
 * Kleinster Abstand zum Rand des Umrisses.
 *
 * Das ist die Höhenfunktion des Walmdachs, bis auf Kniestock und Steigung:
 * ein Walm steigt von *jeder* Traufkante mit derselben Neigung an, also liegt
 * die Dachhaut über jedem Punkt so hoch, wie dieser Punkt von der nächsten
 * Kante entfernt ist. Grate und Kehlen entstehen dabei von selbst — dort, wo
 * zwei Kanten gleich nah sind. Das ist genau das Straight Skeleton, nur ohne
 * dass eines gebaut werden müsste.
 */
function abstandZumRand(kanten: readonly UmrissKante[], p: Vec2): number {
  let best = Infinity;
  for (let i = 0; i < kanten.length; i++) {
    const d = abstandQuadratZuKante(kanten[i], p.x, p.y);
    if (d < best) best = d;
  }
  return best === Infinity ? Infinity : Math.sqrt(best);
}

/** Die Umrisskante, die einem Punkt am nächsten liegt — sie trägt die Dachfläche. */
function naechsteKante(kanten: readonly UmrissKante[], p: Vec2): UmrissKante | undefined {
  let best: UmrissKante | undefined;
  let bestD = Infinity;
  for (let i = 0; i < kanten.length; i++) {
    const d = abstandQuadratZuKante(kanten[i], p.x, p.y);
    if (d < bestD) {
      bestD = d;
      best = kanten[i];
    }
  }
  return best;
}

/**
 * Weg von `p` bis zum Umriss, gemessen in Richtung (fx, fy).
 *
 * Für Sattel- und Pultdach: dort fällt das Dach in einer festen Richtung, und
 * die Traufe liegt da, wo der Grundriss in dieser Richtung endet. Bei einem
 * L-Grundriss ist das je nach Punkt verschieden weit — genau diese Strecke
 * ersetzt die feste Halbspannweite des umschließenden Rechtecks.
 *
 * Genommen wird der *erste* Austritt. Ein Strahl durch einen einspringenden
 * Grundriss kann ihn wieder betreten; die Traufe ist trotzdem die erste Kante,
 * an der das Gebäude aufhört. Gezählt wird deshalb nur, wo der Strahl nach
 * *außen* durchtritt — erkennbar daran, dass er mit der Außennormalen der
 * Kante einen spitzen Winkel bildet.
 *
 * Genau diese Bedingung macht auch den Randfall richtig: `wallProfileUnderRoof`
 * integriert die Wandhöhe **auf der Wandachse**, also auf dem Umriss selbst.
 * Dort ist der Weg bis zur Traufe null, und ohne die Prüfung auf die
 * Durchtrittsrichtung wäre nicht zu unterscheiden, ob der Strahl die Kante
 * unter den Füßen gerade verlässt oder in das Gebäude hinein zeigt. Im ersten
 * Fall steht die Wand an der Traufe, im zweiten trägt sie den Giebel — und
 * die beiden Flächen bekommen verschiedene U-Werte.
 *
 * `Infinity`, wenn der Strahl keine Kante trifft — dann liegt der Punkt
 * außerhalb des Umrisses, und der Aufrufer bleibt bei der Rechteckformel.
 */
function randAbstandInRichtung(
  kanten: readonly UmrissKante[],
  p: Vec2,
  fx: number,
  fy: number,
): number {
  let best = Infinity;
  for (const k of kanten) {
    // Nur Kanten, durch die der Strahl nach außen tritt. Das schließt
    // zugleich den parallelen Fall aus: dort steht der Strahl senkrecht auf
    // der Normalen, und die Nachbarkanten fangen ihn auf.
    if (fx * k.nx + fy * k.ny <= 1e-12) continue;
    const nenner = fx * k.dy - fy * k.dx;
    if (Math.abs(nenner) < 1e-12) continue;
    const diffx = k.ax - p.x;
    const diffy = k.ay - p.y;
    const u = (diffx * k.dy - diffy * k.dx) / nenner;
    // Eine winzige Toleranz nach unten: ein Punkt genau auf der Kante soll
    // null herausbekommen und nicht den Austritt auf der Gegenseite.
    if (u < -1e-6 || u >= best) continue;
    const v = (diffx * fy - diffy * fx) / nenner;
    if (v < -1e-9 || v > 1 + 1e-9) continue;
    best = u > 0 ? u : 0;
  }
  return best;
}

/**
 * Der höchste Punkt eines Walmdachs: die Stelle mit dem größten Abstand zum
 * Rand — der Mittelpunkt des größten einbeschriebenen Kreises.
 *
 * **Warum gesucht und nicht gerechnet.** Geschlossen lässt sich diese Stelle
 * nur über das Straight Skeleton bestimmen, und das zu bauen ist genau der
 * Aufwand, den die Abstandsformel oben vermeidet. Gesucht wird deshalb: ein
 * Raster über den Umriss, danach ein Nachführen aus dem besten Rasterpunkt
 * heraus mit halbierender Schrittweite.
 *
 * Das Raster hat mindestens 40 Schritte über die schmalere Seite. Es muss nur
 * fein genug sein, um den richtigen „Berg" zu treffen — ein Grundriss, dessen
 * breiteste Stelle schmaler ist als ein Vierzigstel seiner kleineren
 * Bounding-Box-Seite, ist kein Gebäude mehr. Das Nachführen bringt die Stelle
 * danach auf unter einen Millimeter, und ein Millimeter am First ist bei jeder
 * Neigung unter 89° weniger als ein Millimeter Höhe.
 */
function hoechsterPunkt(
  kanten: readonly UmrissKante[],
  umriss: readonly Vec2[],
): { punkt: Vec2; abstand: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of umriss) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  const schritt = Math.max(0.02, Math.min(maxX - minX, maxY - minY) / 40);
  let punkt: Vec2 = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  let abstand = -1;

  for (let y = minY + schritt / 2; y < maxY; y += schritt) {
    for (let x = minX + schritt / 2; x < maxX; x += schritt) {
      const q = { x, y };
      if (!pointInPolygon(q, umriss)) continue;
      const d = abstandZumRand(kanten, q);
      if (d > abstand) {
        abstand = d;
        punkt = q;
      }
    }
  }
  // Kein einziger Rasterpunkt im Umriss: ein entarteter oder winziger
  // Grundriss. Dann ist der First die Traufe, und das ist die ehrliche
  // Antwort — nicht ein aus der Bounding Box geratener Wert.
  if (abstand < 0) return { punkt, abstand: 0 };

  let weite = schritt;
  for (let runde = 0; runde < 200 && weite > 1e-4; runde++) {
    let besser = false;
    for (let i = 0; i < 8; i++) {
      const w = (i * Math.PI) / 4;
      const q = { x: punkt.x + Math.cos(w) * weite, y: punkt.y + Math.sin(w) * weite };
      if (!pointInPolygon(q, umriss)) continue;
      const d = abstandZumRand(kanten, q);
      if (d > abstand) {
        abstand = d;
        punkt = q;
        besser = true;
      }
    }
    if (!besser) weite /= 2;
  }

  return { punkt, abstand };
}

/**
 * Vorberechneter Bezugsrahmen eines Daches: Richtung, Firstachse und die
 * Ausdehnung des Grundrisses in Neigungsrichtung. Einmal je Geschoss gebildet,
 * danach ist `roofHeightAt` reine Arithmetik.
 */
export interface RoofFrame {
  roof: RoofDefinition;
  /** Einheitsvektor in Fallrichtung (weg vom First). */
  dir: Vec2;
  /** Einheitsvektor längs des Firsts. */
  along: Vec2;
  /** Mittelpunkt des Grundrisses. */
  centre: Vec2;
  /** Lage der Firstachse, gemessen als Projektion auf `dir` ab `centre` [m]. */
  ridgeT: number;
  /** Ausdehnung des Grundrisses in Fall- und Firstrichtung ab `centre` [m]. */
  halfSpanT: number;
  halfSpanS: number;
  /** Höhe der Firstlinie über Rohfußboden [m]. */
  ridgeHeight: number;
  /** Steigung tan(pitch) — pro Meter Horizontalabstand. */
  slope: number;
  /** Gauben und Dachflächenfenster dieses Geschosses. */
  openings: RoofOpening[];
  /**
   * Der Gebäudeumriss als geordnetes Polygon gegen den Uhrzeigersinn.
   * Leer heißt: keiner bekannt — dann rechnet alles wie vor 1.26.0 auf dem
   * umschließenden Rechteck. Siehe `gebaeudeUmriss` in `roomDetection.ts`.
   */
  umriss: Vec2[];
  /** Derselbe Umriss, kantenweise für den Abstandstest vorbereitet. */
  kanten: UmrissKante[];
  /**
   * Der höchste Punkt der Dachfläche. Beim Walmdach mit Umriss die Stelle mit
   * dem größten Randabstand, sonst der Punkt der Firstachse im Mittelpunkt.
   */
  firstPunkt: Vec2;
}

/**
 * Baut den Bezugsrahmen aus der Dachdefinition und den Eckpunkten des
 * Geschossgrundrisses. Ohne Punkte oder ohne Neigung gibt es kein Dach —
 * dann liefert die Funktion `null` und alle Aufrufer rechnen wie bisher.
 *
 * `outline` ist eine **Punktwolke** — je Wand Anfangs- und Endknoten, mit
 * Duplikaten und ohne Reihenfolge. Daraus entsteht nur das umschließende
 * Rechteck, und das ist die Rückfallebene: sie bleibt für jeden Aufrufer
 * erhalten, der keinen geordneten Umriss beschaffen kann.
 *
 * `umriss` ist der geordnete Gebäudeumriss aus `gebaeudeUmriss`. Liegt er vor,
 * rechnet das Walmdach auf ihm statt auf dem Rechteck — und erst dann bekommt
 * ein L-förmiges Haus seine Kehle, statt dass das Dach über den Innenwinkel
 * hinwegläuft. Er steht bewusst hinten und hat einen Vorgabewert: die
 * Signatur bleibt damit für alle bisherigen Aufrufer gültig.
 */
/** Vorgabe der oberen, flachen Neigung eines Mansarddachs [°]. */
export const MANSARD_OBEN_VORGABE = 30;
/** Vorgabe der Knickhöhe eines Mansarddachs über Rohfußboden [m]. */
export const MANSARD_KNICK_VORGABE = 2.2;
/** Vorgabe des abgewalmten Anteils am Giebel eines Krüppelwalmdachs [-]. */
export const KRUEPPELWALM_VORGABE = 0.5;

/**
 * Der Mansardknick: wo er waagerecht liegt und wie hoch der First darüber wird.
 *
 * `spann` ist der waagerechte Weg von der Firstachse bis zur Traufe, `knee`
 * der Kniestock, `slope` die Steigung der **unteren**, steilen Fläche.
 *
 * Zurück kommt der Abstand des Knicks von der Firstachse (`abstand`), seine
 * Höhe (`hoehe`) und die daraus folgende Firsthöhe. Liegt der Knick unter dem
 * Kniestock oder weiter außen als die Traufe, gibt es keinen — dann steht der
 * Knick auf der Traufe und das Dach ist ein Satteldach mit der steilen
 * Neigung. Dieser Grenzfall wird ausgerechnet und nicht abgefangen: Eine
 * Sonderbehandlung hätte an der Grenze einen Sprung, die Formel hat keinen.
 */
export function mansardKnick(
  roof: RoofDefinition,
  spann: number,
  knee: number,
  slope: number,
): { abstand: number; hoehe: number; ridgeHeight: number; slopeOben: number } {
  const obenGrad = Math.min(
    Math.max(roof.upperPitch ?? MANSARD_OBEN_VORGABE, 0),
    Math.max(roof.pitch - 0.1, 0),
  );
  const slopeOben = Math.tan(obenGrad * TO_RAD);
  const knickHoehe = Math.max(knee, roof.knickHeight ?? MANSARD_KNICK_VORGABE);

  // Waagerechter Weg von der Traufe bis zum Knick, begrenzt auf die
  // Spannweite: ein Knick jenseits der Traufe ist keiner.
  const vonTraufe = slope > 1e-9 ? (knickHoehe - knee) / slope : 0;
  const abstandVonFirst = Math.max(0, spann - Math.min(Math.max(0, vonTraufe), spann));
  const hoehe = knee + (spann - abstandVonFirst) * slope;

  return {
    abstand: abstandVonFirst,
    hoehe,
    ridgeHeight: hoehe + abstandVonFirst * slopeOben,
    slopeOben,
  };
}

export function buildRoofFrame(
  roof: RoofDefinition | undefined,
  outline: readonly Vec2[],
  openings: readonly RoofOpening[] = [],
  umriss: readonly Vec2[] = [],
): RoofFrame | null {
  // `flat` heißt: keine Schräge, waagerechte Decke — dafür gibt es keinen
  // Rahmen. `flat-sloped` dagegen *hat* ein Gefälle und braucht einen.
  if (!roof || roof.kind === 'flat') return null;
  if (!(roof.pitch > 0) || roof.pitch >= 89) return null;
  if (outline.length < 3) return null;

  const a = roof.azimuth * TO_RAD;
  const dir = { x: Math.sin(a), y: Math.cos(a) };
  const along = { x: dir.y, y: -dir.x };

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of outline) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const centre = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };

  let minT = Infinity;
  let maxT = -Infinity;
  let minS = Infinity;
  let maxS = -Infinity;
  for (const p of outline) {
    const dx = p.x - centre.x;
    const dy = p.y - centre.y;
    const t = dx * dir.x + dy * dir.y;
    const s = dx * along.x + dy * along.y;
    minT = Math.min(minT, t);
    maxT = Math.max(maxT, t);
    minS = Math.min(minS, s);
    maxS = Math.max(maxS, s);
  }

  const halfSpanT = (maxT - minT) / 2;
  const halfSpanS = (maxS - minS) / 2;
  const slope = Math.tan(roof.pitch * TO_RAD);
  const knee = Math.max(0, roof.kneeHeight);

  const umrissPolygon = umriss.length >= 3 ? umriss.map((p) => ({ x: p.x, y: p.y })) : [];
  const kanten = umrissKanten(umrissPolygon);

  let ridgeT: number;
  let rise: number;
  // Vorbelegung für alle Fälle ohne eigenen Firstpunkt: der Punkt der
  // Firstachse in der Mitte des Grundrisses. Beim Walmdach mit Umriss wird er
  // unten durch die wirklich höchste Stelle ersetzt.
  let firstPunkt: Vec2 | undefined;

  if (roof.kind === 'monopitch' || roof.kind === 'flat-sloped') {
    // Pultdach: der First sitzt an der oberen Kante, das Dach fällt in
    // Richtung `azimuth` bis zur gegenüberliegenden Traufe.
    //
    // Das Flachdach mit Gefälle rechnet identisch — es *ist* ein Pultdach,
    // nur mit zwei bis fünf Grad statt fünfzehn. Der eigene Aufzählungswert
    // steht nicht für eine andere Geometrie, sondern für eine andere Sache:
    // Ein Flachdach hat eine Attika, eine innenliegende Entwässerung und im
    // Bauantrag einen anderen Namen. Wer es als Pultdach einträgt, bekommt
    // dieselbe Höhe und die falsche Auskunft.
    ridgeT = minT;
    rise = (maxT - minT) * slope;
  } else if (roof.kind === 'mansard') {
    /*
     * Mansarddach: zwei Neigungen mit einem Knick dazwischen.
     *
     * Gerechnet wird von der Traufe nach oben, weil dort die bekannten Maße
     * liegen — Kniestock und steile Neigung:
     *
     *   Waagerechter Weg bis zum Knick:  a = (Knickhöhe − Kniestock) / tan(steil)
     *   Waagerechter Weg vom Knick zum First:  b = Spannweite − a
     *   Firsthöhe = Knickhöhe + b · tan(flach)
     *
     * Liegt der Knick tiefer als der Kniestock oder weiter außen als die
     * Traufe, gibt es keinen Knick: dann bleibt es beim Satteldach mit der
     * steilen Neigung. Das ist kein Sonderfall, sondern der Grenzfall — und
     * er muss stimmen, sonst steht der First über dem Nichts.
     */
    ridgeT = roof.ridgeOffset;
    const spann = Math.max(ridgeT - minT, maxT - ridgeT);
    const knick = mansardKnick(roof, spann, knee, slope);
    rise = knick.ridgeHeight - knee;
  } else if (roof.kind === 'hip' && kanten.length >= 3) {
    // Walmdach über einem bekannten Umriss: Die Firsthöhe ist kein Ergebnis
    // der Gebäudeseiten mehr, sondern des größten Randabstands — das ist die
    // Stelle, an der sich alle Walme treffen. Bei einem Rechteck kommt dabei
    // die halbe kürzere Seite heraus, also genau die alte Formel; bei einem L
    // dagegen ein deutlich niedrigerer First, weil der schmale Schenkel
    // nirgends so weit vom Rand entfernt ist wie die Bounding Box glaubt.
    //
    // `ridgeOffset` bleibt die Lage der Firstachse und trennt weiterhin die
    // Gaubenseiten (`dormerSide`), verschiebt aber die Firsthöhe nicht mehr:
    // wo der First liegt, entscheidet beim Walmdach der Grundriss.
    ridgeT = roof.ridgeOffset;
    const hoch = hoechsterPunkt(kanten, umrissPolygon);
    rise = hoch.abstand * slope;
    firstPunkt = hoch.punkt;
  } else if (roof.kind === 'hip') {
    // Walmdach: von allen vier Seiten geneigt. Der First liegt mittig, seine
    // Höhe folgt der *kürzeren* Gebäudeseite — dort treffen sich die Walme.
    ridgeT = 0 + roof.ridgeOffset;
    rise = Math.min(halfSpanT, halfSpanS) * slope;
  } else {
    // Satteldach: First mittig, wahlweise versetzt. Beide Flächen haben
    // dieselbe Neigung, also bestimmt die *längere* Spannweite die Firsthöhe;
    // die kürzere Seite endet dann entsprechend höher als der Kniestock.
    //
    // Der Krüppelwalm rechnet hier mit: Sein First liegt genauso hoch wie der
    // eines Satteldachs derselben Neigung. Was ihn unterscheidet, ist allein
    // die abgeschrägte Giebelspitze — und die steht in der Höhenfunktion,
    // nicht in der Firsthöhe.
    ridgeT = roof.ridgeOffset;
    rise = Math.max(ridgeT - minT, maxT - ridgeT) * slope;
  }

  const ridgeHeight = Math.max(knee, knee + rise);

  return {
    roof,
    dir,
    along,
    centre,
    ridgeT,
    halfSpanT,
    halfSpanS,
    // Ein Dach, das flacher endet als die Geschosshöhe, ist zulässig — dann
    // steht der First unter der Rohdecke. Umgekehrt wird nicht gekappt: die
    // Geschosshöhe beschreibt hier den Kniestock, nicht den First.
    ridgeHeight,
    slope,
    openings: [...openings],
    umriss: umrissPolygon,
    kanten,
    firstPunkt: firstPunkt ?? {
      x: centre.x + dir.x * ridgeT,
      y: centre.y + dir.y * ridgeT,
    },
  };
}

/**
 * Höhe der Traufe über einem bekannten Umriss, in Fallrichtung gemessen.
 *
 * Sattel- und Pultdach haben eine *gerade* Firstlinie — das ist ihre
 * Definition, und daran ändert ein verwinkelter Grundriss nichts. Die Traufe
 * dagegen sitzt auf der Außenwand und folgt deshalb dem Umriss. Statt der
 * festen Halbspannweite des umschließenden Rechtecks wird hier je Punkt
 * gemessen, wie weit es in Fallrichtung bis zur Außenkante ist; von dort
 * steigt das Dach mit seiner Neigung an.
 *
 * Bei einem Rechteck, dessen Seiten in Fallrichtung liegen, kommt exakt die
 * bisherige Formel heraus. Erst wo der Grundriss einspringt, greift sie: dort
 * lag die Dachhaut bisher meterweit über der Wand, auf der sie aufliegen soll.
 *
 * `Infinity` heißt „keine Aussage" — ohne Umriss oder wenn der Strahl den
 * Umriss nicht trifft. Der Aufrufer bildet das Minimum, also bleibt es dann
 * bei der Rechteckformel.
 */
function traufhoeheInFallrichtung(frame: RoofFrame, p: Vec2, t: number): number {
  if (frame.kanten.length < 3) return Infinity;
  // Talwärts: beim Pultdach immer in `dir`, beim Satteldach je nach Seite des
  // Firsts. Ohne dieses Vorzeichen würde die eine Dachhälfte am First
  // gemessen statt an ihrer Traufe.
  const einseitig = frame.roof.kind === 'monopitch' || frame.roof.kind === 'flat-sloped';
  const seite = einseitig || t >= frame.ridgeT ? 1 : -1;
  const weg = randAbstandInRichtung(frame.kanten, p, frame.dir.x * seite, frame.dir.y * seite);
  if (!Number.isFinite(weg)) return Infinity;
  return Math.max(0, frame.roof.kneeHeight) + weg * frame.slope;
}

/**
 * Lichte Höhe der *reinen* Dachfläche, ohne Gauben. Sie wird für die Gauben
 * selbst gebraucht: eine Gaube setzt auf dem Dach auf und muss wissen, wo das
 * Dach unter ihr liegt.
 */
export function baseRoofHeightAt(frame: RoofFrame, p: Vec2): number {
  const dx = p.x - frame.centre.x;
  const dy = p.y - frame.centre.y;
  const t = dx * frame.dir.x + dy * frame.dir.y;

  let h: number;
  if (frame.roof.kind === 'hip' && frame.kanten.length >= 3) {
    // Walmdach über einem bekannten Umriss — die eine Zeile, um die es bei
    // diesem ganzen Umbau geht:
    //
    //     h(p) = Kniestock + Abstand(p, Umriss) · Steigung
    //
    // Sie ist die Höhenfunktion des Straight Skeleton. Grate entstehen dort,
    // wo zwei Kanten gleich weit weg sind, **Kehlen** im einspringenden
    // Winkel eines L — beides von selbst, ohne dass ein Skelett gebaut würde.
    // Die Firsthöhe ist kein Eingangswert mehr, sondern das Maximum dieser
    // Funktion; sie steht als `ridgeHeight` im Rahmen.
    h = Math.max(0, frame.roof.kneeHeight) + abstandZumRand(frame.kanten, p) * frame.slope;
  } else if (frame.roof.kind === 'monopitch' || frame.roof.kind === 'flat-sloped') {
    h = frame.ridgeHeight - Math.max(0, t - frame.ridgeT) * frame.slope;
    h = Math.min(h, traufhoeheInFallrichtung(frame, p, t));
  } else if (frame.roof.kind === 'mansard') {
    /*
     * Mansarddach: flach vom First bis zum Knick, darunter steil.
     *
     *          First
     *           /\            ← obere Fläche, `slopeOben`
     *          /  \
     *     ____/    \____      ← Knick bei `abstand` vom First
     *        |      |
     *        |      |          ← untere Fläche, `frame.slope` (steil)
     *
     * Der Knick wird aus denselben Eingangsgrößen gerechnet wie beim Aufbau
     * des Rahmens — nicht im Rahmen abgelegt und hier gelesen. Das kostet
     * eine Handvoll Rechenschritte je Punkt und erspart ein Feld, das mit
     * `roof` auseinanderlaufen kann, sobald jemand die Neigung ändert.
     */
    const d = Math.abs(t - frame.ridgeT);
    const knick = mansardKnick(frame.roof, frame.halfSpanT + Math.abs(frame.ridgeT), frame.roof.kneeHeight, frame.slope);
    h =
      d <= knick.abstand
        ? frame.ridgeHeight - d * knick.slopeOben
        : knick.hoehe - (d - knick.abstand) * frame.slope;
    h = Math.min(h, traufhoeheInFallrichtung(frame, p, t));
  } else if (frame.roof.kind === 'krueppelwalm') {
    /*
     * Krüppelwalmdach: Satteldach, dessen Giebelspitze abgewalmt ist.
     *
     * Die Höhenfunktion ist das **Minimum** aus zwei Schrägen — der des
     * Satteldachs quer zum First und der des Walms in Firstrichtung:
     *
     *     h(p) = min( First − |t − t₀| · Steigung,
     *                 Walmfuß + (halbe Firstlänge − |s|) · Steigung )
     *
     * Der Walmfuß ist die Höhe, in der die abgeschrägte Fläche auf die
     * senkrechte Giebelwand trifft. Bei `hipRatio` = 0 liegt er auf
     * Firsthöhe — dann greift die zweite Zeile nie und es bleibt ein
     * Satteldach. Bei 1 liegt er auf Kniestockhöhe: volles Walmdach. Genau
     * dazwischen liegt der Krüppelwalm, und zwar stetig, ohne Fallunter-
     * scheidung.
     *
     * Dass ein Minimum zweier Schrägen den Grat von selbst erzeugt, ist
     * dieselbe Eigenschaft, die das Walmdach über dem Umriss trägt — nur
     * hier mit zwei Flächen statt mit allen Kanten des Umrisses.
     */
    const anteil = Math.min(Math.max(frame.roof.hipRatio ?? KRUEPPELWALM_VORGABE, 0), 1);
    const knee = Math.max(0, frame.roof.kneeHeight);
    const walmfuss = frame.ridgeHeight - anteil * (frame.ridgeHeight - knee);
    const s = dx * frame.along.x + dy * frame.along.y;
    const giebel = frame.ridgeHeight - Math.abs(t - frame.ridgeT) * frame.slope;
    const walm = walmfuss + Math.max(0, frame.halfSpanS - Math.abs(s)) * frame.slope;
    h = Math.min(giebel, walm);
    h = Math.min(h, traufhoeheInFallrichtung(frame, p, t));
  } else if (frame.roof.kind === 'hip') {
    // Rückfallebene ohne Umriss: Abstand zur nächsten Traufkante im
    // gedrehten Rechteck.
    const s = dx * frame.along.x + dy * frame.along.y;
    const toEaveT = frame.halfSpanT - Math.abs(t - frame.ridgeT);
    const toEaveS = frame.halfSpanS - Math.abs(s);
    const nearest = Math.min(toEaveT, toEaveS);
    h =
      frame.ridgeHeight -
      (Math.min(frame.halfSpanT, frame.halfSpanS) - Math.max(0, nearest)) * frame.slope;
  } else {
    h = frame.ridgeHeight - Math.abs(t - frame.ridgeT) * frame.slope;
    h = Math.min(h, traufhoeheInFallrichtung(frame, p, t));
  }

  // Kehlbalkenlage: darüber wird die Decke waagerecht.
  const collar = frame.roof.collarHeight;
  if (typeof collar === 'number' && collar > 0) h = Math.min(h, collar);

  return Math.max(frame.roof.kneeHeight, h);
}

/**
 * Lage eines Punktes bezogen auf eine Gaube: liegt er in ihrer Grundfläche,
 * und wenn ja, wie weit ist er von der Gaubenfront entfernt (0 = Front,
 * 1 = Rückseite)? Gerechnet wird im Dach-Bezugssystem, damit die Gaube
 * automatisch in Fallrichtung ausgerichtet ist — schräg in der Dachfläche
 * sitzende Gauben gibt es am Bau nicht.
 */
function localToDormer(
  frame: RoofFrame,
  opening: RoofOpening,
  p: Vec2,
): { inside: boolean; along: number; lateral: number } {
  const dx = p.x - opening.position.x;
  const dy = p.y - opening.position.y;
  const t = dx * frame.dir.x + dy * frame.dir.y;
  const u = dx * frame.along.x + dy * frame.along.y;
  // Kleine Toleranz: die Richtungsvektoren kommen aus sin/cos und treffen
  // die Kante nie exakt. Ein Punkt genau auf der Gaubenkante fiele sonst je
  // nach Rundung mal hinein und mal heraus.
  const EDGE = 1e-6;
  const inside =
    Math.abs(t) <= opening.depth / 2 + EDGE && Math.abs(u) <= opening.width / 2 + EDGE;
  // Die Front liegt talwärts. Bei einem Satteldach hängt das davon ab, auf
  // welcher Seite des Firsts die Gaube sitzt: rechts davon fällt das Dach in
  // Richtung `dir`, links davon dagegen. Ohne dieses Vorzeichen zeigten alle
  // Gauben in dieselbe Richtung — die eine Hälfte davon in den Berg hinein.
  const side = dormerSide(frame, opening);
  const along = 0.5 - (t * side) / Math.max(opening.depth, 1e-6);
  // Seitliche Lage, 0 in der Mitte und 1 an der Wange — nur die Giebelgaube
  // braucht sie, weil ihre Front oben spitz zuläuft.
  const lateral = Math.min(1, Math.abs(u) / Math.max(opening.width / 2, 1e-6));
  return { inside, along: Math.max(0, Math.min(1, along)), lateral };
}

/**
 * Höhe der Gaubenoberkante an der Front, seitlich veränderlich.
 *
 * Die Schleppgaube hat eine waagerechte Oberkante. Die Giebelgaube läuft in
 * der Mitte spitz zu — genau das macht sie aus, und genau daraus folgen ihre
 * größere Front und ihr zweiflächiges Dach.
 */
export function dormerFrontHeightAt(opening: RoofOpening, lateral: number): number {
  const base = opening.frontHeight ?? 2.2;
  if (opening.kind !== 'dormer-gable') return base;
  return base + defaultGableRise(opening) * (1 - lateral);
}

/** Giebelhöhe der Gaube; ohne Angabe aus der Breite abgeleitet (rund 35°). */
export function defaultGableRise(opening: RoofOpening): number {
  if (typeof opening.gableRise === 'number') return Math.max(0, opening.gableRise);
  return (opening.width / 2) * Math.tan((35 * Math.PI) / 180);
}

/**
 * Auf welcher Dachseite sitzt die Öffnung? +1 = talwärts in `dir`,
 * −1 = talwärts entgegen `dir`.
 */
export function dormerSide(frame: RoofFrame, opening: { position: Vec2 }): 1 | -1 {
  if (frame.roof.kind === 'monopitch' || frame.roof.kind === 'flat-sloped') return 1;
  const dx = opening.position.x - frame.centre.x;
  const dy = opening.position.y - frame.centre.y;
  const t = dx * frame.dir.x + dy * frame.dir.y;
  return t >= frame.ridgeT ? 1 : -1;
}

/** Front- und Rückpunkt einer Gaube auf der Dachfläche. */
export function dormerFrontBack(
  frame: RoofFrame,
  opening: RoofOpening,
): { front: Vec2; back: Vec2 } {
  const side = dormerSide(frame, opening);
  const half = (opening.depth / 2) * side;
  return {
    front: {
      x: opening.position.x + frame.dir.x * half,
      y: opening.position.y + frame.dir.y * half,
    },
    back: {
      x: opening.position.x - frame.dir.x * half,
      y: opening.position.y - frame.dir.y * half,
    },
  };
}

/**
 * Lichte Höhe unter dem Dach, Gauben eingerechnet.
 *
 * Innerhalb einer Gaube läuft die Decke von der Frontkante (dort so hoch wie
 * die Gaube) linear zurück, bis sie das Hauptdach trifft. Das ist genau die
 * Geometrie einer Schleppgaube — und die Giebelgaube unterscheidet sich davon
 * im Grundriss nur in der Front, nicht in der lichten Höhe.
 */
export function roofHeightAt(frame: RoofFrame, p: Vec2): number {
  const base = baseRoofHeightAt(frame, p);
  let best = base;

  for (const opening of frame.openings) {
    if (opening.kind === 'skylight') continue;
    const local = localToDormer(frame, opening, p);
    if (!local.inside) continue;

    const front = dormerFrontHeightAt(opening, local.lateral);
    // Hinterkante: dort schließt die Gaube an das Hauptdach an.
    const back = baseRoofHeightAt(frame, dormerFrontBack(frame, opening).back);
    // `along` ist 0 an der Front und 1 an der Rückseite: dort trifft die
    // Gaubendecke wieder auf das Hauptdach.
    const h = front + (back - front) * local.along;
    if (h > best) best = h;
  }

  return best;
}


/**
 * Die Neigung der Dachfläche **an dieser Stelle** [°].
 *
 * **Warum das eine eigene Funktion ist.** Bis zum Mansarddach hatte jedes Dach
 * genau eine Neigung, und die geneigte Fläche war die projizierte geteilt
 * durch cos(Neigung) — eine Zahl für das ganze Dach. Die Mansarde hat zwei,
 * und der Unterschied ist nicht klein: 1/cos 70° = 2,92 gegen 1/cos 30° =
 * 1,15. Wer die steile Neigung auf die ganze Fläche anwendet, meldet die
 * obere Dachfläche zweieinhalbmal so groß, wie sie ist — und damit
 * zweieinhalbmal so viel Transmissionsverlust.
 *
 * Für jede andere Dachform gibt sie unverändert `roof.pitch` zurück. Das ist
 * Absicht: Die Zahlen aller bestehenden Projekte dürfen sich durch diese
 * Funktion nicht um ein Tausendstel bewegen.
 */
export function neigungAn(frame: RoofFrame, p: Vec2): number {
  if (frame.roof.kind !== 'mansard') return frame.roof.pitch;
  const dx = p.x - frame.centre.x;
  const dy = p.y - frame.centre.y;
  const d = Math.abs(dx * frame.dir.x + dy * frame.dir.y - frame.ridgeT);
  const knick = mansardKnick(
    frame.roof,
    frame.halfSpanT + Math.abs(frame.ridgeT),
    frame.roof.kneeHeight,
    frame.slope,
  );
  return d <= knick.abstand ? Math.atan(knick.slopeOben) / TO_RAD : frame.roof.pitch;
}

/** Liegt an diesem Punkt die waagerechte Kehlbalkendecke statt der Schräge? */
function isCollarZone(frame: RoofFrame, h: number): boolean {
  const collar = frame.roof.collarHeight;
  return typeof collar === 'number' && collar > 0 && h >= collar - 1e-6;
}

/**
 * Welche Dachfläche liegt über diesem Punkt? Für das Satteldach die Seite
 * links oder rechts des Firsts, für das Walmdach zusätzlich die beiden Walme.
 * Der Rückgabewert ist der Azimut der Dachfläche [°].
 *
 * Beim Walmdach über einem bekannten Umriss ist die Antwort nicht mehr
 * „eine von vier", sondern so viele Flächen, wie der Umriss Kanten hat: Jede
 * Traufkante trägt ihre eigene Dachfläche, und ihr Azimut ist deren
 * Außennormale. Bei einem L sind das sechs — und erst damit landen die
 * solaren Gewinne auf den Flächen, die es wirklich gibt.
 */
export function roofFaceAzimuthAt(frame: RoofFrame, p: Vec2): number {
  const dx = p.x - frame.centre.x;
  const dy = p.y - frame.centre.y;
  const t = dx * frame.dir.x + dy * frame.dir.y;
  const base = frame.roof.azimuth;

  // Einseitig geneigt: eine Fläche, ein Azimut.
  if (frame.roof.kind === 'monopitch' || frame.roof.kind === 'flat-sloped') return norm360(base);
  // Zwei Hauptflächen quer zum First. Das Mansarddach hat vier — je Seite die
  // steile unten und die flache oben —, aber beide zeigen in dieselbe
  // Richtung. Für den solaren Gewinn ist der Azimut die Frage, nicht die
  // Neigung, also sind es hier zwei.
  if (frame.roof.kind === 'gable' || frame.roof.kind === 'mansard') {
    return norm360(t >= frame.ridgeT ? base : base + 180);
  }
  if (frame.roof.kind === 'krueppelwalm') {
    /*
     * Krüppelwalm: zwei Hauptflächen wie beim Satteldach und zusätzlich die
     * beiden abgewalmten Giebelspitzen. Welche gilt, entscheidet dieselbe
     * Frage wie in der Höhenfunktion: Welche der beiden Schrägen liegt hier
     * tiefer? Wo der Walm gewinnt, zeigt die Fläche längs des Firsts.
     */
    const anteil = Math.min(Math.max(frame.roof.hipRatio ?? KRUEPPELWALM_VORGABE, 0), 1);
    const knee = Math.max(0, frame.roof.kneeHeight);
    const walmfuss = frame.ridgeHeight - anteil * (frame.ridgeHeight - knee);
    const sAchse = dx * frame.along.x + dy * frame.along.y;
    const giebel = frame.ridgeHeight - Math.abs(t - frame.ridgeT) * frame.slope;
    const walm = walmfuss + Math.max(0, frame.halfSpanS - Math.abs(sAchse)) * frame.slope;
    if (walm < giebel) return norm360(base + (sAchse >= 0 ? 270 : 90));
    return norm360(t >= frame.ridgeT ? base : base + 180);
  }

  if (frame.kanten.length >= 3) {
    const k = naechsteKante(frame.kanten, p);
    if (k) return norm360((Math.atan2(k.nx, k.ny) * 180) / Math.PI);
  }

  // Rückfallebene: die nächstgelegene der vier Traufkanten des gedrehten
  // Rechtecks bestimmt die Fläche.
  const s = dx * frame.along.x + dy * frame.along.y;
  const toEaveT = frame.halfSpanT - Math.abs(t - frame.ridgeT);
  const toEaveS = frame.halfSpanS - Math.abs(s);
  if (toEaveT <= toEaveS) return norm360(t >= frame.ridgeT ? base : base + 180);
  // `along` = (dir.y, −dir.x) zeigt nach Azimut `base + 90`: bei einem Dach,
  // das nach Norden fällt (base 0, dir = (0|1)), ist along = (1|0) und damit
  // Osten. Bis 1.26.0 stand hier `base − 90` für `s ≥ 0` — die beiden Walme
  // waren also um 180° vertauscht, und mit ihnen die solaren Gewinne der
  // Seitenflächen jedes Walmdachs. Bemerkt hat es nichts: für Walmdächer gab
  // es im ganzen Prüflauf keine einzige Zeile.
  return norm360(s >= 0 ? base + 90 : base - 90);
}

const norm360 = (deg: number): number => ((deg % 360) + 360) % 360;

/**
 * Rastert einen Raum unter dem Dach ab und liefert alle abgeleiteten
 * Kennwerte. `polygon` ist das lichte Innenpolygon des Raums.
 */
export function measureRoomUnderRoof(
  frame: RoofFrame,
  polygon: readonly Vec2[],
  step = ROOF_SAMPLE_STEP,
): RoomRoofMetrics {
  const area = Math.abs(polygonArea(polygon));
  if (polygon.length < 3 || area <= 0) {
    return {
      volume: 0,
      averageHeight: 0,
      minHeight: 0,
      maxHeight: 0,
      slopedArea: 0,
      slopedAreaByFace: [],
      flatCeilingArea: 0,
      gableArea: 0,
      livingArea: 0,
      areaBelow1m: 0,
      skylightArea: 0,
      dormerFrontArea: 0,
      dormerCheekArea: 0,
      dormerRoofArea: 0,
      dormerVolume: 0,
    };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of polygon) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }

  const cell = step * step;

  let hits = 0;
  let volume = 0;
  let living = 0;
  let below1 = 0;
  let sloped = 0;
  let flat = 0;
  let dormerFootprint = 0;
  let dormerVolume = 0;
  let dormerRoofSlope = 0;
  const byFace = new Map<number, number>();
  let minHeight = Infinity;
  let maxHeight = -Infinity;

  for (let y = minY + step / 2; y < maxY; y += step) {
    for (let x = minX + step / 2; x < maxX; x += step) {
      const p = { x, y };
      if (!pointInPolygon(p, polygon)) continue;
      hits++;

      // Reihenfolge und Fallunterscheidung sind Absicht: `roofHeightAt` ruft
      // `baseRoofHeightAt` selbst auf, und über einem Umriss kostet das einen
      // Durchlauf durch alle Umrisskanten. Ohne Gaube ist die lichte Höhe
      // ohnehin die Dachhöhe — dann darf sie nicht ein zweites Mal berechnet
      // werden, nur damit die Abfrage danach immer gleich aussieht.
      const base = baseRoofHeightAt(frame, p);
      const h = frame.openings.length === 0 ? base : roofHeightAt(frame, p);
      volume += h;
      // Was über der reinen Dachebene liegt, hat eine Gaube dazugewonnen.
      if (h > base + 1e-6) {
        dormerVolume += h - base;
        dormerFootprint += 1;
      }
      minHeight = Math.min(minHeight, h);
      maxHeight = Math.max(maxHeight, h);

      // WoFlV §4: über 2,00 m voll, 1,00 bis 2,00 m zur Hälfte, darunter nicht.
      if (h >= 2) living += 1;
      else if (h >= 1) living += 0.5;
      else below1 += 1;

      if (h > base + 1e-6) {
        // Über der Gaube liegt ihr eigenes Dach, nicht das Hauptdach. Die
        // Neigung ergibt sich aus dem Höhenunterschied über die Gaubentiefe.
        dormerRoofSlope += 1;
      } else if (isCollarZone(frame, h)) {
        flat += 1;
      } else {
        /*
         * Aufgeschlagen wird gleich hier, nicht erst am Ende.
         *
         * Die geneigte Fläche ist die projizierte geteilt durch cos(Neigung),
         * und die Neigung kann von Zelle zu Zelle verschieden sein — beim
         * Mansarddach ist sie es. Eine Summe roher Zellen und ein Kosinus
         * hinterher funktionierte nur, solange es eine Neigung gab.
         */
        const cos = Math.cos(neigungAn(frame, p) * TO_RAD) || 1;
        sloped += 1 / cos;
        // Nach Dachfläche getrennt zählen: die Himmelsrichtung einer
        // Dachfläche entscheidet über solare Gewinne und die Abschirmung.
        const face = Math.round(roofFaceAzimuthAt(frame, p));
        byFace.set(face, (byFace.get(face) ?? 0) + 1 / cos);
      }
    }
  }

  // Das Raster trifft die Fläche nur näherungsweise; skaliert auf die exakte
  // Polygonfläche bleiben Volumen und Teilflächen konsistent zur Grundfläche.
  const scale = hits > 0 ? area / (hits * cell) : 0;
  const f = cell * scale;

  return {
    volume: round2(volume * f),
    averageHeight: hits > 0 ? round3((volume / hits)) : 0,
    minHeight: Number.isFinite(minHeight) ? round3(minHeight) : 0,
    maxHeight: Number.isFinite(maxHeight) ? round3(maxHeight) : 0,
    // Der Kosinus steckt bereits in `sloped` und `byFace` — siehe oben.
    slopedArea: round2(sloped * f),
    slopedAreaByFace: [...byFace.entries()]
      .map(([azimuth, cells]) => ({ azimuth, area: round2(cells * f) }))
      .filter((e) => e.area > 0.01)
      .sort((a, b) => b.area - a.area),
    flatCeilingArea: round2(flat * f),
    gableArea: 0, // wird aus den Wandprofilen gefüllt, siehe wallProfileUnderRoof
    livingArea: round2(living * f),
    areaBelow1m: round2(below1 * f),
    ...dormerAndSkylightAreas(frame, polygon, {
      dormerFootprintArea: dormerFootprint * f,
      dormerRoofProjected: dormerRoofSlope * f,
      dormerVolume: dormerVolume * f,
    }),
  };
}

/**
 * Die Bauteilflächen von Gauben und Dachflächenfenstern.
 *
 * Die Grundflächen kommen aus dem Raster (sie folgen dem Raumzuschnitt), die
 * senkrechten Flächen dagegen aus der Geometrie der Gaube selbst — sie stehen
 * am Rand der Grundfläche und wären im Raster nur ungenau zu treffen.
 * Gezählt wird eine Gaube nur, wenn ihr Mittelpunkt in diesem Raum liegt;
 * sonst bekämen zwei Räume dieselbe Front angerechnet.
 */
function dormerAndSkylightAreas(
  frame: RoofFrame,
  polygon: readonly Vec2[],
  raster: { dormerFootprintArea: number; dormerRoofProjected: number; dormerVolume: number },
): Pick<
  RoomRoofMetrics,
  'skylightArea' | 'dormerFrontArea' | 'dormerCheekArea' | 'dormerRoofArea' | 'dormerVolume'
> {
  let skylight = 0;
  let front = 0;
  let cheek = 0;
  let dormerRoof = 0;

  for (const opening of frame.openings) {
    if (!pointInPolygon(opening.position, polygon)) continue;

    if (opening.kind === 'skylight') {
      // Das Fenster liegt *in* der Dachebene; Breite und Höhe sind bereits
      // dort gemessen, also keine Umrechnung über cos(Neigung).
      skylight += opening.width * opening.depth;
      continue;
    }

    const frontHeight = opening.frontHeight ?? 2.2;
    const { front: frontPoint, back: backPoint } = dormerFrontBack(frame, opening);
    const atFront = baseRoofHeightAt(frame, frontPoint);
    const atBack = baseRoofHeightAt(frame, backPoint);

    // Front: senkrechtes Rechteck zwischen Dachfläche und Gaubenoberkante.
    // Bei der Giebelgaube kommt das Dreieck der Giebelspitze dazu —
    // ½ · Breite · Giebelhöhe, unabhängig davon, wo die Gaube sitzt.
    const frontRise = Math.max(0, frontHeight - atFront);
    const gableRise = opening.kind === 'dormer-gable' ? defaultGableRise(opening) : 0;
    front += opening.width * frontRise + 0.5 * opening.width * gableRise;

    // Wangen: das Dreieck zwischen Gaubendecke und Hauptdach, zweimal.
    // Näherung über den mittleren Höhenunterschied — bei der Giebelgaube
    // etwas zu groß, bei der Schleppgaube exakt.
    const meanRise = Math.max(0, (frontRise + Math.max(0, frontHeight - atBack)) / 2);
    cheek += 2 * opening.depth * meanRise * 0.5;

    // Gaubendach: die geneigte Fläche von der Front nach hinten. Beim
    // Giebeldach kippt sie zusätzlich quer zur Firstlinie der Gaube; die
    // Querneigung vergrößert die Fläche um 1/cos(Querwinkel).
    const dz = Math.max(0, frontHeight - atBack);
    const lateralTilt =
      gableRise > 0 ? Math.cos(Math.atan2(gableRise, Math.max(opening.width / 2, 1e-6))) : 1;
    dormerRoof += (opening.width * Math.hypot(opening.depth, dz)) / (lateralTilt || 1);
  }

  return {
    skylightArea: round2(skylight),
    dormerFrontArea: round2(front),
    dormerCheekArea: round2(cheek),
    // Liegt keine Gaube mit ihrem Mittelpunkt im Raum, aber ragt eine herein,
    // bleibt wenigstens die gerasterte Dachfläche erhalten.
    dormerRoofArea: round2(dormerRoof > 0 ? dormerRoof : raster.dormerRoofProjected),
    dormerVolume: round2(raster.dormerVolume),
  };
}

/** Ergebnis der Integration entlang einer Wand unter dem Dach. */
export interface WallRoofProfile {
  /** Gesamte Wandfläche unter der Schräge [m²] = ∫ h(s) ds. */
  grossArea: number;
  /** Anteil bis Kniestockhöhe [m²] — die eigentliche Wand. */
  kneeArea: number;
  /** Anteil oberhalb des Kniestocks [m²] — der Giebel. */
  gableArea: number;
  minHeight: number;
  maxHeight: number;
}

/**
 * Integriert die Wandhöhe entlang eines Wandabschnitts.
 *
 * Getrennt ausgewiesen wird der Teil oberhalb der Traufe: das ist der Giebel,
 * der in der Praxis oft anders aufgebaut ist als die Wand darunter (Holz,
 * Vorhangfassade) und deshalb einen eigenen U-Wert bekommt.
 */
export function wallProfileUnderRoof(
  frame: RoofFrame,
  a: Vec2,
  b: Vec2,
  step = ROOF_SAMPLE_STEP,
): WallRoofProfile {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (length <= 1e-6) {
    return { grossArea: 0, kneeArea: 0, gableArea: 0, minHeight: 0, maxHeight: 0 };
  }

  const n = Math.max(2, Math.ceil(length / step));
  const ds = length / n;
  const knee = frame.roof.kneeHeight;

  let total = 0;
  let above = 0;
  let minHeight = Infinity;
  let maxHeight = -Infinity;

  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n;
    const p = { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
    const h = roofHeightAt(frame, p);
    total += h;
    above += Math.max(0, h - knee);
    minHeight = Math.min(minHeight, h);
    maxHeight = Math.max(maxHeight, h);
  }

  return {
    grossArea: round2(total * ds),
    kneeArea: round2((total - above) * ds),
    gableArea: round2(above * ds),
    minHeight: Number.isFinite(minHeight) ? round3(minHeight) : 0,
    maxHeight: Number.isFinite(maxHeight) ? round3(maxHeight) : 0,
  };
}

/**
 * Höhenlinie im Grundriss: die Punkte, an denen die lichte Höhe genau `h`
 * beträgt. Für die 1-m- und 2-m-Linie nach WoFlV, die im Plan eingezeichnet
 * werden — sie zeigen sofort, wo ein Dachraum noch nutzbar ist.
 *
 * Geliefert werden Strecken in Weltkoordinaten, lang genug, um über den
 * ganzen Grundriss zu reichen; der Zeichner klippt sie am Raumpolygon.
 *
 * **Bewusst nicht umgestellt auf den Umriss.** Beim Walmdach über einem
 * bekannten Umriss sind die Höhenlinien keine Geraden mehr, sondern
 * Parallelkurven zum Umriss — bei einem L mit einer einspringenden Ecke, an
 * der sie um den Innenwinkel herumlaufen. Das sauber zu erzeugen hieße, das
 * Polygon je Linie nach innen zu versetzen und die dabei entstehenden
 * Selbstüberschneidungen aufzulösen; `offsetPolygonPerEdge` kann das für
 * kleine Versätze, für die halbe Gebäudetiefe nicht.
 *
 * Der Preis ist bekannt und begrenzt: Diese Linien werden ausschließlich
 * gezeichnet, am Raumpolygon geklippt und beschriftet. In keine Zahl gehen
 * sie ein — Wohnfläche nach WoFlV, Fläche unter 1,00 m und Volumen kommen
 * alle aus dem 5-cm-Raster über `roofHeightAt` und damit über den Umriss. Im
 * Plan eines L-Hauses ist die Abweichung sichtbar, in der Rechnung nicht. Wer
 * sie beseitigen will, fängt bei einem echten Straight Skeleton an; bis dahin
 * ist eine falsche Linie mit richtiger Zahl besser als der Aufwand, den ihre
 * Beseitigung heute kostet.
 */
export function roofContourLines(frame: RoofFrame, height: number): { a: Vec2; b: Vec2 }[] {
  if (height <= frame.roof.kneeHeight || height >= frame.ridgeHeight) return [];

  const drop = frame.ridgeHeight - height;
  const distance = drop / frame.slope;
  const reach = Math.max(frame.halfSpanT, frame.halfSpanS) * 2 + 2;

  const ridgeOrigin = {
    x: frame.centre.x + frame.dir.x * frame.ridgeT,
    y: frame.centre.y + frame.dir.y * frame.ridgeT,
  };

  const lineAt = (offset: number) => ({
    a: {
      x: ridgeOrigin.x + frame.dir.x * offset - frame.along.x * reach,
      y: ridgeOrigin.y + frame.dir.y * offset - frame.along.y * reach,
    },
    b: {
      x: ridgeOrigin.x + frame.dir.x * offset + frame.along.x * reach,
      y: ridgeOrigin.y + frame.dir.y * offset + frame.along.y * reach,
    },
  });

  if (frame.roof.kind === 'monopitch' || frame.roof.kind === 'flat-sloped') {
    return [lineAt(distance)];
  }
  // Krüppelwalm und Mansarde: die Linien quer zum First zeichnen. Beim
  // Krüppelwalm fehlen damit die kurzen Stücke an den abgewalmten Spitzen,
  // bei der Mansarde sitzt die Linie oberhalb des Knicks etwas zu weit außen.
  // Dieselbe bewusste Grenze wie beim Walmdach über einem Umriss (siehe
  // oben): Diese Linien werden gezeichnet, nicht gerechnet.
  if (frame.roof.kind === 'gable' || frame.roof.kind === 'krueppelwalm' || frame.roof.kind === 'mansard') {
    return [lineAt(distance), lineAt(-distance)];
  }

  // Walmdach: rundum, also zusätzlich die beiden Linien längs des Firsts.
  const perpAt = (offset: number) => ({
    a: {
      x: ridgeOrigin.x + frame.along.x * offset - frame.dir.x * reach,
      y: ridgeOrigin.y + frame.along.y * offset - frame.dir.y * reach,
    },
    b: {
      x: ridgeOrigin.x + frame.along.x * offset + frame.dir.x * reach,
      y: ridgeOrigin.y + frame.along.y * offset + frame.dir.y * reach,
    },
  });
  return [lineAt(distance), lineAt(-distance), perpAt(distance), perpAt(-distance)];
}

/**
 * Die Firstlinie als Strecke — für Plan und Modell.
 *
 * **Warum das Walmdach hier eigens behandelt wird.** Bisher war die Firstlinie
 * immer `halfSpanS` lang, also so lang wie das umschließende Rechteck. Beim
 * Walmdach ist das falsch, und zwar sichtbar: Über einem Quadrat gibt es
 * überhaupt keinen First, sondern eine Spitze — das Dach ist eine Pyramide.
 * Die gezeichnete Linie behauptete trotzdem einen First über die halbe
 * Gebäudelänge, und daneben stand seine Höhe. Beides gelesen heißt: „hier
 * oben ist überall Stehhöhe", und das stimmt nur im Mittelpunkt.
 *
 * Mit Umriss läuft die Linie deshalb durch den *wirklich* höchsten Punkt und
 * wird dort gekappt, wo das Dach wieder fällt. Abgetastet wird in 5 cm, der
 * Rasterweite des ganzen Moduls; als „noch First" gilt, was höchstens 2 cm
 * unter der Firsthöhe liegt — auf dem Papier ist das eine halbe Strichstärke.
 *
 * Was sie **nicht** leistet: Der wahre First eines L-förmigen Walmdachs ist
 * ein verzweigter Kantenzug, kein Strich. Geliefert wird nur sein längster
 * gerader Ast. Das ist keine Vollständigkeit, aber es ist keine Behauptung
 * mehr über Stellen, an denen gar kein First liegt.
 */
export function ridgeLine(frame: RoofFrame): { a: Vec2; b: Vec2 } {
  if (frame.roof.kind === 'hip' && frame.kanten.length >= 3) {
    const o = frame.firstPunkt;
    const schritt = ROOF_SAMPLE_STEP;
    const grenze = frame.ridgeHeight - 0.02;
    const maxSchritte = Math.ceil((Math.max(frame.halfSpanT, frame.halfSpanS) * 2 + 2) / schritt);
    const bei = (u: number): Vec2 => ({
      x: o.x + frame.along.x * u,
      y: o.y + frame.along.y * u,
    });

    let vor = 0;
    while (vor < maxSchritte && baseRoofHeightAt(frame, bei((vor + 1) * schritt)) >= grenze) vor++;
    let zurueck = 0;
    while (zurueck < maxSchritte && baseRoofHeightAt(frame, bei(-(zurueck + 1) * schritt)) >= grenze) {
      zurueck++;
    }
    return { a: bei(-zurueck * schritt), b: bei(vor * schritt) };
  }

  const reach = frame.halfSpanS;
  const o = {
    x: frame.centre.x + frame.dir.x * frame.ridgeT,
    y: frame.centre.y + frame.dir.y * frame.ridgeT,
  };
  return {
    a: { x: o.x - frame.along.x * reach, y: o.y - frame.along.y * reach },
    b: { x: o.x + frame.along.x * reach, y: o.y + frame.along.y * reach },
  };
}

const round2 = (v: number): number => Math.round(v * 100) / 100;
const round3 = (v: number): number => Math.round(v * 1000) / 1000;

/** Die vier Eckpunkte einer Dachöffnung im Grundriss, im Dach-Bezugssystem. */
export function roofOpeningCorners(frame: RoofFrame, opening: RoofOpening): Vec2[] {
  const ht = opening.depth / 2;
  const hu = opening.width / 2;
  const d = frame.dir;
  const a = frame.along;
  const c = opening.position;
  return [
    { x: c.x - d.x * ht - a.x * hu, y: c.y - d.y * ht - a.y * hu },
    { x: c.x + d.x * ht - a.x * hu, y: c.y + d.y * ht - a.y * hu },
    { x: c.x + d.x * ht + a.x * hu, y: c.y + d.y * ht + a.y * hu },
    { x: c.x - d.x * ht + a.x * hu, y: c.y - d.y * ht + a.y * hu },
  ];
}

/** Trefferprüfung im Grundriss. */
export function hitTestRoofOpening(frame: RoofFrame, opening: RoofOpening, p: Vec2): boolean {
  const dx = p.x - opening.position.x;
  const dy = p.y - opening.position.y;
  const t = dx * frame.dir.x + dy * frame.dir.y;
  const u = dx * frame.along.x + dy * frame.along.y;
  return Math.abs(t) <= opening.depth / 2 && Math.abs(u) <= opening.width / 2;
}
