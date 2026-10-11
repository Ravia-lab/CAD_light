/**
 * Store-Slice „Wände, Öffnungen, Räume, Heizflächen und Fußbodenheizung".
 *
 * TD-22: Aus `useBimStore.ts` herausgelöst; die Aktionen sind unverändert.
 * `useBimStore` setzt den Store aus diesen Slices zusammen und reicht
 * `set`, `get` und `mutate` (Dokumentänderung mit Historie) herein.
 */

import { dez } from '../../lib/zahl';
import type {
  Opening,
  Fixture,
  FixtureType,
  Vec2,
  Wall,
} from '../../types/bim';
import { FIXTURE_BY_TYPE } from '../../types/bim';
import { closestPointOnSegment, distance, pointInPolygon, polygonArea, roundMm } from '../../lib/geometry';
import { normleistungAusRaumlast } from '../../lib/heizflaechenAbgleich';
import { heizleistung, mitLeistung } from '../../lib/normleistung';
import { istHeizflaeche } from '../../lib/heizflaechenLeistung';
import { heizkoerperplatz, PLATZ_TEXT } from '../../lib/heizkoerperplatz';
import { estimateHeatLoad } from '../../lib/heatLoadEstimate';
import { usageDefaults } from '../../lib/roomDetection';
import {
  ROOM_TEMPLATE_BY_KIND,
  templatePolygon,
} from '../../lib/roomTemplates';
import {
  nodeAt,
  splitWallsAtNode,
  uid,
  verschmelzeDoppelteWaende,
} from '../../lib/dokumentPflege';
import type {
  BimState,
  FloorLoopBatchResult,
  FloorLoopBatchSkip,
  Mutate,
  StoreGet,
  StoreSet,
} from '../bimZustand';
import { belegeRaum } from '../bimZustand';

export type BauteileSchluessel =
  | 'addWall'
  | 'updateWall'
  | 'bestaetigeWandstaerken'
  | 'moveNode'
  | 'addOpening'
  | 'updateOpening'
  | 'splitWallAt'
  | 'addRoomTemplate'
  | 'copyRoom'
  | 'duplicateRoom'
  | 'addFixture'
  | 'setzeRaumHeizleistung'
  | 'toggleFloorLoopArea'
  | 'layAllFloorLoops'
  | 'updateFixture'
  | 'uebernimmUeberschlagAlsHeizleistung'
  | 'fuehreKleineRaeumeAlsUnbeheizt'
  | 'moveFixture'
  | 'updateRoom';

