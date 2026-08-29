/**
 * Mindestdicke der Dämmschicht von Rohrleitungen nach GEG Anlage 8.
 *
 * **Warum dieses Modul eigenständig ist.** `domesticWater.ts` führt bereits
 * eine `insulationThickness`. Sie bildet die Grundtabelle über die *Nennweite*
 * ab und kennt nur eine pauschale „Halbierung". Beides ist zu grob, um damit
 * eine Leitung im Plan zu beschriften: Anlage 8 Nr. 1 a) stellt ausdrücklich
 * auf den **Innendurchmesser** ab — bei einem Mehrschichtverbundrohr 26 × 3
 * ist das 20 mm bei DN 20, bei einem Stahlrohr DN 20 aber 21,6 mm; die eine
 * Leitung fällt unter aa), die andere unter bb), 20 mm gegen 30 mm. Und die
 * Ermäßigungen sind keine einzige Regel, sondern sechs verschiedene mit
 * verschiedenen Voraussetzungen. Dieses Modul bildet sie einzeln ab und sagt
 * in `rule` und `reason`, welche gegriffen hat. Die alte Funktion bleibt
 * unangetastet; wer beide importiert, muss eine davon umbenennen.
 *
 * **Die drei Fallen, an denen Programme diese Anlage regelmäßig verfehlen** —
 * sie stehen hier oben, weil jede davon im Code eine eigene Verzweigung hat:
 *
 *  1. *„Rohr im Fußboden → 6 mm."* Falsch. Die 6 mm nach gg) gelten nur für
 *     Leitungen **nach ff)**, also für Wärmeverteilungsleitungen zwischen
 *     beheizten Räumen **verschiedener Nutzer**, die dort im Fußbodenaufbau
 *     liegen. Eine Anbindeleitung im Estrich einer Einfamilienwohnung ist
 *     keine solche Leitung — für sie gilt die volle Dicke nach aa–dd.
 *  2. *„Unbeheizter Raum → halbe Dicke."* Es gibt für unbeheizte Räume
 *     **keine** Ermäßigung. Im Gegenteil: § 69 Abs. 2 macht daraus im Bestand
 *     eine Nachrüstpflicht für zugängliche Leitungen.
 *  3. *„Zwischen beheizten Räumen → halbe Dicke."* Nur bei **verschiedenen**
 *     Nutzern (ff). Beim selben Nutzer greift ff nicht; dort kann die Leitung
 *     nach Nr. 1 b) sogar ganz frei sein — aber ausschließlich dann, wenn die
 *     Wärmeabgabe durch frei liegende Absperreinrichtungen beeinflussbar ist.
 *
 * **Was dieses Modul nicht kann und deshalb erfragt.** Ob zwei Räume
 * verschiedenen Nutzern gehören, ob eine Absperreinrichtung frei liegt, ob
 * eine Stichleitung an der Zirkulation hängt — das steht in keiner Geometrie.
 * Diese Angaben sind Eingaben. Fehlen sie, wird nicht geraten: es wird auf
 * der sicheren Seite gerechnet (volle Dicke, keine Befreiung) und die Lücke
 * als `PlanningNote` gemeldet.
 *
 * Fundstellen:
 *  • GEG Anlage 8 (zu §§ 69, 70) — https://www.gesetze-im-internet.de/geg/anlage_8.html
 *  • GEG § 69 — https://www.gesetze-im-internet.de/geg/__69.html
 *  • Zur Falle 1 (Fußbodenaufbau) — https://www.ikz.de/heizungstechnik/news/detail/rohrleitungen-im-fussbodenaufbau/
 */

import type { PipeDimension, PipeService, PipeSurrounding } from '../types/bim';

/**
 * Hinweis mit Gewicht — gleiche Form wie in `plantDesign.ts` und
 * `domesticWater.ts`. Der Typ wird hier eigens geführt und nicht importiert,
 * damit dieses Modul nicht wegen einer dreizeiligen Typdefinition den ganzen
 * Anlagenentwurf nachzieht; das ist die im Haus bereits geübte Form.
 */
export type PlanningNote = { severity: 'info' | 'warn' | 'error'; text: string };

/**
 * Bezugswärmeleitfähigkeit der Anlage 8 [W/(m·K)].
 *
 * Alle Dicken der Nummern 1 und 2 sind auf diesen Wert bezogen. Für
 * Wärmeleitungen ist λ auf eine Mitteltemperatur von 40 °C zu beziehen, für
 * Kälteleitungen auf 10 °C — dieselbe Zahl, zwei verschiedene Messpunkte.
 */
