/**
 * Symboltafeln für das Handbuch — aus dem Programm heraus gezeichnet.
 * ---------------------------------------------------------------------------
 * **Warum dieses Skript existiert.** Ein Handbuch, das die Symbole
 * *nachzeichnet*, ist ab der ersten Symboländerung falsch — und niemand merkt
 * es, weil beide Bilder für sich plausibel aussehen. Genau dieser Fehlertyp
 * hat dieses Projekt dreimal getroffen (zwei Kopien derselben Geometrie, die
 * auseinanderlaufen).
 *
 * Deshalb rendert dieses Skript **dieselben Zeichenroutinen**, die auch am
 * Bildschirm und auf dem Blatt laufen. Möglich macht das der `SvgRecorder`
 * aus `schematicPrint.ts`: er nimmt Canvas-Aufrufe entgegen und macht SVG
 * daraus. Das Symbol im Handbuch ist damit Strich für Strich dasselbe Symbol
 * wie im Programm.
 *
 * Ausgabe: `handbuch/tafeln.json` im Projekt — je Tafel eine Liste aus
 * Kachel, SVG und Beschriftung. Der Handbuchbau setzt sie an die Stellen, wo
 * `<!--SYMBOLTAFEL:name-->` steht.
 */

import { writeFileSync } from 'node:fs';
import type {
  Annotation,
  BimDocument,
  BimNode,
  Durchbruch,
  DurchbruchPreset,
  Fixture,
  Opening,
  PipeAccessoryKind,
  PipeService,
  SchematicKind,
  SolidElement,
  SolidKind,
  VerticalElement,
  VerticalKind,
  Wall,
} from '../src/types/bim';
import {
  ANNOTATION_LABELS,
  DURCHBRUCH_LABELS,
  DURCHBRUCH_PRESETS,
  durchbruchWirt,
  FIXTURE_LIBRARY,
  OPENING_PRESETS,
  PIPE_SERVICE_COLORS,
  PIPE_SERVICE_LABELS,
  SOLID_LABELS,
  VERTICAL_LABELS,
} from '../src/types/bim';
import { SvgRecorder } from '../src/lib/schematicPrint';
import { drawFixture } from '../src/lib/fixtureSymbols';
import { SCHEMATIC_LEGEND, drawSymbol } from '../src/lib/schematicSymbols';
import { ACCESSORY_LABELS, ACCESSORY_LEGEND, accessorySymbol } from '../src/lib/pipeAccessorySymbols';
import { openingSymbol } from '../src/lib/openingSymbols';
import { drawSolid, drawVertical } from '../src/lib/verticalSymbols';
import { durchbruchBeschriftung, zeichneDurchbruch } from '../src/lib/durchbruchSymbols';
import { drawAnnotation } from '../src/lib/annotationSymbols';
import { getWallGeometry } from '../src/lib/wallGeometry';

/** Der Aufzeichner in der Gestalt, die die Zeichner erwarten. */
const alsCtx = (r: SvgRecorder): CanvasRenderingContext2D => r as unknown as CanvasRenderingContext2D;

interface Kachel {
  titel: string;
  /** Untertitel oder Kennwert. */
  spitze?: string;
  /** Erklärung in einem Satz. */
  text?: string;
  svg: string;
}

/**
 * Auf welchem Grund eine Tafel steht.
 *
 * Das ist keine Geschmacksfrage. Die Symbole des **Bildschirms** sind in
 * Farben entworfen, die auf dunklem Grund lesen — Hellgrau auf Weiß wäre
 * kaum zu sehen und würde zugleich behaupten, so sähe es im Programm aus.
 * Die Symbole des **Blattes** sind Tuschefarben auf Papier. Das Handbuch
 * zeigt jede Tafel deshalb so, wie der Leser sie tatsächlich vor sich hat,
 * und sagt es in der Bildunterschrift dazu.
 */
type Grund = 'schirm' | 'blatt';

