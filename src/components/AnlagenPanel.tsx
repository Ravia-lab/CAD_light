/**
 * AnlagenPanel — das Anlagenblatt.
 * ---------------------------------------------------------------------------
 * Hier wird aus einem Grundriss eine Anlage. Der Reiter beantwortet in einer
 * Reihenfolge, die nicht beliebig ist, fünf Fragen:
 *
 *   1. Wie viel Leistung braucht das Haus?
 *   2. Welches Gerät kann das — bei der Norm-Außentemperatur, nicht auf dem
 *      Prospekt?
 *   3. Wie kommt die Wärme in die Räume? (Kreise, Volumenströme, Rohre)
 *   4. Wie viel Wasser steht in der Anlage, und wie wird sie abgesichert?
 *   5. Wie wird das Trinkwasser warm, ohne dass die Arbeitszahl einbricht?
 *
 * Alles darin ist gerechnet, nichts abgetippt. Was das Programm vorschlägt,
 * ist als Vorschlag gekennzeichnet und wird erst durch einen Klick Teil des
 * Projekts — der Unterschied zwischen „das Programm meint" und „so ist es
 * geplant" muss sichtbar bleiben.
 */

import { Fragment, useCallback, useMemo, useRef, useState } from 'react';
import type {
  AnlagenAntworten,
  BivalenzBetrieb,
  HeatPumpModel,
  HeatSourceKind,
  PipeMaterial,
  PumpForm,
  SecondGenerator,
  Vorhaben,
  ZweitErzeugerArt,
} from '../types/bim';
import {
  HEAT_SOURCE_LABELS,
  PIPE_MATERIAL_LABELS,
  PUMP_FORM_LABELS,
  VORHABEN_LABELS,
  ZWEITERZEUGER_LABELS,
} from '../types/bim';
import { mindestens } from '../lib/uimodus';
import { hatAusgangspunkt, schlageErzeugerVor } from '../lib/erzeugerplatz';
import { useBimStore } from '../store/useBimStore';
import type { GebaeudeNetzErgebnis } from '../lib/gebaeudeNetz';
import { HEAT_PUMP_SERIES, REFRIGERANTS, minimumRoomVolume } from '../lib/deviceCatalog';
import { buildSchematic, designPlant, type CircuitDesign } from '../lib/plantDesign';
import { pruefeSchema, type SchemaBefund } from '../lib/schemaPruefung';
import { abweichungen, antwortenDes } from '../lib/anlagenFragen';
import AnlagenFragen from './AnlagenFragen';
import { PRESET_VERDICT_LABELS, balanceNetwork } from '../lib/hydraulicBalance';
import { buildCsvTemplate, importDevices, mergeIntoCatalog, type DeviceImportReport } from '../lib/deviceImport';
import { buildMaterialSchedule, materialScheduleCsv } from '../lib/materialSchedule';
import { buildPlantBook, printPlantBook } from '../lib/plantBook';
import { buildRaviaExport } from '../lib/raviaExport';
import { buildPipeNetwork } from '../lib/pipeNetwork';
import { VORHABEN_VORBELEGUNG } from '../lib/plantDefaults';
import { systemtemperaturVon, type Temperaturherkunft } from '../lib/systemtemperatur';
import {
  BAUALTERSKLASSEN,
  BRENNSTOFF_EINHEIT,
  BRENNSTOFF_LABELS,
  heizlastAusBaualter,
  heizlastAusVerbrauch,
  verbrauchsabgleich,
  type Brennstoff,
} from '../lib/verbrauchsabgleich';
import Erklaerung from './Erklaerung';
import Protokoll from './Protokoll';
import { formteile, formteilSumme } from '../lib/formteile';
import { rohrlaenge, trassenlaenge } from '../lib/rohrlaenge';
import { BIVALENZ_HINDERNIS_TEXT } from '../lib/bivalenz';
import {
  ABGLEICHPFLICHT_AB,
  EINHEIT_LABELS,
  einheitenVonRaeumen,
  einheitenstand,
  einheitsbilanzen,
  type EinheitArt,
} from '../lib/nutzungseinheiten';

const fmt = (v: number | undefined, d = 1): string =>
  v === undefined || !Number.isFinite(v) ? '—' : v.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });

/**
 * Zeitstempel der Gegenstelle als Datum mit Uhrzeit.
 *
 * Mit Uhrzeit, nicht nur mit Datum: an einem Planungstag kommt dieselbe
 * Heizlast auch dreimal, und dann ist die Frage nicht „welcher Tag", sondern
 * „welcher Stand". Unlesbares bleibt weg — „Invalid Date" im Anlagenblatt
 * wäre schlimmer als eine fehlende Angabe.
 */
