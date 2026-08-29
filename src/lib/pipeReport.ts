/**
 * Rohrnetzbericht — die Rechnung als Nachweis, nicht als Zahl im Panel.
 * ---------------------------------------------------------------------------
 * Bis 1.11.0 rechnete dieses Programm den hydraulischen Abgleich vollständig
 * durch — Colebrook-White, Einzelwiderstände, ungünstigster Strang, Pumpe —
 * und zeigte davon **sechs Kennzahlen und eine auf 24 Zeilen gekappte
 * Tabelle**. Alles andere verfiel. Das ist die eigentliche Lücke zwischen
 * „rechnet richtig" und „ist ein Rohrnetzrechner": nicht die Physik, sondern
 * der Weg vom Ergebnis auf das Blatt, das der Monteur in die Hand bekommt.
 *
 * Dieses Modul baut aus dem Modell den vollständigen Bericht als **Daten**.
 * Es zeichnet nichts. Wie daraus ein Blatt wird, entscheidet
 * `pipeReportPrint.ts`; wie daraus eine Bildschirmansicht wird, entscheidet
 * die Oberfläche. Getrennt, weil derselbe Bericht in drei Formen gebraucht
 * wird und eine Rechnung, die im Zeichenpfad steckt, nicht prüfbar ist.
 *
 * **Was der Bericht enthalten muss, ist nicht frei gewählt.** § 60c Abs. 4
 * GModG (vormals GEG) nennt sieben Pflichtangaben; die BAFA-Checkliste zur
 * Gleichwertigkeit erweitert sie um die Einstellwerte der Abgleichorgane und
 * Pumpen. SAENA nennt die Größen, die je Teilstrecke festzulegen sind. Die
 * Gliederung dieses Moduls folgt genau diesen drei Listen — jeder Abschnitt
 * trägt seine Herkunft im Kommentar.
 *
 * **Was der Bericht nicht ist:** kein Ersatz für die Norm-Heizlast nach
 * DIN EN 12831-1. Steht im Modell keine gerechnete Raum-Heizlast, rechnet
 * dieses Programm einen Überschlag, und der Bericht sagt das an jeder Stelle,
 * an der die Zahl auftaucht. Ein Nachweis mit einer geschätzten Heizlast ist
 * kein Nachweis, und ein Programm, das den Unterschied verwischt, ist
 * gefährlicher als eines, das gar nicht rechnet.
 */

import type {
  BimDocument,
  PipeAccessory,
  PipeAccessoryKind,
  PipeDimension,
  PipeMaterial,
  PipeRun,
  PipeSegment,
  PipeSurrounding,
} from '../types/bim';
import { PIPE_MATERIAL_LABELS, PIPE_SERVICE_LABELS } from '../types/bim';
import type { FluidProperties, PipeSegmentResult, PumpDesign } from './hydraulics';
import { FITTING_RESISTANCES, fluidProperties } from './hydraulics';
import type { BalanceReport, ConsumerBalance } from './hydraulicBalance';
import { ACCESSORY_FITTING, balanceNetwork } from './hydraulicBalance';
import type { Erzeugerbilanz } from './erzeugerHydraulik';
import { erzeugerBilanz } from './erzeugerHydraulik';
import { buildPipeNetwork } from './pipeNetwork';
import type { PlantDesignResult } from './plantDesign';
import { designPlant } from './plantDesign';
import { plantOf } from './plantDefaults';
import { connectionDiameter } from './safetyFittings';
import { insulationForDimension } from './pipeInsulation';
import {
  DEFAULT_THERMOSTAT_PRESSURE,
  MAX_THERMOSTAT_PRESSURE,
  MIN_VALVE_AUTHORITY,
} from './valveCatalog';
import { Wissensbasis } from './wissensbasis';
import { WISSEN_KORPUS } from './wissenKorpus';

/** Die Wissensbasis wird einmal gebaut und im Modul gehalten. */
let basisCache: Wissensbasis | undefined;

/** Zugriff auf die Wissensbasis — für Belege im Bericht und für die Suche. */
export function wissensbasis(): Wissensbasis {
  if (!basisCache) basisCache = new Wissensbasis(WISSEN_KORPUS);
  return basisCache;
}

// ---------------------------------------------------------------------------
// Ergebnisstruktur
// ---------------------------------------------------------------------------

