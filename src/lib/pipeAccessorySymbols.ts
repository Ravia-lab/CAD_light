/**
 * Symbolik der Armaturen am Rohrnetz — eine Quelle für Bildschirm und Blatt.
 * ---------------------------------------------------------------------------
 * Die Geometrie steht hier **einmal**, in lokalen Koordinaten um die
 * Einbaustelle, und wird von beiden Zeichnern gelesen. Das ist die Lehre aus
 * 1.8.x: zwei Kopien derselben Symbolgeometrie laufen auseinander, und man
 * merkt es erst auf dem Papier.
 *
 * Maßstab: die Symbole sind in **Metern** beschrieben, bezogen auf eine
 * Symbolgröße von 1 m, und werden vom Zeichner skaliert. Dadurch bleibt das
 * Verhältnis von Ventilkegel zu Rohrachse in jedem Maßstab gleich.
 */

import type { PipeAccessoryKind, Vec2 } from '../types/bim';

export type AccessoryPart =
  | { kind: 'line'; a: Vec2; b: Vec2; weight: 'stark' | 'fein' }
  | { kind: 'poly'; points: Vec2[]; closed: boolean; filled: boolean; weight: 'stark' | 'fein' }
  | { kind: 'circle'; c: Vec2; r: number; filled: boolean; weight: 'stark' | 'fein' }
  | { kind: 'arc'; c: Vec2; r: number; from: number; to: number; weight: 'stark' | 'fein' };

/** Deutscher Name je Armaturenart — für Legende, Plan und Massenauszug. */
export const ACCESSORY_LABELS: Record<PipeAccessoryKind, string> = {
  shutoff: 'Absperrarmatur',
  'thermostatic-valve': 'Thermostatventil',
  lockshield: 'Rücklaufverschraubung',
  'balancing-valve': 'Strangregulierventil',
  'differential-pressure': 'Differenzdruckregler',
  'air-vent': 'Entlüftung',
  drain: 'Entleerung',
  'fixed-point': 'Festpunkt',
  'expansion-bend': 'Dehnungsbogen',
  tee: 'T-Stück',
  elbow: 'Bogen',
  strainer: 'Schmutzfänger',
};

/** Ein Satz für den Monteur: wozu die Armatur da ist. */
export const ACCESSORY_LEGEND: Record<PipeAccessoryKind, string> = {
  shutoff:
    'Trennt einen Anlagenteil vom Netz, damit er ohne Entleerung der ganzen Anlage gewartet werden kann.',
  'thermostatic-valve':
    'Regelt die Raumtemperatur selbsttätig — nach § 63 GEG/GModG für jeden Raum gefordert.',
  lockshield:
    'Absperrt und voreinstellt den Heizkörperrücklauf; sie trägt den Einstellwert des hydraulischen Abgleichs.',
  'balancing-valve':
    'Drosselt einen Strang auf seinen Sollvolumenstrom. Im Teillastbetrieb kann sie den Differenzdruck am Thermostatventil über die Geräuschgrenze treiben.',
  'differential-pressure':
    'Hält den Differenzdruck im Strang konstant. Vorzuziehen, wo eine feste Drossel im Teillastbetrieb Geräusche erzeugen würde.',
  'air-vent': 'Am Hochpunkt: dort sammelt sich die Luft, die im Wasser gelöst war.',
  drain: 'Am Tiefpunkt: nur dort läuft die Anlage vollständig leer.',
  'fixed-point':
    'Begrenzt die Strecke, über die sich das Rohr ausdehnen darf. Ohne ihn wandert die Dehnung dorthin, wo sie Schaden anrichtet.',
  'expansion-bend': 'Nimmt die Längenänderung des Rohres auf, ohne sie an die Befestigung weiterzugeben.',
  tee: 'Abzweig — hier teilt sich der Volumenstrom.',
  elbow: 'Richtungswechsel der Trasse.',
  strainer: 'Hält Partikel zurück, bevor sie in Pumpe, Ventil oder Wärmetauscher gelangen.',
};

const P = (x: number, y: number): Vec2 => ({ x, y });

/**
 * Der klassische Ventilkörper: zwei Dreiecke, die sich an der Spitze
 * berühren. Er ist die gemeinsame Grundform aller Absperr- und
 * Regelarmaturen; was darauf sitzt, unterscheidet sie.
 */
function ventilkoerper(weight: 'stark' | 'fein' = 'stark'): AccessoryPart[] {
  return [
    { kind: 'poly', points: [P(-0.5, -0.3), P(-0.5, 0.3), P(0, 0)], closed: true, filled: false, weight },
    { kind: 'poly', points: [P(0.5, -0.3), P(0.5, 0.3), P(0, 0)], closed: true, filled: false, weight },
  ];
}

/**
 * Die Symbolteile einer Armatur, in lokalen Koordinaten (Einbaustelle im
 * Ursprung, Ausdehnung etwa ±0,5).
 */
