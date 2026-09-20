/**
 * Maßstäblicher Planausdruck.
 * ---------------------------------------------------------------------------
 * Erzeugt aus dem Modell ein SVG in **Millimetern** und öffnet es in einem
 * Druckfenster. Weil das SVG echte mm-Maße trägt und `@page` das Blattformat
 * setzt, ist der Ausdruck tatsächlich maßstäblich: 1 m Wand wird bei 1:50 zu
 * exakt 20 mm auf dem Papier — nachmessbar mit dem Maßstab.
 *
 * Bewusst ohne PDF-Bibliothek: der Umweg über den Druckdialog des Browsers
 * liefert Vektor-PDF in Originalqualität, kostet keine 300 kB Abhängigkeit und
 * erlaubt dem Nutzer, Blattformat und Ausrichtung im Dialog zu korrigieren.
 */

import type { Annotation, BimDocument, Opening, Room, SolidElement, Vec2 } from '../types/bim';
import {
  DURCHBRUCH_LABELS,
  PIPE_SERVICE_COLORS,
  PIPE_SERVICE_LABELS,
  SOLID_LABELS,
} from '../types/bim';
import { annotationText, dimensionLine, planbeschriftungsText } from './annotationSymbols';
import type { WallGeometry } from './wallGeometry';
import {
  getWallGeometry,
  indexOpeningsByWall,
  indexWallsByNode,
  openingSpan,
  openingsOf,
  planWallPieces,
  wallLocalToWorld,
} from './wallGeometry';
import type { SymbolPart } from './openingSymbols';
import { openingLabel, openingSymbol } from './openingSymbols';
import { kompassRose } from './kompass';
import { solidFootprint, solidsOnLevel, stairLayout, verticalCorners } from './verticalSymbols';
import {
  durchbruchBeschriftung,
  durchbruchMitte,
  durchbruchUmriss,
  durchbruecheAufGeschoss,
} from './durchbruchSymbols';
import { accessorySymbol, type AccessoryPart } from './pipeAccessorySymbols';
import { buildRoofFrame, dormerSide, ridgeLine, roofContourLines, roofOpeningCorners } from './roofGeometry';
import { gebaeudeUmriss } from './roomDetection';
import { pointInPolygon, polygonArea } from './geometry';
import { druckeDokument } from './druckFenster';
import { drawableScaleBar } from './planScaleBar';
import { findeBeschriftungslage, type Rechteck } from './beschriftungsLage';
import { rohrbezeichnung, rohrbezeichnungLang } from './rohrbezeichnung';
import { EBENE_DURCHBRUECHE, ebeneFuerMedium, ebeneFuerObjekt } from './ebenen';

/** Schriftgröße der Rohrbeschriftung auf dem Blatt [mm]. */
const SCHRIFT = 1.6;

/** Schriftgrößen des Raumstempels [mm] — Name über Fläche. */
const STEMPEL = { name: 2.6, flaeche: 2.2 } as const;

/**
 * Mittlere Zeichenbreite als Vielfaches der Schriftgröße.
 *
 * Im SVG lässt sich kein Text ausmessen — es gibt keinen Zeichenkontext, der
 * Antwort gäbe. 0,56 ist der Wert, mit dem dieses Modul schon die
 * Öffnungsmaße auf Platz prüft; er gilt hier weiter, damit nicht zwei
 * Schätzungen desselben Maßes nebeneinanderstehen.
 */
const ZEICHENBREITE = 0.56;

/** Ein gesetzter Raumstempel samt der Fläche, die er auf dem Blatt belegt. */
interface Raumstempel {
  x: number;
  y: number;
  name: string;
  flaeche: string;
  kasten: Rechteck;
}

/**
 * Die Raumstempel eines Blattes — Lage, Text und belegte Fläche.
 *
 * Getrennt vom Zeichnen, weil die Rohrbeschriftung die Kästen kennen muss,
 * bevor der Stempel gezeichnet wird. Der Kasten umschließt beide Zeilen: die
 * Oberkante liegt eine Namenshöhe über der oberen Grundlinie, die Unterkante
 * eine Unterlänge unter der zweiten.
 */
function raumstempelFelder(
  rooms: Room[],
  solids: { solid: SolidElement }[],
  X: (x: number) => number,
  Y: (y: number) => number,
  /**
   * Nur der Name, ohne Fläche.
   *
   * Auf einem Gewerkeblatt muss der Monteur wissen, in welchem Raum er
   * steht — die Fläche braucht er nicht, und im Bad lägen Raumstempel,
   * Heizkörperbeschriftung und Leitungsmaß sonst auf zwei Quadratzentimetern
   * übereinander. Die Räume ganz wegzulassen wäre die schlechtere Antwort:
   * Ein Plan ohne Raumnamen ist auf der Baustelle nicht zuzuordnen.
   */
  kurz = false,
): Raumstempel[] {
  const out: Raumstempel[] = [];
  for (const room of rooms) {
    if (room.area < 1) continue;
    // Ist der Raum im Wesentlichen Mauerwerk — ein zugestellter Schacht,
    // ein Kaminblock —, trägt das Bauteil seinen Namen und der Raumstempel
    // entfällt. Zwei Beschriftungen in derselben Fläche behaupten zwei
    // Dinge, von denen nur eines stimmt.
    if (massiveShare(room, solids) >= 0.8) continue;
    const x = X(room.centroid.x);
    const y = Y(room.centroid.y);
    const flaeche = kurz ? '' : `${room.area.toFixed(2)} m²`;
    const breite = Math.max(
      room.name.length * STEMPEL.name,
      flaeche.length * STEMPEL.flaeche,
    ) * ZEICHENBREITE;
    out.push({
      x,
      y,
      name: room.name,
      flaeche,
      kasten: {
        x0: x - breite / 2,
        x1: x + breite / 2,
        y0: y - 1 - STEMPEL.name * 0.8,
        y1: kurz ? y + STEMPEL.name * 0.3 : y + 2.4 + STEMPEL.flaeche * 0.25,
      },
    });
  }
  return out;
}

/**
 * Schneidet eine Strecke am Raumpolygon — Dachlinien sollen im Raum enden,
 * nicht über die Fassade hinaus ins Freie laufen.
 */
function clipToPolygon(a: Vec2, b: Vec2, poly: readonly Vec2[]): { a: Vec2; b: Vec2 }[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const ts: number[] = [0, 1];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const ex = q.x - p.x;
    const ey = q.y - p.y;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((p.x - a.x) * ey - (p.y - a.y) * ex) / den;
    const u = ((p.x - a.x) * dy - (p.y - a.y) * dx) / den;
    if (t > 0 && t < 1 && u >= 0 && u <= 1) ts.push(t);
  }
  ts.sort((x, y) => x - y);
  const out: { a: Vec2; b: Vec2 }[] = [];
  for (let i = 0; i < ts.length - 1; i++) {
    const t0 = ts[i];
    const t1 = ts[i + 1];
    if (t1 - t0 < 1e-6) continue;
    const mid = (t0 + t1) / 2;
    if (!pointInPolygon({ x: a.x + dx * mid, y: a.y + dy * mid }, poly)) continue;
    out.push({
      a: { x: a.x + dx * t0, y: a.y + dy * t0 },
      b: { x: a.x + dx * t1, y: a.y + dy * t1 },
    });
  }
  return out;
}

export type PaperFormat = 'A4' | 'A3';
export type PaperOrientation = 'portrait' | 'landscape';

export interface PlanPrintOptions {
  /** Maßstabsnenner: 50 bedeutet 1:50. */
  scale: number;
  format: PaperFormat;
  orientation: PaperOrientation;
  levelId: string;
  showRoomLabels: boolean;
  /** Raumstempel auf den Namen verkürzen — für Gewerkeblätter. */
  raumstempelKurz?: boolean;
  showDimensions: boolean;
  showFixtures: boolean;
  /** Freie Maßketten und Beschriftungen mitdrucken. */
  showAnnotations: boolean;
  /**
   * Handnotizen (Freihandstriche) mitdrucken.
   *
   * Standard ist **aus**, und das mit Absicht: Eine Notiz ist eine
   * Randbemerkung für den, der sie geschrieben hat. Auf einem Plan, der aus
   * dem Haus geht, hat sie nichts zu suchen, solange sie niemand bewusst
   * dazugelegt hat. Anhaken kann man sie immer — versehentlich mitschicken
   * soll man sie nicht.
   */
  showNotizen?: boolean;
  /** Raumweise Innenmaßketten (lichte Weiten) mitdrucken. */
  showInteriorDimensions: boolean;
  /** Symbollegende der verwendeten TGA-Objekte und Leitungen aufs Blatt. */
  showLegend: boolean;
  /**
   * Fenster- und Türmaße an die Öffnungen schreiben (Breite/Höhe, beim
   * Fenster zusätzlich die Brüstungshöhe).
   */
  showOpeningDimensions: boolean;
  title?: string;
}

const PAPER: Record<PaperFormat, { w: number; h: number }> = {
  A4: { w: 210, h: 297 },
  A3: { w: 297, h: 420 },
};

