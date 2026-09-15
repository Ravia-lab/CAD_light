/**
 * Prüfblock „Raumtreffer" — was ein Punkt im Raum im Modell bedeutet.
 *
 * **Warum das geprüft gehört.** In der 3D-Ansicht sind alle Wände zu einer
 * Geometrie verschmolzen; ein Strahl trifft also nicht „die Wand W-7",
 * sondern einen Punkt. Aus diesem Punkt wieder ein Bauteil zu machen, ist
 * die Umkehrung des Verschmelzens — und sie entscheidet, was beim Klicken
 * passiert. Greift sie daneben, wählt man die falsche Wand aus oder setzt
 * einen Heizkörper an ein Bauteil, auf das man gar nicht gezeigt hat.
 *
 * Zwei Dinge sind dabei heikel und stehen deshalb hier:
 *
 *  · **Das Vorzeichen.** Die Szene dreht die Modell-y-Achse um. Ein Fehler
 *    darin spiegelt jeden Klick — und zwar so, dass es bei einem
 *    symmetrischen Grundriss zufällig richtig aussieht.
 *  · **Die Rangfolge.** Ein Punkt an einer Wand liegt zugleich in einem Raum.
 *    Gemeint ist die Wand; nur wo keine Wand in der Nähe ist, ist der Boden
 *    gemeint. Ohne feste Regel hinge das Ergebnis an der Reihenfolge im
 *    Speicher.
 */

import type { CheckFn } from './typ';
import type { BimDocument } from '../../src/types/bim';
import { WANDZUSCHLAG, deuteTreffer, szeneZuModell } from '../../src/lib/raumtreffer';
import { modelToScene } from '../../src/lib/wallGeometry';

/** Ein Zimmer 6 × 4 m (Achsmaß), 24er-Außenwände, eine 11,5er-Trennwand. */
function baueHaus(): BimDocument {
  const nodes = {
    a: { id: 'a', x: 0, y: 0, levelId: 'eg' },
    b: { id: 'b', x: 6, y: 0, levelId: 'eg' },
    c: { id: 'c', x: 6, y: 4, levelId: 'eg' },
    d: { id: 'd', x: 0, y: 4, levelId: 'eg' },
    // Die Trennwand steht bei x = 3 und teilt das Zimmer.
    e: { id: 'e', x: 3, y: 0, levelId: 'eg' },
    f: { id: 'f', x: 3, y: 4, levelId: 'eg' },
    // Dieselbe Ecke im Obergeschoss — sie darf nie getroffen werden.
    og: { id: 'og', x: 0, y: 0, levelId: 'og' },
    og2: { id: 'og2', x: 6, y: 0, levelId: 'og' },
  };
  const wand = (id: string, a: string, b: string, dicke: number, level = 'eg') => ({
    id,
    levelId: level,
    a,
    b,
    thickness: dicke,
    height: 2.5,
    type: 'exterior',
    layerId: 'layer-walls',
  });
  return {
    meta: { name: 'Trefferprobe' },
    activeLevelId: 'eg',
    nodes,
    walls: {
      sued: wand('sued', 'a', 'b', 0.24),
      ost: wand('ost', 'b', 'c', 0.24),
      nord: wand('nord', 'c', 'd', 0.24),
      west: wand('west', 'd', 'a', 0.24),
      trenn: wand('trenn', 'e', 'f', 0.115),
      obenSued: wand('obenSued', 'og', 'og2', 0.24, 'og'),
    },
    openings: {},
    fixtures: {},
    rooms: {
      links: {
        id: 'links',
        levelId: 'eg',
        name: 'Wohnen',
        usage: 'living',
        area: 10,
        polygon: [
          { x: 0, y: 0 },
          { x: 3, y: 0 },
          { x: 3, y: 4 },
          { x: 0, y: 4 },
        ],
        innerPolygon: [
          { x: 0.12, y: 0.12 },
          { x: 2.94, y: 0.12 },
          { x: 2.94, y: 3.88 },
          { x: 0.12, y: 3.88 },
        ],
      },
      rechts: {
        id: 'rechts',
        levelId: 'eg',
        name: 'Schlafen',
        usage: 'bedroom',
        area: 10,
        polygon: [
          { x: 3, y: 0 },
          { x: 6, y: 0 },
          { x: 6, y: 4 },
          { x: 3, y: 4 },
        ],
        innerPolygon: [
          { x: 3.06, y: 0.12 },
          { x: 5.88, y: 0.12 },
          { x: 5.88, y: 3.88 },
          { x: 3.06, y: 3.88 },
        ],
      },
    },
    site: { elements: {}, pumps: {} },
    diagnostics: { openEnds: [], closure: [] },
  } as unknown as BimDocument;
}

