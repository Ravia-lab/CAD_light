/**
 * Schemavorschlag — welches Hydraulikschema passt zu dieser Anlage?
 * ---------------------------------------------------------------------------
 * Bis 1.12.0 gab es genau einen Weg zu einem Anlagenschema: einen Knopf, der
 * eines **erzeugte**. Was dabei herauskam, war das Ergebnis von einem Dutzend
 * Verzweigungen tief im Zeichner — richtig, aber ohne Namen und ohne
 * Alternative. Der Anwender konnte nicht sehen, dass seine Anlage ein
 * Standardfall ist, und schon gar nicht, welcher.
 *
 * Dieses Modul dreht die Richtung um: es **wählt aus** statt zu erzeugen. Der
 * Katalog (`schemaKatalog.ts`) hält die benannten Schemata mit ihren
 * Vorbedingungen; hier wird geprüft, welche davon zur ausgelegten Anlage
 * passen, wie gut, und **warum nicht**, wenn sie es nicht tun.
 *
 * Der letzte Punkt ist der eigentliche Ertrag. Eine Liste passender Schemata
 * ist bequem; eine Liste, die zu jedem verworfenen Schema den Satz mitliefert
 * „passt nicht, weil dieses Gerät einen Speicher mitbringt", ist eine
 * Begründung. Genau die fehlt in jedem Auslegungswerkzeug, das ich kenne.
 *
 * **Was hier nicht passiert:** es wird nichts gezeichnet und nichts
 * verändert. Die Funktion ist rein; das Übernehmen eines Vorschlags ist eine
 * Aktion des Store, nicht dieses Moduls.
 *
 * **Und eine Warnung, die auf jedes Ergebnis gehört:** ein passendes Schema
 * ist ein *Vorschlag*. Der BWP-Leitfaden, aus dem elf der Vorlagen stammen,
 * sagt über sich selbst: „Für die Feinplanung sind die Vorgaben der
 * Hersteller bindend." Dieses Modul ersetzt keine Planung; es sortiert
 * Musterlösungen nach ihrer Passung.
 */

import type { PlantDefinition, PumpForm, StorageKind } from '../types/bim';
import type { PlantDesignResult } from './plantDesign';
import type { Anbindung, SchemaVorlage, Trinkwasserart } from './schemaKatalog';
import { SCHEMA_KATALOG } from './schemaKatalog';

/**
 * Die Merkmale der tatsächlich ausgelegten Anlage.
 *
 * Sie stehen als eigener Typ da, weil sie aus zwei Quellen zusammenlaufen —
 * dem Auslegungsergebnis und der Anlagendefinition — und weil sie sich so
 * einzeln prüfen lassen. Wer sie aus einer Funktion heraus direkt gegen den
 * Katalog hält, kann später nicht mehr sagen, welche Angabe den Ausschlag
 * gegeben hat.
 */
export interface AnlagenMerkmale {
  anbindung: Anbindung;
  trinkwasser: Trinkwasserart;
  /** Zahl der Heizkreise. */
  kreise: number;
  /** Mindestens ein gemischter Kreis. */
  gemischt: boolean;
  /** Vorkommende Übergabearten. */
  uebergabe: ('flaeche' | 'heizkoerper')[];
  form?: PumpForm;
  /** Zweiter Wärmeerzeuger, soweit erkennbar. */
  bivalent: 'kein' | 'heizstab' | 'kessel' | 'festbrennstoff' | 'solar';
  /** Mehr als ein Erzeuger. */
  kaskade: boolean;
  /** Kühlbetrieb über dieselbe Hydraulik. */
  kuehlung: 'keine' | 'passiv' | 'aktiv';
  /** Weiterer Verbraucher am selben Erzeuger. */
  weitererVerbraucher: 'kein' | 'schwimmbad';
  /** Wasserinhalt der Anlage [l]. */
  volumen: number;
  /** Geforderter Mindestwasserinhalt des Geräts [l]. */
  mindestVolumen: number;
  /** Heizleistung im Auslegungspunkt [kW]. */
  leistung: number;
}

