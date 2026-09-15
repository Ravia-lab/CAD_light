/**
 * TGA-Symbolik — Vektorzeichnungen für den Grundriss.
 * ---------------------------------------------------------------------------
 * Jedes Symbol wird in *lokalen Symbolkoordinaten* beschrieben: Ursprung in
 * der Objektmitte, +x entlang der Baulänge, +y in die Bautiefe. Die
 * Transformation nach Weltkoordinaten (Drehung, Position, Zoom) macht der
 * Aufrufer einmal — dadurch bleiben die Zeichenroutinen kurz, testbar und
 * unabhängig vom Viewport.
 *
 * Die Symbole folgen den in der TGA-Planung üblichen Konventionen (Heizkörper
 * als Rechteck mit Lamellen, Zu-/Abluft als Ventilkreuz mit gerichteten
 * Pfeilen, Sanitärobjekte als Umriss mit Ablaufpunkt), bleiben aber bewusst
 * schlank gezeichnet — sie sollen den Grundriss lesbar lassen, nicht
 * überladen.
 */

import type { Fixture, FixtureCategory, FixtureType, Vec2 } from '../types/bim';
import type { FloorLoopLayout } from './floorLoopLayout';

export const FIXTURE_COLORS: Record<FixtureCategory, string> = {
  heating: '#F87171',
  sanitary: '#38BDF8',
  ventilation: '#34D399',
};

/** Kurzer Kennwert unter dem Symbol — das, was im Plan wirklich zählt. */
export function fixtureBadge(fixture: Fixture): string | null {
  if (fixture.type === 'storage' && fixture.params.volumeL) {
    return `${fixture.params.volumeL} l`;
  }
  if (fixture.category === 'heating' && fixture.params.powerW) {
    return `${fixture.params.powerW} W`;
  }
  if (fixture.category === 'ventilation' && fixture.params.airflow) {
    return `${fixture.params.airflow} m³/h`;
  }
  if (fixture.category === 'sanitary' && fixture.params.connection) {
    return fixture.params.connection;
  }
  return null;
}

type Ctx = CanvasRenderingContext2D;

/**
 * Zeichnet ein Symbol. Der Kontext ist bereits so transformiert, dass eine
 * Einheit einem Meter entspricht und der Ursprung in der Objektmitte liegt.
 * `s` ist der Meter-nach-Pixel-Faktor, um Linienstärken zoomfest zu halten.
 */
type SymbolDrawer = (ctx: Ctx, f: Fixture, s: number) => void;

const line = (ctx: Ctx, x1: number, y1: number, x2: number, y2: number) => {
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
};

const rect = (ctx: Ctx, w: number, h: number) => {
  ctx.rect(-w / 2, -h / 2, w, h);
};

/** Pfeilspitze an (x, y), Richtung `angle` [rad]. */
const arrowHead = (ctx: Ctx, x: number, y: number, angle: number, size: number) => {
  const a1 = angle + 2.6;
  const a2 = angle - 2.6;
  ctx.moveTo(x, y);
  ctx.lineTo(x + Math.cos(a1) * size, y + Math.sin(a1) * size);
  ctx.moveTo(x, y);
  ctx.lineTo(x + Math.cos(a2) * size, y + Math.sin(a2) * size);
};

// ---------------------------------------------------------------------------
// Heizung
// ---------------------------------------------------------------------------

const drawRadiator: SymbolDrawer = (ctx, f) => {
  const w = f.length;
  const h = f.depth;
  ctx.beginPath();
  rect(ctx, w, h);
  ctx.stroke();

  // Lamellen — Anzahl aus der Baulänge, damit ein 2-m-Heizkörper nicht
  // dieselbe Strichdichte bekommt wie ein 60-cm-Gerät.
  const fins = Math.max(3, Math.round(w / 0.12));
  ctx.beginPath();
  for (let i = 1; i < fins; i++) {
    const x = -w / 2 + (w * i) / fins;
    line(ctx, x, -h / 2 + h * 0.18, x, h / 2 - h * 0.18);
  }
  ctx.globalAlpha = 0.6;
  ctx.stroke();
  ctx.globalAlpha = 1;

  anschlussPunkte(ctx, f);
};

