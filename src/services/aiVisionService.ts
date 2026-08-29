/**
 * aiVisionService — typisierte Anbindung an Vision-Backends.
 * ---------------------------------------------------------------------------
 * Ziel dieses Moduls: die Anwendung kennt *nur* das Interface
 * `FloorplanVisionProvider`. Ob dahinter SAM 2 (Segmentierung), YOLOv8
 * (Objekt-Detection für Türen/Fenster), Claude Vision (semantisches Lesen von
 * Raumstempeln und Maßketten) oder eine eigene Pipeline steckt, ist für den
 * Editor unsichtbar und jederzeit austauschbar.
 *
 * WICHTIG — Koordinatenvertrag:
 * Alle Provider liefern Koordinaten in **Bildpixeln der Originalauflösung**.
 * Die Umrechnung in Modellmeter passiert ausschließlich im Client über
 * `FloorplanImage.scale` (Ergebnis der Kalibrierung). Dadurch bleibt die
 * KI-Seite maßstabsagnostisch — ein neu kalibriertes Bild erfordert keinen
 * erneuten Vision-Call.
 *
 * Sicherheit: API-Schlüssel gehören NIE in den Browser. `HttpVisionProvider`
 * spricht deshalb einen serverseitigen Proxy an (`/api/vision/floorplan`),
 * der die Anmeldedaten hält.
 */

import type {
  AiDetectedDimension,
  AiDetectedOpening,
  AiDetectedRoomLabel,
  AiDetectedWall,
  AiFloorplanAnalysis,
  Vec2,
} from '../types/bim';

// ---------------------------------------------------------------------------
// Provider-Vertrag
// ---------------------------------------------------------------------------

export type VisionModelId =
  | 'mock-architect-v1'
  | 'sam2-hiera-large'
  | 'yolov8-floorplan'
  | 'claude-vision-floorplan'
  | (string & {});

export interface VisionAnalyzeRequest {
  /** Bilddaten als Data-URL oder Object-URL. */
  imageSrc: string;
  imageName: string;
  naturalWidth: number;
  naturalHeight: number;
  /**
   * Bereits bekannter Maßstab [m/px]. Optional — hilft dem Modell, plausible
   * Wandstärken zu filtern (eine "Wand" von 3 m Dicke ist mit Sicherheit ein
   * Erkennungsfehler).
   */
  knownScale?: number;
  /** Welche Klassen erkannt werden sollen. */
  detect?: {
    walls?: boolean;
    openings?: boolean;
    roomLabels?: boolean;
    dimensions?: boolean;
  };
  /** Erkennungen unterhalb dieser Konfidenz werden serverseitig verworfen. */
  minConfidence?: number;
  signal?: AbortSignal;
}

export interface VisionProgress {
  /** 0..1 */
  progress: number;
  /** Menschlich lesbare Stufe für die Statuszeile. */
  stage: string;
}

export interface FloorplanVisionProvider {
  readonly id: VisionModelId;
  readonly label: string;
  /** Kurzbeschreibung für die UI. */
  readonly description: string;
  analyze(
    request: VisionAnalyzeRequest,
    onProgress?: (p: VisionProgress) => void,
  ): Promise<AiFloorplanAnalysis>;
}

export class VisionError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'VisionError';
  }
}

// ---------------------------------------------------------------------------
// HTTP-Provider (Produktion) — spricht den eigenen Server-Proxy an
// ---------------------------------------------------------------------------

export interface HttpVisionProviderOptions {
  endpoint?: string;
  id?: VisionModelId;
  label?: string;
  description?: string;
  headers?: Record<string, string>;
}

export class HttpVisionProvider implements FloorplanVisionProvider {
  readonly id: VisionModelId;
  readonly label: string;
  readonly description: string;
  private readonly endpoint: string;
  private readonly headers: Record<string, string>;

  constructor(options: HttpVisionProviderOptions = {}) {
    this.endpoint = options.endpoint ?? '/api/vision/floorplan';
    this.id = options.id ?? 'claude-vision-floorplan';
    this.label = options.label ?? 'Vision-Proxy';
    this.description =
      options.description ?? 'Serverseitiger Proxy — hält den API-Schlüssel außerhalb des Browsers.';
    this.headers = options.headers ?? {};
  }

