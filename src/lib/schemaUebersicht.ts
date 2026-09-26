/**
 * Das Übersichtsschema — dasselbe Bild, für den Monteur lesbar.
 * ---------------------------------------------------------------------------
 * **Der Anlass.** Das erzeugte Anlagenschema zeigt alles, was die Auslegung
 * führt: am Referenzhaus 54 Bauteile und 65 Leitungen. Jedes einzelne davon
 * ist begründet, und für die Ausführung wird jedes gebraucht. Nur liest es
 * niemand: Der Heizungsbauer sucht in diesem Bild die drei Fragen, die ihn
 * wirklich betreffen — was erzeugt, was speichert, was gibt ab — und findet
 * sie zwischen Absperrungen, Rückschlagklappen und Messstellen nicht.
 *
 * **Was echte Prinzipschemata tun.** Nachgesehen wurde, wie veröffentlichte
 * Schemata aufgebaut sind (BWP-Leitfaden Hydraulik, Planungsunterlagen von
 * Bosch und Buderus, Wolf-Installationsprinzip). Sie sind sich einig:
 *
 *  · **Acht bis fünfzehn Hauptbauteile**, nicht mehr. Der BWP-Leitfaden nennt
 *    genau diese Spanne; darüber wird ein Prinzipbild zur Ausführungszeichnung.
 *  · **Armaturen und Messstellen fehlen.** Bosch zeichnet Sicherheitsventil,
 *    Ausdehnungsgefäß, Absperrarmaturen und Schmutzfänger ausdrücklich *nicht*
 *    und nennt sie nur in den Planungshinweisen.
 *  · **Baugruppen bleiben Baugruppen.** Bosch zeichnet die Solarstation als
 *    Kästchen, Wolf die Hydraulikstation als gestrichelten Rahmen — nicht in
 *    ihre Einzelteile zerlegt.
 *  · **Es gibt eine Leserichtung.** Buderus: Wärmepumpe → Puffer →
 *    Frischwasserstation → Heizkreise. Bosch: Gerät mittig, Speicher oben,
 *    Heizkreise unten.
 *  · **Unter dem Bild steht, dass es unvollständig ist.** Wortgleich bei allen
 *    dreien. Weglassen ist erlaubt, verschweigen nicht.
 *
 * **Die eine Abweichung, die wir uns leisten.** Sicherheitsventil und
 * Ausdehnungsgefäß bleiben im Bild, obwohl Bosch sie weglässt — Wolf und
 * Viessmann zeichnen sie, beides ist üblich. Den Ausschlag gibt, dass es die
 * einzigen weggelassenen Bauteile wären, die über die Sicherheit der Anlage
 * entscheiden, und dass dieses Programm sie ohnehin nach DIN EN 12828
 * auslegt. Sie stehen als **eine Sicherheitsgruppe am Erzeuger**, nicht als
 * drei über das Blatt verteilte Einzelteile.
 *
 * **Warum abgeleitet und nicht neu gebaut.** Die Übersicht ist eine
 * *Projektion* des vollständigen Schemas: Jedes Bauteil darin stammt aus dem
 * Ausführungsbild und trägt dessen Kennung in `herkunft`. Damit kann die
 * Übersicht nichts zeigen, was die Ausführung nicht hat — genau der Fehler,
 * an dem zwei nebeneinander gepflegte Darstellungen derselben Anlage immer
 * scheitern. Was die Übersicht dagegen frei wählt, ist die **Anordnung**: Ein
 * Prinzipschema kennt keinen Maßstab, es zählen Struktur und Lesbarkeit.
 *
 * Reine Funktionen, kein Store, keine Oberfläche.
 */

import type { PipeService, SchematicComponent, SchematicKind, SchematicLink } from '../types/bim';
import { SCHEMATIC_LEGEND } from './schematicSymbols';

// ---------------------------------------------------------------------------
// Vertrag
// ---------------------------------------------------------------------------

/** Die drei Zonen des Bildes, immer in dieser Reihenfolge von links nach rechts. */
export type UebersichtZone = 'erzeugung' | 'speicherung' | 'uebergabe';

/** Ein Bauteil im Übersichtsbild. */
export interface UebersichtBauteil {
  id: string;
  kind: SchematicKind;
  /** Ein Wort — der Name der Bauteilart, nicht der Produktname. */
  label: string;
  /** Die maßgebende Zahl, sonst nichts. */
  spec?: string;
  /** Mehr als eins dieser Art zusammengefasst; fehlt bei genau einem. */
  anzahl?: number;
  x: number;
  y: number;
  zone: UebersichtZone;
  /** Kennungen aus dem vollständigen Schema, die hier zusammengefasst sind. */
  herkunft: string[];
}

/** Ein gestrichelter Rahmen um mehrere Bauteile. */
export interface UebersichtGruppe {
  id: string;
  name: string;
  bauteile: string[];
}

/** Eine Leitung im Übersichtsbild. */
export interface UebersichtLeitung {
  id: string;
  from: string;
  to: string;
  fromPort: string;
  toPort: string;
  service: PipeService;
}

/** Eine weggelassene Bauteilart mit ihrer Anzahl — für den Hinweis und die Prüfung. */
export interface UebersichtWeglassung {
  kind: SchematicKind;
  name: string;
  anzahl: number;
  /**
   * Ist das eine Bauteilart, die ein Prinzipschema normalerweise **trägt**?
   *
   * `false` heißt: Armatur oder Messstelle, sie gehört planmäßig nicht ins
   * Bild. `true` heißt: Sie gehörte hinein und ist trotzdem herausgefallen —
   * entweder über die Notbremse oder weil sie an keinem Strang hängt, den
   * dieses Bild zeigt. Das ist ein Befund und kein Normalfall; der Prüfblock
   * hält es fest.
   */
  tragend: boolean;
}

export interface Uebersichtsschema {
  bauteile: UebersichtBauteil[];
  gruppen: UebersichtGruppe[];
  leitungen: UebersichtLeitung[];
  /** Was aus dem vollständigen Bild herausfiel, nach Art gezählt. */
  weggelassen: UebersichtWeglassung[];
  /** Der Satz, der unter jedem Bild steht. */
  hinweis: string;
  /** Wie viele Bauteile das vollständige Schema hat — für die Zeile „aus N Bauteilen". */
  vollstaendig: number;
}

