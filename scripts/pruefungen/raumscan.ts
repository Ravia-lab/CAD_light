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
import { benenneGeschosse, erdgeschossIndex } from '../../src/lib/levelGeometry';
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

  // Der Fehler, der einen Handwerker eine Fassung lang aufgehalten hätte.
  //
  // Die Beispieldatei in diesem Verzeichnis ist **beschnitten**: das USD-Netz
  // (`roomModelData`) ist heraus, weil der Import es nicht liest. In der
  // Ausgabe der App steht es aber **vor** `roomData` — bei dieser Wohnung
  // 700 kB base64 —, und `roomData` beginnt erst bei Zeichen 486 099. Eine
  // Erkennung, die nur in den Anfang der Datei schaut, sieht dort nichts,
  // reicht die Datei an den Projektleser weiter und meldet „Datei konnte nicht
  // gelesen werden". Genau so ist es passiert.
  //
  // Die Lehre steckt in der Prüfdatei selbst: wer eine Beispieldatei
  // verkleinert, entfernt womöglich gerade die Eigenschaft, an der es
  // scheitert. Deshalb wird das Netz hier wieder eingesetzt — als Attrappe,
  // damit das Verzeichnis schlank bleibt, aber an derselben Stelle und in
  // derselben Größenordnung.
  {
    const attrappe = 'A'.repeat(700 * 1024);
    const mitNetz = text.replace('{', `{"roomModelData":"${attrappe}",`);
    check('Das USD-Netz steht vor den Raumdaten', mitNetz.indexOf('"roomData"') > 500_000, true);
    check('Eine Datei mit vorangestelltem 3D-Netz wird erkannt', istRaumplanDatei(mitNetz), true);
    const mitNetzGelesen = importRaumplan(mitNetz);
    check('… und vollständig gelesen', mitNetzGelesen.walls.length, 40);
    check('… mit allen Öffnungen', mitNetzGelesen.openings.length, 17);
  }

  // --- Fassungen von RoomPlan ----------------------------------------------
  //
  // Die Erkennung verlangte anfangs neben `walls` noch `floors` oder
  // `sections`. **Beide Felder gibt es erst seit iOS 17.** Ein Scan von einem
  // iPhone mit iOS 16 hat weder das eine noch das andere — und wurde deshalb
  // abgewiesen, obwohl er vollständig brauchbar ist. Gefunden hat das keine
  // Prüfung, sondern ein Blick in die Verfügbarkeitsangaben der Apple-Doku;
  // die Beispieldatei hier stammt von einem neueren Gerät und hat die Felder.
  //
  // Geprüft wird deshalb ab jetzt jede Gestalt, die vorkommen kann.
  {
    const roh = JSON.parse(text) as Record<string, unknown>;
    const modell = JSON.parse(
      Buffer.from(String(roh.roomData), 'base64').toString('utf-8'),
    ) as Record<string, unknown>;

    // iOS 16: keine `floors`, keine `sections`, kein `story`, kein `version`.
    const wieIos16 = { ...modell };
    delete wieIos16.floors;
    delete wieIos16.sections;
    delete wieIos16.story;
    delete wieIos16.version;
    const ios16 = JSON.stringify(wieIos16);
    check('Ein Scan im Umfang von iOS 16 wird erkannt', istRaumplanDatei(ios16), true);
    const g16 = importRaumplan(ios16);
    check('… und gelesen', g16.ok, true);
    // Ohne Bodenumriss kann nicht entschieden werden, was außen liegt; die
    // Wände kommen trotzdem alle an. Das ist der Punkt: lieber ein Plan mit
    // geschätzten Stärken als gar keiner.
    check('… mit allen Wänden', g16.walls.length, 40);

    // iOS 17 Mehrraum: `CapturedStructure` mit zusammengeführter Geometrie
    // **und** den Einzelräumen. Gelesen werden muss die zusammengeführte.
    const struktur = JSON.stringify({ ...modell, rooms: [modell, modell] });
    check('Ein Mehrraum-Scan wird erkannt', istRaumplanDatei(struktur), true);
    const gs = importRaumplan(struktur);
    check('… und nicht doppelt gelesen', gs.walls.length, 40);

    // Und derselbe Aufbau ohne zusammengeführte Geometrie: dann sind die
    // Einzelräume die einzige Quelle.
    const nurRaeume = JSON.stringify({ version: 2, rooms: [modell] });
    check('Ein Mehrraum-Scan ohne Zusammenführung wird erkannt', istRaumplanDatei(nurRaeume), true);
    const gr = importRaumplan(nurRaeume);
    check('… und aus den Einzelräumen gelesen', gr.walls.length, 40);
  }

  // --- Unmaß und Krümmung ---------------------------------------------------
  {
    const roh = JSON.parse(text) as Record<string, unknown>;
    const modell = JSON.parse(
      Buffer.from(String(roh.roomData), 'base64').toString('utf-8'),
    ) as { walls: { dimensions: number[]; curve?: unknown }[] };

    // Eine Wand von 120 m ist in Metern gemessen keine Wand. Sie fliegt
    // heraus und steht mit Grund in der Liste der übersprungenen Teile —
    // nicht stillschweigend, sonst hängt der ganze Plan an ihr.
    const mitUnmass = JSON.parse(JSON.stringify(modell)) as typeof modell;
    mitUnmass.walls[0].dimensions = [120, 2.5, 0];
    const gu = importRaumplan(JSON.stringify(mitUnmass));
    check('Eine 120-m-Wand wird übersprungen', gu.walls.length < 40, true);
    check(
      '… und der Grund genannt',
      gu.skipped.some((s) => s.reason.includes('unglaubwürdigem Maß')),
      true,
    );

    // Eine gekrümmte Wand wird als Sehne gezeichnet — und das wird gesagt.
    const mitBogen = JSON.parse(JSON.stringify(modell)) as typeof modell;
    mitBogen.walls[0].curve = { startAngle: 0, endAngle: 1.2, radius: 2.4 };
    const gb = importRaumplan(JSON.stringify(mitBogen));
    check('Die Krümmung wird gemeldet', gb.geschaetzt.some((a) => a.was === 'Gekrümmte Wände'), true);
    check('… und die Wand trotzdem übernommen', gb.walls.length, 40);
  }

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
    // Die Beispieldatei ist anonymisiert (Adresse und Koordinaten ersetzt,
    // 21.09.2026) — geprüft wird, dass beide Felder gelesen werden.
    'Musterstraße 1, 12345 Musterstadt',
  );
  check('Breitengrad', r.koordinaten?.breite ?? 0, 50.0, 0.001);
  check('Längengrad', r.koordinaten?.laenge ?? 0, 8.0, 0.001);

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

  // --- Brüstungen bestimmen nicht die Raumhöhe ------------------------------
  //  Der Fehler, den erst ein echter Scan ans Licht gebracht hat.
  //
  //  Die Raumhöhe war die kleinste beteiligte Wandhöhe — bedingungslos. Ein
  //  Raum, der an eine 1,19 m hohe Brüstung grenzt, bekam damit 1,19 m Höhe.
  //  Von Hand zeichnet niemand so eine Wand an einen Wohnraum, deshalb ist es
  //  nie aufgefallen; ein Scan misst sie.
  //
  //  Die Folge stand nicht in der Geometrie, sondern in der Heizlast: aus der
  //  Raumhöhe folgt das Luftvolumen und daraus der Lüftungswärmeverlust. Über
  //  die ganze Wohnung fehlten 32,5 von 224,8 m³ — 17 %, und zwar nach unten.
  {
    const raeume = detectRooms({
      walls: r.walls,
      nodes: Object.fromEntries(r.nodes.map((n) => [n.id, n])),
      openings: r.openings,
      levelId: r.levels[0].id,
      defaultHeight: r.levels[0].height,
      northAngle: 0,
    });
    const bruestungen = r.walls.filter((w) => w.height < 1.6);
    check('Der Scan enthält Brüstungen unter 1,60 m', bruestungen.length, 3);
    check('Niedrigste Brüstung [m]', Math.min(...bruestungen.map((w) => w.height)), 1.185, 0.002);
    check(
      'Kein Raum ist so niedrig wie eine Brüstung',
      raeume.every((z) => z.height >= 1.6),
      true,
    );
    check('Niedrigster Raum [m]', Math.min(...raeume.map((z) => z.height)), 2.067, 0.01);
    check(
      'Luftvolumen der Wohnung [m³]',
      raeume.reduce((s2, z) => s2 + z.area * z.height, 0),
      224.8,
      1.0,
    );
    // Die Gegenprobe: mit der alten Regel — kleinste Wandhöhe ohne Ausnahme —
    // wären es 192,3 m³. Bleibt diese Zeile stehen und die obige fällt, ist
    // die Ausnahme wieder verschwunden.
    const alt = raeume.reduce((s2, z) => {
      let h = r.levels[0].height;
      for (const b of z.boundaries) {
        const w = r.walls.find((x) => x.id === b.wallId);
        if (w && w.height < h) h = w.height;
      }
      return s2 + z.area * h;
    }, 0);
    check('Mit der alten Regel wären es [m³]', alt, 192.3, 1.0);
    check('Die Ausnahme bringt mehr als 30 m³', raeume.reduce((s2, z) => s2 + z.area * z.height, 0) - alt > 30, true);
  }

  // --- Mehrere Geschosse -----------------------------------------------------
  //  Die Beispielwohnung hat nur `story: 0` — enthält aber ein Objekt
  //  `stairs`, also gibt es weitere Geschosse, die nur nicht mitgescannt
  //  wurden. Dass der Import damit umgehen kann, war bis hierher ungeprüft.
  //
  //  Gebaut wird deshalb ein zweigeschossiger Scan von Hand: dasselbe Rechteck
  //  auf `story: 0` und `story: 1`, das obere um 2,70 m höher. Geprüft wird
  //  die Trennung (kein Knoten darf zwei Geschosse verbinden) und die
  //  Benennung — RoomPlan zählt durch, aus „Geschoss 0" muss „Erdgeschoss"
  //  werden, sonst ist die Übersetzung keine.
  {
    const M = (dx: number, dz: number, cx: number, cy: number, cz: number): number[] =>
      [dx, 0, dz, 0, 0, 1, 0, 0, -dz, 0, dx, 0, cx, cy, cz, 1];
    const wand = (
      id: string, dx: number, dz: number, cx: number, cz: number,
      laenge: number, story: number, cy: number,
    ) => ({
      identifier: id, parentIdentifier: null, dimensions: [laenge, 2.5, 0],
      transform: M(dx, dz, cx, cy, cz), story,
      confidence: { high: {} }, category: { wall: {} }, polygonCorners: [],
    });
    const stock = (story: number, cy: number, p: string) => [
      wand(p + '1', 1, 0, 0, -2, 5, story, cy), wand(p + '2', 0, 1, 2.5, 0, 4, story, cy),
      wand(p + '3', 1, 0, 0, 2, 5, story, cy), wand(p + '4', 0, 1, -2.5, 0, 4, story, cy),
    ];
    const zwei = importRaumplan(
      JSON.stringify({
        version: 2,
        walls: [...stock(0, 0, 'EG'), ...stock(1, 2.7, 'OG')],
        doors: [], windows: [], openings: [], floors: [], objects: [],
        sections: [
          { label: 'livingRoom', story: 0, center: [0, -0.5, 0] },
          { label: 'bedroom', story: 1, center: [0, 2.2, 0] },
        ],
      }),
    );
    check('Zweigeschossiger Scan wird gelesen', zwei.ok, true);
    check('Zwei Geschosse', zwei.levels.length, 2);
    check('Der Importer liefert Platzhalternamen', zwei.levels[0].name, 'Geschoss 0');
    check('Höhenlage des oberen Geschosses [m]', zwei.levels[1].elevation, 2.7, 0.01);
    check('Vier Wände unten', zwei.walls.filter((w) => w.levelId === zwei.levels[0].id).length, 4);
    check('Vier Wände oben', zwei.walls.filter((w) => w.levelId === zwei.levels[1].id).length, 4);
    // Kein Knoten darf zu zwei Geschossen gehören — sonst zöge das Verschieben
    // einer Wand im Erdgeschoss die darüber mit.
    check(
      'Kein Knoten verbindet zwei Geschosse',
      new Set(zwei.nodes.map((n) => n.levelId)).size,
      2,
    );
    check('Knoten unten', zwei.nodes.filter((n) => n.levelId === zwei.levels[0].id).length, 4);
    check('Knoten oben', zwei.nodes.filter((n) => n.levelId === zwei.levels[1].id).length, 4);
    check('Beide Raumbereiche übernommen', zwei.raumHinweise.length, 2);
    check(
      'Der obere Hinweis gehört zum oberen Geschoss',
      zwei.raumHinweise.find((h) => h.name === 'Schlafen')?.levelId ?? 'fehlt',
      zwei.levels[1].id,
    );

    // Die Benennung, die der Speicher daraus macht — dieselbe Rechnung wie
    // beim IFC-Import.
    const sortiert = [...zwei.levels].sort((a, b) => a.elevation - b.elevation);
    const namen = benenneGeschosse(sortiert);
    const eg = erdgeschossIndex(sortiert.map((l) => l.elevation));
    check('Unteres Geschoss heißt EG', namen[0], 'EG');
    check('Oberes Geschoss heißt 1. OG', namen[1], '1. OG');
    check('Das Erdgeschoss bekommt die Ordnungszahl 0', 0 - eg, 0);

    // Und mit Keller: das unterste Geschoss ist dann nicht das Erdgeschoss.
    const mitKeller = [{ elevation: -2.6 }, { elevation: 0 }, { elevation: 2.7 }];
    const kellerNamen = benenneGeschosse(mitKeller);
    check('Mit Keller heißt das unterste Geschoss KG', kellerNamen[0], 'KG');
    check('Und das mittlere EG', kellerNamen[1], 'EG');
    check(
      'Der Keller bekommt die Ordnungszahl −1',
      0 - erdgeschossIndex(mitKeller.map((l) => l.elevation)),
      -1,
    );
  }

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
