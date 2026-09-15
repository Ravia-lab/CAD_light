/**
 * Die Eingangsgrößen der Auslegung — als Block für den Rechenkern.
 * ---------------------------------------------------------------------------
 * **Warum es diese Datei gibt.** Eine Lückenanalyse vor der Übergabe an RaVia
 * hat einen einzigen harten Blocker gefunden, und er steckte nicht in der
 * Geometrie, sondern in einer fehlenden Zahl: `FixtureParams.powerW` ist die
 * **Normwärmeleistung bei 55/45/20 °C**. Eine Wärmepumpe fährt 35/28 oder
 * 45/38. Die Umrechnung zwischen beiden lautet nach DIN EN 442-2
 *
 *     Q = Q_norm · (Δθ / Δθ_norm)^n
 *
 * und der **Exponent n** stand nirgends im Export. Der Rechenkern bekam damit
 * eine Zahl, die für seinen Betriebspunkt nicht gilt, und keinen Weg, sie
 * umzurechnen. Dasselbe bei der Fußbodenheizung: das Kennfeld nach
 * DIN EN 1264-2 hängt an Verlegeabstand, Estrichüberdeckung **und**
 * Belagswiderstand R_λB — zwei der drei standen im Export, der dritte nicht.
 *
 * **Was dieses Modul tut und was es bewusst lässt.** Es rechnet nichts. Es
 * sammelt je Heizfläche die Eingangsgrößen, sagt bei jeder, **woher sie
 * kommt** (gemessen, eingegeben, gerechnet, angenommen), und führt auf, was
 * fehlt. Die Auslegung selbst gehört in den Rechenkern — dort liegen die
 * Herstellerdaten, die Klimakarte und die U-Werte, und dort liegt die
 * Verantwortung für das Ergebnis.
 *
 * **Warum Annahmen trotzdem vorkommen.** Ein leeres Feld ist für einen
 * Rechenkern nicht besser als ein falsches: er muss dann selbst annehmen, und
 * eine Annahme, die zwei Programme unabhängig treffen, ist zweimal anders.
 * Deshalb steht der branchenübliche Richtwert **mit Kennzeichen und
 * Begründung** im Export. `herkunft: 'angenommen'` heißt ausdrücklich: diesen
 * Wert darf und soll der Rechenkern durch einen besseren ersetzen.
 */

import type {
  BimDocument,
  ExportConsumerBalance,
  ExportEmitter,
  ExportHydraulics,
  Fixture,
  FixtureType,
  Auslegungswert,
} from '../types/bim';
import type { BalanceReport } from './hydraulicBalance';
import type { Erzeugerbilanz } from './erzeugerHydraulik';

// ---------------------------------------------------------------------------
// Richtwerte, die als Annahme gekennzeichnet werden
// ---------------------------------------------------------------------------

/**
 * Branchenüblicher Heizkörperexponent je Bauart [-].
 *
 * **Kein Messwert und kein Normwert**, sondern die Größenordnung, die die
 * Datenblätter der gängigen Hersteller für diese Bauarten ausweisen. Der
 * wirkliche Exponent steht im Datenblatt des eingebauten Geräts und schwankt
 * je Baureihe; deshalb trägt jeder so gesetzte Wert `herkunft: 'angenommen'`
 * und wird vom Rechenkern ersetzt, sobald das Fabrikat feststeht.
 *
 * Die Spreizung ist klein, aber nicht folgenlos: zwischen n = 1,30 und
 * n = 1,40 liegen bei 35/28 gegenüber 55/45 rund 4 % Leistung.
 */
export const EMITTER_EXPONENT_ANNAHME: Partial<Record<FixtureType, number>> = {
  radiator: 1.3,
  convector: 1.4,
  underfloor: 1.1,
};

/** Bei welchen Temperaturen die Normleistung gilt (DIN EN 442-2). */
export const NORM_TEMPERATUREN = { vorlauf: 55, ruecklauf: 45, raum: 20 } as const;

/** Welche Norm die Leistung dieser Bauart beschreibt. */
function regelFuer(type: FixtureType): ExportEmitter['rule'] {
  if (type === 'underfloor') return 'EN 1264';
  if (type === 'radiator' || type === 'convector') return 'EN 442';
  return 'unbekannt';
}

