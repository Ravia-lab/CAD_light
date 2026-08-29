/**
 * Prüfblock für die Projektmappe.
 * ---------------------------------------------------------------------------
 * Die Mappe rechnet nichts. Sie setzt vier vorhandene Druckwege zusammen —
 * und genau dabei kann etwas schiefgehen, das keine Formel bemerkt. Geprüft
 * werden deshalb die Zusagen, die das Modul in seinem Kopfkommentar macht:
 *
 *  • **Zusammensetzen statt nachbauen.** Die Blätter, die von `planPrint`,
 *    `schematicPrint` und `pipeReportPrint` kommen, müssen im Dokument
 *    unverändert wiederzufinden sein. Wäre eines davon nachgebaut, stünde im
 *    Dokument ein anderes SVG als das, was der Bauer liefert — der Fehler,
 *    den dieses Projekt schon dreimal gemacht hat und der immer erst auffiel,
 *    als ein Ausdruck anders aussah als der Bildschirm.
 *  • **Die Blattnummerierung ist die eine Zahl, die die vier Einzelwege nicht
 *    kannten.** Sie muss lückenlos sein, bei 1 beginnen, jedes Blatt genau
 *    einmal treffen, und das Inhaltsverzeichnis muss dieselben Nummern nennen
 *    wie die Blätter selbst.
 *  • **Ein Blattformat für die ganze Mappe.** Ein Zeichnungsblatt, das größer
 *    ist als die `@page`-Regel, wird beim Drucken abgeschnitten, und zwar
 *    lautlos.
 *  • **Ehrlichkeit.** Ein Kapitel ohne Inhalt bleibt stehen und nennt den
 *    Grund; das Deckblatt sagt, was die Mappe ist und was nicht; der
 *    Nachweiskatalog sagt bei jeder Pflichtangabe „liegt vor" oder „fehlt".
 *  • **Der fremde Stil bleibt eingesperrt.** Das Anlagenbuch bringt sein
 *    eigenes Stilblatt mit, darunter eine `@page`-Regel für A4 hoch. Kommt
 *    sie mit ins Dokument, entscheidet die Reihenfolge im Stilblatt darüber,
 *    ob eine Zeichnung abgeschnitten wird.
 *
 * Sollwerte stammen aus dem Modul selbst (Kapitelfolge, Zahl der
 * Pflichtangaben) und aus dem Referenzhaus (drei Geschosse mit Wänden, vier
 * Heizflächen). Wo sich kein Sollwert herleiten lässt, wird eine Eigenschaft
 * geprüft: Lückenlosigkeit, Enthaltensein, An- und Abwesenheit eines
 * Textbausteins.
 */

import type { CheckFn } from './typ';
import type { BimDocument } from '../../src/types/bim';
import {
  blattBereich,
  buildProjektMappe,
  skopiereStil,
  type MappeKapitelId,
} from '../../src/lib/projektMappe';
import { buildPipeReport } from '../../src/lib/pipeReport';
import { buildPipeReportSheets } from '../../src/lib/pipeReportPrint';
import { buildPlanSvg } from '../../src/lib/planPrint';
import { buildSchematicSvg } from '../../src/lib/schematicPrint';
import { buildSchematic, designPlant } from '../../src/lib/plantDesign';
import { buildReferenceDocument } from '../reference';

// ---------------------------------------------------------------------------
// Werkzeug
// ---------------------------------------------------------------------------

const ENTITAETEN: Record<string, string> = {
  '&lt;': '<',
  '&gt;': '>',
  '&amp;': '&',
  '&quot;': '"',
  '&#39;': "'",
};

/** Markup entfernen — das, was der Leser sieht. */
function nurText(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&lt;|&gt;|&amp;|&quot;|&#39;/g, (e) => ENTITAETEN[e])
    .replace(/\s+/g, ' ')
    .trim();
}

/** Ein Blatt aus dem Dokument herausschneiden, Rahmen inbegriffen. */
function blattHtml(html: string, nr: number): string {
  const auf = html.indexOf(`id="blatt-${nr}"`);
  if (auf < 0) return '';
  const start = html.lastIndexOf('<section', auf);
  const ende = html.indexOf('<section class="blatt', auf);
  return ende < 0 ? html.slice(start) : html.slice(start, ende);
}

