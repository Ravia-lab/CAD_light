/**
 * Bauteile in der 3D-Ansicht anfassen und ändern.
 * ---------------------------------------------------------------------------
 * **Die Forderung:** Wände löschen und in der Größe ändern, im Raum stehend —
 * und Heizkörper, Fenster, Türen und Durchgänge ebenso.
 *
 * **Warum Griffe und nicht Eingabefelder.** Felder gibt es im Inspektor
 * längst. Wer sie benutzt, muss aber wissen, *welches* Maß er ändern will,
 * bevor er es sieht — und im Bestand weiß man das nicht: Man steht vor der
 * Wand, sieht, dass sie zu hoch ist, und will sie herunterziehen. Der Griff
 * ist der Weg von der Beobachtung zur Zahl; das Feld ist der Weg von der Zahl
 * zur Zahl.
 *
 * **Warum die Zahl trotzdem eingetippt werden kann.** Ziehen ist ungenau, und
 * auf dem Tablet ist es sehr ungenau. Ein Aufmaß besteht aber aus Zahlen, die
 * jemand abgelesen hat: 2,62 m Raumhöhe, 1,26 m Brüstung. Deshalb ist jeder
 * Griff **beides** — eine Zugrichtung und ein Feld. Antippen öffnet das Feld,
 * Ziehen ändert grob, und wer das Bandmaß in der Hand hat, tippt.
 *
 * **Was hier steht und was nicht.** Dieses Modul beschreibt, *welche Griffe
 * es an einem Bauteil gibt*, *welchen Wert sie tragen*, *wie weit er gehen
 * darf* und *was eine Änderung im Modell bedeutet*. Es zeichnet nichts und
 * ändert nichts — es liefert eine Beschreibung, die der Betrachter zeichnet
 * und die der Speicher anwendet. Genau deshalb lässt sich jede Grenze prüfen,
 * ohne eine Oberfläche zu starten: Ob eine Wand unter 1,50 m fallen darf, ist
 * eine fachliche Frage und keine Frage der Mausbedienung.
 *
 * Schichtgrenze: nur Typen und andere lib-Bausteine.
 */

import type { BimDocument, Fixture, Opening, Selection, Vec2, Wall } from '../types/bim';
import { FIXTURE_BY_TYPE } from '../types/bim';
import { getWallGeometry, openingsOfWall, wallLocalToWorld } from './wallGeometry';

// ---------------------------------------------------------------------------
// Was ein Griff ist
// ---------------------------------------------------------------------------

/**
 * Welches Maß ein Griff ändert.
 *
 * Die Namen sagen das Bauteil **und** das Maß, weil dieselbe Geste an
 * verschiedenen Bauteilen Verschiedenes bedeutet: Die Höhe einer Wand ist
 * ihre Bauhöhe, die Höhe eines Fensters ist seine lichte Höhe, und die Höhe
 * eines Heizkörpers ist sein Bauteilmaß — drei Zahlen, die nichts miteinander
 * zu tun haben.
 */
export type GriffArt =
  | 'wandHoehe'
  | 'wandDicke'
  | 'wandEndeA'
  | 'wandEndeB'
  | 'oeffnungBreite'
  | 'oeffnungHoehe'
  | 'oeffnungBruestung'
  | 'oeffnungLage'
  | 'objektLaenge'
  | 'objektTiefe'
  | 'objektHoehe';

export const GRIFF_LABELS: Record<GriffArt, string> = {
  wandHoehe: 'Wandhöhe',
  wandDicke: 'Wandstärke',
  wandEndeA: 'Wandende (Anfang)',
  wandEndeB: 'Wandende (Ende)',
  oeffnungBreite: 'Lichte Breite',
  oeffnungHoehe: 'Lichte Höhe',
  oeffnungBruestung: 'Brüstungshöhe',
  oeffnungLage: 'Abstand ab Wandanfang',
  objektLaenge: 'Baulänge',
  objektTiefe: 'Bautiefe',
  objektHoehe: 'Montagehöhe',
};

/**
 * Ein Griff in der Szene.
 *
 * `punkt` und `hoehe` sind Modellkoordinaten, nicht Szenenkoordinaten: Die
 * Umrechnung gehört in den Betrachter und nur dorthin. Stünde sie hier, gäbe
 * es zwei Stellen, an denen die Spiegelung der y-Achse passieren kann — und
 * ein Vorzeichenfehler an dieser Stelle hat das Programm schon einmal Stunden
 * gekostet.
 */
