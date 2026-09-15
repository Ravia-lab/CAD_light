/**
 * Mit welcher Temperatur fährt diese Anlage?
 * ---------------------------------------------------------------------------
 * **Warum es diese Datei gibt.** Die Frage hat genau eine Antwort, und bis
 * 1.23.0 wurde sie an sechs Stellen unabhängig voneinander beantwortet — an
 * einer richtig und an fünf falsch.
 *
 * Richtig war `plantDesign.deriveCircuits`: Ein Heizkörperkreis bekommt
 * mindestens 50/40 °C, auch wenn am Anlagenblatt 35/28 steht, denn ein
 * Heizkörper, der für 35 °C zu klein ist, wird durch eine Eintragung im
 * Anlagenblatt nicht größer. Die Erzeugertemperatur folgt daraufhin dem
 * heißesten Kreis — der Erzeuger kann nur **eine** Vorlauftemperatur liefern,
 * und herunter mischen kann man, hinauf nicht.
 *
 * Falsch war alles, was danach kam. Anschlussnennweite des Erzeugers,
 * Stoffwerte für den Druckverlust, Sicherheitsausrüstung, der ganze
 * Rohrnetzbericht und die Trassenauslegung griffen weiter auf
 * `plant.design` — also auf 35/28. An einem reinen Heizkörperhaus stand damit
 * im Anlagenblatt „Kreis 50/40" und zwei Zeilen tiefer im Rohrnetzbericht
 * „gerechnet mit 35/28".
 *
 * **Was das kostet.** 35/28 sind 7 K Spreizung, 50/40 sind 10 K. Der
 * Volumenstrom ist V̇ = Q/(1,163·Δϑ) und damit umgekehrt proportional zur
 * Spreizung: 10/7 = 1,43. Das Programm rechnete also mit einem um 43 % zu
 * hohen Volumenstrom, wählte zu große Nennweiten und legte ein zu großes
 * Überströmventil aus. Zu groß ist teuer, aber nicht gefährlich.
 *
 * Gefährlich ist die Gegenrichtung, und die gibt es genauso: Wer 55/45 ins
 * Anlagenblatt schreibt, während seine Kreise mit 55/50 fahren, bekam eine
 * Spreizung von 10 K statt 5 K — halber Volumenstrom, zu kleine Nennweite,
 * Heizflächen, die nicht warm werden. Deshalb nimmt die Regel unten nicht
 * einfach die höhere Vorlauftemperatur, sondern zusätzlich den **höheren**
 * Rücklauf der Kreise, die tatsächlich am Erzeuger hängen: von zwei
 * möglichen Spreizungen ist die kleinere die sichere.
 *
 * Schichtgrenze: nur Typen und `plantDefaults`, kein Zustand, keine
 * Oberfläche. Und ausdrücklich **kein** Import aus `plantDesign` — die
 * Anlagenauslegung benutzt dieses Modul, nicht umgekehrt.
 */

import type { BimDocument, HeatingCircuit, Vorhaben } from '../types/bim';
import { plantOf } from './plantDefaults';

// ---------------------------------------------------------------------------
// Was in einem Raum hängt
// ---------------------------------------------------------------------------

/**
 * Die Wärmeübergabe eines Raums — mit einem dritten Zustand.
 *
 * `unbekannt` ist der wichtigste der drei und der Grund, warum dieser Typ
 * überhaupt ein Typ ist. Bis 1.23.0 stand in `deriveCircuits`
 * `emitterOfRoom(…) ?? 'floor'`: Ein Raum ohne gesetztes TGA-Objekt — der
 * Normalfall im frühen Aufmaß, in dem Wände und Räume stehen und die Technik
 * noch nicht — galt stillschweigend als Fußbodenheizung. Ein
 * Heizkörperprojekt wurde damit vollständig mit 35/28 ausgelegt, samt
 * Geräteauswahl nach W35, ohne dass irgendwo etwas gemeldet wurde.
 *
 * Die Annahme „Fläche" bleibt — sie ist bei Wärmepumpenanlagen der Regelfall
 * und man muss *irgendetwas* annehmen, um überhaupt zu rechnen. Aber sie ist
 * ab jetzt sichtbar: Wer `unbekannt` zurückbekommt, kann es melden, und
 * `designPlant` tut das.
 */
