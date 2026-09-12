/**
 * Prüfblock „Aufmaß nachziehen" — Wände begradigen und Lücken schließen.
 * ---------------------------------------------------------------------------
 * Die beiden Handgriffe nach einem Import. Beide bewegen Geometrie, und beide
 * können dabei mehr kaputt machen, als sie richten — genau daran hängen die
 * Prüfungen hier:
 *
 *  · **Begradigen darf keine Ecke aufreißen.** Es bewegt Knoten, nicht Wände;
 *    gemessen wird deshalb nicht, ob die Wände gerade stehen (das ist leicht),
 *    sondern ob hinterher dieselbe Zahl Räume mit fast derselben Fläche
 *    herauskommt. Eine Begradigung, die einen Raum verliert, hat die
 *    Topologie zerrissen.
 *  · **Begradigen darf Öffnungen nicht aus der Wand schieben.** Wandlängen
 *    ändern sich dabei um Zentimeter. Bleibt eine Tür auf ihrem absoluten
 *    Abstand stehen, steht sie am kurzen Ende über die Wandkante hinaus.
 *  · **Die Bremse muss greifen.** Eine fast schräge Wand kann zwei Wandzüge
 *    verketten, die nichts miteinander zu tun haben. Ohne die Versatzgrenze
 *    zöge das Begradigen den halben Grundriss zusammen. Der Fall steht unten
 *    als eigenes Beispiel, weil er in der Scandatei nicht vorkommt.
 *  · **Lücken schließen muss die Räume mehren, nicht mindern.** Wo eine Wand
 *    fehlt, sind zwei Räume einer. Wird die Lücke geschlossen, müssen daraus
 *    wieder zwei werden — sonst hat das Schließen an der falschen Stelle
 *    angesetzt.
 *
 * Geprüft wird an derselben echten iPhone-Aufnahme wie der Import
 * (`scripts/referenz/raumscan-beispiel.json`) und an kleinen, von Hand
 * gebauten Fällen für das, was in der Aufnahme nicht vorkommt.
 */

import { readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import type { CheckFn } from './typ';
import type { BimNode, Opening, Wall } from '../../src/types/bim';
import { importRaumplan } from '../../src/lib/raumplanImport';
import { begradige, achsAbweichung } from '../../src/lib/begradigen';
import { findeLuecken, oeffnungFuerLuecke } from '../../src/lib/luecken';
import { detectRooms } from '../../src/lib/roomDetection';

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

const N = (id: string, x: number, y: number): BimNode => ({ id, x, y, levelId: 'L' });
const W = (id: string, a: string, b: string): Wall => ({
  id,
  levelId: 'L',
  a,
  b,
  thickness: 0.24,
  height: 2.5,
  type: 'exterior',
  layerId: 'layer-walls',
});

/** Räume zählen und messen — die Probe darauf, dass die Topologie hält. */
function raeume(walls: Wall[], nodes: Record<string, BimNode>, openings: Opening[], levelId: string) {
  const gefunden = detectRooms({
    walls,
    nodes,
    openings,
    levelId,
    defaultHeight: 2.5,
    northAngle: 0,
  });
  return { anzahl: gefunden.length, flaeche: gefunden.reduce((s, r) => s + r.area, 0) };
}

export function pruefeAufmass(check: CheckFn): void {
  console.log('\n▸ Aufmaß nachziehen — begradigen und Lücken schließen');

  const basis = wurzel();
  check('Die Beispieldatei ist auffindbar', basis !== undefined, true);
  if (!basis) return;
  const scan = importRaumplan(
    readFileSync(join(basis, 'scripts', 'referenz', 'raumscan-beispiel.json'), 'utf-8'),
  );
  const knoten: Record<string, BimNode> = Object.fromEntries(scan.nodes.map((n) => [n.id, n]));
  const levelId = scan.levels[0].id;

  // =========================================================== Begradigen
  const vorher = raeume(scan.walls, knoten, scan.openings, levelId);
  const geradeVorher = scan.walls.filter(
    (w) => achsAbweichung(knoten[w.a], knoten[w.b]) < 0.1,
  ).length;
  check('Vor dem Begradigen stehen 23 von 40 Wänden auf der Achse', geradeVorher, 23);

  const b = begradige(scan.walls, knoten);
  check('Bewegte Knoten', b.bewegt, 28);
  check('Größter Versatz [m]', b.groessterVersatz, 0.126, 0.002);
  check('Achsparallel vorher', b.achsparallelVorher, 23);
  check('Achsparallel nachher', b.achsparallelNachher, 40);
  check('Alle 40 Wände stehen danach auf der Achse', b.achsparallelNachher === scan.walls.length, true);
  check('Kein Wandzug wegen des Versatzes übersprungen', b.uebersprungen, 0);

  // Der Versatz muss unter der eigenen Grenze bleiben — sonst wäre die Bremse
  // umgangen, nicht eingehalten.
  check('Größter Versatz unter der Vorgabe von 0,30 m', b.groessterVersatz <= 0.3, true);

  // Neue Lage anwenden und die Topologie nachmessen.
  const neu: Record<string, BimNode> = Object.fromEntries(
    Object.entries(knoten).map(([id, n]) => [id, b.knoten[id] ? { ...n, ...b.knoten[id] } : n]),
  );
  // Öffnungen verhältnisgleich mitführen — genau wie die Aktion im Speicher.
  const oeffnungenNeu: Opening[] = scan.openings.map((o) => {
    const l = b.laengen[o.wallId];
    if (!l || l.vorher <= 0) return o;
    const faktor = l.nachher / l.vorher;
    return {
      ...o,
      distance: Math.min(Math.max(o.distance * faktor, o.width / 2), l.nachher - o.width / 2),
    };
  });

  const nachher = raeume(scan.walls, neu, oeffnungenNeu, levelId);
  check('Die Raumzahl bleibt beim Begradigen gleich', nachher.anzahl, vorher.anzahl);
  check('Die Gesamtfläche ändert sich um weniger als 1 m²', Math.abs(nachher.flaeche - vorher.flaeche) < 1, true);
  check('Gesamtfläche nach dem Begradigen [m²]', nachher.flaeche, 97.0, 1.0);

  // Jede Öffnung muss weiterhin vollständig in ihrer Wand liegen. Das ist der
  // Fehler, den das verhältnisgleiche Mitführen verhindert.
  const laenge = (w: Wall, n: Record<string, BimNode>): number =>
    Math.hypot(n[w.b].x - n[w.a].x, n[w.b].y - n[w.a].y);
  const drin = oeffnungenNeu.every((o) => {
    const w = scan.walls.find((x) => x.id === o.wallId);
    if (!w) return false;
    const l = laenge(w, neu);
    return o.distance - o.width / 2 >= -0.01 && o.distance + o.width / 2 <= l + 0.01;
  });
  check('Jede Öffnung liegt auch danach in ihrer Wand', drin, true);

  // Zweimal begradigen darf nichts mehr bewegen — sonst schwingt das Verfahren.
  const zweimal = begradige(scan.walls, neu);
  check('Ein zweiter Durchgang bewegt nichts mehr', zweimal.bewegt, 0);

  // --- Die Bremse ------------------------------------------------------------
  //  Zwei Rechtecke, verbunden über eine fast waagerechte Wand, deren Enden
  //  4 m auseinanderliegen. Ohne Grenze zöge das Begradigen beide Rechtecke
  //  auf eine Höhe und risse alles auseinander.
  {
    const nodes: Record<string, BimNode> = {};
    for (const n of [N('a', 0, 0), N('b', 5, 0), N('c', 5, 4), N('d', 0, 4), N('e', 9, 8), N('f', 14, 8)]) {
      nodes[n.id] = n;
    }
    // c(5,4) → e(9,8): 45°, also schräg — die bleibt ohnehin.
    // b(5,0) → f(14,8): 41°, ebenfalls schräg.
    // Der kritische Fall ist eine *fast* waagerechte Wand über große Distanz:
    const langeFastWaagerecht = { ...W('lang', 'd', 'g'), a: 'd', b: 'g' };
    nodes['g'] = N('g', 20, 4.6); // 20 m lang, 1,9° Neigung — innerhalb der Toleranz
    const walls = [W('w1', 'a', 'b'), W('w2', 'b', 'c'), W('w3', 'c', 'd'), W('w4', 'd', 'a'), langeFastWaagerecht];
    const r = begradige(walls, nodes, { maxVersatz: 0.2 });
    check('Die Bremse überspringt den zu weiten Wandzug', r.uebersprungen >= 1, true);
    check('Und bewegt dessen Knoten nicht', r.knoten['g'] === undefined, true);
    // Mit großzügiger Grenze darf derselbe Zug bewegt werden.
    const locker = begradige(walls, nodes, { maxVersatz: 1.0 });
    check('Mit größerer Grenze wird er bewegt', locker.bewegt > 0, true);
  }

  // --- Schräges bleibt schräg -------------------------------------------------
  {
    const nodes: Record<string, BimNode> = {};
    for (const n of [N('a', 0, 0), N('b', 5, 0), N('c', 5, 4), N('d', 2.5, 6), N('e', 0, 4)]) {
      nodes[n.id] = n;
    }
    // c→d und d→e sind ein Giebel mit 38°: kein Messfehler, sondern Absicht.
    const walls = [W('w1', 'a', 'b'), W('w2', 'b', 'c'), W('w3', 'c', 'd'), W('w4', 'd', 'e'), W('w5', 'e', 'a')];
    const r = begradige(walls, nodes);
    check('Zwei schräge Wände werden als schräg erkannt', r.schraeg, 2);
    check('Der Giebelpunkt bleibt unangetastet', r.knoten['d'] === undefined, true);
  }

  // ============================================================== Lücken
  const luecken = findeLuecken(scan.walls, knoten, levelId);
  check('Lücken im Scan', luecken.length, 2);
  check('Beide Lücken treffen ein zweites loses Ende', luecken.every((l) => Boolean(l.zielKnotenId)), true);
  check('Engste Lücke [m]', luecken[0].weite, 0.74, 0.02);
  check('Weiteste Lücke [m]', luecken[luecken.length - 1].weite, 0.75, 0.02);
  check('Keine Lücke weiter als die Reichweite', luecken.every((l) => l.weite <= 3.0), true);
  check(
    'Jede Lücke nennt die Wand, an der sie hängt',
    luecken.every((l) => scan.walls.some((w) => w.id === l.wandId)),
    true,
  );

  // Vier lose Enden, aber nur zwei Lücken: sie zeigen paarweise aufeinander.
  // Würden beide Enden je einen Vorschlag liefern, entstünde beim Anklicken
  // dieselbe Wand zweimal.
  const grad = new Map<string, number>();
  for (const w of scan.walls) {
    grad.set(w.a, (grad.get(w.a) ?? 0) + 1);
    grad.set(w.b, (grad.get(w.b) ?? 0) + 1);
  }
  check('Lose Enden im Scan', [...grad.values()].filter((g) => g === 1).length, 4);
  check('Gegenseitige Paare werden zu einer Lücke zusammengefasst', luecken.length, 2);

  // --- Maße der Öffnung ------------------------------------------------------
  const tuer = oeffnungFuerLuecke('tuer', 0.74, 2.47);
  check('Tür füllt die Lücke [m]', tuer?.width ?? -1, 0.7, 0.001);
  check('Tür ohne Brüstung', tuer?.sillHeight ?? -1, 0);
  const breiteTuer = oeffnungFuerLuecke('tuer', 3.0, 2.47);
  check('Bei sehr weiter Lücke bleibt die Tür auf üblichem Maß [m]', breiteTuer?.width ?? -1, 1.26, 0.001);
  const durchgang = oeffnungFuerLuecke('durchgang', 3.0, 2.47);
  check('Ein Durchgang darf so breit sein wie die Lücke [m]', durchgang?.width ?? -1, 2.96, 0.001);
  // `null` heißt: für diese Lücke gibt es keine sinnvolle Öffnung. Das ist ein
  // eigener Zustand und nicht „Breite 0" — geprüft wird deshalb auf genau ihn.
  check('Zu schmale Lücke bekommt keine Öffnung', oeffnungFuerLuecke('tuer', 0.15, 2.5) === null, true);
  const fenster = oeffnungFuerLuecke('fenster', 1.4, 2.47);
  check('Fenster mit Brüstung [m]', fenster?.sillHeight ?? -1, 0.9, 0.001);
  check(
    'Fenster passt unter die Wandhöhe',
    (fenster?.sillHeight ?? 0) + (fenster?.height ?? 0) <= 2.47,
    true,
  );

  // --- Schließen mehrt die Räume ---------------------------------------------
  //  Die eigentliche Probe: die beiden Lücken trennen je zwei Räume, die ohne
  //  sie einer sind. Werden sie geschlossen, muss die Raumzahl um zwei steigen.
  {
    const nodes = { ...knoten };
    const walls = [...scan.walls];
    let zaehler = 0;
    for (const l of luecken) {
      const ziel = l.zielKnotenId ? nodes[l.zielKnotenId] : null;
      if (!ziel) continue;
      const quelle = walls.find((w) => w.id === l.wandId);
      walls.push({
        id: `luecke-${zaehler++}`,
        levelId,
        a: l.knotenId,
        b: ziel.id,
        thickness: quelle?.thickness ?? 0.115,
        height: quelle?.height ?? 2.5,
        type: quelle?.type ?? 'interior',
        layerId: 'layer-walls',
      });
    }
    check('Beide Lücken ließen sich schließen', zaehler, 2);
    const danach = raeume(walls, nodes, scan.openings, levelId);
    check('Geschlossene Lücken ergeben zwei Räume mehr', danach.anzahl, vorher.anzahl + 2);
    check('Die Gesamtfläche wächst dabei nicht', danach.flaeche <= vorher.flaeche + 0.01, true);
  }

  // ======================================= Geschätzte Wandstärken
  //  Die Schätzung muss als Schätzung im Modell stehen, nicht nur in einer
  //  Statuszeile, die beim nächsten Klick verschwindet. Aus ihr folgt die
  //  Bauteilfläche und damit der Transmissionsverlust: bei 101 m Wandlänge
  //  und 2,45 m Höhe macht ein Irrtum von 12 cm in der Stärke rund 25 m²
  //  Wandfläche aus — mehr als die Fensterfläche der ganzen Wohnung.
  check(
    'Jede importierte Wand trägt das Kennzeichen „geschätzt"',
    scan.walls.every((w) => w.thicknessEstimated === true),
    true,
  );
  check(
    'Gezählt werden alle 40',
    scan.walls.filter((w) => w.thicknessEstimated).length,
    40,
  );
  // Die Gegenprobe: eine von Hand gezeichnete Wand trägt es nicht. Stünde es
  // überall, wäre der Schritt „Wandstärken bestätigen" nie erledigt.
  check('Eine gezeichnete Wand trägt es nicht', W('x', 'a', 'b').thicknessEstimated === undefined, true);

  // --- Keine Lücke, wo keine ist ---------------------------------------------
  {
    const nodes: Record<string, BimNode> = {};
    for (const n of [N('a', 0, 0), N('b', 5, 0), N('c', 5, 4), N('d', 0, 4)]) nodes[n.id] = n;
    const walls = [W('w1', 'a', 'b'), W('w2', 'b', 'c'), W('w3', 'c', 'd'), W('w4', 'd', 'a')];
    check('Ein geschlossenes Rechteck hat keine Lücke', findeLuecken(walls, nodes, 'L').length, 0);
  }

  // --- Zu weit ist keine Lücke ------------------------------------------------
  {
    const nodes: Record<string, BimNode> = {};
    for (const n of [N('a', 0, 0), N('b', 5, 0), N('c', 12, 0)]) nodes[n.id] = n;
    // b→c wäre 7 m entfernt von a; a und b hängen zusammen, c ist allein.
    const walls = [W('w1', 'a', 'b')];
    nodes['c'] = N('c', 12, 0);
    walls.push(W('w2', 'c', 'd'));
    nodes['d'] = N('d', 17, 0);
    const l = findeLuecken(walls, nodes, 'L');
    check('Eine 7 m weite Lücke wird nicht vorgeschlagen', l.length, 0);
  }
}