export interface Griff {
  id: string;
  art: GriffArt;
  /** Lage des Griffs im Grundriss [m]. */
  punkt: Vec2;
  /** Höhe des Griffs über dem Geschossfußboden [m]. */
  hoehe: number;
  /**
   * Richtung, in die gezogen wird — Einheitsvektor im Modellraum.
   *
   * `z` ist der senkrechte Anteil. Ein Höhengriff hat `{x:0,y:0,z:1}`, ein
   * Dickengriff zeigt quer zur Wand, ein Lagegriff die Wandachse entlang.
   */
  achse: { x: number; y: number; z: number };
  /** Der Wert, den der Griff heute trägt [m]. */
  wert: number;
  /** Zulässiger Bereich [m] — außerhalb wird nicht gezogen und nicht getippt. */
  min: number;
  max: number;
  /** Rastermaß beim Ziehen [m]; beim Tippen gilt es nicht. */
  schritt: number;
  label: string;
}

/**
 * Was eine Griffänderung im Modell bedeutet.
 *
 * Bewusst eine Beschreibung und kein Aufruf: Der Speicher kennt die
 * Historie, die Raumerkennung und das Nachziehen abgeleiteter Werte — dieses
 * Modul kennt nur Geometrie. Würde hier gespeichert, wäre die Grenze
 * zwischen Rechenkern und Zustand dahin, und der Prüfblock bräuchte einen
 * laufenden Speicher.
 */
export type GriffAenderung =
  | { art: 'wand'; id: string; patch: Partial<Wall> }
  | { art: 'oeffnung'; id: string; patch: Partial<Opening> }
  | { art: 'objekt'; id: string; patch: Partial<Fixture> }
  | { art: 'knoten'; id: string; position: Vec2 };

// ---------------------------------------------------------------------------
// Grenzen — die fachlichen Zahlen, an einer Stelle
// ---------------------------------------------------------------------------

/**
 * Die kleinste Wandhöhe, die noch eine Wand ist [m].
 *
 * Keine Norm, eine Ableseregel: Unter 1,50 m ist es eine Brüstung, eine
 * Attika oder ein Zeichenfehler — aber kein Raumabschluss. Das Maß ist nicht
 * willkürlich gewählt: 1,50 m ist die Höhe, unter der die
 * Wohnflächenverordnung eine Fläche gar nicht mehr anrechnet.
 */
export const MIN_WANDHOEHE = 1.5;
export const MAX_WANDHOEHE = 6;

/**
 * Wandstärken zwischen 5 cm und 1 m.
 *
 * Unten sind 5 cm die dünnste Vorsatzschale, die man baut; darunter ist es
 * eine Trennwand aus Glas und keine Wand im Sinne des Modells. Oben trifft
 * ein Meter jedes Bruchsteinmauerwerk, das einem im Bestand begegnet.
 */
export const MIN_WANDDICKE = 0.05;
export const MAX_WANDDICKE = 1;

/** Kleinste lichte Öffnung [m] — darunter ist es eine Bohrung, kein Fenster. */
export const MIN_OEFFNUNG = 0.2;

/**
 * Wie viel Wand neben einer Öffnung stehen bleiben muss [m].
 *
 * **Warum es diese Grenze überhaupt gibt.** Ohne sie lässt sich eine Öffnung
 * bis in die Ecke schieben, und die Wanddarstellung zerfällt: `wallSolidParts`
 * erzeugt dort ein Wandstück von null Länge, das keine Fläche hat und im
 * Bild verschwindet. Im Modell steht dann eine Wand, die im Bild fehlt.
 *
 * Fünf Zentimeter sind kein statischer Nachweis — der gehört nicht in dieses
 * Programm. Sie sind das Maß, unterhalb dessen die Zeichnung unbrauchbar
 * wird.
 */
export const RAND_AN_DER_ECKE = 0.05;

// ---------------------------------------------------------------------------
// Die Griffe eines Bauteils
// ---------------------------------------------------------------------------

/**
 * Welche Griffe die Auswahl hergibt.
 *
 * Leere Liste für alles, was sich nicht mit Griffen ändern lässt — ein Raum
 * etwa ist abgeleitet, seine Größe folgt aus den Wänden. Eine leere Liste ist
 * also kein Fehler, sondern eine Aussage.
 */
export function griffeFuer(doc: BimDocument, auswahl: Selection | null): Griff[] {
  if (!auswahl) return [];
  if (auswahl.kind === 'wall') return wandGriffe(doc, auswahl.id);
  if (auswahl.kind === 'opening') return oeffnungsGriffe(doc, auswahl.id);
  if (auswahl.kind === 'fixture') return objektGriffe(doc, auswahl.id);
  return [];
}