/**
 * Der Satz unter jedem Übersichtsbild.
 *
 * **Warum er wörtlich hier steht und nicht in der Oberfläche.** Er ist Teil
 * des Bildes, nicht seiner Darstellung: Wer die Übersicht druckt, ausschneidet
 * oder weitergibt, muss ihn mitbekommen. Inhaltlich ist er die Zusammenfassung
 * dessen, was Wolf („ohne Anspruch auf Vollständigkeit"), Buderus
 * („unverbindliche schematische Darstellung einer möglichen hydraulischen
 * Schaltung") und Bosch („nur schematische Darstellungen … unverbindlicher
 * Hinweis") gleichlautend unter ihre Schemata setzen — und was die
 * Wissensbasis unter `hyd-schemata-unvollstaendig` belegt.
 *
 * Der zweite Satz ist der wichtigere: Was gebaut wird, entscheidet die
 * Ausführungsplanung für dieses Gebäude, nicht dieses Bild.
 */
export const UEBERSICHT_HINWEIS =
  'Beispielschema. Absperrorgane, Entlüftungen, Schmutzfänger, Füll- und Entleerarmatur, ' +
  'Messstellen und die Sicherheitsgruppe der Trinkwassererwärmung sind nicht vollständig ' +
  'dargestellt und anlagenspezifisch zu ergänzen. Maßgebend für die Ausführung ist das ' +
  'vollständige Anlagenschema in der Projektmappe.';

/**
 * Wie viele Bauteile höchstens im Bild stehen.
 *
 * Nicht frei gewählt: Der BWP-Leitfaden Hydraulik führt je Schema **acht bis
 * fünfzehn** Hauptkomponenten. Fünfzehn ist damit die belegte Obergrenze
 * dessen, was in der Branche noch als Prinzipschema durchgeht. Knotenpunkte
 * zählen nicht mit — ein Verteilpunkt ist kein Bauteil, sondern eine Ecke.
 */
export const UEBERSICHT_HOECHSTZAHL = 15;

// ---------------------------------------------------------------------------
// Was bleibt und was geht
// ---------------------------------------------------------------------------

/**
 * Die Bauteilarten, die ein Prinzipschema trägt.
 *
 * Es sind genau die, die in den geprüften Herstellerschemata vorkommen:
 * Erzeuger, Speicher, Verteiler, Verbraucher, Pumpen und die Ventile, die
 * einen **Weg entscheiden** (Mischer, Umschaltventil, Verbrühschutz). Ein
 * Ventil, das nur absperrt oder einstellt, entscheidet keinen Weg und fehlt
 * deshalb.
 */
const BEHALTEN: ReadonlySet<SchematicKind> = new Set<SchematicKind>([
  'heatpump-outdoor',
  'heatpump-indoor',
  'hydraulic-station',
  'boiler',
  'electric-heater',
  'solar',
  'buffer',
  'buffer-series',
  'separator',
  'cylinder',
  'freshwater',
  'manifold',
  'radiator',
  'floor-loop',
  'pump',
  'circulation-pump',
  'valve-3way',
  'valve-diverter',
  'mixing-valve-dhw',
]);

/**
 * Die beiden Bauteile der Sicherheitsgruppe.
 *
 * Sie werden nicht weggelassen, sondern an einer Stelle zusammengefasst —
 * siehe Kopfkommentar. Das Manometer gehört fachlich dazu, ist aber eine
 * **Messstelle**: Es zeigt an, es entscheidet nichts. Es fällt unter dieselbe
 * Regel wie Thermometer und Fühler und steht damit in der Weglassliste.
 */
const SICHERHEIT: ReadonlySet<SchematicKind> = new Set<SchematicKind>(['safety-valve', 'expansion-vessel']);

/**
 * Die Namen im Prinzipbild — ein Wort, nicht der Legendentext.
 *
 * Die Symbollegende nennt die Bauteilart vollständig und genau: „Wärmepumpe,
 * Außeneinheit", „Membran-Druckausdehnungsgefäß", „Mischer, 3-Wege". Das ist
 * für die Legende richtig und unter einem Symbol zu lang — drei Zeilen
 * Beschriftung unter einem Kasten sind genau das, was dieses Bild vermeiden
 * soll. Hier steht deshalb das Wort, das der Heizungsbauer benutzt. Wer es
 * genau braucht, liest die Legende; sie steht unter dem Bild.
 *
 * Was hier fehlt, bekommt den Legendennamen — eine Lücke wäre schlimmer als
 * ein langer Name.
 */
const KURZNAME: Partial<Record<SchematicKind, string>> = {
  'heatpump-outdoor': 'Wärmepumpe',
  'heatpump-indoor': 'Wärmepumpe, innen',
  'hydraulic-station': 'Hydraulikstation',
  boiler: 'Kessel',
  'electric-heater': 'Heizstab',
  solar: 'Solarkollektor',
  'safety-valve': 'Sicherheitsventil',
  'expansion-vessel': 'Ausdehnungsgefäß',
  buffer: 'Pufferspeicher',
  separator: 'Hydraulische Weiche',
  cylinder: 'Trinkwasserspeicher',
  freshwater: 'Frischwasserstation',
  'valve-diverter': 'Umschaltventil',
  'mixing-valve-dhw': 'Verbrühschutz',
  'circulation-pump': 'Zirkulationspumpe',
  'valve-3way': 'Mischer',
  manifold: 'Verteiler',
  radiator: 'Heizkörper',
  'floor-loop': 'Fußbodenheizung',
  pump: 'Umwälzpumpe',
};

/**
 * Die maßgebende Zahl je Bauteilart.
 *
 * Unter einem Symbol steht **eine** Zahl, und zwar die, nach der man das
 * Bauteil bestellt: das Gefäß nach Litern, das Sicherheitsventil nach dem
 * Ansprechdruck, die Pumpe nach dem Volumenstrom. Die Auslegung schreibt
 * dagegen alles hin, was sie weiß — „DN 15 · 3.0 bar" nennt beim
 * Sicherheitsventil die Nennweite zuerst, und die ist hier die
 * unwichtigere der beiden Zahlen.
 */
