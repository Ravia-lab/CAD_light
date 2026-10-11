/**
 * Store-Slice „Löschen, Laden, Importe, Korrekturen und Projektwechsel".
 *
 * TD-22: Aus `useBimStore.ts` herausgelöst; die Aktionen sind unverändert.
 * `useBimStore` setzt den Store aus diesen Slices zusammen und reicht
 * `set`, `get` und `mutate` (Dokumentänderung mit Historie) herein.
 */

import type {
  BimDocument,
  BimNode,
  Level,
  Opening,
  Annotation,
  PipeRun,
  RoofOpening,
  Room,
  SiteElement,
  SolidElement,
  Durchbruch,
  VerticalElement,
  Construction,
  Fixture,
  FixtureType,
  Freihandstrich,
  Wall,
  WallType,
} from '../../types/bim';
import {
  DACH_VORGABE,
  FIXTURE_BY_TYPE,
} from '../../types/bim';
import { roundMm } from '../../lib/geometry';
import { migriereFixtures } from '../../lib/normleistung';
import { migriereUnbeheizt } from '../../lib/unbeheizt';
import { istHeizflaeche } from '../../lib/heizflaechenLeistung';
import { hinweiseZuRaeumen, leseVerworfene, type RaumverlustHinweis } from '../../lib/verworfeneRaeume';
import { hatAusgangspunkt, schlageErzeugerVor } from '../../lib/erzeugerplatz';
import { auswahlGesperrt } from '../../lib/ebenen';
import { bilanzSatz, leerePlan, loeschbilanz } from '../../lib/planLeeren';
import { partnerVon } from '../../lib/doppelleitung';
import { usageDefaults } from '../../lib/roomDetection';
import { importIfc } from '../../lib/ifcImport';
import { ordneRaumnamenZu } from '../../lib/raumnutzung';
import { importRaumplan } from '../../lib/raumplanImport';
import { ordneRaeumeZu } from '../../lib/raumZuordnung';
import {
  type EinheitArt,
  type Nutzungseinheit,
} from '../../lib/nutzungseinheiten';
import { importBuildingModel } from '../../lib/buildingModelImport';
import { benenneRaeume, scanDachZuordnen, uebernimmBeheizung, type ScanDachZuordnung } from '../../lib/scanUebernahme';
import { begradige } from '../../lib/begradigen';
import { befundSatz, hoehenbefund } from '../../lib/wandhoehen';
import { spiegleDokument } from '../../lib/spiegeln';
import { findeLuecken, oeffnungFuerLuecke } from '../../lib/luecken';
import { berichtSatz, kleineRaeume, planeKorrektur, wendeKorrekturAn } from '../../lib/autokorrektur';
import type { KorrekturAuswahl, KorrekturBericht } from '../../lib/autokorrektur';
import { benenneGeschosse, erdgeschossIndex } from '../../lib/levelGeometry';
import { applyHostPatch as applyPatchToDocument } from '../../lib/hostPatch';
import { geraeteprofil, geraetemerkmale } from '../../lib/geraeteprofil';
import {
  dachGeruest,
  pruneNodes,
  recomputeRooms,
  uid,
} from '../../lib/dokumentPflege';
import type { BimState, Mutate, StoreGet, StoreSet } from '../bimZustand';
import { dokumentAusScan, emptyDocument, ergaenzeEbenen } from '../bimZustand';

export type LadenSchluessel =
  | 'deleteSelection'
  | 'clearAll'
  | 'loadDemo'
  | 'loadIfc'
  | 'loadRaumscan'
  | 'loadBuilding'
  | 'wandhoehenVorschau'
  | 'gleicheWandhoehenAn'
  | 'begradigeWaende'
  | 'spiegleGrundriss'
  | 'schliesseLuecke'
  | 'planeAutokorrektur'
  | 'autokorrigiere'
  | 'neuesDokument'
  | 'setzeErzeugerNachVorschlag'
  | 'meldeVerworfeneRaeume'
  | 'loescheVerworfeneHinweise'
  | 'loadProject'
  | 'applyHostPatch'
  | 'replaceDocument';

