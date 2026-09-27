/**
 * Verbrauchsabgleich — die zweite Zahl zur Heizlast.
 * ---------------------------------------------------------------------------
 * WAS DIESES MODUL IST
 * Eine Gegenprobe. Dieses Programm rechnet die Heizlast aus der Gebäudehülle:
 * Flächen, U-Werte, Luftwechsel, Auslegungstemperatur. Das ist der richtige
 * Weg, und er hat eine Schwäche — **er prüft sich an nichts.** Ein zu
 * optimistischer U-Wert, eine vergessene Wärmebrücke, ein falsch gesetzter
 * Aufbau: Das Ergebnis bleibt plausibel. Es sieht aus wie eine Rechnung, weil
 * es eine ist, und niemand merkt, dass die Eingangsgrößen nicht stimmen.
 *
 * Der Verbrauch weiß es besser. Er ist gemessen worden, nicht angenommen.
 *
 * **Zwei Wege zu derselben Größe sind mehr wert als einer:** Wo sie
 * auseinanderlaufen, stimmt etwas nicht, und dann kann das Programm es sagen,
 * statt eine Zahl anzubieten, die niemand hinterfragt.
 *
 * DREI ZAHLEN, DIE HIER ZUSAMMENKOMMEN
 *  1. Der **Überschlag aus der Hülle** — rechnet `heatLoadEstimate.ts`.
 *  2. Der **gemessene Verbrauch** — Öl, Gas oder Kilowattstunden.
 *  3. Die **Baualtersklasse** mal der beheizten Fläche. Die Fläche muss
 *     niemand nachschlagen: Das Modell kennt sie.
 *
 * HERKUNFT
 * BWP-Praxisratgeber „Modernisieren mit Wärmepumpe", Schritt 2
 * (Heizlastermittlung), Seite 18:
 *
 *   „Bestehender Ölverbrauch pro Jahr in l : 250 = kW Heizleistung (Heizlast)"
 *   „Bestehender Gasverbrauch pro Jahr in m³ : 250 = kW Heizleistung"
 *   „*) Nach der sogenannten Schweizer Formel, bei der auch Warmwasser
 *       berücksichtigt wird, ist der Divisor 300."
 *
 * und, für den dritten Weg, ebenda: „Multiplizieren Sie die Gesamtwohnfläche
 * in Quadratmetern mit dem spezifischen Endenergieverbrauch (Richtwerte nach
 * Baujahr siehe Grafik)."
 *
 * WAS HIER HERGELEITET UND WAS ABGESCHRIEBEN IST
 * Abgeschrieben sind die Teiler 250 und 300 und die acht spezifischen
 * Verbräuche der Grafik. **Hergeleitet** sind die Vollbenutzungsstunden: Der
 * Leitfaden nennt für Liter Öl und Kubikmeter Erdgas *denselben* Teiler, und
 * das geht nur auf, wenn beide mit rund 10 kWh je Einheit angesetzt sind.
 * Daraus folgt
 *
 *     Leistung = Menge / 250 = (Menge · 10 kWh) / 2500 h
 *
 * also **2500 Vollbenutzungsstunden** ohne und **3000** mit
 * Trinkwassererwärmung. Damit lässt sich derselbe Weg auch für eine
 * Gasrechnung in Kilowattstunden gehen, für Fernwärme und für alles andere,
 * was ohnehin schon als Energie vorliegt — ohne einen Heizwert zu erfinden.
 *
 * Für Flüssiggas, Pellets und Scheitholz steht hier **nichts**. Der Leitfaden
 * nennt für sie keinen Teiler, und ein Heizwert aus zweiter Hand wäre eine
 * Zahl, die dieses Programm nicht belegen kann. Wer sie hat, rechnet seinen
 * Verbrauch selbst in Kilowattstunden um und trägt die ein.
 *
 * WAS DIESE ZAHL NICHT IST
 * Keine Heizlastberechnung. Der Ratgeber sagt es selbst: „Zur
 * Angebotserstellung genügt zunächst eine grobe Analyse … Eine gründliche
 * Heizlastermittlung sollte später unbedingt Bestandteil des Angebotes sein."
 * Und sie beschreibt das Gebäude **im Zustand des Verbrauchsjahres** — nach
 * neuen Fenstern oder einer gedämmten Decke gilt sie nicht mehr.
 */

import type { Brennstoff, Verbrauchsangabe } from '../types/bim';

