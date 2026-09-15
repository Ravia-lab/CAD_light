/**
 * Prüfblock „Ebenen" — was auf welcher liegt, was man sieht, was man anfassen darf.
 *
 * **Worum es geht.** `src/lib/ebenen.ts` beantwortet drei Fragen, die im
 * Programm nebeneinander stehen und die alle drei auf derselben Zuordnung
 * beruhen: Auf welcher Ebene liegt das, was hier ausgewählt ist? Ist diese
 * Ebene sichtbar? Ist sie gesperrt? Die Ebene ist dabei **keine Ablage**,
 * sondern eine Eigenschaft des Bauteils — ein Heizkörper liegt auf „TGA ·
 * Heizung", weil er ein Heizkörper ist. Genau deshalb ist die Zuordnung eine
 * Funktion und genau deshalb lässt sie sich hier vollständig durchgehen.
 *
 * **Warum es diesen Block gibt.** Jeder Fehler in diesem Modul ist still.
 * Keiner wirft, keiner malt etwas Falsches, keiner ändert eine Zahl im
 * Bericht — sie alle äußern sich darin, dass ein Schalter *nichts* tut:
 *
 *  • **Eine Auswahlart ohne Zuordnung** fällt durch `ebeneFuerAuswahl` und
 *    bekommt `undefined`. Das Bauteil ist dann weder ausblendbar noch
 *    sperrbar — „Bestand sperren" lässt es beweglich, das Gewerkeblatt
 *    zeigt es auf jedem Blatt. Wer den Schalter betätigt, sieht, dass die
 *    anderen Bauteile reagieren, und hält das Übrigbleiben für Absicht.
 *  • **Eine Zuordnung auf eine Ebene, die es nicht gibt** (ein Tippfehler in
 *    einer Kennung genügt) sieht im Programm genauso aus: `doc.layers[...]`
 *    ist `undefined`, also gilt „sichtbar" und „nicht gesperrt". Ein
 *    unsichtbarer Fehler, der sich als bewusste Entscheidung tarnt.
 *  • **Ein Gewerkesatz, dem ein fremdes Gewerk durchrutscht**, liefert ein
 *    Heizungsblatt mit Lüftungskanälen darauf. Das ist keine Kleinigkeit im
 *    Bild, sondern der Grund, warum es die Sätze überhaupt gibt: Wer sich
 *    die Blätter aus acht Häkchen zusammenklickt, vergisst beim dritten
 *    eines — und die Sätze sind die Zusage, dass das nicht passiert.
 *
 * **Warum die Kennungen hier von Hand stehen.** Die Ebenen des Modells sind
 * in `DEFAULT_LAYERS` in `src/store/useBimStore.ts` festgelegt. Ein Import
 * von dort wäre die kürzeste Zeile und die falsche: `src/lib`, `src/types`
 * und `scripts` gehen als eigenständiges Paket an die Gegenstelle
 * (`build_kernel.py`, festgehalten in `scripts/pruefungen/schichtgrenze.ts`),
 * und ein Prüfblock, der aus `src/store` importiert, zerreißt dieses Paket.
 * Die zehn Kennungen stehen deshalb unten als Klartext, mit dem Vermerk, dass
 * sie bei einer Änderung an `DEFAULT_LAYERS` mitzupflegen sind.
 *
 * Das ist zugleich die ehrlichere Prüfung: Eine Zeile, die ihre Erwartung aus
 * derselben Tabelle holt, die sie prüft, bestätigt nur, dass die Tabelle sich
 * selbst gleicht. Eine umbenannte Ebene fiele damit nirgends auf — hier fällt
 * sie auf, und zwar als Abweichung zwischen zwei Stellen, die sich einig sein
 * müssen.
 *
 * **Was dieser Block nicht prüft.** Wie die Ebenenliste aussieht, in welcher
 * Reihenfolge sie steht und welche Farbe eine Ebene hat — das gehört in die
 * Oberfläche und in `DEFAULT_LAYERS`, nicht in die Zuordnung. Und ob der
 * Export die Sichtbarkeit ignoriert: Das ist eine Zusage des Exports und
 * steht in dessen Prüfblöcken.
 */

import type { CheckFn } from './typ';
import type {
  BimDocument,
  BimNode,
  Fixture,
  FixtureCategory,
  Layer,
  LayerId,
  Level,
  PipeAccessory,
  PipeRun,
  PipeService,
  SelectionKind,
} from '../../src/types/bim';
import { emptyPlant, emptySite } from '../../src/lib/plantDefaults';
import {
  BESTANDS_EBENEN,
  EBENE_BILD,
  EBENE_DURCHBRUECHE,
  EBENE_GELAENDE,
  EBENE_HEIZUNG,
  EBENE_LUEFTUNG,
  EBENE_MASSE,
  EBENE_OEFFNUNGEN,
  EBENE_RAEUME,
  EBENE_SANITAER,
  EBENE_WAENDE,
  GEWERKESAETZE,
  auswahlGesperrt,
  ebeneFuerAuswahl,
  ebeneFuerMedium,
  ebeneFuerObjekt,
  istGesperrt,
  istSichtbar,
  sichtbarkeitAus,
} from '../../src/lib/ebenen';

// ---------------------------------------------------------------------------
// Kleinkram
// ---------------------------------------------------------------------------

/**
 * „Keine Ebene" als eigenes Wort.
 *
 * `ebeneFuerAuswahl` liefert `LayerId | undefined`, und `undefined` ist hier
 * eine Aussage und kein Loch: Das Bauteil liegt auf keiner Ebene. Mit `?? ''`
 * oder `!` glattgezogen wäre der Fall nicht mehr von einer leeren Kennung zu
 * unterscheiden. Als Wort geführt, scheitert jede Zeile unten auch dann, wenn
 * das Modul die beiden Fälle vertauscht.
 */
const OHNE = 'ohne Ebene';

const EBENE = 'eg';