const wert = (v: number | undefined, herkunft: Auslegungswert['herkunft'], begruendung?: string): Auslegungswert | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? { wert: v, herkunft, ...(begruendung ? { begruendung } : {}) } : undefined;

// ---------------------------------------------------------------------------
// Heizflächen
// ---------------------------------------------------------------------------

/**
 * Alle Heizflächen des Modells als Rechenfälle.
 *
 * Aufgenommen wird, was Wärme abgibt — Heizkörper, Konvektoren,
 * Fußbodenheizkreise. Lüftungs- und Sanitärobjekte bleiben draußen: sie
 * stehen in `rooms[].fixtures` und haben mit der Heizflächenauslegung nichts
 * zu tun.
 */
export function buildEmitters(doc: BimDocument): ExportEmitter[] {
  const raus: ExportEmitter[] = [];
  for (const f of Object.values(doc.fixtures) as Fixture[]) {
    if (f.category !== 'heating') continue;
    const regel = regelFuer(f.type);
    if (regel === 'unbekannt') continue;
    raus.push(einEmitter(f, regel, doc));
  }
  return raus.sort((a, b) => a.fixtureId.localeCompare(b.fixtureId));
}

function einEmitter(f: Fixture, rule: ExportEmitter['rule'], doc: BimDocument): ExportEmitter {
  const p = f.params;
  const fehlt: string[] = [];

  // --- Der Exponent: die Zahl, an der die Übergabe hing ---------------------
  let exponent: Auslegungswert | undefined;
  if (typeof p.radiatorExponent === 'number' && p.radiatorExponent > 0) {
    exponent = { wert: p.radiatorExponent, herkunft: 'eingegeben' };
  } else {
    const richtwert = EMITTER_EXPONENT_ANNAHME[f.type];
    if (richtwert !== undefined) {
      exponent = {
        wert: richtwert,
        herkunft: 'angenommen',
        begruendung:
          `Branchenüblicher Richtwert für diese Bauart; das Datenblatt des eingebauten Geräts ` +
          `nennt den wirklichen Exponenten. Ohne ihn ist die Normleistung nach DIN EN 442-2 ` +
          `nicht auf einen anderen Betriebspunkt umrechenbar.`,
      };
      fehlt.push('Heizkörperexponent n aus dem Datenblatt');
    }
  }

  // --- Leistung und Betriebspunkt ------------------------------------------
  const leistung = wert(p.powerW, 'eingegeben');
  if (!leistung) fehlt.push('Normwärmeleistung');

  const vorlauf = wert(p.flowTemperature, 'eingegeben');
  const ruecklauf = wert(p.returnTemperature, 'eingegeben');
  if (!vorlauf || !ruecklauf) fehlt.push('Auslegungstemperaturen dieser Heizfläche');

  const e: ExportEmitter = {
    fixtureId: f.id,
    ...(f.roomId ? { roomId: f.roomId } : {}),
    levelId: f.levelId,
    label: f.label ?? f.type,
    type: f.type,
    rule,
    ...(leistung ? { nominalPower: leistung } : {}),
    nominalFlowTemperature: NORM_TEMPERATUREN.vorlauf,
    nominalReturnTemperature: NORM_TEMPERATUREN.ruecklauf,
    nominalRoomTemperature: NORM_TEMPERATUREN.raum,
    ...(vorlauf ? { designFlowTemperature: vorlauf } : {}),
    ...(ruecklauf ? { designReturnTemperature: ruecklauf } : {}),
    ...(exponent ? { exponent } : {}),
    missing: fehlt,
  };

  if (rule === 'EN 442') {
    e.length = f.length;
    e.depth = f.depth;
    const hoehe = wert(p.radiatorHeight, 'eingegeben');
    if (hoehe) e.height = hoehe;
    else fehlt.push('Bauhöhe des Heizkörpers');
    if (typeof p.radiatorSections === 'number') e.sections = p.radiatorSections;
    if (p.radiatorConnection) e.connection = p.radiatorConnection;
    else
      fehlt.push(
        'Anschlussart — die Normleistung gilt für „oben/unten wechselseitig"; jede andere braucht einen Korrekturfaktor',
      );
  }

  if (rule === 'EN 1264') {
    const abstand = wert(p.loopSpacing, 'eingegeben');
    if (abstand) e.loopSpacing = abstand;
    else fehlt.push('Verlegeabstand');

    const ueberdeckung = wert(p.screedCover, 'eingegeben');
    if (ueberdeckung) e.screedCover = ueberdeckung;
    else fehlt.push('Estrichüberdeckung über dem Rohrscheitel');

    const belag = wert(p.floorCoveringResistance, 'eingegeben');
    if (belag) e.floorCoveringResistance = belag;
    else fehlt.push('Wärmedurchlasswiderstand des Bodenbelags R_λB');

    const da = wert(p.pipeOuterDiameter, 'eingegeben');
    if (da) e.pipeOuterDiameter = da;
    else fehlt.push('Rohraußendurchmesser');

    const s = wert(p.pipeWallThickness, 'eingegeben');
    if (s) e.pipeWallThickness = s;

    if (typeof p.loopCount === 'number') e.loopCount = p.loopCount;
    // Die belegte Fläche ist die Raumfläche, nicht die Symbolfläche — eine
    // Flächenheizung belegt den Raum, sie steht nicht an einer Wand.
    const raum = f.roomId ? doc.rooms?.[f.roomId] : undefined;
    if (raum && typeof raum.area === 'number') e.area = Math.round(raum.area * 100) / 100;
    else fehlt.push('belegte Fläche — der Heizkreis ist keinem erkannten Raum zugeordnet');
  }

  return e;
}

