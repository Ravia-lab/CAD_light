/**
 * Modellprüfung — der Torwächter vor dem Export.
 * ---------------------------------------------------------------------------
 * Eine Heizlastrechnung ist nur so gut wie die Daten, die sie bekommt. Fehlt
 * ein U-Wert, wird stillschweigend ein Standardwert gerechnet; ist ein Raum
 * nicht geschlossen, fehlt er komplett; steht ein Fenster in einer zu kurzen
 * Wand, stimmt die Nettofläche nicht. Solche Lücken fallen in der Gegenstelle
 * erst auf, wenn das Ergebnis schon falsch ist.
 *
 * Deshalb prüft dieses Modul das Modell und liefert einen Befund mit drei
 * Stufen:
 *   • `error`   — die Rechnung wäre nachweislich falsch
 *   • `warning` — es wird gerechnet, aber mit einer Annahme statt einer Angabe
 *   • `info`    — Hinweis auf Unvollständigkeit ohne Rechenfolgen
 *
 * Der Befund wandert *mit* in den Export. Die Gegenstelle sieht damit sofort,
 * worauf sie sich verlassen kann.
 */

import type { BimDocument, ValidationIssue, ValidationReport, Vec2 } from '../types/bim';
import { distance } from './geometry';
import { durchbruchPasst } from './durchbruchSymbols';
import { durchbruchWirt } from '../types/bim';
import { BRUESTUNGS_HOEHE, diagnoseClosure, gebaeudeUmriss, gradeSplit } from './roomDetection';
import { BAUTEIL_BEZEICHNUNG, VORGABE_U, istErfasst, uWertOeffnung, uWertWand } from './uwert';
import { documentBridgeHeatLoss, envelopeArea } from './thermalBridges';
import { buildPipeNetwork } from './pipeNetwork';
import { acousticReport, protectionIssues, sourceDemand, waterProtectionVerdict } from './heatPump';
import { daecherVon, raeumeOhneGeschossDarueber } from './dachlandschaft';

/** Objekte, die Wärme in den Raum geben — nur sie brauchen eine Leistung. */
const HEAT_EMITTERS = new Set(['radiator', 'radiator-tube', 'towel-radiator', 'convector', 'underfloor']);

/** Welche Leitungsarten zu welchem Gewerk gehören. */
const SERVICE_CATEGORY: Record<string, 'heating' | 'sanitary' | 'ventilation'> = {
  'heating-flow': 'heating',
  'heating-return': 'heating',
  'hot-water': 'sanitary',
  'cold-water': 'sanitary',
  circulation: 'sanitary',
  waste: 'sanitary',
  'ventilation-supply': 'ventilation',
  'ventilation-exhaust': 'ventilation',
};


/**
 * Was zu tun ist — je Befund ein Satz.
 *
 * Ein Prüfbericht, der nur sagt, was falsch ist, hilft dem nicht weiter, der
 * es nicht ohnehin schon weiß. Die Meldung nennt das Problem, dieser Satz den
 * Handgriff: welches Werkzeug, welcher Reiter, welche Eingabe. Bewusst getrennt
 * gehalten, damit die Meldung kurz bleiben kann.
 */