export type { Brennstoff, Verbrauchsangabe };

export const BRENNSTOFF_LABELS: Record<Brennstoff, string> = {
  oel: 'Heizöl',
  erdgas: 'Erdgas',
  kwh: 'Energie (Kilowattstunden)',
};

export const BRENNSTOFF_EINHEIT: Record<Brennstoff, string> = {
  oel: 'l/a',
  erdgas: 'm³/a',
  kwh: 'kWh/a',
};

/**
 * Energieinhalt je Einheit [kWh].
 *
 * **Hergeleitet, nicht abgeschrieben** — siehe Kopf: Der Leitfaden nennt für
 * Liter und Kubikmeter denselben Teiler 250. Das geht nur auf, wenn beide mit
 * rund 10 kWh angesetzt sind. Eine Erdgasqualität schwankt zwischen etwa 8,5
 * und 11,5 kWh/m³; wer es genauer weiß, trägt die Kilowattstunden von der
 * Rechnung ein, dort steht der Wert des Versorgers.
 */
export const ENERGIEINHALT: Record<Brennstoff, number> = { oel: 10, erdgas: 10, kwh: 1 };

/**
 * Vollbenutzungsstunden [h/a].
 *
 * 2500 h entsprechen dem Teiler 250, 3000 h dem Teiler 300. Der größere Wert
 * gilt, wenn im abgelesenen Verbrauch **auch die Trinkwassererwärmung**
 * steckt — was beim Kombigerät der Normalfall ist. Er macht die Heizlast
 * kleiner, und das ist richtig so: Ein Teil des Verbrauchs war kein Heizen.
 */
export const VOLLBENUTZUNGSSTUNDEN = { ohneWarmwasser: 2500, mitWarmwasser: 3000 } as const;

/**
 * Die acht Baualtersklassen des Ratgebers mit ihrem spezifischen
 * Endenergieverbrauch [kWh/(m²·a)].
 *
 * Quelle: BWP-Praxisratgeber „Modernisieren mit Wärmepumpe", S. 18, Grafik
 * „Endenergieverbrauch bei unterschiedlichen Baualtersklassen (grober
 * Richtwert)". Beispielwerte für **Einfamilienhäuser** nach IWU (Institut
 * Wohnen und Umwelt), Deutsche Wohngebäudetypologie 2015.
 *
 * Die Reihe fällt nicht durchgehend: 1919–48 liegt mit 249 unter 1949–1957
 * mit 268. Das ist kein Übertragungsfehler, sondern steht so in der Grafik —
 * die Nachkriegsjahre haben schlechter gebaut als die Zeit davor.
 */
export interface Baualtersklasse {
  id: string;
  label: string;
  /** Spezifischer Endenergieverbrauch [kWh/(m²·a)]. */
  spezifisch: number;
}

export const BAUALTERSKLASSEN: readonly Baualtersklasse[] = [
  { id: 'efh-c', label: 'bis 1948', spezifisch: 249 },
  { id: 'efh-d', label: '1949 bis 1957', spezifisch: 268 },
  { id: 'efh-e', label: '1958 bis 1968', spezifisch: 266 },
  { id: 'efh-f', label: '1969 bis 1978', spezifisch: 237 },
  { id: 'wschv-77', label: 'ab WSchV 1977', spezifisch: 200 },
  { id: 'wschv-82', label: 'ab WSchV 1982', spezifisch: 159 },
  { id: 'wschv-95', label: 'ab WSchV 1995', spezifisch: 109 },
  { id: 'enev-02', label: 'ab EnEV 2002/2007', spezifisch: 95.5 },
];

export function baualtersklasse(id: string | undefined): Baualtersklasse | undefined {
  return id === undefined ? undefined : BAUALTERSKLASSEN.find((k) => k.id === id);
}

/** Eine Gegenprobe: eine Heizlast [kW] und der Weg, auf dem sie entstand. */
export interface Gegenprobe {
  id: 'verbrauch' | 'baualter';
  bezeichnung: string;
  /** Heizlast [kW]. */
  wert: number;
  /** Zugrunde liegende Endenergie [kWh/a]. */
  endenergie: number;
  /** Angesetzte Vollbenutzungsstunden [h/a]. */
  stunden: number;
  /** Der Rechenweg in einem Satz, mit allen Zahlen darin. */
  rechenweg: string;
}

