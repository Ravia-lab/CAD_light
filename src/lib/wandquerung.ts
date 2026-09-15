/**
 * Wo eine Leitung durch eine Wand geht.
 * ---------------------------------------------------------------------------
 *
 * **Warum es diese Datei gibt.** Eine ausgelegte Trasse läuft durch das
 * Gebäude, und an jeder Wand, die sie kreuzt, muss jemand bohren. Bis 1.25.0
 * stand davon nichts im Modell: Der Rohrausleger meldete die Querung als
 * Textnotiz („Türdurchgang — vor Ort entscheiden"), und im Massenauszug, in
 * der Bauteilliste und auf dem Plan fehlte die Bohrung. Der Rohbau bekommt
 * dann eine Leitungsführung ohne Durchbrüche, und gebohrt wird, wenn der
 * Estrich liegt.
 *
 * **Was hier entschieden wird und was nicht.** Diese Datei findet die
 * Querungen und schlägt für jede ein Regelmaß vor. Sie entscheidet **nicht**,
 * ob gebohrt werden darf: Ob eine tragende Wand an dieser Stelle geschwächt
 * werden kann, ist eine Frage an den Tragwerksplaner und keine, die ein
 * Programm aus einer Wandstärke beantwortet. Die erzeugten Durchbrüche sind
 * deshalb Vorschläge im Modell, die man sieht, prüft und verschiebt — und
 * nicht Ausführungsanweisungen.
 *
 * **Drei Regeln, die den Unterschied machen:**
 *
 * 1. **Eine Leitung durch eine Tür braucht keine Bohrung.** Liegt die Querung
 *    innerhalb einer Öffnung und auf deren Höhe, entsteht kein Durchbruch.
 *    Ohne diese Prüfung stünde an jedem Türdurchgang eine Kernbohrung —
 *    fünfzig Positionen, die niemand braucht, und der Auszug wäre wertlos.
 * 2. **Vor- und Rücklauf teilen sich das Loch.** Sie laufen 5 cm nebeneinander
 *    (`PAARABSTAND` in `pipeLayout.ts`). Zwei Kernbohrungen im Abstand von
 *    5 cm sind in einer 11,5er Wand nicht herstellbar; gebohrt wird ein
 *    Durchbruch für beide.
 * 3. **Die Bohrung muss Rohr, Dämmung und Luft aufnehmen.** Gewählt wird die
 *    kleinste Krone des Regelmaßkatalogs, deren Nennweite die der Leitung
 *    erreicht — nicht die, deren Durchmesser rechnerisch passt. Wer nach
 *    Vollmaß dämmt, braucht ohnehin die nächstgrößere, und die steht dann als
 *    eigene Entscheidung im Plan.
 */

import type {
  BimDocument,
  Durchbruch,
  DurchbruchPreset,
  PipeRun,
  PipeService,
  ShaftService,
  Vec2,
} from '../types/bim';
import { DURCHBRUCH_PRESETS } from '../types/bim';
import { segmentIntersection } from './geometry';
import { hoeheAnPunkt } from './rohrlaenge';

/** Zwei Querungen gelten als dieselbe Stelle, wenn sie so nah beieinander liegen [m]. */
export const QUERUNG_ZUSAMMEN = 0.3;
/** …und höhengleich sind bis auf diesen Betrag [m]. */
export const QUERUNG_HOEHENFENSTER = 0.25;
/** Luft rund um das Rohr im rechteckigen Durchbruch [m]. */
export const QUERUNG_LUFT = 0.04;
/** Kleinste Kantenlänge eines rechteckigen Durchbruchs [m]. */
export const QUERUNG_MINDESTMASS = 0.15;

/** Eine einzelne Kreuzung von Leitung und Wandachse. */
export interface Wandquerung {
  wallId: string;
  runId: string;
  /** Abstand auf der Wandachse ab Knoten A [m]. */
  distance: number;
  punkt: Vec2;
  /** Höhe der Leitungsachse über Fertigfußboden [m]. */
  hoehe: number;
  nennweite: number;
  /** Außendurchmesser samt Dämmung [m] — das Maß, das durch die Wand muss. */
  aussen: number;
  service: PipeService;
  /** Die Querung liegt in einer Tür oder einem Durchgang — es wird nicht gebohrt. */
  inOeffnung: boolean;
}

