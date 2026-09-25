/**
 * Prüfblock „Auswahlnamen" — steht auf dem Knopf, was er tut?
 *
 * **Warum das geprüft wird und nicht nur gelesen.** Der Entfernen-Knopf im
 * Grundriss ist der einzige Weg, auf dem Tablet etwas wieder loszuwerden.
 * Seine Aufschrift ist damit keine Verzierung, sondern die letzte Auskunft
 * vor einem Eingriff, den man nur über Rückgängig zurückholt. Zwei Dinge
 * dürfen dabei nicht passieren:
 *
 *  1. **Eine Art ohne Namen.** `SelectionKind` wächst mit jeder Fassung, in
 *     der ein neues Bauteil dazukommt. Fehlt dann ein Eintrag, steht auf dem
 *     Knopf `undefined entfernen` — TypeScript fängt das beim vollständigen
 *     Record ab, die Mehrzahlliste ist aber bewusst unvollständig
 *     (`Partial`), und dort fällt es nicht auf. Deshalb hier gezählt.
 *  2. **Eine Zahl, die nicht zur Aufschrift passt.** „3 Wand entfernen"
 *     liest sich wie ein Fehler und ist einer.
 *
 * Alle Sollwerte sind von Hand abgezählt und im Kommentar hergeleitet.
 */

import type { CheckFn } from './typ';
import type { SelectionKind } from '../../src/types/bim';
import { AUSWAHL_NAME, auswahlName, entfernenAufschrift } from '../../src/lib/auswahlNamen';

/*
 * Die Arten, wie sie in `src/types/bim.ts` stehen — von Hand abgeschrieben
 * und nicht aus `AUSWAHL_NAME` abgeleitet. Würde die Liste aus dem Prüfling
 * selbst stammen, prüfte sie sich gegen sich selbst und wäre immer grün.
 *
 * Abgezählt aus der Typdefinition: node, wall, opening, room, trace, image,
 * fixture, vertical, solid, durchbruch, pipe, accessory, annotation,
 * roofOpening, site, heatpump — das sind **16**.
 */
const ARTEN: readonly SelectionKind[] = [
  'node',
  'wall',
  'opening',
  'room',
  'trace',
  'image',
  'fixture',
  'vertical',
  'solid',
  'durchbruch',
  'pipe',
  'accessory',
  'annotation',
  'roofOpening',
  'site',
  'heatpump',
];

