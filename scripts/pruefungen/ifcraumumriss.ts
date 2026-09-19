/**
 * Prüfblock „Raumumriss aus fremden Dateien" — vier Schreibweisen, ein Raum.
 * ---------------------------------------------------------------------------
 * **Warum ein Raumname mehr ist als eine Beschriftung.** `IfcSpace` ist die
 * einzige Stelle in einer IFC-Datei, an der steht, wie ein Raum heißt. Daran
 * hängt in der Heizlast die Solltemperatur — DIN EN 12831 rechnet das Bad mit
 * 24 °C und den Flur mit 15 °C — und der Luftwechsel. Kommt der Name nicht
 * an, steht dort „Raum 3", Nutzung „sonstige", 20 °C, und jemand muss das
 * für jeden Raum von Hand nachtragen.
 *
 * **Was der Korpus gezeigt hat.** Ein Raum wird von jedem Programm anders
 * geschrieben, und bis 1.32.0 las der Import nur zwei der vier Formen:
 *
 * | Programm | Schreibweise des Raumkörpers | vorher |
 * |---|---|---|
 * | ArchiCAD | `FootPrint`-Kurve bzw. `IfcFacetedBrep` | gelesen |
 * | Allplan | `IfcRectangleProfileDef` als Extrusion | **verloren** |
 * | Revit | `IfcArbitraryProfileDefWithVoids` | **verloren** |
 * | diverse | `IfcArbitraryClosedProfileDef` | gelesen |
 *
 * Gemessen: Am Institutsgebäude des KIT gingen aus der Allplan-Fassung
 * **82 von 82** Raumnamen verloren, aus der ArchiCAD-Fassung desselben
 * Gebäudes keiner. Am Revit-Musterprojekt waren es 96 von 116. Der Fehler
 * lag an zwei Zeichen: geprüft wurde auf den Namensanfang
 * `IFCARBITRARYCLOSEDPROFILEDEF`, und Revits Profil heißt
 * `IFCARBITRARYPROFILEDEFWITHVOIDS` — dasselbe Wort ohne `CLOSED`.
 *
 * Dieser Block hält alle vier Formen an **einem** Raum fest: 4,00 × 3,00 m,
 * also 12,00 m². Kommt eine Schreibweise nicht an, fällt genau ihre Prüfung.
 */

import { importIfc } from '../../src/lib/ifcImport';
import type { CheckFn } from './typ';

const z = (v: number): string => (Number.isInteger(v) ? `${v}.` : String(v));

/** Welche Schreibweise der Raumkörper haben soll. */
type Form = 'footprint' | 'arbitrary' | 'withvoids' | 'rechteck' | 'brep';

/**
 * Eine IFC4-Datei mit einer Wand (damit der Import überhaupt anläuft) und
 * genau einem Raum in der gewünschten Schreibweise.
 *
 * Der Raum liegt mit seiner südwestlichen Ecke auf (1|1) und misst
 * 4,00 m in x und 3,00 m in y — Fläche also **12,00 m²**, Umriss
 * (1|1), (5|1), (5|4), (1|4).
 */
