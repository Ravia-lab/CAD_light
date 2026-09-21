/**
 * Prüfblock „Ringleitung, Wärmepumpe als Erzeuger, Badheizkörper, Raumnamen".
 * ---------------------------------------------------------------------------
 * **Die Meldungen dahinter**, alle aus einem echten Sanierungsaufmaß:
 *
 *  - „die autorohrverlegung war wieder komplett konfus, es fehlt mir die
 *    auslegung für ringverlegung" — und dazu, wie sie aussehen soll: „zum
 *    Verteiler hin (oder Speicher, Puffer) 1", dann 22er oder 18er Rohr
 *    Kreisleitung, für Heizkörper mit 15".
 *  - „wärmepumpe ist wärmeerzeuger für die automatische rohrverlegung".
 *  - „es fehlen badheizkörper".
 *  - „bei raumbenennung dropdown … für standardbezeichnungen".
 *
 * **Das Prüfhaus** — 12 × 8 m auf den Achsen, 36-cm-Außenwände, zwei 11,5er
 * Trennwände über Kreuz, also vier Zimmer:
 *
 *        (0,8) ────────────── (6,8) ─────────── (12,8)
 *          │   NW   Fenster x=3 │  NE  Fenster x=9 │
 *          │                    │                  │ Tür y=6
 *        (0,4) ────────────── (6,4) ─────────── (12,4)
 *          │   SW   Fenster x=3 │  SE  Fenster x=9 │
 *   WP ●   │                    │ HK an Trennwand  │
 *  (−3,2)  (0,0) ────────────── (6,0) ─────────── (12,0)
 *
 * Unter jedem Fenster ein Heizkörper an der Wandfläche (Achse ± 0,23 m), im
 * NW ein Badheizkörper, dazu im SE ein fünfter Heizkörper an der Trennwand —
 * der einzige, der nicht an einer Außenwand hängt.
 *
 * **Die Handrechnung der Ringgeometrie.** Die Ringlinie liegt 0,18 m (halbe
 * Außenwand) + 0,05 m (Wandabstand) = 0,23 m innen vor jeder Achse: ein
 * Rechteck von (0,23 | 0,23) bis (11,77 | 7,77), Umfang
 * 2 · (11,54 + 7,54) = 38,16 m.
 *
 * Die Hauseinführung liegt auf der westlichen Außenwand bei y = 2 (Lot von der
 * Wärmepumpe), innen 0,18 + 0,15 = 0,33 m hinter der Achse → (0,33 | 2).
 * Außenleitung bis zur Außenfläche: 3 − 0,18 = 2,82 m. Ringanfang: (0,23 | 2).
 *
 * Wege gegen den Uhrzeigersinn ab dem Anfang (erst 1,77 m nach Süden bis zur
 * Ecke, dann nach Osten, Norden, Westen):
 *   SW  1,77 + 2,77          =  4,54
 *   SE-Trennwand (Anschluss bei x = 6,12)  1,77 + 5,89 = 7,66
 *   SE  1,77 + 8,77          = 10,54
 *   NE  1,77 + 11,54 + 7,54 + 2,77 = 23,62
 *   NW  1,77 + 11,54 + 7,54 + 8,77 = 29,62
 * Lücke hinter dem letzten: 38,16 − 29,62 = 8,54 m; Lücke vor dem ersten
 * (im Uhrzeigersinn): 4,54 m. Die größere bleibt frei → Lauf gegen den
 * Uhrzeigersinn, verlegte Ringlänge 29,62 m.
 *
 * Tür in der Ostwand bei y = 6: Ringpunkt (11,77 | 6), Weg 1,77 + 11,54 + 5,77
 * = 19,08 m < 29,62 → eine Tür auf der Strecke.
 * Kernbohrungen: Der Ring kreuzt die untere Hälfte der senkrechten Trennwand
 * (bei 6 | 0,23), die östliche Hälfte der waagerechten (bei 11,77 | 4) und die
 * obere Hälfte der senkrechten (bei 6 | 7,77). Die westliche Hälfte der
 * waagerechten erreicht er nicht — er endet vorher bei x = 3. Also 3.
 */