// ---------------------------------------------------------------------------
// Die Ebenen des Modells — Handabschrift aus DEFAULT_LAYERS
// ---------------------------------------------------------------------------

/**
 * Die zehn Ebenenkennungen aus `DEFAULT_LAYERS` (`src/store/useBimStore.ts`).
 *
 * **Abschrift von Hand, bei einer Änderung dort mitzupflegen.** Ein Import
 * ist ausgeschlossen: Prüfblöcke gehören zum Kernel-Paket und dürfen nicht
 * aus `src/store` lesen (siehe Kopfkommentar). Die Abschrift ist zugleich der
 * Sinn der Sache — sie ist eine **zweite, unabhängige Stimme**. Stimmen beide
 * überein, ist die Zuordnung gültig; weicht eine ab, meldet es Abschnitt B,
 * statt dass die Ebene stillschweigend als „immer sichtbar, nie sperrbar"
 * durchläuft.
 *
 * Die Reihenfolge ist die der Liste im Speicher, damit der Abgleich mit dem
 * Auge in einem Durchgang geht.
 */
const EBENEN_AUS_STORE: readonly LayerId[] = [
  'layer-walls',
  'layer-openings',
  'layer-rooms',
  'layer-dimensions',
  'layer-heating',
  'layer-sanitary',
  'layer-ventilation',
  'layer-durchbrueche',
  'layer-site',
  'layer-image',
];

const IM_STORE = new Set<LayerId>(EBENEN_AUS_STORE);

// ---------------------------------------------------------------------------
// Das Probenhaus
// ---------------------------------------------------------------------------

function ebeneEintrag(id: LayerId, visible: boolean, locked: boolean): Layer {
  return { id, name: id, color: '#000000', visible, locked };
}

function objekt(id: string, category: FixtureCategory): Fixture {
  return {
    id,
    type: category === 'heating' ? 'radiator' : category === 'sanitary' ? 'wc' : 'air-supply',
    category,
    levelId: EBENE,
    position: { x: 1, y: 1 },
    rotation: 0,
    length: 1,
    depth: 0.1,
    elevation: 0.15,
    params: {},
  };
}

/** Eine Leitung je Medium — die Kennung nennt ihr Medium, damit die Zuordnung lesbar bleibt. */
function leitung(service: PipeService): PipeRun {
  return {
    id: `p-${service}`,
    levelId: EBENE,
    service,
    points: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ],
    nominalDiameter: 20,
    insulation: 9,
    elevation: 0.3,
  };
}

function armatur(id: string, runId?: string): PipeAccessory {
  return { id, kind: 'shutoff', levelId: EBENE, position: { x: 1, y: 0 }, elevation: 0.3, runId, label: 'Absperrung' };
}

/**
 * Ein Haus mit **einem Vertreter jeder Auswahlart**, aber ohne Geometrie.
 *
 * Die Zuordnung liest aus dem Dokument nur drei Tabellen: `fixtures` (wegen
 * des Gewerks), `pipes` (wegen des Mediums) und `pipeAccessories` (wegen der
 * Leitung, an der die Armatur sitzt). Alles andere beantwortet sie aus der
 * Auswahlart allein. Wände, Räume und Öffnungen fehlen deshalb bewusst: Sie
 * brächten Gründe, aus denen eine Prüfung scheitern kann, ohne dass an der
 * Zuordnung etwas falsch wäre — und sie würden vortäuschen, die Zuordnung
 * schlüge im Dokument nach, obwohl sie das gerade nicht tut.
 *
 * Die Ebenentabelle bekommt der Aufrufer mit; sie ist der eigentliche
 * Gegenstand von Abschnitt D.
 */
function probenhaus(layers: Record<LayerId, Layer> = {}): BimDocument {
  const eg: Level = {
    id: EBENE,
    name: 'EG',
    order: 0,
    elevation: 0,
    height: 2.75,
    floorUValue: 0.35,
    floorBoundary: 'ground',
    ceilingUValue: 0.2,
    ceilingBoundary: 'unheated',
  };
  const a: BimNode = { id: 'n1', x: 0, y: 0, levelId: EBENE };

  const leitungen: PipeRun[] = [
    leitung('heating-flow'),
    leitung('heating-return'),
    leitung('refrigerant'),
    leitung('ventilation-supply'),
    leitung('ventilation-exhaust'),
    leitung('hot-water'),
    leitung('cold-water'),
    leitung('circulation'),
    leitung('waste'),
  ];

  const objekte: Fixture[] = [
    objekt('fx-heiz', 'heating'),
    objekt('fx-sani', 'sanitary'),
    objekt('fx-lueft', 'ventilation'),
  ];

  const armaturen: PipeAccessory[] = [
    armatur('ac-heiz', 'p-heating-flow'),
    armatur('ac-lueft', 'p-ventilation-supply'),
    armatur('ac-sani', 'p-waste'),
    // Eine Armatur ohne Leitung — der Fall, den der Rückfall unten auffängt.
    armatur('ac-ohne'),
  ];

  return {
    site: emptySite(),
    plant: emptyPlant(),
    meta: {
      name: 'Probenhaus Ebenen',
      createdAt: '2026-01-01T00:00:00.000Z',
      modifiedAt: '2026-01-01T00:00:00.000Z',
      northAngle: 0,
      designOutdoorTemperature: -12,
      designIndoorTemperature: 20,
      n50: 1.5,
      shielding: 'moderate',
      unheatedTemperature: 10,
      groundTemperature: 10,
      thermalBridgeSupplement: 0,
      thermalBridgeMethod: 'flat',
      thermalBridgeCategory: 'custom',
      reheatFactor: 0,
    },
    levels: { [EBENE]: eg },
    layers,
    nodes: { [a.id]: a },
    walls: {},
    openings: {},
    fixtures: Object.fromEntries(objekte.map((f) => [f.id, f])),
    verticals: {},
    solids: {},
    durchbrueche: {},
    pipes: Object.fromEntries(leitungen.map((p) => [p.id, p])),
    pipeAccessories: Object.fromEntries(armaturen.map((x) => [x.id, x])),
    annotations: {},
    roofOpenings: {},
    rooms: {},
    constructions: {},
    diagnostics: { openEnds: [] },
    activeLevelId: EBENE,
  };
}

