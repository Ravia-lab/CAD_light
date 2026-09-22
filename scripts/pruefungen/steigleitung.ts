/**
 * Prüfblock „Steigleitung — Erzeuger unten, Abnahme oben".
 * ---------------------------------------------------------------------------
 * **Die Meldung (22.09.2026):** „Wenn der Wärmeerzeuger unten ist und die
 * Abnahme oben, oder der Speicher im Keller steht, gibt es keine Strecke nach
 * oben. Einfamilienhaus: Wärmepumpe im Garten, Verrohrung geht in den
 * Technikraum im Keller, wo Speicher oder anderes steht, und fängt von dort an
 * nach oben zu verteilen (Steigleitung)."
 *
 * **Das Prüfhaus** — zwei Geschosse übereinander, je 8 × 6 m auf den Achsen,
 * Außenwand 36 cm (halbe Stärke 0,18 m), Geschosshöhe 2,50 m:
 *
 *        (0,6) ─────────────── (8,6)
 *          │                      │
 *          │   ein Raum je Geschoss
 *          │                      │
 *        (0,0) ─────────────── (8,0)
 *
 *   KG: Pufferspeicher bei (2 | 1,5), kein Verbraucher.
 *   EG: zwei Heizkörper mit je 1000 W an der Südwand.
 *
 * **Handrechnung Strangpunkt.** Kein Schacht, also lotrecht über dem
 * Speicher: (2 | 1,5) liegt im EG-Raum (lichtes Rechteck 0,18…7,82 ×
 * 0,18…5,82). Die Wandflächen sind 1,32 m (Süd, y = 0,18), 1,82 m (West,
 * x = 0,18), 4,32 m (Nord) und 5,82 m (Ost) entfernt — die Südwand gewinnt
 * eindeutig. Der Punkt rückt dorthin und 0,12 m zurück ins Zimmer:
 * **(2 | 0,30)**.
 *
 * **Handrechnung Strom.** 2 × 1000 W bei 55/45 °C, also 10 K. Wasser bei
 * 50 °C: ρ ≈ 988 kg/m³, c ≈ 4,18 kJ/(kg·K) →
 * V = 2,0 / (988 · 4,18 · 10) m³/s = 4,843 · 10⁻⁵ m³/s = **0,174 m³/h**.
 * Diesen Strom trägt der Strang, und nur diesen.
 *
 * **Handrechnung Länge.** Der Strang steht senkrecht: von der Verlegehöhe im
 * Sockelleistenkanal (0,04 m) bis zur Rohdecke des Kellers (2,50 m), also
 * 2,46 m je Rohr, 4,92 m für Vor- und Rücklauf.
 */

import type { BimDocument, BimNode, Fixture, Level, Room, Wall } from '../../src/types/bim';
import { detectRooms } from '../../src/lib/roomDetection';
import { emptyPlant, emptySite } from '../../src/lib/plantDefaults';
import { planeGebaeudeNetz } from '../../src/lib/gebaeudeNetz';
import { steigpunkt } from '../../src/lib/steigstrang';
import type { CheckFn } from './typ';

const HOEHE = 2.5;