/** Eine Zeile der Teilstreckentabelle nach SAENA Abschn. 1.4.2.2. */
export interface TeilstreckenZeile {
  /** Laufende Nummer im Strang. */
  nr: number;
  /** Kennung des Strangs, zu dem die Teilstrecke gehört. */
  strangId: string;
  bezeichnung: string;
  /** Volumenstrom [m³/h]. */
  volumenstrom: number;
  /** Abgerechnete Länge, Vor- und Rücklauf [m]. */
  laenge: number;
  werkstoff: PipeMaterial;
  /** Rauigkeit [mm]. */
  rauigkeit: number;
  abmessung: string;
  /** Innendurchmesser [mm]. */
  innen: number;
  /** Nennweite [mm]. */
  dn: number;
  /** Fließgeschwindigkeit [m/s]. */
  geschwindigkeit: number;
  reynolds: number;
  /** Rohrreibungszahl λ [-]. */
  lambda: number;
  /** Druckgefälle R [Pa/m]. */
  r: number;
  /** Rohrreibungsdruckverlust R·l [Pa]. */
  rl: number;
  /** Summe der Widerstandsbeiwerte [-]. */
  zeta: number;
  /** Einzelwiderstandsdruckverlust Z [Pa]. */
  z: number;
  /** Gesamtdruckverlust der Teilstrecke [Pa]. */
  dp: number;
  /** Die Formstücke im Klartext — ohne sie ist Σζ nicht nachvollziehbar. */
  formstuecke: string;
  /** Dämmstärke nach GEG/GModG Anlage 8 [mm]; 0 = keine Anforderung erkannt. */
  daemmung: number;
  warnungen: string[];
}

/** Ein vollständiger Fließweg von der Quelle zum Verbraucher. */
export interface StrangZeile {
  id: string;
  bezeichnung: string;
  quelle: string;
  raum?: string;
  /** Wärmestrom [W]. */
  leistung: number;
  /** Die Leistung ist eine Vorbelegung, keine Rechnung. */
  leistungGeschaetzt: boolean;
  /** Volumenstrom [m³/h]. */
  volumenstrom: number;
  /** Abgerechnete Länge [m]. */
  laenge: number;
  /** Σ(R·l) [Pa]. */
  reibung: number;
  /** ΣZ [Pa]. */
  einzelwiderstaende: number;
  /** Druckverlust der Heizfläche selbst [Pa]. */
  heizflaeche: number;
  /** Summe ohne Ventil [Pa]. */
  netz: number;
  /** Druckverlust am Thermostatventil [Pa]. */
  ventil: number;
  /** Abzudrosselnder Differenzdruck [Pa]. */
  drossel: number;
  /** Gesamt einschließlich Ventil [Pa]. */
  gesamt: number;
  /** Ungünstigster Strang seiner Quelle. */
  ungueninstigster: boolean;
  teilstrecken: TeilstreckenZeile[];
}

/** Eine Heizfläche mit ihrem Einstellwert — das Blatt für die Montage. */
export interface HeizflaechenZeile {
  id: string;
  bezeichnung: string;
  raum?: string;
  geschoss: string;
  /** Wärmestrom [W]. */
  leistung: number;
  leistungGeschaetzt: boolean;
  /** Volumenstrom [m³/h]. */
  volumenstrom: number;
  /** Massenstrom [kg/h] — die Einheit auf dem VdZ-Formular. */
  massenstrom: number;
  /** Anschluss-Nennweite [mm]. */
  dn: number;
  /** Erforderlicher k_v [m³/h]. */
  kv?: number;
  /** Baureihe des Ventils. */
  ventil?: string;
  /** Einstellwert am Ventil. */
  voreinstellung?: string;
  /** k_v der gewählten Stufe [m³/h]. */
  kvStufe?: number;
  /** Druckverlust am Ventil mit dieser Stufe [Pa]. */
  ventildruck?: number;
  /** Ventilautorität [-]. */
  autoritaet?: number;
  urteil: string;
  hinweise: string[];
}

/** Ein Punkt der Pflichtdokumentation nach § 60c Abs. 4 GModG. */
export interface NachweisPunkt {
  nr: number;
  forderung: string;
  /** Was das Programm dazu liefert. */
  antwort: string;
  /** Liegt die Angabe vollständig vor? */
  erfuellt: boolean;
  /** Woher die Angabe stammt. */
  herkunft: string;
}

