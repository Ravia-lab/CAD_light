/**
 * Import eines Raumscans aus Apple RoomPlan.
 * ---------------------------------------------------------------------------
 * Wer mit dem iPhone durch die Wohnung geht, bekommt keine Punktwolke,
 * sondern bereits ausgewertete Geometrie: Wände als Achsen mit Länge und
 * Höhe, Türen und Fenster mit Verweis auf ihre Wand, ein Bodenpolygon und
 * benannte Raumbereiche. Der Import ist deshalb eine **Übersetzung**, keine
 * Erkennung — es wird nichts geraten, was in der Datei schon steht.
 *
 * Gelesen werden zwei Gestalten derselben Sache:
 *
 *   · die Ausgabe der App „Room Scanner" — ein kleines JSON mit den Feldern
 *     `roomData` (base64 → das eigentliche Modell) und `roomModelData`
 *     (base64 → ZIP mit einem USD-Netz, für uns entbehrlich);
 *   · ein direkt serialisiertes `CapturedRoom`, wie es RoomPlan selbst
 *     ausgibt.
 *
 * Vier Dinge liefert RoomPlan **nicht**, und an genau diesen Stellen trifft
 * dieser Import eine Annahme statt einer Messung. Jede davon steht hinterher
 * in `geschaetzt` und gehört dem Nutzer gezeigt:
 *
 *   1. **Wandstärke.** RoomPlan kennt Wände als Flächen ohne Dicke
 *      (`dimensions[2]` ist immer 0). Geschätzt wird nach Lage: was auf dem
 *      Bodenumriss liegt, wird Außenwand, alles Übrige Innenwand. Das ist die
 *      eine Zahl, die unmittelbar in die Heizlast durchschlägt.
 *   2. **Türanschlag.** Die Datei weiß nur „offen/geschlossen", nicht, wohin
 *      die Tür aufgeht. `hinge` und `flipSwing` bleiben offen.
 *   3. **U-Werte.** Kommen aus den üblichen Vorgaben, nicht aus dem Scan.
 *   4. **Geschosshöhe.** Abgeleitet aus den gemessenen Wandhöhen.
 *
 * Und eine Eigenheit, die den Plan sonst schief aussehen lässt: ein Scan ist
 * in Weltkoordinaten aufgezeichnet, nicht nach den Wänden ausgerichtet. Der
 * Import dreht ihn deshalb in seine **Vorzugsrichtung** — die Richtung, in der
 * der größte Teil der Wandlänge liegt. Der Kompasswert taugt dafür nicht: er
 * trägt in der Praxis über 10° Unsicherheit und würde den Plan verkanten.
 * Er wird als Nordrichtung mitgeführt, wo er hingehört.
 */

import { vorzugsrichtung } from './geometry';
import { VORGABE_U } from './uwert';
import type {
  BimNode,
  Opening,
  OpeningKind,
  RoomUsage,
  Vec2,
  Wall,
  WallType,
} from '../types/bim';

// ---------------------------------------------------------------------------
// Gestalt der Datei
// ---------------------------------------------------------------------------

/** Eine 4×4-Matrix, spaltenweise abgelegt (simd_float4x4). */
type Matrix16 = number[];

interface RoomPlanFlaeche {
  identifier: string;
  parentIdentifier?: string | null;
  /** [Länge, Höhe, Dicke] — die Dicke ist bei RoomPlan stets 0. */
  dimensions: number[];
  transform: Matrix16;
  story?: number;
  confidence?: Record<string, unknown>;
  category?: Record<string, unknown>;
  polygonCorners?: number[][];
  /**
   * Gekrümmte Wand (seit iOS 16). Ist das Feld gesetzt, ist `dimensions[0]`
   * die **Sehne** und nicht die Bogenlänge — die Wand ist dann länger, als
   * sie hier gemeldet wird.
   */
  curve?: { startAngle?: number; endAngle?: number; radius?: number } | null;
}

interface RoomPlanAbschnitt {
  label?: string;
  story?: number;
  center?: number[];
}

interface CapturedRoom {
  version?: number;
  walls?: RoomPlanFlaeche[];
  doors?: RoomPlanFlaeche[];
  windows?: RoomPlanFlaeche[];
  openings?: RoomPlanFlaeche[];
  floors?: RoomPlanFlaeche[];
  sections?: RoomPlanAbschnitt[];
  objects?: RoomPlanFlaeche[];
}

/**
 * Ein Mehrraum-Scan (`CapturedStructure`, seit iOS 17).
 *
 * Der `StructureBuilder` fügt mehrere Einzelscans zu einem Gebäude zusammen.
 * Das Ergebnis trägt **beides**: die Einzelräume unter `rooms` und dieselbe
 * Geometrie noch einmal zusammengeführt auf der obersten Ebene. Wer beides
 * liest, bekommt jede Wand doppelt; wer nur `rooms` liest, verliert die
 * Zusammenführung, die der Builder gerade geleistet hat.
 *
 * Gelesen wird deshalb die **oberste Ebene, wenn sie Wände trägt** — das ist
 * der zusammengeführte Stand —, und nur sonst die Einzelräume.
 */
interface CapturedStructure extends CapturedRoom {
  rooms?: CapturedRoom[];
}

/** Die Hülle, die „Room Scanner" um das Modell legt. */
interface ScannerHuelle {
  roomData?: string;
  roomName?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  northOffsetRadians?: number;
  northAccuracyDegrees?: number;
  northSource?: string;
}

// ---------------------------------------------------------------------------
// Ergebnis
// ---------------------------------------------------------------------------

export interface RaumplanGeschoss {
  id: string;
  name: string;
  elevation: number;
  height: number;
}

/**
 * Ein Hinweis aus dem Scan auf die Nutzung eines Raumes. Zugeordnet wird er
 * erst *nach* der Raumerkennung, indem geprüft wird, in welchem erkannten
 * Raum der Punkt liegt — die Abschnittsgrenzen von RoomPlan und die
 * Raumerkennung der Anwendung müssen nicht deckungsgleich sein.
 */
export interface RaumHinweis {
  punkt: Vec2;
  usage: RoomUsage;
  name: string;
  levelId: string;
}

/** Was nicht gemessen, sondern angenommen wurde. */
export interface Annahme {
  was: string;
  anzahl: number;
  begruendung: string;
}

