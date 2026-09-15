/**
 * Der Rückweg: was die Gegenstelle in dieses Modell schreiben darf.
 * ---------------------------------------------------------------------------
 * Bis hierher war die Einbettung einseitig. RaVia konnte den Modellstand
 * holen, aber nichts zurückgeben — die Norm-Heizlast, die dort gerechnet wird,
 * musste von Hand abgetippt werden, und die Anlagenauslegung rechnete
 * weiterhin mit dem eigenen Überschlag. Das ist keine Verbindung zweier
 * Programme, das ist ein Export mit besserer Anbindung.
 *
 * Schreiben ist aber die gefährlichere Richtung. Ein zweites Programm ändert
 * ein Modell, an dem gerade jemand zeichnet. Fünf Regeln machen das
 * beherrschbar; sie sind der eigentliche Inhalt dieser Datei:
 *
 * 1. **Geometrie ist tabu.** Wände, Knoten, Öffnungen, Räume, Polygone,
 *    Flächen und Höhen gehören dem, der zeichnet. Die Gegenstelle setzt
 *    Fachdaten: Solltemperaturen, Luftwechsel, U-Werte, Norm-Heizlasten,
 *    Randbedingungen. Ein Versuch, Geometrie zu setzen, wird nicht still
 *    übergangen, sondern mit Grund abgelehnt — sonst sucht der Entwickler auf
 *    der Gegenseite den Fehler bei sich.
 *
 * 2. **Nichts still.** Jeder Eintrag endet als „übernommen", „unverändert"
 *    oder „abgelehnt" mit Begründung, alter und neuer Wert inklusive. Ein
 *    Schreibvorgang ohne Quittung ist eine Behauptung.
 *
 * 3. **Teilweise anwenden, vollständig berichten.** Ein Tippfehler in einer
 *    Raum-Kennung darf nicht vierzig gültige Werte mitreißen. Deshalb wird
 *    jeder Eintrag für sich entschieden. Die Gegenprobe — „alles oder
 *    nichts" — wäre nur dann richtig, wenn die Werte voneinander abhingen;
 *    sie tun es nicht, jeder steht für sich.
 *
 * 4. **Gleich bleibt gleich.** Ein Wert, der schon so im Modell steht, gilt
 *    als „unverändert" und erzeugt keinen Historieneintrag. Sonst füllt eine
 *    Gegenstelle, die im Sekundentakt schreibt, die Rückgängig-Kette mit
 *    Nichts und macht sie unbrauchbar.
 *
 * 5. **Die Spur bleibt am Modell.** `meta.lastHostPatch` hält fest, wer wann
 *    was geschrieben hat. Ohne diese Spur erklärt später niemand mehr, warum
 *    im Bad 24 °C stehen, die hier keiner eingetragen hat.
 *
 * Das Modul ist rein: es bekommt ein Dokument und liefert ein neues. Kein
 * Store, kein React, kein DOM. Die Rückgängig-Fähigkeit entsteht dadurch von
 * selbst — wer das alte Dokument behält, hat den alten Stand.
 */

import type {
  BimDocument,
  Construction,
  ConstructionCategory,
  Fixture,
  FixtureParams,
  ProjectMeta,
  RadiatorConnection,
  Room,
  RoomHeatLoad,
} from '../types/bim';
import { RADIATOR_CONNECTION_LABELS } from '../types/bim';

// ===========================================================================
// Vertrag
// ===========================================================================

/** Was die Gegenstelle je Raum setzen darf. */
export interface RoomPatch {
  /** Kennung des Raums, so wie sie im Export steht. */
  id: string;
  /** Solltemperatur [°C]. */
  setpointTemperature?: number;
  /** Mindest-Luftwechselrate [1/h]. */
  airChangeRate?: number;
  /** Beheizt oder nicht — ändert die Rolle des Raums in der Bilanz. */
  isHeated?: boolean;
  /** U-Wert von Boden und Decke [W/(m²·K)], falls raumweise abweichend. */
  floorUValue?: number;
  ceilingUValue?: number;
  /** Gerechnete Norm-Heizlast dieses Raums [W] samt Aufteilung. */
  heatLoad?: {
    total: number;
    transmission?: number;
    ventilation?: number;
    reheat?: number;
  };
}

/**
 * Was die Gegenstelle je Heizfläche setzen darf.
 *
 * **Warum es diesen Weg braucht.** Bis hierher konnte RaVia die Heizlast
 * zurückschreiben, aber nicht ihr Ergebnis: welcher Heizkörper es nun wird,
 * welche Voreinstellung sein Ventil bekommt, mit welchem Verlegeabstand der
 * Heizkreis liegt. Die Auslegung endete damit in einem Bericht statt in der
 * Zeichnung, und der nächste, der den Plan öffnete, sah den Stand von vorher.
 *
 * Geschrieben werden ausschließlich **Auslegungsergebnisse** — keine
 * Geometrie. Position, Drehung und Wandbindung eines Objekts gehören dem
 * Zeichner; ein Rechenkern, der ein Symbol verschieben darf, verschiebt es
 * irgendwann gegen die Absicht dessen, der es gesetzt hat.
 */
