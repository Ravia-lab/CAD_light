/**
 * Prüfblock „Keller" — Geländeoberkante, erdberührte Flächen, Einbindetiefe.
 *
 * **Warum dieser Block gebraucht wird.** Eine Wand, die teilweise im Erdreich
 * steht, wird im Export in *zwei* Hüllflächen zerlegt. Eine Flächenteilung
 * ist der wahrscheinlichste Ort für einen leisen Fehler: die beiden Teile
 * sehen einzeln plausibel aus, und ob sie zusammen wieder die ganze Wand
 * ergeben, sieht man einer Zahl nicht an. Ein Prozent zu wenig Wandfläche
 * fällt niemandem auf, verschiebt aber jede Heizlast nach unten.
 *
 * Deshalb steht die Additionsprobe hier an erster Stelle und wird für jede
 * Wand einzeln geführt: erdberührter plus freistehender Anteil müssen genau
 * die Fläche ergeben, die dieselbe Wand ohne Geländeoberkante hätte — brutto
 * wie netto. Verglichen wird dabei nicht gegen eine abgeschriebene Zahl,
 * sondern gegen den Export desselben Hauses ohne erfasstes Gelände. Das ist
 * der einzige Sollwert, der nicht mitwandern kann, wenn sich die Geometrie
 * ändert.
 *
 * Die übrigen Prüfungen decken die Fälle ab, in denen die Teilung *nicht*
 * stattfinden darf oder anders ausfällt:
 *  • Geschoss ganz über Gelände — die Gegenprobe für Bestandsprojekte,
 *  • Geschoss ganz im Erdreich — dann gibt es keine zwei Flächen, sondern
 *    eine mit anderer Randbedingung,
 *  • Hanglage — Wände, die unterschiedlich tief einbinden,
 *  • Öffnungen — ein Fenster gehört dem Teil, in dem seine Mitte liegt.
 *
 * Alle Sollwerte sind aus der Geometrie hergeleitet und im Kommentar
 * ausgerechnet; nichts davon stammt aus einem Probelauf. Normwerte kommen
 * keine vor: f_g1, f_g2 und G_w nach DIN EN 12831-1 rechnet dieses Programm
 * nicht, und was es nicht rechnet, kann hier auch nicht geprüft werden.
 * Geprüft wird stattdessen, dass die *Eingangsgrößen* dieser Faktoren
 * vollständig und richtig herauskommen.
 */

import type { CheckFn } from './typ';
import type {
  BimDocument,
  BimNode,
  BoundaryCondition,
  ExportRoom,
  ExportSurface,
  Level,
  Opening,
  Wall,
} from '../../src/types/bim';
import { emptyPlant, emptySite } from '../../src/lib/plantDefaults';
import { detectRooms, gradeSplit } from '../../src/lib/roomDetection';
import { buildRaviaExport } from '../../src/lib/raviaExport';
import { estimateHeatLoad } from '../../src/lib/heatLoadEstimate';
import { validateModel } from '../../src/lib/validation';

// ---------------------------------------------------------------------------
// Das Prüfhaus
// ---------------------------------------------------------------------------

/** Randbedingungen des Prüfhauses — hier einmal, damit jede Herleitung sie zitieren kann. */
const THETA_I = 20; // Solltemperatur [°C]
const THETA_E = -12; // Norm-Außentemperatur [°C]
const THETA_G = 10; // Erdreichtemperatur [°C]

/** Achsmaße des Grundrisses [m]: Rechteck 6 × 5, Wandstärke 0,30. */
const BREITE = 6;
const TIEFE = 5;
const DICKE = 0.3;
/** Umfang über die Wandachsen [m] — Bezugslänge jeder Flächenherleitung. */
const UMFANG = 2 * (BREITE + TIEFE);
/** Lichte Grundfläche [m²] = (6 − 0,30) × (5 − 0,30). */
const GRUNDFLAECHE = (BREITE - DICKE) * (TIEFE - DICKE);

interface GeschossVorgabe {
  id: string;
  name: string;
  order: number;
  elevation: number;
  height: number;
  /** Abweichende Höhe einzelner Wände [m] — für die Hanglage. */
  wandHoehen?: Partial<Record<'s' | 'e' | 'n' | 'w', number>>;
  /** Von Hand gesetzte Randbedingung einzelner Wände. */
  wandRandbedingung?: Partial<Record<'s' | 'e' | 'n' | 'w', BoundaryCondition>>;
  /** Fenster in der Südwand: Brüstungshöhe über Rohfußboden [m]. */
  fensterBruestung?: number;
  beheizt?: boolean;
}