// ---------------------------------------------------------------------------
// Die Erwartungstafeln
// ---------------------------------------------------------------------------

/**
 * Für jede Auswahlart: womit geprüft wird und was herauskommen soll.
 *
 * **Der Typ ist hier die halbe Prüfung.** `Record<SelectionKind, …>` ist
 * vollständig: Wer `src/types/bim.ts` um eine Auswahlart erweitert, bekommt
 * an dieser Stelle einen Übersetzungsfehler und muss sich entscheiden, auf
 * welche Ebene das neue Bauteil gehört. Ohne diese Tafel liefe die neue Art
 * still in den `default`-Zweig von `ebeneFuerAuswahl`, bekäme `undefined` und
 * wäre damit weder sperrbar noch ausblendbar — der Fehler aus dem
 * Kopfkommentar, den niemand sieht, weil nichts passiert.
 *
 * Die Laufzeitprüfung darunter kommt dazu, weil der Typ nur die
 * **Vollständigkeit** erzwingt und nicht die **Richtigkeit**: Dass `pipe` auf
 * Sanitär landen soll, wenn die Leitung Kaltwasser führt, kann kein Typ
 * wissen.
 */
const ZUORDNUNG: Record<SelectionKind, { id: string; ebene: LayerId | typeof OHNE }> = {
  // Alles, was das Gebäude trägt, liegt auf der Wandebene — auch der Knoten,
  // an dem zwei Wände hängen, und der Pfeiler, der neben ihnen steht. Sperrt
  // man den Bestand, darf sich beim Zielen auf einen Heizkörper keines davon
  // mitbewegen.
  node: { id: 'n1', ebene: EBENE_WAENDE },
  wall: { id: 'w1', ebene: EBENE_WAENDE },
  vertical: { id: 'v1', ebene: EBENE_WAENDE },
  solid: { id: 's1', ebene: EBENE_WAENDE },
  // Fenster, Türen und Dachfenster sind Öffnungen — ein Dachflächenfenster
  // ist keine eigene Gattung, sondern ein Fenster in einer schrägen Fläche.
  opening: { id: 'o1', ebene: EBENE_OEFFNUNGEN },
  roofOpening: { id: 'ro1', ebene: EBENE_OEFFNUNGEN },
  room: { id: 'r1', ebene: EBENE_RAEUME },
  // Die Beschriftung ist eine Maßangabe und gehört zu den Maßketten, nicht zu
  // dem Bauteil, das sie beschreibt: Sonst verschwände die Bemaßung einer
  // Wand, sobald jemand die Heizung ausblendet.
  annotation: { id: 'a1', ebene: EBENE_MASSE },
  durchbruch: { id: 'd1', ebene: EBENE_DURCHBRUECHE },
  // Grundstück und Wärmepumpe liegen draußen und gehören zu keinem Geschoss.
  site: { id: 'st1', ebene: EBENE_GELAENDE },
  heatpump: { id: 'wp1', ebene: EBENE_GELAENDE },
  image: { id: 'img1', ebene: EBENE_BILD },
  // Die drei Fälle, die im Dokument nachschlagen. Die Proben sind bewusst
  // **nicht** Heizung, weil Heizung zugleich der Rückfallwert ist: Eine
  // Fassung, die gar nicht nachschlüge, käme bei einem Heizkörper zufällig
  // richtig heraus und fiele erst beim WC auf.
  fixture: { id: 'fx-sani', ebene: EBENE_SANITAER },
  pipe: { id: 'p-cold-water', ebene: EBENE_SANITAER },
  accessory: { id: 'ac-lueft', ebene: EBENE_LUEFTUNG },
  /*
   * Die einzige Art ohne Ebene — und das mit Absicht.
   *
   * Der Spurkandidat ist das, was die Bilderkennung in einem hochgeladenen
   * Grundriss *vermutet*: ein Vorschlag, den man annimmt oder wegwirft. Er
   * ist kein Bauteil, steht auf keinem Blatt und gehört keinem Gewerk. Ihn
   * sperrbar zu machen hieße, einen Vorschlag gegen Annahme zu schützen; ihn
   * ausblendbar zu machen hieße, ihn übersehen zu können, obwohl er genau
   * dafür da ist, gesehen und entschieden zu werden.
   */
  trace: { id: 'tr1', ebene: OHNE },
};

/**
 * Für jedes Medium: auf welcher Ebene die Leitung liegt.
 *
 * Auch hier erzwingt `Record<PipeService, …>` die Vollständigkeit — ein neues
 * Medium ohne Zuordnung fiele sonst in den `default`-Zweig von
 * `ebeneFuerMedium` und landete stillschweigend beim Sanitär.
 */
