/**
 * Prüfblock „Übergabe" — die Konventionen, nach denen die Gegenstelle fragt.
 *
 * **Warum dieser Block gebraucht wird.** Zwei Rückfragen aus der Integration
 * haben gezeigt, dass ein richtig gerechnetes Feld nichts nützt, solange
 * niemand weiß, was es bedeutet. Beide betrafen Größen, die *doppelt gezählt*
 * werden können:
 *
 *  • Lüftung — `airChangeRate` ist der hygienische Mindestluftwechsel n_min,
 *    das `ventilation`-Objekt der Anlagenstrom. Beides beschreibt denselben
 *    Luftwechsel; wer addiert, rechnet ihn zweimal. Dasselbe gilt für die
 *    Wärmerückgewinnung: entweder `effectiveSupplyAirflow` oder der rohe
 *    Zuluftstrom mit eigenem η.
 *  • Baugrund — die Bodenart lag bisher nur im Wärmepumpenblock und fehlte
 *    jedem Projekt ohne Wärmepumpe, obwohl die Erdreichrechnung sie braucht.
 *
 * Geprüft wird deshalb beides zugleich: dass die Zahlen stimmen **und** dass
 * der erklärende Text im Dokument steht. Ein Konventionstext, der still aus
 * dem Export verschwindet, ist genau der Fehler, der hier nicht mehr
 * passieren soll — er fällt sonst erst bei der nächsten Rückfrage auf.
 *
 * Normwerte kommen keine vor. f_g1, f_g2 und G_w nach DIN EN ISO 13370
 * rechnet dieses Programm nicht, λ des Bodens liefert es nicht; geprüft wird,
 * dass die *Eingangsgrößen* vollständig herauskommen und dass der Export
 * nirgends so tut, als hätte er die Tabelle.
 */

import type { CheckFn } from './typ';
import type {
  BimDocument,
  BimNode,
  ExportRoom,
  Fixture,
  Level,
  RaviaExport,
  SoilKind,
  Wall,
} from '../../src/types/bim';
import { SOIL_LABELS } from '../../src/types/bim';
import { emptyPlant, emptySite } from '../../src/lib/plantDefaults';
import { detectRooms } from '../../src/lib/roomDetection';
import { buildRaviaExport } from '../../src/lib/raviaExport';

// ---------------------------------------------------------------------------
// Das Prüfhaus
// ---------------------------------------------------------------------------

/** Achsmaße [m]: Rechteck 8 × 5, Trennwand bei x = 5. */
const BREITE = 8;
const TIEFE = 5;
const DICKE = 0.3;
const INNEN = 0.2;
/** Fußbodenhöhe des Geschosses [m] — es liegt 1,00 m unter Gelände. */
const FUSSBODEN = -1;
const HOEHE = 2.5;

/** Lichte Grundflächen [m²], aus den Achsmaßen abzüglich der halben Wandstärken. */
const BREITE_W = 5 - DICKE / 2 - INNEN / 2; // 4,75
const BREITE_O = BREITE - 5 - DICKE / 2 - INNEN / 2; // 2,75
const LICHT_Y = TIEFE - DICKE; // 4,70
const FLAECHE_W = BREITE_W * LICHT_Y; // 22,325
const FLAECHE_O = BREITE_O * LICHT_Y; // 12,925

/** Luftwechsel und Volumenströme des Prüfhauses. */
const N_MIN_WOHNEN = 0.5;
const N_MIN_BAD = 1.5;
const ZULUFT = 60;
const ABLUFT = 45;
const UEBERSTROM = 45;
const RUECKGEWINN = 0.8;

interface HausVorgabe {
  /** Geländeoberkante [m]; fehlt sie, ist nichts erdberührt. */
  gelaende?: number;
  /** Bodenplatte gegen Erdreich? `false` legt sie adiabat — Haus ohne Erdkontakt. */
  erdberuehrt?: boolean;
  soil?: SoilKind;
  grundwasser?: number;
  grundwasserAzimut?: number;
  lueftung?: 'none' | 'exhaust' | 'balanced';
}

/**
 * Ein Geschoss mit zwei Räumen: Wohnen (Zuluft) und Bad (Abluft).
 *
 * Zwei Räume sind das Mindeste, an dem sich der Überströmweg zeigen lässt —
 * mit nur einem Raum gäbe es keine Luft, die von woanders herkommt, und
 * genau darum geht die Rückfrage.
 */
