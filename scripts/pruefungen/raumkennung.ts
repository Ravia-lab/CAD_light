/**
 * Prüfblock „Raumkennung" — der Rückweg findet den Raum wieder.
 *
 * **Der Fehler, der diesen Block nötig gemacht hat.** Im Protokoll vom
 * 27.09.2026 standen zwölf Zeilen dieser Art:
 *
 *     abgelehnt – Raum: Kein Raum mit der Kennung „room-rp-level-0-8".
 *
 * Der Raum stand dabei sichtbar auf dem Bildschirm. Die Ursache ist eine
 * Eigenschaft der Raumerkennung, die dieses Programm von Anfang an hat und
 * bewusst behält: **Räume werden nicht gespeichert, sie werden erkannt.** Aus
 * den Wänden entsteht bei jedem Öffnen einer Projektdatei ein frischer Satz
 * Räume, und ihre Kennung entsteht dabei aus der Erkennungsreihenfolge. Die
 * gespeicherten *Angaben* finden über die Geometrie zurück
 * (`raumZuordnung.ts`); die Kennung tut das nicht, weil sie keine Geometrie
 * hat, an der sie sich festhalten könnte.
 *
 * Für den Bildschirm ist das gleichgültig. Für die Gegenstelle nicht: RaVia
 * hat die Kennung aus dem Export, rechnet unter ihr die Heizlast und schreibt
 * sie unter ihr zurück. Trifft sie ins Leere, ist die Heizlast weg — und die
 * Meldung darüber liest sich wie ein Fehler der Gegenstelle.
 *
 * **Die Lösung, die hier festgehalten wird**, hat drei Teile:
 *
 *  1. Der Raum merkt sich die Kennung, unter der er schon einmal übergeben
 *     worden ist (`Room.altKennungen`). Umbenannt wird nichts — die
 *     Raumkennung hängt an Heizkörpern, Dächern, Schächten, Speichern und
 *     Heizkreisen, und eine Umbenennung, die einen dieser Verweise vergisst,
 *     wäre stiller als der Fehler, den sie behebt.
 *  2. Der Rückweg (`applyHostPatch`) sucht in drei Stufen: laufende Kennung,
 *     Kennung in RaVia, frühere Kennung. Eine **laufende** gewinnt dabei
 *     immer — wenn ein anderer Raum heute unter „room-eg-0" geführt wird, ist
 *     das der Raum, den dieser Name jetzt bezeichnet.
 *  3. Der Export trägt die früheren Kennungen mit (`formerIds`, seit 2.5.0),
 *     damit die Zuordnung auch das zweite und dritte Öffnen überlebt.
 *
 * Alle Sollwerte sind unten hergeleitet; keiner stammt aus einem Probelauf.
 */

import type { CheckFn } from './typ';
import type { BimDocument, Room } from '../../src/types/bim';
import { applyHostPatch, type HostPatchReport } from '../../src/lib/hostPatch';
import { buildReferenceDocument } from '../reference';
import { buildRaviaExport } from '../../src/lib/raviaExport';

const ABSENDER = 'RaVia Prüflauf';
const JETZT = '2026-09-27T08:00:00.000Z';

/** Urteil zu einem Pfad — „kein Eintrag" als dritter Zustand. */
function urteil(ergebnis: { report: HostPatchReport }, pfad: string): string {
  return ergebnis.report.entries.find((e) => e.path === pfad)?.verdict ?? 'kein Eintrag';
}

/** Begründung zu einem Pfad. */
function grund(ergebnis: { report: HostPatchReport }, pfad: string): string {
  const e = ergebnis.report.entries.find((x) => x.path === pfad);
  return e === undefined ? 'kein Eintrag' : (e.reason ?? 'ohne Begründung');
}

/** Ein Dokument, in dem ein Raum eine frühere Kennung trägt. */
function mitAltkennung(doc: BimDocument, raumId: string, alt: string): BimDocument {
  const raum = doc.rooms[raumId];
  if (!raum) throw new Error(`Raum ${raumId} fehlt im Prüfhaus`);
  return { ...doc, rooms: { ...doc.rooms, [raumId]: { ...raum, altKennungen: [alt] } } };
}

