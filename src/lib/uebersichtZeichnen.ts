/**
 * Das Übersichtsschema zeichnen.
 * ---------------------------------------------------------------------------
 * Die Formensprache ist dieselbe wie im vollständigen Bild — es sind dieselben
 * Symbole aus `schematicSymbols.ts` und dieselbe Leitungsführung aus
 * `schemaLeitung.ts`. Zwei Dinge kommen hinzu, und beide stammen aus den
 * geprüften Herstellerschemata:
 *
 *  · **Der gestrichelte Rahmen um eine Baugruppe.** Bosch zeichnet die
 *    Solarstation als Kästchen, Wolf die Hydraulikstation mit ihrem Namen im
 *    Rahmen. Was ab Werk in einem Gehäuse sitzt, wird nicht zerlegt.
 *  · **Der Hinweissatz unter dem Bild.** Er gehört zum Bild und nicht zur
 *    Oberfläche: Wer die Übersicht druckt oder weitergibt, muss ihn
 *    mitbekommen.
 *
 * Gezeichnet wird auf einen Zeichenkontext, den der Aufrufer stellt — damit
 * dieselbe Routine den Bildschirm, den Druck und eine Bilddatei füllt.
 */

import { PIPE_SERVICE_COLORS } from '../types/bim';
import type { SchematicKind } from '../types/bim';
import type { Uebersichtsschema, UebersichtBauteil } from './schemaUebersicht';
import { drawSymbol } from './schematicSymbols';
import { leitungsverlauf } from './schemaLeitung';

export interface UebersichtMasse {
  /** Rasterweite [px]. */
  grid: number;
  /** Symbolgröße [px]. */
  size: number;
}

export interface UebersichtFarben {
  /** Papier — auch die Freistellfläche unter Kreissymbolen. */
  papier: string;
  /** Strichfarbe der Symbole. */
  strich: string;
  /** Rahmen und Name einer Baugruppe. */
  rahmen: string;
}

/**
 * Rasterweite und Grundgröße.
 *
 * Entscheidend ist ihr **Verhältnis**, nicht der absolute Wert: Die Ansicht
 * passt das Bild ohnehin in die Fläche ein. Größere Symbole bei gleichem
 * Raster heißt, dass die Geräte den Platz zwischen den Spalten füllen — und
 * genau so sieht ein Schema aus, in dem man die Geräte zuerst sieht. Bei
 * `size` deutlich kleiner als `grid` entsteht dagegen eine Reihe kleiner
 * Zeichen mit viel Luft dazwischen, und das Bild wirkt leer.
 */
export const UEBERSICHT_MASSE: UebersichtMasse = { grid: 30, size: 30 };

/**
 * Wie groß ein Bauteil gezeichnet wird — als Vielfaches der Grundgröße.
 * ---------------------------------------------------------------------------
 * **Der Anlass.** „Eine Wärmepumpe ist nicht so groß wie ein Dreiwegeventil."
 * Im ersten Wurf waren alle Symbole gleich groß, und damit sah das Bild aus
 * wie eine Reihe gleichwertiger Kästchen. Ein Schema wird aber nicht Symbol
 * für Symbol gelesen, sondern zuerst im Überblick: Das Auge sucht die
 * **Geräte**, und die sollen sich vom Zubehör abheben.
 *
 * So machen es die veröffentlichten Schemata auch: Erzeuger und Speicher sind
 * die großen Körper, die Armaturen sitzen als kleine Zeichen in der Leitung.
 *
 * Die Staffelung in drei Stufen:
 *
 *  · **Geräte und Speicher** — was man liefern lässt und was Platz braucht.
 *  · **Übergabe und Baugruppen** — Heizkörper, Fläche, Verteiler, Station.
 *  · **In der Leitung** — Pumpen, Ventile, Sicherheitsarmaturen.
 *
 * Wer hier fehlt, wird in der Grundgröße gezeichnet.
 */
const GROESSE: Partial<Record<SchematicKind, number>> = {
  // Geräte und Speicher
  'heatpump-outdoor': 1.7,
  'heatpump-indoor': 1.7,
  boiler: 1.6,
  // Stehende Gefäße: Ein 300-Liter-Speicher ist das größte Teil im
  // Technikraum und soll im Bild auch so aussehen.
  buffer: 1.8,
  cylinder: 1.8,
  separator: 1.5,
  solar: 1.5,
  // Übergabe und Baugruppen
  'hydraulic-station': 1.35,
  freshwater: 1.35,
  radiator: 1.4,
  'floor-loop': 1.4,
  manifold: 1.2,
  'electric-heater': 1.05,
  // In der Leitung
  pump: 0.8,
  'circulation-pump': 0.8,
  'valve-3way': 0.8,
  'valve-diverter': 0.8,
  'mixing-valve-dhw': 0.8,
  'safety-valve': 0.85,
  'expansion-vessel': 0.95,
};

/** Die Größe eines Symbols in Bildschirmpunkten. */
export function symbolgroesse(kind: SchematicKind, masse: UebersichtMasse = UEBERSICHT_MASSE): number {
  return masse.size * (GROESSE[kind] ?? 1);
}

/**
 * Das Bild zeichnen. Der Aufrufer hat vorher verschoben und skaliert.
 *
 * Reihenfolge: erst die Rahmen (sie liegen hinter allem), dann die Leitungen,
 * dann die Symbole. Die Symbole zuletzt, weil sie freistellen — eine
 * durchlaufende Leitung soll nicht durch ein Manometer hindurchscheinen.
 */
