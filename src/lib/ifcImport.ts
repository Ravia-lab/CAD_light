/**
 * IFC4-Import (STEP / ISO-10303-21).
 * ---------------------------------------------------------------------------
 * Der wertvollste Grundriss ist der, den jemand anderes schon gezeichnet hat.
 * Wer eine IFC-Datei vom Architekten bekommt, soll sie nicht abpausen müssen:
 * Geschosse, Wände und Öffnungen stehen darin bereits maßhaltig.
 *
 * Gelesen wird ein bewusst schmaler Ausschnitt — genau das, woraus sich ein
 * Grundriss rekonstruieren lässt:
 *
 *   IfcBuildingStorey  → Geschoss (Höhenlage, Name)
 *   IfcWall*           → Achse und Dicke aus Axis/Body-Repräsentation
 *   IfcOpeningElement  → Öffnung, über IfcRelVoidsElement der Wand zugeordnet
 *   IfcWindow/IfcDoor  → Art der Öffnung, über IfcRelFillsElement
 *
 * Was nicht gelesen wird — Materialien, Bauteilaufbauten, Bewehrung,
 * Möblierung — fehlt bewusst: es wäre Datenballast für ein Werkzeug, dessen
 * Zweck die Heizlast ist. Der Import liefert deshalb einen *Vorschlag*, kein
 * fertiges Modell; geprüft und ergänzt wird danach im Editor.
 *
 * Der Parser ist ein einfacher, aber vollständiger STEP-Leser: er kommt mit
 * mehrzeiligen Entities, Zeichenketten mit Apostrophen und geschachtelten
 * Listen zurecht. Genau daran scheitern naive Zeilen-Parser.
 */

import type { BimNode, Opening, OpeningKind, Vec2, Wall, WallType } from '../types/bim';
import { VORGABE_U } from './uwert';

/*
 * U-Werte beim Import — **eine Quelle für die Wand, eine begründete Ausnahme
 * für die Öffnung.**
 *
 * Die Wand bekommt den Vorgabewert ihrer Bauteilart aus `uwert.ts`. Vorher
 * stand hier `wallType === 'exterior' ? 0.24 : 1.2`: dieselben Zahlen wie im
 * Vorgabekatalog, nur an einer zweiten Stelle geschrieben und schon
 * auseinandergelaufen — „nicht außen" wurde pauschal mit dem Wert der
 * *Innenwand* belegt, auch wo `guessWallType` eine Trenn- oder Schachtwand
 * erkannt hatte. Der Katalog führt für die beiden 1,4 statt 1,2. Über
 * `VORGABE_U[wallType]` kann das nicht mehr auseinanderlaufen.
 *
 * **Warum überhaupt ein Wert am Bauteil steht.** Zahlengleich wäre es, gar
 * keinen zu schreiben: `uwert.ts` setzt denselben Vorgabewert ein, wenn am
 * Bauteil nichts steht. Der Unterschied liegt allein in der Herkunft —
 * geschrieben heißt „am Bauteil erfasst", weggelassen heißt „angenommen".
 * Ehrlicher wäre Weglassen, denn eine IFC-Datei ohne U-Wert-Pset hat nichts
 * erfasst. Es bleibt trotzdem beim Schreiben, weil `validation.ts` sonst für
 * **jede** importierte Wand und jede Öffnung eine Meldung erzeugt: An einem
 * mittleren Scan sind das über hundert Hinweise, die alle dasselbe sagen,
 * und eine Prüfliste, in der hundert gleiche Meldungen stehen, wird nicht
 * gelesen — damit auch die eine nicht, auf die es ankommt. Sobald der Import
 * die Herkunft je Bauteil führen kann, gehört diese Entscheidung umgedreht.
 *
 * **Die Öffnung folgt bewusst nicht `VORGABE_U`.** Dort stehen 0,95 für das
 * Fenster und 1,6 für die Tür — Werte eines heutigen Neubaus. Was hier
 * ankommt, ist Bestand: eine aufgemessene oder gescannte Wirklichkeit. 1,3
 * ist das Zweischeiben-Fenster (`c-fe-2fach` im Aufbaukatalog), 1,8 die
 * Innentür (`c-tu-innen`); beide sind für ein Bestandsgebäude die bessere
 * Annahme. Sie auf `VORGABE_U` zu ziehen hieße, jedes importierte Fenster um
 * 27 % besser zu rechnen, als es vermutlich ist — und zwar nach unten, in
 * die Richtung, in der ein zu kleines Gerät herauskommt. Die Zahlen bleiben
 * deshalb, wo sie sind, und heißen hier so, dass man sieht, dass sie gemeint
 * sind.
 *
 * Der **Durchgang** bekommt gar keinen mehr. `uWertOeffnung` beantwortet ihn
 * seit 1.23.0 selbst mit 0 aus dem Katalog — er ist ein Loch in der Wand und
 * kein Bauteil. Die 0 am Bauteil stehen zu lassen wäre nicht falsch, aber
 * überflüssig, und sie steht damit als „erfasster U-Wert 0" im Modell:
 * genau die Eingabe, die `validation.ts` seit 1.23.0 als unplausibel meldet.
 * Dass der Durchgang dort ausgenommen ist, ist eine Ausnahme mehr, auf die
 * sich niemand verlassen sollte.
 */
/** U-Wert eines importierten Fensters [W/(m²·K)] — Zweischeiben-Bestand. */
const U_FENSTER_BESTAND = 1.3;
/** U-Wert einer importierten Tür [W/(m²·K)] — Innentür aus dem Aufbaukatalog. */
const U_TUER_BESTAND = 1.8;

// ---------------------------------------------------------------------------
// STEP-Parser
// ---------------------------------------------------------------------------

export type StepValue = string | number | null | StepRef | StepValue[];

/** Verweis auf eine andere Entity (`#42`). */
export interface StepRef {
  ref: number;
}

export interface StepEntity {
  id: number;
  type: string;
  attributes: StepValue[];
}

const isRef = (v: StepValue): v is StepRef =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && 'ref' in v;

/**
 * Zerlegt eine STEP-Datei in Entities.
 *
 * Zeilenweise zu lesen reicht nicht: eine Entity darf über beliebig viele
 * Zeilen gehen, und in Zeichenketten stehen Semikolons und Klammern, die
 * nicht als Struktur zählen. Deshalb wird zeichenweise gescannt und der
 * Zustand „in einer Zeichenkette" mitgeführt.
 */
export function parseStep(text: string): Map<number, StepEntity> {
  const entities = new Map<number, StepEntity>();

  const dataStart = text.indexOf('DATA;');
  const body = dataStart >= 0 ? text.slice(dataStart + 5) : text;

  let i = 0;
  const n = body.length;

  while (i < n) {
    // Bis zum nächsten '#' am Anfang einer Entity springen.
    while (i < n && body[i] !== '#') i++;
    if (i >= n) break;

    const start = i;
    i++;
    let idText = '';
    while (i < n && body[i] >= '0' && body[i] <= '9') idText += body[i++];
    if (!idText) continue;
    while (i < n && /\s/.test(body[i])) i++;
    if (body[i] !== '=') {
      i = start + 1;
      continue;
    }
    i++;

    // Bis zum abschließenden Semikolon lesen, Zeichenketten überspringend.
    let depth = 0;
    let inString = false;
    let raw = '';
    while (i < n) {
      const c = body[i];
      if (inString) {
        if (c === "'") {
          // Verdoppelter Apostroph ist ein Zeichen, kein Ende.
          if (body[i + 1] === "'") {
            raw += "''";
            i += 2;
            continue;
          }
          inString = false;
        }
        raw += c;
        i++;
        continue;
      }
      if (c === "'") {
        inString = true;
        raw += c;
        i++;
        continue;
      }
      if (c === '(') depth++;
      if (c === ')') depth--;
      if (c === ';' && depth <= 0) {
        i++;
        break;
      }
      raw += c;
      i++;
    }

    const open = raw.indexOf('(');
    if (open < 0) continue;
    const type = raw.slice(0, open).trim().toUpperCase();
    const inner = raw.slice(open + 1, raw.lastIndexOf(')'));
    entities.set(Number(idText), { id: Number(idText), type, attributes: parseList(inner) });
  }

  return entities;
}

/** Zerlegt eine Attributliste in Werte. */
function parseList(text: string): StepValue[] {
  const out: StepValue[] = [];
  let token = '';
  let depth = 0;
  let inString = false;

  const flush = () => {
    const t = token.trim();
    token = '';
    if (!t) {
      out.push(null);
      return;
    }
    out.push(parseValue(t));
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      token += c;
      if (c === "'") {
        if (text[i + 1] === "'") {
          token += "'";
          i++;
          continue;
        }
        inString = false;
      }
      continue;
    }
    if (c === "'") {
      inString = true;
      token += c;
      continue;
    }
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === ',' && depth === 0) {
      flush();
      continue;
    }
    token += c;
  }
  if (text.trim().length) flush();
  return out;
}

/**
 * Sonderzeichen in einer STEP-Zeichenkette auflösen.
 *
 * ISO 10303-21 lässt in einer Zeichenkette nur druckbare ASCII-Zeichen zu.
 * Alles andere — und für einen deutschen Grundriss heißt das: jeder Umlaut —
 * wird umschrieben. ArchiCAD schreibt den Raum „Küche" als
 *
 *     'K\X2\00FC\X0\che'
 *
 * Ohne Auflösung steht dieser Rohtext hinterher als Raumname im Modell, im
 * Raumbuch, im Ausdruck und in der RaVia-Übergabe. Das ist kein
 * Schönheitsfehler: „K\X2\00FC\X0\che" lässt sich nicht suchen, nicht
 * sortieren und nicht wiedererkennen.
 *
 * Aufgelöst werden die vier Schreibweisen, die in freier Wildbahn vorkommen:
 *
 *   `\X2\HHHH…\X0\`   UTF-16-Codeeinheiten, beliebig viele hintereinander
 *   `\X4\HHHHHHHH…\X0\` dasselbe mit 32 Bit
 *   `\X\HH`             ein einzelnes Byte (Latin-1)
 *   `\S\c`              das Zeichen `c` mit gesetztem achten Bit
 *   `\\`                ein echter Rückwärtsstrich
 *
 * `\PX\` schaltet die Codepage um; für die Zeichen, die uns erreichen,
 * ändert das nichts, also wird es überlesen statt fehlgedeutet.
 *
 * Gelesen wird von links nach rechts, und der doppelte Rückwärtsstrich
 * kommt **zuerst** dran. Sonst würde ein Name, der die Zeichenfolge
 * `\X2\` wörtlich enthält — vom eigenen Export als `\\X2\\` geschrieben
 * — beim Lesen in eine Umschreibung verwandelt.
 */
function entschluessele(roh: string): string {
  if (!roh.includes('\\')) return roh;
  let aus = '';
  let i = 0;
  while (i < roh.length) {
    const c = roh[i];
    if (c !== '\\') {
      aus += c;
      i += 1;
      continue;
    }
    const naechstes = roh[i + 1];
    if (naechstes === '\\') {
      aus += '\\';
      i += 2;
      continue;
    }
    if (naechstes === 'S' && roh[i + 2] === '\\' && roh[i + 3] !== undefined) {
      aus += String.fromCharCode(roh.charCodeAt(i + 3) + 128);
      i += 4;
      continue;
    }
    if ((naechstes === 'X' || naechstes === 'x') && roh[i + 2] === '\\') {
      const hex = roh.slice(i + 3, i + 5);
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
        aus += String.fromCharCode(parseInt(hex, 16));
        i += 5;
        continue;
      }
    }
    const lang = /^\\X([24])\\([0-9A-Fa-f]+)\\X0\\/.exec(roh.slice(i));
    if (lang) {
      const breite = lang[1] === '2' ? 4 : 8;
      for (let k = 0; k + breite <= lang[2].length; k += breite) {
        aus += String.fromCodePoint(parseInt(lang[2].slice(k, k + breite), 16));
      }
      i += lang[0].length;
      continue;
    }
    const seite = /^\\P[A-Za-z]\\/.exec(roh.slice(i));
    if (seite) {
      i += seite[0].length;
      continue;
    }
    // Unbekannte Folge: der Rückwärtsstrich bleibt stehen, damit nichts
    // stillschweigend verschwindet.
    aus += c;
    i += 1;
  }
  return aus;
}

function parseValue(t: string): StepValue {
  if (t === '$' || t === '*') return null;
  if (t.startsWith('#')) return { ref: Number(t.slice(1)) };
  if (t.startsWith("'")) return entschluessele(t.slice(1, -1).replace(/''/g, "'"));
  if (t.startsWith('(')) return parseList(t.slice(1, -1));
  if (t.startsWith('.') && t.endsWith('.')) return t.slice(1, -1);
  // Typisierte Werte wie IFCLENGTHMEASURE(2.5) — der Inhalt zählt.
  const typed = /^[A-Za-z_][A-Za-z0-9_]*\s*\((.*)\)$/s.exec(t);
  if (typed) {
    const inner = parseList(typed[1]);
    return inner.length === 1 ? inner[0] : inner;
  }
  const num = Number(t);
  return Number.isFinite(num) ? num : t;
}

