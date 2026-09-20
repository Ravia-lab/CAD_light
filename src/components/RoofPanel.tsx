/**
 * RoofPanel — das Dach über dem aktiven Geschoss.
 *
 * Bewusst wenige Eingaben: Form, Neigung, Kniestock, Firstrichtung. Alles
 * andere — Firsthöhe, Dachfläche, Wohnfläche, Volumen — wird daraus
 * abgeleitet und sofort angezeigt. Wer im Dachgeschoss rechnet, will genau
 * diese vier Zahlen prüfen können, ohne sie irgendwo einzutippen.
 */

import { useMemo } from 'react';
import type { RoofKind, RoofOpeningKind } from '../types/bim';
import { ROOF_KIND_LABELS, ROOF_OPENING_LABELS } from '../types/bim';
import { KRUEPPELWALM_VORGABE, MANSARD_KNICK_VORGABE, MANSARD_OBEN_VORGABE } from '../lib/roofGeometry';
import { buildRoofFrame } from '../lib/roofGeometry';
import { gebaeudeUmriss } from '../lib/roomDetection';
import { useBimStore } from '../store/useBimStore';
import Erklaerung from './Erklaerung';

/*
 * Die Reihenfolge ist die der Häufigkeit im deutschen Wohnungsbau, nicht die
 * des Aufzählungstyps: Wer ein Dach einträgt, findet seins meist in den
 * ersten drei. Zelt-, Kreuz- und Walmkehldach fehlen hier mit Absicht —
 * sie entstehen aus dem Walmdach über dem jeweiligen Umriss und sind keine
 * eigene Form (siehe `DACHFORMEN_AUS_UMRISS`).
 */
const KINDS: RoofKind[] = [
  'flat',
  'gable',
  'monopitch',
  'hip',
  'krueppelwalm',
  'mansard',
  'flat-sloped',
];

const AZIMUTHS: { value: number; label: string }[] = [
  { value: 0, label: 'N' },
  { value: 45, label: 'NO' },
  { value: 90, label: 'O' },
  { value: 135, label: 'SO' },
  { value: 180, label: 'S' },
  { value: 225, label: 'SW' },
  { value: 270, label: 'W' },
  { value: 315, label: 'NW' },
];

