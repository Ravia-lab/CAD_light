/**
 * Prüfblock „Primärkreis" — Kälteleistung und Solevolumenstrom.
 *
 * **Worum es geht.** Gleichung (2) des BWP-Leitfadens Hydraulik und der daraus
 * folgende einzustellende Volumenstrom der Primärseite. Die Zahl ist die, die
 * am Sole-Verteiler eingestellt wird; sie fehlte im Programm vollständig.
 *
 * **Warum hier zwei Wege gegeneinander laufen.** Der Volumenstrom wird aus den
 * Stoffwerten gerechnet, nicht aus der Tabelle des Leitfadens. Beide müssen
 * bei reinem Wasser dasselbe ergeben — und genau das steht hier als Prüfung.
 * Eine Rechnung, die ihre Erwartung aus derselben Tabelle holt, die sie prüft,
 * bestätigt nur, dass die Tabelle sich selbst gleicht.
 *
 * **Alle Sollwerte sind von Hand hergeleitet.**
 */

import type { CheckFn } from './typ';
import {
  kaelteleistung,
  primaerauslegung,
  PRIMAER_SPREIZUNG,
  TABELLE1_WASSER,
} from '../../src/lib/primaerkreis';
import { anlagenHinweise } from '../../src/lib/anlagenhinweise';
import { EINSTIEG_ABSTAND, einstiegsvorlauf, inbetriebnahmeblatt } from '../../src/lib/inbetriebnahme';

