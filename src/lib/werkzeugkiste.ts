/**
 * Die Werkzeugkiste im Haus.
 * ---------------------------------------------------------------------------
 * **Warum es sie gibt.** In der begehbaren Ansicht steht man dort, wo später
 * der Monteur steht. Genau dort fällt auf, dass die Leitung um die Ecke muss,
 * dass der Heizkörper unter das Fenster gehört und dass in dieser Wand eine
 * Bohrung fehlt. Bis 1.22.0 musste man dafür heraus, in den Grundriss, die
 * Stelle suchen und dort setzen — und war dann nicht mehr sicher, ob es
 * dieselbe Stelle war.
 *
 * **Warum getippt wird und nicht auf die Leinwand gefasst.** Im Begehmodus
 * dreht ein Zug über das Bild den Blick; das ist die Grundbedienung, und sie
 * darf nicht davon abhängen, ob gerade ein Werkzeug in der Hand ist. Gesetzt
 * wird deshalb dort, **wohin man schaut**: ein Fadenkreuz in der Bildmitte,
 * ein Strahl aus der Kamera, und ein Knopf, der auslöst. Das ist dieselbe
 * Geste wie beim Zielen mit einem Laserentfernungsmesser — wer einmal
 * aufgemessen hat, muss dafür nichts lernen.
 *
 * Dieses Modul hält den prüfbaren Kern: welche Werkzeuge es gibt, was der
 * Strahl getroffen hat, ob dort gesetzt werden darf und wie die Meldung
 * lautet. Die Ansicht selbst (Fadenkreuz, Leiste, Knöpfe) steckt in
 * `Viewer3D`; sie enthält keine Regel, die hier nicht steht.
 *
 * Schichtgrenze: nur Typen und andere lib-Bausteine.
 */

import type {
  BimDocument,
  Durchbruch,
  DurchbruchPreset,
  FixtureType,
  LevelId,
  PipeAccessoryKind,
  RadiatorConnection,
  Selection,
  Vec2,
  VentilSeite,
} from '../types/bim';
import {
  DURCHBRUCH_PRESETS,
  FIXTURE_BY_TYPE,
  PIPE_SERVICE_LABELS,
  RADIATOR_CONNECTION_LABELS,
  VENTILSEITE_LABELS,
} from '../types/bim';
import { deuteTreffer } from './raumtreffer';
import { getWallGeometry } from './wallGeometry';
import { hoehenText } from './beschriftung3d';

// ---------------------------------------------------------------------------
// Was in der Kiste liegt
// ---------------------------------------------------------------------------

/**
 * Was ein Werkzeug anlegt.
 *
 * `rohr` ist der einzige Zweipunkt-Fall — eine Leitung ohne Ende gibt es
 * nicht. Alles Übrige entsteht an **einer** Stelle, und genau das macht die
 * Bedienung im Haus erträglich: zielen, auslösen, fertig.
 */
export type WerkzeugArt = 'objekt' | 'rohr' | 'armatur' | 'durchbruch' | 'beschriftung' | 'aendern';

export interface Werkzeug {
  id: string;
  label: string;
  art: WerkzeugArt;
  /** Bei `objekt`: welches TGA-Objekt entsteht. */
  fixture?: FixtureType;
  /** Bei `armatur`: welche Armatur entsteht. */
  armatur?: PipeAccessoryKind;
  /** Bei `durchbruch`: welches Regelmaß voreingestellt ist. */
  preset?: string;
  /** Kurzzeile in der Leiste — sagt, worauf zu zielen ist. */
  ziel: string;
}

/**
 * Die Kiste.
 *
 * **Warum genau diese acht und nicht die ganze Symbolbibliothek.** Die
 * Bibliothek hat über dreißig Einträge. Eine Leiste mit dreißig Knöpfen am
 * Bildrand ist auf dem Tablet unbedienbar und im Kopf unsortierbar. Hier
 * stehen die Bauteile, die man in der Sanierung **im Raum stehend** aufnimmt
 * oder plant; alles Übrige wird weiterhin im Grundriss gesetzt, wo Platz für
 * eine Liste ist.
 */