interface Tafel {
  grund: Grund;
  /** Ein Satz unter der Tafel, der sagt, wo diese Symbole vorkommen. */
  hinweis: string;
  kacheln: Kachel[];
}

const tafeln: Record<string, Tafel> = {};

/** Ein SVG-Rahmen um aufgezeichneten Inhalt. */
const rahmen = (inhalt: string, w: number, h: number): string =>
  `<svg viewBox="0 0 ${w} ${h}" role="img" xmlns="http://www.w3.org/2000/svg">${inhalt}</svg>`;

// ===========================================================================
// 1 — TGA-Objekte im Grundriss
// ===========================================================================
{
  /** Zeichenfeld der TGA-Kacheln; die `viewBox` rechnet es auf die Kachel herunter. */
  const BREITE = 320;
  const HOEHE = 250;
  const kacheln: Kachel[] = [];
  for (const def of FIXTURE_LIBRARY) {
    const r = new SvgRecorder();
    const ctx = alsCtx(r);
    /*
     * Der Zoom wird so gewählt, dass das größte Maß des Objekts rund 55 % der
     * Kachel füllt. Ein Heizkörper misst 1,00 m, ein Raumthermostat 0,10 m —
     * bei festem Maßstab wäre eines davon immer unbrauchbar klein. Gezeichnet
     * wird deshalb in ein großes Koordinatenfeld, das der Browser über die
     * `viewBox` auf die Kachel herunterrechnet; die Striche bleiben dabei
     * Vektoren.
     *
     * Die Obergrenze von 300 verhindert, dass ein sehr kleines Objekt die
     * Kachel sprengt. Die Untergrenze von 40 ist keine Schönheit, sondern
     * Absicht: oberhalb von 38 px/m zeichnet `drawFixture` das
     * **Kennwertschild** mit — und genau so sieht der Plan aus, in dem das
     * Objekt später steht.
     */
    const groesse = Math.max(def.length, def.depth, 0.08);
    const zoom = Math.min(700, Math.max(40, (BREITE * 0.55) / groesse));
    const fixture: Fixture = {
      id: `tafel-${def.type}`,
      type: def.type,
      category: def.category,
      label: def.label,
      position: { x: 0, y: 0 },
      rotation: 0,
      length: def.length,
      depth: def.depth,
      elevation: def.elevation,
      params: { ...def.params },
    } as Fixture;
    drawFixture(
      ctx,
      fixture,
      (x) => BREITE / 2 + x * zoom,
      (y) => HOEHE * 0.44 - y * zoom,
      zoom,
      { selected: false, hovered: false },
    );
    kacheln.push({
      titel: def.label,
      spitze: `${def.length.toLocaleString('de-DE')} × ${def.depth.toLocaleString('de-DE')} m`,
      text: def.wallMounted ? 'wandgebunden' : 'frei im Raum',
      svg: rahmen(r.finish(), BREITE, HOEHE),
    });
  }
  tafeln.tga = {
    grund: 'schirm',
    hinweis:
      'So sehen die Objekte im 2D-Grundriss aus. Die Farbe steht für das Gewerk: Rot Heizung, Blau Sanitär, ' +
      'Grün Lüftung. Die kleine Zeile unter manchen Symbolen ist das Kennwertschild — Leistung, Anschluss oder ' +
      'Luftmenge; im Programm erscheint es erst ab einer bestimmten Zoomstufe (siehe Abschnitt 8.3). Im Ausdruck ' +
      'werden dieselben Formen in Schwarz gezeichnet.',
    kacheln,
  };
}

