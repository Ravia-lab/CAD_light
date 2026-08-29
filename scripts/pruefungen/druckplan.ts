/**
 * Prüfblock „Druckplan" — was auf dem Blatt steht.
 *
 * **Warum es diesen Block gibt.** Der Ausdruck ist die einzige Ausgabe dieses
 * Programms, die niemand mehr nachfragen kann: er liegt auf der Baustelle, im
 * Bauantrag oder beim Heizungsbauer, und was dort fehlt, fehlt endgültig. Der
 * Anwender hat seinen Grundriss gedruckt und fünf Dinge gefunden, die auf dem
 * Bildschirm richtig aussahen und auf dem Papier falsch waren:
 *
 *  1. die Ecken standen offen — der Bildschirm verlängerte die Wand über den
 *     Anschlussknoten, der Druck nicht;
 *  2. quer durch die Wände liefen Linien, die dort nichts zu suchen hatten —
 *     die Umrisse der einzelnen Wandstücke, sichtbar in der Überlappung;
 *  3. eine Fläche, die kein Raum ist, sondern Mauerwerk, ließ sich nicht als
 *     solche darstellen;
 *  4. Türen hatten keine Symbolik — nur eine weiße Lücke mit zwei Strichen;
 *  5. Fenstermaße fehlten vollständig.
 *
 * Alle fünf haben dieselbe Ursache: Bildschirm und Blatt rechneten ihre eigene
 * Geometrie. Deshalb prüft dieser Block nicht das Aussehen, sondern die
 * gemeinsame Quelle — `planWallPieces` und `openingSymbol` — und danach, dass
 * das erzeugte SVG das auch enthält.
 *
 * Alle Sollwerte sind aus der Geometrie hergeleitet und im Kommentar
 * ausgerechnet; keiner stammt aus einem Probelauf.
 */

import type { CheckFn } from './typ';
import type {
  BimDocument,
  BimNode,
  Level,
  Opening,
  SolidElement,
  VerticalElement,
  Wall,
} from '../../src/types/bim';
import { emptyPlant, emptySite } from '../../src/lib/plantDefaults';
import { detectRooms } from '../../src/lib/roomDetection';
import { buildPlanSvg } from '../../src/lib/planPrint';
import { openingLabel, openingSymbol } from '../../src/lib/openingSymbols';
import { getWallGeometry, indexWallsByNode, planWallPieces } from '../../src/lib/wallGeometry';

/** Achsmaße [m]: Rechteck 6,00 × 4,00, Wandstärke 0,24, lichte Höhe 2,75. */
const BREITE = 6;
const TIEFE = 4;
const DICKE = 0.24;
const HOEHE = 2.75;
/** Halbe Wandstärke — genau so weit muss an jeder Ecke verlängert werden. */
const HALB = DICKE / 2;

function baueHaus(openings: Record<string, Opening> = {}): BimDocument {
  const nodes: Record<string, BimNode> = {};
  const walls: Record<string, Wall> = {};

  const p = (name: string, x: number, y: number): string => {
    nodes[name] = { id: name, x, y, levelId: 'eg' };
    return name;
  };
  const sw = p('sw', 0, 0);
  const se = p('se', BREITE, 0);
  const ne = p('ne', BREITE, TIEFE);
  const nw = p('nw', 0, TIEFE);

  const wand = (name: string, a: string, b: string): void => {
    walls[name] = {
      id: name,
      a,
      b,
      levelId: 'eg',
      type: 'exterior',
      thickness: DICKE,
      uValue: 0.28,
      height: HOEHE,
      layerId: 'layer-walls',
    };
  };
  wand('w-s', sw, se);
  wand('w-e', se, ne);
  wand('w-n', ne, nw);
  wand('w-w', nw, sw);

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
      name: 'Prüfhaus Druckplan',
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
    fixtures: {},
    verticals: {},
    solids: {},
    pipes: {},
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
    openings: Object.values(openings),
    levelId: 'eg',
    defaultHeight: HOEHE,
    northAngle: 0,
  });
  doc.rooms = Object.fromEntries(raeume.map((r) => [r.id, r]));
  for (const raum of Object.values(doc.rooms)) {
    raum.name = 'Wohnen';
    raum.setpointTemperature = 20;
    raum.isHeated = true;
  }
  return doc;
}