/** Mehrere Querungen an derselben Stelle — ein Durchbruch für alle. */
export interface Querungsstelle {
  wallId: string;
  levelId: string;
  /** Mitte der Stelle auf der Wandachse [m]. */
  distance: number;
  /** Mitte der Stelle in der Höhe [m]. */
  hoehe: number;
  querungen: Wandquerung[];
}

const GEWERK: Record<PipeService, ShaftService> = {
  'heating-flow': 'heating',
  'heating-return': 'heating',
  'hot-water': 'sanitary',
  'cold-water': 'sanitary',
  circulation: 'sanitary',
  waste: 'sanitary',
  refrigerant: 'heating',
  'ventilation-supply': 'ventilation',
  'ventilation-exhaust': 'ventilation',
};

/**
 * Außenmaß einer Leitung samt Dämmung [m].
 *
 * `outerDiameter` steht in Millimetern am Abschnitt, wenn der Rohrausleger
 * ihn gesetzt hat. Fehlt er, ist die Nennweite die beste Auskunft, die es
 * gibt — sie unterschätzt das Außenmaß bei Kunststoff, und genau deshalb
 * wird hier nicht der Durchmesser, sondern die **Nennweite** zur Wahl der
 * Krone benutzt.
 */
export function aussenmass(run: PipeRun): number {
  const rohr = (run.outerDiameter ?? run.nominalDiameter * 1.15) / 1000;
  return rohr + 2 * ((run.insulation ?? 0) / 1000);
}

/** Alle Stellen, an denen eine Leitung eine Wandachse kreuzt. */
export function wandquerungen(doc: BimDocument, runs: readonly PipeRun[]): Wandquerung[] {
  const treffer: Wandquerung[] = [];
  const waende = Object.values(doc.walls ?? {});
  const oeffnungen = Object.values(doc.openings ?? {});

  for (const run of runs) {
    if (run.points.length < 2) continue;
    for (const wall of waende) {
      if (wall.levelId !== run.levelId) continue;
      const a = doc.nodes[wall.a];
      const b = doc.nodes[wall.b];
      if (!a || !b) continue;
      const achseA = { x: a.x, y: a.y };
      const achseB = { x: b.x, y: b.y };
      const laenge = Math.hypot(achseB.x - achseA.x, achseB.y - achseA.y);
      if (laenge < 1e-6) continue;

      for (let i = 1; i < run.points.length; i++) {
        const p = run.points[i - 1];
        const q = run.points[i];
        const kreuz = segmentIntersection(p, q, achseA, achseB, false);
        if (!kreuz) continue;

        const distance = Math.hypot(kreuz.x - achseA.x, kreuz.y - achseA.y);
        // Höhe linear über das Teilstück — dieselbe Annahme wie beim
        // Zeichnen der Leitung im Modell.
        const vonH = hoeheAnPunkt(run, i - 1);
        const bisH = hoeheAnPunkt(run, i);
        const teil = Math.hypot(q.x - p.x, q.y - p.y);
        const anteil = teil > 1e-9 ? Math.hypot(kreuz.x - p.x, kreuz.y - p.y) / teil : 0;
        const hoehe = vonH + (bisH - vonH) * Math.min(1, Math.max(0, anteil));

        const aussen = aussenmass(run);
        /*
         * Die Leitung muss mit ihrem **ganzen Querschnitt** in die Öffnung
         * passen, und zwar in beiden Richtungen.
         *
         * Die erste Fassung prüfte waagerecht nur die Achse und senkrecht
         * den ganzen Querschnitt. Eine Leitung, deren Achse zwei Millimeter
         * innerhalb der Laibung liegt, galt damit als „durch die Tür
         * geführt", obwohl sie zur Hälfte im Mauerwerk steckt — genau der
         * Fall, den die Höhenbedingung ausdrücklich ausschließt. Wo kein
         * Durchbruch entsteht, wird auch keiner gebohrt; die Leitung liegt
         * dann auf der Baustelle vor einer Wand, durch die sie nicht passt.
         */
        const halb = aussen / 2;
        const inOeffnung = oeffnungen.some((o) => {
          if (o.wallId !== wall.id) return false;
          if (Math.abs(o.distance - distance) + halb > o.width / 2 + 1e-6) return false;
          const unten = o.sillHeight ?? 0;
          return hoehe - halb >= unten - 1e-6 && hoehe + halb <= unten + o.height + 1e-6;
        });

        treffer.push({
          wallId: wall.id,
          runId: run.id,
          distance,
          punkt: kreuz,
          hoehe,
          nennweite: run.nominalDiameter,
          aussen,
          service: run.service,
          inOeffnung,
        });
      }
    }
  }
  return treffer;
}

