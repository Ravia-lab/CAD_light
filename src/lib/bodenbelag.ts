/**
 * Wärmedurchlasswiderstand üblicher Bodenbeläge.
 * ---------------------------------------------------------------------------
 * **Wozu die Liste.** Der Belagswiderstand R_λB ist einer der drei Eingänge
 * des Kennfelds nach DIN EN 1264-2 — neben Verlegeabstand und
 * Estrichüberdeckung. Er entscheidet mit, wie viel ein Fußbodenheizkreis
 * trägt: unter Fliesen rund ein Drittel mehr als unter Teppich. Wer ihn nicht
 * kennt, kann eine Flächenheizung nicht auslegen, und wer ihn rät, legt sie
 * falsch aus.
 *
 * **Was diese Liste ist und was nicht.** Sie ist eine **Auswahlhilfe**, kein
 * Nachweis. Die Zahlen sind die Größenordnungen, die in den Unterlagen der
 * Systemanbieter und im Anhang von DIN EN 1264-2 für die jeweilige Belagsart
 * stehen; der Wert eines konkreten Belags steht auf dessen Datenblatt und
 * kann abweichen. Deshalb ist jeder Eintrag hier eine Vorauswahl, die der
 * Anwender bestätigt — und kein Wert, den das Programm selbst setzt.
 *
 * **Warum 0,15 der Grenzwert ist, der zählt.** DIN EN 1264-3 begrenzt den
 * Belagswiderstand, für den eine Flächenheizung ausgelegt werden darf, auf
 * 0,15 m²·K/W. Darüber trägt der Boden die Auslegungslast nicht mehr, ohne
 * dass die Oberflächentemperatur über die zulässige Grenze steigt.
 */

/** Kennung eines Belags — sie steht im Modell, nicht der Name. */
export type BodenbelagId =
  | 'estrich'
  | 'fliese'
  | 'vinyl'
  | 'laminat'
  | 'parkett10'
  | 'parkett14'
  | 'teppich-duenn'
  | 'teppich-dick';

export interface Bodenbelag {
  id: BodenbelagId;
  name: string;
  /** Wärmedurchlasswiderstand R_λB [m²·K/W]. */
  wert: number;
  /**
   * Farbe für die Darstellung im Grundriss und im Modell.
   *
   * Sie geht in keine Rechnung ein und ist keine Musterangabe — sie ist
   * ausschließlich dazu da, dass man im Bild sieht, wo welcher Belag liegt.
   * Ein Plan, in dem Bad und Wohnzimmer dieselbe graue Fläche sind, sagt
   * über den Belag nichts; ein Plan mit unterscheidbaren Flächen zeigt beim
   * Hinsehen, ob irgendwo noch der Vorgabewert steht.
   */
  farbe: string;
}

/**
 * Die Auswahlliste.
 *
 * `estrich` ist bewusst der erste Eintrag und trägt 0,00: „kein Belag" ist
 * eine gültige Angabe und nicht dasselbe wie „noch nichts eingetragen". Wer
 * auf dem blanken Estrich plant, soll das sagen können, ohne dass das
 * Programm daraus eine Annahme macht.
 */
export const BODENBELAEGE: readonly Bodenbelag[] = [
  { id: 'estrich', name: 'Estrich, ohne Belag', wert: 0.0, farbe: '#9ca3af' },
  { id: 'fliese', name: 'Fliese, Naturstein', wert: 0.0, farbe: '#cbd5e1' },
  { id: 'vinyl', name: 'Vinyl, PVC dünn', wert: 0.02, farbe: '#a8b3c4' },
  { id: 'laminat', name: 'Laminat', wert: 0.05, farbe: '#c9a97e' },
  { id: 'parkett10', name: 'Parkett 10 mm', wert: 0.06, farbe: '#b5854f' },
  { id: 'parkett14', name: 'Parkett 14 mm', wert: 0.09, farbe: '#a06f3c' },
  { id: 'teppich-duenn', name: 'Teppich dünn', wert: 0.1, farbe: '#b9a9a0' },
  { id: 'teppich-dick', name: 'Teppich dick', wert: 0.15, farbe: '#a08b80' },
];

/** Den Belag zu einer Kennung finden. */
export function belagNach(id: string | undefined): Bodenbelag | undefined {
  if (!id) return undefined;
  return BODENBELAEGE.find((b) => b.id === id);
}

/**
 * Der Belagswiderstand eines Raums [m²·K/W], oder `undefined`.
 *
 * `undefined` heißt: nichts erfasst. Es heißt ausdrücklich **nicht** null —
 * wer das verwechselt, legt eine Flächenheizung unter Teppich so aus, als
 * läge sie unter Fliesen, und liegt um ein Drittel daneben.
 */
export function belagsWiderstand(id: string | undefined): number | undefined {
  return belagNach(id)?.wert;
}

/** Die alte Liste ohne Kennung — noch benutzt, wo nur Name und Wert zählen. */
export const BELAG_WIDERSTAND: readonly { name: string; wert: number }[] = BODENBELAEGE;

/**
 * Die Grenze aus DIN EN 1264-3 [m²·K/W].
 *
 * Für einen höheren Belagswiderstand darf nicht ausgelegt werden — nicht,
 * weil die Rechnung versagt, sondern weil der Boden die Last dann nur noch
 * mit unzulässiger Oberflächentemperatur abgeben könnte.
 */
export const BELAG_GRENZE = 0.15;