/**
 * Baut ein Haus mit beliebig vielen Geschossen über demselben Rechteck.
 *
 * Bewusst ohne TGA, ohne Dach und ohne Innenwand: geprüft wird die
 * Höhenlage, und jedes zusätzliche Bauteil brächte nur Zahlen ins Spiel, die
 * mit der Geländeoberkante nichts zu tun haben.
 */
function baueHaus(terrainElevation: number | undefined, geschosse: GeschossVorgabe[]): BimDocument {
  const nodes: Record<string, BimNode> = {};
  const walls: Record<string, Wall> = {};
  const openings: Record<string, Opening> = {};
  const levels: Record<string, Level> = {};

  for (const g of geschosse) {
    const p = (name: string, x: number, y: number): string => {
      const id = `${g.id}-${name}`;
      nodes[id] = { id, x, y, levelId: g.id };
      return id;
    };
    const sw = p('sw', 0, 0);
    const se = p('se', BREITE, 0);
    const ne = p('ne', BREITE, TIEFE);
    const nw = p('nw', 0, TIEFE);

    const wand = (name: 's' | 'e' | 'n' | 'w', a: string, b: string): void => {
      walls[`${g.id}-w-${name}`] = {
        id: `${g.id}-w-${name}`,
        a,
        b,
        levelId: g.id,
        type: 'exterior',
        thickness: DICKE,
        uValue: 0.3,
        height: g.wandHoehen?.[name] ?? g.height,
        layerId: 'layer-walls',
        ...(g.wandRandbedingung?.[name] ? { boundary: g.wandRandbedingung[name] } : {}),
      };
    };
    wand('s', sw, se);
    wand('e', se, ne);
    wand('n', ne, nw);
    wand('w', nw, sw);

    if (g.fensterBruestung !== undefined) {
      openings[`${g.id}-o`] = {
        id: `${g.id}-o`,
        wallId: `${g.id}-w-s`,
        kind: 'window',
        distance: 3,
        width: 1,
        height: 0.6,
        sillHeight: g.fensterBruestung,
        uValue: 1.1,
      } as Opening;
    }

    levels[g.id] = {
      id: g.id,
      name: g.name,
      order: g.order,
      elevation: g.elevation,
      height: g.height,
      floorUValue: 0.35,
      floorBoundary: 'ground',
      ceilingUValue: 0.2,
      ceilingBoundary: 'unheated',
    };
  }

  // Zwischen zwei Geschossen liegt eine Decke, keine Bodenplatte und kein
  // Dach — sonst prüfte die Bilanz eine Situation, die es im Haus nicht gibt.
  const sortiert = [...geschosse].sort((a, b) => a.order - b.order);
  for (let i = 0; i < sortiert.length; i++) {
    const unten = sortiert[i];
    const oben = sortiert[i + 1];
    if (!oben) continue;
    levels[unten.id] = { ...levels[unten.id], ceilingBoundary: 'adjacent-room', ceilingUValue: 0.9 };
    levels[oben.id] = { ...levels[oben.id], floorBoundary: 'adjacent-room', floorUValue: 0.9 };
  }

  const doc: BimDocument = {
    site: emptySite(),
    plant: emptyPlant(),
    meta: {
      name: 'Prüfhaus Keller',
      createdAt: '2026-01-01T00:00:00.000Z',
      modifiedAt: '2026-01-01T00:00:00.000Z',
      northAngle: 0,
      designOutdoorTemperature: THETA_E,
      designIndoorTemperature: THETA_I,
      n50: 1.5,
      shielding: 'moderate',
      unheatedTemperature: THETA_G,
      groundTemperature: THETA_G,
      ...(terrainElevation === undefined ? {} : { terrainElevation }),
      thermalBridgeSupplement: 0,
      thermalBridgeMethod: 'flat',
      thermalBridgeCategory: 'custom',
      reheatFactor: 0,
    },
    levels,
    layers: {},
    nodes,
    walls,
    openings,
    fixtures: {},
    verticals: {},
    pipes: {},
    annotations: {},
    roofOpenings: {},
    rooms: {},
    constructions: {},
    diagnostics: { openEnds: [] },
    activeLevelId: sortiert[0]?.id ?? '',
  };

  const raeume = Object.values(doc.levels)
    .sort((a, b) => a.order - b.order)
    .flatMap((level) =>
      detectRooms({
        nodes: doc.nodes,
        walls: Object.values(doc.walls).filter((w) => w.levelId === level.id),
        openings: Object.values(doc.openings).filter((o) => doc.walls[o.wallId]?.levelId === level.id),
        levelId: level.id,
        defaultHeight: level.height,
        northAngle: 0,
      }),
    );
  doc.rooms = Object.fromEntries(raeume.map((r) => [r.id, r]));
  for (const raum of Object.values(doc.rooms)) {
    const vorgabe = geschosse.find((g) => g.id === raum.levelId);
    raum.name = `Raum ${raum.levelId.toUpperCase()}`;
    raum.setpointTemperature = THETA_I;
    raum.isHeated = vorgabe?.beheizt ?? true;
  }
  return doc;
}

