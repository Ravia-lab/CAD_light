/**
 * Prüfblock „Hüllflächenbilanz" — die Prüfsumme zu Punkt 13.
 * ---------------------------------------------------------------------------
 * **Punkt 13:** Die Übernahme auf der Gegenseite berücksichtigt Boden, Decke
 * und Dach nicht und rechnet dadurch still zu niedrig. CAD Light liefert diese
 * Flächen seit jeher mit; seit Export 2.3.0 liefert es dazu die **Bilanz**,
 * an der sich in einem Blick ablesen lässt, ob sie angekommen sind:
 *
 *     H = Σ A_netto · (U + ΔU_WB)   [W/K]
 *
 * je Bauteilart und je Randbedingung, dazu der Anteil der waagerechten
 * Bauteile. Ausdrücklich **keine Heizlast**: ohne Temperaturkorrekturfaktoren,
 * ohne Lüftung, ohne Aufheizleistung.
 *
 * Geprüft wird hier dreierlei:
 *  1. die Rechnung selbst, an einem von Hand gerechneten Satz Flächen;
 *  2. dass Fenster und Türen **zusätzlich** zur Nettowandfläche zählen — der
 *     Posten, den beim Nachrechnen jeder zuerst sucht;
 *  3. am Referenzhaus: dass die Bilanz des Gebäudes die Summe der Räume ist,
 *     und wie groß der Anteil ist, um den es bei Punkt 13 geht.
 */

import { huellflaechenbilanz, type BilanzFlaeche } from '../../src/lib/huellflaechenbilanz';
import { buildRaviaExport } from '../../src/lib/raviaExport';
import { buildReferenceDocument } from '../reference';
import type { CheckFn } from './typ';