export type Heizflaechenart = 'flaeche' | 'heizkoerper' | 'unbekannt';

/** Ein Paar Auslegungstemperaturen [°C]. */
export interface Auslegungstemperatur {
  vorlauf: number;
  ruecklauf: number;
}

/**
 * Womit ein Heizkörperkreis mindestens fährt [°C].
 *
 * **Herkunft.** 55/45 war jahrzehntelang die Auslegung im Bestand, 75/65 im
 * Altbau davor. 50/40 ist die Untergrenze, bei der ein nach heutiger Praxis
 * ausgelegter Plattenheizkörper seine Nennleistung noch im vertretbaren
 * Rahmen hält: Von 75/65 auf 50/40 halbiert sich die Leistung desselben
 * Körpers bereits. Darunter wird der Heizkörper so groß, dass er nicht mehr
 * unter das Fenster passt — dann ist es keine Heizkörperanlage mehr, sondern
 * eine Sanierungsaufgabe.
 *
 * Es ist ausdrücklich ein **Mindestwert** und keine Vorgabe: Steht am
 * Anlagenblatt 55/45, bleibt es bei 55/45.
 */
export const HEIZKOERPER_MINDESTVORLAUF = 50;
export const HEIZKOERPER_MINDESTRUECKLAUF = 40;

/**
 * Der Mindestwert je Vorhaben [°C].
 *
 * **Warum das Vorhaben hier hineinregiert.** Ein Heizkörper im Neubau und
 * ein Heizkörper im Bestand sind zwei verschiedene Aufgaben. Im Neubau
 * wählt man das Gerät zur Temperatur: Wer 50/40 fahren will, nimmt eine
 * Bauhöhe größer, und das kostet im Rohbau nichts. Im Bestand hängt der
 * Heizkörper schon an der Wand, er ist vor dreißig Jahren auf 70/55
 * ausgelegt worden, und die Temperatur folgt ihm, nicht umgekehrt. Mit
 * einer einzigen Zahl für beide Fälle rechnete das Rohrnetz einer
 * Bestandssanierung mit 50/40 — also mit einem um ein Fünftel zu kleinen
 * Volumenstrom und damit reihenweise einer Nennweite zu wenig.
 *
 * Die Zahlen sind dieselbe Konvention wie in `VORHABEN_VORBELEGUNG`
 * (`lib/plantDefaults.ts`) und stehen bewusst nicht dort: Jene Tabelle ist
 * eine **Vorbelegung**, die einmal beim Festlegen des Vorhabens ins
 * Anlagenblatt geschrieben und danach frei geändert wird. Diese hier ist
 * eine **Untergrenze**, die auch dann gilt, wenn im Anlagenblatt 35/28 für
 * die Fußbodenheizung steht — im selben Haus, in dem drei Heizkörper
 * hängen.
 *
 * `neubau` behält die 50/40 von oben; die Vorbelegung 35/28 gilt dort der
 * Flächenheizung und wäre für einen Heizkörper keine Auslegung, sondern
 * eine Wand voller Blech.
 */
export const HEIZKOERPER_MINDEST: Record<Vorhaben, Auslegungstemperatur> = {
  neubau: { vorlauf: HEIZKOERPER_MINDESTVORLAUF, ruecklauf: HEIZKOERPER_MINDESTRUECKLAUF },
  teilsanierung: { vorlauf: 50, ruecklauf: 40 },
  sanierung: { vorlauf: 55, ruecklauf: 45 },
  /*
   * Der unsanierte Bestand: 75/60.
   *
   * Das ist keine Vorsicht, sondern die Wirklichkeit im Keller. Ein
   * Heizkörper, der auf 75/60 ausgelegt wurde, gibt bei 55/45 nur noch rund
   * 60 Prozent ab — wer die Anlage mit 55/45 nachrechnet, obwohl sie mit
   * 75/60 läuft, hält jeden Raum für unterversorgt und dimensioniert das
   * Rohrnetz auf den doppelten Volumenstrom.
   */
  bestand: { vorlauf: 75, ruecklauf: 60 },
};

