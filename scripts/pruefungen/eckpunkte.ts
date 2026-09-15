/**
 * Prüfblock „Eckpunkte" — was beim Zeichnen gefangen wird.
 *
 * **Warum das geprüft gehört.** Ein Fang, der zwei Zentimeter danebengreift,
 * erzeugt ein Modell, das *fast* stimmt — und das ist die teuerste Sorte
 * Fehler: Sie fällt nicht beim Zeichnen auf, sondern im Aufmaß, im
 * Massenauszug oder auf der Baustelle. Geprüft wird deshalb nicht „findet er
 * etwas", sondern **welchen** Punkt er findet, aus welcher Quelle, und wo
 * genau die Grenze der Toleranz liegt.
 *
 * Der zweite Punkt ist die **Geschossgrenze**. Ein Fang, der auf eine Ecke im
 * Geschoss darüber greift, setzt eine Wand an einen Ort, den man im Bild gar
 * nicht sieht. Einzige Ausnahme ist das Gelände: es gehört zum Grundstück und
 * nicht zu einer Etage, und wer im Obergeschoss zeichnet, soll die
 * Grundstücksgrenze trotzdem treffen.
 */

import type { CheckFn } from './typ';
import type { Annotation, BimDocument, Vec2 } from '../../src/types/bim';
import { ECKART_LABELS, naechsterEckpunkt, sammleEckpunkte } from '../../src/lib/eckpunkte';
import { distanceToAnnotation, textKasten } from '../../src/lib/annotationSymbols';

/** Ein Dokumentgerüst mit genau den Sammlungen, die der Fang liest. */
function baueDoc(): BimDocument {
  return {
    meta: { name: 'Fangprobe' },
    activeLevelId: 'eg',
    levels: {},
    layers: {},
    constructions: {},
    nodes: {},
    walls: {},
    openings: {},
    fixtures: {
      hk1: {
        id: 'hk1',
        levelId: 'eg',
        type: 'radiator',
        category: 'heating',
        position: { x: 2, y: 2 },
        rotation: 0,
        params: {},
      },
      hk2: {
        id: 'hk2',
        levelId: 'og',
        type: 'radiator',
        category: 'heating',
        position: { x: 2.02, y: 2 },
        rotation: 0,
        params: {},
      },
    },
    verticals: {
      t1: {
        id: 't1',
        kind: 'stair',
        name: 'Treppe',
        levelId: 'eg',
        position: { x: 10, y: 10 },
        width: 1,
        length: 3,
        rotation: 0,
      },
    },
    solids: {
      k1: {
        id: 'k1',
        kind: 'chimney',
        name: 'Kamin',
        levelId: 'eg',
        position: { x: 6, y: 6 },
        width: 0.4,
        length: 0.4,
        rotation: 0,
      },
    },
    pipes: {
      r1: {
        id: 'r1',
        levelId: 'eg',
        service: 'heating-flow',
        points: [
          { x: 0, y: 0 },
          { x: 4, y: 0 },
        ],
      },
      r2: {
        id: 'r2',
        levelId: 'og',
        service: 'heating-flow',
        points: [{ x: 0.05, y: 0 }],
      },
    },
    annotations: {},
    roofOpenings: {},
    rooms: {
      raum1: {
        id: 'raum1',
        levelId: 'eg',
        name: 'Wohnen',
        usage: 'living',
        area: 20,
        polygon: [
          { x: 0, y: 0 },
          { x: 5, y: 0 },
          { x: 5, y: 4 },
          { x: 0, y: 4 },
        ],
        innerPolygon: [
          { x: 0.12, y: 0.12 },
          { x: 4.88, y: 0.12 },
          { x: 4.88, y: 3.88 },
          { x: 0.12, y: 3.88 },
        ],
      },
    },
    site: {
      elements: {
        grenze: {
          id: 'grenze',
          kind: 'boundary',
          points: [
            { x: -5, y: -5 },
            { x: 20, y: -5 },
            { x: 20, y: 18 },
          ],
        },
      },
      pumps: {},
    },
    diagnostics: { openEnds: [], closure: [] },
  } as unknown as BimDocument;
}

