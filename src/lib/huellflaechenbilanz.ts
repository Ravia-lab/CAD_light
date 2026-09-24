/**
 * Hüllflächenbilanz — die Prüfsumme gegen verlorene Bauteile.
 * ---------------------------------------------------------------------------
 * **Punkt 13.** Die Übernahme auf der Gegenseite berücksichtigt Boden, Decke
 * und Dach nicht; gerechnet wird still zu niedrig. CAD Light liefert diese
 * Flächen längst — je Raum in `surfaces[]`, jede mit Fläche, U-Wert und
 * Randbedingung. Was fehlte, war eine Zahl, an der sich in einem Blick
 * ablesen lässt, ob die Gegenseite sie **angekommen** ist.
 *
 * Diese Bilanz ist genau das. Je Raum und für das ganze Gebäude:
 *
 *   H = Σ A_netto · (U + ΔU_WB)   [W/K]
 *
 * aufgeteilt nach Bauteilart (Wand, Fenster, Tür, Boden, Decke, Dach, Giebel)
 * und nach Randbedingung (Außenluft, Erdreich, unbeheizt, Nachbarraum).
 *
 * **Und das ist ausdrücklich keine Heizlast.** Es fehlen die
 * Temperaturkorrekturfaktoren der Norm (f_x für Erdreich, unbeheizte Bereiche
 * und Nachbarräume), die Lüftung und die Aufheizleistung — sie gehören in die
 * Rechnung der Gegenstelle und werden hier bewusst *nicht* angewandt. Was hier
 * steht, ist die Eingangsgröße: Fläche mal Wärmedurchgangskoeffizient, also
 * das, was CAD Light gemessen und der Nutzer eingetragen hat.
 *
 * **Wozu das gut ist.** Wer die Übernahme prüfen will, vergleicht die eigene
 * Summe A·U je Bauteilart mit dieser. Fehlen Boden, Decke oder Dach, ist die
 * Differenz nicht zu übersehen — am Referenzhaus sind es über 40 % der
 * Hüllfläche. Ohne diese Bilanz muss man dafür zwei Programme nebeneinander
 * aufmachen und Flächen zählen.
 *
 * Gerundet wird auf drei Nachkommastellen: W/K in Milliwatt je Kelvin
 * aufzuschreiben wäre eine Genauigkeit, die die U-Werte nicht hergeben.
 */

/** Bauteilarten der Bilanz — `window` und `door` kommen aus den Öffnungen. */
export type BilanzArt = 'wall' | 'window' | 'door' | 'floor' | 'ceiling' | 'roof' | 'gable' | 'other';

/** Randbedingungen, wie sie an der Fläche stehen. */
export type BilanzRand = 'exterior' | 'ground' | 'unheated' | 'adjacent-room' | 'other';

export interface BilanzPosten {
  /** Nettofläche [m²] — Wandflächen ohne ihre Öffnungen. */
  netArea: number;
  /** Σ A · (U + ΔU_WB) [W/K], **ohne** Temperaturkorrekturfaktoren. */
  heatTransferCoefficient: number;
}

export interface Huellflaechenbilanz {
  byKind: Partial<Record<BilanzArt, BilanzPosten>>;
  byBoundary: Partial<Record<BilanzRand, BilanzPosten>>;
  total: BilanzPosten;
  /**
   * Anteil von Boden, Decke, Dach und Giebel am Gesamtwert [0…1].
   *
   * Genau der Anteil, der bei Punkt 13 verloren ging. Er steht als eigene
   * Zahl da, damit man ihn nicht erst ausrechnen muss.
   */
  shareHorizontal: number;
  /**
   * Flächen, deren U-Wert keine endliche Zahl war [Stück].
   *
   * **Warum das hier steht.** Eine einzige Fläche mit `undefined` als U-Wert
   * machte aus der Summe ein `NaN` — und damit aus der *Prüfsumme gegen
   * verlorene Bauteile* eine Zahl, die selbst nichts mehr aussagt. Genau das
   * ist passiert: Ein Dach aus einer Projektdatei ohne Aufbau, und die
   * Gebäudebilanz war `null`. Solche Flächen gehen jetzt mit 0 W/K ein und
   * werden **gezählt**; steht hier etwas anderes als 0, ist die Bilanz
   * unvollständig, und man sieht es, statt es zu übersehen.
   */
  withoutUValue: number;
  /** Was die Zahl **nicht** enthält — im Datensatz, nicht nur im Handbuch. */
  note: string;
}