/**
 * Rückfallebene, wenn das Modell gar nichts hergibt [°C].
 *
 * Sie ist dieselbe Zahl wie in `emptyPlant()` und steht trotzdem hier noch
 * einmal: `systemtemperatur` bekommt ihre Eingaben nicht immer aus einem
 * Dokument, und `Math.max()` über eine leere Liste ist `-Infinity`. Eine
 * Spreizung von `-Infinity` ergibt einen Volumenstrom von `NaN`, und ein
 * `NaN` wandert lautlos durch die gesamte Rechnung bis auf das Blatt.
 */
export const SYSTEMTEMPERATUR_VORGABE: Auslegungstemperatur = { vorlauf: 35, ruecklauf: 28 };

/**
 * Kleinste Spreizung, mit der gerechnet wird [K].
 *
 * Unter 2 K wird der Volumenstrom absurd — 10 kW bei 0,5 K sind 17 m³/h, und
 * dafür gibt es keine Nennweite in der Tabelle. Eine Anlage mit weniger als
 * 2 K Spreizung baut niemand; wo die Zahlen sie hergeben, ist die Eingabe
 * falsch und nicht die Anlage.
 */
export const KLEINSTE_SPREIZUNG = 2;

/**
 * Zwei Kreise gelten als gleich heiß, wenn sie weniger als das auseinander
 * liegen [K].
 *
 * Derselbe Betrag, mit dem `plantDesign.markiereGemischteKreise` entscheidet,
 * ob ein Kreis einen Mischer braucht — und das ist kein Zufall: Ein Kreis
 * ohne Mischer *hängt* am Erzeuger und bestimmt deshalb dessen Rücklauf mit.
 * Stünden hier zwei verschiedene Toleranzen, könnte ein Kreis als „ungemischt"
 * gezeichnet werden und trotzdem beim Rücklauf unberücksichtigt bleiben.
 */
const GLEICH_HEISS = 2;

/**
 * Die Wärmeübergabe aller Räume in einem Durchgang.
 *
 * Vorher lief je Raum eine Schleife über alle TGA-Objekte. Bei einem Gebäude
 * mit 720 Räumen und 984 Objekten sind das 700 000 Vergleiche — und weil die
 * Auslegung bei jeder Eingabe im Anlagenblatt neu läuft, hing die
 * Tippgeschwindigkeit daran. Ein Durchgang über die Objekte genügt.
 *
 * Räume ohne Eintrag stehen bewusst **nicht** in der Karte: „nicht enthalten"
 * ist die Auskunft `unbekannt`, und ein Vorgabewert an dieser Stelle wäre
 * genau der Fehler, den dieses Modul behebt.
 */
export function heizflaechenArten(doc: BimDocument): Map<string, 'flaeche' | 'heizkoerper'> {
  const map = new Map<string, 'flaeche' | 'heizkoerper'>();
  for (const f of Object.values(doc.fixtures)) {
    if (!f.roomId) continue;
    // Eine Fläche schlägt den Heizkörper: wo beides steht, ist der
    // Heizkörper in aller Regel die Ergänzung im Bad, nicht der Kreis.
    if (f.type === 'underfloor' || f.type === 'manifold') {
      map.set(f.roomId, 'flaeche');
    } else if (
      (f.type === 'radiator' || f.type === 'radiator-tube' || f.type === 'convector') &&
      map.get(f.roomId) !== 'flaeche'
    ) {
      map.set(f.roomId, 'heizkoerper');
    }
  }
  return map;
}

/** Die Wärmeübergabe eines Raums — `unbekannt`, solange nichts darin steht. */
export function heizflaechenart(
  arten: ReadonlyMap<string, 'flaeche' | 'heizkoerper'>,
  roomId: string,
): Heizflaechenart {
  return arten.get(roomId) ?? 'unbekannt';
}