const KENNZAHL: Partial<Record<SchematicKind, RegExp>> = {
  'safety-valve': /[\d]+[.,]?[\d]*\s*bar/,
  'expansion-vessel': /[\d]+[.,]?[\d]*\s*l\b/,
  buffer: /[\d]+[.,]?[\d]*\s*l\b/,
  separator: /[\d]+[.,]?[\d]*\s*l\b/,
  cylinder: /[\d]+[.,]?[\d]*\s*l\b/,
  pump: /[\d]+[.,]?[\d]*\s*m³\/h/,
  'circulation-pump': /[\d]+[.,]?[\d]*\s*l\/h/,
  'heatpump-outdoor': /[\d]+[.,]?[\d]*\s*kW/,
  'heatpump-indoor': /[\d]+[.,]?[\d]*\s*kW/,
  boiler: /[\d]+[.,]?[\d]*\s*kW/,
  'electric-heater': /[\d]+[.,]?[\d]*\s*kW/,
};

/** Die Zone, in der eine Bauteilart steht. */
function zoneVon(kind: SchematicKind, imRuecklauf: boolean): UebersichtZone {
  switch (kind) {
    case 'heatpump-outdoor':
    case 'heatpump-indoor':
    case 'hydraulic-station':
    case 'boiler':
    case 'electric-heater':
    case 'solar':
    case 'safety-valve':
    case 'expansion-vessel':
      return 'erzeugung';
    case 'buffer':
    case 'buffer-series':
    case 'separator':
    case 'cylinder':
    case 'freshwater':
    case 'valve-diverter':
    case 'mixing-valve-dhw':
    case 'circulation-pump':
      return 'speicherung';
    case 'pump':
      // Die Anlagenpumpe sitzt im Rücklauf zum Erzeuger, die Kreispumpe im
      // Vorlauf eines Zweiges. Woran sie hängt, entscheidet, wohin sie gehört.
      return imRuecklauf ? 'speicherung' : 'uebergabe';
    default:
      return 'uebergabe';
  }
}

// ---------------------------------------------------------------------------
// Raster
// ---------------------------------------------------------------------------

/**
 * Die Spalten und Zeilen des Bildes.
 *
 * Feste Plätze, in jedem Schema dieselben. Das ist der Zweck: Wer zwei
 * Übersichten nacheinander ansieht, soll den Erzeuger nicht suchen müssen.
 * Die Einheit ist ein Rasterplatz, kein Meter — ein Prinzipschema hat keinen
 * Maßstab.
 */
const SP = {
  erzeuger: 0,
  station: 4,
  zweiterzeuger: 8,
  sicherheit: 12,
  umschalt: 16,
  puffer: 21,
  balken: 26,
  mischer: 30,
  kreispumpe: 34,
  verbraucher: 39,
  speicher: 19,
  verbruehschutz: 26,
  zapf: 32,
} as const;

const ZE = {
  /** Der Vorlauf — die Leserichtung des Bildes. */
  vor: 0,
  /** Der Rücklauf, darunter. */
  rueck: 7,
  /** Die Sicherheitsgruppe steht über dem Vorlauf, wie am Gerät. */
  sicherheit: -7,
  /** Der Trinkwasserzweig hängt unter dem Umschaltventil. */
  trinkwasser: 12,
  /** Der erste Verbraucherzweig; weitere stapeln sich nach oben. */
  ersterZweig: -5,
  /** Abstand zwischen zwei Verbraucherzweigen. */
  zweigAbstand: 5,
} as const;

// ---------------------------------------------------------------------------
// Kleine Helfer
// ---------------------------------------------------------------------------

/** Die Temperaturpaarung aus einer Kennwertzeile, etwa „35/28 °C" → „35/28". */
function temperaturen(spec: string | undefined): string | undefined {
  const t = spec?.match(/(\d{2,3})\s*\/\s*(\d{2,3})\s*°?\s*C/);
  return t ? `${t[1]}/${t[2]}` : undefined;
}

/** Die Leistung aus einer Kennwertzeile in Kilowatt, etwa „1.4 kW" → 1.4. */
function kilowatt(spec: string | undefined): number | undefined {
  const t = spec?.match(/([\d]+[.,]?[\d]*)\s*kW/);
  if (!t) return undefined;
  const z = Number(t[1].replace(',', '.'));
  return Number.isFinite(z) ? z : undefined;
}

/** Eine Zahl in deutscher Schreibweise — Komma, nicht Punkt. */
function deutsch(zahl: number, stellen = 1): string {
  return zahl.toFixed(stellen).replace('.', ',');
}

// ---------------------------------------------------------------------------
// Die Ableitung
// ---------------------------------------------------------------------------

/** Ein Verbraucherzweig, so wie er im vollständigen Schema steht. */
interface Zweig {
  /** Der Verbraucher am Ende — Heizkörper oder Fußbodenheizung. */
  verbraucher: SchematicComponent;
  /** Der Verteiler davor, falls es einen gibt. */
  verteiler?: SchematicComponent;
  /** Der Mischer davor, falls der Kreis gemischt ist. */
  mischer?: SchematicComponent;
  /** Die Kreispumpe davor, falls der Kreis eine eigene hat. */
  pumpe?: SchematicComponent;
  /** Vor- und Rücklauftemperatur als „35/28", falls im Bild genannt. */
  temperaturen?: string;
  /** Die Leistung des Verbrauchers [kW], falls genannt. */
  kw?: number;
}

/**
 * Aus dem vollständigen Anlagenschema das Übersichtsbild ableiten.
 *
 * Die Funktion **wählt aus und ordnet neu** — sie erfindet nichts. Jedes
 * Bauteil, das herauskommt, trägt in `herkunft` die Kennungen, aus denen es
 * stammt; die einzige Ausnahme sind Knotenpunkte, die als Ecke einer Leitung
 * zum Zeichnen gehören und kein Bauteil sind.
 */