  async analyze(
    request: VisionAnalyzeRequest,
    onProgress?: (p: VisionProgress) => void,
  ): Promise<AiFloorplanAnalysis> {
    const started = performance.now();
    onProgress?.({ progress: 0.05, stage: 'Bild wird übertragen' });

    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.headers },
        body: JSON.stringify({
          model: this.id,
          image: request.imageSrc,
          imageName: request.imageName,
          naturalWidth: request.naturalWidth,
          naturalHeight: request.naturalHeight,
          knownScale: request.knownScale,
          detect: request.detect ?? { walls: true, openings: true, roomLabels: true, dimensions: true },
          minConfidence: request.minConfidence ?? 0.4,
        }),
        signal: request.signal,
      });
    } catch (cause) {
      throw new VisionError('Vision-Proxy nicht erreichbar.', cause);
    }

    if (!response.ok) {
      throw new VisionError(`Vision-Proxy antwortete mit ${response.status} ${response.statusText}`);
    }

    onProgress?.({ progress: 0.9, stage: 'Antwort wird geprüft' });
    const raw: unknown = await response.json();
    const parsed = parseAnalysis(raw);
    return { ...parsed, durationMs: Math.round(performance.now() - started), modelId: this.id };
  }
}

// ---------------------------------------------------------------------------
// Validierung der Provider-Antwort
// ---------------------------------------------------------------------------

const num = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const point = (value: unknown): Vec2 => {
  const v = value as Partial<Vec2> | undefined;
  return { x: num(v?.x), y: num(v?.y) };
};

/**
 * Defensive Normalisierung: ein Vision-Modell liefert gelegentlich `null`,
 * fehlende Felder oder Ausreißer. Statt die App abstürzen zu lassen, wird
 * hier auf ein sauberes, vollständiges Objekt normalisiert.
 */
export function parseAnalysis(raw: unknown): AiFloorplanAnalysis {
  const r = (raw ?? {}) as Record<string, unknown>;

  const walls: AiDetectedWall[] = Array.isArray(r.walls)
    ? r.walls.map((w) => {
        const item = (w ?? {}) as Record<string, unknown>;
        return {
          start: point(item.start),
          end: point(item.end),
          thicknessPx: Math.max(1, num(item.thicknessPx, 8)),
          confidence: clamp01(num(item.confidence, 0.5)),
          type: item.type as AiDetectedWall['type'],
        };
      })
    : [];

  const openings: AiDetectedOpening[] = Array.isArray(r.openings)
    ? r.openings.map((o) => {
        const item = (o ?? {}) as Record<string, unknown>;
        return {
          kind: item.kind === 'door' ? 'door' : 'window',
          center: point(item.center),
          widthPx: Math.max(1, num(item.widthPx, 40)),
          confidence: clamp01(num(item.confidence, 0.5)),
          heightM: typeof item.heightM === 'number' ? item.heightM : undefined,
          sillHeightM: typeof item.sillHeightM === 'number' ? item.sillHeightM : undefined,
        };
      })
    : [];

  const roomLabels: AiDetectedRoomLabel[] = Array.isArray(r.roomLabels)
    ? r.roomLabels.map((l) => {
        const item = (l ?? {}) as Record<string, unknown>;
        return {
          text: typeof item.text === 'string' ? item.text : '',
          position: point(item.position),
          areaM2: typeof item.areaM2 === 'number' ? item.areaM2 : undefined,
          confidence: clamp01(num(item.confidence, 0.5)),
        };
      })
    : [];

  const dimensions: AiDetectedDimension[] = Array.isArray(r.dimensions)
    ? r.dimensions.map((d) => {
        const item = (d ?? {}) as Record<string, unknown>;
        return {
          from: point(item.from),
          to: point(item.to),
          valueM: num(item.valueM, 0),
          confidence: clamp01(num(item.confidence, 0.5)),
        };
      })
    : [];

  return {
    walls,
    openings,
    roomLabels,
    dimensions,
    suggestedScale: typeof r.suggestedScale === 'number' ? r.suggestedScale : deriveScale(dimensions),
    confidence: clamp01(num(r.confidence, averageConfidence(walls, openings))),
    durationMs: num(r.durationMs, 0),
    modelId: typeof r.modelId === 'string' ? r.modelId : 'unknown',
  };
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

function averageConfidence(walls: AiDetectedWall[], openings: AiDetectedOpening[]): number {
  const all = [...walls.map((w) => w.confidence), ...openings.map((o) => o.confidence)];
  if (!all.length) return 0;
  return all.reduce((a, b) => a + b, 0) / all.length;
}

/**
 * Leitet den Maßstab [m/px] aus erkannten Maßketten ab. Der Median ist hier
 * dem Mittelwert überlegen: eine einzelne falsch gelesene Maßzahl
 * (z. B. "5,00" als "500") würde den Mittelwert komplett verreißen.
 */
export function deriveScale(dimensions: AiDetectedDimension[]): number | undefined {
  const samples = dimensions
    .filter((d) => d.valueM > 0.05 && d.confidence > 0.35)
    .map((d) => {
      const px = Math.hypot(d.to.x - d.from.x, d.to.y - d.from.y);
      return px > 1 ? d.valueM / px : NaN;
    })
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);

  if (!samples.length) return undefined;
  const mid = samples.length >> 1;
  return samples.length % 2 ? samples[mid] : (samples[mid - 1] + samples[mid]) / 2;
}

