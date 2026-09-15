/**
 * Ebenen — was auf welcher liegt, was sichtbar ist, was gesperrt ist.
 * ---------------------------------------------------------------------------
 *
 * **Die Ebene ist hier eine Eigenschaft des Bauteils, keine Ablage.** Ein
 * Heizkörper liegt auf „TGA · Heizung", weil er ein Heizkörper ist — nicht,
 * weil jemand ihn dorthin gelegt hat. In einem Zeichenprogramm wäre das eine
 * Einschränkung; in einem Erfassungswerkzeug ist es die Voraussetzung dafür,
 * dass „Heizung" verlässlich *alles* Heizungstechnische enthält. Wer Objekte
 * von Hand auf Ebenen legt, weiß nach dem dritten Import nicht mehr, was wo
 * liegt, und beim vierten ist die Zuordnung weg.
 *
 * Daraus folgt der Zuschnitt dieser Datei: Sie ordnet zu, sie verwaltet
 * nicht. Es gibt keine freien Ebenen, keine Zuordnung von Hand, keine
 * Farbvorschrift je Ebene (die Farben stehen an den Gewerken und an den
 * Medien, und eine zweite Farbquelle wäre der nächste Widerspruch zwischen
 * Bildschirm und Blatt).
 *
 * **Wofür Ebenen in diesem Werkzeug gebraucht werden:** nicht zum Zeichnen,
 * sondern zum **Aufmessen** (sperren, damit man beim Zielen auf einen
 * Heizkörper nicht die Wand dahinter verschiebt), zum **Ausgeben** (vier
 * Gewerkeblätter aus einem Modell) und zum **Hinsehen** (im begangenen Haus
 * die Lüftungsleitung wegblenden, die vor dem Heizkörper hängt).
 *
 * **Was Ebenen ausdrücklich nicht tun: den Export beschneiden.** Was
 * ausgeblendet ist, ist nicht weg. Ein Export, der die Sichtbarkeit
 * mitnimmt, liefert der Gegenstelle ein halbes Gebäude — und niemand sähe es
 * der Datei an.
 */

import type { BimDocument, Fixture, Layer, LayerId, PipeService, Selection, SelectionKind } from '../types/bim';

export const EBENE_WAENDE = 'layer-walls';
export const EBENE_OEFFNUNGEN = 'layer-openings';
export const EBENE_RAEUME = 'layer-rooms';
export const EBENE_MASSE = 'layer-dimensions';
export const EBENE_HEIZUNG = 'layer-heating';
export const EBENE_SANITAER = 'layer-sanitary';
export const EBENE_LUEFTUNG = 'layer-ventilation';
export const EBENE_DURCHBRUECHE = 'layer-durchbrueche';
export const EBENE_GELAENDE = 'layer-site';
export const EBENE_BILD = 'layer-image';

/**
 * Die Ebene eines Rohrabschnitts folgt dem Medium, nicht dem Werkzeug.
 *
 * Das **Kältemittel** gehört zur Heizung und nicht zum Sanitär: Es ist die
 * Leitung zwischen Außen- und Inneneinheit eines Splitgeräts, also
 * Erzeugerseite. Auf dem Sanitärblatt wäre es an der falschen Stelle — und
 * der Monteur, der danach Dämmung, Druckprobe und Kälteschein richtet, sucht
 * es auf dem Heizungsblatt.
 *
 * Ohne `default`, damit eine neue Medienart den Übersetzer anhält: Sie stumm
 * beim Sanitär landen zu lassen wäre die Art Fehler, die erst auf dem Blatt
 * auffällt.
 */
export function ebeneFuerMedium(service: PipeService): LayerId {
  switch (service) {
    case 'heating-flow':
    case 'heating-return':
    case 'refrigerant':
      return EBENE_HEIZUNG;
    case 'ventilation-supply':
    case 'ventilation-exhaust':
      return EBENE_LUEFTUNG;
    case 'hot-water':
    case 'cold-water':
    case 'circulation':
    case 'waste':
      return EBENE_SANITAER;
  }
}

/**
 * Die Ebene eines TGA-Objekts folgt seinem Gewerk.
 *
 * Als `switch` ohne `default` geschrieben, damit eine vierte Gewerkeart den
 * Übersetzer anhält. Der verschachtelte Ternär, der hier stand, ließ sie
 * wortlos auf der Lüftung landen — ein Fehler, der im Programm aussieht wie
 * eine Entscheidung.
 */
export function ebeneFuerObjekt(fixture: Pick<Fixture, 'category'>): LayerId {
  switch (fixture.category) {
    case 'heating':
      return EBENE_HEIZUNG;
    case 'sanitary':
      return EBENE_SANITAER;
    case 'ventilation':
      return EBENE_LUEFTUNG;
  }
}

