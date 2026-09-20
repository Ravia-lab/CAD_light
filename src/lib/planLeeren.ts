/**
 * „Alles löschen" — den Plan leeren, ohne das Projekt aufzugeben.
 *
 * **Was hier falsch war.** Der Papierkorb in der Werkzeugleiste hieß „Alle
 * Geometrie löschen" und räumte elf Sammlungen leer. Was er *nicht* anfasste:
 * das Grundstück samt Grenze und Wärmepumpe, die Armaturen am Rohrnetz, die
 * Freihandnotizen, das Referenzbild, die Dächer über den Geschossen und die
 * Anlagentechnik. Wer ihn drückte, stand vor einer leeren Zeichenfläche, auf
 * der die Grundstücksgrenze weiterhin lag und sich mit demselben Knopf nicht
 * mehr entfernen ließ. Gemeldet wurde es so: „leider kann ich
 * grundstückgrenzen beim löschen nicht entfernen".
 *
 * **Was jetzt bleibt — und warum.** Geleert wird alles, was *gezeichnet* oder
 * *gesetzt* wurde. Stehen bleiben die drei Dinge, die nicht der Plan sind,
 * sondern der Rahmen, in dem er entsteht:
 *
 * - **Die Geschosse.** Wer den Grundriss verwirft, verwirft nicht das Haus
 *   mit drei Geschossen von 2,50 m. Ihre Dächer gehen allerdings mit: Ein
 *   Dach ist Geometrie und keine Einstellung.
 * - **Die Ebenen.** Sichtbarkeiten und Sperren sind Arbeitszustand.
 * - **Der Bauteilkatalog.** Er ist eine Bibliothek. Aufbauten, die jemand
 *   angelegt hat, mit dem Grundriss zu löschen, wäre der teuerste denkbare
 *   Fehlgriff — sie stecken in der Regel in mehr Arbeit als die Wände.
 *
 * Dazu die erfassten **Kennwerte**: Bundesland, Gebietstyp und Bodenart des
 * Grundstücks, Systemtemperaturen, Sicherheitsangaben und Trinkwarmwasser.
 * Sie sind Eingaben zum Vorhaben und nicht zum Plan — die Sonde im Garten
 * geht weg, die Bodenart bleibt. Was aus der Anlage *ausgelegt* wurde —
 * Speicher, Kreise, Anlagenschema —, geht dagegen mit.
 *
 * Und ebenso wichtig: **es bleibt rückgängig zu machen.** Der Aufrufer führt
 * die Leerung durch dieselbe Änderungsschleife wie jeden anderen Schritt, und
 * Strg+Z holt den ganzen Plan zurück. Ein „Alles löschen", das die
 * Vorgeschichte mitnimmt, ist keine Funktion, sondern eine Falle.
 */

import type { BimDocument } from '../types/bim';
import { emptyPlant } from './plantDefaults';

/** Eine Gattung in der Bilanz: was es ist und wie viel davon weggeht. */
export interface Loeschposten {
  /** Bezeichnung im Klartext, Mehrzahl — sie steht so im Dialog. */
  label: string;
  anzahl: number;
}

/**
 * Was ein „Alles löschen" wegnehmen würde — Gattung für Gattung.
 *
 * **Wozu die Liste da ist.** Eine Rückfrage „Wirklich alles löschen?" sagt
 * nichts. Eine Rückfrage, die „42 Wände, 6 Räume, 1 Grundstücksgrenze,
 * 1 Wärmepumpe, 1 Referenzbild" auflistet, sagt dem, der davorsitzt, ob er
 * gerade im richtigen Projekt steht. Das ist der einzige Schutz, den es an
 * dieser Stelle gibt.
 *
 * Gattungen ohne Bestand stehen nicht in der Liste: „0 Dächer" ist keine
 * Auskunft, sondern Füllmaterial.
 */