export function pruefeEckpunkte(check: CheckFn): void {
  const doc = baueDoc();
  const punkte = sammleEckpunkte(doc, 'eg');
  const arten = (a: string): number => punkte.filter((p) => p.art === a).length;

  // =========================================================================
  // 1 · Was eingesammelt wird — und was nicht
  // =========================================================================
  {
    check('Geländeecken zählen mit', arten('gelaende'), 3);
    check('Leitungspunkte des Geschosses zählen mit', arten('leitung'), 2);
    check('Der Kamin liefert vier Ecken', arten('bauteil'), 4);
    check('Die Treppe liefert vier Ecken', arten('vertikal'), 4);
    check('Die lichten Raumecken zählen mit', arten('raum'), 4);
    check('TGA-Objekte zählen mit', arten('objekt'), 1);
    check('Ohne laufenden Zug gibt es keine Zugpunkte', arten('zug'), 0);
  }

  // =========================================================================
  // 2 · Die Geschossgrenze
  // =========================================================================
  {
    // Der Heizkörper im OG steht 2 cm neben dem im EG. Würde er mitgezählt,
    // fänge man im EG auf ein Objekt, das man gar nicht sieht.
    const treffer = naechsterEckpunkt(punkte, { x: 2.01, y: 2 }, 0.1);
    check('Gefangen wird der Heizkörper des eigenen Geschosses', treffer?.id ?? 'keiner', 'hk1');
    check('… und nicht der im Geschoss darüber', punkte.some((p) => p.id === 'hk2'), false);
    check('Die Leitung im OG bleibt draußen', punkte.some((p) => p.id === 'r2'), false);
    // Gegenprobe: dasselbe Dokument aus Sicht des OG.
    const oben = sammleEckpunkte(doc, 'og');
    check('Im OG zählt der dortige Heizkörper', oben.some((p) => p.id === 'hk2'), true);
    check('… und der aus dem EG nicht', oben.some((p) => p.id === 'hk1'), false);
    // Das Gelände gehört dem Grundstück, nicht der Etage.
    check('Das Gelände gilt in jedem Geschoss', oben.filter((p) => p.art === 'gelaende').length, 3);
  }

  // =========================================================================
  // 3 · Wo die Toleranz endet
  // =========================================================================
  {
    const ziel: Vec2 = { x: 20, y: -5 };
    check('Knapp innerhalb wird gefangen', naechsterEckpunkt(punkte, { x: 20.09, y: -5 }, 0.1)?.art ?? 'keiner', 'gelaende');
    check('Knapp außerhalb nicht', naechsterEckpunkt(punkte, { x: 20.11, y: -5 }, 0.1) === null, true);
    check('Genau getroffen ergibt Abstand null', naechsterEckpunkt(punkte, ziel, 0.1)?.punkt.x ?? -1, 20);
    check('Ohne Kandidaten fällt nichts an', naechsterEckpunkt([], ziel, 1) === null, true);
    check('Toleranz null fängt nichts', naechsterEckpunkt(punkte, ziel, 0) === null, true);
  }

  // =========================================================================
  // 4 · Der nächste gewinnt, nicht die Art
  // =========================================================================
  {
    // Bei (0,0) liegen Leitungsanfang und Raumecke dicht beieinander: die
    // Leitung genau dort, die lichte Ecke 17 cm entfernt. Eine Rangfolge nach
    // Art wäre eine Behauptung darüber, was gemeint ist — der Abstand ist
    // eine Messung.
    const nah = naechsterEckpunkt(punkte, { x: 0.02, y: 0.02 }, 0.5);
    check('Der nächstgelegene Punkt gewinnt', nah?.art ?? 'keiner', 'leitung');
    const naeherAnDerEcke = naechsterEckpunkt(punkte, { x: 0.13, y: 0.13 }, 0.5);
    check('… auch wenn es die Raumecke ist', naeherAnDerEcke?.art ?? 'keiner', 'raum');
  }

  // =========================================================================
  // 5 · Der laufende Zug
  // =========================================================================
  {
    // Der wichtigste Fall überhaupt: Wer eine Fläche umfährt, will den
    // vierten Punkt auf die Höhe des ersten legen.
    const zug: Vec2[] = [
      { x: 30, y: 30 },
      { x: 36, y: 30 },
      { x: 36, y: 34 },
    ];
    const mitZug = sammleEckpunkte(doc, 'eg', zug);
    check('Die Punkte des laufenden Zuges kommen dazu', mitZug.filter((p) => p.art === 'zug').length, 3);
    // Der Schluss der Umfahrung: zurück auf den Anfangspunkt, 4 cm daneben
    // gezeigt. Ohne diesen Fang wird die Fläche nicht zu, und aus dem
    // Grundstück wird ein offener Zug.
    const treffer = naechsterEckpunkt(mitZug, { x: 30.04, y: 30.02 }, 0.1);
    check('Der Anfangspunkt ist fangbar', treffer?.art ?? 'keiner', 'zug');
    check('… und liefert genau seine Koordinate', treffer?.punkt.x ?? -1, 30);
    // Gegenprobe: derselbe Zug, aber weit weg gezeigt.
    check('Weit daneben fängt nichts', naechsterEckpunkt(mitZug, { x: 32, y: 32 }, 0.1) === null, true);
  }

  // =========================================================================
  // 6 · Jede Art hat einen Klartext
  // =========================================================================
  {
    const fehlende = [...new Set(punkte.map((p) => p.art))].filter((a) => !ECKART_LABELS[a]);
    check('Jede vorkommende Art ist benannt', fehlende.length, 0);
    check('Die Benennung ist deutsch und knapp', ECKART_LABELS.gelaende, 'Geländepunkt');
  }

  // =========================================================================
  // 7 · Grenzfälle, die nicht abstürzen dürfen
  // =========================================================================
  {
    const leer = { meta: {}, activeLevelId: 'eg', rooms: {}, site: { elements: {}, pumps: {} } } as unknown as BimDocument;
    check('Ein fast leeres Dokument ergibt keine Punkte', sammleEckpunkte(leer, 'eg').length, 0);
    check('… und stürzt nicht ab', Array.isArray(sammleEckpunkte(leer, 'eg')), true);
  }
}