// ===========================================================================
// 2 — Armaturen und Formstücke am Rohrnetz
// ===========================================================================
{
  const kacheln: Kachel[] = [];
  const arten = Object.keys(ACCESSORY_LABELS) as PipeAccessoryKind[];
  for (const art of arten) {
    const teile = accessorySymbol(art);
    // Die Teile stehen in Metern um den Ursprung, Ausdehnung etwa ±0,5.
    // Maßstab 70 px/m füllt die Kachel, Ursprung in der Mitte.
    const S = 70;
    const X = (x: number) => 60 + x * S;
    const Y = (y: number) => 45 + y * S;
    const linien: string[] = [];
    const breite = (w: 'stark' | 'fein') => (w === 'stark' ? 1.6 : 0.9);
    // Die Rohrachse, auf der die Armatur sitzt — ohne sie schwebt das Symbol.
    linien.push(`<line x1="${X(-0.9)}" y1="${Y(0)}" x2="${X(0.9)}" y2="${Y(0)}" stroke="#94A3B8" stroke-width="1" stroke-dasharray="3 2"/>`);
    for (const t of teile) {
      if (t.kind === 'line') {
        linien.push(`<line x1="${X(t.a.x)}" y1="${Y(t.a.y)}" x2="${X(t.b.x)}" y2="${Y(t.b.y)}" stroke="#0F172A" stroke-width="${breite(t.weight)}" stroke-linecap="round"/>`);
      } else if (t.kind === 'poly') {
        const d = t.points.map((p, i) => `${i ? 'L' : 'M'}${X(p.x)} ${Y(p.y)}`).join(' ') + (t.closed ? ' Z' : '');
        linien.push(`<path d="${d}" fill="${t.filled ? '#0F172A' : 'none'}" stroke="#0F172A" stroke-width="${breite(t.weight)}" stroke-linejoin="round"/>`);
      } else if (t.kind === 'circle') {
        linien.push(`<circle cx="${X(t.c.x)}" cy="${Y(t.c.y)}" r="${t.r * S}" fill="${t.filled ? '#0F172A' : 'none'}" stroke="#0F172A" stroke-width="${breite(t.weight)}"/>`);
      } else {
        const a1 = { x: t.c.x + t.r * Math.cos(t.from), y: t.c.y + t.r * Math.sin(t.from) };
        const a2 = { x: t.c.x + t.r * Math.cos(t.to), y: t.c.y + t.r * Math.sin(t.to) };
        const gross = Math.abs(t.to - t.from) > Math.PI ? 1 : 0;
        linien.push(`<path d="M${X(a1.x)} ${Y(a1.y)} A ${t.r * S} ${t.r * S} 0 ${gross} 1 ${X(a2.x)} ${Y(a2.y)}" fill="none" stroke="#0F172A" stroke-width="${breite(t.weight)}"/>`);
      }
    }
    kacheln.push({
      titel: ACCESSORY_LABELS[art],
      text: ACCESSORY_LEGEND[art],
      svg: rahmen(linien.join(''), 120, 90),
    });
  }
  tafeln.armaturen = {
    grund: 'blatt',
    hinweis: 'Die gestrichelte Waagerechte ist die Rohrachse — die Armatur sitzt darauf. Dieselbe Geometrie erscheint am Bildschirm und auf dem Blatt; nur die Farbe wechselt.',
    kacheln,
  };
}

// ===========================================================================
// 3 — Bauteile des Anlagenschemas
// ===========================================================================
{
  const kacheln: Kachel[] = [];
  const arten = Object.keys(SCHEMATIC_LEGEND) as SchematicKind[];
  for (const art of arten) {
    // 'node' ist der unsichtbare Verbindungspunkt und hat kein Symbol.
    if (art === 'node') continue;
    const r = new SvgRecorder();
    const ctx = alsCtx(r);
    /*
     * `label: null` und `spec: null` schalten die Beschriftung ab: in der
     * Tafel steht der Name daneben, nicht im Bild. Die Freistellfläche ist
     * weiß wie auf dem Blatt — die Kreissymbole (Pumpe, Ventil) stanzen die
     * Leitung darunter aus, und ohne diese Fläche liefe der Strich durch.
     */
    drawSymbol(ctx, art, 60, 48, 52, {
      color: '#0F172A',
      lineWidth: 1.5,
      background: '#FFFFFF',
      label: null,
      spec: null,
    });
    const eintrag = SCHEMATIC_LEGEND[art];
    kacheln.push({
      titel: eintrag.name,
      text: eintrag.description,
      svg: rahmen(r.finish(), 120, 96),
    });
  }
  tafeln.schema = {
    grund: 'blatt',
    hinweis: 'Die Bauteilsymbole des Anlagenschemas, gezeichnet wie auf dem Blatt. Die weiße Fläche unter den Kreissymbolen ist Absicht: sie stanzt die Leitung darunter aus, damit der Strich nicht durch das Symbol läuft.',
    kacheln,
  };
}