// ---------------------------------------------------------------------------
// Mock-Provider (Entwicklung & Demo)
// ---------------------------------------------------------------------------

/** Deterministischer PRNG — gleiche Eingabe ⇒ gleiches Ergebnis, gut testbar. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new VisionError('Analyse abgebrochen'));
    });
  });

/**
 * Simuliert eine vollständige Erkennungs-Pipeline inklusive realistischer
 * Stufen, Laufzeiten und Konfidenzen. Erzeugt einen plausiblen Grundriss
 * (Außenhülle, tragende Innenwand, Trennwände, Türen, Fenster, Raumstempel,
 * eine Maßkette), damit der Auto-Trace-Workflow ohne Backend erlebbar ist.
 */
export class MockVisionProvider implements FloorplanVisionProvider {
  readonly id: VisionModelId = 'mock-architect-v1';
  readonly label = 'Mock-Erkennung';
  readonly description = 'Lokale Simulation der Vision-Pipeline — kein Netzwerk, deterministisch.';

  async analyze(
    request: VisionAnalyzeRequest,
    onProgress?: (p: VisionProgress) => void,
  ): Promise<AiFloorplanAnalysis> {
    const started = performance.now();
    const W = Math.max(200, request.naturalWidth);
    const H = Math.max(200, request.naturalHeight);
    const rnd = mulberry32(Math.round(W * 7919 + H * 104729));

    const stages: VisionProgress[] = [
      { progress: 0.12, stage: 'Vorverarbeitung · Entzerrung & Kontrast' },
      { progress: 0.34, stage: 'Semantische Segmentierung (SAM 2)' },
      { progress: 0.58, stage: 'Wandachsen-Skelettierung' },
      { progress: 0.76, stage: 'Öffnungs-Detection (YOLOv8)' },
      { progress: 0.9, stage: 'OCR · Raumstempel & Maßketten' },
    ];
    for (const stage of stages) {
      await wait(160 + rnd() * 220, request.signal);
      onProgress?.(stage);
    }

    // Bildinnenrand: 8 % Rand, wie er bei gescannten Plänen typisch ist.
    const m = Math.min(W, H) * 0.08;
    const x0 = m;
    const y0 = m;
    const x1 = W - m;
    const y1 = H - m;
    const tOuter = Math.max(6, Math.min(W, H) * 0.028);
    const tInner = tOuter * 0.55;

    // Innere Achsen mit leichter Streuung — echte Erkennungen sitzen nie exakt.
    const jitter = () => (rnd() - 0.5) * 2.5;
    const xSplit = x0 + (x1 - x0) * (0.58 + rnd() * 0.06);
    const ySplit = y0 + (y1 - y0) * (0.55 + rnd() * 0.08);

    const wall = (a: Vec2, b: Vec2, thicknessPx: number, confidence: number, type: AiDetectedWall['type']): AiDetectedWall => ({
      start: { x: a.x + jitter(), y: a.y + jitter() },
      end: { x: b.x + jitter(), y: b.y + jitter() },
      thicknessPx,
      confidence,
      type,
    });

    const walls: AiDetectedWall[] = [
      wall({ x: x0, y: y0 }, { x: x1, y: y0 }, tOuter, 0.96, 'exterior'),
      wall({ x: x1, y: y0 }, { x: x1, y: y1 }, tOuter, 0.95, 'exterior'),
      wall({ x: x1, y: y1 }, { x: x0, y: y1 }, tOuter, 0.94, 'exterior'),
      wall({ x: x0, y: y1 }, { x: x0, y: y0 }, tOuter, 0.95, 'exterior'),
      wall({ x: xSplit, y: y0 }, { x: xSplit, y: y1 }, tInner, 0.87, 'interior'),
      wall({ x: xSplit, y: ySplit }, { x: x1, y: ySplit }, tInner * 0.72, 0.71, 'partition'),
    ];

    const openings: AiDetectedOpening[] = [
      { kind: 'window', center: { x: x0 + (xSplit - x0) * 0.35, y: y0 }, widthPx: (x1 - x0) * 0.13, confidence: 0.91 },
      { kind: 'window', center: { x: x0 + (xSplit - x0) * 0.72, y: y0 }, widthPx: (x1 - x0) * 0.11, confidence: 0.88 },
      { kind: 'window', center: { x: x0, y: y0 + (y1 - y0) * 0.45 }, widthPx: (y1 - y0) * 0.16, confidence: 0.84 },
      { kind: 'window', center: { x: x1, y: y0 + (ySplit - y0) * 0.5 }, widthPx: (y1 - y0) * 0.12, confidence: 0.79 },
      { kind: 'door', center: { x: xSplit, y: y0 + (ySplit - y0) * 0.62 }, widthPx: (x1 - x0) * 0.075, confidence: 0.9, heightM: 2.01, sillHeightM: 0 },
      { kind: 'door', center: { x: xSplit + (x1 - xSplit) * 0.55, y: ySplit }, widthPx: (x1 - x0) * 0.065, confidence: 0.76, heightM: 2.01, sillHeightM: 0 },
      { kind: 'door', center: { x: x0 + (xSplit - x0) * 0.5, y: y1 }, widthPx: (x1 - x0) * 0.085, confidence: 0.82, heightM: 2.135, sillHeightM: 0 },
    ];

    const roomLabels: AiDetectedRoomLabel[] = [
      { text: 'Wohnen / Essen', position: { x: (x0 + xSplit) / 2, y: (y0 + y1) / 2 }, confidence: 0.81 },
      { text: 'Schlafen', position: { x: (xSplit + x1) / 2, y: (y0 + ySplit) / 2 }, confidence: 0.74 },
      { text: 'Bad', position: { x: (xSplit + x1) / 2, y: (ySplit + y1) / 2 }, confidence: 0.69 },
    ];

    // Simulierte Maßkette über die gesamte Südfassade: 10,00 m.
    const dimensions: AiDetectedDimension[] = [
      { from: { x: x0, y: y1 + m * 0.45 }, to: { x: x1, y: y1 + m * 0.45 }, valueM: 10, confidence: 0.86 },
    ];

    onProgress?.({ progress: 1, stage: 'Fertig' });

    return {
      walls,
      openings,
      roomLabels,
      dimensions,
      suggestedScale: deriveScale(dimensions),
      confidence: 0.85,
      durationMs: Math.round(performance.now() - started),
      modelId: this.id,
    };
  }
}