/**
 * Die Auslegungstemperatur **eines Kreises** aus seiner Wärmeübergabe.
 *
 * Das ist die Regel, die bis 1.23.0 als Ausdruck mitten in `deriveCircuits`
 * stand. Sie gehört hierher, weil sie dieselbe Frage beantwortet wie alles
 * andere in dieser Datei und weil `systemtemperaturVon` sie ebenfalls
 * braucht — die Trassenauslegung hat keine ausgelegten Kreise zur Hand und
 * muss trotzdem auf dieselbe Zahl kommen.
 *
 * `unbekannt` wird wie `flaeche` behandelt. Das ist die Annahme, nicht die
 * Wahrheit, und sie steht deshalb als Hinweis am Ergebnis der Auslegung.
 */
export function kreistemperatur(
  art: Heizflaechenart,
  anlagenblatt: Auslegungstemperatur,
  vorhaben?: Vorhaben,
): Auslegungstemperatur {
  if (art !== 'heizkoerper') return { ...anlagenblatt };
  // Ohne festgelegtes Vorhaben bleibt es bei der bisherigen Untergrenze —
  // ein älteres Projekt kennt das Feld nicht, und aus seinem Fehlen etwas
  // abzuleiten hieße raten.
  const mindest = vorhaben ? HEIZKOERPER_MINDEST[vorhaben] : HEIZKOERPER_MINDEST.neubau;
  return {
    vorlauf: Math.max(anlagenblatt.vorlauf, mindest.vorlauf),
    ruecklauf: Math.max(anlagenblatt.ruecklauf, mindest.ruecklauf),
  };
}

// ---------------------------------------------------------------------------
// Die maßgebliche Temperatur der Anlage
// ---------------------------------------------------------------------------

/**
 * Woher die Zahlen stammen, mit denen gerechnet wird.
 *
 * Die Angabe gehört auf das Blatt. Ein Rohrnetzbericht, in dem „50/40 °C"
 * ohne Absender steht, lässt den Leser glauben, das habe jemand so
 * eingetragen — und wer es dann im Anlagenblatt sucht, findet 35/28 und hält
 * das Programm für kaputt.
 */
export type Temperaturherkunft =
  /** So steht es im Anlagenblatt; keine Anhebung war nötig. */
  | 'anlagenblatt'
  /** Ein Kreis verlangt mehr, als das Anlagenblatt nennt — er gibt den Ton an. */
  | 'angehoben'
  /** Es gibt weder Anlagenblatt noch Kreise; gerechnet wird mit der Vorbelegung. */
  | 'vorgabe';

/** Die eine Temperatur, mit der diese Anlage ausgelegt wird. */
export interface Systemtemperatur extends Auslegungstemperatur {
  /** Spreizung Δϑ [K] — nie kleiner als `KLEINSTE_SPREIZUNG`. */
  spreizung: number;
  herkunft: Temperaturherkunft;
  /** Ein Satz fürs Heft, der die drei Zahlen erklärt. */
  begruendung: string;
}

/** Ein Kreis, so viel davon, wie für die Systemtemperatur zählt. */
export interface Kreistemperatur extends Auslegungstemperatur {
  label?: string;
}

export interface SystemtemperaturEingabe {
  /**
   * Was am Anlagenblatt steht — die **Untergrenze**, nicht das letzte Wort.
   *
   * Fehlt sie oder ist sie keine Zahl, greift `SYSTEMTEMPERATUR_VORGABE`.
   */
  anlagenblatt?: Partial<Auslegungstemperatur>;
  /** Die Kreise der Anlage. Leer heißt: es gibt noch keine. */
  kreise?: readonly Kreistemperatur[];
}

const ganz = (v: number): string => (Number.isInteger(v) ? String(v) : v.toFixed(1).replace('.', ','));

