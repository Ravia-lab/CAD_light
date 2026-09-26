/**
 * Prüfblock „Normsymbole" — steht im Bild, was das Zeichen verspricht?
 *
 * **Warum ein Prüfblock auf eine Zeichnung.** Die Formensprache eines
 * Fließbildes ist keine Verzierung, sondern die Auskunft: Wer den Kreis mit
 * dem **ausgefüllten** Dreieck sieht, liest „Pumpe"; wer denselben Umriss
 * ohne Füllung in einer Leitung sieht, liest „Rückschlagorgan". Genau diese
 * Verwechslung stand bis 1.54.0 im Programm — beide Zeichen trugen ein
 * gestricheltes Dreieck.
 *
 * Gemeldet hat es Manuel am Bild, nicht der Prüfstand: „ein Pumpe hat ein
 * Dreieck drin", „3 Wege Ventil sind 3 Dreiecke", „Mischergruppen Symbole
 * sind auch anderst". Drei Sätze, drei Fehler, kein roter Test. Dieser Block
 * ist die Antwort darauf.
 *
 * **Wie geprüft wird.** Ein Aufzeichner nimmt die Zeichenbefehle entgegen,
 * die `drawSymbol` absetzt, und merkt sich jeden abgeschlossenen Teilpfad
 * samt der Frage, ob er **gefüllt** oder **gestrichen** wurde. Danach lässt
 * sich abzählen, was in der Norm zählt: wie viele Dreiecke ein Zeichen führt,
 * welches davon gefüllt ist und wohin seine Spitze zeigt.
 *
 * Alle Sollwerte sind aus der Zeichenvorschrift von Hand hergeleitet und im
 * Kommentar begründet; keiner stammt aus einem Probelauf.
 */

import type { CheckFn } from './typ';
import type { SchematicKind } from '../../src/types/bim';
import { SCHEMATIC_LEGEND, drawSymbol, portsOf } from '../../src/lib/schematicSymbols';

// ---------------------------------------------------------------------------
// Der Aufzeichner
// ---------------------------------------------------------------------------

interface Punkt {
  x: number;
  y: number;
}

interface Teilpfad {
  punkte: Punkt[];
  gefuellt: boolean;
  /** `true`, sobald der Pfad eine Rundung enthält — dann ist es kein Vieleck. */
  gerundet: boolean;
  /** Womit gezeichnet wurde — um die Freistellfläche zu erkennen. */
  farbe: string;
}

/**
 * Ein Zeichenkontext, der nichts malt, sondern mitschreibt.
 *
 * Nur die Befehle, die die Symbolbibliothek tatsächlich benutzt. Was fehlt,
 * fällt beim Übersetzen auf und nicht erst im Ergebnis — deshalb kein
 * `any`-Auffangbecken und kein stilles Ignorieren.
 */
class Aufzeichner {
  readonly pfade: Teilpfad[] = [];
  private laufend: Punkt[] = [];
  private gerundet = false;
  private offen: Teilpfad[] = [];

  lineWidth = 1;
  lineJoin = '';
  lineCap = '';
  strokeStyle = '';
  fillStyle = '';
  font = '';
  textAlign = '';
  textBaseline = '';

  /**
   * `save`/`restore` führen einen echten Stapel.
   *
   * Als leere Rümpfe waren sie eine Falle: `drawSymbol` setzt die
   * Freistellfläche zwischen `save()` und `restore()` in der
   * Hintergrundfarbe. Ohne Stapel blieb `fillStyle` danach auf dieser Farbe
   * stehen — und das Dreieck der Pumpe, das unmittelbar darauf gefüllt wird,
   * galt dem Aufzeichner als Freistellfläche und verschwand aus der Zählung.
   */
  private stapel: { strokeStyle: string; fillStyle: string; lineWidth: number }[] = [];
  save(): void {
    this.stapel.push({ strokeStyle: this.strokeStyle, fillStyle: this.fillStyle, lineWidth: this.lineWidth });
  }
  restore(): void {
    const z = this.stapel.pop();
    if (!z) return;
    this.strokeStyle = z.strokeStyle;
    this.fillStyle = z.fillStyle;
    this.lineWidth = z.lineWidth;
  }
  translate(): void {}
  rotate(): void {}
  scale(): void {}
  setLineDash(): void {}
  fillText(): void {}
  fillRect(): void {}
  measureText(): { width: number } {
    return { width: 0 };
  }

