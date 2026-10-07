/**
 * Prüfblock „Mappenhygiene" (1.75.0).
 * ---------------------------------------------------------------------------
 * **Der Auftrag (07.10.2026):** fünf Prüfrunden von vorne bis hinten — „in
 * der Projektmappe keine unnötigen Daten, sauber gearbeitet". Die erste Runde
 * an den fünf Gebäuden der Praxisprüfung fand, was die Prüfung von 1.72.0
 * (lange Textbausteine doppelt) nicht sah, weil sie nur ganze Absätze
 * verglich:
 *
 *  1. **Sätze doppelt** — die Begründung einer angehobenen
 *     Auslegungstemperatur stand dreimal (Deckblatt, Anlagenbuch, Katalog),
 *     die Liste der fehlenden Pflichtangaben zweimal, die Einstufung nach
 *     DVGW W 551 zweimal, die Einordnung der spezifischen Heizlast zweimal
 *     (einmal sogar im selben Satz: „109 W/m² — 109 W/m² — …").
 *  2. **Zahlen englisch** — „12.37 kW" im Hinweis, „9.47 m²" im Raumstempel
 *     des Grundrisses, „8.2 kW" im Schema, „-12 °C" mit Bindestrich.
 *  3. **Code im Text** — „gibt die Spitze über `peak` selbst vor".
 *  4. **Mehrfamilienhaus als Einfamilienhaus** — ein Haus mit Räumen „WE 1"
 *     bis „WE 6" bekam die Erleichterung für Ein- und Zweifamilienhäuser nach
 *     DVGW W 551, weil das Anlagenblatt eine Wohneinheit vorbelegt.
 *  5. **Eingaben ungeschützt** — die Objektaufnahme setzte eingetippte Werte
 *     ohne Maskierung in die Tabelle.
 *
 * Geprüft wird an der Referenz und an Abwandlungen davon; die Kundendateien
 * liegen nicht im Repository.
 */

import type { CheckFn } from './typ';
import type { BimDocument } from '../../src/types/bim';
import { buildProjektMappe } from '../../src/lib/projektMappe';
import { buildPipeReport } from '../../src/lib/pipeReport';
import { buildSchematic, designPlant } from '../../src/lib/plantDesign';
import { einheitenAusRaumnamen } from '../../src/lib/nutzungseinheiten';
import { dez, wie } from '../../src/lib/zahl';
import { bloecke, umbrechen } from '../../src/lib/mappenUmbruch';
import { buildReferenceDocument } from '../reference';

const klon = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

