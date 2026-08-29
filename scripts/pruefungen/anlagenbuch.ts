/**
 * Prüfblock für das Anlagenbuch.
 * ---------------------------------------------------------------------------
 * Ein Dokumentmodul lässt sich nicht wie ein Rechenkern prüfen: es gibt keine
 * Formel, aus der sich „das richtige HTML" herleiten ließe. Geprüft werden
 * deshalb die Eigenschaften, die das Modul in seinem Kopfkommentar für sich
 * beansprucht, und die Zusagen, die es im Text gibt:
 *
 *  • Vollständigkeit — neun Kapitel in fester Reihenfolge, lückenlos
 *    nummeriert, keines ohne Text.
 *  • Ehrlichkeit — das Kapitel „Was hier steht und was nicht" benennt die
 *    Grenzen der Auslegung namentlich, nicht als Floskel.
 *  • Sauberkeit der Zahlen — was im Modell fehlt, steht als Strich und nicht
 *    als 0. Eine gedruckte 0 ist eine Aussage; ein Strich ist das Eingeständnis
 *    einer Lücke, und nur das letztere ist wahr. Dasselbe gilt für eine Zahl,
 *    die sich nicht darstellen lässt: nicht endlich oder jenseits von 1e21.
 *  • Widerspruchsfreiheit — eine Größe, die in zwei Kapiteln gedruckt wird,
 *    steht an beiden Stellen gleich.
 *  • Belastbarkeit — ohne Anlagenplanung entsteht ein Heft mit Hinweisen,
 *    kein Absturz und kein scheinbar vollständiger Nachweis.
 *
 * Sollwerte stammen aus dem Modul selbst (Anzahl und Reihenfolge der Kapitel,
 * Zahl der Checklistenpunkte aus der dort aufgeschriebenen Liste) und aus dem
 * Referenzhaus (vier beheizte Räume, vier Heizkreise). Wo sich kein Sollwert
 * herleiten lässt, wird eine Eigenschaft geprüft: Vorzeichen, Endlichkeit,
 * Reihenfolge, An- und Abwesenheit eines Textbausteins.
 *
 * Die Geräte für die Schall- und Elektrikprüfungen sind hier von Hand
 * gebaute Typklassen und keine Katalogeinträge — nur so lässt sich ein Gerät
 * ohne Außeneinheit und ein Gerät ohne Angabe des Betriebsstroms erzwingen,
 * ohne vom Inhalt des Katalogs abzuhängen.
 */

import type { CheckFn } from './typ';
import type { HeatPumpModel } from '../../src/types/bim';
import { buildPlantBook, type PlantBookChapter, type PlantBookChapterId } from '../../src/lib/plantBook';
import { designPlant, type PlantDesignResult } from '../../src/lib/plantDesign';
import { buildRaviaExport } from '../../src/lib/raviaExport';
import { buildReferenceDocument } from '../reference';
import { erzeugerBilanz } from '../../src/lib/erzeugerHydraulik';

// ---------------------------------------------------------------------------
// Werkzeug: das erzeugte Dokument wieder zerlegen
// ---------------------------------------------------------------------------

/**
 * Ein Kapitel aus dem Dokument herausschneiden.
 *
 * Zerlegt wird an der Abschnittsmarke und nicht mit einer Klammerzählung: die
 * Kapitel liegen flach nebeneinander, verschachtelte `section`-Elemente gibt
 * es nicht. Das Ergebnis ist der Rohtext des Kapitels einschließlich Markup.
 */
function kapitelHtml(html: string, id: PlantBookChapterId): string {
  const teile = html.split('<section class="kapitel');
  return teile.find((t) => t.includes(`id="kapitel-${id}"`)) ?? '';
}

const ENTITAETEN: Record<string, string> = {
  '&lt;': '<',
  '&gt;': '>',
  '&amp;': '&',
  '&quot;': '"',
  '&#39;': "'",
};

/** Markup entfernen und die Entitäten zurückübersetzen — das, was der Leser sieht. */
function nurText(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&lt;|&gt;|&amp;|&quot;|&#39;/g, (e) => ENTITAETEN[e])
    .replace(/\s+/g, ' ')
    .trim();
}