// ---------------------------------------------------------------------------
// Geometrie-Auswertung
// ---------------------------------------------------------------------------

interface Placement {
  x: number;
  y: number;
  z: number;
  /** Drehung um die Hochachse [rad]. */
  angle: number;
}

const ORIGIN: Placement = { x: 0, y: 0, z: 0, angle: 0 };

/** Löst ein IfcLocalPlacement rekursiv bis zum Weltkoordinatensystem auf. */
/**
 * Wie viele Meter ein Längenwert in dieser Datei bedeutet.
 * ---------------------------------------------------------------------------
 * **Der Fehler, den es hier nicht mehr geben darf.** Bis 1.32.0 rechnete
 * dieser Import jede Zahl als Meter. Das ging gut, solange die Prüfdateien
 * aus ArchiCAD kamen — die schreiben `IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)`.
 * Gemessen an einem Korpus von 19 fremden Dateien schreibt aber **die
 * Mehrheit Millimeter**, darunter Revit, Allplan, Vectorworks, Nemetschek
 * und Renga, und eine brasilianische Datei sogar Zentimeter.
 *
 * Die Folge war nicht etwa eine Fehlermeldung, sondern ein Haus mit 300 m
 * dicken Wänden und einem Grundriss von 25 Kilometern Breite. Dasselbe
 * FZK-Haus kam aus ArchiCAD mit 0,24 m Wandstärke an und aus Nemetschek mit
 * 240 — Faktor tausend, ohne ein Wort.
 *
 * Für ein Erfassungswerkzeug, dessen Ausgabe in eine Heizlastrechnung geht,
 * ist das der schlimmste denkbare Fehler: Er sieht nach Daten aus.
 *
 * **Warum der Weg über `IfcProject` führt und nicht über die erste
 * `IFCSIUNIT`.** In den Dateien von Revit und in der brasilianischen stehen
 * **zwei** Längeneinheiten: die des Projekts und eine zweite, die zu einem
 * anderen Kontext gehört. Wer die erste nimmt, die der Textsuche begegnet,
 * hat in der Hälfte der Fälle recht — das ist keine Regel, das ist ein
 * Münzwurf. Gelesen wird deshalb die Kette
 * `IfcProject.UnitsInContext → IfcUnitAssignment.Units → IfcSIUnit`.
 *
 * `IfcConversionBasedUnit` (Zoll, Fuß) wird über seinen
 * `IfcMeasureWithUnit`-Faktor aufgelöst; findet sich gar nichts, bleibt es
 * bei Metern — das ist die Voreinstellung der Norm.
 */
const SI_VORSATZ: Record<string, number> = {
  EXA: 1e18, PETA: 1e15, TERA: 1e12, GIGA: 1e9, MEGA: 1e6, KILO: 1e3,
  HECTO: 1e2, DECA: 1e1, DECI: 1e-1, CENTI: 1e-2, MILLI: 1e-3,
  MICRO: 1e-6, NANO: 1e-9, PICO: 1e-12, FEMTO: 1e-15, ATTO: 1e-18,
};

/**
 * Eine STEP-Aufzählung als blanker Name.
 *
 * `parseValue` nimmt `.MILLI.` die Punkte bereits ab; die Ersetzung hier ist
 * die Rückfallebene für den Fall, dass jemand am Parser etwas ändert. Sie
 * kostet nichts und verhindert, dass dieser Faktor still auf 1 fällt — und
 * genau still zu fallen ist bei einem Maßstab das Schlimmste, was er kann.
 */
const aufzaehlung = (v: StepValue | undefined): string =>
  typeof v === 'string' ? v.replace(/^\.|\.$/g, '').toUpperCase() : '';

function laengenfaktor(entities: Map<number, StepEntity>): number {
  const projekt = [...entities.values()].find((e) => e.type === 'IFCPROJECT');
  const kontext = projekt?.attributes[8] ?? null;
  if (!isRef(kontext)) return 1;
  const zuordnung = entities.get(kontext.ref);
  if (!zuordnung || zuordnung.type !== 'IFCUNITASSIGNMENT') return 1;
  const liste = zuordnung.attributes[0];
  if (!Array.isArray(liste)) return 1;

  for (const ref of liste) {
    if (!isRef(ref)) continue;
    const u = entities.get(ref.ref);
    if (!u) continue;

    if (u.type === 'IFCSIUNIT' && aufzaehlung(u.attributes[1]) === 'LENGTHUNIT') {
      const vorsatz = aufzaehlung(u.attributes[2]);
      return SI_VORSATZ[vorsatz] ?? 1;
    }

    // Zoll und Fuß: der Faktor steht im `IfcMeasureWithUnit` daneben.
    if (u.type === 'IFCCONVERSIONBASEDUNIT' && aufzaehlung(u.attributes[1]) === 'LENGTHUNIT') {
      const mit = u.attributes[3];
      if (!isRef(mit)) continue;
      const mwu = entities.get(mit.ref);
      if (!mwu || mwu.type !== 'IFCMEASUREWITHUNIT') continue;
      const wert = typeof mwu.attributes[0] === 'number' ? mwu.attributes[0] : 1;
      const basis = mwu.attributes[1];
      let basisFaktor = 1;
      if (isRef(basis)) {
        const b = entities.get(basis.ref);
        if (b?.type === 'IFCSIUNIT') basisFaktor = SI_VORSATZ[aufzaehlung(b.attributes[2])] ?? 1;
      }
      return wert * basisFaktor;
    }
  }
  return 1;
}

/**
 * Der Faktor des gerade laufenden Imports.
 *
 * Modulweite Veränderliche statt Durchreichen durch zwölf Funktionen: Der
 * Import ist synchron und läuft einmal von oben nach unten durch, und die
 * Alternative wäre ein zusätzlicher Parameter an jeder Geometriefunktion.
 * Gesetzt wird sie an genau einer Stelle, ganz am Anfang von `importIfc`.
 */
let FAKTOR = 1;

/** Ein Längenwert der Datei in Metern. */
const inMeter = (v: number): number => v * FAKTOR;

function resolvePlacement(
  entities: Map<number, StepEntity>,
  ref: StepValue,
  cache = new Map<number, Placement>(),
): Placement {
  if (!isRef(ref)) return ORIGIN;
  const cached = cache.get(ref.ref);
  if (cached) return cached;

  const e = entities.get(ref.ref);
  if (!e) return ORIGIN;

  if (e.type === 'IFCLOCALPLACEMENT') {
    /*
     * **Der Ring, der den Zeichner mitnimmt.** Eine Ortsangabe, die sich
     * selbst als übergeordnete nennt — direkt oder über drei Ecken — lässt
     * diese Rekursion nie enden; der Aufrufstapel läuft über, und in der
     * Oberfläche bleibt eine weiße Fläche. Ein `IFCBOOLEANCLIPPINGRESULT`
     * mit demselben Fehler wird seit 1.30.0 abgefangen, die Ortsangaben
     * blieben offen.
     *
     * Der Zwischeneintrag im Speicher ist zugleich die Bremse: Wer beim
     * Abstieg noch einmal auf dieselbe Nummer trifft, bekommt den Ursprung
     * und nicht einen weiteren Abstieg. Der Eintrag wird danach durch das
     * richtige Ergebnis ersetzt.
     */
    cache.set(ref.ref, ORIGIN);
    const parent = resolvePlacement(entities, e.attributes[0], cache);
    const local = resolvePlacement(entities, e.attributes[1], cache);
    const cos = Math.cos(parent.angle);
    const sin = Math.sin(parent.angle);
    const result: Placement = {
      x: parent.x + local.x * cos - local.y * sin,
      y: parent.y + local.x * sin + local.y * cos,
      z: parent.z + local.z,
      angle: parent.angle + local.angle,
    };
    cache.set(ref.ref, result);
    return result;
  }

  if (e.type === 'IFCAXIS2PLACEMENT3D' || e.type === 'IFCAXIS2PLACEMENT2D') {
    const p = point(entities, e.attributes[0]);
    // Bei 3D ist Attribut 1 die Z-Achse und 2 die X-Achse, bei 2D ist
    // Attribut 1 direkt die X-Achse.
    const dirRef = e.type === 'IFCAXIS2PLACEMENT3D' ? e.attributes[2] : e.attributes[1];
    const d = direction(entities, dirRef);
    const result: Placement = {
      x: p[0] ?? 0,
      y: p[1] ?? 0,
      z: p[2] ?? 0,
      angle: d ? Math.atan2(d[1] ?? 0, d[0] ?? 1) : 0,
    };
    cache.set(ref.ref, result);
    return result;
  }

  return ORIGIN;
}

function point(entities: Map<number, StepEntity>, ref: StepValue): number[] {
  if (!isRef(ref)) return [0, 0, 0];
  const e = entities.get(ref.ref);
  if (!e || e.type !== 'IFCCARTESIANPOINT') return [0, 0, 0];
  const coords = e.attributes[0];
  if (!Array.isArray(coords)) return [0, 0, 0];
  return coords.map((c) => (typeof c === 'number' ? inMeter(c) : 0));
}

function direction(entities: Map<number, StepEntity>, ref: StepValue): number[] | null {
  if (!isRef(ref)) return null;
  const e = entities.get(ref.ref);
  if (!e || e.type !== 'IFCDIRECTION') return null;
  const ratios = e.attributes[0];
  if (!Array.isArray(ratios)) return null;
  return ratios.map((c) => (typeof c === 'number' ? c : 0));
}

/**
 * Alle Darstellungselemente einer Produkt-Repräsentation, wahlweise gefiltert
 * nach ihrer Kennung ('Body', 'Axis').
 */
function itemsOf(
  entities: Map<number, StepEntity>,
  ref: StepValue,
  identifier?: string,
): StepEntity[] {
  const out: StepEntity[] = [];
  if (!isRef(ref)) return out;
  const shape = entities.get(ref.ref);
  if (!shape) return out;

  const reps = shape.attributes[2];
  if (!Array.isArray(reps)) return out;

  for (const r of reps) {
    if (!isRef(r)) continue;
    const rep = entities.get(r.ref);
    if (!rep || rep.type !== 'IFCSHAPEREPRESENTATION') continue;
    if (identifier && rep.attributes[1] !== identifier) continue;
    const items = rep.attributes[3];
    if (!Array.isArray(items)) continue;
    for (const it of items) {
      if (!isRef(it)) continue;
      const item = entities.get(it.ref);
      if (item) out.push(item);
    }
  }
  return out;
}

const solidsOf = (entities: Map<number, StepEntity>, ref: StepValue): StepEntity[] =>
  itemsOf(entities, ref);

/** Das vollständige Dreibein einer `IfcAxis2Placement3D`. */
interface Dreibein {
  /** Ursprung in den Koordinaten des Elternsystems. */
  loc: [number, number, number];
  /** Lokale x-Achse (`RefDirection`). */
  ex: [number, number, number];
  /** Lokale y-Achse = z × x. */
  ey: [number, number, number];
  /** Lokale z-Achse (`Axis`) — die Normale der Profilebene. */
  ez: [number, number, number];
}

const EINHEIT: Dreibein = { loc: [0, 0, 0], ex: [1, 0, 0], ey: [0, 1, 0], ez: [0, 0, 1] };

/**
 * Das Dreibein einer Platzierung — nicht nur Lage und Drehung um die
 * Hochachse.
 *
 * `resolvePlacement` verfolgt die Kette bis zum Weltsystem, wirft dabei aber
 * alles weg, was nicht Verschiebung oder Drehung um z ist. Für Wände genügt
 * das: ihr Profil liegt waagerecht, und sie werden nach oben extrudiert.
 *
 * Für **Öffnungen** genügt es nicht. ArchiCAD schreibt ein Fenster als
 * Rechteck, das *senkrecht in der Wandebene* steht — Breite mal Höhe — und
 * extrudiert es quer durch die Wand. Wer das für ein liegendes Profil hält,
 * liest die Wanddicke als Fensterhöhe. Am FZK-Haus kam jedes Fenster mit
 * 0,30 m Höhe an (das war die Wandstärke) und jede Tür mit 0,24 m. Die
 * Fensterfläche ist die Größe, an der die Transmissionsverluste hängen;
 * ein Faktor vier darin ist keine Ungenauigkeit mehr.
 */