export interface RohrnetzBericht {
  /** Titel des Projekts. */
  titel: string;
  /** Geschoss, auf das sich der Grundriss bezieht. */
  levelId: string;
  erstellt: string;
  /** Angesetzte Auslegungstemperaturen. */
  temperaturen: { vorlauf: number; ruecklauf: number; spreizung: number };
  /** Stoffwerte, mit denen gerechnet wurde. */
  fluid: FluidProperties;
  /** Vorherrschender Werkstoff im Netz. */
  werkstoff: PipeMaterial;
  /** Gebäudeheizlast [kW] und ihre Herkunft. */
  heizlast: { wert: number; herkunft: PlantDesignResult['heatLoadProvenance']; norm: boolean };
  /** Gesamtvolumenstrom [m³/h]. */
  volumenstrom: number;
  /** Gesamtrohrlänge im Netz [m]. */
  rohrlaenge: number;
  straenge: StrangZeile[];
  heizflaechen: HeizflaechenZeile[];
  /** Alle Teilstrecken, nach Strang gruppiert und fortlaufend nummeriert. */
  teilstrecken: TeilstreckenZeile[];
  pumpe?: PumpDesign;
  /**
   * Was im Erzeugerkreis zusätzlich zum gezeichneten Netz im Weg liegt.
   *
   * Bis 1.13.2 war dieser Posten null, und die Pumpe fiel dadurch
   * systematisch zu klein aus. Er steht als eigenes Feld im Bericht und
   * nicht nur als Summe in der Pumpenauslegung, weil ein Nachweis zeigen
   * muss, **woraus** er besteht.
   */
  erzeuger: Erzeugerbilanz;
  /** Der ungünstigste Strang des ganzen Netzes. */
  schlechtpunkt?: { id: string; bezeichnung: string; gesamt: number };
  nachweis: NachweisPunkt[];
  /** Quellenangaben, die auf dem Blatt erscheinen. */
  quellen: { titel: string; quelle: string; url?: string }[];
  /** Der zugrundeliegende Abgleich — für alles, was der Bericht nicht selbst führt. */
  abgleich: BalanceReport;
  auslegung: PlantDesignResult;
  hinweise: { severity: 'info' | 'warn' | 'error'; text: string }[];
}

export interface RohrnetzOptionen {
  /** Auslegungsdifferenzdruck am Thermostatventil [Pa]. */
  ventildruck?: number;
  /** Baureihe des Thermostatventils aus `valveCatalog`. */
  ventilBaureihe?: string;
  /** Druckverlust der Heizfläche selbst [Pa]. */
  heizflaechenverlust?: number;
  /** Nur dieses Geschoss betrachten. Ohne Angabe: das aktive. */
  levelId?: string;
}

// ---------------------------------------------------------------------------
// Hilfen
// ---------------------------------------------------------------------------

const round = (n: number, d = 2): number => {
  const f = 10 ** d;
  return Math.round(n * f) / f;
};

/**
 * Zahl in deutscher Schreibweise.
 *
 * `toFixed` liefert einen Punkt als Dezimaltrennzeichen. Auf einem deutschen
 * Nachweisblatt steht damit „5.5 kW" — was ein englischer Leser als fünfeinhalb
 * und ein deutscher als fünftausendfünfhundert lesen darf. Das ist auf einem
 * Blatt, das nach § 60c schriftlich mitzuteilen ist, keine Geschmacksfrage.
 */
const de = (n: number, d = 1): string => n.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });

const FITTING_LABEL = new Map(FITTING_RESISTANCES.map((f) => [f.id, f.label]));

/**
 * Vorherrschender Werkstoff im Netz.
 *
 * Der Abgleich braucht **einen** Werkstoff als Rückfallebene für Leitungen,
 * an denen keiner steht. Ihn zu raten wäre schlecht; ihn aus dem zu nehmen,
 * was tatsächlich gezeichnet wurde, ist die beste verfügbare Antwort.
 */
export function vorherrschenderWerkstoff(runs: readonly PipeRun[]): PipeMaterial {
  const zaehler = new Map<PipeMaterial, number>();
  for (const r of runs) {
    if (!r.material) continue;
    zaehler.set(r.material, (zaehler.get(r.material) ?? 0) + r.points.length);
  }
  let treffer: PipeMaterial = 'verbund';
  let beste = 0;
  for (const [m, n] of zaehler) {
    if (n > beste) {
      beste = n;
      treffer = m;
    }
  }
  return treffer;
}

/** Formstücke einer Teilstrecke im Klartext. */
function formstueckeText(segment: PipeSegment): string {
  const teile: string[] = [];
  if (segment.bends) teile.push(`${segment.bends}× Bogen 90°`);
  const zaehler = new Map<string, number>();
  for (const kind of segment.accessories ?? []) zaehler.set(kind, (zaehler.get(kind) ?? 0) + 1);
  for (const [kind, n] of zaehler) {
    // Der Nachschlagetisch ist nach *Formstückkennung* geordnet („kugelhahn"),
    // die Armatur trägt aber ihre *Bauart* („shutoff"). Ohne die Übersetzung
    // stünde in der deutschen Nachweistabelle „1× shutoff", und Σζ wäre für
    // den Leser nicht belegt.
    const id = ACCESSORY_FITTING[kind as PipeAccessoryKind];
    const label = (id ? FITTING_LABEL.get(id) : undefined) ?? id ?? kind;
    teile.push(`${n}× ${label}`);
  }
  return teile.join(', ');
}

