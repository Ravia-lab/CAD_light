/**
 * Prüfblock „IFC-Einheiten" — der Maßstab, den die Datei selbst nennt.
 * ---------------------------------------------------------------------------
 * **Der Fehler, der diesen Block ausgelöst hat.** Bis 1.32.0 las
 * `ifcImport.ts` jede Zahl als Meter. Das ging gut, solange geprüft wurde,
 * was ArchiCAD schreibt — dort steht `IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)`.
 * Gemessen an einem Korpus von 19 fremden Dateien schreibt aber die
 * **Mehrheit Millimeter**: Revit, Allplan, Vectorworks, Nemetschek, Renga;
 * eine brasilianische Datei sogar Zentimeter.
 *
 * Die Folge war keine Fehlermeldung. Dasselbe FZK-Haus des KIT kam aus
 * ArchiCAD mit 0,24 m Wandstärke an und aus Nemetschek mit **240** — Faktor
 * tausend, wortlos. Der Grundriss war dann 25 Kilometer breit.
 *
 * Für ein Werkzeug, dessen Ausgabe in eine Heizlastrechnung geht, ist das
 * die schlimmste Fehlerart überhaupt: Sie sieht aus wie ein Ergebnis. Eine
 * Wand von 240 m Dicke fällt einem Menschen auf; eine Fensterfläche, die um
 * den Faktor 10⁶ danebenliegt, steht in der Übergabedatei als Zahl und
 * niemand sieht sie wieder an.
 *
 * Geprüft wird deshalb viererlei:
 *
 *  1. **Dass umgerechnet wird** — Millimeter, Zentimeter, Zoll.
 *  2. **Dass aus der richtigen Quelle gelesen wird.** Revit-Dateien
 *     enthalten *zwei* Längeneinheiten; maßgeblich ist die, auf die
 *     `IfcProject.UnitsInContext` zeigt. Wer die erste nimmt, die ihm über
 *     den Weg läuft, hat in der Hälfte der Fälle recht — das ist keine
 *     Regel, das ist ein Münzwurf.
 *  3. **Dass der Faktor alles erfasst**, was eine Länge ist: Knoten,
 *     Wandstärke, Wandhöhe, Geschosshöhe, Öffnungsmaße.
 *  4. **Dass die Rückfallebene Meter ist** — so steht es in ISO 16739, und
 *     eine Datei ohne Einheitenangabe darf nicht stillschweigend um den
 *     Faktor 1000 daneben liegen.
 *
 * Alle Sollwerte sind von Hand gerechnet; die Rechnung steht jeweils dabei.
 */

import { importIfc } from '../../src/lib/ifcImport';
import type { CheckFn } from './typ';

/** Zahl in STEP-Schreibweise — ganze Zahlen tragen dort einen Punkt. */
const z = (v: number): string => (Number.isInteger(v) ? `${v}.` : String(v));

interface Vorgabe {
  /** Was in `IFCSIUNIT` als Vorsatz steht, z. B. `MILLI`; leer = ohne Vorsatz. */
  vorsatz?: string;
  /** Statt SI-Einheit eine umgerechnete Einheit (Zoll) mit diesem Faktor [m]. */
  zollfaktor?: number;
  /** Eine zweite, **nicht** zugewiesene Längeneinheit mit anderem Vorsatz. */
  zweiteEinheit?: string;
  /** Ganz ohne `IfcUnitAssignment` — die Rückfallebene der Norm. */
  ohneZuordnung?: boolean;
  /** Ein Vorsatz, den es nicht gibt. */
  unsinn?: boolean;
}

/**
 * Eine vollständige, kleine IFC4-Datei mit **einer** Wand und **einem**
 * Fenster, ausgedrückt in der gewünschten Einheit.
 *
 * Die Maße sind bewusst rund und in Metern gedacht; `f` rechnet sie in die
 * Dateieinheit um. Damit steht in jedem Lauf dasselbe Haus in der Datei, nur
 * anders beziffert — und der Import muss jedes Mal dieselben Meter liefern.
 *
 * Das Haus: eine Wand von (0|0) nach (5|0), 0,30 m dick, 2,50 m hoch, mit
 * einem Fenster von 1,20 m Breite und 1,40 m Höhe, dessen Mitte 2,50 m vom
 * Wandanfang entfernt bei 0,90 m Brüstung sitzt. Das Geschoss liegt auf 0.
 */
