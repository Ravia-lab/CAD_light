/**
 * PropertiesPanel — kontextsensitive Eigenschaften der Auswahl.
 * Zeigt genau das, was zum selektierten Objekt gehört; ohne Auswahl die
 * Gebäude-Kennwerte, die man beim Planen ständig im Blick haben will.
 */

import type {
  Annotation,
  BoundaryCondition,
  DoorType,
  Fixture,
  Opening,
  PassageType,
  PipeRun,
  PipeService,
  RoofOpening,
  Room,
  ShaftService,
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
  BOUNDARY_LABELS,
  FIXTURE_BY_TYPE,
  PIPE_SERVICE_LABELS,
  ROOF_OPENING_LABELS,
  SHAFT_SERVICE_LABELS,
  SOLID_LABELS,
  VERTICAL_LABELS,
  WALL_THICKNESS_PRESETS,
} from '../types/bim';
import { FIXTURE_COLORS } from '../lib/fixtureSymbols';
import { distanceToSegment, pointInPolygon, polygonArea, polygonPerimeter } from '../lib/geometry';
import { annotationLength } from '../lib/annotationSymbols';
import { defaultGableRise } from '../lib/roofGeometry';
import { solidFootprint, stairRunLength } from '../lib/verticalSymbols';
import { useBimStore } from '../store/useBimStore';
import Erklaerung from './Erklaerung';
import { buildRaviaExport } from '../lib/raviaExport';

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
    case 'pipe': {
      const run = doc.pipes?.[selection.id];
      return run ? <PipeProperties run={run} /> : <BuildingSummary />;
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

function WallProperties({ wall }: { wall: Wall }) {
  const updateWall = useBimStore((s) => s.updateWall);
  const nodes = useBimStore((s) => s.doc.nodes);
  const a = nodes[wall.a];
  const b = nodes[wall.b];
  const length = a && b ? Math.hypot(b.x - a.x, b.y - a.y) : 0;
  const area = length * wall.height;

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
        <NumberField
          label="U-Wert [W/m²K]"
          term="u-wert"
          value={wall.uValue ?? 0.24}
          step={0.01}
          onChange={(v) => updateWall(wall.id, { uValue: v })}
        />
      </div>

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
  const isDoor = opening.kind === 'door';
  const isPassage = opening.kind === 'passage';
  const title = isPassage ? 'Durchgang' : isDoor ? 'Tür' : 'Fenster';

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
        {!isPassage && (
          <NumberField
            label="U-Wert"
            term="u-wert"
            value={opening.uValue ?? (isDoor ? 1.6 : 0.95)}
            step={0.05}
            onChange={(v) => updateOpening(opening.id, { uValue: v })}
          />
        )}
      </div>

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
        <div className="grid grid-cols-2 gap-1.5">
          <button
            className={`chip ${opening.hinge !== 'right' ? 'bg-accent/15 text-accent' : 'bg-white/[0.04] text-slate-500'}`}
            onClick={() => updateOpening(opening.id, { hinge: 'left' })}
          >
            Anschlag links
          </button>
          <button
            className={`chip ${opening.hinge === 'right' ? 'bg-accent/15 text-accent' : 'bg-white/[0.04] text-slate-500'}`}
            onClick={() => updateOpening(opening.id, { hinge: 'right' })}
          >
            Anschlag rechts
          </button>
          <button
            className="chip col-span-2 bg-white/[0.04] text-slate-400 hover:bg-white/[0.08]"
            onClick={() => updateOpening(opening.id, { flipSwing: !opening.flipSwing })}
          >
            Öffnungsrichtung spiegeln
          </button>
        </div>
      )}
    </Section>
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
function FixtureProperties({ fixture }: { fixture: Fixture }) {
  const updateFixture = useBimStore((s) => s.updateFixture);
  const rooms = useBimStore((s) => s.doc.rooms);
  const def = FIXTURE_BY_TYPE[fixture.type];
  const room = fixture.roomId ? rooms[fixture.roomId] : undefined;
  const color = FIXTURE_COLORS[fixture.category];

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

      {/* Gewerkespezifische Kennwerte — genau die, die im Export landen. */}
      {fixture.category === 'heating' && (
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="Leistung [W]"
            value={fixture.params.powerW ?? 0}
            step={50}
            onChange={(v) => updateFixture(fixture.id, { params: { ...fixture.params, powerW: Math.max(0, v) } })}
          />
          <Field label="Bauart">
            <input
              className="field"
              value={fixture.params.radiatorType ?? ''}
              onChange={(e) =>
                updateFixture(fixture.id, { params: { ...fixture.params, radiatorType: e.target.value } })
              }
            />
          </Field>
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
      )}

      {fixture.category === 'ventilation' && (
        <NumberField
          label="Volumenstrom [m³/h]"
          value={fixture.params.airflow ?? 0}
          step={5}
          onChange={(v) => updateFixture(fixture.id, { params: { ...fixture.params, airflow: Math.max(0, v) } })}
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

/** Freie Maßkette, Text oder Hinweisfahne. */
function AnnotationProperties({ note }: { note: Annotation }) {
  const update = useBimStore((s) => s.updateAnnotation);
  const measured = annotationLength(note);

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
          <NumberField
            label="Nordabweichung [°]"
            term="nordabweichung"
            value={doc.meta.northAngle}
            step={1}
            onChange={(v) => updateMeta({ northAngle: v })}
          />
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

function NumberField({
  label,
  term,
  value,
  onChange,
  step = 1,
}: {
  label: string;
  term?: string;
  value: number;
  onChange: (value: number) => void;
  step?: number;
}) {
  return (
    <label className="block">
      <span className="label-xs mb-1 flex items-center gap-1">
        <span className="min-w-0 truncate">{label}</span>
        {term && <Erklaerung term={term} />}
      </span>
      <input
        type="number"
        className="field font-mono"
        value={Number.isFinite(value) ? value : 0}
        step={step}
        onChange={(e) => {
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