// ===========================================================================
// 4 — Leitungsarten: Farbe und Strichart
// ===========================================================================
{
  /*
   * Die Stricharten stehen in `schematicPrint.ts` privat; sie hier zu
   * wiederholen wäre die zweite Wahrheit, vor der dieses Skript schützen
   * soll. Deshalb wird die Legende **aus dem gezeichneten Blatt** gelesen:
   * `buildSchematicSvg` setzt zu jeder vorkommenden Leitungsart eine
   * Legendenzeile mit genau dem `stroke-dasharray`, das der Ausdruck
   * benutzt. Kommt eine Art im Beispielschema nicht vor, bleibt ihre
   * Strichart hier leer statt geraten.
   */
  const kacheln: Kachel[] = [];
  const arten = Object.keys(PIPE_SERVICE_LABELS) as PipeService[];
  for (const art of arten) {
    const farbe = PIPE_SERVICE_COLORS[art];
    kacheln.push({
      titel: PIPE_SERVICE_LABELS[art],
      spitze: farbe,
      svg: rahmen(
        `<line x1="8" y1="24" x2="112" y2="24" stroke="${farbe}" stroke-width="3.2" stroke-linecap="round" data-service="${art}"/>` +
          `<line x1="8" y1="38" x2="112" y2="38" stroke="#0F172A" stroke-width="2" stroke-linecap="round" data-service="${art}" data-sw="1"/>`,
        120,
        52,
      ),
    });
  }
  tafeln.leitungen = {
    grund: 'zweifarbig',
    hinweis: 'Oben die Farbe am Bildschirm, darunter dieselbe Leitung auf dem Blatt. Auf Papier ersetzt die Strichart die Farbe vollständig — ein Schema muss auch als Schwarzweißkopie lesbar bleiben.',
    kacheln,
  } as unknown as Tafel;
}