/**
 * Prüfblock „Beschriftungsfläche" — wo eine Textbeschriftung getroffen wird.
 *
 * **Der Befund.** Die Trefferprüfung maß den Abstand zum *Ankerpunkt*. Bei
 * einem Text von zwanzig Zeichen liegen damit rund 95 % der sichtbaren Fläche
 * tot: Man tippt auf das Wort, das man meint, und trifft nichts. Mit der Maus
 * ist das ärgerlich, mit dem Finger ist es der Regelfall.
 *
 * Geprüft wird die **Fläche**, nicht die Optik: dass sie am Anker beginnt, mit
 * dem Text nach rechts wächst, mit der Schriftgröße mitwächst — und dass sie
 * beim Hineinzoomen in Metern *kleiner* wird, denn die Schrift bleibt in
 * Bildpunkten gleich groß.
 */
export function pruefeBeschriftungsflaeche(check: CheckFn): void {
  const text = (label: string, scale = 1): Annotation => ({
    id: 'a1',
    kind: 'text',
    levelId: 'eg',
    points: [{ x: 10, y: 5 }],
    text: label,
    scale,
    offset: 0,
  });

  // =========================================================================
  // 1 · Der Kasten liegt am Anker und läuft nach rechts
  // =========================================================================
  {
    const k = textKasten(text('Steigleitung'), 100);
    check('Es gibt einen Kasten', k !== null, true);
    check('Er beginnt am Anker', Math.abs((k?.x0 ?? 0) - 10) < 0.05, true);
    check('Er läuft nach rechts', (k?.x1 ?? 0) > 10, true);
    // Zwölf Zeichen bei 10 px Schrift in Festbreite: rund 0,6 Geviert je
    // Zeichen, also etwa 72 px plus 8 px Rand — bei Zoom 100 sind das 0,8 m.
    check('Die Breite folgt der Zeichenzahl', Math.abs((k?.x1 ?? 0) - (k?.x0 ?? 0) - 0.8) < 0.12, true);
    check('Er ist um den Anker zentriert', Math.abs(((k?.y0 ?? 0) + (k?.y1 ?? 0)) / 2 - 5) < 1e-9, true);
  }

  // =========================================================================
  // 2 · Er wächst mit Text und Schriftgröße
  // =========================================================================
  {
    const kurz = textKasten(text('HK'), 100);
    const lang = textKasten(text('Heizkoerper Wohnzimmer'), 100);
    const breite = (k: ReturnType<typeof textKasten>): number => (k ? k.x1 - k.x0 : 0);
    check('Längerer Text, breiterer Kasten', breite(lang) > breite(kurz) * 3, true);
    const gross = textKasten(text('HK', 2), 100);
    check('Doppelte Schrift, höherer Kasten', (gross!.y1 - gross!.y0) > (kurz!.y1 - kurz!.y0) * 1.6, true);
    // Beim Hineinzoomen bleibt die Schrift in Bildpunkten gleich — in Metern
    // wird der Kasten also kleiner. Das ist keine Schwäche, sondern die
    // Bedingung dafür, dass Beschriftungen beim Zoomen lesbar bleiben.
    const nah = textKasten(text('HK'), 400);
    check('Beim Hineinzoomen schrumpft er in Metern', breite(nah) < breite(kurz) / 3, true);
  }

  // =========================================================================
  // 3 · Die Trefferprüfung nimmt die Fläche
  // =========================================================================
  {
    const note = text('Steigleitung');
    const mitte = { x: 10.4, y: 5 };
    check('Mitten im Wort trifft', distanceToAnnotation(note, mitte, 100), 0, 1e-9);
    check('… und ohne Zoom-Angabe eben nicht', distanceToAnnotation(note, mitte) > 0.3, true);
    check('Weit daneben trifft nicht', distanceToAnnotation(note, { x: 12, y: 5 }, 100) > 0.5, true);
    check('Direkt am Anker trifft', distanceToAnnotation(note, { x: 10, y: 5 }, 100), 0, 1e-9);
    // Links vom Anker ist außerhalb — dort steht nichts.
    check('Links daneben ist außerhalb', distanceToAnnotation(note, { x: 9.5, y: 5 }, 100) > 0.4, true);
  }

  // =========================================================================
  // 4 · Andere Arten bleiben, wie sie waren
  // =========================================================================
  {
    const fahne: Annotation = {
      id: 'a2',
      kind: 'leader',
      levelId: 'eg',
      points: [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
      ],
      text: 'Hinweis',
      scale: 1,
      offset: 0,
    };
    check('Für die Fahne gibt es keinen Textkasten', textKasten(fahne, 100) === null, true);
    check('… sie wird weiter an ihrer Linie getroffen', distanceToAnnotation(fahne, { x: 1, y: 0.02 }, 100), 0.02, 1e-9);
  }
}
