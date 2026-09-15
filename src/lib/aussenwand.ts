/**
 * Außenwände — erkennen und auf das nächste Geschoss übernehmen.
 * ---------------------------------------------------------------------------
 *
 * **Warum es diese Datei gibt.** Steht der erste Grundriss, ist die
 * Gebäudehülle festgelegt — und in fast jedem Haus steht sie im Obergeschoss
 * an derselben Stelle wie im Erdgeschoss. Wer sie oben von Hand nachzeichnet,
 * zeichnet sie nicht noch einmal, sondern *anders*: ein paar Zentimeter
 * daneben, eine andere Stärke, ein anderer Bauteilaufbau. Im Plan sieht das
 * gleich aus, in der Heizlast steht dann ein Haus mit zwei verschiedenen
 * Hüllen übereinander, und die Abweichung ist über die Transmissionsfläche
 * unmittelbar im Ergebnis, ohne dass irgendwo eine Meldung entsteht.
 *
 * **Was hier entschieden wird und was nicht.** Dieses Modul beantwortet drei
 * Fragen: welche Wände eines Geschosses Außenwände sind, wie sie auf ein
 * anderes Geschoss zu übertragen wären, und ob sich der Vorschlag überhaupt
 * lohnt. Es ändert **nichts** am Dokument. `planeUebernahme` liefert einen
 * Plan — neue Knoten, neue Wände, und die Zahl derer, die schon da sind —, den
 * der Speicher einhängt und in die Historie schreibt. Derselbe Schnitt wie in
 * `levelCopy.ts`, und aus demselben Grund: die Regel ist fachlich, nicht
 * Zustandsverwaltung, und nur so vollständig prüfbar.
 *
 * Wie dort vergibt die Funktion auch keine Kennungen selbst, sondern bekommt
 * den Erzeuger des Aufrufers hereingereicht. Führte sie einen eigenen Zähler,
 * hielte sie Zustand und wäre nicht mehr wiederholbar prüfbar.
 *
 * **Woher „Außenwand" kommt.** Maßgeblich ist `Wall.type === 'exterior'` —
 * die Angabe am Bauteil selbst. Naheliegend wäre `isExterior` am
 * `RoomBoundary` aus der Raumerkennung, aber das ist keine zweite Quelle: In
 * `roomDetection.ts` wird das Feld als `wall?.type === 'exterior'` gesetzt,
 * also aus genau derselben Angabe abgeleitet. Es dazuzunehmen brächte kein
 * Wissen, sondern drei Nachteile: ein `RoomBoundary` ist ein **Abschnitt**
 * einer Wand (eine Wand, die an zwei Räume grenzt, erscheint mehrfach), sein
 * `wallId` ist bei virtuellen Abschnitten leer, und es entsteht überhaupt nur
 * für Wände, die einen **erkannten** Raum begrenzen. Die Antwort auf „welche
 * Wände sind außen" hinge damit daran, ob der Grundriss schon geschlossen ist
 * — und ausgerechnet im halbfertigen Geschoss, in dem die Übernahme helfen
 * soll, käme keine einzige Wand zurück. Deshalb ohne Räume-Eingabe.
 *
 * **Die Toleranz ist nicht frei gewählt.** Sie ist die `WELD_TOLERANCE` der
 * Raumerkennung. Das ist der Abstand, ab dem der Rest des Programms zwei
 * Punkte bereits als denselben behandelt: `healSegments` verschweißt
 * Wandenden innerhalb dieses Maßes zu einem Cluster, unabhängig von den
 * Knotenkennungen. Wäre die Übernahme feinfühliger, legte sie eine zweite
 * Wand an, deren Enden die Raumerkennung anschließend auf die erste
 * schweißt — zwei Wände an einer Kante, doppelte Fläche, ein Bild, an dem
 * nichts auffällt. Die beiden Maße müssen also dasselbe sein, und der
 * sicherste Weg dahin ist, es nicht zweimal hinzuschreiben.
 */

import type { BimNode, Vec2, Wall } from '../types/bim';
import { WELD_TOLERANCE } from './roomDetection';

/**
 * Bis hierhin gelten zwei Wandenden als dieselbe Stelle [m].
 *
 * Abgeleitet und nicht gesetzt — siehe Kopfkommentar. Zusätzlich die
 * Fehlerabwägung, die die Richtung vorgibt, in die man irren darf: Ist die
 * Toleranz zu klein, entsteht eine zweite Wand über der ersten. Zwei
 * deckungsgleiche Wände sind im Plan nicht zu unterscheiden, verdoppeln aber
 * jede Fläche in der Heizlast — der Fehler ist unsichtbar und teuer. Ist sie
 * zu groß, bleibt eine tatsächlich versetzte Wand aus; die fehlt im Plan und
 * fällt beim nächsten Hinsehen auf. Der sichtbare Fehler ist der billigere,
 * deshalb im Zweifel großzügig.
 */