const MEDIUM_EBENE: Record<PipeService, LayerId> = {
  'heating-flow': EBENE_HEIZUNG,
  'heating-return': EBENE_HEIZUNG,
  /*
   * **Warum das Kältemittel zur Heizung gehört und nicht zum Sanitär.**
   *
   * Die Leitung zwischen Außen- und Inneneinheit eines Splitgeräts führt
   * weder Trinkwasser noch Abwasser — sie führt den Stoff, mit dem die Wärme
   * ins Haus kommt. Fachlich ist sie ein Teil der Wärmeerzeugung: Wer das
   * Heizungsblatt zieht, will sehen, wo die Kältemittelleitung durch die
   * Fassade geht, denn dort sitzt die Kernbohrung, dort hängt die
   * Inneneinheit, und dort entscheidet sich die Leitungslänge, die das Gerät
   * noch zulässt. Auf dem Sanitärblatt wäre sie an der Stelle, an der der
   * Heizungsbauer sie nicht sucht.
   *
   * Die Gegenprobe: Der Grund, aus dem `refrigerant` überhaupt eine eigene
   * Leitungsart ist, ist die **Legende** — als „Heizung Vorlauf" gezeichnet
   * behauptete sie Heizungswasser, mit Zollmaßen daneben und einem Monteur,
   * der danach Dämmung, Druckprobe und Kälteschein richtet (so steht es am
   * Feld in `types/bim.ts`). Eine eigene Art im Fließbild und dieselbe Ebene
   * im Plan sind deshalb kein Widerspruch: Die Art sagt, *was* drin ist, die
   * Ebene sagt, *auf welchem Blatt* es steht.
   */
  refrigerant: EBENE_HEIZUNG,
  'ventilation-supply': EBENE_LUEFTUNG,
  'ventilation-exhaust': EBENE_LUEFTUNG,
  'hot-water': EBENE_SANITAER,
  'cold-water': EBENE_SANITAER,
  circulation: EBENE_SANITAER,
  waste: EBENE_SANITAER,
};

const ALLE_MEDIEN = Object.keys(MEDIUM_EBENE) as PipeService[];
const ALLE_AUSWAHLARTEN = Object.keys(ZUORDNUNG) as SelectionKind[];

// ---------------------------------------------------------------------------
// Die Prüfungen
// ---------------------------------------------------------------------------