import type { BimDocument, BimNode, Fixture, HeatPump, Level, Opening, Wall } from '../../src/types/bim';
import { detectRooms } from '../../src/lib/roomDetection';
import { emptyPlant, emptySite } from '../../src/lib/plantDefaults';
import { pointInPolygon } from '../../src/lib/geometry';
import { hauseinfuehrung } from '../../src/lib/hauseinfuehrung';
import { planeRing } from '../../src/lib/ringleitung';
import { planPipeNetwork, RING_HOECHST_DN, RING_MINDEST_DN } from '../../src/lib/pipeLayout';
import { fluidProperties, sizePipe } from '../../src/lib/hydraulics';
import { STANDARD_RAUMNAMEN, istStandardraumname, nutzungAusName } from '../../src/lib/raumnutzung';
import { FIXTURE_BY_TYPE } from '../../src/types/bim';
import type { CheckFn } from './typ';

const HOEHE = 2.5;

function pumpe(form: HeatPump['form']): HeatPump {
  return {
    id: 'wp', label: 'Wärmepumpe', source: 'air', form, position: { x: -3, y: 2 }, azimuth: 270,
    width: 1.1, depth: 0.5, height: 1.05, standHeight: 0.3, mounting: 'free', soundPower: 54,
    nightModeGuaranteed: false, toneSurcharge: 0, refrigerant: 'R290', refrigerantMass: 1.4,
    protectionRadius: 1, heatingCapacity: 8, ratingPoint: 'A-7/W35', cop: 3.2,
    operation: 'mono-energetic', bivalencePoint: -7, backupCapacity: 6, flowTemperature: 55,
    gridRegime: 'none', blockedHours: 0, domesticHotWater: false, occupants: 4, levelId: 'eg',
  } as HeatPump;
}