/** Rand des Zeichenfelds [mm]; unten mehr Platz für den Schriftkopf. */
const MARGIN = { top: 12, right: 12, bottom: 34, left: 12 };

export interface PlanFitResult {
  svg: string;
  /** Passt der Plan bei diesem Maßstab aufs Blatt? */
  fits: boolean;
  /** Kleinster Maßstabsnenner, bei dem er passen würde (aufgerundet auf 5). */
  suggestedScale: number;
  sheet: { w: number; h: number };
}

export function buildPlanSvg(doc: BimDocument, options: PlanPrintOptions): PlanFitResult {
  const paper = PAPER[options.format];
  const sheet =
    options.orientation === 'landscape' ? { w: paper.h, h: paper.w } : { w: paper.w, h: paper.h };

  const frame = {
    x: MARGIN.left,
    y: MARGIN.top,
    w: sheet.w - MARGIN.left - MARGIN.right,
    h: sheet.h - MARGIN.top - MARGIN.bottom,
  };

  const walls = Object.values(doc.walls).filter((w) => w.levelId === options.levelId);
  const rooms = Object.values(doc.rooms).filter((r) => r.levelId === options.levelId);
  /*
   * **Der Druck liest die Ebenen.**
   *
   * Bis 1.26.0 kannte `planPrint` `doc.layers` überhaupt nicht: Ein
   * ausgeblendetes Gewerk stand trotzdem auf dem Blatt. Damit war der
   * Planungssatz — Grundriss, Grundriss+Heizung, Grundriss+Sanitär,
   * Grundriss+Lüftung — aus diesem Programm nicht herzustellen; es gab
   * `showFixtures` als *einen* Schalter für alle drei Gewerke.
   *
   * `showFixtures` bleibt daneben stehen und wirkt weiter: Es ist die Frage
   * „Technik überhaupt?", die Ebene die Frage „welche?". Beides zugleich zu
   * einem Schalter zusammenzuziehen hieße, dass ein ausgeblendetes Gewerk
   * beim nächsten Druck stillschweigend wieder auftaucht.
   */
  const gewerkSichtbar = (id: string): boolean => doc.layers?.[id]?.visible !== false;
  const fixtures = Object.values(doc.fixtures)
    .filter((f) => f.levelId === options.levelId)
    .filter((f) => gewerkSichtbar(ebeneFuerObjekt(f)));
  const openingIndex = indexOpeningsByWall(Object.values(doc.openings));

  // --- Ausdehnung des Plans in Metern -------------------------------------
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const wall of walls) {
    const g = getWallGeometry(wall, doc.nodes);
    if (!g) continue;
    for (const p of [g.a, g.b]) {
      const pad = wall.thickness / 2;
      minX = Math.min(minX, p.x - pad);
      minY = Math.min(minY, p.y - pad);
      maxX = Math.max(maxX, p.x + pad);
      maxY = Math.max(maxY, p.y + pad);
    }
  }
  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = 10;
    maxY = 10;
  }
  // Rand für Maßketten. Der Wert muss zu dem passen, was weiter unten
  // tatsächlich gezeichnet wird (Maßlinie 0,35 m vor der Wandkante plus
  // Beschriftung) — sonst meldet der Passt-nicht-Hinweis einen Überstand,
  // den man auf dem Blatt gar nicht sieht.
  const pad = options.showDimensions ? 0.5 : 0.15;
  minX -= pad;
  minY -= pad;
  maxX += pad;
  maxY += pad;

  /** Meter → Millimeter auf dem Blatt. */
  const mm = 1000 / options.scale;
  const planW = (maxX - minX) * mm;
  const planH = (maxY - minY) * mm;
  const fits = planW <= frame.w && planH <= frame.h;

  // Kleinster passender Maßstab, auf 5er-Schritte aufgerundet.
  const needed = Math.max(((maxX - minX) * 1000) / frame.w, ((maxY - minY) * 1000) / frame.h);
  const suggestedScale = Math.ceil(needed / 5) * 5;

  // Zentriert einsetzen; Modell-y zeigt nach oben, SVG-y nach unten.
  const offsetX = frame.x + (frame.w - planW) / 2;
  const offsetY = frame.y + (frame.h - planH) / 2;
  const X = (x: number) => offsetX + (x - minX) * mm;
  const Y = (y: number) => offsetY + (maxY - y) * mm;

  const parts: string[] = [];

  // --- Räume ---------------------------------------------------------------
  for (const room of rooms) {
    if (room.innerPolygon.length < 3) continue;
    const d = room.innerPolygon.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(2)} ${Y(p.y).toFixed(2)}`).join(' ');
    parts.push(`<path d="${d} Z" fill="#F1F5F9" stroke="none"/>`);
  }

  // --- Wände als massive Poché-Flächen -------------------------------------
  // Die Zerlegung kommt aus `planWallPieces` — derselben Funktion, die auch
  // der Editor benutzt. Sie verlängert an jedem Anschlussknoten über die
  // Achse hinaus; ohne das steht auf dem Papier an jeder Ecke eine weiße
  // Kerbe von der halben Wandstärke.
  //
  // Gezeichnet wird in zwei Durchgängen, und das ist kein Schönheitsgrund:
  // jedes Teilstück ist ein eigenes Rechteck, und wo zwei sich überlappen —
  // an jeder Ecke, an jedem T-Stoß — läge die Umrisslinie des einen mitten
  // im anderen. Genau das waren die „komischen Marker" quer durch die Wände.
  // Erst alle Rechtecke mit doppelter Umrisslinie, dann alle noch einmal nur
  // gefüllt: die innen liegenden Linienhälften verschwinden unter der
  // Nachbarfüllung, außen bleibt die halbe Strichstärke stehen. Das ergibt
  // dieselbe Umrisslinie, die eine echte Vereinigung der Flächen hätte —
  // ohne Polygon-Boolesche.
  const byNode = indexWallsByNode(walls);
  const wallShapes: string[] = [];
  for (const wall of walls) {
    const g = getWallGeometry(wall, doc.nodes);
    if (!g) continue;
    for (const piece of planWallPieces(g, openingsOf(openingIndex, wall.id), byNode)) {
      const h = g.halfThickness;
      wallShapes.push(
        [
          wallLocalToWorld(g, piece.uStart, h),
          wallLocalToWorld(g, piece.uEnd, h),
          wallLocalToWorld(g, piece.uEnd, -h),
          wallLocalToWorld(g, piece.uStart, -h),
        ]
          .map((p) => `${X(p.x).toFixed(2)},${Y(p.y).toFixed(2)}`)
          .join(' '),
      );
    }
  }
  for (const pts of wallShapes) {
    parts.push(`<polygon points="${pts}" fill="#334155" stroke="#0F172A" stroke-width="0.36"/>`);
  }
  for (const pts of wallShapes) {
    parts.push(`<polygon points="${pts}" fill="#334155" stroke="none"/>`);
  }

  // Öffnungssymbole — Laibung, Glas, Türblatt und Schwenkbogen. Sie liegen
  // über der Wand: die Laibung ist die Kante, an der die Wand aufhört.
  for (const wall of walls) {
    const g = getWallGeometry(wall, doc.nodes);
    if (!g) continue;
    for (const op of openingsOf(openingIndex, wall.id)) {
      for (const part of openingSymbol(g, op)) parts.push(symbolSvg(part, X, Y, mm));
    }
  }

  // --- Treppen und Schächte -------------------------------------------------
  // Bis 1.7.0 versprach die Legende eine Treppe, die auf dem Blatt gar nicht
  // stand. Eine Treppe im Grundriss ist Umriss, Stufenlinien, Lauflinie und
  // Pfeil zum Austritt — ohne den Pfeil weiß niemand, ob sie hinauf- oder
  // hinabführt.
  for (const v of Object.values(doc.verticals ?? {})) {
    if (v.levelId !== options.levelId) continue;
    const corners = verticalCorners(v);
    const umriss = corners.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(2)} ${Y(p.y).toFixed(2)}`).join(' ');

    if (v.kind === 'shaft') {
      parts.push(
        `<path d="${umriss} Z" fill="url(#schacht)" stroke="#334155" stroke-width="0.2"/>`,
        `<text x="${X(v.position.x).toFixed(2)}" y="${(Y(v.position.y) + 0.7).toFixed(2)}" font-size="2" text-anchor="middle" fill="#334155" stroke="#FFFFFF" stroke-width="0.5" paint-order="stroke">${escapeXml(
          v.name,
        )}</text>`,
      );
      continue;
    }

    parts.push(`<path d="${umriss} Z" fill="#FFFFFF" fill-opacity="0.55" stroke="#334155" stroke-width="0.2"/>`);
    const layout = stairLayout(v);
    if (!layout) continue;

    for (const line of layout.steps) {
      parts.push(
        `<line x1="${X(line.a.x).toFixed(2)}" y1="${Y(line.a.y).toFixed(2)}" x2="${X(line.b.x).toFixed(2)}" y2="${Y(line.b.y).toFixed(2)}" stroke="#475569" stroke-width="0.12"/>`,
      );
    }
    const lauf = layout.run.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(2)} ${Y(p.y).toFixed(2)}`).join(' ');
    parts.push(`<path d="${lauf}" fill="none" stroke="#0F172A" stroke-width="0.2"/>`);

    // Pfeilspitze am Austritt und der Punkt am Antritt.
    const ang = Math.atan2(-layout.tipDir.y, layout.tipDir.x);
    const tx = X(layout.tip.x);
    const ty = Y(layout.tip.y);
    const head = 1.6;
    parts.push(
      `<path d="M${(tx - head * Math.cos(ang - 0.4)).toFixed(2)} ${(ty - head * Math.sin(ang - 0.4)).toFixed(2)} L${tx.toFixed(2)} ${ty.toFixed(2)} L${(tx - head * Math.cos(ang + 0.4)).toFixed(2)} ${(ty - head * Math.sin(ang + 0.4)).toFixed(2)}" fill="none" stroke="#0F172A" stroke-width="0.2"/>`,
      `<circle cx="${X(layout.start.x).toFixed(2)}" cy="${Y(layout.start.y).toFixed(2)}" r="0.4" fill="#0F172A"/>`,
    );
  }

  // --- Durchbrüche ----------------------------------------------------------
  // Auf dem Blatt ist ein Durchbruch ein gekreuztes Feld mit einer Fahne
  // daneben. Die Fahne steht außerhalb, nicht darin: bei 1:100 ist eine
  // Kernbohrung Ø 152 anderthalb Millimeter groß, und in anderthalb Millimeter
  // passt keine Zahl. Wer die Beschriftung ins Loch schriebe, bekäme ein
  // Blatt, das aus der Ferne sauber aussieht und aus der Nähe unlesbar ist.
  //
  // Gezeichnet wird **nach** den Wänden und **vor** den Bauteilen: der
  // Durchbruch sitzt in der Wand, das massive Bauteil steht davor.
  for (const { durchbruch, vonUnten } of durchbruecheAufGeschoss(doc, options.levelId)) {
    const poly = durchbruchUmriss(durchbruch, doc);
    const mitte = durchbruchMitte(durchbruch, doc);
    if (poly.length < 3 || !mitte) continue;
    const d = poly.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(2)} ${Y(p.y).toFixed(2)}`).join(' ');
    const stift = vonUnten ? 0.18 : 0.3;
    parts.push(
      `<path d="${d} Z" fill="#FFFFFF" stroke="#0F172A" stroke-width="${stift}"${vonUnten ? ' stroke-dasharray="1 0.7"' : ''}/>`,
    );
    // Das Kreuz im Feld — die Aussage „hier ist nichts". Ohne es liest jeder
    // Prüfer das Rechteck in der Wand als Vormauerung.
    const xs = poly.map((p) => X(p.x));
    const ys = poly.map((p) => Y(p.y));
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    const y0 = Math.min(...ys);
    const y1 = Math.max(...ys);
    parts.push(
      `<path d="M${x0.toFixed(2)} ${y0.toFixed(2)}L${x1.toFixed(2)} ${y1.toFixed(2)}M${x1.toFixed(2)} ${y0.toFixed(2)}L${x0.toFixed(2)} ${y1.toFixed(2)}" stroke="#0F172A" stroke-width="0.2" fill="none"/>`,
    );
    if (vonUnten) continue;
    const fx = X(mitte.x);
    const fy = Y(mitte.y);
    const ty = y0 - 2.4;
    parts.push(
      `<path d="M${fx.toFixed(2)} ${fy.toFixed(2)}L${fx.toFixed(2)} ${(ty + 0.8).toFixed(2)}" stroke="#0F172A" stroke-width="0.18" fill="none"/>`,
      `<text x="${fx.toFixed(2)}" y="${ty.toFixed(2)}" font-size="2" text-anchor="middle" fill="#0F172A" stroke="#FFFFFF" stroke-width="0.5" paint-order="stroke">${escapeXml(
        durchbruchBeschriftung(durchbruch),
      )}</text>`,
    );
  }

  // --- Massive Bauteile -----------------------------------------------------
  // Kamin, Pfeiler, Wandversatz. Auf dem Blatt sind sie Mauerwerk: dichte
  // 45°-Schraffur und eine kräftigere Umrisslinie als jedes andere Symbol.
  // Ein Schornstein, der nur durch dieses Geschoss läuft, wird schwächer
  // gezeichnet — er gehört nicht hierher, steht aber im Weg.
  const solids = solidsOnLevel(doc, options.levelId);
  for (const { solid, passing } of solids) {
    const poly = solidFootprint(solid);
    if (poly.length < 3) continue;
    const d = poly.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(2)} ${Y(p.y).toFixed(2)}`).join(' ');
    parts.push(
      `<path d="${d} Z" fill="url(#massiv)" fill-opacity="${passing ? 0.45 : 1}" stroke="#0F172A" stroke-width="${passing ? 0.2 : 0.35}"${passing ? ' stroke-dasharray="1.2 0.8"' : ''}/>`,
    );

    // Beschriftung nur, wenn sie im Bauteil Platz hat — ein Kamin von 40 cm
    // ist bei 1:100 vier Millimeter breit und trägt keine Schrift.
    let cx = 0;
    let cy = 0;
    let minPx = Infinity;
    let maxPx = -Infinity;
    let minPy = Infinity;
    let maxPy = -Infinity;
    for (const p of poly) {
      cx += p.x;
      cy += p.y;
      minPx = Math.min(minPx, p.x);
      maxPx = Math.max(maxPx, p.x);
      minPy = Math.min(minPy, p.y);
      maxPy = Math.max(maxPy, p.y);
    }
    cx /= poly.length;
    cy /= poly.length;
    if ((maxPx - minPx) * mm >= 16 && (maxPy - minPy) * mm >= 6) {
      parts.push(
        // Weißer Rand hinter der Schrift: auf der Schraffur wäre sie sonst
        // schlechter zu lesen als daneben.
        `<text x="${X(cx).toFixed(2)}" y="${(Y(cy) + 0.7).toFixed(2)}" font-size="2.1" font-weight="600" text-anchor="middle" fill="#0F172A" stroke="#FFFFFF" stroke-width="0.55" paint-order="stroke">${escapeXml(
          solid.name || SOLID_LABELS[solid.kind],
        )}</text>`,
      );
    }
  }

  // --- Außenmaßkette --------------------------------------------------------
  // Bemaßt werden die Außenwände, und zwar *außerhalb* des Gebäudes. Eine
  // Maßlinie, die im Raum liegt, überdeckt Raumstempel und Symbole und ist
  // beim Bauen nicht ablesbar. Die Seite ergibt sich aus der Lage zur
  // Gebäudemitte — das ist unabhängig davon, wie herum eine Wand gezeichnet
  // wurde.
  if (options.showDimensions) {
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    for (const wall of walls) {
      if (wall.type !== 'exterior') continue;
      const g = getWallGeometry(wall, doc.nodes);
      if (!g || g.length * mm < 12) continue;

      const mid = { x: (g.a.x + g.b.x) / 2, y: (g.a.y + g.b.y) / 2 };
      const away = (mid.x - cx) * g.normal.x + (mid.y - cy) * g.normal.y;
      const sign = away >= 0 ? 1 : -1;
      const off = (g.halfThickness + 0.28) * mm * sign;

      const nx = g.normal.x;
      const ny = g.normal.y;
      const x1 = X(g.a.x) + nx * off;
      const y1 = Y(g.a.y) - ny * off;
      const x2 = X(g.b.x) + nx * off;
      const y2 = Y(g.b.y) - ny * off;

      let angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
      if (angle > 90 || angle < -90) angle += 180;
      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;

      // Maßlinie mit Begrenzungsschrägen — die klassische 45°-Fahne.
      const tx = ((x2 - x1) / Math.hypot(x2 - x1, y2 - y1)) * 0.8;
      const ty = ((y2 - y1) / Math.hypot(x2 - x1, y2 - y1)) * 0.8;
      parts.push(
        `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="#334155" stroke-width="0.15"/>`,
        `<line x1="${(x1 - tx + ty).toFixed(2)}" y1="${(y1 - ty - tx).toFixed(2)}" x2="${(x1 + tx - ty).toFixed(2)}" y2="${(y1 + ty + tx).toFixed(2)}" stroke="#334155" stroke-width="0.15"/>`,
        `<line x1="${(x2 - tx + ty).toFixed(2)}" y1="${(y2 - ty - tx).toFixed(2)}" x2="${(x2 + tx - ty).toFixed(2)}" y2="${(y2 + ty + tx).toFixed(2)}" stroke="#334155" stroke-width="0.15"/>`,
        // Maßzahl über der Linie, immer von links lesbar.
        `<text x="${mx.toFixed(2)}" y="${(my - 0.8).toFixed(2)}" transform="rotate(${angle.toFixed(1)} ${mx.toFixed(2)} ${my.toFixed(2)})" font-size="2.1" text-anchor="middle" fill="#1E293B">${g.length.toFixed(2)}</text>`,
      );
    }
  }

  // --- Dachlinien -----------------------------------------------------------
  // First und die Höhenlinien nach WoFlV. Auf dem Papier sind sie das, was
  // ein Dachgeschoss überhaupt erst lesbar macht.
  const roofOutline: Vec2[] = [];
  for (const wall of walls) {
    const g = getWallGeometry(wall, doc.nodes);
    if (!g) continue;
    roofOutline.push(g.a, g.b);
  }
  const levelRoofOpenings = Object.values(doc.roofOpenings ?? {}).filter(
    (o) => o.levelId === options.levelId,
  );
  const dach = doc.levels[options.levelId]?.roof;
  // Der geordnete Umriss wird nur geholt, wenn wirklich ein geneigtes Dach
  // darüberliegt: er kostet einen eigenen Graphaufbau, und der Regelfall
  // ohne Dach soll den Ausdruck nicht bezahlen.
  const roofFrame = buildRoofFrame(
    dach,
    roofOutline,
    levelRoofOpenings,
    dach && dach.kind !== 'flat' ? gebaeudeUmriss(walls, doc.nodes) : [],
  );
  if (roofFrame) {
    const drawRoofLine = (
      line: { a: Vec2; b: Vec2 },
      dash: string,
      width: number,
      label: string,
    ) => {
      for (const room of rooms) {
        if (room.innerPolygon.length < 3) continue;
        for (const seg of clipToPolygon(line.a, line.b, room.innerPolygon)) {
          const len = Math.hypot(seg.b.x - seg.a.x, seg.b.y - seg.a.y) * mm;
          if (len < 6) continue;
          parts.push(
            `<line x1="${X(seg.a.x).toFixed(2)}" y1="${Y(seg.a.y).toFixed(2)}" x2="${X(seg.b.x).toFixed(2)}" y2="${Y(seg.b.y).toFixed(2)}" stroke="#475569" stroke-width="${width}" stroke-dasharray="${dash}"/>`,
          );
          if (len > 28) {
            const mx = X((seg.a.x + seg.b.x) / 2);
            const my = Y((seg.a.y + seg.b.y) / 2);
            let angle = (Math.atan2(Y(seg.b.y) - Y(seg.a.y), X(seg.b.x) - X(seg.a.x)) * 180) / Math.PI;
            if (angle > 90 || angle < -90) angle += 180;
            parts.push(
              `<text x="${mx.toFixed(2)}" y="${(my - 0.7).toFixed(2)}" transform="rotate(${angle.toFixed(1)} ${mx.toFixed(2)} ${my.toFixed(2)})" font-size="1.8" text-anchor="middle" fill="#475569">${label}</text>`,
            );
          }
        }
      }
    };

    for (const line of roofContourLines(roofFrame, 1)) drawRoofLine(line, '1.2 1.2', 0.12, '1,00 m');
    for (const line of roofContourLines(roofFrame, 2)) drawRoofLine(line, '1.2 1.2', 0.12, '2,00 m');
    drawRoofLine(ridgeLine(roofFrame), '3 1 0.6 1', 0.18, `First ${roofFrame.ridgeHeight.toFixed(2)} m`);

    // Gauben und Dachflächenfenster: der Kasten mit betonter Frontkante,
    // das Fenster mit den Diagonalen — dieselbe Sprache wie im Editor.
    for (const o of levelRoofOpenings) {
      const c = roofOpeningCorners(roofFrame, o);
      const d = c.map((p) => `${X(p.x).toFixed(2)} ${Y(p.y).toFixed(2)}`);
      parts.push(
        `<path d="M${d[0]} L${d[1]} L${d[2]} L${d[3]} Z" fill="none" stroke="#334155" stroke-width="0.14"/>`,
      );
      if (o.kind === 'skylight') {
        parts.push(
          `<path d="M${d[0]} L${d[2]} M${d[1]} L${d[3]}" fill="none" stroke="#64748B" stroke-width="0.1"/>`,
        );
      } else {
        const side = dormerSide(roofFrame, o);
        const edge = side > 0 ? `M${d[1]} L${d[2]}` : `M${d[0]} L${d[3]}`;
        parts.push(`<path d="${edge}" fill="none" stroke="#0F172A" stroke-width="0.35"/>`);
      }
    }
  }

  // --- Innenmaßketten -------------------------------------------------------
  // Die lichten Weiten je Raum, waagerecht und senkrecht durch den
  // Raumschwerpunkt. Auf der Baustelle wird nach diesen Maßen gearbeitet,
  // nicht nach den Achsmaßen außen.
  if (options.showInteriorDimensions) {
    for (const room of rooms) {
      const poly = room.innerPolygon;
      if (poly.length < 3 || room.area < 1.5) continue;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const p of poly) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
      const c = room.centroid;
      const horizontal = { a: { x: minX, y: c.y }, b: { x: maxX, y: c.y } };
      const vertical = { a: { x: c.x, y: minY }, b: { x: c.x, y: maxY } };

      for (const seg of [horizontal, vertical]) {
        const clipped = clipToPolygon(seg.a, seg.b, poly);
        if (!clipped.length) continue;
        // Nur das längste Stück bemaßen — bei L-förmigen Räumen wären alle
        // Teilstücke mehr Zahlen als Erkenntnis.
        const best = clipped.reduce((acc, cur) =>
          Math.hypot(cur.b.x - cur.a.x, cur.b.y - cur.a.y) >
          Math.hypot(acc.b.x - acc.a.x, acc.b.y - acc.a.y)
            ? cur
            : acc,
        );
        const len = Math.hypot(best.b.x - best.a.x, best.b.y - best.a.y);
        if (len * mm < 20) continue;
        const x1 = X(best.a.x);
        const y1 = Y(best.a.y);
        const x2 = X(best.b.x);
        const y2 = Y(best.b.y);
        let angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
        if (angle > 90 || angle < -90) angle += 180;
        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2;
        parts.push(
          `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="#94A3B8" stroke-width="0.1" stroke-dasharray="2 1"/>`,
          `<text x="${mx.toFixed(2)}" y="${(my - 0.6).toFixed(2)}" transform="rotate(${angle.toFixed(1)} ${mx.toFixed(2)} ${my.toFixed(2)})" font-size="1.8" text-anchor="middle" fill="#64748B">${len.toFixed(2)}</text>`,
        );
      }
    }
  }

  // --- TGA-Symbole vereinfacht ---------------------------------------------
  if (options.showFixtures) {
    for (const f of fixtures) {
      const w = f.length * mm;
      const h = Math.max(f.depth, 0.08) * mm;
      const colour = f.category === 'heating' ? '#B91C1C' : f.category === 'sanitary' ? '#1D4ED8' : '#047857';
      /*
       * **Die Anschlusspunkte gehören aufs Blatt, nicht nur auf den Schirm.**
       *
       * Auf dem Bildschirm zeichnet `anschlussPunkte` zwei Punkte unter den
       * Heizkörper: gefüllt die Ventilseite, offen der Rücklauf. Auf dem
       * gedruckten Blatt fehlten sie — und gerade das Blatt geht auf die
       * Baustelle. Wer dort die Anbindung setzt, hätte die Seite raten
       * müssen, obwohl sie im Modell erfasst ist. Ist keine Seite erfasst,
       * bleiben beide Punkte offen: Das ist die ehrliche Aussage
       * „nicht aufgenommen" und nicht „rechts".
       *
       * Gezeichnet wird nur, wenn überhaupt etwas erfasst ist — sonst
       * bekäme jeder Heizkörper zwei nichtssagende Kringel, und die Legende
       * müsste einen Zustand erklären, den niemand eingegeben hat.
       */
      const anschluss = f.params?.radiatorConnection;
      const seite = f.params?.valveSide;
      let punkte = '';
      if ((anschluss || seite) && (f.type === 'radiator' || f.type === 'radiator-tube')) {
        const y = h / 2 + Math.min(0.045, f.depth * 0.45) * mm;
        const r = Math.min(0.028, f.length * 0.05) * mm;
        const t = anschluss === 'mitte' ? [-0.025 / Math.max(f.length, 0.001), 0.025 / Math.max(f.length, 0.001)] : [-0.4, 0.4];
        punkte = t
          .map((anteil, i) => {
            const links = i === 0;
            const gefuellt = (links && seite === 'links') || (!links && seite === 'rechts');
            return (
              `<circle cx="${(anteil * w).toFixed(2)}" cy="${y.toFixed(2)}" r="${r.toFixed(2)}" ` +
              `fill="${gefuellt ? colour : 'none'}" stroke="${colour}" stroke-width="0.15"/>`
            );
          })
          .join('');
      }
      parts.push(
        `<g transform="translate(${X(f.position.x).toFixed(2)} ${Y(f.position.y).toFixed(2)}) rotate(${(-f.rotation).toFixed(1)})">` +
          `<rect x="${(-w / 2).toFixed(2)}" y="${(-h / 2).toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" fill="none" stroke="${colour}" stroke-width="0.2"/>` +
          punkte +
          `</g>`,
      );
    }
  }

  /*
   * --- Raumstempel: erst gerechnet, gezeichnet wird er weiter unten ---------
   *
   * Der Stempel steht im Blatt über den Leitungen, aber er muss **vor** ihnen
   * bekannt sein: die Rohrbeschriftung weicht ihm aus, und dazu braucht sie
   * sein Rechteck. Beides aus derselben Liste zu bedienen ist der Punkt —
   * würde die Beschriftung gegen eine zweite, nachgerechnete Lage prüfen,
   * liefen die beiden Fassungen früher oder später auseinander.
   */
  const raumstempel = raumstempelFelder(
    options.showRoomLabels ? rooms : [],
    solids,
    X,
    Y,
    options.raumstempelKurz === true,
  );

  // --- Rohrnetz und Armaturen ----------------------------------------------
  // Die Legende führte die Leitungen seit jeher; gezeichnet wurden sie nie.
  // Genau derselbe Fall wie bei der Treppe: ein Blatt, das in der Legende
  // etwas verspricht, was in der Zeichnung fehlt.
  //
  // Die belegten Flächen wachsen mit: Raumstempel von Anfang an, jede gesetzte
  // Nennweite kommt dazu. Sonst wichen die Beschriftungen zwar dem Stempel
  // aus, aber nicht einander.
  const belegteFelder: Rechteck[] = raumstempel.map((s) => s.kasten);
  for (const run of Object.values(doc.pipes ?? {})) {
    if (!gewerkSichtbar(ebeneFuerMedium(run.service))) continue;
    if (run.levelId !== options.levelId || run.points.length < 2) continue;
    const d = run.points.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(2)} ${Y(p.y).toFixed(2)}`).join(' ');
    const farbe = PIPE_SERVICE_COLORS[run.service];
    parts.push(
      `<path d="${d}" fill="none" stroke="${farbe}" stroke-width="0.3" stroke-linecap="round" stroke-linejoin="round"` +
        `${run.service === 'heating-return' ? ' stroke-dasharray="1.6 1"' : ''}/>`,
    );
    /*
     * Die Dimension an den Abschnitt — an eine Stelle, die frei ist.
     *
     * Bis 1.13.2 stand sie starr auf der Mitte der Verbindungsgeraden. Im
     * Demomodell fiel sie damit auf den Raumstempel „Schlafen / 14,77 m²";
     * beide Angaben waren unlesbar. Die Lage bestimmt jetzt
     * `findeBeschriftungslage` — dieselbe Regel, die auch der Bildschirm
     * benutzt.
     *
     * **Findet sich kein freier Platz, entfällt die Beschriftung.** Das ist
     * die bewusste Entscheidung an dieser Stelle und passiert nicht
     * stillschweigend: die Nennweite jedes Abschnitts steht vollständig in
     * der Rohrnetzberechnung und in der Legende dieses Blattes. Im Plan ist
     * sie eine Lesehilfe — und eine Lesehilfe, die einen Raumstempel
     * zudeckt, hilft niemandem.
     */
    if (run.service === 'heating-flow') {
      const text = `${rohrbezeichnung(run)}${run.insulation ? ` · ${run.insulation} mm` : ''}`;
      // Der weiße Rand (`stroke-width` 0,45) zählt zur belegten Breite: er
      // frisst sich sonst in die Nachbarschrift.
      const mass = {
        breite: text.length * SCHRIFT * ZEICHENBREITE + 0.9,
        oben: -0.9 - SCHRIFT * 0.8,
        unten: -0.9 + SCHRIFT * 0.25,
      };
      const lage = findeBeschriftungslage(
        run.points.map((p) => ({ x: X(p.x), y: Y(p.y) })),
        mass,
        belegteFelder,
        // 14 mm auf dem Blatt war schon bisher die Schranke: kürzere
        // Abschnitte tragen die Angabe nicht, ohne über beide Enden
        // hinauszustehen.
        { mindestlaenge: 14 },
      );
      if (lage) {
        belegteFelder.push(lage.belegt);
        const mx = lage.x;
        const my = lage.y;
        const winkel = (lage.winkel * 180) / Math.PI;
        parts.push(
          `<text x="${mx.toFixed(2)}" y="${(my - 0.9).toFixed(2)}" transform="rotate(${winkel.toFixed(1)} ${mx.toFixed(2)} ${my.toFixed(2)})" ` +
            `font-size="${SCHRIFT}" text-anchor="middle" fill="#334155" stroke="#FFFFFF" stroke-width="0.45" paint-order="stroke">${escapeXml(text)}</text>`,
        );
      }
    }
  }

  for (const armatur of Object.values(doc.pipeAccessories ?? {})) {
    if (armatur.levelId !== options.levelId) continue;
    // Symbolgröße auf dem Blatt: 2,4 mm, unabhängig vom Maßstab. Eine
    // Armatur ist ein Zeichen, kein Bauteil — sie darf nicht mit dem
    // Maßstab wachsen und den Grundriss zudecken.
    const gr = 2.4;
    const cx = X(armatur.position.x);
    const cy = Y(armatur.position.y);
    for (const teil of accessorySymbol(armatur.kind)) {
      parts.push(accessorySvg(teil, cx, cy, gr));
    }
  }

  // --- Fenster- und Türmaße -------------------------------------------------
  // Breite/Höhe an jede Öffnung, beim Fenster darunter die Brüstungshöhe.
  // Geschrieben wird auf der Raumseite: außen läuft die Maßkette, und zwei
  // Zahlenreihen übereinander liest niemand.
  //
  // Der Block steht bewusst *nach* den TGA-Symbolen: unter jedem Fenster
  // hängt üblicherweise ein Heizkörper, und die Maßzahl gehört darüber, nicht
  // darunter. Der weiße Rand hinter der Schrift macht sie auch dort lesbar.
  if (options.showOpeningDimensions) {
    for (const wall of walls) {
      const g = getWallGeometry(wall, doc.nodes);
      if (!g) continue;
      for (const op of openingsOf(openingIndex, wall.id)) {
        const span = openingSpan(g, op);
        const breite = (span.to - span.from) * mm;
        if (breite < 8) continue;
        const label = openingLabel(op);
        const size = Math.min(1.9, Math.max(1.3, breite / 6.2));
        if (label.main.length * size * 0.56 > breite * 1.25) continue;

        const u = (span.from + span.to) / 2;
        const side = labelSide(g, u, op, rooms);
        const face = wallLocalToWorld(g, u, side * g.halfThickness);
        const nx = g.normal.x * side;
        const ny = -g.normal.y * side;
        const px0 = X(face.x);
        const py0 = Y(face.y);

        let angle = (Math.atan2(-g.dir.y, g.dir.x) * 180) / Math.PI;
        if (angle > 90 || angle < -90) angle += 180;

        const zeile = (text: string, abstand: number, fill: string): string => {
          const tx = px0 + nx * abstand;
          const ty = py0 + ny * abstand;
          return (
            `<text x="${tx.toFixed(2)}" y="${ty.toFixed(2)}" transform="rotate(${angle.toFixed(1)} ${tx.toFixed(2)} ${ty.toFixed(2)})" ` +
            `font-size="${size.toFixed(2)}" text-anchor="middle" dominant-baseline="central" fill="${fill}" ` +
            `stroke="#FFFFFF" stroke-width="${(size * 0.28).toFixed(2)}" paint-order="stroke">${escapeXml(text)}</text>`
          );
        };

        parts.push(zeile(label.main, 1.5, '#0F172A'));
        if (label.sub) parts.push(zeile(label.sub, 1.5 + size * 1.25, '#475569'));
      }
    }
  }

  // --- Raumstempel ----------------------------------------------------------
  // Gerechnet weiter oben (`raumstempelFelder`), damit die Rohrbeschriftung
  // ihm ausweichen konnte; gezeichnet erst hier, weil er im Blatt oben liegt.
  for (const stempel of raumstempel) {
    parts.push(
      `<text x="${stempel.x.toFixed(2)}" y="${(stempel.y - 1).toFixed(2)}" font-size="${STEMPEL.name}" font-weight="600" text-anchor="middle" fill="#0F172A">${escapeXml(stempel.name)}</text>`,
      // Bei leerer Fläche entfällt die Zeile ganz — ein leeres `<text>` ließe
      // den Kasten so hoch, als stünde etwas darin.
      stempel.flaeche
        ? `<text x="${stempel.x.toFixed(2)}" y="${(stempel.y + 2.4).toFixed(2)}" font-size="${STEMPEL.flaeche}" text-anchor="middle" fill="#475569">${escapeXml(stempel.flaeche)}</text>`
        : '',
    );
  }

  // --- Freie Maßketten und Beschriftungen -----------------------------------
  if (options.showAnnotations) {
    for (const note of Object.values(doc.annotations ?? {})) {
      if (note.levelId !== options.levelId) continue;
      parts.push(...annotationSvg(note, X, Y));
    }
  }

  // --- Handnotizen ----------------------------------------------------------
  // Bewusst als letzte Zeichnungsschicht, aber vor dem Schriftkopf: eine
  // Notiz liegt auf dem Plan wie ein Bleistiftstrich auf dem Ausdruck und
  // darf ihn überschreiben — den Schriftkopf jedoch nicht.
  if (options.showNotizen) {
    for (const strich of Object.values(doc.freihand ?? {})) {
      if (strich.levelId !== options.levelId || strich.punkte.length < 2) continue;
      const d = strich.punkte.map((p, i) => `${i === 0 ? 'M' : 'L'}${X(p.x).toFixed(2)} ${Y(p.y).toFixed(2)}`).join(' ');
      parts.push(
        `<path d="${d}" fill="none" stroke="#B45309" stroke-width="0.3" stroke-linecap="round" stroke-linejoin="round" opacity="0.85"/>`,
      );
    }
  }

  // --- Schriftkopf und Maßstabsleiste --------------------------------------
  const level = doc.levels[options.levelId];
  const titleBlock = buildTitleBlock(doc, options, sheet, level?.name ?? '', rooms);
  const legend = options.showLegend ? buildLegend(doc, options, frame) : '';
  const scaleBar = drawableScaleBar(MARGIN.left, sheet.h - MARGIN.bottom + 20, options.scale);
  /*
   * Der Nordpfeil gehört auf jeden Bauplan.
   *
   * Ohne ihn ist ein Grundriss nicht lesbar: Welche Fassade die Südfassade
   * ist, entscheidet über Verschattung, Verglasung und den halben Sommer.
   *
   * Er steht **links** oben im Zeichenfeld und nicht rechts, obwohl rechts der
   * gewohnte Platz wäre: Rechts oben sitzt auf diesem Blatt die Legende, und
   * zwei Dinge übereinander sind schlechter als eines am zweitbesten Platz.
   *
   * Der Bildschirm zeichnet dieselbe Rose aus derselben Quelle
   * (`kompassRose`) — damit Blatt und Bildschirm nicht auseinanderlaufen
   * können.
   */
  const nordpfeil = drawNorthArrow(MARGIN.left + 12, MARGIN.top + 12, 8, doc.meta.northAngle);

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${sheet.w}mm" height="${sheet.h}mm" ` +
    `viewBox="0 0 ${sheet.w} ${sheet.h}" font-family="Inter, Segoe UI, system-ui, sans-serif">` +
    // Die Schraffur des Mauerwerks steht als Muster in den Definitionen: so
    // ist sie im ganzen Blatt gleich dicht, unabhängig von der Bauteilgröße.
    `<defs><pattern id="massiv" width="1.1" height="1.1" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">` +
    `<rect width="1.1" height="1.1" fill="#E2E8F0"/>` +
    `<line x1="0" y1="0" x2="0" y2="1.1" stroke="#0F172A" stroke-width="0.28"/></pattern>` +
    `<pattern id="schacht" width="1.6" height="1.6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">` +
    `<rect width="1.6" height="1.6" fill="#FFFFFF"/>` +
    `<line x1="0" y1="0" x2="0" y2="1.6" stroke="#64748B" stroke-width="0.12"/></pattern></defs>` +
    `<rect x="0" y="0" width="${sheet.w}" height="${sheet.h}" fill="#FFFFFF"/>` +
    parts.join('') +
    legend +
    scaleBar +
    nordpfeil +
    titleBlock +
    `</svg>`;

  return { svg, fits, suggestedScale, sheet };
}

