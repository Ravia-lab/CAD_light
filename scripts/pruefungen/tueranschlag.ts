/**
 * Prüfblock „Türanschlag" — wohin die Tür aufgeht, in Worten.
 *
 * **Warum eine Benennung geprüft gehört.** Sie ist keine Zierde: Nach ihr
 * wird bestellt. Wer „DIN links" auf den Aufmaßzettel schreibt und eine Tür
 * DIN rechts geliefert bekommt, hat ein Bauteil, das nicht passt, und einen
 * Termin, der platzt. Anschlagseite und Öffnungsrichtung gehen in keine
 * Rechnung ein — aber sie gehen auf die Baustelle, und dort sind sie so hart
 * wie eine Zahl.
 *
 * Geprüft wird beides, was auseinanderfallen kann:
 *
 *  1. **die Seite** — welcher Raum links, welcher rechts der Wandachse liegt
 *     und wie die Oberfläche ihn nennt;
 *  2. **die DIN-Bezeichnung** — sie folgt aus Bandseite *und*
 *     Öffnungsrichtung zusammen und ist gerade nicht dasselbe wie das, was
 *     die Oberfläche seit jeher „Anschlag links/rechts" nennt.
 *
 * Dazu eine dritte Prüfung, die die beiden Seiten des Programms
 * zusammenhält: **Zeichnung und Benennung müssen dieselbe Seite meinen.**
 * `openingSymbols.ts` legt das offene Blatt bei `s = swing · Breite` ab,
 * `tuerseiten.ts` liest `flipSwing` als Seitenwahl. Zwischen beiden steht
 * genau ein Vorzeichen. Dreht es jemand um, sagt die Oberfläche „öffnet nach
 * Bad", und der Plan zeigt die Tür ins Wohnzimmer schwingen — ein Fehler, den
 * keine Typprüfung findet und den man auf dem Papier erst sieht, wenn die
 * Zarge schon bestellt ist.
 *
 * Alle Sollwerte sind von Hand gerechnet; sie stehen unten bei der jeweiligen
 * Prüfung mit ihrer Herleitung.
 */

import type { BimNode, Opening, Room, Wall } from '../../src/types/bim';
import { getWallGeometry } from '../../src/lib/wallGeometry';
import { openingSymbol } from '../../src/lib/openingSymbols';
import { tueranschlag } from '../../src/lib/tuerseiten';
import type { CheckFn } from './typ';

/*
 * Der Prüfgrundriss.
 * ---------------------------------------------------------------------------
 * Eine Wand von a(0,0) nach b(6,0), also in +x. Die Linksnormale zeigt damit
 * nach **+y** — das ist in diesem Block durchgehend die „Plus-Seite".
 *
 *        Nord  (y > 0)          ← Plus-Seite, Linksnormale (0, 1)
 *   a ──────────────────── b    Wand auf y = 0, Dicke 0,115 m
 *        Süd   (y < 0)          ← Minus-Seite
 */
const nodes: Record<string, BimNode> = {
  a: { id: 'a', x: 0, y: 0, levelId: 'eg' } as BimNode,
  b: { id: 'b', x: 6, y: 0, levelId: 'eg' } as BimNode,
};

const innenwand = {
  id: 'trenn',
  levelId: 'eg',
  a: 'a',
  b: 'b',
  thickness: 0.115,
  height: 2.5,
  type: 'interior',
  layerId: 'layer-walls',
} as unknown as Wall;

const aussenwand = { ...innenwand, id: 'aussen', type: 'exterior' } as unknown as Wall;

const raum = (id: string, name: string, y0: number, y1: number): Room =>
  ({
    id,
    name,
    usage: 'other',
    levelId: 'eg',
    area: 6 * (y1 - y0),
    innerPolygon: [
      { x: 0.1, y: y0 },
      { x: 5.9, y: y0 },
      { x: 5.9, y: y1 },
      { x: 0.1, y: y1 },
    ],
    boundaries: [],
  }) as unknown as Room;

