/**
 * Prüfblock „Schutzbereich und Kältemittel".
 *
 * **Die zwei Fehler, die diesen Block nötig gemacht haben.** Beide sind am
 * 27.09.2026 beim Gegenlesen des BWP-Leitfadens „Wärmepumpen mit brennbaren
 * Kältemitteln" aufgefallen, und beide waren **still** — kein falscher Wert,
 * sondern eine fehlende Meldung:
 *
 *  1. **Vier gängige A2L-Kältemittel bekamen keinen Schutzbereich.** Die
 *     Entscheidung hing an einer Namensliste (`R290`, `R32`), und das Modell
 *     ließ ohnehin nur fünf Kältemittel zu. R454B, R454C, R452B, R1234yf und
 *     R1234ze sind sämtlich A2L, also brennbar; wer eines davon eintrug,
 *     musste „andere" wählen — und „andere" galt als unbrennbar. Das Programm
 *     schwieg, und Schweigen sieht aus wie ein „in Ordnung".
 *  2. **Die Fenster und Türen des Gebäudes wurden nicht geprüft.** Der
 *     Leitfaden beginnt seine Aufzählung dessen, was nicht im Schutzbereich
 *     liegen darf, mit „Gebäudeöffnungen, wie Fenster, Türen, Lichtschächte".
 *     Geprüft wurde nur, was jemand **von Hand** als Geländeobjekt gesetzt
 *     hatte. Die Fenster stehen im Modell, mit Position und Brüstungshöhe —
 *     und wurden nicht angesehen.
 *
 * Alle Sollwerte sind unten hergeleitet; keiner stammt aus einem Probelauf.
 *
 * Quellen: BWP-Leitfaden „Wärmepumpen mit brennbaren Kältemitteln",
 * Tabelle 1 (Sicherheitsklassifizierung nach ISO 817), Tabelle 2 (GWP,
 * Selbstentzündungs- und maximal zulässige Oberflächentemperatur nach
 * DIN EN 378-2:2018-04), Abschnitt 3.1 (bodennahe Außenaufstellung) und
 * Tabelle 5 (Schwellenwerte nach Artikel 5 F-Gase-VO 2024/573).
 */

import type { CheckFn } from './typ';
import type { BimDocument, HeatPump, Refrigerant } from '../../src/types/bim';
import { buildReferenceDocument } from '../reference';
import { FLAMMABLE, protectionIssues, protectionStatus } from '../../src/lib/heatPump';
import {
  KAELTEMITTEL,
  brauchtSchutzbereich,
  co2Aequivalent,
  dichtheitspflicht,
  kaeltemittel,
} from '../../src/lib/kaeltemittel';
import { validateModel } from '../../src/lib/validation';

/** Eine Wärmepumpe im Gelände — nur die Felder, um die es hier geht. */
function pumpeMit(over: Partial<HeatPump>): HeatPump {
  return {
    id: 'wp', label: 'Außengerät', source: 'air', form: 'monoblock-outdoor',
    position: { x: 3, y: -1.2 }, azimuth: 180,
    width: 1.1, depth: 0.5, height: 1.4, standHeight: 0.3, mounting: 'free',
    soundPower: 54, nightModeGuaranteed: false, toneSurcharge: 0,
    refrigerant: 'R290', refrigerantMass: 1.5, protectionRadius: 1.5,
    heatingCapacity: 8, ratingPoint: 'A-7/W35', cop: 2.8, operation: 'mono-energetic',
    ...over,
  } as HeatPump;
}

function mitPumpe(doc: BimDocument, pump: HeatPump): BimDocument {
  return { ...doc, site: { ...doc.site, pumps: { [pump.id]: pump } } };
}

