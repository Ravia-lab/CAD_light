/**
 * Wie eine Leitung im Plan heißt — und warum nicht „DN 12".
 * ---------------------------------------------------------------------------
 * **Der Befund.** Im Plan stand am Heizkörper „DN 12". Ein Heizungsbauer
 * liest das als „12er Rohr", und ein 12er Rohr gibt es am Heizkörper nicht:
 * angeschlossen wird mit **15 × 1** in Kupfer oder **16 × 2** in
 * Mehrschichtverbund, und das Ventil davor ist ½" — also DN 15. Ein Plan,
 * der DN 12 an den Heizkörper schreibt, sieht für jeden Praktiker falsch
 * aus.
 *
 * **Und das Rohr war richtig.** Die Nennweite wird in `hydraulics.ts` nicht
 * gewählt, sondern *zugeordnet*: DN mit dem geringsten Abstand zum lichten
 * Innendurchmesser. Cu 15 × 1 hat d_i = 13 mm, und 13 liegt näher an 12 als
 * an 15 — daher DN 12. Dieselbe Rechnung: MSV 16 × 2 → d_i = 12 → DN 12.
 * Die Zuordnung ist nicht erfunden, sie entspricht der Sanitärkonvention
 * (DVGW W 534: Cu 15 → DN 12). Nur redet im Heizungsbau niemand so.
 *
 * Die kleinste Abmessung in beiden Tabellen **ist** bereits das
 * Handwerksmindestmaß — `COPPER_PIPES` beginnt bei 15 × 1,
 * `MULTILAYER_PIPES` bei 16 × 2. Der Rohrausleger konnte also nie etwas
 * Kleineres wählen. Es war von Anfang an nur die Beschriftung.
 *
 * **Was dieses Modul deshalb tut.** Es übersetzt eine Leitung in die
 * Bezeichnung, unter der sie bestellt und verbaut wird — Werkstoffkürzel
 * plus Außendurchmesser × Wanddicke. Die Nennweite verschwindet damit nicht:
 * sie bleibt dort, wo sie die richtige Größe ist, nämlich an Armaturen,
 * Gewinden und im Übergabedatensatz. Ein Kugelhahn hat eine Nennweite, ein
 * Rohr hat ein Maß.
 *
 * **Was es nicht tut: raten.** Fehlt der Werkstoff oder passt der
 * Außendurchmesser zu keiner Tabellenzeile, kommt die Nennweite zurück und
 * nicht ein plausibel aussehendes Maß. Eine erfundene Abmessung im Plan ist
 * schlimmer als eine sperrige Angabe — nach ihr wird bestellt.
 *
 * Schichtgrenze: nur `types` und andere `lib`-Bausteine.
 */

import type { PipeMaterial } from '../types/bim';
import { PIPE_TABLES } from './hydraulics';

/**
 * Werkstoffkürzel, wie es auf einen Plan passt.
 *
 * Kurz genug für eine Beschriftung neben der Linie und lang genug, dass es
 * niemand verwechselt. Ausgeschrieben steht der Werkstoff in der Legende
 * des Druckblatts (`PIPE_MATERIAL_LABELS`) — das Kürzel allein wäre für
 * jemanden, der den Plan zum ersten Mal sieht, zu wenig.
 */
export const WERKSTOFF_KUERZEL: Record<PipeMaterial, string> = {
  kupfer: 'Cu',
  stahl: 'St',
  edelstahl: 'ES',
  pex: 'PE-Xa',
  verbund: 'MSV',
  ppr: 'PP-R',
};

/** Das Nötigste, um eine Leitung zu benennen. */
export interface Rohrangabe {
  /** Nennweite DN [mm] — immer vorhanden. */
  nominalDiameter: number;
  /** Tatsächlicher Außendurchmesser [mm], wenn bekannt. */
  outerDiameter?: number;
  /** Werkstoff des Abschnitts, wenn bekannt. */
  material?: PipeMaterial;
}

/**
 * Außendurchmesser und Werkstoff auf die Wanddicke zurückführen.
 *
 * Die Wanddicke wird **nicht** mitgeführt, sondern aus der Werkstofftabelle
 * geholt. Das ist Absicht: sie ist keine freie Größe, sondern gehört zur
 * Abmessung. Wer sie am Abschnitt speicherte, könnte ein 15 × 1,5 anlegen,
 * das es nicht gibt.
 *
 * Toleranz 0,05 mm, weil 76,1 und 88,9 keine glatten Zahlen sind und ein
 * Gleitkommavergleich auf Gleichheit dort irgendwann danebengeht.
 */
export function handelsmass(
  material: PipeMaterial | undefined,
  aussen: number | undefined,
): string | undefined {
  if (!material || aussen === undefined || !Number.isFinite(aussen)) return undefined;
  const tabelle = PIPE_TABLES[material];
  if (!tabelle) return undefined;
  const treffer = tabelle.find((d) => Math.abs(d.outer - aussen) < 0.05);
  return treffer?.label;
}

/**
 * Die kurze Bezeichnung für den Plan — „Cu 15 × 1" statt „DN 12".
 *
 * Fällt auf die Nennweite zurück, wenn sich kein Maß ermitteln lässt. Der
 * Rückfall ist sichtbar („DN 20") und nicht stillschweigend, damit an einer
 * handgezogenen Leitung ohne Werkstoff erkennbar bleibt, dass dort noch
 * nichts festgelegt ist.
 */
export function rohrbezeichnung(run: Rohrangabe, rueckfallWerkstoff?: PipeMaterial): string {
  const werkstoff = run.material ?? rueckfallWerkstoff;
  const mass = handelsmass(werkstoff, run.outerDiameter);
  if (!mass || !werkstoff) return `DN ${run.nominalDiameter}`;
  return `${WERKSTOFF_KUERZEL[werkstoff]} ${mass}`;
}

/**
 * Dieselbe Angabe mit der Nennweite dahinter — für Inspektor, Legende und
 * Bericht, wo der Platz reicht.
 *
 * Beides nebeneinander zu zeigen ist kein Zaudern, sondern der Punkt: Wer
 * das Rohr bestellt, braucht `Cu 15 × 1`; wer das Ventil davor bestellt,
 * braucht DN 15. Der Plan allein kann die Frage nicht beantworten, welche
 * der beiden Zahlen gerade gemeint ist — nebeneinander schon.
 */
export function rohrbezeichnungLang(run: Rohrangabe, rueckfallWerkstoff?: PipeMaterial): string {
  const kurz = rohrbezeichnung(run, rueckfallWerkstoff);
  if (kurz.startsWith('DN ')) return kurz;
  return `${kurz} · DN ${run.nominalDiameter}`;
}
