/**
 * Prüfblock für die Raumerkennung und ihre Diagnose.
 *
 * Anlass ist eine Meldung aus der Praxis: in einer Wohnung wurden zehn Zimmer
 * erkannt, der Flur dazwischen nicht — „obwohl die Kanten abgeschlossen sind".
 * Die Nachrechnung gab dem Anwender recht und unrecht zugleich: jedes einzelne
 * Wandende hatte einen Anschluss, aber zwischen zwei Bauteilen fehlte ein
 * Wandstück von 1,50 m. Der Flur hing dadurch am Außenbereich und fiel als
 * unbeschränkte Facette heraus. Gemeldet wurde nichts, weil die bisherige
 * Prüfung nur Enden mit Grad 1 kennt — und an einer solchen Lücke hat jedes
 * Ende Grad 2.
 *
 * Dieser Block hält beides fest: dass ein solcher Grundriss vollständig
 * erkannt wird, sobald das Wandstück da ist, und dass sein Fehlen benannt
 * wird, wenn es fehlt.
 *
 * **Herkunft der Sollwerte.** Kein Wert ist aus einem Probelauf übernommen.
 * Die lichten Flächen sind von Hand hergeleitet: die Raumerkennung versetzt
 * jede Achskante um die halbe Stärke *ihrer* Wand nach innen, ein Rechteck
 * zwischen den Achsen wird also
 *
 *     A = (Δx − (t_links + t_rechts)/2) · (Δy − (t_oben + t_unten)/2).
 *
 * Jeder Sollwert unten steht als genau dieses Produkt da, mit den Achsmaßen
 * und Wandstärken des Grundrisses. Die Summe ist die Summe dieser Produkte.
 *
 * **Zur Lesart „3 mm offener Stoß".** Eine 3-mm-Fuge liegt innerhalb der
 * Schweiß-Toleranz von 5 cm; der Raum entsteht also. Was *nicht* entstehen
 * darf, ist Schweigen: die Fuge steht weiter im Modell, geht ins Aufmaß und
 * in den Export. Geprüft wird deshalb beides — dass der Raum trotz der Fuge
 * erkannt wird *und* dass die Fuge mit ihrem Maß gemeldet wird. Die
 * Gegenprobe dazu ist eine Fuge jenseits der Toleranz: dort verschwindet der
 * Raum wirklich, und die Meldung wechselt vom Hinweis zum offenen Wandende.
 */

import type { CheckFn } from './typ';
import type { BimNode, Opening, Room, Wall } from '../../src/types/bim';
import {
  detectRooms,
  diagnoseClosure,
  findOpenEnds,
  MAX_GAP,
  WELD_TOLERANCE,
  type ClosureIssue,
  type ClosureIssueKind,
} from '../../src/lib/roomDetection';
import { polygonArea } from '../../src/lib/geometry';
import { REMEDIES, validateModel } from '../../src/lib/validation';
import { buildReferenceDocument } from '../reference';

// ---------------------------------------------------------------------------
// Hilfen
// ---------------------------------------------------------------------------

interface Modell {
  nodes: Record<string, BimNode>;
  walls: Wall[];
}

/**
 * Baut ein Modell aus Achsstrecken.
 *
 * Jede Strecke bekommt eigene Knoten — genau wie beim freien Zeichnen, wo zwei
 * Wände sich nicht deshalb einen Knoten teilen, weil sie zufällig am selben
 * Punkt enden. Das ist Absicht: die Topologie muss aus der Geometrie kommen,
 * sonst prüft der Block die Heilung gar nicht.
 */
function modell(strecken: { id: string; a: [number, number]; b: [number, number]; t?: number; typ?: Wall['type'] }[]): Modell {
  const nodes: Record<string, BimNode> = {};
  const walls: Wall[] = [];
  let n = 0;
  const knoten = (x: number, y: number): string => {
    const id = `n${n++}`;
    nodes[id] = { id, x, y, levelId: 'eg' };
    return id;
  };
  for (const s of strecken) {
    walls.push({
      id: s.id,
      a: knoten(s.a[0], s.a[1]),
      b: knoten(s.b[0], s.b[1]),
      thickness: s.t ?? 0.2,
      height: 2.75,
      type: s.typ ?? 'interior',
      layerId: 'layer-walls',
      levelId: 'eg',
    });
  }
  return { nodes, walls };
}

/** Eine Achsstrecke, wie `modell` sie erwartet. */
type Strecke = { id: string; a: [number, number]; b: [number, number]; t?: number; typ?: Wall['type'] };

/**
 * Zeichnet die Strecken **nacheinander** und legt die Räume nach Kennung ab.
 *
 * Genau so arbeitet das Dokument: nach jeder Wand läuft die Raumerkennung neu,
 * bekommt den vorigen Stand als `previous` mit und schreibt das Ergebnis in
 * `Record<RoomId, Room>`. Wer nur einmal am fertigen Grundriss prüft, sieht
 * den Fehler nicht — die Facettensuche findet alle Zellen. Verloren gehen sie
 * erst beim Ablegen, wenn zwei Räume dieselbe Kennung geerbt haben.
 *
 * Zurück kommt beides: was die Erkennung im letzten Durchgang gefunden hat und
 * was davon im Dokument ankommt. Auseinanderfallen dürfen die beiden nie.
 */
function nacheinander(strecken: Strecke[]): { erkannt: number; abgelegt: Room[]; doppelt: number } {
  let vorher: Room[] = [];
  let erkannt: Room[] = [];
  let doppelt = 0;
  for (let i = 1; i <= strecken.length; i++) {
    const m = modell(strecken.slice(0, i));
    erkannt = detectRooms({
      walls: m.walls,
      nodes: m.nodes,
      openings: [],
      levelId: 'eg',
      defaultHeight: 2.75,
      northAngle: 0,
      previous: vorher,
    });
    doppelt += erkannt.length - new Set(erkannt.map((r) => r.id)).size;
    vorher = Object.values(Object.fromEntries(erkannt.map((r) => [r.id, r])));
  }
  return { erkannt: erkannt.length, abgelegt: vorher, doppelt };
}

