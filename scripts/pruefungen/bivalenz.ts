/**
 * Prüfblock „Deckungsanteile bivalenter Anlagen".
 *
 * **Warum dieser Block besonders streng ist.** Die Zahlen hier gehen in einen
 * Nachweis: Wie viel der Heizarbeit die Wärmepumpe trägt und wie viel der
 * zweite Erzeuger, entscheidet über Förderfähigkeit, Betriebskosten und die
 * Aussage „die Anlage ist eine Wärmepumpenanlage". Ein Anteil, der um zehn
 * Punkte neben der Wirklichkeit liegt, fällt niemandem auf — er sieht
 * plausibel aus.
 *
 * **Jeder Sollwert ist von Hand gerechnet** und steht im Kommentar darüber.
 * Das Modell macht das möglich: Zwei Geraden, daraus ein Lastdreieck, und
 * jeder Anteil ist ein Flächenverhältnis darin.
 *
 * **Die drei Gegenproben, auf die es ankommt:**
 *  1. Die Formeln gehen stetig ineinander über (teilparallel → alternativ bei
 *     gleichem Punkt, teilparallel → parallel bei Abschaltpunkt = θ_norm).
 *  2. Die Anteile ergänzen sich zu 1 — keine Arbeit verschwindet.
 *  3. Die Grenzfälle: Bivalenzpunkt an der Norm-Außentemperatur → die
 *     Wärmepumpe trägt alles; an der Heizgrenze → der zweite Erzeuger alles.
 */

import type { CheckFn } from './typ';
import type { SecondGenerator } from '../../src/types/bim';
import {
  BIVALENZ_HINDERNIS_TEXT,
  bivalenzanteile,
  dauerlinie,
  gebaeudelast,
  vorschlagBivalenzpunkt,
  zeitanteilUnter,
  type Gebaeudekennlinie,
} from '../../src/lib/bivalenz';