  beginPath(): void {
    this.abschliessen();
    this.offen = [];
  }
  moveTo(x: number, y: number): void {
    this.abschliessen();
    this.laufend = [{ x, y }];
  }
  lineTo(x: number, y: number): void {
    this.laufend.push({ x, y });
  }
  quadraticCurveTo(_cx: number, _cy: number, x: number, y: number): void {
    this.gerundet = true;
    this.laufend.push({ x, y });
  }
  arc(cx: number, cy: number): void {
    this.gerundet = true;
    this.abschliessen();
    this.laufend = [{ x: cx, y: cy }];
  }
  closePath(): void {
    this.abschliessen();
  }
  /**
   * Rechtecke zählen als Vierecke.
   *
   * `rect` legt in einem Zug einen geschlossenen Teilpfad an. Vier Punkte —
   * damit fällt es durch die Dreieckszählung und stört sie nicht.
   */
  rect(x: number, y: number, w: number, h: number): void {
    this.abschliessen();
    this.laufend = [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ];
    this.abschliessen();
  }
  bezierCurveTo(_a: number, _b: number, _c: number, _d: number, x: number, y: number): void {
    this.gerundet = true;
    this.laufend.push({ x, y });
  }
  ellipse(cx: number, cy: number): void {
    this.gerundet = true;
    this.abschliessen();
    this.laufend = [{ x: cx, y: cy }];
    this.abschliessen();
  }
  stroke(): void {
    this.ablegen(false);
  }
  fill(): void {
    this.ablegen(true);
  }

  private abschliessen(): void {
    if (this.laufend.length > 0) {
      this.offen.push({ punkte: this.laufend, gefuellt: false, gerundet: this.gerundet, farbe: '' });
    }
    this.laufend = [];
    this.gerundet = false;
  }

  private ablegen(gefuellt: boolean): void {
    this.abschliessen();
    const farbe = gefuellt ? this.fillStyle : this.strokeStyle;
    for (const p of this.offen) this.pfade.push({ ...p, gefuellt, farbe });
    this.offen = [];
  }
}

/**
 * Was ein Symbol zeichnet — ohne Beschriftung, in Einheitskoordinaten.
 *
 * **Die Freistellfläche zählt nicht mit.** `drawSymbol` legt unter
 * Kreissymbolen zuerst eine Fläche in der Hintergrundfarbe ab, damit eine
 * durchlaufende Leitung nicht durch das Manometer scheint. Sie ist kein
 * Zeichen, sondern ein Radiergummi — und sie hätte beim Abzählen der Kreise
 * jedes Messgerät doppelt gezählt.
 */
const GRUND = '#ffffff';
function aufzeichnen(kind: SchematicKind): Teilpfad[] {
  const a = new Aufzeichner();
  drawSymbol(a as unknown as CanvasRenderingContext2D, kind, 0, 0, 1, {
    color: '#000000',
    background: GRUND,
    label: null,
    spec: null,
  });
  return a.pfade.filter((p) => p.farbe !== GRUND);
}

/**
 * Dreiecke in einem Zeichen.
 *
 * Ein Dreieck ist ein **eckiger** Teilpfad aus genau drei Punkten. Die
 * Rundung schließt Kapsel, Kreis und Speicherboden aus; die Punktzahl
 * schließt Rechtecke und Linien aus.
 */
const dreiecke = (pfade: readonly Teilpfad[]) => pfade.filter((p) => !p.gerundet && p.punkte.length === 3);

