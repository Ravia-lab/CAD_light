/**
 * Prüfblock „UI-Modus" — wie viel von diesem Programm jemand zu sehen bekommt.
 *
 * **Worum es geht.** `src/lib/uimodus.ts` beantwortet zwei Fragen, die die
 * Oberfläche bei jedem Aufbau stellt: Zeigt diese Stufe dieses Werkzeug? Zeigt
 * sie diesen Reiter? Dahinter stehen drei Stufen — Handwerker, Einfach,
 * Fachplaner — und zwei Listen von Kennungen, die den Handwerkermodus
 * ausmachen.
 *
 * **Warum es diesen Block gibt.** Jeder Fehler in diesem Modul ist still. Es
 * wirft nichts, es rechnet nichts falsch, es malt nichts Verkehrtes — es
 * *zeigt* etwas nicht:
 *
 *  • **Ein Tippfehler in einer Kennung** (`'windwo'` statt `'window'`,
 *    `'room'` statt `'rooms'`) übersetzt anstandslos: Beide Listen sind
 *    `readonly string[]`, und `includes` auf einer Zeichenkette, die es
 *    nirgends gibt, liefert schlicht `false`. Im Programm äußert sich das als
 *    „das Fensterwerkzeug fehlt" — an einer Stelle, an der nichts auf das
 *    Modul zeigt, in dem der Fehler steht. Wer sucht, sucht in der
 *    Werkzeugleiste.
 *  • **Eine Liste, die zu wenig enthält**, macht aus dem reduzierten Modus
 *    einen kaputten: Ohne `wall` kann der Handwerker nichts aufnehmen, ohne
 *    `pan` nichts betrachten, ohne `check` nicht sehen, ob seine Aufnahme
 *    trägt. Der Modus sieht dabei völlig in Ordnung aus — er ist ja gerade
 *    dafür da, wenig zu zeigen.
 *  • **Eine Stufe, die sich nicht an ihre Zusage hält**, ist die andere
 *    Richtung: Blendet `profi` irgendetwas aus, gibt es im ganzen Programm
 *    keine Stufe mehr, die alles zeigt — und keinen Ort, an dem man das
 *    fehlende Werkzeug wiederfände.
 *  • **Ein fehlender Übergabeschritt** nimmt dem Handwerkermodus seinen
 *    Zweck: Steht „An RaVia übergeben" nicht in der Liste, endet die
 *    Schrittliste vor dem einzigen Schritt, für den der Modus gebaut wurde.
 *
 * **Warum die Kennungen hier von Hand stehen.** Die Werkzeuge stehen in
 * `TOOLS` (`src/components/Toolbar.tsx`), die Reiter in `TABS`
 * (`src/App.tsx`). Ein Import von dort wäre die kürzeste Zeile und die
 * falsche: `src/lib`, `src/types` und `scripts` gehen als eigenständiges Paket
 * an die Gegenstelle (`build_kernel.py`, festgehalten in
 * `scripts/pruefungen/schichtgrenze.ts`), und ein Prüfblock, der aus
 * `src/components` importiert, zerreißt dieses Paket.
 *
 * Die Handabschrift ist hier aber nicht nur der erzwungene Umweg, sondern die
 * eigentliche Prüfung: Sie ist die **zweite, unabhängige Stimme**. Eine Zeile,
 * die ihre Erwartung aus derselben Liste holt, die sie prüft, bestätigt nur,
 * dass die Liste sich selbst gleicht — ein Tippfehler in `HANDWERKER_WERKZEUGE`
 * fiele damit nirgends auf, denn er ist eine gültige Zeichenkette und
 * verschwindet lautlos in einem `includes`, das `false` sagt. Erst der
 * Abgleich mit einer zweiten, von Hand geführten Liste macht ihn zu einer
 * Abweichung zwischen zwei Stellen, die sich einig sein müssen.
 *
 * **Bei einer Änderung an `TOOLS` oder `TABS` sind die beiden Listen unten
 * mitzupflegen.** Das ist Absicht und keine Last: Wer ein Werkzeug hinzufügt,
 * muss sich einmal fragen, ob der Handwerker es braucht.
 *
 * **Was dieser Block nicht prüft.** Wie die Werkzeugleiste aussieht, in
 * welcher Reihenfolge die Reiter stehen und welches Sinnbild an welchem
 * Knopf klebt — das gehört in die Oberfläche. Und ob der aktive Reiter beim
 * Stufenwechsel weiterspringt, wenn er verschwindet: Das ist eine Zusage von
 * `App.tsx` und steht dort.
 */

