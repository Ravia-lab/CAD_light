/**
 * Prüfblock „Praxisprüfung an fünf Gebäuden" (1.72.0).
 * ---------------------------------------------------------------------------
 * **Der Auftrag (03.10.2026):** fünf Exporte aus CAD Light — Bungalow 1965,
 * EFH-Neubau 2018, MFH 1990 mit sechs Wohnungen, zwei Schweizer Häuser — aus
 * Sicht von Installateur, Meister, Energieberater und Ingenieur prüfen, und
 * die Projektmappe auf Wiederholungen durchsehen.
 *
 * Jede Zeile hier hält einen dort gefundenen Fehler fest, an einem Fall, der
 * sich ohne die Kundendateien nachrechnen lässt:
 *
 *  1. **Dachraum** — die oberste Decke zum unbeheizten Dach rechnete mit
 *     θ_u = 10 °C wie ein Keller. Ein geschlossener, undichter Dachraum liegt
 *     nach Recknagel (Jagnow/Wolff, Tafel 0-6) mit b = 0,8 … 0,9 fast bei der
 *     Außentemperatur. Sollwert von Hand: 20 − 0,9 · (20 − (−12)) = −8,8 °C.
 *  2. **Wand zum unbeheizten Nachbarraum** — ging mit der Solltemperatur des
 *     Nachbarn (20 °C) in den Export, also ohne Verlust. Sie ist `unheated`
 *     und trägt θ_u.
 *  3. **Mindestvolumenstrom** — die Bilanz nannte die Anlage „unzulässig",
 *     obwohl die Auslegung das Überströmventil vorsah, das genau das
 *     verhindert.
 *  4. **Geschossmeldungen** — dieselbe Meldung stand je Geschoss einmal da.
 *  5. **Projektmappe** — kein langer Textbaustein steht zweimal darin.
 */

import type { CheckFn } from './typ';
import type { BimDocument } from '../../src/types/bim';
import { dachraumTemperatur, DACHRAUM_FAKTOR, unbeheizteTemperatur } from '../../src/lib/unbeheizt';
import { buildRaviaExport } from '../../src/lib/raviaExport';
import { fasseGeschossmeldungen } from '../../src/lib/gebaeudeNetz';
import { erzeugerBilanz } from '../../src/lib/erzeugerHydraulik';
import { HEAT_PUMP_CATALOG } from '../../src/lib/deviceCatalog';
import { herkunftsBasis } from '../../src/lib/materialSchedule';
import { buildProjektMappe } from '../../src/lib/projektMappe';
import { buildPipeReport } from '../../src/lib/pipeReport';
import { buildSchematic, designPlant } from '../../src/lib/plantDesign';
import { buildReferenceDocument } from '../reference';