function wandGriffe(doc: BimDocument, id: string): Griff[] {
  const wand = doc.walls[id];
  if (!wand) return [];
  const g = getWallGeometry(wand, doc.nodes);
  if (!g) return [];

  const mitte = wallLocalToWorld(g, g.length / 2, 0);
  const halb = wand.thickness / 2;

  /*
   * Der Höhengriff sitzt auf der Oberkante in der Wandmitte, der Dickengriff
   * auf halber Höhe an der Außenseite. Beide bewusst **nicht** an derselben
   * Stelle: Zwei Griffe übereinander sind auf dem Tablet ein Griff, und zwar
   * der falsche.
   */
  const griffe: Griff[] = [
    {
      id: `${id}:hoehe`,
      art: 'wandHoehe',
      punkt: mitte,
      hoehe: wand.height,
      achse: { x: 0, y: 0, z: 1 },
      wert: wand.height,
      min: MIN_WANDHOEHE,
      max: MAX_WANDHOEHE,
      schritt: 0.01,
      label: GRIFF_LABELS.wandHoehe,
    },
    {
      id: `${id}:dicke`,
      art: 'wandDicke',
      punkt: wallLocalToWorld(g, g.length / 2, halb),
      hoehe: wand.height / 2,
      achse: { x: g.normal.x, y: g.normal.y, z: 0 },
      /*
       * Gezogen wird an **einer** Seite, geändert wird die ganze Stärke.
       * Die Wand wächst dabei symmetrisch um ihre Achse — so, wie sie im
       * Modell definiert ist. Wer eine Seite allein verschieben will,
       * verschiebt in Wirklichkeit die Achse, und das ist eine andere
       * Handlung: Sie gehört in den Grundriss, wo man die Achse sieht.
       */
      wert: wand.thickness,
      min: MIN_WANDDICKE,
      max: MAX_WANDDICKE,
      schritt: 0.005,
      label: GRIFF_LABELS.wandDicke,
    },
  ];

  /*
   * Die beiden Wandenden.
   *
   * Sie ändern nicht die Wand, sondern den **Knoten** — und damit alles, was
   * sonst noch an ihm hängt. Das ist Absicht und der Grund, warum der Wert
   * die Länge ist und nicht eine Koordinate: „Diese Wand ist 4,12 m lang" ist
   * ein Aufmaß, „der Knoten liegt bei x = 7,34" ist keines.
   *
   * Der Griff am Anfang zieht den Anfangsknoten, der am Ende den Endknoten.
   * Beide messen dieselbe Länge — sie ändern sie nur von verschiedenen Seiten,
   * und das ist im Bestand ein Unterschied: Man misst von der Ecke, die steht.
   */
  const griffHoehe = Math.min(1.0, wand.height / 2);
  griffe.push(
    {
      id: `${id}:endeA`,
      art: 'wandEndeA',
      punkt: g.a,
      hoehe: griffHoehe,
      achse: { x: -g.dir.x, y: -g.dir.y, z: 0 },
      wert: g.length,
      min: 0.2,
      max: 60,
      schritt: 0.01,
      label: GRIFF_LABELS.wandEndeA,
    },
    {
      id: `${id}:endeB`,
      art: 'wandEndeB',
      punkt: g.b,
      hoehe: griffHoehe,
      achse: { x: g.dir.x, y: g.dir.y, z: 0 },
      wert: g.length,
      min: 0.2,
      max: 60,
      schritt: 0.01,
      label: GRIFF_LABELS.wandEndeB,
    },
  );
  return griffe;
}