export function uebersichtsschema(
  components: readonly SchematicComponent[],
  links: readonly SchematicLink[],
): Uebersichtsschema {
  const bauteile: UebersichtBauteil[] = [];
  const gruppen: UebersichtGruppe[] = [];
  const leitungen: UebersichtLeitung[] = [];
  const genutzt = new Set<string>();

  const setze = (
    id: string,
    kind: SchematicKind,
    x: number,
    y: number,
    herkunft: SchematicComponent[],
    spec?: string,
    anzahl?: number,
    label?: string,
  ): UebersichtBauteil => {
    for (const h of herkunft) genutzt.add(h.id);
    const b: UebersichtBauteil = {
      id,
      kind,
      // **Der Name der Bauteilart, nicht der Produktname.** „Monoblock
      // Luft/Wasser R290 8 kW" ist die Gerätebezeichnung aus dem Katalog; im
      // Prinzipbild steht „Wärmepumpe". Wer wissen will, welches Gerät es ist,
      // findet es in der Stückliste und im Anlagenbuch.
      label: label ?? KURZNAME[kind] ?? SCHEMATIC_LEGEND[kind].name,
      spec,
      anzahl: anzahl && anzahl > 1 ? anzahl : undefined,
      x,
      y,
      zone: zoneVon(kind, false),
      herkunft: herkunft.map((h) => h.id),
    };
    bauteile.push(b);
    return b;
  };

  /** Ein Knotenpunkt — eine Ecke, kein Bauteil. */
  const knoten = (id: string, x: number, y: number, zone: UebersichtZone, label = ''): UebersichtBauteil => {
    const b: UebersichtBauteil = { id, kind: 'node', label, x, y, zone, herkunft: [] };
    bauteile.push(b);
    return b;
  };

  const leite = (
    von: UebersichtBauteil,
    vonPort: string,
    nach: UebersichtBauteil,
    nachPort: string,
    service: PipeService,
  ): void => {
    leitungen.push({
      id: `ul-${leitungen.length + 1}`,
      from: von.id,
      to: nach.id,
      fromPort: vonPort,
      toPort: nachPort,
      service,
    });
  };

  // --- Nachschlagewerk über das vollständige Bild --------------------------
  const erste = (kind: SchematicKind): SchematicComponent | undefined => components.find((c) => c.kind === kind);
  const alle = (kind: SchematicKind): SchematicComponent[] => components.filter((c) => c.kind === kind);
  const anBauteil = (id: string) => links.filter((l) => l.from === id || l.to === id);
  const eingang = (id: string, service: PipeService) => links.find((l) => l.to === id && l.service === service);

  // =========================================================================
  // 1 · Erzeugung
  // =========================================================================
  const wp = erste('heatpump-outdoor') ?? erste('heatpump-indoor');
  const station = erste('hydraulic-station');
  const kessel = erste('boiler');
  const heizstab = erste('electric-heater');
  /*
   * Von Hand ergänzte Symbole erscheinen hier nicht. Das ist keine Lücke,
   * sondern dieselbe Regel: Was sich von Hand einfügen lässt, sind Armaturen
   * und Messstellen — genau das, was ein Prinzipbild ohnehin nicht trägt.
   * Wer sie sehen will, sieht das vollständige Schema.
   */

  /** Wo der Vorlauf die Erzeugung verlässt, und wo der Rücklauf hineingeht. */
  let vorlaufAus: { b: UebersichtBauteil; port: string } | undefined;
  let ruecklaufEin: { b: UebersichtBauteil; port: string } | undefined;

  if (wp) {
    const bWp = setze('u-erzeuger', wp.kind, SP.erzeuger, ZE.vor, [wp], kurzform(wp.spec, wp.kind));
    if (station) {
      const bSt = setze('u-station', 'hydraulic-station', SP.station, ZE.vor, [station]);
      leite(bWp, 'flow', bSt, 'source-in', 'heating-flow');
      leite(bSt, 'source-out', bWp, 'return', 'heating-return');
      vorlaufAus = { b: bSt, port: 'flow' };
      ruecklaufEin = { b: bSt, port: 'return' };
    } else {
      vorlaufAus = { b: bWp, port: 'flow' };
      ruecklaufEin = { b: bWp, port: 'return' };
    }
  } else if (kessel) {
    const bK = setze('u-erzeuger', 'boiler', SP.erzeuger, ZE.vor, [kessel], kurzform(kessel.spec, 'boiler'));
    vorlaufAus = { b: bK, port: 'flow' };
    ruecklaufEin = { b: bK, port: 'return' };
  }

  if (heizstab && vorlaufAus) {
    const bH = setze('u-heizstab', 'electric-heater', SP.zweiterzeuger, ZE.vor, [heizstab], kurzform(heizstab.spec, 'electric-heater'));
    leite(vorlaufAus.b, vorlaufAus.port, bH, 'in', 'heating-flow');
    vorlaufAus = { b: bH, port: 'out' };
  }

  /*
   * --- Die Pumpe des Erzeugerkreises — im Vorlauf --------------------------
   *
   * Bis 1.55.1 stand sie im Rücklauf, und dieses Bild suchte sie dort: über
   * eine Pumpe, deren Leitungen **alle** Rücklauf sind. Mit dem Umzug in den
   * Vorlauf fand die Suche nichts mehr, und die Pumpe fiel stillschweigend
   * aus der Übersicht — als „tragendes Bauteil weggefallen" hat es nur der
   * Prüfblock gemerkt.
   *
   * Gesucht wird sie jetzt daran, was sie **nicht** ist: keine Kreispumpe.
   * Die Kreispumpen sammelt der Zweigdurchlauf weiter unten; deshalb steht
   * die Auswahl hier schon fest, gezeichnet wird sie aber erst dort, wo sie
   * im Strang sitzt — vor der Sicherheitsgruppe und **vor** dem
   * Umschaltventil, sonst fördert sie im Warmwasserbetrieb nicht.
   */
  const nachId = new Map(components.map((c) => [c.id, c]));
  const kreispumpen = new Set<string>();
  for (const c of components) {
    if (c.kind !== 'pump') continue;
    // Eine Kreispumpe hängt an einem Mischer oder an einem Verteilbalken —
    // die Erzeugerpumpe hängt am Erzeugerstrang.
    const nachbarn = anBauteil(c.id).map((l) => (l.from === c.id ? l.to : l.from));
    if (nachbarn.some((id) => nachId.get(id)?.kind === 'valve-3way' || nachId.get(id)?.kind === 'manifold')) {
      kreispumpen.add(c.id);
    }
  }
  const erzeugerpumpe = alle('pump').find((p) => !kreispumpen.has(p.id));
  if (erzeugerpumpe && vorlaufAus) {
    const bP = setze(
      'u-erzeugerpumpe',
      'pump',
      SP.zweiterzeuger + 2,
      ZE.vor,
      [erzeugerpumpe],
      kurzform(erzeugerpumpe.spec, 'pump'),
      undefined,
      /*
       * **Externe Pumpe**, nicht „Anlagenpumpe". In einer Wärmepumpenanlage
       * sitzt die Umwälzpumpe des Erzeugerkreises in aller Regel im Gerät.
       * Steht hier eine im Bild, ist es die extern gesetzte — und genau so
       * heißt sie auf der Baustelle.
       */
      'Externe Pumpe',
    );
    bP.zone = 'erzeugung';
    leite(vorlaufAus.b, vorlaufAus.port, bP, 'in', 'heating-flow');
    vorlaufAus = { b: bP, port: 'out' };
  }

  // --- Die Sicherheitsgruppe ----------------------------------------------
  /*
   * Das Sicherheitsventil der **Heizung**, nicht das des Trinkwassererwärmers:
   * Es hängt an einer Heizungsleitung. Beide heißen gleich und sehen gleich
   * aus; verwechselt man sie, steht die Sicherheitsgruppe der Heizung am
   * Kaltwasseranschluss.
   */
  const sicherheitsteile = components.filter((c) => SICHERHEIT.has(c.kind));
  const sv = sicherheitsteile.find(
    (c) => c.kind === 'safety-valve' && anBauteil(c.id).some((l) => l.service === 'heating-flow'),
  );
  const mag = sicherheitsteile.find((c) => c.kind === 'expansion-vessel');
  if (vorlaufAus && (sv || mag)) {
    const k = knoten('u-k-sicherheit', SP.sicherheit, ZE.vor, 'erzeugung');
    leite(vorlaufAus.b, vorlaufAus.port, k, 'west', 'heating-flow');
    vorlaufAus = { b: k, port: 'east' };
    const teile: string[] = [];
    if (sv) {
      const b = setze('u-sicherheitsventil', 'safety-valve', SP.sicherheit, ZE.sicherheit, [sv], kurzform(sv.spec, 'safety-valve'));
      leite(k, 'north', b, 'in', 'heating-flow');
      teile.push(b.id);
    }
    if (mag) {
      const b = setze('u-mag', 'expansion-vessel', SP.sicherheit + 4, ZE.sicherheit, [mag], kurzform(mag.spec, 'expansion-vessel'));
      leite(k, 'north', b, 'in', 'heating-flow');
      teile.push(b.id);
    }
    if (teile.length) gruppen.push({ id: 'u-g-sicherheit', name: 'Sicherheitsgruppe', bauteile: teile });
  }

  // =========================================================================
  // 2 · Speicherung und Verteilung
  // =========================================================================
  /** Der Trinkwasserspeicher im Bild — sein Rücklauf wird erst später gelegt. */
  let bSpeicher: UebersichtBauteil | undefined;
  /** Der Stutzen, aus dem der Speicher ins Heizungswasser zurückgibt. */
  let speicherRueck: string | undefined;

  const umschalt = erste('valve-diverter');
  const speicher = erste('cylinder') ?? erste('freshwater');
  const verbrueh = erste('mixing-valve-dhw');
  const zirk = erste('circulation-pump');
  const puffer = erste('buffer') ?? erste('buffer-series') ?? erste('separator');
  /**
   * Trennpuffer oder Reihenpuffer?
   *
   * Nicht am Text der Kennwertzeile abgelesen, sondern an den Anschlüssen:
   * Nur der Trennpuffer wird auf der Erzeugerseite angeströmt (`gen-flow`).
   * Der Reihenpuffer liegt im Rücklauf und hat diesen Anschluss nicht.
   */
  const trennpuffer = Boolean(puffer && anBauteil(puffer.id).some((l) => l.fromPort === 'gen-flow' || l.toPort === 'gen-flow'));

  if (umschalt && vorlaufAus) {
    const b = setze('u-umschalt', 'valve-diverter', SP.umschalt, ZE.vor, [umschalt], 'Heizung / Warmwasser');
    leite(vorlaufAus.b, vorlaufAus.port, b, 'in', 'heating-flow');
    vorlaufAus = { b, port: 'heating' };

    if (speicher) {
      const bSp = setze('u-speicher', speicher.kind, SP.speicher, ZE.trinkwasser, [speicher], kurzform(speicher.spec, speicher.kind));
      leite(b, 'dhw', bSp, speicher.kind === 'cylinder' ? 'flow' : 'prim-flow', 'heating-flow');
      /*
       * Der **Rücklauf** der Speicherladung wird hier nur vorgemerkt und
       * weiter unten gelegt, sobald der Anlagenrücklauf steht.
       *
       * Bis 1.50.1 fehlte er ganz: Das Bild zeigte eine Ladeleitung, die in
       * den Speicher hineinlief und nicht wieder heraus. Für ein Fließbild
       * ist das kein Schönheitsfehler, sondern eine falsche Aussage — es
       * behauptet einen Strang, der nirgends endet. Gemeldet aus der
       * Benutzung: „hier fehlt der Rücklauf".
       */
      bSpeicher = bSp;
      speicherRueck = speicher.kind === 'cylinder' ? 'return' : 'prim-return';
      const zapf = knoten('u-k-zapf', SP.zapf, ZE.trinkwasser, 'speicherung', 'Zapfstellen');
      if (verbrueh) {
        const bV = setze('u-verbrueh', 'mixing-valve-dhw', SP.verbruehschutz, ZE.trinkwasser, [verbrueh], kurzform(verbrueh.spec, 'mixing-valve-dhw'));
        leite(bSp, speicher.kind === 'cylinder' ? 'dhw' : 'dhw', bV, 'hot', 'hot-water');
        leite(bV, 'mixed', zapf, 'west', 'hot-water');
      } else {
        leite(bSp, 'dhw', zapf, 'west', 'hot-water');
      }
      if (zirk) {
        const bZ = setze('u-zirk', 'circulation-pump', SP.verbruehschutz, ZE.trinkwasser + 5, [zirk], kurzform(zirk.spec, 'circulation-pump'));
        leite(zapf, 'south', bZ, 'in', 'circulation');
        leite(bZ, 'out', bSp, 'cold', 'circulation');
      }
    }
  }

  let bPuffer: UebersichtBauteil | undefined;
  if (puffer && vorlaufAus) {
    bPuffer = setze(
      'u-puffer',
      puffer.kind,
      SP.puffer,
      trennpuffer ? ZE.vor + 2 : ZE.rueck,
      [puffer],
      kurzform(puffer.spec, puffer.kind),
    );
    if (trennpuffer) {
      leite(vorlaufAus.b, vorlaufAus.port, bPuffer, 'gen-flow', 'heating-flow');
      vorlaufAus = { b: bPuffer, port: 'sys-flow' };
    }
  }

  // =========================================================================
  // 3 · Übergabe — die Verbraucherzweige, gleichartige zusammengefasst
  // =========================================================================
  const zweige: Zweig[] = [];
  for (const v of components) {
    if (v.kind !== 'radiator' && v.kind !== 'floor-loop') continue;
    const z: Zweig = { verbraucher: v, kw: kilowatt(v.spec), temperaturen: temperaturen(v.spec) };
    /*
     * Rückwärts durch den Zweig, bis ein Knoten, ein Speicher oder der
     * Erzeuger kommt. Gesucht werden die drei Bauteile, die den Zweig
     * beschreiben: Verteiler, Mischer, Kreispumpe. Alles dazwischen —
     * Absperrung, Rückschlagklappe, Thermostatventil — fällt heraus.
     *
     * Die Obergrenze von zwanzig Schritten ist eine Schleifenbremse, keine
     * fachliche Grenze: Ein Zweig hat im vollständigen Schema höchstens sechs
     * Bauteile, und ein Bild ohne Knoten darf nicht zum Hänger führen.
     */
    let hier: SchematicComponent | undefined = v;
    for (let schritt = 0; schritt < 20 && hier; schritt += 1) {
      const rein = eingang(hier.id, 'heating-flow');
      const vorher: SchematicComponent | undefined = rein ? components.find((c) => c.id === rein.from) : undefined;
      if (
        !vorher ||
        vorher.kind === 'node' ||
        vorher.kind === 'buffer' ||
        vorher.kind === 'buffer-series' ||
        vorher.kind === 'separator'
      ) {
        break;
      }
      if (vorher.kind === 'manifold') z.verteiler = vorher;
      if (vorher.kind === 'valve-3way') z.mischer = vorher;
      if (vorher.kind === 'pump') z.pumpe = vorher;
      z.temperaturen ??= temperaturen(vorher.spec);
      hier = vorher;
    }
    zweige.push(z);
  }

  /**
   * Zwei Zweige sind gleichartig, wenn sie **dieselbe Anlage** beschreiben:
   * dieselbe Art Verbraucher, dieselbe Beschaltung (Verteiler, Mischer,
   * Pumpe) und dieselben Temperaturen. „Fußbodenheizung EG" und
   * „Fußbodenheizung OG" sind dann ein Symbol mit der Anzahl 2 — dass es zwei
   * Geschosse sind, sagt der Grundriss und nicht das Prinzipbild.
   */
  const merkmal = (z: Zweig): string =>
    [
      z.verbraucher.kind,
      z.verteiler ? 'V' : '-',
      z.mischer ? 'M' : '-',
      z.pumpe ? 'P' : '-',
      z.temperaturen ?? '?',
    ].join('|');

  const gebuendelt = new Map<string, Zweig[]>();
  for (const z of zweige) {
    const k = merkmal(z);
    const liste = gebuendelt.get(k);
    if (liste) liste.push(z);
    else gebuendelt.set(k, [z]);
  }

  const buendel = [...gebuendelt.values()];
  /*
   * Verteilbalken nur, wenn mehr als ein Zweig abgeht. Bei einem einzigen
   * Zweig wäre er ein Knoten mit je einer Leitung auf beiden Seiten — er
   * behauptete eine Verteilung, die es nicht gibt. Dieselbe Regel gilt im
   * vollständigen Schema.
   */
  const mitBalken = buendel.length > 1;
  let balkenVor: UebersichtBauteil | undefined;
  let balkenRueck: UebersichtBauteil | undefined;
  if (mitBalken && vorlaufAus) {
    balkenVor = knoten('u-k-balken-vor', SP.balken, ZE.vor, 'uebergabe');
    balkenRueck = knoten('u-k-balken-rueck', SP.balken, ZE.rueck, 'uebergabe');
    leite(vorlaufAus.b, vorlaufAus.port, balkenVor, 'west', 'heating-flow');
  }

  /** Wohin der Rücklauf aus den Zweigen läuft. */
  let ruecklaufSammler: { b: UebersichtBauteil; port: string } | undefined = balkenRueck
    ? { b: balkenRueck, port: 'east' }
    : undefined;

  buendel.forEach((gruppe, i) => {
    const z = gruppe[0];
    const y = ZE.ersterZweig - i * ZE.zweigAbstand;
    const quelle = balkenVor
      ? { b: balkenVor, port: 'north' }
      : (vorlaufAus as { b: UebersichtBauteil; port: string });
    let ab: { b: UebersichtBauteil; port: string } = quelle;
    const rahmen: string[] = [];

    if (z.mischer) {
      const b = setze(
        `u-mischer-${i}`,
        'valve-3way',
        SP.mischer,
        y,
        gruppe.map((g) => g.mischer!).filter(Boolean),
        z.temperaturen ? `${z.temperaturen} °C` : undefined,
      );
      leite(ab.b, ab.port, b, 'hot', 'heating-flow');
      ab = { b, port: 'mixed' };
      rahmen.push(b.id);
    }
    if (z.pumpe) {
      const b = setze(
        `u-kreispumpe-${i}`,
        'pump',
        SP.kreispumpe,
        y,
        gruppe.map((g) => g.pumpe!).filter(Boolean),
        undefined,
        undefined,
        // Sie heißt beim Heizungsbauer Umwälzpumpe, nicht Kreispumpe.
        'Umwälzpumpe',
      );
      leite(ab.b, ab.port, b, 'in', 'heating-flow');
      ab = { b, port: 'out' };
      rahmen.push(b.id);
    }
    /*
     * Mischer und Kreispumpe zusammen sind auf dem Markt ein Bauteil: die
     * Heizkreisgruppe. Wo beide stehen, bekommen sie den Rahmen — genau so,
     * wie die geprüften Herstellerunterlagen die Solar- und die
     * Hydraulikstation zusammenfassen.
     */
    if (rahmen.length === 2) {
      /*
       * **Mischergruppe**, nicht „Heizkreisgruppe": Was Mischer und Pumpe in
       * einem Gehäuse zusammenfasst, heißt im Handel und auf der Baustelle so.
       */
      gruppen.push({ id: `u-g-kreis-${i}`, name: 'Mischergruppe', bauteile: rahmen });
    }

    /*
     * Der Verteiler fällt weg, wenn der Verbraucher ohnehin die
     * Fußbodenheizung ist: Ein Flächenheizkreis ohne Verteiler gibt es nicht,
     * und das Symbol der Fußbodenheizung trägt die Aussage bereits. Steht
     * dagegen ein Verteiler vor Heizkörpern, ist er eine eigene Entscheidung
     * und bleibt im Bild.
     */
    if (z.verteiler && z.verbraucher.kind !== 'floor-loop') {
      const b = setze(
        `u-verteiler-${i}`,
        'manifold',
        SP.verbraucher - 4,
        y,
        gruppe.map((g) => g.verteiler!).filter(Boolean),
      );
      leite(ab.b, ab.port, b, 'flow', 'heating-flow');
      ab = { b, port: 'circuit-1' };
    }

    const anzahl = gruppe.length;
    const summe = gruppe.every((g) => typeof g.kw === 'number')
      ? gruppe.reduce((s, g) => s + (g.kw ?? 0), 0)
      : undefined;
    const teile: string[] = [];
    if (anzahl > 1) teile.push(`${anzahl} ${z.verbraucher.kind === 'radiator' ? 'Stück' : 'Kreise'}`);
    if (summe !== undefined) teile.push(`${deutsch(summe)} kW`);
    if (z.temperaturen) teile.push(`${z.temperaturen} °C`);

    /*
     * Der Verteiler einer Fußbodenheizung geht **in das Symbol des
     * Verbrauchers ein** und wird nicht nur stillschweigend verbraucht.
     *
     * Der Unterschied ist buchhalterisch und trotzdem wichtig: Wäre er nur
     * als „benutzt" vermerkt, stünde er weder im Bild noch in der
     * Weglassliste — zwei Bauteile des Referenzhauses wären damit aus der
     * Rechnung verschwunden, und „gezeigt plus weggelassen" ergäbe nicht mehr
     * das ganze Schema. Genau das hat der Prüfblock gefunden.
     */
    const mitgemeint =
      z.verbraucher.kind === 'floor-loop'
        ? gruppe.map((g) => g.verteiler).filter((v): v is SchematicComponent => Boolean(v))
        : [];

    const bV = setze(
      `u-verbraucher-${i}`,
      z.verbraucher.kind,
      SP.verbraucher,
      y,
      [...gruppe.map((g) => g.verbraucher), ...mitgemeint],
      teile.join(' · ') || undefined,
      anzahl,
    );

    leite(ab.b, ab.port, bV, 'flow', 'heating-flow');
    if (ruecklaufSammler) {
      leite(bV, 'return', ruecklaufSammler.b, ruecklaufSammler.port, 'heating-return');
    } else {
      // Ein einziger Zweig: sein Rücklauf ist der Anlagenrücklauf.
      ruecklaufSammler = { b: bV, port: 'return' };
    }
  });

  // =========================================================================
  // 4 · Der Rücklauf zurück zum Erzeuger
  // =========================================================================
  if (ruecklaufSammler && bPuffer) {
    // Der Balken nimmt die Zweige von rechts auf und gibt nach links ab —
    // sonst liefe die Leitung im Bild in sich selbst zurück.
    const ausPort = ruecklaufSammler.b === balkenRueck ? 'west' : ruecklaufSammler.port;
    leite(ruecklaufSammler.b, ausPort, bPuffer, 'sys-return', 'heating-return');
    ruecklaufSammler = { b: bPuffer, port: 'gen-return' };
  }

  /*
   * Der Rücklauf der Speicherladung mündet in den Anlagenrücklauf.
   *
   * Er gehört **erzeugerseitig** dazu: Das Umschaltventil schickt den Vorlauf
   * entweder in den Heizkreis oder in den Speicher; beide Wege kommen am
   * selben Rücklauf zum Erzeuger zurück. Die Einmündung bekommt einen
   * Knotenpunkt, damit im Bild zu sehen ist, dass sich dort zwei Stränge
   * treffen und nicht einer den anderen ablöst.
   */
  if (ruecklaufSammler && bSpeicher && speicherRueck) {
    const k = knoten('u-k-tww-rueck', SP.speicher, ZE.rueck, 'speicherung');
    const ausPort = ruecklaufSammler.b === balkenRueck ? 'west' : ruecklaufSammler.port;
    leite(ruecklaufSammler.b, ausPort, k, 'east', 'heating-return');
    leite(bSpeicher, speicherRueck, k, 'south', 'heating-return');
    ruecklaufSammler = { b: k, port: 'west' };
  }

  if (ruecklaufSammler && ruecklaufEin) {
    leite(ruecklaufSammler.b, ruecklaufSammler.port, ruecklaufEin.b, ruecklaufEin.port, 'heating-return');
  }

  // =========================================================================
  // 5 · Die Notbremse
  // =========================================================================
  /*
   * Bleiben nach dem Zusammenfassen mehr Bauteile übrig, als ein Prinzipbild
   * trägt, wird weiter weggelassen — aber in einer **festen, begründeten
   * Reihenfolge** und nicht willkürlich, und jedes Mal nachvollziehbar in
   * `weggelassen`. Die Reihenfolge geht vom Entbehrlichsten aus: Eine
   * Zirkulationspumpe ist Komfort, eine Kreispumpe steckt heute in jeder
   * Heizkreisgruppe, ein Verteiler vor Heizkörpern ist eine Verlegeart. Was
   * Wärme erzeugt, speichert oder abgibt, wird nie entfernt.
   */
  const OPFERFOLGE: readonly string[] = ['u-zirk', 'u-verbrueh'];
  const zaehlbar = () => bauteile.filter((b) => b.kind !== 'node').length;
  for (const id of OPFERFOLGE) {
    if (zaehlbar() <= UEBERSICHT_HOECHSTZAHL) break;
    entferne(bauteile, leitungen, genutzt, id);
  }
  while (zaehlbar() > UEBERSICHT_HOECHSTZAHL) {
    const opfer = [...bauteile].reverse().find((b) => b.id.startsWith('u-kreispumpe-')) ??
      [...bauteile].reverse().find((b) => b.id.startsWith('u-verteiler-'));
    if (!opfer) break;
    entferne(bauteile, leitungen, genutzt, opfer.id);
    for (const g of gruppen) g.bauteile = g.bauteile.filter((x) => x !== opfer.id);
  }
  // Ein Rahmen um ein einziges Bauteil ist kein Rahmen.
  const echteGruppen = gruppen.filter((g) => g.bauteile.length >= 2);

  // =========================================================================
  // 6 · Was herausgefallen ist
  // =========================================================================
  const zaehler = new Map<SchematicKind, number>();
  for (const c of components) {
    if (c.kind === 'node' || genutzt.has(c.id)) continue;
    zaehler.set(c.kind, (zaehler.get(c.kind) ?? 0) + 1);
  }
  const weggelassen: UebersichtWeglassung[] = [...zaehler.entries()]
    .map(([kind, anzahl]) => ({ kind, name: SCHEMATIC_LEGEND[kind].name, anzahl, tragend: BEHALTEN.has(kind) }))
    .sort((a, b) => b.anzahl - a.anzahl || a.name.localeCompare(b.name, 'de'));

  /*
   * =========================================================================
   * Leere Spalten herausnehmen
   * =========================================================================
   *
   * **Warum das nötig ist.** Die Spaltentafel `SP` reserviert für jede
   * Station einen festen Platz — Erzeuger, Station, Zweiterzeuger,
   * Sicherheitsgruppe, Umschaltventil, Puffer, Balken, Mischer, Kreispumpe,
   * Verbraucher. Eine Anlage hat davon selten alle. Eine Wärmepumpe mit
   * einem gemischten Kreis, ohne Speicher und ohne Puffer, belegt sechs
   * Spalten und lässt vier leer — die Leitung lief quer über ein Drittel des
   * Blattes an nichts vorbei.
   *
   * Gemeldet am Bild: „die Zeichnung ist unnötig aufgezogen, Linienführung
   * sollte besser strukturiert sein … es soll nur schematisch für den
   * Handwerker bzw. die Kundendoku sein."
   *
   * **Die Reihenfolge bleibt, der Abstand wird gleich.** Zusammengerückt
   * wird auf denselben Rasterabstand, den die Tafel zwischen zwei benachbarten
   * Stationen vorsieht — enger nicht, sonst stoßen die Beschriftungen
   * aneinander. Was nebeneinander stand, steht weiter nebeneinander; was
   * hintereinander lag, bleibt hintereinander.
   */
  {
    const SPALTENABSTAND = 4;
    const benutzt = [...new Set(bauteile.map((b) => b.x))].sort((a, b) => a - b);
    const neueSpalte = new Map(benutzt.map((x, i) => [x, i * SPALTENABSTAND]));
    for (const b of bauteile) b.x = neueSpalte.get(b.x) ?? b.x;
  }

  return {
    bauteile,
    gruppen: echteGruppen,
    leitungen,
    weggelassen,
    hinweis: UEBERSICHT_HINWEIS,
    vollstaendig: components.filter((c) => c.kind !== 'node').length,
  };
}

