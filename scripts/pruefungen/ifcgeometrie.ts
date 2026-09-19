/**
 * Prüfblock „Körperformen" — wenn die Wand keine Extrusion ist.
 * ---------------------------------------------------------------------------
 * **Der Hauptweg und die Rückfallebene.** Eine Wand liest dieser Import am
 * liebsten als Extrusion: Profil mal Tiefe. Das ist genau, und die meisten
 * Programme schreiben es so. Drei tun es nicht:
 *
 *  · **Renga** legt seine Wände als `IfcMappedItem` ab — eine geteilte
 *    Vorlage samt Versatz —, und darin steckt ein `IfcPolygonalFaceSet`.
 *  · **`202103162102_cira.ifc`** schreibt *alle* Wände als solches Netz.
 *  · **Vectorworks** vereinzelt als `IfcShellBasedSurfaceModel`.
 *
 * Gemessen am Korpus fremder Dateien kostete das bis 1.33.0: Renga 21 von
 * 33 Wänden, `cira` alle 101 — die Datei kam vollständig leer an. Über den
 * ganzen Korpus kamen 1010 Wände an; mit der Rückfallebene sind es 1131,
 * und keine Datei liefert mehr null.
 *
 * **Was die Rückfallebene tut und was nicht.** Sie misst den umschreibenden
 * Kasten: Länge, Dicke, Höhe. Für eine Heizlast genügt das — eine Wand ist
 * dort eine Fläche mit einem U-Wert, kein Netz aus Dreiecken. Sie ist aber
 * *gemessen* und nicht *gelesen*, und deshalb prüft dieser Block auch, dass
 * das gesagt wird und dass die Messung dort aufhört, wo sie unehrlich würde:
 * Steckt ein ganzer Wandzug in einem Körper, ist der Kasten breiter als jede
 * Wand darin, und eine 2 m dicke Wand frisst in der Raumerkennung den halben
 * Raum.
 *
 * Alle Sollwerte sind von Hand gerechnet; die Rechnung steht jeweils dabei.
 */

import { importIfc } from '../../src/lib/ifcImport';
import type { CheckFn } from './typ';

const z = (v: number): string => (Number.isInteger(v) ? `${v}.` : String(v));

/** In welcher Schreibweise der Wandkörper in der Datei steht. */
type Form = 'faceset' | 'dreiecke' | 'schalen' | 'abgebildet' | 'abgebildet-gedreht' | 'zudick';

/**
 * Eine IFC4-Datei mit **einer** Wand, deren Körper ein Quader ist.
 *
 * Der Quader: von (0|0|0) bis (6|0,3|2,5) — also **6,00 m lang, 0,30 m dick,
 * 2,50 m hoch**, Mitte auf (3,00 | 0,15). Genau diese drei Zahlen müssen
 * hinterher am Modell stehen, egal in welcher Schreibweise der Quader in der
 * Datei liegt. `zudick` baut denselben Quader 2,00 m dick — das ist der
 * Fall, den die Rückfallebene ablehnen muss.
 */