/**
 * Der Nordpfeil auf dem Blatt.
 *
 * `(cx|cy)` ist die Mitte in Millimetern, `r` der Radius. Die Formteile
 * kommen aus `kompassRose` in Einheitskoordinaten mit y nach oben; im SVG
 * zählt y nach unten, daher das Minus.
 */
function drawNorthArrow(cx: number, cy: number, r: number, northAngle: number): string {
  const P = (p: Vec2): string => `${(cx + p.x * r).toFixed(2)},${(cy - p.y * r).toFixed(2)}`;
  const teile: string[] = [];
  for (const t of kompassRose(northAngle)) {
    if (t.kind === 'kreis') {
      teile.push(
        `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${(t.radius * r).toFixed(2)}" ` +
          `fill="#FFFFFF" stroke="#0F172A" stroke-width="0.2"/>`,
      );
    } else if (t.kind === 'linie') {
      teile.push(`<line x1="${P(t.a).split(',')[0]}" y1="${P(t.a).split(',')[1]}" ` +
        `x2="${P(t.b).split(',')[0]}" y2="${P(t.b).split(',')[1]}" stroke="#0F172A" stroke-width="0.2"/>`);
    } else if (t.kind === 'flaeche') {
      teile.push(`<polygon points="${t.punkte.map(P).join(' ')}" fill="#0F172A"/>`);
    } else {
      const [tx, ty] = P(t.punkt).split(',');
      teile.push(
        `<text x="${tx}" y="${ty}" font-size="3.2" font-weight="700" fill="#0F172A" ` +
          `text-anchor="middle" dominant-baseline="central">${t.text}</text>`,
      );
    }
  }
  return teile.join('');
}