// ---------------------------------------------------------------------------
// Fallback-Provider
// ---------------------------------------------------------------------------

/**
 * Versucht zuerst den echten Proxy und fällt bei Nichterreichbarkeit auf die
 * lokale Simulation zurück. Das ist kein Notnagel, sondern bewusstes
 * Produktverhalten: der Auto-Trace-Workflow bleibt in Demo-, Offline- und
 * Preview-Umgebungen vollständig bedienbar — sichtbar gekennzeichnet über
 * `modelId`, damit niemand Mock-Ergebnisse für echte Erkennung hält.
 */
export class FallbackVisionProvider implements FloorplanVisionProvider {
  readonly id: VisionModelId = 'auto';
  readonly label = 'Vision-Proxy (Fallback: Simulation)';
  readonly description =
    'Nutzt den serverseitigen Vision-Proxy; ist er nicht erreichbar, übernimmt die lokale Simulation.';

  constructor(
    private readonly primary: FloorplanVisionProvider,
    private readonly fallback: FloorplanVisionProvider,
  ) {}

  async analyze(
    request: VisionAnalyzeRequest,
    onProgress?: (p: VisionProgress) => void,
  ): Promise<AiFloorplanAnalysis> {
    try {
      return await this.primary.analyze(request, onProgress);
    } catch (error) {
      if (request.signal?.aborted) throw error;
      onProgress?.({ progress: 0.1, stage: 'Proxy nicht erreichbar — lokale Simulation' });
      const result = await this.fallback.analyze(request, onProgress);
      return { ...result, modelId: `${result.modelId} (Fallback)` };
    }
  }
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const VISION_PROVIDERS: Record<string, FloorplanVisionProvider> = {
  mock: new MockVisionProvider(),
  proxy: new HttpVisionProvider(),
  sam2: new HttpVisionProvider({
    id: 'sam2-hiera-large',
    label: 'SAM 2 · Segmentierung',
    description: 'Maskenbasierte Wandsegmentierung mit anschließender Skelettierung.',
  }),
  yolo: new HttpVisionProvider({
    id: 'yolov8-floorplan',
    label: 'YOLOv8 · Öffnungen',
    description: 'Objekt-Detection speziell für Tür- und Fenstersymbole.',
  }),
};

VISION_PROVIDERS.auto = new FallbackVisionProvider(
  VISION_PROVIDERS.proxy,
  VISION_PROVIDERS.mock,
);

/**
 * Wählt den Provider. Standard ist `auto` (Proxy mit Simulations-Fallback);
 * über `VITE_VISION_PROVIDER=mock|proxy|sam2|yolo` fest vorgebbar.
 */
export function getVisionProvider(): FloorplanVisionProvider {
  const configured = import.meta.env?.VITE_VISION_PROVIDER;
  if (configured && VISION_PROVIDERS[configured]) return VISION_PROVIDERS[configured];
  return VISION_PROVIDERS.auto;
}
