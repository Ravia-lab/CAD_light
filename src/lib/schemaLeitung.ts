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

  /*
   * **Keine Leitung läuft quer durch ihr eigenes Gerät.**
   *
   * Die Regel „wer seitlich austritt, läuft erst waagerecht" allein reichte
   * nicht. Der Trinkwasserspeicher gibt seinen Heizungsrücklauf nach **links**
   * ab, der Sammelpunkt liegt aber genau **über** ihm: Das waagerechte
   * Zwischenstück lief vom Stutzen wieder nach rechts, bog auf Höhe der
   * Behältermitte ab und stieg senkrecht durch den Behälter nach oben. Weil
   * die Symbole freistellen, blieb davon genau ein Stummel links unten
   * stehen — „unten ist wieder ein Stück Rohr zu erkennen, das gehört da
   * nicht hin".
   *
   * Zurücklaufen ist dabei **nicht** das Problem: Im Rücklaufband fließt es
   * von rechts nach links, der Ausgang eines Ventils liegt trotzdem rechts,
   * und die Leitung deckt ihren eigenen Stummel dabei zu. Sichtbar falsch
   * wird es erst, wenn ein Schenkel **quer** durch die Fläche eines der
   * beiden Symbole läuft. Genau das wird hier vermieden.
   */
  const kasten = (e: LeitungsEnde, halbe: number) => ({
    x0: e.x * masse.grid - halbe,
    x1: e.x * masse.grid + halbe,
    y0: e.y * masse.grid - halbe,
    y1: e.y * masse.grid + halbe,
  });
  /**
   * Schneidet die achsparallele Strecke die Fläche dieses Symbols **quer**?
   *
   * „Quer" ist die ganze Frage. Ein Absperrventil im Rücklaufband wird von
   * seiner eigenen Leitung durchquert — waagerecht, auf der Höhe seiner
   * beiden Stutzen. Das ist keine Verletzung, sondern die Darstellung einer
   * Armatur in der Leitung. `achse` ist deshalb die Linie, auf der die
   * Stutzen dieses Endes liegen; was darauf läuft, zählt nicht mit.
   */
  const stichtDurch = (
    v: Vec2,
    w: Vec2,
    k: { x0: number; x1: number; y0: number; y1: number },
    achse: { waagerecht: boolean; lage: number },
  ): boolean => {
    if (achse.waagerecht ? v.y === w.y && v.y === achse.lage : v.x === w.x && v.x === achse.lage) return false;
    return (
      Math.min(v.x, w.x) < k.x1 &&
      Math.max(v.x, w.x) > k.x0 &&
      Math.min(v.y, w.y) < k.y1 &&
      Math.max(v.y, w.y) > k.y0
    );
  };
  // 0,45 statt 0,5: Die Stutzen liegen auf dem Rand, und ein Schenkel, der
  // den Rand entlangläuft, ist kein Durchstich.
  const seitlich = (seite: string) => seite === 'left' || seite === 'right';
  const enden = [
    { k: kasten(a, (a.groesse ?? masse.size) * 0.45), achse: { waagerecht: seitlich(p.port.side), lage: seitlich(p.port.side) ? aus.y : aus.x } },
    { k: kasten(b, (b.groesse ?? masse.size) * 0.45), achse: { waagerecht: seitlich(q.port.side), lage: seitlich(q.port.side) ? ein.y : ein.x } },
  ];
  /** Wie viele Schenkel dieser Reihenfolge stechen quer durch ein Symbol? */
  const durchstiche = (waagerecht: boolean): number => {
    const e: Vec2 = waagerecht ? { x: ein.x, y: aus.y } : { x: aus.x, y: ein.y };
    return (
      (enden.some((n) => stichtDurch(aus, e, n.k, n.achse)) ? 1 : 0) +
      (enden.some((n) => stichtDurch(e, ein, n.k, n.achse)) ? 1 : 0)
    );
  };
  const nachAlterRegel = p.port.side === 'left' || p.port.side === 'right';
  const waagerechtZuerst =
    durchstiche(nachAlterRegel) <= durchstiche(!nachAlterRegel) ? nachAlterRegel : !nachAlterRegel;
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