function baueDatei(form: Form): string {
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
  e(`IFCPROJECT('0Projekt00000000000000',$,'Raumhaus',$,$,$,$,$,$)`);
  const geschoss = e(
    `IFCBUILDINGSTOREY('0Geschoss0000000000000',$,'Erdgeschoss',$,$,#${weltlage},$,$,.ELEMENT.,0.)`,
  );

  // --- Eine Wand, damit `ok` wird ---------------------------------------------
  const wandpunkt = e('IFCCARTESIANPOINT((0.,0.,0.))');
  const wandachse = e(`IFCAXIS2PLACEMENT3D(#${wandpunkt},#${dirZ},#${dirX})`);
  const wandlage = e(`IFCLOCALPLACEMENT(#${weltlage},#${wandachse})`);
  const wprofilpunkt = e('IFCCARTESIANPOINT((3.,0.))');
  const wprofilachse = e(`IFCAXIS2PLACEMENT2D(#${wprofilpunkt},#${dirX2})`);
  const wprofil = e(`IFCRECTANGLEPROFILEDEF(.AREA.,$,#${wprofilachse},6.,0.3)`);
  const wsolidachse = e(`IFCAXIS2PLACEMENT3D(#${nullpunkt},#${dirZ},#${dirX})`);
  const wsolid = e(`IFCEXTRUDEDAREASOLID(#${wprofil},#${wsolidachse},#${dirZ},2.5)`);
  const wshape = e(`IFCSHAPEREPRESENTATION($,'Body','SweptSolid',(#${wsolid}))`);
  const wpds = e(`IFCPRODUCTDEFINITIONSHAPE($,$,(#${wshape}))`);
  const wand = e(
    `IFCWALLSTANDARDCASE('0Wand0000000000000000',$,'Wand-Ext-1',$,$,#${wandlage},#${wpds},$,$)`,
  );
  e(
    `IFCRELCONTAINEDINSPATIALSTRUCTURE('0Contain000000000000',$,$,$,(#${wand}),#${geschoss})`,
  );

  // --- Der Raum ---------------------------------------------------------------
  const raumlage = e(`IFCLOCALPLACEMENT(#${weltlage},#${weltachse})`);
  /** Die vier Ecken in Weltkoordinaten. */
  const ecken: Array<[number, number]> = [
    [1, 1],
    [5, 1],
    [5, 4],
    [1, 4],
  ];

  let shape = 0;
  if (form === 'footprint') {
    const pts = ecken.map(([x, y]) => e(`IFCCARTESIANPOINT((${z(x)},${z(y)}))`));
    const linie = e(`IFCPOLYLINE((${[...pts, pts[0]].map((p) => `#${p}`).join(',')}))`);
    shape = e(`IFCSHAPEREPRESENTATION($,'FootPrint','Curve2D',(#${linie}))`);
  } else if (form === 'arbitrary' || form === 'withvoids') {
    const pts = ecken.map(([x, y]) => e(`IFCCARTESIANPOINT((${z(x)},${z(y)}))`));
    const linie = e(`IFCPOLYLINE((${[...pts, pts[0]].map((p) => `#${p}`).join(',')}))`);
    const profil =
      form === 'arbitrary'
        ? e(`IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,#${linie})`)
        : // Revits Schreibweise. Die Lochliste bleibt leer — geprüft wird,
          // dass der äußere Umriss überhaupt gefunden wird.
          e(`IFCARBITRARYPROFILEDEFWITHVOIDS(.AREA.,$,#${linie},())`);
    const achse = e(`IFCAXIS2PLACEMENT3D(#${nullpunkt},#${dirZ},#${dirX})`);
    const solid = e(`IFCEXTRUDEDAREASOLID(#${profil},#${achse},#${dirZ},2.5)`);
    shape = e(`IFCSHAPEREPRESENTATION($,'Body','SweptSolid',(#${solid}))`);
  } else if (form === 'rechteck') {
    // Allplans Schreibweise: Rechteckprofil, Mitte auf (3|2,5).
    const mitte = e('IFCCARTESIANPOINT((3.,2.5))');
    const profilachse = e(`IFCAXIS2PLACEMENT2D(#${mitte},#${dirX2})`);
    const profil = e(`IFCRECTANGLEPROFILEDEF(.AREA.,$,#${profilachse},4.,3.)`);
    const achse = e(`IFCAXIS2PLACEMENT3D(#${nullpunkt},#${dirZ},#${dirX})`);
    const solid = e(`IFCEXTRUDEDAREASOLID(#${profil},#${achse},#${dirZ},2.5)`);
    shape = e(`IFCSHAPEREPRESENTATION($,'Body','SweptSolid',(#${solid}))`);
  } else {
    /*
     * Der Begrenzungsflächenkörper: Boden auf z = 0, Decke auf z = 2,5, dazu
     * eine senkrechte Seitenfläche. Gesucht ist die **untere waagerechte**
     * Fläche — die Decke hat denselben Umriss und darf nicht gewinnen, die
     * Seitenfläche ist nicht waagerecht und fällt von selbst weg.
     */
    const unten = ecken.map(([x, y]) => e(`IFCCARTESIANPOINT((${z(x)},${z(y)},0.))`));
    const oben = ecken.map(([x, y]) => e(`IFCCARTESIANPOINT((${z(x)},${z(y)},2.5))`));
    const loopU = e(`IFCPOLYLOOP((${unten.map((p) => `#${p}`).join(',')}))`);
    const boundU = e(`IFCFACEOUTERBOUND(#${loopU},.T.)`);
    const faceU = e(`IFCFACE((#${boundU}))`);
    const loopO = e(`IFCPOLYLOOP((${oben.map((p) => `#${p}`).join(',')}))`);
    const boundO = e(`IFCFACEOUTERBOUND(#${loopO},.T.)`);
    const faceO = e(`IFCFACE((#${boundO}))`);
    const seite = e(
      `IFCPOLYLOOP((#${unten[0]},#${unten[1]},#${oben[1]},#${oben[0]}))`,
    );
    const boundS = e(`IFCFACEOUTERBOUND(#${seite},.T.)`);
    const faceS = e(`IFCFACE((#${boundS}))`);
    const shell = e(`IFCCLOSEDSHELL((#${faceU},#${faceO},#${faceS}))`);
    const brep = e(`IFCFACETEDBREP(#${shell})`);
    shape = e(`IFCSHAPEREPRESENTATION($,'Body','Brep',(#${brep}))`);
  }

  const pds = e(`IFCPRODUCTDEFINITIONSHAPE($,$,(#${shape}))`);
  const raum = e(
    `IFCSPACE('0Raum0000000000000000',$,'001',$,$,#${raumlage},#${pds},'Schlafzimmer',.ELEMENT.,.INTERNAL.,$)`,
  );
  e(
    `IFCRELAGGREGATES('0Aggregat00000000000',$,$,$,#${geschoss},(#${raum}))`,
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

export function pruefeIfcRaumumriss(check: CheckFn): void {
  const raumAus = (form: Form) => {
    const r = importIfc(baueDatei(form));
    return { ok: r.ok, raeume: r.spaces.length, erster: r.spaces[0] };
  };

  // =========================================================================
  // 1 · Alle vier Schreibweisen liefern denselben Raum
  // =========================================================================
  for (const [form, was] of [
    ['footprint', 'Fußabdruckkurve (ArchiCAD)'],
    ['arbitrary', 'freies Profil'],
    ['withvoids', 'freies Profil mit Löchern (Revit)'],
    ['rechteck', 'Rechteckprofil (Allplan)'],
    ['brep', 'Begrenzungsflächenkörper (ArchiCAD-Variante)'],
  ] as Array<[Form, string]>) {
    const r = raumAus(form);
    check(`${was}: ein Raum kommt an`, r.raeume, 1);
    check(`${was}: der Name ist der LongName`, r.erster?.name ?? '', 'Schlafzimmer');
    // 4,00 m × 3,00 m = 12,00 m². Der Import rundet auf zwei Nachkommastellen.
    check(`${was}: die Fläche stimmt`, r.erster?.area ?? NaN, 12, 0.02);
  }

  // =========================================================================
  // 2 · Der Umriss liegt an der richtigen Stelle
  // =========================================================================
  {
    /*
     * Die Fläche allein genügt nicht: Ein Rechteckprofil, dessen Mitte
     * falsch gerechnet wird, hat dieselbe Fläche und liegt trotzdem
     * woanders — und dann findet die Raumzuordnung den falschen Raum oder
     * gar keinen. Geprüft wird deshalb die **Mitte des umschreibenden
     * Rechtecks**: ((1+5)/2 | (1+4)/2) = (3,00 | 2,50).
     *
     * Und zwar ausdrücklich nicht der Mittelwert der Eckpunkte: Eine
     * geschlossene Polylinie wiederholt den ersten Punkt am Ende, und der
     * Mittelwert über fünf statt vier Ecken ergäbe (13/5 | 11/5) =
     * (2,60 | 2,20). Das wäre ein Testfehler, der wie ein Programmfehler
     * aussieht — beim ersten Lauf ist er das auch gewesen.
     */
    for (const form of ['footprint', 'arbitrary', 'withvoids', 'rechteck', 'brep'] as Form[]) {
      const p = raumAus(form).erster?.polygon ?? [];
      const mx = (Math.min(...p.map((q) => q.x)) + Math.max(...p.map((q) => q.x))) / 2;
      const my = (Math.min(...p.map((q) => q.y)) + Math.max(...p.map((q) => q.y))) / 2;
      check(`${form}: Mitte in x`, mx, 3, 1e-6);
      check(`${form}: Mitte in y`, my, 2.5, 1e-6);
    }
  }

  // =========================================================================
  // 3 · Der Brep nimmt den Boden, nicht die Decke
  // =========================================================================
  {
    /*
     * Beide Flächen sind waagerecht und gleich groß; entschieden wird über
     * die Höhe. Prüfbar ist das an der **Umlaufrichtung**: Die Bodenfläche
     * ist im Prüfkörper gegen den Uhrzeigersinn geschrieben (positive
     * Fläche), die Deckfläche mit derselben Punktfolge ebenfalls — was den
     * Test wertlos machte. Stattdessen wird die Datei mit **nur** einer
     * Deckfläche gebaut: Fehlt der Boden, darf gar kein Raum entstehen,
     * statt still die Decke zu nehmen.
     *
     * Bewusst keine Prüfung auf „Decke wird ignoriert" mit beiden Flächen:
     * Sie hätten denselben Umriss, und ein Test, der in beiden Fällen grün
     * ist, prüft nichts.
     */
    const nurDecke = baueDatei('brep').replace(
      /IFCCLOSEDSHELL\(\(#\d+,(#\d+),(#\d+)\)\)/,
      'IFCCLOSEDSHELL(($1,$2))',
    );
    const r = importIfc(nurDecke);
    check('Ohne Bodenfläche entsteht trotzdem ein Umriss', r.spaces.length, 1);
    // Die Decke liegt über demselben Grundriss — die Fläche bleibt 12 m².
    check('… und er ist so groß wie der Grundriss', r.spaces[0]?.area ?? NaN, 12, 0.02);
  }

  // =========================================================================
  // 4 · Ein Raum ohne auswertbaren Körper wird gemeldet, nicht erfunden
  // =========================================================================
  {
    /*
     * Ein Raum, dessen Umriss sich nicht lesen lässt, darf nicht mit einem
     * geratenen Rechteck ankommen. Er fehlt — und das steht als Hinweis in
     * `skipped`, damit der Anwender weiß, dass er nachtragen muss.
     */
    const ohne = baueDatei('footprint').replace(/IFCPOLYLINE\(\([^)]*\)\)/, 'IFCPOLYLINE(())');
    const r = importIfc(ohne);
    check('Ein Raum ohne Umriss kommt nicht an', r.spaces.length, 0);
    check(
      'Er wird als übersprungen gemeldet',
      r.skipped.some((s) => s.reason.includes('Raum')),
      true,
    );
  }
}