export function pruefeBivalenz(check: CheckFn): void {
  /*
   * Das Prüfhaus: Q_N = 10 kW bei θ_norm = −10 °C, Heizgrenze 15 °C.
   * Die Spanne ist damit 25 K — bewusst eine runde Zahl, damit jeder
   * Zeitanteil im Kopf nachzurechnen ist.
   */
  const k: Gebaeudekennlinie = { heizlast: 10, normAussen: -10, heizgrenze: 15 };

  // -------------------------------------------------------------------------
  // 1 · Die Gebäudekennlinie
  // -------------------------------------------------------------------------
  // Bei θ_norm die ganze Last.
  check('Bivalenz · Last bei Norm-Außentemperatur', gebaeudelast(k, -10), 10);
  // An der Heizgrenze null — darüber wird nicht geheizt.
  check('Bivalenz · Last an der Heizgrenze', gebaeudelast(k, 15), 0);
  check('Bivalenz · und darüber auch', gebaeudelast(k, 20), 0);
  // Bei 0 °C: (15 − 0)/25 = 0,6 → 6,00 kW.
  check('Bivalenz · Last bei 0 °C', gebaeudelast(k, 0), 6, 1e-9);
  // Bei −2 °C: (15 + 2)/25 = 0,68 → 6,80 kW.
  check('Bivalenz · Last bei −2 °C', gebaeudelast(k, -2), 6.8, 1e-9);
  // **Gegenprobe:** Unter der Norm-Außentemperatur wird nicht extrapoliert.
  check('Bivalenz · unter θ_norm bleibt es bei der Norm-Heizlast', gebaeudelast(k, -15), 10);

  // -------------------------------------------------------------------------
  // 2 · Die Dauerlinie und ihre Umkehrung
  // -------------------------------------------------------------------------
  // u = 0 ist der kälteste Punkt, u = 1 die Heizgrenze.
  check('Bivalenz · Dauerlinie bei u = 0', dauerlinie(k, 0), -10);
  check('Bivalenz · Dauerlinie bei u = 1', dauerlinie(k, 1), 15);
  // u = 0,4 → −10 + 25 · 0,4 = 0 °C.
  check('Bivalenz · Dauerlinie bei u = 0,4', dauerlinie(k, 0.4), 0, 1e-9);
  // Umkehrung: unter −2 °C liegen (−2 + 10)/25 = 0,32 der Heizzeit.
  check('Bivalenz · Zeitanteil unter −2 °C', zeitanteilUnter(k, -2), 0.32, 1e-9);
  check('Bivalenz · Zeitanteil unter θ_norm', zeitanteilUnter(k, -10), 0);
  check('Bivalenz · Zeitanteil unter der Heizgrenze', zeitanteilUnter(k, 15), 1);
  // Beides muss zueinander passen: dauerlinie(zeitanteilUnter(θ)) = θ.
  check('Bivalenz · Dauerlinie und Umkehrung passen zusammen',
    dauerlinie(k, zeitanteilUnter(k, -2)), -2, 1e-9);

  // -------------------------------------------------------------------------
  // 3 · Paralleler Betrieb — f₂ = u²
  // -------------------------------------------------------------------------
  const zweit = (patch: Partial<SecondGenerator> = {}): SecondGenerator => ({
    art: 'gas',
    leistung: 15,
    betrieb: 'bivalent-parallel',
    bivalenzpunkt: -2,
    einbindung: 'ruecklauf-seriell',
    eigenePumpe: false,
    ...patch,
  });

  const nimm = (patch: Partial<SecondGenerator> = {}) => {
    const r = bivalenzanteile(zweit(patch), k);
    return 'ergebnis' in r ? r.ergebnis : undefined;
  };

  /*
   * Bivalenzpunkt −2 °C → u = 0,32. Anteil des zweiten Erzeugers 0,32² =
   * 0,1024, also 10,24 %. Die Wärmepumpe trägt 0,8976.
   *
   * Zur Anschauung, warum das Quadrat steht: Unter −2 °C liegen 32 % der
   * Heizzeit, und in diesen 32 % trägt der zweite Erzeuger nur die Spitze über
   * der Wärmepumpenleistung — im Mittel die Hälfte des Zuwachses. Die Fläche
   * ist deshalb ein Dreieck in einem Dreieck, und das Verhältnis zweier
   * ähnlicher Dreiecke ist das Quadrat ihres Maßstabs.
   */
  const par = nimm();
  check('Bivalenz · parallel: Anteil zweiter Erzeuger', par?.anteilZweiterzeuger ?? -1, 0.1024, 1e-9);
  check('Bivalenz · parallel: Anteil Wärmepumpe', par?.anteilWaermepumpe ?? -1, 0.8976, 1e-9);
  // **Die Gegenprobe, die keine Arbeit verschwinden lässt:** beides zusammen 1.
  check('Bivalenz · die Anteile ergänzen sich zu eins',
    (par?.anteilWaermepumpe ?? 0) + (par?.anteilZweiterzeuger ?? 0), 1, 1e-9);
  check('Bivalenz · parallel: Zeitanteil unter dem Bivalenzpunkt',
    par?.zeitanteilUnterBivalenz ?? -1, 0.32, 1e-9);
  // Parallel läuft die Wärmepumpe immer mit — nie ohne.
  check('Bivalenz · parallel: die Wärmepumpe steht nie still',
    par?.zeitanteilOhneWaermepumpe ?? -1, 0);
  // Leistung am Bivalenzpunkt = Gebäudelast bei −2 °C = 6,80 kW.
  check('Bivalenz · parallel: Leistung am Bivalenzpunkt', par?.leistungAmBivalenzpunkt ?? -1, 6.8, 1e-9);
  // Der zweite Erzeuger muss die Spitze tragen: 10,00 − 6,80 = 3,20 kW.
  check('Bivalenz · parallel: verlangte Leistung', par?.leistungZweiterzeuger ?? -1, 3.2, 1e-9);
  // 15 kW eingetragen → nichts fehlt.
  check('Bivalenz · parallel: 15 kW reichen', par?.leistungFehlt ?? -1, 0);
  // Gegenprobe mit einem zu kleinen Heizstab: 2 kW → es fehlen 1,20 kW.
  check('Bivalenz · ein zu kleiner Erzeuger wird als Fehlbetrag gemeldet',
    nimm({ leistung: 2 })?.leistungFehlt ?? -1, 1.2, 1e-9);
  // Und die Fehlmenge wird **nicht** umverteilt: der Anteil bleibt derselbe.
  check('Bivalenz · der Fehlbetrag ändert den Anteil nicht',
    nimm({ leistung: 2 })?.anteilZweiterzeuger ?? -1, 0.1024, 1e-9);

  // -------------------------------------------------------------------------
  // 4 · Grenzfälle des parallelen Betriebs
  // -------------------------------------------------------------------------
  // Bivalenzpunkt an der Norm-Außentemperatur: u = 0 → die Wärmepumpe alles.
  check('Bivalenz · Bivalenzpunkt bei θ_norm: die Wärmepumpe trägt alles',
    nimm({ bivalenzpunkt: -10 })?.anteilWaermepumpe ?? -1, 1);
  check('Bivalenz · und der zweite Erzeuger nichts',
    nimm({ bivalenzpunkt: -10 })?.anteilZweiterzeuger ?? -1, 0);
  // Darunter bleibt es dabei — gekappt, nicht negativ.
  check('Bivalenz · noch tiefer bleibt es bei null',
    nimm({ bivalenzpunkt: -20 })?.anteilZweiterzeuger ?? -1, 0);
  // Bivalenzpunkt an der Heizgrenze: u = 1 → 1² = 1, der zweite Erzeuger alles.
  check('Bivalenz · Bivalenzpunkt an der Heizgrenze: der zweite trägt alles',
    nimm({ bivalenzpunkt: 15 })?.anteilZweiterzeuger ?? -1, 1);
  // Mitte der Spanne: 2,5 °C → u = 0,5 → 0,25.
  check('Bivalenz · Bivalenzpunkt in der Mitte: ein Viertel',
    nimm({ bivalenzpunkt: 2.5 })?.anteilZweiterzeuger ?? -1, 0.25, 1e-9);

  // -------------------------------------------------------------------------
  // 5 · Alternativer Betrieb — f₂ = 2u − u²
  // -------------------------------------------------------------------------
  /*
   * Abschaltpunkt −2 °C → u = 0,32. f₂ = 2·0,32 − 0,32² = 0,64 − 0,1024 =
   * 0,5376. Mehr als die Hälfte der Heizarbeit, obwohl es nur 32 % der Zeit
   * sind — weil der zweite Erzeuger in dieser Zeit **alles** trägt, und zwar
   * die kältesten Stunden mit der größten Last. Genau diese Zahl überrascht
   * bei der alternativen Fahrweise jeden, der sie zum ersten Mal rechnet.
   */
  const alt = nimm({ betrieb: 'bivalent-alternativ', abschaltpunkt: -2 });
  check('Bivalenz · alternativ: Anteil zweiter Erzeuger', alt?.anteilZweiterzeuger ?? -1, 0.5376, 1e-9);
  check('Bivalenz · alternativ: Anteil Wärmepumpe', alt?.anteilWaermepumpe ?? -1, 0.4624, 1e-9);
  // Die Wärmepumpe steht in diesen 32 % der Zeit still.
  check('Bivalenz · alternativ: Stillstandsanteil', alt?.zeitanteilOhneWaermepumpe ?? -1, 0.32, 1e-9);
  // Und der zweite Erzeuger muss die **ganze** Norm-Heizlast tragen.
  check('Bivalenz · alternativ: verlangte Leistung ist die ganze Heizlast',
    alt?.leistungZweiterzeuger ?? -1, 10);
  // Grenzfall: Abschaltpunkt an der Heizgrenze → 2·1 − 1 = 1.
  check('Bivalenz · alternativ an der Heizgrenze: alles',
    nimm({ betrieb: 'bivalent-alternativ', bivalenzpunkt: 15, abschaltpunkt: 15 })?.anteilZweiterzeuger ?? -1, 1);

  // -------------------------------------------------------------------------
  // 6 · Teilparallel — und die beiden Stetigkeitsproben
  // -------------------------------------------------------------------------
  /*
   * Bivalenzpunkt 0 °C (u_biv = 0,4), Abschaltpunkt −5 °C (u_ab = 0,2):
   * f₂ = 2·0,2 − 0,2² + (0,4 − 0,2)² = 0,4 − 0,04 + 0,04 = 0,40.
   */
  const teil = nimm({ betrieb: 'bivalent-teilparallel', bivalenzpunkt: 0, abschaltpunkt: -5 });
  check('Bivalenz · teilparallel: Anteil zweiter Erzeuger', teil?.anteilZweiterzeuger ?? -1, 0.4, 1e-9);
  check('Bivalenz · teilparallel: Anteil Wärmepumpe', teil?.anteilWaermepumpe ?? -1, 0.6, 1e-9);

  /*
   * **Probe 1:** Liegt der Abschaltpunkt auf dem Bivalenzpunkt, ist
   * teilparallel dasselbe wie alternativ. Beide Formeln müssen denselben Wert
   * liefern — bei 0 °C: 2·0,4 − 0,16 = 0,64.
   */
  const probe1 = nimm({ betrieb: 'bivalent-teilparallel', bivalenzpunkt: 0, abschaltpunkt: 0 });
  const probe1b = nimm({ betrieb: 'bivalent-alternativ', bivalenzpunkt: 0, abschaltpunkt: 0 });
  check('Bivalenz · Probe: teilparallel = alternativ bei gleichem Punkt',
    probe1?.anteilZweiterzeuger ?? -1, probe1b?.anteilZweiterzeuger ?? -2, 1e-9);
  check('Bivalenz · und der Wert ist 0,64', probe1?.anteilZweiterzeuger ?? -1, 0.64, 1e-9);

  /*
   * **Probe 2:** Liegt der Abschaltpunkt an der Norm-Außentemperatur, schaltet
   * die Wärmepumpe nie ab — teilparallel ist dann parallel. Bei 0 °C: 0,4² =
   * 0,16.
   */
  const probe2 = nimm({ betrieb: 'bivalent-teilparallel', bivalenzpunkt: 0, abschaltpunkt: -10 });
  const probe2b = nimm({ betrieb: 'bivalent-parallel', bivalenzpunkt: 0 });
  check('Bivalenz · Probe: teilparallel = parallel bei Abschaltpunkt θ_norm',
    probe2?.anteilZweiterzeuger ?? -1, probe2b?.anteilZweiterzeuger ?? -2, 1e-9);
  check('Bivalenz · und der Wert ist 0,16', probe2?.anteilZweiterzeuger ?? -1, 0.16, 1e-9);

  /*
   * Ein Abschaltpunkt **über** dem Bivalenzpunkt ist widersprüchlich — die
   * Wärmepumpe kann nicht abschalten, bevor der zweite Erzeuger zugeschaltet
   * hat. Gerechnet wird dann mit dem Bivalenzpunkt, also als alternativer
   * Betrieb, und nicht mit der widersprüchlichen Eingabe.
   */
  const widerspruch = nimm({ betrieb: 'bivalent-teilparallel', bivalenzpunkt: -2, abschaltpunkt: 5 });
  check('Bivalenz · ein Abschaltpunkt über dem Bivalenzpunkt wird begrenzt',
    widerspruch?.abschaltpunkt ?? 99, -2);
  check('Bivalenz · und ergibt dann den alternativen Anteil',
    widerspruch?.anteilZweiterzeuger ?? -1, 0.5376, 1e-9);

  // -------------------------------------------------------------------------
  // 7 · Monoenergetisch rechnet wie parallel
  // -------------------------------------------------------------------------
  // Der Heizstab läuft neben der Wärmepumpe — dieselbe Formel. Mit 6 kW
  // Heizstab bei Bivalenzpunkt −2 °C: verlangt 3,20 kW, also reicht er.
  const mono = nimm({ art: 'elektro-heizstab', betrieb: 'monoenergetisch', leistung: 6 });
  check('Bivalenz · monoenergetisch rechnet wie parallel',
    mono?.anteilZweiterzeuger ?? -1, 0.1024, 1e-9);
  check('Bivalenz · der Heizstab reicht für die Spitze', mono?.leistungFehlt ?? -1, 0);
  // Gegenprobe: derselbe Heizstab im alternativen Betrieb müsste 10 kW
  // tragen — es fehlen 4 kW. Das ist der Satz, der dort regelmäßig untergeht.
  check('Bivalenz · derselbe Heizstab alternativ: 4 kW fehlen',
    nimm({ art: 'elektro-heizstab', betrieb: 'bivalent-alternativ', leistung: 6, abschaltpunkt: -2 })?.leistungFehlt ?? -1,
    4, 1e-9);

  // -------------------------------------------------------------------------
  // 8 · Wo nicht gerechnet wird — und warum
  // -------------------------------------------------------------------------
  const hindernis = (r: ReturnType<typeof bivalenzanteile>) => ('hindernis' in r ? r.hindernis : 'gerechnet');
  check('Bivalenz · ohne zweiten Erzeuger wird nicht gerechnet',
    hindernis(bivalenzanteile(undefined, k)), 'kein-zweiterzeuger');
  check('Bivalenz · Solarthermie hat keinen Bivalenzpunkt',
    hindernis(bivalenzanteile(zweit({ art: 'solarthermie' }), k)), 'solarthermie');
  check('Bivalenz · ohne Heizgrenze keine Dauerlinie',
    hindernis(bivalenzanteile(zweit(), { ...k, heizgrenze: Number.NaN })), 'keine-heizgrenze');
  check('Bivalenz · ohne Heizlast keine Kennlinie',
    hindernis(bivalenzanteile(zweit(), { ...k, heizlast: 0 })), 'keine-heizlast');
  check('Bivalenz · Heizgrenze unter θ_norm ist ein Widerspruch',
    hindernis(bivalenzanteile(zweit(), { ...k, heizgrenze: -12 })), 'heizgrenze-unter-norm');
  // Jedes Hindernis hat einen Satz — eine Lücke ohne Begründung kann niemand
  // schließen.
  check('Bivalenz · fünf Hindernisse, fünf Begründungen', Object.keys(BIVALENZ_HINDERNIS_TEXT).length, 5);
  check('Bivalenz · jede Begründung ist ein ganzer Satz',
    Object.values(BIVALENZ_HINDERNIS_TEXT).every((t) => t.length > 40 && t.trim().endsWith('.')), true);

  // -------------------------------------------------------------------------
  // 9 · Gegenprobe an einer Hausnummer, die lange vor dieser Rechnung da war
  // -------------------------------------------------------------------------
  /*
   * Im Glossar dieses Programms steht seit Langem der Satz: „Bei −5 °C deckt
   * die Wärmepumpe immer noch rund 95 Prozent der Jahresarbeit ab." Er stammt
   * aus der Praxis und nicht aus dieser Formel — also eine echte Gegenprobe.
   *
   * Nachgerechnet mit θ_norm = −12 °C und Heizgrenze 15 °C (die Spanne ist
   * 27 K): u = (−5 + 12)/27 = 0,2593. Parallel: f₂ = 0,2593² = 0,0672, die
   * Wärmepumpe trägt also 93,3 %. Mit θ_norm = −10 °C wären es 96,0 %.
   *
   * Beides liegt bei „rund 95 %". Geprüft wird deshalb der Bereich und nicht
   * eine Stelle hinter dem Komma: Eine Formel, die hier 70 % oder 99 % ergäbe,
   * wäre falsch — und das würde diese Probe zeigen.
   */
  const praxis: Gebaeudekennlinie = { heizlast: 10, normAussen: -12, heizgrenze: 15 };
  const r95 = bivalenzanteile(
    { art: 'elektro-heizstab', leistung: 6, betrieb: 'monoenergetisch', bivalenzpunkt: -5, einbindung: 'vorlauf-parallel', eigenePumpe: false },
    praxis,
  );
  const anteil95 = 'ergebnis' in r95 ? r95.ergebnis.anteilWaermepumpe : -1;
  check('Bivalenz · Praxisprobe: Anteil bei −5 °C', anteil95, 0.9328, 1e-4);
  check('Bivalenz · und das ist „rund 95 %"', anteil95 > 0.9 && anteil95 < 0.96, true);

  // -------------------------------------------------------------------------
  // 10 · Der Vorschlag für den Bivalenzpunkt
  // -------------------------------------------------------------------------
  /*
   * Das Gerät trägt im Auslegungspunkt 6,80 kW. Die Gebäudekennlinie steht
   * dort bei −2 °C (siehe 1): θ = 15 − (6,8/10)·25 = 15 − 17 = −2.
   */
  check('Bivalenz · Vorschlag aus 6,80 kW', vorschlagBivalenzpunkt(k, 6.8) ?? 99, -2, 1e-9);
  // 6,00 kW → θ = 15 − 15 = 0 °C.
  check('Bivalenz · Vorschlag aus 6,00 kW', vorschlagBivalenzpunkt(k, 6) ?? 99, 0, 1e-9);
  /*
   * **Die Gegenprobe:** Trägt das Gerät die ganze Norm-Heizlast, gibt es im
   * Heizbereich keinen Schnittpunkt — dann ist die Anlage monovalent fähig und
   * es wird **kein** Punkt vorgeschlagen. Eine Zahl auszugeben wäre hier
   * schlimmer als keine: Sie behauptete einen zweiten Erzeuger, den niemand
   * braucht.
   */
  check('Bivalenz · ein ausreichendes Gerät braucht keinen Bivalenzpunkt',
    vorschlagBivalenzpunkt(k, 10) === undefined, true);
  check('Bivalenz · und ein größeres auch nicht',
    vorschlagBivalenzpunkt(k, 12) === undefined, true);
}