/**
 * Anbindungsart aus dem Auslegungsergebnis.
 *
 * Die Reihenfolge der Prüfung ist die Reihenfolge der Bestimmtheit: ein
 * Gerät mit eingebautem Speicher legt die Anbindung fest, ein gewählter
 * Speicher legt sie fest, und erst wenn nichts davon zutrifft, ist die
 * Anlage direkt angebunden.
 */
function anbindungVon(result: PlantDesignResult, plant?: PlantDefinition): Anbindung {
  const puffer = result.buffer.selected;
  const artVon = (kind: StorageKind | undefined): Anbindung | undefined => {
    switch (kind) {
      case 'buffer-series':
        return 'reihenpuffer';
      case 'buffer-parallel':
        return 'parallelpuffer';
      case 'separator':
        return 'weiche';
      case 'combi':
        return 'kombispeicher';
      default:
        return undefined;
    }
  };
  const ausPuffer = artVon(puffer?.kind);
  if (ausPuffer) return ausPuffer;
  // Von Hand eingetragene Speicher zählen genauso: wer einen Parallelpuffer
  // ins Anlagenblatt schreibt, hat die Anbindung entschieden.
  for (const s of Object.values(plant?.storages ?? {})) {
    const art = artVon(s.kind);
    if (art) return art;
  }
  return 'direkt';
}

/** Art der Trinkwassererwärmung aus dem Auslegungsergebnis. */
function trinkwasserVon(result: PlantDesignResult, plant?: PlantDefinition): Trinkwasserart {
  const eingebaut = result.selected?.model.contains?.cylinder ?? result.selected?.model.indoor?.integratedCylinder;
  if (eingebaut && eingebaut > 0) return 'integriert';
  const speicher = Object.values(plant?.storages ?? {});
  if (speicher.some((s) => s.kind === 'fresh-water-station')) return 'frischwasser';
  if (speicher.some((s) => s.kind === 'combi')) return 'kombispeicher';
  if (result.dhwStorage) return 'speicher';
  if ((plant?.dhw.units ?? 0) > 0) return 'speicher';
  return 'keine';
}

/**
 * Der zweite Wärmeerzeuger in der Sprache des Schemakatalogs.
 *
 * Der Katalog unterscheidet vier Fälle, das Anlagenblatt sieben Bauarten.
 * Zusammengefasst wird nach dem, was **hydraulisch** verschieden ist: ein
 * Festbrennstoffkessel braucht Rücklauftemperaturanhebung, thermische
 * Ablaufsicherung und ausnahmslos gemischte Heizkreise; ein Gas- oder
 * Ölkessel nicht. Solarthermie speist in den Speicher statt in den Kreis.
 * Fernwärme verhält sich wie ein Kessel ohne eigene Sicherheitstechnik.
 */
function zweitErzeugerArt(plant?: PlantDefinition): AnlagenMerkmale['bivalent'] | undefined {
  const zweit = plant?.secondGenerator;
  if (!zweit) return undefined;
  switch (zweit.art) {
    case 'solarthermie':
      return 'solar';
    case 'festbrennstoff':
    case 'pellet':
      return 'festbrennstoff';
    case 'gas':
    case 'oel':
    case 'fernwaerme':
      return 'kessel';
    case 'elektro-heizstab':
      return 'heizstab';
    default:
      return undefined;
  }
}