export interface FixturePatch {
  /** Kennung des Objekts, so wie sie in `emitters[].fixtureId` steht. */
  id: string;
  /** Normwärmeleistung [W] bei 55/45/20 °C. */
  powerW?: number;
  /** Bauart/Typ, z. B. „22". */
  radiatorType?: string;
  /** Heizkörperexponent n [-] aus dem Datenblatt des gewählten Geräts. */
  radiatorExponent?: number;
  /** Bauhöhe [m]. */
  radiatorHeight?: number;
  /** Gliederzahl [-]. */
  radiatorSections?: number;
  /** Anschlussart. */
  radiatorConnection?: RadiatorConnection;
  /** Baulänge [m] — das einzige Geometriemaß, das die Auslegung bestimmt. */
  length?: number;
  /** Vor- und Rücklauftemperatur dieser Heizfläche [°C]. */
  flowTemperature?: number;
  returnTemperature?: number;
  /** Fußbodenheizung: Verlegeabstand [m]. */
  loopSpacing?: number;
  /** Fußbodenheizung: Zahl der Kreise [-]. */
  loopCount?: number;
  /** Fußbodenheizung: Estrichüberdeckung [m]. */
  screedCover?: number;
  /** Fußbodenheizung: Wärmedurchlasswiderstand des Belags R_λB [m²·K/W]. */
  floorCoveringResistance?: number;
  /** Fußbodenheizung: Rohraußendurchmesser und Wandstärke [m]. */
  pipeOuterDiameter?: number;
  pipeWallThickness?: number;
  /** Freitext für Fabrikat und Typ — hier landet das gewählte Gerät. */
  note?: string;
}

/** Was am Bauteilaufbau gesetzt werden darf. */
export interface ConstructionPatch {
  id: string;
  /** U-Wert [W/(m²·K)]. */
  uValue?: number;
  /** Wärmebrückenzuschlag dieses Aufbaus [W/(m²·K)]. */
  thermalBridgeSupplement?: number;
  /** g-Wert bei transparenten Bauteilen [-]. */
  gValue?: number;
  /** Schichtenbeschreibung als Freitext. */
  layers?: string;
  /**
   * Neuen Aufbau anlegen, wenn die Kennung unbekannt ist.
   * Ohne `name` und `category` wird nichts angelegt — ein namenloser Aufbau
   * im Katalog ist schlimmer als ein abgelehnter Eintrag.
   */
  createIfMissing?: { name: string; category: ConstructionCategory };
}

/** Was am Projektkopf gesetzt werden darf. */
export interface ProjectPatch {
  designOutdoorTemperature?: number;
  designIndoorTemperature?: number;
  n50?: number;
  shielding?: ProjectMeta['shielding'];
  unheatedTemperature?: number;
  groundTemperature?: number;
  thermalBridgeSupplement?: number;
  thermalBridgeMethod?: ProjectMeta['thermalBridgeMethod'];
  reheatFactor?: number;
}

/** Ein vollständiger Schreibvorgang. */
export interface HostPatch {
  /**
   * Wer schreibt. Pflicht, und zwar aus einem inhaltlichen Grund: die Angabe
   * landet in der Spur am Modell und an jeder übernommenen Heizlast. Ein
   * anonymer Schreibvorgang wäre später nicht mehr zuzuordnen.
   */
  source: string;
  project?: ProjectPatch;
  rooms?: RoomPatch[];
  constructions?: ConstructionPatch[];
  /** Auslegungsergebnisse je Heizfläche. */
  fixtures?: FixturePatch[];
  /**
   * Gesamte Norm-Heizlast des Gebäudes [W]. Sie geht in das Anlagenblatt als
   * `heatLoadOverride` und ersetzt dort den Überschlag.
   */
  totalHeatLoad?: number;
}

export type PatchVerdict = 'übernommen' | 'unverändert' | 'abgelehnt';

export interface PatchEntry {
  /** Wo im Modell, z. B. `rooms.eg-r1.setpointTemperature`. */
  path: string;
  /** Wie es im Programm heißt, für die Anzeige. */
  label: string;
  verdict: PatchVerdict;
  before?: number | string | boolean;
  after?: number | string | boolean;
  /** Nur bei „abgelehnt": warum. */
  reason?: string;
}

export interface HostPatchReport {
  /** Hat der Vorgang insgesamt getragen? Falsch, sobald etwas abgelehnt wurde. */
  ok: boolean;
  applied: number;
  unchanged: number;
  rejected: number;
  entries: PatchEntry[];
  /** Ein Satz im Klartext. */
  summary: string;
}

export interface HostPatchResult {
  /** Neues Dokument. Bei ausschließlich abgelehnten Einträgen dasselbe wie vorher. */
  doc: BimDocument;
  /** Hat sich am Dokument etwas geändert? Wenn nein, gehört es nicht in die Historie. */
  changed: boolean;
  report: HostPatchReport;
}

// ===========================================================================
// Wertebereiche
// ===========================================================================

/**
 * Grenzen, innerhalb derer ein Wert überhaupt eine Aussage ist.
 *
 * Sie sind bewusst weit: hier wird nicht geplant, sondern nur der Zahlendreher
 * abgefangen. 200 °C Solltemperatur ist kein Sonderfall, sondern ein Fehler in
 * der Einheit; 21 °C in einem Kühlraum ist vielleicht ungewöhnlich, aber die
 * Entscheidung der Gegenstelle und nicht unsere.
 */
export const PATCH_RANGES = {
  setpointTemperature: [-30, 60],
  airChangeRate: [0, 10],
  uValue: [0.01, 10],
  gValue: [0, 1],
  designOutdoorTemperature: [-40, 20],
  designIndoorTemperature: [-30, 60],
  n50: [0.1, 30],
  unheatedTemperature: [-40, 40],
  groundTemperature: [-20, 30],
  thermalBridgeSupplement: [0, 1],
  reheatFactor: [0, 50],
  heatLoad: [0, 10_000_000],
} as const satisfies Record<string, readonly [number, number]>;

/**
 * Felder, die ausdrücklich nicht geschrieben werden können, mit dem Grund.
 *
 * Die Liste steht hier, damit die Ablehnung erklärt statt nur abweist. Wer auf
 * der Gegenseite `area` setzen will, hat eine falsche Vorstellung von der
 * Aufgabenteilung — und die Meldung ist die einzige Stelle, an der ihm das
 * jemand sagt.
 */