/**
 * Querungen zu Stellen zusammenfassen.
 *
 * Querungen in Öffnungen fallen weg — dort wird nicht gebohrt.
 */
export function querungsstellen(doc: BimDocument, querungen: readonly Wandquerung[]): Querungsstelle[] {
  const stellen: Querungsstelle[] = [];
  for (const q of querungen) {
    if (q.inOeffnung) continue;
    const levelId = doc.walls[q.wallId]?.levelId;
    if (!levelId) continue;
    const passend = stellen.find(
      (s) =>
        s.wallId === q.wallId &&
        Math.abs(s.distance - q.distance) <= QUERUNG_ZUSAMMEN &&
        Math.abs(s.hoehe - q.hoehe) <= QUERUNG_HOEHENFENSTER,
    );
    if (passend) {
      passend.querungen.push(q);
      // Mitte neu bilden, damit der Durchbruch mittig über allen sitzt.
      passend.distance =
        passend.querungen.reduce((sum, x) => sum + x.distance, 0) / passend.querungen.length;
      passend.hoehe = passend.querungen.reduce((sum, x) => sum + x.hoehe, 0) / passend.querungen.length;
    } else {
      stellen.push({ wallId: q.wallId, levelId, distance: q.distance, hoehe: q.hoehe, querungen: [q] });
    }
  }
  return stellen;
}

/**
 * Die kleinste Kernbohrung, die eine Nennweite aufnimmt — **im Gewerk der
 * Leitung**.
 *
 * `undefined` heißt: Der Katalog hat nichts, was passt. Dann entsteht kein
 * Durchbruch, sondern ein Hinweis — eine zu kleine Krone stillschweigend
 * einzutragen wäre schlimmer als gar keine.
 *
 * **Warum nur im eigenen Gewerk.** Bis 1.27.0 durchsuchte diese Funktion den
 * ganzen Katalog nach Nennweite und nahm das Gewerk nur als Wunsch: Fand sich
 * im eigenen nichts, kam die nächstbeste Krone irgendeines Gewerks zurück.
 * Der Gedanke dahinter war „lieber zu groß als gar nichts" — und er war
 * falsch, weil `dn` über Gewerksgrenzen hinweg nicht dasselbe bedeutet:
 *
 *   • DN 40 heißt bei Elektro ein Leerrohr, Krone Ø 52.
 *   • DN 40 heißt bei Heizung ein Rohr mit 48,3 mm Außendurchmesser, das
 *     gedämmt gut 100 mm misst.
 *
 * Eine DN-40-Heizungsleitung bekam deshalb die **Elektrokrone Ø 52**: zu
 * klein, im Plan nicht zu sehen, und auf der Baustelle ein gebohrtes Loch,
 * durch das die Leitung nicht geht. Der offene Punkt aus 1.27.0 war insofern
 * zu milde formuliert — dort stand „richtig herum (nie zu klein)".
 *
 * Über die Gewerksgrenze hinweg lässt sich auch nichts umrechnen: Aus einer
 * Nennweite allein folgt kein Außenmaß, solange nicht feststeht, welcher
 * Katalog gemeint ist. Statt einen Faktor zu erfinden, endet die Suche hier
 * am eigenen Gewerk und meldet die Lücke — genauso wie oberhalb des
 * Katalogs. Das ist dieselbe Entscheidung, die dieses Programm überall
 * trifft, wo eine Zahl nicht ableitbar ist.
 */
export function kernbohrungFuer(nennweite: number, gewerk: ShaftService): DurchbruchPreset | undefined {
  return DURCHBRUCH_PRESETS.filter(
    (p) =>
      p.kind === 'kernbohrung' &&
      p.service === gewerk &&
      p.diameter !== undefined &&
      (p.dn ?? 0) >= nennweite,
  ).sort((x, y) => (x.dn ?? 0) - (y.dn ?? 0))[0];
}

const runde5 = (v: number): number => Math.ceil(v * 20) / 20;

/**
 * Aus einer Querungsstelle einen Durchbruch bauen.
 *
 * Eine Leitung → Kernbohrung. Mehrere → rechteckiger Wanddurchbruch, so
 * breit wie die Leitungen liegen, mit Luft ringsum und auf fünf Zentimeter
 * aufgerundet: Man reißt nach ganzen Zentimetern an, nicht nach
 * Millimetern aus einer Rechnung.
 */