export interface RaumplanImportErgebnis {
  ok: boolean;
  message: string;
  projektName?: string;
  adresse?: string;
  koordinaten?: { breite: number; laenge: number };
  /** Winkel, um den der Plan gedreht wurde [rad], gegen den Uhrzeigersinn. */
  drehung: number;
  /**
   * Richtung Norden im **gedrehten** Plan [rad], 0 = +x. Nur gesetzt, wenn die
   * Datei einen Kompasswert mitbringt.
   */
  nordrichtung?: number;
  /** Wie genau der Kompass war [°]. Gehört an den Nordpfeil, nicht in die Geometrie. */
  nordGenauigkeitGrad?: number;
  levels: RaumplanGeschoss[];
  nodes: BimNode[];
  walls: Wall[];
  openings: Opening[];
  raumHinweise: RaumHinweis[];
  geschaetzt: Annahme[];
  skipped: { reason: string; count: number }[];
}

const LEER: RaumplanImportErgebnis = {
  ok: false,
  message: '',
  drehung: 0,
  levels: [],
  nodes: [],
  walls: [],
  openings: [],
  raumHinweise: [],
  geschaetzt: [],
  skipped: [],
};

// ---------------------------------------------------------------------------
// Stellschrauben
// ---------------------------------------------------------------------------

/**
 * Wie weit zwei Wandenden auseinanderliegen dürfen, um als *derselbe* Knoten
 * zu gelten [m]. Ein Scan trifft Ecken nicht auf den Millimeter; ohne das
 * Zusammenziehen entstünden lauter Wände, die sich fast, aber eben nicht ganz
 * berühren — und die Raumerkennung fände keinen geschlossenen Umriss.
 */
const KNOTEN_TOLERANZ = 0.16;

/** Querabstand, bis zu dem zwei Wandachsen als dieselbe Gerade gelten [m]. */
const ACHS_TOLERANZ = 0.10;

/** Lücke, bis zu der zwei fluchtende Wandstücke zusammengefasst werden [m]. */
const LUECKEN_TOLERANZ = 0.30;

/** Winkelabweichung, bis zu der zwei Wände als parallel gelten [rad] (≈2°). */
const PARALLEL_TOLERANZ = 0.035;

/**
 * Abstand zum Bodenumriss, bis zu dem eine Wand als Außenwand gilt [m].
 * Großzügig gewählt: der Bodenumriss folgt der Wandfläche, die Wandachse
 * liegt darauf — Ausreißer kommen von Erkern und Nischen.
 */
const AUSSEN_TOLERANZ = 0.45;

/** Geschätzte Stärken [m]. Entsprechen den Vorgaben der Anwendung. */
const STAERKE_AUSSEN = 0.365;
const STAERKE_INNEN = 0.115;

/** Unterhalb dieser Höhe ist es keine raumhohe Wand, sondern eine Brüstung [m]. */
const BRUESTUNGS_HOEHE = 1.6;

/*
 * U-Werte beim Import — dieselbe Regel wie beim IFC-Import.
 *
 * Die ausführliche Begründung steht in `ifcImport.ts` über denselben beiden
 * Konstanten; sie gilt hier unverändert, weil ein RoomPlan-Scan genauso wenig
 * über den Aufbau eines Bauteils weiß wie eine IFC-Datei ohne Pset. In
 * Kurzform:
 *
 *   • Die **Wand** nimmt `VORGABE_U[typ]` aus `uwert.ts`. Vorher stand hier
 *     `aussen ? 0.24 : 1.2` — die Brüstung (`typ === 'partition'`) bekam
 *     damit den Wert der Innenwand statt den der Trennwand, obwohl der
 *     Katalog für sie 1,4 führt. Ein Katalog an einer Stelle kann nicht
 *     auseinanderlaufen, zwei Schreibweisen desselben Katalogs schon.
 *   • Die **Öffnung** folgt bewusst nicht `VORGABE_U` (0,95 / 1,6): Das sind
 *     Neubauwerte, und ein Scan zeigt Bestand. 1,3 ist das
 *     Zweischeiben-Fenster, 1,8 die Innentür — beide zu senken hieße, die
 *     Heizlast nach unten zu schätzen, also in die Richtung, in der ein zu
 *     kleines Gerät herauskommt.
 *   • Der **Durchgang** bekommt gar keinen mehr; `uWertOeffnung` beantwortet
 *     ihn selbst mit 0. Eine erfasste 0 am Bauteil ist seit 1.23.0 die
 *     Eingabe, die `validation.ts` als unplausibel meldet.
 */
/** U-Wert eines importierten Fensters [W/(m²·K)] — Zweischeiben-Bestand. */
const U_FENSTER_BESTAND = 1.3;
/** U-Wert einer importierten Tür [W/(m²·K)] — Innentür aus dem Aufbaukatalog. */
const U_TUER_BESTAND = 1.8;

/**
 * Querabstand, bis zu dem ein Wandende als *auf* einer fremden Wand sitzend
 * gilt und diese dort geteilt wird [m].
 *
 * Das ist die Toleranz, die über geschlossene Räume entscheidet. RoomPlan
 * liefert jede Wand als eigene Fläche; wo eine Zwischenwand auf eine
 * durchlaufende Wand trifft, teilen sich die beiden **keinen** Knoten. Für
 * die Zeichnung ist das gleichgültig, für die Raumerkennung nicht: ohne
 * geteilten Knoten gibt es keinen geschlossenen Umlauf, und zwei Räume
 * verschmelzen zu einem.
 *
 * 6 cm deckt die Messstreuung eines Scans ab (gemessen an der Beispieldatei:
 * elf von fünfzehn losen Enden liegen zwischen 0 und 4,6 cm neben der Achse).
 * Größer darf die Toleranz nicht werden — die vier übrigen Enden liegen 1,1
 * bis 1,8 m entfernt, und das sind **echte** offene Wandenden. Sie
 * heranzuziehen hieße, Wand zu erfinden, die niemand gemessen hat.
 */
const STOSS_TOLERANZ = 0.06;

/**
 * Wie weit vom Wandende ein Stoß mindestens entfernt liegen muss, um als
 * T-Stoß zu zählen [m]. Näher dran ist es eine Ecke, und die entsteht schon
 * beim Zusammenziehen der Knoten.
 */
const STOSS_RANDABSTAND = 0.12;

// ---------------------------------------------------------------------------
// Werkzeug
// ---------------------------------------------------------------------------

const rund = (v: number, stellen = 3): number => {
  const f = 10 ** stellen;
  return Math.round(v * f) / f;
};

/**
 * base64 nach Text — im Browser wie im Prüfstand.
 *
 * `atob` liefert Bytes als Zeichen, nicht Text: der Umweg über `Uint8Array`
 * und `TextDecoder` ist nötig, sonst zerfallen Umlaute in Raumnamen.
 */