/** Summe der lichten Flächen einer Raumliste. */
const summe = (raeume: Room[]): number => raeume.reduce((s, r) => s + r.area, 0);

/** Außenrechteck als vier Strecken. */
const huelle = (b: number, h: number, t: number): Strecke[] => [
  { id: 'a1', a: [0, 0], b: [b, 0], t, typ: 'exterior' },
  { id: 'a2', a: [b, 0], b: [b, h], t, typ: 'exterior' },
  { id: 'a3', a: [b, h], b: [0, h], t, typ: 'exterior' },
  { id: 'a4', a: [0, h], b: [0, 0], t, typ: 'exterior' },
];

function raeume(m: Modell, openings: Opening[] = []) {
  return detectRooms({
    walls: m.walls,
    nodes: m.nodes,
    openings,
    levelId: 'eg',
    defaultHeight: 2.75,
    northAngle: 0,
  });
}

const flaechensumme = (m: Modell, openings: Opening[] = []): number =>
  raeume(m, openings).reduce((s, r) => s + r.area, 0);

/** Befunde einer Art. */
const nurArt = (befunde: ClosureIssue[], art: ClosureIssueKind): ClosureIssue[] =>
  befunde.filter((b) => b.kind === art);

/**
 * Das Maß eines einzelnen Befundes dieser Art — oder NaN.
 *
 * Warum nicht `?? 0`: eine Null ginge gegen jeden Sollwert als Zahl durch und
 * die Zeile könnte nur in eine Richtung scheitern. NaN ist gegen jeden
 * Sollwert falsch, auch gegen die Null.
 */
function massVon(befunde: ClosureIssue[], art: ClosureIssueKind): number {
  const treffer = nurArt(befunde, art);
  return treffer.length === 1 ? treffer[0].measure : Number.NaN;
}

/** Die eingeschlossene Fläche eines einzelnen Lücken-Befundes — oder NaN. */
function flaecheVon(befunde: ClosureIssue[]): number {
  const treffer = nurArt(befunde, 'gap');
  return treffer.length === 1 ? (treffer[0].enclosedArea ?? Number.NaN) : Number.NaN;
}

/** Enthält der Meldungstext diese Zeichenfolge? Trennt „fehlt" von „falsch". */
function meldung(befunde: ClosureIssue[], art: ClosureIssueKind): string {
  const treffer = nurArt(befunde, art);
  if (treffer.length === 0) return 'kein Befund';
  if (treffer.length > 1) return `${treffer.length} Befunde`;
  return treffer[0].message;
}

/** Steht diese Zeichenfolge in *jeder* Meldung dieser Art? */
function inJederMeldung(befunde: ClosureIssue[], art: ClosureIssueKind, teil: string): boolean {
  const treffer = nurArt(befunde, art);
  return treffer.length > 0 && treffer.every((t) => t.message.includes(teil));
}

// ---------------------------------------------------------------------------
// Der Wohnungsgrundriss aus der Meldung
// ---------------------------------------------------------------------------

/**
 * Achsraster der nachgebauten Wohnung.
 *
 * Die Maße stammen aus dem gemeldeten Grundriss: 11,25 m × 13,25 m
 * Außenkante, ein Rücksprung zwischen den beiden Gebäudeteilen, ein Flur, der
 * von Nord nach Süd durchläuft und sieben Zimmer erschließt. Charakteristisch
 * und deshalb hier erhalten: viele kurze Wandstücke, T-Stöße, drei
 * Wandstärken nebeneinander (17,5 / 19 / 11,5 cm), ein L-förmiges Büro und
 * eine Abstellkammer von 0,80 m² Achsfläche.
 */
const X = { x0: 0, x1: 3.5, x2: 4.572, x4: 5.666, x5: 6.251, x6: 7.472, x7: 9.712, x8: 10.02, x9: 11.25 };
const Y = { y0: 0, y1: 3.0, y2: 3.25, y3: 4.0, y4: 5.75, y5: 7.25, y6: 10.75, y7: 13.25 };

/** Wandstärken: Außenwand, schwere Trennwand, leichte Trennwand. */
const AW = 0.175;
const TW = 0.19;
const LW = 0.115;

/**
 * Die Wohnung. `ohne` lässt einzelne Wände weg — so entsteht aus demselben
 * Grundriss der Fehlerfall, ohne ihn ein zweites Mal zu beschreiben.
 */
function wohnung(ohne: string[] = []): Modell {
  const { x0, x1, x2, x4, x5, x6, x7, x8, x9 } = X;
  const { y0, y1, y2, y3, y4, y5, y6, y7 } = Y;
  const alle: { id: string; a: [number, number]; b: [number, number]; t?: number; typ?: Wall['type'] }[] = [
    // Gebäudehülle. Der Rücksprung zwischen y4 und y5 an der Westseite ist
    // gewollt — dort springt das Gebäude zurück, dort ist keine Wand.
    { id: 'w1', a: [x0, y0], b: [x9, y0], t: AW, typ: 'exterior' },
    { id: 'w2', a: [x9, y0], b: [x9, y7], t: AW, typ: 'exterior' },
    { id: 'w3', a: [x9, y7], b: [x1, y7], t: AW, typ: 'exterior' },
    { id: 'w4', a: [x1, y7], b: [x1, y5], t: TW, typ: 'exterior' },
    { id: 'w5', a: [x0, y0], b: [x0, y3], t: AW, typ: 'exterior' },
    { id: 'w6', a: [x0, y3], b: [x1, y3], t: TW, typ: 'exterior' },
    { id: 'w7', a: [x1, y3], b: [x1, y4], t: TW, typ: 'exterior' },
    { id: 'w8', a: [x1, y4], b: [x5, y4], t: TW, typ: 'exterior' },
    { id: 'w9', a: [x1, y5], b: [x5, y5], t: TW, typ: 'exterior' },
    // Innenwände
    { id: 'w10', a: [x1, y3], b: [x5, y3], t: TW },
    { id: 'w11', a: [x1, y0], b: [x1, y2], t: TW },
    { id: 'w12', a: [x1, y2], b: [x1, y3], t: TW },
    { id: 'w13', a: [x5, y0], b: [x5, y1], t: AW },
    { id: 'w14', a: [x5, y1], b: [x5, y3], t: AW },
    { id: 'w15', a: [x5, y3], b: [x5, y4], t: LW },
    // w16 ist das Wandstück, das im gemeldeten Modell fehlte.
    { id: 'w16', a: [x5, y4], b: [x5, y5], t: LW },
    { id: 'w17', a: [x5, y5], b: [x5, y6], t: LW },
    { id: 'w18', a: [x6, y1], b: [x6, y5], t: AW },
    { id: 'w19', a: [x6, y5], b: [x6, y6], t: AW },
    { id: 'w20', a: [x5, y1], b: [x9, y1], t: AW },
    { id: 'w21', a: [x8, y0], b: [x8, y1], t: LW },
    { id: 'w22', a: [x1, y2], b: [x2, y2], t: AW },
    { id: 'w23', a: [x2, y2], b: [x2, y3], t: LW },
    { id: 'w24', a: [x1, y6], b: [x9, y6], t: AW },
    { id: 'w25', a: [x6, y5], b: [x9, y5], t: TW },
    { id: 'w26', a: [x4, y6], b: [x4, y7], t: LW },
    { id: 'w27', a: [x7, y6], b: [x7, y7], t: LW },
  ];
  return modell(alle.filter((s) => !ohne.includes(s.id)));
}

