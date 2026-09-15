/**
 * Prüfblock „U-Wert-Quelle" — woher jede Zahl im Export stammt.
 *
 * **Warum es diesen Block gibt.** `uwert.ts` kennt die Herkunft eines U-Werts
 * seit 1.23.0 — Aufbau, Bauteil, Katalog, fehlt — und der Export hat sie bis
 * 1.27.0 weggeworfen: `uWertWand(...).wert` nahm die Zahl und ließ die
 * Auskunft liegen. Auf der Gegenseite kam damit eine Heizlast an, bei der eine
 * geöffnete Außenwand und ein geschätzter Katalogwert gleich aussehen. Das ist
 * rechnerisch dasselbe und fachlich etwas völlig anderes; im Förderverfahren
 * ist es der Unterschied zwischen einer Berechnung, die man verteidigen kann,
 * und einer, die man nur behaupten kann.
 *
 * **Was hier geprüft wird.** Nicht, ob eine Zahl stimmt — das tun
 * `pruefungen/uwert.ts` und der Übergabeblock. Geprüft wird die *Zuordnung*:
 * dass jede Fläche und jede Öffnung eine Quelle trägt, dass die Rangfolge
 * Aufbau → Bauteil → Katalog eingehalten wird, und vor allem, dass ein fester
 * Ersatzwert dieses Exports sich auch als `'annahme'` zu erkennen gibt. Eine
 * Annahme, die sich als Katalogwert ausgibt, wäre schlimmer als gar keine
 * Angabe.
 *
 * **Und die Lücke, die dabei auffiel.** Boden und Decke wählten ihren U-Wert
 * mit `??` statt mit `istErfasst`. Ein Aufbau mit `uValue: 0` — so entstehen
 * über `hostPatch` angelegte Aufbauten — verdrängte damit den nächsten Träger,
 * und die Fläche ging mit U = 0 in die Bilanz: sie war dort nicht schlecht
 * gedämmt, sondern gar nicht vorhanden. Für die Wand war genau dieser Fehler
 * 1.23.0 behoben worden, für Boden und Decke nicht. Die Gegenprobe steht in
 * Abschnitt 4.
 */

import type { CheckFn } from './typ';
import type { BimDocument, BimNode, Construction, Level, RaviaExport, Wall } from '../../src/types/bim';
import { emptyPlant, emptySite } from '../../src/lib/plantDefaults';
import { detectRooms } from '../../src/lib/roomDetection';
import { buildRaviaExport } from '../../src/lib/raviaExport';
import { VORGABE_U } from '../../src/lib/uwert';

// ---------------------------------------------------------------------------
// Das Prüfhaus — ein Rechteck 6 × 4 mit vier Außenwänden, ohne Dach.
// ---------------------------------------------------------------------------

const BREITE = 6;
const TIEFE = 4;
const DICKE = 0.3;
const HOEHE = 2.5;

interface Vorgabe {
  /** U-Wert an der Südwand selbst; `undefined` heißt: nicht erfasst. */
  wandU?: number;
  /** Ein Aufbau für die Südwand, mit diesem U-Wert. */
  aufbauU?: number;
  /** U-Wert am Raum (Boden/Decke). */
  raumBodenU?: number;
  raumDeckeU?: number;
  /** U-Wert am Geschoss (Boden/Decke). */
  geschossBodenU?: number;
  geschossDeckeU?: number;
  /**
   * Ein Bodenaufbau **am Geschoss**, mit diesem U-Wert.
   *
   * Der Aufbau hängt am Geschoss und nicht am Raum: ein Boden ist eine
   * Geschossdecke, und die gehört nicht einem Raum. Die Rangfolge lautet
   * deshalb Raumwert, dann Geschossaufbau, dann Geschosswert.
   */
  bodenAufbauU?: number;
}

