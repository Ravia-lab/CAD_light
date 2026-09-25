/**
 * Prüfung eines berechneten Anlagenschemas gegen die Regeln der Fachliteratur.
 *
 * **Was dieses Modul tut.** Es bekommt ein fertiges Fließbild — die Bauteile
 * und Leitungen aus `buildSchematic()`, dazu das Auslegungsergebnis aus
 * `designPlant()` und die Anlagendefinition aus dem Modell — und sucht darin
 * nach den Fehlern, die in den Leitfäden von BWP und VdZ, in den
 * Planungsunterlagen der Hersteller und in DIN EN 12828 namentlich als Fehler
 * benannt sind. Es liefert eine Liste von Befunden, jeder mit Quelle im
 * Klartext. Es ändert nichts.
 *
 * **Warum getrennt vom Erzeugen der Schemata.** `buildSchematic()` zeichnet,
 * was die Auslegung hergibt: es kennt seine eigenen Regeln und hält sie
 * naturgemäß ein. Ein Generator, der sich selbst prüft, prüft nur, ob er tut,
 * was er tut — er findet genau die Fehler nicht, die er selbst macht. Dazu
 * kommt der zweite Fall: das Schema ist von Hand bearbeitet worden
 * (`PlantDefinition.schematic.manual`), und dann steht auf dem Blatt, was ein
 * Mensch gezeichnet hat, nicht was das Programm gerechnet hat. Beides prüft
 * nur eine Instanz, die *nach* dem Zeichnen auf das fertige Bild schaut und
 * dabei nichts anderes benutzt als das Bild selbst. Deshalb liegt die
 * Bewertung hier und nicht dort — und deshalb enthält dieses Modul keine
 * einzige Zeile, die etwas erzeugt oder ergänzt.
 *
 * **Was eine leere Befundliste bedeutet — und was nicht.** Sie bedeutet:
 * keine der hier hinterlegten Regeln hat angeschlagen. Sie bedeutet **nicht**,
 * dass die Anlage richtig geplant ist, und sie ist **keine Freigabe**. Die
 * Regeln decken einen kleinen, gut belegbaren Ausschnitt ab: was sich aus
 * Bauteilart, Stutzen, Leitungsart, Speicherart und den gerechneten Zahlen
 * ablesen lässt. Alles, was Betriebsweise, Einstellung, Montageort, Fühlersitz,
 * Regelparameter, Schall, Kondensat oder Wasserqualität betrifft, sieht dieses
 * Modul überhaupt nicht — und für die Feinplanung gilt ohnehin, was der BWP
 * seinem eigenen Leitfaden voranstellt: „Für die Feinplanung sind die Vorgaben
 * der Hersteller bindend." Eine Anlage, die hier ohne Befund durchläuft, ist
 * genau so weit geprüft, wie diese Liste reicht.
 *
 * **Belege.** Jede Regel nennt ihre Quelle. Wo keine Fachquelle gefunden
 * wurde, sondern nur eine logische Ableitung aus getrennten Anschlussgruppen
 * vorliegt, steht das ausdrücklich im Beleg — eine Ableitung als Norm
 * auszugeben wäre der schlimmere Fehler.
 */

import type {
  PipeService,
  PlantDefinition,
  PlantStorage,
  SchematicComponent,
  SchematicKind,
  SchematicLink,
  StorageKind,
} from '../types/bim';
import type { PlantDesignResult } from './plantDesign';
import { zugeordneteVorlage } from './schemaZuordnung';

// ---------------------------------------------------------------------------
// Ergebnis
// ---------------------------------------------------------------------------

/**
 * Wie schwer ein Befund wiegt.
 *
 * `fehler`: die Anlage darf so nicht gebaut werden oder wird nicht
 * funktionieren — ein Verstoß gegen eine Norm oder eine ausdrückliche
 * Herstellervorgabe. `warnung`: nach der Fachliteratur falsch oder überflüssig,
 * die Anlage läuft aber. `hinweis`: eine Angabe zum Prüfen, weil das Programm
 * den maßgeblichen Sachverhalt nicht kennt.
 */
export type SchemaBefundGrad = 'fehler' | 'warnung' | 'hinweis';

export interface SchemaBefund {
  /** Stabile Kennung, z. B. 'ueberstroemventil-ohne-speicher'. */
  id: string;
  grad: SchemaBefundGrad;
  titel: string;
  /** Was ist falsch und was wäre richtig. */
  text: string;
  /** Quelle im Klartext. */
  beleg: string;
  url?: string;
  /** Themenschlüssel für die Wissensbasis, falls passend. */
  thema?: string;
}

/**
 * Was geprüft wird.
 *
 * Bewusst drei getrennte Stücke statt eines Dokuments: das Schema ist das,
 * was auf dem Blatt steht — auch dann, wenn es von Hand bearbeitet wurde und
 * mit der Auslegung nicht mehr übereinstimmt. Die Auslegung liefert die
 * Zahlen, gegen die geprüft wird (Leistung, Wasserinhalt, Volumenströme,
 * Speicherwahl). Die Anlagendefinition liefert das, was der Planer gesetzt
 * hat und was in der Auslegung nicht mehr auftaucht — etwa eine hydraulische
 * Weiche, die `designPlant` nicht als Puffer führt.
 */
export interface SchemaPruefEingabe {
  /** Die Bauteile des Fließbilds, erzeugte und von Hand ergänzte. */
  komponenten: readonly SchematicComponent[];
  /** Die Leitungen des Fließbilds. */
  verbindungen: readonly SchematicLink[];
  /** Das Auslegungsergebnis, zu dem das Schema gehört. */
  auslegung: PlantDesignResult;
  /** Die Anlagendefinition aus dem Modell, soweit vorhanden. */
  anlage?: PlantDefinition;
}

// ---------------------------------------------------------------------------
// Quellen
// ---------------------------------------------------------------------------

/**
 * Die Belege in Langform.
 *
 * Sie stehen hier zusammen, damit dieselbe Quelle in mehreren Regeln
 * buchstabengleich zitiert wird. Ein Beleg, der je nach Regel anders lautet,
 * ist beim Gegenlesen nicht wiederzufinden.
 */
const QUELLE = {
  bwp: {
    text: 'BWP – Bundesverband Wärmepumpe e. V., Leitfaden Hydraulik, Schema 1/2 („Überströmventil")',
    url: 'https://www.waermepumpe.de/uploads/media/BWP_LF_Hydraulik_final_web.pdf',
  },
  vdz: {
    text: 'VdZ, „Umsteigen auf die Wärmepumpe – Leitfaden für den Fachhandwerker", S. 8 und Fehlertabelle T5',
    url: 'https://files.vdzev.de/pdfs/umsteigen-auf-die-waermepumpe/VdZ_Waermepumpen_WEB_Einzelseiten.pdf',
  },
  wolf: {
    text: 'Wolf CHA-16/20 Monoblock, Planungsinformation 4801847|202311',
    url: 'https://woltanic.de/documents/wolf/CHA-16_20-400V-M2_Monoblock-Luft___Wasser-Waermepumpe_Planungsinformation_11_2023.pdf',
  },
  bosch: {
    text: 'Bosch/Junkers Compress 7000i AW, Planungsunterlage 6 720 820 615, Kap. 4.2 und 4.13',
    url: 'https://www.heizungsdiscount24.de/pdf/Junkers-Bosch-Compress-CS7000iAW-3-13-kW-Planungsunterlage.pdf',
  },
  viessmannSchema: {
    text: 'Viessmann Anlagenschema 4804407_2110_01 (Vitocal 250-A, Heizkreis ohne Mischer)',
    url: 'https://viessmann-projektant.pl/baza-urzadzen/vitocal250a/pliki/4804407_2110_01.pdf',
  },
  viessmannPa: {
    text: 'Viessmann Vitocal, Planungsanleitung, S. 154 f. („Hydraulische Bedingungen für den Sekundärkreis")',
    url: 'https://www.manualslib.de/manual/493137/Viessmann-Vitocal-Series.html?page=154',
  },
  daikin: {
    text: 'Daikin Altherma 3 M, Referenzhandbuch für den Monteur 4PDE620241-1, Kap. 8.1.3 (Wassermenge, Glykol, Flussschalter)',
    url: 'https://www.daikin.eu/content/dam/document-library/Installer-reference-guide/heat/air-to-water-heat-pump-low-temperature/EBLA09-163V33W1,V3,W1,EDLA09-16DV33W1,V3,W1_4PDE620241-1_Installer%20reference%20guide_German.pdf',
  },
  din12828: {
    text: 'DIN EN 12828, Tabelle der sicherheitstechnischen Einrichtungen (Zusammenstellung SBZ Monteur)',
    url: 'https://www.sbz-monteur.de/sites/default/files/wp-content/uploads/2015/08/Tabelle-DIN-EN-12828.pdf',
  },
  shkPuffer: {
    text: 'HaustechnikDialog SHKwissen, „Wärmepumpen-Puffer" (Reihen-, Parallel-, Trennpuffer, Weiche)',
    url: 'https://www.haustechnikdialog.de/SHKwissen/3464/Waermepumpen-Puffer',
  },
  begFaq: {
    text: 'KfW/BAFA, Liste der technischen FAQ BEG EM, Version 7.0 (06/2026), Nr. 8.01/8.02',
    url: 'https://www.kfw.de/PDF/Download-Center/F%C3%B6rderprogramme-(Inlandsf%C3%B6rderung)/PDF-Dokumente/6000004864_BEG_TFAQ_EM.pdf',
  },
  geg71: {
    text: '§ 71 GEG (Volltext) — enthält keine Zähler- oder Messeinrichtungspflicht',
    url: 'https://www.gesetze-im-internet.de/geg/__71.html',
  },
} as const;