function baueHaus(optionen: { pumpe?: HeatPump['form']; speicher?: boolean } = {}): BimDocument {
  const n = (id: string, x: number, y: number): BimNode => ({ id, x, y, levelId: 'eg' });
  const nodes: Record<string, BimNode> = Object.fromEntries(
    [
      n('a', 0, 0), n('b', 6, 0), n('c', 12, 0), n('d', 12, 4), n('e', 12, 8),
      n('f', 6, 8), n('g', 0, 8), n('h', 0, 4), n('m', 6, 4),
    ].map((k) => [k.id, k]),
  );
  const wand = (id: string, a: string, b: string, aussen: boolean): Wall => ({
    id, a, b, levelId: 'eg', type: aussen ? 'exterior' : 'interior',
    thickness: aussen ? 0.36 : 0.115, uValue: aussen ? 0.28 : 1.3, height: HOEHE, layerId: 'layer-walls',
  } as Wall);
  const walls: Record<string, Wall> = Object.fromEntries(
    [
      wand('ss', 'a', 'b', true), wand('so', 'b', 'c', true), wand('os', 'c', 'd', true), wand('on', 'd', 'e', true),
      wand('no', 'e', 'f', true), wand('nw', 'f', 'g', true), wand('wn', 'g', 'h', true), wand('ws', 'h', 'a', true),
      wand('iu', 'b', 'm', false), wand('io', 'm', 'f', false), wand('iw', 'h', 'm', false), wand('ie', 'm', 'd', false),
    ].map((w) => [w.id, w]),
  );
  const oeffnung = (id: string, wallId: string, distance: number, kind: Opening['kind'], width: number, sill: number): Opening =>
    ({ id, wallId, kind, distance, width, height: kind === 'door' ? 2.01 : 1.26, sillHeight: sill } as Opening);
  const openings: Record<string, Opening> = Object.fromEntries(
    [
      oeffnung('f1', 'ss', 3, 'window', 1.2, 0.9),
      oeffnung('f2', 'so', 3, 'window', 1.2, 0.9),
      oeffnung('f3', 'no', 3, 'window', 1.2, 0.9),
      oeffnung('f4', 'nw', 3, 'window', 1.2, 0.9),
      oeffnung('t1', 'on', 2, 'door', 1.0, 0),
    ].map((o) => [o.id, o]),
  );

  const hk = (id: string, type: Fixture['type'], x: number, y: number, powerW: number): Fixture =>
    ({
      id, type, category: 'heating', label: id, levelId: 'eg', position: { x, y }, rotation: 0,
      length: 1, depth: 0.1, elevation: 0.15, params: { powerW, flowTemperature: 55, returnTemperature: 45 },
    } as Fixture);
  const fixtures: Record<string, Fixture> = Object.fromEntries(
    [
      hk('hkSW', 'radiator', 3, 0.23, 1000),
      hk('hkSE', 'radiator', 9, 0.23, 900),
      hk('hkNE', 'radiator', 9, 7.77, 1100),
      hk('bhkNW', 'towel-radiator', 3, 7.77, 800),
      hk('hkTrenn', 'radiator', 6.12, 2, 500),
    ].map((f) => [f.id, f]),
  );
  if (optionen.speicher) {
    fixtures.puffer = { ...fixtures.hkSW, id: 'puffer', type: 'storage', label: 'Puffer', position: { x: 1, y: 1 }, params: { volumeL: 100 } } as Fixture;
  }

  const eg: Level = {
    id: 'eg', name: 'EG', order: 0, elevation: 0, height: HOEHE,
    floorUValue: 0.35, floorBoundary: 'ground', ceilingUValue: 0.2, ceilingBoundary: 'unheated',
  } as Level;
  const site = emptySite();
  if (optionen.pumpe) site.pumps.wp = pumpe(optionen.pumpe);

  const doc = {
    site, plant: emptyPlant(),
    meta: {
      name: 'Prüfhaus Ringleitung', createdAt: '2026-01-01T00:00:00.000Z', modifiedAt: '2026-01-01T00:00:00.000Z',
      northAngle: 0, designOutdoorTemperature: -12, designIndoorTemperature: 20, n50: 1.5, shielding: 'moderate',
      unheatedTemperature: 10, groundTemperature: 10, thermalBridgeSupplement: 0, thermalBridgeMethod: 'flat',
      thermalBridgeCategory: 'custom', reheatFactor: 0,
    },
    levels: { eg }, layers: {}, nodes, walls, openings, fixtures, verticals: {}, solids: {}, durchbrueche: {},
    pipes: {}, annotations: {}, roofOpenings: {}, rooms: {}, constructions: {}, diagnostics: { openEnds: [] },
    activeLevelId: 'eg',
  } as unknown as BimDocument;

  const raeume = detectRooms({
    nodes, walls: Object.values(walls), openings: Object.values(openings), levelId: 'eg', defaultHeight: HOEHE, northAngle: 0,
  });
  doc.rooms = Object.fromEntries(raeume.map((r) => [r.id, { ...r, isHeated: true, setpointTemperature: 20 }]));
  for (const f of Object.values(doc.fixtures)) {
    const raum = Object.values(doc.rooms).find((r) => pointInPolygon(f.position, r.innerPolygon));
    if (raum) f.roomId = raum.id;
  }
  return doc;
}

