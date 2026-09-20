/**
 * Prüfblock „Wandhöhen angleichen".
 * ---------------------------------------------------------------------------
 * **Der Befund, der dahintersteht.** Im Sanierungsgrundriss standen
 * nebeneinander Raumhöhen von 2,44 · 2,45 · 2,46 · 2,29 · 2,19 m. Gemessen
 * hatte die niemand. Sie entstehen in `roomDetection`, wo die Raumhöhe die
 * **niedrigste** Wand des Raums ist (oberhalb Brüstungshöhe), ersatzweise
 * die Geschosshöhe. Eine einzelne Wand, die beim Zeichnen auf 2,19 m stehen
 * geblieben ist, bestimmt damit Volumen, Luftwechsel und Lüftungsverlust des
 * ganzen Raums — und jede der Zahlen sieht für sich plausibel aus.
 *
 * **Was dieser Block festhält:**
 *
 *  1. Angeglichen wird auf die *lichte Geschosshöhe*, nicht auf die häufigste
 *     Wandhöhe. Die Geschosshöhe ist eine Angabe des Menschen; die häufigste
 *     Wandhöhe wäre ein Mehrheitsbeschluss der Nachlässigkeit.
 *  2. Eine Brüstung wird **nicht** hochgezogen. Aus einer 1,10-m-Brüstung
 *     eine 2,50-m-Wand zu machen ist keine Korrektur, sondern eine
 *     Bauteiländerung.
 *  3. Unter der Dachschräge bleibt alles stehen. Die Grenze wird **gerechnet**
 *     (`roofHeightAt` an der Wandmitte), nicht geraten.
 *  4. Die Vorschau nennt beide Zahlen — geändert und stehen geblieben. Ein
 *     Knopf, der „12 Wände" verspricht und 12 von 18 anfasst, sieht aus wie
 *     ein Fehler.
 *
 * Alle Sollwerte sind von Hand gerechnet und stehen als Rechnung dabei.
 */

import type { BimNode, Level, Wall } from '../../src/types/bim';
import { befundSatz, hoehenbefund, BRUESTUNGS_HOEHE, TOTZONE } from '../../src/lib/wandhoehen';
import { buildRoofFrame } from '../../src/lib/roofGeometry';
import type { CheckFn } from './typ';

/** Ein Geschoss mit 2,50 m lichter Höhe — der Sollwert aller Prüfungen hier. */
function geschoss(hoehe = 2.5, roof?: Level['roof']): Level {
  return {
    id: 'eg',
    name: 'EG',
    elevation: 0,
    height: hoehe,
    floorUValue: 0.28,
    floorBoundary: 'ground',
    ceilingUValue: 0.2,
    ceilingBoundary: 'unheated',
    order: 0,
    ...(roof ? { roof } : {}),
  } as Level;
}

/**
 * Ein Rechteckhaus 10 × 8 m mit vier Wänden, jede mit eigener Höhe.
 *
 * Die Knoten liegen auf den Ecken; die Wandmitten damit bei (5|0), (10|4),
 * (5|8) und (0|4). Diese vier Punkte sind es, an denen später die Dachhöhe
 * abgefragt wird — sie stehen hier, damit die Dachrechnung weiter unten
 * nachvollziehbar bleibt.
 */
function haus(hoehen: [number, number, number, number]): {
  walls: Wall[];
  nodes: Record<string, BimNode>;
} {
  const ecken: [number, number][] = [[0, 0], [10, 0], [10, 8], [0, 8]];
  const nodes: Record<string, BimNode> = {};
  ecken.forEach(([x, y], i) => { nodes[`n${i}`] = { id: `n${i}`, x, y, levelId: 'eg' }; });
  const walls: Wall[] = hoehen.map((h, i) => ({
    id: `w${i}`,
    a: `n${i}`,
    b: `n${(i + 1) % 4}`,
    levelId: 'eg',
    type: 'exterior',
    thickness: 0.3,
    height: h,
    uValue: 0.24,
    layerId: 'layer-walls',
  }));
  return { walls, nodes };
}