function baueHaus(vorgabe: HausVorgabe = {}): BimDocument {
  const nodes: Record<string, BimNode> = {};
  const walls: Record<string, Wall> = {};
  const levels: Record<string, Level> = {};
  const fixtures: Record<string, Fixture> = {};

  const p = (name: string, x: number, y: number): string => {
    nodes[name] = { id: name, x, y, levelId: 'eg' };
    return name;
  };
  const sw = p('sw', 0, 0);
  const se = p('se', BREITE, 0);
  const ne = p('ne', BREITE, TIEFE);
  const nw = p('nw', 0, TIEFE);
  const ms = p('ms', 5, 0);
  const mn = p('mn', 5, TIEFE);

  const wand = (name: string, a: string, b: string, innen = false): void => {
    walls[name] = {
      id: name,
      a,
      b,
      levelId: 'eg',
      type: innen ? 'interior' : 'exterior',
      thickness: innen ? INNEN : DICKE,
      uValue: innen ? 1.2 : 0.28,
      height: HOEHE,
      layerId: 'layer-walls',
    };
  };
  wand('w-s1', sw, ms);
  wand('w-s2', ms, se);
  wand('w-e', se, ne);
  wand('w-n2', ne, mn);
  wand('w-n1', mn, nw);
  wand('w-w', nw, sw);
  wand('w-mid', ms, mn, true);

  levels['eg'] = {
    id: 'eg',
    name: 'EG',
    order: 0,
    elevation: FUSSBODEN,
    height: HOEHE,
    floorUValue: 0.35,
    floorBoundary: vorgabe.erdberuehrt === false ? 'adiabatic' : 'ground',
    ceilingUValue: 0.2,
    ceilingBoundary: 'unheated',
  };

  const fx = (name: string, type: string, x: number, airflow: number): void => {
    fixtures[name] = {
      id: name,
      type,
      category: 'ventilation',
      levelId: 'eg',
      position: { x, y: 2.5 },
      rotation: 0,
      length: 0.16,
      depth: 0.16,
      elevation: 2.2,
      params: { airflow },
    } as Fixture;
  };
  fx('f-zu', 'air-supply', 2.5, ZULUFT);
  fx('f-ab', 'air-exhaust', 6.5, ABLUFT);
  fx('f-ue', 'air-transfer', 6.5, UEBERSTROM);

  const doc: BimDocument = {
    site: {
      ...emptySite(),
      ...(vorgabe.soil ? { soil: vorgabe.soil } : {}),
      ...(vorgabe.grundwasser !== undefined ? { groundwaterDepth: vorgabe.grundwasser } : {}),
      ...(vorgabe.grundwasserAzimut !== undefined
        ? { groundwaterAzimuth: vorgabe.grundwasserAzimut }
        : {}),
    },
    plant: emptyPlant(),
    meta: {
      name: 'Prüfhaus Übergabe',
      createdAt: '2026-01-01T00:00:00.000Z',
      modifiedAt: '2026-01-01T00:00:00.000Z',
      northAngle: 0,
      designOutdoorTemperature: -12,
      designIndoorTemperature: 20,
      n50: 1.5,
      shielding: 'moderate',
      unheatedTemperature: 10,
      groundTemperature: 10,
      ...(vorgabe.gelaende === undefined ? {} : { terrainElevation: vorgabe.gelaende }),
      thermalBridgeSupplement: 0,
      thermalBridgeMethod: 'flat',
      thermalBridgeCategory: 'custom',
      reheatFactor: 0,
      ventilation: {
        kind: vorgabe.lueftung ?? 'balanced',
        heatRecovery: RUECKGEWINN,
        operation: 'continuous',
      },
    },
    levels,
    layers: {},
    nodes,
    walls,
    openings: {},
    fixtures,
    verticals: {},
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
    defaultHeight: HOEHE,
    northAngle: 0,
  });
  doc.rooms = Object.fromEntries(raeume.map((r) => [r.id, r]));
  for (const raum of Object.values(doc.rooms)) {
    const west = raum.centroid.x < 5;
    raum.name = west ? 'Wohnen' : 'Bad';
    raum.usage = (west ? 'living' : 'bath') as never;
    raum.setpointTemperature = west ? 20 : 24;
    raum.airChangeRate = west ? N_MIN_WOHNEN : N_MIN_BAD;
    raum.ventilationRole = west ? 'supply' : 'exhaust';
  }
  for (const f of Object.values(doc.fixtures)) {
    const raum = Object.values(doc.rooms).find((r) => (r.centroid.x < 5) === (f.position.x < 5));
    if (raum) f.roomId = raum.id;
  }
  return doc;
}