/** Rauigkeit, mit der tatsächlich gerechnet wurde [mm]. */
function rauigkeitVon(dimension: PipeDimension, ergebnis: PipeSegmentResult): number {
  // Die Rauigkeit steckt nicht im Ergebnis, wohl aber ihre Wirkung. Sie hier
  // aus λ zurückzurechnen wäre eine zweite Rechnung mit eigenem Fehler;
  // stattdessen wird der Tabellenwert des Werkstoffs geführt.
  void ergebnis;
  return dimension.material === 'stahl' ? 0.045 : dimension.material === 'verbund' ? 0.007 : 0.0015;
}

// ---------------------------------------------------------------------------
// Der Bericht
// ---------------------------------------------------------------------------

/**
 * Rohrnetzbericht aus dem Modell.
 *
 * Reihenfolge und Begründung:
 *
 *  1. **Anlagenauslegung** (`designPlant`) zuerst — sie liefert die
 *     Auslegungstemperaturen und die Heizlast, und ohne die Temperaturen sind
 *     Dichte und Zähigkeit und damit jede Druckverlustzahl falsch.
 *  2. **Netz aus der Zeichnung** (`buildPipeNetwork`).
 *  3. **Abgleich** (`balanceNetwork`) mit dem Ventildruck, den ein Nachweis
 *     braucht — hier wird er ausdrücklich gesetzt, nicht im Kern vorbelegt.
 *  4. **Aufbereitung** in Tabellen. Nur hier wird gerundet; alles davor
 *     rechnet mit voller Genauigkeit.
 */
