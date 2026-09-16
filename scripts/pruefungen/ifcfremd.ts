/**
 * Prüfblock „Fremde IFC-Dateien" — was aus dem Architekturprogramm ankommt.
 * ---------------------------------------------------------------------------
 * Der bestehende IFC-Prüfblock in `verify.ts` führt einen **Rundlauf**: er
 * schreibt mit `buildIfc` eine Datei und liest sie mit `importIfc` zurück.
 * Das beweist, dass die beiden zueinander passen — und genau darin liegt
 * seine blinde Stelle. Ein Rundlauf kann nur die Schreibweisen prüfen, die
 * der eigene Export erzeugt. Was ein fremdes Programm schreibt, kommt darin
 * nie vor.
 *
 * Aufgefallen ist das am **FZK-Haus des KIT** (ArchiCAD 20, IFC4), einer der
 * verbreitetsten offenen Beispieldateien. Der Import meldete
 *
 *     „9 Wände, 14 Öffnungen und 2 Geschoss(e) gelesen"
 *
 * — und das las sich wie ein Erfolg. In der Datei stehen 13 Wände. Die vier
 * fehlenden waren `Wand-Ext-OG-1..4`: das **gesamte Obergeschoss**. Dazu
 * kamen alle neun importierten Wände als *Außenwand* an, auch die fünf, die
 * in der Datei `Wand-Int-ERDG-1..5` heißen.
 *
 * Dieser Block hält die drei Ursachen fest, jede an einem eigenen Fall:
 *
 *  1. **Beschnittene Körper.** Eine Wand unter einer Dachschräge steht nicht
 *     als `IfcExtrudedAreaSolid` in der Datei, sondern als
 *     `IfcBooleanClippingResult`, oft zweifach geschachtelt. Wer nur nach der
 *     Extrusion sucht, verliert sie. → Wand D.
 *  2. **Wandart aus der Dicke geraten.** Am FZK-Haus sind die Innenwände
 *     24,0 cm dick, die Außenwände 30,0 cm. Die Regel „ab 24 cm ist es außen"
 *     macht damit jede Innenwand zur Außenwand. IFC führt die Antwort selbst:
 *     `Pset_WallCommon.IsExternal`. → Wände B, C, E, F.
 *  3. **Deckendurchbruch als Verlust gemeldet.** Die Treppenöffnung liegt in
 *     einem `IfcSlab`, nicht in einer Wand. Dass CAD Light sie nicht
 *     übernimmt, ist richtig — „Öffnung ohne zugehörige Wand" zu melden war
 *     es nicht. → Deckendurchbruch.
 *
 * **Warum die Datei hier erzeugt und nicht mitgeliefert wird.** Die echten
 * Dateien sind 2,5 und 10,8 MB groß und stehen unter fremder Lizenz. Geprüft
 * werden muss aber nicht die Datei, sondern die *Schreibweise*. Die steht
 * hier in sieben Zeilen, jede mit einer Absicht, und jede erwartete Zahl ist
 * darunter von Hand ausgerechnet. Die echten Dateien bleiben die Gegenprobe
 * von Hand; dieser Block ist das Gedächtnis.
 */

import type { CheckFn } from './typ';
import { importIfc } from '../../src/lib/ifcImport';
import { detectRooms } from '../../src/lib/roomDetection';
import { ordneRaumnamenZu } from '../../src/lib/raumnutzung';
import type { BimNode } from '../../src/types/bim';

/** Eine Zahl so schreiben, wie STEP sie erwartet (mit Dezimalpunkt). */
const z = (v: number) => (Number.isInteger(v) ? `${v}.` : `${v}`);

interface WandVorgabe {
  name: string;
  dicke: number;
  hoehe: number;
  /** Anfang und Ende der Bezugslinie in Weltkoordinaten [m]. */
  von: [number, number];
  bis: [number, number];
  /** Wie viele Boolesche Schnitte über der Extrusion liegen. */
  schnitte?: number;
  /** `IsExternal` im Property-Set; `'U'` schreibt `.U.` (unbekannt). */
  aussen?: boolean | 'U';
  /** Erzeugt einen Körper, der sich selbst als ersten Operanden nennt. */
  ringschluss?: boolean;
  /**
   * Schreibt zusätzlich eine `Axis`-Repräsentation — die *Bezugslinie*.
   * Ohne sie liest der Import die Körpermitte, mit ihr die Bezugslinie.
   */
  achse?: boolean;
  /**
   * Versatz des Körpers gegenüber der Bezugslinie, quer zur Wand, positiv
   * nach links in Laufrichtung [m]. ArchiCAD schreibt für das FZK-Haus die
   * halbe Wanddicke, weil die Bezugslinie dort auf der Außenfläche liegt.
   */
  versatz?: number;
}

/**
 * Baut eine kleine, aber wohlgeformte IFC4-Datei.
 *
 * Kein Zufall und keine Schleifenmagie: jede Wand steht als eigener Eintrag
 * in `vorgaben`, und die Nummerierung übernimmt derselbe fortlaufende Zähler,
 * den auch `ifcExport.ts` benutzt. Von Hand durchnummerierte Referenzen wären
 * bei fünfzig Entities die wahrscheinlichste Fehlerquelle dieses Blocks.
 */
