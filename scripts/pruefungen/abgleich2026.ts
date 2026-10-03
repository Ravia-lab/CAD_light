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
import { NORM_TEMPERATUREN } from '../../src/lib/auslegungExport';
import { NORM_UEBERTEMPERATUR } from '../../src/lib/heizflaechenLeistung';
import { heizleistung, migriereParams } from '../../src/lib/normleistung';
import { leistungImBetriebspunkt, leistungJeVerbraucher, verbraucherLasten } from '../../src/lib/verbraucherlast';
import { balanceNetwork } from '../../src/lib/hydraulicBalance';
import { buildPipeNetwork } from '../../src/lib/pipeNetwork';
import { fluidProperties, freezePoint, waterDensity } from '../../src/lib/hydraulics';
import { glycolMixture, waterDensity as waterDensitySicherheit } from '../../src/lib/safetyFittings';
import { buildIfc, schichtenAusText } from '../../src/lib/ifcExport';
import { migriereUnbeheizt, unbeheizteArtVonRaum, unbeheizteTemperatur, unbeheizterRaumTemperatur } from '../../src/lib/unbeheizt';
import { buildRaviaExport } from '../../src/lib/raviaExport';
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
  // B1 · θ_u aus b_u und θ_e statt fest 10 °C
  // -------------------------------------------------------------------------
  // Vorher: θ_u = 10 °C, unabhängig vom Standort. Das ist bei θ_i = 20 °C und
  // θ_e = −12 °C ein b_u von 0,31; die Tabellenwerte liegen bei 0,4 … 0,8.
  // Jetzt θ_u = θ_i − b_u · (θ_i − θ_e), Vorgabe Keller ohne Fenster b_u 0,5:
  //   θ_e = −12 °C → 20 − 0,5 · 32 = 4,0 °C
  //   θ_e = −16 °C → 20 − 0,5 · 36 = 2,0 °C
  //   Keller mit Fenster (0,8), θ_e = −12 °C → 20 − 0,8 · 32 = −5,6 °C
  // Wohnen EG liegt über dem unbeheizten Keller (U 0,9, ausführliches
  // Wärmebrückenverfahren, kein Zuschlag): die Kellerdecke verliert mit 4 °C
  // dahinter A · 0,9 · 6 K mehr als mit 10 °C.
  {
    const ohneEintrag = (meta: Partial<BimDocument['meta']>): BimDocument => {
      const { unheatedTemperature: _u, unheatedTemperatureSource: _q, ...rest } = doc.meta;
      void _u;
      void _q;
      return { ...doc, meta: { ...rest, ...meta } };
    };
    const abgeleitet = ohneEintrag({});
    check('B1 · θu ohne Eintrag bei θe −12 °C [°C]', unbeheizteTemperatur(abgeleitet.meta), 4.0, 1e-9);
    check('B1 · θu geht mit θe −16 °C mit [°C]',
      unbeheizteTemperatur(ohneEintrag({ designOutdoorTemperature: -16 }).meta), 2.0, 1e-9);
    check('B1 · Keller mit Fenster b_u 0,8 [°C]',
      unbeheizteTemperatur(ohneEintrag({ unheatedKind: 'keller-mit-oeffnung' }).meta), -5.6, 1e-9);
    check('B1 · eingetragenes θu geht vor [°C]', unbeheizteTemperatur(doc.meta), 10);

    const zeile = (d: BimDocument) => estimateHeatLoad(d).rooms.find((r) => r.name === 'Wohnen EG')!;
    const raum = Object.values(doc.rooms).find((r) => r.name === 'Wohnen EG')!;
    check('B1 · Kellerdecke mit θu aus b_u: + A · 0,9 · 6 K [W]',
      zeile(abgeleitet).transmission - zeile(doc).transmission, raum.area * 0.9 * 6, 1);

    // Unbeheizter Raum im Modell: Art aus Lage und Wänden.
    const keller = Object.values(doc.rooms).find((r) => r.name === 'Keller')!;
    const art = unbeheizteArtVonRaum(abgeleitet, keller);
    check('B1 · Kellerraum unter Gelände ist ein Keller', art.startsWith('keller-'), true);
    check('B1 · Kellerraum: θu nach seiner Art [°C]', unbeheizterRaumTemperatur(abgeleitet, keller),
      art === 'keller-mit-oeffnung' ? -5.6 : 4.0, 1e-9);

    // Export: θu steht immer da, mit Herkunft.
    const proj = (d: BimDocument) => buildRaviaExport(d).project;
    check('B1 · Export: abgeleitetes θu [°C]', proj(abgeleitet).unheatedTemperature ?? NaN, 4.0);
    check('B1 · Export: Herkunft b_u', proj(abgeleitet).unheatedTemperatureSource ?? '', 'b_u');
    check('B1 · Export: eingetragenes θu', proj(doc).unheatedTemperatureSource ?? '', 'eingabe');

    // Laden: die alte Vorgabe 10 °C einer Datei bis 1.72.0 ist keine Eingabe.
    const alt = proj(doc) as unknown as BimDocument['meta'];
    delete alt.unheatedTemperatureSource;
    check('B1 · alte Datei mit 10 °C: θu wird abgeleitet', migriereUnbeheizt(alt).unheatedTemperature ?? 'leer', 'leer');
    check('B1 · alte Datei mit 7 °C: bleibt als Eingabe',
      migriereUnbeheizt({ ...alt, unheatedTemperature: 7 }).unheatedTemperatureSource ?? 'leer', 'eingabe');
    check('B1 · eigener Export (b_u) wird wieder abgeleitet',
      migriereUnbeheizt(proj(abgeleitet) as unknown as BimDocument['meta']).unheatedTemperature ?? 'leer', 'leer');
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
  // -------------------------------------------------------------------------
  // F2 · U-Vorgaben stehen in einer Datei
  // -------------------------------------------------------------------------
  // Quellprobe: Keine andere Datei schreibt die Vorgaben noch als Zahl ab.
  // Gegen eine Zahl im Code hilft nur der Blick in den Code.
  {
    const abschriften = [
      ['src/lib/ifcImport.ts', /const U_(FENSTER|TUER)_BESTAND\s*=\s*\d/],
      ['src/lib/raumplanImport.ts', /const U_(FENSTER|TUER)_BESTAND\s*=\s*\d/],
      ['src/lib/heatLoadEstimate.ts', /DEFAULT_WINDOW_U\s*=\s*\d/],
      ['src/lib/importgeschoss.ts', /(SOHLE|DECKE)_U\s*=\s*\d/],
      ['src/store/useBimStore.ts', /wallDefaults:\s*\{[^}]*uValue:\s*\d/],
    ] as const;
    for (const [datei, muster] of abschriften) {
      check(`F2 · ${datei.split('/').pop()} schreibt keine U-Vorgabe ab`, muster.test(quelle(datei)), false);
    }
    const uwert = quelle('src/lib/uwert.ts');
    check('F2 · uwert.ts führt die Bestandswerte',
      /U_FENSTER_BESTAND = 1\.3;/.test(uwert) && /U_TUER_BESTAND = 1\.8;/.test(uwert), true);
  }
  // -------------------------------------------------------------------------
  // F4/F5 · Wasserdichte, GlycolKind, Gefrierpunkt, Rohrdämmung je einmal
  // -------------------------------------------------------------------------
  // Sollwerte aus der Dampftafel (IAPWS-IF97, 1 bar): 45 °C → 990,21 kg/m³,
  // 80 °C → 971,79 kg/m³. Gefrierpunkt 30 Vol-% Ethylenglykol nach Datenblatt −15 °C.
  {
    check('F4/F5 · Wasserdichte 45 °C [kg/m³]', waterDensity(45), 990.21, 0.02);
    check('F4/F5 · Wasserdichte 80 °C [kg/m³]', waterDensity(80), 971.79, 0.02);
    check('F4/F5 · Hydraulik und Sicherheitstechnik: dieselbe Dichte', waterDensity(63.7), waterDensitySicherheit(63.7), 0);
    check('F4/F5 · Gefrierpunkt 30 % EG, Hydraulik [°C]', freezePoint(0.3, 'ethylen'), -15, 0);
    check('F4/F5 · Gefrierpunkt 30 % EG, Sicherheitsblatt [°C]', glycolMixture(30, 'ethylen').freezePoint, -15, 0);
    check('F4/F5 · Gefrierpunkt 60 % PG gleich in beiden Wegen',
      fluidProperties(10, { glycolFraction: 0.6, glycolKind: 'propylen' }).freezePoint,
      glycolMixture(60, 'propylen').freezePoint, 0);
    const definitionen = (muster: RegExp) =>
      ['src/lib/hydraulics.ts', 'src/lib/safetyFittings.ts', 'src/lib/domesticWater.ts', 'src/lib/pipeInsulation.ts']
        .filter((d) => muster.test(quelle(d))).length;
    check('F4/F5 · eine Definition von GlycolKind', definitionen(/export type GlycolKind\s*=/), 1);
    check('F4/F5 · eine Funktion waterDensity', definitionen(/export function waterDensity\(/), 1);
    check('F4/F5 · eine Gefrierpunkttabelle', definitionen(/temperature: -15 \}/), 1);
    check('F4/F5 · eine Funktion insulationThickness', definitionen(/export function insulationThickness\(/), 1);
  }
  // -------------------------------------------------------------------------
  // A1/K6/F7 · Normleistung bei 75/65/20 °C im Feld ratedPower (Festlegung F2)
  // -------------------------------------------------------------------------
  // Sollwerte von Hand: Δθ_ln(75/65/20) = 10/ln(55/45) = 49,83 K.
  // Übergang: ratedPower = powerW · (49,8/29,7)^n; 1000 W, n = 1,3 → 1958 W,
  // n = 1,4 (Konvektor) → 2062 W.
  {
    check('A1 · Normpunkt 75/65/20 °C', `${NORM_TEMPERATUREN.vorlauf}/${NORM_TEMPERATUREN.ruecklauf}/${NORM_TEMPERATUREN.raum}`, '75/65/20');
    check('A1 · Norm-Übertemperatur [K]', NORM_UEBERTEMPERATUR, 49.83, 0.01);
    const alt = migriereParams('radiator', { powerW: 1000, powerSource: 'katalog' });
    check('A1 · alte 55/45-Leistung wird umgerechnet [W]', alt.ratedPower ?? 0, 1958);
    check('A1 · … und das alte Feld entfällt', alt.powerW === undefined, true);
    check('A1 · … Herkunft Katalog bleibt Katalog', alt.ratedPowerSource ?? '', 'katalog');
    check('A1 · Konvektor mit n = 1,4 [W]', migriereParams('convector', { powerW: 1000 }).ratedPower ?? 0, 2062);
    const mitN = migriereParams('radiator', { powerW: 1000, radiatorExponent: 1.2 } as never);
    check('A1 · alter Exponent wird exponentN', mitN.exponentN ?? 0, 1.2);
    check('A1 · … und rechnet mit ihm: 1000 · 1,6768^1,2 [W]', mitN.ratedPower ?? 0, 1859);
    check('A1 · Fußbodenheizkreis behält powerW', migriereParams('underfloor', { powerW: 800 }).powerW ?? 0, 800);
    const schon = { ratedPower: 2000, powerW: 1000 };
    check('A1 · vorhandenes ratedPower gewinnt', migriereParams('radiator', schon).ratedPower ?? 0, 2000);
    check('A1 · heizleistung liest Altdatei umgerechnet [W]',
      heizleistung({ type: 'radiator', params: { powerW: 1000 } }) ?? 0, 1958);
    // F7: Der Prüfblock „Heizfläche" rechnet auf 75/65/20 und nicht mehr auf 55/45.
    const hf = quelle('scripts/pruefungen/heizflaeche.ts');
    check('F7 · Prüfblock Heizfläche erwartet 49,8 K', hf.includes("r1(NORM_UEBERTEMPERATUR), 49.8)"), true);
    const panel = quelle('src/components/PropertiesPanel.tsx');
    check('A1 · Eingabefeld nennt den Bezugspunkt', panel.includes('Normleistung 75/65/20 °C [W]'), true);
  }
  // -------------------------------------------------------------------------
  // A2 · Volumenstrom aus der Raumheizlast, nicht aus der Normleistung
  // -------------------------------------------------------------------------
  {
    const ref = buildReferenceDocument();
    const lasten = estimateHeatLoad(ref).rooms;
    const lastJe = verbraucherLasten(ref);
    const hk = Object.values(ref.fixtures).filter((f) => f.type === 'radiator' && f.roomId);
    check('A2 · Referenzhaus hat Heizkörper in Räumen', hk.length > 0, true);
    for (const f of hk.slice(0, 2)) {
      const imRaum = hk.filter((x) => x.roomId === f.roomId).length;
      const raum = lasten.find((r) => r.roomId === f.roomId)!;
      if (imRaum === 1) {
        check(`A2 · ${f.id} trägt die Raumlast seines Raums [W]`, lastJe.get(f.id)?.watt ?? -1, raum.total, 0.5);
      }
    }
    // Gegenprobe: Eine größere Normleistung ändert den Volumenstrom nicht,
    // solange die Raumlast dieselbe ist.
    const gross = { ...ref, fixtures: Object.fromEntries(Object.entries(ref.fixtures).map(([k, f]) =>
      [k, f.type === 'radiator' ? { ...f, params: { ...f.params, ratedPower: 9000 } } : f])) };
    const a = leistungJeVerbraucher(ref);
    const b = leistungJeVerbraucher(gross);
    check('A2 · Normleistung ändert die Auslegungsleistung nicht',
      hk.every((f) => imGleichenRaumAllein(f.id) ? Math.abs((a[f.id] ?? 0) - (b[f.id] ?? 0)) < 0.5 : true), true);
    function imGleichenRaumAllein(id: string): boolean {
      const f = ref.fixtures[id];
      return hk.filter((x) => x.roomId === f.roomId).length === 1;
    }
    // Ohne Raum: Leistung im Betriebspunkt. 2000 W bei 75/65/20 an 50/40/20,
    // n = 1,3: 2000 · (24,66/49,8)^1,3 = 802 W.
    check('A2 · Heizkörper ohne Raum: Leistung im Betriebspunkt [W]',
      leistungImBetriebspunkt({ type: 'radiator', params: { ratedPower: 2000 } }, 50, 40, 20) ?? -1, 802, 1);
    // Der Abgleich nimmt diese Last.
    const netz = buildPipeNetwork(ref);
    const bericht = balanceNetwork({ network: netz, fixtures: ref.fixtures, powerByFixture: a });
    const c = bericht.consumers.find((x) => hk.some((f) => f.id === x.fixtureId && imGleichenRaumAllein(f.id)));
    check('A2 · Abgleich rechnet mit der Raumlast', c ? Math.abs(c.power - (a[c.fixtureId] ?? 0)) < 0.5 : false, true);
    check('A2 · Heizkörper-Normleistung gilt im Abgleich nicht als Angabe',
      balanceNetwork({ network: netz, fixtures: ref.fixtures }).consumers
        .filter((x) => hk.some((f) => f.id === x.fixtureId)).every((x) => x.powerAssumed), true);
    // Alle Aufrufer übergeben die Raumlast.
    for (const datei of ['src/lib/pipeReport.ts', 'src/lib/raviaExport.ts', 'src/components/AnlagenPanel.tsx']) {
      check(`A2 · ${datei.split('/').pop()} übergibt powerByFixture`, quelle(datei).includes('powerByFixture: leistungJeVerbraucher(doc)'), true);
    }
  }
}