export const UEBERNAHME_TOLERANZ = WELD_TOLERANCE;

/** Die Achse einer Wand, aufgelöst zu zwei Punkten. */
interface Achse {
  a: Vec2;
  b: Vec2;
}

/** Zwei Punkte, die für die Übernahme derselbe sind. */
function derselbePunkt(p: Vec2, q: Vec2): boolean {
  // Euklidischer Abstand und nicht Koordinate für Koordinate: ein Kästchen
  // ließe eine diagonale Verschiebung von 7 cm als „dieselbe Stelle" durch,
  // obwohl beide Koordinaten je nur 5 cm abweichen.
  return Math.hypot(q.x - p.x, q.y - p.y) <= UEBERNAHME_TOLERANZ;
}

/**
 * Liegen zwei Wände auf derselben Achse?
 *
 * Beide Richtungen werden geprüft. Eine Wand, die jemand von rechts nach
 * links gezogen hat, ist dieselbe Wand wie die von links nach rechts — nur
 * mit vertauschten Endknoten. Verglichen man ausschließlich a↔a und b↔b,
 * entstünde für jede andersherum gezeichnete Wand eine Kopie, und zwar genau
 * die unsichtbare Doppelung, gegen die dieser Vergleich antritt.
 */
function dieselbeAchse(x: Achse, y: Achse): boolean {
  if (derselbePunkt(x.a, y.a) && derselbePunkt(x.b, y.b)) return true;
  return derselbePunkt(x.a, y.b) && derselbePunkt(x.b, y.a);
}

/** Achse einer Wand — `undefined`, wenn ein Endknoten fehlt. */
function achseVon(wall: Wall, nodes: Readonly<Record<string, BimNode>>): Achse | undefined {
  const a = nodes[wall.a];
  const b = nodes[wall.b];
  if (!a || !b) return undefined;
  return { a, b };
}

/**
 * Die Außenwände eines Geschosses.
 *
 * Eine Wand ohne beide Endknoten bleibt außen vor. Sie hat keine Achse, also
 * lässt sie sich weder vergleichen noch übertragen; eine geratene Lage wäre
 * schlimmer als eine fehlende Wand, die im Plan sofort auffällt (dieselbe
 * Abwägung wie beim Kopieren eines Geschosses in `levelCopy.ts`).
 */
export function aussenwaendeVon(
  walls: readonly Wall[],
  nodes: Readonly<Record<string, BimNode>>,
  levelId: string,
): Wall[] {
  return walls.filter(
    (w) => w.levelId === levelId && w.type === 'exterior' && Boolean(nodes[w.a] && nodes[w.b]),
  );
}

/** Das Ergebnis des Abgleichs: was fehlt und was schon steht. */
interface Abgleich {
  /** Vorlagewände, für die im Ziel noch nichts an derselben Stelle liegt. */
  zuUebernehmen: Wall[];
  /** Wände im Zielgeschoss, die schon an derselben Stelle liegen. */
  schonDa: number;
}

/**
 * Vorlage gegen Ziel halten.
 *
 * Verglichen wird gegen **alle** Wände des Zielgeschosses und nicht nur gegen
 * dessen Außenwände. Die doppelte Fläche entsteht unabhängig vom Wandtyp;
 * steht dort schon eine Wand, die nur falsch eingestuft ist, ist das eine
 * Frage an die Einstufung und kein Grund, eine zweite darüberzulegen.
 */
function gleicheAb(
  walls: readonly Wall[],
  nodes: Readonly<Record<string, BimNode>>,
  vonLevelId: string,
  nachLevelId: string,
): Abgleich {
  const vorlage = aussenwaendeVon(walls, nodes, vonLevelId);
  const zielAchsen: Achse[] = [];
  for (const w of walls) {
    if (w.levelId !== nachLevelId) continue;
    const achse = achseVon(w, nodes);
    if (achse) zielAchsen.push(achse);
  }

  const zuUebernehmen: Wall[] = [];
  let schonDa = 0;
  for (const wand of vorlage) {
    const achse = achseVon(wand, nodes);
    if (!achse) continue;
    if (zielAchsen.some((z) => dieselbeAchse(achse, z))) schonDa++;
    else zuUebernehmen.push(wand);
  }
  return { zuUebernehmen, schonDa };
}

/** Was aus einer Übernahme würde, bevor sie stattfindet. */
export interface UebernahmePlan {
  neueKnoten: BimNode[];
  neueWaende: Wall[];
  /** Wände im Zielgeschoss, die schon an derselben Stelle liegen. */
  schonDa: number;
}

