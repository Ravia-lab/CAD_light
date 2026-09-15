/**
 * Prüfblock „Vorhaben" — was aus Neubau, Sanierung und Teilsanierung folgt.
 *
 * **Der Befund, den dieser Block festhält.** Bis 1.23.0 kannte das Modell den
 * Begriff „Vorhaben" nicht. Er wurde deshalb an einem Dutzend Stellen einzeln
 * geraten: die Auslegungstemperatur mit 35/28 (also Flächenheizung, also
 * Neubau), die Luftdichtheit mit einem Mittelwert, das vorhandene
 * Ausdehnungsgefäß mit 0 l. Jede Annahme für sich verteidigbar — zusammen
 * beschrieben sie ein Haus, das es nicht gibt: ein Bestandsgebäude mit
 * Heizkörpern von 1985, das mit 35 °C Vorlauf und Neubaudichtheit gerechnet
 * wurde. Die Heizlast fiel zu niedrig aus, die Wärmepumpe eine Nummer zu
 * klein, und die Heizkörper wären an der Norm-Außentemperatur kalt geblieben.
 *
 * `VORHABEN_VORBELEGUNG` ist die Antwort darauf: eine Tabelle, aus der alle
 * diese Annahmen gemeinsam folgen. Damit sie das leisten kann, muss sie in
 * sich stimmen — und genau das prüft dieser Block.
 *
 * **Was hier geprüft wird und was nicht.** Geprüft werden die Tabelle und die
 * Zusagen, die das Anlagenblatt über sie macht: dass jedes Vorhaben eine
 * rechenbare Spreizung hat, dass der Bestand über dem Neubau liegt, dass
 * jeder Eintrag einen Satz mitbringt, der im Panel angezeigt werden kann, und
 * dass die Zahl, die das Panel als Vorbelegung zeigt, dieselbe ist, mit der
 * `systemtemperatur` anschließend rechnet.
 *
 * **Nicht** geprüft wird die Store-Aktion `setVorhaben` — ob sie nur beim
 * ersten Festlegen vorbelegt, ist eine Frage des Zustands und gehört in den
 * Store-Prüfblock. Und nicht geprüft wird, ob 55/45 die *richtige* Auslegung
 * für ein bestimmtes Haus ist: Die Zahlen sind gängige Auslegungspraxis und
 * ausdrücklich Konvention, keine Norm. Prüfbar ist ihre Widerspruchsfreiheit,
 * nicht ihre Wahrheit.
 *
 * **Die Sollwerte stehen von Hand da.** Eine Prüfung, die ihre Erwartung aus
 * derselben Tabelle holt, die sie prüft, bestätigt nur, dass die Tabelle sich
 * selbst gleicht. Wo unten eine Zahl steht, ist sie nachgerechnet und im
 * Kommentar hergeleitet; wer sie ändert, muss die Herleitung mitändern.
 */

import type { CheckFn } from './typ';

/**
 * Ein fehlender Wert als eigene Aussage statt als `undefined`.
 *
 * `CheckFn` nimmt nur Zahlen, Zeichenketten und Wahrheitswerte — mit gutem
 * Grund: `undefined` gegen `undefined` zu prüfen bestünde auch dann, wenn
 * die ganze Tabelle fehlte. `'fehlt'` ist dagegen eine Angabe, die im
 * Protokoll steht und die man liest.
 */
const angabe = <T extends string | number | boolean>(wert: T | undefined): T | 'fehlt' =>
  wert === undefined ? 'fehlt' : wert;
import type { Vorhaben } from '../../src/types/bim';
import { VORHABEN_LABELS } from '../../src/types/bim';
import { VORHABEN_VORBELEGUNG } from '../../src/lib/plantDefaults';
import {
  HEIZKOERPER_MINDESTRUECKLAUF,
  HEIZKOERPER_MINDESTVORLAUF,
  KLEINSTE_SPREIZUNG,
  SYSTEMTEMPERATUR_VORGABE,
  kreistemperatur,
  systemtemperatur,
} from '../../src/lib/systemtemperatur';