function baueHaus(v: Vorgabe = {}): BimDocument {
  const nodes: Record<string, BimNode> = {};
  const walls: Record<string, Wall> = {};
  const constructions: Record<string, Construction> = {};

  const p = (name: string, x: number, y: number): string => {
    nodes[name] = { id: name, x, y, levelId: 'eg' };
    return name;
  };
  const sw = p('sw', 0, 0);
  const se = p('se', BREITE, 0);
  const ne = p('ne', BREITE, TIEFE);
  const nw = p('nw', 0, TIEFE);

  if (v.aufbauU !== undefined) {
    constructions['c-wand'] = {
      id: 'c-wand',
      name: 'Prüfaufbau Wand',
      uValue: v.aufbauU,
      layers: [],
    } as unknown as Construction;
  }
  if (v.bodenAufbauU !== undefined) {
    constructions['c-boden'] = {
      id: 'c-boden',
      name: 'Prüfaufbau Boden',
      uValue: v.bodenAufbauU,
      layers: [],
    } as unknown as Construction;
  }

  const wand = (name: string, a: string, b: string, sued: boolean): void => {
    walls[name] = {
      id: name,
      a,
      b,
      levelId: 'eg',
      type: 'exterior',
      thickness: DICKE,
      height: HOEHE,
      layerId: 'layer-walls',
      // Nur die Südwand trägt die Vorgaben; die übrigen drei bleiben ohne
      // jede Angabe und müssen deshalb im Katalog landen.
      ...(sued && v.wandU !== undefined ? { uValue: v.wandU } : {}),
      ...(sued && v.aufbauU !== undefined ? { constructionId: 'c-wand' } : {}),
    } as Wall;
  };
  wand('w-s', sw, se, true);
  wand('w-e', se, ne, false);
  wand('w-n', ne, nw, false);
  wand('w-w', nw, sw, false);

  const levels: Record<string, Level> = {
    eg: {
      id: 'eg',
      name: 'EG',
      order: 0,
      elevation: 0,
      height: HOEHE,
      floorBoundary: 'ground',
      ceilingBoundary: 'unheated',
      ...(v.geschossBodenU !== undefined ? { floorUValue: v.geschossBodenU } : {}),
      ...(v.geschossDeckeU !== undefined ? { ceilingUValue: v.geschossDeckeU } : {}),
      ...(v.bodenAufbauU !== undefined ? { floorConstructionId: 'c-boden' } : {}),
    } as Level,
  };

  const doc: BimDocument = {
    site: emptySite(),
    plant: emptyPlant(),
    meta: {
      name: 'Prüfhaus U-Wert-Quelle',
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
      ventilation: { kind: 'none', heatRecovery: 0, operation: 'continuous' },
    },
    levels,
    layers: {},
    nodes,
    walls,
    openings: {},
    fixtures: {},
    verticals: {},
    pipes: {},
    annotations: {},
    roofOpenings: {},
    rooms: {},
    constructions,
    diagnostics: { openEnds: [] },
    activeLevelId: 'eg',
  } as BimDocument;

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
    raum.name = 'Wohnen';
    raum.usage = 'living' as never;
    raum.setpointTemperature = 20;
    if (v.raumBodenU !== undefined) raum.floorUValue = v.raumBodenU;
    if (v.raumDeckeU !== undefined) raum.ceilingUValue = v.raumDeckeU;
  }
  return doc;
}

/** Die einzige Raumsicht des Prüfhauses. */
function raum(ex: RaviaExport) {
  return ex.rooms[0];
}

/** Die Fläche mit dieser Kennung — oder eine Marke, die sofort auffällt. */
function quelle(ex: RaviaExport, id: string): string {
  const f = raum(ex).surfaces.find((s) => s.id === id);
  return f ? f.uValueSource : `FEHLT:${id}`;
}

function uWert(ex: RaviaExport, id: string): number {
  const f = raum(ex).surfaces.find((s) => s.id === id);
  return f ? f.uValue : -1;
}

