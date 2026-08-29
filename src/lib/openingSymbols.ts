/**
 * Öffnungssymbolik im Grundriss — die *eine* Wahrheit für Bildschirm und Blatt.
 * ---------------------------------------------------------------------------
 * Bis 1.7.0 zeichnete der Editor Türblatt und Schwenkbogen selbst, und der
 * Ausdruck zeichnete gar nichts: dort blieb von einer Tür nur eine weiße Lücke
 * mit zwei Strichen übrig. Wer den Plan gedruckt in die Hand nahm, konnte
 * Türen, Durchgänge und Fenster nicht mehr unterscheiden — die Striche sahen
 * aus wie Marken, nicht wie Bauteile.
 *
 * Deshalb steht die Symbolgeometrie hier, in Weltkoordinaten und ohne jede
 * Farbe. Was ein Renderer daraus macht — Canvas mit Auswahlfarben, SVG in
 * Millimetern —, ist seine Sache; *was* dargestellt wird, ist es nicht.
 *
 * Winkelkonvention: alle Winkel sind Modellwinkel (mathematisch positiv, y
 * zeigt nach oben). Beide Renderer zeichnen in y-nach-unten und müssen sie
 * spiegeln — Canvas über negierte Winkel und umgekehrten Drehsinn, SVG über
 * das Sweep-Flag. Genau deshalb steht der Drehsinn hier explizit als `ccw`
 * und nicht implizit in der Reihenfolge der Winkel.
 */

import type { Opening, Vec2 } from '../types/bim';
import type { WallGeometry } from './wallGeometry';
import { openingSpan, wallLocalToWorld } from './wallGeometry';

/** Strichstärkenklasse. Der Renderer setzt die Zahlen, nicht dieses Modul. */
export type SymbolWeight = 'stark' | 'mittel' | 'fein';

/** Wofür ein Teil steht — der Renderer färbt danach ein. */
export type SymbolRole = 'laibung' | 'blatt' | 'bogen' | 'glas' | 'sturz' | 'pfeil';

export type SymbolPart =
  | {
      kind: 'line';
      a: Vec2;
      b: Vec2;
      weight: SymbolWeight;
      role: SymbolRole;
      dashed?: boolean;
      faint?: boolean;
    }
  | {
      kind: 'arc';
      center: Vec2;
      radius: number;
      /** Startwinkel im Modell [rad]. */
      startAngle: number;
      endAngle: number;
      /** Drehsinn im Modell: true = gegen den Uhrzeigersinn. */
      ccw: boolean;
      weight: SymbolWeight;
      role: SymbolRole;
      faint?: boolean;
    };

/**
 * Die Symbolteile einer Öffnung in Weltkoordinaten.
 *
 * Enthalten sind die Laibungen (allen Arten gemeinsam) und das, was die Art
 * ausmacht: Glasebenen und Flügelteilung beim Fenster, gestrichelter Sturz
 * beim Durchgang, Blatt und Schwenkbogen bei der Tür.
 */