export function buildPipeReport(doc: BimDocument, options: RohrnetzOptionen = {}): RohrnetzBericht {
  const auslegung = designPlant(doc);
  const anlage = plantOf(doc);
  const vorlauf = anlage.design?.flowTemperature ?? 55;
  const ruecklauf = anlage.design?.returnTemperature ?? Math.max(20, vorlauf - 7);
  const spreizung = Math.max(1, vorlauf - ruecklauf);
  // Gerechnet wird mit der **mittleren** Temperatur des Kreises. Die Dichte
  // zwischen Vor- und Rücklauf unterscheidet sich um wenige Promille, die
  // Zähigkeit um bis zu 15 % — und die geht über die Reynoldszahl direkt in
  // λ ein. Mit der Vorlauftemperatur allein rechnet man den Rücklauf falsch.
  const fluid = fluidProperties((vorlauf + ruecklauf) / 2, {
    glycolFraction: anlage.design?.glycolFraction,
  });

  const runs = Object.values(doc.pipes ?? {});
  const werkstoff = vorherrschenderWerkstoff(runs);
  const netz = buildPipeNetwork(doc);
  const ventildruck = options.ventildruck ?? DEFAULT_THERMOSTAT_PRESSURE;

  /*
   * Was im Erzeugerkreis liegt — der Posten, der bis 1.13.2 null war.
   *
   * Die Bauteilliste wird nicht hier erfunden, sondern aus der
   * Anlagenauslegung abgelesen: das Umschaltventil gibt es, wenn ein
   * Trinkwasserspeicher über den Erzeuger geladen wird, den Zähler und den
   * Abscheider, wenn die Armaturenliste sie führt. Damit zeigen Bild,
   * Materialliste und Rechnung dieselbe Anlage.
   */
  const modell = auslegung.selected?.model;
  const armaturen = auslegung.safety?.fittings ?? [];
  /*
   * Volumenstrom des Erzeugerkreises.
   *
   * Maßgeblich ist die **Anlagenauslegung**, nicht der Abgleich: durch den
   * Erzeuger fließt der Auslegungsvolumenstrom der Heizkreise, unabhängig
   * davon, wie viel davon jemand schon gezeichnet hat. Ist noch kein Kreis
   * ausgelegt, tritt die Grundbeziehung V̇ = Q/(1,163·Δϑ) an ihre Stelle —
   * dieselbe, mit der auch die Anschlussnennweite bestimmt wird.
   */
  const erzeugerVolumenstrom =
    auslegung.totalFlow ||
    (auslegung.selected?.capacityAtDesign ?? auslegung.requiredCapacity) / (1.163 * spreizung);
  const anschlussDn = connectionDiameter(auslegung.selected?.capacityAtDesign ?? auslegung.requiredCapacity, {
    spread: spreizung,
    velocity: 0.8,
  });
  const trinkwasserUeberErzeuger = Boolean(
    auslegung.dhwStorage ?? Object.values(anlage.storages ?? {}).find((st) => st.kind === 'dhw-cylinder' || st.kind === 'combi'),
  );
  const erzeuger = erzeugerBilanz({
    model: modell,
    flow: erzeugerVolumenstrom,
    dn: anschlussDn,
    // Ein Umschaltventil im Gerät liegt zwar auch im Fließweg, ist aber Teil
    // des Geräts — es gesondert anzusetzen hieße, es bei jedem Hersteller
    // mitzuzählen, dessen Δp das ganze Gerät umfasst.
    umschaltung: trinkwasserUeberErzeuger && !modell?.contains?.diverter,
    waermezaehler: armaturen.some((f) => f.kind === 'heat-meter'),
    abscheiderVorhanden: armaturen.some((f) => f.kind === 'dirt-separator') && !modell?.contains?.dirtSeparator,
  });

  const abgleich = balanceNetwork({
    network: netz,
    fixtures: doc.fixtures,
    spread: spreizung,
    material: werkstoff,
    fluid,
    thermostatPressure: ventildruck,
    valveModelId: options.ventilBaureihe,
    terminalLoss: options.heizflaechenverlust,
    /*
     * Erzeuger und Armaturen des Erzeugerkreises.
     *
     * Bei einem Gerät mit **Restförderhöhe** steht in `zusatz` nur, was
     * außerhalb des Geräts liegt; der Gerätewert selbst wird nicht addiert,
     * sondern als `availableHead` geprüft. Beides zu addieren wäre der
     * Fehler, vor dem die ganze Unterscheidung schützen soll.
     */
    generatorLoss: erzeuger.zusatz,
    availableHead:
      erzeuger.verfuegbar !== undefined ? erzeuger.verfuegbar / (fluid.density * 9.80665) : undefined,
  });

  // --- Teilstrecken und Stränge -------------------------------------------
  /** Umgebung je Leitung, einmal vorsortiert. */
  const umgebungJeLeitung = new Map<string, PipeSurrounding>();
  for (const r of runs) if (r.surrounding) umgebungJeLeitung.set(r.id, r.surrounding);

  const teilstrecken: TeilstreckenZeile[] = [];
  const straenge: StrangZeile[] = [];
  const wegeById = new Map(netz.paths.map((p) => [p.fixtureId, p]));

  for (const c of abgleich.consumers) {
    const weg = wegeById.get(c.fixtureId);
    const eigene = teilstreckenVon(c, weg?.segments ?? [], teilstrecken.length, umgebungJeLeitung);
    teilstrecken.push(...eigene);
    const reibung = c.path.segments.reduce((s, x) => s + x.pipeLoss, 0);
    const einzel = c.path.segments.reduce((s, x) => s + x.fittingLoss + x.fixedLoss, 0);
    straenge.push({
      id: c.fixtureId,
      bezeichnung: c.label,
      quelle: c.sourceLabel,
      raum: c.roomId ? doc.rooms[c.roomId]?.name : undefined,
      leistung: round(c.power, 0),
      leistungGeschaetzt: c.powerAssumed,
      volumenstrom: round(c.flow, 4),
      laenge: round(c.path.length, 2),
      reibung: round(reibung, 0),
      einzelwiderstaende: round(einzel, 0),
      heizflaeche: round(c.path.terminalLoss, 0),
      netz: round(c.ownLoss, 0),
      ventil: round(c.valvePressure ?? 0, 0),
      drossel: round(c.throttle, 0),
      gesamt: round(c.ownLoss + (c.valvePressure ?? 0), 0),
      ungueninstigster: c.worst,
      teilstrecken: eigene,
    });
  }

  // --- Heizflächenblatt ----------------------------------------------------
  const heizflaechen: HeizflaechenZeile[] = abgleich.consumers.map((c) => heizflaecheVon(c, doc, fluid));

  // --- Kennzahlen ----------------------------------------------------------
  const rohrlaenge = runs.reduce((sum, r) => {
    let l = 0;
    for (let i = 1; i < r.points.length; i++) {
      l += Math.hypot(r.points[i].x - r.points[i - 1].x, r.points[i].y - r.points[i - 1].y);
    }
    return sum + l;
  }, 0);

  const schlecht = straenge.find((s) => s.gesamt === Math.max(...straenge.map((x) => x.gesamt)));

  const hinweise: RohrnetzBericht['hinweise'] = [...abgleich.notes];
  if (!netz.paths.length) {
    hinweise.unshift({
      severity: 'error',
      text:
        'Im Modell ist kein Rohrnetz gezeichnet. Ohne Leitungen gibt es keine Teilstrecken und damit ' +
        'keinen Nachweis — der Bericht bleibt leer. Über „Rohrnetz auslegen" in der Werkzeugleiste ' +
        'entsteht eine Trasse, die als Grundlage dient.',
    });
  }
  if (auslegung.heatLoadProvenance === 'überschlag') {
    hinweise.unshift({
      severity: 'warn',
      text:
        'Die Heizlast ist ein Überschlag dieses Programms, keine Berechnung nach DIN EN 12831-1. ' +
        '§ 60c Abs. 2 GModG verlangt für den Abgleich eine raumweise Heizlastberechnung; ' +
        'mit dieser Zahl ist der Bericht eine Vorbemessung, kein Nachweis.',
    });
  }

  /*
   * Die Hinweise der Erzeugerbilanz stehen **vorn**.
   *
   * „Für dieses Gerät ist kein Druckverlust hinterlegt" ist keine Randnotiz,
   * sondern die Aussage, wie belastbar die Förderhöhe darunter ist. Wo ein
   * Wert fehlt, gehört die Größenordnung des fehlenden Betrags dazu — sonst
   * liest sich eine Null wie ein Messergebnis.
   */
  for (const n of erzeuger.hinweise) hinweise.unshift(n);

  const basis = wissensbasis();
  const quellen: RohrnetzBericht['quellen'] = [];
  for (const thema of ['dokumentation', 'abgleich-recht', 'ventilautoritaet', 'druckverlust', 'rohrdaemmung']) {
    for (const e of basis.belege(thema).slice(0, 3)) {
      if (quellen.some((q) => q.titel === e.titel)) continue;
      quellen.push({ titel: e.titel, quelle: e.quelle, url: e.url });
    }
  }

  return {
    titel: doc.meta.name || 'Rohrnetzberechnung',
    levelId: options.levelId ?? doc.activeLevelId,
    erstellt: new Date().toISOString().slice(0, 10),
    temperaturen: { vorlauf, ruecklauf, spreizung },
    fluid,
    werkstoff,
    heizlast: {
      wert: auslegung.heatLoad,
      herkunft: auslegung.heatLoadProvenance,
      norm: auslegung.heatLoadSource === 'norm',
    },
    volumenstrom: round(abgleich.totalFlow, 3),
    rohrlaenge: round(rohrlaenge, 1),
    straenge: straenge.sort((a, b) => b.gesamt - a.gesamt),
    heizflaechen,
    teilstrecken,
    pumpe: abgleich.pump,
    erzeuger,
    schlechtpunkt: schlecht
      ? { id: schlecht.id, bezeichnung: schlecht.bezeichnung, gesamt: schlecht.gesamt }
      : undefined,
    nachweis: nachweisPunkte(doc, auslegung, abgleich, { vorlauf, ruecklauf }),
    quellen,
    abgleich,
    auslegung,
    hinweise,
  };
}