/** Ein benannter Raum, wie ihn der Architekt in die Datei schreibt. */
interface RaumVorgabe {
  /** Kommt als `LongName` in die Datei — dort steht der sprechende Name. */
  langname: string;
  /** `Name` — bei ArchiCAD oft nur eine Nummer. */
  kurzname?: string;
  /** Umriss in Weltkoordinaten. */
  umriss: Array<[number, number]>;
  /** Als `FootPrint` (Vorgabe) oder als Extrusionskörper schreiben. */
  alsKoerper?: boolean;
}

function baueDatei(vorgaben: WandVorgabe[], raeume: RaumVorgabe[] = []): string {
  let n = 0;
  const zeilen: string[] = [];
  const e = (text: string) => {
    n += 1;
    zeilen.push(`#${n}=${text};`);
    return n;
  };

  const dirZ = e('IFCDIRECTION((0.,0.,1.))');
  const dirX = e('IFCDIRECTION((1.,0.,0.))');
  const dirX2 = e('IFCDIRECTION((1.,0.))');
  const nullpunkt = e('IFCCARTESIANPOINT((0.,0.,0.))');
  const weltachse = e(`IFCAXIS2PLACEMENT3D(#${nullpunkt},#${dirZ},#${dirX})`);
  const weltlage = e(`IFCLOCALPLACEMENT($,#${weltachse})`);
  e(`IFCPROJECT('0Projekt00000000000000',$,'Klippenhaus',$,$,$,$,$,$)`);
  const geschoss = e(
    `IFCBUILDINGSTOREY('0Geschoss000000000000',$,'Erdgeschoss',$,$,#${weltlage},$,$,.ELEMENT.,0.)`,
  );

  /** Ein Volumenkörper mit optionalen Booleschen Schnitten darüber. */
  const koerper = (
    laenge: number,
    dicke: number,
    hoehe: number,
    v: { schnitte?: number; ringschluss?: boolean; versatz?: number },
  ) => {
    // Der Profilmittelpunkt liegt in lokalen Koordinaten: x längs der Wand,
    // y quer dazu. Ein Versatz in y schiebt den Körper von der Bezugslinie
    // weg — genau das, was ArchiCAD mit `.NEGATIVE., 0.` erzeugt.
    const profilpunkt = e(`IFCCARTESIANPOINT((${z(laenge / 2)},${z(v.versatz ?? 0)}))`);
    const profilachse = e(`IFCAXIS2PLACEMENT2D(#${profilpunkt},#${dirX2})`);
    const profil = e(
      `IFCRECTANGLEPROFILEDEF(.AREA.,$,#${profilachse},${z(laenge)},${z(dicke)})`,
    );
    const solidachse = e(`IFCAXIS2PLACEMENT3D(#${nullpunkt},#${dirZ},#${dirX})`);
    const solid = e(
      `IFCEXTRUDEDAREASOLID(#${profil},#${solidachse},#${dirZ},${z(hoehe)})`,
    );

    // Der Ringschluss ist kein realer Dateiinhalt, sondern die Probe darauf,
    // dass die Rekursion auch eine kaputte Datei beendet: der erste Operand
    // zeigt auf die Verknüpfung selbst.
    if (v.ringschluss) {
      const ebene = e(`IFCPLANE(#${weltachse})`);
      const halbraum = e(`IFCHALFSPACESOLID(#${ebene},.F.)`);
      const selbst = n + 1;
      return e(`IFCBOOLEANCLIPPINGRESULT(.DIFFERENCE.,#${selbst},#${halbraum})`);
    }

    let oben = solid;
    for (let i = 0; i < (v.schnitte ?? 0); i += 1) {
      const ebene = e(`IFCPLANE(#${weltachse})`);
      const halbraum = e(`IFCHALFSPACESOLID(#${ebene},.F.)`);
      oben = e(`IFCBOOLEANCLIPPINGRESULT(.DIFFERENCE.,#${oben},#${halbraum})`);
    }
    return oben;
  };

  const waende: number[] = [];
  const psets: Array<{ wand: number; wert: boolean | 'U' }> = [];

  for (const v of vorgaben) {
    const dx = v.bis[0] - v.von[0];
    const dy = v.bis[1] - v.von[1];
    const laenge = Math.hypot(dx, dy);
    // Die Wand steht in ihrem eigenen Koordinatensystem: Ursprung am
    // Anfang der Bezugslinie, lokale x-Achse längs der Wand.
    const richtung = e(`IFCDIRECTION((${z(dx / laenge)},${z(dy / laenge)},0.))`);
    const punkt = e(`IFCCARTESIANPOINT((${z(v.von[0])},${z(v.von[1])},0.))`);
    const achse = e(`IFCAXIS2PLACEMENT3D(#${punkt},#${dirZ},#${richtung})`);
    const lage = e(`IFCLOCALPLACEMENT($,#${achse})`);
    const item = koerper(laenge, v.dicke, v.hoehe, v);
    const art = (v.schnitte ?? 0) > 0 || v.ringschluss ? 'Clipping' : 'SweptSolid';
    const reps = [e(`IFCSHAPEREPRESENTATION($,'Body','${art}',(#${item}))`)];
    if (v.achse) {
      const a0 = e('IFCCARTESIANPOINT((0.,0.))');
      const a1 = e(`IFCCARTESIANPOINT((${z(laenge)},0.))`);
      const linie = e(`IFCPOLYLINE((#${a0},#${a1}))`);
      reps.push(e(`IFCSHAPEREPRESENTATION($,'Axis','Curve2D',(#${linie}))`));
    }
    const pds = e(`IFCPRODUCTDEFINITIONSHAPE($,$,(${reps.map((r) => `#${r}`).join(',')}))`);
    const wand = e(
      `IFCWALLSTANDARDCASE('0Wand${String(waende.length).padStart(18, '0')}',$,'${v.name}',$,$,#${lage},#${pds},$)`,
    );
    waende.push(wand);
    if (v.aussen !== undefined) psets.push({ wand, wert: v.aussen });
  }

  // Decke mit Treppendurchbruch — die Öffnung sitzt bewusst in einem
  // IfcSlab, nicht in einer Wand.
  const deckenlage = e(`IFCLOCALPLACEMENT($,#${weltachse})`);
  const decke = e(`IFCSLAB('0Decke0000000000000000',$,'Geschossdecke',$,$,#${deckenlage},$,$,.FLOOR.)`);
  const durchbruchItem = koerper(1.2, 3.0, 0.25, {});
  const durchbruchRep = e(`IFCSHAPEREPRESENTATION($,'Body','SweptSolid',(#${durchbruchItem}))`);
  const durchbruchPds = e(`IFCPRODUCTDEFINITIONSHAPE($,$,(#${durchbruchRep}))`);
  const durchbruch = e(
    `IFCOPENINGELEMENT('0Durchbruch0000000000',$,'Treppenauge',$,$,#${deckenlage},#${durchbruchPds},$)`,
  );
  e(`IFCRELVOIDSELEMENT('0Voids00000000000000A',$,$,$,#${decke},#${durchbruch})`);

  for (const p of psets) {
    const wert =
      p.wert === 'U' ? 'IFCLOGICAL(.U.)' : `IFCBOOLEAN(${p.wert ? '.T.' : '.F.'})`;
    const prop = e(`IFCPROPERTYSINGLEVALUE('IsExternal',$,${wert},$)`);
    const pset = e(`IFCPROPERTYSET('0Pset${String(p.wand).padStart(18, '0')}',$,'Pset_WallCommon',$,(#${prop}))`);
    e(`IFCRELDEFINESBYPROPERTIES('0Defines${String(p.wand).padStart(15, '0')}',$,$,$,(#${p.wand}),#${pset})`);
  }

  e(
    `IFCRELCONTAINEDINSPATIALSTRUCTURE('0Enthalten00000000000',$,$,$,(${waende
      .map((w) => `#${w}`)
      .join(',')}),#${geschoss})`,
  );

  // --- Räume ----------------------------------------------------------------
  // Der Raum hängt über `IfcRelAggregates` am Geschoss, nicht über
  // `IfcRelContainedInSpatialStructure` — ein Geschoss *besteht aus* seinen
  // Räumen, es enthält sie nicht wie ein Bauteil. Beide Testdateien des KIT
  // schreiben es so.
  const raumIds: number[] = [];
  for (const r of raeume) {
    const punkte = r.umriss.map((q) => e(`IFCCARTESIANPOINT((${z(q[0])},${z(q[1])}))`));
    const linie = e(`IFCPOLYLINE((${punkte.map((q) => `#${q}`).join(',')},#${punkte[0]}))`);
    let rep: number;
    if (r.alsKoerper) {
      const prof = e(`IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,#${linie})`);
      const solid = e(`IFCEXTRUDEDAREASOLID(#${prof},#${weltachse},#${dirZ},2.5)`);
      rep = e(`IFCSHAPEREPRESENTATION($,'Body','SweptSolid',(#${solid}))`);
    } else {
      const satz = e(`IFCGEOMETRICCURVESET((#${linie}))`);
      rep = e(`IFCSHAPEREPRESENTATION($,'FootPrint','GeometricCurveSet',(#${satz}))`);
    }
    const pds = e(`IFCPRODUCTDEFINITIONSHAPE($,$,(#${rep}))`);
    const lage = e(`IFCLOCALPLACEMENT($,#${weltachse})`);
    raumIds.push(
      e(
        `IFCSPACE('0Raum${String(raumIds.length).padStart(18, '0')}',$,'${r.kurzname ?? ''}',$,$,#${lage},#${pds},'${r.langname}',.ELEMENT.,$,$)`,
      ),
    );
  }
  if (raumIds.length) {
    e(
      `IFCRELAGGREGATES('0Aggregat000000000000',$,$,$,#${geschoss},(${raumIds
        .map((r) => `#${r}`)
        .join(',')}))`,
    );
  }

  return [
    'ISO-10303-21;',
    'HEADER;',
    "FILE_DESCRIPTION((''),'2;1');",
    "FILE_NAME('pruefung','2026-09-16T00:00:00',(''),(''),'','','');",
    "FILE_SCHEMA(('IFC4'));",
    'ENDSEC;',
    'DATA;',
    ...zeilen,
    'ENDSEC;',
    'END-ISO-10303-21;',
    '',
  ].join('\n');
}

export function pruefeIfcFremd(check: CheckFn): void {
  /*
   * Die sieben Wände und was jede prüft.
   *
   *  A „Wand-Ext-A"   15 cm, kein Pset  → Außenwand allein wegen des
   *                                       Namensglieds `Ext`. Die Dicke
   *                                       spräche dagegen (unter 24 cm), und
   *                                       15 cm außen gibt es real kaum —
   *                                       genau deshalb steht sie hier: nur
   *                                       der Name kann dieses Ergebnis
   *                                       erzeugen.
   *  B „Tragwand-B"   30 cm, IsExternal=.F. → Innenwand. Die alte Regel
   *                                       „ab 24 cm außen" hätte Außenwand
   *                                       gesagt; das Pset schlägt sie.
   *  C „Wand-Int-C"   30 cm, kein Pset  → Innenwand allein wegen `Int`.
   *  D „Giebel-D"     30 cm, 2 Schnitte → wird überhaupt gelesen, Höhe ist
   *                                       die ungeschnittene 3,50 m, und es
   *                                       gibt genau einen Hinweis dazu.
   *  E „Schacht-E"    30 cm, IsExternal=.F. → Schachtwand. Der Schacht geht
   *                                       vor, sonst wäre er eine gewöhnliche
   *                                       Innenwand.
   *  F „Mauer-F"      30 cm, IsExternal=.U. → unbekannt ist nicht „innen":
   *                                       es fällt auf die Dicke zurück,
   *                                       also Außenwand.
   *  G „Ring-G"       30 cm, Ringschluss → wird übersprungen, und zwar ohne
   *                                       dass die Prüfung hängen bleibt.
   */
  const w = (name: string, laenge: number, dicke: number, hoehe: number, y: number, rest: Partial<WandVorgabe> = {}): WandVorgabe => ({
    name, dicke, hoehe, von: [0, y], bis: [laenge, y], ...rest,
  });
  const vorgaben: WandVorgabe[] = [
    w('Wand-Ext-A', 6, 0.15, 2.6, 0),
    w('Tragwand-B', 5, 0.3, 2.6, 10, { aussen: false }),
    w('Wand-Int-C', 4, 0.3, 2.6, 20),
    w('Giebel-D', 8, 0.3, 3.5, 30, { schnitte: 2 }),
    w('Schacht-E', 3, 0.3, 2.6, 40, { aussen: false }),
    w('Mauer-F', 2, 0.3, 2.6, 50, { aussen: 'U' }),
    w('Ring-G', 7, 0.3, 2.6, 60, { ringschluss: true }),
  ];

  const text = baueDatei(vorgaben);
  const r = importIfc(text);

  check('Datei gelesen', r.ok, true);
  check('Schema erkannt', r.schema ?? '', 'IFC4');
  check('Ein Geschoss', r.levels.length, 1);

  // Sechs von sieben: G fällt durch den Ringschluss heraus.
  check('Sechs Wände übernommen', r.walls.length, 6);
  // Je Wand zwei Enden, alle mindestens 10 m auseinander — nichts verschmilzt.
  check('Zwölf Knoten', r.nodes.length, 12);

  const nach = (name: string) => {
    const i = vorgaben.findIndex((v) => v.name === name);
    return r.walls[
      vorgaben.slice(0, i).filter((v) => !v.ringschluss).length
    ];
  };

  check('A ist Außenwand (Namensglied Ext)', nach('Wand-Ext-A').type, 'exterior');
  check('A behält 15 cm', nach('Wand-Ext-A').thickness, 0.15, 1e-9);

  check('B ist Innenwand (IsExternal schlägt die Dicke)', nach('Tragwand-B').type, 'interior');
  check('B behält 30 cm', nach('Tragwand-B').thickness, 0.3, 1e-9);

  check('C ist Innenwand (Namensglied Int)', nach('Wand-Int-C').type, 'interior');

  check('D ist da', Boolean(nach('Giebel-D')), true);
  // Länge 8,0 m, Achse von (0|30) nach (8|30) — Profilmitte liegt bei x = 4.
  const d = nach('Giebel-D');
  const da = r.nodes.find((k) => k.id === d.a)!;
  const db = r.nodes.find((k) => k.id === d.b)!;
  check('D ist 8,00 m lang', Math.hypot(db.x - da.x, db.y - da.y), 8, 1e-6);
  check('D liegt auf y = 30', (da.y + db.y) / 2, 30, 1e-6);
  // Die Höhe ist die **ungeschnittene** Extrusion. Das ist Absicht und wird
  // gemeldet; die Wandhöhe unter dem Dach rechnet CAD Light selbst.
  check('D behält die ungeschnittene Höhe', d.height, 3.5, 1e-9);
  check('D ist Außenwand (kein Hinweis, 30 cm)', d.type, 'exterior');

  check('E ist Schachtwand', nach('Schacht-E').type, 'shaft');
  check('F ist Außenwand (.U. ist nicht innen)', nach('Mauer-F').type, 'exterior');

  // --- Was gemeldet wird ----------------------------------------------------
  const grund = (t: string) => r.skipped.find((s) => s.reason.includes(t))?.count ?? 0;
  check('G übersprungen', grund('Wand ohne auswertbare Extrusionsgeometrie'), 1);
  check('Deckendurchbruch als solcher benannt', grund('statt in einer Wand'), 1);
  check(
    'Der Durchbruch heißt nicht „ohne zugehörige Wand"',
    r.skipped.some((s) => s.reason === 'Öffnung ohne zugehörige Wand'),
    false,
  );
  check('Keine weiteren Ausfälle', r.skipped.reduce((s, x) => s + x.count, 0), 2);

  check('Genau ein Hinweis-Grund', r.hinweise.length, 1);
  check('Nur D trägt ihn', r.hinweise[0].count, 1);
  check(
    'Der Hinweis nennt die Extrusion',
    /ungeschnittener Extrusion/.test(r.hinweise[0].reason),
    true,
  );

  // Die Meldung selbst darf einen Verlust nicht verschweigen — daran ist das
  // FZK-Haus gescheitert, nicht am Zählen.
  check('Meldung nennt die Übersprungenen', /übersprungen/.test(r.message), true);
  check('Meldung nennt die Wandzahl', /^6 Wände/.test(r.message), true);

  // --- Gegenprobe: ohne Schnitte ändert sich nichts -------------------------
  // Wäre `basisExtrusion` zu großzügig und nähme etwas an, das keine
  // Extrusion ist, fiele es hier auf: dieselbe Wand ohne Boolesche Hülle
  // muss Zeichen für Zeichen dasselbe Ergebnis liefern.
  const ohne = importIfc(baueDatei([w('Giebel-D', 8, 0.3, 3.5, 30)]));
  const mit = importIfc(baueDatei([w('Giebel-D', 8, 0.3, 3.5, 30, { schnitte: 2 })]));
  // Die `id` bleibt außen vor: sie trägt die STEP-Nummer der Entity, und die
  // Boolesche Hülle verbraucht zusätzliche Nummern. Verglichen wird, was die
  // Wand ausmacht — Achse, Dicke, Höhe, Art.
  const ohneId = (w: { id: string }) => ({ ...w, id: '' });
  check(
    'Schnitt ändert die Wand nicht',
    JSON.stringify(mit.walls.map(ohneId)),
    JSON.stringify(ohne.walls.map(ohneId)),
  );
  check('Ohne Schnitt kein Hinweis', ohne.hinweise.length, 0);
  check('Mit Schnitt ein Hinweis', mit.hinweise.length, 1);

  pruefeBezugslinie(check);
}

/**
 * Die Bezugslinie liegt nicht in der Wandmitte.
 * ---------------------------------------------------------------------------
 * IFC nennt die `Axis`-Repräsentation *Bezugslinie*, nicht Mittellinie.
 * ArchiCAD legt sie beim FZK-Haus auf die **Außenfläche** der Wand
 * (`IfcMaterialLayerSetUsage(…, .AXIS2., .NEGATIVE., 0.)`). Wer sie für die
 * Mitte hält, baut jedes Haus um eine halbe Wanddicke zu groß.
 *
 * Geprüft wird an einem Rechteck von 6,00 × 4,00 m Bezugsmaß mit 30 cm
 * Wänden, deren Körper nach innen hängen, plus einer 20 cm starken
 * Trennwand auf halber Höhe, deren Körper mittig auf ihrer Bezugslinie
 * sitzt.
 *
 * **Die Zahlen, von Hand.**
 *
 * Die vier Außenwände laufen im Gegenuhrzeigersinn; die Linksnormale zeigt
 * damit immer nach innen, und der Versatz ist überall +0,15.
 *
 *   Ecke (0|0): Südwand `n = (0|1)`, `v = 0,15` → `d_y = 0,15`
 *               Westwand `n = (1|0)`, `v = 0,15` → `d_x = 0,15`
 *               → Knoten (0,15 | 0,15)
 *   Ecke (6|0): Ostwand `n = (−1|0)` → `d_x = −0,15` → (5,85 | 0,15)
 *   Ecke (6|4): Nordwand `n = (0|−1)` → `d_y = −0,15` → (5,85 | 3,85)
 *   Ecke (0|4): → (0,15 | 3,85)
 *
 * Die beiden Enden der Trennwand sind **T-Stöße**: sie liegen mitten auf
 * der West- bzw. Ostwand und haben dort keinen gemeinsamen Knoten. Sie
 * bekommen deren Bedingung mit:
 *
 *   (0|2): Trennwand `n = (0|1)`, `v = 0` → `d_y = 0`
 *          Westwand  `n = (1|0)`, `v = 0,15` → `d_x = 0,15`
 *          → (0,15 | 2,00)
 *   (6|2): → (5,85 | 2,00)
 *
 * **Die Flächen.** Lichte Weite 6,00 − 0,30 = 5,70 in x zwischen den
 * Mittellinien, davon je 0,15 Wandhälfte ab: 5,40 m. In y: 4,00 − 0,30 =
 * 3,70 zwischen den Mittellinien, minus 2 × 0,15 = 3,40 m lichte Höhe, und
 * davon geht die 0,20 m starke Trennwand ab: 3,20 m auf zwei Räume, also
 * je 1,60 m.
 *
 *   je Raum 5,40 × 1,60 = 8,64 m²,  zusammen 17,28 m²
 *
 * Ohne die Rückung käme 6,00 × 4,00 Achsmaß heraus: lichte 5,70 × 3,70
 * minus Trennwand → 5,70 × 3,50 = 19,95 m². Das sind **15 % zu viel** —
 * und in der Heizlast landet das als 15 % zu große Grundfläche.
 */
function pruefeBezugslinie(check: CheckFn): void {
  const aussen = (
    name: string,
    von: [number, number],
    bis: [number, number],
  ): WandVorgabe => ({
    name, dicke: 0.3, hoehe: 2.6, von, bis, achse: true, versatz: 0.15,
  });

  const rechteck: WandVorgabe[] = [
    aussen('Sued', [0, 0], [6, 0]),
    aussen('Ost', [6, 0], [6, 4]),
    aussen('Nord', [6, 4], [0, 4]),
    aussen('West', [0, 4], [0, 0]),
    { name: 'Trennwand', dicke: 0.2, hoehe: 2.6, von: [0, 2], bis: [6, 2], achse: true, versatz: 0 },
  ];

  const r = importIfc(baueDatei(rechteck));
  check('Rechteck: fünf Wände', r.walls.length, 5);
  check('Rechteck: sechs Knoten', r.nodes.length, 6);

  const beiUrsprung = (x: number, y: number) =>
    r.nodes.some((n) => Math.abs(n.x - x) < 1e-6 && Math.abs(n.y - y) < 1e-6);

  check('Ecke Süd-West gerückt', beiUrsprung(0.15, 0.15), true);
  check('Ecke Süd-Ost gerückt', beiUrsprung(5.85, 0.15), true);
  check('Ecke Nord-Ost gerückt', beiUrsprung(5.85, 3.85), true);
  check('Ecke Nord-West gerückt', beiUrsprung(0.15, 3.85), true);
  check('T-Stoß West gerückt', beiUrsprung(0.15, 2), true);
  check('T-Stoß Ost gerückt', beiUrsprung(5.85, 2), true);

  // Die Räume, die daraus entstehen.
  const knoten: Record<string, BimNode> = Object.fromEntries(r.nodes.map((n) => [n.id, n]));
  const raeume = detectRooms({
    walls: r.walls,
    nodes: knoten,
    openings: r.openings,
    levelId: r.levels[0].id,
    defaultHeight: 2.6,
    northAngle: 0,
  });
  check('Rechteck: zwei Räume', raeume.length, 2);
  check('Rechteck: Fläche je Raum [m²]', raeume[0].area, 8.64, 0.005);
  check(
    'Rechteck: Fläche zusammen [m²]',
    raeume.reduce((sum, x) => sum + x.area, 0),
    17.28,
    0.01,
  );

  // --- Gegenprobe: Bezugslinie = Mittellinie ------------------------------
  // Der eigene Export von CAD Light schreibt die Achse mittig. Dort darf
  // sich kein Knoten bewegen — sonst verschöbe diese Reparatur alles, was
  // bisher richtig war.
  const mittig = importIfc(
    baueDatei(rechteck.map((v) => ({ ...v, versatz: 0 }))),
  );
  check('Mittige Achse: Ecke bleibt im Ursprung',
    mittig.nodes.some((n) => Math.abs(n.x) < 1e-9 && Math.abs(n.y) < 1e-9), true);
  check('Mittige Achse: Ecke bleibt bei (6|4)',
    mittig.nodes.some((n) => Math.abs(n.x - 6) < 1e-9 && Math.abs(n.y - 4) < 1e-9), true);
  check('Mittige Achse: kein Hinweis', mittig.hinweise.length, 0);

  // --- Gegenprobe: gar keine Achsen-Repräsentation ------------------------
  // Ohne `Axis` liest der Import die Körpermitte; die ist schon die
  // Mittellinie, also bleibt ebenfalls alles stehen — nur eben um 0,15 m
  // versetzt, weil der Körper dort liegt.
  const ohneAchse = importIfc(
    baueDatei(rechteck.map((v) => ({ ...v, achse: false }))),
  );
  check('Ohne Achse: fünf Wände', ohneAchse.walls.length, 5);
  check('Ohne Achse: kein Hinweis', ohneAchse.hinweise.length, 0);

  // --- Die Bremse bei sehr spitzen Anschlüssen -----------------------------
  //
  // Zwei Wände treffen sich unter 5°, und ihre Körper hängen auf
  // **verschiedenen** Seiten: die eine +0,15, die andere −0,15. Damit
  // laufen die Mittellinien auseinander, und ihr Schnittpunkt liegt weit
  // draußen.
  //
  // *Von Hand.* n₁ = (0|1), v₁ = +0,15 → d_y = 0,15.
  // n₂ = (−sin 5° | cos 5°) = (−0,08716 | 0,99619), v₂ = −0,15:
  //     −0,08716·d_x + 0,99619·0,15 = −0,15
  //     −0,08716·d_x = −0,29943   →   d_x = 3,435 m
  // Die Rückung wäre 3,44 m. Die Grenze ist das Doppelte der dicksten Wand,
  // also 0,60 m — sie greift.
  //
  // Zurück fällt die Rechnung dann auf den Rang-1-Fall. Der mittelt zwei
  // Forderungen, die sich widersprechen (+0,15 und −0,15 fast derselben
  // Richtung), und kommt dabei auf beinahe null: es gibt keine Richtung,
  // in die zu rücken verteidigen wäre. Der Knoten bleibt also stehen, und
  // der Fall steht in den Hinweisen — sichtbar, nicht verschwiegen.
  const spitz = importIfc(
    baueDatei([
      { name: 'Spitz-1', dicke: 0.3, hoehe: 2.6, von: [0, 0], bis: [10, 0], achse: true, versatz: 0.15 },
      {
        name: 'Spitz-2', dicke: 0.3, hoehe: 2.6, von: [0, 0],
        bis: [10 * Math.cos((5 * Math.PI) / 180), 10 * Math.sin((5 * Math.PI) / 180)],
        achse: true, versatz: -0.15,
      },
    ]),
  );
  const gemeinsam = spitz.nodes.find((n) => Math.hypot(n.x, n.y) < 1);
  check('Spitzer Anschluss: Knoten existiert', Boolean(gemeinsam), true);
  check(
    'Spitzer Anschluss: Knoten bleibt stehen [m]',
    Math.hypot(gemeinsam?.x ?? 9, gemeinsam?.y ?? 9),
    0,
    0.001,
  );
  check(
    'Spitzer Anschluss wird gemeldet',
    spitz.hinweise.some((h) => /spitzer Wandanschluss/.test(h.reason)),
    true,
  );

  pruefeRaeumeAusDatei(check);
}

/**
 * Was der Architekt an Raumnamen mitliefert.
 * ---------------------------------------------------------------------------
 * `IfcSpace` ist die einzige Stelle einer IFC-Datei, an der steht, wie ein
 * Raum heißt. Über den Namen hängt die Nutzung, über die Nutzung die
 * Solltemperatur nach DIN EN 12831 — das Bad mit 24 °C, der Flur mit 15 °C.
 * Ohne diese Angabe kommt jeder Raum als „Raum 3" mit 20 °C an; beim
 * Institutsgebäude des KIT sind das 82 Räume, die jemand von Hand einstufen
 * müsste.
 *
 * Geprüft wird an demselben Rechteck wie oben, mit zwei benannten Räumen:
 * „Bad" im unteren, „Küche" im oberen. Die Küche steht in der Datei in der
 * STEP-Umschreibung `K\X2\00FC\X0\che` — genau so, wie ArchiCAD einen
 * Umlaut schreibt, und der Grund, warum der Import die Umschreibung
 * auflösen können muss.
 *
 * Die Umrisse sind bewusst **nicht** deckungsgleich mit den erkannten
 * Räumen: der eine ist 5 cm nach innen gesetzt, der andere als
 * Extrusionskörper statt als `FootPrint` geschrieben. Beides kommt so in
 * echten Dateien vor, und beides darf die Zuordnung nicht stören — sie geht
 * über den Schwerpunkt, nicht über die Deckung.
 */
function pruefeRaeumeAusDatei(check: CheckFn): void {
  const aussen = (name: string, von: [number, number], bis: [number, number]): WandVorgabe => ({
    name, dicke: 0.3, hoehe: 2.6, von, bis, achse: true, versatz: 0.15,
  });
  const rechteck: WandVorgabe[] = [
    aussen('Sued', [0, 0], [6, 0]),
    aussen('Ost', [6, 0], [6, 4]),
    aussen('Nord', [6, 4], [0, 4]),
    aussen('West', [0, 4], [0, 0]),
    { name: 'Trennwand', dicke: 0.2, hoehe: 2.6, von: [0, 2], bis: [6, 2], achse: true, versatz: 0 },
  ];

  // Unterer Raum: lichte Grenzen 0,30…5,70 × 0,30…1,90 (siehe oben).
  // Der Umriss der Datei sitzt 5 cm weiter innen — der Architekt hat an der
  // Rohbaukante gezeichnet, nicht an der Putzkante.
  const unten: Array<[number, number]> = [[0.35, 0.35], [5.65, 0.35], [5.65, 1.85], [0.35, 1.85]];
  // Oberer Raum: 0,30…5,70 × 2,10…3,70, als Extrusionskörper geschrieben.
  const oben: Array<[number, number]> = [[0.3, 2.1], [5.7, 2.1], [5.7, 3.7], [0.3, 3.7]];

  const r = importIfc(
    baueDatei(rechteck, [
      { langname: 'Bad', kurzname: '1', umriss: unten },
      { langname: 'K\\X2\\00FC\\X0\\che', kurzname: '2', umriss: oben, alsKoerper: true },
    ]),
  );

  check('Zwei Räume aus der Datei', r.spaces.length, 2);
  const bad = r.spaces.find((x) => x.name === 'Bad');
  const kueche = r.spaces.find((x) => x.name === 'Küche');
  check('Bad gelesen', Boolean(bad), true);
  check('Umlaut aufgelöst — „Küche", nicht „K\\X2\\00FC\\X0\\che"', Boolean(kueche), true);
  // 5,30 × 1,50 = 7,95 m²   |   5,40 × 1,60 = 8,64 m²
  check('Bad: Fläche aus dem Umriss [m²]', bad?.area ?? 0, 7.95, 0.005);
  check('Küche: Fläche aus dem Körperprofil [m²]', kueche?.area ?? 0, 8.64, 0.005);
  check('Beide im selben Geschoss', bad?.levelId === kueche?.levelId, true);
  check('Geschoss ist das der Datei', bad?.levelId ?? '', r.levels[0].id);

  // --- Zuordnung auf die erkannten Räume ----------------------------------
  const knoten: Record<string, BimNode> = Object.fromEntries(r.nodes.map((n) => [n.id, n]));
  const raeume = detectRooms({
    walls: r.walls,
    nodes: knoten,
    openings: r.openings,
    levelId: r.levels[0].id,
    defaultHeight: 2.6,
    northAngle: 0,
  });
  const zu = ordneRaumnamenZu(
    raeume.map((x) => ({ id: x.id, levelId: x.levelId, polygon: x.polygon, area: x.area })),
    r.spaces,
  );
  check('Beide Räume zugeordnet', zu.length, 2);
  const badZu = zu.find((x) => x.name === 'Bad');
  const kuecheZu = zu.find((x) => x.name === 'Küche');
  check('Bad → Nutzung bath', badZu?.usage ?? '', 'bath');
  check('Küche → Nutzung kitchen', kuecheZu?.usage ?? '', 'kitchen');
  check('Kein Raum doppelt vergeben', new Set(zu.map((x) => x.roomId)).size, 2);
  check('Keine Zusammenfassung gemeldet', zu.reduce((n2, x) => n2 + x.weitere.length, 0), 0);

  // --- Zwei Räume der Datei in einem erkannten Raum ------------------------
  // Der Architekt zieht eine Raumgrenze, wo keine Wand steht — beim
  // FZK-Haus sind „Wohnen", „Flur" und „Küche" ein offener Bereich. Der
  // größere gibt den Namen, der kleinere wird gemeldet und nicht
  // verschwiegen.
  const offen = importIfc(
    baueDatei(rechteck.slice(0, 4), [
      { langname: 'Wohnen', umriss: [[0.3, 0.3], [5.7, 0.3], [5.7, 2.3], [0.3, 2.3]] },
      { langname: 'Flur', umriss: [[0.3, 2.3], [5.7, 2.3], [5.7, 3.7], [0.3, 3.7]] },
    ]),
  );
  const offenKnoten: Record<string, BimNode> = Object.fromEntries(offen.nodes.map((n) => [n.id, n]));
  const offenRaeume = detectRooms({
    walls: offen.walls,
    nodes: offenKnoten,
    openings: offen.openings,
    levelId: offen.levels[0].id,
    defaultHeight: 2.6,
    northAngle: 0,
  });
  check('Ohne Trennwand ein Raum', offenRaeume.length, 1);
  const offenZu = ordneRaumnamenZu(
    offenRaeume.map((x) => ({ id: x.id, levelId: x.levelId, polygon: x.polygon, area: x.area })),
    offen.spaces,
  );
  check('Eine Zuordnung', offenZu.length, 1);
  // Die beiden sind absichtlich **ungleich** groß, sonst entschiede die
  // Reihenfolge in der Datei und nicht die Regel: Wohnen reicht von
  // y = 0,30 bis 2,30 → 5,40 × 2,00 = 10,80 m², der Flur von 2,30 bis 3,70
  // → 5,40 × 1,40 = 7,56 m². Zusammen 18,36 m² — die lichte Fläche des
  // Raums ohne Trennwand, wie oben ausgerechnet.
  check('Wohnen ist der größere [m²]',
    offen.spaces.find((x) => x.name === 'Wohnen')?.area ?? 0, 10.8, 0.005);
  check('Flur ist der kleinere [m²]',
    offen.spaces.find((x) => x.name === 'Flur')?.area ?? 0, 7.56, 0.005);
  check('Zusammen die ganze lichte Fläche [m²]', offenRaeume[0].area, 18.36, 0.01);
  check('Der größere gibt den Namen', offenZu[0].name, 'Wohnen');
  check('Der kleinere wird gemeldet', offenZu[0].weitere.join(','), 'Flur');

  // Die Schranke: ein Raum der Datei, der größer ist als der erkannte,
  // darf ihm seinen Namen nicht aufdrücken. Das wäre der Fall, wenn der
  // Architekt eine ganze Wohnung als einen `IfcSpace` führt.
  const zuGross = importIfc(
    baueDatei(rechteck.slice(0, 4), [
      { langname: 'Wohnung 1', umriss: [[-2, -2], [8, -2], [8, 6], [-2, 6]] },
    ]),
  );
  const zuGrossKnoten: Record<string, BimNode> = Object.fromEntries(zuGross.nodes.map((n) => [n.id, n]));
  const zuGrossRaeume = detectRooms({
    walls: zuGross.walls, nodes: zuGrossKnoten, openings: zuGross.openings,
    levelId: zuGross.levels[0].id, defaultHeight: 2.6, northAngle: 0,
  });
  check('Zu großer Raum wird gelesen', zuGross.spaces.length, 1);
  check(
    'Zu großer Raum wird nicht zugeordnet',
    ordneRaumnamenZu(
      zuGrossRaeume.map((x) => ({ id: x.id, levelId: x.levelId, polygon: x.polygon, area: x.area })),
      zuGross.spaces,
    ).length,
    0,
  );
}