/**
 * Der Katalog der Ebenen.
 *
 * **Warum er hier steht und nicht im Store.** Eine Ebene ist eine Eigenschaft
 * des Modells — Kennung, Name, Farbe, Voreinstellung —, keine Sache des
 * Programmzustands. Solange die Liste im Store lag, wusste ausgerechnet das
 * Modul, das Bauteile *zuordnet*, nicht, welche Ebenen es *gibt*; und beim
 * Auslagern des Rechenkerns an die Gegenstelle fehlte der Katalog ganz.
 */
export const EBENEN_KATALOG: readonly Layer[] = [
  { id: EBENE_WAENDE, name: 'Wände', color: '#E2E8F0', visible: true, locked: false },
  { id: EBENE_OEFFNUNGEN, name: 'Öffnungen', color: '#38BDF8', visible: true, locked: false },
  { id: EBENE_RAEUME, name: 'Räume', color: '#2DD4BF', visible: true, locked: false },
  { id: EBENE_MASSE, name: 'Maßketten', color: '#94A3B8', visible: true, locked: false },
  { id: EBENE_HEIZUNG, name: 'TGA · Heizung', color: '#F87171', visible: true, locked: false },
  { id: EBENE_SANITAER, name: 'TGA · Sanitär', color: '#38BDF8', visible: true, locked: false },
  { id: EBENE_LUEFTUNG, name: 'TGA · Lüftung', color: '#34D399', visible: true, locked: false },
  /*
   * Zwei Ebenen, die bis 1.26.0 fehlten.
   *
   * **Durchbrüche** sind seit dem automatischen Auslegen keine Handvoll
   * Symbole mehr, sondern eine Gewerkeposition mit eigenem Blatt: Wer bohrt,
   * braucht den Plan mit den Bohrungen und ohne die Heizkörper.
   *
   * **Das Gelände** gehört auf eine eigene Ebene, weil es zu keinem Geschoss
   * gehört. Es lag vorher immer unter dem Grundriss — auch im Kellergeschoss,
   * wo ein Rasen über der Bodenplatte schlicht falsch ist. Eine Ebene ist die
   * ehrlichere Antwort als eine Geschossregel: Das Grundstück ist nicht im
   * Erdgeschoss, es ist daneben.
   */
  { id: EBENE_DURCHBRUECHE, name: 'Durchbrüche', color: '#F97316', visible: true, locked: false },
  { id: EBENE_GELAENDE, name: 'Grundstück', color: '#FBBF24', visible: true, locked: false },
  { id: EBENE_BILD, name: 'Referenzbild', color: '#64748B', visible: true, locked: false },
];

/**
 * Auf welcher Ebene liegt das, was hier ausgewählt ist?
 *
 * `undefined` heißt: auf keiner — und damit weder ausblendbar noch sperrbar.
 * Das betrifft heute nur den Spurkandidaten der Bilderkennung, der ohnehin
 * ein Vorschlag und kein Bauteil ist.
 */
export function ebeneFuerAuswahl(doc: BimDocument, kind: SelectionKind, id: string): LayerId | undefined {
  switch (kind) {
    case 'wall':
    case 'node':
    case 'vertical':
    case 'solid':
      return EBENE_WAENDE;
    case 'opening':
    case 'roofOpening':
      return EBENE_OEFFNUNGEN;
    case 'room':
      return EBENE_RAEUME;
    case 'annotation':
      return EBENE_MASSE;
    case 'durchbruch':
      return EBENE_DURCHBRUECHE;
    case 'site':
    case 'heatpump':
      return EBENE_GELAENDE;
    case 'image':
      return EBENE_BILD;
    case 'fixture': {
      const f = doc.fixtures[id];
      return f ? ebeneFuerObjekt(f) : EBENE_HEIZUNG;
    }
    case 'pipe': {
      const r = doc.pipes[id];
      return r ? ebeneFuerMedium(r.service) : EBENE_HEIZUNG;
    }
    case 'accessory': {
      const a = doc.pipeAccessories?.[id];
      const r = a?.runId ? doc.pipes[a.runId] : undefined;
      return r ? ebeneFuerMedium(r.service) : EBENE_HEIZUNG;
    }
    /*
     * Der Spurkandidat der Bilderkennung liegt auf **keiner** Ebene, und das
     * ist eine Entscheidung und kein Durchfall: Er ist ein Vorschlag, den man
     * annimmt oder verwirft, kein Bauteil. Ihn sperrbar zu machen hieße, ihn
     * für ein Bauteil zu halten.
     */
    case 'trace':
      return undefined;
  }
}

/** Ist die Ebene dieses Objekts sichtbar? Ohne Ebene: immer ja. */
export function istSichtbar(doc: BimDocument, kind: SelectionKind, id: string): boolean {
  const ebene = ebeneFuerAuswahl(doc, kind, id);
  if (!ebene) return true;
  return doc.layers[ebene]?.visible !== false;
}

