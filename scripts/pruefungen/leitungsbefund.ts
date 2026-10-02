/**
 * Prüfblock: Leitungen ohne Länge und doppelt gesetzte Leitungen (1.70.0).
 * ---------------------------------------------------------------------------
 *
 * Bis 1.69.0 verwarf der Massenauszug eine Leitung ohne Länge still und
 * zählte eine doppelt gesetzte still zweimal — Handbuch 18.5.1 führte das
 * als bekannten, offenen Mangel. Dieser Block hält fest, dass beide jetzt
 * gemeldet werden, und vor allem, dass dabei **nichts zu viel** gemeldet
 * wird: Eine Doppelerkennung, die Vor- und Rücklauf oder Saug- und
 * Flüssigkeitsleitung für ein Doppel hält, verleitet zum Löschen eines
 * echten Rohrs.
 *
 * **Die Sollwerte, von Hand am Referenzhaus (`scripts/reference.ts`).**
 * EG und OG tragen je zwei Vorlaufzüge DN 16, gedämmt 9 mm, auf 0,10 m:
 *
 *     p1: (0,6|0,6) → (3,0|0,6) → (3,0|0,4)    2,40 + 0,20 = 2,60 m
 *     p2: (0,6|0,6) → (8,0|0,6) → (8,0|0,4)    7,40 + 0,20 = 7,60 m
 *
 *     je Geschoss 10,20 m, zusammen 20,40 m Heizung Vorlauf DN 16.
 *
 * Zwei eingebaute Gegenproben stecken schon darin: p1 und p2 beginnen am
 * selben Verteilerpunkt und laufen 2,40 m gemeinsam (gemeinsamer Anfang ist
 * kein Doppel), und `eg-p1` liegt in derselben Grundrisslage wie `og-p1`
 * (anderes Geschoss ist kein Doppel). Das unveränderte Referenzhaus muss
 * deshalb **null** Befunde liefern.
 */

import type { CheckFn } from './typ';
import type { BimDocument, PipeRun } from '../../src/types/bim';
import { PIPE_SERVICE_LABELS } from '../../src/types/bim';
import { buildPipeNetwork } from '../../src/lib/pipeNetwork';
import { buildMaterialSchedule, type MaterialSchedule } from '../../src/lib/materialSchedule';
import { validateModel, REMEDIES } from '../../src/lib/validation';
import { doppelteLeitungen, nullLeitungen } from '../../src/lib/leitungsbefund';
import { rohrlaenge } from '../../src/lib/rohrlaenge';
import { buildReferenceDocument } from '../reference';

/**
 * Die Rohrmeter des Auszugs — nur die Rohrpositionen selbst. Im Gewerk
 * „Rohr" steht auch die Dämmung in Metern, und zwar mit derselben Menge;
 * beides zu summieren ergäbe das Doppelte. (Der erste Lauf dieses Blocks
 * hat genau das getan: 40,80 statt 20,40 m — ein Fehler im Prüfblock, nicht
 * im Programm.)
 */
const ROHRARTEN = new Set<string>(Object.values(PIPE_SERVICE_LABELS));
const rohrMeter = (auszug: MaterialSchedule): number =>
  auszug.items
    .filter((i) => i.trade === 'rohr' && i.unit === 'm' && ROHRARTEN.has(i.name))
    .reduce((s, i) => s + i.quantity, 0);

const notiz = (auszug: MaterialSchedule, teil: string) => auszug.notes.filter((n) => n.text.includes(teil));

const befunde = (doc: BimDocument, code: string) => validateModel(doc).issues.filter((i) => i.code === code);

/** Eine Kopie von `eg-p1` mit neuer Kennung und Änderungen. */
const kopie = (doc: BimDocument, id: string, aenderung: Partial<PipeRun> = {}): PipeRun => ({
  ...structuredClone(doc.pipes['eg-p1']),
  id,
  ...aenderung,
});