import type { CheckFn } from './typ';
import type { UiModus } from '../../src/lib/uimodus';
import {
  HANDWERKER_REITER,
  HANDWERKER_WERKZEUGE,
  UEBERGABE_SCHRITTE,
  UI_MODUS_AUSKUNFT,
  UI_MODUS_LABELS,
  UI_STUFE,
  zeigtReiter,
  zeigtWerkzeug,
} from '../../src/lib/uimodus';

// ---------------------------------------------------------------------------
// Die drei Stufen
// ---------------------------------------------------------------------------

/**
 * Die Stufen in ihrer Ordnung, von der kleinsten zur größten.
 *
 * Von Hand geführt und nicht aus `UI_STUFE` gelesen: Die Reihenfolge ist die
 * Aussage, die Abschnitt A prüft, und eine Liste, die sich ihre Reihenfolge
 * aus dem Prüfling holt, prüft keine.
 */
const ALLE_STUFEN: readonly UiModus[] = ['handwerker', 'einfach', 'profi'];

// ---------------------------------------------------------------------------
// Die Kennungen der Oberfläche — Handabschrift aus TOOLS und TABS
// ---------------------------------------------------------------------------

/**
 * Die neunzehn Werkzeugkennungen aus `TOOLS` (`src/components/Toolbar.tsx`).
 *
 * **Abschrift von Hand, bei einer Änderung dort mitzupflegen.** Ein Import ist
 * ausgeschlossen (siehe Kopfkommentar). Die Reihenfolge ist die der
 * Werkzeugleiste, damit der Abgleich mit dem Auge in einem Durchgang geht.
 */
const WERKZEUGKENNUNGEN: readonly string[] = [
  'select',
  'wall',
  'sketch',
  'ink',
  'room',
  'door',
  'window',
  'passage',
  'fixture',
  'stair',
  'shaft',
  'solid',
  'durchbruch',
  'pipe',
  'annotation',
  'calibrate',
  'heatpump',
  'site',
  'pan',
];

/**
 * Die dreizehn Reiterkennungen aus `TABS` (`src/App.tsx`).
 *
 * Ebenfalls von Hand abgeschrieben und bei einer Änderung dort mitzupflegen.
 */
const REITERKENNUNGEN: readonly string[] = [
  'guide',
  'properties',
  'tga',
  'rooms',
  'roof',
  'constructions',
  'bridges',
  'ventilation',
  'heatpump',
  'anlage',
  'check',
  'reference',
  'layers',
];

const WERKZEUGE_DER_LEISTE = new Set<string>(WERKZEUGKENNUNGEN);
const REITER_DES_INSPEKTORS = new Set<string>(REITERKENNUNGEN);

const IM_HANDWERKERMODUS = new Set<string>(HANDWERKER_WERKZEUGE);
const REITER_IM_HANDWERKERMODUS = new Set<string>(HANDWERKER_REITER);

// ---------------------------------------------------------------------------
// Die Prüfungen
// ---------------------------------------------------------------------------

