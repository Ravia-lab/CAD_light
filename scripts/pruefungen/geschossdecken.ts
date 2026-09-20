/**
 * Prüfblock „Geschossdecken" — schließt die Platte die Lücke zwischen zwei
 * Geschossen?
 *
 * **Warum dieser Block gebraucht wird.** Bis 1.11.0 hob `levelBaseHeights`
 * jedes Geschoss auf seine Höhe, und genau dort entstand ein Fehler, den man
 * erst im Bild sieht: zwischen der Oberkante der Wände eines Geschosses und
 * dem Rohfußboden des nächsten klaffte die Deckenstärke als **Luft**. Das Haus
 * zerfiel in der 3D-Ansicht in schwebende Scheiben. `levelSlabs` füllt diesen
 * Zwischenraum — und dieser Block prüft, dass er ihn *vollständig* füllt und
 * nicht nur ungefähr.
 *
 * **Was hier tatsächlich gemessen wird.** Ein Bild lässt sich nicht prüfen,
 * eine Kante schon. Die Aussage „die Lücke ist geschlossen" zerfällt in zwei
 * Gleichungen, die für jedes Geschosspaar auf Millimeter genau gelten müssen:
 *
 *   Unterkante der Platte  =  Basis(unten) + lichte Höhe(unten)
 *   Oberkante der Platte   =  Basis(oben)
 *
 * Beides zusammen heißt: kein Zwischenraum, keine Überlappung. Eine Platte,
 * die nur „ungefähr" sitzt, ist genau der Fehler, den 1.11.0 beheben sollte.
 *
 * **Woher die Sollwerte kommen.** Sie werden aus den beiden Vorgabewerten in
 * `levelGeometry.ts` von Hand hergeleitet und stehen als Zahl im Kommentar:
 *
 *   DEFAULT_LEVEL_HEIGHT = 2,75 m  (lichte Geschosshöhe)
 *   DEFAULT_SLAB         = 0,25 m  (20 cm Stahlbeton + 4 cm Estrich + 1 cm Belag)
 *
 * Drei Geschosse ohne eigene Höhenlage stapeln sich damit auf
 *
 *   Basis(KG) = 0,00
 *   Basis(EG) = 0,00 + 2,75 + 0,25 = 3,00
 *   Basis(OG) = 3,00 + 2,75 + 0,25 = 6,00
 *
 * und die beiden Platten liegen bei 3,00 bzw. 6,00 mit je 0,25 m Stärke. Keine
 * dieser Zahlen stammt aus einem Probelauf.
 *
 * **Der Umriss ist der zweite Sachverhalt.** Die Decke endet nicht am
 * Raumpolygon: das läuft in der Wandmitte, die äußere Hälfte der Außenwand
 * bliebe unbedeckt, und die Decke endete sichtbar hinter der Fassade. Deshalb
 * gehören die Wandgrundflächen in denselben Umriss — und genau das lässt sich
 * an der Fläche nachweisen: die Plattenfläche muss um den umlaufenden Streifen
 * größer sein als die Summe der Raum-Bruttoflächen, und dieser Streifen ist
 * aus Wandlängen und Wandstärken von Hand ausrechenbar.
 *
 * **Aussparungen sind der dritte.** Eine Treppe im EG durchdringt die Decke
 * *über* dem EG und nicht die darunter; ein Schacht mit Zielgeschoss
 * durchdringt jede Decke bis dorthin. Wer das verwechselt, deckelt entweder
 * sein Treppenhaus zu oder schneidet ein Loch in die falsche Platte.
 */

import type { CheckFn } from './typ';
import type { BimNode, Level, Room, Vec2, VerticalElement, Wall } from '../../src/types/bim';
import { detectRooms } from '../../src/lib/roomDetection';
import { DEFAULT_LEVEL_HEIGHT, DEFAULT_SLAB, levelBaseHeights } from '../../src/lib/levelGeometry';
import {
  GROUND_SLAB,
  groundSlab,
  holeFitsOutline,
  levelSlabs,
  slabArea,
  topSlab,
  TOP_SLAB,
  type SlabPlan,
} from '../../src/lib/slabGeometry';

// ---------------------------------------------------------------------------
// Das Prüfhaus
// ---------------------------------------------------------------------------

/**
 * Grundriss: ein Rechteck 10,00 × 6,00 m im Achsmaß, durch eine Trennwand bei
 * x = 4,00 in zwei Räume geteilt. Dieselbe Geometrie steht in allen drei
 * Geschossen — Keller, Erdgeschoss, Obergeschoss.
 *
 * Die Maße sind bewusst glatt: jede Fläche in diesem Block ist ein Produkt
 * zweier ganzer oder halber Meter und damit im Kopf nachzurechnen.
 */
const B = 10;
const T = 6;
const X_M = 4;

/** Außenwand 30 cm, Innenwand 20 cm — Regelmaße im Massivbau. */
const D_AUSSEN = 0.3;
const D_INNEN = 0.2;

/**
 * Überstand der Deckenplatte über die Wandaußenkante [m].
 *
 * `slabGeometry` legt die Wandgrundfläche um 1 mm breiter als die Wand, damit
 * Deckenkante und Wandfläche im Modell nicht flimmern (Z-Fighting). Der Wert
 * geht in jede Wandfläche ein und steht deshalb auch hier — sonst wäre die
 * Handrechnung um 3,2 cm² je Meter Wand daneben.
 */
const UEBERSTAND = 0.001;

/** Lichte Geschosshöhe aller drei Geschosse — gleich `DEFAULT_LEVEL_HEIGHT`. */
const H = 2.75;

interface Haus {
  nodes: Record<string, BimNode>;
  walls: Wall[];
  rooms: Room[];
}