function baueHaus(optionen: { speicherGeschoss?: 'kg' | 'eg'; schacht?: boolean; ohneOG?: boolean } = {}): BimDocument {
  const levels: Record<string, Level> = {
    kg: { id: 'kg', name: 'KG', order: 0, elevation: 0, height: HOEHE, floorUValue: 0.35, floorBoundary: 'ground', ceilingUValue: 0.2, ceilingBoundary: 'heated' } as unknown as Level,
    eg: { id: 'eg', name: 'EG', order: 1, elevation: HOEHE, height: HOEHE, floorUValue: 0.35, floorBoundary: 'heated', ceilingUValue: 0.2, ceilingBoundary: 'unheated' } as unknown as Level,
  };
  const nodes: Record<string, BimNode> = {};
  const walls: Record<string, Wall> = {};
  for (const levelId of ['kg', 'eg']) {
    const ecken = [
      { id: `${levelId}-a`, x: 0, y: 0 },
      { id: `${levelId}-b`, x: 8, y: 0 },
      { id: `${levelId}-c`, x: 8, y: 6 },
      { id: `${levelId}-d`, x: 0, y: 6 },
    ];
    for (const e of ecken) nodes[e.id] = { id: e.id, x: e.x, y: e.y, levelId } as BimNode;
    for (let i = 0; i < 4; i++) {
      const id = `${levelId}-w${i}`;
      walls[id] = {
        id, a: ecken[i].id, b: ecken[(i + 1) % 4].id, levelId, type: 'exterior',
        thickness: 0.36, uValue: 0.28, height: HOEHE, layerId: 'layer-walls',
      } as Wall;
    }
  }

  const fixtures: Record<string, Fixture> = {};
  const geschossDesSpeichers = optionen.speicherGeschoss ?? 'kg';
  fixtures.puffer = {
    id: 'puffer', type: 'storage', category: 'heating', levelId: geschossDesSpeichers,
    position: { x: 2, y: 1.5 }, rotation: 0, length: 0.6, depth: 0.6, elevation: 0,
    label: 'Pufferspeicher', params: { volumeL: 300 },
  } as Fixture;
  if (!optionen.ohneOG) {
    for (const [i, x] of [2, 6].entries()) {
      fixtures[`hk${i}`] = {
        id: `hk${i}`, type: 'radiator', category: 'heating', levelId: 'eg',
        position: { x, y: 0.23 }, rotation: 0, length: 1, depth: 0.1, elevation: 0.15,
        label: `Heizkörper ${i + 1}`,
        params: { powerW: 1000, flowTemperature: 55, returnTemperature: 45 },
      } as Fixture;
    }
  }

  const verticals: BimDocument['verticals'] = {};
  if (optionen.schacht) {
    verticals.sch = {
      id: 'sch', kind: 'shaft', name: 'Installationsschacht', levelId: 'kg', toLevelId: 'eg',
      position: { x: 7, y: 5 }, width: 0.4, length: 0.4, rotation: 0, deductsArea: true,
    } as BimDocument['verticals'][string];
  }

  const doc = {
    site: emptySite(), plant: emptyPlant(),
    meta: { name: 'Prüfhaus Steigleitung', createdAt: '', modifiedAt: '', northAngle: 0 },
    levels, activeLevelId: 'eg', nodes, walls, openings: {}, rooms: {}, fixtures,
    verticals, solids: {}, durchbrueche: {}, pipes: {}, pipeAccessories: {},
    annotations: {}, freihand: {}, roofOpenings: {}, constructions: {}, layers: {},
    diagnostics: { openEnds: [], closure: [] },
  } as unknown as BimDocument;

  const raeume: Room[] = [];
  for (const levelId of ['kg', 'eg']) {
    raeume.push(
      ...detectRooms({
        nodes,
        walls: Object.values(walls).filter((w) => w.levelId === levelId),
        openings: [],
        levelId,
        defaultHeight: HOEHE,
        northAngle: 0,
      }),
    );
  }
  doc.rooms = Object.fromEntries(raeume.map((r) => [r.id, { ...r, isHeated: true, setpointTemperature: 20 }]));
  for (const f of Object.values(doc.fixtures)) {
    const raum = Object.values(doc.rooms).find((r) => r.levelId === f.levelId);
    if (raum) f.roomId = raum.id;
  }
  return doc;
}

