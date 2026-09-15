/**
 * Prüfblock „Schemavorschlag" — verrottet der Katalog, und schlägt die
 * Auswahlmaschine auch dann nichts vor, wenn nichts passt?
 *
 * **Warum dieser Block gebraucht wird.** Hier hängen zwei Bauteile aneinander,
 * die auf zwei ganz verschiedene Arten falsch werden:
 *
 *  • `schemaKatalog.ts` ist **reine Daten** — fünfzehn Vorlagen mit Merkmalen,
 *    Bedingungen, Bauteilketten, Auslegungszeilen und Verweisen in den
 *    Wissenskorpus. Daten haben keinen Rechenweg, der scheitern könnte; sie
 *    verrotten **leise**. Eine Bauteilart, die es nicht gibt, zeichnet sich
 *    einfach nicht. Eine Bedingungskennung, die zweimal vorkommt, überschreibt
 *    sich in jeder `Map`, die jemand später daraus baut. Und eine `wissenIds`-
 *    Kennung, die ins Leere zeigt, ist der schlimmste Fall von allen: sie
 *    **sieht aus wie ein Beleg**. Wer im Anlagenbuch „siehe
 *    hyd-parallelpuffer" liest, glaubt, es stehe etwas dahinter. Steht dort
 *    nichts, ist aus einem Nachweis eine Behauptung geworden, ohne dass
 *    irgendwo ein Fehler gemeldet wurde. Deshalb ist die Prüfung jedes
 *    einzelnen Verweises gegen `WISSEN_KORPUS` die wichtigste dieses Blocks.
 *
 *  • `schemaAuswahl.ts` ist eine **Auswahlmaschine**, und die kann auf zwei
 *    Arten falsch sein. Sie kann das richtige Schema übersehen — das fällt
 *    auf, sobald jemand die Liste liest. Und sie kann **immer irgendetwas
 *    vorschlagen**. Das ist der gefährlichere Fehler: eine Maschine, die zu
 *    jeder Anlage ein „passendes" Schema findet, hat aufgehört, eine Aussage
 *    zu machen. Der Anwender übernimmt den ersten Treffer, weil er da steht,
 *    und merkt erst auf der Baustelle, dass das Schema einen Parallelpuffer
 *    zeigt, den niemand gekauft hat. Ein ehrliches „keine Vorlage passt, und
 *    hier steht zu jeder, welches Merkmal sie ausschließt" ist mehr wert als
 *    fünfzehn Vorschläge mit drei Nachkommastellen.
 *
 * **Wie geprüft wird.** In sieben Abschnitten, und die Sollwerte werden
 * hergeleitet statt abgeschrieben:
 *
 *  A  Unversehrtheit des Katalogs — Eindeutigkeit, Vollständigkeit, gültige
 *     Bauteilarten gegen eine **hier** geschriebene Liste (steht sie im
 *     Prüfling, prüft ein Tippfehler sich selbst), lebende Wissensverweise.
 *  B  Vollständigkeit — die elf BWP-Schemata, jede Anbindungsart belegt, und
 *     `'weiche'` ausdrücklich **nicht**: der BWP zeichnet keine hydraulische
 *     Weiche, und dieser Zustand soll bewusst bleiben statt eines Tages
 *     unbemerkt zu kippen.
 *  C  Die Bewertung an **von Hand gebauten** Merkmalen. Nicht aus
 *     `designPlant`: eine Auslegung liefert immer nur die eine Konstellation,
 *     die dieses Haus zufällig hat. Geprüft werden hier die *Eigenschaften*
 *     der Funktion — welche Abweichung hart ist, welche weich, und wie viel
 *     jede kostet.
 *  D  Merkmalsablesung — dieselbe Trennung eine Ebene tiefer.
 *  E  Sortierung und Determinismus. Ein Vorschlagsfenster, das bei jedem
 *     Öffnen anders sortiert ist, ist unbrauchbar.
 *  F  Am echten Haus. Erst hier laufen Katalog und Maschine gegen eine
 *     Auslegung, die niemand für sie zurechtgelegt hat.
 *  G  Grenzfälle — das leere Auslegungsergebnis und die fehlende
 *     Anlagendefinition. Beides ist der Zustand eines frisch angelegten
 *     Projekts, und beides darf nicht abstürzen.
 *
 * **Die Gewichte.** Sie summieren sich zu eins, und das ist keine Nebensache,
 * sondern die Voraussetzung dafür, dass `wert === 1` überhaupt „stimmt in
 * allen Merkmalen überein" heißen darf:
 *
 *     Anbindung     0,35
 *     Trinkwasser   0,20
 *     Kreise        0,15
 *     Mischer       0,10
 *     Übergabe      0,10
 *     Bauform       0,10
 *     ------------------
 *     Summe         1,00
 *
 * Jedes Zusatzmerkmal (Solar, Festbrennstoff, Kühlung, Kaskade, Schwimmbad)
 * kostet so viel wie das leichteste Grundmerkmal, also 0,10. Aus beidem
 * zusammen folgt jeder Sollwert in Abschnitt C, ohne dass die Zahl einmal aus
 * dem Prüfling abgelesen werden müsste.
 */

import type { CheckFn } from './typ';
import type {
  BimDocument,
  Fixture,
  HeatPumpModel,
  HeatingCircuit,
  PlantDefinition,
  PlantStorage,
  PumpForm,
  SchematicKind,
  StorageKind,
  UnitContents,
} from '../../src/types/bim';
import type { CircuitDesign, PlantDesignResult } from '../../src/lib/plantDesign';
import type { ModelMatch } from '../../src/lib/deviceCatalog';
import type { Anbindung, SchemaVorlage } from '../../src/lib/schemaKatalog';
import type { AnlagenMerkmale, Passung, SchemaVorschlag } from '../../src/lib/schemaAuswahl';
import { SCHEMA_KATALOG, schemaVorlage, vorlagenNachAnbindung } from '../../src/lib/schemaKatalog';
import { anlagenMerkmale, bewerte, schlageSchemaVor } from '../../src/lib/schemaAuswahl';
import { WISSEN_KORPUS } from '../../src/lib/wissenKorpus';
import { designPlant } from '../../src/lib/plantDesign';
import { HEAT_PUMP_CATALOG } from '../../src/lib/deviceCatalog';
import { emptyPlant } from '../../src/lib/plantDefaults';
import { sizePipe } from '../../src/lib/hydraulics';
import { buildReferenceDocument } from '../reference';
import { erzeugerBilanz } from '../../src/lib/erzeugerHydraulik';

// ---------------------------------------------------------------------------
// Die erlaubten Bauteilarten — bewusst hier und nicht aus dem Prüfling
// ---------------------------------------------------------------------------

/**
 * Alle Werte von `SchematicKind`, abgeschrieben aus `src/types/bim.ts`.
 *
 * Warum die Liste hier noch einmal steht, statt sie zur Laufzeit aus dem Typ
 * zu holen: Ein Union-Typ existiert zur Laufzeit nicht, und die einzige
 * Alternative wäre, die im Katalog vorkommenden Arten gegen sich selbst zu
 * halten — dann wäre jeder Tippfehler seine eigene Rechtfertigung. So dagegen
 * greift die Prüfung zweimal: TypeScript lehnt beim Übersetzen jeden Eintrag
 * ab, der kein `SchematicKind` ist (die Liste ist so typisiert), und zur
 * Laufzeit fällt jede Katalogart auf, die hier nicht steht.
 *
 * Wächst der Typ um eine Art, muss diese Liste mitwachsen. Das ist Absicht:
 * eine neue Bauteilart ist eine Entscheidung und keine Formsache.
 */
const BAUTEILARTEN: readonly SchematicKind[] = [
  'heatpump-outdoor',
  'heatpump-indoor',
  'cylinder',
  'buffer',
  'separator',
  'freshwater',
  'pump',
  'valve-2way',
  'valve-3way',
  'valve-diverter',
  'check-valve',
  'shutoff',
  'balancing-valve',
  'overflow-valve',
  'safety-valve',
  'expansion-vessel',
  'pressure-gauge',
  'thermometer',
  'sensor',
  'strainer',
  'air-separator',
  'dirt-separator',
  'filling-valve',
  'backflow-preventer',
  'water-meter',
  'heat-meter',
  'manifold',
  'radiator',
  'floor-loop',
  'boiler',
  'electric-heater',
  'solar',
  'mixing-valve-dhw',
  'circulation-pump',
  'flow-switch',
  'temperature-limiter',
  'hydraulic-station',
  'node',
];

/**
 * Alle Schlüssel von `UnitContents`, ebenfalls aus `src/types/bim.ts`.
 *
 * `entfaelltWennImGeraet` sagt: „dieses Bauteil ist bauseits nur nötig, wenn
 * das Gerät es nicht schon enthält". Zeigt der Schlüssel auf ein Feld, das es
 * nicht gibt, ist die Bedingung immer falsch — das Bauteil wird dann auch dort
 * gezeichnet, wo es schon im Gerät steckt. Genau der doppelt gezeichnete
 * Ausdehnungsbehälter, den HERST-H-03 als typisches Fehlerbild führt.
 */
const GERAETEINHALTE: readonly (keyof UnitContents)[] = [
  'pump',
  'diverter',
  'safetyGroup',
  'expansionVessel',
  'backupHeater',
  'cylinder',
  'buffer',
  'flowSwitch',
  'dirtSeparator',
  'location',
];

