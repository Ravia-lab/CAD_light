/**
 * Prüfblock „Raumscan" — der Import eines RoomPlan-Scans.
 * ---------------------------------------------------------------------------
 * Geprüft wird gegen eine **echte** Aufnahme: `scripts/referenz/
 * raumscan-beispiel.json`, eine Wohnung mit 39 Wandflächen, fünf Türen, zehn
 * Fenstern, zwei Durchgängen und sieben benannten Bereichen, aufgenommen mit
 * dem iPhone. Ein selbstgebautes Beispiel hätte den Wert dieses Blocks
 * halbiert: die Eigenheiten, an denen ein Scan-Import scheitert — zerstückelte
 * Wände, T-Stöße ohne gemeinsamen Knoten, ein schief stehender Grundriss,
 * Wandstärken von null — erfindet man nicht, die bringt die Wirklichkeit mit.
 *
 * Aus der Datei entfernt sind nur zwei Dinge, die der Import ohnehin nicht
 * liest: das USD-Netz (`roomModelData`) und der `coreModel`-Blob. Beide
 * zusammen waren 1,3 der 1,4 MB.
 *
 * **Die vier Zahlen, an denen dieser Block wirklich hängt.**
 *
 *  1. *Wandlänge gesamt* — 101,1 m. Das Zusammenfassen fluchtender Stücke und
 *     das Teilen an T-Stößen dürfen weder Wand verlieren noch welche
 *     erzeugen. Die Summe ist der Beweis, weil sie beides fängt: die Roh-
 *     datei hat 101,0 m, und der kleine Zuwachs ist das Aufziehen der Enden
 *     auf gemeinsame Knoten.
 *  2. *Offene Wandenden* — 4. Vorher waren es 15. Elf davon saßen bereits auf
 *     einer fremden Wandachse und brauchten nur den geteilten Knoten. Die
 *     übrigen vier liegen 1,1 bis 1,8 m neben der nächsten Wand: dort hat der
 *     Scan **keine** Wand gemessen, und der Import zieht sie bewusst nicht
 *     heran. Stiege diese Zahl auf 0, wäre das kein Fortschritt, sondern der
 *     Beweis, dass der Import Bauteile erfindet.
 *  3. *Alle Öffnungen liegen in ihrer Wand.* Beim Teilen der Wände wandert
 *     eine Öffnung auf das falsche Stück, wenn die Zuordnung nicht mitgeführt
 *     wird — sie stünde dann auf einer Wand, die zwei Meter weiter beginnt.
 *  4. *Winkeltreue nach dem Geraderücken* — 94 % der Wandlänge liegen näher
 *     als 2,5° an einer Achse. Das ist das Maß dafür, dass die
 *     Vorzugsrichtung getroffen wurde und nicht irgendein Mittelwert.
 *
 * **Was hier nicht geprüft wird.** Ob die geschätzte Wandstärke *stimmt* —
 * das kann keine Prüfung wissen, RoomPlan misst sie nicht. Geprüft wird
 * stattdessen, dass die Schätzung als solche gemeldet wird.
 */

import { readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import type { CheckFn } from './typ';
import type { BimNode, Wall } from '../../src/types/bim';
import { importRaumplan, istRaumplanDatei } from '../../src/lib/raumplanImport';
import { detectRooms } from '../../src/lib/roomDetection';
import { offsetPolygonPerEdge, polygonArea, polygonPerimeter } from '../../src/lib/geometry';

/**
 * Projektwurzel bestimmen.
 *
 * `import.meta.url` taugt hier nicht: `npm run verify` bündelt alle Blöcke
 * nach `node_modules/.cache/verify.mjs`, und der relative Weg zur
 * Beispieldatei zeigte von dort ins Leere. Gesucht wird deshalb vom
 * Arbeitsverzeichnis aus — so wie es der Block „Schichtgrenze" auch tut.
 */
function wurzel(): string | undefined {
  let pfad = process.cwd();
  for (let i = 0; i < 4; i++) {
    try {
      if (statSync(join(pfad, 'scripts', 'referenz')).isDirectory()) return pfad;
    } catch {
      /* weiter oben suchen */
    }
    const eltern = pfad.slice(0, pfad.lastIndexOf(sep));
    if (!eltern || eltern === pfad) break;
    pfad = eltern;
  }
  return undefined;
}

/** Länge einer Wand über ihre Knoten. */
const laenge = (w: Wall, n: Map<string, BimNode>): number => {
  const a = n.get(w.a);
  const b = n.get(w.b);
  return a && b ? Math.hypot(b.x - a.x, b.y - a.y) : 0;
};

/** Abweichung der Wandrichtung von der nächsten Achse [°], 0…45. */
const achsAbweichung = (w: Wall, n: Map<string, BimNode>): number => {
  const a = n.get(w.a);
  const b = n.get(w.b);
  if (!a || !b) return 45;
  const g = Math.abs((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI) % 90;
  return Math.min(g, 90 - g);
};

export function pruefeRaumscan(check: CheckFn): void {
  console.log('\n▸ Raumscan — RoomPlan-Import gegen eine echte Aufnahme');

  const basis = wurzel();
  check('Die Beispieldatei ist auffindbar', basis !== undefined, true);
  if (!basis) return;
  const text = readFileSync(join(basis, 'scripts', 'referenz', 'raumscan-beispiel.json'), 'utf-8');

  // --- Erkennung ------------------------------------------------------------
  //  Der Öffnen-Dialog entscheidet nach Inhalt, nicht nach Endung. Er darf
  //  einen Scan nicht mit einer Projektdatei verwechseln und umgekehrt.
  check('Beispieldatei wird als Raumscan erkannt', istRaumplanDatei(text), true);
  check(
    'Eine IFC-Datei wird nicht als Raumscan erkannt',
    istRaumplanDatei("ISO-10303-21;\nHEADER;\nFILE_SCHEMA(('IFC4'));\n"),
    false,
  );
  check(
    'Eine RaVia-Projektdatei wird nicht als Raumscan erkannt',
    istRaumplanDatei('{"meta":{"name":"Haus"},"geometry":{"walls":[],"nodes":[]}}'),
    false,
  );
  check('Leerer Text wird nicht als Raumscan erkannt', istRaumplanDatei(''), false);

  // --- Import ---------------------------------------------------------------
  const r = importRaumplan(text);
  check('Import gelingt', r.ok, true);
  check('Keine übersprungenen Bauteile', r.skipped.length, 0);

  const knoten = new Map(r.nodes.map((n) => [n.id, n]));

  // --- Mengengerüst ---------------------------------------------------------
  //  39 Wandflächen im Scan → 28 nach dem Zusammenfassen → 40 nach dem Teilen
  //  an den T-Stößen. Beide Schritte sind in dieser Zahl enthalten, und ein
  //  Fehler in einem von beiden verschiebt sie.
  check('Wände nach Zusammenfassen und Teilen', r.walls.length, 40);
  check('T-Stöße in der Meldung genannt', r.message.includes('12 T-Stöße'), true);
  check('Knoten', r.nodes.length, 33);
  check('Öffnungen', r.openings.length, 17);
  check('davon Türen', r.openings.filter((o) => o.kind === 'door').length, 5);
  check('davon Fenster', r.openings.filter((o) => o.kind === 'window').length, 10);
  check('davon Durchgänge', r.openings.filter((o) => o.kind === 'passage').length, 2);
  check('Geschosse', r.levels.length, 1);
  check('Geschosshöhe [m]', r.levels[0].height, 2.45, 0.001);

  // Kein Knoten ohne Wand: nach dem Teilen dürfen keine Punkte übrig bleiben,
  // die im Editor anfassbar wären, aber nichts halten.
  const benutzt = new Set(r.walls.flatMap((w) => [w.a, w.b]));
  check('Kein Knoten ohne Wand', r.nodes.filter((n) => !benutzt.has(n.id)).length, 0);
  check(
    'Jede Wand verweist auf vorhandene Knoten',
    r.walls.every((w) => knoten.has(w.a) && knoten.has(w.b)),
    true,
  );
  check('Keine Wand der Länge null', r.walls.every((w) => laenge(w, knoten) > 0.01), true);

  // --- Die Wandlänge als Bilanz --------------------------------------------
  const gesamt = r.walls.reduce((s, w) => s + laenge(w, knoten), 0);
  check('Wandlänge gesamt [m]', gesamt, 101.12, 0.05);

  // --- Offene Enden ---------------------------------------------------------
  const grad = new Map<string, number>();
  for (const w of r.walls) {
    grad.set(w.a, (grad.get(w.a) ?? 0) + 1);
    grad.set(w.b, (grad.get(w.b) ?? 0) + 1);
  }
  const offen = [...grad.values()].filter((g) => g === 1).length;
  check('Offene Wandenden bleiben offen (nichts erfunden)', offen, 4);

  // --- Geraderücken ---------------------------------------------------------
  check('Drehung [°]', (r.drehung * 180) / Math.PI, 40.645, 0.01);
  const langGesamt = gesamt;
  const langGerade = r.walls
    .filter((w) => achsAbweichung(w, knoten) < 2.5)
    .reduce((s, w) => s + laenge(w, knoten), 0);
  check('Anteil achsnaher Wandlänge [%]', (langGerade / langGesamt) * 100, 94.5, 1.5);

  // Der Kompass gehört an den Nordpfeil, nicht in die Geometrie — und er wird
  // mitgedreht, sonst zeigt der Pfeil nach dem Geraderücken falsch.
  check('Nordrichtung mitgeführt [°]', ((r.nordrichtung ?? 0) * 180) / Math.PI, -32.242, 0.01);
  check('Genauigkeit des Kompasses mitgeführt [°]', r.nordGenauigkeitGrad ?? -1, 15.672, 0.01);

  // --- Wandstärken ----------------------------------------------------------
  const staerken = [...new Set(r.walls.map((w) => w.thickness))].sort((a, b) => a - b);
  check('Genau zwei geschätzte Stärken', staerken.length, 2);
  check('Innenwand [m]', staerken[0], 0.115, 1e-9);
  check('Außenwand [m]', staerken[1], 0.365, 1e-9);
  check('Außenwände', r.walls.filter((w) => w.type === 'exterior').length, 21);
  check(
    'Jede Außenwand ist dicker als jede Innenwand',
    r.walls.every((w) => (w.type === 'exterior') === (w.thickness === 0.365)),
    true,
  );
  check(
    'Die Schätzung wird als Schätzung gemeldet',
    r.geschaetzt.some((g) => g.was === 'Wandstärke' && g.anzahl === r.walls.length),
    true,
  );
  check(
    'Der fehlende Türanschlag wird gemeldet',
    r.geschaetzt.some((g) => g.was === 'Türanschlag' && g.anzahl === 5),
    true,
  );

  // --- Öffnungen sitzen richtig --------------------------------------------
  //  Die Probe auf das Teilen: eine Öffnung, deren Wand zerlegt wurde, muss
  //  auf dem Stück landen, in das sie tatsächlich fällt.
  const passen = r.openings.every((o) => {
    const w = r.walls.find((x) => x.id === o.wallId);
    if (!w) return false;
    const l = laenge(w, knoten);
    return o.distance - o.width / 2 >= -0.2 && o.distance + o.width / 2 <= l + 0.2;
  });
  check('Jede Öffnung liegt vollständig in ihrer Wand', passen, true);
  check('Türen ohne Brüstung', r.openings.filter((o) => o.kind === 'door').every((o) => o.sillHeight === 0), true);

  const bruest = r.openings.filter((o) => o.kind === 'window').map((o) => o.sillHeight);
  check('Kleinste Fensterbrüstung [m]', Math.min(...bruest), 0.748, 0.005);
  check('Größte Fensterbrüstung [m]', Math.max(...bruest), 1.262, 0.005);
  check(
    'Keine Brüstung über der Wandhöhe',
    r.openings.every((o) => {
      const w = r.walls.find((x) => x.id === o.wallId);
      return w ? o.sillHeight + o.height <= w.height + 0.05 : false;
    }),
    true,
  );

  // --- Herkunftsangaben -----------------------------------------------------
  check('Projektname aus der Datei', r.projektName ?? 'fehlt', 'Zuhause');
  check(
    'Adresse aus der Datei',
    r.adresse ?? 'fehlt',
    'Frankfurter Straße 6, 61169 Friedberg (Hessen)',
  );
  check('Breitengrad', r.koordinaten?.breite ?? 0, 50.3292, 0.001);
  check('Längengrad', r.koordinaten?.laenge ?? 0, 8.7505, 0.001);

  // --- Raumnutzung ----------------------------------------------------------
  //  Zwei der sieben Bereiche heißen im Scan „unidentified". Ein Import, der
  //  sie trotzdem benennt, hätte geraten.
  check('Benannte Raumbereiche übernommen', r.raumHinweise.length, 5);
  check(
    'Unbenannte Bereiche bleiben unbenannt',
    r.raumHinweise.every((h) => h.name !== 'unidentified'),
    true,
  );
  check(
    'Bad ist als Bad übernommen',
    r.raumHinweise.find((h) => h.name === 'Bad')?.usage ?? 'fehlt',
    'bath',
  );
  check(
    'Essen zählt als Wohnraum',
    r.raumHinweise.find((h) => h.name === 'Essen')?.usage ?? 'fehlt',
    'living',
  );

  // --- Zusammenspiel mit der Raumerkennung ---------------------------------
  //  Der eigentliche Zweck des Teilens an T-Stößen. Ohne ihn erkennt die
  //  Raumerkennung sieben Räume statt neun, weil Nachbarräume verschmelzen.
  const nodes: Record<string, BimNode> = Object.fromEntries(r.nodes.map((n) => [n.id, n]));
  const raeume = detectRooms({
    walls: r.walls,
    nodes,
    openings: r.openings,
    levelId: r.levels[0].id,
    defaultHeight: r.levels[0].height,
    northAngle: 0,
  });
  check('Räume erkannt', raeume.length, 9);
  check(
    'Summe der Raumflächen [m²]',
    raeume.reduce((s, z) => s + z.area, 0),
    96.9,
    0.5,
  );
  // Die Probe gegen den Scan selbst: das Bodenpolygon misst 111,3 m² über die
  // Wandflächen, die Räume messen lichte Flächen. Die Differenz ist der
  // Grundriss der Wände — rund 14 m² bei 101 m Wandlänge.
  const differenz = 111.3 - raeume.reduce((s, z) => s + z.area, 0);
  check('Wandgrundfläche als Differenz zum Bodenpolygon [m²]', differenz, 14.4, 1.0);
  check(
    'Kein Raum mit unmöglichem Umfang',
    raeume.every((z) => z.perimeter < 4 * Math.sqrt(z.area) * 10),
    true,
  );

  // Jeder Nutzungshinweis muss in einem erkannten Raum landen — sonst ginge
  // die Nutzung beim Übernehmen still verloren.
  const imPolygon = (p: { x: number; y: number }, poly: { x: number; y: number }[]): boolean => {
    let drin = false;
    for (let i = 0, k = poly.length - 1; i < poly.length; k = i++) {
      if (
        poly[i].y > p.y !== poly[k].y > p.y &&
        p.x < ((poly[k].x - poly[i].x) * (p.y - poly[i].y)) / (poly[k].y - poly[i].y) + poly[i].x
      ) {
        drin = !drin;
      }
    }
    return drin;
  };
  const getroffen = r.raumHinweise.filter((h) => raeume.some((z) => imPolygon(h.punkt, z.polygon)));
  check('Jeder Nutzungshinweis trifft einen erkannten Raum', getroffen.length, r.raumHinweise.length);

  // --- Fehlerfälle ----------------------------------------------------------
  check('Kaputtes JSON wird abgefangen', importRaumplan('{nicht').ok, false);
  check('Scan ohne Wände wird abgefangen', importRaumplan('{"walls":[],"floors":[]}').ok, false);
  check(
    'Meldung bei Scan ohne Wände nennt den Grund',
    importRaumplan('{"walls":[],"floors":[]}').message.includes('keine Wände'),
    true,
  );

  // --- Gehrungsgrenze beim Versatz -----------------------------------------
  //  Der Fehler, den dieser Import ans Licht gebracht hat, sitzt nicht im
  //  Import: `offsetPolygonPerEdge` kannte keine Gehrungsgrenze. An einer
  //  Zacke ohne Breite — wie sie entsteht, wenn eine Facette um ein loses
  //  Wandende herumläuft — schoss der versetzte Eckpunkt ins Weite. Aus dem
  //  Versatz eines 15 m² großen Umrisses wurde ein Polygon mit 0,7 m² Fläche
  //  und 438 m Umfang, das anschließend als Raum durch die Heizlast lief.
  //
  //  Ein nach innen versetztes Polygon kann nicht größer werden als das
  //  Ausgangspolygon — weder in der Fläche noch im Umfang. Das ist keine
  //  gewählte Schranke, sondern Geometrie, und deshalb taugt sie als Prüfung.
  //  Die Gestalt, an der es scheitert, ist eine **Zacke ohne Breite**: hinauf
  //  und auf derselben Linie zurück. Die beiden Flanken liegen einen
  //  Millimeter auseinander; versetzt man sie um je 12 cm nach innen, kreuzen
  //  sie sich, und ihr Schnittpunkt liegt einige hundert Meter über dem
  //  Grundriss. Eine Zacke *mit* Breite — und sei sie nur vier Zentimeter —
  //  ist harmlos; deshalb steht hier genau dieser Sonderfall.
  const zacke = [
    { x: 0, y: 0 },
    { x: 6, y: 0 },
    { x: 6, y: 4 },
    { x: 3.0005, y: 4 },
    { x: 3.0, y: 7 }, // hinauf …
    { x: 2.9995, y: 4 }, // … und auf derselben Linie zurück
    { x: 0, y: 4 },
  ];
  const versatz = 0.12;
  const versetzt = offsetPolygonPerEdge(zacke, zacke.map(() => versatz));
  check('Versatz nach innen vergrößert die Fläche nicht', polygonArea(versetzt) <= polygonArea(zacke), true);
  check(
    'Versatz nach innen vergrößert den Umfang nicht',
    polygonPerimeter(versetzt) <= polygonPerimeter(zacke),
    true,
  );
  check('Umfang nach dem Versatz [m]', polygonPerimeter(versetzt), 24.56, 0.02);
  const weiteste = Math.max(
    ...versetzt.map((q, i) => Math.hypot(q.x - zacke[i].x, q.y - zacke[i].y)),
  );
  // Ohne Gehrungsgrenze wanderte diese Ecke rund 700 m weit. Begrenzt ist sie
  // auf das Vierfache des Versatzes — 48 cm.
  check('Eckpunkt wandert höchstens das Vierfache des Versatzes [m]', weiteste, versatz * 4, 1e-9);
}