export const REMEDIES: Record<string, string> = {
  'plant.no-generator': 'Im Reiter „Anlage" ein Gerät aus der Vorschlagsliste wählen — sie ist nach Eignung sortiert.',
  'plant.estimated-load':
    'Die Norm-Heizlast aus RaVia im Reiter „Anlage" oben eintragen. Alle Folgegrößen rechnen sich sofort neu.',
  'plant.spread': 'Im Reiter „Anlage" unter „Verteilung" den Rücklauf unter den Vorlauf setzen — üblich sind 5 bis 8 K Abstand.',
  'plant.dhw-temperature': 'Speichertemperatur im Reiter „Anlage" senken und stattdessen eine wöchentliche Aufheizung vorsehen.',
  'plant.static-height':
    'Ansprechdruck des Sicherheitsventils auf 3,0 bar erhöhen oder das Ausdehnungsgefäß weiter oben anordnen.',
  'plant.glycol-low': 'Entweder auf 25–35 Vol-% erhöhen oder auf 0 setzen. Dazwischen gibt es nur Nachteile.',
  'plant.schematic-dangling': 'Im Reiter „Anlage" auf „Schema neu erzeugen" klicken.',
  'topology.open-end':
    'Mit dem Wand-Werkzeug vom orangefarbenen Punkt aus bis an die nächste Wand ziehen — sie verbindet sich dort von selbst.',
  'topology.no-rooms':
    'Ein Raum entsteht erst, wenn die Wände einen geschlossenen Ring bilden. Die orangefarbenen Punkte zeigen, wo er noch offen ist.',
  'topology.gap':
    'Zwischen den beiden genannten Punkten eine Wand ziehen. Ist die Öffnung gewollt — eine Loggia, ein offener Übergang —, kann der Befund stehen bleiben: die Fläche zählt dann bewusst nicht als Raum.',
  'topology.near-miss':
    'Beide Wandenden auf denselben Punkt legen: Wandende anfassen und auf das andere ziehen, der Fang rastet ein. Der Raum wird auch so erkannt, aber Aufmaß und Export führen die Fuge weiter mit.',
  'topology.off-axis':
    'Das Wandende auf die Achse der getroffenen Wand ziehen, statt daneben zu enden. Erst dann teilt der T-Stoß die andere Wand und trägt die Raumkante.',
  'topology.overlap':
    'Eine der beiden Wände kürzen, bis sie an der anderen stumpf anstößt, oder die überzählige löschen. Solange sie übereinanderliegen, steht die gemeinsame Länge zweimal in Aufmaß und Hüllfläche.',
  'wall.dangling': 'Wandende an die nächste Wand heranziehen oder die Wand löschen, wenn sie nicht gebraucht wird.',
  'wall.degenerate': 'Diese Wand hat kaum Länge — vermutlich ein verrutschter Klick. Am besten löschen.',
  'wall.missing-u-value':
    'Wand anklicken und im Reiter „Objekt" den U-Wert eintragen oder einen Aufbau aus dem Katalog zuweisen. Bis dahin rechnet die Heizlast mit dem Vorgabewert der Bauteilart — einer Annahme, die zufällig passen kann und meist danebenliegt.',
  'wall.implausible-u-value':
    'U-Wert prüfen: eine gedämmte Außenwand liegt bei 0,15 bis 0,3, eine ungedämmte Altbauwand bei etwa 1,4. Eine 0 ist kein U-Wert — ein Bauteil ohne Wärmedurchgang gibt es nicht.',
  'construction.u-value':
    'Im Bauteilkatalog den U-Wert dieses Aufbaus eintragen. Ein Aufbau mit 0 nimmt jedem zugewiesenen Bauteil seinen Wärmeverlust, und zwar ohne dass es an der Wand selbst zu sehen wäre.',
  'wall.implausible-height':
    'Wandhöhe im Reiter „Objekt" prüfen — üblich sind 2,50 bis 3,00 m. Eine Brüstung oder ein Kniestock unter 1,60 m ist kein Fehler und wird nicht gemeldet.',
  'opening.missing-u-value':
    'Fenster oder Tür anklicken und den U-Wert eintragen. Auf dem Aufkleber am Rahmen steht er meist; sonst: 2-fach-Verglasung rund 1,3, 3-fach rund 0,9. Bis dahin rechnet die Übergabe mit dem Vorgabewert der Bauteilart.',
  'opening.implausible-u-value': 'U-Wert prüfen — Fenster liegen zwischen 0,8 (3-fach) und 3,0 (alte 2-fach-Verglasung).',
  'opening.missing-g-value':
    'g-Wert eintragen, wenn er bekannt ist. Er wirkt nur auf die sommerlichen Gewinne, nicht auf die Heizlast.',
  'opening.too-wide': 'Die Öffnung ist breiter als ihre Wand. Breite verkleinern oder die Öffnung auf eine längere Wand ziehen.',
  'opening.too-tall': 'Brüstung plus Höhe liegen über der Wandhöhe. Höhe oder Brüstungshöhe verringern.',
  'opening.overlap': 'Zwei Öffnungen liegen übereinander. Eine verschieben oder löschen.',
  'opening.orphan': 'Die zugehörige Wand fehlt — die Öffnung löschen.',
  'durchbruch.orphan':
    'Die durchbrochene Wand fehlt im Modell. Den Durchbruch auf eine vorhandene Wand ziehen oder löschen — ein Loch ohne Wand bohrt niemand.',
  'durchbruch.does-not-fit':
    'Der Durchbruch passt nicht in seine Wand. Maß verkleinern, Höhe über Fertigfußboden verringern oder ihn auf eine größere Wand setzen.',
  'durchbruch.overlap':
    'Zwei Durchbrüche überschneiden sich in derselben Wand. Einen verschieben oder beide zu einem gemeinsamen Wanddurchbruch zusammenfassen — zwei Kernbohrungen, die sich berühren, ergeben einen Ausbruch.',
  'durchbruch.no-brandschutz':
    'Der Durchbruch liegt in einer Wand, die Geschosse oder Nutzungseinheiten trennt, und trägt keine Brandschutzanforderung. In der Eigenschaftsleiste die geforderte Klasse setzen — oder bewusst „ohne Anforderung" stehen lassen.',
  'durchbruch.oversize':
    'Der Durchbruch ist größer als ein Viertel der Wandlänge. Ab dieser Größe ist es kein Durchbruch mehr, sondern ein Wandausschnitt: statisch nachweisen lassen oder als Durchgang zeichnen.',
  'room.missing-usage':
    'Raum anklicken und im Reiter „Objekt" die Nutzung wählen. Daraus ergeben sich Solltemperatur und Luftwechsel.',
  'room.tiny': 'Sehr kleiner Raum — meist ein ungewollter Restbereich zwischen zwei Wänden. Wände prüfen.',
  'room.implausible-height': 'Raumhöhe prüfen: üblich sind 2,40 bis 3,00 m. Unter der Dachschräge zählt die mittlere Höhe.',
  'room.no-exterior': 'Dieser Raum hat keine Außenwand. Das ist möglich (Innenbad), aber oft fehlt einfach eine Wand.',
  'room.unresolved-neighbour':
    'Hinter dieser Wand wurde kein Raum erkannt. Zwei Ursachen sind häufig: Dort fehlt eine Wand, sodass der Nachbarraum gar nicht geschlossen ist — dann im Reiter „Prüfung" unter „Aufmaß nachziehen" die Lücke schließen. Oder es liegt dort tatsächlich ein beheizter Raum, den die Geometrie nicht hergibt (offener Durchgang, Galerie) — dann die Wand anklicken und ihre Randbedingung ausdrücklich auf „Nachbarraum" setzen; eine Angabe an der Wand hat immer Vorrang. Bis dahin wird mit „unbeheizt" gerechnet, und das fällt **zu hoch** aus, nicht zu niedrig.',
  'level.missing-floor-u':
    'Im Reiter „Objekt" beim Geschoss den U-Wert für Boden und Decke eintragen. Für beide gibt es keinen Vorgabewert — zwischen gedämmter Bodenplatte und Geschossdecke liegt der Faktor drei —, sie fallen ohne Angabe mit 0 W aus der Heizlast.',
  'level.below-grade-no-ground':
    'Die Geländeoberkante im Projektkopf eintragen — dieselbe Bezugshöhe wie die Fußbodenhöhe der Geschosse. Erst dann weiß das Programm, welcher Teil der Wände im Erdreich steckt; bis dahin wird das ganze Geschoss gegen Außenluft gerechnet.',
  'level.embedment-exceeds-height':
    'Geländeoberkante oder Fußbodenhöhe des Geschosses prüfen: das Gelände liegt derzeit über der Decke dieses Geschosses. Bei einem Hanggrundstück ist das möglich, sonst ist meist ein Vorzeichen vertauscht.',
  'level.unheated-basement-ceiling':
    'Beim Kellergeschoss die Decke auf „an beheizten Raum" stellen und im Geschoss darüber den Boden auf „unbeheizt". Die Kellerdecke ist dann das gedämmte Bauteil — nicht mehr die Bodenplatte.',
  'opening.below-grade':
    'Liegt vor dem Fenster ein Lichtschacht, ist das richtig so. Sonst Brüstungshöhe oder Geländeoberkante prüfen — ein Fenster unter Gelände geht als volle Verlustfläche gegen Außenluft in die Rechnung.',
  'fixture.missing-power':
    'Heizkörper anklicken und die Leistung eintragen. Sie steht meist auf dem Typenschild; sonst hilft die Baugröße weiter.',
  'fixture.missing-airflow': 'Volumenstrom des Ventils eintragen — er steht auf dem Datenblatt der Anlage.',
  'fixture.no-room':
    'Das Symbol liegt außerhalb aller Räume. Mit dem Auswahl-Werkzeug in den Raum schieben, sonst fehlt es in dessen Auswertung.',
  'project.outdoor-temperature':
    'Norm-Außentemperatur im Reiter „Objekt" prüfen. In Deutschland liegt sie je nach Region zwischen −10 und −16 °C.',
  'project.n50':
    'n50 kommt aus dem Blower-Door-Test. Ohne Messung: Neubau 1,5, Altbau 3 bis 6.',
  'project.thermal-bridges-ignored':
    'Im Reiter „Wärmebrücken" den Zuschlag setzen — ohne Nachweis sind 0,10 W/(m²·K) vorgesehen.',
  'project.thermal-bridges-empty':
    'Im Reiter „Wärmebrücken" auf „pauschal" zurückschalten oder prüfen, warum keine Anschlüsse gefunden werden.',
  'project.thermal-bridges-low': 'Die ψ-Werte im Reiter „Wärmebrücken" gegen den Katalog des Herstellers halten.',
  'project.reheat-factor': 'Nichts zu tun, solange keine Zusatzleistung angesetzt werden soll — in Deutschland der Regelfall.',
  'project.setback-hours': 'Im Reiter „Wärmebrücken" unter „Absenkbetrieb" die Absenkzeit eintragen oder die Absenkung abschalten.',
  'roof.above-storey':
    'Im Reiter „Dach" unter „Dieses Dach sitzt über" die mit ▲ gekennzeichneten Räume abwählen — dort gehört eine Decke hin, kein Dach. Ist es Absicht (Vordach über einem Erker, Pultdach am Anbau), kann der Hinweis stehen bleiben.',
  'roof.overlap':
    'Im Reiter „Dach" die Raumzuweisung der beiden Dächer prüfen: Jeder Raum gehört unter genau eines. Welches sonst gilt, entscheidet die Reihenfolge im Dokument — reproduzierbar, aber von niemandem gewollt.',
  'roof.pitch': 'Dachneigung im Reiter „Dach" prüfen — übliche Dächer liegen zwischen 15 und 50 Grad.',
  'roof.u-value': 'U-Wert der Dachfläche im Reiter „Dach" eintragen. Ein gedämmtes Dach liegt bei 0,14 bis 0,24.',
  'roof.collar': 'Die Kehlbalkenlage muss über dem Kniestock liegen, sonst gibt es keine Schräge dazwischen.',
  'roof.wall-height': 'Kein Fehler: unter der Schräge zählt ohnehin die tatsächliche Höhe. Die Wandhöhe wirkt dort nur als Obergrenze.',
  'roof.low-room': 'Sehr niedriger Raum unter der Schräge — Kniestock und Neigung im Reiter „Dach" prüfen.',
  'roof.single-ridge':
    'Entweder im Reiter „Dach" auf Walm umstellen — das Walmdach folgt dem Umriss von selbst und bildet die Kehle über dem Innenwinkel mit —, oder den Seitenflügel als eigenes Geschoss mit eigenem Dach führen. Bleibt es beim Sattel- oder Pultdach, ist das eine bewusste Entscheidung: Wo der Grundriss einspringt, springt die Dachhaut mit, aber der zweite First und seine Kehle fehlen im Modell. Dachflächen und Volumen des Flügels sind dann eine Annahme.',
  'ventilation.unbalanced':
    'Volumenströme an den Ventilen angleichen: bei einer Zu-/Abluftanlage muss so viel hinein wie heraus.',
  'ventilation.no-supply': 'Zuluftventile in Wohn- und Schlafräumen setzen (Reiter „TGA", Gewerk Lüftung).',
  'ventilation.no-exhaust': 'Abluftventile in Bad, WC und Küche setzen (Reiter „TGA", Gewerk Lüftung).',
  'ventilation.no-recovery':
    'Wärmerückgewinnung im Reiter „Lüftung" eintragen — Geräte liegen zwischen 75 und 90 Prozent.',
  'ventilation.recovery-range': 'Wert im Reiter „Lüftung" korrigieren; über 95 Prozent erreicht kein Gerät.',
  'ventilation.room-missing-exhaust': 'Abluftventil in diesem Raum setzen oder seine Rolle im Reiter „Lüftung" ändern.',
  'ventilation.room-missing-supply': 'Zuluftventil in diesem Raum setzen oder seine Rolle im Reiter „Lüftung" ändern.',
  'ventilation.no-ahu': 'Nur ein Hinweis: das Lüftungsgerät im Plan zu setzen hilft beim Aufmaß, ist aber nicht nötig.',
  'pipes.no-source':
    'Einen Speicher, Verteiler oder Wärmeerzeuger setzen und die Leitungen daran anschließen.',
  'plant.generator-unlinked':
    'Im Reiter „Anlage" das passende Gerät aus dem Katalog wählen — danach rechnet die Anlage mit Datenblattwerten.',
  'pipes.source-outside':
    'Dort, wo die Leitung ins Haus kommt, einen Speicher oder Verteiler setzen und die Leitungen daran anschließen.',
  'pipes.unconnected':
    'Beim Verlegen auf das Symbol klicken — damit hängt es am Strang. Oder die Leitung bis an das Symbol heranziehen.',
  'pipes.idle-source': 'An dieser Quelle hängt nichts. Entweder eine Leitung anschließen oder sie entfernen.',
  'heatpump.no-reference':
    'Im Reiter „Wärmepumpe" die Grundstücksgrenze zeichnen — oder einen Immissionsort dort setzen, wo beim Nachbarn das nächste Fenster sitzt.',
  'heatpump.noise-exceeded':
    'Gerät weiter weg stellen, freier aufstellen (eine Ecke kostet 6 dB gegenüber freiem Stand) oder ein leiseres Gerät wählen. Der Kreis im Plan zeigt, ab wo es passt.',
  'heatpump.noise-tight':
    'Behörden erwarten meist 6 dB Abstand zum Richtwert, weil später weitere Geräte dazukommen. Ein bis zwei Meter mehr Abstand reichen dafür meist.',
  'heatpump.protection-zone':
    'Wärmepumpe verschieben oder die Öffnung dicht ausführen. Propan sinkt zu Boden — Lichtschacht, Kellerabgang und Bodenablauf sind die kritischen Stellen.',
  'heatpump.night-mode':
    'Den Schallleistungspegel des Nachtbetriebs aus dem Datenblatt eintragen — sonst wird mit dem lauten Wert gerechnet.',
  'heatpump.stand-height':
    'Sockel erhöhen: das Kondensat muss ablaufen können, und im Winter darf der Schnee das Gerät nicht zusetzen.',
  'heatpump.source-short':
    'Mehr Sondenmeter bohren oder die Kollektorfläche vergrößern. Die nötige Größe steht im Reiter „Wärmepumpe".',
  'heatpump.simulation-needed':
    'Kein Fehler, sondern ein Hinweis: ab dieser Größe gehört die Quelle simuliert, nicht aus der Tabelle abgelesen.',
  'heatpump.water-protection':
    'In dieser Schutzzone ist eine Erdwärmeanlage nicht zulässig. Auf Luft als Wärmequelle wechseln oder bei der unteren Wasserbehörde nachfragen.',
  'heatpump.water-protection-case':
    'Vor der Planung mit der unteren Wasserbehörde klären; als Wärmeträger kommt nur Wasser ohne Zusätze in Frage.',
  'site.well-distance':
    'Schluckbrunnen weiter weg setzen — in Fließrichtung hinter dem Förderbrunnen, damit das abgekühlte Wasser nicht zurückkommt.',
};