export const LAMBDA_BEZUG = 0.035;

/**
 * Anlage 8 Nr. 1 a) als Daten — bezogen auf den **Innendurchmesser** [mm].
 *
 * Die Tabelle steht hier als Wert und nicht als Kette von Vergleichen, damit
 * die Prüfung sie Zeile für Zeile abklopfen und die Oberfläche sie anzeigen
 * kann. `bis` ist die obere Grenze **einschließlich**: „bis 22 mm" heißt
 * ≤ 22 mm, „über 22 bis 35 mm" heißt ≤ 35 mm.
 */
export const GEG_ANLAGE_8: readonly { bis: number; dicke: number | 'innendurchmesser'; buchstabe: string }[] = [
  { bis: 22, dicke: 20, buchstabe: 'aa' },
  { bis: 35, dicke: 30, buchstabe: 'bb' },
  { bis: 100, dicke: 'innendurchmesser', buchstabe: 'cc' },
  { bis: Number.POSITIVE_INFINITY, dicke: 100, buchstabe: 'dd' },
];

/**
 * Anlage 8 Nr. 2 — Kälteverteilungs- und Kaltwasserleitungen von
 * Raumlufttechnik- und Klimakältesystemen, bezogen auf den Innendurchmesser.
 *
 * Eigene, viel kürzere Tabelle: hier geht es nicht um Wärmeverlust, sondern um
 * Wärmeeintrag und Tauwasser. Die Abweichungen aa–hh der Nummer 1 stehen
 * unter Nummer 1 und gelten hier **nicht**.
 */
export const GEG_ANLAGE_8_KAELTE: readonly { bis: number; dicke: number }[] = [
  { bis: 22, dicke: 9 },
  { bis: Number.POSITIVE_INFINITY, dicke: 19 },
];

/**
 * Leitungsarten, die unter § 69 fallen: Wärmeverteilungs- und
 * Warmwasserleitungen. Abwasser, Lüftungskanäle und Trinkwasser kalt stehen
 * bewusst nicht darin — für sie regelt Anlage 8 nichts.
 */
const WAERMELEITUNGEN: readonly PipeService[] = ['heating-flow', 'heating-return', 'hot-water', 'circulation'];

export interface InsulationInput {
  /** Lichter Innendurchmesser [mm] — die maßgebliche Größe der Anlage 8 Nr. 1 a). */
  innerDiameter: number;
  /** Rohraußendurchmesser [mm]; wird für die λ-Umrechnung gebraucht. */
  outerDiameter: number;
  surrounding: PipeSurrounding;
  service: PipeService;
  /** Bauteil zwischen Räumen verschiedener Nutzer? Kann die Geometrie nicht wissen. */
  differentUsers?: boolean;
  /** Wärmeabgabe durch frei liegende Absperreinrichtungen beeinflussbar? */
  adjustableEmission?: boolean;
  /** Neubau/Ersatz nach § 69 Abs. 1 (true) oder Nachrüstung im Bestand nach Abs. 2. */
  newInstallation?: boolean;
  /** λ des Dämmstoffs [W/(m·K)]; Vorbelegung 0.035. */
  lambda?: number;
  /**
   * Nach dem 31.01.2002 verlegt? Buchstabe ff) nennt dieses Datum
   * ausdrücklich; eine ältere Leitung zwischen verschiedenen Nutzern bekommt
   * die Halbierung nicht.
   *
   * Vorbelegung `true`, und zwar begründet: dieses Programm plant Neuanlagen
   * und Sanierungen, was heute gezeichnet wird, wird heute verlegt. Für eine
   * Bestandsaufnahme älterer Leitungen ist der Wert ausdrücklich auf `false`
   * zu setzen.
   */
  installedAfter2002?: boolean;
  /**
   * Stichleitung ohne Zirkulation und ohne Begleitheizung? Voraussetzung der
   * Befreiung nach Nr. 1 c).
   */
  stubLine?: boolean;
  /** Wasserinhalt der Stichleitung [l]; Nr. 1 c) lässt höchstens 3 l zu. */
  stubVolume?: number;
  /**
   * Sonderfall der Öffnungsklausel Nr. 4: geringere Dicke, weil die
   * Gleichwertigkeit nachgewiesen ist — etwa bei asymmetrischen
   * Kompakt-Dämmhülsen mit allgemeiner bauaufsichtlicher Zulassung. Das
   * Programm kann eine Gleichwertigkeit nicht prüfen; es übernimmt die
   * Angabe und führt den Nachweis im Bericht mit.
   */
  provenEquivalent?: { thickness: number; proof: string };
}

