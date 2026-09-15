/**
 * Durchbrüche im Grundriss — Geometrie und Zeichnung.
 * ---------------------------------------------------------------------------
 * Ein Durchbruch ist das einzige Bauteil in diesem Modell, dessen Lage von
 * *zwei* verschiedenen Bezugssystemen kommt: der Wanddurchbruch sitzt
 * parametrisch auf der Wandachse (wie eine Tür), der Deckendurchbruch steht
 * frei im Grundriss (wie ein Kamin). Damit kein Aufrufer diese Fallunter-
 * scheidung nachbauen muss, liefert `durchbruchUmriss` beide Fälle als
 * dieselbe Antwort: ein Polygon in Weltkoordinaten.
 *
 * Alles in diesem Modul ist farb- und maßstabsfrei, soweit es Geometrie ist.
 * Gezeichnet wird nur, was auf den Bildschirm gehört; der Ausdruck holt sich
 * dieselben Umrisse und malt sie in Druckfarben.
 */

import type { BimDocument, Durchbruch, Level, Opening, Vec2, Wall } from '../types/bim';
import { durchbruchWirt } from '../types/bim';
import { getWallGeometry, wallLocalToWorld } from './wallGeometry';

const TO_RAD = Math.PI / 180;

/** Feinheit der Kreispolygonisierung. 24 Ecken sind bei DN 100 ein Kreis. */
export const RUND_SEGMENTE = 24;

/**
 * Farben des Durchbruchs.
 *
 * Ein noch nicht vergebener Ton: Wände blaugrau, Räume türkis, Schächte
 * violett, massive Bauteile mauerwerkfarben, offene Wandenden orange. Ein
 * Durchbruch bekommt Magenta — kräftig genug, um in einer Wand aufzufallen,
 * und mit nichts zu verwechseln, was sonst im Plan steht.
 */
export const DURCHBRUCH_COLORS = {
  edge: '#DB2777',
  fill: 'rgba(219,39,119,0.22)',
  mark: 'rgba(219,39,119,0.9)',
  active: '#38BDF8',
  activeFill: 'rgba(56,189,248,0.24)',
};

/** Lichter Querschnitt [m²] — rund über den Durchmesser, sonst Rechteck. */
export function durchbruchFlaeche(d: Durchbruch): number {
  if (d.form === 'rund') {
    const r = (d.diameter ?? 0) / 2;
    return Math.PI * r * r;
  }
  return (d.width ?? 0) * (d.height ?? 0);
}

/**
 * Das Maß, das im Grundriss zu sehen ist [m].
 *
 * In der Wand ist das die **Breite** — die Höhe steht senkrecht zur
 * Zeichenebene und erscheint nur als Zahl. In der Decke sind beide Maße
 * sichtbar; dort ist dies die Ausdehnung in x-Richtung.
 */
function grundrissBreite(d: Durchbruch): number {
  return d.form === 'rund' ? (d.diameter ?? 0) : (d.width ?? 0);
}

/** Das zweite Grundrissmaß [m]. In der Wand die Wanddicke, in der Decke `height`. */
function grundrissTiefe(d: Durchbruch, wanddicke: number | null): number {
  if (wanddicke !== null) return wanddicke;
  return d.form === 'rund' ? (d.diameter ?? 0) : (d.height ?? 0);
}

/**
 * Mittelpunkt des Durchbruchs in Weltkoordinaten.
 *
 * Beim Wanddurchbruch wird er aus Wand und Abstand gerechnet — deshalb wandert
 * er mit, wenn die Wand verschoben oder gedreht wird. Fehlt die Wand, gibt es
 * keinen Punkt; der Durchbruch ist dann verwaist und wird nicht gezeichnet,
 * aber auch nicht gelöscht (siehe `validation`).
 */
export function durchbruchMitte(d: Durchbruch, doc: BimDocument): Vec2 | null {
  if (durchbruchWirt(d.kind) === 'decke') return d.position ?? null;
  if (!d.wallId) return null;
  const wall = doc.walls[d.wallId];
  if (!wall) return null;
  const g = getWallGeometry(wall, doc.nodes);
  if (!g) return null;
  const u = Math.min(Math.max(d.distance ?? 0, 0), g.length);
  return wallLocalToWorld(g, u, 0);
}