/**
 * Die Anschlusspunkte unter dem Heizkörper.
 *
 * **Warum sie ins Symbol gehören.** Anschlussart und Ventilseite entscheiden,
 * auf welcher Seite die Leitung hochkommen muss. Wer das erst auf der
 * Baustelle merkt, hat den Estrich schon geschlossen. Zwei Punkte unter dem
 * Heizkörper kosten im Plan nichts und beantworten die Frage von selbst.
 *
 * Gezeichnet wird in Objektkoordinaten: −y ist die Wandseite, +y der Raum.
 * Der gefüllte Punkt ist das **Ventil** (Vorlauf), der offene der Rücklauf.
 * Fehlt die Angabe der Seite, wird kein Punkt gefüllt — eine erfundene Seite
 * wäre schlimmer als keine.
 */
function anschlussPunkte(ctx: Ctx, f: Fixture): void {
  const art = f.params.radiatorConnection;
  /*
   * Ohne Anschlussart wird trotzdem gezeichnet, sobald eine Ventilseite
   * eingetragen ist.
   *
   * **Der Fehler, den das verhindert.** Wer im Inspektor nur „Ventil links"
   * einträgt — weil er auf der Baustelle genau das gesehen hat und die
   * Anschlussart noch nicht kennt —, sah im Plan bisher gar nichts. Die
   * Angabe war erfasst, aber unsichtbar, und beim nächsten Aufmaß wurde sie
   * ein zweites Mal aufgenommen. Fehlt die Anschlussart, gilt das
   * Regelpaar an den Enden; das ist eine Darstellung, keine Behauptung
   * über die Anschlussart, und der Inspektor zeigt sie weiterhin als leer.
   */
  if (!art && !f.params.valveSide) return;
  const w = f.length;
  const h = f.depth;
  const y = h / 2 + Math.min(0.045, h * 0.45);
  const r = Math.min(0.028, w * 0.05);

  // Wo die beiden Anschlüsse sitzen — in Bruchteilen der Baulänge.
  const paare: Record<string, [number, number]> = {
    // Mittelanschluss: 50 mm auseinander, mittig.
    mitte: [-0.025 / w, 0.025 / w],
    // Seitenanschluss unten beidseitig: an den Enden, ein Zehntel eingerückt.
    unten: [-0.4, 0.4],
    // Gleichseitig und wechselseitig: oben/unten an einer bzw. beiden Seiten;
    // im Grundriss ist davon nur die Seite zu sehen.
    gleichseitig: [-0.4, -0.32],
    wechselseitig: [-0.4, 0.4],
  };
  const [a, b] = (art ? paare[art] : undefined) ?? [-0.4, 0.4];
  // Das Ventil sitzt auf der angegebenen Seite; ohne Angabe bleibt beides offen.
  const ventilLinks = f.params.valveSide === 'links';
  const ventilRechts = f.params.valveSide === 'rechts';

  for (const [t, istLinks] of [[a, a <= b], [b, b < a]] as [number, boolean][]) {
    const gefuellt = (istLinks && ventilLinks) || (!istLinks && ventilRechts);
    ctx.beginPath();
    ctx.arc(t * w, y, r, 0, Math.PI * 2);
    if (gefuellt) ctx.fill();
    else ctx.stroke();
  }
}

const drawRadiatorTube: SymbolDrawer = (ctx, f) => {
  const w = f.length;
  const h = f.depth;
  const tubes = Math.max(3, Math.round(w / 0.08));
  ctx.beginPath();
  for (let i = 0; i < tubes; i++) {
    const x = -w / 2 + (w * (i + 0.5)) / tubes;
    ctx.moveTo(x + h * 0.22, 0);
    ctx.arc(x, 0, h * 0.22, 0, Math.PI * 2);
  }
  ctx.stroke();
  ctx.beginPath();
  line(ctx, -w / 2, -h / 2, w / 2, -h / 2);
  line(ctx, -w / 2, h / 2, w / 2, h / 2);
  ctx.stroke();

  anschlussPunkte(ctx, f);
};

