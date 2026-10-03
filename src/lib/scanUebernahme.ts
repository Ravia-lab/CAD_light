/**
 * Was nach der Raumerkennung mit einem Gebäudescan geschieht.
 * ---------------------------------------------------------------------------
 *
 * Der Import (`buildingModelImport.ts`) übersetzt Wände, Öffnungen und das
 * Dach in die Begriffe dieses Modells. Drei Entscheidungen lassen sich dort
 * aber noch nicht treffen, weil sie an den **erkannten Räumen** hängen — und
 * die gibt es erst, wenn die Raumerkennung gelaufen ist:
 *
 *  1. **Welche Räume liegen unter dem Scan-Dach?** (`scanDachZuordnen`)
 *  2. **Welcher Raum bekommt welchen Namen?** (`benenneRaeume`)
 *  3. **Wo im Plan stehen die Prüfpunkte der App?** (`pruefpunkteAlsHinweise`)
 *
 * Sie stehen hier und nicht im Store, damit sie ohne Oberfläche prüfbar sind:
 * Der Prüfblock `scanuebernahme` schickt den echten Feldscan vom 02.10.2026
 * durch genau diese Funktionen.
 *
 * Schichtgrenze: nur `types` und andere `lib`-Bausteine.
 */

import type { Annotation, Level, Room, Vec2 } from '../types/bim';
import { DACH_VORGABE } from '../types/bim';
import { innererPunkt, pointInPolygon, polygonArea } from './geometry';
import type { BuildingImportErgebnis } from './buildingModelImport';
import type { RaumHinweis } from './raumplanImport';

/** Kennung des Dachs, das aus einem Scan kommt. */
export const SCAN_DACH_ID = 'dach-scan';

export interface ScanDachZuordnung {
  levelId: string;
  /** Räume unter der Schräge. */
  unterDach: string[];
  /** Räume mit gerader Decke, für die der Scan keine Schräge belegt. */
  ohneDach: string[];
  /** Gab es überhaupt Belege? Ohne Belege liegt das Dach wie bisher über allem. */
  lageBelegt: boolean;
}

const schwerpunkt = (poly: readonly Vec2[]): Vec2 => {
  let sx = 0;
  let sy = 0;
  for (const p of poly) {
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / poly.length, y: sy / poly.length };
};

/**
 * Das Scan-Dach an die Räume binden, die wirklich unter der Schräge liegen.
 *
 * **Die Regel.** Ein Raum liegt unter dem Dach, wenn an seinem Rand eine der
 * Wände steht, die der Import als Dachbeleg gesammelt hat (Kniestock,
 * Schrägprofil, in den Dachraum reichende Wand). Jeder andere Raum bekommt
 * **kein** Scan-Dach — er rechnet mit gerader Decke in Geschosshöhe, und die
 * Prüfung sagt dazu: „Dach über diesem Gebäudeteil nicht erfasst — prüfen".
 *
 * **Warum nicht großzügiger.** Der naheliegende Ausweg wäre, das Dach über
 * den zusammenhängenden Umriss der belegten Räume zu ziehen. Genau das hat
 * beim Feldscan versagt: Der Flügel hängt am Hauptbau, gehört also zum
 * zusammenhängenden Umriss, und lag trotzdem nicht unter der Schräge. Ein
 * Dach über einer Fläche, die der Scan nicht als Schräge belegt, ist eine
 * erfundene Geometrie — mit Folgen für Raumvolumen, Dachfläche und
 * Transmission. Eine gerade Decke mit Prüfhinweis ist eine Lücke, die man
 * sieht.
 *
 * **Ohne jeden Beleg** (Scans vor Schema 1.10.0 kennen weder `kneeWall` noch
 * `profile`) bleibt es beim Verhalten von 1.69.0: das Dach über dem ganzen
 * Geschoss. Es gibt dann keine Grundlage, einen Raum herauszunehmen; die
 * Prüfung meldet stattdessen, dass die Lage des Dachs nicht belegt ist.
 *
 * Verändert `levels` an Ort und Stelle. Die Räume müssen danach neu erkannt
 * werden — ihr Dach bestimmt ihre Höhe und ihr Volumen.
 */