export function loeschbilanz(doc: BimDocument): Loeschposten[] {
  const daecher = Object.values(doc.levels).reduce(
    (n, l) => n + (l.roofs?.length ?? (l.roof ? 1 : 0)),
    0,
  );
  const alle: Loeschposten[] = [
    { label: 'Wände', anzahl: Object.keys(doc.walls).length },
    { label: 'Öffnungen', anzahl: Object.keys(doc.openings).length },
    { label: 'Räume', anzahl: Object.keys(doc.rooms).length },
    { label: 'TGA-Objekte', anzahl: Object.keys(doc.fixtures).length },
    { label: 'Schächte und Stützen', anzahl: Object.keys(doc.verticals).length },
    { label: 'Massive Bauteile', anzahl: Object.keys(doc.solids ?? {}).length },
    { label: 'Durchbrüche', anzahl: Object.keys(doc.durchbrueche ?? {}).length },
    { label: 'Leitungen', anzahl: Object.keys(doc.pipes).length },
    { label: 'Armaturen', anzahl: Object.keys(doc.pipeAccessories ?? {}).length },
    { label: 'Maße und Beschriftungen', anzahl: Object.keys(doc.annotations).length },
    { label: 'Freihandnotizen', anzahl: Object.keys(doc.freihand ?? {}).length },
    { label: 'Dachöffnungen', anzahl: Object.keys(doc.roofOpenings).length },
    { label: 'Dächer', anzahl: daecher },
    { label: 'Objekte im Gelände', anzahl: Object.keys(doc.site.elements).length },
    { label: 'Wärmepumpen', anzahl: Object.keys(doc.site.pumps).length },
    { label: 'Referenzbild', anzahl: doc.image ? 1 : 0 },
  ];
  return alle.filter((p) => p.anzahl > 0);
}

/** Die Bilanz als ein Satz für die Statuszeile. */
export function bilanzSatz(posten: readonly Loeschposten[]): string {
  if (!posten.length) return 'Der Plan war schon leer';
  const teile = posten.map((p) => (p.anzahl === 1 ? `1 ${einzahl(p.label)}` : `${p.anzahl} ${p.label}`));
  return `${teile.join(', ')} gelöscht — Strg+Z holt alles zurück`;
}

/**
 * Mehrzahl zu Einzahl, nur für die Bezeichnungen aus `loeschbilanz`.
 *
 * Bewusst eine Tabelle und keine Regel: Deutsche Mehrzahlbildung rückwärts zu
 * raten geht bei „Wände" (Umlaut), „Räume" (Umlaut), „Maße und
 * Beschriftungen" (zwei Wörter) und „Referenzbild" (schon Einzahl) jeweils
 * anders schief. Sechzehn Zeilen sind billiger als ein Algorithmus, der bei
 * der siebzehnten Gattung falsch liegt.
 */
function einzahl(label: string): string {
  const tabelle: Record<string, string> = {
    'Wände': 'Wand',
    'Öffnungen': 'Öffnung',
    'Räume': 'Raum',
    'TGA-Objekte': 'TGA-Objekt',
    'Schächte und Stützen': 'Schacht',
    'Massive Bauteile': 'massives Bauteil',
    'Durchbrüche': 'Durchbruch',
    'Leitungen': 'Leitung',
    'Armaturen': 'Armatur',
    'Maße und Beschriftungen': 'Maß',
    'Freihandnotizen': 'Freihandnotiz',
    'Dachöffnungen': 'Dachöffnung',
    'Dächer': 'Dach',
    'Objekte im Gelände': 'Objekt im Gelände',
    'Wärmepumpen': 'Wärmepumpe',
    'Referenzbild': 'Referenzbild',
  };
  return tabelle[label] ?? label;
}

/**
 * Den Plan leeren. Verändert das übergebene Dokument an Ort und Stelle —
 * gedacht als Rumpf eines `mutate`-Aufrufs, damit Strg+Z greift.
 *
 * Die Räume werden hier ebenfalls geleert, obwohl sie abgeleitet sind: Die
 * Raumerkennung läuft nach jeder Änderung ohnehin und findet in einem
 * Dokument ohne Wände nichts. Sie stehenzulassen hieße, für die Dauer eines
 * Bildaufbaus Räume ohne Wände im Plan zu haben.
 */
export function leerePlan(doc: BimDocument): void {
  doc.nodes = {};
  doc.walls = {};
  doc.openings = {};
  doc.fixtures = {};
  doc.verticals = {};
  doc.solids = {};
  doc.durchbrueche = {};
  doc.pipes = {};
  doc.pipeAccessories = {};
  doc.annotations = {};
  doc.freihand = {};
  doc.roofOpenings = {};
  doc.rooms = {};
  doc.diagnostics = { openEnds: [] };
  doc.site = { ...doc.site, elements: {}, pumps: {} };
  const frisch = emptyPlant();
  doc.plant = doc.plant
    ? { ...doc.plant, storages: {}, circuits: {}, schematic: frisch.schematic }
    : frisch;
  doc.image = undefined;
  // Die Geschosse bleiben — ihre Dächer nicht. Beide Felder werden geräumt:
  // `roofs` ist die heutige Form, `roof` die alte aus Dateien vor 1.36.0.
  for (const id of Object.keys(doc.levels)) {
    const level = doc.levels[id];
    doc.levels[id] = { ...level, roof: undefined, roofs: undefined };
  }
}
