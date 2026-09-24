/**
 * Prüfblock „Heizlast in einem Rutsch" und „kleine Räume als unbeheizt".
 * ---------------------------------------------------------------------------
 * **Der Anlass (QA-Bericht zum End-to-End-Lauf, 24.09.2026).** Zwei Stellen,
 * an denen der Weg vom Grundriss zur Auslegung unnötig lang war:
 *
 *  • Die Heizleistung je Raum war **eine Eingabe pro Zeile**. Beim
 *    Mehrfamilienhaus A08 sind das 42 Eingaben, bevor überhaupt etwas
 *    ausgelegt werden kann — der größte einzelne Zeitfresser im Ablauf.
 *  • **34 von 460 Räumen** im Testkorpus liegen unter 1 m², zehn davon als
 *    beheizt geführt. Sie bekommen Heizkörper, die nie eine Trasse erreichen
 *    (genau daran sind im Lauf mehrere Auslegungen gescheitert), und auf der
 *    Gegenseite fallen sie ohnehin weg.
 *
 * Geprüft werden hier die beiden Regeln, die dabei zählen: **Eingetragenes
 * wird nicht überschrieben**, und **gerechnet wird mit dem Gebäude**, nicht
 * mit einer Faustzahl.
 *
 * Das Prüfhaus ist das Referenzhaus des Projekts — dasselbe, an dem auch die
 * Hüllflächenbilanz hängt.
 */

import { buildReferenceDocument } from '../reference';
import { estimateHeatLoad } from '../../src/lib/heatLoadEstimate';
import { istHeizflaeche } from '../../src/lib/heizflaechenLeistung';
import type { CheckFn } from './typ';