export interface InsulationResult {
  /** Mindestdicke [mm], gerundet auf ganze Millimeter. */
  thickness: number;
  /** Der Wert vor der λ-Umrechnung, bezogen auf 0,035. */
  baseThickness: number;
  /**
   * Welcher Buchstabe der Anlage 8 gegriffen hat:
   * 'aa'|'bb'|'cc'|'dd'|'ee'|'ff'|'gg'|'hh'|'1b'|'1c'|'kaelte'.
   * Dazu zwei Werte außerhalb der Anlage: '4' für die nachgewiesene
   * Gleichwertigkeit nach Nr. 4 und 'ausserhalb' für Leitungsarten, die
   * Anlage 8 gar nicht erfasst; 'unbekannt', wenn die Eingabe unbrauchbar ist.
   */
  rule: string;
  /** Klartext für den Bericht — Regel und Begründung in einem Satz. */
  reason: string;
  /** Fundstelle. */
  norm: string;
  notes: PlanningNote[];
}

// ---------------------------------------------------------------------------
// Hilfsmittel
// ---------------------------------------------------------------------------

/** Deutsche Zahlschreibweise für Berichtstexte. */
function de(value: number, digits = 1): string {
  return value.toFixed(digits).replace('.', ',');
}

/**
 * Aufrunden auf ganze Millimeter.
 *
 * Eine *Mindest*dicke darf nicht unterschritten werden — kaufmännisches Runden
 * würde aus 24,4 mm eine 24er-Schale machen und die Anforderung um 0,4 mm
 * verfehlen. Die kleine Toleranz fängt ab, dass 20 aus einer Fließkommakette
 * als 20,0000000001 herauskommt und dann auf 21 klettern würde.
 */
function aufMillimeter(value: number): number {
  return Math.ceil(value - 1e-9);
}

/** Die Zeile der Grundtabelle, die für einen Innendurchmesser gilt. */
function tabellenzeile(innerDiameter: number): { dicke: number | 'innendurchmesser'; buchstabe: string } {
  for (const zeile of GEG_ANLAGE_8) {
    if (innerDiameter <= zeile.bis) return zeile;
  }
  // Unerreichbar, weil die letzte Zeile bis unendlich reicht; die Rückgabe
  // steht hier nur, damit der Übersetzer keinen undefinierten Zweig sieht.
  return GEG_ANLAGE_8[GEG_ANLAGE_8.length - 1];
}

/**
 * Vorbehalt zur λ-Umrechnung — wortgleich in jeder Rückgabe, in der
 * umgerechnet wurde.
 *
 * Anlage 8 Nr. 3 ordnet die Umrechnung an, **nennt aber keine Formel** und
 * verweist auf die anerkannten Regeln der Technik. Welche Norm ein Prüfer
 * ansetzt, ließ sich nicht verifizieren — DIN EN ISO 12241 und VDI 2055-1
 * kommen beide in Frage. Deshalb wird die Umrechnung angeboten und zugleich
 * gekennzeichnet, statt sie als Gesetzeswert auszugeben.
 */
const UMRECHNUNG_VORBEHALT =
  'Die Dicke wurde von λ = 0,035 W/(m·K) auf das angegebene λ umgerechnet. GEG Anlage 8 Nr. 3 ordnet die Umrechnung an, ' +
  'nennt aber keine Formel und verweist auf die anerkannten Regeln der Technik: Verfahren nach anerkannten Regeln der Technik, ' +
  'Formel nicht normativ zitierbar. Verwendet wird die übliche Zylinderformel D_x = d · (D_35/d)^(λ_x/0,035); welche Norm ' +
  'im Einzelfall herangezogen wird (DIN EN ISO 12241 oder VDI 2055-1 kommen in Frage), ist nicht belegt und mit dem ' +
  'Prüfenden abzustimmen.';

