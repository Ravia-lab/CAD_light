/**
 * Prüfblock „Dachumriss" — das Dach hört auf, die Architektur zu ignorieren.
 *
 * **Worum es geht.** Bis 1.26.0 reduzierte `buildRoofFrame` den übergebenen
 * Grundriss sofort auf seine **Bounding Box**. Danach gab es nur noch ein
 * gedrehtes Rechteck: Mittelpunkt und zwei Halbspannen. Alle Höhen wurden
 * darauf gerechnet. Über einem L-förmigen Haus lief das Walmdach damit über
 * den Innenwinkel hinweg, als stünde dort Gebäude — und Dachform,
 * Raumvolumen, Wohnfläche nach WoFlV, Dachflächen je Himmelsrichtung und
 * Giebelflächen stimmten alle nicht. Unbemerkt, weil die Zahlen plausibel
 * aussehen: 5,00 m Firsthöhe über einem L sind nicht offensichtlich falsch,
 * sie sind nur nicht das, was gebaut wird.
 *
 * **Was jetzt gilt.** `gebaeudeUmriss` liefert den Außenumriss als geordnetes
 * Polygon, und das Walmdach rechnet darauf:
 *
 *     h(p) = Kniestock + Abstand(p, Umriss) · Steigung
 *
 * Das ist die Höhenfunktion des Straight Skeleton. Grate und **Kehlen**
 * entstehen von selbst; gebaut werden muss kein Skelett.
 *
 * **Die Sollwerte stehen von Hand da.** Jede Zahl unten ist im Kopf
 * nachzurechnen, und deshalb sind die Prüfhäuser so gewählt:
 *
 *  • Ein **Quadrat 10 × 10** mit 45° Neigung und ohne Kniestock. tan 45° = 1,
 *    also ist die Höhe in Metern gleich dem Randabstand in Metern. In der
 *    Mitte sind das 5,00 m, auf halbem Weg 2,50 m, am Rand 0.
 *  • Ein **L** aus sechs Wänden über (0|0) → (12|0) → (12|6) → (6|6) →
 *    (6|10) → (0|10). Seine Fläche ist die Summe der Schenkel:
 *    12 · 6 = 72 m² plus 6 · 4 = 24 m², zusammen 96 m². Die einspringende
 *    Ecke liegt bei (6|6) — dort ist die Kehle.
 *
 * **Was dieser Block nicht prüft.** Die Höhenlinien nach WoFlV
 * (`roofContourLines`) sind bewusst *nicht* auf den Umriss umgestellt; die
 * Begründung steht an der Funktion selbst und ist keine Zahl, die sich prüfen
 * ließe. Und ob ein Satteldach über einem L die *richtige* Dachform ist —
 * das ist eine Planungsentscheidung; geprüft wird nur, dass das Programm sie
 * meldet statt sie zu treffen (Abschnitt H).
 */

import type { CheckFn } from './typ';
import type {
  BimDocument,
  BimNode,
  Level,
  RoofDefinition,
  Vec2,
  Wall,
} from '../../src/types/bim';
import { emptyPlant, emptySite } from '../../src/lib/plantDefaults';
import { detectRooms, gebaeudeUmriss } from '../../src/lib/roomDetection';
import {
  baseRoofHeightAt,
  buildRoofFrame,
  ridgeLine,
  roofFaceAzimuthAt,
} from '../../src/lib/roofGeometry';
import { polygonArea, signedArea } from '../../src/lib/geometry';
import { validateModel } from '../../src/lib/validation';

// ---------------------------------------------------------------------------
// Kleinkram
// ---------------------------------------------------------------------------

/** Auf Millimeter runden — feiner ist an einem Dach keine Angabe. */
const r3 = (v: number): number => Math.round(v * 1000) / 1000;

/** Ein Punkt als ein Wort, damit beide Koordinaten in eine Prüfzeile passen. */
const punktwort = (p: Vec2): string => `${r3(p.x)}|${r3(p.y)}`;

const EBENE = 'og';

/** Rechteck 10 × 8 über den Wandachsen. */
const RECHTECK: Vec2[] = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 8 },
  { x: 0, y: 8 },
];

/**
 * Das L aus sechs Wänden.
 *
 * Breiter Schenkel unten: 12 m × 6 m. Schmaler Schenkel links oben:
 * 6 m × 4 m. Die einspringende Ecke liegt bei (6|6).
 */
const L_FORM: Vec2[] = [
  { x: 0, y: 0 },
  { x: 12, y: 0 },
  { x: 12, y: 6 },
  { x: 6, y: 6 },
  { x: 6, y: 10 },
  { x: 0, y: 10 },
];

/** Quadrat 10 × 10 — das Haus, an dem tan 45° = 1 jede Zahl offenlegt. */
const QUADRAT: Vec2[] = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