function oeffnungsGriffe(doc: BimDocument, id: string): Griff[] {
  const op = doc.openings[id];
  if (!op) return [];
  const wand = doc.walls[op.wallId];
  if (!wand) return [];
  const g = getWallGeometry(wand, doc.nodes);
  if (!g) return [];

  const sturz = (op.sillHeight ?? 0) + op.height;
  const mitte = wallLocalToWorld(g, op.distance, 0);
  const halb = op.width / 2;

  /*
   * Wie weit darf die Öffnung breit werden?
   *
   * Nicht „bis zur Wandlänge": Links und rechts müssen Wandstücke stehen
   * bleiben, und **andere Öffnungen in derselben Wand** stehen auch im Weg.
   * Ohne diese Prüfung schiebt man zwei Fenster ineinander, und die
   * Wanddarstellung zerfällt lautlos — `wallSolidParts` läuft mit einem
   * Zeiger nach vorn und überspringt dann alles, was hinter dem Zeiger liegt.
   */
  const nachbarn = openingsOfWall(op.wallId, Object.values(doc.openings)).filter((o) => o.id !== op.id);
  let linkeGrenze = RAND_AN_DER_ECKE;
  let rechteGrenze = g.length - RAND_AN_DER_ECKE;
  for (const n of nachbarn) {
    const nVon = n.distance - n.width / 2;
    const nBis = n.distance + n.width / 2;
    if (nBis <= op.distance) linkeGrenze = Math.max(linkeGrenze, nBis + RAND_AN_DER_ECKE);
    if (nVon >= op.distance) rechteGrenze = Math.min(rechteGrenze, nVon - RAND_AN_DER_ECKE);
  }
  const verfuegbar = Math.min(op.distance - linkeGrenze, rechteGrenze - op.distance) * 2;
  /*
   * **Die Obergrenze ist schlicht der Platz — und die Untergrenze rutscht mit.**
   *
   * Zwei Anläufe waren nötig, und beide Male steckte der Fehler in einem
   * `Math.max`, das gut gemeint war.
   *
   * *Erster Anlauf:* `Math.max(MIN_OEFFNUNG, verfuegbar)`. Das hob die
   * Grenze genau dort wieder an, wo sie greifen sollte — bei einem dicht
   * stehenden Nachbarn blieben 0,20 m zulässig, und der 5-cm-Rand war
   * unterlaufen.
   *
   * *Zweiter Anlauf:* bei zu wenig Platz die heutige Breite als Obergrenze.
   * Das verhinderte das Wachsen, schützte den Rand aber ebenso wenig.
   * Rechnet man die Bedingung zurück, ist `verfuegbar < MIN_OEFFNUNG`
   * gleichbedeutend mit `Breite + 2·Spalt < 0,30 m`; bei eingehaltenem Rand
   * (Spalt ≥ 0,05) heißt das `Breite < 0,20 m`. Aus einem regelkonformen
   * Modell heraus war der Zweig also **gar nicht erreichbar** — er fror nur
   * eine schon vorhandene Verletzung ein.
   *
   * *Was beide übersahen:* Eine 16 cm breite Öffnung mit genau 5 cm Wand zum
   * Nachbarn bekam `min = max = MIN_OEFFNUNG`. Jede Berührung des Griffs —
   * auch die Eingabe des alten Wertes — kam durch `begrenze` als 0,20 m
   * heraus, und vom Rand blieben drei Zentimeter. Genau darunter erzeugt
   * `wallSolidParts` das Wandstück ohne Fläche.
   *
   * *Dritter Anlauf, und auch der war zu kurz:* Obergrenze gleich Platz,
   * Untergrenze mit. Dann konnte die Öffnung auch nicht mehr **kleiner**
   * werden — der Platz begrenzt aber nur das Wachsen. Eine zu breite
   * Öffnung ließ sich damit nicht mehr auf ein zulässiges Maß bringen,
   * also genau das nicht, was man in dieser Lage tun will.
   *
   * **Richtig sind zwei getrennte Grenzen, weil es zwei getrennte Fragen
   * sind.** Nach oben begrenzt der Platz — und wo eine Öffnung ihn schon
   * überschreitet (aus einem Import, aus einer älteren Fassung), ihre
   * heutige Breite: Sie darf bleiben, aber nicht weiter wachsen. Nach unten
   * begrenzt das Mindestmaß — und wo die Öffnung schon darunter liegt oder
   * der Platz kleiner ist, eben dieser Wert: Sie soll sich auf ein
   * zulässiges Maß bringen lassen.
   *
   * Aus beidem folgt eine Eigenschaft, die der wichtigste Prüfstein ist:
   * **Die heutige Breite liegt immer innerhalb der Grenzen.** Ein Antippen
   * kann sie deshalb nicht verschieben — und das war der Fehler, der drei
   * Anläufe überlebt hat. Fallen die Grenzen zusammen, ist der Griff ein
   * Anzeiger und kein Steller: Er nennt das Maß und ändert es nicht.
   */
  const maxBreite = Math.max(op.width, verfuegbar);
  const minBreite = Math.min(MIN_OEFFNUNG, op.width, verfuegbar);

  const griffe: Griff[] = [
    {
      id: `${id}:breite`,
      art: 'oeffnungBreite',
      punkt: wallLocalToWorld(g, op.distance + halb, 0),
      hoehe: (op.sillHeight ?? 0) + op.height / 2,
      achse: { x: g.dir.x, y: g.dir.y, z: 0 },
      wert: op.width,
      min: minBreite,
      max: maxBreite,
      schritt: 0.01,
      label: GRIFF_LABELS.oeffnungBreite,
    },
    {
      id: `${id}:hoehe`,
      art: 'oeffnungHoehe',
      punkt: mitte,
      hoehe: sturz,
      achse: { x: 0, y: 0, z: 1 },
      wert: op.height,
      min: MIN_OEFFNUNG,
      /*
       * Der Sturz darf die Wandoberkante nicht überschreiten. Sonst steht im
       * Modell ein Fenster, das oben aus der Wand herausragt — gezeichnet
       * wird es dann als Loch ohne Sturz, und im Plan fehlt die Wand darüber.
       */
      max: Math.max(MIN_OEFFNUNG, wand.height - (op.sillHeight ?? 0)),
      schritt: 0.01,
      label: GRIFF_LABELS.oeffnungHoehe,
    },
    {
      id: `${id}:lage`,
      art: 'oeffnungLage',
      punkt: wallLocalToWorld(g, op.distance, 0),
      hoehe: Math.max(0.15, (op.sillHeight ?? 0) - 0.15),
      achse: { x: g.dir.x, y: g.dir.y, z: 0 },
      wert: op.distance,
      min: linkeGrenze + halb,
      max: rechteGrenze - halb,
      schritt: 0.01,
      label: GRIFF_LABELS.oeffnungLage,
    },
  ];

  /*
   * Die Brüstung bekommt nur, was eine hat.
   *
   * Eine Tür und ein Durchgang stehen auf dem Fußboden; ein Brüstungsgriff
   * daran wäre ein Griff, der etwas verspricht, das es nicht gibt. Wer eine
   * Tür 20 cm anheben will, meint in Wirklichkeit eine Schwelle — und die
   * ist ein anderes Bauteil.
   */
  if (op.kind === 'window') {
    griffe.push({
      id: `${id}:bruestung`,
      art: 'oeffnungBruestung',
      punkt: mitte,
      hoehe: op.sillHeight ?? 0,
      achse: { x: 0, y: 0, z: 1 },
      wert: op.sillHeight ?? 0,
      min: 0,
      max: Math.max(0, wand.height - op.height),
      schritt: 0.01,
      label: GRIFF_LABELS.oeffnungBruestung,
    });
  }
  return griffe;
}