/** Strichstärken auf dem Blatt [mm] — Klasse aus `openingSymbols`. */
const SYMBOL_WIDTH: Record<SymbolPart['weight'], number> = {
  stark: 0.35,
  mittel: 0.2,
  fein: 0.13,
};

/**
 * Farben der Symbolteile im Druck.
 *
 * Auf dem Bildschirm darf eine Tür blau sein; auf dem Blatt ist sie schwarz.
 * Ein Plan wird schwarzweiß kopiert, gefaxt und im Regen gelesen — die
 * Unterscheidung muss aus Strichstärke und Form kommen, nicht aus Farbe.
 */
const SYMBOL_INK: Record<SymbolPart['role'], string> = {
  laibung: '#0F172A',
  blatt: '#0F172A',
  bogen: '#64748B',
  glas: '#1E293B',
  sturz: '#64748B',
  pfeil: '#64748B',
};

/** Ein Symbolteil als SVG-Element. */
function symbolSvg(
  part: SymbolPart,
  X: (x: number) => number,
  Y: (y: number) => number,
  mm: number,
): string {
  const width = SYMBOL_WIDTH[part.weight];
  const ink = SYMBOL_INK[part.role];
  const opacity = part.faint ? ' stroke-opacity="0.6"' : '';

  if (part.kind === 'line') {
    const dash = part.dashed ? ' stroke-dasharray="1.1 0.9"' : '';
    return (
      `<line x1="${X(part.a.x).toFixed(2)}" y1="${Y(part.a.y).toFixed(2)}" ` +
      `x2="${X(part.b.x).toFixed(2)}" y2="${Y(part.b.y).toFixed(2)}" ` +
      `stroke="${ink}" stroke-width="${width}" stroke-linecap="round"${dash}${opacity}/>`
    );
  }

  // Bogen — und hier lauert die Falle, die den ersten Ausdruck von 1.8.0
  // gekostet hat: die Schwenkbögen schlugen zur falschen Seite aus.
  //
  // `Y(y) = offset + (maxY − y)` ist zwar rechnerisch eine Spiegelung (der
  // Winkel kehrt sein Vorzeichen um), im *Bild* aber nicht: der Punkt, der im
  // Modell über der Mitte liegt, liegt auch auf dem Blatt darüber. Ein Bogen,
  // der im Modell gegen den Uhrzeigersinn läuft, sieht deshalb auch auf dem
  // Blatt gegen den Uhrzeigersinn aus.
  //
  // Das SVG-Sweep-Flag zählt aber in der Zeichenebene mit y nach unten: 1
  // bedeutet dort *im* Uhrzeigersinn. Also gilt ccw → 0, nicht ccw → 1. Mit
  // dem falschen Flag bleiben Anfangs- und Endpunkt gleich, und der Bogen
  // legt sich als Spiegelbild auf die andere Seite der Sehne — die Tür schlägt
  // im Ausdruck zur falschen Seite auf, obwohl auf dem Bildschirm alles
  // stimmt. Die Prüfung dazu rechnet aus dem erzeugten Pfad den Mittelpunkt
  // zurück und hält ihn gegen das Türband.
  const r = part.radius * mm;
  if (r < 0.4) return '';
  const p0 = {
    x: X(part.center.x + part.radius * Math.cos(part.startAngle)),
    y: Y(part.center.y + part.radius * Math.sin(part.startAngle)),
  };
  const p1 = {
    x: X(part.center.x + part.radius * Math.cos(part.endAngle)),
    y: Y(part.center.y + part.radius * Math.sin(part.endAngle)),
  };
  let delta = part.endAngle - part.startAngle;
  while (delta <= -Math.PI * 2) delta += Math.PI * 2;
  while (delta >= Math.PI * 2) delta -= Math.PI * 2;
  if (part.ccw && delta < 0) delta += Math.PI * 2;
  if (!part.ccw && delta > 0) delta -= Math.PI * 2;
  const largeArc = Math.abs(delta) > Math.PI ? 1 : 0;
  const sweep = part.ccw ? 0 : 1;

  return (
    `<path d="M${p0.x.toFixed(2)} ${p0.y.toFixed(2)} A${r.toFixed(2)} ${r.toFixed(2)} 0 ${largeArc} ${sweep} ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}" ` +
    `fill="none" stroke="${ink}" stroke-width="${width}"${opacity}/>`
  );
}