/** Der Raum eines Geschosses im Export. */
function raumVon(doc: BimDocument, levelName: string): ExportRoom | undefined {
  return buildRaviaExport(doc).rooms.find((r) => r.level === levelName);
}

/** Alle Hüllflächen, die zu einer Wand gehören — die geteilte zählt doppelt. */
function flaechenZurWand(raum: ExportRoom | undefined, wandId: string): ExportSurface[] {
  return (raum?.surfaces ?? []).filter((s) => s.id === wandId || s.id === `${wandId}-ground`);
}

const summe = (flaechen: ExportSurface[], lies: (s: ExportSurface) => number): number =>
  flaechen.reduce((s, f) => s + lies(f), 0);

/**
 * Temperatur-Korrekturfaktor f = (θ_i − θ_Nachbar) / (θ_i − θ_e).
 *
 * Keine Normgröße, sondern die Definition selbst — genau die Rechnung, die
 * eine Gegenstelle aus `neighbourTemperature` anstellt. Die Faktoren f_g1,
 * f_g2 und G_w nach DIN EN 12831-1 kommen hier nicht vor und dürfen es nicht.
 */
const temperaturfaktor = (nachbar: number): number => (THETA_I - nachbar) / (THETA_I - THETA_E);

const r3 = (v: number): number => Math.round(v * 1000) / 1000;