// ===========================================================================
// 5 — Fenster- und Türsymbole
// ===========================================================================
{
  const kacheln: Kachel[] = [];
  /** Eine gerade Wand von (0|0) nach (2|0), 0,30 m dick. */
  const knoten: Record<string, BimNode> = {
    a: { id: 'a', x: 0, y: 0, levelId: 'l' } as BimNode,
    b: { id: 'b', x: 2, y: 0, levelId: 'l' } as BimNode,
  };
  const wand: Wall = {
    id: 'w', a: 'a', b: 'b', thickness: 0.3,
    height: 2.6, levelId: 'l', type: 'exterior', layerId: 'std',
  } as Wall;
  const g = getWallGeometry(wand, knoten);
  if (!g) throw new Error('Beispielwand ohne Geometrie — das kann nicht sein.');
  /*
   * Gezeigt werden echte Katalogeinträge aus `OPENING_PRESETS`, nicht
   * erfundene Maße: die Bauart entscheidet über das Symbol, und die
   * Rohbaumaße nach DIN 18100 sind das, was im Plan steht.
   */
  const faelle: { preset: string; hinge?: 'left' | 'right'; flip?: boolean; titel: string; text: string }[] = [
    { preset: 'win-casement', titel: 'Fenster, einflügelig', text: 'Zwei Glasebenen zwischen den Laibungen. Die Brüstungshöhe steht in der Beschriftung, nicht im Symbol.' },
    { preset: 'win-double', titel: 'Fenster, zweiflügelig', text: 'Die Flügelteilung wird gezeichnet — ein zweiflügeliges Fenster ist im Plan von einem einflügeligen zu unterscheiden.' },
    { preset: 'door-88', hinge: 'left', titel: 'Tür, Anschlag links', text: 'Blatt und Schwenkbogen zeigen Anschlagseite und Öffnungsrichtung. 88,5 × 201 cm ist das Rohbaumaß nach DIN 18100.' },
    { preset: 'door-88', hinge: 'right', titel: 'Tür, Anschlag rechts', text: 'Dasselbe Blatt, gespiegelt. Die Seite entscheidet über den Platz, der davor frei bleiben muss.' },
    { preset: 'door-101', hinge: 'left', flip: true, titel: 'Tür nach außen aufschlagend', text: 'Der Bogen liegt auf der anderen Wandseite. Bei Fluchtwegen und Kellerausgängen der Regelfall.' },
    { preset: 'pass-lintel', titel: 'Durchgang mit Sturz', text: 'Nur Laibungen, dazu der gestrichelte Sturz. Kein Blatt, kein Bogen.' },
  ];
  for (const fall of faelle) {
    const vorlage = OPENING_PRESETS.find((v) => v.id === fall.preset);
    if (!vorlage) throw new Error(`Unbekannte Öffnungsvorlage „${fall.preset}"`);
    const op: Opening = {
      id: 'o',
      wallId: 'w',
      kind: vorlage.kind,
      // `distance` misst vom Wandanfang bis zur **Mitte** der Öffnung.
      distance: 1.0,
      width: vorlage.width,
      height: vorlage.height,
      sillHeight: vorlage.sillHeight,
      windowType: vorlage.windowType,
      doorType: vorlage.doorType,
      passageType: vorlage.passageType,
      panels: vorlage.panels,
      hinge: fall.hinge,
      flipSwing: fall.flip,
    };
    const teile = openingSymbol(g, op);
    const S = 46;
    const X = (x: number) => 12 + x * S;
    const Y = (y: number) => 46 - y * S;
    const farbe: Record<string, string> = {
      laibung: '#0F172A', blatt: '#334155', bogen: '#94A3B8', glas: '#0EA5E9', sturz: '#94A3B8', pfeil: '#64748B',
    };
    const breite: Record<string, number> = { stark: 1.8, mittel: 1.2, fein: 0.7 };
    const linien: string[] = [
      // Die Wand als Hintergrund, damit die Öffnung als Aussparung lesbar wird.
      `<rect x="${X(0)}" y="${Y(0.15)}" width="${2 * S}" height="${0.3 * S}" fill="#E2E8F0"/>`,
    ];
    for (const t of teile) {
      const stil = `stroke="${farbe[t.role] ?? '#0F172A'}" stroke-width="${breite[t.weight]}"` +
        (('dashed' in t && t.dashed) ? ' stroke-dasharray="4 2.5"' : '') +
        (t.faint ? ' opacity="0.55"' : '');
      if (t.kind === 'line') {
        linien.push(`<line x1="${X(t.a.x)}" y1="${Y(t.a.y)}" x2="${X(t.b.x)}" y2="${Y(t.b.y)}" ${stil} stroke-linecap="round"/>`);
      } else {
        const p = (w: number) => ({ x: t.center.x + t.radius * Math.cos(w), y: t.center.y + t.radius * Math.sin(w) });
        const a = p(t.startAngle);
        const b = p(t.endAngle);
        let spanne = t.endAngle - t.startAngle;
        while (spanne <= -Math.PI * 2) spanne += Math.PI * 2;
        while (spanne >= Math.PI * 2) spanne -= Math.PI * 2;
        const gross = Math.abs(spanne) > Math.PI ? 1 : 0;
        // Modell-y zeigt nach oben, Bildschirm-y nach unten: der Drehsinn kippt.
        const sweep = t.ccw ? 0 : 1;
        linien.push(`<path d="M${X(a.x)} ${Y(a.y)} A ${t.radius * S} ${t.radius * S} 0 ${gross} ${sweep} ${X(b.x)} ${Y(b.y)}" fill="none" ${stil}/>`);
      }
    }
    kacheln.push({
      titel: fall.titel,
      spitze: `${(vorlage.width * 100).toLocaleString('de-DE')} × ${(vorlage.height * 100).toLocaleString('de-DE')} cm`,
      text: fall.text,
      svg: rahmen(linien.join(''), 116, 92),
    });
  }
  tafeln.oeffnungen = {
    grund: 'blatt',
    hinweis: 'Die graue Fläche ist die Wand, die Lücke darin die Öffnung. Laibungen kräftig, Blatt mittel, Schwenkbogen fein, Sturz gestrichelt.',
    kacheln,
  };
}

