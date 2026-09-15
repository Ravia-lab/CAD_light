/**
 * Vorbelegung der Anlagentechnik.
 * ---------------------------------------------------------------------------
 * Die Werte sind die, die in einem Einfamilienhaus mit Wärmepumpe am
 * häufigsten stimmen: 35/28 °C Flächenheizung, 3-bar-Sicherheitsventil, vier
 * Personen, kein Frostschutz. Wer nichts ändert, bekommt damit ein plausibles
 * Ergebnis statt einer leeren Maske — und wer etwas ändert, sieht sofort, was
 * sich davon bewegt.
 *
 * Das Modul steht bewusst getrennt vom Store: die Auslegung muss auch mit
 * Dokumenten rechnen können, die vor dieser Ausbaustufe entstanden sind und
 * gar kein Anlagenblatt haben. `plantOf` ist die einzige Stelle, an der
 * entschieden wird, was dann gilt.
 */

import type { BimDocument, PipeRoutingMode, PlantDefinition, SitePlan, Vorhaben } from '../types/bim';

export function emptyPlant(): PlantDefinition {
  return {
    storages: {},
    circuits: {},
    design: {
      flowTemperature: 35,
      returnTemperature: 28,
      dhwTemperature: 55,
      tapTemperature: 45,
      coldWaterTemperature: 10,
      material: 'kupfer',
      // 1,0 m/s ist die Grenze, ab der Strömungsgeräusche in Wohnräumen
      // hörbar werden; 150 Pa/m die übliche Wirtschaftlichkeitsgrenze.
      maxVelocity: 1.0,
      maxGradient: 150,
      glycolFraction: 0,
      glycolKind: 'ethylen',
    },
    safety: {
      staticHeight: 7,
      safetyValvePressure: 3,
      // 70 °C deckt den Störfall einer Wärmepumpe mit Heizstab ab. Bei
      // Kesseln ist 100 °C anzusetzen — dann wächst das Gefäß deutlich.
      maxTemperature: 70,
      existingVessel: 0,
      dhwSecured: true,
    },
    dhw: {
      units: 1,
      occupantsPerUnit: 4,
      comfort: 'normal',
      reheatTime: 2,
      longestBranchContent: 2.5,
    },
    schematic: { components: {}, links: {}, manual: false },
  };
}

/**
 * Das Anlagenblatt eines Dokuments — mit Vorbelegung, wenn keines da ist.
 *
 * Projektdateien aus früheren Fassungen kennen den Abschnitt nicht. Ohne
 * diese Stelle müsste jede Rechenfunktion einzeln damit umgehen, und eine
 * davon würde es vergessen.
 */
export function plantOf(doc: BimDocument): PlantDefinition {
  return doc.plant ?? emptyPlant();
}

/**
 * Vorbelegung des Grundstücks.
 *
 * Sie stand bisher als Literal im Store. Damit war sie für alles unerreichbar,
 * was ohne React läuft — Prüfläufe, Referenzprojekt, Auslegung. Hier steht sie
 * einmal, und der Store nimmt sie von hier.
 *
 * Allgemeines Wohngebiet ist der Regelfall im Einfamilienhausbau — und mit
 * 40 dB(A) nachts der Wert, an dem sich die meisten Aufstellungen entscheiden.
 *
 * Der Grundwasserstand fehlt hier bewusst. Er ist die einzige Angabe des
 * Baugrunds, für die es keinen Regelfall gibt: er hängt am Grundstück und
 * steht im Bodengutachten oder in keiner Unterlage. Eine Vorbelegung wäre
 * eine erfundene Tiefe, und der Export soll „nicht erfasst" berichten können.
 */
export function emptySite(): SitePlan {
  return {
    areaCategory: 'WA',
    state: '',
    soil: 'normal',
    waterProtection: 'none',
    sourceRunHours: 2400,
    elements: {},
    pumps: {},
  };
}

/**
 * Was aus dem Vorhaben folgt.
 * ---------------------------------------------------------------------------
 * **Warum diese Tabelle überhaupt nötig war.** Bis 1.23.0 kannte das Modell
 * den Begriff „Vorhaben" nicht, und in der Folge wurde er an einem Dutzend
 * Stellen einzeln geraten — jede Annahme für sich verteidigbar, zusammen ein
 * Haus, das es nicht gibt: 35/28 (also Flächenheizung, also Neubau) bei der
 * Auslegungstemperatur, ein Mittelwert bei der Luftdichtheit, und ein
 * vorhandenes Ausdehnungsgefäß von 0 l, das im Bestand fast immer falsch ist.
 *
 * **Was hier steht, ist Konvention, keine Norm.** Die Zahlen sind gängige
 * Auslegungspraxis, und sie stehen ausdrücklich als *Vorbelegung* da: Sie
 * werden nur gesetzt, wenn das Vorhaben zum ersten Mal festgelegt wird, und
 * jede von ihnen ist danach frei zu ändern. Normiert ist an dieser Stelle
 * nichts — DIN EN 12831 normt die Heizlast, DIN EN 442-2 den Prüfpunkt der
 * Heizkörperleistung (75/65/20), DIN EN 1264 die Oberflächentemperatur der
 * Flächenheizung. Keine dieser Normen schreibt eine Auslegungstemperatur vor.
 *
 * **Zur Luftdichtheit:** n50 = 1,5 entspricht dem Neubau mit Lüftungsanlage
 * und Dichtheitsnachweis, 3,0 einem Bestandsgebäude mit erneuerten Fenstern.
 * Der unsanierte Altbau liegt darüber, oft bei 4 bis 6 — dafür gibt es hier
 * bewusst keine Stufe: Wer ihn erfasst, misst ihn, und eine geratene Zahl in
 * diesem Bereich verschiebt die Heizlast zweistellig.
 */