/**
 * Der Umriss des Durchbruchs im Grundriss, in Weltkoordinaten.
 *
 * Wandgebunden: ein Rechteck über die volle Wanddicke, damit man sieht, dass
 * das Loch durch die Wand geht und nicht auf ihr liegt. Runde Bohrungen werden
 * dabei trotzdem als Kreis gezeichnet (siehe `zeichneDurchbruch`) — der
 * Umriss hier ist die Trefferfläche und die Aussparung, nicht das Symbol.
 */
export function durchbruchUmriss(d: Durchbruch, doc: BimDocument): Vec2[] {
  if (durchbruchWirt(d.kind) === 'decke') return deckendurchbruchUmriss(d);
  if (!d.wallId) return [];
  const wall = doc.walls[d.wallId];
  if (!wall) return [];
  const g = getWallGeometry(wall, doc.nodes);
  if (!g) return [];
  const b = grundrissBreite(d);
  const u = Math.min(Math.max(d.distance ?? 0, 0), g.length);
  const halb = b / 2;
  const t = g.halfThickness;
  return [
    wallLocalToWorld(g, u - halb, t),
    wallLocalToWorld(g, u + halb, t),
    wallLocalToWorld(g, u + halb, -t),
    wallLocalToWorld(g, u - halb, -t),
  ];
}

/**
 * Der Umriss eines Deckendurchbruchs — **ohne** das Dokument.
 *
 * Die Deckengeometrie braucht genau diese Form und sonst nichts vom Modell.
 * Gäbe es hier nur die allgemeine Fassung, müsste `slabGeometry` ein ganzes
 * `BimDocument` annehmen, um ein Loch zu schneiden, das allein aus Punkt und
 * Maß folgt.
 */
export function deckendurchbruchUmriss(d: Durchbruch): Vec2[] {
  const p = d.position;
  if (!p) return [];
  if (d.form === 'rund') return kreis(p, (d.diameter ?? 0) / 2);
  return rechteck(p, d.width ?? 0, d.height ?? 0, (d.rotation ?? 0) * TO_RAD);
}

function kreis(mitte: Vec2, r: number): Vec2[] {
  if (r <= 0) return [];
  const out: Vec2[] = [];
  for (let i = 0; i < RUND_SEGMENTE; i++) {
    const a = (i / RUND_SEGMENTE) * Math.PI * 2;
    out.push({ x: mitte.x + Math.cos(a) * r, y: mitte.y + Math.sin(a) * r });
  }
  return out;
}

function rechteck(mitte: Vec2, w: number, h: number, a: number): Vec2[] {
  if (w <= 0 || h <= 0) return [];
  const dx = { x: Math.cos(a), y: Math.sin(a) };
  const dy = { x: -Math.sin(a), y: Math.cos(a) };
  const hw = w / 2;
  const hh = h / 2;
  return [
    { x: mitte.x - dx.x * hw - dy.x * hh, y: mitte.y - dx.y * hw - dy.y * hh },
    { x: mitte.x + dx.x * hw - dy.x * hh, y: mitte.y + dx.y * hw - dy.y * hh },
    { x: mitte.x + dx.x * hw + dy.x * hh, y: mitte.y + dx.y * hw + dy.y * hh },
    { x: mitte.x - dx.x * hw + dy.x * hh, y: mitte.y - dx.y * hw + dy.y * hh },
  ];
}

/**
 * Die Durchbrüche, die in einem Geschoss zu zeichnen sind.
 *
 * Ein Deckendurchbruch gehört dem Geschoss **unter** der Decke; im Geschoss
 * darüber ist von ihm das Loch im Fußboden zu sehen. Das ist dieselbe
 * Zweifachsicht wie bei Treppe und Schacht, und sie wird hier genauso
 * ausgedrückt: `vonUnten` heißt „dieser Durchbruch gehört nicht diesem
 * Geschoss, aber er ist hier zu sehen".
 */