export const WERKZEUGE: Werkzeug[] = [
  { id: 'heizkoerper', label: 'Heizkörper', art: 'objekt', fixture: 'radiator', ziel: 'auf die Wand unter dem Fenster' },
  { id: 'fussbodenheizung', label: 'Fußbodenheizung', art: 'objekt', fixture: 'underfloor', ziel: 'auf den Fußboden im Raum' },
  { id: 'verteiler', label: 'Verteiler', art: 'objekt', fixture: 'manifold', ziel: 'auf die Wand, an der der Schrank sitzt' },
  { id: 'speicher', label: 'Speicher', art: 'objekt', fixture: 'storage', ziel: 'auf den Aufstellort am Boden' },
  { id: 'rohr', label: 'Rohr', art: 'rohr', ziel: 'Anfang und Ende — die Höhe kommt vom Zielpunkt' },
  { id: 'ventil', label: 'Ventil', art: 'armatur', armatur: 'shutoff', ziel: 'auf die Leitung oder die Stelle an der Wand' },
  { id: 'durchbruch', label: 'Durchbruch', art: 'durchbruch', preset: 'kb-dn25', ziel: 'auf die Wandfläche, die durchbohrt wird' },
  { id: 'beschriften', label: 'Beschriften', art: 'beschriftung', ziel: 'auf das Bauteil, das benannt werden soll' },
  /*
   * **Ändern gehört in die Kiste, nicht daneben.**
   *
   * Bis 1.26.0 konnte man im begangenen Haus nur *setzen*. Wer im Raum stand
   * und sah, dass die Tür 0,885 m breit ist und nicht 1,01 m, musste
   * herausgehen, den Grundriss suchen und die Öffnung dort anfassen — und
   * hatte bis dahin vergessen, welche Tür es war. Aufmaß heißt aber genau
   * das: hinsehen, nachmessen, eintragen.
   *
   * Geändert wird im Gehen **durch Antippen und Eintippen**, nicht durch
   * Ziehen: Die Ziehgeste ist hier das Drehen des Kopfes, und beides auf
   * derselben Geste wäre unbedienbar. Das passt ohnehin besser — wer mit dem
   * Bandmaß vor dem Bauteil steht, hat eine Zahl und keine Richtung.
   */
  { id: 'aendern', label: 'Ändern', art: 'aendern', ziel: 'auf das Bauteil, dessen Maß nicht stimmt' },
];

export const WERKZEUG_BY_ID: Record<string, Werkzeug> = Object.fromEntries(
  WERKZEUGE.map((w) => [w.id, w]),
);

/**
 * Die Anschlussarten in der Reihenfolge, in der sie im Bestand vorkommen.
 *
 * Die Unterauswahl am Heizkörper steht in der Kiste und nicht erst im
 * Inspektor, weil die Anschlussart genau dann bekannt ist, wenn man vor dem
 * Heizkörper steht — und danach nie wieder ohne zweiten Gang.
 */
export const ANSCHLUSS_AUSWAHL: RadiatorConnection[] = ['mitte', 'unten', 'gleichseitig', 'wechselseitig'];

/** Die Ventilseiten samt „nicht erfasst". */
export const VENTIL_AUSWAHL: (VentilSeite | null)[] = [null, 'links', 'rechts'];

export function anschlussKurz(art: RadiatorConnection, seite: VentilSeite | null): string {
  const s = seite ? ` · ${VENTILSEITE_LABELS[seite]}` : '';
  return `${RADIATOR_CONNECTION_LABELS[art]}${s}`;
}

// ---------------------------------------------------------------------------
// Was das Fadenkreuz trifft
// ---------------------------------------------------------------------------

