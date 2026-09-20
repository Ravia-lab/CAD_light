
/**
 * Beschriften in der begehbaren Ansicht.
 * ---------------------------------------------------------------------------
 * Wer im Haus steht und einen Heizkörper anschaut, will „2000 W" daneben
 * schreiben. Die naheliegende Lösung wäre ein Textfeld. Sie ist die falsche.
 *
 * **Warum hier nichts getippt wird.** Eine getippte Zahl ist ab dem Moment
 * des Tippens eine zweite, unabhängige Wahrheit. Wird der Heizkörper später
 * auf 1600 W geändert — im Inspektor, beim Import eines Datenblatts, durch
 * den Rohrausleger —, bleibt auf der Fahne 2000 W stehen. Niemand merkt es,
 * weil beide Zahlen für sich plausibel aussehen, und im Plan steht am Ende
 * die falsche.
 *
 * Deshalb bietet dieses Modul an, was das Modell ohnehin weiß, und schreibt
 * mit, **woher** der Text stammt (`AnnotationQuelle`). Läuft die Abschrift
 * später vom Modellwert weg, kann der Plan das melden, statt es zu drucken.
 * Freier Text bleibt möglich — dann steht keine Quelle daran, und niemand
 * behauptet, das Programm hätte die Zahl geprüft.
 *
 * Schichtgrenze: nur Typen, keine Zustandshaltung, keine Komponenten.
 */

import type {
  Annotation,
  AnnotationAnchor,
  AnnotationQuelle,
  BimDocument,
  Durchbruch,
  Fixture,
  PipeRun,
} from '../types/bim';
import {
  FIXTURE_BY_TYPE,
  PIPE_SERVICE_LABELS,
  RADIATOR_CONNECTION_LABELS,
  VENTILSEITE_LABELS,
  DURCHBRUCH_LABELS,
} from '../types/bim';
import { rohrbezeichnung } from './rohrbezeichnung';

/** Ein Wert, den das Modell zur Beschriftung anbietet. */
export interface Beschriftungsvorschlag {
  quelle: AnnotationQuelle;
  /** Was auf der Fahne stünde. */
  text: string;
  /** Wofür es steht — für die Auswahlliste. */
  hinweis: string;
}

/** Deutsche Zahl mit fester Nachkommastelle, ohne Exponentialschreibweise. */
function zahl(v: number, stellen: number): string {
  return v.toFixed(stellen).replace('.', ',');
}

/**
 * Die Höhe über Fertigfußboden als Text, so wie sie im Plan steht.
 *
 * Mit Vorzeichen — `+0,85 m`. Das Pluszeichen ist kein Schmuck: unter der
 * Decke abgehängte Leitungen und Bauteile unter dem Estrich bekommen beide
 * eine Höhe, und ohne Vorzeichen sähe eine Leitung bei −0,10 m aus wie eine
 * bei 0,10 m, sobald jemand das Minus für einen Bindestrich hält.
 */
export function hoehenText(elevation: number): string {
  const v = Math.round(elevation * 1000) / 1000;
  return `${v < 0 ? '−' : '+'}${zahl(Math.abs(v), 2)} m`;
}

/**
 * Was das Modell über ein Bauteil zu sagen hat.
 *
 * Die Reihenfolge ist die der Nützlichkeit, nicht die der Datenstruktur: Bei
 * einem Heizkörper ist die Leistung das, was auf einer Fahne im Raum steht;
 * die Bezeichnung steht ohnehin am Symbol. Leere Felder erzeugen keinen
 * Vorschlag — ein Vorschlag „— W" wäre schlimmer als gar keiner.
 */
