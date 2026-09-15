/**
 * Der U-Wert eines Bauteils — und woher er kommt.
 * ---------------------------------------------------------------------------
 * **Warum es diese Datei gibt.** Die Frage „welchen U-Wert hat diese Wand?"
 * wurde im Programm an vier Stellen gestellt und an vier Stellen anders
 * beantwortet. Der Export nahm den Aufbau aus dem Katalog, dann den am Bauteil
 * erfassten Wert, dann einen Vorgabewert nach Bauteilart. Der Heizlast-
 * überschlag nahm `b.uValue ?? 0`. Die Raumerkennung reichte `wall.uValue`
 * durch und sah den Katalog gar nicht. Die Modellprüfung meldete dazu, es
 * werde „ein Standardwert angenommen".
 *
 * Der Schaden daraus ist gemessen und kein Gedankenspiel. Am Referenzhaus,
 * allen Wänden den U-Wert genommen:
 *
 *     mit U-Werten   5,47 kW   →  Gerät 8 kW
 *     ohne U-Werte   3,88 kW   →  Gerät 6 kW      (−29 %)
 *
 * Die fehlende Wand fiel mit 0 W aus der Bilanz — sie war nicht etwa
 * schlecht gedämmt, sie war gar nicht mehr da. Und über den Weg, auf dem so
 * etwas im Alltag entsteht (`hostPatch` legte einen Aufbau mit `uValue: 0`
 * an), stand am Ende **kein einziger Hinweis** im Bericht: 0 ist kein
 * fehlender Wert, also griff keine Prüfung.
 *
 * **Was dieses Modul anders macht.** Es beantwortet die Frage einmal, für
 * alle, und es antwortet nicht mit einer Zahl, sondern mit einer Zahl **und
 * ihrer Herkunft**. Genau daran hängt die Entscheidung, die ein Nachweis
 * treffen muss: Ein Wert aus dem Katalog darf gedruckt werden, muss aber als
 * Annahme kenntlich sein. Ein fehlender Wert darf **nicht** als Zahl
 * gedruckt werden — dort gehört ein Strich hin und ein Vorbehalt an die
 * Summe. Eine Funktion, die nur `number` zurückgibt, kann diesen Unterschied
 * nicht transportieren; sie zwingt jeden Aufrufer zu einem `?? 0`, und das
 * `?? 0` ist der Fehler.
 *
 * **Die Rangfolge** — dieselbe, die der Export seit jeher benutzt:
 *
 *   1. `aufbau`  — der zugewiesene Bauteilaufbau aus dem Katalog. Er schlägt
 *      den Wert am Bauteil, weil sonst die Katalogpflege an den Wänden
 *      vorbeiginge, die sie beschreibt: wer den Aufbau „AW 36,5 + WDVS"
 *      ändert, meint alle Wände mit diesem Aufbau.
 *   2. `bauteil` — der am einzelnen Bauteil erfasste Wert.
 *   3. `katalog` — der Vorgabewert nach Bauteilart. Eine Annahme, aber eine
 *      begründete und eine, die in der richtigen Größenordnung liegt.
 *   4. `fehlt`   — es gibt keinen. Kommt bei Boden, Decke und Dach vor, wo es
 *      keinen Vorgabewert nach Bauteilart gibt (siehe unten).
 *
 * **Was als erfasst gilt.** Nur eine endliche Zahl größer null. Eine 0 ist
 * kein U-Wert: ein Bauteil, das nichts durchlässt, gibt es nicht. Sie ist
 * entweder ein nicht ausgefülltes Feld oder ein Eingabefehler, und in beiden
 * Fällen ist der Vorgabewert die bessere Auskunft — begleitet von einem
 * Befund aus `validation.ts`, der sagt, dass geraten wurde. Einzige Ausnahme
 * ist der Durchgang: er *ist* ein Loch und hat mit Recht keinen Widerstand.
 *
 * Schichtgrenze: nur Typen, keine Abhängigkeit auf Store oder Ansicht.
 */

import type { Construction, Level, OpeningKind, Room, RoofDefinition, WallType } from '../types/bim';

/**
 * Woher der U-Wert stammt.
 *
 * Die Reihenfolge der Stufen ist zugleich ihre Belastbarkeit, von stark nach
 * schwach. Wer sie in einem Nachweis ausweist, gibt dem Leser genau die
 * Auskunft, die er braucht, um zu entscheiden, ob er der Zahl folgen kann.
 */
export type UWertHerkunft = 'aufbau' | 'bauteil' | 'katalog' | 'fehlt';

/** Der U-Wert eines Bauteils mit dem, was man über ihn wissen muss. */
export interface UWertAuskunft {
  /**
   * Der U-Wert [W/(m²·K)] — **undefiniert genau dann, wenn `herkunft` auf
   * `'fehlt'` steht**.
   *
   * Bewusst kein Ersatzwert 0: Mit einer 0 rechnet sich jede Bilanz klaglos
   * weiter und wird dabei zu klein, ohne dass es jemand bemerkt. Mit
   * `undefined` bricht der Aufrufer entweder ab oder muss die Lücke melden —
   * und beides ist besser als eine stille falsche Zahl.
   */
  wert?: number;
  herkunft: UWertHerkunft;
  /** Name des Aufbaus, wenn die Auskunft aus dem Katalog der Aufbauten kommt. */
  aufbau?: string;
}

