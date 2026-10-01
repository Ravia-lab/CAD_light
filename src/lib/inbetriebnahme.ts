/**
 * Inbetriebnahme und Optimierung — die fehlende dritte Hälfte.
 *
 * **Worum es geht.** Dieses Programm plant und rechnet. Was *danach* kommt —
 * die Anlage anfahren, die Heizkurve einstellen, warten — stand bisher
 * nirgends, obwohl das BDH/BWP-Infoblatt Nr. 62 dafür eine ungewöhnlich klare
 * Vorschrift hat und obwohl das Programm die Zahlen längst kennt, aus denen
 * die Einstellwerte folgen.
 *
 * **Gerechnet statt abgeschrieben.** Der Einstiegswert der Heizkurve ist nicht
 * „etwas unter der Auslegung", sondern die Auslegungstemperatur minus 3 K bei
 * Flächenheizung und minus 5 K bei Radiatoren — und welche von beiden gilt,
 * steht in den Heizkreisen des Modells. Aus „45/35 °C, Flächenheizung" wird
 * damit „Einstieg bei 42 °C", und nicht ein Merksatz.
 *
 * **Die Wartungsliste zeigt nur, was zur Bauart gehört.** Eine Liste, in der
 * neben dem Verdampfer der Luftwärmepumpe auch der Schluckbrunnen steht, wird
 * nicht gelesen. Welche Zeilen erscheinen, folgt deshalb der Quelle.
 *
 * **Was hier nicht passiert:** Es wird keine Wartungspflicht behauptet und
 * keine Frist gesetzt. Das Infoblatt ist eine Empfehlung zweier Verbände,
 * keine Verordnung; die Fristen stehen im Vertrag und im Datenblatt.
 */

/** Bauart der Wärmequelle — sie entscheidet, welche Wartungszeilen gelten. */
export type Quellenart = 'luft' | 'sole' | 'wasser';

/** Art der Wärmeübergabe, soweit für die Heizkurve maßgebend. */
export type Uebergabeart = 'flaeche' | 'radiator' | 'gemischt';

/** Abstand der Einstiegskurve unter der Auslegung [K], Infoblatt Nr. 62. */
export const EINSTIEG_ABSTAND: Readonly<Record<'flaeche' | 'radiator', number>> = {
  flaeche: 3,
  radiator: 5,
};

export interface Anlagenstand {
  /** Auslegungsvorlauf [°C]. */
  vorlauf: number;
  /** Auslegungsrücklauf [°C]. */
  ruecklauf: number;
  /** Übergabeart, aus den Heizkreisen abgeleitet. */
  uebergabe: Uebergabeart;
  /** Liegt nassverlegte Fußbodenheizung vor? Dann keine Nachtabsenkung. */
  nassverlegt: boolean;
  quelle: Quellenart;
  /** Heizgrenztemperatur [°C], falls erfasst. */
  heizgrenze?: number;
  /** Spreizung im Trinkwasser-Ladekreis [K], falls ein solcher ausgelegt ist. */
  ladekreisSpreizung?: number;
  /** Liegt ein hydraulischer Abgleich vor (Einstellwerte gerechnet)? */
  abgeglichen: boolean;
}

export interface Einstellwert {
  was: string;
  wert: string;
  /** Woraus die Zahl folgt — der Rechenweg in einem Satz. */
  herleitung: string;
  quelle: string;
}

export interface Pruefzeile {
  text: string;
  /** Nur bei dieser Bauart; fehlt = bei jeder. */
  nur?: Quellenart;
}

export interface Inbetriebnahmeblatt {
  /** Was vor dem ersten Einstellen erledigt sein muss. */
  vorbedingungen: string[];
  einstellwerte: Einstellwert[];
  /** Reihenfolge der Schritte beim Anfahren. */
  schritte: string[];
  wartung: Pruefzeile[];
  /** Was offen bleibt, weil es im Modell nicht steht. */
  luecken: string[];
}

