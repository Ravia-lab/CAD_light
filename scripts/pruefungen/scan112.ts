/**
 * Prüfblock: Scan-Schema 1.12.0 — Dachumriss und Fallrichtung (Brücke H3).
 * ---------------------------------------------------------------------------
 *
 * **Der Prüffall.** Derselbe Feldscan wie in `scanuebernahme.ts`, von RaVia
 * Scan mit Build 18 (Stand 9e3bc5e) als Schema 1.12.0 neu gerechnet:
 * `scripts/referenz/scan-wohnung-2026-10-02.building-1.12.0.json`, dazu eine
 * Fassung mit einem erfassten Heizkörper. Das Schema liegt unter
 * `ravia-vertrag/schema/ravia.building-1.12.0.schema.json` (Festlegung F6).
 *
 * **Was 1.12.0 bringt** (aus den Hinweisen der Scan-Seite):
 *
 *   · `levels[].roof.footprint` — Rechteck aus 4 Planpunkten [m], gegen den
 *     Uhrzeigersinn, offen; ein Raum liegt unter dem Dach, wenn sein Punkt
 *     im Umriss liegt, sonst hat er eine gerade Decke.
 *   · `levels[].roof.fallDirection` — Einheitsvektor im Plan, kein Winkel;
 *     beim Satteldach ohne Vorzeichenbedeutung. Feldscan: (−0,002 | −1).
 *
 * Beim Feldscan: Umriss x −13,1…0,9 / y −7,1…0,25 — der Hauptbau. Der Flügel
 * (y 1,2…6,4) liegt außerhalb.
 *
 * Beides geht der Heuristik aus Kniestock- und Profilwänden vor; ohne die
 * Felder bleibt sie der Rückfall (Auftrag Schritt 2, H3).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CheckFn } from './typ';
import type { Level, Room } from '../../src/types/bim';
import { importBuildingModel } from '../../src/lib/buildingModelImport';
import { detectRooms } from '../../src/lib/roomDetection';
import { baueDachlandschaft } from '../../src/lib/dachlandschaft';
import { measureRoomUnderRoof } from '../../src/lib/roofGeometry';
import { scanDachZuordnen } from '../../src/lib/scanUebernahme';
import { innererPunkt, pointInPolygon } from '../../src/lib/geometry';
import { pruefeGegenSchema, type Schema } from '../vertrag/pruefeSchema';

const REF = join(process.cwd(), 'scripts', 'referenz');
const lies = (datei: string) => JSON.parse(readFileSync(join(REF, datei), 'utf8'));

/** Import → Raumerkennung → Dachzuordnung, wie `loadBuilding` im Store. */
function uebernimm(roh: unknown) {
  const r = importBuildingModel(roh);
  const nodes = Object.fromEntries(r.nodes.map((n) => [n.id, n]));
  const levels: Record<string, Level> = {
    'level-0': {
      id: 'level-0', name: 'EG', order: 0, elevation: 0, height: r.levels[0]?.height ?? 2.4,
      floorUValue: 0.3, floorBoundary: 'ground', ceilingUValue: 0.2, ceilingBoundary: 'unheated',
    } as Level,
  };
  const raeume: Room[] = detectRooms({
    walls: r.walls, nodes, openings: r.openings, levelId: 'level-0', defaultHeight: levels['level-0'].height,
    northAngle: 0, previous: [],
    roofFrames: baueDachlandschaft({ level: levels['level-0'], walls: r.walls, nodes, rooms: [] })
      .map((t) => t.frame)
      .filter((f): f is NonNullable<typeof f> => f !== null),
  });
  const zuordnung = scanDachZuordnen(levels, raeume, r);
  return { r, raeume, levels, z: zuordnung[0] };
}