/**
 * Baut aus einem Punktring die Wände und Knoten eines Geschosses.
 *
 * Bewusst nur Außenwände und keine Innenwand: Der Umriss soll aus der
 * Facettentraversierung kommen, und eine Trennwand mittendrin prüft daran
 * nichts, was der Ring nicht schon prüft. Eine Innenwand steht dafür in
 * Abschnitt A eigens einmal drin — dort ist sie der Punkt.
 */
function ringHaus(
  punkte: readonly Vec2[],
  levelId = EBENE,
): { walls: Wall[]; nodes: Record<string, BimNode> } {
  const nodes: Record<string, BimNode> = {};
  const walls: Wall[] = [];
  punkte.forEach((p, i) => {
    const id = `${levelId}-n${i}`;
    nodes[id] = { id, x: p.x, y: p.y, levelId };
  });
  for (let i = 0; i < punkte.length; i++) {
    walls.push({
      id: `${levelId}-w${i}`,
      a: `${levelId}-n${i}`,
      b: `${levelId}-n${(i + 1) % punkte.length}`,
      levelId,
      type: 'exterior',
      thickness: 0.3,
      height: 2.6,
      uValue: 0.24,
      layerId: 'layer-walls',
    });
  }
  return { walls, nodes };
}

/** Ein Dach, dessen Zahlen sich im Kopf rechnen lassen: 45°, kein Kniestock. */
function dach(kind: RoofDefinition['kind'], rest: Partial<RoofDefinition> = {}): RoofDefinition {
  return {
    kind,
    pitch: 45,
    kneeHeight: 0,
    azimuth: 0,
    ridgeOffset: 0,
    uValue: 0.2,
    gableUValue: 0.24,
    ...rest,
  };
}

/** Die Punktwolke, die alle Aufrufer bis 1.26.0 übergaben — je Wand beide Knoten. */
function punktwolke(walls: Wall[], nodes: Record<string, BimNode>): Vec2[] {
  const out: Vec2[] = [];
  for (const w of walls) {
    const a = nodes[w.a];
    const b = nodes[w.b];
    if (a) out.push({ x: a.x, y: a.y });
    if (b) out.push({ x: b.x, y: b.y });
  }
  return out;
}

/** Ein vollständiges Dokument um einen Punktring — für die Modellprüfung. */
function haus(punkte: readonly Vec2[], roof: RoofDefinition): BimDocument {
  const { walls, nodes } = ringHaus(punkte);
  const level: Level = {
    id: EBENE,
    name: 'OG',
    order: 1,
    elevation: 0,
    height: 2.6,
    floorUValue: 0.3,
    floorBoundary: 'adjacent-room',
    ceilingUValue: 0.2,
    ceilingBoundary: 'unheated',
    roof,
  };
  return {
    site: emptySite(),
    plant: emptyPlant(),
    meta: {
      name: 'Prüfhaus Dachumriss',
      createdAt: '2026-01-01T00:00:00.000Z',
      modifiedAt: '2026-01-01T00:00:00.000Z',
      northAngle: 0,
      designOutdoorTemperature: -12,
      designIndoorTemperature: 20,
      n50: 1.5,
      shielding: 'moderate',
      unheatedTemperature: 10,
      groundTemperature: 10,
      thermalBridgeSupplement: 0,
      thermalBridgeMethod: 'flat',
      thermalBridgeCategory: 'custom',
      reheatFactor: 0,
    },
    levels: { [EBENE]: level },
    layers: {},
    nodes,
    walls: Object.fromEntries(walls.map((w) => [w.id, w])),
    openings: {},
    fixtures: {},
    verticals: {},
    pipes: {},
    annotations: {},
    roofOpenings: {},
    rooms: {},
    constructions: {},
    diagnostics: { openEnds: [] },
    activeLevelId: EBENE,
  };
}

// ---------------------------------------------------------------------------
// Der Prüfblock
// ---------------------------------------------------------------------------

