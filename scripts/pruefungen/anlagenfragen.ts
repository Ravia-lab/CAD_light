/**
 * Prüfblock „Anlagenfragen" — wird gebaut, was der Anwender gesagt hat?
 *
 * **Warum dieser Block gebraucht wird.** Seit 1.51.0 entsteht die Anlage aus
 * Antworten statt aus einer Liste vorgeschlagener Musterlösungen; seit 1.54.0
 * sind es sieben, und sie stehen an zwei Orten — im Anlagenblatt und im
 * Anlagendialog am Schema. Damit
 * hängt alles Weitere — Speicher, Heizkreise, Schema, Rohrnetz, Stückliste —
 * an dieser einen Ableitung. Sie kann auf drei Arten falsch werden:
 *
 *  1. **Die Antwort kommt nicht an.** Wer 300 l Puffer einträgt und 200 l
 *     bekommt, hat ein Programm vor sich, das ihm nicht zuhört.
 *  2. **Vorhandenes geht verloren.** Wer einen Kreis benannt und ihm Räume
 *     zugeordnet hat, darf das nicht verlieren, weil er danach den Puffer
 *     ändert.
 *  3. **Die Antwort wird still korrigiert.** Das ist die ausdrückliche
 *     Festlegung: Die Antwort gilt, die Auslegung steht daneben. Ein
 *     Abweichungshinweis darf die Antwort nie verändern.
 *
 * Alle Sollwerte folgen aus den Antworten selbst und sind im Kommentar
 * begründet; keiner stammt aus einem Probelauf.
 */

import type { CheckFn } from './typ';
import type { AnlagenAntworten, HeatingCircuit, Inneneinheit, PlantStorage } from '../../src/types/bim';
import { ANTWORTEN_VORGABE, INNENEINHEIT_LABELS } from '../../src/types/bim';
import {
  abweichungen,
  anlageAusAntworten,
  antwortenAusAnlage,
  antwortenDes,
  hatHeizstab,
  hatInneneinheit,
  heizstabImSpeicher,
  kaeltemittelImHaus,
  kaeltemittelHinweis,
} from '../../src/lib/anlagenFragen';

const LEER = { storages: {} as Record<string, PlantStorage>, circuits: {} as Record<string, HeatingCircuit> };

const speicherArt = (a: ReturnType<typeof anlageAusAntworten>, kind: string) =>
  Object.values(a.storages).filter((s) => s.kind === kind);

