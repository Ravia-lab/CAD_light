/**
 * Store-Slice „Geschosse, Grundrisse und Außenwand-Übernahme".
 *
 * TD-22: Aus `useBimStore.ts` herausgelöst; die Aktionen sind unverändert.
 * `useBimStore` setzt den Store aus diesen Slices zusammen und reicht
 * `set`, `get` und `mutate` (Dokumentänderung mit Historie) herein.
 */

import type {
  BimNode,
  Level,
  Wall,
} from '../../types/bim';
import { planeUebernahme } from '../../lib/aussenwand';
import { copyLevelContents } from '../../lib/levelCopy';
import { planeGeschosszuordnung } from '../../lib/importgeschoss';
import {
  recomputeRooms,
  transferRoomProperties,
  uid,
} from '../../lib/dokumentPflege';
import type { BimState, Mutate, StoreGet, StoreSet } from '../bimZustand';

export type GeschosseSchluessel =
  | 'addLevel'
  | 'deleteLevel'
  | 'zeigeGeschoss'
  | 'uebernehmeAussenwaende'
  | 'ordneGrundrissZu'
  | 'setActiveLevel';

export function geschosseSlice(set: StoreSet, get: StoreGet, mutate: Mutate): Pick<BimState, GeschosseSchluessel> {
  return {
    // ------------------------------------------------------------ Geschosse
    /**
     * Legt ein Geschoss an. `copyFrom` übernimmt die Wände des Bezugs-
     * geschosses samt Öffnungen — der Regelfall im Wohnungsbau, wo das
     * Obergeschoss demselben Grundriss folgt.
     *
     * **Was beim Übernehmen nicht mitkopiert wird.** Eine Treppe verbindet
     * zwei Geschosse und steht deshalb genau einmal im Modell: `levelId` ist
     * ihr unteres, `toLevelId` ihr oberes Ende. Sie zu kopieren ergäbe eine
     * zweite Treppe an derselben Stelle — zwei Bauteile für einen Sachverhalt,
     * mit doppeltem Flächenabzug und doppeltem Massenauszug. Kopiert wird sie
     * darum nicht; sie *wirkt* im neuen Geschoss trotzdem, weil
     * `applyVerticalDeductions` das Bauteil über beide Geschosse auflöst: unten
     * fehlt die Decke, oben der Fußboden. Der Plan des oberen Geschosses
     * zeichnet an dieser Stelle die Deckenöffnung, nicht die Treppe. Für
     * Schächte gilt dasselbe, aus demselben Grund.
     *
     * Bei massiven Bauteilen entscheidet `throughAllLevels`: ein Schornstein
     * geht ohnehin durch alle Geschosse darüber und wird deshalb wie die
     * Treppe nicht kopiert. Ein Pfeiler oder Wandversatz gehört dagegen zu
     * genau einem Geschoss — er ist Teil des übernommenen Grundrisses und
     * wird mitkopiert, wie eine Wand.
     *
     * `below: true` legt das Geschoss *unter* dem bisher untersten an. Ein
     * Keller ist dabei kein Obergeschoss mit umgekehrtem Vorzeichen: seine
     * lichte Höhe ist kleiner, sein Boden grenzt an Erdreich und seine Decke
     * an den Raum darüber, dessen Bodenplatte damit keine mehr ist.
     *
     * Vor allem aber braucht das Modell dann eine Geländeoberkante — ohne sie
     * stünde vor jeder Kellerwand die Norm-Außentemperatur. Sie wird deshalb
     * hier gesetzt, falls sie noch fehlt: 0,30 m unter dem bisher untersten
     * Fußboden, also auf Höhe der neuen Kellerdecke und damit die übliche
     * Sockelhöhe. Der neue Keller steckt so vollständig im Erdreich — der
     * Regelfall. Am Hang zieht der Anwender die Höhe tiefer, und die Wände
     * teilen sich von selbst in einen erdberührten und einen freien Teil.
     * Eine bereits erfasste Geländeoberkante wird nie überschrieben.
     */
    addLevel: (options) => {
      let created: Level | null = null;
      mutate((doc) => {
        const levels = Object.values(doc.levels).sort((a, b) => a.order - b.order);
        const below = levels[levels.length - 1];
        const above = levels[0];

        // 2,30 m lichte Höhe für den Keller: Erfahrungswert des deutschen
        // Wohnungsbaus, deutlich unter den 2,75 m eines Wohngeschosses.
        // Keine Normangabe — überschreibbar wie jede Vorbelegung.
        const KELLERHOEHE = 2.3;
        // Dieselbe Deckenstärke von 0,30 m wie beim Anbau nach oben.
        const DECKE = 0.3;
        // Wie viele Geschosse liegen schon unter dem Bezugsgeschoss? Aus
        // dieser Zahl folgt der Name: das erste ist das Kellergeschoss, jedes
        // weitere ein Untergeschoss mit fortlaufender Zählung — dieselbe
        // Systematik wie „1. OG, 2. OG" nach oben, nur mit dem in Deutschland
        // üblichen Sonderfall für die erste Ebene darunter. Ein „1. UG" gibt
        // es deshalb nicht: das ist das KG.
        const belowCount = levels.filter((l) => l.order < 0).length;

        const level: Level = options?.below
          ? {
              id: uid('lvl'),
              name: options.name ?? (belowCount === 0 ? 'KG' : `${belowCount + 1}. UG`),
              order: (above?.order ?? 0) - 1,
              elevation: (above?.elevation ?? 0) - (KELLERHOEHE + DECKE),
              height: KELLERHOEHE,
              // Kellersohle auf Erdreich; 0,35 W/(m²·K) ist die Größenordnung
              // einer Bodenplatte mit Perimeterdämmung.
              floorUValue: 0.35,
              floorBoundary: 'ground',
              // Kellerdecke gegen den Raum darüber — derselbe Wert, den der
              // Anbau nach oben für eine Geschossdecke setzt.
              ceilingUValue: 0.9,
              ceilingBoundary: 'adjacent-room',
            }
          : {
              id: uid('lvl'),
              name: options?.name ?? `${levels.filter((l) => l.order >= 0).length}. OG`,
              order: (below?.order ?? -1) + 1,
              elevation: below ? below.elevation + below.height + DECKE : 0,
              height: below?.height ?? 2.75,
              floorUValue: 0.9,
              floorBoundary: 'adjacent-room',
              ceilingUValue: below?.ceilingUValue ?? 0.2,
              ceilingBoundary: 'unheated',
            };
        doc.levels[level.id] = level;

        if (options?.below) {
          // Das Geschoss darüber steht jetzt nicht mehr auf Erdreich.
          if (above) {
            doc.levels[above.id] = {
              ...above,
              floorBoundary: 'adjacent-room',
              floorUValue: 0.9,
            };
          }

          // Ohne Geländeoberkante bliebe der Keller rechnerisch ein Geschoss
          // mit Norm-Außentemperatur vor der Wand. Vorhandene Angaben bleiben
          // unangetastet — sie können aus einer Hanglage stammen, die niemand
          // überschreiben darf.
          if (doc.meta.terrainElevation === undefined && above) {
            doc.meta.terrainElevation = above.elevation - DECKE;
          }
        } else if (below) {
          // Das Geschoss darunter grenzt jetzt an ein beheiztes Geschoss.
          doc.levels[below.id] = {
            ...below,
            ceilingBoundary: 'adjacent-room',
            ceilingUValue: 0.9,
          };
        }

        const source = options?.copyFrom ? doc.levels[options.copyFrom] : undefined;
        if (source) {
          // Welche Bauteile mitwandern, entscheidet der Rechenkern: die Regel
          // ist fachlich (eine Treppe gibt es einmal, ein Schornstein auch,
          // ein Pfeiler gehört zum Grundriss) und hat mit Zustandsverwaltung
          // nichts zu tun. Hier bleibt nur das Einhängen ins Dokument.
          const kopie = copyLevelContents({
            sourceLevelId: source.id,
            targetLevelId: level.id,
            targetHeight: level.height,
            nodes: Object.values(doc.nodes),
            walls: Object.values(doc.walls),
            openings: Object.values(doc.openings),
            verticals: Object.values(doc.verticals ?? {}),
            solids: Object.values(doc.solids ?? {}),
            durchbrueche: Object.values(doc.durchbrueche ?? {}),
            newId: uid,
          });
          for (const node of kopie.nodes) doc.nodes[node.id] = node;
          for (const wall of kopie.walls) doc.walls[wall.id] = wall;
          for (const opening of kopie.openings) doc.openings[opening.id] = opening;
          if (kopie.solids.length > 0) {
            const solids = doc.solids ?? {};
            for (const massiv of kopie.solids) solids[massiv.id] = massiv;
            doc.solids = solids;
          }
          if (kopie.durchbrueche.length > 0) {
            const durchbrueche = doc.durchbrueche ?? {};
            for (const db of kopie.durchbrueche) durchbrueche[db.id] = db;
            doc.durchbrueche = durchbrueche;
          }

          // Räume einmal vorab erkennen und beschriften. Der anschließende
          // reguläre Durchlauf in mutate() übernimmt die Namen dann als
          // „vorherigen Stand" — es bleibt bei einem Undo-Schritt.
          recomputeRooms(doc);
          transferRoomProperties(doc, source.id, level.id);
        }

        doc.activeLevelId = level.id;
        created = level;
      });
      set({ selection: null, selections: [], statusMessage: created ? `Geschoss „${(created as Level).name}" angelegt` : '' });
      return created;
    },

    deleteLevel: (id) => {
      const doc = get().doc;
      if (Object.keys(doc.levels).length <= 1) {
        set({ statusMessage: 'Das letzte Geschoss lässt sich nicht löschen' });
        return;
      }
      mutate((d) => {
        for (const w of Object.values(d.walls)) {
          if (w.levelId !== id) continue;
          for (const o of Object.values(d.openings)) if (o.wallId === w.id) delete d.openings[o.id];
          delete d.walls[w.id];
        }
        for (const n of Object.values(d.nodes)) if (n.levelId === id) delete d.nodes[n.id];
        for (const v of Object.values(d.verticals)) if (v.levelId === id) delete d.verticals[v.id];
        for (const b of Object.values(d.solids ?? {})) if (b.levelId === id) delete d.solids?.[b.id];
        for (const db of Object.values(d.durchbrueche ?? {})) {
          if (db.levelId === id) delete d.durchbrueche?.[db.id];
        }
        for (const pr of Object.values(d.pipes)) if (pr.levelId === id) delete d.pipes[pr.id];
        for (const an of Object.values(d.annotations)) if (an.levelId === id) delete d.annotations[an.id];
        for (const ro of Object.values(d.roofOpenings)) if (ro.levelId === id) delete d.roofOpenings[ro.id];
        for (const f of Object.values(d.fixtures)) if (f.levelId === id) delete d.fixtures[f.id];
        delete d.levels[id];
        if (d.activeLevelId === id) {
          d.activeLevelId = Object.values(d.levels).sort((a, b) => a.order - b.order)[0].id;
        }
      });
      set({ selection: null, selections: [] });
    },

    /**
     * Ein Geschoss im Modell ein- oder ausblenden.
     *
     * Das **aktive** Geschoss lässt sich nicht ausblenden: Man bearbeitet
     * nicht, was man nicht sieht — und ein Klick, nach dem der Plan leer ist
     * und niemand weiß warum, ist schlimmer als ein Klick, der nichts tut.
     */
    zeigeGeschoss: (id, sichtbar) => {
      const level = get().doc.levels[id];
      if (!level) return;
      /*
       * **Auch das aktive Geschoss lässt sich im Modell ausblenden.**
       *
       * Bis 1.56.0 nicht: „man bearbeitet nicht, was man nicht sieht". Für
       * den *Grundriss* stimmt das — dort zeigt die Ansicht ohnehin genau
       * ein Geschoss. Für das **Modell** stimmt es nicht, und der Fall, an
       * dem es auffiel, ist alltäglich: Wer von oben in den Keller sehen
       * will, muss Erd- und Dachgeschoss wegnehmen. Steht er dabei im
       * Keller, ist das Erdgeschoss nicht aktiv und geht weg — steht er im
       * Erdgeschoss, ging es nicht. Dass das Ausblenden davon abhängt, wo
       * man gerade arbeitet, ist für eine Ansicht die falsche Bedingung.
       *
       * Was bleibt, ist die **untere** Schranke: Das letzte sichtbare
       * Geschoss lässt sich nicht auch noch wegnehmen. Ein leeres Modell
       * sieht aus wie ein kaputtes, und niemand fände den Weg zurück.
       */
      if (!sichtbar) {
        const sichtbareAndere = Object.values(get().doc.levels).filter(
          (l) => l.id !== id && l.visible !== false,
        ).length;
        if (sichtbareAndere === 0) {
          set({ statusMessage: `${level.name} ist das letzte sichtbare Geschoss und bleibt im Modell` });
          return;
        }
      }
      mutate(
        (doc) => {
          const l = doc.levels[id];
          if (l) doc.levels[id] = { ...l, visible: sichtbar };
        },
        { skipRooms: true },
      );
      set({ statusMessage: `${level.name} ${sichtbar ? 'eingeblendet' : 'ausgeblendet'}` });
    },

    /**
     * Die Außenwände eines Geschosses in ein anderes übernehmen.
     *
     * Der Fall, für den es das gibt: Der erste Grundriss steht, und das
     * Obergeschoss hat dieselbe Hülle — was in aller Regel stimmt und was
     * niemand ein zweites Mal zeichnen will. Übernommen werden Achse,
     * Stärke, Wandart und Bauteilaufbau; **keine Öffnungen.** Fenster sitzen
     * oben anders, und ein mitkopiertes Fenster wäre eine Behauptung über
     * ein Geschoss, das niemand aufgemessen hat.
     *
     * Wände, die im Ziel schon an derselben Stelle liegen, entstehen nicht
     * noch einmal: Zwei deckungsgleiche Wände sind im Plan nicht zu
     * unterscheiden und verdoppeln jede Fläche in der Heizlast.
     */
    uebernehmeAussenwaende: (vonLevelId, nachLevelId) => {
      const doc0 = get().doc;
      const ziel = doc0.levels[nachLevelId];
      const quelle = doc0.levels[vonLevelId];
      if (!ziel || !quelle) return 0;

      const plan = planeUebernahme({
        walls: Object.values(doc0.walls),
        nodes: doc0.nodes,
        vonLevelId,
        nachLevelId,
        hoehe: ziel.height,
        uid,
      });
      if (!plan.neueWaende.length) {
        set({
          statusMessage:
            plan.schonDa > 0
              ? `${ziel.name}: alle ${plan.schonDa} Außenwände stehen dort schon`
              : `${quelle.name} hat keine Außenwände zum Übernehmen`,
        });
        return 0;
      }

      mutate((doc) => {
        for (const k of plan.neueKnoten) doc.nodes[k.id] = k;
        for (const w of plan.neueWaende) doc.walls[w.id] = w;
      });
      set({
        statusMessage:
          `${plan.neueWaende.length} Außenwände aus ${quelle.name} in ${ziel.name} übernommen` +
          (plan.schonDa > 0 ? ` · ${plan.schonDa} standen schon` : '') +
          ' · Öffnungen wurden nicht mitgenommen',
      });
      return plan.neueWaende.length;
    },

    ordneGrundrissZu: (ordnung, aussenwaendeDarunter = true) => {
      const doc0 = get().doc;
      const quelleId = doc0.activeLevelId;
      const plan = planeGeschosszuordnung({
        levels: Object.values(doc0.levels),
        quelleId,
        ordnung,
        uid,
      });

      if (plan.hinweis) {
        set({ statusMessage: plan.hinweis });
        return { ok: false, message: plan.hinweis };
      }

      /*
       * **Warum die Außenwände hier und nicht in `planeGeschosszuordnung`
       * geplant werden.** Der Übernahmeplan braucht die Zielgeschosse — und
       * die gibt es erst, seit der Zuordnungsplan sie erfunden hat. Beides in
       * einer Funktion hieße, dass sie Geschosse anlegt *und* Wände zieht;
       * getrennt bleibt jede für sich prüfbar. Gerechnet wird beides vor dem
       * Schreiben, damit ein einziger Schritt in der Historie entsteht.
       */
      const knoten: BimNode[] = [];
      const waende: Wall[] = [];
      if (aussenwaendeDarunter) {
        for (const ziel of plan.neu) {
          const uebernahme = planeUebernahme({
            walls: Object.values(doc0.walls),
            nodes: doc0.nodes,
            vonLevelId: quelleId,
            nachLevelId: ziel.id,
            hoehe: ziel.height,
            uid,
          });
          knoten.push(...uebernahme.neueKnoten);
          waende.push(...uebernahme.neueWaende);
        }
      }

      mutate((d) => {
        for (const l of plan.geaendert) d.levels[l.id] = l;
        for (const l of plan.neu) d.levels[l.id] = l;
        for (const k of knoten) d.nodes[k.id] = k;
        for (const w of waende) d.walls[w.id] = w;
      });

      const ziel = get().doc.levels[quelleId];
      const message =
        `Der Grundriss liegt jetzt im ${ziel?.name ?? 'Geschoss'}` +
        (plan.neu.length
          ? ` · ${plan.neu.length} Geschoss${plan.neu.length === 1 ? '' : 'e'} angelegt (` +
            plan.neu.map((l) => l.name).join(', ') +
            ')'
          : '') +
        (waende.length ? ` · ${waende.length} Außenwände darunter übernommen` : '') +
        (Math.abs(plan.anhebung) > 1e-6
          ? ` · Bestand um ${Math.abs(plan.anhebung).toFixed(2).replace('.', ',')} m ` +
            (plan.anhebung > 0 ? 'angehoben' : 'abgesenkt')
          : '') +
        ' · Öffnungen wurden nicht mitgenommen';
      set({ statusMessage: message });
      return { ok: true, message };
    },

    setActiveLevel: (id) => {
      if (!get().doc.levels[id]) return;
      mutate((doc) => {
        doc.activeLevelId = id;
      });
      set({ selection: null, selections: [], statusMessage: `Geschoss ${get().doc.levels[id]?.name}` });
    },
  };
}