/** Teilstrecken eines Strangs aufbereiten. */
function teilstreckenVon(
  c: ConsumerBalance,
  segmente: readonly PipeSegment[],
  offset: number,
  /**
   * Umgebung je Leitung — sie entscheidet über die Dämmstärke nach Anlage 8.
   * Eine Leitung im unbeheizten Keller bekommt eine andere Anforderung als
   * dieselbe Leitung im Estrich, und der Unterschied steht am Modell, nicht
   * an der Rechnung.
   */
  umgebung: Map<string, PipeSurrounding>,
): TeilstreckenZeile[] {
  const raus: TeilstreckenZeile[] = [];
  c.path.segments.forEach((s: PipeSegmentResult, i: number) => {
    const roh = segmente[i];
    // Die Dämmstärke folgt Anlage 8 GEG/GModG und stellt auf den lichten
    // Innendurchmesser ab — deshalb der Weg über die Dimension und nicht
    // über die Nennweite.
    const daemmung = insulationForDimension(s.dimension, {
      surrounding: umgebung.get(roh?.runId ?? '') ?? 'beheizt',
      service: roh?.service ?? 'heating-flow',
    });
    raus.push({
      nr: offset + i + 1,
      strangId: c.fixtureId,
      bezeichnung: s.label,
      volumenstrom: round(s.flow, 4),
      laenge: round(s.length, 2),
      werkstoff: s.dimension.material,
      rauigkeit: rauigkeitVon(s.dimension, s),
      abmessung: s.dimension.label,
      innen: s.dimension.inner,
      dn: s.dimension.dn,
      geschwindigkeit: round(s.velocity, 3),
      reynolds: Math.round(s.reynolds),
      lambda: round(s.lambda, 4),
      r: round(s.gradient, 1),
      rl: Math.round(s.pipeLoss),
      zeta: round(s.zetaSum, 2),
      z: Math.round(s.fittingLoss),
      dp: Math.round(s.loss),
      formstuecke: roh ? formstueckeText(roh) : '',
      daemmung: daemmung.thickness,
      warnungen: s.warnings,
    });
  });
  return raus;
}