/**
 * Ein Bauteil samt seiner Leitungen aus dem Bild nehmen — und die Leitung
 * darüber hinweg schließen.
 *
 * Ohne das Zusammenziehen bliebe an der Stelle eine Lücke im Strang, und eine
 * unterbrochene Leitung in einem Fließbild behauptet, dass dort nichts fließt.
 */
function entferne(
  bauteile: UebersichtBauteil[],
  leitungen: UebersichtLeitung[],
  genutzt: Set<string>,
  id: string,
): void {
  const i = bauteile.findIndex((b) => b.id === id);
  if (i < 0) return;
  for (const h of bauteile[i].herkunft) genutzt.delete(h);
  bauteile.splice(i, 1);

  const rein = leitungen.filter((l) => l.to === id);
  const raus = leitungen.filter((l) => l.from === id);
  for (let k = leitungen.length - 1; k >= 0; k -= 1) {
    if (leitungen[k].from === id || leitungen[k].to === id) leitungen.splice(k, 1);
  }
  for (const a of rein) {
    for (const b of raus) {
      if (a.service !== b.service) continue;
      leitungen.push({
        id: `ul-${leitungen.length + 1}`,
        from: a.from,
        to: b.to,
        fromPort: a.fromPort,
        toPort: b.toPort,
        service: a.service,
      });
    }
  }
}

/**
 * Die Kennwertzeile auf ihr erstes Glied kürzen.
 *
 * Im vollständigen Schema steht unter dem Symbol, was die Auslegung sagt —
 * „7 kW bei Auslegung · R290", „18 l · p₀ 0.9 bar". Im Prinzipbild steht die
 * **maßgebende Zahl**, sonst nichts; alles Weitere findet sich in der
 * Stückliste. Der Dezimalpunkt wird dabei zum Komma: Das Blatt ist deutsch.
 */
function kurzform(spec: string | undefined, kind?: SchematicKind): string | undefined {
  if (!spec) return undefined;
  const muster = kind ? KENNZAHL[kind] : undefined;
  const treffer = muster?.exec(spec)?.[0];
  const erstes = (treffer ?? spec.split('·')[0].split(/[,;]/)[0]).trim();
  if (!erstes) return undefined;
  // Der Dezimalpunkt wird zum Komma: Das Blatt ist deutsch.
  const text = erstes.replace(/(\d)\.(\d)/g, '$1,$2');
  return text.length > 22 ? `${text.slice(0, 21)}…` : text;
}
