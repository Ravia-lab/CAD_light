/**
 * Prüfblock „Rohrnetzbericht — die Blätter".
 *
 * **Warum es diesen Block gibt.** Der Rohrnetzbericht hatte bis 1.57.0 genau
 * einen Grundriss, und zwar den des *aktiven* Geschosses. In einem Haus mit
 * einem Geschoss fällt das nicht auf. In einem Haus mit Keller ist es der
 * Bericht über eine Anlage, von der man zwei Drittel nicht sieht — und der
 * Schlechtpunkt, um den es auf dem Blatt geht, liegt regelmäßig in dem
 * Geschoss, das fehlt. Gemeldet am 27.09.2026: „das zeigt nur 1 Etage".
 *
 * Zwei Dinge werden hier festgehalten:
 *
 *  1. **Jedes Geschoss mit Wänden bekommt sein Blatt**, von unten nach oben,
 *     jedes mit seinem Namen darauf und alle im selben Maßstab. Drei gleiche
 *     Zeichnungen wären der Fehler, den am Papierstapel niemand bemerkt,
 *     solange die Grundrisse einander ähneln.
 *  2. **Die Blattzahl im Fuß stimmt.** Sie muss vor dem ersten Blatt
 *     feststehen, weil jedes Blatt sie trägt — sie wird also *vorhergesagt*.
 *     Eine falsche Vorhersage liest sich als „Blatt 7/8", und dann sucht
 *     jemand ein Blatt, das es nie gab. Bis 1.57.0 stand dort eine feste 6
 *     und ein geschätzter Zeilenumbruch von 55 Zeilen; beides war falsch.
 *
 * Alle Sollwerte sind unten im Kommentar hergeleitet; keiner stammt aus
 * einem Probelauf.
 */

import type { CheckFn } from './typ';
import { buildReferenceDocument } from '../reference';
import { buildPipeReport } from '../../src/lib/pipeReport';
import { buildPipeReportSheets } from '../../src/lib/pipeReportPrint';

/** „Blatt 7/7" aus dem Blattfuß lesen. */
function blattfuss(svg: string): { nr: number; von: number } | undefined {
  const m = /Blatt (\d+)\/(\d+)/.exec(svg);
  return m ? { nr: Number(m[1]), von: Number(m[2]) } : undefined;
}

