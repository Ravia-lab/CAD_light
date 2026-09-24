/**
 * Räume, die RaVia beim Übernehmen verworfen hat — sichtbar machen.
 * ---------------------------------------------------------------------------
 * **Der Anlass.** RaVias Schnittstelle `raeume-uebernehmen` lässt Räume unter
 * einer Mindestgröße (0,1 m²) weg, und bis zum Update 321 auch solche ohne
 * brauchbare Flächenangabe. Für den Anwender sah das aus wie nichts: Er
 * zeichnet zehn Räume, drüben kommen neun an, und niemand sagt welcher fehlt.
 * Genau danach sucht man am längsten — nach dem, was *nicht* da ist.
 *
 * Seit dem Update nennt RaVia die verworfenen Räume in derselben Antwort, in
 * der auch die übernommenen stehen. Dieses Modul macht daraus einen Hinweis
 * am gezeichneten Raum.
 *
 * **Die Form, auf die wir uns verständigt haben** (RaVia, 23.09.2026):
 *
 *     "verworfene_raeume": [
 *       { "id": "room-eg-7", "name": "Schacht", "flaeche": 0.06,
 *         "grund": "flaeche_unter_mindestgroesse", "geschoss": "EG" }
 *     ]
 *
 * `id` ist die Kennung aus **unserem** Export (`rooms[].id`), unverändert
 * durchgereicht — nur deshalb lässt sich der Hinweis an den gezeichneten Raum
 * hängen. Das Feld ist die ganze Verabredung; alles andere ist Beiwerk.
 *
 * **Warum das Lesen so nachsichtig ist.** Die Gegenstelle ist ein eigenes
 * Programm mit eigenem Zeitplan. Sie schreibt heute deutsche Feldnamen, sie
 * kann morgen englische schreiben, und sie kann einen Grund schicken, den wir
 * noch nicht kennen. Ein Hinweis, der dann ausbleibt, wäre schlimmer als ein
 * unvollständiger: Der Anwender stünde wieder vor dem Nichts. Deshalb werden
 * beide Schreibweisen gelesen, und ein unbekannter Grund wird angezeigt statt
 * verschluckt.
 *
 * Reine Funktionen, kein Store, keine Oberfläche.
 */

/** Ein verworfener Raum, so wie wir ihn führen — unabhängig von der Schreibweise. */
export interface VerworfenerRaum {
  /** Die Kennung aus unserem Export. Ohne sie lässt sich nichts zuordnen. */
  id: string;
  name?: string;
  /** Fläche [m²], wie die Gegenstelle sie gesehen hat. */
  flaeche?: number;
  /** Maschinenlesbarer Grund, so wie er ankam. */
  grund?: string;
  /** Geschossbezeichnung der Gegenstelle. */
  geschoss?: string;
}

/**
 * Die Gründe, die RaVia heute kennt — und ihr Klartext.
 *
 * Der Schlüssel ist die Verabredung, der Text gehört uns: Er steht im
 * Editor und muss dort etwas sagen, das der Anwender *tun* kann.
 */
export const GRUND_TEXT: Record<string, string> = {
  flaeche_unter_mindestgroesse: 'Die Fläche liegt unter der Mindestgröße von 0,10 m².',
  flaeche_fehlt_oder_nicht_numerisch: 'Die Fläche fehlt oder ist keine Zahl.',
  // Englische Schreibweisen desselben Grundes, falls die Gegenstelle wechselt.
  'area-below-minimum': 'Die Fläche liegt unter der Mindestgröße von 0,10 m².',
  'area-missing': 'Die Fläche fehlt oder ist keine Zahl.',
};

const zahl = (x: unknown): number | undefined =>
  typeof x === 'number' && Number.isFinite(x) ? x : undefined;
const text = (x: unknown): string | undefined =>
  typeof x === 'string' && x.trim() !== '' ? x.trim() : undefined;

/**
 * Die verworfenen Räume aus einer Antwort herauslesen.
 *
 * Genommen wird die Liste `verworfene_raeume` oder `rejected` — auch dann,
 * wenn sie in einem Umschlag steckt (`{ data: { … } }`), wie ihn manche
 * Schnittstellen um ihre Nutzlast legen. Einträge ohne Kennung fallen weg:
 * Ein Hinweis ohne Raum wäre eine Meldung, die auf nichts zeigt.
 */
