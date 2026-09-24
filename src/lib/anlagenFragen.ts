/**
 * Aus sechs Antworten wird eine Anlage.
 * ---------------------------------------------------------------------------
 * **Was hier passiert.** Der Anwender sagt im Anlagenblatt, was er baut —
 * Bauart des Erzeugers, Kältemittel, Heizstab, Trinkwasserspeicher,
 * Heizkreise, Pufferspeicher. Dieses Modul macht daraus die Speicher und
 * Heizkreise der Anlage. Kein Katalog, keine Wiedererkennung einer
 * Musterlösung: Was er einträgt, wird gebaut.
 *
 * **Die Antwort gilt.** Weicht sie von der Auslegung ab, wird sie *nicht*
 * überschrieben — stattdessen entsteht ein **Abweichungshinweis**, der
 * danebensteht. Der Anwender weiß, was auf die Baustelle kommt; das Programm
 * weiß, was es gerechnet hat. Ein Programm, das die eingetragene Zahl still
 * korrigiert, nimmt dem Anwender die Entscheidung ab, ohne es zu sagen — und
 * beim nächsten Öffnen steht dort eine Zahl, die er nie eingetragen hat.
 *
 * **Was hier nicht passiert.** Gerätewahl, Puffergröße, Sicherheitsarmaturen,
 * Pumpenauslegung — das rechnet `plantDesign` wie bisher aus der Heizlast.
 * Dieses Modul beschreibt nur die **Konstellation**: welche Bauteile es gibt
 * und wie sie zusammenhängen.
 *
 * Reine Funktionen, kein Store, keine Oberfläche.
 */

import type {
  AnlagenAntworten,
  HeatingCircuit,
  HeizkreisArt,
  PlantStorage,
  PumpForm,
  Refrigerant,
  Room,
} from '../types/bim';
import { ANTWORTEN_VORGABE } from '../types/bim';


// ---------------------------------------------------------------------------
// Was die Antworten nach sich ziehen
// ---------------------------------------------------------------------------

/**
 * Geht der Kältekreis mit ins Haus?
 *
 * **Das ist die Frage, auf die es ankommt** — und nicht „hat das Gerät ein
 * Innenteil". Ein Innenteil hat praktisch jede Bauart: Beim Monoblock ist es
 * die Hydraulikstation, beim Turmgerät das Gerät mit dem Speicher. Am Markt
 * gibt es die reine Außenaufstellung ohne irgendetwas im Haus kaum
 * (`hatInnengeraet` im Gerätekatalog gibt deshalb für alles `true` zurück,
 * und genau daran ist die erste Fassung dieser Funktion gescheitert).
 *
 * Entscheidend für das Schema und für den Schutzbereich ist ein anderer
 * Unterschied: **Was fließt durch die Leitung ins Haus?**
 *
 *  · **Heizungswasser** — Monoblock außen, Hydrosplit (dessen Kältekreis
 *    bleibt ausdrücklich draußen). Brennbares Kältemittel bleibt im Freien.
 *  · **Kältemittel** — Splitgerät, Innenaufstellung, Monoblock mit
 *    Luftkanälen. Dann gilt drinnen DIN EN 378.
 *
 * Das Kompaktgerät (`tower`) wird zum Kältemittel im Haus gezählt. Am Markt
 * gibt es beide Ausführungen, und die vorsichtige Annahme ist hier die
 * richtige: Ein Hinweis zu viel kostet einen Satz, ein Hinweis zu wenig den
 * Schutzbereich.
 */
export function kaeltemittelImHaus(bauform: PumpForm): boolean {
  return bauform === 'split' || bauform === 'monoblock-indoor' || bauform === 'indoor' || bauform === 'tower';
}

/**
 * Passen Bauart und Kältemittel zusammen?
 *
 * Kein Verbot, sondern ein Hinweis: Brennbares Kältemittel im Innengerät ist
 * zulässig, verlangt aber einen Schutzbereich nach DIN EN 378 und die
 * Mindestraumgröße des Herstellers. Das sagt das Programm, statt es zu
 * verschweigen oder die Wahl zu sperren.
 */