/** Die drei zugelassenen Belastbarkeitsstufen (siehe Dateikopf des Katalogs). */
const BELASTBARKEITEN: readonly SchemaVorlage['belastbarkeit'][] = ['primaer', 'sekundaer', 'annahme'];

/** Die fünf Anbindungsarten aus `Anbindung`. */
const ANBINDUNGEN: readonly Anbindung[] = ['direkt', 'reihenpuffer', 'parallelpuffer', 'weiche', 'kombispeicher'];

// ---------------------------------------------------------------------------
// Bausteine: Anlagenmerkmale von Hand
// ---------------------------------------------------------------------------

/**
 * Ein Merkmalssatz, der **BWP-H-03 vollständig trifft**.
 *
 * Warum ausgerechnet dieser als Ausgangspunkt: BWP-H-03 ist die Grundform, aus
 * der die Schemata 4, 5, 6, 10 und 11 durch Ergänzung entstehen. Wer von hier
 * aus je ein Merkmal verstellt, bewegt sich genau entlang der Kanten, an denen
 * die Bewertung entscheidet — und alles, was sich nicht bewegt, bleibt ein
 * Treffer. Anders gesagt: jeder Sollwert unten ist „1,00 minus das, was ich
 * gerade weggenommen habe".
 *
 * `kreise: 2` trifft BWP-H-03 deshalb, weil dessen `kreise: 0` „beliebig
 * viele" heißt; `bivalent: 'kein'`, `kaskade: false`,
 * `kuehlung: 'keine'` und `weitererVerbraucher: 'kein'` schalten die
 * Zusatzmerkmale ab; `form` bleibt offen, weil BWP-H-03 keine Bauform
 * einschränkt und ein leeres `bauformen` als „alle" gilt.
 */
function merkmale(anpassung: Partial<AnlagenMerkmale> = {}): AnlagenMerkmale {
  return {
    anbindung: 'parallelpuffer',
    trinkwasser: 'speicher',
    kreise: 2,
    gemischt: true,
    uebergabe: ['flaeche', 'heizkoerper'],
    bivalent: 'kein',
    kuehlung: 'keine',
    weitererVerbraucher: 'kein',
    kaskade: false,
    // Die drei Zahlen liest `bewerte` nicht an; sie stehen nur, weil der Typ
    // sie fordert, und sind bewusst unauffällig gewählt.
    volumen: 300,
    mindestVolumen: 100,
    leistung: 8,
    ...anpassung,
  };
}

/** Eine Vorlage über ihre Kennung — schlägt hart fehl, statt still `undefined` zu liefern. */
function vorlage(kennung: string): SchemaVorlage {
  const v = SCHEMA_KATALOG.find((x) => x.kennung === kennung);
  if (!v) throw new Error(`Vorlage ${kennung} fehlt im Katalog — Abschnitt B hätte das melden müssen.`);
  return v;
}

/** Kurzform: eine Vorlage gegen abgewandelte Basismerkmale halten. */
function werte(kennung: string, anpassung: Partial<AnlagenMerkmale> = {}): SchemaVorschlag {
  return bewerte(vorlage(kennung), merkmale(anpassung));
}

// ---------------------------------------------------------------------------
// Bausteine: Auslegungsergebnisse von Hand
// ---------------------------------------------------------------------------

/**
 * Die Felder, die `anlagenMerkmale` überhaupt liest.
 *
 * Das ist der schmale Ausschnitt, um den es in Abschnitt D geht:
 * `buffer.selected` (Anbindung), `selected` (Bauform, Heizstab,
 * Mindestvolumen, Leistung, eingebauter Trinkwasserspeicher), `dhwStorage`
 * (Trinkwasserart), `circuits` (Zahl, Mischer, Übergabe), `volume.total` und
 * `requiredCapacity`. Alles andere in `PlantDesignResult` — Heizlastherkunft,
 * Normdeckung, Sperrzeitfaktor, Pumpe, Sicherheitsausrüstung — wird von der
 * Merkmalsablesung nie angefasst. Es einmal unten in `LEERES_ERGEBNIS`
 * hinzuschreiben ist ehrlicher als ein `as`-Zwang, der behauptet, ein halbes
 * Objekt sei ein ganzes.
 */
type Merkmalsfelder = Pick<
  PlantDesignResult,
  'buffer' | 'circuits' | 'dhwStorage' | 'requiredCapacity' | 'selected' | 'volume'
>;

/**
 * Ein Auslegungsergebnis ohne jede Aussage.
 *
 * Kein Gerät, kein Kreis, kein Speicher, null Liter, null Kilowatt — der
 * Zustand eines Projekts, in dem noch nichts ausgelegt wurde. Abschnitt G
 * benutzt es unverändert, alle anderen Abschnitte legen darüber.
 */
const LEERES_ERGEBNIS: PlantDesignResult = {
  heatLoadSource: 'überschlag',
  heatLoadProvenance: 'überschlag',
  heatLoad: 0,
  normCoverage: {
    heatedRooms: 0,
    withNorm: 0,
    outdated: 0,
    total: 0,
    complete: true,
    missing: [],
    outdatedRooms: [],
  },
  dhwSurcharge: 0,
  blocking: 1,
  requiredCapacity: 0,
  matches: [],
  circuits: [],
  // Seit 1.23.0 trägt jede Auslegung ihre maßgebliche Systemtemperatur
  // samt Absender: Der Rohrnetzbericht liest sie hier ab, statt sie aus
  // dem Anlagenblatt noch einmal zu rechnen.
  systemtemperatur: {
    vorlauf: 35,
    ruecklauf: 28,
    spreizung: 7,
    herkunft: 'anlagenblatt',
    begruendung: '35/28 °C stehen so im Anlagenblatt; kein Heizkreis verlangt mehr. Spreizung 7 K.',
  },
  anschlussDn: 20,
  totalFlow: 0,
  volume: { total: 0, parts: [] },
  buffer: { required: 0, reason: 'kein Puffer erforderlich' },
  generator: erzeugerBilanz({ flow: 0, dn: 25, umschaltung: false, waermezaehler: false, abscheiderVorhanden: false }),
  notes: [],
};

/** Ein Auslegungsergebnis, das nur in den gelesenen Feldern gesetzt ist. */
function ergebnis(felder: Partial<Merkmalsfelder> = {}): PlantDesignResult {
  return { ...LEERES_ERGEBNIS, ...felder };
}

/** Ein Heizkreis samt Auslegung — die Zahlen daneben liest die Merkmalsablesung nicht. */
function kreis(id: string, art: HeatingCircuit['kind'], gemischt: boolean): CircuitDesign {
  const circuit: HeatingCircuit = {
    id,
    label: id,
    kind: art,
    roomIds: [],
    flowTemperature: art === 'floor' ? 35 : 50,
    returnTemperature: art === 'floor' ? 28 : 42,
    material: 'verbund',
    mixed: gemischt,
  };
  return { circuit, load: 3, loadSource: 'norm', flow: 0.3, pipe: sizePipe(0.3), notes: [] };
}

/** Ein Speicher, wie ihn die Auslegung ausweist. */
function speicher(kind: StorageKind, volumen = 200): PlantStorage {
  return { id: `sp-${kind}`, label: `Speicher ${kind}`, kind, volume: volumen, suggested: true };
}

/**
 * Ein Gerätetreffer aus dem Katalog, in einzelnen Feldern verstellt.
 *
 * Genommen wird das erste Katalogmodell und nur das geändert, was die
 * Merkmalsablesung liest. Ein von Hand zusammengeschriebenes Gerät wäre
 * dieselbe Aussage mit dreißig erfundenen Zahlen daneben.
 */
function geraet(anpassung: Partial<HeatPumpModel> = {}): ModelMatch {
  return {
    model: { ...HEAT_PUMP_CATALOG[0], ...anpassung },
    capacityAtDesign: 9,
    coverage: 1,
    score: 1,
    verdict: 'passt',
    reason: 'Prüffall',
  };
}

/** Ein Anlagenblatt mit gesetzten Speichern. */
function anlage(storages: PlantStorage[] = [], anpassung: Partial<PlantDefinition> = {}): PlantDefinition {
  const p = emptyPlant();
  return { ...p, storages: Object.fromEntries(storages.map((s) => [s.id, s])), ...anpassung };
}

// ---------------------------------------------------------------------------
// Bausteine: das Referenzhaus in einer kleineren Ausprägung
// ---------------------------------------------------------------------------

/**
 * Das Referenzhaus, zurückgebaut auf **einen einzigen ungemischten
 * Heizkörperkreis**.
 *
 * Nachgebaut nach `wpMitEinemHeizkoerper` in `anlagenschema.ts` — dort ist die
 * Funktion nicht ausgeführt, und ein Import querbeet zwischen Prüfblöcken
 * würde die Blöcke aneinanderketten: eine Änderung am Prüffall des einen ließe
 * den anderen scheitern, ohne dass an seinem Prüfling etwas geändert worden
 * wäre.
 *
 * Ein Unterschied ist Absicht: das Warmwasser bleibt **an**. `anlagenschema.ts`
 * schaltet es ab, weil dort die Hydraulik geprüft wird; hier entscheidet es
 * über das Merkmal `trinkwasser`, und ohne Trinkwassererwärmung passt keine
 * einzige Vorlage des Katalogs — alle fünfzehn führen einen Trinkwasserzweig.
 */
