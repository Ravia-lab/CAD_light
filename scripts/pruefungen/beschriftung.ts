/**
 * Prüfblock „Beschriften in 3D" — die Fahne, die nicht altert.
 *
 * **Warum dieser Block gebraucht wird.** Eine getippte Zahl auf einer
 * Planfahne ist ab dem Moment des Tippens eine zweite, unabhängige Wahrheit.
 * Wird der Heizkörper später von 1200 auf 1600 W geändert — im Inspektor,
 * beim Import eines Datenblatts, durch den Rohrausleger —, bleibt auf der
 * Fahne die alte Zahl stehen. Niemand merkt es, weil beide Zahlen für sich
 * plausibel aussehen, und im gedruckten Plan steht am Ende die falsche.
 * `src/lib/beschriftung3d.ts` verhindert das, indem es nur anbietet, was das
 * Modell ohnehin weiß, und mitschreibt, **woher** der Text stammt.
 *
 * **Die vier Aussagen, die hier festgenagelt werden.**
 *
 * 1. *Das Vorzeichen steht immer da.* `+0,85 m` und `−0,10 m` — mit echtem
 *    Minuszeichen (U+2212), nicht mit Bindestrich. Ohne Vorzeichen sähe eine
 *    Leitung 10 cm unter Fußboden aus wie eine 10 cm darüber, sobald jemand
 *    den Strich für einen Trennstrich hält.
 * 2. *Ein leeres Feld erzeugt keinen Vorschlag.* Das ist der eigentliche
 *    Zweck: Eine Auswahlzeile „— W" oder gar „undefined W" wäre schlimmer als
 *    gar keine, weil sie sich anklicken und drucken ließe.
 * 3. *Der Plan merkt, wenn die Abschrift wegläuft.* Und er behauptet es nicht,
 *    wo es nichts zu vergleichen gibt: bei freiem Text und bei gelöschtem
 *    Anker ist „nicht veraltet" die einzig ehrliche Antwort.
 * 4. *Die Höhe kommt mit in den Grundriss.* Der Grundriss kennt kein Oben; ohne
 *    die angehängte Höhe stünden zwei übereinander gesetzte Fahnen an
 *    derselben Stelle und niemand wüsste, welche zu welchem Bauteil gehört.
 *
 * Schichtgrenze wie überall: nur `src/lib` und `src/types`.
 */

import type { CheckFn } from './typ';
import type {
  Annotation,
  AnnotationAnchor,
  AnnotationQuelle,
  BimDocument,
  Durchbruch,
  Fixture,
  PipeRun,
} from '../../src/types/bim';
import {
  beschriftungVeraltet,
  beschriftungsVorschlaege,
  hoehenText,
  modellwert,
  planText,
} from '../../src/lib/beschriftung3d';

// ---------------------------------------------------------------------------
// Das Prüfmodell — ein Heizkörper, eine Leitung, ein Durchbruch
// ---------------------------------------------------------------------------

/**
 * Das echte Minuszeichen, wie es im Modul steht: U+2212 MINUS SIGN.
 *
 * Als Konstante und mit ausgeschriebener Kennung, weil ein Bindestrich (U+002D)
 * in der Prüfdatei optisch nicht davon zu unterscheiden wäre. Wer die beiden
 * vertauscht, hätte eine Prüfung, die grün ist und trotzdem den falschen
 * Zeichensatz festschreibt.
 */
const MINUS = '−';

/** Der Heizkörper des Prüfmodells — vollständig ausgefüllt. */
function heizkoerper(powerW: number | undefined): Fixture {
  return {
    id: 'hk',
    type: 'radiator',
    category: 'heating',
    levelId: 'eg',
    position: { x: 2, y: 0.17 },
    rotation: 0,
    length: 1,
    depth: 0.1,
    elevation: 0.85,
    wallId: 'w-s',
    params: {
      powerW,
      radiatorType: '22',
      radiatorConnection: 'mitte',
      valveSide: 'links',
    },
  };
}

/** Die Leitung: DN 20 Heizungsvorlauf, 20 mm gedämmt, unter der Decke. */
function leitung(): PipeRun {
  return {
    id: 'rl',
    levelId: 'eg',
    service: 'heating-flow',
    points: [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
    ],
    nominalDiameter: 20,
    insulation: 20,
    elevation: 2.4,
  };
}

/** Der Durchbruch: Kernbohrung Ø 152, Unterkante 0,30 m. */
function bohrung(): Durchbruch {
  return {
    id: 'db',
    kind: 'kernbohrung',
    name: 'Kernbohrung Ø 152 (DN 100)',
    levelId: 'eg',
    wallId: 'w-s',
    distance: 2,
    form: 'rund',
    diameter: 0.152,
    sillHeight: 0.3,
    service: 'sanitary',
    dn: 100,
  };
}