/**
 * Die maßgebliche Auslegungstemperatur der Anlage.
 *
 * Der Rechenweg in drei Sätzen:
 *
 *  1. **Der Vorlauf ist das Maximum** aus Anlagenblatt und allen Kreisen. Der
 *     Erzeuger liefert eine Temperatur, und sie muss den heißesten Bedarf
 *     decken; ein Mischer kann herunter, nicht hinauf.
 *  2. **Der Rücklauf ist das Maximum** aus Anlagenblatt und den Kreisen, die
 *     *am Erzeuger* fahren (also innerhalb `GLEICH_HEISS` am Vorlauf liegen).
 *     Ein Maximum, weil der höhere Rücklauf die **kleinere** Spreizung ergibt
 *     und damit den größeren Volumenstrom — von zwei möglichen Annahmen ist
 *     das die, bei der die Leitung nicht zu klein wird.
 *  3. **Ein gemischter Kreis zählt beim Rücklauf nicht mit.** Sein Rücklauf
 *     ist kälter als der des Erzeugerkreises, weil sein Mischer ihm kälteres
 *     Wasser gibt; ihn mitzurechnen hieße, den Erzeuger mit einer Spreizung
 *     auszulegen, die an seinen Stutzen nie anliegt. Deshalb die Auswahl
 *     über den Vorlauf.
 */
export function systemtemperatur(eingabe: SystemtemperaturEingabe = {}): Systemtemperatur {
  const blattVorlauf = zahl(eingabe.anlagenblatt?.vorlauf);
  const blattRuecklauf = zahl(eingabe.anlagenblatt?.ruecklauf);
  const kreise = (eingabe.kreise ?? []).filter(
    (k) => zahl(k.vorlauf) !== undefined && zahl(k.ruecklauf) !== undefined,
  );

  // Weder Blatt noch Kreise: Die Vorbelegung ist die einzige ehrliche
  // Antwort — und eine Antwort, die `NaN` heißt, ist keine.
  if (blattVorlauf === undefined && kreise.length === 0) {
    return {
      ...SYSTEMTEMPERATUR_VORGABE,
      spreizung: Math.max(
        KLEINSTE_SPREIZUNG,
        SYSTEMTEMPERATUR_VORGABE.vorlauf - SYSTEMTEMPERATUR_VORGABE.ruecklauf,
      ),
      herkunft: 'vorgabe',
      begruendung:
        `Im Modell steht keine Auslegungstemperatur und es ist kein Heizkreis ausgelegt. ` +
        `Gerechnet wird mit der Vorbelegung ${ganz(SYSTEMTEMPERATUR_VORGABE.vorlauf)}/` +
        `${ganz(SYSTEMTEMPERATUR_VORGABE.ruecklauf)} °C — der übliche Auslegungspunkt einer ` +
        `Wärmepumpe mit Flächenheizung. Sobald Räume mit Heizflächen belegt sind, folgt die ` +
        `Temperatur den Kreisen.`,
    };
  }

  const blatt: Auslegungstemperatur = {
    vorlauf: blattVorlauf ?? SYSTEMTEMPERATUR_VORGABE.vorlauf,
    ruecklauf: blattRuecklauf ?? SYSTEMTEMPERATUR_VORGABE.ruecklauf,
  };

  const vorlauf = Math.max(blatt.vorlauf, ...kreise.map((k) => k.vorlauf));
  // Nur die Kreise, die wirklich am Erzeuger hängen. Siehe Satz 3 oben.
  const amErzeuger = kreise.filter((k) => k.vorlauf >= vorlauf - GLEICH_HEISS);
  const ruecklauf = Math.max(blatt.ruecklauf, ...amErzeuger.map((k) => k.ruecklauf));
  const spreizung = Math.max(KLEINSTE_SPREIZUNG, vorlauf - ruecklauf);

  const angehoben = vorlauf !== blatt.vorlauf || ruecklauf !== blatt.ruecklauf;
  if (!angehoben) {
    return {
      vorlauf,
      ruecklauf,
      spreizung,
      herkunft: 'anlagenblatt',
      begruendung:
        `${ganz(vorlauf)}/${ganz(ruecklauf)} °C stehen so im Anlagenblatt; kein Heizkreis ` +
        `verlangt mehr. Spreizung ${ganz(spreizung)} K.`,
    };
  }

  const treiber = kreise.find((k) => k.vorlauf === vorlauf) ?? amErzeuger[0];
  const name = treiber?.label ? `„${treiber.label}"` : 'der heißeste Kreis';
  return {
    vorlauf,
    ruecklauf,
    spreizung,
    herkunft: 'angehoben',
    begruendung:
      `Das Anlagenblatt nennt ${ganz(blatt.vorlauf)}/${ganz(blatt.ruecklauf)} °C, ` +
      `${name} verlangt ${ganz(treiber?.vorlauf ?? vorlauf)}/${ganz(treiber?.ruecklauf ?? ruecklauf)} °C. ` +
      `Maßgeblich ist der Kreis: Der Erzeuger liefert eine einzige Vorlauftemperatur, und herunter ` +
      `mischen lässt sich, hinauf nicht. Gerechnet wird deshalb mit ${ganz(vorlauf)}/${ganz(ruecklauf)} °C, ` +
      `Spreizung ${ganz(spreizung)} K.`,
  };
}