/**
 * Auf welche Wandseite gehört die Beschriftung einer Öffnung?
 *
 * Zwei Regeln, in dieser Reihenfolge. Erstens: nach innen, denn außen läuft
 * die Maßkette. Zweitens, bei Türen: nicht auf die Anschlagseite — dort
 * stehen Blatt und Schwenkbogen, und eine Zahl im Bogen liest niemand. Sind
 * beide Seiten Raum, gewinnt die zweite Regel; ist die freie Seite kein Raum
 * (Haustür, die nach innen aufschlägt), gewinnt die erste.
 *
 * Gefragt wird an der Öffnung, nicht in Wandmitte: eine Wand kann auf halber
 * Länge die Gebäudehülle verlassen.
 */
function labelSide(g: WallGeometry, u: number, op: Opening, rooms: Room[]): 1 | -1 {
  const imRaum = (side: 1 | -1): boolean => {
    const p = wallLocalToWorld(g, u, side * (g.halfThickness + 0.3));
    return rooms.some((r) => r.innerPolygon.length >= 3 && pointInPolygon(p, r.innerPolygon));
  };
  const links = imRaum(1);
  const rechts = imRaum(-1);

  if (op.kind === 'door') {
    // Die Tür schlägt zur +Normalen auf, solange `flipSwing` nicht gesetzt
    // ist — siehe `openingSymbol`. Die freie Seite ist die andere.
    const frei: 1 | -1 = op.flipSwing ? 1 : -1;
    if (frei === 1 ? links : rechts) return frei;
  }

  if (links && !rechts) return 1;
  if (rechts && !links) return -1;
  return 1;
}