/** Ein Treffer des Zielstrahls, schon gedeutet. */
export interface Zieltreffer {
  /** Lage im Grundriss [m]. */
  punkt: Vec2;
  /** Höhe über Fertigfußboden des aktiven Geschosses [m]. */
  hoehe: number;
  /** Entfernung vom Auge [m] — steht am Fadenkreuz. */
  entfernung: number;
  /** Getroffenes TGA-Objekt, falls der Strahl eines erwischt hat. */
  fixtureId?: string;
  /** Getroffene Wand, falls der Punkt an einer liegt. */
  wallId?: string;
  /** Abstand entlang der Wandachse vom Knoten a [m]. */
  wandAbstand?: number;
  /** Getroffener Raum, falls der Punkt in einem liegt. */
  roomId?: string;
  /**
   * Getroffene Öffnung, falls der Strahl durch ein Fenster oder eine Tür
   * ging.
   *
   * Sie kommt nicht aus `deuteTreffer` — der kennt nur den Grundriss und
   * damit die Wand, in der die Öffnung sitzt. Im Raum stehend ist aber die
   * Öffnung das Bauteil, das man meint: Wer auf ein Fenster zeigt, will
   * dessen lichte Breite ändern und nicht die Wandstärke.
   */
  openingId?: string;
}

/**
 * Aus einem rohen Strahltreffer einen gedeuteten machen.
 *
 * Die Deutung ist **dieselbe** wie beim Antippen im Grundriss
 * (`deuteTreffer`). Das ist kein Zufall, sondern die Regel des Hauses: Die
 * 3D-Ansicht ist eine zweite Art zu zeigen, kein zweites Modell. Würde hier
 * eigenständig gerechnet, gäbe es zwei Antworten auf die Frage „welche Wand
 * ist das" — und die zweite wäre die, die niemand prüft.
 */
export function deuteZiel(
  doc: BimDocument,
  levelId: LevelId,
  roh: {
    punkt: Vec2;
    hoehe: number;
    entfernung: number;
    fixtureId?: string;
    /** Vom Strahl erkannte Öffnung — der Grundriss kennt nur die Wand. */
    openingId?: string;
  },
): Zieltreffer {
  const ziel: Zieltreffer = {
    punkt: roh.punkt,
    hoehe: Math.round(roh.hoehe * 1000) / 1000,
    entfernung: Math.round(roh.entfernung * 100) / 100,
    fixtureId: roh.fixtureId,
    openingId: roh.openingId,
  };
  if (roh.fixtureId) return ziel;
  const gedeutet = deuteTreffer(doc, levelId, roh.punkt);
  if (gedeutet.art === 'wand' && gedeutet.id) {
    ziel.wallId = gedeutet.id;
    ziel.wandAbstand = gedeutet.abstand;
  } else if (gedeutet.art === 'raum' && gedeutet.id) {
    ziel.roomId = gedeutet.id;
  }
  /*
   * Die Öffnung bringt ihre Wand mit.
   *
   * Der Strahl erkennt das Fenster an seinem Fangkörper; welche Wand es
   * trägt, steht am Modell. Ohne diese Zeile hätte man im Gehen ein Fenster
   * ohne Wand — und das Durchbruchwerkzeug, das eine Wandfläche verlangt,
   * hielte den Fensterlaibungsbereich für freien Raum.
   */
  if (roh.openingId && !ziel.wallId) {
    const wandId = doc.openings[roh.openingId]?.wallId;
    if (wandId) ziel.wallId = wandId;
  }
  return ziel;
}

/**
 * Was am Fadenkreuz steht.
 *
 * Eine Zeile, und sie beantwortet die einzige Frage, die beim Zielen zählt:
 * *worauf* zeige ich, und *wie weit* ist es. Ohne die Entfernung sieht eine
 * Wand in zwei Metern aus wie eine in sechs, und man setzt den Heizkörper
 * ins Nachbarzimmer.
 */
export function zielAuskunft(doc: BimDocument, ziel: Zieltreffer | null): string {
  if (!ziel) return 'kein Ziel — es liegt nichts in Blickrichtung';
  const ende = ` · ${ziel.entfernung.toFixed(2).replace('.', ',')} m · ${hoehenText(ziel.hoehe)}`;
  if (ziel.fixtureId) {
    const f = doc.fixtures[ziel.fixtureId];
    const name = f ? (f.label ?? FIXTURE_BY_TYPE[f.type]?.label ?? 'Objekt') : 'Objekt';
    return `${name}${ende}`;
  }
  if (ziel.wallId) {
    const w = doc.walls[ziel.wallId];
    const dicke = w ? ` ${Math.round(w.thickness * 1000)} mm` : '';
    return `Wand${dicke}${ende}`;
  }
  if (ziel.roomId) {
    const r = doc.rooms[ziel.roomId];
    return `${r?.name ?? 'Raum'}${ende}`;
  }
  return `Fläche${ende}`;
}