const drawConvector: SymbolDrawer = (ctx, f) => {
  const w = f.length;
  const h = f.depth;
  ctx.beginPath();
  rect(ctx, w, h);
  ctx.stroke();
  ctx.beginPath();
  const bars = Math.max(4, Math.round(w / 0.1));
  for (let i = 1; i < bars; i++) {
    const x = -w / 2 + (w * i) / bars;
    line(ctx, x, -h / 2, x + h * 0.35, h / 2);
  }
  ctx.globalAlpha = 0.5;
  ctx.stroke();
  ctx.globalAlpha = 1;
};

const drawUnderfloor: SymbolDrawer = (ctx, f) => {
  const w = f.length;
  const h = f.depth;
  ctx.beginPath();
  ctx.setLineDash([0.06, 0.05]);
  rect(ctx, w, h);
  ctx.stroke();
  ctx.setLineDash([]);

  // Mäander — die kanonische Darstellung eines Heizkreises
  ctx.beginPath();
  const loops = 4;
  const step = h / (loops * 2);
  let y = -h / 2 + step;
  ctx.moveTo(-w / 2 + step, y);
  for (let i = 0; i < loops; i++) {
    ctx.lineTo(w / 2 - step, y);
    y += step;
    ctx.lineTo(w / 2 - step, y);
    ctx.lineTo(-w / 2 + step, y);
    y += step;
    if (i < loops - 1) ctx.lineTo(-w / 2 + step, y);
  }
  ctx.stroke();
};

const drawManifold: SymbolDrawer = (ctx, f) => {
  const w = f.length;
  const h = f.depth;
  ctx.beginPath();
  rect(ctx, w, h);
  ctx.stroke();
  ctx.beginPath();
  const teeth = Math.max(4, Math.round(w / 0.08));
  for (let i = 0; i < teeth; i++) {
    const x = -w / 2 + (w * (i + 0.5)) / teeth;
    line(ctx, x, h / 2, x, h / 2 + h * 0.5);
  }
  ctx.stroke();
};

const drawBoiler: SymbolDrawer = (ctx, f) => {
  const w = f.length;
  const h = f.depth;
  ctx.beginPath();
  rect(ctx, w, h);
  ctx.stroke();
  // Flammensymbol
  ctx.beginPath();
  const r = Math.min(w, h) * 0.22;
  ctx.moveTo(0, r);
  ctx.quadraticCurveTo(-r, 0, 0, -r);
  ctx.quadraticCurveTo(r, 0, 0, r);
  ctx.stroke();
};

/**
 * Der Speicher: stehender Behälter mit Schichtungslinien.
 *
 * Drei waagerechte Linien, unten enger als oben — das ist die übliche
 * Kurzschrift für einen geschichteten Speicher und unterscheidet ihn auf
 * einen Blick vom Erzeuger daneben, der ein Flammensymbol trägt.
 */
const drawStorage: SymbolDrawer = (ctx, f) => {
  const w = f.length;
  const h = f.depth;
  ctx.beginPath();
  rect(ctx, w, h);
  ctx.stroke();
  ctx.beginPath();
  for (const t of [-0.26, 0, 0.28]) {
    ctx.moveTo(-w * 0.32, h * t);
    ctx.lineTo(w * 0.32, h * t);
  }
  ctx.stroke();
};

const drawRiser: SymbolDrawer = (ctx, f) => {
  const r = Math.max(f.length, f.depth) / 2;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  line(ctx, -r * 0.72, -r * 0.72, r * 0.72, r * 0.72);
  line(ctx, -r * 0.72, r * 0.72, r * 0.72, -r * 0.72);
  ctx.stroke();
};

const drawThermostat: SymbolDrawer = (ctx, f, s) => {
  const r = Math.max(f.length, f.depth) / 2;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.save();
  ctx.scale(1 / s, 1 / s); // Text in Bildschirmmaß, sonst skaliert er mit
  ctx.font = '600 8px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('T', 0, 0.5);
  ctx.restore();
};

// ---------------------------------------------------------------------------
// Sanitär
// ---------------------------------------------------------------------------

const roundedRect = (ctx: Ctx, w: number, h: number, r: number) => {
  const x = -w / 2;
  const y = -h / 2;
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
};

const drawWc: SymbolDrawer = (ctx, f) => {
  const w = f.length;
  const h = f.depth;
  // Spülkasten an der Wandseite
  ctx.beginPath();
  ctx.rect(-w / 2, -h / 2, w, h * 0.22);
  ctx.stroke();
  // Becken
  ctx.beginPath();
  ctx.ellipse(0, h * 0.12, w * 0.42, h * 0.34, 0, 0, Math.PI * 2);
  ctx.stroke();
};