export function accessorySymbol(kind: PipeAccessoryKind): AccessoryPart[] {
  switch (kind) {
    case 'shutoff':
      // Kugelhahn: Ventilkörper mit Kugel und Hebel.
      return [
        ...ventilkoerper(),
        { kind: 'circle', c: P(0, 0), r: 0.16, filled: false, weight: 'stark' },
        { kind: 'line', a: P(0, 0), b: P(0, -0.55), weight: 'fein' },
      ];
    case 'thermostatic-valve':
      // Ventil mit Thermostatkopf — der Kopf ist das, was man im Raum sieht.
      return [
        ...ventilkoerper(),
        { kind: 'line', a: P(0, 0), b: P(0, -0.35), weight: 'fein' },
        { kind: 'poly', points: [P(-0.28, -0.35), P(0.28, -0.35), P(0.28, -0.62), P(-0.28, -0.62)], closed: true, filled: false, weight: 'stark' },
        { kind: 'line', a: P(-0.18, -0.48), b: P(0.18, -0.48), weight: 'fein' },
      ];
    case 'lockshield':
      // Rücklaufverschraubung: Ventilkörper mit Kappe statt Kopf.
      return [
        ...ventilkoerper(),
        { kind: 'line', a: P(0, 0), b: P(0, -0.3), weight: 'fein' },
        { kind: 'poly', points: [P(-0.16, -0.3), P(0.16, -0.3), P(0.16, -0.46), P(-0.16, -0.46)], closed: true, filled: true, weight: 'stark' },
      ];
    case 'balancing-valve':
      // Strangregulierventil: Ventil mit Skala.
      return [
        ...ventilkoerper(),
        { kind: 'line', a: P(0, 0), b: P(0, -0.38), weight: 'fein' },
        { kind: 'line', a: P(-0.22, -0.38), b: P(0.22, -0.38), weight: 'stark' },
        { kind: 'line', a: P(-0.12, -0.38), b: P(-0.12, -0.52), weight: 'fein' },
        { kind: 'line', a: P(0.12, -0.38), b: P(0.12, -0.52), weight: 'fein' },
      ];
    case 'differential-pressure':
      // Differenzdruckregler: Ventil mit Membrandose und Steuerleitung.
      return [
        ...ventilkoerper(),
        { kind: 'line', a: P(0, 0), b: P(0, -0.34), weight: 'fein' },
        { kind: 'arc', c: P(0, -0.34), r: 0.24, from: Math.PI, to: 0, weight: 'stark' },
        { kind: 'line', a: P(-0.24, -0.34), b: P(0.24, -0.34), weight: 'stark' },
        { kind: 'line', a: P(0.24, -0.34), b: P(0.55, -0.34), weight: 'fein' },
      ];
    case 'air-vent':
      // Entlüfter: Topf mit Pfeil nach oben.
      return [
        { kind: 'circle', c: P(0, -0.2), r: 0.2, filled: false, weight: 'stark' },
        { kind: 'line', a: P(0, -0.4), b: P(0, -0.62), weight: 'stark' },
        { kind: 'line', a: P(-0.1, -0.52), b: P(0, -0.62), weight: 'stark' },
        { kind: 'line', a: P(0.1, -0.52), b: P(0, -0.62), weight: 'stark' },
        { kind: 'line', a: P(0, 0), b: P(0, -0.2), weight: 'fein' },
      ];
    case 'drain':
      // Entleerung: Hahn mit Schlauchtülle nach unten.
      return [
        ...ventilkoerper('fein'),
        { kind: 'line', a: P(0, 0), b: P(0, 0.42), weight: 'stark' },
        { kind: 'line', a: P(-0.14, 0.42), b: P(0.14, 0.42), weight: 'stark' },
        { kind: 'line', a: P(-0.08, 0.55), b: P(0.08, 0.55), weight: 'fein' },
      ];
    case 'fixed-point':
      // Festpunkt: das Rohr wird gegen die Wand festgesetzt — Kreuz im Quadrat.
      return [
        { kind: 'poly', points: [P(-0.32, -0.32), P(0.32, -0.32), P(0.32, 0.32), P(-0.32, 0.32)], closed: true, filled: false, weight: 'stark' },
        { kind: 'line', a: P(-0.32, -0.32), b: P(0.32, 0.32), weight: 'fein' },
        { kind: 'line', a: P(0.32, -0.32), b: P(-0.32, 0.32), weight: 'fein' },
      ];
    case 'expansion-bend':
      // Dehnungsbogen: die U-Form, die die Längenänderung aufnimmt.
      return [
        { kind: 'line', a: P(-0.5, 0.2), b: P(-0.28, 0.2), weight: 'stark' },
        { kind: 'line', a: P(-0.28, 0.2), b: P(-0.28, -0.3), weight: 'stark' },
        { kind: 'arc', c: P(0, -0.3), r: 0.28, from: Math.PI, to: 0, weight: 'stark' },
        { kind: 'line', a: P(0.28, -0.3), b: P(0.28, 0.2), weight: 'stark' },
        { kind: 'line', a: P(0.28, 0.2), b: P(0.5, 0.2), weight: 'stark' },
      ];
    case 'tee':
      // Abzweig: ein voller Punkt. Mehr braucht es nicht, und weniger wäre
      // im Plan nicht zu finden.
      return [{ kind: 'circle', c: P(0, 0), r: 0.16, filled: true, weight: 'stark' }];
    case 'elbow':
      return [{ kind: 'arc', c: P(0, 0), r: 0.22, from: Math.PI, to: Math.PI * 1.5, weight: 'fein' }];
    case 'strainer':
      // Schmutzfänger: Ventilkörper mit schrägem Siebkorb.
      return [
        ...ventilkoerper(),
        { kind: 'line', a: P(0.1, 0.08), b: P(0.42, 0.42), weight: 'stark' },
        { kind: 'line', a: P(0.2, 0.42), b: P(0.42, 0.2), weight: 'fein' },
      ];
    default:
      return [{ kind: 'circle', c: P(0, 0), r: 0.2, filled: false, weight: 'stark' }];
  }
}