export function ladenSlice(set: StoreSet, get: StoreGet, mutate: Mutate): Pick<BimState, LadenSchluessel> {
  return {
    deleteSelection: () => {
      const { selections, selection, doc: doc0 } = get();
      const gewaehlt = selections.length ? selections : selection ? [selection] : [];
      // Gesperrtes wird nicht gelöscht — siehe `moveSelection`.
      const targets = gewaehlt.filter((t) => !auswahlGesperrt(doc0, t));
      if (!targets.length) {
        if (gewaehlt.length) set({ statusMessage: 'Gesperrt — im Reiter „Ebenen" freigeben' });
        return;
      }

      /*
       * Gezählt wird, was wirklich weg ist.
       *
       * Vorher meldete die Statuszeile die Zahl der *angewählten* Objekte.
       * Wer einen Raum anklickte und Entf drückte, las „1 Objekt gelöscht"
       * und sah den Raum weiter im Plan stehen — eine Rückmeldung, die
       * lügt, ist schlimmer als gar keine. Räume sind abgeleitet: sie
       * verschwinden, wenn die Wände verschwinden, und nicht auf Zuruf.
       */
      let entfernt = 0;
      let geblieben = 0;
      /*
       * Vor der Änderung zählen, nicht danach.
       *
       * Nach `mutate` ist die Armatur weg, und `doc0` — der Stand von vorher
       * — führt sie nicht mehr, weil beide Stände sich dasselbe Verzeichnis
       * teilten. Das ist seit dieser Fassung behoben (siehe `cloneDoc`);
       * hier vorher zu zählen ist trotzdem das Richtige: Die Frage „war das
       * eine ausgelegte Armatur?" ist eine Frage an den Stand von vorher.
       */
      const ausgelegte = targets.filter(
        (t) => t.kind === 'accessory' && doc0.pipeAccessories?.[t.id]?.generated,
      ).length;
      mutate((doc) => {
        const zaehle = (weg: boolean): void => {
          if (weg) entfernt += 1;
          else geblieben += 1;
        };
        for (const sel of targets) {
          if (sel.kind === 'wall') {
            zaehle(sel.id in doc.walls);
            delete doc.walls[sel.id];
            for (const o of Object.values(doc.openings)) {
              if (o.wallId === sel.id) delete doc.openings[o.id];
            }
            // TGA-Objekte bleiben erhalten, verlieren aber ihre Wandbindung.
            for (const f of Object.values(doc.fixtures)) {
              if (f.wallId === sel.id) doc.fixtures[f.id] = { ...f, wallId: undefined };
            }
          } else if (sel.kind === 'opening') {
            zaehle(sel.id in doc.openings);
            delete doc.openings[sel.id];
          } else if (sel.kind === 'fixture') {
            zaehle(sel.id in doc.fixtures);
            delete doc.fixtures[sel.id];
          } else if (sel.kind === 'vertical') {
            zaehle(sel.id in doc.verticals);
            delete doc.verticals[sel.id];
          } else if (sel.kind === 'solid') {
            zaehle(Boolean(doc.solids && sel.id in doc.solids));
            if (doc.solids) delete doc.solids[sel.id];
          } else if (sel.kind === 'durchbruch') {
            zaehle(Boolean(doc.durchbrueche && sel.id in doc.durchbrueche));
            if (doc.durchbrueche) delete doc.durchbrueche[sel.id];
          } else if (sel.kind === 'pipe') {
            zaehle(sel.id in doc.pipes);
            // Der Rücklauf geht mit dem Vorlauf. Eine Heizung, die nur
            // hinführt, ist kein Zwischenstand, sondern ein Fehler — und
            // einer, den man im Plan nicht sieht.
            const paar = doc.pipes[sel.id] ? partnerVon(doc.pipes, doc.pipes[sel.id]) : undefined;
            delete doc.pipes[sel.id];
            if (paar) {
              // Auch der Partner wird gezählt. „1 Objekt gelöscht", wenn zwei
              // verschwunden sind, ist genau die Sorte Rückmeldung, wegen der
              // man dem Programm beim nächsten Mal nicht mehr glaubt.
              zaehle(true);
              delete doc.pipes[paar.id];
              for (const a of Object.values(doc.pipeAccessories ?? {})) {
                if (a.runId === paar.id) delete doc.pipeAccessories![a.id];
              }
            }
            /*
             * Mit der Leitung gehen die Armaturen, die auf ihr sitzen.
             *
             * Eine Armatur ohne Leitung ist kein Bauteil mehr, sondern ein
             * Symbol, das im Plan hängen bleibt und in den Massenauszug
             * geht. Von Hand gesetzte bleiben stehen, wenn sie keiner
             * Leitung zugeordnet sind — sie gehören dann dem Anwender.
             */
            for (const a of Object.values(doc.pipeAccessories ?? {})) {
              if (a.runId === sel.id) delete doc.pipeAccessories![a.id];
            }
          } else if (sel.kind === 'accessory') {
            /*
             * Auch eine ausgelegte Armatur lässt sich entfernen.
             *
             * Sie kommt bei der nächsten Rohrnetzauslegung wieder, weil die
             * Rechnung sie fordert — das steht danach in der Statuszeile.
             * Eine Armatur nicht löschen zu können, weil das Programm sie
             * gesetzt hat, wäre die schlechtere Antwort: dann stünde sie im
             * Plan, ohne dass jemand sie wegbekäme.
             */
            const armatur = doc.pipeAccessories?.[sel.id];
            zaehle(Boolean(armatur));
            // Die ζ-Liste eines Abschnitts (`PipeSegment.accessories`) wird
            // beim Aufbau des Netzes aus `doc.pipeAccessories` neu
            // gebildet — sie braucht hier kein Nachräumen.
            if (armatur && doc.pipeAccessories) delete doc.pipeAccessories[sel.id];
          } else if (sel.kind === 'annotation') {
            zaehle(sel.id in doc.annotations);
            delete doc.annotations[sel.id];
          } else if (sel.kind === 'roofOpening') {
            zaehle(sel.id in doc.roofOpenings);
            delete doc.roofOpenings[sel.id];
          } else if (sel.kind === 'site') {
            zaehle(sel.id in doc.site.elements);
            delete doc.site.elements[sel.id];
          } else if (sel.kind === 'heatpump') {
            zaehle(sel.id in doc.site.pumps);
            delete doc.site.pumps[sel.id];
          } else if (sel.kind === 'node') {
            let weg = false;
            for (const w of Object.values(doc.walls)) {
              if (w.a === sel.id || w.b === sel.id) {
                weg = true;
                delete doc.walls[w.id];
                for (const o of Object.values(doc.openings)) {
                  if (o.wallId === w.id) delete doc.openings[o.id];
                }
              }
            }
            zaehle(weg);
          } else {
            // Raum, Bild: nichts zu löschen. Der Zähler
            // merkt es sich, damit die Rückmeldung stimmt.
            geblieben += 1;
          }
        }
        pruneNodes(doc);
      }, {
        // Fällt eine von zwei Heizflächen im Raum weg, muss die verbliebene
        // wieder die ganze Last tragen. Ohne dieses Nachziehen bliebe der
        // Raum mit halber Heizfläche im Heft stehen.
        ziehenachHeizflaechen: targets.some(
          (t) => t.kind === 'fixture' && istHeizflaeche(doc0.fixtures[t.id]?.type ?? 'radiator'),
        ),
      });
      const meldung =
        entfernt === 0
          ? geblieben === 1
            ? 'Nichts gelöscht — dieses Objekt entsteht aus anderen und verschwindet mit ihnen.'
            : 'Nichts gelöscht — diese Objekte entstehen aus anderen und verschwinden mit ihnen.'
          : `${entfernt} Objekt${entfernt === 1 ? '' : 'e'} gelöscht` +
            (geblieben > 0 ? `, ${geblieben} unverändert` : '') +
            (ausgelegte > 0
              ? ` · ${ausgelegte === 1 ? 'die ausgelegte Armatur kommt' : 'ausgelegte Armaturen kommen'} bei der nächsten Rohrnetzauslegung wieder`
              : '');
      set({ selection: null, selections: [], statusMessage: meldung });
    },

    /*
     * „Alles löschen" — jetzt wirklich alles.
     *
     * Was hier stand, räumte elf Sammlungen und ließ Grundstück, Wärmepumpe,
     * Armaturen, Freihandnotizen, Referenzbild, Dächer und die ausgelegte
     * Anlage stehen. Die Begründung dafür stand nirgends, und im Plan sah man
     * nur das Ergebnis: eine leere Zeichenfläche mit einer
     * Grundstücksgrenze darauf, die sich mit demselben Knopf nicht mehr
     * entfernen ließ. Was bleibt und was geht, steht jetzt an einer Stelle
     * und mit Begründung in `planLeeren.ts`.
     *
     * Zurückgegeben wird die Bilanz — der Aufrufer zeigt sie *vor* der
     * Rückfrage und danach in der Statuszeile.
     */
    clearAll: () => {
      const bilanz = loeschbilanz(get().doc);
      mutate((doc) => leerePlan(doc));
      set({
        selection: null,
        selections: [],
        statusMessage: bilanzSatz(bilanz),
      });
      return bilanz;
    },

    loadDemo: () => {
      mutate((doc) => {
        doc.nodes = {};
        doc.walls = {};
        doc.openings = {};
        doc.fixtures = {};
        doc.rooms = {};

        const mk = (x: number, y: number): BimNode => {
          const n: BimNode = { id: uid('n'), x, y, levelId: doc.activeLevelId };
          doc.nodes[n.id] = n;
          return n;
        };
        const link = (a: BimNode, b: BimNode, thickness: number, type: WallType, uValue: number) => {
          const w: Wall = {
            id: uid('w'),
            levelId: doc.activeLevelId,
            a: a.id,
            b: b.id,
            thickness,
            height: 2.75,
            type,
            layerId: 'layer-walls',
            uValue,
          };
          doc.walls[w.id] = w;
          return w;
        };

        // Außenhülle 10,00 × 7,50 m
        const p1 = mk(0, 0);
        const p2 = mk(10, 0);
        const p3 = mk(10, 7.5);
        const p4 = mk(0, 7.5);
        // Innere Achsen
        const q1 = mk(6, 0);
        const q2 = mk(6, 7.5);
        const q3 = mk(6, 4.2);
        const q4 = mk(10, 4.2);

        const south = link(p1, q1, 0.365, 'exterior', 0.21);
        const south2 = link(q1, p2, 0.365, 'exterior', 0.21);
        const east1 = link(p2, q4, 0.365, 'exterior', 0.21);
        const east2 = link(q4, p3, 0.365, 'exterior', 0.21);
        const north = link(p3, q2, 0.365, 'exterior', 0.21);
        const north2 = link(q2, p4, 0.365, 'exterior', 0.21);
        const west = link(p4, p1, 0.365, 'exterior', 0.21);
        const spineS = link(q1, q3, 0.175, 'interior', 1.2);
        const spineN = link(q3, q2, 0.175, 'interior', 1.2);
        const cross = link(q3, q4, 0.115, 'partition', 1.4);

        const openings: Omit<Opening, 'id'>[] = [
          { wallId: south.id, kind: 'window', distance: 3, width: 1.51, height: 1.385, sillHeight: 0.9, uValue: 0.95, gValue: 0.6 },
          { wallId: south2.id, kind: 'door', distance: 1.8, width: 1.01, height: 2.135, sillHeight: 0, uValue: 1.4, hinge: 'left' },
          { wallId: west.id, kind: 'window', distance: 3.7, width: 1.26, height: 1.385, sillHeight: 0.9, uValue: 0.95, gValue: 0.6 },
          { wallId: north2.id, kind: 'window', distance: 2.1, width: 1.76, height: 1.385, sillHeight: 0.9, uValue: 0.95, gValue: 0.6 },
          { wallId: east1.id, kind: 'window', distance: 2.1, width: 0.885, height: 1.135, sillHeight: 1.1, uValue: 0.95, gValue: 0.6 },
          { wallId: east2.id, kind: 'window', distance: 1.6, width: 1.26, height: 1.385, sillHeight: 0.9, uValue: 0.95, gValue: 0.6 },
          { wallId: spineS.id, kind: 'door', distance: 2.1, width: 0.885, height: 2.01, sillHeight: 0, uValue: 1.8, hinge: 'right' },
          { wallId: spineN.id, kind: 'door', distance: 1.7, width: 0.885, height: 2.01, sillHeight: 0, uValue: 1.8, hinge: 'left' },
          { wallId: cross.id, kind: 'door', distance: 2.6, width: 0.76, height: 2.01, sillHeight: 0, uValue: 1.8, hinge: 'left' },
        ];
        for (const o of openings) {
          const id = uid('o');
          doc.openings[id] = { ...o, id };
        }

        // Ein Durchgang ohne Tür — zeigt die Aussparung in 2D und 3D.
        const passageId = uid('o');
        doc.openings[passageId] = {
          id: passageId,
          wallId: cross.id,
          kind: 'passage',
          distance: 1.2,
          width: 1.26,
          height: 2.135,
          sillHeight: 0,
          passageType: 'lintel',
        };

        // TGA-Ausstattung: Heizkörper unter den Fenstern, Bad und Lüftung.
        const place = (
          type: FixtureType,
          x: number,
          y: number,
          rotation: number,
          params: Record<string, unknown> = {},
        ) => {
          const def = FIXTURE_BY_TYPE[type];
          const id = uid('f');
          doc.fixtures[id] = {
            id,
            type,
            category: def.category,
            levelId: doc.activeLevelId,
            position: { x, y },
            rotation,
            length: def.length,
            depth: def.depth,
            elevation: def.elevation,
            label: def.label,
            params: { ...def.params, ...params },
          };
        };

        place('radiator', 3, 0.28, 0, { ratedPower: 2740, ratedPowerSource: 'datenblatt' });
        place('radiator', 0.28, 3.7, 90, { ratedPower: 2150, ratedPowerSource: 'datenblatt' });
        place('radiator', 2.1, 7.22, 180, { ratedPower: 1760, ratedPowerSource: 'datenblatt' });
        place('radiator', 9.72, 2.1, 270, { ratedPower: 1370, ratedPowerSource: 'datenblatt' });
        place('wc', 8.6, 6.6, 180);
        place('washbasin', 9.4, 6.9, 180);
        place('shower', 7.2, 6.6, 0);
        place('air-exhaust', 8.3, 5.6, 0, { airflow: 60 });
        place('air-supply', 3, 4, 0, { airflow: 45 });
        place('manifold', 6.4, 1.2, 90);

        void north;
      });

      // Räume sinnvoll benennen (nach Größe sortiert vorhanden)
      const rooms = Object.values(get().doc.rooms);
      const naming: { name: string; usage: Room['usage'] }[] = [
        { name: 'Wohnen / Essen', usage: 'living' },
        { name: 'Schlafen', usage: 'bedroom' },
        { name: 'Bad', usage: 'bath' },
        { name: 'Flur', usage: 'hallway' },
      ];
      rooms.forEach((room, i) => {
        const preset = naming[i];
        if (preset) get().updateRoom(room.id, { name: preset.name, usage: preset.usage });
      });
      set({ statusMessage: 'Demo-Grundriss geladen', einpassenZaehler: get().einpassenZaehler + 1 });
    },

    /**
     * Liest eine IFC4-Datei ein.
     *
     * Anders als beim Projektexport entsteht daraus bewusst ein *neues*
     * Dokument: eine Fremddatei in ein bestehendes Modell zu mischen wäre
     * kaum kontrollierbar. Der Schritt liegt in der Historie, ein Undo holt
     * den vorherigen Stand zurück.
     */
    loadIfc: (text) => {
      const result = importIfc(text);
      if (!result.ok) return { ok: false, message: result.message };

      const fresh = emptyDocument();
      fresh.meta = {
        ...fresh.meta,
        name: result.projectName || 'IFC-Import',
        modifiedAt: new Date().toISOString(),
      };
      // Geschossnamen: eine IFC-Datei liefert oft nur „Geschoss 1, 2, 3".
      // Benannt wird deshalb nach der Höhenlage — das Erdgeschoss ist das
      // Geschoss am Bezugspunkt, nicht das unterste. Sprechende Namen aus der
      // Datei bleiben stehen.
      const sortiertNachHoehe = [...result.levels].sort((a, b) => a.elevation - b.elevation);
      const namen = benenneGeschosse(sortiertNachHoehe);
      const egIdx = erdgeschossIndex(sortiertNachHoehe.map((l) => l.elevation));
      fresh.levels = Object.fromEntries(
        sortiertNachHoehe.map((l, i) => [
          l.id,
          {
            id: l.id,
            name: namen[i],
            order: i - egIdx,
            elevation: l.elevation,
            height: l.height,
            // Erdreich liegt unter dem *untersten* Geschoss, nicht unter dem
            // Erdgeschoss: hat das Haus einen Keller, steht das EG auf dessen
            // Decke.
            floorUValue: i === 0 ? 0.3 : 0.9,
            floorBoundary: i === 0 ? ('ground' as const) : ('adjacent-room' as const),
            ceilingUValue: 0.2,
            ceilingBoundary: 'unheated' as const,
          },
        ]),
      );
      // Angefangen wird im Erdgeschoss. Das unterste Geschoss ist bei einem
      // unterkellerten Haus der Keller, und niemand beginnt ein Aufmaß dort.
      fresh.activeLevelId = sortiertNachHoehe[egIdx]?.id ?? sortiertNachHoehe[0]?.id ?? fresh.activeLevelId;
      fresh.nodes = Object.fromEntries(result.nodes.map((n) => [n.id, n]));
      fresh.walls = Object.fromEntries(result.walls.map((w) => [w.id, w]));
      fresh.openings = Object.fromEntries(result.openings.map((o) => [o.id, o]));
      recomputeRooms(fresh);

      set({
        doc: fresh,
        past: [...get().past.slice(-49), get().doc],
        future: [],
        selection: null,
        selections: [],
        einpassenZaehler: get().einpassenZaehler + 1,
      });

      /*
       * Die Namen, die der Architekt vergeben hat.
       *
       * `IfcSpace` ist die einzige Stelle in einer IFC-Datei, an der steht,
       * wie ein Raum heißt. Ohne sie kommt jeder Raum als „Raum 3",
       * Nutzung „sonstige", 20 °C an — beim FZK-Haus fünf Räume, beim
       * Institutsgebäude des KIT 82. Die Nutzung entscheidet über die
       * Solltemperatur nach DIN EN 12831; sie von Hand nachzutragen ist
       * genau die Arbeit, die ein Import abnehmen soll.
       *
       * Die **Geometrie** kommt weiter aus den Wänden. Der Umriss aus der
       * Datei dient nur dazu, den Raum wiederzufinden; würde er den
       * erkannten ersetzen, hätte das Modell zwei Wahrheiten, die beim
       * ersten Verschieben einer Wand auseinanderlaufen.
       */
      const zuordnung = ordneRaumnamenZu(
        Object.values(fresh.rooms).map((r) => ({
          id: r.id,
          levelId: r.levelId,
          polygon: r.polygon,
          area: r.area,
        })),
        result.spaces,
      );
      let zusammengefasst = 0;
      for (const z of zuordnung) {
        const raum = fresh.rooms[z.roomId];
        if (!raum) continue;
        const vorgabe = z.usage ? usageDefaults(z.usage) : undefined;
        fresh.rooms[z.roomId] = {
          ...raum,
          name: z.name,
          ...(z.usage && vorgabe
            ? {
                usage: z.usage,
                // Die Normwerte ziehen mit der Nutzung nach — sonst stünde
                // im Bad der Name „Bad" und daneben 20 °C. Dieselbe Regel
                // wie in `updateRoom`, nur ohne den Umweg über den Patch.
                setpointTemperature: vorgabe.temp,
                airChangeRate: vorgabe.ach,
                ventilationRole: vorgabe.air,
              }
            : {}),
        };
        zusammengefasst += z.weitere.length;
      }

      const rooms = Object.keys(fresh.rooms).length;
      // Alle Gründe nennen, nicht nur den ersten.
      //
      // Vorher stand hier `result.skipped[0].reason`. Beim FZK-Haus des KIT
      // waren zwei Gründe im Spiel — vier Wände ohne auswertbare Geometrie
      // und drei Öffnungen, die deshalb ihre Wand verloren hatten. Gemeldet
      // wurde nur der erste, und damit fehlte gerade der Hinweis, dass das
      // eine das andere nach sich zog. Die Liste ist kurz: es gibt nur eine
      // Handvoll Gründe, und jeder steht mit seiner Anzahl da.
      const uebersprungen = result.skipped.reduce((sum, s2) => sum + s2.count, 0);
      const gruende = result.skipped.map((s2) => `${s2.count}× ${s2.reason}`).join(', ');
      const vorbehalte = result.hinweise.map((h) => `${h.count}× ${h.reason}`).join(', ');
      return {
        ok: true,
        message:
          `IFC ${result.schema ?? ''}: ${result.walls.length} Wände, ${result.openings.length} Öffnungen, ` +
          `${rooms} Räume erkannt` +
          (zuordnung.length ? `, ${zuordnung.length} benannt` : '') +
          (uebersprungen ? ` — ${uebersprungen} Bauteile übersprungen (${gruende})` : '') +
          (vorbehalte ? ` · Hinweis: ${vorbehalte}` : '') +
          // Wo der Architekt Raumgrenzen ohne Wand gezogen hat, erkennt
          // CAD Light zu Recht einen Raum — aber der Nutzer soll erfahren,
          // dass die Datei dort mehr Räume kennt als sein Grundriss.
          (zusammengefasst
            ? ` · ${zusammengefasst} Raum/Räume der Datei liegen ohne trennende Wand in einem erkannten Raum`
            : ''),
      };
    },

    /**
     * Liest einen Raumscan aus Apple RoomPlan ein.
     *
     * Wie beim IFC-Import entsteht bewusst ein *neues* Dokument. Was den Scan
     * vom IFC unterscheidet, ist die Rechenschaft: ein Scan misst Wände ohne
     * Dicke und kennt keinen Türanschlag. Beides wird geschätzt, und beides
     * steht hinterher in der Statuszeile — der Nutzer soll wissen, welche
     * Zahlen aus dem Aufmaß kommen und welche aus einer Annahme.
     */
    loadRaumscan: (text) => {
      const ergebnis = importRaumplan(text);
      if (!ergebnis.ok) return { ok: false, message: ergebnis.message };

      const { fresh, benannt, doppelt } = dokumentAusScan(ergebnis);

      set({
        doc: fresh,
        past: [...get().past.slice(-49), get().doc],
        future: [],
        selection: null,
        selections: [],
        einpassenZaehler: get().einpassenZaehler + 1,
      });

      const offen = fresh.diagnostics.openEnds.length;
      const raeume = Object.keys(fresh.rooms).length;
      return {
        ok: true,
        message:
          `${ergebnis.message} · ${raeume} Räume erkannt, ${benannt} benannt` +
          (doppelt
            ? ` · ${doppelt} Raumname nicht vergeben: dort liegen zwei Bereiche in einem Raum, zwischen ihnen fehlt eine Wand`
            : '') +
          (offen ? ` · ${offen} offene Wandenden — der Scan hat dort keine Wand gemessen` : ''),
      };
    },

    /**
     * Übernimmt das Gebäudemodell der App RaVia Scan.
     *
     * Geometrie wie beim Raumscan (gleicher Weg über `dokumentAusScan`), dazu
     * zwei Dinge, die eine RoomPlan-Datei nicht kennt: den **Dachvorschlag**
     * je Geschoss, geschätzt aus den gescannten Dachschrägen, und die
     * **Heizkörper** mit gemessenen Maßen. Beide werden vor der Raumerkennung
     * eingesetzt, damit Dachräume ihre Höhen und Heizkörper ihren Raum
     * bekommen. Eine Heizleistung setzt der Import nicht.
     */
    loadBuilding: (data, optionen) => {
      const ergebnis = importBuildingModel(data);
      if (!ergebnis.ok) return { ok: false, message: ergebnis.message };

      const { fresh, benannt, doppelt, bereiche } = dokumentAusScan(ergebnis, (doc) => {
        for (const f of ergebnis.fixtures) {
          if (doc.levels[f.levelId]) doc.fixtures[f.id] = f;
        }
      });
      if (ergebnis.koordinaten && !fresh.meta.name) fresh.meta.name = 'Gebäudescan';

      /*
       * Das Dach erst **nach** der ersten Raumerkennung — es wird an Räume
       * gebunden, und die gibt es vorher nicht (`lib/scanUebernahme.ts`).
       * Danach noch einmal erkennen: Das Dach bestimmt Höhe und Volumen
       * unter der Schräge. Die Raumkennungen bleiben dabei stehen, weil die
       * Erkennung sie über die Randwände wiederfindet, und mit ihnen die
       * Namen.
       */
      let zuordnung: ScanDachZuordnung[] = [];
      if (Object.keys(ergebnis.daecher).length) {
        zuordnung = scanDachZuordnen(fresh.levels, Object.values(fresh.rooms), ergebnis);
        recomputeRooms(fresh);
      }
      /*
       * Die Prüfpunkte der App kommen nicht mehr als Textfahnen in den Plan
       * (Wunsch Manuel, 07.10.2026: „wenn ich nach CAD importiere, brauche
       * ich keinen Text“). Bei einem Ganzscan waren es Dutzende Fahnen, die
       * den Grundriss überdeckten. Die Prüfliste steht in der App; dort
       * werden die Stellen auch nachgescannt. `pruefpunkteAlsHinweise`
       * bleibt für den Fall, dass die Fahnen wieder zuschaltbar werden.
       */

      /*
       * Hinzufügen statt ersetzen.
       *
       * Ein Haus wird selten in einem Zug gescannt: Reißt das Tracking auf
       * der Treppe, kommt das Obergeschoss als zweite Aufnahme. Dann darf
       * der Scan das Erdgeschoss nicht wegwerfen. Ersetzt wird deshalb nur
       * das Geschoss, das der Scan mitbringt — alles andere bleibt stehen.
       *
       * Die Lage in der Ebene ist damit noch nicht geklärt: Zwei Aufnahmen
       * haben zwei Nullpunkte. Das Geschoss landet dort, wo der Scan es
       * sieht; zurechtschieben geht wie bei jedem kopierten Geschoss.
       */
      let ziel = fresh;
      let ergaenzt = 0;
      let ersetzt = 0;
      let benanntGesamt = benannt;
      let doppeltGesamt = doppelt;
      const vorher = get().doc;
      if (optionen?.merge && Object.keys(vorher.walls).length > 0) {
        ziel = structuredClone(vorher);
        ziel.meta = { ...ziel.meta, modifiedAt: new Date().toISOString() };
        for (const level of Object.values(fresh.levels)) {
          if (ziel.levels[level.id]) ersetzt++;
          else ergaenzt++;
          // Was auf diesem Geschoss stand, stammt aus dem vorigen Scan
          // desselben Geschosses und wird ersetzt.
          for (const w of Object.values(ziel.walls)) if (w.levelId === level.id) delete ziel.walls[w.id];
          for (const o of Object.values(ziel.openings)) {
            if (!ziel.walls[o.wallId]) delete ziel.openings[o.id];
          }
          for (const n of Object.values(ziel.nodes)) if (n.levelId === level.id) delete ziel.nodes[n.id];
          for (const f of Object.values(ziel.fixtures)) if (f.levelId === level.id) delete ziel.fixtures[f.id];
          for (const r of Object.values(ziel.rooms)) if (r.levelId === level.id) delete ziel.rooms[r.id];
          ziel.levels[level.id] = level;
        }
        /*
         * Kennungen eindeutig machen.
         *
         * Zwei Aufnahmen nennen ihre erste Wand beide `w-001` — die Zählung
         * beginnt in jedem Scan von vorn. Würde man sie unverändert
         * übernehmen, überschriebe das Obergeschoss die Wände des
         * Erdgeschosses, und der Grundriss darunter verschwände. Beim
         * Zusammenlegen bekommt deshalb alles aus dem neuen Scan das
         * Geschoss als Vorsatz.
         */
        const zielGeschoss = Object.values(fresh.levels)[0]?.id ?? 'x';
        const vorsatz = (id: string): string => `${zielGeschoss}-${id}`;
        const neueKnoten = new Map<string, string>();
        for (const n of Object.values(fresh.nodes)) {
          const id = vorsatz(n.id);
          neueKnoten.set(n.id, id);
          ziel.nodes[id] = { ...n, id };
        }
        const neueWaende = new Map<string, string>();
        for (const w of Object.values(fresh.walls)) {
          const id = vorsatz(w.id);
          neueWaende.set(w.id, id);
          ziel.walls[id] = { ...w, id, a: neueKnoten.get(w.a) ?? w.a, b: neueKnoten.get(w.b) ?? w.b };
        }
        for (const o of Object.values(fresh.openings)) {
          const id = vorsatz(o.id);
          ziel.openings[id] = { ...o, id, wallId: neueWaende.get(o.wallId) ?? o.wallId };
        }
        for (const f of Object.values(fresh.fixtures)) {
          const id = vorsatz(f.id);
          ziel.fixtures[id] = { ...f, id, ...(f.wallId ? { wallId: neueWaende.get(f.wallId) ?? f.wallId } : {}) };
        }
        // Prüfpunkte dieses Geschosses ersetzen die eines früheren Scans davon.
        for (const a of Object.values(ziel.annotations)) {
          if (a.id.includes('sc-pp') && fresh.levels[a.levelId]) delete ziel.annotations[a.id];
        }
        for (const a of Object.values(fresh.annotations)) {
          const id = vorsatz(a.id);
          ziel.annotations[id] = { ...a, id };
        }
        // Geschosse neu ordnen: die Reihenfolge ergibt sich aus der Höhenlage.
        const sortiert = Object.values(ziel.levels).sort((a, b) => a.elevation - b.elevation);
        const egIdx = erdgeschossIndex(sortiert.map((l) => l.elevation));
        sortiert.forEach((l, i) => { ziel.levels[l.id] = { ...l, order: i - egIdx }; });
        ziel.activeLevelId = Object.values(fresh.levels)[0]?.id ?? ziel.activeLevelId;
        recomputeRooms(ziel);
        // Die Dachbelege tragen die Wandkennungen aus dem Scan; im
        // zusammengelegten Modell haben die Wände den Geschoss-Vorsatz.
        if (Object.keys(ergebnis.daecher).length) {
          const belege = Object.fromEntries(
            Object.entries(ergebnis.dachBelege).map(([l, ids]) => [l, ids.map((id) => neueWaende.get(id) ?? id)]),
          );
          zuordnung = scanDachZuordnen(ziel.levels, Object.values(ziel.rooms), { daecher: ergebnis.daecher, dachBelege: belege });
          recomputeRooms(ziel);
        }
        const namen = benenneRaeume(ziel, ergebnis.raumHinweise);
        uebernimmBeheizung(ziel, ergebnis.raumBeheizung);
        benanntGesamt = namen.benannt;
        doppeltGesamt = namen.doppelt;
      }

      set({
        doc: ziel,
        past: [...get().past.slice(-49), get().doc],
        future: [],
        selection: null,
        selections: [],
        einpassenZaehler: get().einpassenZaehler + 1,
      });
      // Am Telefon zuerst prüfen, nicht zeichnen (Auftrag A5).
      if (typeof window !== 'undefined' && geraeteprofil(geraetemerkmale(window)).form === 'phone') {
        get().setPruefansicht(true);
      }

      const offen = ziel.diagnostics.openEnds.length;
      const raeume = Object.keys(ziel.rooms).length;
      const ohneDach = zuordnung.reduce((s, z) => s + z.ohneDach.length, 0);
      const unterDach = zuordnung.filter((z) => z.lageBelegt).reduce((s, z) => s + z.unterDach.length, 0);
      const dachText = zuordnung.length
        ? zuordnung.every((z) => !z.lageBelegt)
          ? ' · Dach über dem ganzen Geschoss — der Scan belegt nicht, wo es sitzt (Hinweis in der Prüfung)'
          : ` · Dach über ${unterDach} Räumen` + (ohneDach ? `, ${ohneDach} mit gerader Decke (Hinweis in der Prüfung)` : '')
        : '';
      // Gegenprobe Luftvolumen: was der Scan rechnet, neben dem, was hier aus
      // den erkannten Räumen entsteht (Schema 1.10.0, `rooms[].volume`).
      const fmt = (v: number) => v.toFixed(1).replace('.', ',');
      const volumenText =
        ziel === fresh
          ? ergebnis.scanVolumen
              .map((v) => {
                const hier = Object.values(ziel.rooms)
                  .filter((r) => r.levelId === v.levelId)
                  .reduce((summe, r) => summe + (r.volume ?? 0), 0);
                const art = v.quelle === 'roofModel' ? 'unter dem Dachmodell' : v.quelle ? `Quelle ${v.quelle}` : '';
                const gerade = v.volumenGerade !== undefined ? `gerade Decke ${fmt(v.volumenGerade)} m³` : '';
                const klammer = [art, gerade].filter(Boolean).join('; ');
                return ` · Luftvolumen ${ziel.levels[v.levelId]?.name ?? v.levelId}: Scan ${fmt(v.volumen)} m³${klammer ? ` (${klammer})` : ''}, hier aus den Räumen ${fmt(hier)} m³`;
              })
              .join('')
          : '';
      const dazu = ziel === fresh ? '' :
        ` · ${ergaenzt} Geschoss(e) ergänzt${ersetzt ? `, ${ersetzt} ersetzt` : ''}, bestehende Geschosse bleiben stehen`;
      return {
        ok: true,
        message:
          `RaVia Scan: ${ergebnis.message}${dazu} · ${raeume} Räume erkannt, ${benanntGesamt} benannt` +
          dachText +
          volumenText +
          (bereiche.length
            ? ` · ${bereiche.map((b) => `„${b}"`).join(', ')} galt für das ganze Geschoss und wurde keinem Raum gegeben`
            : '') +
          (ergebnis.pruefhinweise.length ? ` · Hinweise der App: ${ergebnis.pruefhinweise.map((h) => h.text).join(' / ')}` : '') +
          (doppeltGesamt ? ` · ${doppeltGesamt} Raumname nicht vergeben (zwei Bereiche in einem Raum, dazwischen fehlt eine Wand)` : '') +
          (offen ? ` · ${offen} offene Wandenden` : '') +
          (ergebnis.nordGenauigkeitGrad !== undefined
            ? ` · Nordrichtung ±${String(ergebnis.nordGenauigkeitGrad).replace('.', ',')}°`
            : ''),
      };
    },

    /**
     * Wände gerade ziehen.
     *
     * Bewegt Knoten, nicht Wände — siehe `lib/begradigen.ts`. Öffnungen wandern
     * **verhältnisgleich** mit: ändert sich die Wandlänge um ein Prozent, rückt
     * eine Tür in der Wandmitte um ein halbes Prozent. Absolut stehen zu lassen
     * wäre die naheliegende und falsche Wahl — eine Öffnung am fernen Ende
     * stünde nach dem Begradigen über der Wandkante und verschwände beim
     * nächsten Neuzeichnen.
     */
    /**
     * Was eine Angleichung täte — ohne sie zu tun.
     *
     * Eigene Funktion und nicht ein Rückgabewert von `gleicheWandhoehenAn`,
     * weil die Vorschau bei **jedem** Bild gebraucht wird: Der Knopf trägt
     * die Zahl, bevor ihn jemand drückt. Ein Knopf, der erst nach dem
     * Drücken sagt, was er getan hat, ist bei einer Änderung an 40 Wänden
     * kein Angebot, sondern eine Zumutung.
     */
    wandhoehenVorschau: () => {
      const doc = get().doc;
      const level = doc.levels[doc.activeLevelId];
      const waende = Object.values(doc.walls);
      if (!level) {
        return { soll: 0, aenderungen: [], ausnahmen: [], groessteAbweichung: 0, gesamt: 0 };
      }
      return hoehenbefund({ level, walls: waende, nodes: doc.nodes, roofFrames: dachGeruest(doc, level) });
    },

    /**
     * Wandhöhen angleichen.
     *
     * **Warum das überhaupt nötig ist.** Die Raumhöhe ist in diesem Programm
     * keine Eingabe, sondern eine Messung: die *niedrigste* Wand des Raums.
     * Eine Wand, die beim Zeichnen auf 2,19 m stehen geblieben ist, macht
     * daraus die Höhe des ganzen Raums — und damit sein Volumen, seinen
     * Luftwechsel und seinen Lüftungsverlust. Im Plan steht dann neben
     * 2,44 m ein 2,19 m, das nie jemand gemessen hat.
     *
     * Angefasst wird nur, was eine Raumwand ist und nicht unter der
     * Dachschräge liegt; die Begründung steht in `lib/wandhoehen.ts`. Der
     * Schritt geht in die Historie und ist mit Rückgängig zu widerrufen —
     * eine Änderung an vielen Wänden auf einmal muss man zurücknehmen
     * können, ohne sie einzeln zu suchen.
     */
    gleicheWandhoehenAn: () => {
      const doc = get().doc;
      const level = doc.levels[doc.activeLevelId];
      if (!level) {
        const m = 'Kein Geschoss gewählt.';
        set({ statusMessage: m });
        return { ok: false, message: m };
      }
      const befund = hoehenbefund({
        level,
        walls: Object.values(doc.walls),
        nodes: doc.nodes,
        roofFrames: dachGeruest(doc, level),
      });
      if (befund.aenderungen.length === 0) {
        const m = befundSatz(befund);
        set({ statusMessage: m });
        return { ok: false, message: m };
      }
      mutate((d) => {
        for (const a of befund.aenderungen) {
          const w = d.walls[a.wallId];
          if (w) d.walls[a.wallId] = { ...w, height: a.soll };
        }
      });
      const m = `Wandhöhen angeglichen: ${befundSatz(befund)}`;
      set({ statusMessage: m });
      return { ok: true, message: m };
    },

    begradigeWaende: (optionen) => {
      const doc = get().doc;
      const waende = Object.values(doc.walls).filter((w) => w.levelId === doc.activeLevelId);
      const ergebnis = begradige(waende, doc.nodes, optionen);
      if (ergebnis.bewegt === 0) {
        const meldung =
          ergebnis.achsparallelVorher === waende.length
            ? 'Alle Wände stehen bereits gerade.'
            : ergebnis.uebersprungen > 0
              ? `Nichts verändert — ${ergebnis.uebersprungen} Wandzüge hätten sich dabei um mehr als das Erlaubte verschoben.`
              : 'Nichts zu begradigen.';
        set({ statusMessage: meldung });
        return { ok: false, message: meldung };
      }

      mutate((d) => {
        for (const [id, p] of Object.entries(ergebnis.knoten)) {
          const n = d.nodes[id];
          if (n) d.nodes[id] = { ...n, x: p.x, y: p.y };
        }
        for (const o of Object.values(d.openings)) {
          const laenge = ergebnis.laengen[o.wallId];
          if (!laenge || laenge.vorher <= 0) continue;
          const faktor = laenge.nachher / laenge.vorher;
          const mitte = Math.min(
            Math.max(o.distance * faktor, o.width / 2),
            laenge.nachher - o.width / 2,
          );
          d.openings[o.id] = { ...o, distance: roundMm(mitte) };
        }
      });

      const message =
        `${ergebnis.bewegt} Knoten gerade gezogen, größter Versatz ` +
        `${ergebnis.groessterVersatz.toFixed(3).replace('.', ',')} m · ` +
        `${ergebnis.achsparallelNachher} von ${waende.length} Wänden stehen jetzt genau auf der Achse ` +
        `(vorher ${ergebnis.achsparallelVorher})` +
        (ergebnis.schraeg ? ` · ${ergebnis.schraeg} schräge Wände unangetastet` : '') +
        (ergebnis.uebersprungen ? ` · ${ergebnis.uebersprungen} Wandzüge übersprungen` : '');
      set({ statusMessage: message });
      return { ok: true, message };
    },

    spiegleGrundriss: (achse, umfang) => {
      const doc = get().doc;
      const ergebnis = spiegleDokument(doc, {
        achse,
        geschosse: umfang === 'alles' ? 'alle' : [doc.activeLevelId],
      });

      if (ergebnis.leer) {
        const meldung =
          umfang === 'alles'
            ? 'Nichts zu spiegeln — das Projekt ist leer.'
            : 'Nichts zu spiegeln — in diesem Geschoss steht noch nichts.';
        set({ statusMessage: meldung });
        return { ok: false, message: meldung };
      }

      mutate((d) => {
        d.nodes = ergebnis.nodes;
        d.openings = ergebnis.openings;
        d.fixtures = ergebnis.fixtures;
        d.verticals = ergebnis.verticals;
        d.solids = ergebnis.solids;
        d.durchbrueche = ergebnis.durchbrueche;
        d.pipes = ergebnis.pipes;
        d.pipeAccessories = ergebnis.pipeAccessories;
        d.annotations = ergebnis.annotations;
        d.freihand = ergebnis.freihand;
        d.roofOpenings = ergebnis.roofOpenings;
        d.levels = ergebnis.levels;
        d.site = ergebnis.site;
        d.image = ergebnis.image;
      });

      const wo = umfang === 'alles' ? 'Das Gebäude' : 'Das Geschoss';
      const wie = achse === 'senkrecht' ? 'links/rechts' : 'oben/unten';
      const message =
        `${wo} gespiegelt (${wie}) — ${ergebnis.anzahl} Bauteile, ` +
        `Achse bei ${achse === 'senkrecht' ? 'x' : 'y'} = ` +
        `${ergebnis.lage.toFixed(2).replace('.', ',')} m. ` +
        'Türanschläge und Dachrichtung sind mitgegangen; Strg+Z nimmt es zurück.';
      set({ statusMessage: message });
      return { ok: true, message };
    },

    /**
     * Eine Lücke schließen — als Wand, Tür, Fenster oder Durchgang.
     *
     * Der Reihe nach: Wand von der Lücke zum Gegenüber ziehen (`addWall` bindet
     * beide Enden an und teilt eine getroffene Wand, aus dem optischen wird ein
     * topologischer T-Stoß), dann die Öffnung hineinsetzen. Dicke, Höhe und Art
     * erbt die neue Wand von der, die an der Lücke hängt — eine Außenwand wird
     * mit einer Außenwand geschlossen.
     */
    schliesseLuecke: (knotenId, art) => {
      const doc = get().doc;
      const luecken = findeLuecken(
        Object.values(doc.walls),
        doc.nodes,
        doc.activeLevelId,
      );
      const luecke = luecken.find((l) => l.knotenId === knotenId);
      if (!luecke) return { ok: false, message: 'Zu diesem Wandende ist kein Gegenüber in Reichweite.' };

      const quelle = doc.walls[luecke.wandId];
      if (!quelle) return { ok: false, message: 'Die Wand an der Lücke fehlt.' };

      const wand = get().addWall(luecke.punkt, luecke.ziel, {
        thickness: quelle.thickness,
        height: quelle.height,
        type: quelle.type,
        uValue: quelle.uValue,
        levelId: quelle.levelId,
      });
      if (!wand) return { ok: false, message: 'Die Wand ließ sich nicht setzen.' };

      const weite = luecke.weite;
      if (art === 'wand') {
        const message = `Lücke mit ${weite.toFixed(2).replace('.', ',')} m Wand geschlossen`;
        set({ statusMessage: message });
        return { ok: true, message };
      }

      const masse = oeffnungFuerLuecke(art, weite, quelle.height);
      if (!masse) {
        const message = `Lücke geschlossen — für eine Öffnung ist sie mit ${weite.toFixed(2).replace('.', ',')} m zu schmal`;
        set({ statusMessage: message });
        return { ok: true, message };
      }

      const kind = art === 'tuer' ? 'door' : art === 'fenster' ? 'window' : 'passage';
      const erzeugt = get().addOpening({
        wallId: wand.id,
        kind,
        distance: weite / 2,
        width: masse.width,
        height: masse.height,
        sillHeight: masse.sillHeight,

        uValue: kind === 'window' ? 1.3 : kind === 'door' ? 1.8 : 0,
        gValue: kind === 'window' ? 0.6 : undefined,
        doorType: kind === 'door' ? 'single' : undefined,
        windowType: kind === 'window' ? 'tilt-turn' : undefined,
        passageType: kind === 'passage' ? 'lintel' : undefined,
      });

      const wort = art === 'tuer' ? 'Tür' : art === 'fenster' ? 'Fenster' : 'Durchgang';
      const message = erzeugt
        ? `${wort} ${masse.width.toFixed(2).replace('.', ',')} m in die Lücke gesetzt`
        : `Lücke geschlossen, aber ${wort} passte nicht hinein`;
      set({ statusMessage: message });
      return { ok: true, message };
    },

    planeAutokorrektur: () => planeKorrektur(get().doc),

    /*
     * Ein einziges `mutate`, damit Rückgängig alles auf einmal zurücknimmt.
     * Die Räume werden darin selbst neu erkannt, weil die kleinen Räume erst
     * danach feststehen: Ein Raum, der durch eine eben geschlossene Lücke
     * entsteht, gibt es vorher nicht. Darum `skipRooms` — sonst liefe die
     * Erkennung ein zweites Mal.
     */
    autokorrigiere: (auswahl) => {
      const ausgang = { doc: get().doc, past: get().past, future: get().future };
      const raeumeVorher = Object.keys(ausgang.doc.rooms).length;
      const lauf = (a: KorrekturAuswahl) => {
        let bericht: KorrekturBericht | null = null;
        const namen: string[] = [];
        mutate(
          (d) => {
            bericht = wendeKorrekturAn(d, a, uid);
            recomputeRooms(d);
            if (a.kleineRaeume) {
              for (const r of kleineRaeume(Object.values(d.rooms))) {
                d.rooms[r.id] = { ...r, isHeated: false };
                namen.push(r.name);
              }
            }
          },
          { skipRooms: true },
        );
        return { ...(bericht as unknown as KorrekturBericht), kleineRaeume: namen } as KorrekturBericht;
      };
      let b = lauf(auswahl);
      let hinweis = '';
      /*
       * Sicherheitsnetz: Eine Korrektur darf keinen Raum kosten. Fällt die
       * Raumzahl, wird ohne Begradigen neu angesetzt (das Begradigen ist der
       * einzige Schritt, der Punkte über Zentimeter verschiebt). Fällt sie
       * dann immer noch, bleibt der Plan, wie er war.
       */
      if (Object.keys(get().doc.rooms).length < raeumeVorher) {
        set(ausgang);
        if (auswahl.begradigen) {
          b = lauf({ ...auswahl, begradigen: false });
          hinweis = ' Begradigen ausgelassen, weil dabei ein Raum verloren ginge.';
        }
        if (!auswahl.begradigen || Object.keys(get().doc.rooms).length < raeumeVorher) {
          set(ausgang);
          const message = 'Korrektur nicht ausgeführt: Danach wären weniger Räume erkannt worden als vorher. Der Plan bleibt unverändert.';
          set({ statusMessage: message });
          return { ok: false, message, bericht: b };
        }
      }
      const raeumeNachher = Object.keys(get().doc.rooms).length;
      const satz = berichtSatz(b);
      const geaendert = satz !== 'Nichts geändert.';
      const message = geaendert
        ? `${satz}${hinweis} Räume: ${raeumeVorher} → ${raeumeNachher}. Strg+Z nimmt alles zusammen zurück.`
        : satz;
      if (!geaendert) {
        // Nichts getan — dann auch kein Schritt in der Historie, den man
        // zurücknehmen müsste, um zum selben Stand zu kommen.
        set(ausgang);
      }
      set({ statusMessage: message });
      return { ok: geaendert, message, bericht: b };
    },

    neuesDokument: (name) => {
      const frisch = emptyDocument();
      frisch.meta.name = name.trim() || 'Neues Projekt';
      set({
        doc: frisch,
        past: [],
        future: [],
        selection: null,
        selections: [],
        einpassenZaehler: get().einpassenZaehler + 1,
        statusMessage: `Neues Projekt „${frisch.meta.name}“ angelegt`,
      });
      return frisch;
    },

    /**
     * Liest eine Exportdatei zurück. Die Rohgeometrie im Block `geometry` ist
     * dafür vorgesehen: Knoten, Wände, Öffnungen und TGA-Objekte kommen
     * unverändert zurück, Räume werden neu erkannt und bekommen Namen,
     * Nutzung und Temperaturen aus der Datei zurückgespielt.
     */
    setzeErzeugerNachVorschlag: () => {
      const doc = get().doc;
      if (hatAusgangspunkt(doc)) {
        return { ok: false, message: 'Es steht bereits ein Erzeuger, Speicher oder Verteiler im Modell.' };
      }
      const vorschlag = schlageErzeugerVor(doc, doc.activeLevelId);
      if (!vorschlag) {
        return { ok: false, message: 'Kein Raum gefunden, der sich als Aufstellort begründen ließe — Erzeuger von Hand setzen.' };
      }
      /*
       * Gesetzt wird auf dem Geschoss des Vorschlags, nicht auf dem aktiven:
       * Der Heizraum liegt unten, gearbeitet wird oft oben. Das aktive
       * Geschoss wandert mit, sonst setzt der Anwender ein Symbol, das er
       * nicht sieht.
       */
      if (vorschlag.levelId !== doc.activeLevelId) get().setActiveLevel(vorschlag.levelId);
      const kessel = get().addFixture('boiler', vorschlag.position, { levelId: vorschlag.levelId });
      if (!kessel) return { ok: false, message: 'Der Erzeuger ließ sich an dieser Stelle nicht setzen.' };
      const message = `Wärmeerzeuger gesetzt: ${vorschlag.ort}. ${vorschlag.grund}`;
      set({ statusMessage: message });
      return { ok: true, message, fixtureId: kessel.id };
    },

    meldeVerworfeneRaeume: (antwort) => {
      const verworfene = leseVerworfene(antwort);
      const { hinweise, ohneRaum } = hinweiseZuRaeumen(verworfene, Object.keys(get().doc.rooms));
      const karte: Record<string, RaumverlustHinweis> = {};
      for (const h of hinweise) karte[h.roomId] = h;
      const message = verworfene.length === 0
        ? 'RaVia hat alle Räume übernommen.'
        : `${verworfene.length} Raum/Räume wurden von RaVia nicht übernommen` +
          `${ohneRaum.length ? ` (${ohneRaum.length} davon ohne passenden Raum im Plan)` : ''}.`;
      set({ verworfeneRaeume: karte, statusMessage: message });
      return { hinweise: hinweise.length, ohneRaum: ohneRaum.length, message };
    },

    loescheVerworfeneHinweise: () => set({ verworfeneRaeume: {} }),

    loadProject: (data) => {
      const raw = data as Record<string, unknown> | null;
      if (!raw || typeof raw !== 'object') return { ok: false, message: 'Keine gültige JSON-Datei' };
      if (raw.schema !== 'ravia.bim.light') {
        return { ok: false, message: 'Das ist keine RaVia-CAD-Light-Projektdatei' };
      }
      const geometry = raw.geometry as
        | {
            nodes?: BimNode[];
            walls?: Wall[];
            openings?: Opening[];
            fixtures?: Fixture[];
            verticals?: VerticalElement[];
            solids?: SolidElement[];
            durchbrueche?: Durchbruch[];
            pipes?: PipeRun[];
            annotations?: Annotation[];
            roofOpenings?: RoofOpening[];
            site?: BimDocument['site'];
            freihand?: Freihandstrich[];
          }
        | undefined;
      if (!geometry?.nodes || !geometry.walls) {
        return { ok: false, message: 'Die Datei enthält keine Rohgeometrie' };
      }

      const fresh = emptyDocument();
      fresh.meta = { ...fresh.meta, ...(raw.project as object), modifiedAt: new Date().toISOString() };
      // Befund B1: die alte feste Vorgabe θ_u = 10 °C ist keine Eingabe.
      fresh.meta = migriereUnbeheizt(fresh.meta);
      /*
       * Nutzungseinheiten (Export 2.10.0). Die Räume werden beim Öffnen neu
       * erkannt, die Einheiten nicht: Sie stehen als eigene Liste in der Datei
       * und kommen von dort unverändert zurück.
       */
      const gespeicherteEinheiten = raw.occupancyUnits as
        | { id?: unknown; name?: unknown; kind?: unknown; location?: unknown }[]
        | undefined;
      if (Array.isArray(gespeicherteEinheiten) && gespeicherteEinheiten.length) {
        const art: Record<string, EinheitArt> = {
          dwelling: 'wohnung',
          commercial: 'gewerbe',
          communal: 'gemeinschaft',
        };
        const einheiten: Record<string, Nutzungseinheit> = {};
        gespeicherteEinheiten.forEach((e, i) => {
          if (typeof e?.id !== 'string' || !e.id) return;
          einheiten[e.id] = {
            id: e.id,
            name: typeof e.name === 'string' && e.name.trim() ? e.name : `Einheit ${i + 1}`,
            art: art[String(e.kind)] ?? 'wohnung',
            ...(typeof e.location === 'string' && e.location ? { lage: e.location } : {}),
          };
        });
        if (Object.keys(einheiten).length) fresh.units = einheiten;
      }
      const levels = raw.levels as Level[] | undefined;
      if (levels?.length) {
        // Ältere Dateien kennen `order` noch nicht — aus der Höhenlage ableiten.
        const sorted = [...levels].sort((a, b) => (a.elevation ?? 0) - (b.elevation ?? 0));
        fresh.levels = Object.fromEntries(
          sorted.map((l, i) => [
            l.id,
            {
              ...l,
              order: typeof l.order === 'number' ? l.order : i,
              floorUValue: l.floorUValue ?? 0.3,
              floorBoundary: l.floorBoundary ?? 'ground',
              ceilingUValue: l.ceilingUValue ?? 0.2,
              ceilingBoundary: l.ceilingBoundary ?? 'unheated',
              /*
               * Ein Dach aus einer Datei kann die Form führen und den Aufbau
               * weglassen — ein Aufmaß hat Neigung und Kniestock, aber keinen
               * U-Wert. Ohne diese Zeile stand im Export `uValue: undefined`
               * am Dach, und auf der Gegenseite ging die Dachfläche stumm mit
               * 0 W/K in die Rechnung. Gefunden im Lauf über die
               * TABULA-Testgebäude (A02, A06).
               */
              ...(l.roof ? { roof: { ...DACH_VORGABE, ...l.roof } } : {}),
              ...(l.roofs ? { roofs: l.roofs.map((r) => ({ ...DACH_VORGABE, ...r })) } : {}),
            },
          ]),
        );
        // Angefangen wird im Erdgeschoss — nicht im untersten Geschoss.
        // `order === 0` ist per Aufbau das EG; fehlt es (alte Datei ohne
        // Ordnung), greift die Höhenlage.
        const egId =
          sorted.find((l) => l.order === 0)?.id ??
          sorted[erdgeschossIndex(sorted.map((l) => l.elevation ?? Number.NaN))]?.id ??
          sorted[0].id;
        fresh.activeLevelId = egId;
      }
      const fallbackLevel = fresh.activeLevelId;
      // Geometrie aus Dateien vor der Mehrgeschossigkeit bekommt das erste Geschoss.
      fresh.nodes = Object.fromEntries(
        geometry.nodes.map((n) => [n.id, { ...n, levelId: n.levelId ?? fallbackLevel }]),
      );
      fresh.walls = Object.fromEntries(
        geometry.walls.map((w) => [w.id, { ...w, levelId: w.levelId ?? fallbackLevel }]),
      );
      fresh.openings = Object.fromEntries((geometry.openings ?? []).map((o) => [o.id, o]));
      // Festlegung F2: Heizkörper aus Dateien bis 1.72.0 tragen `powerW` bei
      // 55/45/20 — beim Laden auf `ratedPower` 75/65/20 umgerechnet.
      fresh.fixtures = migriereFixtures(
        Object.fromEntries(
          (geometry.fixtures ?? []).map((f) => [f.id, { ...f, levelId: f.levelId ?? fallbackLevel }]),
        ),
      );
      fresh.verticals = Object.fromEntries(
        (geometry.verticals ?? []).map((v) => [v.id, { ...v, levelId: v.levelId ?? fallbackLevel }]),
      );
      // Ohne diese Zeile ginge ein Kamin beim Speichern und Öffnen verloren —
      // still, und das ist die schlimmste Art von Datenverlust. Ältere Dateien
      // führen den Block nicht; dann bleibt die Sammlung leer.
      fresh.solids = Object.fromEntries(
        (geometry.solids ?? []).map((b) => [b.id, { ...b, levelId: b.levelId ?? fallbackLevel }]),
      );
      // Und dasselbe für die Durchbrüche: ohne diese Zeile wäre nach dem
      // Öffnen jede Kernbohrung fort — und niemand vermisst ein Loch, bis der
      // Bohrer angesetzt ist.
      fresh.durchbrueche = Object.fromEntries(
        (geometry.durchbrueche ?? []).map((db) => [
          db.id,
          { ...db, levelId: db.levelId ?? fallbackLevel },
        ]),
      );
      fresh.pipes = Object.fromEntries(
        (geometry.pipes ?? []).map((pr) => [pr.id, { ...pr, levelId: pr.levelId ?? fallbackLevel }]),
      );
      fresh.annotations = Object.fromEntries(
        (geometry.annotations ?? []).map((an) => [an.id, { ...an, levelId: an.levelId ?? fallbackLevel }]),
      );
      fresh.roofOpenings = Object.fromEntries(
        (geometry.roofOpenings ?? []).map((ro) => [ro.id, { ...ro, levelId: ro.levelId ?? fallbackLevel }]),
      );
      /*
       * Grundstück und Handnotizen zurücklesen.
       *
       * Bis 1.18.0 stand hier nichts: `emptyDocument()` legt ein leeres
       * Gelände an, und niemand füllte es wieder. „Exportieren, wieder
       * öffnen" hat damit Grundstücksgrenze, Nachbarbebauung und Wärmepumpe
       * verloren — ohne Meldung, denn geladen wurde ja etwas.
       *
       * Ältere Dateien haben den Block noch nicht. Aus ihnen lassen sich
       * wenigstens die gezeichneten Objekte retten; sie stehen im
       * ausgewerteten Teil unter `heatPump.elements`. Die Wärmepumpen selbst
       * stehen dort als Rechenfall und nicht als Gerät — die kommen nicht
       * zurück, und das sagt die Meldung unten auch.
       */
      let altbestand = false;
      if (geometry.site) {
        fresh.site = {
          ...fresh.site,
          ...geometry.site,
          elements: { ...(geometry.site.elements ?? {}) },
          pumps: { ...(geometry.site.pumps ?? {}) },
        };
      } else {
        const hp = raw.heatPump as { elements?: SiteElement[] } | undefined;
        if (hp?.elements?.length) {
          fresh.site = {
            ...fresh.site,
            elements: Object.fromEntries(hp.elements.map((el) => [el.id, el])),
          };
          altbestand = true;
        }
      }
      if (geometry.freihand?.length) {
        fresh.freihand = Object.fromEntries(
          geometry.freihand.map((f) => [f.id, { ...f, levelId: f.levelId ?? fallbackLevel }]),
        );
      }

      const constructions = raw.constructions as Construction[] | undefined;
      if (constructions?.length) {
        fresh.constructions = Object.fromEntries(constructions.map((c) => [c.id, c]));
      }

      ergaenzeEbenen(fresh);
      recomputeRooms(fresh);

      // Raumbezogene Angaben zuordnen — über den Schwerpunkt, weil sich die
      // Raum-IDs bei der Neuerkennung ändern können.
      const savedRooms = (raw.rooms as Record<string, unknown>[] | undefined) ?? [];
      /*
       * Die Zuordnung läuft **geschossweise** (`ordneRaeumeZu`). Über den
       * bloßen Schwerpunkt gesucht, landeten bei übereinanderliegenden
       * Grundrissen die Angaben des Obergeschosses im Erdgeschoss — siehe
       * `src/lib/raumZuordnung.ts`.
       */
      const treffer = ordneRaeumeZu(savedRooms, Object.values(fresh.rooms), fresh.levels);
      savedRooms.forEach((saved, i) => {
        const match = treffer[i];
        if (!match) return;
        /*
         * **Die Kennung aus der Datei bleibt am Raum hängen.**
         *
         * Die Räume werden beim Öffnen neu erkannt; ihre Kennung fällt dabei
         * aus der Erkennungsreihenfolge und kann von der gespeicherten
         * abweichen. Die *Angaben* finden über die Geometrie zurück — die
         * Kennung nicht. RaVia hat aber genau sie: sie stand im Export, unter
         * ihr rechnet RaVia die Heizlast, und unter ihr schreibt RaVia sie
         * zurück. Bis 1.57.0 lief das ins Leere, mit der Meldung „Kein Raum
         * mit der Kennung room-lvl-kg-1" für einen Raum, der auf dem
         * Bildschirm steht. Gemeldet am 27.09.2026.
         *
         * Umbenannt wird deshalb **nicht** — die Raumkennung hängt an
         * Heizkörpern, Dachzuordnungen, Schächten, Speichern und Heizkreisen,
         * und eine Umbenennung, die einen dieser Verweise vergisst, ist
         * stiller als der Fehler, den sie behebt. Stattdessen merkt sich der
         * Raum die alte Kennung, und der Rückweg löst darüber auf.
         */
        const frueher = [
          ...(Array.isArray(saved.formerIds) ? (saved.formerIds as unknown[]) : []),
          saved.id,
        ].filter((x): x is string => typeof x === 'string' && x !== '' && x !== match.id);
        const altKennungen = frueher.length
          ? [...new Set([...(match.altKennungen ?? []), ...frueher])]
          : match.altKennungen;
        fresh.rooms[match.id] = {
          ...match,
          altKennungen,
          name: (saved.name as string) ?? match.name,
          usage: (saved.usage as Room['usage']) ?? match.usage,
          setpointTemperature: (saved.setpointTemperature as number) ?? match.setpointTemperature,
          airChangeRate: (saved.airChangeRate as number) ?? match.airChangeRate,
          isHeated: (saved.isHeated as boolean) ?? match.isHeated,
          heightOverride: saved.heightOverride as number | undefined,
          // Eine von der Gegenstelle gerechnete Heizlast gehört zum Raum und
          // nicht zur Sitzung. Ginge sie beim Öffnen verloren, müsste RaVia
          // nach jedem Speichern erneut rechnen — und niemand würde merken,
          // dass die Auslegung wieder auf dem Überschlag steht.
          normHeatLoad: (saved.normHeatLoad as Room['normHeatLoad']) ?? match.normHeatLoad,
          /*
           * Die Nutzungseinheit ist eine Angabe am Raum und keine Geometrie —
           * sie muss denselben Weg zurückfinden wie Name und Solltemperatur.
           * Zugeordnet wird nur, was es in der Datei auch als Einheit gibt;
           * eine Kennung ohne Einheit wäre ein Raum, der zugeordnet aussieht
           * und nirgends mitzählt.
           */
          unitId:
            typeof saved.occupancyUnitId === 'string' && fresh.units?.[saved.occupancyUnitId]
              ? saved.occupancyUnitId
              : undefined,
        };
      });

      set({
        doc: fresh,
        past: [],
        future: [],
        selection: null,
        // Eine Rückmeldung zum *vorigen* Modell gilt für dieses nicht mehr.
        verworfeneRaeume: {},
        einpassenZaehler: get().einpassenZaehler + 1,
        statusMessage:
          `Projekt geladen: ${Object.keys(fresh.walls).length} Wände, ${Object.keys(fresh.rooms).length} Räume` +
          (altbestand
            ? ' — aus einer älteren Datei: Geländeobjekte sind da, die Wärmepumpe muss neu gesetzt werden.'
            : ''),
      });
      return { ok: true, message: 'Projekt geladen' };
    },

    /** Ersetzt das Dokument vollständig — Autosave-Wiederherstellung. */
    /**
     * Der Rückweg aus RaVia.
     *
     * Die Prüfung und das Anwenden stecken vollständig in `lib/hostPatch.ts`;
     * hier bleibt nur, was ohne Store nicht geht: Historie schreiben, Räume
     * *nicht* neu erkennen (die Geometrie hat sich nicht geändert) und die
     * Statuszeile setzen, damit der Mensch am Bildschirm sieht, dass gerade
     * jemand anderes etwas geändert hat.
     */
    applyHostPatch: (patch) => {
      const { doc, past } = get();
      const result = applyPatchToDocument(doc, patch, new Date().toISOString());
      if (result.changed) {
        set({
          doc: result.doc,
          past: [...past.slice(-49), doc],
          future: [],
          statusMessage: result.report.summary,
        });
      } else {
        set({ statusMessage: result.report.summary });
      }
      return result.report;
    },

    replaceDocument: (next, message) =>
      set({
        // Auch ein Autosave aus 1.72.0 trägt noch `powerW` (Festlegung F2).
        doc: { ...next, fixtures: migriereFixtures(next.fixtures ?? {}) },
        past: [],
        future: [],
        selection: null,
        selections: [],
        einpassenZaehler: get().einpassenZaehler + 1,
        statusMessage: message ?? 'Dokument ersetzt',
      }),
  };
}