export default function RoofPanel() {
  const doc = useBimStore((s) => s.doc);
  const setRoof = useBimStore((s) => s.setRoof);
  const addRoofOpening = useBimStore((s) => s.addRoofOpening);
  const setSelection = useBimStore((s) => s.setSelection);
  const showRoofLines = useBimStore((s) => s.showRoofLines);
  const toggleRoofLines = useBimStore((s) => s.toggleRoofLines);

  const level = doc.levels[doc.activeLevelId];
  const roof = level?.roof;
  const kind: RoofKind = roof?.kind ?? 'flat';

  const rooms = useMemo(
    () => Object.values(doc.rooms).filter((r) => r.levelId === doc.activeLevelId),
    [doc.rooms, doc.activeLevelId],
  );

  const openings = useMemo(
    () => Object.values(doc.roofOpenings ?? {}).filter((o) => o.levelId === doc.activeLevelId),
    [doc.roofOpenings, doc.activeLevelId],
  );

  const frame = useMemo(() => {
    if (!roof) return null;
    const levelWalls = Object.values(doc.walls).filter((w) => w.levelId === doc.activeLevelId);
    const outline: { x: number; y: number }[] = [];
    for (const w of levelWalls) {
      const a = doc.nodes[w.a];
      const b = doc.nodes[w.b];
      if (a) outline.push({ x: a.x, y: a.y });
      if (b) outline.push({ x: b.x, y: b.y });
    }
    // Dieses Blatt zeigt die Firsthöhe an. Sie aus der Bounding Box zu
    // nehmen hieße, über einem L-Grundriss einen First auszuweisen, den es
    // nicht gibt — deshalb auch hier der geordnete Umriss.
    return buildRoofFrame(
      roof,
      outline,
      [],
      roof.kind !== 'flat' ? gebaeudeUmriss(levelWalls, doc.nodes) : [],
    );
  }, [roof, doc.walls, doc.nodes, doc.activeLevelId]);

  // Summen über alle Räume des Geschosses — die Zahlen, die man weitergibt.
  const totals = useMemo(() => {
    let sloped = 0;
    let living = 0;
    let volume = 0;
    let area = 0;
    let below1 = 0;
    let flat = 0;
    let skylight = 0;
    let dormerVolume = 0;
    let dormerFront = 0;
    for (const r of rooms) {
      area += r.area;
      volume += r.volume;
      if (!r.roof) continue;
      sloped += r.roof.slopedArea;
      living += r.roof.livingArea;
      below1 += r.roof.areaBelow1m;
      flat += r.roof.flatCeilingArea;
      skylight += r.roof.skylightArea;
      dormerVolume += r.roof.dormerVolume;
      dormerFront += r.roof.dormerFrontArea;
    }
    return { sloped, living, volume, area, below1, flat, skylight, dormerVolume, dormerFront };
  }, [rooms]);

  if (!level) return <div className="p-3 text-[11px] text-slate-500">Kein Geschoss aktiv.</div>;

  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center justify-between">
        <span className="label-xs">Dach über {level.name}</span>
        <button
          onClick={toggleRoofLines}
          className={`chip ${showRoofLines ? 'bg-accent/12 text-accent' : 'text-slate-500 hover:text-slate-300'}`}
          title="First-, Trauf- und Höhenlinien im Grundriss einblenden"
        >
          Linien
        </button>
      </div>

      {/* Dachform */}
      <div className="space-y-1">
        {KINDS.map((k) => (
          <button
            key={k}
            onClick={() => (k === 'flat' ? setRoof(level.id, null) : setRoof(level.id, { kind: k }))}
            className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[11px] transition-colors ${
              kind === k ? 'bg-accent/12 text-accent' : 'text-slate-400 hover:bg-white/[0.05]'
            }`}
          >
            <RoofIcon kind={k} active={kind === k} />
            <span className="min-w-0 flex-1 truncate">{ROOF_KIND_LABELS[k]}</span>
          </button>
        ))}
      </div>

      {!roof && (
        <p className="rounded-lg bg-white/[0.03] px-2.5 py-2.5 text-[10px] leading-relaxed text-slate-500">
          Ohne Dach bleibt die Decke waagerecht — der Regelfall. Erst eine Dachform macht die
          Raumhöhe ortsabhängig: Volumen, Wandflächen und Wohnfläche werden dann über den Grundriss
          integriert statt aus Fläche × Höhe gebildet.
        </p>
      )}

      {roof && (
        <>
          <Field
            label={roof.kind === 'mansard' ? 'Neigung unten (steil)' : 'Neigung'}
            unit="°"
            value={roof.pitch}
            // Das Flachdach mit Gefälle beginnt bei 1°: Das Gefälle dient der
            // Entwässerung, nicht dem Dachraum. Die Flachdachrichtlinie des
            // ZVDH empfiehlt mindestens 2 % (rund 1,15°); darunter ist es ein
            // Nulldach mit erhöhten Anforderungen an die Abdichtung.
            min={roof.kind === 'flat-sloped' ? 1 : 5}
            max={roof.kind === 'flat-sloped' ? 15 : 75}
            step={roof.kind === 'flat-sloped' ? 0.5 : 1}
            onChange={(v) => setRoof(level.id, { pitch: v })}
            hint={
              roof.kind === 'mansard'
                ? 'Die untere, steile Fläche — sie schafft den Wohnraum'
                : roof.kind === 'flat-sloped'
                  ? '2 % Gefälle sind rund 1,15° — ZVDH-Flachdachrichtlinie'
                  : undefined
            }
          />

          {roof.kind === 'mansard' && (
            <>
              <Field
                label="Neigung oben (flach)"
                unit="°"
                value={roof.upperPitch ?? MANSARD_OBEN_VORGABE}
                min={2}
                max={60}
                step={1}
                onChange={(v) => setRoof(level.id, { upperPitch: v })}
                hint="Die obere Fläche bis zum First; muss flacher sein als die untere"
              />
              <Field
                label="Mansardknick"
                unit="m"
                value={roof.knickHeight ?? MANSARD_KNICK_VORGABE}
                min={1}
                max={4}
                step={0.05}
                onChange={(v) => setRoof(level.id, { knickHeight: v })}
                hint="Höhe über Rohfußboden, in der steil in flach übergeht"
              />
            </>
          )}

          {roof.kind === 'krueppelwalm' && (
            <Field
              label="Giebel abgewalmt"
              unit="%"
              value={Math.round((roof.hipRatio ?? KRUEPPELWALM_VORGABE) * 100)}
              min={0}
              max={100}
              step={5}
              onChange={(v) => setRoof(level.id, { hipRatio: v / 100 })}
              hint="0 % wäre ein Satteldach, 100 % ein Walmdach — vom First abwärts gemessen"
            />
          )}
          <Field
            label="Kniestock"
            term="kniestock"
            unit="m"
            value={roof.kneeHeight}
            min={0}
            max={2.5}
            step={0.05}
            onChange={(v) => setRoof(level.id, { kneeHeight: v })}
            hint="Lichte Höhe an der Traufe, über Rohfußboden"
          />

          <div>
            <span className="label-xs mb-1.5 block">
              {roof.kind === 'monopitch' || roof.kind === 'flat-sloped'
                ? 'Fallrichtung'
                : 'Dach fällt nach'}
            </span>
            <div className="flex flex-wrap gap-0.5 rounded-lg bg-graphite-900/60 p-0.5">
              {AZIMUTHS.map((a) => (
                <button
                  key={a.value}
                  onClick={() => setRoof(level.id, { azimuth: a.value })}
                  title={`${a.value}°`}
                  className={`chip flex-1 ${
                    Math.round(roof.azimuth) === a.value
                      ? 'bg-accent/15 text-accent'
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {a.label}
                </button>
              ))}
            </div>
            {/*
              Freier Winkel neben den acht Himmelsrichtungen.

              **Warum beides.** Die acht Knöpfe treffen den Regelfall mit
              einem Klick — ein Haus steht meistens einigermaßen nach den
              Himmelsrichtungen. Sie reichen aber nicht, wenn es das nicht
              tut: Ein Gebäude, das 20° schief zur Straße steht, bekommt mit
              45°-Rastung ein Dach, das an keiner Traufe aufliegt. Dann muss
              man den Winkel eintippen können, und zwar genau.
            */}
            <div className="mt-1 flex items-center gap-1.5">
              <span className="text-[9.5px] text-slate-600">oder genau</span>
              <input
                type="number"
                min={0}
                max={359}
                step={1}
                value={Math.round(roof.azimuth)}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (!Number.isFinite(v)) return;
                  // Modulo, damit 370° zu 10° wird statt zu einem Dach, das
                  // die Firstrechnung nicht mehr einordnen kann.
                  setRoof(level.id, { azimuth: ((v % 360) + 360) % 360 });
                }}
                title="Richtung, in die die Dachfläche fällt, als Winkel — 0° = Norden, im Uhrzeigersinn. Für Gebäude, die schief zur Himmelsrichtung stehen."
                className="w-16 rounded-md bg-graphite-900/70 px-2 py-1 text-right font-mono text-[11px] text-slate-200 outline-none ring-1 ring-white/10"
              />
              <span className="font-mono text-[10px] text-slate-500">°</span>
            </div>
            <p className="mt-1 text-[9.5px] leading-relaxed text-slate-600">
              {roof.kind === 'monopitch' || roof.kind === 'flat-sloped'
                ? 'Das Dach fällt in diese Richtung ab.'
                : 'Der First steht senkrecht zu dieser Richtung.'}
            </p>
          </div>

          {roof.kind !== 'monopitch' && roof.kind !== 'flat-sloped' && (
            <Field
              label="First versetzt"
              unit="m"
              value={roof.ridgeOffset}
              min={-8}
              max={8}
              step={0.25}
              onChange={(v) => setRoof(level.id, { ridgeOffset: v })}
              hint="0 = mittig; positiv verschiebt in Fallrichtung"
            />
          )}

          <label className="flex cursor-pointer items-center gap-2 text-[10.5px] text-slate-400">
            <input
              type="checkbox"
              checked={typeof roof.collarHeight === 'number'}
              onChange={(e) =>
                setRoof(level.id, { collarHeight: e.target.checked ? 2.6 : undefined })
              }
              className="accent-accent"
            />
            Kehlbalkenlage (waagerechte Decke)
          </label>
          {typeof roof.collarHeight === 'number' && (
            <Field
              label="Kehlbalken"
              unit="m"
              value={roof.collarHeight}
              min={2}
              max={5}
              step={0.05}
              onChange={(v) => setRoof(level.id, { collarHeight: v })}
            />
          )}

          {/* U-Werte */}
          <div className="space-y-1.5 rounded-lg bg-white/[0.03] p-2.5">
            <div className="label-xs">Bauteile</div>
            <NumberRow
              label="Dachfläche"
              unit="W/(m²K)"
              value={roof.uValue}
              onChange={(v) => setRoof(level.id, { uValue: v })}
            />
            <NumberRow
              label="Giebel"
              unit="W/(m²K)"
              value={roof.gableUValue}
              onChange={(v) => setRoof(level.id, { gableUValue: v })}
            />
            {typeof roof.collarHeight === 'number' && (
              <NumberRow
                label="Kehlbalkendecke"
                unit="W/(m²K)"
                value={roof.collarUValue ?? level.ceilingUValue}
                onChange={(v) => setRoof(level.id, { collarUValue: v })}
              />
            )}
          </div>

          {/* Gauben und Dachflächenfenster */}
          <div className="space-y-1.5 rounded-lg bg-white/[0.03] p-2.5">
            <div className="flex items-center justify-between">
              <span className="label-xs">Dachöffnungen</span>
              <span className="text-[10px] tabular-nums text-slate-500">{openings.length}</span>
            </div>

            <div className="flex gap-1">
              {(['skylight', 'dormer-shed', 'dormer-gable'] as RoofOpeningKind[]).map((k) => (
                <button
                  key={k}
                  onClick={() => addRoofOpening(k)}
                  title={`${ROOF_OPENING_LABELS[k]} in der Raummitte einsetzen`}
                  className="chip flex-1 bg-accent/12 text-accent hover:bg-accent/20"
                >
                  {k === 'skylight' ? 'Fenster' : k === 'dormer-shed' ? 'Schleppg.' : 'Giebelg.'}
                </button>
              ))}
            </div>

            {openings.map((o) => (
              <button
                key={o.id}
                onClick={() => setSelection({ kind: 'roofOpening', id: o.id })}
                className="flex w-full items-baseline gap-1.5 rounded px-1 py-0.5 text-left transition-colors hover:bg-white/[0.06]"
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: o.kind === 'skylight' ? '#38BDF8' : '#FBBF24' }}
                />
                <span className="min-w-0 flex-1 truncate text-[10px] text-slate-400">
                  {ROOF_OPENING_LABELS[o.kind]}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-slate-300">
                  {(o.width * 100).toFixed(0)}×{(o.depth * 100).toFixed(0)}
                </span>
              </button>
            ))}

            {openings.length === 0 && (
              <p className="text-[9.5px] leading-relaxed text-slate-600">
                Ein Dachfenster ersetzt ein Stück Dachfläche durch Glas. Eine Gaube hebt den Raum
                an — sie schafft Stehhöhe und bringt Front, Wangen und ein eigenes Dach mit.
              </p>
            )}
          </div>

          {/* Abgeleitetes */}
          <div className="space-y-1 rounded-lg bg-accent/[0.07] p-2.5">
            <div className="label-xs">Ergibt sich daraus</div>
            <Readout label="Firsthöhe" value={frame ? `${frame.ridgeHeight.toFixed(2)} m` : '—'} />
            <Readout label="Dachfläche" value={`${totals.sloped.toFixed(2)} m²`} />
            {totals.flat > 0.01 && (
              <Readout label="davon waagerecht" value={`${totals.flat.toFixed(2)} m²`} />
            )}
            <Readout label="Grundfläche" value={`${totals.area.toFixed(2)} m²`} />
            <Readout label="Wohnfläche WoFlV" value={`${totals.living.toFixed(2)} m²`} />
            {totals.below1 > 0.01 && (
              <Readout label="unter 1,00 m" value={`${totals.below1.toFixed(2)} m²`} />
            )}
            {totals.skylight > 0.01 && (
              <Readout label="Dachfenster" value={`${totals.skylight.toFixed(2)} m²`} />
            )}
            {totals.dormerFront > 0.01 && (
              <Readout label="Gaubenfronten" value={`${totals.dormerFront.toFixed(2)} m²`} />
            )}
            <Readout label="Luftvolumen" value={`${totals.volume.toFixed(2)} m³`} />
            {totals.dormerVolume > 0.01 && (
              <Readout label="davon durch Gauben" value={`${totals.dormerVolume.toFixed(2)} m³`} />
            )}
          </div>

          <p className="text-[9.5px] leading-relaxed text-slate-600">
            Die Wohnfläche folgt WoFlV §4: über 2,00 m voll, 1,00 bis 2,00 m zur Hälfte, darunter
            gar nicht. Sie steht neben der Grundfläche und ersetzt sie nicht — die Heizlast rechnet
            weiter mit Grundfläche und Volumen.
          </p>
        </>
      )}
    </div>
  );
}