/** Das Stilblatt des Dokuments. */
function stil(html: string): string {
  return /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? '';
}

/** Die Kapitelfolge, wie das Modul sie festlegt. */
const KAPITELFOLGE: readonly MappeKapitelId[] = [
  'deckblatt',
  'inhalt',
  'grundriss',
  'schema',
  'rohrnetz',
  'einstellwerte',
  'pumpe',
  'massenauszug',
  'anlagenbuch',
  'quellen',
  'nachweis',
];

/**
 * Das Referenzhaus mit erzeugtem Anlagenschema.
 *
 * Das Schema steht im Modell und nicht in der Auslegung — die Mappe druckt
 * bewusst nur, was jemand angesehen hat. Für den Prüflauf wird es deshalb
 * hier erzeugt und ins Dokument gelegt, genau wie es das Anlagenblatt tut.
 */
function mitSchema(doc: BimDocument): BimDocument {
  const { components, links } = buildSchematic(designPlant(doc));
  return {
    ...doc,
    plant: {
      ...doc.plant!,
      schematic: {
        components: Object.fromEntries(components.map((c) => [c.id, c])),
        links: Object.fromEntries(links.map((l) => [l.id, l])),
        manual: false,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Prüfungen
// ---------------------------------------------------------------------------

export function pruefeProjektmappe(check: CheckFn): void {
  const roh = buildReferenceDocument();
  const doc = mitSchema(roh);
  const bericht = buildPipeReport(doc);
  const mappe = buildProjektMappe(doc, {
    datum: '01.01.2026',
    bearbeiter: 'Prüflauf',
    anlagenName: 'Wärmepumpenanlage Haus 1',
    programmstand: 'Prüfstand',
    bericht,
  });

  // --- Blattbereich als Zeichenkette --------------------------------------
  // Sie steht im Inhaltsverzeichnis und ist die einzige reine Rechnung dieses
  // Moduls — zusammenhängende Läufe verschmelzen, Lücken bleiben stehen.
  check('Blattbereich: leere Liste', blattBereich([]), '—');
  check('Blattbereich: ein Blatt', blattBereich([7]), '7');
  check('Blattbereich: zusammenhängender Lauf', blattBereich([7, 8, 9]), '7–9');
  check('Blattbereich: Lauf mit Lücke', blattBereich([7, 8, 9, 11]), '7–9, 11');
  check('Blattbereich: unsortierte Eingabe', blattBereich([11, 8, 7, 9]), '7–9, 11');
  check('Blattbereich: zwei getrennte Läufe', blattBereich([1, 2, 5, 6, 9]), '1–2, 5–6, 9');

  // --- Kapitelgerüst -------------------------------------------------------
  check('Die Mappe hat elf Kapitel', mappe.kapitel.length, 11);
  check(
    'Kapitel stehen in der festgelegten Reihenfolge',
    mappe.kapitel.map((k) => k.id).join(','),
    KAPITELFOLGE.join(','),
  );
  check('Die Kapitelnummern laufen lückenlos', mappe.kapitel.every((k, i) => k.nummer === i + 1), true);
  check('Jedes Kapitel belegt mindestens ein Blatt', mappe.kapitel.every((k) => k.blaetter.length > 0), true);
  check(
    'Der Blattbereich jedes Kapitels stimmt mit seinen Blattnummern überein',
    mappe.kapitel.every((k) => k.blattBereich === blattBereich(k.blaetter)),
    true,
  );

  // --- Blattnummerierung ---------------------------------------------------
  // Sie ist die eine Zahl, die den vier Einzeldruckwegen fehlte: jeder von
  // ihnen zählt seine eigenen Blätter ab 1.
  const nummern = mappe.blaetter.map((b) => b.nr);
  check('Die Blattnummern beginnen bei 1', nummern[0], 1);
  check('Die Blattnummern laufen lückenlos', nummern.every((n, i) => n === i + 1), true);
  check(
    'Jede Blattnummer steht genau einmal im Dokument',
    nummern.every((n) => (mappe.html.match(new RegExp(`id="blatt-${n}"`, 'g')) ?? []).length === 1),
    true,
  );
  check(
    'Es gibt so viele Abschnitte wie Blätter',
    (mappe.html.match(/<section class="blatt/g) ?? []).length,
    mappe.blaetter.length,
  );
  check('Deckblatt ist Blatt 1', mappe.blaetter[0].kapitel, 'deckblatt');
  check('Inhaltsverzeichnis ist Blatt 2', mappe.blaetter[1].kapitel, 'inhalt');
  check(
    'Jedes Blatt trägt seine Nummer sichtbar',
    mappe.blaetter.every((b) => blattHtml(mappe.html, b.nr).includes(`Blatt ${b.nr} von ${mappe.blaetter.length}`)),
    true,
  );
  // Die Zuordnung der Blätter zu den Kapiteln muss vollständig sein — ein
  // Blatt ohne Kapitel stünde in keinem Inhaltsverzeichnis.
  check(
    'Die Kapitel führen zusammen jedes Blatt genau einmal',
    mappe.kapitel.flatMap((k) => k.blaetter).sort((a, b) => a - b).join(','),
    nummern.join(','),
  );

  // --- Inhaltsverzeichnis --------------------------------------------------
  const inhalt = blattHtml(mappe.html, 2);
  const inhaltText = nurText(inhalt);
  check(
    'Das Inhaltsverzeichnis nennt jedes Kapitel',
    mappe.kapitel.every((k) => inhaltText.includes(k.titel)),
    true,
  );
  check(
    'Das Inhaltsverzeichnis nennt zu jedem Kapitel seinen Blattbereich',
    mappe.kapitel.every((k) => inhalt.includes(`>${k.blattBereich}</td>`)),
    true,
  );
  check('Das Inhaltsverzeichnis nennt die Blattzahl', inhaltText.includes(`${mappe.blaetter.length} Blätter`), true);

  // --- Zusammensetzen statt nachbauen --------------------------------------
  // Das eigentliche Versprechen dieses Moduls. Geprüft wird nicht, dass es
  // *ähnlich* aussieht, sondern dass genau das SVG im Dokument steht, das der
  // vorhandene Bauer liefert.
  const eg = Object.values(doc.levels).sort((a, b) => a.order - b.order)[0];
  const plan = buildPlanSvg(doc, {
    scale: mappe.planMassstab,
    format: 'A4',
    orientation: 'landscape',
    levelId: eg.id,
    showRoomLabels: true,
    showDimensions: false,
    showFixtures: true,
    showAnnotations: false,
    showInteriorDimensions: false,
    showLegend: true,
    showOpeningDimensions: false,
    title: `${bericht.titel} — Grundriss ${eg.name}`,
  });
  check('Der Grundriss steht unverändert aus buildPlanSvg in der Mappe', mappe.html.includes(plan.svg), true);

  const berichtsblaetter = buildPipeReportSheets(doc, bericht, {
    format: 'A4',
    orientation: 'landscape',
    grundriss: false,
  });
  check(
    'Alle Blätter aus buildPipeReportSheets stehen unverändert in der Mappe',
    berichtsblaetter.sheets.every((s) => mappe.html.includes(s)),
    true,
  );
  check(
    'Die Mappe druckt den Grundriss des Berichts nicht ein zweites Mal',
    mappe.blaetter.filter((b) => b.kapitel === 'grundriss').length,
    Object.values(doc.levels).filter((l) => Object.values(doc.walls).some((w) => w.levelId === l.id)).length,
  );

  const schema = buildSchematicSvg(
    Object.values(doc.plant!.schematic.components),
    Object.values(doc.plant!.schematic.links),
    {
      format: 'A4',
      orientation: 'landscape',
      projectName: doc.meta.name,
      plantName: 'Wärmepumpenanlage Haus 1',
      author: 'Prüflauf',
      date: '01.01.2026',
      scale: 'auto',
      showLegend: true,
      colour: false,
      componentTable: false,
    },
  );
  check('Das Anlagenschema kommt aus buildSchematicSvg', mappe.html.includes(schema.sheets[0]), true);
  check(
    'Das erzeugte Schema füllt sein Kapitel',
    mappe.kapitel.find((k) => k.id === 'schema')?.inhalt ?? false,
    true,
  );

  // --- Blattmaße und Druckseite --------------------------------------------
  // Ein Zeichnungsblatt, das größer ist als die `@page`-Regel, wird lautlos
  // abgeschnitten. Deshalb ist es keine Kosmetik, dass jedes SVG dieselbe
  // Millimeterangabe trägt wie die Seite.
  check('Die Mappe steht auf A4 quer', `${mappe.blattmass.w}×${mappe.blattmass.h}`, '297×210');
  check(
    'Die Druckseite hat genau die Blattmaße',
    mappe.html.includes(`@page{size:${mappe.blattmass.w}mm ${mappe.blattmass.h}mm;margin:0}`),
    true,
  );
  const zeichnungen = mappe.blaetter.filter((b) => b.art === 'zeichnung');
  check('Die Mappe enthält Zeichnungsblätter', zeichnungen.length > 0, true);
  check(
    'Jedes Zeichnungsblatt trägt genau die Blattmaße',
    zeichnungen.every((b) =>
      blattHtml(mappe.html, b.nr).includes(`width="${mappe.blattmass.w}mm" height="${mappe.blattmass.h}mm"`),
    ),
    true,
  );
  // Genau zwei Druckseitenregeln: die randlose Grundseite für die Zeichnungen
  // und die benannte Textseite. Eine dritte käme aus einem fremden Stilblatt.
  check('Es gibt genau zwei @page-Regeln', (mappe.html.match(/@page/g) ?? []).length, 2);

  // --- Der fremde Stil bleibt eingesperrt ----------------------------------
  const stilblatt = stil(mappe.html);
  check('Das Anlagenbuch bringt seinen Stil mit', stilblatt.includes('.anlagenbuch .kapitel{'), true);
  // Die Regeln des Anlagenbuchs stehen ausnahmslos hinter seinem Bereich.
  // Geprüft wird an der Regel, die es als einzige über die Blattaufteilung
  // trifft: unbeschränkt würde sie jedem Kapitel der Mappe einen Seitenumbruch
  // aufzwingen, den es nicht bestellt hat.
  check('Keine unbeschränkte Kapitelregel aus dem Anlagenbuch', /(^|\})\.kapitel\{/.test(stilblatt), false);
  // Das Anlagenbuch setzt A4 hoch mit 18 mm Rand. Käme diese Regel mit, würde
  // jede Zeichnung dieser Mappe beim Drucken beschnitten.
  check('Die Druckseite des Anlagenbuchs ist weg', stilblatt.includes('size:210mm 297mm'), false);
  check('Die Bildschirmregeln des Anlagenbuchs sind weg', stilblatt.includes('.anlagenbuch .buch{width:'), false);
  // Die Zerlegung selbst, an einem Fall, der die Klammerzählung austrickst:
  // eine geschweifte Klammer in einer Zeichenkette einer @page-Regel — genau
  // das passiert, wenn jemand sein Projekt „Haus {A}" nennt.
  const probe = '@page{margin:1mm;@top-left{content:"Haus }A"}}html,body{color:red}h2{margin:0}@media screen{p{color:blue}}';
  check(
    'skopiereStil wirft @page und @media weg',
    skopiereStil(probe, '.x'),
    '.x{color:red}.x h2{margin:0}',
  );
  check('skopiereStil bildet html und body auf den Bereich ab', skopiereStil('body{color:red}', '.x'), '.x{color:red}');
  check(
    'skopiereStil schränkt mehrteilige Selektoren einzeln ein',
    skopiereStil('h1,h2 .nr{margin:0}', '.x'),
    '.x h1,.x h2 .nr{margin:0}',
  );

  // --- Deckblatt -----------------------------------------------------------
  const deckblatt = nurText(blattHtml(mappe.html, 1));
  check('Das Deckblatt nennt den Programmstand', deckblatt.includes('Prüfstand'), true);
  check('Das Deckblatt nennt den Bearbeiter', deckblatt.includes('Prüflauf'), true);
  check('Das Deckblatt nennt das Datum', deckblatt.includes('01.01.2026'), true);
  check('Das Deckblatt trägt den Abschnitt über die Grenzen', deckblatt.includes('Was diese Mappe ist und was nicht'), true);
  check('Das Deckblatt nennt die Heizlast', deckblatt.includes(`${bericht.heizlast.wert.toFixed(1).replace('.', ',')} kW`), true);
  check(
    'Das Deckblatt sagt, dass die Heizlast ein Überschlag ist',
    deckblatt.includes('Überschlag dieses Programms'),
    true,
  );
  check(
    'Das Deckblatt nennt die Vorbemessung beim Namen',
    deckblatt.includes('Vorbemessung und kein Nachweis'),
    true,
  );
  check('Das Deckblatt grenzt die Ausführungsplanung aus', deckblatt.includes('Ausführungsplanung'), true);

  // --- Nachweiskatalog -----------------------------------------------------
  const nachweis = blattHtml(mappe.html, mappe.kapitel[10].blaetter[0]);
  const nachweisText = nurText(nachweis);
  check('Der Nachweiskatalog steht auf dem letzten Blatt', mappe.kapitel[10].blaetter[0], mappe.blaetter.length);
  check(
    'Er führt alle sieben Pflichtangaben',
    bericht.nachweis.every((n) => nachweisText.includes(n.forderung)),
    true,
  );
  check(
    'Jede Angabe trägt „liegt vor" oder „fehlt, weil …"',
    (nachweis.match(/liegt vor|fehlt, weil …/g) ?? []).length,
    bericht.nachweis.length,
  );
  check(
    'Die Zahl der offenen Angaben stimmt mit dem Bericht überein',
    (nachweis.match(/fehlt, weil …/g) ?? []).length,
    bericht.nachweis.filter((n) => !n.erfuellt).length,
  );
  check('Der Katalog zitiert § 60c Abs. 4 GModG', nachweisText.includes('§ 60c Abs. 4 GModG'), true);

  // --- Erzeugerbilanz ------------------------------------------------------
  const pumpe = blattHtml(mappe.html, mappe.kapitel[6].blaetter[0]);
  const pumpeText = nurText(pumpe);
  check('Das Referenzhaus hat Posten im Erzeugerkreis', bericht.erzeuger.posten.length > 0, true);
  check(
    'Jeder Posten des Erzeugerkreises steht auf dem Pumpenblatt',
    bericht.erzeuger.posten.every((posten) => pumpeText.includes(posten.label)),
    true,
  );
  check(
    'Jeder Posten nennt seine Quelle',
    bericht.erzeuger.posten.every((posten) => pumpeText.includes(posten.quelle)),
    true,
  );
  check(
    'Jeder Posten nennt seine Grundlage',
    bericht.erzeuger.posten.every((posten) => pumpeText.includes(posten.grundlage)),
    true,
  );
  check('Das Pumpenblatt nennt den addierten Betrag', pumpeText.includes('Zum Rohrnetz addiert'), true);
  check(
    'Das Pumpenblatt nennt die erforderliche Förderhöhe',
    pumpeText.includes(`${bericht.pumpe!.head.toFixed(2).replace('.', ',')} m`),
    true,
  );
  // Der Satz zur Restförderhöhe darf nur dann stehen, wenn das Gerät eine
  // veröffentlicht — beide Richtungen werden geprüft, sonst wäre die Zusage
  // durch einen Text erfüllt, der immer dasteht.
  const restsatz = 'sondern geprüft';
  check(
    `Das Referenzgerät veröffentlicht ${bericht.erzeuger.angabe}`,
    bericht.erzeuger.angabe === 'restfoerderhoehe' ? pumpeText.includes(restsatz) : !pumpeText.includes(restsatz),
    true,
  );

  // --- Ein Modell ohne Anlagenschema ---------------------------------------
  // Das Kapitel bleibt stehen und nennt den Grund. Eine weggelassene Nummer
  // sähe aus wie ein verlorenes Blatt.
  const ohneSchema = buildProjektMappe(roh, { datum: '01.01.2026' });
  check('Auch ohne Schema entstehen elf Kapitel', ohneSchema.kapitel.length, 11);
  check(
    'Das Schemakapitel meldet die Lücke',
    ohneSchema.kapitel.find((k) => k.id === 'schema')?.inhalt ?? true,
    false,
  );
  check(
    'Der Grund der Lücke steht am Kapitel',
    ohneSchema.kapitel.find((k) => k.id === 'schema')?.grund ?? '',
    'Im Modell ist kein Anlagenschema erzeugt.',
  );
  check(
    'Das leere Kapitel belegt trotzdem ein Blatt',
    ohneSchema.kapitel.find((k) => k.id === 'schema')?.blaetter.length ?? 0,
    1,
  );
  check(
    'Das Blatt sagt, wie das Schema entsteht',
    nurText(blattHtml(ohneSchema.html, ohneSchema.kapitel[3].blaetter[0])).includes('Schema erzeugen'),
    true,
  );
  check(
    'Das Inhaltsverzeichnis markiert das leere Kapitel',
    nurText(blattHtml(ohneSchema.html, 2)).includes('ohne Angaben'),
    true,
  );

  // --- Ein leeres Modell ---------------------------------------------------
  // Ohne Wände, ohne Netz, ohne Anlage: die Mappe darf weder abstürzen noch
  // ein scheinbar vollständiges Dokument liefern.
  const leer = buildProjektMappe(
    {
      ...roh,
      walls: {},
      nodes: {},
      openings: {},
      rooms: {},
      fixtures: {},
      pipes: {},
      pipeAccessories: {},
    },
    { datum: '01.01.2026' },
  );
  check('Auch aus einem leeren Modell entstehen elf Kapitel', leer.kapitel.length, 11);
  check('Das leere Modell ergibt trotzdem Blätter', leer.blaetter.length > 0, true);
  check('Die Blattnummern bleiben lückenlos', leer.blaetter.every((b, i) => b.nr === i + 1), true);
  check(
    'Das Grundrisskapitel meldet die fehlende Wand',
    leer.kapitel.find((k) => k.id === 'grundriss')?.grund ?? '',
    'Im Modell steht keine Wand.',
  );
  check(
    'Das Rohrnetzkapitel meldet das fehlende Netz',
    leer.kapitel.find((k) => k.id === 'rohrnetz')?.grund ?? '',
    'Im Modell ist kein Rohrnetz gezeichnet.',
  );

  // --- Zahlen und Textsauberkeit ------------------------------------------
  for (const [name, dokument] of [
    ['Referenzhaus', mappe.html],
    ['ohne Schema', ohneSchema.html],
    ['leeres Modell', leer.html],
  ] as const) {
    check(`Kein „NaN" im Dokument (${name})`, dokument.includes('NaN'), false);
    check(`Kein „undefined" im Dokument (${name})`, dokument.includes('undefined'), false);
    check(`Kein „[object Object]" im Dokument (${name})`, dokument.includes('[object Object]'), false);
  }

  // --- Reproduzierbarkeit --------------------------------------------------
  // Zweimal gebaut muss zweimal dasselbe herauskommen: das Modul liest keine
  // Uhr, und `belege` liefert eine stabile Reihenfolge. Ein Dokument, das sich
  // bei jedem Aufruf ändert, taugt nicht als Nachweis.
  const nochmal = buildProjektMappe(doc, {
    datum: '01.01.2026',
    bearbeiter: 'Prüflauf',
    anlagenName: 'Wärmepumpenanlage Haus 1',
    programmstand: 'Prüfstand',
    bericht,
  });
  check('Zweimal gebaut ergibt dasselbe Dokument', nochmal.html === mappe.html, true);

  // --- Kapitel weglassen ---------------------------------------------------
  const ohneBuch = buildProjektMappe(doc, {
    datum: '01.01.2026',
    bericht,
    omit: ['anlagenbuch', 'massenauszug'],
  });
  check('Weggelassene Kapitel fehlen in der Übersicht', ohneBuch.kapitel.length, 9);
  check(
    'Die Kapitelnummern bleiben nach dem Weglassen lückenlos',
    ohneBuch.kapitel.every((k, i) => k.nummer === i + 1),
    true,
  );
  check(
    'Die Blattnummern bleiben nach dem Weglassen lückenlos',
    ohneBuch.blaetter.every((b, i) => b.nr === i + 1),
    true,
  );
  check('Ohne Anlagenbuch bleibt dessen Stil weg', ohneBuch.html.includes('.anlagenbuch .kapitel{'), false);
  check('Die Mappe wird dabei kürzer', ohneBuch.blaetter.length < mappe.blaetter.length, true);
}
