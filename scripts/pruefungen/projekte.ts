/**
 * Prüfblock für `src/lib/projectStore.ts` — die Projektverwaltung.
 *
 * Warum dieser Block gebraucht wird: hier hängt die Arbeit mehrerer Abende an
 * einem Speicher, der klein ist, jederzeit voll sein kann und dessen Inhalt
 * niemand sieht. Ein Fehler äußert sich nicht als falsche Zahl, sondern als
 * verschwundenes Projekt — und wer das bemerkt, hat es schon verloren.
 * Deshalb wird jede Zusage des Moduls gegen den Fall geprüft, der sie bricht:
 *
 *  1. Anlegen, Auflisten, Umbenennen, Duplizieren, Löschen tun, was sie sagen.
 *  2. Der Name ist eindeutig — zwei Projekte „Wohnung“ sind eine Falle.
 *  3. `meta.name` und der Name in der Liste sind dasselbe, nach jedem Weg.
 *  4. Ein kaputter Eintrag stürzt nicht ab, sondern wird gemeldet — und
 *     reißt die übrigen Projekte nicht mit.
 *  5. Der volle Speicher liefert `grund: 'voll'` mit einem Satz, den man
 *     anzeigen kann, und **lässt den alten Stand unberührt**. Ein halb
 *     geschriebenes Projekt wäre schlimmer als ein abgelehnter Schreibvorgang.
 *  6. Die Liste steht nach Änderungsdatum, das zuletzt Bearbeitete oben.
 *
 * Der Speicher ist eine Attrappe, die hier — und nur hier — gebaut wird: eine
 * Attrappe im Modul landet sonst irgendwann im Auslieferungsstand. Sie kann
 * das, was `localStorage` kann, und zusätzlich das, was er in der Praxis tut:
 * bei Überschreitung einer Grenze eine Quota-Ausnahme werfen.
 *
 * Sollwerte sind hergeleitet, nicht abgeschrieben: die Größenaussagen rechnen
 * mit `BYTES_JE_ZEICHEN` und `ANGENOMMENE_GRENZE_BYTES` aus dem Modul, die
 * Umfangszahlen kommen aus dem Referenzhaus.
 */

import type { CheckFn } from './typ';
import type { BimDocument } from '../../src/types/bim';
import {
  ANGENOMMENE_GRENZE_BYTES,
  BYTES_JE_ZEICHEN,
  aktivesProjekt,
  baueVorschau,
  benenneProjektUm,
  dupliziereProjekt,
  eindeutigerName,
  formatBytes,
  ladeProjekt,
  legeProjektAn,
  listeProjekte,
  loescheProjekt,
  setzeAktivesProjekt,
  setzeSpeicher,
  speichereProjekt,
  speicherBericht,
  type SpeicherAdapter,
} from '../../src/lib/projectStore';
import { buildReferenceDocument } from '../reference';

// ---------------------------------------------------------------------------
// Die Attrappe
// ---------------------------------------------------------------------------

/**
 * Ein `localStorage` im Arbeitsspeicher, mit einstellbarer Obergrenze.
 *
 * Die Grenze wird in Zeichen geführt, weil die Browser die UTF-16-Darstellung
 * zählen und das Modul genauso rechnet. `setItem` wirft bei Überschreitung
 * eine Ausnahme mit `name = 'QuotaExceededError'` — so meldet sich Chrome; die
 * Erkennung im Modul deckt daneben die Firefox-Schreibweise ab.
 */
class SpeicherAttrappe implements SpeicherAdapter {
  private daten = new Map<string, string>();
  /** Zählt Schreibversuche — damit sich „hat gar nicht erst geschrieben“ zeigen lässt. */
  public versuche = 0;

  constructor(private grenzeZeichen = Number.POSITIVE_INFINITY) {}

  get length(): number {
    return this.daten.size;
  }

  key(index: number): string | null {
    return Array.from(this.daten.keys())[index] ?? null;
  }

  getItem(schluessel: string): string | null {
    return this.daten.get(schluessel) ?? null;
  }