export const PROTECTED_FIELDS: Record<string, string> = {
  polygon: 'Die Geometrie gehört dem Grundriss. Sie ändert sich durch Zeichnen, nicht durch Schreiben.',
  innerPolygon: 'Abgeleitet aus den Wandachsen — eine gesetzte Fläche wäre beim nächsten Zug wieder überschrieben.',
  area: 'Fläche und Volumen werden aus der Geometrie gerechnet. Wer sie setzt, erzeugt einen Widerspruch im Modell.',
  grossArea: 'Fläche und Volumen werden aus der Geometrie gerechnet.',
  volume: 'Fläche und Volumen werden aus der Geometrie gerechnet.',
  height: 'Die Raumhöhe folgt aus den Wänden; eine abweichende lichte Höhe wird hier von Hand gesetzt.',
  perimeter: 'Abgeleitet aus dem Innenpolygon.',
  boundaries: 'Die Hüllbauteile entstehen aus der Raumerkennung.',
  centroid: 'Abgeleitet aus dem Innenpolygon.',
  levelId: 'Ein Raum wechselt das Geschoss nicht durch einen Schreibvorgang.',
  name: 'Der Raumname ist eine Angabe des Zeichners; ein fremder Name macht den Plan unlesbar.',
  usage: 'Die Nutzung bestimmt Vorbelegungen im ganzen Werkzeug und wird hier gesetzt.',
};

// ===========================================================================
// Anwenden
// ===========================================================================

/**
 * Einen Schreibvorgang anwenden.
 *
 * Rein und ohne Nebenwirkung: das übergebene Dokument bleibt unangetastet,
 * zurück kommt ein neues. Geändert wird nur, was sich wirklich ändert — die
 * Räume, die kein Eintrag betrifft, bleiben dieselben Objekte.
 */