const QUELLE_62 = 'Infoblatt Nr. 62, BDH/BWP, März 2019';

/**
 * Der Einstiegswert der Heizkurve.
 *
 * Bei gemischter Übergabe gilt der **kleinere** Abstand: Die Anlage muss die
 * Radiatoren noch versorgen, und 3 K unter Auslegung ist die vorsichtigere
 * Absenkung. Wer tiefer einsteigen will, tut es von Hand — ein Programm, das
 * hier den größeren Abstand nimmt, lässt im ungünstigsten Raum ein Zimmer
 * kalt und nennt es Optimierung.
 */
export function einstiegsvorlauf(vorlauf: number, uebergabe: Uebergabeart): number {
  const abstand = uebergabe === 'radiator' ? EINSTIEG_ABSTAND.radiator : EINSTIEG_ABSTAND.flaeche;
  return vorlauf - abstand;
}

/** Die vollständigen Wartungszeilen — gefiltert wird erst im Blatt. */
export const WARTUNG: readonly Pruefzeile[] = [
  { text: 'Anlagendruck ablesen und mit dem Sollwert vergleichen' },
  { text: 'Sicherheitsventil anlüften und auf Schließen prüfen' },
  { text: 'Vordruck des Ausdehnungsgefäßes bei drucklosem Heizkreis messen' },
  { text: 'Filter und Schmutzfänger reinigen' },
  { text: 'Verschraubungen und Armaturen auf Dichtheit ansehen' },
  { text: 'Betriebs- und Störmeldungen des Reglers auslesen und notieren' },
  { text: 'Zählerstände für Wärme und Strom notieren — ohne sie gibt es keine Arbeitszahl' },
  { text: 'Verdampferlamellen reinigen', nur: 'luft' },
  { text: 'Kondensatablauf auf Durchgang und Frostfreiheit prüfen', nur: 'luft' },
  { text: 'Lüfter auf Laufgeräusch und Lagerspiel prüfen', nur: 'luft' },
  { text: 'Aufstellung auf Verschmutzung, Laub und Schneeverwehung ansehen', nur: 'luft' },
  { text: 'Soledruck ablesen', nur: 'sole' },
  { text: 'Gefrierpunkt des Solegemisches messen — nicht schätzen', nur: 'sole' },
  { text: 'Soleverteiler und Absperrungen auf Dichtheit und Stellung prüfen', nur: 'sole' },
  { text: 'Brunnenwasserqualität prüfen lassen', nur: 'wasser' },
  { text: 'Schluckbrunnen auf Verockerung ansehen', nur: 'wasser' },
  { text: 'Filter vor dem Verdampfer reinigen', nur: 'wasser' },
  { text: 'Elektrische Prüfung nach VDE 0701-0702 zum Abschluss' },
];