function objektGriffe(doc: BimDocument, id: string): Griff[] {
  const f = doc.fixtures[id];
  if (!f) return [];
  const def = FIXTURE_BY_TYPE[f.type];
  const rad = (f.rotation * Math.PI) / 180;
  const laengsX = Math.cos(rad);
  const laengsY = Math.sin(rad);

  return [
    {
      id: `${id}:laenge`,
      art: 'objektLaenge',
      punkt: { x: f.position.x + (laengsX * f.length) / 2, y: f.position.y + (laengsY * f.length) / 2 },
      hoehe: f.elevation + 0.15,
      achse: { x: laengsX, y: laengsY, z: 0 },
      wert: f.length,
      min: 0.1,
      max: 6,
      schritt: 0.01,
      label: GRIFF_LABELS.objektLaenge,
    },
    {
      id: `${id}:tiefe`,
      art: 'objektTiefe',
      punkt: { x: f.position.x - (laengsY * f.depth) / 2, y: f.position.y + (laengsX * f.depth) / 2 },
      hoehe: f.elevation + 0.15,
      achse: { x: -laengsY, y: laengsX, z: 0 },
      wert: f.depth,
      min: 0.02,
      max: 2,
      schritt: 0.005,
      label: GRIFF_LABELS.objektTiefe,
    },
    {
      id: `${id}:hoehe`,
      art: 'objektHoehe',
      punkt: f.position,
      hoehe: f.elevation,
      achse: { x: 0, y: 0, z: 1 },
      wert: f.elevation,
      min: 0,
      /*
       * Nach oben durch die Wandhöhe begrenzt, ersatzweise durch ein Maß,
       * das jedes Wohngeschoss trägt. Ein Heizkörper auf 4,80 m ist kein
       * Heizkörper mehr; er ist ein Zahlendreher.
       */
      max: f.wallId ? (doc.walls[f.wallId]?.height ?? 3) - 0.1 : 3,
      schritt: 0.01,
      label: def?.wallMounted ? GRIFF_LABELS.objektHoehe : 'Höhe über FFB',
    },
  ];
}

// ---------------------------------------------------------------------------
// Vom neuen Wert zur Änderung
// ---------------------------------------------------------------------------

/** Den Wert in die Grenzen des Griffs zwingen und auf Millimeter runden. */
export function begrenze(griff: Griff, wert: number): number {
  if (!Number.isFinite(wert)) return griff.wert;
  const v = Math.min(griff.max, Math.max(griff.min, wert));
  return Math.round(v * 1000) / 1000;
}

/**
 * Was im Modell zu ändern ist, damit der Griff diesen Wert trägt.
 *
 * `null`, wenn sich der Wert nicht umsetzen lässt — etwa weil das Bauteil
 * inzwischen gelöscht wurde. **Kein stiller Rückfall**: Eine Änderung, die
 * nichts bewirkt, darf keinen Schritt in der Historie erzeugen.
 */
