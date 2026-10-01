/**
 * Drei Befunde zur Anlage, die aus Zahlen folgen, die längst im Modell stehen.
 *
 * **Warum sie hier und nicht in `validation.ts` stehen.** Alle drei sind
 * Schwellen aus den BWP- und BDH-Unterlagen, und eine Schwelle will geprüft
 * werden — mit Zahlen von Hand, nicht mit einem ganzen Gebäudemodell um sie
 * herum. Als eigene Funktion sind sie in einem Prüfblock in drei Zeilen
 * durchzugehen; eingebettet in die Modellprüfung bräuchte jede Zeile ein
 * vollständiges Dokument.
 *
 * **Was sie gemeinsam haben:** Keiner ist ein Fehler. Es gibt Häuser, in denen
 * 60 °C Vorlauf die richtige Antwort sind, und es gibt Anlagen ohne erfasste
 * Heizgrenze. Das Programm sagt, was es sieht, und entscheidet nicht.
 */

/** Woher die Schwelle kommt — steht in der Meldung mit dabei. */
export type HinweisArt = 'info' | 'warning';

export interface Anlagenhinweis {
  severity: HinweisArt;
  code: string;
  message: string;
}

export interface Ladekreis {
  label: string;
  /** Nur Kreise der Art `dhw` werden angesehen. */
  istTrinkwasser: boolean;
  flowTemperature: number;
  returnTemperature: number;
}

export interface Anlagenangaben {
  /** Auslegungsvorlauf der Heizung [°C]. */
  vorlauf: number;
  /** Heizgrenztemperatur [°C]; fehlt, wenn nicht erfasst. */
  heizgrenze?: number;
  kreise: readonly Ladekreis[];
  /** Vorhaben aus den Projektangaben — `sanierung`, `teilsanierung`, `neubau`. */
  vorhaben?: string;
}

/** Berechnungseinstieg für Erd- und Luftwärmepumpen, BWP-Praxisratgeber. */
export const VORLAUF_EINSTIEG = 55;
/** Obere Grenze der Spreizung im Trinkwasser-Ladekreis [K]. */
export const LADEKREIS_SPREIZUNG_MAX = 10;
/** Übliche Heizgrenztemperatur [°C], BDH/BWP-Infoblatt Nr. 62. */
export const HEIZGRENZE: readonly [number, number] = [12, 18];

export function anlagenHinweise(a: Anlagenangaben): Anlagenhinweis[] {
  const raus: Anlagenhinweis[] = [];

  // --- 1 · Die 55-°C-Schranke ------------------------------------------------
  if (a.vorlauf > VORLAUF_EINSTIEG) {
    const bestand = a.vorhaben === 'sanierung' || a.vorhaben === 'teilsanierung';
    raus.push({
      severity: 'info',
      code: 'plant.flow-55',
      message:
        `Auslegungsvorlauf ${a.vorlauf} °C liegt über ${VORLAUF_EINSTIEG} °C. ` +
        (bestand
          ? `Der BWP-Praxisratgeber setzt ${VORLAUF_EINSTIEG} °C als Einstieg für Erd- und Luftwärmepumpen im Bestand — darüber fällt die Arbeitszahl deutlich ab.`
          : `Für eine Wärmepumpe ist das hoch; ${VORLAUF_EINSTIEG} °C sind der übliche Einstieg, bei Flächenheizung deutlich weniger.`) +
        ' Bei Trinkwasser mit Zirkulation gelten davon unabhängig 55 °C als Untergrenze.',
    });
  }

  // --- 2 · Spreizung im Trinkwasser-Ladekreis -------------------------------
  for (const k of a.kreise) {
    if (!k.istTrinkwasser) continue;
    const spreizung = k.flowTemperature - k.returnTemperature;
    if (spreizung > LADEKREIS_SPREIZUNG_MAX) {
      raus.push({
        severity: 'warning',
        code: 'plant.dhw-spread',
        message:
          `Trinkwasser-Ladekreis „${k.label}" ist auf ${spreizung.toFixed(1).replace('.', ',')} K Spreizung ausgelegt. ` +
          `Mehr als ${LADEKREIS_SPREIZUNG_MAX} K gelten im Ladekreis als Fehlerindiz (BDH/BWP-Infoblatt Nr. 62) — ` +
          'und der BWP-Leitfaden Hydraulik nennt dieselbe Zahl als obere Grenze der Auslegung.',
      });
    }
  }

  // --- 3 · Heizgrenztemperatur ----------------------------------------------
  if (a.heizgrenze === undefined) {
    raus.push({
      severity: 'info',
      code: 'plant.heating-limit',
      message:
        'Keine Heizgrenztemperatur erfasst. Sie wird bei der Inbetriebnahme eingestellt und liegt ' +
        `je nach Dämmstandard zwischen ${HEIZGRENZE[0]} und ${HEIZGRENZE[1]} °C (BDH/BWP-Infoblatt Nr. 62).`,
    });
  } else if (a.heizgrenze < HEIZGRENZE[0] || a.heizgrenze > HEIZGRENZE[1]) {
    raus.push({
      severity: 'warning',
      code: 'plant.heating-limit',
      message:
        `Heizgrenze ${a.heizgrenze} °C liegt außerhalb der üblichen ${HEIZGRENZE[0]} bis ${HEIZGRENZE[1]} °C. ` +
        (a.heizgrenze > HEIZGRENZE[1]
          ? 'Zu hoch heißt: die Wärmepumpe läuft im Frühjahr in kurzen Takten.'
          : 'Zu tief heißt: morgens wird es im Übergang kalt.'),
    });
  }

  return raus;
}