/** Die drei Vorhaben von Hand — nicht `Object.keys`, siehe Kopfkommentar. */
const ARTEN: readonly Vorhaben[] = ['neubau', 'sanierung', 'teilsanierung', 'bestand'];

/**
 * Grenzen, in denen eine Auslegungsspreizung liegen darf [K].
 *
 * **Unten 5 K.** `KLEINSTE_SPREIZUNG` ist 2 K, aber das ist die Grenze, ab
 * der die Rechnung nicht mehr absurd wird, und keine Auslegung. Eine
 * Vorbelegung mit 3 K Spreizung hieße V̇ = Q/(1,163·3) — bei 10 kW sind das
 * 2,9 m³/h und damit eine Verteilleitung in DN 32, wo sonst DN 20 genügt.
 * Unter 5 K legt niemand vorsorglich aus.
 *
 * **Oben 15 K.** Darüber wird der Rücklauf so kalt, dass er bei einer
 * Wärmepumpe nicht mehr erreichbar ist: 55/40 setzt voraus, dass jede
 * Heizfläche 15 K abkühlt, und das tut im Teillastfall keine.
 */
const SPREIZUNG_MIN = 5;
const SPREIZUNG_MAX = 15;

/**
 * Grenzen der Luftdichtheit n50 [1/h].
 *
 * **Unten 0,6.** Das ist der Passivhauswert; darunter gibt es kein Gebäude,
 * das ohne Messung so angenommen werden dürfte.
 *
 * **Oben 3,0.** Der unsanierte Altbau liegt darüber, oft bei 4 bis 6 — und
 * dafür gibt es in der Tabelle bewusst keine Stufe. Der Grund steht in
 * `plantDefaults`: Eine geratene Zahl in diesem Bereich verschiebt die
 * Heizlast zweistellig, und wer den Altbau erfasst, misst ihn. Eine
 * Vorbelegung über 3,0 wäre die Rückkehr genau dieses Fehlers.
 */
const N50_MIN = 0.6;
const N50_MAX = 3.0;