const drawWashbasin: SymbolDrawer = (ctx, f) => {
  const w = f.length;
  const h = f.depth;
  ctx.beginPath();
  roundedRect(ctx, w, h, Math.min(w, h) * 0.22);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(0, h * 0.08, w * 0.3, h * 0.26, 0, 0, Math.PI * 2);
  ctx.stroke();
  // Armatur
  ctx.beginPath();
  ctx.arc(0, -h * 0.32, Math.min(w, h) * 0.06, 0, Math.PI * 2);
  ctx.stroke();
};

const drawShower: SymbolDrawer = (ctx, f) => {
  const w = f.length;
  const h = f.depth;
  ctx.beginPath();
  rect(ctx, w, h);
  ctx.stroke();
  ctx.beginPath();
  line(ctx, -w / 2, -h / 2, w / 2, h / 2);
  line(ctx, -w / 2, h / 2, w / 2, -h / 2);
  ctx.globalAlpha = 0.55;
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.arc(0, 0, Math.min(w, h) * 0.08, 0, Math.PI * 2);
  ctx.stroke();
};

const drawBathtub: SymbolDrawer = (ctx, f) => {
  const w = f.length;
  const h = f.depth;
  ctx.beginPath();
  roundedRect(ctx, w, h, Math.min(w, h) * 0.18);
  ctx.stroke();
  ctx.beginPath();
  roundedRect(ctx, w * 0.88, h * 0.76, Math.min(w, h) * 0.14);
  ctx.globalAlpha = 0.6;
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.arc(-w * 0.36, 0, Math.min(w, h) * 0.07, 0, Math.PI * 2);
  ctx.stroke();
};

const drawSink: SymbolDrawer = (ctx, f) => {
  const w = f.length;
  const h = f.depth;
  ctx.beginPath();
  rect(ctx, w, h);
  ctx.stroke();
  ctx.beginPath();
  roundedRect(ctx, w * 0.42, h * 0.62, 0.03);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(w * 0.26, 0, Math.min(w, h) * 0.06, 0, Math.PI * 2);
  ctx.stroke();
};

/**
 * Küchenzeile — Korpuskante, Arbeitsplattenkante, Schrankfugen.
 *
 * Gezeichnet wird die Zeile so, wie sie im Möbelplan steht: der Umriss des
 * Korpus, die vorstehende Arbeitsplatte als zweite Linie an der Raumseite und
 * die Fugen zwischen den Schrankelementen. Die Fugen sind nicht Zierat — an
 * ihnen erkennt man im Plan die Länge der Zeile, ohne zu messen. Ihr Abstand
 * folgt dem Rastermaß 60 cm; bei einer kurzen Zeile bleibt eine Fuge übrig,
 * und das ist richtig so.
 */
const drawKitchenUnit: SymbolDrawer = (ctx, f) => {
  const w = f.length;
  const h = Math.max(f.depth, 0.05);
  ctx.beginPath();
  rect(ctx, w, h);
  ctx.stroke();
  // Arbeitsplattenkante: die Zeile steht mit dem Rücken an der Wand, +y ist
  // die Bautiefe in den Raum hinein.
  ctx.beginPath();
  line(ctx, -w / 2, h / 2 - h * 0.12, w / 2, h / 2 - h * 0.12);
  ctx.globalAlpha = 0.6;
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.beginPath();
  const raster = 0.6;
  for (let x = -w / 2 + raster; x < w / 2 - 1e-6; x += raster) {
    line(ctx, x, -h / 2, x, h / 2 - h * 0.12);
  }
  ctx.globalAlpha = 0.45;
  ctx.stroke();
  ctx.globalAlpha = 1;
};

const drawWaterHeater: SymbolDrawer = (ctx, f) => {
  const r = Math.min(f.length, f.depth) / 2;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  for (let i = -1; i <= 1; i++) {
    const y = i * r * 0.4;
    ctx.moveTo(-r * 0.6, y);
    ctx.quadraticCurveTo(-r * 0.2, y - r * 0.22, 0, y);
    ctx.quadraticCurveTo(r * 0.2, y + r * 0.22, r * 0.6, y);
  }
  ctx.stroke();
};

