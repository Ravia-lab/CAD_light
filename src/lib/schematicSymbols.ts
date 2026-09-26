/**
 * Symbolbibliothek für das Anlagenschema.
 * ---------------------------------------------------------------------------
 * **Warum es dieses Modul gibt.** Das Anlagenschema ist ein Fließbild, kein
 * Grundriss. Ein Fließbild lebt davon, dass jedes Bauteil an seiner *Form*
 * erkannt wird — nicht an einer Farbe, nicht an einem Icon, nicht an einer
 * Beschriftung. Wer ein Schema liest, sieht den Kreis mit dem Dreieck und
 * weiß: Pumpe. Er sieht das Dreieckpaar und weiß: Absperrung. Genau diese
 * Formensprache steht hier, an einer Stelle, damit sie in Bildschirm, Druck
 * und Export identisch ist.
 *
 * **Woher die Formen kommen.** Grundlage ist die übliche Darstellung in
 * Fließbildern nach DIN EN ISO 14617 (Graphische Symbole für Schemata) und
 * für die wärmetechnische Anlage nach DIN 2481. Die Norm ist
 * kostenpflichtig, ihre Symbolformen sind aber seit Jahrzehnten in jedem
 * Fachbuch, in jeder Herstellerplanungsunterlage und auf jedem Schemablatt
 * abgebildet und insofern Allgemeingut. Nachgezeichnet ist deshalb der
 * *Typus* — Kreis mit Dreieck für die Pumpe, Dreieckpaar für die Armatur,
 * gefüllter Zweig für den angesteuerten Weg, Feder für die federbelastete
 * Sicherheitsarmatur, Kreis mit waagerechter Trennlinie für das
 * Membranausdehnungsgefäß, Rechteck mit Schlange für den Wärmeübertrager,
 * stehendes Gefäß mit Wendel für den Speicher. Maße, Strichstärkenverhältnis
 * und Rasterteilung der Norm sind *nicht* übernommen, weil sie nicht frei
 * verfügbar sind; die Symbole sind stilisiert und auf Lesbarkeit am
 * Bildschirm gezeichnet. Ein normgerechtes Schemablatt im Sinne einer
 * Prüfvorlage entsteht daraus nicht — ein verständliches Anlagenschema schon.
 *
 * **Eine bewusste Abweichung.** Der gefüllte dritte Zweig an Dreiwege-,
 * Umschalt- und Trinkwassermischventil bezeichnet hier den *angesteuerten*
 * Weg. In vielen Fließbildern steht die geschwärzte Fläche umgekehrt für den
 * gesperrten Weg. Weil die Aussage aus dem Bild allein nicht eindeutig
 * hervorgeht, steht sie hier und in der Legende ausgeschrieben; wer das
 * Schema für eine Prüfung braucht, legt die Legende bei.
 *
 * **Zeichenmodell.** Jedes Symbol wird in *Einheitskoordinaten* beschrieben:
 * Ursprung in der Symbolmitte, eine Einheit entspricht dem Parameter `size`.
 * Die Transformation nach Bildschirmkoordinaten (Verschieben, Drehen,
 * Skalieren, Strichstärke zurückrechnen) macht `drawSymbol` einmal zentral —
 * dadurch bleiben die einzelnen Zeichenroutinen kurz und vergleichbar.
 *
 * **Farbe.** Ein Fließbild ist eine Strichzeichnung. Es wird ausschließlich
 * in der übergebenen Strichfarbe gezeichnet. Gefüllt wird nur zweierlei:
 * die wenigen Flächen, die *als Vollfläche* Bedeutung tragen (der gefüllte
 * Zweig am Dreiwegeventil, der Knotenpunkt) — die bekommen die Strichfarbe —
 * und die Freistellfläche unter Kreissymbolen, damit eine durchlaufende
 * Leitung nicht durch das Manometer hindurchscheint. Diese bekommt
 * `background` (Vorgabe Weiß). Wer auf dunklem Grund zeichnet, übergibt dort
 * die Hintergrundfarbe der Zeichenfläche.
 */

import type { SchematicKind } from '../types/bim';

type Ctx = CanvasRenderingContext2D;

// ---------------------------------------------------------------------------
// Öffentliche Typen
// ---------------------------------------------------------------------------

/** Seite, an der ein Anschluss aus dem Symbol austritt. */
export type PortSide = 'top' | 'bottom' | 'left' | 'right';

/**
 * Ein Anschlusspunkt eines Symbols.
 *
 * `x` und `y` sind **Vielfache von `size`**, gemessen vom Symbolmittelpunkt,
 * mit y nach unten (Bildschirmrichtung). Sie liegen auf dem Rand des
 * Belegungsrechtecks, damit der Schema-Generator eine Leitung anlegen kann,
 * ohne die Innenform des Symbols zu kennen.
 */
export interface SymbolPort {
  /** Stabiler Bezeichner, auf den der Generator sich beziehen darf. */
  id: string;
  /** Was an diesem Stutzen angeschlossen wird — deutsch, für die Anzeige. */
  label: string;
  side: PortSide;
  x: number;
  y: number;
}

/** Alle Anschlüsse eines Symbols. */
export type SymbolPorts = readonly SymbolPort[];

/** Legendeneintrag: Name und was das Bauteil in der Anlage tut. */
export interface SymbolLegendEntry {
  kind: SchematicKind;
  /** Kurzer deutscher Name, wie er auf dem Schemablatt steht. */
  name: string;
  /** Ein Satz für den Monteur: wozu das Ding da ist. */
  description: string;
}

/** Zeichenoptionen. Nur `color` ist Pflicht. */
export interface SymbolOptions {
  /** Strichfarbe. Alles außer Freistellflächen wird darin gezeichnet. */
  color: string;
  /** Strichstärke in Bildschirmpixeln, unabhängig von `size`. */
  lineWidth?: number;
  /**
   * Beschriftung über dem Symbol. Nicht gesetzt = Name aus der Legende,
   * leerer String oder `null` = keine Beschriftung.
   */
  label?: string | null;
  /** Technische Angabe unter dem Symbol, z. B. „DN 25" oder „3,0 bar". */
  spec?: string | null;
  /** Drehung des Symbols [Grad, im Uhrzeigersinn]. Die Texte bleiben waagerecht. */
  rotation?: number;
  /** Farbe der Freistellfläche unter Kreissymbolen. Vorgabe Weiß. */
  background?: string;
  /** Schriftgröße der Beschriftung [px]. Vorgabe: aus `size` abgeleitet. */
  fontSize?: number;
}

/** Signatur aller Einzelsymbole. */
export type SymbolRenderer = (
  ctx: Ctx,
  x: number,
  y: number,
  size: number,
  options: SymbolOptions,
) => void;

/** Rasterweite, auf der die Symbole entworfen wurden [px]. */
export const SYMBOL_SIZE = 34;

// ---------------------------------------------------------------------------
// Zeichenhilfen — alle in Einheitskoordinaten
// ---------------------------------------------------------------------------

const line = (ctx: Ctx, x1: number, y1: number, x2: number, y2: number): void => {
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
};

/** Rechteck um (cx, cy). */
const box = (ctx: Ctx, cx: number, cy: number, w: number, h: number): void => {
  ctx.rect(cx - w / 2, cy - h / 2, w, h);
};

/** Kreis als eigener Teilpfad — `moveTo` verhindert die Anschlusslinie. */
const circle = (ctx: Ctx, cx: number, cy: number, r: number): void => {
  ctx.moveTo(cx + r, cy);
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
};

/** Geschlossenes Vieleck aus [x, y]-Paaren. */
const poly = (ctx: Ctx, points: readonly (readonly [number, number])[]): void => {
  if (!points.length) return;
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
  ctx.closePath();
};

/**
 * Das Dreieckpaar — die Grundform jeder Armatur im Fließbild.
 *
 * Zwei mit den Spitzen aneinanderstoßende Dreiecke, umgangssprachlich die
 * „liegende Acht". Was daraus wird, entscheidet erst das, was oben auf dem
 * Schaft sitzt: Handrad, Stellantrieb, Feder.
 */
const bowTie = (ctx: Ctx, cx: number, cy: number, halfW: number, halfH: number): void => {
  poly(ctx, [
    [cx - halfW, cy - halfH],
    [cx - halfW, cy + halfH],
    [cx, cy],
  ]);
  poly(ctx, [
    [cx + halfW, cy - halfH],
    [cx + halfW, cy + halfH],
    [cx, cy],
  ]);
};

/** Handrad: Schaft mit Querbalken — die Armatur wird von Hand bedient. */
const handWheel = (ctx: Ctx, cx: number, cy: number, height: number): void => {
  line(ctx, cx, cy, cx, cy - height);
  line(ctx, cx - height * 0.5, cy - height, cx + height * 0.5, cy - height);
};

/** Feder als Zickzack — Kennzeichen jeder federbelasteten Armatur. */
const spring = (ctx: Ctx, cx: number, yTop: number, yBottom: number, amp: number, coils: number): void => {
  const step = (yBottom - yTop) / coils;
  ctx.moveTo(cx, yTop);
  for (let i = 0; i < coils; i++) {
    const y = yTop + step * i;
    ctx.lineTo(cx + (i % 2 === 0 ? amp : -amp), y + step * 0.5);
    ctx.lineTo(cx, y + step);
  }
};

/** Liegende Schlange — der Wärmeübertrager im Rechteck. */
const serpentine = (ctx: Ctx, x0: number, x1: number, y: number, amp: number, waves: number): void => {
  const step = (x1 - x0) / waves;
  ctx.moveTo(x0, y);
  for (let i = 0; i < waves; i++) {
    const a = x0 + step * i;
    ctx.quadraticCurveTo(a + step * 0.25, y - amp, a + step * 0.5, y);
    ctx.quadraticCurveTo(a + step * 0.75, y + amp, a + step, y);
  }
};

/** Stehende Wendel — die Heizschlange im Speicher. */
const coil = (ctx: Ctx, cx: number, yTop: number, yBottom: number, w: number, turns: number): void => {
  const step = (yBottom - yTop) / turns;
  ctx.moveTo(cx - w * 0.5, yTop);
  for (let i = 0; i < turns; i++) {
    const y = yTop + step * i;
    ctx.quadraticCurveTo(cx + w, y + step * 0.5, cx - w * 0.5, y + step);
  }
};

