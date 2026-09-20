/**
 * Prüfblock „Sprache" — die Schranke um die Fachbegriffe.
 * ---------------------------------------------------------------------------
 * **Was hier wirklich geprüft wird.** Nicht, ob eine Übersetzung schön ist
 * — das kann keine Prüfung. Sondern die drei Zusagen, deren Bruch niemandem
 * auffiele, bis es zu spät ist:
 *
 *  1. **Der Fachbegriff bleibt deutsch.** „Vorlauf" steht auf dem
 *     Lieferschein, der Großhändler sagt „Vorlauf", der Bauleiter fragt
 *     nach dem „Vorlauf". Übersetzte die Software ihn, machte sie den
 *     Monteur in der Software mündig und auf der Baustelle stumm. Diese
 *     Prüfung hält jeden Katalog gegen die Schutzliste und fällt, sobald
 *     jemand — auch gutmeinend — einen dieser Begriffe übersetzt.
 *  2. **Fehlt eine Übersetzung, kommt der deutsche Satz.** Nicht ein
 *     Platzhalter, nicht ein Schlüsselname, nicht eine leere Zeile. Der
 *     Satz ist dann nie falsch, nur noch nicht übersetzt — und das ist in
 *     einem Werkzeug, aus dem eine Heizlast fällt, der einzige vertretbare
 *     Zwischenzustand.
 *  3. **Eine unbekannte Sprache fällt auf Deutsch zurück**, statt eine
 *     leere Oberfläche zu zeigen.
 */

import {
  FACHBEGRIFFE,
  SPRACHEN,
  fach,
  istFachbegriff,
  schluessel,
  spracheHolen,
  spracheSetzen,
  t,
  RECHTS_NACH_LINKS,
  type Sprache,
} from '../../src/lib/sprache';
import { KATALOGE } from '../../src/lib/sprachen/katalog';
import type { CheckFn } from './typ';