export function applyHostPatch(doc: BimDocument, patch: HostPatch, now: string): HostPatchResult {
  const entries: PatchEntry[] = [];
  const source = typeof patch.source === 'string' ? patch.source.trim() : '';

  if (source === '') {
    // Ohne Absender kein Schreibvorgang: die Spur am Modell wäre wertlos.
    return {
      doc,
      changed: false,
      report: {
        ok: false,
        applied: 0,
        unchanged: 0,
        rejected: 1,
        entries: [
          {
            path: 'source',
            label: 'Absender',
            verdict: 'abgelehnt',
            reason: 'Ohne Angabe, wer schreibt, wird nichts übernommen — die Herkunft der Werte bliebe offen.',
          },
        ],
        summary: 'Nicht übernommen: der Schreibvorgang nennt keinen Absender.',
      },
    };
  }

  let rooms = doc.rooms;
  let constructions = doc.constructions;
  let meta = doc.meta;
  let plant = doc.plant;
  let changed = false;

  // --- Projektkopf ---------------------------------------------------------
  if (patch.project) {
    const next: ProjectMeta = { ...meta };
    let touched = false;
    for (const [key, value] of Object.entries(patch.project)) {
      const feld = PROJECT_FIELDS[key as keyof ProjectPatch];
      if (!feld) {
        entries.push(rejected(`meta.${key}`, key, unknownField(key)));
        continue;
      }
      const before = (meta as unknown as Record<string, unknown>)[key];
      const geprueft = feld.check(value);
      if (geprueft.reason !== undefined) {
        entries.push(rejected(`meta.${key}`, feld.label, geprueft.reason, asPrintable(before)));
        continue;
      }
      if (Object.is(before, geprueft.value)) {
        entries.push(unchangedEntry(`meta.${key}`, feld.label, asPrintable(before)));
        continue;
      }
      (next as unknown as Record<string, unknown>)[key] = geprueft.value;
      touched = true;
      entries.push(applied(`meta.${key}`, feld.label, asPrintable(before), asPrintable(geprueft.value)));
    }
    if (touched) {
      meta = next;
      changed = true;
    }
  }

  // --- Bauteilaufbauten ----------------------------------------------------
  for (const eintrag of patch.constructions ?? []) {
    const id = typeof eintrag?.id === 'string' ? eintrag.id : '';
    if (id === '') {
      entries.push(rejected('constructions', 'Bauteilaufbau', 'Der Eintrag nennt keine Kennung.'));
      continue;
    }
    let bestand = constructions[id];
    const neuAngelegt = bestand === undefined;
    if (!bestand) {
      const anlegen = eintrag.createIfMissing;
      if (!anlegen || typeof anlegen.name !== 'string' || anlegen.name.trim() === '') {
        entries.push(
          rejected(
            `constructions.${id}`,
            'Bauteilaufbau',
            `Kein Aufbau mit der Kennung „${id}". Zum Anlegen gehören Name und Kategorie mit; ein namenloser Aufbau im Katalog wäre wertlos.`,
          ),
        );
        continue;
      }
      /*
       * Ein neuer Aufbau kommt **mit** seinem U-Wert zur Welt oder gar nicht.
       *
       * Bis 1.23.0 stand hier `uValue: 0`. Das war kein Platzhalter, sondern
       * eine Aussage — und zwar die schlimmstmögliche: Jedes Bauteil, dem
       * dieser Aufbau zugewiesen wurde, verlor seinen gesamten
       * Transmissionsverlust. Die 0 kam durch jede Prüfung (sie ist ja kein
       * fehlender Wert), und am Referenzhaus kostete derselbe Mechanismus
       * 29 % der Heizlast und eine Gerätegröße — ohne einen einzigen Hinweis.
       *
       * Warum kein Vorgabewert nach Kategorie statt der 0? Weil eine Kategorie
       * den Aufbau nicht bestimmt: „floor" ist die gedämmte Bodenplatte
       * (0,28) genauso wie die Geschossdecke (0,9). Ein geratener Wert wäre
       * von einem geschriebenen nicht mehr zu unterscheiden — genau der
       * Fehler, den dieses Modul sonst überall vermeidet.
       *
       * Und warum nicht aus `layers` rechnen? Weil `layers` Freitext ist
       * („36,5 Ziegel + 14 cm WDVS"), kein Schichtaufbau mit λ und d. Aus
       * einem Satz einen U-Wert zu rechnen hieße, ihn zu erfinden.
       *
       * Bleibt: ablehnen. Die Gegenstelle setzt `uValue` ohnehin im selben
       * Eintrag — dafür steht das Feld direkt neben `createIfMissing`.
       */
      // `checkNumber` statt `CONSTRUCTION_FIELDS.uValue.check`: Beide prüfen
      // dasselbe, aber nur die erste liefert eine `number` zurück statt eines
      // `unknown`, und hier wird die Zahl unmittelbar gebraucht.
      const startwert = checkNumber(eintrag.uValue, PATCH_RANGES.uValue, 'W/(m²·K)');
      if (startwert.value === undefined) {
        entries.push(
          rejected(
            `constructions.${id}`,
            'Bauteilaufbau',
            `Zum Anlegen des Aufbaus „${anlegen.name.trim()}" gehört sein U-Wert mit. ` +
              `${startwert.reason ?? 'Er fehlt.'} ` +
              'Ein Aufbau ohne U-Wert nimmt jedem zugewiesenen Bauteil seinen Wärmeverlust, ' +
              'und zwar unsichtbar — an der Wand selbst ist nichts zu sehen.',
          ),
        );
        continue;
      }
      bestand = {
        id,
        name: anlegen.name.trim(),
        category: anlegen.category,
        uValue: startwert.value,
      };
      constructions = { ...constructions, [id]: bestand };
      changed = true;
      entries.push(
        applied(
          `constructions.${id}`,
          'Bauteilaufbau angelegt',
          '—',
          `${bestand.name} · U = ${startwert.value} W/(m²·K)`,
        ),
      );
    }

    const next: Construction = { ...bestand };
    let touched = false;
    for (const key of ['uValue', 'thermalBridgeSupplement', 'gValue', 'layers'] as const) {
      const value = eintrag[key];
      if (value === undefined) continue;
      // Beim frisch angelegten Aufbau ist der U-Wert schon eingebaut; er
      // stünde sonst gleich darunter ein zweites Mal in der Historie, einmal
      // als „angelegt" und einmal als „unverändert".
      if (key === 'uValue' && neuAngelegt) continue;
      const feld = CONSTRUCTION_FIELDS[key];
      const before = (bestand as unknown as Record<string, unknown>)[key];
      const geprueft = feld.check(value);
      if (geprueft.reason !== undefined) {
        entries.push(rejected(`constructions.${id}.${key}`, feld.label, geprueft.reason, asPrintable(before)));
        continue;
      }
      if (Object.is(before, geprueft.value)) {
        entries.push(unchangedEntry(`constructions.${id}.${key}`, feld.label, asPrintable(before)));
        continue;
      }
      (next as unknown as Record<string, unknown>)[key] = geprueft.value;
      touched = true;
      entries.push(
        applied(`constructions.${id}.${key}`, `${bestand.name}: ${feld.label}`, asPrintable(before), asPrintable(geprueft.value)),
      );
    }
    for (const key of Object.keys(eintrag)) {
      if (['id', 'uValue', 'thermalBridgeSupplement', 'gValue', 'layers', 'createIfMissing'].includes(key)) continue;
      entries.push(rejected(`constructions.${id}.${key}`, key, unknownField(key)));
    }
    if (touched) {
      constructions = { ...constructions, [id]: next };
      changed = true;
    }
  }

  // --- Räume ---------------------------------------------------------------
  for (const eintrag of patch.rooms ?? []) {
    const id = typeof eintrag?.id === 'string' ? eintrag.id : '';
    if (id === '') {
      entries.push(rejected('rooms', 'Raum', 'Der Eintrag nennt keine Raum-Kennung.'));
      continue;
    }
    const bestand = rooms[id];
    if (!bestand) {
      entries.push(
        rejected(
          `rooms.${id}`,
          'Raum',
          `Kein Raum mit der Kennung „${id}". Die Kennungen stehen im Export; Räume werden hier nicht angelegt, sondern gezeichnet.`,
        ),
      );
      continue;
    }

    const next: Room = { ...bestand };
    let touched = false;

    for (const key of ['setpointTemperature', 'airChangeRate', 'isHeated', 'floorUValue', 'ceilingUValue'] as const) {
      const value = eintrag[key];
      if (value === undefined) continue;
      const feld = ROOM_FIELDS[key];
      const before = (bestand as unknown as Record<string, unknown>)[key];
      const geprueft = feld.check(value);
      if (geprueft.reason !== undefined) {
        entries.push(rejected(`rooms.${id}.${key}`, `${bestand.name}: ${feld.label}`, geprueft.reason, asPrintable(before)));
        continue;
      }
      if (Object.is(before, geprueft.value)) {
        entries.push(unchangedEntry(`rooms.${id}.${key}`, `${bestand.name}: ${feld.label}`, asPrintable(before)));
        continue;
      }
      (next as unknown as Record<string, unknown>)[key] = geprueft.value;
      touched = true;
      entries.push(
        applied(`rooms.${id}.${key}`, `${bestand.name}: ${feld.label}`, asPrintable(before), asPrintable(geprueft.value)),
      );
    }

    if (eintrag.heatLoad !== undefined) {
      const last = readHeatLoad(eintrag.heatLoad, source, now, doc.meta.modifiedAt);
      if (last.reason !== undefined || last.value === undefined) {
        entries.push(
          rejected(
            `rooms.${id}.heatLoad`,
            `${bestand.name}: Norm-Heizlast`,
            last.reason ?? 'Die Angabe konnte nicht gelesen werden.',
            bestand.normHeatLoad?.total,
          ),
        );
      } else if (bestand.normHeatLoad && sameLoad(bestand.normHeatLoad, last.value)) {
        entries.push(unchangedEntry(`rooms.${id}.heatLoad`, `${bestand.name}: Norm-Heizlast`, bestand.normHeatLoad.total));
      } else {
        next.normHeatLoad = last.value;
        touched = true;
        entries.push(
          applied(
            `rooms.${id}.heatLoad`,
            `${bestand.name}: Norm-Heizlast`,
            bestand.normHeatLoad?.total ?? '—',
            last.value.total,
          ),
        );
      }
    }

    for (const key of Object.keys(eintrag)) {
      if (['id', 'setpointTemperature', 'airChangeRate', 'isHeated', 'floorUValue', 'ceilingUValue', 'heatLoad'].includes(key)) {
        continue;
      }
      const schutz = PROTECTED_FIELDS[key];
      entries.push(rejected(`rooms.${id}.${key}`, `${bestand.name}: ${key}`, schutz ?? unknownField(key)));
    }

    if (touched) {
      rooms = { ...rooms, [id]: next };
      changed = true;
    }
  }

  // --- Gesamte Heizlast ----------------------------------------------------
  if (patch.totalHeatLoad !== undefined) {
    const geprueft = checkNumber(patch.totalHeatLoad, PATCH_RANGES.heatLoad, 'W');
    const before = plant.heatLoadOverride;
    if (geprueft.reason !== undefined) {
      entries.push(rejected('plant.heatLoadOverride', 'Norm-Heizlast des Gebäudes', geprueft.reason, before));
    } else if (Object.is(before, geprueft.value)) {
      entries.push(unchangedEntry('plant.heatLoadOverride', 'Norm-Heizlast des Gebäudes', before));
    } else {
      plant = { ...plant, heatLoadOverride: geprueft.value };
      changed = true;
      entries.push(applied('plant.heatLoadOverride', 'Norm-Heizlast des Gebäudes', before ?? '—', geprueft.value));
    }
  }

  // --- Heizflächen ---------------------------------------------------------
  //
  // Der Rückweg für das Ergebnis der Auslegung. Geschrieben wird in
  // `Fixture.params`, plus `length` als einziges Geometriemaß — die Baulänge
  // folgt aus der gewählten Type und ist deshalb ein Auslegungsergebnis, kein
  // Zeichnerentscheid.
  let fixtures = doc.fixtures;
  for (const eintrag of patch.fixtures ?? []) {
    const id = typeof eintrag?.id === 'string' ? eintrag.id : '';
    if (id === '') {
      entries.push(rejected('fixtures', 'Heizfläche', 'Der Eintrag nennt keine Kennung.'));
      continue;
    }
    const bestand = fixtures[id] as Fixture | undefined;
    if (!bestand) {
      entries.push(
        rejected(
          `fixtures.${id}`,
          'Heizfläche',
          'Unter dieser Kennung steht im Modell kein Objekt. Heizflächen werden gezeichnet, nicht von außen angelegt.',
        ),
      );
      continue;
    }
    if (bestand.category !== 'heating') {
      entries.push(
        rejected(
          `fixtures.${id}`,
          bestand.label ?? bestand.type,
          'Das Objekt ist keine Heizfläche. Geschrieben werden nur Auslegungsergebnisse der Heizung.',
        ),
      );
      continue;
    }

    let params: FixtureParams = bestand.params;
    let laenge = bestand.length;
    let beruehrt = false;
    for (const [key, value] of Object.entries(eintrag)) {
      if (key === 'id') continue;
      const feld = FIXTURE_FIELDS[key as keyof Omit<FixturePatch, 'id'>];
      if (!feld) {
        entries.push(rejected(`fixtures.${id}.${key}`, key, unknownField(key)));
        continue;
      }
      const pfad = `fixtures.${id}.${key}`;
      const before = key === 'length' ? bestand.length : (params as unknown as Record<string, unknown>)[key];
      const geprueft = feld.check(value);
      if (geprueft.reason !== undefined) {
        entries.push(rejected(pfad, feld.label, geprueft.reason, asPrintable(before)));
        continue;
      }
      if (Object.is(before, geprueft.value)) {
        entries.push(unchangedEntry(pfad, feld.label, asPrintable(before)));
        continue;
      }
      if (key === 'length') laenge = geprueft.value as number;
      else params = { ...params, [key]: geprueft.value };
      beruehrt = true;
      entries.push(applied(pfad, feld.label, asPrintable(before), asPrintable(geprueft.value)));
    }
    if (beruehrt) {
      fixtures = { ...fixtures, [id]: { ...bestand, length: laenge, params } };
      changed = true;
    }
  }

  const appliedCount = entries.filter((e) => e.verdict === 'übernommen').length;
  const unchangedCount = entries.filter((e) => e.verdict === 'unverändert').length;
  const rejectedCount = entries.filter((e) => e.verdict === 'abgelehnt').length;
  const report: HostPatchReport = {
    ok: rejectedCount === 0,
    applied: appliedCount,
    unchanged: unchangedCount,
    rejected: rejectedCount,
    entries,
    summary: summarize(source, appliedCount, unchangedCount, rejectedCount),
  };

  if (!changed) return { doc, changed: false, report };

  return {
    doc: {
      ...doc,
      rooms,
      constructions,
      fixtures,
      plant,
      meta: {
        ...meta,
        modifiedAt: now,
        lastHostPatch: {
          at: now,
          source,
          applied: appliedCount,
          rejected: rejectedCount,
          unchanged: unchangedCount,
          summary: report.summary,
        },
      },
    },
    changed: true,
    report,
  };
}