const zeitpunktDe = (iso: string): string | undefined => {
  const zeit = new Date(iso);
  if (Number.isNaN(zeit.getTime())) return undefined;
  return zeit.toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

/**
 * Woher die Last eines Kreises stammt, in einer Zeile.
 *
 * „teils gerechnet" ist der Fall, den man sehen muss: der Kreis versorgt
 * Räume mit und ohne gerechnete Heizlast. Für den Volumenstrom ist das
 * richtig — jeder Raum bekommt, was er braucht —, aber die Kreissumme darf
 * niemand als Norm-Heizlast des Geschosses weitergeben.
 */
const LOAD_SOURCE_LABELS: Record<CircuitDesign['loadSource'], string> = {
  norm: 'Last gerechnet',
  ueberschlag: 'Last überschlägig',
  gemischt: 'Last teils gerechnet, teils überschlägig',
  vorgabe: 'Last am Kreis vorgegeben',
};

/**
 * Eine Temperatur so, wie sie auf dem Blatt steht: 35, nicht 35,0 — aber 32,5.
 *
 * `fmt(v, 0)` wäre hier falsch: Es rundet, und aus einer Spreizung von 7,5 K
 * würde lautlos „8 K". Auf dem Blatt stünde dann eine Zahl, die sich mit
 * keinem Volumenstrom daneben nachrechnen lässt.
 */
const grad = (v: number): string => fmt(v, Number.isInteger(v) ? 0 : 1);

/**
 * Woher die maßgebliche Systemtemperatur stammt, in drei Worten.
 *
 * Die Angabe gehört neben die Zahl, weil die Zahl sonst wie eine Eintragung
 * aussieht. Wer im Anlagenblatt „50/40" liest, ohne zu erfahren, dass ein
 * Heizkörperkreis sie angehoben hat, sucht die 50 im Eingabefeld, findet dort
 * 35 und hält das Programm für kaputt — genau der Weg, auf dem der Befund
 * „sechs Spreizungen" bis 1.23.0 unentdeckt blieb.
 */
const TEMPERATURHERKUNFT_LABELS: Record<Temperaturherkunft, string> = {
  anlagenblatt: 'wie eingetragen',
  angehoben: 'von einem Heizkreis angehoben',
  vorgabe: 'Vorbelegung, noch nichts erfasst',
};

const SEVERITY_STYLE = {
  error: 'border-l-2 border-rose-400/70 bg-rose-400/[0.07] text-rose-200',
  warn: 'border-l-2 border-amber-400/70 bg-amber-400/[0.07] text-amber-200',
  info: 'border-l-2 border-white/15 bg-white/[0.03] text-slate-400',
} as const;

export default function AnlagenPanel() {
  const doc = useBimStore((s) => s.doc);
  const updatePlant = useBimStore((s) => s.updatePlant);
  const setVorhaben = useBimStore((s) => s.setVorhaben);
  const addPlantStorage = useBimStore((s) => s.addPlantStorage);
  const removePlantStorage = useBimStore((s) => s.removePlantStorage);
  const setPlantCircuits = useBimStore((s) => s.setPlantCircuits);
  const setSchematic = useBimStore((s) => s.setSchematic);
  const legeRohrnetzAus = useBimStore((s) => s.legeRohrnetzAus);
  /*
   * Ob die Flächenheizung mitgelegt wird. Vorgabe ja — wer sie nicht will,
   * nimmt den Haken weg; die Einstellung gehört zur Sitzung und nicht ins
   * Dokument, denn sie ist eine Absicht und keine Eigenschaft des Gebäudes.
   */
  const [mitFlaeche, setMitFlaeche] = useState(true);
  const setzeErzeugerNachVorschlag = useBimStore((s) => s.setzeErzeugerNachVorschlag);
  const updateMeta = useBimStore((s) => s.updateMeta);
  const [gegenprobeOffen, setGegenprobeOffen] = useState(false);
  /*
   * Der Vorschlag wird bei jeder Modelländerung neu bestimmt — er ist
   * billig (eine Schleife über die Räume) und verschwindet von selbst,
   * sobald ein Erzeuger steht.
   */
  const erzeugerVorschlag = useMemo(
    () => (hatAusgangspunkt(doc) ? undefined : schlageErzeugerVor(doc, doc.activeLevelId)),
    [doc],
  );
  const [rohrbericht, setRohrbericht] = useState<GebaeudeNetzErgebnis | null>(null);
  /** Steigleitung und Formteile des ganzen Netzes — nach jeder Auslegung neu. */
  const netzZahlen = useMemo(() => {
    const runs = Object.values(doc.pipes ?? {});
    const steig = runs
      .filter((r) => r.elevationTo !== undefined && trassenlaenge(r.points) <= 0.05)
      .reduce((s, r) => s + rohrlaenge(r), 0);
    return { steig, formteile: formteilSumme(formteile(runs, Object.values(doc.pipeAccessories ?? {}))) };
  }, [doc.pipes, doc.pipeAccessories]);
  const setStatus = useBimStore((s) => s.setStatus);
  const uiMode = useBimStore((s) => s.uiMode);
  const [seriesFilter, setSeriesFilter] = useState<string>('');
  const [open, setOpen] = useState<Record<string, boolean>>({ geraet: true, kreise: true });
  const [importReport, setImportReport] = useState<DeviceImportReport | null>(null);
  /**
   * Eingelesene Herstellergeräte für diese Sitzung.
   *
   * Sie landen bewusst nicht im Dokument: ein Katalog ist keine Projektdatei,
   * und ein Projekt, das seinen halben Gerätekatalog mitschleppt, wird beim
   * Export unnötig groß. Wer die Geräte behalten will, liest die Datei erneut
   * ein — sie liegt ja beim Datenblatt.
   */
  const [extra, setExtra] = useState<HeatPumpModel[]>([]);
  const dateiRef = useRef<HTMLInputElement>(null);

  const plant = doc.plant;

  const design = useMemo(
    () => designPlant(doc, { heatLoad: plant.heatLoadOverride, extraModels: [...extra, ...(plant.extraModels ?? [])] }),
    [doc, extra, plant.heatLoadOverride, plant.extraModels],
  );

  const matches = useMemo(
    () => (seriesFilter ? design.matches.filter((m) => m.model.series === seriesFilter) : design.matches),
    [design.matches, seriesFilter],
  );

  /**
   * Die **maßgebliche** Temperatur der Anlage — nicht die Zahl im Blatt.
   *
   * Sie steht hier einmal und wird im Panel an zwei Stellen gebraucht: in der
   * Anzeige neben den Eingabefeldern und im hydraulischen Abgleich. Zwei
   * getrennte Aufrufe wären fachlich dasselbe, aber genau so ist der Befund
   * entstanden, den `systemtemperatur.ts` behebt — eine Stelle, eine Zahl.
   */
  const systemtemp = useMemo(() => systemtemperaturVon(doc), [doc]);

  /*
   * **Die Gegenprobe zur Heizlast.** Bezugsgröße ist der Überschlag aus der
   * Hülle — nicht die eingetragene Zahl und nicht die raumweise Summe: Wer
   * eine Heizlast von Hand einträgt oder von RaVia bekommt, hat sie nicht
   * überschlagen, und dann vergliche die Gegenprobe sich mit sich selbst.
   * Gegengeprüft wird genau das, was dieses Programm selbst behauptet.
   */
  const abgleich = useMemo(() => {
    const ueberschlag = design.estimate?.total ?? 0;
    if (!(ueberschlag > 0)) return undefined;
    return verbrauchsabgleich(ueberschlag, [
      heizlastAusVerbrauch(doc.meta.verbrauch),
      heizlastAusBaualter(doc.meta.baualter, design.estimate?.heatedArea ?? 0, doc.meta.verbrauch?.mitWarmwasser ?? true),
    ]);
  }, [design.estimate, doc.meta.verbrauch, doc.meta.baualter]);

  /**
   * Weicht die Rechnung von der Eintragung ab?
   *
   * Der Vergleich läuft über beide Zahlen und nicht über `herkunft`: Die
   * Herkunft `vorgabe` bedeutet „im Modell steht nichts", und dann kann die
   * Vorbelegung zufällig dieselbe sein wie das Feld. Abweichung ist, was man
   * sieht, nicht wie sie zustande kam.
   */
  const temperaturWeichtAb =
    systemtemp.vorlauf !== plant.design.flowTemperature ||
    systemtemp.ruecklauf !== plant.design.returnTemperature;

  /**
   * Was ohne eigene Eintragung gälte — der Platzhalter im Eingabefeld.
   *
   * Seit die raumweisen Norm-Heizlasten die Gebäudeheizlast tragen können, ist
   * das nicht mehr zwangsläufig der Überschlag. Ein Platzhalter, der eine
   * andere Zahl zeigt als die, mit der gerechnet wird, ist eine Falle.
   */
  const ohneVorgabe =
    design.normCoverage.complete && design.normCoverage.total > 0 ? design.normCoverage.total : design.estimate?.total;

  /**
   * Der hydraulische Abgleich hängt am *gezeichneten* Rohrnetz, nicht an der
   * Auslegung. Ohne Leitungen im Plan gibt es nichts abzugleichen — dann
   * bleibt der Abschnitt leer und sagt, was fehlt.
   */
  const balance = useMemo(() => {
    const network = buildPipeNetwork(doc);
    if (!network.paths.length) return null;
    return balanceNetwork({
      network,
      fixtures: doc.fixtures,
      /*
       * Die Spreizung kommt aus `systemtemperaturVon` und **nicht** aus der
       * Differenz der beiden Eingabefelder.
       *
       * Hier stand bis 1.23.0 `Math.max(2, flowTemperature - returnTemperature)`
       * — die sechste Stelle desselben Fehlers. An einem Heizkörperhaus mit
       * 35/28 im Blatt rechnete dieser Abgleich mit 7 K, während der
       * Rohrnetzbericht zwei Abschnitte tiefer mit 10 K rechnete: derselbe
       * Knopf, zwei Volumenströme, und zwischen ihnen die 43 %, die über
       * V̇ = Q/(1,163·Δϑ) aus 10/7 folgen. Ein Voreinstellwert, der auf der
       * einen Seite passt und auf der anderen nicht, ist auf der Baustelle
       * schlimmer als gar keiner.
       */
      spread: systemtemp.spreizung,
      material: plant.design.material,
      maxVelocity: plant.design.maxVelocity,
      maxGradient: plant.design.maxGradient,
      // Der Verbraucher selbst zählt mit: ohne ihn fehlt dem ungünstigsten
      // Strang der größte Einzelposten und der Abgleich fällt zu gut aus.
      terminalLoss: 10000,
    });
  }, [doc, plant.design, systemtemp]);

  /**
   * Befunde der Schemaprüfung.
   *
   * Geprüft wird das Schema, das im Dokument steht — nicht das, was
   * `buildSchematic` gerade erzeugen würde. Wer von Hand nachgebessert hat,
   * will wissen, ob *sein* Bild trägt.
   */
  /**
   * Passende Schemavorlagen aus dem Katalog.
   *
   * Gerechnet wird gegen das **Auslegungsergebnis**, nicht gegen das
   * gezeichnete Schema: der Vorschlag soll sagen, was zur Anlage passt, und
   * nicht, was gerade auf dem Blatt steht.
   */
  /*
   * Die sieben Antworten.
   *
   * Stehen sie schon im Projekt, gelten sie. Fehlen sie — ältere Projektdatei
   * oder frisches Projekt —, werden sie aus dem gelesen, was an Speichern und
   * Kreisen da ist. So steht im Feld nie etwas anderes als in der Anlage.
   */
  const antworten = useMemo(
    () => antwortenDes(plant, design.selected?.model.form, design.selected?.model.refrigerant),
    [plant, design.selected],
  );
  const setzeAnlagenAntworten = useBimStore((s) => s.setzeAnlagenAntworten);
  const setzeAntwort = useCallback(
    (patch: Partial<AnlagenAntworten>) => setzeAnlagenAntworten({ ...antworten, ...patch }),
    [antworten, setzeAnlagenAntworten],
  );

  /** Wo die Antworten von der Auslegung abweichen — Sätze, keine Korrekturen. */
  const abweichungsliste = useMemo(
    () =>
      abweichungen(antworten, {
        /*
         * **Der geforderte Inhalt, nicht der gewählte.**
         *
         * `buffer.selected` ist der Speicher, der in der Anlage steht — und
         * seit die Anlage aus den Antworten entsteht, ist das der vom
         * Anwender eingetragene. Dagegen zu vergleichen hieße, seine Antwort
         * gegen sich selbst zu halten: Die Abweichung wäre immer null, und
         * der Hinweis käme nie. Maßgebend ist `required`, der aus
         * Mindestlaufzeit und Spreizung gerechnete Bedarf.
         */
        pufferLiter: design.buffer.required > 0 ? design.buffer.required : undefined,
        pufferGrund: design.buffer.reason,
        kreiseImModell: design.circuits.length,
      }),
    [antworten, design],
  );

  const befunde = useMemo<SchemaBefund[]>(() => {
    const komponenten = Object.values(plant.schematic.components);
    if (!komponenten.length) return [];
    return pruefeSchema({
      komponenten,
      verbindungen: Object.values(plant.schematic.links),
      auslegung: design,
      anlage: plant,
    });
  }, [plant, design]);

  const toggle = (key: string) => setOpen((o) => ({ ...o, [key]: !o[key] }));
  const selected = design.selected;
  const refrigerant = selected ? REFRIGERANTS[selected.model.refrigerant] : undefined;

  return (
    <div className="space-y-3 p-3">
      {/* ---------------------------------------------------------------- */}
      {/* 0 — Vorhaben                                                      */}
      {/* ---------------------------------------------------------------- */}
      {/*
        * **Warum das ganz oben steht und nicht in den Projektdaten.**
        * Aus dem Vorhaben folgt die Auslegungstemperatur, und die
        * Auslegungstemperatur ist die erste Zahl, mit der alles darunter
        * rechnet. Wer sie erst nach der Geräteauswahl festlegt, hat das
        * Gerät nach 35/28 gewählt und baut anschließend Heizkörper — die
        * Reihenfolge im Blatt ist die Reihenfolge der Abhängigkeit.
        *
        * **Warum es nicht abgeleitet wird.** Ein vollständig entkerntes
        * Bestandsgebäude sieht im Modell aus wie ein Neubau; das Programm
        * kann die Frage nicht beantworten und behauptet deshalb nichts.
        * Solange niemand gewählt hat, steht hier „noch nicht festgelegt" —
        * eine offene Angabe, kein Fehler: Ein rot markiertes Feld für etwas,
        * das im frühen Aufmaß noch offen sein *darf*, erzieht nur dazu, rote
        * Felder zu übersehen.
        */}
      <div className="rounded-lg bg-graphite-900/60 p-2.5">
        <div className="mb-1.5 flex items-baseline justify-between">
          <span className="label-xs">Vorhaben</span>
          {doc.meta.vorhaben === undefined && (
            <span className="text-[10px] text-slate-500">noch nicht festgelegt</span>
          )}
        </div>
        {/*
          Mindestens 44 px hoch: Die drei Knöpfe stehen nebeneinander und sind
          im 300 px breiten Inspektor entsprechend schmal. Auf dem Tablet ist
          die Höhe dann das Einzige, was den Finger noch trifft — `.chip`
          käme mit 36 px darunter, deshalb hier ausdrücklich das Maß.
        */}
        <div className="grid grid-cols-3 gap-1">
          {(Object.keys(VORHABEN_LABELS) as Vorhaben[]).map((v) => (
            <button
              key={v}
              onClick={() => setVorhaben(v)}
              className={`min-h-[44px] rounded-lg px-1.5 py-2 text-[11px] leading-tight transition-colors ${
                doc.meta.vorhaben === v
                  ? 'bg-accent/12 text-accent ring-1 ring-accent/40'
                  : 'bg-white/[0.03] text-slate-400 hover:bg-white/[0.06]'
              }`}
            >
              {VORHABEN_LABELS[v]}
            </button>
          ))}
        </div>
        {doc.meta.vorhaben === undefined ? (
          <p className={`mt-2 rounded px-2.5 py-1.5 text-[10px] leading-relaxed ${SEVERITY_STYLE.info}`}>
            Ohne Vorhaben leitet das Programm nichts ab — es bleibt bei den Vorgaben des Anlagenblatts
            (35/28 °C) und bei der eingetragenen Luftdichtheit. Das ist keine Fehleingabe, sondern eine
            offene Angabe. Die Wahl setzt Auslegungstemperatur und n50 einmalig auf den Regelfall des
            Vorhabens; danach ist jede Zahl frei zu ändern.
          </p>
        ) : (
          <>
            {/*
              Angezeigt wird die **Vorbelegung des Vorhabens**, nicht der Stand
              im Blatt. Beides kann auseinanderlaufen, sobald jemand von Hand
              eingreift oder das Vorhaben wechselt — und genau das sagt der
              Hinweis darunter. Die maßgebliche Temperatur steht im Abschnitt
              „Verteilung", dort, wo sie gebraucht wird.
            */}
            <div className="mt-2 border-t border-white/[0.06] pt-2">
              <Readout
                label="Vorbelegung Auslegung"
                value={`${VORHABEN_VORBELEGUNG[doc.meta.vorhaben].vorlauf}/${
                  VORHABEN_VORBELEGUNG[doc.meta.vorhaben].ruecklauf
                } °C`}
              />
              {/*
                Ohne Vorbelegung steht hier „messen" und keine Zahl.
                Beim unsanierten Bestand liegt n50 zwischen 4 und 6; eine
                Zahl in diesem Bereich hinzuschreiben sähe danach wie eine
                Angabe aus und verschöbe die Heizlast zweistellig.
              */}
              <Readout
                label="Vorbelegung Luftdichtheit n50"
                value={
                  VORHABEN_VORBELEGUNG[doc.meta.vorhaben].n50 !== undefined
                    ? `${fmt(VORHABEN_VORBELEGUNG[doc.meta.vorhaben].n50 as number, 1)} 1/h`
                    : 'keine — messen'
                }
              />
            </div>
            <p className="mt-1.5 text-[10px] leading-relaxed text-slate-500">
              {VORHABEN_VORBELEGUNG[doc.meta.vorhaben].grund}
            </p>
            <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
              Gesetzt werden diese Werte nur beim <span className="text-slate-300">ersten</span> Festlegen.
              Ein späterer Wechsel ändert allein das Vorhaben und lässt vorhandene Eingaben stehen — eine
              Auslegungstemperatur, die jemand bewusst gewählt hat, springt nicht ohne Rückfrage um. Was hier
              steht, ist deshalb der Regelfall des Vorhabens und nicht zwingend der Stand im Blatt.
            </p>
          </>
        )}
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* 1 — Leistung                                                      */}
      {/* ---------------------------------------------------------------- */}
      <div className="rounded-lg bg-graphite-900/60 p-2.5">
        <div className="mb-1.5 flex items-baseline justify-between">
          <span className="label-xs inline-flex items-center gap-1">
            Heizlast
            <Erklaerung term="typklasse" />
          </span>
          {/*
            Die Beschriftung nennt den Weg, nicht nur „Norm". Eine eingetragene
            Zahl kann von Hand kommen oder von der Gegenstelle geschrieben
            worden sein — das Anlagenblatt kann beides nicht unterscheiden und
            behauptet es deshalb auch nicht. Die raumweise Summe dagegen weiß,
            wer sie gerechnet hat; sie steht darunter mit Absender und Datum.
          */}
          <span className="text-[10px] text-slate-500">
            {design.heatLoadProvenance === 'vorgabe'
              ? 'eingetragen'
              : design.heatLoadProvenance === 'raumweise'
                ? 'aus RaVia übernommen'
                : 'überschlägig'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <input
            className="field w-24 font-mono"
            type="number"
            step={0.1}
            placeholder={fmt(ohneVorgabe, 2)}
            value={plant.heatLoadOverride ?? ''}
            onChange={(e) =>
              updatePlant({ heatLoadOverride: e.target.value === '' ? undefined : Number(e.target.value) })
            }
          />
          <span className="text-[11px] text-slate-500">kW</span>
          {plant.heatLoadOverride !== undefined && (
            <button className="chip ml-auto bg-white/[0.04]" onClick={() => updatePlant({ heatLoadOverride: undefined })}>
              {design.normCoverage.complete ? 'zurück zu den Raumlasten' : 'zurück zum Überschlag'}
            </button>
          )}
        </div>
        {design.estimate && (
          <p className="mt-1.5 text-[10px] leading-relaxed text-slate-500">
            {design.estimate.klassifizierung} · {fmt(design.estimate.heatedArea, 0)} m² beheizt ·{' '}
            {fmt(design.estimate.transmission / 1000, 2)} kW Transmission,{' '}
            {fmt(design.estimate.ventilation / 1000, 2)} kW Lüftung bei {design.estimate.designOutdoor} °C.
          </p>
        )}
        {/*
          Drei Spalten waren hier zu eng: die Beschriftungen wurden
          abgeschnitten und die Zahlen liefen ineinander. Der Inspektor ist
          300 Pixel breit — was dort steht, muss in eine Zeile passen.
        */}
        <div className="mt-2 border-t border-white/[0.06] pt-2">
          <Readout label="Zuschlag Warmwasser" value={`+ ${fmt(design.dhwSurcharge, 2)} kW`} />
          <Readout label="Sperrzeitfaktor" value={`× ${fmt(design.blocking, 2)}`} />
          <Readout label="Das Gerät muss können" value={`${fmt(design.requiredCapacity, 2)} kW`} accent />
        </div>

        {/* ---------------------------------------------------------- */}
        {/* Gegenprobe — die zweite Zahl                                 */}
        {/* ---------------------------------------------------------- */}
        {/*
          **Warum das hier steht und nicht im Projektkopf.** Gefragt wird, wo
          man hinsieht — dieselbe Regel wie in 1.54.0 bei den Anlagenfragen.
          Der Verbrauch ist keine Stammdatenpflege, sondern die Gegenprobe zu
          der Zahl, die drei Zeilen darüber steht; wer sie dort einträgt, sieht
          sofort, was sie bedeutet.

          Der Überschlag aus der Hülle prüft sich an nichts: Ein zu günstiger
          U-Wert bleibt plausibel, weil das Ergebnis eine Rechnung ist. Der
          Verbrauch dagegen ist gemessen worden.
        */}
        <div className="mt-2 border-t border-white/[0.06] pt-2">
          <button
            className="flex w-full items-baseline justify-between text-left"
            onClick={() => setGegenprobeOffen((v) => !v)}
          >
            <span className="label-xs inline-flex items-center gap-1">
              Gegenprobe
              {abgleich && abgleich.zeilen.length > 0 && (
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
                    abgleich.urteil === 'deckt-sich'
                      ? 'bg-emerald-400/15 text-emerald-300'
                      : abgleich.urteil === 'nachsehen'
                        ? 'bg-amber-400/15 text-amber-300'
                        : 'bg-rose-400/15 text-rose-300'
                  }`}
                >
                  {abgleich.urteil === 'deckt-sich'
                    ? 'deckt sich'
                    : abgleich.urteil === 'nachsehen'
                      ? 'nachsehen'
                      : 'passt nicht'}
                </span>
              )}
            </span>
            <span className="text-[10px] text-slate-500">{gegenprobeOffen ? 'zuklappen' : 'aufklappen'}</span>
          </button>

          {gegenprobeOffen && (
            <div className="mt-2 space-y-2">
              <p className="text-[10px] leading-relaxed text-slate-500">
                Der Überschlag oben kommt aus der Gebäudehülle — Flächen, U-Werte, Luftwechsel. Er prüft
                sich an nichts. Zwei Wege zu derselben Zahl sind mehr wert als einer: Wo sie auseinanderlaufen,
                stimmt etwas nicht.
              </p>

              <div>
                <span className="label-xs mb-1 block">Brennstoff</span>
                <select
                  className="field w-full"
                  value={doc.meta.verbrauch?.brennstoff ?? 'oel'}
                  onChange={(e) =>
                    updateMeta({
                      verbrauch: {
                        mitWarmwasser: true,
                        menge: 0,
                        ...doc.meta.verbrauch,
                        brennstoff: e.target.value as Brennstoff,
                      },
                    })
                  }
                >
                  {(Object.keys(BRENNSTOFF_LABELS) as Brennstoff[]).map((b) => (
                    <option key={b} value={b} className="bg-graphite-850">
                      {BRENNSTOFF_LABELS[b]}
                    </option>
                  ))}
                </select>
              </div>
              <Row label={`Jahresverbrauch (${BRENNSTOFF_EINHEIT[doc.meta.verbrauch?.brennstoff ?? 'oel']})`}>
                <input
                  className="field w-24 font-mono"
                  type="number"
                  min={0}
                  step={10}
                  value={doc.meta.verbrauch?.menge ?? ''}
                  onChange={(e) =>
                    updateMeta({
                      verbrauch: {
                        brennstoff: 'oel',
                        mitWarmwasser: true,
                        ...doc.meta.verbrauch,
                        menge: e.target.value === '' ? 0 : Number(e.target.value),
                      },
                    })
                  }
                />
              </Row>
              <label className="flex items-center gap-2 text-[11px] text-slate-400">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-accent"
                  checked={doc.meta.verbrauch?.mitWarmwasser ?? true}
                  onChange={(e) =>
                    updateMeta({
                      verbrauch: {
                        brennstoff: 'oel',
                        menge: 0,
                        ...doc.meta.verbrauch,
                        mitWarmwasser: e.target.checked,
                      },
                    })
                  }
                />
                Warmwasser steckt im Verbrauch
              </label>
              <p className="text-[9.5px] leading-relaxed text-slate-600">
                Beim Kombigerät der Normalfall. Angehakt rechnet das Programm mit 3000 Vollbenutzungsstunden
                statt 2500 — die Heizlast fällt dadurch kleiner aus, und das ist richtig: Ein Teil des
                Verbrauchs war kein Heizen.
              </p>

              {/*
                Beschriftung *über* dem Feld, nicht daneben: Die Klassennamen
                sind lang, und in einer Zeile drängt das Auswahlfeld die
                Beschriftung auf null Breite. Der Inspektor ist 300 Pixel
                breit — dieselbe Lehre wie bei den drei Spalten weiter oben.
              */}
              <div>
                <span className="label-xs mb-1 block">Baualter</span>
                <select
                  className="field w-full"
                  value={doc.meta.baualter ?? ''}
                  onChange={(e) => updateMeta({ baualter: e.target.value || undefined })}
                >
                  <option value="" className="bg-graphite-850">
                    — nicht angegeben —
                  </option>
                  {BAUALTERSKLASSEN.map((k) => (
                    <option key={k.id} value={k.id} className="bg-graphite-850">
                      {k.label} · {String(k.spezifisch).replace('.', ',')} kWh/(m²·a)
                    </option>
                  ))}
                </select>
              </div>
              <p className="text-[9.5px] leading-relaxed text-slate-600">
                Die beheizte Fläche muss dafür niemand nachschlagen — sie steht im Modell.
              </p>

              {abgleich && abgleich.zeilen.length > 0 ? (
                <div className="space-y-2">
                  {abgleich.zeilen.map((z) => (
                    <div
                      key={z.probe.id}
                      className={`rounded-lg px-2.5 py-2 ${
                        z.urteil === 'deckt-sich'
                          ? 'bg-emerald-400/[0.07]'
                          : z.urteil === 'nachsehen'
                            ? 'bg-amber-400/[0.07]'
                            : 'bg-rose-400/[0.08]'
                      }`}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-[11px] font-medium text-slate-200">
                          {fmt(z.probe.wert, 2)} kW
                        </span>
                        <span
                          className={`text-[10px] tabular-nums ${
                            z.urteil === 'deckt-sich'
                              ? 'text-emerald-300'
                              : z.urteil === 'nachsehen'
                                ? 'text-amber-300'
                                : 'text-rose-300'
                          }`}
                        >
                          {z.abweichung > 0 ? '+' : ''}
                          {fmt(z.abweichung, 1)} % gegenüber {fmt(abgleich.ueberschlag, 2)} kW
                        </span>
                      </div>
                      <div className="mt-0.5 text-[9.5px] text-slate-500">{z.probe.bezeichnung}</div>
                      <div className="mt-1 font-mono text-[9.5px] leading-relaxed text-slate-500">
                        {z.probe.rechenweg}
                      </div>
                      {z.urteil !== 'deckt-sich' && (
                        <p className="mt-1.5 text-[10px] leading-relaxed text-slate-400">
                          {z.deutung.replace(/\*\*/g, '')}
                        </p>
                      )}
                    </div>
                  ))}
                  <p className="text-[9.5px] leading-relaxed text-slate-600">
                    Keine Heizlastberechnung, sondern eine Einstiegsrechnung nach dem BWP-Praxisratgeber
                    „Modernisieren mit Wärmepumpe". Sie beschreibt das Gebäude im Zustand des
                    Verbrauchsjahres — nach neuen Fenstern gilt sie nicht mehr.
                  </p>
                </div>
              ) : (
                <p className="text-[10px] leading-relaxed text-slate-500">
                  Noch keine Gegenprobe: Es fehlt ein Jahresverbrauch oder eine Baualtersklasse.
                </p>
              )}
            </div>
          )}
        </div>

        {/*
          Herkunft der Zahlen. Sie steht auch dann hier, wenn die raumweisen
          Lasten *nicht* für die Gebäudeheizlast gereicht haben — gerade dann:
          wer sieht, dass 9 von 12 Räumen eine gerechnete Last tragen, weiß,
          wie weit er von der belastbaren Zahl entfernt ist.
        */}
        {design.normCoverage.withNorm > 0 && (
          <div className="mt-2 border-t border-white/[0.06] pt-2">
            <Readout
              label="gerechnete Raumlasten"
              value={`${design.normCoverage.withNorm} von ${design.normCoverage.heatedRooms} Räumen`}
              accent={design.normCoverage.complete}
            />
            {design.normCoverage.source && (
              <Readout
                label="übernommen von"
                value={`${design.normCoverage.source}${
                  design.normCoverage.receivedAt ? ` · ${zeitpunktDe(design.normCoverage.receivedAt) ?? ''}` : ''
                }`}
              />
            )}
            {!design.normCoverage.complete && (
              <p className={`mt-1 rounded px-2.5 py-1.5 text-[10px] leading-relaxed ${SEVERITY_STYLE.info}`}>
                Für die Gebäudeheizlast bleibt es beim Überschlag — eine Summe aus gerechneten und überschlagenen
                Räumen wäre keines von beidem. Raumweise wird trotzdem mit der gerechneten Last ausgelegt. Ohne
                gerechnete Last:{' '}
                {design.normCoverage.missing.slice(0, 4).join(', ')}
                {design.normCoverage.missing.length > 4
                  ? ` und ${design.normCoverage.missing.length - 4} weitere`
                  : ''}
                .
              </p>
            )}
            {design.normCoverage.outdated > 0 && (
              <p className={`mt-1 rounded px-2.5 py-1.5 text-[10px] leading-relaxed ${SEVERITY_STYLE.info}`}>
                {design.normCoverage.outdated === 1
                  ? '1 Raum trägt eine Heizlast, die für einen früheren Modellstand gerechnet wurde'
                  : `${design.normCoverage.outdated} Räume tragen eine Heizlast, die für einen früheren Modellstand gerechnet wurde`}
                : {design.normCoverage.outdatedRooms.slice(0, 4).join(', ')}
                {design.normCoverage.outdatedRooms.length > 4
                  ? ` und ${design.normCoverage.outdatedRooms.length - 4} weitere`
                  : ''}
                . Die Zahl wird weiter verwendet — seit der Übernahme wurde am Modell gezeichnet, das macht sie
                fraglich, nicht ungültig. Vor der Ausführung in RaVia neu rechnen lassen.
              </p>
            )}
          </div>
        )}
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* 2 — Gerät                                                         */}
      {/* ---------------------------------------------------------------- */}
      <Fold title="Gerät" open={open.geraet} onToggle={() => toggle('geraet')}>
        <select
          className="field mb-1.5"
          value={seriesFilter}
          onChange={(e) => setSeriesFilter(e.target.value)}
        >
          <option value="" className="bg-graphite-850">
            alle Bauarten
          </option>
          {HEAT_PUMP_SERIES.map((s) => (
            <option key={s.key} value={s.series} className="bg-graphite-850">
              {s.series}
            </option>
          ))}
        </select>

        <div className="space-y-1">
          {matches.slice(0, 6).map((m) => {
            const isSelected = selected?.model.id === m.model.id;
            return (
              <button
                key={m.model.id}
                onClick={() => updatePlant({ generatorModelId: m.model.id })}
                className={`w-full rounded-lg px-2.5 py-2 text-left transition ${
                  isSelected ? 'bg-accent/12 ring-1 ring-accent/40' : 'bg-white/[0.03] hover:bg-white/[0.06]'
                }`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[11.5px] text-slate-200">{m.model.label}</span>
                  <span
                    className={`shrink-0 text-[10px] ${
                      m.verdict === 'passt'
                        ? 'text-emerald-300'
                        : m.verdict === 'knapp'
                          ? 'text-amber-300'
                          : 'text-rose-300'
                    }`}
                  >
                    {m.verdict}
                  </span>
                </div>
                <div className="mt-0.5 text-[10px] leading-relaxed text-slate-500">
                  {fmt(m.capacityAtDesign, 1)} kW bei {doc.meta.designOutdoorTemperature} °C · {m.reason}
                </div>
              </button>
            );
          })}
          {matches.length === 0 && (
            <p className="rounded-lg bg-white/[0.03] px-2.5 py-2 text-[10px] text-slate-500">
              Keine Bauart in dieser Auswahl schafft die Leistung. Filter weiten oder die Vorlauftemperatur senken.
            </p>
          )}
        </div>

        {/*
          Datenblatt statt Typklasse. Der Katalog ist absichtlich generisch;
          hier ist die Stelle, an der er das aufgibt.
        */}
        <div className="mt-2 border-t border-white/[0.06] pt-2">
          <div className="flex gap-1.5">
            <button
              className="chip flex-1 bg-white/[0.05] text-slate-300 hover:bg-white/[0.1]"
              title="CSV oder JSON eines Herstellers einlesen und die Typklasse ersetzen"
              onClick={() => dateiRef.current?.click()}
            >
              Datenblatt einlesen
            </button>
            <button
              className="chip bg-white/[0.05] text-slate-300 hover:bg-white/[0.1]"
              title="Leere CSV mit allen erkannten Spalten und einer Beispielzeile"
              onClick={() => downloadText(buildCsvTemplate('waermepumpe'), 'Datenblatt-Vorlage.csv')}
            >
              Vorlage
            </button>
          </div>
          <input
            ref={dateiRef}
            type="file"
            accept=".csv,.json,text/csv,application/json"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              const text = await file.text();
              const report = importDevices(text, { manufacturer: file.name.replace(/\.[^.]+$/, '') });
              setImportReport(report);
              const brauchbar = report.devices.filter((d) => d.accepted);
              if (brauchbar.length) {
                const merged = mergeIntoCatalog(report);
                updatePlant({});
                useBimStore.getState().setStatus(
                  `${brauchbar.length} Gerät${brauchbar.length === 1 ? '' : 'e'} aus „${file.name}" übernommen`,
                );
                setExtra(merged.extraModels);
              }
            }}
          />

          {importReport && (
            <div className="mt-1.5 space-y-1">
              <div className="flex items-baseline justify-between text-[10px]">
                <span className="text-slate-400">
                  {importReport.devices.filter((d) => d.accepted).length} von {importReport.devices.length} übernommen
                </span>
                <button className="text-slate-600 hover:text-slate-300" onClick={() => setImportReport(null)}>
                  ausblenden
                </button>
              </div>
              {importReport.issues.slice(0, 6).map((n, i) => (
                <p
                  key={i}
                  className={`rounded px-2.5 py-1.5 text-[10px] leading-relaxed ${
                    SEVERITY_STYLE[n.severity === 'error' ? 'error' : n.severity === 'warn' ? 'warn' : 'info']
                  }`}
                >
                  {n.text}
                </p>
              ))}
            </div>
          )}
        </div>

        {selected && (
          <div className="mt-2 space-y-1.5 border-t border-white/[0.06] pt-2">
            {/* Eine Spalte statt zwei: bei 300 Pixel Inspektorbreite wurden
                „Kältemittel" und „Mindestvolumenstrom" sonst abgeschnitten. */}
            <div>
              <Readout label="Bauform" value={PUMP_FORM_LABELS[selected.model.form as PumpForm].split(',')[0]} />
              <Readout label="Wärmequelle" value={HEAT_SOURCE_LABELS[selected.model.source as HeatSourceKind]} />
              {/*
                **Die Nennleistung ohne ihren Betriebspunkt ist keine Zahl.**

                Der Katalog benennt seine Typklassen nach der Leistung bei
                A-7/W35 — dem Auslegungspunkt. Die meisten Hersteller
                benennen ihre Geräte nach A7/W35 oder A2/W35: Viessmanns
                „Vitocal 250-A 8 kW" leistet bei A7/W35 acht Kilowatt und
                bei A-7/W35 noch 6,5. Wer die Typklasse „8 kW" wählt und
                anschließend ein Gerät mit „8 kW" auf dem Schild kauft,
                steht bei Auslegungstemperatur ein Fünftel zu klein da.

                Gerechnet wird ohnehin mit `capacityAt` am Auslegungspunkt
                des Projekts — der Deckungsgrad daneben nennt ihn auch. Zu
                sehen war der Bezugspunkt der *Nennleistung* aber nirgends,
                und genau der steht im Angebot des Herstellers.
              */}
              <Readout
                label="Nennleistung"
                value={`${fmt(selected.model.nominalCapacity, 1)} kW bei ${selected.model.nominalPoint}`}
              />
              <Readout label="Kältemittel" value={`${selected.model.refrigerant} · ${fmt(selected.model.refrigerantMass, 2)} kg · GWP ${refrigerant?.gwp ?? '—'}`} />
              <Readout label="höchster Vorlauf" value={`${selected.model.maxFlowTemperature} °C`} />
              {/*
                Ein Gedankenstrich hieße „gibt es nicht". Hier gibt es ihn
                sehr wohl — er steht nur nicht in einer Typklasse, weil der
                SCOP ein Prüfergebnis nach EN 14825 für ein bestimmtes Gerät
                ist und keine Eigenschaft einer Größenklasse. Wer das
                Datenblatt einliest, sieht die Zahl.
              */}
              <Readout
                label="SCOP bei 35 °C"
                value={
                  selected.model.scop35 === undefined
                    ? 'nicht erfasst — steht im Datenblatt'
                    : fmt(selected.model.scop35, 2)
                }
                term="cop"
              />
              <Readout
                label="Schallleistung außen"
                value={
                  selected.model.soundPowerOutdoor === undefined
                    ? 'entfällt — keine Außeneinheit'
                    : `${fmt(selected.model.soundPowerOutdoor, 1)} dB(A)`
                }
              />
              <Readout
                label="Elektrik"
                value={`${selected.model.electric.phases}~ · ${selected.model.electric.fuse} A${
                  selected.model.electric.maxCurrent !== undefined
                    ? ` · max. ${fmt(selected.model.electric.maxCurrent, 1)} A`
                    : ''
                }`}
              />
              <Readout label="Mindestvolumenstrom" value={`${fmt(selected.model.minVolumeFlow, 2)} m³/h`} term="ueberstroemventil" />
              <Readout label="Mindestwasserinhalt" value={`${selected.model.minSystemVolume} l`} />
            </div>
            {refrigerant?.flammable === true && selected.model.form !== 'monoblock-outdoor' && (
              <p className="rounded-lg bg-amber-400/[0.07] px-2.5 py-2 text-[10px] leading-relaxed text-amber-200">
                {selected.model.refrigerant} ist brennbar ({refrigerant.group}) und liegt bei dieser Bauform im Gebäude.
                {(() => {
                  // Ohne praktischen Grenzwert wird keine Mindestgröße
                  // genannt. Eine geschätzte Mindestgröße des Aufstellraums
                  // ist schlimmer als keine: Sie sieht aus wie ein Nachweis.
                  const v = minimumRoomVolume(selected.model.refrigerant, selected.model.refrigerantMass);
                  return v === undefined
                    ? ' Die Mindestgröße des Aufstellraums nach DIN EN 378-1 lässt sich hier nicht angeben — zu diesem Kältemittel ist kein praktischer Grenzwert hinterlegt. Er steht im Datenblatt.'
                    : ` Nach DIN EN 378-1 muss der Aufstellraum mindestens ${fmt(v, 0)} m³ haben.`;
                })()}
              </p>
            )}
            {refrigerant?.flammable === undefined && selected.model.form !== 'monoblock-outdoor' && (
              <p className="rounded-lg bg-amber-400/[0.07] px-2.5 py-2 text-[10px] leading-relaxed text-amber-200">
                Zu „{selected.model.refrigerant}" ist hier keine Sicherheitsgruppe hinterlegt. Ob das Kältemittel
                brennbar ist und welche Mindestgröße der Aufstellraum braucht, steht im Datenblatt des Geräts.
              </p>
            )}
            {selected.model.provenance === 'generisch' && (
              <p className="rounded-lg bg-white/[0.03] px-2.5 py-2 text-[10px] leading-relaxed text-slate-500">
                Typklasse, kein Produkt. Die Werte beschreiben, was ein Gerät dieser Bauart und Größe üblicherweise
                leistet — zum Vordimensionieren, nicht zum Bestellen.
              </p>
            )}
          </div>
        )}
      </Fold>

      {/*
        Im einfachen Modus endet das Blatt hier — mit einer Zusammenfassung in
        Sätzen statt sieben aufklappbaren Abschnitten voller Zwischenwerte.
        Wer die Zahlen dahinter braucht, schaltet auf „Fachplaner"; wer sie
        nicht braucht, soll sie nicht wegklicken müssen.
      */}
      {!mindestens(uiMode, 'profi') && <KurzFassung design={design} />}

      {!mindestens(uiMode, 'profi') && design.notes.some((n) => n.severity === 'error') && (
        <div className="space-y-1">
          <span className="label-xs block">Das muss noch geklärt werden</span>
          {design.notes
            .filter((n) => n.severity === 'error')
            .map((n, i) => (
              <p key={i} className={`rounded px-2.5 py-1.5 text-[10px] leading-relaxed ${SEVERITY_STYLE.error}`}>
                {n.text}
              </p>
            ))}
        </div>
      )}

      {mindestens(uiMode, 'profi') && (
      <>
      {/* ---------------------------------------------------------------- */}
      {/* 3 — Auslegung der Verteilung                                      */}
      {/* ---------------------------------------------------------------- */}
      <Fold title="Verteilung" open={open.verteilung} onToggle={() => toggle('verteilung')}>
        {/*
          * **Warum über den beiden Feldern eine Überschrift steht.**
          * Bis 1.23.0 stand hier nur „Vorlauf [°C] 35", und diese eine Zahl
          * bedeutete zweierlei: die Temperatur der Flächenheizung *und* die
          * Untergrenze, ab der die Erzeugertemperatur gerechnet wird. Wer 35
          * las, schloss zu Recht, die ganze Anlage werde mit 35 gerechnet —
          * ein Heizkörperkreis läuft aber mindestens mit 50/40, weil ein
          * Heizkörper durch eine Eintragung im Anlagenblatt nicht größer
          * wird. Das Feld ist ab jetzt ausdrücklich die **Angabe des
          * Blatts**; womit gerechnet wird, steht darunter und ist nicht
          * bedienbar, weil es niemand von Hand setzen kann.
          */}
        <span className="label-xs mb-1 block">Angabe des Anlagenblatts</span>
        <div className="grid grid-cols-2 gap-2">
          <Num label="Vorlauf" unit="°C" term="spreizung" value={plant.design.flowTemperature} onChange={(v) => updatePlant({ design: { flowTemperature: v } })} />
          <Num label="Rücklauf" unit="°C" value={plant.design.returnTemperature} onChange={(v) => updatePlant({ design: { returnTemperature: v } })} />
          {/*
            * Die Heizgrenztemperatur — die Außentemperatur, ab der die Heizung
            * aus bleibt. Sie wird bei der Inbetriebnahme von Hand gesetzt und
            * stand bisher nirgends im Programm, obwohl das BDH/BWP-Infoblatt
            * Nr. 62 sie als eine der wenigen Einstellgrößen nennt, die der
            * Monteur wirklich entscheidet: 12 °C bei gutem Dämmstandard,
            * 18 °C im unsanierten Bestand.
            *
            * Leer heißt „nicht erfasst" und nicht 0 °C — eine 0 wäre eine
            * Aussage, und zwar eine falsche. Die Modellprüfung sagt, dass sie
            * fehlt.
            */}
          <Num
            label="Heizgrenze"
            unit="°C"
            step={0.5}
            value={plant.design.heatingLimit ?? 15}
            onChange={(v) => updatePlant({ design: { heatingLimit: v } })}
          />
        </div>
        <p className="mt-1 text-[9.5px] leading-relaxed text-slate-500">
          Heizgrenze: 12 bis 18 °C je nach Dämmstandard (BDH/BWP-Infoblatt Nr. 62). Zu hoch
          eingestellt taktet die Wärmepumpe im Frühjahr, zu tief wird es morgens im Übergang kalt.
        </p>

        {/*
          * Die maßgebliche Systemtemperatur — dieselbe Zahl, mit der
          * Rohrnetzbericht, Trassenauslegung und der Abgleich weiter oben
          * rechnen.
          *
          * **Zwei Darstellungen, weil es zwei Fälle sind.** Stimmen beide
          * überein, wäre ein hervorgehobener Kasten Lärm — eine Zeile
          * genügt, und sie muss trotzdem da sein, damit man sieht, dass
          * geprüft wurde. Weichen sie ab, ist das die wichtigste Auskunft
          * auf dem ganzen Blatt: Dann steht im Eingabefeld eine andere Zahl
          * als in jedem Nachweis, und ohne Hinweis hält der Leser den
          * Nachweis für falsch.
          */}
        <div className="mt-2 border-t border-white/[0.06] pt-2">
          <Readout
            label="gerechnet wird mit"
            value={`${grad(systemtemp.vorlauf)}/${grad(systemtemp.ruecklauf)} °C · ${grad(systemtemp.spreizung)} K`}
            accent={temperaturWeichtAb}
          />
          <Readout label="Herkunft" value={TEMPERATURHERKUNFT_LABELS[systemtemp.herkunft]} />
          {temperaturWeichtAb ? (
            <p className={`mt-1 rounded px-2.5 py-1.5 text-[10px] leading-relaxed ${SEVERITY_STYLE.warn}`}>
              {systemtemp.begruendung}
            </p>
          ) : (
            <p className="mt-1 text-[10px] leading-relaxed text-slate-500">{systemtemp.begruendung}</p>
          )}
        </div>

        <div className="mt-2 grid grid-cols-2 gap-2">
          <Num label="v max" unit="m/s" step={0.1} value={plant.design.maxVelocity} onChange={(v) => updatePlant({ design: { maxVelocity: v } })} />
          <Num label="R max" unit="Pa/m" step={10} value={plant.design.maxGradient} onChange={(v) => updatePlant({ design: { maxGradient: v } })} />
        </div>
        <label className="mt-2 block">
          <span className="label-xs">Werkstoff der Verteilleitungen</span>
          <select
            className="field mt-0.5"
            value={plant.design.material}
            onChange={(e) => updatePlant({ design: { material: e.target.value as PipeMaterial } })}
          >
            {(Object.keys(PIPE_MATERIAL_LABELS) as PipeMaterial[]).map((m) => (
              <option key={m} value={m} className="bg-graphite-850">
                {PIPE_MATERIAL_LABELS[m]}
              </option>
            ))}
          </select>
        </label>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Num
            label="Frostschutz"
            unit="Vol-%"
            value={plant.design.glycolFraction}
            onChange={(v) => updatePlant({ design: { glycolFraction: v } })}
          />
          <label className="block">
            <span className="label-xs">Sorte</span>
            <select
              className="field mt-0.5"
              value={plant.design.glycolKind}
              onChange={(e) => updatePlant({ design: { glycolKind: e.target.value as 'ethylen' | 'propylen' } })}
            >
              <option value="ethylen" className="bg-graphite-850">Ethylenglykol</option>
              <option value="propylen" className="bg-graphite-850">Propylenglykol</option>
            </select>
          </label>
        </div>
      </Fold>

      {/* ---------------------------------------------------------------- */}
      {/* 3b — Zweiter Wärmeerzeuger, Kaskade, Kühlung                      */}
      {/* ---------------------------------------------------------------- */}
      {/*
        * Bis 1.13.2 kannte das Anlagenmodell diese vier Angaben nicht — und
        * vier Vorlagen des Schemakatalogs waren dadurch **unerreichbar**:
        * Solar, Kessel, Festbrennstoff und Kaskade standen im Programm und
        * konnten nie vorgeschlagen werden, weil niemand sie behaupten konnte.
        * Was das Programm nicht weiß, behauptet es nicht; aber es muss die
        * Möglichkeit haben, es zu erfahren.
        */}
      <Fold title="Zweiter Erzeuger, Kaskade, Kühlung" open={open.bivalent} onToggle={() => toggle('bivalent')}>
        <label className="block">
          <span className="label-xs">Zweiter Wärmeerzeuger</span>
          <select
            className="field mt-0.5"
            value={plant.secondGenerator?.art ?? ''}
            onChange={(e) => {
              const art = e.target.value as ZweitErzeugerArt | '';
              if (!art) {
                updatePlant({ secondGenerator: undefined });
                return;
              }
              const alt = plant.secondGenerator;
              /*
               * Festbrennstoff bringt eigene Zwänge mit, die der BWP-Leitfaden
               * ausdrücklich nennt: Rücklauftemperaturanhebung, thermische
               * Ablaufsicherung, autarke Regelung — und *alle* Heizkreise
               * gemischt. Er wird deshalb nie parallel gefahren, sondern über
               * den Puffer. Solarthermie speist in den Speicher, nicht in den
               * Kreis; sie hat keinen Bivalenzpunkt im Sinne der BDH-Definition.
               */
              const vorbelegt: SecondGenerator =
                art === 'solarthermie'
                  ? { art, leistung: 0, betrieb: 'bivalent-parallel', bivalenzpunkt: 15, einbindung: 'puffer-unten', eigenePumpe: true, kollektorflaeche: 8 }
                  : art === 'festbrennstoff' || art === 'pellet'
                    ? { art, leistung: 15, betrieb: 'bivalent-alternativ', bivalenzpunkt: 0, abschaltpunkt: -2, einbindung: 'puffer-oben', eigenePumpe: true }
                    : art === 'elektro-heizstab'
                      ? { art, leistung: 6, betrieb: 'monoenergetisch', bivalenzpunkt: -5, einbindung: 'vorlauf-parallel', eigenePumpe: false }
                      : { art, leistung: 15, betrieb: 'bivalent-parallel', bivalenzpunkt: -2, einbindung: 'ruecklauf-seriell', eigenePumpe: false };
              updatePlant({ secondGenerator: { ...vorbelegt, ...(alt && alt.art === art ? alt : {}), art } });
            }}
          >
            <option value="" className="bg-graphite-850">keiner — monovalent</option>
            {(Object.keys(ZWEITERZEUGER_LABELS) as ZweitErzeugerArt[]).map((a) => (
              <option key={a} value={a} className="bg-graphite-850">
                {ZWEITERZEUGER_LABELS[a]}
              </option>
            ))}
          </select>
        </label>

        {plant.secondGenerator && (
          <>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Num
                label="Leistung"
                unit="kW"
                value={plant.secondGenerator.leistung}
                onChange={(v) => updatePlant({ secondGenerator: { ...plant.secondGenerator!, leistung: Math.max(0, v) } })}
              />
              <Num
                label="Bivalenzpunkt"
                unit="°C"
                value={plant.secondGenerator.bivalenzpunkt}
                onChange={(v) => updatePlant({ secondGenerator: { ...plant.secondGenerator!, bivalenzpunkt: v } })}
              />
            </div>
            <label className="mt-2 block">
              <span className="label-xs">Betriebsweise</span>
              <select
                className="field mt-0.5"
                value={plant.secondGenerator.betrieb}
                onChange={(e) =>
                  updatePlant({
                    secondGenerator: { ...plant.secondGenerator!, betrieb: e.target.value as BivalenzBetrieb },
                  })
                }
              >
                <option value="monoenergetisch" className="bg-graphite-850">monoenergetisch — Heizstab im Gerät</option>
                <option value="bivalent-parallel" className="bg-graphite-850">bivalent parallel — beide gleichzeitig</option>
                <option value="bivalent-alternativ" className="bg-graphite-850">bivalent alternativ — nur einer</option>
                <option value="bivalent-teilparallel" className="bg-graphite-850">bivalent teilparallel — zwei Punkte</option>
              </select>
            </label>
            {(plant.secondGenerator.betrieb === 'bivalent-alternativ' ||
              plant.secondGenerator.betrieb === 'bivalent-teilparallel') && (
              <div className="mt-2">
                <Num
                  label="Abschaltpunkt der Wärmepumpe"
                  unit="°C"
                  value={plant.secondGenerator.abschaltpunkt ?? plant.secondGenerator.bivalenzpunkt - 2}
                  onChange={(v) => updatePlant({ secondGenerator: { ...plant.secondGenerator!, abschaltpunkt: v } })}
                />
                <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
                  Ein zweiter, anderer Temperaturpunkt als der Bivalenzpunkt. Zwischen beiden laufen bei
                  teilparalleler Fahrweise beide Erzeuger, darunter nur noch der zweite (BDH-Infoblatt 57).
                </p>
              </div>
            )}
            <label className="mt-2 block">
              <span className="label-xs">Einbindung in den Kreis</span>
              <select
                className="field mt-0.5"
                value={plant.secondGenerator.einbindung}
                onChange={(e) =>
                  updatePlant({
                    secondGenerator: {
                      ...plant.secondGenerator!,
                      einbindung: e.target.value as SecondGenerator['einbindung'],
                    },
                  })
                }
              >
                <option value="ruecklauf-seriell" className="bg-graphite-850">seriell in den Rücklauf</option>
                <option value="vorlauf-parallel" className="bg-graphite-850">parallel in den Vorlauf</option>
                <option value="puffer-oben" className="bg-graphite-850">in den Puffer, oben</option>
                <option value="puffer-unten" className="bg-graphite-850">in den Puffer, unten</option>
                <option value="weiche" className="bg-graphite-850">an die hydraulische Weiche</option>
              </select>
            </label>
            {plant.secondGenerator.art === 'solarthermie' && (
              <div className="mt-2">
                <Num
                  label="Kollektorfläche"
                  unit="m²"
                  step={0.5}
                  value={plant.secondGenerator.kollektorflaeche ?? 0}
                  onChange={(v) => updatePlant({ secondGenerator: { ...plant.secondGenerator!, kollektorflaeche: v } })}
                />
              </div>
            )}
            <BivalenzBlock design={design} />
            {(plant.secondGenerator.art === 'festbrennstoff' || plant.secondGenerator.art === 'pellet') && (
              <p className={`mt-2 rounded px-2.5 py-1.5 text-[10px] leading-relaxed ${SEVERITY_STYLE.warn}`}>
                Festbrennstoff verlangt nach dem BWP-Leitfaden Hydraulik eine thermische Ablaufsicherung, eine
                Rücklauftemperaturanhebung, eine autarke Regelung — und alle Heizkreise als gemischte Kreise.
                Das Programm prüft diese Punkte nicht selbst; sie gehören in die Planung.
              </p>
            )}
          </>
        )}

        <div className="mt-3 grid grid-cols-2 gap-2">
          <Num
            label="Geräte in Kaskade"
            unit=""
            value={plant.cascade?.geraete ?? 1}
            onChange={(v) => {
              const n = Math.max(1, Math.round(v));
              updatePlant({
                cascade:
                  n <= 1
                    ? undefined
                    : {
                        geraete: n,
                        // Viessmann für die Pufferspeicher-Kaskade: „Die
                        // Systemverrohrung muss nach Tichelmann erfolgen."
                        verrohrung: plant.cascade?.verrohrung ?? 'tichelmann',
                        pumpeJeGeraet: plant.cascade?.pumpeJeGeraet ?? true,
                        rueckschlagklappeJeGeraet: plant.cascade?.rueckschlagklappeJeGeraet ?? true,
                      },
              });
            }}
          />
          <label className="block">
            <span className="label-xs">Kühlbetrieb</span>
            <select
              className="field mt-0.5"
              value={plant.cooling ?? 'keine'}
              onChange={(e) => updatePlant({ cooling: e.target.value as 'keine' | 'passiv' | 'aktiv' })}
            >
              <option value="keine" className="bg-graphite-850">keiner</option>
              <option value="passiv" className="bg-graphite-850">passiv (ohne Verdichter)</option>
              <option value="aktiv" className="bg-graphite-850">aktiv (Kreislaufumkehr)</option>
            </select>
          </label>
        </div>
        {plant.cascade && plant.cascade.geraete > 1 && (
          <p className={`mt-2 rounded px-2.5 py-1.5 text-[10px] leading-relaxed ${SEVERITY_STYLE.warn}`}>
            Bei einer Kaskade mit eigener Pumpe je Gerät ist der ungünstigste Fließweg nicht mehr eindeutig —
            jedes Erzeugergerät hat seinen eigenen. Die Pumpenauslegung dieses Programms rechnet weiterhin
            eine Pumpe für den Verteilkreis; die Erzeugerzweige sind gesondert auszulegen.
          </p>
        )}
        <label className="mt-2 block">
          <span className="label-xs">Weiterer Verbraucher am selben Erzeuger</span>
          <select
            className="field mt-0.5"
            value={plant.additionalConsumer ?? 'kein'}
            onChange={(e) => updatePlant({ additionalConsumer: e.target.value as 'kein' | 'schwimmbad' })}
          >
            <option value="kein" className="bg-graphite-850">keiner</option>
            <option value="schwimmbad" className="bg-graphite-850">Schwimmbad über Wärmeübertrager</option>
          </select>
        </label>
        <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
          Diese vier Angaben ändern nichts an der Rechnung, aber alles an der Auswahl: Der Schemavorschlag
          weiter unten kann erst dann die passende Musterlösung finden — und schlägt umgekehrt kein Schema mit
          Solareinkopplung vor, solange hier nichts steht.
        </p>
      </Fold>

      {/* ---------------------------------------------------------------- */}
      {/* 3c — Erzeugerkreis: was vor dem Rohrnetz liegt                    */}
      {/* ---------------------------------------------------------------- */}
      <Fold title="Erzeugerkreis und Pumpe" open={open.erzeuger} onToggle={() => toggle('erzeuger')}>
        {design.generator.posten.length === 0 && !design.generator.verfuegbar ? (
          <p className="text-[10.5px] leading-relaxed text-slate-500">
            Noch kein Posten. Sobald ein Gerät gewählt ist, stehen hier Gerät, Umschaltventil,
            Wärmemengenzähler und Abscheider mit ihrem Druckverlust.
          </p>
        ) : (
          <>
            <div className="space-y-1">
              {design.generator.posten.map((p, i) => (
                <div key={i} className="rounded-lg bg-white/[0.03] px-2.5 py-1.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[11px] text-slate-200">{p.label}</span>
                    <span className="shrink-0 font-mono text-[10px] text-accent">{fmt(p.druck / 1000, 2)} kPa</span>
                  </div>
                  <div className="mt-0.5 text-[9.5px] leading-relaxed text-slate-500">
                    {p.grundlage} · {p.quelle}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-2 space-y-0.5">
              <Readout
                label="Summe, zum Rohrnetz addiert"
                value={`${fmt(design.generator.zusatz / 1000, 2)} kPa`}
                accent
              />
              {design.generator.verfuegbar !== undefined && (
                <Readout
                  label="Restförderhöhe des Geräts"
                  value={`${fmt(design.generator.verfuegbar / 1000, 1)} kPa — wird geprüft, nicht addiert`}
                />
              )}
              {design.pump && (
                <>
                  <Readout label="Erforderliche Förderhöhe" value={`${fmt(design.pump.head, 2)} m`} accent />
                  <Readout label="Förderstrom" value={`${fmt(design.pump.flow, 3)} m³/h`} />
                </>
              )}
            </div>
          </>
        )}
        {design.generator.hinweise.map((h, i) => (
          <p key={i} className={`mt-1.5 rounded px-2.5 py-1.5 text-[10px] leading-relaxed ${SEVERITY_STYLE[h.severity]}`}>
            {h.text}
          </p>
        ))}
      </Fold>

      {/* ---------------------------------------------------------------- */}
      {/* 4 — Heizkreise                                                    */}
      {/* ---------------------------------------------------------------- */}
      <Fold title={`Heizkreise (${design.circuits.length})`} open={open.kreise} onToggle={() => toggle('kreise')}>
        <div className="space-y-1">
          {design.circuits.map((c) => (
            <div key={c.circuit.id} className="rounded-lg bg-white/[0.03] px-2.5 py-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[11.5px] text-slate-200">{c.circuit.label}</span>
                <span className="shrink-0 text-[10px] text-accent">{fmt(c.load, 2)} kW</span>
              </div>
              {/*
                Die Nutzungseinheit des Kreises — abgeleitet aus seinen Räumen
                und deshalb nicht einstellbar. Sie steht nur da, wo überhaupt
                Einheiten erfasst sind; im Einfamilienhaus gibt es nichts zu
                unterscheiden. Mehr als eine ist ein Befund und keine Angabe:
                Ein Kreis über zwei Wohnungen lässt sich nicht je Wohnung
                regeln und nicht je Wohnung abrechnen.
              */}
              <KreisEinheit roomIds={c.circuit.roomIds} />
              <div className="mt-0.5 text-[10px] leading-relaxed text-slate-500">
                {c.circuit.flowTemperature}/{c.circuit.returnTemperature} °C · {fmt(c.flow, 3)} m³/h ·{' '}
                {c.pipe.dimension.label} ({c.pipe.reason}) · v = {fmt(c.pipe.velocity, 2)} m/s, R ={' '}
                {fmt(c.pipe.gradient, 0)} Pa/m · {LOAD_SOURCE_LABELS[c.loadSource]}
                {c.floor && (
                  <>
                    <br />
                    {c.floor.loops} Kreise à {fmt(c.floor.loopLength, 0)} m bei {fmt(c.floor.spacing * 100, 0)} cm Abstand ·{' '}
                    {fmt(c.floor.flowPerLoop, 0)} l/h je Kreis · Δp = {fmt(c.floor.loopPressureMbar, 0)} mbar ·{' '}
                    {fmt(c.floor.specificOutput, 0)} W/m² ({c.floor.specificOutputSource})
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
        {design.circuits.length > 0 && (
          <button
            className="chip mt-2 w-full bg-white/[0.04] hover:bg-white/[0.08]"
            onClick={() => {
              setPlantCircuits(design.circuits.map((c) => c.circuit));
              setStatus(`${design.circuits.length} Heizkreise ins Projekt übernommen`);
            }}
          >
            Kreise ins Projekt übernehmen
          </button>
        )}
        {design.pump && (
          <div className="mt-2 border-t border-white/[0.06] pt-2">
            <Readout label="Förderstrom" value={`${fmt(design.pump.flow, 2)} m³/h`} />
            <Readout label="Förderhöhe" value={`${fmt(design.pump.head, 2)} m`} accent />
            <Readout label="Druckdifferenz" value={`${fmt(design.pump.pressureKpa, 1)} kPa`} />
            <Readout label="ungünstigster Strang" value={design.pump.worstPath?.label ?? '—'} />
          </div>
        )}
      </Fold>

      {/* ---------------------------------------------------------------- */}
      {/* 5 — Speicher                                                      */}
      {/* ---------------------------------------------------------------- */}
      <Fold title="Speicher" open={open.speicher} onToggle={() => toggle('speicher')}>
        <StorageRow
          title="Puffer"
          suggestion={design.buffer.selected}
          reason={design.buffer.reason}
          onAccept={addPlantStorage}
          onRemove={removePlantStorage}
        />
        <StorageRow
          title="Trinkwasser"
          suggestion={design.dhwStorage}
          reason={
            design.dhw
              ? `${design.dhw.demandIndex ? `Bedarfskennzahl N = ${fmt(design.dhw.demandIndex, 1)} · ` : ''}${
                  design.dhw.recommendedVolume
                } l empfohlen · Aufheizleistung ${fmt(design.dhw.reheatCapacity, 1)} kW in ${fmt(design.dhw.reheatTime, 1)} h`
              : ''
          }
          onAccept={addPlantStorage}
          onRemove={removePlantStorage}
        />
        <div className="mt-2 border-t border-white/[0.06] pt-2">
          <Readout label="Wasserinhalt der Anlage" value={`${design.volume.total} l`} accent />
          <Readout label="Puffer rechnerisch nötig" value={`${design.buffer.required} l`} term="puffer" />
        </div>
        <details className="mt-1.5">
          <summary className="cursor-pointer text-[10px] text-slate-500 hover:text-slate-300">Wasserinhalt im Einzelnen</summary>
          <div className="mt-1 space-y-0.5">
            {design.volume.parts.map((p) => (
              <div key={p.label} className="flex justify-between text-[10px] text-slate-500">
                <span className="truncate pr-2">{p.label}</span>
                <span className="shrink-0 tabular-nums">{fmt(p.volume, 1)} l</span>
              </div>
            ))}
          </div>
        </details>
      </Fold>

      {/* ---------------------------------------------------------------- */}
      {/* 6 — Trinkwasser                                                   */}
      {/* ---------------------------------------------------------------- */}
      <Fold title="Trinkwarmwasser" open={open.tww} onToggle={() => toggle('tww')}>
        <div className="grid grid-cols-2 gap-2">
          <Num label="Wohneinheiten" unit="" value={plant.dhw.units} onChange={(v) => updatePlant({ dhw: { units: Math.max(1, Math.round(v)) } })} />
          <Num label="Personen je WE" unit="" step={0.5} value={plant.dhw.occupantsPerUnit} onChange={(v) => updatePlant({ dhw: { occupantsPerUnit: v } })} />
          <Num label="Speicher" unit="°C" term="legionellen" value={plant.design.dhwTemperature} onChange={(v) => updatePlant({ design: { dhwTemperature: v } })} />
          <Num label="Zapfung" unit="°C" value={plant.design.tapTemperature} onChange={(v) => updatePlant({ design: { tapTemperature: v } })} />
          <Num label="Aufheizzeit" unit="h" step={0.5} value={plant.dhw.reheatTime} onChange={(v) => updatePlant({ dhw: { reheatTime: v } })} />
          <Num label="längste Leitung" unit="l" step={0.5} term="zirkulation" value={plant.dhw.longestBranchContent} onChange={(v) => updatePlant({ dhw: { longestBranchContent: v } })} />
        </div>
        <div className="mt-1.5 flex gap-0.5 rounded-lg bg-graphite-900/60 p-0.5">
          {(['sparsam', 'normal', 'komfort'] as const).map((c) => (
            <button
              key={c}
              onClick={() => updatePlant({ dhw: { comfort: c } })}
              className={`chip flex-1 ${plant.dhw.comfort === c ? 'bg-accent/15 text-accent' : 'text-slate-500 hover:text-slate-300'}`}
            >
              {c}
            </button>
          ))}
        </div>
        <EinheitenBlock />
        {design.dhw && (
          <div className="mt-2 space-y-1.5">
            <div>
              <Readout label="empfohlener Speicher" value={`${design.dhw.recommendedVolume} l`} accent />
              <Readout label="Aufheizleistung" value={`${fmt(design.dhw.reheatCapacity, 1)} kW`} />
              <Readout label="Einstufung W 551" value={design.dhw.legionellaRegime === 'großanlage' ? 'Großanlage' : 'Kleinanlage'} term="legionellen" />
              <Readout label="Zirkulation" value={design.dhw.circulationRequired ? 'erforderlich' : 'nicht nötig'} term="zirkulation" />
            </div>
            <p className="rounded-lg bg-white/[0.03] px-2.5 py-2 text-[10px] leading-relaxed text-slate-500">
              {design.dhw.legionellaReason}
              <br />
              {design.dhw.circulationReason}
            </p>
          </div>
        )}
      </Fold>

      {/* ---------------------------------------------------------------- */}
      {/* 7 — Sicherheitstechnik                                            */}
      {/* ---------------------------------------------------------------- */}
      <Fold title="Sicherheitstechnik" open={open.sicherheit} onToggle={() => toggle('sicherheit')}>
        <div className="grid grid-cols-2 gap-2">
          <Num label="statische Höhe" unit="m" step={0.5} term="vordruck" value={plant.safety.staticHeight} onChange={(v) => updatePlant({ safety: { staticHeight: v } })} />
          <Num label="Ansprechdruck" unit="bar" step={0.5} value={plant.safety.safetyValvePressure} onChange={(v) => updatePlant({ safety: { safetyValvePressure: v } })} />
          <Num label="max. Temperatur" unit="°C" step={5} value={plant.safety.maxTemperature} onChange={(v) => updatePlant({ safety: { maxTemperature: v } })} />
          <Num label="vorh. Gefäß" unit="l" step={1} term="ausdehnungsgefaess" value={plant.safety.existingVessel} onChange={(v) => updatePlant({ safety: { existingVessel: v } })} />
        </div>
        {design.safety && (
          <>
            <div className="mt-2 border-t border-white/[0.06] pt-2">
              <Readout label="Gefäß, gewählte Baugröße" value={`${design.safety.selectedVessel} l`} accent term="ausdehnungsgefaess" />
              <Readout label="rechnerisch nötig" value={`${fmt(design.safety.requiredVessel, 1)} l`} />
              <Readout label="Vordruck p₀" value={`${fmt(design.safety.prePressure, 2)} bar`} term="vordruck" />
              <Readout label="Fülldruck p_F" value={`${fmt(design.safety.fillPressure, 2)} bar`} />
              <Readout label="Enddruck p_e" value={`${fmt(design.safety.endPressure, 2)} bar`} />
              <Readout label="Ausdehnungsvolumen" value={`${fmt(design.safety.expansionVolume, 1)} l`} />
              <Readout label="Wasservorlage" value={`${fmt(design.safety.waterSeal, 1)} l`} />
              <Readout label="Sicherheitsventil" value={design.safety.safetyValve.label} />
            </div>
            <details className="mt-1.5">
              <summary className="cursor-pointer text-[10px] text-slate-500 hover:text-slate-300">
                Armaturenliste ({design.safety.fittings.length})
              </summary>
              <div className="mt-1 space-y-1">
                {design.safety.fittings.map((f, i) => (
                  <div key={`${f.kind}-${i}`} className="rounded bg-white/[0.03] px-2 py-1.5">
                    <div className="flex justify-between gap-2 text-[10.5px] text-slate-300">
                      <span>{f.label}</span>
                      <span className="shrink-0 tabular-nums text-slate-400">{f.spec}</span>
                    </div>
                    <div className="text-[9.5px] text-slate-600">{f.norm}</div>
                  </div>
                ))}
              </div>
            </details>
          </>
        )}
      </Fold>

      {/* ---------------------------------------------------------------- */}
      {/* 7b — Hydraulischer Abgleich                                       */}
      {/* ---------------------------------------------------------------- */}
      <Fold title="Hydraulischer Abgleich" open={open.abgleich} onToggle={() => toggle('abgleich')}>
        {!balance ? (
          <p className="rounded-lg bg-white/[0.03] px-2.5 py-2 text-[10px] leading-relaxed text-slate-500">
            Noch keine Leitungen gezeichnet. Der Abgleich rechnet am tatsächlich verlegten Netz — mit dem Werkzeug
            „Leitung verlegen" (Taste L) Vorlauf und Rücklauf vom Verteiler zu den Heizflächen ziehen; ein Klick auf ein
            Symbol schließt dort an.
          </p>
        ) : (
          <>
            <div>
              <Readout label="Verbraucher" value={String(balance.consumers.length)} />
              <Readout label="Gesamtvolumenstrom" value={`${fmt(balance.totalFlow, 2)} m³/h`} />
              <Readout label="ungünstigster Strang" value={balance.worst ? `${fmt(balance.worst.lossKpa, 1)} kPa` : '—'} accent />
              <Readout label="günstigster Strang" value={balance.best ? `${fmt(balance.best.lossKpa, 1)} kPa` : '—'} />
              <Readout label="Unterschied, zu drosseln" value={`${fmt(balance.lossSpread / 1000, 1)} kPa`} />
              <Readout label="Förderhöhe der Pumpe" value={`${fmt(balance.pump.head, 2)} m`} />
            </div>

            <div className="mt-2 space-y-0.5">
              <div className="flex gap-1 text-[9.5px] uppercase tracking-wider text-slate-600">
                <span className="min-w-0 flex-1">Verbraucher</span>
                <span className="w-12 text-right">m³/h</span>
                <span className="w-12 text-right">kPa</span>
                <span className="w-12 text-right">Drossel</span>
                <span className="w-11 text-right">kv</span>
              </div>
              {balance.consumers.slice(0, 24).map((c) => (
                <div
                  key={c.fixtureId}
                  className="flex gap-1 text-[10px] tabular-nums text-slate-400"
                  title={`${PRESET_VERDICT_LABELS[c.preset]}${c.powerAssumed ? ' · Leistung ist eine Vorbelegung' : ''}`}
                >
                  <span className={`min-w-0 flex-1 truncate ${c.worst ? 'text-accent' : ''}`}>
                    {c.label}
                    {c.powerAssumed && <span className="text-slate-600"> *</span>}
                  </span>
                  <span className="w-12 text-right">{fmt(c.flow, 3)}</span>
                  <span className="w-12 text-right">{fmt(c.ownLossKpa, 1)}</span>
                  <span className="w-12 text-right">{c.worst ? 'offen' : fmt(c.throttleKpa, 1)}</span>
                  <span className="w-11 text-right">{c.requiredKv === undefined ? '—' : fmt(c.requiredKv, 2)}</span>
                </div>
              ))}
            </div>

            {(balance.undersized > 0 || balance.oversized > 0) && (
              <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
                Rohrnetz: {balance.undersized} Abschnitte zu klein, {balance.oversized} könnten kleiner sein.
              </p>
            )}

            {balance.notes.length > 0 && (
              <div className="mt-2 space-y-1">
                {balance.notes.slice(0, 6).map((n, i) => (
                  <p key={i} className={`rounded px-2.5 py-1.5 text-[10px] leading-relaxed ${SEVERITY_STYLE[n.severity]}`}>
                    {n.text}
                  </p>
                ))}
              </div>
            )}
          </>
        )}
      </Fold>

      </>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* 8 — Schema                                                        */}
      {/* ---------------------------------------------------------------- */}
      <div className="rounded-lg bg-graphite-900/60 p-2.5">
        <div className="mb-1.5 flex items-baseline justify-between">
          <span className="label-xs">Anlagenschema</span>
          <span className="text-[10px] text-slate-500">
            {Object.keys(plant.schematic.components).length} Bauteile
            {plant.schematic.manual && <span className="text-amber-300"> · von Hand bearbeitet</span>}
          </span>
        </div>
        {/*
          Die sieben Fragen, aus denen die Anlage entsteht.

          Hier stand bis 1.51.0 die Liste der vorgeschlagenen Hydraulikschemata
          — „BWP-H-06 … 8 nicht passende zeigen". Gemeldet aus der Benutzung:
          irreführend. Zu Recht: Sie verlangte, eine Musterlösung
          *wiederzuerkennen*, bevor man sagen durfte, was man baut. Jetzt
          umgekehrt — sieben Angaben zu dem, was auf der Baustelle steht, und
          daraus entsteht die Anlage.

          **Alles in einem Feld, nicht nacheinander.** Die Angaben hängen
          voneinander ab, beim zweiten Gebäude ändert man zwei davon, und wer
          den vierten Schritt ausfüllt, soll den zweiten noch sehen.
        */}
        {/*
          Die sieben Fragen, aus denen die Anlage entsteht.

          Hier stand bis 1.51.0 die Liste der vorgeschlagenen
          Hydraulikschemata — „BWP-H-06 … 8 nicht passende zeigen". Gemeldet
          aus der Benutzung: irreführend. Zu Recht: Sie verlangte, eine
          Musterlösung *wiederzuerkennen*, bevor man sagen durfte, was man
          baut. Jetzt umgekehrt — Angaben zu dem, was auf der Baustelle
          steht, und daraus entsteht die Anlage.

          **Die Felder selbst stehen in `AnlagenFragen`**, weil sie seit
          1.54.0 auch im Anlagendialog am Schema erscheinen. Zwei Abschriften
          derselben sieben Felder wären zwei Stellen, an denen ein achtes
          nachzutragen ist — und eine, an der es vergessen wird.
        */}
        <div className="mb-2">
          <AnlagenFragen
            antworten={antworten}
            setzeAntwort={setzeAntwort}
            abweichungsliste={abweichungsliste}
          />
        </div>
        <button
          className="chip w-full bg-accent/12 text-accent hover:bg-accent/20"
          onClick={() => {
            // Von Hand ergänzte Armaturen gehen beim Neuerzeugen verloren.
            // Das darf nicht stillschweigend passieren — wer eine halbe
            // Stunde im Schema gearbeitet hat, verliert sie sonst mit einem
            // Klick.
            if (plant.schematic.manual && !window.confirm(
              'Das Schema wurde von Hand bearbeitet. Neu erzeugen verwirft alle Änderungen daran. Fortfahren?',
            )) {
              return;
            }
            const { components, links, notes } = buildSchematic(design);
            /*
             * **Ohne Vorlagenkennung.** Bis 1.50.1 bekam das erzeugte Bild
             * die Kennung der Musterlösung, nach der es gebaut war. Seit die
             * Anlage aus den sieben Antworten entsteht, gibt es keine Vorlage
             * mehr, die es zu nennen gäbe — sie zu behaupten, wäre eine
             * Herkunft, die nicht stimmt.
             */
            setSchematic(components, links, false, undefined);
            // Der Generator sagt, was er entschieden hat und warum — etwa,
            // dass das Überströmventil wegen des Trennpuffers entfällt oder
            // dass dem Gerät ein Heizstab fehlt. Diese Sätze gehören dem
            // Anwender und nicht ins Nichts.
            const wichtig = notes.filter((x) => x.severity !== 'info');
            setStatus(
              `Anlagenschema erzeugt — ${components.length} Bauteile, ${links.length} Verbindungen` +
                (notes.length ? ` · ${notes.length} Hinweis${notes.length === 1 ? '' : 'e'}` : '') +
                (wichtig.length ? `: ${wichtig[0].text}` : notes.length ? `: ${notes[0].text}` : ''),
            );
          }}
        >
          {Object.keys(plant.schematic.components).length ? 'Schema neu erzeugen' : 'Schema erzeugen'}
        </button>
        <p className="mt-1.5 text-[10px] leading-relaxed text-slate-500">
          Erzeugt ein Prinzipschema aus der Auslegung — Erzeuger, Speicher, Armaturen, Kreise. Es sagt, was verbaut
          wird und woran es hängt, nicht wo es im Technikraum steht. Ansicht über „3D/Schema" in der Kopfzeile.
        </p>

        {/*
          Prüfung des Schemas gegen die Regeln der Fachliteratur.

          Sie steht direkt unter dem Erzeugen, weil sie genau das bewertet,
          was der Knopf darüber gebaut hat. Ein leeres Ergebnis ist keine
          Freigabe: geprüft wird nur, was sich am Fließbild überhaupt
          feststellen lässt — Fühlerorte, Regelparameter und Kennlinien
          stehen nicht darin.
        */}
        {befunde.length > 0 && (
          <div className="mt-2 space-y-1">
            <div className="flex items-baseline justify-between">
              <span className="label-xs">Prüfung des Schemas</span>
              <span className="text-[9.5px] text-slate-600">
                {befunde.filter((b) => b.grad === 'fehler').length} Fehler ·{' '}
                {befunde.filter((b) => b.grad === 'warnung').length} Warnungen ·{' '}
                {befunde.filter((b) => b.grad === 'hinweis').length} Hinweise
              </span>
            </div>
            {befunde.slice(0, 8).map((b: SchemaBefund) => (
              <div
                key={b.id}
                className={`rounded-lg px-2.5 py-1.5 ${
                  b.grad === 'fehler'
                    ? 'bg-rose-500/10'
                    : b.grad === 'warnung'
                      ? 'bg-orange-500/10'
                      : 'bg-white/[0.03]'
                }`}
              >
                <p
                  className={`text-[10.5px] font-medium ${
                    b.grad === 'fehler'
                      ? 'text-rose-300'
                      : b.grad === 'warnung'
                        ? 'text-orange-300'
                        : 'text-slate-400'
                  }`}
                >
                  {b.titel}
                </p>
                <p className="mt-0.5 text-[9.5px] leading-relaxed text-slate-500">{b.text}</p>
                <p className="mt-0.5 text-[9px] leading-relaxed text-slate-600">Beleg: {b.beleg}</p>
              </div>
            ))}
            {befunde.length > 8 && (
              <p className="text-[9.5px] text-slate-600">… und {befunde.length - 8} weitere.</p>
            )}
          </div>
        )}
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Rohrausleger                                                      */}
      {/* ---------------------------------------------------------------- */}
      <div className="panel px-3 py-2.5">
        <div className="label-xs mb-1.5">Rohrnetz auslegen</div>
        <div className="flex gap-1.5">
          <button
            className="chip flex-1 bg-white/[0.04] hover:bg-white/[0.08]"
            title="Leitungen auf der Rohdecke im Fußbodenaufbau — der Weg darf quer durch den Raum laufen"
            onClick={() => setRohrbericht(legeRohrnetzAus('neubau', undefined, { flaechenheizung: mitFlaeche }))}
          >
            Neubau
          </button>
          <button
            className="chip flex-1 bg-white/[0.04] hover:bg-white/[0.08]"
            title="Leitungen sichtbar an der Wand im Sockelleistenkanal — die Trasse folgt den Wänden"
            onClick={() => setRohrbericht(legeRohrnetzAus('sanierung', undefined, { flaechenheizung: mitFlaeche }))}
          >
            Sanierung
          </button>
          <button
            className="chip flex-1 bg-white/[0.04] hover:bg-white/[0.08]"
            title="Ringleitung im Sockelleistenkanal an den Außenwänden, Heizkörper mit kurzen Anbindungen — Zuleitung mindestens 1&quot;, Ring mindestens Cu 18, Anbindung mindestens Cu 15"
            onClick={() => setRohrbericht(legeRohrnetzAus('sanierung', 'ring', { flaechenheizung: mitFlaeche }))}
          >
            Ring
          </button>
        </div>
        {/*
          * Die Flächenheizung hängt **nicht** an der Verlegeart.
          *
          * In 1.65.0 lief sie nur im Neubaumodus — falsch, und sofort
          * gemeldet: Auch im Bestand wird eine Fußbodenheizung gelegt, und
          * gemischte Systeme sind der Normalfall. Die Verlegeart sagt, wie
          * die Verteilleitung läuft, nicht, welche Heizfläche im Raum liegt.
          */}
        <label className="mt-2 flex cursor-pointer items-start gap-2 text-[11px] leading-snug text-slate-400">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={mitFlaeche}
            onChange={(e) => setMitFlaeche(e.target.checked)}
          />
          <span>
            <b className="text-slate-300">Fußbodenheizung mitlegen</b> — in jeden beheizten Raum
            <b> ohne</b> Heizfläche, über alle Geschosse. Räume mit Heizkörper bleiben, wie sie sind;
            so entsteht das gemischte System.
          </span>
        </label>
        <p className="mt-1.5 text-[10px] leading-relaxed text-slate-500">
          Führt die Trasse vom Verteiler zu jedem Verbraucher, legt jeden Abschnitt nach seinem Volumenstrom aus,
          dämmt ihn nach Anlage 8 GEG und setzt die Armaturen. Von Hand gezogene Leitungen bleiben stehen.
        </p>
        {/*
          * Der Erzeuger-Assistent.
          *
          * Ohne Erzeuger, Speicher oder Verteiler bricht die Auslegung ab —
          * zu Recht, aber die Meldung kam bisher erst **nach** dem Druck auf
          * „Auslegen", und sie sagte nicht, wohin das Gerät gehört. Im
          * End-to-End-Lauf über die 54 Testgebäude war das in jedem
          * einzelnen Fall der Abbruchgrund beim ersten Versuch.
          *
          * Jetzt steht der Vorschlag **vorher** da, mit Ort und Begründung,
          * und ein Klick setzt ihn. Geraten wird nichts: Was gesetzt wird,
          * hat der Anwender gelesen.
          */}
        {erzeugerVorschlag && (
          <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.07] px-2.5 py-2">
            <p className="text-[10.5px] font-medium text-amber-200">
              Es steht noch kein Wärmeerzeuger im Modell.
            </p>
            <p className="mt-0.5 text-[10px] leading-relaxed text-amber-100/70">
              Vorschlag: <span className="font-medium">{erzeugerVorschlag.ort}</span>. {erzeugerVorschlag.grund}
            </p>
            <button
              className="chip mt-1.5 w-full bg-amber-500/15 text-amber-200 hover:bg-amber-500/25"
              title="Setzt einen Wärmeerzeuger an die vorgeschlagene Stelle. Verschieben geht danach jederzeit."
              onClick={() => setzeErzeugerNachVorschlag()}
            >
              Hier setzen
            </button>
          </div>
        )}
        {rohrbericht && (
          <div className="mt-2 space-y-1 rounded-lg bg-graphite-900/60 px-2.5 py-2">
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10.5px] text-slate-300">
              <span>Verbraucher</span>
              <span className="text-right font-mono">{rohrbericht.served}</span>
              <span>Trasse</span>
              <span className="text-right font-mono">{rohrbericht.routeLength.toFixed(1)} m</span>
              <span>Rohr (VL + RL)</span>
              <span className="text-right font-mono">{rohrbericht.pipeLength.toFixed(1)} m</span>
              <span>Armaturen</span>
              <span className="text-right font-mono">{rohrbericht.accessories.length}</span>
              {/* Seit 1.71.0: Steigleitung, Formteile und je Geschoss —
                  gemeldet am 02.10.2026, die Zahlen braucht der Abgleich. */}
              {netzZahlen.steig > 0 && (
                <>
                  <span>davon Steigleitung</span>
                  <span className="text-right font-mono">{netzZahlen.steig.toFixed(1)} m</span>
                </>
              )}
              <span>Formteile</span>
              <span className="text-right font-mono" title="Bögen · T-Stücke · Reduzierungen">
                {netzZahlen.formteile['bogen-90']} B · {netzZahlen.formteile['t-stueck']} T · {netzZahlen.formteile.reduzierung} R
              </span>
            </div>
            {rohrbericht.geschosse.length > 1 && (
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 border-t border-white/[0.06] pt-1 text-[10px] text-slate-400">
                {rohrbericht.geschosse.map((g) => (
                  <Fragment key={g.levelId}>
                    <span>{g.name}</span>
                    <span className="text-right font-mono">
                      {g.served} Verbr. · {g.pipeLength.toFixed(1)} m
                    </span>
                  </Fragment>
                ))}
              </div>
            )}
            <Protokoll eintraege={rohrbericht.notes} titel="Auslegungsprotokoll" />
          </div>
        )}
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* 9 — Hinweise                                                      */}
      {/* ---------------------------------------------------------------- */}
      {/* ---------------------------------------------------------------- */}
      {/* 9 — Unterlagen                                                    */}
      {/* ---------------------------------------------------------------- */}
      <div className="rounded-lg bg-graphite-900/60 p-2.5">
        <span className="label-xs mb-1.5 block">Unterlagen</span>
        <div className="space-y-1.5">
          <button
            className="chip w-full bg-accent/12 text-accent hover:bg-accent/20"
            title="Deckblatt, Auslegung, Raumbuch, Armaturenliste, Hinweise und Inbetriebnahme-Checkliste"
            onClick={() => {
              const book = buildPlantBook({
                design,
                projectName: doc.meta.name,
                plantName: 'Wärmepumpenanlage',
                author: 'RaVia CAD Light',
                date: new Date().toLocaleDateString('de-DE'),
                rooms: buildRaviaExport(doc).rooms,
              });
              printPlantBook(book.html, book.title);
            }}
          >
            Anlagenbuch drucken
          </button>
          <button
            className="chip w-full bg-white/[0.05] text-slate-300 hover:bg-white/[0.1]"
            title="Alle Mengen des Projekts als Tabelle für die Kalkulation"
            onClick={() => {
              const schedule = buildMaterialSchedule(doc, design);
              downloadText(
                '\ufeff' + materialScheduleCsv(schedule),
                `${doc.meta.name.replace(/[^\wäöüÄÖÜß -]/g, '_')} — Massenauszug.csv`,
                'text/csv;charset=utf-8',
              );
              setStatus(`Massenauszug mit ${schedule.positionCount} Positionen gesichert`);
            }}
          >
            Massenauszug als CSV
          </button>
        </div>
        <p className="mt-1.5 text-[10px] leading-relaxed text-slate-500">
          Das Anlagenbuch nennt seine eigenen Grenzen im zweiten Kapitel — was Überschlag ist, was Typklasse und was
          kein Gutachten. Wer ein Dokument weitergibt, gibt sie mit.
        </p>
      </div>

      {/* Seit 1.71.0 eingeklappt — dieselbe Regel wie beim Rohrnetz: eine
          offene Liste roter Kästen liest sich wie eine Fehlerliste, auch wo
          nur steht, wie gerechnet wurde (gemeldet am 02.10.2026). */}
      {mindestens(uiMode, 'profi') && design.notes.length > 0 && (
        <Protokoll
          titel="Hinweise zur Anlagenauslegung"
          eintraege={design.notes}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bausteine
// ---------------------------------------------------------------------------

function Fold({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
  open?: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg bg-graphite-900/60">
      <button className="flex w-full items-center justify-between px-2.5 py-2 text-left" onClick={onToggle}>
        <span className="label-xs">{title}</span>
        <span className="text-[10px] text-slate-600">{open ? '▾' : '▸'}</span>
      </button>
      {open && <div className="px-2.5 pb-2.5">{children}</div>}
    </div>
  );
}

/**
 * Beschriftung links, Zahl rechts.
 *
 * Die Zahl wird nie gekürzt — sie ist der Grund, warum die Zeile existiert.
 * Gekürzt wird die Beschriftung, und zwar mit Auslassungspunkten und einem
 * Tooltip, damit der volle Wortlaut erreichbar bleibt.
 */
/**
 * Beschriftung links, Eingabefeld rechts — dieselbe Zeilenform wie im
 * Wärmepumpenblatt. Der Inspektor ist 300 Pixel breit; was hier steht, muss
 * in eine Zeile passen.
 */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 py-0.5">
      <span className="min-w-0 flex-1 truncate text-[10px] text-slate-500" title={label}>
        {label}
      </span>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Readout({ label, value, accent, term }: { label: string; value: string; accent?: boolean; term?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-0.5">
      <span className="inline-flex min-w-0 items-center gap-1 text-[10px] text-slate-500" title={label}>
        <span className="truncate">{label}</span>
        {term && <Erklaerung term={term} />}
      </span>
      <span className={`shrink-0 whitespace-nowrap tabular-nums text-[11px] ${accent ? 'text-accent' : 'text-slate-300'}`}>
        {value}
      </span>
    </div>
  );
}

function Num({
  label,
  unit,
  value,
  step = 1,
  term,
  onChange,
}: {
  label: string;
  unit: string;
  value: number;
  step?: number;
  /** Begriff aus dem Glossar — setzt ein Fragezeichen neben die Beschriftung. */
  term?: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="label-xs inline-flex items-center gap-1 whitespace-nowrap">
        {label} {unit && <span className="text-slate-600">[{unit}]</span>}
        {term && <Erklaerung term={term} />}
      </span>
      <input
        className="field mt-0.5 font-mono"
        type="number"
        step={step}
        value={value}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(v);
        }}
      />
    </label>
  );
}

/**
 * Ein Speichervorschlag mit der Möglichkeit, ihn zu übernehmen.
 *
 * Der Unterschied zwischen Vorschlag und Projektstand ist hier sichtbar:
 * solange `suggested` gilt, ist es die Meinung des Programms; nach dem Klick
 * steht der Speicher im Projekt und im Export.
 */
function StorageRow({
  title,
  suggestion,
  reason,
  onAccept,
  onRemove,
}: {
  title: string;
  suggestion?: import('../types/bim').PlantStorage;
  reason: string;
  onAccept: (s: import('../types/bim').PlantStorage) => void;
  onRemove: (id: string) => void;
}) {
  if (!suggestion) {
    return (
      <div className="mb-1.5 rounded-lg bg-white/[0.03] px-2.5 py-2">
        <div className="text-[11px] text-slate-300">{title}</div>
        <div className="text-[10px] leading-relaxed text-slate-500">{reason || 'nicht erforderlich'}</div>
      </div>
    );
  }
  return (
    <div className={`mb-1.5 rounded-lg px-2.5 py-2 ${suggestion.suggested ? 'bg-white/[0.03]' : 'bg-accent/10 ring-1 ring-accent/30'}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] text-slate-200">
          {title}: {suggestion.label}
        </span>
        <span className="shrink-0 text-[10px] text-slate-500">{suggestion.suggested ? 'Vorschlag' : 'geplant'}</span>
      </div>
      {reason && <div className="mt-0.5 text-[10px] leading-relaxed text-slate-500">{reason}</div>}
      <button
        className="chip mt-1.5 w-full bg-white/[0.04] hover:bg-white/[0.08]"
        onClick={() => (suggestion.suggested ? onAccept(suggestion) : onRemove(suggestion.id))}
      >
        {suggestion.suggested ? 'übernehmen' : 'entfernen'}
      </button>
    </div>
  );
}

/**
 * Die Auslegung in Sätzen.
 *
 * Dieselben Zahlen wie oben, nur als Text und ohne die Zwischenschritte. Wer
 * eine Anlage nicht selbst rechnet, sondern einbaut, braucht genau diese
 * sieben Angaben — und zwar so, dass er sie am Telefon vorlesen kann.
 */
/**
 * Ein Satz zur Herkunft der Heizlast.
 *
 * Er steht in der Kurzfassung, also bei dem, der die Anlage einbaut und nicht
 * rechnet. Für ihn ist der Unterschied zwischen „gerechnet" und „überschlagen"
 * die wichtigste Angabe der ganzen Liste: an ihr hängt, ob er die Zahl am
 * Telefon weitergeben kann oder ob er dazusagen muss, dass sie vorläufig ist.
 */
function heizlastHerkunft(design: ReturnType<typeof designPlant>): string {
  const c = design.normCoverage;
  const woher = c.source
    ? `${c.source}${c.receivedAt ? `, ${zeitpunktDe(c.receivedAt) ?? ''}` : ''}`
    : 'RaVia';
  const veraltet =
    c.outdated > 0
      ? ` · Achtung: ${c.outdated === 1 ? 'eine Raumlast wurde' : `${c.outdated} Raumlasten wurden`} für einen früheren Modellstand gerechnet`
      : '';

  if (design.heatLoadProvenance === 'vorgabe') {
    return `von Hand eingetragen oder aus RaVia geschrieben — das Programm hat diese Zahl nicht nachgerechnet${veraltet}`;
  }
  if (design.heatLoadProvenance === 'raumweise') {
    return `Summe der gerechneten Norm-Heizlasten aller ${c.heatedRooms} beheizten Räume (${woher})${veraltet}`;
  }
  if (c.withNorm > 0) {
    return `überschlägig aus dem Modell — erst ${c.withNorm} von ${c.heatedRooms} Räumen tragen eine gerechnete Last (${woher}), das reicht für die Gebäudeheizlast noch nicht${veraltet}`;
  }
  return 'überschlägig aus dem Modell — die Norm-Heizlast aus RaVia oben eintragen, sobald sie vorliegt';
}

function KurzFassung({ design }: { design: ReturnType<typeof designPlant> }) {
  const s = design.selected;
  const kreise = design.circuits.reduce((n, c) => n + (c.loops ?? 0), 0);

  const zeilen: { was: string; wert: string; dazu?: string }[] = [
    {
      was: 'Heizlast',
      wert: `${fmt(design.heatLoad, 2)} kW`,
      dazu: heizlastHerkunft(design),
    },
    {
      was: 'Gerät muss können',
      wert: `${fmt(design.requiredCapacity, 2)} kW`,
      dazu: `Heizlast ${design.dhwSurcharge > 0 ? `plus ${fmt(design.dhwSurcharge, 2)} kW Warmwasser` : 'ohne Warmwasserzuschlag'}${
        design.blocking > 1 ? `, mal Sperrzeitfaktor ${fmt(design.blocking, 2)}` : ''
      }`,
    },
    s
      ? {
          was: 'Vorschlag',
          wert: s.model.label,
          dazu: `${fmt(s.capacityAtDesign, 1)} kW bei der Auslegungstemperatur · ${s.reason}`,
        }
      : { was: 'Vorschlag', wert: '—', dazu: 'Kein Gerät gefunden, das die Leistung schafft.' },
    {
      was: 'Heizkreise',
      wert: kreise > 0 ? `${kreise} Stück` : `${design.circuits.length} Kreis${design.circuits.length === 1 ? '' : 'e'}`,
      dazu: design.circuits
        .map((c) => `${c.circuit.label}: ${c.circuit.flowTemperature}/${c.circuit.returnTemperature} °C, ${c.pipe.dimension.label}`)
        .join(' · '),
    },
    {
      was: 'Puffer',
      wert: design.buffer.selected ? `${design.buffer.selected.volume} l` : 'nicht nötig',
      dazu: design.buffer.reason,
    },
    {
      was: 'Warmwasser',
      wert: design.dhwStorage ? `${design.dhwStorage.volume} l` : '—',
      dazu: design.dhw
        ? `${design.dhw.storageTemperature} °C · Aufheizung ${fmt(design.dhw.reheatCapacity, 1)} kW · ${
            design.dhw.circulationRequired ? 'mit Zirkulation' : 'ohne Zirkulation'
          }`
        : undefined,
    },
    {
      was: 'Ausdehnungsgefäß',
      wert: design.safety ? `${design.safety.selectedVessel} l` : '—',
      dazu: design.safety
        ? `Vordruck ${fmt(design.safety.prePressure, 1)} bar, Fülldruck ${fmt(design.safety.fillPressure, 1)} bar · Sicherheitsventil ${design.safety.safetyValve.label}`
        : undefined,
    },
  ];

  return (
    <div className="space-y-1">
      <span className="label-xs block">Das Ergebnis in Kürze</span>
      {zeilen.map((z) => (
        <div key={z.was} className="rounded-lg bg-white/[0.03] px-2.5 py-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[11px] text-slate-400">{z.was}</span>
            <span className="shrink-0 text-[11.5px] text-accent">{z.wert}</span>
          </div>
          {z.dazu && <p className="mt-0.5 text-[10px] leading-relaxed text-slate-500">{z.dazu}</p>}
        </div>
      ))}
      <p className="rounded-lg bg-white/[0.03] px-2.5 py-2 text-[10px] leading-relaxed text-slate-500">
        Rohrdimensionen, Druckverluste, Armaturenliste, Verteilertabelle und den hydraulischen Abgleich zeigt die
        Ansicht „Fachplaner" — umschalten im Reiter „Start".
      </p>
    </div>
  );
}

/** Text als Datei sichern — der immer gleiche Dreisatz aus Blob, Link, Klick. */
/**
 * **Die Deckungsanteile der bivalenten Anlage.**
 *
 * Die zwei Zahlen, um die es geht: Wie viel der Heizarbeit trägt die
 * Wärmepumpe, wie viel der zweite Erzeuger. Sie entscheiden über
 * Förderfähigkeit, Betriebskosten und darüber, ob die Anlage mit Recht eine
 * Wärmepumpenanlage heißt — und sie fallen bei der alternativen Fahrweise
 * regelmäßig anders aus, als man beim Blick auf die Stundenzahl erwartet.
 *
 * Gerechnet wird mit dem **eingetragenen** Bivalenzpunkt. Der Vorschlag aus
 * der Gerätekennlinie steht nur daneben: Wo er liegt, ist eine
 * Planungsentscheidung — wer ihn höher legt, kauft Betriebskosten gegen
 * Investition.
 */
function BivalenzBlock({ design }: { design: ReturnType<typeof designPlant> }) {
  const pz = (v: number) => `${(v * 100).toFixed(1).replace('.', ',')} %`;
  if ('hindernis' in design.bivalenz) {
    // Kein Grund, etwas zu sagen, wenn die Anlage monovalent ist — dieser
    // Block erscheint ohnehin nur mit zweitem Erzeuger.
    if (design.bivalenz.hindernis === 'kein-zweiterzeuger') return null;
    return (
      <p className={`mt-2 rounded px-2.5 py-1.5 text-[10px] leading-relaxed ${SEVERITY_STYLE.info}`}>
        <b>Deckungsanteile:</b> {BIVALENZ_HINDERNIS_TEXT[design.bivalenz.hindernis]}
      </p>
    );
  }
  const e = design.bivalenz.ergebnis;
  return (
    <div className="mt-2 rounded-lg bg-white/[0.03] p-2">
      <span className="label-xs">Deckungsanteile der Heizarbeit</span>
      <div className="mt-1">
        <Readout label="Wärmepumpe" value={pz(e.anteilWaermepumpe)} accent term="deckungsanteil" />
        <Readout label="zweiter Erzeuger" value={pz(e.anteilZweiterzeuger)} />
        <Readout label="Heizzeit unter dem Bivalenzpunkt" value={pz(e.zeitanteilUnterBivalenz)} />
        {e.zeitanteilOhneWaermepumpe > 0 && (
          <Readout label="davon Wärmepumpe aus" value={pz(e.zeitanteilOhneWaermepumpe)} />
        )}
        <Readout
          label="zweiter Erzeuger muss tragen"
          value={`${fmt(e.leistungZweiterzeuger, 2)} kW`}
          accent={e.leistungFehlt > 0}
        />
      </div>
      {e.leistungFehlt > 0 && (
        <p className={`mt-1.5 rounded px-2 py-1.5 text-[10px] leading-relaxed ${SEVERITY_STYLE.warn}`}>
          Es fehlen {fmt(e.leistungFehlt, 2)} kW: eingetragen sind {fmt(e.leistungVorhanden, 2)} kW.{' '}
          {e.betrieb === 'bivalent-alternativ' || e.betrieb === 'bivalent-teilparallel'
            ? 'Unter dem Abschaltpunkt trägt der zweite Erzeuger die ganze Norm-Heizlast und nicht nur die Spitze.'
            : 'Die Fehlmenge wird nicht auf die Wärmepumpe umgerechnet.'}
        </p>
      )}
      {design.bivalenzVorschlag !== undefined && (
        <p className="mt-1.5 text-[10px] leading-relaxed text-slate-500">
          Aus der Kennlinie des gewählten Geräts ergäbe sich ein Bivalenzpunkt von{' '}
          <b>{grad(design.bivalenzVorschlag)} °C</b> — eingetragen sind {grad(e.bivalenzpunkt)} °C. Gerechnet
          wird mit dem eingetragenen Wert; wo der Punkt liegt, ist eine Planungsentscheidung.
        </p>
      )}
      <details className="mt-1.5">
        <summary className="cursor-pointer text-[10px] text-slate-500 hover:text-slate-300">
          Woraus das gerechnet ist
        </summary>
        <ul className="mt-1 space-y-1">
          {e.annahmen.map((a) => (
            <li key={a} className="text-[10px] leading-relaxed text-slate-500">
              · {a}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

/** Die Nutzungseinheit eines Heizkreises, aus seinen Räumen gelesen. */
function KreisEinheit({ roomIds }: { roomIds: readonly string[] }) {
  const doc = useBimStore((s) => s.doc);
  if (!Object.keys(doc.units ?? {}).length) return null;
  const treffer = einheitenVonRaeumen(doc, roomIds);
  if (treffer.length === 0) return null;
  const namen = treffer.map((id) => doc.units?.[id]?.name ?? id).join(', ');
  return (
    <div className={`mt-0.5 text-[10px] ${treffer.length > 1 ? 'text-amber-300' : 'text-slate-400'}`}>
      {treffer.length > 1 ? `über ${treffer.length} Einheiten: ${namen}` : namen}
    </div>
  );
}

/**
 * **Die Nutzungseinheiten des Gebäudes.**
 *
 * Warum dieser Block ausgerechnet hier steht, zwischen Zapftemperatur und
 * Speichergröße: Die Zahl der Wohneinheiten ist das Feld darüber. Sie geht in
 * den Trinkwasserbedarf, in die Speichergröße und in die Gefäßauslegung, und
 * § 60c Abs. 1 GModG knüpft an sie die Pflicht zum hydraulischen Abgleich.
 * Bisher war sie eine getippte Zahl, die niemand gegen das Modell gehalten
 * hat — und eine getippte Zahl, die plausibel aussieht und falsch ist, ist der
 * stillste Fehler, den dieses Programm kennt.
 *
 * Hier stehen beide nebeneinander: die getippte und die gezählte.
 */
function EinheitenBlock() {
  const doc = useBimStore((s) => s.doc);
  const neueEinheit = useBimStore((s) => s.neueEinheit);
  const benenneEinheit = useBimStore((s) => s.benenneEinheit);
  const setzeEinheitArt = useBimStore((s) => s.setzeEinheitArt);
  const loescheEinheit = useBimStore((s) => s.loescheEinheit);
  const uebernehmeEinheitenzahl = useBimStore((s) => s.uebernehmeEinheitenzahl);

  const bilanzen = einheitsbilanzen(doc);
  const stand = einheitenstand(doc);
  /*
   * Welche Heizkreise eine Einheit versorgen — für den Fall „zentrale
   * Versorgung, Heizkreise je Wohnung". Abgeleitet über die Räume; ein Kreis
   * über zwei Einheiten erscheint bei beiden.
   */
  const kreiseJeEinheit = new Map<string, string[]>();
  for (const kreis of Object.values(doc.plant?.circuits ?? {})) {
    for (const unitId of einheitenVonRaeumen(doc, kreis.roomIds)) {
      const liste = kreiseJeEinheit.get(unitId);
      if (liste) liste.push(kreis.label);
      else kreiseJeEinheit.set(unitId, [kreis.label]);
    }
  }
  const getippt = doc.plant?.dhw.units ?? 0;
  const weicht = stand.gesamt > 0 && getippt > 0 && getippt !== stand.selbstaendig;

  return (
    <div className="mt-2 rounded-lg bg-white/[0.03] p-2">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="label-xs">Nutzungseinheiten</span>
        <div className="flex gap-1">
          {(Object.keys(EINHEIT_LABELS) as EinheitArt[]).map((art) => (
            <button
              key={art}
              className="chip text-slate-500 hover:text-slate-200"
              title={`${EINHEIT_LABELS[art]} anlegen`}
              onClick={() => neueEinheit(art)}
            >
              + {EINHEIT_LABELS[art].slice(0, art === 'gemeinschaft' ? 12 : 8)}
            </button>
          ))}
        </div>
      </div>

      {bilanzen.length === 0 ? (
        <p className="text-[10px] leading-relaxed text-slate-500">
          Keine erfasst. Im Einfamilienhaus ist das richtig — es gibt nichts zu unterscheiden. Im
          Mehrfamilienhaus legen Sie hier die Einheiten an und ordnen die Räume im Reiter
          „Eigenschaften" zu; ganze Geschosse gehen dort in einem Schritt.
        </p>
      ) : (
        <>
          <div className="space-y-1">
            {bilanzen.map((b) => (
              <div key={b.einheit.id} className="flex items-center gap-1">
                <input
                  className="field min-w-0 flex-1 text-[11px]"
                  value={b.einheit.name}
                  onChange={(e) => benenneEinheit(b.einheit.id, e.target.value)}
                />
                <select
                  className="field w-[108px] shrink-0 text-[10px]"
                  value={b.einheit.art}
                  onChange={(e) => setzeEinheitArt(b.einheit.id, e.target.value as EinheitArt)}
                >
                  {(Object.keys(EINHEIT_LABELS) as EinheitArt[]).map((art) => (
                    <option key={art} value={art} className="bg-graphite-850">
                      {EINHEIT_LABELS[art]}
                    </option>
                  ))}
                </select>
                <span
                  className={`w-[92px] shrink-0 text-right text-[10px] tabular-nums ${b.raeume ? 'text-slate-400' : 'text-amber-400'}`}
                  title={[
                    b.maisonette ? `Über ${b.geschosse.length} Geschosse` : undefined,
                    kreiseJeEinheit.get(b.einheit.id)?.length
                      ? `Heizkreise: ${kreiseJeEinheit.get(b.einheit.id)?.join(', ')}`
                      : undefined,
                  ]
                    .filter(Boolean)
                    .join(' · ') || undefined}
                >
                  {b.raeume
                    ? `${b.raeume} R · ${fmt(b.flaeche, 1)} m²${b.maisonette ? ' ⇅' : ''}`
                    : 'kein Raum'}
                </span>
                <button
                  className="chip shrink-0 text-slate-600 hover:text-rose-400"
                  title="Einheit entfernen — die Zuordnung ihrer Räume geht mit"
                  onClick={() => loescheEinheit(b.einheit.id)}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          <div className="mt-1.5 border-t border-white/[0.06] pt-1.5">
            <Readout
              label="selbständige Einheiten"
              value={`${stand.selbstaendig}`}
              accent={weicht}
            />
            {stand.gemeinschaft > 0 && (
              <Readout
                label="Gemeinschaftsflächen"
                value={`${stand.gemeinschaft} — zählen nicht mit`}
              />
            )}
            {stand.raeumeOhne > 0 && (
              <Readout label="Räume ohne Zuordnung" value={`${stand.raeumeOhne}`} />
            )}
            <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
              {stand.abgleichpflicht
                ? `${stand.selbstaendig} selbständige Nutzungseinheiten — der hydraulische Abgleich ist nach § 60c Abs. 1 GModG Pflicht.`
                : `Ab ${ABGLEICHPFLICHT_AB} selbständigen Nutzungseinheiten ist der hydraulische Abgleich nach § 60c Abs. 1 GModG Pflicht.`}
            </p>
            {weicht && (
              <div className="mt-1.5 rounded-lg bg-amber-500/10 p-2">
                <p className="text-[10px] leading-relaxed text-amber-300">
                  Oben stehen {getippt} Wohneinheiten, gezählt sind {stand.selbstaendig}. Mit der
                  getippten Zahl rechnen Trinkwasserbedarf, Speicher und Gefäß.
                </p>
                <button className="btn-ghost mt-1 w-full text-[11px]" onClick={() => uebernehmeEinheitenzahl()}>
                  Aus dem Modell zählen: {stand.selbstaendig} übernehmen
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function downloadText(text: string, filename: string, type = 'text/plain;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