export function pruefeNormsymbole(check: CheckFn): void {
  // =========================================================================
  // 1 · Die Pumpe — Kreis mit ausgefülltem Dreieck
  // =========================================================================
  {
    const p = aufzeichnen('pump');
    const d = dreiecke(p);

    /*
     * Ein Dreieck, und es ist gefüllt. Bis 1.54.0 stand es als Umriss da —
     * derselbe Umriss, den `check-valve` für den Kegel gegen den Sitz
     * benutzt. Zwei Bauteile mit derselben Innenform sind in einem Fließbild
     * ein Fehler, auch wenn der Kreis drumherum sie unterscheidet.
     */
    check('Normsymbole · Pumpe führt genau ein Dreieck', d.length, 1);
    check('Normsymbole · und es ist ausgefüllt', d[0]?.gefuellt, true);

    /*
     * **Die Spitze zeigt in Förderrichtung**, also nach rechts: Der Stutzen
     * `out` liegt rechts (x = +0,5). Geprüft wird geometrisch — der Punkt mit
     * dem größten x steht allein, die beiden anderen liegen auf gleicher
     * Höhe links davon. Verkehrt herum eingebaut fördert die Pumpe nicht,
     * und das Symbol wäre eine falsche Aussage.
     */
    const xs = (d[0]?.punkte ?? []).map((q) => q.x).sort((a, b) => a - b);
    check('Normsymbole · zwei Punkte liegen hinten', xs.length === 3 && xs[0] === xs[1], true);
    check('Normsymbole · die Spitze liegt vorn', xs.length === 3 && xs[2] > xs[1], true);

    // Gegenprobe: Das Rückschlagorgan führt sein Dreieck **ohne** Füllung.
    const rueck = dreiecke(aufzeichnen('check-valve'));
    check('Normsymbole · Rückschlagklappe führt ein Dreieck', rueck.length, 1);
    check('Normsymbole · und zwar ungefüllt', rueck[0]?.gefuellt, false);
  }

  // =========================================================================
  // 2 · Drei Dreiecke — und wer von ihnen gefüllt ist
  // =========================================================================
  {
    /*
     * **Umschaltventil und Mischer sind zwei Zeichen, nicht eines.** Die
     * Legende der Wolf-Hydraulikschemen führt „Dreiwegemischer mit
     * elektrischem Antrieb" und „3-Wegeumschaltventil" als getrennte
     * Einträge.
     *
     * Gemeinsam ist ihnen die Form: **drei Dreiecke**, Spitzen im
     * Mittelpunkt — zwei aus der liegenden Acht (waagerechter Durchgang),
     * eines für den dritten Weg nach unten.
     *
     * Unterschiedlich ist die Füllung: Beim Umschaltventil ist der
     * **gesperrte** Weg geschwärzt, daran ist die Stellung ablesbar. Der
     * Mischer regelt stufenlos — er hat keinen gesperrten Weg, also kein
     * gefülltes Dreieck.
     */
    const um = dreiecke(aufzeichnen('valve-diverter'));
    check('Normsymbole · Umschaltventil sind drei Dreiecke', um.length, 3);
    check('Normsymbole · genau eines davon ist gefüllt', um.filter((t) => t.gefuellt).length, 1);

    const mi = dreiecke(aufzeichnen('valve-3way'));
    check('Normsymbole · Mischer sind ebenfalls drei Dreiecke', mi.length, 3);
    check('Normsymbole · beim Mischer ist keines gefüllt', mi.filter((t) => t.gefuellt).length, 0);

    /*
     * Und das gefüllte Dreieck des Umschaltventils ist der **dritte Weg**,
     * nicht einer der beiden waagerechten: Seine Punkte liegen unterhalb der
     * Mittellinie (y > 0), die der liegenden Acht symmetrisch darum.
     */
    const gefuellt = um.find((t) => t.gefuellt);
    const untenliegend = (gefuellt?.punkte ?? []).filter((q) => q.y > 0).length;
    check('Normsymbole · der gefüllte Weg ist der Abgang nach unten', untenliegend, 2);

    // Das Durchgangsventil bleibt bei zwei Dreiecken — sonst wäre die
    // Abzählung „drei = drei Wege" nichts wert.
    check('Normsymbole · Durchgangsventil sind zwei Dreiecke', dreiecke(aufzeichnen('valve-2way')).length, 2);
  }

  // =========================================================================
  // 3 · Das Ausdehnungsgefäß ist eine Kapsel, kein Kreis
  // =========================================================================
  {
    /*
     * Der Kreis ist in dieser Formensprache für Messgeräte und Pumpen
     * belegt. Ein Membran-Ausdehnungsgefäß ist ein stehendes Gefäß mit
     * gewölbten Böden — gezeichnet als Kapsel. Bis 1.54.0 stand hier ein
     * Kreis, und auf einem Blatt mit Manometer und Thermometer daneben war
     * das Gefäß nur noch an der Membranlinie zu erkennen.
     *
     * Geprüft wird über den Aufzeichner: Ein `arc` ist ein Kreis, eine
     * Kapsel entsteht aus `quadraticCurveTo`. Im Zeichen darf deshalb kein
     * Vollkreis mehr stehen.
     */
    const mag = aufzeichnen('expansion-vessel');
    const kreise = mag.filter((p) => p.gerundet && p.punkte.length === 1);
    check('Normsymbole · Ausdehnungsgefäß ohne Vollkreis', kreise.length, 0);
    check('Normsymbole · dafür eine gerundete Kapsel', mag.filter((p) => p.gerundet && p.punkte.length > 1).length, 1);

    // Gegenprobe: Das Manometer **ist** ein Kreis und bleibt einer.
    const mano = aufzeichnen('pressure-gauge');
    check('Normsymbole · das Manometer bleibt ein Kreis', mano.filter((p) => p.gerundet && p.punkte.length === 1).length, 1);
  }

  // =========================================================================
  // 4 · Die beiden Puffer sind zwei Zeichen
  // =========================================================================
  {
    /*
     * **Der Reihenpuffer hat zwei Anschlüsse, der Parallelpuffer vier.**
     *
     * Die Schemaprüfung sagt das seit je in Worten: „Der Reihenpuffer liegt
     * in Reihe im Rücklauf des Sekundärkreises und hat dort genau zwei
     * Anschlüsse." Gezeichnet wurde er trotzdem mit dem Zeichen des
     * Parallelpuffers — vier Stutzen, von denen die Auslegung zwei
     * anschloss. Die beiden anderen standen als Leitungsstummel im Bild und
     * endeten im Nichts. In einem Fließbild ist das keine Unschönheit,
     * sondern eine falsche Aussage: Ein gezeichneter Stutzen behauptet einen
     * Anschluss.
     *
     * Abgezählt aus der Zeichenvorschrift: Parallelpuffer `gen-flow`,
     * `gen-return`, `sys-flow`, `sys-return` — **vier**. Reihenpuffer
     * `sys-return` und `gen-return` — **zwei**.
     */
    check('Normsymbole · Parallelpuffer hat vier Anschlüsse', portsOf('buffer').length, 4);
    check('Normsymbole · Reihenpuffer hat zwei', portsOf('buffer-series').length, 2);
    check('Normsymbole · die hydraulische Weiche hat vier', portsOf('separator').length, 4);

    // Beide Anschlüsse des Reihenpuffers liegen im Rücklauf — keiner trägt
    // einen Vorlaufnamen. Sonst wäre er wieder als Trennspeicher gezeichnet.
    const reihe = portsOf('buffer-series');
    check('Normsymbole · beide Stutzen sind Rücklaufstutzen', reihe.filter((p) => p.id.endsWith('-return')).length, 2);

    // Und er ist ein eigener Eintrag in der Legende: Wer ein fremdes Blatt
    // liest, muss die beiden Bauarten unterscheiden können.
    check('Normsymbole · der Reihenpuffer steht in der Legende', SCHEMATIC_LEGEND['buffer-series'].name, 'Reihenpuffer');
    check('Normsymbole · und heißt anders als der Parallelpuffer', SCHEMATIC_LEGEND.buffer.name === SCHEMATIC_LEGEND['buffer-series'].name, false);
  }

  // =========================================================================
  // 5 · Kein Zeichen ohne Zeichenvorschrift
  // =========================================================================
  {
    /*
     * `SchematicKind` wächst mit jeder Fassung. Ein neues Bauteil ohne
     * Zeichenvorschrift fiele beim Übersetzen auf — eine Vorschrift, die
     * **nichts** zeichnet, nicht. Dann steht im Schema ein Name über einer
     * leeren Stelle.
     */
    const arten = Object.keys(SCHEMATIC_LEGEND) as SchematicKind[];
    check('Normsymbole · alle Arten haben eine Legende', arten.length > 30, true);
    const leer = arten.filter((k) => aufzeichnen(k).length === 0);
    check(`Normsymbole · kein Zeichen ohne Striche${leer.length ? ` (${leer.slice(0, 3).join(', ')})` : ''}`, leer.length, 0);
    const ohneStutzen = arten.filter((k) => portsOf(k).length === 0);
    check(`Normsymbole · kein Zeichen ohne Anschluss${ohneStutzen.length ? ` (${ohneStutzen.slice(0, 3).join(', ')})` : ''}`, ohneStutzen.length, 0);
  }
}