export function beschriftungsVorschlaege(
  doc: BimDocument,
  anchor: AnnotationAnchor,
): Beschriftungsvorschlag[] {
  const aus: Beschriftungsvorschlag[] = [];
  if (anchor.kind === 'fixture') {
    const f: Fixture | undefined = doc.fixtures[anchor.id];
    if (!f) return aus;
    const p = f.params;
    if (p.powerW !== undefined) {
      aus.push({ quelle: 'leistung', text: `${Math.round(p.powerW)} W`, hinweis: 'Normwärmeleistung' });
    }
    if (p.airflow !== undefined) {
      aus.push({ quelle: 'leistung', text: `${Math.round(p.airflow)} m³/h`, hinweis: 'Volumenstrom' });
    }
    if (p.volumeL !== undefined) {
      aus.push({ quelle: 'volumen', text: `${Math.round(p.volumeL)} l`, hinweis: 'Speicherinhalt' });
    }
    if (p.radiatorType) {
      aus.push({ quelle: 'typ', text: `Typ ${p.radiatorType}`, hinweis: 'Bauart' });
    }
    if (p.radiatorConnection) {
      const seite = p.valveSide ? ` · ${VENTILSEITE_LABELS[p.valveSide]}` : '';
      aus.push({
        quelle: 'anschluss',
        text: `${RADIATOR_CONNECTION_LABELS[p.radiatorConnection]}${seite}`,
        hinweis: 'Anschlussart',
      });
    }
    aus.push({ quelle: 'hoehe', text: hoehenText(f.elevation), hinweis: 'Montagehöhe über FFB' });
    aus.push({
      quelle: 'mass',
      text: `${zahl(f.length, 2)} × ${zahl(f.depth, 2)} m`,
      hinweis: 'Baulänge × Bautiefe',
    });
    aus.push({
      quelle: 'name',
      text: f.label ?? FIXTURE_BY_TYPE[f.type]?.label ?? 'Objekt',
      hinweis: 'Bezeichnung',
    });
    return aus;
  }

  if (anchor.kind === 'pipe') {
    const r: PipeRun | undefined = (doc.pipes ?? {})[anchor.id];
    if (!r) return aus;
    aus.push({ quelle: 'dn', text: rohrbezeichnung(r), hinweis: 'Abmessung' });
    aus.push({ quelle: 'medium', text: PIPE_SERVICE_LABELS[r.service], hinweis: 'Medium' });
    aus.push({ quelle: 'hoehe', text: hoehenText(r.elevation), hinweis: 'Verlegehöhe über FFB' });
    if (r.insulation > 0) {
      aus.push({ quelle: 'mass', text: `${r.insulation} mm Dämmung`, hinweis: 'Dämmstärke' });
    }
    if (r.label) aus.push({ quelle: 'name', text: r.label, hinweis: 'Bezeichnung' });
    return aus;
  }

  const d: Durchbruch | undefined = (doc.durchbrueche ?? {})[anchor.id];
  if (!d) return aus;
  aus.push({ quelle: 'name', text: d.name || DURCHBRUCH_LABELS[d.kind], hinweis: 'Bezeichnung' });
  if (d.diameter !== undefined) {
    aus.push({ quelle: 'mass', text: `Ø${Math.round(d.diameter * 1000)}`, hinweis: 'Durchmesser in mm' });
  } else if (d.width !== undefined && d.height !== undefined) {
    aus.push({
      quelle: 'mass',
      text: `${Math.round(d.width * 1000)} × ${Math.round(d.height * 1000)}`,
      hinweis: 'Breite × Höhe in mm',
    });
  }
  if (d.sillHeight !== undefined) {
    aus.push({ quelle: 'hoehe', text: hoehenText(d.sillHeight), hinweis: 'Unterkante über FFB' });
  }
  if (d.dn !== undefined) aus.push({ quelle: 'dn', text: `DN ${d.dn}`, hinweis: 'Nennweite der Leitung' });
  return aus;
}

/**
 * Der aktuelle Modellwert zu einer Quelle — oder `null`.
 *
 * Damit prüft der Plan, ob die Abschrift noch stimmt. Gesucht wird über
 * dieselbe Liste, die auch die Auswahl speist: Es kann gar nicht passieren,
 * dass etwas angeboten, aber nicht nachgeprüft wird.
 */
export function modellwert(doc: BimDocument, anchor: AnnotationAnchor): string | null {
  if (!anchor.quelle) return null;
  const treffer = beschriftungsVorschlaege(doc, anchor).find((v) => v.quelle === anchor.quelle);
  return treffer ? treffer.text : null;
}

/**
 * Ist die Abschrift vom Modell weggelaufen?
 *
 * `false` heißt hier ausdrücklich nicht „geprüft und in Ordnung", sondern
 * „kein Widerspruch feststellbar": Bei freiem Text (keine Quelle) und bei
 * gelöschtem Anker gibt es nichts zu vergleichen.
 */
export function beschriftungVeraltet(doc: BimDocument, note: Annotation): boolean {
  if (!note.anchor?.quelle || note.text === undefined) return false;
  const jetzt = modellwert(doc, note.anchor);
  return jetzt !== null && jetzt !== note.text;
}

/**
 * Der Text, der im **Grundriss** steht.
 *
 * Eine in 3D gesetzte Fahne bekommt die Höhe angehängt — das war die
 * ausdrückliche Festlegung: sie soll im Plan erscheinen, und zwar mit
 * Höhenangabe. Eine gewöhnliche Planbeschriftung bleibt, wie sie ist.
 */
export function planText(note: Annotation): string {
  const grund = note.text ?? '';
  if (note.elevation === undefined) return grund;
  const h = hoehenText(note.elevation);
  if (!grund) return h;
  return `${grund} · ${h}`;
}
