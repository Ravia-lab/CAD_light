/**
 * Prüfblock „Dachformen" — Krüppelwalm, Mansarde, Flachdach mit Gefälle.
 * ---------------------------------------------------------------------------
 * **Warum die drei und nicht vierundzwanzig.** Der Anwender hat eine Tafel mit
 * vierundzwanzig Dachformen geschickt. Die Hälfte davon ist keine eigene Form,
 * sondern ein Walmdach über einem anderen Grundriss: Das Zeltdach ist das
 * Walmdach über dem Quadrat, das Walmkehldach das über dem L, das Kreuzdach
 * das über dem Kreuz. Seit 1.27.0 rechnet das Walmdach auf dem Gebäudeumriss
 * — die Höhenfunktion des Straight Skeleton —, und damit entstehen sie von
 * selbst. Der erste Abschnitt hier weist das nach, statt es zu behaupten.
 *
 * Übrig bleiben drei, die wirklich eine eigene Höhenfunktion brauchen:
 *
 *  · **Krüppelwalm** — Satteldach mit abgeschrägter Giebelspitze. Er ist als
 *    Minimum zweier Schrägen gebaut und muss deshalb an beiden Rändern in die
 *    bekannten Formen übergehen: bei 0 % in das Satteldach, bei 100 % in das
 *    Walmdach. Das ist die schärfste Prüfung, die es für ihn gibt — sie
 *    vergleicht nicht mit einer Zahl, sondern mit zwei unabhängig
 *    geschriebenen Formeln.
 *  · **Mansarde** — zwei Neigungen mit einem Knick. Geprüft wird die
 *    Firsthöhe, die Knickhöhe und dass beide Flächen ihre Neigung wirklich
 *    haben.
 *  · **Flachdach mit Gefälle** — geometrisch ein Pultdach, im Bauantrag
 *    etwas anderes. Geprüft wird die Deckungsgleichheit mit dem Pultdach; ist
 *    sie eines Tages nicht mehr gegeben, war es eine unbeabsichtigte Änderung.
 *
 * Alle Sollwerte sind von Hand gerechnet und stehen als Rechnung daneben.
 */

import type { RoofDefinition, Vec2 } from '../../src/types/bim';
import { DACHFORMEN_AUS_UMRISS, ROOF_KIND_LABELS } from '../../src/types/bim';
import {
  KRUEPPELWALM_VORGABE,
  measureRoomUnderRoof,
  MANSARD_KNICK_VORGABE,
  MANSARD_OBEN_VORGABE,
  baseRoofHeightAt,
  buildRoofFrame,
  mansardKnick,
} from '../../src/lib/roofGeometry';
import type { CheckFn } from './typ';

/**
 * Der Prüfgrundriss: 10,00 × 8,00 m, Azimut 90° (das Dach fällt nach Osten).
 * Damit läuft `t` entlang x, der First entlang y. Neigung 45° heißt
 * Steigung 1 — jede Höhe ist dann ein Abstand, und jede Rechnung im Kopf
 * nachvollziehbar.
 */
const WOLKE: Vec2[] = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 8 },
  { x: 0, y: 8 },
];

function dach(over: Partial<RoofDefinition>): RoofDefinition {
  return {
    kind: 'gable', pitch: 45, kneeHeight: 1, azimuth: 90, ridgeOffset: 0,
    uValue: 0.18, gableUValue: 0.22, ...over,
  };
}

