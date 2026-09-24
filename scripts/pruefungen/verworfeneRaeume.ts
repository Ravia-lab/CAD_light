/**
 * Prüfblock „Räume, die RaVia nicht übernommen hat".
 * ---------------------------------------------------------------------------
 * **Die Meldung (RaVia, E2E-Lauf 22.09.2026).** `raeume-uebernehmen` lässt
 * Räume unter 0,1 m² weg, und bis zu RaVias Update 321 auch solche ohne
 * brauchbare Flächenangabe. Der Anwender merkte davon nichts: Er zeichnet
 * zehn Räume, drüben kommen neun an. Reproduziert mit der Datei S14 aus der
 * Testgebäudesammlung — dort ist es ein „Schacht" mit 0,06 m².
 *
 * **Die Verabredung (23.09.2026).** RaVia nennt die verworfenen Räume in
 * derselben Antwort, in der auch die übernommenen stehen:
 *
 *     "verworfene_raeume": [
 *       { "id": "room-eg-7", "name": "Schacht", "flaeche": 0.06,
 *         "grund": "flaeche_unter_mindestgroesse", "geschoss": "EG" }
 *     ]
 *
 * `id` ist unsere eigene Kennung aus `getExport().rooms[].id`, unverändert
 * durchgereicht. Daran hängt alles: ohne sie kein Hinweis am richtigen Raum.
 *
 * Geprüft wird hier die Leseseite — dass die verabredete Form ankommt, dass
 * eine andere Schreibweise sie nicht aushebelt, und dass ein unbekannter
 * Grund angezeigt statt verschluckt wird.
 */

import { GRUND_TEXT, hinweisFuer, hinweiseZuRaeumen, leseVerworfene } from '../../src/lib/verworfeneRaeume';
import type { CheckFn } from './typ';

/** Die Antwort, wie RaVia sie schickt — wörtlich aus der Abstimmung. */
const ANTWORT_RAVIA = {
  raeume_ergebnis: [
    { raum_id: 'room-eg-0', name: 'Wohnen' },
    { raum_id: 'room-eg-1', name: 'Küche' },
  ],
  verworfene_raeume: [
    { id: 'room-eg-7', name: 'Schacht', flaeche: 0.06, grund: 'flaeche_unter_mindestgroesse', geschoss: 'EG' },
    { id: 'room-eg-8', name: 'Nische', grund: 'flaeche_fehlt_oder_nicht_numerisch', geschoss: 'EG' },
  ],
};