export function pruefeUiModus(check: CheckFn): void {
  // === A — Die drei Stufen ordnen sich ====================================
  //
  // Die Zahlen selbst sind gleichgültig; ihre Ordnung ist es nicht. Sie ist
  // das Einzige, woran die Oberfläche „mindestens einfach" festmachen kann,
  // und eine vertauschte Reihenfolge machte aus jedem solchen Vergleich das
  // Gegenteil — der Fachplaner bekäme den kleinsten Ausschnitt.
  check('Es gibt drei Stufen', ALLE_STUFEN.length, 3);
  check('… und die Stufentafel führt genau diese drei', Object.keys(UI_STUFE).length, 3);
  check('Der Handwerker steht unter dem Einfachen', UI_STUFE.handwerker < UI_STUFE.einfach, true);
  check('Das Einfache steht unter dem Fachplaner', UI_STUFE.einfach < UI_STUFE.profi, true);
  // Und die Kette noch einmal als Ganzes: Zwei einzelne Vergleiche ließen den
  // Fall durch, in dem eine Stufe mit einer anderen gleichauf liegt.
  check(
    'Die Stufen sind drei verschiedene Zahlen',
    new Set(ALLE_STUFEN.map((m) => UI_STUFE[m])).size,
    3,
  );

  /*
   * Beschriftung und Auskunft für jede Stufe.
   *
   * Beide stehen an der Stufenwahl und sind das Einzige, was erklärt, was ein
   * Umschalten bewirkt. Eine leere Beschriftung macht den Knopf nicht kaputt —
   * er bleibt bedienbar, nur steht nichts darauf, und der Anwender probiert
   * dann aus, was die drei Stufen unterscheidet.
   *
   * Vierzig Zeichen sind die Grenze für die Auskunft. Sie ist knapp gewählt:
   * Der Fachplanertext („Alle Reiter und Werkzeuge sind sichtbar.") liegt
   * genau darauf, und er ist der kürzeste, der noch eine Aussage trifft. Alles
   * darunter wäre eine Wiederholung der Beschriftung.
   */
  for (const modus of ALLE_STUFEN) {
    check(`Stufe „${modus}" hat eine Beschriftung`, UI_MODUS_LABELS[modus].trim().length > 0, true);
    check(`Stufe „${modus}" hat eine Auskunft`, UI_MODUS_AUSKUNFT[modus].trim().length > 0, true);
    check(`… von mindestens 40 Zeichen`, UI_MODUS_AUSKUNFT[modus].trim().length >= 40, true);
    // Sie endet als Satz. Ein abgeschnittener Text — der häufigste Fehler beim
    // Umformulieren — endet ohne Punkt und fällt hier auf.
    check(`… und endet als Satz`, UI_MODUS_AUSKUNFT[modus].trim().endsWith('.'), true);
  }

  // Unterscheidbar müssen sie sein: Zwei gleiche Texte an zwei Stufen sind
  // schlimmer als gar keiner, weil sie behaupten, die Stufen täten dasselbe.
  check('Die drei Beschriftungen sind verschieden', new Set(ALLE_STUFEN.map((m) => UI_MODUS_LABELS[m])).size, 3);
  check('Die drei Auskünfte sind verschieden', new Set(ALLE_STUFEN.map((m) => UI_MODUS_AUSKUNFT[m])).size, 3);

  // === B — Was welche Stufe zeigt =========================================
  //
  // **Der Fachplaner zeigt alles.** Das ist die Zusage der Stufe und nicht
  // nur ihre derzeitige Wirkung: Sie ist der Ort, an dem man ein Werkzeug
  // wiederfindet, das man woanders vermisst. Geprüft wird sie deshalb an den
  // Fällen, die ihr am ehesten entkämen — an einem Werkzeug, das weder auf
  // der Handwerkerliste steht noch „einfach" ist, und an einer Kennung, die
  // es überhaupt nicht gibt. Eine Fassung, die irgendwo doch nachschlüge,
  // fiele hier.
  check('Der Fachplaner zeigt das Rohrwerkzeug', zeigtWerkzeug('profi', 'pipe', false), true);
  check('… auch den Schacht', zeigtWerkzeug('profi', 'shaft', false), true);
  check('… auch den Reiter Wärmebrücken', zeigtReiter('profi', 'bridges', false), true);
  check('… und selbst eine unbekannte Kennung', zeigtWerkzeug('profi', 'gibtsnicht', false), true);
  check('… bei den Reitern ebenso', zeigtReiter('profi', 'gibtsnicht', false), true);
  // Und die Zusage über alle Kennungen der Oberfläche auf einmal, jeweils mit
  // dem ungünstigsten Merkmal: Der Fachplaner blendet nichts aus.
  check(
    'Der Fachplaner blendet kein Werkzeug aus',
    WERKZEUGKENNUNGEN.filter((id) => !zeigtWerkzeug('profi', id, false)).join(', ') || 'keins',
    'keins',
  );
  check(
    'Der Fachplaner blendet keinen Reiter aus',
    REITERKENNUNGEN.filter((id) => !zeigtReiter('profi', id, false)).join(', ') || 'keiner',
    'keiner',
  );

  /*
   * **Der Handwerkermodus zeigt genau seine Liste — beide Richtungen.**
   *
   * Das übergebene Merkmal `einfach` ist für ihn ohne Bedeutung. Die beiden
   * Zeilen darunter sind die Gegenproben dazu, und sie sind der Grund, warum
   * hier überhaupt etwas zu prüfen ist:
   *
   *  • `calibrate` steht in `TOOLS` **ohne** `simple`, ist also nicht
   *    „einfach" — und trotzdem im Handwerkermodus, weil ein Aufmaß oft mit
   *    einem abfotografierten Grundriss beginnt und ohne Maßstab jede Länge
   *    daran geraten ist.
   *  • `durchbruch` steht in `TOOLS` **mit** `simple: true`, ist also
   *    „einfach" — und trotzdem nicht im Handwerkermodus, weil Kernbohrungen
   *    aus der Auslegung folgen und nicht aus dem Aufmaß.
   *
   * **Das ist keine Verschachtelung der beiden Stufen.** Die Handwerkerliste
   * ist *keine Teilmenge* von „einfach", sondern eine eigene Auswahl: Die
   * eine Frage lautet „Was braucht, wer ein Gebäude aufnimmt?", die andere
   * „Was braucht, wer ohne Fachplanung zurechtkommen will?". Zwei Fragen,
   * zwei Antworten, die sich überschneiden und nicht ineinanderliegen. Eine
   * Fassung, die den Handwerkermodus als „einfach, aber weniger" schriebe
   * (`einfach && HANDWERKER_WERKZEUGE.includes(id)`), verlöre das Kalibrieren
   * — und zwar an genau der Stelle, an der der Handwerker anfängt.
   */
  check('Der Handwerker kalibriert, obwohl das nicht „einfach" ist', zeigtWerkzeug('handwerker', 'calibrate', false), true);
  check('… und setzt keine Durchbrüche, obwohl die „einfach" sind', zeigtWerkzeug('handwerker', 'durchbruch', true), false);
  check('… auch keine Wärmepumpe, obwohl die „einfach" ist', zeigtWerkzeug('handwerker', 'heatpump', true), false);
  check('Beim Reiter Anlage dasselbe: „einfach", aber nicht bei ihm', zeigtReiter('handwerker', 'anlage', true), false);
  check('… und die Ebenen sieht er, unabhängig vom Merkmal', zeigtReiter('handwerker', 'layers', false), true);

  /*
   * Dieselbe Aussage systematisch, eine Zeile je Kennung: Für jedes Werkzeug
   * der Leiste muss `zeigtWerkzeug` im Handwerkermodus genau dann `true`
   * sagen, wenn die Kennung auf der Liste steht — und zwar mit `einfach` in
   * beiden Stellungen. Wer den Vergleich zweimal mit demselben Merkmal
   * führte, sähe nicht, dass es ignoriert wird.
   */
  for (const id of WERKZEUGKENNUNGEN) {
    const soll = IM_HANDWERKERMODUS.has(id);
    check(
      `Werkzeug „${id}" im Handwerkermodus: ${soll ? 'sichtbar' : 'ausgeblendet'}`,
      zeigtWerkzeug('handwerker', id, false) === soll && zeigtWerkzeug('handwerker', id, true) === soll,
      true,
    );
  }
  for (const id of REITERKENNUNGEN) {
    const soll = REITER_IM_HANDWERKERMODUS.has(id);
    check(
      `Reiter „${id}" im Handwerkermodus: ${soll ? 'sichtbar' : 'ausgeblendet'}`,
      zeigtReiter('handwerker', id, false) === soll && zeigtReiter('handwerker', id, true) === soll,
      true,
    );
  }

  /*
   * **Der einfache Modus folgt allein dem übergebenen Merkmal.**
   *
   * Er führt keine eigene Liste, und er darf sich auch nicht an der des
   * Handwerkers bedienen. Die Proben sind deshalb mit Absicht über Kreuz
   * gewählt: `wall` steht auf der Handwerkerliste und wird hier mit
   * `einfach = false` ausgeblendet, `pipe` steht nicht darauf und wird mit
   * `einfach = true` gezeigt. Eine Fassung, die die Handwerkerliste
   * mitbenutzte, fiele bei beiden Zeilen.
   */
  check('Einfach zeigt, was „einfach" ist', zeigtWerkzeug('einfach', 'pipe', true), true);
  check('… und zeigt nicht, was es nicht ist', zeigtWerkzeug('einfach', 'wall', false), false);
  check('Bei den Reitern ebenso', zeigtReiter('einfach', 'bridges', true), true);
  check('… und ebenso andersherum', zeigtReiter('einfach', 'guide', false), false);

  // === C — Die Listen sind frei von Tippfehlern ===========================
  //
  // Der Abgleich gegen die Handabschrift oben. Hier fällt auf, was sonst
  // nirgends auffällt: eine Kennung, die es in der Oberfläche nicht gibt.
  // Sie wirft nichts, sie meldet nichts — sie führt dazu, dass ein Werkzeug
  // fehlt, und zwar an einer Stelle, an der niemand nach diesem Modul sucht.
  //
  // Zuerst die Abschriften selbst: neunzehn und dreizehn Einträge, jeder
  // genau einmal. Eine doppelte Kennung machte den Abgleich schwächer, ohne
  // dass es auffiele.
  check('Die Abschrift aus TOOLS hat neunzehn Werkzeuge', WERKZEUGKENNUNGEN.length, 19);
  check('… und jede Kennung kommt genau einmal vor', WERKZEUGE_DER_LEISTE.size, 19);
  check('Die Abschrift aus TABS hat dreizehn Reiter', REITERKENNUNGEN.length, 13);
  check('… und jede Kennung kommt genau einmal vor', REITER_DES_INSPEKTORS.size, 13);

  // Gemeldet wird die Kennung selbst und nicht nur eine Anzahl: Bei einem
  // Tippfehler ist der Name die ganze Auskunft.
  check(
    'Jedes Handwerkerwerkzeug gibt es in TOOLS',
    HANDWERKER_WERKZEUGE.filter((id) => !WERKZEUGE_DER_LEISTE.has(id)).join(', ') || 'keins',
    'keins',
  );
  check(
    'Jeder Handwerkerreiter gibt es in TABS',
    HANDWERKER_REITER.filter((id) => !REITER_DES_INSPEKTORS.has(id)).join(', ') || 'keiner',
    'keiner',
  );

  // === D — Keine Doppelten ================================================
  //
  // Eine doppelte Kennung ändert an der Wirkung nichts — `includes` sagt
  // weiterhin `true` — und ist trotzdem ein Fehler: Sie ist fast immer die
  // Spur einer halb durchgeführten Änderung („umbenannt, aber die alte Zeile
  // steht noch"), und sie macht jede Zählung an dieser Liste unbrauchbar.
  check('Kein Handwerkerwerkzeug steht doppelt', IM_HANDWERKERMODUS.size, HANDWERKER_WERKZEUGE.length);
  check('Kein Handwerkerreiter steht doppelt', REITER_IM_HANDWERKERMODUS.size, HANDWERKER_REITER.length);

  // === E — Der Handwerkermodus bleibt benutzbar ===========================
  //
  // Bis hierher war jede Zeile eine Aussage über Form und Schreibweise. Dieser
  // Abschnitt ist die einzige inhaltliche Forderung des Blocks: Ein
  // reduzierter Modus, dem eines dieser Werkzeuge fehlt, ist kein reduziertes
  // Werkzeug mehr, sondern ein kaputtes. Jede Forderung mit ihrem Grund.
  //
  // Geprüft wird über `zeigtWerkzeug` und nicht über die Liste: Der Anwender
  // fragt nicht die Liste, er fragt die Oberfläche.
  //
  // … ohne Auswählen kann er nichts anfassen, was er gezeichnet hat:
  check('Der Handwerker kann auswählen', zeigtWerkzeug('handwerker', 'select', false), true);
  // … ohne Wandwerkzeug entsteht kein Grundriss, und ohne Grundriss gibt es
  // nichts zu übergeben:
  check('… Wände zeichnen', zeigtWerkzeug('handwerker', 'wall', false), true);
  // … Fenster und Tür sind die Öffnungen, aus denen der größte Einzelposten
  // der Heizlast entsteht — eine Aufnahme ohne sie ist wertlos:
  check('… Fenster setzen', zeigtWerkzeug('handwerker', 'window', false), true);
  check('… Türen setzen', zeigtWerkzeug('handwerker', 'door', false), true);
  // … ohne das TGA-Werkzeug bleibt der Bestand an Heizkörpern ungenannt, und
  // genau danach fragt die Auslegung:
  check('… Heizkörper eintragen', zeigtWerkzeug('handwerker', 'fixture', false), true);
  // … ohne Verschieben der Ansicht endet der Plan am Bildschirmrand:
  check('… und die Ansicht verschieben', zeigtWerkzeug('handwerker', 'pan', false), true);

  // Bei den Reitern dasselbe.
  //
  // … die Schrittliste ist sein Leitfaden — sie sagt ihm, was noch fehlt, und
  // sie ist der einzige Ort, an dem die Übergabe angestoßen wird:
  check('Der Handwerker sieht die Schrittliste', zeigtReiter('handwerker', 'guide', false), true);
  // … ohne den Objektreiter lässt sich an nichts Ausgewähltem etwas ändern —
  // Wandstärke, Fenstermaß, Brüstungshöhe stehen alle dort:
  check('… den Objektreiter', zeigtReiter('handwerker', 'properties', false), true);
  // … ohne die Prüfung weiß er nicht, ob seine Aufnahme rechenfähig ist, und
  // erfährt es erst von dem, der die Heizlast rechnet:
  check('… die Prüfung', zeigtReiter('handwerker', 'check', false), true);
  // … ohne die Raumliste bleiben Name und Nutzung ungesetzt, und die Nutzung
  // bestimmt die Solltemperatur jedes Raums:
  check('… und die Raumliste', zeigtReiter('handwerker', 'rooms', false), true);

  // === F — Die Schritte der Übergabe ======================================
  //
  // Die Liste führt die Überschriften der Schrittliste, die im
  // Handwerkermodus stehen bleiben. Ein Titel, der hier fehlt, verschwindet
  // dort — der Schritt ist dann nicht erledigt, sondern unsichtbar.
  check('Die Übergabeliste ist nicht leer', UEBERGABE_SCHRITTE.length > 0, true);
  check('… und nennt keinen Schritt doppelt', new Set(UEBERGABE_SCHRITTE).size, UEBERGABE_SCHRITTE.length);

  const schritte = new Set<string>(UEBERGABE_SCHRITTE);

  /*
   * Die drei Schritte, an denen die Übergabe hängt. Sie stehen hier
   * ausgeschrieben, weil sie Titel und keine Kennungen sind: Wer einen Titel
   * in der Oberfläche umformuliert, muss ihn in `UEBERGABE_SCHRITTE`
   * mitändern, und diese drei Zeilen sind die Stelle, an der das auffällt,
   * bevor der Schritt beim Handwerker verschwindet.
   */
  // Ohne Geometrie geht nichts — kein Raum, keine Fläche, keine Heizlast:
  check('Der Grundriss steht in der Übergabe', schritte.has('Grundriss zeichnen'), true);
  // Die Raumnutzung bestimmt die Solltemperatur; ohne sie rechnet die
  // Gegenstelle das Bad wie den Flur:
  check('Die Raumnutzung auch', schritte.has('Räume benennen und Nutzung wählen'), true);
  // Und der letzte Schritt ist der Zweck des ganzen Modus:
  check('Und die Übergabe selbst', schritte.has('An RaVia übergeben'), true);

  /*
   * Und die Gegenrichtung: Was der Handwerker nicht tut, darf ihm die
   * Schrittliste auch nicht vorhalten.
   *
   * Das ist die Beobachtung, aus der der Modus entstanden ist — wer eine
   * Liste mit fünfzehn Punkten vor sich hat, von denen sechs ihn nichts
   * angehen, hält die Aufgabe für unerledigt, obwohl sie fertig ist. Rohrnetz,
   * Anlage, Schema und Mappe sind die vier, die dabei aufgefallen sind; sie
   * setzen alle eine Auslegung voraus, die der Handwerker gar nicht macht.
   */
  const fremde = ['Rohrnetz auslegen', 'Anlage auslegen', 'Schema vorschlagen lassen', 'Mappe drucken'];
  for (const titel of fremde) {
    check(`„${titel}" gehört nicht zur Übergabe`, schritte.has(titel), false);
  }
  // Noch einmal als eine Zeile, damit im Protokoll steht, welcher der vier
  // durchgerutscht ist, und nicht nur, dass einer durchgerutscht ist.
  check(
    'Kein Auslegungsschritt in der Übergabeliste',
    fremde.filter((t) => schritte.has(t)).join(', ') || 'keiner',
    'keiner',
  );
}