export function aenderungFuer(
  doc: BimDocument,
  griff: Griff,
  rohWert: number,
): GriffAenderung | null {
  const wert = begrenze(griff, rohWert);
  const bauteilId = griff.id.split(':')[0];

  switch (griff.art) {
    case 'wandHoehe':
      return doc.walls[bauteilId] ? { art: 'wand', id: bauteilId, patch: { height: wert } } : null;
    case 'wandDicke':
      return doc.walls[bauteilId] ? { art: 'wand', id: bauteilId, patch: { thickness: wert } } : null;
    case 'wandEndeA':
    case 'wandEndeB': {
      const wand = doc.walls[bauteilId];
      if (!wand) return null;
      const g = getWallGeometry(wand, doc.nodes);
      if (!g) return null;
      /*
       * Das **feste** Ende ist das andere. Der Knoten wandert auf der
       * Wandachse, damit die Wand ihre Richtung behält: Wer eine Wand
       * verlängert, will sie länger haben und nicht schief.
       */
      const zieheA = griff.art === 'wandEndeA';
      const festId = zieheA ? wand.b : wand.a;
      const fest = doc.nodes[festId];
      const beweglichId = zieheA ? wand.a : wand.b;
      if (!fest || !doc.nodes[beweglichId]) return null;
      const richtung = zieheA ? { x: -g.dir.x, y: -g.dir.y } : { x: g.dir.x, y: g.dir.y };
      return {
        art: 'knoten',
        id: beweglichId,
        position: {
          x: Math.round((fest.x + richtung.x * wert) * 1000) / 1000,
          y: Math.round((fest.y + richtung.y * wert) * 1000) / 1000,
        },
      };
    }
    case 'oeffnungBreite':
      return doc.openings[bauteilId] ? { art: 'oeffnung', id: bauteilId, patch: { width: wert } } : null;
    case 'oeffnungHoehe':
      return doc.openings[bauteilId] ? { art: 'oeffnung', id: bauteilId, patch: { height: wert } } : null;
    case 'oeffnungBruestung':
      return doc.openings[bauteilId] ? { art: 'oeffnung', id: bauteilId, patch: { sillHeight: wert } } : null;
    case 'oeffnungLage':
      return doc.openings[bauteilId] ? { art: 'oeffnung', id: bauteilId, patch: { distance: wert } } : null;
    case 'objektLaenge':
      return doc.fixtures[bauteilId] ? { art: 'objekt', id: bauteilId, patch: { length: wert } } : null;
    case 'objektTiefe':
      return doc.fixtures[bauteilId] ? { art: 'objekt', id: bauteilId, patch: { depth: wert } } : null;
    case 'objektHoehe':
      return doc.fixtures[bauteilId] ? { art: 'objekt', id: bauteilId, patch: { elevation: wert } } : null;
    default:
      return null;
  }
}

/**
 * Wie weit ein Zug den Wert ändert.
 *
 * Der Zug wird auf die Griffachse **projiziert**: Man zieht selten genau in
 * der Achse, und ein Zug quer dazu soll nichts tun. Beim Dickengriff zählt er
 * doppelt, weil die Wand symmetrisch um ihre Achse wächst — zieht man die
 * Außenseite um 5 cm nach außen, ist die Wand 10 cm dicker geworden.
 */
export function wertAusZug(
  griff: Griff,
  zug: { x: number; y: number; z: number },
): number {
  const anteil = zug.x * griff.achse.x + zug.y * griff.achse.y + zug.z * griff.achse.z;
  const faktor = griff.art === 'wandDicke' ? 2 : 1;
  /*
   * **Gerastert wird die Änderung, nicht der Wert.**
   *
   * Der erste Entwurf rechnete `Math.round((wert + zug) / schritt) * schritt`
   * und zog damit auch dann aufs Raster, wenn der Zug null war. Ein Antippen
   * ohne Bewegung — und jeder Zug quer zur Achse — verschob jedes Maß, das
   * nicht ohnehin auf dem Zentimeter lag.
   *
   * Betroffen waren ausgerechnet die **Regelmaße**: Von den fünfzehn
   * Katalogöffnungen (Rohbaumaße nach DIN 18100) tragen zwölf mindestens ein
   * Maß abseits des Zentimeters — 0,885 · 1,135 · 1,385 · 1,76 · 2,01 ·
   * 2,135. (Nachgezählt, nicht geschätzt: Der erste Entwurf dieses
   * Kommentars sprach von „vierzehn von sechzehn" und lag bei beiden Zahlen
   * daneben.) Eine Tür mit 0,885 m wurde
   * durch bloßes Anfassen zu 0,890 m, eine Höhe von 2,135 m zu 2,130 m. Die
   * Sprungrichtung hing an der Gleitkommadarstellung und war damit auch noch
   * unvorhersehbar. Dasselbe traf jede abgelesene Raumhöhe wie 2,625 m.
   *
   * Das Raster ist eine Hilfe fürs **Ziehen**. Ein Aufmaß, das schon
   * dasteht, darf es nicht anfassen.
   */
  const aenderung = Math.round((anteil * faktor) / griff.schritt) * griff.schritt;
  return begrenze(griff, griff.wert + aenderung);
}