export const VORHABEN_VORBELEGUNG: Record<
  Vorhaben,
  {
    vorlauf: number;
    ruecklauf: number;
    /**
     * Luftdichtheit n50 [1/h] — **optional**.
     *
     * Ohne Wert heißt: Für dieses Vorhaben gibt es keine Zahl, die man
     * annehmen darf. Das betrifft genau den unsanierten Bestand: Er liegt
     * zwischen 4 und 6, und jede Stufe darin verschiebt die Heizlast
     * zweistellig. Eine Zahl hinzuschreiben wäre schlimmer als keine, weil
     * sie danach wie eine Angabe aussieht. 3,0 hinzuschreiben — der obere
     * Rand der Tabelle — wäre noch schlimmer: zu dicht angenommen heißt zu
     * kleine Heizlast heißt zu kleines Gerät.
     */
    n50?: number;
    grund: string;
  }
> = {
  neubau: {
    vorlauf: 35,
    ruecklauf: 28,
    n50: 1.5,
    grund: 'Flächenheizung im Neubau; Dichtheit nach Nachweis.',
  },
  sanierung: {
    vorlauf: 55,
    ruecklauf: 45,
    n50: 3,
    grund: 'Vorhandene Heizkörper ohne Ertüchtigung; Dichtheit geschätzt — messen lohnt.',
  },
  teilsanierung: {
    vorlauf: 50,
    ruecklauf: 40,
    n50: 3,
    grund: 'Ertüchtigte Heizflächen an der Wärmepumpe; Dichtheit geschätzt — messen lohnt.',
  },
  /*
   * Der unsanierte Bestand.
   *
   * 75/60 ist die Auslegung, mit der Heizkörperanlagen bis in die neunziger
   * Jahre gebaut wurden, und die Zahl, die auf dem Kessel steht. Sie ist
   * **keine Empfehlung** — sie ist die Beschreibung dessen, was da hängt.
   * Wer eine Wärmepumpe hineinplant, verschiebt sie danach von Hand nach
   * unten und sieht an der Leistung der Heizkörper, was das kostet; genau
   * dafür ist die Umrechnung nach DIN EN 442-2 da.
   *
   * **Zur Luftdichtheit steht hier nichts**, und das ist der Punkt. Der
   * unsanierte Altbau liegt zwischen 4 und 6; jede Stufe darin verschiebt
   * die Heizlast zweistellig. Wer hier 3,0 einträgt — den oberen Rand der
   * Tabelle —, nimmt das Haus dichter an, als es ist, und kommt mit zu
   * kleiner Heizlast und zu kleinem Gerät heraus. Also keine Zahl, sondern
   * ein leeres Feld und ein Satz dazu.
   */
  bestand: {
    vorlauf: 75,
    ruecklauf: 60,
    grund:
      'Vorhandene Heizkörper, Auslegung wie gebaut. Zur Luftdichtheit wird hier nichts angenommen — im unsanierten Bestand liegt sie zwischen 4 und 6, und jede Stufe darin verschiebt die Heizlast zweistellig.',
  },
};

/**
 * Wie wird verlegt, wenn nichts anderes gewählt ist?
 *
 * Die eine Stelle, an der aus dem Vorhaben die Verlegeart folgt. Sie steht
 * hier und nicht in der Oberfläche, weil sie an zwei Stellen gebraucht wird
 * — in der Werkzeugleiste und im Rohrnetzbericht — und zwei Kopien einer
 * Fallunterscheidung genau einmal auseinanderlaufen müssen, damit derselbe
 * Knopf an zwei Stellen verschiedene Netze auslegt.
 *
 * Alles außer dem Neubau wird wandgeführt verlegt: Wo Estrich liegt, wird
 * er nicht für eine Leitung aufgeschnitten.
 */
export function verlegeartAus(vorhaben: Vorhaben | undefined): PipeRoutingMode {
  return vorhaben === undefined || vorhaben === 'neubau' ? 'neubau' : 'sanierung';
}