export function pruefeVerworfeneRaeume(check: CheckFn): void {
  // =========================================================================
  // 1 · Die verabredete Form
  // =========================================================================
  {
    const v = leseVerworfene(ANTWORT_RAVIA);
    check('Zwei verworfene Räume gelesen', v.length, 2);
    check('Die Kennung kommt durch', v[0].id, 'room-eg-7');
    check('Der Name auch', v[0].name ?? '—', 'Schacht');
    check('Die Fläche auch', v[0].flaeche ?? -1, 0.06, 1e-9);
    check('Der Grund auch', v[0].grund ?? '—', 'flaeche_unter_mindestgroesse');
    check('Das Geschoss auch', v[0].geschoss ?? '—', 'EG');
    check('Ein Raum ohne Flächenangabe kommt ebenfalls durch', v[1].flaeche === undefined, true);

    /*
     * Der Text, den der Anwender liest. Er nennt drei Dinge: welcher Raum,
     * mit welcher Fläche, und warum — in dieser Reihenfolge, weil man zuerst
     * wissen will, *welcher* Raum gemeint ist.
     */
    check('Hinweistext nennt Raum, Fläche und Grund',
      hinweisFuer(v[0]),
      '„Schacht" (0,06 m²) wurde von RaVia nicht übernommen. Die Fläche liegt unter der Mindestgröße von 0,10 m².');
    check('Ohne Fläche steht keine Klammer da',
      hinweisFuer(v[1]),
      '„Nische" wurde von RaVia nicht übernommen. Die Fläche fehlt oder ist keine Zahl.');
  }

  // =========================================================================
  // 2 · Was die Gegenstelle sonst noch schicken könnte
  // =========================================================================
  {
    // Englische Schreibweise — dieselbe Sache, anderes Wort.
    const englisch = leseVerworfene({
      rejected: [{ id: 'room-og-2', name: 'Schacht', area: 0.04, reason: 'area-below-minimum', level: 'OG' }],
    });
    check('Englische Feldnamen werden auch gelesen', englisch.length, 1);
    check('… mit Fläche', englisch[0].flaeche ?? -1, 0.04, 1e-9);
    check('… und Geschoss', englisch[0].geschoss ?? '—', 'OG');

    // In einem Umschlag, wie ihn manche Schnittstellen um die Nutzlast legen.
    const umschlag = leseVerworfene({ data: { verworfene_raeume: [{ id: 'room-eg-9' }] } });
    check('Auch in einem Umschlag gefunden', umschlag.length, 1);

    /*
     * **Ein unbekannter Grund darf nicht verschluckt werden.** Die Gegenseite
     * hat ihren eigenen Zeitplan; kommt morgen ein dritter Grund, ist ein
     * Hinweis ohne Erklärung immer noch besser als gar keiner.
     */
    const fremd = leseVerworfene({ verworfene_raeume: [{ id: 'room-eg-3', name: 'Abstellraum', grund: 'irgendwas_neues' }] });
    check('Ein unbekannter Grund wird angezeigt, nicht verschluckt',
      hinweisFuer(fremd[0]),
      '„Abstellraum" wurde von RaVia nicht übernommen. Grund der Gegenstelle: irgendwas_neues.');

    // Müll bleibt draußen: ohne Kennung kein Hinweis, der auf nichts zeigt.
    check('Einträge ohne Kennung fallen weg', leseVerworfene({ verworfene_raeume: [{ name: 'Namenlos' }] }).length, 0);
    check('Dieselbe Kennung zweimal zählt einmal',
      leseVerworfene({ verworfene_raeume: [{ id: 'a' }, { id: 'a' }] }).length, 1);
    check('Eine leere Liste ist kein Fehler', leseVerworfene({ verworfene_raeume: [] }).length, 0);
    check('Gar keine Antwort auch nicht', leseVerworfene(undefined).length, 0);
    check('Und eine Zeichenkette erst recht nicht', leseVerworfene('kaputt').length, 0);
  }

  // =========================================================================
  // 3 · Zuordnung zu den gezeichneten Räumen
  // =========================================================================
  {
    const v = leseVerworfene(ANTWORT_RAVIA);
    // Der Plan kennt nur den ersten der beiden.
    const { hinweise, ohneRaum } = hinweiseZuRaeumen(v, ['room-eg-0', 'room-eg-1', 'room-eg-7']);
    check('Ein Hinweis wird gesetzt', hinweise.length, 1);
    check('… am richtigen Raum', hinweise[0].roomId, 'room-eg-7');
    check('… mit der Kurzform für den Plan', hinweise[0].kurz, 'zu klein — nicht übernommen');
    check('Der Raum, den der Plan nicht kennt, bleibt übrig', ohneRaum.length, 1);
    check('… und wird benannt', ohneRaum[0].id, 'room-eg-8');

    // Ein anderer Grund ergibt eine andere Kurzform.
    const andere = hinweiseZuRaeumen(
      leseVerworfene({ verworfene_raeume: [{ id: 'r1', grund: 'flaeche_fehlt_oder_nicht_numerisch' }] }), ['r1']);
    check('Fehlende Fläche: neutrale Kurzform', andere.hinweise[0].kurz, 'nicht übernommen');

    check('Beide Gründe haben einen Klartext',
      ['flaeche_unter_mindestgroesse', 'flaeche_fehlt_oder_nicht_numerisch'].every((g) => !!GRUND_TEXT[g]), true);
  }
}
