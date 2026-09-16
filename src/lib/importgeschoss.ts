/**
 * Den eingelesenen Grundriss einem Geschoss zuordnen.
 * ---------------------------------------------------------------------------
 * **Das Aufmaß beginnt selten im Erdgeschoss.** Wer eine Wohnung im ersten
 * Stock aufmisst, liest genau diesen einen Grundriss ein — und bekam bis
 * hierher ein Gebäude mit einem einzigen Geschoss, das auf Erdreich steht.
 * Für die Heizlast ist das falsch in beide Richtungen: Der Boden der Wohnung
 * grenzt nicht an Erdreich, sondern an ein beheiztes oder unbeheiztes
 * Geschoss darunter, und das Geschoss darunter fehlt ganz — mitsamt seiner
 * Decke, die die Wohnung von unten begrenzt.
 *
 * Von Hand ist das eine Viertelstunde Arbeit und drei Fehlerquellen: das
 * Geschoss anlegen, die Höhenlagen nachziehen, die Randbedingungen von
 * „Erdreich" auf „beheizter Raum" ändern. Diese Datei rechnet den ganzen
 * Umbau vor, und der Store führt ihn in *einem* Schritt aus — rücknehmbar
 * mit einem Tastendruck.
 *
 * **Was hier entschieden wird:**
 *
 *  · *Wer verschiebt sich?* Alle vorhandenen Geschosse wandern gemeinsam um
 *    dieselbe Zahl von Ordnungen. Ihre Anordnung untereinander bleibt damit
 *    genau so, wie sie eingelesen wurde — nur der Bezug zum Erdgeschoss
 *    ändert sich. Alles andere wäre ein Umbau des Gebäudes und nicht eine
 *    Zuordnung.
 *  · *Was entsteht?* Genau die Geschosse, die zwischen dem Erdgeschoss und
 *    dem zugeordneten Geschoss fehlen — nicht mehr. Sie bekommen die lichte
 *    Höhe des zugeordneten Geschosses; eine bessere Annahme gibt es nicht,
 *    solange niemand dort war.
 *  · *Wohin mit den Höhen?* Das Erdgeschoss liegt auf 0. Die neuen Geschosse
 *    werden von dort aufgestapelt, und alles Vorhandene wandert um dieselbe
 *    Summe nach oben. Die Abstände zwischen den vorhandenen Geschossen
 *    bleiben unangetastet — eine eingelesene Höhenlage ist eine Messung.
 *  · *Welcher Name?* Namen wie „EG" oder „1. OG" beschreiben eine Lage und
 *    werden neu vergeben, wenn sich die Lage ändert. Ein eigener Name —
 *    „Dachboden", „Wohnung Müller" — bleibt stehen: er sagt mehr, als diese
 *    Funktion wissen kann.
 *
 * Die Außenwände selbst legt diese Datei **nicht** an. Das kann `aussenwand.ts`
 * seit 1.24.0 und soll es an genau einer Stelle können; hier steht nur,
 * *welche* Geschosse sie bekommen sollen.
 */

import type { BoundaryCondition, Level } from '../types/bim';
import { DEFAULT_SLAB, geschossName, istLagename } from './levelGeometry';

export interface GeschossZuordnung {
  levels: readonly Level[];
  /** Geschoss, in dem der eingelesene Grundriss steht. */
  quelleId: string;
  /** Gewünschte Lage: 0 = EG, 1 = 1. OG, −1 = KG, −2 = 2. UG … */
  ordnung: number;
  uid: (prefix: string) => string;
}

export interface GeschossZuordnungPlan {
  /** Vorhandene Geschosse mit geänderten Feldern. Leer heißt: nichts zu tun. */
  geaendert: Level[];
  /** Neu anzulegende Geschosse. */
  neu: Level[];
  /**
   * Geschosse, die den Außenwandumriss der Quelle bekommen sollen — die neu
   * angelegten. Ein vorhandenes Geschoss wird nie überschrieben.
   */
  umrissFuer: string[];
  /**
   * Um wie viel alles Vorhandene verschoben wurde [m]. Negativ, wenn der
   * Bestand nach unten rückt — etwa weil der Grundriss zum Keller erklärt wird.
   */
  anhebung: number;
  /** Steht hier etwas, ist nichts zu tun — und das ist der Grund. */
  hinweis?: string;
}

/** Bodenaufbau eines neu erfundenen Geschosses gegen Erdreich. */
const SOHLE_U = 0.35;
/** Geschossdecke zwischen zwei beheizten Geschossen. */
const DECKE_U = 0.9;

