/**
 * Prüfblock „Auslegungsübergabe" — hat der Rechenkern alles, was er braucht?
 *
 * **Der Anlass.** Eine Lückenanalyse vor der Übergabe an RaVia hat einen
 * einzigen harten Blocker gefunden, und er war eine fehlende Zahl:
 * `powerW` ist die Normwärmeleistung bei **55/45/20 °C**. Eine Wärmepumpe
 * fährt 35/28. Die Umrechnung zwischen beiden Betriebspunkten lautet nach
 * DIN EN 442-2 `Q = Q_norm · (Δθ/Δθ_norm)^n` — und der Exponent n stand
 * nirgends im Export. Der Rechenkern bekam also eine Zahl, die für seinen
 * Betriebspunkt nicht gilt, und keinen Weg, sie umzurechnen.
 *
 * Dasselbe bei der Fußbodenheizung: das Kennfeld nach DIN EN 1264-2 hängt an
 * Verlegeabstand, Estrichüberdeckung **und** Belagswiderstand R_λB. Zwei der
 * drei standen im Export, der dritte nicht. Ein Kreis unter Fliesen trägt
 * rund ein Drittel mehr als unter Teppich — das ist der Unterschied zwischen
 * „reicht" und „reicht nicht".
 *
 * **Was hier geprüft wird.** Nicht, ob die Auslegung stimmt — die rechnet
 * RaVia. Geprüft wird, dass der Export **vollständig** ist und dass er über
 * jede Zahl sagt, woher sie kommt. Eine angenommene Zahl ohne Kennzeichen ist
 * schlimmer als eine fehlende: die fehlende fällt auf.
 */

import type { CheckFn } from './typ';
import type { BimDocument, Fixture } from '../../src/types/bim';
import { buildRaviaExport } from '../../src/lib/raviaExport';
import { EMITTER_EXPONENT_ANNAHME, buildEmitters } from '../../src/lib/auslegungExport';
import { applyHostPatch, writableFields } from '../../src/lib/hostPatch';
import { buildReferenceDocument } from '../reference';