/** Eine Zeile des Heizflächenblatts. */
function heizflaecheVon(c: ConsumerBalance, doc: BimDocument, fluid: FluidProperties): HeizflaechenZeile {
  const hinweise = c.notes.map((n) => n.text);
  let urteil = 'einstellbar';
  if (c.worst) urteil = 'ungünstigster Strang — bleibt offen';
  else if (c.presetSelection?.fit === 'ueber-bereich') urteil = 'Ventil zu klein';
  else if (c.presetSelection?.fit === 'unter-bereich') urteil = 'drosselt nicht genug';
  else if (c.authorityNote === 'zu klein') urteil = 'Ventilautorität zu klein';
  else if ((c.valvePressure ?? 0) > MAX_THERMOSTAT_PRESSURE) urteil = 'Geräuschgrenze überschritten';

  return {
    id: c.fixtureId,
    bezeichnung: c.label,
    raum: c.roomId ? doc.rooms[c.roomId]?.name : undefined,
    geschoss: doc.levels[c.levelId]?.name ?? c.levelId,
    leistung: round(c.power, 0),
    leistungGeschaetzt: c.powerAssumed,
    volumenstrom: round(c.flow, 4),
    // Massenstrom ist die Einheit des VdZ-Formulars: ṁ = V̇ · ρ.
    massenstrom: round(c.flow * fluid.density, 0),
    dn: c.minimumDiameter,
    kv: c.valveKv,
    ventil: c.presetSelection?.model.label,
    voreinstellung: c.presetSelection?.setting,
    kvStufe: c.presetSelection?.kv,
    ventildruck: c.presetSelection ? Math.round(c.presetSelection.actualPressure) : undefined,
    autoritaet: c.authority,
    urteil,
    hinweise,
  };
}

/**
 * Die sieben Pflichtangaben nach § 60c Abs. 4 GModG (vormals GEG).
 *
 * Sie sind kein Vorschlag: „Die Einstellungswerte, die Heizlast des Gebäudes,
 * die eingestellte Leistung der Wärmeerzeuger, die raumweise
 * Heizlastberechnung, die Auslegungstemperatur, die Einstellung der Regelung
 * und der Druck im Ausdehnungsgefäß sind dem Verantwortlichen schriftlich
 * mitzuteilen." Der Bericht führt sie einzeln auf und sagt bei jeder, ob er
 * sie liefern kann — eine Lücke offen zu benennen ist der einzige ehrliche
 * Umgang damit.
 */