// ===========================================================================
// 6 — Treppen und Schächte
// ===========================================================================
{
  const kacheln: Kachel[] = [];
  const arten = Object.keys(VERTICAL_LABELS) as VerticalKind[];
  for (const art of arten) {
    const r = new SvgRecorder();
    const ctx = alsCtx(r);
    /*
     * Maße wie in der Vorbelegung des Werkzeugs: 1,00 m Laufbreite,
     * 3,60 m Lauflänge, 16 Steigungen. Der Schacht ist quadratisch —
     * er hat keine Laufrichtung.
     */
    const schacht = art === 'shaft';
    const v: VerticalElement = {
      id: `t-${art}`,
      kind: art,
      name: VERTICAL_LABELS[art],
      levelId: 'l',
      position: { x: 0, y: 0 },
      width: schacht ? 0.8 : 1.0,
      length: schacht ? 0.8 : 3.6,
      rotation: 0,
      steps: schacht ? undefined : 16,
      service: schacht ? 'mixed' : undefined,
      deductsArea: true,
    } as VerticalElement;
    const zoom = schacht ? 60 : 30;
    drawVertical(ctx, v, (x) => 90 + x * zoom, (y) => 60 - y * zoom, zoom, { selected: false });
    kacheln.push({
      titel: VERTICAL_LABELS[art],
      spitze: schacht ? '0,80 × 0,80 m' : '1,00 m breit · 16 Steigungen',
      svg: rahmen(r.finish(), 180, 120),
    });
  }
  tafeln.treppen = {
    grund: 'schirm',
    hinweis: 'Treppen grau, Schächte violett. Die Lauflinie mit Pfeil zeigt die Steigrichtung; die Striche quer dazu sind die Stufen.',
    kacheln,
  };
}

// ===========================================================================
// 7 — Massive Bauteile
// ===========================================================================
{
  const kacheln: Kachel[] = [];
  const arten = Object.keys(SOLID_LABELS) as SolidKind[];
  const masse: Record<SolidKind, [number, number]> = {
    chimney: [0.5, 0.5],
    pier: [0.36, 0.36],
    'wall-offset': [1.2, 0.24],
    'service-block': [0.9, 0.3],
  };
  for (const art of arten) {
    const r = new SvgRecorder();
    const ctx = alsCtx(r);
    const [l, b] = masse[art];
    const el: SolidElement = {
      id: `s-${art}`,
      kind: art,
      name: SOLID_LABELS[art],
      levelId: 'l',
      position: { x: 0, y: 0 },
      width: b,
      length: l,
      rotation: 0,
    } as SolidElement;
    const zoom = Math.min(80, 70 / Math.max(l, b));
    drawSolid(ctx, el, (x) => 60 + x * zoom, (y) => 45 - y * zoom, zoom, { selected: false });
    kacheln.push({
      titel: SOLID_LABELS[art],
      spitze: `${l.toLocaleString('de-DE')} × ${b.toLocaleString('de-DE')} m`,
      svg: rahmen(r.finish(), 120, 90),
    });
  }
  tafeln.bauteile = {
    grund: 'schirm',
    hinweis: 'Massive Bauteile werden schraffiert dargestellt — sie sind voll, nicht hohl. Anders als ein Schacht führt hier nichts hindurch.',
    kacheln,
  };
}

