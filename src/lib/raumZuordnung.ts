/**
 * Gespeicherte Raumangaben wieder ihrem Raum zuordnen — geschossweise.
 * ---------------------------------------------------------------------------
 * **Der Fehler, der dieses Modul nötig gemacht hat.** Beim Öffnen einer
 * Projektdatei werden die Räume neu erkannt; ihre Kennungen können sich dabei
 * ändern. Name, Nutzung, Solltemperatur, „beheizt" und eine von RaVia
 * gerechnete Heizlast wurden deshalb über den **Schwerpunkt** wieder
 * zugeordnet: Welcher erkannte Raum enthält den Schwerpunkt des gespeicherten?
 *
 * Das ist in einem Geschoss richtig und über mehrere Geschosse falsch. Bei
 * übereinanderliegenden Grundrissen — dem Normalfall — liegt der Schwerpunkt
 * des Schlafzimmers im OG genau über dem Wohnzimmer im EG. Gesucht wurde in
 * *allen* Räumen des Dokuments, und gefunden wurde der erste passende. Nach
 * Speichern und Öffnen hieß das: Namen aus dem OG im EG, der Keller plötzlich
 * beheizt, die Heizlast des Obergeschosses im Erdgeschoss. Gemeldet am
 * 22.09.2026 aus einem Testlauf mit mehrgeschossigen Gebäuden.
 *
 * **Die Regel hier**, in dieser Reihenfolge:
 *
 *  1. **Geschoss zuerst.** Ein gespeicherter Raum wird nur mit Räumen
 *     desselben Geschosses verglichen. Das Geschoss steht in der Datei als
 *     `levelId`, als Geschossname (`level`, so schreibt es der Export) oder
 *     steckt in der Kennung (`room-<levelId>-<n>`). Findet sich keines,
 *     bleibt die Suche über alle Geschosse — eine alte Datei ohne
 *     Geschossangabe soll weiter geladen werden können.
 *  2. **Schwerpunkt im Innenpolygon**, wie bisher.
 *  3. **Jeder erkannte Raum nur einmal.** Zwei gespeicherte Räume, die
 *     denselben erkannten Raum beanspruchen, sind ein Umbau; den Zuschlag
 *     bekommt der mit der ähnlicheren Fläche, danach der mit dem näheren
 *     Schwerpunkt, danach der mit gleicher Kennung. Ohne diese Regel
 *     überschrieb der letzte den ersten, still.
 *
 * Reine Funktion, kein Store, keine Oberfläche: So ist sie prüfbar.
 */

import type { Level, Room, Vec2 } from '../types/bim';
import { pointInPolygon } from './geometry';

/** Ein Raum, wie er in der Projektdatei steht — nur die Felder, die hier zählen. */
export interface GespeicherterRaum {
  id?: unknown;
  /** Geschosskennung, falls die Datei sie führt. */
  levelId?: unknown;
  /** Geschossname, so schreibt ihn der Export (`level: "EG"`). */
  level?: unknown;
  polygon?: unknown;
  area?: unknown;
}

/** Schwerpunkt als einfaches Mittel der Stützpunkte — wie in `roomDetection`. */
function schwerpunkt(polygon: readonly Vec2[]): Vec2 {
  let x = 0;
  let y = 0;
  for (const p of polygon) {
    x += p.x;
    y += p.y;
  }
  return { x: x / polygon.length, y: y / polygon.length };
}

function polygonVon(saved: GespeicherterRaum): Vec2[] | undefined {
  const p = saved.polygon;
  if (!Array.isArray(p) || p.length < 3) return undefined;
  const punkte = p.filter(
    (q): q is Vec2 => !!q && typeof (q as Vec2).x === 'number' && typeof (q as Vec2).y === 'number',
  );
  return punkte.length >= 3 ? punkte : undefined;
}

/**
 * Das Geschoss eines gespeicherten Raums bestimmen.
 *
 * Gibt `undefined` zurück, wenn die Datei nichts darüber sagt — dann wird wie
 * früher über alle Geschosse gesucht.
 */
