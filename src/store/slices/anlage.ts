/**
 * Store-Slice „Außenanlage, Wärmepumpe, Anlagenschema, Dachöffnungen und Anmerkungen".
 *
 * TD-22: Aus `useBimStore.ts` herausgelöst; die Aktionen sind unverändert.
 * `useBimStore` setzt den Store aus diesen Slices zusammen und reicht
 * `set`, `get` und `mutate` (Dokumentänderung mit Historie) herein.
 */

import { dez } from '../../lib/zahl';
import type {
  Annotation,
  PipeAccessory,
  PipeRun,
  PlantStorage,
  SchematicComponent,
  SchematicLink,
  RoofOpening,
  HeatPump,
  SiteElement,
  StorageKind,
  Vec2,
} from '../../types/bim';
import {
  ROOF_OPENING_LABELS,
  SITE_ELEMENT_LABELS,
  VORHABEN_LABELS,
} from '../../types/bim';
import { anlageAusAntworten } from '../../lib/anlagenFragen';
import { distanceToSegment, pointInPolygon, roundMm } from '../../lib/geometry';
import { ACCESSORY_LABELS } from '../../lib/pipeAccessorySymbols';
import { hoehenText } from '../../lib/beschriftung3d';
import { partnerVon } from '../../lib/doppelleitung';
import { gebaeudeUmriss } from '../../lib/roomDetection';
import { baseRoofHeightAt, buildRoofFrame, dormerSide } from '../../lib/roofGeometry';
import { VORHABEN_VORBELEGUNG } from '../../lib/plantDefaults';
import { ANBINDUNG_LABELS, schemaVorlage } from '../../lib/schemaKatalog';
import { uid } from '../../lib/dokumentPflege';
import type { BimState, Mutate, StoreGet, StoreSet } from '../bimZustand';
import { LINE_KINDS, POLYGON_KINDS, SITE_DEFAULTS } from '../bimZustand';

export type AnlageSchluessel =
  | 'addSiteElement'
  | 'updateSiteElement'
  | 'addHeatPump'
  | 'updateHeatPump'
  | 'setzeAnlagenAntworten'
  | 'updatePlant'
  | 'addPlantStorage'
  | 'removePlantStorage'
  | 'setPlantCircuits'
  | 'setSchematic'
  | 'uebernehmeSchemaVorlage'
  | 'updateSchematicComponent'
  | 'addSchematicComponent'
  | 'deleteSchematicComponent'
  | 'addSchematicLink'
  | 'deleteSchematicLink'
  | 'updateSite'
  | 'updatePipe'
  | 'addRoofOpening'
  | 'updateRoofOpening'
  | 'addAnnotation'
  | 'setVorhaben'
  | 'setzeArmatur'
  | 'setzeBeschriftung3D'
  | 'updateAnnotation'
  | 'deleteAnnotation';