/**
 * Maße, an denen beim Ziehen gefangen wird.
 *
 * **Warum das mehr ist als Bequemlichkeit.** In einem Bestandsgebäude haben
 * alle Fenster einer Fassade dieselbe Brüstungshöhe, alle Türen dieselbe
 * lichte Höhe, alle Wände eines Geschosses dieselbe Bauhöhe — nicht ungefähr,
 * sondern genau. Wer das von Hand einstellt, trifft 1,255 statt 1,26 und
 * erzeugt damit eine Abweichung, die es am Bau nicht gibt und die später
 * jemand für eine Messung hält.
 *
 * Gefangen wird nur an Maßen, die **im selben Modell** schon vorkommen — es
 * gibt hier keine Tabelle üblicher Höhen. Eine solche Tabelle würde
 * Bestandsmaße auf Neubaumaße ziehen, und das ist das Gegenteil von Aufmaß.
 */
export function fangmasse(doc: BimDocument, griff: Griff): number[] {
  const werte = new Set<number>();
  const rund = (v: number) => Math.round(v * 1000) / 1000;

  if (griff.art === 'wandHoehe') {
    const level = doc.levels[doc.activeLevelId];
    if (level) werte.add(rund(level.height));
    for (const w of Object.values(doc.walls)) {
      if (w.levelId === doc.activeLevelId) werte.add(rund(w.height));
    }
  } else if (griff.art === 'oeffnungBruestung' || griff.art === 'oeffnungHoehe' || griff.art === 'oeffnungBreite') {
    const eigen = doc.openings[griff.id.split(':')[0]];
    for (const o of Object.values(doc.openings)) {
      if (o.id === eigen?.id) continue;
      if (eigen && o.kind !== eigen.kind) continue;
      if (griff.art === 'oeffnungBruestung') werte.add(rund(o.sillHeight ?? 0));
      else if (griff.art === 'oeffnungHoehe') werte.add(rund(o.height));
      else werte.add(rund(o.width));
    }
  } else if (griff.art === 'wandDicke') {
    for (const w of Object.values(doc.walls)) {
      if (w.levelId === doc.activeLevelId) werte.add(rund(w.thickness));
    }
  }
  werte.delete(rund(griff.wert));
  return [...werte].filter((v) => v >= griff.min && v <= griff.max).sort((a, b) => a - b);
}

/**
 * Das nächste Fangmaß, wenn es nah genug liegt.
 *
 * Zwei Zentimeter Fangweite: eng genug, dass man jeden Zwischenwert
 * erreicht, wenn man ihn wirklich will, und weit genug, dass man das
 * gemeinsame Maß nicht verfehlt.
 */
export function fange(werte: readonly number[], wert: number, weite = 0.02): number {
  let bester = wert;
  let abstand = weite;
  for (const v of werte) {
    const d = Math.abs(v - wert);
    if (d < abstand) {
      abstand = d;
      bester = v;
    }
  }
  return bester;
}

/** Die Zeile, die beim Ziehen am Griff steht. */
export function griffText(griff: Griff, wert: number, gefangen: boolean): string {
  const zahl = `${wert.toFixed(3).replace('.', ',')} m`;
  return `${griff.label} ${zahl}${gefangen ? ' · gefangen' : ''}`;
}

// ---------------------------------------------------------------------------
// Ein Maß auf gleichartige Bauteile übertragen
// ---------------------------------------------------------------------------

/** Wen ein Maß mitnehmen würde. */
export interface Gleichartige {
  /** Die Änderungen, die zu schreiben wären. */
  aenderungen: GriffAenderung[];
  /** Was im Knopf steht — mit Zahl, damit niemand blind auslöst. */
  beschreibung: string;
}

/**
 * Dieselbe Zahl auf alles legen, was offensichtlich dazugehört.
 *
 * **Der Handgriff, den das ersetzt.** Ein Bestandsgebäude hat eine
 * Fensterbrüstung, nicht sieben. Man misst sie einmal — und trägt sie dann
 * sieben Mal ein, weil jedes Fenster ein eigenes Objekt ist. Bei der vierten
 * Eingabe vertippt sich jemand, und im Plan steht ein Fenster, das zwei
 * Zentimeter tiefer sitzt als seine Nachbarn. Diese Abweichung sieht später
 * aus wie eine Messung.
 *
 * **Was „gleichartig" heißt — und was bewusst nicht.** Gleiche Öffnungsart
 * im selben Geschoss; gleiche Wandart im selben Geschoss. **Nicht**
 * geschossübergreifend: Im Obergeschoss sind die Brüstungen oft andere, und
 * ein Knopf, der zwei Geschosse gleichzeitig verstellt, wird beim ersten Mal
 * gedrückt und danach nie wieder.
 *
 * **Nicht übertragen werden Lagemaße.** Die Lage einer Öffnung in ihrer Wand
 * und die Länge einer Wand sind Einzelmaße — sie auf „alle gleichartigen" zu
 * legen, schöbe sämtliche Fenster auf denselben Abstand zur Ecke. Das ist
 * kein Aufmaß, das ist ein Schaden.
 *
 * `null`, wenn es nichts zu übertragen gibt — dann gehört auch kein Knopf
 * hin.
 */