export function pruefeRaumkennungen(check: CheckFn): void {
  const haus = buildReferenceDocument();
  const raeume = Object.values(haus.rooms).sort((a, b) => (a.id < b.id ? -1 : 1));
  check('Raumkennung · das Prüfhaus hat sechs Räume', raeume.length, 6);

  const wohnen = raeume.find((r) => r.name === 'Wohnen EG');
  const bad = raeume.find((r) => r.name === 'Bad EG');
  check('Raumkennung · „Wohnen EG" ist da', wohnen?.id ?? 'fehlt', 'room-eg-0');
  check('Raumkennung · „Bad EG" ist da', bad?.id ?? 'fehlt', 'room-eg-1');

  // =========================================================================
  // 1 · Ohne frühere Kennung läuft der Rückweg ins Leere — mit Auskunft
  // =========================================================================
  {
    const ohne = applyHostPatch(
      haus,
      { source: ABSENDER, rooms: [{ id: 'room-lvl-kg-1', setpointTemperature: 21 }] },
      JETZT,
    );
    check('Raumkennung · eine fremde Kennung wird abgelehnt', urteil(ohne, 'rooms.room-lvl-kg-1'), 'abgelehnt');

    /*
     * **Und die Ablehnung sagt, woran es liegt.** „Kein Raum mit der Kennung
     * X" ist wahr und nutzlos: Der Mensch sieht drüben seine Räume und hier
     * Räume, und die Meldung sagt ihm nicht, welche der beiden Listen
     * unvollständig ist. Deshalb steht jetzt dabei, was hier bekannt ist —
     * sechs Räume in drei Geschossen, und zwar zwei je Geschoss.
     */
    const text = grund(ohne, 'rooms.room-lvl-kg-1');
    check('Raumkennung · die Ablehnung nennt die Zahl der Räume', text.includes('6 Räume'), true);
    check('Raumkennung · und die Geschosse', text.includes('3 Geschossen'), true);
    check('Raumkennung · und die Räume je Geschoss', text.includes('KG 2, EG 2, OG 2'), true);
    /*
     * Das Geschoss `lvl-kg` gibt es im Prüfhaus nicht — die Geschosse heißen
     * `kg`, `eg`, `og`. Die Meldung muss deshalb auf „aus einem anderen
     * Modell" lauten und nicht auf „neu erkannt".
     */
    check('Raumkennung · und sie erkennt das fremde Modell', text.includes('anderen'), true);
  }

  // =========================================================================
  // 2 · Mit früherer Kennung landet derselbe Wert am richtigen Raum
  // =========================================================================
  {
    /*
     * Dasselbe Bild wie in der Meldung: RaVia kennt den Raum als
     * `room-eg-7`, hier heißt er inzwischen `room-eg-0`. Der Wert muss
     * ankommen — und zwar an „Wohnen EG" und an keinem anderen.
     *
     * Die Solltemperatur des Prüfhauses steht bei 20 °C (Aufenthaltsraum
     * nach DIN EN 12831 Tab. B.2); geschrieben werden 21 °C, damit die
     * Übernahme sich vom Ausgangswert unterscheidet.
     */
    const doc = mitAltkennung(haus, 'room-eg-0', 'room-eg-7');
    check('Raumkennung · Ausgangswert der Solltemperatur [°C]', doc.rooms['room-eg-0']!.setpointTemperature, 20);

    const ergebnis = applyHostPatch(
      doc,
      { source: ABSENDER, rooms: [{ id: 'room-eg-7', setpointTemperature: 21 }] },
      JETZT,
    );
    check('Raumkennung · über die frühere Kennung übernommen', urteil(ergebnis, 'rooms.room-eg-7.setpointTemperature'), 'übernommen');
    check('Raumkennung · der Wert steht am richtigen Raum [°C]', ergebnis.doc.rooms['room-eg-0']!.setpointTemperature, 21);

    /*
     * **Und nirgendwo sonst.** Abgelegt wird unter der laufenden Kennung;
     * stünde der Raum danach zusätzlich unter `room-eg-7` im Dokument, hätte
     * der Rückweg einen zweiten, unsichtbaren Raum angelegt — einen, den
     * keine Wand begrenzt und den die nächste Raumerkennung wortlos
     * wegräumt, samt der Heizlast darin.
     */
    check('Raumkennung · kein Raum unter der alten Kennung angelegt', ergebnis.doc.rooms['room-eg-7'] === undefined, true);
    check('Raumkennung · die Zahl der Räume bleibt', Object.keys(ergebnis.doc.rooms).length, 6);
    check('Raumkennung · der Nachbarraum bleibt unberührt [°C]', ergebnis.doc.rooms['room-eg-1']!.setpointTemperature, 24);
  }

  // =========================================================================
  // 3 · Die laufende Kennung gewinnt gegen die frühere
  // =========================================================================
  {
    /*
     * Der gefährliche Fall: „Bad EG" trägt als *frühere* Kennung ausgerechnet
     * `room-eg-0` — und unter dieser Kennung läuft heute „Wohnen EG". Ein
     * Rückweg auf `room-eg-0` muss bei „Wohnen EG" landen. Gewänne die
     * frühere Kennung, bekäme das Bad die Heizlast des Wohnzimmers, und
     * beide Zahlen sähen plausibel aus.
     */
    const doc = mitAltkennung(haus, 'room-eg-1', 'room-eg-0');
    const ergebnis = applyHostPatch(
      doc,
      { source: ABSENDER, rooms: [{ id: 'room-eg-0', setpointTemperature: 22 }] },
      JETZT,
    );
    check('Raumkennung · der laufende Raum bekommt den Wert [°C]', ergebnis.doc.rooms['room-eg-0']!.setpointTemperature, 22);
    check('Raumkennung · das Bad bleibt, wie es war [°C]', ergebnis.doc.rooms['room-eg-1']!.setpointTemperature, 24);
  }

  // =========================================================================
  // 4 · Die Kennung in RaVia zählt ebenfalls
  // =========================================================================
  {
    /*
     * Kam der Raum aus einem Gebäudescan, hat der Monteur ihn drüben einem
     * bereits angelegten Raum zugeordnet; dessen Kennung steht in
     * `raviaRoomId`. Sie ist derselbe Fall: eine Kennung, unter der die
     * Gegenstelle diesen Raum führt.
     */
    const raum: Room = { ...haus.rooms['room-og-0']!, raviaRoomId: 'RV-4711' };
    const doc: BimDocument = { ...haus, rooms: { ...haus.rooms, 'room-og-0': raum } };
    const ergebnis = applyHostPatch(
      doc,
      { source: ABSENDER, rooms: [{ id: 'RV-4711', airChangeRate: 0.7 }] },
      JETZT,
    );
    check('Raumkennung · über die RaVia-Kennung übernommen', urteil(ergebnis, 'rooms.RV-4711.airChangeRate'), 'übernommen');
    check('Raumkennung · der Luftwechsel steht am Raum [1/h]', ergebnis.doc.rooms['room-og-0']!.airChangeRate, 0.7);
  }

  // =========================================================================
  // 5 · Der Export trägt die früheren Kennungen mit
  // =========================================================================
  {
    /*
     * Ohne frühere Kennung steht das Feld nicht in der Datei — ein leeres
     * `formerIds` an jedem Raum wäre Rauschen in einer Datei, die ohnehin
     * groß genug ist.
     */
    const schlicht = buildRaviaExport(haus);
    check('Raumkennung · ohne Vorgeschichte kein Feld', schlicht.rooms.every((r) => r.formerIds === undefined), true);

    /*
     * Mit Vorgeschichte steht sie da — und nur an dem einen Raum. Das ist
     * das, was die Zuordnung über das zweite und dritte Öffnen rettet: Beim
     * nächsten Laden liest der Store `formerIds` mit und hängt die Kennung
     * wieder an den Raum, den die Erkennung diesmal liefert.
     */
    const mit = buildRaviaExport(mitAltkennung(haus, 'room-eg-0', 'room-eg-7'));
    const traeger = mit.rooms.filter((r) => r.formerIds !== undefined);
    check('Raumkennung · genau ein Raum trägt eine frühere Kennung', traeger.length, 1);
    check('Raumkennung · und zwar dieser', traeger[0]?.id ?? 'fehlt', 'room-eg-0');
    check('Raumkennung · mit genau dieser Kennung', (traeger[0]?.formerIds ?? []).join(','), 'room-eg-7');

    /*
     * **Die Prüfsumme des Raums darf davon nicht anspringen.** Sie
     * beantwortet die Frage „ist meine gerechnete Heizlast noch gültig?", und
     * eine umbenannte Kennung macht keine Heizlast ungültig. Spränge sie an,
     * müsste RaVia nach jedem Öffnen alles neu rechnen — und zwar genau
     * wegen der Zeile, die das Gegenteil bewirken soll.
     */
    const vorher = schlicht.rooms.find((r) => r.id === 'room-eg-0')?.checksum ?? 'fehlt';
    const nachher = traeger[0]?.checksum ?? 'fehlt';
    check('Raumkennung · die Prüfsumme bleibt gleich', nachher, vorher);
  }
}
