/**
 * Prüfblock „Treppenlogik" — Steigung, Auftritt und das Loch in der Decke.
 *
 * **Der Anlass.** Im 3D-Modell war eine Treppe nur in ihrem eigenen Geschoss
 * zu sehen; darüber lag ein geschlossener Fußboden, und die Treppe stieß
 * dagegen. Gemeldet als „Treppen sollten auch in 3D so dargestellt werden …
 * da muss eine Treppenlogik dahinter."
 *
 * Dahinter steckten drei Größen, die alle aus der **Geschosshöhe** folgen
 * und keine aus einem Näherungswert: die Zahl der Steigungen, die Tiefe des
 * Auftritts und die Stelle, ab der die Decke offen sein muss.
 *
 * **Die Sollwerte sind von Hand gerechnet.** Jede Zahl unten steht mit ihrem
 * Rechenweg im Kommentar; keine stammt aus einem Probelauf. Die Grenzwerte
 * kommen aus DIN 18065 „Gebäudetreppen — Begriffe, Messregeln, Hauptmaße":
 * notwendige Treppe im Wohngebäude mit bis zu zwei Wohnungen, nutzbare
 * Laufbreite mindestens 80 cm, Steigung 140 bis 200 mm, Auftritt 230 bis
 * 370 mm; die lichte Durchgangshöhe steht in Abschnitt 6.4 mit 200 cm,
 * einheitlich für alle Gebäudearten.
 */

import type { CheckFn } from './typ';
import type { Vec2, VerticalElement } from '../../src/types/bim';
import { bodenloecher, type SlabPlan } from '../../src/lib/slabGeometry';
import {
  DURCHGANGSHOEHE,
  TREPPE_GRENZEN,
  oeffnungAb,
  polygonflaeche,
  treppenmasse,
  treppenoeffnung,
} from '../../src/lib/treppenlogik';

/** Eine gerade Treppe, 3,00 m lang und 1,00 m breit, waagerecht im Plan. */
function geradeTreppe(felder: Partial<VerticalElement> = {}): VerticalElement {
  return {
    id: 'treppe',
    kind: 'stair-straight',
    name: 'Treppe',
    levelId: 'eg',
    position: { x: 7, y: 3 },
    width: 1,
    length: 3,
    rotation: 0,
    deductsArea: true,
    openToAbove: true,
    ...felder,
  };
}

