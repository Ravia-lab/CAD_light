/**
 * Welche Musterlösung ist das? — die Zuordnung ohne Auswahlliste.
 * ---------------------------------------------------------------------------
 * **Warum es diese Datei gibt.** Bis 1.50.1 stand im Anlagenblatt eine Liste
 * der Katalogvorlagen, aus der man eine übernahm. Sie war als irreführend
 * gemeldet und ist in 1.51.0 herausgeflogen — zu Recht: Sie verlangte, eine
 * Lösung wiederzuerkennen, bevor man sagen durfte, was man baut.
 *
 * Mit ihr ist aber mehr verschwunden als die Liste. Seither rief
 * `schlageSchemaVor` **niemand mehr** auf, und `uebernehmeSchemaVorlage` im
 * Speicher hatte gar keinen Aufrufer. Der Katalog — elf BWP-Schemata mit über
 * fünfzig belegten Bedingungen — war vom Programm abgehängt, und der Leitfaden
 * versprach weiter eine Liste, die es nicht mehr gibt. Gemerkt hat es kein
 * Prüflauf, weil der Prüfblock `schlageSchemaVor` direkt aufruft und damit an
 * der Oberfläche vorbeiprüft.
 *
 * **Die Lösung ist nicht, die Liste zurückzuholen.** Die Antworten im
 * Anlagenblatt sagen bereits, was gebaut wird; daraus lässt sich die Vorlage
 * **ableiten**. Der Anwender wählt nichts aus, er liest nur, was herauskommt:
 * „Gebaut nach BWP-H-03". Das ist die Auskunft, die jeder braucht, der ein
 * fremdes Fließbild in die Hand bekommt — und sie kostet keine Bedienung.
 *
 * **Eingetragenes schlägt Abgeleitetes.** Steht in der Datei schon eine
 * `vorlageId` — aus einem älteren Projekt oder weil jemand sie bewusst gesetzt
 * hat —, gilt sie. Das ist dieselbe Regel wie bei den sieben Antworten seit
 * 1.51.0: Was eingetragen ist, wird nicht still überschrieben. Weicht die
 * Anlage davon ab, steht die Abweichung daneben, nicht an ihrer Stelle.
 */

import type { PlantDefinition } from '../types/bim';
import type { PlantDesignResult } from './plantDesign';
import { SCHEMA_KATALOG, schemaVorlage, type SchemaVorlage } from './schemaKatalog';
import { anlagenMerkmale, bewerte, schlageSchemaVor, type Abweichung, type Passung } from './schemaAuswahl';

export interface Zuordnung {
  vorlage: SchemaVorlage;
  /**
   * Woher die Zuordnung stammt.
   *
   * `eingetragen` — sie steht in der Datei und gilt, auch wenn sie nicht
   * passt. `abgeleitet` — das Programm hat sie aus der Anlage bestimmt.
   */
  quelle: 'eingetragen' | 'abgeleitet';
  passung: Passung;
  abweichungen: Abweichung[];
  /** Ein Satz für die Oberfläche. */
  satz: string;
}

/**
 * Die Vorlage zu dieser Anlage.
 *
 * `undefined` heißt: Der Katalog hält keine Musterlösung für diese Anlage.
 * Das ist kein Fehler — der Katalog führt Musterlösungen, nicht alle Anlagen.
 * Es ist aber eine Auskunft, die ins Bild gehört, statt stillschweigend ein
 * anonymes Fließbild zu zeichnen.
 */
export function zugeordneteVorlage(
  result: PlantDesignResult,
  plant?: PlantDefinition,
): Zuordnung | undefined {
  const eingetragen = plant?.schematic?.vorlageId ? schemaVorlage(plant.schematic.vorlageId) : undefined;

  if (eingetragen) {
    const bewertung = bewerte(eingetragen, anlagenMerkmale(result, plant));
    return {
      vorlage: eingetragen,
      quelle: 'eingetragen',
      passung: bewertung.passung,
      abweichungen: bewertung.abweichungen,
      satz: satzFuer(eingetragen, 'eingetragen', bewertung.abweichungen),
    };
  }

  const beste = schlageSchemaVor(result, plant).beste;
  if (!beste) return undefined;
  return {
    vorlage: beste.vorlage,
    quelle: 'abgeleitet',
    passung: beste.passung,
    abweichungen: beste.abweichungen,
    satz: satzFuer(beste.vorlage, 'abgeleitet', beste.abweichungen),
  };
}

/**
 * Der Satz unter dem Bild.
 *
 * Er nennt immer zuerst die Kennung — sie ist das, was man nachschlägt — und
 * danach, wenn es etwas zu sagen gibt, die Abweichung. Eine Abweichung wird
 * **benannt, nicht versteckt**: Unser Beispielhaus hat einen gemischten und
 * einen ungemischten Kreis, das BWP-Schema 3 zeigt nur gemischte. Das ist der
 * Praxisfall und bleibt so; das Bild sagt es dazu.
 */
function satzFuer(vorlage: SchemaVorlage, quelle: Zuordnung['quelle'], abweichungen: readonly Abweichung[]): string {
  const kopf =
    quelle === 'eingetragen'
      ? `Übernommen: ${vorlage.kennung} — ${vorlage.name}.`
      : `Gebaut nach ${vorlage.kennung} — ${vorlage.name}.`;
  if (!abweichungen.length) return kopf;
  const liste = abweichungen
    .map((a) => `${a.merkmal}: ${a.anlage} statt ${a.schema}`)
    .join(' · ');
  return `${kopf} Abweichend vom Schema — ${liste}.`;
}

/**
 * Wie viele Vorlagen der Katalog führt.
 *
 * Steht hier und nicht in der Oberfläche, damit die Zahl an einer Stelle
 * entsteht und im Prüflauf gegen den Katalog gehalten werden kann.
 */
export const VORLAGEN_IM_KATALOG = SCHEMA_KATALOG.length;
