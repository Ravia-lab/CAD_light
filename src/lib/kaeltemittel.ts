/**
 * Kältemittelkatalog — Sicherheitsklasse, Treibhauspotenzial, Schwellenwerte.
 * ---------------------------------------------------------------------------
 * WAS DIESE DATEI IST
 * Ein reiner Datenkatalog mit drei Auskünften und keiner Zeichenlogik:
 *
 *  1. **Die Sicherheitsklasse** nach ISO 817 — A1 (keine Flammenausbreitung),
 *     A2L (niedrige Entflammbarkeit), A3 (höhere Entflammbarkeit). Aus ihr
 *     folgt, ob um das Gerät ein Schutzbereich einzuhalten ist.
 *  2. **Das Treibhauspotenzial** (GWP) und die Schwelle, ab der die
 *     F-Gase-Verordnung eine jährliche Dichtheitsprüfung verlangt.
 *  3. **Selbstentzündungs- und maximal zulässige Oberflächentemperatur** —
 *     die Zahl, an der sich „keine Gegenstände mit hohen
 *     Oberflächentemperaturen im Schutzbereich" bemisst.
 *
 * WARUM ES DIESE DATEI GIBT
 * Bis 1.58.0 stand in `heatPump.ts` eine Namensliste:
 *
 *     export const FLAMMABLE = new Set(['R290', 'R32']);
 *
 * und das Modell kannte nur `R290 | R32 | R410A | R744 | andere`. Wer eine
 * Wärmepumpe mit **R454B, R454C, R452B, R1234yf oder R1234ze** eintrug, musste
 * „andere" wählen — und „andere" war in dieser Liste nicht enthalten. Alle
 * fünf sind A2L, also brennbar. Die Folge war kein falscher Wert, sondern
 * **Schweigen**: kein Schutzbereich, keine Prüfung, keine Meldung. Und
 * Schweigen sieht aus wie ein „in Ordnung".
 *
 * Deshalb steht die Frage jetzt an der Sicherheitsklasse und nicht an einem
 * Namen. Ein Kältemittel, das dieser Katalog nicht kennt, hat keine Klasse —
 * und ohne Klasse gibt das Programm keine Entwarnung, sondern fragt.
 *
 * HERKUNFT
 * BWP-Leitfaden „Wärmepumpen mit brennbaren Kältemitteln", Tabelle 2
 * (Sicherheitsklasse, GWP, Selbstentzündungs- und maximal zulässige
 * Oberflächentemperatur nach DIN EN 378-2:2018-04) und Tabelle 5 (Füllmenge,
 * ab der nach Verordnung (EU) Nr. 2024/573 mindestens jährlich auf Dichtheit
 * zu prüfen ist). Die GWP-Werte der F-Gase stammen dort aus dem 4.
 * IPCC-Sachstandsbericht (2007), wie ihn die F-Gase-Verordnung und die
 * ChemKlimaschutzV verwenden; R290 fällt nicht darunter und ist mit dem Wert
 * aus dem 6. Bericht (2021) geführt.
 *
 * **R744 steht nicht in diesen Tabellen.** Es ist trotzdem im Katalog, weil
 * das Modell es seit jeher führt — mit der Klasse A1, dem GWP 1 (das ist
 * keine Messung, sondern die Definition der Größe: CO₂ ist ihr Bezugsstoff)
 * und ohne Schwellenwert, weil CO₂ kein fluoriertes Treibhausgas ist. Das
 * steht so auch im `beleg`.
 */

/** Sicherheitsgruppe nach ISO 817, Spalte A (geringe Toxizität). */
export type Sicherheitsklasse = 'A1' | 'A2L' | 'A3';

export const KLASSENTEXT: Record<Sicherheitsklasse, string> = {
  A1: 'keine Flammenausbreitung',
  A2L: 'niedrige Entflammbarkeit',
  A3: 'höhere Entflammbarkeit',
};

export interface Kaeltemittel {
  /** Normbezeichnung, zugleich die Kennung im Modell. */
  id: string;
  klasse: Sicherheitsklasse;
  /** Treibhauspotenzial, bezogen auf CO₂. */
  gwp: number;
  /** Selbstentzündungstemperatur [°C]; fehlt, wo der Leitfaden nichts nennt. */
  selbstentzuendung?: number;
  /** Maximal zulässige Oberflächentemperatur nach DIN EN 378-2:2018-04 [°C]. */
  maxOberflaeche?: number;
  /** Unterliegt der F-Gase-Verordnung (und damit der Dichtheitsprüfung)? */
  fGas: boolean;
  /**
   * Füllmenge [kg], ab der mindestens jährlich auf Dichtheit zu prüfen ist —
   * nicht hermetisch geschlossener Kältekreis. Bei hermetisch geschlossenem
   * verdoppelt sie sich (Artikel 5 F-Gase-VO), deshalb steht hier nur ein
   * Wert und die Verdopplung in `dichtheitsschwelle`.
   */
  schwelleKg?: number;
  /**
   * Für HFO/HFKW-Gemische stand die Berechnungsmethodik zum Zeitpunkt des
   * Leitfadens noch nicht fest; der Wert kann auf die Festlegung für HFOs
   * (1 kg beziehungsweise 2 kg) zurückfallen. Der Leitfaden markiert diese
   * Zeilen mit einem Ausrufezeichen — hier steht der Vorbehalt im Klartext.
   */
  schwelleVorlaeufig?: boolean;
  beleg: string;
}