/** Eine Zahl, die auch eine ist — `undefined`, `NaN` und `Infinity` fallen heraus. */
function zahl(v: number | undefined): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/**
 * Die Systemtemperatur **eines Modells** — ohne dass eine Auslegung laufen muss.
 *
 * Gebraucht wird das von der Trassenauslegung: Sie legt Nennweiten fest,
 * bevor irgendjemand die Anlage berechnet hat, und sie darf trotzdem nicht
 * auf eine andere Spreizung kommen als der Rohrnetzbericht danach.
 *
 * Der Weg ist derselbe wie in `plantDesign.deriveCircuits` und liefert
 * deshalb dieselbe Zahl: Gepflegte Kreise am Anlagenblatt gelten unverändert;
 * gibt es keine, entsteht je vorkommender Wärmeübergabeart eine
 * Kreistemperatur. Die Geschossaufteilung, die `deriveCircuits` zusätzlich
 * vornimmt, spielt hier keine Rolle — zwei Heizkörperkreise in EG und OG
 * haben dieselbe Temperatur.
 *
 * @param uebersteuerung Auslegungstemperatur, die statt des Anlagenblatts
 *   als Untergrenze gilt. Für Aufrufer, die von außen eine Vorgabe
 *   bekommen — sie bleibt eine Untergrenze und kein Freibrief, sonst wäre
 *   der Befund hier wieder da.
 */
export function systemtemperaturVon(
  doc: BimDocument,
  uebersteuerung?: Partial<Auslegungstemperatur>,
): Systemtemperatur {
  const anlage = plantOf(doc);
  const anlagenblatt: Partial<Auslegungstemperatur> = {
    vorlauf: zahl(uebersteuerung?.vorlauf) ?? anlage.design.flowTemperature,
    ruecklauf: zahl(uebersteuerung?.ruecklauf) ?? anlage.design.returnTemperature,
  };

  const gepflegt: HeatingCircuit[] = Object.values(doc.plant?.circuits ?? {});
  if (gepflegt.length) {
    return systemtemperatur({
      anlagenblatt,
      kreise: gepflegt.map((c) => ({
        label: c.label,
        vorlauf: c.flowTemperature,
        ruecklauf: c.returnTemperature,
      })),
    });
  }

  const blatt: Auslegungstemperatur = {
    vorlauf: anlagenblatt.vorlauf ?? SYSTEMTEMPERATUR_VORGABE.vorlauf,
    ruecklauf: anlagenblatt.ruecklauf ?? SYSTEMTEMPERATUR_VORGABE.ruecklauf,
  };
  const arten = heizflaechenArten(doc);
  const vorkommend = new Set<Heizflaechenart>();
  for (const raum of Object.values(doc.rooms)) {
    if (raum.isHeated === false) continue;
    vorkommend.add(heizflaechenart(arten, raum.id));
  }

  return systemtemperatur({
    anlagenblatt,
    kreise: [...vorkommend].map((art) => ({
      label: art === 'heizkoerper' ? 'Heizkörper' : 'Fußbodenheizung',
      ...kreistemperatur(art, blatt, doc.meta?.vorhaben),
    })),
  });
}
