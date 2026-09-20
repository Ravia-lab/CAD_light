/**
 * PropertiesPanel — kontextsensitive Eigenschaften der Auswahl.
 * Zeigt genau das, was zum selektierten Objekt gehört; ohne Auswahl die
 * Gebäude-Kennwerte, die man beim Planen ständig im Blick haben will.
 */

import type {
  Annotation,
  AnnotationAnchor,
  BimDocument,
  BoundaryCondition,
  DoorType,
  Fixture,
  FixtureType,
  Opening,
  PassageType,
  PipeAccessory,
  PipeRun,
  PipeService,
  RadiatorConnection,
  VentilSeite,
  RoofOpening,
  Room,
  ShaftService,
  Brandschutzklasse,
  Durchbruch,
  DurchbruchKind,
  VerticalElement,
  VerticalKind,
  SolidElement,
  SolidKind,
  RoomUsage,
  Wall,
  WallType,
  WindowType,
} from '../types/bim';
import {
  ANNOTATION_LABELS,
  ANNOTATION_QUELLE_LABELS,
  BOUNDARY_LABELS,
  FIXTURE_BY_TYPE,
  LEISTUNG_HERKUNFT_LABELS,
  leistungNachziehbar,
  PIPE_SERVICE_LABELS,
  RADIATOR_CONNECTION_LABELS,
  ROOF_OPENING_LABELS,
  SHAFT_SERVICE_LABELS,
  SOLID_LABELS,
  VENTILSEITE_LABELS,
  VERTICAL_LABELS,
  WALL_THICKNESS_PRESETS,
  BRANDSCHUTZ_LABELS,
  DURCHBRUCH_LABELS,
  durchbruchWirt,
} from '../types/bim';
import { useMemo, useRef } from 'react';
import { kompassRose, nordabweichungAus } from '../lib/kompass';
import { ACCESSORY_LABELS } from '../lib/pipeAccessorySymbols';
import { beschriftungVeraltet, hoehenText, modellwert, planText } from '../lib/beschriftung3d';
import { FIXTURE_COLORS } from '../lib/fixtureSymbols';
import { BELAG_WIDERSTAND, BODENBELAEGE } from '../lib/bodenbelag';
import { distanceToSegment, pointInPolygon, polygonArea, polygonPerimeter } from '../lib/geometry';
import { annotationLength } from '../lib/annotationSymbols';
import { defaultGableRise } from '../lib/roofGeometry';
import { solidFootprint, stairRunLength } from '../lib/verticalSymbols';
import { rohrbezeichnungLang } from '../lib/rohrbezeichnung';
import {
  durchbruchFlaeche,
  durchbruchMitte,
  durchbruchPasst,
} from '../lib/durchbruchSymbols';
import { getWallGeometry } from '../lib/wallGeometry';
import { tueranschlag } from '../lib/tuerseiten';
import { useBimStore } from '../store/useBimStore';
import Erklaerung from './Erklaerung';
import { buildRaviaExport } from '../lib/raviaExport';
import { heizflaechenbefundFuer, type Heizflaechenbefund } from '../lib/heizflaechenAbgleich';
import { uWertOeffnung, uWertWand, type UWertAuskunft } from '../lib/uwert';

const USAGE_LABELS: Record<RoomUsage, string> = {
  living: 'Wohnen',
  bedroom: 'Schlafen',
  kitchen: 'Küche',
  bath: 'Bad',
  wc: 'WC',
  hallway: 'Flur',
  office: 'Arbeiten',
  storage: 'Abstellen',
  technical: 'Technik',
  other: 'Sonstiges',
};

const WALL_TYPE_LABELS: Record<WallType, string> = {
  exterior: 'Außenwand',
  interior: 'Innenwand',
  partition: 'Trennwand',
  shaft: 'Schacht',
};

export default function PropertiesPanel() {
  const doc = useBimStore((s) => s.doc);
  const selection = useBimStore((s) => s.selection);

  if (!selection) return <BuildingSummary />;

  switch (selection.kind) {
    case 'wall': {
      const wall = doc.walls[selection.id];
      return wall ? <WallProperties wall={wall} /> : <BuildingSummary />;
    }
    case 'opening': {
      const opening = doc.openings[selection.id];
      return opening ? <OpeningProperties opening={opening} /> : <BuildingSummary />;
    }
    case 'room': {
      const room = doc.rooms[selection.id];
      return room ? <RoomProperties room={room} /> : <BuildingSummary />;
    }
    case 'fixture': {
      const fixture = doc.fixtures[selection.id];
      return fixture ? <FixtureProperties fixture={fixture} /> : <BuildingSummary />;
    }
    case 'vertical': {
      const v = doc.verticals?.[selection.id];
      return v ? <VerticalProperties element={v} /> : <BuildingSummary />;
    }
    case 'solid': {
      const b = doc.solids?.[selection.id];
      return b ? <SolidProperties element={b} /> : <BuildingSummary />;
    }
    case 'durchbruch': {
      const db = doc.durchbrueche?.[selection.id];
      return db ? <DurchbruchProperties element={db} /> : <BuildingSummary />;
    }
    case 'pipe': {
      const run = doc.pipes?.[selection.id];
      return run ? <PipeProperties run={run} /> : <BuildingSummary />;
    }
    case 'accessory': {
      const armatur = doc.pipeAccessories?.[selection.id];
      return armatur ? <AccessoryProperties armatur={armatur} /> : <BuildingSummary />;
    }
    case 'annotation': {
      const note = doc.annotations?.[selection.id];
      return note ? <AnnotationProperties note={note} /> : <BuildingSummary />;
    }
    case 'roofOpening': {
      const o = doc.roofOpenings?.[selection.id];
      return o ? <RoofOpeningProperties opening={o} /> : <BuildingSummary />;
    }
    case 'trace':
      return (
        <Section title="KI-Vorschlag">
          <p className="text-[11px] leading-relaxed text-slate-400">
            Ausgewählter Auto-Trace-Vektor. Über die Leiste am unteren Rand lässt er sich
            verwerfen oder wiederherstellen — übernommen wird er erst mit „Vorschlag übernehmen“.
          </p>
        </Section>
      );
    case 'image':
      return (
        <Section title="Referenzbild">
          <p className="text-[11px] leading-relaxed text-slate-400">
            Das Bild ist entsperrt und lässt sich mit gedrückter Maustaste verschieben.
            Nach dem Ausrichten wieder sperren, damit es beim Zeichnen an Ort und Stelle bleibt.
          </p>
        </Section>
      );
    default:
      return <BuildingSummary />;
  }
}

// ---------------------------------------------------------------------------

/**
 * Die drei Stufen, in denen dieses Panel Befunde einfärbt.
 * ---------------------------------------------------------------------------
 * Dieselben Klassen wie im Anlagenblatt und in der Prüfliste — bewusst
 * abgeschrieben und nicht importiert: Dort ist die Konstante privat, und sie
 * hier auszuleihen hieße, zwei Dateien aneinanderzubinden, die sonst nichts
 * miteinander zu tun haben. Wer die Farben ändert, ändert sie an beiden
 * Stellen; das ist der Preis, und er ist kleiner als eine neue Abhängigkeit
 * quer durch die Oberfläche.
 *
 * `info` ist kein Fehler, sondern eine Auskunft. `warn` heißt: hier steht eine
 * **Annahme**, keine Angabe. `error` heißt: hier steht gar nichts.
 */
const SEVERITY_STYLE = {
  error: 'border-l-2 border-rose-400/70 bg-rose-400/[0.07] text-rose-200',
  warn: 'border-l-2 border-amber-400/70 bg-amber-400/[0.07] text-amber-200',
  info: 'border-l-2 border-white/15 bg-white/[0.03] text-slate-400',
} as const;

/** Eine Zahl mit deutschem Dezimalkomma — „0,21" statt „0.21". */
function kommaZahl(wert: number, stellen: number): string {
  return wert.toFixed(stellen).replace('.', ',');
}

/** Eine Wattzahl mit Tausenderpunkt — „2.040 W" statt „2040 W". */
function watt(wert: number): string {
  return `${Math.round(wert).toLocaleString('de-DE')} W`;
}

/**
 * Was am Bauteil wirklich gerechnet wird — und woher es kommt.
 * ---------------------------------------------------------------------------
 * **Der Fehler, den diese Zeile beendet.** Das Eingabefeld daneben zeigte bis
 * 1.23.0 `wall.uValue ?? 0,24` beziehungsweise `opening.uValue ?? (Tür ? 1,6 :
 * 0,95)`. Das war ein **fünfter Vorgabekatalog** neben Export, Stückliste,
 * Heizlastüberschlag und Raumerkennung — und der einzige, der den
 * Bauteilaufbau nicht sah: Eine Wand mit zugewiesenem Aufbau „AW 36,5 + WDVS"
 * (U = 0,21) zeigte im Inspektor 0,24, während Export und Stückliste 0,21
 * druckten. Wer die Zahlen verglich, fand zwei verschiedene Häuser und keinen
 * Hinweis darauf, welches gilt.
 *
 * Schlimmer war die zweite Wirkung: Der Vorgabewert stand nicht nur da, er war
 * **bedienbar**. Ein Fingertipp ins Feld, und 0,24 wanderte als erfasster Wert
 * ins Modell — aus „nicht erfasst" wurde „erfasst als Vorgabewert", und die
 * Prüfung, die genau diese Lücke meldet, konnte nie wieder zutreffen.
 *
 * Deshalb gilt jetzt die Trennung: **Das Feld zeigt, was erfasst ist** (und
 * bleibt leer, wenn nichts erfasst ist). **Diese Zeile zeigt, was gerechnet
 * wird** — mit Herkunft, unbedienbar, und damit ohne die Möglichkeit, eine
 * Annahme versehentlich zur Angabe zu machen.
 */
