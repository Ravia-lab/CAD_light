/**
 * Der Objektaufnahmebogen (BWP-Vorhaben 4.2).
 *
 * **Woher die Liste kommt.** Der BWP-Praxisratgeber Modernisieren führt die
 * Objektaufnahme in einer Checkliste: Baujahr, Geschosse, Dach- und
 * Kellerdämmung, Wohnfläche, Personen, Bäder, Bauart, Verglasung, bestehende
 * Heizung samt Typenschild, Verbrauch, Warmwasserbereitung und die
 * Wärmeverteilung je Raum. Das ist der Arbeitsablauf, den dieses Programm
 * bedient — nur fing es bisher bei der Zeichnung an.
 *
 * **Was dieses Modul ausdrücklich nicht tut: Felder verdoppeln.** Die meisten
 * Positionen der Checkliste stehen längst im Modell — Geschosse, Wohnfläche,
 * Bäder, Heizflächen je Raum sind Geometrie, Baujahr und Verbrauch stehen am
 * Projekt. Sie hier ein zweites Mal zum Eintippen anzubieten hieße, zwei
 * Wahrheiten anzulegen, die sich widersprechen können. Der Bogen **liest**
 * deshalb, was dasteht, und nennt die Quelle dazu.
 *
 * Eingetippt wird nur, was im Modell keinen Platz hat: die bestehende Heizung,
 * die Warmwasserbereitung im Bestand und die drei Einschätzungen zur Dämmung
 * und zur Verglasung. Das sind Aufnahmeangaben und keine Rechengrößen — sie
 * gehen in keine Heizlast ein, sondern in den Bogen und in die Projektmappe.
 *
 * **Und es wird nichts geraten.** Eine Position ohne Angabe steht als „nicht
 * erfasst" da. Der Bogen zählt, wie viele Positionen belegt sind; eine
 * Vollständigkeit, die über leere Felder hinwegsieht, wäre die unbrauchbarste
 * Zahl von allen.
 */

import type { BimDocument } from '../types/bim';
import { BRENNSTOFF_EINHEIT, BRENNSTOFF_LABELS, baualtersklasse } from './verbrauchsabgleich';

/** Wie die Dämmung eines Bauteils bei der Aufnahme eingeschätzt wurde. */
export type Daemmzustand = 'gedaemmt' | 'teilweise' | 'ungedaemmt' | 'unbekannt';

export const DAEMMZUSTAND_LABELS: Record<Daemmzustand, string> = {
  gedaemmt: 'gedämmt',
  teilweise: 'teilweise gedämmt',
  ungedaemmt: 'ungedämmt',
  unbekannt: 'unbekannt',
};

/** Art der bestehenden Wärmeerzeugung — die Zeile „aktuelle Heizung". */
export type BestandsheizungArt =
  | 'gas-niedertemperatur'
  | 'gas-brennwert'
  | 'oel-niedertemperatur'
  | 'oel-brennwert'
  | 'fernwaerme'
  | 'nachtspeicher'
  | 'festbrennstoff'
  | 'waermepumpe'
  | 'keine';

export const BESTANDSHEIZUNG_LABELS: Record<BestandsheizungArt, string> = {
  'gas-niedertemperatur': 'Gaskessel, Niedertemperatur',
  'gas-brennwert': 'Gaskessel, Brennwert',
  'oel-niedertemperatur': 'Ölkessel, Niedertemperatur',
  'oel-brennwert': 'Ölkessel, Brennwert',
  fernwaerme: 'Fernwärme-Übergabestation',
  nachtspeicher: 'Nachtspeicherheizung',
  festbrennstoff: 'Festbrennstoffkessel',
  waermepumpe: 'Wärmepumpe',
  keine: 'keine — Neubau',
};

/** Wie das Trinkwarmwasser im Bestand erzeugt wird. */
export type WarmwasserBestand =
  | 'speicher-am-kessel'
  | 'durchlauferhitzer'
  | 'elektro-speicher'
  | 'dezentral-gas'
  | 'solar-unterstuetzt'
  | 'unbekannt';

