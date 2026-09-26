/**
 * Aus sieben Antworten wird eine Anlage.
 * ---------------------------------------------------------------------------
 * **Was hier passiert.** Der Anwender sagt, was er baut — Bauart des
 * Erzeugers, Kältemittel, Inneneinheit samt Einbauort des Heizstabs,
 * Trinkwasserspeicher, Heizkreise, Pufferspeicher. Dieses Modul macht daraus die Speicher und
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
  Inneneinheit,
  PlantDefinition,
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
 * Führt die Anlage einen elektrischen Zuheizer?
 *
 * Eine Stelle, an der diese Frage beantwortet wird. Bis 1.53.0 stand dafür
 * ein eigenes Kästchen `heizstab: boolean` im Feld; seit die Inneneinheit
 * erfragt wird, folgt der Stab aus ihr. Zwei Felder, die einander bedingen,
 * geraten irgendwann auseinander — „keine Inneneinheit, aber Heizstab im
 * Gerät" war eintragbar und hätte kein Bild ergeben.
 */
export function hatHeizstab(inneneinheit: Inneneinheit): boolean {
  return inneneinheit === 'mit-heizstab' || inneneinheit === 'heizstab-speicher';
}

/** Steht eine Hydraulik- oder Inneneinheit im Haus? */
export function hatInneneinheit(inneneinheit: Inneneinheit): boolean {
  return inneneinheit !== 'keine';
}

/**
 * Sitzt der Stab im Speicher statt im Vorlauf?
 *
 * Die Unterscheidung stammt aus der Legende des BWP-Leitfadens Hydraulik:
 * *Elektro-Zusatzheizung Wärmepumpe* im Vorlauf nach dem Gerät,
 * *Elektro-Zusatzheizung Speicher* als Flanschheizung im Trinkwasser- oder
 * als Tauchheizkörper im Pufferspeicher. Fürs Schema ist das kein Beiwerk:
 * im Vorlauf liegt der Stab in der Leitung, im Speicher hängt er am Behälter.
 */
export function heizstabImSpeicher(inneneinheit: Inneneinheit): boolean {
  return inneneinheit === 'heizstab-speicher';
}

/**
 * Die Antworten zu einer Anlage — aus dem Projekt, sonst abgeleitet.
 *
 * **Warum das hier steht und nicht in der Oberfläche.** Dieselbe Ableitung
 * brauchen inzwischen drei Stellen: das Anlagenblatt, der Anlagendialog am
 * Schema und die Auslegung, die den Einbauort des Heizstabs zeichnen muss.
 * Dreimal derselbe `??`-Ausdruck heißt dreimal die Möglichkeit, ihn
 * verschieden zu schreiben — und dann steht im Dialog eine andere Antwort als
 * im Blatt.
 *
 * **Und hier wandert die ältere Projektdatei.** Eine Datei aus 1.51.0 bis
 * 1.53.0 trägt `heizstab: true|false` und keine `inneneinheit`. Aus dem
 * Kästchen wird der Regelfall seiner Zeit: mit Stab die Hydraulikeinheit mit
 * Heizstab im Vorlauf, ohne Stab die Hydraulikeinheit ohne. `keine
 * Inneneinheit` entsteht bei der Wanderung nie — sie war damals nicht
 * eintragbar, und sie zu unterstellen hieße, eine Aussage zu erfinden.
 */
