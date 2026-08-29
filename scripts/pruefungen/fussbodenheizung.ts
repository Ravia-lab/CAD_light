/**
 * Prüfblock für `src/lib/floorLoopLayout.ts` — die Verlegekurve der
 * Fußbodenheizung.
 *
 * **Warum dieser Block so aussieht, wie er aussieht.** Eine Verlegekurve ist
 * kein Zahlenwert, den man gegen einen Sollwert hält, sondern eine Geometrie.
 * Falsch kann sie auf vier Arten sein, und jede davon fällt einem Menschen erst
 * im gedruckten Plan auf:
 *
 *  1. Sie läuft aus dem Raum heraus oder klebt an der Wand — geprüft wird
 *     deshalb *jeder* Punkt und *jede* Sehnenmitte gegen das Polygon und
 *     gegen den Randabstand, nicht ein Stichprobenpunkt.
 *  2. Sie liegt zu dicht bei sich selbst — zwei Rohre in derselben
 *     Estrichebene gibt es nicht. Geprüft wird der kleinste Abstand zwischen
 *     Kurvenpunkten, die entlang der Kurve weit auseinanderliegen; die Kehre
 *     selbst ist naturgemäß eng und wird über die Bogenlänge ausgenommen.
 *  3. Sie hat die falsche Länge — dann stimmt die Massenermittlung nicht.
 *     Der Sollwert ist hier nicht abgeschrieben, sondern hergeleitet
 *     (siehe unten).
 *  4. Sie entsteht gar nicht, aber das Programm behauptet etwas — deshalb die
 *     Grenzfälle ohne Fläche und ohne Platz.
 *
 * **Herleitung der Sollwerte.**
 *
 * *Belegbare Fläche.* Ein Rechteck 6,00 × 4,00 m mit 10 cm Randabstand ergibt
 * 5,80 × 3,80 = 22,04 m². Reine Geometrie, keine Annahme.
 *
 * *Länge des Mäanders.* Die Bahnen liegen im Abstand a in einem Band der Höhe
 * H = 3,80 m; es passen n = ⌊H/a⌋ + 1 hinein. Jede Bahn ist B = 5,80 m lang,
 * also Feldlänge = n · B. Die Faustregel Fläche/a ergibt B · H / a. Das
 * Verhältnis ist damit exakt n · a / H — bei a = 0,15 m sind das
 * 26 · 0,15 / 3,80 = 1,0263. Die Toleranz der Prüfung folgt daraus und ist
 * nicht geraten: die Faustregel kann höchstens um a/H danebenliegen, weil die
 * Bahnenzahl ganzzahlig ist.
 *
 * *Länge der Schnecke.* Sie ist systematisch kürzer als Fläche/a, und zwar
 * nicht wegen eines Fehlers: die äußerste Windung rückt schon ein, während sie
 * den Raum umrundet, und in der Mitte bleibt der Kern der letzten Kehre. Die
 * Prüfung hält deshalb nicht die Länge fest, sondern das, was die Schnecke
 * zusichert — Randabstand, Selbstabstand, keine Lücke außer dem Kern.
 *
 * *Fünfte Art, falsch zu sein: die Kurve steht schief im Raum.* Sie hält dann
 * jede der vier Bedingungen oben ein und ist trotzdem unbrauchbar — kein
 * Verleger legt Bahnen, die um ein paar Grad gegen die Wand kippen. Weil sich
 * das mit „innerhalb" und „Abstand" nicht fassen lässt, wird es eigens
 * gemessen: `wandparallelerAnteil` bestimmt, wie viel Rohrlänge in Richtung
 * einer Polygonkante liegt. Der Sollwert ist hergeleitet, nicht gegriffen:
 * eine bifilare Schnecke *muss* je Umlauf um 2a einrücken (sonst liegt neben
 * der Vorlaufwindung keine Rücklaufwindung), und dieses Einrücken kann nur
 * quer zur Hauptrichtung geschehen. Bei einem Rechteck B × H mit Bahnen
 * entlang B entfallen damit die Kehren an den beiden H-Wänden auf das
 * Einrücken und die Bahnen an den B-Wänden bleiben wandparallel; der
 * wandparallele Anteil ist also mindestens B/(B+H). Für 6,00 × 4,00 m sind
 * das 0,60. Geprüft wird gegen 0,5 — mit Reserve für die innersten Windungen,
 * die kürzer sind als das Verhältnis der Außenwände.
 *
 * *Selbstabstand der Schnecke.* Zwei benachbarte Windungen liegen senkrecht
 * zur Wand genau a auseinander — das ist Konstruktion, nicht Zufall: Hin- und
 * Rückweg werden am selben Umlaufmaß abgegriffen und unterscheiden sich um
 * genau eine Einrückung a. Quer zur *Kurve* gemessen ist der Abstand a·cos α,
 * wobei α die Neigung der Kurve gegen die Wand ist. Auf den Bahnen ist α = 0,
 * an den Kehren wenige Grad, und nur an der mittleren Kehre — wo die
 * innerste Windung nur noch wenige Dezimeter misst — steigt α auf rund 30°.
 * Der zusicherbare Wert ist damit a·cos 30° = 0,87·a; geprüft wird gegen
 * 0,85·a. Für den Mäander gilt weiter a, dort gibt es keine Neigung.
 */

