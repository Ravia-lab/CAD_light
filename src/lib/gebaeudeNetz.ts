/**
 * Das Rohrnetz über **alle** Geschosse — mit Steigleitung.
 * ---------------------------------------------------------------------------
 * **Die Meldung:** „Wenn der Wärmeerzeuger unten ist und die Abnahme oben,
 * oder der Speicher im Keller steht, gibt es keine Strecke nach oben. Beim
 * Einfamilienhaus: Wärmepumpe im Garten, Verrohrung in den Technikraum im
 * Keller, wo Speicher und Verteiler stehen, und von dort nach oben verteilen
 * (Steigleitung)."
 *
 * Bis hierher plante `planPipeNetwork` **ein** Geschoss. Wo kein Erzeuger
 * stand, kam der Hinweis „die Zuleitung kommt von außerhalb dieses
 * Geschosses" — und das Rohr fehlte. Dieses Modul setzt die Geschosse
 * zusammen:
 *
 *   1. **Das Quellgeschoss finden.** Wo steht der Wärmeerzeuger oder der
 *      Speicher? Sonst: auf welchem Geschoss steht die Monoblock-Wärmepumpe
 *      im Garten (dann beginnt es an der Hauseinführung dieses Geschosses)?
 *   2. **Die Stränge setzen.** Vom Quellgeschoss aus nach oben und nach
 *      unten, Geschoss für Geschoss. Wo der Strang steht, entscheidet
 *      `steigpunkt` (Schacht, sonst lotrecht über der Quelle, sonst der
 *      nächste Raum).
 *   3. **Von außen nach innen rechnen.** Das oberste Geschoss zuerst: Sein
 *      Volumenstrom steht danach fest und wird dem Strang darunter
 *      mitgegeben. So trägt jeder Strangabschnitt genau das, was über ihm
 *      hängt — beim Dreigeschosser also KG → EG den Strom von EG **und** OG.
 *   4. **Zusammensetzen.** Läufe, Armaturen, Längen und Befunde aller
 *      Geschosse in einem Ergebnis; die Befunde tragen den Geschossnamen
 *      davor, sonst weiß niemand, wo etwas fehlt.
 *
 * Ein einzelnes Geschoss ohne Erzeuger im Haus bleibt wie bisher: Gibt es
 * nichts zu verbinden, wird genau das geplant, was auf dem sichtbaren
 * Geschoss steht.
 */

import type { BimDocument, Fixture, Level, PipeAccessory, PipeRun, Vec2 } from '../types/bim';
import { planPipeNetwork, type PipeLayoutOptions, type PipeLayoutResult } from './pipeLayout';
import { steigpunkt, type SteigGrund } from './steigstrang';
import { fuehrtEinAufGeschoss } from './aufstellgeschoss';
import type { PlanningNote } from './pipeRouting';

export interface GeschossNetz {
  levelId: string;
  name: string;
  served: number;
  /** Volumenstrom am Stamm dieses Geschosses [m³/h]. */
  designFlow: number;
  routeLength: number;
  pipeLength: number;
}

export interface Strangabschnitt {
  vonLevelId: string;
  nachLevelId: string;
  position: Vec2;
  grund: SteigGrund;
  /** Volumenstrom, den dieser Abschnitt trägt [m³/h]. */
  strom: number;
}

export interface GebaeudeNetzErgebnis extends Omit<PipeLayoutResult, 'designFlow'> {
  /** Je geplantem Geschoss eine Zeile. */
  geschosse: GeschossNetz[];
  /** Die gesetzten Strangabschnitte, von unten nach oben. */
  straenge: Strangabschnitt[];
}

/** Verbraucher, die ein Geschoss überhaupt erst planenswert machen. */
const VERBRAUCHER = new Set<Fixture['type']>([
  'radiator',
  'radiator-tube',
  'towel-radiator',
  'convector',
  'underfloor',
  'manifold',
]);

function hatVerbraucher(doc: BimDocument, levelId: string): boolean {
  return Object.values(doc.fixtures).some((f) => f.levelId === levelId && VERBRAUCHER.has(f.type));
}