// ---------------------------------------------------------------------------
// Hilfsmittel
// ---------------------------------------------------------------------------

/** Reihenfolge der Grade in der Ausgabe. */
const GRAD_RANG: Record<SchemaBefundGrad, number> = { fehler: 0, warnung: 1, hinweis: 2 };

/** Speicherarten, die die Erzeugerseite hydraulisch von der Verteilung trennen. */
const TRENNENDE_SPEICHER: readonly StorageKind[] = ['buffer-parallel', 'separator'];

/** Speicherarten, die überhaupt Anlagenvolumen beisteuern. */
const VOLUMEN_SPEICHER: readonly StorageKind[] = ['buffer-series', 'buffer-parallel', 'separator', 'combi'];

/** Leitungsarten, die Heizungswasser führen. */
const HEIZUNG: readonly PipeService[] = ['heating-flow', 'heating-return'];

/** Leitungsarten, die Trinkwasser führen. */
const TRINKWASSER: readonly PipeService[] = ['cold-water', 'hot-water', 'circulation'];

/** Stutzen der Trinkwasserseite je Bauteilart. */
const TRINKWASSER_STUTZEN: Partial<Record<SchematicKind, readonly string[]>> = {
  cylinder: ['cold', 'dhw'],
  freshwater: ['cold', 'dhw'],
};

/** Stutzen der Heizungsseite je Bauteilart. */
const HEIZUNG_STUTZEN: Partial<Record<SchematicKind, readonly string[]>> = {
  cylinder: ['flow', 'return'],
  freshwater: ['prim-flow', 'prim-return'],
};

/**
 * Stutzen, die einen Speicher als **Trennspeicher** beschalten.
 *
 * Ein Reihenpuffer liegt in Reihe im Rücklauf und hat dort genau zwei
 * Anschlüsse. Wer ihn an `gen-flow`/`sys-flow` hängt, hat ihn als Trennpuffer
 * gezeichnet — und behauptet damit eine hydraulische Trennung, die er nicht
 * leistet.
 */
const TRENNSPEICHER_VORLAUF: readonly string[] = ['gen-flow', 'sys-flow'];

/** Hersteller, die Frostschutzmittel im Heizkreis ausdrücklich ausschließen. */
const GLYKOL_VERBOT: readonly string[] = ['bosch', 'buderus', 'junkers', 'wolf'];

/** Erkennt einen Temperaturwächter/Sicherheitstemperaturbegrenzer am Namen. */
const WAECHTER_MUSTER =
  /temperaturw(ä|ae)chter|maximalthermostat|maxth|sicherheitstemperaturbegrenzer|\bstb\b|schutz-?temperaturregler|sicherheitsthermostat/i;

/** Erkennt einen Strömungs-/Flussschalter am Namen. */
const FLUSSSCHALTER_MUSTER =
  /flussschalter|str(ö|oe)mungsw(ä|ae)chter|volumenstromw(ä|ae)chter|durchflusssensor|durchflusssch|flow ?switch/i;

/** Erkennt einen Verteilbalken am Namen. */
const BALKEN_MUSTER = /balken|sammler|verteiler/i;

function enthaelt<T>(liste: readonly T[], wert: T): boolean {
  return liste.indexOf(wert) >= 0;
}

/** Zählt eine Liste von Namen lesbar auf. */
function aufzaehlung(namen: readonly string[]): string {
  if (namen.length === 0) return '';
  if (namen.length === 1) return namen[0];
  return `${namen.slice(0, -1).join(', ')} und ${namen[namen.length - 1]}`;
}

// ---------------------------------------------------------------------------
// Die Prüfung
// ---------------------------------------------------------------------------

/**
 * Prüft ein Anlagenschema und liefert die Befunde.
 *
 * Die Reihenfolge ist festgelegt und hängt nicht von der Reihenfolge der
 * Bauteile ab: erst `fehler`, dann `warnung`, dann `hinweis`, innerhalb der
 * Grade aufsteigend nach `id`. Damit ergibt derselbe Anlagenstand immer
 * dieselbe Liste — sonst wäre ein Vergleich zweier Stände wertlos.
 *
 * Die Funktion ist rein: sie liest nur, sie ändert nichts an der Eingabe und
 * greift auf nichts außerhalb zu.
 */