/** Plausibilitätsgrenzen — bewusst weit, sie sollen nur Ausreißer fangen. */
/**
 * Unter dieser Höhe ist es kein Bauteil mehr, sondern ein Versehen [m].
 * Eine 5-cm-Wand kommt aus einem verrutschten Zahlenfeld, nicht aus dem Bau.
 */
const MINDEST_BAUTEILHOEHE = 0.3; // m

const LIMITS = {
  minRoomArea: 1.0, // m²
  minRoomHeight: 2.0, // m
  maxRoomHeight: 6.0, // m
  maxExteriorU: 1.2, // W/(m²K) — darüber ist es keine Außenwand mehr
  minWindowU: 0.4,
  maxWindowU: 3.5,
  maxN50: 10,
};

export function validateModel(doc: BimDocument): ValidationReport {
  const issues: ValidationIssue[] = [];
  const add = (
    severity: ValidationIssue['severity'],
    code: string,
    message: string,
    target?: ValidationIssue['target'],
    // Ort statt Objekt: eine fehlende Wand hat keine Kennung, nur eine
    // Stelle. Ohne sie bliebe ausgerechnet der Befund unanspringbar, bei dem
    // der Anwender am wenigsten weiß, wo er suchen soll.
    position?: Vec2,
  ) => issues.push({ severity, code, message, target, position, remedy: REMEDIES[code] });

  const walls = Object.values(doc.walls);
  const openings = Object.values(doc.openings);
  const rooms = Object.values(doc.rooms);
  const fixtures = Object.values(doc.fixtures);

  // --- Topologie ----------------------------------------------------------
  for (const p of doc.diagnostics.openEnds) {
    add(
      'error',
      'topology.open-end',
      `Wandende bei ${p.x.toFixed(2)} / ${p.y.toFixed(2)} hat keinen Anschluss — der Raum dahinter wird nicht erkannt.`,
      undefined,
      p,
    );
  }

  if (walls.length > 0 && rooms.length === 0) {
    add('error', 'topology.no-rooms', 'Es sind Wände vorhanden, aber kein einziger geschlossener Raum.');
  }

  // Die zweite Topologie-Prüfung, und die wichtigere: eine Fläche, die kein
  // Raum geworden ist, obwohl jedes Wandende sauber angeschlossen ist. Das
  // offene Wandende oben findet nur den Fall, in dem eine Wand *frei* endet.
  // Fehlt dagegen ein ganzes Wandstück zwischen zwei Bauteilen, hat dort jedes
  // Ende einen Anschluss — und der Grundriss sieht geschlossen aus, während
  // der Flur dahinter zum Außenbereich zählt. Genau das bleibt sonst
  // unerklärt: kein Raum, keine Fläche, keine Meldung.
  //
  // Geprüft wird je Geschoss. Wände zweier Geschosse in einen Graphen zu
  // werfen würde Lücken erfinden, wo nur eine Decke dazwischenliegt.
  const wallsByLevel = new Map<string, typeof walls>();
  for (const wall of walls) {
    const list = wallsByLevel.get(wall.levelId);
    if (list) list.push(wall);
    else wallsByLevel.set(wall.levelId, [wall]);
  }
  for (const levelWalls of wallsByLevel.values()) {
    for (const issue of diagnoseClosure({ walls: levelWalls, nodes: doc.nodes })) {
      const target = issue.wallIds[0] ? ({ kind: 'wall', id: issue.wallIds[0] } as const) : undefined;
      switch (issue.kind) {
        case 'gap':
          // Warnung, nicht Fehler — und zwar aus einem Grund, der sich nicht
          // wegprogrammieren lässt: eine vergessene Wand und eine gewollte
          // Nische sehen in der Geometrie gleich aus. Nur der Planer weiß,
          // welches von beidem gemeint war. Ein Fehler würde den Export
          // sperren und jede Loggia zum Mangel erklären; ein Hinweis ginge
          // unter. Die Meldung nennt deshalb Ort, Maß und Folge und überlässt
          // die Entscheidung dem, der sie treffen kann.
          add('warning', 'topology.gap', issue.message, target, issue.position);
          break;
        case 'near-miss':
          add('warning', 'topology.near-miss', issue.message, target, issue.position);
          break;
        case 'off-axis':
          add('warning', 'topology.off-axis', issue.message, target, issue.position);
          break;
        case 'overlap':
          add('warning', 'topology.overlap', issue.message, target, issue.position);
          break;
        case 'open-end':
          // Deckungsgleich mit der Schleife oben, sobald `diagnostics` aktuell
          // ist. Nur wenn das Dokument ohne aufgefrischte Diagnose kommt —
          // Import, Einbettung, Prüfskript — trägt dieser Zweig sie nach.
          if (doc.diagnostics.openEnds.length === 0) {
            add('error', 'topology.open-end', issue.message, target, issue.position);
          }
          break;
      }
    }
  }

  // --- Wände --------------------------------------------------------------
  for (const wall of walls) {
    const a = doc.nodes[wall.a];
    const b = doc.nodes[wall.b];
    if (!a || !b) {
      add('error', 'wall.dangling', 'Wand verweist auf einen nicht vorhandenen Knoten.', {
        kind: 'wall',
        id: wall.id,
      });
      continue;
    }
    const length = distance(a, b);
    if (length < 0.05) {
      add('error', 'wall.degenerate', `Wand ist nur ${(length * 100).toFixed(1)} cm lang.`, {
        kind: 'wall',
        id: wall.id,
      });
    }
    /*
     * U-Wert der Wand — drei Fälle, und bis 1.23.0 sah die Prüfung nur einen.
     *
     * Die alte Meldung lautete „Wand ohne U-Wert — es wird ein Standardwert
     * angenommen." Sie war unwahr: Der Heizlastüberschlag nahm keinen
     * Standardwert an, sondern rechnete mit `?? 0`, und die Wand fiel damit
     * aus der Bilanz. Seit `uwert.ts` stimmt der Satz — deshalb darf er hier
     * stehen bleiben, und deshalb nennt er jetzt auch die Zahl: Ein Anwender,
     * der liest „es wird etwas angenommen", kann nicht beurteilen, ob die
     * Annahme für sein Haus taugt. Mit „0,24 für eine Außenwand" kann er es.
     *
     * Der zweite Fall ist neu und der gefährlichere: eine **erfasste 0**. Sie
     * ist kein fehlender Wert, also lief sie durch jede Prüfung; und sie ist
     * kein möglicher U-Wert, denn ein Bauteil ohne Wärmedurchgang gibt es
     * nicht. Genau so entstanden über `hostPatch` angelegte Bauteilaufbauten,
     * und genau so verlor das Referenzhaus ein Viertel seiner Heizlast, ohne
     * dass ein einziger Hinweis im Bericht stand. Deshalb `error` und nicht
     * `warning`: hier ist eine Angabe da und sie ist nachweislich falsch —
     * dieselbe Einstufung wie bei der Dachfläche weiter unten.
     */
    const erfassteWand = wall.uValue;
    if (erfassteWand !== undefined && !istErfasst(erfassteWand)) {
      add(
        'error',
        'wall.implausible-u-value',
        `${BAUTEIL_BEZEICHNUNG[wall.type]} mit U = ${erfassteWand} W/(m²·K) — das ist kein U-Wert. ` +
          `Gerechnet wird ersatzweise mit ${VORGABE_U[wall.type]} W/(m²·K).`,
        { kind: 'wall', id: wall.id },
      );
    } else if (uWertWand(wall, doc.constructions).herkunft === 'katalog') {
      add(
        'warning',
        'wall.missing-u-value',
        `${BAUTEIL_BEZEICHNUNG[wall.type]} ohne U-Wert — für die Heizlast wird der Vorgabewert ` +
          `${VORGABE_U[wall.type]} W/(m²·K) angesetzt.`,
        { kind: 'wall', id: wall.id },
      );
    } else if (wall.type === 'exterior' && erfassteWand !== undefined && erfassteWand > LIMITS.maxExteriorU) {
      add(
        'warning',
        'wall.implausible-u-value',
        `Außenwand mit U = ${erfassteWand} W/(m²·K) — das ist für eine Außenwand ungewöhnlich hoch.`,
        { kind: 'wall', id: wall.id },
      );
    }
    // Wandhöhe prüfen — aber eine Brüstung ist keine zu niedrige Wand.
    //
    // Bis 1.15.1 galt alles unter 2,00 m als unplausibel. Nach dem Import
    // eines Raumscans standen dadurch drei Warnungen im Bericht, die alle
    // dasselbe meinten: der Scan hat eine 1,19 m hohe Brüstung gemessen, und
    // das ist richtig so. Eine Prüfung, die dreimal danebenliegt, wird beim
    // vierten Mal nicht mehr gelesen — und die vierte ist dann die echte.
    //
    // Unterschieden werden jetzt drei Fälle:
    //   · unter der Brüstungsgrenze: ein Bauteil, das im Raum steht. In
    //     Ordnung, solange es überhaupt eine Höhe hat.
    //   · dazwischen (1,60 bis 2,00 m): zu hoch für eine Brüstung, zu niedrig
    //     für eine Wand. Genau hier lohnt das Hinsehen.
    //   · über der Obergrenze: wie bisher.
    if (wall.height < MINDEST_BAUTEILHOEHE) {
      add('warning', 'wall.implausible-height', `Wandhöhe ${wall.height.toFixed(2)} m ist zu gering für ein Bauteil.`, {
        kind: 'wall',
        id: wall.id,
      });
    } else if (wall.height >= BRUESTUNGS_HOEHE && wall.height < LIMITS.minRoomHeight) {
      add(
        'warning',
        'wall.implausible-height',
        `Wandhöhe ${wall.height.toFixed(2)} m liegt zwischen Brüstung und Wand.`,
        { kind: 'wall', id: wall.id },
      );
    } else if (wall.height > LIMITS.maxRoomHeight) {
      add('warning', 'wall.implausible-height', `Wandhöhe ${wall.height.toFixed(2)} m ist unplausibel.`, {
        kind: 'wall',
        id: wall.id,
      });
    }
  }

  // --- Öffnungen ----------------------------------------------------------
  for (const op of openings) {
    const wall = doc.walls[op.wallId];
    if (!wall) {
      add('error', 'opening.orphan', 'Öffnung ohne zugehörige Wand.', { kind: 'opening', id: op.id });
      continue;
    }
    const a = doc.nodes[wall.a];
    const b = doc.nodes[wall.b];
    const wallLength = a && b ? distance(a, b) : 0;

    if (op.width > wallLength) {
      add(
        'error',
        'opening.too-wide',
        `Öffnung ist mit ${op.width.toFixed(2)} m breiter als die ${wallLength.toFixed(2)} m lange Wand.`,
        { kind: 'opening', id: op.id },
      );
    }
    if (op.sillHeight + op.height > wall.height + 1e-6) {
      add(
        'error',
        'opening.too-tall',
        `Öffnung reicht mit ${(op.sillHeight + op.height).toFixed(2)} m über die Wandhöhe von ${wall.height.toFixed(2)} m hinaus.`,
        { kind: 'opening', id: op.id },
      );
    }
    // Dieselben drei Fälle wie bei der Wand. Der Durchgang bleibt außen vor:
    // er ist ein Loch und kein Bauteil, und `uWertOeffnung` beantwortet ihn
    // mit 0 aus dem Katalog — richtig so, nur eben keine Lücke.
    if (op.kind !== 'passage' && op.uValue !== undefined && !istErfasst(op.uValue)) {
      add(
        'error',
        'opening.implausible-u-value',
        `${labelOf(op.kind)} mit U = ${op.uValue} W/(m²·K) — das ist kein U-Wert. ` +
          `Gerechnet wird ersatzweise mit ${VORGABE_U[op.kind]} W/(m²·K).`,
        { kind: 'opening', id: op.id },
      );
    } else if (op.kind !== 'passage' && uWertOeffnung(op, doc.constructions).herkunft === 'katalog') {
      add(
        'warning',
        'opening.missing-u-value',
        `${labelOf(op.kind)} ohne U-Wert — angesetzt wird der Vorgabewert ${VORGABE_U[op.kind]} W/(m²·K).`,
        { kind: 'opening', id: op.id },
      );
    }
    if (op.kind === 'window') {
      if (op.uValue !== undefined && (op.uValue < LIMITS.minWindowU || op.uValue > LIMITS.maxWindowU)) {
        add('warning', 'opening.implausible-u-value', `Fenster mit U = ${op.uValue} W/(m²·K).`, {
          kind: 'opening',
          id: op.id,
        });
      }
      if (op.gValue === undefined) {
        add('info', 'opening.missing-g-value', 'Fenster ohne g-Wert — solare Gewinne bleiben unberücksichtigt.', {
          kind: 'opening',
          id: op.id,
        });
      }
    }
  }

  // Überlappende Öffnungen in derselben Wand
  const byWall = new Map<string, typeof openings>();
  for (const op of openings) {
    const list = byWall.get(op.wallId);
    if (list) list.push(op);
    else byWall.set(op.wallId, [op]);
  }
  for (const list of byWall.values()) {
    const sorted = [...list].sort((x, y) => x.distance - y.distance);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      if (curr.distance - prev.distance < (prev.width + curr.width) / 2 - 1e-6) {
        add('error', 'opening.overlap', 'Zwei Öffnungen überlappen sich in derselben Wand.', {
          kind: 'opening',
          id: curr.id,
        });
      }
    }
  }

  // --- Durchbrüche --------------------------------------------------------
  //
  // Vier Fragen, die vor dem Bohren zu klären sind. Sie sind bewusst nicht
  // die der Öffnungsprüfung: ein Durchbruch darf über die Wandhöhe hinaus
  // nichts, aber er darf sehr wohl dicht neben einem Fenster liegen — nur
  // nicht in einem anderen Durchbruch.
  const durchbrueche = Object.values(doc.durchbrueche ?? {});
  for (const db of durchbrueche) {
    const wand = db.wallId ? doc.walls[db.wallId] : undefined;
    if (durchbruchWirt(db.kind) === 'wand' && !wand) {
      add('error', 'durchbruch.orphan', `${db.name} ohne zugehörige Wand.`, {
        kind: 'durchbruch',
        id: db.id,
      });
      continue;
    }
    if (wand) {
      const urteil = durchbruchPasst(db, doc, wand.height);
      if (!urteil.passt) {
        add('error', 'durchbruch.does-not-fit', `${db.name}: ${urteil.grund}`, {
          kind: 'durchbruch',
          id: db.id,
        });
      }
      const a = doc.nodes[wand.a];
      const b = doc.nodes[wand.b];
      const wandLaenge = a && b ? distance(a, b) : 0;
      const breite = db.form === 'rund' ? (db.diameter ?? 0) : (db.width ?? 0);
      if (wandLaenge > 0 && breite > wandLaenge / 4) {
        add(
          'warning',
          'durchbruch.oversize',
          `${db.name} nimmt mit ${breite.toFixed(2)} m mehr als ein Viertel der ${wandLaenge.toFixed(2)} m langen Wand ein.`,
          { kind: 'durchbruch', id: db.id },
        );
      }
    }
  }

  // Überschneidung: nur innerhalb derselben Wand, und nur, wenn sich die
  // Felder sowohl waagerecht als auch senkrecht überlagern. Zwei Bohrungen
  // übereinander in derselben Achse sind erlaubt und üblich — Vorlauf oben,
  // Rücklauf unten.
  const durchbruchNachWand = new Map<string, typeof durchbrueche>();
  for (const db of durchbrueche) {
    if (!db.wallId) continue;
    const liste = durchbruchNachWand.get(db.wallId);
    if (liste) liste.push(db);
    else durchbruchNachWand.set(db.wallId, [db]);
  }
  for (const liste of durchbruchNachWand.values()) {
    for (let i = 0; i < liste.length; i++) {
      for (let j = i + 1; j < liste.length; j++) {
        if (ueberschneidet(liste[i], liste[j])) {
          add('error', 'durchbruch.overlap', 'Zwei Durchbrüche überschneiden sich in derselben Wand.', {
            kind: 'durchbruch',
            id: liste[j].id,
          });
        }
      }
    }
  }

  // --- Räume --------------------------------------------------------------
  for (const room of rooms) {
    if (room.area < LIMITS.minRoomArea) {
      add('warning', 'room.tiny', `Raum „${room.name}" hat nur ${room.area.toFixed(2)} m².`, {
        kind: 'room',
        id: room.id,
      });
    }
    if (room.usage === 'other') {
      add(
        'info',
        'room.missing-usage',
        `Raum „${room.name}" hat keine Nutzung — Solltemperatur und Luftwechsel sind Standardwerte.`,
        { kind: 'room', id: room.id },
      );
    }
    if (room.height < LIMITS.minRoomHeight || room.height > LIMITS.maxRoomHeight) {
      add('warning', 'room.implausible-height', `Raumhöhe ${room.height.toFixed(2)} m ist unplausibel.`, {
        kind: 'room',
        id: room.id,
      });
    }
    if (room.isHeated && room.exposedFacadeCount === 0) {
      add(
        'info',
        'room.no-exterior',
        `Raum „${room.name}" grenzt an keine Außenwand — Transmission nur über Nachbarbauteile.`,
        { kind: 'room', id: room.id },
      );
    }
    // Innenwände ohne erkannten Nachbarraum sind der häufigste stille Fehler:
    // sie werden als „unbeheizt" gerechnet, obwohl dahinter ein Zimmer liegt.
    const orphanInterior = room.boundaries.filter(
      (b) => b.boundary === 'unheated' && !b.neighbourRoomId && !doc.walls[b.wallId]?.boundary,
    ).length;
    if (orphanInterior > 0) {
      add(
        'warning',
        'room.unresolved-neighbour',
        `Raum „${room.name}": ${orphanInterior} Innenwand-Abschnitt(e) ohne erkannten Nachbarraum — sie werden als unbeheizt gerechnet.`,
        { kind: 'room', id: room.id },
      );
    }
  }

  // --- TGA ----------------------------------------------------------------
  for (const f of fixtures) {
    if (!f.roomId) {
      add('warning', 'fixture.no-room', `${f.label ?? f.type} liegt in keinem erkannten Raum.`, {
        kind: 'fixture',
        id: f.id,
      });
    }
    // Nur Wärmeübergeber brauchen eine Leistung. Ein Verteiler, ein
    // Steigstrang oder ein Thermostat hat keine — sie hier anzumahnen wäre
    // ein Befund, den niemand abstellen kann.
    if (HEAT_EMITTERS.has(f.type) && !f.params.powerW) {
      add('info', 'fixture.missing-power', `${f.label ?? f.type} ohne Leistungsangabe.`, {
        kind: 'fixture',
        id: f.id,
      });
    }
    if (f.category === 'ventilation' && !f.params.airflow) {
      add('info', 'fixture.missing-airflow', `${f.label ?? f.type} ohne Volumenstrom.`, {
        kind: 'fixture',
        id: f.id,
      });
    }
  }

  // --- Projektparameter ---------------------------------------------------
  const meta = doc.meta;
  if (meta.designOutdoorTemperature > 0) {
    add(
      'warning',
      'project.outdoor-temperature',
      `Norm-Außentemperatur ${meta.designOutdoorTemperature} °C — in Deutschland liegt sie zwischen −10 und −16 °C.`,
    );
  }
  if (meta.n50 <= 0 || meta.n50 > LIMITS.maxN50) {
    add('warning', 'project.n50', `n50 = ${meta.n50} 1/h ist unplausibel.`);
  }
  /*
   * Boden und Decke der Geschosse.
   *
   * Geprüft wurde bisher `floorUValue === undefined`. Der Typ sagt aber, dass
   * das Feld eine Zahl **ist** — die Bedingung konnte also praktisch nie
   * greifen, während der Fall, der wirklich vorkommt, durchlief: eine 0. Ein
   * frisch angelegtes Geschoss trägt sie, und sie macht die Bodenplatte
   * verlustfrei. Für Boden und Decke gibt es anders als bei Wänden **keinen**
   * Vorgabewert nach Bauteilart (Begründung in `uwert.ts`), die Fläche fällt
   * also tatsächlich mit 0 W aus der Bilanz. Deshalb wird hier auch die Decke
   * mitgeprüft und beides namentlich benannt — „mindestens ein Geschoss"
   * schickt den Leser suchen.
   */
  for (const level of Object.values(doc.levels)) {
    const ohneBoden = !istErfasst(level.floorUValue) && !level.floorConstructionId;
    const ohneDecke = !istErfasst(level.ceilingUValue) && !level.ceilingConstructionId;
    if (!ohneBoden && !ohneDecke) continue;
    const fehlend = ohneBoden && ohneDecke ? 'Boden und Decke' : ohneBoden ? 'der Boden' : 'die Decke';
    add(
      'warning',
      'level.missing-floor-u',
      `Im Geschoss ${level.name} trägt ${fehlend} keinen U-Wert — die Fläche geht mit 0 W in die Heizlast ein.`,
    );
  }

  // --- Geländeoberkante und erdberührte Bauteile ---------------------------
  // Der Keller ist der Ort, an dem ein Modell am leisesten falsch wird: die
  // Wände sind gezeichnet, die Räume werden erkannt, die Zahlen sehen
  // plausibel aus — und trotzdem rechnet alles gegen Außenluft, weil niemand
  // gesagt hat, wo das Gelände liegt. Diese vier Regeln greifen genau die
  // Fälle ab, in denen die Geometrie und die Höhenangaben einander
  // widersprechen.
  const terrain = meta.terrainElevation;
  const levelsSorted = Object.values(doc.levels).sort((a, b) => a.order - b.order);

  for (const level of levelsSorted) {
    const levelWalls = walls.filter((w) => w.levelId === level.id);
    const buriedWalls = levelWalls.filter(
      (w) => gradeSplit(level.elevation, w.height, terrain).buriedHeight > 0.01,
    );

    // (1) Ein Geschoss unter dem Bezugsniveau, an dem nichts im Erdreich
    // steckt. Ohne Geländeoberkante ist das der Regelfall — und ohne sie ist
    // der Keller rechnerisch ein Obergeschoss mit −12 °C davor.
    if (level.elevation < -0.01 && levelWalls.length > 0 && buriedWalls.length === 0) {
      add(
        'warning',
        'level.below-grade-no-ground',
        terrain === undefined
          ? `${level.name} liegt bei ${level.elevation.toFixed(2)} m und damit unter dem Bezugsniveau, aber im Projekt ist keine Geländeoberkante erfasst. Alle Wände dieses Geschosses werden gegen Außenluft gerechnet.`
          : `${level.name} liegt bei ${level.elevation.toFixed(2)} m, die Geländeoberkante bei ${terrain.toFixed(2)} m — keine einzige Wand dieses Geschosses berührt damit Erdreich.`,
      );
    }

    // (2) Das Gelände steht über der Decke dieses Geschosses. Am Hang gibt es
    // das; viel häufiger ist es ein Vorzeichenfehler bei der Fußbodenhöhe.
    if (terrain !== undefined && level.height > 0) {
      const embedment = terrain - level.elevation;
      if (embedment > level.height + 0.01) {
        add(
          'warning',
          'level.embedment-exceeds-height',
          `Einbindetiefe von ${level.name} ist ${embedment.toFixed(2)} m und damit größer als die Geschosshöhe (${level.height.toFixed(2)} m).`,
        );
      }
    }

    // (3) Unbeheizter Keller unter beheiztem Geschoss. Die wärmedämmende
    // Schicht liegt dann in der Kellerdecke, nicht mehr in der Bodenplatte —
    // steht das nicht im Modell, wandert der Verlust an die falsche Stelle
    // und der unbeheizte Keller erscheint als beheizter Wohnraum.
    const levelRooms = rooms.filter((r) => r.levelId === level.id);
    const above = levelsSorted[levelsSorted.indexOf(level) + 1];
    const heatedAbove = above ? rooms.some((r) => r.levelId === above.id && r.isHeated) : false;
    const isBelowGrade = buriedWalls.length > 0 || level.elevation < -0.01;
    if (isBelowGrade && levelRooms.length > 0 && !levelRooms.some((r) => r.isHeated) && heatedAbove && above) {
      const kellerdecke = level.ceilingBoundary === 'adjacent-room';
      const bodenDarueber = above.floorBoundary === 'ground';
      if (!kellerdecke || bodenDarueber) {
        add(
          'warning',
          'level.unheated-basement-ceiling',
          `${level.name} ist unbeheizt und liegt unter dem beheizten ${above.name}, aber die Kellerdecke ist nicht als Bauteil zwischen beiden geführt${bodenDarueber ? ` — der Boden von ${above.name} grenzt weiterhin an Erdreich` : ''}.`,
        );
      }
    }
  }

  // (4) Fenster, dessen Unterkante unter Gelände liegt. Zulässig — dafür gibt
  // es Lichtschächte —, aber es muss eine Entscheidung sein und kein Rest aus
  // einem kopierten Regelgeschoss.
  if (terrain !== undefined) {
    for (const op of openings) {
      if (op.kind !== 'window') continue;
      const wall = doc.walls[op.wallId];
      const level = wall ? doc.levels[wall.levelId] : undefined;
      if (!wall || !level) continue;
      const sill = level.elevation + (op.sillHeight ?? 0);
      if (sill < terrain - 0.01) {
        add(
          'info',
          'opening.below-grade',
          `Fensterbrüstung liegt ${(terrain - sill).toFixed(2)} m unter Gelände — das setzt einen Lichtschacht voraus.`,
          { kind: 'opening', id: op.id },
        );
      }
    }
  }

  // --- Wärmebrücken ---------------------------------------------------------
  const bridgeMethod = meta.thermalBridgeMethod ?? 'flat';
  if (bridgeMethod === 'flat' && meta.thermalBridgeSupplement <= 0) {
    add(
      'warning',
      'project.thermal-bridges-ignored',
      'Der pauschale Wärmebrückenzuschlag ist 0 — damit bleiben die Anschlüsse unberücksichtigt. Ohne Nachweis sind 0,10 W/(m²·K) anzusetzen.',
    );
  }
  if (bridgeMethod === 'detailed') {
    const detailed = documentBridgeHeatLoss(doc);
    const area = envelopeArea(doc);
    if (rooms.length > 0 && Math.abs(detailed) < 0.01) {
      add(
        'warning',
        'project.thermal-bridges-empty',
        'Längenbezogene Wärmebrücken gewählt, aber es wurde kein einziger Anschluss gefunden — dann fehlt der Zuschlag ganz.',
      );
    } else if (area > 1 && detailed / area < 0.02) {
      // Unter 0,02 W/(m²·K) liegt die Bilanz besser als Kategorie B. Möglich,
      // aber bei einem ψ-Katalog aus Vorgabewerten unwahrscheinlich genug,
      // um nachzufragen.
      add(
        'info',
        'project.thermal-bridges-low',
        `Die Wärmebrückenbilanz entspricht ΔU_WB = ${(detailed / area).toFixed(3)} W/(m²·K) und liegt damit unter Kategorie B — bitte die ψ-Werte gegenprüfen.`,
      );
    }
  }

  // --- Lüftung --------------------------------------------------------------
  const system = meta.ventilation;
  if (system && system.kind !== 'none') {
    const flow = (type: string, roomId?: string) =>
      fixtures
        .filter((f) => f.type === type && (!roomId || f.roomId === roomId))
        .reduce((sum, f) => sum + (f.params.airflow ?? 0), 0);

    const supply = flow('air-supply');
    const exhaust = flow('air-exhaust');

    if (system.kind === 'balanced') {
      if (system.heatRecovery <= 0) {
        add(
          'warning',
          'ventilation.no-recovery',
          'Zu-/Abluftanlage ohne Wärmerückgewinnung: der volle Zuluftstrom geht mit Außentemperatur in die Rechnung. Ist das gewollt?',
        );
      } else if (system.heatRecovery > 0.95) {
        add(
          'error',
          'ventilation.recovery-range',
          `Wärmerückgewinnungsgrad ${(system.heatRecovery * 100).toFixed(0)} % ist nicht erreichbar — Geräte liegen bei 70 bis 90 %.`,
        );
      }

      // Eine Zu-/Abluftanlage ist per Definition ausgeglichen. Klafft die
      // Bilanz, strömt die Differenz durch die Hülle — ungeplant, ungewärmt
      // und in keiner Rechnung.
      const gap = supply - exhaust;
      if (supply + exhaust > 0 && Math.abs(gap) > 0.1 * Math.max(supply, exhaust)) {
        add(
          'warning',
          'ventilation.unbalanced',
          `Luftbilanz klafft um ${Math.round(gap)} m³/h (${Math.round(supply)} Zuluft gegen ${Math.round(exhaust)} Abluft). Die Differenz geht durch die Gebäudehülle.`,
        );
      }
      if (supply <= 0) {
        add('warning', 'ventilation.no-supply', 'Zu-/Abluftanlage, aber kein einziges Zuluftventil gesetzt.');
      }
    }

    if (exhaust <= 0) {
      add('warning', 'ventilation.no-exhaust', 'Lüftungsanlage ohne Abluftventile — die Ablufträume bleiben unversorgt.');
    }
    if (!fixtures.some((f) => f.type === 'ahu')) {
      add('info', 'ventilation.no-ahu', 'Kein Lüftungsgerät im Plan platziert; die Anlage steht nur als Projektangabe da.');
    }

    for (const room of rooms) {
      const role = room.ventilationRole ?? 'none';
      if (role === 'exhaust' && flow('air-exhaust', room.id) <= 0) {
        add(
          'warning',
          'ventilation.room-missing-exhaust',
          `${room.name} ist als Abluftraum geführt, hat aber kein Abluftventil.`,
          { kind: 'room', id: room.id },
        );
      }
      if (role === 'supply' && system.kind === 'balanced' && flow('air-supply', room.id) <= 0) {
        add(
          'warning',
          'ventilation.room-missing-supply',
          `${room.name} ist als Zuluftraum geführt, hat aber kein Zuluftventil.`,
          { kind: 'room', id: room.id },
        );
      }
    }
  }

  // --- Rohrnetz -------------------------------------------------------------
  // Nur prüfen, wenn überhaupt Leitungen gezeichnet wurden — wer das Netz
  // gar nicht erfasst, soll nicht mit Befunden darüber behelligt werden.
  if (Object.keys(doc.pipes ?? {}).length > 0) {
    const network = buildPipeNetwork(doc);
    /*
     * Ein fehlender Anschlusspunkt ist nicht dasselbe wie ein fehlender
     * Erzeuger.
     *
     * Bei einer Wärmepumpe steht der Erzeuger im Außenbereich und ist im
     * Grundriss gar kein Objekt, sondern Teil der Außenanlage. Wer sie
     * erfasst hat und trotzdem liest, es gebe keinen Erzeuger, bekommt
     * einen Befund, der nicht stimmt — und lernt dabei, die Prüfliste
     * nicht ernst zu nehmen. Darum wird hier getrennt: gibt es überhaupt
     * keinen Erzeuger, ist das eine Warnung; steht er draußen und fehlt
     * nur der Punkt, an dem die Leitung ins Haus kommt, ist es ein
     * Hinweis mit genau dieser Auskunft.
     */
    if (!network.sources.length) {
      const pumpen = Object.keys(doc.site?.pumps ?? {}).length;
      if (pumpen > 0) {
        add(
          'info',
          'pipes.source-outside',
          `Die Wärmepumpe steht in der Außenanlage, im Grundriss fehlt aber der Punkt, an dem die Leitung ins Haus kommt — ohne ihn lässt sich kein Strang zuordnen.`,
        );
      } else {
        add(
          'warning',
          'pipes.no-source',
          'Es sind Leitungen verlegt, aber kein Speicher, kein Verteiler und kein Erzeuger — ohne Quelle lässt sich kein Strang zuordnen.',
        );
      }
    }
    // Nur dort mahnen, wo überhaupt ein Netz dieses Gewerks gezeichnet
    // wurde. Wer die Heizung verlegt, die Lüftungskanäle aber bewusst
    // weglässt — sie tragen zur Heizlast nichts bei —, soll dafür nicht
    // vier Befunde bekommen.
    const drawnCategories = new Set(
      Object.values(doc.pipes ?? {}).map((r) => SERVICE_CATEGORY[r.service]),
    );
    for (const miss of network.unconnected) {
      const category = doc.fixtures[miss.fixtureId]?.category;
      if (category && !drawnCategories.has(category)) continue;
      add(
        'warning',
        'pipes.unconnected',
        `${miss.label} hängt an keinem Strang (${miss.reason}).`,
        { kind: 'fixture', id: miss.fixtureId },
      );
    }
    const idle = network.sources.filter((s) => s.consumers === 0);
    for (const s of idle) {
      add('info', 'pipes.idle-source', `${s.label} versorgt keinen einzigen Verbraucher.`, {
        kind: 'fixture',
        id: s.fixtureId,
      });
    }
  }

  // --- Wärmepumpe und Außenanlage -------------------------------------------
  const site = doc.site;
  const pumps = Object.values(site?.pumps ?? {});
  const siteElements = Object.values(site?.elements ?? {});

  if (pumps.length) {
    const hasBoundary = siteElements.some((e) => e.kind === 'boundary');
    if (!hasBoundary && !siteElements.some((e) => e.kind === 'immission-point')) {
      add(
        'warning',
        'heatpump.no-reference',
        'Für die Wärmepumpe gibt es weder eine Grundstücksgrenze noch einen Immissionsort — der Schallnachweis lässt sich damit nicht führen.',
      );
    }

    for (const pump of pumps) {
      if (pump.form === 'indoor') continue;
      const report = acousticReport(doc, pump);

      for (const point of report.points) {
        if (point.verdict === 'exceeded') {
          add(
            'error',
            'heatpump.noise-exceeded',
            `${pump.label}: am Immissionsort „${point.label}" werden nachts ${point.level.toFixed(1)} dB(A) erreicht, zulässig sind ${point.limit}. Nötig wären ${report.limitDistance.toFixed(1)} m Abstand.`,
            { kind: 'heatpump', id: pump.id },
          );
        } else if (point.verdict === 'tight') {
          add(
            'warning',
            'heatpump.noise-tight',
            `${pump.label}: der Richtwert ist am Immissionsort „${point.label}" eingehalten, aber ohne die üblichen 6 dB Reserve (${point.level.toFixed(1)} von ${point.limit} dB(A)).`,
            { kind: 'heatpump', id: pump.id },
          );
        }
      }

      for (const issue of protectionIssues(doc, pump)) {
        add(
          'error',
          'heatpump.protection-zone',
          `${pump.label}: ${issue.label} liegt mit ${issue.distance.toFixed(2)} m im Schutzbereich (${issue.required.toFixed(2)} m) des brennbaren Kältemittels.`,
          { kind: 'heatpump', id: pump.id },
        );
      }

      if (pump.nightModeGuaranteed && pump.soundPowerNight === undefined) {
        add(
          'warning',
          'heatpump.night-mode',
          `${pump.label}: Nachtabsenkung ist angehakt, aber kein Schallleistungspegel dafür eingetragen.`,
          { kind: 'heatpump', id: pump.id },
        );
      }
      if (pump.standHeight < 0.1) {
        add(
          'info',
          'heatpump.stand-height',
          `${pump.label} steht weniger als 10 cm über Gelände — Kondensat und Schnee brauchen Luft darunter.`,
          { kind: 'heatpump', id: pump.id },
        );
      }

      const demand = sourceDemand(doc, pump);
      if (demand && !demand.sufficient) {
        add(
          'warning',
          'heatpump.source-short',
          `${pump.label}: die gezeichnete Wärmequelle deckt den Bedarf noch nicht (${demand.extraction.toFixed(1)} kW Entzugsleistung).`,
          { kind: 'heatpump', id: pump.id },
        );
      }
      if (demand && !demand.tableApplicable) {
        add(
          'info',
          'heatpump.simulation-needed',
          `${pump.label}: über 30 kW oder mehr als fünf Sonden reicht die Tabellenauslegung nach VDI 4640 nicht mehr — die Quelle ist zu simulieren.`,
          { kind: 'heatpump', id: pump.id },
        );
      }
      const water = waterProtectionVerdict(site.waterProtection, pump.source);
      if (water?.allowed === 'nein') {
        add('error', 'heatpump.water-protection', `${pump.label}: ${water.note}`, {
          kind: 'heatpump',
          id: pump.id,
        });
      } else if (water?.allowed === 'einzelfall') {
        add('warning', 'heatpump.water-protection-case', `${pump.label}: ${water.note}`, {
          kind: 'heatpump',
          id: pump.id,
        });
      }
    }
  }

  // Ein Brunnenpaar in der falschen Reihenfolge kühlt sich selbst aus.
  const supply = siteElements.find((e) => e.kind === 'well-supply');
  const injection = siteElements.find((e) => e.kind === 'well-injection');
  if (supply?.points[0] && injection?.points[0]) {
    const distance = Math.hypot(
      supply.points[0].x - injection.points[0].x,
      supply.points[0].y - injection.points[0].y,
    );
    if (distance < 15) {
      add(
        'warning',
        'site.well-distance',
        `Förder- und Schluckbrunnen liegen nur ${distance.toFixed(1)} m auseinander — üblich sind mindestens 15 m in Grundwasserfließrichtung, sonst kühlt sich die Quelle selbst aus.`,
        { kind: 'site', id: injection.id },
      );
    }
  }

  // --- Anlagentechnik -------------------------------------------------------
  //
  // Geprüft wird nur, was ohne Auslegungsrechnung erkennbar ist: fehlende
  // Angaben und Widersprüche im Anlagenblatt. Die eigentliche Auslegung mit
  // ihren Hinweisen steht im Reiter „Anlage" — sie hier zu wiederholen hieße,
  // dieselbe Rechnung zweimal zu führen und zweimal zu pflegen.
  {
    const plant = doc.plant;
    if (plant) {
      const storages = Object.values(plant.storages);
      const circuits = Object.values(plant.circuits);
      const schematic = Object.keys(plant.schematic.components).length;

      if (plant.generatorModelId || storages.length || circuits.length || schematic) {
        /*
         * „Kein Wärmeerzeuger" stimmt nur, wenn wirklich keiner erfasst ist.
         *
         * Wer die Wärmepumpe in der Außenanlage aufgenommen hat, hat einen
         * Erzeuger — ihm fehlt nur die Verbindung zum Gerätekatalog, aus
         * dem Druckverlust, Mindestvolumen und Gefäßgröße kommen. Das ist
         * ein Hinweis auf eine offene Zuordnung, keine Meldung über ein
         * fehlendes Gerät.
         */
        if (!plant.generatorModelId) {
          const pumpen = Object.values(doc.site?.pumps ?? {});
          if (pumpen.length > 0) {
            add(
              'info',
              'plant.generator-unlinked',
              `${pumpen.length === 1 ? `Die Wärmepumpe „${pumpen[0].label}" ist` : `${pumpen.length} Wärmepumpen sind`} in der Außenanlage erfasst, aber keinem Gerät aus dem Katalog zugeordnet. Bis dahin rechnen Puffer, Rohrnetz und Sicherheitstechnik mit Annahmen statt mit Datenblattwerten.`,
            );
          } else {
            add(
              'warning',
              'plant.no-generator',
              'Es ist eine Anlage geplant, aber kein Wärmeerzeuger gewählt. Ohne Gerät sind Puffer, Rohrnetz und Sicherheitstechnik nicht belastbar.',
            );
          }
        }
        if (plant.heatLoadOverride === undefined) {
          add(
            'info',
            'plant.estimated-load',
            'Die Anlage ist auf der überschlägigen Heizlast ausgelegt. Sobald die Norm-Heizlast vorliegt, gehört sie ins Anlagenblatt — sie ändert Gerät, Puffer und Gefäß gleichzeitig.',
          );
        }
        if (plant.design.returnTemperature >= plant.design.flowTemperature) {
          add(
            'error',
            'plant.spread',
            `Vorlauf ${plant.design.flowTemperature} °C und Rücklauf ${plant.design.returnTemperature} °C ergeben keine Spreizung. Ohne Temperaturdifferenz ist der Volumenstrom rechnerisch unendlich.`,
          );
        }
        if (plant.design.dhwTemperature > 60 && plant.dhw.units <= 2) {
          add(
            'info',
            'plant.dhw-temperature',
            `${plant.design.dhwTemperature} °C Speichertemperatur. In einer Kleinanlage schreibt DVGW W 551 keine feste Temperatur vor; jedes Grad kostet rund 2,5 % Arbeitszahl.`,
          );
        }
        if (plant.safety.staticHeight * 0.1 + 0.2 >= plant.safety.safetyValvePressure - 0.5) {
          add(
            'error',
            'plant.static-height',
            `Bei ${plant.safety.staticHeight.toFixed(1)} m statischer Höhe bleibt zwischen Vordruck und Enddruck kein Raum für das Ausdehnungsvolumen. Ansprechdruck erhöhen oder das Gefäß tiefer setzen.`,
          );
        }
        if (plant.design.glycolFraction > 0 && plant.design.glycolFraction < 20) {
          add(
            'warning',
            'plant.glycol-low',
            `${plant.design.glycolFraction} Vol-% Frostschutz sind zu wenig für einen sicheren Frostschutz und schon genug, um Wärmekapazität und Pumpenleistung zu verschlechtern. Entweder richtig dosieren oder weglassen.`,
          );
        }
        if (schematic > 0 && !plant.schematic.manual) {
          const known = new Set(Object.keys(plant.schematic.components));
          const dangling = Object.values(plant.schematic.links).filter(
            (l) => !known.has(l.from) || !known.has(l.to),
          ).length;
          if (dangling > 0) {
            add(
              'warning',
              'plant.schematic-dangling',
              `${dangling} Verbindungen im Anlagenschema hängen an gelöschten Bauteilen. Das Schema neu erzeugen bereinigt das.`,
            );
          }
        }
      }
    }
  }

  // --- Absenkbetrieb --------------------------------------------------------
  if (meta.setback?.active) {
    if (meta.setback.hours <= 0) {
      add('warning', 'project.setback-hours', 'Absenkbetrieb ist aktiv, die Absenkzeit steht aber auf 0 h.');
    }
    if ((meta.reheatFactor ?? 0) <= 0) {
      add(
        'info',
        'project.reheat-factor',
        'Absenkbetrieb ohne Wiederaufheizfaktor: es wird keine Zusatz-Aufheizleistung angesetzt. In Deutschland ist f_RH national auf 0 gesetzt — die Angabe ist also zulässig, aber eine bewusste.',
      );
    }
  }

  // --- Dach -----------------------------------------------------------------
  /*
   * **Die Regel, die keine Geometrie kennt.**
   *
   * Wo ein Geschoss darüberliegt, ist kein Dach, sondern eine Decke. Aus dem
   * Grundriss allein folgt das nicht — er weiß nichts über das Geschoss
   * darüber. Verboten wird es trotzdem nicht: Ein Vordach über einem Erker,
   * ein Pultdach über einem Anbau, der an das Obergeschoss stößt, sind
   * zulässige Fälle. Gemeldet wird es, damit niemand aus Versehen ein
   * Geschoss überdacht, das bewohnt ist — dort fiele die Heizlast des
   * darüberliegenden Raums gegen Außenluft statt gegen einen beheizten
   * Nachbarn aus.
   */
  {
    const geschosse = Object.values(doc.levels).sort((a, b) => a.order - b.order);
    for (let i = 0; i < geschosse.length; i++) {
      const level = geschosse[i];
      const oben = geschosse[i + 1];
      if (!oben) continue;
      const hier = rooms.filter((r) => r.levelId === level.id);
      const raeumeOben = rooms.filter((r) => r.levelId === oben.id);
      const ohne = new Set(raeumeOhneGeschossDarueber(hier, raeumeOben));
      for (const dach of daecherVon(level)) {
        if (dach.kind === 'flat') continue;
        const falsch = (dach.roomIds ?? []).filter((id) => !ohne.has(id) && hier.some((r) => r.id === id));
        if (!falsch.length) continue;
        const namen = falsch
          .map((id) => hier.find((r) => r.id === id)?.name ?? id)
          .slice(0, 4)
          .join(', ');
        add(
          'warning',
          'roof.above-storey',
          `„${dach.name ?? 'Dach'}" über ${level.name} deckt ${falsch.length} ${falsch.length === 1 ? 'Raum' : 'Räume'}, über ${falsch.length === 1 ? 'dem' : 'denen'} ${oben.name} liegt (${namen}).`,
        );
      }
    }
  }

  /*
   * **Zwei Dächer über demselben Raum.** Welches gilt, entscheidet dann die
   * Reihenfolge im Dokument — eine Antwort, die reproduzierbar ist und
   * trotzdem niemand gewollt hat. Raumhöhe, Volumen und Dachfläche hängen
   * daran.
   */
  for (const level of Object.values(doc.levels)) {
    const belegt = new Map<string, string>();
    for (const dach of daecherVon(level)) {
      for (const id of dach.roomIds ?? []) {
        const schon = belegt.get(id);
        if (schon) {
          const raum = rooms.find((r) => r.id === id);
          add(
            'warning',
            'roof.overlap',
            `„${raum?.name ?? id}" liegt unter zwei Dächern („${schon}" und „${dach.name ?? 'Dach'}").`,
          );
        } else {
          belegt.set(id, dach.name ?? 'Dach');
        }
      }
    }
  }

  for (const level of Object.values(doc.levels)) {
    const roof = daecherVon(level)[0];
    if (!roof || roof.kind === 'flat') continue;

    if (roof.pitch < 5 || roof.pitch > 70) {
      add('warning', 'roof.pitch', `Dachneigung ${roof.pitch}° über ${level.name} ist unüblich (5–70°).`);
    }
    if (roof.uValue <= 0 || roof.uValue > 3) {
      add('error', 'roof.u-value', `U-Wert der Dachfläche über ${level.name} ist unplausibel (${roof.uValue}).`);
    }
    if (typeof roof.collarHeight === 'number' && roof.collarHeight <= roof.kneeHeight) {
      add(
        'error',
        'roof.collar',
        `Kehlbalken über ${level.name} liegt bei ${roof.collarHeight.toFixed(2)} m und damit nicht über dem Kniestock (${roof.kneeHeight.toFixed(2)} m).`,
      );
    }

    // Der praktisch wichtigste Hinweis: Wandhöhe und Kniestock passen nicht
    // zusammen. Dann steht im Modell eine Wand, die es so nicht gibt.
    const levelWalls = Object.values(doc.walls).filter((w) => w.levelId === level.id);

    /*
     * Eine Firstlinie über einem Grundriss, der keine ist.
     *
     * Sattel- und Pultdach haben je *eine* gerade Firstlinie — das ist ihre
     * Definition. Über einem Rechteck reicht das. Über einem L nicht: Der
     * Seitenflügel bekäme am Bau einen eigenen First und dazwischen eine
     * Kehle, und welcher First das ist, folgt aus keiner Firstrichtung,
     * sondern aus einer Planungsentscheidung. Das Programm trifft sie nicht
     * heimlich — es rechnet die Traufe dem Umriss nach und sagt hier, was
     * dabei offen bleibt.
     *
     * Erkannt wird über beides zugleich: mehr als vier Umrisspunkte **und**
     * eine Umrissfläche deutlich unter der ihrer Bounding Box. Die
     * Punktzahl allein schlüge bei jeder harmlosen Nische an, das
     * Flächenverhältnis allein bei jedem gedrehten Rechteck — dessen Umriss
     * hat vier Punkte und trotzdem nur einen Bruchteil der achsparallelen
     * Bounding Box.
     */
    // Krüppelwalm und Mansarde haben wie das Satteldach eine *gerade*
    // Firstlinie, das Flachdach mit Gefälle wie das Pultdach eine gerade
    // Traufe — für alle gilt derselbe Hinweis über einem verwinkelten
    // Grundriss. Nur das Walmdach rechnet auf dem Umriss und braucht ihn nicht.
    if (
      roof.kind === 'gable' ||
      roof.kind === 'monopitch' ||
      roof.kind === 'krueppelwalm' ||
      roof.kind === 'mansard' ||
      roof.kind === 'flat-sloped'
    ) {
      const umriss = gebaeudeUmriss(levelWalls, doc.nodes);
      if (umriss.length > 4) {
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const p of umriss) {
          if (p.x < minX) minX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.x > maxX) maxX = p.x;
          if (p.y > maxY) maxY = p.y;
        }
        const kasten = (maxX - minX) * (maxY - minY);
        const flaeche = Math.abs(
          umriss.reduce((sum, p, i) => {
            const q = umriss[(i + 1) % umriss.length];
            return sum + p.x * q.y - q.x * p.y;
          }, 0) / 2,
        );
        const anteil = kasten > 0 ? flaeche / kasten : 1;
        if (anteil < 0.98) {
          add(
            'warning',
            'roof.single-ridge',
            `${roof.kind === 'gable' ? 'Satteldach' : 'Pultdach'} über ${level.name}: Der Gebäudeumriss hat ${umriss.length} Ecken und füllt nur ${Math.round(anteil * 100)} % seines umschließenden Rechtecks. Eine einzelne Firstlinie deckt einen solchen Grundriss nicht ab — der Seitenflügel bräuchte einen eigenen First und eine Kehle.`,
          );
        }
      }
    }
    const tooTall = levelWalls.filter((w) => w.height > roof.kneeHeight + 0.3).length;
    if (tooTall > 0 && levelWalls.length > 0) {
      add(
        'info',
        'roof.wall-height',
        `${tooTall} Wände über ${level.name} sind höher als der Kniestock (${roof.kneeHeight.toFixed(2)} m). Unter der Schräge wird die Wandfläche integriert — die eingetragene Wandhöhe wirkt dort nur noch als Obergrenze.`,
      );
    }

    const roofRooms = Object.values(doc.rooms).filter((r) => r.levelId === level.id && r.roof);
    const cramped = roofRooms.filter((r) => r.roof && r.roof.livingArea < r.area * 0.5);
    for (const r of cramped) {
      add(
        'info',
        'roof.low-room',
        `${r.name}: nach WoFlV zählen nur ${r.roof!.livingArea.toFixed(2)} von ${r.area.toFixed(2)} m² — der Raum liegt überwiegend unter 2,00 m.`,
        { kind: 'room', id: r.id },
      );
    }
  }

  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length;
  const infos = issues.filter((i) => i.severity === 'info').length;

  return { errors, warnings, infos, ready: errors === 0 && rooms.length > 0, issues };
}

