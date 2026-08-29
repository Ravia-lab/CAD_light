/**
 * Prüfblock „Rohrdämmung" — GEG Anlage 8 in `src/lib/pipeInsulation.ts`.
 *
 * **Warum dieser Block anders gebaut ist als die Geometrieprüfungen.** Hier
 * gibt es nichts zu rechnen, was schiefgehen könnte: die Zahlen der Anlage 8
 * stehen im Gesetz. Falsch wird so ein Modul nicht durch einen Rechenfehler,
 * sondern durch eine **falsch gezogene Grenze** — eine Zeile, die einen
 * Millimeter zu früh umschlägt, oder eine Ermäßigung, die für einen Fall
 * gewährt wird, den das Gesetz nicht meint. Beides sieht im Bericht plausibel
 * aus und kostet den Bauherrn entweder Geld oder den Nachweis.
 *
 * Deshalb prüft dieser Block drei Dinge, und zwar getrennt:
 *
 *  1. **Die Grenzen der Grundtabelle**, jeweils beidseitig: 22/23, 35/36,
 *     100/101 mm. Ein „<" statt „≤" fällt nur genau dort auf.
 *  2. **Jede der sechs Abweichungen einzeln** — ee, ff, gg, hh, 1 b, 1 c.
 *     Eine Abweichung, die nie greift, und eine, die immer greift, sind
 *     derselbe Fehler mit verschiedenem Vorzeichen.
 *  3. **Die drei bekannten Fallen als Gegenproben.** Das ist der eigentliche
 *     Zweck dieses Blocks: nicht dass die Ermäßigung greift, sondern dass sie
 *     dort *nicht* greift, wo sie gern fälschlich gewährt wird.
 *
 * **Herleitung der Sollwerte.** Alle Werte stammen aus dem Gesetzestext
 * (Anlage 8 zu §§ 69, 70, https://www.gesetze-im-internet.de/geg/anlage_8.html)
 * und werden hier ausgerechnet, nicht abgeschrieben:
 *
 *  • aa) ≤ 22 mm → 20 mm. Bei 22 mm gilt noch aa, bei 23 mm schon bb.
 *  • bb) > 22 bis 35 mm → 30 mm. Bei 35 mm gilt noch bb, bei 36 mm schon cc.
 *  • cc) > 35 bis 100 mm → Dicke = Innendurchmesser. Bei 36 mm also 36 mm,
 *    bei 100 mm also 100 mm.
 *  • dd) > 100 mm → 100 mm. Bei 101 mm also 100 mm — derselbe Zahlenwert wie
 *    bei 100 mm aus cc), aber ein anderer Buchstabe. Genau deshalb wird hier
 *    nicht nur die Dicke geprüft, sondern auch `rule`: wäre die Grenze falsch
 *    gezogen, bliebe die Zahl an dieser Stelle unauffällig.
 *  • ee) ½ von aa bei 22 mm: 20/2 = 10 mm.
 *  • ff) ½ von bb bei 28 mm: 30/2 = 15 mm.
 *  • gg) fest 6 mm, unabhängig vom Durchmesser.
 *  • hh) 2 × aa bei 22 mm: 20·2 = 40 mm.
 *  • 1 b) und 1 c) → 0 mm, keine Anforderung.
 *  • Kälte (Nr. 2): ≤ 22 mm → 9 mm, > 22 mm → 19 mm.
 *
 * **Herleitung der λ-Umrechnung.** Gleichwertig ist der Wärmedurchlasswiderstand
 * der Zylinderschale, R = ln(D/d)/(2π·λ). Aus R_x = R_35 folgt
 * D_x = d · (D_35/d)^(λ_x/0,035). Für ein Kupferrohr 22 × 1 (d = 22 mm, innen
 * 20 mm → aa, s_35 = 20 mm) ist D_35 = 22 + 2·20 = 62 mm:
 *
 *   λ_x = 0,040 →  Exponent 0,040/0,035 = 8/7 = 1,142857
 *                  ln(62/22) = ln(31/11) = 3,4339872 − 2,3978953 = 1,0360919
 *                  1,0360919 · 8/7 = 1,1841051
 *                  D_x = 22 · e^1,1841051 = 22 · 3,2677607 = 71,89074 mm
 *                  s_x = (71,89074 − 22)/2 = 24,94537 mm → aufgerundet 25 mm
 *
 *   λ_x = 0,030 →  Exponent 6/7 = 0,857143
 *                  1,0360919 · 6/7 = 0,8880788
 *                  D_x = 22 · e^0,8880788 = 22 · 2,4304555 = 53,47002 mm
 *                  s_x = (53,47002 − 22)/2 = 15,73501 mm → aufgerundet 16 mm
 *
 *   Dasselbe Rohr im Durchbruch (ee, s_35 = 10 mm), λ_x = 0,040:
 *                  D_35 = 42 mm, ln(42/22) = ln(21/11) = 3,0445224 − 2,3978953
 *                       = 0,6466272; · 8/7 = 0,7390025
 *                  D_x = 22 · e^0,7390025 = 22 · 2,0938458 = 46,06461 mm
 *                  s_x = (46,06461 − 22)/2 = 12,03230 mm → aufgerundet 13 mm
 *
 * Aufgerundet wird, weil eine *Mindest*dicke nicht unterschritten werden darf;
 * 12,03 mm sind mit einer 12er-Schale nicht erfüllt. Die Prüfung hält beides
 * fest: den ungerundeten Zwischenwert (gegen die Handrechnung oben) und die
 * ausgegebene ganze Zahl (gegen die Aufrundung).
 *
 * **Was hier bewusst nicht geprüft wird.** Ob die Zylinderformel die vom
 * Gesetzgeber gemeinte ist, ist nicht belegt — Anlage 8 Nr. 3 nennt keine
 * Formel. Geprüft wird deshalb nicht, dass die Zahl „richtig" ist, sondern
 * dass sie der dokumentierten Formel folgt und dass die Rückgabe den Vorbehalt
 * mitführt. Das ist die einzige Zusicherung, die dieses Modul geben kann.
 */