/** Ventilator: Kreis mit drei Flügeln. */
const fan = (ctx: Ctx, cx: number, cy: number, r: number): void => {
  circle(ctx, cx, cy, r);
  for (let i = 0; i < 3; i++) {
    const a = (i * Math.PI * 2) / 3 - Math.PI / 2;
    line(ctx, cx, cy, cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
};

/** Pfeilspitze bei (x, y) in Richtung `angle` [rad]. */
const arrowHead = (ctx: Ctx, x: number, y: number, angle: number, len: number): void => {
  line(ctx, x, y, x + Math.cos(angle + 2.6) * len, y + Math.sin(angle + 2.6) * len);
  line(ctx, x, y, x + Math.cos(angle - 2.6) * len, y + Math.sin(angle - 2.6) * len);
};

/**
 * Das **M** im Antriebskasten — Stellmotor.
 *
 * Aus Strichen gezeichnet und nicht als Text: `fillText` hängt an der
 * Schriftart der Zeichenfläche, und die ist am Bildschirm eine andere als im
 * Druck und im SVG-Export. Ein Buchstabe, der in drei Ausgaben verschieden
 * breit ist, sprengt den Kasten, in dem er steht.
 */
const letterM = (ctx: Ctx, cx: number, cy: number, h: number): void => {
  const b = h * 0.42;
  ctx.beginPath();
  ctx.moveTo(cx - b, cy + h / 2);
  ctx.lineTo(cx - b, cy - h / 2);
  ctx.lineTo(cx, cy + h * 0.12);
  ctx.lineTo(cx + b, cy - h / 2);
  ctx.lineTo(cx + b, cy + h / 2);
  ctx.stroke();
};

/**
 * Kapselform für das Membran-Ausdehnungsgefäß — stehendes Gefäß mit
 * gewölbten Böden, also ein Rechteck mit halbrunden Enden.
 */
const capsule = (ctx: Ctx, cx: number, cy: number, halfW: number, halfH: number): void => {
  const r = Math.min(halfW, halfH * 0.6);
  ctx.moveTo(cx - halfW, cy - halfH + r);
  ctx.quadraticCurveTo(cx - halfW, cy - halfH, cx - halfW + r, cy - halfH);
  ctx.lineTo(cx + halfW - r, cy - halfH);
  ctx.quadraticCurveTo(cx + halfW, cy - halfH, cx + halfW, cy - halfH + r);
  ctx.lineTo(cx + halfW, cy + halfH - r);
  ctx.quadraticCurveTo(cx + halfW, cy + halfH, cx + halfW - r, cy + halfH);
  ctx.lineTo(cx - halfW + r, cy + halfH);
  ctx.quadraticCurveTo(cx - halfW, cy + halfH, cx - halfW, cy + halfH - r);
  ctx.closePath();
};

// ---------------------------------------------------------------------------
// Legende
// ---------------------------------------------------------------------------

/**
 * Was jedes Bauteil in der Anlage tut — geschrieben für den, der es einbaut.
 *
 * Bewusst keine Definitionen aus dem Lehrbuch: jeder Satz beantwortet die
 * Frage „warum sitzt das Teil an dieser Stelle und was passiert, wenn es
 * fehlt oder falsch eingebaut ist".
 */
export const SCHEMATIC_LEGEND: Record<SchematicKind, SymbolLegendEntry> = {
  'heatpump-outdoor': {
    kind: 'heatpump-outdoor',
    name: 'Wärmepumpe, Außeneinheit',
    description:
      'Holt die Wärme aus der Außenluft und schiebt sie auf ein höheres Temperaturniveau; im Monoblock geht Heizungswasser ins Haus, im Splitgerät Kältemittel.',
  },
  'heatpump-indoor': {
    kind: 'heatpump-indoor',
    name: 'Wärmepumpe, Innengerät',
    description:
      'Der Teil der Wärmepumpe im Technikraum — er übergibt die Wärme an das Heizungswasser und trägt meist Umwälzpumpe, Heizstab und Regelung.',
  },
  'hydraulic-station': {
    kind: 'hydraulic-station',
    name: 'Hydraulikstation',
    description:
      'Die Inneneinheit ohne Verdichter — sie erzeugt keine Wärme, sondern nimmt sie über die Quellenleitung von der Außeneinheit entgegen und verteilt sie; nötig überall dort, wo die Wärme im Haus nur noch umgeschaltet und gefördert wird. Umwälzpumpe, Umschaltventil, Sicherheitsgruppe und meist ein Heizstab stecken bereits in ihr und gehören nicht ein zweites Mal als Einzelsymbol ins Schema.',
  },
  cylinder: {
    kind: 'cylinder',
    name: 'Trinkwasserspeicher',
    description:
      'Bevorratet das Warmwasser für Dusche und Küche; die eingebaute Heizschlange überträgt die Wärme vom Heizungswasser auf das Trinkwasser.',
  },
  buffer: {
    kind: 'buffer',
    name: 'Pufferspeicher',
    description:
      'Vergrößert den Wasserinhalt der Anlage, damit die Wärmepumpe längere Laufzeiten hat und beim Abtauen Wärme zur Verfügung steht.',
  },
  'buffer-series': {
    kind: 'buffer-series',
    name: 'Reihenpuffer',
    description:
      'Liegt im Rücklauf und liefert nur Wasserinhalt — er trennt nicht. Deshalb hat er im Bild zwei Anschlüsse und nicht vier: Rücklauf der Anlage hinein, Rücklauf zum Erzeuger heraus.',
  },
  separator: {
    kind: 'separator',
    name: 'Hydraulische Weiche',
    description:
      'Trennt den Volumenstrom der Wärmepumpe vom Volumenstrom der Heizkreise, damit sich die beiden Pumpen nicht gegenseitig behindern.',
  },
  freshwater: {
    kind: 'freshwater',
    name: 'Frischwasserstation',
    description:
      'Erwärmt das Trinkwasser erst beim Zapfen im Plattenwärmeübertrager — es steht kein warmes Trinkwasser bevorratet, deshalb ist Legionellenbildung kaum ein Thema.',
  },
  pump: {
    kind: 'pump',
    name: 'Umwälzpumpe',
    description:
      'Treibt das Heizungswasser im Kreis; die Dreieckspitze im Kreis zeigt die Förderrichtung — verkehrt herum eingebaut fördert sie nicht.',
  },
  'valve-2way': {
    kind: 'valve-2way',
    name: 'Regelventil, 2-Wege',
    description:
      'Drosselt den Durchfluss in einer Leitung nach Vorgabe der Regelung, zum Beispiel um einen Heizkreis oder eine Speicherladung zu begrenzen.',
  },
  'valve-3way': {
    kind: 'valve-3way',
    name: 'Mischer, 3-Wege',
    description:
      'Mischt heißes Vorlaufwasser mit kaltem Rücklaufwasser auf die Vorlauftemperatur, die der Kreis braucht — die Fußbodenheizung bekommt ihre niedrige Auslegungstemperatur, während der Erzeuger wärmer fahren darf.',
  },
  'valve-diverter': {
    kind: 'valve-diverter',
    name: 'Umschaltventil',
    description:
      'Schaltet den ganzen Volumenstrom entweder auf Heizung oder auf Warmwasser; es kennt nur zwei Stellungen, keine Zwischenstellung.',
  },
  'check-valve': {
    kind: 'check-valve',
    name: 'Rückschlagklappe',
    description:
      'Lässt Wasser nur in eine Richtung durch und verhindert, dass ein stillstehender Kreis von einem anderen rückwärts durchströmt wird.',
  },
  shutoff: {
    kind: 'shutoff',
    name: 'Absperrung',
    description:
      'Kugelhahn oder Absperrschieber zum vollständigen Schließen — er ist zum Sperren da, nicht zum Einregulieren.',
  },
  'balancing-valve': {
    kind: 'balancing-valve',
    name: 'Strangregulierventil',
    description:
      'Stellt den Volumenstrom eines Strangs fest ein, damit nicht der kurze Kreis alles Wasser nimmt und der lange kalt bleibt.',
  },
  'overflow-valve': {
    kind: 'overflow-valve',
    name: 'Überströmventil',
    description:
      'Öffnet einen Kurzschluss zwischen Vor- und Rücklauf, wenn zu viele Heizkreise geschlossen sind, und sichert so den Mindestvolumenstrom der Wärmepumpe.',
  },
  'safety-valve': {
    kind: 'safety-valve',
    name: 'Sicherheitsventil',
    description:
      'Bläst ab, sobald der Anlagendruck den Ansprechdruck erreicht; zwischen Wärmeerzeuger und Sicherheitsventil darf keine Absperrung sitzen.',
  },
  'expansion-vessel': {
    kind: 'expansion-vessel',
    name: 'Membranausdehnungsgefäß',
    description:
      'Nimmt die Volumenzunahme des erwärmten Wassers auf; ist es zu klein oder falsch vorgespannt, bläst das Sicherheitsventil bei jedem Aufheizen ab.',
  },
  'pressure-gauge': {
    kind: 'pressure-gauge',
    name: 'Manometer',
    description:
      'Zeigt den Anlagendruck an — die einzige Anzeige, an der man einen schleichenden Wasserverlust erkennt.',
  },
  thermometer: {
    kind: 'thermometer',
    name: 'Thermometer',
    description:
      'Zeigt die Wassertemperatur an der Einbaustelle; Vorlauf und Rücklauf nebeneinander gemessen zeigen sofort, ob die Spreizung stimmt.',
  },
  sensor: {
    kind: 'sensor',
    name: 'Fühler',
    description:
      'Meldet Temperatur oder Druck an die Regelung; er gehört in eine Tauchhülse oder fest ans Rohr unter die Dämmung, nicht lose danebengelegt.',
  },
  'flow-switch': {
    kind: 'flow-switch',
    name: 'Volumenstromwächter',
    description:
      'Überwacht, ob überhaupt Wasser fließt, und schaltet den Erzeuger ab, bevor er ohne Durchfluss läuft; er sitzt unmittelbar vor dem Wärmeerzeuger und ist bei Glykolbetrieb und bei Anlagen mit abschaltbaren Kreisen ausdrücklich gefordert.',
  },
  'temperature-limiter': {
    kind: 'temperature-limiter',
    name: 'Temperaturwächter',
    description:
      'Schaltet bei Übertemperatur die Kreispumpe ab oder schließt den Stellantrieb und schützt so den Estrich vor zu heißem Vorlauf; an jedem ungemischten Flächenheizkreis zwingend, weil dort ohne ihn die volle Vorlauftemperatur des Erzeugers im Fußboden ankommt.',
  },
  strainer: {
    kind: 'strainer',
    name: 'Schmutzfänger',
    description:
      'Siebt Späne und Rost aus dem Wasser, bevor sie in Pumpe, Wärmeübertrager oder Ventilsitz gelangen; das Sieb muss zum Reinigen erreichbar bleiben.',
  },
  'air-separator': {
    kind: 'air-separator',
    name: 'Luftabscheider',
    description:
      'Sammelt gelöste Luft an der heißesten Stelle der Anlage und bläst sie über den Schnellentlüfter ab — Luft im Kreis heißt Geräusche und kalte Heizflächen.',
  },
  'dirt-separator': {
    kind: 'dirt-separator',
    name: 'Schlammabscheider',
    description:
      'Setzt Magnetit und feinen Schlamm im Rücklauf ab; das Abschlämmventil unten wird zur Wartung geöffnet.',
  },
  'filling-valve': {
    kind: 'filling-valve',
    name: 'Füll- und Entleerhahn',
    description:
      'Anschluss zum Befüllen und Entleeren der Anlage; er liegt am tiefsten Punkt und wird nach dem Füllen wieder abgesperrt und verschlossen.',
  },
  'backflow-preventer': {
    kind: 'backflow-preventer',
    name: 'Systemtrenner',
    description:
      'Trennt die Heizungsanlage vom Trinkwassernetz, damit kein Heizungswasser zurückdrücken kann; der Ablauftrichter darunter muss frei in die Entwässerung münden.',
  },
  'water-meter': {
    kind: 'water-meter',
    name: 'Wasserzähler',
    description:
      'Zählt die eingespeiste Wassermenge — an der Nachspeisung ist er das Frühwarnzeichen für eine Undichtigkeit.',
  },
  'heat-meter': {
    kind: 'heat-meter',
    name: 'Wärmemengenzähler',
    description:
      'Misst Volumenstrom und Temperaturdifferenz und rechnet daraus die gelieferte Wärme; Grundlage für Abrechnung und für den Nachweis der Jahresarbeitszahl.',
  },
  manifold: {
    kind: 'manifold',
    name: 'Verteiler',
    description:
      'Teilt Vorlauf und Rücklauf auf die einzelnen Heizkreise auf und trägt deren Absperrungen, Durchflussanzeiger und Stellantriebe.',
  },
  radiator: {
    kind: 'radiator',
    name: 'Heizkörper',
    description:
      'Gibt die Wärme an den Raum ab; er begrenzt mit seiner Größe die niedrigste Vorlauftemperatur, die die Wärmepumpe fahren darf.',
  },
  'floor-loop': {
    kind: 'floor-loop',
    name: 'Fußbodenheizkreis',
    description:
      'Die im Estrich verlegte Rohrschleife eines Raums — große Fläche, niedrige Temperatur, ideal für die Wärmepumpe.',
  },
  boiler: {
    kind: 'boiler',
    name: 'Kessel',
    description:
      'Zweiter Wärmeerzeuger im bivalenten Betrieb; er springt ein, wenn die Wärmepumpe die Last oder die Temperatur allein nicht schafft.',
  },
  'electric-heater': {
    kind: 'electric-heater',
    name: 'Elektro-Heizstab',
    description:
      'Elektrische Nachheizung für Spitzenlast, Abtauung und die Legionellenschaltung; jede Betriebsstunde geht direkt in die Stromrechnung.',
  },
  solar: {
    kind: 'solar',
    name: 'Solarkollektor',
    description:
      'Erzeugt kostenlose Wärme aus Sonneneinstrahlung und speist sie in den Speicher; der Kreis braucht eigenen Frostschutz und eigene Sicherheitsausrüstung.',
  },
  'mixing-valve-dhw': {
    kind: 'mixing-valve-dhw',
    name: 'Trinkwassermischer',
    description:
      'Mischt dem heißen Speicherwasser Kaltwasser bei, damit an der Zapfstelle keine Verbrühungstemperatur ankommt, obwohl der Speicher zur Legionellenvorsorge auf hoher Temperatur gehalten wird (üblich 60 °C, siehe DVGW W 551).',
  },
  'circulation-pump': {
    kind: 'circulation-pump',
    name: 'Zirkulationspumpe',
    description:
      'Hält das Warmwasser in der Leitung in Bewegung, damit es an der Zapfstelle sofort warm ist; sie läuft nach Zeit- oder Temperaturprogramm, nicht durchgehend.',
  },
  node: {
    kind: 'node',
    name: 'Knoten',
    description:
      'Abzweig oder Verbindungspunkt zweier Leitungen — kein Bauteil, sondern die Stelle, an der sich das Wasser teilt oder wieder zusammenkommt.',
  },
};

// ---------------------------------------------------------------------------
// Symboltabelle: Belegungsfläche, Anschlüsse, Zeichnung
// ---------------------------------------------------------------------------

/**
 * Freistellung unter dem Symbol.
 *  • `none` — nichts freistellen (Armaturen sitzen bewusst auf der Leitung)
 *  • `circle` — Kreisfläche in Hintergrundfarbe (Pumpen, Anzeigegeräte)
 *  • `box` — Rechteckfläche in Hintergrundfarbe (Geräte, Speicher)
 */
type Knockout = 'none' | 'circle' | 'box';

interface SymbolDefinition {
  /** Belegungsbreite in Vielfachen von `size`. */
  width: number;
  /** Belegungshöhe in Vielfachen von `size`. */
  height: number;
  knockout: Knockout;
  ports: SymbolPorts;
  /** Zeichnung in Einheitskoordinaten; Strich- und Füllfarbe sind gesetzt. */
  draw: (ctx: Ctx) => void;
}

// `SYMBOL_PORTS` und `symbolPortPoints` geben diese Objekte nach außen. Ein
// eingefrorenes Objekt verhindert, dass ein Aufrufer versehentlich die
// Symboltabelle selbst verstellt und danach alle Anschlüsse falsch sitzen.
const port = (id: string, label: string, side: PortSide, x: number, y: number): SymbolPort =>
  Object.freeze({ id, label, side, x, y });

const SYMBOLS: Record<SchematicKind, SymbolDefinition> = {
  // -- Erzeuger ------------------------------------------------------------
  'heatpump-outdoor': {
    width: 1.5,
    height: 1.1,
    knockout: 'box',
    ports: [
      port('flow', 'Heizung Vorlauf', 'right', 0.75, -0.2),
      port('return', 'Heizung Rücklauf', 'right', 0.75, 0.2),
    ],
    draw: (ctx) => {
      ctx.beginPath();
      box(ctx, 0, 0, 1.3, 0.9);
      line(ctx, 0.65, -0.2, 0.75, -0.2);
      line(ctx, 0.65, 0.2, 0.75, 0.2);
      ctx.stroke();
      // Links der Ventilator (Luft als Quelle), rechts der Verdichter.
      ctx.beginPath();
      fan(ctx, -0.36, 0, 0.24);
      circle(ctx, 0.34, 0, 0.17);
      ctx.stroke();
      // Der Verdichter trägt den gefüllten Keil — er hebt das Niveau an.
      ctx.beginPath();
      poly(ctx, [
        [0.26, -0.11],
        [0.26, 0.11],
        [0.46, 0],
      ]);
      ctx.fill();
      // Verdampfer zwischen Ventilator und Verdichter: hier nimmt das
      // Kältemittel die Wärme aus der Außenluft auf.
      ctx.beginPath();
      serpentine(ctx, -0.06, 0.14, 0.3, 0.16, 2);
      ctx.stroke();
    },
  },
  'heatpump-indoor': {
    width: 1.5,
    height: 1.1,
    knockout: 'box',
    ports: [
      port('source-in', 'Quelle Eintritt', 'left', -0.75, -0.2),
      port('source-out', 'Quelle Austritt', 'left', -0.75, 0.2),
      port('flow', 'Heizung Vorlauf', 'right', 0.75, -0.2),
      port('return', 'Heizung Rücklauf', 'right', 0.75, 0.2),
    ],
    draw: (ctx) => {
      ctx.beginPath();
      box(ctx, 0, 0, 1.3, 0.9);
      line(ctx, -0.75, -0.2, -0.65, -0.2);
      line(ctx, -0.75, 0.2, -0.65, 0.2);
      line(ctx, 0.65, -0.2, 0.75, -0.2);
      line(ctx, 0.65, 0.2, 0.75, 0.2);
      ctx.stroke();
      ctx.beginPath();
      circle(ctx, -0.3, 0, 0.19);
      ctx.stroke();
      ctx.beginPath();
      poly(ctx, [
        [-0.39, -0.12],
        [-0.39, 0.12],
        [-0.17, 0],
      ]);
      ctx.fill();
      // Verflüssiger: die Schlange gibt an das Heizungswasser ab.
      ctx.beginPath();
      serpentine(ctx, 0.06, 0.56, 0, 0.34, 3);
      ctx.stroke();
    },
  },
  'hydraulic-station': {
    // Gleiche Belegungsfläche wie das Innengerät: beide stehen an derselben
    // Stelle im Schema, und wer sie nebeneinander sieht, soll den
    // Unterschied an der Zeichnung erkennen und nicht an der Größe.
    width: 1.5,
    height: 1.1,
    knockout: 'box',
    ports: [
      port('source-in', 'Quelle Eintritt', 'left', -0.75, -0.2),
      port('source-out', 'Quelle Austritt', 'left', -0.75, 0.2),
      port('flow', 'Heizung Vorlauf', 'right', 0.75, -0.2),
      port('return', 'Heizung Rücklauf', 'right', 0.75, 0.2),
    ],
    draw: (ctx) => {
      ctx.beginPath();
      box(ctx, 0, 0, 1.3, 0.9);
      line(ctx, -0.75, -0.2, -0.65, -0.2);
      line(ctx, -0.75, 0.2, -0.65, 0.2);
      line(ctx, 0.65, -0.2, 0.75, -0.2);
      line(ctx, 0.65, 0.2, 0.75, 0.2);
      ctx.stroke();
      // Kein Verdichterkreis — das ist der ganze Unterschied zum Innengerät.
      // Die Wärme kommt fertig über die Quellenleitung an; im Gehäuse wird
      // sie nur noch umgeschaltet und gefördert. Deshalb stehen hier die
      // beiden Baugruppen, die das tun, und die Leitungen laufen von links
      // nach rechts durch.
      //
      // Umschaltventil im Vorlauf: Dreieckpaar mit gefülltem drittem Zweig
      // (der angesteuerte Weg, siehe Kopf der Datei) und Stellmotor mit
      // Diagonale — zwei Endlagen, Heizung oder Warmwasser.
      ctx.beginPath();
      bowTie(ctx, 0.28, -0.2, 0.16, 0.1);
      line(ctx, -0.65, -0.2, 0.12, -0.2);
      line(ctx, 0.44, -0.2, 0.65, -0.2);
      line(ctx, 0.28, -0.2, 0.28, -0.31);
      ctx.stroke();
      ctx.beginPath();
      poly(ctx, [
        [0.16, 0.02],
        [0.4, 0.02],
        [0.28, -0.2],
      ]);
      ctx.fill();
      // Der Stellmotor bleibt mit Abstand unter der Gehäusekante: berührt
      // er sie, liest sich der Kasten als Teil des Gehäuses und nicht als
      // Antrieb des Ventils.
      ctx.beginPath();
      box(ctx, 0.28, -0.37, 0.22, 0.11);
      line(ctx, 0.17, -0.315, 0.39, -0.425);
      ctx.stroke();
      // Umwälzpumpe im Rücklauf: Kreis mit Dreieck, wie das Einzelsymbol.
      // Die Spitze zeigt nach links, denn der Rücklauf läuft von der
      // Heizung zurück zur Quelle — herum gedreht stünde die Pumpe gegen
      // die eigene Anlage.
      ctx.beginPath();
      circle(ctx, -0.28, 0.2, 0.17);
      line(ctx, -0.65, 0.2, -0.45, 0.2);
      line(ctx, -0.11, 0.2, 0.65, 0.2);
      ctx.stroke();
      ctx.beginPath();
      poly(ctx, [
        [-0.2, 0.1],
        [-0.2, 0.3],
        [-0.4, 0.2],
      ]);
      ctx.stroke();
    },
  },
  boiler: {
    width: 1.0,
    height: 1.3,
    knockout: 'box',
    ports: [
      port('flow', 'Vorlauf', 'top', 0, -0.65),
      port('return', 'Rücklauf', 'bottom', 0, 0.65),
    ],
    draw: (ctx) => {
      ctx.beginPath();
      box(ctx, 0, -0.02, 0.8, 0.96);
      line(ctx, 0, -0.5, 0, -0.65);
      line(ctx, 0, 0.46, 0, 0.65);
      ctx.stroke();
      // Flamme: drei Zungen im unteren Drittel — der Brenner.
      ctx.beginPath();
      for (let i = -1; i <= 1; i++) {
        const x = i * 0.2;
        ctx.moveTo(x, 0.3);
        ctx.quadraticCurveTo(x + 0.1, 0.12, x, -0.04);
        ctx.quadraticCurveTo(x - 0.1, 0.12, x, 0.3);
      }
      ctx.stroke();
    },
  },
  'electric-heater': {
    width: 1.0,
    height: 0.7,
    knockout: 'box',
    ports: [
      port('in', 'Eintritt', 'left', -0.5, 0),
      port('out', 'Austritt', 'right', 0.5, 0),
    ],
    draw: (ctx) => {
      ctx.beginPath();
      box(ctx, 0, 0, 0.7, 0.42);
      line(ctx, -0.5, 0, -0.35, 0);
      line(ctx, 0.35, 0, 0.5, 0);
      ctx.stroke();
      // Zickzack = elektrischer Widerstand.
      ctx.beginPath();
      const n = 6;
      ctx.moveTo(-0.28, 0);
      for (let i = 0; i < n; i++) {
        const x = -0.28 + (0.56 * (i + 0.5)) / n;
        ctx.lineTo(x, i % 2 === 0 ? -0.13 : 0.13);
      }
      ctx.lineTo(0.28, 0);
      ctx.stroke();
    },
  },
  solar: {
    width: 1.3,
    height: 1.0,
    knockout: 'box',
    ports: [
      port('return', 'Solar Rücklauf', 'bottom', -0.3, 0.5),
      port('flow', 'Solar Vorlauf', 'bottom', 0.3, 0.5),
    ],
    draw: (ctx) => {
      // Der Kollektor sitzt in der unteren Hälfte der Belegungsfläche, damit
      // darüber Platz für die Strahlen bleibt: alles, was gezeichnet wird,
      // muss innerhalb von `width` × `height` liegen, sonst schneidet die
      // Freistellfläche ab und die Beschriftung schiebt sich ins Symbol.
      ctx.beginPath();
      box(ctx, 0, 0.14, 1.1, 0.5);
      line(ctx, -0.3, 0.39, -0.3, 0.5);
      line(ctx, 0.3, 0.39, 0.3, 0.5);
      ctx.stroke();
      // Absorberfläche als Schraffur. Startabstand und Teilung sind so
      // gewählt, dass auch die letzte Schräge innerhalb der Kollektorkante
      // (x = ±0.55) endet.
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        const x = -0.5 + i * 0.21;
        line(ctx, x, 0.39, x + 0.16, -0.11);
      }
      ctx.stroke();
      // Zwei einfallende Strahlen — sonst ist es nur ein Kasten.
      ctx.beginPath();
      for (let i = 0; i < 2; i++) {
        const x = -0.25 + i * 0.3;
        line(ctx, x - 0.14, -0.5, x, -0.19);
        arrowHead(ctx, x, -0.19, Math.atan2(0.31, 0.14), 0.12);
      }
      ctx.stroke();
    },
  },

  // -- Speicher ------------------------------------------------------------
  cylinder: {
    width: 0.9,
    height: 1.7,
    knockout: 'box',
    ports: [
      port('dhw', 'Warmwasser', 'top', 0, -0.85),
      port('cold', 'Kaltwasser', 'bottom', 0, 0.85),
      port('flow', 'Heizung Vorlauf', 'left', -0.45, -0.25),
      port('return', 'Heizung Rücklauf', 'left', -0.45, 0.35),
    ],
    draw: (ctx) => {
      // Stehendes Gefäß mit gewölbten Böden.
      ctx.beginPath();
      ctx.moveTo(-0.3, -0.5);
      ctx.quadraticCurveTo(0, -0.72, 0.3, -0.5);
      ctx.lineTo(0.3, 0.5);
      ctx.quadraticCurveTo(0, 0.72, -0.3, 0.5);
      ctx.closePath();
      line(ctx, 0, -0.66, 0, -0.85);
      line(ctx, 0, 0.66, 0, 0.85);
      line(ctx, -0.45, -0.25, -0.3, -0.25);
      line(ctx, -0.45, 0.35, -0.3, 0.35);
      ctx.stroke();
      // Wendel: der Glattrohr-Wärmeübertrager. Er reicht von der
      // Speichermitte bis unter den Kaltwassereintritt (y = -0.25 bis 0.35),
      // damit er das nachströmende kalte Wasser zuerst erreicht.
      ctx.beginPath();
      coil(ctx, 0, -0.25, 0.35, 0.28, 4);
      ctx.stroke();
    },
  },
  buffer: {
    width: 0.9,
    height: 1.4,
    knockout: 'box',
    ports: [
      port('gen-flow', 'Erzeuger Vorlauf', 'left', -0.45, -0.32),
      port('gen-return', 'Erzeuger Rücklauf', 'left', -0.45, 0.32),
      port('sys-flow', 'Verteilung Vorlauf', 'right', 0.45, -0.32),
      port('sys-return', 'Verteilung Rücklauf', 'right', 0.45, 0.32),
    ],
    draw: (ctx) => {
      ctx.beginPath();
      ctx.moveTo(-0.3, -0.48);
      ctx.quadraticCurveTo(0, -0.68, 0.3, -0.48);
      ctx.lineTo(0.3, 0.48);
      ctx.quadraticCurveTo(0, 0.68, -0.3, 0.48);
      ctx.closePath();
      line(ctx, -0.45, -0.32, -0.3, -0.32);
      line(ctx, -0.45, 0.32, -0.3, 0.32);
      line(ctx, 0.3, -0.32, 0.45, -0.32);
      line(ctx, 0.3, 0.32, 0.45, 0.32);
      ctx.stroke();
      // Waagerechte Striche = Temperaturschichtung, das Wesen des Puffers.
      ctx.save();
      ctx.setLineDash([0.06, 0.05]);
      ctx.beginPath();
      for (let i = -1; i <= 1; i++) line(ctx, -0.22, i * 0.2, 0.22, i * 0.2);
      ctx.stroke();
      ctx.restore();
    },
  },
  'buffer-series': {
    width: 0.9,
    height: 1.4,
    knockout: 'box',
    /*
     * **Zwei Anschlüsse, beide im Rücklauf.**
     *
     * Bis 1.54.0 trug der Reihenpuffer das Zeichen des Parallelpuffers — vier
     * Stutzen, von denen die Auslegung zwei anschloss. Die beiden anderen
     * standen als Leitungsstummel im Bild und endeten im Nichts. Das ist in
     * einem Fließbild keine Unschönheit, sondern eine falsche Aussage: Ein
     * gezeichneter Stutzen behauptet einen Anschluss.
     *
     * **Warum nicht drei.** Die BWP-Musterschemata zeichnen den Reihenpuffer
     * mit drei Anschlüssen. Was der dritte verbindet, ließ sich aus den
     * vorliegenden Unterlagen nicht eindeutig feststellen, und ein Stutzen,
     * dessen Gegenstelle unbekannt ist, wäre wieder ein Rohr ins Nirgendwo.
     * Hier stehen deshalb die zwei, die die Auslegung wirklich anschließt.
     * Der dritte kommt dazu, sobald belegt ist, woran er hängt.
     */
    ports: [
      port('sys-return', 'Rücklauf der Anlage', 'right', 0.45, -0.32),
      port('gen-return', 'Rücklauf zum Erzeuger', 'left', -0.45, 0.32),
    ],
    draw: (ctx) => {
      ctx.beginPath();
      ctx.moveTo(-0.3, -0.48);
      ctx.quadraticCurveTo(0, -0.68, 0.3, -0.48);
      ctx.lineTo(0.3, 0.48);
      ctx.quadraticCurveTo(0, 0.68, -0.3, 0.48);
      ctx.closePath();
      line(ctx, 0.3, -0.32, 0.45, -0.32);
      line(ctx, -0.45, 0.32, -0.3, 0.32);
      ctx.stroke();
      // Waagerechte Striche = Temperaturschichtung, wie beim Parallelpuffer.
      ctx.save();
      ctx.setLineDash([0.06, 0.05]);
      ctx.beginPath();
      for (let i = -1; i <= 1; i++) line(ctx, -0.22, i * 0.2, 0.22, i * 0.2);
      ctx.stroke();
      ctx.restore();
      /*
       * Der schräge Strich von Stutzen zu Stutzen sagt, was den Reihenpuffer
       * ausmacht: Es geht **hindurch**. Beim Parallelpuffer steht an dieser
       * Stelle nichts, weil dort zwei getrennte Kreise anliegen.
       */
      ctx.save();
      ctx.setLineDash([0.05, 0.05]);
      ctx.beginPath();
      line(ctx, 0.24, -0.32, -0.24, 0.32);
      ctx.stroke();
      ctx.restore();
    },
  },
  separator: {
    width: 0.8,
    height: 1.4,
    knockout: 'box',
    ports: [
      port('gen-flow', 'Erzeuger Vorlauf', 'left', -0.4, -0.3),
      port('gen-return', 'Erzeuger Rücklauf', 'left', -0.4, 0.3),
      port('sys-flow', 'Verteilung Vorlauf', 'right', 0.4, -0.3),
      port('sys-return', 'Verteilung Rücklauf', 'right', 0.4, 0.3),
    ],
    draw: (ctx) => {
      ctx.beginPath();
      box(ctx, 0, 0, 0.42, 1.0);
      line(ctx, -0.4, -0.3, -0.21, -0.3);
      line(ctx, -0.4, 0.3, -0.21, 0.3);
      line(ctx, 0.21, -0.3, 0.4, -0.3);
      line(ctx, 0.21, 0.3, 0.4, 0.3);
      ctx.stroke();
      // Der senkrechte Strich zeigt: hier wird nicht gespeichert, hier wird
      // nur der Volumenstrom entkoppelt.
      ctx.save();
      ctx.setLineDash([0.07, 0.06]);
      ctx.beginPath();
      line(ctx, 0, -0.42, 0, 0.42);
      ctx.stroke();
      ctx.restore();
    },
  },
  freshwater: {
    width: 1.2,
    height: 1.1,
    knockout: 'box',
    ports: [
      port('prim-flow', 'Speicher Vorlauf', 'left', -0.6, -0.28),
      port('prim-return', 'Speicher Rücklauf', 'left', -0.6, 0.28),
      port('dhw', 'Warmwasser', 'right', 0.6, -0.28),
      port('cold', 'Kaltwasser', 'right', 0.6, 0.28),
    ],
    draw: (ctx) => {
      // Rechteck mit Schlange: der Plattenwärmeübertrager.
      ctx.beginPath();
      box(ctx, 0, -0.1, 0.8, 0.62);
      line(ctx, -0.6, -0.28, -0.4, -0.28);
      line(ctx, 0.4, -0.28, 0.6, -0.28);
      line(ctx, 0.4, 0.28, 0.6, 0.28);
      line(ctx, 0.4, 0.28, 0.4, -0.1);
      ctx.stroke();
      ctx.beginPath();
      serpentine(ctx, -0.32, 0.32, -0.1, 0.3, 3);
      ctx.stroke();
      // Primärpumpe im Rücklauf — ohne sie steht die Station.
      ctx.beginPath();
      circle(ctx, -0.24, 0.28, 0.15);
      line(ctx, -0.6, 0.28, -0.39, 0.28);
      line(ctx, -0.09, 0.28, 0.0, 0.28);
      line(ctx, 0.0, 0.28, 0.0, 0.21);
      ctx.stroke();
      ctx.beginPath();
      poly(ctx, [
        [-0.31, 0.19],
        [-0.31, 0.37],
        [-0.14, 0.28],
      ]);
      ctx.stroke();
    },
  },

  // -- Pumpen --------------------------------------------------------------
  pump: {
    width: 1.0,
    height: 0.8,
    knockout: 'circle',
    ports: [
      port('in', 'Saugseite', 'left', -0.5, 0),
      port('out', 'Druckseite', 'right', 0.5, 0),
    ],
    draw: (ctx) => {
      ctx.beginPath();
      circle(ctx, 0, 0, 0.32);
      line(ctx, -0.5, 0, -0.32, 0);
      line(ctx, 0.32, 0, 0.5, 0);
      ctx.stroke();
      /*
       * **Das Dreieck ist ausgefüllt und zeigt in Förderrichtung.**
       *
       * Bis 1.54.0 stand es hier als Umriss. Gemeldet aus der Benutzung —
       * „eine Pumpe hat ein Dreieck drin" —, und das ist keine Geschmacks-
       * frage: Der Umriss ist in derselben Formensprache das Zeichen für ein
       * *Rückschlagorgan* (Kegel gegen den Sitz, siehe `check-valve`). Zwei
       * Bauteile mit derselben Innenform sind in einem Fließbild ein Fehler,
       * auch wenn der Kreis drumherum sie unterscheidet.
       */
      ctx.beginPath();
      poly(ctx, [
        [-0.15, -0.19],
        [-0.15, 0.19],
        [0.23, 0],
      ]);
      ctx.fill();
    },
  },
  'circulation-pump': {
    width: 1.0,
    height: 1.0,
    knockout: 'circle',
    ports: [
      port('in', 'Zirkulation Rücklauf', 'left', -0.5, 0.1),
      port('out', 'Zirkulation Vorlauf', 'right', 0.5, 0.1),
    ],
    draw: (ctx) => {
      ctx.beginPath();
      circle(ctx, 0, 0.1, 0.3);
      line(ctx, -0.5, 0.1, -0.3, 0.1);
      line(ctx, 0.3, 0.1, 0.5, 0.1);
      ctx.stroke();
      ctx.beginPath();
      poly(ctx, [
        [-0.14, -0.07],
        [-0.14, 0.27],
        [0.21, 0.1],
      ]);
      ctx.fill();
      // Der Kreisbogen darüber: das Wasser läuft im Ring, es wird nicht
      // gefördert, sondern in Bewegung gehalten.
      ctx.beginPath();
      ctx.arc(0, 0.1, 0.44, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
      ctx.beginPath();
      arrowHead(ctx, 0.17, -0.29, 1.0, 0.11);
      ctx.stroke();
    },
  },

  // -- Armaturen -----------------------------------------------------------
  'valve-2way': {
    width: 1.0,
    height: 1.0,
    knockout: 'none',
    ports: [
      port('in', 'Eintritt', 'left', -0.5, 0.08),
      port('out', 'Austritt', 'right', 0.5, 0.08),
    ],
    draw: (ctx) => {
      ctx.beginPath();
      bowTie(ctx, 0, 0.08, 0.3, 0.24);
      line(ctx, -0.5, 0.08, -0.3, 0.08);
      line(ctx, 0.3, 0.08, 0.5, 0.08);
      line(ctx, 0, 0.08, 0, -0.24);
      ctx.stroke();
      // Rechteck auf dem Schaft = Stellantrieb, also fremdbetätigt.
      ctx.beginPath();
      box(ctx, 0, -0.34, 0.32, 0.2);
      ctx.stroke();
    },
  },
  'valve-3way': {
    width: 1.0,
    height: 1.1,
    knockout: 'none',
    ports: [
      port('hot', 'Vorlauf heiß', 'left', -0.5, 0),
      port('mixed', 'Mischwasser', 'right', 0.5, 0),
      port('cold', 'Beimischung Rücklauf', 'bottom', 0, 0.55),
    ],
    draw: (ctx) => {
      /*
       * **Drei Dreiecke, Spitzen im Mittelpunkt — und alle drei hell.**
       *
       * Der Mischer regelt stufenlos; es gibt bei ihm keinen gesperrten Weg,
       * den man schwärzen könnte. Genau daran unterscheidet er sich im Bild
       * vom Umschaltventil daneben, und die Legende der Wolf-Hydraulikschemen
       * führt beide als **zwei getrennte Einträge**: „Dreiwegemischer mit
       * elektrischem Antrieb" und „3-Wegeumschaltventil".
       *
       * Bis 1.54.0 war der dritte Weg hier gefüllt — mit der Begründung, das
       * sei der geregelte Zweig. Das war eine eigene Lesart gegen den
       * Fachgebrauch: Die geschwärzte Fläche heißt **gesperrt**. Ein Bild,
       * das ein Zeichen umdeutet und die Umdeutung in die Legende schreibt,
       * verlangt vom Leser, die Legende zu lesen, bevor er das Bild versteht.
       */
      ctx.beginPath();
      bowTie(ctx, 0, 0, 0.28, 0.22);
      poly(ctx, [
        [-0.22, 0.28],
        [0.22, 0.28],
        [0, 0],
      ]);
      line(ctx, -0.5, 0, -0.28, 0);
      line(ctx, 0.28, 0, 0.5, 0);
      line(ctx, 0, 0.28, 0, 0.55);
      line(ctx, 0, 0, 0, -0.3);
      ctx.stroke();
      /*
       * Der Antrieb ist ein **Stellmotor**: Rechteck mit M. Bis 1.54.0 stand
       * hier ein kleiner Kreis, der in derselben Formensprache für einen
       * Fühler steht.
       */
      ctx.beginPath();
      box(ctx, 0, -0.42, 0.3, 0.22);
      ctx.stroke();
      letterM(ctx, 0, -0.42, 0.13);
    },
  },
  'valve-diverter': {
    width: 1.0,
    height: 1.1,
    knockout: 'none',
    ports: [
      port('in', 'Eintritt', 'left', -0.5, 0),
      port('heating', 'Abgang Heizung', 'right', 0.5, 0),
      port('dhw', 'Abgang Warmwasser', 'bottom', 0, 0.55),
    ],
    draw: (ctx) => {
      /*
       * **Drei Dreiecke — und der gesperrte Weg ist ausgefüllt.**
       *
       * Das Umschaltventil kennt nur zwei Stellungen. Gezeichnet ist die
       * Ruhestellung: Heizung offen (waagerecht), Warmwasser gesperrt (der
       * Abgang nach unten, geschwärzt). Daran ist der Betriebszustand
       * ablesbar — und daran unterscheidet sich dieses Zeichen vom Mischer,
       * bei dem kein Dreieck gefüllt ist.
       *
       * **Das ist seit 1.55.0 die umgekehrte Bedeutung.** Bis dahin hieß die
       * schwarze Fläche in diesem Programm „der angesteuerte Weg" — eine
       * eigene Lesart, die in der Legende stand und im Fachgebrauch das
       * Gegenteil bedeutet.
       */
      ctx.beginPath();
      bowTie(ctx, 0, 0, 0.28, 0.22);
      line(ctx, -0.5, 0, -0.28, 0);
      line(ctx, 0.28, 0, 0.5, 0);
      line(ctx, 0, 0.28, 0, 0.55);
      line(ctx, 0, 0, 0, -0.28);
      ctx.stroke();
      ctx.beginPath();
      poly(ctx, [
        [-0.22, 0.28],
        [0.22, 0.28],
        [0, 0],
      ]);
      ctx.fill();
      // Kasten mit Diagonale = Stellmotor mit zwei Endlagen. Der Unterschied
      // zum Mischer ist genau der: hier gibt es kein Dazwischen.
      ctx.beginPath();
      box(ctx, 0, -0.4, 0.34, 0.24);
      line(ctx, -0.17, -0.28, 0.17, -0.52);
      ctx.stroke();
    },
  },
  'check-valve': {
    width: 1.0,
    height: 0.8,
    knockout: 'none',
    ports: [
      port('in', 'Eintritt', 'left', -0.5, 0),
      port('out', 'Austritt', 'right', 0.5, 0),
    ],
    draw: (ctx) => {
      ctx.beginPath();
      line(ctx, -0.5, 0, 0.5, 0);
      ctx.stroke();
      // Kegel gegen den Sitz: durchströmbar nur in Pfeilrichtung.
      ctx.beginPath();
      poly(ctx, [
        [-0.22, -0.24],
        [-0.22, 0.24],
        [0.16, 0],
      ]);
      ctx.stroke();
      ctx.beginPath();
      line(ctx, 0.16, -0.26, 0.16, 0.26);
      ctx.stroke();
    },
  },
  shutoff: {
    width: 1.0,
    height: 0.9,
    knockout: 'none',
    ports: [
      port('in', 'Eintritt', 'left', -0.5, 0.1),
      port('out', 'Austritt', 'right', 0.5, 0.1),
    ],
    draw: (ctx) => {
      // Die liegende Acht ohne Antrieb, dafür mit Handrad: von Hand
      // betätigte Absperrung.
      ctx.beginPath();
      bowTie(ctx, 0, 0.1, 0.3, 0.24);
      line(ctx, -0.5, 0.1, -0.3, 0.1);
      line(ctx, 0.3, 0.1, 0.5, 0.1);
      handWheel(ctx, 0, 0.1, 0.34);
      ctx.stroke();
    },
  },
  'balancing-valve': {
    width: 1.0,
    height: 1.0,
    knockout: 'none',
    ports: [
      port('in', 'Eintritt', 'left', -0.5, 0.12),
      port('out', 'Austritt', 'right', 0.5, 0.12),
    ],
    draw: (ctx) => {
      ctx.beginPath();
      bowTie(ctx, 0, 0.12, 0.3, 0.23);
      line(ctx, -0.5, 0.12, -0.3, 0.12);
      line(ctx, 0.3, 0.12, 0.5, 0.12);
      handWheel(ctx, 0, 0.12, 0.32);
      ctx.stroke();
      // Schrägpfeil durch die Armatur = feste Voreinstellung.
      ctx.beginPath();
      line(ctx, -0.34, 0.42, 0.34, -0.1);
      arrowHead(ctx, 0.34, -0.1, Math.atan2(-0.52, 0.68), 0.12);
      ctx.stroke();
      // Zwei Messnippel — daran wird der Volumenstrom eingestellt.
      ctx.beginPath();
      line(ctx, -0.18, 0.3, -0.18, 0.44);
      line(ctx, 0.18, 0.3, 0.18, 0.44);
      ctx.stroke();
    },
  },
  'overflow-valve': {
    width: 1.0,
    height: 1.1,
    knockout: 'none',
    ports: [
      port('in', 'Vorlaufseite', 'left', -0.5, 0.18),
      port('out', 'Rücklaufseite', 'right', 0.5, 0.18),
    ],
    draw: (ctx) => {
      ctx.beginPath();
      bowTie(ctx, 0, 0.18, 0.28, 0.22);
      line(ctx, -0.5, 0.18, -0.28, 0.18);
      line(ctx, 0.28, 0.18, 0.5, 0.18);
      line(ctx, 0, 0.18, 0, -0.06);
      ctx.stroke();
      // Feder statt Antrieb: die Armatur öffnet aus sich heraus, sobald der
      // Differenzdruck den eingestellten Wert übersteigt.
      ctx.beginPath();
      spring(ctx, 0, -0.06, -0.4, 0.11, 4);
      line(ctx, -0.14, -0.44, 0.14, -0.44);
      ctx.stroke();
    },
  },
  'safety-valve': {
    width: 1.0,
    height: 1.2,
    knockout: 'none',
    ports: [
      port('in', 'Eintritt vom Erzeuger', 'bottom', 0, 0.6),
      port('blow', 'Abblaseleitung', 'right', 0.5, 0),
    ],
    draw: (ctx) => {
      // Eckform: Eintritt von unten, Abblasen zur Seite — so hängt das
      // Ventil an der Anlage und bläst frei in den Trichter.
      ctx.beginPath();
      poly(ctx, [
        [-0.2, 0.3],
        [0.2, 0.3],
        [0, 0],
      ]);
      poly(ctx, [
        [0.3, -0.2],
        [0.3, 0.2],
        [0, 0],
      ]);
      line(ctx, 0, 0.3, 0, 0.6);
      line(ctx, 0.3, 0, 0.5, 0);
      line(ctx, 0, 0, 0, -0.16);
      ctx.stroke();
      ctx.beginPath();
      spring(ctx, 0, -0.16, -0.46, 0.12, 4);
      line(ctx, -0.15, -0.5, 0.15, -0.5);
      ctx.stroke();
    },
  },
  'expansion-vessel': {
    width: 0.9,
    height: 1.2,
    knockout: 'circle',
    ports: [port('in', 'Ausdehnungsleitung', 'bottom', 0, 0.6)],
    draw: (ctx) => {
      /*
       * **Kapsel, nicht Kreis.** Ein Membran-Ausdehnungsgefäß ist ein
       * stehendes Gefäß mit gewölbten Böden; der Kreis ist in derselben
       * Formensprache für Messgeräte und Pumpen belegt. Bis 1.54.0 stand hier
       * ein Kreis, und auf einem Blatt mit Manometer und Thermometer daneben
       * war das Gefäß nur noch an der Membranlinie zu erkennen.
       */
      ctx.beginPath();
      capsule(ctx, 0, -0.08, 0.28, 0.36);
      ctx.stroke();
      ctx.beginPath();
      line(ctx, 0, 0.28, 0, 0.6);
      ctx.stroke();
      // Die waagerechte Linie ist die Membran: darunter Wasser, darüber
      // Stickstoff mit dem Vordruck p₀. Sie liegt über der Mitte, weil der
      // Gasraum im Auslegungszustand der größere ist.
      ctx.beginPath();
      line(ctx, -0.28, -0.14, 0.28, -0.14);
      ctx.stroke();
    },
  },

  // -- Messen und Anzeigen -------------------------------------------------
  'pressure-gauge': {
    width: 0.9,
    height: 1.1,
    knockout: 'circle',
    ports: [port('in', 'Messanschluss', 'bottom', 0, 0.55)],
    draw: (ctx) => {
      ctx.beginPath();
      circle(ctx, 0, -0.14, 0.29);
      line(ctx, 0, 0.15, 0, 0.55);
      ctx.stroke();
      // Zeiger im ersten Drittel der Skala — Anlagendruck, nicht Vollausschlag.
      ctx.beginPath();
      line(ctx, 0, -0.14, 0.19, -0.32);
      line(ctx, -0.2, -0.28, -0.14, -0.24);
      line(ctx, 0.2, -0.28, 0.14, -0.24);
      ctx.stroke();
    },
  },
  thermometer: {
    width: 0.7,
    height: 1.2,
    knockout: 'box',
    ports: [port('in', 'Tauchhülse', 'bottom', 0, 0.6)],
    draw: (ctx) => {
      // Kapillare mit Kugel unten — die Form, die jeder sofort liest.
      ctx.beginPath();
      ctx.moveTo(-0.07, -0.4);
      ctx.lineTo(-0.07, 0.18);
      ctx.moveTo(0.07, -0.4);
      ctx.lineTo(0.07, 0.18);
      ctx.moveTo(-0.07, -0.4);
      ctx.arc(0, -0.4, 0.07, Math.PI, 0);
      ctx.stroke();
      ctx.beginPath();
      circle(ctx, 0, 0.29, 0.14);
      line(ctx, 0, 0.43, 0, 0.6);
      ctx.stroke();
      ctx.beginPath();
      for (let i = 0; i < 3; i++) line(ctx, 0.07, -0.3 + i * 0.13, 0.16, -0.3 + i * 0.13);
      ctx.stroke();
    },
  },
  sensor: {
    width: 0.8,
    height: 1.0,
    knockout: 'circle',
    ports: [port('in', 'Messstelle', 'bottom', 0, 0.5)],
    draw: (ctx) => {
      ctx.beginPath();
      circle(ctx, 0, -0.16, 0.16);
      line(ctx, 0, 0, 0, 0.34);
      line(ctx, -0.11, 0.34, 0.11, 0.34);
      line(ctx, 0, 0.34, 0, 0.5);
      ctx.stroke();
      // Gefüllter Punkt = Messwertaufnehmer, gestrichelt = Signalleitung zur
      // Regelung (kein Rohr).
      ctx.beginPath();
      circle(ctx, 0, -0.16, 0.05);
      ctx.fill();
      ctx.save();
      ctx.setLineDash([0.06, 0.05]);
      ctx.beginPath();
      line(ctx, 0.16, -0.16, 0.4, -0.4);
      ctx.stroke();
      ctx.restore();
    },
  },
  'flow-switch': {
    width: 1.0,
    height: 1.3,
    knockout: 'box',
    ports: [
      port('in', 'Eintritt', 'left', -0.5, 0.24),
      port('out', 'Austritt', 'right', 0.5, 0.24),
    ],
    draw: (ctx) => {
      // Der Wächter sitzt *in* der Leitung: Gehäusekreis im Strömungsweg,
      // die Leitung läuft durch ihn hindurch.
      ctx.beginPath();
      circle(ctx, 0, 0.24, 0.26);
      line(ctx, -0.5, 0.24, -0.26, 0.24);
      line(ctx, 0.26, 0.24, 0.5, 0.24);
      ctx.stroke();
      // Schaltfahne: oben eingehängt, vom Strom nach rechts ausgelenkt.
      // Steht sie senkrecht, fließt nichts — genau das ist die Aussage des
      // Bauteils. Das Querstück am Ende ist das Paddel.
      ctx.beginPath();
      line(ctx, 0, -0.02, 0.1, 0.34);
      line(ctx, 0.01, 0.36, 0.19, 0.32);
      ctx.stroke();
      // Schaltkontakt über dem Gehäuse: der Wächter zeigt nichts an, er
      // schaltet — deshalb Kontakt und nicht Skala. Der senkrechte Strich
      // ist die mechanische Betätigung von der Fahne zum Kontakt: links der
      // feste Anschluss mit dem Drehpunkt, rechts der Gegenkontakt, dazwischen
      // die abgehobene Schaltbrücke. Beide Anschlüsse sind gleich lang
      // gezeichnet, sonst liest sich der rechte als Strichrest.
      ctx.beginPath();
      line(ctx, 0, -0.02, 0, -0.34);
      line(ctx, -0.32, -0.34, 0, -0.34);
      line(ctx, 0, -0.34, 0.26, -0.48);
      line(ctx, 0.16, -0.34, 0.34, -0.34);
      ctx.stroke();
    },
  },
  'temperature-limiter': {
    width: 0.9,
    height: 1.5,
    knockout: 'box',
    ports: [port('in', 'Tauchhülse', 'bottom', 0, 0.75)],
    draw: (ctx) => {
      // Fühlerkreis mit „T": gemessen wird die Temperatur. Der Buchstabe
      // ist aus zwei Strichen gezogen und nicht gesetzt — die Symbole
      // dieser Datei sind reine Strichzeichnungen und bleiben damit in
      // jeder Schriftgröße und in jedem Export gleich.
      ctx.beginPath();
      circle(ctx, 0, 0.02, 0.27);
      line(ctx, -0.13, -0.1, 0.13, -0.1);
      line(ctx, 0, -0.1, 0, 0.14);
      ctx.stroke();
      // Schaltkontakt darüber — der Unterschied zum Thermometer: dieses
      // Bauteil zeigt die Temperatur nicht an, es unterbricht bei
      // Übertemperatur den Kreis.
      ctx.beginPath();
      line(ctx, 0, -0.25, 0, -0.44);
      line(ctx, -0.3, -0.44, 0, -0.44);
      line(ctx, 0, -0.44, 0.24, -0.58);
      line(ctx, 0.14, -0.44, 0.32, -0.44);
      ctx.stroke();
      // Tauchhülse nach unten: der Wächter sitzt an der Leitung, nicht in
      // ihr — deshalb ein einzelner Stutzen wie beim Thermometer.
      ctx.beginPath();
      line(ctx, 0, 0.29, 0, 0.43);
      box(ctx, 0, 0.53, 0.16, 0.2);
      line(ctx, 0, 0.63, 0, 0.75);
      ctx.stroke();
    },
  },
  'water-meter': {
    width: 1.0,
    height: 0.9,
    knockout: 'circle',
    ports: [
      port('in', 'Eintritt', 'left', -0.5, 0),
      port('out', 'Austritt', 'right', 0.5, 0),
    ],
    draw: (ctx) => {
      ctx.beginPath();
      circle(ctx, 0, 0, 0.3);
      line(ctx, -0.5, 0, -0.3, 0);
      line(ctx, 0.3, 0, 0.5, 0);
      ctx.stroke();
      // Senkrechte Teilung mit Flügelrad in der Anströmhälfte.
      ctx.beginPath();
      line(ctx, 0, -0.3, 0, 0.3);
      circle(ctx, -0.14, 0, 0.09);
      ctx.stroke();
    },
  },
  'heat-meter': {
    width: 1.0,
    height: 1.3,
    knockout: 'box',
    ports: [
      port('in', 'Eintritt', 'left', -0.5, 0.22),
      port('out', 'Austritt', 'right', 0.5, 0.22),
    ],
    draw: (ctx) => {
      ctx.beginPath();
      circle(ctx, 0, 0.22, 0.24);
      line(ctx, -0.5, 0.22, -0.24, 0.22);
      line(ctx, 0.24, 0.22, 0.5, 0.22);
      line(ctx, 0, 0.22, 0, -0.02);
      ctx.stroke();
      ctx.beginPath();
      line(ctx, 0, -0.02, 0, -0.28);
      box(ctx, 0, -0.44, 0.5, 0.3);
      ctx.stroke();
      // Zwei Striche im Rechenwerk = Volumen und Temperaturdifferenz, die
      // beiden Größen, aus denen die Wärmemenge entsteht.
      ctx.beginPath();
      line(ctx, -0.17, -0.5, 0.17, -0.5);
      line(ctx, -0.17, -0.38, 0.08, -0.38);
      ctx.stroke();
      ctx.save();
      ctx.setLineDash([0.05, 0.05]);
      ctx.beginPath();
      line(ctx, -0.25, -0.44, -0.44, -0.44);
      line(ctx, -0.44, -0.44, -0.44, 0.22);
      line(ctx, 0.25, -0.44, 0.44, -0.44);
      line(ctx, 0.44, -0.44, 0.44, 0.22);
      ctx.stroke();
      ctx.restore();
    },
  },

  // -- Wasserbehandlung und Anschlussarmaturen -----------------------------
  strainer: {
    width: 1.0,
    height: 0.7,
    knockout: 'box',
    ports: [
      port('in', 'Eintritt', 'left', -0.5, 0),
      port('out', 'Austritt', 'right', 0.5, 0),
    ],
    draw: (ctx) => {
      ctx.beginPath();
      box(ctx, 0, 0, 0.66, 0.42);
      line(ctx, -0.5, 0, -0.33, 0);
      line(ctx, 0.33, 0, 0.5, 0);
      ctx.stroke();
      // Die schräge Strichlinie ist das Sieb — schräg, weil es angeströmt
      // und nicht durchströmt wird.
      ctx.save();
      ctx.setLineDash([0.05, 0.04]);
      ctx.beginPath();
      line(ctx, -0.28, 0.21, 0.28, -0.21);
      ctx.stroke();
      ctx.restore();
    },
  },
  'air-separator': {
    width: 0.9,
    height: 1.2,
    knockout: 'box',
    ports: [
      port('in', 'Eintritt', 'left', -0.45, 0.12),
      port('out', 'Austritt', 'right', 0.45, 0.12),
      port('vent', 'Entlüftung', 'top', 0, -0.6),
    ],
    draw: (ctx) => {
      ctx.beginPath();
      box(ctx, 0, 0.12, 0.44, 0.6);
      line(ctx, -0.45, 0.12, -0.22, 0.12);
      line(ctx, 0.22, 0.12, 0.45, 0.12);
      line(ctx, 0, -0.18, 0, -0.34);
      ctx.stroke();
      // Schnellentlüfter oben, Blasen darunter — Luft steigt auf.
      ctx.beginPath();
      circle(ctx, 0, -0.44, 0.1);
      line(ctx, 0, -0.54, 0, -0.6);
      ctx.stroke();
      ctx.beginPath();
      circle(ctx, -0.08, 0.16, 0.05);
      circle(ctx, 0.08, 0.02, 0.04);
      circle(ctx, -0.02, 0.3, 0.035);
      ctx.stroke();
    },
  },
  'dirt-separator': {
    width: 0.9,
    height: 1.2,
    knockout: 'box',
    ports: [
      port('in', 'Eintritt', 'left', -0.45, -0.12),
      port('out', 'Austritt', 'right', 0.45, -0.12),
      port('drain', 'Abschlämmung', 'bottom', 0, 0.6),
    ],
    draw: (ctx) => {
      ctx.beginPath();
      box(ctx, 0, -0.14, 0.44, 0.56);
      line(ctx, -0.45, -0.12, -0.22, -0.12);
      line(ctx, 0.22, -0.12, 0.45, -0.12);
      ctx.stroke();
      // Trichter nach unten: hier setzt sich der Schlamm ab und wird
      // abgelassen.
      ctx.beginPath();
      line(ctx, -0.22, 0.14, -0.07, 0.4);
      line(ctx, 0.22, 0.14, 0.07, 0.4);
      line(ctx, -0.07, 0.4, 0.07, 0.4);
      line(ctx, 0, 0.4, 0, 0.6);
      ctx.stroke();
      ctx.beginPath();
      circle(ctx, -0.07, 0.02, 0.035);
      circle(ctx, 0.06, 0.06, 0.03);
      circle(ctx, 0.0, -0.06, 0.03);
      ctx.fill();
    },
  },
  'filling-valve': {
    width: 1.0,
    height: 1.2,
    knockout: 'none',
    ports: [
      port('in', 'Anlagenanschluss', 'left', -0.5, -0.14),
      port('hose', 'Schlauchtülle', 'bottom', 0.28, 0.6),
    ],
    draw: (ctx) => {
      ctx.beginPath();
      bowTie(ctx, -0.06, -0.14, 0.24, 0.2);
      line(ctx, -0.5, -0.14, -0.3, -0.14);
      line(ctx, 0.18, -0.14, 0.28, -0.14);
      handWheel(ctx, -0.06, -0.14, 0.28);
      ctx.stroke();
      // Abgang nach unten mit Tülle — daran kommt der Füllschlauch.
      ctx.beginPath();
      line(ctx, 0.28, -0.14, 0.28, 0.36);
      line(ctx, 0.18, 0.36, 0.38, 0.36);
      line(ctx, 0.21, 0.48, 0.35, 0.48);
      line(ctx, 0.28, 0.36, 0.28, 0.6);
      ctx.stroke();
    },
  },
  'backflow-preventer': {
    width: 1.2,
    height: 1.2,
    knockout: 'box',
    ports: [
      port('in', 'Trinkwasser', 'left', -0.6, -0.14),
      port('out', 'Anlagenseite', 'right', 0.6, -0.14),
      port('drain', 'Ablauftrichter', 'bottom', 0, 0.6),
    ],
    draw: (ctx) => {
      ctx.beginPath();
      box(ctx, 0, -0.14, 0.9, 0.46);
      line(ctx, -0.6, -0.14, -0.45, -0.14);
      line(ctx, 0.45, -0.14, 0.6, -0.14);
      line(ctx, -0.15, -0.37, -0.15, 0.09);
      line(ctx, 0.15, -0.37, 0.15, 0.09);
      ctx.stroke();
      // Zwei Rückflussverhinderer, dazwischen die überwachte Mittelkammer.
      ctx.beginPath();
      poly(ctx, [
        [-0.36, -0.28],
        [-0.36, 0.0],
        [-0.2, -0.14],
      ]);
      poly(ctx, [
        [0.2, -0.28],
        [0.2, 0.0],
        [0.36, -0.14],
      ]);
      ctx.stroke();
      // Freier Auslauf: der Trichter darf die Ablaufleitung nicht berühren.
      ctx.beginPath();
      line(ctx, 0, 0.09, 0, 0.2);
      line(ctx, -0.2, 0.3, 0.2, 0.3);
      line(ctx, -0.2, 0.3, -0.07, 0.5);
      line(ctx, 0.2, 0.3, 0.07, 0.5);
      line(ctx, 0, 0.5, 0, 0.6);
      ctx.stroke();
    },
  },

  // -- Verteilung und Übergabe ---------------------------------------------
  manifold: {
    width: 1.8,
    height: 1.0,
    knockout: 'box',
    ports: [
      port('flow', 'Vorlauf', 'left', -0.9, -0.22),
      port('return', 'Rücklauf', 'left', -0.9, 0.22),
      // Jeder Abgang steht für einen ganzen Heizkreis, also für das Paar aus
      // Vor- und Rücklauf. Getrennt gezeichnet würde das Strangschema
      // unlesbar; wer die Einzelanbindung braucht, zeichnet den Verteiler
      // als eigenes Detail.
      port('circuit-1', 'Heizkreis 1', 'bottom', -0.54, 0.5),
      port('circuit-2', 'Heizkreis 2', 'bottom', -0.18, 0.5),
      port('circuit-3', 'Heizkreis 3', 'bottom', 0.18, 0.5),
      port('circuit-4', 'Heizkreis 4', 'bottom', 0.54, 0.5),
    ],
    draw: (ctx) => {
      // Zwei Balken: oben der Vorlaufbalken, unten der Rücklaufbalken.
      ctx.beginPath();
      box(ctx, 0, -0.22, 1.8, 0.16);
      box(ctx, 0, 0.22, 1.8, 0.16);
      ctx.stroke();
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const x = -0.54 + i * 0.36;
        line(ctx, x, 0.3, x, 0.5);
      }
      ctx.stroke();
    },
  },
  radiator: {
    width: 1.4,
    height: 1.0,
    knockout: 'box',
    ports: [
      port('flow', 'Vorlauf', 'left', -0.7, -0.2),
      port('return', 'Rücklauf', 'left', -0.7, 0.2),
    ],
    draw: (ctx) => {
      ctx.beginPath();
      box(ctx, 0, 0, 1.16, 0.6);
      line(ctx, -0.7, -0.2, -0.58, -0.2);
      line(ctx, -0.7, 0.2, -0.58, 0.2);
      ctx.stroke();
      // Lamellen — das Erkennungsmerkmal des Heizkörpers im Schema.
      ctx.beginPath();
      for (let i = 1; i < 7; i++) {
        const x = -0.58 + (1.16 * i) / 7;
        line(ctx, x, -0.24, x, 0.24);
      }
      ctx.stroke();
    },
  },
  'floor-loop': {
    width: 1.5,
    height: 0.9,
    knockout: 'box',
    ports: [
      port('flow', 'Vorlauf', 'left', -0.75, -0.18),
      port('return', 'Rücklauf', 'left', -0.75, 0.18),
    ],
    draw: (ctx) => {
      ctx.save();
      ctx.setLineDash([0.06, 0.05]);
      ctx.beginPath();
      box(ctx, 0, 0, 1.2, 0.62);
      ctx.stroke();
      ctx.restore();
      // Die Stutzen laufen bis an den Mäander heran (x = -0.5) und nicht nur
      // bis an die gestrichelte Raumkante, sonst hängt die Schleife im Bild
      // frei und der Kreis sieht unterbrochen aus.
      ctx.beginPath();
      line(ctx, -0.75, -0.18, -0.5, -0.18);
      line(ctx, -0.75, 0.18, -0.5, 0.18);
      ctx.stroke();
      // Mäander: die im Estrich liegende Schleife. Die Teilung folgt dem
      // Abstand der beiden Anschlüsse (0.18 - (-0.18) = 0.36), damit der
      // letzte Bogen genau auf dem Rücklaufanschluss endet.
      ctx.beginPath();
      const turns = 4;
      const step = 0.36 / turns;
      ctx.moveTo(-0.5, -0.18);
      for (let i = 0; i < turns; i++) {
        const y = -0.18 + step * i;
        ctx.lineTo(0.5, y);
        ctx.lineTo(0.5, y + step * 0.5);
        ctx.lineTo(-0.5, y + step * 0.5);
        ctx.lineTo(-0.5, y + step);
      }
      ctx.stroke();
    },
  },
  'mixing-valve-dhw': {
    width: 1.0,
    height: 1.1,
    knockout: 'none',
    ports: [
      port('hot', 'Speicher warm', 'left', -0.5, 0),
      port('mixed', 'Zapfstelle', 'right', 0.5, 0),
      port('cold', 'Kaltwasser', 'bottom', 0, 0.55),
    ],
    draw: (ctx) => {
      ctx.beginPath();
      bowTie(ctx, 0, 0, 0.28, 0.22);
      line(ctx, -0.5, 0, -0.28, 0);
      line(ctx, 0.28, 0, 0.5, 0);
      line(ctx, 0, 0.28, 0, 0.55);
      line(ctx, 0, 0, 0, -0.26);
      ctx.stroke();
      ctx.beginPath();
      poly(ctx, [
        [-0.22, 0.28],
        [0.22, 0.28],
        [0, 0],
      ]);
      ctx.fill();
      // Dehnstoffelement statt Motor: der Mischer regelt sich selbst nach
      // der Mischwassertemperatur.
      ctx.beginPath();
      box(ctx, 0, -0.38, 0.3, 0.24);
      line(ctx, -0.15, -0.38, 0.15, -0.38);
      line(ctx, -0.08, -0.46, -0.08, -0.3);
      line(ctx, 0.08, -0.46, 0.08, -0.3);
      ctx.stroke();
    },
  },
  node: {
    width: 0.3,
    height: 0.3,
    knockout: 'none',
    ports: [
      port('north', 'Abgang oben', 'top', 0, -0.15),
      port('south', 'Abgang unten', 'bottom', 0, 0.15),
      port('west', 'Abgang links', 'left', -0.15, 0),
      port('east', 'Abgang rechts', 'right', 0.15, 0),
    ],
    draw: (ctx) => {
      ctx.beginPath();
      circle(ctx, 0, 0, 0.09);
      ctx.fill();
    },
  },
};

// ---------------------------------------------------------------------------
// Anschlusspunkte
// ---------------------------------------------------------------------------

/**
 * Anschlusslage aller Symbole, relativ zum Mittelpunkt in Vielfachen von
 * `size`. Der Schema-Generator liest hier ab, wo eine Leitung ansetzt.
 */
export const SYMBOL_PORTS: Record<SchematicKind, SymbolPorts> = {
  'heatpump-outdoor': SYMBOLS['heatpump-outdoor'].ports,
  'heatpump-indoor': SYMBOLS['heatpump-indoor'].ports,
  'hydraulic-station': SYMBOLS['hydraulic-station'].ports,
  cylinder: SYMBOLS.cylinder.ports,
  buffer: SYMBOLS.buffer.ports,
  'buffer-series': SYMBOLS['buffer-series'].ports,
  separator: SYMBOLS.separator.ports,
  freshwater: SYMBOLS.freshwater.ports,
  pump: SYMBOLS.pump.ports,
  'valve-2way': SYMBOLS['valve-2way'].ports,
  'valve-3way': SYMBOLS['valve-3way'].ports,
  'valve-diverter': SYMBOLS['valve-diverter'].ports,
  'check-valve': SYMBOLS['check-valve'].ports,
  shutoff: SYMBOLS.shutoff.ports,
  'balancing-valve': SYMBOLS['balancing-valve'].ports,
  'overflow-valve': SYMBOLS['overflow-valve'].ports,
  'safety-valve': SYMBOLS['safety-valve'].ports,
  'expansion-vessel': SYMBOLS['expansion-vessel'].ports,
  'pressure-gauge': SYMBOLS['pressure-gauge'].ports,
  thermometer: SYMBOLS.thermometer.ports,
  sensor: SYMBOLS.sensor.ports,
  'flow-switch': SYMBOLS['flow-switch'].ports,
  'temperature-limiter': SYMBOLS['temperature-limiter'].ports,
  strainer: SYMBOLS.strainer.ports,
  'air-separator': SYMBOLS['air-separator'].ports,
  'dirt-separator': SYMBOLS['dirt-separator'].ports,
  'filling-valve': SYMBOLS['filling-valve'].ports,
  'backflow-preventer': SYMBOLS['backflow-preventer'].ports,
  'water-meter': SYMBOLS['water-meter'].ports,
  'heat-meter': SYMBOLS['heat-meter'].ports,
  manifold: SYMBOLS.manifold.ports,
  radiator: SYMBOLS.radiator.ports,
  'floor-loop': SYMBOLS['floor-loop'].ports,
  boiler: SYMBOLS.boiler.ports,
  'electric-heater': SYMBOLS['electric-heater'].ports,
  solar: SYMBOLS.solar.ports,
  'mixing-valve-dhw': SYMBOLS['mixing-valve-dhw'].ports,
  'circulation-pump': SYMBOLS['circulation-pump'].ports,
  node: SYMBOLS.node.ports,
};

/** Belegungsfläche eines Symbols in Bildschirmpixeln. */
export function symbolExtent(kind: SchematicKind, size: number): { width: number; height: number } {
  const def = SYMBOLS[kind];
  return { width: def.width * size, height: def.height * size };
}

/** Ein einzelner Anschluss, oder `undefined`, wenn das Symbol ihn nicht hat. */
export function findPort(kind: SchematicKind, portId: string): SymbolPort | undefined {
  return SYMBOLS[kind].ports.find((p) => p.id === portId);
}

/**
 * Anschlusspunkte in absoluten Bildschirmkoordinaten.
 *
 * `rotation` wird mitgedreht, damit ein um 90° gedrehtes Ventil auch seine
 * Stutzen dreht — sonst zeichnet der Generator die Leitung ins Leere.
 */
export function symbolPortPoints(
  kind: SchematicKind,
  x: number,
  y: number,
  size: number,
  rotation = 0,
): { port: SymbolPort; x: number; y: number }[] {
  const rad = (rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return SYMBOLS[kind].ports.map((p) => ({
    port: p,
    x: x + (p.x * cos - p.y * sin) * size,
    y: y + (p.x * sin + p.y * cos) * size,
  }));
}

/**
 * Welches Stutzenpaar verbindet eine Leitung?
 *
 * Benennt die Verbindung ihre Stutzen (`fromPort`/`toPort`), gilt das — und
 * zwar auch dann, wenn ein anderes Paar näher beieinanderliegt. Nur wenn die
 * Angabe fehlt oder ins Leere zeigt, wird das nächste Paar gesucht.
 *
 * Die Funktion steht hier und nicht in den Zeichnern, weil Bildschirm und
 * Blatt dieselbe Leitung zeigen müssen. Beide hatten die Nähe-Heuristik
 * bisher als eigene Kopie — mit dem bekannten Ergebnis, dass zwei Kopien
 * irgendwann zwei verschiedene Dinge tun.
 */
export function pickPortPair(
  from: readonly { port: SymbolPort; x: number; y: number }[],
  to: readonly { port: SymbolPort; x: number; y: number }[],
  named?: { fromPort?: string; toPort?: string },
): { p: { port: SymbolPort; x: number; y: number }; q: { port: SymbolPort; x: number; y: number } } | null {
  if (!from.length || !to.length) return null;

  const gewaehltVon = named?.fromPort ? from.find((e) => e.port.id === named.fromPort) : undefined;
  const gewaehltNach = named?.toPort ? to.find((e) => e.port.id === named.toPort) : undefined;

  // Ist nur eine Seite benannt, wird für die andere der nächste Stutzen zu
  // genau diesem Punkt gesucht — nicht das global nächste Paar.
  const naechster = (
    liste: readonly { port: SymbolPort; x: number; y: number }[],
    zu: { x: number; y: number },
  ) => liste.reduce((a, b) => (Math.hypot(b.x - zu.x, b.y - zu.y) < Math.hypot(a.x - zu.x, a.y - zu.y) ? b : a));

  if (gewaehltVon && gewaehltNach) return { p: gewaehltVon, q: gewaehltNach };
  if (gewaehltVon) return { p: gewaehltVon, q: naechster(to, gewaehltVon) };
  if (gewaehltNach) return { p: naechster(from, gewaehltNach), q: gewaehltNach };

  let best = { p: from[0], q: to[0], d: Infinity };
  for (const p of from) {
    for (const q of to) {
      const d = Math.hypot(p.x - q.x, p.y - q.y);
      if (d < best.d) best = { p, q, d };
    }
  }
  return { p: best.p, q: best.q };
}

/** Trägt ein Symbol diesen Stutzen? Für die Prüfung des Generators. */
export function hasPort(kind: SchematicKind, portId: string): boolean {
  return SYMBOLS[kind].ports.some((p) => p.id === portId);
}

/** Alle Stutzen einer Bauteilart — Bezeichner und Klartext. */
export function portsOf(kind: SchematicKind): SymbolPorts {
  return SYMBOLS[kind].ports;
}

// ---------------------------------------------------------------------------
// Zeichnen
// ---------------------------------------------------------------------------

interface ResolvedOptions {
  color: string;
  lineWidth: number;
  label: string;
  spec: string;
  rotation: number;
  background: string;
  fontSize: number;
}

const resolve = (kind: SchematicKind, size: number, options: SymbolOptions): ResolvedOptions => ({
  color: options.color,
  lineWidth: options.lineWidth ?? 1.3,
  // Ohne Angabe steht der Legendenname über dem Symbol. Der Knoten ist kein
  // Bauteil und bekommt deshalb von sich aus keine Beschriftung.
  label:
    options.label === undefined ? (kind === 'node' ? '' : SCHEMATIC_LEGEND[kind].name) : (options.label ?? ''),
  spec: options.spec ?? '',
  rotation: options.rotation ?? 0,
  background: options.background ?? '#FFFFFF',
  // Die Schrift wächst mit dem Symbol, wird aber nach unten auf 8 px
  // begrenzt (darunter ist am Bildschirm nichts mehr zu lesen) und nach
  // oben auf 13 px, damit die Beschriftung das Symbol nicht erschlägt.
  // Bei sehr kleinem `size` ist die Schrift dadurch größer als das Symbol —
  // das ist gewollt, die Alternative wäre unleserlich.
  fontSize: options.fontSize ?? Math.max(8, Math.min(13, Math.round(size * 0.3))),
});

/** Beschriftung: Name darüber, technische Angabe darunter, mittig, waagerecht. */
function drawSymbolLabels(
  ctx: Ctx,
  kind: SchematicKind,
  x: number,
  y: number,
  size: number,
  opt: ResolvedOptions,
): void {
  if (!opt.label && !opt.spec) return;
  // Die Texte bleiben waagerecht, das Symbol dreht sich. Maßgeblich ist
  // deshalb die halbe Höhe des *gedrehten* Belegungsrechtecks — sonst
  // schiebt sich die Beschriftung bei 90° mitten ins Symbol.
  const def = SYMBOLS[kind];
  const rad = (opt.rotation * Math.PI) / 180;
  const half =
    ((def.width * Math.abs(Math.sin(rad)) + def.height * Math.abs(Math.cos(rad))) * size) / 2;
  const gap = Math.max(3, opt.fontSize * 0.35);
  ctx.save();
  ctx.font = `500 ${opt.fontSize}px JetBrains Mono, ui-monospace, monospace`;
  ctx.textAlign = 'center';
  ctx.fillStyle = opt.color;
  if (opt.label) {
    ctx.textBaseline = 'bottom';
    ctx.fillText(opt.label, x, y - half - gap);
  }
  if (opt.spec) {
    ctx.textBaseline = 'top';
    ctx.fillText(opt.spec, x, y + half + gap);
  }
  ctx.restore();
}

/**
 * Zeichnet ein Symbol des Anlagenschemas.
 *
 * @param x,y   Mittelpunkt in Bildschirmkoordinaten
 * @param size  Kantenlänge des Symbolrasters [px]; alle Formen sind darauf bezogen
 */
export function drawSymbol(
  ctx: Ctx,
  kind: SchematicKind,
  x: number,
  y: number,
  size: number,
  options: SymbolOptions,
): void {
  // Grenzfall: bei size <= 0 (oder NaN) würde `ctx.scale(0, 0)` die
  // Transformation entarten und `lineWidth / size` gegen unendlich laufen.
  // Dann gibt es nichts zu zeichnen — stiller Abbruch statt kaputter Pfade.
  if (!Number.isFinite(size) || size <= 0) return;
  const def = SYMBOLS[kind];
  const opt = resolve(kind, size, options);

  ctx.save();
  ctx.translate(x, y);
  if (opt.rotation) ctx.rotate((opt.rotation * Math.PI) / 180);
  ctx.scale(size, size);
  // Strichstärke ist eine Bildschirmgröße, keine Symbolgröße — deshalb
  // zurückrechnen, sonst wird ein großes Symbol fett und ein kleines dünn.
  ctx.lineWidth = opt.lineWidth / size;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = opt.color;
  ctx.fillStyle = opt.color;

  if (def.knockout !== 'none') {
    ctx.save();
    ctx.fillStyle = opt.background;
    ctx.beginPath();
    if (def.knockout === 'circle') {
      circle(ctx, 0, 0, Math.min(def.width, def.height) / 2);
    } else {
      box(ctx, 0, 0, def.width * 0.94, def.height * 0.94);
    }
    ctx.fill();
    ctx.restore();
  }

  def.draw(ctx);
  ctx.restore();

  drawSymbolLabels(ctx, kind, x, y, size, opt);
}

/** Erzeugt die Einzelfunktion zu einem Symbol. */
const renderer =
  (kind: SchematicKind): SymbolRenderer =>
  (ctx, x, y, size, options) =>
    drawSymbol(ctx, kind, x, y, size, options);

export const drawHeatPumpOutdoorSymbol = renderer('heatpump-outdoor');
export const drawHeatPumpIndoorSymbol = renderer('heatpump-indoor');
export const drawHydraulicStationSymbol = renderer('hydraulic-station');
export const drawCylinderSymbol = renderer('cylinder');
export const drawBufferSymbol = renderer('buffer');
export const drawBufferSeriesSymbol = renderer('buffer-series');
export const drawSeparatorSymbol = renderer('separator');
export const drawFreshWaterSymbol = renderer('freshwater');
export const drawPumpSymbol = renderer('pump');
export const drawValve2WaySymbol = renderer('valve-2way');
export const drawValve3WaySymbol = renderer('valve-3way');
export const drawDiverterValveSymbol = renderer('valve-diverter');
export const drawCheckValveSymbol = renderer('check-valve');
export const drawShutoffSymbol = renderer('shutoff');
export const drawBalancingValveSymbol = renderer('balancing-valve');
export const drawOverflowValveSymbol = renderer('overflow-valve');
export const drawSafetyValveSymbol = renderer('safety-valve');
export const drawExpansionVesselSymbol = renderer('expansion-vessel');
export const drawPressureGaugeSymbol = renderer('pressure-gauge');
export const drawThermometerSymbol = renderer('thermometer');
export const drawSensorSymbol = renderer('sensor');
export const drawFlowSwitchSymbol = renderer('flow-switch');
export const drawTemperatureLimiterSymbol = renderer('temperature-limiter');
export const drawStrainerSymbol = renderer('strainer');
export const drawAirSeparatorSymbol = renderer('air-separator');
export const drawDirtSeparatorSymbol = renderer('dirt-separator');
export const drawFillingValveSymbol = renderer('filling-valve');
export const drawBackflowPreventerSymbol = renderer('backflow-preventer');
export const drawWaterMeterSymbol = renderer('water-meter');
export const drawHeatMeterSymbol = renderer('heat-meter');
export const drawManifoldSymbol = renderer('manifold');
export const drawRadiatorSymbol = renderer('radiator');
export const drawFloorLoopSymbol = renderer('floor-loop');
export const drawBoilerSymbol = renderer('boiler');
export const drawElectricHeaterSymbol = renderer('electric-heater');
export const drawSolarSymbol = renderer('solar');
export const drawMixingValveDhwSymbol = renderer('mixing-valve-dhw');
export const drawCirculationPumpSymbol = renderer('circulation-pump');
export const drawNodeSymbol = renderer('node');

/** Alle Einzelfunktionen, falls über die Symbolart gesucht wird. */
export const SYMBOL_RENDERERS: Record<SchematicKind, SymbolRenderer> = {
  'heatpump-outdoor': drawHeatPumpOutdoorSymbol,
  'heatpump-indoor': drawHeatPumpIndoorSymbol,
  'hydraulic-station': drawHydraulicStationSymbol,
  cylinder: drawCylinderSymbol,
  buffer: drawBufferSymbol,
  'buffer-series': drawBufferSeriesSymbol,
  separator: drawSeparatorSymbol,
  freshwater: drawFreshWaterSymbol,
  pump: drawPumpSymbol,
  'valve-2way': drawValve2WaySymbol,
  'valve-3way': drawValve3WaySymbol,
  'valve-diverter': drawDiverterValveSymbol,
  'check-valve': drawCheckValveSymbol,
  shutoff: drawShutoffSymbol,
  'balancing-valve': drawBalancingValveSymbol,
  'overflow-valve': drawOverflowValveSymbol,
  'safety-valve': drawSafetyValveSymbol,
  'expansion-vessel': drawExpansionVesselSymbol,
  'pressure-gauge': drawPressureGaugeSymbol,
  thermometer: drawThermometerSymbol,
  sensor: drawSensorSymbol,
  'flow-switch': drawFlowSwitchSymbol,
  'temperature-limiter': drawTemperatureLimiterSymbol,
  strainer: drawStrainerSymbol,
  'air-separator': drawAirSeparatorSymbol,
  'dirt-separator': drawDirtSeparatorSymbol,
  'filling-valve': drawFillingValveSymbol,
  'backflow-preventer': drawBackflowPreventerSymbol,
  'water-meter': drawWaterMeterSymbol,
  'heat-meter': drawHeatMeterSymbol,
  manifold: drawManifoldSymbol,
  radiator: drawRadiatorSymbol,
  'floor-loop': drawFloorLoopSymbol,
  boiler: drawBoilerSymbol,
  'electric-heater': drawElectricHeaterSymbol,
  solar: drawSolarSymbol,
  'mixing-valve-dhw': drawMixingValveDhwSymbol,
  'circulation-pump': drawCirculationPumpSymbol,
  node: drawNodeSymbol,
};

// ---------------------------------------------------------------------------
// Trefferprüfung
// ---------------------------------------------------------------------------

/**
 * Trifft ein Klick das Symbol?
 *
 * `point` ist der Klickpunkt **relativ zum Symbolmittelpunkt** in
 * Bildschirmpixeln. Geprüft wird gegen das Belegungsrechteck, nicht gegen die
 * Innenform: ein Klick in die Lücke eines Dreieckpaars soll die Armatur
 * auswählen, nicht die Leitung darunter. Bei gedrehten Symbolen dreht der
 * Aufrufer den Punkt vorher zurück.
 *
 * `tolerance` vergrößert das Rechteck an allen Seiten [px] — für kleine
 * Symbole wie den Knoten sonst kaum treffbar.
 */
export function hitTestSymbol(
  kind: SchematicKind,
  size: number,
  point: { x: number; y: number },
  tolerance = 3,
): boolean {
  const def = SYMBOLS[kind];
  return (
    Math.abs(point.x) <= (def.width * size) / 2 + tolerance &&
    Math.abs(point.y) <= (def.height * size) / 2 + tolerance
  );
}

/**
 * Der Anschluss, der einem Punkt am nächsten liegt — für das Ziehen einer
 * Leitung von Symbol zu Symbol. `undefined`, wenn keiner innerhalb von
 * `radius` liegt.
 */
export function nearestPort(
  kind: SchematicKind,
  x: number,
  y: number,
  size: number,
  point: { x: number; y: number },
  rotation = 0,
  radius = 10,
): { port: SymbolPort; x: number; y: number } | undefined {
  let best: { port: SymbolPort; x: number; y: number } | undefined;
  let bestDistance = radius;
  for (const candidate of symbolPortPoints(kind, x, y, size, rotation)) {
    const distance = Math.hypot(candidate.x - point.x, candidate.y - point.y);
    if (distance <= bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best;
}

/** Die Legende als Liste, in der Reihenfolge der Symboltabelle. */
export function schematicLegendList(): SymbolLegendEntry[] {
  return (Object.keys(SYMBOLS) as SchematicKind[]).map((kind) => SCHEMATIC_LEGEND[kind]);
}