export function pruefePrimaerkreis(check: CheckFn): void {
  // -------------------------------------------------------------------------
  // 1 · Gleichung (2): Q̇c = Q̇H · (1 − 1/COP)
  // -------------------------------------------------------------------------
  // COP 4, 10 kW Heizleistung: 10 · (1 − 1/4) = 10 · 0,75 = 7,5 kW.
  check('Primärkreis · Kälteleistung bei COP 4', kaelteleistung(10, 4), 7.5, 1e-9);
  // COP 5: 10 · 0,8 = 8,0 kW. Je besser der COP, desto **mehr** muss die
  // Quelle liefern — das ist die Richtung, die man leicht verkehrt herum hat.
  check('Primärkreis · Kälteleistung bei COP 5', kaelteleistung(10, 5), 8.0, 1e-9);
  check('Primärkreis · besserer COP heißt mehr Quellenleistung',
    kaelteleistung(10, 5) > kaelteleistung(10, 4), true);
  // COP 3: 10 · (1 − 1/3) = 6,6667 kW.
  check('Primärkreis · Kälteleistung bei COP 3', kaelteleistung(10, 3), 6.666667, 1e-5);
  /*
   * Identität mit der Entzugsleistung in heatPump.ts: Q̇ · (COP−1)/COP ist
   * dieselbe Zahl, anders geschrieben. Hier nachgerechnet, damit nicht eines
   * Tages zwei verschiedene Zahlen im Programm stehen.
   */
  check('Primärkreis · dasselbe wie (COP−1)/COP',
    kaelteleistung(12, 4.2) - 12 * ((4.2 - 1) / 4.2), 0, 1e-12);
  // Gegenproben: COP 1 und darunter ergeben keine Kälteleistung.
  check('Primärkreis · COP 1 ergibt nichts', kaelteleistung(10, 1), 0, 1e-12);
  check('Primärkreis · COP unter 1 ergibt nichts', kaelteleistung(10, 0.8), 0, 1e-12);

  // -------------------------------------------------------------------------
  // 2 · Die Tabelle des Leitfadens, nachgerechnet
  // -------------------------------------------------------------------------
  /*
   * V̇ [l/(h·kW)] = 3600 · 1000 / (ρ·c_p · ΔT) mit ρ·c_p ≈ 4,19 MJ/(m³·K):
   *   3 K → 3 600 000 / (4190 · 3)  = 286,4 → Leitfaden 287
   *   5 K → 3 600 000 / (4190 · 5)  = 171,8 → Leitfaden 172
   *  10 K → 3 600 000 / (4190 · 10) =  85,9 → Leitfaden  86
   * Geprüft wird die abgeschriebene Tabelle gegen diese Herleitung — fällt
   * beim Abschreiben eine Ziffer, fällt es hier auf.
   */
  for (const [k, soll] of [[3, 286.4], [4, 214.8], [5, 171.8], [6, 143.2], [8, 107.4], [10, 85.9]] as const) {
    check(`Primärkreis · Tabelle 1 bei ${k} K`, TABELLE1_WASSER[k], soll, 1.0);
  }
  // Und die Tabelle ist umgekehrt proportional zur Spreizung: doppelte
  // Spreizung, halber Strom. 5 K → 172, 10 K → 86.
  check('Primärkreis · doppelte Spreizung, halber Strom',
    TABELLE1_WASSER[5] / TABELLE1_WASSER[10], 2.0, 0.01);
  check('Primärkreis · der Leitfaden nennt 3 bis 5 K', `${PRIMAER_SPREIZUNG[0]}–${PRIMAER_SPREIZUNG[1]}`, '3–5');

  // -------------------------------------------------------------------------
  // 3 · Die Auslegung, Zahl für Zahl
  // -------------------------------------------------------------------------
  /*
   * Gerät 10 kW, COP 4, Spreizung 4 K, reines Wasser bei 0 °C.
   *   Kälteleistung  7,50 kW
   *   Volumenstrom   7500 W / (ρ·c_p · 4 K); bei 0 °C ist ρ·c_p rund
   *                  4,21 MJ/(m³·K) → 7500/(4 210 000 · 4) = 4,454e-4 m³/s
   *                  = 1,603 m³/h = 1603 l/h
   *   bezogen        1603 / 7,5 = 214 l/(h·kW) → Tabelle 1 sagt 215
   * Geprüft wird mit Toleranz, weil die Stoffwerte temperaturabhängig sind;
   * die Aussage ist „dieselbe Zahl", nicht „dieselbe Ziffernfolge".
   */
  const a = primaerauslegung(10, 4, 4);
  check('Primärkreis · Kälteleistung der Auslegung', a.kaelteleistungKw, 7.5, 1e-9);
  check('Primärkreis · Volumenstrom rund 1,6 m³/h', a.volumenstromM3h, 1.6, 0.05);
  check('Primärkreis · in Litern', a.volumenstromLh, 1600, 50);
  check('Primärkreis · bezogen auf kW trifft Tabelle 1', a.bezogenLhKw, TABELLE1_WASSER[4], 6);
  check('Primärkreis · Abweichung unter 3 %', Math.abs(a.abweichungProzent ?? 99) < 3, true);
  check('Primärkreis · bei Wasser im Sollbereich kein Hinweis nötig', a.hinweise.length, 0);

  // Die beiden Einheiten müssen zueinander passen — 1 m³ sind 1000 l.
  check('Primärkreis · m³/h und l/h sind dieselbe Größe',
    a.volumenstromLh / a.volumenstromM3h, 1000, 1e-6);
  // Und der bezogene Wert ist der Strom je kW Kälteleistung.
  check('Primärkreis · bezogen = Strom je kW',
    a.bezogenLhKw * a.kaelteleistungKw, a.volumenstromLh, 1e-6);

  // -------------------------------------------------------------------------
  // 4 · Glykol braucht mehr Strom, nicht weniger
  // -------------------------------------------------------------------------
  /*
   * 30 Vol-% Ethylenglykol hat eine kleinere Wärmekapazität als Wasser; für
   * dieselbe Leistung bei derselben Spreizung muss mehr fließen. Der Faktor
   * liegt nach den Stoffwerten bei etwa 1,1 — die Prüfung sagt deshalb nur
   * „mehr, aber nicht absurd viel mehr".
   */
  const sole = primaerauslegung(10, 4, 4, { glykolAnteil: 0.3 });
  check('Primärkreis · Sole braucht mehr Strom als Wasser',
    sole.volumenstromM3h > a.volumenstromM3h, true);
  check('Primärkreis · und zwar zwischen 5 und 25 % mehr',
    sole.volumenstromM3h / a.volumenstromM3h, 1.14, 0.1);
  // Dass die Tabelle für Wasser gilt, muss dastehen — sonst sieht die
  // Abweichung wie ein Fehler aus.
  check('Primärkreis · der Glykolhinweis steht dabei',
    sole.hinweise.some((h) => h.includes('gilt für Wasser')), true);

  // -------------------------------------------------------------------------
  // 5 · Spreizung außerhalb und Grenzfälle
  // -------------------------------------------------------------------------
  const weit = primaerauslegung(10, 4, 8);
  check('Primärkreis · 8 K wird gerechnet', weit.volumenstromM3h > 0, true);
  check('Primärkreis · aber als außerhalb gemeldet',
    weit.hinweise.some((h) => h.includes('3 bis 5 K')), true);
  // Größere Spreizung, kleinerer Strom — und zwar halb so viel bei doppelt so
  // viel Spreizung (4 K → 8 K).
  check('Primärkreis · 8 K ist halb so viel Strom wie 4 K',
    a.volumenstromM3h / weit.volumenstromM3h, 2.0, 0.02);

  const null0 = primaerauslegung(10, 4, 0);
  check('Primärkreis · 0 K ergibt keinen Absturz', Number.isFinite(null0.volumenstromM3h), true);
  check('Primärkreis · und wird gemeldet',
    null0.hinweise.some((h) => h.includes('0 K')), true);

  const schlecht = primaerauslegung(10, 1, 4);
  check('Primärkreis · COP 1 gibt keinen Volumenstrom', schlecht.volumenstromM3h, 0, 1e-12);
  check('Primärkreis · und sagt warum',
    schlecht.hinweise.some((h) => h.includes('Gleichung (2)')), true);

  // 7 K steht nicht in der Tabelle — dann entfällt die Gegenprobe, und das
  // steht dabei, statt dass eine Abweichung von „undefined" gezeigt wird.
  const sieben = primaerauslegung(10, 4, 7);
  check('Primärkreis · 7 K ohne Tabellenwert', sieben.tabelleLhKw === undefined, true);
  check('Primärkreis · Abweichung entfällt', sieben.abweichungProzent === undefined, true);
  check('Primärkreis · und es steht dabei',
    sieben.hinweise.some((h) => h.includes('keinen Wert')), true);
}