export function pruefeUWertQuelle(check: CheckFn): void {
  // === 1 — Jede Fläche und jede Öffnung trägt eine Quelle ==================
  //
  // Das ist die Zusage, auf die sich die Gegenstelle verlässt. Ein einziges
  // Feld ohne Quelle macht das Annahmenverzeichnis unvollständig, und
  // unvollständig ist dort so gut wie gar nicht: Wer eine Tabelle „alle
  // Annahmen" überschreibt, in der eine fehlt, hat schlechter dokumentiert
  // als jemand, der keine führt.
  const voll = buildRaviaExport(baueHaus({ wandU: 0.28 }));
  const erlaubt = new Set(['aufbau', 'bauteil', 'katalog', 'annahme']);
  let ohneQuelle = 0;
  let unbekannt = 0;
  let flaechen = 0;
  for (const r of voll.rooms) {
    for (const f of r.surfaces) {
      flaechen += 1;
      if (f.uValueSource === undefined) ohneQuelle += 1;
      else if (!erlaubt.has(f.uValueSource)) unbekannt += 1;
      for (const o of f.openings) {
        if (o.uValueSource === undefined) ohneQuelle += 1;
        else if (!erlaubt.has(o.uValueSource)) unbekannt += 1;
      }
    }
  }
  // Vier Außenwände, ein Boden, eine Decke.
  check('Das Prüfhaus hat sechs Hüllflächen', flaechen, 6);
  check('Keine Fläche ohne Quelle', ohneQuelle, 0);
  check('Keine unbekannte Quelle', unbekannt, 0);

  // === 2 — Die Rangfolge der Wand: Aufbau vor Bauteil vor Katalog =========
  //
  // Jede Stufe einzeln, und jede mit ihrem Wert, damit ein vertauschtes Paar
  // (richtige Quelle, falscher Wert) nicht durchgeht.
  const nurKatalog = buildRaviaExport(baueHaus());
  check('Ohne jede Angabe: Katalog', quelle(nurKatalog, 'w-s'), 'katalog');
  check('… und zwar der Vorgabewert der Bauteilart', uWert(nurKatalog, 'w-s'), VORGABE_U.exterior);

  const amBauteil = buildRaviaExport(baueHaus({ wandU: 0.28 }));
  check('Wert am Bauteil: Bauteil', quelle(amBauteil, 'w-s'), 'bauteil');
  check('… und der Wert stammt von dort', uWert(amBauteil, 'w-s'), 0.28);

  const mitAufbau = buildRaviaExport(baueHaus({ wandU: 0.28, aufbauU: 0.19 }));
  check('Aufbau schlägt Bauteil', quelle(mitAufbau, 'w-s'), 'aufbau');
  check('… und der Wert kommt aus dem Aufbau', uWert(mitAufbau, 'w-s'), 0.19);

  // Gegenprobe: die drei Wände ohne jede Vorgabe bleiben im Katalog, auch
  // wenn die Südwand einen Aufbau hat. Eine Quelle, die auf das ganze Haus
  // abfärbt, wäre die schlimmste Form von falsch — sie sähe gepflegt aus.
  check('Die Nordwand bleibt trotzdem Katalog', quelle(mitAufbau, 'w-n'), 'katalog');

  // === 3 — Der Ersatzwert gibt sich als Annahme zu erkennen ===============
  //
  // Boden und Decke haben keinen Eintrag in `VORGABE_U`; greift kein Träger,
  // steht ein fester Wert dieses Exports (0,30 bzw. 0,20). Genau diese beiden
  // Zeilen gehören ins Annahmenverzeichnis, und nur wenn sie sich melden,
  // kann die Gegenstelle sie dort hineinschreiben.
  check('Boden ohne Angabe: Annahme', quelle(nurKatalog, `${raum(nurKatalog).id}-floor`), 'annahme');
  check('… mit dem Ersatzwert 0,30', uWert(nurKatalog, `${raum(nurKatalog).id}-floor`), 0.3);
  check('Decke ohne Angabe: Annahme', quelle(nurKatalog, `${raum(nurKatalog).id}-ceiling`), 'annahme');
  check('… mit dem Ersatzwert 0,20', uWert(nurKatalog, `${raum(nurKatalog).id}-ceiling`), 0.2);

  // Rangfolge des Bodens: Raum, dann Aufbau, dann Geschoss.
  const bodenGeschoss = buildRaviaExport(baueHaus({ geschossBodenU: 0.35 }));
  const idG = raum(bodenGeschoss).id;
  check('Boden am Geschoss: Bauteil', quelle(bodenGeschoss, `${idG}-floor`), 'bauteil');
  check('… mit dem Geschosswert', uWert(bodenGeschoss, `${idG}-floor`), 0.35);

  const bodenAufbau = buildRaviaExport(baueHaus({ geschossBodenU: 0.35, bodenAufbauU: 0.22 }));
  const idA = raum(bodenAufbau).id;
  check('Bodenaufbau schlägt den Geschosswert', quelle(bodenAufbau, `${idA}-floor`), 'aufbau');
  check('… mit dem Aufbauwert', uWert(bodenAufbau, `${idA}-floor`), 0.22);

  const bodenRaum = buildRaviaExport(baueHaus({ raumBodenU: 0.41, bodenAufbauU: 0.22 }));
  const idR = raum(bodenRaum).id;
  check('Der Wert am Raum schlägt den Aufbau', quelle(bodenRaum, `${idR}-floor`), 'bauteil');
  check('… mit dem Raumwert', uWert(bodenRaum, `${idR}-floor`), 0.41);

  // === 4 — Die Lücke, die dabei auffiel: uValue 0 ist keine Angabe ========
  //
  // Ein Bodenaufbau mit U = 0 (so entstehen über `hostPatch` angelegte
  // Aufbauten) darf den Geschosswert nicht verdrängen. Mit `??` tat er es,
  // und der Boden ging mit U = 0 in die Bilanz — eine Fläche, die dort nicht
  // schlecht gedämmt, sondern gar nicht vorhanden ist. Für die Wand war
  // genau das 1.23.0 behoben worden, für den Boden nicht.
  const luecke = buildRaviaExport(baueHaus({ bodenAufbauU: 0, geschossBodenU: 0.35 }));
  const idL = raum(luecke).id;
  check('Ein Aufbau mit U = 0 verdrängt nichts', uWert(luecke, `${idL}-floor`), 0.35);
  check('… und die Quelle ist der Träger dahinter', quelle(luecke, `${idL}-floor`), 'bauteil');

  // Dieselbe Probe für die Decke, über den Wert am Raum.
  const deckeLuecke = buildRaviaExport(baueHaus({ raumDeckeU: 0, geschossDeckeU: 0.24 }));
  const idD = raum(deckeLuecke).id;
  check('Eine Decke mit U = 0 am Raum verdrängt nichts', uWert(deckeLuecke, `${idD}-ceiling`), 0.24);
  check('… und die Quelle ist der Träger dahinter', quelle(deckeLuecke, `${idD}-ceiling`), 'bauteil');

  // Und die Wand: sie konnte das schon, hier steht die Gegenprobe, damit sie
  // es nicht wieder verlernt.
  const wandNull = buildRaviaExport(baueHaus({ wandU: 0, aufbauU: 0 }));
  check('Eine Wand mit U = 0 fällt auf den Katalog', uWert(wandNull, 'w-s'), VORGABE_U.exterior);
  check('… und meldet Katalog, nicht Bauteil', quelle(wandNull, 'w-s'), 'katalog');

  // === 5 — Der Weg durch die Datei ========================================
  //
  // Die Quelle ist ein String und kein Objekt; sie muss `JSON.stringify`
  // überstehen. Der Rückweg-Block prüft dasselbe für die Rohgeometrie — ein
  // Feld, das nur im Speicher existiert, hilft der Gegenstelle nicht.
  const zurueck = JSON.parse(JSON.stringify(mitAufbau)) as RaviaExport;
  check('Die Quelle übersteht die Datei', quelle(zurueck, 'w-s'), 'aufbau');
}