export function pruefeRaumtreffer(check: CheckFn): void {
  const doc = baueHaus();

  // =========================================================================
  // 1 · Der Rückweg aus der Szene — das Vorzeichen
  // =========================================================================
  {
    // Hin und zurück muss denselben Punkt ergeben. Ein Vorzeichenfehler
    // spiegelt jeden Klick und sieht bei symmetrischen Grundrissen zufällig
    // richtig aus — deshalb ein unsymmetrischer Punkt.
    const p = { x: 4.2, y: 1.7 };
    const szene = modelToScene(p, 1.1);
    const zurueck = szeneZuModell(szene);
    check('Hin und zurück ergibt denselben Punkt (x)', zurueck.x, p.x, 1e-9);
    check('… und dieselbe Tiefe (y)', zurueck.y, p.y, 1e-9);
    check('Die Höhe geht dabei verloren — sie ist keine Grundrissgröße', 'y' in zurueck && !('z' in zurueck), true);
    // Gegenprobe gegen das häufigste Versehen: y einfach übernehmen.
    check('Ohne Spiegelung wäre es falsch', szene.z !== p.y, true);
  }

  // =========================================================================
  // 2 · Die Wand gewinnt gegen den Raum
  // =========================================================================
  {
    // Direkt auf der Achse der Südwand.
    const aufWand = deuteTreffer(doc, 'eg', { x: 2, y: 0 });
    check('Auf der Wandachse ist die Wand gemeint', aufWand.art, 'wand');
    check('… und zwar die Südwand', aufWand.id ?? '', 'sued');
    check('… mit dem Abstand vom Wandanfang', aufWand.abstand ?? -1, 2, 1e-9);

    // An der Wandoberfläche, 12 cm neben der Achse: immer noch die Wand.
    const anDerFlaeche = deuteTreffer(doc, 'eg', { x: 2, y: 0.12 });
    check('An der Wandoberfläche ebenfalls', anDerFlaeche.art, 'wand');
    check('… und dieselbe Wand', anDerFlaeche.id ?? '', 'sued');

    // Einen halben Meter davor: jetzt ist der Raum gemeint.
    const imRaum = deuteTreffer(doc, 'eg', { x: 2, y: 0.7 });
    check('Einen halben Meter davor ist der Raum gemeint', imRaum.art, 'raum');
    check('… und zwar der linke', imRaum.id ?? '', 'links');
  }

  // =========================================================================
  // 3 · Wo genau die Grenze liegt
  // =========================================================================
  {
    // 24er-Wand: halbe Dicke 0,12 plus Zuschlag 0,04 = 0,16 m.
    const grenze = 0.12 + WANDZUSCHLAG;
    const knappDrin = deuteTreffer(doc, 'eg', { x: 2, y: grenze - 0.005 });
    const knappDraussen = deuteTreffer(doc, 'eg', { x: 2, y: grenze + 0.005 });
    check('Knapp innerhalb zählt zur Wand', knappDrin.art, 'wand');
    check('Knapp außerhalb nicht mehr', knappDraussen.art, 'raum');

    // Die dünne Trennwand hat eine engere Grenze — sie ist ja dünner.
    const anDerTrennwand = deuteTreffer(doc, 'eg', { x: 3, y: 2 });
    check('Auch die Trennwand wird getroffen', anDerTrennwand.id ?? '', 'trenn');
    const nebenDerTrennwand = deuteTreffer(doc, 'eg', { x: 3.12, y: 2 });
    check('12 cm daneben ist es schon der Raum', nebenDerTrennwand.art, 'raum');
    check('… und zwar der rechte', nebenDerTrennwand.id ?? '', 'rechts');
  }

  // =========================================================================
  // 4 · Die nähere Wand gewinnt
  // =========================================================================
  {
    // Die Südost-Ecke: dort liegen Süd- und Ostwand beieinander. Ein Punkt
    // etwas weiter östlich als südlich muss die Ostwand liefern.
    const ecke = deuteTreffer(doc, 'eg', { x: 5.97, y: 0.1 });
    check('In der Ecke gewinnt die nähere Wand', ecke.id ?? '', 'ost');
  }

  // =========================================================================
  // 5 · Die Geschossgrenze
  // =========================================================================
  {
    // Im Obergeschoss steht an derselben Stelle eine Wand. Wer im EG
    // arbeitet, darf sie nicht treffen — sie ist im Bild gar nicht zu sehen.
    const imEg = deuteTreffer(doc, 'eg', { x: 2, y: 0 });
    check('Im EG wird die EG-Wand getroffen', imEg.id ?? '', 'sued');
    const imOg = deuteTreffer(doc, 'og', { x: 2, y: 0 });
    check('Im OG die OG-Wand', imOg.id ?? '', 'obenSued');
    // Und im OG gibt es keine Räume — also auch keinen Raumtreffer.
    check('Ohne Raum im Geschoss bleibt es bei nichts', deuteTreffer(doc, 'og', { x: 2, y: 2 }).art, 'nichts');
  }

  // =========================================================================
  // 6 · Draußen ist nichts
  // =========================================================================
  {
    check('Weit außerhalb: nichts', deuteTreffer(doc, 'eg', { x: 20, y: 20 }).art, 'nichts');
    check('Knapp außerhalb der Außenwand: nichts', deuteTreffer(doc, 'eg', { x: 2, y: -0.5 }).art, 'nichts');
    const leer = { walls: {}, rooms: {}, nodes: {} } as unknown as BimDocument;
    check('Ein leeres Modell stürzt nicht ab', deuteTreffer(leer, 'eg', { x: 0, y: 0 }).art, 'nichts');
  }
}