import type { CheckFn } from './typ';
import type { PipeDimension } from '../../src/types/bim';
import {
  GEG_ANLAGE_8,
  GEG_ANLAGE_8_KAELTE,
  LAMBDA_BEZUG,
  insulationForDimension,
  insulationThickness,
  thicknessForLambda,
  type InsulationInput,
  type InsulationResult,
  type PlanningNote,
} from '../../src/lib/pipeInsulation';

// ---------------------------------------------------------------------------
// Hilfsmittel
// ---------------------------------------------------------------------------

/**
 * Ein Prüfrohr.
 *
 * Der Außendurchmesser wird mit 2 mm Wanddicke angesetzt, wo er keine Rolle
 * spielt — er geht ausschließlich in die λ-Umrechnung ein, und dort setzen die
 * Prüfungen ihn ausdrücklich selbst. Die Vorbelegung `heating-flow` /
 * `beheizt` ist der Regelfall; jede Prüfung überschreibt genau das, worum es
 * ihr geht.
 */
function rohr(innen: number, abweichend: Partial<InsulationInput> = {}): InsulationInput {
  return {
    innerDiameter: innen,
    outerDiameter: innen + 4,
    surrounding: 'beheizt',
    service: 'heating-flow',
    ...abweichend,
  };
}

/** Trägt einer der Hinweise diesen Textbaustein? */
function hinweis(res: InsulationResult, teil: string): boolean {
  return res.notes.some((n) => n.text.includes(teil));
}

/** Gibt es einen Hinweis dieses Gewichts? */
function gewicht(res: InsulationResult, severity: PlanningNote['severity']): boolean {
  return res.notes.some((n) => n.severity === severity);
}