/**
 * Die drei Geschosse.
 *
 * `elevation` steht auf `NaN`, damit die Geschosse gestapelt werden. Das ist
 * kein Kunstgriff: `levelBaseHeights` behandelt einen unbrauchbaren Wert
 * ausdrücklich wie einen fehlenden („NaN aus einem Import"), und der Typ
 * `Level` verlangt die Zahl. `elevationOG` überschreibt die Höhenlage des
 * Obergeschosses — damit wird geprüft, dass eine von Hand gesetzte Lage
 * gewinnt.
 */
function baueGeschosse(elevationOG = Number.NaN): Level[] {
  const g = (id: string, name: string, order: number, elevation: number): Level => ({
    id,
    name,
    order,
    elevation,
    height: H,
    floorUValue: 0.35,
    floorBoundary: 'ground',
    ceilingUValue: 0.2,
    ceilingBoundary: 'adjacent-room',
  });
  return [g('kg', 'KG', -1, Number.NaN), g('eg', 'EG', 0, Number.NaN), g('og', 'OG', 1, elevationOG)];
}

/**
 * Dieselben Geschosse, aber ohne brauchbare lichte Höhe im EG.
 *
 * Damit wird die **Kopplung zweier Vorgabewerte** geprüft: fehlt die Höhe,
 * stapelt `levelBaseHeights` mit `DEFAULT_LEVEL_HEIGHT + DEFAULT_SLAB`, und
 * `levelSlabs` zieht die lichte Höhe zur Bestimmung der Plattenunterkante
 * wieder ab. Nur wenn beide Module denselben Vorgabewert benutzen, bleibt die
 * Stärke bei 0,25 m — laufen sie auseinander, öffnet sich genau die Lücke
 * wieder, die 1.11.0 geschlossen hat.
 */
function baueGeschosseOhneHoehe(): Level[] {
  return baueGeschosse().map((l) => (l.id === 'eg' ? { ...l, height: 0 } : l));
}

/** Knoten, Wände und erkannte Räume aller übergebenen Geschosse. */
function baueHaus(levels: readonly Level[]): Haus {
  const nodes: Record<string, BimNode> = {};
  const walls: Wall[] = [];
  const rooms: Room[] = [];

  for (const l of levels) {
    const p = (name: string, x: number, y: number): string => {
      const id = `${l.id}-${name}`;
      nodes[id] = { id, x, y, levelId: l.id };
      return id;
    };
    const sw = p('sw', 0, 0);
    const sm = p('sm', X_M, 0);
    const se = p('se', B, 0);
    const ne = p('ne', B, T);
    const nm = p('nm', X_M, T);
    const nw = p('nw', 0, T);

    const wand = (name: string, a: string, b: string, typ: Wall['type']): void => {
      walls.push({
        id: `${l.id}-${name}`,
        a,
        b,
        levelId: l.id,
        type: typ,
        thickness: typ === 'exterior' ? D_AUSSEN : D_INNEN,
        uValue: typ === 'exterior' ? 0.24 : 1.2,
        // Eine Wandhöhe von null gibt es nicht; die Prüfung der fehlenden
        // Geschosshöhe betrifft das Geschoss, nicht die Wand.
        height: l.height > 0 ? l.height : H,
        layerId: 'layer-walls',
      });
    };
    // Sechs Außenwandabschnitte (Gesamtachslänge 4+6+6+6+4+6 = 32,00 m) …
    wand('w-s1', sw, sm, 'exterior');
    wand('w-s2', sm, se, 'exterior');
    wand('w-e', se, ne, 'exterior');
    wand('w-n2', ne, nm, 'exterior');
    wand('w-n1', nm, nw, 'exterior');
    wand('w-w', nw, sw, 'exterior');
    // … und eine Trennwand von 6,00 m.
    wand('w-m', sm, nm, 'interior');

    rooms.push(
      ...detectRooms({
        nodes,
        walls: walls.filter((w) => w.levelId === l.id),
        openings: [],
        levelId: l.id,
        defaultHeight: l.height > 0 ? l.height : H,
        northAngle: 0,
      }),
    );
  }

  return { nodes, walls, rooms };
}

/**
 * Treppe und Schacht.
 *
 * Die Treppe steht im **EG** und hat kein Zielgeschoss: sie durchdringt genau
 * die Decke über dem EG. Der Schacht beginnt im **KG** und läuft bis ins OG:
 * er durchdringt die Decke über dem KG *und* die über dem EG — zwei Decken,
 * weil er zwei Geschosse überwindet.
 */
function baueBauteile(): VerticalElement[] {
  const treppe: VerticalElement = {
    id: 'treppe',
    kind: 'stair-straight',
    name: 'Treppe EG → OG',
    levelId: 'eg',
    position: { x: 7, y: 3 },
    width: 1,
    length: 3,
    rotation: 0,
    steps: 16,
    deductsArea: true,
    openToAbove: true,
  };
  const schacht: VerticalElement = {
    id: 'schacht',
    kind: 'shaft',
    name: 'Installationsschacht KG → OG',
    levelId: 'kg',
    toLevelId: 'og',
    position: { x: 2, y: 3 },
    width: 0.6,
    length: 0.8,
    rotation: 0,
    service: 'sanitary',
    deductsArea: true,
    openToAbove: false,
  };
  return [treppe, schacht];
}

/** Rechteck um einen Mittelpunkt — für die Handrechnungen zu `slabArea`. */
function rechteck(cx: number, cy: number, breite: number, tiefe: number): Vec2[] {
  const hb = breite / 2;
  const ht = tiefe / 2;
  return [
    { x: cx - hb, y: cy - ht },
    { x: cx + hb, y: cy - ht },
    { x: cx + hb, y: cy + ht },
    { x: cx - hb, y: cy + ht },
  ];
}