/**
 * Vorgabe-U-Werte nach Bauteilart [W/(m²·K)].
 *
 * Dieselben Zahlen, mit denen `raviaExport.ts` seit jeher arbeitet (dort als
 * `DEFAULT_U`). Sie stehen jetzt hier, weil dies die Stelle ist, an der der
 * U-Wert bestimmt wird; die Übergabe soll denselben Katalog benutzen und
 * nicht einen zweiten führen — zwei Vorgabekataloge sind auf Dauer zwei
 * verschiedene Häuser.
 *
 * Die Werte sind keine Norm, sondern marktübliche Größenordnungen: eine
 * gedämmte Außenwand heutiger Bauart, eine tragende Innenwand aus
 * Kalksandstein, ein Zweischeiben-Fenster. Sie sollen eine Bilanz plausibel
 * halten, nicht einen Nachweis ersetzen.
 */
export const VORGABE_U = {
  exterior: 0.24,
  interior: 1.2,
  partition: 1.4,
  shaft: 1.4,
  window: 0.95,
  door: 1.6,
  /** Ein Durchgang ist keine Bauteilfläche — er wird nur als Loch abgezogen. */
  passage: 0,
} as const satisfies Record<WallType | OpeningKind, number>;

/** Klartext für die Bauteilart — für Meldungen und Lückenlisten. */
export const BAUTEIL_BEZEICHNUNG: Record<WallType | OpeningKind, string> = {
  exterior: 'Außenwand',
  interior: 'Innenwand',
  partition: 'Trennwand',
  shaft: 'Schachtwand',
  window: 'Fenster',
  door: 'Tür',
  passage: 'Durchgang',
};

/**
 * Gilt dieser Zahlenwert als erfasster U-Wert?
 *
 * `NaN` und `Infinity` fallen mit heraus. Sie entstehen aus einer Division
 * durch null beim Rechnen aus Schichten und würden eine Heizlast von
 * `Infinity` erzeugen — eine Zahl, die kein Gerät der Welt deckt und die in
 * jeder Tabelle als Strich landet, ohne dass jemand die Ursache sieht.
 */
export function istErfasst(wert: number | undefined | null): wert is number {
  return typeof wert === 'number' && Number.isFinite(wert) && wert > 0;
}

/** Die Auskunft „es gibt keinen" — eine Konstante, damit sie überall gleich aussieht. */
const FEHLT: UWertAuskunft = { herkunft: 'fehlt' };

/**
 * Der gemeinsame Kern: Aufbau, dann Bauteil, dann Katalog.
 *
 * `vorgabe` ist wahlfrei. Fehlt sie, endet die Rangfolge bei `'fehlt'` — das
 * ist der Fall für Boden, Decke und Dach, siehe `uWertBoden`.
 */
function bestimme(
  constructionId: string | undefined,
  amBauteil: number | undefined,
  vorgabe: number | undefined,
  aufbauten: Record<string, Construction> | undefined,
): UWertAuskunft {
  const aufbau = constructionId ? aufbauten?.[constructionId] : undefined;
  if (aufbau && istErfasst(aufbau.uValue)) {
    return { wert: aufbau.uValue, herkunft: 'aufbau', aufbau: aufbau.name };
  }
  if (istErfasst(amBauteil)) return { wert: amBauteil, herkunft: 'bauteil' };
  // Ein zugewiesener Aufbau *ohne* brauchbaren U-Wert ist kein Grund, die
  // Rangfolge abzubrechen: Er ist selbst eine Lücke (so entstanden bis 1.23.0
  // alle über `hostPatch` angelegten Aufbauten mit `uValue: 0`), und der
  // Vorgabewert ist dann immer noch die bessere Auskunft als nichts. Gemeldet
  // wird er trotzdem — von `validation.ts`, am Aufbau selbst.
  if (vorgabe !== undefined) return { wert: vorgabe, herkunft: 'katalog' };
  return FEHLT;
}

/** Das Nötigste, was dieses Modul von einer Wand wissen muss. */
export interface WandArtig {
  type: WallType;
  uValue?: number;
  constructionId?: string;
}

/**
 * Der U-Wert einer Wand.
 *
 * Ohne Wandobjekt — eine Raumkante, hinter der keine Wand steht — gibt es
 * keine Bauteilart und damit auch keinen Vorgabewert. Das ist kein Sonderfall
 * zum Wegdrücken: Eine Raumkante ohne Wand hat eine Fläche, über die gerechnet
 * würde, und für die niemand sagen kann, wie sie aufgebaut ist.
 */
