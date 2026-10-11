/**
 * Store-Slice „Vertikale Elemente, Körper, Durchbrüche und Rohrnetz".
 *
 * TD-22: Aus `useBimStore.ts` herausgelöst; die Aktionen sind unverändert.
 * `useBimStore` setzt den Store aus diesen Slices zusammen und reicht
 * `set`, `get` und `mutate` (Dokumentänderung mit Historie) herein.
 */

import { dez } from '../../lib/zahl';
import type {
  PipeRun,
  SolidElement,
  Durchbruch,
  SolidKind,
  VerticalElement,
} from '../../types/bim';
import {
  PIPE_SERVICE_LABELS,
  SOLID_LABELS,
  durchbruchWirt,
  VERTICAL_LABELS,
} from '../../types/bim';
import { roundMm } from '../../lib/geometry';
import { rohrlaenge } from '../../lib/rohrlaenge';
import { schlageVerteilerVor } from '../../lib/erzeugerplatz';
import { durchbruecheFuerTrassen } from '../../lib/wandquerung';
import { bildePaar } from '../../lib/doppelleitung';
import { rohrbezeichnung } from '../../lib/rohrbezeichnung';
import { formteile, formteilSumme } from '../../lib/formteile';
import { planeGebaeudeNetz } from '../../lib/gebaeudeNetz';
import { levelBaseHeights } from '../../lib/levelGeometry';
import { treppenmasse } from '../../lib/treppenlogik';
import { uid } from '../../lib/dokumentPflege';
import type { BimState, Mutate, StoreGet, StoreSet } from '../bimZustand';

export type InstallationSchluessel =
  | 'addVertical'
  | 'updateVertical'
  | 'addSolid'
  | 'solidFromRoom'
  | 'updateSolid'
  | 'addDurchbruch'
  | 'updateDurchbruch'
  | 'legeRohrnetzAus'
  | 'addPipe';

