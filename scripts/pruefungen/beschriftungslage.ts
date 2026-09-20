/**
 * Prüfblock „Beschriftungslage" — zwei Zeichenfehler, die rechnerisch stimmten.
 * ---------------------------------------------------------------------------
 * **Warum es diesen Block gibt.** Zweitausendfünfhundert Prüfungen rechnen
 * nach, ob die Zahlen stimmen. Beide Fehler, die hier abgesichert werden,
 * haben sie durchgelassen, weil an ihnen nichts falsch gerechnet war:
 *
 *  1. Die Rohrbeschriftung „DN 12" stand starr auf der Mitte des längsten
 *     Abschnitts. Im Demomodell war das genau die Stelle, an der der
 *     Raumstempel „Schlafen / 14,77 m²" steht — beide Angaben unlesbar, beide
 *     einzeln richtig. Der Fehler saß an **zwei** Stellen, auf dem Bildschirm
 *     und auf dem Druckblatt; repariert ist er an **einer**
 *     (`beschriftungsLage`), und dieser Block hält fest, dass die Regel
 *     wirklich die eine ist.
 *  2. Thermostatventil und Entlüftung setzte der Rohrausleger auf denselben
 *     Punkt. Zwei Symbole exakt aufeinander ergeben ein Zeichen, das es nicht
 *     gibt.
 *
 * **Was hier nicht geprüft werden kann und wo es geprüft wird.** Ob das
 * fertige Bild stimmt, sagt `scripts/smoke-bild.mjs` — ein Pixelvergleich
 * braucht einen Browser. Dieser Block prüft die Regel und ihre beiden
 * Anwendungen ohne Browser: die Regel als reine Funktion, das Druckblatt am
 * erzeugten SVG (dort tragen die `text`-Elemente ihre Koordinaten mit sich),
 * die Armaturen am Ergebnis des Rohrauslegers.
 *
 * **Der Nachweis, dass die Zuordnung hält.** Beim Ausweichen darf eine
 * Armatur ihre `runId` nicht verlieren und die Zuordnung nicht kippen. Das ist
 * kein theoretisches Risiko: bis 1.11.0 blieb das Feld leer, der hydraulische
 * Abgleich rechnete ohne Einzelwiderstände und kam **günstiger** heraus als
 * die Vorversion. Der Block rechnet die Zuordnung deshalb selbst nach, statt
 * sich darauf zu verlassen, dass sie gesetzt ist.
 */

import type { CheckFn } from './typ';
import type {
  BimDocument,
  BimNode,
  Fixture,
  Level,
  PipeRun,
  Vec2,
  Wall,
} from '../../src/types/bim';
import { emptyPlant, emptySite } from '../../src/lib/plantDefaults';
import { detectRooms } from '../../src/lib/roomDetection';
import { planPipeNetwork } from '../../src/lib/pipeLayout';
import { buildPlanSvg, type PlanPrintOptions } from '../../src/lib/planPrint';
import {
  beschriftungsHuelle,
  findeBeschriftungslage,
  rechteckeUeberlappen,
  type Rechteck,
} from '../../src/lib/beschriftungsLage';

const r3 = (v: number): number => Math.round(v * 1000) / 1000;

// ---------------------------------------------------------------------------
// Prüfgrundriss: ein Rechteckraum, Verteiler links, Heizkörper rechts
// ---------------------------------------------------------------------------

const DICKE = 0.24;
const RAUMHOEHE = 2.75;

/**
 * Ein einzelner Rechteckraum mit gesetzten TGA-Objekten.
 *
 * Bewusst schlicht: der Flächenschwerpunkt eines Rechtecks ist seine Mitte,
 * und damit ist die Lage des Raumstempels von Hand nachrechenbar. Genau darauf
 * beruhen die Sollwerte weiter unten — ein L-förmiger Raum wäre realistischer
 * und würde nichts beweisen, was sich nicht auch hier zeigt.
 */
