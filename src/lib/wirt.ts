/**
 * Was der Wirt kann — RaVia, wenn CAD Light eingebettet ist.
 * ---------------------------------------------------------------------------
 * Seit Embed-API 1.9.0 (CAD Light 1.74.0) teilt der Wirt mit, was er selbst
 * übernimmt: `{ channel: 'ravia-cad', type: 'setHostCapabilities',
 * payload: { scan: true } }`. Dann öffnet der Knopf „Mit RaVia Scan
 * scannen" **RaVias** Dialog — er hat Anmeldung und Projekt, legt die
 * Sitzung im Projekt an und reicht den Scan mit `loadBuilding` herein, wie
 * seit Update 309. CAD Light schickt dafür das Ereignis `scanRequested` an
 * alle angemeldeten Wirte.
 *
 * Ohne diese Mitteilung zeigt CAD Light seinen eigenen Dialog. Ein Wirt, der
 * die Fähigkeit nicht meldet, verliert also nichts: Es bleibt beim Verhalten
 * von 1.72.0 plus dem eigenen Weg.
 */

export interface WirtFaehigkeiten {
  scan: boolean;
}

let faehigkeiten: WirtFaehigkeiten = { scan: false };
let melder: ((type: string, payload: unknown) => number) | null = null;

export function setzeWirtFaehigkeiten(f: unknown): WirtFaehigkeiten {
  const o = (f ?? {}) as Record<string, unknown>;
  faehigkeiten = { scan: o.scan === true };
  return { ...faehigkeiten };
}

/** Die Einbettung hinterlegt hier, wie sie an die Wirte sendet (gibt die Zahl der Empfänger zurück). */
export function registriereWirtMelder(fn: ((type: string, payload: unknown) => number) | null): void {
  melder = fn;
}

/**
 * Den Scan beim Wirt anfordern. `true`, wenn mindestens ein Wirt mit der
 * Fähigkeit `scan` die Nachricht bekommen hat — sonst übernimmt der eigene
 * Dialog.
 */
export function scanBeimWirtAnfordern(): boolean {
  if (!faehigkeiten.scan || !melder) return false;
  return melder('scanRequested', { at: new Date().toISOString() }) > 0;
}

/** Nur für den Prüflauf: Ausgangszustand. */
export function wirtZuruecksetzen(): void {
  faehigkeiten = { scan: false };
  melder = null;
}
