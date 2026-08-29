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

import type { BimDocument, PlantDefinition, SitePlan } from '../types/bim';

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