export function pruefeWandhoehen(check: CheckFn): void {
  // =========================================================================
  // 1 · Der Fall aus dem Sanierungsplan
  // =========================================================================
  {
    // Drei Wände auf 2,50 m, eine auf 2,19 m — genau die Wand, die im Plan
    // aus „Essen" einen 2,19-m-Raum gemacht hat. Abweichung 0,31 m.
    const { walls, nodes } = haus([2.5, 2.5, 2.19, 2.5]);
    const b = hoehenbefund({ level: geschoss(2.5), walls, nodes });

    check('Vier Wände insgesamt', b.gesamt, 4);
    check('Eine weicht ab', b.aenderungen.length, 1);
    check('Und zwar die dritte', b.aenderungen[0]?.wallId ?? '—', 'w2');
    check('Sie steht auf 2,19 m', b.aenderungen[0]?.ist ?? 0, 2.19, 1e-9);
    check('Soll ist die Geschosshöhe', b.aenderungen[0]?.soll ?? 0, 2.5, 1e-9);
    // 2,50 − 2,19 = 0,31 m
    check('Größte Abweichung 0,31 m', b.groessteAbweichung, 0.31, 1e-9);
    check('Keine Ausnahme', b.ausnahmen.length, 0);
    check('Der Satz nennt Zahl und Maß', befundSatz(b), '1 von 4 Wänden auf 250 cm — größte Änderung 31 cm.');
  }

  // =========================================================================
  // 2 · Nichts zu tun — und das Feld sagt es trotzdem
  // =========================================================================
  {
    const { walls, nodes } = haus([2.5, 2.5, 2.5, 2.5]);
    const b = hoehenbefund({ level: geschoss(2.5), walls, nodes });
    check('Alles auf Soll: keine Änderung', b.aenderungen.length, 0);
    check('… und ein Satz, der das sagt', befundSatz(b), 'Alle Wände stehen auf 250 cm.');

    /*
     * Die Totzone. 2,50 m und 2,505 m sind für die Oberfläche derselbe Wert
     * (Eingabe in Zentimetern). Ohne sie stünde der Knopf dauerhaft auf
     * „1 Wand" — bis ihn niemand mehr drückt.
     */
    const knapp = haus([2.5, 2.5, 2.5 + TOTZONE / 2, 2.5]);
    check('Halbe Totzone zählt nicht', hoehenbefund({ level: geschoss(2.5), walls: knapp.walls, nodes: knapp.nodes }).aenderungen.length, 0);
    const drueber = haus([2.5, 2.5, 2.52, 2.5]);
    check('Zwei Zentimeter schon', hoehenbefund({ level: geschoss(2.5), walls: drueber.walls, nodes: drueber.nodes }).aenderungen.length, 1);
  }

  // =========================================================================
  // 3 · Die Brüstung bleibt eine Brüstung
  // =========================================================================
  {
    // 1,10 m liegt unter der Grenze von 1,40 m — dieselbe Grenze, mit der
    // `roomDetection` die Raumhöhe misst. Eine Wand, die dort nicht zählt,
    // darf hier nicht hochgezogen werden.
    const { walls, nodes } = haus([2.5, 1.1, 2.5, 2.5]);
    const b = hoehenbefund({ level: geschoss(2.5), walls, nodes });
    check('Die Brüstung wird nicht angefasst', b.aenderungen.length, 0);
    check('Sie steht als Ausnahme da', b.ausnahmen.length, 1);
    check('Mit dem richtigen Grund', b.ausnahmen[0]?.grund ?? '—', 'bruestung');
    check('Die Grenze liegt bei 1,40 m', BRUESTUNGS_HOEHE, 1.4);

    // Gegenprobe: knapp darüber ist es eine Raumwand und wird angeglichen.
    const knapp = haus([2.5, BRUESTUNGS_HOEHE + 0.01, 2.5, 2.5]);
    const b2 = hoehenbefund({ level: geschoss(2.5), walls: knapp.walls, nodes: knapp.nodes });
    check('Knapp darüber ist es eine Wand', b2.aenderungen.length, 1);
  }

  // =========================================================================
  // 4 · Unter der Dachschräge wird nichts angefasst
  // =========================================================================
  {
    /*
     * Ein Satteldach über dem 10 × 8 m großen Haus. `azimuth: 90` heißt:
     * Die Dachflächen fallen nach Osten und Westen, die Firstachse läuft
     * also in y-Richtung über die Hausmitte bei x = 5.
     *
     * Daraus folgt für die vier Wandmitten, und zwar nachrechenbar:
     *
     *   w0 — Mitte (5|0): liegt unter dem First  → lichte Höhe > 2,50 m
     *   w1 — Mitte (10|4): liegt auf der Traufe  → lichte Höhe = Kniestock 1,00 m
     *   w2 — Mitte (5|8): liegt unter dem First  → lichte Höhe > 2,50 m
     *   w3 — Mitte (0|4): liegt auf der Traufe   → lichte Höhe = Kniestock 1,00 m
     *
     * Erwartet werden damit **zwei** Änderungen (w0, w2) und **zwei**
     * Ausnahmen (w1, w3). Alle vier Wände stehen auf 2,20 m; ohne Dach
     * würden folglich alle vier angeglichen — das ist die Gegenprobe am
     * Ende dieses Abschnitts.
     *
     * Geprüft wird bewusst nicht die Dachrechnung selbst — die hat ihren
     * eigenen Block. Geprüft wird, dass dieses Modul sie **benutzt**, statt
     * die Ausnahme an einer Zahl festzumachen.
     */
    const roof = {
      kind: 'gable', pitch: 38, kneeHeight: 1.0, azimuth: 90, ridgeOffset: 0,
    } as unknown as Level['roof'];
    const { walls, nodes } = haus([2.2, 2.2, 2.2, 2.2]);
    const umriss = [
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 8 }, { x: 0, y: 8 },
    ];
    const frame = buildRoofFrame(roof!, umriss, [], umriss);
    check('Das Dachgerüst entsteht', frame !== null, true);

    const b = hoehenbefund({ level: geschoss(2.5, roof), walls, nodes, roofFrames: [frame] });
    const unterDach = b.ausnahmen.filter((a) => a.grund === 'dachschraege');
    check('Zwei Traufwände bleiben stehen', unterDach.length, 2);
    check('Und zwar w1 und w3', unterDach.map((a) => a.wallId).sort().join(','), 'w1,w3');
    check('Die beiden Giebelwände werden angeglichen', b.aenderungen.map((a) => a.wallId).sort().join(','), 'w0,w2');
    check('Keine dieser Wände steht in den Änderungen',
      b.aenderungen.some((a) => b.ausnahmen.some((x) => x.wallId === a.wallId)), false);
    // Der Satz muss die stehen gebliebenen mitnennen, sonst sieht die
    // Teilangleichung hinterher wie ein Fehler aus.
    check('Der Satz nennt die Dachschräge', befundSatz(b).includes('Dachschräge'), true);

    // Ohne Dachgerüst gäbe es die Ausnahme nicht — dieselben Wände, andere Lage.
    const ohne = hoehenbefund({ level: geschoss(2.5), walls, nodes });
    check('Ohne Dach werden alle vier angeglichen', ohne.aenderungen.length, 4);
  }

  // =========================================================================
  // 5 · Fremde Geschosse bleiben unberührt
  // =========================================================================
  {
    const { walls, nodes } = haus([2.5, 2.19, 2.5, 2.5]);
    const fremd: Wall = { ...walls[0], id: 'og-1', levelId: 'og', height: 1.9 };
    const b = hoehenbefund({ level: geschoss(2.5), walls: [...walls, fremd], nodes });
    check('Die Wand im OG wird nicht mitgezählt', b.gesamt, 4);
    check('Und nicht geändert', b.aenderungen.some((a) => a.wallId === 'og-1'), false);
  }
}