/** Merkmale der ausgelegten Anlage ablesen. */
export function anlagenMerkmale(result: PlantDesignResult, plant?: PlantDefinition): AnlagenMerkmale {
  const uebergabe = new Set<'flaeche' | 'heizkoerper'>();
  for (const c of result.circuits) {
    uebergabe.add(c.circuit.kind === 'floor' ? 'flaeche' : 'heizkoerper');
  }
  const model = result.selected?.model;
  const heizstab = model?.contains?.backupHeater ?? model?.electric.backupHeater ?? 0;
  return {
    anbindung: anbindungVon(result, plant),
    trinkwasser: trinkwasserVon(result, plant),
    kreise: result.circuits.length,
    gemischt: result.circuits.some((c) => c.circuit.mixed),
    uebergabe: [...uebergabe],
    form: model?.form,
    /*
     * Der zweite Wärmeerzeuger, wie er im Anlagenblatt steht.
     *
     * Bis 1.13.2 stand hier fest `heizstab > 0 ? 'heizstab' : 'kein'` — das
     * Anlagenmodell kannte Solarthermie, Kessel und Festbrennstoff gar
     * nicht, und vier Vorlagen des Katalogs waren dadurch **unerreichbar**:
     * sie standen im Programm und konnten nie vorgeschlagen werden. Was das
     * Programm nicht weiß, behauptet es nicht; aber es muss die Möglichkeit
     * haben, es zu erfahren.
     *
     * Der Elektro-Heizstab bleibt der Rückfall: er steckt im Gerät und
     * ändert die Hydraulik nicht, ist aber der häufigste zweite Erzeuger
     * überhaupt.
     */
    bivalent: zweitErzeugerArt(plant) ?? (heizstab > 0 ? 'heizstab' : 'kein'),
    // Eine Kaskade ist nicht dasselbe wie zwei Geräte im Katalog: sie ist
    // die Entscheidung, mehrere gleichartige Geräte an einen Verteiler zu
    // hängen — und die steht im Anlagenblatt.
    kaskade: (plant?.cascade?.geraete ?? 1) > 1,
    kuehlung: plant?.cooling ?? 'keine',
    weitererVerbraucher: plant?.additionalConsumer ?? 'kein',
    volumen: result.volume.total,
    mindestVolumen: model?.minSystemVolume ?? 0,
    leistung: result.selected?.capacityAtDesign ?? result.requiredCapacity,
  };
}

/** Wie gut eine Vorlage passt. */
export type Passung =
  /** Alle Merkmale stimmen überein. */
  | 'passt'
  /** Die Anlage lässt sich damit bauen, weicht aber in Nebenmerkmalen ab. */
  | 'moeglich'
  /** Ein Merkmal schließt die Vorlage aus. */
  | 'passt-nicht';

export interface Abweichung {
  /** Merkmal, das nicht übereinstimmt. */
  merkmal: string;
  /** Was das Schema zeigt. */
  schema: string;
  /** Was die Anlage hat. */
  anlage: string;
  /** Schließt die Abweichung die Vorlage aus? */
  hart: boolean;
}

export interface SchemaVorschlag {
  vorlage: SchemaVorlage;
  passung: Passung;
  /**
   * Rangwert 0…1. Er ordnet nur innerhalb derselben Passung; zwischen
   * „passt" und „möglich" entscheidet die Passung, nicht die Zahl.
   */
  wert: number;
  /** Merkmale, die übereinstimmen — der Grund, warum es vorgeschlagen wird. */
  treffer: string[];
  abweichungen: Abweichung[];
  /** Ein Satz für die Oberfläche. */
  begruendung: string;
}

/**
 * Gewichte der Merkmale.
 *
 * Sie sind keine Messwerte, sondern eine Rangfolge: **die Anbindung wiegt am
 * schwersten**, weil sie über die ganze Hydraulik entscheidet — ein
 * Reihenpuffer und ein Parallelpuffer sind zwei verschiedene Anlagen. Die
 * Übergabeart wiegt am wenigsten, weil ein Schema für Flächenheizung sich
 * ohne Eingriff auch mit Heizkörpern bauen lässt, sobald die Temperaturen
 * passen. Die Zahlen sind eine Setzung dieses Programms und stehen deshalb
 * hier, sichtbar, statt verstreut im Vergleich.
 */
