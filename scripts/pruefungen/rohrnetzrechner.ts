/**
 * Prüfblock „Rohrnetzrechner" — Armaturenkatalog, Abgleich, Bericht, Blätter.
 *
 * **Warum dieser Block gebraucht wird.** Mit 1.12.0 ist aus dem hydraulischen
 * Abgleich ein Nachweis geworden: `valveCatalog.ts` übersetzt den gerechneten
 * k_v in eine Zahl, die am Ventil steht, `pipeReport.ts` baut daraus die
 * Teilstreckentabelle und die sieben Pflichtangaben, `pipeReportPrint.ts` setzt
 * beides auf A4. Alle drei Schritte haben dieselbe unangenehme Eigenschaft:
 * **sie sehen richtig aus, auch wenn sie falsch sind.** Eine Voreinstellung
 * „5" ist eine plausible Zahl, egal ob sie aus der richtigen Zeile stammt; eine
 * Teilstreckentabelle mit fünfzehn Spalten wirkt gerechnet, auch wenn in der
 * Spalte Z überall null steht; ein Blatt sieht gedruckt aus, auch wenn ein
 * kaufmännisches Und die Datei zerlegt hat.
 *
 * Geprüft werden deshalb fünf Fehlerklassen, die genau hier entstehen:
 *
 *  1. **Die Rundungsfalle in der k_v-Definition.** k_v = V̇·√(Δp₀/Δp · ρ/ρ₀)
 *     ist eine Festlegung, keine Näherung. Wer sie mit der Kurzformel
 *     k_v ≈ V̇/√(Δp[bar]) rechnet, verliert die Dichte — bei Glykol sind das
 *     über 10 %. Geprüft wird deshalb nicht „ungefähr", sondern gegen das von
 *     Hand ausgerechnete Zahlenbeispiel des VdZ-Leitfadens, und zusätzlich
 *     gegen die eigene Umkehrfunktion: `pressureFromKv(V̇, requiredKv(V̇, Δp))`
 *     muss wieder Δp sein, sonst ist eine der beiden Formeln falsch.
 *
 *  2. **Die falsche Richtung bei der Voreinstellung.** Gewählt werden muss die
 *     Stufe mit dem *kleinsten k_v, der noch mindestens den erforderlichen
 *     Durchfluss liefert* — also die nächstgrößere. Die Verwechslung mit der
 *     nächstkleineren fällt an keinem einzigen Wert auf, an dem der Bedarf
 *     zufällig auf einer Stufe liegt. Sie fällt nur an den Werten *zwischen*
 *     zwei Stufen auf, und genau dort wird gemessen: 0,15 (auf der Stufe) gegen
 *     0,16 (einen Hauch darüber) muss zwei verschiedene Stufen ergeben.
 *
 *  3. **Der Werkstoff, der nicht durchgreift.** Das ist der Fehler, der in
 *     1.12.0 behoben wurde und der hier festgenagelt wird, damit er nicht
 *     zurückkommt: der Rohrausleger legt in Verbundrohr aus und schreibt das an
 *     jede Leitung; der Abgleich rechnete trotzdem in seiner Vorgabe Kupfer
 *     nach. Bei R ~ d⁻⁴·⁷⁵ ist das ein systematischer Fehler, den kein Blick
 *     auf die Tabelle findet — die Zahlen sind alle plausibel, nur eben für ein
 *     anderes Rohr.
 *
 *  4. **Der stille Nullwert.** `thermostatPressure: 0` heißt „kein
 *     Auslegungsdruck übergeben" und darf **nicht** zu `valvePressure: 0`,
 *     `authority: 0` und einer Voreinstellstufe für null Pascal führen. Eine 0
 *     ist eine Aussage; `undefined` ist das Eingeständnis, keine zu haben. Der
 *     Unterschied entscheidet darüber, ob im Bericht eine Lücke steht oder eine
 *     erfundene Zahl.
 *
 *  5. **Das Blatt, das kein Blatt ist.** SVG ist XML. Ein unmaskiertes `&` im
 *     Projektnamen macht aus dem Ausdruck eine Fehlermeldung, und zwar erst im
 *     Druckdialog des Anwenders. Das Prüfhaus heißt deshalb absichtlich
 *     „Prüfhaus & Co <1>": jeder Zeichen, das XML zerlegen kann, ist im Titel
 *     enthalten und muss auf jedem Blatt maskiert wieder herauskommen.
 *
 * **Herleitung der Sollwerte.** Jeder Zahlenwert unten ist im Kommentar
 * ausgerechnet, keiner ist aus dem Prüfling abgelesen. Wo sich ein Absolutwert
 * nicht von Hand herleiten lässt (Colebrook-White ist iterativ), wird nicht die
 * Zahl geprüft, sondern die **Beziehung**, die zwischen zwei Zahlen gelten muss
 * — Δp = R·l + Z, Summe der Teilstrecken = Summe über die Stränge, gleiches
 * Dokument ⇒ gleiche Tabelle. Eine Prüfung, die den Prüfling nach dem Sollwert
 * fragt, prüft nichts.
 *
 * **Befunde.** Vier Prüfungen unten tragen im Namen die Marke `BEFUND:`. Sie
 * scheitern, und zwar absichtlich: sie halten fest, was der Prüfling heute
 * anders macht, als seine eigene Dokumentation zusagt. Sie sind nicht auf das
 * Ist-Verhalten umgestellt worden, weil eine Prüfung, die den Fehler als
 * Sollwert einträgt, den Fehler festschreibt statt ihn zu melden.
 */

import type { CheckFn } from './typ';
import type {
  BimDocument,
  BimNode,
  Fixture,
  Level,
  Opening,
  PipeAccessory,
  PipeNetworkReport,
  PipePath,
  PipeRun,
  PipeSegment,
  Wall,
} from '../../src/types/bim';
import { emptyPlant, emptySite } from '../../src/lib/plantDefaults';
import { detectRooms } from '../../src/lib/roomDetection';
import { planPipeNetwork } from '../../src/lib/pipeLayout';
import { buildPipeNetwork } from '../../src/lib/pipeNetwork';
import { balanceNetwork, DEFAULT_SEGMENT_ZETA } from '../../src/lib/hydraulicBalance';
import {
  DEFAULT_THERMOSTAT_PRESSURE,
  HEIMEIER_V_EXACT_II_XP2,
  KV_REFERENCE_DENSITY,
  KV_REFERENCE_PRESSURE,
  MAX_VALVE_AUTHORITY,
  MIN_VALVE_AUTHORITY,
  TARGET_VALVE_AUTHORITY,
  VALVE_MODELS,
  authorityVerdict,
  findValveModel,
  modelFor,
  pressureFromKv,
  requiredKv,
  selectPreset,
  valveAuthority,
} from '../../src/lib/valveCatalog';
import { armaturenListe, berichtsUrteil, buildPipeReport, vorherrschenderWerkstoff } from '../../src/lib/pipeReport';
import { buildPipeReportSheets } from '../../src/lib/pipeReportPrint';

// ---------------------------------------------------------------------------
// Das Prüfhaus
// ---------------------------------------------------------------------------

/**
 * Zwei Räume, 10,00 × 4,00 m Achsmaß, dazwischen eine Trennwand mit Tür.
 * Verteiler im linken Raum, zwei Heizkörper im rechten.
 *
 * Nachgebaut nach `rohrausleger.ts` — dort ist `baueHaus` nicht ausgeführt, und
 * ein Import querbeet zwischen Prüfblöcken würde die Blöcke aneinanderketten:
 * eine Änderung am einen Prüfhaus ließe den anderen Block scheitern, ohne dass
 * an seinem Prüfling irgendetwas geändert worden wäre.
 *
 * **Der Name ist Absicht.** „Prüfhaus & Co <1>" enthält alle drei Zeichen, die
 * XML zerlegen. Er wandert über `doc.meta.name` in `bericht.titel`, von dort in
 * Kopfzeile und Deckblatt jedes Blattes — und muss dort maskiert ankommen.
 */
const B = 10;
const T = 4;
const DICKE = 0.24;
const HOEHE = 2.75;

