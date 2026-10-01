/**
 * Nutzungseinheiten — Wohnungen, Gewerbeeinheiten, Gemeinschaftsflächen.
 *
 * **Die Entscheidung, die hier getroffen wurde.** Die Frage stand so im Raum:
 * Soll die Wohnung eine **Stufe zwischen Geschoss und Raum** werden, oder
 * bleibt es dabei, dass mehrere Wohnungen nur mehrere Heizkreise sind? Beides
 * ist falsch, und zwar aus einem Grund, der sich am ersten Projekt zeigt:
 *
 * **Eine Hierarchie bricht an der Maisonettewohnung.** Eine Wohnung über zwei
 * Geschosse passt nicht *unter* ein Geschoss. Eine Zuordnung am Raum
 * (`room.unitId`) greift dagegen über Geschosse hinweg, ohne dass am Aufbau
 * des Modells etwas umgestellt werden müsste. Sie ist zugleich billiger und
 * richtiger — das kommt selten zusammen.
 *
 * **Warum es die Einheit überhaupt geben muss.** § 60c Abs. 1 GModG knüpft die
 * Pflicht zum hydraulischen Abgleich an „sechs Wohnungen oder sonstige
 * selbständige Nutzungseinheiten". Diese Zahl stand bisher als **getippte
 * Angabe** im Anlagenblatt (`plant.dhw.units`) — das Modell hätte sie wissen
 * können und wusste sie nicht. Dieselbe Zahl geht in die Trinkwasser-,
 * Speicher- und Gefäßauslegung ein. Eine getippte Zahl, die niemand gegen das
 * Modell hält, ist einer der stillsten Fehler überhaupt: Sie ist plausibel,
 * sie steht im Nachweis, und sie ist falsch.
 *
 * **Was hier nicht passiert.** Es wird keine Einheit geraten. Ein Gebäude ohne
 * Zuordnung ist ein Gebäude ohne erfasste Einheiten — und nicht „eine
 * Wohnung". Der Unterschied zwischen „nicht erfasst" und „eins" ist genau der,
 * den ein Programm nicht verwischen darf.
 */

import type { BimDocument, Room } from '../types/bim';

/** Art der Einheit — sie entscheidet, ob sie als Wohnung mitzählt. */
export type EinheitArt = 'wohnung' | 'gewerbe' | 'gemeinschaft';

export const EINHEIT_LABELS: Record<EinheitArt, string> = {
  wohnung: 'Wohnung',
  gewerbe: 'Gewerbeeinheit',
  gemeinschaft: 'Gemeinschaftsfläche',
};

/**
 * Schwelle des § 60c Abs. 1 GModG: Ab dieser Zahl selbständiger
 * Nutzungseinheiten ist der hydraulische Abgleich Pflicht.
 */
export const ABGLEICHPFLICHT_AB = 6;

export interface Nutzungseinheit {
  id: string;
  /** „Wohnung 1", „EG links", „Praxis" — frei und vom Anwender vergeben. */
  name: string;
  art: EinheitArt;
  /** Lage im Haus, falls erfasst — reine Anzeige. */
  lage?: string;
}

/** Was eine Einheit im Modell umfasst — gerechnet, nicht gespeichert. */
export interface Einheitsbilanz {
  einheit: Nutzungseinheit;
  roomIds: string[];
  /** Lichte Fläche aller Räume [m²]. */
  flaeche: number;
  /** Nur die beheizten Räume [m²]. */
  beheizteFlaeche: number;
  /** Zahl der Räume, davon beheizt. */
  raeume: number;
  beheizteRaeume: number;
  /** Geschosse, über die sich die Einheit erstreckt. */
  geschosse: string[];
  /** Erstreckt sie sich über mehr als ein Geschoss? */
  maisonette: boolean;
  /** Summe der von RaVia gerechneten Norm-Heizlast [W]; 0, wo keine vorliegt. */
  heizlastW: number;
}

/**
 * Die Einheiten eines Gebäudes mit ihren Räumen.
 *
 * Einheiten ohne jeden Raum erscheinen mit leerer Liste — sie sind angelegt,
 * aber noch nicht belegt, und das ist etwas anderes als „gibt es nicht".
 */
