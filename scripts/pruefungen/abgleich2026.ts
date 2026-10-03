/**
 * Prüfblock „Abgleich 2026-10" — die Befunde aus dem Abgleich RaVia Scan ↔
 * CAD Light (Auftrag 1.73.0). Je Befund ein Abschnitt mit Befundnummer, damit
 * eine rote Zeile sofort sagt, welcher Befund wieder aufgebrochen ist.
 *
 * Sollwerte sind von Hand hergeleitet oder kommen aus einem zweiten,
 * unabhängigen Rechenweg; keiner wird aus der geprüften Funktion abgeschrieben.
 */

import { readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import type { CheckFn } from './typ';
import { buildReferenceDocument } from '../reference';
import { designPlant, gebaeudeHeizlast, leistungsbedarf } from '../../src/lib/plantDesign';
import { estimateHeatLoad } from '../../src/lib/heatLoadEstimate';
import type { BimDocument } from '../../src/types/bim';
import { buildIfc, schichtenAusText } from '../../src/lib/ifcExport';
import { importIfc, parseStep } from '../../src/lib/ifcImport';

function wurzel(): string | undefined {
  let pfad = process.cwd();
  for (let i = 0; i < 4; i++) {
    try {
      if (statSync(join(pfad, 'src', 'lib')).isDirectory()) return pfad;
    } catch {
      /* weiter oben suchen */
    }
    const eltern = pfad.slice(0, pfad.lastIndexOf(sep));
    if (!eltern || eltern === pfad) break;
    pfad = eltern;
  }
  return undefined;
}

function quelle(rel: string): string {
  const basis = wurzel();
  return basis ? readFileSync(join(basis, rel), 'utf-8') : '';
}

export function pruefeAbgleich2026(check: CheckFn): void {
  console.log('\n▸ Abgleich 2026-10 — Befunde aus dem Abgleich RaVia Scan ↔ CAD Light');

  // -------------------------------------------------------------------------
  // A3 · Wärmepumpenblatt nimmt dieselbe Gebäudeheizlast wie die Anlage
  // -------------------------------------------------------------------------
  // Vorher: Σ powerW aller Heizflächen. Das ist die installierte Leistung bei
  // Auslegungstemperatur, keine Heizlast — überdimensionierte Heizkörper
  // hätten eine größere Wärmepumpe verlangt.
  const doc = buildReferenceDocument();
  const ohneVorgabe = gebaeudeHeizlast(doc);
  check('A3 · Gebäudeheizlast = Anlagenauslegung (ohne Vorgabe)',
    ohneVorgabe.heatLoad, designPlant(doc).heatLoad, 1e-9);
  check('A3 · Gebäudeheizlast = Anlagenauslegung (Vorgabe 7,5 kW)',
    gebaeudeHeizlast(doc, 7.5).heatLoad, designPlant(doc, { heatLoad: 7.5 }).heatLoad, 1e-9);
  check('A3 · Vorgabe schlägt alles', gebaeudeHeizlast(doc, 7.5).heatLoadProvenance, 'vorgabe');
  const panel = quelle('src/components/HeatPumpPanel.tsx');
  check('A3 · Wärmepumpenblatt summiert keine Heizflächenleistung mehr',
    panel.includes('gebaeudeHeizlast(') && !/fixtures\)\.reduce\([^)]*powerW/.test(panel), true);

  // -------------------------------------------------------------------------
  // B2 · `adiabatic` im Überschlag heißt ΔT = 0, nicht Außenluft
  // -------------------------------------------------------------------------
  // Gegenprobe über einen zweiten Weg: Ein adiabat gestellter Wandabschnitt
  // muss genau so viel beitragen wie ein gar nicht vorhandener, nämlich 0 W.
  {
    const raum = Object.values(doc.rooms).find((r) => r.name === 'Wohnen OG')!;
    const idx = raum.boundaries.findIndex((b) => b.boundary === 'exterior' && b.netArea > 1);
    const mitRand = (boundaries: typeof raum.boundaries): BimDocument => ({
      ...doc,
      rooms: { ...doc.rooms, [raum.id]: { ...raum, boundaries } },
    });
    const zeile = (d: BimDocument) => estimateHeatLoad(d).rooms.find((r) => r.roomId === raum.id)!;
    const adiabat = zeile(mitRand(raum.boundaries.map((b, i) => (i === idx ? { ...b, boundary: 'adiabatic' as const } : b))));
    const ohne = zeile(mitRand(raum.boundaries.filter((_, i) => i !== idx)));
    const mit = zeile(doc);
    check('B2 · Prüfling hat einen Außenwandabschnitt', idx >= 0, true);
    check('B2 · adiabate Wand: Transmission wie ohne die Wand', adiabat.transmission, ohne.transmission, 0.5);
    check('B2 · adiabate Wand: Öffnungen wie ohne die Wand', adiabat.openings, ohne.openings, 0.5);
    check('B2 · als Außenwand verliert sie dagegen etwas', mit.transmission > adiabat.transmission, true);
  }

  // -------------------------------------------------------------------------
  // B3 · Überschlag rechnet die Dachflächen
  // -------------------------------------------------------------------------
  // Referenzhaus, Wohnen OG unter dem Satteldach (40°, U_Dach 0,18,
  // ausführliches Wärmebrückenverfahren, also kein Zuschlag):
  //   Dachfläche 57,41 m² · 0,18 · (20 − (−12)) = 330,7 W
  // Vorher stand stattdessen die Grundfläche als Decke zum Dachraum:
  //   43,98 m² · 0,20 · (20 − (−8,8))           = 253,3 W   (θ Dachraum
  //   nach Recknagel 20 − 0,9 · 32 = −8,8 °C)
  // Kehlbalkenlage gibt es keine (flatCeilingArea 0), also fällt die Decke weg.
  // Erwartung: Transmission 595 − 253,3 + 330,7 = 672,4 → 672 W.
  // Bad OG (24 °C): 37,48 · 0,18 · 36 = 242,9 W statt 28,71 · 0,2 · 32,8 = 188,3 W
  // → 587 − 188,3 + 242,9 = 641,6 → 642 W.
  {
    const zeilen = estimateHeatLoad(doc).rooms;
    const t = (name: string) => zeilen.find((r) => r.name === name)?.transmission ?? -1;
    check('B3 · Wohnen OG mit Dachfläche statt Decke [W]', t('Wohnen OG'), 672, 1);
    check('B3 · Bad OG mit Dachfläche statt Decke [W]', t('Bad OG'), 642, 1);
    // Ein Geschoss ohne Dach bleibt unberührt.
    check('B3 · Wohnen EG unverändert [W]', t('Wohnen EG'), 787, 0.5);
  }

  // -------------------------------------------------------------------------
  // B7 · IFC: Räume über IfcRelAggregates, Wände mit Schichten und U-Wert
  // -------------------------------------------------------------------------
  {
    const ifc = buildIfc(doc, { timestamp: '2026-01-01T00:00:00.000Z' });
    const ents = [...parseStep(ifc).values()];
    const vom = (typ: string) => ents.filter((e) => e.type === typ);
    const refsIn = (v: unknown): number[] =>
      Array.isArray(v) ? v.flatMap(refsIn) : v && typeof v === 'object' && 'ref' in v ? [(v as { ref: number }).ref] : [];
    const raeume = new Set(vom('IFCSPACE').map((e) => e.id));
    const geschosse = new Set(vom('IFCBUILDINGSTOREY').map((e) => e.id));
    const enthalten = new Set(vom('IFCRELCONTAINEDINSPATIALSTRUCTURE').flatMap((e) => refsIn(e.attributes[4])));
    const aggregiert = new Set(
      vom('IFCRELAGGREGATES')
        .filter((e) => refsIn(e.attributes[4]).some((r) => geschosse.has(r)))
        .flatMap((e) => refsIn(e.attributes[5])),
    );
    check('B7 · jeder Raum hängt per IfcRelAggregates am Geschoss',
      [...raeume].every((r) => aggregiert.has(r)), true);
    check('B7 · kein Raum steht bei den enthaltenen Bauteilen',
      [...raeume].some((r) => enthalten.has(r)), false);
    check('B7 · Räume im Referenzhaus', raeume.size, Object.keys(doc.rooms).length);

    const waende = vom('IFCWALLSTANDARDCASE').map((e) => e.id);
    const mitMaterial = new Set(vom('IFCRELASSOCIATESMATERIAL').flatMap((e) => refsIn(e.attributes[4])));
    check('B7 · jede Wand hat einen Schichtaufbau', waende.every((id) => mitMaterial.has(id)), true);
    check('B7 · Schichtaufbau als IfcMaterialLayerSetUsage',
      vom('IFCMATERIALLAYERSETUSAGE').length, waende.length);
    check('B7 · je Wand ein Pset_WallCommon', vom('IFCPROPERTYSET').filter((e) => e.attributes[2] === 'Pset_WallCommon').length, waende.length);
    check('B7 · U-Wert als ThermalTransmittance', ifc.includes("'ThermalTransmittance'"), true);
    check('B7 · Einheit W/(m²·K) ist erklärt', ifc.includes('.THERMALTRANSMITTANCEUNIT.'), true);

    // Rückweg: der eigene Import findet die Räume weiter in ihren Geschossen.
    const zurueck = importIfc(ifc);
    check('B7 · Import liest alle Räume zurück', zurueck.spaces.length, raeume.size);

    // Schichten aus dem Freitext: nur wenn die Summe zur Wanddicke passt.
    const zwei = schichtenAusText('24 MW + 14 WDVS', 0.38);
    check('B7 · „24 MW + 14 WDVS" ergibt zwei Schichten', zwei?.length ?? 0, 2);
    check('B7 · … die zweite ist 14 cm WDVS', `${zwei?.[1]?.name} ${zwei?.[1]?.dicke}`, 'WDVS 0.14');
    check('B7 · „36,5 Ziegel + 14 cm WDVS" mit Komma und „cm"', schichtenAusText('36,5 Ziegel + 14 cm WDVS', 0.505)?.length ?? 0, 2);
    check('B7 · Summe passt nicht zur Wand: keine Aufteilung', schichtenAusText('24 MW + 14 WDVS', 0.24) === undefined, true);
    check('B7 · Text ohne Dicken: keine Aufteilung', schichtenAusText('Vollziegel verputzt', 0.24) === undefined, true);
  }

  // -------------------------------------------------------------------------
  // F3 · Ein Rechenweg für den Leistungsbedarf der Wärmepumpe
  // -------------------------------------------------------------------------
  {
    check('F3 · Leistungsbedarf = Anlagenauslegung (7,5 kW)',
      leistungsbedarf(doc, 7.5).requiredCapacity, designPlant(doc, { heatLoad: 7.5 }).requiredCapacity, 1e-9);
    check('F3 · Warmwasserzuschlag = Anlagenauslegung',
      leistungsbedarf(doc, 7.5).dhwSurcharge, designPlant(doc, { heatLoad: 7.5 }).dhwSurcharge, 1e-9);
    check('F3 · kein zweiter Rechenweg in heatPump.ts',
      /export function requiredCapacity/.test(quelle('src/lib/heatPump.ts')), false);
    check('F3 · Wärmepumpenblatt rechnet über leistungsbedarf()',
      quelle('src/components/HeatPumpPanel.tsx').includes('leistungsbedarf(doc'), true);
  }
}