function baueRaum(breite: number, tiefe: number, name: string, geraete: Fixture[]): BimDocument {
  const nodes: Record<string, BimNode> = {};
  const walls: Record<string, Wall> = {};

  const p = (id: string, x: number, y: number): void => {
    nodes[id] = { id, x, y, levelId: 'eg' };
  };
  p('sw', 0, 0);
  p('se', breite, 0);
  p('ne', breite, tiefe);
  p('nw', 0, tiefe);

  const wand = (id: string, a: string, b: string): void => {
    walls[id] = {
      id,
      a,
      b,
      levelId: 'eg',
      type: 'exterior',
      thickness: DICKE,
      uValue: 0.28,
      height: RAUMHOEHE,
      layerId: 'layer-walls',
    };
  };
  wand('w-s', 'sw', 'se');
  wand('w-e', 'se', 'ne');
  wand('w-n', 'ne', 'nw');
  wand('w-w', 'nw', 'sw');

  const eg: Level = {
    id: 'eg',
    name: 'EG',
    order: 0,
    elevation: 0,
    height: RAUMHOEHE,
    floorUValue: 0.35,
    floorBoundary: 'ground',
    ceilingUValue: 0.2,
    ceilingBoundary: 'unheated',
  };

  const doc: BimDocument = {
    site: emptySite(),
    plant: emptyPlant(),
    meta: {
      name: 'Prüfraum Beschriftungslage',
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
    openings: {},
    fixtures: Object.fromEntries(geraete.map((f) => [f.id, f])),
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
    openings: [],
    levelId: 'eg',
    defaultHeight: RAUMHOEHE,
    northAngle: 0,
  });
  doc.rooms = Object.fromEntries(raeume.map((r) => [r.id, r]));
  for (const raum of Object.values(doc.rooms)) {
    raum.name = name;
    raum.setpointTemperature = 20;
    raum.isHeated = true;
  }
  return doc;
}

function geraet(id: string, type: Fixture['type'], x: number, y: number, powerW?: number): Fixture {
  return {
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
  };
}

const DRUCK: PlanPrintOptions = {
  scale: 50,
  format: 'A4',
  orientation: 'portrait',
  levelId: 'eg',
  showRoomLabels: true,
  showDimensions: false,
  showFixtures: false,
  showAnnotations: false,
  showInteriorDimensions: false,
  showLegend: false,
  showOpeningDimensions: false,
};

/** Ein `text`-Element des Blattes samt seiner Lage in Blattmillimetern. */
interface Blatttext {
  x: number;
  y: number;
  text: string;
}

/**
 * Die Beschriftungen eines Blattes auslesen.
 *
 * Gelesen wird das SVG und nicht ein Pixelbild: ein `text`-Element trägt seine
 * Koordinaten mit sich, ein Pixelhaufen nicht. Derselbe Weg, den auch der
 * Bildprüfstand für die Doppelbeschriftung geht.
 */
function blatttexte(svg: string): Blatttext[] {
  const out: Blatttext[] = [];
  const muster = /<text\s+x="(-?[\d.]+)"\s+y="(-?[\d.]+)"[^>]*>([^<]*)<\/text>/g;
  let m = muster.exec(svg);
  while (m !== null) {
    out.push({ x: Number(m[1]), y: Number(m[2]), text: m[3] });
    m = muster.exec(svg);
  }
  return out;
}