/** Inhalt des ersten Elements der genannten Art — `undefined`, wenn keines da ist. */
function ersterBlock(html: string, tag: string): string | undefined {
  return new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(html)?.[1];
}

/** Zeilen einer Tabelle als Zellenlisten. Der Zellinhalt ist bereits Text. */
function zeilen(html: string): string[][] {
  return [...html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((zeile) =>
    [...zeile[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((zelle) => nurText(zelle[1])),
  );
}

/**
 * Der Wert einer Kennwertzeile — Zelleninhalt einschließlich Fußnote.
 *
 * Gesucht wird über die Beschriftung und nicht über die Zeilennummer: eine
 * Zeile, die je nach Auslegung entfällt, würde sonst alle folgenden Prüfungen
 * um eins verschieben.
 */
function kennwert(html: string, bezeichnung: string): string {
  return zeilen(html).find((z) => z[0] === bezeichnung)?.[1] ?? '';
}

/**
 * Der Rohinhalt einer Kennwertzelle, ohne Textbereinigung.
 *
 * `nurText` zieht Folgen von Leerzeichen zusammen — genau das, was bei einer
 * Prüfung auf doppelte Lücken nicht passieren darf.
 */
function rohzelle(html: string, bezeichnung: string): string {
  return new RegExp(`<th class="l">${bezeichnung}</th><td class="l">([\\s\\S]*?)</td>`).exec(html)?.[1] ?? '';
}

/**
 * Alle Zahlen eines Textes im deutschen Format wieder als Zahl.
 *
 * Der Punkt gilt nur dann als Tausendertrenner, wenn ihm genau drei Ziffern
 * folgen; sonst würde ein Datum wie „01.01.2026" als eine einzige Zahl
 * gelesen. Das Minuszeichen ist das typografische U+2212, weil das Modul es so
 * setzt — ein ASCII-Bindestrich steht in Bezeichnungen wie „DIN EN 12831-1"
 * und ist dort kein Vorzeichen.
 */
function zahlen(text: string): number[] {
  const treffer = text.match(/−?\d{1,3}(?:\.\d{3})+(?:,\d+)?|−?\d+(?:,\d+)?/g) ?? [];
  return treffer.map((t) => Number(t.replace(/−/, '-').replace(/\./g, '').replace(',', '.')));
}

/**
 * Inhaltszustand eines Kapitels als Wort — drei Werte statt zweier.
 *
 * `chapters.find(...)?.hasContent` ist `boolean | undefined`. Wer das mit
 * `?? false` oder `!` glattzieht, wirft „das Kapitel steht gar nicht im Heft"
 * mit „das Kapitel steht im Heft und hat nichts zu sagen" zusammen — die
 * Prüfung auf die gemeldete Lücke wäre dann auch dann zufrieden, wenn das
 * Kapitel ganz fehlt, und damit nur noch in eine Richtung widerlegbar.
 * `'fehlt'` hält den dritten Fall auseinander und lässt beide Gegenproben
 * scheitern, wenn das Kapitel verschwindet.
 */
function kapitelInhalt(
  kapitel: readonly PlantBookChapter[],
  id: PlantBookChapterId,
): 'fehlt' | 'ja' | 'nein' {
  const treffer = kapitel.find((k) => k.id === id);
  if (treffer === undefined) return 'fehlt';
  return treffer.hasContent ? 'ja' : 'nein';
}

// ---------------------------------------------------------------------------
// Prüfgegenstände
// ---------------------------------------------------------------------------

/** Die Kapitelfolge, wie das Modul sie festlegt. */
const KAPITELFOLGE: readonly PlantBookChapterId[] = [
  'deckblatt',
  'grenzen',
  'gebaeude',
  'erzeuger',
  'verteilung',
  'speicher',
  'sicherheit',
  'hinweise',
  'inbetriebnahme',
];

/**
 * Eine Typklasse zum Prüfen. Die Zahlen sind frei gewählt und stehen für nichts
 * — geprüft wird, wie das Modul mit gesetzten und mit fehlenden Feldern umgeht,
 * nicht ob ein Gerät dieser Größe existiert.
 */
function pruefgeraet(zusatz: Partial<HeatPumpModel>): HeatPumpModel {
  return {
    id: 'pruef-geraet',
    label: 'Prüfgerät 10 kW',
    series: 'Prüfreihe',
    form: 'monoblock-indoor',
    source: 'brine-borehole',
    refrigerant: 'R290',
    refrigerantMass: 1.2,
    nominalCapacity: 10,
    nominalPoint: 'B0/W35',
    ratings: [{ point: 'B0/W35', capacity: 10, cop: 4.5 }],
    maxFlowTemperature: 60,
    hydraulicConnection: 'G 1¼ AG',
    minVolumeFlow: 1.2,
    minSystemVolume: 60,
    electric: { phases: 3, fuse: 25 },
    provenance: 'generisch',
    ...zusatz,
  };
}

/**
 * Eine Auslegung ohne jeden Inhalt.
 *
 * Nicht aus einem leeren Modell gerechnet, sondern von Hand gesetzt: geprüft
 * werden soll das Anlagenbuch und nicht die Frage, was `designPlant` aus einem
 * leeren Dokument macht.
 */
function leereAuslegung(): PlantDesignResult {
  return {
    heatLoadSource: 'überschlag',
    // Seit der Rückweg aus RaVia besteht, sagt jede Auslegung, woher ihre
    // Heizlast stammt. Diese hier stammt aus dem Überschlag und kennt keinen
    // Raum mit gerechneter Last — das ist der Zustand, den dieses Heft prüft.
    heatLoadProvenance: 'überschlag',
    normCoverage: {
      heatedRooms: 0,
      withNorm: 0,
      outdated: 0,
      total: 0,
      complete: false,
      missing: [],
      outdatedRooms: [],
    },
    heatLoad: 0,
    dhwSurcharge: 0,
    blocking: 1,
    requiredCapacity: 0,
    matches: [],
    circuits: [],
    totalFlow: 0,
    volume: { total: 0, parts: [] },
    buffer: { required: 0, reason: 'Ohne Erzeuger und ohne Kreise ist kein Puffer bestimmbar.' },
    generator: erzeugerBilanz({ flow: 0, dn: 25, umschaltung: false, waermezaehler: false, abscheiderVorhanden: false }),
    notes: [],
  };
}

// ---------------------------------------------------------------------------
// Prüfungen
// ---------------------------------------------------------------------------

export function pruefeAnlagenbuch(check: CheckFn): void {
  const doc = buildReferenceDocument();
  const auslegung = designPlant(doc);
  const auszug = buildRaviaExport(doc);

  const buch = buildPlantBook({
    design: auslegung,
    projectName: 'Referenzhaus',
    plantName: 'Wärmepumpenanlage Haus 1',
    author: 'Prüflauf',
    date: '01.01.2026',
    rooms: auszug.rooms,
    raviaExport: auszug,
  });

  // --- Kapitelgerüst ------------------------------------------------------
  // Neun Kapitel, weil `PlantBookChapterId` neun Werte kennt und keiner davon
  // weggelassen wurde.
  check('Anlagenbuch hat neun Kapitel', buch.chapters.length, 9);
  check('Kapitel stehen in der festgelegten Reihenfolge', buch.chapters.map((k) => k.id).join(','), KAPITELFOLGE.join(','));
  check('Jedes Kapitel steht als Abschnitt im Dokument', (buch.html.match(/<section class="kapitel/g) ?? []).length, 9);
  check(
    'Beim Referenzhaus meldet kein Kapitel eine Lücke',
    buch.chapters.filter((k) => !k.hasContent).length,
    0,
  );
  // Ein Kapitel, das nur aus Überschrift und Blattkopf besteht, wäre eine
  // leere Seite mit Nummer. Die Schwelle liegt bewusst niedrig: geprüft wird
  // „hat Text", nicht „hat genug Text".
  check(
    'Kein Kapitel bleibt ohne Text',
    Math.min(...KAPITELFOLGE.map((id) => nurText(kapitelHtml(buch.html, id)).length)) > 200,
    true,
  );

  // --- Kapitel „Was hier steht und was nicht" -----------------------------
  const grenzen = kapitelHtml(buch.html, 'grenzen');
  const grenzenText = nurText(grenzen);
  check('Kapitel 2 ist das Grenzenkapitel', buch.chapters[1].title, 'Was hier steht und was nicht');
  check('Grenze der Heizlast ist benannt', grenzenText.includes('DIN EN 12831-1'), true);
  check('Grenze des Schemas ist benannt', grenzenText.includes('Prinzipschema'), true);
  check('Grenze der Schallangabe ist benannt', grenzenText.includes('TA Lärm'), true);
  check('Abschnitt „Was in diesem Heft nicht steht" vorhanden', grenzenText.includes('Was in diesem Heft nicht steht'), true);
  // Die Ausschlussliste im Modul zählt sechs Punkte: Elektro, Statik,
  // Kältetechnik, Genehmigungen, hydraulischer Abgleich, Kosten.
  check('Ausschlussliste nennt sechs Punkte', (grenzen.match(/<li>/g) ?? []).length, 6);

  // --- Zahlen und Textsauberkeit ------------------------------------------
  check('Kein „NaN" im Dokument', buch.html.includes('NaN'), false);
  check('Kein „undefined" im Dokument', buch.html.includes('undefined'), false);

  // Die Zahlformatierung des Moduls sagt zwei Dinge zu: eine nicht endliche
  // Zahl wird zum Strich, und ab 1e21 ebenfalls, weil `toFixed` dort in die
  // Exponentialschreibweise wechselt und die Tausenderpunkte danach in eine
  // Zeichenkette gesetzt würden, die keine Zahl mehr ist. Geprüft wird die
  // Zusage dort, wo sie sichtbar wird: an der Heizlastkachel des Deckblatts.
  // Die drei Werte beschreiben keine Anlage — sie entstehen aus einer
  // verrutschten Eingabe, und genau dafür ist die Zusage gemacht.
  for (const [fall, heatLoad] of [
    ['unendlich', Number.POSITIVE_INFINITY],
    ['keine Zahl', Number.NaN],
    ['jenseits von 1e21', 1e30],
  ] as const) {
    const wild = buildPlantBook({
      design: { ...leereAuslegung(), heatLoad },
      projectName: 'Grenzfall',
      plantName: fall,
      author: 'Prüflauf',
      date: '01.01.2026',
    });
    check(
      `Heizlast ${fall}: das Deckblatt zeigt den Strich`,
      nurText(kapitelHtml(wild.html, 'deckblatt')).includes('Heizlast — kW'),
      true,
    );
    check(
      `Heizlast ${fall}: keine Ersatzschreibweise im Heft`,
      /NaN|Infinity|e\+/.test(wild.html),
      false,
    );
  }

  // --- Fehlende Werte erscheinen als Strich -------------------------------
  // Ohne Raumliste bleibt nur der Heizlastüberschlag als Quelle; er kennt
  // weder Volumen noch Geschossnamen. Die Zeilen müssen trotzdem stehen, die
  // fehlenden Spalten als Strich.
  const ohneRaeume = buildPlantBook({
    design: auslegung,
    projectName: 'Referenzhaus',
    plantName: 'Wärmepumpenanlage Haus 1',
    author: 'Prüflauf',
    date: '01.01.2026',
  });
  const gebaeudeOhne = kapitelHtml(ohneRaeume.html, 'gebaeude');
  const raumZeilenOhne = zeilen(ersterBlock(gebaeudeOhne, 'tbody') ?? '');
  const summeOhne = zeilen(ersterBlock(gebaeudeOhne, 'tfoot') ?? '')[0] ?? [];
  check('Ohne Raumliste stehen die vier Räume des Referenzhauses', raumZeilenOhne.length, 4);
  check(
    'Fehlendes Volumen steht als Strich, nicht als 0',
    raumZeilenOhne.every((z) => z[3] === '—'),
    true,
  );
  check('Auch die Summenzelle Volumen ist ein Strich', summeOhne[3], '—');
  // Gegenprobe: mit Raumliste steht dort eine Zahl.
  const gebaeudeMit = kapitelHtml(buch.html, 'gebaeude');
  const raumZeilenMit = zeilen(ersterBlock(gebaeudeMit, 'tbody') ?? '');
  // Ohne diese Zeile liefe die Prüfung darunter über eine leere Liste und
  // wäre allein deshalb erfüllt.
  check('Mit Raumliste stehen dieselben vier Räume', raumZeilenMit.length, 4);
  check(
    'Mit Raumliste trägt die Volumenspalte Zahlen',
    raumZeilenMit.every((z) => z[3] !== '—' && zahlen(z[3])[0] > 0),
    true,
  );

  // --- Geschossnamen ohne vollständigen Export ----------------------------
  // Der Export ist wahlfrei: die Oberfläche baut das Heft aus Auslegung und
  // Raumliste. Auch dann darf in der Spalte „Geschoss" keine technische
  // Kennung stehen. Die Raumliste trägt den Geschossnamen, der
  // Heizlastüberschlag die Kennung; verbunden werden beide über die Raum-Id.
  // Geprüft wird an einem Raum, der nur im Überschlag steht — für die übrigen
  // käme der Name ohnehin unmittelbar aus der Raumliste, und die Prüfung wäre
  // allein deshalb erfüllt.
  const ogRaum = auszug.rooms.find((r) => r.level !== auszug.rooms[0].level);
  check('Das Referenzhaus hat zwei verschieden benannte Geschosse', ogRaum !== undefined, true);
  const einRaumFehlt = buildPlantBook({
    design: auslegung,
    projectName: 'Referenzhaus',
    plantName: 'ohne Export',
    author: 'Prüflauf',
    date: '01.01.2026',
    rooms: auszug.rooms.filter((r) => r.id !== ogRaum?.id),
  });
  const zeilenEinRaumFehlt = zeilen(ersterBlock(kapitelHtml(einRaumFehlt.html, 'gebaeude'), 'tbody') ?? '');
  check('Der nur im Überschlag geführte Raum steht trotzdem im Heft', zeilenEinRaumFehlt.length, 4);
  check(
    'Sein Geschoss steht als Name und nicht als Kennung',
    zeilenEinRaumFehlt.find((z) => z[0] === ogRaum?.name)?.[1] ?? '',
    ogRaum?.level ?? '',
  );

  // Ohne Raumliste ist kein Name zu beschaffen. Dann steht die Kennung im
  // Heft — aber als Kennung ausgewiesen und nicht als Name behauptet.
  const kennungen = Object.keys(doc.levels);
  check(
    'Ohne Raumliste wird die Geschosskennung als solche ausgewiesen',
    raumZeilenOhne.every((z) => kennungen.some((id) => z[1] === `Kennung „${id}“`)),
    true,
  );
  check(
    'Ohne Raumliste steht keine nackte Kennung in der Spalte Geschoss',
    raumZeilenOhne.some((z) => kennungen.includes(z[1])),
    false,
  );

  // Die Höhensortierung kommt ohne Export aus `levelElevation` der Raumliste.
  // Damit sich die Prüfung nicht von einer alphabetischen Sortierung täuschen
  // lässt, werden die Geschosse vertauscht benannt: das obere heißt
  // „Dachgeschoss" und stünde im Alphabet vorn — richtig ist die Reihenfolge
  // von unten nach oben.
  const vertauscht = auszug.rooms.map((r) =>
    r.levelElevation === 0
      ? { ...r, level: 'Dachgeschoss', levelElevation: 6 }
      : { ...r, level: 'Erdgeschoss', levelElevation: 0 },
  );
  const nachHoehe = buildPlantBook({
    design: auslegung,
    projectName: 'Referenzhaus',
    plantName: 'Höhensortierung',
    author: 'Prüflauf',
    date: '01.01.2026',
    rooms: vertauscht,
  });
  const zeilenNachHoehe = zeilen(ersterBlock(kapitelHtml(nachHoehe.html, 'gebaeude'), 'tbody') ?? '');
  check(
    'Die Geschosse ordnen sich nach der Höhenlage aus der Raumliste',
    [...new Set(zeilenNachHoehe.map((z) => z[1]))].join(','),
    'Erdgeschoss,Dachgeschoss',
  );

  // --- Schallleistung ohne Außeneinheit -----------------------------------
  const ohneAussen = designPlant(doc, {
    modelId: 'pruef-geraet',
    extraModels: [pruefgeraet({})],
  });
  const erzeugerOhneAussen = nurText(kapitelHtml(buildPlantBook({
    design: ohneAussen,
    projectName: 'Referenzhaus',
    plantName: 'Sole/Wasser',
    author: 'Prüflauf',
    date: '01.01.2026',
  }).html, 'erzeuger'));
  check('Gerät ohne Außeneinheit wird als Prüfgerät übernommen', ohneAussen.selected?.model.id ?? '', 'pruef-geraet');
  check('Fehlende Außeneinheit wird ausgeschrieben', erzeugerOhneAussen.includes('entfällt — keine Außeneinheit'), true);
  check('Fehlende Schallleistung wird nicht als 0 dB(A) gedruckt', erzeugerOhneAussen.includes('0 dB(A)'), false);

  const mitAussen = designPlant(doc, {
    modelId: 'pruef-geraet',
    extraModels: [pruefgeraet({ soundPowerOutdoor: 55, form: 'monoblock-outdoor', source: 'air' })],
  });
  const erzeugerMitAussen = nurText(kapitelHtml(buildPlantBook({
    design: mitAussen,
    projectName: 'Referenzhaus',
    plantName: 'Luft/Wasser',
    author: 'Prüflauf',
    date: '01.01.2026',
  }).html, 'erzeuger'));
  check('Vorhandene Schallleistung erscheint mit Einheit', erzeugerMitAussen.includes('55 dB(A)'), true);

  // --- Betriebsstrom ------------------------------------------------------
  const mitStrom = designPlant(doc, {
    modelId: 'pruef-geraet',
    extraModels: [pruefgeraet({ electric: { phases: 3, fuse: 25, maxCurrent: 21.5 } })],
  });
  const elektrikMit = nurText(kapitelHtml(buildPlantBook({
    design: mitStrom,
    projectName: 'Referenzhaus',
    plantName: 'mit Stromangabe',
    author: 'Prüflauf',
    date: '01.01.2026',
  }).html, 'erzeuger'));
  check('Gesetzter Betriebsstrom erscheint im Heft', elektrikMit.includes('max. Betriebsstrom 21,5 A'), true);
  check('Fehlender Betriebsstrom taucht spurlos nicht auf', erzeugerOhneAussen.includes('Betriebsstrom'), false);
  check(
    'Ohne jede Stromangabe steht der Verweis auf die Elektroplanung',
    erzeugerOhneAussen.includes('Anschluss und Anmeldung beim Netzbetreiber'),
    true,
  );

  // --- Inbetriebnahme-Checkliste ------------------------------------------
  const checkliste = kapitelHtml(buch.html, 'inbetriebnahme');
  const checkZeilen = zeilen(ersterBlock(checkliste, 'tbody') ?? '');
  // Acht Grundschritte und die Übergabe stehen immer; beim Referenzhaus kommen
  // das Estrich-Aufheizprotokoll (Fußbodenheizung) und die zwei
  // Trinkwasserschritte hinzu.
  check('Checkliste führt zwölf Punkte', checkZeilen.length, 12);
  // Vordruck und Fülldruck stehen zweimal im Heft: als Rechenwert in der
  // Druckkette des Sicherheitskapitels und noch einmal neben dem Eintragfeld
  // der Checkliste. Beide Stellen zeigen dieselbe Größe. Der Sollwert ist hier
  // nicht die Zahl — die kommt aus der Gefäßrechnung und wird dort geprüft —,
  // sondern die Gleichheit: weichen die Stellen voneinander ab, ist eine von
  // beiden aus einer früheren Rechnung stehengeblieben, und der Monteur trägt
  // seinen Messwert neben den falschen Sollwert.
  const druckkette = zeilen(ersterBlock(kapitelHtml(buch.html, 'sicherheit'), 'tbody') ?? '');
  const ausDruckkette = (zeichen: string): number =>
    zahlen(druckkette.find((z) => z[1] === zeichen)?.[2] ?? '')[0] ?? Number.NaN;
  const ausCheckliste = (zeichen: string): number =>
    zahlen(checkZeilen.find((z) => z[2].startsWith(`${zeichen} = `))?.[1] ?? '')[0] ?? Number.NaN;
  check('Vordruck steht in Checkliste und Druckkette gleich', ausCheckliste('p_0'), ausDruckkette('p_0'));
  check('Fülldruck steht in Checkliste und Druckkette gleich', ausCheckliste('p_F'), ausDruckkette('p_F'));
  // Sechs Punkte verlangen einen Eintrag: Wasserqualität, p_0, p_F, Heizkurve,
  // Estrichprotokoll, Speichertemperatur.
  check('Sechs Punkte tragen ein Eintragfeld', (checkliste.match(/<span class="feld">/g) ?? []).length, 6);
  check(
    'Checkliste verlangt Vordruck und Fülldruck als Eintrag',
    checkliste.includes('p_0 = ') && checkliste.includes('p_F = '),
    true,
  );

  // --- Ohne Anlagenplanung ------------------------------------------------
  const leer = buildPlantBook({
    design: leereAuslegung(),
    projectName: 'Leerlauf',
    plantName: 'ohne Auslegung',
    author: 'Prüflauf',
    date: '01.01.2026',
  });
  check('Auch ohne Auslegung entstehen neun Kapitel', leer.chapters.length, 9);
  // Gebäude, Erzeuger, Verteilung, Speicher, Sicherheit und Hinweise haben
  // nichts zu sagen; Deckblatt, Grenzen und Checkliste stehen immer. Das
  // Speicherkapitel zählt mit, seit es seinen Inhalt aus Puffer,
  // Wasserinhalt und Trinkwasserrechnung ableitet statt ihn zu behaupten.
  check('Sechs Kapitel melden die Lücke', leer.chapters.filter((k) => !k.hasContent).length, 6);
  check(
    'Der Grund der Lücke steht am Kapitel',
    leer.chapters.find((k) => k.id === 'erzeuger')?.emptyReason ?? '',
    'Kein Gerät gewählt.',
  );
  check(
    'Fehlender Erzeuger wird im Kapitel erklärt',
    nurText(kapitelHtml(leer.html, 'erzeuger')).includes('Es wurde kein Wärmeerzeuger gewählt'),
    true,
  );
  check(
    'Fehlende Heizkreise werden im Kapitel erklärt',
    nurText(kapitelHtml(leer.html, 'verteilung')).includes('kein Heizkreis angelegt'),
    true,
  );
  check(
    'Fehlende Sicherheitsauslegung wird im Kapitel erklärt',
    nurText(kapitelHtml(leer.html, 'sicherheit')).includes('Sicherheitsausrüstung wurde nicht ausgelegt'),
    true,
  );
  check(
    'Deckblatt nennt den fehlenden Trinkwasserspeicher statt 0 l',
    nurText(kapitelHtml(leer.html, 'deckblatt')).includes('nicht ausgelegt'),
    true,
  );

  // Das Speicherkapitel darf seinen Inhalt nicht behaupten: ohne Puffer, ohne
  // Wasserinhalt und ohne Trinkwasserrechnung hat es nichts zu sagen, und die
  // beiden Mengen, die es druckt, sind dann keine Auslegungsergebnisse,
  // sondern Startwerte. Eine gedruckte 0 wäre eine Aussage über die Anlage.
  const speicherLeer = kapitelHtml(leer.html, 'speicher');
  check(
    'Ohne Puffer und ohne Trinkwasser meldet das Speicherkapitel die Lücke',
    kapitelInhalt(leer.chapters, 'speicher'),
    'nein',
  );
  check(
    'Der Grund der Lücke steht am Speicherkapitel',
    leer.chapters.find((k) => k.id === 'speicher')?.emptyReason ?? '',
    'Kein Speicher und keine Trinkwasserauslegung.',
  );
  check(
    'Ohne Auslegung steht der Pufferbedarf als Strich, nicht als 0 l',
    kennwert(speicherLeer, 'Erforderlich').startsWith('—'),
    true,
  );
  check(
    'Ohne Auslegung steht der Wasserinhalt als Strich, nicht als 0 l',
    kennwert(speicherLeer, 'Wasserinhalt der Anlage').startsWith('—'),
    true,
  );
  // Gegenprobe am Referenzhaus: dort sind beide Größen gerechnet und müssen
  // als Zahl im Heft stehen, sonst prüfte die Zeile darüber nur, dass das
  // Modul überall Striche druckt.
  const speicherRef = kapitelHtml(buch.html, 'speicher');
  check(
    'Mit Auslegung meldet das Speicherkapitel Inhalt',
    kapitelInhalt(buch.chapters, 'speicher'),
    'ja',
  );
  check(
    'Mit Auslegung trägt der Pufferbedarf eine Zahl',
    zahlen(kennwert(speicherRef, 'Erforderlich'))[0] > 0,
    true,
  );
  check(
    'Mit Auslegung trägt der Wasserinhalt eine Zahl',
    zahlen(kennwert(speicherRef, 'Wasserinhalt der Anlage'))[0] > 0,
    true,
  );

  // --- Fußnote der Aufheizleistung ----------------------------------------
  // Die Fußnote fügt drei Sätze: Aufheizzeit, Begrenzung, verfügbare Leistung.
  // Der mittlere kommt aus einer Satztabelle, die über die Union der Gründe
  // typisiert ist. Wächst die Union, ohne dass die Tabelle nachgezogen wird,
  // fehlt der Satz — dann darf an seiner Stelle keine Lücke stehenbleiben, in
  // der der Leser das fehlende Wort sucht. Der fremde Grund wird über `string`
  // gesetzt, weil sich ein Wert außerhalb der Union sonst nicht bauen ließe;
  // genau das ist der Schutz, den die exhaustive Typisierung leistet.
  const dhwRef = auslegung.dhw;
  check('Das Referenzhaus rechnet eine Trinkwasserauslegung', dhwRef !== undefined, true);
  const fremderGrund: string = 'aufstellraum';
  const mitFremdemGrund = dhwRef
    ? buildPlantBook({
        design: {
          ...auslegung,
          dhw: {
            ...dhwRef,
            reheat: { ...dhwRef.reheat, limitedBy: fremderGrund as typeof dhwRef.reheat.limitedBy },
          },
        },
        projectName: 'Referenzhaus',
        plantName: 'unbekannter Begrenzungsgrund',
        author: 'Prüflauf',
        date: '01.01.2026',
      }).html
    : '';
  const fussnoteRef = rohzelle(speicherRef, 'Aufheizleistung');
  const fussnoteFremd = rohzelle(kapitelHtml(mitFremdemGrund, 'speicher'), 'Aufheizleistung');
  check('Die Fußnote der Aufheizleistung steht im Heft', fussnoteRef.length > 0, true);
  check('Fußnote der Aufheizleistung trägt keine doppelte Lücke', / {2}/.test(fussnoteRef), false);
  check('Auch ohne Begrenzungssatz bleibt die Fußnote ohne Lücke', / {2}/.test(fussnoteFremd), false);
  check(
    'Ohne Begrenzungssatz schließen die übrigen Sätze unmittelbar an',
    /Aufheizzeit\. (Verfügbar|Die Übertragungsleistung)/.test(fussnoteFremd),
    true,
  );
  // Es fällt genau ein Satz weg — nicht mehr und nicht weniger.
  check(
    'Der fehlende Begrenzungssatz kostet genau einen Satz',
    (fussnoteRef.match(/\. /g) ?? []).length - (fussnoteFremd.match(/\. /g) ?? []).length,
    1,
  );
  check(
    'Inhaltsverzeichnis markiert die sechs leeren Kapitel',
    (leer.html.match(/\(ohne Angaben\)/g) ?? []).length,
    6,
  );
  check('Leeres Buch enthält kein „NaN"', leer.html.includes('NaN'), false);
  // Ohne Kreise und ohne Trinkwasser bleiben acht Grundschritte und die
  // Übergabe übrig.
  check('Checkliste schrumpft ohne Auslegung auf neun Punkte', zeilen(ersterBlock(kapitelHtml(leer.html, 'inbetriebnahme'), 'tbody') ?? '').length, 9);

  // --- Weggelassene Kapitel ----------------------------------------------
  const ohneCheckliste = buildPlantBook({
    design: auslegung,
    projectName: 'Referenzhaus',
    plantName: 'Wärmepumpenanlage Haus 1',
    author: 'Prüflauf',
    date: '01.01.2026',
    omit: ['inbetriebnahme'],
  });
  check('Weggelassenes Kapitel fehlt im Heft', ohneCheckliste.chapters.length, 8);
  check(
    'Die Nummerierung bleibt nach dem Weglassen lückenlos',
    ohneCheckliste.chapters.every((k, i) => k.number === i + 1),
    true,
  );
}