export function pruefeDachformen(check: CheckFn): void {
  // === 1 — Jede Form hat einen Namen ======================================
  for (const art of ['krueppelwalm', 'mansard', 'flat-sloped'] as const) {
    check(`„${art}" hat eine Bezeichnung`, (ROOF_KIND_LABELS[art] ?? '').length > 0, true);
  }
  check('Krüppelwalmdach heißt so', ROOF_KIND_LABELS.krueppelwalm, 'Krüppelwalmdach');
  check('Mansarddach heißt so', ROOF_KIND_LABELS.mansard, 'Mansarddach');
  check('Flachdach mit Gefälle heißt so', ROOF_KIND_LABELS['flat-sloped'], 'Flachdach mit Gefälle');
  check('Die Formen aus dem Umriss sind benannt', DACHFORMEN_AUS_UMRISS.length, 3, 0);

  // === 2 — Zeltdach: Walmdach über dem Quadrat ============================
  /*
   * Ein Quadrat von 8,00 × 8,00 m, Neigung 45° (Steigung 1), Kniestock 1,00 m.
   * Beim Walmdach über einem bekannten Umriss gilt
   *     h(p) = Kniestock + Abstand(p, Umriss) · Steigung.
   * Der Punkt mit dem größten Randabstand ist die Mitte; dort sind es 4,00 m.
   * Also Firstpunkt = 1,00 + 4,00 = 5,00 m — und zwar ein *Punkt*, kein First:
   * Genau das ist ein Zeltdach.
   */
  const quadrat: Vec2[] = [
    { x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 8 }, { x: 0, y: 8 },
  ];
  const zelt = buildRoofFrame(dach({ kind: 'hip' }), quadrat, [], quadrat);
  check('Das Zeltdach entsteht aus dem Walmdach', zelt !== null, true);
  if (zelt) {
    check('Seine Spitze liegt bei 5,00 m', baseRoofHeightAt(zelt, { x: 4, y: 4 }), 5, 1e-6);
    // Zwei Meter neben der Mitte, in beide Richtungen, muss dieselbe Höhe
    // stehen: 1,00 + 2,00 = 3,00 m. Bei einem First wäre eine der beiden
    // Richtungen höher — eben die entlang des Firsts.
    check('Zwei Meter östlich: 3,00 m', baseRoofHeightAt(zelt, { x: 6, y: 4 }), 3, 1e-6);
    check('Zwei Meter nördlich: ebenso 3,00 m', baseRoofHeightAt(zelt, { x: 4, y: 6 }), 3, 1e-6);
    check('Es gibt also keinen First, nur eine Spitze',
      Math.abs(baseRoofHeightAt(zelt, { x: 6, y: 4 }) - baseRoofHeightAt(zelt, { x: 4, y: 6 })) < 1e-9,
      true);
  }

  // === 3 — Walmkehldach: Walmdach über dem L ==============================
  /*
   * Ein L: 10 × 8 mit einer ausgeschnittenen Ecke von 5 × 4. Im
   * einspringenden Winkel entsteht eine Kehle — kenntlich daran, dass die
   * Höhe dort *kleiner* ist als auf beiden Schenkeln daneben, obwohl sie von
   * der Bounding Box her gleich weit von der Mitte entfernt sind.
   */
  const l: Vec2[] = [
    { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 4 },
    { x: 5, y: 4 }, { x: 5, y: 8 }, { x: 0, y: 8 },
  ];
  const kehle = buildRoofFrame(dach({ kind: 'hip' }), l, [], l);
  check('Das Walmkehldach entsteht aus dem Walmdach', kehle !== null, true);
  if (kehle) {
    // Die einspringende Ecke liegt bei (5|4). Direkt daneben ist der
    // Randabstand klein, also die Höhe niedrig: höchstens Kniestock + 0,5 m.
    check('An der einspringenden Ecke liegt eine Kehle',
      baseRoofHeightAt(kehle, { x: 5.3, y: 4.3 }) < 1.6, true);
    // Mitten im breiten Schenkel dagegen ist der Randabstand 2,00 m.
    check('Im Schenkel steht das Dach dagegen hoch',
      baseRoofHeightAt(kehle, { x: 2.5, y: 2 }), 3, 1e-6);
  }

  // === 4 — Krüppelwalm: die beiden Grenzfälle =============================
  /*
   * Bezugsrahmen 10 × 8, Azimut 90°, Neigung 45° (Steigung 1), Kniestock 1,00.
   * Satteldach: halbe Spannweite in Fallrichtung 5,00 → First 1 + 5 = 6,00 m.
   */
  const satteldach = buildRoofFrame(dach({}), WOLKE)!;
  const walmdach = buildRoofFrame(dach({ kind: 'hip' }), WOLKE)!;
  check('Der Satteldachfirst liegt bei 6,00 m', satteldach.ridgeHeight, 6, 1e-6);
  // Walmdach ohne Umriss: First = Kniestock + kürzere Halbspannweite = 1 + 4.
  check('Der Walmdachfirst liegt bei 5,00 m', walmdach.ridgeHeight, 5, 1e-6);

  const proben: Vec2[] = [
    { x: 5, y: 4 }, { x: 5, y: 7.5 }, { x: 5, y: 0.5 },
    { x: 2, y: 4 }, { x: 8, y: 6 }, { x: 1, y: 1 }, { x: 9, y: 7 },
  ];

  const kw0 = buildRoofFrame(dach({ kind: 'krueppelwalm', hipRatio: 0 }), WOLKE)!;
  let abw0 = 0;
  for (const p of proben) {
    abw0 = Math.max(abw0, Math.abs(baseRoofHeightAt(kw0, p) - baseRoofHeightAt(satteldach, p)));
  }
  check('Bei 0 % abgewalmt ist es genau ein Satteldach', abw0, 0, 1e-9);

  const kw1 = buildRoofFrame(dach({ kind: 'krueppelwalm', hipRatio: 1 }), WOLKE)!;
  let abw1 = 0;
  for (const p of proben) {
    abw1 = Math.max(abw1, Math.abs(baseRoofHeightAt(kw1, p) - baseRoofHeightAt(walmdach, p)));
  }
  check('Bei 100 % abgewalmt ist es genau ein Walmdach', abw1, 0, 1e-9);

  // --- Und dazwischen der Krüppelwalm ------------------------------------
  /*
   * Bei 50 %: Der Walmfuß liegt auf halber Höhe zwischen Kniestock und First,
   * also 6,00 − 0,5 · (6,00 − 1,00) = 3,50 m. Von dort steigt die abgewalmte
   * Fläche mit Steigung 1 nach innen.
   *
   * Am Giebelrand (y = 8,00, also 4,00 m aus der Mitte) ist sie genau auf
   * Walmfußhöhe: 3,50 m. Bei y = 7,90 ist sie 0,10 m weiter innen: 3,60 m.
   * Über dem First (y = 4,00) wäre sie 3,50 + 4,00 = 7,50 m und damit höher
   * als das Satteldach — dort gilt wieder die Satteldachhöhe von 6,00 m.
   */
  const kw = buildRoofFrame(dach({ kind: 'krueppelwalm', hipRatio: 0.5 }), WOLKE)!;
  check('Der Krüppelwalmfirst liegt wie beim Satteldach bei 6,00 m', kw.ridgeHeight, 6, 1e-6);
  check('Am Giebel steht er auf Walmfußhöhe 3,50 m', baseRoofHeightAt(kw, { x: 5, y: 8 }), 3.5, 1e-6);
  check('Zehn Zentimeter weiter innen: 3,60 m', baseRoofHeightAt(kw, { x: 5, y: 7.9 }), 3.6, 1e-6);
  check('In der Mitte gilt wieder das Satteldach: 6,00 m', baseRoofHeightAt(kw, { x: 5, y: 4 }), 6, 1e-6);
  // Der Giebel ist damit deutlich niedriger als beim Satteldach — genau das
  // ist der Unterschied, den die Form macht.
  check('Der Giebel ist niedriger als beim Satteldach',
    baseRoofHeightAt(kw, { x: 5, y: 8 }) < baseRoofHeightAt(satteldach, { x: 5, y: 8 }) - 2, true);
  // Die Traufe bleibt unangetastet: an der Ostwand 1,00 + 0,10 = 1,10 m.
  check('Die Traufe bleibt, wo sie war', baseRoofHeightAt(kw, { x: 9.9, y: 4 }), 1.1, 1e-6);
  check('Die Vorgabe für den Anteil ist 50 %', KRUEPPELWALM_VORGABE, 0.5, 1e-9);

  // === 5 — Mansarddach ====================================================
  /*
   * Untere Neigung 70° (Steigung tan 70° = 2,74748), obere 30°
   * (tan 30° = 0,57735), Knick bei 2,20 m, Kniestock 1,00 m, Spannweite 5,00 m.
   *
   *   Waagerechter Weg von der Traufe bis zum Knick:
   *       (2,20 − 1,00) / 2,74748 = 0,43676 m
   *   Abstand des Knicks von der Firstachse:
   *       5,00 − 0,43676 = 4,56324 m
   *   Firsthöhe:
   *       2,20 + 4,56324 · 0,57735 = 2,20 + 2,63459 = 4,83459 m
   */
  const mansardDach = dach({ kind: 'mansard', pitch: 70, upperPitch: 30, knickHeight: 2.2 });
  const mansarde = buildRoofFrame(mansardDach, WOLKE)!;
  const knick = mansardKnick(mansardDach, 5, 1, Math.tan((70 * Math.PI) / 180));
  check('Der Knick liegt 4,563 m von der Firstachse', knick.abstand, 4.56324, 1e-4);
  check('… auf 2,20 m Höhe', knick.hoehe, 2.2, 1e-6);
  check('Der First steht bei 4,835 m', mansarde.ridgeHeight, 4.83459, 1e-4);
  check('… und die Höhenfunktion sagt dasselbe', baseRoofHeightAt(mansarde, { x: 5, y: 4 }), 4.83459, 1e-4);

  // Die untere Fläche: von der Traufe bei x = 10 (Höhe 1,00) zehn Zentimeter
  // nach innen sind es 1,00 + 0,10 · 2,74748 = 1,27475 m.
  check('Die untere Fläche steigt steil', baseRoofHeightAt(mansarde, { x: 9.9, y: 4 }), 1.27475, 1e-4);
  // Die obere Fläche: 1,00 m neben dem First sind es 4,83459 − 0,57735 = 4,25724 m.
  check('Die obere Fläche steigt flach', baseRoofHeightAt(mansarde, { x: 6, y: 4 }), 4.25724, 1e-4);
  // Am Knick selbst — x = 5 + 4,56324 = 9,56324 — steht die Knickhöhe.
  check('Am Knick steht die Knickhöhe', baseRoofHeightAt(mansarde, { x: 9.56324, y: 4 }), 2.2, 1e-4);
  // Die Traufe bleibt der Kniestock.
  check('An der Traufe steht der Kniestock', baseRoofHeightAt(mansarde, { x: 10, y: 4 }), 1, 1e-4);

  /*
   * Der Grenzfall: Liegt der Knick auf Kniestockhöhe, gibt es keinen Knick
   * mehr — dann ist das Dach ein Satteldach mit der *oberen*, flachen
   * Neigung. First = 1,00 + 5,00 · tan 30° = 1,00 + 2,88675 = 3,88675 m.
   */
  const ohneKnick = buildRoofFrame(
    dach({ kind: 'mansard', pitch: 70, upperPitch: 30, knickHeight: 1 }),
    WOLKE,
  )!;
  check('Knick auf Kniestockhöhe: nur noch die flache Fläche',
    ohneKnick.ridgeHeight, 3.88675, 1e-4);
  /*
   * Und andersherum: Liegt der Knick über dem First, den die steile Neigung
   * allein erreichen würde, bleibt es beim steilen Satteldach.
   * First = 1,00 + 5,00 · tan 70° = 1,00 + 13,7374 = 14,7374 m.
   */
  const nurSteil = buildRoofFrame(
    dach({ kind: 'mansard', pitch: 70, upperPitch: 30, knickHeight: 20 }),
    WOLKE,
  )!;
  check('Knick über dem First: nur noch die steile Fläche',
    nurSteil.ridgeHeight, 14.7374, 1e-3);

  check('Die Vorgabe der oberen Neigung ist 30°', MANSARD_OBEN_VORGABE, 30, 1e-9);
  check('Die Vorgabe der Knickhöhe ist 2,20 m', MANSARD_KNICK_VORGABE, 2.2, 1e-9);

  // === 6 — Flachdach mit Gefälle ==========================================
  /*
   * Geometrisch ein Pultdach. Das wird hier festgehalten: Wenn die beiden
   * eines Tages auseinanderlaufen, war es keine Absicht.
   *
   * 2° Gefälle über 10,00 m: tan 2° = 0,034921, also 0,34921 m Höhenunter-
   * schied. Der First sitzt an der Westkante (Azimut 90° = Fall nach Osten),
   * also 1,00 + 0,34921 = 1,34921 m; an der Ostkante bleibt der Kniestock.
   */
  const gefaelle = buildRoofFrame(dach({ kind: 'flat-sloped', pitch: 2 }), WOLKE)!;
  const pult = buildRoofFrame(dach({ kind: 'monopitch', pitch: 2 }), WOLKE)!;
  check('Das Flachdach mit Gefälle bekommt einen Rahmen', gefaelle !== null, true);
  check('Der hohe Rand liegt bei 1,349 m', gefaelle.ridgeHeight, 1.34921, 1e-4);
  check('Am tiefen Rand steht der Kniestock', baseRoofHeightAt(gefaelle, { x: 10, y: 4 }), 1, 1e-4);
  let abwPult = 0;
  for (const p of proben) {
    abwPult = Math.max(abwPult, Math.abs(baseRoofHeightAt(gefaelle, p) - baseRoofHeightAt(pult, p)));
  }
  check('Es rechnet Punkt für Punkt wie das Pultdach', abwPult, 0, 1e-12);

  // === 7 — Die Dachflächen, auf die es in der Heizlast ankommt ============
  /*
   * **Warum dieser Abschnitt existiert.** Die geneigte Dachfläche ist die
   * projizierte geteilt durch cos(Neigung). Solange ein Dach *eine* Neigung
   * hatte, war das eine Zahl für das ganze Dach. Die Mansarde hat zwei, und
   * der Unterschied ist grob: 1/cos 70° = 2,924 gegen 1/cos 30° = 1,155. Wer
   * hier die steile Neigung auf alles anwendet, meldet die obere Dachfläche
   * zweieinhalbmal zu groß — und damit den Transmissionsverlust des größten
   * Bauteils im Dachgeschoss.
   */
  const satteldachMass = measureRoomUnderRoof(satteldach, WOLKE);
  // 10,00 × 8,00 m Grundfläche bei 45°: 80,00 / cos 45° = 80,00 / 0,70711
  // = 113,137 m².
  check('Satteldach: 113,14 m² Dachfläche', satteldachMass.slopedArea, 113.14, 0.02);
  check('… auf zwei Flächen', satteldachMass.slopedAreaByFace.length, 2, 0);

  /*
   * Der Krüppelwalm hat **dieselbe** Gesamtfläche: Die abgewalmten Spitzen
   * haben dieselbe Neigung wie die Hauptflächen, und die projizierte
   * Grundfläche ändert sich beim Abwalmen nicht. Was sich ändert, ist die
   * Aufteilung — aus zwei Flächen werden vier — und das Volumen, denn die
   * Spitzen sind weg.
   */
  const kwMass = measureRoomUnderRoof(kw, WOLKE);
  check('Krüppelwalm: dieselbe Gesamtfläche', kwMass.slopedArea, satteldachMass.slopedArea, 0.02);
  check('… aber auf vier Flächen', kwMass.slopedAreaByFace.length, 4, 0);
  check('… und mit weniger Volumen', kwMass.volume < satteldachMass.volume - 5, true);
  // Die Wohnfläche nach WoFlV bleibt: abgewalmt wird oben, und oben ist
  // ohnehin über 2,00 m lichte Höhe.
  check('… bei gleicher Wohnfläche', kwMass.livingArea, satteldachMass.livingArea, 0.02);

  /*
   * Die Mansarde, von Hand:
   *
   *   obere Fläche je Seite:  4,56324 m · 8,00 m / cos 30° = 42,153 m²
   *   untere Fläche je Seite: 0,43676 m · 8,00 m / cos 70° = 10,216 m²
   *   beide Seiten zusammen:  2 · (42,153 + 10,216)        = 104,74 m²
   *
   * Gemessen wird auf einem 5-cm-Raster, und der Knick fällt mitten in eine
   * Zellenreihe. Eine halbe Reihe — 0,05 m · 8,00 m = 0,40 m² projiziert —
   * kann dabei der falschen Neigung zugeschlagen werden; das sind bis zu
   * 0,40 · (2,924 − 1,155) = 0,71 m² Abweichung. Die Toleranz ist danach
   * bemessen und nicht nach dem, was herauskommt.
   */
  const mansardeMass = measureRoomUnderRoof(mansarde, WOLKE);
  check('Mansarde: 104,7 m² Dachfläche', mansardeMass.slopedArea, 104.74, 1.0);
  /*
   * Die Gegenprobe, die den eigentlichen Fehler fängt: Rechnete alles mit der
   * steilen Neigung, kämen 80,00 / cos 70° = 233,9 m² heraus — mehr als das
   * Doppelte. Rechnete alles mit der flachen, wären es 92,4 m².
   */
  check('… und weder 234 m² (alles steil) …', mansardeMass.slopedArea < 150, true);
  check('… noch 92 m² (alles flach)', mansardeMass.slopedArea > 100, true);

  // Das *waagerechte* Flachdach bleibt dagegen ohne Rahmen — es hat keine
  // Schräge, und ein Rahmen dafür wäre eine Schräge von null Grad.
  check('Das waagerechte Flachdach bekommt keinen Rahmen',
    buildRoofFrame(dach({ kind: 'flat', pitch: 0 }), WOLKE) === null, true);
}