// ---------------------------------------------------------------------------
// Darf hier gesetzt werden?
// ---------------------------------------------------------------------------

/**
 * Die Antwort auf „was passiert, wenn ich jetzt auslöse".
 *
 * Sie steht **vor** dem Auslösen am Knopf. Ein Knopf, der manchmal etwas tut
 * und manchmal eine Fehlermeldung bringt, erzieht dazu, ihn mehrfach zu
 * drücken — und dann stehen drei Heizkörper übereinander.
 */
export interface Setzurteil {
  moeglich: boolean;
  /** Was der Knopf tun wird, bzw. warum er es nicht tut. */
  text: string;
}

export function darfSetzen(
  werkzeug: Werkzeug,
  ziel: Zieltreffer | null,
  rohrAnfang?: { punkt: Vec2; hoehe: number },
): Setzurteil {
  if (!ziel) return { moeglich: false, text: 'Erst auf eine Fläche zielen' };

  switch (werkzeug.art) {
    case 'objekt': {
      const def = werkzeug.fixture ? FIXTURE_BY_TYPE[werkzeug.fixture] : undefined;
      if (!def) return { moeglich: false, text: 'Unbekanntes Objekt' };
      /*
       * Wandgebundene Objekte brauchen eine Wand — und zwar hier, nicht erst
       * im Speicher.
       *
       * `addFixture` bindet ein wandgebundenes Objekt an die nächste Wand in
       * Reichweite. Zielt man mitten in den Raum, ist das die Wand hinter
       * einem, und der Heizkörper springt beim Setzen um vier Meter. Das sah
       * aus wie ein Fehler in der Umrechnung und war in Wahrheit ein
       * Zielfehler — deshalb wird er hier benannt, bevor er passiert.
       */
      if (def.wallMounted && !ziel.wallId) {
        return { moeglich: false, text: `${def.label} gehört an eine Wand — auf die Wandfläche zielen` };
      }
      if (!def.wallMounted && ziel.wallId) {
        return { moeglich: true, text: `${def.label} vor die Wand setzen` };
      }
      /*
       * Kein Hinweis auf die Höhe im Knopftext — und das mit Absicht.
       *
       * Der Strahl liefert beim Bauteil die **Stelle**, nicht die
       * Montagehöhe (siehe die Begründung in `Viewer3D`). Stünde hier
       * „…auf +1,32 m", behauptete der Knopf etwas, das er nicht tut.
       */
      return { moeglich: true, text: `${def.label} setzen` };
    }
    case 'rohr':
      if (!rohrAnfang) return { moeglich: true, text: 'Anfang der Leitung setzen' };
      return { moeglich: true, text: `Ende setzen — ${rohrLaenge(rohrAnfang.punkt, ziel.punkt).toFixed(2).replace('.', ',')} m` };
    case 'armatur':
      return { moeglich: true, text: 'Armatur setzen' };
    case 'durchbruch':
      if (!ziel.wallId) return { moeglich: false, text: 'Ein Durchbruch braucht eine Wandfläche' };
      return { moeglich: true, text: `Durchbruch in die Wand auf ${hoehenText(ziel.hoehe)}` };
    case 'beschriftung':
      if (!ziel.fixtureId) return { moeglich: false, text: 'Auf ein Bauteil zielen, das benannt werden soll' };
      return { moeglich: true, text: 'Werte zur Auswahl anzeigen' };
    case 'aendern': {
      const wahl = zielAuswahl(ziel);
      if (!wahl) return { moeglich: false, text: 'Auf ein Bauteil zielen — Wand, Fenster, Tür oder Gerät' };
      return { moeglich: true, text: `${AUSWAHL_LABELS[wahl.kind] ?? 'Bauteil'} fassen` };
    }
    default:
      return { moeglich: false, text: 'Unbekanntes Werkzeug' };
  }
}