function entity(t: string): string {
  return t
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** Sichtbarer Fließtext außerhalb der Zeichnungen, je Baustein. */
function bausteine(html: string): string[] {
  return html
    .replace(/<svg[\s\S]*?<\/svg>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<(header|footer)\b[\s\S]*?<\/\1>/g, ' ')
    .split(/<\/?(?:p|td|th|li|div|h[1-6]|tr|section|br|caption)\b[^>]*>/)
    .map((t) => entity(t.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/** Texte in den Zeichnungen. */
function zeichnungstexte(html: string): string[] {
  return [...html.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)].map((m) => entity(m[1]));
}

/** Sätze ab 50 Zeichen, die in der Mappe mehr als einmal stehen. */
function doppelteSaetze(html: string): string[] {
  const zaehler = new Map<string, number>();
  for (const b of bausteine(html)) {
    for (const z of b.split(/(?<=[.!?:])\s+(?=[A-ZÄÖÜ„])/)) {
      const satz = z.trim();
      if (satz.length >= 50 && !/Fortsetzung/.test(satz)) zaehler.set(satz, (zaehler.get(satz) ?? 0) + 1);
    }
  }
  return [...zaehler].filter(([, n]) => n > 1).map(([s, n]) => `${n}× „${s.slice(0, 70)}…"`);
}

const EINHEIT = '(?:kW|W|m²|m³/h|m³|m|kPa|Pa|bar|l|K|cm|mm)';
/** „12.37 kW", „9.47 m²" — Dezimalpunkt vor einer Einheit. */
const DEZIMALPUNKT = new RegExp(`(?<![\\d.])\\d+\\.\\d+ ?${EINHEIT}(?![\\w²³])`, 'g');
/** „-12 °C" — Bindestrich statt Minuszeichen. */
const BINDESTRICH = /(?<![\w−])-\d+(?:,\d+)? ?°C/g;

function formfehler(html: string): string[] {
  const funde: string[] = [];
  for (const t of [...bausteine(html), ...zeichnungstexte(html)]) {
    for (const m of t.matchAll(DEZIMALPUNKT)) {
      // „23.522 Pa" ist ein Tausenderpunkt, kein Dezimalpunkt.
      if (/^\d{1,3}(?:\.\d{3})+ ?\D/.test(m[0])) continue;
      funde.push(`Dezimalpunkt „${m[0]}"`);
    }
    for (const m of t.matchAll(BINDESTRICH)) funde.push(`Bindestrich „${m[0]}"`);
    for (const m of t.matchAll(/`[^`]{1,40}`/g)) funde.push(`Code „${m[0]}"`);
    if (/[a-zäöüß)]\.\.(?:\s|$)/.test(t)) funde.push(`doppelter Punkt „…${t.slice(Math.max(0, t.indexOf('..') - 30), t.indexOf('..') + 2)}"`);
    if (/\b(?:undefined|NaN|Infinity|\[object Object\])\b/.test(t)) funde.push(`Rohwert in „${t.slice(0, 50)}"`);
  }
  return funde;
}

function mitSchema(doc: BimDocument): BimDocument {
  const { components, links } = buildSchematic(designPlant(doc));
  return {
    ...doc,
    plant: {
      ...doc.plant!,
      schematic: {
        components: Object.fromEntries(components.map((c) => [c.id, c])),
        links: Object.fromEntries(links.map((l) => [l.id, l])),
        manual: false,
      },
    },
  };
}

const mappeVon = (doc: BimDocument): string =>
  buildProjektMappe(doc, { datum: '01.01.2026', bericht: buildPipeReport(doc) }).html;

export function pruefeMappenhygiene(check: CheckFn): void {
  const ref = buildReferenceDocument();

  // =========================================================================
  // 1 · Zahlen für deutschen Text
  // =========================================================================
  check('Zahl: Komma statt Punkt', dez(12.374, 2), '12,37');
  check('Zahl: echtes Minuszeichen', dez(-12, 0), '−12');
  check('Zahl: −0 ist 0', dez(-0.001, 2), '0,00');
  check('Zahl übernommen: ohne Runden', wie(-12.5), '−12,5');
  check('Zahl übernommen: ganze Zahl bleibt ganz', wie(8), '8');

  // =========================================================================
  // 2 · Die Mappe der Referenz — und der Referenz mit −14 °C und Heizkörpern
  // =========================================================================
  const faelle: [string, BimDocument][] = [['Referenz', mitSchema(klon(ref))]];
  {
    const kalt = klon(ref);
    kalt.meta.designOutdoorTemperature = -14;
    faelle.push(['Referenz bei −14 °C', mitSchema(kalt)]);
  }
  for (const [name, doc] of faelle) {
    const html = mappeVon(doc);
    const doppelt = doppelteSaetze(html);
    check(
      `Mappenhygiene ${name}: kein Satz doppelt${doppelt.length ? ` — ${doppelt.slice(0, 3).join('; ')}` : ''}`,
      doppelt.length,
      0,
    );
    const form = formfehler(html);
    check(
      `Mappenhygiene ${name}: keine Formfehler${form.length ? ` — ${[...new Set(form)].slice(0, 4).join('; ')}` : ''}`,
      form.length,
      0,
    );
  }

  // =========================================================================
  // 2a · Umbruch der Textblätter (ein Blatt = eine Druckseite)
  // =========================================================================
  {
    const mass = { hoehe: 150, breite: 261 };
    check('Umbruch: Blöcke oberster Ebene', bloecke('<h2>A</h2><p>x <b>y</b></p><table><tr><td>1</td></tr></table>').length, 3);
    check('Umbruch: was passt, bleibt ein Blatt', umbrechen('<h2>Kurz</h2><p>Ein Satz.</p>', mass).length, 1);
    const zeilen = Array.from({ length: 80 }, (_, i) => `<tr><td>Zeile ${i + 1}</td><td>${'Text '.repeat(8)}</td></tr>`).join('');
    const lang =
      '<h2>Lang</h2><p>Vorspann.</p><table class="daten"><thead><tr><th>Nr.</th><th>Inhalt</th></tr></thead>' +
      `<tbody>${zeilen}</tbody><tfoot><tr><td>Summe</td><td>80</td></tr></tfoot></table><h3>Danach</h3><p>Schluss.</p>`;
    const seiten = umbrechen(lang, mass);
    check('Umbruch: lange Tabelle läuft auf mehrere Blätter', seiten.length > 1, true);
    check('Umbruch: jede Seite mit Tabellenzeilen trägt den Tabellenkopf', seiten.filter((x) => x.includes('<tr><td>Zeile')).every((x) => x.includes('<thead>')), true);
    check('Umbruch: keine Zeile geht verloren', seiten.join('').match(/<tr><td>Zeile/g)?.length ?? 0, 80);
    check('Umbruch: der Tabellenfuß bleibt erhalten', seiten.join('').includes('<tfoot><tr><td>Summe'), true);
    check('Umbruch: keine Überschrift allein am Seitenende', seiten.every((x) => !/<h[23]>[^<]*<\/h[23]>$/.test(x)), true);
    const buch = `<div class="anlagenbuch"><section class="kapitel">${lang}</section></div>`;
    check(
      'Umbruch: das Anlagenbuch behält seine Hülle auf jeder Seite',
      umbrechen(buch, mass).every((x) => x.startsWith('<div class="anlagenbuch"><section class="kapitel">') && x.endsWith('</section></div>')),
      true,
    );
    const mappe = buildProjektMappe(mitSchema(klon(ref)), { datum: '01.01.2026', bericht: buildPipeReport(mitSchema(klon(ref))) });
    check(
      'Umbruch: Inhaltsverzeichnis zählt die Fortsetzungsblätter mit',
      mappe.kapitel.reduce((s2, k) => s2 + k.blaetter.length, 0),
      mappe.blaetter.length,
    );
  }

  // =========================================================================
  // 3 · Mehrfamilienhaus, dessen Einheiten niemand eingetragen hat
  // =========================================================================
  {
    const mfh = klon(ref);
    const raeume = Object.values(mfh.rooms);
    raeume.forEach((r, i) => {
      r.name = `WE ${(i % 3) + 1} ${r.name}`;
    });
    check('Raumnamen: drei Wohnungen erkannt', einheitenAusRaumnamen(mfh).zahl, Math.min(3, raeume.length));
    check('Raumnamen: Referenz ohne Wohnungsnamen', einheitenAusRaumnamen(ref).zahl, 0);
    {
      const probe = klon(ref);
      const [a, b, c] = Object.values(probe.rooms);
      if (a && b && c) {
        a.name = 'Whg. 2 Küche';
        b.name = 'Wohnung 2 Bad';
        c.name = 'WEST-Zimmer';
      }
      check('Raumnamen: „Whg. 2" und „Wohnung 2" sind eine Wohnung, „WEST" keine', einheitenAusRaumnamen(probe).zahl, 1);
    }
    if (mfh.plant) mfh.plant.dhw.units = 1;
    const auslegung = designPlant(mfh);
    if (auslegung.dhw) {
      check(
        'MFH ohne Einheitenzahl: keine Ein-/Zweifamilienhaus-Erleichterung',
        auslegung.dhw.legionellaReason.includes('Ein- und Zweifamilienhäusern'),
        false,
      );
      check(
        'MFH ohne Einheitenzahl: Hinweis nennt die Raumnamen',
        auslegung.notes.some((n) => n.text.startsWith('Die Raumnamen deuten auf 3 Wohnungen')),
        true,
      );
    } else {
      check('MFH ohne Einheitenzahl: Referenz hat Warmwasser', false, true);
    }
    const efh = designPlant(ref);
    check(
      'EFH: Hinweis zu Raumnamen bleibt aus',
      efh.notes.some((n) => n.text.startsWith('Die Raumnamen deuten')),
      false,
    );
  }

  // =========================================================================
  // 4 · Eingaben in der Objektaufnahme werden maskiert
  // =========================================================================
  {
    const doc = mitSchema(klon(ref));
    doc.meta.aufnahme = { ...(doc.meta.aufnahme ?? {}), typenschild: '<b>WP 9</b> & Co' } as never;
    const html = mappeVon(doc);
    check('Objektaufnahme: Eingabe kommt nicht als Markup an', html.includes('<b>WP 9</b>'), false);
  }
}