function achsen3d(entities: Map<number, StepEntity>, ref: StepValue): Dreibein {
  if (!isRef(ref)) return EINHEIT;
  const e = entities.get(ref.ref);
  if (!e || (e.type !== 'IFCAXIS2PLACEMENT3D' && e.type !== 'IFCAXIS2PLACEMENT2D')) return EINHEIT;

  const l = point(entities, e.attributes[0]);
  const loc: [number, number, number] = [l[0] ?? 0, l[1] ?? 0, l[2] ?? 0];
  if (e.type === 'IFCAXIS2PLACEMENT2D') {
    const d = direction(entities, e.attributes[1]) ?? [1, 0];
    const n = Math.hypot(d[0] ?? 1, d[1] ?? 0) || 1;
    const ex: [number, number, number] = [(d[0] ?? 1) / n, (d[1] ?? 0) / n, 0];
    return { loc, ex, ey: [-ex[1], ex[0], 0], ez: [0, 0, 1] };
  }

  const norm = (v: number[] | null, vorgabe: [number, number, number]): [number, number, number] => {
    if (!v) return vorgabe;
    const l2 = Math.hypot(v[0] ?? 0, v[1] ?? 0, v[2] ?? 0);
    if (l2 < 1e-9) return vorgabe;
    return [(v[0] ?? 0) / l2, (v[1] ?? 0) / l2, (v[2] ?? 0) / l2];
  };

  const ez = norm(direction(entities, e.attributes[1]), [0, 0, 1]);
  let ex = norm(direction(entities, e.attributes[2]), [1, 0, 0]);
  // `RefDirection` muss nicht senkrecht auf `Axis` stehen; IFC verlangt
  // ausdrücklich die Projektion. Ohne sie wäre das Dreibein schief und die
  // Höhe eines schrägen Fensters falsch.
  const proj = ex[0] * ez[0] + ex[1] * ez[1] + ex[2] * ez[2];
  ex = norm([ex[0] - proj * ez[0], ex[1] - proj * ez[1], ex[2] - proj * ez[2]], [1, 0, 0]);
  const ey: [number, number, number] = [
    ez[1] * ex[2] - ez[2] * ex[1],
    ez[2] * ex[0] - ez[0] * ex[2],
    ez[0] * ex[1] - ez[1] * ex[0],
  ];
  return { loc, ex, ey, ez };
}

/** Vorzeichenbehaftete Fläche eines Polygons [m²] — Gaußsche Trapezformel. */
function flaeche(p: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i += 1) {
    const q = p[(i + 1) % p.length];
    a += p[i].x * q.y - q.x * p[i].y;
  }
  return a / 2;
}

/** Boolesche Verknüpfungen, durch die zum Grundkörper durchgestiegen wird. */
const BOOLESCHE_TYPEN = new Set(['IFCBOOLEANCLIPPINGRESULT', 'IFCBOOLEANRESULT']);

/**
 * Der Grundkörper eines Darstellungselements.
 *
 * Eine Wand, die unter eine Dachschräge läuft, steht in IFC nicht als
 * einfache Extrusion in der Datei. Der Architekt zieht sie als Quader hoch
 * und schneidet die Schräge ab; geschrieben wird das als
 * `IfcBooleanClippingResult(.DIFFERENCE., <Körper>, <Halbraum>)`, und der
 * erste Operand ist wieder ein solches Ergebnis, wenn zwei Schrägen sich
 * schneiden. Die `IfcShapeRepresentation` heißt dann `'Clipping'` statt
 * `'SweptSolid'`.
 *
 * Wer nur nach `IFCEXTRUDEDAREASOLID` sucht, findet in so einer Datei genau
 * die Wände **nicht**, die unter dem Dach stehen — also regelmäßig das
 * gesamte Obergeschoss. Am FZK-Haus des KIT (ArchiCAD 20, IFC4) waren das
 * 4 von 13 Wänden: `Wand-Ext-OG-1..4`. Die Meldung las sich trotzdem wie
 * ein Erfolg, weil unten neun Wände ankamen.
 *
 * Gestiegen wird immer in den **ersten** Operanden. Das ist bei
 * `.DIFFERENCE.` der Körper, von dem abgezogen wird, und bei `.UNION.` ein
 * Teil des Ganzen — in beiden Fällen der Körper, der die Wand meint. Der
 * zweite Operand ist das Schneidewerkzeug (ein `IfcPolygonalBoundedHalfSpace`
 * o. ä.) und sagt über die Wandachse nichts.
 *
 * Was dabei verloren geht, ist die Beschneidung selbst: zurück kommt die
 * Höhe der *ungeschnittenen* Extrusion, also die Wand bis zum First statt
 * bis zur Schräge. Das ist hinnehmbar und wird gemeldet — CAD Light rechnet
 * die Wandhöhe unter dem Dach ohnehin selbst (`wallProfileUnderRoof`), und
 * eine zu hohe Wand sieht man im Grundriss, eine fehlende nicht.
 *
 * Die Tiefenbremse bei 8 schützt vor einer Datei, die sich im Kreis
 * referenziert; acht geschachtelte Schnitte an einer Wand gibt es nicht.
 */
function basisExtrusion(
  entities: Map<number, StepEntity>,
  item: StepEntity | undefined,
  tiefe = 0,
): StepEntity | null {
  if (!item || tiefe > 8) return null;
  if (item.type === 'IFCEXTRUDEDAREASOLID') return item;
  if (!BOOLESCHE_TYPEN.has(item.type)) return null;
  const erster = item.attributes[1];
  if (!isRef(erster)) return null;
  return basisExtrusion(entities, entities.get(erster.ref), tiefe + 1);
}

interface ProfileBox {
  /** Ausdehnung längs der lokalen x-Achse [m]. */
  xDim: number;
  /** Ausdehnung quer dazu [m]. */
  yDim: number;
  /** Zusätzliche Drehung des Profils [rad]. */
  angle: number;
  /** Versatz des Profilmittelpunkts [m]. */
  offset: { x: number; y: number };
}

/**
 * Reduziert ein Profil auf sein umschreibendes Rechteck.
 *
 * Wände sind in IFC fast immer Rechteckprofile; kommt doch ein Polygon,
 * genügt dessen Bounding-Box, um Achse und Dicke zu bestimmen. Mehr braucht
 * ein Grundriss nicht — und was er nicht braucht, sollte er nicht raten.
 */
function profileBox(entities: Map<number, StepEntity>, ref: StepValue): ProfileBox | null {
  if (!isRef(ref)) return null;
  const e = entities.get(ref.ref);
  if (!e) return null;

  if (e.type === 'IFCRECTANGLEPROFILEDEF') {
    const place = resolvePlacement(entities, e.attributes[2]);
    const xDim = typeof e.attributes[3] === 'number' ? inMeter(e.attributes[3]) : 0;
    const yDim = typeof e.attributes[4] === 'number' ? inMeter(e.attributes[4]) : 0;
    return { xDim, yDim, angle: place.angle, offset: { x: place.x, y: place.y } };
  }

  if (e.type === 'IFCARBITRARYCLOSEDPROFILEDEF' || e.type === 'IFCARBITRARYPROFILEDEFWITHVOIDS') {
    const pts = curvePoints(entities, e.attributes[2]);
    if (pts.length < 3) return null;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const c of pts) {
      minX = Math.min(minX, c[0] ?? 0);
      minY = Math.min(minY, c[1] ?? 0);
      maxX = Math.max(maxX, c[0] ?? 0);
      maxY = Math.max(maxY, c[1] ?? 0);
    }
    if (!Number.isFinite(minX)) return null;
    return {
      xDim: maxX - minX,
      yDim: maxY - minY,
      angle: 0,
      offset: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
    };
  }

  if (e.type === 'IFCCIRCLEPROFILEDEF') {
    const place = resolvePlacement(entities, e.attributes[2]);
    const r = typeof e.attributes[3] === 'number' ? inMeter(e.attributes[3]) : 0;
    return { xDim: 2 * r, yDim: 2 * r, angle: place.angle, offset: { x: place.x, y: place.y } };
  }

  return null;
}

/**
 * Wie dick eine **gemessene** Wand höchstens sein darf [m].
 *
 * Ein Meter ist großzügig: Die dickste Wand im ganzen Prüfkorpus misst
 * 0,43 m, und das ist ein Institutsgebäude. Was darüber liegt, ist kein
 * Bauteil mehr, sondern ein Körper, in dem mehrere stecken.
 */
const MESS_DICKE_GRENZE = 1.0;

/**
 * Alle Eckpunkte eines Darstellungselements, in den Koordinaten des Bauteils.
 * ---------------------------------------------------------------------------
 * **Wofür das da ist.** Der Hauptweg dieses Imports liest eine Wand als
 * Extrusion: Profil mal Tiefe, sauber und genau. Nicht jedes Programm
 * schreibt sie so. Gemessen am Korpus fremder Dateien:
 *
 *  · **Renga** legt seine Wände als `IfcMappedItem` ab — eine geteilte
 *    Vorlage samt Versatz —, und die Vorlage darin ist ein
 *    `IfcPolygonalFaceSet`, also ein Netz aus Dreiecken. 21 von 33 Wänden
 *    kamen deshalb nicht an.
 *  · **`202103162102_cira.ifc`** schreibt *alle* 101 Wände als solches Netz.
 *    Die Datei kam vollständig leer an, mit der ehrlichen, aber wenig
 *    hilfreichen Meldung „Keine auswertbaren Wände gefunden".
 *  · **Vectorworks** schreibt vereinzelt `IfcShellBasedSurfaceModel`.
 *
 * Für ein Werkzeug, dessen Zweck die Heizlast ist, braucht eine Wand keine
 * Dreiecke — sie braucht Länge, Dicke und Höhe. Und die stehen in jedem
 * dieser Körper drin, man muss nur alle Punkte einsammeln und die
 * Ausdehnung messen. Das ist gröber als die Extrusion und deshalb
 * ausdrücklich die **Rückfallebene**: Erst wenn kein Extrusionskörper zu
 * finden ist, wird gemessen statt gelesen.
 *
 * **Die Abbildung.** Ein `IfcMappedItem` verweist auf eine
 * `IfcRepresentationMap` und auf einen `IfcCartesianTransformationOperator3D`.
 * Der Operator ist keine Formsache: In der Renga-Datei dreht er die Wand um
 * 180° und verschiebt sie um 39 m. Wer ihn übergeht, baut das Haus in sich
 * zusammen. Gerechnet wird
 *
 *     p' = Ursprung + Maßstab · (Achse1·pₓ + Achse2·p_y + Achse3·p_z)
 *
 * und davor die `MappingOrigin` der Vorlage, die in den geprüften Dateien
 * die Einheitslage ist, aber es nicht sein muss.
 */