/** Welcher Anteil der Raumfläche ist massives Bauteil? */
function massiveShare(room: Room, solids: { solid: SolidElement }[]): number {
  if (room.area <= 0 || room.innerPolygon.length < 3) return 0;
  let sum = 0;
  for (const { solid } of solids) {
    if (!pointInPolygon(solid.position, room.innerPolygon)) continue;
    sum += Math.abs(polygonArea(solidFootprint(solid)));
  }
  return sum / room.area;
}

/**
 * Ein Armaturensymbol als SVG.
 *
 * Lokale Koordinaten (Ursprung = Einbaustelle, Ausdehnung ±0,5) mal
 * Symbolgröße, verschoben auf die Einbaustelle. Die Winkel der Bögen stehen
 * im Modell — auf dem Blatt kehrt sich ihr Vorzeichen um, siehe `symbolSvg`.
 */
function accessorySvg(teil: AccessoryPart, cx: number, cy: number, groesse: number): string {
  const w = teil.weight === 'stark' ? 0.22 : 0.14;
  const X2 = (x: number) => cx + x * groesse;
  const Y2 = (y: number) => cy + y * groesse;
  const ink = '#0F172A';

  if (teil.kind === 'line') {
    return (
      `<line x1="${X2(teil.a.x).toFixed(2)}" y1="${Y2(teil.a.y).toFixed(2)}" x2="${X2(teil.b.x).toFixed(2)}" y2="${Y2(teil.b.y).toFixed(2)}" ` +
      `stroke="${ink}" stroke-width="${w}" stroke-linecap="round"/>`
    );
  }
  if (teil.kind === 'poly') {
    const d = teil.points.map((p, i) => `${i ? 'L' : 'M'}${X2(p.x).toFixed(2)} ${Y2(p.y).toFixed(2)}`).join(' ');
    return `<path d="${d}${teil.closed ? ' Z' : ''}" fill="${teil.filled ? ink : 'none'}" stroke="${ink}" stroke-width="${w}" stroke-linejoin="round"/>`;
  }
  if (teil.kind === 'circle') {
    return (
      `<circle cx="${X2(teil.c.x).toFixed(2)}" cy="${Y2(teil.c.y).toFixed(2)}" r="${(teil.r * groesse).toFixed(2)}" ` +
      `fill="${teil.filled ? ink : 'none'}" stroke="${ink}" stroke-width="${w}"/>`
    );
  }
  const p0 = { x: X2(teil.c.x + teil.r * Math.cos(teil.from)), y: Y2(teil.c.y + teil.r * Math.sin(teil.from)) };
  const p1 = { x: X2(teil.c.x + teil.r * Math.cos(teil.to)), y: Y2(teil.c.y + teil.r * Math.sin(teil.to)) };
  const r = teil.r * groesse;
  const delta = teil.to - teil.from;
  return (
    `<path d="M${p0.x.toFixed(2)} ${p0.y.toFixed(2)} A${r.toFixed(2)} ${r.toFixed(2)} 0 ${Math.abs(delta) > Math.PI ? 1 : 0} ${delta > 0 ? 0 : 1} ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}" ` +
    `fill="none" stroke="${ink}" stroke-width="${w}"/>`
  );
}