/** Wie das Gefasste in der Meldung heißt. */
const AUSWAHL_LABELS: Partial<Record<Selection['kind'], string>> = {
  wall: 'Wand',
  opening: 'Öffnung',
  fixture: 'Bauteil',
  room: 'Raum',
};

/**
 * Was der Zielstrahl gefasst hat — als Auswahl, wie im Grundriss.
 *
 * **Die Reihenfolge ist die Rangfolge.** Ein Heizkörper vor einer Wand
 * gewinnt gegen die Wand; eine Öffnung gewinnt gegen die Wand, in der sie
 * sitzt. Wer auf ein Fenster zielt, meint das Fenster — die Wand kann er
 * daneben fassen. Zuletzt der Raum: Er hat im Gehen kein Maß, das man
 * ändern könnte, aber ihn zu fassen ist die einzige Art, im Raum stehend
 * seinen Namen oder seine Nutzung zu ändern.
 *
 * `null` heißt: nichts Fassbares getroffen. Der Fußboden ist kein Bauteil.
 */
export function zielAuswahl(ziel: Zieltreffer | null): Selection | null {
  if (!ziel) return null;
  if (ziel.fixtureId) return { kind: 'fixture', id: ziel.fixtureId };
  if (ziel.openingId) return { kind: 'opening', id: ziel.openingId };
  if (ziel.wallId) return { kind: 'wall', id: ziel.wallId };
  if (ziel.roomId) return { kind: 'room', id: ziel.roomId };
  return null;
}