/**
 * Selbstauskunft der Schnittstelle.
 *
 * Eine Gegenstelle soll nicht ausprobieren müssen, was geht. Sie fragt, was
 * schreibbar ist und in welchen Grenzen — dann kann sie ihre eigene Maske
 * daraus bauen und muss nicht mitwachsen, wenn hier etwas dazukommt.
 */
export function writableFields(): {
  path: string;
  label: string;
  unit?: string;
  range?: readonly [number, number];
  values?: readonly string[];
}[] {
  const liste: ReturnType<typeof writableFields> = [];
  for (const [key, feld] of Object.entries(PROJECT_FIELDS)) {
    liste.push({ path: `project.${key}`, label: feld.label, unit: feld.unit, range: feld.range, values: feld.values });
  }
  for (const [key, feld] of Object.entries(ROOM_FIELDS)) {
    liste.push({ path: `rooms[].${key}`, label: feld.label, unit: feld.unit, range: feld.range });
  }
  liste.push({ path: 'rooms[].heatLoad.total', label: 'Norm-Heizlast des Raums', unit: 'W', range: PATCH_RANGES.heatLoad });
  liste.push({ path: 'rooms[].heatLoad.transmission', label: 'davon Transmission', unit: 'W', range: PATCH_RANGES.heatLoad });
  liste.push({ path: 'rooms[].heatLoad.ventilation', label: 'davon Lüftung', unit: 'W', range: PATCH_RANGES.heatLoad });
  liste.push({ path: 'rooms[].heatLoad.reheat', label: 'davon Wiederaufheizung', unit: 'W', range: PATCH_RANGES.heatLoad });
  for (const [key, feld] of Object.entries(CONSTRUCTION_FIELDS)) {
    liste.push({ path: `constructions[].${key}`, label: feld.label, unit: feld.unit, range: feld.range });
  }
  for (const [key, feld] of Object.entries(FIXTURE_FIELDS)) {
    liste.push({ path: `fixtures[].${key}`, label: feld.label, unit: feld.unit, range: feld.range, values: feld.values });
  }
  liste.push({ path: 'totalHeatLoad', label: 'Norm-Heizlast des Gebäudes', unit: 'W', range: PATCH_RANGES.heatLoad });
  return liste;
}