export function einheitsbilanzen(doc: BimDocument): Einheitsbilanz[] {
  const einheiten = Object.values(doc.units ?? {});
  if (!einheiten.length) return [];

  const raeumeJeEinheit = new Map<string, Room[]>();
  for (const r of Object.values(doc.rooms)) {
    if (!r.unitId) continue;
    const liste = raeumeJeEinheit.get(r.unitId);
    if (liste) liste.push(r);
    else raeumeJeEinheit.set(r.unitId, [r]);
  }

  return einheiten.map((einheit) => {
    const raeume = raeumeJeEinheit.get(einheit.id) ?? [];
    const beheizt = raeume.filter((r) => r.isHeated);
    const geschosse = [...new Set(raeume.map((r) => r.levelId))];
    return {
      einheit,
      roomIds: raeume.map((r) => r.id),
      flaeche: raeume.reduce((s, r) => s + r.area, 0),
      beheizteFlaeche: beheizt.reduce((s, r) => s + r.area, 0),
      raeume: raeume.length,
      beheizteRaeume: beheizt.length,
      geschosse,
      maisonette: geschosse.length > 1,
      heizlastW: raeume.reduce(
        (s, r) => s + (r.normHeatLoad?.total ?? 0),
        0,
      ),
    };
  });
}

/** Räume, die keiner Einheit zugeordnet sind. */
export function ohneEinheit(doc: BimDocument): Room[] {
  return Object.values(doc.rooms).filter((r) => !r.unitId);
}

export interface Einheitenstand {
  /** Zahl der erfassten Einheiten insgesamt. */
  gesamt: number;
  /** Davon Wohnungen — die Zahl, auf die § 60c abstellt. */
  wohnungen: number;
  gewerbe: number;
  gemeinschaft: number;
  /**
   * Selbständige Nutzungseinheiten im Sinne des § 60c: Wohnungen **und**
   * Gewerbeeinheiten. Gemeinschaftsflächen zählen nicht — ein Treppenhaus ist
   * keine selbständige Einheit.
   */
  selbstaendig: number;
  /** Greift die Abgleichpflicht nach § 60c Abs. 1? */
  abgleichpflicht: boolean;
  /** Einheiten ohne jeden Raum. */
  leer: string[];
  /** Einheiten über mehr als ein Geschoss. */
  maisonetten: string[];
  /** Räume ohne Zuordnung. */
  raeumeOhne: number;
}

export function einheitenstand(doc: BimDocument): Einheitenstand {
  const bilanzen = einheitsbilanzen(doc);
  const zaehle = (art: EinheitArt): number => bilanzen.filter((b) => b.einheit.art === art).length;
  const wohnungen = zaehle('wohnung');
  const gewerbe = zaehle('gewerbe');
  const selbstaendig = wohnungen + gewerbe;
  return {
    gesamt: bilanzen.length,
    wohnungen,
    gewerbe,
    gemeinschaft: zaehle('gemeinschaft'),
    selbstaendig,
    abgleichpflicht: selbstaendig >= ABGLEICHPFLICHT_AB,
    leer: bilanzen.filter((b) => b.raeume === 0).map((b) => b.einheit.name),
    maisonetten: bilanzen.filter((b) => b.maisonette).map((b) => b.einheit.name),
    raeumeOhne: ohneEinheit(doc).length,
  };
}

/**
 * Stimmt die im Anlagenblatt eingetragene Zahl der Wohneinheiten mit dem
 * Modell überein?
 *
 * `undefined` heißt: Es gibt nichts zu vergleichen, weil keine Einheiten
 * erfasst sind. Das ist kein Befund — wer keine Einheiten zuordnet, bekommt
 * keine Rückfrage zu einer Zahl, die er von Hand gesetzt hat.
 */
export function einheitenAbgleich(
  doc: BimDocument,
  eingetragen: number,
): { stimmt: boolean; gezaehlt: number; eingetragen: number } | undefined {
  const stand = einheitenstand(doc);
  if (stand.gesamt === 0) return undefined;
  return { stimmt: stand.selbstaendig === eingetragen, gezaehlt: stand.selbstaendig, eingetragen };
}

/**
 * Ein Vorschlag für den Namen der nächsten Einheit.
 *
 * Fortlaufend nummeriert, und zwar über die vorhandenen Namen hinweg: Wer
 * „Wohnung 1" bis „Wohnung 4" hat und eine löscht, bekommt trotzdem
 * „Wohnung 5" — Nummern wiederzuverwenden heißt, zwei verschiedene Wohnungen
 * im Schriftverkehr gleich zu nennen.
 */
export function naechsterName(doc: BimDocument, art: EinheitArt = 'wohnung'): string {
  const marke = EINHEIT_LABELS[art];
  const zahlen = Object.values(doc.units ?? {})
    .map((e) => {
      const m = new RegExp(`^${marke}\\s+(\\d+)$`).exec(e.name.trim());
      return m ? Number(m[1]) : 0;
    });
  return `${marke} ${Math.max(0, ...zahlen) + 1}`;
}