/**
 * Prüfblock „Anlagenhinweise" — drei Schwellen aus den BWP- und BDH-Unterlagen.
 *
 * Jede Schwelle wird von beiden Seiten angefasst: knapp darunter darf nichts
 * kommen, knapp darüber muss etwas kommen. Eine Prüfung, die nur den Treffer
 * zeigt, fängt eine Regel nicht ab, die *immer* meldet.
 */
export function pruefeAnlagenhinweise(check: CheckFn): void {
  const grund = { vorlauf: 35, heizgrenze: 15, kreise: [] as never[] };
  /** Die gemeldeten Codes als eine Zeichenkette — `check` nimmt keine Listen. */
  const codes = (a: Parameters<typeof anlagenHinweise>[0]) => anlagenHinweise(a).map((h) => h.code).sort().join(' + ');
  const zahl = (a: Parameters<typeof anlagenHinweise>[0]) => anlagenHinweise(a).length;

  // -------------------------------------------------------------------------
  // 1 · Die 55-°C-Schranke
  // -------------------------------------------------------------------------
  check('Anlagenhinweise · 35 °C Vorlauf ist still', zahl({ ...grund }), 0);
  // Genau 55 °C ist der Einstieg und nicht die Überschreitung.
  check('Anlagenhinweise · 55 °C genau ist still', zahl({ ...grund, vorlauf: 55 }), 0);
  check('Anlagenhinweise · 56 °C meldet', codes({ ...grund, vorlauf: 56 }), 'plant.flow-55');
  check('Anlagenhinweise · und zwar als Hinweis',
    anlagenHinweise({ ...grund, vorlauf: 60 })[0].severity, 'info');
  // Im Bestand steht die Begründung des Praxisratgebers dabei, im Neubau nicht.
  check('Anlagenhinweise · im Bestand nennt es den Ratgeber',
    anlagenHinweise({ ...grund, vorlauf: 60, vorhaben: 'sanierung' })[0].message.includes('Praxisratgeber'), true);
  check('Anlagenhinweise · im Neubau nicht',
    anlagenHinweise({ ...grund, vorlauf: 60, vorhaben: 'neubau' })[0].message.includes('Praxisratgeber'), false);
  check('Anlagenhinweise · der Zirkulationssatz steht immer dabei',
    anlagenHinweise({ ...grund, vorlauf: 60 })[0].message.includes('Zirkulation'), true);

  // -------------------------------------------------------------------------
  // 2 · Spreizung im Trinkwasser-Ladekreis
  // -------------------------------------------------------------------------
  const kreis = (vl: number, rl: number, istTrinkwasser = true) =>
    [{ label: 'Speicherladung', istTrinkwasser, flowTemperature: vl, returnTemperature: rl }];
  // 55/45 sind genau 10 K — die Grenze selbst ist zulässig.
  check('Anlagenhinweise · 10 K im Ladekreis ist still',
    zahl({ ...grund, kreise: kreis(55, 45) }), 0);
  // 55/44 sind 11 K.
  check('Anlagenhinweise · 11 K meldet',
    codes({ ...grund, kreise: kreis(55, 44) }), 'plant.dhw-spread');
  check('Anlagenhinweise · und zwar als Warnung',
    anlagenHinweise({ ...grund, kreise: kreis(55, 44) })[0].severity, 'warning');
  check('Anlagenhinweise · die Spreizung steht in der Meldung',
    anlagenHinweise({ ...grund, kreise: kreis(55, 44) })[0].message.includes('11,0 K'), true);
  check('Anlagenhinweise · der Kreis wird benannt',
    anlagenHinweise({ ...grund, kreise: kreis(55, 44) })[0].message.includes('Speicherladung'), true);
  // Gegenprobe: Ein Heizkreis mit 20 K Spreizung ist nicht gemeint — dort ist
  // eine große Spreizung ein anderer Fall und wird anderswo bewertet.
  check('Anlagenhinweise · ein Heizkreis fällt nicht darunter',
    zahl({ ...grund, kreise: kreis(70, 50, false) }), 0);

  // -------------------------------------------------------------------------
  // 3 · Heizgrenztemperatur
  // -------------------------------------------------------------------------
  check('Anlagenhinweise · 12 °C ist zulässig', zahl({ ...grund, heizgrenze: 12 }), 0);
  check('Anlagenhinweise · 18 °C ist zulässig', zahl({ ...grund, heizgrenze: 18 }), 0);
  check('Anlagenhinweise · 11 °C meldet', codes({ ...grund, heizgrenze: 11 }), 'plant.heating-limit');
  check('Anlagenhinweise · 19 °C meldet', codes({ ...grund, heizgrenze: 19 }), 'plant.heating-limit');
  // Und die Begründung dreht sich mit der Richtung — eine Meldung, die in
  // beiden Fällen dasselbe sagt, hilft bei keinem.
  check('Anlagenhinweise · zu hoch heißt Takten',
    anlagenHinweise({ ...grund, heizgrenze: 20 })[0].message.includes('Takten'), true);
  check('Anlagenhinweise · zu tief heißt morgens kalt',
    anlagenHinweise({ ...grund, heizgrenze: 10 })[0].message.includes('morgens'), true);
  // Fehlt sie, ist das ein Hinweis und keine Warnung: Niemand hat etwas falsch
  // gemacht, es ist nur noch nicht erfasst.
  const ohne = anlagenHinweise({ vorlauf: 35, kreise: [] });
  check('Anlagenhinweise · fehlende Heizgrenze meldet', ohne.map((h) => h.code).join(' + '), 'plant.heating-limit');
  check('Anlagenhinweise · aber nur als Hinweis', ohne[0].severity, 'info');
  check('Anlagenhinweise · mit dem Bereich dabei', ohne[0].message.includes('12 und 18'), true);

  // -------------------------------------------------------------------------
  // 4 · Alle drei zusammen
  // -------------------------------------------------------------------------
  // Drei Befunde aus einer Anlage — und jeder genau einmal.
  check('Anlagenhinweise · drei Befunde zugleich',
    codes({ vorlauf: 60, heizgrenze: 20, kreise: kreis(60, 45) }),
    'plant.dhw-spread + plant.flow-55 + plant.heating-limit');
  // Zwei Trinkwasserkreise mit zu großer Spreizung ergeben zwei Meldungen —
  // nicht eine, die den zweiten verschweigt.
  check('Anlagenhinweise · zwei Kreise, zwei Meldungen',
    anlagenHinweise({
      ...grund,
      kreise: [
        { label: 'A', istTrinkwasser: true, flowTemperature: 60, returnTemperature: 45 },
        { label: 'B', istTrinkwasser: true, flowTemperature: 60, returnTemperature: 40 },
      ],
    }).length, 2);
  // Jede Meldung trägt einen Satz, der etwas erklärt — keine Codes als Text.
  check('Anlagenhinweise · jede Meldung ist ein Satz',
    anlagenHinweise({ vorlauf: 60, heizgrenze: 20, kreise: kreis(60, 45) })
      .every((h) => h.message.length > 60 && h.message.trim().endsWith('.')), true);
}