const BWP = 'BWP-Leitfaden „Wärmepumpen mit brennbaren Kältemitteln", Tabelle 2';
const BWP5 = 'BWP-Leitfaden, Tabelle 5 (Schwellenwerte nach Artikel 5 F-Gase-VO 2024/573)';

/**
 * Die elf Kältemittel der Leitfadentabelle, dazu R744.
 *
 * Sortiert nach GWP, wie im Leitfaden — das stellt die brennbaren mit
 * niedrigem Treibhauspotenzial nach vorn, und genau diese Reihenfolge trifft
 * die Entscheidung, um die es beim Neubau geht.
 */
export const KAELTEMITTEL: readonly Kaeltemittel[] = [
  { id: 'R290', klasse: 'A3', gwp: 0.02, selbstentzuendung: 470, maxOberflaeche: 370, fGas: false,
    beleg: `${BWP}. R290 (Propan) fällt nicht unter die ChemKlimaschutzV; der GWP-Wert stammt aus dem 6. IPCC-Sachstandsbericht (2021). Keine Dichtheitsprüfung nach F-Gase-VO, weil es kein fluoriertes Treibhausgas ist.` },
  { id: 'R1234ze', klasse: 'A2L', gwp: 4, selbstentzuendung: 368, fGas: true, schwelleKg: 1,
    beleg: `${BWP}; Schwelle aus ${BWP5}.` },
  { id: 'R1234yf', klasse: 'A2L', gwp: 7, selbstentzuendung: 405, fGas: true, schwelleKg: 1,
    beleg: `${BWP}; Schwelle aus ${BWP5}.` },
  { id: 'R454C', klasse: 'A2L', gwp: 148, selbstentzuendung: 444, maxOberflaeche: 344, fGas: true,
    schwelleKg: 33.78, schwelleVorlaeufig: true, beleg: `${BWP}; Schwelle aus ${BWP5}, dort mit Vorbehalt für HFO/HFKW-Gemische.` },
  { id: 'R454B', klasse: 'A2L', gwp: 466, selbstentzuendung: 496, maxOberflaeche: 396, fGas: true,
    schwelleKg: 10.73, schwelleVorlaeufig: true, beleg: `${BWP}; Schwelle aus ${BWP5}, dort mit Vorbehalt für HFO/HFKW-Gemische.` },
  { id: 'R513A', klasse: 'A1', gwp: 631, fGas: true, schwelleKg: 7.9,
    beleg: `${BWP}; Schwelle aus ${BWP5}. Selbstentzündungstemperatur dort nicht angegeben.` },
  { id: 'R32', klasse: 'A2L', gwp: 675, selbstentzuendung: 648, maxOberflaeche: 458, fGas: true,
    schwelleKg: 7.41, beleg: `${BWP}; Schwelle aus ${BWP5}.` },
  { id: 'R452B', klasse: 'A2L', gwp: 698, selbstentzuendung: 509, fGas: true,
    schwelleKg: 7.16, schwelleVorlaeufig: true, beleg: `${BWP}; Schwelle aus ${BWP5}, dort mit Vorbehalt für HFO/HFKW-Gemische.` },
  { id: 'R134a', klasse: 'A1', gwp: 1430, selbstentzuendung: 743, fGas: true, schwelleKg: 3.5,
    beleg: `${BWP}; Schwelle aus ${BWP5}.` },
  { id: 'R407C', klasse: 'A1', gwp: 1774, selbstentzuendung: 704, fGas: true, schwelleKg: 2.82,
    beleg: `${BWP}; Schwelle aus ${BWP5}.` },
  { id: 'R410A', klasse: 'A1', gwp: 2088, fGas: true, schwelleKg: 2.39,
    beleg: `${BWP} — Selbstentzündungstemperatur dort „nicht definiert"; Schwelle aus ${BWP5}.` },
  { id: 'R744', klasse: 'A1', gwp: 1, fGas: false,
    beleg: 'Nicht aus dem BWP-Leitfaden: R744 (Kohlendioxid) steht in dessen Tabellen nicht. Die Klasse A1 und das GWP 1 sind keine Messwerte, sondern die Definition der Größe — CO₂ ist ihr Bezugsstoff. Kein fluoriertes Treibhausgas, also keine Dichtheitsprüfung nach F-Gase-VO.' },
];