const raumVon = (ex: RaviaExport, name: string): ExportRoom | undefined =>
  ex.rooms.find((r) => r.name === name);

/** Auf zwei Nachkommastellen — dieselbe Rundung, mit der der Export arbeitet. */
const r2 = (v: number): number => Math.round(v * 100) / 100;

/** „da" oder „fehlt" — ein fehlendes Feld ist eine Auskunft, keine 0. */
const vorhanden = (v: unknown): 'da' | 'fehlt' => (v === undefined ? 'fehlt' : 'da');

// ---------------------------------------------------------------------------
// Lüftung
// ---------------------------------------------------------------------------

export function pruefeLueftungskonvention(check: CheckFn): void {
  const ex = buildRaviaExport(baueHaus({ gelaende: 0 }));
  const wohnen = raumVon(ex, 'Wohnen');
  const bad = raumVon(ex, 'Bad');

  // === 1 — Die Geometrie, auf der alles Weitere ruht =======================
  check('Zwei Räume erkannt', ex.rooms.length, 2);
  check('Wohnen: lichte Fläche', wohnen?.area ?? 0, r2(FLAECHE_W), 0.011);
  check('Bad: lichte Fläche', bad?.area ?? 0, r2(FLAECHE_O), 0.011);

  // === 2 — n_min ist n_min, nicht die Infiltration =========================
  // Der Mindestluftstrom ist n_min · V und sonst nichts. Die Infiltration
  // steht nirgends als Ergebnis, sondern nur als Eingangsgröße.
  check('Wohnen: n_min unverändert im Export', wohnen?.airChangeRate ?? 0, N_MIN_WOHNEN);
  check(
    'Wohnen: Mindestluftstrom = n_min · V',
    wohnen?.minimumAirflow ?? 0,
    r2((wohnen?.volume ?? 0) * N_MIN_WOHNEN),
    0.011,
  );
  check(
    'Derselbe Wert steht im Lüftungsobjekt — keine zweite Größe',
    wohnen?.ventilation.minimumAirflow ?? -1,
    wohnen?.minimumAirflow ?? -2,
  );
  check('Bad: Mindestluftstrom = n_min · V', bad?.ventilation.minimumAirflow ?? 0, r2((bad?.volume ?? 0) * N_MIN_BAD), 0.011);
  check('n50 als Eingangsgröße der Infiltration', ex.project.n50, 1.5);
  check('Abschirmung als Eingangsgröße der Infiltration', ex.project.shielding, 'moderate');
  check('Zahl der Außenfassaden je Raum', vorhanden(wohnen?.exposedFacadeCount), 'da');
  check('Höhenlage des Geschosses je Raum', wohnen?.levelElevation ?? 99, FUSSBODEN);

  // === 3 — Der Anlagenstrom sind die platzierten Ventile ===================
  check('Wohnen: Zuluft aus dem platzierten Ventil', wohnen?.ventilation.supplyAirflow ?? 0, ZULUFT);
  check('Wohnen: keine Abluft', wohnen?.ventilation.exhaustAirflow ?? -1, 0);
  check('Bad: Abluft aus dem platzierten Ventil', bad?.ventilation.exhaustAirflow ?? 0, ABLUFT);
  check('Bad: keine Zuluft', bad?.ventilation.supplyAirflow ?? -1, 0);
  check('Bad: Überströmung aus dem Überströmelement', bad?.ventilation.transferAirflow ?? 0, UEBERSTROM);
  check('Bad ist Abluftraum', bad?.ventilation.role ?? '', 'exhaust');
  check('Wohnen ist Zuluftraum', wohnen?.ventilation.role ?? '', 'supply');

  // === 4 — Der Abluftraum bekommt seine Luft von nebenan ===================
  // Die Zahlen, mit denen die Gegenstelle das erkennen kann: der Raum hat
  // keine Zuluft, aber einen Überströmstrom, der seine Abluft deckt. Wer
  // seinen Abluftstrom als Außenluft ansetzt, rechnet die 45 m³/h zweimal —
  // einmal hier mit θ_e und einmal im Zuluftraum, wo sie schon erwärmt wurden.
  check(
    'Die Abluft des Bades ist über den Überströmweg gedeckt',
    (bad?.ventilation.transferAirflow ?? 0) >= (bad?.ventilation.exhaustAirflow ?? 1),
    true,
  );
  check(
    'Die Außenluft des Gebäudes steht nur in der Gebäudebilanz',
    ex.totals.ventilation.supplyAirflow,
    ZULUFT,
  );

  // === 5 — Wärmerückgewinnung: einer der beiden Werte, nie beide ===========
  // η = 0,8 ⇒ 60 · 0,2 = 12 m³/h tragen noch Außenlufttemperatur.
  check('Wirksame Zuluft = V̇_zu · (1 − η)', wohnen?.ventilation.effectiveSupplyAirflow ?? 0, 12);
  check('η steht daneben, damit man selbst rechnen kann', ex.totals.ventilation.heatRecovery, RUECKGEWINN);
  check(
    'Der rohe Zuluftstrom bleibt daneben stehen',
    wohnen?.ventilation.supplyAirflow ?? 0,
    ZULUFT,
  );

  // Reine Abluftanlage: es gibt nichts zurückzugewinnen, also wirkt η nicht —
  // sonst käme aus derselben Anlage je nach Bauart ein Fünftel der Luft.
  const abluft = buildRaviaExport(baueHaus({ gelaende: 0, lueftung: 'exhaust' }));
  check('Abluftanlage: η bleibt wirkungslos', abluft.totals.ventilation.heatRecovery, 0);
  check(
    'Abluftanlage: wirksame Zuluft ist der volle Strom',
    raumVon(abluft, 'Wohnen')?.ventilation.effectiveSupplyAirflow ?? 0,
    ZULUFT,
  );

  // === 6 — Die Gebäudebilanz ==============================================
  const t = ex.totals.ventilation;
  check('Gebäude: Zuluft', t.supplyAirflow, ZULUFT);
  check('Gebäude: Abluft', t.exhaustAirflow, ABLUFT);
  check('Gebäude: Überströmung', t.transferAirflow, UEBERSTROM);
  check('Gebäude: wirksame Zuluft', t.effectiveSupplyAirflow, 12);
  check('Gebäude: Luftbilanz Zuluft − Abluft', t.balance, ZULUFT - ABLUFT);
  check('Gebäude: ein Zuluftraum', t.roomsByRole.supply, 1);
  check('Gebäude: ein Abluftraum', t.roomsByRole.exhaust, 1);

  // === 7 — Der Text steht im Dokument =====================================
  // Ohne ihn ist jede Zahl oben eine Vermutung der Gegenstelle. Geprüft wird
  // nicht der Wortlaut, sondern dass jede der vier Fragen beantwortet ist.
  const text = ex.conventions.ventilation;
  check('Konvention „Lüftung" vorhanden', text.length > 400, true);
  check('… benennt n_min', text.includes('n_min'), true);
  check('… nennt airChangeRate beim Namen', text.includes('rooms[].airChangeRate'), true);
  check('… schließt die Infiltration aus', text.includes('nicht die Infiltration'), true);
  check('… verbietet das Addieren', text.includes('nicht addiert'), true);
  check('… nennt den Rückgewinnungswert', text.includes('effectiveSupplyAirflow'), true);
  check('… stellt ihn dem rohen Strom gegenüber', text.includes('entweder'), true);
  check('… erklärt den Abluftraum', text.includes('Fortluft'), true);
  check('… nennt die Eingangsgrößen der Infiltration', text.includes('project.n50'), true);
  check('… und die Abschirmung dazu', text.includes('project.shielding'), true);
}