export function uWertWand(
  wall: WandArtig | undefined,
  aufbauten?: Record<string, Construction>,
): UWertAuskunft {
  if (!wall) return FEHLT;
  return bestimme(wall.constructionId, wall.uValue, VORGABE_U[wall.type], aufbauten);
}

/** Das Nötigste, was dieses Modul von einer Öffnung wissen muss. */
export interface OeffnungArtig {
  kind: OpeningKind;
  uValue?: number;
  constructionId?: string;
}

/**
 * Der U-Wert einer Öffnung.
 *
 * Der Durchgang bekommt seine 0 aus dem Katalog und gilt damit als
 * beantwortet — er ist ein Loch in der Wand und kein Bauteil. Ihn als Lücke
 * zu führen hieße, in jedem Grundriss mit offenen Übergängen eine Handvoll
 * Meldungen zu erzeugen, die alle nichts bedeuten; und eine Meldung, die
 * nichts bedeutet, entwertet die daneben, die etwas bedeutet.
 */
export function uWertOeffnung(
  opening: OeffnungArtig | undefined,
  aufbauten?: Record<string, Construction>,
): UWertAuskunft {
  if (!opening) return FEHLT;
  if (opening.kind === 'passage') return { wert: VORGABE_U.passage, herkunft: 'katalog' };
  return bestimme(opening.constructionId, opening.uValue, VORGABE_U[opening.kind], aufbauten);
}

/**
 * Der U-Wert des Bodens eines Raums.
 *
 * Rangfolge über drei Träger statt zwei: der Aufbau am Geschoss, der Wert am
 * Raum (er übersteuert das Geschoss — ein Raum mit Bodenplatte in einem sonst
 * unterkellerten Geschoss), dann der Wert am Geschoss.
 *
 * **Kein Vorgabewert nach Bauteilart.** Für eine Außenwand lässt sich einer
 * begründen, weil „Außenwand" schon fast den Aufbau nennt. Für einen Boden
 * nicht: 0,28 für eine gedämmte Bodenplatte und 0,9 für eine Geschossdecke
 * unterscheiden sich um den Faktor drei, und welcher von beiden gilt, hängt
 * an der Randbedingung, nicht an der Bauteilart. Einen Mittelwert daraus zu
 * bilden hieße, eine Zahl zu erfinden, die kein Bauteil hat. Fehlt die
 * Angabe, steht hier deshalb `'fehlt'` — und der Raum wird als unvollständig
 * geführt, statt mit einem geratenen Boden zu rechnen.
 */
export function uWertBoden(
  room: Pick<Room, 'floorUValue'> | undefined,
  level: Pick<Level, 'floorUValue' | 'floorConstructionId'> | undefined,
  aufbauten?: Record<string, Construction>,
): UWertAuskunft {
  if (!level) return FEHLT;
  return bestimme(
    level.floorConstructionId,
    room?.floorUValue ?? level.floorUValue,
    undefined,
    aufbauten,
  );
}

/** Der U-Wert der Decke eines Raums — dieselbe Rangfolge wie beim Boden. */
export function uWertDecke(
  room: Pick<Room, 'ceilingUValue'> | undefined,
  level: Pick<Level, 'ceilingUValue' | 'ceilingConstructionId'> | undefined,
  aufbauten?: Record<string, Construction>,
): UWertAuskunft {
  if (!level) return FEHLT;
  return bestimme(
    level.ceilingConstructionId,
    room?.ceilingUValue ?? level.ceilingUValue,
    undefined,
    aufbauten,
  );
}

/**
 * Der U-Wert einer Dachfläche.
 *
 * Auch hier ohne Vorgabewert: Zwischen einem gedämmten Steildach (0,18) und
 * einer ungedämmten Altbaudecke liegt mehr als eine Größenordnung. Ein
 * Flachdach im Sinne von `kind: 'flat'` ist keine geneigte Hüllfläche — dort
 * rechnet die Decke des Geschosses, und diese Funktion wird gar nicht
 * gefragt.
 */
export function uWertDach(
  roof: Pick<RoofDefinition, 'uValue' | 'constructionId'> | undefined,
  aufbauten?: Record<string, Construction>,
): UWertAuskunft {
  if (!roof) return FEHLT;
  return bestimme(roof.constructionId, roof.uValue, undefined, aufbauten);
}

/**
 * Die Auskunft in einem Satzteil — für Fußnoten und Prüfberichte.
 *
 * Sie nennt bei `'aufbau'` den Namen, weil das die einzige Herkunft ist, bei
 * der es im Modell etwas nachzuschlagen gibt.
 */
export function herkunftText(a: UWertAuskunft): string {
  switch (a.herkunft) {
    case 'aufbau':
      return `aus dem Bauteilaufbau ${a.aufbau ? `„${a.aufbau}“` : 'im Katalog'}`;
    case 'bauteil':
      return 'am Bauteil erfasst';
    case 'katalog':
      return 'Vorgabewert nach Bauteilart — angenommen, nicht erfasst';
    case 'fehlt':
      return 'nicht erfasst';
  }
}