function baueHaus(): BimDocument {
  const nodes: Record<string, BimNode> = {};
  const walls: Record<string, Wall> = {};
  const openings: Record<string, Opening> = {};

  const p = (name: string, x: number, y: number): void => {
    nodes[name] = { id: name, x, y, levelId: 'eg' };
  };
  p('sw', 0, 0);
  p('se', B, 0);
  p('ne', B, T);
  p('nw', 0, T);
  p('ms', B / 2, 0);
  p('mn', B / 2, T);

  const wand = (name: string, a: string, b: string, typ: Wall['type'] = 'exterior'): void => {
    walls[name] = {
      id: name,
      a,
      b,
      levelId: 'eg',
      type: typ,
      thickness: DICKE,
      uValue: typ === 'exterior' ? 0.28 : 1.2,
      height: HOEHE,
      layerId: 'layer-walls',
    };
  };
  wand('w-s1', 'sw', 'ms');
  wand('w-s2', 'ms', 'se');
  wand('w-e', 'se', 'ne');
  wand('w-n1', 'ne', 'mn');
  wand('w-n2', 'mn', 'nw');
  wand('w-w', 'nw', 'sw');
  wand('w-m', 'ms', 'mn', 'interior');

  // Ohne die Tür zerfällt der Grundriss in zwei Inseln und keine Trasse käme in
  // den rechten Raum.
  openings['t-1'] = {
    id: 't-1',
    wallId: 'w-m',
    kind: 'door',
    distance: T / 2,
    width: 0.885,
    height: 2.01,
    sillHeight: 0,
    doorType: 'single',
  };

  const fixture = (id: string, type: Fixture['type'], x: number, y: number, powerW?: number): Fixture => ({
    id,
    type,
    category: 'heating',
    levelId: 'eg',
    position: { x, y },
    rotation: 0,
    length: 1,
    depth: 0.1,
    elevation: 0.3,
    label: id,
    params: powerW ? { powerW } : {},
  });

  const eg: Level = {
    id: 'eg',
    name: 'EG',
    order: 0,
    elevation: 0,
    height: HOEHE,
    floorUValue: 0.35,
    floorBoundary: 'ground',
    ceilingUValue: 0.2,
    ceilingBoundary: 'unheated',
  };

  const doc: BimDocument = {
    site: emptySite(),
    plant: emptyPlant(),
    meta: {
      name: 'Prüfhaus & Co <1>',
      createdAt: '2026-01-01T00:00:00.000Z',
      modifiedAt: '2026-01-01T00:00:00.000Z',
      northAngle: 0,
      designOutdoorTemperature: -12,
      designIndoorTemperature: 20,
      n50: 1.5,
      shielding: 'moderate',
      unheatedTemperature: 10,
      groundTemperature: 10,
      thermalBridgeSupplement: 0,
      thermalBridgeMethod: 'flat',
      thermalBridgeCategory: 'custom',
      reheatFactor: 0,
    },
    levels: { eg },
    layers: {},
    nodes,
    walls,
    openings,
    fixtures: {
      'v-1': fixture('v-1', 'manifold', 0.6, 0.6),
      'hk-1': fixture('hk-1', 'radiator', 9.2, 0.6, 1400),
      'hk-2': fixture('hk-2', 'radiator', 9.2, 3.4, 900),
    },
    verticals: {},
    solids: {},
    pipes: {},
    pipeAccessories: {},
    annotations: {},
    roofOpenings: {},
    rooms: {},
    constructions: {},
    diagnostics: { openEnds: [] },
    activeLevelId: 'eg',
  };

  const raeume = detectRooms({
    nodes: doc.nodes,
    walls: Object.values(doc.walls),
    openings: Object.values(doc.openings),
    levelId: 'eg',
    defaultHeight: HOEHE,
    northAngle: 0,
  });
  doc.rooms = Object.fromEntries(raeume.map((r) => [r.id, r]));
  for (const raum of Object.values(doc.rooms)) {
    raum.setpointTemperature = 20;
    raum.isHeated = true;
  }
  return doc;
}

/** Das Prüfhaus mit ausgelegtem Rohrnetz — `doc.pipes` und `doc.pipeAccessories` gefüllt. */
function hausMitNetz(): { doc: BimDocument; runs: PipeRun[]; armaturen: PipeAccessory[] } {
  const doc = baueHaus();
  const plan = planPipeNetwork(doc, {
    mode: 'sanierung',
    levelId: 'eg',
    flowTemperature: 55,
    returnTemperature: 45,
  });
  doc.pipes = Object.fromEntries(plan.runs.map((r) => [r.id, r]));
  doc.pipeAccessories = Object.fromEntries(plan.accessories.map((a) => [a.id, a]));
  return { doc, runs: plan.runs, armaturen: plan.accessories };
}

// ---------------------------------------------------------------------------
// Messhilfen
// ---------------------------------------------------------------------------

/**
 * Ein Netz aus genau einem Abschnitt, den der Aufrufer bestimmt.
 *
 * Der Weg über `balanceNetwork` ist der einzige, auf dem sich `segmentFittings`
 * und `segmentDimension` prüfen lassen — beide sind modulintern. Ein Netz mit
 * einem einzigen Abschnitt macht die Wirkung isoliert sichtbar: was sich am
 * Σζ ändert, kann nur aus dem geänderten Abschnitt stammen.
 */
function einAbschnitt(zusatz: Partial<PipeSegment>): PipeNetworkReport {
  const segment: PipeSegment = {
    runId: 'r-1',
    length: 5,
    nominalDiameter: 15,
    insulation: 0,
    service: 'heating-flow',
    ...zusatz,
  };
  const path: PipePath = {
    fixtureId: 'hk',
    fixtureType: 'radiator',
    label: 'Prüf-Heizkörper',
    levelId: 'eg',
    sourceFixtureId: 'q',
    sourceLabel: 'Prüf-Verteiler',
    routeLength: 5,
    circuitLength: 10,
    elevationChange: 0,
    minimumDiameter: 15,
    segments: [segment],
  };
  return {
    paths: [path],
    unconnected: [],
    sources: [{ fixtureId: 'q', label: 'Prüf-Verteiler', levelId: 'eg', consumers: 1 }],
    risers: 0,
  };
}

/** Dasselbe Netz, aber ohne die Angaben, die erst ab 1.12.0 am Abschnitt stehen. */
function ohneFelder(
  netz: PipeNetworkReport,
  felder: readonly ('material' | 'outerDiameter' | 'bends' | 'accessories')[],
): PipeNetworkReport {
  const streiche = new Set<string>(felder);
  return {
    ...netz,
    paths: netz.paths.map((path) => ({
      ...path,
      segments: path.segments.map((s) => {
        const kopie: PipeSegment = {
          runId: s.runId,
          length: s.length,
          nominalDiameter: s.nominalDiameter,
          insulation: s.insulation,
          service: s.service,
        };
        if (!streiche.has('material') && s.material !== undefined) kopie.material = s.material;
        if (!streiche.has('outerDiameter') && s.outerDiameter !== undefined) kopie.outerDiameter = s.outerDiameter;
        if (!streiche.has('bends') && s.bends !== undefined) kopie.bends = s.bends;
        if (!streiche.has('accessories') && s.accessories !== undefined) kopie.accessories = [...s.accessories];
        return kopie;
      }),
    })),
  };
}

/**
 * Textinhalte aller `<text>`-Elemente eines SVG.
 *
 * Gesucht wird der Inhalt zwischen Anfangs- und Endmarke, und zwar nur solcher,
 * der selbst keine Marke enthält — genau das ist der Bereich, den `escapeXml`
 * verantwortet.
 */
