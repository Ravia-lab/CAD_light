/**
 * Prüfblock „Rohrlängen, Formteile, Steigleitung im Fließweg" (1.71.0).
 * ---------------------------------------------------------------------------
 * **Die Meldung (02.10.2026):** „Bei der Rohrverlegung gibt es keine
 * Rohrlängen, die sind aber wichtig für RaVia für den hydraulischen Abgleich,
 * außerdem müssen auch die Fittinge mitgezählt werden, Steigstränge ebenso …
 * und diese muss über alle Ebenen gehen, nicht nur eine Etage."
 *
 * Geprüft wird an zwei Fällen mit Handrechnung:
 *
 *  1. **Formteile** an einem gezeichneten Netz (siehe Skizze unten).
 *  2. **Fließweg über zwei Geschosse** im Prüfhaus „Steigleitung" (Speicher
 *     im KG, zwei Heizkörper im EG): Die Steigleitung gehört zum Weg, und
 *     ihre Länge steht in den Kennzahlen für RaVia.
 */

import type { PipeRun } from '../../src/types/bim';
import { formteile, formteilSumme } from '../../src/lib/formteile';
import { planeGebaeudeNetz } from '../../src/lib/gebaeudeNetz';
import { buildPipeNetwork } from '../../src/lib/pipeNetwork';
import { wegKennzahlen } from '../../src/lib/netzExport';
import { leitungsbeschriftung } from '../../src/lib/rohrbezeichnung';
import { baueHaus } from './steigleitung';
import type { CheckFn } from './typ';

const rohr = (id: string, pts: number[][], extra: Partial<PipeRun> = {}): PipeRun =>
  ({
    id,
    levelId: 'l',
    service: 'heating-flow',
    points: pts.map(([x, y]) => ({ x, y })),
    nominalDiameter: 15,
    outerDiameter: 15,
    insulation: 0,
    elevation: 0.02,
    material: 'kupfer',
    ...extra,
  }) as PipeRun;