export function durchbruchAusStelle(stelle: Querungsstelle, id: string): Durchbruch | null {
  const gewerke = new Set(stelle.querungen.map((q) => GEWERK[q.service]));
  const gewerk: ShaftService = gewerke.size === 1 ? [...gewerke][0] : 'mixed';
  const groesste = Math.max(...stelle.querungen.map((q) => q.aussen));

  if (stelle.querungen.length === 1) {
    const q = stelle.querungen[0];
    const preset = kernbohrungFuer(q.nennweite, gewerk);
    if (!preset || preset.diameter === undefined) return null;
    return {
      id,
      kind: 'kernbohrung',
      name: preset.label,
      levelId: stelle.levelId,
      wallId: stelle.wallId,
      distance: Math.round(stelle.distance * 1000) / 1000,
      form: 'rund',
      diameter: preset.diameter,
      /*
       * Bei runder Form ist `sillHeight` die **Achshöhe**, nicht die
       * Unterkante — so liest es `durchbruchSymbols.aussparung`. Hier die
       * Unterkante einzutragen legte jede Bohrung um einen halben
       * Durchmesser zu tief, und im Modell liefe die Leitung durch die
       * Wand statt durch das Loch.
       */
      sillHeight: Math.max(0, Math.round(stelle.hoehe * 1000) / 1000),
      service: gewerk,
      dn: preset.dn,
      brandschutz: 'keine',
      generated: true,
      note: `Leitungsquerung, ${new Intl.NumberFormat('de-DE').format(q.nennweite)} DN`,
    };
  }

  const abstaende = stelle.querungen.map((q) => q.distance);
  const breite = runde5(Math.max(...abstaende) - Math.min(...abstaende) + groesste + 2 * QUERUNG_LUFT);
  const hoehen = stelle.querungen.map((q) => q.hoehe);
  const hoehe = runde5(Math.max(...hoehen) - Math.min(...hoehen) + groesste + 2 * QUERUNG_LUFT);
  const h = Math.max(QUERUNG_MINDESTMASS, hoehe);
  return {
    id,
    kind: 'wanddurchbruch',
    name: `Wanddurchbruch ${Math.round(breite * 100)} × ${Math.round(h * 100)}`,
    levelId: stelle.levelId,
    wallId: stelle.wallId,
    distance: Math.round(stelle.distance * 1000) / 1000,
    form: 'rechteckig',
    width: Math.max(QUERUNG_MINDESTMASS, breite),
    height: h,
    sillHeight: Math.max(0, Math.round((stelle.hoehe - h / 2) * 1000) / 1000),
    service: gewerk,
    brandschutz: 'keine',
    generated: true,
    note: `Leitungsquerung, ${stelle.querungen.length} Leitungen`,
  };
}

/**
 * Der ganze Weg in einem Aufruf: Trassen hinein, Durchbrüche heraus.
 *
 * `uid` liefert die Kennungen — dieselbe Quelle wie im Store, damit sich die
 * Durchbrüche nicht von anderen Objekten unterscheiden.
 */
export function durchbruecheFuerTrassen(
  doc: BimDocument,
  runs: readonly PipeRun[],
  uid: () => string,
): { durchbrueche: Durchbruch[]; inOeffnung: number; ohneRegelmass: number } {
  const querungen = wandquerungen(doc, runs);
  const stellen = querungsstellen(doc, querungen);
  const durchbrueche: Durchbruch[] = [];
  let ohneRegelmass = 0;
  for (const stelle of stellen) {
    /*
     * Die Kennung wird erst gezogen, wenn feststeht, dass ein Durchbruch
     * entsteht.
     *
     * Vorher verbrauchte eine Stelle ohne Regelmaß eine Kennung und lieferte
     * `null` — die Nummern hatten dann Lücken. Das ist für sich harmlos
     * (Kennungen müssen nicht lückenlos sein), aber es ist eine Falle für
     * jeden, der aus der höchsten Nummer auf die Zahl der Durchbrüche
     * schließt, und es kostet nichts, sie zu vermeiden.
     */
    const probe = durchbruchAusStelle(stelle, 'probe');
    if (!probe) {
      ohneRegelmass += 1;
      continue;
    }
    durchbrueche.push({ ...probe, id: uid() });
  }
  return {
    durchbrueche,
    inOeffnung: querungen.filter((q) => q.inOeffnung).length,
    ohneRegelmass,
  };
}