export function pruefeSchutzbereich(check: CheckFn): void {
  const haus = buildReferenceDocument();

  // =========================================================================
  // 1 · Der Katalog — Klasse, nicht Name
  // =========================================================================
  {
    check('Kältemittel · elf Einträge aus Tabelle 2 plus R744', KAELTEMITTEL.length, 12);

    /*
     * Die Zahlen der Leitfadentabelle, von Hand abgeschrieben und hier
     * gegengelesen. Sie stehen doppelt — einmal im Katalog, einmal hier —
     * und das ist der Zweck: Wer den Katalog ändert, muss es hier noch
     * einmal tun und dabei nachsehen, woher der Wert kommt.
     */
    const soll: [Refrigerant, string, number][] = [
      ['R290', 'A3', 0.02],
      ['R1234ze', 'A2L', 4],
      ['R1234yf', 'A2L', 7],
      ['R454C', 'A2L', 148],
      ['R454B', 'A2L', 466],
      ['R513A', 'A1', 631],
      ['R32', 'A2L', 675],
      ['R452B', 'A2L', 698],
      ['R134a', 'A1', 1430],
      ['R407C', 'A1', 1774],
      ['R410A', 'A1', 2088],
    ];
    for (const [id, klasse, gwp] of soll) {
      check(`Kältemittel · ${id} Sicherheitsklasse`, kaeltemittel(id)?.klasse ?? 'fehlt', klasse);
      check(`Kältemittel · ${id} GWP`, kaeltemittel(id)?.gwp ?? -1, gwp);
    }
    check('Kältemittel · R290 Selbstentzündung [°C]', kaeltemittel('R290')?.selbstentzuendung ?? -1, 470);
    check('Kältemittel · R290 max. Oberfläche [°C]', kaeltemittel('R290')?.maxOberflaeche ?? -1, 370);
    check('Kältemittel · R32 max. Oberfläche [°C]', kaeltemittel('R32')?.maxOberflaeche ?? -1, 458);

    /*
     * **Der Kern des ersten Fehlers.** Sieben der zwölf sind A2L oder A3 und
     * brauchen einen Schutzbereich; bis 1.58.0 waren es zwei.
     */
    check('Schutzbereich · sieben brennbare Kältemittel', FLAMMABLE.size, 7);
    for (const id of ['R290', 'R32', 'R454B', 'R454C', 'R452B', 'R1234yf', 'R1234ze'] as Refrigerant[]) {
      check(`Schutzbereich · ${id} braucht einen`, brauchtSchutzbereich(id) ?? 'unbekannt', true);
    }
    for (const id of ['R410A', 'R744', 'R134a', 'R407C', 'R513A'] as Refrigerant[]) {
      check(`Schutzbereich · ${id} braucht keinen`, brauchtSchutzbereich(id) ?? 'unbekannt', false);
    }
    /*
     * **Und „unbekannt" ist keine Entwarnung.** `undefined` heißt „weiß ich
     * nicht"; ein `false` an dieser Stelle war der eigentliche Fehler.
     */
    check('Schutzbereich · unbekanntes Kältemittel: weder ja noch nein', brauchtSchutzbereich('andere') === undefined, true);
  }

  // =========================================================================
  // 2 · Die Fenster des Gebäudes liegen im Schutzbereich
  // =========================================================================
  {
    /*
     * **Die Geometrie, von Hand.** Das Prüfhaus hat in jedem Geschoss
     * dieselbe Südwand von (0|0) nach (6|0) und darin ein Fenster in 3,00 m
     * Abstand vom Startknoten — also bei (3,00|0,00), in allen drei
     * Geschossen übereinander.
     *
     * Das Gerät steht bei (3,00|−1,20), also 1,20 m davor:
     *     √((3−3)² + (−1,20−0)²) = 1,20 m.
     *
     * Bei einem Schutzbereich von 1,50 m liegen damit **alle drei** Fenster
     * darin. Die Höhen ihrer Unterkanten über ±0,00:
     *     KG: −2,60 + 1,40 = −1,20 m
     *     EG:   0,00 + 0,90 =  0,90 m
     *     OG:   2,90 + 0,90 =  3,80 m
     * Das Kellerfenster ist das gefährliche — Propan sinkt.
     */
    const doc = mitPumpe(haus, pumpeMit({}));
    const befunde = protectionIssues(doc, doc.site.pumps['wp']!);
    const fenster = befunde.filter((b) => b.kind === 'building-opening');
    check('Schutzbereich · drei Gebäudeöffnungen im Bereich', fenster.length, 3);
    check('Schutzbereich · alle mit 1,20 m Abstand', [...new Set(fenster.map((f) => f.distance))].join(','), '1.2');
    check(
      'Schutzbereich · die Höhen ihrer Unterkanten [m]',
      fenster.map((f) => f.hoehe).sort((a, b) => (a ?? 0) - (b ?? 0)).join(', '),
      '-1.2, 0.9, 3.8',
    );
    check(
      'Schutzbereich · und die Meldung nennt das Geschoss',
      fenster.some((f) => f.label.includes('KG')) && fenster.some((f) => f.label.includes('OG')),
      true,
    );

    /*
     * **Die Gegenprobe über den Radius.** Bei 1,00 m liegt keines der
     * Fenster mehr darin — 1,20 > 1,00. Das trennt die Prüfung von einem
     * Treffer, der auch ohne Abstandsrechnung zustande käme.
     */
    const eng = mitPumpe(haus, pumpeMit({ protectionRadius: 1.0 }));
    check('Schutzbereich · bei 1,00 m liegt keines mehr darin', protectionIssues(eng, eng.site.pumps['wp']!).length, 0);

    /*
     * **Und die Gegenprobe über die Klasse.** Dasselbe Gerät mit R410A (A1)
     * hat keinen Schutzbereich wegen Brennbarkeit — dieselben Fenster, keine
     * Meldung. Wer nur den ersten Teil prüft, prüft einen Treffer, der
     * immer eintritt.
     */
    const a1 = mitPumpe(haus, pumpeMit({ refrigerant: 'R410A' }));
    check('Schutzbereich · A1 hat keinen Bereich', protectionIssues(a1, a1.site.pumps['wp']!).length, 0);

    /*
     * **Der Fall, um den es ging.** R454B, bis 1.58.0 gar nicht eintragbar
     * und als „andere" stillschweigend unbrennbar: dieselben drei Fenster.
     */
    const a2l = mitPumpe(haus, pumpeMit({ refrigerant: 'R454B' }));
    check('Schutzbereich · R454B findet dieselben drei', protectionIssues(a2l, a2l.site.pumps['wp']!).length, 3);
  }

  // =========================================================================
  // 3 · Nichtwissen ist keine Entwarnung
  // =========================================================================
  {
    const unbekannt = pumpeMit({ refrigerant: 'andere' });
    const s1 = protectionStatus(unbekannt);
    check('Schutzbereich · unbekanntes Kältemittel: Status offen', s1.erforderlich === undefined, true);
    check('Schutzbereich · und mit Begründung', (s1.hinweis ?? '').includes('Datenblatt'), true);

    const ohneRadius = pumpeMit({ refrigerant: 'R290', protectionRadius: 0 });
    const s2 = protectionStatus(ohneRadius);
    check('Schutzbereich · brennbar, aber kein Radius: erforderlich', s2.erforderlich ?? 'unbekannt', true);
    check('Schutzbereich · und ein Hinweis dazu', (s2.hinweis ?? '').includes('Herstellerangabe'), true);

    /*
     * Beides muss auch am Prüfbericht ankommen — eine Erkenntnis, die nur
     * in einer Funktion steht, sieht der Anwender nie.
     */
    const berichtUnbekannt = validateModel(mitPumpe(haus, unbekannt));
    check(
      'Schutzbereich · die Prüfung meldet das unbekannte Kältemittel',
      berichtUnbekannt.issues.some((i) => i.code === 'heatpump.refrigerant-unknown'),
      true,
    );
    const berichtOhne = validateModel(mitPumpe(haus, ohneRadius));
    check(
      'Schutzbereich · und den fehlenden Radius',
      berichtOhne.issues.some((i) => i.code === 'heatpump.protection-radius-missing'),
      true,
    );
    const berichtFenster = validateModel(mitPumpe(haus, pumpeMit({})));
    check(
      'Schutzbereich · und die Gebäudeöffnung mit eigenem Code',
      berichtFenster.issues.filter((i) => i.code === 'heatpump.protection-zone-building').length,
      3,
    );
  }

  // =========================================================================
  // 4 · Zündquellen
  // =========================================================================
  {
    /*
     * Eine Steckdose an der Südwand, 0,80 m neben dem Gerät. Der Leitfaden
     * zählt sie ausdrücklich auf — und anders als ein Lichtschacht fällt sie
     * beim Aufstellen niemandem auf.
     *
     *     √((3,00−3,60)² + (−1,20−(−1,60))²) = √(0,36 + 0,16) = √0,52 = 0,7211 m
     */
    const doc: BimDocument = {
      ...haus,
      site: {
        ...haus.site,
        elements: {
          z1: { id: 'z1', kind: 'ignition', label: 'Außensteckdose', points: [{ x: 3.6, y: -1.6 }], ignition: 'socket' },
        },
        pumps: { wp: pumpeMit({}) },
      },
    };
    const zuend = protectionIssues(doc, doc.site.pumps['wp']!).filter((b) => b.kind === 'ignition');
    check('Schutzbereich · die Zündquelle wird gefunden', zuend.length, 1);
    check('Schutzbereich · mit ihrem Abstand [m]', zuend[0]?.distance ?? -1, 0.72);
    check('Schutzbereich · und ihrer Beschriftung', zuend[0]?.label ?? 'fehlt', 'Außensteckdose');
    check(
      'Schutzbereich · die Prüfung meldet sie mit eigenem Code',
      validateModel(doc).issues.some((i) => i.code === 'heatpump.protection-zone-ignition'),
      true,
    );
  }

  // =========================================================================
  // 5 · Dichtheitsprüfung — die Brennbarkeit ist nicht das Kriterium
  // =========================================================================
  {
    /*
     * Das schreibt der Leitfaden ausdrücklich dazu, und es ist die
     * Verwechslung, die nahe liegt: **R290 ist das brennbarste der Reihe und
     * unterliegt der Prüfpflicht gar nicht**, weil es kein fluoriertes
     * Treibhausgas ist. Auch nicht bei 100 kg.
     */
    check('Dichtheit · R290 nie prüfpflichtig', dichtheitspflicht('R290', 100).pflichtig, false);
    check('Dichtheit · und die Begründung nennt den Grund', dichtheitspflicht('R290', 100).begruendung.includes('kein fluoriertes'), true);
    check('Dichtheit · R744 ebenso wenig', dichtheitspflicht('R744', 100).pflichtig, false);

    /*
     * R410A: Schwelle 2,39 kg nicht hermetisch, hermetisch das Doppelte
     * (Artikel 5 F-Gase-VO), also 4,78 kg.
     */
    check('Dichtheit · R410A bei 2,38 kg noch nicht', dichtheitspflicht('R410A', 2.38).pflichtig, false);
    check('Dichtheit · R410A bei 2,39 kg schon', dichtheitspflicht('R410A', 2.39).pflichtig, true);
    check('Dichtheit · hermetisch verdoppelt die Schwelle [kg]', dichtheitspflicht('R410A', 2.39, true).schwelle ?? -1, 4.78);
    check('Dichtheit · und damit bei 2,39 kg nicht mehr', dichtheitspflicht('R410A', 2.39, true).pflichtig, false);

    /*
     * Der Vorbehalt des Leitfadens für HFO/HFKW-Gemische wird mitgeführt —
     * eine Schwelle, deren Berechnungsmethodik noch nicht feststeht, darf
     * nicht wie eine feste Zahl aussehen.
     */
    check('Dichtheit · R454B trägt den Vorbehalt', dichtheitspflicht('R454B', 20).vorlaeufig, true);
    check('Dichtheit · R32 nicht', dichtheitspflicht('R32', 20).vorlaeufig, false);

    /*
     * CO₂-Äquivalent: 2,39 kg × GWP 2088 = 4990,32 kg = 4,99032 t.
     * Auf drei Stellen gerundet: 4,99.
     */
    check('Dichtheit · CO₂-Äquivalent von 2,39 kg R410A [t]', co2Aequivalent('R410A', 2.39) ?? -1, 4.99);
    check('Dichtheit · ohne bekanntes Kältemittel keine Zahl', co2Aequivalent('andere', 2.39) ?? 'keine Zahl', 'keine Zahl');
  }
}