export function antwortenDes(
  plant: Pick<PlantDefinition, 'antworten' | 'storages' | 'circuits'>,
  bauform?: PumpForm,
  kaeltemittel?: Refrigerant,
): AnlagenAntworten {
  const gespeichert = plant.antworten;
  if (gespeichert) {
    if (gespeichert.inneneinheit) return gespeichert;
    return {
      ...gespeichert,
      inneneinheit: gespeichert.heizstab === false ? 'ohne-heizstab' : 'mit-heizstab',
    };
  }
  return antwortenAusAnlage(plant.storages, plant.circuits, bauform, kaeltemittel);
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
 * einem der sieben Felder ein Rücksetzen der halben Anlage.
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
    /** Die Übergabeart, die aus der Antwort folgt — siehe Kommentar unten. */
    const neueArt: HeatingCircuit['kind'] =
      alt && (alt.kind === 'wall' || alt.kind === 'fancoil') ? alt.kind : uebergabe(art);
    /**
     * Hat die Antwort die Übergabeart **geändert**?
     *
     * Dann folgen ihr auch die Temperaturen. Bis 1.55.1 blieben sie stehen:
     * Aus einem Heizkörperkreis mit 55/45 °C wurde eine Fußbodenheizung — und
     * sie trug weiter 55/45 °C ins Bild. Gemeldet am Schema: „bei
     * Fußbodenheizung hat man andere Temperaturen, 35/28 zum Beispiel."
     *
     * Die Wertepaare sind die üblichen: **35/28 °C** (Δθ 7 K) für die
     * Flächenheizung, **55/45 °C** (Δθ 10 K) für Heizkörper im
     * Energiesparhaus. Eine Vorlauftemperatur von 55 °C in einem Estrich
     * wäre nicht nur unwirtschaftlich, sie ist nach DIN EN 1264 unzulässig.
     */
    const artGeaendert = Boolean(alt) && alt.kind !== neueArt;
    circuits[id] = {
      ...(alt ?? {
        roomIds: [],
        material: 'kupfer' as const,
      }),
      id,
      /*
       * **Die Antwort bestimmt die Übergabeart — auch beim Ändern.**
       *
       * Bis 1.55.0 behielt ein vorhandener Kreis seine Art, solange sich
       * `mixed` nicht änderte. Wer von „zwei Kreise, einer gemischt" auf
       * „ein Kreis, ungemischt" ging, behielt damit eine Fußbodenheizung,
       * die er gerade abgewählt hatte. Gemeldet am 26.09.: „er macht
       * Fußbodenheizung obwohl ungemischt."
       *
       * Die Kopplung steht schon zweimal im Programm — in `uebergabe()` und
       * im Hilfstext am Feld („Gemischt heißt … der Fall Fußbodenheizung
       * neben Heizkörpern"). Sie galt nur beim Anlegen und nicht beim
       * Ändern; das ist die Unstimmigkeit, nicht die Kopplung selbst.
       *
       * **Wand- und Gebläseheizflächen bleiben stehen.** Über sie sagt die
       * Frage nichts, und sie wegzudrehen wäre eine Antwort auf eine Frage,
       * die niemand gestellt hat.
       *
       * Was damit **nicht** geht: eine ungemischte Flächenheizung. Sie ist
       * an einer Wärmepumpe mit passender Vorlauftemperatur ein echter Fall.
       * Wer ihn braucht, braucht in Frage 5 eine zweite Achse — Mischer
       * *und* Übergabeart getrennt. Solange es die nicht gibt, gilt die
       * Kopplung, die im Feld steht.
       */
      kind: neueArt,
      label: alt?.label ?? (gemischt ? `Heizkreis ${i + 1}, gemischt` : `Heizkreis ${i + 1}`),
      mixed: gemischt,
      /*
       * Hat der Kreis schon eigene Temperaturen, bleiben sie: Wer 40/30
       * eingetragen hat, will nicht bei jeder Änderung wieder 35/28 sehen.
       * **Es sei denn, die Übergabeart hat gewechselt** — dann gehören die
       * alten Temperaturen zu einer Heizfläche, die es nicht mehr gibt.
       */
      flowTemperature: artGeaendert ? t.vorlauf : (alt?.flowTemperature ?? t.vorlauf),
      returnTemperature: artGeaendert ? t.ruecklauf : (alt?.returnTemperature ?? t.ruecklauf),
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

  if (!hatHeizstab(antworten.inneneinheit) && antworten.bauform !== 'indoor') {
    hin.push({
      feld: 'inneneinheit',
      text:
        'Ohne Zusatzheizer trägt die Wärmepumpe den Bivalenzpunkt allein. ' +
        'Das ist zulässig und verlangt ein Gerät, das die Heizlast bei Norm-Außentemperatur deckt.',
    });
  }

  /*
   * **Keine Inneneinheit bei einer Bauart, die eine braucht.**
   *
   * Beim Splitgerät steht der Verflüssiger im Haus, beim Innen- und
   * Kompaktgerät das ganze Gerät. „Keine Inneneinheit" ist dort kein
   * ungewöhnlicher Fall, sondern ein Widerspruch — und einer, der sich im
   * Bild nicht auflösen lässt: Das Kältemittel käme ins Haus und endete
   * nirgends. Die Antwort bleibt trotzdem stehen; hier steht nur, was daran
   * nicht zusammengeht.
   */
  if (antworten.inneneinheit === 'keine' && kaeltemittelImHaus(antworten.bauform)) {
    hin.push({
      feld: 'inneneinheit',
      text:
        'Bei dieser Bauart geht der Kältekreis mit ins Haus — dort steht dann mindestens der ' +
        'Verflüssiger. Ohne Inneneinheit bleibt offen, wo das Kältemittel Wärme abgibt.',
    });
  }

  /*
   * **Heizstab im Speicher, aber kein Speicher.**
   *
   * Der zweite Einbauort des BWP-Leitfadens ist die Flanschheizung im
   * Trinkwasser- oder der Tauchheizkörper im Pufferspeicher. Ohne beides gibt
   * es keinen Behälter, in dem er sitzen könnte.
   */
  if (
    antworten.inneneinheit === 'heizstab-speicher' &&
    antworten.pufferLiter === 0 &&
    antworten.trinkwasserLiter === 0
  ) {
    hin.push({
      feld: 'inneneinheit',
      text:
        'Der Heizstab soll im Speicher sitzen, es ist aber weder ein Puffer- noch ein ' +
        'Trinkwasserspeicher eingetragen. Im Schema wird er deshalb in den Vorlauf gezeichnet.',
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
  inneneinheit?: Inneneinheit,
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
    inneneinheit: inneneinheit ?? ANTWORTEN_VORGABE.inneneinheit,
    trinkwasserLiter: tww?.volume ?? 0,
    kreise: kreise.length ? kreise : ANTWORTEN_VORGABE.kreise,
    pufferLiter: puffer?.volume ?? 0,
    pufferArt: puffer?.kind === 'buffer-series' ? 'buffer-series' : 'buffer-parallel',
  };
}