export function pruefeKeller(check: CheckFn): void {
  // === 1 — Halb eingegrabene Wand: die Additionsprobe =======================
  // Keller bei −2,60 m, 2,30 m hoch: seine Wände laufen von −2,60 bis −0,30.
  // Gelände bei −1,45 m → 1,15 m im Erdreich, 1,15 m frei.
  const halbKeller: GeschossVorgabe = { id: 'kg', name: 'KG', order: 0, elevation: -2.6, height: 2.3 };
  const halb = baueHaus(-1.45, [halbKeller]);
  const ohneGelaende = baueHaus(undefined, [halbKeller]);
  const raumHalb = raumVon(halb, 'KG');
  const raumOhne = raumVon(ohneGelaende, 'KG');

  check('Ohne Geländeoberkante bleibt es bei einer Fläche je Wand', flaechenZurWand(raumOhne, 'kg-w-s').length, 1);
  check('Mit halber Einbindung werden daraus zwei', flaechenZurWand(raumHalb, 'kg-w-s').length, 2);

  for (const wandId of ['kg-w-s', 'kg-w-e', 'kg-w-n', 'kg-w-w']) {
    const geteilt = flaechenZurWand(raumHalb, wandId);
    const ganz = flaechenZurWand(raumOhne, wandId);
    check(
      `${wandId}: Bruttoflächen beider Teile ergeben die ganze Wand`,
      r3(summe(geteilt, (s) => s.grossArea)),
      r3(summe(ganz, (s) => s.grossArea)),
      0.001,
    );
    check(
      `${wandId}: Nettoflächen beider Teile ergeben die ganze Wand`,
      r3(summe(geteilt, (s) => s.netArea)),
      r3(summe(ganz, (s) => s.netArea)),
      0.001,
    );
  }

  // Die Gesamtsumme noch einmal gegen die Geometrie statt gegen den anderen
  // Export: Umfang 22 m × 2,30 m Wandhöhe = 50,60 m².
  const alleWandflaechen = (raumHalb?.surfaces ?? []).filter((s) => s.kind === 'wall');
  check('Wandfläche des Kellers insgesamt', r3(summe(alleWandflaechen, (s) => s.grossArea)), UMFANG * 2.3, 0.001);
  check(
    'Davon die Hälfte im Erdreich',
    r3(summe(alleWandflaechen.filter((s) => s.boundary === 'ground'), (s) => s.grossArea)),
    (UMFANG * 2.3) / 2,
    0.001,
  );

  // Der erdberührte Teil trägt die ID der Wand mit Zusatz, der freie die der
  // Wand — sonst ließe sich die Herkunft der Fläche nicht zurückverfolgen.
  const unten = flaechenZurWand(raumHalb, 'kg-w-s').find((s) => s.boundary === 'ground');
  const oben = flaechenZurWand(raumHalb, 'kg-w-s').find((s) => s.boundary === 'exterior');
  check('Die erdberührte Teilfläche heißt nach ihrer Wand', unten?.id ?? 'fehlt', 'kg-w-s-ground');
  check('Die freistehende behält die Wand-ID', oben?.id ?? 'fehlt', 'kg-w-s');
  check('Beide tragen denselben U-Wert', r3(unten?.uValue ?? 0), r3(oben?.uValue ?? 0), 0.001);
  check('Beide sind senkrecht', `${unten?.tilt}/${oben?.tilt}`, '90/90');

  // === 2 — Temperaturfaktor der erdberührten Fläche =========================
  // (20 − 10) / (20 − (−12)) = 10/32 = 0,3125 gegen 1,0 an der freien Wand.
  check('Hinter der erdberührten Fläche steht die Erdreichtemperatur', unten?.neighbourTemperature ?? 0, THETA_G, 0.001);
  check('Hinter der freistehenden die Norm-Außentemperatur', oben?.neighbourTemperature ?? 0, THETA_E, 0.001);
  check('Temperaturfaktor der erdberührten Fläche', r3(temperaturfaktor(unten?.neighbourTemperature ?? 0)), 0.313, 0.001);
  check('Temperaturfaktor der freistehenden Fläche', r3(temperaturfaktor(oben?.neighbourTemperature ?? 0)), 1, 0.001);
  // Der Unterschied ist der eigentliche Grund für die ganze Teilung: ohne sie
  // stünde die untere Hälfte mit dem 3,2-fachen Verlust in der Bilanz.
  check(
    'Die Teilung ändert den Verlust der unteren Hälfte um den Faktor 3,2',
    r3(1 / temperaturfaktor(THETA_G)),
    3.2,
    0.001,
  );

  // === 3 — Einbindetiefe ====================================================
  // Unterkante der Wand bei −2,60 m, Gelände bei −1,45 m → 1,15 m.
  check('Einbindetiefe ist die Tiefe der Wandunterkante unter Gelände', unten?.groundContact?.embedmentDepth ?? 0, 1.15, 0.001);
  check('Eingebundene Höhe des Wandabschnitts', unten?.groundContact?.buriedHeight ?? 0, 1.15, 0.001);
  check(
    'Die Tiefe der Flächenmitte lässt sich daraus bilden',
    r3((unten?.groundContact?.embedmentDepth ?? 0) - (unten?.groundContact?.buriedHeight ?? 0) / 2),
    0.575,
    0.001,
  );
  check('Die freistehende Fläche trägt keine Einbindetiefe', oben?.groundContact === undefined, true);

  // Die Sohle bindet genauso tief ein wie die Wandunterkante, hat aber keine
  // eingebundene Höhe: bei einer waagerechten Fläche fallen Unterkante und
  // Flächenmitte zusammen.
  const sohle = raumHalb?.surfaces.find((s) => s.kind === 'floor');
  check('Die Kellersohle ist erdberührt', sohle?.boundary ?? 'fehlt', 'ground');
  check('… mit derselben Einbindetiefe wie die Wandunterkante', sohle?.groundContact?.embedmentDepth ?? 0, 1.15, 0.001);
  check('… und ohne eingebundene Höhe', sohle?.groundContact?.buriedHeight ?? -1, 0);

  // Zweites Untergeschoss: die Wand beginnt erst tief unter Gelände. Jetzt
  // trennen sich Einbindetiefe und eingebundene Höhe — genau dafür sind es
  // zwei Angaben. Unterkante −5,20 m, Gelände −1,45 m → 3,75 m Einbindetiefe
  // bei 2,30 m eingebundener Höhe.
  const zweiUg = baueHaus(-1.45, [
    { id: 'ug2', name: '2. UG', order: -1, elevation: -5.2, height: 2.3 },
    halbKeller,
  ]);
  const tief = raumVon(zweiUg, '2. UG')?.surfaces.find((s) => s.id === 'ug2-w-s');
  check('Im 2. UG ist die Wand vollständig eingebunden', tief?.groundContact?.buriedHeight ?? 0, 2.3, 0.001);
  check('… ihre Einbindetiefe ist aber größer als ihre Höhe', tief?.groundContact?.embedmentDepth ?? 0, 3.75, 0.001);

  // === 4 — Vollständig eingegrabenes Geschoss ==============================
  // Gelände bei −0,30 m, also genau auf Höhe der Kellerdecke.
  const ganzImErdreich = baueHaus(-0.3, [halbKeller]);
  const raumGanz = raumVon(ganzImErdreich, 'KG');
  const wandGanz = flaechenZurWand(raumGanz, 'kg-w-s');
  check('Eine ganz eingegrabene Wand bleibt eine Fläche', wandGanz.length, 1);
  check('… sie behält die ID der Wand', wandGanz[0]?.id ?? 'fehlt', 'kg-w-s');
  check('… und grenzt an Erdreich', wandGanz[0]?.boundary ?? 'fehlt', 'ground');
  check('… über die volle Wandhöhe', wandGanz[0]?.groundContact?.buriedHeight ?? 0, 2.3, 0.001);
  check('Außenwandfläche gegen Außenluft ist damit null', r3(raumGanz?.exteriorWallArea ?? -1), 0);
  // Erdberührt sind jetzt alle vier Wände plus die Sohle:
  // 22 m × 2,30 m + 26,79 m² = 50,60 + 26,79 = 77,39 m².
  check('Erdberührte Fläche des Geschosses', r3(raumGanz?.groundContactArea ?? 0), r3(UMFANG * 2.3 + GRUNDFLAECHE), 0.01);

  // === 5 — Geschoss ganz über Gelände: die Gegenprobe ======================
  // Erdgeschoss bei ±0,00, Gelände 0,30 m tiefer. Nichts steckt im Erdreich —
  // und dann muss jede Wandfläche Feld für Feld die sein, die ohne erfasste
  // Geländeoberkante herauskäme. Das ist die Zusicherung für Bestandsprojekte.
  const ueberGelaende: GeschossVorgabe = { id: 'eg', name: 'EG', order: 0, elevation: 0, height: 2.75 };
  const mitGelaende = raumVon(baueHaus(-0.3, [ueberGelaende]), 'EG');
  const ohneAngabe = raumVon(baueHaus(undefined, [ueberGelaende]), 'EG');
  const waende = (r: ExportRoom | undefined): string =>
    JSON.stringify((r?.surfaces ?? []).filter((s) => s.kind === 'wall'));
  check('Über Gelände sind die Wandflächen Feld für Feld unverändert', waende(mitGelaende) === waende(ohneAngabe), true);
  check('… keine davon grenzt an Erdreich', (mitGelaende?.surfaces ?? []).some((s) => s.kind === 'wall' && s.boundary === 'ground'), false);
  check('… die Außenwandfläche bleibt gleich', r3(mitGelaende?.exteriorWallArea ?? 0), r3(ohneAngabe?.exteriorWallArea ?? -1), 0.001);
  check('… und die erdberührte Fläche ist die Bodenplatte, nicht mehr', r3(mitGelaende?.groundContactArea ?? 0), r3(GRUNDFLAECHE), 0.01);
  // Der eine erlaubte Unterschied: die Bodenplatte weiß jetzt, dass sie auf
  // Geländehöhe liegt. z = 0 ist eine Angabe, kein fehlender Wert — ohne
  // erfasstes Gelände steht dort gar nichts.
  const platteMit = mitGelaende?.surfaces.find((s) => s.kind === 'floor');
  const platteOhne = ohneAngabe?.surfaces.find((s) => s.kind === 'floor');
  check('Bodenplatte auf Geländehöhe: Einbindetiefe null', platteMit?.groundContact?.embedmentDepth ?? -1, 0);
  check('Ohne erfasstes Gelände bleibt die Tiefe unbekannt', platteOhne?.groundContact === undefined, true);

  // === 6 — Hanglage ========================================================
  // Am Hang steht dasselbe Haus mit dem Keller im Berg und dem Erdgeschoss
  // teilweise dahinter: Gelände bei +0,90 m, Keller von −2,60 bis −0,30 (ganz
  // im Erdreich, Einbindetiefe 3,50 m), Erdgeschoss von 0,00 bis 2,75 mit
  // 0,90 m Einbindung. Dieselbe Geländeoberkante, zwei unterschiedlich tief
  // eingebundene Wände — das kann ein Häkchen „ist Keller" nicht abbilden.
  const hang = baueHaus(0.9, [
    { id: 'kg', name: 'KG', order: -1, elevation: -2.6, height: 2.3 },
    { id: 'eg', name: 'EG', order: 0, elevation: 0, height: 2.75, wandHoehen: { n: 0.8 } },
  ]);
  const hangKg = raumVon(hang, 'KG')?.surfaces.find((s) => s.id === 'kg-w-s');
  const hangEgUnten = raumVon(hang, 'EG')?.surfaces.find((s) => s.id === 'eg-w-s-ground');
  const hangEgOben = raumVon(hang, 'EG')?.surfaces.find((s) => s.id === 'eg-w-s');
  check('Am Hang steckt die Kellerwand ganz im Erdreich', hangKg?.boundary ?? 'fehlt', 'ground');
  check('… mit 3,50 m Einbindetiefe', hangKg?.groundContact?.embedmentDepth ?? 0, 3.5, 0.001);
  check('Die Erdgeschosswand darüber bindet nur 0,90 m ein', hangEgUnten?.groundContact?.embedmentDepth ?? 0, 0.9, 0.001);
  check('… und ihr Rest steht frei', hangEgOben?.boundary ?? 'fehlt', 'exterior');
  check('… über 2,75 − 0,90 = 1,85 m Höhe', hangEgOben?.height ?? 0, 1.85, 0.001);
  // Zwei Wände desselben Geschosses, unterschiedlich tief eingebunden: die
  // Nordwand ist mit 0,80 m niedriger als der Geländeversatz über ihrem Fuß
  // (0,90 m) und steckt deshalb ganz im Erdreich, die Südwand nur zum Teil.
  // So sieht am Hang die Wand gegen den Berg aus — sie reicht nicht bis zur
  // Geländeoberkante hinauf. Einbindetiefe und eingebundene Höhe fallen hier
  // auseinander, und das ist der Grund, warum es zwei Angaben sind.
  const hangEgNord = raumVon(hang, 'EG')?.surfaces.filter((s) => s.id === 'eg-w-n' || s.id === 'eg-w-n-ground') ?? [];
  check('Die niedrigere Nordwand desselben Geschosses steckt ganz im Erdreich', hangEgNord.length, 1);
  check('… und grenzt vollständig an Erdreich', hangEgNord[0]?.boundary ?? 'fehlt', 'ground');
  check('… ihre Einbindetiefe ist die des Geschosses', hangEgNord[0]?.groundContact?.embedmentDepth ?? 0, 0.9, 0.001);
  check('… ihre eingebundene Höhe aber nur ihre eigene', hangEgNord[0]?.groundContact?.buriedHeight ?? 0, 0.8, 0.001);

  // === 7 — Öffnungen an der Geländeoberkante ===============================
  // Fenster 1,00 × 0,60 m. Bei 1,40 m Brüstung liegt die Mitte auf 1,70 m und
  // damit über den 1,15 m Einbindung; bei 0,40 m Brüstung auf 0,70 m und damit
  // darunter — dann ist es ein Lichtschacht.
  const ueberGrund = raumVon(baueHaus(-1.45, [{ ...halbKeller, fensterBruestung: 1.4 }]), 'KG');
  const unterGrund = raumVon(baueHaus(-1.45, [{ ...halbKeller, fensterBruestung: 0.4 }]), 'KG');
  const zaehle = (r: ExportRoom | undefined, id: string): number =>
    (r?.surfaces.find((s) => s.id === id)?.openings ?? []).length;
  check('Fenster über Gelände zählt zum freistehenden Teil', zaehle(ueberGrund, 'kg-w-s'), 1);
  check('… und nicht zum erdberührten', zaehle(ueberGrund, 'kg-w-s-ground'), 0);
  check('Lichtschacht-Fenster zählt zum erdberührten Teil', zaehle(unterGrund, 'kg-w-s-ground'), 1);
  check('… und nicht zum freistehenden', zaehle(unterGrund, 'kg-w-s'), 0);
  // In beiden Fällen bleibt die Nettofläche der Wand dieselbe: 6 m × 2,30 m
  // − 0,60 m² = 13,20 m². Nur ihre Verteilung ändert sich.
  for (const [name, raum] of [['über Gelände', ueberGrund], ['als Lichtschacht', unterGrund]] as [string, ExportRoom | undefined][]) {
    check(
      `Nettofläche der Südwand bleibt gleich, Fenster ${name}`,
      r3(summe(flaechenZurWand(raum, 'kg-w-s'), (s) => s.netArea)),
      r3(BREITE * 2.3 - 0.6),
      0.001,
    );
  }

  // === 8 — Überschlägige Heizlast zieht mit ================================
  // Ein Geschoss, vier Wände, keine Öffnung. Transmission über die Wände:
  //   ganz frei:      50,60 m² × 0,30 × (20 + 12)              = 485,8 W
  //   halb im Boden:  25,30 × 0,30 × 32 + 25,30 × 0,30 × 10    = 318,8 W
  // Der Boden liegt in beiden Fällen auf Erdreich und ändert sich nicht;
  // verglichen wird deshalb die Differenz, nicht der Absolutwert.
  const frei = estimateHeatLoad(baueHaus(undefined, [halbKeller])).rooms[0];
  const eingegraben = estimateHeatLoad(halb).rooms[0];
  const wandFrei = UMFANG * 2.3 * 0.3 * (THETA_I - THETA_E);
  const wandHalb = ((UMFANG * 2.3) / 2) * 0.3 * (THETA_I - THETA_E) + ((UMFANG * 2.3) / 2) * 0.3 * (THETA_I - THETA_G);
  check(
    'Der Überschlag rechnet den erdberührten Teil mit der Erdreichtemperatur',
    frei.transmission - eingegraben.transmission,
    Math.round(wandFrei) - Math.round(wandHalb),
    1.5,
  );
  check('… und wird dadurch kleiner, nicht größer', eingegraben.transmission < frei.transmission, true);
  check('Der Lüftungsanteil bleibt unberührt', eingegraben.ventilation, frei.ventilation, 0.001);

  // === 9 — Modellprüfung ===================================================
  // Ohne Geländeoberkante meldet ein Geschoss unter dem Bezugsniveau, dass
  // die entscheidende Angabe fehlt.
  const codes = (doc: BimDocument): string[] => validateModel(doc).issues.map((i) => i.code);
  check('Keller ohne Geländeoberkante wird gemeldet', codes(ohneGelaende).includes('level.below-grade-no-ground'), true);
  check('Mit Geländeoberkante nicht mehr', codes(halb).includes('level.below-grade-no-ground'), false);
  check(
    'Und die Meldung sagt, was zu tun ist',
    (validateModel(ohneGelaende).issues.find((i) => i.code === 'level.below-grade-no-ground')?.remedy ?? '').includes(
      'Geländeoberkante',
    ),
    true,
  );

  // Fenster unter Gelände: Hinweis, kein Fehler — Lichtschächte gibt es.
  const lichtschacht = baueHaus(-1.45, [{ ...halbKeller, fensterBruestung: 0.4 }]);
  const lichtschachtBefund = validateModel(lichtschacht).issues.find((i) => i.code === 'opening.below-grade');
  check('Fenster unter Gelände wird gemeldet', lichtschachtBefund !== undefined, true);
  check('… als Hinweis, nicht als Fehler', lichtschachtBefund?.severity ?? 'fehlt', 'info');
  check(
    'Fenster über Gelände wird nicht gemeldet',
    codes(baueHaus(-1.45, [{ ...halbKeller, fensterBruestung: 1.4 }])).includes('opening.below-grade'),
    false,
  );

  // Einbindetiefe größer als die Geschosshöhe: Gelände über der Decke.
  // Keller von −2,60 bis −0,30, Gelände bei 0,00 → 2,60 m Einbindung bei
  // 2,30 m Geschosshöhe.
  check(
    'Gelände über der Kellerdecke wird gemeldet',
    codes(baueHaus(0, [halbKeller])).includes('level.embedment-exceeds-height'),
    true,
  );
  check(
    'Gelände genau auf Höhe der Kellerdecke nicht',
    codes(baueHaus(-0.3, [halbKeller])).includes('level.embedment-exceeds-height'),
    false,
  );

  // Unbeheizter Keller unter beheiztem Erdgeschoss. Die Vorbelegung des
  // Prüfhauses setzt die Kellerdecke bereits richtig; erst wenn der Boden des
  // Erdgeschosses weiterhin an Erdreich grenzt, wird es gemeldet.
  const kellerUnbeheizt = (): BimDocument =>
    baueHaus(-0.3, [
      { id: 'kg', name: 'KG', order: -1, elevation: -2.6, height: 2.3, beheizt: false },
      { id: 'eg', name: 'EG', order: 0, elevation: 0, height: 2.75 },
    ]);
  check(
    'Richtig geführte Kellerdecke wird nicht gemeldet',
    codes(kellerUnbeheizt()).includes('level.unheated-basement-ceiling'),
    false,
  );
  const falscheDecke = kellerUnbeheizt();
  falscheDecke.levels['eg'] = { ...falscheDecke.levels['eg'], floorBoundary: 'ground' };
  check(
    'Bodenplatte über dem Keller wird gemeldet',
    codes(falscheDecke).includes('level.unheated-basement-ceiling'),
    true,
  );
  const keineDecke = kellerUnbeheizt();
  keineDecke.levels['kg'] = { ...keineDecke.levels['kg'], ceilingBoundary: 'unheated' };
  check(
    'Kellerdecke ohne Anschluss an den beheizten Raum wird gemeldet',
    codes(keineDecke).includes('level.unheated-basement-ceiling'),
    true,
  );

  // Von Hand auf „Erdreich" gestellte Wand: sie wird nicht geteilt — die
  // Angabe des Anwenders gilt für die ganze Wand —, bekommt ihre Tiefe aber
  // trotzdem aus der Höhenlage. Ohne erfasstes Gelände bleibt sie unbekannt,
  // statt geraten zu werden.
  const erdwand: GeschossVorgabe = { ...halbKeller, wandRandbedingung: { s: 'ground' } };
  const vonHand = baueHaus(-1.45, [erdwand]);
  const vonHandOhne = baueHaus(undefined, [erdwand]);
  const erklaert = flaechenZurWand(raumVon(vonHand, 'KG'), 'kg-w-s');
  check('Eine von Hand erdberührte Wand bleibt ungeteilt', erklaert.length, 1);
  check('… über ihre volle Fläche', r3(erklaert[0]?.grossArea ?? 0), r3(BREITE * 2.3), 0.001);
  check('… und trägt die Tiefe aus der Höhenlage', erklaert[0]?.groundContact?.embedmentDepth ?? 0, 1.15, 0.001);
  check(
    'Ohne Geländeoberkante bleibt ihre Tiefe unbekannt',
    flaechenZurWand(raumVon(vonHandOhne, 'KG'), 'kg-w-s')[0]?.groundContact === undefined,
    true,
  );

  // === 10 — Die Aufteilungsfunktion selbst =================================
  // Sie ist die einzige Stelle, an der über „im Erdreich oder nicht"
  // entschieden wird; Export, Überschlag und Modellprüfung greifen alle
  // darauf zu. Deshalb wird sie noch einmal an ihren Rändern geprüft.
  check('Ohne Geländeoberkante steckt nichts im Erdreich', gradeSplit(-2.6, 2.3, undefined).buriedHeight, 0);
  check('… und die ganze Wand steht frei', gradeSplit(-2.6, 2.3, undefined).exposedHeight, 2.3, 0.001);
  check('Gelände unter der Wandunterkante bindet nichts ein', gradeSplit(0, 2.75, -0.3).buriedHeight, 0);
  check('… und liefert keine Einbindetiefe', gradeSplit(0, 2.75, -0.3).embedmentDepth, 0);
  check('Gelände über der Wandoberkante bindet die ganze Wand ein', gradeSplit(-2.6, 2.3, 5).buriedHeight, 2.3, 0.001);
  check('… die Einbindetiefe wächst darüber hinaus weiter', gradeSplit(-2.6, 2.3, 5).embedmentDepth, 7.6, 0.001);
  check('Beide Teile ergeben immer die Wandhöhe', gradeSplit(-2.6, 2.3, -1.45).buriedHeight + gradeSplit(-2.6, 2.3, -1.45).exposedHeight, 2.3, 0.001);
}