export function pruefeSchema(eingabe: SchemaPruefEingabe): SchemaBefund[] {
  const befunde: SchemaBefund[] = [];
  const { komponenten, verbindungen, auslegung, anlage } = eingabe;

  const melde = (b: SchemaBefund): void => {
    befunde.push(b);
  };

  // --- Nachschlagewerke über das Schema ------------------------------------
  const nachId = new Map<string, SchematicComponent>();
  for (const c of komponenten) nachId.set(c.id, c);

  /** Alle Bauteile einer Art. */
  const alle = (kind: SchematicKind): SchematicComponent[] => komponenten.filter((c) => c.kind === kind);
  /** Gibt es mindestens ein Bauteil dieser Art? */
  const gibt = (kind: SchematicKind): boolean => komponenten.some((c) => c.kind === kind);

  /** Alle Leitungen, die an einem Bauteil hängen. */
  const leitungenAn = (id: string): SchematicLink[] => verbindungen.filter((l) => l.from === id || l.to === id);
  /** Der Stutzen, an dem eine Leitung ein bestimmtes Bauteil trifft. */
  const stutzenAn = (l: SchematicLink, id: string): string | undefined =>
    l.from === id ? l.fromPort : l.to === id ? l.toPort : undefined;
  /** Die unmittelbar angeschlossenen Bauteile. */
  const nachbarn = (id: string): SchematicComponent[] => {
    const raus: SchematicComponent[] = [];
    for (const l of leitungenAn(id)) {
      const anderes = nachId.get(l.from === id ? l.to : l.from);
      if (anderes && anderes.id !== id) raus.push(anderes);
    }
    return raus;
  };

  // --- Nachschlagewerke über die Anlage ------------------------------------
  const speicherDerAnlage: PlantStorage[] = anlage ? Object.values(anlage.storages) : [];
  const pufferDerAuslegung = auslegung.buffer.selected;

  /** Alle Speicher, die für die Prüfung zählen — ausgelegte und gepflegte. */
  const speicher: PlantStorage[] = pufferDerAuslegung
    ? [pufferDerAuslegung, ...speicherDerAnlage.filter((s) => s.id !== pufferDerAuslegung.id)]
    : speicherDerAnlage;

  /** Trennt irgendetwas die Erzeugerseite hydraulisch von der Verteilung? */
  const hydraulischGetrennt =
    speicher.some((s) => enthaelt(TRENNENDE_SPEICHER, s.kind)) || gibt('separator');

  /** Gibt es überhaupt einen Behälter im Heizkreis? */
  const speicherVorhanden =
    speicher.some((s) => enthaelt(VOLUMEN_SPEICHER, s.kind)) || gibt('buffer') || gibt('separator');

  const leistung = auslegung.selected?.capacityAtDesign ?? auslegung.requiredCapacity;
  const glykolAnteil = auslegung.safety?.glycol?.fraction ?? anlage?.design.glycolFraction ?? 0;

  // =========================================================================
  // A — Überströmventil
  // =========================================================================
  const ueberstroemer = alle('overflow-valve');

  /*
   * Regel 1. Ein Überströmventil sichert den **Volumenstrom**, nicht das
   * **Volumen**. Ohne Behälter fehlt der Anlage der Wasserinhalt für die
   * Abtauung, und das Ventil verdeckt den Mangel, statt ihn zu beheben.
   * Beleg: [VdZ] S. 8 — „Überströmventile ohne Speicher führen durch das
   * fehlende Anlagenvolumen zu Betriebsstörungen."
   */
  if (ueberstroemer.length > 0 && !speicherVorhanden) {
    melde({
      id: 'ueberstroemventil-ohne-speicher',
      grad: 'fehler',
      titel: 'Überströmventil ohne Speicher',
      text:
        `Das Schema führt ein Überströmventil, aber keinen Puffer- oder Trennspeicher. ` +
        `Ein Überströmventil sichert den Mindestvolumenstrom, es schafft kein Anlagenvolumen: beim Abtauen ` +
        `entnimmt die Wärmepumpe die Energie dem Wasserinhalt, und der ist hier nicht vorhanden. ` +
        `Richtig ist eines von beiden — Anlagenvolumen über einen Reihenpuffer im Rücklauf nachweisen ` +
        `(Richtwert 3–5 l/kW, hier rund ${Math.round(leistung * 3)}–${Math.round(leistung * 5)} l bei ${leistung.toFixed(1)} kW) ` +
        `oder hydraulisch trennen. Das Ventil bleibt dann als Sicherung des Mindestvolumenstroms, nicht als Ersatz für den Inhalt.`,
      beleg: QUELLE.vdz.text,
      url: QUELLE.vdz.url,
      thema: 'ueberstroemventil',
    });
  }

  /*
   * Regel 2. Trennspeicher und Überströmventil sind ein Entweder-oder.
   * Beleg: [Wolf] — „Falls **kein** Trennspeicher eingesetzt wird,
   * Mindestheizwasserdurchsatz durch ein Überströmventil sicherstellen."
   * Hinter einer hydraulischen Trennung fördert die Erzeugerpumpe ohnehin
   * unabhängig von den Stellantrieben; das Ventil erzeugt nur einen Bypass.
   */
  if (ueberstroemer.length > 0 && hydraulischGetrennt) {
    melde({
      id: 'ueberstroemventil-mit-trennspeicher',
      grad: 'warnung',
      titel: 'Überströmventil neben hydraulischer Trennung',
      text:
        `Die Erzeugerseite ist bereits hydraulisch von der Verteilung getrennt; zusätzlich steht ein ` +
        `Überströmventil im Schema. Es hat dort keine Funktion: die Erzeugerpumpe fördert unabhängig davon, ` +
        `wie viele Stellantriebe zufahren. Was bleibt, ist ein Kurzschluss zwischen Vor- und Rücklauf, der ` +
        `Vorlauftemperatur in den Rücklauf gibt. Richtig ist das eine oder das andere — Trennspeicher **oder** ` +
        `Reihenspeicher mit Überströmventil.`,
      beleg: `${QUELLE.wolf.text}; gleichlautend ${QUELLE.vdz.text}`,
      url: QUELLE.wolf.url,
      thema: 'ueberstroemventil',
    });
  }

  /*
   * Regel 3. Die Pumpenkennlinie steht nicht im Modell — geprüft werden kann
   * nur, dass ein Überströmventil vorhanden ist und die Einstellung damit zur
   * Frage wird. Beleg: [BWP] Schema 1/2 — „nicht in Verbindung mit
   * Pumpenkennlinie Δp variabel oder Autoadapt"; die Heizkreispumpe ist auf
   * Konstant- oder Δp-konstant-Kennlinie zu stellen.
   */
  if (ueberstroemer.length > 0) {
    melde({
      id: 'ueberstroemventil-pumpenkennlinie',
      grad: 'hinweis',
      titel: 'Pumpenkennlinie zum Überströmventil prüfen',
      text:
        `Zum Überströmventil gehört eine Pumpe mit Konstant- oder Δp-konstant-Kennlinie. Δp-variabel und ` +
        `Autoadapt sind mit einem Überströmventil unzulässig: die Pumpe senkt bei zufahrenden Ventilen den ` +
        `Differenzdruck, das Überströmventil schließt daraufhin, und der Mindestvolumenstrom bricht genau dann ` +
        `weg, wenn er gebraucht wird. Welche Kennlinie eingestellt ist, steht nicht im Modell — an der Pumpe prüfen. ` +
        `Zum Einbauort: möglichst dicht an der Wärmeübergabe, sonst wird der lange Verteilweg nicht mehr durchströmt.`,
      beleg: QUELLE.bwp.text,
      url: QUELLE.bwp.url,
      thema: 'ueberstroemventil',
    });
  }

  // =========================================================================
  // B — Speicher und Entkopplung
  // =========================================================================

  /*
   * Regel 4. Mindestanlagenvolumen. Beleg: [BWP] Schema 1 — 3–5 l/kW
   * Heizleistung bei Direktanbindung ohne Puffer; [VdZ] S. 7 — 3 l/kW als
   * kleinstes dauerhaft durchströmtes Volumen. Führt das Gerätedatenblatt
   * einen eigenen Wert, gilt der höhere von beiden.
   */
  const mindestNachDatenblatt = auslegung.selected?.model.minSystemVolume ?? 0;
  const mindestNachFaustregel = leistung * 3;
  const mindestVolumen = Math.max(mindestNachDatenblatt, mindestNachFaustregel);
  if (leistung > 0 && auslegung.volume.total > 0 && auslegung.volume.total < mindestVolumen) {
    const fehlend = Math.round(mindestVolumen - auslegung.volume.total);
    melde({
      id: 'mindestanlagenvolumen-unterschritten',
      grad: speicherVorhanden ? 'warnung' : 'fehler',
      titel: 'Anlagenvolumen zu klein',
      text:
        `Der Wasserinhalt der Anlage beträgt ${Math.round(auslegung.volume.total)} l; gefordert sind ` +
        `${Math.round(mindestVolumen)} l` +
        (mindestNachDatenblatt > mindestNachFaustregel
          ? ` nach Gerätedatenblatt (${Math.round(mindestNachDatenblatt)} l)`
          : ` nach der Faustregel 3 l/kW bei ${leistung.toFixed(1)} kW`) +
        `. Es fehlen ${fehlend} l. ` +
        (speicherVorhanden
          ? `Der vorhandene Speicher reicht nicht aus — Volumen vergrößern.`
          : `Ohne Puffer bricht beim Abtauen die Vorlauftemperatur ein und der Verdichter taktet; ein Reihenpuffer im Rücklauf ist die einfachste Abhilfe.`) +
        ` Zu beachten: das Mindestvolumen darf nicht hinter Absperrvorrichtungen liegen — Heizkreise mit ` +
        `Thermostatventilen bleiben bei der Rechnung unberücksichtigt, der Inhalt muss auch dann verfügbar sein, ` +
        `wenn alle Ventile geschlossen sind.`,
      beleg: `${QUELLE.bwp.text}; ${QUELLE.viessmannPa.text}; ${QUELLE.daikin.text}`,
      url: QUELLE.bwp.url,
      thema: 'mindestanlagenvolumen',
    });
  }

  /*
   * Regel 5. Weiche oder Parallelpuffer bei einem zweiten Wärmeerzeuger ohne
   * eigene Pumpe. Beleg: [Bosch] — „Wenn der zweite Wärmeerzeuger keine eigene
   * Heizungspumpe hat, dürfen keine hydraulische Weiche und kein paralleler
   * Pufferspeicher verwendet werden." Geprüft wird topologisch: hängt an dem
   * gezeichneten Kessel eine Pumpe?
   */
  const zweitErzeuger = alle('boiler');
  if (hydraulischGetrennt && zweitErzeuger.length > 0) {
    const ohnePumpe = zweitErzeuger.filter((k) => !nachbarn(k.id).some((x) => x.kind === 'pump'));
    if (ohnePumpe.length > 0) {
      melde({
        id: 'trennung-bei-zweiterzeuger-ohne-pumpe',
        grad: 'fehler',
        titel: 'Hydraulische Trennung bei zweitem Erzeuger ohne eigene Pumpe',
        text:
          `${aufzaehlung(ohnePumpe.map((k) => `„${k.label}"`))} ${ohnePumpe.length === 1 ? 'ist' : 'sind'} als zweiter ` +
          `Wärmeerzeuger gezeichnet, ohne dass eine eigene Heizungspumpe daran hängt — zugleich trennt eine ` +
          `hydraulische Weiche oder ein Parallelpuffer die Erzeugerseite. Diese Kombination ist unzulässig: der ` +
          `zweite Erzeuger wird nicht durchströmt, seine Wärme kommt nicht in den Speicher. Richtig ist entweder ` +
          `eine eigene Pumpe am zweiten Erzeuger oder die Beimischung über ein Dreiwege-Mischventil in der ` +
          `Erzeugerleitung statt der Trennung.`,
        beleg: QUELLE.bosch.text,
        url: QUELLE.bosch.url,
        thema: 'bivalenz',
      });
    }
  }

  /*
   * Regel 6. Reihenpuffer falsch eingebunden. Er liegt **im Rücklauf** des
   * Sekundärkreises und hat dort zwei Anschlüsse; Vorlaufstutzen eines
   * Trennspeichers hat er nicht, und Volumenstromentkopplung leistet er nicht.
   * Beleg: [Viessmann-PA] S. 155 (Einbauort im Rücklauf); [Wolf]
   * (Entweder-oder Trennspeicher/Überströmventil); [SHKwissen-Puffer]
   * (im Reihenspeicher „auf jeder Höhe die gleiche Temperatur").
   */
  const reihenSpeicher = speicher.filter((s) => s.kind === 'buffer-series');
  if (reihenSpeicher.length > 0) {
    const reihenBauteile = komponenten.filter(
      (c) =>
        c.kind === 'buffer' &&
        reihenSpeicher.some(
          (s) => c.storageId === s.id || c.label === s.label || (c.spec ?? '').includes('Reihenpuffer'),
        ),
    );
    const falsch = reihenBauteile.filter((c) => {
      const leitungen = leitungenAn(c.id);
      return leitungen.some((l) => {
        const stutzen = stutzenAn(l, c.id);
        const amVorlaufStutzen = stutzen !== undefined && enthaelt(TRENNSPEICHER_VORLAUF, stutzen);
        return amVorlaufStutzen || l.service === 'heating-flow';
      });
    });
    if (falsch.length > 0) {
      melde({
        id: 'reihenpuffer-falsch-eingebunden',
        grad: 'fehler',
        titel: 'Reihenpuffer wie ein Trennspeicher beschaltet',
        text:
          `${aufzaehlung(falsch.map((c) => `„${c.label}"`))} ist als Reihenpuffer ausgelegt, hängt im Schema aber ` +
          `am Vorlauf beziehungsweise an den Vorlaufstutzen eines Trennspeichers. Der Reihenpuffer liegt in Reihe ` +
          `im **Rücklauf** des Sekundärkreises und hat dort genau zwei Anschlüsse; er liefert Wasserinhalt für die ` +
          `Abtauung und Laufzeitverlängerung — er entkoppelt keine Volumenströme und ersetzt kein Überströmventil. ` +
          `So gezeichnet behauptet das Blatt eine hydraulische Trennung, die es nicht gibt: es bleibt bei einer ` +
          `Pumpe und einem Strang. Entweder den Puffer in den Rücklauf legen oder ihn als Trennspeicher auslegen — ` +
          `dann aber mit eigener Pumpe je Verbraucherkreis.`,
        beleg: `${QUELLE.viessmannPa.text}; ${QUELLE.shkPuffer.text}`,
        url: QUELLE.viessmannPa.url,
        thema: 'reihenpuffer',
      });
    }
  }

  // =========================================================================
  // C — Mischer, Regelung und Verteilung
  // =========================================================================

  /*
   * Regel 7. Unnötiger Mischer. Beleg: [VdZ] T5 — „Unnötiger Einbau von
   * Mischern"; Folge: „Mischer erhöhen die Vorlauftemperaturen der
   * Wärmepumpe, dadurch geringere Effizienz und hoher Verbrauch"; Maßnahme:
   * „Mischer nur, wenn zwingend erforderlich, z. B.: Mehrkreisanlagen,
   * Kühlung, Pufferspeicher mit Übertemperatur."
   *
   * Geprüft wird der klar entscheidbare Fall: der Kreis fährt die höchste
   * Vorlauftemperatur der Anlage, es gibt also nichts herunterzumischen. Ob
   * gekühlt wird und ob Fremdwärme in den Puffer geht, steht nicht im Modell —
   * ein Kollektor oder Kessel im Schema schaltet die Regel deshalb ab.
   */
  const erzeugerVorlauf = Math.max(
    anlage?.design.flowTemperature ?? 0,
    ...auslegung.circuits.map((c) => c.circuit.flowTemperature),
    0,
  );
  const fremdwaerme = gibt('solar') || gibt('boiler');
  if (!fremdwaerme && erzeugerVorlauf > 0) {
    const ueberfluessig = auslegung.circuits
      .filter((c) => c.circuit.mixed && c.circuit.flowTemperature >= erzeugerVorlauf - 2)
      .map((c) => `„${c.circuit.label}"`);
    if (ueberfluessig.length > 0) {
      melde({
        id: 'mischer-ohne-notwendigkeit',
        grad: 'warnung',
        titel: 'Mischer ohne erkennbare Notwendigkeit',
        text:
          `${aufzaehlung(ueberfluessig)} ${ueberfluessig.length === 1 ? 'ist' : 'sind'} als gemischter Kreis geführt, ` +
          `${ueberfluessig.length === 1 ? 'fährt' : 'fahren'} aber die höchste Vorlauftemperatur der Anlage ` +
          `(${erzeugerVorlauf} °C) — es ist nichts herunterzumischen. Ein Mischer erhöht dann nur die ` +
          `Vorlauftemperatur der Wärmepumpe und kostet Effizienz; jedes Grad schlägt mit rund 2 bis 2,5 % zu Buche. ` +
          `Zwingend ist ein Mischer nur bei zwei Kreisen mit unterschiedlichem Temperaturniveau, bei Kühlbetrieb mit ` +
          `taupunktkritischem Vorlauf und bei Puffern mit Übertemperatur aus Fremdwärme. Trifft einer dieser Fälle ` +
          `zu, ist er im Modell nicht hinterlegt — sonst den Mischer entfernen und witterungsgeführt über den ` +
          `Erzeuger regeln.`,
        beleg: QUELLE.vdz.text,
        url: QUELLE.vdz.url,
        thema: 'mischer',
      });
    }
  }

  /*
   * Regel 8. Ungemischte Flächenheizung ohne Temperaturwächter. Beleg:
   * [Viessmann-Schema] — „Fußbodenheizkreise müssen mit einem
   * Temperaturwächter zur Maximaltemperaturbegrenzung ausgestattet sein";
   * [Wolf] Maximalthermostat MaxTh, der Erzeuger und Heizkreispumpe abschaltet;
   * [Panasonic] Sicherheitsthermostat. Ohne Mischer fehlt jede zweite Instanz
   * zwischen Erzeugertemperatur und Estrich.
   */
  const ungemischteFlaeche = auslegung.circuits.filter((c) => c.circuit.kind === 'floor' && !c.circuit.mixed);
  const waechterVorhanden = komponenten.some(
    (c) => (c.kind === 'sensor' || c.kind === 'thermometer') && WAECHTER_MUSTER.test(c.label),
  );
  if (ungemischteFlaeche.length > 0 && !waechterVorhanden) {
    melde({
      id: 'flaechenheizung-ohne-temperaturwaechter',
      grad: 'fehler',
      titel: 'Ungemischte Flächenheizung ohne Temperaturwächter',
      text:
        `${aufzaehlung(ungemischteFlaeche.map((c) => `„${c.circuit.label}"`))} ${ungemischteFlaeche.length === 1 ? 'ist' : 'sind'} ` +
        `ungemischt an den Erzeuger geführt; ein Temperaturwächter zur Maximaltemperaturbegrenzung ist im Schema ` +
        `nicht vorhanden. Ohne Mischer steht zwischen der Vorlauftemperatur des Erzeugers und dem Estrich nichts — ` +
        `im Störfall (Warmwasserladung, Legionellenschaltung, Reglerfehler) läuft die volle Temperatur in den Boden. ` +
        `Richtig: Temperaturwächter beziehungsweise Maximalthermostat im Vorlauf jedes Flächenheizkreises, verdrahtet ` +
        `auf die Abschaltung von Wärmeerzeuger und Heizkreispumpe; mehrere Wächter in Reihe.`,
      beleg: `${QUELLE.viessmannSchema.text}; ${QUELLE.wolf.text}`,
      url: QUELLE.viessmannSchema.url,
      thema: 'temperaturwaechter',
    });
  }

  /*
   * Regel 9. Mehrere Kreise ohne Verteilbalken. Ein Verteilbalken ist die
   * Aussage, dass alle Kreise an derselben Vorlauftemperatur und demselben
   * Differenzdruck hängen; ohne ihn ist auf dem Blatt nicht abzulesen, wo sich
   * der Volumenstrom teilt, und damit auch nicht, wo abgeglichen wird.
   * Beleg: [BWP] Schema 3 (Verteiler mit eigener Kreispumpe je Heizkreis);
   * [VdZ] T5 zum hydraulischen Abgleich.
   */
  const balkenVorhanden = komponenten.some(
    (c) => (c.kind === 'node' || c.kind === 'manifold') && BALKEN_MUSTER.test(c.label),
  );
  if (auslegung.circuits.length > 1 && !balkenVorhanden) {
    melde({
      id: 'verteilbalken-fehlt',
      grad: 'warnung',
      titel: 'Mehrere Heizkreise ohne Verteilbalken',
      text:
        `Die Anlage hat ${auslegung.circuits.length} Heizkreise, im Schema ist aber kein Verteilbalken gezeichnet. ` +
        `Damit ist nicht dargestellt, an welcher Stelle sich der Volumenstrom teilt und woran die Kreise hängen. ` +
        `Richtig: Vor- und Rücklaufbalken mit je einer Absperrung pro Kreis, damit ein Kreis ohne Entleeren der ` +
        `Anlage abgesperrt werden kann, und mit der Möglichkeit, die Aufteilung einzuregulieren — ohne das nimmt ` +
        `der kurze Weg das Wasser und der lange bleibt kalt.`,
      beleg: `${QUELLE.bwp.text}; ${QUELLE.vdz.text}`,
      url: QUELLE.bwp.url,
      thema: 'verteiler',
    });
  }

  // =========================================================================
  // D — Trinkwasser
  // =========================================================================

  /*
   * Regel 10. Heizungswasser an einem Trinkwasserstutzen — oder umgekehrt.
   *
   * **Beleg ausdrücklich als logische Ableitung.** Die Herstellerschemata
   * definieren Heiz- und Trinkwasserseite als getrennte Anschlussgruppen
   * ([Stiebel] Pos. 28, [Viessmann-Schema], [Vaillant] Pos. 8b); für den
   * konkreten Ausführungsfehler „Heizungsvorlauf am Kaltwasseranschluss" ließ
   * sich in der Recherche keine belastbare Fachquelle finden. Diese Regel ist
   * deshalb die Verletzung der getrennten Anschlussgruppen, nicht ein belegter
   * Fehlerbefund aus der Literatur.
   */
  const vertauschteStutzen: string[] = [];
  for (const l of verbindungen) {
    for (const id of [l.from, l.to]) {
      const bauteil = nachId.get(id);
      if (!bauteil) continue;
      const stutzen = stutzenAn(l, id);
      if (!stutzen) continue;
      const trinkwasserStutzen = TRINKWASSER_STUTZEN[bauteil.kind];
      const heizungStutzen = HEIZUNG_STUTZEN[bauteil.kind];
      if (trinkwasserStutzen && enthaelt(trinkwasserStutzen, stutzen) && enthaelt(HEIZUNG, l.service)) {
        vertauschteStutzen.push(`Heizungsleitung an „${bauteil.label}", Stutzen „${stutzen}"`);
      }
      if (heizungStutzen && enthaelt(heizungStutzen, stutzen) && enthaelt(TRINKWASSER, l.service)) {
        vertauschteStutzen.push(`Trinkwasserleitung an „${bauteil.label}", Stutzen „${stutzen}"`);
      }
    }
  }
  if (vertauschteStutzen.length > 0) {
    melde({
      id: 'heizungswasser-an-trinkwasserstutzen',
      grad: 'fehler',
      titel: 'Heiz- und Trinkwasserseite vermischt',
      text:
        `Das Schema führt eine Leitung über die Systemgrenze zwischen Heizungs- und Trinkwasserseite: ` +
        `${aufzaehlung(vertauschteStutzen)}. Der Speicher wird über seinen Wärmeübertrager geladen — Heizungswasser ` +
        `und Trinkwasser berühren sich nicht. Die Ladeleitung gehört an die Heizungsstutzen, die Trinkwasserseite ` +
        `ausschließlich an Kaltwasser- und Warmwasseranschluss, abgesichert über die Kaltwasser-Sicherheitsgruppe ` +
        `(Absperrung, Rückflussverhinderer, Sicherheitsventil, Manometer, gegebenenfalls Trinkwasser-Ausdehnungsgefäß). ` +
        `Ein Fließbild, das diese Verbindung zeichnet, behauptet genau das, was durch Systemtrennung ausgeschlossen sein muss.`,
      beleg:
        'Logische Ableitung aus den getrennten Anschlussgruppen der Herstellerschemata ([Stiebel] Pos. 28, ' +
        '[Viessmann-Schema], [Vaillant] Pos. 8b) — keine Fachquelle benennt diesen Ausführungsfehler ausdrücklich.',
      url: QUELLE.viessmannSchema.url,
      thema: 'systemtrennung',
    });
  }

  // =========================================================================
  // E — Pflichtarmaturen
  // =========================================================================

  /*
   * Regel 11. Sicherheitsgruppe am Wärmeerzeuger. Beleg: [DIN12828-Tab] —
   * Sicherheitsventil „am höchsten Punkt des Wärmeerzeugers oder in
   * unmittelbarer Nähe an der Vorlaufleitung", Manometer mit Druckprüfstutzen,
   * Entleerung an jedem entleerbaren Abschnitt.
   *
   * Das Sicherheitsventil des Trinkwassererwärmers zählt hier nicht mit: es
   * wird daran erkannt, dass an ihm eine Heizungsleitung hängt.
   */
  const heizungsSicherheitsventil = alle('safety-valve').some((v) =>
    leitungenAn(v.id).some((l) => enthaelt(HEIZUNG, l.service)),
  );
  const fehlendeSicherheitsgruppe: string[] = [];
  if (!heizungsSicherheitsventil) fehlendeSicherheitsgruppe.push('Sicherheitsventil im Erzeugerkreis');
  if (!gibt('pressure-gauge')) fehlendeSicherheitsgruppe.push('Manometer');
  if (!gibt('filling-valve')) fehlendeSicherheitsgruppe.push('Füll- und Entleerungsarmatur (KFE-Hahn)');
  if (fehlendeSicherheitsgruppe.length > 0) {
    melde({
      id: 'sicherheitsgruppe-unvollstaendig',
      grad: 'fehler',
      titel: 'Sicherheitsgruppe am Wärmeerzeuger unvollständig',
      text:
        `Im Schema fehlt: ${aufzaehlung(fehlendeSicherheitsgruppe)}. Nach DIN EN 12828 gehört zum Wärmeerzeuger ` +
        `ein bauteilgeprüftes Sicherheitsventil am höchsten Punkt des Erzeugers oder unmittelbar in der ` +
        `Vorlaufleitung, senkrecht eingebaut, mit eigener steigender Zuleitung von höchstens 1 m und eigener, ` +
        `nicht absperrbarer Ausblaseleitung; dazu ein Manometer mit Druckprüfstutzen und Entleerungen an jedem ` +
        `entleerbaren Abschnitt. Die Sicherheitsleitung darf nicht absperrbar sein und keine Schmutzfänger oder ` +
        `Formstücke enthalten.`,
      beleg: QUELLE.din12828.text,
      url: QUELLE.din12828.url,
      thema: 'sicherheitseinrichtungen',
    });
  }

  /*
   * Regel 12. Ausdehnungsgefäß. Beleg: [DIN12828-Tab] Pos. 5 —
   * Membran-Druckausdehnungsgefäß an der Ausdehnungsleitung, Pos. 5a
   * Absperrung „gegen unbeabsichtigtes Schließen gesichert (z. B.
   * Kappenventil)".
   */
  if (!gibt('expansion-vessel')) {
    melde({
      id: 'ausdehnungsgefaess-fehlt',
      grad: 'fehler',
      titel: 'Ausdehnungsgefäß fehlt',
      text:
        `Im Schema ist kein Membran-Druckausdehnungsgefäß gezeichnet. Ohne Gefäß steigt der Druck beim Aufheizen ` +
        `bis zum Ansprechdruck, das Sicherheitsventil bläst ab, die Anlage verliert Wasser und zieht beim Abkühlen ` +
        `Luft. Richtig: Gefäß an der Ausdehnungsleitung, davor eine gegen unbeabsichtigtes Schließen gesicherte ` +
        `Absperrung (Kappenventil) mit Entleerung — zwischen Erzeuger und Gefäß darf keine absperrbare Armatur liegen.` +
        (auslegung.safety
          ? ` Die Auslegung nennt ${auslegung.safety.selectedVessel} l mit ${auslegung.safety.prePressure.toFixed(1)} bar Vordruck.`
          : ''),
      beleg: QUELLE.din12828.text,
      url: QUELLE.din12828.url,
      thema: 'ausdehnungsgefaess',
    });
  }

  /*
   * Regel 13. Schmutzfänger/Schlammabscheider mit Magnetit vor der
   * Wärmepumpe. Beleg: [DIN12828-Tab] Pos. 6 — Schmutzfänger „bauseits immer
   * im Kesselrücklauf"; [Bosch] — Magnetitpartikel lagern sich am
   * Permanentmagneten der Hocheffizienzpumpe an, „dadurch verringert sich die
   * Leistung der Pumpe bis hin zur Blockade"; [Wolf] — „Schmutzfänger und
   * Schlammabscheider mit Magnetitabscheider in den Rücklauf zur ODU einbauen".
   */
  const abscheider = [...alle('dirt-separator'), ...alle('strainer')];
  if (abscheider.length === 0) {
    melde({
      id: 'schlammabscheider-fehlt',
      grad: 'fehler',
      titel: 'Schmutzfänger/Magnetitabscheider fehlt',
      text:
        `Im Rücklauf vor dem Wärmeerzeuger ist weder ein Schmutzfänger noch ein Schlammabscheider gezeichnet. ` +
        `Der Verflüssiger der Wärmepumpe ist ein gelöteter Plattenwärmetauscher mit Spaltweiten im ` +
        `Zehntelmillimeterbereich; der Schlamm aus Stahlheizkörpern und Stahlrohr ist überwiegend Magnetit — ` +
        `ferromagnetisch, feinkörnig und für einen rein gravimetrischen Abscheider zu leicht. Er setzt außerdem den ` +
        `Permanentmagneten der Hocheffizienzpumpe zu, bis diese blockiert. Richtig: Schlammabscheider mit ` +
        `Magnetstab im Rücklauf, unmittelbar vor dem Erzeuger, mit Abschlämmventil.`,
      beleg: `${QUELLE.din12828.text}; ${QUELLE.bosch.text}; ${QUELLE.wolf.text}`,
      url: QUELLE.bosch.url,
      thema: 'schlammabscheider',
    });
  } else {
    /*
     * Regel 14. Er sitzt im Rücklauf, nicht im Vorlauf — sonst läuft alles,
     * was zwischen Abscheider und Erzeuger anfällt, ungefiltert in den
     * Wärmetauscher. Geprüft wird an der Leitungsart der angeschlossenen
     * Leitungen; ein Bauteil ohne Anschluss wird nicht bewertet.
     */
    const imVorlauf = abscheider.filter((a) => {
      const leitungen = leitungenAn(a.id).filter((l) => enthaelt(HEIZUNG, l.service));
      return leitungen.length > 0 && !leitungen.some((l) => l.service === 'heating-return');
    });
    if (imVorlauf.length > 0) {
      melde({
        id: 'schlammabscheider-nicht-im-ruecklauf',
        grad: 'warnung',
        titel: 'Schmutzfänger nicht im Rücklauf',
        text:
          `${aufzaehlung(imVorlauf.map((a) => `„${a.label}"`))} hängt ausschließlich an Vorlaufleitungen. ` +
          `Der Schmutzfänger gehört bauseits immer in den Rücklauf zum Wärmeerzeuger — er ist das letzte Bauteil ` +
          `vor dem Wärmetauscher. Im Vorlauf schützt er den Erzeuger nicht, sondern erst die Verbraucher dahinter.`,
        beleg: `${QUELLE.din12828.text}; ${QUELLE.wolf.text}`,
        url: QUELLE.din12828.url,
        thema: 'schlammabscheider',
      });
    }
  }

  /*
   * Regel 15. Absperrarmaturen zum Ausbau von Erzeuger und Pumpe. Beleg:
   * [DIN12828-Tab] (Absperrung des Wärmeerzeugers); [Wolf] — „In den
   * Verbindungsleitungen von der IDU zur ODU jeweils Absperrhähne mit
   * Entleerungsfunktion". Grad `warnung` und nicht `fehler`, weil dieselben
   * Quellen ausdrücklich sagen, dass Absperrorgane in Prinzipschemata „nicht
   * komplett eingezeichnet" sind und anlagenspezifisch zu ergänzen bleiben.
   */
  /*
   * Geprüft werden **Wärmeerzeuger**, nicht Pumpen.
   *
   * Bis 1.12.0 stand `pump` mit in dieser Liste. Das ist strenger als die
   * Referenzzeichnung: der BWP-Leitfaden zeichnet den gemischten Heizkreis
   * ausdrücklich als „Absperrventil → 3-Wege-Mischer → Umwälzpumpe →
   * Rückschlagklappe" — die Kreispumpe hat dort also **keine** unmittelbar
   * benachbarte Absperrung, und zwar in allen elf Schemata. Eine Regel, die
   * bei der maßgeblichen Musterzeichnung anschlägt, meldet keinen Mangel,
   * sondern sich selbst.
   *
   * Die Hauptumwälzpumpe bleibt trotzdem absperrbar: sie liegt zwischen der
   * Absperrung am Erzeuger und der auf der Anlagenseite. Das prüft diese
   * Regel nicht — dafür bräuchte es eine Wegsuche im Leitungsgraphen.
   */
  const innenteile = [...alle('heatpump-indoor'), ...alle('hydraulic-station')];
  /*
   * Geprüft wird das Bauteil, das **der Anlage zugewandt** ist.
   *
   * Bei Monoblock, Hydrosplit und Split hängt die Außeneinheit an der
   * Inneneinheit, und zwischen beiden liegt eine feste Verbindung ohne
   * Anlagenwasser aus dem Verteilnetz. Absperrbar sein muss die Stelle, an
   * der das Gerät ans Netz geht — also die Inneneinheit. Die Außeneinheit
   * einzeln zu fordern hieße, an einer Kältemittelleitung ein Heizungsventil
   * zu verlangen.
   */
  const absperrbar = [
    ...innenteile,
    ...(innenteile.length ? [] : alle('heatpump-outdoor')),
    ...alle('boiler'),
  ];
  /*
   * `every` und nicht `some`: gefordert ist eine Absperrung **je** ausbaubarem
   * Bauteil. Mit `some` genügte eine einzige Absperrung irgendwo im Bild,
   * damit die Regel für alle übrigen schweigt — eine Wärmepumpe mit
   * Absperrhähnen und eine Heizkreispumpe ohne wären dann unauffällig, obwohl
   * genau die Pumpe das Bauteil ist, das man im Betrieb tauscht.
   */
  const ohneAbsperrung = absperrbar.filter((g) => !nachbarn(g.id).some((x) => x.kind === 'shutoff'));
  const hatAbsperrung = ohneAbsperrung.length === 0;
  if (!hatAbsperrung) {
    melde({
      id: 'absperrung-erzeuger-fehlt',
      grad: 'warnung',
      titel: 'Keine Absperrung am Wärmeerzeuger',
      text:
        `Am Wärmeerzeuger ist keine Absperrarmatur gezeichnet. Ohne sie lässt er sich nicht ausbauen, ohne die ` +
        `Anlage zu entleeren. Richtig: je eine Absperrung in Vor- und Rücklauf am Erzeuger, damit auch die ` +
        `dazwischenliegende Umwälzpumpe abgetrennt werden kann; in den Verbindungsleitungen zur Außeneinheit mit ` +
        `Entleerungsfunktion. Zwischen Erzeuger und Sicherheitsventil beziehungsweise Ausdehnungsgefäß darf ` +
        `dagegen keine absperrbare Armatur liegen. Prinzipschemata zeigen Absperrorgane erklärtermaßen nicht ` +
        `vollständig — sie sind anlagenspezifisch zu ergänzen.`,
      beleg: `${QUELLE.din12828.text}; ${QUELLE.wolf.text}`,
      url: QUELLE.wolf.url,
      thema: 'absperrarmaturen',
    });
  }

  /*
   * Regel 16. Mikroblasen-/Luftabscheider. Beleg: [DIN12828-Tab] Pos. 7 —
   * „Luftabscheider, Einbau im Vorlauf empfohlen"; [Wolf] — „Am höchsten Punkt
   * der Anlage einen Entlüfter installieren"; [NIBE] führt den automatischen
   * Gasabscheider in der Montagecheckliste. Empfehlung, keine Pflicht —
   * deshalb `hinweis`.
   */
  if (!gibt('air-separator')) {
    melde({
      id: 'luftabscheider-fehlt',
      grad: 'hinweis',
      titel: 'Kein Mikroblasenabscheider',
      text:
        `Das Schema führt keinen Mikroblasen-/Luftabscheider. Er ist keine Pflichtarmatur, steht aber in den ` +
        `meisten Anlagen und in den Montagechecklisten der Hersteller: gelöstes Gas perlt an der heißesten Stelle ` +
        `aus, deshalb gehört er in den Vorlauf unmittelbar hinter den Erzeuger. Zusätzlich ein automatischer ` +
        `Entlüfter am höchsten Punkt der Anlage. Luft im System bedeutet Geräusche, schlechten Wärmeübergang und ` +
        `Korrosion.`,
      beleg: `${QUELLE.din12828.text}; ${QUELLE.wolf.text}`,
      url: QUELLE.din12828.url,
      thema: 'luftabscheider',
    });
  }

  /*
   * Regel 17. Wärmemengenzähler und Verbrauchserfassung.
   *
   * Die Rechtslage steht ausdrücklich im Text, weil sie gern verkürzt wird:
   * § 71 GEG enthält **keine** Zähler- oder Messeinrichtungspflicht. Die
   * BEG-Förderung verlangt Erfassung, aber nach [BEG-TFAQ] 8.01 „bestehen
   * keine Anforderungen" an Genauigkeit, die Technik muss „nicht geeicht" sein,
   * und „geräteintegrierte Bilanzierungen über die Regelung eines
   * Wärmeerzeugers" sind zulässig. Eine echte Zählerpflicht folgt nur aus der
   * HeizkostenV in Mehrparteiengebäuden (seit 01.10.2025).
   */
  if (!gibt('heat-meter')) {
    const einheiten = anlage?.dhw.units ?? 0;
    melde({
      id: 'waermemengenzaehler-fehlt',
      grad: 'hinweis',
      titel: 'Keine Verbrauchserfassung im Schema',
      text:
        `Im Schema ist kein Wärmemengenzähler gezeichnet. Zur Einordnung: § 71 GEG enthält **keine** Zähler- oder ` +
        `Messeinrichtungspflicht. Die BEG-Förderung verlangt, dass Energieverbräuche und erzeugte Wärmemengen ` +
        `erfasst werden — einschließlich der Hilfsstrommengen für Heizstab und Quellenpumpen —, stellt aber ` +
        `ausdrücklich keine Genauigkeitsanforderungen: die Technik muss nicht geeicht sein, und eine ` +
        `geräteintegrierte Bilanzierung über die Regelung des Wärmeerzeugers genügt. Viele Wärmepumpen bringen ` +
        `Durchflusssensor und Wärmemengenerfassung mit; dann ist nichts nachzurüsten, es gehört nur in den ` +
        `Nachweis. Eine echte Zählerpflicht folgt allein aus der HeizkostenV, und nur in Mehrparteiengebäuden ` +
        `(seit 01.10.2025; im selbstgenutzten Ein- und Zweifamilienhaus greift sie nicht).` +
        (einheiten > 2
          ? ` Die Anlage ist mit ${einheiten} Wohneinheiten gepflegt — hier ist die verbrauchsabhängige Abrechnung zu prüfen.`
          : ''),
      beleg: `${QUELLE.begFaq.text}; ${QUELLE.geg71.text}`,
      url: QUELLE.begFaq.url,
      thema: 'waermemengenzaehler',
    });
  }

  // =========================================================================
  // F — Frostschutz
  // =========================================================================

  /*
   * Regel 18. Glykol im Heizkreis, obwohl der Hersteller es ausschließt.
   * Beleg: [Bosch] — „Der Einsatz von Frostschutzmitteln ist nicht
   * freigegeben! Frostschutzmittel reduzieren die System-Effizienz um 10–15 %";
   * [Wolf] — „Keine Frostschutzmittel oder Inhibitoren verwenden."; [Daikin]
   * lässt Glykol dagegen mit Auflagen zu. Die Hersteller widersprechen sich —
   * deshalb wird der Konflikt benannt, nicht aufgelöst.
   */
  if (glykolAnteil > 0) {
    const hersteller = auslegung.selected?.model.manufacturer;
    const verbot = hersteller ? GLYKOL_VERBOT.some((h) => hersteller.toLowerCase().includes(h)) : false;
    melde({
      id: 'glykol-herstellerkonflikt',
      grad: verbot ? 'fehler' : 'warnung',
      titel: verbot ? 'Frostschutzmittel vom Hersteller ausgeschlossen' : 'Frostschutzmittel — Freigabe erforderlich',
      text:
        `Der Heizkreis ist mit ${Math.round(glykolAnteil)} Vol-% Frostschutzmittel gerechnet. ` +
        (verbot
          ? `„${hersteller}" schließt Frostschutzmittel im Heizkreis aus — Bosch: „Der Einsatz von ` +
            `Frostschutzmitteln ist nicht freigegeben", Wolf: „Keine Frostschutzmittel oder Inhibitoren ` +
            `verwenden". Wer es dennoch einsetzt, übernimmt als ausführender Fachbetrieb die Verantwortung. ` +
            `Entweder Gerät oder Frostschutzkonzept ändern.`
          : `Für den Einsatz ist die Materialfreigabe des Geräteherstellers einzuholen; die Herstellerpositionen ` +
            `widersprechen sich ausdrücklich. Zugelassenes Glykol nur mit Korrosionshemmern, kein Automobil-Glykol, ` +
            `keine verzinkten Rohre; Ethylenglykol ist giftig und in Anlagenteilen mit möglicher Verbindung zum ` +
            `Trinkwasser unzulässig.`) +
        ` In jedem Fall: die Effizienz sinkt um rund 10 bis 15 %, das zulässige Wasservolumen sinkt bei manchen ` +
        `Geräten deutlich, die Flüssigkeitskategorie der Füllleitung steigt nach DIN EN 1717 auf 4 (Systemtrenner ` +
        `Typ BA statt CA), und die Konzentration ist jährlich zu prüfen. Alternativen sind Frostschutzventile am ` +
        `tiefsten Punkt und die Frostschutzfunktion der Regelung — letztere wirkt nur bei anliegender Spannung.`,
      beleg: `${QUELLE.bosch.text}; ${QUELLE.wolf.text}; abweichend ${QUELLE.daikin.text}`,
      url: QUELLE.bosch.url,
      thema: 'frostschutz',
    });

    /*
     * Regel 19. Flussschalter bei Glykolbetrieb. Beleg: [Daikin] — „Wenn Sie
     * Glykol zum Wasser hinzufügen, müssen Sie auch einen Flussschalter
     * installieren (EKFLSW1) und [E-0D]=1 einstellen." Grund: der interne
     * Durchflussmesser zeigt bei Glykol und tiefen Temperaturen keinen Wert an.
     */
    const flussschalter = komponenten.some((c) => FLUSSSCHALTER_MUSTER.test(c.label));
    if (!flussschalter) {
      melde({
        id: 'flussschalter-fehlt-bei-glykol',
        grad: 'warnung',
        titel: 'Kein Volumenstromwächter bei Glykolbetrieb',
        text:
          `Bei Frostschutzbetrieb ist ein Flussschalter beziehungsweise Strömungswächter vorzusehen; im Schema ist ` +
          `keiner gezeichnet. Der geräteinterne Durchflussmesser zeigt bei Glykol und tiefen Temperaturen keinen ` +
          `Wert an — der Erzeuger merkt dann nicht, wenn der Volumenstrom ausbleibt, und der Plattenwärmetauscher ` +
          `friert beim Abtauen ein. Richtig: externen Flussschalter einbauen und in der Regelung aktivieren ` +
          `(bei Daikin EKFLSW1 mit [E-0D]=1).`,
        beleg: QUELLE.daikin.text,
        url: QUELLE.daikin.url,
        thema: 'volumenstromwaechter',
      });
    }
  }

  // -------------------------------------------------------------------------
  // Zwei Regeln, die das **Bild** prüfen und nicht die Stückliste
  // -------------------------------------------------------------------------
  //
  // Beide stehen als *harte* Bedingung im Schemakatalog (BWP-H-03), beide
  // sind am Entwurf vom 25.09.2026 aufgefallen — an einer von Hand
  // gezeichneten Übersicht, während das Programm die Regel samt Quelle längst
  // führte. Was nur im Katalogtext steht, prüft niemand; deshalb hier.
  {
    const puffer = alle('buffer');
    const speicher = alle('cylinder');
    const umschalter = alle('valve-diverter');

    /*
     * Regel 1 · Die Trinkwasserladung darf nicht über den Puffer laufen.
     *
     * Das Umschaltventil **schaltet um**: Im Warmwasserbetrieb geht die ganze
     * Leistung in den Trinkwasserspeicher, am Puffer vorbei. Führte der
     * einzige Weg dorthin durch den Puffer, wäre das eine andere Anlage —
     * eine, die den Puffer erst aufheizt und den Speicher aus dem Puffer
     * lädt.
     *
     * Geprüft wird durch Weglassen: Nimmt man die Pufferspeicher aus dem
     * Netz, muss das Umschaltventil den Trinkwasserspeicher immer noch
     * erreichen. Das ist die Aussage „führt nicht über den Puffer", ohne
     * jeden Pfad einzeln aufzählen zu müssen.
     */
    if (puffer.length && speicher.length && umschalter.length) {
      const gesperrt = new Set(puffer.map((c) => c.id));
      const nachbarn = new Map<string, string[]>();
      for (const l of verbindungen) {
        // Trinkwasserleitungen zählen hier nicht: der Weg, um den es geht,
        // ist der **Heizungsvorlauf** zur Ladeschlange.
        if (l.service !== 'heating-flow' && l.service !== 'heating-return') continue;
        if (gesperrt.has(l.from) || gesperrt.has(l.to)) continue;
        const anfuegen = (a: string, b: string): void => {
          const liste = nachbarn.get(a);
          if (liste) liste.push(b);
          else nachbarn.set(a, [b]);
        };
        anfuegen(l.from, l.to);
        anfuegen(l.to, l.from);
      }
      const erreichbar = (von: string, ziel: string): boolean => {
        const gesehen = new Set([von]);
        const rand = [von];
        while (rand.length) {
          const k = rand.pop()!;
          if (k === ziel) return true;
          for (const n of nachbarn.get(k) ?? []) {
            if (!gesehen.has(n)) {
              gesehen.add(n);
              rand.push(n);
            }
          }
        }
        return false;
      };
      const ohneWeg = umschalter.filter((u) => !speicher.some((sp) => erreichbar(u.id, sp.id)));
      if (ohneWeg.length === umschalter.length) {
        melde({
          id: 'trinkwasser-ueber-puffer',
          grad: 'fehler',
          titel: 'Die Trinkwasserladung läuft über den Pufferspeicher',
          text:
            'Vom Umschaltventil führt kein Weg zum Trinkwasserspeicher, der den Pufferspeicher ausspart. ' +
            'Das Umschaltventil schaltet aber um: Im Warmwasserbetrieb geht die ganze Leistung in den ' +
            'Trinkwasserspeicher, am Puffer vorbei. Richtig: Die Trinkwasserladung wird **vor** dem Puffer ' +
            'direkt am Gerät abgezweigt.',
          beleg: QUELLE.bwp.text + ' — Schema 3, Zeichnung: das Umschaltventil sitzt im Erzeugervorlauf vor dem Pufferanschluss.',
          url: QUELLE.bwp.url,
          thema: 'trinkwasser-vor-dem-puffer',
        });
      }
    }

    /*
     * Regel 2 · Der Parallelpuffer hat vier Anschlüsse.
     *
     * Erzeugervorlauf oben, Erzeugerrücklauf unten, Heizungsvorlauf oben,
     * Heizungsrücklauf unten. Mit zweien wäre er ein Reihenpuffer, und das
     * ist hydraulisch etwas anderes — der Reihenpuffer sitzt allein im
     * Rücklauf und braucht nur eine Pumpe.
     */
    for (const p of puffer) {
      const art = p.storageId ? anlage?.storages?.[p.storageId]?.kind : undefined;
      if (art !== 'buffer-parallel') continue;
      const anschluesse = leitungenAn(p.id).filter(
        (l) => l.service === 'heating-flow' || l.service === 'heating-return',
      ).length;
      if (anschluesse !== 4) {
        melde({
          id: 'parallelpuffer-anschlusszahl',
          grad: 'fehler',
          titel: `Parallelpuffer mit ${anschluesse} statt vier Anschlüssen`,
          text:
            `„${p.label}" ist als Parallelpuffer geführt, im Schema hängen aber ${anschluesse} Heizungsleitungen ` +
            'daran. Ein Parallelpuffer wird mit vier Anschlüssen eingebunden: Wärmepumpenvorlauf oben, ' +
            'Wärmepumpenrücklauf unten, Heizungsvorlauf oben, Heizungsrücklauf unten. Mit weniger ist es ' +
            'ein Reihenpuffer — der sitzt allein im Rücklauf und braucht nur eine Pumpe.',
          beleg: QUELLE.bwp.text + ' — Schema 3, Zeichnung S. 10.',
          url: QUELLE.bwp.url,
          thema: 'puffer-vier-anschluesse',
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Welche Musterlösung ist das?
  // -------------------------------------------------------------------------
  //
  // Ein erzeugtes Fließbild ohne Kennung ist anonym: Es zeigt eine Anlage,
  // aber nicht, nach welcher Musterlösung sie gebaut ist. Seit 1.51.0 wird
  // die Vorlage nicht mehr ausgewählt, sondern aus der Anlage abgeleitet —
  // und seitdem hatte niemand mehr geprüft, ob es überhaupt eine gibt.
  //
  // Nur wenn überhaupt ein Bild da ist: Die Frage „welche Musterlösung ist
  // das?" setzt ein Fließbild voraus. Auf ein leeres Blatt gehört sie nicht —
  // dort steht ohnehin schon, dass die Grundbauteile fehlen.
  if (komponenten.length > 0) {
    const zuordnung = zugeordneteVorlage(auslegung, anlage);
    if (!zuordnung) {
      melde({
        id: 'keine-musterloesung',
        grad: 'hinweis',
        titel: 'Zu dieser Anlage passt keine Vorlage des Katalogs',
        text:
          'Der Katalog führt die elf Musterlösungen des BWP-Leitfadens und weitere Vorlagen; keine davon ' +
          'deckt diese Anlage. Das ist kein Fehler — der Katalog hält Musterlösungen, nicht alle Anlagen. ' +
          'Es heißt nur: Das Fließbild lässt sich nicht auf eine bekannte Schaltung zurückführen, und wer ' +
          'es prüft, muss jede Leitung einzeln nachvollziehen.',
        beleg: QUELLE.bwp.text,
        url: QUELLE.bwp.url,
      });
    } else if (zuordnung.quelle === 'eingetragen' && zuordnung.passung === 'passt-nicht') {
      /*
       * Die eingetragene Vorlage gilt — sie wird nicht still durch eine
       * bessere ersetzt. Steht aber ein **hartes** Merkmal dagegen, ist das
       * Bild mit der Aussage darunter nicht mehr vereinbar, und dann gehört
       * es gesagt.
       */
      const harte = zuordnung.abweichungen.filter((a) => a.hart);
      melde({
        id: 'vorlage-passt-nicht',
        grad: 'warnung',
        titel: `Die eingetragene Vorlage ${zuordnung.vorlage.kennung} passt nicht zur Anlage`,
        text:
          `Im Projekt steht „${zuordnung.vorlage.name}". Dagegen spricht: ` +
          harte.map((a) => `${a.merkmal} — die Anlage hat ${a.anlage}, das Schema zeigt ${a.schema}`).join('; ') +
          '. Die Eintragung bleibt stehen; sie ist Ihre Aussage, nicht unsere. Zu ändern ist entweder die ' +
          'Anlage oder die Vorlage.',
        beleg: QUELLE.bwp.text,
        url: QUELLE.bwp.url,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Feste Reihenfolge: erst Grad, dann Kennung.
  //
  // `localeCompare` wäre hier falsch: die Sortierung hinge von der
  // Spracheinstellung der Laufzeit ab, und derselbe Anlagenstand ergäbe auf
  // zwei Rechnern zwei Reihenfolgen. Die Kennungen sind ASCII, der einfache
  // Vergleich genügt.
  // -------------------------------------------------------------------------
  return befunde.sort((a, b) => {
    const rang = GRAD_RANG[a.grad] - GRAD_RANG[b.grad];
    if (rang !== 0) return rang;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