function buildTitleBlock(
  doc: BimDocument,
  options: PlanPrintOptions,
  sheet: { w: number; h: number },
  levelName: string,
  rooms: Room[],
): string {
  const y = sheet.h - MARGIN.bottom + 4;
  const area = rooms.reduce((sum, r) => sum + r.area, 0);
  const date = new Date().toLocaleDateString('de-DE');
  const right = sheet.w - MARGIN.right;

  return (
    `<g>` +
    `<line x1="${MARGIN.left}" y1="${y}" x2="${right}" y2="${y}" stroke="#0F172A" stroke-width="0.3"/>` +
    `<text x="${MARGIN.left}" y="${y + 6}" font-size="4" font-weight="600" fill="#0F172A">${escapeXml(
      options.title ?? doc.meta.name,
    )}</text>` +
    `<text x="${MARGIN.left}" y="${y + 11}" font-size="2.6" fill="#475569">Grundriss ${escapeXml(
      levelName,
    )} · ${rooms.length} Räume · ${area.toFixed(2)} m² Nutzfläche</text>` +
    `<text x="${right}" y="${y + 6}" font-size="4" font-weight="600" text-anchor="end" fill="#0F172A">M 1:${options.scale}</text>` +
    `<text x="${right}" y="${y + 11}" font-size="2.6" text-anchor="end" fill="#475569">${date} · RaVia CAD Light</text>` +
    `</g>`
  );
}

const escapeXml = (v: string): string =>
  v.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);

/**
 * Öffnet ein Druckfenster mit dem SVG. Das Blattformat wird über `@page`
 * gesetzt, damit der Browser nicht skaliert — nur so bleibt der Maßstab exakt.
 */
export function printPlan(svg: string, options: PlanPrintOptions): boolean {
  const paper = PAPER[options.format];
  const size = options.orientation === 'landscape' ? `${paper.h}mm ${paper.w}mm` : `${paper.w}mm ${paper.h}mm`;
  const titel = `Grundriss M 1:${options.scale}`;

  // Kein eingebettetes Skript im Dokument: der Druck wird vom Öffner
  // ausgelöst. Siehe `druckFenster.ts` — mit einer Inhaltsrichtlinie
  // `script-src 'self'` würde ein Skript hier verworfen, und der Druckdialog
  // ginge stillschweigend nicht auf.
  return druckeDokument(
    `<!doctype html><html lang="de"><head><meta charset="utf-8">` +
      `<style>@page{size:${size};margin:0}html,body{margin:0;padding:0;background:#fff}` +
      `svg{display:block}@media screen{body{padding:16px;background:#334155}svg{box-shadow:0 8px 40px rgba(0,0,0,.4);margin:0 auto}}</style>` +
      `</head><body>${svg}</body></html>`,
    titel,
  );
}

/**
 * Eine Beschriftung als SVG. Bewusst eine eigene Funktion statt Wiederverwendung
 * des Canvas-Zeichners: auf dem Blatt gelten Millimeter und andere Strichstärken.
 */