export function geschossVon(
  saved: GespeicherterRaum,
  levels: Record<string, Level>,
): string | undefined {
  const ids = Object.keys(levels);

  const direkt = typeof saved.levelId === 'string' ? saved.levelId : undefined;
  if (direkt && levels[direkt]) return direkt;

  // Der Export schreibt den Geschoss*namen*. Nur eindeutige Namen zählen:
  // zwei Geschosse „EG" wären keine Zuordnung, sondern ein Münzwurf.
  const name = typeof saved.level === 'string' ? saved.level.trim().toLocaleLowerCase('de') : undefined;
  if (name) {
    const treffer = ids.filter((id) => levels[id].name.trim().toLocaleLowerCase('de') === name);
    if (treffer.length === 1) return treffer[0];
    // Der Name kann auch die Kennung selbst sein (`level: "eg"`).
    if (levels[saved.level as string]) return saved.level as string;
  }

  // Zuletzt die Kennung: `room-<levelId>-<n>`. Das längste passende Geschoss
  // gewinnt, sonst schluckt `eg` die Kennung `room-eg-og-1`.
  const id = typeof saved.id === 'string' ? saved.id : undefined;
  if (id?.startsWith('room-')) {
    const rest = id.slice('room-'.length);
    let beste: string | undefined;
    for (const levelId of ids) {
      if (!rest.startsWith(`${levelId}-`)) continue;
      if (!beste || levelId.length > beste.length) beste = levelId;
    }
    if (beste) return beste;
  }

  return undefined;
}

/**
 * Ordnet jedem gespeicherten Raum höchstens einen erkannten Raum zu — und
 * jedem erkannten Raum höchstens einen gespeicherten.
 *
 * Das Ergebnis ist parallel zu `gespeichert`: `undefined` heißt „kein Raum an
 * dieser Stelle", etwa weil der Grundriss dort inzwischen anders aussieht.
 */
export function ordneRaeumeZu(
  gespeichert: readonly GespeicherterRaum[],
  raeume: readonly Room[],
  levels: Record<string, Level>,
): (Room | undefined)[] {
  const ergebnis: (Room | undefined)[] = gespeichert.map(() => undefined);
  const vergeben = new Set<string>();

  /** Anwärter je erkanntem Raum: wer beansprucht ihn, und wie gut passt er? */
  const anspruch = new Map<string, { index: number; guete: [number, number, number] }[]>();

  gespeichert.forEach((saved, index) => {
    const polygon = polygonVon(saved);
    if (!polygon) return;
    const mitte = schwerpunkt(polygon);
    const levelId = geschossVon(saved, levels);
    const flaeche = typeof saved.area === 'number' ? saved.area : undefined;

    for (const raum of raeume) {
      if (levelId !== undefined && raum.levelId !== levelId) continue;
      if (raum.innerPolygon.length < 3) continue;
      if (!pointInPolygon(mitte, raum.innerPolygon)) continue;
      const guete: [number, number, number] = [
        // 1. ähnliche Fläche, 2. naher Schwerpunkt, 3. gleiche Kennung
        flaeche === undefined ? Number.MAX_VALUE : Math.abs(raum.area - flaeche),
        Math.hypot(raum.centroid.x - mitte.x, raum.centroid.y - mitte.y),
        saved.id === raum.id ? 0 : 1,
      ];
      const liste = anspruch.get(raum.id);
      if (liste) liste.push({ index, guete });
      else anspruch.set(raum.id, [{ index, guete }]);
      break; // Räume überlappen sich nicht: der erste Treffer ist der einzige.
    }
  });

  for (const [raumId, liste] of anspruch) {
    const raum = raeume.find((r) => r.id === raumId);
    if (!raum || vergeben.has(raumId)) continue;
    let bester = liste[0];
    for (const kandidat of liste.slice(1)) {
      for (let k = 0; k < 3; k++) {
        if (kandidat.guete[k] < bester.guete[k] - 1e-9) { bester = kandidat; break; }
        if (kandidat.guete[k] > bester.guete[k] + 1e-9) break;
      }
    }
    ergebnis[bester.index] = raum;
    vergeben.add(raumId);
  }

  return ergebnis;
}