import type { CheckFn } from './typ';
import type { Vec2 } from '../../src/types/bim';
import {
  DEFAULT_EDGE_CLEARANCE,
  DEFAULT_MAX_CIRCUIT_LENGTH,
  DEFAULT_MIN_RUN_LENGTH,
  DEFAULT_OBSTACLE_CLEARANCE,
  FLOOR_OBSTACLE_TYPES,
  fixtureFootprint,
  measureLayableArea,
  planFloorLoops,
  type FloorLoopLayout,
} from '../../src/lib/floorLoopLayout';
import { distanceToSegment, pointInPolygon, polygonArea } from '../../src/lib/geometry';

// ---------------------------------------------------------------------------
// Prüfformen — bewusst die, die der Anwender wirklich zeichnet
// ---------------------------------------------------------------------------

const rechteck = (b: number, h: number): Vec2[] => [
  { x: 0, y: 0 },
  { x: b, y: 0 },
  { x: b, y: h },
  { x: 0, y: h },
];

/** L-Form: Rechteck mit ausgeschnittener Ecke. */
const lForm: Vec2[] = [
  { x: 0, y: 0 },
  { x: 6, y: 0 },
  { x: 6, y: 2.5 },
  { x: 3, y: 2.5 },
  { x: 3, y: 5 },
  { x: 0, y: 5 },
];

/** U-Form: zwei Schenkel um einen Einschnitt. */
const uForm: Vec2[] = [
  { x: 0, y: 0 },
  { x: 7, y: 0 },
  { x: 7, y: 5 },
  { x: 5, y: 5 },
  { x: 5, y: 2 },
  { x: 2, y: 2 },
  { x: 2, y: 5 },
  { x: 0, y: 5 },
];

/** V-Form: Rechteck mit keilförmigem Einschnitt — lauter schräge Kanten. */
const vForm: Vec2[] = [
  { x: 0, y: 0 },
  { x: 3, y: 4 },
  { x: 6, y: 0 },
  { x: 6, y: 5 },
  { x: 0, y: 5 },
];

// ---------------------------------------------------------------------------
// Maße an der fertigen Kurve
// ---------------------------------------------------------------------------

/** Kleinster Abstand eines Punktes zum Polygonrand [m]. */
function randabstand(p: Vec2, poly: readonly Vec2[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const d = distanceToSegment(p, poly[i], poly[(i + 1) % poly.length]);
    if (d < best) best = d;
  }
  return best;
}

/**
 * Kleinster Randabstand über die ganze Kurve — inklusive der Sehnenmitten.
 *
 * Die Punkte allein reichen nicht: eine Sehne über eine einspringende Ecke
 * könnte hinauslaufen, obwohl beide Endpunkte drinnen liegen.
 */
function kleinsterRandabstand(layout: FloorLoopLayout, poly: readonly Vec2[]): number {
  let best = Infinity;
  for (const c of layout.curves) {
    for (let i = 0; i < c.points.length; i++) {
      const proben: Vec2[] = [c.points[i]];
      if (i > 0) {
        for (let k = 1; k < 8; k++) {
          const t = k / 8;
          proben.push({
            x: c.points[i - 1].x + (c.points[i].x - c.points[i - 1].x) * t,
            y: c.points[i - 1].y + (c.points[i].y - c.points[i - 1].y) * t,
          });
        }
      }
      for (const p of proben) {
        if (!pointInPolygon(p, poly)) return -1; // außerhalb: sofort durchgefallen
        const d = randabstand(p, poly);
        if (d < best) best = d;
      }
    }
  }
  return best;
}

/**
 * Kleinster Abstand zwischen Kurvenstellen, die entlang der Kurve mindestens
 * `mindestBogen` auseinanderliegen.
 *
 * Ohne diese Bedingung würde jede Kehre als Beinahe-Berührung gemeldet: an
 * einer Kehre führt die Kurve das Rohr absichtlich um sich selbst herum. Was
 * geprüft werden soll, ist etwas anderes — dass sich zwei *entfernte* Teile
 * der Verlegung nicht ins Gehege kommen. Über verschiedene Kreise hinweg gilt
 * die Bedingung immer.
 */