export function installationSlice(set: StoreSet, get: StoreGet, mutate: Mutate): Pick<BimState, InstallationSchluessel> {
  return {
    addVertical: (kind, position) => {
      const isStair = kind !== 'shaft';
      /*
       * **Die Stufenzahl folgt der Geschosshöhe**, nicht einer festen Zahl.
       *
       * Bis 1.55.2 stand hier `steps: 15`, gleichgültig wie hoch das Haus
       * ist. Bei 3,05 m von Fußboden zu Fußboden sind das 20,3 cm Steigung —
       * über dem Höchstmaß der DIN 18065, und zwar bei einer Treppe, die das
       * Programm selbst gerade eingesetzt hat. `treppenmasse` teilt die
       * wirkliche Höhe; die Lauflänge folgt aus den Auftritten und passt
       * damit zur Stufenzahl statt daneben zu liegen.
       */
      const doc0 = get().doc;
      const basis = levelBaseHeights(Object.values(doc0.levels));
      const eigen = basis.get(doc0.activeLevelId) ?? 0;
      const oben = [...basis.values()].filter((b) => b > eigen + 1e-6).sort((a, b) => a - b)[0];
      const masse = oben !== undefined ? treppenmasse(oben - eigen) : undefined;
      const element: VerticalElement = {
        id: uid('v'),
        kind,
        name: isStair ? 'Treppe' : 'Schacht',
        levelId: doc0.activeLevelId,
        position: { x: roundMm(position.x), y: roundMm(position.y) },
        // Vorgabe nach DIN 18065: 1,00 m Laufbreite. Ohne Geschoss darüber
        // bleibt es beim Regellauf mit 15 Steigungen auf 3,60 m.
        width: isStair ? 1 : 0.4,
        length: isStair ? roundMm(masse?.laufLaenge ?? 3.6) : 0.6,
        rotation: 0,
        steps: isStair ? (masse?.steigungen ?? 15) : undefined,
        service: isStair ? undefined : 'mixed',
        deductsArea: true,
        openToAbove: isStair,
      };
      mutate((doc) => {
        doc.verticals[element.id] = element;
      });
      set({
        selection: { kind: 'vertical', id: element.id },
        selections: [{ kind: 'vertical', id: element.id }],
        statusMessage: `${VERTICAL_LABELS[kind]} eingesetzt`,
      });
      return element;
    },

    updateVertical: (id, patch) =>
      mutate((doc) => {
        const v = doc.verticals[id];
        if (!v) return;
        doc.verticals[id] = { ...v, ...patch };
      }),

    /**
     * Setzt ein massives Bauteil.
     *
     * Die Vorgabemaße sind Erfahrungswerte des Wohnungsbaus, keine Normwerte:
     * ein einzügiger Schornstein misst mit Mantelstein rund 0,40 × 0,40 m, ein
     * Mauerwerkspfeiler entspricht der halben Steinlänge zuzüglich Fugen
     * (0,365 m), ein Wandversatz ist so tief wie eine Wand stark. Alle drei
     * sind überschreibbar.
     *
     * `throughAllLevels` ist nur beim Schornstein gesetzt: er beginnt am
     * Feuerraum und geht bis übers Dach. Pfeiler und Versatz gehören zu genau
     * einem Geschoss — beim Übernehmen eines Geschosses ist das der
     * Unterschied zwischen „wird mitkopiert" und „gibt es weiterhin einmal".
     */
    addSolid: (kind, position) => {
      const masse: Record<SolidKind, { width: number; length: number }> = {
        chimney: { width: 0.4, length: 0.4 },
        pier: { width: 0.365, length: 0.365 },
        'wall-offset': { width: 0.24, length: 1 },
        'service-block': { width: 0.3, length: 0.6 },
      };
      const element: SolidElement = {
        id: uid('m'),
        kind,
        name: SOLID_LABELS[kind],
        levelId: get().doc.activeLevelId,
        position: { x: roundMm(position.x), y: roundMm(position.y) },
        width: masse[kind].width,
        length: masse[kind].length,
        rotation: 0,
        throughAllLevels: kind === 'chimney',
      };
      mutate((doc) => {
        if (!doc.solids) doc.solids = {};
        doc.solids[element.id] = element;
      });
      set({
        selection: { kind: 'solid', id: element.id },
        selections: [{ kind: 'solid', id: element.id }],
        statusMessage: `${SOLID_LABELS[kind]} eingesetzt`,
      });
      return element;
    },

    solidFromRoom: (roomId, kind) => {
      const room = get().doc.rooms[roomId];
      if (!room || room.innerPolygon.length < 3) return null;

      // Der Umriss ist die lichte Raumfläche, nicht die Achsfläche: massiv ist
      // das Mauerwerk zwischen den Wänden, und genau das ist das Innenpolygon.
      const outline = room.innerPolygon.map((p) => ({ x: roundMm(p.x), y: roundMm(p.y) }));
      const xs = outline.map((p) => p.x);
      const ys = outline.map((p) => p.y);
      const element: SolidElement = {
        id: uid('m'),
        kind,
        name: SOLID_LABELS[kind],
        levelId: room.levelId,
        position: { x: roundMm(room.centroid.x), y: roundMm(room.centroid.y) },
        width: Math.max(0.05, Math.max(...ys) - Math.min(...ys)),
        length: Math.max(0.05, Math.max(...xs) - Math.min(...xs)),
        rotation: 0,
        outline,
        throughAllLevels: kind === 'chimney',
      };
      mutate((doc) => {
        if (!doc.solids) doc.solids = {};
        doc.solids[element.id] = element;
      });
      set({
        selection: { kind: 'solid', id: element.id },
        selections: [{ kind: 'solid', id: element.id }],
        statusMessage: `${room.name} ist jetzt ${SOLID_LABELS[kind]}`,
      });
      return element;
    },

    updateSolid: (id, patch) =>
      mutate((doc) => {
        const b = (doc.solids ?? {})[id];
        if (!b || !doc.solids) return;
        doc.solids[id] = { ...b, ...patch };
      }),

    /**
     * Einen Durchbruch setzen.
     *
     * Die Maße kommen aus dem Regelmaßkatalog und nicht aus einer Tabelle an
     * dieser Stelle — dieselbe Entscheidung wie bei Fenstern und Türen, und
     * aus demselben Grund: wer andere Bohrkronen vorhält, tauscht den Katalog
     * und nicht diese Funktion.
     *
     * Der Name ist das Regelmaß, nicht die Art: „Kernbohrung Ø 152 (DN 100)"
     * sagt in der Bauteilliste mehr als „Kernbohrung 3".
     */
    addDurchbruch: (preset, ziel) => {
      const wandgebunden = durchbruchWirt(preset.kind) === 'wand';
      if (wandgebunden && !('wallId' in ziel)) {
        set({ statusMessage: 'Ein Wanddurchbruch braucht eine Wand — näher an eine Wand tippen.' });
        return null;
      }
      const element: Durchbruch = {
        id: uid('db'),
        kind: preset.kind,
        name: preset.label,
        levelId: get().doc.activeLevelId,
        form: preset.form,
        diameter: preset.diameter,
        width: preset.width,
        height: preset.height,
        service: preset.service,
        dn: preset.dn,
        brandschutz: 'keine',
      };
      if ('wallId' in ziel) {
        element.wallId = ziel.wallId;
        element.distance = roundMm(ziel.distance);
        element.sillHeight = preset.sillHeight ?? 0.3;
      } else {
        element.position = { x: roundMm(ziel.position.x), y: roundMm(ziel.position.y) };
        element.rotation = 0;
      }
      mutate((doc) => {
        if (!doc.durchbrueche) doc.durchbrueche = {};
        doc.durchbrueche[element.id] = element;
      });
      set({
        selection: { kind: 'durchbruch', id: element.id },
        selections: [{ kind: 'durchbruch', id: element.id }],
        statusMessage: `${preset.label} gesetzt`,
      });
      return element;
    },

    updateDurchbruch: (id, patch) =>
      mutate((doc) => {
        const db = (doc.durchbrueche ?? {})[id];
        if (!db || !doc.durchbrueche) return;
        const neu: Durchbruch = { ...db, ...patch };
        // Millimeter, nicht Mikrometer: alles, was hier gerundet wird, ist ein
        // Maß, nach dem jemand anreißt.
        if (neu.distance !== undefined) neu.distance = roundMm(neu.distance);
        if (neu.sillHeight !== undefined) neu.sillHeight = roundMm(neu.sillHeight);
        if (neu.diameter !== undefined) neu.diameter = roundMm(neu.diameter);
        if (neu.width !== undefined) neu.width = roundMm(neu.width);
        if (neu.height !== undefined) neu.height = roundMm(neu.height);
        if (neu.position) {
          neu.position = { x: roundMm(neu.position.x), y: roundMm(neu.position.y) };
        }
        doc.durchbrueche[id] = neu;
      }),

    legeRohrnetzAus: (mode, anordnung, optionen) => {
      let anzahlDurchbrueche = 0;
      let ohneRegelmass = 0;
      /*
       * --- Die Flächenheizung wird mit ausgelegt --------------------------
       *
       * **Was vorher fehlte.** Diese Aktion hat Trassen zu dem gelegt, was
       * dastand — und für ein Projekt mit Fußbodenheizung stand nichts da.
       * Die Kreise mussten vorher Raum für Raum über die TGA-Palette belegt
       * werden; wer das nicht wusste, bekam ein Rohrnetz für die Heizkörper
       * und sonst nichts. Damit fehlten auch die Rohrlängen, die Kreiszahl,
       * der Randdämmstreifen und die Verteilerabgänge — also alles, was eine
       * Flächenheizung ausmacht.
       *
       * **Nicht an der Verlegeart festgemacht.** In 1.65.0 lief dieser Teil
       * nur im Neubaumodus, mit der Begründung, „Sanierung" heiße
       * Sockelleistenkanal mit Heizkörpern. Das ist falsch und wurde sofort
       * gemeldet: Auch im Bestand wird eine Fußbodenheizung gelegt — bei
       * neuem Estrich, in Niedrigaufbauweise, im angebauten Bad —, und
       * **gemischte Systeme sind der Normalfall**. Die Verlegeart sagt, wie
       * die Verteilleitung läuft, nicht, welche Heizfläche im Raum liegt.
       * Steuern lässt es sich deshalb einzeln (`optionen.flaechenheizung`),
       * und die Vorgabe ist: ja.
       *
       * **Übergangen wird, was schon eine Heizfläche hat.** Zwei Heizflächen
       * mit verschiedenen Systemtemperaturen in einem Raum sind eine
       * Entscheidung, die niemandem stillschweigend untergeschoben wird
       * (siehe `layAllFloorLoops`). Genau daraus entsteht das gemischte
       * System von selbst: Wo ein Heizkörper hängt, bleibt er; der Rest
       * bekommt Fläche.
       */
      let fbhRaeume = 0;
      let fbhFlaeche = 0;
      let fbhVerteiler = 0;
      if (optionen?.flaechenheizung ?? true) {
        const geschosse = Object.values(get().doc.levels).sort((a, b) => a.order - b.order);
        for (const geschoss of geschosse) {
          const bericht = get().layAllFloorLoops(geschoss.id);
          fbhRaeume += bericht.laid.length;
          fbhFlaeche += bericht.laid.reduce((sum, r) => sum + r.area, 0);
          /*
           * Ohne Verteiler hängt eine Fußbodenheizung an nichts — die
           * Trassierung bricht dann mit genau dieser Meldung ab. Statt den
           * Anwender in eine Fehlermeldung laufen zu lassen, wird der
           * Verteiler dort gesetzt, wo er hingehört (siehe
           * `schlageVerteilerVor`); verschieben lässt er sich danach.
           */
          if (bericht.laid.length > 0 && !bericht.manifold) {
            const vorschlag = schlageVerteilerVor(get().doc, geschoss.id);
            if (vorschlag) {
              const gesetzt = get().addFixture('manifold', vorschlag.position, {
                levelId: vorschlag.levelId,
                roomId: vorschlag.roomId,
                label: `HKV ${geschoss.name}`,
              });
              if (gesetzt) fbhVerteiler += 1;
            }
          }
        }
      }

      const s = get();
      /*
       * Ausgelegt wird das **Gebäude**, nicht nur das sichtbare Geschoss.
       *
       * Steht der Speicher im Keller und hängen die Heizkörper darüber, gibt
       * es ohne Steigleitung gar keine Verbindung — gemeldet am 22.09.2026.
       * `planeGebaeudeNetz` findet das Quellgeschoss, setzt die Stränge und
       * rechnet von außen nach innen, damit jeder Strangabschnitt trägt, was
       * über ihm hängt. Gibt es nichts zu verbinden, ist das Ergebnis genau
       * die Auslegung des sichtbaren Geschosses wie zuvor.
       */
      const ergebnis = planeGebaeudeNetz(s.doc, {
        mode,
        levelId: s.doc.activeLevelId,
        /*
         * Vorlauf und Rücklauf werden hier **nicht** übergeben.
         *
         * Das Anlagenblatt ist nur die Untergrenze: Ein Heizkörperkreis
         * verlangt mindestens 50/40, und `planPipeNetwork` holt sich die
         * maßgebliche Temperatur über `systemtemperaturVon` aus demselben
         * Dokument, aus dem auch der Rohrnetzbericht sie nimmt. Bis 1.23.0
         * standen hier `plant.design.flowTemperature` und `.returnTemperature`
         * — an einem Heizkörperhaus mit 35/28 im Blatt legte die Trasse damit
         * mit 7 K statt 10 K Spreizung aus, also mit 43 % zu viel
         * Volumenstrom. Gemessen wanderten die Nennweiten dadurch eine bis
         * zwei Stufen zu hoch.
         */
        material: s.doc.plant?.design.material,
        anordnung,
      });

      /** Die Geschosse, die neu geplant wurden — nur dort wird ersetzt. */
      const geplant = new Set(ergebnis.geschosse.map((g) => g.levelId));

      mutate((doc) => {
        // Von Hand gezogene Leitungen bleiben; erzeugte werden ersetzt.
        const behalten = Object.values(doc.pipes ?? {}).filter(
          (r) => !(r.generated && geplant.has(r.levelId)),
        );
        doc.pipes = Object.fromEntries([
          ...behalten.map((r) => [r.id, r] as const),
          ...ergebnis.runs.map((r) => [r.id, r] as const),
        ]);
        const armaturen = Object.values(doc.pipeAccessories ?? {}).filter(
          (a) => !(a.generated && geplant.has(a.levelId)),
        );
        doc.pipeAccessories = Object.fromEntries([
          ...armaturen.map((a) => [a.id, a] as const),
          ...ergebnis.accessories.map((a) => [a.id, a] as const),
        ]);

        /*
         * --- Durchbrüche ----------------------------------------------------
         *
         * Jede Wand, die die Trasse kreuzt, braucht ein Loch. Das war bis
         * 1.25.0 eine Textnotiz im Bericht und sonst nichts: Der Rohbau bekam
         * eine Leitungsführung ohne Bohrungen, und gebohrt wurde, wenn der
         * Estrich lag.
         *
         * Gezählt wird gegen **alle** Leitungen dieses Geschosses, nicht nur
         * gegen die eben erzeugten — eine von Hand gezogene Leitung geht
         * genauso durch die Wand. Erzeugte Durchbrüche dieses Geschosses
         * werden dabei ersetzt, von Hand gesetzte bleiben stehen.
         */
        const eigene = Object.values(doc.durchbrueche ?? {}).filter(
          (d) => !(d.generated && geplant.has(d.levelId)),
        );
        const leitungen = Object.values(doc.pipes).filter((r) => geplant.has(r.levelId));
        const gebohrt = durchbruecheFuerTrassen(doc, leitungen, () => uid('db'));
        doc.durchbrueche = Object.fromEntries([
          ...eigene.map((d) => [d.id, d] as const),
          ...gebohrt.durchbrueche.map((d) => [d.id, d] as const),
        ]);
        anzahlDurchbrueche = gebohrt.durchbrueche.length;
        ohneRegelmass = gebohrt.ohneRegelmass;
      });

      const schwer = ergebnis.notes.find((n) => n.severity === 'error');
      if (ohneRegelmass > 0) {
        ergebnis.notes.push({
          severity: 'warn',
          text:
            `${ohneRegelmass} ${ohneRegelmass === 1 ? 'Wandquerung hat' : 'Wandquerungen haben'} kein Regelmaß im Katalog — ` +
            `dort ist von Hand ein Durchbruch zu setzen. Eine zu kleine Bohrung einzutragen wäre schlimmer als keine.`,
        });
      }
      /*
       * Der Auslegungsstand — für die Einbettung. Siehe `netzStand` oben und
       * `onNetzGelegt` in `lib/embedApi.ts`.
       */
      set({
        netzStand: {
          lauf: (get().netzStand?.lauf ?? 0) + 1,
          at: new Date().toISOString(),
          mode,
          anordnung: anordnung ?? 'baum',
          flaechenheizung: optionen?.flaechenheizung !== false,
          served: ergebnis.served,
          routeLength: Math.round(ergebnis.routeLength * 100) / 100,
          pipeLength: Math.round(ergebnis.pipeLength * 100) / 100,
          accessories: ergebnis.accessories.length,
          durchbrueche: anzahlDurchbrueche,
          geschosse: ergebnis.geschosse.length,
          straenge: ergebnis.straenge.length,
          flaechenraeume: fbhRaeume,
          ...(schwer ? { fehler: schwer.text } : {}),
        },
      });
      // Formteile des ganzen Netzes (seit 1.71.0, `lib/formteile.ts`).
      const ft = formteilSumme(
        formteile(Object.values(get().doc.pipes ?? {}), Object.values(get().doc.pipeAccessories ?? {})),
      );
      set({
        statusMessage: schwer
          ? schwer.text
          : `Rohrnetz ausgelegt — ${ergebnis.served} Verbraucher, ${dez(ergebnis.routeLength, 1)} m Trasse, ` +
            `${dez(ergebnis.pipeLength, 1)} m Rohr, ${ergebnis.accessories.length} Armaturen, ` +
            `${ft['bogen-90']} Bögen, ${ft['t-stueck']} T-Stücke, ${ft.reduzierung} Reduzierungen, ` +
            `${anzahlDurchbrueche} ${anzahlDurchbrueche === 1 ? 'Durchbruch' : 'Durchbrüche'}` +
            (ergebnis.geschosse.length > 1
              ? ` · ${ergebnis.geschosse.length} Geschosse, ${ergebnis.straenge.length} Steigleitung(en)`
              : '') +
            // Was die Flächenheizung beigetragen hat, steht vorne in der
            // Meldung — es ist das Auffälligste am Ergebnis.
            (fbhRaeume > 0
              ? ` · Fußbodenheizung in ${fbhRaeume} ${fbhRaeume === 1 ? 'Raum' : 'Räumen'} (${fbhFlaeche.toFixed(1).replace('.', ',')} m²)`
              : '') +
            // „Verteiler" ist Einzahl und Mehrzahl zugleich.
            (fbhVerteiler > 0 ? ` · ${fbhVerteiler} Verteiler gesetzt` : ''),
      });
      return ergebnis;
    },

    addPipe: (service, points) => {
      if (points.length < 2) return null;
      const run: PipeRun = {
        id: uid('p'),
        levelId: get().doc.activeLevelId,
        service,
        points: points.map((p) => ({ x: roundMm(p.x), y: roundMm(p.y) })),
        nominalDiameter: service.startsWith('ventilation') ? 125 : service === 'waste' ? 100 : 20,
        insulation: service === 'heating-flow' || service === 'heating-return' || service === 'hot-water' ? 20 : 0,
        elevation: service === 'waste' ? -0.1 : 0.05,
      };

      /*
       * Doppelleitung: ein Zug, zwei Rohre.
       *
       * Der Partner entsteht durch Parallelverschiebung um denselben
       * `PAARABSTAND`, den die automatische Auslegung benutzt — die beiden
       * Wege dürfen nicht verschiedene Abstände haben, sonst liegt eine von
       * Hand gezogene Trasse anders im Kanal als eine ausgelegte. Verschoben
       * wird um den halben Abstand nach jeder Seite, damit der gezeichnete
       * Zug die **Mitte** des Paares bleibt: Wer an einer Wand entlangzeichnet,
       * meint die Trasse, nicht den Vorlauf.
       *
       * Nur für die Heizung. Ein Abwasserrohr hat keinen Rücklauf, und ein
       * stillschweigend verdoppelter Zuluftkanal wäre ein Fehler, den man
       * erst im Massenauszug fände.
       */
      const paarbar = service === 'heating-flow' || service === 'heating-return';
      /*
       * Die Trassenlänge **vor** der Paarbildung merken.
       *
       * `bildePaar` versetzt den übergebenen Zug an Ort und Stelle nach
       * links; danach ist seine Länge nicht mehr die der gezeichneten
       * Trasse, sondern die des inneren Rohrs. An einer rechtwinkligen Ecke
       * sind das 50 mm Unterschied — und die Meldung sagte „7,95 m Trasse",
       * wo der Anwender 8,00 m gezogen hatte. Eine Zahl, die um fünf
       * Zentimeter neben dem liegt, was man gerade angerissen hat, ist
       * schlimmer als keine.
       */
      const trasse = rohrlaenge(run);
      const partner: PipeRun | null =
        paarbar && get().doppelleitung ? bildePaar(run, uid('p'), uid('pp')) : null;

      mutate((doc) => {
        doc.pipes[run.id] = run;
        if (partner) doc.pipes[partner.id] = partner;
      });
      /*
       * **Die wahre Länge in der Meldung, nicht die Trassenlänge.**
       *
       * `addPipe` legt einen waagerechten Abschnitt an, also sind beide
       * Zahlen hier meist gleich. Meist — nicht immer: Die begehbare Ansicht
       * legt den Abschnitt zuerst an und setzt die zweite Höhe unmittelbar
       * danach. In der Abnahme von 1.24.0 stand deshalb am Bildschirm
       * „0,02 m verlegt", während derselbe Strang im Export mit 2,40 m
       * geführt wurde — zwei Zahlen für dieselbe Leitung, im Abstand von
       * einer Sekunde. Gerechnet wird deshalb auch hier mit `rohrlaenge`.
       */
      const meter = (v: number): string => `${v.toFixed(2).replace('.', ',')} m`;
      set({
        selection: { kind: 'pipe', id: run.id },
        selections: partner
          ? [
              { kind: 'pipe', id: run.id },
              { kind: 'pipe', id: partner.id },
            ]
          : [{ kind: 'pipe', id: run.id }],
        statusMessage: partner
          ? `Doppelleitung ${rohrbezeichnung(run)} · ${meter(trasse)} Trasse · ` +
            `${meter(2 * trasse)} Rohr (Vor- und Rücklauf)`
          : `${PIPE_SERVICE_LABELS[service]} ${rohrbezeichnung(run)} · ${meter(trasse)} verlegt`,
      });
      return run;
    },
  };
}