/** Erzeuger oder Speicher auf diesem Geschoss? */
function quelleAuf(doc: BimDocument, levelId: string): Fixture | undefined {
  const auf = Object.values(doc.fixtures).filter((f) => f.levelId === levelId);
  return auf.find((f) => f.type === 'boiler') ?? auf.find((f) => f.type === 'storage');
}


/**
 * Kennungen je Geschoss eindeutig machen.
 *
 * `planPipeNetwork` zählt seine Läufe je Aufruf von vorn (`pr-1`, `pr-2`, …).
 * Über mehrere Geschosse hinweg trafen sich die Kennungen deshalb — und das
 * Dokument legt Leitungen nach Kennung ab: Das zuletzt geschriebene Geschoss
 * überschrieb die vorigen, und im Plan fehlte ein ganzes Obergeschoss. Die
 * Kennung bekommt darum das Geschoss angehängt; Paarkennung und der Verweis
 * der Armatur auf ihren Abschnitt wandern mit.
 */
function eindeutig(
  levelId: string,
  runs: PipeRun[],
  accessories: PipeAccessory[],
): { runs: PipeRun[]; accessories: PipeAccessory[] } {
  const neu = (id: string) => `${id}@${levelId}`;
  return {
    runs: runs.map((r) => ({
      ...r,
      id: neu(r.id),
      ...(r.pairId ? { pairId: neu(r.pairId) } : {}),
    })),
    accessories: accessories.map((a) => ({
      ...a,
      id: neu(a.id),
      ...(a.runId ? { runId: neu(a.runId) } : {}),
    })),
  };
}