/**
 * Umrechnung der Mindestdicke auf ein abweichendes λ [mm].
 *
 * Gleichwertig ist nicht die Dicke, sondern der Wärmedurchlasswiderstand der
 * Zylinderschale. Aus R = ln(D/d)/(2π·λ) folgt für R_x = R_35 unmittelbar
 * λ_x · ln(D_35/d) / λ_35 = ln(D_x/d) und damit
 *
 *     D_x = d · (D_35/d)^(λ_x/0,035)      mit  s = (D − d)/2.
 *
 * Der Rückgabewert ist **nicht** gerundet: die Prüfung soll die Herleitung
 * nachrechnen können, und das Runden gehört an die eine Stelle, an der die
 * Mindestdicke entsteht.
 *
 * @param outerDiameter Rohraußendurchmesser d [mm]
 * @param baseThickness Dicke s_35 [mm], bezogen auf λ = 0,035 W/(m·K)
 * @param lambda        λ_x des tatsächlichen Dämmstoffs [W/(m·K)]
 */
export function thicknessForLambda(outerDiameter: number, baseThickness: number, lambda: number): number {
  if (!(outerDiameter > 0) || !(baseThickness > 0) || !(lambda > 0)) return baseThickness;
  const durchmesser35 = outerDiameter + 2 * baseThickness;
  const durchmesserX = outerDiameter * (durchmesser35 / outerDiameter) ** (lambda / LAMBDA_BEZUG);
  return (durchmesserX - outerDiameter) / 2;
}

/**
 * Letzter Abschnitt jeder Rechnung: λ-Umrechnung, Öffnungsklausel, Rundung.
 *
 * Beides steht bewusst *hinter* der Regelfindung. Nr. 3 rechnet eine
 * gefundene Mindestdicke um, und Nr. 4 lässt eine gefundene Mindestdicke
 * unterschreiten — beide setzen also voraus, dass die Anforderung überhaupt
 * erst feststeht. `baseThickness` bleibt deshalb der Wert nach Nummer 1 bzw.
 * 2; im Bericht steht damit auch, wovon abgewichen wurde.
 */
function ergebnis(
  input: InsulationInput,
  baseThickness: number,
  rule: string,
  reason: string,
  norm: string,
  notes: PlanningNote[],
): InsulationResult {
  const lambda = input.lambda ?? LAMBDA_BEZUG;
  let dicke = baseThickness;
  let regel = rule;
  let begruendung = reason;
  let fundstelle = norm;

  if (baseThickness > 0 && lambda !== LAMBDA_BEZUG) {
    if (!(input.outerDiameter > 0)) {
      notes.push({
        severity: 'warn',
        text:
          `Für λ = ${de(lambda, 3)} W/(m·K) wäre die Mindestdicke nach GEG Anlage 8 Nr. 3 umzurechnen. Dafür fehlt der ` +
          'Rohraußendurchmesser; ausgegeben ist die Dicke für λ = 0,035 W/(m·K).',
      });
    } else {
      dicke = thicknessForLambda(input.outerDiameter, baseThickness, lambda);
      begruendung += ` Auf λ = ${de(lambda, 3)} W/(m·K) umgerechnet: ${de(dicke, 1)} mm.`;
      fundstelle += ' i. V. m. Nr. 3';
      notes.push({ severity: 'warn', text: UMRECHNUNG_VORBEHALT });
    }
  }

  const gleichwertig = input.provenEquivalent;
  if (gleichwertig && baseThickness > 0) {
    begruendung =
      `Statt der ${de(aufMillimeter(dicke), 0)} mm nach Anlage 8 sind ${de(gleichwertig.thickness, 0)} mm ausgeführt; ` +
      `die Gleichwertigkeit ist nachgewiesen (${gleichwertig.proof}).`;
    dicke = gleichwertig.thickness;
    regel = '4';
    fundstelle = 'GEG Anlage 8 Nr. 4 (Öffnungsklausel)';
    notes.push({
      severity: 'warn',
      text:
        'Die geringere Dämmdicke stützt sich auf die Öffnungsklausel der GEG Anlage 8 Nr. 4. Das Programm prüft die ' +
        `Gleichwertigkeit nicht — der Nachweis „${gleichwertig.proof}" ist beizubringen und den Bauunterlagen beizufügen.`,
    });
  }

  return {
    thickness: aufMillimeter(dicke),
    baseThickness,
    rule: regel,
    reason: begruendung,
    norm: fundstelle,
    notes,
  };
}

// ---------------------------------------------------------------------------
// Die Rechnung
// ---------------------------------------------------------------------------