  setItem(schluessel: string, wert: string): void {
    this.versuche++;
    let belegt = 0;
    for (const [k, v] of this.daten) {
      if (k === schluessel) continue;
      belegt += k.length + v.length;
    }
    if (belegt + schluessel.length + wert.length > this.grenzeZeichen) {
      const fehler = new Error('Der Speicher ist voll');
      fehler.name = 'QuotaExceededError';
      throw fehler;
    }
    this.daten.set(schluessel, wert);
  }

  removeItem(schluessel: string): void {
    this.daten.delete(schluessel);
  }

  /** Für den Fall „kaputter Eintrag“: Rohdaten einschleusen. */
  setzeRoh(schluessel: string, wert: string): void {
    this.daten.set(schluessel, wert);
  }

  schluessel(): string[] {
    return Array.from(this.daten.keys());
  }
}

/** Ein Speicher, der bei jedem Zugriff wirft — privates Fenster, gesperrt. */
class GesperrterSpeicher implements SpeicherAdapter {
  get length(): number {
    throw new Error('gesperrt');
  }
  key(): string | null {
    throw new Error('gesperrt');
  }
  getItem(): string | null {
    throw new Error('gesperrt');
  }
  setItem(): void {
    throw new Error('gesperrt');
  }
  removeItem(): void {
    throw new Error('gesperrt');
  }
}

/**
 * Wartet, bis die Uhr eine Millisekunde weiter ist.
 *
 * Die Reihenfolge der Liste hängt am Änderungszeitpunkt. Zwei Vorgänge in
 * derselben Millisekunde wären gleich alt, und die Prüfung der Sortierung
 * würde vom Zufall entschieden statt von der Sache.
 */
function tick(): void {
  const start = Date.now();
  while (Date.now() === start) {
    /* absichtlich leer */
  }
}

/** Ein kleines, aber vollständiges Dokument mit gesetztem Namen. */
function dokument(name: string): BimDocument {
  const doc = buildReferenceDocument();
  return { ...doc, meta: { ...doc.meta, name } };
}

