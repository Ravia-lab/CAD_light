/**
 * Prüfblock „Kompass" — wo Norden liegt, und dass alle dasselbe meinen.
 * ---------------------------------------------------------------------------
 * **Warum die Nordrichtung überhaupt geprüft wird.** Sie geht in keine Fläche
 * ein und trotzdem in fast jede Zahl der Heizlast: Über sie bekommt jedes
 * Außenbauteil seinen Azimut, und daraus folgen solare Gewinne, Abschirmung
 * und Verglasungsbewertung. Ein Grundriss, der um neunzig Grad falsch liegt,
 * rechnet die Südfassade als Westfassade — und das sieht man der Zahl nicht
 * an.
 *
 * **Was hier wirklich auf dem Spiel steht.** Zwei Module beschreiben dieselbe
 * Konvention aus entgegengesetzter Richtung: `geometry.ts` beantwortet
 * „welchen Azimut hat dieses Bauteil", `kompass.ts` „wo ist Norden". Laufen
 * sie auseinander, zeigt die Rose in die eine Richtung und der Export rechnet
 * mit der anderen — und beide sehen für sich richtig aus. Der erste Abschnitt
 * prüft deshalb nicht die eine oder die andere, sondern dass sie sich
 * gegenseitig aufheben.
 */

import { azimuthFromNormal, orientationFromAzimuth } from '../../src/lib/geometry';
import { kompassRose, nordabweichungAus, nordrichtung } from '../../src/lib/kompass';
import type { CheckFn } from './typ';

export function pruefeKompass(check: CheckFn): void {
  // === 1 — Die beiden Richtungen heben sich auf ============================
  /*
   * Der Azimut der Nordrichtung muss null sein — bei *jeder* Nordabweichung.
   * Das ist die Gegenprobe zwischen `nordrichtung` und `azimuthFromNormal`:
   * Wer eine der beiden Formeln ändert, ohne die andere anzufassen, fällt
   * hier durch, gleich an welcher Stelle.
   */
  let groessteAbweichung = 0;
  for (let grad = 0; grad < 360; grad += 7) {
    const az = azimuthFromNormal(nordrichtung(grad), grad);
    // Der Azimut ist auf [0,360) gebracht; 359,999 ist dasselbe wie 0.
    const fehler = Math.min(az, 360 - az);
    groessteAbweichung = Math.max(groessteAbweichung, fehler);
  }
  check('Die Nordrichtung hat bei jeder Abweichung den Azimut 0', groessteAbweichung, 0, 1e-9);

  // Und die Umkehrung: aus der Richtung wieder die Abweichung.
  let rueckAbweichung = 0;
  for (let grad = 0; grad < 360; grad += 7) {
    const zurueck = nordabweichungAus(nordrichtung(grad));
    const fehler = Math.abs(((zurueck - grad + 540) % 360) - 180);
    rueckAbweichung = Math.max(rueckAbweichung, fehler);
  }
  check('Richtung und Abweichung lassen sich ineinander umrechnen', rueckAbweichung, 0, 1e-9);

  // === 2 — Die Fälle, die man im Kopf nachrechnet ==========================
  // Ohne Abweichung zeigt Norden nach +y.
  const n0 = nordrichtung(0);
  check('Ohne Abweichung liegt Norden bei +y — x', n0.x, 0, 1e-12);
  check('Ohne Abweichung liegt Norden bei +y — y', n0.y, 1, 1e-12);
  // Bei 90° ist der Plan eine Vierteldrehung verdreht: Norden liegt rechts.
  const n90 = nordrichtung(90);
  check('Bei 90° liegt Norden bei +x — x', n90.x, 1, 1e-12);
  check('Bei 90° liegt Norden bei +x — y', n90.y, 0, 1e-12);
  // Bei 180° zeigt Norden nach unten.
  check('Bei 180° liegt Norden bei −y', nordrichtung(180).y, -1, 1e-12);

  // Und was das für ein Bauteil bedeutet: Eine Wand, deren Außennormale nach
  // +y zeigt, ist ohne Abweichung eine Nordfassade — und bei 90°
  // Nordabweichung eine Westfassade.
  check('Normale +y ohne Abweichung: Nord',
    orientationFromAzimuth(azimuthFromNormal({ x: 0, y: 1 }, 0)), 'N');
  check('Normale +y bei 90° Abweichung: West',
    orientationFromAzimuth(azimuthFromNormal({ x: 0, y: 1 }, 90)), 'W');
  check('Normale +x ohne Abweichung: Ost',
    orientationFromAzimuth(azimuthFromNormal({ x: 1, y: 0 }, 0)), 'O');
  check('Normale +x bei 90° Abweichung: Nord',
    orientationFromAzimuth(azimuthFromNormal({ x: 1, y: 0 }, 90)), 'N');

  // === 3 — Die Rose zeigt dorthin, wo Norden ist ==========================
  /*
   * Die gefüllte Nordspitze ist das erste Flächenteil, und ihr erster Punkt
   * ist die Spitze. Sie muss in dieselbe Richtung zeigen wie `nordrichtung` —
   * sonst stimmt die Zahl und das Bild lügt, und das ist der Fehler, den
   * niemand findet.
   */
  for (const grad of [0, 37, 90, 180, 271]) {
    const teile = kompassRose(grad);
    const spitze = teile.find((t) => t.kind === 'flaeche');
    check(`Bei ${grad}° gibt es eine Nordspitze`, spitze !== undefined, true);
    if (!spitze || spitze.kind !== 'flaeche') continue;
    const p = spitze.punkte[0];
    const n = nordrichtung(grad);
    // Der erste Punkt liegt auf 0,82 der Länge in Nordrichtung.
    const laenge = Math.hypot(p.x, p.y);
    check(`… sie ist bei ${grad}° 0,82 lang`, laenge, 0.82, 1e-9);
    // Gleiche Richtung: das Skalarprodukt der Einheitsvektoren ist 1.
    check(`… und zeigt bei ${grad}° nach Norden`, (p.x * n.x + p.y * n.y) / laenge, 1, 1e-9);
  }

  // Die Rose bleibt in ihrem Kreis: kein Teil außer der Beschriftung darf
  // über den Radius 1 hinausragen, sonst steht sie im Zeichenfeld statt
  // daneben.
  let groessterRadius = 0;
  for (const t of kompassRose(33, false)) {
    if (t.kind === 'kreis') groessterRadius = Math.max(groessterRadius, t.radius);
    else if (t.kind === 'linie') {
      groessterRadius = Math.max(groessterRadius, Math.hypot(t.a.x, t.a.y), Math.hypot(t.b.x, t.b.y));
    } else if (t.kind === 'flaeche') {
      for (const p of t.punkte) groessterRadius = Math.max(groessterRadius, Math.hypot(p.x, p.y));
    }
  }
  check('Ohne Beschriftung bleibt die Rose im Einheitskreis', groessterRadius, 1, 1e-9);
  check('Mit Beschriftung kommt genau ein Textteil dazu',
    kompassRose(0).length - kompassRose(0, false).length, 1, 0);
  check('… und der Text heißt N',
    kompassRose(0).filter((t) => t.kind === 'text').map((t) => (t.kind === 'text' ? t.text : ''))[0],
    'N');
}