const GEWICHT = {
  anbindung: 0.35,
  trinkwasser: 0.2,
  kreise: 0.15,
  gemischt: 0.1,
  uebergabe: 0.1,
  bauform: 0.1,
} as const;

/** Eine Vorlage gegen die Anlage halten. */
export function bewerte(vorlage: SchemaVorlage, m: AnlagenMerkmale): SchemaVorschlag {
  const treffer: string[] = [];
  const abweichungen: Abweichung[] = [];
  let wert = 0;

  // --- Anbindung: das härteste Merkmal ------------------------------------
  if (vorlage.merkmale.anbindung === m.anbindung) {
    wert += GEWICHT.anbindung;
    treffer.push(`Anbindung ${m.anbindung}`);
  } else {
    abweichungen.push({
      merkmal: 'Anbindung',
      schema: vorlage.merkmale.anbindung,
      anlage: m.anbindung,
      // Hart: ein Schema mit Parallelpuffer beschreibt eine andere Anlage als
      // eines ohne. Das ist kein Detail, das man beim Bauen zurechtrückt.
      hart: true,
    });
  }

  // --- Trinkwasser ---------------------------------------------------------
  if (vorlage.merkmale.trinkwasser === m.trinkwasser) {
    wert += GEWICHT.trinkwasser;
    treffer.push(`Trinkwasser ${m.trinkwasser}`);
  } else {
    abweichungen.push({
      merkmal: 'Trinkwassererwärmung',
      schema: vorlage.merkmale.trinkwasser,
      anlage: m.trinkwasser,
      // Hart, sobald eine der beiden Seiten „keine" oder „integriert" sagt:
      // ein Gerät mit eingebautem Speicher bekommt keinen zweiten daneben,
      // und ein Schema ohne Trinkwasser zeigt eine andere Anlage.
      hart:
        vorlage.merkmale.trinkwasser === 'keine' ||
        m.trinkwasser === 'keine' ||
        vorlage.merkmale.trinkwasser === 'integriert' ||
        m.trinkwasser === 'integriert',
    });
  }

  // --- Zahl der Heizkreise -------------------------------------------------
  // `kreise: 0` heißt „beliebig viele" — die BWP-Schemata mit
  // Verteilerdarstellung machen keine Aussage über die Zahl.
  if (m.kreise === 0) {
    /*
     * Keine ausgelegten Kreise heißt **nicht** „passt zu allem".
     *
     * Bis zur Prüfung zählte `kreise: 0` als Übereinstimmung, und eine leere
     * Anlage bekam zwei Vorlagen mit 0,85 vorgeschlagen. Eine Maschine, die
     * für eine ungeplante Anlage etwas vorschlägt, ist schlechter als eine,
     * die nichts findet: der Vorschlag sieht aus wie ein Ergebnis.
     */
    abweichungen.push({
      merkmal: 'Zahl der Heizkreise',
      schema: vorlage.merkmale.kreise === 0 ? 'beliebig' : `${vorlage.merkmale.kreise} Kreise`,
      anlage: 'kein Heizkreis ausgelegt',
      hart: false,
    });
  } else if (vorlage.merkmale.kreise === 0 || vorlage.merkmale.kreise === m.kreise) {
    wert += GEWICHT.kreise;
    treffer.push(m.kreise === 1 ? 'ein Heizkreis' : `${m.kreise} Heizkreise`);
  } else if (m.kreise > vorlage.merkmale.kreise) {
    abweichungen.push({
      merkmal: 'Zahl der Heizkreise',
      schema: vorlage.merkmale.kreise === 1 ? 'ein Kreis' : `${vorlage.merkmale.kreise} Kreise`,
      anlage: `${m.kreise} Kreise`,
      /*
       * Hart, und zwar für **jede** zu kleine Kreiszahl, nicht nur für das
       * Einkreisschema. Ein Verteiler mit zwei Abgängen trägt vier Kreise
       * nicht, nur weil die Zeichnung sonst passt — und ein Einkreisschema
       * hat gar keinen Verteiler. Mehr Kreise daranzuhängen ist ein anderes
       * Schema, nicht dasselbe mit mehr Linien.
       */
      hart: true,
    });
  } else {
    abweichungen.push({
      merkmal: 'Zahl der Heizkreise',
      schema: `${vorlage.merkmale.kreise} Kreise`,
      anlage: `${m.kreise} Kreise`,
      // Weich in der anderen Richtung: ein Schema für mehr Kreise trägt auch
      // weniger — der Verteiler bekommt einfach einen Abgang weniger.
      hart: false,
    });
  }

  // --- Gemischte Kreise ----------------------------------------------------
  if (vorlage.merkmale.gemischt === m.gemischt) {
    wert += GEWICHT.gemischt;
    treffer.push(m.gemischt ? 'mit Mischer' : 'ungemischt');
  } else {
    abweichungen.push({
      merkmal: 'Mischer',
      schema: vorlage.merkmale.gemischt ? 'gemischte Kreise' : 'ungemischt',
      anlage: m.gemischt ? 'gemischte Kreise' : 'ungemischt',
      // Hart nur in einer Richtung: ein Schema ohne Mischer zeigt einen Kreis,
      // der einen braucht, nicht. Umgekehrt ist ein gezeichneter Mischer, den
      // die Anlage nicht braucht, ein Bauteil zu viel — ärgerlich, aber
      // baubar. Der VdZ-Leitfaden führt „unnötiger Einbau von Mischern"
      // ausdrücklich als Fehler.
      hart: m.gemischt && !vorlage.merkmale.gemischt,
    });
  }

  // --- Übergabeart ---------------------------------------------------------
  const fehlend = m.uebergabe.filter((u) => !vorlage.merkmale.uebergabe.includes(u));
  if (!fehlend.length) {
    wert += GEWICHT.uebergabe;
    treffer.push(m.uebergabe.map((u) => (u === 'flaeche' ? 'Flächenheizung' : 'Heizkörper')).join(' und '));
  } else {
    abweichungen.push({
      merkmal: 'Übergabe',
      schema: vorlage.merkmale.uebergabe.join(', ') || '—',
      anlage: fehlend.join(', '),
      // Hart: BWP-Schema 1 ist ausdrücklich nur für Flächenheizsysteme
      // zugelassen. Ein Heizkörper daran ist keine Variante, sondern ein
      // anderer Fall.
      hart: true,
    });
  }

  // --- Bauform -------------------------------------------------------------
  const bauformen = vorlage.merkmale.bauformen;
  if (!bauformen?.length || (m.form && bauformen.includes(m.form))) {
    wert += GEWICHT.bauform;
    if (bauformen?.length && m.form) treffer.push(`Bauform ${m.form}`);
  } else {
    abweichungen.push({
      merkmal: 'Bauform',
      schema: bauformen.join(', '),
      anlage: m.form ?? 'unbekannt',
      hart: true,
    });
  }

  // --- Zusatzmerkmale: was das Schema mehr zeigt, als die Anlage hat -------
  /*
   * Ein Schema mit Solareinkopplung, Festbrennstoffkessel, Schwimmbad oder
   * Kaskade beschreibt eine **größere** Anlage. Ohne diese Prüfung schnitten
   * BWP-H-04, -06, -10 und -11 genauso gut ab wie BWP-H-03, weil sie in
   * allen Grundmerkmalen übereinstimmen — und der Anwender bekäme fünf
   * gleichwertige Vorschläge, von denen vier Bauteile enthalten, die er
   * nicht hat. Das Grundschema muss gewinnen.
   *
   * Hart ist die Abweichung nicht: wer eine Solaranlage plant, findet das
   * Schema in der Liste und sieht die Begründung daneben.
   */
  /*
   * Seit 1.14.0 wird **in beide Richtungen** verglichen.
   *
   * Bis dahin kostete nur der Fall „das Schema zeigt mehr als die Anlage
   * hat". Das war die halbe Wahrheit: wer eine Solaranlage plant, bekam
   * BWP-H-04 (mit Solar) und BWP-H-03 (ohne) gleichwertig vorgeschlagen —
   * das Schema ohne Solareinkopplung hatte keinen Nachteil, obwohl es die
   * Anlage nicht zeigt. Ein Schema, das ein vorhandenes Bauteil verschweigt,
   * ist genauso falsch wie eines, das ein fehlendes zeichnet.
   *
   * Ausgenommen bleibt der Elektro-Heizstab: er sitzt im Gerät, ändert die
   * Hydraulik nicht und steht in keinem der Schemata als eigenes Bauteil.
   */
  const schemaBivalent = vorlage.merkmale.bivalent ?? 'kein';
  const echterZweitErzeuger = m.bivalent !== 'kein' && m.bivalent !== 'heizstab';
  const schemaKuehlung = vorlage.merkmale.kuehlung ?? 'keine';
  const schemaVerbraucher = vorlage.merkmale.weitererVerbraucher ?? 'kein';

  const zusatz: { merkmal: string; trifft: boolean; schema: string; anlage: string }[] = [
    {
      merkmal: 'Zweiter Wärmeerzeuger',
      trifft: schemaBivalent !== 'kein' ? schemaBivalent !== m.bivalent : echterZweitErzeuger,
      schema: schemaBivalent,
      anlage: m.bivalent,
    },
    {
      merkmal: 'Kühlung',
      trifft: schemaKuehlung !== m.kuehlung,
      schema: schemaKuehlung,
      anlage: m.kuehlung,
    },
    {
      merkmal: 'Kaskade',
      trifft: Boolean(vorlage.merkmale.kaskade) !== m.kaskade,
      schema: vorlage.merkmale.kaskade ? 'mehrere Geräte' : 'ein Gerät',
      anlage: m.kaskade ? 'mehrere Geräte' : 'ein Gerät',
    },
    {
      merkmal: 'Weiterer Verbraucher',
      trifft: schemaVerbraucher !== m.weitererVerbraucher,
      schema: schemaVerbraucher,
      anlage: m.weitererVerbraucher,
    },
  ];
  for (const z of zusatz) {
    if (!z.trifft) continue;
    // Jedes Zusatzmerkmal kostet so viel wie das leichteste Grundmerkmal.
    // Damit fällt ein Schema mit einem Zusatz hinter das Grundschema, bleibt
    // aber vor jedem, das in einem Grundmerkmal abweicht.
    wert -= GEWICHT.uebergabe;
    abweichungen.push({ merkmal: z.merkmal, schema: z.schema, anlage: z.anlage, hart: false });
  }

  const hart = abweichungen.some((a) => a.hart);
  const passung: Passung = hart ? 'passt-nicht' : abweichungen.length ? 'moeglich' : 'passt';

  return {
    vorlage,
    passung,
    wert: Math.round(Math.max(0, wert) * 1000) / 1000,
    treffer,
    abweichungen,
    begruendung: begruendungsSatz(passung, treffer, abweichungen),
  };
}

