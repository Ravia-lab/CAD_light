/**
 * Wo steht der Wärmeerzeuger? — der Vorschlag, wenn noch keiner steht.
 * ---------------------------------------------------------------------------
 * **Warum es das gibt.** Die Rohrauslegung braucht einen Ausgangspunkt:
 * Erzeuger, Speicher oder Verteiler. Steht keiner im Modell, bricht sie ab —
 * zu Recht, denn geraten wird ein Aufstellort nicht. Nur kommt diese Meldung
 * **nachdem** der Anwender auf „Auslegen" gedrückt hat, und sie sagt ihm
 * zwar was fehlt, aber nicht wo es hingehört.
 *
 * Im End-to-End-Lauf über die 54 Testgebäude war das in **jedem einzelnen
 * Fall** der Abbruchgrund beim ersten Auslegen. Für einen Handwerker, der in
 * fünfzehn Minuten fertig sein will, ist das der teuerste Handgriff im ganzen
 * Ablauf: Er muss erraten, dass er erst ein Symbol aus der TGA-Palette holen
 * muss, und dann, wohin damit.
 *
 * Dieses Modul rät den Standort **nicht** — es schlägt ihn vor, mit
 * Begründung, und der Anwender entscheidet. Der Unterschied ist wichtig: Ein
 * geratener Kessel im Wohnzimmer wäre schlimmer als gar keiner, weil ihn
 * niemand mehr hinterfragt.
 *
 * **Die Reihenfolge der Vorschläge** folgt dem, was ein Heizungsbauer täte:
 *
 *  1. **Technik- oder Hauswirtschaftsraum im untersten Geschoss.** Dort steht
 *     er in neun von zehn Häusern.
 *  2. **Der größte Raum im untersten Geschoss**, wenn es keinen Technikraum
 *     gibt — im Keller ist das der Raum, in dem Platz ist.
 *  3. **Der größte Raum des aktiven Geschosses**, wenn das Haus nur eines hat.
 *
 * Räume unter 4 m² und solche, die nach Schacht oder Kamin heißen, fallen
 * durch: Ein Schacht hat keine Tür, und was keine Tür hat, erreicht keine
 * Trasse — genau daran ist im Testlauf jede Auslegung gescheitert, die den
 * Erzeuger dort stehen hatte.
 *
 * Reine Funktion, kein Store, keine Oberfläche.
 */

import type { BimDocument, Room, Vec2 } from '../types/bim';
import { innererPunkt } from './geometry';

/** Ein Vorschlag, wo der Wärmeerzeuger stehen könnte. */
export interface Erzeugervorschlag {
  /** Der Punkt, an den das Symbol gesetzt würde — sicher im Raum. */
  position: Vec2;
  roomId: string;
  levelId: string;
  /** „Technikraum, Kellergeschoss" — was in der Schaltfläche steht. */
  ort: string;
  /** Warum gerade hier — ein Satz, den der Anwender prüfen kann. */
  grund: string;
}

/** Nutzungen, in denen ein Erzeuger üblicherweise steht. */
const TECHNIK = new Set(['technical', 'utility']);
/** Was nach Schacht klingt, ist keiner Trasse zugänglich. */
const KEIN_AUFSTELLORT = /schacht|kamin|abzug|lüftung/i;
/** Darunter ist kein Aufstellraum, sondern eine Nische. */
const MINDESTFLAECHE = 4;

function brauchbar(r: Room): boolean {
  return r.area >= MINDESTFLAECHE && !KEIN_AUFSTELLORT.test(r.name) && r.innerPolygon.length >= 3;
}

/**
 * Steht schon ein Ausgangspunkt im Modell?
 *
 * Erzeuger, Speicher und Verteiler zählen gleichermaßen — die Auslegung
 * beginnt an jedem von ihnen. Auch eine Monoblock-Wärmepumpe im Gelände
 * zählt: Sie *ist* der Erzeuger, und die Hauseinführung nimmt CAD Light an.
 */
export function hatAusgangspunkt(doc: BimDocument): boolean {
  const imHaus = Object.values(doc.fixtures).some(
    (f) => f.type === 'boiler' || f.type === 'storage' || f.type === 'manifold',
  );
  if (imHaus) return true;
  return Object.values(doc.site?.pumps ?? {}).length > 0;
}

/**
 * Der Vorschlag — oder `undefined`, wenn sich keiner begründen lässt.
 *
 * `levelId` ist das Geschoss, auf dem der Anwender gerade arbeitet; gesucht
 * wird trotzdem zuerst unten, weil dort der Heizraum liegt.
 */
