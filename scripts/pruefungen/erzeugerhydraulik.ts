/**
 * Prüfblock „Erzeugerhydraulik" — der Posten, der bis 1.13.2 null war.
 *
 * **Warum dieser Block gebraucht wird.** Bis 1.13.2 rechnete der
 * Rohrnetzbericht mit `generatorLoss: 0` und die Anlagenauslegung mit einem
 * festen Platzhalter von 20 000 Pa. Zwei verschiedene Zahlen für dieselbe
 * Größe, eine davon geraten, keine belegt. Das Ergebnis war nicht neutral: die
 * Pumpe fiel systematisch zu klein aus, bei einem Einfamilienhaus um
 * größenordnungsmäßig die Hälfte der erforderlichen Förderhöhe.
 *
 * Geprüft werden fünf Fehlerklassen, die genau an dieser Stelle entstehen:
 *
 *  1. **Die Verwechslung von Δp und Restförderhöhe.** Die beiden Angaben
 *     haben entgegengesetztes Vorzeichen in der Rechnung und entgegengesetzte
 *     Steigung über dem Volumenstrom. Wer sie vertauscht, rechnet um 40 bis
 *     70 kPa falsch, und zwar in beide Richtungen. Der Prüfblock hält fest,
 *     dass eine Restförderhöhe **nie** addiert und **nie** quadratisch
 *     skaliert wird.
 *
 *  2. **Die abgeleitete Zahl, die sich von ihrer Grundlage löst.** Die
 *     Typklassenwerte sind Median bzw. unteres Quartil der Markttabelle. Sie
 *     werden hier **nachgerechnet**, nicht abgefragt: eine Prüfung, die den
 *     Prüfling nach dem Sollwert fragt, prüft nichts.
 *
 *  3. **Die kv-Falle mit dem Bezugsdruck.** Kamstrup führt eine Spalte
 *     „kv q@ 0,25 bar" — das ist der Durchfluss bei 0,25 bar, nicht der kvs
 *     bei 1 bar. Ein blind übernommener Wert wäre um Faktor 2 falsch, der
 *     daraus gerechnete Δp um Faktor 4. Geprüft wird, dass die Normierung
 *     genau diesen Faktor herstellt.
 *
 *  4. **Die doppelt gezählte Baugruppe.** Ein Gerät, dessen Δp den Abscheider
 *     einschließt, darf ihn nicht ein zweites Mal im Fließweg bekommen.
 *
 *  5. **Die stille Null.** Fehlt ein Gerätekennwert, muss der Bericht den
 *     **bezifferten** fehlenden Betrag nennen. Eine Null ohne Kommentar liest
 *     sich wie ein Messergebnis.
 *
 * **Herleitung der Sollwerte.** Jede Zahl unten ist im Kommentar von Hand
 * gerechnet und gegen den Recherchebericht gegengeprüft, der sie unabhängig
 * ermittelt hat: Umschaltventil DN 25 (kvs 5,7) bei 1,5 m³/h → 6,9 kPa,
 * Wärmemengenzähler qp 2,5 (kvs 7,91) → 3,6 kPa, Magnetitabscheider mit
 * Absperrung (Kv 7,5) → 4,0 kPa.
 */

import {
  ABSCHEIDER,
  DEFAULT_EXPONENT,
  ERZEUGER_MARKTWERTE,
  FBH_DURCHFLUSSMESSER,
  TYPKLASSE_RESTFOERDERHOEHE,
  TYPKLASSE_RFH_BEZUG,
  TYPKLASSE_WIDERSTAND,
  UMSCHALTVENTILE,
  WAERMEMENGENZAEHLER,
  abscheider,
  ausserhalbGrenzen,
  einbauteilDruck,
  erzeugerBilanz,
  fehlbetragSpanne,
  median,
  normierterKvs,
  quantil,
  skaliert,
  spezifischerWiderstand,
  typklassenHydraulik,
  umschaltventil,
  waermemengenzaehler,
  type EinbauteilTyp,
} from '../../src/lib/erzeugerHydraulik';
import { HEAT_PUMP_CATALOG, findModel } from '../../src/lib/deviceCatalog';
import type { CheckFn } from './typ';