const rund = (v: number, n = 2): number => Math.round(v * 10 ** n) / 10 ** n;
const de = (v: number, n = 1): string => rund(v, n).toFixed(n).replace('.', ',');

/** Heizlast aus dem gemessenen Verbrauch [kW]. */
export function heizlastAusVerbrauch(angabe: Verbrauchsangabe | undefined): Gegenprobe | undefined {
  if (!angabe || !(angabe.menge > 0)) return undefined;
  const energie = angabe.menge * ENERGIEINHALT[angabe.brennstoff];
  const stunden = angabe.mitWarmwasser
    ? VOLLBENUTZUNGSSTUNDEN.mitWarmwasser
    : VOLLBENUTZUNGSSTUNDEN.ohneWarmwasser;
  const einheit = BRENNSTOFF_EINHEIT[angabe.brennstoff];
  const teiler = angabe.brennstoff === 'kwh' ? undefined : stunden / ENERGIEINHALT[angabe.brennstoff];
  return {
    id: 'verbrauch',
    bezeichnung: `aus dem Verbrauch (${BRENNSTOFF_LABELS[angabe.brennstoff]})`,
    wert: rund(energie / stunden),
    endenergie: Math.round(energie),
    stunden,
    rechenweg:
      teiler === undefined
        ? `${Math.round(energie).toLocaleString('de-DE')} kWh/a ÷ ${stunden} h = ${de(energie / stunden, 2)} kW`
        : `${de(angabe.menge, 0)} ${einheit} ÷ ${teiler} = ${de(energie / stunden, 2)} kW` +
          ` (das sind ${Math.round(energie).toLocaleString('de-DE')} kWh/a ÷ ${stunden} h)`,
  };
}

/**
 * Heizlast aus Baualtersklasse und beheizter Fläche [kW].
 *
 * **Die Fläche kommt aus dem Modell.** Der Ratgeber lässt den Anwender die
 * Gesamtwohnfläche nachschlagen; hier steht sie schon da. Das ist dieselbe
 * Überlegung wie beim Schutzbereich: Was gezeichnet ist, muss man nicht
 * abfragen.
 */
export function heizlastAusBaualter(
  klasseId: string | undefined,
  beheizteFlaeche: number,
  mitWarmwasser = true,
): Gegenprobe | undefined {
  const k = baualtersklasse(klasseId);
  if (!k || !(beheizteFlaeche > 0)) return undefined;
  const energie = k.spezifisch * beheizteFlaeche;
  const stunden = mitWarmwasser
    ? VOLLBENUTZUNGSSTUNDEN.mitWarmwasser
    : VOLLBENUTZUNGSSTUNDEN.ohneWarmwasser;
  return {
    id: 'baualter',
    bezeichnung: `aus Baualter und Fläche (${k.label})`,
    wert: rund(energie / stunden),
    endenergie: Math.round(energie),
    stunden,
    rechenweg:
      `${de(beheizteFlaeche, 0)} m² × ${de(k.spezifisch, 1)} kWh/(m²·a) = ` +
      `${Math.round(energie).toLocaleString('de-DE')} kWh/a ÷ ${stunden} h = ${de(energie / stunden, 2)} kW`,
  };
}

export type Urteil = 'deckt-sich' | 'nachsehen' | 'passt-nicht';

export interface AbgleichZeile {
  probe: Gegenprobe;
  /** Abweichung gegenüber dem Überschlag [%], positiv = Gegenprobe ist höher. */
  abweichung: number;
  urteil: Urteil;
  /** Was das heißen kann — in Fließtext, mit der Richtung im Blick. */
  deutung: string;
}

/**
 * Die Schwellen dieses Programms.
 *
 * **Sie stehen in keiner Quelle.** Der Ratgeber nennt seine eigene Rechnung
 * eine „Einstiegsrechnung" und seine Richtwerte „grob", aber keine Schranke,
 * ab der eine Abweichung erklärungsbedürftig wird. Diese beiden Zahlen sind
 * deshalb eine Setzung dieses Programms, und sie steht als solche auch im
 * Text: 15 % ist der Bereich, in dem zwei so grobe Verfahren sich ohnehin
 * nicht einiger sein können; ab 30 % ist der Unterschied größer als alles,
 * was sich mit Witterung und Nutzerverhalten erklären lässt.
 */
export const SCHWELLE = { deckung: 15, warnung: 30 } as const;