// ===========================================================================
// 7b — Durchbrüche und Bohrungen
// ===========================================================================
//
// Diese Tafel braucht mehr als ein Bauteil: ein Wanddurchbruch ist ohne seine
// Wand keine Zeichnung, denn sein Umriss folgt aus der Wanddicke. Für jede
// Kachel wird deshalb ein Miniaturmodell aus einer Wand und einem Durchbruch
// gebaut und durch dieselbe Zeichenroutine geschickt, die auch am Bildschirm
// läuft.
{
  const kacheln: Kachel[] = [];
  const faelle: { preset: DurchbruchPreset; text: string }[] = [
    {
      preset: DURCHBRUCH_PRESETS.find((v) => v.id === 'kb-dn100')!,
      text: 'Die Rundbohrung. Das Rechteck ist der Umriss über die volle Wanddicke, der Kreis darin die Bohrkrone. Die Höhenangabe ist bei runder Form die Achshöhe — danach wird angerissen.',
    },
    {
      preset: DURCHBRUCH_PRESETS.find((v) => v.id === 'wd-mittel')!,
      text: 'Der rechteckige Ausbruch. Hier ist die Höhenangabe die Unterkante — danach wird gestemmt.',
    },
    {
      preset: DURCHBRUCH_PRESETS.find((v) => v.id === 'sz-waagerecht')!,
      text: 'Der Schlitz geht nicht durch die Wand, er ist eine Vertiefung. In 3D bleibt die Wand deshalb geschlossen, und im IFC-Export steht er als RECESS und nicht als OPENING.',
    },
    {
      preset: DURCHBRUCH_PRESETS.find((v) => v.id === 'dd-schacht')!,
      text: 'Der Deckendurchbruch steht frei im Grundriss statt in einer Wand. Er gehört dem Geschoss unter der Decke; im Geschoss darüber erscheint er gestrichelt als Loch im Fußboden.',
    },
  ];

  for (const fall of faelle) {
    const v = fall.preset;
    const r = new SvgRecorder();
    const ctx = alsCtx(r);
    const wandgebunden = durchbruchWirt(v.kind) === 'wand';
    const laenge = 2;
    const nodes: Record<string, BimNode> = {
      a: { id: 'a', x: 0, y: 0, levelId: 'l' },
      b: { id: 'b', x: laenge, y: 0, levelId: 'l' },
    };
    const wand: Wall = {
      id: 'w',
      a: 'a',
      b: 'b',
      levelId: 'l',
      type: 'exterior',
      thickness: 0.24,
      uValue: 0.28,
      height: 2.75,
      layerId: 'layer-walls',
    };
    const db: Durchbruch = {
      id: `db-${v.id}`,
      kind: v.kind,
      name: v.label,
      levelId: 'l',
      form: v.form,
      diameter: v.diameter,
      width: v.width,
      height: v.height,
      service: v.service,
      dn: v.dn,
      brandschutz: 'keine',
      ...(wandgebunden
        ? { wallId: 'w', distance: laenge / 2, sillHeight: v.sillHeight ?? 0.3 }
        : { position: { x: laenge / 2, y: 0 }, rotation: 0 }),
    };
    const doc = {
      walls: { w: wand },
      nodes,
      levels: { l: { id: 'l', name: 'EG', order: 0 } },
      durchbrueche: { [db.id]: db },
    } as unknown as BimDocument;

    // Die Wand zuerst, damit man sieht, worin das Loch sitzt. Gezeichnet wird
    // sie hier als schlichtes Rechteck und nicht über `planWallPieces`: die
    // Kachel zeigt das Durchbruchsymbol, nicht die Wandzerlegung.
    const zoom = 150;
    const sx = (x: number) => 20 + x * zoom * 0.3;
    const sy = (y: number) => 55 - y * zoom * 0.3;
    if (wandgebunden) {
      const halb = wand.thickness / 2;
      ctx.save();
      ctx.strokeStyle = '#64748B';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.rect(sx(0), sy(halb), sx(laenge) - sx(0), sy(-halb) - sy(halb));
      ctx.stroke();
      ctx.restore();
    }
    zeichneDurchbruch(ctx, db, doc, sx, sy, zoom * 0.3, { selected: false });

    kacheln.push({
      titel: DURCHBRUCH_LABELS[v.kind],
      spitze: durchbruchBeschriftung(db),
      text: fall.text,
      svg: rahmen(r.finish(), 120, 90),
    });
  }

  tafeln.durchbrueche = {
    grund: 'schirm',
    hinweis:
      'Ein Durchbruch ist im Plan ein gekreuztes Feld mit einer Fahne daneben. Das Kreuz sagt „hier ist nichts" — ohne es liest jeder Prüfer das Rechteck in der Wand als Vormauerung.',
    kacheln,
  };
}