export function pruefeSteigleitung(check: CheckFn): void {
  // =========================================================================
  // 1 · Wo der Strang steht
  // =========================================================================
  {
    const doc = baueHaus();
    const oben = Object.values(doc.rooms).filter((r) => r.levelId === 'eg');
    const p = steigpunkt({
      quelle: { x: 2, y: 1.5 },
      levels: doc.levels,
      vonLevelId: 'kg',
      nachLevelId: 'eg',
      verticals: [],
      raeumeOben: oben,
    });
    check('Ohne Schacht: lotrecht über der Quelle', p?.grund ?? 'fehlt', 'lotrecht');
    check('… an die Südwand gezogen, x bleibt (Handrechnung)', Math.round((p?.position.x ?? 0) * 100) / 100, 2);
    check('… y = 0,18 + 0,12 = 0,30 m', Math.round((p?.position.y ?? 0) * 100) / 100, 0.3);

    const mitSchacht = baueHaus({ schacht: true });
    const ps = steigpunkt({
      quelle: { x: 2, y: 1.5 },
      levels: mitSchacht.levels,
      vonLevelId: 'kg',
      nachLevelId: 'eg',
      verticals: Object.values(mitSchacht.verticals ?? {}),
      raeumeOben: Object.values(mitSchacht.rooms).filter((r) => r.levelId === 'eg'),
    });
    check('Mit Schacht: der Schacht gewinnt', ps?.grund ?? 'fehlt', 'schacht');
    check('… und zwar genau dort', `${ps?.position.x},${ps?.position.y}`, '7,5');
  }

  // =========================================================================
  // 2 · Das Netz über beide Geschosse
  // =========================================================================
  {
    const doc = baueHaus();
    const erg = planeGebaeudeNetz(doc, { mode: 'sanierung', levelId: 'eg' });

    check('Beide Geschosse geplant', erg.geschosse.length, 2);
    check('Ein Strangabschnitt', erg.straenge.length, 1);
    check('… vom KG ins EG', `${erg.straenge[0]?.vonLevelId}→${erg.straenge[0]?.nachLevelId}`, 'kg→eg');
    check('Zwei Heizkörper versorgt', erg.served >= 2, true);

    const straenge = erg.runs.filter((r) => (r.label ?? '').startsWith('Steigleitung'));
    check('Vor- und Rücklauf des Strangs', straenge.length, 2);
    check('Der Strang liegt im KG', straenge.every((r) => r.levelId === 'kg'), true);
    check('Er beginnt im Sockelleistenkanal (0,04 m)', straenge[0]?.elevation ?? -1, 0.04);
    check('… und endet an der Rohdecke (2,50 m)', straenge[0]?.elevationTo ?? -1, 2.5);
    check('Er steht am Strangpunkt (x = 2,00 ± Paarabstand)', Math.abs((straenge[0]?.points[0].x ?? 0) - 2) <= 0.05, true);

    /*
     * 2 × 1000 W bei 10 K Spreizung: V = 2,0 / (988 · 4,18 · 10) m³/s
     * = 0,174 m³/h. Der Strang trägt genau das — er versorgt nur das EG.
     */
    check('Der Strang trägt die Last des EG [m³/h]', straenge[0]?.designFlow ?? 0, 0.174, 0.005);
    check('… dasselbe sagt das EG als Stammstrom', erg.geschosse.find((g) => g.levelId === 'eg')?.designFlow ?? 0, 0.174, 0.005);
    check('Die Geschwindigkeit hält den Richtwert', (straenge[0]?.velocity ?? 9) <= 1.0, true);
    check('Das Druckgefälle auch', (straenge[0]?.gradient ?? 999) <= 150, true);

    /*
     * Länge: 2,50 − 0,04 = 2,46 m senkrecht je Rohr. In der verlegten Länge
     * des Gebäudes stecken beide, also 4,92 m — plus die Trasse im Grundriss.
     */
    const senkrecht = 2 * (2.5 - 0.04);
    check('Der Strang zählt in der Rohrlänge mit', erg.pipeLength >= senkrecht, true);

    check('Das EG weiß, woher die Zuleitung kommt',
      erg.notes.some((n) => n.text.includes('beginnt am Fuß der Steigleitung')), true);
    check('Der Befund nennt die Deckendurchführung',
      erg.notes.some((n) => n.text.includes('Kernbohrung und vor Ort festzulegen')), true);
    check('Kein „Zuleitung kommt von außerhalb" mehr',
      erg.notes.some((n) => n.text.includes('von außerhalb dieses Geschosses')), false);
    check('Kein Befund der Stufe Fehler', erg.notes.filter((n) => n.severity === 'error').length, 0);
  }

  // =========================================================================
  // 3 · Wenn es nichts zu verbinden gibt, bleibt alles beim Alten
  // =========================================================================
  {
    // Speicher und Heizkörper auf demselben Geschoss: kein Strang.
    const doc = baueHaus({ speicherGeschoss: 'eg' });
    const erg = planeGebaeudeNetz(doc, { mode: 'sanierung', levelId: 'eg' });
    check('Ein Geschoss, kein Strang', erg.straenge.length, 0);
    check('… und trotzdem ein Netz', erg.runs.length > 0, true);
    check('Kein Steigleitungsrohr', erg.runs.some((r) => (r.label ?? '').startsWith('Steigleitung')), false);
  }

  // =========================================================================
  // 4 · Der Strang folgt dem Schacht, wenn einer da ist
  // =========================================================================
  {
    const doc = baueHaus({ schacht: true });
    const erg = planeGebaeudeNetz(doc, { mode: 'sanierung', levelId: 'eg' });
    check('Strangabschnitt über den Schacht', erg.straenge[0]?.grund ?? 'fehlt', 'schacht');
    const strang = erg.runs.find((r) => (r.label ?? '').startsWith('Steigleitung'));
    check('… und er steht im Schacht (x ≈ 7)', Math.abs((strang?.points[0].x ?? 0) - 7) <= 0.05, true);
    check('… y ≈ 5', Math.abs((strang?.points[0].y ?? 0) - 5) <= 0.05, true);
  }
}