export function bauteileSlice(set: StoreSet, get: StoreGet, mutate: Mutate): Pick<BimState, BauteileSchluessel> {
  return {
    // ----------------------------------------------------------- Dokument
    addWall: (start, end, options) => {
      if (distance(start, end) < 0.05) return null; // < 5 cm ignorieren
      const defaults = get().wallDefaults;
      let created: Wall | null = null;

      mutate((doc) => {
        const a = nodeAt(doc, start);
        const b = nodeAt(doc, end);
        if (a.id === b.id) return;

        // Doppelte Wand zwischen denselben Knoten vermeiden
        const exists = Object.values(doc.walls).some(
          (w) => (w.a === a.id && w.b === b.id) || (w.a === b.id && w.b === a.id),
        );
        if (exists) return;

        const wall: Wall = {
          id: uid('w'),
          levelId: doc.activeLevelId,
          a: a.id,
          b: b.id,
          thickness: defaults.thickness,
          height: doc.levels[doc.activeLevelId]?.height ?? defaults.height,
          type: defaults.type,
          layerId: 'layer-walls',
          uValue: defaults.uValue,
          ...options,
        };
        doc.walls[wall.id] = wall;
        created = wall;

        // Beide Enden sauber anbinden: läuft dort eine Wand durch, wird sie
        // geteilt. Damit entsteht gar nicht erst ein "fast angeschlossenes" Ende.
        splitWallsAtNode(doc, a);
        splitWallsAtNode(doc, b);
        // Hat der Schnitt ein Stück erzeugt, das auf der neuen Wand liegt,
        // bleibt nur eines von beiden stehen.
        if (created && verschmelzeDoppelteWaende(doc).includes(created.id)) {
          // Die neue Wand lag deckungsgleich auf einem Stück der geteilten
          // Wand und ist weg. Zurückgemeldet wird dann das Stück, das steht —
          // sonst griffe der Aufrufer (Auswahl, Statusmeldung) ins Leere.
          const c = created;
          created = Object.values(doc.walls).find(
            (w) => w.levelId === c.levelId
              && ((w.a === c.a && w.b === c.b) || (w.a === c.b && w.b === c.a)),
          ) ?? null;
        }
      });

      return created;
    },

    updateWall: (id, patch) =>
      mutate((doc) => {
        const wall = doc.walls[id];
        if (!wall) return;
        // Wer die Stärke von Hand setzt, hat sie nicht mehr geschätzt. Das
        // Kennzeichen hier zu löschen ist die einzige Stelle, an der das
        // zuverlässig passiert — sonst bliebe der Schritt „Wandstärken
        // bestätigen" auch dann offen, wenn jede Zahl längst geprüft ist.
        const geprueft =
          patch.thickness !== undefined && patch.thickness !== wall.thickness
            ? { thicknessEstimated: undefined }
            : {};
        doc.walls[id] = { ...wall, ...patch, ...geprueft };
      }),

    /**
     * Die geschätzten Wandstärken bestätigen — wahlweise mit neuem Wert.
     *
     * Zwei Dinge in einem Zug, weil sie zusammengehören: alle Wände einer Art
     * auf eine Stärke setzen *und* das Kennzeichen „geschätzt" löschen. Ohne
     * den zweiten Teil bliebe die Aufgabe offen, obwohl sie erledigt ist;
     * ohne den ersten müsste man einundzwanzig Wände einzeln anklicken.
     *
     * `staerke` weglassen heißt: die Schätzung stimmt so, nur bestätigen.
     */
    bestaetigeWandstaerken: (typ, staerke) => {
      let betroffen = 0;
      mutate((doc) => {
        for (const wand of Object.values(doc.walls)) {
          if (wand.levelId !== doc.activeLevelId) continue;
          if (!wand.thicknessEstimated) continue;
          if (typ !== 'alle' && wand.type !== typ) continue;
          doc.walls[wand.id] = {
            ...wand,
            thickness: staerke ?? wand.thickness,
            thicknessEstimated: undefined,
          };
          betroffen++;
        }
      });
      const wort = typ === 'exterior' ? 'Außenwände' : typ === 'alle' ? 'Wände' : 'Innenwände';
      const message = betroffen
        ? staerke !== undefined
          ? `${betroffen} ${wort} auf ${(staerke * 100).toFixed(1).replace('.', ',')} cm gesetzt`
          : `${betroffen} ${wort} bestätigt`
        : 'Keine geschätzten Stärken mehr offen';
      set({ statusMessage: message });
      return { ok: betroffen > 0, message };
    },

    moveNode: (id, position) =>
      mutate((doc) => {
        const node = doc.nodes[id];
        if (!node || node.locked) return;
        doc.nodes[id] = { ...node, x: roundMm(position.x), y: roundMm(position.y) };
      }),

    addOpening: (opening) => {
      let created: Opening | null = null;
      mutate((doc) => {
        const wall = doc.walls[opening.wallId];
        if (!wall) return;
        const na = doc.nodes[wall.a];
        const nb = doc.nodes[wall.b];
        if (!na || !nb) return;
        const wallLength = distance(na, nb);
        const half = opening.width / 2;
        if (wallLength < opening.width + 0.02) return; // passt nicht in die Wand

        // Überlappung mit bestehenden Öffnungen verhindern
        const clampedDistance = Math.min(Math.max(opening.distance, half), wallLength - half);
        const overlaps = Object.values(doc.openings).some((o) => {
          if (o.wallId !== wall.id) return false;
          return Math.abs(o.distance - clampedDistance) < (o.width + opening.width) / 2;
        });
        if (overlaps) return;

        const next: Opening = { ...opening, id: uid('o'), distance: roundMm(clampedDistance) };
        doc.openings[next.id] = next;
        created = next;
      });
      return created;
    },

    updateOpening: (id, patch) =>
      mutate((doc) => {
        const opening = doc.openings[id];
        if (opening) doc.openings[id] = { ...opening, ...patch };
      }),

    /**
     * Teilt eine Wand an einem Punkt in zwei Wände. Wird beim Zeichnen
     * automatisch aufgerufen, wenn ein neues Wandende auf einer bestehenden
     * Wand landet: aus dem optischen T-Stoß wird ein topologischer. Genau
     * daran scheitert sonst die Raumerkennung.
     */
    splitWallAt: (wallId, point) =>
      mutate((doc) => {
        const wall = doc.walls[wallId];
        if (!wall) return;
        const na = doc.nodes[wall.a];
        const nb = doc.nodes[wall.b];
        if (!na || !nb) return;

        const len = distance(na, nb);
        const t = ((point.x - na.x) * (nb.x - na.x) + (point.y - na.y) * (nb.y - na.y)) / (len * len);
        // Zu nah am Ende: dort wird ohnehin auf den vorhandenen Knoten gefangen.
        if (t <= 0.02 || t >= 0.98) return;

        const mid = nodeAt(doc, point, 1e-4);
        const second: Wall = { ...wall, id: uid('w'), a: mid.id, b: wall.b };
        doc.walls[wall.id] = { ...wall, b: mid.id };
        doc.walls[second.id] = second;

        // Öffnungen wandern auf das Teilstück, in dem sie liegen.
        const splitDistance = t * len;
        for (const op of Object.values(doc.openings)) {
          if (op.wallId !== wall.id) continue;
          if (op.distance > splitDistance) {
            doc.openings[op.id] = {
              ...op,
              wallId: second.id,
              distance: roundMm(op.distance - splitDistance),
            };
          }
        }
      }),

    addRoomTemplate: (kind, from, to, options) => {
      const polygon = templatePolygon(kind, from, to, options);
      // Zu klein aufgezogen: lieber nichts anlegen als vier Wände, die
      // kürzer sind als ihre eigene Dicke.
      if (polygon.length < 3) return null;

      const defaults = get().wallDefaults;
      let count = 0;
      /** Welche Wände dieser Aufruf angelegt hat — für die Zählung nach dem Verschmelzen. */
      const neueWaende = new Set<string>();
      mutate((doc) => {
        const height = doc.levels[doc.activeLevelId]?.height ?? defaults.height;
        // Erst alle Knoten, dann alle Wände: so schließt der Ring sauber,
        // auch wenn zwei Ecken dicht beieinander liegen und verschmelzen.
        const ring = polygon.map((p) => nodeAt(doc, { x: roundMm(p.x), y: roundMm(p.y) }));
        for (let i = 0; i < ring.length; i += 1) {
          const a = ring[i];
          const b = ring[(i + 1) % ring.length];
          if (a.id === b.id) continue;
          const exists = Object.values(doc.walls).some(
            (w) => (w.a === a.id && w.b === b.id) || (w.a === b.id && w.b === a.id),
          );
          if (exists) continue;
          const wall: Wall = {
            id: uid('w'),
            levelId: doc.activeLevelId,
            a: a.id,
            b: b.id,
            thickness: defaults.thickness,
            height,
            type: defaults.type,
            layerId: 'layer-walls',
            uValue: defaults.uValue,
          };
          doc.walls[wall.id] = wall;
          neueWaende.add(wall.id);
          count += 1;
        }
        // Anschließend anbinden: läuft eine bestehende Wand durch eine Ecke
        // der Vorlage, wird sie dort geteilt. Das passiert erst nach dem
        // Ring, damit die neuen Wände sich nicht gegenseitig zerteilen.
        for (const node of ring) splitWallsAtNode(doc, node);
        // Und erst danach die Dubletten: Der Schnitt kann ein Stück erzeugt
        // haben, das deckungsgleich auf einer eben angelegten Wand liegt.
        for (const id of verschmelzeDoppelteWaende(doc)) if (neueWaende.has(id)) count -= 1;
      });

      if (!count) {
        set({ statusMessage: 'Hier steht schon eine Wand — die Vorlage hätte nichts hinzugefügt.' });
        return null;
      }

      // Der eben entstandene Raum bekommt Namen und Nutzung, wenn sie
      // mitgegeben wurden. Erkannt wird er über seinen Schwerpunkt.
      const centre = {
        x: polygon.reduce((a, p) => a + p.x, 0) / polygon.length,
        y: polygon.reduce((a, p) => a + p.y, 0) / polygon.length,
      };
      if (options?.name || options?.usage) {
        const doc = get().doc;
        const room = Object.values(doc.rooms).find(
          (r) => r.levelId === doc.activeLevelId && r.innerPolygon.length >= 3 && pointInPolygon(centre, r.innerPolygon),
        );
        if (room) get().updateRoom(room.id, { name: options.name ?? room.name, usage: options.usage ?? room.usage });
      }

      const area = polygonArea(polygon);
      set({
        statusMessage: `${ROOM_TEMPLATE_BY_KIND[kind].label} mit ${count} Wänden angelegt · ${dez(area, 2)} m² Achsfläche`,
      });
      return { walls: count, area };
    },

    /**
     * Die Wände, Öffnungen und TGA-Objekte eines Raums einsammeln.
     *
     * „Zum Raum gehörig" heißt: eine Wand, die als Begrenzung erkannt wurde,
     * und ein Objekt, dessen Standort im lichten Polygon liegt. Eine Wand
     * zwischen zwei Räumen gehört damit zu beiden — beim Kopieren eines
     * einzelnen Raums ist das richtig, denn der Nachbar bleibt ja stehen.
     */
    copyRoom: (roomId) => {
      const { doc } = get();
      const room = doc.rooms[roomId];
      if (!room) return false;
      const wallIds = room.boundaries.map((b) => b.wallId);
      const walls = wallIds.map((id) => doc.walls[id]).filter(Boolean);
      if (!walls.length) return false;
      const nodeIds = new Set(walls.flatMap((w) => [w.a, w.b]));
      const nodes = [...nodeIds].map((id) => doc.nodes[id]).filter(Boolean);
      const openings = Object.values(doc.openings).filter((o) => wallIds.includes(o.wallId));
      const fixtures = Object.values(doc.fixtures).filter(
        (f) => f.levelId === room.levelId && room.innerPolygon.length >= 3 && pointInPolygon(f.position, room.innerPolygon),
      );
      const points: Vec2[] = [...nodes, ...fixtures.map((f) => f.position)];
      const origin = points.reduce(
        (acc, p) => ({ x: Math.min(acc.x, p.x), y: Math.min(acc.y, p.y) }),
        { x: Infinity, y: Infinity },
      );
      set({
        clipboard: { origin, nodes, walls, openings, fixtures },
        statusMessage: `Raum „${room.name}" kopiert — ${walls.length} Wände, ${openings.length} Öffnungen, ${fixtures.length} TGA-Objekte`,
      });
      return true;
    },

    duplicateRoom: (roomId, offset) => {
      const { doc } = get();
      const room = doc.rooms[roomId];
      if (!room) return null;
      if (!get().copyRoom(roomId)) return null;
      const clip = get().clipboard;
      if (!clip) return null;

      // Ohne Vorgabe wird der Raum um seine eigene Breite nach rechts
      // versetzt und rückt einen halben Meter ab. So überlappt die Kopie
      // nicht mit dem Original und klebt trotzdem nicht daran.
      const xs = room.polygon.map((p) => p.x);
      const width = Math.max(...xs) - Math.min(...xs);
      const d = offset ?? { x: roundMm(width + 0.5), y: 0 };
      get().pasteClipboard(d);
      const created = get().selections;
      set({
        statusMessage: `Raum „${room.name}" dupliziert — ${clip.walls.length} Wände, ${clip.fixtures.length} TGA-Objekte`,
      });
      return { walls: created.filter((c) => c.kind === 'wall').length, fixtures: clip.fixtures.length };
    },

    addFixture: (type, position, options) => {
      const def = FIXTURE_BY_TYPE[type];
      if (!def) return null;

      /*
       * Eine Fußbodenheizung ist keine Kachel im Raum — sie ist der Raum.
       *
       * Wer aus der Palette „Fußbodenheizung" nimmt und in ein Zimmer
       * tippt, meint: dieses Zimmer bekommt Fußbodenheizung. Bis hierher
       * entstand daraus ein 40 mal 40 Zentimeter großes Symbol in der
       * Mitte — ein Objekt, das im Plan wie eine Heizfläche aussieht, im
       * Massenauszug 0,16 m² Verlegefläche trägt und in der Heizlast
       * nichts leistet. Man sieht ihm nicht an, dass es falsch ist; man
       * merkt es erst, wenn die Zahlen nicht stimmen.
       *
       * Deshalb legt derselbe Klick jetzt die ganze Raumfläche aus — mit
       * Verlegeabstand, Kreiszahl und Leistung aus der Raumheizlast, also
       * genau das, was der Knopf „Raum belegen" tut. Liegt der Punkt in
       * keinem Raum, bleibt es beim einzelnen Objekt: dann ist es eine
       * Anbindeleitung im Flur, kein Zimmer.
       */
      if (type === 'underfloor' && options?.params?.roomCoverage === undefined) {
        const d0 = get().doc;
        const raum = Object.values(d0.rooms).find(
          (r) =>
            r.levelId === d0.activeLevelId &&
            r.innerPolygon.length >= 3 &&
            pointInPolygon(position, r.innerPolygon),
        );
        if (raum) {
          const schon = Object.values(d0.fixtures).find(
            (f) => f.type === 'underfloor' && f.params.roomCoverage === true && f.roomId === raum.id,
          );
          if (schon) {
            set({ statusMessage: `„${raum.name}" trägt bereits eine Fußbodenheizung` });
            return schon;
          }
          const gelegt = belegeRaum(get, raum.id);
          if (!gelegt) {
            set({ statusMessage: `„${raum.name}" ist für eine Fußbodenheizung zu klein` });
            return null;
          }
          set({
            statusMessage:
              `Fußbodenheizung „${raum.name}": ${gelegt.area.toFixed(1).replace('.', ',')} m² belegt · ` +
              `${gelegt.loops} ${gelegt.loops === 1 ? 'Kreis' : 'Kreise'} · ${gelegt.powerW} W`,
          });
          return (
            Object.values(get().doc.fixtures).find(
              (f) => f.type === 'underfloor' && f.params.roomCoverage === true && f.roomId === raum.id,
            ) ?? null
          );
        }
      }

      let created: Fixture | null = null;

      mutate(
        (doc) => {
          const fixture: Fixture = {
            id: uid('f'),
            type,
            category: def.category,
            levelId: doc.activeLevelId,
            position: { x: roundMm(position.x), y: roundMm(position.y) },
            rotation: 0,
            length: def.length,
            depth: def.depth,
            elevation: def.elevation,
            label: def.label,
            /*
             * **Die Vorbelegung bleibt als Vorbelegung erkennbar.**
             *
             * Bis 1.23.0 stand hier nur `{ ...def.params }` — die Katalogzahl
             * wurde damit zu einem Wert, der von einem abgelesenen
             * Datenblattwert nicht mehr zu unterscheiden war. Die Folgen
             * trafen ausgerechnet die Stellen, die Herkunft ausweisen
             * wollen: Der hydraulische Abgleich meldete `assumed: false`,
             * weil ja eine Zahl dastand; die Übergabe an RaVia behauptete
             * `herkunft: 'eingegeben'` für etwas, das niemand eingegeben
             * hatte; und die Prüfung „Heizfläche ohne Leistung" konnte nie
             * zutreffen. Ein Feld mehr, und alle drei stimmen wieder.
             */
            params: { ...def.params, ...(heizleistung(def) !== undefined ? { powerSource: 'katalog' as const } : {}) },
            ...options,
          };
          // Raumzuordnung sofort setzen, damit der Export ohne weitere
          // Geometrieänderung vollständig ist — **im eigenen Geschoss**.
          // Ohne den Geschossfilter bekam ein Heizkörper im OG den Raum aus
          // dem EG, der zufällig darunter liegt; bis zum nächsten vollen
          // Rechenlauf stand er dann im falschen Raum (dieser Aufruf läuft
          // mit `skipRooms`). Dieselbe Verwechslung wie beim Öffnen einer
          // Projektdatei, siehe `src/lib/raumZuordnung.ts`.
          const room = Object.values(doc.rooms).find(
            (r) =>
              r.levelId === fixture.levelId &&
              r.innerPolygon.length >= 3 &&
              pointInPolygon(fixture.position, r.innerPolygon),
          );
          fixture.roomId = room?.id;
          doc.fixtures[fixture.id] = fixture;
          created = fixture;
        },
        /*
         * Beim Setzen einer Heizfläche wird nachgezogen — und zwar in
         * demselben Schritt.
         *
         * Das betrifft **auch die schon vorhandenen**: Steht in einem Raum
         * bisher ein Heizkörper mit der vollen Raumlast und kommt ein
         * zweiter dazu, muss der erste von 100 auf 50 Prozent herunter.
         * Täte das erst der nächste Rechenlauf, stünde der Raum bis dahin
         * mit doppelter Heizfläche im Heft.
         */
        { skipRooms: true, ziehenachHeizflaechen: istHeizflaeche(type) },
      );
      return created;
    },

    setzeRaumHeizleistung: (roomId, watt, quelle) => {
      const d0 = get().doc;
      const room = d0.rooms[roomId];
      if (!room) return { ok: false, message: 'Raum nicht gefunden' };

      const imRaum = Object.values(d0.fixtures).filter((f) => f.roomId === roomId);
      const fbh = imRaum.find((f) => f.type === 'underfloor' && f.params.roomCoverage === true);
      if (fbh) {
        return {
          ok: false,
          message: `„${room.name}" hat eine Fußbodenheizung — ihre Leistung folgt aus der Auslegung, nicht aus einer Eingabe.`,
        };
      }

      const heizflaechen = imRaum.filter((f) => istHeizflaeche(f.type));
      if (heizflaechen.length > 1) {
        return {
          ok: false,
          message: `„${room.name}" hat ${heizflaechen.length} Heizflächen — die Leistung steht an jeder einzeln im Plan.`,
        };
      }

      if (heizflaechen.length === 1) {
        const f = heizflaechen[0];
        get().updateFixture(f.id, { params: mitLeistung(f.type, f.params, watt, quelle ?? 'datenblatt') });
        return {
          ok: true,
          message:
            watt === undefined
              ? `„${room.name}": Heizleistung geleert — sie gilt jetzt als nicht erfasst.`
              : `„${room.name}": ${Math.round(watt)} W eingetragen.`,
        };
      }

      if (watt === undefined) return { ok: true, message: '' };

      // Im Bad hängt ein Badheizkörper, kein Plattenheizkörper — so setzt ihn
      // der Handwerker, und so trägt ihn die Heizflächenauslegung (EN 442, n = 1,3).
      const typ = room.usage === 'bath' ? 'towel-radiator' : 'radiator';
      const def = FIXTURE_BY_TYPE[typ];
      const platz = heizkoerperplatz(room, d0.walls, d0.nodes, d0.openings, def?.depth ?? 0.1);
      const erstellt = get().addFixture(typ, platz.position, {
        rotation: platz.rotation,
        wallId: platz.wallId,
        roomId,
        // Der Heizkörper gehört auf das Geschoss **des Raums** — nicht auf
        // das gerade sichtbare. Über das Raumbuch und über die Schnittstelle
        // lässt sich die Heizlast eines Raums setzen, der nicht im
        // aktiven Geschoss liegt.
        levelId: room.levelId,
        params: {
          ...mitLeistung(typ, def.params, watt, quelle ?? 'datenblatt'),
          powerSource: quelle === 'schaetzung' ? 'heizlast' : 'datenblatt',
        },
      });
      if (!erstellt) return { ok: false, message: 'Heizkörper konnte nicht angelegt werden' };
      return {
        ok: true,
        message: `„${room.name}": ${typ === 'towel-radiator' ? 'Badheizkörper' : 'Heizkörper'} mit ${Math.round(watt)} W ${PLATZ_TEXT[platz.grund]}.`,
      };
    },

    toggleFloorLoopArea: (roomId) => {
      const doc0 = get().doc;
      const room = doc0.rooms[roomId];
      if (!room || room.innerPolygon.length < 3) return null;

      const vorhanden = Object.values(doc0.fixtures).find(
        (f) => f.type === 'underfloor' && f.params.roomCoverage === true && f.roomId === roomId,
      );
      if (vorhanden) {
        mutate(
          (doc) => {
            delete doc.fixtures[vorhanden.id];
          },
          { skipRooms: true },
        );
        set({ statusMessage: `Fußbodenheizung in „${room.name}" entfernt` });
        return 'entfernt';
      }

      const gelegt = belegeRaum(get, roomId);
      if (!gelegt) {
        set({ statusMessage: `„${room.name}" ist für eine Fußbodenheizung zu klein` });
        return null;
      }
      set({
        statusMessage:
          `Fußbodenheizung „${room.name}": ${gelegt.area.toFixed(1).replace('.', ',')} m² belegt · ` +
          `${gelegt.loops} ${gelegt.loops === 1 ? 'Kreis' : 'Kreise'} · ${gelegt.powerW} W`,
      });
      return 'angelegt';
    },

    layAllFloorLoops: (levelId) => {
      const doc0 = get().doc;
      const geschoss = levelId ?? doc0.activeLevelId;
      const raeume = Object.values(doc0.rooms).filter((r) => r.levelId === geschoss);
      const laid: FloorLoopBatchResult[] = [];
      const skipped: FloorLoopBatchSkip[] = [];

      /**
       * Ein Raum, in dem schon ein Heizkörper steht, bekommt keine
       * Fußbodenheizung dazu. Das ist keine Bequemlichkeit, sondern
       * Hydraulik: zwei Heizflächen mit verschiedenen Systemtemperaturen im
       * selben Raum sind eine Entscheidung, die jemand treffen muss —
       * stillschweigend darf sie nicht fallen.
       */
      const heizkoerperTypen: FixtureType[] = ['radiator', 'radiator-tube', 'towel-radiator', 'convector'];

      for (const room of raeume) {
        if (room.innerPolygon.length < 3) {
          skipped.push({ roomId: room.id, room: room.name, reason: 'kein geschlossener Raumumriss' });
          continue;
        }
        if (!room.isHeated) {
          skipped.push({ roomId: room.id, room: room.name, reason: 'unbeheizt' });
          continue;
        }
        const aktuell = get().doc;
        const schon = Object.values(aktuell.fixtures).find(
          (f) => f.type === 'underfloor' && f.params.roomCoverage === true && f.roomId === room.id,
        );
        if (schon) {
          skipped.push({ roomId: room.id, room: room.name, reason: 'hat schon eine Fußbodenheizung' });
          continue;
        }
        const heizkoerper = Object.values(aktuell.fixtures).find(
          (f) =>
            f.levelId === room.levelId &&
            heizkoerperTypen.includes(f.type) &&
            pointInPolygon(f.position, room.innerPolygon),
        );
        if (heizkoerper) {
          skipped.push({
            roomId: room.id,
            room: room.name,
            reason: `hat bereits einen Heizkörper (${heizkoerper.label ?? FIXTURE_BY_TYPE[heizkoerper.type]?.label ?? heizkoerper.type})`,
          });
          continue;
        }
        const gelegt = belegeRaum(get, room.id);
        if (!gelegt) {
          skipped.push({
            roomId: room.id,
            room: room.name,
            reason: 'nach Randabstand und Einbauten bleibt keine belegbare Fläche',
          });
          continue;
        }
        laid.push(gelegt);
      }

      const verteiler = Object.values(get().doc.fixtures).some(
        (f) => f.type === 'manifold' && f.levelId === geschoss,
      );
      const flaeche = laid.reduce((s, r) => s + r.area, 0);
      set({
        statusMessage:
          laid.length === 0
            ? `Kein Raum ausgelegt — ${skipped.length} übergangen (siehe TGA-Palette)`
            : `${laid.length} ${laid.length === 1 ? 'Raum' : 'Räume'} ausgelegt · ` +
              `${flaeche.toFixed(1).replace('.', ',')} m²` +
              (skipped.length > 0 ? ` · ${skipped.length} übergangen` : '') +
              (verteiler ? '' : ' · kein Heizkreisverteiler gesetzt'),
      });
      return { levelId: geschoss, laid, skipped, manifold: verteiler };
    },

    updateFixture: (id, patch) =>
      mutate(
        (doc) => {
          const fixture = doc.fixtures[id];
          if (!fixture) return;
          const neu: Fixture = { ...fixture, ...patch };
          /*
           * **Wer die Leistung anfasst, macht sie zu seiner.**
           *
           * Ändert jemand `powerW` über diesen Weg — im Inspektor, aus einem
           * Datenblattimport, über die Einbettungsschnittstelle —, dann ist
           * das keine Vorbelegung und keine Schätzung mehr, sondern eine
           * Angabe. Ab hier zieht das Programm sie nicht mehr nach.
           *
           * Ohne diese Zeile wäre das automatische Nachziehen eine Falle:
           * Man trägt den Wert aus dem Datenblatt ein, ändert später eine
           * Dämmstärke, und die Zahl ist wieder weg — ersetzt durch eine
           * Schätzung, die schlechter ist als das, was man abgelesen hatte.
           *
           * Ausdrücklich mitgegebene Herkunft (etwa `'ravia'` oder
           * `'heizlast'`) gewinnt: Die kennt ihren eigenen Ursprung besser
           * als diese Regel.
           */
          /*
           * **Geprüft wird, ob die Herkunft *mitgeändert* wurde — nicht, ob
           * sie im Patch steht.**
           *
           * Der erste Versuch fragte `patch.params?.powerSource === undefined`
           * und war damit in der Praxis wirkungslos: Jede Oberfläche, die ein
           * einzelnes Feld ändert, baut den Patch als `{ ...params, powerW: x }`
           * — die alte Herkunft steht dann mit drin, und die Regel sah einen
           * ausdrücklichen Wunsch, wo nur eine Kopie war. Gemessen: Ein von
           * Hand auf 777 W gesetzter Heizkörper trug danach weiterhin
           * `heizlast` und wurde beim nächsten Rechenlauf überschrieben.
           *
           * Ein *echter* Herkunftswunsch unterscheidet sich davon: Er setzt
           * einen **anderen** Wert als den, der schon dastand.
           */
          const leistungGeaendert =
            (patch.params?.powerW !== undefined && patch.params.powerW !== fixture.params.powerW) ||
            (patch.params?.ratedPower !== undefined && patch.params.ratedPower !== fixture.params.ratedPower);
          const herkunftAusdruecklich =
            patch.params?.powerSource !== undefined &&
            patch.params.powerSource !== fixture.params.powerSource;
          if (leistungGeaendert && !herkunftAusdruecklich) {
            neu.params = { ...neu.params, powerSource: 'datenblatt' };
          }
          doc.fixtures[id] = neu;
        },
        { skipRooms: true },
      ),

    uebernimmUeberschlagAlsHeizleistung: (optionen) => {
      const nurLeere = optionen?.nurLeere ?? true;
      const doc = get().doc;
      const ueberschlag = estimateHeatLoad(doc);
      const jeRaum = new Map(ueberschlag.rooms.map((r) => [r.roomId, r]));

      let gesetzt = 0;
      let uebersprungen = 0;
      let summeW = 0;
      for (const raum of Object.values(doc.rooms)) {
        if (optionen?.levelId && raum.levelId !== optionen.levelId) continue;
        if (!raum.isHeated) { uebersprungen++; continue; }
        const last = jeRaum.get(raum.id);
        if (!last || last.total <= 0) { uebersprungen++; continue; }

        // Steht schon eine Leistung im Raum? Dann bleibt sie stehen.
        if (nurLeere) {
          const vorhanden = Object.values(get().doc.fixtures)
            .some((f) => f.roomId === raum.id && istHeizflaeche(f.type) && (heizleistung(f) ?? 0) > 0);
          if (vorhanden) { uebersprungen++; continue; }
        }

        // Die Raumheizlast gilt im Betriebspunkt der Anlage; am Heizkörper
        // steht die Normleistung 75/65/20 (Befund A1). Umgerechnet und auf
        // 50 W gerundet: Der Überschlag gibt keine Watt-Genauigkeit her.
        const typ = raum.usage === 'bath' ? 'towel-radiator' : 'radiator';
        const watt = normleistungAusRaumlast(get().doc, last.setpoint, last.total, typ);
        if (watt === undefined) { uebersprungen++; continue; }
        const antwort = get().setzeRaumHeizleistung(raum.id, watt, 'schaetzung');
        if (antwort.ok) { gesetzt++; summeW += watt; } else uebersprungen++;
      }

      const message = gesetzt === 0
        ? 'Keine Heizleistung eingetragen — entweder steht überall schon eine, oder es gibt keinen beheizten Raum mit Überschlag.'
        // Komma, nicht Punkt — der Satz steht in einer deutschen Oberfläche.
        : `${gesetzt} ${gesetzt === 1 ? 'Raum' : 'Räume'} mit dem Überschlag belegt, ` +
          `zusammen ${(summeW / 1000).toFixed(1).replace('.', ',')} kW` +
          `${uebersprungen ? ` (${uebersprungen} übersprungen)` : ''}. ` +
          'Das ist ein Überschlag aus Flächen und U-Werten, keine Norm-Heizlast — die rechnet RaVia.';
      set({ statusMessage: message });
      return { gesetzt, uebersprungen, summeW, message };
    },

    fuehreKleineRaeumeAlsUnbeheizt: (schwelle = 1) => {
      const doc = get().doc;
      const klein = Object.values(doc.rooms).filter((r) => r.isHeated && r.area < schwelle);
      if (!klein.length) {
        return { geaendert: 0, message: `Kein beheizter Raum unter ${schwelle.toFixed(2).replace('.', ',')} m².` };
      }
      for (const r of klein) get().updateRoom(r.id, { isHeated: false });
      const namen = klein.slice(0, 3).map((r) => `„${r.name}"`).join(', ');
      const message =
        `${klein.length} Raum/Räume unter ${schwelle.toFixed(2).replace('.', ',')} m² als unbeheizt geführt ` +
        `(${namen}${klein.length > 3 ? ' …' : ''}). Rückgängig geht mit Strg+Z.`;
      set({ statusMessage: message });
      return { geaendert: klein.length, message };
    },

    moveFixture: (id, position) =>
      mutate(
        (doc) => {
          const fixture = doc.fixtures[id];
          if (!fixture) return;
          const def = FIXTURE_BY_TYPE[fixture.type];
          let next: Fixture = {
            ...fixture,
            position: { x: roundMm(position.x), y: roundMm(position.y) },
          };

          // Wandgebundene Objekte rasten an die nächste Wand ein und richten
          // sich automatisch parallel dazu aus — ein Heizkörper steht nie schräg.
          if (def?.wallMounted) {
            let bestWall: Wall | undefined;
            let bestDist = 1.0;
            let bestPoint = next.position;
            for (const wall of Object.values(doc.walls)) {
              /*
               * **Nur Wände desselben Geschosses.**
               *
               * Ohne diese Zeile rastet ein Heizkörper an eine Wand ein, die
               * im Obergeschoss steht — der Suchradius beträgt einen Meter,
               * und im Grundriss liegen die Geschosse übereinander. Das
               * Objekt übernimmt dann `wallId` und Drehung einer Wand, die im
               * Bild gar nicht zu sehen ist; beim nächsten Verschieben jener
               * Wand wandert es mit, und niemand versteht, warum.
               */
              if (wall.levelId !== next.levelId) continue;
              const a = doc.nodes[wall.a];
              const b = doc.nodes[wall.b];
              if (!a || !b) continue;
              const cp = closestPointOnSegment(position, a, b);
              const d = distance(cp, position);
              if (d < bestDist) {
                bestDist = d;
                bestWall = wall;
                bestPoint = cp;
              }
            }
            if (bestWall) {
              const a = doc.nodes[bestWall.a];
              const b = doc.nodes[bestWall.b];
              const angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
              const nx = -(b.y - a.y);
              const ny = b.x - a.x;
              const nlen = Math.hypot(nx, ny) || 1;
              // Auf die Raumseite setzen, auf der der Cursor steht.
              const side = (position.x - bestPoint.x) * (nx / nlen) + (position.y - bestPoint.y) * (ny / nlen);
              const offset = bestWall.thickness / 2 + next.depth / 2;
              const sign = side >= 0 ? 1 : -1;
              next = {
                ...next,
                wallId: bestWall.id,
                rotation: angle,
                position: {
                  x: roundMm(bestPoint.x + (nx / nlen) * offset * sign),
                  y: roundMm(bestPoint.y + (ny / nlen) * offset * sign),
                },
              };
            } else {
              next = { ...next, wallId: undefined };
            }
          }

          // Auch der Raum gehört zum eigenen Geschoss — aus demselben Grund.
          const room = Object.values(doc.rooms).find(
            (r) =>
              r.levelId === next.levelId &&
              r.innerPolygon.length >= 3 &&
              pointInPolygon(next.position, r.innerPolygon),
          );
          next.roomId = room?.id;
          doc.fixtures[id] = next;
        },
        { skipRooms: true },
      ),

    updateRoom: (id, patch) =>
      mutate(
        (doc) => {
          const room = doc.rooms[id];
          if (!room) return;
          const merged = { ...room, ...patch };
          // Nutzungsänderung zieht die Normwerte nach, sofern nicht explizit gesetzt
          if (patch.usage && patch.setpointTemperature === undefined) {
            const d = usageDefaults(patch.usage);
            merged.setpointTemperature = d.temp;
            merged.airChangeRate = d.ach;
            // Die Rolle im Lüftungskonzept folgt der Nutzung mit — wer einen
            // Raum zum Bad macht, meint einen Abluftraum. Eine ausdrücklich
            // gesetzte Rolle bleibt stehen.
            if (patch.ventilationRole === undefined) merged.ventilationRole = d.air;
          }
          doc.rooms[id] = merged;
        },
        { skipRooms: true },
      ),
  };
}