const nord = raum('r-nord', 'Wohnen', 0.1, 4);
const sued = raum('r-sued', 'Bad', -4, -0.1);

const tuer = (patch: Partial<Opening> = {}): Opening =>
  ({
    id: 'o-1',
    wallId: 'trenn',
    kind: 'door',
    distance: 3,
    width: 1,
    height: 2.01,
    sillHeight: 0,
    hinge: 'left',
    ...patch,
  }) as unknown as Opening;

export function pruefeTueranschlag(check: CheckFn): void {
  // =========================================================================
  // 1 · Welche Seite ist welche
  // =========================================================================
  {
    const a = tueranschlag(tuer(), innenwand, nodes, [nord, sued]);
    check('Eine Tür liefert einen Anschlag', a !== null, true);
    if (!a) return;

    // Die Linksnormale zu (1,0) ist (0,1): Der Prüfpunkt liegt bei
    // y = +(0,0575 + 0,30) = +0,3575 und damit im Nordraum.
    check('Plus-Seite ist der Nordraum', a.plus.art === 'raum' && a.plus.name, 'Wohnen');
    check('Minus-Seite ist der Südraum', a.minus.art === 'raum' && a.minus.name, 'Bad');
    check('Beschriftung nennt den Raum', a.beschriftung.plus, 'Wohnen');
    check('Beschriftung der Gegenseite', a.beschriftung.minus, 'Bad');
  }

  // =========================================================================
  // 2 · Öffnungsrichtung: `flipSwing` wählt die Seite
  // =========================================================================
  {
    const ohne = tueranschlag(tuer({ flipSwing: false }), innenwand, nodes, [nord, sued]);
    const mit = tueranschlag(tuer({ flipSwing: true }), innenwand, nodes, [nord, sued]);
    check('Ohne flipSwing öffnet sie zur Linksnormalen', ohne?.oeffnetNach ?? '', 'plus');
    check('Mit flipSwing zur anderen Seite', mit?.oeffnetNach ?? '', 'minus');
    check('Der Satz nennt das Ziel', ohne?.satz ?? '', 'DIN rechts, öffnet nach Wohnen');
    check('Und auf der Gegenseite', mit?.satz ?? '', 'DIN links, öffnet nach Bad');
  }

  // =========================================================================
  // 3 · DIN 107 — alle vier Kombinationen von Hand
  // =========================================================================
  {
    /*
     * Hergeleitet (siehe `tuerseiten.ts`): Der Betrachter steht auf der
     * Öffnungsseite σ und sieht zur Wand; seine linke Hand zeigt dann in
     * Richtung σ·dir. Das Band sitzt bei `hinge === 'right'` am Ende der
     * Öffnung, also in +dir.
     *
     *   Band am Ende (hinge 'right') + öffnet nach plus  → Band links  → DIN links
     *   Band am Anfang (hinge 'left') + öffnet nach plus → Band rechts → DIN rechts
     *   Band am Ende + öffnet nach minus                 → DIN rechts
     *   Band am Anfang + öffnet nach minus               → DIN links
     */
    const din = (hinge: 'left' | 'right', flip: boolean) =>
      tueranschlag(tuer({ hinge, flipSwing: flip }), innenwand, nodes, [nord, sued])?.din ?? '';
    check('Band rechts, öffnet nach plus → DIN links', din('right', false), 'links');
    check('Band links, öffnet nach plus → DIN rechts', din('left', false), 'rechts');
    check('Band rechts, öffnet nach minus → DIN rechts', din('right', true), 'rechts');
    check('Band links, öffnet nach minus → DIN links', din('left', true), 'links');
  }

  // =========================================================================
  // 4 · Wo kein Raum ist: außen oder offen — aber nichts Erfundenes
  // =========================================================================
  {
    const anAussenwand = tueranschlag(
      tuer({ wallId: 'aussen' }),
      aussenwand,
      nodes,
      [nord], // südlich liegt kein Raum
    );
    check('An der Außenwand heißt die leere Seite „außen"', anAussenwand?.beschriftung.minus ?? '', 'außen');
    check('Die Raumseite behält ihren Namen', anAussenwand?.beschriftung.plus ?? '', 'Wohnen');

    const anInnenwand = tueranschlag(tuer(), innenwand, nodes, [nord]);
    // Eine Innenwand ohne Raum dahinter: Das kann ein noch nicht
    // geschlossener Flur sein. Darüber wird nichts behauptet — und schon gar
    // nicht „außen". Genannt wird stattdessen die Himmelsrichtung: Die
    // Minus-Seite zeigt nach −y, also nach Süden.
    check('An der Innenwand bleibt die leere Seite unbenannt', anInnenwand?.minus.art ?? '', 'offen');
    check('Und trägt ihre Himmelsrichtung', anInnenwand?.beschriftung.minus ?? '', 'Süden');

    /*
     * Der Fall, an dem die naheliegende Regel zerbricht: eine Außenwand,
     * hinter der die Raumerkennung (noch) nichts geschlossen hat. „Außenwand
     * und kein Raum, also außen" wäre hier für **beide** Seiten wahr — und
     * damit auch für die Wohnzimmerseite. Gesagt wird deshalb nur, was
     * feststeht: die Richtung.
     */
    const ohneRaeume = tueranschlag(tuer({ wallId: 'aussen' }), aussenwand, nodes, []);
    check('Ohne Raum wird keine Seite „außen" genannt', ohneRaeume?.plus.art ?? '', 'offen');
    check('Die Plus-Seite zeigt nach Norden', ohneRaeume?.beschriftung.plus ?? '', 'Norden');
    check('Die Minus-Seite nach Süden', ohneRaeume?.beschriftung.minus ?? '', 'Süden');
  }

  // =========================================================================
  // 5 · Fenster und Durchgänge schlagen nicht auf
  // =========================================================================
  {
    const fenster = tueranschlag(tuer({ kind: 'window' }), innenwand, nodes, [nord, sued]);
    check('Ein Fenster hat keinen Anschlag', fenster, null as unknown as string);
    const durchgang = tueranschlag(tuer({ kind: 'passage' }), innenwand, nodes, [nord, sued]);
    check('Ein Durchgang auch nicht', durchgang, null as unknown as string);
  }

  // =========================================================================
  // 6 · Zeichnung und Benennung meinen dieselbe Seite
  // =========================================================================
  {
    const g = getWallGeometry(innenwand, nodes);
    check('Wandgeometrie vorhanden', g !== null, true);
    if (!g) return;

    /**
     * Die Seite, auf der das offene Blatt liegt, aus dem gezeichneten Symbol
     * zurückgerechnet: Vorzeichen des Skalarprodukts (Blattende − Band) · n.
     */
    const blattseite = (op: Opening): number => {
      const teile = openingSymbol(g, op);
      const blatt = teile.find((t) => t.kind === 'line' && t.role === 'blatt');
      if (!blatt || blatt.kind !== 'line') return 0;
      const dx = blatt.b.x - blatt.a.x;
      const dy = blatt.b.y - blatt.a.y;
      return Math.sign(dx * g.normal.x + dy * g.normal.y);
    };

    // Ohne `flipSwing` liegt das offene Blatt auf der Seite der
    // Linksnormalen — und genau diese Seite nennt `tuerseiten` „plus".
    check('Gezeichnet: Blatt ohne flipSwing auf der Plus-Seite', blattseite(tuer({ flipSwing: false })), 1);
    check('Gezeichnet: Blatt mit flipSwing auf der Minus-Seite', blattseite(tuer({ flipSwing: true })), -1);
    check(
      'Benannt: dieselbe Seite wie gezeichnet',
      tueranschlag(tuer({ flipSwing: false }), innenwand, nodes, [nord, sued])?.oeffnetNach ?? '',
      'plus',
    );
  }
}