function annotationSvg(
  note: Annotation,
  X: (x: number) => number,
  Y: (y: number) => number,
): string[] {
  const out: string[] = [];
  const size = 2.2 * note.scale;

  if (note.kind === 'text') {
    const p = note.points[0];
    /*
     * Derselbe Text wie auf dem Bildschirm — über `planbeschriftungsText`.
     *
     * Vorher stand hier `note.text`. Das ist die Stelle, an der eine in der
     * begehbaren Ansicht gesetzte Fahne ihre Höhenangabe verlor: am
     * Bildschirm „2000 W · +0,85 m", auf dem gedruckten Blatt „2000 W".
     * Gerade das Blatt geht aber auf die Baustelle, und dort ist die Höhe
     * die Hälfte der Auskunft.
     */
    out.push(
      `<text x="${X(p.x).toFixed(2)}" y="${Y(p.y).toFixed(2)}" font-size="${size.toFixed(2)}" fill="#0F172A">${escapeXml(planbeschriftungsText(note))}</text>`,
    );
    return out;
  }

  if (note.kind === 'leader') {
    const tip = note.points[0];
    const anchor = note.points[1];
    const dir = anchor.x >= tip.x ? 1 : -1;
    const flagX = X(anchor.x) + dir * 8;
    out.push(
      `<path d="M${X(tip.x).toFixed(2)} ${Y(tip.y).toFixed(2)} L${X(anchor.x).toFixed(2)} ${Y(anchor.y).toFixed(2)} L${flagX.toFixed(2)} ${Y(anchor.y).toFixed(2)}" fill="none" stroke="#334155" stroke-width="0.12"/>`,
      `<circle cx="${X(tip.x).toFixed(2)}" cy="${Y(tip.y).toFixed(2)}" r="0.5" fill="#334155"/>`,
      `<text x="${(flagX - dir * 7.5).toFixed(2)}" y="${(Y(anchor.y) - 0.8).toFixed(2)}" font-size="${size.toFixed(2)}" text-anchor="${dir > 0 ? 'start' : 'end'}" fill="#0F172A">${escapeXml(planbeschriftungsText(note))}</text>`,
    );
    return out;
  }

  const line = dimensionLine(note);
  if (!line) return out;
  const a = note.points[0];
  const b = note.points[1];
  const x1 = X(line.a.x);
  const y1 = Y(line.a.y);
  const x2 = X(line.b.x);
  const y2 = Y(line.b.y);
  const angle0 = Math.atan2(y2 - y1, x2 - x1);
  const tick = 1.4;
  let textAngle = (angle0 * 180) / Math.PI;
  if (textAngle > 90 || textAngle < -90) textAngle += 180;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;

  out.push(
    `<line x1="${X(a.x).toFixed(2)}" y1="${Y(a.y).toFixed(2)}" x2="${x1.toFixed(2)}" y2="${y1.toFixed(2)}" stroke="#64748B" stroke-width="0.08"/>`,
    `<line x1="${X(b.x).toFixed(2)}" y1="${Y(b.y).toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="#64748B" stroke-width="0.08"/>`,
    `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="#334155" stroke-width="0.15"/>`,
  );
  for (const [px, py] of [
    [x1, y1],
    [x2, y2],
  ]) {
    out.push(
      `<line x1="${(px - tick * Math.cos(angle0 + Math.PI / 4)).toFixed(2)}" y1="${(py - tick * Math.sin(angle0 + Math.PI / 4)).toFixed(2)}" x2="${(px + tick * Math.cos(angle0 + Math.PI / 4)).toFixed(2)}" y2="${(py + tick * Math.sin(angle0 + Math.PI / 4)).toFixed(2)}" stroke="#334155" stroke-width="0.15"/>`,
    );
  }
  out.push(
    `<text x="${mx.toFixed(2)}" y="${(my - 0.8).toFixed(2)}" transform="rotate(${textAngle.toFixed(1)} ${mx.toFixed(2)} ${my.toFixed(2)})" font-size="${size.toFixed(2)}" text-anchor="middle" fill="#0F172A">${escapeXml(annotationText(note))}</text>`,
  );
  return out;
}

/**
 * Symbollegende am rechten Blattrand: nur das, was auf *diesem* Blatt
 * tatsächlich vorkommt. Eine vollständige Bibliothekslegende wäre eine
 * Seite Papier ohne Bezug zum Plan.
 */
function buildLegend(
  doc: BimDocument,
  options: PlanPrintOptions,
  frame: { x: number; y: number; w: number; h: number },
): string {
  const entries: { colour: string; label: string; dashed?: boolean; pattern?: string }[] = [];
  // Die Legende zeigt nur, was auf *diesem* Blatt steht — also auch nur die
  // eingeblendeten Gewerke. Eine Legende, die ein Gewerk führt, das der Plan
  // nicht zeigt, lässt den Leser danach suchen.
  const gewerkSichtbar = (id: string): boolean => doc.layers?.[id]?.visible !== false;

  // Massives Mauerwerk zuerst: es ist die einzige Flächensignatur auf dem
  // Blatt und wird sonst mit einem Schacht verwechselt.
  const massiv = solidsOnLevel(doc, options.levelId);
  if (massiv.length) {
    const arten = [...new Set(massiv.map((m) => SOLID_LABELS[m.solid.kind]))];
    entries.push({
      colour: '#0F172A',
      pattern: 'massiv',
      label: arten.length > 1 ? 'Massiv (Mauerwerk)' : arten[0],
    });
  }

  if (options.showFixtures) {
    const seen = new Set<string>();
    for (const f of Object.values(doc.fixtures)) {
      if (!gewerkSichtbar(ebeneFuerObjekt(f))) continue;
      if (f.levelId !== options.levelId || seen.has(f.category)) continue;
      seen.add(f.category);
      entries.push({
        colour: f.category === 'heating' ? '#B91C1C' : f.category === 'sanitary' ? '#1D4ED8' : '#047857',
        label:
          f.category === 'heating' ? 'Heizung' : f.category === 'sanitary' ? 'Sanitär' : 'Lüftung',
      });
    }
  }

  const seenPipes = new Set<string>();
  for (const run of Object.values(doc.pipes ?? {})) {
    if (!gewerkSichtbar(ebeneFuerMedium(run.service))) continue;
    if (run.levelId !== options.levelId) continue;
    const key = `${run.service}-${rohrbezeichnungLang(run)}`;
    if (seenPipes.has(key)) continue;
    seenPipes.add(key);
    entries.push({
      colour: PIPE_SERVICE_COLORS[run.service],
      label: `${PIPE_SERVICE_LABELS[run.service]} ${rohrbezeichnungLang(run)}`,
      dashed: run.service === 'heating-return',
    });
  }

  /*
   * Die Ventilseite braucht eine Zeile, sobald sie auf dem Blatt vorkommt.
   *
   * Zwei kleine Kreise unter einem Heizkörper erklären sich nicht von
   * selbst — und eine Signatur, die auf dem Blatt steht, aber in der Legende
   * fehlt, ist auf der Baustelle eine Rückfrage. Die Zeile erscheint nur,
   * wenn wirklich eine Seite erfasst ist: Wo alles offen bliebe, gäbe es
   * nichts zu erklären.
   */
  if (options.showFixtures) {
    const mitSeite = Object.values(doc.fixtures).some(
      (f) => f.levelId === options.levelId && f.params?.valveSide !== undefined,
    );
    if (mitSeite) {
      entries.push({ colour: '#B91C1C', pattern: 'ventilseite', label: 'Ventilseite (gefüllt), von vorn' });
    }
  }

  const durchbrueche = gewerkSichtbar(EBENE_DURCHBRUECHE)
    ? durchbruecheAufGeschoss(doc, options.levelId).filter((e) => !e.vonUnten)
    : [];
  if (durchbrueche.length) {
    const arten = [...new Set(durchbrueche.map((e) => DURCHBRUCH_LABELS[e.durchbruch.kind]))];
    entries.push({
      colour: '#0F172A',
      label: arten.length > 1 ? `Durchbrüche (${durchbrueche.length})` : `${arten[0]} (${durchbrueche.length})`,
    });
  }

  const verticals = Object.values(doc.verticals ?? {}).filter((v) => v.levelId === options.levelId);
  if (verticals.some((v) => v.kind !== 'shaft')) entries.push({ colour: '#475569', label: 'Treppe' });
  if (verticals.some((v) => v.kind === 'shaft')) entries.push({ colour: '#7C3AED', label: 'Schacht' });

  if (!entries.length) return '';

  const w = 42;
  const rowH = 4;
  const h = entries.length * rowH + 6;
  const x = frame.x + frame.w - w;
  const y = frame.y;

  const rows = entries
    .map((e, i) => {
      const ry = y + 6 + i * rowH;
      /*
       * Die Ventilseite bekommt kein Füllmuster, sondern ihr eigenes
       * Sinnbild: zwei Kreise, einer voll, einer leer — genau das, was auf
       * dem Blatt unter dem Heizkörper steht. Ein Strich in Rot hätte hier
       * nichts erklärt.
       */
      const swatch =
        e.pattern === 'ventilseite'
          ? `<circle cx="${(x + 3.2).toFixed(2)}" cy="${ry.toFixed(2)}" r="0.9" fill="${e.colour}"/>` +
            `<circle cx="${(x + 6.4).toFixed(2)}" cy="${ry.toFixed(2)}" r="0.9" fill="none" stroke="${e.colour}" stroke-width="0.2"/>`
          : e.pattern
            ? `<rect x="${(x + 2).toFixed(2)}" y="${(ry - 1.3).toFixed(2)}" width="6" height="2.6" fill="url(#${e.pattern})" stroke="${e.colour}" stroke-width="0.2"/>`
            : `<line x1="${(x + 2).toFixed(2)}" y1="${ry.toFixed(2)}" x2="${(x + 8).toFixed(2)}" y2="${ry.toFixed(2)}" stroke="${e.colour}" stroke-width="0.5"${e.dashed ? ' stroke-dasharray="1.2 0.8"' : ''}/>`;
      return (
        swatch +
        `<text x="${(x + 10).toFixed(2)}" y="${(ry + 0.8).toFixed(2)}" font-size="2" fill="#334155">${escapeXml(e.label)}</text>`
      );
    })
    .join('');

  return (
    `<g>` +
    `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w}" height="${h.toFixed(2)}" fill="#FFFFFF" fill-opacity="0.92" stroke="#CBD5E1" stroke-width="0.15"/>` +
    `<text x="${(x + 2).toFixed(2)}" y="${(y + 3.4).toFixed(2)}" font-size="2.1" font-weight="600" fill="#0F172A">Legende</text>` +
    rows +
    `</g>`
  );
}