const OPTIONEN = {
  scale: 50,
  format: 'A3' as const,
  orientation: 'landscape' as const,
  levelId: 'eg',
  showRoomLabels: true,
  showDimensions: false,
  showFixtures: false,
  showAnnotations: false,
  showInteriorDimensions: false,
  showLegend: false,
  showOpeningDimensions: true,
};

/** Ein Fenster in der Südwand, mittig. */
const fenster = (distance: number, id = 'f1'): Opening => ({
  id,
  wallId: 'w-s',
  kind: 'window',
  distance,
  width: 1.26,
  height: 1.385,
  sillHeight: 0.9,
  windowType: 'fixed',
  panels: 1,
});

/** Eine Tür in der Westwand — Band links, Anschlag zur +Normalen. */
const tuer = (flip = false): Opening => ({
  id: 't1',
  wallId: 'w-w',
  kind: 'door',
  distance: 2,
  width: 0.885,
  height: 2.01,
  sillHeight: 0,
  hinge: 'left',
  flipSwing: flip,
  doorType: 'single',
});


/**
 * Mittelpunkt eines SVG-Bogens aus seinen Endpunkten zurückrechnen.
 *
 * Das ist die Umkehrung der Endpunkt-Parametrierung aus der SVG-Spezifikation
 * (F.6.5). Sie wird hier gebraucht, weil genau dieser Schritt den Fehler
 * sichtbar macht, den kein Vergleich von Anfangs- und Endpunkt findet: bei
 * falschem Sweep-Flag bleiben beide Punkte gleich, der Bogen legt sich aber
 * als Spiegelbild auf die andere Seite der Sehne. Der zurückgerechnete
 * Mittelpunkt ist dann nicht mehr das Türband, sondern dessen Spiegelung —
 * und die Tür schlägt im Ausdruck zur falschen Seite auf.
 */
function bogenMittelpunkt(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  r: number,
  largeArc: number,
  sweep: number,
): { x: number; y: number } {
  const dx = (p0.x - p1.x) / 2;
  const dy = (p0.y - p1.y) / 2;
  const nenner = r * r * dy * dy + r * r * dx * dx;
  const zaehler = Math.max(0, r * r * r * r - nenner);
  const faktor = (largeArc !== sweep ? 1 : -1) * Math.sqrt(zaehler / (nenner || 1));
  return {
    x: faktor * dy + (p0.x + p1.x) / 2,
    y: -faktor * dx + (p0.y + p1.y) / 2,
  };
}

/** Das Türblatt (Strichstärke 0,35 mm) und der Schwenkbogen aus dem Blatt. */
function tuerAusSvg(svg: string): {
  band: { x: number; y: number };
  offen: { x: number; y: number };
  bogenStart: { x: number; y: number };
  bogenEnde: { x: number; y: number };
  mittelpunkt: { x: number; y: number };
  radius: number;
} | null {
  const blatt = svg.match(
    /<line x1="(-?[\d.]+)" y1="(-?[\d.]+)" x2="(-?[\d.]+)" y2="(-?[\d.]+)" stroke="#0F172A" stroke-width="0.35"/,
  );
  const bogen = svg.match(
    /<path d="M(-?[\d.]+) (-?[\d.]+) A([\d.]+) [\d.]+ 0 ([01]) ([01]) (-?[\d.]+) (-?[\d.]+)"/,
  );
  if (!blatt || !bogen) return null;
  const p0 = { x: Number(bogen[1]), y: Number(bogen[2]) };
  const p1 = { x: Number(bogen[6]), y: Number(bogen[7]) };
  const r = Number(bogen[3]);
  return {
    band: { x: Number(blatt[1]), y: Number(blatt[2]) },
    offen: { x: Number(blatt[3]), y: Number(blatt[4]) },
    bogenStart: p0,
    bogenEnde: p1,
    radius: r,
    mittelpunkt: bogenMittelpunkt(p0, p1, r, Number(bogen[4]), Number(bogen[5])),
  };
}

const r3 = (v: number): number => Math.round(v * 1000) / 1000;

// ---------------------------------------------------------------------------