export function kaeltemittelHinweis(bauform: PumpForm, kaeltemittel: Refrigerant): string | undefined {
  const brennbar = kaeltemittel === 'R290' || kaeltemittel === 'R32' || kaeltemittel === 'R454C';
  if (!brennbar) return undefined;
  if (!kaeltemittelImHaus(bauform)) return undefined;
  return (
    `${kaeltemittel} ist brennbar und geht bei dieser Bauart mit ins Haus. ` +
    'Schutzbereich und Mindestraumgröße nach DIN EN 378 und Herstellerangabe prüfen — ' +
    'siehe Reiter „Wärmepumpe".'
  );
}

/** Die Vorlauftemperatur, mit der ein Kreis dieser Art vorbelegt wird [°C]. */
function temperaturen(art: HeizkreisArt, index: number): { vorlauf: number; ruecklauf: number } {
  /*
   * **Woher die Zahlen kommen.** Ein gemischter Kreis ist im Wohnungsbau fast
   * immer die Fußbodenheizung (35/28 °C nach DIN EN 1264), ein ungemischter
   * hängt direkt am Erzeuger und läuft mit dessen Vorlauf. 55/45 °C ist der
   * Punkt, auf den sich die Normleistung eines Heizkörpers nach DIN EN 442
   * bezieht — deshalb steht er hier und nicht 70/55.
   *
   * Beides sind **Vorbelegungen**. Der Kreis lässt sich danach ändern; diese
   * Zahlen sollen nur verhindern, dass ein frisch angelegter Kreis mit 0 °C
   * in die Auslegung geht.
   */
  if (art === 'gemischt') return { vorlauf: 35, ruecklauf: 28 };
  return index === 0 ? { vorlauf: 55, ruecklauf: 45 } : { vorlauf: 55, ruecklauf: 45 };
}

/** Die Bauart der Wärmeübergabe, die zu einem Kreis dieser Art passt. */
function uebergabe(art: HeizkreisArt): HeatingCircuit['kind'] {
  return art === 'gemischt' ? 'floor' : 'radiator';
}

// ---------------------------------------------------------------------------
// Antworten → Anlage
// ---------------------------------------------------------------------------

export interface AnlageAusAntworten {
  storages: Record<string, PlantStorage>;
  circuits: Record<string, HeatingCircuit>;
}

/**
 * Die Speicher und Heizkreise, die aus den Antworten folgen.
 *
 * **Vorhandenes bleibt, soweit es passt.** Wer einen Kreis benannt und ihm
 * Räume zugeordnet hat, verliert das nicht, wenn er anschließend den Puffer
 * ändert: Der Kreis an derselben Stelle behält Name, Räume, Temperaturen und
 * Werkstoff. Nur seine Art folgt der Antwort. Sonst wäre jede Änderung an
 * einem der sechs Felder ein Rücksetzen der halben Anlage.
 */
