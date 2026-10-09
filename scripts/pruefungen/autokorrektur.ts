/**
 * Prüfblock „Grundriss prüfen und korrigieren" (1.76.0).
 * ---------------------------------------------------------------------------
 * Ein Durchlauf, der Geometrie anfasst, kann mehr kaputt machen, als er
 * richtet. Geprüft wird deshalb an jeder Korrektur zweierlei:
 *
 *  · **Sie wirkt.** Ein Raum, der wegen eines verfehlten Ecks nicht erkannt
 *    wurde, ist danach da — mit der Fläche, die er von Hand gezeichnet hätte.
 *  · **Sie schweigt, wo nichts zu tun ist (Gegenprobe).** Ein sauberer
 *    Grundriss bekommt keinen einzigen Vorschlag; eine parallel laufende
 *    Vorsatzschale wird nicht als T-Stoß angeschlossen; ein 20-cm-Wandstück
 *    ist kein Überstand; eine Wand mit Tür ist kein Stummel; und eine Lücke
 *    ohne Antwort bleibt offen.
 *
 * Die Sollwerte sind von Hand gerechnet und stehen jeweils darüber. Dazu zwei
 * echte Aufnahmen: der RoomPlan-Scan aus `aufmass.ts` und der Feldscan vom
 * 02.10.2026 — dort zählt, dass kein Raum verloren geht und die Fläche hält.
 */

import { readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import type { CheckFn } from './typ';
import type { BimNode, Level, Opening, PipeRun, Room, Wall } from '../../src/types/bim';
import {
  ANSCHLUSS_TOLERANZ,
  berichtSatz,
  kleineRaeume,
  planeKorrektur,
  wendeKorrekturAn,
  type KorrekturAuswahl,
  type KorrekturDokument,
} from '../../src/lib/autokorrektur';
import { detectRooms } from '../../src/lib/roomDetection';
import { achsAbweichung } from '../../src/lib/begradigen';
import { importRaumplan } from '../../src/lib/raumplanImport';
import { importBuildingModel } from '../../src/lib/buildingModelImport';

function wurzel(): string | undefined {
  let pfad = process.cwd();
  for (let i = 0; i < 4; i++) {
    try {
      if (statSync(join(pfad, 'scripts', 'referenz')).isDirectory()) return pfad;
    } catch {
      /* weiter oben */
    }
    const eltern = pfad.slice(0, pfad.lastIndexOf(sep));
    if (!eltern || eltern === pfad) break;
    pfad = eltern;
  }
  return undefined;
}

// ------------------------------------------------------------- Bausteine

const L = 'L';
const LEVEL = { id: L, name: 'EG', order: 0, elevation: 0, height: 2.5 } as unknown as Level;

/** Ein leeres Dokument; Wände als Kette von Punkten, je Kette geschlossen oder offen. */
function dok(): KorrekturDokument {
  return { nodes: {}, walls: {}, openings: {}, durchbrueche: {}, fixtures: {}, pipes: {}, pipeAccessories: {}, rooms: {}, levels: { [L]: LEVEL } };
}
let zaehler = 0;
const neueId = (p: string): string => `${p}-t${zaehler++}`;
function knoten(d: KorrekturDokument, x: number, y: number): string {
  const id = neueId('n');
  d.nodes[id] = { id, x, y, levelId: L } as BimNode;
  return id;
}
function wand(d: KorrekturDokument, a: string, b: string, dicke = 0.24): string {
  const id = neueId('w');
  d.walls[id] = { id, levelId: L, a, b, thickness: dicke, height: 2.5, type: 'exterior', layerId: 'layer-walls' } as Wall;
  return id;
}
/** Wandzug durch die Punkte; `zu` schließt ihn zum Ring. */
function zug(d: KorrekturDokument, punkte: [number, number][], zu: boolean): string[] {
  const ids = punkte.map(([x, y]) => knoten(d, x, y));
  for (let i = 0; i < ids.length - 1; i++) wand(d, ids[i], ids[i + 1]);
  if (zu) wand(d, ids[ids.length - 1], ids[0]);
  return ids;
}
/** Lose Wandenden im Modell — Knoten, an denen nur eine Wand hängt. */
function loseEnden(d: KorrekturDokument): number {
  const g = new Map<string, number>();
  for (const w of Object.values(d.walls)) for (const k of [w.a, w.b]) g.set(k, (g.get(k) ?? 0) + 1);
  return [...g.values()].filter((n) => n === 1).length;
}
function raeume(d: KorrekturDokument): { anzahl: number; flaeche: number } {
  let anzahl = 0;
  let flaeche = 0;
  for (const levelId of new Set(Object.values(d.walls).map((w) => w.levelId))) {
    const r = detectRooms({
      walls: Object.values(d.walls),
      nodes: d.nodes,
      openings: Object.values(d.openings),
      levelId,
      defaultHeight: 2.5,
      northAngle: 0,
    });
    anzahl += r.length;
    flaeche += r.reduce((s, x) => s + x.area, 0);
  }
  return { anzahl, flaeche };
}
const NICHTS: KorrekturAuswahl = { anschluesse: false, stummel: false, begradigen: false, leitungen: false, kleineRaeume: false, luecken: {} };
const ALLES: KorrekturAuswahl = { anschluesse: true, stummel: true, begradigen: true, leitungen: true, kleineRaeume: true, luecken: {} };

/*
 * Fläche des sauberen 4 × 3-Raums mit 24-cm-Wänden, lichte Maße:
 * (4 − 0,24) × (3 − 0,24) = 3,76 × 2,76 = 10,3776 m².
 */
const FLAECHE_4x3 = 3.76 * 2.76;

export function pruefeAutokorrektur(check: CheckFn): void {
  console.log('\n▸ Grundriss prüfen und korrigieren');

  // ================================================ A · Gegenprobe: sauber
  {
    const d = dok();
    zug(d, [[0, 0], [4, 0], [4, 3], [0, 3]], true);
    const p = planeKorrektur(d);
    check('A · sauberer Raum: keine einzige Korrektur angeboten', p.summe, 0);
    check('A · sauberer Raum: Fläche wie von Hand [m²]', raeume(d).flaeche, FLAECHE_4x3, 0.01);
  }

  // ===================================== B · Ecke um 2 cm verfehlt → zusammen
  {
    const d = dok();
    // Der Zug endet bei (0,02 | 0) statt bei (0 | 0): ein loses Ende 2 cm vor dem Anfang.
    zug(d, [[0, 0], [4, 0], [4, 3], [0, 3], [0.02, 0]], false);
    // Die Raumerkennung schweißt bis 5 cm zusammen und findet den Raum schon
    // vorher. Im Modell selbst sind es aber zwei lose Enden — die sieht man
    // im Plan, im 3D-Modell und in der Übergabe.
    check('B · vorher erkennt die Raumerkennung den Raum trotzdem', raeume(d).anzahl, 1);
    check('B · vorher zwei lose Wandenden im Modell', loseEnden(d), 2);
    const p = planeKorrektur(d);
    check('B · ein Anschluss angeboten', p.anschluesse.length, 1);
    check('B · als Zusammenführung zweier Knoten', p.anschluesse[0]?.art, 'knoten');
    check('B · Abstand [m]', p.anschluesse[0]?.abstand ?? -1, 0.02, 1e-9);
    check('B · keine Lücke daraus (2 cm sind keine Frage an den Menschen)', p.luecken.length, 0);
    const b = wendeKorrekturAn(d, { ...NICHTS, anschluesse: true }, neueId);
    check('B · zusammengeführt', b.zusammengefuehrt, 1);
    // Der lose Knoten (Grad 1) geht im Eckknoten (Grad 1, Anfang des Zugs)
    // auf — beide haben Grad 1, es bleibt der zuerst gefundene. Bewegt wird
    // also genau ein Punkt um 2 cm.
    check('B · größte Bewegung [m]', b.maxBewegung, 0.02, 1e-9);
    const r = raeume(d);
    check('B · danach kein loses Ende mehr', loseEnden(d), 0);
    check('B · danach genau ein Raum', r.anzahl, 1);
    check('B · mit der Fläche des sauberen Raums [m²]', r.flaeche, FLAECHE_4x3, 0.01);
    check('B · zweiter Durchlauf findet nichts mehr', planeKorrektur(d).summe, 0);
  }

  // =========================== C · T-Stoß 2 cm verfehlt → angeschlossen, geteilt
  {
    const d = dok();
    // Außenring 6 × 3, unten in der Mitte geteilt (3 | 0), damit die
    // Innenwand dort einen echten T-Stoß hat.
    const a = knoten(d, 0, 0), m = knoten(d, 3, 0), b = knoten(d, 6, 0), c = knoten(d, 6, 3), e = knoten(d, 0, 3);
    wand(d, a, m); wand(d, m, b); wand(d, b, c); wand(d, c, e); wand(d, e, a);
    // Innenwand von (3 | 0) nach (3 | 2,98) — 2 cm unter der oberen Wand.
    const oben = knoten(d, 3, 2.98);
    wand(d, m, oben, 0.115);
    // Auch den T-Stoß schweißt die Raumerkennung — zwei Räume schon vorher.
    check('C · vorher zwei Räume (die Raumerkennung überbrückt 2 cm)', raeume(d).anzahl, 2);
    check('C · vorher ein loses Wandende im Modell', loseEnden(d), 1);
    const p = planeKorrektur(d);
    check('C · ein Anschluss an eine Wand', p.anschluesse.filter((x) => x.art === 'wand').length, 1);
    wendeKorrekturAn(d, { ...NICHTS, anschluesse: true }, neueId);
    const r = raeume(d);
    check('C · danach kein loses Ende mehr', loseEnden(d), 0);
    check('C · danach zwei Räume', r.anzahl, 2);
    /*
     * Lichte Flächen: links (3 − 0,12 − 0,0575) × 2,76 und rechts ebenso
     * = 2 × 2,8225 × 2,76 = 15,5802 m².
     */
    check('C · Fläche beider Räume [m²]', r.flaeche, 2 * 2.8225 * 2.76, 0.01);
    check('C · die obere Wand ist geteilt (6 + 1 Wände)', Object.keys(d.walls).length, 7);
  }

  // ====================== D · Gegenprobe: parallele Wand daneben, kein T-Stoß
  {
    const d = dok();
    zug(d, [[0, 0], [4, 0], [4, 3], [0, 3]], true);
    // Eine Vorsatzschale, 3 cm vor der unteren Wand, von x = 1 bis 3.
    zug(d, [[1, 0.03], [3, 0.03]], false);
    const p = planeKorrektur(d);
    check('D · parallele Wand 3 cm daneben: kein Anschluss', p.anschluesse.length, 0);
  }

  // ======================================= E · Stummel und Überstand
  {
    const d = dok();
    // Ring, dessen letzte Wand vor dem Ziel aufhört und mit einem 3-cm-Stück
    // angeschlossen ist: (0,03 | 0) → (0 | 0).
    const ids = zug(d, [[0, 0], [4, 0], [4, 3], [0, 3], [0.03, 0]], false);
    const stummel = wand(d, ids[4], ids[0]);
    // Überstand: von der Ecke (4 | 3) läuft eine Wand 8 cm weiter nach rechts.
    const ueber = knoten(d, 4.08, 3);
    wand(d, ids[2], ueber);
    // Gegenprobe: an der Ecke (0 | 3) ein 20-cm-Stück — zu lang für einen Überstand.
    const lang = knoten(d, -0.2, 3);
    wand(d, ids[3], lang);
    const p = planeKorrektur(d);
    check('E · ein Stummel', p.stummel.filter((s) => s.art === 'stummel').length, 1);
    check('E · der Stummel ist die 3-cm-Wand', p.stummel.find((s) => s.art === 'stummel')?.wandId ?? '', stummel);
    check('E · ein Überstand (8 cm), nicht das 20-cm-Stück', p.stummel.filter((s) => s.art === 'ueberstand').length, 1);
    check('E · Stummel ist kein Anschluss (die Knoten sind verbunden)', p.anschluesse.length, 0);
    const vorher = raeume(d);
    const b = wendeKorrekturAn(d, { ...NICHTS, stummel: true }, neueId);
    check('E · Stummel entfernt', b.stummelEntfernt, 1);
    check('E · Überstand entfernt', b.ueberstaendeEntfernt, 1);
    const r = raeume(d);
    check('E · Raumzahl bleibt', r.anzahl, vorher.anzahl);
    /*
     * Beide Enden des Stummels haben zwei Wände; es bleibt das erste, der
     * Knoten bei (0,03 | 0). Die linke Wand steht danach 3 cm schräg, und der
     * Raum verliert höchstens das Dreieck ½ · 0,03 · 2,76 = 0,0414 m².
     */
    check('E · Fläche danach wie der saubere Raum, bis auf das Dreieck [m²]', r.flaeche, FLAECHE_4x3, 0.0415);
    check('E · das 20-cm-Stück steht noch', Object.values(d.walls).some((w) => w.b === lang || w.a === lang), true);
  }

  // ==================== F · Gegenprobe: Stummel mit Tür wird nicht angeboten
  {
    const d = dok();
    const ids = zug(d, [[0, 0], [4, 0], [4, 3], [0, 3], [0.03, 0]], false);
    const stummel = wand(d, ids[4], ids[0]);
    d.openings['o1'] = { id: 'o1', wallId: stummel, kind: 'door', distance: 0.015, width: 0.01, height: 2, sillHeight: 0 } as Opening;
    check('F · Wand mit Öffnung: kein Stummel-Vorschlag', planeKorrektur(d).stummel.length, 0);
  }

  // ===================================== G · doppelte Wand, immer bereinigt
  {
    const d = dok();
    const ids = zug(d, [[0, 0], [4, 0], [4, 3], [0, 3]], true);
    const doppel = wand(d, ids[1], ids[0]); // gegenläufig auf der unteren Wand
    d.openings['o2'] = { id: 'o2', wallId: doppel, kind: 'window', distance: 1.0, width: 1.0, height: 1.2, sillHeight: 0.9 } as Opening;
    const p = planeKorrektur(d);
    check('G · eine doppelte Wand gefunden', p.doppelwaende.length, 1);
    const b = wendeKorrekturAn(d, NICHTS, neueId);
    check('G · auch ohne Haken entfernt (zwei Wände an einer Stelle sind nie gewollt)', b.doppelwaendeEntfernt, 1);
    check('G · vier Wände übrig', Object.keys(d.walls).length, 4);
    // Gegenläufig: das Fenster bei 1,0 m von (4|0) aus liegt bei 3,0 m von (0|0) aus.
    const o = d.openings['o2'];
    check('G · das Fenster wandert mit und wird gespiegelt [m]', o.distance, 3.0, 1e-9);
    check('G · es hängt an einer vorhandenen Wand', !!d.walls[o.wallId], true);
  }

  // ======================================== H · Lücke: nur mit Antwort
  {
    const bau = (): { d: KorrekturDokument } => {
      const d = dok();
      // Untere Wand mit 0,90 m Lücke zwischen x = 1,5 und 2,4.
      const a = knoten(d, 0, 0), l1 = knoten(d, 1.5, 0), l2 = knoten(d, 2.4, 0), b = knoten(d, 4, 0), c = knoten(d, 4, 3), e = knoten(d, 0, 3);
      wand(d, l1, a); wand(d, l2, b); wand(d, b, c); wand(d, c, e); wand(d, e, a);
      return { d };
    };
    const { d } = bau();
    const p = planeKorrektur(d);
    check('H · eine Lücke (zwei lose Enden, die aufeinander zeigen)', p.luecken.length, 1);
    check('H · Weite [m]', p.luecken[0]?.weite ?? -1, 0.9, 1e-9);
    check('H · Hinweis „Türbreite"', p.luecken[0]?.hinweis ?? '', 'Türbreite');
    check('H · kein Anschluss daraus (90 cm sind eine Frage)', p.anschluesse.length, 0);

    // Ohne Antwort: alles andere angehakt, die Lücke bleibt.
    wendeKorrekturAn(d, ALLES, neueId);
    check('H · ohne Antwort bleibt die Lücke offen (kein Raum)', raeume(d).anzahl, 0);

    const zwei = bau();
    const knotenDerLuecke = planeKorrektur(zwei.d).luecken[0].knotenId;
    const b = wendeKorrekturAn(zwei.d, { ...NICHTS, luecken: { [knotenDerLuecke]: 'tuer' } }, neueId);
    check('H · mit „Tür" geschlossen', b.lueckenGeschlossen, 1);
    check('H · eine Öffnung gesetzt', b.oeffnungenGesetzt, 1);
    const r = raeume(zwei.d);
    check('H · danach ein Raum', r.anzahl, 1);
    check('H · Fläche wie der saubere Raum [m²]', r.flaeche, FLAECHE_4x3, 0.01);
    const tuer = Object.values(zwei.d.openings)[0];
    // Die Tür füllt die Lücke bis auf je 2 cm: 0,90 − 0,04 = 0,86 m.
    check('H · Tür 0,86 m breit', tuer?.width ?? 0, 0.86, 1e-9);
    check('H · Tür mittig in der neuen Wand [m]', tuer?.distance ?? 0, 0.45, 1e-9);
  }

  // ============================================ I · schief → begradigt
  {
    const d = dok();
    // Rechte obere Ecke 3 cm zu weit rechts: (4,03 | 3).
    zug(d, [[0, 0], [4, 0], [4.03, 3], [0, 3]], true);
    const p = planeKorrektur(d);
    check('I · ein Geschoss mit schiefen Wänden', p.schief.length, 1);
    const b = wendeKorrekturAn(d, { ...NICHTS, begradigen: true }, neueId);
    check('I · Knoten bewegt', b.begradigt > 0, true);
    const schief = Object.values(d.walls).filter((w) => achsAbweichung(d.nodes[w.a], d.nodes[w.b]) > 1e-6).length;
    check('I · danach alle Wände auf der Achse', schief, 0);
    check('I · Raum bleibt', raeume(d).anzahl, 1);
    // Längengewichtet zwischen 4,00 und 4,03 — die Fläche liegt zwischen beiden Rechtecken.
    const f = raeume(d).flaeche;
    check('I · Fläche zwischen 3,76 × 2,76 und 3,79 × 2,76', f >= FLAECHE_4x3 - 1e-6 && f <= 3.79 * 2.76 + 1e-6, true);
  }

  // ======================================================== K · Leitungen
  {
    const d = dok();
    const run = (id: string, punkte: { x: number; y: number }[]): PipeRun =>
      ({ id, levelId: L, service: 'heating-flow', points: punkte, nominalDiameter: 15, insulation: 0, elevation: 0.1 }) as PipeRun;
    d.pipes['p1'] = run('p1', [{ x: 0, y: 0 }, { x: 2, y: 0 }]);
    d.pipes['p2'] = run('p2', [{ x: 0, y: 0 }, { x: 2, y: 0 }]); // deckungsgleich
    d.pipes['p3'] = run('p3', [{ x: 1, y: 1 }, { x: 1, y: 1 }]); // ohne Länge
    d.pipes['p4'] = run('p4', [{ x: 0, y: 2 }, { x: 3, y: 2 }]); // eigenständig
    d.pipeAccessories!['v1'] = { id: 'v1', kind: 'ball-valve', levelId: L, position: { x: 1, y: 0 }, elevation: 0.1, runId: 'p2', label: 'KH' } as never;
    const p = planeKorrektur(d);
    check('K · zwei Leitungsfunde (eine doppelt, eine ohne Länge)', p.leitungen.length, 2);
    const b = wendeKorrekturAn(d, { ...NICHTS, leitungen: true }, neueId);
    check('K · zwei Leitungen entfernt', b.leitungenEntfernt, 2);
    check('K · die eigenständige Leitung bleibt', !!d.pipes['p4'], true);
    check('K · die Armatur der doppelten wandert auf die bleibende', d.pipeAccessories!['v1']?.runId ?? '', 'p1');
    const g = wendeKorrekturAn(d, { ...NICHTS, leitungen: true }, neueId);
    check('K · Gegenprobe: zweiter Lauf entfernt nichts', g.leitungenEntfernt, 0);
  }

  // ======================================================= L · kleine Räume
  {
    const r = (id: string, area: number, isHeated: boolean): Room =>
      ({ id, levelId: L, name: id, area, isHeated, centroid: { x: 0, y: 0 } }) as Room;
    const klein = kleineRaeume([r('a', 0.8, true), r('b', 0.8, false), r('c', 1.0, true), r('d', 5, true)]);
    check('L · nur der beheizte Raum unter 1 m²', klein.map((x) => x.id).join(','), 'a');
  }

  // ================================================= M · Bericht in Worten
  {
    const satz = berichtSatz({
      zusammengefuehrt: 1, angeschlossen: 2, stummelEntfernt: 0, ueberstaendeEntfernt: 0, doppelwaendeEntfernt: 0,
      lueckenGeschlossen: 1, oeffnungenGesetzt: 1, lueckenEntfallen: 0, begradigt: 0, groessterVersatz: 0,
      leitungenEntfernt: 0, kleineRaeume: [], maxBewegung: 0.023,
    });
    check(
      'M · Satz',
      satz,
      '1 Wandecke zusammengeführt · 2 Wandenden angeschlossen · 1 Lücke geschlossen, davon 1 mit Öffnung. Größte Bewegung eines Wandpunkts: 2,3 cm.',
    );
    check('M · Toleranz 5 cm, wie die Raumerkennung', ANSCHLUSS_TOLERANZ, 0.05);
  }

  // =========================================== N · echte Aufnahmen
  const basis = wurzel();
  check('N · Referenzordner gefunden', basis !== undefined, true);
  if (!basis) return;

  const echt = (name: string, d: KorrekturDokument): void => {
    const vorher = raeume(d);
    const plan = planeKorrektur(d);
    const b = wendeKorrekturAn(d, ALLES, neueId);
    const nachher = raeume(d);
    console.log(`    ${name}: ${plan.summe} Vorschläge · ${berichtSatz(b)} · Räume ${vorher.anzahl} → ${nachher.anzahl}`);
    check(`N · ${name}: kein Raum geht verloren`, nachher.anzahl >= vorher.anzahl, true);
    check(`N · ${name}: Fläche ändert sich um weniger als 2 %`, Math.abs(nachher.flaeche - vorher.flaeche) / Math.max(vorher.flaeche, 1) < 0.02, true);
    check(`N · ${name}: kein Wandpunkt wandert weiter als 30 cm`, b.maxBewegung <= 0.3, true);
    const zweiter = planeKorrektur(d);
    check(`N · ${name}: danach keine Anschlüsse, Stummel oder doppelten Wände mehr`, zweiter.anschluesse.length + zweiter.stummel.length + zweiter.doppelwaende.length, 0);
    const drin = Object.values(d.openings).every((o) => {
      const w = d.walls[o.wallId];
      if (!w) return false;
      const l = Math.hypot(d.nodes[w.b].x - d.nodes[w.a].x, d.nodes[w.b].y - d.nodes[w.a].y);
      return o.distance - o.width / 2 >= -0.01 && o.distance + o.width / 2 <= l + 0.01;
    });
    check(`N · ${name}: jede Öffnung hängt an einer Wand und liegt in ihr`, drin, true);
  };

  {
    const scan = importRaumplan(readFileSync(join(basis, 'scripts', 'referenz', 'raumscan-beispiel.json'), 'utf-8'));
    const d = dok();
    d.levels = Object.fromEntries(scan.levels.map((l) => [l.id, l as unknown as Level]));
    d.nodes = Object.fromEntries(scan.nodes.map((n) => [n.id, n]));
    d.walls = Object.fromEntries(scan.walls.map((w) => [w.id, w]));
    d.openings = Object.fromEntries(scan.openings.map((o) => [o.id, o]));
    echt('RoomPlan-Scan', d);
  }
  {
    const roh = JSON.parse(readFileSync(join(basis, 'scripts', 'referenz', 'scan-wohnung-2026-10-02.building-1.12.0.json'), 'utf-8'));
    const e = importBuildingModel(roh);
    check('N · Feldscan eingelesen', e.ok, true);
    const d = dok();
    d.levels = Object.fromEntries(e.levels.map((l) => [l.id, l as Level]));
    d.nodes = Object.fromEntries(e.nodes.map((n) => [n.id, n]));
    d.walls = Object.fromEntries(e.walls.map((w) => [w.id, w]));
    d.openings = Object.fromEntries(e.openings.map((o) => [o.id, o]));
    echt('Feldscan 02.10.2026', d);
  }
}