export function pruefeLeitungsbefund(check: CheckFn): void {
  // -------------------------------------------------------------------------
  // 0 · Ausgangslage: das Referenzhaus ist sauber
  // -------------------------------------------------------------------------
  {
    const doc = buildReferenceDocument();
    const runs = Object.values(doc.pipes);
    check('Leitungsbefund · Referenzhaus: vier Leitungen', runs.length, 4);
    check('Leitungsbefund · Referenzhaus: keine Leitung ohne Länge', nullLeitungen(runs).length, 0);
    // Gemeinsamer Anfang (p1/p2) und gleiche Lage in zwei Geschossen
    // (eg-p1/og-p1) — beides kein Doppel.
    check('Leitungsbefund · Referenzhaus: kein Doppel trotz gemeinsamem Anfang und gleicher Lage im OG', doppelteLeitungen(runs).length, 0);
    const auszug = buildMaterialSchedule(doc);
    check('Leitungsbefund · Referenzhaus: Rohrmenge 2 × (2,60 + 7,60) = 20,40 m', rohrMeter(auszug), 20.4, 1e-9);
    check('Leitungsbefund · Referenzhaus: keine Bemerkung „keine Länge"', notiz(auszug, 'keine Länge').length, 0);
    check('Leitungsbefund · Referenzhaus: keine Bemerkung „deckungsgleich"', notiz(auszug, 'deckungsgleich').length, 0);
    check('Leitungsbefund · Referenzhaus: kein Befund pipes.zero-length', befunde(doc, 'pipes.zero-length').length, 0);
    check('Leitungsbefund · Referenzhaus: kein Befund pipes.duplicate', befunde(doc, 'pipes.duplicate').length, 0);
  }

  // -------------------------------------------------------------------------
  // 1 · Leitung ohne Länge — gemeldet statt still verworfen
  // -------------------------------------------------------------------------
  {
    const doc = buildReferenceDocument();
    // Ein Doppelklick bei (2|2): Anfangs- und Endpunkt fallen zusammen.
    doc.pipes['eg-null'] = kopie(doc, 'eg-null', { points: [{ x: 2, y: 2 }, { x: 2, y: 2 }] });
    const leer = nullLeitungen(Object.values(doc.pipes));
    check('Nullleitung · eine gefunden', leer.length, 1);
    check('Nullleitung · es ist eg-null', leer[0]?.id ?? '', 'eg-null');
    check('Nullleitung · Grund „null", nicht „ungueltig"', leer[0]?.grund ?? '', 'null');

    const auszug = buildMaterialSchedule(doc);
    // Die Menge ändert sich nicht — verworfen wird sie weiterhin.
    check('Nullleitung · Rohrmenge bleibt 20,40 m', rohrMeter(auszug), 20.4, 1e-9);
    const n = notiz(auszug, 'keine Länge');
    check('Nullleitung · genau eine Bemerkung', n.length, 1);
    check('Nullleitung · Bemerkung ist Warnung', n[0]?.severity ?? '', 'warn');
    check('Nullleitung · Bemerkung nennt Zahl und Geschoss', n[0]?.text.startsWith('1 Leitungsabschnitt hat keine Länge und steht nicht in der Liste (EG: 1).') ?? false, true);
    check('Nullleitung · Bemerkung nennt den Doppelklick als üblichen Grund', n[0]?.text.includes('Doppelklick') ?? false, true);

    const b = befunde(doc, 'pipes.zero-length');
    check('Nullleitung · ein Befund pipes.zero-length', b.length, 1);
    check('Nullleitung · Befund ist Warnung', b[0]?.severity ?? '', 'warning');
    check('Nullleitung · Befund springt auf die Leitung', `${b[0]?.target?.kind}:${b[0]?.target?.id}`, 'pipe:eg-null');
    check('Nullleitung · Befund nennt Art und Geschoss', b[0]?.message ?? '', 'Leitung „Heizung Vorlauf" (EG) hat keine Länge und fehlt im Massenauszug.');
    check('Nullleitung · Befund hat eine Ortsangabe (2|2)', `${b[0]?.position?.x}|${b[0]?.position?.y}`, '2|2');
    check('Nullleitung · Befund hat eine Abhilfe', (REMEDIES['pipes.zero-length'] ?? '').length > 40, true);
  }

  // -------------------------------------------------------------------------
  // 2 · Gegenprobe: der Steigstrang hat im Grundriss die Länge null — und ist trotzdem eine Leitung
  // -------------------------------------------------------------------------
  {
    const doc = buildReferenceDocument();
    // Fallstrang in der Zimmerecke, 0,10 m → 2,50 m: Trasse 0, wahre Länge 2,40 m.
    // Genau der Fall, der bis 1.23.0 aus der Bestellung fiel.
    doc.pipes['eg-steig'] = kopie(doc, 'eg-steig', {
      points: [{ x: 2, y: 2 }, { x: 2, y: 2 }],
      elevation: 0.1,
      elevationTo: 2.5,
    });
    check('Steigstrang · keine Nullleitung', nullLeitungen(Object.values(doc.pipes)).length, 0);
    check('Steigstrang · kein Befund pipes.zero-length', befunde(doc, 'pipes.zero-length').length, 0);
    check('Steigstrang · Rohrmenge 20,40 + 2,40 = 22,80 m', rohrMeter(buildMaterialSchedule(doc)), 22.8, 1e-9);
  }

  // -------------------------------------------------------------------------
  // 3 · Ungültige Koordinaten und Einpunktleitung
  // -------------------------------------------------------------------------
  {
    const doc = buildReferenceDocument();
    doc.pipes['og-nan'] = kopie(doc, 'og-nan', { levelId: 'og', points: [{ x: Number.NaN, y: 1 }, { x: 3, y: 1 }] });
    doc.pipes['eg-ein'] = kopie(doc, 'eg-ein', { points: [{ x: 4, y: 4 }] });
    const leer = nullLeitungen(Object.values(doc.pipes));
    check('Ungültig · zwei Leitungen ohne Länge', leer.length, 2);
    check('Ungültig · NaN-Koordinate heißt „ungueltig"', leer.find((l) => l.id === 'og-nan')?.grund ?? '', 'ungueltig');
    check('Ungültig · ein einzelner Punkt heißt „null"', leer.find((l) => l.id === 'eg-ein')?.grund ?? '', 'null');

    const auszug = buildMaterialSchedule(doc);
    // NaN darf die Summe nicht vergiften — sonst stünde „NaN m" in der Bestellung.
    check('Ungültig · Rohrmenge bleibt 20,40 m', rohrMeter(auszug), 20.4, 1e-9);
    const n = notiz(auszug, 'keine Länge');
    check('Ungültig · eine Bemerkung für beide', n.length, 1);
    // Gezählt wird in der Reihenfolge des Auftretens, und og-nan wurde vor
    // eg-ein eingefügt — die Bemerkung zählt also „OG: 1, EG: 1".
    check('Ungültig · Bemerkung zählt je Geschoss', n[0]?.text.includes('(OG: 1, EG: 1)') ?? false, true);
    check('Ungültig · Bemerkung sagt „1 davon hat ungültige Koordinaten"', n[0]?.text.includes('1 davon hat ungültige Koordinaten') ?? false, true);
    check('Ungültig · Bemerkung nennt das Einlesen als Ursache', n[0]?.text.includes('Einlesen') ?? false, true);
    const b = befunde(doc, 'pipes.zero-length');
    check('Ungültig · zwei Befunde', b.length, 2);
    const nan = b.find((i) => i.target?.id === 'og-nan');
    check('Ungültig · Befund nennt ungültige Koordinaten', nan?.message ?? '', 'Leitung „Heizung Vorlauf" (OG) hat ungültige Koordinaten oder Höhen und fehlt im Massenauszug.');
    // Bis 1.69.0 kam validateModel hier nie zurück: eine NaN-Teilstrecke im
    // Rohrnetz ließ den Dijkstra endlos pendeln. Dass diese Zeilen überhaupt
    // erreicht werden, ist die Prüfung; das Rohrnetz noch einmal ausdrücklich:
    const netz = buildPipeNetwork(doc);
    check('Ungültig · Rohrnetz läuft durch und kennt den Verteiler als Quelle', netz.sources.length > 0, true);
    // Der erste Punkt ist (NaN|1) — ein Sprung dorthin ginge ins Leere.
    check('Ungültig · keine Ortsangabe bei NaN-Punkt', nan?.position === undefined, true);
  }

  // -------------------------------------------------------------------------
  // 4 · Doppelt gesetzte Leitung — gemeldet, in der Menge belassen
  // -------------------------------------------------------------------------
  {
    const doc = buildReferenceDocument();
    doc.pipes['eg-p1-doppel'] = kopie(doc, 'eg-p1-doppel');
    const d = doppelteLeitungen(Object.values(doc.pipes));
    check('Doppel · eines gefunden', d.length, 1);
    check('Doppel · Bezug ist das Original', d[0]?.id ?? '', 'eg-p1');
    check('Doppel · überzählig ist die Kopie', d[0]?.doppelId ?? '', 'eg-p1-doppel');
    check('Doppel · Länge 2,60 m', d[0]?.laenge ?? 0, 2.6, 1e-9);

    const auszug = buildMaterialSchedule(doc);
    // Die Kopie bleibt drin: 20,40 + 2,60 = 23,00 m.
    check('Doppel · Rohrmenge 23,00 m (nicht herausgerechnet)', rohrMeter(auszug), 23.0, 1e-9);
    const n = notiz(auszug, 'deckungsgleich');
    check('Doppel · eine Bemerkung', n.length, 1);
    check('Doppel · Bemerkung nennt 2,60 m zu viel', n[0]?.text.includes('um 2,60 m zu hoch') ?? false, true);
    check('Doppel · Bemerkung nennt das Geschoss', n[0]?.text.includes('(EG: 1)') ?? false, true);
    const b = befunde(doc, 'pipes.duplicate');
    check('Doppel · ein Befund pipes.duplicate', b.length, 1);
    check('Doppel · Befund springt auf die Kopie', `${b[0]?.target?.kind}:${b[0]?.target?.id}`, 'pipe:eg-p1-doppel');
    check('Doppel · Befund im Wortlaut', b[0]?.message ?? '', 'Leitung „Heizung Vorlauf" DN 16 (EG) liegt deckungsgleich auf einer zweiten — im Massenauszug stehen 2,60 m Rohr doppelt.');
    check('Doppel · Befund hat eine Abhilfe', (REMEDIES['pipes.duplicate'] ?? '').length > 40, true);
  }

  // -------------------------------------------------------------------------
  // 5 · Was ein Doppel ist und was nicht — eine Zeile je Grenzfall
  // -------------------------------------------------------------------------
  const doppelMit = (aenderung: Partial<PipeRun>): number => {
    const doc = buildReferenceDocument();
    doc.pipes['x'] = kopie(doc, 'x', aenderung);
    return doppelteLeitungen(Object.values(doc.pipes)).length;
  };
  const p1 = buildReferenceDocument().pipes['eg-p1'];
  check('Grenzfall · Gegenrichtung ist ein Doppel', doppelMit({ points: [...p1.points].reverse() }), 1);
  check('Grenzfall · 0,5 mm daneben ist ein Doppel (Toleranz 1 mm)', doppelMit({ points: p1.points.map((p) => ({ x: p.x + 0.0005, y: p.y })) }), 1);
  // 50 mm ist der Paarabstand der Doppelleitung — zwei Rohre, nebeneinander.
  check('Grenzfall · 50 mm daneben (Doppelleitung) ist keins', doppelMit({ points: p1.points.map((p) => ({ x: p.x, y: p.y + 0.05 })) }), 0);
  check('Grenzfall · 2 mm daneben ist keins', doppelMit({ points: p1.points.map((p) => ({ x: p.x + 0.002, y: p.y })) }), 0);
  // Vor- und Rücklauf in derselben Trasse ohne Versatz gezeichnet: zwei Rohre.
  check('Grenzfall · Rücklauf auf dem Vorlauf ist keins', doppelMit({ service: 'heating-return' }), 0);
  // Saug- und Flüssigkeitsleitung: gleiche Art, anderer Durchmesser.
  check('Grenzfall · andere Nennweite ist keins', doppelMit({ nominalDiameter: 20 }), 0);
  check('Grenzfall · anderer Werkstoff ist keins', doppelMit({ material: 'kupfer' }), 0);
  check('Grenzfall · 0,30 m statt 0,10 m Höhe ist keins', doppelMit({ elevation: 0.3 }), 0);
  check('Grenzfall · 5 mm Höhenunterschied ist ein Doppel (Toleranz 1 cm)', doppelMit({ elevation: 0.105 }), 1);
  check('Grenzfall · mit Steigung am Ende ist keins', doppelMit({ elevationTo: 1.0 }), 0);
  check('Grenzfall · ein Stützpunkt mehr ist keins', doppelMit({ points: [p1.points[0], { x: 1.8, y: 0.6 }, p1.points[1], p1.points[2]] }), 0);
  // Dieselbe Lage ins OG kopiert: Dort liegt schon og-p1 — also ein Doppel,
  // aber zu og-p1 und nicht zu eg-p1, das genauso liegt.
  {
    const doc = buildReferenceDocument();
    doc.pipes['x'] = kopie(doc, 'x', { levelId: 'og' });
    const d = doppelteLeitungen(Object.values(doc.pipes));
    check('Grenzfall · gleiche Lage im OG: ein Doppel', d.length, 1);
    check('Grenzfall · … und zwar zu og-p1, nicht zu eg-p1', d[0]?.id ?? '', 'og-p1');
  }

  // Gegenrichtung mit Steigung: Die Höhen tauschen die Rollen.
  {
    const doc = buildReferenceDocument();
    doc.pipes['a'] = kopie(doc, 'a', { elevation: 0.1, elevationTo: 1.0 });
    doc.pipes['b'] = kopie(doc, 'b', { points: [...p1.points].reverse(), elevation: 1.0, elevationTo: 0.1 });
    doc.pipes['c'] = kopie(doc, 'c', { points: [...p1.points].reverse(), elevation: 0.1, elevationTo: 1.0 });
    const d = doppelteLeitungen(Object.values(doc.pipes));
    // a und b sind derselbe geneigte Strich; c steigt in die andere Richtung.
    check('Grenzfall · Gegenrichtung mit getauschten Höhen ist ein Doppel', d.filter((x) => x.id === 'a' && x.doppelId === 'b').length, 1);
    check('Grenzfall · Gegenrichtung mit gleicher Steigrichtung ist keins', d.some((x) => x.doppelId === 'c'), false);
  }

  // -------------------------------------------------------------------------
  // 6 · Dreimal derselbe Strich, und zwei Nullleitungen am selben Punkt
  // -------------------------------------------------------------------------
  {
    const doc = buildReferenceDocument();
    doc.pipes['k1'] = kopie(doc, 'k1');
    doc.pipes['k2'] = kopie(doc, 'k2');
    const d = doppelteLeitungen(Object.values(doc.pipes));
    // Drei Striche, zwei zu viel — beide gegen das Original, nicht k2 gegen k1.
    check('Dreifach · zwei Befunde', d.length, 2);
    check('Dreifach · beide gegen eg-p1', d.every((x) => x.id === 'eg-p1'), true);
    check('Dreifach · 2 × 2,60 = 5,20 m zu viel', d.reduce((s, x) => s + x.laenge, 0), 5.2, 1e-9);
    check('Dreifach · Bemerkung nennt 5,20 m', notiz(buildMaterialSchedule(doc), 'um 5,20 m zu hoch').length, 1);
  }
  {
    const doc = buildReferenceDocument();
    doc.pipes['n1'] = kopie(doc, 'n1', { points: [{ x: 5, y: 5 }, { x: 5, y: 5 }] });
    doc.pipes['n2'] = kopie(doc, 'n2', { points: [{ x: 5, y: 5 }, { x: 5, y: 5 }] });
    // Zwei Nullleitungen übereinander sind ein Fehler, nicht zwei verschiedene.
    check('Null übereinander · zwei Nullleitungen', nullLeitungen(Object.values(doc.pipes)).length, 2);
    check('Null übereinander · nicht zusätzlich als Doppel', doppelteLeitungen(Object.values(doc.pipes)).length, 0);
    check('Null übereinander · Bemerkung in der Mehrzahl', notiz(buildMaterialSchedule(doc), '2 Leitungsabschnitte haben keine Länge und stehen nicht in der Liste (EG: 2).').length, 1);
  }

  // -------------------------------------------------------------------------
  // 7 · Auswahl und Meldung können nicht auseinanderlaufen
  // -------------------------------------------------------------------------
  // Was der Massenauszug zählt, muss genau die Summe der Leitungen sein, die
  // `nullLeitungen` nicht nennt. Ändert jemand die Verwerfungszeile in
  // `pipeRows`, ohne `nullLeitungen` mitzuziehen, fällt es hier auf.
  {
    const doc = buildReferenceDocument();
    doc.pipes['a'] = kopie(doc, 'a', { points: [{ x: 1, y: 1 }, { x: 1, y: 1 }] });
    doc.pipes['b'] = kopie(doc, 'b', { points: [{ x: 1, y: 1 }, { x: 1.04, y: 1 }] }); // 4 cm — kurz, aber da
    doc.pipes['c'] = kopie(doc, 'c', { points: [{ x: 1, y: 1 }, { x: 1, y: 1 }], elevation: 0.1, elevationTo: 0.1 });
    doc.pipes['d'] = kopie(doc, 'd', { points: [{ x: 1, y: Number.POSITIVE_INFINITY }, { x: 2, y: 1 }] });
    const runs = Object.values(doc.pipes);
    const verworfen = new Set(nullLeitungen(runs).map((l) => l.id));
    check('Gleichlauf · verworfen werden a, c und d', [...verworfen].sort().join(','), 'a,c,d');
    const soll = runs.filter((r) => !verworfen.has(r.id)).reduce((s, r) => s + rohrlaenge(r), 0);
    // 20,40 m Referenz + 0,04 m von b. (Der Massenauszug rundet auf
    // Zentimeter — deshalb 4 cm und nicht weniger, sonst prüfte diese Zeile
    // die Rundung und nicht die Auswahl.)
    check('Gleichlauf · Sollsumme 20,44 m von Hand', soll, 20.44, 1e-9);
    check('Gleichlauf · Massenauszug zählt genau die nicht verworfenen', rohrMeter(buildMaterialSchedule(doc)), soll, 1e-9);
  }
}