export function anlageAusAntworten(
  antworten: AnlagenAntworten,
  bisher: { storages: Record<string, PlantStorage>; circuits: Record<string, HeatingCircuit> },
  raeume: readonly Room[] = [],
): AnlageAusAntworten {
  const storages: Record<string, PlantStorage> = {};

  // --- Trinkwasserspeicher -------------------------------------------------
  if (antworten.trinkwasserLiter > 0) {
    const alt = Object.values(bisher.storages).find((s) => s.kind === 'dhw-cylinder');
    const id = alt?.id ?? 'speicher-tww';
    storages[id] = {
      ...(alt ?? {}),
      id,
      kind: 'dhw-cylinder',
      label: `Trinkwasserspeicher ${antworten.trinkwasserLiter} l`,
      volume: antworten.trinkwasserLiter,
      // Aus einer Antwort, nicht aus einem Vorschlag: Der Anwender hat die
      // Zahl eingetragen, und genau das sagt `suggested: false`.
      suggested: false,
    };
  }

  // --- Pufferspeicher ------------------------------------------------------
  if (antworten.pufferLiter > 0) {
    const alt = Object.values(bisher.storages).find(
      (s) => s.kind === 'buffer-parallel' || s.kind === 'buffer-series' || s.kind === 'separator',
    );
    const id = alt?.id ?? 'speicher-puffer';
    const reihe = antworten.pufferArt === 'buffer-series';
    storages[id] = {
      ...(alt ?? {}),
      id,
      kind: antworten.pufferArt,
      label: `${reihe ? 'Reihenpuffer' : 'Pufferspeicher'} ${antworten.pufferLiter} l`,
      volume: antworten.pufferLiter,
      suggested: false,
    };
  }

  // --- Heizkreise ----------------------------------------------------------
  const alteKreise = Object.values(bisher.circuits);
  const circuits: Record<string, HeatingCircuit> = {};
  antworten.kreise.forEach((art, i) => {
    const alt = alteKreise[i];
    const id = alt?.id ?? `kreis-${i + 1}`;
    const t = temperaturen(art, i);
    const gemischt = art === 'gemischt';
    circuits[id] = {
      ...(alt ?? {
        roomIds: [],
        material: 'kupfer' as const,
      }),
      id,
      kind: alt && alt.kind !== 'dhw' && gemischt === alt.mixed ? alt.kind : uebergabe(art),
      label: alt?.label ?? (gemischt ? `Heizkreis ${i + 1}, gemischt` : `Heizkreis ${i + 1}`),
      mixed: gemischt,
      // Hat der Kreis schon eigene Temperaturen, bleiben sie: Wer 40/30
      // eingetragen hat, will nicht bei jeder Änderung wieder 35/28 sehen.
      flowTemperature: alt?.flowTemperature ?? t.vorlauf,
      returnTemperature: alt?.returnTemperature ?? t.ruecklauf,
      roomIds: alt?.roomIds ?? [],
      material: alt?.material ?? 'kupfer',
    };
  });

  /*
   * **Ein Kreis ohne Räume ist kein Fehler, sondern der Anfang.** Wer die
   * Anlage vor dem Grundriss beschreibt, hat noch keine Räume zuzuordnen.
   * Gibt es aber genau einen Kreis und beheizte Räume, bekommt er sie — sonst
   * stünde eine Anlage da, die nichts versorgt.
   */
  const einzelner = Object.values(circuits);
  if (einzelner.length === 1 && einzelner[0].roomIds.length === 0) {
    einzelner[0].roomIds = raeume.filter((r) => r.isHeated !== false).map((r) => r.id);
  }

  return { storages, circuits };
}

// ---------------------------------------------------------------------------
// Abweichungen zur Auslegung
// ---------------------------------------------------------------------------

/** Ein Satz, der neben einer Antwort steht. */
export interface Abweichung {
  /** Welches Feld es betrifft — für die Anzeige am richtigen Platz. */
  feld: keyof AnlagenAntworten;
  text: string;
}

/**
 * Wo die Antworten von der Auslegung abweichen.
 *
 * Gibt **Sätze**, keine Korrekturen. Jeder nennt die eingetragene Zahl, die
 * gerechnete und den Grund; keiner verlangt etwas.
 */