export const WARMWASSER_BESTAND_LABELS: Record<WarmwasserBestand, string> = {
  'speicher-am-kessel': 'Speicher am Wärmeerzeuger',
  durchlauferhitzer: 'elektrischer Durchlauferhitzer',
  'elektro-speicher': 'elektrischer Speicher (Boiler)',
  'dezentral-gas': 'dezentral mit Gas',
  'solar-unterstuetzt': 'solar unterstützt',
  unbekannt: 'unbekannt',
};

/**
 * Die Angaben der Aufnahme, die im Modell keinen anderen Platz haben.
 *
 * Alles optional: Eine Aufnahme ist selten in einem Gang vollständig, und ein
 * Pflichtfeld, das man nicht beantworten kann, hält den Bogen auf.
 */
export interface Objektaufnahme {
  /** Dämmung des Daches bzw. der obersten Geschossdecke. */
  daemmungDach?: Daemmzustand;
  /** Dämmung der Kellerdecke bzw. des Kellers. */
  daemmungKeller?: Daemmzustand;
  /** Dämmung der Außenwand. */
  daemmungWand?: Daemmzustand;
  /** Verglasung — in der Schreibweise der Aufnahme, z. B. „2-fach, 1998". */
  verglasung?: string;
  /** Art der bestehenden Wärmeerzeugung. */
  heizungArt?: BestandsheizungArt;
  /** Baujahr des bestehenden Wärmeerzeugers. */
  heizungBaujahr?: number;
  /** Nennleistung des bestehenden Wärmeerzeugers [kW] — vom Typenschild. */
  heizungLeistung?: number;
  /** Was auf dem Typenschild steht, wörtlich. */
  typenschild?: string;
  /** Trinkwarmwasser im Bestand. */
  warmwasser?: WarmwasserBestand;
  /** Personen im Haushalt — falls abweichend von der Anlagenannahme. */
  personen?: number;
  /** Freie Bemerkung zur Aufnahme. */
  bemerkung?: string;
  /** Wer aufgenommen hat und wann — ISO-Zeitpunkt. */
  aufgenommenAm?: string;
  aufgenommenVon?: string;
}

/** Eine Zeile des Bogens. */
export interface Aufnahmezeile {
  /** Kennung für Prüfung und Oberfläche. */
  id: string;
  /** Was der Praxisratgeber an dieser Stelle verlangt. */
  frage: string;
  /** Die Antwort, soweit sie vorliegt. */
  wert?: string;
  /**
   * Woher die Antwort kommt.
   *
   * `modell` — aus Geometrie oder Bauteilen gelesen, nicht eintippbar.
   * `projekt` — am Projekt erfasst (Baujahr, Verbrauch).
   * `aufnahme` — in diesem Bogen eingetippt.
   * `anlage` — aus dem Anlagenblatt.
   */
  herkunft: 'modell' | 'projekt' | 'aufnahme' | 'anlage';
}

export interface Aufnahmegruppe {
  titel: string;
  zeilen: Aufnahmezeile[];
}

export interface Aufnahmestand {
  gruppen: Aufnahmegruppe[];
  /** Zahl der Positionen insgesamt. */
  gesamt: number;
  /** Zahl der belegten Positionen. */
  belegt: number;
  /** Die Fragen, auf die noch keine Antwort steht. */
  offen: string[];
}

const de = (v: number, n = 1): string => v.toFixed(n).replace('.', ',');

/**
 * Den Bogen aus Modell, Projekt, Anlagenblatt und Aufnahme zusammenstellen.
 *
 * Die Reihenfolge folgt der Checkliste des Praxisratgebers — erst das Gebäude,
 * dann die Hülle, dann die Nutzung, dann der Bestand. So wird vor Ort auch
 * aufgenommen: von außen nach innen und von der Bausubstanz zur Technik.
 */