function nachweisPunkte(
  doc: BimDocument,
  auslegung: PlantDesignResult,
  abgleich: BalanceReport,
  temperaturen: { vorlauf: number; ruecklauf: number },
): NachweisPunkt[] {
  const eingestellt = abgleich.consumers.filter((c) => c.presetSelection).length;
  const raumweise = auslegung.heatLoadSource === 'norm';
  const ag = auslegung.safety?.prePressure;
  const raeume = Object.values(doc.rooms).filter((r) => r.isHeated).length;

  return [
    {
      nr: 1,
      forderung: 'Einstellungswerte',
      antwort:
        eingestellt > 0
          ? `Voreinstellwerte für ${eingestellt} von ${abgleich.consumers.length} Heizflächen im Heizflächenblatt.`
          : 'Keine Einstellwerte — im Modell ist kein Rohrnetz mit Verbrauchern gezeichnet.',
      erfuellt: eingestellt > 0 && eingestellt === abgleich.consumers.length,
      herkunft: 'hydraulischer Abgleich dieses Programms, Armaturenkatalog',
    },
    {
      nr: 2,
      forderung: 'Heizlast des Gebäudes',
      antwort: `${de(auslegung.heatLoad)} kW (${auslegung.heatLoadProvenance}).`,
      erfuellt: auslegung.heatLoad > 0,
      herkunft: raumweise ? 'raumweise Berechnung im Modell' : 'Überschlag dieses Programms',
    },
    {
      nr: 3,
      forderung: 'Eingestellte Leistung der Wärmeerzeuger',
      antwort: auslegung.selected
        ? `${auslegung.selected.model.label} (${auslegung.selected.model.series}), ` +
          `${de(auslegung.selected.capacityAtDesign)} kW im Auslegungspunkt.`
        : 'Kein Wärmeerzeuger gewählt.',
      erfuellt: Boolean(auslegung.selected),
      herkunft: 'Geräteauswahl aus dem Katalog',
    },
    {
      nr: 4,
      forderung: 'Raumweise Heizlastberechnung',
      antwort: raumweise
        ? `Für ${raeume} beheizte Räume gerechnet.`
        : `Nicht vorhanden — die Heizlast ist ein Überschlag über ${raeume} beheizte Räume. ` +
          '§ 60c Abs. 2 GModG verlangt hier DIN EN 12831-1.',
      erfuellt: raumweise,
      herkunft: 'Raumbuch',
    },
    {
      nr: 5,
      forderung: 'Auslegungstemperatur',
      antwort: `Vorlauf ${temperaturen.vorlauf} °C, Rücklauf ${temperaturen.ruecklauf} °C, ` +
        `Norm-Außentemperatur ${doc.meta.designOutdoorTemperature} °C.`,
      erfuellt: true,
      herkunft: 'Anlagendefinition im Modell',
    },
    {
      nr: 6,
      forderung: 'Einstellung der Regelung',
      antwort:
        'Nicht Gegenstand dieses Programms: Heizkurve, Absenkzeiten und Regelparameter werden am Gerät ' +
        'eingestellt und gehören in die Anlagendokumentation des Errichters.',
      erfuellt: false,
      herkunft: '—',
    },
    {
      nr: 7,
      forderung: 'Druck im Ausdehnungsgefäß',
      antwort:
        ag !== undefined
          ? `Vordruck ${de(ag)} bar, Gefäß ${auslegung.safety?.selectedVessel ?? '—'} l.`
          : 'Kein Ausdehnungsgefäß ausgelegt.',
      erfuellt: ag !== undefined,
      herkunft: 'Sicherheitsauslegung nach DIN EN 12828',
    },
  ];
}

/**
 * Kurzurteil über den Bericht — die Zahl, die in die Oberfläche gehört.
 *
 * Sie fasst zusammen, was einem Nachweis fehlt, und nicht, wie gut die
 * Anlage ist. Ein Netz kann hydraulisch tadellos und trotzdem nicht
 * nachweisfähig sein, weil die Heizlast geschätzt ist.
 */
export function berichtsUrteil(bericht: RohrnetzBericht): {
  nachweisfaehig: boolean;
  offen: string[];
} {
  const offen: string[] = [];
  for (const p of bericht.nachweis) {
    if (!p.erfuellt) offen.push(p.forderung);
  }
  const kritisch = bericht.heizflaechen.filter(
    (h) => h.urteil !== 'einstellbar' && h.urteil !== 'ungünstigster Strang — bleibt offen',
  );
  if (kritisch.length) offen.push(`${kritisch.length} Heizflächen ohne darstellbare Einstellung`);
  const schwach = bericht.heizflaechen.filter(
    (h) => h.autoritaet !== undefined && h.autoritaet < MIN_VALVE_AUTHORITY,
  );
  if (schwach.length) offen.push(`${schwach.length} Ventile mit zu kleiner Autorität`);
  return { nachweisfaehig: offen.length === 0, offen };
}

/** Armaturen des Modells, die im Bericht als Bauteilliste erscheinen. */
export function armaturenListe(doc: BimDocument): { kind: string; anzahl: number }[] {
  const zaehler = new Map<string, number>();
  for (const a of Object.values(doc.pipeAccessories ?? {}) as PipeAccessory[]) {
    zaehler.set(a.kind, (zaehler.get(a.kind) ?? 0) + 1);
  }
  return [...zaehler.entries()]
    .map(([kind, anzahl]) => ({ kind, anzahl }))
    .sort((a, b) => b.anzahl - a.anzahl);
}

/** Nur damit die Dienstbezeichnungen im Bericht dieselben sind wie im Plan. */
export const SERVICE_LABELS = PIPE_SERVICE_LABELS;
export const MATERIAL_LABELS = PIPE_MATERIAL_LABELS;