function punkteVon(
  entities: Map<number, StepEntity>,
  item: StepEntity | undefined,
  tiefe = 0,
): number[][] {
  if (!item || tiefe > 6) return [];

  const ausLoops = (faces: StepValue): number[][] => {
    const raus: number[][] = [];
    if (!Array.isArray(faces)) return raus;
    for (const fRef of faces) {
      if (!isRef(fRef)) continue;
      const face = entities.get(fRef.ref);
      if (!face) continue;
      const bounds = face.attributes[0];
      if (!Array.isArray(bounds)) continue;
      for (const bRef of bounds) {
        if (!isRef(bRef)) continue;
        const bound = entities.get(bRef.ref);
        if (!bound) continue;
        const loopRef = bound.attributes[0];
        if (!isRef(loopRef)) continue;
        const loop = entities.get(loopRef.ref);
        if (!loop || loop.type !== 'IFCPOLYLOOP') continue;
        const pl = loop.attributes[0];
        if (!Array.isArray(pl)) continue;
        for (const pr of pl) raus.push(point(entities, pr));
      }
    }
    return raus;
  };

  switch (item.type) {
    case 'IFCFACETEDBREP':
    case 'IFCFACETEDBREPWITHVOIDS': {
      const shellRef = item.attributes[0];
      if (!isRef(shellRef)) return [];
      const shell = entities.get(shellRef.ref);
      return shell ? ausLoops(shell.attributes[0]) : [];
    }

    case 'IFCFACEBASEDSURFACEMODEL':
    case 'IFCSHELLBASEDSURFACEMODEL': {
      const schalen = item.attributes[0];
      if (!Array.isArray(schalen)) return [];
      const raus: number[][] = [];
      for (const sRef of schalen) {
        if (!isRef(sRef)) continue;
        const schale = entities.get(sRef.ref);
        if (schale) raus.push(...ausLoops(schale.attributes[0]));
      }
      return raus;
    }

    case 'IFCPOLYGONALFACESET':
    case 'IFCTRIANGULATEDFACESET': {
      /*
       * Beide verweisen auf eine `IfcCartesianPointList3D`. Die Flächen
       * selbst — welche Punkte ein Dreieck bilden — interessieren hier
       * nicht: Gesucht ist die Ausdehnung, und dafür zählt jeder Punkt
       * einmal.
       */
      const listeRef = item.attributes[0];
      if (!isRef(listeRef)) return [];
      const liste = entities.get(listeRef.ref);
      if (!liste || liste.type !== 'IFCCARTESIANPOINTLIST3D') return [];
      const coords = liste.attributes[0];
      if (!Array.isArray(coords)) return [];
      return coords
        .filter((c): c is StepValue[] => Array.isArray(c))
        .map((c) => c.map((v) => (typeof v === 'number' ? inMeter(v) : 0)));
    }

    case 'IFCMAPPEDITEM': {
      const quelleRef = item.attributes[0];
      const zielRef = item.attributes[1];
      if (!isRef(quelleRef)) return [];
      const map = entities.get(quelleRef.ref);
      if (!map || map.type !== 'IFCREPRESENTATIONMAP') return [];

      // Die Vorlage: ihre Darstellungselemente, rekursiv.
      const innenRef = map.attributes[1];
      if (!isRef(innenRef)) return [];
      const innen = entities.get(innenRef.ref);
      if (!innen) return [];
      const stuecke = innen.attributes[3];
      if (!Array.isArray(stuecke)) return [];
      let punkte: number[][] = [];
      for (const it of stuecke) {
        if (!isRef(it)) continue;
        punkte = punkte.concat(punkteVon(entities, entities.get(it.ref), tiefe + 1));
      }
      if (punkte.length === 0) return [];

      // Erst die eigene Lage der Vorlage …
      const ursprung = achsen3d(entities, map.attributes[0]);
      punkte = punkte.map((p) => [
        ursprung.loc[0] + ursprung.ex[0] * (p[0] ?? 0) + ursprung.ey[0] * (p[1] ?? 0) + ursprung.ez[0] * (p[2] ?? 0),
        ursprung.loc[1] + ursprung.ex[1] * (p[0] ?? 0) + ursprung.ey[1] * (p[1] ?? 0) + ursprung.ez[1] * (p[2] ?? 0),
        ursprung.loc[2] + ursprung.ex[2] * (p[0] ?? 0) + ursprung.ey[2] * (p[1] ?? 0) + ursprung.ez[2] * (p[2] ?? 0),
      ]);

      // … dann der Operator, der sie an ihren Platz bringt.
      if (!isRef(zielRef)) return punkte;
      const op = entities.get(zielRef.ref);
      if (!op || !op.type.startsWith('IFCCARTESIANTRANSFORMATIONOPERATOR')) return punkte;
      const norm = (d: number[] | null, ersatz: [number, number, number]): [number, number, number] => {
        if (!d) return ersatz;
        const v: [number, number, number] = [d[0] ?? 0, d[1] ?? 0, d[2] ?? 0];
        const l = Math.hypot(v[0], v[1], v[2]);
        return l > 1e-12 ? [v[0] / l, v[1] / l, v[2] / l] : ersatz;
      };
      // Attribute: Axis1, Axis2, LocalOrigin, Scale, Axis3.
      const a1 = norm(direction(entities, op.attributes[0]), [1, 0, 0]);
      const a2 = norm(direction(entities, op.attributes[1]), [0, 1, 0]);
      const a3 = norm(direction(entities, op.attributes[4]), [0, 0, 1]);
      const o = point(entities, op.attributes[2]);
      const m = typeof op.attributes[3] === 'number' && op.attributes[3] !== 0 ? op.attributes[3] : 1;
      return punkte.map((p) => {
        const x = p[0] ?? 0;
        const y = p[1] ?? 0;
        const zz = p[2] ?? 0;
        return [
          (o[0] ?? 0) + m * (a1[0] * x + a2[0] * y + a3[0] * zz),
          (o[1] ?? 0) + m * (a1[1] * x + a2[1] * y + a3[1] * zz),
          (o[2] ?? 0) + m * (a1[2] * x + a2[2] * y + a3[2] * zz),
        ];
      });
    }

    default: {
      // Boolesche Verknüpfungen: der erste Operand trägt den Körper.
      if (BOOLESCHE_TYPEN.has(item.type)) {
        const erster = item.attributes[1];
        if (isRef(erster)) return punkteVon(entities, entities.get(erster.ref), tiefe + 1);
      }
      return [];
    }
  }
}

/**
 * Der Grundriss eines Begrenzungsflächenkörpers (`IfcFacetedBrep`).
 * ---------------------------------------------------------------------------
 * **Warum das nötig wurde.** `IfcSpace` ist die einzige Stelle in einer
 * IFC-Datei, an der steht, *wie ein Raum heißt* — und daran hängt in der
 * Heizlast die Solltemperatur: Bad 24 °C, Flur 15 °C. Bis hierher las der
 * Import Raumumrisse nur als Extrusion oder als Fußabdruckkurve. ArchiCAD
 * schreibt es so; **Allplan und Revit nicht.** Gemessen am Korpus fremder
 * Dateien gingen dadurch am Institutsgebäude 82 Raumnamen verloren und am
 * Revit-Musterprojekt 96 — dieselben Häuser, aus ArchiCAD exportiert, kamen
 * vollständig an.
 *
 * Ein Raum ohne Namen ist kein Schönheitsfehler: Er kommt als „Raum 3",
 * Nutzung „sonstige", 20 °C an, und jemand muss 82-mal von Hand nachtragen.
 *
 * **Wie der Umriss entsteht.** Ein Raumkörper ist ein Prisma: unten der
 * Grundriss, oben dieselbe Fläche, dazwischen die Seitenflächen. Gesucht ist
 * also die **waagerechte Fläche auf der untersten Höhe**. Geprüft wird
 * beides — waagerecht (alle Punkte auf einer z-Höhe) und unten —, denn die
 * Deckfläche erfüllt nur das erste und hätte denselben Umriss seitenverkehrt
 * geliefert.
 *
 * Gefundene Flächen mit weniger als drei Punkten fallen weg; von mehreren
 * gleich tiefen gewinnt die größte. Löcher (`IfcFaceBound` neben dem
 * `IfcFaceOuterBound`) werden nicht abgezogen — ein Raum mit Loch ist in
 * einem Wohnungsgrundriss nicht vorgesehen, und eine halbe Unterstützung
 * wäre schlechter als keine.
 */
function brepBoden(entities: Map<number, StepEntity>, ref: StepValue): number[][] {
  if (!isRef(ref)) return [];
  const e = entities.get(ref.ref);
  if (!e || (e.type !== 'IFCFACETEDBREP' && e.type !== 'IFCFACETEDBREPWITHVOIDS')) return [];
  const shellRef = e.attributes[0];
  if (!isRef(shellRef)) return [];
  const shell = entities.get(shellRef.ref);
  if (!shell) return [];
  const faces = shell.attributes[0];
  if (!Array.isArray(faces)) return [];

  let besteZ = Infinity;
  let bester: number[][] = [];

  for (const fRef of faces) {
    if (!isRef(fRef)) continue;
    const face = entities.get(fRef.ref);
    if (!face || face.type !== 'IFCFACE') continue;
    const bounds = face.attributes[0];
    if (!Array.isArray(bounds)) continue;

    for (const bRef of bounds) {
      if (!isRef(bRef)) continue;
      const bound = entities.get(bRef.ref);
      if (!bound || bound.type !== 'IFCFACEOUTERBOUND') continue;
      const loopRef = bound.attributes[0];
      if (!isRef(loopRef)) continue;
      const loop = entities.get(loopRef.ref);
      if (!loop || loop.type !== 'IFCPOLYLOOP') continue;
      const pl = loop.attributes[0];
      if (!Array.isArray(pl)) continue;

      const pts = pl.map((pr) => point(entities, pr));
      if (pts.length < 3) continue;

      // Waagerecht? Ein Millimeter Spiel — Fließkomma trifft „gleich" nicht.
      const zs = pts.map((c) => c[2] ?? 0);
      const zMin = Math.min(...zs);
      if (Math.max(...zs) - zMin > 0.001) continue;

      // Tiefer gewinnt; bei gleicher Höhe die größere Fläche.
      const flaecheHier = Math.abs(flaeche(pts.map((c) => ({ x: c[0] ?? 0, y: c[1] ?? 0 }))));
      if (zMin < besteZ - 0.001 || (Math.abs(zMin - besteZ) <= 0.001 && flaecheHier > Math.abs(
        flaeche(bester.map((c) => ({ x: c[0] ?? 0, y: c[1] ?? 0 }))),
      ))) {
        besteZ = Math.min(besteZ, zMin);
        bester = pts;
      }
    }
  }
  return bester;
}

/**
 * Stützpunkte einer Profilkurve.
 *
 * IFC4 kennt für dieselbe Sache zwei Schreibweisen: die klassische
 * `IfcPolyline` mit einzelnen Punkten und die kompakte `IfcIndexedPolyCurve`,
 * die auf eine `IfcCartesianPointList` verweist. Programme wie IfcOpenShell
 * schreiben die zweite — wer nur die erste liest, findet in solchen Dateien
 * gar keine Wände.
 */