export function pruefeRohrnetzblaetter(check: CheckFn): void {
  const doc = buildReferenceDocument();
  const geschosse = Object.values(doc.levels).sort((a, b) => a.order - b.order);
  check('Rohrnetzblätter · das Prüfhaus hat drei Geschosse', geschosse.map((l) => l.name).join(', '), 'KG, EG, OG');

  const bericht = buildPipeReport(doc, {});
  const mit = buildPipeReportSheets(doc, bericht, { format: 'A4', planScale: 100 });
  const ohne = buildPipeReportSheets(doc, bericht, { format: 'A4', grundriss: false });

  // =========================================================================
  // 1 · Ein Grundriss je Geschoss, von unten nach oben
  // =========================================================================
  {
    /*
     * Das Prüfhaus hat in jedem seiner drei Geschosse Wände. Also drei
     * Grundrissblätter — nicht eines.
     */
    check('Rohrnetzblätter · drei Grundrisse', mit.planGeschosse.length, 3);
    check('Rohrnetzblätter · von unten nach oben', mit.planGeschosse.join(', '), 'KG, EG, OG');

    /*
     * Die Grundrisse stehen vorn, in derselben Reihenfolge, und jeder nennt
     * sein Geschoss im Titel. Stünde auf allen dreien derselbe Name, wäre
     * dreimal dasselbe Geschoss gedruckt.
     */
    for (const [i, name] of mit.planGeschosse.entries()) {
      check(`Rohrnetzblätter · Blatt ${i + 1} nennt „${name}"`, mit.sheets[i]!.includes(`Rohrnetz ${name}`), true);
    }

    /*
     * **Und sie sind verschieden.** Das Prüfhaus hat in jedem Geschoss andere
     * Räume; drei gleiche Zeichnungen hießen, dass der Geschossfilter nicht
     * greift.
     */
    check('Rohrnetzblätter · drei verschiedene Zeichnungen', new Set(mit.sheets.slice(0, 3)).size, 3);

    /*
     * Ohne Grundriss ist kein Grundriss dabei — und der Bericht ist genau um
     * diese drei Blätter kürzer. Das ist die Gegenprobe dazu, dass die drei
     * Blätter wirklich die Grundrisse sind und nicht etwas anderes.
     */
    check('Rohrnetzblätter · ohne Grundriss keine Geschosse', ohne.planGeschosse.length, 0);
    check('Rohrnetzblätter · und genau drei Blätter weniger', mit.sheets.length - ohne.sheets.length, 3);
  }

  // =========================================================================
  // 2 · Die Blattzahl im Fuß ist die wirkliche
  // =========================================================================
  {
    /*
     * Der Fuß jedes Tabellenblatts trägt „Blatt i/gesamt". `gesamt` wird
     * vorhergesagt, bevor das erste Blatt gebaut ist. Die Probe ist deshalb
     * nicht, ob eine bestimmte Zahl dasteht, sondern ob die vorhergesagte mit
     * der tatsächlichen übereinstimmt — und zwar in beiden Fällen, mit
     * Grundrissen und ohne, weil sich die Vorhersage genau darin unterscheidet.
     */
    for (const [name, druck] of [['mit Grundriss', mit], ['ohne Grundriss', ohne]] as const) {
      const letzte = blattfuss(druck.sheets[druck.sheets.length - 1]!);
      check(`Rohrnetzblätter · ${name}: das letzte Blatt trägt einen Fuß`, letzte !== undefined, true);
      check(`Rohrnetzblätter · ${name}: Nummer des letzten Blatts`, letzte?.nr ?? -1, druck.sheets.length);
      check(`Rohrnetzblätter · ${name}: angekündigte Blattzahl`, letzte?.von ?? -1, druck.sheets.length);
    }

    /*
     * Und die Nummern laufen lückenlos. Gezählt wird über alle Blätter mit
     * Fuß — die Grundrisse haben keinen, sie kommen von `buildPlanSvg`. Der
     * erste Fuß muss deshalb die Nummer tragen, die auf die Grundrisse folgt:
     * drei Grundrisse, also Blatt 4.
     */
    const nummern = mit.sheets.map(blattfuss).filter((x): x is { nr: number; von: number } => !!x).map((x) => x.nr);
    check('Rohrnetzblätter · der erste Fuß steht auf Blatt 4', nummern[0] ?? -1, 4);
    check('Rohrnetzblätter · die Nummern laufen lückenlos', nummern.join(','), 
      Array.from({ length: nummern.length }, (_, i) => i + 4).join(','));
  }

  // =========================================================================
  // 3 · Ein Maßstab für alle Blätter
  // =========================================================================
  {
    /*
     * `planSuggestedScale` ist der kleinste Nenner, bei dem **jedes** Blatt
     * passt — also das Maximum über die Geschosse und nicht der Wert des
     * zuletzt gezeichneten. Bei einem Maßstab, in dem alle passen, meldet der
     * Bericht nichts; bei 1:20 passt im Prüfhaus keines, und dann müssen alle
     * drei Geschosse in der Meldung stehen. Zwei Grundrisse desselben Hauses
     * in verschiedenen Maßstäben nebeneinander sind der sicherste Weg, zwei
     * Räume zu verwechseln.
     */
    const eng = buildPipeReportSheets(doc, bericht, { format: 'A4', planScale: 20 });
    check('Rohrnetzblätter · bei 1:20 passt keines der drei', eng.planZuGross.length, 3);
    check('Rohrnetzblätter · und die Meldung nennt sie', eng.planZuGross.join(', '), 'KG, EG, OG');
    check('Rohrnetzblätter · ein Vorschlag für alle', eng.planSuggestedScale >= 20, true);
    check(
      'Rohrnetzblätter · der Vorschlag reicht wirklich für alle',
      buildPipeReportSheets(doc, bericht, { format: 'A4', planScale: eng.planSuggestedScale }).planZuGross.length,
      0,
    );
  }
}