/** Abstand eines Punktes zu einer Strecke [m] — die Zuordnungsfrage selbst. */
function abstandZurStrecke(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const q = dx * dx + dy * dy;
  if (q < 1e-9) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / q));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function pruefeBeschriftungslage(check: CheckFn): void {
  // =========================================================================
  // 1 · Die Regel als reine Funktion
  // =========================================================================
  {
    const a: Rechteck = { x0: 0, y0: 0, x1: 10, y1: 10 };
    check('Zwei getrennte Rechtecke überlappen nicht',
      rechteckeUeberlappen(a, { x0: 11, y0: 0, x1: 20, y1: 10 }), false);
    check('Kante an Kante ist noch keine Überlappung',
      rechteckeUeberlappen(a, { x0: 10, y0: 0, x1: 20, y1: 10 }), false);
    check('Ein Millimeter Überschneidung zählt',
      rechteckeUeberlappen(a, { x0: 9, y0: 0, x1: 20, y1: 10 }), true);

    // Ein waagerechter Kasten: 20 breit, von 12 über bis 1 über der Linie.
    const waagerecht = beschriftungsHuelle(100, 50, 0, { breite: 20, oben: -12, unten: -1 });
    check('Hülle waagerecht, linke Kante', r3(waagerecht.x0), 90);
    check('Hülle waagerecht, Oberkante', r3(waagerecht.y0), 38);
    check('Hülle waagerecht, Unterkante', r3(waagerecht.y1), 49);
    // Um 90° gedreht tauschen Breite und Höhe die Achsen — die Hülle folgt.
    const senkrecht = beschriftungsHuelle(100, 50, Math.PI / 2, { breite: 20, oben: -12, unten: -1 });
    check('Hülle senkrecht ist 11 breit', r3(senkrecht.x1 - senkrecht.x0), 11);
    check('… und 20 hoch', r3(senkrecht.y1 - senkrecht.y0), 20);
  }

  // =========================================================================
  // 2 · Die Rangfolge der Kandidaten
  // =========================================================================
  {
    // Eine waagerechte Trasse von x = 0 bis x = 400.
    const trasse = [{ x: 0, y: 100 }, { x: 400, y: 100 }];
    const mass = { breite: 40, oben: -12, unten: -1 };

    const frei = findeBeschriftungslage(trasse, mass, []);
    check('Ohne Belegung greift der erste Kandidat', frei?.rang ?? -1, 0);
    // Der Viertelpunkt, nicht die Mitte: die Mitte eines Abschnitts ist im
    // Grundriss der am dichtesten belegte Ort (dort sitzt der Raumstempel).
    check('… und der liegt auf dem Viertelpunkt', r3(frei?.x ?? -1), 100);
    check('Der Winkel steht lesbar (waagerecht)', r3(frei?.winkel ?? -1), 0);

    // Viertelpunkt zugestellt: die Regel rückt auf den Dreiviertelpunkt.
    const sperreViertel: Rechteck = { x0: 80, y0: 80, x1: 120, y1: 100 };
    const zweite = findeBeschriftungslage(trasse, mass, [sperreViertel]);
    check('Belegter Viertelpunkt wird übersprungen', zweite?.rang ?? -1, 1);
    check('… und die Beschriftung steht auf dem Dreiviertelpunkt', r3(zweite?.x ?? -1), 300);

    // Beide Viertelpunkte zugestellt: erst dann die Mitte.
    const sperreDreiviertel: Rechteck = { x0: 280, y0: 80, x1: 320, y1: 100 };
    const dritte = findeBeschriftungslage(trasse, mass, [sperreViertel, sperreDreiviertel]);
    check('Sind beide Viertelpunkte belegt, greift die Mitte', dritte?.rang ?? -1, 2);
    check('… und die liegt bei der Hälfte', r3(dritte?.x ?? -1), 200);

    // Alles zu: die Beschriftung entfällt. Das ist die getroffene Entscheidung
    // und keine Nebenwirkung — ein Loch im Plan ist besser als ein Fleck.
    const sperreMitte: Rechteck = { x0: 180, y0: 80, x1: 220, y1: 100 };
    const keine = findeBeschriftungslage(trasse, mass, [sperreViertel, sperreDreiviertel, sperreMitte]);
    check('Ist jeder Kandidat belegt, entfällt die Beschriftung', keine === null, true);

    // Das gelieferte Rechteck ist wirklich frei — sonst wäre die ganze
    // Prüfung eine Behauptung über sich selbst.
    const belegt = [sperreViertel];
    const lage = findeBeschriftungslage(trasse, mass, belegt);
    check('Das gelieferte Rechteck überlappt keine Sperrfläche',
      belegt.some((r) => rechteckeUeberlappen(lage!.belegt, r)), false);

    // Zu kurz zum Beschriften: ein Abschnitt, der schmaler ist als der
    // Schriftzug, trägt ihn nicht.
    const kurz = findeBeschriftungslage([{ x: 0, y: 0 }, { x: 30, y: 0 }], mass, []);
    check('Ein zu kurzer Abschnitt trägt keine Beschriftung', kurz === null, true);

    // Der längste Abschnitt zuerst — auch wenn er nicht der erste ist.
    const knick = [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 400 }];
    const amLangen = findeBeschriftungslage(knick, mass, []);
    check('Der längste Abschnitt wird zuerst beschriftet', r3(amLangen?.y ?? -1), 100);
  }

  // =========================================================================
  // 3 · Das Druckblatt weicht dem Raumstempel aus
  // =========================================================================
  {
    /*
     * Der Grundriss ist so gewählt, dass der **erste** Kandidat auf dem
     * Raumstempel liegt — nur dann sagt die Prüfung etwas aus.
     *
     * Raum 12,00 × 4,00 m über die Wandachsen, Wandstärke 0,24 m: das lichte
     * Rechteck läuft von 0,12 bis 11,88 bzw. 0,12 bis 3,88, sein Schwerpunkt
     * liegt bei (6,00 | 2,00). Dort steht der Raumstempel.
     *
     * Die Leitung läuft von x = 4,1667 bis x = 11,50 auf y = 2,00. Ihr
     * Viertelpunkt: 4,1667 + 0,25 · 7,3333 = 6,00 — genau der Schwerpunkt.
     * Der Dreiviertelpunkt liegt bei 4,1667 + 0,75 · 7,3333 = 9,6667.
     */
    const doc = baueRaum(12, 4, 'Schlafen', [
      geraet('v-1', 'manifold', 0.6, 0.6),
      geraet('hk-1', 'radiator', 11.5, 2.0, 900),
    ]);
    const leitung: PipeRun = {
      id: 'pr-1',
      levelId: 'eg',
      service: 'heating-flow',
      points: [{ x: 4 + 1 / 6, y: 2 }, { x: 11.5, y: 2 }],
      nominalDiameter: 15,
      insulation: 20,
      elevation: 0.02,
      material: 'verbund',
      outerDiameter: 20,
    };
    doc.pipes = { 'pr-1': leitung };

    const mitStempel = blatttexte(buildPlanSvg(doc, DRUCK).svg);
    const ohneStempel = blatttexte(
      buildPlanSvg(doc, { ...DRUCK, showRoomLabels: false }).svg,
    );

    /*
     * **Warum hier nicht mehr nach „DN " gesucht wird.** Seit der
     * Umstellung auf handwerksübliche Bezeichnungen trägt die Leitung im
     * Plan ihr Handelsmaß: Dieser Abschnitt ist Verbundrohr 20 × 2, also
     * steht „MSV 20 × 2 · 20 mm" auf dem Blatt und nicht „DN 15 · 20 mm".
     * Der Prüfblock hat das gefunden, bevor es jemand im Plan sah — er
     * stürzte ab, weil `dnMit` leer blieb. Gesucht wird deshalb nach dem
     * Werkstoffkürzel, und das steht hier absichtlich wörtlich: Wenn sich
     * die Beschriftung noch einmal ändert, soll diese Prüfung es merken.
     */
    const dnMit = mitStempel.filter((t) => t.text.startsWith('MSV '));
    const dnOhne = ohneStempel.filter((t) => t.text.startsWith('MSV '));
    check('Auf dem Blatt steht genau eine Rohrangabe', dnMit.length, 1);
    check('… und zwar das Handelsmaß, nicht die Nennweite',
      dnMit[0]?.text ?? '—', 'MSV 20 × 2 · 20 mm');
    check('Der Raumstempel steht auch drauf',
      mitStempel.some((t) => t.text === 'Schlafen'), true);
    check('Ohne Raumstempel gäbe es die Rohrangabe ebenfalls', dnOhne.length, 1);

    const stempel = mitStempel.find((t) => t.text === 'Schlafen')!;
    /*
     * Der Nachweis in zwei Richtungen.
     *
     * Ohne Raumstempel steht die Nennweite auf dem Viertelpunkt — und der
     * liegt in x genau unter dem Stempel. Genau das war der Fehler: die
     * Beschriftung ist nicht „zufällig woanders", sie ist dort, wo der
     * Stempel steht, und weicht nur aus, weil der Stempel gemeldet wurde.
     */
    check('Ohne Stempel läge die Rohrangabe auf seiner Stelle',
      Math.abs(dnOhne[0].x - stempel.x) < 0.05, true);
    // 3,6667 m Versatz × 20 mm/m = 73,33 mm auf dem Blatt.
    check('Mit Stempel rückt sie auf den Dreiviertelpunkt [mm]',
      r3(dnMit[0].x - dnOhne[0].x), 73.333, 0.02);
    check('… und liegt damit außerhalb des Stempels',
      Math.abs(dnMit[0].x - stempel.x) > 20, true);
  }

  // =========================================================================
  // 4 · Zwei Armaturen liegen nicht mehr aufeinander
  // =========================================================================
  {
    const doc = baueRaum(10, 4, 'Wohnen', [
      geraet('v-1', 'manifold', 0.6, 0.6),
      geraet('hk-1', 'radiator', 9.2, 0.6, 1400),
      geraet('hk-2', 'radiator', 9.2, 3.4, 900),
    ]);
    const plan = planPipeNetwork(doc, { mode: 'neubau', levelId: 'eg' });
    const armaturen = plan.accessories;
    const vorlaeufe = plan.runs.filter((r) => r.service === 'heating-flow');

    check('Es wurden Armaturen gesetzt', armaturen.length > 4, true);

    // Der Fehler selbst: Thermostatventil und Entlüftung saßen auf demselben
    // Punkt, weil beide auf `ziel.position` gesetzt wurden.
    const ventil = armaturen.find((a) => a.kind === 'thermostatic-valve')!;
    const entlueftung = armaturen.find((a) => a.kind === 'air-vent')!;
    const abstandPaar = Math.hypot(
      ventil.position.x - entlueftung.position.x,
      ventil.position.y - entlueftung.position.y,
    );
    check('Thermostatventil und Entlüftung sitzen nicht mehr aufeinander',
      abstandPaar >= 0.12 - 1e-9, true);

    /*
     * Und allgemein: keine zwei Armaturen auf demselben Punkt.
     *
     * Das ist die harte Zusage — und die einzige, die sich halten lässt. Der
     * Mindestabstand von 0,12 m gilt, **soweit die Leitungszuordnung es
     * zulässt**: an einem Abzweig dicht am Heizkörper treffen drei kurze
     * Abschnitte zusammen, und ein T-Stück findet dort in keiner Richtung
     * 0,12 m, ohne dass eine Nachbarleitung die nächste würde. Es bleibt dann
     * liegen. Der Prüfblock hält diesen einen bekannten Fall namentlich fest,
     * statt ihn wegzurunden — fällt er künftig weg, wird die Prüfung rot und
     * jemand schaut hin.
     */
    let engstes = Infinity;
    let engstesOhneAbzweig = Infinity;
    const unterMass: string[] = [];
    for (let i = 0; i < armaturen.length; i++) {
      for (let j = i + 1; j < armaturen.length; j++) {
        const d = Math.hypot(
          armaturen[i].position.x - armaturen[j].position.x,
          armaturen[i].position.y - armaturen[j].position.y,
        );
        engstes = Math.min(engstes, d);
        const amAbzweig = armaturen[i].kind === 'tee' || armaturen[j].kind === 'tee';
        if (!amAbzweig) engstesOhneAbzweig = Math.min(engstesOhneAbzweig, d);
        if (d < 0.12 - 1e-9) unterMass.push([armaturen[i].kind, armaturen[j].kind].sort().join('+'));
      }
    }
    check('Keine zwei Armaturen liegen auf demselben Punkt', engstes > 0.001, true);
    check('Zwischen frei setzbaren Armaturen gilt der Mindestabstand [m]',
      r3(engstesOhneAbzweig) >= 0.12, true);
    check('Was darunter bleibt, ist ausschließlich das T-Stück am Abzweig',
      unterMass.every((paar) => paar.includes('tee')), true);

    /*
     * Das Thermostatventil bleibt liegen.
     *
     * Verschoben wird, was später gesetzt wurde — das Ventil sitzt auf dem
     * Heizkörperanschluss, und dort gehört es hin. Wanderte es, wäre die
     * Reparatur des Zeichenfehlers ein Fachfehler.
     */
    const amHeizkoerper = Object.values(doc.fixtures).some(
      (f) => f.type === 'radiator'
        && Math.hypot(f.position.x - ventil.position.x, f.position.y - ventil.position.y) < 1e-9,
    );
    check('Das Thermostatventil sitzt weiterhin genau am Heizkörper', amHeizkoerper, true);

    /*
     * Und die Zuordnung hält.
     *
     * Nachgerechnet, nicht abgelesen: für jede Armatur wird die nächste
     * Vorlaufleitung neu bestimmt und mit der gespeicherten `runId`
     * verglichen. Ohne diese Prüfung könnte das Verschieben eine Armatur
     * still an die Nachbarleitung hängen — der Abgleich rechnete dann mit
     * den Einzelwiderständen am falschen Strang.
     */
    check('Jede Armatur kennt ihre Leitung', armaturen.every((a) => Boolean(a.runId)), true);
    let zuordnungHaelt = true;
    let weitester = 0;
    for (const a of armaturen) {
      let beste: string | undefined;
      let abstand = Infinity;
      for (const r of vorlaeufe) {
        const d = abstandZurStrecke(a.position, r.points[0], r.points[1]);
        if (d < abstand) {
          abstand = d;
          beste = r.id;
        }
      }
      if (beste !== a.runId) zuordnungHaelt = false;
      weitester = Math.max(weitester, abstand);
    }
    check('Die zugeordnete Leitung ist weiterhin die nächstliegende', zuordnungHaelt, true);
    // 0,4 m ist `ACCESSORY_SNAP` in `pipeNetwork`: darüber fiele die Armatur
    // im Strangschema von ihrem Abschnitt, obwohl die `runId` noch stünde.
    check('Keine Armatur weiter als 0,40 m von ihrer Leitung [m]', r3(weitester) <= 0.4, true);
  }
}
