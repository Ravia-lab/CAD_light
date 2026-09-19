/**
 * Prüfblock „Robustheit der Importe" — was passiert, wenn die Datei kaputt ist.
 * ---------------------------------------------------------------------------
 * **Warum das ein eigener Block ist.** Die übrigen Importprüfungen fragen, ob
 * eine *gute* Datei richtig ankommt. Dieser fragt das Gegenteil: was passiert
 * mit einer schlechten. Und das ist keine akademische Frage, sondern der
 * Alltag — eine Übertragung bricht ab, ein Exportlauf läuft in den
 * Speicherfehler, jemand zieht die halbe Datei in das Fenster, ein Programm
 * schreibt `NaN` in eine Koordinate, weil es selbst durch null geteilt hat.
 *
 * **Die drei Regeln, die hier gelten, und zwar ausnahmslos:**
 *
 *  1. **Kein Absturz.** Eine geworfene Ausnahme reißt in der Oberfläche den
 *     ganzen Zeichner mit; der Anwender sieht eine weiße Fläche und verliert
 *     seine Arbeit. Was auch immer in der Datei steht — der Import kommt
 *     zurück.
 *  2. **Kein stilles Ergebnis.** Eine Datei, die nicht gelesen werden kann,
 *     darf nicht als leeres, aber `ok`-gemeldetes Modell ankommen. Dann
 *     zeichnet jemand eine Stunde in ein Haus, das nie eingelesen wurde.
 *  3. **Keine erfundenen Zahlen.** Kommt etwas durch, muss es endlich sein.
 *     `NaN` in einer Wandlänge ist schlimmer als eine fehlende Wand: Es
 *     pflanzt sich durch Fläche, Volumen und Heizlast fort und taucht am
 *     Ende als leeres Feld im Nachweis auf, dessen Ursache niemand mehr
 *     findet.
 *
 * Die Fälle sind nicht ausgedacht, sondern die Formen, in denen Dateien
 * tatsächlich kaputtgehen: abgeschnitten, doppelt, leer, mit Steuerzeichen,
 * mit Ringverweisen, mit Zahlen jenseits des Darstellbaren.
 */

import { importIfc } from '../../src/lib/ifcImport';
import { importRaumplan, istRaumplanDatei } from '../../src/lib/raumplanImport';
import type { CheckFn } from './typ';

/** Eine kleine, wohlgeformte IFC4-Datei als Ausgangspunkt für Verstümmelungen. */
function guteIfcDatei(): string {
  const zeilen = [
    '#1=IFCDIRECTION((0.,0.,1.));',
    '#2=IFCDIRECTION((1.,0.,0.));',
    '#3=IFCDIRECTION((1.,0.));',
    '#4=IFCCARTESIANPOINT((0.,0.,0.));',
    '#5=IFCAXIS2PLACEMENT3D(#4,#1,#2);',
    '#6=IFCLOCALPLACEMENT($,#5);',
    "#7=IFCPROJECT('0Projekt00000000000000',$,'Prüfhaus',$,$,$,$,$,$);",
    "#8=IFCBUILDINGSTOREY('0Geschoss0000000000000',$,'EG',$,$,#6,$,$,.ELEMENT.,0.);",
    '#9=IFCCARTESIANPOINT((0.,0.,0.));',
    '#10=IFCAXIS2PLACEMENT3D(#9,#1,#2);',
    '#11=IFCLOCALPLACEMENT(#6,#10);',
    '#12=IFCCARTESIANPOINT((2.5,0.));',
    '#13=IFCAXIS2PLACEMENT2D(#12,#3);',
    '#14=IFCRECTANGLEPROFILEDEF(.AREA.,$,#13,5.,0.3);',
    '#15=IFCAXIS2PLACEMENT3D(#4,#1,#2);',
    '#16=IFCEXTRUDEDAREASOLID(#14,#15,#1,2.5);',
    "#17=IFCSHAPEREPRESENTATION($,'Body','SweptSolid',(#16));",
    '#18=IFCPRODUCTDEFINITIONSHAPE($,$,(#17));',
    "#19=IFCWALLSTANDARDCASE('0Wand0000000000000000',$,'Wand-Ext-1',$,$,#11,#18,$,$);",
    "#20=IFCRELCONTAINEDINSPATIALSTRUCTURE('0Contain000000000000',$,$,$,(#19),#8);",
  ];
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

/** Ein kleiner, wohlgeformter RoomPlan-Scan: vier Wände um 4 × 3 m. */
function guterScan(): string {
  /** Eine 4×4-Matrix in Spaltenordnung, wie RoomPlan sie schreibt. */
  const lage = (x: number, y: number, winkel: number): number[] => {
    const c = Math.cos(winkel);
    const s = Math.sin(winkel);
    // Spalten: x-Achse, y-Achse (= oben), z-Achse, Verschiebung.
    return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, x, 0, y, 1];
  };
  const wand = (
    id: string,
    x: number,
    y: number,
    winkel: number,
    laenge: number,
  ) => ({
    identifier: id,
    dimensions: [laenge, 2.5, 0.2],
    transform: lage(x, y, winkel),
    category: 'wall',
    confidence: 'high',
    completedEdges: ['bottom', 'top', 'left', 'right'],
  });
  return JSON.stringify({
    walls: [
      wand('w1', 2, 0, 0, 4),
      wand('w2', 4, 1.5, Math.PI / 2, 3),
      wand('w3', 2, 3, 0, 4),
      wand('w4', 0, 1.5, Math.PI / 2, 3),
    ],
    doors: [],
    windows: [],
    openings: [],
    objects: [],
  });
}