export function aufnahmestand(doc: BimDocument): Aufnahmestand {
  const a = doc.meta.aufnahme ?? {};
  const raeume = Object.values(doc.rooms);
  const beheizt = raeume.filter((r) => r.isHeated);
  const flaeche = beheizt.reduce((s, r) => s + r.area, 0);
  const baeder = raeume.filter((r) => r.usage === 'bath').length;
  const geschosse = Object.keys(doc.levels).length;
  const klasse = baualtersklasse(doc.meta.baualter);
  const heizflaechen = Object.values(doc.fixtures).filter((f) => f.category === 'heating');
  const raeumeMitHeizflaeche = new Set(
    heizflaechen.map((f) => f.roomId).filter((x): x is string => typeof x === 'string'),
  ).size;

  const gruppen: Aufnahmegruppe[] = [
    {
      titel: 'Gebäude',
      zeilen: [
        {
          id: 'baujahr',
          frage: 'Baujahr bzw. Baualtersklasse',
          wert: klasse ? klasse.label : undefined,
          herkunft: 'projekt',
        },
        {
          id: 'geschosse',
          frage: 'Zahl der Geschosse',
          wert: geschosse > 0 ? `${geschosse}` : undefined,
          herkunft: 'modell',
        },
        {
          id: 'wohnflaeche',
          frage: 'beheizte Fläche',
          wert: flaeche > 0 ? `${de(flaeche, 1)} m²` : undefined,
          herkunft: 'modell',
        },
        {
          id: 'bauart',
          frage: 'Bauart der Außenwand',
          // Die Bauart steht als Bauteilaufbau am Modell — hier der Name des
          // Aufbaus, der an den Außenwänden liegt, nicht eine zweite Angabe.
          wert: aussenwandaufbau(doc),
          herkunft: 'modell',
        },
      ],
    },
    {
      titel: 'Gebäudehülle',
      zeilen: [
        {
          id: 'daemmung-dach',
          frage: 'Dach bzw. oberste Geschossdecke gedämmt?',
          wert: a.daemmungDach ? DAEMMZUSTAND_LABELS[a.daemmungDach] : undefined,
          herkunft: 'aufnahme',
        },
        {
          id: 'daemmung-keller',
          frage: 'Kellerdecke gedämmt?',
          wert: a.daemmungKeller ? DAEMMZUSTAND_LABELS[a.daemmungKeller] : undefined,
          herkunft: 'aufnahme',
        },
        {
          id: 'daemmung-wand',
          frage: 'Außenwand gedämmt?',
          wert: a.daemmungWand ? DAEMMZUSTAND_LABELS[a.daemmungWand] : undefined,
          herkunft: 'aufnahme',
        },
        {
          id: 'verglasung',
          frage: 'Verglasung',
          wert: a.verglasung?.trim() || undefined,
          herkunft: 'aufnahme',
        },
        {
          id: 'fensterflaeche',
          frage: 'Fensterfläche im Modell',
          wert: fensterflaeche(doc),
          herkunft: 'modell',
        },
      ],
    },
    {
      titel: 'Nutzung',
      zeilen: [
        {
          id: 'personen',
          frage: 'Personen im Haushalt',
          wert: personen(doc, a.personen),
          herkunft: a.personen !== undefined ? 'aufnahme' : 'anlage',
        },
        {
          id: 'baeder',
          frage: 'Zahl der Bäder',
          wert: baeder > 0 ? `${baeder}` : undefined,
          herkunft: 'modell',
        },
        {
          id: 'einheiten',
          frage: 'Wohnungen bzw. Nutzungseinheiten',
          wert: einheiten(doc),
          herkunft: 'modell',
        },
      ],
    },
    {
      titel: 'Bestehende Anlage',
      zeilen: [
        {
          id: 'heizung-art',
          frage: 'aktuelle Heizung',
          wert: a.heizungArt ? BESTANDSHEIZUNG_LABELS[a.heizungArt] : undefined,
          herkunft: 'aufnahme',
        },
        {
          id: 'heizung-baujahr',
          frage: 'Baujahr des Wärmeerzeugers',
          wert: a.heizungBaujahr ? `${a.heizungBaujahr}` : undefined,
          herkunft: 'aufnahme',
        },
        {
          id: 'heizung-leistung',
          frage: 'Nennleistung vom Typenschild',
          wert: a.heizungLeistung ? `${de(a.heizungLeistung, 1)} kW` : undefined,
          herkunft: 'aufnahme',
        },
        {
          id: 'typenschild',
          frage: 'Typenschild, wörtlich',
          wert: a.typenschild?.trim() || undefined,
          herkunft: 'aufnahme',
        },
        {
          id: 'warmwasser',
          frage: 'Warmwasserbereitung',
          wert: a.warmwasser ? WARMWASSER_BESTAND_LABELS[a.warmwasser] : undefined,
          herkunft: 'aufnahme',
        },
        {
          id: 'verbrauch',
          frage: 'Jahresverbrauch',
          wert: verbrauch(doc),
          herkunft: 'projekt',
        },
      ],
    },
    {
      titel: 'Wärmeverteilung',
      zeilen: [
        {
          id: 'heizflaechen',
          frage: 'Heizflächen im Modell',
          wert: heizflaechen.length > 0 ? `${heizflaechen.length} Stück` : undefined,
          herkunft: 'modell',
        },
        {
          id: 'raeume-mit-heizflaeche',
          frage: 'beheizte Räume mit Heizfläche',
          // Die Zahl, die vor Ort gezählt wird: In wie vielen Räumen hängt
          // etwas? Ein beheizter Raum ohne Heizfläche ist der häufigste
          // Aufnahmefehler — und hier fällt er auf.
          wert:
            beheizt.length > 0 ? `${raeumeMitHeizflaeche} von ${beheizt.length}` : undefined,
          herkunft: 'modell',
        },
      ],
    },
  ];

  const zeilen = gruppen.flatMap((g) => g.zeilen);
  const belegt = zeilen.filter((z) => z.wert !== undefined && z.wert !== '').length;
  return {
    gruppen,
    gesamt: zeilen.length,
    belegt,
    offen: zeilen.filter((z) => !z.wert).map((z) => z.frage),
  };
}