function urteilZu(abweichung: number): Urteil {
  const a = Math.abs(abweichung);
  if (a <= SCHWELLE.deckung) return 'deckt-sich';
  if (a <= SCHWELLE.warnung) return 'nachsehen';
  return 'passt-nicht';
}

function deutungZu(zeile: { probe: Gegenprobe; abweichung: number; urteil: Urteil }): string {
  const { probe, abweichung, urteil } = zeile;
  if (urteil === 'deckt-sich') {
    return 'Die beiden Wege kommen auf dasselbe. Mehr kann eine Gegenprobe nicht leisten — sie beweist nichts, aber sie widerspricht auch nicht.';
  }
  const hoeher = abweichung > 0;
  const gemeinsam =
    probe.id === 'verbrauch'
      ? ' Und ganz gleich, wohin es ausschlägt: Der Verbrauch beschreibt das Gebäude **im Zustand des Verbrauchsjahres**. Nach neuen Fenstern oder einer gedämmten Obergeschossdecke gilt er nicht mehr.'
      : ' Der Richtwert der Baualtersklasse gilt für Einfamilienhäuser nach der IWU-Typologie und sagt nichts über dieses Haus im Besonderen — eine bereits gedämmte Fassade sieht er nicht.';
  if (hoeher) {
    return (
      'Die Gegenprobe liegt **höher** als der Überschlag aus der Hülle. Dafür gibt es drei übliche Gründe, und alle drei ' +
      'sind am Modell nachzusehen: zu günstig angesetzte U-Werte, ein zu klein gewählter Wärmebrückenzuschlag, oder ' +
      'beheizte Flächen, die im Modell als unbeheizt geführt sind. ' +
      (probe.id === 'verbrauch'
        ? 'Der vierte Grund liegt nicht am Modell: Steckt die Trinkwassererwärmung im abgelesenen Verbrauch, ohne dass es hier angehakt ist, fällt die Zahl zu hoch aus. '
        : '') +
      gemeinsam
    );
  }
  return (
    'Die Gegenprobe liegt **niedriger** als der Überschlag aus der Hülle. Das heißt nicht zwingend, dass der Überschlag zu hoch ist: ' +
    (probe.id === 'verbrauch'
      ? 'Ein Verbrauch entsteht über ein Jahr mit der Witterung, die war, und mit dem Heizverhalten, das war — wer sparsam heizt oder Räume ungeheizt lässt, verbraucht weniger, als das Gebäude an einem Auslegungstag brauchen würde. '
      : 'Der Richtwert ist ein Mittel über viele Häuser einer Baualtersklasse; ein Haus mit viel Außenfläche liegt darüber. ') +
    'Umgekehrt kann es am Modell liegen: eine zu hohe Luftwechselrate oder ein Raum, der zu warm angesetzt ist.' +
    gemeinsam
  );
}

export interface Abgleich {
  /** Der Überschlag aus der Gebäudehülle [kW] — die Bezugsgröße. */
  ueberschlag: number;
  zeilen: AbgleichZeile[];
  /** Das strengste Urteil über alle Zeilen. */
  urteil: Urteil | undefined;
}

/**
 * Überschlag und Gegenproben nebeneinanderstellen.
 *
 * Die Bezugsgröße ist der Überschlag — er ist das, was das Programm behauptet,
 * und die Gegenprobe ist das, was die Wirklichkeit dazu sagt. Die Abweichung
 * wird deshalb auf den Überschlag bezogen und nicht umgekehrt.
 */
export function verbrauchsabgleich(ueberschlag: number, proben: readonly (Gegenprobe | undefined)[]): Abgleich {
  const zeilen: AbgleichZeile[] = [];
  for (const probe of proben) {
    if (!probe || !(ueberschlag > 0)) continue;
    const abweichung = rund(((probe.wert - ueberschlag) / ueberschlag) * 100, 1);
    const urteil = urteilZu(abweichung);
    zeilen.push({ probe, abweichung, urteil, deutung: deutungZu({ probe, abweichung, urteil }) });
  }
  const rang: Record<Urteil, number> = { 'deckt-sich': 0, nachsehen: 1, 'passt-nicht': 2 };
  const schlimmstes = zeilen.reduce<Urteil | undefined>(
    (bisher, z) => (bisher === undefined || rang[z.urteil] > rang[bisher] ? z.urteil : bisher),
    undefined,
  );
  return { ueberschlag: rund(ueberschlag), zeilen, urteil: schlimmstes };
}
