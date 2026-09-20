/**
 * Prüfblock „Rohrbezeichnung" — heißt die Leitung im Plan so, wie sie
 * bestellt wird?
 * ---------------------------------------------------------------------------
 * **Der Anlass.** Im Sanierungsplan stand am Heizkörper „DN 12". Der
 * Einwand aus der Praxis kam sofort: *in der Heizung wird kein Heizkörper
 * mit 12 angeschlossen.* Der Einwand stimmt — und das Rohr stimmte
 * trotzdem. Die Beschriftung war das Problem.
 *
 * **Die Rechnung dahinter, von Hand.** `hydraulics.ts` ordnet jeder
 * Abmessung die Nennweite mit dem geringsten Abstand zum lichten
 * Innendurchmesser zu, d_i = d_a − 2·s:
 *
 * | Rohr        | d_i             | Abstand zu DN …            | → DN |
 * |-------------|-----------------|----------------------------|------|
 * | Cu 15 × 1   | 15 − 2 = 13     | 12 → 1   ·  15 → 2         | 12   |
 * | Cu 18 × 1   | 18 − 2 = 16     | 15 → 1   ·  20 → 4         | 15   |
 * | Cu 22 × 1   | 22 − 2 = 20     | 20 → 0                     | 20   |
 * | Cu 28 × 1,5 | 28 − 3 = 25     | 25 → 0                     | 25   |
 * | Cu 35 × 1,5 | 35 − 3 = 32     | 32 → 0                     | 32   |
 * | Cu 42 × 1,5 | 42 − 3 = 39     | 40 → 1   ·  32 → 7         | 40   |
 * | MSV 16 × 2  | 16 − 4 = 12     | 12 → 0                     | 12   |
 * | MSV 20 × 2  | 20 − 4 = 16     | 15 → 1   ·  20 → 4         | 15   |
 * | MSV 26 × 3  | 26 − 6 = 20     | 20 → 0                     | 20   |
 * | MSV 32 × 3  | 32 − 6 = 26     | 25 → 1   ·  32 → 6         | 25   |
 *
 * Zwei verschiedene Rohre landen also auf **derselben** Nennweite 12, und
 * keines der beiden ist ein „12er". Deshalb ist DN im Plan die falsche
 * Angabe: Sie ist nicht eindeutig und sie ist nicht bestellbar.
 *
 * **Die Gegenrichtung, die dieser Block ebenfalls festhält:** Die kleinste
 * Zeile beider Tabellen *ist* bereits das Handwerksmindestmaß. Es gibt in
 * `COPPER_PIPES` kein 12 × 1 und in `MULTILAYER_PIPES` kein 12 × 2. Der
 * Rohrausleger konnte also nie etwas unterschreiten, was am Heizkörper
 * nicht verbaut wird — eine Mindestgrößenregel wäre eine Prüfung auf einen
 * Fall, den es nicht geben kann. Sollte jemand die Tabelle nach unten
 * erweitern, fällt genau diese Prüfung, und dann ist die Regel fällig.
 *
 * **Und der Rückfall.** Eine von Hand gezogene Leitung trägt weder
 * Werkstoff noch Außendurchmesser. Sie behält „DN 20" — sichtbar und nicht
 * stillschweigend, damit man erkennt, dass dort noch nichts festgelegt ist.
 * Ein erfundenes Maß wäre hier der schlimmere Fehler: Nach einer Abmessung
 * im Plan wird bestellt, nach einer Nennweite fragt man nach.
 */

import { COPPER_PIPES, MULTILAYER_PIPES, PIPE_TABLES } from '../../src/lib/hydraulics';
import {
  WERKSTOFF_KUERZEL,
  handelsmass,
  rohrbezeichnung,
  rohrbezeichnungLang,
} from '../../src/lib/rohrbezeichnung';
import type { CheckFn } from './typ';