/** Trassenlänge im Grundriss zwischen zwei Punkten [m]. */
export function rohrLaenge(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Die Verlegehöhe einer im Haus gezogenen Leitung.
 *
 * **Warum der Mittelwert und nicht der Anfang.** Eine Aufputzleitung im
 * Altbau läuft waagerecht; wer Anfang und Ende anvisiert, trifft sie an zwei
 * Stellen, die um ein paar Zentimeter auseinanderliegen — Zielgenauigkeit,
 * nicht Gefälle. Der Mittelwert ist von beiden Ablesungen gleich weit
 * entfernt; der Anfang wäre willkürlich die eine von zweien.
 *
 * Ein `PipeRun` trägt **eine** Höhe. Wer ein echtes Gefälle braucht, legt
 * zwei Abschnitte — das ist im Modell die ehrlichere Abbildung als eine
 * Höhe, die nur an einem Ende stimmt.
 */
export function rohrHoehe(h1: number, h2: number): number {
  return Math.round(((h1 + h2) / 2) * 1000) / 1000;
}

/**
 * Sitzt die Leitung auf Putz oder im Aufbau?
 *
 * Die Grenze bei 0,20 m ist keine Norm, sondern eine Ableseregel: Unter 20 cm
 * über Fertigfußboden liegt im Bestand praktisch nichts frei an der Wand —
 * dort ist der Sockel. Was darüber liegt, ist sichtbar verlegt und geht mit
 * dieser Eigenschaft in den Rohrbericht, weil die Dämmpflicht nach Anlage 8
 * GEG an der Lage hängt.
 */
export function aufputz(elevation: number): boolean {
  return elevation > 0.2;
}

/**
 * Das Regelmaß zum voreingestellten Durchbruch.
 *
 * Fällt die Voreinstellung weg (etwa weil eine Fassung die Liste ändert),
 * gibt es keinen stillen Rückfall auf „irgendeine" Bohrung: Ein Durchbruch
 * mit dem falschen Durchmesser ist auf der Baustelle teurer als gar keiner.
 */
export function durchbruchPreset(id: string | undefined): DurchbruchPreset | null {
  if (!id) return null;
  return DURCHBRUCH_PRESETS.find((p) => p.id === id) ?? null;
}

/**
 * Die Sturzhöhe eines im Haus gesetzten Durchbruchs.
 *
 * Gezielt wird auf die **Mitte** der Bohrung — so schaut man auf eine Wand,
 * und so liest man das Maß später am Bau ab („Bohrung auf 1,20"). Im Modell
 * steht aber die Unterkante (`sillHeight`), weil alles andere im Plan von
 * unten bemaßt wird. Die Umrechnung gehört genau einmal hierher.
 */
export function sturzAusZiel(zielHoehe: number, preset: DurchbruchPreset): number {
  const hoehe = preset.diameter ?? preset.height ?? 0;
  return Math.max(0, Math.round((zielHoehe - hoehe / 2) * 1000) / 1000);
}

/**
 * Passt der Durchbruch überhaupt in diese Wand — der Länge nach?
 *
 * Die Höhe prüft `durchbruchPasst` im Durchbruchmodul. Hier geht es um den
 * Fall, den man im Haus tatsächlich baut: Man zielt schräg auf eine kurze
 * Wand, der Strahl trifft sie zwei Zentimeter vor der Ecke, und die Bohrung
 * läge zur Hälfte in der Nachbarwand.
 */
export function durchbruchAmRand(
  doc: BimDocument,
  wallId: string,
  abstand: number,
  breite: number,
): string | null {
  const wand = doc.walls[wallId];
  if (!wand) return 'Die Wand gibt es nicht mehr';
  const g = getWallGeometry(wand, doc.nodes);
  if (!g) return 'Die Wand hat keine Geometrie';
  const halb = breite / 2;
  if (abstand - halb < 0 || abstand + halb > g.length) {
    return `Zu dicht an der Ecke — die Wand ist ${g.length.toFixed(2).replace('.', ',')} m lang`;
  }
  return null;
}

/**
 * Die Meldung nach dem Setzen.
 *
 * Sie nennt das Maß, nach dem jemand anreißt, nicht nur „gesetzt". Eine
 * Meldung ohne Maß ist im Haus wertlos: Man sieht das Bauteil ja ohnehin
 * stehen — was man nicht sieht, ist, wo genau es steht.
 */
export function durchbruchMeldung(d: Durchbruch, wandLaenge: number): string {
  const mass = d.diameter !== undefined
    ? `Ø${Math.round(d.diameter * 1000)}`
    : `${Math.round((d.width ?? 0) * 1000)} × ${Math.round((d.height ?? 0) * 1000)}`;
  const von = d.distance !== undefined ? `${d.distance.toFixed(2).replace('.', ',')} m ab Wandanfang` : 'frei';
  const uk = d.sillHeight !== undefined ? `, UK ${hoehenText(d.sillHeight)}` : '';
  return `${d.name} ${mass} — ${von}${uk} (Wand ${wandLaenge.toFixed(2).replace('.', ',')} m)`;
}

/**
 * Die Meldung nach dem Ziehen einer Leitung.
 *
 * Bei einem geneigten Abschnitt nennt sie **beide** Höhen. Die Alternative
 * wäre eine Mittelhöhe gewesen — und die beschreibt einen Strang so, dass
 * niemand merkt, dass es einer ist.
 */
export function rohrMeldung(
  medium: string,
  laenge: number,
  hoehe: number,
  hoeheBis?: number,
): string {
  const m = `${laenge.toFixed(2).replace('.', ',')} m`;
  if (hoeheBis !== undefined && Math.abs(hoeheBis - hoehe) >= 0.05) {
    const richtung = hoeheBis > hoehe ? 'steigt' : 'fällt';
    return `${medium}: ${m}, ${richtung} von ${hoehenText(hoehe)} auf ${hoehenText(hoeheBis)}`;
  }
  const lage = aufputz(hoehe) ? 'auf Putz' : 'im Aufbau';
  return `${medium}: ${m} ${lage} auf ${hoehenText(hoehe)}`;
}

/** Der Medienname zu einem Rohrwerkzeug — für die Meldung. */
export function mediumName(service: keyof typeof PIPE_SERVICE_LABELS): string {
  return PIPE_SERVICE_LABELS[service];
}