// ---------------------------------------------------------------------------
// Baugrund
// ---------------------------------------------------------------------------

export function pruefeBaugrund(check: CheckFn): void {
  // === 1 — Erdberührtes Haus: der Block steht da ==========================
  const ex = buildRaviaExport(baueHaus({ gelaende: 0 }));
  const boden = ex.subsoil;
  check('Baugrund im Export', vorhanden(boden), 'da');
  check('Bodenart aus dem Lageplan', boden?.soil ?? '', 'normal');
  check('Klartext dazu', boden?.soilLabel ?? '', SOIL_LABELS.normal);
  check('Geländeoberkante als Bezugshöhe', boden?.terrainElevation ?? 99, 0);

  // Sohle 1,00 m unter Gelände (Fußboden bei −1,00, Gelände bei 0,00); die
  // Wände binden gleich tief ein, ihre Unterkante liegt auf derselben Höhe.
  check('Größte Einbindetiefe', boden?.deepestEmbedment ?? 0, 1, 0.001);
  check(
    'Erdberührte Fläche = Summe der Flächen mit boundary „ground"',
    boden?.groundContactArea ?? 0,
    r2(
      ex.rooms.reduce(
        (sum, r) => sum + r.surfaces.reduce((s, f) => (f.boundary === 'ground' ? s + f.netArea : s), 0),
        0,
      ),
    ),
    0.011,
  );

  // Der eigentliche Zweck: die Bodenart ist da, obwohl keine Wärmepumpe
  // gesetzt ist. Vorher lag sie ausschließlich im Wärmepumpenblock.
  check('… und das ohne Wärmepumpe im Projekt', vorhanden(ex.heatPump), 'fehlt');

  // === 2 — Grundwasserstand: erfasst oder gar nicht =======================
  check('Ohne Erfassung fehlt der Grundwasserstand', vorhanden(boden?.groundwaterDepth), 'fehlt');
  const mitWasser = buildRaviaExport(baueHaus({ gelaende: 0, grundwasser: 2.4, grundwasserAzimut: 90 }));
  check('Erfasster Grundwasserstand wandert mit', mitWasser.subsoil?.groundwaterDepth ?? 0, 2.4);
  check('Fließrichtung ebenso', mitWasser.subsoil?.groundwaterAzimuth ?? 0, 90);

  // === 3 — Bodenart wandert unverändert durch =============================
  const nass = buildRaviaExport(baueHaus({ gelaende: 0, soil: 'saturated' }));
  check('Andere Bodenart', nass.subsoil?.soil ?? '', 'saturated');
  check('… mit ihrem Klartext', nass.subsoil?.soilLabel ?? '', SOIL_LABELS.saturated);

  // === 4 — Ohne Baugrundangaben fehlt der Block ===========================
  // Ein Haus, dessen Bodenplatte adiabat liegt und dessen Grundwasserstand
  // nicht erfasst ist, hat nichts zu berichten. Dann steht dort auch nichts —
  // die Vorbelegung „normal" wäre eine Angabe, nach der niemand gefragt hat.
  const ohne = buildRaviaExport(baueHaus({ erdberuehrt: false }));
  check(
    'Ohne Erdkontakt keine erdberührte Fläche',
    ohne.rooms.reduce(
      (sum, r) => sum + r.surfaces.filter((f) => f.boundary === 'ground').length,
      0,
    ),
    0,
  );
  check('… und kein Baugrundblock', vorhanden(ohne.subsoil), 'fehlt');
  check('… der übrige Export bleibt vollständig', ohne.rooms.length, 2);

  // Umgekehrt: erfasster Grundwasserstand ohne Erdkontakt wird nicht
  // unterschlagen — die Angabe stammt vom Anwender, nicht aus einer Vorgabe.
  const nurWasser = buildRaviaExport(baueHaus({ erdberuehrt: false, grundwasser: 6 }));
  check('Erfasster Grundwasserstand allein trägt den Block', vorhanden(nurWasser.subsoil), 'da');
  check('… ohne Erdkontakt bleibt die Fläche 0', nurWasser.subsoil?.groundContactArea ?? -1, 0);
  check('… und die Einbindetiefe 0', nurWasser.subsoil?.deepestEmbedment ?? -1, 0);

  // Ohne Geländeoberkante gibt es keine Bezugshöhe für eine Tiefe.
  const ohneGelaende = buildRaviaExport(baueHaus({ grundwasser: 3 }));
  check('Ohne Gelände keine Bezugshöhe', vorhanden(ohneGelaende.subsoil?.terrainElevation), 'fehlt');
  check('… und keine Einbindetiefe', ohneGelaende.subsoil?.deepestEmbedment ?? -1, 0);

  // === 5 — Was der Export nicht liefert ====================================
  // λ des Bodens steht in DIN EN ISO 13370 und wird hier nicht nachgebaut.
  const roh = JSON.stringify(boden ?? {}).toLowerCase();
  check('Kein λ-Wert im Baugrundblock', roh.includes('lambda') || roh.includes('conductivity'), false);

  // === 6 — Der Text steht im Dokument =====================================
  const text = ex.conventions.subsoil;
  check('Konvention „Baugrund" vorhanden', text.length > 300, true);
  check('… benennt die Bodenarten', text.includes('wassergesättigter Sand/Kies'), true);
  check('… legt die Vorbelegung offen', text.includes('Vorbelegung'), true);
  check('… erklärt die Tiefe unter Gelände', text.includes('unter Geländeoberkante'), true);
  check('… nennt G_w und seine Norm', text.includes('G_w') && text.includes('13370'), true);
  check('… sagt, dass λ fehlt', text.includes('λ'), true);
  check('Der Erdkontakt-Text verweist auf den Baugrund', ex.conventions.groundContact.includes('subsoil'), true);
}