/** Die Form, in der die Flächen im Export stehen — nur das, was hier zählt. */
export interface BilanzFlaeche {
  kind: string;
  netArea: number;
  uValue: number;
  thermalBridgeSupplement?: number;
  boundary?: string;
  openings?: {
    kind: string;
    area: number;
    uValue: number;
  }[];
}

const HORIZONTAL: BilanzArt[] = ['floor', 'ceiling', 'roof', 'gable'];

const ART: Record<string, BilanzArt> = {
  wall: 'wall',
  floor: 'floor',
  ceiling: 'ceiling',
  roof: 'roof',
  gable: 'gable',
  window: 'window',
  door: 'door',
};

const RAND: Record<string, BilanzRand> = {
  exterior: 'exterior',
  ground: 'ground',
  unheated: 'unheated',
  'adjacent-room': 'adjacent-room',
};

const runde = (x: number) => Math.round(x * 1000) / 1000;

function addiere(ziel: Partial<Record<string, BilanzPosten>>, schluessel: string, flaeche: number, h: number): void {
  const bestand = ziel[schluessel] ?? { netArea: 0, heatTransferCoefficient: 0 };
  ziel[schluessel] = {
    netArea: bestand.netArea + flaeche,
    heatTransferCoefficient: bestand.heatTransferCoefficient + h,
  };
}

/**
 * Bilanz über einen Satz Hüllflächen — je Raum oder über das ganze Gebäude,
 * je nachdem, was hineingegeben wird.
 */
export function huellflaechenbilanz(flaechen: readonly BilanzFlaeche[]): Huellflaechenbilanz {
  const byKind: Partial<Record<string, BilanzPosten>> = {};
  const byBoundary: Partial<Record<string, BilanzPosten>> = {};
  let ohneU = 0;

  /** Eine Zahl, oder 0 — und dann gezählt. Siehe `withoutUValue`. */
  const zahl = (x: unknown): number => {
    if (typeof x === 'number' && Number.isFinite(x)) return x;
    ohneU++;
    return 0;
  };

  for (const f of flaechen) {
    const art = ART[f.kind] ?? 'other';
    const rand = RAND[f.boundary ?? ''] ?? 'other';
    const u = zahl(f.uValue) + (Number.isFinite(f.thermalBridgeSupplement) ? f.thermalBridgeSupplement! : 0);
    const h = zahl(f.netArea) * u;
    addiere(byKind, art, f.netArea, h);
    addiere(byBoundary, rand, f.netArea, h);

    /*
     * Fenster und Türen sitzen **in** der Wand: Ihre Fläche ist aus der
     * Nettofläche der Wand schon heraus, ihr Beitrag fehlt aber noch. Ohne
     * diese Schleife wäre die Bilanz genau um die Fenster zu klein — und das
     * ist der Posten, den beim Nachrechnen jeder zuerst sucht.
     */
    for (const o of f.openings ?? []) {
      const oart: BilanzArt = o.kind === 'door' ? 'door' : o.kind === 'window' ? 'window' : 'other';
      const oflaeche = zahl(o.area);
      const oh = oflaeche * zahl(o.uValue);
      addiere(byKind, oart, oflaeche, oh);
      addiere(byBoundary, rand, oflaeche, oh);
    }
  }

  let netArea = 0;
  let h = 0;
  for (const p of Object.values(byKind)) {
    netArea += p!.netArea;
    h += p!.heatTransferCoefficient;
  }
  const horizontal = HORIZONTAL.reduce((s, k) => s + (byKind[k]?.heatTransferCoefficient ?? 0), 0);

  const auf = (q: Partial<Record<string, BilanzPosten>>) =>
    Object.fromEntries(
      Object.entries(q).map(([k, v]) => [
        k,
        { netArea: runde(v!.netArea), heatTransferCoefficient: runde(v!.heatTransferCoefficient) },
      ]),
    );

  return {
    byKind: auf(byKind) as Huellflaechenbilanz['byKind'],
    byBoundary: auf(byBoundary) as Huellflaechenbilanz['byBoundary'],
    total: { netArea: runde(netArea), heatTransferCoefficient: runde(h) },
    shareHorizontal: h > 0 ? Math.round((horizontal / h) * 1000) / 1000 : 0,
    withoutUValue: ohneU,
    note:
      'Σ A·(U+ΔU_WB) ohne Temperaturkorrekturfaktoren, ohne Lüftung, ohne Aufheizleistung — ' +
      'Eingangsgröße zur Prüfung der Übernahme, keine Heizlast.',
  };
}