export function anlageSlice(set: StoreSet, get: StoreGet, mutate: Mutate): Pick<BimState, AnlageSchluessel> {
  return {
    // --- Außenanlage -------------------------------------------------------
    /**
     * Legt ein Objekt im Außengelände an. Punkte, Züge und Flächen liegen in
     * derselben Struktur; welche Form gemeint ist, sagt die Art.
     */
    addSiteElement: (kind, points) => {
      const needed = POLYGON_KINDS.has(kind) ? 3 : LINE_KINDS.has(kind) ? 2 : 1;
      if (points.length < needed) return null;
      const element: SiteElement = {
        id: uid('site'),
        kind,
        points: points.map((p) => ({ x: roundMm(p.x), y: roundMm(p.y) })),
        ...SITE_DEFAULTS[kind],
      };
      let ersetzt = false;
      mutate((doc) => {
        // Es gibt genau eine Grundstücksgrenze. Eine zweite wäre kein
        // zweites Grundstück, sondern ein Widerspruch.
        if (kind === 'boundary') {
          for (const existing of Object.values(doc.site.elements)) {
            if (existing.kind === 'boundary') {
              delete doc.site.elements[existing.id];
              ersetzt = true;
            }
          }
        }
        doc.site.elements[element.id] = element;
      });
      set({
        selection: { kind: 'site', id: element.id },
        selections: [{ kind: 'site', id: element.id }],
        /*
         * Dass die alte Grenze dabei verschwindet, muss dastehen.
         *
         * Vorher hieß es nur „Grundstücksgrenze angelegt", während die zuvor
         * gezeichnete stillschweigend gelöscht wurde. Wer nach dem Zeichnen
         * einer zweiten Fläche die erste vermisst, hält das für einen Fehler
         * im Programm — und sucht an der falschen Stelle. Die Vorgabe des
         * Geländewerkzeugs ist „Grundstücksgrenze", der Fall tritt also
         * ungewollt ein, sobald jemand zweimal hintereinander umfährt.
         */
        statusMessage: ersetzt
          ? 'Grundstücksgrenze ersetzt — es gibt nur eine. Strg+Z holt die alte zurück.'
          : `${SITE_ELEMENT_LABELS[kind]} angelegt`,
      });
      return element;
    },

    updateSiteElement: (id, patch) =>
      mutate((doc) => {
        const element = doc.site.elements[id];
        if (!element) return;
        // Stützpunkte auf den Millimeter runden — dieselbe Regel wie beim
        // Anlegen. Ohne sie sammelt ein Objekt beim Verschieben mit der Maus
        // Nachkommastellen an, die im Lageplan und im Export als krumme
        // Koordinaten wieder auftauchen.
        const points = patch.points
          ? patch.points.map((p) => ({ x: roundMm(p.x), y: roundMm(p.y) }))
          : undefined;
        doc.site.elements[id] = { ...element, ...patch, ...(points ? { points } : {}) };
      }),

    /**
     * Setzt eine Wärmepumpe. Die Vorgabewerte sind bewusst ein durchschnittliches
     * Gerät der 8-kW-Klasse mit Propan — nicht das leiseste am Markt. Wer die
     * Zahlen nicht anfasst, bekommt ein Ergebnis auf der sicheren Seite.
     */
    addHeatPump: (position) => {
      const pump: HeatPump = {
        id: uid('wp'),
        label: 'Wärmepumpe',
        // Aufgestellt wird auf dem Geschoss, auf dem man steht. Nur dort ist
        // das Gerät danach greifbar — siehe `aufstellgeschoss.ts`.
        levelId: get().doc.activeLevelId,
        source: 'air',
        form: 'monoblock-outdoor',
        position: { x: roundMm(position.x), y: roundMm(position.y) },
        azimuth: 180,
        width: 1.1,
        depth: 0.5,
        height: 1.3,
        standHeight: 0.3,
        mounting: 'wall',
        soundPower: 55,
        soundPowerNight: 50,
        nightModeGuaranteed: false,
        toneSurcharge: 0,
        refrigerant: 'R290',
        refrigerantMass: 1.5,
        protectionRadius: 1,
        heatingCapacity: 8,
        ratingPoint: 'A-7/W35',
        cop: 3.2,
        operation: 'mono-energetic',
        bivalencePoint: -7,
        backupCapacity: 6,
        flowTemperature: 40,
        gridRegime: 'p14a-dimming',
        blockedHours: 0,
        domesticHotWater: true,
        occupants: 4,
      };
      mutate((doc) => {
        doc.site.pumps[pump.id] = pump;
      });
      set({
        selection: { kind: 'heatpump', id: pump.id },
        selections: [{ kind: 'heatpump', id: pump.id }],
        statusMessage: 'Wärmepumpe gesetzt — Schallnachweis im Reiter „Wärmepumpe"',
      });
      return pump;
    },

    updateHeatPump: (id, patch) =>
      mutate((doc) => {
        const pump = doc.site.pumps[id];
        if (!pump) return;
        // Standort auf den Millimeter runden — wie beim Knoten einer Wand.
        // Der Aufstellort geht in den Schallnachweis ein; ein Abstand mit
        // zwölf Nachkommastellen sähe im Bericht nach Genauigkeit aus, die
        // es nicht gibt.
        const position = patch.position
          ? { x: roundMm(patch.position.x), y: roundMm(patch.position.y) }
          : undefined;
        doc.site.pumps[id] = { ...pump, ...patch, ...(position ? { position } : {}) };
      }),

    setzeAnlagenAntworten: (antworten) =>
      mutate(
        (doc) => {
          const { storages, circuits } = anlageAusAntworten(
            antworten,
            { storages: doc.plant.storages, circuits: doc.plant.circuits },
            Object.values(doc.rooms),
          );
          doc.plant = { ...doc.plant, antworten, storages, circuits };
        },
        {
          skipRooms: true,
          /*
           * Die Heizkreistemperaturen hängen an den Kreisen, und an ihnen
           * hängt jede abgeleitete Heizflächenleistung. Wer aus einem
           * ungemischten einen gemischten Kreis macht, ändert die Auslegung
           * des ganzen Zweiges mit.
           */
          ziehenachHeizflaechen: true,
        },
      ),

    updatePlant: (patch) =>
      mutate((doc) => {
        const p = doc.plant;
        doc.plant = {
          ...p,
          generatorModelId: patch.generatorModelId ?? p.generatorModelId,
          pumpId: patch.pumpId ?? p.pumpId,
          heatLoadOverride:
            'heatLoadOverride' in patch ? patch.heatLoadOverride : p.heatLoadOverride,
          secondGenerator: 'secondGenerator' in patch ? patch.secondGenerator : p.secondGenerator,
          cascade: 'cascade' in patch ? patch.cascade : p.cascade,
          cooling: 'cooling' in patch ? patch.cooling : p.cooling,
          additionalConsumer:
            'additionalConsumer' in patch ? patch.additionalConsumer : p.additionalConsumer,
          design: { ...p.design, ...(patch.design ?? {}) },
          safety: { ...p.safety, ...(patch.safety ?? {}) },
          dhw: { ...p.dhw, ...(patch.dhw ?? {}) },
          storages: { ...p.storages },
          circuits: { ...p.circuits },
          schematic: { ...p.schematic },
        };
      }, {
        skipRooms: true,
        /*
         * Ändert sich die Auslegungstemperatur, ändert sich jede abgeleitete
         * Heizflächenleistung mit — und zwar erheblich: zwischen 50/40 und
         * 35/28 liegt beim selben Raum fast der Faktor drei. Genau deshalb
         * wird hier nachgezogen, obwohl an der Geometrie nichts geschah.
         */
        ziehenachHeizflaechen:
          patch.design?.flowTemperature !== undefined || patch.design?.returnTemperature !== undefined,
      }),

    addPlantStorage: (storage) =>
      mutate((doc) => {
        doc.plant = {
          ...doc.plant,
          storages: { ...doc.plant.storages, [storage.id]: { ...storage, suggested: false } },
        };
      }, { skipRooms: true }),

    removePlantStorage: (id) =>
      mutate((doc) => {
        const storages = { ...doc.plant.storages };
        delete storages[id];
        doc.plant = { ...doc.plant, storages };
      }, { skipRooms: true }),

    setPlantCircuits: (circuits) =>
      mutate((doc) => {
        doc.plant = {
          ...doc.plant,
          circuits: Object.fromEntries(circuits.map((c) => [c.id, c])),
        };
      }, { skipRooms: true }),

    setSchematic: (components, links, manual, vorlageId) =>
      mutate((doc) => {
        doc.plant = {
          ...doc.plant,
          schematic: {
            components: Object.fromEntries(components.map((c) => [c.id, c])),
            links: Object.fromEntries(links.map((l) => [l.id, l])),
            manual: manual ?? doc.plant.schematic.manual,
            // Ohne Angabe bleibt die bisherige Kennung stehen: „neu erzeugen"
            // ändert das Bild, nicht die Zuordnung zur Musterlösung.
            vorlageId: vorlageId ?? doc.plant.schematic.vorlageId,
          },
        };
      }, { skipRooms: true }),

    uebernehmeSchemaVorlage: (vorlageId) => {
      const vorlage = schemaVorlage(vorlageId);
      if (!vorlage) return false;
      mutate((doc) => {
        /*
         * Zuerst die Anlage, dann das Bild.
         *
         * Die Vorlage sagt, wie der Erzeuger an die Kreise kommt. Diese
         * Aussage gehört ins Anlagenblatt, nicht ins Fließbild: `designPlant`
         * rechnet daraus Puffervolumen, Pumpenförderstrom und die Frage, ob
         * ein Überströmventil nötig ist. Zeichnete man erst und trüge den
         * Speicher nicht nach, zeigte das Schema einen Puffer, den die
         * Auslegung nicht kennt — und die Materialliste bestellte ihn nicht.
         */
        const art: StorageKind | undefined =
          vorlage.merkmale.anbindung === 'reihenpuffer'
            ? 'buffer-series'
            : vorlage.merkmale.anbindung === 'parallelpuffer'
              ? 'buffer-parallel'
              : vorlage.merkmale.anbindung === 'weiche'
                ? 'separator'
                : vorlage.merkmale.anbindung === 'kombispeicher'
                  ? 'combi'
                  : undefined;

        const speicher: Record<string, PlantStorage> = {};
        for (const [id, s2] of Object.entries(doc.plant.storages)) {
          // Puffer, Weichen und Kombispeicher werden ersetzt; der
          // Trinkwasserspeicher bleibt — über ihn sagt die Anbindung nichts.
          const istAnbindung =
            s2.kind === 'buffer-series' ||
            s2.kind === 'buffer-parallel' ||
            s2.kind === 'separator' ||
            s2.kind === 'combi';
          if (!istAnbindung) speicher[id] = s2;
        }
        if (art) {
          // Das Volumen bleibt offen: es kommt aus `minimumBufferVolume` und
          // hängt an der Geräteleistung, nicht am Schema. Der Eintrag ist
          // deshalb als Vorschlag markiert, bis die Auslegung ihn füllt.
          const vorhanden = Object.values(doc.plant.storages).find((s2) => s2.kind === art);
          speicher['buffer-vorlage'] = vorhanden ?? {
            id: 'buffer-vorlage',
            label: `${ANBINDUNG_LABELS[vorlage.merkmale.anbindung]} nach ${vorlage.kennung}`,
            kind: art,
            volume: 0,
            suggested: true,
            note: `Aus der Schemavorlage „${vorlage.name}" übernommen.`,
          };
        }

        doc.plant = {
          ...doc.plant,
          storages: speicher,
          schematic: { ...doc.plant.schematic, vorlageId, manual: false },
        };
      }, { skipRooms: true });
      set({ statusMessage: `Schema „${vorlage.name}" übernommen (${vorlage.kennung})` });
      return true;
    },

    updateSchematicComponent: (id, patch) =>
      mutate((doc) => {
        const c = doc.plant.schematic.components[id];
        if (!c) return;
        doc.plant = {
          ...doc.plant,
          schematic: {
            ...doc.plant.schematic,
            components: { ...doc.plant.schematic.components, [id]: { ...c, ...patch } },
            // Sobald jemand von Hand eingreift, wird das Schema nicht mehr
            // ungefragt überschrieben. Der Planer hat dann recht, nicht das
            // Programm.
            manual: true,
          },
        };
      }, { skipRooms: true }),

    addSchematicComponent: (kind, x, y, label) => {
      const component: SchematicComponent = {
        id: uid('sc'),
        kind,
        label: label ?? kind,
        x,
        y,
        generated: false,
      };
      mutate((doc) => {
        doc.plant = {
          ...doc.plant,
          schematic: {
            ...doc.plant.schematic,
            components: { ...doc.plant.schematic.components, [component.id]: component },
            manual: true,
          },
        };
      }, { skipRooms: true });
      set({ statusMessage: `${component.label} ins Schema eingefügt` });
      return component;
    },

    deleteSchematicComponent: (id) =>
      mutate((doc) => {
        const components = { ...doc.plant.schematic.components };
        delete components[id];
        // Eine Verbindung ohne Bauteil ist keine Verbindung. Sie geht mit.
        const links = Object.fromEntries(
          Object.entries(doc.plant.schematic.links).filter(([, l]) => l.from !== id && l.to !== id),
        );
        doc.plant = { ...doc.plant, schematic: { components, links, manual: true } };
      }, { skipRooms: true }),

    addSchematicLink: (from, to, service, label) => {
      if (from === to) return null;
      const { doc } = get();
      const known = doc.plant.schematic.components;
      if (!known[from] || !known[to]) return null;
      // Dieselbe Verbindung zweimal wäre im Bild nicht zu unterscheiden.
      const exists = Object.values(doc.plant.schematic.links).some(
        (l) => l.from === from && l.to === to && l.service === service,
      );
      if (exists) return null;
      const link: SchematicLink = { id: uid('sl'), from, to, service, label, generated: false };
      mutate((d) => {
        d.plant = {
          ...d.plant,
          schematic: {
            ...d.plant.schematic,
            links: { ...d.plant.schematic.links, [link.id]: link },
            manual: true,
          },
        };
      }, { skipRooms: true });
      set({ statusMessage: 'Verbindung gezeichnet' });
      return link;
    },

    deleteSchematicLink: (id) =>
      mutate((doc) => {
        const links = { ...doc.plant.schematic.links };
        delete links[id];
        doc.plant = { ...doc.plant, schematic: { ...doc.plant.schematic, links, manual: true } };
      }, { skipRooms: true }),

    updateSite: (patch) =>
      mutate((doc) => {
        doc.site = { ...doc.site, ...patch };
      }),

    updatePipe: (id, patch) =>
      mutate((doc) => {
        const run = doc.pipes[id];
        if (!run) return;
        doc.pipes[id] = { ...run, ...patch };

        /*
         * Was für die Trasse gilt, gilt für beide Rohre.
         *
         * Vor- und Rücklauf einer Doppelleitung liegen im selben Kanal, im
         * selben Schlitz, im selben Loch: Sie haben dieselbe Höhe, dieselbe
         * Nennweite, dieselbe Dämmung und denselben Werkstoff. Ohne dieses
         * Nachziehen entstand genau der Fehler, den die Paarkennung
         * verhindern soll — in der begehbaren Ansicht wurde die Höhe am
         * angelegten Zug gesetzt, und der Rücklauf blieb auf der
         * Voreinstellung 0,05 m liegen, während der Vorlauf auf 2,45 m
         * stieg. Zwei Rohre in einem Kanal, zwei Meter auseinander.
         *
         * Lage, Leitungsart und Beschriftung wandern ausdrücklich **nicht**
         * mit: Die Punkte sind die versetzten des jeweiligen Rohrs, und die
         * Leitungsart ist das, was das Paar unterscheidet.
         */
        const paar = partnerVon(doc.pipes, doc.pipes[id]);
        if (!paar) return;
        const gemeinsam: Partial<PipeRun> = {};
        if (patch.elevation !== undefined) gemeinsam.elevation = patch.elevation;
        if (patch.elevationTo !== undefined) gemeinsam.elevationTo = patch.elevationTo;
        if (patch.nominalDiameter !== undefined) gemeinsam.nominalDiameter = patch.nominalDiameter;
        if (patch.insulation !== undefined) gemeinsam.insulation = patch.insulation;
        if (patch.material !== undefined) gemeinsam.material = patch.material;
        if (patch.outerDiameter !== undefined) gemeinsam.outerDiameter = patch.outerDiameter;
        if (Object.keys(gemeinsam).length > 0) doc.pipes[paar.id] = { ...paar, ...gemeinsam };
      }),

    addRoofOpening: (kind, position) => {
      const doc0 = get().doc;
      const level = doc0.levels[doc0.activeLevelId];
      if (!level?.roof || level.roof.kind === 'flat') {
        set({ statusMessage: 'Erst eine Dachform wählen — ohne Dach gibt es keine Gaube' });
        return null;
      }

      const isSkylight = kind === 'skylight';
      const rooms = Object.values(doc0.rooms).filter((r) => r.levelId === level.id);
      const biggest = rooms.sort((a, b) => b.area - a.area)[0];

      let target = position;
      if (!target) {
        target = biggest ? biggest.centroid : { x: 0, y: 0 };

        // Eine Gaube gehört an die Traufe, nicht an den First: dort, wo die
        // Schräge den Raum unbrauchbar macht, schafft sie Stehhöhe. In der
        // Raummitte gesetzt hätte sie gar keine Front — das Dach ist dort
        // schon höher als die Gaube, und alle Flächen kämen als Null heraus.
        if (!isSkylight && biggest) {
          const levelWalls = Object.values(doc0.walls).filter((w) => w.levelId === level.id);
          const outline: Vec2[] = [];
          for (const w of levelWalls) {
            const na = doc0.nodes[w.a];
            const nb = doc0.nodes[w.b];
            if (na) outline.push({ x: na.x, y: na.y });
            if (nb) outline.push({ x: nb.x, y: nb.y });
          }
          // Gesucht wird gleich die niedrigste Stelle im Raum. Ohne den
          // geordneten Umriss wäre das beim L-Grundriss die niedrigste Stelle
          // eines Daches, das es nicht gibt — die Gaube stünde dann irgendwo.
          const frame = buildRoofFrame(level.roof, outline, [], gebaeudeUmriss(levelWalls, doc0.nodes));
          if (frame) {
            // Gesucht ist die *niedrigste* Stelle im Raum — dort steht man
            // nicht mehr, und genau dort hilft eine Gaube. Einfach in
            // Fallrichtung zu tasten wäre falsch: bei einem Raum, der an
            // einer Innenwand endet, liefe man auf den First zu.
            const poly = biggest.innerPolygon;
            let minX = Infinity;
            let minY = Infinity;
            let maxX = -Infinity;
            let maxY = -Infinity;
            for (const pt of poly) {
              minX = Math.min(minX, pt.x);
              minY = Math.min(minY, pt.y);
              maxX = Math.max(maxX, pt.x);
              maxY = Math.max(maxY, pt.y);
            }
            // Gesucht: die niedrigste Stelle — und unter mehreren gleich
            // niedrigen die, die am wenigsten in der Ecke liegt. Sonst
            // landet die Gaube am Traufpunkt der Zimmerecke statt mittig
            // an der Traufe, wo sie hingehört.
            let bestPoint = biggest.centroid;
            let bestHeight = Infinity;
            let bestOffset = Infinity;
            for (let y = minY; y <= maxY; y += 0.2) {
              for (let x = minX; x <= maxX; x += 0.2) {
                const probe = { x, y };
                if (!pointInPolygon(probe, poly)) continue;
                const h = baseRoofHeightAt(frame, probe);
                // Abstand längs des Firsts zur Raummitte — quer dazu zählt
                // nur die Höhe.
                const offset = Math.abs(
                  (probe.x - biggest.centroid.x) * frame.along.x +
                    (probe.y - biggest.centroid.y) * frame.along.y,
                );
                if (h < bestHeight - 0.01 || (h < bestHeight + 0.01 && offset < bestOffset)) {
                  bestHeight = Math.min(bestHeight, h);
                  bestOffset = offset;
                  bestPoint = probe;
                }
              }
            }
            // Die Front sitzt an dieser Stelle, der Mittelpunkt liegt eine
            // halbe Gaubentiefe *firstwärts* dahinter — auf der Westseite
            // eines Satteldachs also in die andere Richtung als auf der Ost.
            const side = dormerSide(frame, { position: bestPoint });
            const candidate = {
              x: bestPoint.x - frame.dir.x * 0.75 * side,
              y: bestPoint.y - frame.dir.y * 0.75 * side,
            };

            // Die Gaube ganz in den Raum schieben: liegt ihre Breite quer zum
            // First teilweise außerhalb, wandert sie so weit hinein, bis sie
            // passt. Eine halb im Freien stehende Gaube wäre kein Vorschlag,
            // sondern ein Fehler, den jemand von Hand korrigieren müsste.
            let shift = 0;
            for (let step = 0; step <= 40; step++) {
              const trial = step === 0 ? 0 : (step % 2 === 1 ? 1 : -1) * Math.ceil(step / 2) * 0.2;
              const probe = {
                x: candidate.x + frame.along.x * trial,
                y: candidate.y + frame.along.y * trial,
              };
              const corners = [-1, 1].flatMap((su) =>
                [-1, 1].map((st) => ({
                  x: probe.x + frame.along.x * su * 0.95 + frame.dir.x * st * 0.7,
                  y: probe.y + frame.along.y * su * 0.95 + frame.dir.y * st * 0.7,
                })),
              );
              if (corners.every((c) => pointInPolygon(c, poly))) {
                shift = trial;
                break;
              }
            }
            target = {
              x: candidate.x + frame.along.x * shift,
              y: candidate.y + frame.along.y * shift,
            };
          }
        }
      }
      const opening: RoofOpening = {
        id: uid('ro'),
        levelId: level.id,
        kind,
        position: { x: roundMm(target.x), y: roundMm(target.y) },
        // Vorgaben: Dachfenster 78 × 118 cm (das gängigste Maß), Gaube 2,00 m
        // breit, 1,50 m tief, 2,20 m lichte Front.
        width: isSkylight ? 0.78 : 2,
        depth: isSkylight ? 1.18 : 1.5,
        frontHeight: isSkylight ? undefined : 2.2,
        frontWindowArea: isSkylight ? undefined : 1.6,
        uValue: isSkylight ? 1.3 : 0.2,
        gValue: isSkylight ? 0.5 : undefined,
        frontUValue: isSkylight ? undefined : 0.24,
      };
      mutate((doc) => {
        doc.roofOpenings[opening.id] = opening;
      });
      set({
        selection: { kind: 'roofOpening', id: opening.id },
        selections: [{ kind: 'roofOpening', id: opening.id }],
        statusMessage: `${ROOF_OPENING_LABELS[kind]} eingesetzt — mit dem Auswahl-Werkzeug verschieben`,
      });
      return opening;
    },

    updateRoofOpening: (id, patch) =>
      mutate((doc) => {
        const o = doc.roofOpenings[id];
        if (!o) return;
        doc.roofOpenings[id] = { ...o, ...patch };
      }),

    addAnnotation: (kind, points, text) => {
      if (!points.length) return null;
      if (kind !== 'text' && points.length < 2) return null;
      const note: Annotation = {
        id: uid('a'),
        kind,
        levelId: get().doc.activeLevelId,
        points: points.map((p) => ({ x: roundMm(p.x), y: roundMm(p.y) })),
        offset: kind === 'dimension' ? 0.4 : 0,
        text,
        scale: 1,
      };
      mutate((doc) => {
        doc.annotations[note.id] = note;
      });
      set({
        selection: { kind: 'annotation', id: note.id },
        selections: [{ kind: 'annotation', id: note.id }],
        statusMessage:
          kind === 'dimension'
            ? `Maßkette ${dez(Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y), 3)} m`
            : 'Beschriftung gesetzt — Text im Inspektor eingeben',
      });
      return note;
    },

    setVorhaben: (vorhaben) => {
      const vorher = get().doc.meta.vorhaben;
      const v = VORHABEN_VORBELEGUNG[vorhaben];
      mutate(
        (doc) => {
          doc.meta = { ...doc.meta, vorhaben };
          /*
           * **Vorbelegungen nur beim ersten Festlegen.**
           *
           * Wechselt jemand später von „Neubau" auf „Sanierung", ist die
           * Anlage in aller Regel schon bearbeitet. Alles zurückzustellen
           * wäre dann kein Dienst, sondern Datenverlust — die
           * Auslegungstemperatur, die jemand bewusst auf 45/38 gesetzt hat,
           * spränge ohne Rückfrage auf 55/45. Beim *ersten* Mal dagegen
           * steht überall noch die Vorgabe, und genau dort hilft die
           * Ableitung.
           */
          if (vorher !== undefined) return;
          doc.plant = {
            ...doc.plant,
            design: {
              ...doc.plant.design,
              flowTemperature: v.vorlauf,
              returnTemperature: v.ruecklauf,
            },
          };
          // Ohne Vorbelegung für die Luftdichtheit bleibt das Feld, wie es
          // ist — beim unsanierten Bestand gibt es keine Zahl, die man
          // annehmen darf (siehe `VORHABEN_VORBELEGUNG`).
          doc.meta = { ...doc.meta, vorhaben, ...(v.n50 !== undefined ? { n50: v.n50 } : {}) };
        },
        { skipRooms: true, ziehenachHeizflaechen: vorher === undefined },
      );
      set({
        statusMessage:
          vorher === undefined
            ? `${VORHABEN_LABELS[vorhaben]}: Vorbelegung ${v.vorlauf}/${v.ruecklauf} °C` +
              (v.n50 !== undefined ? `, n50 ${String(v.n50).replace('.', ',')} 1/h` : '') +
              ` — ${v.grund}`
            : `${VORHABEN_LABELS[vorhaben]} — vorhandene Eingaben bleiben unverändert`,
      });
    },

    setzeArmatur: (kind, position, elevation, label) => {
      const s = get();
      const levelId = s.doc.activeLevelId;
      /*
       * Die nächste Leitung in Reichweite bekommt die Armatur.
       *
       * **Warum eine halbe Meter breite Reichweite und nicht der genaue
       * Punkt.** Wer im Haus steht und auf ein Rohr zeigt, trifft es auf
       * wenige Zentimeter genau — aber der Strahl trifft die *Oberfläche*
       * des Rohres, die Trasse läuft durch seine Achse, und eine Leitung
       * unter der Decke wird aus zwei Metern Entfernung anvisiert. Ein
       * exakter Vergleich fände nie etwas. Fünfzig Zentimeter ist die
       * Entfernung, in der im Raum nichts anderes mehr in Frage kommt.
       */
      const REICHWEITE = 0.5;
      let runId: string | undefined;
      let naechste = REICHWEITE;
      for (const r of Object.values(s.doc.pipes ?? {})) {
        if (r.levelId !== levelId) continue;
        for (let i = 0; i + 1 < r.points.length; i += 1) {
          const d = distanceToSegment(position, r.points[i], r.points[i + 1]);
          if (d < naechste) {
            naechste = d;
            runId = r.id;
          }
        }
      }
      const armatur: PipeAccessory = {
        id: uid('ar'),
        kind,
        levelId,
        position: { x: roundMm(position.x), y: roundMm(position.y) },
        elevation: roundMm(elevation),
        runId,
        label: label ?? ACCESSORY_LABELS[kind],
        reason: 'Von Hand gesetzt — Bestandsaufnahme',
      };
      mutate((doc) => {
        if (!doc.pipeAccessories) doc.pipeAccessories = {};
        doc.pipeAccessories[armatur.id] = armatur;
      });
      set({
        selection: { kind: 'accessory', id: armatur.id },
        selections: [{ kind: 'accessory', id: armatur.id }],
        statusMessage: runId
          ? `${armatur.label} gesetzt und an die Leitung gebunden`
          : `${armatur.label} gesetzt — keine Leitung in Reichweite, steht frei`,
      });
      return armatur;
    },

    setzeBeschriftung3D: (anchor, punkt, elevation, text) => {
      const note: Annotation = {
        id: uid('a'),
        kind: 'leader',
        levelId: get().doc.activeLevelId,
        /*
         * Zwei Punkte, wie jede Hinweisfahne: Spitze und Textpunkt.
         *
         * Die Spitze sitzt am Bauteil, der Text 0,60 m schräg darüber. Ohne
         * den Versatz läge die Schrift im Grundriss genau auf dem Symbol,
         * das sie erklärt — und verdeckte es.
         */
        points: [
          { x: roundMm(punkt.x), y: roundMm(punkt.y) },
          { x: roundMm(punkt.x + 0.42), y: roundMm(punkt.y + 0.42) },
        ],
        offset: 0,
        text,
        scale: 1,
        elevation: roundMm(elevation),
        anchor,
      };
      mutate((doc) => {
        doc.annotations[note.id] = note;
      });
      set({
        selection: { kind: 'annotation', id: note.id },
        selections: [{ kind: 'annotation', id: note.id }],
        statusMessage: `Beschriftet: ${text} auf ${hoehenText(elevation)}`,
      });
      return note;
    },

    updateAnnotation: (id, patch) =>
      mutate((doc) => {
        const note = doc.annotations[id];
        if (!note) return;
        // Punkte auf den Millimeter runden — dieselbe Regel wie beim Anlegen.
        // Ohne sie sammelt eine verschobene Beschriftung Fließkommareste an,
        // die später als krumme Koordinaten im Plan und im Export stehen.
        const punkte = patch.points?.map((p) => ({ x: roundMm(p.x), y: roundMm(p.y) }));
        doc.annotations[id] = { ...note, ...patch, ...(punkte ? { points: punkte } : {}) };
      }),

    deleteAnnotation: (id) =>
      mutate((doc) => {
        if (!doc.annotations[id]) return;
        const rest = { ...doc.annotations };
        delete rest[id];
        doc.annotations = rest;
      }),
  };
}