/**
 * Öffnungen an Stoßstellen.
 *
 * Sie ändern an der Topologie nichts — genau das ist die Aussage. Eine Tür,
 * die die ganze Flurbreite einnimmt, und ein Fenster dicht an der Gebäudeecke
 * sind die Fälle, in denen ein Öffnungs-basiertes Verfahren die Wand verlöre.
 */
function oeffnungen(): Opening[] {
  return [
    // Flurtür in der Wand zwischen Flur und Raum 9, über die volle Flurbreite
    { id: 'o1', wallId: 'w24', kind: 'door', distance: X.x5 - X.x1 + 0.61, width: 1.221, height: 2.01, sillHeight: 0 },
    // Fenster 30 cm neben der Gebäudeecke
    { id: 'o2', wallId: 'w1', kind: 'window', distance: 0.3 + 0.6, width: 1.2, height: 1.35, sillHeight: 0.9 },
  ];
}

// ---------------------------------------------------------------------------
// Der Prüfblock
// ---------------------------------------------------------------------------

export function pruefeRaumerkennung(check: CheckFn): void {
  // -- 1. Der Grundriss aus der Meldung, vollständig ------------------------
  //
  // Dreizehn Räume. Die lichten Flächen von Hand, Rechteck für Rechteck:
  //
  //   Schlafzimmer   (3,500 − (0,175+0,190)/2) · (4,000 − (0,175+0,190)/2)
  //                  = 3,3175 · 3,8175                         = 12,66456
  //   Büro (L)       Rechteck 2,5685 · 3,8175 abzüglich der
  //                  Nische 1,0345 · 0,7425 = 9,80525 − 0,76812 =  9,03713
  //   Abstellkammer  0,9195 · 0,5675                           =  0,52182
  //   Raum 5         3,624  · 2,825                            = 10,23780
  //   Raum 6         1,085  · 2,825                            =  3,06513
  //   Waschküche     2,5985 · 1,560                            =  4,05366
  //   Wohnzimmer     3,603  · 4,0675                           = 14,65520
  //   Bad            2,5985 · 3,3175                           =  8,62052
  //   Schlafen       3,603  · 3,3175                           = 11,95295
  //   Küche          2,0135 · 2,325                            =  4,68139
  //   Raum 9         3,931  · 2,325                            =  9,13958
  //   Raum 10        1,393  · 2,325                            =  3,23872
  //   Flur           1,076  · 7,575                            =  8,15070
  //                                                    Summe   = 100,01915
  //
  // Der Flur bekommt links 11,5 cm (die vier Wandstücke der Ostseite von
  // Waschküche und Bad sind gleich stark), rechts, oben und unten 17,5 cm.
  const ganz = wohnung();
  const raeumeGanz = raeume(ganz, oeffnungen());
  check('Wohnungsgrundriss: alle dreizehn Räume erkannt', raeumeGanz.length, 13);
  check('Wohnungsgrundriss: Summe der lichten Flächen', flaechensumme(ganz, oeffnungen()), 100.01915, 0.001);
  check('Wohnungsgrundriss: der Flur ist dabei', raeumeGanz.filter((r) => Math.abs(r.area - 8.1507) < 0.001).length, 1);
  // Die Kammer mit 0,80 m² Achsfläche liegt über der Artefaktgrenze und muss
  // erhalten bleiben — sie ist der Grenzfall nach unten.
  check('Wohnungsgrundriss: die Abstellkammer bleibt erhalten', raeumeGanz.filter((r) => Math.abs(r.area - 0.52182) < 0.001).length, 1);
  check('Wohnungsgrundriss: kein offenes Wandende', findOpenEnds(ganz.walls, ganz.nodes).length, 0);

  // Der Rücksprung an der Westseite ist selbst eine Lücke von 1,50 m — er ist
  // gewollt, aber er sieht wie eine vergessene Wand aus, und deshalb wird er
  // gemeldet. Hinter ihm liegen 2,751 · 1,500 = 4,1265 m² Achsfläche.
  const befundeGanz = diagnoseClosure({ walls: ganz.walls, nodes: ganz.nodes });
  check('Der gewollte Rücksprung wird als Lücke benannt', nurArt(befundeGanz, 'gap').length, 1);
  check('… mit seiner Breite', massVon(befundeGanz, 'gap'), 1.5, 0.001);
  check('… und der Fläche dahinter', flaecheVon(befundeGanz), 4.1265, 0.001);
  check('Sonst ist an dem Grundriss nichts zu beanstanden', befundeGanz.length, 1);

  // -- 2. Derselbe Grundriss ohne das Wandstück w16 -------------------------
  //
  // Der gemeldete Fall. Ohne w16 hängt der Flur über den Rücksprung am
  // Außenbereich; die Facette wird unbeschränkt und fällt heraus. Übrig
  // bleiben zwölf Räume, es fehlen die 8,15070 m² des Flurs.
  const offen = wohnung(['w16']);
  const raeumeOffen = raeume(offen, oeffnungen());
  check('Ohne das Wandstück fehlt genau ein Raum', raeumeOffen.length, 12);
  check('… und zwar der Flur', flaechensumme(offen, oeffnungen()), 100.01915 - 8.1507, 0.001);
  // Der Kern der Meldung: jedes Wandende hat einen Anschluss. Die bisherige
  // Prüfung kann hier nichts finden — und fand deshalb nichts.
  check('Kein einziges Wandende ist frei', findOpenEnds(offen.walls, offen.nodes).length, 0);

  const befundeOffen = diagnoseClosure({ walls: offen.walls, nodes: offen.nodes });
  check('Trotzdem wird die Stelle benannt', nurArt(befundeOffen, 'gap').length, 1);
  check('… mit der Lückenbreite', massVon(befundeOffen, 'gap'), 1.5, 0.001);
  // Jetzt liegen Rücksprung *und* Flur hinter der Lücke: 4,1265 + 8,15070 an
  // lichter Fläche ist nicht der Sollwert — gemessen wird an den Achsen, und
  // die Achsfläche des Flurs ist 1,221 · 7,750 = 9,46275 m².
  check('… und der Fläche dahinter, Achsmaß', flaecheVon(befundeOffen), 4.1265 + 9.46275, 0.001);
  check(
    'Die Meldung nennt Ort und Folge im Klartext',
    meldung(befundeOffen, 'gap').includes('3.50 / 5.75') &&
      meldung(befundeOffen, 'gap').includes('1.50 m') &&
      meldung(befundeOffen, 'gap').includes('nicht als Raum'),
    true,
  );

  // Die Modellprüfung muss dieselbe Stelle führen — sonst steht die Diagnose
  // im Rechenkern und kommt nirgends an.
  const bericht = validateModel(pseudoDokument(offen));
  check('Die Modellprüfung führt den Befund', bericht.issues.filter((i) => i.code === 'topology.gap').length, 1);
  check('… mit einem Abhilfetext', (REMEDIES['topology.gap'] ?? '').length > 40, true);
  // Eine vergessene Wand und eine gewollte Nische sind geometrisch dasselbe.
  // Der Befund darf deshalb den Export nicht sperren.
  check('… als Warnung, nicht als Fehler', bericht.issues.find((i) => i.code === 'topology.gap')?.severity ?? 'fehlt', 'warning');

  // -- 3. Der 3 mm offene Stoß ---------------------------------------------
  //
  // Rechteck 5,00 × 4,00 über die Achsen, Wandstärke 0,20 m ringsum; die
  // Westwand endet 3 mm über der Südwestecke.
  //   lichte Fläche = (5,00 − 0,20) · (4,00 − 0,20) = 4,80 · 3,80 = 18,24
  const fuge = modell([
    { id: 's', a: [0, 0], b: [5, 0] },
    { id: 'o', a: [5, 0], b: [5, 4] },
    { id: 'n', a: [5, 4], b: [0, 4] },
    { id: 'w', a: [0, 4], b: [0, 0.003] },
  ]);
  //
  // Die Heilung legt die verschweißte Ecke in die *Mitte* zwischen beide
  // Enden, also auf y = 0,0015. Die Südwand steht damit minimal schief, und
  // das lichte Maß ist kein Rechteck mehr, sondern ein Trapez: 4,80 m breit,
  // die Nordkante bei y = 3,90, die Südkante von y = 0,101470 (West) bis
  // y = 0,100030 (Ost), im Mittel 0,10075.
  //   A = 4,80 · (3,90 − 0,10075) = 4,80 · 3,79925 = 18,23640
  // Das ist die Probe darauf, dass die Fuge halbiert und nicht einseitig
  // zugezogen wird — bei einseitigem Zuziehen käme glatt 18,24 heraus.
  const raeumeFuge = raeume(fuge);
  check('3 mm Fuge: der Raum entsteht trotzdem', raeumeFuge.length, 1);
  check('… die Fuge wird hälftig geteilt', raeumeFuge[0]?.area ?? Number.NaN, 18.2364, 0.0001);
  const befundeFuge = diagnoseClosure({ walls: fuge.walls, nodes: fuge.nodes });
  check('3 mm Fuge: sie wird nicht verschwiegen', nurArt(befundeFuge, 'near-miss').length, 1);
  check('… mit ihrem Maß', massVon(befundeFuge, 'near-miss'), 0.003, 1e-6);
  check('… und in Millimetern im Text', meldung(befundeFuge, 'near-miss').includes('3 mm'), true);
  check('3 mm Fuge: keine Lücke, kein offenes Ende', befundeFuge.length, 1);

  // Gegenprobe jenseits der Toleranz: 8 cm sind mehr als die 5 cm, die die
  // Heilung überbrückt. Jetzt fehlt der Raum wirklich.
  const spalt = modell([
    { id: 's', a: [0, 0], b: [5, 0] },
    { id: 'o', a: [5, 0], b: [5, 4] },
    { id: 'n', a: [5, 4], b: [0, 4] },
    { id: 'w', a: [0, 4], b: [0, 0.08] },
  ]);
  check('8 cm Spalt liegt über der Schweiß-Toleranz', 0.08 > WELD_TOLERANCE, true);
  check('8 cm Spalt: kein Raum mehr', raeume(spalt).length, 0);
  const befundeSpalt = diagnoseClosure({ walls: spalt.walls, nodes: spalt.nodes });
  check('8 cm Spalt: zwei offene Wandenden', nurArt(befundeSpalt, 'open-end').length, 2);
  check('… beide Meldungen nennen den Abstand zur nächsten Wand', inJederMeldung(befundeSpalt, 'open-end', '8.0 cm'), true);

  // -- 4. T-Stoß ohne Teilung ----------------------------------------------
  //
  // Trennwand in der Mitte, die 12 mm neben der Südwand endet. Sie teilt
  // deren Achse nicht — ohne Heilung gäbe es einen Raum statt zwei.
  const tStoss = modell([
    { id: 's', a: [0, 0], b: [5, 0] },
    { id: 'o', a: [5, 0], b: [5, 4] },
    { id: 'n', a: [5, 4], b: [0, 4] },
    { id: 'w', a: [0, 4], b: [0, 0] },
    { id: 't', a: [2.5, 0.012], b: [2.5, 4] },
  ]);
  const raeumeT = raeume(tStoss);
  // Beide Hälften: (2,50 − 0,20) · (4,00 − 0,20) = 2,30 · 3,80 = 8,74
  check('T-Stoß 12 mm daneben: die Heilung rettet beide Räume', raeumeT.length, 2);
  check('… jeder mit seiner lichten Fläche', raeumeT[0]?.area ?? Number.NaN, 8.74, 0.001);
  const befundeT = diagnoseClosure({ walls: tStoss.walls, nodes: tStoss.nodes });
  check('T-Stoß: der Versatz wird gemeldet', nurArt(befundeT, 'off-axis').length, 1);
  check('… mit seinem Maß', massVon(befundeT, 'off-axis'), 0.012, 1e-6);
  check('… und dem Grund im Text', meldung(befundeT, 'off-axis').includes('teilt sie nicht'), true);

  // Ein Ende, das exakt auf der fremden Achse sitzt, ist ein fertiger T-Stoß
  // und darf nicht gemeldet werden — sonst wäre jede Innenwand ein Befund.
  const tExakt = modell([
    { id: 's', a: [0, 0], b: [5, 0] },
    { id: 'o', a: [5, 0], b: [5, 4] },
    { id: 'n', a: [5, 4], b: [0, 4] },
    { id: 'w', a: [0, 4], b: [0, 0] },
    { id: 't', a: [2.5, 0], b: [2.5, 4] },
  ]);
  check('Der saubere T-Stoß liefert zwei Räume', raeume(tExakt).length, 2);
  check('… und keinen einzigen Befund', diagnoseClosure({ walls: tExakt.walls, nodes: tExakt.nodes }).length, 0);

  // -- 5. Zwei kollineare Wände, die sich überlappen -----------------------
  //
  // Die Südwand ist in zwei Stücken gezeichnet, 0 → 3,00 und 2,40 → 5,00.
  // Auf 0,60 m liegen sie übereinander. Der Raum entsteht — deckungsgleiche
  // Kanten kommen nur einmal in den Graphen —, aber Aufmaß und Hüllfläche
  // zählen die 0,60 m doppelt, und das sieht am Plan niemand.
  const doppelt = modell([
    { id: 's1', a: [0, 0], b: [3, 0] },
    { id: 's2', a: [2.4, 0], b: [5, 0] },
    { id: 'o', a: [5, 0], b: [5, 4] },
    { id: 'n', a: [5, 4], b: [0, 4] },
    { id: 'w', a: [0, 4], b: [0, 0] },
  ]);
  check('Überlappung: der Raum entsteht trotzdem', raeume(doppelt).length, 1);
  check('… mit unveränderter lichter Fläche', raeume(doppelt)[0]?.area ?? Number.NaN, 18.24, 0.001);
  const befundeDoppelt = diagnoseClosure({ walls: doppelt.walls, nodes: doppelt.nodes });
  check('Überlappung: sie wird gemeldet', nurArt(befundeDoppelt, 'overlap').length, 1);
  check('… mit der überlappenden Länge', massVon(befundeDoppelt, 'overlap'), 0.6, 1e-6);
  check('… und den beiden Wänden', nurArt(befundeDoppelt, 'overlap')[0]?.wallIds.join('+') ?? 'fehlt', 's1+s2');

  // Der stumpfe Stoß derselben zwei Wände ist der Regelfall und kein Befund.
  const stumpf = modell([
    { id: 's1', a: [0, 0], b: [3, 0] },
    { id: 's2', a: [3, 0], b: [5, 0] },
    { id: 'o', a: [5, 0], b: [5, 4] },
    { id: 'n', a: [5, 4], b: [0, 4] },
    { id: 'w', a: [0, 4], b: [0, 0] },
  ]);
  check('Der stumpfe Stoß ist kein Befund', diagnoseClosure({ walls: stumpf.walls, nodes: stumpf.nodes }).length, 0);
  check('… und liefert denselben Raum', raeume(stumpf)[0]?.area ?? Number.NaN, 18.24, 0.001);

  // -- 6. Ein Flur, der drei Zimmer verbindet -------------------------------
  //
  // Achsen: Gebäude 8,00 × 6,00, Flur zwischen y = 2,40 und y = 3,60,
  // drei Zimmer nördlich davon, getrennt bei x = 2,60 und x = 5,40. Alle
  // Wände 0,20 m. Die Flur-Nordwand ist — wie im gemeldeten Grundriss — in
  // drei kurze Stücke zerlegt, nicht in eine durchgehende Wand.
  //   Flur    (8,00 − 0,20) · (1,20 − 0,20) = 7,80 · 1,00        =  7,80
  //   Zimmer  links  2,40 · 2,20                                 =  5,28
  //           mitte  2,60 · 2,20                                 =  5,72
  //           rechts 2,40 · 2,20                                 =  5,28
  //   Süden   (8,00 − 0,20) · (2,40 − 0,20) = 7,80 · 2,20        = 17,16
  //                                                      Summe   = 41,24
  const flurStrecken = (westenOffen: boolean): { id: string; a: [number, number]; b: [number, number] }[] => [
    { id: 'a1', a: [0, 0], b: [8, 0] },
    { id: 'a2', a: [8, 0], b: [8, 6] },
    { id: 'a3', a: [8, 6], b: [0, 6] },
    // Die Westwand: entweder durchgehend oder auf Flurhöhe unterbrochen.
    ...(westenOffen
      ? [
          { id: 'a4o', a: [0, 6] as [number, number], b: [0, 3.6] as [number, number] },
          { id: 'a4u', a: [0, 2.4] as [number, number], b: [0, 0] as [number, number] },
        ]
      : [{ id: 'a4', a: [0, 6] as [number, number], b: [0, 0] as [number, number] }]),
    { id: 'f1a', a: [0, 2.4], b: [2.6, 2.4] },
    { id: 'f1b', a: [2.6, 2.4], b: [5.4, 2.4] },
    { id: 'f1c', a: [5.4, 2.4], b: [8, 2.4] },
    { id: 'f2', a: [0, 3.6], b: [8, 3.6] },
    { id: 'z1', a: [2.6, 0], b: [2.6, 2.4] },
    { id: 'z2', a: [5.4, 0], b: [5.4, 2.4] },
  ];
  const flur = modell(flurStrecken(false));
  const raeumeFlur = raeume(flur);
  check('Flur mit drei Zimmern: fünf Räume', raeumeFlur.length, 5);
  check('… Summe der lichten Flächen', flaechensumme(flur), 41.24, 0.001);
  check('… der Flur selbst', raeumeFlur.filter((r) => Math.abs(r.area - 7.8) < 0.001).length, 1);
  check('… ohne Befund', diagnoseClosure({ walls: flur.walls, nodes: flur.nodes }).length, 0);

  // Fehlt in der Westwand das Stück auf Flurhöhe, läuft der Flur nach außen.
  // Die drei Zimmer und der Süden bleiben — der Flur verschwindet, und mit
  // ihm die 7,80 m². Kein Wandende ist dabei frei: die Enden der Westwand
  // treffen oben und unten auf die Flurwände.
  const flurOffen = modell(flurStrecken(true));
  check('Westwand auf Flurhöhe offen: der Flur fällt heraus', raeume(flurOffen).length, 4);
  check('… die übrigen vier Räume bleiben unverändert', flaechensumme(flurOffen), 41.24 - 7.8, 0.001);
  check('… und trotzdem ist kein Wandende frei', findOpenEnds(flurOffen.walls, flurOffen.nodes).length, 0);
  const befundeFlurOffen = diagnoseClosure({ walls: flurOffen.walls, nodes: flurOffen.nodes });
  check('… die Lücke wird benannt', nurArt(befundeFlurOffen, 'gap').length, 1);
  check('… mit ihrer Breite', massVon(befundeFlurOffen, 'gap'), 1.2, 0.001);
  // Achsfläche des Flurs: 8,00 · 1,20 = 9,60
  check('… und der Achsfläche des Flurs dahinter', flaecheVon(befundeFlurOffen), 9.6, 0.001);

  // -- 7. Grenze der Lückensuche -------------------------------------------
  //
  // Was breiter offen steht als MAX_GAP, ist keine vergessene Wand mehr,
  // sondern ein gewollter Durchgang. Geprüft an einer Nische, die den Raum
  // dahinter mit dem Außenbereich verbindet: Gebäude 5,00 × 4,00, Nische
  // 1,60 m tief (x = 0 bis 1,60), Innenwände bei x = 1,60 nördlich und
  // südlich der Nische. Alle Wände 0,20 m. Alle vier Nischenecken sind
  // Ecken mit zwei Wänden — kein einziges freies Ende.
  check('Die Grenze steht bei 2,50 m', MAX_GAP, 2.5);
  const nische = (weite: number): Modell =>
    modell([
      { id: 's', a: [0, 0], b: [5, 0] },
      { id: 'o', a: [5, 0], b: [5, 4] },
      { id: 'n', a: [5, 4], b: [0, 4] },
      { id: 'wo', a: [0, 4], b: [0, 2 + weite / 2] },
      { id: 'wu', a: [0, 2 - weite / 2], b: [0, 0] },
      { id: 't1', a: [0, 2 + weite / 2], b: [1.6, 2 + weite / 2] },
      { id: 't2', a: [0, 2 - weite / 2], b: [1.6, 2 - weite / 2] },
      { id: 'v1', a: [1.6, 4], b: [1.6, 2 + weite / 2] },
      { id: 'v2', a: [1.6, 2 - weite / 2], b: [1.6, 0] },
    ]);

  const engeNische = nische(1.6);
  const befundeEng = diagnoseClosure({ walls: engeNische.walls, nodes: engeNische.nodes });
  // Übrig bleiben die beiden Kammern neben der Nische, je 1,40 · 1,00.
  check('1,60 m offen: nur die beiden Kammern werden Raum', raeume(engeNische).length, 2);
  check('… mit je 1,40 m²', flaechensumme(engeNische), 2.8, 0.001);
  check('… kein freies Wandende', findOpenEnds(engeNische.walls, engeNische.nodes).length, 0);
  check('1,60 m offen gilt als vergessene Wand', nurArt(befundeEng, 'gap').length, 1);
  // Achsfläche dahinter: Nische 1,60 · 1,60 = 2,56 plus Raum 3,40 · 4,00 = 13,60
  check('… mit der Achsfläche dahinter', flaecheVon(befundeEng), 2.56 + 13.6, 0.001);

  const weiteNische = nische(2.6);
  check('2,60 m offen gilt als Absicht', nurArt(diagnoseClosure({ walls: weiteNische.walls, nodes: weiteNische.nodes }), 'gap').length, 0);
  // Gegenprobe, dass dabei nicht einfach alles stumm wird: die Kammern
  // schrumpfen auf 1,40 · 0,50 und stehen weiterhin als Räume da.
  check('… der Grundriss selbst bleibt derselbe', flaechensumme(weiteNische), 1.4, 0.001);

  // -- 8. Gegenprobe am Referenzhaus ---------------------------------------
  //
  // Das Referenzhaus ist geschlossen gezeichnet. Es darf von der neuen
  // Diagnose kein einziges Wort bekommen — sonst wäre sie eine Fehlerquelle
  // und keine Hilfe.
  const referenz = buildReferenceDocument();
  const referenzWaende = Object.values(referenz.walls);
  let befundeReferenz = 0;
  for (const level of Object.values(referenz.levels)) {
    befundeReferenz += diagnoseClosure({
      walls: referenzWaende.filter((w) => w.levelId === level.id),
      nodes: referenz.nodes,
    }).length;
  }
  check('Referenzhaus: kein Topologie-Befund', befundeReferenz, 0);
  const referenzBericht = validateModel(referenz);
  check(
    'Referenzhaus: auch die Modellprüfung schweigt zur Topologie',
    referenzBericht.issues.filter((i) => i.code.startsWith('topology.')).length,
    0,
  );
  check('Referenzhaus: unverändert rechenfähig', referenzBericht.ready, true);
  check('Referenzhaus: sechs Räume wie bisher', Object.keys(referenz.rooms).length, 6);

  // -- 9. Raster aus durchgehenden Innenwänden ------------------------------
  //
  // Der zweite gemeldete Fall: ein sauber gezeichnetes Raster liefert nicht
  // alle Zellen. Die Facettensuche war nie das Problem — sie findet auch
  // Wände, die einander kreuzen, ohne im Dokument geteilt zu sein. Verloren
  // gingen die Zellen beim *Ablegen*: zieht man eine Wand durch ein Zimmer,
  // liegen die Schwerpunkte beider Teilflächen im selben alten Raum, beide
  // erbten dessen Kennung, und ein `Record` behält davon eine.
  //
  // Geprüft wird deshalb zweierlei: das fertige Raster in einem Zug *und*
  // dasselbe Raster Wand für Wand gezeichnet.
  //
  // **Herkunft der Sollwerte.** Wie überall in diesem Block von Hand, nach
  //     A = (Δx − (t_links + t_rechts)/2) · (Δy − (t_oben + t_unten)/2)
  // mit 36,5 cm Außenwand und 11,5 cm Innenwand.
  const AWR = 0.365;
  const IWR = 0.115;

  // 2×3-Raster, Außenrechteck 12 × 8 m, zwei durchgehende Innenwände quer
  // (x = 4 und x = 8) und eine längs (y = 4). Sechs Zellen à 4 × 4 m Achsmaß:
  //   vier Eckzellen  (4 − (0,365+0,115)/2)² = 3,76 · 3,76      = 14,1376
  //   zwei Mittelzellen (4 − 0,115) · 3,76   = 3,885 · 3,76     = 14,6076
  //   Summe = 4 · 14,1376 + 2 · 14,6076                         = 85,7656
  const raster23: Strecke[] = [
    ...huelle(12, 8, AWR),
    { id: 'q1', a: [4, 0], b: [4, 8], t: IWR },
    { id: 'q2', a: [8, 0], b: [8, 8], t: IWR },
    { id: 'l1', a: [0, 4], b: [12, 4], t: IWR },
  ];
  const raster23Fertig = raeume(modell(raster23));
  check('2×3-Raster: alle sechs Zellen erkannt', raster23Fertig.length, 6);
  check('2×3-Raster: Summe der lichten Flächen', summe(raster23Fertig), 85.7656, 0.001);
  check('2×3-Raster: vier Eckzellen', raster23Fertig.filter((r) => Math.abs(r.area - 14.1376) < 0.001).length, 4);
  check('2×3-Raster: zwei Mittelzellen', raster23Fertig.filter((r) => Math.abs(r.area - 14.6076) < 0.001).length, 2);
  check('2×3-Raster: kein Wandende ohne Anschluss', findOpenEnds(modell(raster23).walls, modell(raster23).nodes).length, 0);

  // Und derselbe Grundriss Wand für Wand — der Weg, auf dem er entsteht.
  const raster23Schritt = nacheinander(raster23);
  check('2×3-Raster Wand für Wand: sechs Zellen erkannt', raster23Schritt.erkannt, 6);
  check('… und sechs Zellen abgelegt', raster23Schritt.abgelegt.length, 6);
  check('… keine Kennung doppelt vergeben', raster23Schritt.doppelt, 0);
  check('… dieselbe Fläche wie in einem Zug', summe(raster23Schritt.abgelegt), 85.7656, 0.001);
  check(
    '… und jeder Raum trägt einen eigenen Namen',
    new Set(raster23Schritt.abgelegt.map((r) => r.name)).size,
    6,
  );

  // 3×3-Raster, Außenrechteck 12 × 9 m, Innenwände bei x = 4/8 und y = 3/6.
  //   Spaltenbreiten  3,76 · 3,885 · 3,76      Zeilenhöhen 2,76 · 2,885 · 2,76
  //   vier Ecken      3,76  · 2,76  = 10,3776
  //   zwei oben/unten 3,885 · 2,76  = 10,7226
  //   zwei links/rechts 3,76 · 2,885 = 10,8476
  //   Mitte           3,885 · 2,885 = 11,208225
  //   Summe = 4 · 10,3776 + 2 · 10,7226 + 2 · 10,8476 + 11,208225 = 95,859025
  const raster33: Strecke[] = [
    ...huelle(12, 9, AWR),
    { id: 'v1', a: [4, 0], b: [4, 9], t: IWR },
    { id: 'v2', a: [8, 0], b: [8, 9], t: IWR },
    { id: 'h1', a: [0, 3], b: [12, 3], t: IWR },
    { id: 'h2', a: [0, 6], b: [12, 6], t: IWR },
  ];
  const raster33Fertig = raeume(modell(raster33));
  check('3×3-Raster: alle neun Zellen erkannt', raster33Fertig.length, 9);
  check('3×3-Raster: Summe der lichten Flächen', summe(raster33Fertig), 95.859025, 0.001);
  check('3×3-Raster: die Mittelzelle ist dabei', raster33Fertig.filter((r) => Math.abs(r.area - 11.208225) < 0.001).length, 1);
  const raster33Schritt = nacheinander(raster33);
  check('3×3-Raster Wand für Wand: neun Zellen abgelegt', raster33Schritt.abgelegt.length, 9);
  check('… keine Kennung doppelt vergeben', raster33Schritt.doppelt, 0);
  check('… dieselbe Fläche wie in einem Zug', summe(raster33Schritt.abgelegt), 95.859025, 0.001);

  // Ein Kreuz aus zwei durchgehenden Wänden — der Kern des Falls, ohne alles
  // andere. Keine der beiden Wände hat am Kreuzungspunkt ein Ende; die
  // Facettensuche muss sie dort trotzdem teilen.
  //   vier Zellen (6 − 0,24) · (4 − 0,24) = 5,76 · 3,76 = 21,6576
  const kreuz: Strecke[] = [
    ...huelle(12, 8, AWR),
    { id: 'k1', a: [6, 0], b: [6, 8], t: IWR },
    { id: 'k2', a: [0, 4], b: [12, 4], t: IWR },
  ];
  const kreuzFertig = raeume(modell(kreuz));
  check('Kreuz aus zwei durchgehenden Wänden: vier Zellen', kreuzFertig.length, 4);
  check('… je 21,6576 m²', kreuzFertig.filter((r) => Math.abs(r.area - 21.6576) < 0.001).length, 4);
  check('… auch Wand für Wand gezeichnet', nacheinander(kreuz).abgelegt.length, 4);
  check('Am Kreuz ist topologisch nichts zu beanstanden', diagnoseClosure(modell(kreuz)).length, 0);

  // Gegenprobe zur Namensübernahme: der geteilte Raum darf seinen Namen nicht
  // verlieren, und die größere Hälfte muss ihn bekommen. Sonst wanderte eine
  // benannte Küche beim Einziehen einer Wand willkürlich in die Speisekammer.
  const vorRaum = raeume(modell(huelle(12, 8, AWR)));
  const benannt = vorRaum.map((r) => ({ ...r, name: 'Küche', usage: 'kitchen' as const }));
  const geteilt = detectRooms({
    ...modell([...huelle(12, 8, AWR), { id: 'trenn', a: [9, 0], b: [9, 8], t: IWR }]),
    openings: [],
    levelId: 'eg',
    defaultHeight: 2.75,
    northAngle: 0,
    previous: benannt,
  });
  check('Ein geteilter Raum ergibt zwei Räume', geteilt.length, 2);
  check('… mit zwei verschiedenen Kennungen', new Set(geteilt.map((r) => r.id)).size, 2);
  // Achsmaße 9 · 8 und 3 · 8 → lichte Breiten 9 − (0,365+0,115)/2 = 8,76 bzw.
  // 3 − 0,24 = 2,76, Höhe je 8 − 0,365 = 7,635.
  check('… die größere behält den Namen', geteilt.find((r) => r.name === 'Küche')?.area ?? 0, 8.76 * 7.635, 0.001);
  check('… und die Nutzung gleich mit', geteilt.find((r) => r.name === 'Küche')?.usage ?? 'other', 'kitchen');
  check('… die kleinere ist ein neuer Raum', geteilt.find((r) => r.name !== 'Küche')?.usage ?? 'other', 'other');

  // -- 10. Was die Oberfläche zum Zeichnen der Lücke braucht ---------------
  //
  // Der Befund erreichte den Anwender bisher nur als Satz im Prüfbericht.
  // Damit der Plan die fehlende Wand zeichnen kann, muss der Befund die
  // beiden Wandenden und den Umriss der Fläche dahinter mitbringen — sonst
  // bliebe nur ein Punkt auf der Mitte, der die Richtung verschweigt.
  const luecke = nurArt(befundeOffen, 'gap')[0];
  check('Der Lücken-Befund nennt beide Wandenden', luecke?.ends?.length ?? 0, 2);
  check('… und ihr Abstand ist das gemeldete Maß', luecke?.ends ? Math.hypot(luecke.ends[0].x - luecke.ends[1].x, luecke.ends[0].y - luecke.ends[1].y) : Number.NaN, 1.5, 0.001);
  check('… er bringt den Umriss der Fläche dahinter mit', (luecke?.enclosedOutline?.length ?? 0) >= 3, true);
  // Der Umriss ist über die fehlende Wand geschlossen — seine Fläche ist
  // genau die gemeldete. Ohne diese Zeile könnte er irgendein Polygon sein.
  check(
    '… und dieser Umriss umschließt genau die gemeldete Fläche',
    luecke?.enclosedOutline ? polygonArea(luecke.enclosedOutline) : Number.NaN,
    luecke?.enclosedArea ?? Number.NaN,
    0.001,
  );
  // Anspringbar im Prüfbericht: eine fehlende Wand hat keine Kennung, nur
  // einen Ort. Ohne ihn bliebe ausgerechnet dieser Befund unanklickbar.
  const berichtOffen = validateModel(pseudoDokument(offen));
  const lueckenMeldung = berichtOffen.issues.find((i) => i.code === 'topology.gap');
  check('Die Modellprüfung führt die Lücke', lueckenMeldung ? 1 : 0, 1);
  check('… mit einem Ort, auf den die Ansicht springen kann', lueckenMeldung?.position?.x ?? Number.NaN, luecke?.position.x ?? Number.NaN, 0.001);
  check('… und dieser Ort ist die Mitte der Lücke', lueckenMeldung?.position?.y ?? Number.NaN, luecke?.position.y ?? Number.NaN, 0.001);
}

/**
 * Ein Dokument, das nur so viel enthält, wie die Modellprüfung für die
 * Topologie-Regeln braucht.
 *
 * Der Rest des Berichts interessiert hier nicht — geprüft wird, ob der Befund
 * aus dem Rechenkern in der Prüfung ankommt, nicht was sonst noch auffällt.
 */
function pseudoDokument(m: Modell): Parameters<typeof validateModel>[0] {
  const referenz = buildReferenceDocument();
  return {
    ...referenz,
    nodes: m.nodes,
    walls: Object.fromEntries(m.walls.map((w) => [w.id, w])),
    openings: {},
    rooms: {},
    fixtures: {},
    pipes: {},
    levels: { eg: { ...Object.values(referenz.levels)[0], id: 'eg', order: 0, elevation: 0 } },
    diagnostics: { openEnds: [] },
  };
}