function ausBase64(b64: string): string {
  const g = globalThis as unknown as {
    atob?: (s: string) => string;
    Buffer?: { from(s: string, enc: string): { toString(enc: string): string } };
  };
  if (typeof g.atob === 'function') {
    const roh = g.atob(b64);
    const bytes = new Uint8Array(roh.length);
    for (let i = 0; i < roh.length; i++) bytes[i] = roh.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
  }
  if (g.Buffer) return g.Buffer.from(b64, 'base64').toString('utf-8');
  throw new Error('Keine base64-Dekodierung verfügbar');
}

/**
 * Ursprung und Längsachse eines RoomPlan-Bauteils in der Grundrissebene.
 *
 * RoomPlan rechnet mit **Y nach oben**: die Grundrissebene ist (x, z), nicht
 * (x, y). Die Matrix liegt spaltenweise, die Verschiebung steht deshalb in
 * den Elementen 12…14 und die lokale x-Achse in 0…2. Wer das verwechselt,
 * bekommt einen Grundriss, der aussieht wie ein Schnitt.
 */
function achse(t: Matrix16): { mitte: Vec2; hoch: number; dx: number; dy: number } {
  const dx = t[0];
  const dy = t[2];
  const n = Math.hypot(dx, dy) || 1;
  return { mitte: { x: t[12], y: t[14] }, hoch: t[13], dx: dx / n, dy: dy / n };
}

/** Punkt um den Ursprung drehen. */
const drehe = (p: Vec2, sin: number, cos: number): Vec2 => ({
  x: p.x * cos - p.y * sin,
  y: p.x * sin + p.y * cos,
});

/**
 * Die Richtung, in der der größte Teil der Wandlänge liegt.
 *
 * Gewichtet wird mit der Wandlänge — eine 5-m-Außenwand sagt mehr über die
 * Ausrichtung des Hauses als ein 45-cm-Stummel. Gerechnet wird über den
 * **vierfachen** Winkel: dadurch fallen die vier Richtungen eines Rechtecks
 * (0°, 90°, 180°, 270°) auf denselben Punkt des Einheitskreises, und der
 * Mittelwert wird nicht von der Frage gestört, welche Wand „hin" und welche
 * „her" gemessen wurde. Der klassische Fehler ist, Winkel arithmetisch zu
 * mitteln — 1° und 359° ergeben dann 180° statt 0°.
 */

/** Punkt-zu-Strecke-Abstand. */
function abstandZurStrecke(p: Vec2, a: Vec2, b: Vec2): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const l2 = vx * vx + vy * vy;
  if (l2 < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}

// ---------------------------------------------------------------------------
// Nutzung
// ---------------------------------------------------------------------------

/**
 * RoomPlan benennt Raumbereiche nach amerikanischem Wohnungsschnitt. Übersetzt
 * wird auf die Nutzungen der Anwendung — die sind es, die über Solltemperatur
 * und Luftwechsel entscheiden.
 *
 * `diningRoom` und `familyRoom` werden zu `living`: sie werden wie ein
 * Wohnraum beheizt, und eine eigene Nutzung „Essen" gäbe es im Modell nicht.
 */
const NUTZUNG: Record<string, { usage: RoomUsage; name: string }> = {
  livingRoom: { usage: 'living', name: 'Wohnen' },
  diningRoom: { usage: 'living', name: 'Essen' },
  familyRoom: { usage: 'living', name: 'Wohnen' },
  bedroom: { usage: 'bedroom', name: 'Schlafen' },
  kitchen: { usage: 'kitchen', name: 'Küche' },
  bathroom: { usage: 'bath', name: 'Bad' },
  laundryRoom: { usage: 'technical', name: 'Hauswirtschaft' },
  office: { usage: 'office', name: 'Arbeiten' },
  storage: { usage: 'storage', name: 'Abstellraum' },
  hallway: { usage: 'hallway', name: 'Flur' },
  stairway: { usage: 'hallway', name: 'Treppenhaus' },
};

// ---------------------------------------------------------------------------
// Zwischenform
// ---------------------------------------------------------------------------

interface Wandstueck {
  /** Die Kennungen aus dem Scan, die in dieses Stück eingegangen sind. */
  quellen: string[];
  a: Vec2;
  b: Vec2;
  /** Einheitsvektor von a nach b. */
  dx: number;
  dy: number;
  laenge: number;
  hoehe: number;
  /** Unterkante über dem Bezugsniveau des Scans [m]. */
  unten: number;
  story: number;
  /** Vertrauensmaß aus dem Scan, 0…1. */
  vertrauen: number;
}

const VERTRAUEN: Record<string, number> = { high: 0.95, medium: 0.6, low: 0.3 };

const vertrauenAus = (c: Record<string, unknown> | undefined): number => {
  const schluessel = c ? Object.keys(c)[0] : undefined;
  return (schluessel && VERTRAUEN[schluessel]) || 0.6;
};

// ---------------------------------------------------------------------------
// Erkennen
// ---------------------------------------------------------------------------

/**
 * Prüft, ob ein Text ein RoomPlan-Scan ist — **ohne** ihn vollständig zu
 * verarbeiten. Der Öffnen-Dialog der Anwendung entscheidet nach Inhalt, nicht
 * nach Dateiendung; diese Prüfung muss deshalb billig sein und darf nicht
 * werfen.
 */
