/**
 * Prüfblock „Die Baugrube".
 *
 * **Warum es diesen Block gibt.** Gemeldet am 27.09.2026: „im 3d modus wenn
 * ich andere stockwerke ausblende will ich auch die raumgeometrie sehen die
 * unterhalb des grundstückes ist, ich sehe nur die umrisse." Das Grundstück
 * ist eine gedeckte Fläche auf der Geländeoberkante; der Keller liegt
 * darunter und war davon verdeckt. Sichtbar blieb allein der Teil der
 * Kellerwände, der über Gelände aufragt — die „Umrisse".
 *
 * Geprüft wird die **Entscheidung**, nicht das Bild: wann gegraben wird und
 * wie groß die Grube ist. Ob das Loch am Ende auch im Rasen ankommt, prüft
 * der Rauchtest `smoke-geschosse.mjs` am Pixel; beides zusammen deckt den
 * Weg ab.
 *
 * Alle Sollwerte sind unten hergeleitet; keiner stammt aus einem Probelauf.
 *
 * **Das Prüfhaus.** Grundriss 10 × 8 m über Wandachsen, Außenwand 36,5 cm.
 * Geschosse: KG bei −2,60 m (lichte Höhe 2,30 m), EG bei ±0,00, OG bei
 * +2,90 m. Geländeoberkante bei −1,45 m — die Kellerwand steckt also zur
 * Hälfte im Erdreich.
 */

import type { CheckFn } from './typ';
import { buildReferenceDocument } from '../reference';
import { ARBEITSRAUM, baugrube } from '../../src/lib/baugrube';
import { levelBaseHeights } from '../../src/lib/levelGeometry';