const drawFloorDrain: SymbolDrawer = (ctx, f) => {
  const w = Math.max(f.length, f.depth);
  ctx.beginPath();
  rect(ctx, w, w);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, w * 0.3, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  line(ctx, -w * 0.3, 0, w * 0.3, 0);
  line(ctx, 0, -w * 0.3, 0, w * 0.3);
  ctx.stroke();
};

// ---------------------------------------------------------------------------
// Lüftung
// ---------------------------------------------------------------------------

/** Zu- und Abluft unterscheiden sich nur durch die Pfeilrichtung. */
const airValve = (inward: boolean): SymbolDrawer => (ctx, f) => {
  const r = Math.max(f.length, f.depth) / 2;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.45, 0, Math.PI * 2);
  ctx.stroke();

  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    const inner = r * 0.5;
    const outer = r * 1.5;
    const x1 = Math.cos(a) * (inward ? outer : inner);
    const y1 = Math.sin(a) * (inward ? outer : inner);
    const x2 = Math.cos(a) * (inward ? inner : outer);
    const y2 = Math.sin(a) * (inward ? inner : outer);
    line(ctx, x1, y1, x2, y2);
    arrowHead(ctx, x2, y2, Math.atan2(y2 - y1, x2 - x1), r * 0.42);
  }
  ctx.stroke();
};

const drawAirTransfer: SymbolDrawer = (ctx, f) => {
  const w = f.length;
  const h = Math.max(f.depth, 0.06);
  ctx.beginPath();
  rect(ctx, w, h);
  ctx.stroke();
  ctx.beginPath();
  line(ctx, -w * 0.3, 0, w * 0.3, 0);
  arrowHead(ctx, w * 0.3, 0, 0, h * 1.1);
  ctx.stroke();
};

const drawAhu: SymbolDrawer = (ctx, f) => {
  const w = f.length;
  const h = f.depth;
  ctx.beginPath();
  rect(ctx, w, h);
  ctx.stroke();
  // Ventilatorsymbol
  const r = Math.min(w, h) * 0.3;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    const a = (i * Math.PI * 2) / 3;
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.stroke();
};