// ---------------------------------------------------------------------------
// Hydraulik
// ---------------------------------------------------------------------------

/**
 * Die Vorbemessung der Hydraulik für den Export.
 *
 * **Warum sie überhaupt mitgeht, obwohl RaVia rechnet.** Sie ist der Stand,
 * den die Zeichnung hergibt: Trassenlängen, Einzelwiderstände, welcher Strang
 * der ungünstigste ist. RaVia kann das aus `pipes` zwar neu herleiten, würde
 * dabei aber unweigerlich an ein paar Stellen anders entscheiden als das
 * Programm, das die Trasse gezeichnet hat — und niemand würde es merken. Mit
 * der Vorbemessung daneben ist der Vergleich billig und der Unterschied
 * sichtbar. `status: 'vorbemessung'` steht deshalb im Dokument: maßgebend ist
 * die Rechnung in RaVia, nicht diese hier.
 */
export function buildHydraulics(bericht: BalanceReport, erzeuger?: Erzeugerbilanz): ExportHydraulics {
  const pa = (v: number): number => Math.round(v);
  const consumers: ExportConsumerBalance[] = bericht.consumers.map((c) => ({
    fixtureId: c.fixtureId,
    label: c.label,
    ...(c.roomId ? { roomId: c.roomId } : {}),
    flow: Math.round(c.flow * 1000) / 1000,
    powerW: Math.round(c.power),
    lossPa: pa(c.ownLoss),
    ...(c.requiredKv !== undefined ? { requiredKv: Math.round(c.requiredKv * 100) / 100 } : {}),
    ...(c.throttle > 0 ? { throttlePa: pa(c.throttle) } : {}),
    ...(c.valvePressure !== undefined ? { valvePa: pa(c.valvePressure) } : {}),
    ...(c.authority !== undefined ? { authority: Math.round(c.authority * 100) / 100 } : {}),
    ...(c.presetSelection?.setting ? { preset: `${c.presetSelection.model.label} · Stufe ${c.presetSelection.setting}` } : {}),
  }));

  return {
    status: 'vorbemessung',
    spread: bericht.spread,
    fluid: {
      name: bericht.fluid.glycolFraction > 0 ? `${bericht.fluid.glycolKind} ${Math.round(bericht.fluid.glycolFraction * 100)} %` : 'Wasser',
      density: Math.round(bericht.fluid.density * 10) / 10,
      heatCapacity: Math.round(bericht.fluid.heatCapacity),
      viscosity: bericht.fluid.kinematicViscosity,
    },
    material: bericht.material,
    totalFlow: Math.round(bericht.totalFlow * 1000) / 1000,
    totalPower: Math.round(bericht.totalPower * 100) / 100,
    consumers,
    ...(bericht.worst ? { worst: { fixtureId: bericht.worst.fixtureId, label: bericht.worst.label, lossPa: pa(bericht.worst.loss) } } : {}),
    ...(bericht.best ? { best: { fixtureId: bericht.best.fixtureId, label: bericht.best.label, lossPa: pa(bericht.best.loss) } } : {}),
    lossSpreadPa: pa(bericht.lossSpread),
    lossRatio: Math.round(bericht.lossRatio * 100) / 100,
    notAdjustable: bericht.notAdjustable,
    beyondPreset: bericht.beyondPreset,
    pump: {
      flow: Math.round(bericht.pump.flow * 1000) / 1000,
      head: Math.round(bericht.pump.head * 100) / 100,
    },
    ...(erzeuger ? { generator: erzeugerBlock(erzeuger) } : {}),
    notes: [
      ...bericht.notes.map((n) => (typeof n === 'string' ? n : (n as { text?: string }).text ?? String(n))),
      ...(erzeuger?.hinweise ?? []).map((h) => h.text),
    ],
  };
}