export function abweichungen(
  antworten: AnlagenAntworten,
  gerechnet: {
    /** Empfohlenes Puffervolumen aus der Auslegung [l], falls eines gebraucht wird. */
    pufferLiter?: number;
    /** Warum die Auslegung einen Puffer führt. */
    pufferGrund?: string;
    /** Empfohlenes Trinkwasservolumen [l]. */
    trinkwasserLiter?: number;
    /** Zahl der Heizkreise, die im Modell stecken. */
    kreiseImModell?: number;
  },
): Abweichung[] {
  const hin: Abweichung[] = [];
  const zahl = (n: number) => n.toLocaleString('de-DE');

  const kHinweis = kaeltemittelHinweis(antworten.bauform, antworten.kaeltemittel);
  if (kHinweis) hin.push({ feld: 'kaeltemittel', text: kHinweis });

  if (gerechnet.pufferLiter && gerechnet.pufferLiter > 0) {
    if (antworten.pufferLiter === 0) {
      hin.push({
        feld: 'pufferLiter',
        text:
          `Die Auslegung führt einen Puffer von ${zahl(gerechnet.pufferLiter)} l. ` +
          `${gerechnet.pufferGrund ?? 'Grund: Mindestwasserinhalt des Erzeugers.'} ` +
          'Ohne Puffer bleibt es bei Ihrer Angabe — der Mindestinhalt ist dann anderweitig nachzuweisen.',
      });
    } else if (antworten.pufferLiter < gerechnet.pufferLiter * 0.9) {
      hin.push({
        feld: 'pufferLiter',
        text:
          `Die Auslegung rechnet ${zahl(gerechnet.pufferLiter)} l; eingetragen sind ` +
          `${zahl(antworten.pufferLiter)} l. Es bleibt bei Ihrer Angabe.`,
      });
    }
  }

  if (
    gerechnet.trinkwasserLiter &&
    antworten.trinkwasserLiter > 0 &&
    antworten.trinkwasserLiter < gerechnet.trinkwasserLiter * 0.9
  ) {
    hin.push({
      feld: 'trinkwasserLiter',
      text:
        `Die Auslegung rechnet ${zahl(gerechnet.trinkwasserLiter)} l für die ` +
        `Wohneinheiten und Zapfstellen; eingetragen sind ${zahl(antworten.trinkwasserLiter)} l. ` +
        'Es bleibt bei Ihrer Angabe.',
    });
  }

  if (typeof gerechnet.kreiseImModell === 'number' && gerechnet.kreiseImModell > antworten.kreise.length) {
    hin.push({
      feld: 'kreise',
      text:
        `Im Grundriss stecken ${gerechnet.kreiseImModell} Übergabearten ` +
        `(Heizkörper und Fläche), beschrieben sind ${antworten.kreise.length} Kreise. ` +
        'Wer beides getrennt regeln will, braucht je einen Kreis.',
    });
  }

  if (!antworten.heizstab && antworten.bauform !== 'indoor') {
    hin.push({
      feld: 'heizstab',
      text:
        'Ohne Zusatzheizer trägt die Wärmepumpe den Bivalenzpunkt allein. ' +
        'Das ist zulässig und verlangt ein Gerät, das die Heizlast bei Norm-Außentemperatur deckt.',
    });
  }

  return hin;
}

/** Die Antworten, die zu einer bestehenden Anlage passen — für ältere Projektdateien. */
export function antwortenAusAnlage(
  storages: Record<string, PlantStorage>,
  circuits: Record<string, HeatingCircuit>,
  bauform?: PumpForm,
  kaeltemittel?: Refrigerant,
  heizstab?: boolean,
): AnlagenAntworten {
  const tww = Object.values(storages).find((s) => s.kind === 'dhw-cylinder' || s.kind === 'combi');
  const puffer = Object.values(storages).find(
    (s) => s.kind === 'buffer-parallel' || s.kind === 'buffer-series' || s.kind === 'separator',
  );
  const kreise = Object.values(circuits)
    .filter((c) => c.kind !== 'dhw')
    .map((c): HeizkreisArt => (c.mixed ? 'gemischt' : 'ungemischt'));

  return {
    bauform: bauform ?? ANTWORTEN_VORGABE.bauform,
    kaeltemittel: kaeltemittel ?? ANTWORTEN_VORGABE.kaeltemittel,
    heizstab: heizstab ?? ANTWORTEN_VORGABE.heizstab,
    trinkwasserLiter: tww?.volume ?? 0,
    kreise: kreise.length ? kreise : ANTWORTEN_VORGABE.kreise,
    pufferLiter: puffer?.volume ?? 0,
    pufferArt: puffer?.kind === 'buffer-series' ? 'buffer-series' : 'buffer-parallel',
  };
}