function baueDatei(form: Form): string {
  const laenge = 6;
  const dicke = form === 'zudick' ? 2 : 0.3;
  const hoehe = 2.5;

  let n = 0;
  const zeilen: string[] = [];
  const e = (text: string) => {
    n += 1;
    zeilen.push(`#${n}=${text};`);
    return n;
  };

  const dirZ = e('IFCDIRECTION((0.,0.,1.))');
  const dirX = e('IFCDIRECTION((1.,0.,0.))');
  const nullpunkt = e('IFCCARTESIANPOINT((0.,0.,0.))');
  const weltachse = e(`IFCAXIS2PLACEMENT3D(#${nullpunkt},#${dirZ},#${dirX})`);
  const weltlage = e(`IFCLOCALPLACEMENT($,#${weltachse})`);
  e(`IFCPROJECT('0Projekt00000000000000',$,'Körperhaus',$,$,$,$,$,$)`);
  const geschoss = e(
    `IFCBUILDINGSTOREY('0Geschoss0000000000000',$,'Erdgeschoss',$,$,#${weltlage},$,$,.ELEMENT.,0.)`,
  );
  const wandlage = e(`IFCLOCALPLACEMENT(#${weltlage},#${weltachse})`);

  /** Die acht Ecken des Quaders in der Reihenfolge unten, dann oben. */
  const ecken: Array<[number, number, number]> = [
    [0, 0, 0], [laenge, 0, 0], [laenge, dicke, 0], [0, dicke, 0],
    [0, 0, hoehe], [laenge, 0, hoehe], [laenge, dicke, hoehe], [0, dicke, hoehe],
  ];

  /** Der Quader als `IfcFacetedBrep`-artiger Flächenverband. */
  const alsSchalen = (typ: 'schalen'): number => {
    const punkte = ecken.map(([x, y, zz]) => e(`IFCCARTESIANPOINT((${z(x)},${z(y)},${z(zz)}))`));
    const flaeche = (idx: number[]) => {
      const loop = e(`IFCPOLYLOOP((${idx.map((i) => `#${punkte[i]}`).join(',')}))`);
      const bound = e(`IFCFACEOUTERBOUND(#${loop},.T.)`);
      return e(`IFCFACE((#${bound}))`);
    };
    const flaechen = [
      flaeche([0, 1, 2, 3]),
      flaeche([4, 5, 6, 7]),
      flaeche([0, 1, 5, 4]),
      flaeche([3, 2, 6, 7]),
    ];
    const schale = e(`IFCOPENSHELL((${flaechen.map((f) => `#${f}`).join(',')}))`);
    const modell = e(`IFCSHELLBASEDSURFACEMODEL((#${schale}))`);
    void typ;
    return e(`IFCSHAPEREPRESENTATION($,'Body','SurfaceModel',(#${modell}))`);
  };

  /** Der Quader als Netz — `IfcPolygonalFaceSet` oder `IfcTriangulatedFaceSet`. */
  const alsNetz = (dreiecke: boolean): number => {
    const liste = e(
      `IFCCARTESIANPOINTLIST3D((${ecken.map(([x, y, zz]) => `(${z(x)},${z(y)},${z(zz)})`).join(',')}))`,
    );
    if (dreiecke) {
      const netz = e(`IFCTRIANGULATEDFACESET(#${liste},$,.T.,((1,2,3),(1,3,4)),$)`);
      return e(`IFCSHAPEREPRESENTATION($,'Body','Tessellation',(#${netz}))`);
    }
    const f1 = e('IFCINDEXEDPOLYGONALFACE((1,2,3,4))');
    const f2 = e('IFCINDEXEDPOLYGONALFACE((5,6,7,8))');
    const netz = e(`IFCPOLYGONALFACESET(#${liste},.T.,(#${f1},#${f2}),$)`);
    return e(`IFCSHAPEREPRESENTATION($,'Body','Tessellation',(#${netz}))`);
  };

  let shape: number;
  if (form === 'schalen') {
    shape = alsSchalen('schalen');
  } else if (form === 'dreiecke') {
    shape = alsNetz(true);
  } else if (form === 'faceset' || form === 'zudick') {
    shape = alsNetz(false);
  } else {
    /*
     * Die abgebildete Vorlage. Der Quader steht in der Vorlage im Ursprung;
     * der Operator setzt ihn an seinen Platz:
     *
     *   `abgebildet`          Ursprung (10 | 5 | 0), Achsen unverändert
     *                         → der Quader liegt von (10|5) bis (16|5,3)
     *   `abgebildet-gedreht`  zusätzlich um 90° gedreht (Achse1 = +y,
     *                         Achse2 = −x) → aus 6 m in x werden 6 m in y,
     *                         und die Rückfallebene muss die Wand trotzdem
     *                         6,00 m lang und 0,30 m dick nennen.
     */
    const innen = alsNetz(false);
    const kartenachse = e(`IFCAXIS2PLACEMENT3D(#${nullpunkt},#${dirZ},#${dirX})`);
    const karte = e(`IFCREPRESENTATIONMAP(#${kartenachse},#${innen})`);
    const gedreht = form === 'abgebildet-gedreht';
    const a1 = gedreht ? e('IFCDIRECTION((0.,1.,0.))') : e('IFCDIRECTION((1.,0.,0.))');
    const a2 = gedreht ? e('IFCDIRECTION((-1.,0.,0.))') : e('IFCDIRECTION((0.,1.,0.))');
    const a3 = e('IFCDIRECTION((0.,0.,1.))');
    const ursprung = e('IFCCARTESIANPOINT((10.,5.,0.))');
    const op = e(
      `IFCCARTESIANTRANSFORMATIONOPERATOR3D(#${a1},#${a2},#${ursprung},1.,#${a3})`,
    );
    const abbild = e(`IFCMAPPEDITEM(#${karte},#${op})`);
    shape = e(`IFCSHAPEREPRESENTATION($,'Body','MappedRepresentation',(#${abbild}))`);
  }

  const pds = e(`IFCPRODUCTDEFINITIONSHAPE($,$,(#${shape}))`);
  const wand = e(
    `IFCWALLSTANDARDCASE('0Wand0000000000000000',$,'Wand-Ext-1',$,$,#${wandlage},#${pds},$,$)`,
  );
  e(
    `IFCRELCONTAINEDINSPATIALSTRUCTURE('0Contain000000000000',$,$,$,(#${wand}),#${geschoss})`,
  );

  return [
    'ISO-10303-21;',
    'HEADER;',
    "FILE_DESCRIPTION((''),'');",
    "FILE_NAME('','',(''),(''),'','','');",
    "FILE_SCHEMA(('IFC4'));",
    'ENDSEC;',
    'DATA;',
    ...zeilen,
    'ENDSEC;',
    'END-ISO-10303-21;',
  ].join('\n');
}

export function pruefeIfcGeometrie(check: CheckFn): void {
  const wandAus = (form: Form) => {
    const r = importIfc(baueDatei(form));
    const w = r.walls[0];
    const a = r.nodes.find((k) => k.id === w?.a);
    const b = r.nodes.find((k) => k.id === w?.b);
    return {
      ok: r.ok,
      zahl: r.walls.length,
      laenge: a && b ? Math.hypot(b.x - a.x, b.y - a.y) : NaN,
      dicke: w?.thickness ?? NaN,
      hoehe: w?.height ?? NaN,
      mitte: a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : { x: NaN, y: NaN },
      hinweise: r.hinweise,
      skipped: r.skipped,
    };
  };

  // =========================================================================
  // 1 · Drei Netz- und Flächenformen ergeben denselben Quader
  // =========================================================================
  for (const [form, was] of [
    ['faceset', 'Polygonnetz (Renga, cira)'],
    ['dreiecke', 'Dreiecksnetz'],
    ['schalen', 'Flächenverband (Vectorworks)'],
  ] as Array<[Form, string]>) {
    const w = wandAus(form);
    check(`${was}: eine Wand kommt an`, w.zahl, 1);
    // Der Quader misst 6,00 × 0,30 × 2,50 m — siehe `baueDatei`.
    check(`${was}: 6,00 m lang`, w.laenge, 6, 1e-6);
    check(`${was}: 0,30 m dick`, w.dicke, 0.3, 1e-6);
    check(`${was}: 2,50 m hoch`, w.hoehe, 2.5, 1e-6);
  }

  // =========================================================================
  // 2 · Die abgebildete Vorlage kommt an ihrem Platz an
  // =========================================================================
  {
    /*
     * Der Operator verschiebt den Quader um (10 | 5). Die Wandachse liegt in
     * der Mitte der Dicke, also bei y = 5 + 0,30/2 = **5,15**, und ihre
     * Mitte bei x = 10 + 6/2 = **13,00**.
     *
     * Das ist der Punkt, an dem es wirklich hängt: In der Renga-Datei dreht
     * derselbe Operator die Wand um 180° und schiebt sie um 39 m. Wer ihn
     * übergeht, baut das ganze Haus im Ursprung übereinander.
     */
    const w = wandAus('abgebildet');
    check('Abgebildete Vorlage: eine Wand', w.zahl, 1);
    check('Abgebildete Vorlage: 6,00 m lang', w.laenge, 6, 1e-6);
    check('Abgebildete Vorlage: 0,30 m dick', w.dicke, 0.3, 1e-6);
    check('Abgebildete Vorlage: Mitte in x', w.mitte.x, 13, 1e-6);
    check('Abgebildete Vorlage: Mitte in y', w.mitte.y, 5.15, 1e-6);
  }

  // =========================================================================
  // 3 · Auch um 90° gedreht bleibt die Wand 6 m lang und 30 cm dick
  // =========================================================================
  {
    /*
     * Die Drehung tauscht die Achsen: Aus 6,00 m in x werden 6,00 m in y und
     * aus 0,30 m in y werden 0,30 m in −x. Läse die Rückfallebene stur
     * „x ist die Länge", stünde eine **6,00 m dicke** Wand im Plan.
     *
     * Der Quader liegt dann von (10 − 0,30 | 5) bis (10 | 5 + 6), die
     * Wandachse also senkrecht: Mitte bei x = 10 − 0,15 = **9,85**,
     * y = 5 + 3 = **8,00**.
     */
    const w = wandAus('abgebildet-gedreht');
    check('Gedrehte Vorlage: 6,00 m lang', w.laenge, 6, 1e-6);
    check('Gedrehte Vorlage: 0,30 m dick', w.dicke, 0.3, 1e-6);
    check('Gedrehte Vorlage: Mitte in x', w.mitte.x, 9.85, 1e-6);
    check('Gedrehte Vorlage: Mitte in y', w.mitte.y, 8, 1e-6);
  }

  // =========================================================================
  // 4 · Gemessen heißt gemessen, und das steht da
  // =========================================================================
  {
    const w = wandAus('faceset');
    check(
      'Die Messung wird als Hinweis genannt',
      w.hinweise.some((h) => h.reason.includes('gemessen')),
      true,
    );

    /*
     * Die Gegenprobe: Eine Wand, die als Extrusion dasteht, darf diesen
     * Hinweis **nicht** tragen. Ohne sie wäre die Prüfung oben auch dann
     * grün, wenn der Hinweis bei jeder Wand stünde — und ein Hinweis, der
     * immer erscheint, sagt nichts.
     */
    const extrusion = baueDatei('faceset')
      .replace(/IFCPOLYGONALFACESET[^;]*;/, '')
      .replace(
        /#(\d+)=IFCSHAPEREPRESENTATION\(\$,'Body','Tessellation',\(#\d+\)\);/,
        (_m, id) =>
          `#900=IFCCARTESIANPOINT((3.,0.));#901=IFCDIRECTION((1.,0.));#902=IFCAXIS2PLACEMENT2D(#900,#901);` +
          `#903=IFCRECTANGLEPROFILEDEF(.AREA.,$,#902,6.,0.3);#904=IFCEXTRUDEDAREASOLID(#903,#4,#1,2.5);` +
          `#${id}=IFCSHAPEREPRESENTATION($,'Body','SweptSolid',(#904));`,
      );
    const r = importIfc(extrusion);
    check('Eine gelesene Extrusion kommt an', r.walls.length, 1);
    check(
      'Sie trägt den Messhinweis nicht',
      r.hinweise.some((h) => h.reason.includes('gemessen')),
      false,
    );
  }

  // =========================================================================
  // 5 · Wo die Messung unehrlich würde, hört sie auf
  // =========================================================================
  {
    /*
     * Derselbe Körper, 2,00 m dick. Das ist keine Wand mehr, sondern ein
     * Körper, in dem mehrere stecken — im Korpus kommt das zweimal vor, in
     * `202103162102_cira.ifc` bei 91 Wänden. Eine 2 m dicke Wand ist für die
     * Raumerkennung schlimmer als eine fehlende: Sie frisst den halben Raum.
     *
     * Also: übersprungen, gezählt und genannt. Nicht zurechtgebogen — eine
     * auf 0,30 m gestutzte Dicke wäre erfunden.
     */
    const w = wandAus('zudick');
    check('Ein zu dicker Körper kommt nicht als Wand an', w.zahl, 0);
    check(
      'Er wird als übersprungen gemeldet',
      w.skipped.some((s) => s.reason.includes('unplausibel dick')),
      true,
    );
  }
}