function Field({
  label,
  term,
  unit,
  value,
  min,
  max,
  step,
  hint,
  onChange,
}: {
  label: string;
  term?: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  step: number;
  hint?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="label-xs flex items-center gap-1">
          {label}
          {term && <Erklaerung term={term} />}
        </span>
        <span className="text-[11px] tabular-nums text-slate-200">
          {step < 1 ? value.toFixed(2) : value.toFixed(0)} {unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full accent-accent"
      />
      {hint && <p className="text-[9.5px] leading-relaxed text-slate-600">{hint}</p>}
    </div>
  );
}

function NumberRow({
  label,
  unit,
  value,
  onChange,
}: {
  label: string;
  unit: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="min-w-0 flex-1 truncate text-[10.5px] text-slate-400">{label}</span>
      <input
        type="number"
        step={0.01}
        min={0}
        value={value}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v) && v >= 0) onChange(v);
        }}
        className="w-16 rounded-md bg-graphite-900/60 px-1.5 py-1 text-right text-[10.5px] tabular-nums text-slate-200 outline-none focus:bg-graphite-900"
      />
      <span className="w-14 shrink-0 text-[9px] text-slate-600">{unit}</span>
    </div>
  );
}

function Readout({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between text-[10.5px]">
      <span className="text-slate-500">{label}</span>
      <span className="tabular-nums text-slate-200">{value}</span>
    </div>
  );
}