export function pruefeScan112(check: CheckFn): void {
  console.log('\n▸ Scan 1.12.0 — Dachumriss und Fallrichtung (H3)');
  const schema = JSON.parse(readFileSync(join(process.cwd(), 'ravia-vertrag', 'schema', 'ravia.building-1.12.0.schema.json'), 'utf8')) as Schema;
  const roh = lies('scan-wohnung-2026-10-02.building-1.12.0.json');
  const mitHk = lies('scan-wohnung-2026-10-02-mit-heizkoerper.building-1.12.0.json');

  // --- Eingabe gegen das Schema (Festlegung F6) -----------------------------
  check('H3 · Feldscan 1.12.0 gültig gegen ravia.building-1.12.0', pruefeGegenSchema(schema, roh).join(' | '), '');
  check('H3 · Fassung mit Heizkörper gültig', pruefeGegenSchema(schema, mitHk).join(' | '), '');
  {
    const kaputt = structuredClone(roh);
    kaputt.levels[0].roof.footprint.pop();
    check('H3 · Schema fängt einen Umriss mit 3 Punkten', pruefeGegenSchema(schema, kaputt).some((f) => f.includes('mindestens 4')), true);
  }

  const { r, raeume, levels, z } = uebernimm(roh);
  check('H3 · Import gelingt', r.ok, true);
  const dach = r.daecher['level-0'];

  // --- Fallrichtung als Vektor ----------------------------------------------
  /*
   * (−0,002 | −1) im Plan: atan2(x, y) = −179,885° → 180,11° ab Plan-oben im
   * Uhrzeigersinn. Über den Kompass kam bisher 295,2° + (90° − 205°) = 180,2°;
   * der Vektor ist genauer, weil er nicht über den auf 0,1° gerundeten
   * Kompasswert und die Nordrichtung läuft.
   */
  check('H3 · Fallrichtung aus fallDirection: 180,11°', dach?.azimuth ?? 0, 180.11, 1e-9);
  {
    const ohneNord = structuredClone(roh);
    delete ohneNord.orientation.northPlanAngleDeg;
    ohneNord.levels[0].roof.slopeAzimuthsDeg = [];
    check('H3 · … auch ohne Nordrichtung', importBuildingModel(ohneNord).daecher['level-0']?.azimuth ?? 0, 180.11, 1e-9);
    const ohneVektor = structuredClone(roh);
    delete ohneVektor.levels[0].roof.fallDirection;
    check('H3 · ohne fallDirection: Rückfall Kompass + Nordabweichung 180,2°', importBuildingModel(ohneVektor).daecher['level-0']?.azimuth ?? 0, 180.2, 1e-9);
  }

  // --- Umriss ---------------------------------------------------------------
  check('H3 · Umriss gelesen: 4 Punkte', dach?.umriss?.length ?? 0, 4);
  check('H3 · Umriss = Datei', JSON.stringify(dach?.umriss), JSON.stringify(roh.levels[0].roof.footprint));
  const fluegel = raeume.find((x) => pointInPolygon({ x: -0.7, y: 3.8 }, x.polygon))!;
  check('H3 · elf Räume erkannt', raeume.length, 11);
  check('H3 · zehn Räume unter dem Dach', z.unterDach.length, 10);
  check('H3 · der Flügel hat eine gerade Decke', z.ohneDach.join(','), fluegel.id);
  check('H3 · die Lage ist belegt', z.lageBelegt, true);
  check('H3 · Zuordnung nach Umriss', z.quelle, 'umriss');
  check('H3 · der Umriss steht nicht im Dach des Modells', 'umriss' in (levels['level-0'].roofs?.[0] ?? {}), false);

  {
    /*
     * Gegenprobe: Der Umriss geht den Wandbelegen vor. Ein Umriss nur über
     * der Osthälfte (x ≥ −6) lässt Küche, Bad und Essen im Westen ohne Dach,
     * obwohl die Kniestockwand w-006 dort ein Beleg ist.
     */
    const ost = structuredClone(roh);
    ost.levels[0].roof.footprint = [{ x: -6, y: 0.253 }, { x: -6, y: -7.2 }, { x: 0.9, y: -7.2 }, { x: 0.9, y: 0.253 }];
    const u = uebernimm(ost);
    const westen = u.raeume.filter((x) => innererPunkt(x.polygon).x < -6.2).map((x) => x.id).sort();
    check('H3 · Umriss Osthälfte: Westräume ohne Dach', westen.every((id) => u.z.ohneDach.includes(id)), true);
    check('H3 · … und es sind welche', westen.length >= 3, true);
    check('H3 · … Ostteil unter dem Dach', u.z.unterDach.every((id) => innererPunkt(u.raeume.find((x) => x.id === id)!.polygon).x >= -6), true);
  }
  {
    // Ohne footprint: die Heuristik aus 1.70.0, gleiches Ergebnis beim Feldscan.
    const alt = structuredClone(roh);
    delete alt.levels[0].roof.footprint;
    const u = uebernimm(alt);
    check('H3 · ohne footprint: Rückfall auf die Wandbelege', u.z.quelle, 'waende');
    check('H3 · … dasselbe Ergebnis: zehn unter dem Dach', u.z.unterDach.length, 10);
    // Ein kaputter Umriss (zwei Punkte) gilt als nicht vorhanden.
    const kaputt = structuredClone(roh);
    kaputt.levels[0].roof.footprint = kaputt.levels[0].roof.footprint.slice(0, 2);
    check('H3 · Umriss mit 2 Punkten wird verworfen', importBuildingModel(kaputt).daecher['level-0']?.umriss === undefined, true);
  }

  // --- Kehlbalkenlage ---------------------------------------------------------
  {
    /*
     * Der Feldscan meldet die Kehlbalkenlage bei 2,43 m, das Geschoss ist
     * 2,41 m hoch: Die waagerechte Decke des Dachgeschosses liegt auf
     * Geschosshöhe. Bis 1.73.0 fiel sie weg, weil sie nicht 5 cm *unter* der
     * Geschosshöhe lag, und die Räume unter dem Dach rechneten bis unter den
     * First (Punkt 3 aus dem Scan-Patch zu 1.70.0, nie eingespielt).
     */
    check('Kehlbalken · Feldscan: auf Geschosshöhe 2,41 m begrenzt, nicht verworfen', dach?.collarHeight ?? -1, 2.41, 1e-9);
    const rahmen = baueDachlandschaft({ level: levels['level-0'], walls: r.walls, nodes: Object.fromEntries(r.nodes.map((n) => [n.id, n])), rooms: raeume })
      .map((t) => t.frame).filter((f): f is NonNullable<typeof f> => f !== null);
    const hoehen = z.unterDach.map((id) => measureRoomUnderRoof(rahmen[0], raeume.find((x) => x.id === id)!.polygon).averageHeight);
    check('Kehlbalken · ein Dachrahmen', rahmen.length, 1);
    check('Kehlbalken · kein Raum unter dem Dach über 2,41 m mittlerer Höhe', Math.max(...hoehen) <= 2.41 + 1e-6, true);
    // Liegt die Kehlbalkenlage deutlich höher (Galerie, offener Dachraum), ist sie echt und bleibt.
    const hoch = structuredClone(roh);
    hoch.levels[0].roof.collarHeight = 3.2;
    check('Kehlbalken · 0,8 m über Geschosshöhe bleibt sie, wie gemessen', importBuildingModel(hoch).daecher['level-0']?.collarHeight ?? -1, 3.2, 1e-9);
    const tief = structuredClone(roh);
    tief.levels[0].roof.collarHeight = 2.1;
    check('Kehlbalken · unter Geschosshöhe wie bisher übernommen', importBuildingModel(tief).daecher['level-0']?.collarHeight ?? -1, 2.1, 1e-9);
  }

  // --- Randbedingungen aus 1.12.0 ---------------------------------------------
  /*
   * Der Scan schreibt `interior` statt `adjacent-room` (Abweichung von F4,
   * Hinweis der Scan-Seite). Gelesen wird es als „nichts Besonderes": Die
   * Wand bekommt keine eigene Randbedingung, die Ableitung gilt.
   */
  check('H3 · boundary „interior" setzt keine Randbedingung', r.walls.filter((w) => w.boundary !== undefined).length, 0);
  {
    const nb = structuredClone(roh);
    const w = nb.walls.find((x: { id: string }) => x.id === 'w-004');
    w.boundary = 'neighbour';
    check('H3 · boundary „neighbour" an einer Innenwand kommt an', importBuildingModel(nb).walls.find((x) => x.id === 'w-004')?.boundary ?? '', 'neighbour');
  }

  // --- Fassung mit Heizkörper -----------------------------------------------
  {
    const h = importBuildingModel(mitHk);
    check('H3 · Heizkörper-Fassung: ein Heizkörper', h.fixtures.length, 1);
    check('H3 · … Bauart 22 aus der Bestätigung', String(h.fixtures[0]?.params?.radiatorType ?? ''), '22');
    check('H3 · … Umriss auch hier', h.daecher['level-0']?.umriss?.length ?? 0, 4);
  }
}
