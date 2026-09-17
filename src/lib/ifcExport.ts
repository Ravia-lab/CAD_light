/**
 * IFC4-Export (STEP / ISO-10303-21).
 * ---------------------------------------------------------------------------
 * Das RaVia-JSON ist die Übergabe an die Heizlastberechnung. IFC ist die
 * Übergabe an alles andere: Architektur-CAD, Bauantrag, Fachplanung. Beides
 * nebeneinander zu haben ist kein Luxus — ein Format, das nur ein einziges
 * Programm liest, macht das Modell zur Sackgasse.
 *
 * Geschrieben wird bewusst *direkt* als STEP-Datei statt über eine Bibliothek.
 * Der Grund ist derselbe wie beim Rest dieser Anwendung: eine IFC-Bibliothek
 * bringt mehrere Megabyte WASM mit, für einen Umfang, der hier auf gut
 * dreihundert Zeilen passt. Erzeugt werden:
 *
 *   IfcProject → IfcSite → IfcBuilding → IfcBuildingStorey
 *     ├─ IfcWallStandardCase   (Extrusion des Wandrechtecks)
 *     ├─ IfcWindow / IfcDoor   (mit IfcOpeningElement und Voiding)
 *     ├─ IfcSpace              (Raumpolygon, Fläche, Volumen)
 *     ├─ IfcSlab               (Bodenplatte je Raum)
 *     ├─ IfcRoof               (Dachfläche, sofern definiert)
 *     └─ IfcStair / IfcShaft   (Treppen und Schächte)
 *
 * Geometrie liegt als `IfcExtrudedAreaSolid` über `IfcArbitraryClosedProfileDef`
 * vor — das ist die Form, die jede IFC-Anwendung ohne Sonderbehandlung liest.
 * Einheit ist Meter, das Koordinatensystem entspricht dem Modell (+x Osten,
 * +y Norden, +z aufwärts).
 */

import type { BimDocument, Wall } from '../types/bim';
import { durchbruchWirt } from '../types/bim';
import { deckendurchbruchUmriss } from './durchbruchSymbols';
import { getWallGeometry, openingSpan, indexOpeningsByWall, openingsOf } from './wallGeometry';
import { ERZEUGER, FASSUNG } from './fassung';
import { pointInPolygon } from './geometry';

/** Schreibt STEP-Zeilen und vergibt fortlaufende Entity-IDs. */
class StepWriter {
  private lines: string[] = [];
  private next = 1;

  /** Fügt eine Entity ein und liefert ihre Referenz (`#42`). */
  add(body: string): string {
    const id = this.next++;
    this.lines.push(`#${id}=${body};`);
    return `#${id}`;
  }

  /** Reserviert eine ID vorab — nötig bei zyklischen Verweisen. */
  reserve(): { ref: string; fill: (body: string) => void } {
    const id = this.next++;
    const index = this.lines.length;
    this.lines.push('');
    return {
      ref: `#${id}`,
      fill: (body: string) => {
        this.lines[index] = `#${id}=${body};`;
      },
    };
  }

  body(): string {
    return this.lines.filter(Boolean).join('\n');
  }
}

/**
 * IFC-GUID: 128 Bit, komprimiert auf 22 Zeichen des IFC-Alphabets.
 *
 * Die Kodierung ist nicht frei wählbar: das *erste* Zeichen trägt nur zwei
 * Bit (Werte 0–3), die restlichen 21 je sechs — 2 + 126 … die führenden vier
 * Bit des ersten Zeichens sind immer null. Ein Zufallszeichen an dieser
 * Stelle macht die Datei für jeden Prüfer ungültig.
 *
 * Die 128 Bit stammen aus einem deterministischen Hash des Namens: derselbe
 * Export liefert dieselben GUIDs, damit die Gegenstelle beim erneuten Import
 * die Objekte wiedererkennt statt Dubletten anzulegen.
 */