export function scanDachZuordnen(
  levels: Record<string, Level>,
  rooms: readonly Room[],
  ergebnis: Pick<BuildingImportErgebnis, 'daecher' | 'dachBelege'>,
): ScanDachZuordnung[] {
  const aus: ScanDachZuordnung[] = [];
  for (const [levelId, dach] of Object.entries(ergebnis.daecher)) {
    const level = levels[levelId];
    if (!level) continue;
    const belege = new Set(ergebnis.dachBelege[levelId] ?? []);
    const hier = rooms.filter((r) => r.levelId === levelId);
    const unterDach = hier.filter((r) => r.boundaries.some((b) => belege.has(b.wallId))).map((r) => r.id);
    const lageBelegt = belege.size > 0;
    const roof = {
      ...DACH_VORGABE,
      ...dach,
      id: SCAN_DACH_ID,
      name: 'Dach aus Scan',
      // Ohne Beleg: keine Raumliste = ganzes Geschoss (Verhalten bis 1.69.0).
      ...(lageBelegt ? { roomIds: unterDach } : {}),
      scan: { ...dach.scan, lageBelegt },
    };
    levels[levelId] = { ...level, roof: undefined, roofs: [roof] };
    aus.push({
      levelId,
      unterDach: lageBelegt ? unterDach : hier.map((r) => r.id),
      ohneDach: lageBelegt ? hier.filter((r) => !unterDach.includes(r.id)).map((r) => r.id) : [],
      lageBelegt,
    });
  }
  return aus;
}

/**
 * Raumnamen aus dem Scan an die erkannten Räume geben.
 *
 * Zugeordnet wird über die Lage: Fällt der Punkt eines Hinweises in einen
 * erkannten Raum, erbt der Raum Namen und Nutzung. Was der Monteur benannt
 * hat (`vomNutzer`), geht vor die Bereichsbezeichnung, die RoomPlan geraten
 * hat. Trifft ein Raum mehrere Hinweise, gewinnt der erste; dass es mehrere
 * sind, heißt, dass zwischen ihnen eine Wand fehlt, und wird gezählt.
 *
 * **Neu in 1.70.0: Ein Bereich ist kein Raum.** Die App kennt heute nur
 * einen Raum je Geschoss — beim Feldscan vom 02.10.2026 „Manu" über 118,7 m²
 * brutto. Sein Schwerpunkt fiel zufällig in einen Flur, und der Flur hieß
 * danach „Manu", mit Vorrang vor jeder anderen Bezeichnung. Deshalb: Ein
 * Hinweis vom Monteur, dessen **Fläche** die Mitte von mehr als einem
 * erkannten Raum enthält, beschreibt einen Bereich und benennt keinen Raum.
 * Die Regel ist geometrisch und nicht „nur ein Raum im Modell", damit sie
 * auch dann richtig bleibt, wenn der nächste App-Build die Bodenfläche
 * zerlegt: Dann überdeckt jeder Monteursraum einen erkannten Raum, und jeder
 * Name kommt an.
 */
export function benenneRaeume(
  doc: { rooms: Record<string, Room> },
  hinweise: readonly RaumHinweis[],
): { benannt: number; doppelt: number; bereiche: string[] } {
  let benannt = 0;
  let doppelt = 0;
  const bereiche: string[] = [];
  const vergeben = new Set<string>();
  const alle = Object.values(doc.rooms);
  const sortiert = [...hinweise].sort((a, b) => Number(b.vomNutzer ?? false) - Number(a.vomNutzer ?? false));
  for (const hinweis of sortiert) {
    if (hinweis.vomNutzer && hinweis.flaeche && hinweis.flaeche.length >= 3) {
      const ueberdeckt = alle.filter(
        (r) => r.levelId === hinweis.levelId && r.polygon.length >= 3 && pointInPolygon(schwerpunkt(r.polygon), hinweis.flaeche!),
      ).length;
      if (ueberdeckt > 1) {
        bereiche.push(hinweis.name);
        continue;
      }
    }
    const raum = alle.find((r) => r.levelId === hinweis.levelId && pointInPolygon(hinweis.punkt, r.polygon));
    if (!raum) continue;
    if (vergeben.has(raum.id)) {
      doppelt++;
      continue;
    }
    vergeben.add(raum.id);
    doc.rooms[raum.id] = {
      ...raum,
      name: hinweis.name,
      usage: hinweis.usage,
      ...(hinweis.raviaRoomId ? { raviaRoomId: hinweis.raviaRoomId } : {}),
    };
    benannt++;
  }
  return { benannt, doppelt, bereiche };
}