export function zeichneUebersicht(
  ctx: CanvasRenderingContext2D,
  u: Uebersichtsschema,
  farben: UebersichtFarben,
  masse: UebersichtMasse = UEBERSICHT_MASSE,
): void {
  const nach = new Map(u.bauteile.map((b) => [b.id, b]));
  /*
   * Welche Stutzen tragen im **Übersichtsbild** eine Leitung?
   *
   * Das ist nicht dieselbe Menge wie im vollständigen Schema: Die Übersicht
   * lässt die Trinkwasserseite und die Armaturen weg. Ein Symbol, das
   * trotzdem alle seine Stutzen zeichnet, setzt dort ein Stück Rohr ins
   * Nichts — unter dem Trinkwasserspeicher war genau das zu sehen.
   */
  const belegteStutzen = new Map<string, string[]>();
  for (const l of u.leitungen) {
    for (const [id, port] of [[l.from, l.fromPort], [l.to, l.toPort]] as const) {
      if (!port) continue;
      const liste = belegteStutzen.get(id);
      if (liste) liste.push(port);
      else belegteStutzen.set(id, [port]);
    }
  }

  // --- Baugruppenrahmen ---------------------------------------------------
  for (const g of u.gruppen) {
    const teile = g.bauteile.map((id) => nach.get(id)).filter(Boolean) as UebersichtBauteil[];
    if (teile.length < 2) continue;
    const xs = teile.map((t) => t.x * masse.grid);
    const ys = teile.map((t) => t.y * masse.grid);
    /*
     * Der Rahmen muss die **Beschriftung** einschließen, nicht nur das
     * Symbol: `drawSymbol` setzt den Namen über und die Kennzahl unter das
     * Zeichen. Mit gleichem Abstand auf allen Seiten schnitt die obere
     * Rahmenkante genau durch das Wort „Sicherheitsventil".
     */
    const groesste = Math.max(...teile.map((t) => symbolgroesse(t.kind, masse)));
    const seite = groesste * 1.05;
    const oben = groesste * 1.9;
    const unten = groesste * 1.6;
    const x = Math.min(...xs) - seite;
    const y = Math.min(...ys) - oben;
    const w = Math.max(...xs) + seite - x;
    const h = Math.max(...ys) + unten - y;

    ctx.save();
    ctx.strokeStyle = farben.rahmen;
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    // Der Name sitzt auf der oberen Rahmenkante und wird freigestellt —
    // sonst läuft der Strich durch die Schrift.
    const breite = ctx.measureText(g.name).width;
    ctx.fillStyle = farben.papier;
    ctx.fillRect(x + 6, y - 7, breite + 6, 11);
    ctx.fillStyle = farben.rahmen;
    ctx.fillText(g.name, x + 9, y + 2);
    ctx.restore();
  }

  // --- Leitungen ----------------------------------------------------------
  for (const l of u.leitungen) {
    const a = nach.get(l.from);
    const b = nach.get(l.to);
    if (!a || !b) continue;
    const verlauf = leitungsverlauf(
      { ...a, groesse: a.kind === 'node' ? masse.size : symbolgroesse(a.kind, masse) },
      { ...b, groesse: b.kind === 'node' ? masse.size : symbolgroesse(b.kind, masse) },
      l,
      masse,
    );
    if (!verlauf) continue;

    ctx.save();
    ctx.strokeStyle = PIPE_SERVICE_COLORS[l.service];
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    /*
     * Trinkwasser wird **gestrichelt** gezeichnet.
     *
     * Die Systemtrennung ist die eine Aussage dieses Bildes, die man nicht
     * übersehen darf, und Farbe allein trägt sie nicht: Auf einem
     * Schwarzweißdruck und für jeden zehnten Mann mit Rotsehschwäche sind
     * rote und blaue Leitungen dasselbe Grau. Eine Strichart bleibt.
     */
    if (l.service === 'hot-water' || l.service === 'cold-water' || l.service === 'circulation') {
      ctx.setLineDash([7, 4]);
    }
    ctx.beginPath();
    verlauf.punkte.forEach((pt, i) => (i === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y)));
    ctx.stroke();
    ctx.setLineDash([]);

    // Fließrichtung — ohne sie ist ein Vorlauf von einem Rücklauf nur an der
    // Farbe zu unterscheiden.
    const { at, winkel } = verlauf.pfeil;
    ctx.translate(at.x, at.y);
    ctx.rotate(winkel);
    ctx.fillStyle = PIPE_SERVICE_COLORS[l.service];
    ctx.beginPath();
    ctx.moveTo(6, 0);
    ctx.lineTo(-4, 4);
    ctx.lineTo(-4, -4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // --- Symbole ------------------------------------------------------------
  for (const b of u.bauteile) {
    const x = b.x * masse.grid;
    const y = b.y * masse.grid;
    if (b.kind === 'node') {
      // Ein Knotenpunkt ist ein Punkt. Trägt er einen Namen — „Zapfstellen" —,
      // steht der daneben; ein Symbol bekommt er nicht.
      ctx.save();
      ctx.fillStyle = farben.strich;
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
      if (b.label) {
        ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(b.label, x + 8, y);
      }
      ctx.restore();
      continue;
    }
    drawSymbol(ctx, b.kind, x, y, symbolgroesse(b.kind, masse), {
      angeschlossen: belegteStutzen.get(b.id),
      color: farben.strich,
      background: farben.papier,
      label: b.anzahl && b.anzahl > 1 ? `${b.anzahl} × ${b.label}` : b.label,
      spec: b.spec ?? null,
      lineWidth: 1.5,
    });
  }
}