export function pruefeTreppenlogik(check: CheckFn): void {
  // =========================================================================
  // 1 · Die Geschosshöhe wird in gleiche Stufen geteilt
  // =========================================================================
  {
    /*
     * **Geschosshöhe 2,80 m, keine Stufenzahl vorgegeben.**
     *
     *   Steigungen = runde(2,80 / 0,175)          = runde(16,00) = 16
     *   Steigung   = 2,80 / 16                    = 0,1750 m
     *   Auftritt   = 0,63 − 2 · 0,175             = 0,2800 m
     *   Auftritte  = 16 − 1                       = 15
     *   Lauflänge  = 15 · 0,28                    = 4,2000 m
     *   Schrittmaß = 2 · 0,175 + 0,28             = 0,6300 m
     */
    const m = treppenmasse(2.8);
    check('Treppe · 2,80 m ergeben 16 Steigungen', m.steigungen, 16);
    check('Treppe · Steigung [m]', m.steigung, 0.175, 1e-12);
    check('Treppe · Auftritt [m]', m.auftritt, 0.28, 1e-12);
    /*
     * **Ein Auftritt weniger als Steigungen.** Die oberste Trittfläche ist
     * der Fußboden des oberen Geschosses; sie gehört zur Decke. Wer gleich
     * viele zählt, baut den Lauf 28 cm zu lang und verfehlt den Austritt.
     */
    check('Treppe · ein Auftritt weniger als Steigungen', m.auftritte, 15);
    check('Treppe · Lauflänge [m]', m.laufLaenge, 4.2, 1e-12);
    check('Treppe · Schrittmaß [m]', m.schrittmass, 0.63, 1e-12);
    check('Treppe · ohne Beanstandung', m.befunde.length, 0);

    /*
     * **Die Summe ist wieder die Geschosshöhe.** Das ist die Probe darauf,
     * dass nicht gerundet wird: 16 Stufen à 175 mm sind 2800 mm. Rundete
     * man eine Steigung von 187,5 mm auf 188 mm, ergäben 16 Stufen 3008 mm
     * — die letzte wäre 8 mm niedriger, und genau das ist die Stolperstelle,
     * die „alle Steigungen gleich hoch" verhindern soll.
     */
    const krumm = treppenmasse(3.0, { steps: 16 });
    check('Treppe · 16 Stufen auf 3,00 m sind 187,5 mm', krumm.steigung, 0.1875, 1e-12);
    check('Treppe · und ergeben zusammen wieder 3,00 m', krumm.steigung * krumm.steigungen, 3.0, 1e-12);
  }

  // =========================================================================
  // 2 · Die Grenzen der Norm werden benannt, nicht stillschweigend korrigiert
  // =========================================================================
  {
    /*
     * **Zu wenige Stufen für die Höhe.** 3,00 m auf 14 Steigungen sind
     * 214,3 mm — über dem Höchstmaß von 200 mm. Wer die Stufen gezählt hat,
     * behält seine Zahl; der Verstoß steht als Befund da.
     *
     *   Steigung = 3,00 / 14 = 0,214285… m  >  0,20 m
     */
    const steil = treppenmasse(3.0, { steps: 14 });
    check('Treppe · die gesetzte Stufenzahl bleibt', steil.steigungen, 14);
    check('Treppe · Steigung [m]', steil.steigung, 3 / 14, 1e-12);
    check('Treppe · über dem Höchstmaß der DIN 18065', steil.steigung > TREPPE_GRENZEN.steigungMax, true);
    check(
      'Treppe · und das steht als Befund da',
      steil.befunde.some((b) => b.schwere === 'warn' && /Höchstmaß/.test(b.text)),
      true,
    );

    /*
     * **Gegenprobe.** Ohne diese Probe hieße die Regel „es gibt immer einen
     * Befund". Bei 17 Steigungen auf 3,00 m sind es 176,5 mm — im Bereich,
     * und der Auftritt 0,63 − 0,353 = 0,277 m liegt ebenfalls darin.
     */
    const richtig = treppenmasse(3.0, { steps: 17 });
    check('Treppe · 17 Stufen auf 3,00 m sind zulässig', richtig.steigung <= TREPPE_GRENZEN.steigungMax, true);
    check('Treppe · und ohne Beanstandung', richtig.befunde.length, 0);

    /*
     * **Die zu schmale Laufbreite** — 70 cm gegen die geforderten 80 cm.
     * Sie ändert an Steigung und Auftritt nichts und ist trotzdem zu nennen:
     * Eine notwendige Treppe, die man nicht benutzen darf, ist keine.
     */
    const schmal = treppenmasse(2.8, { laufbreite: 0.7 });
    check(
      'Treppe · eine zu schmale Laufbreite wird gemeldet',
      schmal.befunde.some((b) => /Laufbreite/.test(b.text)),
      true,
    );
    check('Treppe · 80 cm sind das Kleinstmaß', TREPPE_GRENZEN.laufbreiteMin, 0.8, 1e-12);
  }

  // =========================================================================
  // 3 · Das Loch in der Decke folgt aus der lichten Durchgangshöhe
  // =========================================================================
  {
    /*
     * **Der Fall aus dem Prüfhaus.** Geschosshöhe 3,00 m, 16 Steigungen,
     * Deckenstärke 25 cm — die Unterkante der Decke liegt also 2,75 m über
     * dem Fußboden.
     *
     *   Steigung s = 3,00 / 16       = 0,1875 m
     *   Auftritt a = 0,63 − 2 · s    = 0,2550 m
     *   frei       = 2,75 − 2,00     = 0,7500 m
     *   offen ab d = frei · a / s    = 0,75 · 1,36 = 1,0200 m
     *
     * Der Faktor a/s = 0,2550 / 0,1875 = 1,36 ist das Verhältnis von
     * Waagerechter zu Senkrechter am Lauf: Auf 1,36 m Weg steigt die Treppe
     * einen Meter.
     */
    const m = treppenmasse(3.0, { steps: 16 });
    check('Treppe · Steigung im Prüfhaus [m]', m.steigung, 0.1875, 1e-12);
    check('Treppe · Auftritt im Prüfhaus [m]', m.auftritt, 0.255, 1e-12);
    check('Treppe · Verhältnis Auftritt zu Steigung', m.auftritt / m.steigung, 1.36, 1e-12);
    check('Treppe · die Decke ist ab 1,02 m offen', oeffnungAb(m, 2.75), 1.02, 1e-12);

    /*
     * Und das Loch selbst: Die Lauflinie der geraden Treppe ist ihre Länge,
     * also 3,00 m. Offen bleibt der Rest dahinter, über die volle Breite.
     *
     *   Loch = (3,00 − 1,02) × 1,00 = 1,98 m²
     */
    const v = geradeTreppe();
    const loch = treppenoeffnung(v, m, 2.75);
    check('Treppe · das Loch ist ein Viereck', loch.length, 4);
    check('Treppe · Lochfläche [m²]', polygonflaeche(loch), 1.98, 1e-9);

    /*
     * **Über dem Antritt bleibt die Decke stehen.** Der erste Punkt des
     * Lochs liegt 1,02 m hinter dem Antritt. Die Treppe beginnt bei
     * x = 7 − 3/2 = 5,50 m, das Loch also bei 5,50 + 1,02 = 6,52 m.
     */
    const kleinstesX = Math.min(...loch.map((p) => p.x));
    check('Treppe · das Loch beginnt bei x = 6,52 m', kleinstesX, 6.52, 1e-12);
    check('Treppe · und reicht bis zum Austritt bei x = 8,50 m', Math.max(...loch.map((p) => p.x)), 8.5, 1e-12);

    /*
     * **Je niedriger die Decke, desto größer das Loch.** Bei 2,20 m
     * Unterkante:
     *
     *   frei = 0,20 m  →  d = 0,20 · 1,36 = 0,272 m
     *   Loch = (3,00 − 0,272) × 1,00      = 2,728 m²
     */
    check('Treppe · niedrigere Decke, früheres Loch', oeffnungAb(m, 2.2), 0.272, 1e-12);
    check('Treppe · und ein größeres', polygonflaeche(treppenoeffnung(v, m, 2.2)), 2.728, 1e-9);

    /*
     * **Unter der Durchgangshöhe ist alles offen.** Liegt die Decke selbst
     * tiefer als zwei Meter, gibt es keine Stelle mit Kopffreiheit — dann
     * ist der ganze Lauf offen, und das Loch ist das volle Rechteck.
     */
    check('Treppe · bei 1,90 m Decke ist alles offen', oeffnungAb(m, 1.9), 0, 1e-12);
    check('Treppe · Loch = ganzes Rechteck [m²]', polygonflaeche(treppenoeffnung(v, m, 1.9)), 3.0, 1e-9);
    check('Treppe · die Durchgangshöhe ist 2,00 m', DURCHGANGSHOEHE, 2.0, 1e-12);
  }

  // =========================================================================
  // 4 · Der Schacht ist keine Treppe
  // =========================================================================
  {
    /*
     * Ein Schacht führt Leitungen und keine Köpfe — für ihn gilt die
     * Durchgangshöhe nicht, und `treppenoeffnung` gibt nichts zurück. Sein
     * Loch ist sein voller Umriss, und das schneidet die Platte selbst.
     */
    const schacht = geradeTreppe({ id: 'schacht', kind: 'shaft', width: 0.6, length: 0.8 });
    check('Treppe · für den Schacht gibt es keine Treppenöffnung', treppenoeffnung(schacht, treppenmasse(3, { steps: 16 }), 2.75).length, 0);
  }

  // =========================================================================
  // 5 · Die gewendelte Treppe biegt mit
  // =========================================================================
  {
    /*
     * Bei der viertelgewendelten Treppe knickt die Lauflinie ab. Das Loch
     * muss mitbiegen — ein Rechteck darüber ließe entweder den Kopf
     * anstoßen oder öffnete die Decke, wo sie tragen soll.
     *
     * Geprüft wird an der **Zahl der Ecken**: Der Streifen entlang einer
     * geknickten Lauflinie hat mehr als vier. Und daran, dass das Loch
     * kleiner ist als das umschließende Rechteck der Treppe — sonst wäre es
     * doch wieder nur ein Kasten.
     */
    const l = geradeTreppe({ kind: 'stair-l', width: 2.5, length: 3 });
    const m = treppenmasse(3.0, { steps: 16 });
    const loch = treppenoeffnung(l, m, 2.75);
    check('Treppe · die gewendelte Öffnung hat mehr als vier Ecken', loch.length > 4, true);
    check('Treppe · und bleibt kleiner als das ganze Rechteck', polygonflaeche(loch) < 2.5 * 3, true);
    check('Treppe · sie hat überhaupt eine Fläche', polygonflaeche(loch) > 0.5, true);
  }

  // =========================================================================
  // 6 · Ohne Geschosshöhe wird nichts erfunden
  // =========================================================================
  {
    const ohne = treppenmasse(0);
    check('Treppe · ohne Geschosshöhe keine Steigung', ohne.steigung, 0, 1e-12);
    check(
      'Treppe · und ein Befund, der sagt warum',
      ohne.befunde.some((b) => b.schwere === 'warn' && /Geschosshöhe/.test(b.text)),
      true,
    );
    check('Treppe · und kein Loch', treppenoeffnung(geradeTreppe(), ohne, 2.75).length >= 3, true);
  }

  // =========================================================================
  // 7 · Der Fußboden darüber bekommt dasselbe Loch wie die Decke darunter
  // =========================================================================
  {
    /*
     * **Das war der eigentliche Fehler im Bild.** Decke und Fußboden sind
     * zwei Flächen an derselben Stelle: Die Platte hatte ihr Loch, der
     * Fußboden nicht. Wer von oben auf das Obergeschoss sah, sah einen
     * geschlossenen Boden über der Treppe.
     *
     * `bodenloecher` sucht die Platte an ihrer **Oberkante** — sie liegt auf
     * der Höhe, auf der das Geschoss beginnt. Geprüft wird an zwei erfundenen
     * Platten, damit die Zuordnung selbst zur Sprache kommt und nicht ein
     * Prüfhaus mitgeprüft wird.
     */
    const viereck = (cx: number, cy: number, b: number, t: number): Vec2[] => [
      { x: cx - b / 2, y: cy - t / 2 },
      { x: cx + b / 2, y: cy - t / 2 },
      { x: cx + b / 2, y: cy + t / 2 },
      { x: cx - b / 2, y: cy + t / 2 },
    ];
    const platten: SlabPlan[] = [
      // Decke über dem Keller: Oberkante 0,00 — das ist der Fußboden des EG.
      { levelId: 'kg', top: 0, bottom: -0.25, thickness: 0.25, outlines: [], holes: [viereck(2, 3, 0.8, 0.6)] },
      // Decke über dem EG: Oberkante 3,00 — der Fußboden des OG.
      { levelId: 'eg', top: 3, bottom: 2.75, thickness: 0.25, outlines: [], holes: [viereck(7, 3, 2, 1), viereck(2, 3, 0.8, 0.6)] },
    ];

    check('Treppe · der EG-Boden erbt das Loch der Kellerdecke', bodenloecher(platten, 0).length, 1);
    check('Treppe · der OG-Boden erbt beide Löcher der EG-Decke', bodenloecher(platten, 3).length, 2);
    /*
     * **Unter dem untersten Geschoss liegt keine Platte**, sondern das
     * Erdreich. Ein Loch dort wäre ein Loch in der Bodenplatte.
     */
    check('Treppe · unter dem Keller gibt es nichts zu öffnen', bodenloecher(platten, -2.6).length, 0);
    /*
     * Und die Zuordnung geht über die **Oberkante**, nicht über die
     * Unterkante: Bei 2,75 m — der Unterkante der EG-Decke — darf nichts
     * gefunden werden, sonst läge das Loch ein Geschoss zu tief.
     */
    check('Treppe · die Unterkante zählt nicht', bodenloecher(platten, 2.75).length, 0);
  }
}