/**
 * Beheizt oder nicht aus dem Scan übernehmen (Brücke K2, Festlegung F4:
 * `heated` im Scan bedeutet dasselbe wie `isHeated` hier).
 *
 * Zugeordnet wird über die Lage, wie beim Namen: Ein erkannter Raum, dessen
 * innerer Punkt in der Fläche eines Scanraums liegt — bei mehreren in der
 * kleinsten — oder in dem der Mittelpunkt des Scanraums liegt, übernimmt
 * dessen Angabe.
 *
 * @returns Zahl der Räume, deren Angabe sich geändert hat.
 */
export function uebernimmBeheizung(
  doc: { rooms: Record<string, Room> },
  liste: readonly { levelId: string; punkt: Vec2; flaeche: Vec2[]; heated: boolean }[],
): number {
  let geaendert = 0;
  for (const raum of Object.values(doc.rooms)) {
    if (raum.polygon.length < 3) continue;
    /*
     * Ein Punkt sicher im Raum (bei L-Formen liegt der Schwerpunkt außen),
     * und unter den Scanräumen, die ihn enthalten, der **kleinste**: Ein
     * Bereich über das ganze Geschoss darf die Angabe eines Einzelraums
     * darin nicht überdecken (Feldscan-Abnahme 1.73.0). Erst wenn keine
     * Fläche passt, gilt der Mittelpunkt des Scanraums im Raum.
     */
    const s = innererPunkt(raum.polygon);
    const kandidaten = liste
      .filter((b) => b.levelId === raum.levelId && pointInPolygon(s, b.flaeche))
      .sort((x, y) => polygonArea(x.flaeche) - polygonArea(y.flaeche));
    const treffer =
      kandidaten[0] ?? liste.find((b) => b.levelId === raum.levelId && pointInPolygon(b.punkt, raum.polygon));
    if (!treffer || raum.isHeated === treffer.heated) continue;
    doc.rooms[raum.id] = { ...raum, isHeated: treffer.heated };
    geaendert++;
  }
  return geaendert;
}

/**
 * Prüfpunkte der App als Hinweisfahnen im Grundriss.
 *
 * Spitze am Ort, den die App nennt; Text 0,42 m schräg darüber, wie bei jeder
 * Fahne aus der begehbaren Ansicht — sonst läge die Schrift auf dem Punkt,
 * den sie erklärt. Die Fahne ist ein gewöhnlicher Hinweis: Sie steht im
 * Plan, wird gedruckt, und wer die Stelle geprüft hat, löscht sie.
 *
 * Mehrere Prüfpunkte am selben Ort (beim Feldscan zwei an einem Punkt: kein
 * Zugang, kein Heizkörper) werden zu **einer** Fahne mit zwei Zeilen — zwei
 * deckungsgleiche Fahnen wären eine, die man nicht lesen kann.
 */
export function pruefpunkteAlsHinweise(
  ergebnis: Pick<BuildingImportErgebnis, 'pruefpunkte'>,
  kennung: (i: number) => string,
): Annotation[] {
  const gruppen = new Map<string, { levelId: string; punkt: Vec2; texte: string[] }>();
  for (const p of ergebnis.pruefpunkte) {
    const schluessel = `${p.levelId}|${p.punkt.x.toFixed(2)}|${p.punkt.y.toFixed(2)}`;
    const g = gruppen.get(schluessel) ?? { levelId: p.levelId, punkt: p.punkt, texte: [] };
    if (!g.texte.includes(p.text)) g.texte.push(p.text);
    gruppen.set(schluessel, g);
  }
  return [...gruppen.values()].map((g, i) => ({
    id: kennung(i),
    kind: 'leader' as const,
    levelId: g.levelId,
    points: [
      { x: g.punkt.x, y: g.punkt.y },
      { x: Math.round((g.punkt.x + 0.42) * 1000) / 1000, y: Math.round((g.punkt.y + 0.42) * 1000) / 1000 },
    ],
    offset: 0,
    text: `Prüfpunkt Scan: ${g.texte.join(' — ')}`,
    scale: 1,
  }));
}