function kleinsterSelbstabstand(layout: FloorLoopLayout, mindestBogen: number): number {
  const punkte: { p: Vec2; kurve: number; bogen: number }[] = [];
  layout.curves.forEach((c, ci) => {
    let bogen = 0;
    for (let i = 0; i < c.points.length; i++) {
      if (i > 0) bogen += Math.hypot(c.points[i].x - c.points[i - 1].x, c.points[i].y - c.points[i - 1].y);
      punkte.push({ p: c.points[i], kurve: ci, bogen });
    }
  });
  let best = Infinity;
  for (let i = 0; i < punkte.length; i++) {
    for (let j = i + 1; j < punkte.length; j++) {
      const a = punkte[i];
      const b = punkte[j];
      if (a.kurve === b.kurve && Math.abs(a.bogen - b.bogen) < mindestBogen) continue;
      const d = Math.hypot(a.p.x - b.p.x, a.p.y - b.p.y);
      if (d < best) best = d;
    }
  }
  return best;
}

/**
 * Anteil der Rohrlänge, der parallel zu einer Polygonkante liegt [-].
 *
 * Das Maß für „steht die Verlegung gerade im Raum". Es kommt ohne
 * Vorstellung davon aus, wie der Raum aussehen *sollte*: verglichen wird
 * jedes Kurvenstück mit den Richtungen der Wände, die tatsächlich da sind.
 * Ein um 2° gekipptes Rechteck fällt damit genauso durch wie ein um 30°
 * gedrehtes — und ein bewusst schräg gestellter Raum besteht, weil seine
 * Wände die Bezugsrichtung sind.
 *
 * @param toleranz zulässige Abweichung [°]
 */
function wandparallelerAnteil(layout: FloorLoopLayout, poly: readonly Vec2[], toleranz: number): number {
  const richtungen: number[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-9) continue;
    // Nur die Richtung zählt, nicht der Richtungssinn: 180° ist dieselbe Wand.
    richtungen.push((((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI) % 180 + 180) % 180);
  }
  let gesamt = 0;
  let parallel = 0;
  for (const c of layout.curves) {
    for (let i = 1; i < c.points.length; i++) {
      const dx = c.points[i].x - c.points[i - 1].x;
      const dy = c.points[i].y - c.points[i - 1].y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-9) continue;
      const winkel = (((Math.atan2(dy, dx) * 180) / Math.PI) % 180 + 180) % 180;
      let best = Infinity;
      for (const r of richtungen) {
        const d = Math.abs(winkel - r);
        best = Math.min(best, d, 180 - d);
      }
      gesamt += len;
      if (best <= toleranz) parallel += len;
    }
  }
  return gesamt > 0 ? parallel / gesamt : 0;
}

/** Kleinster Abstand zwischen Kurven *verschiedener* Kreise [m]. */
function kleinsterKreisabstand(layout: FloorLoopLayout): number {
  let best = Infinity;
  for (const a of layout.curves) {
    for (const b of layout.curves) {
      if (a.loop >= b.loop) continue;
      for (const p of a.points) {
        for (let i = 1; i < b.points.length; i++) {
          const d = distanceToSegment(p, b.points[i - 1], b.points[i]);
          if (d < best) best = d;
        }
      }
    }
  }
  return best;
}

// ---------------------------------------------------------------------------