export function istRaumplanDatei(text: string): boolean {
  if (!text.trimStart().startsWith('{')) return false;
  // Gesucht wird im **ganzen** Text, nicht in den ersten Kilobytes.
  //
  // Das ist der Punkt, an dem diese Funktion schon einmal falsch war. In einer
  // echten Ausgabe von „Room Scanner" steht das USD-Netz (`roomModelData`) als
  // base64 vorn — bei der Beispielwohnung 700 kB davon —, und `roomData` folgt
  // erst ab Zeichen 486 099. Eine Erkennung, die nur in den Anfang schaut,
  // hält die Datei deshalb für kein Raumscan, reicht sie an den Projektleser
  // weiter und meldet „Datei konnte nicht gelesen werden".
  //
  // Die Suche über die ganze Zeichenkette kostet bei 1,4 MB Bruchteile einer
  // Millisekunde — `indexOf` ist in jeder Laufzeit ein Maschinenwortscan.
  // Gespart hätte man hier nichts und eine Fehlerquelle eingebaut.
  if (text.includes('"roomData"')) return true;
  // Direkt serialisiertes CapturedRoom oder CapturedStructure.
  //
  // **Warum die Kennzeichen so gewählt sind.** Die erste Fassung verlangte
  // neben `walls` noch `floors` oder `sections`. Beide Felder gibt es aber
  // erst seit iOS 17 — ein Scan von einem iPhone mit iOS 16 hat weder das
  // eine noch das andere und fiel deshalb durch die Erkennung, obwohl er ein
  // vollkommen brauchbarer RoomPlan-Scan ist. Verlangt wird jetzt `walls`
  // zusammen mit `transform` und einem Merkmal, das **jede** Fassung hat:
  // `openings` (die vierte Flächenart, seit iOS 16), `completedEdges` (an
  // jeder Fläche) oder `parentIdentifier` (an jeder Fläche).
  if (!text.includes('"walls"') || !text.includes('"transform"')) return false;
  return (
    text.includes('"openings"') ||
    text.includes('"completedEdges"') ||
    text.includes('"parentIdentifier"') ||
    text.includes('"floors"') ||
    text.includes('"sections"')
  );
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

/**
 * Aus einem Mehrraum-Scan einen einzigen Raum machen.
 *
 * Trägt die oberste Ebene selbst Wände, ist sie der zusammengeführte Stand
 * des `StructureBuilder` und wird unverändert genommen. Trägt sie keine,
 * werden die Einzelräume aneinandergehängt — die Wände stehen ohnehin alle im
 * selben Weltkoordinatensystem, das ist ja der Zweck des Zusammenführens.
 * Doppelte Wände an den Berührungsstellen fängt `fasseZusammen` ab, so wie es
 * die Mehrfachflächen einer einzelnen Wand abfängt.
 */
function vereinige(struktur: CapturedStructure): CapturedRoom {
  if ((struktur.walls?.length ?? 0) > 0) return struktur;
  const raeume = struktur.rooms ?? [];
  if (raeume.length === 0) return struktur;
  const sammle = (nimm: (r: CapturedRoom) => RoomPlanFlaeche[] | undefined): RoomPlanFlaeche[] =>
    raeume.flatMap((r) => nimm(r) ?? []);
  return {
    version: struktur.version,
    walls: sammle((r) => r.walls),
    doors: sammle((r) => r.doors),
    windows: sammle((r) => r.windows),
    openings: sammle((r) => r.openings),
    floors: sammle((r) => r.floors),
    objects: sammle((r) => r.objects),
    sections: raeume.flatMap((r) => r.sections ?? []),
  };
}

export function importRaumplan(text: string): RaumplanImportErgebnis {
  // --- 1 · Auspacken ---------------------------------------------------------
  let huelle: ScannerHuelle = {};
  let raum: CapturedRoom;
  try {
    const roh = JSON.parse(text) as ScannerHuelle & CapturedStructure;
    if (typeof roh.roomData === 'string' && roh.roomData.length > 0) {
      huelle = roh;
      raum = vereinige(JSON.parse(ausBase64(roh.roomData)) as CapturedStructure);
    } else {
      raum = vereinige(roh);
    }
  } catch {
    return { ...LEER, message: 'Die Datei ist kein lesbares JSON.' };
  }

  const rohWaende = raum.walls ?? [];
  if (rohWaende.length === 0) {
    return { ...LEER, message: 'Der Scan enthält keine Wände — ist er vollständig abgeschlossen worden?' };
  }

  const uebersprungen = new Map<string, number>();
  const merke = (grund: string): void => {
    uebersprungen.set(grund, (uebersprungen.get(grund) ?? 0) + 1);
  };

  // --- 2 · Geraderücken ------------------------------------------------------
  const richtung = vorzugsrichtung(
    rohWaende.map((w) => {
      const a = achse(w.transform);
      return { dx: a.dx, dy: a.dy, laenge: w.dimensions[0] };
    }),
  );
  const sin = Math.sin(-richtung);
  const cos = Math.cos(-richtung);

  // --- 3 · Wandstücke --------------------------------------------------------
  const stuecke: Wandstueck[] = [];
  let gekruemmt = 0;
  let unsicher = 0;
  for (const w of rohWaende) {
    const laenge = w.dimensions[0];
    const hoehe = w.dimensions[1];
    if (!(laenge > 0.05) || !(hoehe > 0.2)) {
      merke('Wand ohne brauchbares Maß');
      continue;
    }
    // **Unmaß statt Maß.** RoomPlan gibt Meter, immer. Eine Wand von 120 m
    // oder 9 m Höhe ist deshalb kein großes Zimmer, sondern eine Datei in
    // einer anderen Einheit oder ein verunglückter Zusammenbau. Apple selbst
    // nennt rund 9 m je Einzelscan als Grenze. Eine solche Wand stumm zu
    // übernehmen hieße, den ganzen Plan an ihr aufzuhängen.
    if (laenge > 60 || hoehe > 8) {
      merke('Wand mit unglaubwürdigem Maß (über 60 m lang oder 8 m hoch)');
      continue;
    }
    // Eine gekrümmte Wand meldet ihre **Sehne** als Länge. Gezeichnet wird
    // hier die Sehne — das ist die Stelle, an der der Scan mehr weiß als
    // dieses Modell, und der Nutzer erfährt es, statt es zu übersehen.
    if (w.curve && typeof w.curve.radius === 'number' && w.curve.radius > 0) gekruemmt += 1;
    if (vertrauenAus(w.confidence) < 0.5) unsicher += 1;
    const a = achse(w.transform);
    const mitte = drehe(a.mitte, sin, cos);
    const richt = drehe({ x: a.dx, y: a.dy }, sin, cos);
    const halb = laenge / 2;
    stuecke.push({
      quellen: [w.identifier],
      a: { x: mitte.x - richt.x * halb, y: mitte.y - richt.y * halb },
      b: { x: mitte.x + richt.x * halb, y: mitte.y + richt.y * halb },
      dx: richt.x,
      dy: richt.y,
      laenge,
      hoehe,
      unten: a.hoch - hoehe / 2,
      story: w.story ?? 0,
      vertrauen: vertrauenAus(w.confidence),
    });
  }
  if (stuecke.length === 0) {
    return { ...LEER, message: 'Keine Wand des Scans hatte ein brauchbares Maß.' };
  }

  // --- 4 · Fluchtende Stücke zusammenfassen ---------------------------------
  //  RoomPlan zerlegt eine durchgehende Wand oft in mehrere Flächen — an jeder
  //  Tür, an jedem Möbelstück, das die Sicht verdeckt hat. Bliebe das so,
  //  entstünden künstliche Wandstöße, und jeder davon wäre eine Fehlerquelle
  //  beim späteren Verschieben.
  const zusammengefasst = fasseZusammen(stuecke);

  // --- 5 · Geschosse ---------------------------------------------------------
  const stockwerke = [...new Set(zusammengefasst.map((s) => s.story))].sort((a, b) => a - b);
  const levels: RaumplanGeschoss[] = stockwerke.map((story) => {
    const eigene = zusammengefasst.filter((s) => s.story === story);
    // Die Geschosshöhe ist die *häufigste* Wandhöhe, nicht die größte: eine
    // einzelne hohe Wand in einem Luftraum darf nicht das ganze Geschoss
    // aufblasen.
    const hoehe = haeufigsteHoehe(eigene.map((s) => s.hoehe));
    const unten = Math.min(...eigene.map((s) => s.unten));
    return {
      id: `rp-level-${story}`,
      // Bewusst ein Platzhalter: die richtige Benennung nach Höhenlage
      // (KG, EG, 1. OG) macht `benenneGeschosse` beim Übernehmen. Stünde hier
      // schon „Erdgeschoss", würde sie als eigener Name durchgelassen — und
      // ein Scan mit Keller hätte zwei Erdgeschosse.
      name: `Geschoss ${story}`,
      elevation: rund(unten),
      height: rund(hoehe),
    };
  });
  const bezug = levels[0]?.elevation ?? 0;
  for (const l of levels) l.elevation = rund(l.elevation - bezug);

  // --- 6 · Bodenumriss (für die Frage außen/innen) --------------------------
  const umriss = bodenUmriss(raum, sin, cos);

  // --- 7 · Knoten und Wände --------------------------------------------------
  const knoten: BimNode[] = [];
  const knotenAn = (p: Vec2, levelId: string): BimNode => {
    for (const k of knoten) {
      if (k.levelId === levelId && Math.hypot(k.x - p.x, k.y - p.y) <= KNOTEN_TOLERANZ) return k;
    }
    const neu: BimNode = { id: `rp-n${knoten.length}`, x: rund(p.x), y: rund(p.y), levelId };
    knoten.push(neu);
    return neu;
  };

  const walls: Wall[] = [];
  /** Unterkante je erzeugter Wand [m] — für die Brüstungshöhe der Fenster. */
  const unten = new Map<string, number>();
  /**
   * Kennung aus dem Scan → erzeugte Wände. Eine Liste, weil eine Wand beim
   * Teilen an T-Stößen in mehrere Stücke zerfällt und eine Öffnung dann dem
   * *richtigen* Stück zugeordnet werden muss.
   */
  const wandZuQuelle = new Map<string, Wall[]>();
  let aussenZahl = 0;

  for (const s of zusammengefasst) {
    const levelId = `rp-level-${s.story}`;
    const a = knotenAn(s.a, levelId);
    const b = knotenAn(s.b, levelId);
    if (a.id === b.id) {
      merke('Wand kürzer als die Knotentoleranz');
      continue;
    }

    const aussen = umriss.length >= 3 && liegtAufUmriss(s, umriss);
    const bruestung = s.hoehe < BRUESTUNGS_HOEHE;
    const typ: WallType = aussen ? 'exterior' : bruestung ? 'partition' : 'interior';
    if (aussen) aussenZahl++;

    const wand: Wall = {
      id: `rp-w${walls.length}`,
      levelId,
      a: a.id,
      b: b.id,
      thickness: aussen ? STAERKE_AUSSEN : STAERKE_INNEN,
      thicknessEstimated: true,
      height: rund(s.hoehe),
      type: typ,
      layerId: 'layer-walls',
      uValue: VORGABE_U[typ],
      confidence: rund(s.vertrauen, 2),
    };
    walls.push(wand);
    unten.set(wand.id, s.unten);
    for (const q of s.quellen) wandZuQuelle.set(q, [wand]);
  }

  if (walls.length === 0) {
    return { ...LEER, message: 'Nach dem Zusammenfassen blieb keine Wand übrig.' };
  }

  // --- 7b · T-Stöße herstellen ----------------------------------------------
  //  Ohne diesen Schritt bleibt der Grundriss offen und die Raumerkennung
  //  wirft zwei Räume in einen. Siehe STOSS_TOLERANZ.
  const stoesse = teileAnStoessen(walls, knoten, unten, wandZuQuelle);
  // Nach dem Teilen kann ein Knoten übrig bleiben, an dem keine Wand mehr
  // hängt — etwa wenn eine zu kurze Wand vorher verworfen wurde. Er würde im
  // Editor als anfassbarer Punkt ohne Bedeutung erscheinen.
  const benutzt = new Set(walls.flatMap((w) => [w.a, w.b]));
  const knotenRein = knoten.filter((k) => benutzt.has(k.id));

  // --- 8 · Öffnungen ---------------------------------------------------------
  const knotenNach = new Map(knotenRein.map((k) => [k.id, k]));
  const openings: Opening[] = [];
  const arten: [RoomPlanFlaeche[] | undefined, OpeningKind][] = [
    [raum.doors, 'door'],
    [raum.windows, 'window'],
    [raum.openings, 'passage'],
  ];

  for (const [liste, kind] of arten) {
    for (const o of liste ?? []) {
      const teile = o.parentIdentifier ? wandZuQuelle.get(o.parentIdentifier) : undefined;
      if (!teile || teile.length === 0) {
        merke(`${bezeichnung(kind)} ohne zugehörige Wand im Scan`);
        continue;
      }

      const g = achse(o.transform);
      const mitte = drehe(g.mitte, sin, cos);
      const breite = o.dimensions[0];
      const hoehe = o.dimensions[1];
      if (!(breite > 0.15) || !(hoehe > 0.15)) {
        merke(`${bezeichnung(kind)} ohne brauchbares Maß`);
        continue;
      }

      // Welches Teilstück? Die Wand aus dem Scan kann an T-Stößen geteilt
      // worden sein. Gewählt wird das Stück, in das die Öffnungsmitte fällt —
      // ersatzweise das, dessen Rand ihr am nächsten liegt.
      let wand: Wall | undefined;
      let distance = 0;
      let bestAbweichung = Infinity;
      for (const kandidat of teile) {
        const a = knotenNach.get(kandidat.a);
        const b = knotenNach.get(kandidat.b);
        if (!a || !b) continue;
        const wx = b.x - a.x;
        const wy = b.y - a.y;
        const laenge = Math.hypot(wx, wy);
        if (laenge < 1e-6) continue;
        const t = ((mitte.x - a.x) * wx + (mitte.y - a.y) * wy) / laenge;
        // Abweichung: 0, wenn die Mitte im Stück liegt; sonst der Überstand.
        const ab = t < 0 ? -t : t > laenge ? t - laenge : 0;
        if (ab < bestAbweichung) {
          bestAbweichung = ab;
          wand = kandidat;
          distance = t;
        }
      }
      if (!wand) {
        merke(`${bezeichnung(kind)} ohne zugehörige Wand im Scan`);
        continue;
      }
      const a = knotenNach.get(wand.a)!;
      const b = knotenNach.get(wand.b)!;
      const wandLaenge = Math.hypot(b.x - a.x, b.y - a.y);
      if (bestAbweichung > KNOTEN_TOLERANZ) {
        merke(`${bezeichnung(kind)} liegt außerhalb ihrer Wand`);
        continue;
      }
      // Eine Öffnung, die breiter ist als ihre Wand, ist keine Öffnung mehr.
      if (breite > wandLaenge + KNOTEN_TOLERANZ) {
        merke(`${bezeichnung(kind)} breiter als ihre Wand`);
        continue;
      }

      // Brüstung: Unterkante der Öffnung über der Unterkante der Wand. Beide
      // Werte kommen aus derselben Höhenachse des Scans, die Differenz ist
      // deshalb belastbar — anders als die Absoluthöhe.
      const untenWand = unten.get(wand.id) ?? 0;
      const sill = kind === 'window' ? Math.max(0, g.hoch - hoehe / 2 - untenWand) : 0;

      openings.push({
        id: `rp-o${openings.length}`,
        wallId: wand.id,
        kind,
        distance: rund(Math.max(0, Math.min(wandLaenge, distance))),
        width: rund(breite),
        height: rund(hoehe),
        sillHeight: rund(sill),
        layerId: 'layer-openings',
        ...(kind === 'window'
          ? { uValue: U_FENSTER_BESTAND }
          : kind === 'door'
            ? { uValue: U_TUER_BESTAND }
            : {}),
        gValue: kind === 'window' ? 0.6 : undefined,
        confidence: rund(vertrauenAus(o.confidence), 2),
        ...bauart(kind, breite, hoehe, sill),
      } as Opening);
    }
  }

  // --- 9 · Raumnutzung -------------------------------------------------------
  const raumHinweise: RaumHinweis[] = [];
  for (const s of raum.sections ?? []) {
    const label = s.label ?? 'unidentified';
    const eintrag = NUTZUNG[label];
    if (!eintrag || !s.center || s.center.length < 3) continue;
    const p = drehe({ x: s.center[0], y: s.center[2] }, sin, cos);
    raumHinweise.push({
      punkt: { x: rund(p.x), y: rund(p.y) },
      usage: eintrag.usage,
      name: eintrag.name,
      levelId: `rp-level-${s.story ?? 0}`,
    });
  }

  // --- 10 · Rechenschaft -----------------------------------------------------
  const geschaetzt: Annahme[] = [
    {
      was: 'Wandstärke',
      anzahl: walls.length,
      begruendung:
        `RoomPlan misst Wände als Flächen ohne Dicke. Angenommen: ${aussenZahl} Außenwände ` +
        `mit ${(STAERKE_AUSSEN * 100).toFixed(1).replace('.', ',')} cm, ` +
        `${walls.length - aussenZahl} Innenwände mit ${(STAERKE_INNEN * 100).toFixed(1).replace('.', ',')} cm. ` +
        'Außen ist, was auf dem Bodenumriss liegt.',
    },
    {
      was: 'U-Werte',
      anzahl: walls.length + openings.length,
      begruendung: 'Vorgabewerte der Anwendung; ein Scan misst keine Bauteilaufbauten.',
    },
  ];
  if (gekruemmt > 0) {
    geschaetzt.push({
      was: 'Gekrümmte Wände',
      anzahl: gekruemmt,
      begruendung:
        'Der Scan meldet eine Krümmung, die dieses Modell nicht kennt. Gezeichnet ist die Sehne — die Wand ist ' +
        'in Wirklichkeit länger und läuft im Bogen. Mit dem Wandwerkzeug nachziehen, wenn es auf die Fläche ankommt.',
    });
  }
  if (unsicher > 0) {
    geschaetzt.push({
      was: 'Unsicher erfasste Wände',
      anzahl: unsicher,
      begruendung:
        'RoomPlan selbst gibt diesen Wänden geringes Vertrauen — meist kurze Stücke, verdeckte Stellen oder ' +
        'Glasflächen. Übernommen sind sie trotzdem; ein Blick darauf lohnt, bevor gerechnet wird.',
    });
  }
  const tueren = openings.filter((o) => o.kind === 'door').length;
  if (tueren > 0) {
    geschaetzt.push({
      was: 'Türanschlag',
      anzahl: tueren,
      begruendung: 'RoomPlan kennt nur „offen/geschlossen", nicht die Bandseite. Anschlag von Hand setzen.',
    });
  }

  const nordQuelle = huelle.northSource;
  const hatNorden = typeof huelle.northOffsetRadians === 'number' && nordQuelle !== undefined;

  const message =
    `${walls.length} Wände, ${openings.length} Öffnungen, ${levels.length} Geschoss(e)` +
    (stoesse ? `, ${stoesse} T-Stöße hergestellt` : '') +
    (raumHinweise.length ? `, ${raumHinweise.length} Räume benannt` : '') +
    ` · Plan um ${(((-richtung * 180) / Math.PI + 540) % 360 - 180).toFixed(1).replace('.', ',')}° geradegerückt` +
    ` · Wandstärken geschätzt`;

  return {
    ok: true,
    message,
    projektName: huelle.roomName?.trim() || undefined,
    adresse: huelle.address?.trim() || undefined,
    koordinaten:
      typeof huelle.latitude === 'number' && typeof huelle.longitude === 'number'
        ? { breite: huelle.latitude, laenge: huelle.longitude }
        : undefined,
    drehung: -richtung,
    // Der Kompasswert bezieht sich auf die Rohlage; durch das Geraderücken
    // dreht er mit.
    nordrichtung: hatNorden ? (huelle.northOffsetRadians as number) - richtung : undefined,
    nordGenauigkeitGrad: hatNorden ? huelle.northAccuracyDegrees : undefined,
    levels,
    nodes: knotenRein,
    walls,
    openings,
    raumHinweise,
    geschaetzt,
    skipped: [...uebersprungen].map(([reason, count]) => ({ reason, count })),
  };
}

// ---------------------------------------------------------------------------
// Teilschritte
// ---------------------------------------------------------------------------

const bezeichnung = (k: OpeningKind): string =>
  k === 'door' ? 'Tür' : k === 'window' ? 'Fenster' : 'Durchgang';

/**
 * Bauart aus den gemessenen Maßen ableiten.
 *
 * Das entscheidet nur über Symbol und Sprossen, nicht über die Rechnung —
 * deshalb darf hier geschätzt werden, ohne dass eine Zahl davon abhängt.
 */
function bauart(
  kind: OpeningKind,
  breite: number,
  _hoehe: number,
  sill: number,
): Partial<Opening> {
  if (kind === 'window') {
    if (sill < 0.3) return { windowType: 'french', panels: 1 };
    if (breite > 2.4) return { windowType: 'ribbon', panels: 3 };
    if (breite > 1.5) return { windowType: 'double', panels: 2 };
    if (breite < 0.7) return { windowType: 'fixed', panels: 1 };
    return { windowType: 'tilt-turn', panels: 1 };
  }
  if (kind === 'door') {
    return { doorType: breite > 1.4 ? 'double' : 'single' };
  }
  return { passageType: 'lintel' };
}

/** Die häufigste Höhe, auf 5 cm gerastert. */
function haeufigsteHoehe(hoehen: number[]): number {
  if (hoehen.length === 0) return 2.5;
  const faecher = new Map<number, number>();
  for (const h of hoehen) {
    const f = Math.round(h / 0.05);
    faecher.set(f, (faecher.get(f) ?? 0) + 1);
  }
  let bestesFach = 0;
  let bestesGewicht = -1;
  for (const [f, n] of faecher) {
    if (n > bestesGewicht || (n === bestesGewicht && f > bestesFach)) {
      bestesGewicht = n;
      bestesFach = f;
    }
  }
  return bestesFach * 0.05;
}

/**
 * Fluchtende, einander berührende Wandstücke gleicher Höhe zu einer Wand
 * vereinigen.
 *
 * Zusammengelegt wird nur, was parallel liegt, dieselbe Achse hat, sich
 * berührt *und* gleich hoch ist. Die Höhe ist dabei das wichtigste Merkmal:
 * eine Brüstung und die Wand darüber fluchten, sind aber zwei Bauteile.
 */
function fasseZusammen(stuecke: Wandstueck[]): Wandstueck[] {
  const eltern = stuecke.map((_, i) => i);
  const finde = (i: number): number => {
    while (eltern[i] !== i) {
      eltern[i] = eltern[eltern[i]];
      i = eltern[i];
    }
    return i;
  };
  const vereine = (i: number, k: number): void => {
    const a = finde(i);
    const b = finde(k);
    if (a !== b) eltern[b] = a;
  };

  for (let i = 0; i < stuecke.length; i++) {
    for (let k = i + 1; k < stuecke.length; k++) {
      const A = stuecke[i];
      const B = stuecke[k];
      if (A.story !== B.story) continue;
      if (Math.abs(A.hoehe - B.hoehe) > 0.15) continue;
      // parallel?
      if (Math.abs(A.dx * B.dy - A.dy * B.dx) > PARALLEL_TOLERANZ) continue;
      // dieselbe Gerade?
      const quer = Math.abs(-A.dy * (B.a.x - A.a.x) + A.dx * (B.a.y - A.a.y));
      if (quer > ACHS_TOLERANZ) continue;
      // berühren sie sich?
      let naechste = Infinity;
      for (const p of [A.a, A.b]) {
        for (const q of [B.a, B.b]) {
          naechste = Math.min(naechste, Math.hypot(p.x - q.x, p.y - q.y));
        }
      }
      if (naechste > LUECKEN_TOLERANZ) continue;
      vereine(i, k);
    }
  }

  const gruppen = new Map<number, number[]>();
  stuecke.forEach((_, i) => {
    const w = finde(i);
    const g = gruppen.get(w);
    if (g) g.push(i);
    else gruppen.set(w, [i]);
  });

  const raus: Wandstueck[] = [];
  for (const teile of gruppen.values()) {
    if (teile.length === 1) {
      raus.push(stuecke[teile[0]]);
      continue;
    }
    // Richtung des längsten Stücks gibt den Ton an.
    const leit = teile.reduce((m, i) => (stuecke[i].laenge > stuecke[m].laenge ? i : m), teile[0]);
    const L = stuecke[leit];
    let min = Infinity;
    let max = -Infinity;
    let minP: Vec2 = L.a;
    let maxP: Vec2 = L.b;
    for (const i of teile) {
      for (const p of [stuecke[i].a, stuecke[i].b]) {
        const t = (p.x - L.a.x) * L.dx + (p.y - L.a.y) * L.dy;
        if (t < min) {
          min = t;
          minP = p;
        }
        if (t > max) {
          max = t;
          maxP = p;
        }
      }
    }
    // Auf die Leitachse projizieren, damit das Ergebnis wirklich gerade ist.
    const auf = (t: number): Vec2 => ({ x: L.a.x + L.dx * t, y: L.a.y + L.dy * t });
    void minP;
    void maxP;
    const a = auf(min);
    const b = auf(max);
    raus.push({
      quellen: teile.flatMap((i) => stuecke[i].quellen),
      a,
      b,
      dx: L.dx,
      dy: L.dy,
      laenge: max - min,
      // Gewichtetes Mittel der Höhen: das längere Stück wiegt schwerer.
      hoehe:
        teile.reduce((s, i) => s + stuecke[i].hoehe * stuecke[i].laenge, 0) /
        teile.reduce((s, i) => s + stuecke[i].laenge, 0),
      unten: Math.min(...teile.map((i) => stuecke[i].unten)),
      story: L.story,
      vertrauen: Math.min(...teile.map((i) => stuecke[i].vertrauen)),
    });
  }
  return raus;
}

/** Der Bodenumriss des Scans, gedreht in die Planlage. */
function bodenUmriss(raum: CapturedRoom, sin: number, cos: number): Vec2[] {
  const boden = raum.floors?.[0];
  const ecken = boden?.polygonCorners;
  if (!boden || !ecken || ecken.length < 3) return [];
  const T = boden.transform;
  // Die Ecken liegen in der lokalen Ebene des Bodens; erst die Matrix bringt
  // sie in die Welt. Ohne diesen Schritt liegt der Umriss irgendwo im Raum.
  return ecken.map((c) => {
    const x = T[0] * c[0] + T[4] * c[1] + T[8] * c[2] + T[12];
    const z = T[2] * c[0] + T[6] * c[1] + T[10] * c[2] + T[14];
    return drehe({ x, y: z }, sin, cos);
  });
}

/**
 * Liegt die Wand auf dem Bodenumriss? Geprüft wird an drei Stellen — Anfang,
 * Mitte, Ende —, weil eine lange Wand teilweise außen und teilweise innen
 * liegen kann; entscheidend ist die Mehrheit.
 */
function liegtAufUmriss(s: Wandstueck, umriss: Vec2[]): boolean {
  const proben: Vec2[] = [
    s.a,
    { x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 },
    s.b,
  ];
  let treffer = 0;
  for (const p of proben) {
    let nah = Infinity;
    for (let i = 0; i < umriss.length; i++) {
      nah = Math.min(nah, abstandZurStrecke(p, umriss[i], umriss[(i + 1) % umriss.length]));
      if (nah <= AUSSEN_TOLERANZ) break;
    }
    if (nah <= AUSSEN_TOLERANZ) treffer++;
  }
  return treffer >= 2;
}


/**
 * Wände dort teilen, wo ein fremdes Wandende auf ihnen sitzt.
 *
 * **Warum das nötig ist.** RoomPlan liefert jede Wand als eigene Fläche. Wo
 * eine Zwischenwand auf eine durchlaufende Wand trifft, endet sie geometrisch
 * korrekt auf deren Achse — aber die beiden teilen sich keinen Knoten. Die
 * Raumerkennung sucht geschlossene Umläufe über Knoten; ohne geteilten Knoten
 * läuft sie an der Zwischenwand vorbei, und aus zwei Räumen wird einer. Genau
 * das passiert in der Beispieldatei an elf Stellen.
 *
 * **Warum nicht großzügiger.** Geteilt wird nur, was ohnehin schon auf der
 * Achse liegt (`STOSS_TOLERANZ`). Ein Wandende, das anderthalb Meter daneben
 * endet, bleibt offen — es ist ein *echtes* offenes Ende, das der Scan so
 * gemessen hat. Es heranzuziehen hieße, ein Bauteil zu erfinden, und der
 * Grundriss sähe geschlossener aus, als die Aufnahme hergibt.
 *
 * Der Knoten wird dabei exakt auf die Achse gesetzt — eine Korrektur von
 * höchstens `STOSS_TOLERANZ`, also innerhalb der Messstreuung des Scans.
 *
 * Verändert `walls`, `knoten` und `wandZuQuelle` an Ort und Stelle und gibt
 * zurück, wie viele Stöße hergestellt wurden.
 */
function teileAnStoessen(
  walls: Wall[],
  knoten: BimNode[],
  unten: Map<string, number>,
  wandZuQuelle: Map<string, Wall[]>,
): number {
  const nachId = new Map(knoten.map((k) => [k.id, k]));
  /** Wand → die Kennungen aus dem Scan, die zu ihr geführt haben. */
  const quellenVon = new Map<string, string[]>();
  for (const [quelle, liste] of wandZuQuelle) {
    for (const w of liste) {
      const vorhanden = quellenVon.get(w.id);
      if (vorhanden) vorhanden.push(quelle);
      else quellenVon.set(w.id, [quelle]);
    }
  }

  // Schritt 1 — jeden losen Knoten **einmal** auf die Achse setzen, auf der
  // er ohnehin schon liegt. Nur einmal: wer einen Knoten nacheinander auf
  // zwei Achsen zieht, holt ihn von der ersten wieder herunter. Im
  // 11,5-cm-Ständerwerk laufen solche Achsen dicht beieinander, und der
  // Fehler fällt erst auf, wenn ein Raum nicht mehr schließt.
  const gerade = (wand: Wall): { a: BimNode; b: BimNode; vx: number; vy: number; laenge: number } | null => {
    const a = nachId.get(wand.a);
    const b = nachId.get(wand.b);
    if (!a || !b) return null;
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const laenge = Math.hypot(vx, vy);
    return laenge < 2 * STOSS_RANDABSTAND ? null : { a, b, vx, vy, laenge };
  };

  for (const k of knoten) {
    let beste: { x: number; y: number; quer: number } | null = null;
    for (const wand of walls) {
      if (k.id === wand.a || k.id === wand.b) continue;
      if (k.levelId !== wand.levelId) continue;
      const g = gerade(wand);
      if (!g) continue;
      const t = ((k.x - g.a.x) * g.vx + (k.y - g.a.y) * g.vy) / (g.laenge * g.laenge);
      const laengs = t * g.laenge;
      if (laengs < STOSS_RANDABSTAND || laengs > g.laenge - STOSS_RANDABSTAND) continue;
      const fx = g.a.x + t * g.vx;
      const fy = g.a.y + t * g.vy;
      const quer = Math.hypot(k.x - fx, k.y - fy);
      if (quer > STOSS_TOLERANZ) continue;
      if (!beste || quer < beste.quer) beste = { x: fx, y: fy, quer };
    }
    if (beste) {
      k.x = rund(beste.x);
      k.y = rund(beste.y);
    }
  }

  // Schritt 2 — alle Teilstellen sammeln. Erst sammeln, dann teilen: würde man
  // sofort teilen, änderten sich die Wandlängen mitten in der Suche und
  // spätere Stöße fielen aus.
  const stellen = new Map<string, { node: BimNode; t: number }[]>();
  for (const wand of walls) {
    const g = gerade(wand);
    if (!g) continue;
    for (const k of knoten) {
      if (k.id === wand.a || k.id === wand.b) continue;
      if (k.levelId !== wand.levelId) continue;
      const t = ((k.x - g.a.x) * g.vx + (k.y - g.a.y) * g.vy) / (g.laenge * g.laenge);
      const laengs = t * g.laenge;
      if (laengs < STOSS_RANDABSTAND || laengs > g.laenge - STOSS_RANDABSTAND) continue;
      const quer = Math.hypot(k.x - (g.a.x + t * g.vx), k.y - (g.a.y + t * g.vy));
      // Nach Schritt 1 sitzt ein echter Stoß exakt auf der Achse. Wer hier
      // noch Millimeter zulässt, teilt Wände an Stellen, an denen gar kein
      // Bauteil ankommt.
      if (quer > 0.005) continue;
      const liste = stellen.get(wand.id);
      if (liste) liste.push({ node: k, t: laengs });
      else stellen.set(wand.id, [{ node: k, t: laengs }]);
    }
  }

  let hergestellt = 0;
  for (const [wandId, punkte] of stellen) {
    const index = walls.findIndex((w) => w.id === wandId);
    if (index < 0) continue;
    const wand = walls[index];
    const a = nachId.get(wand.a);
    const b = nachId.get(wand.b);
    if (!a || !b) continue;

    punkte.sort((p, q) => p.t - q.t);
    // Doppelte Stellen zusammenfassen: zwei Zwischenwände können an derselben
    // Stelle ankommen (Kreuzung). Ein zweites Teilen ergäbe eine Wand der
    // Länge null.
    const gefiltert = punkte.filter(
      (p, i) => i === 0 || p.t - punkte[i - 1].t > STOSS_RANDABSTAND,
    );

    const kette: BimNode[] = [a, ...gefiltert.map((p) => p.node), b];
    const quellen = quellenVon.get(wand.id) ?? [];
    const untenWert = unten.get(wand.id) ?? 0;
    const neue: Wall[] = [];
    for (let i = 0; i < kette.length - 1; i++) {
      const teil: Wall = {
        ...wand,
        id: i === 0 ? wand.id : `${wand.id}s${i}`,
        a: kette[i].id,
        b: kette[i + 1].id,
      };
      neue.push(teil);
      unten.set(teil.id, untenWert);
    }
    hergestellt += neue.length - 1;
    walls.splice(index, 1, ...neue);
    for (const q of quellen) wandZuQuelle.set(q, neue);
  }
  return hergestellt;
}