/** Die Platte über einem bestimmten Geschoss — oder `undefined`. */
function platteUeber(platten: readonly SlabPlan[], levelId: string): SlabPlan | undefined {
  return platten.find((p) => p.levelId === levelId);
}

/** Summe der Lochflächen einer Platte [m²]. */
function lochflaeche(plan: SlabPlan): number {
  let summe = 0;
  for (const h of plan.holes) {
    // Rechtecke — Länge × Breite über die Bounding Box, weil `verticalCorners`
    // bei rotation = 0 achsparallele Ecken liefert.
    const xs = h.map((p) => p.x);
    const ys = h.map((p) => p.y);
    summe += (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
  }
  return summe;
}

// ---------------------------------------------------------------------------
// Hergeleitete Sollwerte
// ---------------------------------------------------------------------------

/*
 * Höhenlagen ohne eigene `elevation` (Herleitung siehe Dateikopf):
 *   Basis(KG) = 0,00
 *   Basis(EG) = 0,00 + 2,75 + 0,25 = 3,00
 *   Basis(OG) = 3,00 + 2,75 + 0,25 = 6,00
 */
const BASIS_KG = 0;
const BASIS_EG = BASIS_KG + DEFAULT_LEVEL_HEIGHT + DEFAULT_SLAB; // 3,00
const BASIS_OG = BASIS_EG + DEFAULT_LEVEL_HEIGHT + DEFAULT_SLAB; // 6,00

/*
 * Flächen des Prüfhauses.
 *
 * Räume (Achspolygone):
 *   links   4,00 × 6,00 = 24,00 m²
 *   rechts  6,00 × 6,00 = 36,00 m²
 *   Summe               = 60,00 m²  ( = 10,00 × 6,00, wie es sein muss)
 *
 * Wandgrundflächen (Achslänge × [Wandstärke + 2 × 1 mm Überstand]):
 *   Außenwände  32,00 m × 0,302 m = 9,664 m²
 *   Innenwand    6,00 m × 0,202 m = 1,212 m²
 *   Summe                         = 10,876 m²
 *
 * Plattenfläche ohne Aussparungen = 60,00 + 10,876 = 70,876 m².
 */
const RAUM_LINKS = X_M * T; // 24,00
const RAUM_RECHTS = (B - X_M) * T; // 36,00
const RAEUME = RAUM_LINKS + RAUM_RECHTS; // 60,00
const AUSSEN_LAENGE = X_M + (B - X_M) + T + (B - X_M) + X_M + T; // 32,00
const WANDSTREIFEN = AUSSEN_LAENGE * (D_AUSSEN + 2 * UEBERSTAND) + T * (D_INNEN + 2 * UEBERSTAND); // 10,876
const PLATTE_BRUTTO = RAEUME + WANDSTREIFEN; // 70,876

/*
 * Aussparungen (Kanten aus `verticalCorners`, rotation = 0):
 *   Treppe  Länge 3,00 × Breite 1,00 = 3,00 m²   (x 5,50…8,50 | y 2,50…3,50)
 *   Schacht Länge 0,80 × Breite 0,60 = 0,48 m²   (x 1,60… 2,40 | y 2,70…3,30)
 */
const A_TREPPE = 3 * 1; // 3,00
const A_SCHACHT = 0.8 * 0.6; // 0,48

/** Millimetertoleranz — „auf Millimeter genau" heißt 0,0005 m Spielraum. */
const MM = 0.0005;
/** Flächen: reine Rundungstoleranz der Fließkommasummen. */
const FL = 1e-9;

// ---------------------------------------------------------------------------
// Der Prüfblock
// ---------------------------------------------------------------------------

export function pruefeGeschossdecken(check: CheckFn): void {
  console.log('\nGeschossdecken — die Platte zwischen zwei Geschossen');

  // =========================================================================
  // A — Höhenlage: die Grundlage jeder Plattenrechnung
  // =========================================================================
  const geschosse = baueGeschosse();
  const haus = baueHaus(geschosse);
  const bauteile = baueBauteile();
  const basis = levelBaseHeights(geschosse);

  check('Basis KG [m] (Bezugspunkt)', basis.get('kg') ?? -1, BASIS_KG, MM);
  check('Basis EG [m] (0,00 + 2,75 + 0,25)', basis.get('eg') ?? -1, BASIS_EG, MM);
  check('Basis OG [m] (3,00 + 2,75 + 0,25)', basis.get('og') ?? -1, BASIS_OG, MM);

  const platten = levelSlabs({
    levels: geschosse,
    rooms: haus.rooms,
    walls: haus.walls,
    nodes: haus.nodes,
    verticals: bauteile,
    base: basis,
  });

  // =========================================================================
  // B — Zahl und Lage der Platten
  // =========================================================================

  // Drei Geschosse, zwei Zwischenräume: über dem obersten sitzt das Dach.
  check('Zahl der Platten = Geschosse − 1', platten.length, geschosse.length - 1);
  check('Platte 0 liegt über dem KG', platten[0]?.levelId ?? 'fehlt', 'kg');
  check('Platte 1 liegt über dem EG', platten[1]?.levelId ?? 'fehlt', 'eg');
  check('keine Platte über dem obersten Geschoss', platten.some((p) => p.levelId === 'og'), false);

  const ueberKg = platteUeber(platten, 'kg');
  const ueberEg = platteUeber(platten, 'eg');
  check('Platte über KG vorhanden', ueberKg !== undefined, true);
  check('Platte über EG vorhanden', ueberEg !== undefined, true);
  if (!ueberKg || !ueberEg) return;

  // =========================================================================
  // C — Die Lücke ist geschlossen (auf Millimeter)
  // =========================================================================

  /*
   * Decke über dem KG.
   *   Oberkante  = Basis(EG)              = 3,00 m
   *   Unterkante = Basis(KG) + 2,75       = 2,75 m
   *   Stärke     = 3,00 − 2,75            = 0,25 m  ( = DEFAULT_SLAB)
   */
  check('Platte über KG: Oberkante [m]', ueberKg.top, BASIS_EG, MM);
  check('Platte über KG: Stärke [m]', ueberKg.thickness, DEFAULT_SLAB, MM);
  check('Platte über KG: Unterkante = OK Wand KG [m]', ueberKg.top - ueberKg.thickness, BASIS_KG + H, MM);
  check('Platte über KG: Oberkante = Basis EG [m]', ueberKg.top - (basis.get('eg') ?? 0), 0, MM);

  /*
   * Decke über dem EG.
   *   Oberkante  = Basis(OG)              = 6,00 m
   *   Unterkante = Basis(EG) + 2,75       = 5,75 m
   *   Stärke     = 6,00 − 5,75            = 0,25 m
   */
  check('Platte über EG: Oberkante [m]', ueberEg.top, BASIS_OG, MM);
  check('Platte über EG: Stärke [m]', ueberEg.thickness, DEFAULT_SLAB, MM);
  check('Platte über EG: Unterkante = OK Wand EG [m]', ueberEg.top - ueberEg.thickness, BASIS_EG + H, MM);
  check('Platte über EG: Oberkante = Basis OG [m]', ueberEg.top - (basis.get('og') ?? 0), 0, MM);

  // Keine Platte ragt über die Wandoberkante des OG (6,00 + 2,75 = 8,75 m) —
  // dort beginnt das Dach, und eine Platte darin schwebte im Dachraum.
  /*
   * Die Unterkante als eigener Wert — und warum sie da steht.
   *
   * Bis 1.13.1 trug `SlabPlan` nur `top` und `thickness`. Der Zeichenpfad
   * musste die Unterkante selbst ausrechnen und tat es falsch:
   * `ExtrudeGeometry` zieht den Umriss nach der Kippung in die Grundrissebene
   * **nach oben** auf, die Platte wurde aber an `top` angesetzt statt an
   * `top − thickness`. Sie saß damit eine volle Plattenstärke zu hoch — die
   * Lücke zwischen Wandoberkante und nächstem Geschoss blieb offen, und die
   * Decke ragte in das Geschoss darüber hinein.
   *
   * Diese drei Prüfungen nageln die Zusage fest, auf die sich der Zeichenpfad
   * jetzt verlässt: `bottom + thickness === top`, und `bottom` ist exakt die
   * Oberkante der Wände darunter. Damit steht im Zeichenpfad keine
   * Höhenrechnung mehr — der Fehler ist nicht getestet, sondern wegkonstruiert.
   *
   * **Was diese Prüfungen weiterhin nicht sehen:** ob Three.js den Körper
   * tatsächlich dorthin setzt. Der Zeichenpfad läuft im Browser und ist von
   * hier aus nicht erreichbar; er hängt am Rauchtest und am Auge.
   */
  for (const platte of platten) {
    check(`Platte über ${platte.levelId}: Unterkante + Stärke = Oberkante [m]`,
      platte.bottom + platte.thickness, platte.top, MM);
  }
  check('Platte über KG: Unterkante = OK Wand KG [m]', ueberKg.bottom, BASIS_KG + H, MM);
  check('Platte über EG: Unterkante = OK Wand EG [m]', ueberEg.bottom, BASIS_EG + H, MM);

  check('höchste Plattenoberkante [m]', Math.max(...platten.map((p) => p.top)), BASIS_OG, MM);
  check('Wandoberkante OG [m] liegt darüber', BASIS_OG + H > Math.max(...platten.map((p) => p.top)), true);

  // =========================================================================
  // D — Von Hand gesetzte Höhenlage gewinnt
  // =========================================================================

  /*
   * Das OG wird bewusst 40 cm höher gesetzt: elevation = 6,40 m.
   * Die Wandoberkante des EG bleibt bei 3,00 + 2,75 = 5,75 m, also
   *   Stärke = 6,40 − 5,75 = 0,65 m.
   * Die Decke wird dicker — die Lücke bleibt geschlossen. Das ist der
   * bauliche Normalfall einer abgehängten Decke oder eines Aufbaus über der
   * Rohdecke, nicht ein Rechenfehler.
   */
  const hochGeschosse = baueGeschosse(6.4);
  const hochHaus = baueHaus(hochGeschosse);
  const hochBasis = levelBaseHeights(hochGeschosse);
  const hoch = levelSlabs({
    levels: hochGeschosse,
    rooms: hochHaus.rooms,
    walls: hochHaus.walls,
    nodes: hochHaus.nodes,
    verticals: [],
    base: hochBasis,
  });
  const hochEg = platteUeber(hoch, 'eg');
  check('OG höher gesetzt: Zahl der Platten', hoch.length, 2);
  check('OG höher gesetzt: Basis OG [m]', hochBasis.get('og') ?? -1, 6.4, MM);
  check('OG höher gesetzt: Platte über EG dicker [m]', hochEg?.thickness ?? -1, 6.4 - (BASIS_EG + H), MM);
  check('OG höher gesetzt: Oberkante [m]', hochEg?.top ?? -1, 6.4, MM);
  check(
    'OG höher gesetzt: Unterkante bleibt OK Wand EG [m]',
    (hochEg?.top ?? 0) - (hochEg?.thickness ?? 0),
    BASIS_EG + H,
    MM,
  );

  /*
   * Und nun so tief, dass sich die Geschosse überschneiden: elevation = 5,50 m
   * bei einer Wandoberkante des EG von 5,75 m. Die rechnerische Stärke wäre
   *   5,50 − 5,75 = −0,25 m,
   * also negativ. Eine Platte negativer Stärke gibt es nicht; richtig ist
   * **keine** Platte und nicht eine von 0,25 m.
   */
  const tiefGeschosse = baueGeschosse(5.5);
  const tiefHaus = baueHaus(tiefGeschosse);
  const tief = levelSlabs({
    levels: tiefGeschosse,
    rooms: tiefHaus.rooms,
    walls: tiefHaus.walls,
    nodes: tiefHaus.nodes,
    verticals: [],
    base: levelBaseHeights(tiefGeschosse),
  });
  check('Geschosse überschneiden sich: Zahl der Platten', tief.length, 1);
  check('Geschosse überschneiden sich: keine Platte über EG', tief.some((p) => p.levelId === 'eg'), false);
  check('Geschosse überschneiden sich: Platte über KG bleibt', tief[0]?.levelId ?? 'fehlt', 'kg');

  /*
   * Die Grenze liegt bei 2 cm (`MIN_THICKNESS`): darunter ist die Platte ein
   * Strich und kein Bauteil. Geprüft wird beidseits der Grenze, aber mit
   * Abstand zu ihr —
   *   5,75 + 0,025 = 5,775  →  Platte von 25 mm
   *   5,75 + 0,015 = 5,765  →  keine Platte
   * Genau *auf* der Grenze zu prüfen wäre eine Prüfung der
   * Fließkommaarithmetik und nicht der Regel: 5,77 − 5,75 ergibt in `double`
   * 0,019999999999999574 und liegt damit knapp unter 0,02.
   */
  const grenzeHaus = baueHaus(baueGeschosse());
  const beiGrenze = (elevation: number): SlabPlan[] => {
    const lv = baueGeschosse(elevation);
    return levelSlabs({
      levels: lv,
      rooms: grenzeHaus.rooms,
      walls: grenzeHaus.walls,
      nodes: grenzeHaus.nodes,
      verticals: [],
      base: levelBaseHeights(lv),
    });
  };
  check('Stärke 25 mm: Platte entsteht', beiGrenze(BASIS_EG + H + 0.025).length, 2);
  check('Stärke 25 mm: Stärke [m]', platteUeber(beiGrenze(BASIS_EG + H + 0.025), 'eg')?.thickness ?? -1, 0.025, MM);
  check('Stärke 15 mm: keine Platte', beiGrenze(BASIS_EG + H + 0.015).length, 1);

  /*
   * Fehlende lichte Geschosshöhe — die Klammer um die beiden Vorgabewerte.
   *
   * Steht am EG keine brauchbare Höhe, greifen beide Module auf ihre Vorgabe
   * zurück: `levelBaseHeights` stapelt das OG auf
   *   3,00 + 2,75 + 0,25 = 6,00 m,
   * und `levelSlabs` setzt die Plattenunterkante auf
   *   3,00 + 2,75 = 5,75 m.
   * Die Stärke bleibt damit 0,25 m — aber nur, solange beide dieselbe Zahl
   * benutzen. Diese Prüfung schlägt an, sobald die Vorgaben auseinanderlaufen.
   */
  const ohneHoehe = baueGeschosseOhneHoehe();
  const ohneHoeheHaus = baueHaus(ohneHoehe);
  const ohneHoeheBasis = levelBaseHeights(ohneHoehe);
  const ohneHoehePlatten = levelSlabs({
    levels: ohneHoehe,
    rooms: ohneHoeheHaus.rooms,
    walls: ohneHoeheHaus.walls,
    nodes: ohneHoeheHaus.nodes,
    verticals: [],
    base: ohneHoeheBasis,
  });
  const ohneHoeheEg = platteUeber(ohneHoehePlatten, 'eg');
  check('EG ohne lichte Höhe: Basis OG [m]', ohneHoeheBasis.get('og') ?? -1, BASIS_OG, MM);
  check('EG ohne lichte Höhe: Plattenstärke [m]', ohneHoeheEg?.thickness ?? -1, DEFAULT_SLAB, MM);
  check(
    'EG ohne lichte Höhe: Unterkante [m] (3,00 + 2,75)',
    (ohneHoeheEg?.top ?? 0) - (ohneHoeheEg?.thickness ?? 0),
    BASIS_EG + DEFAULT_LEVEL_HEIGHT,
    MM,
  );

  // =========================================================================
  // E — Der Umriss: Räume **und** Wandgrundflächen
  // =========================================================================

  // Ohne Aussparungen, damit die Fläche unmittelbar mit der Handrechnung
  // vergleichbar ist.
  const ohneLoecher = levelSlabs({
    levels: geschosse,
    rooms: haus.rooms,
    walls: haus.walls,
    nodes: haus.nodes,
    verticals: [],
    base: basis,
  });
  const glatt = platteUeber(ohneLoecher, 'kg');
  check('Platte ohne Aussparungen vorhanden', glatt !== undefined, true);
  if (!glatt) return;

  // Zwei Räume + sieben Wände = neun Umrisspolygone. Sie dürfen sich
  // überlappen; das ist bei einem undurchsichtigen Volumenkörper folgenlos.
  check('Umrisse der Platte über KG (2 Räume + 7 Wände)', glatt.outlines.length, 9);
  check('Aussparungen ohne vertikale Bauteile', glatt.holes.length, 0);

  // Erkannte Räume: zwei je Geschoss, Bruttoflächen 24,00 und 36,00 m².
  const raeumeKg = haus.rooms.filter((r) => r.levelId === 'kg');
  const bruttoKg = raeumeKg.reduce((s, r) => s + r.grossArea, 0);
  check('erkannte Räume im KG', raeumeKg.length, 2);
  check('Summe Raum-Bruttoflächen KG [m²] (24,00 + 36,00)', bruttoKg, RAEUME, 1e-6);

  /*
   * Der Nachweis, dass die Wandflächen im Umriss stecken: ohne sie fehlte der
   * umlaufende Streifen, und die Platte endete in der Wandmitte.
   *   Plattenfläche  = 70,876 m²
   *   Räume allein   = 60,000 m²
   *   Differenz      = 10,876 m²  = genau die gerechneten Wandgrundflächen
   */
  const flaecheGlatt = slabArea(glatt);
  check('Plattenfläche über KG [m²] (60,000 + 10,876)', flaecheGlatt, PLATTE_BRUTTO, 1e-6);
  check('Plattenfläche größer als die Räume allein', flaecheGlatt > bruttoKg, true);
  check('fehlender Streifen [m²] = Wandgrundflächen', flaecheGlatt - bruttoKg, WANDSTREIFEN, 1e-6);
  check('Wandstreifen [m²] (32,00 × 0,302 + 6,00 × 0,202)', WANDSTREIFEN, 10.876, 1e-9);

  // =========================================================================
  // F — Aussparungen: Treppe und Schacht
  // =========================================================================

  /*
   * Die Treppe steht im EG, ohne Zielgeschoss. Sie durchdringt genau eine
   * Decke — die über dem EG. In der Decke über dem KG hat sie nichts zu
   * suchen: dort läge ein Loch unter dem Antritt.
   *
   * Der Schacht beginnt im KG und endet im OG. Er durchdringt die Decke über
   * dem KG und die über dem EG, also beide.
   *
   * Erwartete Löcher:  über KG → 1 (Schacht)
   *                    über EG → 2 (Treppe + Schacht)
   */
  check('Löcher in der Decke über KG', ueberKg.holes.length, 1);
  check('Löcher in der Decke über EG', ueberEg.holes.length, 2);
  check('Lochfläche über KG [m²] (nur Schacht 0,48)', lochflaeche(ueberKg), A_SCHACHT, 1e-9);
  check('Lochfläche über EG [m²] (0,48 + 3,00)', lochflaeche(ueberEg), A_SCHACHT + A_TREPPE, 1e-9);

  /*
   * Plattenflächen mit Aussparungen:
   *   über KG = 70,876 − 0,48         = 70,396 m²
   *   über EG = 70,876 − 0,48 − 3,00  = 67,396 m²
   */
  check('Plattenfläche über KG [m²] (70,876 − 0,48)', slabArea(ueberKg), PLATTE_BRUTTO - A_SCHACHT, 1e-6);
  check(
    'Plattenfläche über EG [m²] (70,876 − 0,48 − 3,00)',
    slabArea(ueberEg),
    PLATTE_BRUTTO - A_SCHACHT - A_TREPPE,
    1e-6,
  );

  /*
   * Gegenprobe ohne Schacht: dann bleibt in der Decke über dem KG kein Loch,
   * und die Decke über dem EG trägt nur noch das Treppenauge. Damit ist
   * ausgeschlossen, dass die Löcher aus einer anderen Quelle stammen.
   */
  const nurTreppe = levelSlabs({
    levels: geschosse,
    rooms: haus.rooms,
    walls: haus.walls,
    nodes: haus.nodes,
    verticals: bauteile.filter((v) => v.id === 'treppe'),
    base: basis,
  });
  check('ohne Schacht: kein Loch über dem KG', platteUeber(nurTreppe, 'kg')?.holes.length ?? -1, 0);
  check('ohne Schacht: ein Loch über dem EG', platteUeber(nurTreppe, 'eg')?.holes.length ?? -1, 1);

  /*
   * Und ein Schacht **ohne** Zielgeschoss endet im nächsthöheren Geschoss: er
   * durchdringt genau eine Decke, nicht zwei.
   */
  const kurzerSchacht: VerticalElement = { ...bauteile[1], toLevelId: undefined, id: 'schacht-kurz' };
  const kurz = levelSlabs({
    levels: geschosse,
    rooms: haus.rooms,
    walls: haus.walls,
    nodes: haus.nodes,
    verticals: [kurzerSchacht],
    base: basis,
  });
  check('Schacht ohne Zielgeschoss: Loch über dem KG', platteUeber(kurz, 'kg')?.holes.length ?? -1, 1);
  check('Schacht ohne Zielgeschoss: kein Loch über dem EG', platteUeber(kurz, 'eg')?.holes.length ?? -1, 0);

  // =========================================================================
  // G — holeFitsOutline: passt die Aussparung in diese eine Kontur?
  // =========================================================================

  /*
   * Three.js hängt Löcher an *eine* Kontur. Ein Treppenauge, das nicht
   * vollständig im betrachteten Raumpolygon liegt, würde dort ein Loch ins
   * Nichts schneiden — deshalb ist die Prüfung „alle Ecken innen" und nicht
   * „irgendeine Ecke innen".
   *
   * Der rechte Raum hat das Achspolygon (4,0) – (10,0) – (10,6) – (4,6).
   */
  const raumRechts = [
    { x: X_M, y: 0 },
    { x: B, y: 0 },
    { x: B, y: T },
    { x: X_M, y: T },
  ];
  // Treppe: x 5,50…8,50 | y 2,50…3,50 — vollständig innen.
  check('Loch innerhalb des Umrisses', holeFitsOutline(rechteck(7, 3, 3, 1), raumRechts), true);
  // Weit außerhalb — beide Achsen daneben.
  check('Loch außerhalb des Umrisses', holeFitsOutline(rechteck(20, 20, 1, 1), raumRechts), false);
  /*
   * Auf der Kante: Mittelpunkt (4,00 | 3,00), Kantenlänge 1,00 m. Zwei Ecken
   * liegen bei x = 3,50 (außen), zwei bei x = 4,50 (innen). „Alle Ecken innen"
   * ist damit verletzt — richtig, denn die Kontur kann dieses Loch nicht
   * aufnehmen.
   */
  check('Loch schneidet die Kante', holeFitsOutline(rechteck(X_M, 3, 1, 1), raumRechts), false);
  // Grenzfälle: ein Polygon mit weniger als drei Ecken ist keine Fläche.
  check('leeres Loch', holeFitsOutline([], raumRechts), false);
  check('Zweieck als Loch', holeFitsOutline([{ x: 5, y: 3 }, { x: 6, y: 3 }], raumRechts), false);
  check('leerer Umriss', holeFitsOutline(rechteck(7, 3, 1, 1), []), false);
  check('Zweieck als Umriss', holeFitsOutline(rechteck(7, 3, 1, 1), [{ x: 4, y: 0 }, { x: 10, y: 0 }]), false);
  // Und der Umriss des *linken* Raums nimmt das Treppenauge nicht auf.
  const raumLinks = [
    { x: 0, y: 0 },
    { x: X_M, y: 0 },
    { x: X_M, y: T },
    { x: 0, y: T },
  ];
  check('Treppenauge passt nicht in den linken Raum', holeFitsOutline(rechteck(7, 3, 3, 1), raumLinks), false);
  check('Schacht passt in den linken Raum', holeFitsOutline(rechteck(2, 3, 0.8, 0.6), raumLinks), true);

  // =========================================================================
  // H — slabArea gegen Handrechnung
  // =========================================================================

  const plan = (outlines: Vec2[][], holes: Vec2[][]): SlabPlan => ({
    levelId: 'eg',
    top: BASIS_OG,
    bottom: BASIS_OG - DEFAULT_SLAB,
    thickness: DEFAULT_SLAB,
    outlines,
    holes,
  });
  // 4,00 × 5,00 = 20,00 m²
  check('slabArea Rechteck 4×5 [m²]', slabArea(plan([rechteck(0, 0, 4, 5)], [])), 20, FL);
  // 20,00 − (1,00 × 2,00) = 18,00 m²
  check('slabArea mit Loch 1×2 [m²]', slabArea(plan([rechteck(0, 0, 4, 5)], [rechteck(0, 0, 1, 2)])), 18, FL);
  // Zwei getrennte Rechtecke: 20,00 + (3,00 × 2,00) = 26,00 m²
  check(
    'slabArea zwei Umrisse [m²] (20,00 + 6,00)',
    slabArea(plan([rechteck(0, 0, 4, 5), rechteck(10, 0, 3, 2)], [])),
    26,
    FL,
  );
  // Ein Loch, das größer ist als der Umriss, ergibt keine negative Fläche:
  // 20,00 − 100,00 = −80,00 → 0,00 m².
  check('slabArea nie negativ [m²]', slabArea(plan([rechteck(0, 0, 4, 5)], [rechteck(0, 0, 10, 10)])), 0, FL);

  // =========================================================================
  // I — Leere und unvollständige Modelle
  // =========================================================================

  // Ein frisch angelegtes Dokument hat nichts davon — und darf nicht abstürzen.
  check(
    'Modell ohne alles: keine Platten',
    levelSlabs({ levels: [], rooms: [], walls: [], nodes: {}, verticals: [], base: new Map() }).length,
    0,
  );
  // Geschosse ohne Räume und Wände: kein Umriss, also auch keine Platte —
  // eine Platte ohne Grundriss wäre eine Fläche aus dem Nichts.
  check(
    'Geschosse ohne Räume und Wände: keine Platten',
    levelSlabs({
      levels: geschosse,
      rooms: [],
      walls: [],
      nodes: {},
      verticals: [],
      base: basis,
    }).length,
    0,
  );
  // Ein einzelnes Geschoss hat keinen Nachbarn darüber.
  const nurEg = geschosse.filter((l) => l.id === 'eg');
  check(
    'ein einzelnes Geschoss: keine Platte',
    levelSlabs({
      levels: nurEg,
      rooms: haus.rooms,
      walls: haus.walls,
      nodes: haus.nodes,
      verticals: bauteile,
      base: levelBaseHeights(nurEg),
    }).length,
    0,
  );
  // Fehlt die Höhenlage im Nachschlagewerk ganz, greift 0 für beide Geschosse:
  // Stärke = 0 − (0 + 2,75) = −2,75 → keine Platte, kein Absturz.
  check(
    'leere Höhenkarte: keine Platte',
    levelSlabs({
      levels: geschosse,
      rooms: haus.rooms,
      walls: haus.walls,
      nodes: haus.nodes,
      verticals: bauteile,
      base: new Map<string, number>(),
    }).length,
    0,
  );

  // =========================================================================
  // 9 · Die Bodenplatte — das Haus steht nicht in der Luft
  // =========================================================================
  /*
   * Sie ist der Gegenstückfehler zur Deckenlücke: die Wände beginnen bei
   * null, darunter war nichts, und von schräg unten sah man durch den
   * Grundriss hindurch.
   *
   * Sollwerte von Hand: die Platte liegt **unter** dem untersten Geschoss.
   * Das Prüfhaus hat den Keller auf 0,00 m, also Oberkante 0,00 und
   * Unterkante −0,25 (`GROUND_SLAB`). Der Umriss ist derselbe wie bei der
   * Geschossdecke — Raumpolygone plus Wandgrundflächen, also 70,876 m² —,
   * Aussparungen bekommt sie keine.
   */
  {
    const boden = groundSlab({
      levels: geschosse,
      rooms: haus.rooms,
      walls: haus.walls,
      nodes: haus.nodes,
      verticals: bauteile,
      base: basis,
    });
    check('Die Bodenplatte entsteht', boden !== undefined, true);
    if (boden) {
      check('Bodenplatte: sie gehört zum untersten Geschoss', boden.levelId, 'kg');
      check('Bodenplatte: als Bodenplatte gekennzeichnet', boden.ground === true, true);
      check('Bodenplatte: Oberkante = Basis des untersten Geschosses [m]', boden.top, BASIS_KG, MM);
      check('Bodenplatte: Unterkante [m]', boden.bottom, BASIS_KG - GROUND_SLAB, MM);
      check('Bodenplatte: Unterkante + Stärke = Oberkante [m]', boden.bottom + boden.thickness, boden.top, MM);
      check('Bodenplatte: keine Aussparung', boden.holes.length, 0);
      check('Bodenplatte: Fläche wie die Geschossdecke [m²]', slabArea(boden), 70.876, 0.002);
    }

    // Sie steht nicht in der Deckenliste: „Zahl der Platten = Geschosse − 1"
    // gilt weiterhin, und eine Bodenplatte ist keine Geschossdecke.
    check('Die Deckenliste enthält sie nicht', platten.some((p) => p.ground === true), false);

    // Ein Modell ohne Räume und Wände hat keine Bodenplatte — es gibt nichts
    // zu unterfangen.
    check('Ohne Grundriss keine Bodenplatte',
      groundSlab({ levels: geschosse, rooms: [], walls: [], nodes: {}, verticals: [], base: basis }) === undefined,
      true);
    check('Ohne Geschoss keine Bodenplatte',
      groundSlab({ levels: [], rooms: [], walls: [], nodes: {}, verticals: [], base: new Map() }) === undefined,
      true);
  }

  // =========================================================================
  // F — Die oberste Geschossdecke
  // =========================================================================
  /*
   * **Warum sie nicht in `levelSlabs` steckt.** Oben in Abschnitt B steht
   * die Zusage „Zahl der Platten = Geschosse − 1", und an ihr hängt die
   * ganze Stapelrechnung. Eine Option, die diese Zahl manchmal um eins
   * erhöht, machte die Zusage unprüfbar. Deshalb eine eigene Funktion mit
   * einer eigenen Zusage — genau wie bei der Bodenplatte.
   *
   * **Die Lage, von Hand gerechnet.** Oberstes Geschoss ist das OG mit
   * Basis 6,00 m (0,00 + 2,75 + 0,25 + 2,75 + 0,25) und lichter Höhe
   * 2,75 m. Die Decke sitzt also mit ihrer **Unterkante** auf
   * 6,00 + 2,75 = 8,75 m und mit ihrer Oberkante auf 8,75 + 0,20 = 8,95 m.
   * Die Unterkante ist die Oberkante der Wände darunter — dieselbe Regel
   * wie bei jeder Geschossdecke, und genau die war in 1.12.0 vertauscht.
   */
  {
    const eingabe = {
      levels: geschosse,
      rooms: haus.rooms,
      walls: haus.walls,
      nodes: haus.nodes,
      verticals: bauteile,
      base: basis,
    };
    const decke = topSlab(eingabe);
    check('Es gibt eine oberste Decke', decke !== undefined, true);
    check('Sie gehört zum obersten Geschoss', decke?.levelId ?? '—', 'og');
    check('Unterkante = Basis OG + lichte Höhe [m]', decke?.bottom ?? -1, (basis.get('og') ?? 0) + H, MM);
    check('Oberkante = Unterkante + Stärke [m]', decke?.top ?? -1, (basis.get('og') ?? 0) + H + TOP_SLAB, MM);
    check('Stärke 0,20 m', decke?.thickness ?? -1, TOP_SLAB, MM);
    check('bottom + thickness === top', Math.abs((decke?.bottom ?? 0) + (decke?.thickness ?? 0) - (decke?.top ?? 0)) < 1e-9, true);
    check('Sie ist als oberste gekennzeichnet', decke?.oberste === true, true);
    check('Und nicht als Bodenplatte', decke?.ground === true, false);

    /*
     * Sie liegt **über** allen Zwischendecken. Läge sie darunter, säße der
     * Deckel mitten im Haus — und man sähe es erst im Bild.
     */
    const hoechsteZwischendecke = Math.max(...platten.map((p) => p.top));
    check('Sie liegt über jeder Zwischendecke', (decke?.bottom ?? 0) > hoechsteZwischendecke, true);

    // `levelSlabs` bleibt unberührt: dieselbe Zahl wie in Abschnitt B.
    check('levelSlabs zählt weiterhin Geschosse − 1', levelSlabs(eingabe).length, geschosse.length - 1);

    /*
     * Ein Schacht, der über das oberste Geschoss hinausläuft, durchstößt
     * auch diese Decke — sonst endete er im Bild an einer Platte, durch die
     * er in Wirklichkeit hindurchgeht.
     */
    check('Aussparungen werden übernommen', Array.isArray(decke?.holes), true);

    // Ohne Geschosse gibt es nichts zu decken.
    check('Ohne Geschoss keine Decke', topSlab({ ...eingabe, levels: [] }) === undefined, true);
    // Ohne Wände und Räume auch nicht — ein Deckel über nichts.
    check('Ohne Umriss keine Decke', topSlab({ ...eingabe, rooms: [], walls: [] }) === undefined, true);
  }
}
