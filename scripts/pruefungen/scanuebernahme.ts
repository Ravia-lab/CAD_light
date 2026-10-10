/**
 * Prüfblock: Übernahme des ersten echten Feldscans (RaVia Scan, Schema 1.10.0).
 * ---------------------------------------------------------------------------
 *
 * **Der Prüffall.** `scripts/referenz/scan-wohnung-2026-10-02.json` — eine
 * Wohnung in Friedberg, aufgenommen am 02.10.2026 mit App-Build 16, Datei
 * unverändert aus der App (MD5 024ed785dd73d671004cf736b621b764). Daneben
 * im Ordner `scan-wohnung-2026-10-02/` die Ausgaben der App zum Vergleich
 * (Grundriss, Ansicht, Raumliste, Rohaufnahme).
 *
 * **Was der Scan enthält** (von Hand aus der Datei gelesen):
 *
 *   · ein Geschoss „EG", Höhe 2,41 m; 48 Wände, 21 Öffnungen
 *   · L-Grundriss: Hauptbau x −13,3…1,1 / y −7,3…0,4, Flügel x −2,4…1,1 /
 *     y 1,2…6,4
 *   · ein Satteldach, 36,2°, Kniestock 1,24 m, Fallrichtungen 295,2° und
 *     115,2°; zwei Dachsegmente (295,2° / 36,2° und 115,2° / 36,8°)
 *   · Kniestockwände w-002 und w-006 (1,235 m hoch), Profilwände w-015,
 *     w-029, w-034, w-035, w-043, w-047; drei Innenwände über der
 *     Geschosshöhe: w-005, w-040, w-047 (je 2,646 m)
 *   · im Flügel keine einzige dieser Wände
 *   · ein Raum „Manu" vom Monteur über das ganze Geschoss (118,67 m²),
 *     vier Raumhinweise der App: Wohnen, Essen, Küche, Bad
 *   · fünf Prüfpunkte der App, zwei davon mit Ort (beide am selben Punkt)
 *   · Genauigkeit angenommen, kein Kontrollmaß, ± 3,01 % Fläche
 *   · Lage unter `project.location`
 *
 * **Die Abnahme aus dem Auftrag:** Hauptbau unter dem Satteldach, Flügel mit
 * gerader Decke und Hinweis, keine sich kreuzenden Dachflächen.
 *
 * Nachgestellt wird der Ablauf aus `loadBuilding` im Store — ohne den Store,
 * weil ein Prüfblock die Schichtgrenze des Rechenkerns nicht überschreiten
 * darf: Import → Raumerkennung → Benennung → Dachzuordnung → Raumerkennung
 * mit Dach. Die Funktionen sind dieselben, die der Store aufruft.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CheckFn } from './typ';
import type { BimDocument, Level, Room } from '../../src/types/bim';
import { DEFAULT_CONSTRUCTIONS } from '../../src/types/bim';
import { importBuildingModel } from '../../src/lib/buildingModelImport';
import { detectRooms } from '../../src/lib/roomDetection';
import { baueDachlandschaft, dachteilAn, daecherVon, dachUeberRaum } from '../../src/lib/dachlandschaft';
import { benenneRaeume, pruefpunkteAlsHinweise, scanDachZuordnen, uebernimmBeheizung } from '../../src/lib/scanUebernahme';
import { buildRaviaExport } from '../../src/lib/raviaExport';
import { pruefeGegenSchema, type Schema } from '../vertrag/pruefeSchema';
import { validateModel } from '../../src/lib/validation';
import { pointInPolygon, polygonArea } from '../../src/lib/geometry';
import { emptyPlant, emptySite } from '../../src/lib/plantDefaults';

const SCHEMA = join(process.cwd(), 'ravia-vertrag', 'schema', 'ravia.bim.light-2.16.0.schema.json');
const schema = (): Schema => JSON.parse(readFileSync(SCHEMA, 'utf8')) as Schema;
/** Geprüft wird die Datei, wie sie geschrieben wird — `undefined` fällt dabei weg. */
const alsDatei = (e: unknown): unknown => JSON.parse(JSON.stringify(e));