export function openingSymbol(g: WallGeometry, op: Opening): SymbolPart[] {
  const { from, to } = openingSpan(g, op);
  const half = g.halfThickness;
  const p = (u: number, s: number): Vec2 => wallLocalToWorld(g, u, s);
  const parts: SymbolPart[] = [];

  // Laibungskanten — ohne sie steht die Öffnung nicht in der Wand, sondern
  // neben ihr.
  for (const u of [from, to]) {
    parts.push({
      kind: 'line',
      a: p(u, half),
      b: p(u, -half),
      weight: 'mittel',
      role: 'laibung',
    });
  }

  if (op.kind === 'passage') {
    // Durchgang: der Sturz gestrichelt auf beiden Wandseiten. Mehr gibt es
    // nicht zu zeigen — genau das unterscheidet ihn von der Tür.
    for (const s of [half, -half]) {
      parts.push({
        kind: 'line',
        a: p(from, s),
        b: p(to, s),
        weight: 'fein',
        role: 'sturz',
        dashed: true,
        faint: true,
      });
    }
    if (op.passageType === 'arch') {
      const c = p((from + to) / 2, 0);
      parts.push({
        kind: 'arc',
        center: c,
        radius: op.width / 2,
        startAngle: g.angle,
        endAngle: g.angle + Math.PI,
        ccw: true,
        weight: 'fein',
        role: 'bogen',
        faint: true,
      });
    }
    return parts;
  }

  if (op.kind === 'window') {
    // Glasebenen: zwei durchgehende Linien im Rahmen. Sie sind das Merkmal,
    // an dem ein Fenster im Grundriss erkannt wird.
    for (const s of [half * 0.42, -half * 0.42]) {
      parts.push({
        kind: 'line',
        a: p(from, s),
        b: p(to, s),
        weight: 'fein',
        role: 'glas',
      });
    }

    const panels = op.panels ?? (op.windowType === 'double' ? 2 : op.windowType === 'ribbon' ? 3 : 1);
    for (let i = 1; i < panels; i++) {
      const u = from + ((to - from) * i) / panels;
      parts.push({
        kind: 'line',
        a: p(u, half),
        b: p(u, -half),
        weight: 'fein',
        role: 'glas',
      });
    }

    if (op.windowType === 'tilt-turn' || op.windowType === 'casement') {
      // Kippsymbol: das Dach über der Mitte. Klein, aber es unterscheidet das
      // zu öffnende Fenster von der Festverglasung.
      const r = Math.min(op.width, 0.5) * 0.3;
      const c = (from + to) / 2;
      parts.push(
        { kind: 'line', a: p(c - r, 0), b: p(c, r * 0.9), weight: 'fein', role: 'glas', faint: true },
        { kind: 'line', a: p(c, r * 0.9), b: p(c + r, 0), weight: 'fein', role: 'glas', faint: true },
      );
    }
    return parts;
  }

  // --- Türen ---------------------------------------------------------------
  const swing = op.flipSwing ? -1 : 1;

  if (op.doorType === 'sliding') {
    // Schiebetür: das Blatt liegt vor der Wand, der Pfeil zeigt, wohin es
    // fährt. Kein Schwenkbogen — sie schwenkt nicht.
    parts.push({
      kind: 'line',
      a: p(from, half * 0.75 * swing),
      b: p(to, half * 0.75 * swing),
      weight: 'stark',
      role: 'blatt',
    });
    const tipU = op.hinge === 'right' ? from : to;
    const tailU = (from + to) / 2;
    const s = -half * 0.5 * swing;
    const tip = p(tipU, s);
    const dirSign = tipU > tailU ? 1 : -1;
    const barb = op.width * 0.18;
    parts.push(
      { kind: 'line', a: p(tailU, s), b: tip, weight: 'fein', role: 'pfeil', faint: true },
      {
        kind: 'line',
        a: tip,
        b: p(tipU - dirSign * barb, s + barb * 0.6),
        weight: 'fein',
        role: 'pfeil',
        faint: true,
      },
      {
        kind: 'line',
        a: tip,
        b: p(tipU - dirSign * barb, s - barb * 0.6),
        weight: 'fein',
        role: 'pfeil',
        faint: true,
      },
    );
    return parts;
  }

  if (op.doorType === 'double') {
    // Zweiflügelig: zwei gegenläufige Blätter halber Breite, beide zur Mitte
    // hin aufschlagend.
    const leafWidth = op.width / 2;
    for (const [hingeU, dir] of [
      [from, 1],
      [to, -1],
    ] as [number, number][]) {
      parts.push(...doorLeaf(hingeU, leafWidth * dir, swing, p));
    }
    return parts;
  }

  // Einflügelig: Band an der eingestellten Seite.
  const hingeU = op.hinge === 'right' ? to : from;
  const dir = op.hinge === 'right' ? -1 : 1;
  parts.push(...doorLeaf(hingeU, op.width * dir, swing, p));
  return parts;
}

/**
 * Blatt und Schwenkbogen eines Türflügels.
 *
 * `reach` ist die Blattbreite mit Vorzeichen in Achsrichtung: positiv, wenn
 * das Blatt geschlossen in Richtung wachsender u liegt. Das Blatt steht offen
 * quer zur Wand (`swing` gibt die Seite), der Bogen führt von der offenen in
 * die geschlossene Lage — so herum, wie die Tür tatsächlich schwenkt.
 */
function doorLeaf(
  hingeU: number,
  reach: number,
  swing: number,
  p: (u: number, s: number) => Vec2,
): SymbolPart[] {
  const hinge = p(hingeU, 0);
  const width = Math.abs(reach);
  const open = p(hingeU, swing * width);
  const closed = p(hingeU + reach, 0);

  const startAngle = Math.atan2(open.y - hinge.y, open.x - hinge.x);
  const endAngle = Math.atan2(closed.y - hinge.y, closed.x - hinge.x);
  // Der Viertelkreis läuft immer über den kürzeren Weg: 90° sind es genau,
  // weil offene und geschlossene Lage senkrecht aufeinander stehen.
  let delta = endAngle - startAngle;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;

  return [
    { kind: 'line', a: hinge, b: open, weight: 'stark', role: 'blatt' },
    {
      kind: 'arc',
      center: hinge,
      radius: width,
      startAngle,
      endAngle,
      ccw: delta > 0,
      weight: 'fein',
      role: 'bogen',
      faint: true,
    },
  ];
}

/**
 * Die Beschriftung einer Öffnung nach Bauzeichnungsgebrauch.
 *
 * Oben Rohbaubreite/Rohbauhöhe, darunter beim Fenster die Brüstungshöhe. Die
 * Höhe fehlt in keinem Bauantrag und in keiner Ausschreibung — und sie fehlte
 * bis 1.7.0 auf jedem Ausdruck dieses Programms.
 */
export function openingLabel(op: Opening): { main: string; sub?: string } {
  const main = `${meterText(op.width)}/${meterText(op.height)}`;
  if (op.kind === 'window' && op.sillHeight > 0.001) {
    return { main, sub: `B ${meterText(op.sillHeight)}` };
  }
  return { main };
}

/** Meterzahl deutsch: Komma, mindestens zwei Nachkommastellen, keine Nullen. */
export function meterText(value: number): string {
  const drei = value.toFixed(3);
  const text = drei.endsWith('0') ? drei.slice(0, -1) : drei;
  return text.replace('.', ',');
}