function textinhalte(svg: string): string[] {
  return [...svg.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
}

/** Ein `&`, das keine gültige Entität einleitet — der klassische XML-Zerleger. */
const ROHES_UND = /&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/;

/** Zählt Vorkommen einer Zeichenkette. */
function zaehle(text: string, marke: string): number {
  let n = 0;
  let i = text.indexOf(marke);
  while (i >= 0) {
    n += 1;
    i = text.indexOf(marke, i + marke.length);
  }
  return n;
}

const r4 = (v: number): number => Math.round(v * 10000) / 10000;

/**
 * Ein fehlendes Feld prüfbar machen, ohne die Lücke zuzuschütten.
 *
 * `?? ''` machte aus „nicht gefunden" eine leere Zeichenkette, und die Prüfung
 * könnte gegen keinen Sollwert mehr scheitern, wenn die Suche eines Tages nichts
 * mehr findet. `'fehlt'` ist gegen jeden Sollwert falsch und steht so im
 * Protokoll.
 */
function kennung(value: string | undefined): string {
  return value === undefined ? 'fehlt' : value;
}

// ---------------------------------------------------------------------------

export function pruefeRohrnetzrechner(check: CheckFn): void {
  // =========================================================================
  // 1 · Die k_v-Rechnung — exakt, nicht genähert
  // =========================================================================
  {
    /*
     * Definition (delta-q/IfHK, „Druckverluste in thermostatischen
     * Heizkörperventilen", S. 4 f.):
     *
     *     k_v = V̇ · √(Δp₀/Δp · ρ/ρ₀)      mit Δp₀ = 1 bar, ρ₀ = 1000 kg/m³
     *     Δp  = (V̇/k_v)² · (ρ/ρ₀) · Δp₀
     *
     * Beide Formeln sind dieselbe Gleichung, einmal nach k_v und einmal nach Δp
     * aufgelöst. Sie müssen deshalb exakt invers sein — nicht „nahe beieinander".
     *
     * Zahlenbeispiel VdZ (V̇ = 0,050 m³/h, Δp = 2400 Pa, ρ = ρ₀), von Hand:
     *
     *     100000 / 2400 = 41,6666667
     *     √41,6666667   =  6,4549722
     *     0,050 · 6,4549722 = 0,32274861
     *
     * Auf zwei Stellen gerundet: 0,32. Das ist die Zahl, die im Leitfaden steht.
     */
    check('Referenzdruck der k_v-Definition ist 1 bar [Pa]', KV_REFERENCE_PRESSURE, 100000);
    check('Referenzdichte der k_v-Definition [kg/m³]', KV_REFERENCE_DENSITY, 1000);

    const kvVdZ = requiredKv(0.05, 2400);
    check('VdZ-Beispiel: k_v ungerundet [m³/h]', kvVdZ, 0.32274861, 1e-7);
    check('VdZ-Beispiel: k_v auf zwei Stellen [m³/h]', Math.round(kvVdZ * 100) / 100, 0.32, 1e-9);

    // Umkehrung: derselbe Volumenstrom durch dieselbe Armatur muss wieder
    // genau den Ausgangsdruck ergeben. Toleranz 1e-6 Pa — das ist die
    // Rechengenauigkeit, nicht ein Zugeständnis an die Formel.
    check('Umkehrung trifft den Ausgangsdruck [Pa]', pressureFromKv(0.05, kvVdZ), 2400, 1e-6);
    check('Umkehrung auch bei 0,25 m³/h und 18 kPa [Pa]',
      pressureFromKv(0.25, requiredKv(0.25, 18000)), 18000, 1e-6);
    check('Umkehrung auch bei kleinem Druck (200 Pa) [Pa]',
      pressureFromKv(0.03, requiredKv(0.03, 200)), 200, 1e-6);

    /*
     * Dichtekorrektur. ρ geht als √(ρ/ρ₀) ein:
     *   ρ = 900  → √0,9 = 0,9486833 → 0,32274861 · 0,9486833 = 0,30618622
     *   ρ = 1100 → √1,1 = 1,0488088 → 0,32274861 · 1,0488088 = 0,33850160
     * Ein Modul, das die Dichte verschluckt, liefert dreimal denselben Wert.
     */
    check('Dichtekorrektur ρ = 900 kg/m³ [m³/h]', requiredKv(0.05, 2400, 900), 0.30618622, 1e-7);
    check('Dichtekorrektur ρ = 1100 kg/m³ [m³/h]', requiredKv(0.05, 2400, 1100), 0.33850160, 1e-7);
    check('Die Dichte verschiebt das Ergebnis messbar',
      Math.abs(requiredKv(0.05, 2400, 900) - kvVdZ) > 0.01, true);
    // Und die Umkehrung trägt dieselbe Dichte mit: sonst wäre der Kreis offen.
    check('Umkehrung mit ρ = 1100 kg/m³ [Pa]',
      pressureFromKv(0.05, requiredKv(0.05, 2400, 1100), 1100), 2400, 1e-6);

    /*
     * Grenzfälle. Δp = 0 hieße „unendlicher k_v", V̇ = 0 hieße „k_v beliebig".
     * Beides ist keine Zahl. Zurückgegeben wird 0 — und nicht Infinity oder NaN,
     * die weiter unten im Bericht als Zahl auftauchen würden.
     */
    check('Δp = 0 liefert keinen k_v', requiredKv(0.05, 0), 0);
    check('V̇ = 0 liefert keinen k_v', requiredKv(0, 2400), 0);
    check('Negativer Volumenstrom liefert keinen k_v', requiredKv(-0.05, 2400), 0);
    check('Negativer Druck liefert keinen k_v', requiredKv(0.05, -2400), 0);
    check('k_v = 0 liefert keinen Druck', pressureFromKv(0.05, 0), 0);
    check('V̇ = 0 liefert keinen Druck', pressureFromKv(0, 0.3), 0);
    check('Negativer k_v liefert keinen Druck', pressureFromKv(0.05, -0.3), 0);
    check('Kein Grenzfall liefert NaN',
      [requiredKv(0.05, 0), requiredKv(0, 0), pressureFromKv(0, 0)].every((v) => Number.isFinite(v)), true);
  }

  // =========================================================================
  // 2 · Voreinstellung — die nächstgrößere Stufe, nicht die nächstkleinere
  // =========================================================================
  {
    /*
     * Tabelle IMI Heimeier V-exact II bei x_p = 2 K:
     *   1 → 0,049   2 → 0,090   3 → 0,150   4 → 0,265
     *   5 → 0,330   6 → 0,470   7 → 0,590   8 → 0,670   (k_vs 0,86)
     *
     * Regel: gesucht ist die Stufe mit dem kleinsten k_v, der noch ≥ dem
     * erforderlichen ist. Begründung im Modul: zu wenig Durchfluss kostet
     * Behaglichkeit, zu viel kostet Energie — im Zweifel gewinnt der warme Raum.
     *
     * Herleitung der Sollwerte:
     *   erf 0,10 → 0,049 < 0,10, 0,090 < 0,10, 0,150 ≥ 0,10 → Stufe 3
     *   erf 0,15 → 0,150 ≥ 0,150 (Gleichheit zählt) → Stufe 3
     *   erf 0,16 → 0,150 < 0,16, 0,265 ≥ 0,16 → Stufe 4
     *   erf 0,70 → keine Stufe erreicht 0,70 (größte 0,67) → über dem Bereich
     *   erf 0,01 → unter der kleinsten Stufe 0,049 → unter dem Bereich
     *
     * 0,15 gegen 0,16 ist das eigentliche Paar: nur dort trennt sich „nächst-
     * größere" von „nächstkleinere".
     */
    const modell = HEIMEIER_V_EXACT_II_XP2;
    const flow = 0.1;

    const a = selectPreset(0.1, modell, flow);
    check('erf 0,10 → Stufe 3', a.setting, '3');
    check('erf 0,10 → k_v der Stufe [m³/h]', a.kv, 0.15, 1e-9);
    check('erf 0,10 → passt', a.fit, 'passt');
    // Abweichung (0,150 − 0,100)/0,100 = 0,50
    check('erf 0,10 → Abweichung 0,50', a.deviation, 0.5, 1e-9);

    const b = selectPreset(0.15, modell, flow);
    check('erf 0,15 liegt genau auf der Stufe → Stufe 3', b.setting, '3');
    check('… und die Abweichung ist null', b.deviation, 0, 1e-9);

    const c = selectPreset(0.16, modell, flow);
    check('erf 0,16 → eine Stufe höher, Stufe 4', c.setting, '4');
    check('erf 0,16 → k_v der Stufe [m³/h]', c.kv, 0.265, 1e-9);
    // (0,265 − 0,16)/0,16 = 0,105/0,16 = 0,65625
    check('erf 0,16 → Abweichung 0,65625', c.deviation, 0.65625, 1e-9);
    check('0,15 und 0,16 führen auf verschiedene Stufen', b.setting !== c.setting, true);

    const d = selectPreset(0.7, modell, flow);
    check('erf 0,70 liegt über der größten Stufe', d.fit, 'ueber-bereich');
    check('… gewählt wird trotzdem die größte Stufe 8', d.setting, '8');
    check('… mit k_v 0,67 [m³/h]', d.kv, 0.67, 1e-9);

    const e = selectPreset(0.01, modell, flow);
    check('erf 0,01 liegt unter der kleinsten Stufe', e.fit, 'unter-bereich');
    check('… gewählt wird die kleinste Stufe 1', e.setting, '1');

    /*
     * `actualPressure` ist der Druck, der mit der *gewählten* Stufe tatsächlich
     * ansteht — nicht der geforderte. Genau diese Differenz ist der Grund,
     * warum ein Abgleich nie exakt aufgeht. Von Hand für V̇ = 0,100 m³/h:
     *   Stufe 3: (0,100/0,150)² · 1e5 = 0,6666667² · 1e5 = 44444,44 Pa
     *   Stufe 4: (0,100/0,265)² · 1e5 = 0,3773585² · 1e5 = 14239,94 Pa
     *   Stufe 8: (0,100/0,670)² · 1e5 = 0,1492537² · 1e5 =  2227,66 Pa
     */
    check('Stufe 3 bei 0,100 m³/h ergibt 44444 Pa', a.actualPressure, 44444.44, 0.01);
    check('Stufe 4 bei 0,100 m³/h ergibt 14240 Pa', c.actualPressure, 14239.94, 0.01);
    check('Stufe 8 bei 0,100 m³/h ergibt 2228 Pa', d.actualPressure, 2227.66, 0.01);
    check('actualPressure ist pressureFromKv der gewählten Stufe [Pa]',
      a.actualPressure, pressureFromKv(flow, a.kv), 1e-9);
    check('… auch bei der obersten Stufe [Pa]', d.actualPressure, pressureFromKv(flow, d.kv), 1e-9);
    check('… und mit Dichtekorrektur [Pa]',
      selectPreset(0.16, modell, flow, 1100).actualPressure, pressureFromKv(flow, 0.265, 1100), 1e-9);
    check('Die Auswahl trägt den erforderlichen k_v mit', c.requiredKv, 0.16, 1e-9);
    check('… und die Baureihe, aus der sie stammt', c.model.id, modell.id);
  }

  // =========================================================================
  // 3 · Die Tabellen selbst
  // =========================================================================
  {
    /*
     * Eine k_v-Tabelle mit einer verrutschten Zeile ist nicht als Zahl
     * erkennbar, wohl aber als Ordnung: eine höhere Voreinstellung öffnet
     * weiter, also muss k_v streng monoton steigen. Und der k_vs — der Wert bei
     * voller Öffnung — kann nicht kleiner sein als die größte Stufe, sonst
     * würde das Ventil beim Aufdrehen zufahren.
     */
    let monoton = true;
    let kvsGross = true;
    let dnBelegt = true;
    let quelleBelegt = true;
    let stufenBenannt = true;
    for (const m of VALVE_MODELS) {
      for (let i = 1; i < m.steps.length; i++) {
        if (!(m.steps[i].kv > m.steps[i - 1].kv)) monoton = false;
      }
      if (!(m.kvs >= Math.max(...m.steps.map((s) => s.kv)) - 1e-12)) kvsGross = false;
      if (m.dn.length === 0) dnBelegt = false;
      if (m.source.trim().length < 10) quelleBelegt = false;
      if (m.steps.some((s) => s.setting.trim().length === 0)) stufenBenannt = false;
    }
    check('Es gibt überhaupt Baureihen', VALVE_MODELS.length > 0, true);
    check('Jede Baureihe steigt streng monoton im k_v', monoton, true);
    check('Der k_vs ist nie kleiner als die größte Stufe', kvsGross, true);
    check('Jede Baureihe nennt ihre Nennweiten', dnBelegt, true);
    check('Jede Baureihe nennt ihre Quelle', quelleBelegt, true);
    check('Jede Stufe trägt eine Beschriftung', stufenBenannt, true);

    const ids = VALVE_MODELS.map((m) => m.id);
    check('Die Kennungen sind eindeutig', new Set(ids).size, ids.length);
    check('Jede Kennung ist auffindbar', ids.every((id) => findValveModel(id)?.id === id), true);
    check('Eine erfundene Kennung liefert nichts', findValveModel('gibt-es-nicht') === undefined, true);

    /*
     * Nennweitenwahl beim Strangregulierventil. DN 32 hat eine eigene Tabelle;
     * DN 65 hat keine. Die dokumentierte Regel ist „nächstkleinere", also die
     * größte Baugröße, die noch ≤ 65 ist — das ist DN 50. Die naheliegende
     * Fehlimplementierung liefert stattdessen die *kleinste* Tabelle (DN 10),
     * weil die Suche mit ihr beginnt und nie überschrieben wird.
     */
    check('DN 32 hat eine eigene STAD-Tabelle', kennung(modelFor('balancing', 32)?.id), 'imi-ta-stad-dn32');
    check('DN 65 fällt auf die nächstkleinere DN 50', kennung(modelFor('balancing', 65)?.id), 'imi-ta-stad-dn50');
    check('… und nicht auf die kleinste Tabelle', modelFor('balancing', 65)?.id !== 'imi-ta-stad-dn10', true);
    check('DN 15 trifft die STAD-DN-15-Tabelle', kennung(modelFor('balancing', 15)?.id), 'imi-ta-stad-dn15');
    // Thermostatventile gibt es nicht je Nennweite; dort greift die Vorgabe.
    check('Das Thermostatventil kommt aus der Vorgabebaureihe',
      kennung(modelFor('thermostat', 15)?.id), 'heimeier-v-exact-ii-xp2');
    check('Die Rücklaufverschraubung ebenso', kennung(modelFor('lockshield', 15)?.id), 'heimeier-regulux');
    check('Jede Thermostat-Baureihe führt ihren Proportionalbereich',
      VALVE_MODELS.filter((m) => m.role === 'thermostat').every((m) => (m.xp ?? 0) > 0), true);
    check('Regulier- und Absperrarmaturen führen keinen',
      VALVE_MODELS.filter((m) => m.role !== 'thermostat').every((m) => m.xp === undefined), true);
  }

  // =========================================================================
  // 4 · Ventilautorität
  // =========================================================================
  {
    /*
     * a_V = Δp_Ventil / (Δp_Ventil + Δp_Netz). Von Hand:
     *   10000 / (10000 + 10000) = 0,50
     *    3000 / ( 3000 +  7000) = 0,30
     *   12000 / (12000 +  8000) = 0,60
     *    2000 / ( 2000 + 18000) = 0,10
     *   Netz = 0: das Ventil ist der ganze Kreis → 1,00
     */
    check('a_V bei 10 kPa gegen 10 kPa', valveAuthority(10000, 10000), 0.5, 1e-12);
    check('a_V bei 3 kPa gegen 7 kPa', valveAuthority(3000, 7000), 0.3, 1e-12);
    check('a_V bei 12 kPa gegen 8 kPa', valveAuthority(12000, 8000), 0.6, 1e-12);
    check('a_V bei 2 kPa gegen 18 kPa', valveAuthority(2000, 18000), 0.1, 1e-12);
    check('Ohne Netzverlust ist die Autorität eins', valveAuthority(5000, 0), 1, 1e-12);
    check('Ohne jeden Druck gibt es keine Autorität', valveAuthority(0, 0), 0);

    /*
     * Die Schwellen des Urteils, jeweils beidseitig. Ein „<" statt „≤" fällt
     * genau und nur hier auf:
     *   < 0,30 → zu klein            0,30 ist bereits nicht mehr „zu klein"
     *   < 0,50 → grenzwertig         0,50 ist das Auslegungsziel, also „gut"
     *   ≤ 0,60 → gut                 0,60 ist die Obergrenze, noch „gut"
     *   > 0,60 → unwirtschaftlich    0,61 liegt darüber
     */
    check('Die Mindestautorität steht bei 0,30', MIN_VALVE_AUTHORITY, 0.3, 1e-12);
    check('Das Auslegungsziel steht bei 0,50', TARGET_VALVE_AUTHORITY, 0.5, 1e-12);
    check('Die Wirtschaftlichkeitsgrenze steht bei 0,60', MAX_VALVE_AUTHORITY, 0.6, 1e-12);
    check('a_V = 0,29 ist zu klein', authorityVerdict(0.29), 'zu klein');
    check('a_V = 0,30 ist nicht mehr zu klein', authorityVerdict(0.3), 'grenzwertig');
    check('a_V = 0,49 ist grenzwertig', authorityVerdict(0.49), 'grenzwertig');
    check('a_V = 0,50 ist gut', authorityVerdict(0.5), 'gut');
    check('a_V = 0,60 ist noch gut', authorityVerdict(0.6), 'gut');
    check('a_V = 0,61 ist unwirtschaftlich', authorityVerdict(0.61), 'unwirtschaftlich');
  }

  // =========================================================================
  // 5 · Werkstoff-Durchgriff — der Fehler, der behoben wurde
  // =========================================================================
  const { doc, runs, armaturen } = hausMitNetz();
  const netz = buildPipeNetwork(doc);
  {
    /*
     * Der Rohrausleger legt in Verbundrohr aus (Vorgabe von `planPipeNetwork`)
     * und schreibt Werkstoff und Außendurchmesser an jede erzeugte Leitung.
     * `buildPipeNetwork` reicht beides bis an den Abschnitt durch. Der Abgleich
     * muss deshalb **in Verbund** nachrechnen, auch wenn ihm als Vorgabe Kupfer
     * übergeben wird — sonst rechnet er ein anderes Rohr nach, als gezeichnet
     * wurde. Bei R ~ d⁻⁴·⁷⁵ ist das kein Rundungsfehler.
     */
    check('Das Prüfhaus hat zwei Räume', Object.keys(doc.rooms).length, 2);
    check('Das Netz ist ausgelegt', runs.length > 0, true);
    check('Jede erzeugte Leitung trägt ihren Werkstoff',
      runs.every((r) => r.material === 'verbund'), true);
    check('… und ihren Außendurchmesser [mm]',
      runs.every((r) => (r.outerDiameter ?? 0) > 0), true);
    check('Beide Heizkörper hängen am Netz', netz.paths.length, 2);
    check('Der Werkstoff kommt am Abschnitt an',
      netz.paths.every((p) => p.segments.every((s) => s.material === 'verbund')), true);

    const mitVorgabeKupfer = balanceNetwork({
      network: netz, fixtures: doc.fixtures, spread: 10, material: 'kupfer',
    });
    check('Trotz Vorgabe Kupfer wird in Verbund gerechnet',
      mitVorgabeKupfer.consumers[0].path.segments[0].dimension.material, 'verbund');
    check('… und zwar auf jedem Abschnitt jedes Strangs',
      mitVorgabeKupfer.consumers.every((c) => c.path.segments.every((s) => s.dimension.material === 'verbund')),
      true);
    // Der Außendurchmesser des Modells muss die Abmessung bestimmen, nicht die
    // Nennweite: 20 mm außen ist in der Verbundreihe die Abmessung 20 × 2.
    check('Die Abmessung folgt dem Außendurchmesser des Modells',
      mitVorgabeKupfer.consumers[0].path.segments[0].dimension.outer, 20, 1e-9);

    /*
     * Gegenprobe. Ein Dokument ohne Werkstoffangabe am Abschnitt — so sahen
     * alle Netze bis 1.11.0 aus — muss in der Vorgabe Kupfer gerechnet werden,
     * und der Druckverlust muss sich messbar unterscheiden. Täte er das nicht,
     * wäre der Werkstoff wirkungslos und der ganze Durchgriff eine Attrappe.
     */
    const altesDokument = ohneFelder(netz, ['material', 'outerDiameter']);
    const inKupfer = balanceNetwork({
      network: altesDokument, fixtures: doc.fixtures, spread: 10, material: 'kupfer',
    });
    check('Ohne Angabe am Abschnitt greift die Vorgabe',
      inKupfer.consumers[0].path.segments[0].dimension.material, 'kupfer');
    check('Und der Druckverlust ist ein anderer [Pa]',
      Math.abs(mitVorgabeKupfer.consumers[0].ownLoss - inKupfer.consumers[0].ownLoss) > 100, true);
    check('Der Unterschied beträgt über 10 % [-]',
      Math.abs(mitVorgabeKupfer.consumers[0].ownLoss - inKupfer.consumers[0].ownLoss)
        / inKupfer.consumers[0].ownLoss > 0.1, true);

    /*
     * BEFUND. Die Nachdimensionierung (`BalanceReport.segments`) geht denselben
     * Weg nicht mit: sie ermittelt die Ist-Dimension weiterhin allein aus
     * Nennweite und Vorgabewerkstoff. Im selben Bericht steht damit für
     * dieselbe Teilstrecke einmal Verbund 20 × 2 (Druckverlust) und einmal
     * Kupfer 18 × 1 (Urteil „zu klein/passt/unnötig groß") — zwei verschiedene
     * Rohre, ein Abschnitt. Erwartet wird derselbe Werkstoff wie in der
     * Druckverlustrechnung.
     */
    check('BEFUND: Auch die Nachdimensionierung rechnet im Werkstoff des Modells',
      mitVorgabeKupfer.segments.every((s) => s.drawn.dimension.material === 'verbund'), true);
  }

  // =========================================================================
  // 6 · Formstücke aus dem Modell — und die Rückwärtskompatibilität
  // =========================================================================
  {
    /*
     * Der pauschale Zuschlag ist ein Bogen 90° je Abschnitt; sein ζ steht in
     * der Formstücktabelle mit 0,5. Trägt der Abschnitt dagegen Angaben, wird
     * gezählt statt pauschaliert:
     *
     *     2 Bögen 90° · 0,5  +  1 Kugelhahn · 0,3  =  1,3
     *
     * (Absperrungen werden als Kugelhahn angesetzt, nicht als Geradsitzventil
     * mit ζ = 4 — so steht es im Modul begründet.)
     *
     * Beide Zahlen sind aus der Tabelle abgeleitet und nicht aus dem Ergebnis:
     * 1,3 > 0,5, also muss der Abschnitt mit Angaben mehr Σζ tragen.
     */
    check('Der pauschale Zuschlag ist ein Bogen 90°', DEFAULT_SEGMENT_ZETA, 0.5, 1e-12);

    const last = { powerByFixture: { hk: 1000 }, spread: 10 };
    const ohne = balanceNetwork({ network: einAbschnitt({}), ...last });
    const mit = balanceNetwork({ network: einAbschnitt({ bends: 2, accessories: ['shutoff'] }), ...last });

    check('Altes Dokument: der pauschale ζ greift weiter',
      ohne.consumers[0].path.segments[0].zetaSum, DEFAULT_SEGMENT_ZETA, 1e-12);
    check('Zwei Bögen und eine Absperrung ergeben Σζ = 1,3',
      mit.consumers[0].path.segments[0].zetaSum, 1.3, 1e-9);
    check('… also mehr als der pauschale Zuschlag',
      mit.consumers[0].path.segments[0].zetaSum > ohne.consumers[0].path.segments[0].zetaSum, true);
    check('… und damit auch ein größerer Einzelwiderstandsverlust [Pa]',
      mit.consumers[0].path.segments[0].fittingLoss > ohne.consumers[0].path.segments[0].fittingLoss, true);
    check('… und ein größerer Strangverlust [Pa]',
      mit.consumers[0].ownLoss > ohne.consumers[0].ownLoss, true);

    // Nur Bögen, keine Armatur: 2 · 0,5 = 1,0.
    const nurBoegen = balanceNetwork({ network: einAbschnitt({ bends: 2 }), ...last });
    check('Zwei Bögen allein ergeben Σζ = 1,0',
      nurBoegen.consumers[0].path.segments[0].zetaSum, 1.0, 1e-9);
    // Nur die Absperrung: 0,3. Sie liegt unter dem pauschalen Bogen — die
    // Angabe ersetzt die Pauschale, sie kommt nicht zu ihr hinzu.
    const nurArmatur = balanceNetwork({ network: einAbschnitt({ accessories: ['shutoff'] }), ...last });
    check('Eine Absperrung allein ergibt Σζ = 0,3',
      nurArmatur.consumers[0].path.segments[0].zetaSum, 0.3, 1e-9);
    check('Die Angabe ersetzt die Pauschale, sie addiert sich nicht',
      nurArmatur.consumers[0].path.segments[0].zetaSum < DEFAULT_SEGMENT_ZETA, true);
    // Und die Rückwärtskompatibilität an einem echten Netz: werden die neuen
    // Felder entfernt, muss jeder Abschnitt wieder den pauschalen ζ tragen.
    const alt = balanceNetwork({
      network: ohneFelder(netz, ['bends', 'accessories']),
      fixtures: doc.fixtures, spread: 10, material: 'verbund',
    });
    check('Altes Netz: jeder Abschnitt trägt den pauschalen ζ',
      alt.consumers.every((c) => c.path.segments.every((s) => Math.abs(s.zetaSum - DEFAULT_SEGMENT_ZETA) < 1e-12)),
      true);

    /*
     * Und derselbe Weg an einem von Hand gezeichneten Netz, bis in den Bericht
     * hinein. Eine Leitung mit drei Stützpunkten (0,60|0,60) → (9,20|0,60) →
     * (9,20|3,40) zerfällt in zwei Abschnitte: der erste beginnt am
     * Leitungsanfang und hat dort keinen Richtungswechsel, der zweite beginnt an
     * einem inneren Stützpunkt und trägt deshalb genau einen Bogen. Auf ihm
     * sitzt eine Absperrung mit ausdrücklicher `runId`.
     *
     *     Abschnitt 2:  1 Bogen 90° · 0,5  +  1 Kugelhahn · 0,3  =  0,8
     */
    const handDoc = baueHaus();
    const handLeitung: PipeRun = {
      id: 'hand-1',
      levelId: 'eg',
      service: 'heating-flow',
      points: [{ x: 0.6, y: 0.6 }, { x: 9.2, y: 0.6 }, { x: 9.2, y: 3.4 }],
      nominalDiameter: 15,
      insulation: 20,
      elevation: 0.04,
      fromFixtureId: 'v-1',
      toFixtureId: 'hk-2',
      material: 'verbund',
      outerDiameter: 20,
    };
    const handArmatur: PipeAccessory = {
      id: 'pa-1',
      kind: 'shutoff',
      runId: 'hand-1',
      levelId: 'eg',
      position: { x: 9.2, y: 2.0 },
      elevation: 0.04,
      label: 'Absperrung',
      reason: 'Prüfung der Zuordnung Armatur → Abschnitt.',
    };
    handDoc.pipes = { 'hand-1': handLeitung };
    handDoc.pipeAccessories = { 'pa-1': handArmatur };

    const handNetz = buildPipeNetwork(handDoc);
    const handWeg = handNetz.paths.find((p) => p.fixtureId === 'hk-2');
    check('Die Polylinie zerfällt in zwei Abschnitte', handWeg?.segments.length ?? 0, 2);
    check('Der erste Abschnitt hat keinen Richtungswechsel', handWeg?.segments[0].bends ?? -1, 0);
    check('Der zweite Abschnitt trägt einen Bogen', handWeg?.segments[1].bends ?? -1, 1);
    check('Die Absperrung landet auf dem zweiten Abschnitt',
      (handWeg?.segments[1].accessories ?? []).join(','), 'shutoff');
    check('… und nicht auf dem ersten', handWeg?.segments[0].accessories === undefined, true);

    const handBericht = buildPipeReport(handDoc);
    const mitFormstueck = handBericht.teilstrecken.find((t) => t.zeta > 0);
    check('Im Bericht steht Σζ = 0,8 auf dieser Teilstrecke', mitFormstueck?.zeta ?? -1, 0.8, 1e-9);
    check('… und ein Einzelwiderstandsverlust größer null [Pa]', (mitFormstueck?.z ?? 0) > 0, true);
    check('Die Formstücke stehen im Klartext dabei',
      (mitFormstueck?.formstuecke ?? '').includes('1× Bogen 90°'), true);
    /*
     * BEFUND. Die Armatur erscheint im Klartext als „1× shutoff" — die
     * Bauartkennung aus dem Modell statt der Bezeichnung des Formstücks. Der
     * Grund ist eine Verwechslung zweier Schlüsselräume: nachgeschlagen wird in
     * der Formstücktabelle, die nach Formstückkennung geordnet ist
     * („kugelhahn"), gesucht wird aber mit der Armaturenbauart („shutoff").
     * Der Fallback gibt dann die rohe Kennung aus. Auf dem Blatt steht damit
     * ein englisches Wort in einer deutschen Tabelle — und Σζ bleibt für den
     * Leser unbelegt, weil er das Bauteil nicht zuordnen kann.
     */
    check('BEFUND: Die Absperrung erscheint mit ihrer Bezeichnung, nicht mit ihrer Kennung',
      (mitFormstueck?.formstuecke ?? '').includes('shutoff'), false);
  }

  // =========================================================================
  // 7 · Ventildruck — 0 heißt „keine Angabe", nicht „null Pascal"
  // =========================================================================
  const abgleich10 = balanceNetwork({
    network: netz, fixtures: doc.fixtures, spread: 10, material: 'verbund', thermostatPressure: 10000,
  });
  {
    const ohneVentil = balanceNetwork({
      network: netz, fixtures: doc.fixtures, spread: 10, material: 'verbund', thermostatPressure: 0,
    });
    check('Ohne Auslegungsdruck bleibt der Ventildruck leer',
      ohneVentil.consumers.every((c) => c.valvePressure === undefined), true);
    check('… und ist insbesondere nicht 0',
      ohneVentil.consumers.some((c) => c.valvePressure === 0), false);
    check('Ohne Auslegungsdruck bleibt die Autorität leer',
      ohneVentil.consumers.every((c) => c.authority === undefined), true);
    check('Ohne Auslegungsdruck bleibt das Autoritätsurteil leer',
      ohneVentil.consumers.every((c) => c.authorityNote === undefined), true);
    check('Ohne Auslegungsdruck gibt es keine Voreinstellstufe',
      ohneVentil.consumers.every((c) => c.presetSelection === undefined), true);
    check('Ohne Auslegungsdruck gibt es keinen Ventil-k_v',
      ohneVentil.consumers.every((c) => c.valveKv === undefined), true);
    // Der Drosselbedarf hängt nicht am Ventildruck: er ist die Differenz zum
    // ungünstigsten Strang und bleibt in beiden Rechnungen derselbe.
    check('Der Drosselbedarf bleibt davon unberührt [Pa]',
      ohneVentil.consumers[0].throttle, abgleich10.consumers[0].throttle, 0.2);

    /*
     * Mit 10 kPa Auslegungsdruck steht am Ventil dessen Auslegungsdruck **plus**
     * dem, was gegenüber dem ungünstigsten Strang zu vernichten ist:
     *
     *     Δp_Ventil = Δp_Auslegung + Δp_Drossel
     *
     * Beim ungünstigsten Strang selbst ist die Drossel definitionsgemäß null —
     * er ist das Maß, nicht das Ziel. Dort gilt also Δp_Ventil = 10000 Pa exakt.
     */
    check('Mit Auslegungsdruck ist der Ventildruck gesetzt',
      abgleich10.consumers.every((c) => c.valvePressure !== undefined), true);
    check('Mit Auslegungsdruck ist die Autorität gesetzt',
      abgleich10.consumers.every((c) => c.authority !== undefined), true);
    check('Mit Auslegungsdruck steht eine Voreinstellstufe fest',
      abgleich10.consumers.every((c) => c.presetSelection !== undefined), true);
    check('Δp_Ventil = 10000 + Drossel, an jedem Strang [Pa]',
      abgleich10.consumers.every((c) => Math.abs((c.valvePressure ?? -1) - (10000 + c.throttle)) <= 0.2), true);

    const schlechtester = abgleich10.consumers.find((c) => c.worst);
    check('Es gibt einen ungünstigsten Strang', schlechtester !== undefined, true);
    check('Am ungünstigsten Strang wird nicht gedrosselt [Pa]', schlechtester?.throttle ?? -1, 0, 1e-9);
    check('… dort stehen genau die 10 kPa an [Pa]', schlechtester?.valvePressure ?? -1, 10000, 1e-9);
    check('An jedem anderen Strang steht mehr an [Pa]',
      abgleich10.consumers.filter((c) => !c.worst).every((c) => (c.valvePressure ?? 0) >= 10000), true);
    // Das Autoritätsurteil muss zu der Zahl passen, die daneben steht.
    check('Das Autoritätsurteil passt zur Autorität',
      abgleich10.consumers.every((c) => c.authorityNote === authorityVerdict(c.authority ?? 0)), true);
    check('Die Voreinstellung wird für den Ventil-k_v gewählt',
      abgleich10.consumers.every((c) => Math.abs((c.presetSelection?.requiredKv ?? -1) - (c.valveKv ?? 0)) < 1e-9),
      true);
    check('Der Bericht setzt den VdZ-Auslegungsdruck von 10 kPa an [Pa]',
      DEFAULT_THERMOSTAT_PRESSURE, 10000);
  }

  // =========================================================================
  // 8 · Der Bericht
  // =========================================================================
  const bericht = buildPipeReport(doc);
  {
    // Die Zahl der Teilstrecken ist keine eigene Größe: sie ist die Summe der
    // Abschnitte über alle Stränge. Beides auseinanderlaufen zu lassen wäre der
    // klassische Fehler beim Umbau einer Tabelle in Seiten.
    const abschnitte = netz.paths.reduce((s, p) => s + p.segments.length, 0);
    check('Teilstrecken = Summe der Abschnitte über alle Wege', bericht.teilstrecken.length, abschnitte);
    check('… und ebenso die Summe über die Stränge',
      bericht.teilstrecken.length, bericht.straenge.reduce((s, x) => s + x.teilstrecken.length, 0));
    check('Es gibt überhaupt Teilstrecken', bericht.teilstrecken.length > 0, true);
    check('Je Verbraucher ein Strang', bericht.straenge.length, netz.paths.length);
    check('Je Verbraucher eine Heizflächenzeile', bericht.heizflaechen.length, netz.paths.length);
    check('Die Teilstrecken sind fortlaufend von 1 an nummeriert',
      bericht.teilstrecken.every((t, i) => t.nr === i + 1), true);
    check('Jede Teilstrecke nennt ihren Strang',
      bericht.teilstrecken.every((t) => bericht.straenge.some((s) => s.id === t.strangId)), true);

    /*
     * Plausibilität je Zeile. Geprüft wird nicht der Zahlenwert — λ kommt aus
     * einer Iteration und lässt sich nicht von Hand nachrechnen —, sondern der
     * Bereich, in dem er physikalisch liegen muss:
     *   Re > 0, sobald etwas fließt.
     *   Bei turbulenter Strömung (Re > 2320) liegt λ zwischen etwa 0,015
     *   (hydraulisch glatt, hohe Reynoldszahl) und 0,08 (rau, kleine
     *   Reynoldszahl). Ein Wert außerhalb bedeutet, dass die Iteration nicht
     *   konvergiert ist oder mit falschen Stoffwerten gerechnet wurde.
     *   Δp = R·l + Z ist die Definition; die Toleranz von 1 Pa ist die
     *   Rundung der drei Spalten auf ganze Pascal.
     */
    const fliessend = bericht.teilstrecken.filter((t) => t.volumenstrom > 0);
    check('Alle Teilstrecken führen einen Volumenstrom', fliessend.length, bericht.teilstrecken.length);
    check('Re ist überall größer als null', fliessend.every((t) => t.reynolds > 0), true);
    check('Die Strömung ist überall turbulent (Re > 2320)',
      fliessend.every((t) => t.reynolds > 2320), true);
    check('λ liegt im turbulenten Bereich zwischen 0,015 und 0,08',
      fliessend.every((t) => t.lambda >= 0.015 && t.lambda <= 0.08), true);
    check('Δp = R·l + Z auf jeder Zeile [Pa]',
      bericht.teilstrecken.every((t) => Math.abs(t.dp - (t.rl + t.z)) <= 1), true);
    check('R·l passt zu R und l [Pa]',
      bericht.teilstrecken.every((t) => Math.abs(t.rl - t.r * t.laenge) <= 1.5), true);
    check('Jede Zeile hat einen Innendurchmesser', bericht.teilstrecken.every((t) => t.innen > 0), true);
    check('Jede Zeile hat eine Länge', bericht.teilstrecken.every((t) => t.laenge > 0), true);
    check('Jede Zeile hat eine Geschwindigkeit', bericht.teilstrecken.every((t) => t.geschwindigkeit > 0), true);
    check('Jede Zeile trägt eine Abmessung', bericht.teilstrecken.every((t) => t.abmessung.length > 0), true);
    // Die abgerechnete Länge ist Vor- und Rücklauf zusammen, also das Doppelte
    // der Trassenlänge. Die Summe über einen Strang muss dessen Länge sein.
    check('Die Stranglänge ist die Summe seiner Teilstrecken [m]',
      bericht.straenge.every((s) => Math.abs(s.laenge - s.teilstrecken.reduce((a, t) => a + t.laenge, 0)) <= 0.05),
      true);
    check('Die abgerechnete Länge ist das Doppelte der Trasse [m]',
      r4(bericht.straenge.reduce((a, s) => a + s.laenge, 0)),
      r4(netz.paths.reduce((a, p) => a + p.segments.reduce((b, s) => b + s.length, 0), 0) * 2), 0.05);

    /*
     * Der Schlechtpunkt ist keine Meinung: es ist der Strang mit dem größten
     * Gesamtdruckverlust. Gerechnet wird das Maximum hier noch einmal aus der
     * Tabelle — nicht aus dem Feld, das geprüft wird.
     */
    const groesster = Math.max(...bericht.straenge.map((s) => s.gesamt));
    check('Es gibt einen Schlechtpunkt', bericht.schlechtpunkt !== undefined, true);
    check('Der Schlechtpunkt trägt den größten Gesamtdruckverlust [Pa]',
      bericht.schlechtpunkt?.gesamt ?? -1, groesster, 1e-9);
    check('… und er ist einer der Stränge',
      bericht.straenge.some((s) => s.id === bericht.schlechtpunkt?.id), true);
    check('Gesamt = Netz + Ventil, auf jedem Strang [Pa]',
      bericht.straenge.every((s) => Math.abs(s.gesamt - (s.netz + s.ventil)) <= 1), true);
    check('Die Stränge stehen absteigend nach Gesamtdruckverlust',
      bericht.straenge.every((s, i) => i === 0 || bericht.straenge[i - 1].gesamt >= s.gesamt), true);

    /*
     * § 60c Abs. 4 GModG nennt sieben Pflichtangaben. Sieben, nicht sechs und
     * nicht acht — und durchnummeriert, weil sie so zitiert werden.
     */
    check('Der Nachweis hat genau sieben Punkte', bericht.nachweis.length, 7);
    check('… mit den Nummern 1 bis 7',
      bericht.nachweis.every((p, i) => p.nr === i + 1), true);
    check('Jeder Punkt nennt seine Forderung',
      bericht.nachweis.every((p) => p.forderung.trim().length > 0), true);
    check('Jeder Punkt gibt eine Antwort',
      bericht.nachweis.every((p) => p.antwort.trim().length > 0), true);
    check('Jeder Punkt nennt seine Herkunft',
      bericht.nachweis.every((p) => p.herkunft.trim().length > 0), true);

    /*
     * Das Urteil ist die Summe der offenen Punkte. Punkt 6 (Einstellung der
     * Regelung) sagt das Programm selbst als nicht erfüllt aus — es stellt keine
     * Heizkurve ein. Ein Bericht, der sich trotzdem für nachweisfähig hielte,
     * verspräche etwas, das er nicht hat.
     */
    const urteil = berichtsUrteil(bericht);
    check('Jede unerfüllte Forderung steht im Urteil',
      bericht.nachweis.filter((p) => !p.erfuellt).every((p) => urteil.offen.includes(p.forderung)), true);
    check('Keine erfüllte Forderung steht im Urteil',
      bericht.nachweis.filter((p) => p.erfuellt).every((p) => !urteil.offen.includes(p.forderung)), true);
    check('Die Regelung bleibt offen', urteil.offen.includes('Einstellung der Regelung'), true);
    check('Damit ist der Bericht nicht nachweisfähig', urteil.nachweisfaehig, false);
    check('Nachweisfähig heißt genau: nichts offen',
      urteil.nachweisfaehig, urteil.offen.length === 0);

    // Kennzahlen und Herkunft
    check('Der vorherrschende Werkstoff ist der gezeichnete',
      bericht.werkstoff, vorherrschenderWerkstoff(runs));
    check('… und das ist Verbund', bericht.werkstoff, 'verbund');
    check('Die Spreizung ist Vorlauf minus Rücklauf [K]',
      bericht.temperaturen.spreizung, bericht.temperaturen.vorlauf - bericht.temperaturen.ruecklauf, 1e-9);
    check('Der Gesamtvolumenstrom ist positiv [m³/h]', bericht.volumenstrom > 0, true);
    check('Die Rohrlänge ist positiv [m]', bericht.rohrlaenge > 0, true);
    check('Der Bericht führt seinen Abgleich mit', bericht.abgleich.consumers.length, netz.paths.length);
    check('Der Bericht nennt Quellen', bericht.quellen.length > 0, true);
    check('Jede Quelle hat einen Titel', bericht.quellen.every((q) => q.titel.length > 0), true);

    // Die Bauteilliste zählt, was im Modell steht — nicht mehr und nicht weniger.
    const liste = armaturenListe(doc);
    check('Die Bauteilliste zählt alle Armaturen des Modells',
      liste.reduce((s, a) => s + a.anzahl, 0), armaturen.length);
    check('Zwei Heizkörper, zwei Thermostatventile',
      liste.find((a) => a.kind === 'thermostatic-valve')?.anzahl ?? 0, 2);

    /*
     * BEFUND. Im ausgelegten Netz steht in der Spalte Z auf **jeder** Zeile
     * null. Ursache ist die Kombination zweier Umstände: der Rohrausleger legt
     * je Trassenabschnitt eine eigene Leitung mit genau zwei Stützpunkten an,
     * und `buildPipeNetwork` vergibt den Bogen nur an innere Stützpunkte — also
     * an keinen. Da `bends: 0` aber gesetzt *ist*, gilt der Abschnitt als „mit
     * Angaben" und der pauschale ζ greift nicht mehr. Der Bericht rechnet damit
     * ein Rohrnetz ohne einen einzigen Einzelwiderstand, obwohl die Trasse
     * zehnmal die Richtung wechselt — und liegt dadurch unter dem Ergebnis von
     * 1.11.0. Erwartet wird: irgendeine Teilstrecke trägt einen Widerstand.
     */
    check('BEFUND: Im ausgelegten Netz trägt mindestens eine Teilstrecke Einzelwiderstände',
      bericht.teilstrecken.some((t) => t.z > 0), true);

    /*
     * BEFUND. Dieselbe Stelle von der anderen Seite: der Rohrausleger setzt
     * sieben Armaturen, schreibt ihnen aber keine `runId`. `buildPipeNetwork`
     * überspringt jede Armatur ohne `runId` — die Zuordnung Armatur → Abschnitt
     * kommt für automatisch ausgelegte Netze nie zustande. Erwartet wird, dass
     * jede erzeugte Armatur die Leitung nennt, an der sie sitzt.
     */
    check('BEFUND: Jede erzeugte Armatur nennt ihre Leitung',
      armaturen.every((a) => (a.runId ?? '').length > 0), true);
  }

  // =========================================================================
  // 8b · Das leere Dokument — kein Absturz, aber auch keine Beschönigung
  // =========================================================================
  {
    const leer = buildPipeReport(baueHaus());
    check('Leeres Netz: keine Teilstrecken', leer.teilstrecken.length, 0);
    check('Leeres Netz: keine Stränge', leer.straenge.length, 0);
    check('Leeres Netz: keine Heizflächen', leer.heizflaechen.length, 0);
    check('Leeres Netz: kein Schlechtpunkt', leer.schlechtpunkt === undefined, true);
    check('Leeres Netz: der Nachweis steht trotzdem', leer.nachweis.length, 7);
    check('Leeres Netz: eine Fehlermeldung im Hinweisfeld',
      leer.hinweise.some((h) => h.severity === 'error' && h.text.includes('kein Rohrnetz gezeichnet')), true);
    check('… und der Weg hinaus steht dabei',
      leer.hinweise.some((h) => h.text.includes('Rohrnetz auslegen')), true);
    check('Leeres Netz: die Einstellwerte gelten als nicht erbracht',
      leer.nachweis[0].erfuellt, false);
    check('Leeres Netz: nicht nachweisfähig', berichtsUrteil(leer).nachweisfaehig, false);
    check('Leeres Netz: der Gesamtvolumenstrom ist null [m³/h]', leer.volumenstrom, 0, 1e-9);
  }

  // =========================================================================
  // 9 · Die Blätter
  // =========================================================================
  {
    const druck = buildPipeReportSheets(doc, bericht);
    check('Es entstehen Blätter', druck.sheets.length > 0, true);
    check('Jedes Blatt beginnt mit <svg', druck.sheets.every((s) => s.startsWith('<svg')), true);
    check('Jedes Blatt endet mit </svg>', druck.sheets.every((s) => s.endsWith('</svg>')), true);
    check('Jedes Blatt hat genauso viele Text-Anfänge wie Text-Enden',
      druck.sheets.every((s) => zaehle(s, '<text') === zaehle(s, '</text>')), true);
    check('Kein Blatt ist leer', druck.sheets.every((s) => textinhalte(s).length > 0), true);

    /*
     * XML-Sicherheit. Der Projektname enthält „&" und „<1>". Beide müssen auf
     * jedem Blatt maskiert ankommen: ein rohes „&" bricht den Parser, ein rohes
     * „<" öffnet ein Element, das nie geschlossen wird. Geprüft werden die
     * Inhalte der `<text>`-Elemente — das ist der Bereich, den `escapeXml`
     * verantwortet.
     */
    check('Der Titel enthält die gefährlichen Zeichen', bericht.titel.includes('&') && bericht.titel.includes('<'),
      true);
    const alleTexte = druck.sheets.flatMap(textinhalte);
    check('Kein Textinhalt trägt ein rohes &', alleTexte.every((t) => !ROHES_UND.test(t)), true);
    check('Kein Textinhalt trägt ein rohes <', alleTexte.every((t) => !t.includes('<')), true);
    check('Kein Textinhalt trägt ein rohes >', alleTexte.every((t) => !t.includes('>')), true);
    check('Das kaufmännische Und ist als Entität da',
      alleTexte.some((t) => t.includes('&amp;')), true);
    check('Und die spitze Klammer ebenso', alleTexte.some((t) => t.includes('&lt;')), true);

    /*
     * Blattzahl. Die Tabellenblätter liegen auf A4 quer (297 × 210 mm); das
     * Textfeld ist 210 − 14 (oben) − 20 (unten) = 176 mm hoch, davon gehen rund
     * 26 mm für Überschrift und Tabellenkopf ab, und eine Zeile ist 3,9 mm
     * hoch: 150/3,9 = 38 Zeilen je Blatt. 17 Teilstrecken passen damit auf ein
     * Blatt, 85 (fünffach) brauchen ⌈85/38⌉ = 3.
     *
     * Der feste Rest ist: Grundriss, Deckblatt, Strangübersicht, Einstellwerte
     * (2 Heizflächen → 1 Blatt), Quellen = 5 Blätter.
     *   17 Teilstrecken → 5 + 1 = 6 Blätter
     *   85 Teilstrecken → 5 + 3 = 8 Blätter
     */
    check('17 Teilstrecken passen auf ein Tabellenblatt (6 Blätter)', druck.sheets.length, 6);
    const fuenffach = {
      ...bericht,
      teilstrecken: [0, 1, 2, 3, 4].flatMap(() => bericht.teilstrecken),
    };
    const grosserDruck = buildPipeReportSheets(doc, fuenffach);
    check('85 Teilstrecken brauchen drei Tabellenblätter (8 Blätter)', grosserDruck.sheets.length, 8);
    check('Mehr Teilstrecken, mehr Blätter', grosserDruck.sheets.length > druck.sheets.length, true);
    check('Auch die zusätzlichen Blätter sind geschlossenes SVG',
      grosserDruck.sheets.every((s) => s.startsWith('<svg') && s.endsWith('</svg>')), true);

    // Ohne Grundriss entfällt genau ein Blatt — das erste.
    const ohneGrundriss = buildPipeReportSheets(doc, bericht, { grundriss: false });
    check('Ohne Grundriss ein Blatt weniger', ohneGrundriss.sheets.length, druck.sheets.length - 1);
    check('Ohne Grundriss gibt es kein Grundrissmaß', ohneGrundriss.planSheet === undefined, true);
    check('Mit Grundriss gibt es eines', druck.planSheet !== undefined, true);
    check('Die Tabellenblätter liegen quer (297 × 210 mm)',
      `${druck.sheet.w}×${druck.sheet.h}`, '297×210');

    // Und das leere Dokument darf auch beim Setzen nicht durchfallen.
    const leerDoc = baueHaus();
    const leerDruck = buildPipeReportSheets(leerDoc, buildPipeReport(leerDoc));
    check('Leeres Dokument: es entstehen trotzdem Blätter', leerDruck.sheets.length > 0, true);
    check('Leeres Dokument: alle Blätter sind gültiges SVG',
      leerDruck.sheets.every((s) => s.startsWith('<svg') && s.endsWith('</svg>')), true);
    check('Leeres Dokument: das Tabellenblatt sagt, dass nichts gezeichnet ist',
      leerDruck.sheets.some((s) => textinhalte(s).some((t) => t.includes('Keine Teilstrecken'))), true);
  }

  // =========================================================================
  // 10 · Determinismus
  // =========================================================================
  {
    /*
     * Zweimal derselbe Bericht aus demselben Dokument muss dieselben Tabellen
     * liefern. Alles andere hieße, dass irgendwo eine Menge, eine Sortierung
     * oder eine Zeit in die Rechnung eingeht — und ein Nachweis, der sich beim
     * zweiten Ausdruck ändert, ist keiner. Ausgenommen ist allein das
     * Erstellungsdatum, das absichtlich die aktuelle Zeit trägt.
     */
    const eins = buildPipeReport(doc);
    const zwei = buildPipeReport(doc);
    // Verglichen wird die Serialisierung, ausgegeben nur das Urteil — eine
    // vollständige Teilstreckentabelle als Protokollzeile liest niemand.
    const gleich = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
    check('Zweimal dieselbe Teilstreckentabelle', gleich(eins.teilstrecken, zwei.teilstrecken), true);
    check('Zweimal dasselbe Heizflächenblatt', gleich(eins.heizflaechen, zwei.heizflaechen), true);
    check('Zweimal dieselbe Strangübersicht', gleich(eins.straenge, zwei.straenge), true);
    check('Zweimal derselbe Nachweis', gleich(eins.nachweis, zwei.nachweis), true);
    check('Zweimal derselbe Schlechtpunkt', gleich(eins.schlechtpunkt, zwei.schlechtpunkt), true);
    check('Zweimal dieselben Blätter',
      gleich(buildPipeReportSheets(doc, eins).sheets, buildPipeReportSheets(doc, zwei).sheets), true);
    // Und auf einem frisch gebauten, gleichwertigen Dokument ebenso — der
    // Bericht darf nicht an Objektkennungen aus der Laufzeit hängen.
    const zwilling = hausMitNetz().doc;
    check('Ein gleichwertiges Dokument liefert dieselbe Tabelle',
      gleich(buildPipeReport(zwilling).teilstrecken, eins.teilstrecken), true);
    check('… und dasselbe Heizflächenblatt',
      gleich(buildPipeReport(zwilling).heizflaechen, eins.heizflaechen), true);
  }
}