/**
 * Ist die Ebene dieses Objekts gesperrt?
 *
 * **Warum das Sperren im Treffertest sitzt und nicht in den Aktionen.** Ein
 * gesperrtes Bauteil soll man sehen, aber nicht anfassen. Prüfte erst die
 * Aktion, wäre das Bauteil schon gewählt, der Inspektor stünde davor, und
 * beim Ziehen passierte nichts — das sieht nach einem kaputten Programm aus.
 * Wird es gar nicht erst getroffen, greift der Zeiger durch es hindurch auf
 * das, was dahinter liegt, und genau das ist gemeint: Wer im fertigen
 * Bestand einen Heizkörper vor der Wand setzt, will die Wand nicht mitnehmen.
 *
 * Die Aktionen prüfen trotzdem noch einmal — eine Auswahl kann auch aus
 * einer Liste kommen, und die geht am Treffertest vorbei.
 */
export function istGesperrt(doc: BimDocument, kind: SelectionKind, id: string): boolean {
  const ebene = ebeneFuerAuswahl(doc, kind, id);
  if (!ebene) return false;
  return doc.layers[ebene]?.locked === true;
}

/** Dasselbe für eine fertige Auswahl. */
export function auswahlGesperrt(doc: BimDocument, sel: Selection): boolean {
  return istGesperrt(doc, sel.kind, sel.id);
}

/**
 * Die Ebenen des Bestands — was „Bestand sperren" sperrt.
 *
 * Wände, Öffnungen, Räume und Durchbrüche: das Gebäude. Nicht die Maßketten
 * (sie beschreiben es und werden beim Aufmaß dauernd gesetzt) und nicht das
 * Referenzbild (das hat ein eigenes Schloss, weil man es beim Kalibrieren
 * bewegt und danach nie wieder).
 */
export const BESTANDS_EBENEN: readonly LayerId[] = [
  EBENE_WAENDE,
  EBENE_OEFFNUNGEN,
  EBENE_RAEUME,
  EBENE_DURCHBRUECHE,
];

/** Kennung eines Gewerkeblatts. */
export type GewerkesatzId = 'grundriss' | 'heizung' | 'sanitaer' | 'lueftung';

export interface Gewerkesatz {
  id: GewerkesatzId;
  label: string;
  /** Kurzer Satz für die Schaltfläche — was auf dem Blatt steht. */
  auskunft: string;
  /** Diese Ebenen sind sichtbar; alle übrigen nicht. */
  sichtbar: readonly LayerId[];
}

/**
 * Die vier Blätter eines Planungssatzes.
 *
 * **Warum es Sätze gibt und nicht acht Häkchen.** Ein Planungssatz ist in
 * der Praxis: Grundriss, Grundriss + Heizung, Grundriss + Sanitär,
 * Grundriss + Lüftung — vier Blätter aus einem Modell. Wer sie über
 * Einzelschalter zusammenstellt, klickt vier Mal durch acht Häkchen und hat
 * beim dritten Blatt das Kreuz bei „Lüftung" vergessen. Das fällt am
 * Bildschirm nicht auf und auf der Baustelle schon.
 *
 * **Die Räume sind auf jedem Blatt dabei, ihr Stempel aber verkleinert.**
 * Der Monteur muss wissen, in welchem Raum er steht. Fläche und Volumen
 * braucht er nicht, und im Bad lägen sonst drei Angaben übereinander.
 */
export const GEWERKESAETZE: readonly Gewerkesatz[] = [
  {
    id: 'grundriss',
    label: 'Grundriss',
    auskunft: 'Wände, Öffnungen, Räume, Maße — ohne Technik.',
    sichtbar: [EBENE_WAENDE, EBENE_OEFFNUNGEN, EBENE_RAEUME, EBENE_MASSE],
  },
  {
    id: 'heizung',
    label: 'Heizung',
    auskunft: 'Grundriss mit Heizflächen, Heizungsleitungen und Durchbrüchen.',
    sichtbar: [EBENE_WAENDE, EBENE_OEFFNUNGEN, EBENE_RAEUME, EBENE_MASSE, EBENE_HEIZUNG, EBENE_DURCHBRUECHE],
  },
  {
    id: 'sanitaer',
    label: 'Sanitär',
    auskunft: 'Grundriss mit Sanitärobjekten, Trinkwasser und Abwasser.',
    sichtbar: [EBENE_WAENDE, EBENE_OEFFNUNGEN, EBENE_RAEUME, EBENE_MASSE, EBENE_SANITAER, EBENE_DURCHBRUECHE],
  },
  {
    id: 'lueftung',
    label: 'Lüftung',
    auskunft: 'Grundriss mit Ventilen, Kanälen und Durchbrüchen.',
    sichtbar: [EBENE_WAENDE, EBENE_OEFFNUNGEN, EBENE_RAEUME, EBENE_MASSE, EBENE_LUEFTUNG, EBENE_DURCHBRUECHE],
  },
];

/** Alle Ebenen eines Satzes als Sichtbarkeitstabelle. */
export function sichtbarkeitAus(satz: Gewerkesatz, alle: readonly LayerId[]): Record<LayerId, boolean> {
  const an = new Set(satz.sichtbar);
  return Object.fromEntries(alle.map((id) => [id, an.has(id)]));
}