export function pruefeDachumriss(check: CheckFn): void {
  // === A — Der Umriss am Rechteck =========================================
  //
  // Vier Wände über (0|0), (10|0), (10|8), (0|8). Vier Ecken, 80 m².
  // Dazu eine Trennwand bei x = 6: Sie teilt den Grundriss in zwei Räume und
  // steckt zwei T-Stöße in den Umrissring — der Umriss muss trotzdem vier
  // Punkte haben. Genau hier läge die Falle, wenn die Traversierung die
  // Innenwand mitnähme: aus dem Rechteck würde ein Ring mit einem
  // Null-Millimeter-Schlitz in der Mitte, und jedes Dach bekäme dort eine
  // Kehle bis auf Traufhöhe.
  {
    const { walls, nodes } = ringHaus(RECHTECK);
    nodes['og-m1'] = { id: 'og-m1', x: 6, y: 0, levelId: EBENE };
    nodes['og-m2'] = { id: 'og-m2', x: 6, y: 8, levelId: EBENE };
    const mitWand: Wall[] = [
      ...walls,
      {
        id: 'og-trenn',
        a: 'og-m1',
        b: 'og-m2',
        levelId: EBENE,
        type: 'interior',
        thickness: 0.115,
        height: 2.6,
        uValue: 1.2,
        layerId: 'layer-walls',
      },
    ];

    const umriss = gebaeudeUmriss(mitWand, nodes);
    check('Rechteck: der Umriss hat vier Punkte', umriss.length, 4);
    check('Rechteck: Umrissfläche 10 × 8', r3(polygonArea(umriss)), 80);
    // Gegen den Uhrzeigersinn, also positive vorzeichenbehaftete Fläche.
    check('Rechteck: Umlauf gegen den Uhrzeigersinn', r3(signedArea(umriss)), 80);
    check(
      'Rechteck: es sind die vier Ecken',
      umriss.map(punktwort).sort().join(' '),
      '0|0 0|8 10|0 10|8',
    );

    /*
     * Und die Gegenprobe zur Konvention: `room.polygon` kommt aus den
     * beschränkten Facetten derselben Traversierung und läuft ebenfalls CCW.
     * Zwei Umlaufkonventionen nebeneinander wären eine Falle — jede
     * Außennormale hinge dann davon ab, aus welcher Funktion das Polygon
     * gerade stammt. Deshalb steht das hier als Prüfung und nicht nur als
     * Zusicherung im Kommentar.
     */
    const raeume = detectRooms({
      walls: mitWand,
      nodes,
      openings: [],
      levelId: EBENE,
      defaultHeight: 2.6,
      northAngle: 0,
    });
    check('Rechteck mit Trennwand ergibt zwei Räume', raeume.length, 2);
    check(
      'Raumpolygone laufen im selben Drehsinn wie der Umriss',
      raeume.every((r) => signedArea(r.polygon) > 0),
      true,
    );
  }

  // === B — Der Umriss am L =================================================
  //
  // Sechs Wände, sechs Ecken. Die Fläche ist die Summe der Schenkel:
  //   breiter Schenkel  12,00 m × 6,00 m = 72,00 m²
  //   schmaler Schenkel  6,00 m × 4,00 m = 24,00 m²
  //   zusammen                             96,00 m²
  // Die Bounding Box hätte 12 × 10 = 120 m², also 24 m² Dach über nichts.
  {
    const { walls, nodes } = ringHaus(L_FORM);
    const umriss = gebaeudeUmriss(walls, nodes);
    check('L: der Umriss hat sechs Punkte', umriss.length, 6);
    check('L: Umrissfläche = 72 + 24', r3(polygonArea(umriss)), 96);
    check('L: Umlauf gegen den Uhrzeigersinn', r3(signedArea(umriss)), 96);
    check('L: die einspringende Ecke ist dabei', umriss.map(punktwort).includes('6|6'), true);

    // Was die Bounding Box daraus gemacht hätte — 25 % Fläche zu viel.
    check('L: die Bounding Box wäre 12 × 10', 12 * 10, 120);

    // Ein einzelnes freies Wandende darf den Umriss nicht aufschlitzen: Die
    // Außenfacette läuft darüber hin und zurück, und ein Schlitz ohne Breite
    // läge jedem Punkt daneben beliebig nahe.
    const mitStummel = { ...nodes };
    mitStummel['og-stummel'] = { id: 'og-stummel', x: 3, y: 4, levelId: EBENE };
    const stummelWand: Wall = {
      id: 'og-w-stummel',
      a: 'og-n0',
      b: 'og-stummel',
      levelId: EBENE,
      type: 'interior',
      thickness: 0.115,
      height: 2.6,
      uValue: 1.2,
      layerId: 'layer-walls',
    };
    const mitStachel = gebaeudeUmriss([...walls, stummelWand], mitStummel);
    check('L mit freiem Wandende: immer noch sechs Punkte', mitStachel.length, 6);
    check('L mit freiem Wandende: immer noch 96 m²', r3(polygonArea(mitStachel)), 96);

    // Zu wenige Wände ergeben keinen Umriss — und ausdrücklich kein geratenes
    // Rechteck. Wer nichts weiß, sagt nichts.
    check('Zwei Wände ergeben keinen Umriss', gebaeudeUmriss(walls.slice(0, 2), nodes).length, 0);
  }

  // === C — Walmdach über dem Quadrat ======================================
  //
  // 10 × 10 m, Neigung 45° (tan 45° = 1), Kniestock 0. Die Höhe in Metern ist
  // damit gleich dem Randabstand in Metern:
  //   Mitte (5|5)       → Abstand 5,00 m → h = 5,00 m
  //   halber Weg (2,5|5)→ Abstand 2,50 m → h = 2,50 m
  //   Rand (0|5)        → Abstand 0      → h = 0
  {
    const { walls, nodes } = ringHaus(QUADRAT);
    const umriss = gebaeudeUmriss(walls, nodes);
    const wolke = punktwolke(walls, nodes);
    const frame = buildRoofFrame(dach('hip'), wolke, [], umriss)!;

    check('Quadrat: der Rahmen kennt den Umriss', frame.umriss.length, 4);
    check('Quadrat: Firsthöhe = halbe Seitenlänge', r3(frame.ridgeHeight), 5, 0.005);
    check('Quadrat: Höhe in der Mitte', r3(baseRoofHeightAt(frame, { x: 5, y: 5 })), 5, 0.001);
    check('Quadrat: Höhe auf halbem Weg', r3(baseRoofHeightAt(frame, { x: 2.5, y: 5 })), 2.5, 0.001);
    check('Quadrat: Höhe am Rand', r3(baseRoofHeightAt(frame, { x: 0, y: 5 })), 0, 0.001);
    // Die Ecke ist von zwei Kanten gleich weit entfernt — das ist der Grat.
    check('Quadrat: Höhe 1 m innerhalb der Ecke', r3(baseRoofHeightAt(frame, { x: 1, y: 1 })), 1, 0.001);
  }

  // === D — Walmdach über dem L ============================================
  //
  // Das ist der Fall, um den es geht. Zwei Punkte, beide von Hand gerechnet:
  //
  // **Im Innenwinkel**, p = (5|5). Die einspringende Ecke liegt bei (6|6);
  // die beiden Kanten, die sich dort treffen, sind der nächste Rand:
  //     Abstand = √((6−5)² + (6−5)²) = √2 = 1,41421 m
  //   ⇒ h = 0 + 1,41421 · tan 45° = 1,414 m
  //
  // **In der Mitte des breiten Schenkels**, p = (9|3). Der Schenkel läuft von
  // y = 0 bis y = 6 und endet bei x = 12:
  //     Abstand zu y = 0   → 3,00 m
  //     Abstand zu y = 6   → 3,00 m
  //     Abstand zu x = 12  → 3,00 m
  //   ⇒ h = 3,000 m
  //
  // Der Punkt im Innenwinkel liegt also 1,59 m *tiefer* — genau das, was die
  // Bounding Box nicht kann. Sie sagt für beide Punkte etwas anderes, und für
  // den Innenwinkel sagt sie 5,00 m: die volle Firsthöhe, mitten in der Kehle.
  //
  // Die Firsthöhe selbst — und hier lohnt es sich, genau hinzusehen, weil die
  // naheliegende Antwort falsch ist. Der größte einbeschriebene Kreis liegt
  // **nicht** in einem der beiden 6 m breiten Schenkel (dort wäre sein Radius
  // 3,00 m), sondern im quadratischen Bereich unten links, wo sich beide
  // Schenkel überlagern. Dieser Bereich wird nur von drei Dingen begrenzt:
  // der Westwand x = 0, der Südwand y = 0 und der einspringenden **Ecke**
  // (6|6) — die Kanten y = 6 und x = 6 beginnen erst dort, links und unter
  // ihr ist kein Gebäude zu Ende. Auf der Diagonalen (a|a) gilt also
  //     Randabstand = min(a; a; √2 · (6 − a))
  // und das Maximum liegt, wo beide gleich sind:
  //     a = √2 · (6 − a)  ⇒  a · (1 + √2) = 6√2  ⇒  a = 12 − 6√2 = 3,5147
  //   ⇒ Firsthöhe = 0 + 3,5147 · tan 45° = 3,515 m   (Bounding Box: 5,00 m)
  //
  // Dass hier zuerst 3,00 m stand und die Rechnung es widerlegt hat, ist
  // genau der Grund, warum ein Sollwert von Hand vorgerechnet wird und nicht
  // aus einem Probelauf abgeschrieben: Aus einem Probelauf wäre 3,515
  // übernommen worden, ohne dass jemand je erfahren hätte, wo diese Zahl
  // herkommt — und ob sie stimmt.
  {
    const { walls, nodes } = ringHaus(L_FORM);
    const umriss = gebaeudeUmriss(walls, nodes);
    const wolke = punktwolke(walls, nodes);
    const mitUmriss = buildRoofFrame(dach('hip'), wolke, [], umriss)!;
    const ohneUmriss = buildRoofFrame(dach('hip'), wolke)!;

    const kehle = { x: 5, y: 5 };
    const schenkel = { x: 9, y: 3 };

    // 12 − 6√2, ausgeschrieben statt als Zahl: so steht die Herleitung aus dem
    // Kommentar oben auch in der Prüfzeile und nicht nur daneben.
    check('L: Firsthöhe = 12 − 6√2', r3(mitUmriss.ridgeHeight), r3(12 - 6 * Math.SQRT2), 0.002);
    check('L: … und das sind 3,515 m statt 5,00 m', r3(mitUmriss.ridgeHeight), 3.515, 0.002);
    check('L: Höhe im Innenwinkel', r3(baseRoofHeightAt(mitUmriss, kehle)), 1.414, 0.001);
    check('L: Höhe in der Mitte des breiten Schenkels', r3(baseRoofHeightAt(mitUmriss, schenkel)), 3, 0.001);
    check(
      'L: der Innenwinkel liegt tiefer als der breite Schenkel',
      baseRoofHeightAt(mitUmriss, kehle) < baseRoofHeightAt(mitUmriss, schenkel) - 1,
      true,
    );

    // === E — Die Rückfallebene bleibt unverändert ==========================
    //
    // Ohne Umriss rechnet dieselbe Funktion weiter auf dem umschließenden
    // Rechteck: Bounding Box 12 × 10 um den Mittelpunkt (6|5), Azimut 0 also
    // dir = (0|1) und along = (1|0), halbe Spannen 5 (in y) und 6 (in x).
    //   Firsthöhe = 0 + min(5; 6) · tan 45° = 5,00 m
    //   p = (5|5): t = 0, s = −1 ⇒ Traufabstände 5 − 0 = 5 und 6 − 1 = 5
    //              ⇒ Abfall = (5 − 5) · 1 = 0 ⇒ h = 5,00 m
    check('Ohne Umriss: Firsthöhe wie bisher aus der Bounding Box', r3(ohneUmriss.ridgeHeight), 5);
    check('Ohne Umriss: Höhe im Innenwinkel wie bisher', r3(baseRoofHeightAt(ohneUmriss, kehle)), 5);
    check('Ohne Umriss: der Rahmen führt keinen Umriss', ohneUmriss.umriss.length, 0);
    check(
      'Und das ist der ganze Unterschied: 3,59 m Dach über einem Innenwinkel',
      r3(baseRoofHeightAt(ohneUmriss, kehle) - baseRoofHeightAt(mitUmriss, kehle)),
      3.586,
      0.002,
    );
  }

  // === F — Welche Dachfläche liegt über diesem Punkt? =====================
  //
  // Beim Walmdach mit Umriss trägt jede Umrisskante ihre eigene Dachfläche,
  // und deren Azimut ist die Außennormale der Kante. 0° = Nord, 90° = Ost.
  {
    const { walls, nodes } = ringHaus(QUADRAT);
    const umriss = gebaeudeUmriss(walls, nodes);
    const wolke = punktwolke(walls, nodes);
    const frame = buildRoofFrame(dach('hip'), wolke, [], umriss)!;

    check('Quadrat: über der Südkante fällt das Dach nach Süden', roofFaceAzimuthAt(frame, { x: 5, y: 1 }), 180);
    check('Quadrat: über der Ostkante nach Osten', roofFaceAzimuthAt(frame, { x: 9, y: 5 }), 90);
    check('Quadrat: über der Nordkante nach Norden', roofFaceAzimuthAt(frame, { x: 5, y: 9 }), 0);
    check('Quadrat: über der Westkante nach Westen', roofFaceAzimuthAt(frame, { x: 1, y: 5 }), 270);

    /*
     * Dieselben vier Punkte durch die Rückfallebene. Sie muss dasselbe
     * liefern — ein Rechteck ist ein Rechteck, egal ob es als Polygon oder als
     * Bounding Box vorliegt. Bis 1.26.0 tat sie das nicht: für `s ≥ 0` stand
     * dort `azimuth − 90` statt `azimuth + 90`, die beiden Walme waren also um
     * 180° vertauscht. Aufgefallen ist es nie, weil es für Walmdächer im
     * ganzen Prüflauf keine einzige Zeile gab.
     */
    const rechteckig = buildRoofFrame(dach('hip'), wolke)!;
    for (const [wo, p] of [
      ['Süd', { x: 5, y: 1 }],
      ['Ost', { x: 9, y: 5 }],
      ['Nord', { x: 5, y: 9 }],
      ['West', { x: 1, y: 5 }],
    ] as [string, Vec2][]) {
      check(
        `Rückfallebene und Umriss sind sich einig (${wo})`,
        roofFaceAzimuthAt(rechteckig, p),
        roofFaceAzimuthAt(frame, p),
      );
    }

    // Am L zeigt sich, wozu die Kanten gebraucht werden: Der Punkt (9|5,5)
    // liegt 0,50 m unter der Innenkante y = 6 des breiten Schenkels — das
    // Dach fällt dort nach Norden. Die Bounding Box kennt diese Kante nicht;
    // für sie ist der Punkt 3,00 m von der Ostkante entfernt und 4,50 m von
    // der Nordkante, also Ost.
    const l = ringHaus(L_FORM);
    const lWolke = punktwolke(l.walls, l.nodes);
    const lFrame = buildRoofFrame(dach('hip'), lWolke, [], gebaeudeUmriss(l.walls, l.nodes))!;
    const lKasten = buildRoofFrame(dach('hip'), lWolke)!;
    check('L: über der Innenkante fällt das Dach nach Norden', roofFaceAzimuthAt(lFrame, { x: 9, y: 5.5 }), 0);
    check('L: die Bounding Box schickt dieselbe Fläche nach Osten', roofFaceAzimuthAt(lKasten, { x: 9, y: 5.5 }), 90);
  }

  // === G — Die Firstlinie hört auf zu lügen ===============================
  //
  // Über einem **Quadrat** gibt es keinen First, sondern eine Spitze: Das
  // Walmdach ist eine Pyramide. Die gezeichnete Linie war trotzdem
  // halfSpanS = 5,00 m lang und trug die Firsthöhe als Beschriftung — gelesen
  // heißt das „hier oben ist über 10 m Länge Stehhöhe".
  //
  // Über einem **Rechteck 10 × 8** (10 m in Firstrichtung, 8 m quer) liegt
  // der First dort, wo der Randabstand sein Maximum 8/2 = 4,00 m erreicht:
  // auf der Mittellinie, von x = −1 bis x = +1 — denn erst ab 4,00 m Abstand
  // von den Schmalseiten ist die Querrichtung wieder die nähere.
  //   ⇒ Firstlänge = 2,00 m   (bisher behauptet: 2 · halfSpanS = 10,00 m)
  {
    const quadrat = ringHaus(QUADRAT);
    const qFrame = buildRoofFrame(
      dach('hip'),
      punktwolke(quadrat.walls, quadrat.nodes),
      [],
      gebaeudeUmriss(quadrat.walls, quadrat.nodes),
    )!;
    const qFirst = ridgeLine(qFrame);
    check(
      'Quadrat: die Pyramide hat keinen First',
      r3(Math.hypot(qFirst.b.x - qFirst.a.x, qFirst.b.y - qFirst.a.y)),
      0,
      0.15,
    );

    // Rechteck 10 (x) × 8 (y), Azimut 0 ⇒ der First läuft in x-Richtung.
    const laengsRechteck: Vec2[] = [
      { x: -5, y: -4 },
      { x: 5, y: -4 },
      { x: 5, y: 4 },
      { x: -5, y: 4 },
    ];
    const lang = ringHaus(laengsRechteck);
    const langFrame = buildRoofFrame(
      dach('hip'),
      punktwolke(lang.walls, lang.nodes),
      [],
      gebaeudeUmriss(lang.walls, lang.nodes),
    )!;
    check('Rechteck 10 × 8: Firsthöhe = halbe Breite', r3(langFrame.ridgeHeight), 4, 0.005);
    const langFirst = ridgeLine(langFrame);
    check(
      'Rechteck 10 × 8: Firstlänge = 10 − 8',
      r3(Math.hypot(langFirst.b.x - langFirst.a.x, langFirst.b.y - langFirst.a.y)),
      2,
      0.15,
    );
    check(
      'Der First liegt auf der Mittellinie',
      r3(Math.abs(langFirst.a.y) + Math.abs(langFirst.b.y)),
      0,
      0.01,
    );
    // Ohne Umriss bleibt es bei der alten Länge — die Rückfallebene ist
    // unverändert, auch dort, wo sie zu viel behauptet.
    const langKasten = buildRoofFrame(dach('hip'), punktwolke(lang.walls, lang.nodes))!;
    const kastenFirst = ridgeLine(langKasten);
    check(
      'Ohne Umriss: Firstlänge wie bisher über die ganze Länge',
      r3(Math.hypot(kastenFirst.b.x - kastenFirst.a.x, kastenFirst.b.y - kastenFirst.a.y)),
      10,
    );
  }

  // === I — Sattel und Pult: der First bleibt gerade, die Traufe nicht =====
  //
  // Das Satteldach über dem L, Azimut 0: Es fällt nach Norden und Süden, die
  // Firstachse läuft also in x-Richtung. Bounding Box 12 × 10 um (6|5), damit
  // liegt der First auf y = 5 und
  //     Firsthöhe = max(5; 5) · tan 45° = 5,00 m.
  //
  // Die Firstlinie ist und bleibt eine Gerade — das ist die Definition eines
  // Satteldachs. Was dem Umriss folgen muss, ist die **Traufe**:
  //
  //   p = (9|5,5) liegt über dem breiten Schenkel, 0,50 m südlich von dessen
  //   Nordwand y = 6. Von dort steigt das Dach mit 45° an:
  //       h = 0 + 0,50 · tan 45° = 0,50 m
  //   Die Bounding Box kennt diese Wand nicht. Für sie reicht das Gebäude bis
  //   y = 10, der Punkt liegt 0,50 m nördlich des Firsts, und sie sagt
  //       h = 5,00 − 0,50 = 4,50 m
  //   — vier Meter Dach über einer Wand, die dort schon zu Ende ist.
  //
  //   p = (9|4) liegt 4,00 m nördlich der Südwand y = 0, und dort sind sich
  //   beide einig: 5,00 − 1,00 = 4,00 m und 0 + 4,00 = 4,00 m.
  {
    const { walls, nodes } = ringHaus(L_FORM);
    const wolke = punktwolke(walls, nodes);
    const umriss = gebaeudeUmriss(walls, nodes);
    const sattel = buildRoofFrame(dach('gable'), wolke, [], umriss)!;
    const sattelKasten = buildRoofFrame(dach('gable'), wolke)!;

    check('L mit Satteldach: Firsthöhe wie gehabt', r3(sattel.ridgeHeight), 5);
    check('L: über der Südwand sind sich beide einig', r3(baseRoofHeightAt(sattel, { x: 9, y: 4 })), 4);
    check('L: … und die Bounding Box auch', r3(baseRoofHeightAt(sattelKasten, { x: 9, y: 4 })), 4);
    check('L: an der Innenkante folgt die Traufe dem Umriss', r3(baseRoofHeightAt(sattel, { x: 9, y: 5.5 })), 0.5);
    check('L: die Bounding Box setzt dort 4,50 m an', r3(baseRoofHeightAt(sattelKasten, { x: 9, y: 5.5 })), 4.5);

    /*
     * Und der Bruch, der daraus folgt und den kein Programm wegrechnen kann:
     * Über dem breiten Schenkel hat der First auf seiner Nordseite nur 1,00 m
     * Spannweite bis zur Wand y = 6, auf seiner Südseite 5,00 m bis y = 0.
     * Zwei gleiche Neigungen über zwei verschiedene Spannweiten treffen sich
     * nicht — die beiden Dachhälften stoßen dort mit rund 4 m Höhenunterschied
     * aufeinander. **Das ist keine Dachform, das ist eine offene Frage**, und
     * sie hat genau eine richtige Antwort: der Seitenflügel braucht einen
     * eigenen First und eine Kehle. Die lässt sich aus einer Firstrichtung
     * nicht ableiten, also wird sie gemeldet statt geraten (Abschnitt H).
     */
    const nordseite = baseRoofHeightAt(sattel, { x: 9, y: 5.01 });
    const suedseite = baseRoofHeightAt(sattel, { x: 9, y: 4.99 });
    check('Über dem breiten Schenkel bricht der First', r3(nordseite), 0.99, 0.02);
    check('… um rund vier Meter', r3(suedseite - nordseite), 4, 0.05);

    // Wo der Grundriss symmetrisch zum First liegt — der linke Streifen läuft
    // von y = 0 bis y = 10 —, ist der First unversehrt: 4,99 m auf beiden
    // Seiten. Genau deshalb greift der Befund am L und nicht am Rechteck.
    check(
      'Über dem symmetrischen Teil bleibt der First heil',
      r3(
        baseRoofHeightAt(sattel, { x: 3, y: 5.01 }) - baseRoofHeightAt(sattel, { x: 3, y: 4.99 }),
      ),
      0,
      0.001,
    );

    // Das Pultdach über demselben L: First an der Südkante (y = 0), Gefälle
    // nach Norden über 10,00 m ⇒ Firsthöhe 10,00 m. Über dem linken Streifen
    // reicht das Dach bis y = 10, dort ändert sich nichts (7,00 m bei y = 3).
    // Über dem breiten Schenkel endet es bei y = 6: 3,00 m statt 7,00 m.
    const pult = buildRoofFrame(dach('monopitch'), wolke, [], umriss)!;
    const pultKasten = buildRoofFrame(dach('monopitch'), wolke)!;
    check('L mit Pultdach: Firsthöhe über die volle Tiefe', r3(pult.ridgeHeight), 10);
    check('Pultdach: über dem linken Streifen unverändert', r3(baseRoofHeightAt(pult, { x: 3, y: 3 })), 7);
    check('Pultdach: über dem breiten Schenkel folgt die Traufe', r3(baseRoofHeightAt(pult, { x: 9, y: 3 })), 3);
    check('Pultdach: die Bounding Box sagt dort 7,00 m', r3(baseRoofHeightAt(pultKasten, { x: 9, y: 3 })), 7);

    /*
     * Die Gegenprobe, ohne die alles andere nichts wert wäre: Über einem
     * Rechteck, dessen Seiten in Fallrichtung liegen, ist der Weg zur Traufe
     * genau die halbe Spannweite. Mit und ohne Umriss muss dieselbe Zahl
     * herauskommen — sonst hätte dieser Umbau jedes bestehende Satteldach
     * verändert, und das darf er nicht.
     */
    const r = ringHaus(RECHTECK);
    const rWolke = punktwolke(r.walls, r.nodes);
    const rMit = buildRoofFrame(dach('gable'), rWolke, [], gebaeudeUmriss(r.walls, r.nodes))!;
    const rOhne = buildRoofFrame(dach('gable'), rWolke)!;
    for (const p of [
      { x: 5, y: 6 },
      { x: 5, y: 1 },
      { x: 5, y: 4 },
      { x: 2, y: 7.5 },
    ]) {
      check(
        `Rechteck mit Satteldach: mit und ohne Umriss gleich (${punktwort(p)})`,
        r3(baseRoofHeightAt(rMit, p)),
        r3(baseRoofHeightAt(rOhne, p)),
      );
    }
    check('Rechteck: Firsthöhe 8/2', r3(rMit.ridgeHeight), 4);
    check('Rechteck: 2 m nördlich des Firsts', r3(baseRoofHeightAt(rMit, { x: 5, y: 6 })), 2);
  }

  // === H — Der Befund: eine Firstlinie über einem L =======================
  //
  // Ein Satteldach hat *eine* gerade Firstlinie. Über einem L ist das
  // bautechnisch keine vollständige Lösung — der Seitenflügel bekäme einen
  // eigenen First und dazwischen eine Kehle. Welcher First das ist, folgt aus
  // keiner Firstrichtung, sondern aus einer Planungsentscheidung. Das
  // Programm trifft sie nicht heimlich, es meldet sie.
  {
    const codes = (doc: BimDocument): string[] => validateModel(doc).issues.map((i) => i.code);
    const befund = (doc: BimDocument) =>
      validateModel(doc).issues.find((i) => i.code === 'roof.single-ridge');

    check('L mit Satteldach wird gemeldet', codes(haus(L_FORM, dach('gable'))).includes('roof.single-ridge'), true);
    check('… als Warnung, nicht als Fehler', befund(haus(L_FORM, dach('gable')))?.severity ?? 'fehlt', 'warning');
    check(
      '… und die Meldung nennt die Ecken',
      (befund(haus(L_FORM, dach('gable')))?.message ?? '').includes('6 Ecken'),
      true,
    );
    check(
      '… und die Abhilfe nennt das Walmdach',
      (befund(haus(L_FORM, dach('gable')))?.remedy ?? '').includes('Walm'),
      true,
    );
    check('L mit Pultdach ebenso', codes(haus(L_FORM, dach('monopitch'))).includes('roof.single-ridge'), true);

    // Und die beiden Gegenproben, ohne die der Befund nichts wert wäre.
    check(
      'Rechteck mit Satteldach wird nicht gemeldet',
      codes(haus(RECHTECK, dach('gable'))).includes('roof.single-ridge'),
      false,
    );
    check(
      'L mit Walmdach wird nicht gemeldet',
      codes(haus(L_FORM, dach('hip'))).includes('roof.single-ridge'),
      false,
    );
    check(
      'Flachdach über dem L ebenfalls nicht',
      codes(haus(L_FORM, dach('flat'))).includes('roof.single-ridge'),
      false,
    );

    /*
     * Ein *gedrehtes* Rechteck ist die Probe auf das Erkennungsmerkmal: Sein
     * Umriss hat vier Punkte, füllt seine achsparallele Bounding Box aber nur
     * zur Hälfte. Wer allein auf das Flächenverhältnis sieht, meldet hier
     * einen Seitenflügel, den es nicht gibt — und ein Befund, der bei
     * einwandfreien Modellen anschlägt, wird nach dem dritten Mal überlesen.
     */
    const gedreht: Vec2[] = [
      { x: 0, y: -5 },
      { x: 5, y: 0 },
      { x: 0, y: 5 },
      { x: -5, y: 0 },
    ];
    const gedrehtHaus = ringHaus(gedreht);
    const gedrehtUmriss = gebaeudeUmriss(gedrehtHaus.walls, gedrehtHaus.nodes);
    check('Gedrehtes Quadrat: vier Umrisspunkte', gedrehtUmriss.length, 4);
    // 50 m² Umriss in einer Bounding Box von 10 × 10 = 100 m².
    check('Gedrehtes Quadrat: halb so groß wie seine Bounding Box', r3(polygonArea(gedrehtUmriss)), 50);
    check(
      'Gedrehtes Quadrat mit Satteldach wird nicht gemeldet',
      codes(haus(gedreht, dach('gable'))).includes('roof.single-ridge'),
      false,
    );
  }
}