export interface UebernahmeEingabe {
  /** Darf ruhig alle Geschosse enthalten; gefiltert wird hier. */
  walls: readonly Wall[];
  nodes: Readonly<Record<string, BimNode>>;
  vonLevelId: string;
  nachLevelId: string;
  /** Geschosshöhe des Zielgeschosses [m] — die neuen Wände bekommen sie. */
  hoehe: number;
  /** Kennungen vergeben — dieselbe Quelle wie im Store. */
  uid: (prefix: string) => string;
}

/**
 * Der Plan für eine Übernahme. Ändert nichts, legt nur vor.
 *
 * **Knoten werden je Zielgeschoss neu angelegt, nicht geteilt.** Ein
 * `BimNode` trägt selbst eine `levelId`; ein von zwei Geschossen geteilter
 * Knoten wäre also schon in den Daten widersprüchlich. Praktisch wiegt
 * schwerer, dass ein Knoten parametrisch wirkt: Wer ihn zieht, zieht jede
 * Wand daran mit. Geteilt hieße, dass ein Versatz im Obergeschoss die
 * Erdgeschosswand mitnimmt — zwei Grundrisse, die sich nicht mehr getrennt
 * bearbeiten lassen. `levelCopy.ts` hält es beim Kopieren eines ganzen
 * Geschosses genauso.
 *
 * **Je Vorlageknoten entsteht genau ein Zielknoten**, nicht je Wandende. Vier
 * Außenwände eines Rechtecks haben acht Enden, aber nur vier Ecken. Gäbe man
 * jeder Wand ihr eigenes Paar, lägen in jeder Ecke zwei Knoten übereinander:
 * Die Raumerkennung verschweißt sie zwar (deshalb fiele es im Bild nicht
 * auf), aber das Ziehen einer Ecke bewegte nur noch eine der beiden Wände und
 * risse den Grundriss auf.
 *
 * **Liegt im Zielgeschoss schon ein Knoten innerhalb der Toleranz, wird der
 * benutzt.** Der neue Wandzug hängt damit an dem, was dort schon steht, statt
 * daneben. Das kostet, was es kosten muss: Die Ecke sitzt dann auf dem
 * vorhandenen Knoten und bis zu `UEBERNAHME_TOLERANZ` neben der Vorlage. Ein
 * loses Ende einen Zentimeter neben einer Wandecke wäre der schlechtere
 * Tausch — es sieht angeschlossen aus und ist es nicht.
 *
 * **Öffnungen wandern nicht mit.** Fenster und Türen sitzen im Obergeschoss
 * anders: andere Räume, andere Brüstungshöhen, ein Treppenauge statt der
 * Haustür. Eine mitkopierte Öffnung wäre eine Behauptung über ein Geschoss,
 * das niemand aufgemessen hat — und sie ginge als Fensterfläche unmittelbar
 * in die Heizlast und in den solaren Gewinn ein. Eine fehlende Öffnung
 * dagegen sieht man beim ersten Blick auf den Plan. Deshalb trägt der Plan
 * gar kein Feld dafür: Wer sie eines Tages doch übernehmen will, muss die
 * Entscheidung neu treffen und kann sie nicht versehentlich durchrutschen
 * lassen.
 */