function begruendungsSatz(passung: Passung, treffer: string[], abweichungen: Abweichung[]): string {
  if (passung === 'passt') {
    return `Stimmt in allen Merkmalen überein: ${treffer.join(', ')}.`;
  }
  const harte = abweichungen.filter((a) => a.hart);
  if (harte.length) {
    const a = harte[0];
    return `Passt nicht: ${a.merkmal} — das Schema zeigt ${a.schema}, die Anlage hat ${a.anlage}.`;
  }
  const a = abweichungen[0];
  return `Baubar, weicht aber ab: ${a.merkmal} — Schema ${a.schema}, Anlage ${a.anlage}.`;
}

export interface AuswahlErgebnis {
  merkmale: AnlagenMerkmale;
  /** Alle Vorlagen, bewertet und sortiert. */
  vorschlaege: SchemaVorschlag[];
  /** Die passenden — das, was die Oberfläche zuerst zeigt. */
  passende: SchemaVorschlag[];
  /** Der beste Vorschlag, falls es einen gibt. */
  beste?: SchemaVorschlag;
  hinweise: { severity: 'info' | 'warn' | 'error'; text: string }[];
}

/**
 * Alle Vorlagen gegen die Anlage halten und sortieren.
 *
 * Sortiert wird zuerst nach Passung, dann nach Wert, dann nach Kennung — die
 * letzte Stufe ist nur dafür da, dass zwei Läufe dieselbe Reihenfolge
 * liefern. Ein Vorschlagsfenster, das bei jedem Öffnen anders sortiert ist,
 * ist unbrauchbar.
 */
