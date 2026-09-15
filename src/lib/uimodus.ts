/**
 * Wie viel von diesem Programm jemand sehen will.
 * ---------------------------------------------------------------------------
 *
 * **Drei Stufen, nicht zwei.** Bisher gab es „Einfach" und „Fachplaner". Das
 * deckt zwei von drei Leuten ab, die dieses Programm benutzen — und
 * ausgerechnet den dritten nicht: den Handwerker, der ein Haus aufnimmt,
 * damit jemand anders die Heizlast rechnet. Er braucht keinen Bauteilkatalog,
 * kein Anlagenschema und kein Rohrnetz. Er braucht Wände, Fenster, Räume,
 * Heizkörper — und die Gewissheit, dass die Übergabe vollständig ist.
 *
 * Ihm die Fachplanerwerkzeuge auszublenden ist keine Bevormundung, sondern
 * die Antwort auf eine Beobachtung: Wer zwanzig Werkzeuge sieht und drei
 * braucht, sucht bei jedem Schritt. Und wer eine Schrittliste mit fünfzehn
 * Punkten vor sich hat, von denen sechs ihn nichts angehen, hält die Aufgabe
 * für unerledigt, obwohl sie fertig ist.
 *
 * **Warum Stufen und keine Häkchen.** Eine frei einstellbare Oberfläche wäre
 * die scheinbar freundlichere Lösung und in Wahrheit die schlechtere: Sie
 * verlangt vom Anwender eine Entscheidung über jedes einzelne Werkzeug,
 * bevor er weiß, was es tut. Drei Stufen sind eine Frage mit drei Antworten.
 *
 * Ausgeblendet heißt **nie gelöscht**. Ein Modell, das im Fachplanermodus
 * entstanden ist, behält im Handwerkermodus jedes Rohr, jede Wärmebrücke,
 * jeden Schemastrang; sie stehen nur nicht im Weg. Und der Wechsel zurück
 * kostet einen Klick.
 */

export type UiModus = 'handwerker' | 'einfach' | 'profi';

/** Je höher die Stufe, desto mehr ist zu sehen. */
export const UI_STUFE: Record<UiModus, number> = {
  handwerker: 1,
  einfach: 2,
  profi: 3,
};

/**
 * Reicht der eingestellte Modus mindestens bis zu dieser Stufe?
 *
 * Für Stellen in der Oberfläche, die eine Zusatzangabe nur ab einer
 * bestimmten Stufe zeigen — etwa den Fehlercode am Prüfbefund. Sie standen
 * als `uiMode === 'profi'` in der Oberfläche; das ist heute dasselbe und
 * wäre beim nächsten Modus still falsch, weil „ist genau Fachplaner" und
 * „ist mindestens Fachplaner" sich erst dann unterscheiden.
 */
export function mindestens(modus: UiModus, stufe: UiModus): boolean {
  return UI_STUFE[modus] >= UI_STUFE[stufe];
}

export const UI_MODUS_LABELS: Record<UiModus, string> = {
  handwerker: 'Handwerker',
  einfach: 'Einfach',
  profi: 'Fachplaner',
};

export const UI_MODUS_AUSKUNFT: Record<UiModus, string> = {
  handwerker:
    'Alles, was für die Heizlastübergabe gebraucht wird, und sonst nichts: Wände, Fenster und Türen, Räume, Heizkörper, Prüfung, Übergabe. Anlage, Rohrnetz, Schema und Bauteilkatalog sind ausgeblendet — sie werden nicht gelöscht, sie stehen nur nicht im Weg.',
  einfach:
    'Zeigt, was für die Aufnahme eines Gebäudes gebraucht wird. Wärmebrücken, Lüftung, Bauteilkatalog, Geschosse und Rohrnetz sind ausgeblendet — sie werden nicht gelöscht, nur nicht angezeigt.',
  profi: 'Alle Reiter und Werkzeuge sind sichtbar — nichts ist ausgeblendet.',
};

/**
 * Die Werkzeuge, die der Handwerkermodus zeigt.
 *
 * Bewusst eine **Liste** und keine abgeleitete Regel: Welches Werkzeug ein
 * Aufmaß braucht, folgt aus der Arbeit und nicht aus einer Eigenschaft des
 * Werkzeugs. Eine Regel („alles, was Geometrie erzeugt") nähme das
 * Rohrwerkzeug mit und ließe das Kalibrieren weg — beides falsch herum.
 *
 * `calibrate` ist dabei, weil ein Aufmaß oft mit einem abfotografierten
 * Grundriss beginnt und ohne Maßstab jede Länge daran geraten ist.
 * `annotation` — „Text & Maßkette" — ist dabei, weil ein Maß von Hand
 * anzuschreiben keine Fachplanerfunktion ist, sondern das Erste, was jemand
 * beim Aufmaß auf einem Plan tut. Das Freihandwerkzeug `ink` („Auf den Plan
 * schreiben") fehlt dagegen: Seine Striche werden nie zu Geometrie und
 * gehen in keine Übergabe ein.
 */
export const HANDWERKER_WERKZEUGE: readonly string[] = [
  'select',
  'wall',
  'sketch',
  'room',
  'door',
  'window',
  'passage',
  'fixture',
  'stair',
  'solid',
  'annotation',
  'calibrate',
  'pan',
];

/**
 * Die Reiter des Inspektors im Handwerkermodus.
 *
 * `layers` ist dabei — dort sitzt „Bestand sperren", und genau das braucht,
 * wer erst aufmisst und dann die Heizkörper setzt. `reference` ist dabei,
 * weil dort der abfotografierte Grundriss liegt.
 */
export const HANDWERKER_REITER: readonly string[] = [
  'guide',
  'properties',
  'tga',
  'rooms',
  'check',
  'reference',
  'layers',
];

/** Zeigt dieser Modus ein Werkzeug mit dieser Kennung? */
export function zeigtWerkzeug(modus: UiModus, id: string, einfach: boolean): boolean {
  if (modus === 'profi') return true;
  if (modus === 'handwerker') return HANDWERKER_WERKZEUGE.includes(id);
  return einfach;
}

/** Zeigt dieser Modus einen Reiter mit dieser Kennung? */
export function zeigtReiter(modus: UiModus, id: string, einfach: boolean): boolean {
  if (modus === 'profi') return true;
  if (modus === 'handwerker') return HANDWERKER_REITER.includes(id);
  return einfach;
}

/**
 * Die Schritte, die zur Heizlastübergabe gehören.
 *
 * Die Namen sind die Überschriften der Schrittliste. Eine Kopie der Titel
 * statt einer Kennung am Schritt ist hier das kleinere Übel: Die Liste
 * entsteht in der Oberfläche aus dem Modellzustand, und ihr eine zweite
 * Ordnungsebene zu geben hieße, jeden Schritt zweimal zu pflegen. Wer einen
 * Titel ändert, muss ihn hier mitändern — und merkt es sofort, weil der
 * Schritt im Handwerkermodus verschwindet.
 */
export const UEBERGABE_SCHRITTE: readonly string[] = [
  'Grundriss zeichnen',
  'Alle Räume geschlossen',
  'Wandstärken bestätigen',
  'Fenster und Türen setzen',
  'Räume benennen und Nutzung wählen',
  'Heizkörper eintragen',
  'Wände gerade ziehen',
  'Prüfung ohne Fehler',
  'An RaVia übergeben',
];