export function pruefeAnlagenfragen(check: CheckFn): void {
  // =========================================================================
  // 1 · Die Vorgabe
  // =========================================================================
  {
    /*
     * Womit das Feld aufgeht: die häufigste Anlage im Wohnungsbau. Geprüft
     * wird nicht, dass sie „richtig" ist — eine Vorbelegung ist nie richtig,
     * sie ist nur der wahrscheinlichste Anfang —, sondern dass sie in sich
     * stimmig ist: ein Monoblock führt Heizungswasser ins Haus und braucht
     * deshalb kein Innengerät, und zu R290 gehört genau diese Bauart.
     */
    check('Anlagenfragen · Vorgabe ist ein Monoblock', ANTWORTEN_VORGABE.bauform, 'monoblock-outdoor');
    check('Anlagenfragen · beim Monoblock bleibt der Kältekreis draußen', kaeltemittelImHaus(ANTWORTEN_VORGABE.bauform), false);
    check('Anlagenfragen · Vorgabe hat genau einen Kreis', ANTWORTEN_VORGABE.kreise.length, 1);
    check('Anlagenfragen · Vorgabe ohne Puffer', ANTWORTEN_VORGABE.pufferLiter, 0);
    check(
      'Anlagenfragen · Vorgabe ohne Kältemittelhinweis',
      kaeltemittelHinweis(ANTWORTEN_VORGABE.bauform, ANTWORTEN_VORGABE.kaeltemittel) === undefined,
      true,
    );
  }

  // =========================================================================
  // 2 · Die Antwort kommt an
  // =========================================================================
  {
    const antworten: AnlagenAntworten = {
      bauform: 'split',
      kaeltemittel: 'R32',
      inneneinheit: 'ohne-heizstab',
      trinkwasserLiter: 300,
      kreise: ['ungemischt', 'gemischt'],
      pufferLiter: 200,
      pufferArt: 'buffer-parallel',
    };
    const a = anlageAusAntworten(antworten, LEER);

    check('Anlagenfragen · Trinkwasserspeicher entsteht', speicherArt(a, 'dhw-cylinder').length, 1);
    check('Anlagenfragen · mit dem eingetragenen Inhalt', speicherArt(a, 'dhw-cylinder')[0].volume, 300);
    check('Anlagenfragen · Puffer entsteht', speicherArt(a, 'buffer-parallel').length, 1);
    check('Anlagenfragen · mit dem eingetragenen Inhalt', speicherArt(a, 'buffer-parallel')[0].volume, 200);
    check('Anlagenfragen · zwei Kreise', Object.keys(a.circuits).length, 2);

    /*
     * **Gemischt heißt Mischer.** An `mixed` hängt im Schema die
     * Mischergruppe und in der Auslegung die eigene Vorlauftemperatur; eine
     * Verwechslung hier zieht durch das ganze Bild.
     */
    const kreise = Object.values(a.circuits);
    check('Anlagenfragen · Kreis 1 ungemischt', kreise[0].mixed, false);
    check('Anlagenfragen · Kreis 2 gemischt', kreise[1].mixed, true);
    check('Anlagenfragen · der gemischte Kreis ist eine Fläche', kreise[1].kind, 'floor');
    check('Anlagenfragen · der ungemischte sind Heizkörper', kreise[0].kind, 'radiator');

    /*
     * Ein frisch angelegter gemischter Kreis bekommt 35/28 °C — die
     * Auslegungstemperatur der Fußbodenheizung nach DIN EN 1264. Ohne
     * Vorbelegung ginge er mit 0 °C in die Auslegung.
     */
    check('Anlagenfragen · gemischter Kreis mit 35 °C Vorlauf', kreise[1].flowTemperature, 35);
    check('Anlagenfragen · gemischter Kreis mit 28 °C Rücklauf', kreise[1].returnTemperature, 28);
    check('Anlagenfragen · ungemischter Kreis mit 55 °C Vorlauf', kreise[0].flowTemperature, 55);

    // Was der Anwender einträgt, ist keine Programmvermutung.
    check('Anlagenfragen · Speicher gelten als gesetzt, nicht vorgeschlagen', speicherArt(a, 'dhw-cylinder')[0].suggested, false);
  }

  // =========================================================================
  // 3 · Null heißt: gibt es nicht
  // =========================================================================
  {
    const ohne: AnlagenAntworten = { ...ANTWORTEN_VORGABE, trinkwasserLiter: 0, pufferLiter: 0 };
    const a = anlageAusAntworten(ohne, LEER);
    check('Anlagenfragen · kein Trinkwasserspeicher bei 0 l', speicherArt(a, 'dhw-cylinder').length, 0);
    check('Anlagenfragen · kein Puffer bei 0 l', Object.keys(a.storages).length, 0);
  }

  // =========================================================================
  // 4 · Reihenpuffer ist etwas anderes als Parallelpuffer
  // =========================================================================
  {
    /*
     * Der Unterschied ist nicht kosmetisch: Der Parallelpuffer trennt
     * Erzeuger- und Anlagenseite hydraulisch, der Reihenpuffer liegt im
     * Rücklauf und liefert nur Wasserinhalt. Im Schema hängt daran, ob es
     * vier Anschlüsse gibt oder zwei.
     */
    const reihe = anlageAusAntworten(
      { ...ANTWORTEN_VORGABE, pufferLiter: 100, pufferArt: 'buffer-series' },
      LEER,
    );
    check('Anlagenfragen · Reihenpuffer wird als solcher angelegt', speicherArt(reihe, 'buffer-series').length, 1);
    check('Anlagenfragen · und nicht als Parallelpuffer', speicherArt(reihe, 'buffer-parallel').length, 0);
  }

  // =========================================================================
  // 5 · Vorhandenes bleibt
  // =========================================================================
  {
    /*
     * Der Fall aus der Praxis: Der Anwender hat den Kreis „Fußbodenheizung
     * EG" benannt, ihm vier Räume zugeordnet und 40/30 °C eingetragen. Dann
     * ändert er den Puffer von 0 auf 200 l. Verlöre er dabei Name, Räume und
     * Temperaturen, wäre jede Änderung an einem der sieben Felder ein
     * Rücksetzen der halben Anlage.
     */
    const bisher = {
      storages: {},
      circuits: {
        'kreis-alt': {
          id: 'kreis-alt',
          label: 'Fußbodenheizung EG',
          kind: 'floor',
          roomIds: ['r1', 'r2', 'r3', 'r4'],
          flowTemperature: 40,
          returnTemperature: 30,
          material: 'kupfer',
          mixed: true,
        } as HeatingCircuit,
      },
    };
    const a = anlageAusAntworten({ ...ANTWORTEN_VORGABE, kreise: ['gemischt'], pufferLiter: 200 }, bisher);
    const k = Object.values(a.circuits)[0];
    check('Anlagenfragen · der Kreis behält seine Kennung', k.id, 'kreis-alt');
    check('Anlagenfragen · der Kreis behält seinen Namen', k.label, 'Fußbodenheizung EG');
    check('Anlagenfragen · der Kreis behält seine Räume', k.roomIds.length, 4);
    check('Anlagenfragen · der Kreis behält seine Vorlauftemperatur', k.flowTemperature, 40);
    check('Anlagenfragen · der Kreis behält seine Rücklauftemperatur', k.returnTemperature, 30);
  }

  // =========================================================================
  // 6 · Die Rundreise
  // =========================================================================
  {
    /*
     * Antworten → Anlage → Antworten muss dasselbe ergeben. Sonst steht im
     * Feld beim nächsten Öffnen etwas anderes, als der Anwender eingetragen
     * hat — und genau das ist der Weg, auf dem eine ältere Projektdatei
     * gelesen wird.
     */
    const antworten: AnlagenAntworten = {
      bauform: 'hydrosplit',
      kaeltemittel: 'R32',
      inneneinheit: 'mit-heizstab',
      trinkwasserLiter: 250,
      kreise: ['gemischt', 'ungemischt'],
      pufferLiter: 120,
      pufferArt: 'buffer-series',
    };
    const a = anlageAusAntworten(antworten, LEER);
    const zurueck = antwortenAusAnlage(
      a.storages,
      a.circuits,
      antworten.bauform,
      antworten.kaeltemittel,
      antworten.inneneinheit,
    );
    check('Anlagenfragen · Rundreise Trinkwasser', zurueck.trinkwasserLiter, antworten.trinkwasserLiter);
    check('Anlagenfragen · Rundreise Puffer', zurueck.pufferLiter, antworten.pufferLiter);
    check('Anlagenfragen · Rundreise Pufferart', zurueck.pufferArt, antworten.pufferArt);
    check('Anlagenfragen · Rundreise Kreiszahl', zurueck.kreise.length, antworten.kreise.length);
    check('Anlagenfragen · Rundreise Kreisarten', zurueck.kreise.join('|'), antworten.kreise.join('|'));
  }

  // =========================================================================
  // 7 · Die Antwort gilt — der Hinweis ändert nichts
  // =========================================================================
  {
    const antworten: AnlagenAntworten = { ...ANTWORTEN_VORGABE, pufferLiter: 0 };
    const hin = abweichungen(antworten, { pufferLiter: 300, pufferGrund: 'Mindestwasserinhalt.' });

    check('Anlagenfragen · fehlender Puffer wird gemeldet', hin.filter((h) => h.feld === 'pufferLiter').length, 1);
    check(
      'Anlagenfragen · der Hinweis nennt die gerechnete Zahl',
      /300 l/.test(hin.find((h) => h.feld === 'pufferLiter')?.text ?? ''),
      true,
    );
    // Und der entscheidende Punkt: die Antwort ist unverändert.
    check('Anlagenfragen · die Antwort bleibt stehen', antworten.pufferLiter, 0);

    /*
     * Zu kleiner Puffer: gemeldet wird erst ab 10 % Unterschreitung. Ohne
     * diese Schwelle meldete jede Rundung — 195 statt 200 — eine Abweichung,
     * und nach der dritten liest niemand mehr hin.
     */
    const knapp = abweichungen({ ...ANTWORTEN_VORGABE, pufferLiter: 190 }, { pufferLiter: 200 });
    check('Anlagenfragen · 190 statt 200 l ist keine Meldung wert', knapp.filter((h) => h.feld === 'pufferLiter').length, 0);
    const deutlich = abweichungen({ ...ANTWORTEN_VORGABE, pufferLiter: 100 }, { pufferLiter: 300 });
    check('Anlagenfragen · 100 statt 300 l schon', deutlich.filter((h) => h.feld === 'pufferLiter').length, 1);
  }

  // =========================================================================
  // 8 · Das Kältemittel und die Bauart
  // =========================================================================
  {
    /*
     * Ein Monoblock führt Heizungswasser ins Haus — brennbares Kältemittel
     * bleibt draußen, es gibt nichts zu warnen. Ein Splitgerät führt das
     * Kältemittel ins Haus; dort gilt der Schutzbereich nach DIN EN 378.
     * Entschieden wird an der **Bauart**, nicht am Kältemittel — und zwar an
     * der Frage, was durch die Leitung ins Haus fließt. Die erste Fassung
     * fragte „hat das Gerät ein Innenteil"; die Antwort darauf ist bei jeder
     * Bauart ja, und der Hinweis kam deshalb immer.
     */
    check('Anlagenfragen · Monoblock mit R290 ohne Warnung', kaeltemittelHinweis('monoblock-outdoor', 'R290') === undefined, true);
    check('Anlagenfragen · Split mit R290 mit Warnung', typeof kaeltemittelHinweis('split', 'R290'), 'string');
    check('Anlagenfragen · Split mit R32 mit Warnung', typeof kaeltemittelHinweis('split', 'R32'), 'string');
    check('Anlagenfragen · Split mit R410A ohne Warnung', kaeltemittelHinweis('split', 'R410A') === undefined, true);
    check(
      'Anlagenfragen · die Warnung nennt die Norm',
      /DIN EN 378/.test(kaeltemittelHinweis('split', 'R290') ?? ''),
      true,
    );
  }

  // =========================================================================
  // 9 · Ein einzelner Kreis bekommt die beheizten Räume
  // =========================================================================
  {
    /*
     * Wer die Anlage vor dem Grundriss beschreibt, hat noch keine Räume. Gibt
     * es aber genau einen Kreis und beheizte Räume, gehören sie ihm — sonst
     * stünde eine Anlage da, die nichts versorgt, und die Auslegung rechnete
     * mit null.
     */
    const raeume = [
      { id: 'r1', isHeated: true },
      { id: 'r2', isHeated: true },
      { id: 'r3', isHeated: false },
    ] as never;
    const a = anlageAusAntworten(ANTWORTEN_VORGABE, LEER, raeume);
    const k = Object.values(a.circuits)[0];
    check('Anlagenfragen · der einzelne Kreis bekommt die beheizten Räume', k.roomIds.length, 2);
    check('Anlagenfragen · unbeheizte Räume bleiben draußen', k.roomIds.includes('r3'), false);

    // Bei zwei Kreisen wird nicht geraten: welcher welche Räume versorgt,
    // weiß nur der Anwender.
    const zwei = anlageAusAntworten({ ...ANTWORTEN_VORGABE, kreise: ['ungemischt', 'gemischt'] }, LEER, raeume);
    check('Anlagenfragen · bei zwei Kreisen wird nicht verteilt', Object.values(zwei.circuits)[0].roomIds.length, 0);
  }

  // =========================================================================
  // 9 · Die siebte Frage — Inneneinheit und Einbauort des Heizstabs
  // =========================================================================
  {
    /*
     * **Warum aus zwei Feldern eines wurde.** Bis 1.53.0 stand an dritter
     * Stelle ein Kästchen `heizstab: boolean`, und ob überhaupt eine
     * Inneneinheit im Haus steht, war gar nicht erfragt — das Schema
     * zeichnete sie immer. Damit war „keine Inneneinheit, aber Heizstab im
     * Gerät" ein eintragbarer Zustand ohne Bild.
     *
     * Die vier Fälle sind nicht gewählt, sondern abgezählt: Die Legende des
     * BWP-Leitfadens Hydraulik führt **zwei** Einbauorte — Zusatzheizung
     * Wärmepumpe im Vorlauf und Zusatzheizung Speicher im Behälter —, dazu
     * kommen die beiden Fälle ohne Stab (Einheit ohne Stab, gar keine
     * Einheit). Zwei plus zwei ist **vier**.
     */
    const FAELLE: readonly Inneneinheit[] = ['keine', 'ohne-heizstab', 'mit-heizstab', 'heizstab-speicher'];
    check('Anlagenfragen · vier Fälle der Inneneinheit', FAELLE.length, 4);
    check('Anlagenfragen · für jeden Fall eine Beschriftung', Object.keys(INNENEINHEIT_LABELS).length, 4);
    check(
      'Anlagenfragen · keine Beschriftung ist leer',
      FAELLE.filter((f) => !INNENEINHEIT_LABELS[f]).length,
      0,
    );

    /*
     * Der Heizstab folgt aus der Einheit, nicht neben ihr. Von Hand
     * abgezählt: Stab hat, wer ihn im Vorlauf (`mit-heizstab`) oder im
     * Speicher (`heizstab-speicher`) führt — das sind **zwei** der vier.
     */
    check('Anlagenfragen · zwei Fälle führen einen Heizstab', FAELLE.filter(hatHeizstab).length, 2);
    check('Anlagenfragen · ohne Einheit kein Stab', hatHeizstab('keine'), false);
    check('Anlagenfragen · Einheit ohne Stab hat keinen', hatHeizstab('ohne-heizstab'), false);
    check('Anlagenfragen · Stab im Vorlauf zählt', hatHeizstab('mit-heizstab'), true);
    check('Anlagenfragen · Stab im Speicher zählt auch', hatHeizstab('heizstab-speicher'), true);

    // Genau ein Fall ist „im Speicher" — sonst wäre die Fallunterscheidung
    // im Schema nicht eindeutig.
    check('Anlagenfragen · genau ein Einbauort im Speicher', FAELLE.filter(heizstabImSpeicher).length, 1);
    check('Anlagenfragen · der Stab im Vorlauf sitzt nicht im Speicher', heizstabImSpeicher('mit-heizstab'), false);

    // Und genau einer ist „keine Einheit" — drei von vier haben eine.
    check('Anlagenfragen · drei Fälle mit Inneneinheit', FAELLE.filter(hatInneneinheit).length, 3);

    // Die Vorbelegung ist der Regelfall des monoenergetischen Betriebs und
    // entspricht dem, was bis 1.53.0 `heizstab: true` bedeutete.
    check('Anlagenfragen · Vorgabe ist die Einheit mit Stab im Vorlauf', ANTWORTEN_VORGABE.inneneinheit, 'mit-heizstab');
    check('Anlagenfragen · und sie führt damit einen Stab', hatHeizstab(ANTWORTEN_VORGABE.inneneinheit), true);
  }

  // =========================================================================
  // 10 · Die ältere Projektdatei wandert
  // =========================================================================
  {
    /*
     * Eine Datei aus 1.51.0 bis 1.53.0 trägt `heizstab: true|false` und keine
     * `inneneinheit`. Verlöre sie beim Öffnen den Stab, verlöre der Verfasser
     * eine Aussage, die er getroffen hat — und die Stückliste ein Bauteil.
     *
     * `keine Inneneinheit` darf bei der Wanderung **nie** entstehen: Sie war
     * damals nicht eintragbar, und sie zu unterstellen hieße, eine Aussage zu
     * erfinden, die niemand gemacht hat.
     */
    const alt = (heizstab: boolean): AnlagenAntworten =>
      ({ ...ANTWORTEN_VORGABE, inneneinheit: undefined, heizstab }) as unknown as AnlagenAntworten;

    const mitStab = antwortenDes({ antworten: alt(true), storages: {}, circuits: {} });
    const ohneStab = antwortenDes({ antworten: alt(false), storages: {}, circuits: {} });

    check('Anlagenfragen · alte Datei mit Stab wird zur Einheit mit Stab', mitStab.inneneinheit, 'mit-heizstab');
    check('Anlagenfragen · alte Datei ohne Stab wird zur Einheit ohne Stab', ohneStab.inneneinheit, 'ohne-heizstab');
    check('Anlagenfragen · die Wanderung erfindet nie „keine Einheit"', [mitStab, ohneStab].filter((a) => a.inneneinheit === 'keine').length, 0);
    // Die übrigen Angaben bleiben unangetastet — gewandert wird ein Feld,
    // nicht die Datei.
    check('Anlagenfragen · der Trinkwasserspeicher übersteht die Wanderung', mitStab.trinkwasserLiter, ANTWORTEN_VORGABE.trinkwasserLiter);

    // Steht die neue Angabe schon in der Datei, wird nicht gewandert.
    const neu = antwortenDes({
      antworten: { ...ANTWORTEN_VORGABE, inneneinheit: 'heizstab-speicher' },
      storages: {},
      circuits: {},
    });
    check('Anlagenfragen · eine neue Datei wird nicht umgeschrieben', neu.inneneinheit, 'heizstab-speicher');

    // Ohne jede Angabe wird aus der Anlage gelesen — und das ergibt die
    // Vorbelegung, weil eine Anlage nichts über den Einbauort weiß.
    const leer = antwortenDes({ antworten: undefined, storages: {}, circuits: {} });
    check('Anlagenfragen · ohne Angaben gilt die Vorbelegung', leer.inneneinheit, ANTWORTEN_VORGABE.inneneinheit);
  }

  // =========================================================================
  // 11 · Was an der Inneneinheit nicht zusammengeht
  // =========================================================================
  {
    const zu = (i: Inneneinheit, rest: Partial<AnlagenAntworten> = {}): AnlagenAntworten => ({
      ...ANTWORTEN_VORGABE,
      inneneinheit: i,
      ...rest,
    });
    const anInneneinheit = (a: AnlagenAntworten) => abweichungen(a, {}).filter((h) => h.feld === 'inneneinheit');

    /*
     * **Keine Inneneinheit beim Splitgerät.** Dort steht der Verflüssiger im
     * Haus; ohne ihn endete die Kältemittelleitung nirgends. Erwartet wird
     * genau eine Meldung zu diesem Feld — die zum Widerspruch. Die Meldung
     * „ohne Zusatzheizer" kommt hier **zusätzlich**, weil `keine` auch keinen
     * Stab führt; von Hand abgezählt sind das **zwei**.
     */
    check('Anlagenfragen · keine Einheit beim Split wird gemeldet', anInneneinheit(zu('keine', { bauform: 'split' })).length, 2);
    // Beim Monoblock ist „keine Einheit" ungewöhnlich, aber kein
    // Widerspruch — dort bleibt nur die Meldung zum fehlenden Zusatzheizer.
    check('Anlagenfragen · beim Monoblock ist es kein Widerspruch', anInneneinheit(zu('keine', { bauform: 'monoblock-outdoor' })).length, 1);

    /*
     * **Stab im Speicher, aber kein Speicher.** Die Vorbelegung führt 200 l
     * Trinkwasser — damit gibt es einen Behälter, und es ist keine Meldung
     * fällig. Erst ohne beide Speicher fehlt der Ort.
     */
    check('Anlagenfragen · Stab im Trinkwasserspeicher ist in Ordnung', anInneneinheit(zu('heizstab-speicher')).length, 0);
    check(
      'Anlagenfragen · Stab im Speicher ohne jeden Speicher wird gemeldet',
      anInneneinheit(zu('heizstab-speicher', { trinkwasserLiter: 0, pufferLiter: 0 })).length,
      1,
    );
    check(
      'Anlagenfragen · mit Puffer allein genügt es',
      anInneneinheit(zu('heizstab-speicher', { trinkwasserLiter: 0, pufferLiter: 200 })).length,
      0,
    );

    // Der Regelfall meldet nichts.
    check('Anlagenfragen · die Einheit mit Stab im Vorlauf meldet nichts', anInneneinheit(zu('mit-heizstab')).length, 0);

    // Und der entscheidende Punkt, wie überall in diesem Block: Die Antwort
    // bleibt stehen. Ein Hinweis ändert sie nicht.
    const bleibt = zu('keine', { bauform: 'split' });
    anInneneinheit(bleibt);
    check('Anlagenfragen · der Hinweis ändert die Antwort nicht', bleibt.inneneinheit, 'keine');
  }

  // =========================================================================
  // 12 · Die Übergabeart folgt der Antwort — auch beim Ändern
  // =========================================================================
  {
    /*
     * **Der Fehler, der das hier nötig macht.** Bis 1.55.0 behielt ein
     * vorhandener Kreis seine Übergabeart, solange sich `mixed` nicht
     * änderte. Wer von „zwei Kreise, einer gemischt" auf „ein Kreis,
     * ungemischt" ging, behielt damit eine Fußbodenheizung, die er gerade
     * abgewählt hatte. Gemeldet am Bild: „er macht Fußbodenheizung obwohl
     * ungemischt."
     *
     * Die Kopplung steht schon zweimal im Programm — in der Ableitung und
     * im Hilfstext am Feld. Sie galt nur beim Anlegen.
     */
    const kreisMit = (kind: HeatingCircuit['kind'], mixed: boolean) => ({
      storages: {} as Record<string, PlantStorage>,
      circuits: {
        k1: {
          id: 'k1', label: 'Heizkreis 1', kind, mixed, roomIds: [], material: 'kupfer',
          flowTemperature: 45, returnTemperature: 35,
        } as HeatingCircuit,
      },
    });

    // Fläche war da, jetzt „ungemischt": Es wird ein Heizkörperkreis.
    const a = anlageAusAntworten({ ...ANTWORTEN_VORGABE, kreise: ['ungemischt'] }, kreisMit('floor', false));
    check('Anlagenfragen · ungemischt macht aus Fläche Heizkörper', Object.values(a.circuits)[0].kind, 'radiator');
    check('Anlagenfragen · und der Kreis bleibt ungemischt', Object.values(a.circuits)[0].mixed, false);

    // Umgekehrt ebenso.
    const b = anlageAusAntworten({ ...ANTWORTEN_VORGABE, kreise: ['gemischt'] }, kreisMit('radiator', false));
    check('Anlagenfragen · gemischt macht aus Heizkörper Fläche', Object.values(b.circuits)[0].kind, 'floor');
    check('Anlagenfragen · und der Kreis wird gemischt', Object.values(b.circuits)[0].mixed, true);

    /*
     * **Wand- und Gebläseheizflächen bleiben.** Über sie sagt die Frage
     * nichts; sie wegzudrehen wäre eine Antwort auf eine ungestellte Frage.
     */
    const c = anlageAusAntworten({ ...ANTWORTEN_VORGABE, kreise: ['ungemischt'] }, kreisMit('wall', true));
    check('Anlagenfragen · Wandheizung bleibt Wandheizung', Object.values(c.circuits)[0].kind, 'wall');
    const d = anlageAusAntworten({ ...ANTWORTEN_VORGABE, kreise: ['gemischt'] }, kreisMit('fancoil', false));
    check('Anlagenfragen · Gebläsekonvektor bleibt stehen', Object.values(d.circuits)[0].kind, 'fancoil');

    // Und das Übrige des Kreises übersteht die Änderung — Name und Räume
    // gehören dem Anwender, nicht der Frage.
    const e = anlageAusAntworten(
      { ...ANTWORTEN_VORGABE, kreise: ['ungemischt'] },
      {
        storages: {},
        circuits: {
          k1: {
            id: 'k1', label: 'Erdgeschoss Süd', kind: 'floor', mixed: false,
            roomIds: ['r1', 'r2'], material: 'kupfer', flowTemperature: 40, returnTemperature: 32,
          } as HeatingCircuit,
        },
      },
    );
    const k = Object.values(e.circuits)[0];
    check('Anlagenfragen · der Name bleibt', k.label, 'Erdgeschoss Süd');
    check('Anlagenfragen · die Räume bleiben', k.roomIds.length, 2);
    check('Anlagenfragen · die Temperaturen bleiben', k.flowTemperature, 40);
  }
}