function ifcGuid(seed: string): string {
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';

  // Vier 32-Bit-Worte per FNV-artigem Hash mit unterschiedlichen Startwerten.
  const words: number[] = [];
  for (const start of [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b]) {
    let h = start >>> 0;
    for (let i = 0; i < seed.length; i++) {
      h = Math.imul(h ^ seed.charCodeAt(i), 0x01000193) >>> 0;
      h = (h ^ (h >>> 15)) >>> 0;
    }
    words.push(h >>> 0);
  }

  // 128 Bit als Bit-Array, höchstwertiges Bit zuerst.
  const bits: number[] = [];
  for (const wv of words) {
    for (let i = 31; i >= 0; i--) bits.push((wv >>> i) & 1);
  }

  // Erstes Zeichen: 2 Bit. Danach 21 Zeichen zu je 6 Bit.
  let out = alphabet[(bits[0] << 1) | bits[1]];
  let pos = 2;
  for (let c = 0; c < 21; c++) {
    let v = 0;
    for (let i = 0; i < 6; i++) v = (v << 1) | bits[pos++];
    out += alphabet[v];
  }
  return out;
}

/**
 * Eine Zeichenkette als STEP-STRING.
 *
 * **Warum das mehr ist als Anführungszeichen drumherum.** ISO 10303-21 lässt
 * in einer Zeichenkette nur druckbares ASCII zu. Ein „ü" ist dort nicht
 * vorgesehen; es wird umschrieben. Bis 1.30.0 hat dieser Export den Umlaut
 * roh als UTF-8 hineingeschrieben — die meisten Betrachter kommen damit
 * zurecht, konform ist es nicht, und ein strenger Prüfer weist die Datei ab.
 *
 * Geschrieben wird jetzt die Form, die auch ArchiCAD benutzt und die der
 * eigene Import seit 1.30.0 liest:
 *
 *     Küche  →  'K\X2\00FC\X0\che'
 *
 * `\X2\` leitet eine Folge von UTF-16-Codeeinheiten in Hexadezimalschrift
 * ein, `\X0\` beendet sie. Aufeinanderfolgende Sonderzeichen kommen in
 * **eine** Folge — dafür ist die Schreibweise gedacht: „Grüße" wird zu
 * `Gr\X2\00FC00DF\X0\e`, weil ü und ß nebeneinanderstehen.
 *
 * **Die Reihenfolge ist zwingend.** Erst der Apostroph (er wird verdoppelt),
 * dann der Rückwärtsstrich (auch), dann die Umschrift. Wer zuletzt die
 * Rückwärtsstriche verdoppelte, zerstörte die eben geschriebene Umschrift:
 * aus `\X2\` würde `\\X2\\`, und der Leser fände einen literalen Text
 * statt eines Umlauts.
 *
 * `charCodeAt` liefert UTF-16-Codeeinheiten — genau das, was `\X2\`
 * erwartet. Ein Zeichen außerhalb der Grundebene (etwa ein Emoji) besteht
 * aus zwei Einheiten und wird als zwei geschrieben; das ist richtig so.
 */
const STEP_SONDERZEICHEN = /[^\x20-\x7E]+/g;