// ===========================================================================
// Feldtabellen
// ===========================================================================

interface Feld {
  label: string;
  unit?: string;
  range?: readonly [number, number];
  values?: readonly string[];
  check: (value: unknown) => { value?: unknown; reason?: string };
}

/**
 * Grenzen für die Auslegungsergebnisse.
 *
 * Sie sind weit gefasst, aber nicht offen: eine Norm-Wärmeleistung von 50 kW
 * an einem einzelnen Heizkörper ist kein Auslegungsergebnis, sondern ein
 * Einheitenfehler, und ein Exponent von 3 gibt es an keinem Gerät. Die
 * Schnittstelle weist solche Werte ab und sagt warum, statt sie ins Modell zu
 * lassen und später unerklärliche Zahlen zu erzeugen.
 */
const FIXTURE_RANGES = {
  powerW: [0, 20000] as const,
  /** DIN EN 442-2: die Exponenten liegen bei Raumheizkörpern zwischen 1,1 und 1,5. */
  exponent: [1.0, 1.6] as const,
  height: [0.1, 3.0] as const,
  sections: [1, 60] as const,
  length: [0.1, 20] as const,
  temperature: [10, 95] as const,
  loopSpacing: [0.05, 0.5] as const,
  loopCount: [1, 20] as const,
  screedCover: [0.01, 0.15] as const,
  /** Fliese ≈ 0, Teppich ≈ 0,15; darüber wäre der Boden keine Heizfläche mehr. */
  floorCovering: [0, 0.2] as const,
  pipeOuter: [0.005, 0.05] as const,
  pipeWall: [0.001, 0.01] as const,
};

const FIXTURE_FIELDS: Record<keyof Omit<FixturePatch, 'id'>, Feld> = {
  powerW: { label: 'Normwärmeleistung', unit: 'W', range: FIXTURE_RANGES.powerW, check: (v) => checkNumber(v, FIXTURE_RANGES.powerW, 'W') },
  radiatorType: { label: 'Bauart/Typ', check: (v) => checkText(v) },
  radiatorExponent: {
    label: 'Heizkörperexponent n',
    range: FIXTURE_RANGES.exponent,
    check: (v) => checkNumber(v, FIXTURE_RANGES.exponent, '-'),
  },
  radiatorHeight: { label: 'Bauhöhe', unit: 'm', range: FIXTURE_RANGES.height, check: (v) => checkNumber(v, FIXTURE_RANGES.height, 'm') },
  radiatorSections: { label: 'Gliederzahl', range: FIXTURE_RANGES.sections, check: (v) => checkNumber(v, FIXTURE_RANGES.sections, '-') },
  radiatorConnection: {
    label: 'Anschlussart',
    values: Object.keys(RADIATOR_CONNECTION_LABELS) as RadiatorConnection[],
    check: (v) => checkEnum(v, Object.keys(RADIATOR_CONNECTION_LABELS)),
  },
  length: { label: 'Baulänge', unit: 'm', range: FIXTURE_RANGES.length, check: (v) => checkNumber(v, FIXTURE_RANGES.length, 'm') },
  flowTemperature: { label: 'Vorlauftemperatur', unit: '°C', range: FIXTURE_RANGES.temperature, check: (v) => checkNumber(v, FIXTURE_RANGES.temperature, '°C') },
  returnTemperature: { label: 'Rücklauftemperatur', unit: '°C', range: FIXTURE_RANGES.temperature, check: (v) => checkNumber(v, FIXTURE_RANGES.temperature, '°C') },
  loopSpacing: { label: 'Verlegeabstand', unit: 'm', range: FIXTURE_RANGES.loopSpacing, check: (v) => checkNumber(v, FIXTURE_RANGES.loopSpacing, 'm') },
  loopCount: { label: 'Zahl der Heizkreise', range: FIXTURE_RANGES.loopCount, check: (v) => checkNumber(v, FIXTURE_RANGES.loopCount, '-') },
  screedCover: { label: 'Estrichüberdeckung', unit: 'm', range: FIXTURE_RANGES.screedCover, check: (v) => checkNumber(v, FIXTURE_RANGES.screedCover, 'm') },
  floorCoveringResistance: {
    label: 'Belagswiderstand R_λB',
    unit: 'm²K/W',
    range: FIXTURE_RANGES.floorCovering,
    check: (v) => checkNumber(v, FIXTURE_RANGES.floorCovering, 'm²K/W'),
  },
  pipeOuterDiameter: { label: 'Rohraußendurchmesser', unit: 'm', range: FIXTURE_RANGES.pipeOuter, check: (v) => checkNumber(v, FIXTURE_RANGES.pipeOuter, 'm') },
  pipeWallThickness: { label: 'Rohrwandstärke', unit: 'm', range: FIXTURE_RANGES.pipeWall, check: (v) => checkNumber(v, FIXTURE_RANGES.pipeWall, 'm') },
  note: { label: 'Fabrikat und Typ', check: (v) => checkText(v) },
};