export function pruefeEbenen(check: CheckFn): void {
  const doc = probenhaus();

  // === A — Die Zuordnung ist vollständig ==================================
  //
  // Sechzehn Auswahlarten stehen in `src/types/bim.ts`: node, wall, opening,
  // room, trace, image, fixture, vertical, solid, durchbruch, pipe,
  // accessory, annotation, roofOpening, site, heatpump. Die Zahl steht hier
  // von Hand, damit eine neue Art nicht nur die Tafel oben erweitert, sondern
  // auch hier eine Entscheidung erzwingt.
  check('Es gibt sechzehn Auswahlarten', ALLE_AUSWAHLARTEN.length, 16);

  // Jede einzeln — der Kern des Blocks. Eine Zeile je Art, damit im Protokoll
  // steht, welche danebenliegt, und nicht nur, dass eine danebenliegt.
  for (const kind of ALLE_AUSWAHLARTEN) {
    const soll = ZUORDNUNG[kind];
    check(`Auswahlart „${kind}" liegt auf ${soll.ebene}`, ebeneFuerAuswahl(doc, kind, soll.id) ?? OHNE, soll.ebene);
  }

  /*
   * Und die Gegenrichtung als eine Zahl: Genau **eine** Art darf ohne Ebene
   * herauskommen. Die Zeile ist die Zusage, um die es in Abschnitt A
   * eigentlich geht — nicht „trace hat keine Ebene" (das steht schon oben),
   * sondern „sonst niemand".
   *
   * Der Name steht daneben, weil eine bloße Anzahl den Fall durchließe, in
   * dem eine neue Art durchfällt und `trace` gleichzeitig eine Ebene bekommt:
   * Zwei Fehler, die sich in der Summe aufheben.
   */
  const ohneEbene = ALLE_AUSWAHLARTEN.filter((k) => ebeneFuerAuswahl(doc, k, ZUORDNUNG[k].id) === undefined);
  check('Genau eine Auswahlart liefert keine Ebene', ohneEbene.length, 1);
  check('… und das ist der Spurkandidat', ohneEbene.join(', ') || 'keine', 'trace');

  // === B — Jede gelieferte Ebenenkennung existiert wirklich ===============
  //
  // Abgeglichen wird gegen die Handabschrift von `DEFAULT_LAYERS` ganz oben.
  // Zuerst die Abschrift selbst: zehn Einträge, jeder genau einmal. Eine
  // doppelte Kennung machte den Abgleich unten schwächer, ohne dass es
  // auffiele.
  check('Die Abschrift aus DEFAULT_LAYERS hat zehn Ebenen', EBENEN_AUS_STORE.length, 10);
  check('… und jede Kennung kommt genau einmal vor', IM_STORE.size, 10);

  /*
   * Die zehn Kennungen, die `src/lib/ebenen.ts` führt, gegen die Abschrift.
   * Hier fällt ein Tippfehler auf, und hier fällt auf, wenn jemand eine
   * Ebene im Speicher umbenennt, ohne das Modul mitzuziehen: Beide Stellen
   * müssen sich einig sein, und sie sind es nur dann, wenn sie unabhängig
   * dasselbe sagen.
   */
  check('Die Wandebene heißt layer-walls', EBENE_WAENDE, 'layer-walls');
  check('Die Öffnungsebene heißt layer-openings', EBENE_OEFFNUNGEN, 'layer-openings');
  check('Die Raumebene heißt layer-rooms', EBENE_RAEUME, 'layer-rooms');
  check('Die Maßebene heißt layer-dimensions', EBENE_MASSE, 'layer-dimensions');
  check('Die Heizungsebene heißt layer-heating', EBENE_HEIZUNG, 'layer-heating');
  check('Die Sanitärebene heißt layer-sanitary', EBENE_SANITAER, 'layer-sanitary');
  check('Die Lüftungsebene heißt layer-ventilation', EBENE_LUEFTUNG, 'layer-ventilation');
  check('Die Durchbruchebene heißt layer-durchbrueche', EBENE_DURCHBRUECHE, 'layer-durchbrueche');
  check('Die Geländeebene heißt layer-site', EBENE_GELAENDE, 'layer-site');
  check('Die Bildebene heißt layer-image', EBENE_BILD, 'layer-image');

  /*
   * Und der eigentliche Abgleich über alle Auswahlarten. Eine Zuordnung auf
   * eine Ebene, die es nicht gibt, sähe im Programm aus wie „immer sichtbar,
   * nie sperrbar" — `doc.layers['layer-heizung']` ist `undefined`, und das
   * ist von einer sichtbaren, offenen Ebene nicht zu unterscheiden.
   *
   * Gemeldet wird die Kennung selbst und nicht nur eine Anzahl: Bei einem
   * Tippfehler ist der Name die ganze Auskunft.
   */
  const unbekannte = ALLE_AUSWAHLARTEN.map((k) => ebeneFuerAuswahl(doc, k, ZUORDNUNG[k].id))
    .filter((id): id is LayerId => id !== undefined)
    .filter((id) => !IM_STORE.has(id));
  check('Jede zugeordnete Ebene gibt es in DEFAULT_LAYERS', unbekannte.join(', ') || 'keine', 'keine');

  // === C — Das Medium bestimmt die Ebene, nicht das Werkzeug ==============
  //
  // Neun Medien stehen in `PipeService`. Sie verteilen sich auf drei Ebenen:
  // Heizung Vor- und Rücklauf sowie Kältemittel → Heizung (3), Zu- und
  // Abluft → Lüftung (2), Trinkwasser warm und kalt, Zirkulation und
  // Abwasser → Sanitär (4). Die Begründung für das Kältemittel steht an der
  // Tafel oben.
  check('Es gibt neun Medien', ALLE_MEDIEN.length, 9);
  check('Drei davon liegen auf der Heizung', ALLE_MEDIEN.filter((s) => MEDIUM_EBENE[s] === EBENE_HEIZUNG).length, 3);
  check('… zwei auf der Lüftung', ALLE_MEDIEN.filter((s) => MEDIUM_EBENE[s] === EBENE_LUEFTUNG).length, 2);
  check('… und vier auf dem Sanitär', ALLE_MEDIEN.filter((s) => MEDIUM_EBENE[s] === EBENE_SANITAER).length, 4);

  for (const service of ALLE_MEDIEN) {
    check(`Medium „${service}" liegt auf ${MEDIUM_EBENE[service]}`, ebeneFuerMedium(service), MEDIUM_EBENE[service]);
  }

  /*
   * Dasselbe noch einmal über den Weg, den das Programm tatsächlich geht:
   * eine ausgewählte Leitung. `ebeneFuerAuswahl` muss dafür im Dokument
   * nachschlagen, welches Medium dieser Abschnitt führt — die Auswahlart
   * allein sagt es nicht.
   *
   * **Das ist der Satz „das Medium bestimmt die Ebene, nicht das Werkzeug".**
   * Alle neun Leitungen im Probenhaus sind mit demselben Aufruf entstanden
   * und unterscheiden sich in nichts außer `service`. Wer die Ebene am
   * Zeichenwerkzeug festmachte — „mit dem Heizungsstift gezogen, also
   * Heizung" —, käme hier neunmal auf dieselbe Ebene.
   */
  for (const service of ALLE_MEDIEN) {
    check(
      `Die ausgewählte ${service}-Leitung liegt auf ${MEDIUM_EBENE[service]}`,
      ebeneFuerAuswahl(doc, 'pipe', `p-${service}`) ?? OHNE,
      MEDIUM_EBENE[service],
    );
  }

  // Die Objekte folgen ihrem Gewerk, nicht ihrem Medium — ein Heizkörper
  // führt Heizungswasser, ein Lüftungsventil führt Luft, und beide sagen es
  // über `category`.
  check('Ein Heizungsobjekt liegt auf der Heizung', ebeneFuerObjekt({ category: 'heating' }), EBENE_HEIZUNG);
  check('Ein Sanitärobjekt liegt auf dem Sanitär', ebeneFuerObjekt({ category: 'sanitary' }), EBENE_SANITAER);
  check('Ein Lüftungsobjekt liegt auf der Lüftung', ebeneFuerObjekt({ category: 'ventilation' }), EBENE_LUEFTUNG);
  check('Das ausgewählte WC liegt auf dem Sanitär', ebeneFuerAuswahl(doc, 'fixture', 'fx-sani') ?? OHNE, EBENE_SANITAER);
  check('Das ausgewählte Ventil liegt auf der Lüftung', ebeneFuerAuswahl(doc, 'fixture', 'fx-lueft') ?? OHNE, EBENE_LUEFTUNG);

  /*
   * Die Armatur hat kein eigenes Gewerk — sie erbt es von der Leitung, an der
   * sie sitzt. Dieselbe Absperrung liegt am Zuluftkanal auf der Lüftung und
   * am Abwasserstrang auf dem Sanitär; nur die Leitungskennung unterscheidet
   * die beiden Fälle. Eine Fassung, die die Armaturen pauschal der Heizung
   * gäbe, blendete den Absperrschieber im Abwasserstrang nie aus.
   */
  check('Die Absperrung am Zuluftkanal liegt auf der Lüftung', ebeneFuerAuswahl(doc, 'accessory', 'ac-lueft') ?? OHNE, EBENE_LUEFTUNG);
  check('… die am Abwasserstrang auf dem Sanitär', ebeneFuerAuswahl(doc, 'accessory', 'ac-sani') ?? OHNE, EBENE_SANITAER);
  check('… und die am Heizungsvorlauf auf der Heizung', ebeneFuerAuswahl(doc, 'accessory', 'ac-heiz') ?? OHNE, EBENE_HEIZUNG);

  /*
   * Und die Rückfälle. Findet sich zu einer Kennung nichts im Dokument —
   * eine gelöschte Leitung, eine Armatur ohne Zuordnung —, liefert das Modul
   * die Heizungsebene und ausdrücklich **nicht** `undefined`.
   *
   * Das ist die richtige Wahl, auch wenn sie willkürlich aussieht: `undefined`
   * hieße „auf keiner Ebene" und damit „nie sperrbar, nie ausblendbar". Ein
   * verwaistes Bauteil wäre dann das einzige im Plan, das sich beim Sperren
   * des Bestands noch verschieben ließe — und zwar unsichtbar, weil nichts
   * darauf hinweist. Eine falsche, aber greifbare Ebene ist dem vorzuziehen.
   */
  check('Eine Leitung ohne Eintrag fällt auf die Heizung zurück', ebeneFuerAuswahl(doc, 'pipe', 'gibtsnicht') ?? OHNE, EBENE_HEIZUNG);
  check('… eine Armatur ohne Leitung ebenso', ebeneFuerAuswahl(doc, 'accessory', 'ac-ohne') ?? OHNE, EBENE_HEIZUNG);
  check('… und ein Objekt ohne Eintrag auch', ebeneFuerAuswahl(doc, 'fixture', 'gibtsnicht') ?? OHNE, EBENE_HEIZUNG);
  check('Der Rückfall ist keine fehlende Ebene', ebeneFuerAuswahl(doc, 'pipe', 'gibtsnicht') === undefined, false);

  // === D — Sichtbar und gesperrt ==========================================
  //
  // Die vier Zustände, auf die es ankommt, als vier Ebenen in einem
  // Dokument:
  //
  //   layer-walls        sichtbar,     offen    → der Normalfall
  //   layer-heating      ausgeblendet, offen    → weggeblendet, aber änderbar
  //   layer-rooms        sichtbar,     gesperrt → der Kern dieses Abschnitts
  //   layer-openings     fehlt ganz               → „unbekannt"
  //
  // Die Sanitärebene fehlt ebenfalls und dient als zweite Probe darauf.
  const gemischt = probenhaus({
    [EBENE_WAENDE]: ebeneEintrag(EBENE_WAENDE, true, false),
    [EBENE_HEIZUNG]: ebeneEintrag(EBENE_HEIZUNG, false, false),
    [EBENE_RAEUME]: ebeneEintrag(EBENE_RAEUME, true, true),
  });

  check('Eine sichtbare, offene Ebene ist sichtbar', istSichtbar(gemischt, 'wall', 'w1'), true);
  check('… und nicht gesperrt', istGesperrt(gemischt, 'wall', 'w1'), false);

  /*
   * Ausgeblendet heißt unsichtbar — und sonst nichts. Der Heizkörper auf der
   * ausgeblendeten Heizungsebene bleibt offen; wer ihn über die Raumliste
   * auswählt, darf ihn weiterhin ändern. „Aus" ist eine Aussage über das
   * Hinsehen, nicht über das Anfassen.
   */
  check('Eine ausgeblendete Ebene ist nicht sichtbar', istSichtbar(gemischt, 'fixture', 'fx-heiz'), false);
  check('… bleibt aber offen', istGesperrt(gemischt, 'fixture', 'fx-heiz'), false);

  /*
   * **Der Kern: gesperrt heißt sichtbar, aber unantastbar.**
   *
   * Wer den Bestand sperrt, will ihn weiterhin sehen — er misst ja daran
   * entlang und setzt seine Heizkörper davor. Würde „gesperrt" das Bauteil
   * mit ausblenden, wäre der Schalter für das Aufmaß wertlos: Man zielt dann
   * auf eine leere Fläche. Die zweite Zeile ist deshalb die wichtigere von
   * beiden, und sie ist die, die bei einer zusammengelegten Abfrage
   * (`visible && !locked`) als erste kippt.
   */
  check('Eine gesperrte Ebene ist gesperrt', istGesperrt(gemischt, 'room', 'r1'), true);
  check('… und bleibt trotzdem sichtbar', istSichtbar(gemischt, 'room', 'r1'), true);
  check('Die fertige Auswahl wird genauso beurteilt', auswahlGesperrt(gemischt, { kind: 'room', id: 'r1' }), true);
  check('… und die offene Wand bleibt offen', auswahlGesperrt(gemischt, { kind: 'wall', id: 'w1' }), false);

  /*
   * Eine Auswahlart ohne Ebene ist immer sichtbar und nie gesperrt. Beim
   * Spurkandidaten ist das die einzig brauchbare Antwort: Ein Vorschlag, den
   * niemand mehr sehen kann, ist verloren, und einer, den man nicht annehmen
   * darf, ist zwecklos.
   */
  check('Ohne Ebene ist immer sichtbar', istSichtbar(gemischt, 'trace', 'tr1'), true);
  check('… und nie gesperrt', istGesperrt(gemischt, 'trace', 'tr1'), false);

  /*
   * **Warum „unbekannt" nicht wie „aus" behandelt werden darf.**
   *
   * Die Öffnungs- und die Sanitärebene stehen in diesem Dokument gar nicht;
   * `doc.layers['layer-openings']` ist `undefined`. Der naheliegende
   * Vergleich `=== true` machte daraus „nicht sichtbar" — und das wäre der
   * teuerste Fehler dieses Moduls:
   *
   * Eine Datei aus einer älteren Fassung kennt die Ebenen nicht, die später
   * dazugekommen sind (Durchbrüche und Gelände kamen erst mit 1.26.0). Beim
   * Öffnen verschwände damit schlagartig alles, was auf ihnen liegt — und
   * zwar ohne Meldung, ohne Schalter, der es zurückholt, und ohne dass der
   * Anwender wüsste, dass etwas fehlt. Er sähe einen Plan, hielte ihn für
   * vollständig und rechnete damit.
   *
   * Deshalb heißt die Regel `!== false`: Nur ein ausdrückliches „aus" blendet
   * aus. Alles andere ist an. Dasselbe in der Sperre: Nur ein ausdrückliches
   * `locked === true` sperrt — eine unbekannte Ebene liefert sonst ein
   * Bauteil, das sich nicht mehr anfassen lässt und für das es keinen
   * Schalter gibt, weil die Ebene in keiner Liste steht.
   */
  check('Eine unbekannte Ebene gilt als sichtbar', istSichtbar(gemischt, 'opening', 'o1'), true);
  check('… und als nicht gesperrt', istGesperrt(gemischt, 'opening', 'o1'), false);
  check('Beim WC auf der fehlenden Sanitärebene genauso', istSichtbar(gemischt, 'fixture', 'fx-sani'), true);
  check('… und ebenfalls offen', istGesperrt(gemischt, 'fixture', 'fx-sani'), false);
  // Und die Gegenprobe im leeren Dokument: dort fehlt jede Ebene, und
  // trotzdem ist alles sichtbar und offen.
  check('Ohne jede Ebenentabelle bleibt alles sichtbar', istSichtbar(doc, 'wall', 'w1'), true);
  check('… und alles offen', istGesperrt(doc, 'wall', 'w1'), false);

  // === E — Was „Bestand sperren" sperrt ===================================
  //
  // Vier Ebenen: Wände, Öffnungen, Räume, Durchbrüche — das Gebäude.
  const bestand = new Set<LayerId>(BESTANDS_EBENEN);
  check('Der Bestand umfasst vier Ebenen', BESTANDS_EBENEN.length, 4);
  check('… und jede Kennung kommt genau einmal vor', bestand.size, 4);
  check('Die Wände gehören dazu', bestand.has(EBENE_WAENDE), true);
  check('Die Öffnungen auch', bestand.has(EBENE_OEFFNUNGEN), true);
  check('Die Räume auch', bestand.has(EBENE_RAEUME), true);
  check('Und die Durchbrüche auch', bestand.has(EBENE_DURCHBRUECHE), true);

  /*
   * **Die Maßketten gehören ausdrücklich nicht dazu.** Sie beschreiben das
   * Gebäude, sie sind nicht das Gebäude — und beim Aufmaß entstehen sie
   * fortwährend: Man sperrt den Bestand ja gerade, *um* daran zu messen.
   * Wären sie mitgesperrt, ließe der Schalter genau die Tätigkeit nicht mehr
   * zu, für die es ihn gibt.
   */
  check('Die Maßketten gehören nicht dazu', bestand.has(EBENE_MASSE), false);
  /*
   * **Das Referenzbild ebenso wenig.** Es hat sein eigenes Schloss, weil es
   * einen anderen Lebenslauf hat als das Gebäude: Beim Kalibrieren wird es
   * verschoben und skaliert, danach nie wieder. Zwei Schlösser für dasselbe
   * Bild wären zwei Stellen, an denen man suchen muss, wenn es sich nicht
   * bewegen lässt — und der Anwender findet immer nur eine davon.
   */
  check('Das Referenzbild gehört nicht dazu', bestand.has(EBENE_BILD), false);
  /*
   * Und die Technik nicht: Sie ist das, was man **vor** dem gesperrten
   * Bestand setzt. Wäre sie mitgesperrt, sperrte „Bestand sperren" den ganzen
   * Plan und hieße schlicht „alles sperren".
   */
  check('Die Heizung gehört nicht dazu', bestand.has(EBENE_HEIZUNG), false);
  check('Das Sanitär nicht', bestand.has(EBENE_SANITAER), false);
  check('Die Lüftung nicht', bestand.has(EBENE_LUEFTUNG), false);
  check('Und das Gelände nicht', bestand.has(EBENE_GELAENDE), false);
  check(
    'Jede Bestandsebene gibt es in DEFAULT_LAYERS',
    BESTANDS_EBENEN.filter((id) => !IM_STORE.has(id)).join(', ') || 'keine',
    'keine',
  );

  // === F — Die vier Gewerkeblätter ========================================
  //
  // Grundriss, Heizung, Sanitär, Lüftung.
  check('Es gibt vier Gewerkessätze', GEWERKESAETZE.length, 4);
  check('… mit vier verschiedenen Kennungen', new Set(GEWERKESAETZE.map((s) => s.id)).size, 4);
  check('… und vier verschiedenen Beschriftungen', new Set(GEWERKESAETZE.map((s) => s.label)).size, 4);

  /*
   * Auf jedem Blatt: Wände, Öffnungen, Räume und Maßketten.
   *
   * Die Maßketten sind der Punkt, an dem eine sparsame Fassung kippt — sie
   * sehen wie Beiwerk aus und sind es nicht: Ein Blatt ohne Maße ist ein
   * Bild, kein Plan. Der Monteur kann daraus nichts anreißen. Die Räume
   * gehören aus demselben Grund dazu: Er muss wissen, in welchem Raum er
   * steht.
   */
  for (const satz of GEWERKESAETZE) {
    const an = new Set<LayerId>(satz.sichtbar);
    check(`Satz „${satz.id}" zeigt die Wände`, an.has(EBENE_WAENDE), true);
    check(`Satz „${satz.id}" zeigt die Öffnungen`, an.has(EBENE_OEFFNUNGEN), true);
    check(`Satz „${satz.id}" zeigt die Räume`, an.has(EBENE_RAEUME), true);
    check(`Satz „${satz.id}" zeigt die Maßketten`, an.has(EBENE_MASSE), true);
    check(
      `Satz „${satz.id}" nennt nur Ebenen aus DEFAULT_LAYERS`,
      satz.sichtbar.filter((id) => !IM_STORE.has(id)).join(', ') || 'keine',
      'keine',
    );
    check(`Satz „${satz.id}" nennt keine Ebene doppelt`, an.size, satz.sichtbar.length);
  }

  const satzNach = (id: string): Set<LayerId> =>
    new Set<LayerId>(GEWERKESAETZE.find((s) => s.id === id)?.sichtbar ?? []);
  const grundriss = satzNach('grundriss');
  const heizung = satzNach('heizung');
  const sanitaer = satzNach('sanitaer');
  const lueftung = satzNach('lueftung');

  /*
   * **Das Grundrissblatt trägt kein Gewerk.** Es ist das Blatt, das man dem
   * Architekten, dem Bauherrn oder dem Trockenbauer gibt; jede Leitung
   * darauf ist eine Information, die dort niemand braucht und die den Plan
   * nur zustellt.
   */
  check('Der Grundriss zeigt vier Ebenen', grundriss.size, 4);
  check('… und keine Heizung', grundriss.has(EBENE_HEIZUNG), false);
  check('… kein Sanitär', grundriss.has(EBENE_SANITAER), false);
  check('… und keine Lüftung', grundriss.has(EBENE_LUEFTUNG), false);

  /*
   * **Jeder Gewerkesatz enthält genau sein Gewerk und keines der beiden
   * anderen.** Das ist die Zusage, wegen der es die Sätze gibt: Auf dem
   * Heizungsblatt steht die Heizung und sonst keine Technik. Ein
   * durchgerutschtes fremdes Gewerk fiele am Bildschirm kaum auf — man sieht
   * eine Leitung mehr und hält sie für die eigene — und auf der Baustelle
   * führt es dazu, dass zwei Gewerke denselben Schacht für sich in Anspruch
   * nehmen.
   *
   * Die Durchbrüche stehen auf allen drei Technikblättern, und zwar
   * absichtlich: Wer bohrt, braucht den Plan mit den Bohrungen seines
   * Gewerks — und wer plant, muss sehen, ob dort schon ein anderes Loch
   * sitzt.
   */
  check('Das Heizungsblatt zeigt die Heizung', heizung.has(EBENE_HEIZUNG), true);
  check('… und kein Sanitär', heizung.has(EBENE_SANITAER), false);
  check('… und keine Lüftung', heizung.has(EBENE_LUEFTUNG), false);
  check('… dafür die Durchbrüche', heizung.has(EBENE_DURCHBRUECHE), true);

  check('Das Sanitärblatt zeigt das Sanitär', sanitaer.has(EBENE_SANITAER), true);
  check('… und keine Heizung', sanitaer.has(EBENE_HEIZUNG), false);
  check('… und keine Lüftung', sanitaer.has(EBENE_LUEFTUNG), false);
  check('… dafür die Durchbrüche', sanitaer.has(EBENE_DURCHBRUECHE), true);

  check('Das Lüftungsblatt zeigt die Lüftung', lueftung.has(EBENE_LUEFTUNG), true);
  check('… und keine Heizung', lueftung.has(EBENE_HEIZUNG), false);
  check('… und kein Sanitär', lueftung.has(EBENE_SANITAER), false);
  check('… dafür die Durchbrüche', lueftung.has(EBENE_DURCHBRUECHE), true);

  /*
   * Die Sichtbarkeitstabelle: `sichtbarkeitAus` beantwortet für **jede**
   * übergebene Ebene, ob sie an ist — auch für die, die im Satz nicht
   * vorkommen. Eine Tabelle mit Lücken wäre hier gefährlich, denn ein
   * fehlender Eintrag ist `undefined`, und `undefined` heißt an anderer
   * Stelle „unbekannt, also sichtbar" (Abschnitt D). Wer die Tabelle so in
   * `doc.layers` schriebe, bekäme ein Gewerkeblatt, auf dem die fremde
   * Technik weiterhin steht.
   *
   * Die Anzahl der Einträge steht daneben: zehn, also alle. Die Anzahl der
   * `true` ist die Länge des Satzes — vier beim Grundriss, sechs bei den
   * Gewerken.
   */
  for (const satz of GEWERKESAETZE) {
    const tafel = sichtbarkeitAus(satz, EBENEN_AUS_STORE);
    const eintraege = Object.keys(tafel);
    check(`Satz „${satz.id}" beantwortet alle zehn Ebenen`, eintraege.length, 10);
    check(
      `… jede mit einem Wahrheitswert`,
      eintraege.every((id) => typeof tafel[id] === 'boolean'),
      true,
    );
    check(
      `… genau die Ebenen des Satzes stehen auf an`,
      eintraege.filter((id) => tafel[id]).sort().join(', '),
      [...satz.sichtbar].sort().join(', '),
    );
    check(`… das sind ${satz.sichtbar.length} von zehn`, eintraege.filter((id) => tafel[id]).length, satz.sichtbar.length);
  }

  // Die Zahlen noch einmal ausgeschrieben, damit sie im Protokoll stehen:
  // Grundriss 4 an / 6 aus, jedes Gewerkeblatt 6 an / 4 aus.
  check('Der Grundriss schaltet vier Ebenen an', grundriss.size, 4);
  check('Das Heizungsblatt sechs', heizung.size, 6);
  check('Das Sanitärblatt sechs', sanitaer.size, 6);
  check('Das Lüftungsblatt sechs', lueftung.size, 6);

  // === G — Die Auskunftstexte =============================================
  //
  // Sie stehen als Titel an den Schaltflächen und sind das Einzige, was
  // erklärt, was ein Blatt zeigt. Ein leerer Text macht die Schaltfläche
  // nicht kaputt — sie bleibt bedienbar, nur weiß niemand mehr, was sie tut,
  // und der Unterschied zwischen „Heizung" und „Sanitär" muss dann durch
  // Ausprobieren gefunden werden.
  //
  // Zwanzig Zeichen sind die Grenze, unter der kein Satz mehr steht, der
  // etwas aufzählt: „Grundriss mit Heizflächen…" allein ist länger.
  for (const satz of GEWERKESAETZE) {
    check(`Satz „${satz.id}" hat eine Beschriftung`, satz.label.trim().length > 0, true);
    check(`Satz „${satz.id}" hat einen Auskunftstext`, satz.auskunft.trim().length > 0, true);
    check(`… von mindestens 20 Zeichen`, satz.auskunft.trim().length >= 20, true);
    // Er endet als Satz. Ein abgeschnittener Text — der häufigste Fehler beim
    // Umformulieren — endet ohne Punkt und fällt hier auf.
    check(`… und endet als Satz`, satz.auskunft.trim().endsWith('.'), true);
  }
  check('Die vier Auskunftstexte sind verschieden', new Set(GEWERKESAETZE.map((s) => s.auskunft)).size, 4);
}