export function pruefeAuslegungsuebergabe(check: CheckFn): void {
  const doc = buildReferenceDocument();
  // Eine Heizfläche gibt Wärme ab. Ein Verteiler tut das nicht — er verteilt
  // sie. Ihn als Rechenfall zu führen hieße, eine Heizfläche zu behaupten, die
  // keine ist; das Referenzhaus hat zwei davon, und genau daran ist die erste
  // Fassung dieser Prüfung aufgefallen.
  const HEIZFLAECHEN = new Set(['radiator', 'convector', 'underfloor']);
  const heizflaechen = Object.values(doc.fixtures).filter(
    (f) => f.category === 'heating' && HEIZFLAECHEN.has(f.type),
  );

  /** Das Referenzhaus mit einem Fußbodenheizkreis — es hat von Haus aus keinen. */
  const mitFlaeche = (aenderung: Partial<Fixture['params']> = {}): { doc: BimDocument; id: string } => {
    const raum = Object.values(doc.rooms)[0];
    const id = 'pruef-fbh-1';
    const kreis: Fixture = {
      id,
      type: 'underfloor',
      category: 'heating',
      levelId: raum.levelId,
      position: { x: 0, y: 0 },
      rotation: 0,
      length: 1,
      depth: 1,
      elevation: 0,
      roomId: raum.id,
      label: 'Fußbodenheizung Prüfraum',
      params: { roomCoverage: true, loopSpacing: 0.15, loopCount: 2, ...aenderung },
    };
    return { doc: { ...doc, fixtures: { ...doc.fixtures, [id]: kreis } }, id };
  };

  // =========================================================================
  // 1 · Jede Heizfläche kommt als Rechenfall heraus
  // =========================================================================
  {
    const emitter = buildEmitters(doc);
    check('Es gibt Heizflächen im Referenzhaus', heizflaechen.length > 0, true);
    check('Jede Heizfläche wird zum Rechenfall', emitter.length, heizflaechen.length);
    check(
      'Jeder Rechenfall nennt seine Rechenregel',
      emitter.every((e) => e.rule === 'EN 442' || e.rule === 'EN 1264'),
      true,
    );
    check(
      'Heizkörper rechnen nach EN 442',
      emitter.filter((e) => e.type === 'radiator').every((e) => e.rule === 'EN 442'),
      true,
    );
    check(
      'Flächenheizungen rechnen nach EN 1264',
      emitter.filter((e) => e.type === 'underfloor').every((e) => e.rule === 'EN 1264'),
      true,
    );
    check(
      'Jeder Rechenfall verweist auf ein Objekt der Geometrie',
      emitter.every((e) => doc.fixtures[e.fixtureId] !== undefined),
      true,
    );
  }

  // =========================================================================
  // 2 · Der Exponent — die Zahl, an der die Übergabe hing
  // =========================================================================
  {
    const emitter = buildEmitters(doc);
    check('Jeder Rechenfall nennt einen Exponenten', emitter.every((e) => e.exponent !== undefined), true);
    // Ohne Eingabe ist er angenommen — und sagt das, samt Begründung. Ein
    // Richtwert, der sich als Messwert ausgibt, ist der teurere Fehler.
    const ohneEingabe = emitter.filter((e) => doc.fixtures[e.fixtureId].params.radiatorExponent === undefined);
    check('Ohne Datenblattwert gilt er als angenommen', ohneEingabe.every((e) => e.exponent?.herkunft === 'angenommen'), true);
    check('… und die Annahme ist begründet', ohneEingabe.every((e) => (e.exponent?.begruendung ?? '').length > 40), true);
    check(
      '… und der fehlende Datenblattwert steht in der Liste',
      ohneEingabe.every((e) => e.missing.some((m) => m.toLowerCase().includes('exponent'))),
      true,
    );
    check('Der Richtwert für Heizkörper ist 1,30', EMITTER_EXPONENT_ANNAHME.radiator ?? 0, 1.3, 1e-9);
    check('Der Richtwert für Flächenheizung ist 1,10', EMITTER_EXPONENT_ANNAHME.underfloor ?? 0, 1.1, 1e-9);

    // Ein eingegebener Wert schlägt den Richtwert und gilt als eingegeben.
    const eine = heizflaechen.find((f) => f.type === 'radiator') as Fixture;
    const mitWert: BimDocument = {
      ...doc,
      fixtures: { ...doc.fixtures, [eine.id]: { ...eine, params: { ...eine.params, radiatorExponent: 1.27 } } },
    };
    const e2 = buildEmitters(mitWert).find((e) => e.fixtureId === eine.id);
    check('Ein eingegebener Exponent gilt', e2?.exponent?.wert ?? 0, 1.27, 1e-9);
    check('… und gilt als eingegeben', e2?.exponent?.herkunft ?? '', 'eingegeben');
    check('… und fehlt dann nicht mehr', e2?.missing.some((m) => m.toLowerCase().includes('exponent')) ?? true, false);
  }

  // =========================================================================
  // 3 · Der Betriebspunkt steht neben dem Normpunkt
  // =========================================================================
  {
    const emitter = buildEmitters(doc);
    // Ohne beides ist die Umrechnung sinnlos: der Exponent allein sagt nicht,
    // *worauf* umgerechnet werden soll.
    check('Der Normpunkt steht an jedem Rechenfall', emitter.every((e) => e.nominalFlowTemperature === 55), true);
    check('… mit Rücklauf 45 °C', emitter.every((e) => e.nominalReturnTemperature === 45), true);
    check('… und Raumtemperatur 20 °C', emitter.every((e) => e.nominalRoomTemperature === 20), true);
  }

  // =========================================================================
  // 4 · Die drei Eingänge des Kennfelds nach EN 1264-2
  // =========================================================================
  {
    const nackt = mitFlaeche();
    const e0 = buildEmitters(nackt.doc).find((x) => x.fixtureId === nackt.id);
    check('Ein Fußbodenheizkreis wird zum Rechenfall', e0 !== undefined, true);
    check('… nach EN 1264', e0?.rule ?? '', 'EN 1264');
    // Fehlt einer der drei, sagt der Rechenfall es — er behauptet keinen Wert.
    for (const text of ['Estrichüberdeckung', 'R_λB', 'Rohraußendurchmesser']) {
      check(`Fehlende ${text} wird gemeldet`, e0?.missing.some((m) => m.includes(text)) ?? false, true);
    }
    check('Der Verlegeabstand ist da und fehlt nicht', e0?.loopSpacing?.wert ?? 0, 0.15, 1e-9);

    // Und mit Eingabe stehen sie da, als eingegeben — und fehlen nicht mehr.
    const voll = mitFlaeche({ screedCover: 0.045, floorCoveringResistance: 0.06, pipeOuterDiameter: 0.017, pipeWallThickness: 0.002 });
    const e = buildEmitters(voll.doc).find((x) => x.fixtureId === voll.id);
    check('Die Estrichüberdeckung kommt an', e?.screedCover?.wert ?? 0, 0.045, 1e-9);
    check('Der Belagswiderstand kommt an', e?.floorCoveringResistance?.wert ?? 0, 0.06, 1e-9);
    check('Der Rohrdurchmesser kommt an', e?.pipeOuterDiameter?.wert ?? 0, 0.017, 1e-9);
    check('… alle drei als eingegeben', e?.screedCover?.herkunft ?? '', 'eingegeben');
    check(
      'Und keiner der drei fehlt noch',
      (e?.missing ?? []).some((m) => /Estrich|R_λB|Rohraußen/.test(m)),
      false,
    );
    // Die belegte Fläche ist die Raumfläche, nicht die Symbolfläche.
    check('Die belegte Fläche ist die des Raums', (e?.area ?? 0) > 1, true);
  }

  // =========================================================================
  // 5 · Der Block steht wirklich im Export
  // =========================================================================
  {
    const ex = buildRaviaExport(doc);
    check('Der Export führt die Heizflächen', Array.isArray(ex.emitters), true);
    check('… vollzählig', ex.emitters.length, heizflaechen.length);
    check(
      'Der Verteiler steht nicht als Heizfläche darin',
      ex.emitters.some((e) => doc.fixtures[e.fixtureId].type === 'manifold'),
      false,
    );
    check('Der Export führt die Vorbemessung der Hydraulik', ex.hydraulics !== undefined, true);
    check('… und nennt sie ausdrücklich Vorbemessung', ex.hydraulics?.status ?? '', 'vorbemessung');
    check('… mit Verbrauchern', (ex.hydraulics?.consumers.length ?? 0) > 0, true);
    check(
      '… und jeder Verbraucher verweist auf ein Objekt',
      (ex.hydraulics?.consumers ?? []).every((c) => doc.fixtures[c.fixtureId] !== undefined),
      true,
    );
    check('… und die Pumpe steht dabei', (ex.hydraulics?.pump?.flow ?? 0) > 0, true);

    // Die Erzeugerseite. Δp des Geräts und Restförderhöhe schließen einander
    // aus; wer sie verwechselt, rechnet um 40 bis 70 kPa falsch, und zwar in
    // beide Richtungen. Deshalb steht `kind` neben dem Wert.
    const g = ex.hydraulics?.generator;
    check('Die Erzeugerseite steht im Export', g !== undefined, true);
    check(
      '… und sagt, welche Art von Angabe sie ist',
      ['geraetedruckverlust', 'restfoerderhoehe', 'unbekannt'].includes(g?.kind ?? ''),
      true,
    );
    check('… mit dem Bezugsvolumenstrom', (g?.flow ?? 0) > 0, true);
    check('… und einer Quellenangabe', (g?.source ?? '').length > 10, true);
    // Ein abgeleiteter Wert sagt, dass er abgeleitet ist — sonst liest ihn
    // jemand als Datenblattwert des eingebauten Geräts.
    check(
      '… die bei einem abgeleiteten Wert die Herkunft nennt',
      g?.kind === 'unbekannt' || /abgeleitet|Annahme|Tabellenwert|Diagramm|Median/i.test(g?.source ?? ''),
      true,
    );
    // Der Wert ist der des **Geräts**, nicht die Summe des Fließwegs: sonst
    // zählte der Rechenkern Waermemengenzaehler und Abscheider ein zweites Mal.
    if (g?.kind === 'geraetedruckverlust' && g.valuePa !== undefined) {
      check('Der Gerätewert ist kleiner als die Fließwegsumme', g.valuePa < 10000, true);
    }

    // Ohne Rohrnetz gibt es keine Vorbemessung — und keinen leeren Block, der
    // eine Anlage behauptet, die nicht gezeichnet ist.
    const ohneNetz = buildRaviaExport({ ...doc, pipes: {} });
    check('Ohne Rohrnetz fehlt der Hydraulikblock', ohneNetz.hydraulics === undefined, true);
    check('… die Heizflächen bleiben aber da', ohneNetz.emitters.length, heizflaechen.length);
  }

  // =========================================================================
  // 6 · Der Rückweg: das Ergebnis der Auslegung kommt in die Zeichnung
  // =========================================================================
  {
    const hk = heizflaechen.find((f) => f.type === 'radiator') as Fixture;
    const jetzt = '2026-09-12T10:00:00.000Z';

    const gut = applyHostPatch(
      doc,
      {
        source: 'RaVia',
        fixtures: [
          { id: hk.id, powerW: 1450, radiatorExponent: 1.28, radiatorHeight: 0.6, radiatorConnection: 'mitte', note: 'Kermi therm-x2 Plan-V 22' },
        ],
      },
      jetzt,
    );
    check('Das Auslegungsergebnis wird übernommen', gut.report.ok, true);
    check('Die Leistung steht am Objekt', gut.doc.fixtures[hk.id].params.powerW ?? 0, 1450);
    check('Der Exponent steht am Objekt', gut.doc.fixtures[hk.id].params.radiatorExponent ?? 0, 1.28, 1e-9);
    check('Die Anschlussart steht am Objekt', gut.doc.fixtures[hk.id].params.radiatorConnection ?? '', 'mitte');
    check('Das Fabrikat steht am Objekt', (gut.doc.fixtures[hk.id].params.note ?? '').includes('Kermi'), true);
    check('Die Spur nennt den Absender', gut.doc.meta.lastHostPatch?.source ?? '', 'RaVia');

    // Und danach ist der Exponent kein Richtwert mehr.
    const e = buildEmitters(gut.doc).find((x) => x.fixtureId === hk.id);
    check('Der Rechenfall gilt danach als eingegeben', e?.exponent?.herkunft ?? '', 'eingegeben');

    // Was nicht durchgeht: Unsinn, fremde Objekte, Geometrie.
    const schlecht = applyHostPatch(
      doc,
      { source: 'RaVia', fixtures: [{ id: hk.id, powerW: 50000, radiatorExponent: 3 }] },
      jetzt,
    );
    check('Eine 50-kW-Heizfläche wird abgewiesen', schlecht.report.rejected, 2);
    check('… und nichts davon landet im Modell', schlecht.changed, false);

    const fremd = applyHostPatch(doc, { source: 'RaVia', fixtures: [{ id: 'gibt-es-nicht', powerW: 1000 }] }, jetzt);
    check('Ein unbekanntes Objekt wird abgewiesen', fremd.report.rejected, 1);
    check('… mit dem Hinweis, dass gezeichnet wird', fremd.report.entries[0]?.reason?.includes('gezeichnet') ?? false, true);

    const sanitaer = Object.values(doc.fixtures).find((f) => f.category !== 'heating');
    if (sanitaer) {
      const falsch = applyHostPatch(doc, { source: 'RaVia', fixtures: [{ id: sanitaer.id, powerW: 1000 }] }, jetzt);
      check('Ein Objekt ohne Heizfunktion wird abgewiesen', falsch.report.rejected, 1);
    }

    // Die Position gehört dem Zeichner und steht in keiner Feldtabelle.
    const felder = writableFields().map((f) => f.path);
    check('Die Heizflächenfelder sind auskunftsfähig', felder.some((p) => p === 'fixtures[].radiatorExponent'), true);
    check('Die Position ist nicht schreibbar', felder.some((p) => p.startsWith('fixtures[].position')), false);
    check('Die Drehung ist nicht schreibbar', felder.some((p) => p.startsWith('fixtures[].rotation')), false);
    check('Die Wandbindung ist nicht schreibbar', felder.some((p) => p.startsWith('fixtures[].wallId')), false);
  }
}