/**
 * Wo der **Heizkreisverteiler** eines Geschosses hingehört.
 *
 * **Warum das eine eigene Frage ist.** Der Erzeuger steht unten, möglichst
 * nahe am Hausanschluss — deshalb sucht `schlageErzeugerVor` von unten nach
 * oben und nimmt den Technikraum. Der Verteiler steht dagegen **mittig im
 * Geschoss, das er versorgt**: Jeder Meter, den er von einem Raum entfernt
 * ist, kostet zwei Meter Anbindeleitung, bevor im Raum das erste Rohr liegt.
 * Der Flur ist deshalb die erste Wahl, und zwar nicht aus Gewohnheit: Von ihm
 * gehen die Türen ab, also sind von ihm aus alle Räume kurz erreichbar.
 *
 * Rangfolge: Flur → Technik- oder Hausanschlussraum → der Raum, dessen Mitte
 * dem Schwerpunkt des Geschosses am nächsten liegt. Geraten wird die Lage
 * **im** Raum nicht: Der Punkt ist ein sicherer innerer Punkt, und verschieben
 * lässt sich das Symbol danach jederzeit.
 */
export function schlageVerteilerVor(doc: BimDocument, levelId: string): Erzeugervorschlag | undefined {
  const raeume = Object.values(doc.rooms).filter((r) => r.levelId === levelId && brauchbar(r));
  if (!raeume.length) return undefined;
  const name = doc.levels[levelId]?.name ?? 'Geschoss';

  const flur = raeume.filter((r) => r.usage === 'hallway').sort((a, b) => b.area - a.area)[0];
  if (flur) {
    return {
      position: innererPunkt(flur.innerPolygon),
      roomId: flur.id,
      levelId,
      ort: `${flur.name}, ${name}`,
      grund: 'Flur — von dort gehen die Türen ab, also sind alle Räume kurz erreichbar. Jeder Meter weiter kostet zwei Meter Anbindeleitung.',
    };
  }

  const technik = raeume.filter((r) => TECHNIK.has(r.usage)).sort((a, b) => b.area - a.area)[0];
  if (technik) {
    return {
      position: innererPunkt(technik.innerPolygon),
      roomId: technik.id,
      levelId,
      ort: `${technik.name}, ${name}`,
      grund: 'Kein Flur auf diesem Geschoss — der Technikraum ist der nächstbeste Ort für einen Verteiler.',
    };
  }

  // Der Raum, dessen Mitte dem Schwerpunkt des Geschosses am nächsten liegt.
  const mitte = raeume.reduce(
    (a, r) => ({ x: a.x + r.centroid.x * r.area, y: a.y + r.centroid.y * r.area, g: a.g + r.area }),
    { x: 0, y: 0, g: 0 },
  );
  const schwerpunkt = { x: mitte.x / mitte.g, y: mitte.y / mitte.g };
  const zentral = raeume
    .slice()
    .sort(
      (a, b) =>
        Math.hypot(a.centroid.x - schwerpunkt.x, a.centroid.y - schwerpunkt.y) -
        Math.hypot(b.centroid.x - schwerpunkt.x, b.centroid.y - schwerpunkt.y),
    )[0];
  return {
    position: innererPunkt(zentral.innerPolygon),
    roomId: zentral.id,
    levelId,
    ort: `${zentral.name}, ${name}`,
    grund: `Kein Flur und kein Technikraum — „${zentral.name}" liegt dem Schwerpunkt des Geschosses am nächsten und hält damit die Anbindeleitungen kurz.`,
  };
}

export function schlageErzeugerVor(doc: BimDocument, levelId?: string): Erzeugervorschlag | undefined {
  const geschosse = Object.values(doc.levels).sort((a, b) => a.order - b.order);
  if (!geschosse.length) return undefined;

  const raeumeAuf = (id: string): Room[] =>
    Object.values(doc.rooms).filter((r) => r.levelId === id && brauchbar(r));

  const bauen = (r: Room, grund: string): Erzeugervorschlag => ({
    position: innererPunkt(r.innerPolygon),
    roomId: r.id,
    levelId: r.levelId,
    ort: `${r.name}, ${doc.levels[r.levelId]?.name ?? 'Geschoss'}`,
    grund,
  });

  // 1 · Technikraum, von unten nach oben gesucht.
  for (const g of geschosse) {
    const technik = raeumeAuf(g.id)
      .filter((r) => TECHNIK.has(r.usage))
      .sort((a, b) => b.area - a.area)[0];
    if (technik) {
      return bauen(technik, `Technikraum im ${g.name} — dort steht der Erzeuger im Regelfall.`);
    }
  }

  // 2 · Der größte Raum im untersten Geschoss.
  const unten = raeumeAuf(geschosse[0].id).sort((a, b) => b.area - a.area)[0];
  if (unten) {
    return bauen(
      unten,
      `Kein Technikraum im Modell. „${unten.name}" ist der größte Raum im ${geschosse[0].name} ` +
        // Komma, nicht Punkt: Der Text steht in einer deutschen Oberfläche.
        `(${unten.area.toFixed(1).replace('.', ',')} m²) — bitte prüfen und bei Bedarf verschieben.`,
    );
  }

  // 3 · Notfalls das Geschoss, auf dem gearbeitet wird.
  const hier = raeumeAuf(levelId ?? doc.activeLevelId).sort((a, b) => b.area - a.area)[0];
  if (hier) {
    return bauen(
      hier,
      `Kein Raum im untersten Geschoss, der sich eignet. „${hier.name}" ist der größte Raum ` +
        'auf diesem Geschoss — bitte prüfen.',
    );
  }

  return undefined;
}