export function leseVerworfene(antwort: unknown): VerworfenerRaum[] {
  const wurzel = antwort as Record<string, unknown> | null | undefined;
  if (!wurzel || typeof wurzel !== 'object') return [];

  const kandidaten: unknown[] = [];
  const sammle = (o: Record<string, unknown> | undefined, tiefe: number): void => {
    if (!o || typeof o !== 'object' || tiefe > 2) return;
    for (const schluessel of ['verworfene_raeume', 'rejected', 'verworfeneRaeume']) {
      const liste = o[schluessel];
      if (Array.isArray(liste)) kandidaten.push(...liste);
    }
    for (const schluessel of ['data', 'result', 'antwort', 'payload']) {
      sammle(o[schluessel] as Record<string, unknown> | undefined, tiefe + 1);
    }
  };
  sammle(wurzel, 0);

  const gesehen = new Set<string>();
  const raeume: VerworfenerRaum[] = [];
  for (const k of kandidaten) {
    const e = k as Record<string, unknown>;
    if (!e || typeof e !== 'object') continue;
    const id = text(e.id) ?? text(e.raum_id) ?? text(e.roomId);
    if (!id || gesehen.has(id)) continue;
    gesehen.add(id);
    raeume.push({
      id,
      name: text(e.name),
      flaeche: zahl(e.flaeche) ?? zahl(e.area),
      grund: text(e.grund) ?? text(e.reason),
      geschoss: text(e.geschoss) ?? text(e.level),
    });
  }
  return raeume;
}

/**
 * Der Hinweistext zu einem verworfenen Raum — kurz genug für den Plan.
 *
 * Aufbau: was passiert ist, warum, und mit welcher Fläche gerechnet wurde.
 * Die Fläche steht dabei, weil sie die eine Zahl ist, an der sich der
 * Anwender orientieren kann — sie sagt ihm, ob er den Raum vergrößern oder
 * löschen will.
 */
export function hinweisFuer(v: VerworfenerRaum): string {
  const name = v.name ? `„${v.name}"` : 'Dieser Raum';
  const flaeche = v.flaeche === undefined ? '' : ` (${v.flaeche.toFixed(2).replace('.', ',')} m²)`;
  const grund = v.grund ? (GRUND_TEXT[v.grund] ?? `Grund der Gegenstelle: ${v.grund}.`) : '';
  return `${name}${flaeche} wurde von RaVia nicht übernommen.${grund ? ` ${grund}` : ''}`;
}

/** Ein Hinweis, fertig zum Anzeigen — Raumkennung und Text. */
export interface RaumverlustHinweis {
  roomId: string;
  text: string;
  /** Kurzform für die Beschriftung im Plan. */
  kurz: string;
  grund?: string;
}

/**
 * Die Hinweise zu den Räumen, die es im Modell noch gibt.
 *
 * Ein verworfener Raum, den das Modell nicht (mehr) kennt, bekommt keinen
 * Hinweis — er würde auf nichts zeigen. Gezählt wird er trotzdem, damit der
 * Aufrufer sagen kann, dass etwas übrig blieb.
 */
export function hinweiseZuRaeumen(
  verworfene: readonly VerworfenerRaum[],
  raumIds: readonly string[],
): { hinweise: RaumverlustHinweis[]; ohneRaum: VerworfenerRaum[] } {
  const bekannt = new Set(raumIds);
  const hinweise: RaumverlustHinweis[] = [];
  const ohneRaum: VerworfenerRaum[] = [];
  for (const v of verworfene) {
    if (!bekannt.has(v.id)) {
      ohneRaum.push(v);
      continue;
    }
    hinweise.push({
      roomId: v.id,
      text: hinweisFuer(v),
      kurz: v.grund === 'flaeche_unter_mindestgroesse' || v.grund === 'area-below-minimum'
        ? 'zu klein — nicht übernommen'
        : 'nicht übernommen',
      grund: v.grund,
    });
  }
  return { hinweise, ohneRaum };
}