export function pruefeSprache(check: CheckFn): void {
  const vorher = spracheHolen();

  // =========================================================================
  // 1 · Die Liste der Sprachen
  // =========================================================================
  {
    check('Achtzehn Sprachen', SPRACHEN.length, 18);
    check('Deutsch steht zuerst', SPRACHEN[0]?.code ?? '—', 'de');
    const codes = SPRACHEN.map((s) => s.code);
    check('Keine Sprache doppelt', new Set(codes).size, codes.length);
    check('Jede trägt ihren Eigennamen', SPRACHEN.every((s) => s.eigenname.length > 1), true);
    // Der Eigenname ist der Punkt: „Русский", nicht „Russisch". Wäre er
    // gleich dem deutschen Namen, stünde in der Auswahl zweimal dasselbe.
    check('Russisch steht kyrillisch da', SPRACHEN.find((s) => s.code === 'ru')?.eigenname ?? '—', 'Русский');
    check('Türkisch mit ç', SPRACHEN.find((s) => s.code === 'tr')?.eigenname ?? '—', 'Türkçe');
    check('Griechisch in griechischer Schrift', SPRACHEN.find((s) => s.code === 'el')?.eigenname ?? '—', 'Ελληνικά');
    check('Arabisch in arabischer Schrift', SPRACHEN.find((s) => s.code === 'ar')?.eigenname ?? '—', 'العربية');
    /*
     * **Die Reihenfolge ist nicht alphabetisch, und das ist Absicht.** Oben
     * stehen die Sprachen, die im deutschen Bauhandwerk am häufigsten
     * vorkommen. Alphabetisch sortiert stünde Albanisch vor Türkisch — und
     * der häufigste Fall hätte den längsten Weg.
     */
    check('Türkisch steht gleich hinter Deutsch', SPRACHEN[1]?.code ?? '—', 'tr');
    check('Albanisch steht nicht vorn', SPRACHEN.findIndex((s) => s.code === 'sq') > 5, true);

    /*
     * Arabisch wird von rechts nach links geschrieben — und das ist mehr
     * als eine Übersetzung: Leisten, Beschriftungen, Maßketten, die ganze
     * Anordnung kehren sich um. Solange dieser Durchgang nicht gemacht ist,
     * steht die Sprache in der Liste, aber die Leserichtung wird **nicht**
     * umgestellt. Eine halb gespiegelte Oberfläche ist schlechter zu
     * bedienen als eine, die konsequent in der falschen Richtung läuft.
     */
    check('Arabisch ist als rechtsläufig vermerkt', RECHTS_NACH_LINKS.includes('ar'), true);
    check('Und sonst nichts', RECHTS_NACH_LINKS.length, 1);
    check('Jede nicht-deutsche Sprache hat einen Katalog',
      SPRACHEN.filter((s) => s.code !== 'de').every((s) => !!KATALOGE[s.code]), true);
    // Deutsch bekommt **keinen** Katalog: Der deutsche Text ist der
    // Schlüssel. Ein deutscher Katalog wäre eine Tabelle, die jeden Satz
    // auf sich selbst abbildet — und eine zweite Stelle, an der derselbe
    // Satz anders stehen könnte als im Quelltext.
    check('Deutsch hat keinen Katalog', KATALOGE.de === undefined, true);
  }

  // =========================================================================
  // 2 · Der Rückfall auf Deutsch
  // =========================================================================
  {
    spracheSetzen('de');
    check('Auf Deutsch kommt der Text unverändert', t('Wand zeichnen'), 'Wand zeichnen');

    spracheSetzen('tr');
    check('Die Sprache ist umgestellt', spracheHolen(), 'tr');
    // Der Katalog ist leer — also muss der deutsche Satz kommen, und zwar
    // vollständig. Käme hier ein leerer String, stünde in der Oberfläche
    // ein leerer Knopf, und niemand wüsste warum.
    check('Ohne Eintrag kommt der deutsche Satz', t('Wand zeichnen'), 'Wand zeichnen');
    check('Und er ist nicht leer', t('Wand zeichnen').length > 0, true);

    spracheSetzen('xx' as Sprache);
    check('Eine unbekannte Sprache fällt auf Deutsch zurück', spracheHolen(), 'de');
  }

  // =========================================================================
  // 3 · Der Zusammenhang trennt gleiche Wörter
  // =========================================================================
  {
    // „Decke" ist ein Bauteil und ein Möbelstück. Ohne Zusammenhang wären
    // beide derselbe Eintrag — und eine Sprache, die dafür zwei Wörter hat,
    // bekäme in einem der beiden Fälle das falsche.
    const a = schluessel('Decke', 'Bauteil');
    const b = schluessel('Decke', 'Textil');
    const c = schluessel('Decke');
    check('Zwei Zusammenhänge, zwei Schlüssel', a !== b, true);
    check('Ohne Zusammenhang ein dritter', c !== a && c !== b, true);
    // Das Trennzeichen kommt in keinem Oberflächentext vor und kann
    // deshalb keinen Text zerschneiden.
    check('Getrennt wird mit einem Nullzeichen', a.includes('\u0000'), true);
    check('Kein Katalogeintrag enthält es im Klartext',
      Object.values(KATALOGE).every((k) => Object.values(k ?? {}).every((v) => !v.includes('\u0000'))), true);
  }

  // =========================================================================
  // 4 · Die Schranke: Fachbegriffe werden nicht übersetzt
  // =========================================================================
  {
    check('Die Schutzliste ist nicht leer', FACHBEGRIFFE.length > 30, true);
    check('„Vorlauf" steht darin', istFachbegriff('Vorlauf'), true);
    check('„Heizlast" ebenso', istFachbegriff('Heizlast'), true);
    check('Leerzeichen stören nicht', istFachbegriff('  U-Wert  '), true);
    check('Ein gewöhnlicher Satz steht nicht darin', istFachbegriff('Wand zeichnen'), false);

    /*
     * Die eigentliche Schranke. Sie wird fallen, sobald jemand einen
     * Fachbegriff in einen Katalog schreibt — und genau dann soll sie
     * fallen, auch wenn die Übersetzung sprachlich richtig ist.
     */
    const verstoesse: string[] = [];
    for (const [code, katalog] of Object.entries(KATALOGE)) {
      for (const key of Object.keys(katalog ?? {})) {
        const text = key.split('\u0000')[0];
        if (istFachbegriff(text)) verstoesse.push(`${code}: „${text}"`);
      }
    }
    check('Kein Fachbegriff wird übersetzt', verstoesse.join(' · '), '');
    check('Zahl der Verstöße', verstoesse.length, 0);

    // `fach()` gibt in jeder Sprache dasselbe zurück — das ist ihr ganzer
    // Zweck. Sie steht im Quelltext als Absichtserklärung, damit ein nicht
    // übersetzter Fachbegriff von einem vergessenen Text zu unterscheiden
    // ist.
    for (const sp of SPRACHEN) {
      spracheSetzen(sp.code);
      check(`fach() bleibt stehen (${sp.code})`, fach('Vorlauf'), 'Vorlauf');
    }
  }

  spracheSetzen(vorher);
}