export function pruefeProjekte(check: CheckFn): void {
  // -------------------------------------------------------------------------
  // Anlegen, Auflisten, Öffnen
  // -------------------------------------------------------------------------
  {
    const speicher = new SpeicherAttrappe();
    setzeSpeicher(speicher);

    check('Leerer Speicher: keine Projekte', listeProjekte().projekte.length, 0);
    check('Und kein Problem zu melden', listeProjekte().probleme.length, 0);
    check('Kein aktives Projekt', aktivesProjekt() ?? 'keines', 'keines');

    const wohnung = legeProjektAn(dokument('Wohnung'));
    check('Anlegen gelingt', wohnung.ok, true);
    if (!wohnung.ok) return;
    check('Der Name bleibt der gewünschte', wohnung.kopf.name, 'Wohnung');
    check('Das angelegte Projekt ist das aktive', aktivesProjekt() ?? 'keines', wohnung.kopf.id);
    check('Der Umfang steht im Kopf: Geschosse', wohnung.kopf.umfang.geschosse, 3);
    check('Der Umfang steht im Kopf: Räume', wohnung.kopf.umfang.raeume, 6);
    check('Der Umfang steht im Kopf: Wände', wohnung.kopf.umfang.waende, 21);
    check('Die Fläche ist plausibel', wohnung.kopf.umfang.flaeche > 20, true);
    check('Ohne Referenzbild ist das vermerkt', wohnung.kopf.hatBild, false);

    tick();
    const anbau = legeProjektAn(dokument('Anbau Eltern'));
    check('Zweites Projekt angelegt', anbau.ok, true);
    check('Beide stehen in der Liste', listeProjekte().projekte.length, 2);

    // Zurücklesen ist verlustfrei — es ist dasselbe Dokument, nicht der
    // Umweg über den Export, bei dem Räume neu erkannt würden.
    const zurueck = ladeProjekt(wohnung.kopf.id);
    check('Zurücklesen gelingt', zurueck.ok, true);
    if (zurueck.ok) {
      const original = dokument('Wohnung');
      check('Wände unverändert', Object.keys(zurueck.doc.walls).length, Object.keys(original.walls).length);
      check('Räume unverändert', Object.keys(zurueck.doc.rooms).length, Object.keys(original.rooms).length);
      check('Raumnamen unverändert', JSON.stringify(Object.values(zurueck.doc.rooms).map((r) => r.name)),
        JSON.stringify(Object.values(original.rooms).map((r) => r.name)));
      check('Der Name kommt mit', zurueck.doc.meta.name, 'Wohnung');
    }
  }

  // -------------------------------------------------------------------------
  // Namenskollisionen
  //
  // Zwei Projekte mit demselben Namen sind keine Freiheit, sondern eine
  // Falle: in der Liste ist danach nicht mehr zu erkennen, welches das
  // gestern bearbeitete ist.
  // -------------------------------------------------------------------------
  {
    const speicher = new SpeicherAttrappe();
    setzeSpeicher(speicher);

    check('Freier Name bleibt unverändert', eindeutigerName('Wohnung', ['Anbau']), 'Wohnung');
    check('Belegter Name bekommt eine Zahl', eindeutigerName('Wohnung', ['Wohnung']), 'Wohnung (2)');
    check('Und zählt weiter', eindeutigerName('Wohnung', ['Wohnung', 'Wohnung (2)']), 'Wohnung (3)');
    check('Groß- und Kleinschreibung zählt als gleich', eindeutigerName('wohnung', ['Wohnung']), 'wohnung (2)');
    check('Leerer Wunsch bekommt einen Namen', eindeutigerName('   ', []), 'Neues Projekt');

    const a = legeProjektAn(dokument('Wohnung'));
    const b = legeProjektAn(dokument('Wohnung'));
    check('Zweites „Wohnung“ heißt anders', b.ok && b.kopf.name, 'Wohnung (2)');
    // Der Name gehört ins Dokument, nicht nur in die Liste: sonst hieße das
    // Projekt in der Kopfzeile und in der Exportdatei weiter „Wohnung“.
    if (b.ok) {
      const geladen = ladeProjekt(b.kopf.id);
      check('Und steht so auch im Dokument', geladen.ok && geladen.doc.meta.name, 'Wohnung (2)');
    }
    check('Das erste behält seinen Namen', a.ok && a.kopf.name, 'Wohnung');
  }

  // -------------------------------------------------------------------------
  // Umbenennen und Duplizieren
  // -------------------------------------------------------------------------
  {
    const speicher = new SpeicherAttrappe();
    setzeSpeicher(speicher);
    const angelegt = legeProjektAn(dokument('Wohnung'));
    if (!angelegt.ok) return;

    const umbenannt = benenneProjektUm(angelegt.kopf.id, 'Wohnung Hauptstraße');
    check('Umbenennen gelingt', umbenannt.ok, true);
    check('Die Liste zeigt den neuen Namen', umbenannt.ok && umbenannt.kopf.name, 'Wohnung Hauptstraße');
    const geladen = ladeProjekt(angelegt.kopf.id);
    check('Das Dokument heißt genauso', geladen.ok && geladen.doc.meta.name, 'Wohnung Hauptstraße');
    check('Die Kennung bleibt dieselbe', umbenannt.ok && umbenannt.kopf.id, angelegt.kopf.id);
    check('Das Anlagedatum bleibt', umbenannt.ok && umbenannt.kopf.angelegtAm, angelegt.kopf.angelegtAm);

    const kopie = dupliziereProjekt(angelegt.kopf.id);
    check('Duplizieren gelingt', kopie.ok, true);
    if (kopie.ok) {
      check('Die Kopie ist als solche erkennbar', kopie.kopf.name, 'Wohnung Hauptstraße (Kopie)');
      check('Sie hat eine eigene Kennung', kopie.kopf.id !== angelegt.kopf.id, true);
      const inhalt = ladeProjekt(kopie.kopf.id);
      check('Der Inhalt ist derselbe', inhalt.ok && Object.keys(inhalt.doc.walls).length, 21);
      check('Beide liegen nebeneinander', listeProjekte().projekte.length, 2);
      // Das Original bleibt unberührt: eine Kopie, die das Original umbenennt,
      // wäre eine Verschiebung.
      const original = ladeProjekt(angelegt.kopf.id);
      check('Das Original behält seinen Namen', original.ok && original.doc.meta.name, 'Wohnung Hauptstraße');
    }
  }

  // -------------------------------------------------------------------------
  // Löschen
  // -------------------------------------------------------------------------
  {
    const speicher = new SpeicherAttrappe();
    setzeSpeicher(speicher);
    const a = legeProjektAn(dokument('Wohnung'));
    const b = legeProjektAn(dokument('Anbau'));
    if (!a.ok || !b.ok) return;
    setzeAktivesProjekt(a.kopf.id);

    loescheProjekt(a.kopf.id);
    check('Gelöschtes verschwindet aus der Liste', listeProjekte().projekte.length, 1);
    check('Das andere bleibt', listeProjekte().projekte[0]?.name, 'Anbau');
    check('Und es liegt kein Dokument mehr herum',
      speicher.schluessel().some((k) => k.includes(a.kopf.id)), false);
    check('Das gelöschte Projekt ist nicht mehr aktiv', aktivesProjekt() ?? 'keines', 'keines');
    // Das Löschen eines fremden Schlüssels darf nicht werfen.
    loescheProjekt('gibt-es-nicht');
    check('Löschen eines unbekannten Projekts bleibt folgenlos', listeProjekte().projekte.length, 1);
  }

  // -------------------------------------------------------------------------
  // Reihenfolge nach Änderungsdatum
  //
  // Die Liste beantwortet die Frage „woran habe ich zuletzt gearbeitet?“.
  // Alphabetisch oder nach Anlagedatum sortiert beantwortet sie eine andere.
  // -------------------------------------------------------------------------
  {
    const speicher = new SpeicherAttrappe();
    setzeSpeicher(speicher);
    const a = legeProjektAn(dokument('Alpha'));
    tick();
    const b = legeProjektAn(dokument('Beta'));
    tick();
    const c = legeProjektAn(dokument('Gamma'));
    if (!a.ok || !b.ok || !c.ok) return;

    check('Zuletzt angelegtes steht oben', listeProjekte().projekte[0]?.name, 'Gamma');
    tick();
    speichereProjekt(a.kopf.id, dokument('Alpha'));
    const nachher = listeProjekte().projekte.map((p) => p.name).join(',');
    check('Nach dem Speichern steht das bearbeitete oben', nachher, 'Alpha,Gamma,Beta');
  }

  // -------------------------------------------------------------------------
  // Kaputte Einträge
  //
  // Der Speicher gehört uns nicht allein: eine abgebrochene Schreibung, eine
  // ältere Fassung, ein anderer Reiter — alles kann Bruchstücke hinterlassen.
  // Nichts davon darf die Anwendung anhalten, und nichts darf stillschweigend
  // gelöscht werden.
  // -------------------------------------------------------------------------
  {
    const speicher = new SpeicherAttrappe();
    setzeSpeicher(speicher);
    speicher.setzeRoh('ravia-cad-light.projekte.v1', '{das ist kein JSON');
    const liste = listeProjekte();
    check('Kaputte Liste stürzt nicht ab', liste.projekte.length, 0);
    check('Sondern meldet sich', liste.probleme.length, 1);
    check('Mit einem Satz, den man anzeigen kann', /beschädigt/.test(liste.probleme[0] ?? ''), true);
  }
  {
    const speicher = new SpeicherAttrappe();
    setzeSpeicher(speicher);
    const gut = legeProjektAn(dokument('Heil'));
    if (!gut.ok) return;
    // Ein Kopf ohne Kennung — halb geschriebener Eintrag.
    const roh = JSON.parse(speicher.getItem('ravia-cad-light.projekte.v1') ?? '{}') as {
      koepfe: unknown[];
    };
    roh.koepfe.push({ name: 'ohne Kennung' });
    speicher.setzeRoh('ravia-cad-light.projekte.v1', JSON.stringify(roh));
    const liste = listeProjekte();
    check('Unbrauchbarer Kopf kostet nicht die Liste', liste.projekte.length, 1);
    check('Das heile Projekt bleibt lesbar', liste.projekte[0]?.name, 'Heil');
    check('Der Ausfall wird gemeldet', liste.probleme.some((p) => /unlesbar/.test(p)), true);
  }
  {
    const speicher = new SpeicherAttrappe();
    setzeSpeicher(speicher);
    const angelegt = legeProjektAn(dokument('Kaputt'));
    if (!angelegt.ok) return;
    speicher.setzeRoh(`ravia-cad-light.projekt.v1.${angelegt.kopf.id}`, '{abgeschnitten');
    const geladen = ladeProjekt(angelegt.kopf.id);
    check('Kaputtes Dokument wird nicht geöffnet', geladen.ok, false);
    check('Und der Grund ist benannt', !geladen.ok && geladen.grund, 'kaputt');
    check('Mit einem Satz für die Oberfläche', !geladen.ok && /beschädigt/.test(geladen.meldung), true);

    // Fehlt das Dokument ganz, meldet es die Liste — der Eintrag bleibt
    // stehen, damit ihn jemand bewusst löschen kann.
    speicher.removeItem(`ravia-cad-light.projekt.v1.${angelegt.kopf.id}`);
    const liste = listeProjekte();
    check('Fehlendes Dokument wird gemeldet', liste.probleme.some((p) => /fehlt das Dokument/.test(p)), true);
    check('Der Eintrag bleibt sichtbar', liste.projekte.length, 1);
    check('Und ein Ladeversuch scheitert sauber', ladeProjekt(angelegt.kopf.id).ok, false);
  }

  // -------------------------------------------------------------------------
  // Gesperrter Speicher (privates Fenster)
  // -------------------------------------------------------------------------
  {
    setzeSpeicher(new GesperrterSpeicher());
    const liste = listeProjekte();
    check('Gesperrter Speicher stürzt nicht ab', liste.projekte.length, 0);
    check('Sondern erklärt sich', liste.probleme.some((p) => /nicht erreichbar|nicht lesen/.test(p)), true);
    const versuch = legeProjektAn(dokument('Egal'));
    check('Anlegen scheitert kontrolliert', versuch.ok, false);
    check('Mit dem richtigen Grund', !versuch.ok && versuch.grund, 'gesperrt');
    check('Und dem Rat, die Datei zu nehmen', !versuch.ok && /Datei/.test(versuch.meldung), true);
  }

  // -------------------------------------------------------------------------
  // Überlauf
  //
  // Der wichtigste Block: ein `QuotaExceededError`, der bis in die Oberfläche
  // durchschlägt, beendet die Anwendung mit einer weißen Fläche — mitten in
  // einer Aufnahme. Geprüft wird deshalb dreierlei: es wirft nicht, es sagt
  // warum, und der zuletzt gültige Stand steht anschließend unverändert da.
  // -------------------------------------------------------------------------
  {
    const klein = JSON.stringify(dokument('Wohnung')).length;
    // Platz für ein Dokument samt Liste, aber nicht für zwei.
    const speicher = new SpeicherAttrappe(Math.round(klein * 1.6));
    setzeSpeicher(speicher);

    const erstes = legeProjektAn(dokument('Wohnung'));
    check('Das erste Projekt passt hinein', erstes.ok, true);
    if (!erstes.ok) return;

    const zweites = legeProjektAn(dokument('Anbau'));
    check('Das zweite wird abgelehnt statt zu werfen', zweites.ok, false);
    check('Der Grund ist der volle Speicher', !zweites.ok && zweites.grund, 'voll');
    check('Der Ausweg steht in der Meldung',
      !zweites.ok && /als Datei/.test(zweites.meldung), true);
    check('Der abgelehnte Versuch hinterlässt keine Leiche',
      speicher.schluessel().filter((k) => k.startsWith('ravia-cad-light.projekt.v1.')).length, 1);
    check('Und die Liste kennt weiter genau ein Projekt', listeProjekte().projekte.length, 1);

    // Der bestehende Stand muss unangetastet bleiben, wenn das Fortschreiben
    // scheitert — sonst verlöre man beim Volllaufen genau das Projekt, an dem
    // man gerade arbeitet.
    // Gewachsen ist das Dokument durch ein hinterlegtes Referenzbild — genau
    // der Fall, der den Speicher in der Praxis sprengt.
    const gewachsen = dokument('Wohnung');
    const zuGross: BimDocument = {
      ...gewachsen,
      image: {
        id: 'bild-1',
        src: `data:image/png;base64,${'A'.repeat(klein)}`,
        name: 'grundriss.png',
        naturalWidth: 1190,
        naturalHeight: 1684,
        origin: { x: 0, y: 0 },
        scale: 0.01,
        rotation: 0,
        opacity: 0.6,
        visible: true,
        locked: true,
      },
    };
    const misslungen = speichereProjekt(erstes.kopf.id, zuGross);
    check('Ein zu großer Stand wird abgelehnt', misslungen.ok, false);
    check('Auch hier: voll, nicht kaputt', !misslungen.ok && misslungen.grund, 'voll');
    const danach = ladeProjekt(erstes.kopf.id);
    check('Der alte Stand ist unversehrt', danach.ok && Object.keys(danach.doc.walls).length, 21);
    check('Und hat kein halb geschriebenes Bild bekommen', danach.ok && danach.doc.image === undefined, true);
    check('Die Liste beschreibt weiter den vorhandenen Stand',
      listeProjekte().projekte[0]?.zeichen, erstes.kopf.zeichen);
  }

  // -------------------------------------------------------------------------
  // Platzbericht und Vorschau
  // -------------------------------------------------------------------------
  {
    const speicher = new SpeicherAttrappe();
    setzeSpeicher(speicher);
    const angelegt = legeProjektAn(dokument('Wohnung'));
    if (!angelegt.ok) return;
    const bericht = speicherBericht();

    check('Der Bericht zählt das Projekt mit', bericht.posten.length, 1);
    check('Belegt schließt die Liste mit ein', bericht.belegtBytes > bericht.projekteBytes, true);
    check('Frei ist Grenze minus belegt', bericht.freiBytes, ANGENOMMENE_GRENZE_BYTES - bericht.belegtBytes);
    check('Ein Zeichen kostet zwei Byte', bericht.posten[0]?.bytes, angelegt.kopf.zeichen * BYTES_JE_ZEICHEN);
    // Der Richtwert ist das größte vorhandene Projekt, mindestens aber der
    // Erfahrungswert für ein Haus ohne hinterlegtes Bild.
    check('Die Zahl „passt noch“ ist ganzzahlig und positiv',
      Number.isInteger(bericht.passenNoch) && bericht.passenNoch > 0, true);
    check('Sie folgt aus frei/Richtwert',
      bericht.passenNoch, Math.floor(bericht.freiBytes / bericht.richtwertBytes));

    // Die Größenordnung, die im Bericht an den Anwender geht: ein
    // aufgemessenes Haus ohne Referenzbild liegt im zweistelligen kB-Bereich.
    const referenz = JSON.stringify(dokument('Wohnung')).length * BYTES_JE_ZEICHEN;
    check('Ein Haus ohne Bild bleibt unter 100 kB', referenz < 100 * 1024, true);
    check('Und ist nicht auffällig klein', referenz > 10 * 1024, true);
    check('Formatierung liest sich', formatBytes(1024 * 1024 * 2), '2,0 MB');
    check('Auch im Kilobyte-Bereich', formatBytes(40 * 1024), '40 kB');

    // Vorschau: normierte Wandachsen, kein Bild. Sie muss in 0…1 liegen,
    // sonst zeichnet die Oberfläche über den Rahmen hinaus.
    const vorschau = baueVorschau(dokument('Wohnung'));
    check('Es gibt eine Vorschau', Boolean(vorschau), true);
    if (vorschau) {
      check('Sie besteht aus vollständigen Strecken', vorschau.linien.length % 4, 0);
      check('Alle Werte liegen in 0…1', vorschau.linien.every((v) => v >= 0 && v <= 1), true);
      check('Sie ist klein genug für die Liste', JSON.stringify(vorschau).length < 6000, true);
      check('Und beschreibt nur das unterste Geschoss', vorschau.linien.length / 4 < 21, true);
    }
    // Ein Dokument ohne Wände hat keinen Umriss — dann lieber nichts als ein
    // leerer Rahmen mit einem Punkt darin.
    const leer = baueVorschau({ ...dokument('Leer'), walls: {} });
    check('Ohne Wände keine Vorschau', leer === undefined, true);
  }

  // Den echten Speicher wieder herstellen — nachfolgende Blöcke gehen sonst
  // auf der Attrappe weiter.
  setzeSpeicher(null);
}