const drawDuct: SymbolDrawer = (ctx, f) => {
  const w = f.length;
  const h = f.depth;
  ctx.beginPath();
  line(ctx, -w / 2, -h / 2, w / 2, -h / 2);
  line(ctx, -w / 2, h / 2, w / 2, h / 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.setLineDash([0.08, 0.06]);
  line(ctx, -w / 2, 0, w / 2, 0);
  ctx.globalAlpha = 0.6;
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const DRAWERS: Record<FixtureType, SymbolDrawer> = {
  radiator: drawRadiator,
  'radiator-tube': drawRadiatorTube,
  convector: drawConvector,
  underfloor: drawUnderfloor,
  manifold: drawManifold,
  boiler: drawBoiler,
  storage: drawStorage,
  'riser-heating': drawRiser,
  thermostat: drawThermostat,
  wc: drawWc,
  washbasin: drawWashbasin,
  shower: drawShower,
  bathtub: drawBathtub,
  sink: drawSink,
  'kitchen-unit': drawKitchenUnit,
  'water-heater': drawWaterHeater,
  'riser-sanitary': drawRiser,
  'floor-drain': drawFloorDrain,
  'air-supply': airValve(false),
  'air-exhaust': airValve(true),
  'air-transfer': drawAirTransfer,
  ahu: drawAhu,
  duct: drawDuct,
};

/**
 * Zeichnet ein TGA-Objekt an seiner Weltposition.
 *
 * @param sx  Welt→Screen für x
 * @param sy  Welt→Screen für y
 * @param zoom Bildschirmpixel pro Meter
 */
export function drawFixture(
  ctx: Ctx,
  fixture: Fixture,
  sx: (x: number) => number,
  sy: (y: number) => number,
  zoom: number,
  state: { selected: boolean; hovered: boolean },
): void {
  const drawer = DRAWERS[fixture.type];
  if (!drawer) return;

  const color = FIXTURE_COLORS[fixture.category];
  ctx.save();
  ctx.translate(sx(fixture.position.x), sy(fixture.position.y));
  // Screen-y zeigt nach unten, Modell-y nach oben → Drehsinn spiegeln.
  ctx.rotate(-(fixture.rotation * Math.PI) / 180);
  ctx.scale(zoom, zoom);

  ctx.strokeStyle = state.selected ? '#FFFFFF' : color;
  ctx.fillStyle = state.selected ? '#FFFFFF' : color;
  ctx.lineWidth = (state.selected ? 2 : state.hovered ? 1.6 : 1.2) / zoom;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // Dezente Hinterlegung, damit das Symbol auch über Raumflächen liest
  ctx.save();
  ctx.globalAlpha = state.selected ? 0.2 : 0.1;
  ctx.fillStyle = color;
  ctx.beginPath();
  rect(ctx, fixture.length * 1.06, fixture.depth * 1.06);
  ctx.fill();
  ctx.restore();

  drawer(ctx, fixture, zoom);
  ctx.restore();

  // Kennwert unter dem Symbol — nur wenn genug Platz ist.
  const badge = fixtureBadge(fixture);
  if (badge && zoom > 38) {
    ctx.save();
    ctx.font = '500 9px JetBrains Mono, ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const x = sx(fixture.position.x);
    const y = sy(fixture.position.y) + (Math.max(fixture.depth, 0.2) / 2) * zoom + 3;
    const w = ctx.measureText(badge).width + 6;
    ctx.fillStyle = 'rgba(11,17,32,0.8)';
    ctx.fillRect(x - w / 2, y - 1, w, 12);
    ctx.fillStyle = color;
    ctx.fillText(badge, x, y);
    ctx.restore();
  }
}

/**
 * Zeichnet die Verlegekurve einer raumfüllenden Fußbodenheizung.
 *
 * Eigene Routine und kein Symbol-Zeichner: ein Symbol wird um seine Mitte
 * gedreht und skaliert, diese Kurve liegt dagegen schon in Weltkoordinaten —
 * sie *ist* die Geometrie und nicht deren Stellvertreter.
 *
 * Dünn und halbdurchsichtig, weil sie den halben Grundriss bedeckt: der Plan
 * muss darunter lesbar bleiben. Ein Kurvenstück, das nicht angeschlossen
 * werden konnte, wird gestrichelt — dann sieht man im Bild, was in der
 * Meldung steht.
 */
export function drawFloorLoops(
  ctx: Ctx,
  layout: FloorLoopLayout,
  sx: (x: number) => number,
  sy: (y: number) => number,
  zoom: number,
  state: { selected: boolean; badge: string | null; anchor: Vec2 },
): void {
  if (layout.curves.length === 0) return;
  const color = FIXTURE_COLORS.heating;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = state.selected ? '#FFFFFF' : color;
  ctx.lineWidth = state.selected ? 1.6 : 1;
  ctx.globalAlpha = state.selected ? 0.95 : 0.7;

  // Zuerst die Anbindeleitungen, damit die Verlegekurve darüber liegt: im
  // Raum ist die Kurve die Aussage, die Anbindung nur der Weg dorthin.
  //
  // Gezeichnet als *eine* Linie, obwohl zwei Rohre laufen — Vor- und Rücklauf
  // liegen im Bündel nebeneinander und wären im Maßstab eines Grundrisses
  // nicht zu unterscheiden. Dass beide zählen, steht in der Beschriftung.
  //
  // Fein gestrichelt und stark zurückgenommen, und das ist keine Frage des
  // Geschmacks: die Linie ist die *kürzeste Verbindung*, nicht die verlegte
  // Trasse. Eine kräftige Volllinie quer durch eine Wand würde eine Führung
  // behaupten, die niemand geplant hat. So gezeichnet sagt sie, was sie ist —
  // eine schematische Zuordnung „dieser Kreis hängt an diesem Verteiler".
  ctx.save();
  ctx.setLineDash([1.5, 3]);
  ctx.globalAlpha = state.selected ? 0.55 : 0.28;
  ctx.lineWidth = state.selected ? 1.2 : 0.8;
  for (const zuleitung of layout.supplyLines) {
    ctx.beginPath();
    zuleitung.points.forEach((q, i) => {
      const x = sx(q.x);
      const y = sy(q.y);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    // Ein Ring am Verteiler: er macht sichtbar, wo der Kreis anfängt, ohne
    // eine zweite Beschriftung zu brauchen.
    const start = zuleitung.points[0];
    if (start) {
      ctx.beginPath();
      ctx.arc(sx(start.x), sy(start.y), 3, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.restore();

  for (const curve of layout.curves) {
    // Gestrichelt wird ein Kurvenstück nur, solange es *keine* Anbindung hat.
    // Steht ein Verteiler, bekommt jedes Stück eine eigene Anbindeleitung —
    // dass ein Raum in drei Stücke zerfällt, heißt dann drei Anbindungen und
    // nicht drei lose Enden, und die Kurven sind durchgezogen. Ohne Verteiler
    // ist jedes Stück jenseits des ersten ein Rest ohne Anschluss, und genau
    // das soll man sehen. Alles zu stricheln würde die Aussage entwerten —
    // dann sähe eine saubere Verlegung aus wie eine offene Baustelle.
    ctx.setLineDash(curve.part > 1 && !layout.manifoldConnected ? [4, 3] : []);
    ctx.beginPath();
    const pts = curve.points;
    for (let i = 0; i < pts.length; i++) {
      const x = sx(pts[i].x);
      const y = sy(pts[i].y);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();

  if (state.badge && zoom > 22) {
    ctx.save();
    ctx.font = '500 9px JetBrains Mono, ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const x = sx(state.anchor.x);
    // Unter dem Raumlabel: der Ankerpunkt ist der Raumschwerpunkt, und dort
    // steht bereits Name, Fläche und Volumen. 34 Bildpunkte sind der Abstand,
    // der den dreizeiligen Raumeintrag freistellt — ein Maß der Ansicht,
    // deshalb in Bildpunkten und nicht in Metern.
    const y = sy(state.anchor.y) + 34;
    const w = ctx.measureText(state.badge).width + 8;
    ctx.fillStyle = 'rgba(11,17,32,0.85)';
    ctx.fillRect(x - w / 2, y - 7, w, 14);
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1;
    ctx.strokeRect(x - w / 2, y - 7, w, 14);
    ctx.globalAlpha = 1;
    ctx.fillStyle = color;
    ctx.fillText(state.badge, x, y);
    ctx.restore();
  }
}

/**
 * Beschriftung einer Flächenbelegung: die drei Zahlen, die auf dem Plan
 * gebraucht werden — Verlegeabstand, Kreiszahl, Leistung.
 */
export function floorLoopBadge(fixture: Fixture, layout: FloorLoopLayout): string {
  const abstand = Math.round((fixture.params.loopSpacing ?? layout.spacing) * 100);
  const kreise = fixture.params.loopCount ?? layout.loops;
  const teile: string[] = [`VA ${abstand} cm`, `${kreise} ${kreise === 1 ? 'Kreis' : 'Kreise'}`];
  if (fixture.params.powerW) teile.push(`${fixture.params.powerW.toLocaleString('de-DE')} W`);
  // Die Kreislänge steht nur dort, wo sie vollständig ist: ohne Verteiler
  // fehlt die Anbindeleitung, und eine Länge, die zu kurz ist, ist im Plan
  // schlimmer als gar keine. Der fehlende Verteiler steht in den Hinweisen.
  if (layout.manifoldConnected && layout.circuitLength > 0) {
    teile.push(`${Math.round(layout.circuitLength)} m`);
  }
  return teile.join(' · ');
}

/** Trefferprüfung für die Selektion — achsparallel im Symbolkoordinatensystem. */
export function hitTestFixture(fixture: Fixture, point: { x: number; y: number }, padding = 0): boolean {
  const rad = (fixture.rotation * Math.PI) / 180;
  const dx = point.x - fixture.position.x;
  const dy = point.y - fixture.position.y;
  const lx = dx * Math.cos(rad) + dy * Math.sin(rad);
  const ly = -dx * Math.sin(rad) + dy * Math.cos(rad);
  return (
    Math.abs(lx) <= fixture.length / 2 + padding && Math.abs(ly) <= Math.max(fixture.depth, 0.12) / 2 + padding
  );
}