function einHeizkoerperkreis(doc: BimDocument): BimDocument {
  const hk = doc.fixtures['eg-f-hk1'] as Fixture | undefined;
  const kreis: HeatingCircuit = {
    id: 'circuit-hk',
    label: 'Heizkörper EG',
    kind: 'radiator',
    roomIds: hk?.roomId ? [hk.roomId] : [],
    flowTemperature: 55,
    returnTemperature: 45,
    material: 'kupfer',
    mixed: false,
  };
  const plant = doc.plant ?? emptyPlant();
  return {
    ...doc,
    fixtures: hk ? { [hk.id]: hk } : {},
    plant: { ...plant, storages: {}, circuits: { [kreis.id]: kreis } },
  };
}

// ---------------------------------------------------------------------------
// Kleine Auswertehelfer
// ---------------------------------------------------------------------------

const leer = (s: string | undefined): boolean => !s || s.trim().length === 0;
const kette = (vs: readonly SchemaVorschlag[]): string => vs.map((v) => v.vorlage.id).join(' ');

// ---------------------------------------------------------------------------
// Der Prüfblock
// ---------------------------------------------------------------------------

export function pruefeSchemavorschlag(check: CheckFn): void {
  console.log('\nSchemavorschlag — verrottet der Katalog, und schlägt die Auswahl auch dann nichts vor, wenn nichts passt?');

  // =========================================================================
  // A — Unversehrtheit des Katalogs
  // =========================================================================

  /*
   * Der Katalog ist reine Daten. Es gibt hier keinen Rechenweg, der scheitern
   * könnte — es gibt nur Einträge, die sich widersprechen, doppeln oder ins
   * Leere zeigen. Jede Prüfung dieses Abschnitts läuft deshalb über **alle**
   * Vorlagen und meldet die Zahl der Verstöße; ein einzelner Prüffall würde
   * nur die eine Vorlage decken, die zufällig gemeint war.
   */

  const alle = SCHEMA_KATALOG;
  check('A Katalog ist nicht leer', alle.length > 0, true);
  check('A Zahl der Vorlagen (11 BWP + BWP-H-03-2HK + 3 herstellergestützte)', alle.length, 15);

  // --- Kennungen und Bezeichner -------------------------------------------

  /*
   * `id` ist der Schlüssel, über den ein Vorschlag im Modell festgehalten
   * wird; `kennung` ist der Name, unter dem der Anwender ihn in der Quelle
   * wiederfindet. Beide müssen eindeutig sein — die erste, weil ein Doppel in
   * jeder `Map` einen Eintrag verschluckt, die zweite, weil sonst zwei
   * verschiedene Schemata unter demselben Namen in einem Bericht stünden.
   */
  check('A ids eindeutig', new Set(alle.map((v) => v.id)).size, alle.length);
  check('A kennungen eindeutig', new Set(alle.map((v) => v.kennung)).size, alle.length);

  // kebab-case: Kleinbuchstaben und Ziffern, getrennt durch einzelne
  // Bindestriche, kein führender oder abschließender Strich.
  const kebab = /^[a-z0-9]+(-[a-z0-9]+)*$/;
  check('A ids sind kebab-case', alle.filter((v) => !kebab.test(v.id)).length, 0);

  // Kennungsform: Quellenkürzel, Bereichsbuchstabe, zweistellige Nummer,
  // wahlweise ein Zusatz — 'BWP-H-03', 'BWP-H-03-2HK', 'HERST-H-01'.
  const kennungsform = /^[A-Z]+-[A-Z]-\d{2}(-[A-Z0-9]+)?$/;
  check('A kennungen haben Kennungsform', alle.filter((v) => !kennungsform.test(v.kennung)).length, 0);

  check('A jede Vorlage hat einen Namen', alle.filter((v) => leer(v.name)).length, 0);
  check('A jede Vorlage hat einen Kurztext', alle.filter((v) => leer(v.kurz)).length, 0);
  check('A jede Vorlage nennt ihre Quelle', alle.filter((v) => leer(v.quelle)).length, 0);
  check(
    'A jede url ist eine https-Adresse',
    alle.filter((v) => v.url !== undefined && !v.url.startsWith('https://')).length,
    0,
  );
  check(
    'A belastbarkeit ist primaer, sekundaer oder annahme',
    alle.filter((v) => !BELASTBARKEITEN.includes(v.belastbarkeit)).length,
    0,
  );

  // --- Bedingungen ---------------------------------------------------------

  /*
   * Eine Bedingung ohne Beleg ist eine Behauptung, und eine Bedingung ohne
   * `art` lässt offen, ob sie das Schema ausschließt oder nur verschlechtert —
   * beides macht sie unbrauchbar. Die Kennung muss innerhalb einer Vorlage
   * eindeutig sein, weil die Oberfläche Bedingungen darüber abhakt.
   */
  const bedingungen = alle.flatMap((v) => v.bedingungen);
  check('A Prüfmenge Bedingungen ist groß genug', bedingungen.length > 50, true);
  check('A jede Vorlage hat Bedingungen', alle.filter((v) => v.bedingungen.length === 0).length, 0);
  check('A jede Bedingung hat eine Kennung', bedingungen.filter((b) => leer(b.id)).length, 0);
  check('A jede Bedingung hat einen Text', bedingungen.filter((b) => leer(b.text)).length, 0);
  check('A jede Bedingung hat einen Beleg', bedingungen.filter((b) => leer(b.beleg)).length, 0);
  check(
    'A jede Bedingung ist hart oder weich',
    bedingungen.filter((b) => b.art !== 'hart' && b.art !== 'weich').length,
    0,
  );
  check(
    'A Bedingungskennungen innerhalb einer Vorlage eindeutig',
    alle.filter((v) => new Set(v.bedingungen.map((b) => b.id)).size !== v.bedingungen.length).length,
    0,
  );
  /*
   * Mindestens eine **harte** Bedingung je Vorlage: ein Schema, das nichts
   * ausschließt, ist keine Vorlage, sondern eine Zeichnung. Belege dafür, dass
   * das erfüllbar ist, stehen in jeder einzelnen — bei BWP-H-01 etwa „nur
   * Flächenheizsysteme", bei BWP-H-06 „alle Heizkreise gemischt".
   */
  check(
    'A jede Vorlage hat mindestens eine harte Bedingung',
    alle.filter((v) => !v.bedingungen.some((b) => b.art === 'hart')).length,
    0,
  );

  // --- Auslegung -----------------------------------------------------------

  /*
   * Ohne Auslegungszeile ist eine Vorlage ein Bild ohne Zahlen. Der ganze
   * Zweck des BWP-Leitfadens ist die überschlägige Bemaßung der
   * Grundkomponenten; eine Vorlage, die davon nichts überträgt, gibt den
   * Anwender an die Herstellerunterlage zurück, ohne es zu sagen.
   */
  const auslegungen = alle.flatMap((v) => v.auslegung);
  check('A jede Vorlage hat mindestens eine Auslegungszeile', alle.filter((v) => v.auslegung.length === 0).length, 0);
  check('A jede Auslegungszeile nennt eine Größe', auslegungen.filter((a) => leer(a.groesse)).length, 0);
  check('A jede Auslegungszeile nennt einen Wert', auslegungen.filter((a) => leer(a.wert)).length, 0);
  check('A jede Auslegungszeile nennt ihre Quelle', auslegungen.filter((a) => leer(a.quelle)).length, 0);

  // --- Bauteilketten -------------------------------------------------------

  /*
   * Hier liegt der Tippfehler, der sich am längsten versteckt: eine
   * Bauteilart, die es nicht gibt, wirft keinen Fehler, sie zeichnet sich
   * einfach nicht. Geprüft wird gegen die Liste am Kopf dieser Datei — nicht
   * gegen die im Katalog vorkommenden Arten, denn dagegen wäre jeder
   * Tippfehler seine eigene Rechtfertigung.
   */
  check('A Bauteilartenliste ist doppelfrei', new Set(BAUTEILARTEN).size, BAUTEILARTEN.length);
  check('A Bauteilartenliste hat die 38 Arten aus bim.ts', BAUTEILARTEN.length, 38);

  const erzeugerteile = alle.flatMap((v) => v.erzeugerkreis);
  const heizkreisteile = alle.flatMap((v) => v.heizkreis);
  const trinkwasserteile = alle.flatMap((v) => v.trinkwasserzweig);
  const alleTeile = [...erzeugerteile, ...heizkreisteile, ...trinkwasserteile];

  check('A Prüfmenge Bauteile ist groß genug', alleTeile.length > 200, true);
  check(
    'A jede Art im Erzeugerkreis ist ein SchematicKind',
    erzeugerteile.filter((t) => !BAUTEILARTEN.includes(t.kind)).length,
    0,
  );
  check(
    'A jede Art im Heizkreis ist ein SchematicKind',
    heizkreisteile.filter((t) => !BAUTEILARTEN.includes(t.kind)).length,
    0,
  );
  check(
    'A jede Art im Trinkwasserzweig ist ein SchematicKind',
    trinkwasserteile.filter((t) => !BAUTEILARTEN.includes(t.kind)).length,
    0,
  );
  check('A jedes Bauteil hat eine Beschriftung', alleTeile.filter((t) => leer(t.label)).length, 0);
  check('A jede Vorlage hat einen Erzeugerkreis', alle.filter((v) => v.erzeugerkreis.length === 0).length, 0);
  check('A jede Vorlage hat einen Heizkreis', alle.filter((v) => v.heizkreis.length === 0).length, 0);
  /*
   * Der Trinkwasserzweig darf leer sein — der Typ sieht das ausdrücklich vor
   * („leer, wenn keiner"). Im heutigen Katalog ist er es nirgends, weil alle
   * fünfzehn Vorlagen Trinkwasser führen. Geprüft wird deshalb nicht „nicht
   * leer", sondern die Übereinstimmung mit dem Merkmal: wer `trinkwasser`
   * ungleich `'keine'` angibt, muss den Zweig auch zeichnen.
   */
  check(
    'A Trinkwassermerkmal und Trinkwasserzweig passen zusammen',
    alle.filter((v) => (v.merkmale.trinkwasser !== 'keine') !== (v.trinkwasserzweig.length > 0)).length,
    0,
  );

  check(
    'A entfaelltWennImGeraet ist ein Schlüssel von UnitContents',
    alleTeile.filter((t) => t.entfaelltWennImGeraet !== undefined && !GERAETEINHALTE.includes(t.entfaelltWennImGeraet))
      .length,
    0,
  );
  check('A UnitContents-Liste ist doppelfrei', new Set(GERAETEINHALTE).size, GERAETEINHALTE.length);

  // --- Herstellernamen -----------------------------------------------------

  /*
   * Die Herstellernamen sind eine Zuordnung, keine Quelle für den Inhalt —
   * das sagt der Katalogkopf selbst. Genau deshalb müssen beide Felder
   * gefüllt sein: ein Hersteller ohne Bezeichnung hilft niemandem beim Suchen,
   * und eine Bezeichnung ohne Hersteller ist nicht zuzuordnen.
   */
  const namen = alle.flatMap((v) => v.herstellernamen);
  check('A Prüfmenge Herstellernamen ist groß genug', namen.length > 50, true);
  check('A jeder Herstellername nennt den Hersteller', namen.filter((h) => leer(h.hersteller)).length, 0);
  check('A jeder Herstellername nennt eine Bezeichnung', namen.filter((h) => leer(h.bezeichnung)).length, 0);

  // --- Wissensverweise: die wichtigste Prüfung dieses Abschnitts -----------

  /*
   * Ein Verweis ins Leere sieht aus wie ein Beleg. Steht im Anlagenbuch
   * „siehe hyd-parallelpuffer" und gibt es diesen Eintrag nicht, hat der
   * Leser einen Nachweis gelesen, wo keiner ist — und nichts hat gemeldet.
   * Deshalb wird hier jede einzelne Kennung gegen den Korpus gehalten und
   * nicht nur ihre Zahl.
   */
  const korpusIds = new Set(WISSEN_KORPUS.map((w) => w.id));
  const verweise = alle.flatMap((v) => v.wissenIds);
  check('A Wissenskorpus ist nicht leer', korpusIds.size > 0, true);
  check('A Prüfmenge Wissensverweise ist groß genug', verweise.length > 50, true);
  check('A jede Vorlage verweist ins Wissen', alle.filter((v) => v.wissenIds.length === 0).length, 0);
  check('A jede Wissenskennung existiert im Korpus', verweise.filter((w) => !korpusIds.has(w)).length, 0);
  check(
    'A Wissensverweise innerhalb einer Vorlage doppelfrei',
    alle.filter((v) => new Set(v.wissenIds).size !== v.wissenIds.length).length,
    0,
  );
  // Gegenprobe: der Abgleich ist nicht deshalb sauber, weil er nichts prüft.
  check(
    'A Gegenprobe — eine erfundene Kennung fiele auf',
    [...verweise, 'hyd-gibt-es-nicht'].filter((w) => !korpusIds.has(w)).length,
    1,
  );

  // --- Merkmale sind in sich schlüssig ------------------------------------

  check(
    'A anbindung ist eine der fünf Anbindungsarten',
    alle.filter((v) => !ANBINDUNGEN.includes(v.merkmale.anbindung)).length,
    0,
  );
  check('A kreise ist nicht negativ', alle.filter((v) => v.merkmale.kreise < 0).length, 0);
  check('A jede Vorlage lässt mindestens eine Übergabeart zu', alle.filter((v) => v.merkmale.uebergabe.length === 0).length, 0);
  check(
    'A Übergabearten doppelfrei',
    alle.filter((v) => new Set(v.merkmale.uebergabe).size !== v.merkmale.uebergabe.length).length,
    0,
  );

  // --- Die beiden Zugriffsfunktionen --------------------------------------

  check('A schemaVorlage findet BWP-H-03 über die id', schemaVorlage('bwp-h-03-parallelpuffer')?.kennung ?? 'fehlt', 'BWP-H-03');
  check('A schemaVorlage liefert undefined für eine unbekannte id', schemaVorlage('gibt-es-nicht') === undefined, true);

  // =========================================================================
  // B — Vollständigkeit
  // =========================================================================

  /*
   * Der BWP-Leitfaden Hydraulik führt elf Schemata. Fehlt eines, fehlt der
   * Auswahl eine ganze Konstellation — und zwar unbemerkt, denn die Maschine
   * schlägt dann eben das nächstähnliche vor. Geprüft wird jede der elf
   * Kennungen einzeln, damit im Fehlerfall dasteht, **welche** fehlt.
   */
  const kennungen = new Set(alle.map((v) => v.kennung));
  for (let n = 1; n <= 11; n += 1) {
    const k = `BWP-H-${String(n).padStart(2, '0')}`;
    check(`B ${k} ist im Katalog`, kennungen.has(k), true);
  }

  /*
   * Jede Anbindungsart braucht mindestens eine Vorlage — sonst kann eine
   * Anlage, die so gebaut ist, gar keinen Treffer bekommen. Mit **einer
   * Ausnahme**: `'weiche'`. Der BWP zeichnet keine hydraulische Weiche, und
   * dieser Katalog erfindet keine. Der leere Zustand wird hier ausdrücklich
   * festgehalten, damit er eine Entscheidung bleibt und nicht eines Tages
   * unbemerkt kippt — in beide Richtungen: eine Weichen-Vorlage, die jemand
   * ohne Beleg einträgt, fällt hier ebenso auf wie eine, die stillschweigend
   * verschwindet.
   */
  check('B direkt hat Vorlagen', vorlagenNachAnbindung('direkt').length > 0, true);
  check('B reihenpuffer hat Vorlagen', vorlagenNachAnbindung('reihenpuffer').length > 0, true);
  check('B parallelpuffer hat Vorlagen', vorlagenNachAnbindung('parallelpuffer').length > 0, true);
  check('B kombispeicher hat Vorlagen', vorlagenNachAnbindung('kombispeicher').length > 0, true);
  check('B weiche hat bewusst keine Vorlage', vorlagenNachAnbindung('weiche').length, 0);
  check(
    'B die Anbindungsarten teilen den Katalog vollständig auf',
    ANBINDUNGEN.reduce((s, a) => s + vorlagenNachAnbindung(a).length, 0),
    alle.length,
  );

  /*
   * Zwei Bauformen bringen so viel mit, dass sie ein eigenes Schema
   * rechtfertigen: das Turmgerät (Trinkwasserspeicher, Umschaltventil, Pumpe
   * und Ausdehnungsgefäß stecken drin) und der Hydrosplit (Wasserhydraulik in
   * der Station). Ohne je eine Vorlage bekämen genau die Geräte, bei denen am
   * meisten schiefgehen kann, keinen Vorschlag.
   */
  const mitBauform = (f: PumpForm): number => alle.filter((v) => v.merkmale.bauformen?.includes(f)).length;
  check('B es gibt eine Vorlage für Turmgeräte', mitBauform('tower') > 0, true);
  check('B es gibt eine Vorlage für Hydrosplit', mitBauform('hydrosplit') > 0, true);

  // =========================================================================
  // C — Die Bewertung, an eigens gebauten Merkmalen
  // =========================================================================

  /*
   * Ab hier wird `designPlant` bewusst **nicht** benutzt. Eine Auslegung
   * liefert immer nur die eine Konstellation, die dieses Haus zufällig hat;
   * geprüft werden soll aber die Eigenschaft der Funktion — welche Abweichung
   * hart ist, welche weich, und was jede kostet.
   */

  // --- C1 Volle Übereinstimmung -------------------------------------------

  /*
   * 0,35 + 0,20 + 0,15 + 0,10 + 0,10 + 0,10 = 1,00. Trifft eine Vorlage in
   * allen sechs Grundmerkmalen und zeigt kein Zusatzmerkmal, muss der Wert
   * genau eins sein — sonst summieren sich die Gewichte nicht mehr zu eins,
   * und „1,0" hätte aufgehört, „vollständig" zu heißen.
   */
  const voll = werte('BWP-H-03');
  check('C1 volle Übereinstimmung: passung', voll.passung, 'passt');
  check('C1 volle Übereinstimmung: wert ist genau 1,00', voll.wert, 1.0, 0.0005);
  check('C1 volle Übereinstimmung: keine Abweichung', voll.abweichungen.length, 0);
  check('C1 volle Übereinstimmung: sechs Treffer benannt', voll.treffer.length, 5);

  /*
   * Der letzte Sollwert braucht eine Erklärung: sechs Merkmale stimmen, aber
   * nur **fünf** Treffer werden benannt. Die Bauform trägt ihre 0,10 auch
   * dann, wenn die Vorlage gar keine einschränkt — und dann steht dazu nichts
   * in der Begründung, weil es nichts zu sagen gäbe. Bei einer Vorlage mit
   * Bauformbindung sind es sechs.
   */
  const turm = werte('HERST-H-02', { anbindung: 'direkt', trinkwasser: 'integriert', form: 'tower' });
  check('C1 Bauformvorlage: passung', turm.passung, 'passt');
  check('C1 Bauformvorlage: wert ist genau 1,00', turm.wert, 1.0, 0.0005);
  check('C1 Bauformvorlage: sechs Treffer benannt', turm.treffer.length, 6);

  // --- C2 Abweichende Anbindung ist hart ----------------------------------

  /*
   * Ein Schema mit Parallelpuffer beschreibt eine andere Anlage als eines
   * ohne. Das ist kein Detail, das man beim Bauen zurechtrückt — also hart.
   * Verbleibender Wert: 1,00 − 0,35 = 0,65.
   */
  const andereAnbindung = werte('BWP-H-03', { anbindung: 'direkt' });
  check('C2 andere Anbindung: passung', andereAnbindung.passung, 'passt-nicht');
  check('C2 andere Anbindung: wert 1,00 − 0,35', andereAnbindung.wert, 0.65, 0.0005);
  check('C2 andere Anbindung: genau eine Abweichung', andereAnbindung.abweichungen.length, 1);
  check('C2 andere Anbindung: sie ist hart', andereAnbindung.abweichungen[0].hart, true);
  check('C2 andere Anbindung: sie heißt Anbindung', andereAnbindung.abweichungen[0].merkmal, 'Anbindung');

  // --- C3 Zahl der Heizkreise ---------------------------------------------

  /*
   * Ein Einkreisschema hat keinen Verteiler. Zwei Kreise daranzuhängen ist
   * ein anderes Schema, nicht dasselbe mit mehr Linien — also hart.
   * BWP-H-02 zeigt genau einen Kreis; alles andere an den Merkmalen wird so
   * gesetzt, dass die Kreiszahl die einzige Abweichung bleibt.
   * Verbleibender Wert: 1,00 − 0,15 = 0,85.
   */
  const einkreisFalsch = werte('BWP-H-02', {
    anbindung: 'reihenpuffer',
    gemischt: false,
    uebergabe: ['flaeche'],
    kreise: 2,
  });
  check('C3 Einkreisschema gegen zwei Kreise: passung', einkreisFalsch.passung, 'passt-nicht');
  check('C3 Einkreisschema gegen zwei Kreise: wert 1,00 − 0,15', einkreisFalsch.wert, 0.85, 0.0005);
  check('C3 Einkreisschema gegen zwei Kreise: hart', einkreisFalsch.abweichungen[0].hart, true);

  /* Derselbe Fall mit einem Kreis muss voll treffen — sonst läge es nicht an der Zahl. */
  const einkreisRichtig = werte('BWP-H-02', {
    anbindung: 'reihenpuffer',
    gemischt: false,
    uebergabe: ['flaeche'],
    kreise: 1,
  });
  check('C3 Einkreisschema gegen einen Kreis: passung', einkreisRichtig.passung, 'passt');
  check('C3 Einkreisschema gegen einen Kreis: wert', einkreisRichtig.wert, 1.0, 0.0005);

  /*
   * Umgekehrt weich: ein Mehrkreisschema trägt auch weniger Kreise — der
   * zweite Abgang bleibt eben ungenutzt. BWP-H-03-2HK zeigt zwei Kreise, die
   * Anlage hat einen. Verbleibender Wert wieder 1,00 − 0,15 = 0,85, aber
   * diesmal als „baubar".
   */
  const mehrkreisWeniger = werte('BWP-H-03-2HK', { kreise: 1 });
  check('C3 Mehrkreisschema gegen einen Kreis: passung', mehrkreisWeniger.passung, 'moeglich');
  check('C3 Mehrkreisschema gegen einen Kreis: wert 1,00 − 0,15', mehrkreisWeniger.wert, 0.85, 0.0005);
  check('C3 Mehrkreisschema gegen einen Kreis: weich', mehrkreisWeniger.abweichungen[0].hart, false);

  /*
   * Und der Fall, den `kreise: 0` regelt: „beliebig viele". BWP-H-03 trägt
   * eins, zwei oder vier Kreise, ohne dass die Zahl etwas kostet.
   */
  check('C3 kreise 0 heißt beliebig — ein Kreis', werte('BWP-H-03', { kreise: 1 }).wert, 1.0, 0.0005);
  check('C3 kreise 0 heißt beliebig — vier Kreise', werte('BWP-H-03', { kreise: 4 }).wert, 1.0, 0.0005);

  // --- C4 Mischer ----------------------------------------------------------

  /*
   * Die Richtung entscheidet, und das ist die feinste Unterscheidung der
   * ganzen Bewertung:
   *
   *  • Anlage gemischt, Schema ohne Mischer → **hart**. Das Schema zeigt
   *    einen Kreis, der einen Mischer braucht, ohne Mischer. Das ist keine
   *    Variante, das ist eine überhitzte Flächenheizung.
   *  • Anlage ungemischt, Schema mit Mischer → **weich**. Ein gezeichneter
   *    Mischer, den die Anlage nicht braucht, ist ein Bauteil zu viel —
   *    ärgerlich (der VdZ führt „unnötiger Einbau von Mischern" als Fehler),
   *    aber baubar.
   *
   * Kosten in beiden Richtungen: 1,00 − 0,10 = 0,90.
   */
  const mischerFehlt = werte('BWP-H-02', { anbindung: 'reihenpuffer', uebergabe: ['flaeche'], kreise: 1 });
  check('C4 gemischter Kreis, Schema ohne Mischer: passung', mischerFehlt.passung, 'passt-nicht');
  check('C4 gemischter Kreis, Schema ohne Mischer: wert 1,00 − 0,10', mischerFehlt.wert, 0.9, 0.0005);
  check('C4 gemischter Kreis, Schema ohne Mischer: hart', mischerFehlt.abweichungen[0].hart, true);
  check('C4 gemischter Kreis, Schema ohne Mischer: Merkmal', mischerFehlt.abweichungen[0].merkmal, 'Mischer');

  const mischerZuviel = werte('BWP-H-03', { gemischt: false });
  check('C4 ungemischt, Schema mit Mischer: passung', mischerZuviel.passung, 'moeglich');
  check('C4 ungemischt, Schema mit Mischer: wert 1,00 − 0,10', mischerZuviel.wert, 0.9, 0.0005);
  check('C4 ungemischt, Schema mit Mischer: weich', mischerZuviel.abweichungen[0].hart, false);

  // --- C5 Zusatzmerkmale ---------------------------------------------------

  /*
   * Ein Schema mit Solareinkopplung, Festbrennstoffkessel, Kühlung, Kaskade
   * oder Schwimmbad beschreibt eine **größere** Anlage. Ohne diese Prüfung
   * schnitten BWP-H-04, -06, -10 und -11 genauso gut ab wie das Grundschema
   * BWP-H-03, weil sie in allen Grundmerkmalen übereinstimmen — der Anwender
   * bekäme fünf gleichwertige Vorschläge, von denen vier Bauteile enthalten,
   * die er nicht hat.
   *
   * Jeder Zusatz kostet so viel wie das leichteste Grundmerkmal, also 0,10:
   * 1,00 − 0,10 = 0,90. Damit fällt ein Schema mit einem Zusatz hinter das
   * Grundschema, bleibt aber vor jedem, das in einem Grundmerkmal abweicht
   * (das kostet mindestens 0,10 und im Fall der Anbindung 0,35).
   *
   * Hart ist keiner dieser Zusätze: wer eine Solaranlage plant, soll das
   * Schema in der Liste finden und die Begründung daneben lesen.
   */
  const zusatzfaelle: [string, string, Partial<AnlagenMerkmale>, string][] = [
    ['Solar', 'BWP-H-04', {}, 'Zweiter Wärmeerzeuger'],
    ['Festbrennstoff', 'BWP-H-06', {}, 'Zweiter Wärmeerzeuger'],
    ['Kühlung', 'BWP-H-08', { kreise: 1, uebergabe: ['flaeche'] }, 'Kühlung'],
    ['Kaskade', 'BWP-H-11', {}, 'Kaskade'],
    ['Schwimmbad', 'BWP-H-10', {}, 'Weiterer Verbraucher'],
  ];
  for (const [name, kennung, anpassung, merkmal] of zusatzfaelle) {
    const r = werte(kennung, anpassung);
    check(`C5 Zusatz ${name} (${kennung}): passung`, r.passung, 'moeglich');
    check(`C5 Zusatz ${name} (${kennung}): wert 1,00 − 0,10`, r.wert, 0.9, 0.0005);
    check(`C5 Zusatz ${name} (${kennung}): genau eine Abweichung`, r.abweichungen.length, 1);
    check(`C5 Zusatz ${name} (${kennung}): weich`, r.abweichungen[0].hart, false);
    check(`C5 Zusatz ${name} (${kennung}): Merkmal benannt`, r.abweichungen[0].merkmal, merkmal);
  }

  /*
   * Zwei Zusätze in einer Vorlage müssen zweimal kosten: 1,00 − 0,10 − 0,10 =
   * 0,80. BWP-H-04 zeigt Solar; hält man ihm eine Anlage entgegen, die selbst
   * eine Kaskade ist, kommt der Kaskaden-Zusatz dazu (die Vorlage zeigt genau
   * ein Gerät, die Anlage hat mehrere). Damit ist belegt, dass der Abzug je
   * Zusatz gilt und nicht einmal pauschal.
   */
  const zweiZusaetze = werte('BWP-H-04', { kaskade: true });
  check('C5 zwei Zusätze: wert 1,00 − 0,10 − 0,10', zweiZusaetze.wert, 0.8, 0.0005);
  check('C5 zwei Zusätze: zwei Abweichungen', zweiZusaetze.abweichungen.length, 2);
  check('C5 zwei Zusätze: beide weich', zweiZusaetze.abweichungen.every((a) => !a.hart), true);

  // --- C6 Bauform ----------------------------------------------------------

  /*
   * Eine Bauformbindung ist hart: HERST-H-02 zeichnet ein Turmgerät mit allem
   * darin. Einem Monoblock im Freien dieses Schema vorzuschlagen hieße, einen
   * Trinkwasserspeicher zu unterschlagen, den es nicht gibt.
   * 1,00 − 0,10 = 0,90, aber ausgeschlossen.
   */
  const falscheBauform = werte('HERST-H-02', {
    anbindung: 'direkt',
    trinkwasser: 'integriert',
    form: 'monoblock-outdoor',
  });
  check('C6 falsche Bauform: passung', falscheBauform.passung, 'passt-nicht');
  check('C6 falsche Bauform: wert 1,00 − 0,10', falscheBauform.wert, 0.9, 0.0005);
  check('C6 falsche Bauform: hart', falscheBauform.abweichungen[0].hart, true);
  /*
   * Und die Gegenprobe zur Unbekanntheit: ist keine Bauform bekannt, greift
   * die Bindung nicht — HERST-H-02 bliebe sonst unauffindbar, solange kein
   * Gerät gewählt ist. Der Hinweis „kein Wärmeerzeuger gewählt" aus
   * `schlageSchemaVor` sagt genau das (Abschnitt G).
   */
  const bauformOffen = werte('HERST-H-02', { anbindung: 'direkt', trinkwasser: 'integriert' });
  check('C6 unbekannte Bauform schließt nicht aus', bauformOffen.passung, 'passt-nicht');
  check('C6 unbekannte Bauform: die Bauform ist nicht der Grund',
    bauformOffen.abweichungen.some((a) => a.merkmal === 'Bauform'), true);

  // --- C7 Der Wert bleibt im Band ------------------------------------------

  /*
   * `wert` ist ein Rangwert zwischen 0 und 1. Ein Wert über 1 hieße, dass
   * Gewichte doppelt gezählt werden; ein Wert unter 0 hieße, dass die Zusätze
   * unter null durchschlagen — beides würde die Sortierung unbrauchbar machen,
   * ohne dass eine einzelne Bewertung falsch aussähe. Geprüft wird über alle
   * fünfzehn Vorlagen mal vier sehr verschiedene Anlagen.
   */
  const proben: AnlagenMerkmale[] = [
    merkmale(),
    merkmale({ anbindung: 'direkt', trinkwasser: 'keine', kreise: 1, gemischt: false, uebergabe: ['heizkoerper'] }),
    merkmale({ anbindung: 'weiche', trinkwasser: 'frischwasser', kreise: 9, kaskade: true, form: 'tower' }),
    merkmale({ anbindung: 'kombispeicher', trinkwasser: 'integriert', kreise: 0, uebergabe: [], form: 'hydrosplit' }),
  ];
  const alleBewertungen = proben.flatMap((m) => alle.map((v) => bewerte(v, m)));
  check('C7 Prüfmenge Bewertungen', alleBewertungen.length, alle.length * proben.length);
  check('C7 wert nie größer als 1', alleBewertungen.filter((r) => r.wert > 1).length, 0);
  check('C7 wert nie kleiner als 0', alleBewertungen.filter((r) => r.wert < 0).length, 0);

  // --- C8 Die Begründung ---------------------------------------------------

  /*
   * Die Begründung ist der eigentliche Ertrag dieses Moduls: eine Liste
   * passender Schemata ist bequem, eine Liste mit dem Satz „passt nicht, weil
   * …" daneben ist eine Aussage. Ein leerer Satz wäre schlimmer als keiner —
   * er sieht aus, als sei geprüft worden.
   */
  check('C8 jede Begründung ist gefüllt', alleBewertungen.filter((r) => leer(r.begruendung)).length, 0);
  /*
   * Bei `passt-nicht` muss das ausschließende Merkmal im Satz stehen. Sonst
   * liest der Anwender „passt nicht" und muss selbst herausfinden, warum —
   * und genau das nimmt ihm dieses Modul ab.
   */
  const ausgeschlossen = alleBewertungen.filter((r) => r.passung === 'passt-nicht');
  check('C8 Prüfmenge ausgeschlossener Bewertungen', ausgeschlossen.length > 20, true);
  check(
    'C8 jede Ausschlussbegründung nennt das harte Merkmal',
    ausgeschlossen.filter((r) => {
      const hart = r.abweichungen.find((a) => a.hart);
      return !hart || !r.begruendung.includes(hart.merkmal);
    }).length,
    0,
  );
  check(
    'C8 jede Ausschlussbewertung hat auch eine harte Abweichung',
    ausgeschlossen.filter((r) => !r.abweichungen.some((a) => a.hart)).length,
    0,
  );
  check(
    'C8 keine passende Bewertung hat eine harte Abweichung',
    alleBewertungen.filter((r) => r.passung !== 'passt-nicht' && r.abweichungen.some((a) => a.hart)).length,
    0,
  );
  check(
    'C8 „passt" heißt: gar keine Abweichung',
    alleBewertungen.filter((r) => r.passung === 'passt' && r.abweichungen.length > 0).length,
    0,
  );

  // =========================================================================
  // D — Merkmalsablesung
  // =========================================================================

  /*
   * Dieselbe Trennung eine Ebene tiefer: geprüft wird, was `anlagenMerkmale`
   * aus einem Auslegungsergebnis abliest, und nicht, was `designPlant` in ein
   * Auslegungsergebnis hineinschreibt. Gebaut werden nur die Felder, die
   * gelesen werden; der Rest kommt aus `LEERES_ERGEBNIS`.
   *
   * Die Reihenfolge der Bestimmtheit ist Teil der Aussage: ein gewählter
   * Speicher legt die Anbindung fest, danach erst zählt, was von Hand im
   * Anlagenblatt steht, und erst wenn beides schweigt, ist die Anlage direkt
   * angebunden.
   */

  const ablesen = (felder: Partial<Merkmalsfelder>, plant?: PlantDefinition): AnlagenMerkmale =>
    anlagenMerkmale(ergebnis(felder), plant);

  const mitPuffer = (kind: StorageKind): AnlagenMerkmale =>
    ablesen({ buffer: { required: 200, selected: speicher(kind), reason: 'Prüffall' } });

  check('D Reihenpuffer → reihenpuffer', mitPuffer('buffer-series').anbindung, 'reihenpuffer');
  check('D Parallelpuffer → parallelpuffer', mitPuffer('buffer-parallel').anbindung, 'parallelpuffer');
  check('D Weiche → weiche', mitPuffer('separator').anbindung, 'weiche');
  check('D Kombispeicher → kombispeicher', mitPuffer('combi').anbindung, 'kombispeicher');
  check('D kein Speicher → direkt', ablesen({}).anbindung, 'direkt');
  /*
   * Ein Trinkwasserspeicher ist kein Puffer: er entkoppelt nichts und darf die
   * Anbindung nicht verstellen. Eine Anlage mit Trinkwasserspeicher und ohne
   * Puffer ist direkt angebunden.
   */
  check('D Trinkwasserspeicher verstellt die Anbindung nicht',
    ablesen({ dhwStorage: speicher('dhw-cylinder', 300) }).anbindung, 'direkt');
  /*
   * Von Hand eingetragene Speicher zählen genauso: wer einen Parallelpuffer
   * ins Anlagenblatt schreibt, hat die Anbindung entschieden — auch wenn die
   * Auslegung keinen vorgeschlagen hat.
   */
  check('D Parallelpuffer aus dem Anlagenblatt zählt',
    ablesen({}, anlage([speicher('buffer-parallel')])).anbindung, 'parallelpuffer');

  /*
   * Trinkwasser: `integriert` schlägt alles, weil ein Gerät mit eingebautem
   * Speicher keinen zweiten daneben bekommt. Danach Frischwasserstation, dann
   * Kombispeicher, dann ein vorgeschlagener Trinkwasserspeicher, dann die
   * Zahl der Wohneinheiten im Anlagenblatt.
   */
  check('D Gerät mit contains.cylinder → integriert',
    ablesen({ selected: geraet({ contains: { cylinder: 180 } }) }).trinkwasser, 'integriert');
  check('D Frischwasserstation im Anlagenblatt → frischwasser',
    ablesen({}, anlage([speicher('fresh-water-station', 40)])).trinkwasser, 'frischwasser');
  check('D Kombispeicher im Anlagenblatt → kombispeicher',
    ablesen({}, anlage([speicher('combi', 800)])).trinkwasser, 'kombispeicher');
  check('D vorgeschlagener Trinkwasserspeicher → speicher',
    ablesen({ dhwStorage: speicher('dhw-cylinder', 300) }).trinkwasser, 'speicher');
  check('D kein Trinkwasser, kein Anlagenblatt → keine', ablesen({}).trinkwasser, 'keine');

  /*
   * Kreise, Mischer und Übergabe kommen unmittelbar aus der Kreisliste. Zwei
   * Flächenkreise und ein Heizkörperkreis ergeben zwei Übergabearten, drei
   * Kreise und — weil einer der Flächenkreise gemischt ist — `gemischt: true`.
   */
  const dreiKreise = ablesen({
    circuits: [kreis('fbh-1', 'floor', true), kreis('fbh-2', 'floor', false), kreis('hk-1', 'radiator', false)],
  });
  check('D Zahl der Kreise', dreiKreise.kreise, 3);
  check('D ein gemischter Kreis genügt für gemischt', dreiKreise.gemischt, true);
  check('D Übergabearten doppelfrei und vollständig', [...dreiKreise.uebergabe].sort().join(','), 'flaeche,heizkoerper');
  check('D ohne gemischten Kreis ist gemischt falsch',
    ablesen({ circuits: [kreis('hk-1', 'radiator', false)] }).gemischt, false);

  /*
   * Bauform, Heizstab, Volumen und Leistung. Der Heizstab ist das einzige
   * bivalente Merkmal, das im Modell überhaupt steht — Solar, Kessel und
   * Festbrennstoff kennt das Programm heute nicht und behauptet sie deshalb
   * auch nicht.
   */
  const mitGeraet = ablesen({
    selected: geraet({ form: 'tower', minSystemVolume: 120, electric: { ...HEAT_PUMP_CATALOG[0].electric, backupHeater: 9 } }),
    volume: { total: 250, parts: [] },
    requiredCapacity: 5,
  });
  check('D Bauform kommt aus dem Gerät', mitGeraet.form ?? 'fehlt', 'tower');
  check('D Heizstab im Gerät → bivalent heizstab', mitGeraet.bivalent, 'heizstab');
  check('D Mindestvolumen kommt aus dem Datenblatt', mitGeraet.mindestVolumen, 120);
  check('D Volumen kommt aus der Auslegung', mitGeraet.volumen, 250);
  check('D Leistung: das gewählte Gerät schlägt die Forderung', mitGeraet.leistung, 9);
  check('D ohne Gerät gilt die geforderte Leistung', ablesen({ requiredCapacity: 5 }).leistung, 5);
  check('D ohne Heizstab ist bivalent kein',
    ablesen({ selected: geraet({ electric: { ...HEAT_PUMP_CATALOG[0].electric, backupHeater: 0 } }) }).bivalent, 'kein');
  /*
   * `kaskade` steht im Modell nicht und wird deshalb nie behauptet. Das ist
   * eine bewusste Lücke, kein Fehler — festgehalten, damit sie auffällt, wenn
   * jemand sie eines Tages füllt.
   */
  check('D Kaskade wird nie aus der Auslegung abgeleitet', mitGeraet.kaskade, false);

  // =========================================================================
  // E — Sortierung und Determinismus
  // =========================================================================

  /*
   * Sortiert wird nach Passung, dann absteigend nach Wert, dann aufsteigend
   * nach Kennung. Die letzte Stufe ist nur dafür da, dass zwei Läufe dieselbe
   * Reihenfolge liefern — ein Vorschlagsfenster, das bei jedem Öffnen anders
   * sortiert ist, ist unbrauchbar.
   *
   * Geprüft wird an einer Anlage, die alle drei Passungen erzeugt: das
   * Referenzhaus (Abschnitt F rechnet es noch einmal aus, hier zählt nur die
   * Ordnung).
   */
  const doc = buildReferenceDocument();
  const plan = designPlant(doc);
  const auswahl = schlageSchemaVor(plan, doc.plant);

  check('E alle Vorlagen werden bewertet', auswahl.vorschlaege.length, alle.length);

  const rang: Record<Passung, number> = { passt: 0, moeglich: 1, 'passt-nicht': 2 };
  let ordnungVerletzt = 0;
  for (let i = 1; i < auswahl.vorschlaege.length; i += 1) {
    const a = auswahl.vorschlaege[i - 1];
    const b = auswahl.vorschlaege[i];
    if (rang[a.passung] > rang[b.passung]) ordnungVerletzt += 1;
    else if (rang[a.passung] === rang[b.passung]) {
      if (a.wert < b.wert - 1e-9) ordnungVerletzt += 1;
      else if (Math.abs(a.wert - b.wert) < 1e-9 && a.vorlage.kennung > b.vorlage.kennung) ordnungVerletzt += 1;
    }
  }
  check('E Passung vor Wert vor Kennung — keine Verletzung', ordnungVerletzt, 0);
  check(
    'E alle drei Passungen kommen im Prüffall vor',
    new Set(auswahl.vorschlaege.map((v) => v.passung)).size,
    3,
  );

  /* Zweimal dieselbe Eingabe muss dieselbe Kette ergeben. */
  const nochmal = schlageSchemaVor(plan, doc.plant);
  check('E zweiter Lauf: gleiche Reihenfolge', kette(nochmal.vorschlaege), kette(auswahl.vorschlaege));
  check(
    'E zweiter Lauf: gleiche Werte',
    nochmal.vorschlaege.map((v) => v.wert).join(' '),
    auswahl.vorschlaege.map((v) => v.wert).join(' '),
  );

  /*
   * `passende` ist genau die Vorderseite derselben Liste — nicht eine zweite,
   * anders sortierte. Verglichen wird die Kette und nicht die Zahl: eine
   * gleich lange Liste in anderer Reihenfolge wäre derselbe Fehler.
   */
  check(
    'E passende ist die gefilterte Vorschlagsliste',
    kette(auswahl.passende),
    kette(auswahl.vorschlaege.filter((v) => v.passung !== 'passt-nicht')),
  );
  check('E beste ist das erste passende', auswahl.beste?.vorlage.id ?? 'fehlt', auswahl.passende[0].vorlage.id);
  check('E zweiter Lauf: gleiche passende', kette(nochmal.passende), kette(auswahl.passende));
  check('E zweiter Lauf: gleiche beste', nochmal.beste?.vorlage.id ?? 'fehlt', auswahl.beste?.vorlage.id ?? 'fehlt');

  /*
   * Jede Vorlage kommt genau einmal vor. Eine doppelt bewertete Vorlage wäre
   * in der Oberfläche kaum zu sehen und in der Sortierung nicht zu bemerken —
   * sie stünde neben sich selbst.
   */
  check('E jede Vorlage genau einmal in der Liste', new Set(auswahl.vorschlaege.map((v) => v.vorlage.id)).size, alle.length);

  /*
   * Die Gleichstandsregel, an einem Fall mit vier gleichen Werten: BWP-H-04,
   * -06, -10 und -11 stehen alle bei 1,00 − 0,10 = 0,90 (je ein
   * Zusatzverbraucher, siehe Abschnitt F). Bei Gleichstand entscheidet die
   * Kennung aufsteigend, also 04 vor 06 vor 10 vor 11. Ohne diese Stufe wäre
   * ihre Reihenfolge die Katalogreihenfolge — und damit eine Zufälligkeit, die
   * beim nächsten Einfügen kippt.
   */
  check(
    'E Gleichstand wird nach Kennung aufgelöst',
    auswahl.vorschlaege
      .filter((v) => Math.abs(v.wert - 0.9) < 1e-9 && v.passung === 'moeglich')
      .map((v) => v.vorlage.kennung)
      .join(' '),
    'BWP-H-04 BWP-H-06 BWP-H-10 BWP-H-11',
  );

  // =========================================================================
  // F — Am echten Haus
  // =========================================================================

  /*
   * Erst hier laufen Katalog und Maschine gegen eine Auslegung, die niemand
   * für sie zurechtgelegt hat.
   *
   * **Der Puffer.** Das Referenzhaus hat vier Heizkreise, davon zwei gemischte
   * Flächenkreise. Seit 1.13.0 entscheidet die Pufferwahl zwischen Reihe und
   * Parallel: hydraulisch getrennt wird, sobald **mehr als ein Kreis fördert
   * oder ein Kreis gemischt ist**. Hier trifft beides zu, also Parallelpuffer.
   * Ein Reihenpuffer läge im Rücklauf und trennte nicht — vier Kreispumpen
   * arbeiteten dann gegen die Erzeugerpumpe.
   *
   * **Das Schema.** Aus vier Kreisen, gemischt, Flächenheizung *und*
   * Heizkörpern, einem Trinkwasserspeicher und einem Parallelpuffer folgt
   * genau eine Vorlage: BWP-H-03, „mehrere Heizkreise und
   * Trinkwassererwärmung mit parallelem Pufferspeicher" — das Referenzschema
   * für die Sanierung. Seine `kreise: 0` heißt „beliebig viele", seine
   * `uebergabe` lässt beides zu, `gemischt` stimmt, `trinkwasser: 'speicher'`
   * stimmt, und es zeigt kein Zusatzmerkmal. Alle sechs Gewichte fallen an,
   * also 1,00.
   *
   * **Warum genau eine.** Die Schemata 4, 6, 10 und 11 stimmen in **allen**
   * Grundmerkmalen mit Schema 3 überein — sie sind Schema 3 plus etwas:
   * Solarkreis (4), Festbrennstoffkessel (6), Schwimmbad (10), Kaskade (11).
   * Diese Zusatzverbraucher hat das Haus nicht, also je 1,00 − 0,10 = 0,90
   * und „baubar, weicht ab". Schema 5 kommt dazu mit Kessel *und* nur zwei
   * gezeigten Kreisen: 1,00 − 0,10 − 0,15 = 0,75. BWP-H-03-2HK zeigt zwei
   * Kreise gegen vier: 0,85. Übrig bleibt Schema 3 als einziger voller
   * Treffer — und genau das ist der Zweck der Zusatzmerkmalsprüfung.
   */
  check('F Referenzhaus: vier Heizkreise', plan.circuits.length, 4);
  check('F Referenzhaus: mindestens ein gemischter Kreis', plan.circuits.some((c) => c.circuit.mixed), true);
  check('F Referenzhaus: Parallelpuffer gewählt', plan.buffer.selected?.kind ?? 'fehlt', 'buffer-parallel');

  check('F Referenzhaus: Anbindung parallelpuffer', auswahl.merkmale.anbindung, 'parallelpuffer');
  check('F Referenzhaus: Trinkwasser über Speicher', auswahl.merkmale.trinkwasser, 'speicher');
  check('F Referenzhaus: gemischt', auswahl.merkmale.gemischt, true);
  check('F Referenzhaus: beide Übergabearten', [...auswahl.merkmale.uebergabe].sort().join(','), 'flaeche,heizkoerper');

  const volleTreffer = auswahl.vorschlaege.filter((v) => v.passung === 'passt');
  check('F Referenzhaus: genau ein volles Treffer-Schema', volleTreffer.length, 1);
  check('F Referenzhaus: und das ist BWP-H-03', volleTreffer[0].vorlage.kennung, 'BWP-H-03');
  check('F Referenzhaus: sein Wert ist 1,00', volleTreffer[0].wert, 1.0, 0.0005);
  check('F Referenzhaus: beste ist BWP-H-03', auswahl.beste?.vorlage.kennung ?? 'fehlt', 'BWP-H-03');

  /*
   * Die vier Schemata, die sich nur durch einen Zusatzverbraucher
   * unterscheiden, müssen dahinter stehen — nicht ausgeschlossen (sie sind
   * baubar), aber um genau einen Zusatz schlechter.
   */
  for (const k of ['BWP-H-04', 'BWP-H-06', 'BWP-H-10', 'BWP-H-11']) {
    const v = auswahl.vorschlaege.find((x) => x.vorlage.kennung === k);
    check(`F Referenzhaus: ${k} ist baubar, aber nicht Treffer`, v?.passung ?? 'fehlt', 'moeglich');
    check(`F Referenzhaus: ${k} kostet genau einen Zusatz`, v?.wert ?? 0, 0.9, 0.0005);
  }

  /*
   * **Die kleine Anlage.** Dasselbe Haus, zurückgebaut auf einen einzigen
   * ungemischten Heizkörperkreis. Jetzt fördert nur ein Kreis, und er ist
   * nicht gemischt — die Bedingung für die hydraulische Trennung ist damit in
   * beiden Teilen unerfüllt, also Reihenpuffer. Und Reihenpuffer plus ein
   * ungemischter Kreis plus Trinkwasserspeicher ist BWP-H-02, das einzige
   * Schema des Leitfadens mit Reihenpuffer — Heizkörper sind dort ausdrücklich
   * zugelassen (in Schema 1 sind sie es nicht). Wieder alle sechs Gewichte,
   * also wieder 1,00, und wieder genau ein voller Treffer.
   */
  const klein = einHeizkoerperkreis(doc);
  const planKlein = designPlant(klein);
  const auswahlKlein = schlageSchemaVor(planKlein, klein.plant);
  check('F kleine Anlage: ein Heizkreis', planKlein.circuits.length, 1);
  check('F kleine Anlage: ungemischt', planKlein.circuits.every((c) => !c.circuit.mixed), true);
  check('F kleine Anlage: Reihenpuffer gewählt', planKlein.buffer.selected?.kind ?? 'fehlt', 'buffer-series');
  check('F kleine Anlage: Anbindung reihenpuffer', auswahlKlein.merkmale.anbindung, 'reihenpuffer');
  check('F kleine Anlage: nur Heizkörper', auswahlKlein.merkmale.uebergabe.join(','), 'heizkoerper');
  check('F kleine Anlage: genau ein Vorschlag insgesamt', auswahlKlein.passende.length, 1);
  check('F kleine Anlage: und der passt', auswahlKlein.passende[0].passung, 'passt');
  check('F kleine Anlage: es ist BWP-H-02', auswahlKlein.beste?.vorlage.kennung ?? 'fehlt', 'BWP-H-02');
  check('F kleine Anlage: Wert 1,00', auswahlKlein.beste?.wert ?? 0, 1.0, 0.0005);
  /*
   * Die Gegenprobe zur Trennschärfe: BWP-H-01 zeigt dieselbe Anlage ohne
   * Puffer und ist ausdrücklich nur für Flächenheizsysteme zugelassen. Es
   * muss hier ausgeschlossen sein — an der Anbindung **und** an der Übergabe.
   */
  const h01 = auswahlKlein.vorschlaege.find((v) => v.vorlage.kennung === 'BWP-H-01');
  check('F kleine Anlage: BWP-H-01 ist ausgeschlossen', h01?.passung ?? 'fehlt', 'passt-nicht');

  // =========================================================================
  // G — Grenzfälle
  // =========================================================================

  /*
   * Ein frisch angelegtes Projekt hat kein Gerät, keinen Kreis, keinen
   * Speicher und kein Anlagenblatt. Die Auswahl darf daran nicht scheitern —
   * und sie darf vor allem **nichts vorschlagen**. Ohne Trinkwassererwärmung
   * (`trinkwasser: 'keine'`) scheidet jede der fünfzehn Vorlagen hart aus, denn
   * alle fünfzehn führen einen Trinkwasserzweig. Übrig bleiben vier Hinweise:
   *
   *   warn  „Es ist kein Wärmeerzeuger gewählt …"
   *   warn  „Es ist kein Heizkreis ausgelegt …"
   *   warn  „Keine Vorlage passt zu dieser Anlage …"
   *   info  „Ein Vorschlag ist keine Planung …"
   *
   * Der zweite kam mit der Reparatur dazu, die dieser Block ausgelöst hat:
   * eine Anlage ohne Heizkreise ist keine Anlage, zu der sich ein Schema
   * zuordnen ließe — die Zahl und Art der Kreise ist das Merkmal, das die
   * meisten Schemata voneinander unterscheidet.
   *
   * Der Hinweis zum Mindestwasserinhalt fehlt zu Recht: ohne Gerät ist der
   * geforderte Inhalt null, und null unterschreitet nichts.
   */
  const nichts = schlageSchemaVor(LEERES_ERGEBNIS);
  check('G leeres Ergebnis: alle Vorlagen bewertet', nichts.vorschlaege.length, alle.length);
  check('G leeres Ergebnis: kein einziger Vorschlag', nichts.passende.length, 0);
  check('G leeres Ergebnis: kein bester', nichts.beste === undefined, true);
  check('G leeres Ergebnis: vier Hinweise statt Vorschlägen', nichts.hinweise.length, 4);
  check('G leeres Ergebnis: drei Warnungen', nichts.hinweise.filter((h) => h.severity === 'warn').length, 3);
  check('G leeres Ergebnis: jeder Hinweis hat Text', nichts.hinweise.filter((h) => leer(h.text)).length, 0);
  check('G leeres Ergebnis: Anbindung direkt', nichts.merkmale.anbindung, 'direkt');
  check('G leeres Ergebnis: Trinkwasser keine', nichts.merkmale.trinkwasser, 'keine');
  check('G leeres Ergebnis: null Kreise', nichts.merkmale.kreise, 0);
  check('G leeres Ergebnis: jede Vorlage nennt ihren Ausschlussgrund',
    nichts.vorschlaege.filter((v) => leer(v.begruendung)).length, 0);

  /*
   * `plant === undefined` ist derselbe Aufruf ohne Anlagenblatt und muss
   * buchstabengleich dasselbe ergeben — die Anlagendefinition ist ein
   * *zusätzlicher* Merkmalsträger und keine Voraussetzung.
   */
  const ohneBlatt = schlageSchemaVor(LEERES_ERGEBNIS, undefined);
  check('G ohne Anlagenblatt: gleiche Reihenfolge', kette(ohneBlatt.vorschlaege), kette(nichts.vorschlaege));
  check('G ohne Anlagenblatt: gleiche Hinweiszahl', ohneBlatt.hinweise.length, nichts.hinweise.length);

  /*
   * Und derselbe leere Stand **mit** einem leeren Anlagenblatt. `emptyPlant()`
   * setzt eine Wohneinheit mit Warmwasser — damit wird aus `trinkwasser:
   * 'keine'` ein `'speicher'`, und der harte Ausschluss fällt weg. Die
   * Direktschemata BWP-H-01 und HERST-H-01 stehen dann als „baubar" da,
   * obwohl die Anlage null Heizkreise hat: 1,00 − 0,15 für die Kreiszahl =
   * 0,85.
   *
   * Das ist kein Absturz und kein falscher Wert, aber es ist die Stelle, an
   * der diese Maschine anfängt, „irgendetwas" vorzuschlagen — festgehalten
   * mit Zahl und Herleitung, damit die Entscheidung sichtbar bleibt.
   */
  const leerMitBlatt = schlageSchemaVor(LEERES_ERGEBNIS, emptyPlant());
  check('G leeres Blatt: Trinkwasser wird angenommen', leerMitBlatt.merkmale.trinkwasser, 'speicher');
  check('G leeres Blatt: die Direktschemata werden baubar', leerMitBlatt.passende.length, 2);
  check('G leeres Blatt: keines davon ist ein voller Treffer',
    leerMitBlatt.passende.filter((v) => v.passung === 'passt').length, 0);
  check('G leeres Blatt: Wert 1,00 − 0,15 für die fehlende Kreiszahl',
    leerMitBlatt.passende[0].wert, 0.85, 0.0005);
}