export function pruefeAuswahlnamen(check: CheckFn): void {
  // =========================================================================
  // 1 · Vollständigkeit
  // =========================================================================
  {
    check('Auswahlnamen · 16 Arten in der Liste', ARTEN.length, 16);
    check('Auswahlnamen · für jede Art ein Name', Object.keys(AUSWAHL_NAME).length, 16);

    // Kein leerer und kein fehlender Eintrag — in Einzahl wie in Mehrzahl.
    const ohneEinzahl = ARTEN.filter((k) => !AUSWAHL_NAME[k]).length;
    const ohneMehrzahl = ARTEN.filter((k) => !auswahlName(k, 2)).length;
    check('Auswahlnamen · keine Art ohne Einzahl', ohneEinzahl, 0);
    check('Auswahlnamen · keine Art ohne Mehrzahl', ohneMehrzahl, 0);
  }

  // =========================================================================
  // 2 · Einzahl und Mehrzahl
  // =========================================================================
  {
    /*
     * Die Mehrzahl ist im Deutschen unregelmäßig; eine Regel („+ e") machte
     * aus „Wand" ein „Wande". Geprüft werden die drei Muster, die in der
     * Liste vorkommen: Umlaut (Wand → Wände), Endung (Leitung → Leitungen)
     * und unverändert (Dachfenster → Dachfenster).
     */
    check('Auswahlnamen · Wand in Einzahl', auswahlName('wall'), 'Wand');
    check('Auswahlnamen · Wand in Mehrzahl', auswahlName('wall', 3), 'Wände');
    check('Auswahlnamen · Leitung in Mehrzahl', auswahlName('pipe', 2), 'Leitungen');
    check('Auswahlnamen · Dachfenster bleibt gleich', auswahlName('roofOpening', 4), 'Dachfenster');

    // Die Vorgabe ist die Einzahl: `auswahlName(k)` ohne Zahl.
    check('Auswahlnamen · ohne Zahl ist Einzahl', auswahlName('room'), 'Raum');
  }

  // =========================================================================
  // 3 · Die Aufschrift des Knopfes
  // =========================================================================
  {
    // Ein Bauteil: Name plus „entfernen", keine Zahl. Eine „1" davor sagt
    // nichts, was man nicht sieht.
    check('Auswahlnamen · eine Wand', entfernenAufschrift(['wall']), 'Wand entfernen');

    // Mehrere derselben Art: Zahl plus Mehrzahl.
    check('Auswahlnamen · drei Wände', entfernenAufschrift(['wall', 'wall', 'wall']), '3 Wände entfernen');
    check('Auswahlnamen · zwei Leitungen', entfernenAufschrift(['pipe', 'pipe']), '2 Leitungen entfernen');

    /*
     * Gemischt: „Bauteile". Eine Aufzählung („2 Wände, 1 Tür, 1 Leitung")
     * wäre länger als der Knopf breit ist und wüchse mit jeder Auswahl.
     * Abgezählt: wall, opening, pipe, fixture — vier Einträge.
     */
    check(
      'Auswahlnamen · gemischt sind Bauteile',
      entfernenAufschrift(['wall', 'opening', 'pipe', 'fixture']),
      '4 Bauteile entfernen',
    );

    // Zwei verschiedene Arten sind schon gemischt — die Einheitlichkeit wird
    // über *alle* Einträge geprüft, nicht über die ersten beiden.
    check('Auswahlnamen · zwei Arten sind gemischt', entfernenAufschrift(['wall', 'pipe']), '2 Bauteile entfernen');
    check(
      'Auswahlnamen · gleich, gleich, anders ist gemischt',
      entfernenAufschrift(['wall', 'wall', 'pipe']),
      '3 Bauteile entfernen',
    );

    // Der leere Fall wirft nicht, sondern fällt auf das schlichte Wort
    // zurück. Angezeigt wird er nie — die Leiste erscheint ohne Auswahl gar
    // nicht —, aber ein Knopf darf die Ansicht nicht mitreißen.
    check('Auswahlnamen · leer wirft nicht', entfernenAufschrift([]), 'Entfernen');
  }

  // =========================================================================
  // 4 · Keine Aufschrift ohne Verb
  // =========================================================================
  {
    /*
     * Jede Art muss als Knopfaufschrift auf „entfernen" enden. Das ist die
     * Zusicherung, auf die sich der Rauchtest stützt, wenn er den Knopf über
     * seinen Text sucht: Er findet ihn über „entfernen", unabhängig davon,
     * was ausgewählt war.
     */
    const ohneVerb = ARTEN.filter((k) => !entfernenAufschrift([k]).endsWith(' entfernen')).length;
    check('Auswahlnamen · jede Art endet auf „entfernen"', ohneVerb, 0);

    // Und in der Mehrzahl ebenso — 16 Arten, jede mit zwei Einträgen.
    const ohneVerbMehr = ARTEN.filter((k) => !entfernenAufschrift([k, k]).endsWith(' entfernen')).length;
    check('Auswahlnamen · auch in der Mehrzahl', ohneVerbMehr, 0);

    // Die Zahl steht vorn, sobald es mehr als eines ist.
    const ohneZahl = ARTEN.filter((k) => !entfernenAufschrift([k, k]).startsWith('2 ')).length;
    check('Auswahlnamen · Mehrzahl beginnt mit der Zahl', ohneZahl, 0);
  }
}