export function pruefeRohrdaemmung(check: CheckFn): void {
  // === 1 — Die Tabelle als Daten ==========================================
  // Sie wird angezeigt und geprüft; wenn sie kippt, kippt alles Weitere mit.
  check('Anlage 8 Nr. 1 a) hat vier Zeilen', GEG_ANLAGE_8.length, 4);
  check('… aa) reicht bis 22 mm', GEG_ANLAGE_8[0].bis, 22);
  check('… und fordert 20 mm', GEG_ANLAGE_8[0].dicke, 20);
  check('… bb) reicht bis 35 mm', GEG_ANLAGE_8[1].bis, 35);
  check('… und fordert 30 mm', GEG_ANLAGE_8[1].dicke, 30);
  check('… cc) reicht bis 100 mm', GEG_ANLAGE_8[2].bis, 100);
  check('… und fordert den Innendurchmesser', GEG_ANLAGE_8[2].dicke, 'innendurchmesser');
  check('… dd) ist nach oben offen', GEG_ANLAGE_8[3].bis === Number.POSITIVE_INFINITY, true);
  check('… und deckelt bei 100 mm', GEG_ANLAGE_8[3].dicke, 100);
  check('Die Kältetabelle nach Nr. 2 hat zwei Zeilen', GEG_ANLAGE_8_KAELTE.length, 2);
  check('Die Bezugswärmeleitfähigkeit ist 0,035 W/(m·K)', LAMBDA_BEZUG, 0.035);

  // === 2 — Die Grundtabelle an ihren Grenzen ==============================
  // Beidseitig, weil ein „<" statt „≤" nur genau am Grenzwert auffällt.
  const bei22 = insulationThickness(rohr(22));
  check('22 mm innen → 20 mm (aa)', bei22.thickness, 20);
  check('… und zwar nach aa)', bei22.rule, 'aa');
  const bei23 = insulationThickness(rohr(23));
  check('23 mm innen → 30 mm (bb)', bei23.thickness, 30);
  check('… und zwar nach bb)', bei23.rule, 'bb');
  const bei35 = insulationThickness(rohr(35));
  check('35 mm innen → noch 30 mm', bei35.thickness, 30);
  check('… und zwar nach bb)', bei35.rule, 'bb');
  const bei36 = insulationThickness(rohr(36));
  check('36 mm innen → 36 mm (Dicke = Innendurchmesser)', bei36.thickness, 36);
  check('… und zwar nach cc)', bei36.rule, 'cc');
  const bei100 = insulationThickness(rohr(100));
  check('100 mm innen → 100 mm', bei100.thickness, 100);
  check('… und noch nach cc)', bei100.rule, 'cc');
  const bei101 = insulationThickness(rohr(101));
  check('101 mm innen → 100 mm (gedeckelt)', bei101.thickness, 100);
  check('… und zwar nach dd)', bei101.rule, 'dd');
  // 100 und 101 mm liefern dieselbe Zahl aus verschiedenen Zeilen. Wäre die
  // Grenze falsch gezogen, bliebe das ohne die Buchstabenprüfung unsichtbar.
  check('Bei 100 und 101 mm ist die Dicke gleich …', bei100.thickness, bei101.thickness);
  check('… aber die Regel eine andere', bei100.rule === bei101.rule, false);
  check('Jede Entscheidung trägt eine Fundstelle', bei36.norm.includes('Anlage 8'), true);
  check('… und eine lesbare Begründung', bei36.reason.length > 40, true);

  // === 3 — Die sechs Abweichungen, jede für sich ==========================

  // ee) Durchbruch, Kreuzung, Verbindungsstelle, zentraler Verteiler: ½ von
  // aa bei 22 mm, also 20/2 = 10 mm.
  const ee = insulationThickness(rohr(22, { surrounding: 'durchbruch' }));
  check('ee) im Durchbruch die halbe Dicke', ee.thickness, 10);
  check('… nach Buchstabe ee)', ee.rule, 'ee');
  check('… bezogen auf die volle Dicke von 20 mm', ee.baseThickness, 10);

  // ff) Bauteil zwischen beheizten Räumen verschiedener Nutzer: ½ von bb bei
  // 28 mm, also 30/2 = 15 mm.
  const ff = insulationThickness(rohr(28, { surrounding: 'zwischen-nutzern', differentUsers: true }));
  check('ff) zwischen verschiedenen Nutzern die halbe Dicke', ff.thickness, 15);
  check('… nach Buchstabe ff)', ff.rule, 'ff');
  check('… mit dem Verlegedatum in der Begründung', ff.reason.includes('31.01.2002'), true);
  // Vor dem 31.01.2002 verlegt: der Buchstabe nennt das Datum ausdrücklich,
  // also gibt es für die alte Leitung keine Halbierung.
  const ffAlt = insulationThickness(
    rohr(28, { surrounding: 'zwischen-nutzern', differentUsers: true, installedAfter2002: false }),
  );
  check('… vor Februar 2002 verlegt aber nicht', ffAlt.thickness, 30);
  check('… sondern nach der Grundtabelle', ffAlt.rule, 'bb');

  // gg) Leitung nach ff) im Fußbodenaufbau: fest 6 mm.
  const gg = insulationThickness(rohr(28, { surrounding: 'fussboden', differentUsers: true }));
  check('gg) Leitung nach ff) im Fußbodenaufbau → 6 mm', gg.thickness, 6);
  check('… nach Buchstabe gg)', gg.rule, 'gg');
  const ggGross = insulationThickness(rohr(60, { surrounding: 'fussboden', differentUsers: true }));
  check('… unabhängig vom Durchmesser', ggGross.thickness, 6);

  // hh) an Außenluft grenzend, Fälle des § 69 Abs. 1: 2 × aa bei 22 mm = 40 mm.
  const hh = insulationThickness(rohr(22, { surrounding: 'aussenluft', newInstallation: true }));
  check('hh) an Außenluft die doppelte Dicke', hh.thickness, 40);
  check('… nach Buchstabe hh)', hh.rule, 'hh');
  // Im Bestand (§ 69 Abs. 2) knüpft hh) nicht an — dort bleibt es bei aa–dd.
  const hhBestand = insulationThickness(rohr(22, { surrounding: 'aussenluft', newInstallation: false }));
  check('… im Bestand aber nicht verdoppelt', hhBestand.thickness, 20);
  check('… sondern nach der Grundtabelle', hhBestand.rule, 'aa');
  check('… mit Hinweis auf § 69 Abs. 1', hinweis(hhBestand, '§ 69 Abs. 1'), true);

  // 1 b) beheizter Raum und frei liegende Absperreinrichtungen: keine Pflicht.
  const einsB = insulationThickness(rohr(22, { adjustableEmission: true }));
  check('1 b) im beheizten Raum mit Absperreinrichtung → keine Pflicht', einsB.thickness, 0);
  check('… nach Nummer 1 b)', einsB.rule, '1b');
  check('… und ohne Restdicke im Grundwert', einsB.baseThickness, 0);
  // Ohne die Absperreinrichtung ist derselbe Raum ein ganz normaler Fall.
  const einsBOhne = insulationThickness(rohr(22, { adjustableEmission: false }));
  check('… ohne Absperreinrichtung volle Dicke', einsBOhne.thickness, 20);
  check('… nach der Grundtabelle', einsBOhne.rule, 'aa');

  // 1 c) Warmwasser-Stichleitung bis 3 l Inhalt im beheizten Raum.
  const einsC = insulationThickness(
    rohr(16, { service: 'hot-water', stubLine: true, stubVolume: 2.5 }),
  );
  check('1 c) Stichleitung mit 2,5 l → keine Pflicht', einsC.thickness, 0);
  check('… nach Nummer 1 c)', einsC.rule, '1c');
  // Über 3 l endet die Befreiung — das ist die Grenze des Buchstabens.
  const einsCGross = insulationThickness(
    rohr(16, { service: 'hot-water', stubLine: true, stubVolume: 3.4 }),
  );
  check('… mit 3,4 l dagegen volle Dicke', einsCGross.thickness, 20);
  check('… und ein Hinweis auf die 3-l-Grenze', hinweis(einsCGross, '3 l'), true);
  // Eine Zirkulationsleitung ist nie eine Stichleitung ohne Zirkulation.
  const zirkulation = insulationThickness(
    rohr(16, { service: 'circulation', stubLine: true, stubVolume: 1 }),
  );
  check('… eine Zirkulationsleitung wird nicht befreit', zirkulation.thickness, 20);
  check('… sondern nach aa) gedämmt', zirkulation.rule, 'aa');
  // Im unbeheizten Raum greift 1 c) nicht — der Buchstabe verlangt beheizte Räume.
  const stichKalt = insulationThickness(
    rohr(16, { service: 'hot-water', stubLine: true, stubVolume: 1, surrounding: 'unbeheizt' }),
  );
  check('… im unbeheizten Raum greift 1 c) nicht', stichKalt.thickness, 20);

  // === 4 — Die drei Fallen, ausdrücklich als Gegenproben ==================

  // Falle 1: „Rohr im Fußboden → 6 mm". Die 6 mm hängen an ff) und damit an
  // „verschiedene Nutzer". Eine Anbindeleitung im Estrich eines Einfamilien-
  // hauses ist keine solche Leitung: 28 mm innen → bb → 30 mm, nicht 6 mm.
  const falle1 = insulationThickness(rohr(28, { surrounding: 'fussboden', differentUsers: false }));
  check('Falle 1: Fußboden bei einem Nutzer sind nicht 6 mm', falle1.thickness, 30);
  check('… sondern die volle Dicke nach bb)', falle1.rule, 'bb');
  check('… und der Grund steht im Hinweis', hinweis(falle1, 'gelten **nur** für Leitungen nach ff)'), true);
  const falle1Offen = insulationThickness(rohr(28, { surrounding: 'fussboden' }));
  check('… ohne Angabe zu den Nutzern ebenfalls volle Dicke', falle1Offen.thickness, 30);
  check('… und das wird als Lücke gemeldet', gewicht(falle1Offen, 'warn'), true);

  // Falle 2: „unbeheizter Raum → halbe Dicke". Es gibt dort keine Ermäßigung;
  // 28 mm innen → bb → 30 mm, und im Bestand kommt § 69 Abs. 2 hinzu.
  const falle2 = insulationThickness(rohr(28, { surrounding: 'unbeheizt' }));
  check('Falle 2: im unbeheizten Raum keine Ermäßigung', falle2.thickness, 30);
  check('… volle Dicke nach bb)', falle2.rule, 'bb');
  check('… und dieselbe Dicke wie im beheizten Raum', falle2.thickness, bei23.thickness);
  check('… mit Hinweis auf die Nachrüstpflicht', hinweis(falle2, '§ 69 Abs. 2'), true);
  const falle2Gross = insulationThickness(rohr(54, { surrounding: 'unbeheizt' }));
  check('… auch in der cc)-Zeile ungekürzt', falle2Gross.thickness, 54);

  // Falle 3: „zwischen beheizten Räumen → halbe Dicke". Nur bei verschiedenen
  // Nutzern. Beim selben Nutzer: volle Dicke — oder mit frei liegender
  // Absperreinrichtung sogar ganz frei nach 1 b).
  const falle3 = insulationThickness(
    rohr(28, { surrounding: 'zwischen-nutzern', differentUsers: false, adjustableEmission: false }),
  );
  check('Falle 3: derselbe Nutzer wird nicht halbiert', falle3.thickness, 30);
  check('… sondern voll gedämmt nach bb)', falle3.rule, 'bb');
  check('… mit Hinweis auf die mögliche Freistellung', hinweis(falle3, 'Nr. 1 b)'), true);
  const falle3Frei = insulationThickness(
    rohr(28, { surrounding: 'zwischen-nutzern', differentUsers: false, adjustableEmission: true }),
  );
  check('… mit Absperreinrichtung dagegen ganz frei', falle3Frei.thickness, 0);
  check('… und zwar nach 1 b), nicht nach ff)', falle3Frei.rule, '1b');
  check('… drei Wege aus derselben Lage: 15, 30 und 0 mm', `${ff.thickness}/${falle3.thickness}/${falle3Frei.thickness}`, '15/30/0');

  // === 5 — Fehlende Angaben: sichere Seite und Meldung ====================

  const ohneNutzer = insulationThickness(rohr(28, { surrounding: 'zwischen-nutzern' }));
  check('Ohne Angabe zu den Nutzern volle Dicke', ohneNutzer.thickness, 30);
  check('… nach der Grundtabelle', ohneNutzer.rule, 'bb');
  check('… und mit Warnung', gewicht(ohneNutzer, 'warn'), true);
  check('… die die fehlende Angabe benennt', hinweis(ohneNutzer, 'verschiedener'), true);

  const ohneEinbau = insulationThickness(rohr(22, { surrounding: 'aussenluft' }));
  check('Ohne Angabe zu Neubau/Bestand gilt die schärfere Regel', ohneEinbau.thickness, 40);
  check('… also hh)', ohneEinbau.rule, 'hh');
  check('… und der Vorbehalt steht im Hinweis', hinweis(ohneEinbau, 'schärfere Anforderung'), true);

  const ohneInhalt = insulationThickness(rohr(16, { service: 'hot-water', stubLine: true }));
  check('Stichleitung ohne Inhaltsangabe wird gedämmt', ohneInhalt.thickness, 20);
  check('… und die Lücke gemeldet', gewicht(ohneInhalt, 'warn'), true);

  const ohneAbsperr = insulationThickness(rohr(22));
  check('Ohne Angabe zur Absperreinrichtung volle Dicke', ohneAbsperr.thickness, 20);
  check('… mit Hinweis auf 1 b)', hinweis(ohneAbsperr, 'Nr. 1 b)'), true);

  const ohneDurchmesser = insulationThickness(rohr(0));
  check('Ohne Innendurchmesser wird nichts behauptet', ohneDurchmesser.rule, 'unbekannt');
  check('… und der Fehler ist als solcher gemeldet', gewicht(ohneDurchmesser, 'error'), true);

  // === 6 — λ-Umrechnung nach Nummer 3 =====================================
  // Kupfer 22 × 1: d = 22 mm, innen 20 mm → aa, s_35 = 20 mm. Die Sollwerte
  // sind oben im Kopf von Hand ausgerechnet.
  const kupfer22 = (lambda: number, rest: Partial<InsulationInput> = {}): InsulationResult =>
    insulationThickness({
      innerDiameter: 20,
      outerDiameter: 22,
      surrounding: 'beheizt',
      service: 'heating-flow',
      lambda,
      ...rest,
    });

  check('Der ungerundete Zwischenwert bei λ = 0,040', thicknessForLambda(22, 20, 0.04), 24.94537, 0.0005);
  const lam040 = kupfer22(0.04);
  check('λ = 0,040 → 25 mm statt 20 mm', lam040.thickness, 25);
  check('… der Grundwert bleibt der Gesetzeswert', lam040.baseThickness, 20);
  check('… die Regel bleibt aa)', lam040.rule, 'aa');
  check('… die Fundstelle nennt Nummer 3', lam040.norm.includes('Nr. 3'), true);
  check('… und die Umrechnung trägt den Vorbehalt', hinweis(lam040, 'Formel nicht normativ zitierbar'), true);
  check('… mit Nennung der in Frage kommenden Normen', hinweis(lam040, 'DIN EN ISO 12241'), true);

  check('Der ungerundete Zwischenwert bei λ = 0,030', thicknessForLambda(22, 20, 0.03), 15.73501, 0.0005);
  const lam030 = kupfer22(0.03);
  check('λ = 0,030 → 16 mm statt 20 mm', lam030.thickness, 16);

  // Die Umrechnung setzt hinter der Regelfindung an: erst ee) halbieren,
  // dann umrechnen. 10 mm bei d = 22 mm ergeben 12,0323 mm → 13 mm.
  check('Der ungerundete Zwischenwert für ee) bei λ = 0,040', thicknessForLambda(22, 10, 0.04), 12.03230, 0.0005);
  const eeUmgerechnet = kupfer22(0.04, { surrounding: 'durchbruch' });
  check('ee) und λ = 0,040 zusammen → 13 mm', eeUmgerechnet.thickness, 13);
  check('… die Halbierung bleibt im Grundwert sichtbar', eeUmgerechnet.baseThickness, 10);
  check('… und die Regel bleibt ee)', eeUmgerechnet.rule, 'ee');

  // Bei λ = 0,035 wird nicht gerechnet und deshalb auch nichts vorbehalten.
  const lam035 = kupfer22(0.035);
  check('λ = 0,035 lässt die Dicke unverändert', lam035.thickness, 20);
  check('… und erzeugt keinen Umrechnungsvorbehalt', hinweis(lam035, 'Formel nicht normativ zitierbar'), false);

  // Umrechnung ohne Rohraußendurchmesser ist nicht möglich — die Zahl bleibt
  // die des Gesetzes, und die Lücke wird gemeldet statt überspielt.
  const ohneAussen = insulationThickness({
    innerDiameter: 20,
    outerDiameter: 0,
    surrounding: 'beheizt',
    service: 'heating-flow',
    lambda: 0.04,
  });
  check('Ohne Außendurchmesser wird nicht umgerechnet', ohneAussen.thickness, 20);
  check('… und die fehlende Angabe gemeldet', hinweis(ohneAussen, 'fehlt der Rohraußendurchmesser'), true);

  // Die Formel selbst: ein λ genau am Bezugswert muss die Dicke reproduzieren.
  check('Die Umrechnung ist bei λ = 0,035 die Identität', thicknessForLambda(22, 20, 0.035), 20, 1e-9);
  check('Ein größeres λ verlangt mehr Dämmung', thicknessForLambda(22, 20, 0.045) > 20, true);
  check('Ein kleineres λ verlangt weniger', thicknessForLambda(22, 20, 0.025) < 20, true);

  // === 7 — Kälteleitungen nach Nummer 2 ===================================
  const kaelte = (innen: number, rest: Partial<InsulationInput> = {}): InsulationResult =>
    insulationThickness(rohr(innen, { service: 'refrigerant', ...rest }));

  const kalt22 = kaelte(22);
  check('Kälteleitung 22 mm innen → 9 mm', kalt22.thickness, 9);
  check('… nach Nummer 2', kalt22.rule, 'kaelte');
  check('… mit Fundstelle § 70', kalt22.norm.includes('§ 70'), true);
  check('… und dem Bezug auf 10 °C', hinweis(kalt22, '10 °C'), true);
  const kalt23 = kaelte(23);
  check('Kälteleitung 23 mm innen → 19 mm', kalt23.thickness, 19);
  // Die Abweichungen aa–hh stehen unter Nummer 1 und gelten hier nicht.
  const kaltDurchbruch = kaelte(22, { surrounding: 'durchbruch' });
  check('Im Durchbruch wird eine Kälteleitung nicht halbiert', kaltDurchbruch.thickness, 9);
  check('… die Regel bleibt die der Nummer 2', kaltDurchbruch.rule, 'kaelte');
  const kaltAussen = kaelte(22, { surrounding: 'aussenluft', newInstallation: true });
  check('An Außenluft wird eine Kälteleitung nicht verdoppelt', kaltAussen.thickness, 9);
  const kaltBoden = kaelte(22, { surrounding: 'fussboden', differentUsers: true });
  check('Im Fußbodenaufbau gelten für sie keine 6 mm', kaltBoden.thickness, 9);

  // === 8 — Leitungsarten außerhalb der Anlage 8 ===========================
  // Hier eine Zahl auszugeben wäre schlimmer als keine: sie sähe aus wie eine
  // Anforderung des GEG und wäre keine.
  for (const [art, name] of [
    ['cold-water', 'Trinkwasser kalt'],
    ['waste', 'Abwasser'],
    ['ventilation-supply', 'Zuluft'],
  ] as const) {
    const res = insulationThickness(rohr(28, { service: art }));
    check(`${name} fällt nicht unter Anlage 8`, res.rule, 'ausserhalb');
    check(`… und bekommt keine Dicke zugewiesen`, res.thickness, 0);
    check(`… sondern eine Warnung`, gewicht(res, 'warn'), true);
  }
  const kaltwasser = insulationThickness(rohr(28, { service: 'cold-water' }));
  check('Für Trinkwasser kalt wird auf DIN 1988-200 verwiesen', hinweis(kaltwasser, 'DIN 1988-200'), true);

  // === 9 — Öffnungsklausel Nummer 4 =======================================
  // Sie setzt hinter der Regelfindung an: der Grundwert bleibt stehen, damit
  // im Bericht sichtbar ist, wovon abgewichen wurde.
  const nr4 = insulationThickness(
    rohr(28, { provenEquivalent: { thickness: 13, proof: 'abZ Z-00.0-000, asymmetrische Dämmhülse' } }),
  );
  check('Nr. 4 lässt die nachgewiesene Dicke zu', nr4.thickness, 13);
  check('… der Grundwert nach Nr. 1 bleibt erhalten', nr4.baseThickness, 30);
  check('… die Regel wird als Nummer 4 geführt', nr4.rule, '4');
  check('… der Nachweis steht in der Begründung', nr4.reason.includes('abZ Z-00.0-000'), true);
  check('… und wird als ungeprüft gekennzeichnet', hinweis(nr4, 'prüft die Gleichwertigkeit nicht'), true);
  // Wo es keine Anforderung gibt, gibt es auch nichts zu unterschreiten.
  const nr4Frei = insulationThickness(
    rohr(28, { adjustableEmission: true, provenEquivalent: { thickness: 13, proof: 'abZ' } }),
  );
  check('Ohne Anforderung greift Nr. 4 nicht', nr4Frei.rule, '1b');
  check('… und die Dicke bleibt null', nr4Frei.thickness, 0);

  // === 10 — Der Weg über die Werkstofftabelle =============================
  // Das ist der praktische Zweck: Anlage 8 stellt auf den lichten Innen-
  // durchmesser ab, nicht auf die Nennweite. Stahl DN 50 (60,3 × 3,65) hat
  // 53,0 mm lichte Weite und fällt damit in cc) — die Mindestdicke ist der
  // Innendurchmesser, also 53 mm und nicht die Nennweite 50 mm.
  const dn50: PipeDimension = {
    material: 'stahl',
    label: 'DN 50 (60,3 × 3,65)',
    outer: 60.3,
    wall: 3.65,
    inner: 53,
    dn: 50,
    content: 2.2058,
  };
  const stahl = insulationForDimension(dn50, { surrounding: 'unbeheizt', service: 'heating-flow' });
  check('DN 50 wird über den Innendurchmesser gerechnet', stahl.thickness, 53);
  check('… nach cc)', stahl.rule, 'cc');
  check('… und gerade nicht über die Nennweite', stahl.thickness === dn50.dn, false);
  check('… der Innendurchmesser steht in der Begründung', stahl.reason.includes('53,0 mm'), true);
}