/**
 * Prüfblock „Inbetriebnahme" — die Einstellwerte, die aus der Auslegung folgen.
 *
 * Der Einstiegswert der Heizkurve ist der Kern: Er ist gerechnet und nicht
 * abgeschrieben, und er hängt an der Übergabeart. Eine Flächenheizung steigt
 * 3 K unter der Auslegung ein, Radiatoren 5 K. Bei gemischter Übergabe gilt
 * der **kleinere** Abstand — sonst bleibt der ungünstigste Raum kalt, und das
 * hieße dann „Optimierung".
 */
export function pruefeInbetriebnahme(check: CheckFn): void {
  // 45/35 °C, Flächenheizung → 45 − 3 = 42 °C.
  check('Inbetriebnahme · Fläche steigt 3 K darunter ein', einstiegsvorlauf(45, 'flaeche'), 42, 1e-9);
  // 55/45 °C, Radiatoren → 55 − 5 = 50 °C.
  check('Inbetriebnahme · Radiator 5 K darunter', einstiegsvorlauf(55, 'radiator'), 50, 1e-9);
  // Gemischt: der kleinere Abstand, also 3 K → 55 − 3 = 52 °C.
  check('Inbetriebnahme · gemischt nimmt den kleineren Abstand', einstiegsvorlauf(55, 'gemischt'), 52, 1e-9);
  // Gegenprobe: gemischt ist **nicht** dasselbe wie Radiator.
  check('Inbetriebnahme · gemischt ist nicht Radiator',
    einstiegsvorlauf(55, 'gemischt') === einstiegsvorlauf(55, 'radiator'), false);
  check('Inbetriebnahme · die Abstände stehen im Modul', `${EINSTIEG_ABSTAND.flaeche}/${EINSTIEG_ABSTAND.radiator}`, '3/5');

  const blatt = inbetriebnahmeblatt({
    vorlauf: 45, ruecklauf: 35, uebergabe: 'flaeche', nassverlegt: true,
    quelle: 'sole', heizgrenze: 15, ladekreisSpreizung: 8, abgeglichen: true,
  });
  check('Inbetriebnahme · der Einstieg steht als Einstellwert',
    blatt.einstellwerte[0]?.wert ?? '', '42 °C Vorlauf');
  check('Inbetriebnahme · jeder Einstellwert nennt seine Quelle',
    blatt.einstellwerte.every((e) => e.quelle.includes('Nr. 62')), true);
  check('Inbetriebnahme · jeder Einstellwert nennt den Rechenweg',
    blatt.einstellwerte.every((e) => e.herleitung.length > 40), true);
  // Nassverlegte Fußbodenheizung: keine Nachtabsenkung — mit Begründung.
  const absenkung = blatt.einstellwerte.find((e) => e.was === 'Nachtabsenkung');
  check('Inbetriebnahme · nassverlegt heißt keine Absenkung', absenkung?.wert ?? '', 'keine');
  check('Inbetriebnahme · und die Begründung nennt den Estrich',
    (absenkung?.herleitung ?? '').includes('Estrich'), true);
  // Der Ladekreis mit 8 K ist in Ordnung; über 10 K wäre er ein Fehlerindiz.
  const lade = blatt.einstellwerte.find((e) => e.was === 'Trinkwasser-Ladekreis');
  check('Inbetriebnahme · 8 K im Ladekreis sind in Ordnung',
    (lade?.herleitung ?? '').includes('zulässigen Bereich'), true);
  check('Inbetriebnahme · über 10 K wird es ein Fehlerindiz',
    inbetriebnahmeblatt({
      vorlauf: 45, ruecklauf: 35, uebergabe: 'flaeche', nassverlegt: true,
      quelle: 'sole', heizgrenze: 15, ladekreisSpreizung: 12, abgeglichen: true,
    }).einstellwerte.find((e) => e.was === 'Trinkwasser-Ladekreis')?.herleitung.includes('Fehlerindiz') ?? false,
    true);

  /*
   * Die Wartungsliste zeigt nur, was zur Bauart gehört. Eine Liste, in der
   * neben dem Verdampfer der Luftwärmepumpe der Schluckbrunnen steht, wird
   * nicht gelesen — deshalb beides als Prüfung: Das Eigene ist da, das Fremde
   * nicht.
   */
  const luft = inbetriebnahmeblatt({
    vorlauf: 55, ruecklauf: 45, uebergabe: 'radiator', nassverlegt: false,
    quelle: 'luft', abgeglichen: false,
  });
  check('Inbetriebnahme · Luft: Verdampfer steht in der Liste',
    luft.wartung.some((z) => z.text.includes('Verdampferlamellen')), true);
  check('Inbetriebnahme · Luft: kein Schluckbrunnen',
    luft.wartung.some((z) => z.text.includes('Schluckbrunnen')), false);
  check('Inbetriebnahme · Luft: kein Gefrierpunkt der Sole',
    luft.wartung.some((z) => z.text.includes('Gefrierpunkt')), false);
  const sole = inbetriebnahmeblatt({
    vorlauf: 35, ruecklauf: 28, uebergabe: 'flaeche', nassverlegt: true,
    quelle: 'sole', abgeglichen: true,
  });
  check('Inbetriebnahme · Sole: Gefrierpunkt messen',
    sole.wartung.some((z) => z.text.includes('Gefrierpunkt')), true);
  check('Inbetriebnahme · Sole: keine Verdampferlamellen',
    sole.wartung.some((z) => z.text.includes('Verdampferlamellen')), false);
  const wasser = inbetriebnahmeblatt({
    vorlauf: 35, ruecklauf: 28, uebergabe: 'flaeche', nassverlegt: true,
    quelle: 'wasser', abgeglichen: true,
  });
  check('Inbetriebnahme · Wasser: Schluckbrunnen auf Verockerung',
    wasser.wartung.some((z) => z.text.includes('Verockerung')), true);
  // Die VDE-Prüfung steht bei jeder Bauart, und zwar am Schluss.
  check('Inbetriebnahme · die VDE-Prüfung steht bei jeder Bauart',
    [luft, sole, wasser].every((b) => b.wartung[b.wartung.length - 1].text.includes('VDE 0701-0702')), true);
  // Jede Bauart hat mehr als die gemeinsamen Zeilen — sonst filterte nichts.
  check('Inbetriebnahme · jede Bauart hat eigene Zeilen',
    [luft, sole, wasser].every((b) => b.wartung.length > 8), true);

  // Fehlt der Abgleich, steht es als Lücke dran — und als erste Vorbedingung.
  check('Inbetriebnahme · fehlender Abgleich ist eine Lücke',
    luft.luecken.some((l) => l.includes('Abgleich')), true);
  check('Inbetriebnahme · und steht als Vorbedingung oben',
    luft.vorbedingungen[0].includes('unbedingte Voraussetzung'), true);
  check('Inbetriebnahme · fehlende Heizgrenze ist eine Lücke',
    luft.luecken.some((l) => l.includes('Heizgrenz')), true);
  check('Inbetriebnahme · mit Abgleich keine solche Lücke',
    sole.luecken.some((l) => l.includes('Abgleich')), false);
  // Und die Schritte fangen mit der Unterversorgung an — das ist die Regel,
  // die dem Monteur gegen den Strich geht und deshalb dastehen muss.
  check('Inbetriebnahme · die Unterversorgung steht im ersten Schritt',
    sole.schritte[0].includes('Unterversorgung'), true);
}
