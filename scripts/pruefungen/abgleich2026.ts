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
import { estimateHeatLoad, gebaeudeLueftung, normHeatLoadCoverage } from '../../src/lib/heatLoadEstimate';
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
import { envelopeArea, roomBridgeHeatLoss, roomEnvelopeArea, roomThermalBridges } from '../../src/lib/thermalBridges';
import { importIfc, parseStep } from '../../src/lib/ifcImport';
import { importBuildingModel, randAusScan } from '../../src/lib/buildingModelImport';
import { uebernimmBeheizung } from '../../src/lib/scanUebernahme';

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
    // Seit B4 stehen die Anschlüsse (ψ·l) im Überschlag, und die hängen an
    // den Außenwandabschnitten: ohne die Wand fehlen Ecke und Laibungen. Die
    // Prüfung gilt der Wandfläche, also mit ψ = 0.
    const ohnePsi = (d: BimDocument): BimDocument => ({
      ...d,
      meta: {
        ...d.meta,
        thermalBridgeCatalogue: Object.fromEntries(
          Object.values(d.rooms).flatMap((r) => roomThermalBridges(d, r).map((b) => [b.kind, 0])),
        ) as BimDocument['meta']['thermalBridgeCatalogue'],
      },
    });
    const zeile = (d: BimDocument) => estimateHeatLoad(ohnePsi(d)).rooms.find((r) => r.roomId === raum.id)!;
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
  //
  // Seit F1 (ein Flächenaufbau mit dem Export) rechnet der Überschlag auf den
  // Exportflächen. Die Zahlen oben hielten den alten, eigenen Aufbau fest,
  // in dem die Giebelflächen über dem Kniestock gar nicht vorkamen und die
  // Gaube fehlte; sie sind deshalb umgestellt, nicht gestrichen:
  // Wohnen OG (20 °C, Δθ 32 K, U_Wand 0,24, U_Giebel 0,22, U_Dach 0,18):
  //   Wände 17,56 + 20,26 + 6,65 = 44,47 m² · 0,24 · 32 = 341,5 W
  //   Giebel 11,56 + 14,26 = 25,82 m² · 0,22 · 32       = 181,8 W
  //   Dach 47,92 + 9,48 = 57,40 m² · 0,18 · 32           = 330,6 W
  //   Gaubendach 3,2 m² · 0,2 · 32                        =  20,5 W
  //   → 874,4 W
  // Bad OG (24 °C, Δθ 36 K):
  //   Wände 9,09 + 8 + 10,71 = 27,80 · 0,24 · 36 = 240,2 W
  //   Giebel 5,09 + 6,71 = 11,80 · 0,22 · 36    =  93,5 W
  //   Wand/Giebel zu Wohnen OG (20 °C): 33,07 · 1,2 · 4 + 25,07 · 0,22 · 4 = 180,8 W
  //   Boden zu EG (22 °C): 28,71 · 0,3 · 2 = 17,2 W
  //   Dach 37,48 · 0,18 · 36 = 242,9 W
  //   → 774,6 W
  // Seit B4 kommt im ausführlichen Verfahren Σψ·l · (θi − θe) hinzu; die
  // Zahlen hier gelten der Dachfläche und werden deshalb ohne diesen Anteil
  // geprüft (die Anschlüsse prüft B4).
  {
    const zeilen = estimateHeatLoad(doc).rooms;
    const t = (name: string) => {
      const r = zeilen.find((z) => z.name === name);
      const raum = Object.values(doc.rooms).find((x) => x.name === name);
      if (!r || !raum) return -1;
      return r.transmission - roomBridgeHeatLoss(roomThermalBridges(doc, raum)) * (raum.setpointTemperature + 12);
    };
    check('B3 · Wohnen OG mit Dachfläche statt Decke [W]', t('Wohnen OG'), 874.4, 1);
    check('B3 · Bad OG mit Dachfläche statt Decke [W]', t('Bad OG'), 774.6, 1);
    // Ein Geschoss ohne Dach bleibt unberührt.
    check('B3 · Wohnen EG unverändert [W]', t('Wohnen EG'), 787, 0.5);
  }

  // -------------------------------------------------------------------------
  // B4 · ausführliches Wärmebrückenverfahren: ψ·l steht im Überschlag
  // -------------------------------------------------------------------------
  // Vorher: Zuschlag 0 und kein ψ·l — die Anschlüsse fehlten ganz.
  // Gegenprobe: derselbe Raum mit ψ = 0 für jede Anschlussart; der Abstand
  // muss genau Σψ·l · (θ_i − θ_e) sein.
  {
    const ohnePsi: BimDocument = {
      ...doc,
      meta: {
        ...doc.meta,
        thermalBridgeCatalogue: Object.fromEntries(
          roomThermalBridges(doc, Object.values(doc.rooms)[0]).map((b) => [b.kind, 0]),
        ) as BimDocument['meta']['thermalBridgeCatalogue'],
      },
    };
    const alle = Object.values(doc.rooms).flatMap((r) => roomThermalBridges(doc, r).map((b) => b.kind));
    ohnePsi.meta.thermalBridgeCatalogue = Object.fromEntries(alle.map((k) => [k, 0])) as BimDocument['meta']['thermalBridgeCatalogue'];
    check('B4 · Referenzhaus rechnet ausführlich', doc.meta.thermalBridgeMethod, 'detailed');
    for (const name of ['Wohnen EG', 'Wohnen OG']) {
      const raum = Object.values(doc.rooms).find((r) => r.name === name)!;
      const psiL = roomBridgeHeatLoss(roomThermalBridges(doc, raum));
      const t = (d: BimDocument) => estimateHeatLoad(d).rooms.find((r) => r.roomId === raum.id)!.transmission;
      check(`B4 · ${name} hat Anschlüsse`, psiL > 0, true);
      check(`B4 · ${name}: + Σψ·l · (θi − θe) [W]`, t(doc) - t(ohnePsi), psiL * (raum.setpointTemperature + 12), 1);
    }
  }

  // -------------------------------------------------------------------------
  // B5 · Hüllfläche nur aus Hüllbauteilen
  // -------------------------------------------------------------------------
  // Vorher je Raum: Außenwände + 2 · Grundfläche, auch für den unbeheizten
  // Keller und für die Decke zwischen EG und OG. Jetzt nur, was an außen,
  // Erdreich oder Unbeheiztes grenzt.
  {
    const raum = (name: string) => Object.values(doc.rooms).find((r) => r.name === name)!;
    const waende = (name: string) =>
      raum(name).boundaries
        .filter((b) => b.boundary === 'exterior' || b.boundary === 'ground' || b.boundary === 'unheated' ||
          (b.boundary === 'adjacent-room' && doc.rooms[b.neighbourRoomId ?? '']?.isHeated === false))
        .reduce((s, b) => s + b.grossArea, 0);
    check('B5 · unbeheizter Keller gehört nicht zur Hülle [m²]', roomEnvelopeArea(doc, raum('Keller')), 0);
    // Wohnen EG: Boden über dem unbeheizten Keller ja, Decke zum OG nein.
    check('B5 · Wohnen EG: Wände + Boden, keine Decke [m²]',
      roomEnvelopeArea(doc, raum('Wohnen EG')), waende('Wohnen EG') + raum('Wohnen EG').area, 0.01);
    // Wohnen OG: kein Boden (EG beheizt), oben Dachfläche + Restdecke.
    const og = raum('Wohnen OG');
    check('B5 · Wohnen OG: Wände + Dach, kein Boden [m²]',
      roomEnvelopeArea(doc, og), waende('Wohnen OG') + (og.roof?.slopedArea ?? NaN) + (og.roof?.flatCeilingArea ?? NaN), 0.01);
    const alt = Object.values(doc.rooms).reduce(
      (s, r) => s + r.boundaries.filter((b) => b.boundary === 'exterior').reduce((x, b) => x + b.grossArea, 0) + 2 * r.area, 0);
    check('B5 · Gebäudehülle kleiner als die alte Zählung', envelopeArea(doc) < alt, true);
  }

  // -------------------------------------------------------------------------
  // B8 · Gebäudeheizlast ohne doppelt gezählte Lüftung
  // -------------------------------------------------------------------------
  // Vorher: Gebäude = Σ Raumlasten, die Lüftung also Σ n_min · V — die Luft
  // der Abluftraeume (Bad, Küche) kommt aber über den Überströmweg aus den
  // Zulufträumen und ist dort schon als Außenluft gezählt.
  // Jetzt Außenluft = max(Zuluftseite, Abluftseite) + Räume ohne Rolle.
  {
    check('B8 · Lüftungsbilanz: max(Zu, Ab) + ohne Rolle [W]', gebaeudeLueftung([
      { rolle: 'supply', watt: 300 }, { rolle: 'supply', watt: 200 }, { rolle: 'exhaust', watt: 250 },
      { rolle: 'transfer', watt: 50 }, { rolle: 'none', watt: 40 }, { rolle: undefined, watt: 10 },
    ]), 600, 1e-9);
    check('B8 · ohne Lüftungsrollen bleibt die Summe [W]',
      gebaeudeLueftung([{ rolle: 'none', watt: 100 }, { rolle: undefined, watt: 50 }]), 150, 1e-9);

    const e = estimateHeatLoad(doc);
    const raum = (id: string) => doc.rooms[id];
    const zu = e.rooms.filter((r) => raum(r.roomId)?.ventilationRole === 'supply').reduce((x, r) => x + r.ventilation, 0);
    const ab = e.rooms.filter((r) => raum(r.roomId)?.ventilationRole === 'exhaust').reduce((x, r) => x + r.ventilation, 0);
    check('B8 · Referenzhaus hat Zu- und Abluftraeume', zu > 0 && ab > 0, true);
    check('B8 · Überschlag: Gebäudelüftung = max(Zu, Ab) [W]', e.ventilation, Math.max(zu, ab), 1);
    check('B8 · Überschlag: Gebäude kleiner als Σ Räume',
      e.totalKw < e.rooms.reduce((x, r) => x + r.total, 0) / 1000, true);

    // Raumweise Norm-Heizlasten aus RaVia: mit Lüftungsanteil auf Gebäudeebene.
    const mitNorm = (mitAnteil: boolean): BimDocument => ({
      ...doc,
      rooms: Object.fromEntries(Object.entries(doc.rooms).map(([id, r]) => [id, r.isHeated
        ? { ...r, normHeatLoad: { total: 1000, ...(mitAnteil ? { ventilation: r.ventilationRole === 'exhaust' ? 300 : 200 } : {}), source: 'Prüfung', receivedAt: '2026-01-01T00:00:00.000Z' } }
        : r])),
    });
    const beheizt = Object.values(doc.rooms).filter((r) => r.isHeated);
    const nZu = beheizt.filter((r) => r.ventilationRole === 'supply' || r.ventilationRole === 'transfer').length;
    const nAb = beheizt.filter((r) => r.ventilationRole === 'exhaust').length;
    const nSonst = beheizt.length - nZu - nAb;
    const soll = beheizt.length * 1000 - (nZu * 200 + nAb * 300 + nSonst * 200) + Math.max(nZu * 200, nAb * 300) + nSonst * 200;
    const c = normHeatLoadCoverage(mitNorm(true));
    check('B8 · Raumlasten: Summe wie bisher [kW]', c.totalKw, beheizt.length, 1e-9);
    check('B8 · Raumlasten: Gebäude mit Lüftung auf Gebäudeebene [kW]', c.gebaeudeKw, soll / 1000, 1e-9);
    check('B8 · Anlage rechnet mit dem Gebäudewert [kW]', gebaeudeHeizlast(mitNorm(true)).heatLoad, soll / 1000, 1e-9);
    const ohne = normHeatLoadCoverage(mitNorm(false));
    check('B8 · ohne Lüftungsanteil: Summe, aber als solche erkannt', ohne.gebaeudeKw === ohne.totalKw && !ohne.lueftungGebaeude, true);
    check('B8 · ohne Lüftungsanteil: Warnung im Anlagenblatt',
      designPlant(mitNorm(false)).notes.some((n) => n.severity === 'warn' && n.text.includes('Lüftungsanteil')), true);
  }

  // -------------------------------------------------------------------------
  // F1 · ein Flächenaufbau für Überschlag und Export
  // -------------------------------------------------------------------------
  // Gegenprobe über die tatsächliche Übergabe: Für jeden beheizten Raum muss
  // der Überschlag (Transmission + Öffnungen, ohne ψ·l) genau
  // Σ A · (U + ΔU_WB) · (θi − θ_Nachbar) über die Exportflächen sein.
  {
    const exp = buildRaviaExport(doc);
    const zeilen = estimateHeatLoad(doc).rooms;
    let geprueft = 0;
    for (const er of exp.rooms) {
      const raum = doc.rooms[er.id];
      const z = zeilen.find((x) => x.roomId === er.id);
      if (!raum?.isHeated || !z) continue;
      let w = 0;
      for (const f of er.surfaces) {
        const dt = raum.setpointTemperature - f.neighbourTemperature;
        if (dt <= 0) continue;
        w += f.netArea * (f.uValue + f.thermalBridgeSupplement) * dt;
        for (const o of f.openings) w += o.area * (o.uValue + f.thermalBridgeSupplement) * dt;
      }
      const psi = roomBridgeHeatLoss(roomThermalBridges(doc, raum)) * (raum.setpointTemperature - doc.meta.designOutdoorTemperature);
      check(`F1 · ${raum.name}: Überschlag = Exportflächen [W]`, z.transmission + z.openings - psi, w, 1.5);
      geprueft++;
    }
    check('F1 · alle beheizten Räume geprüft', geprueft, Object.values(doc.rooms).filter((r) => r.isHeated).length);
    // Fenster mit ihrem eigenen U-Wert, nicht mehr pauschal 1,3.
    const eg = zeilen.find((r) => r.name === 'Wohnen EG')!;
    check('F1 · Fenster Wohnen EG mit U 1,1 statt 1,3 [W]', eg.openings,
      Math.round((2.7 * 1.1 + 1.35 * 1.1) * 32 + 1.78 * 1.8 * 0), 1);
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

  // -------------------------------------------------------------------------
  // Schritt 2 · Scan-Import ohne Datenverlust (K2, H1)
  // -------------------------------------------------------------------------
  {
    const text = quelle('scripts/referenz/ravia-building-beispiel.json');
    const modell = () => JSON.parse(text);

    // K2 · rooms[].heated → isHeated
    const m1 = modell();
    m1.rooms[0].heated = false;
    const r1 = importBuildingModel(m1);
    check('K2 · heated kommt im Ergebnis an', r1.raumBeheizung.length === 1 && r1.raumBeheizung[0].heated === false, true);
    check('K2 · ohne heated keine Angabe', importBuildingModel(modell()).raumBeheizung.length, 0);
    const b = r1.raumBeheizung[0];
    const raumDoc = {
      rooms: {
        a: { ...Object.values(doc.rooms)[0], id: 'a', levelId: b.levelId, isHeated: true,
          polygon: [{ x: b.punkt.x - 1, y: b.punkt.y - 1 }, { x: b.punkt.x + 1, y: b.punkt.y - 1 }, { x: b.punkt.x + 1, y: b.punkt.y + 1 }, { x: b.punkt.x - 1, y: b.punkt.y + 1 }] },
      },
    };
    check('K2 · Raum an der Stelle wird unbeheizt', uebernimmBeheizung(raumDoc, r1.raumBeheizung) === 1 && raumDoc.rooms.a.isHeated === false, true);

    // K2 · walls[].boundary nach Festlegung F4
    check('K2 · Außenwand „exterior" bleibt abgeleitet', randAusScan('exterior', 'exterior') ?? 'leer', 'leer');
    check('K2 · Innenwand „adjacent-room" bleibt abgeleitet', randAusScan('adjacent-room', 'interior') ?? 'leer', 'leer');
    check('K2 · unbekannter Wert wird nicht übernommen', randAusScan('garage', 'interior') ?? 'leer', 'leer');
    const m2 = modell();
    m2.walls.find((w: { id: string }) => w.id === 'w-001').boundary = 'neighbour';
    m2.walls.find((w: { id: string }) => w.id === 'w-004').boundary = 'unheated';
    const r2 = importBuildingModel(m2);
    const rand = (id: string) => [...new Set(r2.walls.filter((w) => w.id === id || w.id.startsWith(`${id}-`)).map((w) => w.boundary ?? 'leer'))].join(',');
    check('K2 · Außenwand zur fremden Nutzung: neighbour', rand('w-001'), 'neighbour');
    check('K2 · Innenwand zum Unbeheizten: unheated', rand('w-004'), 'unheated');
    check('K2 · übrige Wände ohne Übersteuerung', rand('w-002'), 'leer');

    // K2 · neighbour im Export und im Überschlag mit eigener Temperatur
    const raum = Object.values(doc.rooms).find((r) => r.name === 'Wohnen EG')!;
    const i = raum.boundaries.findIndex((x) => x.boundary === 'exterior' && x.netArea > 1);
    const mitNachbar = (meta: Partial<BimDocument['meta']>): BimDocument => ({
      ...doc,
      meta: { ...doc.meta, ...meta },
      rooms: { ...doc.rooms, [raum.id]: { ...raum, boundaries: raum.boundaries.map((x, k) => (k === i ? { ...x, boundary: 'neighbour' as const } : x)) } },
    });
    const flaeche = (d: BimDocument) => buildRaviaExport(d).rooms.find((r) => r.id === raum.id)!.surfaces.find((f) => f.boundary === 'neighbour');
    check('K2 · Export: boundary neighbour', flaeche(mitNachbar({}))?.boundary ?? 'fehlt', 'neighbour');
    check('K2 · Export: θ Nachbar ohne Eintrag 15 °C', flaeche(mitNachbar({}))?.neighbourTemperature ?? NaN, 15);
    check('K2 · Export: θ Nachbar eingetragen', flaeche(mitNachbar({ neighbourTemperature: 18 }))?.neighbourTemperature ?? NaN, 18);
    check('K2 · Export: project.neighbourTemperature', buildRaviaExport(mitNachbar({})).project.neighbourTemperature ?? NaN, 15);
    const t = (d: BimDocument) => estimateHeatLoad(d).rooms.find((r) => r.roomId === raum.id)!;
    check('K2 · Überschlag: Wand zum Nachbarn verliert mit Δθ 5 K weniger als zur Außenluft',
      t(mitNachbar({})).transmission < t(doc).transmission, true);

    // H1 · Leistungsangaben von RaVia an den Heizkörpern
    const m3 = modell();
    Object.assign(m3.emitters[0], { ratedPower: 1520.4, exponentN: 1.33, ratedPowerSource: 'typenschild', panelType: '33' });
    m3.emitters[1].ratedPower = 900;
    const hk = importBuildingModel(m3).fixtures;
    const p0 = hk.find((f) => f.id === `sc-${m3.emitters[0].id}`)!.params;
    const p1 = hk.find((f) => f.id === `sc-${m3.emitters[1].id}`)!.params;
    check('H1 · ratedPower übernommen [W]', p0.ratedPower ?? NaN, 1520);
    check('H1 · exponentN übernommen', p0.exponentN ?? NaN, 1.33);
    check('H1 · ratedPowerSource übernommen', p0.ratedPowerSource ?? '', 'typenschild');
    check('H1 · panelType von RaVia geht vor', p0.radiatorType ?? '', '33');
    check('H1 · ohne Herkunft: datenblatt', p1.ratedPowerSource ?? '', 'datenblatt');
    const ohne = importBuildingModel(modell()).fixtures[0].params;
    check('H1 · ohne Angabe keine Leistung erfunden', ohne.ratedPower === undefined && ohne.exponentN === undefined, true);

    // Bad/WC prüfen: RoomPlan kennt kein WC; die Raumliste bietet die
    // Prüfung an, bis jemand sie bestätigt hat, und die Bestätigung
    // überlebt das Neuerkennen.
    check('Bad/WC · Raumliste bietet die Prüfung an',
      /usage === 'bath' && !room\.nutzungGeprueft/.test(quelle('src/components/LayerPanel.tsx')) &&
        quelle('src/components/LayerPanel.tsx').includes('Bad/WC prüfen'), true);
    check('Bad/WC · Bestätigung überlebt das Neuerkennen',
      quelle('src/lib/roomDetection.ts').includes('inherited?.nutzungGeprueft'), true);
  }

}
