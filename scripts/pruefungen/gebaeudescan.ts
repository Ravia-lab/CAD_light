/**
 * Prüfblock „Gebäudescan" — das RaVia Building Model aus der App RaVia Scan.
 * ---------------------------------------------------------------------------
 * Geprüft wird gegen eine **echte** Ausgabe der Transformation Engine der App
 * (Swift, RaViaScanCore, Schema 1.2.0): dieselbe Wohnung wie im Block
 * „Raumscan", auf dem Gerät umgerechnet, dazu vier Heizkörper, die vor echte
 * Wände gesetzt sind (Typ 22, 33, 21, 11). Projektname und Adresse sind
 * durch Platzhalter ersetzt.
 *
 * **Woran dieser Block hängt.**
 *
 *  1. *Keine Spiegelung, keine Drehung.* Das Modell hat y nach Norden-oben wie
 *     dieses Programm. Beweis: Für jede Außenwand ergibt die hier gesetzte
 *     Nordabweichung mit `azimuthFromNormal` denselben Azimut, den die App
 *     für diese Wand gemeldet hat — auf 0,1° genau.
 *  2. *Wandlänge bleibt erhalten* — die T-Stöße teilen nur, sie erfinden
 *     keine Wand.
 *  3. *Heizkörper stehen vor der Wand.* Ein Heizkörper aus der
 *     Symbolbibliothek sitzt mit seiner Mitte `Wandstärke/2 + Bautiefe/2` vor
 *     der Wandachse, die Rückseite an der Wand. Die App misst die
 *     Vorderfläche; ihre Lage darf um den echten Wandabstand (bis 8 cm)
 *     weiter vorn liegen, aber nie in der Wand.
 *  4. *Nichts wird erfunden.* Keine Heizleistung, keine Bauart, die der
 *     Monteur nicht bestätigt hat.
 *  5. *Was der Monteur benannt hat, gilt.* Räume, die er in der App benannt
 *     hat, gehen vor die Bereichsbezeichnung aus dem Scan — und ihre
 *     RaVia-Kennung kommt mit, damit ein zweiter Scan denselben Raum trifft.
 */

import { readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import type { CheckFn } from './typ';
import type { BimNode } from '../../src/types/bim';
import { importBuildingModel, istBuildingModel } from '../../src/lib/buildingModelImport';
import { detectRooms } from '../../src/lib/roomDetection';
import { azimuthFromNormal } from '../../src/lib/geometry';

function wurzel(): string | undefined {
  let pfad = process.cwd();
  for (let i = 0; i < 4; i++) {
    try {
      if (statSync(join(pfad, 'scripts', 'referenz')).isDirectory()) return pfad;
    } catch {
      /* weiter oben suchen */
    }
    const eltern = pfad.slice(0, pfad.lastIndexOf(sep));
    if (!eltern || eltern === pfad) break;
    pfad = eltern;
  }
  return undefined;
}

const winkelAbstand = (a: number, b: number): number => {
  const d = Math.abs((((a - b) % 360) + 540) % 360 - 180);
  return d;
};

export function pruefeGebaeudescan(check: CheckFn): void {
  console.log('\n▸ Gebäudescan — RaVia Building Model aus der App RaVia Scan');

  const basis = wurzel();
  check('Die Beispieldatei ist auffindbar', basis !== undefined, true);
  if (!basis) return;
  const text = readFileSync(join(basis, 'scripts', 'referenz', 'ravia-building-beispiel.json'), 'utf-8');
  const modell = JSON.parse(text);
  // Jeder Fall bekommt eine eigene Kopie — der Import darf das Modell nicht verändern.
  const kopie = () => JSON.parse(text);

  // --- Erkennung und Ablehnung ---------------------------------------------
  check('Das Modell wird erkannt', istBuildingModel(modell), true);
  check('Ein RoomPlan-Scan ist kein Gebäudemodell', istBuildingModel({ roomData: 'e30=' }), false);
  check('Schema 2 wird abgelehnt', importBuildingModel({ ...kopie(), schemaVersion: '2.0.0' }).ok, false);
  check('Falsches Format wird abgelehnt', importBuildingModel({ ...kopie(), format: 'ravia.capture' }).ok, false);
  check('Ohne Wände abgelehnt', importBuildingModel({ ...kopie(), walls: [] }).ok, false);
  check('Kaputtes JSON als Text abgelehnt', importBuildingModel('{kaputt').ok, false);
  check('Auch als Text lesbar', importBuildingModel(text).ok, true);

  const r = importBuildingModel(modell);
  check('Import gelingt', r.ok, true);
  check('Nichts übersprungen', r.skipped.length, 0);
  check('Modell unverändert (kein Schreibzugriff)', JSON.stringify(modell) === text.trim() || JSON.stringify(modell) === JSON.stringify(JSON.parse(text)), true);

  const nodes: Record<string, BimNode> = Object.fromEntries(r.nodes.map((n) => [n.id, n]));
  const laenge = (id: string): number => {
    const w = r.walls.find((x) => x.id === id)!;
    return Math.hypot(nodes[w.b].x - nodes[w.a].x, nodes[w.b].y - nodes[w.a].y);
  };

  // --- Geometrie ------------------------------------------------------------
  const rbmLaenge = modell.walls.reduce((s: number, w: { length: number }) => s + w.length, 0);
  const cadLaenge = r.walls.reduce((s, w) => s + laenge(w.id), 0);
  check('Wandlänge gesamt [m] wie im Modell', cadLaenge, rbmLaenge, 0.05);
  check('Wände (39 + 1 geteilt am T-Stoß)', r.walls.length, 40);
  check('Alle 17 Öffnungen übernommen', r.openings.length, 17);
  check(
    'Jede Öffnung liegt in ihrer Wand',
    r.openings.every((o) => o.distance - o.width / 2 >= -0.02 && o.distance + o.width / 2 <= laenge(o.wallId) + 0.02),
    true,
  );
  check('Außenwandlänge [m] wie im Modell',
    r.walls.filter((w) => w.type === 'exterior').reduce((s, w) => s + laenge(w.id), 0),
    modell.walls.filter((w: { type: string }) => w.type === 'exterior').reduce((s: number, w: { length: number }) => s + w.length, 0),
    0.05);
  // Gemessen ist gemessen: `measuredFacePair` und `measuredJamb` sind
  // Messungen, `fromJambSample` und `estimated` nicht. Vorher galt hier jede
  // Wand als geschätzt, weil auf den Wert „measured" geprüft wurde, den das
  // Modell gar nicht kennt.
  const gemessen = r.walls.filter((w) => !w.thicknessEstimated);
  check('Gemessene Wandstärken als gemessen markiert', gemessen.length > 0, true);
  check(
    'Gemessen ist genau das, was die App gemessen hat',
    gemessen.length,
    (modell.walls as { thicknessSource?: string }[]).filter((w) => String(w.thicknessSource ?? '').startsWith('measured')).length,
  );
  check(
    'Übernommene und pauschale Stärken bleiben geschätzt',
    r.walls.filter((w) => w.thicknessEstimated === true).length,
    r.walls.length - gemessen.length,
  );

  // --- Nordrichtung ---------------------------------------------------------
  const grad = ((r.nordrichtung ?? 0) * 180) / Math.PI;
  const northAngle = Math.round(((90 - grad) % 360 + 360) % 360 * 10) / 10;  // wie im Store
  check('Nordabweichung [°]', northAngle, 113.5, 0.05);
  let groessteAbweichung = 0;
  for (const w of modell.walls as { type: string; start: { x: number; y: number }; end: { x: number; y: number }; azimuthDeg?: number }[]) {
    if (w.type !== 'exterior' || typeof w.azimuthDeg !== 'number') continue;
    const dx = w.end.x - w.start.x;
    const dy = w.end.y - w.start.y;
    const l = Math.hypot(dx, dy);
    // Eine der beiden Normalen ist die äußere; sie muss den gemeldeten Azimut treffen.
    const n1 = azimuthFromNormal({ x: -dy / l, y: dx / l }, northAngle);
    const n2 = azimuthFromNormal({ x: dy / l, y: -dx / l }, northAngle);
    groessteAbweichung = Math.max(groessteAbweichung, Math.min(winkelAbstand(n1, w.azimuthDeg), winkelAbstand(n2, w.azimuthDeg)));
  }
  check('Azimut jeder Außenwand wie in der App [° Abweichung]', groessteAbweichung, 0, 0.1);
  check('Kompassgenauigkeit mitgeführt [°]', r.nordGenauigkeitGrad ?? -1, 15.7, 0.05);

  // --- Dach -----------------------------------------------------------------
  const dach = r.daecher['level-0'];
  check('Dachvorschlag vorhanden', dach !== undefined, true);
  check('Dachform', dach?.kind ?? '', 'gable');
  check('Dachneigung [°]', dach?.pitch ?? 0, 36.5, 0.01);
  check('Kniestock [m]', dach?.kneeHeight ?? 0, 1.19, 0.001);
  check('Azimut der Dachfläche [°]', dach?.azimuth ?? 0, 66.5, 0.01);
  check('Keine Kehlbalkenlage in voller Geschosshöhe', dach?.collarHeight === undefined, true);

  // --- Räume ----------------------------------------------------------------
  const raeume = detectRooms({
    walls: r.walls, nodes, openings: r.openings, levelId: 'level-0', defaultHeight: r.levels[0].height, northAngle,
  });
  check('Räume erkannt', raeume.length, 8);
  check('Summe der Raumflächen [m²]', raeume.reduce((s, z) => s + z.area, 0), 106.7, 0.2);
  check(
    'Raumnamen mitgegeben: aus dem Scan und vom Monteur',
    r.raumHinweise.length,
    modell.roomHints.length + (modell.rooms as { nameSource?: string }[]).filter((x) => x.nameSource === 'user').length,
  );
  check('Der Monteur steht vorn', r.raumHinweise.filter((h) => h.vomNutzer).length > 0, true);
  {
    const m2 = kopie();
    m2.rooms[0].raviaRoomId = 'aa11bb22';
    const r2 = importBuildingModel(m2);
    const h = r2.raumHinweise.find((x) => x.vomNutzer);
    check('RaVia-Raumkennung wird durchgereicht', h?.raviaRoomId ?? '', 'aa11bb22');
    const m3 = kopie();
    m3.rooms[0].nameSource = 'scan';
    check('Ohne „user" kein Vorrang', importBuildingModel(m3).raumHinweise.filter((x) => x.vomNutzer).length, 0);
  }

  // --- Heizkörper -----------------------------------------------------------
  check('Vier Heizkörper', r.fixtures.length, 4);
  check('Bauarten', r.fixtures.map((f) => f.params.radiatorType ?? '-').join(','), '22,33,21,11');
  check('Alle als Heizkörper der Symbolbibliothek', r.fixtures.every((f) => f.type === 'radiator' && f.category === 'heating'), true);
  check('Baulänge [m]', r.fixtures[0].length, 1.2, 0.001);
  check('Bauhöhe [m]', r.fixtures[0].params.radiatorHeight ?? 0, 0.6, 0.001);
  check('Unterkante [m]', r.fixtures[0].elevation, 0.15, 0.001);
  check('Keine Heizleistung erfunden', r.fixtures.every((f) => f.params.powerW === undefined), true);
  check('Jeder Heizkörper hat seine Wand', r.fixtures.every((f) => !!f.wallId && !!r.walls.find((w) => w.id === f.wallId)), true);
  let lageFehler = 0;
  let drehFehler = 0;
  for (const f of r.fixtures) {
    const w = r.walls.find((x) => x.id === f.wallId);
    if (!w) { lageFehler = 1; continue; }
    const a = nodes[w.a];
    const b = nodes[w.b];
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    const quer = Math.abs((f.position.x - a.x) * (b.y - a.y) - (f.position.y - a.y) * (b.x - a.x)) / l;
    // Rückseite an oder vor der Wandoberfläche, höchstens 8 cm davor (Wandabstand).
    const spalt = quer - (w.thickness / 2 + f.depth / 2);
    lageFehler = Math.max(lageFehler, spalt < -0.005 ? -spalt : spalt > 0.08 ? spalt : 0);
    const wandWinkel = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    drehFehler = Math.max(drehFehler, Math.min(winkelAbstand(f.rotation, wandWinkel), winkelAbstand(f.rotation, wandWinkel + 180)));
  }
  check('Heizkörper vor der Wand, nicht in ihr (Mitte ≥ Wandstärke/2 + Bautiefe/2 vor der Achse)', lageFehler, 0, 0.001);
  check('Heizkörper parallel zur Wand [° Abweichung]', drehFehler, 0, 0.5);

  // Unbestätigter Vorschlag: keine Bauart übernehmen, aber sagen.
  {
    const m2 = kopie();
    m2.emitters[0].suggestion.confirmed = false;
    const r2 = importBuildingModel(m2);
    check('Unbestätigte Bauart wird nicht übernommen', r2.fixtures[0].params.radiatorType === undefined, true);
    check('… und im Namen als offen genannt', /Bauart offen/.test(r2.fixtures[0].label ?? ''), true);
    check('… und in der Meldung gezählt', r2.heizkoerperUnbestaetigt, 1);
    m2.emitters[1].kind = 'towel';
    m2.emitters[2].kind = 'tube';
    m2.emitters[3].kind = 'convector';
    const r3 = importBuildingModel(m2);
    // Seit 1.39.0 gibt es den Badheizkörper als eigene Bauart. Vorher musste
    // der Scan ihn auf den Kompaktheizkörper abbilden und die Bauart nur im
    // Text mitführen — jetzt kommt er als das an, was er ist.
    check('Badheizkörper / Röhren / Konvektor', r3.fixtures.slice(1).map((f) => `${f.type}:${f.params.radiatorType ?? '-'}`).join(','),
      'towel-radiator:Badheizkörper,radiator-tube:Röhren,convector:-');
  }

  // Älteres Modell (1.1.0) ohne Heizkörper bleibt lesbar.
  {
    const alt = kopie();
    alt.schemaVersion = '1.1.0';
    delete alt.emitters;
    delete alt.photos;
    const ra = importBuildingModel(alt);
    check('Schema 1.1.0 ohne Heizkörper lesbar', ra.ok && ra.fixtures.length === 0, true);
  }

  // Kaputte Einzelteile werden gezählt, nicht verschluckt.
  {
    const m4 = kopie();
    m4.openings[0].wallId = 'gibt-es-nicht';
    m4.emitters[0].width = 'breit';
    const r4 = importBuildingModel(m4);
    check('Öffnung ohne Wand übersprungen und genannt', r4.skipped.some((s) => /Öffnung ohne/.test(s.reason)), true);
    check('Unvollständiger Heizkörper übersprungen und genannt', r4.skipped.some((s) => /Heizkörper/.test(s.reason)), true);
    check('Der Rest kommt trotzdem an', r4.fixtures.length === 3 && r4.openings.length === 16, true);
  }
}