const klon = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** Sichtbare Textbausteine außerhalb der Zeichnungen, je Blatt. */
function textbausteine(html: string): string[] {
  const ohneSvg = html.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
  return ohneSvg
    .split(/<\/?(?:p|td|th|li|div|h[1-6]|tr|section|header|footer|br)\b[^>]*>/)
    .map((t) =>
      t
        .replace(/<[^>]*>/g, ' ')
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter(Boolean);
}

/**
 * Was als Textbaustein zählt: lang genug, um ein Satz zu sein, und kein
 * Messwert. Ein kurzer Satz mit Zahlen („Spreizung 7,0 K …") ist ein Wert
 * seines Bauteils — zwei gleich ausgelegte Verteiler haben ihn beide. Die
 * Gewerksüberschrift „· Fortsetzung" steht absichtlich auf jedem Folgeblatt.
 */
function textbaustein(t: string): boolean {
  if (t.length < 45 || /Fortsetzung/.test(t)) return false;
  return t.length >= 80 || !/\d/.test(t);
}

export function pruefePraxispruefung(check: CheckFn): void {
  const ref = buildReferenceDocument();

  // =========================================================================
  // 1 · Dachraum
  // =========================================================================
  {
    const meta = { ...ref.meta, designIndoorTemperature: 20, designOutdoorTemperature: -12 };
    check('Dachraum: Faktor b nach Recknagel (geschlossen, undicht)', DACHRAUM_FAKTOR, 0.9);
    check('Dachraum: θ = 20 − 0,9 · 32 = −8,8 °C', dachraumTemperatur(meta), -8.8, 1e-9);
    check('Dachraum: eingetragener Wert geht vor', dachraumTemperatur({ ...meta, atticTemperature: 2 }), 2);
    check(
      'Dachraum: nicht mehr die Kellertemperatur',
      dachraumTemperatur(meta) < unbeheizteTemperatur(meta),
      true,
    );
    const exp = buildRaviaExport(ref);
    check('Export trägt project.atticTemperature', exp.project.atticTemperature ?? NaN, dachraumTemperatur(ref.meta), 1e-9);
    check('Exportvertrag 2.14.0', exp.version, '2.14.0');
  }

  // =========================================================================
  // 2 · Wand zum unbeheizten Nachbarraum
  // =========================================================================
  {
    const doc: BimDocument = klon(ref);
    // Ein beheizter Wohnraum im Erdgeschoss, dessen Nachbar unbeheizt wird.
    const eg = Object.values(doc.rooms).filter((r) => r.levelId === 'eg' && r.isHeated !== false);
    const exp0 = buildRaviaExport(doc);
    type Flaeche = { boundary: string; neighbourRoomId?: string; neighbourTemperature: number };
    const flaechen = (e: typeof exp0, id: string): Flaeche[] => {
      const r = (e.rooms as unknown as { id: string; surfaces?: Flaeche[] }[]).find((x) => x.id === id);
      return r?.surfaces ?? [];
    };
    let paar: { raum: string; nachbar: string } | undefined;
    for (const r of eg) {
      const f = flaechen(exp0, r.id).find(
        (s) => s.boundary === 'adjacent-room' && s.neighbourRoomId && doc.rooms[s.neighbourRoomId]?.levelId === 'eg',
      );
      if (f) {
        paar = { raum: r.id, nachbar: f.neighbourRoomId! };
        break;
      }
    }
    check('Referenzhaus hat zwei benachbarte Räume im EG', paar !== undefined, true);
    if (paar) {
      doc.rooms[paar.nachbar].isHeated = false;
      const exp = buildRaviaExport(doc);
      const f = flaechen(exp, paar.raum).find((s) => s.neighbourRoomId === paar!.nachbar);
      check('Wand zum unbeheizten Nachbarn: Randbedingung unheated', f?.boundary ?? '', 'unheated');
      check(
        'Wand zum unbeheizten Nachbarn: θ_u statt Solltemperatur',
        f?.neighbourTemperature ?? NaN,
        unbeheizteTemperatur(doc.meta),
        1e-9,
      );
      check('Wand zum unbeheizten Nachbarn: Nachbar bleibt benannt', f?.neighbourRoomId ?? '', paar.nachbar);
    }
  }

  // =========================================================================
  // 3 · Mindestvolumenstrom bei gesicherter Anlage
  // =========================================================================
  {
    const model = HEAT_PUMP_CATALOG.find((m) => (m.hydraulics?.vMin ?? m.minVolumeFlow ?? 0) > 1);
    check('Katalog hat ein Gerät mit Mindestvolumenstrom über 1 m³/h', model !== undefined, true);
    if (model) {
      const vMin = model.hydraulics?.vMin ?? model.minVolumeFlow!;
      const basis = { model, flow: vMin / 2, dn: 25, umschaltung: false, waermezaehler: false, abscheiderVorhanden: true };
      const offen = erzeugerBilanz(basis);
      const gesichert = erzeugerBilanz({ ...basis, mindestGesichert: true });
      const unzulaessig = (b: typeof offen): boolean => b.hinweise.some((h) => h.text.includes('unzulässig'));
      check('Ohne Sicherung: Unterschreitung wird gemeldet', unzulaessig(offen), true);
      check('Mit Überströmventil/Trennpuffer: kein „unzulässig"', unzulaessig(gesichert), false);
      check(
        'Mit Sicherung: Hinweis nennt beide Ströme',
        gesichert.hinweise.some((h) => h.text.includes('das Gerät verlangt mindestens')),
        true,
      );
    }
  }

  // =========================================================================
  // 4 · Geschossmeldungen zusammenfassen
  // =========================================================================
  {
    const satz = 'Abschnitte überschreiten die Fließgeschwindigkeit.';
    const raus = fasseGeschossmeldungen(
      [
        { severity: 'warning', text: `EG: 27 Abschnitte: ${satz}` },
        { severity: 'warning', text: `OG: 22 Abschnitte: ${satz}` },
        { severity: 'info', text: 'EG: Tür zu schmal.' },
        { severity: 'info', text: 'OG: Tür zu schmal.' },
        { severity: 'info', text: 'Ohne Geschoss.' },
      ] as never,
      ['EG', 'OG'],
    );
    check('Geschossmeldungen: fünf werden drei', raus.length, 3);
    check('Geschossmeldungen: Zahlen je Geschoss bleiben', raus[0].text.startsWith('EG 27, OG 22 Abschnitte'), true);
    check('Geschossmeldungen: ohne Zahl', raus[1].text, 'EG, OG: Tür zu schmal.');
  }

  // =========================================================================
  // 5 · Projektmappe ohne Wiederholungen
  // =========================================================================
  {
    check('Herkunftsbasis ohne Zählsuffix', herkunftsBasis('Rohrnetz im Grundriss, 11 Abschnitte'), 'Rohrnetz im Grundriss');
    const { components, links } = buildSchematic(designPlant(ref));
    const doc: BimDocument = {
      ...klon(ref),
      plant: {
        ...ref.plant!,
        schematic: {
          components: Object.fromEntries(components.map((c) => [c.id, c])),
          links: Object.fromEntries(links.map((l) => [l.id, l])),
          manual: false,
        },
      },
    };
    const mappe = buildProjektMappe(doc, { datum: '01.01.2026', bericht: buildPipeReport(doc) });
    const zaehler = new Map<string, number>();
    for (const t of textbausteine(mappe.html)) if (textbaustein(t)) zaehler.set(t, (zaehler.get(t) ?? 0) + 1);
    const doppelt = [...zaehler].filter(([, n]) => n > 1).map(([t, n]) => `${n}× „${t.slice(0, 60)}…"`);
    check(`Projektmappe: kein langer Textbaustein doppelt${doppelt.length ? ` — ${doppelt.slice(0, 3).join('; ')}` : ''}`, doppelt.length, 0);
  }
}