/** Kleine Schnittzeichnung der Dachform — schneller erfasst als der Name. */
function RoofIcon({ kind, active }: { kind: RoofKind; active: boolean }) {
  const stroke = active ? '#38BDF8' : '#64748B';
  const paths: Record<RoofKind, string> = {
    flat: 'M2 8h16M4 8v6M16 8v6',
    gable: 'M2 9l8-5 8 5M4 9v5M16 9v5',
    monopitch: 'M2 13L18 4M4 13v1M18 4v10',
    hip: 'M2 10l4-4h8l4 4M4 10v4M16 10v4',
    // Krüppelwalm: Giebel bis auf halbe Höhe, darüber abgewalmt — die kurze
    // Schräge oben ist genau das, was die Form ausmacht.
    krueppelwalm: 'M2 11l5-4h6l5 4M7 7l1.5-2h3L13 7M4 11v3M16 11v3',
    // Mansarde: unten steil, oben flach, mit Knick.
    mansard: 'M2 14l3-5h10l3 5M5 9l5-4 5 4M4 14v1M16 14v1',
    // Flachdach mit Gefälle: die Linie fällt sichtbar, bleibt aber flach.
    'flat-sloped': 'M2 7l16 2M4 8v6M16 9v5',
  };
  return (
    <svg viewBox="0 0 20 18" className="h-4 w-5 shrink-0" fill="none" stroke={stroke} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <path d={paths[kind]} />
    </svg>
  );
}
