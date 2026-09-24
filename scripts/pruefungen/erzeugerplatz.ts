/**
 * Prüfblock „Wo steht der Wärmeerzeuger?"
 * ---------------------------------------------------------------------------
 * **Der Anlass (E2E-Lauf über die 54 Testgebäude, 23./24.09.2026).** Die
 * Rohrauslegung braucht einen Ausgangspunkt. Steht keiner im Modell, bricht
 * sie ab — und das war in **jedem einzelnen** der 54 Testgebäude der
 * Abbruchgrund beim ersten Auslegen. Die Meldung sagte, was fehlt, aber nicht
 * wohin es gehört.
 *
 * Geprüft wird hier die Regel, nach der vorgeschlagen wird: Technikraum
 * zuerst, sonst der größte Raum im untersten Geschoss, und nie ein Schacht.
 * Der Schacht ist kein Schönheitsfehler: Er hat keine Tür, und ein Erzeuger
 * dort erreicht keinen einzigen Heizkörper. Genau so ist im Testlauf bei 18
 * von 54 Grundrissen eine Auslegung mit 0 m Rohr herausgekommen.
 *
 * Das Prüfhaus — zwei Geschosse, im Keller drei Räume, im EG zwei:
 *
 *       KG:  Heizraum 12 m²  ·  Vorrat 6 m²  ·  Schacht 0,4 m²
 *       EG:  Wohnen 30 m²    ·  Bad 6 m²
 */

import type { BimDocument, Level, Room, Vec2 } from '../../src/types/bim';
import { hatAusgangspunkt, schlageErzeugerVor } from '../../src/lib/erzeugerplatz';
import { pointInPolygon } from '../../src/lib/geometry';
import type { CheckFn } from './typ';

const rechteck = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 },
];

const level = (id: string, name: string, order: number): Level => ({
  id, name, elevation: order * 2.8, order, height: 2.5,
  floorUValue: 0.3, floorBoundary: 'ground', ceilingUValue: 0.2, ceilingBoundary: 'unheated',
});

const raum = (id: string, levelId: string, name: string, usage: string, poly: Vec2[]): Room => {
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  const flaeche = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
  return {
    id, levelId, name, usage, polygon: [...poly], innerPolygon: [...poly],
    area: flaeche, grossArea: flaeche, perimeter: 0, height: 2.5, volume: flaeche * 2.5,
    centroid: { x: (Math.max(...xs) + Math.min(...xs)) / 2, y: (Math.max(...ys) + Math.min(...ys)) / 2 },
    boundaries: [], setpointTemperature: 20, airChangeRate: 0.5, isHeated: true,
    groundContactPerimeter: 0, exposedFacadeCount: 1,
  } as unknown as Room;
};

function haus(extra: Partial<BimDocument> = {}): BimDocument {
  const raeume = [
    raum('kg-heiz', 'kg', 'Heizraum', 'technical', rechteck(0, 0, 4, 3)),
    raum('kg-vorrat', 'kg', 'Vorratskeller', 'storage', rechteck(4, 0, 7, 2)),
    raum('kg-schacht', 'kg', 'Schacht', 'other', rechteck(7, 0, 7.5, 0.8)),
    raum('eg-wohnen', 'eg', 'Wohnen', 'living', rechteck(0, 0, 6, 5)),
    raum('eg-bad', 'eg', 'Bad', 'bath', rechteck(6, 0, 8, 3)),
  ];
  return {
    levels: { kg: level('kg', 'KG', -1), eg: level('eg', 'EG', 0) },
    activeLevelId: 'eg',
    rooms: Object.fromEntries(raeume.map((r) => [r.id, r])),
    fixtures: {}, nodes: {}, walls: {}, openings: {}, verticals: {}, solids: {},
    durchbrueche: {}, pipes: {}, annotations: {}, layers: {}, constructions: {},
    ...extra,
  } as unknown as BimDocument;
}