export function pruefeHuellflaeche(check: CheckFn): void {
  // =========================================================================
  // 1 · Die Rechnung, von Hand
  // =========================================================================
  /*
   * Ein Raum mit fünf Flächen:
   *
   *   Wand   20,00 m² · (0,28 + 0,05) = 6,600 W/K   (Außenluft)
   *     darin Fenster  2,00 m² · 1,10 = 2,200 W/K
   *     darin Tür      1,80 m² · 1,60 = 2,880 W/K
   *   Boden  30,00 m² · 0,35          = 10,500 W/K  (Erdreich)
   *   Decke  30,00 m² · 0,20          = 6,000 W/K   (unbeheizt)
   *   Dach   12,00 m² · 0,24          = 2,880 W/K   (Außenluft)
   *
   * Summe H = 6,600 + 2,200 + 2,880 + 10,500 + 6,000 + 2,880 = 31,060 W/K
   * Fläche  = 20 + 2 + 1,8 + 30 + 30 + 12                    = 95,80 m²
   * Waagerecht (Boden + Decke + Dach) = 10,5 + 6,0 + 2,88     = 19,380 W/K
   *   Anteil 19,380 / 31,060 = 0,624
   * Nach Randbedingung: Außenluft 6,6 + 2,2 + 2,88 + 2,88 = 14,560 W/K,
   *   Erdreich 10,500, unbeheizt 6,000.
   */
  {
    const flaechen: BilanzFlaeche[] = [
      {
        kind: 'wall',
        netArea: 20,
        uValue: 0.28,
        thermalBridgeSupplement: 0.05,
        boundary: 'exterior',
        openings: [
          { kind: 'window', area: 2, uValue: 1.1 },
          { kind: 'door', area: 1.8, uValue: 1.6 },
        ],
      },
      { kind: 'floor', netArea: 30, uValue: 0.35, boundary: 'ground' },
      { kind: 'ceiling', netArea: 30, uValue: 0.2, boundary: 'unheated' },
      { kind: 'roof', netArea: 12, uValue: 0.24, boundary: 'exterior' },
    ];
    const b = huellflaechenbilanz(flaechen);

    check('Wand mit Wärmebrückenzuschlag [W/K]', b.byKind.wall?.heatTransferCoefficient ?? 0, 6.6, 0.001);
    check('Fenster zählt zusätzlich [W/K]', b.byKind.window?.heatTransferCoefficient ?? 0, 2.2, 0.001);
    check('Tür zählt zusätzlich [W/K]', b.byKind.door?.heatTransferCoefficient ?? 0, 2.88, 0.001);
    check('Boden [W/K]', b.byKind.floor?.heatTransferCoefficient ?? 0, 10.5, 0.001);
    check('Decke [W/K]', b.byKind.ceiling?.heatTransferCoefficient ?? 0, 6, 0.001);
    check('Dach [W/K]', b.byKind.roof?.heatTransferCoefficient ?? 0, 2.88, 0.001);
    check('Summe [W/K]', b.total.heatTransferCoefficient, 31.06, 0.001);
    check('Summe der Flächen [m²]', b.total.netArea, 95.8, 0.001);
    check('Anteil der waagerechten Bauteile', b.shareHorizontal, 0.624, 0.001);

    check('Außenluft [W/K]', b.byBoundary.exterior?.heatTransferCoefficient ?? 0, 14.56, 0.001);
    check('Erdreich [W/K]', b.byBoundary.ground?.heatTransferCoefficient ?? 0, 10.5, 0.001);
    check('Unbeheizt [W/K]', b.byBoundary.unheated?.heatTransferCoefficient ?? 0, 6, 0.001);
    check('Nach Randbedingung dieselbe Summe',
      Object.values(b.byBoundary).reduce((s, p) => s + p.heatTransferCoefficient, 0), 31.06, 0.001);
    check('Der Hinweis sagt, dass es keine Heizlast ist', b.note.includes('keine Heizlast'), true);

    /*
     * Die Gegenprobe zu Punkt 13: Wer Boden, Decke und Dach wegwirft, behält
     * 11,68 von 31,06 W/K — also **62 % zu wenig**. Genau das soll die Zahl
     * sichtbar machen.
     */
    const ohneWaagerecht = huellflaechenbilanz(flaechen.filter((f) => f.kind === 'wall'));
    check('Ohne die waagerechten Bauteile [W/K]', ohneWaagerecht.total.heatTransferCoefficient, 11.68, 0.001);
    check('Das wären 62 % zu wenig',
      Math.round((1 - ohneWaagerecht.total.heatTransferCoefficient / b.total.heatTransferCoefficient) * 100), 62);
  }

  // =========================================================================
  // 2 · Leere Eingabe
  // =========================================================================
  {
    const leer = huellflaechenbilanz([]);
    check('Ohne Flächen: keine Summe', leer.total.heatTransferCoefficient, 0);
    check('… und kein Anteil', leer.shareHorizontal, 0);
  }

  // =========================================================================
  // 3 · Am Referenzhaus
  // =========================================================================
  {
    const ex = buildRaviaExport(buildReferenceDocument());

    // Zweite, unabhängige Stimme: hier wird von Hand über alle Flächen
    // summiert, nicht das Modul noch einmal gefragt.
    let summe = 0;
    let flaeche = 0;
    for (const raum of ex.rooms) {
      for (const s of raum.surfaces) {
        summe += s.netArea * (s.uValue + (s.thermalBridgeSupplement ?? 0));
        flaeche += s.netArea;
        for (const o of s.openings ?? []) {
          summe += o.area * o.uValue;
          flaeche += o.area;
        }
      }
    }
    check('Gebäudebilanz = eigene Summe [W/K]', ex.envelope.total.heatTransferCoefficient, Math.round(summe * 1000) / 1000, 0.01);
    check('… und dieselbe Fläche [m²]', ex.envelope.total.netArea, Math.round(flaeche * 1000) / 1000, 0.01);

    const ausRaeumen = ex.rooms.reduce((s, r) => s + r.envelope.total.heatTransferCoefficient, 0);
    check('Das Gebäude ist die Summe seiner Räume', Math.round(ausRaeumen * 100) / 100,
      Math.round(ex.envelope.total.heatTransferCoefficient * 100) / 100, 0.02);

    check('Jeder Raum hat eine Bilanz', ex.rooms.every((r) => !!r.envelope), true);
    check('Alle Bauteilarten kommen vor',
      ['wall', 'window', 'door', 'floor', 'ceiling', 'roof', 'gable'].every((k) => !!(ex.envelope.byKind as Record<string, unknown>)[k]), true);

    /*
     * Die Zahl, um die es bei Punkt 13 geht: Am Referenzhaus stecken 46,5 %
     * des gesamten A·U in Boden, Decke, Dach und Giebel. Wer sie nicht
     * übernimmt, rechnet mit gut der Hälfte der Hüllfläche.
     */
    check('Anteil Boden/Decke/Dach/Giebel am Referenzhaus', ex.envelope.shareHorizontal, 0.465, 0.01);
    check('Die Fassung sagt es', ex.version, '2.3.0');
  }
}