export function pruefeBaugrube(check: CheckFn): void {
  const doc = buildReferenceDocument();
  const alle = Object.values(doc.levels).sort((a, b) => a.order - b.order);
  const base = levelBaseHeights(alle);
  const waende = Object.values(doc.walls);

  /**
   * Die Grube für eine Auswahl sichtbarer Geschosse.
   *
   * Die Geländeoberkante steht hier **ausgeschrieben** und nicht als
   * Vorgabewert des Parameters: Ein `undefined` an einem Parameter mit
   * Vorgabe wäre wieder die Vorgabe, und genau der Fall „keine
   * Geländeoberkante erfasst" ließe sich damit nicht prüfen.
   */
  const GOK = doc.meta.terrainElevation;
  const fuer = (ids: string[], gelaende: number | undefined) =>
    baugrube({
      levels: alle.filter((l) => ids.includes(l.id)),
      walls: waende.filter((w) => ids.includes(w.levelId)),
      nodes: doc.nodes,
      base,
      gelaende,
    });

  check('Baugrube · das Prüfhaus hat drei Geschosse', alle.map((l) => l.name).join(', '), 'KG, EG, OG');
  check('Baugrube · Geländeoberkante des Prüfhauses', doc.meta.terrainElevation ?? 0, -1.45, 1e-9);
  check('Baugrube · Arbeitsraum', ARBEITSRAUM, 0.5, 1e-9);

  // =========================================================================
  // 1 · Wann der Boden geschlossen bleibt
  // =========================================================================
  {
    /*
     * Das gewohnte Bild: alle drei Geschosse im Bild. Das höchste ist das OG
     * mit Fußboden bei +2,90 m, und +2,90 liegt über −1,45. Es steht also
     * etwas Sichtbares im Freien — es wird nicht gegraben.
     */
    check('Baugrube · alle Geschosse sichtbar: kein Aushub', fuer(['kg', 'eg', 'og'], GOK) === undefined, true);

    /*
     * Keller und Erdgeschoss. Der Fußboden des Erdgeschosses liegt bei
     * ±0,00 und damit 1,45 m über Gelände — dasselbe Ergebnis. Erst das
     * Ausblenden *aller* Geschosse über Gelände öffnet die Grube.
     */
    check('Baugrube · Keller und Erdgeschoss: kein Aushub', fuer(['kg', 'eg'], GOK) === undefined, true);

    /*
     * Ohne erfasste Geländeoberkante ist nicht bekannt, was unter Gelände
     * liegt. Dieselbe Regel wie im Export und in der Raumerkennung: dann
     * wird nichts gerechnet statt etwas geraten.
     */
    check('Baugrube · ohne Geländeoberkante kein Aushub', fuer(['kg'], undefined) === undefined, true);

    /*
     * Gleichstand ist kein „unter Gelände": Liegt die Geländeoberkante auf
     * dem Kellerfußboden (−2,60 m), steht der Keller frei und nicht in einer
     * Grube — ein Haus am Hang, von unten angefahren.
     */
    check('Baugrube · Fußboden auf Geländehöhe: kein Aushub', fuer(['kg'], -2.6) === undefined, true);

    /*
     * Und ohne Wände gibt es nichts, um das herum gegraben werden könnte.
     */
    check(
      'Baugrube · ohne Wände kein Aushub',
      baugrube({ levels: alle, walls: [], nodes: doc.nodes, base, gelaende: -1.45 }) === undefined,
      true,
    );
  }

  // =========================================================================
  // 2 · Die Grube, wenn nur der Keller im Bild steht
  // =========================================================================
  {
    const g = fuer(['kg'], GOK);
    check('Baugrube · nur der Keller: es wird gegraben', g !== undefined, true);
    if (!g) return;

    /*
     * **Die Lage.** Die Außenwände laufen über die Achsen x = 0 und x = 10
     * bei 36,5 cm Wandstärke; ihre Außenkante liegt damit bei
     * 0 − 0,1825 = −0,1825 und 10 + 0,1825 = 10,1825. Dazu der Arbeitsraum
     * von 0,50 m auf jeder Seite:
     *
     *     minX = −0,1825 − 0,50 = −0,6825
     *     maxX = 10,1825 + 0,50 = 10,6825
     *
     * In y dasselbe über die Achsen 0 und 8:
     *
     *     minY = −0,6825      maxY = 8,1825 + 0,50 = 8,6825
     *
     * Die Trennwand bei x = 6 (11,5 cm) liegt innerhalb und verändert
     * daran nichts — eine Innenwand vergrößert keine Baugrube.
     */
    check('Baugrube · westliche Kante', g.minX, -0.6825, 1e-9);
    check('Baugrube · östliche Kante', g.maxX, 10.6825, 1e-9);
    check('Baugrube · südliche Kante', g.minY, -0.6825, 1e-9);
    check('Baugrube · nördliche Kante', g.maxY, 8.6825, 1e-9);

    /*
     * **Die Maße.** 10 m Achsmaß + 2 × 0,1825 m halbe Wandstärke
     * + 2 × 0,50 m Arbeitsraum = 11,365 m. Quer dazu 8 + 0,365 + 1,00 =
     * 9,365 m. Das ist die Zahl, die ein Erdbauer bestellen würde.
     */
    check('Baugrube · Länge', g.maxX - g.minX, 11.365, 1e-9);
    check('Baugrube · Breite', g.maxY - g.minY, 9.365, 1e-9);

    /*
     * **Die Tiefe.** Oben die Geländeoberkante bei −1,45 m, unten der
     * Kellerfußboden bei −2,60 m abzüglich der 25 cm Bodenplatte: −2,85 m.
     * Ausgehoben wird also 1,40 m tief — die Grube reicht unter die Platte,
     * sonst stünde das Haus auf einem Sockel, der im Erdreich steckt.
     */
    check('Baugrube · Oberkante', g.gelaende, -1.45, 1e-9);
    check('Baugrube · Sohle', g.sohle, -2.85, 1e-9);
    check('Baugrube · Aushubtiefe', g.gelaende - g.sohle, 1.4, 1e-9);
  }

  // =========================================================================
  // 3 · Der Arbeitsraum ist das Einzige, was zur Wand hinzukommt
  // =========================================================================
  {
    /*
     * Gegenprobe ohne die Kellerwände, dafür mit denen des Erdgeschosses:
     * Dieselben Achsen, dieselbe Wandstärke — also dieselbe Grube. Das hält
     * fest, dass die Grube am **Grundriss** hängt und nicht am Geschoss,
     * und dass die Höhenlage allein über das *Ob* entscheidet.
     */
    const nurEg = baugrube({
      levels: alle.filter((l) => l.id === 'eg'),
      walls: waende.filter((w) => w.levelId === 'eg'),
      nodes: doc.nodes,
      base,
      // Erdgeschoss bei ±0,00, Gelände bei +1,00 — ein vollständig
      // eingegrabenes Erdgeschoss. Ein erfundener Fall, aber er trennt die
      // beiden Fragen sauber.
      gelaende: 1,
    });
    check('Baugrube · Erdgeschoss unter Gelände: es wird gegraben', nurEg !== undefined, true);
    check('Baugrube · derselbe Grundriss, dieselbe Länge', nurEg?.maxX ?? 0, 10.6825, 1e-9);
    // Sohle: Fußboden ±0,00 minus 25 cm Bodenplatte.
    check('Baugrube · Sohle unter der Bodenplatte', nurEg?.sohle ?? 99, -0.25, 1e-9);
  }
}