export function planeUebernahme(opt: UebernahmeEingabe): UebernahmePlan {
  const { walls, nodes, vonLevelId, nachLevelId, hoehe, uid } = opt;
  const { zuUebernehmen, schonDa } = gleicheAb(walls, nodes, vonLevelId, nachLevelId);

  const neueKnoten: BimNode[] = [];
  const neueWaende: Wall[] = [];

  /** Knoten, die im Zielgeschoss schon stehen — auf die darf eingerastet werden. */
  const vorhandene = Object.values(nodes).filter((n) => n.levelId === nachLevelId);
  /** Vorlageknoten → Knoten im Ziel. Schlüssel ist die Kennung, nicht die Lage. */
  const uebersetzt = new Map<string, string>();

  const knotenFuer = (vorlageKnoten: BimNode): string => {
    const schon = uebersetzt.get(vorlageKnoten.id);
    if (schon !== undefined) return schon;
    const treffer = vorhandene.find((k) => derselbePunkt(k, vorlageKnoten));
    const id = treffer ? treffer.id : uid('n');
    if (!treffer) {
      // Bewusst Feld für Feld und nicht als Streuung der Vorlage: `locked`
      // ist eine Geste an *diesem* Knoten in *diesem* Geschoss. Mitgenommen
      // stünde im Obergeschoss eine Ecke, die sich nicht ziehen lässt, ohne
      // dass jemand sie festgesetzt hätte.
      neueKnoten.push({ id, x: vorlageKnoten.x, y: vorlageKnoten.y, levelId: nachLevelId });
    }
    uebersetzt.set(vorlageKnoten.id, id);
    return id;
  };

  for (const vorlage of zuUebernehmen) {
    const va = nodes[vorlage.a];
    const vb = nodes[vorlage.b];
    // Von `aussenwaendeVon` bereits ausgeschlossen; die Abfrage steht für den
    // Übersetzer und für den Tag, an dem jemand die Vorlage anders befüllt.
    if (!va || !vb) continue;
    const a = knotenFuer(va);
    const b = knotenFuer(vb);

    /*
     * Die neue Wand wird Feld für Feld gebaut und nicht aus der Vorlage
     * gestreut. Eine Streuung nähme jedes Feld mit, das `Wall` heute hat und
     * morgen bekommt — auch die, die nicht mitdürfen. Übernommen wird
     * ausschließlich, was den Grundriss beschreibt: Achse, Stärke, Typ,
     * Bauteilaufbau und die Zeichenebene (ohne die läge die Wand auf keiner).
     *
     * Draußen bleiben:
     *  • `height` — kommt aus dem Zielgeschoss und nicht aus der Vorlage.
     *    Ein Obergeschoss unter der Dachschräge ist selten so hoch wie das
     *    Erdgeschoss, und die Wandhöhe geht als Fläche direkt in die Heizlast.
     *  • `uValue`, `material`, `thermalBridgeSupplement` — am Bauteil erfasste
     *    Angaben über *diese* Wand. Der Bauteilaufbau wandert mit und bringt
     *    seinen eigenen U-Wert; ein zusätzlich kopierter Wert am Bauteil wäre
     *    von einem gemessenen nicht mehr zu unterscheiden.
     *  • `boundary` — eine Übersteuerung für einen Fall, den die Geometrie
     *    nicht hergibt (Innenwand zur Garage). Im Obergeschoss ist es ein
     *    anderer Fall.
     *  • `confidence` — das Vertrauensmaß der Bilderkennung auf dem Plan des
     *    *Quellgeschosses*. Für die Kopie gibt es kein Bild.
     *  • `locked` — eine Geste an dieser Wand, siehe Knoten oben.
     */
    const wand: Wall = {
      id: uid('w'),
      levelId: nachLevelId,
      a,
      b,
      thickness: vorlage.thickness,
      height: hoehe,
      type: vorlage.type,
      layerId: vorlage.layerId,
    };
    // Nur setzen, wenn es etwas zu setzen gibt: ein Feld, das da ist und
    // `undefined` trägt, ist beim Vergleich zweier Wände nicht dasselbe wie
    // ein fehlendes.
    if (vorlage.constructionId !== undefined) wand.constructionId = vorlage.constructionId;
    // Das Kennzeichen gehört zur Stärke und nicht neben sie: Ist die Stärke
    // der Vorlage geschätzt (Raumscan-Import), ist die übernommene es
    // genauso. Ließe man es weg, sähe die Kopie aus wie ein gesetztes Maß,
    // und der Schritt „Wandstärken bestätigen" wäre für sie stillschweigend
    // erledigt, ohne dass jemand hingesehen hat.
    if (vorlage.thicknessEstimated === true) wand.thicknessEstimated = true;
    neueWaende.push(wand);
  }

  return { neueKnoten, neueWaende, schonDa };
}

/**
 * Lohnt es sich, die Übernahme überhaupt vorzuschlagen?
 *
 * `true`, wenn das Quellgeschoss Außenwände hat und im Ziel mehr davon fehlen
 * als schon dastehen. Die Schwelle liegt bei der Hälfte, und zwar in diese
 * Richtung: Hat jemand oben schon die Hälfte der Hülle gezogen, arbeitet er
 * dort offensichtlich von Hand, und ein Vorschlag wäre Drängeln. Fehlt die
 * Mehrheit, ist die Frage berechtigt.
 *
 * Kennungen werden hier keine vergeben — es entsteht nichts, es wird nur
 * gezählt. Die Oberfläche darf das bei jedem Zeichnen fragen, ohne dass der
 * Kennungszähler des Speichers dabei weiterläuft.
 */
export function uebernahmeSinnvoll(
  walls: readonly Wall[],
  nodes: Readonly<Record<string, BimNode>>,
  vonLevelId: string,
  nachLevelId: string,
): boolean {
  const { zuUebernehmen, schonDa } = gleicheAb(walls, nodes, vonLevelId, nachLevelId);
  return zuUebernehmen.length > schonDa;
}
