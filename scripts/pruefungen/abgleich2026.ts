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
import { designPlant, gebaeudeHeizlast } from '../../src/lib/plantDesign';

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
}