export function pruefeRohrlaengen(check: CheckFn): void {
  // =========================================================================
  // 1 · Formteile aus der Geometrie
  // =========================================================================
  {
    /*
     *   (2,4) ● Steigleitung s (0,02 → 2,75 m)
     *         │ d
     *   (2,2) ┼──── c ────(4,2)═══ e (18 mm) ═══(6,2)
     *         │ b                                 │ f
     *   (0,0)─┘ a                                 └──(7,3)   Knick bei (6,3)
     *
     * Handzählung:
     *  - (2,0) a/b: Ecke → 1 Bogen
     *  - (2,2) b/c/d: drei Abschnitte → 1 T-Stück
     *  - (4,2) c 15 / e 18 gerade → 1 Reduzierung
     *  - (6,2) e 18 / f 15 mit Ecke → 1 Bogen + 1 Reduzierung
     *  - (6,3) innerer Knick der Polylinie f → 1 Bogen
     *  - Steigleitung s: unten und oben je ein Bogen → 2 Bögen (Steigleitung)
     *  Summe: 5 Bögen, 1 T-Stück, 2 Reduzierungen.
     */
    const runs = [
      rohr('a', [[0, 0], [2, 0]]),
      rohr('b', [[2, 0], [2, 2]]),
      rohr('c', [[2, 2], [4, 2]]),
      rohr('d', [[2, 2], [2, 4]]),
      rohr('e', [[4, 2], [6, 2]], { outerDiameter: 18 }),
      rohr('f', [[6, 2], [6, 3], [7, 3]]),
      rohr('s', [[2, 4], [2, 4]], { elevation: 0.02, elevationTo: 2.75 }),
    ];
    const liste = formteile(runs);
    const summe = formteilSumme(liste);
    check('Formteile · 5 Bögen (Handzählung)', summe['bogen-90'], 5);
    check('Formteile · 1 T-Stück', summe['t-stueck'], 1);
    check('Formteile · 2 Reduzierungen', summe.reduzierung, 2);
    check(
      'Formteile · die Steigleitung bringt 2 eigene Bögen',
      liste.filter((f) => f.steigleitung && f.art === 'bogen-90').reduce((s, f) => s + f.anzahl, 0),
      2,
    );
    // Gegenprobe: dieselbe Leitung gerade durchgezogen hat kein Formteil.
    const gerade = formteilSumme(formteile([rohr('g1', [[0, 0], [1, 0]]), rohr('g2', [[1, 0], [2, 0]])]));
    check('Formteile · gerade Stoßstelle gleicher Abmessung: nichts', gerade['bogen-90'] + gerade['t-stueck'] + gerade.reduzierung, 0);
    // Vor- und Rücklauf werden nicht miteinander verschmolzen.
    const getrennt = formteilSumme(
      formteile([rohr('v', [[0, 0], [1, 0]]), rohr('r', [[1, 0], [1, 1]], { service: 'heating-return' })]),
    );
    check('Formteile · Vor- und Rücklauf bilden keinen gemeinsamen Bogen', getrennt['bogen-90'], 0);
  }

  // =========================================================================
  // 2 · Beschriftung mit Länge
  // =========================================================================
  {
    // 3 m + 4 m = 7,00 m — die Länge steht an der Leitung, in Meter mit Komma.
    const l = leitungsbeschriftung(rohr('x', [[0, 0], [3, 0], [3, 4]]));
    check('Beschriftung · nennt die Länge 7,00 m', / · 7,00 m$/.test(l), true);
  }

  // =========================================================================
  // 3 · Der Fließweg geht über die Steigleitung
  // =========================================================================
  {
    const doc = baueHaus();
    const erg = planeGebaeudeNetz(doc, { mode: 'sanierung', levelId: 'eg' });
    doc.pipes = Object.fromEntries(erg.runs.map((r) => [r.id, r]));
    doc.pipeAccessories = Object.fromEntries((erg.accessories ?? []).map((a) => [a.id, a]));
    const netz = buildPipeNetwork(doc);
    check('Fließweg · beide Heizkörper im EG erreicht', netz.paths.length, 2);
    check('Fließweg · kein Verbraucher ohne Weg', netz.unconnected.length, 0);
    check('Fließweg · Quelle ist der Speicher im KG', netz.paths.every((p) => p.sourceFixtureId === 'puffer'), true);

    const k = wegKennzahlen(netz);
    const hk0 = k.get('hk0');
    const hk1 = k.get('hk1');
    /*
     * Steigleitung: Verlegehöhe KG 0,04 m bis Verlegehöhe EG 2,50 + 0,04 m,
     * also 2,50 m — 2,46 m im Strang und 0,04 m durch die Decke.
     */
    check('Kennzahlen · Steigleitung 2,50 m im Weg', hk0?.riserLength ?? 0, 2.5, 0.01);
    /*
     * HK 1 sitzt bei x = 2, also genau über dem Strang; HK 2 bei x = 6. Der
     * Unterschied der Wege ist die Strecke dazwischen: 4,00 m.
     */
    check('Kennzahlen · HK 2 liegt 4,00 m weiter', (hk1?.routeLength ?? 0) - (hk0?.routeLength ?? 0), 4.0, 0.02);
    // Der kürzeste Weg kann nicht kürzer sein als Strang plus Weg im KG (1,2 m).
    check('Kennzahlen · HK 1 mindestens Strang + 1,2 m', (hk0?.routeLength ?? 0) >= 3.7 - 0.01, true);
    check(
      'Kennzahlen · Kreislänge = 2 × Weg (Vor- und Rücklauf)',
      hk0?.circuitLength ?? 0,
      2 * ((hk0?.routeLength ?? 0) + (hk0?.feedLength ?? 0)),
      1e-6,
    );
    check('Kennzahlen · Bögen der Steigleitung im Weg', (hk0?.fittings ?? []).some((f) => f.id === 'bogen-90' && f.count >= 2), true);
    check('Kennzahlen · T-Abzweig auf dem Weg zu HK 2', (hk1?.fittings ?? []).some((f) => f.id === 't-abzweig'), true);
  }

  // =========================================================================
  // 4 · Mehrere Geschosse mit eigenem Verteiler: alle werden ausgelegt
  // =========================================================================
  {
    const doc = baueHaus({ ohneSpeicher: true, hkImKg: true, verteilerJeGeschoss: true });
    const erg = planeGebaeudeNetz(doc, { mode: 'sanierung', levelId: 'eg' });
    check('Alle Geschosse · KG hat Leitungen', erg.runs.some((r) => r.levelId === 'kg'), true);
    check('Alle Geschosse · EG hat Leitungen', erg.runs.some((r) => r.levelId === 'eg'), true);
    check('Alle Geschosse · alle drei Heizkörper versorgt', erg.served, 3);
  }
}