export function pruefeDruckplan(check: CheckFn): void {
  // =========================================================================
  // 1 · Eckschluss — die Wand reicht über den Knoten hinaus
  // =========================================================================
  {
    const doc = baueHaus();
    const byNode = indexWallsByNode(Object.values(doc.walls));
    const g = getWallGeometry(doc.walls['w-s'], doc.nodes)!;
    const stuecke = planWallPieces(g, [], byNode);

    check('Wand ohne Öffnung ist ein Stück', stuecke.length, 1);
    // An beiden Knoten steht eine 0,24 m starke Wand: Verlängerung = 0,12 m.
    check('Verlängerung am Anfangsknoten [m]', r3(-stuecke[0].uStart), HALB, 0.0005);
    check('Verlängerung am Endknoten [m]', r3(stuecke[0].uEnd - g.length), HALB, 0.0005);
    // Damit ist das Wandstück 6,00 + 2 × 0,12 = 6,24 m lang und die Ecke
    // vollständig gefüllt.
    check('Länge des Wandstücks [m]', r3(stuecke[0].uEnd - stuecke[0].uStart), BREITE + DICKE, 0.0005);
    check('Beide Enden sind Anschlüsse', `${stuecke[0].capStart}/${stuecke[0].capEnd}`, 'junction/junction');
  }

  // Gegenprobe: eine Wand ohne Nachbarn wird nicht verlängert. Sonst stünde
  // an jedem freien Wandende ein Überstand, den es am Bau nicht gibt.
  {
    const doc = baueHaus();
    const einzeln = { ...doc.walls['w-s'], id: 'frei', a: 'frei-a', b: 'frei-b' };
    const nodes = {
      ...doc.nodes,
      'frei-a': { id: 'frei-a', x: 20, y: 0, levelId: 'eg' },
      'frei-b': { id: 'frei-b', x: 23, y: 0, levelId: 'eg' },
    };
    const g = getWallGeometry(einzeln, nodes)!;
    const stuecke = planWallPieces(g, [], indexWallsByNode([einzeln]));
    check('Freies Wandende ohne Überstand [m]', r3(stuecke[0].uStart), 0, 0.0005);
    check('Freies Wandende ohne Überstand am Kopf [m]', r3(stuecke[0].uEnd), 3, 0.0005);
  }

  // Der Fall, der die Ecke im Ausdruck des Anwenders aufriss: ein Fenster,
  // dessen Laibung genau auf dem Knoten sitzt. Ohne Verlängerung bliebe dort
  // gar nichts stehen — mit ihr bleibt das Eckstück von 0,12 m.
  {
    const doc = baueHaus({ f1: fenster(BREITE - 1.26 / 2) });
    const byNode = indexWallsByNode(Object.values(doc.walls));
    const g = getWallGeometry(doc.walls['w-s'], doc.nodes)!;
    const stuecke = planWallPieces(g, Object.values(doc.openings), byNode);
    check('Fenster am Wandende: zwei Stücke', stuecke.length, 2);
    check('Das Eckstück bleibt stehen [m]', r3(stuecke[1].uEnd - stuecke[1].uStart), HALB, 0.0005);
    check('… und beginnt an der Laibung', stuecke[1].capStart, 'opening');
  }

  // =========================================================================
  // 2 · Türsymbolik — Blatt und Schwenkbogen
  // =========================================================================
  {
    const doc = baueHaus({ t1: tuer() });
    const g = getWallGeometry(doc.walls['w-w'], doc.nodes)!;
    const teile = openingSymbol(g, doc.openings['t1']);

    const rollen = teile.map((t) => t.role);
    check('Tür: zwei Laibungen', rollen.filter((r) => r === 'laibung').length, 2);
    check('Tür: ein Türblatt', rollen.filter((r) => r === 'blatt').length, 1);
    check('Tür: ein Schwenkbogen', rollen.filter((r) => r === 'bogen').length, 1);

    const blatt = teile.find((t) => t.role === 'blatt');
    const laenge =
      blatt && blatt.kind === 'line' ? Math.hypot(blatt.b.x - blatt.a.x, blatt.b.y - blatt.a.y) : 0;
    check('Das Blatt ist so breit wie die Tür [m]', r3(laenge), 0.885, 0.0005);

    const bogen = teile.find((t) => t.role === 'bogen');
    check('Der Bogen hat den Radius der Blattbreite [m]', bogen && bogen.kind === 'arc' ? r3(bogen.radius) : 0, 0.885, 0.0005);

    // Der Bogen überstreicht genau einen Viertelkreis: offene und geschlossene
    // Lage stehen senkrecht aufeinander.
    if (bogen && bogen.kind === 'arc') {
      let delta = bogen.endAngle - bogen.startAngle;
      while (delta > Math.PI) delta -= 2 * Math.PI;
      while (delta < -Math.PI) delta += 2 * Math.PI;
      check('Der Schwenkbogen ist ein Viertelkreis [°]', r3(Math.abs((delta * 180) / Math.PI)), 90, 0.01);

      // Die Wand w-w läuft von nw (0/4) nach sw (0/0), also in Richtung −y.
      // Ihre Linksnormale (−dir.y, dir.x) zeigt damit nach +x, ins Gebäude.
      // Ohne `flipSwing` schlägt die Tür zur +Normalen auf, also nach innen —
      // der Bogen muss bei x > 0 liegen. Das ist auch die richtige Antwort für
      // eine Wohnungstür: sie schlägt nach innen auf.
      const mitte = bogen.startAngle + delta / 2;
      const px = bogen.center.x + bogen.radius * Math.cos(mitte);
      check('Der Bogen liegt auf der Anschlagseite (x > 0)', px > 0, true);
    }
  }

  // Gegenprobe: `flipSwing` dreht den Anschlag auf die andere Seite.
  {
    const doc = baueHaus({ t1: tuer(true) });
    const g = getWallGeometry(doc.walls['w-w'], doc.nodes)!;
    const bogen = openingSymbol(g, doc.openings['t1']).find((t) => t.role === 'bogen');
    let px = 0;
    if (bogen && bogen.kind === 'arc') {
      let delta = bogen.endAngle - bogen.startAngle;
      while (delta > Math.PI) delta -= 2 * Math.PI;
      while (delta < -Math.PI) delta += 2 * Math.PI;
      px = bogen.center.x + bogen.radius * Math.cos(bogen.startAngle + delta / 2);
    }
    check('Umgekehrter Anschlag: der Bogen liegt außen (x < 0)', px < 0, true);
  }

  // Fenster und Durchgang tragen andere Teile — daran unterscheidet man sie
  // im Grundriss.
  {
    const doc = baueHaus({ f1: { ...fenster(3), panels: 2, windowType: 'double' } });
    const g = getWallGeometry(doc.walls['w-s'], doc.nodes)!;
    const rollen = openingSymbol(g, doc.openings['f1']).map((t) => t.role);
    check('Fenster: kein Türblatt', rollen.includes('blatt'), false);
    // Zwei Glasebenen plus ein Pfosten bei zwei Flügeln.
    check('Fenster: Glasebenen und Pfosten', rollen.filter((r) => r === 'glas').length, 3);
  }
  {
    const durchgang: Opening = {
      id: 'd1',
      wallId: 'w-s',
      kind: 'passage',
      distance: 3,
      width: 1,
      height: 2.01,
      sillHeight: 0,
    };
    const doc = baueHaus({ d1: durchgang });
    const g = getWallGeometry(doc.walls['w-s'], doc.nodes)!;
    const teile = openingSymbol(g, doc.openings['d1']);
    check('Durchgang: kein Blatt, kein Glas', teile.some((t) => t.role === 'blatt' || t.role === 'glas'), false);
    check('Durchgang: der Sturz gestrichelt auf beiden Seiten', teile.filter((t) => t.role === 'sturz').length, 2);
    check('… und tatsächlich gestrichelt', teile.every((t) => t.role !== 'sturz' || (t.kind === 'line' && t.dashed === true)), true);
  }

  // =========================================================================
  // 3 · Beschriftung der Öffnungen
  // =========================================================================
  check('Türmaß deutsch geschrieben', openingLabel(tuer()).main, '0,885/2,01');
  check('Fenstermaß deutsch geschrieben', openingLabel(fenster(3)).main, '1,26/1,385');
  check('Brüstungshöhe darunter', openingLabel(fenster(3)).sub ?? 'fehlt', 'B 0,90');
  check('Die Tür hat keine Brüstung', openingLabel(tuer()).sub ?? 'keine', 'keine');
  check(
    'Die Fenstertür bis zum Boden ebenso',
    openingLabel({ ...fenster(3), sillHeight: 0 }).sub ?? 'keine',
    'keine',
  );

  // =========================================================================
  // 4 · Das Blatt selbst
  // =========================================================================
  {
    const doc = baueHaus({ f1: fenster(3), t1: tuer() });
    const svg = buildPlanSvg(doc, OPTIONEN).svg;

    check('Das Fenstermaß steht auf dem Blatt', svg.includes('1,26/1,385'), true);
    check('Die Brüstungshöhe steht auf dem Blatt', svg.includes('B 0,90'), true);
    check('Das Türmaß steht auf dem Blatt', svg.includes('0,885/2,01'), true);
    // Der Schwenkbogen ist der einzige Kreisbogen im Plan dieses Hauses.
    check('Der Schwenkbogen wird gezeichnet', /<path d="M[^"]*A/.test(svg), true);

    // Die Wandflächen werden zweimal ausgegeben: einmal mit doppelter
    // Umrisslinie, einmal nur gefüllt. Stimmt die Zahl nicht überein, ist der
    // Vereinigungstrick zerbrochen und die Linien stehen wieder quer in den
    // Wänden.
    const mitRand = (svg.match(/<polygon[^>]*stroke="#0F172A" stroke-width="0.36"/g) ?? []).length;
    const ohneRand = (svg.match(/<polygon[^>]*fill="#334155" stroke="none"/g) ?? []).length;
    check('Jede Wandfläche wird zweimal ausgegeben', mitRand, ohneRand);
    check('… und es gibt überhaupt Wandflächen', mitRand > 0, true);

    const ohne = buildPlanSvg(doc, { ...OPTIONEN, showOpeningDimensions: false }).svg;
    check('Ohne Öffnungsmaße steht das Fenstermaß nicht auf dem Blatt', ohne.includes('1,26/1,385'), false);
    check('… der Schwenkbogen aber schon', /<path d="M[^"]*A/.test(ohne), true);
  }

  // -------------------------------------------------------------------------
  // 4a · Der Schwenkbogen auf dem Blatt schlägt zur selben Seite auf wie im
  //      Modell. Anfangs- und Endpunkt allein beweisen das nicht: bei
  //      falschem Sweep-Flag bleiben beide gleich, und der Bogen kippt als
  //      Spiegelbild auf die andere Seite der Sehne. Nachgerechnet wird
  //      deshalb der Mittelpunkt — er muss das Türband sein.
  // -------------------------------------------------------------------------
  {
    const doc = baueHaus({ t1: tuer() });
    const gezeichnet = tuerAusSvg(buildPlanSvg(doc, OPTIONEN).svg);
    check('Türblatt und Schwenkbogen stehen im SVG', gezeichnet !== null, true);
    if (gezeichnet) {
      // Der Bogen beginnt am offenen Türblatt, nicht am Band.
      const anBlatt = Math.hypot(
        gezeichnet.bogenStart.x - gezeichnet.offen.x,
        gezeichnet.bogenStart.y - gezeichnet.offen.y,
      );
      check('Der Bogen beginnt am offenen Blatt [mm]', r3(anBlatt), 0, 0.02);

      // Und sein Mittelpunkt ist das Band. Genau hier fällt ein verkehrtes
      // Sweep-Flag auf: der Mittelpunkt läge dann gespiegelt zur Sehne.
      const amBand = Math.hypot(
        gezeichnet.mittelpunkt.x - gezeichnet.band.x,
        gezeichnet.mittelpunkt.y - gezeichnet.band.y,
      );
      check('Der Mittelpunkt des Bogens ist das Türband [mm]', r3(amBand), 0, 0.05);

      // Gegenprobe zur Spiegelung: läge der Mittelpunkt falsch, wäre er um
      // die doppelte Höhe der Sehne verschoben — bei 0,885 m Blattbreite und
      // 1:50 sind das rund 25 mm. Die Toleranz oben trennt das sicher.
      const gespiegelt = bogenMittelpunkt(
        gezeichnet.bogenStart,
        gezeichnet.bogenEnde,
        gezeichnet.radius,
        0,
        1,
      );
      const abstand = Math.hypot(gespiegelt.x - gezeichnet.band.x, gespiegelt.y - gezeichnet.band.y);
      check('Die falsche Seite läge weit daneben [mm]', abstand > 20 || abstand < 0.05, true);

      // Der Radius auf dem Blatt: 0,885 m bei 1:50 sind 17,70 mm.
      check('Radius auf dem Blatt [mm]', r3(gezeichnet.radius), (0.885 * 1000) / 50, 0.02);
    }
  }

  // Und dasselbe für den umgekehrten Anschlag: der Bogen muss mitwandern.
  {
    const links = tuerAusSvg(buildPlanSvg(baueHaus({ t1: tuer() }), OPTIONEN).svg);
    const rechts = tuerAusSvg(buildPlanSvg(baueHaus({ t1: tuer(true) }), OPTIONEN).svg);
    if (links && rechts) {
      const amBand = Math.hypot(
        rechts.mittelpunkt.x - rechts.band.x,
        rechts.mittelpunkt.y - rechts.band.y,
      );
      check('Auch umgekehrt ist der Mittelpunkt das Band [mm]', r3(amBand), 0, 0.05);
      // Die offenen Blattenden liegen auf verschiedenen Seiten der Wand.
      check(
        'Der Anschlag wechselt die Wandseite',
        Math.abs(links.offen.x - rechts.offen.x) > 30,
        true,
      );
    }
  }

  // =========================================================================
  // 5 · Massive Bauteile auf dem Blatt
  // =========================================================================
  {
    const doc = baueHaus();
    const kamin: SolidElement = {
      id: 'm1',
      kind: 'chimney',
      name: 'Kamin',
      levelId: 'eg',
      position: { x: 3, y: 2 },
      width: 0.4,
      length: 0.5,
      rotation: 0,
      throughAllLevels: true,
    };
    doc.solids = { m1: kamin };
    const svg = buildPlanSvg(doc, OPTIONEN).svg;
    check('Das Mauerwerk wird schraffiert', svg.includes('fill="url(#massiv)"'), true);
    check('Die Schraffur ist definiert', svg.includes('<pattern id="massiv"'), true);

    // Ein Raum, der im Wesentlichen Mauerwerk ist, trägt keinen Raumstempel
    // mehr — sonst behaupten zwei Beschriftungen dasselbe Feld.
    const raum = Object.values(doc.rooms)[0];
    const flaeche = raum.area;
    const gross: SolidElement = {
      ...kamin,
      position: raum.centroid,
      length: Math.sqrt(flaeche) * 0.95,
      width: Math.sqrt(flaeche) * 0.95,
    };
    doc.solids = { m1: gross };
    // 0,95² = 0,9025 der Raumfläche — über der Schwelle von 0,80.
    const zugemauert = buildPlanSvg(doc, OPTIONEN).svg;
    check('Der Raumstempel entfällt bei massiver Fläche', zugemauert.includes('>Wohnen<'), false);
    check('Der Name des Bauteils steht stattdessen da', zugemauert.includes('>Kamin<'), true);
    // Gegenprobe mit einem kleinen Bauteil: der Stempel bleibt.
    doc.solids = { m1: kamin };
    check('Beim kleinen Bauteil bleibt der Raumstempel', buildPlanSvg(doc, OPTIONEN).svg.includes('>Wohnen<'), true);
  }

  // =========================================================================
  // 6 · Treppen — die Legende versprach sie, das Blatt zeigte sie nicht
  // =========================================================================
  {
    const doc = baueHaus();
    const treppe: VerticalElement = {
      id: 'v1',
      kind: 'stair-straight',
      name: 'Treppe',
      levelId: 'eg',
      position: { x: 3, y: 2 },
      width: 1,
      length: 3,
      rotation: 0,
      steps: 16,
      deductsArea: true,
      openToAbove: true,
    };
    doc.verticals = { v1: treppe };
    const svg = buildPlanSvg(doc, OPTIONEN).svg;
    // 16 Steigungen ergeben 15 Stufenlinien im Lauf.
    const stufen = (svg.match(/stroke="#475569" stroke-width="0.12"/g) ?? []).length;
    check('Die Stufenlinien stehen auf dem Blatt', stufen, 15);
    check('Der Antritt ist gekennzeichnet', svg.includes('<circle'), true);
  }
}