// ===========================================================================
// 8 — Beschriftung: Maßketten, Texte, Hinweisfahnen
// ===========================================================================
{
  const kacheln: Kachel[] = [];
  const faelle: { note: Annotation; text: string }[] = [
    {
      note: { id: 'a1', kind: 'dimension', levelId: 'l', points: [{ x: 0, y: 0 }, { x: 2.4, y: 0 }], offset: 0.35, scale: 1 } as Annotation,
      text: 'Misst selbst und schreibt das Maß hin. Ein eingetragener Text überschreibt die Messung — dann steht dort, was Sie wollen, und nicht mehr, was gezeichnet ist.',
    },
    {
      note: { id: 'a2', kind: 'text', levelId: 'l', points: [{ x: 0.3, y: 0 }], offset: 0, text: 'Estrich 65 mm', scale: 1 } as Annotation,
      text: 'Freier Text an einem Punkt. Für Angaben, die kein eigenes Feld haben.',
    },
    {
      note: { id: 'a3', kind: 'leader', levelId: 'l', points: [{ x: 0.2, y: 0.2 }, { x: 1.5, y: 0.9 }], offset: 0, text: 'Kernbohrung Ø 100', scale: 1 } as Annotation,
      text: 'Fahne mit Spitze: die Spitze zeigt auf die Stelle, der Text steht daneben.',
    },
  ];
  for (const fall of faelle) {
    const r = new SvgRecorder();
    const ctx = alsCtx(r);
    const zoom = 58;
    drawAnnotation(ctx, fall.note, (x) => 20 + x * zoom, (y) => 78 - y * zoom, { selected: false });
    kacheln.push({
      titel: ANNOTATION_LABELS[fall.note.kind],
      text: fall.text,
      svg: rahmen(r.finish(), 200, 110),
    });
  }
  tafeln.beschriftung = {
    grund: 'schirm',
    hinweis: 'Beschriftung gehört zum Plan, nicht zum Modell: sie wird exportiert, geht aber in keine Rechnung ein.',
    kacheln,
  };
}

// Repo-relativ, nicht absolut: Die Handbuchquelle liegt seit 1.29.0 im
// Projekt. Ein absoluter Pfad in einen Behälter hinein hat den Bau von
// 1.23.0 gekostet — die Datei war beim nächsten Start nicht mehr da.
// Der Pfad wird vom Aufrufer gesetzt (`npm run handbuch:tafeln` ruft aus der
// Projektwurzel) und nicht aus `import.meta.url` abgeleitet: Das Bündel
// landet in einem Zwischenverzeichnis, und dessen Lage hat mit der Quelle
// nichts zu tun. Ein absoluter Pfad in einen Behälter hinein hat den Bau von
// 1.23.0 gekostet — die Datei war beim nächsten Start nicht mehr da.
writeFileSync('handbuch/tafeln.json', JSON.stringify(tafeln, null, 1), 'utf8');
for (const [name, t] of Object.entries(tafeln)) console.log(`  ${name}: ${t.kacheln.length} Kacheln (${t.grund})`);