const NACH_ID = new Map(KAELTEMITTEL.map((k) => [k.id, k]));

/** Nachschlagen; `undefined` heißt „dieser Katalog kennt es nicht". */
export function kaeltemittel(id: string | undefined): Kaeltemittel | undefined {
  return id === undefined ? undefined : NACH_ID.get(id);
}

/**
 * Braucht dieses Kältemittel einen Schutzbereich?
 *
 * **Die Antwort auf ein unbekanntes Kältemittel ist `undefined` und nicht
 * `false`.** „Unbekannt" ist keine Entwarnung; das ist der ganze Grund,
 * warum diese Funktion drei Antworten hat und nicht zwei. Die aufrufende
 * Stelle entscheidet, was sie mit dem Nichtwissen macht — und sie sagt es
 * dem Menschen, statt zu schweigen.
 */
export function brauchtSchutzbereich(id: string | undefined): boolean | undefined {
  const k = kaeltemittel(id);
  if (!k) return undefined;
  return k.klasse !== 'A1';
}

export interface Dichtheitspflicht {
  /** Ist mindestens jährlich auf Dichtheit zu prüfen? */
  pflichtig: boolean;
  /** Die maßgebliche Schwelle [kg] für die gewählte Bauart. */
  schwelle?: number;
  /** Trägt die Schwelle den Vorbehalt des Leitfadens? */
  vorlaeufig: boolean;
  /** Warum so — im Klartext, für die Meldung. */
  begruendung: string;
}

/**
 * Ist bei dieser Füllmenge eine jährliche Dichtheitsprüfung vorgeschrieben?
 *
 * **Die Brennbarkeit ist dabei nicht das Kriterium** — das schreibt der
 * Leitfaden ausdrücklich dazu, und es ist die Verwechslung, die nahe liegt:
 * R290 ist das brennbarste der Reihe und unterliegt der Prüfpflicht gar
 * nicht, weil es kein F-Gas ist. Maßgeblich ist allein, ob das Kältemittel
 * unter die F-Gase-Verordnung fällt, und dann seine Füllmenge.
 *
 * Bei hermetisch geschlossenem Kältekreis verdoppelt sich die zulässige
 * Menge (Artikel 5 F-Gase-VO).
 */
export function dichtheitspflicht(
  id: string | undefined,
  fuellmenge: number,
  hermetisch = false,
): Dichtheitspflicht {
  const k = kaeltemittel(id);
  if (!k) {
    return {
      pflichtig: false,
      vorlaeufig: false,
      begruendung:
        'Zu diesem Kältemittel ist hier nichts hinterlegt. Ob eine Dichtheitsprüfung vorgeschrieben ist, steht im Datenblatt des Geräts.',
    };
  }
  if (!k.fGas) {
    return {
      pflichtig: false,
      vorlaeufig: false,
      begruendung: `${k.id} ist kein fluoriertes Treibhausgas und unterliegt der Dichtheitsprüfung nach F-Gase-Verordnung nicht. Die Brennbarkeit ist dafür nicht das Kriterium.`,
    };
  }
  if (k.schwelleKg === undefined) {
    return {
      pflichtig: false,
      vorlaeufig: false,
      begruendung: `${k.id} unterliegt der F-Gase-Verordnung; eine Umrechnung der Schwelle in eine Füllmenge nennt der Leitfaden für dieses Kältemittel nicht.`,
    };
  }
  const schwelle = hermetisch ? k.schwelleKg * 2 : k.schwelleKg;
  const pflichtig = fuellmenge >= schwelle;
  const bauart = hermetisch ? 'hermetisch geschlossen' : 'nicht hermetisch geschlossen';
  return {
    pflichtig,
    schwelle,
    vorlaeufig: k.schwelleVorlaeufig === true,
    begruendung: pflichtig
      ? `${k.id}, ${bauart}: ab ${zahl(schwelle)} kg ist mindestens jährlich auf Dichtheit zu prüfen (Artikel 5 F-Gase-VO 2024/573).`
      : `${k.id}, ${bauart}: die Schwelle für die jährliche Dichtheitsprüfung liegt bei ${zahl(schwelle)} kg.`,
  };
}

/** CO₂-Äquivalent der Füllung [t] — Füllmenge mal GWP, in Tonnen. */
export function co2Aequivalent(id: string | undefined, fuellmenge: number): number | undefined {
  const k = kaeltemittel(id);
  if (!k) return undefined;
  return Math.round(((fuellmenge * k.gwp) / 1000) * 1000) / 1000;
}

function zahl(v: number): string {
  return (Math.round(v * 100) / 100).toString().replace('.', ',');
}