export function schlageSchemaVor(result: PlantDesignResult, plant?: PlantDefinition): AuswahlErgebnis {
  const merkmale = anlagenMerkmale(result, plant);
  const rang: Record<Passung, number> = { passt: 0, moeglich: 1, 'passt-nicht': 2 };
  const vorschlaege = SCHEMA_KATALOG.map((v) => bewerte(v, merkmale)).sort(
    (a, b) =>
      rang[a.passung] - rang[b.passung] ||
      b.wert - a.wert ||
      (a.vorlage.kennung < b.vorlage.kennung ? -1 : a.vorlage.kennung > b.vorlage.kennung ? 1 : 0),
  );
  const passende = vorschlaege.filter((v) => v.passung !== 'passt-nicht');

  const hinweise: AuswahlErgebnis['hinweise'] = [];
  if (!result.selected) {
    hinweise.push({
      severity: 'warn',
      text:
        'Es ist kein Wärmeerzeuger gewählt. Bauform und Ausstattung bleiben damit offen — ' +
        'Schemata für Turmgeräte und Hydrosplit lassen sich nicht ausschließen.',
    });
  }
  if (merkmale.kreise === 0) {
    hinweise.push({
      severity: 'warn',
      text:
        'Es ist kein Heizkreis ausgelegt. Was hier vorgeschlagen wird, ist deshalb keine Zuordnung, ' +
        'sondern eine Vorauswahl — die Zahl und Art der Kreise ist das Merkmal, das die meisten Schemata ' +
        'voneinander unterscheidet.',
    });
  }
  if (!passende.length) {
    hinweise.push({
      severity: 'warn',
      text:
        'Keine Vorlage passt zu dieser Anlage. Das ist kein Fehler: der Katalog hält Musterlösungen, ' +
        'nicht alle Anlagen. Die Liste zeigt zu jedem Schema, welches Merkmal es ausschließt.',
    });
  }
  if (merkmale.mindestVolumen > 0 && merkmale.volumen < merkmale.mindestVolumen) {
    hinweise.push({
      severity: 'warn',
      text:
        `Der Wasserinhalt der Anlage liegt mit ${Math.round(merkmale.volumen)} l unter dem geforderten ` +
        `Mindestinhalt von ${Math.round(merkmale.mindestVolumen)} l. Jedes Schema ohne Puffer scheidet damit ` +
        'aus, unabhängig von seinen übrigen Merkmalen.',
    });
  }
  hinweise.push({
    severity: 'info',
    text:
      'Ein Vorschlag ist keine Planung. Der BWP-Leitfaden, aus dem elf der Vorlagen stammen, sagt über sich ' +
      'selbst: „Für die Feinplanung sind die Vorgaben der Hersteller bindend."',
  });

  return { merkmale, vorschlaege, passende, beste: passende[0], hinweise };
}

export const PASSUNG_LABELS: Record<Passung, string> = {
  passt: 'passt',
  moeglich: 'baubar, weicht ab',
  'passt-nicht': 'passt nicht',
};