const labelOf = (kind: string): string =>
  kind === 'door' ? 'Tür' : kind === 'window' ? 'Fenster' : 'Durchgang';

/**
 * Überschneiden sich zwei Durchbrüche in derselben Wand?
 *
 * Geprüft wird in der Wandebene: waagerecht über den Abstand auf der Achse,
 * senkrecht über Unterkante und Höhe. Nur wenn sich **beide** Bereiche
 * überlagern, ist es eine Überschneidung — sonst liegen die Löcher neben- oder
 * übereinander, und das ist der Regelfall.
 *
 * Runde Bohrungen werden dabei als ihr umschreibendes Quadrat behandelt. Das
 * ist die vorsichtigere Antwort: zwei Kreise, deren Quadrate sich um wenige
 * Millimeter überlagern, stehen so eng, dass der Steg zwischen ihnen beim
 * Bohren ausbricht. Wer es genauer will, misst auf der Baustelle nach.
 */
function ueberschneidet(
  a: { distance?: number; sillHeight?: number; form: string; diameter?: number; width?: number; height?: number },
  b: typeof a,
): boolean {
  const feld = (d: typeof a) => {
    const breite = d.form === 'rund' ? (d.diameter ?? 0) : (d.width ?? 0);
    const hoch = d.form === 'rund' ? (d.diameter ?? 0) : (d.height ?? 0);
    const u = d.distance ?? 0;
    // Bei runder Form ist `sillHeight` die Achshöhe, bei rechteckiger die
    // Unterkante — dieselbe Unterscheidung wie im Typ, und hier muss sie
    // gemacht werden, sonst sitzt der Kreis eine halbe Bohrung zu hoch.
    const unten = d.form === 'rund' ? (d.sillHeight ?? 0) - hoch / 2 : (d.sillHeight ?? 0);
    return { u0: u - breite / 2, u1: u + breite / 2, z0: unten, z1: unten + hoch };
  };
  const fa = feld(a);
  const fb = feld(b);
  const eps = 1e-6;
  return fa.u0 < fb.u1 - eps && fb.u0 < fa.u1 - eps && fa.z0 < fb.z1 - eps && fb.z0 < fa.z1 - eps;
}