export function pruefeErzeugerplatz(check: CheckFn): void {
  // =========================================================================
  // 1 · Der Regelfall: Technikraum, auch wenn oben gearbeitet wird
  // =========================================================================
  {
    const doc = haus();
    check('Ohne Erzeuger: kein Ausgangspunkt', hatAusgangspunkt(doc), false);

    const v = schlageErzeugerVor(doc, 'eg');
    check('Es gibt einen Vorschlag', v !== undefined, true);
    check('Der Technikraum gewinnt', v?.roomId ?? '—', 'kg-heiz');
    check('… auch wenn im EG gearbeitet wird', v?.levelId ?? '—', 'kg');
    check('Der Ort steht lesbar da', v?.ort ?? '—', 'Heizraum, KG');
    check('Die Begründung nennt den Regelfall', (v?.grund ?? '').includes('Regelfall'), true);

    /*
     * Der Punkt muss **im Raum** liegen — sonst steht der Kessel in einer
     * Wand, und die Wegsuche findet von dort aus nichts. Heizraum ist
     * 4 × 3 m, die Mitte also (2 | 1,5).
     */
    const drin = v ? pointInPolygon(v.position, doc.rooms[v.roomId].innerPolygon) : false;
    check('Der Aufstellpunkt liegt im Raum', drin, true);
    check('… und zwar in der Mitte, x', v?.position.x ?? -1, 2, 1e-9);
    check('… und y', v?.position.y ?? -1, 1.5, 1e-9);
  }

  // =========================================================================
  // 2 · Kein Technikraum: der größte Raum unten — aber nie der Schacht
  // =========================================================================
  {
    const doc = haus();
    // Aus dem Heizraum wird ein gewöhnlicher Keller.
    doc.rooms['kg-heiz'] = { ...doc.rooms['kg-heiz'], usage: 'storage', name: 'Keller' };

    const v = schlageErzeugerVor(doc, 'eg');
    check('Ohne Technikraum: der größte Raum unten', v?.roomId ?? '—', 'kg-heiz');
    check('… nicht der Vorratskeller (6 m² gegen 12 m²)', v?.roomId !== 'kg-vorrat', true);
    check('… und niemals der Schacht', v?.roomId !== 'kg-schacht', true);
    check('Die Begründung bittet um Prüfung', (v?.grund ?? '').includes('prüfen'), true);
    check('… und nennt die Fläche', (v?.grund ?? '').includes('12,0 m²'), true);
  }

  // =========================================================================
  // 3 · Gegenprobe: nur Schacht und Nische im Keller
  // =========================================================================
  {
    const doc = haus();
    delete (doc.rooms as Record<string, Room>)['kg-heiz'];
    delete (doc.rooms as Record<string, Room>)['kg-vorrat'];
    // Unten bleibt nur der Schacht (0,4 m²) — der fällt durch.
    const v = schlageErzeugerVor(doc, 'eg');
    check('Kein brauchbarer Raum unten → das Arbeitsgeschoss', v?.levelId ?? '—', 'eg');
    check('… und dort der größte Raum', v?.roomId ?? '—', 'eg-wohnen');
    check('Die Begründung sagt warum', (v?.grund ?? '').includes('untersten Geschoss'), true);
  }

  // =========================================================================
  // 4 · Steht schon etwas, gibt es keinen Vorschlag mehr
  // =========================================================================
  {
    const mitKessel = haus({
      fixtures: { k1: { id: 'k1', type: 'boiler', levelId: 'kg', position: { x: 2, y: 1.5 } } },
    } as unknown as Partial<BimDocument>);
    check('Mit Kessel: Ausgangspunkt vorhanden', hatAusgangspunkt(mitKessel), true);

    const mitSpeicher = haus({
      fixtures: { s1: { id: 's1', type: 'storage', levelId: 'kg', position: { x: 2, y: 1.5 } } },
    } as unknown as Partial<BimDocument>);
    check('Ein Speicher zählt auch', hatAusgangspunkt(mitSpeicher), true);

    const mitVerteiler = haus({
      fixtures: { v1: { id: 'v1', type: 'manifold', levelId: 'eg', position: { x: 3, y: 2 } } },
    } as unknown as Partial<BimDocument>);
    check('Ein Heizkreisverteiler auch', hatAusgangspunkt(mitVerteiler), true);

    /*
     * Und die Wärmepumpe im Gelände: Sie **ist** der Erzeuger, die
     * Hauseinführung nimmt CAD Light an. Wer hier einen Kessel vorschlüge,
     * schlüge einen zweiten Erzeuger vor.
     */
    const mitWp = haus({
      site: { pumps: { wp: { id: 'wp', form: 'monoblock-outdoor', position: { x: -3, y: 2 } } } },
    } as unknown as Partial<BimDocument>);
    check('Eine Wärmepumpe im Gelände auch', hatAusgangspunkt(mitWp), true);
  }

  // =========================================================================
  // 5 · Leeres Modell
  // =========================================================================
  {
    const leer = { levels: {}, rooms: {}, fixtures: {}, activeLevelId: '' } as unknown as BimDocument;
    check('Ohne Geschosse kein Vorschlag', schlageErzeugerVor(leer) === undefined, true);
    const ohneRaeume = haus({ rooms: {} } as unknown as Partial<BimDocument>);
    check('Ohne Räume auch nicht', schlageErzeugerVor(ohneRaeume) === undefined, true);
  }
}
