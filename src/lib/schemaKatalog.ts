/**
 * Schemakatalog — die benannten Hydraulikschemata, aus denen vorgeschlagen wird.
 * ---------------------------------------------------------------------------
 * WAS DIESE DATEI IST
 * Ein reiner Datenkatalog. Er beschreibt, welche Anlagenschemata es gibt, woran
 * man sie erkennt, welche Vorbedingungen gelten, aus welchen Bauteilen sie in
 * Fließrichtung bestehen und mit welchen Zahlen sie ausgelegt werden. Kein
 * Rechenkern, keine Auswahllogik, keine Oberfläche — die Vorschlagsmaschine
 * liest diesen Katalog und prüft die `bedingungen` gegen `PlantDesignResult`
 * und `CircuitDesign` aus ./plantDesign. Deshalb importiert diese Datei auch
 * nur Typen aus ../types/bim und sonst nichts.
 *
 * WARUM HERSTELLERNEUTRAL
 * Die Schemata selbst stammen aus dem BWP-Leitfaden Hydraulik (Ausgabe August
 * 2023). Der Leitfaden hält ausdrücklich fest, dass seine Hydraulikpläne „als
 * firmenübergreifende Standards in der Branche" erarbeitet wurden — mitgewirkt
 * haben Buderus, Glen Dimplex, Nibe, Stiebel Eltron, Vaillant und Viessmann.
 * Das ist die einzige frei verfügbare, vollständig auswertbare und zugleich
 * herstellerneutrale Schemabibliothek mit Auslegungstabellen. Alles andere ist
 * entweder kostenpflichtig (VDI 4645 Anhang F, ZVSHK-Musterhydrauliken,
 * DIN EN 12828) oder herstellergebunden.
 *
 * Die Herstellernamen in `herstellernamen` sind deshalb **keine Quelle für den
 * Inhalt**, sondern nur eine Zuordnung: sie sagen, wie Viessmann, Vaillant,
 * Bosch, Buderus, Wolf, Stiebel Eltron, Weishaupt, Ochsner, NIBE, Panasonic,
 * Mitsubishi, LG, Daikin oder Hoval dieselbe Konstellation nennen. Wer im
 * Katalog eines Herstellers sucht, findet die Vorlage darüber wieder. Ein
 * Herstellername begründet hier nie eine Zahl.
 *
 * DIE FEINPLANUNG ERFOLGT NACH DEN HERSTELLERUNTERLAGEN
 * Das schreibt der BWP-Leitfaden selbst: er gibt nur Hinweise zur
 * „überschlägigen Dimensionierung der Grundkomponenten"; „für die Feinplanung
 * sind die Vorgaben der Hersteller bindend". Dieser Katalog übernimmt diese
 * Ansage unverändert. Er dient dazu, ein passendes Schema vorzuschlagen und
 * die Grundkomponenten überschlägig zu bemaßen — nicht dazu, eine Anlage
 * auszuführen. Kommt ein Datenblatt hinzu, schlägt es jede Zahl aus diesem
 * Katalog. Hinzu kommt der Hinweis, den Wolf, Viessmann und Buderus gleich
 * lautend führen (siehe WISSEN_KORPUS, `hyd-schemata-unvollstaendig`):
 * Prinzipschemata zeigen Absperrorgane, Entlüftungen und sicherheitstechnische
 * Maßnahmen **nicht vollständig**; sie sind anlagenspezifisch zu ergänzen.
 *
 * HERKUNFT UND BELEGREGEL
 * Der Inhalt stammt aus vier Rechercheberichten (Stand August 2026):
 *   • recherche-schemata-neutral.md  → die 11 BWP-Schemata, ZVSHK/VdZ,
 *                                      Kaskaden, bivalente Anlagen (Hauptquelle)
 *   • recherche-bauformen.md         → welche Bauform welche Bauteile mitbringt
 *   • recherche-schemata-a.md        → Viessmann, Vaillant, Bosch, Buderus, Wolf
 *   • recherche-schemata-b.md        → Stiebel, NIBE, Daikin, Panasonic,
 *                                      Weishaupt, Ochsner, Mitsubishi, LG,
 *                                      Samsung, Hoval
 * Jede Bauteilkette, jede Zahl und jede Vorbedingung ist in einem dieser vier
 * Berichte belegt. Was dort als Ableitung oder als nicht belegbar geführt wird,
 * ist hier ebenso gekennzeichnet — im `beleg`-Text und über `belastbarkeit`:
 *   • `primaer`   — Herstellerdatenblatt oder Planungsunterlage im Volltext.
 *   • `sekundaer` — Verbandsleitfaden (BWP, VdZ); Normtext kostenpflichtig und
 *                   nicht eingesehen.
 *   • `annahme`   — von diesem Programm gesetzt, weil eine Abgrenzung gebraucht
 *                   wurde. Steht so auch im Text.
 *
 * ZWEI DINGE, DIE DER LEITFADEN ÜBER ALLE SCHEMATA SAGT
 * 1. Die Elektro-Zusatzheizung ist in **jedem** der 11 Schemata als graue, also
 *    wahlweise verwendbare Baugruppe eingezeichnet — im Vorlauf der Wärmepumpe
 *    und alternativ im Speicher. Sie ist deshalb hier durchgängig `optional`
 *    und nicht als eigene bivalente Ausprägung geführt.
 * 2. Das Membran-Ausdehnungsgefäß sitzt **immer im Rücklauf** und **immer mit
 *    Kappenventil**; jeder Erzeuger- und Heizkreiszweig führt die Kombination
 *    Umwälzpumpe + Rückschlagklappe und beidseitige Absperrventile.
 *
 * SCHREIBWEISE
 * Deutscher Fließtext ohne Markdown, Zahlen mit Komma als Dezimaltrennzeichen.
 * Die Texte werden unverändert angezeigt und in Berichte übernommen.
 */

import type { PumpForm, SchematicKind, UnitContents } from '../types/bim';

// ---------------------------------------------------------------------------
// Merkmale, Bedingungen, Bauteile
// ---------------------------------------------------------------------------

/** Wie die Wärme vom Erzeuger zu den Kreisen kommt. */
export type Anbindung = 'direkt' | 'reihenpuffer' | 'parallelpuffer' | 'weiche' | 'kombispeicher';

/** Wie das Trinkwasser erwärmt wird. */
export type Trinkwasserart = 'keine' | 'speicher' | 'kombispeicher' | 'frischwasser' | 'integriert';

/** Merkmale, an denen ein Schema erkannt und ausgewählt wird. */
export interface SchemaMerkmale {
  anbindung: Anbindung;
  trinkwasser: Trinkwasserart;
  /** Höchstzahl der Heizkreise, die das Schema zeigt; 0 = beliebig. */
  kreise: number;
  /** Zeigt das Schema gemischte Kreise? */
  gemischt: boolean;
  /** Zugelassene Übergabearten. */
  uebergabe: ('flaeche' | 'heizkoerper')[];
  bivalent?: 'kein' | 'heizstab' | 'kessel' | 'festbrennstoff' | 'solar';
  kuehlung?: 'keine' | 'passiv' | 'aktiv';
  kaskade?: boolean;
  /** Bauformen, für die das Schema gilt; leer = alle. */
  bauformen?: PumpForm[];
  /**
   * Zeigt das Schema einen **weiteren Verbraucher**, den die Anlage haben
   * muss — Schwimmbad, Lüftungsregister, Prozesswärme?
   *
   * Ohne dieses Merkmal schnitt BWP-H-10 (Schwimmbad) genauso gut ab wie das
   * Grundschema BWP-H-03: in allen Grundmerkmalen stimmen sie überein, und
   * das Becken steckte nur in der Bauteilliste. Der Anwender bekam ein
   * Schema mit Wärmeübertrager und Systemtrennung zum Becken vorgeschlagen,
   * ohne ein Becken zu haben.
   */
  weitererVerbraucher?: 'kein' | 'schwimmbad';
}

/** Eine Vorbedingung, die geprüft und dem Anwender erklärt wird. */
export interface SchemaBedingung {
  id: string;
  /** Was gelten muss, in einem Satz. */
  text: string;
  /** Warum — mit Quelle. */
  beleg: string;
  /** 'hart' = das Schema ist sonst unzulässig, 'weich' = es passt dann nur schlechter. */
  art: 'hart' | 'weich';
}

/** Ein Bauteil der Kette, in Fließrichtung. */
export interface SchemaBauteil {
  kind: SchematicKind;
  label: string;
  /** Optional im Sinne des Leitfadens (im BWP grau gezeichnet). */
  optional?: boolean;
  /** Nur bauseits, wenn das Gerät es nicht schon enthält. */
  entfaelltWennImGeraet?: keyof UnitContents;
  hinweis?: string;
}

export interface SchemaVorlage {
  id: string;
  /** Kennung der Quelle, z. B. 'BWP-H-03'. */
  kennung: string;
  name: string;
  /** Ein Satz: wofür. */
  kurz: string;
  merkmale: SchemaMerkmale;
  bedingungen: SchemaBedingung[];
  /** Erzeugerkreis in Fließrichtung. */
  erzeugerkreis: SchemaBauteil[];
  /** Je Heizkreis in Fließrichtung. */
  heizkreis: SchemaBauteil[];
  /** Trinkwasserzweig in Fließrichtung; leer, wenn keiner. */
  trinkwasserzweig: SchemaBauteil[];
  /** Auslegungswerte mit Quelle. */
  auslegung: { groesse: string; wert: string; quelle: string }[];
  /** Wie Hersteller dieselbe Konstellation nennen. */
  herstellernamen: { hersteller: string; bezeichnung: string; quelle?: string }[];
  /** Verweise in WISSEN_KORPUS. */
  wissenIds: string[];
  quelle: string;
  url?: string;
  belastbarkeit: 'primaer' | 'sekundaer' | 'annahme';
}

// ---------------------------------------------------------------------------
// Quellenkonstanten und wiederkehrende Bauteilblöcke
// ---------------------------------------------------------------------------

/** Fundstelle der Hauptquelle; die Ausgabe 2023 ist maßgeblich. */
const BWP_URL = 'https://www.waermepumpe.de/fileadmin/user_upload/waermepumpe/07_Publikationen/BWP_LF_HYDRAULIK.pdf';
const BWP = 'BWP Leitfaden Hydraulik, Ausgabe August 2023';

/** Der immer gleiche Anfang des Erzeugervorlaufs (BWP, Abschnitt 1.4). */
function wpVorlauf(): SchemaBauteil[] {
  return [
    { kind: 'heatpump-outdoor', label: 'Wärmepumpe (Verdichter)' },
    {
      kind: 'electric-heater',
      label: 'Elektro-Zusatzheizung Wärmepumpe',
      optional: true,
      entfaelltWennImGeraet: 'backupHeater',
      hinweis: 'Im Leitfaden grau gezeichnet, also wahlweise verwendbar; alternative Position ist der Speicher.',
    },
    { kind: 'pump', label: 'Umwälzpumpe Heizung', entfaelltWennImGeraet: 'pump' },
    { kind: 'check-valve', label: 'Rückschlagklappe' },
    { kind: 'sensor', label: 'Vorlauftemperaturfühler' },
    { kind: 'shutoff', label: 'Absperrventil im Erzeugervorlauf' },
  ];
}

/** Der immer gleiche Schluss des Erzeugerrücklaufs (BWP, Abschnitt 1.4). */
function wpRuecklauf(): SchemaBauteil[] {
  return [
    { kind: 'shutoff', label: 'Absperrventil im Erzeugerrücklauf' },
    { kind: 'dirt-separator', label: 'Schlamm- und Magnetitabscheider im Rücklauf', optional: true, entfaelltWennImGeraet: 'dirtSeparator', hinweis: 'Nicht im BWP-Schema gezeichnet; von Wolf, Buderus und Daikin für den Rücklauf zum Gerät gefordert.' },
    {
      kind: 'expansion-vessel',
      label: 'Membran-Ausdehnungsgefäß mit Kappenventil',
      entfaelltWennImGeraet: 'expansionVessel',
      hinweis: 'Sitzt im Rücklauf und ist nur über ein Kappenventil absperrbar — so zeichnet es der BWP durchgängig.',
    },
    { kind: 'heatpump-outdoor', label: 'Rücklaufeintritt Wärmepumpe' },
  ];
}

/** Das Umschaltventil Warmwasser mit den beiden Abgängen. */
function umschaltventilWarmwasser(): SchemaBauteil[] {
  return [
    {
      kind: 'valve-diverter',
      label: 'Dreiwege-Umschaltventil Heizung/Warmwasser',
      entfaelltWennImGeraet: 'diverter',
      hinweis: 'Auslegung nach Volumenstrom und Druckverlust im Heizbetrieb.',
    },
  ];
}

/** Der Trinkwasserzweig mit Speicher, wie ihn BWP und ZVSHK zeigen. */
function trinkwasserSpeicher(): SchemaBauteil[] {
  return [
    { kind: 'shutoff', label: 'Absperrventil Trinkwasserzweig' },
    {
      kind: 'cylinder',
      label: 'Trinkwassererwärmer mit Wärmeübertrager',
      entfaelltWennImGeraet: 'cylinder',
      hinweis: 'Die Dimensionierung des Warmwasserspeichers ist nicht Gegenstand des BWP-Leitfadens Hydraulik.',
    },
    { kind: 'sensor', label: 'Speichertemperaturfühler' },
    {
      kind: 'safety-valve',
      label: 'Kaltwasser-Sicherheitsgruppe Trinkwasser',
      hinweis: 'Im BWP-Schema nicht gezeichnet; in der ZVSHK-Darstellung (VdZ Abb. 3) ausdrücklich als eigene Sicherheitsgruppe geführt.',
    },
    {
      kind: 'backflow-preventer',
      label: 'Rückflussverhinderer in der Kaltwasserzuleitung',
      hinweis: 'Teil der Kaltwasser-Sicherheitsgruppe nach DIN 1988 und DIN 4753.',
    },
    {
      kind: 'circulation-pump',
      label: 'Zirkulationspumpe PWH-C',
      optional: true,
      hinweis: 'Die BWP-Legende führt die Zirkulationsleitung als eigene Linienart; gezeichnet ist sie nur, wo eine Zirkulation vorgesehen ist.',
    },
  ];
}

// ---------------------------------------------------------------------------
// Wiederkehrende Auslegungszeilen
// ---------------------------------------------------------------------------

const A_SPREIZUNG_PRIMAER = {
  groesse: 'Spreizung Primärseite',
  wert: '3 bis 5 K bei maximaler Kälteleistung',
  quelle: BWP + ', Auslegungstabellen aller Schemata',
};

const A_SPREIZUNG_HEIZUNG = {
  groesse: 'Spreizung Heizungsseite',
  wert: '5 bis 7 K bei Heizleistung unter Auslegungsbedingungen; für statische Heizflächen bis maximal 10 K',
  quelle: BWP + ', Auslegungstabellen Schema 2 bis 11',
};

const A_SPREIZUNG_TWE = {
  groesse: 'Spreizung Trinkwassererwärmung',
  wert: 'maximal 10 K bei größter Leistung der Wärmepumpe zur Trinkwassererwärmung',
  quelle: BWP + ', Auslegungstabellen aller Schemata',
};

const A_MINDESTVOLUMENSTROM = {
  groesse: 'Mindestvolumenstrom',
  wert: 'Herstellerangaben beachten — der Leitfaden nennt keinen Zahlenwert',
  quelle: BWP + ', Auslegungstabellen aller Schemata',
};

const A_WT_FLAECHE = {
  groesse: 'Wärmeübertragerfläche im Trinkwassererwärmer',
  wert: 'mindestens 0,25 m² je kW Heizleistung der Wärmepumpe zur Trinkwassererwärmung',
  quelle: BWP + ', Auslegungstabellen; deckungsgleich im VdZ-Leitfaden, S. 10',
};

const A_PUFFER_LKW = {
  groesse: 'Pufferspeicher',
  wert: 'zur Laufzeitoptimierung 20 bis 25 l je kW maximaler Heizleistung der Wärmepumpe; zur Überbrückung von Sperrzeiten 30 bis 40 l je kW',
  quelle: BWP + ', Auslegungstabellen Schema 2 bis 11',
};

// ---------------------------------------------------------------------------
// Wiederkehrende Bedingungen
// ---------------------------------------------------------------------------

const B_HERSTELLER_BINDEND: SchemaBedingung = {
  id: 'feinplanung-hersteller',
  text: 'Die Vorbemaßung dieses Schemas ersetzt die Herstellerunterlagen nicht.',
  beleg: BWP + ', Hinweise zu diesem Leitfaden: der Leitfaden gibt nur Hinweise zur überschlägigen Dimensionierung der Grundkomponenten, für die Feinplanung sind die Vorgaben der Hersteller bindend.',
  art: 'weich',
};

const B_PUFFER_MISCHERKREISE: SchemaBedingung = {
  id: 'puffer-bei-nur-mischerkreisen',
  text: 'Bestehen alle Heizkreise aus gemischten Kreisen, ist ein Pufferspeicher zwingend.',
  beleg: 'Bosch Compress 7000i AW, Planungsunterlage Kap. 4.2.4: in Anlagen, die nur aus Heizkreisen mit Mischer bestehen, ist unbedingt ein Pufferspeicher erforderlich (mindestens 50 l, bei den großen Baugrößen mindestens 100 l).',
  art: 'hart',
};

// ---------------------------------------------------------------------------
// Der Katalog
// ---------------------------------------------------------------------------

