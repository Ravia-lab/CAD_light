/**
 * HeatPumpPanel — Wärmepumpe und Außenanlage.
 *
 * Die eigentliche Frage bei einer Luft-Wärmepumpe ist nicht, welches Gerät
 * es wird, sondern **wo es stehen darf**. Darüber entscheiden drei Dinge, die
 * nichts miteinander zu tun haben und trotzdem gleichzeitig stimmen müssen:
 * der Schall am Nachbarfenster, der Schutzbereich bei Propan und die
 * Abstandsfläche der Landesbauordnung.
 *
 * Dieses Panel beantwortet die erste beiden Fragen mit einer Zahl und einer
 * Ampel — und der Plan zeigt dazu den Kreis, ab dem es passt. Damit lässt
 * sich der Standort verschieben, bis es stimmt, statt hinterher zu streiten.
 *
 * Was es *nicht* ist: ein Schallgutachten. Das überschlägige Verfahren der
 * TA Lärm liegt bei etwa ±3 dB, und im Grenzfall ist die ausführliche
 * Prognose zu rechnen. Das steht auch so im Panel.
 */

import { useMemo } from 'react';
import type { AreaCategory, HeatSourceKind, MountingSituation, SoilKind } from '../types/bim';
import {
  AREA_CATEGORY_LABELS,
  HEAT_SOURCE_LABELS,
  MOUNTING_LABELS,
  SITE_ELEMENT_LABELS,
  SOIL_LABELS,
} from '../types/bim';
import {
  acousticReport,
  IMMISSION_LIMITS,
  polygonArea,
  protectionIssues,
  requiredCapacity,
  ROOM_ANGLE,
  sourceDemand,
  waterProtectionVerdict,
} from '../lib/heatPump';
import { anschlussVonGeraet, nennweiteAusText, NENNWEITE_GEWINDE } from '../lib/anschlussgroesse';
import { findModel } from '../lib/deviceCatalog';
import { useBimStore } from '../store/useBimStore';
import Erklaerung from './Erklaerung';

const AREAS: AreaCategory[] = ['WR', 'WA', 'WS', 'MI', 'MD', 'MK', 'MU', 'GE', 'GI', 'KUR'];
const SOURCES: HeatSourceKind[] = ['air', 'brine-borehole', 'brine-collector', 'groundwater'];
const MOUNTINGS: MountingSituation[] = ['free', 'wall', 'corner', 'niche'];
const SOILS: SoilKind[] = ['dry', 'normal', 'conductive', 'saturated'];

const fmt = (v: number, d = 1): string =>
  v.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });

export default function HeatPumpPanel() {
  const doc = useBimStore((s) => s.doc);
  const updateSite = useBimStore((s) => s.updateSite);
  const updateHeatPump = useBimStore((s) => s.updateHeatPump);
  const setTool = useBimStore((s) => s.setTool);
  const setSiteKind = useBimStore((s) => s.setSiteKind);
  const siteKind = useBimStore((s) => s.siteKind);
  const setSelection = useBimStore((s) => s.setSelection);
  const selection = useBimStore((s) => s.selection);

  const site = doc.site;
  const pumps = useMemo(() => Object.values(site.pumps), [site.pumps]);
  const pump = useMemo(
    () => (selection?.kind === 'heatpump' ? site.pumps[selection.id] : undefined) ?? pumps[0],
    [selection, site.pumps, pumps],
  );

  const report = useMemo(() => (pump ? acousticReport(doc, pump) : undefined), [doc, pump]);
  const protection = useMemo(() => (pump ? protectionIssues(doc, pump) : []), [doc, pump]);
  const demand = useMemo(() => (pump ? sourceDemand(doc, pump) : undefined), [doc, pump]);
  const water = useMemo(
    () => (pump ? waterProtectionVerdict(site.waterProtection, pump.source) : undefined),
    [site.waterProtection, pump],
  );
  const heatLoad = useMemo(() => {
    // Grobe Gebäudeheizlast als Anhalt: 
    // Hüllfläche × mittlerem U-Wert wäre genauer, kommt aber aus dem Export.
    // Hier genügt die installierte Leistung als Vergleichswert.
    return Object.values(doc.fixtures).reduce((sum, f) => sum + (f.params.powerW ?? 0), 0) / 1000;
  }, [doc.fixtures]);

  const elements = useMemo(() => Object.values(site.elements), [site.elements]);
  const hasBoundary = elements.some((e) => e.kind === 'boundary');

  /*
   * Das Katalogmodell, aus dem die Anschlussgröße vorbelegt wird.
   *
   * Nur das **ausdrücklich gewählte**: Solange im Anlagenblatt kein Gerät
   * steht, schlägt die Anlagenauslegung zwar eines vor, aber ein Vorschlag
   * ist keine Aussage über das Gerät, das hier aufgestellt wird. Eine
   * Vorbelegung aus einem Vorschlag stünde nach dem ersten Klick als
   * scheinbar erfasster Datenblattwert im Feld.
   */
  const katalogModell = useMemo(
    () => (doc.plant?.generatorModelId ? findModel(doc.plant.generatorModelId, doc.plant.extraModels) : undefined),
    [doc.plant?.generatorModelId, doc.plant?.extraModels],
  );
  /** Was das Gerät heute sagt — und woher es kommt. */
  const anschluss = useMemo(
    () => anschlussVonGeraet(pump, katalogModell),
    [pump, katalogModell],
  );

  return (
    <div className="space-y-3 p-3">
      <span className="label-xs block">Grundstück</span>

      <div>
        <span className="label-xs mb-1 flex items-center gap-1">
          Gebietstyp
          <Erklaerung term="ta-laerm" />
        </span>
        <select
          className="field"
          value={site.areaCategory}
          onChange={(e) => updateSite({ areaCategory: e.target.value as AreaCategory })}
        >
          {AREAS.map((a) => (
            <option key={a} value={a} className="bg-graphite-850">
              {AREA_CATEGORY_LABELS[a]} — nachts {IMMISSION_LIMITS[a][1]} dB(A)
            </option>
          ))}
        </select>
        <p className="mt-1 text-[9.5px] leading-relaxed text-slate-600">
          Steht im Bebauungsplan. Ohne Festsetzung zählt, wie das Gebiet tatsächlich genutzt wird.
        </p>
      </div>

      {/* --- Baugrund ----------------------------------------------------
          Der Baugrund gehört zum Grundstück, nicht zum Gerät: die Bodenart
          trägt die Entzugsleistung der Wärmequelle *und* die Erdreichrechnung
          der Heizlast, und die zweite gibt es auch dann, wenn nie eine
          Wärmepumpe gesetzt wird. Deshalb steht er hier oben und nicht mehr
          unter „Wärmequelle", wo er nur bei einer Sole- oder Wasseranlage
          sichtbar war. */}
      <div className="space-y-2 rounded-lg bg-white/[0.03] p-2.5">
        <div className="label-xs">Baugrund</div>
        <Row label="Bodenart">
          <select
            className="field"
            value={site.soil}
            onChange={(e) => updateSite({ soil: e.target.value as SoilKind })}
          >
            {SOILS.map((k) => (
              <option key={k} value={k} className="bg-graphite-850">
                {SOIL_LABELS[k]}
              </option>
            ))}
          </select>
        </Row>
        <NumOptional
          label="Grundwasserstand unter Gelände"
          unit="m"
          value={site.groundwaterDepth}
          step={0.5}
          onChange={(v) => updateSite({ groundwaterDepth: v })}
        />
        <p className="text-[9.5px] leading-relaxed text-slate-600">
          Tiefe des Grundwasserspiegels unter Geländeoberkante — sie steht im Bodengutachten
          oder in der Bohranzeige und entscheidet über die Grundwasserkorrektur der
          Erdreichrechnung. Leer lassen, wenn sie nicht erfasst ist: der Export meldet dann
          „nicht erfasst" statt einer geratenen Tiefe.
        </p>
      </div>

      <div className="flex gap-1.5">
        <button
          className={`chip flex-1 ${hasBoundary ? 'bg-white/[0.05] text-slate-300' : 'bg-accent/12 text-accent'}`}
          onClick={() => {
            setSiteKind('boundary');
            setTool('site');
          }}
        >
          {hasBoundary ? 'Grenze neu zeichnen' : 'Grundstücksgrenze zeichnen'}
        </button>
        <button
          className="chip flex-1 bg-accent/12 text-accent"
          onClick={() => setTool('heatpump')}
        >
          Wärmepumpe setzen
        </button>
      </div>

      {!hasBoundary && (
        <p className="rounded-lg bg-amber-500/10 px-2.5 py-2 text-[10px] leading-relaxed text-amber-200/80">
          Ohne Grundstücksgrenze kann der Schallnachweis nichts prüfen: der maßgebliche Ort liegt
          beim Nachbarn. Grenze umfahren — auf den ersten Punkt klicken schließt die Fläche.
        </p>
      )}

      {!pump && (
        <p className="rounded-lg bg-white/[0.03] px-2.5 py-2 text-[10px] leading-relaxed text-slate-500">
          Noch keine Wärmepumpe gesetzt. Mit „Wärmepumpe setzen" in den Plan klicken — der Kreis
          um das Gerät zeigt dann, ab welchem Abstand der Nachtwert eingehalten ist.
        </p>
      )}

      {pump && report && (
        <>
          {/* --- Schallnachweis ------------------------------------------- */}
          <div
            className={`rounded-lg p-2.5 ${
              report.points.some((p) => p.verdict === 'exceeded')
                ? 'bg-rose-500/10'
                : report.points.some((p) => p.verdict === 'tight')
                  ? 'bg-amber-500/10'
                  : 'bg-emerald-500/10'
            }`}
          >
            <div className="label-xs mb-1.5 flex items-center gap-1">
              Schallnachweis nachts
              <Erklaerung term="ta-laerm" />
            </div>
            {report.points.length === 0 && (
              <p className="text-[10px] leading-relaxed text-slate-400">
                Kein Immissionsort vorhanden. Grenze zeichnen oder einen Immissionsort setzen.
              </p>
            )}
            {report.points.map((point) => (
              <div key={point.label + point.distance} className="mb-1 last:mb-0">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 flex-1 truncate text-[10.5px] text-slate-300">
                    {point.label}
                  </span>
                  <span
                    className={`tabular-nums text-[11px] ${
                      point.verdict === 'exceeded'
                        ? 'text-rose-300'
                        : point.verdict === 'tight'
                          ? 'text-amber-300'
                          : 'text-emerald-300'
                    }`}
                  >
                    {fmt(point.level)} dB(A)
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-2 text-[9.5px] text-slate-500">
                  <span>{fmt(point.distance, 2)} m Abstand</span>
                  <span>Richtwert {point.limit} dB(A)</span>
                </div>
                <p className="mt-0.5 text-[9.5px] leading-relaxed text-slate-500">
                  {point.verdict === 'exceeded'
                    ? `Überschritten. Für den Richtwert wären ${fmt(report.limitDistance, 1)} m nötig, für die empfohlene Reserve ${fmt(point.requiredForIrrelevance, 1)} m.`
                    : point.verdict === 'tight'
                      ? `Richtwert gehalten, aber ohne Reserve. Behörden erwarten meist 6 dB Abstand zum Richtwert — dafür wären ${fmt(point.requiredForIrrelevance, 1)} m nötig.`
                      : 'Eingehalten, mit Reserve für weitere Geräte in der Nachbarschaft.'}
                </p>
              </div>
            ))}
            <div className="mt-2 border-t border-white/[0.08] pt-1.5 text-[9.5px] leading-relaxed text-slate-500">
              Rechenweg: {fmt(report.soundPower, 0)} dB(A) Schallleistung + {report.roomAngle} dB
              Aufstellung − 20·lg(Abstand) − 11 dB. Überschlägiges Verfahren der TA Lärm
              (Anhang A.2.4.3), Genauigkeit etwa ±3 dB — im Grenzfall gehört ein Gutachten dazu.
            </div>
          </div>

          {/* --- Gerät ---------------------------------------------------- */}
          <div className="space-y-2">
            <div className="label-xs">Gerät</div>
            <Row label="Wärmequelle">
              <select
                className="field"
                value={pump.source}
                onChange={(e) => updateHeatPump(pump.id, { source: e.target.value as HeatSourceKind })}
              >
                {SOURCES.map((k) => (
                  <option key={k} value={k} className="bg-graphite-850">
                    {HEAT_SOURCE_LABELS[k]}
                  </option>
                ))}
              </select>
            </Row>
            <Num
              label="Schallleistung, lautester Betrieb"
              term="schallleistung"
              unit="dB(A)"
              value={pump.soundPower}
              step={1}
              onChange={(v) => updateHeatPump(pump.id, { soundPower: v })}
            />
            <Num
              label="davon im Nachtbetrieb"
              unit="dB(A)"
              value={pump.soundPowerNight ?? pump.soundPower}
              step={1}
              onChange={(v) => updateHeatPump(pump.id, { soundPowerNight: v })}
            />
            <label className="flex items-center gap-2 text-[10.5px] text-slate-400">
              <input
                type="checkbox"
                checked={pump.nightModeGuaranteed}
                onChange={(e) => updateHeatPump(pump.id, { nightModeGuaranteed: e.target.checked })}
              />
              <span>Nachtabsenkung fest eingestellt</span>
            </label>
            <p className="text-[9.5px] leading-relaxed text-slate-600">
              Nur dann darf mit dem leiseren Wert gerechnet werden. Sonst gilt der lauteste
              Betriebszustand — die Anlage könnte ja nachts hochlaufen.
            </p>

            <Row label="Aufstellung">
              <select
                className="field"
                value={pump.mounting}
                onChange={(e) => updateHeatPump(pump.id, { mounting: e.target.value as MountingSituation })}
              >
                {MOUNTINGS.map((m) => (
                  <option key={m} value={m} className="bg-graphite-850">
                    {MOUNTING_LABELS[m]} · +{ROOM_ANGLE[m]} dB
                  </option>
                ))}
              </select>
            </Row>
            <p className="text-[9.5px] leading-relaxed text-slate-600">
              Jede Fläche, die den Schall zurückwirft, macht es lauter. Boden allein +3 dB, Boden
              und Wand +6, eine Ecke +9 — das sind drei Meter Abstand Unterschied.
            </p>

            <Num
              label="Ausblasrichtung"
              term="azimut"
              unit="°"
              value={pump.azimuth}
              step={15}
              onChange={(v) => updateHeatPump(pump.id, { azimuth: ((v % 360) + 360) % 360 })}
            />
            <Num
              label="Heizleistung im Auslegungspunkt"
              unit="kW"
              value={pump.heatingCapacity}
              step={0.5}
              onChange={(v) => updateHeatPump(pump.id, { heatingCapacity: v })}
            />
            <Num
              label={`Leistungszahl bei ${pump.ratingPoint}`}
              term="cop"
              unit="—"
              value={pump.cop}
              step={0.1}
              onChange={(v) => updateHeatPump(pump.id, { cop: v })}
            />
            <div className="rounded-lg bg-white/[0.03] px-2.5 py-2 text-[10px] leading-relaxed text-slate-400">
              Erforderlich nach Faustformel: {fmt(requiredCapacity(heatLoad, pump), 1)} kW
              <span className="text-slate-600">
                {' '}
                — Heizlast {fmt(heatLoad, 1)} kW
                {pump.domesticHotWater ? ` + ${fmt(0.2 * pump.occupants, 1)} kW Warmwasser` : ''}
                {pump.gridRegime === 'evu-3x2h' ? ' × Sperrzeitfaktor' : ''}
              </span>
            </div>

            {/* --- Heizungsanschluss -------------------------------------
                Die Angabe, um die ein Heizungsfachplaner ausdrücklich
                gebeten hat: „Bei der Wärmepumpe brauche ich eine
                Anschlussgröße; die meisten Anbieter sagen hier mindestens
                1 Zoll." Sie ist keine Zierde für das Anlagenbuch — die
                Leitung ab dem Erzeuger darf sie nicht unterschreiten, und
                genau das rechnet die Auslegung seit 1.24.0 nach.

                Zwei Felder und nicht eines: Der Klartext ist das, was im
                Datenblatt steht und was der Monteur am Gerät wiederfindet;
                die Nennweite ist die Zahl, mit der sich rechnen lässt. Aus
                dem Text wird die Zahl abgeleitet, sobald er sich deuten
                lässt — sichtbar, damit eine danebenliegende Deutung
                auffällt und von Hand korrigiert werden kann. */}
            <div className="space-y-2 rounded-lg bg-white/[0.03] p-2.5">
              <div className="label-xs">Heizungsanschluss</div>

              <label className="block">
                <span className="label-xs mb-1 block">Anschlussgröße laut Datenblatt</span>
                <input
                  type="text"
                  className="field min-h-[44px]"
                  value={pump.hydraulicConnection ?? ''}
                  placeholder={
                    katalogModell ? `${katalogModell.hydraulicConnection} (Katalog)` : 'nicht erfasst'
                  }
                  onChange={(e) => {
                    const text = e.target.value;
                    // Leer heißt leer und nicht 0: Ein nicht ausgefülltes
                    // Feld muss vom Wert „keine Größe" unterscheidbar
                    // bleiben, sonst rechnet die Auslegung mit einer
                    // Mindestnennweite, die niemand eingetragen hat.
                    if (text.trim() === '') {
                      updateHeatPump(pump.id, { hydraulicConnection: undefined, connectionDn: undefined });
                      return;
                    }
                    const gedeutet = nennweiteAusText(text);
                    updateHeatPump(pump.id, {
                      hydraulicConnection: text,
                      // Nur überschreiben, wenn der Text etwas hergibt.
                      // Sonst bliebe eine von Hand gesetzte Nennweite beim
                      // Tippen des Klartextes auf der Strecke.
                      ...(gedeutet !== undefined ? { connectionDn: gedeutet } : {}),
                    });
                  }}
                />
              </label>

              <label className="block">
                <span className="label-xs mb-1 block">Nennweite</span>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    className="field min-h-[44px] flex-1"
                    value={pump.connectionDn ?? ''}
                    step={1}
                    min={8}
                    list="anschluss-nennweiten"
                    placeholder={
                      katalogModell && anschluss.herkunft === 'katalog' && anschluss.dn !== undefined
                        ? `${anschluss.dn} (Katalog)`
                        : 'nicht erfasst'
                    }
                    onChange={(e) =>
                      updateHeatPump(pump.id, {
                        connectionDn: e.target.value === '' ? undefined : Number(e.target.value),
                      })
                    }
                  />
                  <span className="w-6 shrink-0 text-[9.5px] text-slate-600">mm</span>
                </div>
              </label>
              <datalist id="anschluss-nennweiten">
                {[...NENNWEITE_GEWINDE].map(([dn, gewinde]) => (
                  <option key={dn} value={dn} label={`DN ${dn} · ${gewinde}`} />
                ))}
              </datalist>

              {/* Die Deutung sichtbar machen — sie ist der Punkt, an dem ein
                  Missverständnis auffliegt. „Cu 28 × 1,0" als DN 25 zu lesen
                  ist richtig; wer hier DN 28 erwartet hat, sieht es sofort. */}
              {pump.hydraulicConnection && nennweiteAusText(pump.hydraulicConnection) !== undefined ? (
                <p className="text-[9.5px] leading-relaxed text-emerald-400/70">
                  „{pump.hydraulicConnection}" gelesen als DN{' '}
                  {nennweiteAusText(pump.hydraulicConnection)}. Stimmt das nicht, die Nennweite
                  darunter von Hand setzen — sie gilt.
                </p>
              ) : pump.hydraulicConnection ? (
                <p className="text-[9.5px] leading-relaxed text-amber-400/80">
                  „{pump.hydraulicConnection}" lässt sich nicht in eine Nennweite umsetzen. Der Text
                  steht im Anlagenbuch, wirkt aber nur auf die Rohrauslegung, wenn die Nennweite
                  darunter eingetragen ist. Gebräuchlich: „G 1¼ AG", „DN 32", „Cu 28 × 1,0".
                </p>
              ) : (
                <p className="text-[9.5px] leading-relaxed text-slate-600">
                  Ohne Angabe wird nichts angenommen — die Leitung ab dem Erzeuger wird dann rein
                  hydraulisch ausgelegt. Marktüblich sind bei 5 bis 16 kW G 1" bis G 1¼" (DN 25 bis
                  DN 32); genormt ist das nicht, maßgeblich bleibt das Datenblatt.
                </p>
              )}

              {anschluss.herkunft === 'katalog' && anschluss.dn !== undefined && (
                <Readout label="aus dem Katalogmodell" value={`DN ${anschluss.dn} · ${anschluss.text ?? ''}`} />
              )}
            </div>
          </div>

          {/* --- Kältemittel ---------------------------------------------- */}
          <div className="space-y-2 border-t border-white/[0.06] pt-3">
            <div className="label-xs flex items-center gap-1">
              Kältemittel
              <Erklaerung term="schutzbereich" />
            </div>
            <Row label="Kältemittel">
              <select
                className="field"
                value={pump.refrigerant}
                onChange={(e) => updateHeatPump(pump.id, { refrigerant: e.target.value as 'R290' })}
              >
                {['R290', 'R32', 'R410A', 'R744', 'andere'].map((r) => (
                  <option key={r} value={r} className="bg-graphite-850">
                    {r}
                    {r === 'R290' ? ' (Propan, brennbar)' : r === 'R32' ? ' (schwer entflammbar)' : ''}
                  </option>
                ))}
              </select>
            </Row>
            <Num
              label="Schutzbereich, Radius"
              unit="m"
              value={pump.protectionRadius}
              step={0.1}
              onChange={(v) => updateHeatPump(pump.id, { protectionRadius: v })}
            />
            <p className="text-[9.5px] leading-relaxed text-slate-600">
              Herstellerangabe aus der Montageanleitung — es gibt dafür keine Normtabelle. Verbreitet
              sind 1,00 m waagerecht ab Aufstellfläche.
            </p>

            {protection.length > 0 ? (
              <div className="rounded-lg bg-rose-500/10 p-2.5">
                <div className="text-[10.5px] font-medium text-rose-300">
                  Schutzbereich verletzt
                </div>
                {protection.map((issue, i) => (
                  <div key={i} className="mt-1 text-[10px] leading-relaxed text-slate-300">
                    {issue.label} liegt {fmt(issue.distance, 2)} m entfernt — nötig sind{' '}
                    {fmt(issue.required, 2)} m.
                  </div>
                ))}
                <p className="mt-1.5 text-[9.5px] leading-relaxed text-slate-500">
                  Propan ist schwerer als Luft. Es sinkt und sammelt sich unten — im Lichtschacht,
                  im Kellerabgang, im Bodenablauf. Gerät verschieben oder die Öffnung dicht
                  ausführen.
                </p>
              </div>
            ) : (
              <p className="text-[9.5px] leading-relaxed text-emerald-400/70">
                Keine Öffnung und keine Grenze im Schutzbereich.
              </p>
            )}
          </div>

          {/* --- Wärmequelle ---------------------------------------------- */}
          {pump.source !== 'air' && (
            <div className="space-y-2 border-t border-white/[0.06] pt-3">
              <div className="label-xs flex items-center gap-1">
                Wärmequelle
                <Erklaerung term="entzugsleistung" />
              </div>
              <Readout label="Untergrund" value={SOIL_LABELS[site.soil]} />
              <p className="text-[9.5px] leading-relaxed text-slate-600">
                Oben unter „Baugrund" eingestellt. Dieselbe Angabe trägt hier die Entzugsleistung
                und im Export die Erdreichrechnung — zweimal erfasst hieße irgendwann zweierlei.
              </p>
              <div className="flex gap-0.5 rounded-lg bg-graphite-900/60 p-0.5">
                {([1800, 2400] as const).map((h) => (
                  <button
                    key={h}
                    onClick={() => updateSite({ sourceRunHours: h })}
                    className={`chip flex-1 ${
                      site.sourceRunHours === h ? 'bg-accent/15 text-accent' : 'text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    {h} h/a {h === 1800 ? 'ohne' : 'mit'} Warmwasser
                  </button>
                ))}
              </div>

              {demand && (
                <div className="rounded-lg bg-white/[0.03] p-2.5">
                  <Readout label="Entzugsleistung" value={`${fmt(demand.extraction, 2)} kW`} />
                  {demand.boreholeMetres !== undefined && (
                    <>
                      <Readout label="spezifisch" value={`${demand.specific} W/m`} />
                      <Readout label="Sondenmeter nötig" value={`${fmt(demand.boreholeMetres, 0)} m`} accent />
                      <Readout label="gezeichnet" value={`${fmt(demand.plannedMetres ?? 0, 0)} m`} />
                    </>
                  )}
                  {demand.collectorArea !== undefined && (
                    <>
                      <Readout label="spezifisch" value={`${demand.specific} W/m²`} />
                      <Readout label="Kollektorfläche nötig" value={`${fmt(demand.collectorArea, 0)} m²`} accent />
                      <Readout label="gezeichnet" value={`${fmt(demand.plannedArea ?? 0, 0)} m²`} />
                    </>
                  )}
                  {demand.flowRate !== undefined && (
                    <Readout label="Fördermenge nötig" value={`${fmt(demand.flowRate, 2)} m³/h`} accent />
                  )}
                  <p
                    className={`mt-1.5 text-[9.5px] leading-relaxed ${
                      demand.sufficient ? 'text-emerald-400/70' : 'text-amber-300/80'
                    }`}
                  >
                    {demand.sufficient
                      ? 'Die gezeichnete Quelle reicht.'
                      : 'Die gezeichnete Quelle reicht noch nicht — im Plan ergänzen.'}
                  </p>
                  {!demand.tableApplicable && (
                    <p className="mt-1 text-[9.5px] leading-relaxed text-amber-300/80">
                      Über 30 kW oder mehr als fünf Sonden: die Tabellenauslegung nach VDI 4640
                      reicht hier nicht mehr, es ist zu simulieren.
                    </p>
                  )}
                </div>
              )}

              <Row label="Wasserschutzgebiet">
                <select
                  className="field"
                  value={site.waterProtection}
                  onChange={(e) => updateSite({ waterProtection: e.target.value as 'none' })}
                >
                  {[
                    ['none', 'außerhalb'],
                    ['I', 'Zone I'],
                    ['II', 'Zone II'],
                    ['III', 'Zone III'],
                    ['IIIA', 'Zone III A'],
                    ['IIIB', 'Zone III B'],
                  ].map(([v, l]) => (
                    <option key={v} value={v} className="bg-graphite-850">
                      {l}
                    </option>
                  ))}
                </select>
              </Row>
              {water && (
                <p
                  className={`rounded-lg px-2.5 py-2 text-[10px] leading-relaxed ${
                    water.allowed === 'nein'
                      ? 'bg-rose-500/10 text-rose-200/80'
                      : 'bg-amber-500/10 text-amber-200/80'
                  }`}
                >
                  {water.note}
                </p>
              )}
            </div>
          )}
        </>
      )}

      {/* --- Ausgewähltes Objekt ------------------------------------------ */}
      {selection?.kind === 'site' && site.elements[selection.id] && (
        <SiteElementEditor id={selection.id} />
      )}

      {/* --- Objekte im Gelände ------------------------------------------- */}
      <div className="border-t border-white/[0.06] pt-3">
        <div className="label-xs mb-1.5">Ins Gelände zeichnen</div>
        <div className="grid grid-cols-2 gap-1">
          {(
            [
              'immission-point',
              'hazard-opening',
              'neighbour-building',
              'tree',
              'borehole',
              'collector',
              'well-supply',
              'well-injection',
              'utility-line',
              'paved',
            ] as const
          ).map((kind) => (
            <button
              key={kind}
              onClick={() => {
                setSiteKind(kind);
                setTool('site');
              }}
              className={`chip justify-start truncate ${
                siteKind === kind ? 'bg-accent/15 text-accent' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {SITE_ELEMENT_LABELS[kind]}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[9.5px] leading-relaxed text-slate-600">
          Ein Immissionsort ist der Punkt 0,5 m vor dem Fenster des nächsten schutzbedürftigen
          Raums beim Nachbarn — Schlafen, Wohnen, Kinderzimmer. Ist keiner gesetzt, rechnet das
          Programm ersatzweise gegen die Grundstücksgrenze.
        </p>

        {elements.length > 0 && (
          <div className="mt-2 space-y-0.5">
            {elements.map((element) => (
              <button
                key={element.id}
                onClick={() => setSelection({ kind: 'site', id: element.id })}
                className="flex w-full items-baseline gap-2 rounded px-1.5 py-1 text-left transition-colors hover:bg-white/[0.05]"
              >
                <span className="min-w-0 flex-1 truncate text-[10px] text-slate-400">
                  {element.label ?? SITE_ELEMENT_LABELS[element.kind]}
                </span>
                <span className="shrink-0 text-[9.5px] text-slate-600">
                  {element.points.length > 2 ? `${element.points.length} Punkte` : ''}
                  {element.depth ? ` ${fmt(element.depth, 1)} m tief` : ''}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Eigenschaften des ausgewählten Geländeobjekts.
 *
 * Bewusst hier und nicht im allgemeinen Inspektor: eine Sonde hat eine Tiefe,
 * ein Baum eine Krone, eine Leitung eine Art — mit den Feldern einer Wand hat
 * das nichts gemeinsam.
 */
function SiteElementEditor({ id }: { id: string }) {
  const element = useBimStore((s) => s.doc.site.elements[id]);
  const update = useBimStore((s) => s.updateSiteElement);
  if (!element) return null;

  const area = element.points.length >= 3 ? polygonArea(element.points) : 0;

  return (
    <div className="space-y-2 rounded-lg bg-white/[0.04] p-2.5">
      <div className="label-xs">{SITE_ELEMENT_LABELS[element.kind]}</div>
      <Row label="Bezeichnung">
        <input
          className="field"
          value={element.label ?? ''}
          onChange={(e) => update(id, { label: e.target.value })}
        />
      </Row>
      {(element.kind === 'borehole' ||
        element.kind === 'collector' ||
        element.kind === 'trench' ||
        element.kind === 'utility-line' ||
        element.kind === 'well-supply' ||
        element.kind === 'well-injection') && (
        <Num
          label={element.kind === 'borehole' ? 'Sondenlänge' : 'Tiefe'}
          unit="m"
          value={element.depth ?? 0}
          step={element.kind === 'borehole' ? 10 : 0.1}
          onChange={(v) => update(id, { depth: v })}
        />
      )}
      {(element.kind === 'tree' || element.kind === 'hazard-opening') && (
        <Num
          label={element.kind === 'tree' ? 'Kronenradius' : 'Öffnungsradius'}
          unit="m"
          value={element.radius ?? 0}
          step={0.1}
          onChange={(v) => update(id, { radius: v })}
        />
      )}
      {element.kind === 'collector' && (
        <Num
          label="Rohrabstand"
          unit="m"
          value={element.pipeSpacing ?? 0.6}
          step={0.1}
          onChange={(v) => update(id, { pipeSpacing: v })}
        />
      )}
      {element.kind === 'neighbour-building' && (
        <Num
          label="Höhe"
          unit="m"
          value={element.height ?? 7}
          step={0.5}
          onChange={(v) => update(id, { height: v })}
        />
      )}
      {area > 0 && (
        <Readout label="Fläche" value={`${fmt(area, 1)} m²`} accent />
      )}
      <p className="text-[9.5px] leading-relaxed text-slate-600">
        Mit dem Auswahl-Werkzeug verschieben, mit Entf löschen.
      </p>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label-xs mb-1 block">{label}</span>
      {children}
    </label>
  );
}

function Readout({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-0.5">
      <span className="text-[10px] text-slate-500">{label}</span>
      <span className={`tabular-nums text-[10.5px] ${accent ? 'text-accent' : 'text-slate-300'}`}>
        {value}
      </span>
    </div>
  );
}

/**
 * Zahleneingabe, die leer bleiben darf.
 *
 * `Num` kennt nur Zahlen. Beim Grundwasserstand ist „nicht erfasst" aber ein
 * eigener Zustand und keine 0 — null Meter unter Gelände hieße, das Wasser
 * steht an der Oberfläche. Ein leeres Feld schreibt deshalb `undefined`
 * zurück, und genau daran erkennt der Export, dass die Angabe fehlt.
 */
function NumOptional({
  label,
  unit,
  value,
  step,
  onChange,
}: {
  label: string;
  unit: string;
  value: number | undefined;
  step: number;
  onChange: (v: number | undefined) => void;
}) {
  // Beschriftung über dem Feld statt daneben: „Grundwasserstand unter
  // Gelände" passt in der schmalen Seitenspalte nicht in eine halbe Zeile,
  // und eine abgeschnittene Beschriftung ist keine.
  return (
    <label className="block">
      <span className="label-xs mb-1 block">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={value ?? ''}
          step={step}
          placeholder="nicht erfasst"
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
          className="field flex-1"
        />
        <span className="w-6 shrink-0 text-[9.5px] text-slate-600">{unit}</span>
      </div>
    </label>
  );
}

function Num({
  label,
  term,
  unit,
  value,
  step,
  onChange,
}: {
  label: string;
  term?: string;
  unit: string;
  value: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex min-w-0 flex-1 items-center gap-1 text-[10.5px] text-slate-400">
        <span className="min-w-0 truncate">{label}</span>
        {term && <Erklaerung term={term} />}
      </span>
      <input
        type="number"
        value={value}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="input h-6 w-20 text-[10px]"
      />
      <span className="w-12 shrink-0 text-[9.5px] text-slate-600">{unit}</span>
    </div>
  );
}