export function gleichartige(doc: BimDocument, griff: Griff, wert: number): Gleichartige | null {
  const eigeneId = griff.id.split(':')[0];
  const level = doc.activeLevelId;
  const zahl = `${wert.toFixed(2).replace('.', ',')} m`;

  if (griff.art === 'oeffnungBruestung' || griff.art === 'oeffnungHoehe' || griff.art === 'oeffnungBreite') {
    const eigen = doc.openings[eigeneId];
    if (!eigen) return null;
    const feld =
      griff.art === 'oeffnungBruestung' ? 'sillHeight' : griff.art === 'oeffnungHoehe' ? 'height' : 'width';
    const aenderungen: GriffAenderung[] = [];
    for (const o of Object.values(doc.openings)) {
      if (o.id === eigen.id || o.kind !== eigen.kind) continue;
      const wand = doc.walls[o.wallId];
      if (!wand || wand.levelId !== level) continue;
      /*
       * Wer schon denselben Wert trägt, kommt nicht in die Liste. Sonst
       * stünde im Knopf „auf 7 übertragen", und sechs davon änderten sich
       * nicht — die Zahl im Knopf muss das Versprechen halten, das sie gibt.
       */
      const ist = feld === 'sillHeight' ? (o.sillHeight ?? 0) : feld === 'height' ? o.height : o.width;
      if (Math.abs(ist - wert) < 1e-6) continue;
      aenderungen.push({ art: 'oeffnung', id: o.id, patch: { [feld]: wert } as Partial<Opening> });
    }
    if (!aenderungen.length) return null;
    const art = eigen.kind === 'window' ? 'Fenster' : eigen.kind === 'door' ? 'Türen' : 'Durchgänge';
    return {
      aenderungen,
      beschreibung: `auf ${aenderungen.length} weitere ${art} im Geschoss übertragen (${zahl})`,
    };
  }

  if (griff.art === 'wandHoehe' || griff.art === 'wandDicke') {
    const eigen = doc.walls[eigeneId];
    if (!eigen) return null;
    const feld = griff.art === 'wandHoehe' ? 'height' : 'thickness';
    const aenderungen: GriffAenderung[] = [];
    for (const w of Object.values(doc.walls)) {
      if (w.id === eigen.id || w.levelId !== level) continue;
      /*
       * Die Wandart muss übereinstimmen. Eine Außenwand und eine
       * Trennwand haben im Bestand nie dieselbe Stärke, und die Höhe ist nur
       * deshalb oft gleich, weil beide im selben Geschoss stehen — aber eine
       * Brüstung ist auch eine Wand, und die soll nicht mitwachsen.
       */
      if (w.type !== eigen.type) continue;
      const ist = feld === 'height' ? w.height : w.thickness;
      if (Math.abs(ist - wert) < 1e-6) continue;
      aenderungen.push({ art: 'wand', id: w.id, patch: { [feld]: wert } as Partial<Wall> });
    }
    if (!aenderungen.length) return null;
    /*
     * **Alle vier Wandarten, nicht drei.**
     *
     * Der erste Entwurf bildete `exterior` und `interior` ab und schob alles
     * Übrige auf „Trennwände". Übertragen wurde dabei richtig — verglichen
     * wird `w.type` —, aber im Knopf stand bei einer Schachtwand „auf 3
     * weitere Trennwände übertragen". Ein Knopf, der etwas anderes sagt, als
     * er tut, wird genau einmal gedrückt.
     */
    const WANDART: Record<Wall['type'], string> = {
      exterior: 'Außenwände',
      interior: 'Innenwände',
      partition: 'Trennwände',
      shaft: 'Schachtwände',
    };
    const art = WANDART[eigen.type];
    return {
      aenderungen,
      beschreibung: `auf ${aenderungen.length} weitere ${art} im Geschoss übertragen (${zahl})`,
    };
  }

  /*
   * Alles Übrige ist ein Einzelmaß: die Lage einer Öffnung in ihrer Wand,
   * die Länge einer Wand, die Maße eines TGA-Objekts. Sie zu übertragen
   * ergäbe keine Zeitersparnis, sondern einen Schaden.
   */
  return null;
}