/** Auf zwei Nachkommastellen in kPa — die Einheit, in der Datenblätter reden. */
const kpa = (pa: number): number => Math.round(pa / 10) / 100;

export function pruefeErzeugerhydraulik(check: CheckFn): void {
  // =========================================================================
  // 1 · Die Markttabelle — Belegbarkeit statt Bequemlichkeit
  // =========================================================================
  {
    check('Die Markttabelle ist nicht leer', ERZEUGER_MARKTWERTE.length > 0, true);
    /*
     * Ein Δp oder eine Restförderhöhe **ohne** zugehörigen Volumenstrom ist
     * keine Zahl, sondern eine Behauptung. Wolf hat die Restförderhöhe der
     * CHA-07 zwischen zwei Prospektausgaben von 610 auf 420 mbar geändert,
     * allein durch einen gewechselten Bezugspunkt. Die Tabelle darf deshalb
     * keine einzige Zeile ohne Bezugsvolumenstrom enthalten.
     */
    check('Jede Zeile trägt ihren Bezugsvolumenstrom', ERZEUGER_MARKTWERTE.filter((m) => !(m.bezug > 0)).length, 0);
    check('Jede Zeile trägt einen Wert > 0', ERZEUGER_MARKTWERTE.filter((m) => !(m.wert > 0)).length, 0);
    check('Jede Zeile nennt ihre Quelle', ERZEUGER_MARKTWERTE.filter((m) => !m.quelle.trim()).length, 0);
    check(
      'Jede Zeile nennt den Wortlaut des Herstellers',
      ERZEUGER_MARKTWERTE.filter((m) => !m.begriff.trim()).length,
      0,
    );
    /*
     * Beide Angabearten müssen vorkommen. Eine Tabelle nur mit Δp würde die
     * Restförderhöhen-Typklasse aus der Luft greifen — und umgekehrt.
     */
    check('Es gibt Δp-Zeilen', ERZEUGER_MARKTWERTE.filter((m) => m.angabe === 'druckverlust').length > 0, true);
    check(
      'Es gibt Restförderhöhen-Zeilen',
      ERZEUGER_MARKTWERTE.filter((m) => m.angabe === 'restfoerderhoehe').length > 0,
      true,
    );
    /*
     * Herkunft „abgeleitet" heißt: von diesem Programm gerechnet, nicht vom
     * Hersteller publiziert. Bei den LG-Zeilen ist das der Fall (m WS → kPa),
     * bei den Bosch-Zeilen nicht. Wenn alle Zeilen abgeleitet wären, stünde
     * hinter der Tabelle keine einzige Herstellerangabe mehr.
     */
    check(
      'Mindestens die Hälfte der Zeilen ist Tabellenwert des Herstellers',
      ERZEUGER_MARKTWERTE.filter((m) => m.herkunft === 'tabellenwert').length * 2 >= ERZEUGER_MARKTWERTE.length,
      true,
    );
  }

  // =========================================================================
  // 2 · Die abgeleiteten Typklassenwerte — nachgerechnet, nicht abgefragt
  // =========================================================================
  {
    /*
     * R = Δp/V̇². Die Bosch-Zeile 9 OR-S: 10 500 Pa bei 1,55 m³/h
     * → 10 500 / 2,4025 = 4370,4 Pa/(m³/h)². Von Hand gerechnet.
     */
    const bosch = ERZEUGER_MARKTWERTE.find((m) => m.typ.includes('9 OR-S'));
    check('Bosch 9 OR-S ist in der Tabelle', Boolean(bosch), true);
    check(
      'R der Bosch-Zeile: 10 500 / 1,55² = 4370',
      bosch ? Math.round(spezifischerWiderstand(bosch)) : 0,
      4370,
    );

    /*
     * Der Median wird hier **unabhängig** nachgerechnet: sortieren, Mitte
     * nehmen. Stimmt er nicht mit der Konstanten überein, hat entweder die
     * Konstante ihre Grundlage verloren oder `median` rechnet falsch.
     */
    const rWerte = ERZEUGER_MARKTWERTE.filter((m) => m.angabe === 'druckverlust')
      .map(spezifischerWiderstand)
      .sort((a, b) => a - b);
    const mitte = rWerte.length % 2 ? rWerte[(rWerte.length - 1) / 2] : (rWerte[rWerte.length / 2 - 1] + rWerte[rWerte.length / 2]) / 2;
    check('Der Typklassenwiderstand ist der Median der Tabelle', Math.round(TYPKLASSE_WIDERSTAND), Math.round(mitte));
    /*
     * Der Median darf nicht ins Extrem kippen. Die Reihe ist schief — zwei
     * Stiebel-Zeilen liegen bei über 12 000, sechs LG-Zeilen unter 2 100.
     * Läge der Typklassenwert an einem der Ränder, wäre er kein mittleres
     * Gerät mehr, sondern ein Sonderfall.
     */
    check('Der Median liegt zwischen den Rändern', TYPKLASSE_WIDERSTAND > rWerte[0] && TYPKLASSE_WIDERSTAND < rWerte[rWerte.length - 1], true);
    /*
     * Größenordnungsprobe gegen den Recherchebericht: bei 1,5 m³/h — dem
     * Auslegungsvolumenstrom einer 8-kW-Wärmepumpe — nennt er rund 10,5 kPa
     * für das Bosch-Gerät. Der Median darf davon nicht um mehr als den
     * Faktor 2 abweichen, sonst beschreibt er einen anderen Markt.
     */
    const beiAnderthalb = TYPKLASSE_WIDERSTAND * 1.5 ** 2;
    check('Typklasse bei 1,5 m³/h liegt zwischen 4 und 20 kPa', kpa(beiAnderthalb) >= 4 && kpa(beiAnderthalb) <= 20, true);

    /*
     * Die Restförderhöhe nimmt bewusst **nicht** den Median, sondern das
     * untere Quartil: ein zu hoch angesetzter Wert lässt eine Prüfung
     * bestehen, die durchfallen müsste. Der Fehler ist also nicht symmetrisch,
     * und die Wahl muss das abbilden.
     */
    const rfh = ERZEUGER_MARKTWERTE.filter((m) => m.angabe === 'restfoerderhoehe').map((m) => m.wert);
    check('Die Typklassen-Restförderhöhe ist das untere Quartil', TYPKLASSE_RESTFOERDERHOEHE, quantil(rfh, 0.25));
    check(
      'Sie liegt unter dem Median — die konservative Wahl',
      TYPKLASSE_RESTFOERDERHOEHE < median(rfh),
      true,
    );
    check('Ihr Bezugsvolumenstrom ist gesetzt', TYPKLASSE_RFH_BEZUG > 0, true);

    // Randfälle der beiden Hilfsfunktionen.
    check('Median einer leeren Reihe ist 0', median([]), 0);
    check('Median von [1,2,3]', median([3, 1, 2]), 2);
    check('Median von [1,2,3,4]', median([4, 1, 3, 2]), 2.5);
    check('Quantil 0 ist das Minimum', quantil([5, 1, 9], 0), 1);
    check('Quantil 1 ist das Maximum', quantil([5, 1, 9], 1), 9);
    check('Quantil 0,5 interpoliert', quantil([0, 10], 0.5), 5);
  }

  // =========================================================================
  // 3 · Skalierung — und die Grenze, an der sie aufhört
  // =========================================================================
  {
    const h = typklassenHydraulik({ internePumpe: false, minVolumeFlow: 1.0 });
    check('Ohne interne Pumpe: Angabeart Druckverlust', h.angabe, 'druckverlust');
    check('Der Bezugsvolumenstrom ist der Mindestvolumenstrom', h.bezugsvolumenstrom, 1);
    check('Der Vorgabeexponent ist 2,0', h.exponent, DEFAULT_EXPONENT);
    /*
     * Δp = Δp_bezug · (V̇/V̇_bezug)². Verdoppelter Volumenstrom ⇒
     * vierfacher Druckverlust. Das ist die Aussage, an der die Pumpenauslegung
     * hängt: „um den doppelten Volumenstrom zu erreichen, muss man den
     * vierfachen Differenzdruck aufbauen."
     */
    check('Doppelter Volumenstrom ⇒ vierfacher Druckverlust', Math.round(skaliert(h, 2) / skaliert(h, 1)), 4);
    check('Am Bezugspunkt kommt der Bezugswert heraus', Math.round(skaliert(h, 1)), h.wert);
    check('Halber Volumenstrom ⇒ ein Viertel', Math.round((skaliert(h, 0.5) / skaliert(h, 1)) * 100) / 100, 0.25);

    /*
     * Die Umfangsangabe darf bei einer Typklasse **nicht** behaupten, sie
     * kenne den Umfang: die Markttabelle mischt „nur Verflüssiger" und
     * „ganzes Gerät". Wer hier „gesamtes-geraet" schriebe, würde den
     * Abscheider bei der Hälfte der Geräte unterschlagen.
     */
    check('Der Umfang der Typklasse ist ehrlich unbekannt', h.umfang, 'unbekannt');
    check('Die Herkunft ist als abgeleitet ausgewiesen', h.herkunft, 'abgeleitet');
    check('Die Quelle nennt die Zahl der Belege', /\d+ veröffentlichten/.test(h.quelle), true);

    /*
     * **Die Kernprüfung dieses Blocks.** Eine Restförderhöhe ist eine
     * Pumpenkennlinie: sie fällt mit steigendem Volumenstrom. Sie quadratisch
     * hochzurechnen wäre grob falsch — und der Fehler sähe aus wie eine
     * besonders leistungsfähige Pumpe.
     */
    const r = typklassenHydraulik({ internePumpe: true, minVolumeFlow: 1.0 });
    check('Mit interner Pumpe: Angabeart Restförderhöhe', r.angabe, 'restfoerderhoehe');
    check('Die Restförderhöhe wird nicht skaliert', skaliert(r, 5), r.wert);
    check('… auch nicht nach unten', skaliert(r, 0.1), r.wert);
    check('Sie nennt ihren Bezugspunkt', r.rfhBezug ?? '—', 'mindestvolumenstrom');

    /*
     * Die Gültigkeitsgrenzen. Unterhalb des Mindestvolumenstroms ist die
     * Anlage ohnehin unzulässig; darüber hinaus zu extrapolieren ist eine
     * Aussage über einen Bereich, in dem niemand gemessen hat.
     */
    const mitGrenzen = { ...h, vMin: 0.8, vMax: 2.0 };
    check('Unter der Grenze wird gemeldet', ausserhalbGrenzen(mitGrenzen, 0.5) ?? '—', 'unter');
    check('Über der Grenze wird gemeldet', ausserhalbGrenzen(mitGrenzen, 2.5) ?? '—', 'ueber');
    check('Im Bereich wird nichts gemeldet', ausserhalbGrenzen(mitGrenzen, 1.5) ?? '—', '—');
  }

  // =========================================================================
  // 4 · Einbauteile über kvs — und die Kamstrup-Falle
  // =========================================================================
  {
    /*
     * Δp = (V̇/kvs)² · 1 bar. Von Hand:
     *   Umschaltventil DN 25, kvs 5,7, V̇ = 1,5 → (1,5/5,7)² = 0,06925 bar
     *   = 6,925 kPa. Der Recherchebericht rechnet unabhängig 6,9 kPa.
     */
    const v25 = umschaltventil(25);
    check('Umschaltventil DN 25 hat kvs 5,7', v25.kvs, 5.7);
    check('Umschaltventil DN 25 bei 1,5 m³/h: 6,93 kPa', kpa(einbauteilDruck(v25, 1.5)), 6.93);
    /*
     *   Wärmemengenzähler qp 2,5, kvs 7,91 → (1,5/7,91)² = 0,03596 bar
     *   = 3,60 kPa. Bericht: 3,6 kPa.
     */
    const z = waermemengenzaehler(1.5);
    check('Zu 1,5 m³/h gehört qp 2,5 — nicht qp 1,5', z.label.includes('2,5'), true);
    check('Wärmemengenzähler bei 1,5 m³/h: 3,60 kPa', kpa(einbauteilDruck(z, 1.5)), 3.6);
    /*
     *   Magnetitabscheider DN 25 mit Absperrung, Kv 7,5 → (1,5/7,5)² = 0,04 bar
     *   = 4,00 kPa. Bericht: 4,0 kPa.
     */
    const a = abscheider(25);
    check('Abscheider DN 25 bei 1,5 m³/h: 4,00 kPa', kpa(einbauteilDruck(a, 1.5)), 4.0);
    /*
     * Angesetzt wird die **Baugruppe mit Absperrung** (Kv 7,5), nicht der
     * Abscheider allein (Kv 10,5). Der Unterschied ist rund 28 % im Kv und
     * damit Faktor 2 im Druckverlust — und ohne Absperrung lässt sich der
     * Schmutzfänger nicht reinigen, ohne die Anlage zu entleeren.
     */
    check('Angesetzt ist die Baugruppe, nicht das nackte Bauteil', a.label.includes('Absperrung'), true);

    /*
     * **Die Kamstrup-Falle.** Ein kv, der auf 0,25 bar bezogen ist, ergibt
     * normiert auf 1 bar den doppelten Wert: kvs = kv/√0,25 = kv/0,5 = 2·kv.
     * Kamstrup nennt für qp 6 den Wert 12,3 bei 0,25 bar; der echte kvs ist
     * 24,49. 12,3 · 2 = 24,6 — die Probe geht auf.
     */
    const kamstrup: EinbauteilTyp = {
      art: 'heat-meter',
      label: 'Kamstrup MULTICAL 403 qp 6',
      kvs: 12.3,
      kvsBezugsdruck: 0.25,
      quelle: 'Kamstrup, Datenblatt MULTICAL 303/403, Spalte „kv q@ 0,25 bar"',
      herkunft: 'tabellenwert',
    };
    check('kv bei 0,25 bar normiert sich auf den doppelten Wert', Math.round(normierterKvs(kamstrup) * 10) / 10, 24.6);
    /*
     * Und die Wirkung, um die es geht: ohne Normierung wäre der Δp um den
     * Faktor 4 zu groß. Bei 6 m³/h sind das 23,8 kPa statt 5,9.
     */
    const ohneNormierung: EinbauteilTyp = { ...kamstrup, kvsBezugsdruck: 1 };
    check(
      'Ohne Bezugsdruck wäre der Druckverlust viermal so groß',
      Math.round(einbauteilDruck(ohneNormierung, 6) / einbauteilDruck(kamstrup, 6)),
      4,
    );

    // Randfälle: kein Durchfluss, kein Druckverlust.
    check('Ohne Volumenstrom kein Druckverlust', einbauteilDruck(v25, 0), 0);

    // Vollständigkeit der Kataloge.
    check('Jedes Umschaltventil hat einen kvs > 0', UMSCHALTVENTILE.filter((x) => !(x.kvs > 0)).length, 0);
    check('Jeder Zähler hat einen kvs > 0', WAERMEMENGENZAEHLER.filter((x) => !(x.kvs > 0)).length, 0);
    check('Jeder Abscheider hat einen kvs > 0', ABSCHEIDER.filter((x) => !(x.kvs > 0)).length, 0);
    check('Jedes Einbauteil nennt seinen Bezugsdruck', [...UMSCHALTVENTILE, ...WAERMEMENGENZAEHLER, ...ABSCHEIDER].filter((x) => !(x.kvsBezugsdruck > 0)).length, 0);
    /*
     * Die Zählerreihe ist absichtlich **nicht monoton**: qp 3,5 hat weniger
     * Δp als qp 2,5, weil diese Variante eine größere Baunennweite hat. Das
     * ist real und darf nicht „geglättet" werden — der Prüfblock hält es
     * fest, damit niemand es für einen Übertragungsfehler hält.
     */
    check(
      'Die Zählerreihe ist bewusst nicht monoton (qp 3,5 hat größeren kvs als qp 6 erwarten ließe)',
      WAERMEMENGENZAEHLER[3].kvs < WAERMEMENGENZAEHLER[4].kvs && WAERMEMENGENZAEHLER[3].kvs > WAERMEMENGENZAEHLER[2].kvs * 2,
      true,
    );
    /*
     * Der Verteiler-Durchflussmesser gehört ausdrücklich **nicht** in die
     * Erzeugerbilanz: er sitzt im ungünstigsten Heizkreis. Bei 100 l/h sind
     * das (0,1/0,9)² = 0,01235 bar = 1,23 kPa.
     */
    check('Verteiler-Durchflussmesser bei 100 l/h: 1,23 kPa', kpa(einbauteilDruck(FBH_DURCHFLUSSMESSER, 0.1)), 1.23);
    check('… und bei 200 l/h bereits 4,94 kPa', kpa(einbauteilDruck(FBH_DURCHFLUSSMESSER, 0.2)), 4.94);
  }

  // =========================================================================
  // 5 · Die Bilanz des Erzeugerkreises
  // =========================================================================
  {
    /*
     * Der Fall aus dem Recherchebericht: 8-kW-Monoblock, 1,5 m³/h, DN 25,
     * mit Trinkwasserumschaltung, Wärmemengenzähler und Magnetitabscheider.
     * Erwartet werden rund 6,9 + 3,6 + 4,0 = 14,5 kPa an Armaturen plus der
     * Gerätewert.
     */
    const monoblock = HEAT_PUMP_CATALOG.find((m) => m.id === 'mono-r290-8');
    check('Das Katalogsgerät „Monoblock R290 8 kW" gibt es', Boolean(monoblock), true);
    check('Es trägt einen hydraulischen Kennwert', Boolean(monoblock?.hydraulics), true);
    check('Und zwar einen Druckverlust — der Monoblock hat keine eingebaute Pumpe', monoblock?.hydraulics?.angabe ?? '—', 'druckverlust');

    const b = erzeugerBilanz({
      model: monoblock,
      flow: 1.5,
      dn: 25,
      umschaltung: true,
      waermezaehler: true,
      abscheiderVorhanden: true,
    });
    check('Vier Posten: Gerät und drei Armaturen', b.posten.length, 4);
    check('Die Posten stehen absteigend nach Druckverlust', b.posten.every((p, i, arr) => i === 0 || arr[i - 1].druck >= p.druck), true);
    check('Jeder Posten nennt seine Grundlage', b.posten.filter((p) => !p.grundlage.trim()).length, 0);
    check('Jeder Posten nennt seine Quelle', b.posten.filter((p) => !p.quelle.trim()).length, 0);
    /*
     * Die Armaturen allein: 6,93 + 3,60 + 4,00 = 14,53 kPa.
     */
    const armaturen = b.posten.filter((p) => p.art !== 'generator').reduce((s, p) => s + p.druck, 0);
    // 6,925 + 3,596 + 4,000 = 14,521 kPa. Die Einzelwerte in kPa gerundet
    // ergeben 14,53 — die Summe der ungerundeten Werte 14,52. Geprüft wird
    // die Summe, nicht die Summe der Rundungen.
    check('Die drei Armaturen summieren sich auf 14,52 kPa', kpa(armaturen), 14.52);
    /*
     * Und die Gesamtsumme liegt in der Größenordnung, die der
     * Recherchebericht für ein Einfamilienhaus nennt: 26 bis 30 kPa
     * einschließlich des Verteiler-Durchflussmessers, der hier nicht
     * mitgezählt wird. Ohne ihn also gut 20 kPa.
     */
    check('Die Bilanz liegt zwischen 15 und 30 kPa', kpa(b.zusatz) >= 15 && kpa(b.zusatz) <= 30, true);
    check('Die Summe ist die Summe der Posten', Math.round(b.zusatz), Math.round(b.posten.reduce((s, p) => s + p.druck, 0)));
    check('Bei Angabeart Druckverlust gibt es keine verfügbare Förderhöhe', b.verfuegbar === undefined, true);

    /*
     * **Die Kernprüfung:** ein Gerät mit Restförderhöhe darf seinen Wert
     * nicht in `zusatz` bekommen. Sonst würde die Pumpenleistung des Geräts
     * als Widerstand gerechnet — der Vorzeichenfehler, vor dem die ganze
     * Unterscheidung schützt.
     */
    const hydrosplit = HEAT_PUMP_CATALOG.find((m) => m.id === 'hydrosplit-r290-9');
    check('Das Hydrosplit-Gerät hat eine eingebaute Pumpe', Boolean(hydrosplit?.contains?.pump), true);
    check('Es trägt deshalb eine Restförderhöhe', hydrosplit?.hydraulics?.angabe ?? '—', 'restfoerderhoehe');
    const r = erzeugerBilanz({
      model: hydrosplit,
      flow: 1.5,
      dn: 25,
      umschaltung: true,
      waermezaehler: true,
      abscheiderVorhanden: true,
    });
    check('Kein Erzeugerposten in der Summe', r.posten.filter((p) => p.art === 'generator').length, 0);
    check('Stattdessen steht die verfügbare Förderhöhe da', (r.verfuegbar ?? 0) > 0, true);
    check('Die Armaturen zählen weiterhin — sie liegen außerhalb des Geräts', kpa(r.zusatz), 14.52);
    check(
      'Ein Hinweis erklärt, dass geprüft und nicht ausgelegt wird',
      r.hinweise.some((h) => /geprüft|Restförderhöhe/.test(h.text)),
      true,
    );

    /*
     * Ohne Gerät gibt es nichts zu bilanzieren — und keinen erfundenen Posten.
     */
    const leer = erzeugerBilanz({ flow: 1.5, dn: 25, umschaltung: false, waermezaehler: false, abscheiderVorhanden: false });
    check('Ohne Gerät und ohne Armaturen: kein Posten', leer.posten.length, 0);
    check('… und keine Summe', leer.zusatz, 0);
    check('… und die Angabeart ist „keine-angabe"', leer.angabe, 'keine-angabe');

    /*
     * **Die stille Null.** Ein Gerät ohne hinterlegten Kennwert muss den
     * bezifferten Fehlbetrag melden — nicht „unbekannt", sondern eine Spanne.
     */
    const ohneKennwert = monoblock ? { ...monoblock, hydraulics: undefined, contains: undefined } : undefined;
    const f = erzeugerBilanz({ model: ohneKennwert, flow: 1.5, dn: 25, umschaltung: false, waermezaehler: false, abscheiderVorhanden: false });
    /*
     * Ohne `hydraulics` **und** ohne `contains` greift die Typklasse — das ist
     * gewollt: der Katalog kennt für jede Bauart einen Wert. Der Fehlbetrag
     * greift nur, wenn auch die Typklasse nichts liefert; geprüft wird
     * deshalb die Spanne selbst.
     */
    const [klein, gross] = fehlbetragSpanne(1.5);
    check('Der Fehlbetrag ist eine Spanne, kein Punkt', gross > klein, true);
    check('Die Untergrenze bei 1,5 m³/h liegt über 3 kPa', kpa(klein) > 3, true);
    check('Die Obergrenze liegt unter 30 kPa', kpa(gross) < 30, true);
    check('Auch ohne eigenen Kennwert entsteht ein Erzeugerposten aus der Typklasse', f.posten.length, 1);

    /*
     * **Doppelzählung.** Ein Gerät, dessen Datenblatt den Abscheider
     * einschließt, bekommt ihn nicht ein zweites Mal.
     */
    const mitAbscheider = monoblock
      ? { ...monoblock, hydraulics: { ...monoblock.hydraulics!, umfang: 'geraet-mit-abscheider' as const } }
      : undefined;
    const d = erzeugerBilanz({ model: mitAbscheider, flow: 1.5, dn: 25, umschaltung: false, waermezaehler: false, abscheiderVorhanden: true });
    check('Der eingeschlossene Abscheider wird nicht doppelt gezählt', d.posten.filter((p) => p.art === 'dirt-separator').length, 0);
    check('Und das steht als Hinweis da', d.hinweise.some((h) => /zweites Mal/.test(h.text)), true);
  }

  // =========================================================================
  // 6 · Der Katalog trägt den Kennwert durchgehend
  // =========================================================================
  {
    check('Jedes Katalogsgerät hat einen hydraulischen Kennwert', HEAT_PUMP_CATALOG.filter((m) => !m.hydraulics).length, 0);
    check(
      'Jeder Kennwert hat seinen Bezugsvolumenstrom',
      HEAT_PUMP_CATALOG.filter((m) => !(m.hydraulics!.bezugsvolumenstrom > 0)).length,
      0,
    );
    check(
      'Jeder Kennwert nennt seine Gültigkeitsuntergrenze',
      HEAT_PUMP_CATALOG.filter((m) => m.hydraulics!.vMin === undefined).length,
      0,
    );
    /*
     * Die Angabeart muss der eingebauten Pumpe folgen — und nur ihr. Eine
     * Ableitung aus der Bauform wäre falsch: Stiebel Eltron baut die Pumpe
     * ein und publiziert trotzdem nur Δp, und Vaillants Hydraulikstation
     * enthält alles außer der Pumpe.
     */
    const falsch = HEAT_PUMP_CATALOG.filter(
      (m) => (m.hydraulics!.angabe === 'restfoerderhoehe') !== Boolean(m.contains?.pump),
    );
    check('Angabeart und eingebaute Pumpe stimmen überein', falsch.length, 0);
    /*
     * Und der Wert wächst mit der Baugröße — nicht weil das eine Naturgesetz
     * wäre, sondern weil der Bezugsvolumenstrom es tut. Ein Katalog, in dem
     * das 16-kW-Gerät weniger Widerstand hätte als das 4-kW-Gerät, hätte
     * seinen Bezugspunkt verloren.
     */
    const klein = findModel('mono-r290-4');
    const gross = findModel('mono-r290-16');
    check('Das große Gerät hat den größeren Bezugsvolumenstrom', (gross?.hydraulics?.bezugsvolumenstrom ?? 0) > (klein?.hydraulics?.bezugsvolumenstrom ?? 0), true);
    check('… und damit den größeren Bezugsdruckverlust', (gross?.hydraulics?.wert ?? 0) > (klein?.hydraulics?.wert ?? 0), true);
    /*
     * Beim **selben** Volumenstrom müssen beide denselben Druckverlust
     * ergeben — die Typklasse hat einen spezifischen Widerstand, keine
     * baugrößenabhängige Kennlinie. Wäre das nicht so, wäre die Skalierung
     * inkonsistent mit dem Bezugspunkt.
     */
    /*
     * Verglichen wird auf ein Promille genau und nicht auf das Pascal: der
     * Bezugswert jedes Geräts ist auf ganze Pascal und sein
     * Bezugsvolumenstrom auf zwei Nachkommastellen gerundet. Beides zusammen
     * verschiebt das Ergebnis um wenige Pascal. Auf gleiche Ganzzahl zu
     * prüfen hieße, die Rundung zu prüfen statt die Beziehung.
     */
    const a15 = skaliert(klein!.hydraulics!, 1.5);
    const b15 = skaliert(gross!.hydraulics!, 1.5);
    check(
      'Beim selben Volumenstrom liefern beide denselben Wert (auf ein Promille)',
      Math.abs(a15 - b15) / a15 < 0.001,
      true,
    );
  }
}
