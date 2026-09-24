/**
 * Wo eine Leitung im Schema langläuft — die Geometrie, nicht die Farbe.
 * ---------------------------------------------------------------------------
 * **Warum das ein eigenes Modul ist.** Die rechtwinklige Führung einer
 * Schemaleitung stand bis 1.49.0 in der Zeichenroutine der Bildschirmansicht.
 * Mit dem Übersichtsschema gibt es eine zweite Stelle, die dieselben Leitungen
 * zeichnet — und zwei Wege, dieselbe Ecke zu berechnen, laufen früher oder
 * später auseinander. Dann liegt in der Übersicht ein Knick, den die
 * Ausführung nicht hat, und niemand weiß, welches Bild recht hat.
 *
 * **Die Führung.** Senkrecht aus dem Stutzen heraus, dann das Zwischenstück,
 * dann senkrecht in den Zielstutzen hinein. Ob das Zwischenstück zuerst
 * waagerecht oder zuerst senkrecht läuft, entscheidet die **Seite des
 * Ausgangsstutzens**: Wer seitlich austritt, läuft erst waagerecht. Diagonalen
 * gibt es nicht — ein Fließbild liest man an den Ecken.
 *
 * Reine Geometrie: kein Zeichenkontext, keine Farbe, keine Oberfläche.
 */

import type { SchematicKind, Vec2 } from '../types/bim';
import { pickPortPair, symbolPortPoints } from './schematicSymbols';

/** Das Nötigste über ein Bauteil, um seine Stutzen zu finden. */
export interface LeitungsEnde {
  kind: SchematicKind;
  /** Rasterplatz, nicht Bildschirmpunkt. */
  x: number;
  y: number;
  /**
   * Symbolgröße dieses Bauteils [px], falls sie von der allgemeinen abweicht.
   *
   * Im Übersichtsschema sind die Symbole **verschieden groß**: Eine
   * Wärmepumpe ist kein Dreiwegeventil. Die Stutzen liegen am Rand des
   * Symbols, also verschiebt jede abweichende Größe auch sie — ohne diese
   * Angabe endete die Leitung mitten im großen Symbol oder in der Luft neben
   * dem kleinen.
   */
  groesse?: number;
}

export interface Leitungsverlauf {
  /** Der Streckenzug von Stutzen zu Stutzen, mit allen Ecken. */
  punkte: Vec2[];
  /** Wo die Fließrichtung markiert wird, und in welchem Winkel [rad]. */
  pfeil: { at: Vec2; winkel: number };
  /** Läuft das Zwischenstück zuerst waagerecht? */
  waagerechtZuerst: boolean;
  /** Anfang und Ende des Zwischenstücks — daran hängt die Beschriftung. */
  zwischenstueck: { von: Vec2; bis: Vec2 };
}

/**
 * Wie weit die Leitung gerade aus dem Stutzen herausläuft, bevor sie
 * abknickt [Bildschirmpunkte].
 *
 * Ohne diesen Vorlauf klebt die Ecke am Symbol, und bei zwei Leitungen an
 * benachbarten Stutzen ist nicht mehr zu sehen, welche wohin geht.
 */
export const LEITUNG_VORLAUF = 12;

/** Den Punkt um `d` in Richtung der Stutzenseite verschieben. */
function versetze(p: { x: number; y: number; port: { side: string } }, d: number): Vec2 {
  switch (p.port.side) {
    case 'left':
      return { x: p.x - d, y: p.y };
    case 'right':
      return { x: p.x + d, y: p.y };
    case 'top':
      return { x: p.x, y: p.y - d };
    default:
      return { x: p.x, y: p.y + d };
  }
}

/**
 * Den Verlauf einer Leitung zwischen zwei Bauteilen berechnen.
 *
 * `grid` ist die Rasterweite und `size` die Symbolgröße in Bildschirmpunkten;
 * beide bestimmen, wo die Stutzen liegen. Gibt es an einem der beiden
 * Bauteile keinen Stutzen, gibt es auch keinen Verlauf — dann `undefined`,
 * und der Aufrufer zeichnet nichts. Eine Leitung ins Leere zu zeichnen wäre
 * schlimmer als keine.
 */
export function leitungsverlauf(
  a: LeitungsEnde,
  b: LeitungsEnde,
  benannt: { fromPort?: string; toPort?: string },
  masse: { grid: number; size: number; vorlauf?: number },
): Leitungsverlauf | undefined {
  const von = symbolPortPoints(a.kind, a.x * masse.grid, a.y * masse.grid, a.groesse ?? masse.size);
  const nach = symbolPortPoints(b.kind, b.x * masse.grid, b.y * masse.grid, b.groesse ?? masse.size);
  const paar = pickPortPair(von, nach, benannt);
  if (!paar) return undefined;

  const d = masse.vorlauf ?? LEITUNG_VORLAUF;
  const p = paar.p;
  const q = paar.q;
  const aus = versetze(p, d);
  const ein = versetze(q, d);

  const waagerechtZuerst = p.port.side === 'left' || p.port.side === 'right';
  const ecke: Vec2 = waagerechtZuerst ? { x: ein.x, y: aus.y } : { x: aus.x, y: ein.y };

  const mitte: Vec2 = waagerechtZuerst
    ? { x: (aus.x + ein.x) / 2, y: aus.y }
    : { x: aus.x, y: (aus.y + ein.y) / 2 };
  const winkel = waagerechtZuerst
    ? ein.x >= aus.x
      ? 0
      : Math.PI
    : ein.y >= aus.y
      ? Math.PI / 2
      : -Math.PI / 2;

  return {
    punkte: [{ x: p.x, y: p.y }, aus, ecke, ein, { x: q.x, y: q.y }],
    pfeil: { at: mitte, winkel },
    waagerechtZuerst,
    zwischenstueck: { von: aus, bis: ein },
  };
}