function curvePoints(entities: Map<number, StepEntity>, ref: StepValue): number[][] {
  if (!isRef(ref)) return [];
  const e = entities.get(ref.ref);
  if (!e) return [];

  if (e.type === 'IFCPOLYLINE') {
    const pts = e.attributes[0];
    if (!Array.isArray(pts)) return [];
    return pts.map((p) => point(entities, p));
  }

  if (e.type === 'IFCINDEXEDPOLYCURVE') {
    const listRef = e.attributes[0];
    if (!isRef(listRef)) return [];
    const list = entities.get(listRef.ref);
    if (!list) return [];
    if (list.type !== 'IFCCARTESIANPOINTLIST2D' && list.type !== 'IFCCARTESIANPOINTLIST3D') return [];
    const coords = list.attributes[0];
    if (!Array.isArray(coords)) return [];
    return coords
      .filter((c): c is StepValue[] => Array.isArray(c))
      .map((c) => c.map((v) => (typeof v === 'number' ? inMeter(v) : 0)));
  }

  if (e.type === 'IFCCOMPOSITECURVE') {
    // Zusammengesetzte Kurve: die Segmente einsammeln und aneinanderhängen.
    const segments = e.attributes[0];
    if (!Array.isArray(segments)) return [];
    const out: number[][] = [];
    for (const segRef of segments) {
      if (!isRef(segRef)) continue;
      const seg = entities.get(segRef.ref);
      if (!seg) continue;
      out.push(...curvePoints(entities, seg.attributes[2]));
    }
    return out;
  }

  return [];
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export interface ImportedLevel {
  id: string;
  name: string;
  elevation: number;
  height: number;
}

/**
 * Ein Raum, wie der Architekt ihn in die Datei geschrieben hat.
 *
 * `IfcSpace` ist der einzige Ort in einer IFC-Datei, an dem steht, **wie ein
 * Raum heißt**. Alles andere — Wände, Öffnungen, Geschosse — beschreibt
 * Bauteile; erst der Raum sagt „Bad" oder „Schlafzimmer". Für ein Werkzeug,
 * dessen Zweck die Heizlast ist, hängt daran mehr als eine Beschriftung: die
 * Nutzung entscheidet über die Solltemperatur (DIN EN 12831 rechnet das Bad
 * mit 24 °C und den Flur mit 15 °C) und über den Luftwechsel.
 *
 * Ohne diese Angabe kommt jeder Raum als „Raum 3", Nutzung „sonstige",
 * 20 °C an. Beim FZK-Haus sind das fünf Räume, die jemand von Hand benennen
 * und einstufen muss; beim Institutsgebäude des KIT sind es 82.
 *
 * Die **Geometrie** des Raums wird bewusst nicht übernommen — sie dient nur
 * dazu, den Raum wiederzufinden. CAD Light leitet Räume aus den Wänden ab,
 * und das muss die eine Quelle bleiben: ein Raum, dessen Umriss aus der
 * Datei stammt und dessen Wände daneben liegen, wäre in jeder späteren
 * Bearbeitung eine Falle.
 */
export interface ImportedSpace {
  /** `LongName`, sonst `Name` — das, was der Architekt lesbar hingeschrieben hat. */
  name: string;
  levelId: string;
  /** Umriss in Weltkoordinaten, nur zur Zuordnung. */
  polygon: Vec2[];
  /** Fläche des Umrisses [m²]. */
  area: number;
}

export interface IfcImportResult {
  ok: boolean;
  message: string;
  schema?: string;
  projectName?: string;
  levels: ImportedLevel[];
  nodes: BimNode[];
  walls: Wall[];
  openings: Opening[];
  /** Benannte Räume aus der Datei — für Name und Nutzung, nicht für Geometrie. */
  spaces: ImportedSpace[];
  /** Was gelesen, aber nicht übernommen wurde — für die Rückmeldung. */
  skipped: { reason: string; count: number }[];
  /**
   * Was übernommen wurde, aber mit Vorbehalt.
   *
   * Getrennt von `skipped`, weil beides Verschiedenes heißt: übersprungen
   * ist ein Bauteil, das fehlt, und danach muss jemand nachzeichnen. Ein
   * Hinweis betrifft ein Bauteil, das da ist, aber eine Annahme in sich
   * trägt — etwa die Wandhöhe einer unter dem Dach beschnittenen Wand.
   * Beides in einen Topf zu werfen hieße, entweder Fehlendes zu verharmlosen
   * oder Vorhandenes als Verlust zu melden.
   */
  hinweise: { reason: string; count: number }[];
}

const EMPTY: IfcImportResult = {
  ok: false,
  message: '',
  levels: [],
  nodes: [],
  walls: [],
  openings: [],
  spaces: [],
  skipped: [],
  hinweise: [],
};

const WALL_TYPES = new Set([
  'IFCWALL',
  'IFCWALLSTANDARDCASE',
  'IFCWALLELEMENTEDCASE',
]);

/**
 * Wandart bestimmen — aus dem Bauteil-Pset, sonst aus Name und Dicke.
 *
 * **Warum `IsExternal` zuerst kommt.** IFC hat für „außen oder innen" eine
 * eigene, genormte Stelle: `Pset_WallCommon.IsExternal`. Das ist keine
 * Schätzung, sondern das, was der Architekt in seinem Programm angeklickt
 * hat. Solange die Datei es mitliefert, hat keine Namens- oder Dickenregel
 * daneben etwas zu suchen.
 *
 * **Warum die Dicke allein nicht reicht.** Die vorige Fassung entschied ab
 * 24 cm auf Außenwand. Am FZK-Haus (KIT) sind die Innenwände genau 24,0 cm
 * dick und die Außenwände 30,0 cm — damit wurden **alle** neun importierten
 * Wände zu Außenwänden, einschließlich der fünf, die in der Datei
 * `Wand-Int-ERDG-1..5` heißen. Für die Heizlast ist das kein Schönheits-
 * fehler: eine Innenwand mit U = 0,24 gegen Außenluft zu rechnen erfindet
 * Transmissionsverluste, die es nicht gibt, und verschiebt zugleich die
 * Raumerkennung.
 *
 * **Warum nur `ext`/`int` als Kürzel.** Sie stehen als eigenes Namensglied
 * in den Vorlagen von ArchiCAD und Revit und sind dort eindeutig. Kürzel wie
 * `aw`/`iw` wären geraten: zwei Buchstaben treffen zu leicht etwas anderes,
 * und eine falsch geratene Außenwand ist schlechter als eine, die über die
 * Dicke in die richtige Richtung fällt. Geprüft wird auf das ganze
 * Namensglied, nicht auf ein Vorkommen irgendwo — sonst würde „Print" zur
 * Innenwand.
 */
function guessWallType(thickness: number, name: string, aussen?: boolean): WallType {
  const lower = name.toLowerCase();
  // Der Schacht geht vor: `IsExternal` ist für ihn `false`, und damit wäre
  // er ohne diese Zeile eine gewöhnliche Innenwand.
  if (lower.includes('schacht') || lower.includes('shaft')) return 'shaft';

  const innen = (): WallType => (thickness <= 0.12 ? 'partition' : 'interior');

  if (aussen === true) return 'exterior';
  if (aussen === false) return innen();

  if (lower.includes('außen') || lower.includes('aussen') || lower.includes('exterior')) {
    return 'exterior';
  }
  if (lower.includes('innen') || lower.includes('interior') || lower.includes('partition')) {
    return innen();
  }

  const glieder = lower.split(/[^a-zäöüß]+/).filter(Boolean);
  if (glieder.includes('ext')) return 'exterior';
  if (glieder.includes('int')) return innen();

  // Ohne jeden Hinweis entscheidet die Dicke: ab 24 cm ist es in
  // Wohngebäuden häufiger eine Außenwand als eine Innenwand.
  if (thickness >= 0.24) return 'exterior';
  return innen();
}

export function importIfc(text: string): IfcImportResult {
  if (!text.trimStart().startsWith('ISO-10303-21')) {
    return { ...EMPTY, message: 'Das ist keine STEP-/IFC-Datei (Kopfzeile fehlt).' };
  }

  const schemaMatch = /FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'/i.exec(text);
  const schema = schemaMatch?.[1];

  const entities = parseStep(text);
  if (entities.size === 0) {
    return { ...EMPTY, schema, message: 'Die Datei enthält keine lesbaren Entities.' };
  }

  // Der Maßstab steht vor jeder Geometrie: alles, was danach gelesen wird,
  // kommt bereits in Metern an.
  FAKTOR = laengenfaktor(entities);

  const byType = new Map<string, StepEntity[]>();
  for (const e of entities.values()) {
    const list = byType.get(e.type);
    if (list) list.push(e);
    else byType.set(e.type, [e]);
  }

  const projectName = (() => {
    const p = byType.get('IFCPROJECT')?.[0];
    const name = p?.attributes[2];
    return typeof name === 'string' ? name : undefined;
  })();

  // --- Geschosse -------------------------------------------------------------
  const storeys = (byType.get('IFCBUILDINGSTOREY') ?? []).map((e, index) => {
    const name = typeof e.attributes[2] === 'string' ? e.attributes[2] : `Geschoss ${index + 1}`;
    const elevationAttr = e.attributes[9];
    const placement = resolvePlacement(entities, e.attributes[5]);
    const elevation = typeof elevationAttr === 'number' ? inMeter(elevationAttr) : placement.z;
    return { entity: e, id: `ifc-${e.id}`, name, elevation };
  });
  storeys.sort((a, b) => a.elevation - b.elevation);

  // Geschosshöhe aus dem Abstand zum nächsten Geschoss; das oberste erbt.
  const levels: ImportedLevel[] = storeys.map((s, i) => {
    const next = storeys[i + 1];
    const height = next ? Math.max(2, next.elevation - s.elevation - 0.3) : 2.75;
    return { id: s.id, name: s.name, elevation: s.elevation, height: Math.round(height * 1000) / 1000 };
  });

  // Bauteil → Geschoss über IfcRelContainedInSpatialStructure.
  const levelOfProduct = new Map<number, string>();
  for (const rel of byType.get('IFCRELCONTAINEDINSPATIALSTRUCTURE') ?? []) {
    const related = rel.attributes[4];
    const structure = rel.attributes[5];
    if (!Array.isArray(related) || !isRef(structure)) continue;
    const storey = storeys.find((s) => s.entity.id === structure.ref);
    if (!storey) continue;
    for (const r of related) if (isRef(r)) levelOfProduct.set(r.ref, storey.id);
  }

  /**
   * `IsExternal` je Bauteil aus seinen Property-Sets.
   *
   * Der Weg ist `IfcRelDefinesByProperties` → `IfcPropertySet` →
   * `IfcPropertySingleValue('IsExternal', …, IFCBOOLEAN(.T.|.F.))`. Ein
   * `IfcRelDefinesByProperties` hängt ein Pset an *mehrere* Bauteile auf
   * einmal, deshalb die Schleife über `RelatedObjects`.
   *
   * Der Pset-Name wird bewusst nicht geprüft: `IsExternal` kommt in
   * `Pset_WallCommon`, `Pset_DoorCommon`, `Pset_WindowCommon` und weiteren
   * vor und bedeutet überall dasselbe. Eine Prüfung auf `Pset_WallCommon`
   * würde nur Dateien ausschließen, die das Merkmal in einem eigenen Pset
   * führen — und nichts gewinnen, denn gefragt wird die Karte ohnehin nur
   * für Wände.
   *
   * `.U.` (unbekannt) landet als `undefined` in der Karte, nicht als
   * `false` — „nicht gesetzt" ist etwas anderes als „innen", und nur beim
   * ersten darf der Name entscheiden.
   */
  const istAussen = new Map<number, boolean>();
  for (const rel of byType.get('IFCRELDEFINESBYPROPERTIES') ?? []) {
    const related = rel.attributes[4];
    const definition = rel.attributes[5];
    if (!Array.isArray(related) || !isRef(definition)) continue;
    const pset = entities.get(definition.ref);
    if (!pset || pset.type !== 'IFCPROPERTYSET') continue;
    const props = pset.attributes[4];
    if (!Array.isArray(props)) continue;

    let wert: boolean | undefined;
    for (const pr of props) {
      if (!isRef(pr)) continue;
      const prop = entities.get(pr.ref);
      if (!prop || prop.type !== 'IFCPROPERTYSINGLEVALUE') continue;
      if (prop.attributes[0] !== 'IsExternal') continue;
      const v = prop.attributes[2];
      if (v === 'T') wert = true;
      else if (v === 'F') wert = false;
      break;
    }
    if (wert === undefined) continue;
    for (const r of related) if (isRef(r)) istAussen.set(r.ref, wert);
  }

  const fallbackLevel = levels[0]?.id ?? 'ifc-level-0';
  if (!levels.length) {
    levels.push({ id: fallbackLevel, name: 'Geschoss', elevation: 0, height: 2.75 });
  }

  // --- Wände -----------------------------------------------------------------
  const nodes: BimNode[] = [];
  const walls: Wall[] = [];
  const openings: Opening[] = [];
  const skipped = new Map<string, number>();
  const note = (reason: string) => skipped.set(reason, (skipped.get(reason) ?? 0) + 1);
  const hinweise = new Map<string, number>();
  const hinweis = (reason: string) => hinweise.set(reason, (hinweise.get(reason) ?? 0) + 1);

  let nodeCounter = 0;
  const nodeAt = (x: number, y: number, levelId: string): BimNode => {
    // Enden zusammenführen, die dichter als 2 cm beieinander liegen —
    // IFC-Dateien aus verschiedenen Programmen treffen sich selten exakt.
    for (const n of nodes) {
      if (n.levelId === levelId && Math.hypot(n.x - x, n.y - y) < 0.02) return n;
    }
    const node: BimNode = {
      id: `ifc-n${nodeCounter++}`,
      x: Math.round(x * 1000) / 1000,
      y: Math.round(y * 1000) / 1000,
      levelId,
    };
    nodes.push(node);
    return node;
  };

  /**
   * Die *echte* Wandachse, falls die Datei sie mitliefert.
   *
   * IFC kennt neben dem Körper eine eigene `Axis`-Repräsentation — eine
   * Linie, die die Wand meint, unabhängig davon, wie der Körper daneben
   * liegt. Programme wie Revit und ArchiCAD schreiben sie immer. Wo sie
   * steht, ist sie der Wahrheit näher als die Mitte des Volumenkörpers:
   * bei einer Wand, deren Körper einseitig zur Achse liegt, verschiebt sich
   * sonst der ganze Grundriss um eine halbe Wandstärke.
   */
  const axisCurveOf = (e: StepEntity): { a: Vec2; b: Vec2 } | null => {
    for (const item of itemsOf(entities, e.attributes[6], 'Axis')) {
      const pts = curvePoints(entities, { ref: item.id });
      if (pts.length < 2) continue;
      const place = resolvePlacement(entities, e.attributes[5]);
      const cos = Math.cos(place.angle);
      const sin = Math.sin(place.angle);
      const toWorld = (c: number[]) => ({
        x: place.x + (c[0] ?? 0) * cos - (c[1] ?? 0) * sin,
        y: place.y + (c[0] ?? 0) * sin + (c[1] ?? 0) * cos,
      });
      const a = toWorld(pts[0]);
      const b = toWorld(pts[pts.length - 1]);
      if (Math.hypot(b.x - a.x, b.y - a.y) > 0.05) return { a, b };
    }
    return null;
  };

  /**
   * Maße einer Öffnung, deren Profil senkrecht in der Wandebene steht.
   *
   * Die beiden Profilrichtungen heißen hier nicht mehr „längs" und „quer",
   * sondern **waagerecht** und **senkrecht**: welche der beiden die Höhe
   * ist, entscheidet die Neigung der jeweiligen Achse, nicht ihre Länge.
   * Ein hohes schmales Fenster (0,60 × 1,80) käme sonst als 1,80 m breit
   * und 0,60 m hoch heraus — und die Fläche stimmte trotzdem, was den
   * Fehler unsichtbar machte, bis jemand den Rohbau danebenhält.
   *
   * Die **Brüstungshöhe** ist die Unterkante des Profils: der Profilmittel-
   * punkt in Weltkoordinaten, minus die halbe Höhe. Beim Fenster
   * `EG-Fenster-6` des FZK-Hauses sind das 0,80 (Geschosslage der Öffnung)
   * + 0,60 (Profilmitte) − 1,20/2 = **0,80 m** — die Brüstung eines
   * gewöhnlichen Wohnhausfensters.
   */
  const ausSenkrechtemProfil = (
    e: StepEntity,
    profil: ProfileBox,
    dreibein: Dreibein,
    tiefe: number,
    objekt: { x: number; y: number; z: number; angle: number },
  ) => {
    const exSenkrecht = Math.abs(dreibein.ex[2]);
    const eySenkrecht = Math.abs(dreibein.ey[2]);
    const hoehe = exSenkrecht > eySenkrecht ? profil.xDim : profil.yDim;
    const breite = exSenkrecht > eySenkrecht ? profil.yDim : profil.xDim;
    const waagerecht = exSenkrecht > eySenkrecht ? dreibein.ey : dreibein.ex;

    // Profilmitte: Ursprung des Profils plus sein Versatz, ausgedrückt in
    // den beiden Profilrichtungen, danach die Drehung des Bauteils um die
    // Hochachse.
    const lx = dreibein.loc[0] + dreibein.ex[0] * profil.offset.x + dreibein.ey[0] * profil.offset.y;
    const ly = dreibein.loc[1] + dreibein.ex[1] * profil.offset.x + dreibein.ey[1] * profil.offset.y;
    const lz = dreibein.loc[2] + dreibein.ex[2] * profil.offset.x + dreibein.ey[2] * profil.offset.y;
    const cos = Math.cos(objekt.angle);
    const sin = Math.sin(objekt.angle);

    const curve = axisCurveOf(e);
    const richtung = curve
      ? Math.atan2(curve.b.y - curve.a.y, curve.b.x - curve.a.x)
      : Math.atan2(
          waagerecht[0] * sin + waagerecht[1] * cos,
          waagerecht[0] * cos - waagerecht[1] * sin,
        );

    return {
      centre: { x: objekt.x + lx * cos - ly * sin, y: objekt.y + lx * sin + ly * cos },
      angle: richtung,
      length: breite,
      thickness: tiefe,
      height: hoehe,
      // Für eine Öffnung wird `zBase` als Brüstungshöhe gelesen.
      zBase: objekt.z + lz - hoehe / 2,
      beschnitten: false,
      versatz: 0,
    };
  };

  /**
   * Der umschreibende Kasten einer Punktwolke, im System des Bauteils.
   *
   * Die längere der beiden waagerechten Ausdehnungen ist die Wandlänge, die
   * kürzere die Dicke. Steht die Wand quer in ihrem eigenen System — was
   * vorkommt, sobald eine Abbildung sie um 90° dreht —, wird die Drehung um
   * denselben Viertelkreis nachgeholt. Ohne das läge eine 6 m lange Wand als
   * 6 m *dicke* im Plan.
   */
  const kastenAus = (punkte: number[][]) => {
    if (punkte.length < 4) return null;
    const xs = punkte.map((p) => p[0] ?? 0);
    const ys = punkte.map((p) => p[1] ?? 0);
    const zs = punkte.map((p) => p[2] ?? 0);
    const dx = Math.max(...xs) - Math.min(...xs);
    const dy = Math.max(...ys) - Math.min(...ys);
    const hoehe = Math.max(...zs) - Math.min(...zs);
    if (!(dx > 1e-6) && !(dy > 1e-6)) return null;
    const laengsX = dx >= dy;
    return {
      mx: (Math.max(...xs) + Math.min(...xs)) / 2,
      my: (Math.max(...ys) + Math.min(...ys)) / 2,
      laenge: laengsX ? dx : dy,
      dicke: laengsX ? dy : dx,
      hoehe,
      dreh: laengsX ? 0 : Math.PI / 2,
      zUnten: Math.min(...zs),
    };
  };

  /**
   * Mittelachse und Dicke eines Bauteils aus seiner Extrusion.
   *
   * `beschnitten` sagt, ob der Körper erst durch eine Boolesche Verknüpfung
   * hindurch erreichbar war — dann stimmt die Grundfläche, aber die Höhe ist
   * die des ungeschnittenen Quaders. Siehe `basisExtrusion`.
   */
  const axisOf = (e: StepEntity) => {
    const solids = solidsOf(entities, e.attributes[6]);
    let extruded: StepEntity | null = null;
    let beschnitten = false;
    for (const s of solids) {
      const basis = basisExtrusion(entities, s);
      if (!basis) continue;
      extruded = basis;
      beschnitten = basis !== s;
      break;
    }
    if (!extruded) {
      /*
       * **Die Rückfallebene: messen statt lesen.**
       *
       * Kein Extrusionskörper — dann ist der Körper ein Netz, ein
       * Begrenzungsflächenkörper oder eine abgebildete Vorlage. Für eine
       * Wand genügt dann ihr umschreibender Kasten: Länge, Dicke, Höhe.
       * Das ist gröber als eine gelesene Extrusion und um Größenordnungen
       * besser als die Wand wegzulassen — was bis 1.33.0 geschah.
       */
      let punkte: number[][] = [];
      for (const s2 of solids) punkte = punkte.concat(punkteVon(entities, s2));
      const kasten = kastenAus(punkte);
      if (!kasten) return null;

      /*
       * **Wo die Messung aufhört, ehrlich zu sein.**
       *
       * Ein umschreibender Kasten ist genau dann die Wand, wenn der Körper
       * eine ist. Läuft eine Wand über Eck oder steckt ein ganzer Wandzug in
       * einem Körper, ist der Kasten breiter als jede der Wände darin — in
       * `202103162102_cira.ifc` kommen so zwei „Wände" von 2,11 m und 1,50 m
       * Dicke heraus, bei 91 Wänden insgesamt.
       *
       * Eine 2 m dicke Wand ist für die Raumerkennung schlimmer als eine
       * fehlende: Sie frisst den halben Raum. Sie wird deshalb übersprungen
       * und genannt, statt sie zu übernehmen oder ihre Dicke auf einen
       * hübschen Wert zurechtzubiegen — eine zurechtgebogene Zahl wäre
       * erfunden.
       */
      if (kasten.dicke > MESS_DICKE_GRENZE) {
        note('Wand aus dem Körper gemessen, aber unplausibel dick (mehrere Wände in einem Körper?)');
        return null;
      }
      hinweis('Wandmaße aus dem Körper gemessen, nicht aus einem Profil gelesen');

      const objekt = resolvePlacement(entities, e.attributes[5]);
      const cos2 = Math.cos(objekt.angle);
      const sin2 = Math.sin(objekt.angle);
      const curve2 = axisCurveOf(e);
      return {
        centre: {
          x: objekt.x + kasten.mx * cos2 - kasten.my * sin2,
          y: objekt.y + kasten.mx * sin2 + kasten.my * cos2,
        },
        angle: curve2
          ? Math.atan2(curve2.b.y - curve2.a.y, curve2.b.x - curve2.a.x)
          : objekt.angle + kasten.dreh,
        length: kasten.laenge,
        thickness: kasten.dicke,
        height: kasten.hoehe,
        zBase: objekt.z + kasten.zUnten,
        // Gemessen, nicht gelesen: dieselbe Unschärfe wie bei einem
        // beschnittenen Körper, und sie wird genauso gemeldet.
        beschnitten: true,
        versatz: 0,
      };
    }

    const profile = profileBox(entities, extruded.attributes[0]);
    if (!profile) return null;

    const objectPlacement = resolvePlacement(entities, e.attributes[5]);
    const solidPlacement = resolvePlacement(entities, extruded.attributes[1]);
    const depth = typeof extruded.attributes[3] === 'number' ? inMeter(extruded.attributes[3]) : 0;

    /*
     * **Steht die Profilebene senkrecht?**
     *
     * Eine Wand wird aus ihrem Grundriss nach oben gezogen: das Profil liegt
     * waagerecht, `Axis` zeigt nach oben, und die Extrusionstiefe ist die
     * Wandhöhe. So liest der Rest dieser Funktion es.
     *
     * Eine **Öffnung** schreibt ArchiCAD anders herum. Das Profil ist die
     * Ansicht — Breite mal Höhe —, es steht senkrecht in der Wandebene, und
     * extrudiert wird quer durch die Wand. Die Tiefe ist dann die Wanddicke,
     * nicht die Höhe.
     *
     * Am FZK-Haus des KIT steht die Innentür als
     * `IFCRECTANGLEPROFILEDEF(…, 0.885, 2.01)` mit `Axis = (0,1,0)` und
     * 0,24 m Tiefe. Ohne diese Unterscheidung kam sie als 2,01 m breite und
     * **0,24 m hohe** Öffnung an; jedes Fenster wurde 0,30 m hoch, weil das
     * die Wandstärke ist. Die Fensterfläche trägt die Transmissionsverluste
     * — ein Faktor vier darin ist keine Ungenauigkeit mehr, sondern eine
     * andere Heizlast.
     *
     * Die Schranke bei 0,7 ist großzügig: eine Profilebene, die mehr als
     * 45° aus der Waagerechten gekippt ist, meint nicht mehr einen
     * Grundriss. Dazwischen gibt es nichts, was in einem Gebäude vorkäme.
     */
    const dreibein = achsen3d(entities, extruded.attributes[1]);
    if (Math.abs(dreibein.ez[2]) < 0.7) {
      return ausSenkrechtemProfil(e, profile, dreibein, depth, objectPlacement);
    }

    // Profilmitte in Weltkoordinaten.
    const angle = objectPlacement.angle + solidPlacement.angle + profile.angle;
    const cos = Math.cos(objectPlacement.angle);
    const sin = Math.sin(objectPlacement.angle);
    const localX = solidPlacement.x + profile.offset.x;
    const localY = solidPlacement.y + profile.offset.y;
    const cx = objectPlacement.x + localX * cos - localY * sin;
    const cy = objectPlacement.y + localX * sin + localY * cos;

    // Die längere Profilseite ist die Wandachse, die kürzere die Dicke.
    const along = Math.max(profile.xDim, profile.yDim);
    const thickness = Math.min(profile.xDim, profile.yDim);
    const axisAngle = profile.xDim >= profile.yDim ? angle : angle + Math.PI / 2;

    const fromBody = {
      centre: { x: cx, y: cy },
      angle: axisAngle,
      length: along,
      thickness,
      height: depth,
      zBase: objectPlacement.z + solidPlacement.z,
      beschnitten,
    };

    // Liegt eine Achsen-Repräsentation vor, gewinnt sie für Richtung, Länge
    // und Anschluss — die Dicke bleibt aus dem Körper, denn die Achse allein
    // sagt nichts darüber.
    //
    // **Und sie liegt nicht zwangsläufig in der Wandmitte.** IFC nennt sie
    // *Bezugslinie*, nicht Mittellinie: `IfcMaterialLayerSetUsage` sagt mit
    // `OffsetFromReferenceLine` und `DirectionSense` dazu, wo der
    // Schichtaufbau relativ zu ihr liegt. ArchiCAD schreibt für das FZK-Haus
    // durchweg `(…, .AXIS2., .NEGATIVE., 0.)`: die Bezugslinie liegt auf der
    // **Außenfläche**, die 30 cm Wand hängen vollständig daneben.
    //
    // Der Unterschied ist nicht kosmetisch. Wer die Bezugslinie für die
    // Mitte hält, baut das FZK-Haus auf 12,00 × 10,00 m Achsmaß statt auf
    // 11,70 × 9,70 — die Galerie im Dachgeschoss kommt dann mit 113,49 m²
    // statt der 107,16 m² heraus, die in der Datei selbst als `IfcSpace`
    // stehen. 5,9 % zu viel Fläche, und zwar in jedem Raum.
    //
    // Gemessen wird der Versatz hier **geometrisch**, nicht aus dem Pset:
    // der Körpermittelpunkt ist die Wahrheit, und sein Abstand zur
    // Bezugslinie — senkrecht gemessen — ist genau der gesuchte Wert. Das
    // ist robuster, als `IfcMaterialLayerSetUsage` zu lesen, denn es gilt
    // auch für Dateien, die gar keinen Schichtaufbau mitliefern, und es
    // kann nicht widersprüchlich werden.
    //
    // Verschoben wird die Achse hier noch nicht: die Bezugslinien treffen
    // sich in den Ecken exakt, und darauf beruht die ganze Knotenbildung.
    // Der Versatz wird mitgeführt und erst danach in einem Zug angewandt
    // (`ruecke Knoten auf die Mittellinien`).
    const curve = axisCurveOf(e);
    if (curve) {
      const dx = curve.b.x - curve.a.x;
      const dy = curve.b.y - curve.a.y;
      const laenge = Math.hypot(dx, dy);
      const nx = -dy / laenge;
      const ny = dx / laenge;
      const versatz = (cx - curve.a.x) * nx + (cy - curve.a.y) * ny;
      return {
        ...fromBody,
        centre: { x: (curve.a.x + curve.b.x) / 2, y: (curve.a.y + curve.b.y) / 2 },
        angle: Math.atan2(dy, dx),
        length: laenge,
        versatz,
      };
    }

    // Ohne Achsen-Repräsentation ist der Körpermittelpunkt bereits die
    // Mittellinie — es bleibt nichts zu verschieben.
    return { ...fromBody, versatz: 0 };
  };

  /** Was eine Wand für die Knotenrückung beiträgt. */
  interface Mittellinie {
    a: string;
    b: string;
    /** Einheitsnormale der Bezugslinie. */
    nx: number;
    ny: number;
    /** Abstand der Mittellinie von der Bezugslinie, in Richtung der Normale. */
    versatz: number;
    dicke: number;
  }
  const mittellinien: Mittellinie[] = [];

  for (const type of WALL_TYPES) {
    for (const e of byType.get(type) ?? []) {
      const axis = axisOf(e);
      if (!axis || axis.length < 0.05) {
        note('Wand ohne auswertbare Extrusionsgeometrie');
        continue;
      }

      const levelId = levelOfProduct.get(e.id) ?? fallbackLevel;
      const half = axis.length / 2;
      const dx = Math.cos(axis.angle) * half;
      const dy = Math.sin(axis.angle) * half;
      const a = nodeAt(axis.centre.x - dx, axis.centre.y - dy, levelId);
      const b = nodeAt(axis.centre.x + dx, axis.centre.y + dy, levelId);
      if (a.id === b.id) {
        note('Wand mit zusammenfallenden Enden');
        continue;
      }

      if (axis.beschnitten) {
        hinweis('Wandhöhe aus ungeschnittener Extrusion (Dachschräge o. ä.)');
      }

      const name = typeof e.attributes[2] === 'string' ? e.attributes[2] : '';
      const wallType = guessWallType(axis.thickness, name, istAussen.get(e.id));
      walls.push({
        id: `ifc-w${e.id}`,
        a: a.id,
        b: b.id,
        thickness: Math.round(Math.max(0.05, axis.thickness) * 1000) / 1000,
        height: Math.round(Math.max(1, axis.height || 2.75) * 1000) / 1000,
        type: wallType,
        layerId: 'layer-walls',
        uValue: VORGABE_U[wallType],
        levelId,
      });

      if (Math.abs(axis.versatz) > 1e-9) {
        mittellinien.push({
          a: a.id,
          b: b.id,
          nx: -Math.sin(axis.angle),
          ny: Math.cos(axis.angle),
          versatz: axis.versatz,
          dicke: axis.thickness,
        });
      }
    }
  }

  rueckeKnotenAufMittellinien();

  /**
   * Knoten von den Bezugslinien auf die Mittellinien rücken.
   *
   * **Warum erst jetzt und nicht gleich beim Anlegen.** Die Bezugslinien
   * treffen sich in den Gebäudeecken punktgenau — daran hängt, dass aus
   * zwei Wandenden *ein* Knoten wird. Verschiebt man jede Wand für sich auf
   * ihre Mittellinie, reißt genau das auf: am FZK-Haus klafften an jeder
   * Ecke 15 cm, die Raumerkennung lief durch die Lücken hindurch und machte
   * aus sechs Räumen im Erdgeschoss einen einzigen.
   *
   * **Was stattdessen geschieht.** Die Topologie bleibt, wie die
   * Bezugslinien sie gestiftet haben; bewegt wird nur der Knoten, und zwar
   * dorthin, wo sich die *Mittellinien* aller an ihm hängenden Wände
   * treffen. Das ist dieselbe Operation, die ein CAD beim Verputzen einer
   * Ecke ausführt.
   *
   * **Die Rechnung.** Jede Wand fordert vom verschobenen Knoten `p` nur
   * eines: den richtigen senkrechten Abstand von ihrer Bezugslinie. Mit der
   * Einheitsnormalen `n` und dem Versatz `v` heißt das
   *
   *     (p − p₀) · n = v
   *
   * für die Verschiebung `d = p − p₀`. Zwei Wände über Eck geben zwei
   * solche Gleichungen und damit genau einen Punkt; ein freies Wandende gibt
   * nur eine und lässt `d` längs der Wand offen. Beides — und jede Zahl
   * dazwischen — löst dieselbe Formel, wenn man unter allen Lösungen die
   * *kürzeste* Verschiebung wählt:
   *
   *     M = Σ n·nᵀ      b = Σ n·v      d = M⁺ b
   *
   * Bei zwei rechtwinkligen Wänden ist `M` die Einheitsmatrix und `d` der
   * exakte Schnittpunkt. Bei einer einzigen Wand hat `M` den Rang 1, und
   * `M⁺ = M / spur(M)²` liefert `d = v·n` — also genau das Parallel-
   * verschieben, das dort richtig ist. Bei mehreren gleichgerichteten
   * Wänden kommt der Mittelwert der Versätze heraus.
   *
   * *Gegenprobe von Hand, Ecke Süd-West des FZK-Hauses.* Wand 1 läuft in y,
   * Normale (1|0), Versatz +0,15. Wand 2 läuft in x, Normale (0|1), Versatz
   * +0,15. M = [[1,0],[0,1]], b = (0,15 | 0,15), d = (0,15 | 0,15). Der
   * Knoten wandert von (0|0) nach (0,15|0,15) — die Innenkante liegt danach
   * bei 0,30, und genau dort beginnt in der Datei der Raum „Buero".
   *
   * **Die Bremse.** Zwei fast gleichgerichtete Wände schneiden sich weit
   * draußen: bei 15° Zwischenwinkel läge der Schnitt schon 58 cm vom
   * Knoten entfernt. So spitze Anschlüsse sind in einem Grundriss keine
   * Ecke mehr, sondern ein Artefakt. Mehr als das Doppelte der dicksten
   * beteiligten Wand wird deshalb nicht gerückt; stattdessen wird parallel
   * verschoben und der Fall gemeldet.
   */
  function rueckeKnotenAufMittellinien(): void {
    if (!mittellinien.length) return;

    // Erst alle Ausgangslagen festhalten. Würde man Knoten schon während
    // der Rechnung verschieben, bekäme der zweite T-Stoß einer Wand eine
    // andere Bezugslinie als der erste.
    const vorher = new Map(nodes.map((n) => [n.id, { x: n.x, y: n.y }]));

    /** Zwängt einen Knoten auf die Mittellinie einer Wand. */
    interface Bedingung {
      nx: number;
      ny: number;
      versatz: number;
      dicke: number;
    }
    const bedingungen = new Map<string, Bedingung[]>();
    const fordere = (knotenId: string, b: Bedingung) => {
      const liste = bedingungen.get(knotenId);
      if (liste) liste.push(b);
      else bedingungen.set(knotenId, [b]);
    };

    /*
     * Ein Raster über die Knoten, damit die T-Stoß-Suche nicht quadratisch
     * wird.
     *
     * Jede Wand müsste sonst jeden Knoten prüfen. Bei den 121 Wänden und
     * 180 Knoten des KIT-Institutsgebäudes wären das 22 000 Vergleiche —
     * unbemerkt. Bei einer Klinik mit 10 000 Wänden wären es 150 Millionen,
     * und aus einer halben Sekunde Import würden Minuten. Mit einer
     * Zellweite von einem Meter liegen in jeder Zelle nur die Knoten, die
     * für ein Wandstück dieser Zelle überhaupt in Frage kommen.
     */
    const ZELLE = 1;
    const schluessel = (x: number, y: number) =>
      `${Math.floor(x / ZELLE)}|${Math.floor(y / ZELLE)}`;
    const raster = new Map<string, BimNode[]>();
    for (const n of nodes) {
      const p0 = vorher.get(n.id);
      if (!p0) continue;
      const k = schluessel(p0.x, p0.y);
      const liste = raster.get(k);
      if (liste) liste.push(n);
      else raster.set(k, [n]);
    }

    for (const m of mittellinien) {
      const b: Bedingung = { nx: m.nx, ny: m.ny, versatz: m.versatz, dicke: m.dicke };
      fordere(m.a, b);
      fordere(m.b, b);

      // **T-Stöße.** Eine Innenwand, die mitten auf eine andere Wand trifft,
      // hat dort keinen gemeinsamen Knoten — `nodeAt` legt nur für Wand-
      // *enden* Knoten an. Solange alle Achsen Bezugslinien waren, lag das
      // Ende exakt auf der fremden Achse und alles schloss. Nach dem Rücken
      // täte es das nicht mehr: am FZK-Haus klaffte an jedem T-Stoß eine
      // Lücke von 12 cm, und die Raumerkennung lief hindurch — aus Bad,
      // Wohnen, Flur und Küche wurde ein Raum von 68 m².
      //
      // Deshalb bekommt ein Knoten, der auf dem Segment einer *anderen*
      // Wand liegt, auch deren Bedingung. Die Toleranz von 1 cm ist die
      // Rechengenauigkeit einer IFC-Datei, nicht ein Suchradius: was weiter
      // weg liegt, war nie ein Anschluss.
      const pa = vorher.get(m.a);
      const pb = vorher.get(m.b);
      if (!pa || !pb) continue;
      const dx = pb.x - pa.x;
      const dy = pb.y - pa.y;
      const l2 = dx * dx + dy * dy;
      if (l2 < 1e-9) continue;

      // Nur die Zellen ablaufen, die das Wandstück berührt — einschließlich
      // einer Randzelle, weil ein Knoten dicht neben der Zellgrenze liegen
      // kann.
      const kandidaten = new Set<BimNode>();
      const x0 = Math.floor(Math.min(pa.x, pb.x) / ZELLE) - 1;
      const x1 = Math.floor(Math.max(pa.x, pb.x) / ZELLE) + 1;
      const y0 = Math.floor(Math.min(pa.y, pb.y) / ZELLE) - 1;
      const y1 = Math.floor(Math.max(pa.y, pb.y) / ZELLE) + 1;
      for (let gx = x0; gx <= x1; gx += 1) {
        for (let gy = y0; gy <= y1; gy += 1) {
          for (const n of raster.get(`${gx}|${gy}`) ?? []) kandidaten.add(n);
        }
      }

      for (const n of kandidaten) {
        if (n.id === m.a || n.id === m.b) continue;
        const p0 = vorher.get(n.id);
        if (!p0) continue;
        const t = ((p0.x - pa.x) * dx + (p0.y - pa.y) * dy) / l2;
        if (t <= 0.001 || t >= 0.999) continue;
        const abstand = Math.abs((p0.x - pa.x) * m.nx + (p0.y - pa.y) * m.ny);
        if (abstand > 0.01) continue;
        fordere(n.id, b);
      }
    }

    for (const [knotenId, liste] of bedingungen) {
      const knoten = nodes.find((n) => n.id === knotenId);
      const p0 = vorher.get(knotenId);
      if (!knoten || !p0) continue;

      let m00 = 0;
      let m01 = 0;
      let m11 = 0;
      let b0 = 0;
      let b1 = 0;
      for (const c of liste) {
        m00 += c.nx * c.nx;
        m01 += c.nx * c.ny;
        m11 += c.ny * c.ny;
        b0 += c.nx * c.versatz;
        b1 += c.ny * c.versatz;
      }

      const det = m00 * m11 - m01 * m01;
      const spur = m00 + m11;
      // Rang 1: die Pseudoinverse einer symmetrischen Rang-1-Matrix ist
      // M / spur(M)².
      const rang1 = (): { x: number; y: number } => ({
        x: (m00 * b0 + m01 * b1) / (spur * spur),
        y: (m01 * b0 + m11 * b1) / (spur * spur),
      });

      let d =
        det > 1e-6
          ? { x: (m11 * b0 - m01 * b1) / det, y: (m00 * b1 - m01 * b0) / det }
          : rang1();

      const grenze = Math.max(0.05, 2 * Math.max(...liste.map((c) => c.dicke)));
      if (Math.hypot(d.x, d.y) > grenze) {
        hinweis('Sehr spitzer Wandanschluss — Knoten nur parallel gerückt');
        d = rang1();
      }

      knoten.x = Math.round((p0.x + d.x) * 1000) / 1000;
      knoten.y = Math.round((p0.y + d.y) * 1000) / 1000;
    }
  }

  // --- Öffnungen -------------------------------------------------------------
  // Zuordnung Öffnung → Wand über IfcRelVoidsElement, Art über IfcRelFillsElement.
  const wallOfOpening = new Map<number, number>();
  for (const rel of byType.get('IFCRELVOIDSELEMENT') ?? []) {
    const host = rel.attributes[4];
    const opening = rel.attributes[5];
    if (isRef(host) && isRef(opening)) wallOfOpening.set(opening.ref, host.ref);
  }

  const fillOfOpening = new Map<number, OpeningKind>();
  for (const rel of byType.get('IFCRELFILLSELEMENT') ?? []) {
    const opening = rel.attributes[4];
    const filler = rel.attributes[5];
    if (!isRef(opening) || !isRef(filler)) continue;
    const f = entities.get(filler.ref);
    if (!f) continue;
    if (f.type === 'IFCWINDOW') fillOfOpening.set(opening.ref, 'window');
    else if (f.type === 'IFCDOOR') fillOfOpening.set(opening.ref, 'door');
  }

  const wallById = new Map(walls.map((w) => [w.id, w]));
  let openingCounter = 0;

  for (const e of byType.get('IFCOPENINGELEMENT') ?? []) {
    const hostId = wallOfOpening.get(e.id);
    const wall = hostId !== undefined ? wallById.get(`ifc-w${hostId}`) : undefined;
    if (!wall) {
      // Zwei verschiedene Sachverhalte, die sich in der Meldung nicht
      // gleichen dürfen.
      //
      // Ein Durchbruch in einer Decke oder einem Dach — beim FZK-Haus die
      // Treppenöffnung, `'Slab Opening'` in einem `IfcSlab` — ist **kein**
      // Fehler: CAD Light führt Öffnungen nur an Wänden, weil nur die in den
      // Grundriss gehören. Als „Öffnung ohne zugehörige Wand" gemeldet, sah
      // das nach einem verlorenen Bauteil aus und schickte einen auf die
      // Suche nach einem Fehler, den es nicht gibt.
      //
      // Fehlt der Wirt dagegen wirklich oder ist er eine Wand, die selbst
      // nicht gelesen werden konnte, dann ist die Öffnung tatsächlich weg —
      // und das muss anders klingen.
      const wirt = hostId !== undefined ? entities.get(hostId) : undefined;
      if (wirt && !WALL_TYPES.has(wirt.type)) {
        note(`Öffnung in ${wirt.type.replace(/^IFC/, '')} statt in einer Wand`);
      } else {
        note('Öffnung ohne zugehörige Wand');
      }
      continue;
    }

    const axis = axisOf(e);
    if (!axis) {
      note('Öffnung ohne auswertbare Geometrie');
      continue;
    }

    const na = nodes.find((n) => n.id === wall.a);
    const nb = nodes.find((n) => n.id === wall.b);
    if (!na || !nb) continue;

    // Abstand des Öffnungsmittelpunkts entlang der Wandachse.
    const wx = nb.x - na.x;
    const wy = nb.y - na.y;
    const wallLength = Math.hypot(wx, wy);
    if (wallLength < 1e-6) continue;
    const t = ((axis.centre.x - na.x) * wx + (axis.centre.y - na.y) * wy) / (wallLength * wallLength);
    const distance = t * wallLength;
    if (distance < 0 || distance > wallLength) {
      note('Öffnung außerhalb ihrer Wand');
      continue;
    }

    // Die Öffnungsbreite liegt längs der Wand, nicht quer — die kürzere
    // Profilseite ist die Wanddicke plus Zugabe.
    const width = axis.length;

    /*
     * **Die Brüstung zählt ab dem Fußboden, nicht ab dem Gelände.**
     *
     * `axis.zBase` steht in Weltkoordinaten: das Fenster im Dachgeschoss
     * des FZK-Hauses kam mit 3,50 m heraus — 2,70 m Geschosslage plus
     * 0,80 m Brüstung. Im Modell ist die Brüstungshöhe aber der Abstand
     * vom Fußboden *dieses* Geschosses; sonst sitzt jedes Fenster ab dem
     * ersten Obergeschoss über der Wand, und die Prüfung meldet zu Recht
     * „Öffnung reicht über die Wandhöhe hinaus" — ohne dass jemand
     * erraten könnte, woher die Zahl kommt.
     */
    const geschosslage = levels.find((l) => l.id === wall.levelId)?.elevation ?? 0;
    const bruestung = axis.zBase - geschosslage;

    const kind: OpeningKind = fillOfOpening.get(e.id) ?? (bruestung > 0.3 ? 'window' : 'passage');
    const height = axis.height || (kind === 'window' ? 1.4 : 2.01);
    const sill = kind === 'window' ? Math.max(0, bruestung) : 0;

    if (width < 0.2 || width > wallLength) {
      note('Öffnung mit unplausibler Breite');
      continue;
    }

    /*
     * **Dieselbe Prüfung für die Höhe — sie fehlte.**
     *
     * Die Breite wurde seit jeher auf Plausibilität geprüft, die Höhe nicht.
     * Im Korpus kamen dadurch sechs Öffnungen durch, die keine sind: 7,60 m
     * und 7,18 m hoch (Fassadenverglasungen, die über mehrere Geschosse
     * gehen) und 0,136 m (ein Schlitz). Die Öffnungsfläche geht unmittelbar
     * in die Transmissionsverluste ein; ein 7,6 m hohes Fenster in einer
     * 3 m hohen Wand ist keine Ungenauigkeit, sondern eine andere Heizlast.
     *
     * Die Grenzen sind bewusst weit: Über 0,20 m kommt das Kellerfenster
     * durch, bis 4,00 m die Hallentür. Die untere Grenze ist ausschließend,
     * und das mit Absicht — in der Allplan-Fassung des Institutsgebäudes
     * steht eine Tür von 2,10 m Breite und **genau** 0,20 m Höhe. Was
     * außerhalb liegt, gehört nachgezeichnet und nicht geraten.
     */
    if (height <= 0.2 || height > 4) {
      note('Öffnung mit unplausibler Höhe');
      continue;
    }

    /*
     * **Die Öffnung muss in ihre Wand passen — und das muss dastehen.**
     *
     * Geprüft wurde bisher nur die **Mitte**: Liegt sie auf der Wand, gilt
     * die Öffnung als gültig. Ihre Ränder durften darüber hinausragen, und
     * das taten sie: bis 2,18 m im Revit-Musterprojekt, 26-mal allein in der
     * Allplan-Fassung des Institutsgebäudes, im Median rund einen halben
     * Meter.
     *
     * Schaden nahm davon nicht die Heizlast — `openingSpan` schiebt die
     * Öffnung beim Zeichnen ohnehin an das Wandende, die Fläche bleibt also
     * erhalten und landet an der richtigen Wand. Schaden nahm die
     * **Nachvollziehbarkeit**: Im Modell stand ein Abstand, den die
     * Zeichnung nicht benutzte, und niemand erfuhr davon. Wer das Fenster
     * später verschiebt, verschiebt es von einem Wert aus, der nie galt.
     *
     * Gerückt wird deshalb hier, einmal, und es wird gesagt. Die Breite
     * bleibt unangetastet — sie ist die Größe, an der die
     * Transmissionsverluste hängen.
     */
    const halbe = width / 2;
    const platz = Math.max(halbe, wallLength - halbe);
    const gerueckt = Math.min(Math.max(distance, halbe), platz);
    if (Math.abs(gerueckt - distance) > 0.02) {
      hinweis('Öffnung an das Wandende gerückt (sie ragte darüber hinaus)');
    }

    openings.push({
      id: `ifc-o${openingCounter++}`,
      wallId: wall.id,
      kind,
      distance: Math.round(gerueckt * 1000) / 1000,
      width: Math.round(width * 1000) / 1000,
      height: Math.round(height * 1000) / 1000,
      sillHeight: Math.round(sill * 1000) / 1000,
      layerId: 'layer-openings',
      ...(kind === 'window'
        ? { uValue: U_FENSTER_BESTAND }
        : kind === 'door'
          ? { uValue: U_TUER_BESTAND }
          : {}),
      gValue: kind === 'window' ? 0.6 : undefined,
    } as Opening);
  }

  // Die Zahl der übersprungenen Bauteile gehört in **denselben** Satz wie
  // die der gelesenen. Vorher stand hier nur die Erfolgsmeldung; ein Import,
  // bei dem ein ganzes Obergeschoss fehlte, las sich damit wie ein
  // gelungener. Wer die Wände nicht sofort vermisst, merkt es erst bei der
  // Heizlast — und dann sucht er den Fehler in der Rechnung.
  const uebersprungen = [...skipped.values()].reduce((a, b) => a + b, 0);
  // --- Räume aus der Datei ---------------------------------------------------
  //
  // Zugeordnet wird ein Raum seinem Geschoss über `IfcRelAggregates` — das
  // Geschoss *enthält* seine Räume, es enthält sie nicht räumlich wie ein
  // Bauteil. Manche Programme schreiben es trotzdem über
  // `IfcRelContainedInSpatialStructure`; beides wird gelesen, die Aggregation
  // gewinnt.
  const geschossDesRaums = new Map<number, string>();
  for (const rel of byType.get('IFCRELAGGREGATES') ?? []) {
    const eltern = rel.attributes[4];
    if (!isRef(eltern)) continue;
    const storey = storeys.find((st) => st.entity.id === eltern.ref);
    if (!storey) continue;
    const kinder = rel.attributes[5];
    if (!Array.isArray(kinder)) continue;
    for (const k of kinder) if (isRef(k)) geschossDesRaums.set(k.ref, storey.id);
  }

  /**
   * Der Umriss eines Raums in Weltkoordinaten.
   *
   * Erste Wahl ist die `FootPrint`-Repräsentation: eine Kurve auf dem Boden,
   * genau das, was gesucht ist. ArchiCAD schreibt sie für jeden Raum. Fehlt
   * sie, wird der `Body` herangezogen, sofern er eine Extrusion über einem
   * Polygonprofil ist — die zweite verbreitete Schreibweise. Ein `Brep`-
   * Körper bleibt außen vor: ihn in einen Grundriss zurückzurechnen wäre
   * eine eigene Aufgabe, und ein falsch geschlossener Umriss würde einen
   * Raumnamen an die falsche Stelle setzen.
   */
  const umrissVon = (e: StepEntity): Vec2[] => {
    const place = resolvePlacement(entities, e.attributes[5]);
    const cos = Math.cos(place.angle);
    const sin = Math.sin(place.angle);
    const welt = (c: number[]): Vec2 => ({
      x: place.x + (c[0] ?? 0) * cos - (c[1] ?? 0) * sin,
      y: place.y + (c[0] ?? 0) * sin + (c[1] ?? 0) * cos,
    });

    for (const item of itemsOf(entities, e.attributes[6], 'FootPrint')) {
      const kurven =
        item.type === 'IFCGEOMETRICCURVESET' || item.type === 'IFCGEOMETRICSET'
          ? (Array.isArray(item.attributes[0]) ? item.attributes[0] : [])
          : [{ ref: item.id }];
      let beste: Vec2[] = [];
      for (const c of kurven) {
        if (!isRef(c)) continue;
        const pts = curvePoints(entities, c).map(welt);
        if (pts.length >= 3 && Math.abs(flaeche(pts)) > Math.abs(flaeche(beste))) beste = pts;
      }
      if (beste.length >= 3) return beste;
    }

    /*
     * Der Extrusionskörper — und zwar für **alle drei** Profilarten, die im
     * Korpus fremder Dateien vorkommen. Bis hierher wurde nur
     * `IfcArbitraryClosedProfileDef` gelesen, und das ist ausgerechnet die
     * Art, die ArchiCAD für Räume *nicht* benutzt:
     *
     *   · Allplan schreibt `IfcRectangleProfileDef` — 82 Räume am
     *     Institutsgebäude, alle verloren.
     *   · Revit schreibt `IfcArbitraryProfileDefWithVoids` — 96 Räume am
     *     Musterprojekt, alle verloren. Der Name beginnt mit
     *     `IFCARBITRARYPROFILEDEF`, nicht mit `IFCARBITRARYCLOSEDPROFILEDEF`;
     *     die Prüfung auf den Namensanfang ging deshalb daneben.
     *
     * Die Löcher (`WithVoids`) werden bewusst nicht abgezogen: Ein Raum mit
     * Loch kommt im Wohnungsgrundriss nicht vor, und der Umriss dient hier
     * ohnehin nur dazu, den Raum wiederzufinden.
     */
    for (const solid of solidsOf(entities, e.attributes[6])) {
      const basis = basisExtrusion(entities, solid);
      if (!basis) continue;
      const prof = isRef(basis.attributes[0]) ? entities.get(basis.attributes[0].ref) : undefined;
      if (!prof) continue;
      const lokal = resolvePlacement(entities, basis.attributes[1]);

      if (prof.type.startsWith('IFCARBITRARYCLOSEDPROFILEDEF') || prof.type === 'IFCARBITRARYPROFILEDEFWITHVOIDS') {
        const pts = curvePoints(entities, prof.attributes[2]).map((c) =>
          welt([lokal.x + (c[0] ?? 0), lokal.y + (c[1] ?? 0)]),
        );
        if (pts.length >= 3) return pts;
        continue;
      }

      if (prof.type === 'IFCRECTANGLEPROFILEDEF') {
        const box = profileBox(entities, { ref: prof.id });
        if (!box) continue;
        const hx = box.xDim / 2;
        const hy = box.yDim / 2;
        const cosP = Math.cos(box.angle);
        const sinP = Math.sin(box.angle);
        const ecken: [number, number][] = [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]];
        const pts = ecken.map(([ex, ey]) =>
          welt([
            lokal.x + box.offset.x + ex * cosP - ey * sinP,
            lokal.y + box.offset.y + ex * sinP + ey * cosP,
          ]),
        );
        if (Math.abs(flaeche(pts)) > 0.01) return pts;
      }
    }

    // Zuletzt der Begrenzungsflächenkörper: Allplan und Revit schreiben
    // Räume so, und ohne diesen Zweig bleiben sie namenlos.
    for (const item of itemsOf(entities, e.attributes[6])) {
      const pts = brepBoden(entities, { ref: item.id });
      if (pts.length >= 3) return pts.map((c) => welt(c));
    }

    return [];
  };

  const spaces: ImportedSpace[] = [];
  for (const e of byType.get('IFCSPACE') ?? []) {
    // `LongName` (Attribut 7) ist der sprechende Name, `Name` (Attribut 2)
    // oft nur eine Nummer. Beim FZK-Haus steht in `Name` die „4" und in
    // `LongName` das „Schlafzimmer".
    const lang = typeof e.attributes[7] === 'string' ? e.attributes[7].trim() : '';
    const kurz = typeof e.attributes[2] === 'string' ? e.attributes[2].trim() : '';
    const name = lang || kurz;
    if (!name) continue;

    const polygon = umrissVon(e);
    if (polygon.length < 3) {
      note('Raum ohne auswertbaren Umriss');
      continue;
    }

    spaces.push({
      name,
      levelId: geschossDesRaums.get(e.id) ?? levelOfProduct.get(e.id) ?? fallbackLevel,
      polygon,
      area: Math.round(Math.abs(flaeche(polygon)) * 100) / 100,
    });
  }

  const message = walls.length
    ? `${walls.length} Wände, ${openings.length} Öffnungen und ${levels.length} Geschoss(e) gelesen` +
      (uebersprungen ? ` — ${uebersprungen} Bauteile übersprungen` : '')
    : 'Keine auswertbaren Wände gefunden — enthält die Datei Extrusionskörper?';

  return {
    ok: walls.length > 0,
    message,
    schema,
    projectName,
    levels,
    nodes,
    walls,
    openings,
    spaces,
    skipped: [...skipped.entries()].map(([reason, count]) => ({ reason, count })),
    hinweise: [...hinweise.entries()].map(([reason, count]) => ({ reason, count })),
  };
}