export const SCHEMA_KATALOG: SchemaVorlage[] = [
  // -------------------------------------------------------------------------
  // BWP-H-01 — der einfachste Fall. Das einzige Schema mit einem Zahlenwert
  // für das Mindestvolumen, weil es das einzige ohne Puffer ist. Heizkörper
  // sind hier ausdrücklich nicht zugelassen; sie erscheinen erst in Schema 2.
  // -------------------------------------------------------------------------
  {
    id: 'bwp-h-01-direkt-flaeche',
    kennung: 'BWP-H-01',
    name: 'Wärmepumpe, ein ungemischter Heizkreis und Trinkwassererwärmung',
    kurz: 'Ein einziger ungemischter Flächenheizkreis ohne Pufferspeicher; das Mindestvolumen stellt das Heizsystem selbst bereit.',
    merkmale: {
      anbindung: 'direkt',
      trinkwasser: 'speicher',
      kreise: 1,
      gemischt: false,
      uebergabe: ['flaeche'],
      bivalent: 'kein',
      kuehlung: 'keine',
      kaskade: false,
    },
    bedingungen: [
      {
        id: 'nur-flaechenheizung',
        text: 'Nur Flächenheizsysteme; Heizkörper und Konvektoren sind hier nicht zugelassen.',
        beleg: BWP + ', Schema 1, Zeile Anlagenoptionen. In der Auswahlmatrix führt Schema 1 ausschließlich Flächenheizung; Radiatoren erscheinen erst ab Schema 2.',
        art: 'hart',
      },
      {
        id: 'luftwasser-nur-geregelt',
        text: 'Eine Luft/Wasser-Wärmepumpe darf hier nur mehrstufig oder mit leistungsgeregeltem Verdichter eingesetzt werden.',
        beleg: BWP + ', Schema 1, Vorbedingungen: Sole/Wasser-, Wasser/Wasser- und Direktverdampfungs-Wärmepumpen; Luft/Wasser-Wärmepumpe nur mehrstufig oder mit leistungsgeregelten Verdichtern.',
        art: 'hart',
      },
      {
        id: 'mindestvolumen-3-5',
        text: 'Das Heizsystem muss 3 bis 5 l je kW Heizleistung der Wärmepumpe als dauerhaft durchströmtes Volumen bereitstellen.',
        beleg: BWP + ', Schema 1, Zeile Mindestvolumen Heizsystem; abhängig von der Mindestlaufzeit, bei Luft/Wasser zusätzlich die Herstellerangaben zur Abtauenergie.',
        art: 'hart',
      },
      {
        id: 'ueberstroemventil-nur-bedarf',
        text: 'Ein Überströmventil wird nur im Bedarfsfall eingebaut und nicht mit einer Pumpenkennlinie Delta-p variabel oder Autoadapt kombiniert.',
        beleg: BWP + ', Schema 1, Zeile Überströmventil: Einbau nur im Bedarfsfall, Mindestvolumenstrom bei Vollöffnung, vollständig geschlossen bei möglichst geringem Volumenstrom, Einbau möglichst dicht an der Wärmeübergabe.',
        art: 'weich',
      },
      B_HERSTELLER_BINDEND,
    ],
    erzeugerkreis: [...wpVorlauf(), ...umschaltventilWarmwasser(), ...wpRuecklauf()],
    heizkreis: [
      { kind: 'sensor', label: 'Vorlauftemperaturfühler' },
      { kind: 'temperature-limiter', label: 'Maximaltemperaturwächter Flächenheizung' },
      { kind: 'floor-loop', label: 'Flächenheizkreis' },
      {
        kind: 'overflow-valve',
        label: 'Überströmventil',
        optional: true,
        hinweis: 'Nur im Bedarfsfall, möglichst dicht an der Wärmeübergabe.',
      },
    ],
    trinkwasserzweig: trinkwasserSpeicher(),
    auslegung: [
      A_MINDESTVOLUMENSTROM,
      {
        groesse: 'Mindestvolumen Heizsystem',
        wert: '3 bis 5 l je kW Heizleistung der Wärmepumpe',
        quelle: BWP + ', Schema 1',
      },
      A_SPREIZUNG_PRIMAER,
      {
        groesse: 'Spreizung Heizungsseite',
        wert: '5 bis 7 K bei Heizleistung unter Auslegungsbedingungen',
        quelle: BWP + ', Schema 1',
      },
      A_SPREIZUNG_TWE,
      A_WT_FLAECHE,
      {
        groesse: 'Umwälzpumpe Heizung',
        wert: 'Druckverlust des ungünstigsten Flächenheizkreises, der Verteilleitungen, der Wärmepumpe und der Strangregulierventile; mit Überströmventil Konstant- oder Delta-p-konstant-Kennlinie',
        quelle: BWP + ', Schema 1',
      },
    ],
    herstellernamen: [
      { hersteller: 'Bosch', bezeichnung: 'Fußbodenheizung ohne Pufferspeicher (Kap. 4.2.1)', quelle: 'Bosch Compress 7000i AW, Planungsunterlage' },
      { hersteller: 'Ochsner', bezeichnung: 'Konfiguration -004: ohne Puffer, 1 direkter Heizkreis, Registerspeicher', quelle: 'Ochsner OTS-Schemenkatalog' },
      { hersteller: 'Stiebel Eltron', bezeichnung: 'Schaltplancode mit P1 = 0 (ohne Heizungspuffer), H1 = 1 (ungemischt)', quelle: 'Schaltplancode WP, Ausgabe VCT 08/26' },
      { hersteller: 'Hoval', bezeichnung: 'BBBAE020 — Sole/Wasser mit Wassererwärmung, ohne Pufferspeicher' },
      { hersteller: 'Viessmann', bezeichnung: 'Anlagenbeispiel 4742914_02 — monovalenter Speicher-Wassererwärmer, kein Puffer' },
    ],
    wissenIds: ['hyd-schema1-zulaessigkeit', 'hyd-schema1-komponenten', 'hyd-mindestanlagenvolumen', 'hyd-ueberstroemventil-einbauregeln', 'hyd-fbh-ungemischt-temperaturwaechter', 'hyd-wt-flaeche-trinkwasser'],
    quelle: BWP + ', Schema 1, S. 6 bis 7',
    url: BWP_URL,
    belastbarkeit: 'sekundaer',
  },

  // -------------------------------------------------------------------------
  // BWP-H-02 — derselbe eine Kreis, aber mit Reihenpuffer im Rücklauf. Das ist
  // der erste Fall, in dem Heizkörper zugelassen sind, und zugleich der in der
  // Einregulierung anspruchsvollste: der VdZ warnt ausdrücklich davor.
  // -------------------------------------------------------------------------
  {
    id: 'bwp-h-02-reihenpuffer',
    kennung: 'BWP-H-02',
    name: 'Wärmepumpe, ein ungemischter Heizkreis und Trinkwassererwärmung, mit Pufferspeicher in Reihe geschaltet',
    kurz: 'Ein ungemischter Kreis mit Reihenpuffer im Rücklauf, der das Mindestvolumen sicherstellt — auch für Heizkörpersysteme.',
    merkmale: {
      anbindung: 'reihenpuffer',
      trinkwasser: 'speicher',
      kreise: 1,
      gemischt: false,
      uebergabe: ['flaeche', 'heizkoerper'],
      bivalent: 'kein',
      kuehlung: 'keine',
      kaskade: false,
    },
    bedingungen: [
      {
        id: 'reihenpuffer-mit-ueberstroemventil',
        text: 'Ein Reihenspeicher ist nur in Verbindung mit einem Überströmventil eine zulässige Entkopplung; ein Überströmventil ohne Speicher ist es nicht.',
        beleg: 'VdZ-Leitfaden Umsteigen auf die Wärmepumpe, Kap. 1.4: die Trennung erfolgt durch einen Trennspeicher oder durch einen Reihenspeicher in Verbindung mit einem Überströmventil; Überströmventile ohne Speicher führen durch das fehlende Anlagenvolumen zu Betriebsstörungen.',
        art: 'hart',
      },
      {
        id: 'reihenpuffer-einregulierung',
        text: 'Auslegung und Einstellung sind anspruchsvoller als beim Trennspeicher; bevorzugt sollte auf Systemlösungen zurückgegriffen werden.',
        beleg: 'VdZ-Leitfaden Umsteigen auf die Wärmepumpe, Kap. 1.4, Warnung zum Reihenspeicher.',
        art: 'weich',
      },
      {
        id: 'ueberstroemventil-pumpenkennlinie',
        text: 'Die Heizkreispumpe ist auf Konstant- oder Delta-p-konstant-Kennlinie zu stellen; Delta-p variabel und Autoadapt sind mit Überströmventil unzulässig.',
        beleg: BWP + ', Schema 2, Zeile Überströmventil.',
        art: 'hart',
      },
      B_HERSTELLER_BINDEND,
    ],
    erzeugerkreis: [
      ...wpVorlauf(),
      ...umschaltventilWarmwasser(),
      {
        kind: 'overflow-valve',
        label: 'Überströmventil parallel zum Heizkreis',
        hinweis: 'Sichert bei geschlossenen Heizkreisen den Mindestvolumenstrom; gehört zur Reihenpufferlösung dazu.',
      },
      {
        kind: 'buffer',
        label: 'Reihenpufferspeicher im Rücklauf',
        entfaelltWennImGeraet: 'buffer',
        hinweis: 'Der Puffer liegt im Rücklauf des Sekundärkreises; das Wasser hat auf jeder Höhe dieselbe Temperatur.',
      },
      ...wpRuecklauf(),
    ],
    heizkreis: [
      { kind: 'sensor', label: 'Vorlauftemperaturfühler' },
      {
        kind: 'temperature-limiter',
        label: 'Maximaltemperaturwächter Flächenheizung',
        optional: true,
        hinweis: 'Zwingend beim ungemischten Flächenheizkreis; beim reinen Heizkörperkreis entfällt er.',
      },
      { kind: 'floor-loop', label: 'Wärmeübergabe (Heizfläche bzw. Heizkörper)' },
    ],
    trinkwasserzweig: trinkwasserSpeicher(),
    auslegung: [
      A_MINDESTVOLUMENSTROM,
      {
        groesse: 'Mindestvolumen Heizsystem',
        wert: 'wird durch den Pufferspeicher bereitgestellt',
        quelle: BWP + ', Schema 2',
      },
      A_SPREIZUNG_PRIMAER,
      A_SPREIZUNG_HEIZUNG,
      A_SPREIZUNG_TWE,
      A_PUFFER_LKW,
      A_WT_FLAECHE,
      {
        groesse: 'Überströmventil',
        wert: 'Mindestvolumenstrom bei Vollöffnung und geschlossenen Heizkreisen; vollständig geschlossen bei möglichst geringem Volumenstrom; Einbau möglichst dicht an der Wärmeübergabe',
        quelle: BWP + ', Schema 2',
      },
    ],
    herstellernamen: [
      { hersteller: 'Wolf', bezeichnung: 'Reihenspeicher, z. B. Zeichnung 32-52-006-406 „CHA 07/10, SEW-K-300/100, Reihenspeicher"' },
      { hersteller: 'Viessmann', bezeichnung: 'Reihenpuffer; bei Vitocal 250-A und 252-A sind 16 l bereits im Gerät integriert' },
      { hersteller: 'Stiebel Eltron', bezeichnung: 'Schaltplancode P1 = 6 (Puffer in Wärmepumpe integriert) beziehungsweise P1P2 = 13/15 (SBP 100)' },
      { hersteller: 'Weishaupt', bezeichnung: 'Aeroblock 1. Heizkreis — Plan 17 00 0 1 01 01 0 0 0' },
      { hersteller: 'Buderus', bezeichnung: 'Pufferprinzip „Pendel" (P50, Hydraulik-Nr. 6721863790) als verwandte Rücklaufanbindung' },
    ],
    wissenIds: ['hyd-reihenpuffer', 'hyd-reihenpuffer-bestand', 'hyd-puffervolumen-lkw', 'hyd-ueberstroemventil-einbauregeln', 'hyd-ueberstroemventil-herstellerpraxis', 'hyd-spreizung-auslegung'],
    quelle: BWP + ', Schema 2, S. 8 bis 9',
    url: BWP_URL,
    belastbarkeit: 'sekundaer',
  },

  // -------------------------------------------------------------------------
  // BWP-H-03 — das Referenzschema für die Sanierung und die Basisform, aus der
  // die Schemata 4, 5, 6, 10 und 11 durch Ergänzung entstehen. Hier tritt die
  // Pufferladepumpe an die Stelle der Heizungspumpe, und das Überströmventil
  // verschwindet: der Parallelpuffer übernimmt die Entkopplung.
  // -------------------------------------------------------------------------
  {
    id: 'bwp-h-03-parallelpuffer',
    kennung: 'BWP-H-03',
    name: 'Wärmepumpe, mehrere Heizkreise und Trinkwassererwärmung, mit parallelem Pufferspeicher',
    kurz: 'Das Referenzschema für die Sanierung: mehrere Heizkreise, gemischt und ungemischt, hydraulisch entkoppelt über einen Parallelpuffer.',
    merkmale: {
      anbindung: 'parallelpuffer',
      trinkwasser: 'speicher',
      kreise: 0,
      gemischt: true,
      uebergabe: ['flaeche', 'heizkoerper'],
      bivalent: 'kein',
      kuehlung: 'keine',
      kaskade: false,
    },
    bedingungen: [
      {
        id: 'puffer-vier-anschluesse',
        text: 'Der Puffer wird parallel mit vier Anschlüssen eingebunden: Wärmepumpenvorlauf oben, Wärmepumpenrücklauf unten, Heizungsvorlauf oben, Heizungsrücklauf unten.',
        beleg: BWP + ', Schema 3, Zeichnung S. 10.',
        art: 'hart',
      },
      {
        id: 'eigene-pufferladepumpe',
        text: 'Der Parallelpuffer braucht eine eigene Pufferladepumpe zusätzlich zu den Heizkreispumpen.',
        beleg: BWP + ', Schema 3, Zeile Umwälzpumpe Pufferladung; gleichlautend in den Planungsunterlagen von Viessmann.',
        art: 'hart',
      },
      {
        id: 'trinkwasser-vor-dem-puffer',
        text: 'Die Trinkwasserladung wird vor dem Puffer direkt am Gerät abgezweigt.',
        beleg: BWP + ', Schema 3, Zeichnung: das Umschaltventil sitzt im Erzeugervorlauf vor dem Pufferanschluss.',
        art: 'hart',
      },
      {
        id: 'kein-ueberstroemventil',
        text: 'Ein Überströmventil ist hier nicht vorgesehen.',
        beleg: BWP + ', Schema 3: die Auslegungstabelle führt keine Zeile Überströmventil mehr — der Parallelpuffer übernimmt die Entkopplung.',
        art: 'weich',
      },
      B_HERSTELLER_BINDEND,
    ],
    erzeugerkreis: [
      ...wpVorlauf(),
      ...umschaltventilWarmwasser(),
      { kind: 'shutoff', label: 'Absperrventil vor dem Puffer' },
      { kind: 'buffer', label: 'Parallelpufferspeicher, Vorlaufanschluss oben', entfaelltWennImGeraet: 'buffer' },
      { kind: 'sensor', label: 'Pufferfühler oben' },
      ...wpRuecklauf(),
    ],
    heizkreis: [
      { kind: 'shutoff', label: 'Absperrventil Heizkreis' },
      {
        kind: 'valve-3way',
        label: 'Dreiwege-Mischer, motorisch',
        optional: true,
        hinweis: 'Nur im gemischten Kreis. Der Leitfaden zeichnet ungemischte und gemischte Kreise nebeneinander (Abschnitt 1.4). Ein Mischer erhöht die Vorlauftemperatur der Wärmepumpe und ist nur zu setzen, wo er zwingend ist.',
      },
      { kind: 'pump', label: 'Umwälzpumpe Heizkreis' },
      { kind: 'check-valve', label: 'Rückschlagklappe' },
      { kind: 'sensor', label: 'Vorlauftemperaturfühler' },
      {
        kind: 'temperature-limiter',
        label: 'Maximaltemperaturwächter Flächenheizung',
        optional: true,
        hinweis: 'Zwingend am ungemischten Flächenheizkreis.',
      },
      { kind: 'floor-loop', label: 'Wärmeübergabe (Heizfläche bzw. Heizkörper)' },
    ],
    trinkwasserzweig: trinkwasserSpeicher(),
    auslegung: [
      A_MINDESTVOLUMENSTROM,
      {
        groesse: 'Mindestvolumen Heizsystem',
        wert: 'wird durch den Pufferspeicher bereitgestellt',
        quelle: BWP + ', Schema 3',
      },
      A_SPREIZUNG_PRIMAER,
      {
        groesse: 'Volumenstrom zum Pufferspeicher',
        wert: 'Spreizung 5 bis 7 K bei Heizleistung unter Auslegungsbedingungen; für statische Heizflächen bis maximal 10 K',
        quelle: BWP + ', Schema 3',
      },
      A_SPREIZUNG_TWE,
      A_PUFFER_LKW,
      A_WT_FLAECHE,
      {
        groesse: 'Umwälzpumpe Pufferladung',
        wert: 'Druckverlust der Verteilleitungen, der Wärmepumpe und weiterer Einzelwiderstände; Wärmeträger in der Regel Wasser',
        quelle: BWP + ', Schema 3',
      },
    ],
    herstellernamen: [
      { hersteller: 'Buderus', bezeichnung: 'Pufferprinzip „Parallel", z. B. Hydraulik-Nr. 6721847240 (WLW176i/186i AR E, P…5)' },
      { hersteller: 'Wolf', bezeichnung: 'Trennspeicher, z. B. Zeichnung 32-52-006-262 „CHA-07/10, SEW, Trennspeicher" mit Direkt- und Mischerkreis' },
      { hersteller: 'Viessmann', bezeichnung: 'Heizwasser-Pufferspeicher, z. B. Anlagenbeispiel 4805622_07' },
      { hersteller: 'Ochsner', bezeichnung: 'Konfiguration -011: mit Pufferspeicher, 2 Heizkreise, Registerspeicher' },
      { hersteller: 'Stiebel Eltron', bezeichnung: 'Schaltplancode P1 = 1 (Pufferspeicher Typ SBP), W1 = 1 (SBB), H1/H2 nach Kreisart' },
      { hersteller: 'NIBE', bezeichnung: 'Trennspeicher UKV, z. B. PL4.126 „F/S2XXX VVM S320 UKV"' },
      { hersteller: 'Bosch', bezeichnung: 'Anlagenbeispiel 3.10 — Inneneinheit AWE, Puffer BH…, Warmwasserspeicher WH…' },
    ],
    wissenIds: ['hyd-parallelpuffer', 'hyd-puffervolumen-lkw', 'hyd-spreizung-auslegung', 'hyd-mischer-nur-wenn-noetig', 'hyd-mischer-zwingend', 'hyd-trinkwasser-umschaltventil-ladepumpe', 'hyd-wt-flaeche-trinkwasser'],
    quelle: BWP + ', Schema 3, S. 10 bis 11',
    url: BWP_URL,
    belastbarkeit: 'sekundaer',
  },

  // -------------------------------------------------------------------------
  // BWP-H-04 — Schema 3 plus Solarthermie. Konstitutiv ist die Trennung
  // zwischen Gesamtvolumen (kommt aus der Solarplanung und ist aus der
  // Wärmepumpenleistung nicht ableitbar) und Bereitschaftsteil (bemaßt).
  // -------------------------------------------------------------------------
  {
    id: 'bwp-h-04-parallelpuffer-solar',
    kennung: 'BWP-H-04',
    name: 'Wärmepumpe, mehrere Heizkreise und Trinkwassererwärmung, mit parallelem Pufferspeicher und solarer Einkoppelung',
    kurz: 'Wie Schema 3, zusätzlich mit einem Solarkreis, der über einen eigenen Wärmeübertrager in den unteren Speicherbereich einkoppelt.',
    merkmale: {
      anbindung: 'parallelpuffer',
      trinkwasser: 'speicher',
      kreise: 0,
      gemischt: true,
      uebergabe: ['flaeche', 'heizkoerper'],
      bivalent: 'solar',
      kuehlung: 'keine',
      kaskade: false,
    },
    bedingungen: [
      {
        id: 'solarvolumen-ist-eingabe',
        text: 'Das Gesamtvolumen des Puffers folgt der Planung der Solaranlage und ist keine aus der Wärmepumpenleistung ableitbare Größe.',
        beleg: BWP + ', Schema 4, Zeile Pufferspeicher Gesamtvolumen: nach Planung der Solaranlage, also nach Art, Größe und Ausrichtung der Kollektoren. Für ein Auslegungswerkzeug ist das ein Eingabewert von außen.',
        art: 'hart',
      },
      {
        id: 'bereitschaftsteil-bemessen',
        text: 'Der Bereitschaftsteil des Puffers wird nach der Wärmepumpe bemessen, nicht nach der Solaranlage.',
        beleg: BWP + ', Schema 4, Zeile Pufferspeicher Bereitschaftsteil: 20 bis 25 l je kW zur Laufzeitoptimierung, 30 bis 40 l je kW zur Überbrückung von Sperrzeiten.',
        art: 'hart',
      },
      {
        id: 'solarkreis-nicht-bemasst',
        text: 'Der Solarkreis selbst ist im Leitfaden nicht bemaßt.',
        beleg: BWP + ', Schema 4: der Solarkreis mit Solarkreispumpe und Solarregler ist gezeichnet, aber ohne Auslegungswerte.',
        art: 'weich',
      },
      B_HERSTELLER_BINDEND,
    ],
    erzeugerkreis: [
      ...wpVorlauf(),
      ...umschaltventilWarmwasser(),
      { kind: 'shutoff', label: 'Absperrventil vor dem Puffer' },
      { kind: 'buffer', label: 'Parallelpufferspeicher mit Solar-Wärmeübertrager im unteren Bereich', entfaelltWennImGeraet: 'buffer' },
      { kind: 'sensor', label: 'Pufferfühler oben' },
      {
        kind: 'solar',
        label: 'Solarkollektorfeld mit Solarkreispumpe und Solarregler',
        hinweis: 'Koppelt über einen eigenen Wärmeübertrager in den unteren Speicherbereich ein; im Leitfaden nicht bemaßt.',
      },
      ...wpRuecklauf(),
    ],
    heizkreis: [
      { kind: 'shutoff', label: 'Absperrventil Heizkreis' },
      { kind: 'valve-3way', label: 'Dreiwege-Mischer, motorisch', optional: true, hinweis: 'Nur im gemischten Kreis.' },
      { kind: 'pump', label: 'Umwälzpumpe Heizkreis' },
      { kind: 'check-valve', label: 'Rückschlagklappe' },
      { kind: 'sensor', label: 'Vorlauftemperaturfühler' },
      { kind: 'temperature-limiter', label: 'Maximaltemperaturwächter Flächenheizung', optional: true },
      { kind: 'floor-loop', label: 'Wärmeübergabe (Heizfläche bzw. Heizkörper)' },
    ],
    trinkwasserzweig: trinkwasserSpeicher(),
    auslegung: [
      A_MINDESTVOLUMENSTROM,
      A_SPREIZUNG_PRIMAER,
      A_SPREIZUNG_HEIZUNG,
      A_SPREIZUNG_TWE,
      {
        groesse: 'Pufferspeicher Gesamtvolumen',
        wert: 'nach Planung der Solaranlage (Art, Größe und Ausrichtung der Kollektoren)',
        quelle: BWP + ', Schema 4',
      },
      {
        groesse: 'Pufferspeicher Bereitschaftsteil',
        wert: 'zur Laufzeitoptimierung 20 bis 25 l je kW maximaler Heizleistung der Wärmepumpe; zur Überbrückung von Sperrzeiten 30 bis 40 l je kW',
        quelle: BWP + ', Schema 4',
      },
      A_WT_FLAECHE,
    ],
    herstellernamen: [
      { hersteller: 'Wolf', bezeichnung: 'Solar mit Trennspeicher, z. B. Zeichnungen 32-52-006-098 bis -104 (solare Brauchwasserbereitung, teils Heizungsunterstützung)' },
      { hersteller: 'Buderus', bezeichnung: 'Hydraulik-Nr. 6721847261 — P120.5 parallel, SMH…1 ES, solare Warmwasserbereitung' },
      { hersteller: 'Bosch', bezeichnung: 'Anlagenbeispiel 3.18 — Inneneinheit AWE, Puffer BH…, bivalenter Warmwasserspeicher WPS…-1 EP, solar' },
      { hersteller: 'Weishaupt', bezeichnung: 'Split Solar Warmwasser — Plan 15 00 1 1 04 01 0 0 0' },
      { hersteller: 'NIBE', bezeichnung: 'PL4.136 „F/S2XXX VVM S320 Solar" beziehungsweise PL4.151 mit Solarspeicher AHPS' },
      { hersteller: 'Stiebel Eltron', bezeichnung: 'Schaltplancode F2 = 1 oder 2 (solare Warmwasserbereitung, mit Heizungsunterstützung)' },
    ],
    wissenIds: ['hyd-parallelpuffer', 'hyd-puffervolumen-lkw', 'hyd-mischer-zwingend', 'hyd-spreizung-auslegung'],
    quelle: BWP + ', Schema 4, S. 12 bis 13',
    url: BWP_URL,
    belastbarkeit: 'sekundaer',
  },

  // -------------------------------------------------------------------------
  // BWP-H-05 — bivalent mit Gas- oder Ölkessel. Die entscheidende Aussage
  // steckt nicht in der Tabelle, sondern in der Zeichnung: der Kessel speist
  // hinter dem Puffer in den gemeinsamen Vorlauf ein, damit die Kesselwärme
  // nicht ins Puffervolumen der Wärmepumpe gerät.
  // -------------------------------------------------------------------------
  {
    id: 'bwp-h-05-bivalent-kessel',
    kennung: 'BWP-H-05',
    name: 'Wärmepumpe, mehrere Heizkreise und Trinkwassererwärmung, mit parallelem Pufferspeicher im bivalenten System mit Gas- oder Ölkessel',
    kurz: 'Hybridanlage aus Wärmepumpe und fossilem Kessel; der Puffer hängt allein am Wärmepumpenzweig, der Kessel speist dahinter in den Vorlauf ein.',
    merkmale: {
      anbindung: 'parallelpuffer',
      trinkwasser: 'speicher',
      kreise: 2,
      gemischt: true,
      uebergabe: ['flaeche', 'heizkoerper'],
      bivalent: 'kessel',
      kuehlung: 'keine',
      kaskade: false,
    },
    bedingungen: [
      {
        id: 'kessel-hinter-den-puffer',
        text: 'Der Kessel speist nicht in den Puffer, sondern hinter dem Puffer in den gemeinsamen Heizungsvorlauf ein.',
        beleg: BWP + ', Schema 5, Zeichnung S. 14: der Puffer wird ausschließlich von der Wärmepumpe beladen; damit bleibt die Kesselwärme aus dem Wärmepumpenvolumen heraus und der Puffer wird nicht auf Kesselniveau hochgeheizt.',
        art: 'hart',
      },
      {
        id: 'kessel-eigenes-mag',
        text: 'Der Kessel führt ein eigenes Membran-Ausdehnungsgefäß.',
        beleg: BWP + ', Schema 5, Zeichnung S. 14.',
        art: 'hart',
      },
      {
        id: 'zwei-waermeuebertrager-im-speicher',
        text: 'Der Trinkwassererwärmer hat zwei Wärmeübertrager: die Wärmepumpe bedient den unteren, der Kessel über einen eigenen Ladekreis den oberen.',
        beleg: BWP + ', Schema 5, Zeichnung S. 14: der Kessel speist über einen eigenen Ladekreis mit eigener Pumpe und Rückschlagklappe den oberen Wärmeübertrager.',
        art: 'hart',
      },
      {
        id: 'kesselgroesse-nach-betriebsweise',
        text: 'Die Kesselgröße folgt der Betriebsweise: bivalent-alternativ und bivalent-teilparallel decken mit dem Kessel die gesamte Heizlast, bivalent-parallel deckt die Summe beider Erzeuger die Heizlast.',
        beleg: BWP + ', Schema 5, Zeile bivalenter Wärmeerzeuger.',
        art: 'hart',
      },
      {
        id: 'redaktionsfehler-festbrennstoff',
        text: 'Die Zeile zum Trinkwassererwärmer der Ausgabe 2023 nennt irrtümlich den Festbrennstoff-Wärmeerzeuger; gemeint ist der fossile Wärmeerzeuger.',
        beleg: 'Dokumentierter Redaktionsfehler: die Ausgabe Juli 2016 formuliert an derselben Stelle korrekt „fossilen Wärmeerzeuger". Für die Auslegung ist die Fassung 2016 sinngemäß zu verwenden.',
        art: 'weich',
      },
      B_HERSTELLER_BINDEND,
    ],
    erzeugerkreis: [
      ...wpVorlauf(),
      {
        kind: 'valve-diverter',
        label: 'Dreiwege-Umschaltventil Heizung/Warmwasser',
        optional: true,
        entfaelltWennImGeraet: 'diverter',
        hinweis: 'Im Schema 5 grau gezeichnet, also wahlweise verwendbar.',
      },
      { kind: 'buffer', label: 'Parallelpufferspeicher, nur von der Wärmepumpe beladen', entfaelltWennImGeraet: 'buffer' },
      { kind: 'boiler', label: 'Gas- oder Ölkessel' },
      { kind: 'pump', label: 'Umwälzpumpe Kesselkreis', optional: true, hinweis: 'Im Schema grau gezeichnet.' },
      { kind: 'check-valve', label: 'Rückschlagklappe Kesselkreis', optional: true, hinweis: 'Im Schema grau gezeichnet.' },
      {
        kind: 'valve-3way',
        label: 'Motorischer Dreiwege-Mischer mit Beimischstrecke',
        hinweis: 'In der Beimischstrecke ist ein weiteres, grau gezeichnetes Bauteil dargestellt; eine benannte Zuordnung ist aus dem Leitfaden nicht belegbar.',
      },
      { kind: 'sensor', label: 'Vorlauftemperaturfühler Kesseleinspeisung' },
      { kind: 'expansion-vessel', label: 'Membran-Ausdehnungsgefäß des Kessels' },
      { kind: 'node', label: 'Gemeinsamer Heizungsvorlauf hinter dem Puffer' },
      ...wpRuecklauf(),
    ],
    heizkreis: [
      { kind: 'shutoff', label: 'Absperrventil Heizkreis' },
      { kind: 'valve-3way', label: 'Dreiwege-Mischer, motorisch' },
      { kind: 'pump', label: 'Umwälzpumpe Heizkreis' },
      { kind: 'check-valve', label: 'Rückschlagklappe' },
      { kind: 'sensor', label: 'Vorlauftemperaturfühler' },
      { kind: 'floor-loop', label: 'Wärmeübergabe (Heizfläche bzw. Heizkörper)' },
    ],
    trinkwasserzweig: [
      { kind: 'shutoff', label: 'Absperrventil Trinkwasserzweig' },
      { kind: 'cylinder', label: 'Trinkwassererwärmer mit zwei Wärmeübertragern', entfaelltWennImGeraet: 'cylinder' },
      { kind: 'pump', label: 'Ladepumpe Kessel zum oberen Wärmeübertrager' },
      { kind: 'check-valve', label: 'Rückschlagklappe im Kessel-Ladekreis' },
      { kind: 'sensor', label: 'Speichertemperaturfühler' },
      { kind: 'safety-valve', label: 'Kaltwasser-Sicherheitsgruppe Trinkwasser', hinweis: 'Im BWP-Schema nicht gezeichnet; in der ZVSHK-Darstellung ausdrücklich geführt.' },
      { kind: 'circulation-pump', label: 'Zirkulationspumpe PWH-C', optional: true },
    ],
    auslegung: [
      A_MINDESTVOLUMENSTROM,
      A_SPREIZUNG_PRIMAER,
      A_SPREIZUNG_HEIZUNG,
      A_SPREIZUNG_TWE,
      A_PUFFER_LKW,
      A_WT_FLAECHE,
      {
        groesse: 'Bivalenter Wärmeerzeuger, bivalent-alternativ und bivalent-teilparallel',
        wert: 'der Kessel deckt die gesamte Heizlast des Hauses',
        quelle: BWP + ', Schema 5, S. 15',
      },
      {
        groesse: 'Bivalenter Wärmeerzeuger, bivalent-parallel',
        wert: 'die Summe aus Wärmepumpe und zweitem Wärmeerzeuger deckt die gesamte Heizlast des Gebäudes',
        quelle: BWP + ', Schema 5, S. 15',
      },
    ],
    herstellernamen: [
      { hersteller: 'Bosch', bezeichnung: 'Anlagenbeispiel 3.12 und 3.13 — Inneneinheit AWB mit Gas-Brennwertgerät' },
      { hersteller: 'Buderus', bezeichnung: 'Hydraulik-Nr. 6721847263 — WLW186i/176i E mit Logamax plus bis 50 kW' },
      { hersteller: 'Vaillant', bezeichnung: 'Systemschema-Code 9, 10, 12 oder 13 (Hybridsystem mit externem Zusatzheizgerät)' },
      { hersteller: 'Viessmann', bezeichnung: 'Hybridschemata Vitocal 250-AH und 250-SH mit Vitodens 200-W oder 300-W' },
      { hersteller: 'Weishaupt', bezeichnung: 'Bivalenter Betrieb — Plan 15 12 0 4 01 01 0 0 1 (Split) beziehungsweise 17 10 0 4 01 03 0 0 0 (Aeroblock)' },
      { hersteller: 'Stiebel Eltron', bezeichnung: 'Schaltplancode K1 = 1 (Heizkessel Öl/Gas) oder K1 = 2 (Therme Öl/Gas)' },
      { hersteller: 'LG', bezeichnung: 'A6 — Wärmepumpe und fossiler Kessel, 2 Heizkreise, Warmwasser' },
    ],
    wissenIds: ['hyd-bivalenz-beimischung', 'hyd-bivalenz-festbrennstoff', 'hyd-parallelpuffer', 'hyd-puffervolumen-lkw', 'hyd-mischer-zwingend'],
    quelle: BWP + ', Schema 5, S. 14 bis 15',
    url: BWP_URL,
    belastbarkeit: 'sekundaer',
  },

  // -------------------------------------------------------------------------
  // BWP-H-06 — bivalent mit Festbrennstoff. Das einzige Schema mit einer
  // Vorrangregel bei der Speicherdimensionierung: der Biomassekessel bestimmt
  // das Puffervolumen, die Wärmepumpenregel greift nur ersatzweise. Und das
  // einzige mit der harten Pflicht zu durchgängig gemischten Heizkreisen.
  // -------------------------------------------------------------------------
  {
    id: 'bwp-h-06-bivalent-festbrennstoff',
    kennung: 'BWP-H-06',
    name: 'Wärmepumpe, mehrere Heizkreise und Trinkwassererwärmung, mit parallelem Pufferspeicher im bivalenten System mit Festbrennstoff',
    kurz: 'Wärmepumpe zusammen mit einem Festbrennstoffkessel; alle Heizkreise sind gemischt, der Kessel braucht Rücklaufanhebung und thermische Ablaufsicherung.',
    merkmale: {
      anbindung: 'parallelpuffer',
      trinkwasser: 'speicher',
      kreise: 0,
      gemischt: true,
      uebergabe: ['flaeche', 'heizkoerper'],
      bivalent: 'festbrennstoff',
      kuehlung: 'keine',
      kaskade: false,
    },
    bedingungen: [
      {
        id: 'alle-kreise-gemischt',
        text: 'Alle Heizkreise müssen als gemischte Heizkreise ausgeführt werden.',
        beleg: BWP + ', Schema 6, Zeile Heizkreise. Das schützt die Flächenheizung vor der hohen Vorlauftemperatur des Kessels.',
        art: 'hart',
      },
      {
        id: 'thermische-ablaufsicherung',
        text: 'Der Festbrennstoffkessel braucht eine thermische Ablaufsicherung.',
        beleg: BWP + ', Schema 6, Zeile bivalenter Wärmeerzeuger.',
        art: 'hart',
      },
      {
        id: 'ruecklauftemperaturanhebung',
        text: 'Eine Rücklauftemperaturanhebung ist erforderlich.',
        beleg: BWP + ', Schema 6, Zeile bivalenter Wärmeerzeuger; im Schema als Dreiwege-Mischer mit Beimischung gezeichnet.',
        art: 'hart',
      },
      {
        id: 'autarke-regelung',
        text: 'Der Festbrennstoffkessel führt eine autarke Regelung.',
        beleg: BWP + ', Schema 6, Zeile bivalenter Wärmeerzeuger.',
        art: 'hart',
      },
      {
        id: 'nicht-absperrbarer-verteilkreis',
        text: 'Der Festbrennstoffkessel muss einen Heizverteilungskreis haben, der nicht absperrbar ist.',
        beleg: 'DIN EN 12828, wiedergegeben über Sekundärquellen (IKZ). Der Normtext selbst ist kostenpflichtig und wurde nicht eingesehen.',
        art: 'hart',
      },
      {
        id: 'puffer-vorrang-kessel',
        text: 'Das Puffervolumen richtet sich vorrangig nach der Leistung des Biomassekessels, erst ersatzweise nach der Wärmepumpe.',
        beleg: BWP + ', Schema 6, Zeile Pufferspeicher: 30 l je kW bei Pellets oder Hackschnitzeln, 55 l je kW bei Scheitholz.',
        art: 'hart',
      },
      {
        id: 'kaminofen-nur-mittelbar',
        text: 'Ein Kaminofen mit Wassertasche fällt sachlich unter dieses Schema, wird vom Leitfaden aber nicht ausdrücklich genannt.',
        beleg: 'Ableitung: In keiner der ausgewerteten herstellerneutralen Quellen wird ein wasserführender Kaminofen als eigener Anwendungsfall benannt. Ob die Vorrangregel 55 l je kW Scheitholz auf ihn anzuwenden ist, ist nicht belegbar — der Leitfaden nennt ausdrücklich den Biomassekessel.',
        art: 'weich',
      },
      B_HERSTELLER_BINDEND,
    ],
    erzeugerkreis: [
      ...wpVorlauf(),
      ...umschaltventilWarmwasser(),
      { kind: 'buffer', label: 'Parallelpufferspeicher', entfaelltWennImGeraet: 'buffer' },
      { kind: 'boiler', label: 'Festbrennstoffkessel (Pellets, Hackschnitzel oder Scheitholz)' },
      { kind: 'safety-valve', label: 'Thermische Ablaufsicherung am Kessel', hinweis: 'Eigenes Bauteil ohne eigenen Symboltyp; hier unter der Sicherheitsarmatur geführt.' },
      { kind: 'pump', label: 'Umwälzpumpe Kesselkreis' },
      { kind: 'check-valve', label: 'Rückschlagklappe Kesselkreis' },
      { kind: 'valve-3way', label: 'Rücklauftemperaturanhebung, Dreiwege-Mischer mit Beimischung' },
      { kind: 'expansion-vessel', label: 'Membran-Ausdehnungsgefäß des Kessels' },
      { kind: 'node', label: 'Gemeinsamer Heizungsvorlauf hinter dem Puffer' },
      ...wpRuecklauf(),
    ],
    heizkreis: [
      { kind: 'shutoff', label: 'Absperrventil Heizkreis' },
      { kind: 'valve-3way', label: 'Dreiwege-Mischer, motorisch' },
      { kind: 'pump', label: 'Umwälzpumpe Heizkreis' },
      { kind: 'check-valve', label: 'Rückschlagklappe' },
      { kind: 'sensor', label: 'Vorlauftemperaturfühler' },
      { kind: 'floor-loop', label: 'Wärmeübergabe (Heizfläche bzw. Heizkörper)' },
    ],
    trinkwasserzweig: trinkwasserSpeicher(),
    auslegung: [
      A_MINDESTVOLUMENSTROM,
      A_SPREIZUNG_PRIMAER,
      A_SPREIZUNG_HEIZUNG,
      A_SPREIZUNG_TWE,
      {
        groesse: 'Pufferspeicher, vorrangig nach dem Biomassekessel',
        wert: '30 l je kW bei Pellets oder Hackschnitzeln; 55 l je kW bei Scheitholz',
        quelle: BWP + ', Schema 6, S. 17',
      },
      {
        groesse: 'Pufferspeicher, ersatzweise nach der Wärmepumpe',
        wert: 'zur Laufzeitoptimierung 20 bis 25 l je kW; zur Überbrückung von Sperrzeiten 30 bis 40 l je kW',
        quelle: BWP + ', Schema 6, S. 17',
      },
      {
        groesse: 'Trinkwassererwärmer',
        wert: 'Wärmeübertragerfläche mindestens 0,25 m² je kW; keine Anforderungen bei ausschließlicher Trinkwassererwärmung durch den Festbrennstoff-Wärmeerzeuger',
        quelle: BWP + ', Schema 6, S. 17',
      },
    ],
    herstellernamen: [
      { hersteller: 'Wolf', bezeichnung: 'Holzkessel FFS unter 14 kW, z. B. Zeichnung 32-52-006-263 „CHA-07/10, FFS < 14 kW, SEW, Trennspeicher"' },
      { hersteller: 'Buderus', bezeichnung: 'Hydraulik-Nr. 6721847262 (Kaminofen, PNR parallel, zwei gemischte Heizkreise) und 6721863884/-885 (Scheitholz-Kaminofen, Pelletofen)' },
      { hersteller: 'Bosch', bezeichnung: 'Dok. 6721896981 — Compress CS8800iAW AWEi D mit Scheitholz-Kaminofen, Frischwasserstation' },
      { hersteller: 'NIBE', bezeichnung: 'PL4.119 „F/S2XXX VVM 500 Kamin/Feststoffkessel"' },
      { hersteller: 'Stiebel Eltron', bezeichnung: 'Schaltplancode K1 = 3 (Feststoffkessel)' },
      { hersteller: 'Weishaupt', bezeichnung: 'regenerativer Betrieb — Plan 17 00 3 1 06 01 0 0 0 (Aeroblock)' },
    ],
    wissenIds: ['hyd-bivalenz-festbrennstoff', 'hyd-mischer-zwingend', 'hyd-parallelpuffer', 'hyd-puffervolumen-lkw', 'hyd-pflichtarmaturen-12828'],
    quelle: BWP + ', Schema 6, S. 16 bis 17',
    url: BWP_URL,
    belastbarkeit: 'sekundaer',
  },

  // -------------------------------------------------------------------------
  // BWP-H-07 — Kombipuffer mit Frischwasserstation, das einzige Schema ohne
  // separaten Trinkwarmwasserspeicher. Der Faktor 1,1 ist der einzige
  // Umrechnungsfaktor des ganzen Leitfadens.
  // -------------------------------------------------------------------------
  {
    id: 'bwp-h-07-kombispeicher-frischwasser',
    kennung: 'BWP-H-07',
    name: 'Wärmepumpe, mehrere Heizkreise und Trinkwassererwärmung, mit parallelem Kombipufferspeicher',
    kurz: 'Ein geschichteter Kombispeicher übernimmt Heizung und Trinkwasserbereitschaft, das Trinkwasser wird über eine Frischwasserstation im Durchfluss erwärmt.',
    merkmale: {
      anbindung: 'kombispeicher',
      trinkwasser: 'frischwasser',
      kreise: 0,
      gemischt: true,
      uebergabe: ['flaeche', 'heizkoerper'],
      bivalent: 'kein',
      kuehlung: 'keine',
      kaskade: false,
    },
    bedingungen: [
      {
        id: 'alle-kreise-gemischt-kombi',
        text: 'Alle Heizkreise müssen als gemischte Heizkreise ausgeführt werden.',
        beleg: BWP + ', Schema 7, Zeile Heizkreise. Der Speicher wird auf dem Temperaturniveau der Trinkwassererwärmung gefahren.',
        art: 'hart',
      },
      {
        id: 'kein-separater-tw-speicher',
        text: 'Ein separater Trinkwarmwasserspeicher entfällt.',
        beleg: BWP + ', Auswahlmatrix S. 5: Schema 7 ist das einzige mit Kombipufferspeicher und Frischwasserstation und ohne Trinkwarmwasserspeicher.',
        art: 'hart',
      },
      {
        id: 'faktor-11',
        text: 'Das Heizungswasservolumen für die Trinkwassererwärmung ist rund 10 Prozent größer als der gleichwertige Trinkwasserspeicher.',
        beleg: BWP + ', Schema 7, Zeile Pufferspeicher: Volumen für die Trinkwassererwärmung etwa 1,1 mal Trinkwasserspeichergröße. Das Gesamtvolumen ist dieser Anteil zuzüglich des Heizungspufferanteils.',
        art: 'hart',
      },
      {
        id: 'solar-alternativ',
        text: 'Eine Solarthermieanlage ist in dieses Schema alternativ einkoppelbar.',
        beleg: BWP + ', Auswahlmatrix S. 5: Schema 7 führt neben Kombipufferspeicher und Frischwasserstation auch Solarthermie. Der Leitfaden hält außerdem fest, dass Kombinationen über die dargestellten hinaus möglich sind.',
        art: 'weich',
      },
      B_HERSTELLER_BINDEND,
    ],
    erzeugerkreis: [
      ...wpVorlauf(),
      ...umschaltventilWarmwasser(),
      {
        kind: 'buffer',
        label: 'Kombipufferspeicher, geschichtet beladen',
        entfaelltWennImGeraet: 'buffer',
        hinweis: 'Oberer Bereich Trinkwasserbereitschaft, unterer Bereich Heizung.',
      },
      { kind: 'sensor', label: 'Speicherfühler oben' },
      ...wpRuecklauf(),
    ],
    heizkreis: [
      { kind: 'shutoff', label: 'Absperrventil Heizkreis' },
      { kind: 'valve-3way', label: 'Dreiwege-Mischer, motorisch' },
      { kind: 'pump', label: 'Umwälzpumpe Heizkreis' },
      { kind: 'check-valve', label: 'Rückschlagklappe' },
      { kind: 'sensor', label: 'Vorlauftemperaturfühler' },
      { kind: 'floor-loop', label: 'Wärmeübergabe (Heizfläche bzw. Heizkörper)' },
    ],
    trinkwasserzweig: [
      {
        kind: 'freshwater',
        label: 'Frischwasserstation am oberen Speicherbereich',
        hinweis: 'Erwärmt das Trinkwasser im Durchfluss; kalt PWC hinein, warm PWH hinaus.',
      },
      { kind: 'sensor', label: 'Temperaturfühler Frischwasserstation' },
      { kind: 'backflow-preventer', label: 'Rückflussverhinderer in der Kaltwasserzuleitung' },
      { kind: 'circulation-pump', label: 'Zirkulationspumpe PWH-C', optional: true },
    ],
    auslegung: [
      A_MINDESTVOLUMENSTROM,
      A_SPREIZUNG_PRIMAER,
      A_SPREIZUNG_HEIZUNG,
      A_SPREIZUNG_TWE,
      {
        groesse: 'Kombipuffer, Volumen für die Trinkwassererwärmung',
        wert: 'etwa 1,1 mal die gleichwertige Trinkwasserspeichergröße',
        quelle: BWP + ', Schema 7, S. 19',
      },
      {
        groesse: 'Kombipuffer, Heizungsanteil',
        wert: 'zur Laufzeitoptimierung 20 bis 25 l je kW; zur Überbrückung von Sperrzeiten 30 bis 40 l je kW',
        quelle: BWP + ', Schema 7, S. 19',
      },
      {
        groesse: 'Kombipufferspeicher mit Trinkwasserbereitung, Mindestwert',
        wert: 'mindestens 30 l je kW Nennwärmeleistung',
        quelle: BWP + ', durchgängige Angabe zu den Puffer-Schemata',
      },
    ],
    herstellernamen: [
      { hersteller: 'Wolf', bezeichnung: 'SPU-2-Plus mit Frischwasserstation FWS-2-80, z. B. Zeichnung 32-52-006-268' },
      { hersteller: 'Buderus', bezeichnung: 'Kombi-Wärmespeicher BPU (Hydraulik-Nr. 6721863789) beziehungsweise FS20/2 mit PR…6 E (6721847260)' },
      { hersteller: 'Bosch', bezeichnung: 'Anlagenbeispiel 3.22 (Kombi-Wärmespeicher BPU) und 3.16 (Puffer BH… ERZ mit Frischwasserstation FF 20)' },
      { hersteller: 'Weishaupt', bezeichnung: 'Kombispeicher WKS — Plan 17 00 0 1 11 01 0 0 0 (Aeroblock) und 18 00 0 1 11 01 0 0 0 (Biblock)' },
      { hersteller: 'Viessmann', bezeichnung: 'Heizwasser-Pufferspeicher mit Frischwasser-Modul, z. B. Anlagenbeispiel 4742917_02 oder Vitocell 120-E mit Vitotrans 353' },
      { hersteller: 'Stiebel Eltron', bezeichnung: 'Schaltplancode P1 = 2 (Hygienespeicher SBS) beziehungsweise W1W2 = 53 (Frischwasserstation)' },
      { hersteller: 'Ochsner', bezeichnung: 'Konfiguration -012 (Unifresh als Kombispeicher) und -016 (Puffer als Kombispeicher mit Frischwassermodul)' },
      { hersteller: 'Daikin', bezeichnung: 'ECH2O — Hygiene-Warmwasserspeicher nach dem Frischwasserprinzip' },
      { hersteller: 'NIBE', bezeichnung: 'PL4.174 „F/S2XXX UKV MTL-ZW" mit Frischwasserstation MTL-ZW' },
    ],
    wissenIds: ['hyd-mischer-zwingend', 'hyd-puffervolumen-lkw', 'hyd-legionellen-w551', 'hyd-zirkulation-grenzen', 'hyd-spreizung-auslegung'],
    quelle: BWP + ', Schema 7, S. 18 bis 19',
    url: BWP_URL,
    belastbarkeit: 'sekundaer',
  },

  // -------------------------------------------------------------------------
  // BWP-H-08 — passive Kühlung über die Wärmequelle. Die drei harten
  // Quellengrenzwerte sind für ein Auslegungswerkzeug wichtiger als die
  // Hydraulik: 20 Grad Schluckbrunnen, 75 Prozent bei 300 h Volllast an der
  // Erdsonde, und kein Flächenkollektor.
  // -------------------------------------------------------------------------
  {
    id: 'bwp-h-08-passive-kuehlung',
    kennung: 'BWP-H-08',
    name: 'Wärmepumpe, ein Heizkreis und Trinkwassererwärmung, mit parallelem Pufferspeicher und natürlicher Kühlung',
    kurz: 'Passive Kühlung über die Wärmequelle: der Verdichter läuft im Kühlbetrieb nicht mit, die Kälte kommt über einen Kühlwärmeübertrager aus dem Solekreis.',
    merkmale: {
      anbindung: 'parallelpuffer',
      trinkwasser: 'speicher',
      kreise: 1,
      gemischt: true,
      uebergabe: ['flaeche'],
      bivalent: 'kein',
      kuehlung: 'passiv',
      kaskade: false,
    },
    bedingungen: [
      {
        id: 'nur-sole-oder-wasser',
        text: 'Nur Sole/Wasser- oder Wasser/Wasser-Wärmepumpen.',
        beleg: BWP + ', Schema 8, Vorbedingungen.',
        art: 'hart',
      },
      {
        id: 'kein-flaechenkollektor',
        text: 'Ein Flächenkollektor als Wärmequelle ist ausgeschlossen; VDI 4640 Blatt 2 ist zu beachten.',
        beleg: BWP + ', Schema 8, Vorbedingungen: VDI 4640 Blatt 2 beachten, nicht mit Flächenkollektor.',
        art: 'hart',
      },
      {
        id: 'schluckbrunnen-20-grad',
        text: 'Bei Wasser als Quelle darf das Wasser mit höchstens 20 Grad Celsius in den Schluckbrunnen eintreten.',
        beleg: BWP + ', Schema 8, Zeile Wärmequellenanlage.',
        art: 'hart',
      },
      {
        id: 'erdsonde-75-prozent',
        text: 'Bei Erdsonden ist die Kühlleistung auf höchstens 75 Prozent der Heizleistung bei 300 Stunden Volllast auszulegen.',
        beleg: BWP + ', Schema 8, Zeile Wärmequellenanlage.',
        art: 'hart',
      },
      {
        id: 'taupunktgrenze',
        text: 'Bei Kühlung oberhalb des Taupunkts ist die erforderliche Kühlleistung nicht immer erreichbar.',
        beleg: BWP + ', Schema 8, Zeile Wärmeübergabe Kühlung: dann bleibt es beim Ankühlen.',
        art: 'weich',
      },
      {
        id: 'ein-heizkreis-titelabweichung',
        text: 'Das Schema zeigt einen Heizkreis.',
        beleg: 'Inhaltsverzeichnis, Schemaüberschrift und Auswahlmatrix des Leitfadens führen Schema 8 unter „ein Heizkreis"; nur die Kopfzeile über der Auslegungstabelle der Ausgabe 2023 schreibt abweichend „mehrere Heizkreise". Die Mehrheit der Fundstellen entscheidet.',
        art: 'weich',
      },
      B_HERSTELLER_BINDEND,
    ],
    erzeugerkreis: [
      { kind: 'heatpump-indoor', label: 'Wärmepumpe Sole/Wasser oder Wasser/Wasser' },
      { kind: 'pump', label: 'Umwälzpumpe Heizung', entfaelltWennImGeraet: 'pump' },
      { kind: 'check-valve', label: 'Rückschlagklappe' },
      ...umschaltventilWarmwasser(),
      { kind: 'buffer', label: 'Parallelpufferspeicher', entfaelltWennImGeraet: 'buffer' },
      {
        kind: 'pump',
        label: 'Umwälzpumpe primär Kühlung',
        hinweis: 'Bindet den Kühlwärmeübertrager soleseitig an den Primärkreis an; Dichte und Viskosität des Wärmeträgers berücksichtigen.',
      },
      { kind: 'valve-3way', label: 'Mischventil im Kühlkreis' },
      ...wpRuecklauf(),
    ],
    heizkreis: [
      { kind: 'pump', label: 'Umwälzpumpe Heizkreis' },
      { kind: 'valve-3way', label: 'Mischventil' },
      {
        kind: 'node',
        label: 'Kühlwärmeübertrager',
        hinweis: 'Für den Wärmeübertrager gibt es im Schema keinen eigenen Bauteiltyp; er ist hier als benannter Knoten geführt. Soleseitig über eigene Umwälzpumpe und Mischventil an den Primärkreis angebunden.',
      },
      { kind: 'sensor', label: 'Vorlauftemperaturfühler' },
      { kind: 'floor-loop', label: 'Flächenheizung oder Gebläsekonvektoren' },
    ],
    trinkwasserzweig: trinkwasserSpeicher(),
    auslegung: [
      A_MINDESTVOLUMENSTROM,
      A_SPREIZUNG_PRIMAER,
      A_SPREIZUNG_HEIZUNG,
      A_SPREIZUNG_TWE,
      A_PUFFER_LKW,
      A_WT_FLAECHE,
      {
        groesse: 'Wärmeübergabe Kühlung',
        wert: 'Wärmeübertrager nach der ausgelegten Kühlleistung; 4 bis 5 K Spreizung bei 4 K Übertemperatur',
        quelle: BWP + ', Schema 8, S. 21',
      },
      {
        groesse: 'Volumenstrom primär Kühlung',
        wert: 'Leistung der Kühlung bei 5 K Spreizung',
        quelle: BWP + ', Schema 8, S. 21',
      },
      {
        groesse: 'Wärmequellenanlage',
        wert: 'Wasser: höchstens 20 Grad Celsius Eintritt in den Schluckbrunnen; Erdsonde: Kühlleistung höchstens 75 Prozent der Heizleistung bei 300 Stunden Volllast',
        quelle: BWP + ', Schema 8, S. 21',
      },
    ],
    herstellernamen: [
      { hersteller: 'Stiebel Eltron', bezeichnung: 'Schaltplancode F1 = 1 (passiv intern Wärmepumpe), 2 (passiv mit Wärmetauscher) oder 3 (passiv auf Heizkreis)' },
      { hersteller: 'Viessmann', bezeichnung: 'Natural Cooling' },
      { hersteller: 'NIBE', bezeichnung: 'Passivkühlmodul PCM, z. B. PL1.103 „S115X UKV VPB PCM"' },
      { hersteller: 'Weishaupt', bezeichnung: 'Geoblock Kühlen — Plan 19 00 0 4 01 02 0 2 0' },
      { hersteller: 'Vaillant', bezeichnung: 'Systemschema 0020177929 — Set für passive Kühlung' },
      { hersteller: 'Wolf', bezeichnung: 'Kühlmodul BKM' },
    ],
    wissenIds: ['hyd-parallelpuffer', 'hyd-puffervolumen-lkw', 'hyd-mischer-zwingend', 'hyd-glykol-stoffdaten'],
    quelle: BWP + ', Schema 8, S. 20 bis 21',
    url: BWP_URL,
    belastbarkeit: 'sekundaer',
  },

  // -------------------------------------------------------------------------
  // BWP-H-09 — aktive Kühlung mit eigenem Kühlpufferspeicher. Die Zeile
  // „Wärmeverteilung Kühlung" ist die einzige Stelle im ganzen Leitfaden, an
  // der eine Zielkonflikt-Entscheidung verlangt wird: sie ist ein Eingabefeld,
  // kein berechenbarer Wert.
  // -------------------------------------------------------------------------
  {
    id: 'bwp-h-09-aktive-kuehlung',
    kennung: 'BWP-H-09',
    name: 'Wärmepumpe, ein Heizkreis und Trinkwassererwärmung, mit parallelem Pufferspeicher und aktiver Kühlung mit separatem Kühlkreis',
    kurz: 'Aktive Kühlung durch Prozessumkehr der Wärmepumpe, mit eigenem Kühlpufferspeicher und separatem Kühlkreis.',
    merkmale: {
      anbindung: 'parallelpuffer',
      trinkwasser: 'speicher',
      kreise: 1,
      gemischt: true,
      uebergabe: ['flaeche', 'heizkoerper'],
      bivalent: 'kein',
      kuehlung: 'aktiv',
      kaskade: false,
    },
    bedingungen: [
      {
        id: 'konzeptentscheidung-volumenstrom',
        text: 'Vor der Auslegung ist zu entscheiden, ob eine geringere Kühlleistung hingenommen wird oder die Hydraulik im Heizfall überdimensioniert und regeltechnisch schlechter wird.',
        beleg: BWP + ', Schema 9, Zeile Wärmeverteilung Kühlung: im Kühlfall ist meist ein deutlich größerer Volumenstrom nötig; der Leitfaden verlangt hier ausdrücklich eine Konzeptentscheidung. Für ein Planungswerkzeug ist das ein Pflicht-Eingabefeld und kein berechenbarer Wert.',
        art: 'hart',
      },
      {
        id: 'eigener-kuehlpuffer',
        text: 'Der Kühlkreis bekommt einen eigenen Kühlpufferspeicher.',
        beleg: BWP + ', Schema 9: das einzige Schema des Leitfadens mit Kühlspeicher; Mindestgröße 20 bis 25 l je kW Kühlleistung im maximalen Betriebspunkt.',
        art: 'hart',
      },
      {
        id: 'quellengrenzen-aktiv',
        text: 'Es gelten dieselben Quellengrenzen wie bei der passiven Kühlung: höchstens 20 Grad Celsius im Schluckbrunnen, Erdsonde höchstens 75 Prozent der Heizleistung bei 300 Stunden Volllast.',
        beleg: BWP + ', Schema 9, Zeile Wärmequellenanlage.',
        art: 'hart',
      },
      {
        id: 'umschaltventile-beide-faelle',
        text: 'Die Umschaltventile sind nach dem Volumenstrom im Heiz- und im Kühlfall auszulegen.',
        beleg: BWP + ', Schema 9, Zeile Umschaltventile.',
        art: 'hart',
      },
      B_HERSTELLER_BINDEND,
    ],
    erzeugerkreis: [
      { kind: 'heatpump-outdoor', label: 'Wärmepumpe, umschaltbar Heizen und Kühlen' },
      { kind: 'pump', label: 'Umwälzpumpe', entfaelltWennImGeraet: 'pump' },
      { kind: 'check-valve', label: 'Rückschlagklappe' },
      { kind: 'valve-diverter', label: 'Umschaltventile Heizung und Kühlung', entfaelltWennImGeraet: 'diverter' },
      { kind: 'buffer', label: 'Heizungspufferspeicher', entfaelltWennImGeraet: 'buffer' },
      { kind: 'buffer', label: 'Kühlpufferspeicher' },
      ...wpRuecklauf(),
    ],
    heizkreis: [
      { kind: 'pump', label: 'Umwälzpumpe Heizkreis' },
      { kind: 'valve-3way', label: 'Mischventil' },
      { kind: 'sensor', label: 'Vorlauftemperaturfühler' },
      { kind: 'floor-loop', label: 'Flächenheizung beziehungsweise Gebläsekonvektoren zur Kühlung' },
    ],
    trinkwasserzweig: trinkwasserSpeicher(),
    auslegung: [
      A_MINDESTVOLUMENSTROM,
      A_SPREIZUNG_PRIMAER,
      A_SPREIZUNG_HEIZUNG,
      A_SPREIZUNG_TWE,
      A_PUFFER_LKW,
      {
        groesse: 'Kühlpufferspeicher',
        wert: 'Mindestgröße 20 bis 25 l je kW Kühlleistung der Wärmepumpe im maximalen Betriebspunkt',
        quelle: BWP + ', Schema 9, S. 23',
      },
      {
        groesse: 'Wärmeübergabe Kühlung',
        wert: 'Wärmeübertrager nach der ausgelegten Kühlleistung; 4 bis 5 K Spreizung bei 4 K Übertemperatur',
        quelle: BWP + ', Schema 9, S. 23',
      },
      {
        groesse: 'Wärmequellenanlage',
        wert: 'Wasser: höchstens 20 Grad Celsius Eintritt in den Schluckbrunnen; Erdsonde: Kühlleistung höchstens 75 Prozent der Heizleistung bei 300 Stunden Volllast',
        quelle: BWP + ', Schema 9, S. 23',
      },
      {
        groesse: 'Kälteleistung, falls vom Hersteller nicht angegeben',
        wert: 'Kälteleistung gleich Heizleistung mal (1 minus 1 durch COP)',
        quelle: BWP + ', S. 28, Gleichung 2',
      },
    ],
    herstellernamen: [
      { hersteller: 'Stiebel Eltron', bezeichnung: 'Schaltplancode F1 = 4 (aktiv intern Wärmepumpe) oder 6 (aktiv mit Wärmetauscher)' },
      { hersteller: 'Viessmann', bezeichnung: 'Active Cooling mit separatem Kühlkreis; Heiz-/Kühlwasser-Pufferspeicher, z. B. Anlagenbeispiel 4742919_01 mit zwei Puffern' },
      { hersteller: 'Mitsubishi Electric', bezeichnung: 'Variante 1.5 — Puffer Heizen und Puffer Kühlen' },
      { hersteller: 'Ochsner', bezeichnung: 'Konfiguration -019 und -020 — Unifresh als Kombi- und Kühlspeicher' },
      { hersteller: 'Wolf', bezeichnung: 'Merkmal KuehlenSplitWaerme in der Schemendatenbank' },
      { hersteller: 'LG', bezeichnung: 'A4 — 2 Heizkreise und 1 Kühlkreis mit Warmwasser' },
    ],
    wissenIds: ['hyd-parallelpuffer', 'hyd-puffervolumen-lkw', 'hyd-mischer-zwingend'],
    quelle: BWP + ', Schema 9, S. 22 bis 23',
    url: BWP_URL,
    belastbarkeit: 'sekundaer',
  },

  // -------------------------------------------------------------------------
  // BWP-H-10 — dritter Verbraucherkreis Schwimmbad. Achtung: die Tabellenzeile
  // „Gesamtvolumen nach Planung der Solaranlage" ist in beiden Ausgaben ein aus
  // Schema 4 übernommener Redaktionsfehler; Schema 10 hat keine Solarthermie.
  // -------------------------------------------------------------------------
  {
    id: 'bwp-h-10-schwimmbad',
    kennung: 'BWP-H-10',
    name: 'Wärmepumpe, mehrere Heizkreise und Trinkwassererwärmung, mit parallelem Pufferspeicher und Schwimmbad',
    kurz: 'Wie Schema 3, zusätzlich mit einem dritten Verbraucherkreis Schwimmbad, der über einen Wärmeübertrager vom Beckenwasser getrennt ist.',
    merkmale: {
      anbindung: 'parallelpuffer',
      trinkwasser: 'speicher',
      kreise: 0,
      gemischt: true,
      uebergabe: ['flaeche', 'heizkoerper'],
      bivalent: 'kein',
      kuehlung: 'keine',
      kaskade: false,
      weitererVerbraucher: 'schwimmbad',
    },
    bedingungen: [
      {
        id: 'systemtrennung-becken',
        text: 'Der Schwimmbadkreis ist über einen Wärmeübertrager vom Beckenwasser getrennt.',
        beleg: BWP + ', Schema 10, Zeichnung S. 24.',
        art: 'hart',
      },
      {
        id: 'spreizung-schwimmbad',
        text: 'Wärmepumpenseitig gilt am Schwimmbad-Wärmeübertrager höchstens 10 K, schwimmbadseitig 5 bis 7 K.',
        beleg: BWP + ', Schema 10, Zeile Schwimmbad Wärmeübertrager.',
        art: 'hart',
      },
      {
        id: 'redaktionsfehler-solar-schema10',
        text: 'Die Tabellenzeile „Pufferspeicher Gesamtvolumen nach Planung der Solaranlage" gilt hier nicht.',
        beleg: 'Dokumentierter Redaktionsfehler in beiden Ausgaben 2016 und 2023: die Zeile ist offenkundig aus Schema 4 übernommen, Schema 10 führt laut Auswahlmatrix keine Solarthermie. Verwertbar ist nur der Bereitschaftsteil.',
        art: 'weich',
      },
      B_HERSTELLER_BINDEND,
    ],
    erzeugerkreis: [
      ...wpVorlauf(),
      { kind: 'valve-diverter', label: 'Umschaltventile für drei Verbraucherzweige', entfaelltWennImGeraet: 'diverter' },
      { kind: 'buffer', label: 'Parallelpufferspeicher', entfaelltWennImGeraet: 'buffer' },
      {
        kind: 'node',
        label: 'Schwimmbad-Wärmeübertrager',
        hinweis: 'Für den Wärmeübertrager gibt es im Schema keinen eigenen Bauteiltyp; er ist hier als benannter Knoten geführt. Er trennt den Heizungskreis vom Beckenwasser.',
      },
      ...wpRuecklauf(),
    ],
    heizkreis: [
      { kind: 'shutoff', label: 'Absperrventil Heizkreis' },
      { kind: 'valve-3way', label: 'Dreiwege-Mischer, motorisch', optional: true, hinweis: 'Nur im gemischten Kreis.' },
      { kind: 'pump', label: 'Umwälzpumpe Heizkreis' },
      { kind: 'check-valve', label: 'Rückschlagklappe' },
      { kind: 'sensor', label: 'Vorlauftemperaturfühler' },
      { kind: 'temperature-limiter', label: 'Maximaltemperaturwächter Flächenheizung', optional: true },
      { kind: 'floor-loop', label: 'Wärmeübergabe (Heizfläche bzw. Heizkörper)' },
    ],
    trinkwasserzweig: trinkwasserSpeicher(),
    auslegung: [
      A_SPREIZUNG_PRIMAER,
      A_SPREIZUNG_HEIZUNG,
      A_SPREIZUNG_TWE,
      {
        groesse: 'Volumenstrom Schwimmbad',
        wert: 'Spreizung höchstens 10 K bei größter Heizleistung der Wärmepumpe',
        quelle: BWP + ', Schema 10, S. 25',
      },
      {
        groesse: 'Schwimmbad-Wärmeübertrager',
        wert: 'wärmepumpenseitig Spreizung höchstens 10 K, schwimmbadseitig 5 bis 7 K',
        quelle: BWP + ', Schema 10, S. 25',
      },
      {
        groesse: 'Pufferspeicher Bereitschaftsteil',
        wert: 'zur Laufzeitoptimierung 20 bis 25 l je kW; zur Überbrückung von Sperrzeiten 30 bis 40 l je kW',
        quelle: BWP + ', Schema 10, S. 25',
      },
      A_WT_FLAECHE,
    ],
    herstellernamen: [
      { hersteller: 'Stiebel Eltron', bezeichnung: 'Schaltplancode F2 = 3, 4 oder 5 (Pool, auch mit solarer Warmwasserbereitung und Heizungsunterstützung)' },
      { hersteller: 'Viessmann', bezeichnung: 'Filterkriterium Schwimmbad im Schemenbrowser' },
      { hersteller: 'Ochsner', bezeichnung: 'OTF-Konfigurationen mit Pool (Nummernblock -001 bis -010)' },
    ],
    wissenIds: ['hyd-parallelpuffer', 'hyd-puffervolumen-lkw', 'hyd-spreizung-auslegung', 'hyd-wt-flaeche-trinkwasser'],
    quelle: BWP + ', Schema 10, S. 24 bis 25',
    url: BWP_URL,
    belastbarkeit: 'sekundaer',
  },

  // -------------------------------------------------------------------------
  // BWP-H-11 — Kaskade. Der Leitfaden bemaßt hier nichts Eigenes; zeichnerisch
  // belegt und damit zwingend sind dagegen die vier Wiederholungen je Gerät:
  // eigene Pumpe, eigene Rückschlagklappe, eigenes Ausdehnungsgefäß, beidseitig
  // absperrbar.
  // -------------------------------------------------------------------------
  {
    id: 'bwp-h-11-kaskade',
    kennung: 'BWP-H-11',
    name: 'Wärmepumpen als Kaskadenlösung',
    kurz: 'Zwei oder mehr Wärmepumpen auf einen gemeinsamen Verteiler und einen parallelen Pufferspeicher; in der Zeichnung sind vier Geräte dargestellt.',
    merkmale: {
      anbindung: 'parallelpuffer',
      trinkwasser: 'speicher',
      kreise: 0,
      gemischt: true,
      uebergabe: ['flaeche', 'heizkoerper'],
      bivalent: 'kein',
      kuehlung: 'keine',
      kaskade: true,
    },
    bedingungen: [
      {
        id: 'eigene-pumpe-je-geraet',
        text: 'Jedes Gerät bekommt eine eigene Umwälzpumpe im Modulvorlauf.',
        beleg: BWP + ', Schema 11, Zeichnung S. 26 — für jedes der vier Module identisch gezeichnet.',
        art: 'hart',
      },
      {
        id: 'eigene-rueckschlagklappe-je-geraet',
        text: 'Jedes Gerät bekommt eine eigene Rückschlagklappe direkt nach seiner Pumpe.',
        beleg: BWP + ', Schema 11, Zeichnung S. 26. Sie verhindert die Rückströmung durch stillstehende Geräte in den gemeinsamen Verteiler.',
        art: 'hart',
      },
      {
        id: 'eigenes-mag-je-geraet',
        text: 'Jedes Gerät führt im Rücklauf ein eigenes Membran-Ausdehnungsgefäß mit Kappenventil.',
        beleg: BWP + ', Schema 11, Zeichnung S. 26; deckt sich mit der Empfehlung zur Einzelabsicherung jedes Wärmeerzeugers aus DIN EN 12828 (über Sekundärquellen belegt).',
        art: 'hart',
      },
      {
        id: 'beidseitig-absperrbar',
        text: 'Jedes Gerät ist vor- und rücklaufseitig absperrbar, damit ein Gerät ohne Anlagenstillstand getauscht werden kann.',
        beleg: BWP + ', Schema 11, Zeichnung S. 26.',
        art: 'hart',
      },
      {
        id: 'puffervolumen-bezug-offen',
        text: 'Ob sich die Puffergröße auf die Einzelleistung oder auf die Summenleistung bezieht, ist offen und muss entschieden werden.',
        beleg: 'Nicht belegbar: der Leitfaden wiederholt bei Schema 11 nur 20 bis 25 beziehungsweise 30 bis 40 l je kW „maximaler Heizleistung der Wärmepumpe", ohne zu definieren, ob Einzel- oder Summenleistung gemeint ist. Eine Sekundärquelle (IKZ Fachplaner 10/2021) hält fest, dass Abtauenergie und Spitzenglättung bei Kaskaden eine untergeordnete Rolle spielen und der Speicher generell kleiner ausfallen kann.',
        art: 'weich',
      },
      {
        id: 'kaskadenregler-optional',
        text: 'Ein übergeordneter Kaskadenregler ist im Schema als Option geführt.',
        beleg: BWP + ', Schema 11, Legende: „WP1-4 Anschluss Wärmepumpen an optionalen übergeordneten Kaskadenregler". Sekundärquellen halten eine wärmepumpenübergreifende Regelintelligenz mit automatischem Führungswechsel für erforderlich.',
        art: 'weich',
      },
      {
        id: 'keine-geraetezahl-obergrenze',
        text: 'Eine neutrale Obergrenze für die Gerätezahl gibt es nicht.',
        beleg: 'Nicht belegbar: der BWP zeichnet vier Geräte, definiert aber keine Obergrenze; die auffindbaren Grenzen sind herstellerspezifisch. Auch eine Tichelmann-Verrohrung wird in keiner neutralen Quelle gefordert oder ausgeschlossen.',
        art: 'weich',
      },
      B_HERSTELLER_BINDEND,
    ],
    erzeugerkreis: [
      { kind: 'heatpump-outdoor', label: 'Wärmepumpe je Modul (WP1 bis WPn)' },
      { kind: 'electric-heater', label: 'Elektro-Zusatzheizung je Modul', optional: true, entfaelltWennImGeraet: 'backupHeater' },
      { kind: 'pump', label: 'Eigene Umwälzpumpe je Modul' },
      { kind: 'check-valve', label: 'Eigene Rückschlagklappe je Modul' },
      { kind: 'sensor', label: 'Temperaturfühler je Modul' },
      { kind: 'shutoff', label: 'Absperrventil im Modulvorlauf' },
      { kind: 'valve-diverter', label: 'Dreiwege-Umschaltventil je Modul', optional: true, hinweis: 'Im Schema grau gezeichnet.' },
      { kind: 'manifold', label: 'Gemeinsamer Vorlaufverteiler' },
      { kind: 'buffer', label: 'Paralleler Pufferspeicher' },
      { kind: 'manifold', label: 'Gemeinsamer Rücklaufverteiler' },
      { kind: 'shutoff', label: 'Absperrventil im Modulrücklauf' },
      { kind: 'expansion-vessel', label: 'Eigenes Membran-Ausdehnungsgefäß mit Kappenventil je Modul' },
      { kind: 'heatpump-outdoor', label: 'Rücklaufeintritt der Module' },
    ],
    heizkreis: [
      { kind: 'shutoff', label: 'Absperrventil Heizkreis' },
      { kind: 'valve-3way', label: 'Dreiwege-Mischer, motorisch', optional: true, hinweis: 'Nur im gemischten Kreis.' },
      { kind: 'pump', label: 'Umwälzpumpe Heizkreis' },
      { kind: 'check-valve', label: 'Rückschlagklappe' },
      { kind: 'sensor', label: 'Vorlauftemperaturfühler' },
      { kind: 'floor-loop', label: 'Wärmeübergabe (Heizfläche bzw. Heizkörper)' },
    ],
    trinkwasserzweig: trinkwasserSpeicher(),
    auslegung: [
      A_MINDESTVOLUMENSTROM,
      A_SPREIZUNG_PRIMAER,
      A_SPREIZUNG_HEIZUNG,
      A_SPREIZUNG_TWE,
      {
        groesse: 'Pufferspeicher',
        wert: 'zur Laufzeitoptimierung 20 bis 25 l je kW, zur Überbrückung von Sperrzeiten 30 bis 40 l je kW maximaler Heizleistung der Wärmepumpe — Bezug auf Einzel- oder Summenleistung ist im Leitfaden nicht definiert',
        quelle: BWP + ', Schema 11, S. 27',
      },
      A_WT_FLAECHE,
    ],
    herstellernamen: [
      { hersteller: 'Buderus', bezeichnung: 'Hydraulik-Nr. 6721863929 — zwei WLW186i/176i ARE in Parallelschaltung' },
      { hersteller: 'Stiebel Eltron', bezeichnung: 'Schaltplancode G3 = 2 bis 6 (Anzahl Wärmepumpen), K2 = 4 (Kaskadenmodul AHP-CM)' },
      { hersteller: 'Vaillant', bezeichnung: 'Systemschema-Code 9 beziehungsweise 16 — Kaskade mit bis zu sieben Wärmepumpen' },
      { hersteller: 'Ochsner', bezeichnung: 'Konfigurationsnummern -2xx, -3xx und -4xx für Zweier-, Dreier- und Viererkaskaden' },
      { hersteller: 'Viessmann', bezeichnung: 'Filterkriterium Kaskade im Schemenbrowser' },
      { hersteller: 'Mitsubishi Electric', bezeichnung: 'Anlagenbeispiel 5 — Hydromodul Kaskade' },
    ],
    wissenIds: ['hyd-parallelpuffer', 'hyd-puffervolumen-lkw', 'hyd-pflichtarmaturen-12828', 'hyd-weiche-wann'],
    quelle: BWP + ', Schema 11, S. 26 bis 27',
    url: BWP_URL,
    belastbarkeit: 'sekundaer',
  },

  // -------------------------------------------------------------------------
  // HERST-H-01 — Wärmepumpe direkt an Heizkörper, ohne Puffer.
  // ACHTUNG: Diese Vorlage ist HERSTELLERGESTÜTZT UND NICHT BWP-BELEGT. Der
  // BWP lässt die pufferlose Direktanbindung ausdrücklich nur für
  // Flächenheizungen zu (Schema 1); Heizkörper erscheinen dort erst mit dem
  // Reihenpuffer aus Schema 2. Bosch ersetzt das l/kW-Kriterium durch ein
  // Wärmeübergabeflächen-Kriterium und lässt den reinen Heizkörperkreis ohne
  // Puffer und ohne Mischer zu — das, und nur das, trägt diese Vorlage.
  // -------------------------------------------------------------------------
  {
    id: 'herst-h-01-direkt-heizkoerper',
    kennung: 'HERST-H-01',
    name: 'Wärmepumpe direkt an Heizkörper, ohne Pufferspeicher',
    kurz: 'Ein reiner Heizkörperkreis ohne Mischer und ohne Puffer — herstellergestützt zulässig, sobald genügend Heizkörperleistung mit voll geöffneten Thermostatventilen dauerhaft durchströmt wird.',
    merkmale: {
      anbindung: 'direkt',
      trinkwasser: 'speicher',
      kreise: 1,
      gemischt: false,
      uebergabe: ['heizkoerper'],
      bivalent: 'kein',
      kuehlung: 'keine',
      kaskade: false,
    },
    bedingungen: [
      {
        id: 'nicht-bwp-belegt',
        text: 'Dieses Schema ist herstellergestützt und nicht durch den BWP-Leitfaden belegt.',
        beleg: 'Der BWP lässt die Direktanbindung ohne Puffer nur für Flächenheizsysteme zu (Schema 1); Heizkörper erscheinen erst in Schema 2, also erst in Verbindung mit einem Reihenpuffer. Diese Vorlage stützt sich ausschließlich auf die Bosch-Planungsunterlage.',
        art: 'weich',
      },
      {
        id: 'mindestens-vier-heizkoerper',
        text: 'Es müssen mindestens vier Heizkörper mit je etwa 500 W dauerhaft durchströmt werden; deren Thermostatventile müssen vollständig geöffnet sein.',
        beleg: 'Bosch Compress 7000i AW, Planungsunterlage Kap. 4.2.2: für die großen Baugrößen mindestens vier Heizkörper mit je etwa 500 W, für die kleinen mindestens einer mit 500 W, empfohlen ebenfalls vier. Bosch gibt ausdrücklich kein pauschales Mindestanlagenvolumen an, sondern ersetzt es durch dieses Wärmeübergabeflächen-Kriterium.',
        art: 'hart',
      },
      {
        id: 'kein-mischer',
        text: 'Der Kreis darf keinen Mischer haben.',
        beleg: 'Bosch Compress 7000i AW, Kap. 4.2.2 gilt für Heizkörper ohne Mischer und ohne Puffer. Kap. 4.2.4 kippt den Fall: bestehen alle Heizkreise aus gemischten Kreisen, ist ein Pufferspeicher zwingend.',
        art: 'hart',
      },
      B_PUFFER_MISCHERKREISE,
      {
        id: 'ueberstroemventil-oder-fuehrungsraum',
        text: 'Ohne dauerhaft offenen Führungsraum ist der Mindestvolumenstrom über ein Überströmventil sicherzustellen.',
        beleg: 'Ochsner OTS-Schemenkatalog, Planungshinweise: die Mindestabnahme kann über einen nicht absperrbaren Führungsraum oder ein Überströmventil erreicht werden; ist eine ganzjährige Mindestabnahme nicht sicherzustellen, ist zwingend ein Pufferspeicher zu installieren. Ochsner empfiehlt für reine Radiatorensysteme ohnehin Hydrauliken mit Pufferspeicher.',
        art: 'weich',
      },
      {
        id: 'herstellerwert-mindestwasservolumen',
        text: 'Das Mindestwasservolumen des gewählten Geräts ist gesondert zu prüfen; die Herstellerwerte streuen erheblich.',
        beleg: 'Daikin nennt ohne Innenvolumen des Außengeräts 50 l ohne Reserveheizung und 20 l mit Reserveheizung; Vaillant fordert für die Enteisung je nach Baugröße 15 bis 150 l; Panasonic empfiehlt einen Rücklaufspeicher von 30 l bis 9 kW und 50 l bei 12 kW.',
        art: 'hart',
      },
      B_HERSTELLER_BINDEND,
    ],
    erzeugerkreis: [
      { kind: 'heatpump-outdoor', label: 'Wärmepumpe' },
      { kind: 'shutoff', label: 'Absperrung mit Entleerung im Vorlauf' },
      { kind: 'electric-heater', label: 'Elektro-Zusatzheizung', optional: true, entfaelltWennImGeraet: 'backupHeater' },
      { kind: 'pump', label: 'Umwälzpumpe', entfaelltWennImGeraet: 'pump' },
      { kind: 'check-valve', label: 'Rückschlagklappe' },
      { kind: 'safety-valve', label: 'Sicherheitsventil 3 bar', entfaelltWennImGeraet: 'safetyGroup' },
      { kind: 'pressure-gauge', label: 'Manometer', entfaelltWennImGeraet: 'safetyGroup' },
      { kind: 'air-separator', label: 'Entlüfter am höchsten Punkt' },
      ...umschaltventilWarmwasser(),
      { kind: 'manifold', label: 'Heizkreisverteiler' },
      { kind: 'dirt-separator', label: 'Schmutzfänger beziehungsweise Magnetitabscheider im Rücklauf', entfaelltWennImGeraet: 'dirtSeparator' },
      { kind: 'filling-valve', label: 'Füll- und Entleerhahn' },
      { kind: 'expansion-vessel', label: 'Membran-Ausdehnungsgefäß mit Kappenventil', entfaelltWennImGeraet: 'expansionVessel' },
      { kind: 'shutoff', label: 'Absperrung mit Entleerung im Rücklauf' },
      { kind: 'heatpump-outdoor', label: 'Rücklaufeintritt Wärmepumpe' },
    ],
    heizkreis: [
      { kind: 'balancing-valve', label: 'Voreinstellbares Heizkörperventil' },
      { kind: 'radiator', label: 'Heizkörper, Thermostatventil vollständig geöffnet' },
      {
        kind: 'overflow-valve',
        label: 'Überströmventil',
        optional: true,
        hinweis: 'Nur wenn kein dauerhaft offener Führungsraum vorhanden ist; möglichst dicht an der Wärmeübergabe und nicht mit Delta-p variabel oder Autoadapt.',
      },
    ],
    trinkwasserzweig: trinkwasserSpeicher(),
    auslegung: [
      {
        groesse: 'Mindestbestückung Heizkörper',
        wert: 'mindestens vier Heizkörper mit je etwa 500 W (große Baugrößen); mindestens ein Heizkörper mit 500 W, empfohlen vier (kleine Baugrößen)',
        quelle: 'Bosch Compress 7000i AW, Planungsunterlage Kap. 4.2.2',
      },
      {
        groesse: 'Mindestanlagenvolumen',
        wert: 'Bosch gibt generell keines an und ersetzt es durch das Wärmeübergabeflächen-Kriterium; der VdZ-Leitfaden nennt als Abschätzung 3 l je kW Nennleistung',
        quelle: 'Bosch Compress 7000i AW, Kap. 4.2; VdZ-Leitfaden Umsteigen auf die Wärmepumpe, Kap. 1.4',
      },
      {
        groesse: 'Spezifisches Anlagenvolumen Flachheizkörper',
        wert: '14,6 l je kW (Rechengröße für die Auslegung des Ausdehnungsgefäßes)',
        quelle: 'Bosch Compress 7000i AW, Kapitel Ausdehnungsgefäß',
      },
      {
        groesse: 'Spreizung Heizungsseite bei statischen Heizflächen',
        wert: 'bis maximal 10 K',
        quelle: BWP + ', Auslegungstabellen Schema 2 bis 11',
      },
      A_WT_FLAECHE,
    ],
    herstellernamen: [
      { hersteller: 'Bosch', bezeichnung: 'Heizkörper ohne Mischer und ohne Pufferspeicher (Kap. 4.2.2)' },
      { hersteller: 'Panasonic', bezeichnung: 'H-Generation Split, Konfiguration „direkt" (ohne Entkopplung)' },
      { hersteller: 'Ochsner', bezeichnung: 'Konfiguration -004: ohne Puffer, 1 direkter Heizkreis, Registerspeicher — mit dem Hinweis, für reine Radiatorensysteme dennoch einen Puffer zu empfehlen' },
      { hersteller: 'Wolf', bezeichnung: 'Anlagenkonfiguration mit Direktkreis ohne Speicher (Merkmal Ohne_Speicher)' },
      { hersteller: 'Stiebel Eltron', bezeichnung: 'Schaltplancode P1 = 0 (ohne Heizungspuffer), H1 = 1 (ungemischt)' },
    ],
    wissenIds: ['hyd-wp-direkt-bedingungen', 'hyd-wp-direkt-mindestwasservolumen', 'hyd-schema1-zulaessigkeit', 'hyd-schema1-komponenten', 'hyd-ueberstroemventil-einbauregeln', 'hyd-ueberstroemventil-herstellerpraxis', 'hyd-puffer-bei-mischerkreisen', 'hyd-magnetitabscheider'],
    quelle: 'Bosch/Junkers Compress 7000i AW, Planungsunterlage, Kap. 4.2.1 bis 4.2.5; ergänzend Ochsner OTS-Planungshinweise und VdZ-Leitfaden Kap. 1.4',
    url: 'https://www.heizungsdiscount24.de/pdf/Junkers-Bosch-Compress-CS7000iAW-3-13-kW-Planungsunterlage.pdf',
    belastbarkeit: 'primaer',
  },

  // -------------------------------------------------------------------------
  // BWP-H-03-2HK — Parallelpuffer mit genau zwei Heizkreisen. Inhaltlich
  // vollständig innerhalb von BWP-H-03; die Einengung auf genau zwei Kreise ist
  // die Konstruktion dieses Katalogs und keine Aussage des Leitfadens, deshalb
  // `belastbarkeit: 'annahme'`. Zahlen und Bauteile stammen unverändert aus
  // Schema 3.
  // -------------------------------------------------------------------------
  {
    id: 'bwp-h-03-2hk-parallelpuffer-zwei-kreise',
    kennung: 'BWP-H-03-2HK',
    name: 'Wärmepumpe auf Parallelpuffer mit zwei Heizkreisen',
    kurz: 'Die engere Ausprägung von Schema 3 für den häufigsten Sanierungsfall: ein Erzeuger, ein Parallelpuffer, genau zwei Heizkreise, Trinkwasser über Umschaltventil.',
    merkmale: {
      anbindung: 'parallelpuffer',
      trinkwasser: 'speicher',
      kreise: 2,
      gemischt: true,
      uebergabe: ['flaeche', 'heizkoerper'],
      bivalent: 'kein',
      kuehlung: 'keine',
      kaskade: false,
    },
    bedingungen: [
      {
        id: 'einengung-ist-konstruktion',
        text: 'Die Einengung auf genau zwei Heizkreise stammt nicht aus dem Leitfaden.',
        beleg: 'Annahme dieses Katalogs: der BWP kennt für den Parallelpuffer nur „mehrere Heizkreise" (Schema 3) und nennt keine Kreiszahl. Zwei Kreise sind die in den Herstellerkatalogen mit Abstand häufigste Ausprägung — Viessmann, Buderus, Bosch, Wolf, Weishaupt, NIBE, LG und Ochsner führen sie jeweils als eigenes Schema. Inhaltlich gilt hier alles, was für BWP-H-03 belegt ist.',
        art: 'weich',
      },
      {
        id: 'zwei-kreise-mischer',
        text: 'Sobald die beiden Kreise auf unterschiedlichem Temperaturniveau fahren, ist der wärmere Kreis ungemischt und der kältere gemischt auszuführen.',
        beleg: 'Ein Mischer ist zwingend bei zwei Heizkreisen mit unterschiedlichem Temperaturniveau, etwa Flächenheizung zusammen mit Radiatoren oder Konvektoren; zugleich gilt, dass ein unnötiger Mischer die Vorlauftemperatur der Wärmepumpe anhebt und die Effizienz senkt.',
        art: 'hart',
      },
      {
        id: 'eigene-pufferladepumpe-2hk',
        text: 'Der Parallelpuffer braucht eine eigene Pufferladepumpe zusätzlich zu den beiden Heizkreispumpen.',
        beleg: BWP + ', Schema 3, Zeile Umwälzpumpe Pufferladung.',
        art: 'hart',
      },
      B_PUFFER_MISCHERKREISE,
      B_HERSTELLER_BINDEND,
    ],
    erzeugerkreis: [
      ...wpVorlauf(),
      ...umschaltventilWarmwasser(),
      { kind: 'shutoff', label: 'Absperrventil vor dem Puffer' },
      { kind: 'buffer', label: 'Parallelpufferspeicher, Vorlaufanschluss oben', entfaelltWennImGeraet: 'buffer' },
      { kind: 'sensor', label: 'Pufferfühler oben' },
      { kind: 'manifold', label: 'Heizkreisverteiler für zwei Kreise' },
      ...wpRuecklauf(),
    ],
    heizkreis: [
      { kind: 'shutoff', label: 'Absperrventil Heizkreis' },
      {
        kind: 'valve-3way',
        label: 'Dreiwege-Mischer, motorisch',
        optional: true,
        hinweis: 'Im kälteren der beiden Kreise zwingend, wenn die Kreise auf unterschiedlichem Temperaturniveau fahren; im wärmeren Kreis entfällt er.',
      },
      { kind: 'pump', label: 'Umwälzpumpe Heizkreis' },
      { kind: 'check-valve', label: 'Rückschlagklappe' },
      { kind: 'sensor', label: 'Vorlauftemperaturfühler' },
      {
        kind: 'temperature-limiter',
        label: 'Maximaltemperaturwächter Flächenheizung',
        optional: true,
        hinweis: 'Zwingend am ungemischten Flächenheizkreis.',
      },
      { kind: 'floor-loop', label: 'Wärmeübergabe (Heizfläche bzw. Heizkörper)' },
    ],
    trinkwasserzweig: trinkwasserSpeicher(),
    auslegung: [
      A_MINDESTVOLUMENSTROM,
      A_SPREIZUNG_PRIMAER,
      {
        groesse: 'Volumenstrom zum Pufferspeicher',
        wert: 'Spreizung 5 bis 7 K bei Heizleistung unter Auslegungsbedingungen; für statische Heizflächen bis maximal 10 K',
        quelle: BWP + ', Schema 3',
      },
      A_SPREIZUNG_TWE,
      A_PUFFER_LKW,
      A_WT_FLAECHE,
    ],
    herstellernamen: [
      { hersteller: 'Buderus', bezeichnung: 'Hydraulik-Nr. 6721847260 — P120.5 parallel, ein ungemischter und ein gemischter Heizkreis' },
      { hersteller: 'Bosch', bezeichnung: 'Anlagenbeispiel 3.10 — Inneneinheit AWE, Puffer BH…, Warmwasserspeicher WH…, ein ungemischter und ein gemischter Kreis' },
      { hersteller: 'Wolf', bezeichnung: 'Zeichnung 32-52-006-262 „CHA-07/10, SEW, Trennspeicher" mit Direkt- und Mischerkreis' },
      { hersteller: 'Viessmann', bezeichnung: 'Filterkriterium „2 Heizkreise" im Schemenbrowser, z. B. Anlagenbeispiel 4743179_01' },
      { hersteller: 'Vaillant', bezeichnung: 'Systemschema 0020269149, Code 8 — Wärmepumpe mit zwei Heizkreisen, FM5 Konfiguration 3' },
      { hersteller: 'Ochsner', bezeichnung: 'Konfiguration -011 — mit Pufferspeicher, zwei Heizkreise, Registerspeicher' },
      { hersteller: 'Weishaupt', bezeichnung: '2. Heizkreis — Plan 17 00 0 4 01 03 0 0 0 (Aeroblock) beziehungsweise 18 00 0 4 01 03 0 0 0 (Biblock)' },
      { hersteller: 'NIBE', bezeichnung: 'PL4.235 „F/S2XXX VVM_S320 Puffer 2 HK"' },
      { hersteller: 'LG', bezeichnung: 'A5 — zwei gemischte Heizkreise mit Warmwasser' },
      { hersteller: 'Stiebel Eltron', bezeichnung: 'Schaltplancode mit H1 und H2 ungleich 0, P1 = 1 (Pufferspeicher SBP)' },
    ],
    wissenIds: ['hyd-parallelpuffer', 'hyd-puffervolumen-lkw', 'hyd-mischer-zwingend', 'hyd-mischer-nur-wenn-noetig', 'hyd-puffer-bei-mischerkreisen', 'hyd-fbh-ungemischt-temperaturwaechter'],
    quelle: BWP + ', Schema 3, S. 10 bis 11; Einengung auf zwei Kreise nach den Herstellerkatalogen von Viessmann, Vaillant, Bosch, Buderus, Wolf, Weishaupt, NIBE, LG und Ochsner',
    url: BWP_URL,
    belastbarkeit: 'annahme',
  },

  // -------------------------------------------------------------------------
  // HERST-H-02 — Turmgerät mit integriertem Trinkwasserspeicher. Der Speicher
  // steckt im Gerät, deshalb `trinkwasser: 'integriert'` und kein eigener
  // Speicher im Bild. Wer daneben einen zweiten Speicher, ein zweites
  // Umschaltventil oder eine Speicherladepumpe zeichnet, plant Bauteile, die es
  // schon gibt. Trinkwasserseitig bleibt die Sicherheitsgruppe bauseits.
  // -------------------------------------------------------------------------
  {
    id: 'herst-h-02-turm-integriert',
    kennung: 'HERST-H-02',
    name: 'Turmgerät mit integriertem Trinkwasserspeicher',
    kurz: 'Kompaktgerät, das Trinkwasserspeicher, Umschaltventil, Pumpe, Ausdehnungsgefäß und meist einen kleinen Puffer schon enthält — im Schema erscheint deshalb kein zweiter Speicher.',
    merkmale: {
      anbindung: 'direkt',
      trinkwasser: 'integriert',
      kreise: 2,
      gemischt: true,
      uebergabe: ['flaeche', 'heizkoerper'],
      bivalent: 'kein',
      kuehlung: 'keine',
      kaskade: false,
      bauformen: ['tower'],
    },
    bedingungen: [
      {
        id: 'kein-zweiter-speicher',
        text: 'Es wird kein separater Trinkwasserspeicher, kein zweites Umschaltventil und keine Speicherladepumpe gezeichnet.',
        beleg: 'Recherche Bauformen, Schema-Regel zur Klasse Turmgerät mit Trinkwasserspeicher: alles davon steckt bereits im Turm. Belegte Beispiele: Vaillant uniTOWER plus (188 l, 8,5 kW Heizstab, 18 l Ausdehnungsgefäß, Hocheffizienzpumpe, Dreiwege-Ventil, Sicherheitsventil, Manometer, Thermometer, Magnetitabscheider), Buderus WLW176i/186i T180 (180 l, 16 l Puffer, 9 kW, 17 l), Bosch Compress 5800i/6800i „M" (170,7 l, 16 l Puffer), NIBE VVM S320 (180 l plus 26 l Puffer), Wolf CHC-Monoblock 200 (180 l, Wärmeübertragerfläche 2,3 m², 34 l Puffer).',
        art: 'hart',
      },
      {
        id: 'trinkwasser-sicherheitsgruppe-bauseits',
        text: 'Die Sicherheitsgruppe Trinkwasser bleibt trotzdem bauseits.',
        beleg: 'Recherche Bauformen, Master-Tabelle Zeile 4: bauseits zu ergänzen sind Heizkreisverteiler, Sicherheitsgruppe Trinkwasser mit Rückflussverhinderer, Trinkwasser-Sicherheitsventil und Druckminderer, Zirkulationsleitung mit Pumpe, Frostschutz der Außenleitung und Kondensatablauf.',
        art: 'hart',
      },
      {
        id: 'integrierter-puffer-ersetzt-pruefung-nicht',
        text: 'Ein integrierter Puffer von 16 bis 70 l ersetzt die Prüfung des Mindestwasserinhalts nicht.',
        beleg: 'Recherche Bauformen, Prüfliste Zeile Pufferspeicher: der integrierte Puffer ersetzt oft den bauseitigen Reihenpuffer, aber nicht die Prüfung des Mindestwasserinhalts.',
        art: 'hart',
      },
      {
        id: 'wt-flaeche-meist-unbekannt',
        text: 'Die Wärmeübertragerfläche des eingebauten Speichers ist bei den meisten Herstellern nicht veröffentlicht.',
        beleg: 'Nicht belegbar: Flächenangaben fanden sich nur für Wolf CHC (2,3 m² bei 180 l, 3,0 m² bei 280 l). Für Vaillant uniTOWER, Viessmann 250-A Compact, Buderus T180, Bosch M, NIBE VVM S320, Daikin F und Samsung ClimateHub gibt es keine öffentlich zugänglichen Werte. Die Prüfung gegen 0,25 m² je kW ist dort nur mit dem Planungshandbuch möglich.',
        art: 'weich',
      },
      {
        id: 'sonderfall-frischwasserspeicher',
        text: 'Bei Frischwasser- oder Hygienespeichern im Turm entfällt die Legionellenschaltung, und das Speichervolumen zählt als Pufferspeicher des Heizkreises.',
        beleg: 'Recherche Bauformen, Abschnitt Speicher mit Rohrwendel gegen Frischwasserstation. Zugleich der dokumentierte Sonderfall Daikin ECH2O: dort sind Heizstab, Ausdehnungsgefäß und Schlammabscheider ausdrücklich nicht enthalten und separat zu bestellen.',
        art: 'weich',
      },
      B_HERSTELLER_BINDEND,
    ],
    erzeugerkreis: [
      { kind: 'heatpump-outdoor', label: 'Außeneinheit' },
      { kind: 'shutoff', label: 'Absperrung mit Entleerung im Vorlauf' },
      { kind: 'heatpump-indoor', label: 'Turmgerät mit integriertem Trinkwasserspeicher' },
      { kind: 'pump', label: 'Umwälzpumpe', entfaelltWennImGeraet: 'pump' },
      { kind: 'valve-diverter', label: 'Dreiwege-Umschaltventil Heizung/Warmwasser', entfaelltWennImGeraet: 'diverter' },
      { kind: 'electric-heater', label: 'Elektro-Zusatzheizung', optional: true, entfaelltWennImGeraet: 'backupHeater' },
      { kind: 'buffer', label: 'Pufferanteil im Gerät', optional: true, entfaelltWennImGeraet: 'buffer' },
      { kind: 'safety-valve', label: 'Sicherheitsventil 3 bar', entfaelltWennImGeraet: 'safetyGroup' },
      { kind: 'expansion-vessel', label: 'Membran-Ausdehnungsgefäß', entfaelltWennImGeraet: 'expansionVessel' },
      { kind: 'dirt-separator', label: 'Magnetit- und Schlammabscheider', entfaelltWennImGeraet: 'dirtSeparator' },
      { kind: 'manifold', label: 'Heizkreisverteiler, bauseits' },
      { kind: 'shutoff', label: 'Absperrung mit Entleerung im Rücklauf' },
      { kind: 'heatpump-outdoor', label: 'Rücklaufeintritt Außeneinheit' },
    ],
    heizkreis: [
      { kind: 'shutoff', label: 'Absperrventil Heizkreis' },
      { kind: 'valve-3way', label: 'Dreiwege-Mischer, motorisch', optional: true, hinweis: 'Nur im gemischten Kreis.' },
      { kind: 'pump', label: 'Umwälzpumpe Heizkreis', optional: true, hinweis: 'Entfällt beim einzigen ungemischten Kreis, wenn die Gerätepumpe ihn direkt versorgt.' },
      { kind: 'sensor', label: 'Vorlauftemperaturfühler' },
      { kind: 'temperature-limiter', label: 'Maximaltemperaturwächter Flächenheizung', optional: true },
      { kind: 'floor-loop', label: 'Wärmeübergabe (Heizfläche bzw. Heizkörper)' },
    ],
    trinkwasserzweig: [
      {
        kind: 'cylinder',
        label: 'Trinkwasserspeicher im Gerät',
        entfaelltWennImGeraet: 'cylinder',
        hinweis: 'Marktüblich 150 bis 280 l; er wird innerhalb des Gerätesymbols geführt und nicht als eigener Speicher gezeichnet.',
      },
      { kind: 'safety-valve', label: 'Kaltwasser-Sicherheitsgruppe Trinkwasser, bauseits' },
      { kind: 'backflow-preventer', label: 'Rückflussverhinderer in der Kaltwasserzuleitung, bauseits' },
      { kind: 'mixing-valve-dhw', label: 'Thermostatischer Warmwassermischer', optional: true },
      { kind: 'circulation-pump', label: 'Zirkulationspumpe PWH-C, bauseits', optional: true },
    ],
    auslegung: [
      {
        groesse: 'Trinkwasserspeicher im Turmgerät',
        wert: 'marktüblich 150 bis 280 l — belegte Beispiele: Vaillant uniTOWER plus 188 l, Buderus T180 180 l, Bosch „M" 170,7 l, NIBE VVM S320 180 l, Wolf CHC 180 l und 280 l, Samsung ClimateHub 200 l und 260 l',
        quelle: 'Recherche Bauformen, Marktübersicht Turm- und Kompaktgeräte',
      },
      {
        groesse: 'Pufferanteil im Turmgerät',
        wert: '16 bis 70 l — belegte Beispiele: Viessmann 250-A Compact 16 l, Buderus T180 16 l und TP70 70,5 l, Bosch „M" 16 l und „MB" 70 l, NIBE VVM S320 26 l, Wolf CHC 34 l und 50 l',
        quelle: 'Recherche Bauformen, Marktübersicht Turm- und Kompaktgeräte',
      },
      {
        groesse: 'Membran-Ausdehnungsgefäß im Turmgerät',
        wert: '10 bis 18 l — belegte Beispiele: Vaillant 18 l, Viessmann 18 l, Buderus 17 l, Bosch 16 l, NIBE 10 l',
        quelle: 'Recherche Bauformen, Prüfliste Ist das Bauteil schon drin',
      },
      {
        groesse: 'Elektro-Zusatzheizer im Turmgerät',
        wert: '3 bis 9 kW — belegte Beispiele: Buderus 9 kW, NIBE 9 kW, Bosch 3 oder 9 kW, Daikin 6 oder 9 kW, Vaillant 8,5 kW',
        quelle: 'Recherche Bauformen, Prüfliste Ist das Bauteil schon drin',
      },
      {
        groesse: 'Wärmeübertragerfläche im eingebauten Speicher',
        wert: 'nur für Wolf CHC belegt: 2,3 m² bei 180 l und 3,0 m² bei 280 l; für die übrigen Hersteller nicht veröffentlicht',
        quelle: 'Recherche Bauformen, Abschnitt Speicher mit Rohrwendel gegen Frischwasserstation',
      },
    ],
    herstellernamen: [
      { hersteller: 'Vaillant', bezeichnung: 'uniTOWER plus VIH QW 190/7 E' },
      { hersteller: 'Viessmann', bezeichnung: 'Vitocal 250-A Compact, früher 252-A' },
      { hersteller: 'Buderus', bezeichnung: 'WLW176i/186i T180 — Pufferprinzip „Integriert in Inneneinheit", Hydraulik-Nr. 6721847239' },
      { hersteller: 'Bosch', bezeichnung: 'Compress 5800i/6800i „M" (All-in-One); Inneneinheit AWMS beziehungsweise AWMB' },
      { hersteller: 'Wolf', bezeichnung: 'CHC-Monoblock 200 und 300 (Kompaktcenter), z. B. Zeichnung 32-52-006-274' },
      { hersteller: 'NIBE', bezeichnung: 'VVM S320 — 180 l Trinkwasser plus 26 l Heizpuffer im selben Gehäuse' },
      { hersteller: 'Daikin', bezeichnung: 'Altherma 3 H HT beziehungsweise 3 R MT, Modell F (180 oder 230 l Edelstahl); ECH2O als Frischwasservariante' },
      { hersteller: 'Stiebel Eltron', bezeichnung: 'Schaltplancode W1 = 6 (Warmwasserspeicher in Wärmepumpe integriert) beziehungsweise HSBC 180/200/300' },
      { hersteller: 'Ochsner', bezeichnung: 'MULTI TOWER, Gerätekürzel T200-' },
      { hersteller: 'Samsung', bezeichnung: 'ClimateHub (EHS Mono HT R290), 200 oder 260 l Edelstahl' },
      { hersteller: 'Mitsubishi Electric', bezeichnung: 'Ecodan Speichermodule ERPT20X-YM9E (200 l) und ERPT30X-YM9EE (300 l)' },
      { hersteller: 'LG', bezeichnung: 'Therma V R290 mit Kombigerät (Warmwasserspeicher, Elektroheizer und Ausdehnungsgefäß in einem Gerät)' },
    ],
    wissenIds: ['hyd-trinkwasser-umschaltventil-ladepumpe', 'hyd-trinkwasser-sicherheitsgruppe', 'hyd-trinkwasser-anschlussregeln', 'hyd-legionellenschutz-umsetzung', 'hyd-wt-flaeche-trinkwasser', 'hyd-heizstab-einbindung'],
    quelle: 'Recherche Bauformen, Abschnitt 6 (Turm- und Kompaktgerät mit integriertem Trinkwasserspeicher) und Abschnitt 9 (Master-Tabelle, Prüfliste)',
    belastbarkeit: 'primaer',
  },

  // -------------------------------------------------------------------------
  // HERST-H-03 — Hydrosplit mit Hydraulikstation. Der Kältekreis bleibt außen,
  // die Verbindungsleitungen führen Wasser, die Wasserhydraulik sitzt in der
  // Inneneinheit. Die typischen Fehler sind hier beidseitig: das
  // Ausdehnungsgefäß und das Umschaltventil doppelt zu zeichnen, weil sie in
  // der Station stecken — oder umgekehrt die Pumpe zu vergessen, weil sie bei
  // manchen Herstellern in der Außeneinheit sitzt. Deshalb trägt jedes Bauteil
  // der Station hier ein `entfaelltWennImGeraet`.
  // -------------------------------------------------------------------------
  {
    id: 'herst-h-03-hydrosplit-station',
    kennung: 'HERST-H-03',
    name: 'Hydrosplit mit Hydraulikstation',
    kurz: 'Kältekreis vollständig im Außengerät, Wasserhydraulik in einer Hydraulikstation im Haus; die Verbindungsleitungen führen Wasser und brauchen deshalb Frostschutz.',
    merkmale: {
      anbindung: 'direkt',
      trinkwasser: 'speicher',
      kreise: 2,
      gemischt: true,
      uebergabe: ['flaeche', 'heizkoerper'],
      bivalent: 'kein',
      kuehlung: 'keine',
      kaskade: false,
      bauformen: ['hydrosplit'],
    },
    bedingungen: [
      {
        id: 'station-bauteile-nicht-doppelt',
        text: 'Was in der Hydraulikstation sitzt, wird nicht ein zweites Mal ins Bild genommen.',
        beleg: 'Recherche Bauformen, Master-Tabelle Zeile 3: die Station enthält typischerweise Umwälzpumpe, Ausdehnungsgefäß (10 bis 24 l), Sicherheitsventil 3 bar, Dreiwege-Umschaltventil, Elektro-Zusatzheizer (3 bis 9 kW), Drucksensor, Schlamm- oder Magnetfilter und die Regelung. Die dort genannten Fehlerbilder sind ausdrücklich das doppelt gezeichnete Ausdehnungsgefäß und das doppelt gezeichnete Umschaltventil.',
        art: 'hart',
      },
      {
        id: 'pumpenlage-pruefen',
        text: 'Die Lage der Umwälzpumpe ist geräteweise zu prüfen; sie kann auch in der Außeneinheit sitzen.',
        beleg: 'Recherche Bauformen, Abschnitt 5.2: die Vaillant Hydraulikstation VWZ MEH enthält Ausdehnungsgefäß, Sicherheitsventil, Dreiwege-Ventil, Heizstab und Drucksensor, aber keine Umwälzpumpe — die sitzt in der aroTHERM plus. Das Fehlerbild ist hier die vergessene Pumpe. Die Prüfliste hält fest: nie aus der Bauform ableiten.',
        art: 'hart',
      },
      {
        id: 'trinkwasserspeicher-extern',
        text: 'Der Trinkwasserspeicher ist bei dieser Bauform extern.',
        beleg: 'Recherche Bauformen, Master-Tabelle Zeile 3: bauseits zu ergänzen sind Trinkwasserspeicher, Pufferspeicher falls der Mindestwasserinhalt nicht erreicht wird, Heizkreisverteiler, Frostschutzmaßnahme für die Außenleitung, Absperrungen und Kondensatablauf am Außengerät.',
        art: 'hart',
      },
      {
        id: 'frostschutz-wasserleitung',
        text: 'Zwischen Außengerät und Station liegt Wasser; eine Frostschutzmaßnahme ist erforderlich.',
        beleg: 'Recherche Bauformen, Abschnitt 4.4: es liegt Wasser im Außengerät und in den Verbindungsleitungen, es gilt dasselbe wie beim Monoblock. Der Satz, Hydrosplit habe kein Frostrisiko, ist falsch.',
        art: 'hart',
      },
      {
        id: 'flussschalter-bei-glykol',
        text: 'Bei Glykolzusatz ist ein zusätzlicher Strömungswächter erforderlich.',
        beleg: 'Daikin verlangt bei Glykolzusatz die Installation eines Flussschalters und das Setzen des zugehörigen Parameters, weil der interne Durchflussmesser bei Glykol und tiefen Temperaturen keinen Wert anzeigt.',
        art: 'hart',
      },
      {
        id: 'laengenbegrenzung-hydraulik',
        text: 'Die zulässige Länge der wasserführenden Verbindung ist begrenzt und geräteabhängig.',
        beleg: 'Belegte Herstellerwerte: bei Daikin Altherma 3 Hydrosplit maximal 10 m zwischen Außengerät und Speicher sowie maximal 10 m Höhenunterschied; Wolf nennt für die Verbindungsleitung DN 25 bis DN 50, mindestens 19 mm Dämmung, im Freien mit UV- und Pickschutz, maximal 30 m einfache Länge. Daikin verweist darüber hinaus auf ein eigenes Berechnungswerkzeug.',
        art: 'hart',
      },
      {
        id: 'keine-armaturen-in-der-verbindung',
        text: 'In der Verbindung zwischen Innen- und Außeneinheit dürfen außer je einem Absperrventil mit Entleerung in Vor- und Rücklauf keine hydraulischen Komponenten sitzen.',
        beleg: 'Wolf CHA-16/20 Monoblock, Planungsinformation.',
        art: 'hart',
      },
      B_HERSTELLER_BINDEND,
    ],
    erzeugerkreis: [
      { kind: 'heatpump-outdoor', label: 'Außeneinheit mit vollständigem Kältekreis' },
      { kind: 'shutoff', label: 'Absperrventil mit Entleerung im Vorlauf der Verbindungsleitung' },
      {
        kind: 'hydraulic-station',
        label: 'Hydraulikstation (Inneneinheit ohne Verdichter)',
        hinweis: 'Sie führt die Wasserhydraulik; die folgenden Bauteile stecken je nach Gerät bereits darin.',
      },
      { kind: 'pump', label: 'Umwälzpumpe', entfaelltWennImGeraet: 'pump', hinweis: 'Meist in der Station, bei einigen Herstellern jedoch in der Außeneinheit.' },
      { kind: 'electric-heater', label: 'Elektro-Zusatzheizer', optional: true, entfaelltWennImGeraet: 'backupHeater' },
      { kind: 'valve-diverter', label: 'Dreiwege-Umschaltventil Heizung/Warmwasser', entfaelltWennImGeraet: 'diverter' },
      { kind: 'safety-valve', label: 'Sicherheitsventil 3 bar', entfaelltWennImGeraet: 'safetyGroup' },
      { kind: 'pressure-gauge', label: 'Manometer', entfaelltWennImGeraet: 'safetyGroup' },
      { kind: 'expansion-vessel', label: 'Membran-Ausdehnungsgefäß', entfaelltWennImGeraet: 'expansionVessel' },
      { kind: 'flow-switch', label: 'Volumenstromwächter', entfaelltWennImGeraet: 'flowSwitch', hinweis: 'Bei Glykolbetrieb auch dann zusätzlich erforderlich, wenn ein interner Durchflussmesser vorhanden ist.' },
      { kind: 'dirt-separator', label: 'Schlamm- und Magnetitabscheider', entfaelltWennImGeraet: 'dirtSeparator' },
      { kind: 'buffer', label: 'Pufferspeicher', optional: true, entfaelltWennImGeraet: 'buffer', hinweis: 'Nur, wenn der Mindestwasserinhalt sonst nicht erreicht wird.' },
      { kind: 'manifold', label: 'Heizkreisverteiler, bauseits' },
      { kind: 'shutoff', label: 'Absperrventil mit Entleerung im Rücklauf der Verbindungsleitung' },
      { kind: 'heatpump-outdoor', label: 'Rücklaufeintritt Außeneinheit' },
    ],
    heizkreis: [
      { kind: 'shutoff', label: 'Absperrventil Heizkreis' },
      { kind: 'valve-3way', label: 'Dreiwege-Mischer, motorisch', optional: true, hinweis: 'Nur im gemischten Kreis.' },
      { kind: 'pump', label: 'Umwälzpumpe Heizkreis', optional: true, hinweis: 'Entfällt beim einzigen ungemischten Kreis, wenn die Stationspumpe ihn direkt versorgt.' },
      { kind: 'check-valve', label: 'Rückschlagklappe' },
      { kind: 'sensor', label: 'Vorlauftemperaturfühler' },
      { kind: 'temperature-limiter', label: 'Maximaltemperaturwächter Flächenheizung', optional: true },
      { kind: 'floor-loop', label: 'Wärmeübergabe (Heizfläche bzw. Heizkörper)' },
    ],
    trinkwasserzweig: trinkwasserSpeicher(),
    auslegung: [
      {
        groesse: 'Membran-Ausdehnungsgefäß in der Hydraulikstation',
        wert: '10 bis 24 l — belegte Beispiele: Vaillant VWZ MEH 10 l, Viessmann Vitocal 250-A Inneneinheit 18 l, Stiebel Eltron HM Trend 24 l',
        quelle: 'Recherche Bauformen, Abschnitt 4.2',
      },
      {
        groesse: 'Elektro-Zusatzheizer in der Hydraulikstation',
        wert: '3 bis 9 kW — belegte Beispiele: Vaillant 8,5 kW, Stiebel Eltron 8,8 kW bei 400 V, Panasonic 3 oder 6 kW, Daikin 6 oder 9 kW',
        quelle: 'Recherche Bauformen, Abschnitt 4.2',
      },
      {
        groesse: 'Maximale Länge der wasserführenden Verbindung',
        wert: 'Daikin Altherma 3 Hydrosplit: höchstens 10 m Leitungslänge und 10 m Höhenunterschied; Wolf: höchstens 30 m einfache Länge, DN 25 bis DN 50, mindestens 19 mm Dämmung',
        quelle: 'Daikin Kurzanleitung Monoblock; Wolf CHA-16/20 Planungsinformation',
      },
      {
        groesse: 'Mindestwasservolumen',
        wert: 'Daikin Hydrosplit 20 l; Stiebel WPL-A ohne Puffer 20 l bei geöffneten Heizkreisen',
        quelle: 'Daikin Kurzanleitung Monoblock; Stiebel Eltron Bedienungs- und Installationsanleitung',
      },
      {
        groesse: 'Abtau-Volumenstrom',
        wert: '20 bis 22 l/min (Daikin)',
        quelle: 'Daikin Kurzanleitung Monoblock',
      },
      A_SPREIZUNG_HEIZUNG,
      A_WT_FLAECHE,
    ],
    herstellernamen: [
      { hersteller: 'Panasonic', bezeichnung: 'Hydraulischer Split Bi-Bloc, Inneneinheit WH-SDC' },
      { hersteller: 'Daikin', bezeichnung: 'Hydro-Monoblock beziehungsweise Altherma 3 H MT/HT Hydrobox F/W' },
      { hersteller: 'Weishaupt', bezeichnung: 'Biblock — Außengerät mit Hydraulikeinheit, z. B. Plan 18 00 0 1 01 01 0 0 0' },
      { hersteller: 'Stiebel Eltron', bezeichnung: 'Hydraulikmodul HM Trend; Schaltplancode K2 = 1 oder 2' },
      { hersteller: 'Vaillant', bezeichnung: 'Hydraulikstation VWZ MEH 97/6 und 97/7 — Grenzfall ohne eigene Umwälzpumpe' },
      { hersteller: 'Viessmann', bezeichnung: 'Vitocal 250-A Inneneinheit mit 4/3-Wege-Ventil und 16 l Pufferspeicher' },
      { hersteller: 'Bosch', bezeichnung: 'Compress 5800i/6800i Variante „E" — reine Hydraulikeinheit ohne Speicher' },
      { hersteller: 'Mitsubishi Electric', bezeichnung: 'Ecodan Hydromodul ERPX-YM9E' },
      { hersteller: 'LG', bezeichnung: 'Therma V R290 mit Hydrogerät' },
      { hersteller: 'Ochsner', bezeichnung: 'Hydro-Modul, Gerätekürzel AMHM- und AE1830HM-' },
    ],
    wissenIds: ['hyd-monoblock-split', 'hyd-verbindungsleitungen-idu-odu', 'hyd-durchflusssensor', 'hyd-durchflusssensor-glykol-pflicht', 'hyd-glykol-herstellerkonflikt', 'hyd-frostschutz-alternativen', 'hyd-magnetitabscheider', 'hyd-restfoerderhoehe'],
    quelle: 'Recherche Bauformen, Abschnitt 4 (Hydrosplit) und Abschnitt 9 (Master-Tabelle, Prüfliste); Wolf CHA-16/20 Planungsinformation; Daikin Kurzanleitung Monoblock',
    belastbarkeit: 'primaer',
  },
];

// ---------------------------------------------------------------------------
// Zugriff
// ---------------------------------------------------------------------------

/** Eine Vorlage über ihre Id holen. */
export function schemaVorlage(id: string): SchemaVorlage | undefined {
  return SCHEMA_KATALOG.find((v) => v.id === id);
}

/** Alle Vorlagen einer Anbindungsart, in Katalogreihenfolge. */
export function vorlagenNachAnbindung(a: Anbindung): SchemaVorlage[] {
  return SCHEMA_KATALOG.filter((v) => v.merkmale.anbindung === a);
}

export const ANBINDUNG_LABELS: Record<Anbindung, string> = {
  direkt: 'Direkt, ohne Speicher',
  reihenpuffer: 'Reihenpuffer im Rücklauf',
  parallelpuffer: 'Parallelpuffer',
  weiche: 'Hydraulische Weiche',
  kombispeicher: 'Kombispeicher',
};

export const TRINKWASSERART_LABELS: Record<Trinkwasserart, string> = {
  keine: 'Ohne Trinkwassererwärmung',
  speicher: 'Trinkwasserspeicher',
  kombispeicher: 'Kombispeicher',
  frischwasser: 'Frischwasserstation',
  integriert: 'Speicher im Gerät',
};