export function pruefeImportRobustheit(check: CheckFn): void {
  // =========================================================================
  // 1 · Der Ausgangspunkt ist gut — sonst prüft der Rest nichts
  // =========================================================================
  {
    const r = importIfc(guteIfcDatei());
    check('Die unversehrte Prüfdatei wird gelesen', r.ok && r.walls.length === 1, true);
    const s = importRaumplan(guterScan());
    check('Der unversehrte Prüfscan wird gelesen', s.ok, true);
    check('Vier Wände im Prüfscan', s.walls.length, 4);
  }

  // =========================================================================
  // 2 · IFC: verstümmelte Dateien
  // =========================================================================
  {
    const gut = guteIfcDatei();
    /**
     * Ein Fall gilt als bestanden, wenn der Import zurückkommt **und** kein
     * `ok` mit leerem Inhalt meldet **und** keine unendliche Zahl liefert.
     */
    const haelt = (name: string, text: string) => {
      let r: ReturnType<typeof importIfc> | null = null;
      let geworfen = '';
      try {
        r = importIfc(text);
      } catch (e) {
        geworfen = (e as Error).message ?? 'Ausnahme';
      }
      check(`${name}: kein Absturz`, geworfen, '');
      if (!r) return;
      check(`${name}: nichts ohne Meldung`, r.ok === false || r.message.length > 0, true);
      const kaputt =
        r.nodes.some((k) => !Number.isFinite(k.x) || !Number.isFinite(k.y)) ||
        r.walls.some((w) => !Number.isFinite(w.thickness) || !Number.isFinite(w.height)) ||
        r.openings.some(
          (o) => !Number.isFinite(o.distance) || !Number.isFinite(o.width) || !Number.isFinite(o.height),
        );
      check(`${name}: keine unendlichen Zahlen`, kaputt, false);
    };

    haelt('Leere Zeichenkette', '');
    haelt('Nur Leerzeichen', '   \n\t  ');
    haelt('Kein STEP', 'Das ist ein Brief an meine Tante.');
    // Die Hälfte der Datei — der häufigste Fall bei abgebrochener Übertragung.
    haelt('Mittendrin abgeschnitten', gut.slice(0, Math.floor(gut.length / 2)));
    // Nur der Kopf: sieht nach IFC aus und enthält nichts.
    haelt('Nur der Kopf', gut.slice(0, gut.indexOf('DATA;') + 5));
    haelt('Kopfzeile ohne Datenteil', 'ISO-10303-21;\nHEADER;\nENDSEC;\nEND-ISO-10303-21;');
    // Klammern, die nicht zugehen.
    haelt('Offene Klammer', gut.replace('IFCRECTANGLEPROFILEDEF(.AREA.,$,#13,5.,0.3)', 'IFCRECTANGLEPROFILEDEF(.AREA.,$,#13,5.,0.3'));
    // Verweis ins Leere: #99 gibt es nicht.
    haelt('Verweis ins Nichts', gut.replace('#14,#15,#1,2.5', '#99,#15,#1,2.5'));
    // Ein Verweis auf sich selbst — die Rekursionsbremse muss greifen.
    haelt('Verweis auf sich selbst', gut.replace('#6=IFCLOCALPLACEMENT($,#5);', '#6=IFCLOCALPLACEMENT(#6,#5);'));
    // Zahlen jenseits des Darstellbaren.
    haelt('Unendliche Koordinate', gut.replace('((2.5,0.))', '((1e400,0.))'));
    haelt('Text statt Zahl', gut.replace('#13,5.,0.3', "#13,'fünf',0.3"));
    haelt('Negative Wandstärke', gut.replace('#13,5.,0.3', '#13,5.,-0.3'));
    haelt('Wandstärke null', gut.replace('#13,5.,0.3', '#13,5.,0.'));
    haelt('Wandlänge null', gut.replace('#13,5.,0.3', '#13,0.,0.3'));
    // Steuerzeichen und Textkodierung.
    haelt('Null-Byte mittendrin', gut.replace('DATA;', 'DATA;\u0000'));
    haelt('Byte-Reihenfolgenmarke vorn', '﻿' + gut);
    haelt('Zeilenenden nach Windows', gut.replace(/\n/g, '\r\n'));
    haelt('Alles in einer Zeile', gut.replace(/\n/g, ' '));
    // Doppelte Entity-Nummern — kommt bei zusammengefügten Dateien vor.
    haelt('Dieselbe Nummer zweimal', gut.replace('#19=', '#18='));
    // Sehr tiefe Verschachtelung der Ortsangaben.
    {
      const tief = Array.from({ length: 300 }, (_, i) => `#${1000 + i}=IFCLOCALPLACEMENT(#${999 + i},#5);`).join('\n');
      haelt('300 Ebenen Ortsangabe', gut.replace('DATA;', 'DATA;\n' + tief));
    }
  }

  // =========================================================================
  // 3 · IFC: eine leere Datei meldet sich als leer
  // =========================================================================
  {
    /*
     * Der Unterschied, auf den es ankommt: `ok: false` **und** ein Satz, der
     * sagt warum. Ein `ok: false` ohne Meldung wäre in der Oberfläche ein
     * stummer Fehlschlag, und der Anwender probiert es dreimal.
     */
    const leer = importIfc('ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;');
    check('Eine leere IFC-Datei ist nicht ok', leer.ok, false);
    check('… und sagt warum', leer.message.length > 10, true);

    const keinStep = importIfc('{"walls":[]}');
    check('JSON wird nicht als IFC gelesen', keinStep.ok, false);
    check('… mit einem verständlichen Satz', keinStep.message.includes('STEP'), true);
  }

  // =========================================================================
  // 4 · Raumscan: verstümmelte Dateien
  // =========================================================================
  {
    const gut = guterScan();
    const haelt = (name: string, text: string) => {
      let r: ReturnType<typeof importRaumplan> | null = null;
      let geworfen = '';
      try {
        r = importRaumplan(text);
      } catch (e) {
        geworfen = (e as Error).message ?? 'Ausnahme';
      }
      check(`Scan ${name}: kein Absturz`, geworfen, '');
      if (!r) return;
      const kaputt =
        r.nodes.some((k) => !Number.isFinite(k.x) || !Number.isFinite(k.y)) ||
        r.walls.some((w) => !Number.isFinite(w.thickness) || !Number.isFinite(w.height));
      check(`Scan ${name}: keine unendlichen Zahlen`, kaputt, false);
    };

    haelt('leer', '');
    haelt('kein JSON', 'Guten Tag.');
    haelt('abgeschnitten', gut.slice(0, Math.floor(gut.length / 2)));
    haelt('leeres Objekt', '{}');
    haelt('Wandliste leer', '{"walls":[],"transform":[]}');
    haelt('Wand ohne Maße', gut.replace(/"dimensions":\[[^\]]*\]/, '"dimensions":[]'));
    haelt('Maße als Text', gut.replace(/"dimensions":\[4,2\.5,0\.2\]/, '"dimensions":["vier",2.5,0.2]'));
    haelt('Matrix zu kurz', gut.replace(/"transform":\[[^\]]*\]/, '"transform":[1,0,0]'));
    haelt('Matrix voller Nullen', gut.replace(/"transform":\[[^\]]*\]/, '"transform":[' + Array(16).fill(0).join(',') + ']'));
    haelt('Länge null', gut.replace('"dimensions":[4,2.5,0.2]', '"dimensions":[0,2.5,0.2]'));
    haelt('Länge negativ', gut.replace('"dimensions":[4,2.5,0.2]', '"dimensions":[-4,2.5,0.2]'));
    haelt('Höhe riesig', gut.replace('"dimensions":[4,2.5,0.2]', '"dimensions":[4,1e12,0.2]'));
    haelt('null statt Wand', gut.replace(/\{"identifier":"w2".*?"completedEdges":\["bottom","top","left","right"\]\}/, 'null'));
    haelt('Wände als Objekt statt Liste', gut.replace('"walls":[', '"walls":{"a":['). replace(/\}$/, '}}'));
    haelt('tief verschachtelt', '{"walls":' + '['.repeat(200) + ']'.repeat(200) + ',"transform":[]}');

    /*
     * Die Datei mit sich selbst verdoppelt. Das entsteht tatsächlich, wenn
     * jemand zweimal in dieselbe Datei exportiert — und ein JSON-Leser, der
     * das nicht abfängt, wirft.
     */
    haelt('zweimal hintereinander', gut + gut);
  }

  // =========================================================================
  // 5 · Die Erkennung wählt den richtigen Leser
  // =========================================================================
  {
    /*
     * `istRaumplanDatei` entscheidet, ob eine Datei an den Scanleser oder an
     * den Projektleser geht. Verwechselt sie sich, bekommt der Anwender
     * „Datei konnte nicht gelesen werden" für eine völlig gesunde Datei —
     * genau das ist bei einem echten Scan schon passiert, weil das USD-Netz
     * vorn 700 kB belegt und `roomData` erst danach kommt.
     */
    check('Ein Scan wird als Scan erkannt', istRaumplanDatei(guterScan()), true);
    check('Eine IFC-Datei nicht', istRaumplanDatei(guteIfcDatei()), false);
    check('Leerer Text nicht', istRaumplanDatei(''), false);
    check('Ein Projekt-JSON nicht', istRaumplanDatei('{"meta":{},"walls":{}}'), false);

    // `roomData` weit hinten — 700 kB Füllung davor.
    const spaet = '{"fueller":"' + 'A'.repeat(700_000) + '","roomData":{"walls":[]}}';
    check('Auch wenn „roomData" erst nach 700 kB kommt', istRaumplanDatei(spaet), true);
  }

  // =========================================================================
  // 6 · Große Dateien laufen in vertretbarer Zeit
  // =========================================================================
  {
    /*
     * Keine Mikrosekundenmessung — geprüft wird eine **Größenordnung**. Der
     * Korpus fremder Dateien reicht bis 54 MB (das Revit-Musterprojekt), und
     * der Import braucht dafür rund 2,6 Sekunden. Was hier fällt, ist nicht
     * ein langsamer Rechner, sondern ein quadratisch gewordener Algorithmus:
     * Verzehnfacht sich die Zeit bei verzehnfachter Datei nicht, sondern
     * verhundertfacht sie sich, steht die Oberfläche minutenlang.
     *
     * Gemessen wird an 400 Wänden — genug, dass eine quadratische Stelle
     * auffällt, und wenig genug, dass der Prüflauf nicht darauf wartet.
     */
    let n = 20;
    const zeilen: string[] = [];
    const e = (t: string) => {
      n += 1;
      zeilen.push(`#${n}=${t};`);
      return n;
    };
    const wandIds: number[] = [];
    for (let i = 0; i < 400; i += 1) {
      const p = e(`IFCCARTESIANPOINT((${i * 6}.,0.,0.))`);
      const a = e(`IFCAXIS2PLACEMENT3D(#${p},#1,#2)`);
      const l = e(`IFCLOCALPLACEMENT(#6,#${a})`);
      const pp = e('IFCCARTESIANPOINT((2.5,0.))');
      const pa = e(`IFCAXIS2PLACEMENT2D(#${pp},#3)`);
      const pr = e(`IFCRECTANGLEPROFILEDEF(.AREA.,$,#${pa},5.,0.3)`);
      const sa = e(`IFCAXIS2PLACEMENT3D(#4,#1,#2)`);
      const so = e(`IFCEXTRUDEDAREASOLID(#${pr},#${sa},#1,2.5)`);
      const sh = e(`IFCSHAPEREPRESENTATION($,'Body','SweptSolid',(#${so}))`);
      const pd = e(`IFCPRODUCTDEFINITIONSHAPE($,$,(#${sh}))`);
      wandIds.push(
        e(
          `IFCWALLSTANDARDCASE('0W${String(i).padStart(20, '0')}',$,'Wand-Ext-${i}',$,$,#${l},#${pd},$,$)`,
        ),
      );
    }
    e(
      `IFCRELCONTAINEDINSPATIALSTRUCTURE('0Contain000000000001',$,$,$,(${wandIds
        .map((w) => `#${w}`)
        .join(',')}),#8)`,
    );
    const gross = guteIfcDatei().replace('ENDSEC;\nEND-ISO-10303-21;', zeilen.join('\n') + '\nENDSEC;\nEND-ISO-10303-21;');

    const t0 = Date.now();
    const r = importIfc(gross);
    const dauer = Date.now() - t0;
    check('400 zusätzliche Wände kommen an', r.walls.length >= 400, true);
    check('… in unter fünf Sekunden', dauer < 5000, true);
  }

  // =========================================================================
  // 7 · Der Raumscan hängt nicht davon ab, wie man im Raum stand
  // =========================================================================
  {
    /*
     * **Die stärkste Probe, die ein Scanimport bestehen kann.** Wer eine
     * Wohnung aufnimmt, steht dabei irgendwo und schaut irgendwohin; das
     * iPhone legt seinen Nullpunkt dorthin, wo der Scan begann. Dieselbe
     * Wohnung, zweimal gescannt, kommt deshalb zweimal anders gedreht aus
     * dem Gerät — und muss trotzdem zweimal dasselbe Haus ergeben.
     *
     * Geprüft wird an einer starren Drehung des ganzen Scans um 37°: ein
     * Winkel ohne runde Sinus- und Kosinuswerte, damit kein Rechenfehler
     * sich in einer Null versteckt. Verglichen werden die **Wandlängen**,
     * weil sie unter einer Drehung erhalten bleiben müssen — und weil das
     * Geraderücken (`vorzugsrichtung`) genau hier eingreift: Es dreht den
     * Plan auf die Hauptachse zurück, und wenn es das richtig tut, ist von
     * den 37° am Ende nichts mehr zu sehen.
     *
     * Die Toleranz ist ein Zehntelmillimeter. Das ist keine Großzügigkeit,
     * sondern Fließkomma: sin(37°) hat keine endliche Darstellung.
     */
    const dreheScan = (text: string, winkel: number): string => {
      const c = Math.cos(winkel);
      const s = Math.sin(winkel);
      const scan = JSON.parse(text) as { walls: Array<{ transform: number[] }> };
      for (const w of scan.walls) {
        const t = w.transform;
        // Spaltenordnung: [0..3] x-Achse, [4..7] y-Achse, [8..11] z-Achse,
        // [12..15] Verschiebung. Gedreht wird um die senkrechte Achse (y),
        // also in der x-z-Ebene — das ist die Bodenebene von RoomPlan.
        const dreh = (ax: number, az: number): [number, number] => [ax * c - az * s, ax * s + az * c];
        [t[0], t[2]] = dreh(t[0], t[2]);
        [t[8], t[10]] = dreh(t[8], t[10]);
        [t[12], t[14]] = dreh(t[12], t[14]);
      }
      return JSON.stringify(scan);
    };

    const laengen = (text: string): number[] => {
      const r = importRaumplan(text);
      const kn = new Map(r.nodes.map((k) => [k.id, k]));
      return r.walls
        .map((w) => {
          const a = kn.get(w.a);
          const b = kn.get(w.b);
          return a && b ? Math.hypot(b.x - a.x, b.y - a.y) : NaN;
        })
        .sort((x, y) => x - y);
    };

    const gerade = laengen(guterScan());
    const schief = laengen(dreheScan(guterScan(), (37 * Math.PI) / 180));
    check('Gedreht kommen gleich viele Wände an', schief.length, gerade.length);
    check(
      'Jede Wandlänge bleibt gleich',
      gerade.every((l, i) => Math.abs(l - (schief[i] ?? NaN)) < 1e-4),
      true,
    );
    // Der Prüfscan ist 4,00 × 3,00 m in der Achse: 2 × 4 + 2 × 3 = 14,00 m.
    const summe = gerade.reduce((s, l) => s + l, 0);
    check('Die Summe der Wandlängen stimmt', summe, 14, 0.35);

    /*
     * Und die Gegenprobe, damit die Prüfung oben nicht aus Versehen grün
     * ist: Wird **eine** Wand um einen halben Meter verkürzt, muss sich die
     * Summe messbar ändern. Ein Test, der jede Eingabe besteht, prüft
     * nichts.
     */
    const kuerzer = guterScan().replace('"dimensions":[4,2.5,0.2]', '"dimensions":[3.5,2.5,0.2]');
    const summeKurz = laengen(kuerzer).reduce((s, l) => s + l, 0);
    check('Eine kürzere Wand ändert die Summe', Math.abs(summe - summeKurz) > 0.3, true);
  }
}