/**
 * Die Erzeugerseite — und warum sie nicht ein Zahlenfeld ist.
 *
 * Ein Hersteller nennt **entweder** den Druckverlust seines Geräts **oder**
 * die Restförderhöhe, die seine eingebaute Pumpe übriglässt. Die beiden
 * schließen einander aus und zeigen in entgegengesetzte Richtungen: der
 * Druckverlust ist ein Posten, den die Pumpe zusätzlich überwinden muss, die
 * Restförderhöhe ist eine Obergrenze, die das Rohrnetz nicht überschreiten
 * darf. Wer sie verwechselt, rechnet um 40 bis 70 kPa falsch — und zwar in
 * beide Richtungen.
 *
 * Deshalb steht hier `kind` neben dem Wert und nicht ein neutrales
 * `druckverlust_kpa`, in das mal das eine und mal das andere geriete.
 */
function erzeugerBlock(e: Erzeugerbilanz): NonNullable<ExportHydraulics['generator']> {
  const flow = Math.round(e.volumenstrom * 1000) / 1000;

  // **Ohne Herstellerangabe kein Herstellerwert.** `zusatz` ist die Summe, die
  // zum Rohrnetz addiert wird — sie enthält auch Wärmemengenzähler,
  // Schlammabscheider und Umschaltventil. Sie als „Gerätedruckverlust"
  // auszugeben, wäre eine falsche Etikette: der Rechenkern würde die
  // Einbauten für das Gerät halten und sie im Fließweg ein zweites Mal
  // ansetzen.
  if (!e.hydraulik) {
    return {
      kind: 'unbekannt',
      flow,
      source:
        'Kein Gerät gewählt oder der Hersteller nennt weder Δp noch Restförderhöhe. ' +
        'Die Einbauten des Erzeugerkreises stecken in den Strangverlusten der Verbraucher.',
    };
  }

  // Die Herkunft gehört in die Quellenangabe. Ein Wert aus dem Datenblatt
  // eines bestimmten Geräts und ein Median über 18 veröffentlichte Werte sind
  // beide brauchbar — aber nicht gleich gut, und der Unterschied muss
  // ablesbar sein, ohne dass jemand nachfragt.
  const quelle =
    e.hydraulik.herkunft === 'tabellenwert'
      ? e.hydraulik.quelle
      : `${e.hydraulik.quelle} (${HERKUNFT_KLARTEXT[e.hydraulik.herkunft]})`;

  if (e.angabe === 'restfoerderhoehe') {
    return {
      kind: 'restfoerderhoehe',
      ...(e.verfuegbar !== undefined ? { valuePa: Math.round(e.verfuegbar) } : {}),
      flow,
      source: quelle,
    };
  }

  // Der Anteil des **Geräts**, nicht die Summe des Fließwegs.
  const geraet = e.posten.find((p) => p.art === 'generator');
  return {
    kind: 'geraetedruckverlust',
    ...(geraet ? { valuePa: Math.round(geraet.druck) } : {}),
    flow,
    source: quelle,
  };
}

const HERKUNFT_KLARTEXT: Record<string, string> = {
  tabellenwert: 'Tabellenwert des Herstellers',
  'diagramm-abgelesen': 'aus einem Herstellerdiagramm abgelesen',
  abgeleitet: 'abgeleitet, kein Datenblattwert des eingebauten Geräts',
  annahme: 'Annahme',
};