export function pruefeRohrbezeichnung(check: CheckFn): void {
  // =========================================================================
  // 1 · Die Zuordnung, die den Einwand ausgelöst hat
  // =========================================================================
  {
    const cu15 = { nominalDiameter: 12, outerDiameter: 15, material: 'kupfer' as const };
    const msv16 = { nominalDiameter: 12, outerDiameter: 16, material: 'verbund' as const };

    check('Cu 15 × 1 heißt im Plan nicht mehr „DN 12"', rohrbezeichnung(cu15), 'Cu 15 × 1');
    check('MSV 16 × 2 ebenso wenig', rohrbezeichnung(msv16), 'MSV 16 × 2');

    /*
     * Der Kern des Befunds: Beide tragen dieselbe Nennweite und sind
     * verschiedene Rohre. Fiele diese Prüfung, wäre die Nennweite im Plan
     * doch eindeutig — und die ganze Änderung überflüssig.
     */
    check('Beide haben dieselbe Nennweite', cu15.nominalDiameter === msv16.nominalDiameter, true);
    check('… und trotzdem verschiedene Namen', rohrbezeichnung(cu15) !== rohrbezeichnung(msv16), true);

    // Für Inspektor und Legende steht beides nebeneinander: das Rohr wird
    // nach der Abmessung bestellt, das Ventil davor nach der Nennweite.
    check('Lange Form nennt beide Zahlen', rohrbezeichnungLang(cu15), 'Cu 15 × 1 · DN 12');
  }

  // =========================================================================
  // 2 · Die Tabelle, Zeile für Zeile — Sollwerte aus dem Kopf dieser Datei
  // =========================================================================
  {
    const erwartet: [number, string, number][] = [
      [15, 'Cu 15 × 1', 12],
      [18, 'Cu 18 × 1', 15],
      [22, 'Cu 22 × 1', 20],
      [28, 'Cu 28 × 1,5', 25],
      [35, 'Cu 35 × 1,5', 32],
      [42, 'Cu 42 × 1,5', 40],
    ];
    for (const [aussen, name, dn] of erwartet) {
      const zeile = COPPER_PIPES.find((d) => d.outer === aussen);
      check(`Kupfer ${aussen}: Nennweite`, zeile?.dn ?? -1, dn);
      check(`Kupfer ${aussen}: Bezeichnung`, rohrbezeichnung({ nominalDiameter: dn, outerDiameter: aussen, material: 'kupfer' }), name);
    }

    const verbund: [number, string, number][] = [
      [16, 'MSV 16 × 2', 12],
      [20, 'MSV 20 × 2', 15],
      [26, 'MSV 26 × 3', 20],
      [32, 'MSV 32 × 3', 25],
    ];
    for (const [aussen, name, dn] of verbund) {
      const zeile = MULTILAYER_PIPES.find((d) => d.outer === aussen);
      check(`Verbund ${aussen}: Nennweite`, zeile?.dn ?? -1, dn);
      check(`Verbund ${aussen}: Bezeichnung`, rohrbezeichnung({ nominalDiameter: dn, outerDiameter: aussen, material: 'verbund' }), name);
    }
  }

  // =========================================================================
  // 3 · Das Mindestmaß steht in der Tabelle, nicht in einer Regel
  // =========================================================================
  {
    const kleinstesCu = Math.min(...COPPER_PIPES.map((d) => d.outer));
    const kleinstesMsv = Math.min(...MULTILAYER_PIPES.map((d) => d.outer));
    check('Kupfer beginnt beim Heizkörpermaß 15', kleinstesCu, 15);
    check('Verbund beginnt beim Heizkörpermaß 16', kleinstesMsv, 16);
    // Ein 12er im Heizungsrohrkatalog gäbe es nicht — und wenn doch, muss
    // an dieser Stelle jemand nachdenken.
    check('Kein Kupferrohr unter 15', COPPER_PIPES.some((d) => d.outer < 15), false);
    check('Kein Verbundrohr unter 16', MULTILAYER_PIPES.some((d) => d.outer < 16), false);
  }

  // =========================================================================
  // 4 · Der Rückfall — lieber sperrig als erfunden
  // =========================================================================
  {
    check('Ohne Werkstoff bleibt die Nennweite', rohrbezeichnung({ nominalDiameter: 20 }), 'DN 20');
    check('Ohne Außenmaß ebenso', rohrbezeichnung({ nominalDiameter: 25, material: 'kupfer' }), 'DN 25');
    // 17 mm gibt es in keiner Kupferzeile. Ein „nächstgelegenes" Maß zu
    // wählen hieße, eine Abmessung zu erfinden, nach der bestellt wird.
    check('Unbekanntes Außenmaß wird nicht gerundet', rohrbezeichnung({ nominalDiameter: 15, outerDiameter: 17, material: 'kupfer' }), 'DN 15');
    check('handelsmass meldet das offen', handelsmass('kupfer', 17) === undefined, true);
    check('… und liefert für 15 ein Maß', handelsmass('kupfer', 15) ?? '—', '15 × 1');
    // Die lange Form darf im Rückfall nicht „DN 20 · DN 20" ergeben.
    check('Lange Form doppelt die Nennweite nicht', rohrbezeichnungLang({ nominalDiameter: 20 }), 'DN 20');

    /*
     * Der Rückfallwerkstoff aus den Projekteinstellungen greift nur, wenn
     * am Abschnitt keiner steht — sonst gilt der Abschnitt. Andernfalls
     * würde eine Voreinstellung eine erfasste Angabe überschreiben.
     */
    check('Projektwerkstoff greift beim Rückfall', rohrbezeichnung({ nominalDiameter: 12, outerDiameter: 15 }, 'kupfer'), 'Cu 15 × 1');
    check('… aber nie gegen den Abschnitt', rohrbezeichnung({ nominalDiameter: 12, outerDiameter: 16, material: 'verbund' }, 'kupfer'), 'MSV 16 × 2');
  }

  // =========================================================================
  // 5 · Jeder Werkstoff hat ein Kürzel, und jedes Kürzel ist eindeutig
  // =========================================================================
  {
    const werkstoffe = Object.keys(PIPE_TABLES) as (keyof typeof PIPE_TABLES)[];
    check('Für jeden Werkstoff gibt es ein Kürzel', werkstoffe.every((m) => !!WERKSTOFF_KUERZEL[m]), true);
    const kuerzel = werkstoffe.map((m) => WERKSTOFF_KUERZEL[m]);
    check('Kein Kürzel doppelt', new Set(kuerzel).size, kuerzel.length);
    // Sechs Werkstoffe: Kupfer, Stahl, Edelstahl, PE-Xa, Verbund, PP-R.
    check('Sechs Werkstoffe', werkstoffe.length, 6);
    check('Jede Tabelle trägt Zeilen', werkstoffe.every((m) => PIPE_TABLES[m].length > 0), true);
  }
}