/**
 * Mindestdicke der Dämmschicht für einen Leitungsabschnitt.
 *
 * Die Reihenfolge ist die des Gesetzes und nicht beliebig:
 *
 *  0. **Anwendungsbereich** — fällt die Leitungsart überhaupt unter §§ 69, 70?
 *     Für Abwasser, Lüftung und Trinkwasser kalt regelt Anlage 8 nichts; eine
 *     Zahl auszugeben wäre hier schlimmer als keine.
 *  1. **Befreiungen** (Nr. 1 b, 1 c) — wo keine Anforderung besteht, braucht
 *     keine Ermäßigung gesucht zu werden.
 *  2. **Abweichungen** (ee–hh) — Halbierung, feste 6 mm oder Verdopplung.
 *  3. **Grundtabelle** (aa–dd) — der Regelfall und zugleich die sichere Seite
 *     überall dort, wo eine Angabe für Schritt 1 oder 2 fehlt.
 *  4. **λ-Umrechnung** (Nr. 3) und **Öffnungsklausel** (Nr. 4) in `ergebnis`.
 */
export function insulationThickness(input: InsulationInput): InsulationResult {
  const notes: PlanningNote[] = [];
  const innen = input.innerDiameter;

  if (!(innen > 0)) {
    return {
      thickness: 0,
      baseThickness: 0,
      rule: 'unbekannt',
      reason: 'Ohne Innendurchmesser lässt sich die Mindestdicke nach GEG Anlage 8 nicht bestimmen.',
      norm: 'GEG Anlage 8 Nr. 1 a) (zu §§ 69, 70)',
      notes: [
        {
          severity: 'error',
          text:
            'Der Leitung fehlt der lichte Innendurchmesser. Er ist die maßgebliche Größe der GEG Anlage 8 — die Nennweite ' +
            'reicht nicht, sie weicht je nach Werkstoff um mehrere Millimeter davon ab und kann in eine andere Zeile fallen.',
        },
      ],
    };
  }

  if (input.outerDiameter > 0 && input.outerDiameter <= innen) {
    notes.push({
      severity: 'warn',
      text:
        `Der angegebene Außendurchmesser (${de(input.outerDiameter)} mm) ist nicht größer als der Innendurchmesser ` +
        `(${de(innen)} mm). Eine λ-Umrechnung auf dieser Grundlage wäre wertlos; die Rohrmaße sind zu prüfen.`,
    });
  }

  // === 0 — Anwendungsbereich ==============================================

  if (input.service === 'refrigerant') {
    // § 70 mit Anlage 8 Nr. 2. Eigene Tabelle, eigener λ-Bezugspunkt (10 °C
    // statt 40 °C) und keine der Abweichungen aa–hh: die stehen unter
    // Nummer 1 und gelten für Wärme-, nicht für Kälteleitungen.
    const zeile = GEG_ANLAGE_8_KAELTE.find((z) => innen <= z.bis) ?? GEG_ANLAGE_8_KAELTE[1];
    notes.push({
      severity: 'info',
      text:
        'Kälteleitung nach GEG § 70: λ ist auf eine Mitteltemperatur von 10 °C zu beziehen. Die Ermäßigungen der ' +
        'Nummer 1 (Durchbruch, verschiedene Nutzer, Fußbodenaufbau) gelten hier nicht — auch im Durchbruch bleibt es bei ' +
        'der vollen Dicke. Tauwasserschutz ist damit nicht nachgewiesen; er ist gesondert zu führen.',
    });
    return ergebnis(
      input,
      zeile.dicke,
      'kaelte',
      `Kälteleitung mit ${de(innen)} mm Innendurchmesser (${innen <= 22 ? 'bis' : 'über'} 22 mm) → ${zeile.dicke} mm ` +
        'Mindestdicke, bezogen auf λ = 0,035 W/(m·K) bei 10 °C.',
      'GEG Anlage 8 Nr. 2 (zu § 70)',
      notes,
    );
  }

  if (!WAERMELEITUNGEN.includes(input.service)) {
    const grund =
      input.service === 'cold-water'
        ? 'Für Trinkwasser kalt fordert das GEG keine Dämmung — dort geht es nicht um Wärmeverlust, sondern um den Schutz ' +
          'gegen Erwärmung nach DIN 1988-200. Diese Anforderung wird hier nicht bestimmt.'
        : input.service === 'waste'
          ? 'Abwasserleitungen erfasst die GEG Anlage 8 nicht; eine Dämmung dient dort dem Schall- und Tauwasserschutz.'
          : 'Luftkanäle erfasst die GEG Anlage 8 nicht; ihre Dämmung folgt anderen Regeln und wird hier nicht bestimmt.';
    notes.push({ severity: 'warn', text: grund });
    return {
      thickness: 0,
      baseThickness: 0,
      rule: 'ausserhalb',
      reason: `Diese Leitungsart fällt nicht unter GEG §§ 69, 70; die Anlage 8 gibt für sie keine Mindestdicke vor.`,
      norm: 'GEG §§ 69, 70 (Anwendungsbereich)',
      notes,
    };
  }

  // === 1 — Befreiungen ====================================================

  // Nr. 1 c) — Warmwasser-Stichleitung bis 3 l Inhalt, ohne Zirkulation und
  // ohne Begleitheizung, in beheizten Räumen. Sie steht vor Nr. 1 b), weil sie
  // die engere Voraussetzung hat und keine Absperreinrichtung verlangt.
  if (input.service === 'hot-water' && input.stubLine === true && input.surrounding === 'beheizt') {
    if (input.stubVolume === undefined) {
      notes.push({
        severity: 'warn',
        text:
          'Die Leitung ist als Stichleitung ohne Zirkulation angegeben, aber ohne Wasserinhalt. GEG Anlage 8 Nr. 1 c) ' +
          'befreit nur bis 3 l Inhalt; ohne diesen Wert wird die volle Dämmdicke angesetzt.',
      });
    } else if (input.stubVolume <= 3) {
      return ergebnis(
        input,
        0,
        '1c',
        `Warmwasser-Stichleitung mit ${de(input.stubVolume, 2)} l Inhalt (höchstens 3 l), ohne Zirkulation und ohne ` +
          'Begleitheizung, in einem beheizten Raum → keine Anforderung an die Dämmdicke.',
        'GEG Anlage 8 Nr. 1 c)',
        notes,
      );
    } else {
      notes.push({
        severity: 'info',
        text:
          `Die Stichleitung führt ${de(input.stubVolume, 2)} l und überschreitet damit die 3 l der GEG Anlage 8 ` +
          'Nr. 1 c). Die Befreiung greift nicht; es gilt die Regeldicke.',
      });
    }
  }

  // Nr. 1 b) — in beheizten Räumen oder in Bauteilen zwischen beheizten
  // Räumen **desselben** Nutzers, und die Wärmeabgabe ist durch frei liegende
  // Absperreinrichtungen beeinflussbar. Das ist die dritte Falle: „zwischen
  // beheizten Räumen" führt beim selben Nutzer nicht zur Halbierung, sondern
  // entweder zur vollen Dicke oder — mit Absperreinrichtung — zur Freistellung.
  const bauteilGleicherNutzer = input.surrounding === 'zwischen-nutzern' && input.differentUsers === false;
  if (input.surrounding === 'beheizt' || bauteilGleicherNutzer) {
    if (input.adjustableEmission === true) {
      return ergebnis(
        input,
        0,
        '1b',
        (bauteilGleicherNutzer
          ? 'Leitung in einem Bauteil zwischen beheizten Räumen desselben Nutzers'
          : 'Leitung in einem beheizten Raum') +
          ', deren Wärmeabgabe durch frei liegende Absperreinrichtungen beeinflussbar ist → keine Anforderung an die ' +
          'Dämmdicke. Die abgegebene Wärme kommt dem Raum zugute und ist regelbar.',
        'GEG Anlage 8 Nr. 1 b)',
        notes,
      );
    }
    if (input.adjustableEmission === undefined) {
      notes.push({
        severity: 'info',
        text:
          'Ob die Wärmeabgabe dieser Leitung durch frei liegende Absperreinrichtungen beeinflussbar ist, ist nicht ' +
          'angegeben. GEG Anlage 8 Nr. 1 b) würde sie sonst von der Dämmpflicht freistellen; gerechnet wird auf der ' +
          'sicheren Seite mit der vollen Dämmdicke.',
      });
    }
  }

  // === 2 und 3 — Abweichungen und Grundtabelle ============================

  const zeile = tabellenzeile(innen);
  const grunddicke = zeile.dicke === 'innendurchmesser' ? innen : zeile.dicke;
  const grundNorm = `GEG Anlage 8 Nr. 1 a) ${zeile.buchstabe}) (zu §§ 69, 70)`;
  const grundSatz =
    `Innendurchmesser ${de(innen)} mm → ` +
    (zeile.dicke === 'innendurchmesser'
      ? `Mindestdicke gleich dem Innendurchmesser, also ${de(grunddicke)} mm`
      : `${grunddicke} mm Mindestdicke`) +
    ' (bezogen auf λ = 0,035 W/(m·K) bei 40 °C)';

  // Nach dem 31.01.2002 verlegt? Siehe die Vorbelegung an der Eingabe.
  const nach2002 = input.installedAfter2002 ?? true;

  switch (input.surrounding) {
    // ee) — Durchbruch, Kreuzung, Verbindungsstelle, zentraler Verteiler.
    // Der Grund ist baupraktisch: an diesen Stellen ist für die volle Schale
    // schlicht kein Platz, und die betroffene Länge ist kurz.
    case 'durchbruch':
      return ergebnis(
        input,
        grunddicke / 2,
        'ee',
        `${grundSatz}; in Wand-/Deckendurchbrüchen, im Kreuzungsbereich, an Verbindungsstellen und bei zentralen ` +
          `Leitungsnetzverteilern die Hälfte davon: ${de(grunddicke / 2)} mm.`,
        'GEG Anlage 8 Nr. 1 a) ee)',
        notes,
      );

    // hh) — an Außenluft grenzend, doppelte Dicke. Der Buchstabe knüpft
    // ausdrücklich an die Fälle des § 69 Abs. 1 an (Neuanlage, Ersatz); für
    // die Nachrüstung im Bestand nach Abs. 2 gilt er nicht.
    case 'aussenluft': {
      if (input.newInstallation === false) {
        notes.push({
          severity: 'info',
          text:
            'Die Verdopplung nach GEG Anlage 8 Nr. 1 a) hh) knüpft an die Fälle des § 69 Abs. 1 an — an neu eingebaute ' +
            'oder ersetzte Leitungen. Diese Leitung ist als Bestand geführt; für die Nachrüstpflicht nach § 69 Abs. 2 ' +
            'gilt die einfache Dicke der Grundtabelle.',
        });
        return ergebnis(input, grunddicke, zeile.buchstabe, `${grundSatz}.`, grundNorm, notes);
      }
      if (input.newInstallation === undefined) {
        notes.push({
          severity: 'info',
          text:
            'Ob die Leitung neu eingebaut oder ersetzt wird (§ 69 Abs. 1) oder im Bestand nachgerüstet wird (Abs. 2), ' +
            'ist nicht angegeben. Angesetzt ist die schärfere Anforderung: die Verdopplung nach Anlage 8 Nr. 1 a) hh).',
        });
      }
      return ergebnis(
        input,
        grunddicke * 2,
        'hh',
        `${grundSatz}; an Außenluft grenzend das Doppelte davon: ${de(grunddicke * 2)} mm.`,
        'GEG Anlage 8 Nr. 1 a) hh)',
        notes,
      );
    }

    // ff) — Bauteil zwischen beheizten Räumen verschiedener Nutzer.
    case 'zwischen-nutzern': {
      if (input.differentUsers === undefined) {
        notes.push({
          severity: 'warn',
          text:
            'Für diesen Abschnitt ist nicht angegeben, ob das Bauteil beheizte Räume **verschiedener** Nutzer trennt. ' +
            'Nur dann halbiert GEG Anlage 8 Nr. 1 a) ff) die Dicke; beim selben Nutzer gilt die volle Dicke oder — mit ' +
            'frei liegenden Absperreinrichtungen — Nr. 1 b). Gerechnet ist die volle Dicke.',
        });
        return ergebnis(input, grunddicke, zeile.buchstabe, `${grundSatz}.`, grundNorm, notes);
      }
      if (input.differentUsers === false) {
        // Falle 3, Gegenprobe: derselbe Nutzer → keine Halbierung. Die
        // Freistellung nach Nr. 1 b) wurde oben bereits geprüft.
        notes.push({
          severity: 'info',
          text:
            'Das Bauteil trennt beheizte Räume desselben Nutzers. Die Halbierung nach GEG Anlage 8 Nr. 1 a) ff) gilt ' +
            'nur bei verschiedenen Nutzern; hier bleibt es bei der vollen Dicke. Frei liegende Absperreinrichtungen ' +
            'könnten die Leitung nach Nr. 1 b) ganz von der Dämmpflicht freistellen.',
        });
        return ergebnis(input, grunddicke, zeile.buchstabe, `${grundSatz}.`, grundNorm, notes);
      }
      if (!nach2002) {
        notes.push({
          severity: 'info',
          text:
            'Die Halbierung nach GEG Anlage 8 Nr. 1 a) ff) gilt für Wärmeverteilungsleitungen, die nach dem 31.01.2002 ' +
            'verlegt wurden. Diese Leitung ist als älter angegeben; angesetzt ist die volle Dicke.',
        });
        return ergebnis(input, grunddicke, zeile.buchstabe, `${grundSatz}.`, grundNorm, notes);
      }
      return ergebnis(
        input,
        grunddicke / 2,
        'ff',
        `${grundSatz}; im Bauteil zwischen beheizten Räumen verschiedener Nutzer, nach dem 31.01.2002 verlegt, die ` +
          `Hälfte davon: ${de(grunddicke / 2)} mm.`,
        'GEG Anlage 8 Nr. 1 a) ff)',
        notes,
      );
    }

    // gg) — Fußbodenaufbau. Erste Falle: die 6 mm hängen an ff) und damit an
    // „verschiedene Nutzer". Ohne diese Voraussetzung ist eine Leitung im
    // Estrich eine ganz gewöhnliche Leitung nach aa–dd.
    case 'fussboden': {
      if (input.differentUsers === true && nach2002) {
        return ergebnis(
          input,
          6,
          'gg',
          `${grundSatz}; als Leitung nach ff) — zwischen beheizten Räumen verschiedener Nutzer, nach dem 31.01.2002 ` +
            'verlegt — im Fußbodenaufbau jedoch nur 6 mm.',
          'GEG Anlage 8 Nr. 1 a) gg)',
          notes,
        );
      }
      notes.push({
        severity: input.differentUsers === undefined ? 'warn' : 'info',
        text:
          'Die 6 mm nach GEG Anlage 8 Nr. 1 a) gg) gelten **nur** für Leitungen nach ff), also für ' +
          'Wärmeverteilungsleitungen zwischen beheizten Räumen verschiedener Nutzer, die nach dem 31.01.2002 verlegt ' +
          (input.differentUsers === undefined
            ? 'wurden. Ob das hier zutrifft, ist nicht angegeben; angesetzt ist die volle Dicke nach aa–dd.'
            : 'wurden. Das trifft hier nicht zu; für diese Leitung im Fußbodenaufbau gilt die volle Dicke nach aa–dd.'),
      });
      if (input.differentUsers === false && input.adjustableEmission !== true) {
        notes.push({
          severity: 'info',
          text:
            'Liegt der Fußbodenaufbau zwischen beheizten Räumen desselben Nutzers und ist die Wärmeabgabe durch frei ' +
            'liegende Absperreinrichtungen beeinflussbar, kann GEG Anlage 8 Nr. 1 b) die Leitung ganz von der ' +
            'Dämmpflicht freistellen. Beides kann das Programm aus der Geometrie nicht ableiten.',
        });
      }
      return ergebnis(input, grunddicke, zeile.buchstabe, `${grundSatz}.`, grundNorm, notes);
    }

    // Zweite Falle: für unbeheizte Räume gibt es keine Ermäßigung. Der Fall,
    // in dem die Dämmung am meisten bringt, ist zugleich der, in dem am
    // häufigsten halbiert wird — es gibt dafür keine Grundlage.
    case 'unbeheizt':
      notes.push({
        severity: 'info',
        text:
          'In unbeheizten Räumen kennt GEG Anlage 8 keine Ermäßigung — es gilt die volle Dicke nach aa–dd. Im Bestand ' +
          'kommt § 69 Abs. 2 hinzu: zugängliche Wärmeverteilungs- und Warmwasserleitungen in unbeheizten Räumen sind ' +
          'nachträglich zu dämmen.',
      });
      return ergebnis(input, grunddicke, zeile.buchstabe, `${grundSatz}.`, grundNorm, notes);

    case 'beheizt':
      return ergebnis(input, grunddicke, zeile.buchstabe, `${grundSatz}.`, grundNorm, notes);
  }
}

/**
 * Dieselbe Rechnung, aber mit einer Dimension aus der Werkstofftabelle.
 *
 * Der Weg über `PipeDimension` schließt den häufigsten Anwendungsfehler aus:
 * Anlage 8 stellt auf den lichten Innendurchmesser ab, und wer stattdessen die
 * Nennweite oder den Außendurchmesser einsetzt, landet bei einem Kupferrohr
 * 28 × 1,5 (innen 25 mm) in Zeile bb) statt in aa) — 30 mm statt 20 mm — oder
 * umgekehrt zu niedrig. Hier werden beide Maße aus derselben Zeile gezogen.
 */
export function insulationForDimension(
  dimension: PipeDimension,
  input: Omit<InsulationInput, 'innerDiameter' | 'outerDiameter'>,
): InsulationResult {
  return insulationThickness({ ...input, innerDiameter: dimension.inner, outerDiameter: dimension.outer });
}
