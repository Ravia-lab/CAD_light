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

export const UEBERSICHT_MASSE: UebersichtMasse = { grid: 26, size: 30 };

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
    const seite = masse.size * 0.95;
    const oben = masse.size * 1.75;
    const unten = masse.size * 1.5;
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
    const verlauf = leitungsverlauf(a, b, l, masse);
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
    drawSymbol(ctx, b.kind, x, y, masse.size, {
      color: farben.strich,
      background: farben.papier,
      label: b.anzahl && b.anzahl > 1 ? `${b.anzahl} × ${b.label}` : b.label,
      spec: b.spec ?? null,
      lineWidth: 1.5,
    });
  }
}