function baueDatei(v: Vorgabe): string {
  // Der Umrechnungsfaktor von Metern in die Dateieinheit.
  const proMeter = v.zollfaktor
    ? 1 / v.zollfaktor
    : v.vorsatz === 'MILLI'
      ? 1000
      : v.vorsatz === 'CENTI'
        ? 100
        : 1;
  const f = (meter: number) => z(Math.round(meter * proMeter * 1e6) / 1e6);

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

  // --- Die Einheiten ---------------------------------------------------------
  let zuordnung = '$';
  if (!v.ohneZuordnung) {
    const teile: number[] = [];
    if (v.zollfaktor) {
      // Zoll: `IfcConversionBasedUnit` mit dem Faktor im `IfcMeasureWithUnit`.
      const meter = e('IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)');
      const mass = e(`IFCMEASUREWITHUNIT(IFCLENGTHMEASURE(${z(v.zollfaktor)}),#${meter})`);
      const dimension = e('IFCDIMENSIONALEXPONENTS(1,0,0,0,0,0,0)');
      teile.push(e(`IFCCONVERSIONBASEDUNIT(#${dimension},.LENGTHUNIT.,'INCH',#${mass})`));
    } else {
      const vorsatz = v.unsinn ? '.FURLONG.' : v.vorsatz ? `.${v.vorsatz}.` : '$';
      teile.push(e(`IFCSIUNIT(*,.LENGTHUNIT.,${vorsatz},.METRE.)`));
    }
    teile.push(e('IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.)'));
    zuordnung = `#${e(`IFCUNITASSIGNMENT((${teile.map((t) => `#${t}`).join(',')}))`)}`;
  }

  /*
   * Die zweite, **nicht** zugewiesene Längeneinheit. Sie steht bewusst
   * *vor* dem Projekt in der Datei und kommt einer Textsuche damit zuerst
   * unter — genau die Falle, in die Revit-Dateien einen führen.
   */
  if (v.zweiteEinheit) e(`IFCSIUNIT(*,.LENGTHUNIT.,.${v.zweiteEinheit}.,.METRE.)`);

  e(`IFCPROJECT('0Projekt00000000000000',$,'Maßstabshaus',$,$,$,$,$,${zuordnung})`);
  const geschoss = e(
    `IFCBUILDINGSTOREY('0Geschoss0000000000000',$,'Erdgeschoss',$,$,#${weltlage},$,$,.ELEMENT.,0.)`,
  );

  // --- Die Wand --------------------------------------------------------------
  const wandpunkt = e('IFCCARTESIANPOINT((0.,0.,0.))');
  const wandachse = e(`IFCAXIS2PLACEMENT3D(#${wandpunkt},#${dirZ},#${dirX})`);
  const wandlage = e(`IFCLOCALPLACEMENT(#${weltlage},#${wandachse})`);
  const profilpunkt = e(`IFCCARTESIANPOINT((${f(2.5)},0.))`);
  const profilachse = e(`IFCAXIS2PLACEMENT2D(#${profilpunkt},#${dirX2})`);
  const profil = e(`IFCRECTANGLEPROFILEDEF(.AREA.,$,#${profilachse},${f(5)},${f(0.3)})`);
  const solidachse = e(`IFCAXIS2PLACEMENT3D(#${nullpunkt},#${dirZ},#${dirX})`);
  const solid = e(`IFCEXTRUDEDAREASOLID(#${profil},#${solidachse},#${dirZ},${f(2.5)})`);
  const shapeW = e(`IFCSHAPEREPRESENTATION($,'Body','SweptSolid',(#${solid}))`);
  const pdsW = e(`IFCPRODUCTDEFINITIONSHAPE($,$,(#${shapeW}))`);
  const wand = e(
    `IFCWALLSTANDARDCASE('0Wand0000000000000000',$,'Wand-Ext-1',$,$,#${wandlage},#${pdsW},$,$)`,
  );

  // --- Das Fenster -----------------------------------------------------------
  // Mitte bei 2,50 m auf der Achse, Brüstung 0,90 m über dem Fußboden.
  const oepunkt = e(`IFCCARTESIANPOINT((${f(2.5)},0.,${f(0.9)}))`);
  const oeachse = e(`IFCAXIS2PLACEMENT3D(#${oepunkt},#${dirZ},#${dirX})`);
  const oelage = e(`IFCLOCALPLACEMENT(#${wandlage},#${oeachse})`);
  const oeprofilpunkt = e('IFCCARTESIANPOINT((0.,0.))');
  const oeprofilachse = e(`IFCAXIS2PLACEMENT2D(#${oeprofilpunkt},#${dirX2})`);
  const oeprofil = e(
    `IFCRECTANGLEPROFILEDEF(.AREA.,$,#${oeprofilachse},${f(1.2)},${f(0.4)})`,
  );
  const oesolidachse = e(`IFCAXIS2PLACEMENT3D(#${nullpunkt},#${dirZ},#${dirX})`);
  const oesolid = e(
    `IFCEXTRUDEDAREASOLID(#${oeprofil},#${oesolidachse},#${dirZ},${f(1.4)})`,
  );
  const shapeO = e(`IFCSHAPEREPRESENTATION($,'Body','SweptSolid',(#${oesolid}))`);
  const pdsO = e(`IFCPRODUCTDEFINITIONSHAPE($,$,(#${shapeO}))`);
  const oeffnung = e(
    `IFCOPENINGELEMENT('0Oeffnung000000000000',$,'Fenster',$,$,#${oelage},#${pdsO},$,$)`,
  );
  e(`IFCRELVOIDSELEMENT('0Voids00000000000000',$,$,$,#${wand},#${oeffnung})`);
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

export function pruefeIfcEinheiten(check: CheckFn): void {
  /**
   * Die fünf Maße des Prüfhauses, wie sie nach dem Import dastehen müssen —
   * **unabhängig davon, wie die Datei sie beziffert**.
   */
  const maesse = (text: string) => {
    const r = importIfc(text);
    const w = r.walls[0];
    const knotenA = r.nodes.find((k) => k.id === w?.a);
    const knotenB = r.nodes.find((k) => k.id === w?.b);
    const o = r.openings[0];
    return {
      ok: r.ok,
      laenge:
        knotenA && knotenB ? Math.hypot(knotenB.x - knotenA.x, knotenB.y - knotenA.y) : NaN,
      dicke: w?.thickness ?? NaN,
      hoehe: w?.height ?? NaN,
      breite: o?.width ?? NaN,
      oeffnungshoehe: o?.height ?? NaN,
    };
  };

  // =========================================================================
  // 1 · Meter — der Fall, der schon immer stimmte
  // =========================================================================
  {
    const m = maesse(baueDatei({}));
    check('Eine Datei in Metern wird gelesen', m.ok, true);
    check('Wandlänge in Metern', m.laenge, 5, 1e-6);
    check('Wandstärke in Metern', m.dicke, 0.3, 1e-6);
    check('Wandhöhe in Metern', m.hoehe, 2.5, 1e-6);
    check('Fensterbreite in Metern', m.breite, 1.2, 1e-6);
  }

  // =========================================================================
  // 2 · Millimeter — die Mehrheit des Korpus
  // =========================================================================
  {
    /*
     * In der Datei stehen 5000, 300, 2500, 1200, 1400. Der Faktor ist
     * 10⁻³, also muss nach dem Import genau dasselbe herauskommen wie in
     * Abschnitt 1 — das ist der ganze Sinn der Sache.
     */
    const m = maesse(baueDatei({ vorsatz: 'MILLI' }));
    check('Millimeterdatei wird gelesen', m.ok, true);
    check('5000 mm sind 5 m', m.laenge, 5, 1e-6);
    check('300 mm sind 0,30 m', m.dicke, 0.3, 1e-6);
    check('2500 mm sind 2,50 m', m.hoehe, 2.5, 1e-6);
    check('1200 mm sind 1,20 m', m.breite, 1.2, 1e-6);
    check('1400 mm sind 1,40 m', m.oeffnungshoehe, 1.4, 1e-6);
  }

  // =========================================================================
  // 3 · Zentimeter
  // =========================================================================
  {
    // 500, 30, 250, 120, 140 in der Datei.
    const m = maesse(baueDatei({ vorsatz: 'CENTI' }));
    check('500 cm sind 5 m', m.laenge, 5, 1e-6);
    check('30 cm sind 0,30 m', m.dicke, 0.3, 1e-6);
    check('250 cm sind 2,50 m', m.hoehe, 2.5, 1e-6);
  }

  // =========================================================================
  // 4 · Zoll — über `IfcConversionBasedUnit`
  // =========================================================================
  {
    /*
     * Ein Zoll ist 0,0254 m. Die Datei enthält deshalb
     * 5 / 0,0254 = 196,850394 Zoll für die Wandlänge. Zurück muss davon
     * wieder genau 5 m werden; die Toleranz ist auf ein Zehntelmillimeter
     * gesetzt, weil die Datei gerundet geschrieben wird.
     */
    const m = maesse(baueDatei({ zollfaktor: 0.0254 }));
    check('Eine Zolldatei wird gelesen', m.ok, true);
    check('196,85 Zoll sind 5 m', m.laenge, 5, 1e-4);
    check('11,81 Zoll sind 0,30 m', m.dicke, 0.3, 1e-4);
  }

  // =========================================================================
  // 5 · Zwei Längeneinheiten — es gilt die des Projekts
  // =========================================================================
  {
    /*
     * Die Falle aus den Revit-Dateien: Es stehen zwei
     * `IFCSIUNIT(*,.LENGTHUNIT.,…)` in der Datei. Hier ist die **zugewiesene**
     * Millimeter und die zweite, nicht zugewiesene, Meter — und die zweite
     * steht weiter vorn. Wer der Reihenfolge im Text folgt, liest Meter und
     * bekommt ein Haus von fünf Kilometern Länge.
     */
    const m = maesse(baueDatei({ vorsatz: 'MILLI', zweiteEinheit: 'DECI' }));
    check('Die zugewiesene Einheit gewinnt gegen die erstbeste', m.laenge, 5, 1e-6);
    check('Auch bei der Wandstärke', m.dicke, 0.3, 1e-6);
  }

  // =========================================================================
  // 6 · Ohne Angabe bleibt es bei Metern
  // =========================================================================
  {
    /*
     * ISO 16739 kennt keine Voreinstellung „Millimeter". Fehlt die
     * Zuordnung, ist die einzig vertretbare Annahme die SI-Basiseinheit —
     * und vor allem darf der Import nicht abstürzen. Eine Datei ohne
     * Einheiten ist selten, aber es gibt sie: Exporte aus Werkzeugen, die
     * nur Geometrie schreiben.
     */
    const m = maesse(baueDatei({ ohneZuordnung: true }));
    check('Ohne Einheitenzuordnung wird gelesen', m.ok, true);
    check('… und in Metern gerechnet', m.laenge, 5, 1e-6);

    const u = maesse(baueDatei({ unsinn: true }));
    check('Ein unbekannter Vorsatz führt nicht zum Absturz', u.ok, true);
    check('… und fällt auf Meter zurück', u.laenge, 5, 1e-6);
  }

  // =========================================================================
  // 7 · Der Faktor erfasst auch die Geschosshöhe
  // =========================================================================
  {
    /*
     * Die Geschosshöhe steht als Zahl im `IfcBuildingStorey` und geht nicht
     * durch die Punktauflösung — sie wäre die naheliegendste vergessene
     * Stelle. Geprüft an einer Millimeterdatei mit einem zweiten Geschoss
     * auf 3000 mm: daraus müssen 3,00 m werden, und die lichte Höhe des
     * unteren Geschosses ist dann 3,00 − 0,30 = 2,70 m (Deckenabzug im
     * Import).
     */
    const mitZweitem = baueDatei({ vorsatz: 'MILLI' }).replace(
      "ENDSEC;\nEND-ISO-10303-21;",
      "#9000=IFCBUILDINGSTOREY('0Geschoss0000000000001',$,'1. OG',$,$,$,$,$,.ELEMENT.,3000.);\nENDSEC;\nEND-ISO-10303-21;",
    );
    const r = importIfc(mitZweitem);
    const oben = r.levels.find((l) => l.name === '1. OG');
    check('Zwei Geschosse gelesen', r.levels.length, 2);
    check('3000 mm Geschosshöhe sind 3,00 m', oben?.elevation ?? NaN, 3, 1e-6);
    check('Die lichte Höhe unten folgt daraus', r.levels[0]?.height ?? NaN, 2.7, 1e-6);
  }
}