export function pruefeRingleitung(check: CheckFn): void {
  // =========================================================================
  // 1 · Die Hauseinführung
  // =========================================================================
  {
    const doc = baueHaus();
    const e = hauseinfuehrung({ x: -3, y: 2 }, Object.values(doc.walls), doc.nodes, Object.values(doc.openings), Object.values(doc.rooms));
    check('Es gibt eine Hauseinführung', e !== undefined, true);
    check('Auf der westlichen Außenwand', e?.wallId ?? 'keine', 'ws');
    check('Innen bei x = 0,33', e?.innen.x ?? NaN, 0.33, 1e-6);
    check('… und y = 2 (Lot von der Wärmepumpe)', e?.innen.y ?? NaN, 2, 1e-6);
    check('Außenleitung bis zur Außenfläche [m]', e?.aussenLaenge ?? NaN, 2.82, 1e-6);

    // Steht die Wärmepumpe vor einem Fenster, rückt die Bohrung aus der
    // Öffnung: Fenster f1 in der Südwand bei x = 3, 1,20 m breit → gesperrt
    // 2,40 − 0,20 … 3,60 + 0,20 = 2,20 … 3,80. Lot bei x = 3 → nächster
    // freier Rand 2,20 (0,80 entfernt) statt 3,80 (ebenfalls 0,80) — bei
    // Gleichstand der zuerst gefundene, also der untere Rand.
    const vorFenster = hauseinfuehrung({ x: 3, y: -3 }, Object.values(doc.walls), doc.nodes, Object.values(doc.openings), Object.values(doc.rooms));
    check('Vor einem Fenster: nicht durch das Fenster', Math.abs((vorFenster?.achse.x ?? 3) - 3) >= 0.8 - 1e-6, true);
    check('… sondern daneben, auf der Südwand', vorFenster?.wallId ?? 'keine', 'ss');
  }

  // =========================================================================
  // 2 · Die Ringgeometrie
  // =========================================================================
  {
    const doc = baueHaus();
    const hkListe = Object.values(doc.fixtures);
    const erg = planeRing({
      walls: Object.values(doc.walls), nodes: doc.nodes, openings: Object.values(doc.openings), rooms: Object.values(doc.rooms),
      quelle: { x: 0.33, y: 2 }, verbraucher: hkListe.map((f) => ({ id: f.id, position: f.position, roomId: f.roomId })),
    });
    check('Der Ring lässt sich planen', erg.ok, true);
    if (!erg.ok) return;
    const r = erg.plan;
    check('Ringanfang x', r.anfang.x, 0.23, 1e-6);
    check('Ringanfang y', r.anfang.y, 2, 1e-6);
    check('Lauf gegen den Uhrzeigersinn', r.richtung, 1);
    check('Verlegte Ringlänge [m]', r.laenge, 29.62, 1e-6);
    const weg = (id: string) => r.anschluesse.find((a) => a.id === id)?.weg ?? NaN;
    check('Weg bis SW [m]', weg('hkSW'), 4.54, 1e-6);
    check('Weg bis zum Heizkörper an der Trennwand [m]', weg('hkTrenn'), 7.66, 1e-6);
    check('Weg bis SE [m]', weg('hkSE'), 10.54, 1e-6);
    check('Weg bis NE [m]', weg('hkNE'), 23.62, 1e-6);
    check('Weg bis zum Badheizkörper NW [m]', weg('bhkNW'), 29.62, 1e-6);
    check('Die vier Heizkörper unter Fenstern hängen gerade am Ring',
      r.anschluesse.filter((a) => a.gerade).map((a) => a.id).sort().join(','), 'bhkNW,hkNE,hkSE,hkSW');
    check('Der an der Trennwand nicht — seine Anbindung wird trassiert',
      r.anschluesse.find((a) => a.id === 'hkTrenn')?.gerade ?? true, false);
    check('… und er hängt am Ring in seinem eigenen Raum (x > 6)',
      (r.anschluesse.find((a) => a.id === 'hkTrenn')?.punkt.x ?? 0) > 6.0575, true);

    // Jeder Ringabschnitt liegt 0,23 m vor einer Achse.
    const aufLinie = r.abschnitte.every((a) =>
      [a.from, a.to].every((p) =>
        Math.abs(p.x - 0.23) < 1e-6 || Math.abs(p.x - 11.77) < 1e-6 || Math.abs(p.y - 0.23) < 1e-6 || Math.abs(p.y - 7.77) < 1e-6));
    check('Der Ring liegt überall 0,23 m vor der Außenwandachse', aufLinie, true);

    // Was an einem Abschnitt hängt, wird nach hinten weniger — nie mehr.
    const zahlen = r.abschnitte.map((a) => a.targets.length);
    check('Der erste Abschnitt trägt alle fünf', zahlen[0], 5);
    check('Der letzte trägt nur noch den letzten', zahlen[zahlen.length - 1], 1);
    check('Nach hinten nie mehr als davor', zahlen.every((z, i) => i === 0 || z <= zahlen[i - 1]), true);

    check('Eine Tür in der Außenwand auf der Strecke', r.tueren.length, 1);
    check('… die Tür t1', r.tueren[0]?.openingId ?? 'keine', 't1');
    check('Drei Kernbohrungen durch Trennwände', r.kernbohrungen, 3);
  }

  // =========================================================================
  // 3 · Ringverlegung im Rohrausleger — mit Wärmepumpe als Erzeuger
  // =========================================================================
  {
    const doc = baueHaus({ pumpe: 'monoblock-outdoor' });
    const erg = planPipeNetwork(doc, { mode: 'sanierung', levelId: 'eg', anordnung: 'ring', flowTemperature: 55, returnTemperature: 45 });
    const vl = erg.runs.filter((r) => r.service === 'heating-flow');
    const art = (praefix: string) => vl.filter((r) => (r.label ?? '').startsWith(praefix));
    check('Alle fünf Heizflächen versorgt — auch der Badheizkörper', erg.served, 5);
    check('Es gibt eine Außenleitung zur Wärmepumpe', art('Außenleitung').length, 1);
    check('… sie liegt an Außenluft (doppelte Dämmung)', art('Außenleitung')[0]?.surrounding ?? 'keine', 'aussenluft');
    check('Es gibt eine Zuleitung zum Ring', art('Zuleitung').length >= 1, true);
    check('Es gibt Ringabschnitte', art('Ringleitung').length > 0, true);
    check('Es gibt fünf Anbindungen oder mehr (die trassierte hat Knicke)', art('Anbindung').length >= 5, true);
    // Die vier Heizkörper unter den Fenstern sitzen im Grundriss genau über
    // dem Ring (Wandfläche + 5 cm). Ihre Anbindung ist senkrecht: vom Kanal
    // auf 0,04 m zum Anschluss auf 0,15 m.
    const senkrecht = art('Anbindung').filter((r) =>
      r.elevationTo !== undefined && Math.hypot(r.points[1].x - r.points[0].x, r.points[1].y - r.points[0].y) < 1e-6);
    check('Vier senkrechte Anbindungen', senkrecht.length, 4);
    check('… vom Kanal (0,04 m) zum Ventil (0,15 m)', senkrecht.every((r) => r.elevation === 0.04 && r.elevationTo === 0.15), true);

    const minDn = (liste: typeof vl) => Math.min(...liste.map((r) => r.nominalDiameter));
    check('Außenleitung nicht unter 1" (DN 25)', minDn(art('Außenleitung')) >= RING_MINDEST_DN.zuleitung, true);
    check('Zuleitung nicht unter 1" (DN 25)', minDn(art('Zuleitung')) >= RING_MINDEST_DN.zuleitung, true);
    check('Ring nicht unter Cu 18 (DN 15)', minDn(art('Ringleitung')) >= RING_MINDEST_DN.ring, true);
    check('Keine Anbindung unter Cu 15 (DN 12)', minDn(art('Anbindung')) >= RING_MINDEST_DN.anbindung, true);
    check('Im Bestand ist der Ring aus Kupfer', vl.every((r) => r.material === 'kupfer'), true);
    check('Keine Anbindung mit Cu 12', art('Anbindung').some((r) => (r.label ?? '').includes('Cu 12')), false);

    /*
     * Volumenstrom des ersten Ringabschnitts: alle fünf, 1000 + 900 + 500 +
     * 1100 + 800 = 4300 W bei 55/45 °C, also 10 K. Wasser bei 50 °C:
     * ρ ≈ 988 kg/m³, c ≈ 4,18 kJ/(kg·K) → V = 4,3 / (988 · 4,18 · 10) m³/s
     * = 1,041 · 10⁻⁴ m³/s = 0,375 m³/h.
     */
    const groesster = Math.max(...art('Ringleitung').map((r) => r.designFlow ?? 0));
    check('Erster Ringabschnitt trägt alles [m³/h]', groesster, 0.375, 0.005);

    check('Der Hinweis nennt die Wärmepumpe als Erzeuger', erg.notes.some((n) => n.text.includes('Wärmeerzeuger ist die Wärmepumpe')), true);
    check('… und die Hauseinführung als angenommen', erg.notes.some((n) => n.text.includes('**angenommen**')), true);
    check('Kein „Kein Wärmeerzeuger" mehr', erg.notes.some((n) => n.text.startsWith('Kein Wärmeerzeuger')), false);
    check('Die Tür wird gemeldet', erg.notes.some((n) => n.text.includes('Tür(en) in der Außenwand')), true);
    check('Die Kernbohrungen werden genannt', erg.notes.some((n) => n.text.includes('3 Kernbohrung')), true);
  }

  // =========================================================================
  // 4 · Wärmepumpe als Erzeuger — auch im Baum
  // =========================================================================
  {
    const baum = planPipeNetwork(baueHaus({ pumpe: 'monoblock-outdoor' }), { mode: 'sanierung', levelId: 'eg' });
    const aussen = baum.runs.filter((r) => r.service === 'heating-flow' && (r.label ?? '').startsWith('Außenleitung'));
    check('Baum: Außenleitung vorhanden', aussen.length, 1);
    // Von der Wärmepumpe (−3 | 2) bis zum Trassenanfang (0,33 | 2): 3,33 m.
    const p = aussen[0]?.points ?? [];
    check('Baum: Außenleitung 3,33 m lang',
      p.length === 2 ? Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y) : NaN, 3.33, 1e-6);
    check('Baum: alle versorgt', baum.served, 5);

    // Split: Die Leitung nach draußen führt Kältemittel. Ohne Inneneinheit
    // im Haus gibt es keinen Anfang des Heizungsnetzes.
    const split = planPipeNetwork(baueHaus({ pumpe: 'split' }), { mode: 'sanierung', levelId: 'eg' });
    check('Split: keine Außenleitung für Heizungswasser',
      split.runs.some((r) => (r.label ?? '').startsWith('Außenleitung')), false);
    check('Split: kein Netz ohne Erzeuger im Haus', split.runs.length, 0);

    // Mit Puffer: Die Wärmepumpe lädt den Puffer, der Ring beginnt dort.
    const mitPuffer = planPipeNetwork(baueHaus({ pumpe: 'monoblock-outdoor', speicher: true }), {
      mode: 'sanierung', levelId: 'eg', anordnung: 'ring',
    });
    check('Puffer: Außenleitung vorhanden', mitPuffer.runs.some((r) => (r.label ?? '').startsWith('Außenleitung')), true);
    check('Puffer: Ring vorhanden', mitPuffer.runs.some((r) => (r.label ?? '').startsWith('Ringleitung')), true);
    // Versorgt sind die fünf Heizflächen **und** der Puffer: Er hängt an der
    // Wärmepumpe wie ein Verteiler an seinem Erzeuger — und wird genauso
    // gezählt.
    check('Puffer: fünf Heizflächen und der Puffer versorgt', mitPuffer.served, 6);
  }

  // =========================================================================
  // 5 · Badheizkörper
  // =========================================================================
  {
    const def = FIXTURE_BY_TYPE['towel-radiator'];
    check('Der Badheizkörper steht im Katalog', def?.label ?? 'fehlt', 'Badheizkörper');
    check('… als Heizung', def?.category ?? 'fehlt', 'heating');
    check('… an der Wand', def?.wallMounted ?? false, true);
    check('… mit 500 W Vorbelegung', def?.params.powerW ?? 0, 500);
  }

  // =========================================================================
  // 6 · Standardraumnamen
  // =========================================================================
  {
    const ohne = STANDARD_RAUMNAMEN.filter((n) => nutzungAusName(n) === undefined);
    check('Jeder Standardname ergibt eine Nutzung', ohne.join(', '), '');
    check('„Bad" ist ein Bad', nutzungAusName('Bad') ?? '—', 'bath');
    check('„Flur" ist ein Flur', nutzungAusName('Flur') ?? '—', 'hallway');
    check('„Heizungsraum" ist Technik', nutzungAusName('Heizungsraum') ?? '—', 'technical');
    check('„Wohnküche" ist eine Küche', nutzungAusName('Wohnküche') ?? '—', 'kitchen');
    check('Gewählt ist gewählt, auch klein geschrieben', istStandardraumname('  bad '), true);
    check('„Bad OG" ist ein eigener Name', istStandardraumname('Bad OG'), false);
    check('Keine doppelten Einträge', new Set(STANDARD_RAUMNAMEN).size, STANDARD_RAUMNAMEN.length);
  }

  // =========================================================================
  // 7 · Kreisleitung höchstens Cu 22 — gemeldet am echten Bestandsscan
  // =========================================================================
  /*
   * Am Ringanfang eines Einfamilienhauses mit 8,6 kW kam „Ringleitung Cu 28"
   * heraus: Cu 22 hält dort zwar die Geschwindigkeit, reißt aber das
   * Druckgefälle 150 Pa/m. Die Handwerkerregel sagt 22 oder 18 — also gilt
   * DN 20 als Obergrenze, und ein Hinweis nennt die Zahlen.
   *
   * Handrechnung: 0,75 m³/h in Cu 22 × 1 (lichte Weite 20 mm):
   *   A = π · 0,010² = 3,1416e-4 m², Q = 0,75 / 3600 = 2,0833e-4 m³/s,
   *   v = Q / A = 0,663 m/s  (< 1,0 m/s, die Geschwindigkeit hält).
   */
  {
    const fluid = fluidProperties(50);
    const frei = sizePipe(0.75, { material: 'kupfer', maxVelocity: 1.0, maxGradient: 150, fluid });
    check('Ohne Obergrenze wählt die Hydraulik Cu 28 (DN 25)', frei.dimension.dn, 25);
    const gedeckelt = sizePipe(0.75, { material: 'kupfer', maxVelocity: 1.0, maxGradient: 150, fluid, maxDn: RING_HOECHST_DN });
    check('Mit Obergrenze DN 20 bleibt es bei Cu 22', gedeckelt.dimension.dn, 20);
    check('… und die Begründung sagt „größte"', gedeckelt.reason, 'größte');
    check('… v = 0,663 m/s (Handrechnung)', Math.abs(gedeckelt.velocity - 0.663) < 0.005, true);
    check('… das Druckgefälle liegt über 150 Pa/m', gedeckelt.gradient > 150, true);
    check('… und es gibt eine Warnung', typeof gedeckelt.warning, 'string');

    // Das Prüfhaus mit 2 kW je Heizfläche: 10 kW am Ringanfang.
    const haus = baueHaus({ pumpe: 'monoblock-outdoor' });
    for (const f of Object.values(haus.fixtures)) f.params = { ...f.params, powerW: 2000 };
    const stark = planPipeNetwork(haus, { mode: 'sanierung', levelId: 'eg', anordnung: 'ring' });
    const ringWeiten = [...new Set(stark.runs
      .filter((r) => (r.label ?? '').startsWith('Ringleitung'))
      .map((r) => (r.label ?? '').replace('Ringleitung ', '')))];
    check('Starker Ring: nur Cu 22 und Cu 18', ringWeiten.every((w) => w === 'Cu 22 × 1' || w === 'Cu 18 × 1'), true);
    check('Starker Ring: am Anfang Cu 22', ringWeiten.includes('Cu 22 × 1'), true);
    check('Starker Ring: Hinweis mit den Zahlen',
      stark.notes.some((n) => n.severity === 'warn' && n.text.startsWith('Ringanfang über den Richtwerten')), true);
    check('Starker Ring: kein Fehler', stark.notes.filter((n) => n.severity === 'error').length, 0);
  }
}