export function planeGeschosszuordnung(eingabe: GeschossZuordnung): GeschossZuordnungPlan {
  const { levels, quelleId, ordnung, uid } = eingabe;
  const leer: GeschossZuordnungPlan = { geaendert: [], neu: [], umrissFuer: [], anhebung: 0 };

  const quelle = levels.find((l) => l.id === quelleId);
  if (!quelle) return { ...leer, hinweis: 'Das Geschoss des Grundrisses ist nicht auffindbar.' };

  const versatz = ordnung - quelle.order;
  const sortiert = [...levels].sort((a, b) => a.order - b.order);

  // Welche Ordnungen soll es am Ende geben? Die verschobenen — und alle
  // Zwischenstufen zwischen dem Erdgeschoss und dem zugeordneten Geschoss.
  const danach = new Set(sortiert.map((l) => l.order + versatz));
  const fehlend: number[] = [];
  const von = Math.min(0, ordnung);
  const bis = Math.max(0, ordnung);
  for (let o = von; o <= bis; o++) if (!danach.has(o)) fehlend.push(o);

  if (versatz === 0 && fehlend.length === 0) {
    return { ...leer, hinweis: 'Der Grundriss liegt bereits dort — nichts zu tun.' };
  }

  /*
   * **Der Bezugspunkt ist das Erdgeschoss, nicht das eingelesene Geschoss.**
   *
   * Die neuen Geschosse bekommen die lichte Höhe der Quelle — eine bessere
   * Annahme gibt es nicht, solange niemand dort war — und werden von 0 aus
   * gestapelt: Ordnung o liegt auf o · (Höhe + Deckenstärke).
   *
   * Der Bestand wandert dann geschlossen um genau den Betrag, der die Quelle
   * an ihren neuen Platz bringt. Das ist die einzige Verschiebung, die beide
   * Bedingungen zugleich erfüllt: Das Erdgeschoss liegt auf 0, und die
   * Abstände zwischen den vorhandenen Geschossen bleiben unangetastet — eine
   * eingelesene Höhenlage ist eine Messung und keine Annahme.
   *
   * Sie kann negativ sein: Wer den eingelesenen Grundriss zum Keller erklärt,
   * schiebt den Bestand nach unten und nicht nach oben.
   */
  const hoehe = Number.isFinite(quelle.height) && quelle.height > 0 ? quelle.height : 2.75;
  const schritt = hoehe + DEFAULT_SLAB;
  const quelleLage = Number.isFinite(quelle.elevation) ? quelle.elevation : 0;
  const anhebung = ordnung * schritt - quelleLage;

  // Höhenlage einer Ordnung, gemessen vom Erdgeschoss aus. Für vorhandene
  // Geschosse zählt ihre eigene Lage plus Anhebung, für neue die Stapelung.
  const neu: Level[] = [];
  for (const o of fehlend) {
    neu.push({
      id: uid('lvl'),
      // `geschossName` zählt von einem Erdgeschoss-Index aus. Die Ordnung
      // eines Geschosses ist genau so gezählt — 0 ist das Erdgeschoss —,
      // also ist die Ordnung hier der Index und 0 der Bezug.
      name: geschossName(o, 0),
      order: o,
      elevation: o * schritt,
      height: hoehe,
      floorUValue: SOHLE_U,
      floorBoundary: 'ground',
      ceilingUValue: DECKE_U,
      ceilingBoundary: 'adjacent-room',
    });
  }

  const geaendert: Level[] = sortiert.map((l) => ({
    ...l,
    order: l.order + versatz,
    elevation: (Number.isFinite(l.elevation) ? l.elevation : 0) + anhebung,
  }));

  // Jetzt liegen alle Geschosse fest. Damit lässt sich sagen, was oben und was
  // unten ist — und erst daraus folgen Namen und Randbedingungen.
  const alle = [...geaendert, ...neu].sort((a, b) => a.order - b.order);
  const oberste = alle[alle.length - 1];
  const nachOrdnung = new Map(alle.map((l) => [l.order, l]));

  for (const l of alle) {
    // Ein Lagename beschreibt die Lage — ändert sie sich, ändert er sich mit.
    if (istLagename(l.name)) l.name = geschossName(l.order, 0);

    // Nur das unterste Geschoss steht auf Erdreich. Jedes andere hat ein
    // Geschoss unter sich, und das ist rechnerisch etwas ganz anderes.
    const hatDrunter = nachOrdnung.has(l.order - 1);
    if (hatDrunter && l.floorBoundary === 'ground') {
      l.floorBoundary = 'adjacent-room' as BoundaryCondition;
      l.floorUValue = DECKE_U;
    }
    // Ein *neu erfundenes* unterstes Geschoss steht auf Erdreich. Bei einem
    // vorhandenen bleibt stehen, was dort eingetragen ist — es kann aus einer
    // Hanglage stammen, die niemand überschreiben darf.
    if (!hatDrunter && neu.includes(l)) {
      l.floorBoundary = 'ground';
      l.floorUValue = SOHLE_U;
    }
    // Eine Decke gegen ein Geschoss darüber ist keine Decke gegen unbeheizt.
    if (nachOrdnung.has(l.order + 1) && l.ceilingBoundary === 'unheated') {
      l.ceilingBoundary = 'adjacent-room' as BoundaryCondition;
      l.ceilingUValue = DECKE_U;
    }
    if (l === oberste && !nachOrdnung.has(l.order + 1) && l.ceilingBoundary === 'adjacent-room') {
      // Über dem obersten Geschoss ist nichts mehr — dort geht Wärme verloren.
      l.ceilingBoundary = 'unheated' as BoundaryCondition;
      l.ceilingUValue = 0.2;
    }
  }

  return {
    geaendert,
    neu,
    umrissFuer: neu.map((l) => l.id),
    anhebung,
  };
}