/**
 * Der Rückweg: was aus der Exportdatei wieder ein Modell macht.
 *
 * **Der Fehler, der hier nicht mehr passieren soll.** Bis 1.18.0 enthielt der
 * Export das Grundstück nur in der *ausgewerteten* Sicht unter `heatPump` —
 * Grundstücksfläche, Schallnachweis, Schutzbereich. Zum Zurücklesen taugt das
 * nicht: dort steht ein Rechenfall und kein Gerät. Wer exportierte und die
 * Datei wieder öffnete, hatte Grundstücksgrenze, Nachbarbebauung und
 * Wärmepumpe verloren — ohne Fehlermeldung, denn geladen wurde ja etwas.
 *
 * Geprüft wird deshalb nicht „ist eine Zahl richtig", sondern: **steht in der
 * Rohgeometrie alles, was das Modell wieder ergibt?**
 */
export function pruefeRueckweg(check: CheckFn): void {
  const doc = baueHaus({ gelaende: 0 });
  doc.site = {
    ...doc.site,
    elements: {
      grenze: {
        id: 'grenze',
        kind: 'boundary',
        points: [
          { x: -5, y: -5 },
          { x: 20, y: -5 },
          { x: 20, y: 18 },
          { x: -5, y: 18 },
        ],
      },
      baum: { id: 'baum', kind: 'tree', points: [{ x: 3, y: -2 }] },
    } as typeof doc.site.elements,
  };
  doc.freihand = {
    fh1: {
      id: 'fh1',
      levelId: 'eg',
      punkte: [
        { x: 1, y: 1 },
        { x: 2, y: 1.2 },
      ],
      createdAt: '2026-09-13T00:00:00.000Z',
    },
  };

  const ex = buildRaviaExport(doc);
  const geo = ex.geometry;
  check('Die Rohgeometrie trägt das Grundstück', Boolean(geo.site), true);
  check('… mit allen Geländeobjekten', Object.keys(geo.site?.elements ?? {}).length, 2);
  check('… und die Grenze ist noch eine Fläche', geo.site?.elements?.grenze?.points.length ?? 0, 4);
  check('… die Bodenart reist mit', geo.site?.soil, doc.site.soil);
  check('Handnotizen reisen mit', geo.freihand?.length ?? 0, 1);
  check('… mit ihren Punkten', geo.freihand?.[0]?.punkte.length ?? 0, 2);

  // Der Weg durch die Datei: was JSON.stringify nicht mitnimmt, ist weg.
  const zurueck = JSON.parse(JSON.stringify(ex)) as typeof ex;
  check('Das Grundstück übersteht die Datei', Object.keys(zurueck.geometry.site?.elements ?? {}).length, 2);
  check('Die Notiz übersteht die Datei', zurueck.geometry.freihand?.length ?? 0, 1);

  // Gegenprobe: ein Modell ohne Gelände darf keine erfundenen Objekte
  // mitschicken — und keine leere Notizliste, die nach Inhalt aussieht.
  const leer = buildRaviaExport(baueHaus({ gelaende: 0 }));
  check('Ohne Geländeobjekte bleibt die Sammlung leer', Object.keys(leer.geometry.site?.elements ?? {}).length, 0);
  check('Ohne Notizen steht kein Notizfeld da', leer.geometry.freihand === undefined, true);
}