function UWertBefund({
  auskunft,
  imFeld,
}: {
  auskunft: UWertAuskunft;
  /** Der am Bauteil erfasste Wert — also das, was im Feld daneben steht. */
  imFeld: number | undefined;
}) {
  const stil =
    auskunft.herkunft === 'fehlt'
      ? SEVERITY_STYLE.error
      : auskunft.herkunft === 'katalog'
        ? SEVERITY_STYLE.warn
        : SEVERITY_STYLE.info;

  let satz: string;
  switch (auskunft.herkunft) {
    case 'aufbau':
      satz =
        `Aus dem Aufbau ${auskunft.aufbau ? `„${auskunft.aufbau}“` : 'im Katalog'}. ` +
        'Der Aufbau schlägt den Wert am Bauteil — wer ihn im Katalog ändert, ändert alle ' +
        'Bauteile mit diesem Aufbau mit.';
      break;
    case 'bauteil':
      satz = 'Am Bauteil erfasst — die Zahl im Feld daneben ist maßgebend.';
      break;
    case 'katalog':
      satz =
        'Vorgabewert nach Bauteilart (angenommen). Er steht bewusst nicht im Modell: ' +
        'Eine angenommene Zahl einzutragen machte aus der Annahme eine Angabe, und die Prüfung ' +
        'könnte die Lücke nicht mehr melden. Sobald jemand eine Zahl einträgt oder einen Aufbau ' +
        'zuweist, gilt diese.';
      break;
    case 'fehlt':
      satz =
        'Nicht erfasst — und es gibt für diese Bauteilart keinen begründbaren Vorgabewert. ' +
        'Export und Stückliste drucken hier einen Strich und führen das Bauteil als Lücke.';
      break;
  }

  return (
    <div className={`rounded px-2.5 py-1.5 text-[10px] leading-relaxed ${stil}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="label-xs">Gerechnet wird</span>
        <span className="shrink-0 whitespace-nowrap font-mono text-[11px]">
          {auskunft.wert === undefined ? '—' : `${kommaZahl(auskunft.wert, 2)} W/m²K`}
        </span>
      </div>
      <p className="mt-0.5">{satz}</p>

      {/*
       * Der Widerspruch, den man sonst erst im gedruckten Plan bemerkt: Am
       * Bauteil steht eine Zahl, gerechnet und gedruckt wird aber die aus dem
       * Aufbau. Beides ist für sich richtig — nur muss man es sehen.
       */}
      {auskunft.herkunft === 'aufbau' &&
        auskunft.wert !== undefined &&
        imFeld !== undefined &&
        imFeld > 0 &&
        Math.abs(imFeld - auskunft.wert) > 1e-9 && (
          <p className="mt-1">
            Im Feld stehen {kommaZahl(imFeld, 2)} — gerechnet wird trotzdem{' '}
            {kommaZahl(auskunft.wert, 2)}. Wer den Wert am Bauteil gelten lassen will, muss dem
            Bauteil den Aufbau nehmen.
          </p>
        )}

      {/*
       * Eine 0 im Feld ist kein U-Wert, sondern ein nicht ausgefülltes oder
       * falsch ausgefülltes Feld: Ein Bauteil, das nichts durchlässt, gibt es
       * nicht. `istErfasst` in `uwert.ts` verwirft sie deshalb — und ohne
       * diesen Hinweis stünde die 0 sichtbar im Feld, während unbemerkt der
       * Vorgabewert gerechnet wird.
       */}
      {imFeld !== undefined && imFeld <= 0 && (
        <p className="mt-1">
          {kommaZahl(imFeld, 2)} im Feld gilt nicht als erfasst — ein Bauteil ohne
          Wärmedurchgang gibt es nicht. Feld leeren oder den wirklichen Wert eintragen.
        </p>
      )}
    </div>
  );
}

function WallProperties({ wall }: { wall: Wall }) {
  const updateWall = useBimStore((s) => s.updateWall);
  const nodes = useBimStore((s) => s.doc.nodes);
  // Der Katalog der Bauteilaufbauten — ohne ihn beantwortet `uWertWand` die
  // Frage nach dem U-Wert anders als Export und Stückliste, und genau diese
  // Abweichung war der Befund.
  const constructions = useBimStore((s) => s.doc.constructions);
  const a = nodes[wall.a];
  const b = nodes[wall.b];
  const length = a && b ? Math.hypot(b.x - a.x, b.y - a.y) : 0;
  const area = length * wall.height;
  const uWert = uWertWand(wall, constructions);

  return (
    <Section title="Wand">
      <Readout label="Länge" value={`${length.toFixed(3)} m`} />
      <Readout label="Ansichtsfläche" value={`${area.toFixed(2)} m²`} />

      <Field label="Wandstärke">
        <div className="flex gap-0.5 rounded-lg bg-graphite-900/60 p-0.5">
          {WALL_THICKNESS_PRESETS.map((t) => (
            <button
              key={t}
              className={`chip flex-1 ${
                Math.abs(wall.thickness - t) < 1e-6 ? 'bg-accent/15 text-accent' : 'text-slate-500 hover:text-slate-300'
              }`}
              onClick={() => updateWall(wall.id, { thickness: t })}
            >
              {(t * 100).toFixed(1)}
            </button>
          ))}
        </div>
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label="Höhe [m]"
          value={wall.height}
          step={0.05}
          onChange={(v) => updateWall(wall.id, { height: v })}
        />
        {/*
          * **Kein `?? 0,24` mehr.** Der Vorgabewert stand hier als bedienbare
          * Zahl im Feld: Ein Tipp hinein, und aus „nicht erfasst" wurde
          * „erfasst als 0,24" — unumkehrbar, weil die 0,24 danach von einem
          * abgelesenen Wert nicht mehr zu unterscheiden ist. Was gerechnet
          * wird, steht unter dem Feld; hier steht nur, was erfasst ist.
          */}
        <NumberField
          label="U-Wert [W/m²K]"
          term="u-wert"
          value={wall.uValue}
          step={0.01}
          platzhalter={uWert.wert !== undefined ? kommaZahl(uWert.wert, 2) : 'nicht erfasst'}
          onLeeren={() => updateWall(wall.id, { uValue: undefined })}
          onChange={(v) => updateWall(wall.id, { uValue: v })}
        />
      </div>

      <UWertBefund auskunft={uWert} imFeld={wall.uValue} />

      <Field label="Bauteiltyp">
        <select
          className="field"
          value={wall.type}
          onChange={(e) => updateWall(wall.id, { type: e.target.value as WallType })}
        >
          {(Object.keys(WALL_TYPE_LABELS) as WallType[]).map((t) => (
            <option key={t} value={t} className="bg-graphite-850">
              {WALL_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </Field>

      {/* Randbedingung: für Innenwände wird sie aus dem Nachbarraum abgeleitet.
          Übersteuern braucht man sie nur dort, wo die Geometrie es nicht hergibt
          — etwa bei einer Innenwand zur unbeheizten Garage. */}
      <Field label="Randbedingung">
        <select
          className="field"
          value={wall.boundary ?? 'auto'}
          onChange={(e) => {
            const value = e.target.value;
            updateWall(wall.id, {
              boundary: value === 'auto' ? undefined : (value as BoundaryCondition),
            });
          }}
        >
          <option value="auto" className="bg-graphite-850">
            Automatisch {wall.type === 'exterior' ? '(Außenluft)' : '(Nachbarraum / unbeheizt)'}
          </option>
          {(Object.keys(BOUNDARY_LABELS) as BoundaryCondition[]).map((b) => (
            <option key={b} value={b} className="bg-graphite-850">
              {BOUNDARY_LABELS[b]}
            </option>
          ))}
        </select>
      </Field>

      <NumberField
        label="Wärmebrücke ΔU_WB [W/m²K]"
        term="delta-u-wb"
        value={wall.thermalBridgeSupplement ?? useBimStore.getState().doc.meta.thermalBridgeSupplement}
        step={0.01}
        onChange={(v) => updateWall(wall.id, { thermalBridgeSupplement: Math.max(0, v) })}
      />

      {wall.confidence !== undefined && (
        <Readout label="KI-Konfidenz" value={`${Math.round(wall.confidence * 100)} %`} accent />
      )}
    </Section>
  );
}

const WINDOW_TYPE_LABELS: Record<WindowType, string> = {
  fixed: 'Fest',
  casement: 'Dreh',
  'tilt-turn': 'Dreh-Kipp',
  double: '2-flügelig',
  french: 'Fenstertür',
  ribbon: 'Bandfenster',
};

const DOOR_TYPE_LABELS: Record<DoorType, string> = {
  single: '1-flügelig',
  double: '2-flügelig',
  sliding: 'Schiebetür',
  folding: 'Falttür',
  revolving: 'Pendeltür',
};

const PASSAGE_TYPE_LABELS: Record<PassageType, string> = {
  open: 'Raumhoch',
  lintel: 'Mit Sturz',
  arch: 'Rundbogen',
};

function OpeningProperties({ opening }: { opening: Opening }) {
  const updateOpening = useBimStore((s) => s.updateOpening);
  const constructions = useBimStore((s) => s.doc.constructions);
  const isDoor = opening.kind === 'door';
  const isPassage = opening.kind === 'passage';
  const title = isPassage ? 'Durchgang' : isDoor ? 'Tür' : 'Fenster';
  // Dieselbe Auskunft, die Export und Stückliste benutzen — Aufbau vor
  // Bauteilwert vor Vorgabewert. Der Durchgang wird darin als Loch behandelt
  // und braucht deshalb gar keine Zeile (siehe unten).
  const uWert = uWertOeffnung(opening, constructions);

  return (
    <Section title={title}>
      <Readout label="Rohbauöffnung" value={`${(opening.width * opening.height).toFixed(2)} m²`} />

      {/* Bauart — steuert Symbol im Plan und Ausbildung im Modell */}
      {opening.kind === 'window' && (
        <Field label="Fenstertyp">
          <select
            className="field"
            value={opening.windowType ?? 'casement'}
            onChange={(e) => {
              const windowType = e.target.value as WindowType;
              const panels = windowType === 'double' ? 2 : windowType === 'ribbon' ? 3 : 1;
              // Eine Fenstertür ist bodentief — die Brüstung muss mitgehen,
              // sonst steht im Modell Glas vor einer Brüstungsmauer.
              const sillHeight = windowType === 'french' ? 0 : opening.sillHeight || 0.9;
              updateOpening(opening.id, { windowType, panels, sillHeight });
            }}
          >
            {(Object.keys(WINDOW_TYPE_LABELS) as WindowType[]).map((t) => (
              <option key={t} value={t} className="bg-graphite-850">
                {WINDOW_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </Field>
      )}

      {isDoor && (
        <Field label="Türtyp">
          <select
            className="field"
            value={opening.doorType ?? 'single'}
            onChange={(e) => updateOpening(opening.id, { doorType: e.target.value as DoorType })}
          >
            {(Object.keys(DOOR_TYPE_LABELS) as DoorType[]).map((t) => (
              <option key={t} value={t} className="bg-graphite-850">
                {DOOR_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </Field>
      )}

      {isPassage && (
        <Field label="Ausbildung">
          <select
            className="field"
            value={opening.passageType ?? 'lintel'}
            onChange={(e) => updateOpening(opening.id, { passageType: e.target.value as PassageType })}
          >
            {(Object.keys(PASSAGE_TYPE_LABELS) as PassageType[]).map((t) => (
              <option key={t} value={t} className="bg-graphite-850">
                {PASSAGE_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </Field>
      )}

      {opening.kind === 'window' && (opening.panels ?? 1) > 1 && (
        <NumberField
          label="Flügel / Felder"
          value={opening.panels ?? 1}
          step={1}
          onChange={(v) => updateOpening(opening.id, { panels: Math.max(1, Math.round(v)) })}
        />
      )}

      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label="Breite [m]"
          value={opening.width}
          step={0.005}
          onChange={(v) => updateOpening(opening.id, { width: Math.max(0.3, v) })}
        />
        <NumberField
          label="Höhe [m]"
          value={opening.height}
          step={0.005}
          onChange={(v) => updateOpening(opening.id, { height: Math.max(0.3, v) })}
        />
        <NumberField
          label="Brüstung [m]"
          value={opening.sillHeight}
          step={0.05}
          onChange={(v) => updateOpening(opening.id, { sillHeight: Math.max(0, v) })}
        />
        {/*
          * **Kein `?? (Tür ? 1,6 : 0,95)` mehr** — derselbe Grund wie an der
          * Wand: Der Vorgabewert war bedienbar und wurde beim ersten Antippen
          * zur erfassten Angabe. Ein Fenster mit zugewiesenem Aufbau
          * „Fenster 3-fach" zeigte hier außerdem 0,95, während im Plan 0,90
          * stand.
          */}
        {!isPassage && (
          <NumberField
            label="U-Wert"
            term="u-wert"
            value={opening.uValue}
            step={0.05}
            platzhalter={uWert.wert !== undefined ? kommaZahl(uWert.wert, 2) : 'nicht erfasst'}
            onLeeren={() => updateOpening(opening.id, { uValue: undefined })}
            onChange={(v) => updateOpening(opening.id, { uValue: v })}
          />
        )}
      </div>

      {!isPassage && <UWertBefund auskunft={uWert} imFeld={opening.uValue} />}

      {isPassage && (
        <p className="text-[10px] leading-relaxed text-slate-600">
          Ein Durchgang ist keine Bauteilfläche: er wird in der Heizlast nur als
          Loch von der Wandfläche abgezogen und bekommt keinen U-Wert.
        </p>
      )}

      {opening.kind === 'window' && (
        <NumberField
          label="g-Wert (Energiedurchlass)"
          term="g-wert"
          value={opening.gValue ?? 0.6}
          step={0.05}
          onChange={(v) => updateOpening(opening.id, { gValue: v })}
        />
      )}

      {isDoor && !['sliding', 'folding'].includes(opening.doorType ?? 'single') && (
        <Tueranschlagfeld opening={opening} />
      )}
    </Section>
  );
}

/**
 * Anschlag und Öffnungsrichtung einer Tür — benannt, nicht gespiegelt.
 *
 * **Was hier anders ist als vorher.** Die Öffnungsrichtung hing an einem
 * Knopf „Öffnungsrichtung spiegeln": ein Verb ohne Zustand. Man sah ihm nicht
 * an, wohin die Tür gerade aufgeht, und auf dem Tablet liegt der Inspektor
 * als Schublade über dem Plan — man sah es auch nach dem Drücken nicht.
 *
 * Jetzt stehen dort zwei Knöpfe mit den Namen der beiden Seiten, gerechnet
 * aus der Geometrie (`tuerseiten.ts`): bei einer Innentür die Raumnamen, bei
 * einer Außentür „innen" und „außen". Der aktive ist hervorgehoben — damit
 * beantwortet die Oberfläche die Frage „wohin geht sie auf" schon im
 * Ruhezustand, ohne dass jemand etwas drücken muss.
 *
 * Darunter die Bezeichnung nach DIN 107, die aus Bandseite **und**
 * Öffnungsrichtung zusammen folgt. Sie ist das, was auf dem Aufmaßzettel
 * steht und was beim Türenhändler bestellt wird; ausrechnen kann sie das
 * Programm, im Kopf tut es niemand gern.
 *
 * Jede Änderung schreibt zusätzlich einen Satz in die Statuszeile. Das ist
 * kein Beiwerk: Es ist auf dem Tablet der einzige Ort, an dem man das
 * Ergebnis sieht, solange die Schublade den Plan verdeckt.
 */
function Tueranschlagfeld({ opening }: { opening: Opening }) {
  const updateOpening = useBimStore((s) => s.updateOpening);
  const setStatus = useBimStore((s) => s.setStatus);
  const wall = useBimStore((s) => s.doc.walls[opening.wallId]);
  const nodes = useBimStore((s) => s.doc.nodes);
  const rooms = useBimStore((s) => s.doc.rooms);

  const anschlag = useMemo(
    () => (wall ? tueranschlag(opening, wall, nodes, Object.values(rooms)) : null),
    [opening, wall, nodes, rooms],
  );

  const setzeRichtung = (seite: 'plus' | 'minus') => {
    const flip = seite === 'minus';
    if ((opening.flipSwing ?? false) === flip) return;
    updateOpening(opening.id, { flipSwing: flip });
    if (anschlag) {
      const ziel = seite === 'plus' ? anschlag.beschriftung.plus : anschlag.beschriftung.minus;
      // Die DIN-Bezeichnung kippt mit der Richtung — deshalb hier neu
      // gebildet und nicht aus `anschlag.satz` übernommen.
      const din = (opening.hinge === 'right') === (seite === 'plus') ? 'links' : 'rechts';
      setStatus(`Tür öffnet nach ${ziel} · DIN ${din}`);
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-2 gap-1.5">
        <button
          className={`chip ${opening.hinge !== 'right' ? 'bg-accent/15 text-accent' : 'bg-white/[0.04] text-slate-500'}`}
          onClick={() => updateOpening(opening.id, { hinge: 'left' })}
        >
          Band links
        </button>
        <button
          className={`chip ${opening.hinge === 'right' ? 'bg-accent/15 text-accent' : 'bg-white/[0.04] text-slate-500'}`}
          onClick={() => updateOpening(opening.id, { hinge: 'right' })}
        >
          Band rechts
        </button>
      </div>

      {anschlag && (
        <>
          <div className="grid grid-cols-2 gap-1.5">
            {(['plus', 'minus'] as const).map((seite) => (
              <button
                key={seite}
                className={`chip ${
                  anschlag.oeffnetNach === seite
                    ? 'bg-accent/15 text-accent'
                    : 'bg-white/[0.04] text-slate-500'
                }`}
                onClick={() => setzeRichtung(seite)}
              >
                öffnet nach {seite === 'plus' ? anschlag.beschriftung.plus : anschlag.beschriftung.minus}
              </button>
            ))}
          </div>
          <div className="rounded-md bg-graphite-900/60 px-2.5 py-1.5 text-[10.5px] leading-snug text-slate-400">
            <span className="text-slate-200">{anschlag.satz}</span>
            <span className="block text-slate-600">
              Bezeichnung nach DIN 107 — von der Seite aus, zu der die Tür aufgeht.
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function RoomProperties({ room }: { room: Room }) {
  const updateRoom = useBimStore((s) => s.updateRoom);
  const duplicateRoom = useBimStore((s) => s.duplicateRoom);
  const copyRoom = useBimStore((s) => s.copyRoom);
  const solidFromRoom = useBimStore((s) => s.solidFromRoom);
  const level = useBimStore((s) => s.doc.levels[room.levelId]);
  const windowArea = room.boundaries.reduce((sum, b) => sum + b.openingArea, 0);

  return (
    <Section title="Raum">
      <Field label="Bezeichnung">
        <input
          className="field"
          value={room.name}
          onChange={(e) => updateRoom(room.id, { name: e.target.value })}
        />
      </Field>

      <Field label="Nutzung">
        <select
          className="field"
          value={room.usage}
          onChange={(e) => updateRoom(room.id, { usage: e.target.value as RoomUsage })}
        >
          {(Object.keys(USAGE_LABELS) as RoomUsage[]).map((u) => (
            <option key={u} value={u} className="bg-graphite-850">
              {USAGE_LABELS[u]}
            </option>
          ))}
        </select>
      </Field>

      {/*
        Der Bodenbelag gehört zum Raum, nicht zum Heizkreis.

        Er entscheidet über den Belagswiderstand einer Flächenheizung — und
        er steht im Massenauszug. Beides gilt auch für einen Raum ohne
        Fußbodenheizung, deshalb steht die Auswahl hier und nicht nur am
        Heizkreis. „—" heißt: nichts erfasst, und das ist etwas anderes als
        „ohne Belag".
      */}
      <Field label="Bodenbelag">
        <select
          className="field"
          value={room.floorCovering ?? ''}
          onChange={(e) => updateRoom(room.id, { floorCovering: e.target.value || undefined })}
        >
          <option value="" className="bg-graphite-850">
            — nicht erfasst —
          </option>
          {BODENBELAEGE.map((b) => (
            <option key={b.id} value={b.id} className="bg-graphite-850">
              {b.name} · R {b.wert.toFixed(2).replace('.', ',')} m²K/W
            </option>
          ))}
        </select>
      </Field>

      <div className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-lg bg-graphite-900/60 px-2.5 py-2">
        <Readout label="Fläche" value={`${room.area.toFixed(2)} m²`} accent />
        <Readout label="Volumen" value={`${room.volume.toFixed(2)} m³`} />
        <Readout label="Umfang" value={`${room.perimeter.toFixed(2)} m`} />
        <Readout label="Höhe" value={`${room.height.toFixed(2)} m`} />
        <Readout label="Öffnungen" value={`${windowArea.toFixed(2)} m²`} />
        <Readout label="Wände" value={String(room.boundaries.length)} />
      </div>

      {/*
        Ein Raum ist im Modell kein eigenes Objekt, sondern das Ergebnis
        seiner Wände. „Kopieren" heißt deshalb: Wände, Öffnungen und die
        TGA-Objekte darin. Trennwände, die zu zwei Räumen gehören, kommen
        mit — der Nachbar behält seine eigenen.
      */}
      <div className="flex gap-1.5">
        <button
          className="chip flex-1 bg-white/[0.04] hover:bg-white/[0.08]"
          title="Legt eine Kopie daneben — Wände, Öffnungen und TGA-Objekte des Raums"
          onClick={() => duplicateRoom(room.id)}
        >
          Raum duplizieren
        </button>
        <button
          className="chip flex-1 bg-white/[0.04] hover:bg-white/[0.08]"
          title="Legt den Raum in die Zwischenablage — Einfügen mit Strg+V, auch in einem anderen Geschoss"
          onClick={() => copyRoom(room.id)}
        >
          In Zwischenablage
        </button>
      </div>

      {/*
        Nicht jede umschlossene Fläche ist ein Raum. Zwischen vier Wandstücken
        kann auch der Kaminzug stehen, ein Mauerwerkspfeiler oder ein
        zugemauerter Schacht. Dann wird aus der Fläche ein massives Bauteil:
        derselbe Umriss, aber Mauerwerk — im Plan schraffiert, in der Fläche
        abgezogen, im Export unter `solids`.
      */}
      <div>
        <span className="label-xs mb-1 block">Fläche ist kein Raum, sondern massiv</span>
        <div className="flex flex-wrap gap-0.5 rounded-lg bg-graphite-900/60 p-0.5">
          {(['chimney', 'pier', 'wall-offset', 'service-block'] as SolidKind[]).map((k) => (
            <button
              key={k}
              className="chip flex-1 whitespace-nowrap text-slate-500 hover:text-slate-200"
              title={`${room.name} als ${SOLID_LABELS[k]} darstellen`}
              onClick={() => solidFromRoom(room.id, k)}
            >
              {SOLID_LABELS[k].replace(' / Schornstein', '')}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label="Solltemp. [°C]"
          value={room.setpointTemperature}
          step={0.5}
          onChange={(v) => updateRoom(room.id, { setpointTemperature: v })}
        />
        <NumberField
          label="Luftwechsel n [1/h]"
          term="n-min"
          value={room.airChangeRate}
          step={0.1}
          onChange={(v) => updateRoom(room.id, { airChangeRate: v })}
        />
      </div>

      <button
        className={`chip w-full ${room.isHeated ? 'bg-accent/15 text-accent' : 'bg-white/[0.04] text-slate-500'}`}
        onClick={() => updateRoom(room.id, { isHeated: !room.isHeated })}
      >
        {room.isHeated ? 'Beheizter Raum' : 'Unbeheizt — geht als Nachbarbereich ein'}
      </button>

      {/* Boden und Decke: Vorgabe kommt vom Geschoss, hier raumweise übersteuerbar */}
      <div className="rounded-lg bg-graphite-900/60 px-2.5 py-2">
        <div className="label-xs mb-1.5">Boden und Decke</div>
        <div className="grid grid-cols-2 gap-2">
          <SlabControls
            title="Boundary Boden"
            uValue={room.floorUValue}
            boundary={room.floorBoundary}
            fallbackU={level?.floorUValue ?? 0.3}
            fallbackBoundary={level?.floorBoundary ?? 'ground'}
            onChange={(patch) => updateRoom(room.id, { floorUValue: patch.uValue, floorBoundary: patch.boundary })}
          />
          <SlabControls
            title="Boundary Decke"
            uValue={room.ceilingUValue}
            boundary={room.ceilingBoundary}
            fallbackU={level?.ceilingUValue ?? 0.2}
            fallbackBoundary={level?.ceilingBoundary ?? 'unheated'}
            onChange={(patch) =>
              updateRoom(room.id, { ceilingUValue: patch.uValue, ceilingBoundary: patch.boundary })
            }
          />
        </div>
      </div>

      {/* Abgeleitete Kennwerte, die direkt in die Norm eingehen */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-lg bg-graphite-900/60 px-2.5 py-2">
        <Readout term="b-strich" label="Erdkontakt-Umfang" value={`${room.groundContactPerimeter.toFixed(2)} m`} />
        <Readout
          label="B′"
          term="b-strich"
          value={
            room.groundContactPerimeter > 0
              ? `${(room.area / (0.5 * room.groundContactPerimeter)).toFixed(2)} m`
              : '—'
          }
        />
        <Readout label="Außenfassaden" value={String(room.exposedFacadeCount)} />
        <Readout label="Mindestluftstrom" value={`${(room.volume * room.airChangeRate).toFixed(0)} m³/h`} />
      </div>

      {/* Orientierungen — die für die Heizlast entscheidende Information */}
      <div>
        <div className="label-xs mb-1.5">Wandabschnitte</div>
        <div className="space-y-0.5">
          {room.boundaries.map((b, i) => (
            <div key={`${b.wallId}-${i}`} className="flex items-center gap-2 rounded px-1.5 py-1 text-[10px] hover:bg-white/[0.03]">
              <span className={`w-6 font-mono ${b.boundary === 'exterior' ? 'text-accent' : 'text-slate-600'}`}>
                {b.orientation}
              </span>
              <span className="w-16 truncate text-slate-500" title={BOUNDARY_LABELS[b.boundary]}>
                {BOUNDARY_LABELS[b.boundary]}
              </span>
              <span className="flex-1 text-right font-mono text-slate-400">{b.length.toFixed(2)} m</span>
              <span className="font-mono text-slate-500">{b.netArea.toFixed(2)} m²</span>
              {b.openingArea > 0 && (
                <span className="font-mono text-accent-teal">−{b.openingArea.toFixed(2)}</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}

/** Eigenschaften eines platzierten TGA-Objekts. */
/**
 * Die Bauarten, an denen „Leistung / Bauart / Vorlauf / Rücklauf" etwas
 * bedeuten.
 * ---------------------------------------------------------------------------
 * **Warum eine Typliste und nicht `category === 'heating'`.** Die Kategorie
 * fasst alles zusammen, was zur Heizung gehört — auch den Speicher, den
 * Heizkreisverteiler, den Steigstrang und den Raumthermostat. Für einen Puffer
 * ist „Leistung [W]" schlicht falsch: Er erzeugt keine Wärme, er hält sie
 * vorrätig; die Leistung gehört an den Erzeuger. Das Feld stand trotzdem an
 * ihm, zeigte „0 W", und ein Fingertipp hinein schrieb `powerW: 0` an ein
 * Objekt, das nie eine Leistung haben wird. Dieselbe Null, die im Rechenkern
 * gerade abgeschafft wurde, entstand hier neu — und zwar an einer Stelle, an
 * der niemand nach ihr sucht.
 *
 * **Was die Einschränkung kostet — nachgezählt, Bauart für Bauart:**
 *
 *   • `storage` verliert Leistung, Bauart, Vorlauf und Rücklauf. Genau so
 *     gewollt; sein Block „Aufstellort" mit dem Inhalt bleibt.
 *   • `manifold`, `riser-heating`, `thermostat` tragen im Katalog `params: {}`
 *     — an ihnen stand nie ein erfasster Wert, sondern immer nur die
 *     Vorbelegung der Felder selbst (0 W, 55 °C, 45 °C). Es geht also nichts
 *     verloren; es hört nur auf, welche zu erfinden.
 *   • `boiler` ist der eine Fall, in dem etwas verlorenginge: Er trägt im
 *     Katalog 15 000 W, und beim Wärmeerzeuger ist eine Leistung richtig. Er
 *     bekommt sie deshalb unten in einem eigenen Block zurück — ohne Vorlauf
 *     und Rücklauf, denn die legt die Anlage fest und nicht der Aufstellort.
 *
 * `underfloor` steht bewusst mit in der Liste, obwohl `istHeizflaeche` in
 * `heizflaechenLeistung.ts` es ausschließt. Die beiden Listen beantworten
 * verschiedene Fragen: dort „lässt sich diese Bauart über DIN EN 442-2 auf den
 * Normpunkt umrechnen" (ein Fußbodenheizkreis nicht — für ihn gilt
 * DIN EN 1264-2), hier „hat diese Bauart eine Leistung, die man erfassen
 * kann". Ein Heizkreis hat eine, und sie steht im Export.
 */
const HEIZFLAECHEN_TYPEN: readonly FixtureType[] = [
  'radiator',
  'radiator-tube',
  'convector',
  'underfloor',
];

/**
 * Woher die Leistung dieser Heizfläche stammt — und was das bedeutet.
 * ---------------------------------------------------------------------------
 * **Warum diese Zeile nötig ist.** Das Programm zieht abgeleitete Leistungen
 * automatisch nach, eingetragene nie. Ob die Zahl im Feld also beim nächsten
 * Rechenlauf noch dieselbe ist, hängt einzig an ihrer Herkunft — und die stand
 * bisher nur im Datensatz, nirgends auf dem Bildschirm. Wer 1.400 W aus einem
 * Datenblatt eintrug, konnte nicht sehen, dass sie bleiben; wer eine
 * Katalogvorbelegung von 1.200 W vor sich hatte, konnte nicht sehen, dass sie
 * verschwinden.
 *
 * **Und der zweite Zweck:** Eine eingetragene Leistung, die kleiner ist als
 * die nötige, ist kein Fehler des Anwenders und keine Warnung des Programms —
 * sie ist das Ergebnis, wegen dessen saniert wird. Deshalb steht hier
 * „Vorhanden …, nötig … — die Heizfläche deckt die Raumheizlast nicht" und
 * nicht „falsche Eingabe".
 */
function LeistungBefund({ fixture, befund }: { fixture: Fixture; befund?: Heizflaechenbefund }) {
  const leistung = fixture.params.powerW;
  /*
   * Fehlt die Herkunft, gilt die Leistung als **eingetragen** — nicht als
   * Katalogwert. Dieselbe Festlegung wie in `FixtureParams.powerSource`:
   * Projekte aus älteren Fassungen führen das Feld nicht, und in ihnen hat der
   * Anwender die Zahlen tatsächlich gepflegt. Sie im Nachhinein für
   * überschreibbar zu erklären, wäre der eine Fehler, den man hier nicht
   * machen darf.
   */
  const herkunft = fixture.params.powerSource ?? 'datenblatt';
  const nachziehbar = leistungNachziehbar(fixture.params.powerSource);
  const unterdeckt = befund?.ist !== undefined && befund.ist < befund.soll;

  const kopf = (titel: string, wert: string) => (
    <div className="flex items-baseline justify-between gap-2">
      <span className="label-xs shrink-0">{titel}</span>
      <span className="min-w-0 text-right text-[10.5px] leading-snug">{wert}</span>
    </div>
  );

  /*
   * Noch nichts erfasst. Der Vorschlag steht als Platzhalter im Feld — er ist
   * sichtbar, aber er ist kein Wert: Im Modell steht weiterhin nichts, und die
   * Prüfung führt die Heizfläche weiter als Lücke. Genau dieser Unterschied
   * ging verloren, solange das Feld „0 W" zeigte.
   */
  if (leistung === undefined) {
    return (
      <div
        className={`rounded px-2.5 py-1.5 text-[10px] leading-relaxed ${
          befund ? SEVERITY_STYLE.info : SEVERITY_STYLE.warn
        }`}
      >
        {kopf('Leistung', 'noch nicht erfasst')}
        {befund ? (
          <>
            <p className="mt-0.5">
              Vorgeschlagen sind {watt(befund.soll)}. Der Vorschlag steht nur als Platzhalter im
              Feld, nicht im Modell — eingetragen wird er erst, wenn ihn jemand übernimmt oder das
              Programm ihn nachzieht.
            </p>
            <p className="mt-1 opacity-80">{befund.begruendung}</p>
          </>
        ) : fixture.type === 'underfloor' ? (
          /*
           * Der Fußbodenheizkreis bekommt bewusst keinen Vorschlag aus der
           * Raumheizlast: Seine Leistung folgt dem Kennfeld nach DIN EN 1264-2
           * (Verlegeabstand, Estrichüberdeckung, Belagswiderstand) und nicht
           * der Umrechnung auf den Normpunkt nach DIN EN 442-2 — deshalb
           * schließt ihn `istHeizflaeche` in `heizflaechenLeistung.ts` aus.
           * Den allgemeinen Satz „lässt sich nichts ableiten" hier stehen zu
           * lassen wäre eine falsche Begründung für ein richtiges Ergebnis.
           */
          <p className="mt-0.5">
            Für einen Heizkreis schlägt das Programm hier nichts vor: Seine Leistung folgt dem
            Kennfeld nach DIN EN 1264-2 und entsteht beim Belegen der Raumfläche, nicht aus der
            Umrechnung auf den Normpunkt. Ein leeres Feld ist die richtige Auskunft — 0 W wäre ein
            Heizkreis, der nicht heizt.
          </p>
        ) : (
          <p className="mt-0.5">
            Aus der Raumheizlast lässt sich hier nichts ableiten — dem Raum fehlt die Heizlast, oder
            das Objekt liegt in keinem erkannten Raum. Ein leeres Feld ist trotzdem die richtige
            Auskunft: 0 W wäre eine Heizfläche, die nicht heizt.
          </p>
        )}
      </div>
    );
  }

  const schluss = nachziehbar
    ? 'Diese Zahl zieht das Programm selbst nach. Sobald jemand sie von Hand ändert, gilt sie als eingetragen und bleibt stehen.'
    : unterdeckt
      ? 'Die Zahl bleibt stehen: Sie beschreibt den vorhandenen Heizkörper. Der Widerspruch zur Heizlast ist kein Eingabefehler, sondern der Befund, wegen dessen saniert wird.'
      : herkunft === 'ravia'
        ? 'Gerechnet wurde in RaVia, nicht hier. Das Programm überschreibt die Zahl nicht.'
        : 'Eingetragene Leistungen zieht das Programm nie nach — sie beschreiben das vorhandene Gerät.';

  return (
    <div
      className={`rounded px-2.5 py-1.5 text-[10px] leading-relaxed ${
        unterdeckt || herkunft === 'katalog' ? SEVERITY_STYLE.warn : SEVERITY_STYLE.info
      }`}
    >
      {kopf('Herkunft', LEISTUNG_HERKUNFT_LABELS[herkunft])}

      {befund?.ist !== undefined && (
        <p className="mt-0.5">
          Vorhanden {watt(befund.ist)}, nötig {watt(befund.soll)} —{' '}
          {befund.ist < befund.soll
            ? 'die Heizfläche deckt die Raumheizlast nicht.'
            : 'die Heizfläche ist größer als nötig.'}
        </p>
      )}

      {/*
       * Die Begründung steht im Befund und wird hier nur weitergereicht.
       * Sie hier ein zweites Mal auszurechnen hieße, eine zweite Antwort auf
       * dieselbe Frage zu führen — Systemtemperatur, Lastaufteilung und
       * Exponent würden dann irgendwann auseinanderlaufen, und niemand
       * bemerkte, welche der beiden Zahlen im Heft steht.
       */}
      {befund && <p className="mt-1 opacity-80">{befund.begruendung}</p>}

      <p className="mt-1">{schluss}</p>
    </div>
  );
}

function FixtureProperties({ fixture }: { fixture: Fixture }) {
  const updateFixture = useBimStore((s) => s.updateFixture);
  const rooms = useBimStore((s) => s.doc.rooms);
  const doc = useBimStore((s) => s.doc);
  const def = FIXTURE_BY_TYPE[fixture.type];
  const room = fixture.roomId ? rooms[fixture.roomId] : undefined;
  const color = FIXTURE_COLORS[fixture.category];
  const zeigtHeizflaeche = HEIZFLAECHEN_TYPEN.includes(fixture.type);

  /*
   * Der Abgleich gegen die Raumheizlast — nur für die Bauarten, die einen
   * haben können.
   *
   * `heizflaechenBefunde` rechnet die Heizlast **aller** Räume neu. Das ist
   * nicht gratis, und das Panel zeichnet bei jeder Eingabe im Dokument neu.
   * Deshalb zwei Bremsen: die Typprüfung davor (an einem Waschtisch gibt es
   * nichts abzugleichen) und `useMemo` auf das Dokument — so kostet ein
   * Wechsel der Auswahl oder ein Neuzeichnen aus anderem Anlass nichts.
   *
   * Ein Befund entsteht nur bei einer Abweichung über zwei Prozent. Kein
   * Befund heißt also entweder „passt" oder „lässt sich nicht vergleichen";
   * `LeistungBefund` formuliert beides so, dass es nicht verwechselt werden
   * kann.
   */
  /*
   * **Der Einzelabruf, nicht die gefilterte Gesamtliste.**
   *
   * `heizflaechenBefunde` unterdrückt Abweichungen unter zwei Prozent, weil
   * es entscheidet, *ob nachgezogen wird*. Der Inspektor stellt die andere
   * Frage — *warum steht diese Zahl da* —, und für eine gerade nachgezogene
   * Leistung ist die Abweichung null. Über die Gesamtliste gefiltert fehlte
   * die Begründung also ausgerechnet bei den Zahlen, die das Programm selbst
   * gesetzt hat. Nebenbei spart der Einzelabruf den Durchlauf über alle
   * Räume, und der hängt hier an jeder Auswahl.
   */
  const befund = useMemo(
    () => (zeigtHeizflaeche ? heizflaechenbefundFuer(doc, fixture.id) : undefined),
    [doc, fixture.id, zeigtHeizflaeche],
  );

  return (
    <Section title="TGA-Objekt">
      <div className="flex items-center gap-2 rounded-lg bg-graphite-900/60 px-2.5 py-2">
        <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: color }} />
        <span className="text-[11px] text-slate-200">{fixture.label ?? def?.label ?? fixture.type}</span>
      </div>

      <Field label="Bezeichnung">
        <input
          className="field"
          value={fixture.label ?? ''}
          onChange={(e) => updateFixture(fixture.id, { label: e.target.value })}
        />
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label="Baulänge [m]"
          value={fixture.length}
          step={0.05}
          onChange={(v) => updateFixture(fixture.id, { length: Math.max(0.05, v) })}
        />
        <NumberField
          label="Bautiefe [m]"
          value={fixture.depth}
          step={0.01}
          onChange={(v) => updateFixture(fixture.id, { depth: Math.max(0.02, v) })}
        />
        <NumberField
          label="Drehung [°]"
          value={fixture.rotation}
          step={15}
          onChange={(v) => updateFixture(fixture.id, { rotation: v })}
        />
        <NumberField
          label="Montagehöhe [m]"
          value={fixture.elevation}
          step={0.05}
          onChange={(v) => updateFixture(fixture.id, { elevation: Math.max(0, v) })}
        />
      </div>

      {/*
       * Gewerkespezifische Kennwerte — genau die, die im Export landen.
       *
       * Die Bedingung fragt die **Bauart** ab und nicht mehr die Kategorie;
       * warum, steht bei `HEIZFLAECHEN_TYPEN`.
       */}
      {zeigtHeizflaeche && (
        <div className="space-y-2">
          {/*
           * **Das Feld darf leer bleiben — darum geht es hier.**
           *
           * `value={fixture.params.powerW ?? 0}` zeigte an einem nie erfassten
           * Heizkörper „0 W". Wer das Feld dann auch nur anfasste, schrieb
           * `powerW: 0` ins Modell: Aus „nicht erfasst" wurde „erfasst als
           * 0 W", und das ist nicht umkehrbar — die Prüfung „Heizfläche ohne
           * Leistung" trifft danach nie wieder zu, der Abgleich hält 0 W für
           * eine Angabe, und im Heft steht eine Heizfläche, die nicht heizt.
           *
           * Jetzt: leer heißt leer. Geleert wird zu `undefined`, und die
           * Herkunft geht mit — eine Herkunft ohne Wert beschriebe nichts.
           */}
          <NumberField
            label="Leistung [W]"
            value={fixture.params.powerW}
            step={50}
            platzhalter={
              befund && fixture.params.powerW === undefined
                ? `aus der Raumheizlast: ${watt(befund.soll)}`
                : 'nicht erfasst'
            }
            onLeeren={() =>
              updateFixture(fixture.id, {
                params: { ...fixture.params, powerW: undefined, powerSource: undefined },
              })
            }
            /*
             * Eine 0 oder eine negative Zahl ist keine Leistung, sondern ein
             * leeres Feld mit einem Tastendruck darin. Sie wird deshalb wie
             * „geleert" behandelt statt als `Math.max(0, v)` ins Modell
             * geschrieben — genau dieses `Math.max` war der alte Weg, auf dem
             * die 0 hineinkam.
             */
            onChange={(v) =>
              updateFixture(fixture.id, {
                params:
                  v > 0
                    ? { ...fixture.params, powerW: v }
                    : { ...fixture.params, powerW: undefined, powerSource: undefined },
              })
            }
          />

          <LeistungBefund fixture={fixture} befund={befund} />

          <Field label="Bauart">
            <input
              className="field"
              value={fixture.params.radiatorType ?? ''}
              onChange={(e) =>
                updateFixture(fixture.id, { params: { ...fixture.params, radiatorType: e.target.value } })
              }
            />
          </Field>

          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label="Vorlauf [°C]"
              value={fixture.params.flowTemperature ?? 55}
              step={1}
              onChange={(v) => updateFixture(fixture.id, { params: { ...fixture.params, flowTemperature: v } })}
            />
            <NumberField
              label="Rücklauf [°C]"
              value={fixture.params.returnTemperature ?? 45}
              step={1}
              onChange={(v) => updateFixture(fixture.id, { params: { ...fixture.params, returnTemperature: v } })}
            />
          </div>
        </div>
      )}

      {/*
       * Der Wärmeerzeuger behält seine Leistung — er ist der eine Fall, dem
       * die Einschränkung oben etwas wegnähme, das er zu Recht zeigt: Im
       * Katalog steht er mit 15 kW, und beim Erzeuger *ist* eine Leistung
       * richtig. Vorlauf und Rücklauf bekommt er nicht zurück; die legt die
       * Anlage fest (`PlantDefinition`), nicht der Aufstellort — dieselbe
       * Trennung wie beim Speicher darunter.
       */}
      {fixture.type === 'boiler' && (
        <div className="space-y-2 rounded-lg border border-white/[0.07] bg-white/[0.02] p-2.5">
          <div className="label-xs">Aufstellort</div>
          <NumberField
            label="Nennwärmeleistung [W]"
            value={fixture.params.powerW}
            step={500}
            platzhalter="nicht erfasst"
            onLeeren={() =>
              updateFixture(fixture.id, {
                params: { ...fixture.params, powerW: undefined, powerSource: undefined },
              })
            }
            onChange={(v) =>
              updateFixture(fixture.id, {
                params:
                  v > 0
                    ? { ...fixture.params, powerW: v }
                    : { ...fixture.params, powerW: undefined, powerSource: undefined },
              })
            }
          />
          <p className="text-[10px] leading-relaxed text-slate-600">
            Die Zahl beschreibt das Gerät, das hier steht. Ausgelegt wird der Erzeuger in der
            Anlage — dort steht die maßgebende Leistung. Leer heißt „noch nicht erfasst"; eine 0
            behauptete einen Erzeuger, der nichts erzeugt.
          </p>
        </div>
      )}

      {/*
       * Die Angaben, ohne die der Rechenkern nicht auslegen kann.
       *
       * `powerW` oben ist die Normleistung bei 55/45/20 °C. Eine Wärmepumpe
       * fährt 35/28 — und ohne den **Exponenten n** aus dem Datenblatt lässt
       * sich die eine Zahl nicht in die andere umrechnen (DIN EN 442-2). Das
       * war der eine harte Blocker der Übergabe an RaVia; deshalb steht das
       * Feld hier und nicht in einem Untermenü.
       *
       * Der Röhrenradiator gehört in dieselbe Bedingung: er ist ein Heizkörper
       * wie Platte und Konvektor, hat denselben Exponenten aus dem Datenblatt
       * und dieselbe Anbindung. Solange er hier fehlte, ließ sich an einem
       * Röhrenradiator weder n noch Anschlussart noch Ventilseite eintragen —
       * der Export gab für ihn stillschweigend den Richtwert aus.
       */}
      {fixture.category === 'heating' &&
        (fixture.type === 'radiator' || fixture.type === 'radiator-tube' || fixture.type === 'convector') && (
        <div className="space-y-2 rounded-lg border border-white/[0.07] bg-white/[0.02] p-2.5">
          <div className="label-xs">Fürs Auslegen</div>
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label="Exponent n [-]"
              value={fixture.params.radiatorExponent ?? 1.3}
              step={0.01}
              onChange={(v) =>
                updateFixture(fixture.id, {
                  params: { ...fixture.params, radiatorExponent: Math.min(1.6, Math.max(1, v)) },
                })
              }
            />
            <NumberField
              label="Bauhöhe [m]"
              value={fixture.params.radiatorHeight ?? 0.6}
              step={0.05}
              onChange={(v) =>
                updateFixture(fixture.id, { params: { ...fixture.params, radiatorHeight: Math.max(0.1, v) } })
              }
            />
          </div>
          <Field label="Anschlussart">
            <select
              className="field"
              value={fixture.params.radiatorConnection ?? 'wechselseitig'}
              onChange={(e) =>
                updateFixture(fixture.id, {
                  params: { ...fixture.params, radiatorConnection: e.target.value as RadiatorConnection },
                })
              }
            >
              {(Object.keys(RADIATOR_CONNECTION_LABELS) as RadiatorConnection[]).map((k) => (
                <option key={k} value={k} className="bg-graphite-850">
                  {RADIATOR_CONNECTION_LABELS[k]}
                </option>
              ))}
            </select>
          </Field>

          {/*
           * Ventilseite — und der leere Eintrag ist der wichtige.
           *
           * `valveSide` ist optional, und „nicht erfasst" ist ein eigener
           * Zustand, nicht etwa eine verkappte Vorgabe „rechts". Würde die
           * Liste beim Fehlen der Angabe einfach auf „rechts" springen, hätte
           * jeder Heizkörper, den nie jemand angeschaut hat, eine Ventilseite
           * im Plan stehen — der Monteur bindet danach an, der Estrich ist zu,
           * und das Ventil sitzt auf der anderen Seite. Deshalb bleibt die
           * Auswahl leer, bis jemand sich festlegt, und der Hinweistext sagt
           * ausdrücklich, dass leer nichts behauptet.
           *
           * Der leere String ist nur die Darstellung im <select>; ins Modell
           * geht `undefined`, damit Export und Prüfung die Lücke sehen.
           */}
          <Field label="Ventilseite">
            <select
              className="field"
              value={fixture.params.valveSide ?? ''}
              onChange={(e) => {
                const wert = e.target.value;
                updateFixture(fixture.id, {
                  params: {
                    ...fixture.params,
                    valveSide: wert === '' ? undefined : (wert as VentilSeite),
                  },
                });
              }}
            >
              <option value="" className="bg-graphite-850">
                — nicht erfasst
              </option>
              {(Object.keys(VENTILSEITE_LABELS) as VentilSeite[]).map((s) => (
                <option key={s} value={s} className="bg-graphite-850">
                  {VENTILSEITE_LABELS[s]}
                </option>
              ))}
            </select>
          </Field>
          <p className="text-[10px] leading-relaxed text-slate-600">
            Links und rechts gelten <em>von vorn auf den Heizkörper gesehen, aus dem Raum</em>. Ohne
            diese Festlegung heißt „links“ bei zwei Leuten zweierlei.{' '}
            {fixture.params.valveSide === undefined
              ? 'Solange hier „nicht erfasst“ steht, behauptet der Plan keine Seite — das ist etwas anderes als „rechts“.'
              : 'Gerechnet wird damit nichts; die Angabe geht in Plan, Massenauszug und Export, damit die Anbindung auf der richtigen Seite hochkommt.'}
          </p>

          <p className="text-[10px] leading-relaxed text-slate-600">
            {fixture.params.radiatorExponent === undefined ? (
              <>
                Solange n nicht eingetragen ist, geht der Richtwert{' '}
                {fixture.type === 'convector' ? '1,40' : '1,30'} in den Export — ausdrücklich als Annahme. Der
                wirkliche Wert steht im Datenblatt des Heizkörpers.
              </>
            ) : (
              <>
                n aus dem Datenblatt. Damit rechnet der Rechenkern die Normleistung (55/45/20&nbsp;°C) auf den
                Betriebspunkt der Wärmepumpe um.
              </>
            )}
          </p>
        </div>
      )}

      {/*
       * Speicher: hier steht der **Aufstellort**, nicht die Auslegung.
       *
       * Ausgelegt wird der Speicher in der Anlage (`PlantDefinition.storages`)
       * — dort hängen Bedarf, Schichtung und Erzeuger zusammen, und dort steht
       * die maßgebende Zahl. Der Grundriss beantwortet die andere Frage: *wo*
       * steht er, und passt er da hin. Der Inhalt steht trotzdem hier, weil
       * die Stellfläche vom Volumen abhängt und man im Raum eine Zahl sehen
       * will — ein 800-l-Speicher geht nicht in die Nische, in die ein
       * 300-l-Speicher passt.
       *
       * Weichen Aufstellort und Auslegung voneinander ab, ist das kein Fehler
       * dieses Feldes, sondern eine Meldung der Prüfung: maßgebend bleibt die
       * Anlage.
       */}
      {fixture.type === 'storage' && (
        <div className="space-y-2 rounded-lg border border-white/[0.07] bg-white/[0.02] p-2.5">
          <div className="label-xs">Aufstellort</div>
          {/*
           * Dieselbe 0-Falle wie bei der Leistung: „0 l" ist kein Speicher,
           * sondern ein nicht ausgefülltes Feld — und `Math.max(0, …)` war der
           * Weg, auf dem die 0 ins Modell kam.
           */}
          <NumberField
            label="Inhalt [l]"
            value={fixture.params.volumeL}
            step={50}
            platzhalter="nicht erfasst"
            onLeeren={() => updateFixture(fixture.id, { params: { ...fixture.params, volumeL: undefined } })}
            onChange={(v) =>
              updateFixture(fixture.id, {
                params: { ...fixture.params, volumeL: v > 0 ? Math.round(v) : undefined },
              })
            }
          />
          <p className="text-[10px] leading-relaxed text-slate-600">
            Der Inhalt beschreibt, was hier im Raum steht, und bestimmt die Stellfläche. Ausgelegt
            wird der Speicher in der Anlage — dort steht die maßgebende Zahl. Weicht beides ab,
            meldet es die Prüfung, statt eine der beiden Zahlen stillschweigend zu überschreiben.
          </p>
        </div>
      )}

      {/*
       * Das Kennfeld nach DIN EN 1264-2 hängt an drei Eingängen:
       * Verlegeabstand, Estrichüberdeckung und Belagswiderstand R_λB. Zwei
       * davon standen im Export, der dritte nicht — und derselbe Kreis trägt
       * unter Fliesen rund ein Drittel mehr als unter Teppich.
       */}
      {fixture.type === 'underfloor' && (
        <div className="space-y-2 rounded-lg border border-white/[0.07] bg-white/[0.02] p-2.5">
          <div className="label-xs">Fürs Auslegen (DIN EN 1264-2)</div>
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label="Estrichüberdeckung [m]"
              value={fixture.params.screedCover ?? 0.045}
              step={0.005}
              onChange={(v) =>
                updateFixture(fixture.id, { params: { ...fixture.params, screedCover: Math.max(0.01, v) } })
              }
            />
            <NumberField
              label="Rohr außen [m]"
              value={fixture.params.pipeOuterDiameter ?? 0.017}
              step={0.001}
              onChange={(v) =>
                updateFixture(fixture.id, { params: { ...fixture.params, pipeOuterDiameter: Math.max(0.005, v) } })
              }
            />
          </div>
          <Field label="Bodenbelag">
            <select
              className="field"
              value={String(fixture.params.floorCoveringResistance ?? '')}
              onChange={(e) =>
                updateFixture(fixture.id, {
                  params: {
                    ...fixture.params,
                    floorCoveringResistance: e.target.value === '' ? undefined : Number(e.target.value),
                  },
                })
              }
            >
              <option value="">— noch nicht festgelegt</option>
              {BELAG_WIDERSTAND.map((b) => (
                <option key={b.wert} value={b.wert}>
                  {b.name} — R_λB {b.wert.toFixed(2).replace('.', ',')}
                </option>
              ))}
            </select>
          </Field>
          <p className="text-[10px] leading-relaxed text-slate-600">
            Der Belag entscheidet mit, wie viel der Kreis trägt: unter Fliesen rund ein Drittel mehr als unter
            Teppich. Solange er nicht feststeht, bleibt das Feld leer und der Export sagt, dass er fehlt — das ist
            ehrlicher, als eine Zahl zu setzen, die niemand gewählt hat.
          </p>
        </div>
      )}

      {fixture.category === 'ventilation' && (
        /* Dieselbe 0-Falle: Ein Ventil mit 0 m³/h ist kein erfasster Wert,
           sondern ein Ventil, nach dem noch niemand gefragt hat. */
        <NumberField
          label="Volumenstrom [m³/h]"
          value={fixture.params.airflow}
          step={5}
          platzhalter="nicht erfasst"
          onLeeren={() => updateFixture(fixture.id, { params: { ...fixture.params, airflow: undefined } })}
          onChange={(v) =>
            updateFixture(fixture.id, { params: { ...fixture.params, airflow: v > 0 ? v : undefined } })
          }
        />
      )}

      {fixture.category === 'sanitary' && (
        <>
          <Field label="Anschluss">
            <input
              className="field"
              value={fixture.params.connection ?? ''}
              onChange={(e) =>
                updateFixture(fixture.id, { params: { ...fixture.params, connection: e.target.value } })
              }
            />
          </Field>
          <button
            className={`chip w-full ${
              fixture.params.hotWater ? 'bg-accent/15 text-accent' : 'bg-white/[0.04] text-slate-500'
            }`}
            onClick={() =>
              updateFixture(fixture.id, { params: { ...fixture.params, hotWater: !fixture.params.hotWater } })
            }
          >
            {fixture.params.hotWater ? 'Mit Warmwasser' : 'Nur Kaltwasser'}
          </button>
        </>
      )}

      <div className="rounded-lg bg-graphite-900/60 px-2.5 py-2">
        <Readout label="Raum" value={room?.name ?? '— nicht zugeordnet'} accent={Boolean(room)} />
        <Readout label="Wandgebunden" value={fixture.wallId ? 'ja' : 'frei stehend'} />
        <Readout
          label="Position"
          value={`${fixture.position.x.toFixed(2)} / ${fixture.position.y.toFixed(2)}`}
        />
      </div>

      {!room && (
        <p className="text-[10px] leading-relaxed text-slate-600">
          Das Objekt liegt in keinem erkannten Raum und taucht deshalb in keiner
          Raumauswertung auf. Sobald der umgebende Raum geschlossen ist, wird es
          automatisch zugeordnet.
        </p>
      )}
    </Section>
  );
}

/**
 * Treppe oder Schacht. Die beiden wichtigsten Schalter sind unten: ob die
 * Fläche abgezogen wird und ob die Decke darüber fehlt. Genau daran hängt,
 * ob die Heizlast stimmt.
 */
/**
 * Eigenschaften eines massiven Bauteils.
 *
 * Die Leiste zeigt zwei Dinge, die man einem Rechteck im Plan nicht ansieht:
 * ob es durch alle Geschosse geht — daran hängt, ob es beim Übernehmen eines
 * Geschosses mitkopiert wird — und wie viel Fläche und Luftvolumen es dem Raum
 * nimmt. Die Wärmebrücke wird nur benannt, nicht gerechnet: ihr ψ-Wert hängt
 * an Aufbau, Zug und Dämmung und gehört in die Heizlastrechnung, nicht hierher.
 */
function SolidProperties({ element }: { element: SolidElement }) {
  const update = useBimStore((s) => s.updateSolid);
  const levels = useBimStore((s) => s.doc.levels);
  const rooms = useBimStore((s) => s.doc.rooms);
  const walls = useBimStore((s) => s.doc.walls);
  const nodes = useBimStore((s) => s.doc.nodes);

  const level = levels[element.levelId];
  const outline = solidFootprint(element);
  const area = polygonArea(outline);
  const height = element.height ?? level?.height ?? 2.75;
  const frei = element.outline !== undefined && element.outline.length >= 3;

  const room = Object.values(rooms).find(
    (r) => r.levelId === element.levelId && r.innerPolygon.length >= 3 && pointInPolygon(element.position, r.innerPolygon),
  );

  // Berührt das Bauteil eine Außenwand? Dieselbe Frage und dieselbe Toleranz
  // wie im Export — hier nur als Hinweis, dort als Zahl für die Gegenstelle.
  const anAussenwand = Object.values(walls).some((w) => {
    if (w.levelId !== element.levelId || w.type !== 'exterior') return false;
    const a = nodes[w.a];
    const b = nodes[w.b];
    if (!a || !b) return false;
    return outline.some((p) => Math.abs(distanceToSegment(p, a, b) - w.thickness / 2) <= 0.06);
  });

  return (
    <div className="space-y-3 p-3">
      <Section title={SOLID_LABELS[element.kind]}>
        <label className="block">
          <span className="label-xs mb-1 block">Bezeichnung</span>
          <input
            className="field"
            value={element.name}
            onChange={(e) => update(element.id, { name: e.target.value })}
          />
        </label>

        <div>
          <span className="label-xs mb-1 block">Art</span>
          <div className="flex flex-wrap gap-0.5 rounded-lg bg-graphite-900/60 p-0.5">
            {(['chimney', 'pier', 'wall-offset', 'service-block'] as SolidKind[]).map((k) => (
              <button
                key={k}
                onClick={() => update(element.id, { kind: k })}
                title={SOLID_LABELS[k]}
                className={`chip flex-1 whitespace-nowrap ${
                  element.kind === k ? 'bg-accent/15 text-accent' : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {SOLID_LABELS[k].replace(' / Schornstein', '')}
              </button>
            ))}
          </div>
        </div>

        {frei ? (
          <p className="rounded-lg bg-graphite-900/60 px-2.5 py-2 text-[10px] leading-relaxed text-slate-400">
            Freier Grundriss mit {element.outline?.length} Punkten. Länge, Breite und Drehung sind
            dann ohne Wirkung — der Umriss gilt, wie er gezeichnet ist.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <NumberField
                label="Länge [m]"
                value={element.length}
                step={0.05}
                onChange={(v) => update(element.id, { length: Math.max(0.05, v) })}
              />
              <NumberField
                label="Breite [m]"
                value={element.width}
                step={0.05}
                onChange={(v) => update(element.id, { width: Math.max(0.05, v) })}
              />
            </div>
            <NumberField
              label="Drehung [°]"
              value={element.rotation}
              step={15}
              onChange={(v) => update(element.id, { rotation: v })}
            />
          </>
        )}

        <NumberField
          label="Höhe [m]"
          value={height}
          step={0.05}
          onChange={(v) => update(element.id, { height: Math.max(0.05, v) })}
        />

        <label className="block">
          <span className="label-xs mb-1 block">Baustoff</span>
          <input
            className="field"
            value={element.material ?? ''}
            placeholder="z. B. Schamotte mit Mantelstein"
            onChange={(e) => update(element.id, { material: e.target.value || undefined })}
          />
        </label>
      </Section>

      <Section title="Wirkung auf die Rechnung">
        <label className="flex cursor-pointer items-start gap-2 text-[11px] text-slate-300">
          <input
            type="checkbox"
            className="mt-0.5 accent-accent"
            checked={element.throughAllLevels}
            onChange={(e) => update(element.id, { throughAllLevels: e.target.checked })}
          />
          <span>
            Geht durch alle Geschosse darüber
            <span className="mt-0.5 block text-[9.5px] leading-relaxed text-slate-500">
              Beim Schornstein ja — er beginnt am Feuerraum und endet über Dach. Pfeiler und
              Versatz gehören zu einem Geschoss und werden beim Übernehmen mitkopiert.
            </span>
          </span>
        </label>

        <p className="text-[10px] leading-relaxed text-slate-500">
          Die Grundfläche zählt weder zur Raumfläche noch zum Luftvolumen — wie bei Treppe und
          Schacht. Die Decke darüber bleibt bestehen: dort steht Mauerwerk, kein Luftraum.
        </p>
      </Section>

      <Section title="Ergibt sich daraus">
        <Readout label="Grundfläche" value={`${area.toFixed(2)} m²`} accent />
        <Readout label="Umfang" value={`${polygonPerimeter(outline).toFixed(2)} m`} />
        <Readout label="Bauvolumen" value={`${(area * height).toFixed(2)} m³`} />
        <Readout label="Im Raum" value={room?.name ?? '—'} />
        <Readout label="An Außenwand" value={anAussenwand ? 'ja' : 'nein'} />
      </Section>

      {anAussenwand && (
        <p className="rounded-lg bg-orange-500/10 px-2.5 py-2 text-[10px] leading-relaxed text-orange-300">
          An der Außenwand ist dieses Bauteil eine Wärmebrücke. Gerechnet wird sie hier nicht — ihr
          ψ-Wert hängt an Aufbau, Zug und Dämmung. Der Export übergibt Berührungslänge und
          Wandkennung, damit die Heizlastrechnung sie ansetzen kann.
        </p>
      )}
    </div>
  );
}