const s = (v: string | undefined): string => {
  if (!v) return '$';
  const roh = v.replace(/'/g, "''").replace(/\\/g, '\\\\');
  const umschrieben = roh.replace(STEP_SONDERZEICHEN, (folge) => {
    let hex = '';
    for (let i = 0; i < folge.length; i += 1) {
      hex += folge.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0');
    }
    return `\\X2\\${hex}\\X0\\`;
  });
  return `'${umschrieben}'`;
};
/**
 * Eine Zahl als STEP-REAL. Der Punkt muss stehen bleiben: `1` ist in
 * ISO 10303-21 ein INTEGER und an einer REAL-Stelle schlicht ungültig —
 * geschrieben wird `1.`. Genau daran scheitern selbstgebaute IFC-Dateien
 * am häufigsten, weil die meisten Betrachter es stillschweigend verzeihen
 * und erst der Prüfer es meldet.
 */
const n = (v: number): string => {
  if (!Number.isFinite(v)) return '0.';
  const fixed = v.toFixed(6).replace(/0+$/, '');
  return fixed.endsWith('.') ? fixed : fixed;
};

export interface IfcExportOptions {
  /** Datum im ISO-Format; wird im Header hinterlegt. */
  timestamp?: string;
  author?: string;
}

export function buildIfc(doc: BimDocument, options: IfcExportOptions = {}): string {
  // Einmal indizieren; die Wandschleife unten fragt sonst je Wand die ganze
  // Öffnungsliste ab.
  const openingIndex = indexOpeningsByWall(Object.values(doc.openings));
  const w = new StepWriter();
  const stamp = options.timestamp ?? new Date().toISOString();

  // --- Einheiten und Kontext -------------------------------------------------
  const metre = w.add("IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)");
  const squareMetre = w.add("IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)");
  const cubicMetre = w.add("IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)");
  const radian = w.add("IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.)");
  const units = w.add(`IFCUNITASSIGNMENT((${[metre, squareMetre, cubicMetre, radian].join(',')}))`);

  const origin = w.add('IFCCARTESIANPOINT((0.,0.,0.))');
  const dirZ = w.add('IFCDIRECTION((0.,0.,1.))');
  const dirX = w.add('IFCDIRECTION((1.,0.,0.))');
  const placement3d = w.add(`IFCAXIS2PLACEMENT3D(${origin},${dirZ},${dirX})`);
  const worldPlacement = w.add(`IFCLOCALPLACEMENT($,${placement3d})`);

  const context = w.add(
    `IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,${placement3d},$)`,
  );
  const bodyContext = w.add(
    `IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,${context},$,.MODEL_VIEW.,$)`,
  );

  const person = w.add(`IFCPERSON($,${s(options.author ?? 'RaVia CAD Light')},$,$,$,$,$,$)`);
  const org = w.add("IFCORGANIZATION($,'RaVia',$,$,$)");
  const personOrg = w.add(`IFCPERSONANDORGANIZATION(${person},${org},$)`);
  const application = w.add(
    `IFCAPPLICATION(${org},'${FASSUNG}','RaVia CAD Light','RAVIA-CAD-LIGHT')`,
  );
  const seconds = Math.floor(new Date(stamp).getTime() / 1000) || 0;
  const ownerHistory = w.add(
    `IFCOWNERHISTORY(${personOrg},${application},$,.ADDED.,$,$,$,${seconds})`,
  );

  const own = (name: string) => `${s(ifcGuid(name))},${ownerHistory}`;

  // --- Projektstruktur -------------------------------------------------------
  const project = w.reserve();
  const site = w.add(
    `IFCSITE(${own(`site-${doc.meta.name}`)},'Grundstueck',$,$,${worldPlacement},$,$,.ELEMENT.,$,$,$,$,$)`,
  );
  const building = w.add(
    `IFCBUILDING(${own(`building-${doc.meta.name}`)},${s(doc.meta.name)},$,$,${worldPlacement},$,$,.ELEMENT.,$,$,$)`,
  );

  project.fill(
    `IFCPROJECT(${own(`project-${doc.meta.name}`)},${s(doc.meta.name)},$,$,$,$,(${context}),${units})`,
  );

  w.add(`IFCRELAGGREGATES(${own('agg-project')},$,$,${project.ref},(${site}))`);
  w.add(`IFCRELAGGREGATES(${own('agg-site')},$,$,${site},(${building}))`);

  // --- Geschosse -------------------------------------------------------------
  const levels = Object.values(doc.levels).sort((a, b) => a.order - b.order);
  const storeyRefs: string[] = [];

  for (const [levelIndex, level] of levels.entries()) {
    const lp = w.add(`IFCCARTESIANPOINT((0.,0.,${n(level.elevation)}))`);
    const lax = w.add(`IFCAXIS2PLACEMENT3D(${lp},${dirZ},${dirX})`);
    const lplace = w.add(`IFCLOCALPLACEMENT(${worldPlacement},${lax})`);
    const storey = w.add(
      `IFCBUILDINGSTOREY(${own(`storey-${level.id}`)},${s(level.name)},$,$,${lplace},$,$,.ELEMENT.,${n(level.elevation)})`,
    );
    storeyRefs.push(storey);

    const products: string[] = [];

    // --- Wände ---------------------------------------------------------------
    //
    // Die Wandkennungen werden gemerkt: die Durchbrüche weiter unten müssen
    // sie wiederfinden, um sich aus der Wand schneiden zu lassen, und ein
    // zweiter Durchlauf über alle Wände nur dafür wäre Verschwendung.
    const wallEntities = new Map<string, string>();
    const roomSlabs = new Map<string, string>();
    for (const wall of Object.values(doc.walls)) {
      if (wall.levelId !== level.id) continue;
      const g = getWallGeometry(wall, doc.nodes);
      if (!g) continue;

      const solid = extrudedRectangle(w, bodyContext, dirZ, dirX, g, wall.thickness, wall.height);
      const shape = w.add(
        `IFCSHAPEREPRESENTATION(${bodyContext},'Body','SweptSolid',(${solid}))`,
      );
      const product = w.add(`IFCPRODUCTDEFINITIONSHAPE($,$,(${shape}))`);
      const wallEntity = w.add(
        `IFCWALLSTANDARDCASE(${own(`wall-${wall.id}`)},${s(wallName(wall))},$,$,${lplace},${product},$,.STANDARD.)`,
      );
      products.push(wallEntity);
      wallEntities.set(wall.id, wallEntity);

      // --- Öffnungen ---------------------------------------------------------
      for (const op of openingsOf(openingIndex, wall.id)) {
        const span = openingSpan(g, op);
        const mid = (span.from + span.to) / 2;
        const centre = { x: g.a.x + g.dir.x * mid, y: g.a.y + g.dir.y * mid };
        const opSolid = extrudedBox(
          w,
          bodyContext,
          dirZ,
          dirX,
          centre,
          Math.atan2(g.dir.y, g.dir.x),
          op.width,
          wall.thickness + 0.02,
          op.sillHeight,
          op.height,
        );
        const opShape = w.add(
          `IFCSHAPEREPRESENTATION(${bodyContext},'Body','SweptSolid',(${opSolid}))`,
        );
        const opProduct = w.add(`IFCPRODUCTDEFINITIONSHAPE($,$,(${opShape}))`);
        const openingEntity = w.add(
          `IFCOPENINGELEMENT(${own(`opening-${op.id}`)},'Oeffnung',$,$,${lplace},${opProduct},$,.OPENING.)`,
        );
        w.add(
          `IFCRELVOIDSELEMENT(${own(`void-${op.id}`)},$,$,${wallEntity},${openingEntity})`,
        );

        // Durchgänge bleiben ein reines Loch — sie bekommen kein Bauteil.
        if (op.kind === 'passage') continue;

        const fillEntity =
          op.kind === 'window'
            ? w.add(
                `IFCWINDOW(${own(`window-${op.id}`)},'Fenster',$,$,${lplace},$,$,${n(op.height)},${n(op.width)},$,$,$)`,
              )
            : w.add(
                `IFCDOOR(${own(`door-${op.id}`)},'Tuer',$,$,${lplace},$,$,${n(op.height)},${n(op.width)},$,$,$)`,
              );
        w.add(`IFCRELFILLSELEMENT(${own(`fill-${op.id}`)},$,$,${openingEntity},${fillEntity})`);
        products.push(fillEntity);
      }
    }

    // --- Räume und Bodenplatten ----------------------------------------------
    for (const room of Object.values(doc.rooms)) {
      if (room.levelId !== level.id || room.innerPolygon.length < 3) continue;

      const spaceSolid = extrudedPolygon(w, dirZ, dirX, room.innerPolygon, 0, room.height);
      const spaceShape = w.add(
        `IFCSHAPEREPRESENTATION(${bodyContext},'Body','SweptSolid',(${spaceSolid}))`,
      );
      const spaceProduct = w.add(`IFCPRODUCTDEFINITIONSHAPE($,$,(${spaceShape}))`);
      const space = w.add(
        `IFCSPACE(${own(`space-${room.id}`)},${s(room.name)},$,$,${lplace},${spaceProduct},${s(room.name)},.ELEMENT.,.INTERNAL.,${n(level.elevation)})`,
      );
      products.push(space);

      // Fläche und Volumen als Mengen — das ist es, was eine Gegenstelle
      // aus einem IfcSpace tatsächlich ausliest.
      const areaQ = w.add(`IFCQUANTITYAREA('NetFloorArea',$,${squareMetre},${n(room.area)},$)`);
      const volQ = w.add(`IFCQUANTITYVOLUME('NetVolume',$,${cubicMetre},${n(room.volume)},$)`);
      const heightQ = w.add(`IFCQUANTITYLENGTH('Height',$,${metre},${n(room.height)},$)`);
      const quantities = w.add(
        `IFCELEMENTQUANTITY(${own(`qty-${room.id}`)},'BaseQuantities',$,$,(${[areaQ, volQ, heightQ].join(',')}))`,
      );
      w.add(
        `IFCRELDEFINESBYPROPERTIES(${own(`qtyrel-${room.id}`)},$,$,(${space}),${quantities})`,
      );

      const slabSolid = extrudedPolygon(w, dirZ, dirX, room.innerPolygon, -0.2, 0.2);
      const slabShape = w.add(
        `IFCSHAPEREPRESENTATION(${bodyContext},'Body','SweptSolid',(${slabSolid}))`,
      );
      const slabProduct = w.add(`IFCPRODUCTDEFINITIONSHAPE($,$,(${slabShape}))`);
      const slabEntity = w.add(
        `IFCSLAB(${own(`slab-${room.id}`)},'Bodenplatte',$,$,${lplace},${slabProduct},$,.FLOOR.)`,
      );
      products.push(slabEntity);
      roomSlabs.set(room.id, slabEntity);
    }

    // --- Deckendurchbrüche ----------------------------------------------------
    //
    // Ein Deckendurchbruch gehört dem Geschoss *unter* der Decke — geschnitten
    // wird er aber aus der Platte, auf der das Geschoss *darüber* steht. Er
    // wird deshalb hier bearbeitet, im Durchlauf des oberen Geschosses: nur
    // dort existiert die Platte, aus der das Loch entsteht. Wer ihn eine
    // Schleife früher schnitte, bekäme ein Loch im falschen Bauteil.
    const darunter = levelIndex > 0 ? levels[levelIndex - 1] : undefined;
    if (darunter) {
      for (const db of Object.values(doc.durchbrueche ?? {})) {
        if (db.levelId !== darunter.id) continue;
        if (durchbruchWirt(db.kind) !== 'decke' || !db.position) continue;
        const raum = Object.values(doc.rooms).find(
          (r) =>
            r.levelId === level.id &&
            r.innerPolygon.length >= 3 &&
            pointInPolygon(db.position as { x: number; y: number }, r.innerPolygon),
        );
        const platte = raum ? roomSlabs.get(raum.id) : undefined;
        // Ohne Platte kein Loch. Ein Durchbruch über freiem Feld ist kein
        // Fehler des Exports, sondern eine Aussage des Modells — die Prüfung
        // sagt es, nicht die IFC-Datei.
        if (!platte) continue;
        const umriss = deckendurchbruchUmriss(db);
        if (umriss.length < 3) continue;
        const solid = extrudedPolygon(w, dirZ, dirX, umriss, -0.25, 0.5);
        const shape = w.add(`IFCSHAPEREPRESENTATION(${bodyContext},'Body','SweptSolid',(${solid}))`);
        const product = w.add(`IFCPRODUCTDEFINITIONSHAPE($,$,(${shape}))`);
        const entity = w.add(
          `IFCOPENINGELEMENT(${own(`durchbruch-${db.id}`)},${s(db.name)},'Deckendurchbruch',$,${lplace},${product},$,.OPENING.)`,
        );
        w.add(`IFCRELVOIDSELEMENT(${own(`void-db-${db.id}`)},$,$,${platte},${entity})`);
      }
    }

    // --- Durchbrüche in Wänden ------------------------------------------------
    //
    // Genau derselbe Mechanismus wie bei Fenster und Tür: ein
    // IFCOPENINGELEMENT, das per IFCRELVOIDSELEMENT aus der Wand geschnitten
    // wird. Was fehlt, ist das IFCRELFILLSELEMENT — ein Durchbruch bekommt
    // kein Bauteil, er bleibt ein Loch. Wer ein Schott als Bauteil erwartet,
    // findet es im Massenauszug; in der Geometrie steht es nicht, weil seine
    // Bauart erst der Ausführende festlegt.
    //
    // `.RECESS.` statt `.OPENING.` beim Schlitz: ein Wandschlitz geht nicht
    // durch, er ist eine Vertiefung. Der Unterschied steht in IFC4 und wird
    // von jedem Empfänger ausgewertet, der Massen rechnet.
    for (const db of Object.values(doc.durchbrueche ?? {})) {
      if (db.levelId !== level.id) continue;
      if (durchbruchWirt(db.kind) !== 'wand' || !db.wallId) continue;
      const wall = doc.walls[db.wallId];
      const wallEntity = wallEntities.get(db.wallId);
      if (!wall || !wallEntity) continue;
      const g = getWallGeometry(wall, doc.nodes);
      if (!g) continue;
      const breite = db.form === 'rund' ? (db.diameter ?? 0) : (db.width ?? 0);
      const hoch = db.form === 'rund' ? (db.diameter ?? 0) : (db.height ?? 0);
      const unten = db.form === 'rund' ? (db.sillHeight ?? 0) - hoch / 2 : (db.sillHeight ?? 0);
      const u = Math.min(Math.max(db.distance ?? 0, 0), g.length);
      const centre = { x: g.a.x + g.dir.x * u, y: g.a.y + g.dir.y * u };
      const tiefe = db.kind === 'schlitz' ? wall.thickness / 2 : wall.thickness + 0.02;
      const solid = extrudedBox(
        w,
        bodyContext,
        dirZ,
        dirX,
        centre,
        Math.atan2(g.dir.y, g.dir.x),
        breite,
        tiefe,
        unten,
        hoch,
      );
      const shape = w.add(`IFCSHAPEREPRESENTATION(${bodyContext},'Body','SweptSolid',(${solid}))`);
      const product = w.add(`IFCPRODUCTDEFINITIONSHAPE($,$,(${shape}))`);
      const art = db.kind === 'schlitz' ? '.RECESS.' : '.OPENING.';
      const entity = w.add(
        `IFCOPENINGELEMENT(${own(`durchbruch-${db.id}`)},${s(db.name)},'Durchbruch',$,${lplace},${product},$,${art})`,
      );
      w.add(`IFCRELVOIDSELEMENT(${own(`void-db-${db.id}`)},$,$,${wallEntity},${entity})`);
    }

    // --- Treppen und Schächte ------------------------------------------------
    for (const v of Object.values(doc.verticals ?? {})) {
      if (v.levelId !== level.id) continue;
      const solid = extrudedBox(
        w,
        bodyContext,
        dirZ,
        dirX,
        v.position,
        (v.rotation * Math.PI) / 180,
        v.length,
        v.width,
        0,
        level.height,
      );
      const shape = w.add(`IFCSHAPEREPRESENTATION(${bodyContext},'Body','SweptSolid',(${solid}))`);
      const product = w.add(`IFCPRODUCTDEFINITIONSHAPE($,$,(${shape}))`);
      products.push(
        v.kind === 'shaft'
          ? w.add(
              `IFCBUILDINGELEMENTPROXY(${own(`shaft-${v.id}`)},${s(v.name)},'Schacht',$,${lplace},${product},$,.NOTDEFINED.)`,
            )
          : w.add(
              `IFCSTAIR(${own(`stair-${v.id}`)},${s(v.name)},$,$,${lplace},${product},$,.STRAIGHT_RUN_STAIR.)`,
            ),
      );
    }

    // --- Gauben und Dachflächenfenster ----------------------------------------
    // Beide als Proxy mit ihrer Grundrissausdehnung: die exakte Verschneidung
    // mit der Dachfläche gehört in ein Architekturprogramm, die Lage, Größe
    // und Kennzeichnung aber in jede Übergabe.
    for (const o of Object.values(doc.roofOpenings ?? {})) {
      if (o.levelId !== level.id) continue;
      const height = o.kind === 'skylight' ? 0.16 : (o.frontHeight ?? 2.2);
      const zStart = o.kind === 'skylight' ? (level.roof?.kneeHeight ?? 1) : 0;
      const solid = extrudedBox(
        w,
        bodyContext,
        dirZ,
        dirX,
        o.position,
        ((level.roof?.azimuth ?? 0) * Math.PI) / 180,
        o.depth,
        o.width,
        zStart,
        height,
      );
      const shape = w.add(`IFCSHAPEREPRESENTATION(${bodyContext},'Body','SweptSolid',(${solid}))`);
      const product = w.add(`IFCPRODUCTDEFINITIONSHAPE($,$,(${shape}))`);
      products.push(
        o.kind === 'skylight'
          ? w.add(
              `IFCWINDOW(${own(`skylight-${o.id}`)},'Dachflaechenfenster',$,$,${lplace},${product},$,${n(o.depth)},${n(o.width)},$,$,$)`,
            )
          : w.add(
              `IFCBUILDINGELEMENTPROXY(${own(`dormer-${o.id}`)},${s(o.label ?? 'Gaube')},'Gaube',$,${lplace},${product},$,.NOTDEFINED.)`,
            ),
      );
    }

    // --- Dach ----------------------------------------------------------------
    // Als Platte über dem Geschoss: die exakte Schrägenverschneidung gehört
    // in ein Architekturprogramm, die Lage und Ausdehnung aber hierher.
    if (level.roof && level.roof.kind !== 'flat') {
      const outline = roofOutlineOf(doc, level.id);
      if (outline.length >= 3) {
        const solid = extrudedPolygon(w, dirZ, dirX, outline, level.roof.kneeHeight, 0.24);
        const shape = w.add(
          `IFCSHAPEREPRESENTATION(${bodyContext},'Body','SweptSolid',(${solid}))`,
        );
        const product = w.add(`IFCPRODUCTDEFINITIONSHAPE($,$,(${shape}))`);
        products.push(
          w.add(
            `IFCROOF(${own(`roof-${level.id}`)},'Dach',$,$,${lplace},${product},$,.GABLE_ROOF.)`,
          ),
        );
      }
    }

    if (products.length) {
      w.add(
        `IFCRELCONTAINEDINSPATIALSTRUCTURE(${own(`contain-${level.id}`)},$,$,(${products.join(',')}),${storey})`,
      );
    }
  }

  if (storeyRefs.length) {
    w.add(`IFCRELAGGREGATES(${own('agg-building')},$,$,${building},(${storeyRefs.join(',')}))`);
  }

  const header =
    `ISO-10303-21;\nHEADER;\n` +
    `FILE_DESCRIPTION(('ViewDefinition [CoordinationView_V2.0]'),'2;1');\n` +
    // Auch der Kopf ist STEP und nicht Freitext: `s()` schreibt hier
    // dieselbe Umschrift wie im Rumpf. Der Dateiname ging bis 1.30.0 roh
    // hinein — an einem Projekt namens „Küche" stand damit ein Umlaut in
    // der zweiten Zeile der Datei, noch vor allem anderen.
    `FILE_NAME(${s(`${doc.meta.name}.ifc`)},'${stamp}',('RaVia CAD Light'),('RaVia'),` +
    `${s(ERZEUGER)},'RaVia CAD Light','');\n` +
    `FILE_SCHEMA(('IFC4'));\nENDSEC;\nDATA;\n`;

  return `${header}${w.body()}\nENDSEC;\nEND-ISO-10303-21;\n`;
}

// ---------------------------------------------------------------------------
// Geometrie-Bausteine
// ---------------------------------------------------------------------------

/** Wandkörper: Rechteckprofil längs der Wandachse, nach oben extrudiert. */
function extrudedRectangle(
  w: StepWriter,
  _ctx: string,
  dirZ: string,
  dirX: string,
  g: { a: { x: number; y: number }; dir: { x: number; y: number }; length: number },
  thickness: number,
  height: number,
): string {
  const centre = {
    x: g.a.x + g.dir.x * (g.length / 2),
    y: g.a.y + g.dir.y * (g.length / 2),
  };
  return extrudedBox(w, _ctx, dirZ, dirX, centre, Math.atan2(g.dir.y, g.dir.x), g.length, thickness, 0, height);
}

/** Quader aus Rechteckprofil, gedreht und angehoben. */
function extrudedBox(
  w: StepWriter,
  _ctx: string,
  dirZ: string,
  _dirX: string,
  centre: { x: number; y: number },
  angle: number,
  length: number,
  width: number,
  zStart: number,
  height: number,
): string {
  const p2d = w.add('IFCCARTESIANPOINT((0.,0.))');
  const d2d = w.add(`IFCDIRECTION((${n(Math.cos(angle))},${n(Math.sin(angle))}))`);
  const place2d = w.add(`IFCAXIS2PLACEMENT2D(${p2d},${d2d})`);
  const profile = w.add(
    `IFCRECTANGLEPROFILEDEF(.AREA.,$,${place2d},${n(Math.max(length, 1e-4))},${n(Math.max(width, 1e-4))})`,
  );
  const base = w.add(`IFCCARTESIANPOINT((${n(centre.x)},${n(centre.y)},${n(zStart)}))`);
  const axis = w.add(`IFCAXIS2PLACEMENT3D(${base},${dirZ},$)`);
  return w.add(
    `IFCEXTRUDEDAREASOLID(${profile},${axis},${dirZ},${n(Math.max(height, 1e-4))})`,
  );
}

/** Beliebiges geschlossenes Polygon, nach oben extrudiert. */
function extrudedPolygon(
  w: StepWriter,
  dirZ: string,
  _dirX: string,
  polygon: readonly { x: number; y: number }[],
  zStart: number,
  height: number,
): string {
  const pts = polygon.map((p) => w.add(`IFCCARTESIANPOINT((${n(p.x)},${n(p.y)}))`));
  // IFC verlangt das Startpunkt-Duplikat am Ende der Polylinie.
  const line = w.add(`IFCPOLYLINE((${[...pts, pts[0]].join(',')}))`);
  const profile = w.add(`IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,${line})`);
  const base = w.add(`IFCCARTESIANPOINT((0.,0.,${n(zStart)}))`);
  const axis = w.add(`IFCAXIS2PLACEMENT3D(${base},${dirZ},$)`);
  return w.add(`IFCEXTRUDEDAREASOLID(${profile},${axis},${dirZ},${n(Math.max(height, 1e-4))})`);
}

/**
 * Umriss eines Geschosses aus den Achspolygonen seiner Räume.
 *
 * Hat das Geschoss selbst keine Räume — der übliche Fall beim reinen
 * Dachgeschoss, in dem noch nichts gezeichnet ist —, wird der Umriss des
 * darunterliegenden Geschosses genommen. Das Dach sitzt schließlich über dem
 * Gebäude, nicht über der gezeichneten Fläche.
 */
function roofOutlineOf(doc: BimDocument, levelId: string): { x: number; y: number }[] {
  let rooms = Object.values(doc.rooms).filter((r) => r.levelId === levelId);
  if (!rooms.length) {
    const levels = Object.values(doc.levels).sort((a, b) => a.order - b.order);
    const index = levels.findIndex((l) => l.id === levelId);
    for (let i = index - 1; i >= 0 && !rooms.length; i--) {
      rooms = Object.values(doc.rooms).filter((r) => r.levelId === levels[i].id);
    }
  }
  if (!rooms.length) return [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rooms) {
    for (const p of r.polygon) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  if (!Number.isFinite(minX)) return [];
  const o = 0.4;
  return [
    { x: minX - o, y: minY - o },
    { x: maxX + o, y: minY - o },
    { x: maxX + o, y: maxY + o },
    { x: minX - o, y: maxY + o },
  ];
}

function wallName(wall: Wall): string {
  const type =
    wall.type === 'exterior'
      ? 'Außenwand'
      : wall.type === 'interior'
        ? 'Innenwand'
        : wall.type === 'partition'
          ? 'Trennwand'
          : 'Schachtwand';
  return `${type} ${(wall.thickness * 100).toFixed(1)} cm`;
}

/** Lädt die IFC-Datei im Browser herunter. */
export function downloadIfc(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'application/x-step;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ifcFilename(projectName: string): string {
  const safe = projectName.replace(/[^\w äöüÄÖÜß-]/g, '').trim() || 'projekt';
  return `${safe.replace(/\s+/g, '_')}.ifc`;
}