const PROJECT_FIELDS: Record<keyof ProjectPatch, Feld> = {
  designOutdoorTemperature: {
    label: 'Norm-Außentemperatur',
    unit: '°C',
    range: PATCH_RANGES.designOutdoorTemperature,
    check: (v) => checkNumber(v, PATCH_RANGES.designOutdoorTemperature, '°C'),
  },
  designIndoorTemperature: {
    label: 'Standard-Innentemperatur',
    unit: '°C',
    range: PATCH_RANGES.designIndoorTemperature,
    check: (v) => checkNumber(v, PATCH_RANGES.designIndoorTemperature, '°C'),
  },
  n50: { label: 'Luftdichtheit n50', unit: '1/h', range: PATCH_RANGES.n50, check: (v) => checkNumber(v, PATCH_RANGES.n50, '1/h') },
  shielding: {
    label: 'Abschirmungsklasse',
    values: ['none', 'moderate', 'high'],
    check: (v) => checkEnum(v, ['none', 'moderate', 'high']),
  },
  unheatedTemperature: {
    label: 'Temperatur unbeheizter Bereiche',
    unit: '°C',
    range: PATCH_RANGES.unheatedTemperature,
    check: (v) => checkNumber(v, PATCH_RANGES.unheatedTemperature, '°C'),
  },
  groundTemperature: {
    label: 'Erdreichtemperatur',
    unit: '°C',
    range: PATCH_RANGES.groundTemperature,
    check: (v) => checkNumber(v, PATCH_RANGES.groundTemperature, '°C'),
  },
  thermalBridgeSupplement: {
    label: 'Wärmebrückenzuschlag',
    unit: 'W/(m²·K)',
    range: PATCH_RANGES.thermalBridgeSupplement,
    check: (v) => checkNumber(v, PATCH_RANGES.thermalBridgeSupplement, 'W/(m²·K)'),
  },
  thermalBridgeMethod: {
    label: 'Wärmebrückenverfahren',
    values: ['flat', 'detailed'],
    check: (v) => checkEnum(v, ['flat', 'detailed']),
  },
  reheatFactor: {
    label: 'Wiederaufheizfaktor f_RH',
    unit: 'W/m²',
    range: PATCH_RANGES.reheatFactor,
    check: (v) => checkNumber(v, PATCH_RANGES.reheatFactor, 'W/m²'),
  },
};

const ROOM_FIELDS: Record<
  'setpointTemperature' | 'airChangeRate' | 'isHeated' | 'floorUValue' | 'ceilingUValue',
  Feld
> = {
  setpointTemperature: {
    label: 'Solltemperatur',
    unit: '°C',
    range: PATCH_RANGES.setpointTemperature,
    check: (v: unknown) => checkNumber(v, PATCH_RANGES.setpointTemperature, '°C'),
  },
  airChangeRate: {
    label: 'Luftwechselrate',
    unit: '1/h',
    range: PATCH_RANGES.airChangeRate,
    check: (v: unknown) => checkNumber(v, PATCH_RANGES.airChangeRate, '1/h'),
  },
  isHeated: {
    label: 'beheizt',
    check: (v: unknown) =>
      typeof v === 'boolean' ? { value: v } : { reason: 'Erwartet wird ja oder nein (true/false).' },
  },
  floorUValue: {
    label: 'U-Wert Boden',
    unit: 'W/(m²·K)',
    range: PATCH_RANGES.uValue,
    check: (v: unknown) => checkNumber(v, PATCH_RANGES.uValue, 'W/(m²·K)'),
  },
  ceilingUValue: {
    label: 'U-Wert Decke',
    unit: 'W/(m²·K)',
    range: PATCH_RANGES.uValue,
    check: (v: unknown) => checkNumber(v, PATCH_RANGES.uValue, 'W/(m²·K)'),
  },
};

const CONSTRUCTION_FIELDS: Record<'uValue' | 'thermalBridgeSupplement' | 'gValue' | 'layers', Feld> = {
  uValue: {
    label: 'U-Wert',
    unit: 'W/(m²·K)',
    range: PATCH_RANGES.uValue,
    check: (v: unknown) => checkNumber(v, PATCH_RANGES.uValue, 'W/(m²·K)'),
  },
  thermalBridgeSupplement: {
    label: 'Wärmebrückenzuschlag',
    unit: 'W/(m²·K)',
    range: PATCH_RANGES.thermalBridgeSupplement,
    check: (v: unknown) => checkNumber(v, PATCH_RANGES.thermalBridgeSupplement, 'W/(m²·K)'),
  },
  gValue: {
    label: 'g-Wert',
    unit: '-',
    range: PATCH_RANGES.gValue,
    check: (v: unknown) => checkNumber(v, PATCH_RANGES.gValue, '-'),
  },
  layers: {
    label: 'Schichtenbeschreibung',
    check: (v: unknown) =>
      typeof v === 'string' && v.trim() !== ''
        ? { value: v.trim() }
        : { reason: 'Erwartet wird ein nicht leerer Text.' },
  },
};

// ===========================================================================
// Prüfen
// ===========================================================================

function checkNumber(value: unknown, range: readonly [number, number], unit: string): { value?: number; reason?: string } {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { reason: `Erwartet wird eine Zahl in ${unit}; angekommen ist ${describe(value)}.` };
  }
  const [min, max] = range;
  if (value < min || value > max) {
    return {
      reason: `${format(value)} ${unit} liegt außerhalb des Bereichs ${format(min)} bis ${format(max)} ${unit}. Meist steckt eine falsche Einheit dahinter.`,
    };
  }
  // Auf sechs Nachkommastellen runden: ein aus einer Rechnung kommender Wert
  // wie 0,30000000000000004 wäre sonst dauerhaft „geändert" und würde bei
  // jedem Schreibvorgang erneut in der Historie landen.
  return { value: Math.round(value * 1e6) / 1e6 };
}