export function planeGebaeudeNetz(
  doc: BimDocument,
  options: Omit<PipeLayoutOptions, 'levelId'> & { levelId: string },
): GebaeudeNetzErgebnis {
  const levels: Level[] = Object.values(doc.levels).sort((a, b) => a.order - b.order);
  const einzeln = (ergebnis: PipeLayoutResult, level?: Level): GebaeudeNetzErgebnis => ({
    ...ergebnis,
    geschosse: [
      {
        levelId: options.levelId,
        name: level?.name ?? options.levelId,
        served: ergebnis.served,
        designFlow: ergebnis.designFlow,
        routeLength: ergebnis.routeLength,
        pipeLength: ergebnis.pipeLength,
      },
    ],
    straenge: [],
  });

  // --- Quellgeschoss --------------------------------------------------------
  const mitQuelle = levels.find((l) => quelleAuf(doc, l.id));
  /*
   * Das Geschoss, auf dem die Wärmepumpe ins Haus führt — dieselbe Frage, die
   * `planPipeNetwork` stellt, und deshalb dieselbe Antwort. Liefen die beiden
   * auseinander, setzte dieses Modul die Steigleitung auf ein Geschoss, an dem
   * die Trassierung dort gar nicht beginnt.
   */
  const mitPumpe = levels.find((l) =>
    Object.values(doc.site?.pumps ?? {}).some((p) => p.form === 'monoblock-outdoor' && fuehrtEinAufGeschoss(doc, p, l.id)),
  );
  const quellGeschoss = mitQuelle ?? mitPumpe;

  /** Geschosse, die versorgt werden wollen. */
  const zuVersorgen = levels.filter((l) => hatVerbraucher(doc, l.id) || l.id === quellGeschoss?.id);

  if (!quellGeschoss || zuVersorgen.length <= 1) {
    const level = doc.levels[options.levelId];
    return einzeln(planPipeNetwork(doc, options), level);
  }

  const k = levels.findIndex((l) => l.id === quellGeschoss.id);
  const nachOben = levels.slice(k + 1).filter((l) => zuVersorgen.some((z) => z.id === l.id));
  const nachUnten = levels
    .slice(0, k)
    .reverse()
    .filter((l) => zuVersorgen.some((z) => z.id === l.id));

  const quelleFixture = quelleAuf(doc, quellGeschoss.id);
  /**
   * Der Ausgangspunkt im Quellgeschoss. Ohne Erzeuger im Haus (nur
   * Wärmepumpe) ist es der Schwerpunkt der Räume — die Hauseinführung selbst
   * steht erst in `planPipeNetwork` fest, und für die Lage des Strangs genügt
   * „irgendwo im Haus".
   */
  const raeumeQuelle = Object.values(doc.rooms).filter((r) => r.levelId === quellGeschoss.id);
  const quellPunkt: Vec2 =
    quelleFixture?.position ??
    (raeumeQuelle.length
      ? {
          x: raeumeQuelle.reduce((s, r) => s + r.centroid.x, 0) / raeumeQuelle.length,
          y: raeumeQuelle.reduce((s, r) => s + r.centroid.y, 0) / raeumeQuelle.length,
        }
      : { x: 0, y: 0 });

  const verticals = Object.values(doc.verticals ?? {});
  const notes: PlanningNote[] = [];
  const straenge: Strangabschnitt[] = [];

  /** Die Strangpunkte einer Richtung, Geschoss für Geschoss. */
  const punkteFuer = (kette: Level[]): { level: Level; punkt: Vec2; grund: SteigGrund }[] => {
    const ergebnis: { level: Level; punkt: Vec2; grund: SteigGrund }[] = [];
    let von = quellGeschoss;
    let quelle = quellPunkt;
    for (const ziel of kette) {
      const p = steigpunkt({
        quelle,
        levels: doc.levels,
        vonLevelId: von.id,
        nachLevelId: ziel.id,
        verticals,
        raeumeOben: Object.values(doc.rooms).filter((r) => r.levelId === ziel.id),
      });
      if (!p) {
        notes.push({
          severity: 'warn',
          text:
            `${ziel.name}: Kein Platz für die Steigleitung gefunden — auf diesem Geschoss ist kein geschlossener Raum erkannt. ` +
            'Das Geschoss bleibt ohne Zuleitung.',
        });
        break;
      }
      ergebnis.push({ level: ziel, punkt: p.position, grund: p.grund });
      von = ziel;
      quelle = p.position;
    }
    return ergebnis;
  };

  const ketteOben = punkteFuer(nachOben);
  const ketteUnten = punkteFuer(nachUnten);

  // --- Von außen nach innen rechnen ----------------------------------------
  const runs: PipeRun[] = [];
  const accessories: PipeAccessory[] = [];
  const geschosse: GeschossNetz[] = [];
  let routeLength = 0;
  let pipeLength = 0;
  let served = 0;

  /**
   * Eine Richtung durchrechnen — vom äußersten Geschoss zurück zur Quelle.
   * Zurückgegeben wird der Volumenstrom, den der erste Strangabschnitt (vom
   * Quellgeschoss aus) tragen muss.
   */
  const richtung = (kette: { level: Level; punkt: Vec2; grund: SteigGrund }[], aufwaerts: boolean): number => {
    let kumuliert = 0;
    for (let i = kette.length - 1; i >= 0; i--) {
      const { level, punkt, grund } = kette[i];
      const weiter = kette[i + 1];
      const ergebnis = planPipeNetwork(doc, {
        ...options,
        levelId: level.id,
        einspeisung: { position: punkt, label: `Steigleitung aus ${(kette[i - 1]?.level ?? quellGeschoss).name}` },
        steigfuesse: weiter
          ? [
              {
                position: weiter.punkt,
                label: `Steigleitung ${aufwaerts ? 'ins' : 'ins'} ${weiter.level.name}`,
                strom: kumuliert,
                bisHoehe: aufwaerts ? level.height : 0,
              },
            ]
          : undefined,
      });
      for (const n of ergebnis.notes) notes.push({ severity: n.severity, text: `${level.name}: ${n.text}` });
      const eindeutigeTeile = eindeutig(level.id, ergebnis.runs, ergebnis.accessories);
      runs.push(...eindeutigeTeile.runs);
      accessories.push(...eindeutigeTeile.accessories);
      routeLength += ergebnis.routeLength;
      pipeLength += ergebnis.pipeLength;
      served += ergebnis.served;
      geschosse.push({
        levelId: level.id,
        name: level.name,
        served: ergebnis.served,
        designFlow: ergebnis.designFlow,
        routeLength: ergebnis.routeLength,
        pipeLength: ergebnis.pipeLength,
      });
      // Der Strom dieses Geschosses **einschließlich** dessen, was darüber
      // hängt, ist die Bemessung für den Strang darunter.
      kumuliert = ergebnis.designFlow;
      straenge.push({
        vonLevelId: (kette[i - 1]?.level ?? quellGeschoss).id,
        nachLevelId: level.id,
        position: punkt,
        grund,
        strom: kumuliert,
      });
    }
    return kumuliert;
  };

  const stromOben = ketteOben.length ? richtung(ketteOben, true) : 0;
  const stromUnten = ketteUnten.length ? richtung(ketteUnten, false) : 0;

  // --- Das Quellgeschoss ----------------------------------------------------
  const fuesse: NonNullable<PipeLayoutOptions['steigfuesse']> = [];
  if (ketteOben.length && stromOben > 0) {
    fuesse.push({
      position: ketteOben[0].punkt,
      label: `Steigleitung ins ${ketteOben[0].level.name}`,
      strom: stromOben,
      bisHoehe: quellGeschoss.height,
    });
  }
  if (ketteUnten.length && stromUnten > 0) {
    fuesse.push({
      position: ketteUnten[0].punkt,
      label: `Steigleitung ins ${ketteUnten[0].level.name}`,
      strom: stromUnten,
      bisHoehe: 0,
    });
  }
  const quellErgebnis = planPipeNetwork(doc, {
    ...options,
    levelId: quellGeschoss.id,
    steigfuesse: fuesse.length ? fuesse : undefined,
  });
  for (const n of quellErgebnis.notes) notes.push({ severity: n.severity, text: `${quellGeschoss.name}: ${n.text}` });
  const quellTeile = eindeutig(quellGeschoss.id, quellErgebnis.runs, quellErgebnis.accessories);
  runs.push(...quellTeile.runs);
  accessories.push(...quellTeile.accessories);
  routeLength += quellErgebnis.routeLength;
  pipeLength += quellErgebnis.pipeLength;
  served += quellErgebnis.served;
  geschosse.push({
    levelId: quellGeschoss.id,
    name: quellGeschoss.name,
    served: quellErgebnis.served,
    designFlow: quellErgebnis.designFlow,
    routeLength: quellErgebnis.routeLength,
    pipeLength: quellErgebnis.pipeLength,
  });

  notes.push({
    severity: 'info',
    text:
      `Gebäudenetz: ${geschosse.length} Geschosse ab „${quellGeschoss.name}", ` +
      `${straenge.length} Strangabschnitt(e), zusammen ${Math.round(pipeLength * 10) / 10} m Rohr.`,
  });

  return {
    runs,
    accessories,
    routeLength: Math.round(routeLength * 1000) / 1000,
    pipeLength: Math.round(pipeLength * 1000) / 1000,
    served,
    notes,
    geschosse: geschosse.sort((a, b) => (doc.levels[a.levelId]?.order ?? 0) - (doc.levels[b.levelId]?.order ?? 0)),
    /*
     * **Von unten nach oben**, so wie es die Schnittstelle zusagt.
     *
     * Gerechnet wird von außen nach innen — das oberste Geschoss zuerst,
     * damit jeder Abschnitt weiß, was über ihm hängt. In dieser Reihenfolge
     * entstanden die Abschnitte auch in der Liste, und wer sie las, bekam
     * den obersten zuerst. Für die Rechnung ist das gleichgültig, für jeden
     * Leser nicht: Ein Strang wird von unten gelesen, wie er gebaut wird.
     */
    straenge: straenge.sort(
      (a, b) => (doc.levels[a.vonLevelId]?.order ?? 0) - (doc.levels[b.vonLevelId]?.order ?? 0),
    ),
  };
}