/**
 * Ein Modell, das nur enthält, was dieses Modul liest.
 *
 * `beschriftung3d` greift ausschließlich auf `fixtures`, `pipes` und
 * `durchbrueche` zu — Geometrie, Geschosse und Anlage spielen keine Rolle.
 * Ein vollständiges Prüfhaus wäre hier kein zusätzlicher Nachweis, sondern
 * nur mehr Text zwischen Prüfung und Sollwert.
 *
 * `powerW` hat bewusst **keinen** Vorgabewert. Mit einem schriebe man
 * `baueModell(undefined)`, um den Heizkörper ohne Leistung zu bekommen — und
 * bekäme die 1200 W des Vorgabewerts zurück, weil ein ausdrücklich
 * übergebenes `undefined` auf ihn zurückfällt. Genau diese Falle hat hier
 * zwei Prüfungen scheitern lassen, und das war gut: Sie hätten sonst
 * behauptet, ein leeres Feld erzeuge keinen Vorschlag, während in Wahrheit
 * nie ein leeres Feld geprüft wurde.
 */
function baueModell(powerW: number | undefined): BimDocument {
  return {
    fixtures: { hk: heizkoerper(powerW) },
    pipes: { rl: leitung() },
    durchbrueche: { db: bohrung() },
  } as unknown as BimDocument;
}

/** Eine Beschriftung, wie sie in der begehbaren Ansicht entsteht. */
function fahne(text: string | undefined, anchor?: AnnotationAnchor, elevation?: number): Annotation {
  return {
    id: 'note',
    kind: 'leader',
    levelId: 'eg',
    points: [
      { x: 2, y: 0.2 },
      { x: 2.6, y: 0.8 },
    ],
    offset: 0,
    scale: 1,
    text,
    elevation,
    anchor,
  };
}

/** Den Text zu einer Quelle heraussuchen — oder ein Wort, das nie ein Text ist. */
function vorschlag(doc: BimDocument, anchor: AnnotationAnchor, quelle: AnnotationQuelle): string {
  const treffer = beschriftungsVorschlaege(doc, anchor).find((v) => v.quelle === quelle);
  return treffer ? treffer.text : 'kein Vorschlag';
}

// ---------------------------------------------------------------------------