export function pruefeVorhaben(check: CheckFn): void {
  // -------------------------------------------------------------------------
  // Die Tabelle ist vollständig
  // -------------------------------------------------------------------------
  //
  // Ein fehlender Eintrag fällt ohne diese Zeilen erst zur Laufzeit auf, und
  // zwar als `undefined.vorlauf` im Anlagenblatt — also als weißes Panel
  // statt als Meldung.
  check('Vier Vorhaben, nicht mehr und nicht weniger', Object.keys(VORHABEN_VORBELEGUNG).length, 4);
  check('Vier Beschriftungen dazu', Object.keys(VORHABEN_LABELS).length, 4);
  for (const art of ARTEN) {
    check(`${art}: steht in der Vorbelegung`, VORHABEN_VORBELEGUNG[art] !== undefined, true);
    check(`${art}: hat eine Beschriftung`, (VORHABEN_LABELS[art] ?? '').trim().length > 0, true);
  }
  // Knöpfe mit derselben Aufschrift wären im Panel nicht bedienbar.
  check(
    'Die vier Beschriftungen sind unterscheidbar',
    new Set(ARTEN.map((a) => VORHABEN_LABELS[a])).size,
    4,
  );

  // -------------------------------------------------------------------------
  // Jeder Eintrag ist für sich rechenbar
  // -------------------------------------------------------------------------
  for (const art of ARTEN) {
    const v = VORHABEN_VORBELEGUNG[art];
    const spreizung = v.vorlauf - v.ruecklauf;

    // Ein Rücklauf über dem Vorlauf ergibt eine negative Spreizung. Die wird
    // in `systemtemperatur` auf 2 K gekappt — lautlos, und ab da rechnet das
    // ganze Blatt mit einem Volumenstrom, den niemand mehr zuordnen kann.
    check(`${art}: Vorlauf liegt über dem Rücklauf`, v.vorlauf > v.ruecklauf, true);
    check(`${art}: Spreizung mindestens ${SPREIZUNG_MIN} K`, spreizung >= SPREIZUNG_MIN, true);
    check(`${art}: Spreizung höchstens ${SPREIZUNG_MAX} K`, spreizung <= SPREIZUNG_MAX, true);
    // Wird die Spreizung gekappt, zeigt das Panel eine andere Zahl an, als
    // gerechnet wird — genau die Doppeldeutigkeit, die dort beseitigt wurde.
    check(`${art}: Spreizung wird nicht gekappt`, spreizung > KLEINSTE_SPREIZUNG, true);

    /*
     * n50 darf **fehlen** — und im unsanierten Bestand muss es das sogar.
     *
     * Dort liegt der Wert zwischen 4 und 6, also außerhalb dieser Tabelle,
     * und jede Stufe darin verschiebt die Heizlast zweistellig. Eine Zahl
     * einzutragen wäre eine Angabe, die keine ist; 3,0 einzutragen — den
     * oberen Rand — nähme das Haus dichter an, als es ist, und führte auf
     * zu kleine Heizlast und zu kleines Gerät. Geprüft wird deshalb beides:
     * dass ein vorhandener Wert im zulässigen Band liegt, und dass beim
     * Bestand keiner steht.
     */
    if (v.n50 !== undefined) {
      check(`${art}: n50 nicht unter ${N50_MIN}`, v.n50 >= N50_MIN, true);
      check(`${art}: n50 nicht über ${N50_MAX}`, v.n50 <= N50_MAX, true);
      check(`${art}: n50 ist eine Zahl`, Number.isFinite(v.n50), true);
    } else {
      check(`${art}: darf ohne n50 stehen — nur der Bestand`, art, 'bestand');
    }

    // Der Satz steht im Anlagenblatt unter der Auswahl. Ein leerer Eintrag
    // hinterließe dort eine Lücke, die aussieht wie ein Ladefehler; ein
    // Halbsatz ohne Punkt sieht aus wie abgeschnitten.
    check(`${art}: Begründungssatz ist nicht leer`, v.grund.trim().length > 0, true);
    check(`${art}: Begründungssatz trägt Inhalt`, v.grund.trim().length >= 20, true);
    check(`${art}: Begründungssatz endet als Satz`, v.grund.trim().endsWith('.'), true);
  }

  // -------------------------------------------------------------------------
  // Die Einträge stehen in der richtigen Reihenfolge zueinander
  // -------------------------------------------------------------------------
  //
  // **Warum das eine eigene Prüfung ist.** Jeder Eintrag kann für sich
  // plausibel sein und die Tabelle trotzdem falsch: Stünde beim Neubau 55/45
  // und bei der Sanierung 35/28, wäre jede Zeile oben in Ordnung und die
  // Tabelle genau verkehrt herum. Der Bestand hat die älteren, kleineren
  // Heizflächen und braucht deshalb die höhere Temperatur — das ist die
  // Aussage, für die es die Tabelle gibt.
  const neubau = VORHABEN_VORBELEGUNG.neubau;
  const sanierung = VORHABEN_VORBELEGUNG.sanierung;
  const teil = VORHABEN_VORBELEGUNG.teilsanierung;

  check('Sanierung fährt heißer als der Neubau', sanierung.vorlauf > neubau.vorlauf, true);
  check('… auch im Rücklauf', sanierung.ruecklauf > neubau.ruecklauf, true);
  check('Teilsanierung fährt heißer als der Neubau', teil.vorlauf > neubau.vorlauf, true);
  check('… auch im Rücklauf', teil.ruecklauf > neubau.ruecklauf, true);
  // Die Teilsanierung ist der Fall „ertüchtigte Heizflächen": zwischen
  // beiden, nicht daneben. Läge sie über der Sanierung, wäre die
  // Ertüchtigung wirkungslos und die Stufe überflüssig.
  check('Teilsanierung bleibt unter der Sanierung', teil.vorlauf < sanierung.vorlauf, true);

  check('Der Neubau ist dichter als der Bestand', (neubau.n50 ?? 0) < (sanierung.n50 ?? 0), true);
  // Beide Bestandsfälle nehmen dieselbe Dichtheit an — die Heizflächen sind
  // ertüchtigt, die Gebäudehülle deshalb noch lange nicht.
  check('Sanierung und Teilsanierung nehmen dieselbe Dichtheit an', angabe(teil.n50), angabe(sanierung.n50));

  /*
   * **Der unsanierte Bestand ist der heißeste Fall — und der einzige ohne
   * Dichtheitsannahme.**
   *
   * 75/60 ist keine Empfehlung, sondern die Auslegung, mit der
   * Heizkörperanlagen bis in die neunziger Jahre gebaut wurden. Stünde hier
   * ein niedrigerer Wert als bei der Sanierung, rechnete das Programm einen
   * Heizkörper von 1975 mit der Temperatur eines ertüchtigten — nach
   * DIN EN 442-2 rund 40 Prozent weniger Leistung, als er abgibt, und der
   * doppelte Volumenstrom im Rohrnetz.
   */
  const bestand = VORHABEN_VORBELEGUNG.bestand;
  check('Der unsanierte Bestand fährt heißer als die Sanierung', bestand.vorlauf > sanierung.vorlauf, true);
  check('… auch im Rücklauf', bestand.ruecklauf > sanierung.ruecklauf, true);
  check('Und das sind 75/60 °C', `${bestand.vorlauf}/${bestand.ruecklauf}`, '75/60');
  check('Zur Luftdichtheit steht dort bewusst nichts', angabe(bestand.n50), 'fehlt');

  // -------------------------------------------------------------------------
  // Die Zusagen, die das Anlagenblatt über die Tabelle macht
  // -------------------------------------------------------------------------

  /*
   * **„Ohne Vorhaben bleibt es bei 35/28 °C."**
   *
   * Dieser Satz steht im Panel, solange nichts gewählt ist. Er stimmt nur,
   * solange die Vorgabe des Anlagenblatts und die Neubauzeile dieselbe Zahl
   * nennen. Liefen sie auseinander, verspräche das Panel einen Zustand, den
   * das Programm nicht herstellt — und der Anwender suchte den Unterschied
   * zwischen „noch nicht festgelegt" und „Neubau" dort, wo keiner ist.
   */
  check('Ohne Vorhaben gilt der Neubau-Vorlauf', SYSTEMTEMPERATUR_VORGABE.vorlauf, neubau.vorlauf);
  check('… und der Neubau-Rücklauf', SYSTEMTEMPERATUR_VORGABE.ruecklauf, neubau.ruecklauf);
  check('Und das sind 35/28 °C', `${neubau.vorlauf}/${neubau.ruecklauf}`, '35/28');

  /*
   * **Die Teilsanierung trifft den Heizkörper-Mindestwert genau.**
   *
   * 50/40 ist in `systemtemperatur` die Untergrenze, auf die ein
   * Heizkörperkreis angehoben wird. Dass die Teilsanierung dieselbe Zahl
   * nennt, ist kein Zufall, sondern ihre Bedeutung: „ertüchtigte Heizflächen
   * an der Wärmepumpe" ist genau der Punkt, an dem ein Heizkörper gerade
   * noch mit Wärmepumpentemperatur auskommt. Stünde hier 45/38, würde die
   * Anlage die Vorbelegung sofort wieder auf 50/40 anheben — das Panel
   * zeigte dann eine Vorbelegung an, die im selben Blatt nicht gilt.
   */
  check('Teilsanierung trifft den Heizkörper-Mindestvorlauf', teil.vorlauf, HEIZKOERPER_MINDESTVORLAUF);
  check('… und den Mindestrücklauf', teil.ruecklauf, HEIZKOERPER_MINDESTRUECKLAUF);

  /*
   * **Was das Panel als Vorbelegung zeigt, ist auch das, womit gerechnet
   * wird — solange im Modell sonst nichts steht.**
   *
   * Frisch festgelegtes Vorhaben, noch kein Raum bestückt: Dann darf zwischen
   * dem Eingabefeld und der Zeile „gerechnet wird mit" kein Unterschied
   * stehen, sonst weist das Blatt von der ersten Sekunde an eine Abweichung
   * aus, die keine ist.
   */
  for (const art of ARTEN) {
    const v = VORHABEN_VORBELEGUNG[art];
    const blatt = { vorlauf: v.vorlauf, ruecklauf: v.ruecklauf };
    const ohneKreise = systemtemperatur({ anlagenblatt: blatt });
    check(`${art}: gerechnet wird mit dem Blattvorlauf`, ohneKreise.vorlauf, v.vorlauf);
    check(`${art}: … und dem Blattrücklauf`, ohneKreise.ruecklauf, v.ruecklauf);
    check(`${art}: … mit der angezeigten Spreizung`, ohneKreise.spreizung, v.vorlauf - v.ruecklauf);
    check(`${art}: Herkunft ist das Anlagenblatt`, ohneKreise.herkunft, 'anlagenblatt');
  }

  /*
   * **Und was passiert, sobald ein Heizkörper im Haus steht.**
   *
   * Das ist der Fall, für den das Panel die zweite Zeile bekommen hat. Beim
   * Neubau *muss* die Abweichung auffallen: 35/28 im Blatt, 50/40 gerechnet,
   * 7 K gegen 10 K. Über V̇ = Q/(1,163·Δϑ) sind das 10/7 = 1,43, also 43 %
   * Volumenstrom Unterschied — die Zahl, die bis 1.23.0 in sechs Dateien
   * unbemerkt auseinanderlief.
   *
   * Bei Sanierung und Teilsanierung darf sie *nicht* auffallen: Beide liegen
   * schon auf oder über dem Mindestwert, da ist nichts anzuheben. Eine
   * Warnung, die auch dann käme, würde nach dem dritten Projekt weggeklickt.
   */
  for (const art of ARTEN) {
    const v = VORHABEN_VORBELEGUNG[art];
    const blatt = { vorlauf: v.vorlauf, ruecklauf: v.ruecklauf };
    const mitHeizkoerper = systemtemperatur({
      anlagenblatt: blatt,
      kreise: [{ label: 'Heizkörper', ...kreistemperatur('heizkoerper', blatt) }],
    });
    const erwartetAngehoben = art === 'neubau';
    check(
      `${art}: Heizkörper hebt an?`,
      mitHeizkoerper.herkunft === 'angehoben',
      erwartetAngehoben,
    );
    check(
      `${art}: Begründung ist nicht leer`,
      mitHeizkoerper.begruendung.trim().length > 0,
      true,
    );
  }

  const neubauMitHeizkoerper = systemtemperatur({
    anlagenblatt: { vorlauf: neubau.vorlauf, ruecklauf: neubau.ruecklauf },
    kreise: [
      {
        label: 'Heizkörper',
        ...kreistemperatur('heizkoerper', { vorlauf: neubau.vorlauf, ruecklauf: neubau.ruecklauf }),
      },
    ],
  });
  check('Neubau + Heizkörper wird auf 50 °C angehoben', neubauMitHeizkoerper.vorlauf, 50);
  check('… Rücklauf auf 40 °C', neubauMitHeizkoerper.ruecklauf, 40);
  check('… Spreizung 10 K statt 7 K', neubauMitHeizkoerper.spreizung, 10);
  // Der Satz landet im Panel im hervorgehobenen Kasten. Er muss beide
  // Zahlenpaare nennen, sonst weiß der Leser nicht, wovon er abweicht.
  check(
    '… und die Begründung nennt beide Temperaturen',
    neubauMitHeizkoerper.begruendung.includes('35/28') && neubauMitHeizkoerper.begruendung.includes('50/40'),
    true,
  );
}