/**
 * Ein Freitextfeld — Fabrikat, Typenbezeichnung.
 *
 * Begrenzt auf 120 Zeichen: was länger ist, ist keine Typenbezeichnung,
 * sondern eine Beschreibung, und die gehört nicht an ein Symbol im Plan.
 * Leerer Text löscht das Feld nicht, sondern wird abgewiesen — Löschen ist
 * eine Absicht, die man aussprechen muss, kein Nebenprodukt eines leeren
 * Eingabefelds auf der Gegenseite.
 */
function checkText(value: unknown): { value?: string; reason?: string } {
  if (typeof value !== 'string') return { reason: 'Erwartet wird Text.' };
  const t = value.trim();
  if (t === '') return { reason: 'Leerer Text. Zum Löschen gibt es keinen Weg über diese Schnittstelle.' };
  if (t.length > 120) return { reason: `Zu lang (${t.length} Zeichen, höchstens 120).` };
  return { value: t };
}

function checkEnum(value: unknown, erlaubt: readonly string[]): { value?: string; reason?: string } {
  if (typeof value === 'string' && erlaubt.includes(value)) return { value };
  return { reason: `Erlaubt sind ${erlaubt.map((e) => `„${e}"`).join(', ')}; angekommen ist ${describe(value)}.` };
}

interface HeatLoadReading {
  value?: RoomHeatLoad;
  reason?: string;
}

function readHeatLoad(value: unknown, source: string, now: string, modelState: string): HeatLoadReading {
  if (typeof value !== 'object' || value === null) {
    return { reason: `Erwartet wird ein Objekt mit „total"; angekommen ist ${describe(value)}.` };
  }
  const roh = value as Record<string, unknown>;
  const total = checkNumber(roh.total, PATCH_RANGES.heatLoad, 'W');
  if (total.reason !== undefined) return { reason: total.reason };

  const teile: Partial<RoomHeatLoad> = {};
  for (const key of ['transmission', 'ventilation', 'reheat'] as const) {
    if (roh[key] === undefined) continue;
    const teil = checkNumber(roh[key], PATCH_RANGES.heatLoad, 'W');
    if (teil.reason !== undefined) return { reason: `${key}: ${teil.reason}` };
    teile[key] = teil.value;
  }

  // Gegenprobe der Aufteilung: sind alle drei Anteile angegeben, müssen sie
  // die Summe ergeben. Eine Aufteilung, die nicht aufgeht, ist entweder ein
  // Fehler der Gegenstelle oder eine andere Definition von „gesamt" — beides
  // muss auffallen, bevor damit eine Fußbodenheizung ausgelegt wird.
  const summe = (teile.transmission ?? 0) + (teile.ventilation ?? 0) + (teile.reheat ?? 0);
  const vollstaendig = teile.transmission !== undefined && teile.ventilation !== undefined;
  if (vollstaendig && Math.abs(summe - (total.value ?? 0)) > Math.max(1, (total.value ?? 0) * 0.01)) {
    return {
      reason: `Die Anteile ergeben ${format(summe)} W, angegeben sind ${format(total.value ?? 0)} W gesamt. Die Aufteilung geht nicht auf.`,
    };
  }

  return {
    value: {
      total: total.value ?? 0,
      ...teile,
      source,
      receivedAt: now,
      modelState,
    },
  };
}

function sameLoad(a: RoomHeatLoad, b: RoomHeatLoad): boolean {
  // Herkunft und Zeitstempel bleiben bewusst außen vor: ein zweiter
  // Schreibvorgang mit denselben Zahlen ist keine Änderung am Modell, auch
  // wenn die Uhr weitergelaufen ist.
  return (
    a.total === b.total &&
    a.transmission === b.transmission &&
    a.ventilation === b.ventilation &&
    a.reheat === b.reheat
  );
}

// ===========================================================================
// Berichtstexte
// ===========================================================================

const applied = (path: string, label: string, before?: PatchEntry['before'], after?: PatchEntry['after']): PatchEntry => ({
  path,
  label,
  verdict: 'übernommen',
  before,
  after,
});

const unchangedEntry = (path: string, label: string, before?: PatchEntry['before']): PatchEntry => ({
  path,
  label,
  verdict: 'unverändert',
  before,
  after: before,
});

const rejected = (path: string, label: string, reason: string, before?: PatchEntry['before']): PatchEntry => ({
  path,
  label,
  verdict: 'abgelehnt',
  before,
  reason,
});

const unknownField = (key: string): string =>
  `Das Feld „${key}" gibt es in dieser Schnittstelle nicht. Was schreibbar ist, sagt „getWritableFields".`;

function summarize(source: string, applied: number, unchanged: number, rejected: number): string {
  const teile: string[] = [];
  teile.push(applied === 1 ? '1 Wert übernommen' : `${applied} Werte übernommen`);
  if (unchanged > 0) teile.push(unchanged === 1 ? '1 unverändert' : `${unchanged} unverändert`);
  if (rejected > 0) teile.push(rejected === 1 ? '1 abgelehnt' : `${rejected} abgelehnt`);
  return `${source}: ${teile.join(', ')}.`;
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'nichts';
  if (typeof value === 'string') return `der Text „${value}"`;
  if (typeof value === 'number') return Number.isFinite(value) ? format(value) : 'keine endliche Zahl';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return 'eine Liste';
  return 'ein Objekt';
}

function format(value: number): string {
  return value.toLocaleString('de-DE', { maximumFractionDigits: 3 });
}

function asPrintable(value: unknown): PatchEntry['before'] {
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') return value;
  return undefined;
}