export function pruefeBeschriftung3d(check: CheckFn): void {
  // =========================================================================
  // 1 · Die Höhe als Text
  // =========================================================================
  {
    check('Über Fußboden mit Pluszeichen', hoehenText(0.85), '+0,85 m');
    check('Unter Fußboden mit echtem Minuszeichen', hoehenText(-0.1), `${MINUS}0,10 m`);
    // Die Gegenprobe zum Zeichensatz: Ein Bindestrich sähe genauso aus, wäre
    // aber ein anderes Zeichen — und im Plan bricht er die Zeile anders um.
    check('… und zwar U+2212, nicht der Bindestrich', hoehenText(-0.1).charCodeAt(0), 0x2212);
    check('Der Bindestrich taucht nicht auf', hoehenText(-0.1).includes('-'), false);
    // Null bekommt ausdrücklich ein Plus. „0,00 m" allein sähe aus wie eine
    // fehlende Angabe; „+0,00 m" ist eine Aussage: Oberkante Fertigfußboden.
    check('Null ist eine Aussage, kein leeres Feld', hoehenText(0), '+0,00 m');
    check('Unter der Decke', hoehenText(2.4), '+2,40 m');
    check('Deutsches Komma, zwei Nachkommastellen', hoehenText(1.5), '+1,50 m');
  }

  // =========================================================================
  // 2 · Was das Modell am Heizkörper anbietet
  // =========================================================================
  {
    const doc = baueModell(1200);
    const anker: AnnotationAnchor = { kind: 'fixture', id: 'hk' };
    const vorschlaege = beschriftungsVorschlaege(doc, anker);

    check('Es gibt überhaupt Vorschläge', vorschlaege.length > 0, true);
    /*
     * Die Reihenfolge ist die der Nützlichkeit, nicht die der Datenstruktur:
     * Wer im Raum vor einem Heizkörper steht und eine Fahne setzt, meint in
     * neun von zehn Fällen die Leistung. Stünde sie an sechster Stelle, würde
     * stattdessen genommen, was oben steht.
     */
    check('Die Leistung steht obenan', vorschlaege[0]?.text ?? 'keiner', '1200 W');
    check('… und sie ist als Leistung ausgewiesen', vorschlaege[0]?.quelle ?? 'keine', 'leistung');
    check('… mit einem Hinweis, was sie bedeutet', vorschlaege[0]?.hinweis ?? 'keiner', 'Normwärmeleistung');

    check('Die Bauart wird angeboten', vorschlag(doc, anker, 'typ'), 'Typ 22');
    // Anschlussart und Ventilseite stehen zusammen: Auf der Baustelle sind es
    // zwei Angaben, die nur gemeinsam sagen, wie angebunden wird.
    check('Die Anschlussart samt Ventilseite', vorschlag(doc, anker, 'anschluss'), 'Mittelanschluss unten · Ventil links');
    check('Die Montagehöhe über FFB', vorschlag(doc, anker, 'hoehe'), '+0,85 m');
    check('Das Baumaß', vorschlag(doc, anker, 'mass'), '1,00 × 0,10 m');
    // Ohne eigene Bezeichnung fällt die Liste auf die Bibliothek zurück —
    // aber auf einen echten Namen, nicht auf eine Kennung.
    check('Und die Bezeichnung aus der Bibliothek', vorschlag(doc, anker, 'name'), 'Heizkörper');
  }

  // =========================================================================
  // 3 · Leere Felder erzeugen keinen Vorschlag — der eigentliche Zweck
  // =========================================================================
  {
    /*
     * Der Fehler, den diese Prüfung fängt: Wer die Liste unbedingt
     * vollständig haben will, schreibt `${p.powerW} W` ohne Abfrage — und die
     * Auswahl bietet dann „undefined W" an. Das lässt sich anklicken, landet
     * als Abschrift am Anker und wird gedruckt. Eine Variante davon ist der
     * gut gemeinte Platzhalter „— W": Er sieht nach einer Angabe aus, die
     * jemand bewusst offen gelassen hat, und niemand fragt nach.
     */
    const ohne = baueModell(undefined);
    const anker: AnnotationAnchor = { kind: 'fixture', id: 'hk' };
    const vorschlaege = beschriftungsVorschlaege(ohne, anker);

    check('Ohne Leistung gibt es keine Leistungszeile', vorschlag(ohne, anker, 'leistung'), 'kein Vorschlag');
    check(
      'Und schon gar keine mit „undefined"',
      vorschlaege.some((v) => v.text.includes('undefined')),
      false,
    );
    check(
      'Auch kein Platzhalter „— W"',
      vorschlaege.some((v) => v.text.includes('—')),
      false,
    );
    check(
      'Überhaupt keine Zeile, die auf W endet',
      vorschlaege.some((v) => v.text.trimEnd().endsWith('W')),
      false,
    );
    // Die übrigen Angaben bleiben — eine fehlende Leistung darf nicht die
    // ganze Auswahl leerräumen.
    check('Die übrigen Angaben bleiben stehen', vorschlag(ohne, anker, 'typ'), 'Typ 22');
    check('Und die Höhe auch', vorschlag(ohne, anker, 'hoehe'), '+0,85 m');

    // Ein Anker ins Leere liefert eine leere Liste, keinen Absturz und keine
    // erfundene Zeile.
    check(
      'Ein gelöschtes Bauteil bietet nichts an',
      beschriftungsVorschlaege(ohne, { kind: 'fixture', id: 'fort' }).length,
      0,
    );
  }

  // =========================================================================
  // 4 · Leitung und Durchbruch
  // =========================================================================
  {
    const doc = baueModell(1200);
    const rohr: AnnotationAnchor = { kind: 'pipe', id: 'rl' };
    check('Die Leitung nennt ihre Nennweite', vorschlag(doc, rohr, 'dn'), 'DN 20');
    check('… das Medium im Klartext', vorschlag(doc, rohr, 'medium'), 'Heizung Vorlauf');
    check('… und die Verlegehöhe über FFB', vorschlag(doc, rohr, 'hoehe'), '+2,40 m');
    check('Die Dämmstärke gehört zum Maß', vorschlag(doc, rohr, 'mass'), '20 mm Dämmung');

    const loch: AnnotationAnchor = { kind: 'durchbruch', id: 'db' };
    // Das Maß in Millimeter, weil danach die Bohrkrone gewählt wird.
    check('Der Durchbruch nennt sein Maß', vorschlag(doc, loch, 'mass'), 'Ø152');
    // Bei runder Form ist `sillHeight` die Achshöhe, bei rechteckiger die
    // Unterkante — der Hinweistext benennt das; hier zählt die Zahl.
    check('… und seine Unterkante', vorschlag(doc, loch, 'hoehe'), '+0,30 m');
    check('… und trägt seinen Namen', vorschlag(doc, loch, 'name'), 'Kernbohrung Ø 152 (DN 100)');
    check('Die Nennweite der Leitung steht dabei', vorschlag(doc, loch, 'dn'), 'DN 100');
  }

  // =========================================================================
  // 5 · Läuft die Abschrift vom Modell weg?
  // =========================================================================
  {
    const doc = baueModell(1200);

    // (a) Freier Text: keine Quelle, also nichts zu vergleichen. Eine Warnung
    //     wäre hier eine Behauptung über einen Text, den niemand aus dem
    //     Modell übernommen hat.
    check(
      'Freier Text ist nie veraltet',
      beschriftungVeraltet(doc, fahne('Achtung: Altbestand', { kind: 'fixture', id: 'hk' })),
      false,
    );
    check('Auch ganz ohne Anker', beschriftungVeraltet(doc, fahne('Achtung: Altbestand')), false);

    // (b) Abschrift und Modell stimmen überein.
    const abschrift = fahne('1200 W', { kind: 'fixture', id: 'hk', quelle: 'leistung' });
    check('Eine stimmende Abschrift ist nicht veraltet', beschriftungVeraltet(doc, abschrift), false);
    check('Der Modellwert wird auch gefunden', modellwert(doc, abschrift.anchor!) ?? 'keiner', '1200 W');

    /*
     * (c) Der Fall, um den es geht: Der Heizkörper wird auf 1600 W geändert —
     *     im Inspektor, beim Datenblattimport oder durch den Rohrausleger. Die
     *     Fahne sagt weiterhin 1200 W. Genau das muss der Plan melden können,
     *     statt es stillschweigend zu drucken.
     */
    const geaendert = baueModell(1600);
    check('Ein geänderter Modellwert macht sie veraltet', beschriftungVeraltet(geaendert, abschrift), true);
    check('… und der neue Wert ist auffindbar', modellwert(geaendert, abschrift.anchor!) ?? 'keiner', '1600 W');

    /*
     * (d) Der Anker ist gelöscht. Hier ist `false` die einzig ehrliche
     *     Antwort: Es gibt keinen Modellwert mehr, mit dem sich die Abschrift
     *     vergleichen ließe. Eine Warnung „veraltet" wäre eine Behauptung ohne
     *     Grundlage — der Text kann vollkommen richtig sein, das Bauteil ist
     *     nur nicht mehr da. Dass ein Anker ins Leere zeigt, ist ein eigener
     *     Befund und gehört in die Modellprüfung, nicht in diese Warnung.
     */
    const verwaist = fahne('1200 W', { kind: 'fixture', id: 'fort', quelle: 'leistung' });
    check('Ein gelöschter Anker erzeugt keine Warnung', beschriftungVeraltet(doc, verwaist), false);
    check('… weil es gar keinen Modellwert gibt', modellwert(doc, verwaist.anchor!) === null, true);

    // (e) Auch eine Quelle, die es an diesem Bauteil nicht gibt, ist kein
    //     Widerspruch: Eine Leitung hat keine Anschlussart.
    check(
      'Eine unpassende Quelle warnt nicht',
      beschriftungVeraltet(doc, fahne('Mittelanschluss unten', { kind: 'pipe', id: 'rl', quelle: 'anschluss' })),
      false,
    );
  }

  // =========================================================================
  // 6 · Was im Grundriss steht
  // =========================================================================
  {
    /*
     * Der Grundriss kennt nur x und y. Eine Fahne, die im Raum an einem
     * Heizkörper hängt, hat dort kein „oben" — zwei übereinander gesetzte
     * Beschriftungen lägen an derselben Stelle. Deshalb schreibt der Plan die
     * Höhe dazu, und zwar nur bei den Fahnen, die aus der begehbaren Ansicht
     * stammen: eine gewöhnliche Planbeschriftung bleibt, wie sie ist.
     */
    check('Ohne Höhe bleibt der Text unverändert', planText(fahne('Bestand 1985')), 'Bestand 1985');
    check('Mit Höhe kommt sie dazu', planText(fahne('1200 W', undefined, 0.85)), '1200 W · +0,85 m');
    check('Unter Fußboden ebenso', planText(fahne('DN 100', undefined, -0.1)), `DN 100 · ${MINUS}0,10 m`);
    // Ohne Text nur die Höhe — kein führendes Trennzeichen, das aussähe, als
    // wäre der Text verlorengegangen.
    check('Ohne Text steht nur die Höhe da', planText(fahne('', undefined, 0.85)), '+0,85 m');
    check('Auch bei fehlendem Textfeld', planText(fahne(undefined, undefined, 0.85)), '+0,85 m');
    check('Ganz ohne beides bleibt es leer', planText(fahne(undefined)), '');
    // Die Höhe 0 ist eine Angabe und keine fehlende: „auf Fertigfußboden".
    check('Höhe null wird angehängt, nicht weggelassen', planText(fahne('Bodenablauf', undefined, 0)), 'Bodenablauf · +0,00 m');
  }
}