export function durchbruecheAufGeschoss(
  doc: BimDocument,
  levelId: string,
): { durchbruch: Durchbruch; vonUnten: boolean }[] {
  const rang = new Map(
    Object.values(doc.levels)
      .sort((a, b) => a.order - b.order)
      .map((l: Level, i) => [l.id, i]),
  );
  const hier = rang.get(levelId);
  const out: { durchbruch: Durchbruch; vonUnten: boolean }[] = [];
  for (const durchbruch of Object.values(doc.durchbrueche ?? {})) {
    if (durchbruch.levelId === levelId) {
      out.push({ durchbruch, vonUnten: false });
      continue;
    }
    if (durchbruchWirt(durchbruch.kind) !== 'decke') continue;
    const unten = rang.get(durchbruch.levelId);
    if (unten !== undefined && hier !== undefined && hier === unten + 1) {
      out.push({ durchbruch, vonUnten: true });
    }
  }
  return out;
}

/** Punkt im Umriss — für die Auswahl im Plan. */
export function trifftDurchbruch(d: Durchbruch, doc: BimDocument, p: Vec2): boolean {
  const poly = durchbruchUmriss(d, doc);
  if (poly.length < 3) return false;
  let innen = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      innen = !innen;
    }
  }
  return innen;
}

/**
 * Die Beschriftung eines Durchbruchs — dieselbe Zeile auf Bildschirm und Blatt.
 *
 * Sie muss so kurz sein, dass sie neben ein 100er Loch passt, und so
 * vollständig, dass man danach bohren kann. Die Reihenfolge folgt dem, was
 * auf der Baustelle zuerst gebraucht wird: Maß, dann Höhe, dann Anforderung.
 */
export function durchbruchBeschriftung(d: Durchbruch): string {
  const teile: string[] = [];
  if (d.form === 'rund') teile.push(`Ø${Math.round((d.diameter ?? 0) * 1000)}`);
  else teile.push(`${Math.round((d.width ?? 0) * 1000)}×${Math.round((d.height ?? 0) * 1000)}`);
  if (durchbruchWirt(d.kind) === 'wand' && d.sillHeight !== undefined) {
    teile.push(`${d.sillHeight.toFixed(2).replace('.', ',')} m`);
  }
  if (d.brandschutz && d.brandschutz !== 'keine') teile.push(d.brandschutz.replace('R', 'R '));
  return teile.join(' · ');
}

/**
 * Ein Durchbruch im Grundriss.
 *
 * Die Normdarstellung eines Durchbruchs ist ein gekreuztes Feld: zwei
 * Diagonalen im Umriss. Das ist kein Schmuck — es unterscheidet das Loch vom
 * Bauteil, denn beide sind im Plan Rechtecke, und ein ungekreuztes Rechteck in
 * einer Wand liest jeder als Vormauerung. Bei runder Form kommt zusätzlich
 * der Kreis mit Achskreuz, weil danach angerissen wird.
 *
 * `vonUnten` zeichnet das Loch im Fußboden des Geschosses darüber:
 * gestrichelt, abgeschwächt und ohne Trefferfläche — was dort liegt, gehört
 * dem Geschoss darunter.
 */