/** Der Bauteilaufbau, der an den Außenwänden liegt — oder `undefined`. */
function aussenwandaufbau(doc: BimDocument): string | undefined {
  const aussen = Object.values(doc.walls).filter((w) => w.type === 'exterior');
  const ids = [...new Set(aussen.map((w) => w.constructionId).filter(Boolean))] as string[];
  const namen = ids.map((id) => doc.constructions?.[id]?.name).filter(Boolean) as string[];
  if (!namen.length) return undefined;
  // Mehrere Aufbauten sind der Normalfall im Bestand — dann werden sie
  // genannt und nicht auf einen zusammengezogen.
  return namen.join(' · ');
}

function fensterflaeche(doc: BimDocument): string | undefined {
  const flaeche = Object.values(doc.openings)
    .filter((o) => o.kind === 'window')
    .reduce((s, o) => s + o.width * o.height, 0);
  return flaeche > 0 ? `${de(flaeche, 1)} m²` : undefined;
}

function personen(doc: BimDocument, eigen?: number): string | undefined {
  if (eigen !== undefined && eigen > 0) return `${eigen}`;
  const dhw = doc.plant?.dhw;
  if (!dhw || !(dhw.units > 0) || !(dhw.occupantsPerUnit > 0)) return undefined;
  const summe = dhw.units * dhw.occupantsPerUnit;
  return `${de(summe, summe % 1 === 0 ? 0 : 1)} (${dhw.units} × ${de(dhw.occupantsPerUnit, 1)} je Einheit)`;
}

function einheiten(doc: BimDocument): string | undefined {
  const erfasst = Object.keys(doc.units ?? {}).length;
  if (erfasst > 0) return `${erfasst} erfasst`;
  const getippt = doc.plant?.dhw.units;
  return getippt && getippt > 0 ? `${getippt} (Angabe im Anlagenblatt)` : undefined;
}

function verbrauch(doc: BimDocument): string | undefined {
  const v = doc.meta.verbrauch;
  if (!v || !(v.menge > 0)) return undefined;
  return (
    `${de(v.menge, 0)} ${BRENNSTOFF_EINHEIT[v.brennstoff]} ${BRENNSTOFF_LABELS[v.brennstoff]}` +
    (v.mitWarmwasser ? ', mit Warmwasser' : '') +
    (v.jahr ? ` (${v.jahr})` : '')
  );
}