export function pruefeFussbodenheizung(check: CheckFn): void {
  // --- Vorgabewerte sind sichtbar und benannt ------------------------------
  // Sie stehen im Ergebnis, damit im Plan nachvollziehbar ist, wie die
  // belegbare Fläche zustande kam. Eine unsichtbare Konstante wäre genau das,
  // was hier nicht sein darf.
  check('Randabstand ist vorbelegt und liegt im üblichen Bereich 5–10 cm', DEFAULT_EDGE_CLEARANCE, 0.1, 1e-9);
  check('Abstand zu Einbauten ist vorbelegt', DEFAULT_OBSTACLE_CLEARANCE, 0.05, 1e-9);
  check('Kürzeste Bahn ist vorbelegt', DEFAULT_MIN_RUN_LENGTH, 0.3, 1e-9);

  const a = 0.15;
  const raum = rechteck(6, 4);

  // --- Belegbare Fläche ----------------------------------------------------
  // 5,80 × 3,80 = 22,04 m². Die Integration über Schnittlinien muss das auf
  // wenige Promille treffen; die Toleranz ist die Auflösung der Integration.
  const belegbar = measureLayableArea(raum, { spacing: a });
  check('Belegbare Fläche 6,00 × 4,00 bei 10 cm Rand', belegbar, 22.04, 0.02);
  check('… und sie ist kleiner als die Grundfläche', belegbar < polygonArea(raum), true);

  // Der Randabstand ist ein Parameter, kein Naturgesetz: 5 cm statt 10 cm
  // müssen 5,90 × 3,90 = 23,01 m² ergeben.
  check(
    'Randabstand wirkt sich aus (5 cm → 5,90 × 3,90)',
    measureLayableArea(raum, { spacing: a, edgeClearance: 0.05 }),
    23.01,
    0.02,
  );

  // --- Mäander im Rechteck -------------------------------------------------
  const maeander = planFloorLoops(raum, { spacing: a, loops: 1, pattern: 'maeander' });
  check('Mäander liefert genau einen Zug', maeander.curves.length, 1);
  check('… als ein Kreis', maeander.loops, 1);
  check('… und meldet sich als vollständig', maeander.complete, true);
  check('… mit dem gewünschten Muster', maeander.pattern, 'maeander');
  check('… und benennt den angesetzten Randabstand', maeander.edgeClearance, DEFAULT_EDGE_CLEARANCE, 1e-9);
  check('… und den Verlegeabstand', maeander.spacing, a, 1e-9);

  // Die Kurve bleibt im Raum und hält den Randabstand. Untergrenze ist der
  // Randabstand selbst; die Toleranz von 1 mm deckt die Intervallschachtelung.
  const randM = kleinsterRandabstand(maeander, raum);
  check('Mäander bleibt im Polygon und hält den Randabstand', randM >= DEFAULT_EDGE_CLEARANCE - 0.001, true);
  check('… und drückt sich nicht unnötig weit in die Mitte', randM <= DEFAULT_EDGE_CLEARANCE + a, true);

  // Länge: Sollwert hergeleitet aus n·a/H (siehe Kopfkommentar) = 1,0263.
  // Toleranz a/H = 0,0395 — das ist die größtmögliche Abweichung der
  // Faustregel, nicht ein abgeschriebener Erfahrungswert.
  const sollM = belegbar / a;
  check('Mäanderlänge folgt der Faustregel Fläche/Verlegeabstand', maeander.fieldLength / sollM, 1.0263, 0.04);
  check('… und die Gesamtlänge liegt darüber (die Kehren zählen mit)', maeander.totalLength > maeander.fieldLength, true);

  // Kein Rohr auf Rohr: der Selbstabstand muss den Verlegeabstand halten.
  // Ausgenommen ist ein Bogenstück von 3 a — so lang ist eine Kehre samt
  // ihren Anschlüssen.
  check('Mäander legt kein Rohr auf Rohr', kleinsterSelbstabstand(maeander, 3 * a) >= a - 0.005, true);

  // Der Mäander hat keinen Grund, schief zu stehen: seine Bahnen sind
  // Schnittlinien in Richtung der Hauptachse, die Kehren sind senkrecht dazu.
  // Beides ist wandparallel, also muss praktisch alles wandparallel sein.
  check('Mäander läuft wandparallel', wandparallelerAnteil(maeander, raum, 1) >= 0.99, true);
  // Und er läuft entlang der langen Wand — sonst gäbe es unnötig viele Kehren.
  check('… entlang der Hauptachse des Raums', maeander.direction, 0, 1e-9);

  // --- Schnecke im Rechteck ------------------------------------------------
  const schnecke = planFloorLoops(raum, { spacing: a, loops: 1, pattern: 'schnecke' });
  check('Schnecke entsteht im Rechteck', schnecke.pattern, 'schnecke');
  check('… als ein durchgehender Zug', schnecke.curves.length, 1);
  // Windungen statt Punktzahl: die Punktzahl hängt davon ab, wie fein die
  // Kurve abgetastet wird, die Windungszahl an der Geometrie. Bei 4,00 m
  // Raumtiefe, 10 cm Rand und 15 cm Verlegeabstand passen (3,80/2)/0,15 ≈ 12
  // Windungen nebeneinander; die Kurve muss den Raum also mehrfach umrunden,
  // und ihre Länge liegt weit über dem Umfang.
  check('… und der umrundet den Raum mehrfach', schnecke.curves[0].length > 4 * 20, true);
  const randS = kleinsterRandabstand(schnecke, raum);
  check('Schnecke bleibt im Polygon und hält den Randabstand', randS >= DEFAULT_EDGE_CLEARANCE - 0.001, true);
  // Bifilar heißt: zwischen zwei Windungen des Hinwegs liegt eine des
  // Rückwegs. Der kleinste Abstand entfernter Kurventeile muss deshalb dem
  // Verlegeabstand entsprechen — vermindert um cos der Neigung an der
  // mittleren Kehre; die Herleitung von 0,85 steht im Kopfkommentar.
  //
  // Das Ausschlussfenster ist hier 6a und nicht 3a wie beim Mäander, und das
  // ist keine Nachsicht, sondern eine andere Geometrie: die Kehre eines
  // Mäanders ist ein kurzes U von der Breite eines Verlegeabstands, die Kehre
  // einer Schnecke ist die *innerste Windung* — im Raum 6,00 × 4,00 m rund
  // 0,9 m lang. Ein kleineres Fenster prüfte die Kehre gegen sich selbst.
  // Zwei verschiedene Windungen liegen dagegen viele Meter Bogenlänge
  // auseinander; echtes Rohr auf Rohr bleibt also erfasst.
  check('Schnecke hält den Verlegeabstand zu sich selbst', kleinsterSelbstabstand(schnecke, 6 * a) >= 0.85 * a, true);

  // --- Die Kurve steht gerade im Raum --------------------------------------
  // Der gemeldete Fehler: „Fußbodenheizung teilweise sehr schief". Er lässt
  // sich weder an Länge noch an Abstand ablesen, deshalb hier eigens.
  // Sollwert B/(B+H) = 6/10 = 0,60, geprüft gegen 0,50 (Herleitung im Kopf).
  const geradeS = wandparallelerAnteil(schnecke, raum, 1);
  check('Schnecke läuft überwiegend wandparallel', geradeS >= 0.5, true);
  // Und die Gegenprobe zur Einordnung: fast alles, was nicht wandparallel
  // ist, weicht nur wenig ab — steil steht allein die mittlere Kehre.
  check('… und was nicht parallel liegt, sind die Kehren', wandparallelerAnteil(schnecke, raum, 20) >= 0.95, true);
  // Sie ist von Natur aus kürzer als Fläche/Abstand, aber nicht beliebig:
  // fehlen dürfen die äußerste halbe Windung und der Kern.
  check('Schneckenlänge liegt im hergeleiteten Bereich', schnecke.fieldLength / sollM > 0.8, true);
  check('… und übertrifft die Faustregel nicht', schnecke.fieldLength / sollM <= 1.0, true);

  // --- Zwei Kreise ---------------------------------------------------------
  const zwei = planFloorLoops(raum, { spacing: a, loops: 2, pattern: 'maeander' });
  check('Zwei Kreise werden angelegt', zwei.loops, 2);
  check('… und beide sind ein Zug', zwei.curves.length, 2);
  // Nicht überlagern heißt hier messbar: die Kreise liegen in getrennten
  // Streifen, ihr Abstand ist der Verlegeabstand.
  check('Zwei Kreise überlagern sich nicht', kleinsterKreisabstand(zwei) >= a - 0.005, true);
  // Getrennte Streifen dürfen die Fläche nicht verlieren: die Summe muss die
  // Länge des einen Kreises wieder ergeben.
  check('Zwei Kreise ergeben zusammen dieselbe Rohrlänge', zwei.fieldLength, maeander.fieldLength, 0.5);
  const flaechenSumme = zwei.curves.reduce((s, c) => s + c.area, 0);
  check('… und dieselbe belegte Fläche', flaechenSumme / belegbar, 1.0263, 0.05);

  // --- Nicht konvexe Formen ------------------------------------------------
  for (const [name, poly] of [
    ['L-Form', lForm],
    ['U-Form', uForm],
    ['V-Form', vForm],
  ] as const) {
    const layout = planFloorLoops(poly, { spacing: a, loops: 1 });
    check(`${name} wird belegt`, layout.curves.length >= 1, true);
    check(`${name}: Kurve bleibt im Polygon und hält den Randabstand`, kleinsterRandabstand(layout, poly) >= DEFAULT_EDGE_CLEARANCE - 0.001, true);
    check(`${name}: kein Rohr auf Rohr`, kleinsterSelbstabstand(layout, 3 * a) >= a - 0.005, true);
    // Die Faustregel gilt auch hier — sie ist Geometrie, keine Form-Annahme.
    const soll = layout.layableArea / a;
    check(`${name}: Rohrlänge folgt der Fläche`, layout.fieldLength / soll, 1.0, 0.08);
    // Und die belegbare Fläche bleibt unter der Grundfläche.
    check(`${name}: belegbare Fläche unter der Grundfläche`, layout.layableArea < polygonArea(poly), true);
  }

  // Wo eine Form zerfällt, muss das im Ergebnis stehen — nicht in einer
  // Kurve, die sich den Weg quer durch die Wand sucht.
  const zerfallen = planFloorLoops(vForm, { spacing: a, loops: 1 });
  check('Zerfallene Form meldet sich als unvollständig', zerfallen.complete, false);
  check('… und sagt warum', zerfallen.notes.some((n) => n.severity === 'warn'), true);

  // Eine Form, die keine Schnecke trägt, bekommt einen Mäander — und die
  // Begründung dazu. Stillschweigend das Muster zu wechseln wäre schlimmer,
  // als es gar nicht anzubieten.
  const lSchnecke = planFloorLoops(lForm, { spacing: a, loops: 1, pattern: 'schnecke' });
  check('L-Form trägt keine Schnecke und bekommt einen Mäander', lSchnecke.pattern, 'maeander');
  check('… das gewünschte Muster bleibt im Ergebnis erhalten', lSchnecke.requestedPattern, 'schnecke');
  check('… und der Grund steht dabei', lSchnecke.notes.length > 0, true);

  // --- Einbauten -----------------------------------------------------------
  // Unter einer Badewanne wird nicht verlegt. Prüfbar ist das am Abstand der
  // Kurve zum Wannenumriss und an der verlorenen Fläche.
  const bad = rechteck(4, 3);
  const wanne = fixtureFootprint({ position: { x: 0.95, y: 0.475 }, rotation: 0, length: 1.7, depth: 0.75 });
  const mitWanne = planFloorLoops(bad, {
    spacing: 0.1,
    loops: 1,
    obstacles: [wanne],
  });
  const ohneWanne = planFloorLoops(bad, { spacing: 0.1, loops: 1 });
  check('Einbauten verkleinern die belegbare Fläche', mitWanne.layableArea < ohneWanne.layableArea, true);
  // 1,70 × 0,75 = 1,275 m² Wanne plus 5 cm Saum ringsum. Der Abzug muss in
  // dieser Größenordnung liegen; enger ginge nur mit einer exakten
  // Boolesche, die hier weder nötig noch vorhanden ist.
  const abzug = ohneWanne.layableArea - mitWanne.layableArea;
  check('… um etwa den Wannengrundriss samt Saum', abzug > 1.2 && abzug < 2.2, true);
  let unterWanne = 0;
  for (const c of mitWanne.curves) for (const p of c.points) if (pointInPolygon(p, wanne)) unterWanne++;
  check('Unter der Wanne liegt kein Rohr', unterWanne, 0);
  check('… und der angesetzte Abstand steht im Ergebnis', mitWanne.obstacleClearance, DEFAULT_OBSTACLE_CLEARANCE, 1e-9);

  // --- Hauptrichtung -------------------------------------------------------
  // Der gemeldete Fehler „die Spirale steht schräg im Raum" hat zwei
  // Ursachen; die zweite ist die Wahl der Bahnrichtung. Geprüft wird sie an
  // genau den Formen, an denen die frühere Regel „Richtung der längsten
  // Kante" kippt.
  const nischenRaum: Vec2[] = [
    // 5,00 × 2,50 m, beide Längswände durch eine Nische zerteilt: die längste
    // *Kante* ist damit 2,50 m — die kurze Wand. Die längste *Achse* bleibt
    // die 5-m-Richtung.
    { x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: -0.5 }, { x: 3, y: -0.5 }, { x: 3, y: 0 }, { x: 5, y: 0 },
    { x: 5, y: 2.5 }, { x: 3, y: 2.5 }, { x: 3, y: 3 }, { x: 2, y: 3 }, { x: 2, y: 2.5 }, { x: 0, y: 2.5 },
  ];
  check('Nischen kippen die Bahnrichtung nicht', planFloorLoops(nischenRaum, { spacing: a }).direction, 0, 1e-9);
  // Ein 15-cm-Wandversatz ist der Alltagsfall — er darf erst recht nichts kippen.
  const versatzRaum: Vec2[] = [
    { x: 0, y: 0 }, { x: 2.5, y: 0 }, { x: 2.5, y: -0.15 }, { x: 5, y: -0.15 },
    { x: 5, y: 2.4 }, { x: 2.5, y: 2.4 }, { x: 2.5, y: 2.55 }, { x: 0, y: 2.55 },
  ];
  check('Ein Wandversatz kippt die Bahnrichtung nicht', planFloorLoops(versatzRaum, { spacing: a }).direction, 0, 1e-9);
  // Der hochkante Raum bekommt 90° — die Achse, nicht die Kante, entscheidet.
  check('Der hochkante Raum bekommt die hochkante Achse', planFloorLoops(rechteck(4, 6), { spacing: a }).direction, 90, 1e-9);
  // Ein schräg im Modellraum stehender Raum bekommt seine eigene Achse: die
  // Regel kennt keine Vorzugsrichtung des Koordinatensystems.
  const winkel = 20;
  const bogen = (winkel * Math.PI) / 180;
  const schraeg = rechteck(6, 4).map((q) => ({
    x: q.x * Math.cos(bogen) - q.y * Math.sin(bogen) + 3,
    y: q.x * Math.sin(bogen) + q.y * Math.cos(bogen) - 7,
  }));
  check('Ein schräg stehender Raum bekommt seine eigene Achse', planFloorLoops(schraeg, { spacing: a }).direction, winkel, 0.01);
  // Und die Kurve steht dann *in diesem* Raum gerade — gemessen an seinen
  // eigenen Wänden, nicht an den Koordinatenachsen.
  check(
    '… und die Kurve steht darin gerade',
    wandparallelerAnteil(planFloorLoops(schraeg, { spacing: a, pattern: 'maeander' }), schraeg, 1) >= 0.99,
    true,
  );
  // Eine ausdrücklich vorgegebene Richtung bleibt unangetastet.
  check('Eine vorgegebene Richtung wird nicht überschrieben', planFloorLoops(raum, { spacing: a, direction: 33 }).direction, 33, 1e-9);

  // --- Anbindung an den Heizkreisverteiler ---------------------------------
  // Ein Heizkreis beginnt und endet am Verteiler. Ohne Verteiler wird keiner
  // erfunden — aber es wird gesagt.
  const ohneVerteiler = planFloorLoops(raum, { spacing: a, loops: 1, pattern: 'maeander' });
  check('Ohne Verteiler entsteht keine Anbindeleitung', ohneVerteiler.supplyLines.length, 0);
  check('… und die Kreislänge ist die Rohrlänge im Raum', ohneVerteiler.circuitLength, ohneVerteiler.totalLength, 1e-9);
  check('… der fehlende Verteiler steht im Ergebnis', ohneVerteiler.manifoldConnected, false);
  check('… und wird gemeldet', ohneVerteiler.notes.some((n) => n.severity === 'warn' && n.text.includes('Verteiler')), true);

  // Verteiler links vom Raum (der Raum liegt bei x = 0 … 6).
  const verteilerLinks: Vec2 = { x: -1, y: 2 };
  const mitVerteiler = planFloorLoops(raum, { spacing: a, loops: 1, pattern: 'maeander', manifold: verteilerLinks });
  check('Mit Verteiler entsteht je Kreis eine Anbindeleitung', mitVerteiler.supplyLines.length, mitVerteiler.curves.length);
  check('… und sie zählt zur Kreislänge', mitVerteiler.circuitLength, mitVerteiler.totalLength + mitVerteiler.supplyLength, 0.01);
  check('… die Kreislänge liegt über der Rohrlänge im Raum', mitVerteiler.circuitLength > mitVerteiler.totalLength, true);
  // Vor- und Rücklauf gehen denselben Weg: die Länge ist der doppelte Abstand.
  const zuleitung = mitVerteiler.supplyLines[0];
  const luftlinie = Math.hypot(zuleitung.points[1].x - verteilerLinks.x, zuleitung.points[1].y - verteilerLinks.y);
  check('… gezählt für Vor- und Rücklauf', zuleitung.length, 2 * luftlinie, 0.02);
  check('… und sie beginnt am Verteiler', Math.hypot(zuleitung.points[0].x - verteilerLinks.x, zuleitung.points[0].y - verteilerLinks.y), 0, 1e-9);
  // Die Kurve fängt an der dem Verteiler zugewandten Seite an — links.
  check('Die Kurve beginnt auf der Verteilerseite', mitVerteiler.curves[0].points[0].x < 3, true);
  // Und mit dem Verteiler auf der anderen Seite kehrt sich das um.
  const rechts = planFloorLoops(raum, { spacing: a, loops: 1, pattern: 'maeander', manifold: { x: 7, y: 2 } });
  check('… und mit dem Verteiler rechts umgekehrt', rechts.curves[0].points[0].x > 3, true);
  // Dieselbe Verlegung, nur andersherum durchlaufen: die Rohrlänge ändert sich nicht.
  check('Das Umdrehen ändert die Rohrlänge nicht', rechts.totalLength, ohneVerteiler.totalLength, 1e-9);

  // Auch die Schnecke setzt ihren Anfang zum Verteiler.
  const schneckeVerteiler = planFloorLoops(raum, { spacing: a, loops: 1, pattern: 'schnecke', manifold: verteilerLinks });
  check('Die Schnecke bindet ebenfalls an', schneckeVerteiler.supplyLines.length, 1);
  check('… und beginnt auf der Verteilerseite', schneckeVerteiler.curves[0].points[0].x < 3, true);

  // Ein weit entfernter Raum sprengt die Kreislänge — und das wird gesagt,
  // nicht stillschweigend korrigiert.
  check('Größte Kreislänge ist vorbelegt und benannt', mitVerteiler.maxCircuitLength, DEFAULT_MAX_CIRCUIT_LENGTH, 1e-9);
  const weitWeg = planFloorLoops(rechteck(3, 3), { spacing: a, loops: 1, pattern: 'maeander', manifold: { x: -40, y: 1.5 } });
  check('Ein weit entfernter Raum überschreitet die Kreislänge', weitWeg.circuitLength > DEFAULT_MAX_CIRCUIT_LENGTH, true);
  check('… und das wird gemeldet', weitWeg.notes.some((n) => n.severity === 'warn' && n.text.includes('Kreislänge')), true);
  check('… aber nicht korrigiert — die Kurve bleibt, wie sie ist', weitWeg.curves.length >= 1, true);
  // Der Grenzwert ist ein Parameter, kein Naturgesetz.
  const grosszuegig = planFloorLoops(rechteck(3, 3), { spacing: a, loops: 1, pattern: 'maeander', manifold: { x: -40, y: 1.5 }, maxCircuitLength: 500 });
  check('Die größte Kreislänge ist überschreibbar', grosszuegig.notes.some((n) => n.text.includes('überschreiten')), false);

  // --- Aussparungen --------------------------------------------------------
  // Die Regel: was auf dem Estrich steht oder ihn durchdringt, spart aus;
  // was an der Wand hängt, nicht.
  for (const t of ['bathtub', 'shower', 'wc', 'kitchen-unit', 'convector', 'floor-drain', 'riser-sanitary', 'riser-heating'] as const) {
    check(`${t} spart aus`, FLOOR_OBSTACLE_TYPES.has(t), true);
  }
  for (const t of ['washbasin', 'water-heater', 'boiler', 'ahu', 'manifold', 'thermostat', 'sink', 'underfloor'] as const) {
    check(`${t} spart nicht aus (hängt an der Wand oder ist selbst die Heizfläche)`, FLOOR_OBSTACLE_TYPES.has(t), false);
  }

  // Eine Küchenzeile von 3,00 × 0,60 m = 1,80 m² plus 5 cm Saum ringsum.
  const kueche = rechteck(4, 3);
  const zeile = fixtureFootprint({ position: { x: 1.6, y: 0.4 }, rotation: 0, length: 3.0, depth: 0.6 });
  check('Der Grundriss der Küchenzeile hat die Katalogmaße', polygonArea(zeile), 3.0 * 0.6, 1e-6);
  const mitZeile = planFloorLoops(kueche, { spacing: a, loops: 1, obstacles: [zeile] });
  const ohneZeile = planFloorLoops(kueche, { spacing: a, loops: 1 });
  const abzugZeile = ohneZeile.layableArea - mitZeile.layableArea;
  check('Die Küchenzeile verkleinert die belegbare Fläche', abzugZeile > 1.5 && abzugZeile < 2.6, true);
  let unterZeile = 0;
  for (const c of mitZeile.curves) for (const q of c.points) if (pointInPolygon(q, zeile)) unterZeile++;
  check('… und unter ihr liegt kein Rohr', unterZeile, 0);

  // --- Grenzfälle ----------------------------------------------------------
  // Kein Absturz, keine erfundene Kurve, sondern ein Ergebnis, das die Lage
  // benennt. Das ist der Unterschied zwischen „nichts" und „kaputt".
  const leer = planFloorLoops([], { spacing: a, loops: 1 });
  check('Raum ohne Polygon liefert nichts', leer.curves.length, 0);
  check('… ohne Absturz und mit endlichen Zahlen', Number.isFinite(leer.fieldLength) && Number.isFinite(leer.layableArea), true);
  check('… und mit einer Fehlermeldung', leer.notes.some((n) => n.severity === 'error'), true);

  const entartet = planFloorLoops(
    [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 0, y: 0 },
    ],
    { spacing: a, loops: 1 },
  );
  check('Entartetes Polygon liefert nichts statt eines Absturzes', entartet.curves.length, 0);
  check('… und meldet es', entartet.notes.some((n) => n.severity === 'error'), true);

  const winzig = planFloorLoops(rechteck(0.15, 0.15), { spacing: a, loops: 1 });
  check('Raum kleiner als der Randabstand liefert nichts', winzig.curves.length, 0);
  check('… und sagt, dass kein Platz bleibt', winzig.notes.some((n) => n.severity === 'error'), true);

  const ohneAbstand = planFloorLoops(raum, { spacing: 0, loops: 1 });
  check('Verlegeabstand null liefert nichts statt einer Endlosschleife', ohneAbstand.curves.length, 0);
  check('… und meldet es', ohneAbstand.notes.some((n) => n.severity === 'error'), true);

  // Mehr Kreise als Bahnen: die Zahl wird gekappt und die Kappung benannt.
  const zuViele = planFloorLoops(rechteck(4, 0.6), { spacing: a, loops: 8, pattern: 'maeander' });
  check('Mehr Kreise als Bahnen werden gekappt', zuViele.loops < 8, true);
  check('… und die geforderte Zahl bleibt sichtbar', zuViele.requestedLoops, 8);
  check('… mit Hinweis', zuViele.notes.some((n) => n.severity === 'warn'), true);

  // --- Ableitbarkeit -------------------------------------------------------
  // Die Kurve wird nicht gespeichert, sondern gerechnet. Also muss zweimal
  // dasselbe herauskommen — und bei geändertem Raum etwas anderes.
  const wieder = planFloorLoops(raum, { spacing: a, loops: 1, pattern: 'maeander' });
  check('Dieselbe Eingabe ergibt dieselbe Kurve', wieder.fieldLength, maeander.fieldLength, 1e-9);
  const groesser = planFloorLoops(rechteck(6, 5), { spacing: a, loops: 1, pattern: 'maeander' });
  check('Ein größerer Raum ergibt mehr Rohr', groesser.fieldLength > maeander.fieldLength, true);

  // Der Grundriss eines Einbauobjekts folgt seiner Drehung — sonst läge die
  // Aussparung bei einer gedrehten Wanne neben der Wanne.
  const gedreht = fixtureFootprint({ position: { x: 2, y: 2 }, rotation: 90, length: 1.7, depth: 0.75 });
  check('Gedrehter Grundriss behält die Fläche', polygonArea(gedreht), 1.7 * 0.75, 1e-6);
  check('… und dreht sich mit', Math.abs(gedreht[0].x - gedreht[1].x) < 1e-6, true);
}