export function zeichneDurchbruch(
  ctx: CanvasRenderingContext2D,
  d: Durchbruch,
  doc: BimDocument,
  sx: (x: number) => number,
  sy: (y: number) => number,
  zoom: number,
  state: { selected: boolean; vonUnten?: boolean },
): void {
  const poly = durchbruchUmriss(d, doc);
  if (poly.length < 3) return;
  const mitte = durchbruchMitte(d, doc);
  if (!mitte) return;
  const farbe = state.selected ? DURCHBRUCH_COLORS.active : DURCHBRUCH_COLORS.edge;

  ctx.save();
  if (state.vonUnten) ctx.globalAlpha = 0.5;

  const pfad = () => {
    ctx.beginPath();
    ctx.moveTo(sx(poly[0].x), sy(poly[0].y));
    for (let i = 1; i < poly.length; i++) ctx.lineTo(sx(poly[i].x), sy(poly[i].y));
    ctx.closePath();
  };

  pfad();
  ctx.fillStyle = state.selected ? DURCHBRUCH_COLORS.activeFill : DURCHBRUCH_COLORS.fill;
  ctx.fill();

  // Das Kreuz im Feld — die eigentliche Aussage „hier ist nichts".
  const xs = poly.map((p) => sx(p.x));
  const ys = poly.map((p) => sy(p.y));
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  ctx.save();
  pfad();
  ctx.clip();
  ctx.strokeStyle = state.selected ? DURCHBRUCH_COLORS.active : DURCHBRUCH_COLORS.mark;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.moveTo(x1, y0);
  ctx.lineTo(x0, y1);
  ctx.stroke();
  ctx.restore();

  pfad();
  ctx.strokeStyle = farbe;
  ctx.lineWidth = state.selected ? 2.2 : 1.4;
  if (state.vonUnten) ctx.setLineDash([5, 4]);
  ctx.stroke();
  ctx.setLineDash([]);

  // Runde Bohrungen bekommen zusätzlich ihren Kreis: im Wanddurchbruch ist
  // der Umriss ein Rechteck über die Wanddicke, der Bohrer aber rund.
  if (d.form === 'rund' && d.diameter) {
    const r = (d.diameter / 2) * zoom;
    if (r > 1.5) {
      ctx.beginPath();
      ctx.arc(sx(mitte.x), sy(mitte.y), r, 0, Math.PI * 2);
      ctx.strokeStyle = farbe;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  }

  if (zoom > 30 && !state.vonUnten) {
    const text = durchbruchBeschriftung(d);
    ctx.font = '9px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const w = ctx.measureText(text).width;
    const cx = sx(mitte.x);
    // Die Fahne sitzt **über** dem Loch, nicht darin: bei Ø 100 ist im Loch
    // kein Platz für Text, und Text über einer Aussparung wäre eine Lüge.
    const cy = sy(mitte.y) - Math.max(10, (y1 - y0) / 2 + 9);
    ctx.fillStyle = 'rgba(11,17,32,0.85)';
    ctx.fillRect(cx - w / 2 - 3, cy - 6, w + 6, 12);
    ctx.fillStyle = farbe;
    ctx.fillText(text, cx, cy);
    ctx.beginPath();
    ctx.moveTo(cx, cy + 6);
    ctx.lineTo(cx, sy(mitte.y));
    ctx.strokeStyle = farbe;
    ctx.lineWidth = 0.8;
    ctx.globalAlpha = (state.vonUnten ? 0.5 : 1) * 0.7;
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * Passt der Durchbruch in seine Wand?
 *
 * Drei Fragen, die vor dem Bohren zu klären sind und die das Modell selbst
 * beantworten kann: Ist er breiter als die Wand lang? Ragt er über das
 * Wandende hinaus? Reicht er über die lichte Geschosshöhe hinaus? Die
 * Wanddicke bleibt bewusst außen vor — ein Loch *soll* durch die Wand gehen.
 */
export function durchbruchPasst(
  d: Durchbruch,
  doc: BimDocument,
  lichteHoehe: number,
): { passt: boolean; grund?: string } {
  if (durchbruchWirt(d.kind) === 'decke') return { passt: true };
  if (!d.wallId) return { passt: false, grund: 'Keine Wand zugeordnet.' };
  const wall: Wall | undefined = doc.walls[d.wallId];
  if (!wall) return { passt: false, grund: 'Die zugeordnete Wand fehlt im Modell.' };
  const g = getWallGeometry(wall, doc.nodes);
  if (!g) return { passt: false, grund: 'Die zugeordnete Wand hat keine Geometrie.' };
  const b = grundrissBreite(d);
  if (b > g.length) return { passt: false, grund: 'Breiter als die Wand lang ist.' };
  const u = d.distance ?? 0;
  if (u - b / 2 < -1e-6 || u + b / 2 > g.length + 1e-6) {
    return { passt: false, grund: 'Ragt über das Wandende hinaus.' };
  }
  const unten = d.sillHeight ?? 0;
  const hoch = d.form === 'rund' ? (d.diameter ?? 0) : (d.height ?? 0);
  const oben = d.form === 'rund' ? unten + hoch / 2 : unten + hoch;
  if (oben > lichteHoehe + 1e-6) {
    return { passt: false, grund: 'Reicht über die lichte Geschosshöhe hinaus.' };
  }
  return { passt: true };
}

/** Nur für Prüfung und 3D: die Grundrisstiefe, ohne sie doppelt zu rechnen. */
export function durchbruchTiefe(d: Durchbruch, doc: BimDocument): number {
  if (durchbruchWirt(d.kind) === 'decke') return grundrissTiefe(d, null);
  if (!d.wallId) return 0;
  const wall = doc.walls[d.wallId];
  if (!wall) return 0;
  const g = getWallGeometry(wall, doc.nodes);
  return g ? g.halfThickness * 2 : 0;
}

/**
 * Die Durchbrüche einer Wand als Aussparungen für die 3D-Wandzerlegung.
 * ---------------------------------------------------------------------------
 * `wallSolidParts` zerlegt eine Wand in massive Teilquader und schneidet
 * Fenster und Türen dabei als echte Löcher heraus — ohne CSG, exakt und
 * praktisch gratis. Genau das braucht ein Durchbruch auch: in 3D soll man
 * durch die Bohrung hindurchsehen, nicht auf eine aufgemalte Markierung.
 *
 * Dafür wird der Durchbruch in die Form gebracht, die jene Funktion versteht:
 * eine Öffnung mit Abstand, Breite, Höhe und Brüstung. Das ist keine
 * Umdeutung des Bauteils — es bleibt ein Durchbruch in Modell, Plan und
 * Export; nur für die eine Zerlegung wird seine Geometrie in deren Sprache
 * übersetzt.
 *
 * **Zwei Fälle werden bewusst ausgelassen:**
 *
 * 1. *Der Schlitz.* Er geht nicht durch die Wand, er ist eine Vertiefung. Ein
 *    Loch daraus zu machen wäre falsch — man sähe durch eine Wand, die steht.
 * 2. *Überlagerung mit einer echten Öffnung.* Die Zerlegung setzt voraus, dass
 *    die Aussparungen sich auf der Wandachse **nicht überlappen**; ihr Cursor
 *    läuft nur vorwärts. Zwei überlappende Spannen ergäben ein fehlendes
 *    Wandstück statt zweier Löcher — ein Fehler, der wie ein Einsturz aussieht.
 *    Eine Bohrung, die in einem Fenster sitzt, ist ohnehin keine: dort ist
 *    schon ein Loch. Sie wird deshalb still übergangen.
 *
 * Runde Bohrungen werden als ihr umschreibendes Quadrat ausgeschnitten. Das
 * ist bei Ø 100 in einer 24er Wand der Unterschied zwischen einem Kreis und
 * einem Quadrat auf zehn Zentimetern — in einer Ansicht, die das ganze Haus
 * zeigt, nicht wahrnehmbar, und jeder runde Querschnitt kostete eine
 * Zylinderverschneidung je Bohrung.
 */
export function durchbruchAussparungen(
  durchbrueche: readonly Durchbruch[],
  wallId: string,
  openings: readonly { distance: number; width: number }[],
  wandLaenge: number,
): Opening[] {
  const belegt = openings.map((o) => ({
    von: o.distance - o.width / 2,
    bis: o.distance + o.width / 2,
  }));
  const raus: Opening[] = [];
  for (const d of durchbrueche) {
    if (d.wallId !== wallId) continue;
    if (durchbruchWirt(d.kind) !== 'wand') continue;
    if (d.kind === 'schlitz') continue;
    const breite = d.form === 'rund' ? (d.diameter ?? 0) : (d.width ?? 0);
    const hoch = d.form === 'rund' ? (d.diameter ?? 0) : (d.height ?? 0);
    if (breite <= 0 || hoch <= 0) continue;
    const u = Math.min(Math.max(d.distance ?? 0, 0), wandLaenge);
    const von = u - breite / 2;
    const bis = u + breite / 2;
    if (belegt.some((b) => von < b.bis - 1e-6 && b.von < bis - 1e-6)) continue;
    // Bei runder Form ist `sillHeight` die Achshöhe, bei rechteckiger die
    // Unterkante — dieselbe Unterscheidung wie überall sonst, und auch hier
    // säße der Kreis sonst eine halbe Bohrung zu hoch.
    const unten = d.form === 'rund' ? (d.sillHeight ?? 0) - hoch / 2 : (d.sillHeight ?? 0);
    raus.push({
      id: d.id,
      wallId,
      kind: 'passage',
      distance: u,
      width: breite,
      height: hoch,
      sillHeight: Math.max(0, unten),
    });
    belegt.push({ von, bis });
  }
  // Die Zerlegung erwartet die Spannen sortiert; sie sortiert zwar selbst,
  // aber der Aufrufer hängt diese Liste an die echten Öffnungen an, und dort
  // gilt dieselbe Erwartung.
  return raus.sort((a, b) => a.distance - b.distance);
}