export function inbetriebnahmeblatt(a: Anlagenstand): Inbetriebnahmeblatt {
  const luecken: string[] = [];

  // --- Vorbedingungen -------------------------------------------------------
  const vorbedingungen = [
    a.abgeglichen
      ? 'Der hydraulische Abgleich ist gerechnet und dokumentiert — die Einstellwerte stehen in dieser Mappe.'
      : 'Der hydraulische Abgleich ist unbedingte Voraussetzung und liegt noch nicht vor. Ohne ihn verteilt jede Absenkung der Heizkurve die Wärme nur anders falsch.',
    'Alle Raumtemperaturregler vollständig öffnen — eingestellt wird bei offenen Ventilen.',
    'Anlage entlüften und auf Betriebsdruck bringen.',
  ];
  if (!a.abgeglichen) luecken.push('Hydraulischer Abgleich fehlt');

  // --- Einstellwerte --------------------------------------------------------
  const einstieg = einstiegsvorlauf(a.vorlauf, a.uebergabe);
  const abstand = a.vorlauf - einstieg;
  const uebergabeText =
    a.uebergabe === 'radiator' ? 'Radiatoren' : a.uebergabe === 'flaeche' ? 'Flächenheizung' : 'gemischte Übergabe';
  const einstellwerte: Einstellwert[] = [
    {
      was: 'Heizkurve, Einstieg',
      wert: `${einstieg} °C Vorlauf`,
      herleitung:
        `Auslegung ${a.vorlauf}/${a.ruecklauf} °C, ${uebergabeText} → mindestens ${abstand} K darunter einsteigen ` +
        'und in kleinen Schritten anheben, bis die Räume ihre Solltemperatur halten.' +
        (a.uebergabe === 'gemischt'
          ? ' Bei gemischter Übergabe gilt der kleinere Abstand von 3 K — maßgebend ist der ungünstigste Raum.'
          : ''),
      quelle: QUELLE_62,
    },
    {
      was: 'Heizgrenztemperatur',
      wert: a.heizgrenze !== undefined ? `${a.heizgrenze} °C` : 'nicht erfasst',
      herleitung:
        '12 °C bei gutem Dämmstandard, 18 °C im unsanierten Bestand. Zu hoch heißt Takten im Frühjahr, ' +
        'zu tief heißt morgens kalt.',
      quelle: QUELLE_62,
    },
    {
      was: 'Nachtabsenkung',
      wert: a.nassverlegt ? 'keine' : 'möglich',
      herleitung: a.nassverlegt
        ? 'Nassverlegte Fußbodenheizung: Die Masse des Estrichs braucht länger zum Wiederaufheizen, als die Absenkung einspart.'
        : 'Ohne nassverlegte Flächenheizung ist eine Absenkung möglich; bei einer Wärmepumpe bringt sie selten etwas, weil die Wiederaufheizung die höchste Vorlauftemperatur des Tages verlangt.',
      quelle: QUELLE_62,
    },
  ];
  if (a.heizgrenze === undefined) luecken.push('Heizgrenztemperatur nicht erfasst');

  if (a.ladekreisSpreizung !== undefined) {
    const zuViel = a.ladekreisSpreizung > 10;
    einstellwerte.push({
      was: 'Trinkwasser-Ladekreis',
      wert: `${a.ladekreisSpreizung.toFixed(1).replace('.', ',')} K Spreizung`,
      herleitung: zuViel
        ? 'Über 10 K ist ein Fehlerindiz: Übertragerfläche des Speichers zu klein (mindestens 0,25 m² je kW) oder Ladepumpe zu schwach.'
        : 'Unter 10 K — im zulässigen Bereich. Im Betrieb nachmessen, nicht nur der Auslegung glauben.',
      quelle: `${QUELLE_62}; BWP-Leitfaden Hydraulik, August 2023`,
    });
  } else {
    luecken.push('Kein Trinkwasser-Ladekreis ausgelegt');
  }

  // --- Schritte -------------------------------------------------------------
  const schritte = [
    'Mit niedrig eingestellter Heizkurve anfahren — die anfängliche Unterversorgung ist erwünscht: Sie wird gemeldet, eine Überwärmung nicht.',
    `Einstieg bei ${einstieg} °C Vorlauf im Auslegungspunkt.`,
    'Über mehrere kalte Tage beobachten, welcher Raum zuerst zu kalt bleibt — das ist der maßgebende Raum.',
    'Heizkurve in kleinen Schritten anheben, bis dieser Raum seine Solltemperatur hält. Nicht weiter.',
    'Erst danach die Einzelräume über die Thermostatventile begrenzen.',
    'Zählerstände, Heizkurve, Heizgrenze und Spreizungen schriftlich festhalten — sonst ist beim nächsten Besuch nicht zu sagen, was geändert wurde.',
  ];

  // --- Wartung --------------------------------------------------------------
  const wartung = WARTUNG.filter((z) => z.nur === undefined || z.nur === a.quelle);

  return { vorbedingungen, einstellwerte, schritte, wartung, luecken };
}