const DATEI = join(process.cwd(), 'scripts', 'referenz', 'scan-wohnung-2026-10-02.json');

/** Punkte, an denen die Räume eindeutig zu finden sind (von Hand aus dem Grundriss). */
const ORT = {
  fluegel: { x: -0.7, y: 3.8 },
  wohnen: { x: -1.079, y: -3.649 }, // Raumhinweis der App
  nordtraufeMitte: { x: -7.6, y: -5.3 }, // der Raum ohne Kniestockkennung
  ostSued: { x: -1.0, y: -0.4 }, // Hauptbau-Ostteil bis y 1,17
};

export function pruefeScanUebernahme(check: CheckFn): void {
  console.log('\n▸ Scan-Übernahme — Feldscan vom 02.10.2026 (Schema 1.10.0)');
  const roh = JSON.parse(readFileSync(DATEI, 'utf8'));
  check('Feldscan · Schema 1.10.0', roh.schemaVersion, '1.10.0');

  const r = importBuildingModel(roh);
  check('Import · gelingt', r.ok, true);

  // --- A3: was neu gelesen wird --------------------------------------------
  check('Import · Lage aus project.location (Breite vorhanden)', typeof r.koordinaten?.breite === 'number', true);
  check('Import · Breite = Datei', r.koordinaten?.breite ?? 0, roh.project.location.latitude, 1e-9);
  // 3,01 → eine Nachkommastelle → „3,0"; basis „assumed", scaleChecked false.
  check('Import · Toleranz im Wortlaut', r.toleranz ?? '', '± 3,0 % (angenommen, kein Kontrollmaß)');
  check('Import · Toleranz steht in der Meldung', r.message.includes('Toleranz ± 3,0 % (angenommen, kein Kontrollmaß)'), true);
  {
    const gemessen = importBuildingModel({ ...roh, accuracy: { ...roh.accuracy, basis: 'measured', scaleChecked: true, roomAreaUncertaintyPct: 1.08 } });
    check('Import · gemessene Toleranz: „± 1,1 % (gemessen)"', gemessen.toleranz ?? '', '± 1,1 % (gemessen)');
  }
  // Fünf Prüfpunkte, zwei mit Ort (room.noDoor, room.noEmitter), drei ohne.
  check('Import · zwei Prüfpunkte mit Ort', r.pruefpunkte.length, 2);
  check('Import · drei Prüfpunkte ohne Ort', r.pruefhinweise.length, 3);
  check('Import · Prüfpunkt-Codes', r.pruefpunkte.map((p) => p.code).sort().join(','), 'room.noDoor,room.noEmitter');

  check('Import · bekannte Dachform: kein Dach-Hinweis', r.pruefhinweise.some((h) => h.code === 'import.dachUnbekannt'), false);
  {
    // B12: kind „unknown" legt kein Dach an — das sagt jetzt ein Hinweis.
    const unbekannt = importBuildingModel({
      ...roh,
      levels: roh.levels.map((l: { id: string; roof?: object }) =>
        l.id === 'level-0' && l.roof ? { ...l, roof: { ...l.roof, kind: 'unknown' } } : l,
      ),
    });
    check('Dach unbekannt · kein Dach angelegt', unbekannt.daecher['level-0'] === undefined, true);
    const h = unbekannt.pruefhinweise.find((x) => x.code === 'import.dachUnbekannt');
    check('Dach unbekannt · Hinweis vorhanden', !!h, true);
    check('Dach unbekannt · als Warnung', h?.schwere ?? '', 'warning');
  }

  const dach = r.daecher['level-0'];
  check('Dach · Satteldach', dach?.kind ?? '', 'gable');
  check('Dach · 36,2°', dach?.pitch ?? 0, 36.2, 1e-9);
  /*
   * Kompass 295,2° → Plan: + Nordabweichung. Norden zeigt im Plan nach 205°
   * (gegen +x), die Abweichung von Plan-oben ist 90° − 205° = −115°:
   * 295,2° − 115° = 180,2°. Das Dach fällt also nach Plan-unten, zur
   * Kniestockwand bei y = −7,27 — und genau so zeichnet die App es in ihrer
   * eigenen Ansicht. Bis 1.69.0 stand hier 295,2°, und das Dach lag um 25°
   * verdreht über dem Haus.
   */
  check('Dach · Fallrichtung im Plan 180,2° (Kompass 295,2° + Nordabweichung −115°)', dach?.azimuth ?? 0, 180.2, 1e-6);
  check('Dach · Segmente bleiben Kompassrichtung (295,2°)', dach?.scan.segmente[0]?.azimuth ?? 0, 295.2, 1e-6);
  check('Dach · zwei Segmente gelesen', dach?.scan.segmente.length ?? 0, 2);
  check('Dach · Segment 2: 115,2° / 36,8°', `${dach?.scan.segmente[1]?.azimuth}/${dach?.scan.segmente[1]?.pitch}`, '115.2/36.8');
  /*
   * `roof.source` fehlt im Feldscan — die Datei sagt nicht, ob gemessen oder
   * geschätzt. Die Prüfliste sagt es („roof.notAimed": Kniestock und First
   * geschätzt). Der Import nimmt das mit; ohne die Prüflistenzeile bliebe es
   * „unbekannt".
   */
  check('Dach · Herkunft geschätzt (aus der Prüfliste roof.notAimed)', dach?.scan.herkunft ?? '', 'geschaetzt');
  {
    const ohneZeile = importBuildingModel({ ...roh, checklist: roh.checklist.filter((c: { code: string }) => c.code !== 'roof.notAimed') });
    check('Dach · ohne Prüflistenzeile und ohne source: unbekannt', ohneZeile.daecher['level-0']?.scan.herkunft ?? '', 'unbekannt');
    const gemessen = importBuildingModel({
      ...roh,
      levels: roh.levels.map((l: Level & { roof: object }) => ({ ...l, roof: { ...l.roof, source: 'user', ridgeHeight: 4.95, userDelta: -0.08 } })),
    });
    const d = gemessen.daecher['level-0'];
    check('Dach · source „user" → gemessen', d?.scan.herkunft ?? '', 'gemessen');
    check('Dach · Firsthöhe gelesen', d?.scan.firsthoehe ?? 0, 4.95, 1e-9);
    check('Dach · Korrektur gelesen', d?.scan.korrektur ?? 0, -0.08, 1e-9);
  }

  // Gegenprobe netArea: Summe der Außenwände = summary.exteriorWallNetArea.
  {
    const aussen = (roh.walls as { id: string; type: string }[]).filter((w) => w.type === 'exterior');
    const summe = aussen.reduce((s, w) => s + (r.wandNettoflaechen[w.id] ?? 0), 0);
    check('Import · netArea der Außenwände summiert = summary (116,21 m²)', summe, roh.summary.exteriorWallNetArea, 0.06);
  }

  // Volumen des Scans: ein Raum über das Geschoss, 273,28 m³ unter dem
  // Dachmodell, 285,4 m³ mit gerader Decke.
  {
    const v = r.scanVolumen.find((x) => x.levelId === 'level-0');
    check('Import · Scanvolumen EG gelesen [m³]', v?.volumen ?? 0, 273.3, 1e-9);
    check('Import · … mit gerader Decke [m³]', v?.volumenGerade ?? 0, 285.4, 1e-9);
    check('Import · … Quelle Dachmodell', v?.quelle ?? '', 'roofModel');
  }

  // --- Dachbelege ------------------------------------------------------------
  {
    const belege = new Set(r.dachBelege['level-0'] ?? []);
    const quelle = (id: string) => [...belege].some((b) => b === id || b.startsWith(id + 's'));
    for (const id of ['w-002', 'w-006']) check(`Dachbeleg · Kniestock ${id}`, quelle(id), true);
    for (const id of ['w-015', 'w-029', 'w-034', 'w-035', 'w-043', 'w-047']) check(`Dachbeleg · Profil ${id}`, quelle(id), true);
    for (const id of ['w-005', 'w-040']) check(`Dachbeleg · über Geschosshöhe ${id} (2,646 m)`, quelle(id), true);
    for (const id of ['w-001', 'w-016', 'w-044', 'w-045']) check(`Dachbeleg · Flügelwand ${id} ist keiner`, quelle(id), false);
    check('Dach · Lage belegt', dach?.scan.lageBelegt ?? false, true);
  }

  // --- Ablauf wie im Store ---------------------------------------------------
  const nodes = Object.fromEntries(r.nodes.map((n) => [n.id, n]));
  const level: Level = {
    id: 'level-0', name: 'EG', order: 0, elevation: 0, height: r.levels[0].height,
    floorUValue: 0.3, floorBoundary: 'ground', ceilingUValue: 0.2, ceilingBoundary: 'unheated',
  } as Level;
  const levels: Record<string, Level> = { 'level-0': level };
  const erkenne = (vorige: Room[]): Room[] =>
    detectRooms({
      walls: r.walls, nodes, openings: r.openings, levelId: 'level-0', defaultHeight: level.height, northAngle: 0,
      previous: vorige,
      roofFrames: baueDachlandschaft({ level: levels['level-0'], walls: r.walls, nodes, rooms: vorige })
        .map((t) => t.frame)
        .filter((f): f is NonNullable<typeof f> => f !== null),
    });

  const erste = erkenne([]);
  check('Räume · elf erkannt (Wände mit Achsen, 112,6 m² licht)', erste.length, 11);
  const raeume: Record<string, Room> = Object.fromEntries(erste.map((z) => [z.id, z]));
  const namen = benenneRaeume({ rooms: raeume }, r.raumHinweise);
  check('Namen · „Manu" ist ein Bereich und benennt keinen Raum', namen.bereiche.join(','), 'Manu');
  check('Namen · kein Raum heißt „Manu"', Object.values(raeume).some((z) => z.name === 'Manu'), false);
  check('Namen · Wohnen, Essen, Küche, Bad vergeben', namen.benannt, 4);
  {
    // Gegenprobe: Zerlegt die App die Fläche selbst, gilt der Monteursname wieder.
    const wohnen = Object.values(raeume).find((z) => pointInPolygon(ORT.wohnen, z.polygon))!;
    const teil = { ...structuredClone(raeume) };
    const n2 = benenneRaeume({ rooms: teil }, [
      { punkt: ORT.wohnen, usage: 'living', name: 'Wohnzimmer Manu', levelId: 'level-0', vomNutzer: true, flaeche: wohnen.polygon },
      ...r.raumHinweise.filter((h) => !h.vomNutzer),
    ]);
    check('Namen · ein Monteursraum über genau einem Raum benennt ihn', teil[wohnen.id].name, 'Wohnzimmer Manu');
    check('Namen · … und ist kein Bereich', n2.bereiche.length, 0);
  }

  const zuordnung = scanDachZuordnen(levels, Object.values(raeume), r);
  const z = zuordnung[0];
  const raumAn = (p: { x: number; y: number }) => Object.values(raeume).find((x) => pointInPolygon(p, x.polygon))!;
  const fluegel = raumAn(ORT.fluegel);
  check('Dach · zehn Räume unter der Schräge', z.unterDach.length, 10);
  check('Dach · ein Raum mit gerader Decke', z.ohneDach.length, 1);
  check('Dach · … und das ist der Flügel', z.ohneDach[0], fluegel.id);
  // Ohne das Merkmal „über Geschosshöhe" fiele dieser Raum heraus — ein Loch im Hauptdach.
  check('Dach · Raum an der Nordtraufe ohne Kniestockkennung liegt drunter', z.unterDach.includes(raumAn(ORT.nordtraufeMitte).id), true);
  check('Dach · Ostteil des Hauptbaus bis y 1,17 liegt drunter', z.unterDach.includes(raumAn(ORT.ostSued).id), true);
  check('Dach · genau ein Dach im Geschoss (keine zweite, kreuzende Fläche)', daecherVon(levels['level-0']).length, 1);
  check('Dach · level.roof ist leer, das Dach steht in roofs', levels['level-0'].roof === undefined, true);
  check('Dach · Herkunft am Dach gespeichert', daecherVon(levels['level-0'])[0].scan?.herkunft ?? '', 'geschaetzt');

  // Zweite Erkennung mit Dach — Kennungen müssen stehen bleiben.
  const zweite = erkenne(Object.values(raeume));
  check('Erkennung mit Dach · dieselben elf Kennungen', zweite.map((x) => x.id).sort().join(','), erste.map((x) => x.id).sort().join(','));
  const teile = baueDachlandschaft({ level: levels['level-0'], walls: r.walls, nodes, rooms: zweite });
  check('Dachgerüst · gebaut', teile[0]?.frame !== null, true);
  // Ein Gerüst ohne Umriss gälte für das ganze Geschoss — dann wäre die Raumliste wirkungslos.
  check('Dachgerüst · hat einen Umriss (sonst deckte es das ganze Geschoss)', (teile[0]?.frame?.umriss.length ?? 0) >= 3, true);
  check('Dachgerüst · Flügelmitte liegt unter keinem Dach', dachteilAn(teile, ORT.fluegel) === undefined, true);
  check('Dachgerüst · Wohnen liegt unter dem Dach', dachteilAn(teile, ORT.wohnen) !== undefined, true);
  {
    const fl = zweite.find((x) => x.id === fluegel.id)!;
    check('Flügel · kein Dachbefund am Raum (gerade Decke)', fl.roof === undefined, true);
    // Gerade Decke: Die Raumhöhe ist die Wandhöhe aus dem Scan (2,405 m) —
    // nicht die auf Zentimeter gerundete Geschosshöhe 2,41 m, wie der erste
    // Lauf dieses Blocks erwartet hatte. Mein Fehler beim Herleiten, nicht
    // der des Programms.
    check('Flügel · Raumhöhe = Wandhöhe aus dem Scan 2,405 m', fl.height, 2.405, 1e-6);
    const wo = zweite.find((x) => pointInPolygon(ORT.wohnen, x.polygon))!;
    check('Wohnen · hat Dachwerte (Schräge)', wo.roof !== undefined, true);
    check('Dach über Raum · Flügel: keins', dachUeberRaum(levels['level-0'], fl.id) === undefined, true);
    check('Dach über Raum · Wohnen: Dach aus Scan', dachUeberRaum(levels['level-0'], wo.id)?.name ?? '', 'Dach aus Scan');
  }

  // --- Prüfung ---------------------------------------------------------------
  {
    const doc = {
      version: 1, meta: { name: 'Feldscan', northAngle: 0, thermalBridgeMethod: 'flat', thermalBridgeSupplement: 0.05 },
      levels, nodes, walls: Object.fromEntries(r.walls.map((w) => [w.id, w])),
      openings: Object.fromEntries(r.openings.map((o) => [o.id, o])),
      rooms: Object.fromEntries(zweite.map((x) => [x.id, x])),
      fixtures: {}, verticals: {}, solids: {}, annotations: {}, pipes: {}, pipeAccessories: {}, durchbrueche: {},
      roofOpenings: {}, constructions: {}, layers: {}, plant: emptyPlant(), site: emptySite(),
      diagnostics: { openEnds: [], closure: [] }, activeLevelId: 'level-0',
    } as unknown as BimDocument;
    const befunde = validateModel(doc).issues.filter((i) => i.code === 'roof.scan-not-captured');
    check('Prüfung · ein Hinweis „Dach nicht erfasst"', befunde.length, 1);
    check('Prüfung · … am Flügel', befunde[0]?.target?.id ?? '', fluegel.id);
    check('Prüfung · … im Wortlaut des Auftrags', befunde[0]?.message.includes('Dach über diesem Gebäudeteil nicht erfasst — prüfen') ?? false, true);
    check('Prüfung · Warnung', befunde[0]?.severity ?? '', 'warning');
  }

  // --- Abnahme 1.73.0: beheizt/unbeheizt aus dem Scan, Export 2.15.0 --------
  /*
   * Der Feldscan selbst trägt kein `heated` (Schema 1.10.0) — die Abnahme
   * „unbeheizte Räume kommen unbeheizt an" wird deshalb an zwei Abwandlungen
   * derselben Datei gezeigt: (a) der Monteursbereich „Manu" unbeheizt, (b)
   * „Manu" beheizt und ein zweiter Scanraum über dem Flügel unbeheizt. Bei
   * (b) liegt der Flügel in beiden Flächen; die engere muss gewinnen, sonst
   * überdeckt der Bereich jede Einzelangabe.
   */
  {
    const dokument = (raeumeListe: Room[]): BimDocument =>
      ({
        // Projektdaten wie ein neues Projekt im Store (emptyDocument).
        version: 1,
        meta: {
          name: 'Feldscan', createdAt: '2026-10-02T00:00:00.000Z', modifiedAt: '2026-10-02T00:00:00.000Z', northAngle: 0,
          designOutdoorTemperature: -12, designIndoorTemperature: 20, n50: 3, shielding: 'moderate', groundTemperature: 10,
          thermalBridgeSupplement: 0.1, thermalBridgeMethod: 'flat', thermalBridgeCategory: 'none', reheatFactor: 0,
        },
        levels, nodes, walls: Object.fromEntries(r.walls.map((w) => [w.id, w])),
        openings: Object.fromEntries(r.openings.map((o) => [o.id, o])),
        rooms: Object.fromEntries(raeumeListe.map((x) => [x.id, structuredClone(x)])),
        fixtures: {}, verticals: {}, solids: {}, annotations: {}, pipes: {}, pipeAccessories: {}, durchbrueche: {},
        roofOpenings: {}, constructions: Object.fromEntries(DEFAULT_CONSTRUCTIONS.map((c) => [c.id, c])), layers: {}, plant: emptyPlant(), site: emptySite(),
        diagnostics: { openEnds: [], closure: [] }, activeLevelId: 'level-0',
      }) as unknown as BimDocument;
    const fl = zweite.find((x) => x.id === fluegel.id)!;

    const ohne = dokument(zweite);
    check('Abnahme · Feldscan ohne heated: keine Angabe übernommen', uebernimmBeheizung(ohne, r.raumBeheizung), 0);
    const e0 = buildRaviaExport(ohne);
    check('Abnahme · Export-Fassung 2.16.0', e0.version, '2.16.0');
    check('Abnahme · Export des Feldscans schemagültig', pruefeGegenSchema(schema(), alsDatei(e0)).join(' | '), '');

    {
      // Gespeicherte Projekte aus älteren Importen tragen `layerId` an Öffnungen.
      const alt = dokument(zweite);
      const erste = Object.values(alt.openings)[0]!;
      alt.openings[erste.id] = { ...erste, layerId: 'layer-openings' } as typeof erste;
      check('Abnahme · Öffnung mit altem layerId: Export schemagültig', pruefeGegenSchema(schema(), alsDatei(buildRaviaExport(alt))).join(' | '), '');
    }

    const a = structuredClone(roh);
    a.rooms[0].heated = false;
    const ra = importBuildingModel(a);
    const docA = dokument(zweite);
    check('Abnahme (a) · Scan „Manu" unbeheizt → elf Räume unbeheizt', uebernimmBeheizung(docA, ra.raumBeheizung), 11);
    const eA = buildRaviaExport(docA);
    check('Abnahme (a) · im Export kein Raum beheizt', eA.rooms.filter((x) => x.isHeated).length, 0);
    check('Abnahme (a) · Export schemagültig', pruefeGegenSchema(schema(), alsDatei(eA)).join(' | '), '');

    const b = structuredClone(roh);
    b.rooms[0].heated = true;
    b.rooms.push({ ...structuredClone(roh.rooms[0]), id: 'r-002', name: 'Abstellraum', heated: false, polygon: fl.polygon, area: polygonArea(fl.polygon) });
    const rb = importBuildingModel(b);
    const docB = dokument(zweite);
    uebernimmBeheizung(docB, rb.raumBeheizung);
    check('Abnahme (b) · Flügel unbeheizt (engere Fläche gewinnt)', docB.rooms[fl.id].isHeated, false);
    check('Abnahme (b) · die zehn übrigen beheizt', Object.values(docB.rooms).filter((x) => x.isHeated !== false).length, 10);
    const eB = buildRaviaExport(docB);
    const flExport = eB.rooms.find((x) => x.id === fl.id);
    check('Abnahme (b) · Flügel im Export unbeheizt', flExport?.isHeated ?? 'fehlt', false);
    check('Abnahme (b) · θu im Export aus b_u (kein fester Wert)', eB.project.unheatedTemperatureSource ?? 'fehlt', 'b_u');
    check('Abnahme (b) · Export schemagültig', pruefeGegenSchema(schema(), alsDatei(eB)).join(' | '), '');
  }

  // --- Prüfpunkte als Fahnen -------------------------------------------------
  {
    const fahnen = pruefpunkteAlsHinweise(r, (i) => `sc-pp${i}`);
    // Zwei Prüfpunkte am selben Ort (−5,263 | −2,336) → eine Fahne.
    check('Fahnen · zwei Prüfpunkte am selben Ort ergeben eine Fahne', fahnen.length, 1);
    check('Fahnen · Spitze am Ort aus der Datei', `${fahnen[0]?.points[0].x}|${fahnen[0]?.points[0].y}`, '-5.263|-2.336');
    const fahnentext = fahnen[0]?.text ?? '';
    check('Fahnen · beide Texte darin (kein Zugang, kein Heizkörper)', fahnentext.includes('ohne Tür') && fahnentext.includes('Heizkörper'), true);
    check('Fahnen · Art „Hinweis mit Fahne"', fahnen[0]?.kind ?? '', 'leader');
  }

  // --- Ältere Scans ohne Belege: Verhalten wie 1.69.0 ------------------------
  {
    const alt = structuredClone(roh);
    for (const w of alt.walls) {
      delete w.kneeWall;
      delete w.profile;
      w.height = Math.min(w.height, 2.405);
    }
    delete alt.levels[0].roof.kneeWallIds;
    const ra = importBuildingModel(alt);
    check('Alt · ohne Belege keine Dachbelege', (ra.dachBelege['level-0'] ?? []).length, 0);
    const lv: Record<string, Level> = { 'level-0': { ...level } };
    const za = scanDachZuordnen(lv, erste, ra);
    check('Alt · Lage nicht belegt', za[0].lageBelegt, false);
    check('Alt · Dach ohne Raumliste (ganzes Geschoss, wie bis 1.69.0)', (daecherVon(lv['level-0'])[0].roomIds ?? []).length, 0);
    check('Alt · kein Raum „ohne Dach"', za[0].ohneDach.length, 0);
  }
}