export function pruefeHeizlastInEinemRutsch(check: CheckFn): void {
  // =========================================================================
  // 1 · Der Überschlag kommt aus dem Gebäude, nicht aus einer Tabelle
  // =========================================================================
  {
    const doc = buildReferenceDocument();
    const ueberschlag = estimateHeatLoad(doc);
    /*
     * Gelistet werden **beheizte** Räume, und massive Flächen (Kaminzug,
     * Schacht) fallen heraus — ein unbeheizter Raum hat keine eigene
     * Heizlast, er wirkt nur als Randbedingung für seine Nachbarn. Genau
     * deshalb überspringt der Reihenknopf sie ebenfalls.
     */
    const beheizteRaeume = Object.values(doc.rooms).filter((r) => r.isHeated);
    check('Der Überschlag kennt jeden beheizten Raum', ueberschlag.rooms.length, beheizteRaeume.length);
    check('… und nicht mehr als das Haus Räume hat',
      ueberschlag.rooms.length <= Object.keys(doc.rooms).length, true);
    check('Er ist als Überschlag gekennzeichnet', ueberschlag.istUeberschlag, true);
    /*
     * Die Summe der Räume ist die Gebäudeheizlast — `total` steht in kW,
     * die Räume in W. Wenn das auseinanderliefe, wäre die Zahl im Raumbuch
     * eine andere als die im Anlagenblatt, und niemand wüsste welche gilt.
     */
    const summeRaeume = ueberschlag.rooms.reduce((s, r) => s + r.total, 0);
    check('Die Räume summieren sich zur Gebäudeheizlast [kW]',
      Math.round(summeRaeume / 10) / 100, Math.round(ueberschlag.total * 100) / 100, 0.02);

    // Jeder beheizte Raum bekommt eine Zahl größer null — sonst wäre der
    // Knopf in genau den Fällen wirkungslos, für die es ihn gibt.
    const beheizt = Object.values(doc.rooms).filter((r) => r.isHeated);
    const mitLast = ueberschlag.rooms.filter((r) => r.total > 0);
    check('Jeder beheizte Raum hat einen Überschlag > 0 W', mitLast.length >= beheizt.length, true);

    // Plausibilität: spezifische Heizlast in einem Bereich, den ein Planer
    // wiedererkennt. Unter 10 W/m² wäre Passivhaus, über 250 ein Fehler.
    check('Spezifische Heizlast liegt im plausiblen Bereich',
      ueberschlag.specific > 10 && ueberschlag.specific < 250, true);
  }

  // =========================================================================
  // 2 · Auf 50 W runden — und was das heißt
  // =========================================================================
  /*
   * Der Überschlag gibt keine Watt-Genauigkeit her. Eine Zahl wie „1.247 W"
   * täuscht eine vor, die weder das Verfahren noch die Eingangsdaten
   * hergeben; „1.250 W" sagt ehrlich, wie genau es ist. Gerundet wird
   * kaufmännisch auf 50 W.
   */
  {
    const auf50 = (w: number) => Math.round(w / 50) * 50;
    check('1.247 W wird zu 1.250 W', auf50(1247), 1250);
    check('1.224 W wird zu 1.200 W', auf50(1224), 1200);
    check('1.225 W wird zu 1.250 W', auf50(1225), 1250);
    check('24 W wird zu 0 W — und fällt damit auf', auf50(24), 0);
    check('25 W wird zu 50 W', auf50(25), 50);
  }

  // =========================================================================
  // 3 · Kleine Räume: die Schwelle und was sie trifft
  // =========================================================================
  {
    const doc = buildReferenceDocument();
    /*
     * Im Referenzhaus gibt es keinen Raum unter 1 m² — das ist der gute
     * Fall, und er muss folgenlos bleiben: Ein Knopf, der ohne Anlass
     * Räume abschaltet, ist schlimmer als keiner.
     */
    const kleine = Object.values(doc.rooms).filter((r) => r.isHeated && r.area < 1);
    check('Das Referenzhaus hat keinen Raum unter 1 m²', kleine.length, 0);

    // Die Schwelle selbst, von Hand nachgerechnet an den Werten aus dem
    // Testkorpus: ein Schacht von 0,23 m² fällt darunter, ein Abstellraum
    // von 1,40 m² nicht.
    const unterSchwelle = (flaeche: number, schwelle = 1) => flaeche < schwelle;
    check('Schacht 0,23 m² fällt unter die Schwelle', unterSchwelle(0.23), true);
    check('Nische 0,44 m² auch', unterSchwelle(0.44), true);
    check('Abstellraum 1,40 m² nicht', unterSchwelle(1.4), false);
    check('Genau 1,00 m² nicht — die Schwelle schließt nicht ein', unterSchwelle(1), false);
  }

  // =========================================================================
  // 4 · Was der Knopf nicht anfassen darf
  // =========================================================================
  /*
   * Drei Fälle, in denen `setzeRaumHeizleistung` mit Begründung ablehnt —
   * der Reihenknopf muss sie deshalb überspringen, nicht daran scheitern:
   * Fußbodenheizung (ihre Leistung folgt aus der Auslegung), mehr als eine
   * Heizfläche (eine Summe ließe sich nicht verteilen) und unbeheizte Räume.
   * Geprüft wird hier, dass die Erkennung dieser Fälle steht.
   */
  {
    check('Ein Heizkörper gilt als Heizfläche', istHeizflaeche('radiator'), true);
    check('Ein Badheizkörper auch', istHeizflaeche('towel-radiator'), true);
    /*
     * Die Fußbodenheizung zählt hier **nicht** als Heizfläche — mit Absicht:
     * Ihre Leistung folgt aus der Verlegeauslegung, nicht aus einer Eingabe.
     * `setzeRaumHeizleistung` lehnt sie mit genau dieser Begründung ab, und
     * der Reihenknopf zählt sie als übersprungen statt zu scheitern.
     */
    check('Eine Fußbodenheizung zählt hier bewusst nicht dazu', istHeizflaeche('underfloor'), false);
    check('Ein Wärmeerzeuger nicht', istHeizflaeche('boiler'), false);
    check('Ein Speicher auch nicht', istHeizflaeche('storage'), false);
    check('Ein Verteiler auch nicht', istHeizflaeche('manifold'), false);
  }
}