/**
 * Die Eigenschaften eines Durchbruchs.
 *
 * Die Leiste ist danach geordnet, wonach auf der Baustelle gefragt wird: Wo?
 * Wie groß? Wie hoch? Und muss geschottet werden? Was sie **nicht** anbietet,
 * ist ein U-Wert — ein Durchbruch trägt keinen, und ein Feld dafür wäre eine
 * Einladung, eine Zahl zu erfinden.
 */
function DurchbruchProperties({ element }: { element: Durchbruch }) {
  const update = useBimStore((s) => s.updateDurchbruch);
  const doc = useBimStore((s) => s.doc);
  const levels = doc.levels;
  const level = levels[element.levelId];
  const wirt = durchbruchWirt(element.kind);
  const wand = element.wallId ? doc.walls[element.wallId] : undefined;
  const geometrie = wand ? getWallGeometry(wand, doc.nodes) : null;
  const urteil = durchbruchPasst(element, doc, wand?.height ?? level?.height ?? 2.75);
  const querschnitt = durchbruchFlaeche(element);
  const mitte = durchbruchMitte(element, doc);
  const rund = element.form === 'rund';

  return (
    <div className="space-y-3 p-3">
      <Section title={DURCHBRUCH_LABELS[element.kind]}>
        <label className="block">
          <span className="label-xs mb-1 block">Bezeichnung</span>
          <input
            className="field"
            value={element.name}
            onChange={(e) => update(element.id, { name: e.target.value })}
          />
        </label>

        <div>
          <span className="label-xs mb-1 block">Art</span>
          <div className="flex flex-wrap gap-0.5 rounded-lg bg-graphite-900/60 p-0.5">
            {(['kernbohrung', 'wanddurchbruch', 'schlitz', 'deckendurchbruch'] as DurchbruchKind[]).map(
              (k) => (
                <button
                  key={k}
                  onClick={() => update(element.id, { kind: k })}
                  title={DURCHBRUCH_LABELS[k]}
                  className={`chip flex-1 whitespace-nowrap ${
                    element.kind === k ? 'bg-accent/15 text-accent' : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {DURCHBRUCH_LABELS[k].replace('durchbruch', 'd.').replace('Wand', 'W.')}
                </button>
              ),
            )}
          </div>
        </div>

        <div>
          <span className="label-xs mb-1 block">Form</span>
          <div className="flex gap-0.5 rounded-lg bg-graphite-900/60 p-0.5">
            {(['rund', 'rechteckig'] as const).map((f) => (
              <button
                key={f}
                onClick={() =>
                  update(element.id, {
                    form: f,
                    // Beim Wechsel wird das fehlende Maß aus dem vorhandenen
                    // abgeleitet, statt auf null zu fallen: ein leeres
                    // Maßfeld ist schlimmer als ein ungefähres.
                    diameter:
                      f === 'rund'
                        ? (element.diameter ?? Math.min(element.width ?? 0.1, element.height ?? 0.1))
                        : element.diameter,
                    width: f === 'rechteckig' ? (element.width ?? element.diameter ?? 0.1) : element.width,
                    height: f === 'rechteckig' ? (element.height ?? element.diameter ?? 0.1) : element.height,
                  })
                }
                className={`chip flex-1 ${
                  element.form === f ? 'bg-accent/15 text-accent' : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {f === 'rund' ? 'rund' : 'rechteckig'}
              </button>
            ))}
          </div>
        </div>

        {rund ? (
          <NumberField
            label="Durchmesser [m]"
            value={element.diameter ?? 0}
            step={0.01}
            onChange={(v) => update(element.id, { diameter: Math.max(0.01, v) })}
          />
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label={wirt === 'wand' ? 'Breite [m]' : 'Maß x [m]'}
              value={element.width ?? 0}
              step={0.01}
              onChange={(v) => update(element.id, { width: Math.max(0.01, v) })}
            />
            <NumberField
              label={wirt === 'wand' ? 'Höhe [m]' : 'Maß y [m]'}
              value={element.height ?? 0}
              step={0.01}
              onChange={(v) => update(element.id, { height: Math.max(0.01, v) })}
            />
          </div>
        )}

        {wirt === 'wand' ? (
          <>
            <NumberField
              label={rund ? 'Achshöhe über FFB [m]' : 'Unterkante über FFB [m]'}
              value={element.sillHeight ?? 0}
              step={0.05}
              onChange={(v) => update(element.id, { sillHeight: Math.max(0, v) })}
            />
            <NumberField
              label="Abstand auf der Wandachse [m]"
              value={element.distance ?? 0}
              step={0.05}
              onChange={(v) => update(element.id, { distance: Math.max(0, v) })}
            />
          </>
        ) : (
          <NumberField
            label="Drehung [°]"
            value={element.rotation ?? 0}
            step={15}
            onChange={(v) => update(element.id, { rotation: v })}
          />
        )}
      </Section>

      <Section title="Ausführung">
        <div>
          <span className="label-xs mb-1 block">Gewerk</span>
          <div className="flex flex-wrap gap-0.5 rounded-lg bg-graphite-900/60 p-0.5">
            {(Object.keys(SHAFT_SERVICE_LABELS) as ShaftService[]).map((sv) => (
              <button
                key={sv}
                onClick={() => update(element.id, { service: sv })}
                className={`chip flex-1 whitespace-nowrap ${
                  element.service === sv ? 'bg-accent/15 text-accent' : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {SHAFT_SERVICE_LABELS[sv]}
              </button>
            ))}
          </div>
        </div>

        <NumberField
          label="Nennweite DN [mm]"
          value={element.dn ?? 0}
          step={5}
          onChange={(v) => update(element.id, { dn: Math.max(0, Math.round(v)) })}
        />

        <div>
          <span className="label-xs mb-1 block">Brandschutz</span>
          <div className="flex flex-wrap gap-0.5 rounded-lg bg-graphite-900/60 p-0.5">
            {(Object.keys(BRANDSCHUTZ_LABELS) as Brandschutzklasse[]).map((k) => (
              <button
                key={k}
                onClick={() => update(element.id, { brandschutz: k })}
                className={`chip flex-1 whitespace-nowrap ${
                  (element.brandschutz ?? 'keine') === k
                    ? 'bg-accent/15 text-accent'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {k === 'keine' ? 'ohne' : k.replace('R', 'R ')}
              </button>
            ))}
          </div>
        </div>

        <label className="block">
          <span className="label-xs mb-1 block">Bemerkung</span>
          <input
            className="field"
            placeholder="z. B. nach Rücksprache Statik"
            value={element.note ?? ''}
            onChange={(e) => update(element.id, { note: e.target.value })}
          />
        </label>
      </Section>

      <Section title="Wirkung auf die Rechnung">
        <p className="rounded-lg bg-graphite-900/60 px-2.5 py-2 text-[10px] leading-relaxed text-slate-400">
          Keine. Ein Durchbruch mindert weder Wandfläche noch Raumfläche und trägt keinen U-Wert —
          er wird geschottet, nicht gerechnet. Was er leistet, steht auf dem Plan und im
          Massenauszug: Lage, Maß, Höhe und die Anforderung an die Schottung.
        </p>
      </Section>

      <Section title="Ergibt sich daraus">
        <Readout label="Lichter Querschnitt" value={`${(querschnitt * 10000).toFixed(0)} cm²`} accent />
        <Readout
          label="Lage"
          value={mitte ? `${mitte.x.toFixed(2)} | ${mitte.y.toFixed(2)}` : '—'}
        />
        <Readout label="Geschoss" value={level?.name ?? '—'} />
        {wirt === 'wand' && (
          <>
            <Readout label="In Wand" value={wand ? (wand.type === 'exterior' ? 'Außenwand' : 'Innenwand') : '—'} />
            <Readout
              label="Wandlänge"
              value={geometrie ? `${geometrie.length.toFixed(2)} m` : '—'}
            />
            <Readout label="Wanddicke" value={wand ? `${(wand.thickness * 100).toFixed(0)} cm` : '—'} />
          </>
        )}
      </Section>

      {!urteil.passt && (
        <p className="rounded-lg bg-red-500/10 px-2.5 py-2 text-[10px] leading-relaxed text-red-300">
          {urteil.grund} Solange das so steht, lässt sich der Durchbruch nicht ausführen — und er
          steht als Fehler in der Prüfung.
        </p>
      )}

      {wirt === 'wand' && wand?.type === 'exterior' && (
        <p className="rounded-lg bg-orange-500/10 px-2.5 py-2 text-[10px] leading-relaxed text-orange-300">
          Dieser Durchbruch geht durch eine Außenwand. Die Dämmebene wird dabei durchstoßen; die
          Abdichtung gegen Schlagregen und die luftdichte Ausbildung gehören in die Ausschreibung.
          Gerechnet wird das hier nicht.
        </p>
      )}
    </div>
  );
}

function VerticalProperties({ element }: { element: VerticalElement }) {
  const update = useBimStore((s) => s.updateVertical);
  const levels = useBimStore((s) => s.doc.levels);
  const rooms = useBimStore((s) => s.doc.rooms);
  const isStair = element.kind !== 'shaft';
  const area = element.width * element.length;

  const room = Object.values(rooms).find(
    (r) => r.levelId === element.levelId && r.innerPolygon.length >= 3 && pointInPolygon(element.position, r.innerPolygon),
  );

  const ordered = Object.values(levels).sort((a, b) => a.order - b.order);
  const level = levels[element.levelId];
  const rise = element.steps && level ? (level.height + 0.28) / element.steps : 0;
  // Der Auftritt folgt der *Lauflinie*, nicht der Rechteckseite: bei einer
  // gewendelten Treppe ist der Weg länger als das Bauteil tief ist.
  const runLength = isStair ? stairRunLength(element) : 0;
  const going = element.steps && element.steps > 1 ? runLength / (element.steps - 1) : 0;

  return (
    <div className="space-y-3 p-3">
      <Section title={VERTICAL_LABELS[element.kind]}>
        <label className="block">
          <span className="label-xs mb-1 block">Bezeichnung</span>
          <input
            className="field"
            value={element.name}
            onChange={(e) => update(element.id, { name: e.target.value })}
          />
        </label>

        {isStair && (
          <div>
            <span className="label-xs mb-1 block">Form</span>
            <div className="flex flex-wrap gap-0.5 rounded-lg bg-graphite-900/60 p-0.5">
              {(['stair-straight', 'stair-l', 'stair-u', 'stair-spiral'] as VerticalKind[]).map((k) => (
                <button
                  key={k}
                  onClick={() => update(element.id, { kind: k })}
                  title={VERTICAL_LABELS[k]}
                  className={`chip flex-1 whitespace-nowrap ${
                    element.kind === k ? 'bg-accent/15 text-accent' : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {VERTICAL_LABELS[k].replace(' Treppe', '')}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label={isStair ? 'Laufbreite [m]' : 'Breite [m]'}
            value={element.width}
            step={0.05}
            onChange={(v) => update(element.id, { width: Math.max(0.1, v) })}
          />
          <NumberField
            label={isStair ? 'Lauflänge [m]' : 'Tiefe [m]'}
            value={element.length}
            step={0.05}
            onChange={(v) => update(element.id, { length: Math.max(0.1, v) })}
          />
        </div>

        <NumberField
          label="Drehung [°]"
          value={element.rotation}
          step={15}
          onChange={(v) => update(element.id, { rotation: v })}
        />

        {isStair && (
          <NumberField
            label="Steigungen"
            value={element.steps ?? 15}
            step={1}
            onChange={(v) => update(element.id, { steps: Math.max(2, Math.round(v)) })}
          />
        )}

        {!isStair && (
          <label className="block">
            <span className="label-xs mb-1 block">Gewerk</span>
            <select
              className="field"
              value={element.service ?? 'mixed'}
              onChange={(e) => update(element.id, { service: e.target.value as ShaftService })}
            >
              {(Object.keys(SHAFT_SERVICE_LABELS) as ShaftService[]).map((k) => (
                <option key={k} value={k} className="bg-graphite-850">
                  {SHAFT_SERVICE_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="block">
          <span className="label-xs mb-1 block">Reicht bis</span>
          <select
            className="field"
            value={element.toLevelId ?? ''}
            onChange={(e) => update(element.id, { toLevelId: e.target.value || undefined })}
          >
            <option value="" className="bg-graphite-850">
              nächstes Geschoss
            </option>
            {ordered
              .filter((l) => l.id !== element.levelId)
              .map((l) => (
                <option key={l.id} value={l.id} className="bg-graphite-850">
                  {l.name}
                </option>
              ))}
          </select>
        </label>
      </Section>

      <Section title="Wirkung auf die Rechnung">
        <label className="flex cursor-pointer items-start gap-2 text-[11px] text-slate-300">
          <input
            type="checkbox"
            className="mt-0.5 accent-accent"
            checked={element.deductsArea}
            onChange={(e) => update(element.id, { deductsArea: e.target.checked })}
          />
          <span>
            Grundfläche abziehen
            <span className="mt-0.5 block text-[9.5px] leading-relaxed text-slate-500">
              Bei einer offenen Treppe ja. Ein eingehauster Treppenraum ist dagegen ein eigener
              Raum mit eigenen Wänden — dann hier aus.
            </span>
          </span>
        </label>

        <label className="flex cursor-pointer items-start gap-2 text-[11px] text-slate-300">
          <input
            type="checkbox"
            className="mt-0.5 accent-accent"
            checked={element.openToAbove}
            onChange={(e) => update(element.id, { openToAbove: e.target.checked })}
          />
          <span>
            Decke darüber fehlt
            <span className="mt-0.5 block text-[9.5px] leading-relaxed text-slate-500">
              Luftraum ins nächste Geschoss. Über dieser Fläche gibt es kein Bauteil, also auch
              keinen Transmissionsverlust.
            </span>
          </span>
        </label>
      </Section>

      <Section title="Ergibt sich daraus">
        <Readout label="Grundfläche" value={`${area.toFixed(2)} m²`} accent />
        {isStair && rise > 0 && (
          <>
            <Readout label="Lauflinie" value={`${runLength.toFixed(2)} m`} />
            <Readout label="Steigungshöhe" value={`${(rise * 100).toFixed(1)} cm`} />
            <Readout label="Auftritt" value={`${(going * 100).toFixed(1)} cm`} />
            <Readout label="Schrittmaß 2s+a" value={`${(2 * rise * 100 + going * 100).toFixed(1)} cm`} />
          </>
        )}
        <Readout label="Im Raum" value={room?.name ?? '—'} />
      </Section>

      {isStair && rise > 0 && (rise > 0.2 || rise < 0.14) && (
        <p className="rounded-lg bg-orange-500/10 px-2.5 py-2 text-[10px] leading-relaxed text-orange-300">
          Steigungshöhe {(rise * 100).toFixed(1)} cm liegt außerhalb von 14–20 cm (DIN 18065).
          Zahl der Steigungen anpassen.
        </p>
      )}
      {isStair && going > 0 && (going < 0.23 || going > 0.37) && (
        <p className="rounded-lg bg-orange-500/10 px-2.5 py-2 text-[10px] leading-relaxed text-orange-300">
          Auftritt {(going * 100).toFixed(1)} cm liegt außerhalb von 23–37 cm (DIN 18065). Lauflänge
          oder Stufenzahl anpassen — bei gewendelten Treppen zählt die Lauflinie, nicht die
          Bauteiltiefe.
        </p>
      )}
    </div>
  );
}

/** Leitungsabschnitt: Gewerk, Nennweite, Dämmung — und die Länge. */
function PipeProperties({ run }: { run: PipeRun }) {
  const update = useBimStore((s) => s.updatePipe);
  const length = run.points.reduce(
    (sum, p, i) => (i ? sum + Math.hypot(p.x - run.points[i - 1].x, p.y - run.points[i - 1].y) : 0),
    0,
  );

  return (
    <div className="space-y-3 p-3">
      <Section title="Leitung">
        <label className="block">
          <span className="label-xs mb-1 block">Gewerk</span>
          <select
            className="field"
            value={run.service}
            onChange={(e) => update(run.id, { service: e.target.value as PipeService })}
          >
            {(Object.keys(PIPE_SERVICE_LABELS) as PipeService[]).map((k) => (
              <option key={k} value={k} className="bg-graphite-850">
                {PIPE_SERVICE_LABELS[k]}
              </option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="Nennweite DN"
            value={run.nominalDiameter}
            step={5}
            onChange={(v) => update(run.id, { nominalDiameter: Math.max(1, Math.round(v)) })}
          />
          <NumberField
            label="Dämmung [mm]"
            value={run.insulation}
            step={5}
            onChange={(v) => update(run.id, { insulation: Math.max(0, Math.round(v)) })}
          />
        </div>

        <NumberField
          label="Verlegehöhe [m]"
          value={run.elevation}
          step={0.05}
          onChange={(v) => update(run.id, { elevation: v })}
        />

        <label className="block">
          <span className="label-xs mb-1 block">Bemerkung</span>
          <input
            className="field"
            value={run.label ?? ''}
            placeholder="z. B. Strang HK 1–4"
            onChange={(e) => update(run.id, { label: e.target.value || undefined })}
          />
        </label>
      </Section>

      <Section title="Ergibt sich daraus">
        <Readout label="Trassenlänge" value={`${length.toFixed(2)} m`} accent />
        <Readout label="Stützpunkte" value={String(run.points.length)} />
        <Readout label="Gedämmt" value={run.insulation > 0 ? `${run.insulation} mm` : 'nein'} />
      </Section>

      <p className="text-[9.5px] leading-relaxed text-slate-600">
        Die Trassenlänge ist die Länge im Grundriss. Steigstränge zwischen den Geschossen werden
        je Geschoss als eigener Abschnitt geführt; der Export summiert alles zum Längenauszug je
        Gewerk und Nennweite.
      </p>
    </div>
  );
}

/**
 * Eine Armatur am Rohrnetz — **nur zum Nachsehen**.
 *
 * Warum hier nichts eingetragen werden kann: Für Armaturen gibt es im Store
 * (noch) keine Änderungsaktion. Ein Eingabefeld, das beim Tippen nichts
 * speichert, ist schlimmer als gar keins — man trägt den Einstellwert der
 * Rücklaufverschraubung ein, sieht ihn im Feld stehen, und beim nächsten
 * Auswählen ist er weg. Deshalb stehen die Werte hier als Anzeige, und
 * geändert wird die Armatur dort, wo sie entsteht: am Rohrnetz.
 *
 * Was die Leiste beantwortet, ist die Frage, die man vor der Armatur wirklich
 * hat: Was ist das, wie hoch sitzt sie, hängt sie an einem Abschnitt — und
 * warum sitzt sie überhaupt hier.
 */
function AccessoryProperties({ armatur }: { armatur: PipeAccessory }) {
  const doc = useBimStore((s) => s.doc);
  const deleteSelection = useBimStore((s) => s.deleteSelection);

  // Der gebundene Abschnitt wird über `runId` nachgeschlagen. Er kann fehlen:
  // eine von Hand gesetzte Armatur steht frei im Plan, bis sie jemand auf eine
  // Trasse zieht — und ein gelöschter Abschnitt lässt die Bindung als
  // toten Verweis zurück. Beide Fälle heißen hier „steht frei“, statt eine
  // Leitung zu behaupten, die es nicht mehr gibt.
  const run = armatur.runId ? doc.pipes?.[armatur.runId] : undefined;
  const level = doc.levels[armatur.levelId];

  return (
    <div className="space-y-3 p-3">
      <Section title={ACCESSORY_LABELS[armatur.kind]}>
        <div className="rounded-lg bg-graphite-900/60 px-2.5 py-2">
          <Readout label="Art" value={ACCESSORY_LABELS[armatur.kind]} accent />
          <Readout label="Bezeichnung" value={armatur.label || '—'} />
          {armatur.spec && <Readout label="Technisch" value={armatur.spec} />}
          <Readout label="Höhe über FFB" value={hoehenText(armatur.elevation)} />
          <Readout label="Geschoss" value={level?.name ?? '—'} />
          <Readout
            label="Lage"
            value={`${armatur.position.x.toFixed(2)} | ${armatur.position.y.toFixed(2)}`}
          />
        </div>

        <div className="rounded-lg bg-graphite-900/60 px-2.5 py-2">
          <Readout
            label="Am Abschnitt"
            value={run ? `${PIPE_SERVICE_LABELS[run.service]} ${rohrbezeichnungLang(run)}` : 'steht frei'}
            accent={Boolean(run)}
          />
          {run?.label && <Readout label="Strang" value={run.label} />}
          <Readout label="Gesetzt" value={armatur.generated ? 'aus einer Regel' : 'von Hand'} />
        </div>

        {armatur.reason && (
          <p className="rounded-lg bg-graphite-900/60 px-2.5 py-2 text-[10px] leading-relaxed text-slate-400">
            {armatur.reason}
          </p>
        )}

        {!run && (
          <p className="text-[10px] leading-relaxed text-slate-600">
            Ohne gebundenen Abschnitt taucht die Armatur in keinem Strangauszug auf: Nennweite und
            Medium kommen von der Leitung, auf der sie sitzt. Auf eine Trasse gezogen, bekommt sie
            beides automatisch.
          </p>
        )}

        <p className="text-[10px] leading-relaxed text-slate-600">
          Die Angaben stehen hier nur zum Nachsehen. Geändert wird die Armatur am Rohrnetz — dort
          entsteht sie und dort hängen Nennweite, Einstellwert und Lage am Abschnitt zusammen.
        </p>

        <button
          className="chip w-full bg-red-500/10 text-red-300 hover:bg-red-500/20"
          title="Entfernt die Armatur aus dem Plan"
          onClick={() => deleteSelection()}
        >
          Armatur löschen
        </button>
      </Section>
    </div>
  );
}

/**
 * Dachflächenfenster oder Gaube. Die entscheidende Zahl steht unten: was das
 * Bauteil an der Hülle ändert. Ein Dachfenster tauscht Dachfläche gegen Glas,
 * eine Gaube bringt Volumen und drei neue Bauteile mit.
 */
function RoofOpeningProperties({ opening }: { opening: RoofOpening }) {
  const update = useBimStore((s) => s.updateRoofOpening);
  const levels = useBimStore((s) => s.doc.levels);
  const isSkylight = opening.kind === 'skylight';
  const roof = levels[opening.levelId]?.roof;
  const area = opening.width * opening.depth;

  return (
    <div className="space-y-3 p-3">
      <Section title={ROOF_OPENING_LABELS[opening.kind]}>
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="Breite [m]"
            value={opening.width}
            step={0.05}
            onChange={(v) => update(opening.id, { width: Math.max(0.2, v) })}
          />
          <NumberField
            label={isSkylight ? 'Höhe [m]' : 'Tiefe [m]'}
            value={opening.depth}
            step={0.05}
            onChange={(v) => update(opening.id, { depth: Math.max(0.2, v) })}
          />
        </div>

        {!isSkylight && (
          <>
            <NumberField
              label="Lichte Höhe der Front [m]"
              value={opening.frontHeight ?? 2.2}
              step={0.05}
              onChange={(v) => update(opening.id, { frontHeight: Math.max(1, v) })}
            />
            <NumberField
              label="Verglasung der Front [m²]"
              value={opening.frontWindowArea ?? 0}
              step={0.1}
              onChange={(v) => update(opening.id, { frontWindowArea: Math.max(0, v) })}
            />
            {opening.kind === 'dormer-gable' && (
              <NumberField
                label="Giebelspitze über Traufe [m]"
                value={opening.gableRise ?? defaultGableRise(opening)}
                step={0.05}
                onChange={(v) => update(opening.id, { gableRise: Math.max(0, v) })}
              />
            )}
          </>
        )}

        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label={isSkylight ? 'U Fenster' : 'U Gaubendach'}
            value={opening.uValue}
            step={0.05}
            onChange={(v) => update(opening.id, { uValue: Math.max(0.05, v) })}
          />
          {isSkylight ? (
            <NumberField
              label="g-Wert"
              value={opening.gValue ?? 0.5}
              step={0.05}
              onChange={(v) => update(opening.id, { gValue: Math.min(1, Math.max(0, v)) })}
            />
          ) : (
            <NumberField
              label="U Front/Wangen"
              value={opening.frontUValue ?? 0.24}
              step={0.02}
              onChange={(v) => update(opening.id, { frontUValue: Math.max(0.05, v) })}
            />
          )}
        </div>

        <label className="block">
          <span className="label-xs mb-1 block">Bezeichnung</span>
          <input
            className="field"
            value={opening.label ?? ''}
            placeholder={ROOF_OPENING_LABELS[opening.kind]}
            onChange={(e) => update(opening.id, { label: e.target.value || undefined })}
          />
        </label>
      </Section>

      <Section title="Wirkung auf die Hülle">
        {isSkylight ? (
          <>
            <Readout label="Glasfläche" value={`${area.toFixed(2)} m²`} accent />
            <Readout label="Neigung" value={roof ? `${roof.pitch.toFixed(0)}°` : '—'} />
            <p className="pt-1 text-[9.5px] leading-relaxed text-slate-600">
              Die Fläche wird von der Dachfläche <em>abgezogen</em>, nicht addiert. Neigung und
              Himmelsrichtung übernimmt das Fenster von der Dachfläche, auf der es sitzt — das ist
              für die solaren Gewinne der entscheidende Unterschied zu einem Fassadenfenster.
            </p>
          </>
        ) : (
          <>
            <Readout label="Grundfläche" value={`${area.toFixed(2)} m²`} />
            {opening.kind === 'dormer-gable' && (
              <Readout
                label="Giebeldreieck"
                value={`${(0.5 * opening.width * defaultGableRise(opening)).toFixed(2)} m²`}
              />
            )}
            <p className="pt-1 text-[9.5px] leading-relaxed text-slate-600">
              Die genauen Flächen von Front, Wangen und Gaubendach stehen im Dach-Panel und im
              Export — sie folgen aus der Lage der Gaube auf der Dachfläche und lassen sich hier
              nicht sinnvoll vorwegnehmen.
            </p>
          </>
        )}
      </Section>

      <p className="text-[9.5px] leading-relaxed text-slate-600">
        Mit dem Auswahl-Werkzeug lässt sich die Öffnung verschieben. Sie richtet sich immer nach
        der Fallrichtung des Daches aus — schräg in der Dachfläche sitzende Gauben gibt es am Bau
        nicht.
      </p>
    </div>
  );
}

/**
 * Wie das beschriftete Bauteil im Klartext heißt.
 *
 * Der Anker speichert nur `kind` und `id` — eine Kennung, die niemandem etwas
 * sagt. Wer die Fahne anfasst, will wissen, woran sie hängt, und zwar so, wie
 * das Bauteil im Plan heißt. Ist das Bauteil gelöscht, steht das ausdrücklich
 * da: eine Fahne, die ins Leere zeigt, muss man sehen können, sonst bleibt sie
 * bis zum Druck im Plan stehen.
 */
function ankerBezeichnung(doc: BimDocument, anchor: AnnotationAnchor): string {
  if (anchor.kind === 'fixture') {
    const f = doc.fixtures[anchor.id];
    if (!f) return 'gelöschtes Objekt';
    return f.label ?? FIXTURE_BY_TYPE[f.type]?.label ?? 'TGA-Objekt';
  }
  if (anchor.kind === 'pipe') {
    const r = doc.pipes?.[anchor.id];
    if (!r) return 'gelöschte Leitung';
    return `${PIPE_SERVICE_LABELS[r.service]} ${rohrbezeichnungLang(r)}`;
  }
  const d = doc.durchbrueche?.[anchor.id];
  if (!d) return 'gelöschter Durchbruch';
  return d.name || DURCHBRUCH_LABELS[d.kind];
}

/** Freie Maßkette, Text oder Hinweisfahne. */
function AnnotationProperties({ note }: { note: Annotation }) {
  const update = useBimStore((s) => s.updateAnnotation);
  const doc = useBimStore((s) => s.doc);
  const measured = annotationLength(note);
  const veraltet = beschriftungVeraltet(doc, note);
  const aktuell = note.anchor ? modellwert(doc, note.anchor) : null;

  return (
    <div className="space-y-3 p-3">
      <Section title={ANNOTATION_LABELS[note.kind]}>
        <label className="block">
          <span className="label-xs mb-1 block">
            {note.kind === 'dimension' ? 'Text statt Maß' : 'Text'}
          </span>
          <input
            className="field"
            value={note.text ?? ''}
            placeholder={note.kind === 'dimension' ? measured.toFixed(3) : 'Text eingeben'}
            onChange={(e) => update(note.id, { text: e.target.value || undefined })}
          />
        </label>

        {note.kind === 'dimension' && (
          <NumberField
            label="Versatz der Maßlinie [m]"
            value={note.offset}
            step={0.05}
            onChange={(v) => update(note.id, { offset: v })}
          />
        )}

        <NumberField
          label="Schriftgröße"
          value={note.scale}
          step={0.1}
          onChange={(v) => update(note.id, { scale: Math.max(0.5, Math.min(3, v)) })}
        />
      </Section>

      {/*
       * Beschriftungen aus der begehbaren Ansicht.
       *
       * `elevation` ist das Erkennungsmerkmal: Wer im Haus steht und einen
       * Heizkörper beschriftet, setzt die Fahne auf eine Höhe. Der Grundriss
       * kennt nur x und y — ohne die Höhe stünden zwei übereinander liegende
       * Bauteile mit zwei Texten an derselben Stelle, und niemand wüsste,
       * welcher Text zu welchem gehört. Fehlt das Feld, ist es eine gewöhnliche
       * Planbeschriftung und dieser Abschnitt bleibt aus — nicht etwa eine
       * Beschriftung auf Höhe 0.
       */}
      {note.elevation !== undefined && (
        <Section title="In der Ansicht gesetzt">
          <NumberField
            label="Höhe über FFB [m]"
            value={note.elevation}
            step={0.05}
            onChange={(v) => update(note.id, { elevation: v })}
          />
          <p className="text-[9.5px] leading-relaxed text-slate-600">
            Die Höhe steht im Plan hinter dem Text: „{planText(note)}“. Negative Werte sind
            zulässig und gewollt — was unter dem Estrich liegt, hat eine Höhe unter null.
          </p>

          {note.anchor && (
            <div className="rounded-lg bg-graphite-900/60 px-2.5 py-2">
              <Readout label="Hängt an" value={ankerBezeichnung(doc, note.anchor)} accent />
              <Readout
                label="Quelle"
                value={
                  note.anchor.quelle ? ANNOTATION_QUELLE_LABELS[note.anchor.quelle] : 'frei getippt'
                }
              />
              {note.anchor.quelle && aktuell !== null && (
                <Readout label="Modell sagt" value={aktuell} />
              )}
            </div>
          )}

          {/*
           * Der Grund, warum dieser ganze Abschnitt existiert.
           *
           * Eine abgeschriebene Zahl ist ab dem Moment des Abschreibens eine
           * zweite, unabhängige Wahrheit. Wird der Heizkörper später von
           * 2000 W auf 1600 W geändert — im Inspektor, beim Einlesen eines
           * Datenblatts, durch den Rohrausleger —, bleibt auf der Fahne
           * 2000 W stehen. Es fällt niemandem auf, weil beide Zahlen für sich
           * plausibel aussehen; gemerkt wird es erst, wenn der Plan gedruckt
           * auf der Baustelle liegt und der Monteur nach dem 2000-W-Heizkörper
           * sucht, den es nicht gibt.
           *
           * Deshalb zieht das Programm die Abschrift **nicht** stillschweigend
           * nach: Vielleicht war die alte Zahl Absicht — ein Bestandswert, eine
           * Angabe des Bauherrn, ein bewusst abweichender Vermerk. Es meldet
           * den Widerspruch und legt die Entscheidung dem vor, der sie treffen
           * kann. Was es auf keinen Fall tut, ist beides zu unterlassen und die
           * veraltete Zahl zu drucken.
           */}
          {veraltet && aktuell !== null && (
            <div className="space-y-2 rounded-lg bg-orange-500/10 px-2.5 py-2">
              <p className="text-[10px] leading-relaxed text-orange-300">
                Die Beschriftung stimmt nicht mehr mit dem Modell überein: hier steht „{note.text}“,
                am Bauteil steht inzwischen „{aktuell}“. Abgeschrieben wurde sie, als das Bauteil
                noch den alten Wert hatte.
              </p>
              <button
                className="chip w-full bg-white/[0.06] text-orange-200 hover:bg-white/[0.12]"
                title={`Setzt den Text auf den aktuellen Modellwert „${aktuell}“`}
                onClick={() => update(note.id, { text: aktuell })}
              >
                Wert nachziehen: {aktuell}
              </button>
              <p className="text-[9.5px] leading-relaxed text-orange-200/70">
                Nachziehen nur, wenn der Modellwert der richtige ist. War die Abweichung Absicht —
                ein Bestandswert, eine Angabe des Bauherrn —, bleibt der Text stehen; der Hinweis
                bleibt dann ebenfalls stehen, und das ist so gewollt.
              </p>
            </div>
          )}
        </Section>
      )}

      {note.kind === 'dimension' && (
        <Section title="Gemessen">
          <Readout label="Länge" value={`${measured.toFixed(3)} m`} accent />
          <Readout label="in cm" value={`${(measured * 100).toFixed(1)} cm`} />
          {note.text && (
            <p className="pt-1 text-[9.5px] leading-relaxed text-orange-300/80">
              Der eingetragene Text überschreibt das gemessene Maß. Im Plan steht dann nicht mehr,
              was die Geometrie hergibt — nur benutzen, wenn das gewollt ist.
            </p>
          )}
        </Section>
      )}

      <p className="text-[9.5px] leading-relaxed text-slate-600">
        Beschriftungen sind reine Plangrafik: sie ändern weder Flächen noch Volumen und gehen nicht
        in die Heizlast ein. Im Export stehen sie in der Rohgeometrie, damit der Plan beim
        Wiedereinlesen unverändert aussieht.
      </p>
    </div>
  );
}

function BuildingSummary() {
  const doc = useBimStore((s) => s.doc);
  const totals = buildRaviaExport(doc).totals;
  const wallCount = Object.keys(doc.walls).length;
  const openingCount = Object.keys(doc.openings).length;
  const openEnds = doc.diagnostics.openEnds.length;
  const updateMeta = useBimStore((s) => s.updateMeta);
  const updateLevel = useBimStore((s) => s.updateLevel);
  const activeLevel = doc.levels[doc.activeLevelId];

  return (
    <Section title="Gebäude">
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-lg bg-graphite-900/60 px-2.5 py-2">
        <Readout label="Räume" value={String(totals.roomCount)} />
        <Readout label="Wände" value={String(wallCount)} />
        <Readout label="Nutzfläche" value={`${totals.netFloorArea.toFixed(2)} m²`} accent />
        <Readout label="Volumen" value={`${totals.netVolume.toFixed(2)} m³`} />
        <Readout label="Außenwand" value={`${totals.exteriorWallArea.toFixed(2)} m²`} />
        <Readout label="Fenster" value={`${totals.windowArea.toFixed(2)} m²`} />
        <Readout label="Öffnungen" value={String(openingCount)} />
        <Readout label="A/V" value={`${totals.compactness.toFixed(3)} 1/m`} />
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-lg bg-graphite-900/60 px-2.5 py-2">
        <Readout
          label="Heizleistung"
          value={`${totals.installedHeatingPower.toLocaleString('de-DE')} W`}
          accent
        />
        <Readout label="Heizung" value={String(totals.fixtureCount.heating)} />
        <Readout label="Sanitär" value={String(totals.fixtureCount.sanitary)} />
        <Readout label="Lüftung" value={String(totals.fixtureCount.ventilation)} />
      </div>

      {openEnds > 0 && (
        <div className="rounded-lg bg-orange-500/10 px-2.5 py-2">
          <div className="mb-1 flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-orange-400" />
            <span className="text-[11px] font-medium text-orange-300">
              {openEnds} offene {openEnds === 1 ? 'Wandende' : 'Wandenden'}
            </span>
          </div>
          <p className="text-[10px] leading-relaxed text-orange-200/70">
            An diesen Stellen stößt eine Wand auf nichts. Der Raum dahinter kann
            nicht geschlossen werden. Die Punkte sind im Plan orange markiert —
            Wandende anfassen und auf den Nachbarknoten ziehen.
          </p>
        </div>
      )}

      <div className="space-y-2 rounded-lg bg-graphite-900/60 px-2.5 py-2">
        <div className="label-xs">Auslegung (DIN EN 12831)</div>
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="θe außen [°C]"
            term="norm-aussentemperatur"
            value={doc.meta.designOutdoorTemperature}
            step={1}
            onChange={(v) => updateMeta({ designOutdoorTemperature: v })}
          />
          <NumberField
            label="θu unbeheizt [°C]"
            value={doc.meta.unheatedTemperature}
            step={1}
            onChange={(v) => updateMeta({ unheatedTemperature: v })}
          />
          <NumberField
            label="θ Erdreich [°C]"
            value={doc.meta.groundTemperature}
            step={1}
            onChange={(v) => updateMeta({ groundTemperature: v })}
          />
          <div className="col-span-2">
            <KompassFeld
              northAngle={doc.meta.northAngle}
              onChange={(v) => updateMeta({ northAngle: v })}
            />
          </div>
          <NumberField
            label="n50 [1/h]"
            term="n50"
            value={doc.meta.n50}
            step={0.5}
            onChange={(v) => updateMeta({ n50: Math.max(0, v) })}
          />
          <NumberField
            label="ΔU_WB [W/m²K]"
            term="delta-u-wb"
            value={doc.meta.thermalBridgeSupplement}
            step={0.01}
            onChange={(v) => updateMeta({ thermalBridgeSupplement: Math.max(0, v) })}
          />
        </div>
        <Field label="Abschirmung" term="abschirmung">
          <select
            className="field"
            value={doc.meta.shielding}
            onChange={(e) => updateMeta({ shielding: e.target.value as 'none' | 'moderate' | 'high' })}
          >
            <option value="none" className="bg-graphite-850">Keine — freistehend</option>
            <option value="moderate" className="bg-graphite-850">Mäßig — lockere Bebauung</option>
            <option value="high" className="bg-graphite-850">Stark — dichte Bebauung</option>
          </select>
        </Field>
      </div>

      {/* Geschoss-Bauteile: Vorgabe für alle Räume dieses Geschosses */}
      {activeLevel && (
        <div className="space-y-2 rounded-lg bg-graphite-900/60 px-2.5 py-2">
          <div className="label-xs">Geschoss „{activeLevel.name}"</div>
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label="Höhe [m]"
              value={activeLevel.height}
              step={0.05}
              onChange={(v) => updateLevel(activeLevel.id, { height: v })}
            />
            <NumberField
              label="OK FFB [m]"
              value={activeLevel.elevation}
              step={0.1}
              onChange={(v) => updateLevel(activeLevel.id, { elevation: v })}
            />
            <NumberField
              label="U Boden"
              value={activeLevel.floorUValue}
              step={0.01}
              onChange={(v) => updateLevel(activeLevel.id, { floorUValue: Math.max(0, v) })}
            />
            <NumberField
              label="U Decke"
              value={activeLevel.ceilingUValue}
              step={0.01}
              onChange={(v) => updateLevel(activeLevel.id, { ceilingUValue: Math.max(0, v) })}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Boden grenzt an">
              <select
                className="field"
                value={activeLevel.floorBoundary}
                onChange={(e) => updateLevel(activeLevel.id, { floorBoundary: e.target.value as BoundaryCondition })}
              >
                {(Object.keys(BOUNDARY_LABELS) as BoundaryCondition[]).map((b) => (
                  <option key={b} value={b} className="bg-graphite-850">
                    {BOUNDARY_LABELS[b]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Decke grenzt an">
              <select
                className="field"
                value={activeLevel.ceilingBoundary}
                onChange={(e) =>
                  updateLevel(activeLevel.id, { ceilingBoundary: e.target.value as BoundaryCondition })
                }
              >
                {(Object.keys(BOUNDARY_LABELS) as BoundaryCondition[]).map((b) => (
                  <option key={b} value={b} className="bg-graphite-850">
                    {BOUNDARY_LABELS[b]}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </div>
      )}

      <p className="text-[10px] leading-relaxed text-slate-600">
        Kein Objekt ausgewählt. Mit dem Auswahl-Werkzeug auf eine Wand, eine Öffnung oder eine
        Raumfläche klicken, um deren Eigenschaften zu bearbeiten.
      </p>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Bausteine
// ---------------------------------------------------------------------------

/** U-Wert und Randbedingung eines Bodens oder einer Decke, mit Geschoss-Vorgabe. */
function SlabControls({
  title,
  uValue,
  boundary,
  fallbackU,
  fallbackBoundary,
  onChange,
}: {
  title: string;
  uValue?: number;
  boundary?: BoundaryCondition;
  fallbackU: number;
  fallbackBoundary: BoundaryCondition;
  onChange: (patch: { uValue?: number; boundary?: BoundaryCondition }) => void;
}) {
  const isFloor = title.includes('Boden');
  return (
    <div className="space-y-1.5">
      <NumberField
        label={isFloor ? 'U Boden' : 'U Decke'}
        value={uValue ?? fallbackU}
        step={0.01}
        onChange={(v) => onChange({ uValue: Math.max(0, v), boundary })}
      />
      <select
        className="field"
        value={boundary ?? fallbackBoundary}
        onChange={(e) => onChange({ uValue, boundary: e.target.value as BoundaryCondition })}
      >
        {(Object.keys(BOUNDARY_LABELS) as BoundaryCondition[]).map((b) => (
          <option key={b} value={b} className="bg-graphite-850">
            {BOUNDARY_LABELS[b]}
          </option>
        ))}
      </select>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3 p-3">
      <div className="label-xs">{title}</div>
      {children}
    </div>
  );
}

function Field({
  label,
  term,
  children,
}: {
  label: string;
  /** Schlüssel im Glossar — setzt ein Fragezeichen neben die Beschriftung. */
  term?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="label-xs mb-1 flex items-center gap-1">
        <span className="min-w-0 truncate">{label}</span>
        {term && <Erklaerung term={term} />}
      </span>
      {children}
    </label>
  );
}

/**
 * Ein Zahlenfeld — das jetzt auch **leer** sein darf.
 * ---------------------------------------------------------------------------
 * **Warum diese Erweiterung nötig war.** Die alte Fassung nahm `value: number`
 * entgegen und zeigte für alles Nichtendliche eine 0. Jeder Aufrufer mit einem
 * wahlfreien Wert musste deshalb ein `?? 0` oder ein `?? 0,24` davorsetzen —
 * und genau diese Vorgabewerte waren das Problem: Sie standen als bedienbare
 * Zahl im Feld, und beim ersten Antippen wanderten sie als erfasster Wert ins
 * Modell. Aus „nicht erfasst" wurde „erfasst als Vorgabewert", unumkehrbar.
 *
 * **Warum `onLeeren` und nicht `onChange(undefined)`.** Mit einer Unterschrift
 * `(value: number | undefined) => void` müsste jeder der rund dreißig
 * vorhandenen Aufrufer seinen Ausdruck (`Math.max(0, v)`, `Math.round(v)`,
 * `Math.min(1.6, …)`) gegen `undefined` absichern — dreißig Änderungen für
 * eine Erweiterung, die drei Felder brauchen. Ein zweiter, wahlfreier Rückruf
 * erweitert das Feld, ohne eine einzige bestehende Aufrufstelle anzufassen,
 * und macht zugleich an der Aufrufstelle lesbar, wo „leer" überhaupt ein
 * zulässiger Zustand ist. Fehlt `onLeeren`, verhält sich das Feld exakt wie
 * bisher: Eine leere Eingabe ändert nichts.
 */
function NumberField({
  label,
  term,
  value,
  onChange,
  step = 1,
  onLeeren,
  platzhalter,
}: {
  label: string;
  term?: string;
  /** Der erfasste Wert. `undefined` heißt „nicht erfasst" — siehe `onLeeren`. */
  value: number | undefined;
  onChange: (value: number) => void;
  step?: number;
  /**
   * Meldet, dass der Anwender das Feld geleert hat. Ist der Rückruf gesetzt,
   * darf das Feld leer bleiben; sonst zeigt es wie bisher eine 0.
   */
  onLeeren?: () => void;
  /**
   * Grauer Text im leeren Feld — ein **Vorschlag**, kein Wert.
   *
   * Er ist bewusst ein Platzhalter und kein Vorgabewert: Er ist sichtbar, aber
   * er steht nicht im Modell, er geht in keine Rechnung, und er wird nicht
   * dadurch zur Angabe, dass jemand das Feld antippt.
   */
  platzhalter?: string;
}) {
  const leerErlaubt = onLeeren !== undefined;
  const anzeige = value !== undefined && Number.isFinite(value) ? value : leerErlaubt ? '' : 0;

  return (
    <label className="block">
      <span className="label-xs mb-1 flex items-center gap-1">
        <span className="min-w-0 truncate">{label}</span>
        {term && <Erklaerung term={term} />}
      </span>
      <input
        type="number"
        /*
         * Auf dem Tablet mindestens 44 px hoch — das kleinste Maß, unter dem
         * der Finger danebengreift. `.field` kommt unter `pointer: coarse` auf
         * rund 37 px; die Ergänzung gilt deshalb nur dort und lässt die
         * Maus-Oberfläche unverändert kompakt.
         */
        className="field font-mono [@media(pointer:coarse)]:min-h-[44px]"
        value={anzeige}
        placeholder={platzhalter}
        step={step}
        onChange={(e) => {
          /*
           * **Die leere Eingabe ist ein eigener Fall — und der wichtigste.**
           *
           * Ohne diesen Zweig fiel sie in `parseFloat('') === NaN` und wurde
           * verworfen: Der Anwender löschte das Feld, im Modell blieb die alte
           * Zahl stehen, und beim nächsten Neuzeichnen stand sie wieder da.
           * „Ich kann das nicht wieder leer bekommen" ist genau der Grund,
           * warum die Nullen und Vorgabewerte im Projektbuch überhaupt kleben
           * blieben.
           */
          if (e.target.value.trim() === '') {
            onLeeren?.();
            return;
          }
          const parsed = parseFloat(e.target.value);
          if (Number.isFinite(parsed)) onChange(parsed);
        }}
      />
    </label>
  );
}

function Readout({
  label,
  value,
  accent,
  term,
}: {
  label: string;
  value: string;
  accent?: boolean;
  term?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-1.5 py-0.5">
      <span className="flex min-w-0 items-center gap-1 truncate text-[10px] text-slate-500">
        <span className="min-w-0 truncate">{label}</span>
        {term && <Erklaerung term={term} />}
      </span>
      <span
        className={`shrink-0 whitespace-nowrap font-mono text-[11px] ${accent ? 'text-accent' : 'text-slate-300'}`}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * Die Kompassrose als Einstellfeld — drehen statt tippen.
 *
 * **Warum eine Rose und nicht nur eine Zahl.** „Nordabweichung 37°" ist für
 * niemanden anschaulich, und ob sie stimmt, sieht man erst an den solaren
 * Gewinnen — also viel zu spät. Eine Nadel, die man auf die Himmelsrichtung
 * dreht, die man vor Ort gesehen hat, ist die Eingabe, die dem Aufmaß
 * entspricht. Das Zahlenfeld bleibt daneben: Wer die Abweichung aus dem
 * Lageplan kennt, tippt sie ein.
 *
 * Gedreht wird auf 5° gerastert; mit gedrückter Umschalttaste gradgenau. Ein
 * Kompass am Telefon ist nicht genauer als ein paar Grad, und ein Raster
 * verhindert, dass aus einer abgelesenen 90 eine 88 wird.
 */
function KompassFeld({
  northAngle,
  onChange,
}: {
  northAngle: number;
  onChange: (grad: number) => void;
}) {
  const ref = useRef<SVGSVGElement | null>(null);

  const ausZeiger = (e: React.PointerEvent<SVGSVGElement>): void => {
    const svg = ref.current;
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    // SVG-y zeigt nach unten, das Modell nach oben — daher das Minus.
    const v = {
      x: e.clientX - (r.left + r.width / 2),
      y: -(e.clientY - (r.top + r.height / 2)),
    };
    if (Math.hypot(v.x, v.y) < 6) return;
    const grad = nordabweichungAus(v);
    onChange(e.shiftKey ? Math.round(grad) : Math.round(grad / 5) * 5);
  };

  const teile = kompassRose(northAngle);
  /** Einheitskoordinaten → SVG-Koordinaten in einem 100er-Feld. */
  const P = (p: { x: number; y: number }) => `${50 + p.x * 30},${50 - p.y * 30}`;

  return (
    <div className="flex items-center gap-3">
      <svg
        ref={ref}
        viewBox="0 0 100 100"
        className="h-[76px] w-[76px] shrink-0 cursor-crosshair touch-none"
        onPointerDown={(e) => {
          (e.target as Element).setPointerCapture?.(e.pointerId);
          ausZeiger(e);
        }}
        onPointerMove={(e) => {
          if (e.buttons === 1) ausZeiger(e);
        }}
      >
        {teile.map((t, i) => {
          if (t.kind === 'kreis') {
            return (
              <circle
                key={i}
                cx={50}
                cy={50}
                r={t.radius * 30}
                fill="rgba(15,23,42,0.6)"
                stroke="rgba(148,163,184,0.5)"
                strokeWidth={1}
              />
            );
          }
          if (t.kind === 'linie') {
            const [x1, y1] = P(t.a).split(',');
            const [x2, y2] = P(t.b).split(',');
            return (
              <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(148,163,184,0.6)" strokeWidth={1} />
            );
          }
          if (t.kind === 'flaeche') {
            return <polygon key={i} points={t.punkte.map(P).join(' ')} fill="#38BDF8" />;
          }
          const [tx, ty] = P(t.punkt).split(',');
          return (
            <text
              key={i}
              x={tx}
              y={ty}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={11}
              fontWeight={600}
              fill="#CBD5E1"
            >
              {t.text}
            </text>
          );
        })}
      </svg>
      <div className="min-w-0 flex-1">
        <NumberField
          label="Nordabweichung [°]"
          term="nordabweichung"
          value={northAngle}
          step={1}
          onChange={(v) => onChange(((v % 360) + 360) % 360)}
        />
        <p className="mt-1 text-[9.5px] leading-relaxed text-slate-600">
          Die Nadel auf Norden drehen — 5°-Raster, mit Umschalt gradgenau. 0° heißt: im Plan ist
          oben Norden.
        </p>
      </div>
    </div>
  );
}
