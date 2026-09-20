/**
 * GuidePanel — „Was ist als Nächstes zu tun?"
 *
 * Ein CAD-Fenster beantwortet diese Frage nicht von selbst. Wer zum ersten
 * Mal davorsitzt, sieht Werkzeuge und Reiter, aber keine Reihenfolge — und
 * merkt erst beim Export, dass die Hälfte fehlt.
 *
 * Diese Liste liest den Modellstand und sagt in Alltagssprache, was schon
 * steht und was noch fehlt. Jeder offene Punkt hat eine Schaltfläche, die
 * genau das Werkzeug oder den Reiter öffnet, um den es geht — Erklären und
 * Hinführen in einem.
 *
 * Bewusst kein Assistent, der durch Schritte zwingt: ein Bestand wird selten
 * in der Reihenfolge aufgenommen, in der ein Programm ihn gern hätte.
 *
 * Die Liste reicht über die Gebäudeaufnahme hinaus bis zum letzten Blatt:
 * Grundriss, Räume, Heizflächen, Anlage, Rohrnetz, Rohrnetzbericht, Schema,
 * Schemaprüfung, Modellprüfung, Mappe, Übergabe. Der Grund ist derselbe wie
 * für die Liste überhaupt — was seit 1.12 dazugekommen ist, steht hinter
 * Schaltflächen, die man nur findet, wenn man weiß, dass es sie gibt.
 *
 * Drei Zustände, und der dritte ist der wichtigste: **erledigt**, **offen**
 * und **noch nicht möglich**. Ein Schritt, dessen Voraussetzung fehlt, wird
 * nicht als offen geführt und bekommt keine Schaltfläche; er sagt stattdessen
 * in einem Satz, was zuerst fehlt. Eine Aufforderung, der das Programm nicht
 * nachkommen kann, ist schlimmer als gar keine.
 */

import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { glossaryList } from '../lib/glossar';
import { begradige } from '../lib/begradigen';
import { berichtsUrteil, buildPipeReport } from '../lib/pipeReport';
import { designPlant } from '../lib/plantDesign';
import { schemaVorlage } from '../lib/schemaKatalog';
import { pruefeSchema } from '../lib/schemaPruefung';
import { validateModel } from '../lib/validation';
import type { FixtureType } from '../types/bim';
import { UEBERGABE_SCHRITTE, UI_MODUS_AUSKUNFT, UI_MODUS_LABELS } from '../lib/uimodus';
import { useBimStore } from '../store/useBimStore';
import { SPRACHEN } from '../lib/sprache';
import PlanPrintDialog from './PlanPrintDialog';
import RohrnetzDialog from './RohrnetzDialog';

type Tone = 'done' | 'open' | 'blocked' | 'optional';

interface Step {
  title: string;
  tone: Tone;
  /** Was zu tun ist — in einem Satz, ohne Fachbegriff. */
  hint: string;
  /**
   * Sprungziele des Schritts.
   *
   * Mehrere sind zugelassen, weil einzelne Schritte tatsächlich mehrere
   * gleichrangige Wege haben: das Rohrnetz lässt sich für Neubau oder
   * Sanierung auslegen, und die Mappe besteht aus vier Blattfolgen, die an
   * vier verschiedenen Stellen entstehen. Sie in vier Schritte zu zerlegen
   * würde die Liste aufblähen und dieselbe Aufgabe viermal zählen.
   */
  actions?: { label: string; run: () => void }[];
  /** Zahl rechts, wenn es etwas zu zählen gibt. */
  badge?: string;
}

/**
 * TGA-Objekte, die am Heizungsnetz hängen.
 *
 * Dieselbe Menge steht in `lib/pipeLayout` als Auswahlkriterium des
 * Rohrausleger; sie ist dort nicht ausgeführt (nicht exportiert). Sie wird
 * hier wiederholt, damit die Liste **vorher** sagen kann, ob die Auslegung
 * überhaupt etwas zu tun findet — ein Schritt, der zum Klicken einlädt und
 * dann mit „keine Verbraucher" abbricht, ist schlimmer als keiner.
 */
const VERBRAUCHER = new Set<FixtureType>(['radiator', 'radiator-tube', 'convector', 'manifold']);

export default function GuidePanel({ onOpenTab }: { onOpenTab: (tab: string) => void }) {
  const doc = useBimStore((s) => s.doc);
  const setTool = useBimStore((s) => s.setTool);
  const setActiveFixture = useBimStore((s) => s.setActiveFixture);
  const setViewMode = useBimStore((s) => s.setViewMode);
  const legeRohrnetzAus = useBimStore((s) => s.legeRohrnetzAus);
  const loadDemo = useBimStore((s) => s.loadDemo);
  const uiMode = useBimStore((s) => s.uiMode);
  const setUiMode = useBimStore((s) => s.setUiMode);
  const sprache = useBimStore((s) => s.sprache);
  const setSprache = useBimStore((s) => s.setSprache);

  /**
   * Zwei Fenster, die die Liste selbst öffnet.
   *
   * Sie hängen sonst an Schaltflächen der Werkzeugleiste; ein Verweis darauf
   * („oben rechts das dritte Symbol") wäre eine Wegbeschreibung statt eines
   * Wegs. Gezeichnet werden sie über ein Portal am Dokumentkörper: der
   * Inspektor trägt `backdrop-blur`, und das macht ihn zum Bezugsrahmen für
   * alles, was `position: fixed` ist — ein Dialog darin wäre 300 px breit.
   */
  const [rohrnetzOffen, setRohrnetzOffen] = useState(false);
  const [grundrissdruckOffen, setGrundrissdruckOffen] = useState(false);

  const state = useMemo(() => {
    const report = validateModel(doc);
    const rooms = Object.values(doc.rooms);
    const walls = Object.values(doc.walls);
    const openings = Object.values(doc.openings);
    const fixtures = Object.values(doc.fixtures);

    /*
     * Alles zum Rohrnetz wird **billig** abgelesen, nicht gerechnet.
     *
     * Der Rohrausleger arbeitet geschossweise: er sucht seine Quelle und
     * seine Verbraucher auf dem aktiven Geschoss und legt dort aus. Eine
     * Liste, die stattdessen das ganze Gebäude zählt, sagt „erledigt",
     * während im Obergeschoss nichts liegt.
     */
    const aufGeschoss = fixtures.filter((f) => f.levelId === doc.activeLevelId);
    const erzeugerObjekt = aufGeschoss.find((f) => f.type === 'boiler');
    const verteiler = aufGeschoss.filter((f) => f.type === 'manifold');
    // Reihenfolge wie im Rohrausleger: Erzeuger schlägt Verteiler.
    const quelle = erzeugerObjekt ?? verteiler[0];
    const rohre = Object.values(doc.pipes ?? {});
    const plant = doc.plant;

    return {
      report,
      walls: walls.length,
      rooms: rooms.length,
      openEnds: doc.diagnostics.openEnds.length,
      /**
       * Lücken zwischen zwei sauber angeschlossenen Wandenden.
       *
       * Der Schritt hing bisher allein an `openEnds` — an losen Enden mit
       * Grad 1. Genau der häufigste Fall aus der Praxis hat aber keins: an
       * einer vergessenen Wand zwischen zwei T-Stößen hat jedes Ende einen
       * Anschluss, und der Umriss ist trotzdem offen. Der Plan markiert die
       * Stelle längst (`diagnostics.closure`), die Liste meldete „alles zu".
       */
      gaps: (doc.diagnostics.closure ?? []).filter((c) => c.kind === 'gap').length,
      openings: openings.length,
      unnamed: rooms.filter((r) => r.usage === 'other').length,
      /** Wände, deren Stärke aus einem Scan geschätzt statt gemessen ist. */
      geschaetzteStaerken: walls.filter((w) => w.thicknessEstimated).length,
      /**
       * Knoten, die das Begradigen bewegen würde.
       *
       * Steht hier, damit die Aufgabenliste die Funktion **nennt**. Sie lag
       * bisher allein im Reiter „Prüfung" und blendete sich dort auch noch
       * aus, sobald nichts zu tun war — wer sie nie gesehen hatte, konnte
       * nicht wissen, dass es sie gibt.
       */
      krumm: begradige(
        walls.filter((w) => w.levelId === doc.activeLevelId),
        doc.nodes,
      ).bewegt,
      missingU: report.issues.filter((i) => i.code.includes('u-value') || i.code.includes('missing-u')).length,
      heaters: fixtures.filter((f) => f.category === 'heating' && f.params.powerW).length,
      heatingPower: fixtures.reduce((sum, f) => sum + (f.params.powerW ?? 0), 0),
      generator: doc.plant?.generatorModelId,
      schematic: Object.keys(doc.plant?.schematic.components ?? {}).length,

      /** Gibt es auf diesem Geschoss einen Ausgangspunkt für die Trasse? */
      hatQuelle: quelle !== undefined,
      /** Wie viele Heizflächen die Trasse anzuschließen hätte. */
      verbraucher: quelle
        ? aufGeschoss.filter((f) => f.id !== quelle.id && VERBRAUCHER.has(f.type)).length
        : 0,
      rohreGeschoss: rohre.filter((r) => r.levelId === doc.activeLevelId).length,
      rohreGesamt: rohre.length,
      /** Kennung der übernommenen Schemavorlage — die Antwort auf „welches Schema ist das?". */
      vorlageId: plant?.schematic.vorlageId,
    };
  }, [doc]);

  /**
   * Der Rohrnetzbericht — die einzige wirklich teure Rechnung dieser Liste.
   *
   * Er läuft nur, wenn auf dem Geschoss Leitungen liegen. Vorher hat der
   * Schritt ohnehin nichts zu melden, und die Liste kostet nichts. Danach ist
   * es dieselbe Rechnung wie im Berichtsfenster — bewusst dieselbe: zwei
   * verschiedene Urteile über dasselbe Netz wären schlimmer als eine
   * Rechnung mehr.
   */
  const bericht = useMemo(
    () => (state.rohreGeschoss > 0 ? buildPipeReport(doc) : null),
    [doc, state.rohreGeschoss],
  );
  const urteil = useMemo(() => (bericht ? berichtsUrteil(bericht) : null), [bericht]);

  /**
   * Die Auslegung für die Schemaprüfung.
   *
   * Sie wird nur gerechnet, wenn überhaupt ein Fließbild im Modell steht —
   * ohne Bauteile gibt es nichts zu prüfen. Die Vorgaben sind dieselben wie
   * im Anlagenblatt (`heatLoadOverride`, `extraModels`), damit hier keine
   * anderen Befunde erscheinen als dort. Nur die Geräte, die jemand gerade in
   * der Sitzung eingelesen hat, kennt das Anlagenblatt allein; sie stehen
   * absichtlich nicht im Dokument.
   */
  const auslegung = useMemo(
    () =>
      state.schematic > 0
        ? designPlant(doc, {
            heatLoad: doc.plant?.heatLoadOverride,
            extraModels: doc.plant?.extraModels,
          })
        : null,
    [doc, state.schematic],
  );

  const befunde = useMemo(() => {
    const plant = doc.plant;
    if (!auslegung || !plant) return [];
    return pruefeSchema({
      komponenten: Object.values(plant.schematic.components),
      verbindungen: Object.values(plant.schematic.links),
      auslegung,
      anlage: plant,
    });
  }, [doc.plant, auslegung]);

  const vorlage = state.vorlageId ? schemaVorlage(state.vorlageId) : undefined;

  // Beide Berichte führen ihre Meldungen nach Gewicht getrennt. Für die Liste
  // zählt vor allem, ob ein Fehler darunter ist: er ist der Unterschied
  // zwischen „ansehen lohnt sich" und „so trägt es nicht".
  const rohrFehler = bericht?.hinweise.filter((h) => h.severity === 'error').length ?? 0;
  const rohrWarnungen = bericht?.hinweise.filter((h) => h.severity === 'warn').length ?? 0;
  const schemaFehler = befunde.filter((b) => b.grad === 'fehler').length;
  const schemaWarnungen = befunde.filter((b) => b.grad === 'warnung').length;
  const schemaHinweise = befunde.filter((b) => b.grad === 'hinweis').length;

  /**
   * Die Druckwege, die es gerade wirklich gibt.
   *
   * Eine Schaltfläche anzubieten, hinter der ein leeres Blatt liegt, ist eine
   * Zusage, die das Programm nicht hält. Deshalb steht jeder Weg erst da,
   * wenn sein Inhalt da ist — und was fehlt, wird im Satz darunter benannt.
   */
  const druckwege: { label: string; run: () => void }[] = [];
  const fehlendeDruckwege: string[] = [];
  if (state.walls > 0) druckwege.push({ label: 'Grundriss', run: () => setGrundrissdruckOffen(true) });
  else fehlendeDruckwege.push('Grundriss');
  if (state.rohreGeschoss > 0) druckwege.push({ label: 'Rohrnetzbericht', run: () => setRohrnetzOffen(true) });
  else fehlendeDruckwege.push('Rohrnetzbericht');
  // Das Schema wird im Hauptfenster gedruckt, nicht im Inspektor: der Umschalter
  // auf die Schema-Ansicht ist deshalb das ehrliche Sprungziel.
  if (state.schematic > 0) druckwege.push({ label: 'Anlagenschema', run: () => setViewMode('schema') });
  else fehlendeDruckwege.push('Anlagenschema');
  if (state.generator) druckwege.push({ label: 'Anlagenbuch', run: () => onOpenTab('anlage') });
  else fehlendeDruckwege.push('Anlagenbuch');

  const steps: Step[] = [
    {
      title: 'Grundriss zeichnen',
      tone: state.rooms > 0 ? 'done' : 'open',
      badge: state.walls ? `${state.walls} Wände` : undefined,
      hint:
        state.rooms > 0
          ? 'Die Wände stehen, die Räume wurden von selbst erkannt.'
          : 'Mit dem Wand-Werkzeug einen geschlossenen Umriss zeichnen. Jeder Klick setzt einen Punkt, Esc beendet den Zug. Sobald der Umriss zu ist, erkennt das Programm den Raum selbst.',
      actions: state.rooms > 0 ? undefined : [{ label: 'Wand zeichnen', run: () => setTool('wall') }],
    },
    {
      title: 'Alle Räume geschlossen',
      tone: state.walls === 0 ? 'blocked' : state.openEnds + state.gaps > 0 ? 'open' : 'done',
      badge:
        state.openEnds + state.gaps > 0
          ? [state.openEnds > 0 ? `${state.openEnds} offen` : '', state.gaps > 0 ? `${state.gaps} Lücke${state.gaps === 1 ? '' : 'n'}` : '']
              .filter(Boolean)
              .join(', ')
          : undefined,
      hint:
        state.openEnds > 0
          ? 'An den orangefarbenen Punkten im Plan hört eine Wand auf, ohne die nächste zu berühren. Dort wird kein Raum erkannt. Wand bis an die nächste heranziehen — sie verbindet sich dann von selbst.'
          : state.gaps > 0
            ? 'Zwischen zwei sauber angeschlossenen Wandenden fehlt ein Wandstück. Der Plan zeichnet die fehlende Wand gestrichelt — dort ist der Umriss offen, obwohl kein Wandende lose ist.'
            : 'Kein loses Wandende, keine Lücke. Jeder Umriss ist zu.',
      actions:
        state.openEnds + state.gaps > 0
          ? [{ label: state.openEnds > 0 ? 'Wand verlängern' : 'Wand ergänzen', run: () => setTool('wall') }]
          : undefined,
    },
    // Nur sichtbar, solange etwas offen ist: wer von Hand zeichnet, setzt die
    // Stärke beim Zeichnen und soll keinen Schritt vorgesetzt bekommen, den es
    // für ihn nicht gibt.
    ...(state.geschaetzteStaerken > 0
      ? [
          {
            title: 'Wandstärken bestätigen',
            tone: 'open' as const,
            badge: `${state.geschaetzteStaerken} geschätzt`,
            hint:
              'Ein Raumscan misst Wände als Flächen ohne Dicke. Angenommen sind 36,5 cm außen und 11,5 cm innen. ' +
              'Die Zahl geht über die Bauteilfläche unmittelbar in den Transmissionsverlust — bei 100 m Wandlänge ' +
              'macht ein Irrtum von 12 cm rund 25 m² Fläche aus. Im Reiter „Prüfung" stehen sie zum Bestätigen oder Ändern.',
            actions: [{ label: 'Stärken ansehen', run: () => onOpenTab('check') }],
          },
        ]
      : []),
    {
      title: 'Fenster und Türen setzen',
      tone: state.walls === 0 ? 'blocked' : state.openings > 0 ? 'done' : 'open',
      badge: state.openings ? `${state.openings} Stück` : undefined,
      hint:
        state.openings > 0
          ? 'Fenster und Türen sitzen in den Wänden und werden von der Wandfläche abgezogen.'
          : 'Fenster-Werkzeug wählen und auf die Wand klicken. Ohne Fenster rechnet die Heizlast mit einer geschlossenen Wand — und fällt zu klein aus.',
      actions:
        state.openings > 0 ? undefined : [{ label: 'Fenster setzen', run: () => setTool('window') }],
    },
    {
      title: 'Räume benennen und Nutzung wählen',
      tone: state.rooms === 0 ? 'blocked' : state.unnamed > 0 ? 'open' : 'done',
      badge: state.unnamed > 0 ? `${state.unnamed} offen` : undefined,
      hint:
        state.unnamed > 0
          ? 'Raum im Plan anklicken und im Reiter „Objekt" die Nutzung wählen — Wohnen, Bad, Schlafen. Daraus ergeben sich Solltemperatur und Luftwechsel von selbst; im Bad sind 24 °C üblich, im Flur 15.'
          : 'Jeder Raum hat eine Nutzung und damit eine Solltemperatur.',
      actions:
        state.unnamed > 0 ? [{ label: 'Räume ansehen', run: () => onOpenTab('rooms') }] : undefined,
    },
    {
      title: 'Heizkörper eintragen',
      tone: state.heaters > 0 ? 'done' : 'optional',
      badge: state.heatingPower ? `${state.heatingPower.toLocaleString('de-DE')} W` : undefined,
      hint:
        state.heaters > 0
          ? 'Die vorhandene Leistung steht je Raum im Export — damit sieht die Gegenstelle sofort, wo es knapp wird.'
          : 'Nur für den Bestand nötig: Wer erfassen will, was heute schon hängt, setzt die Heizkörper mit ihrer Leistung. Für eine reine Neuplanung kann der Schritt entfallen.',
      actions:
        state.heaters > 0
          ? undefined
          : [
              {
                label: 'Heizkörper setzen',
                run: () => {
                  setActiveFixture('radiator');
                  onOpenTab('tga');
                },
              },
            ],
    },
    {
      title: 'Anlage auslegen',
      tone: state.rooms === 0 ? 'blocked' : state.generator ? 'done' : 'optional',
      badge: state.schematic ? `${state.schematic} Bauteile` : undefined,
      hint: state.generator
        ? 'Gerät, Speicher, Rohre und Sicherheitsarmaturen sind gerechnet. Das Anlagenschema zeigt, woran was hängt.'
        : 'Nur nötig, wenn die Anlage mitgeplant werden soll: Im Reiter „Anlage" schlägt das Programm ein Gerät zur Heizlast vor und rechnet daraus Speicher, Rohrgrößen, Ausdehnungsgefäß und Sicherheitsventil. Für die reine Datenerfassung kann der Schritt entfallen.',
      actions: [{ label: state.generator ? 'Anlage ansehen' : 'Anlage auslegen', run: () => onOpenTab('anlage') }],
    },
    {
      title: 'Rohrnetz auslegen',
      tone:
        !state.hatQuelle || state.verbraucher === 0
          ? 'blocked'
          : state.rohreGeschoss > 0
            ? 'done'
            : 'optional',
      badge: state.rohreGeschoss
        ? `${state.rohreGeschoss} Leitungen`
        : state.verbraucher
          ? `${state.verbraucher} Verbraucher`
          : undefined,
      hint: !state.hatQuelle
        ? 'Der Trasse fehlt der Ausgangspunkt. Erst ein Wärmeerzeuger oder ein Heizkreisverteiler auf diesem Geschoss gibt ihr einen Anfang; geraten wird kein Standort.'
        : state.verbraucher === 0
          ? 'Auf diesem Geschoss hängt noch nichts am Netz. Heizkörper oder weitere Verteiler setzen, dann gibt es etwas anzuschließen.'
          : state.rohreGeschoss > 0
            ? 'Trasse, Nennweiten, Dämmstärken nach Anlage 8 GEG und Armaturen liegen im Plan. Eine erneute Auslegung ersetzt nur das Erzeugte; von Hand gezogene Leitungen bleiben stehen.'
            : `Nur nötig, wenn das Rohrnetz mitgeplant werden soll: Das Programm führt die Trasse vom Erzeuger zu jeder Heizfläche und bestimmt daraus Nennweiten, Dämmung und Armaturen. Neubau legt die Leitungen auf die Rohdecke in den Fußbodenaufbau, Sanierung sichtbar in den Sockelleistenkanal an der Wand.${
                state.rohreGesamt > 0
                  ? ` Auf anderen Geschossen liegen bereits ${state.rohreGesamt} Leitungen.`
                  : ''
              }`,
      actions: [
        { label: 'Für Neubau auslegen', run: () => legeRohrnetzAus('neubau') },
        { label: 'Für Sanierung auslegen', run: () => legeRohrnetzAus('sanierung') },
      ],
    },
    {
      title: 'Rohrnetzbericht prüfen',
      tone: !bericht || !urteil ? 'blocked' : rohrFehler > 0 || !urteil.nachweisfaehig ? 'open' : 'done',
      badge: !bericht
        ? undefined
        : rohrFehler > 0
          ? `${rohrFehler} Fehler`
          : urteil && !urteil.nachweisfaehig
            ? `${urteil.offen.length} offen`
            : `${bericht.teilstrecken.length} Teilstrecken`,
      hint: !bericht || !urteil
        ? 'Der Bericht rechnet das gezeichnete Netz nach — Teilstrecken, Fließwege, Einstellwerte, Nachweis. Ohne Leitungen auf diesem Geschoss gibt es nichts zu berechnen.'
        : rohrFehler > 0
          ? `Die Rechnung meldet ${rohrFehler === 1 ? 'einen Fehler' : `${rohrFehler} Fehler`}. Der erste lautet: „${
              bericht.hinweise.find((h) => h.severity === 'error')?.text ?? ''
            }"`
          : !urteil.nachweisfaehig
            ? `Die Rechnung läuft durch, für den Nachweis fehlt aber noch etwas: ${urteil.offen[0]}${
                urteil.offen.length > 1 ? ` und ${urteil.offen.length - 1} weitere Punkte` : ''
              }. Solange das offen ist, ist der Bericht eine Rechnung und kein Nachweis.`
            : `Jede Teilstrecke ist gerechnet, jede Heizfläche hat einen darstellbaren Einstellwert, der Nachweis ist vollständig.${
                rohrWarnungen > 0
                  ? ` ${rohrWarnungen === 1 ? 'Ein Hinweis' : `${rohrWarnungen} Hinweise`} zum Nachlesen stehen im Bericht.`
                  : ''
              }`,
      actions: [{ label: 'Bericht öffnen', run: () => setRohrnetzOffen(true) }],
    },
    {
      title: 'Schema vorschlagen lassen',
      tone: !state.generator ? 'blocked' : state.vorlageId ? 'done' : 'open',
      badge: vorlage?.kennung ?? state.vorlageId,
      hint: !state.generator
        ? 'Ein Schema passt zu einer ausgelegten Anlage. Erst mit gewähltem Gerät stehen Anbindung, Trinkwassererwärmung und Zahl der Kreise fest — und nur dagegen lassen sich die Vorlagen halten.'
        : state.vorlageId
          ? `Übernommen ist „${vorlage?.name ?? state.vorlageId}". Damit ist beantwortet, nach welcher Musterlösung die Anlage gebaut ist — die Frage, die jeder stellt, der ein fremdes Fließbild in die Hand bekommt.`
          : 'Im Reiter „Anlage" hält das Programm jede Vorlage des Katalogs gegen die ausgelegte Anlage und nennt zu jeder, was übereinstimmt und was nicht. Ohne übernommene Vorlage bleibt das Fließbild anonym: es zeigt eine Anlage, aber nicht, welche.',
      actions: [
        {
          label: state.vorlageId ? 'Schema ansehen' : 'Vorschläge ansehen',
          run: () => onOpenTab('anlage'),
        },
      ],
    },
    {
      title: 'Schemaprüfung lesen',
      tone: state.schematic === 0 ? 'blocked' : befunde.length > 0 ? 'open' : 'done',
      badge:
        state.schematic === 0
          ? undefined
          : befunde.length === 0
            ? `${state.schematic} Bauteile`
            : [
                schemaFehler > 0 ? `${schemaFehler} Fehler` : '',
                schemaWarnungen > 0 ? `${schemaWarnungen} Warnungen` : '',
                schemaHinweise > 0 ? `${schemaHinweise} Hinweise` : '',
              ]
                .filter(Boolean)
                .join(', '),
      hint:
        state.schematic === 0
          ? 'Geprüft wird das Fließbild, das im Modell steht — auch ein von Hand nachgebessertes. Solange keines da ist, gibt es nichts zu prüfen; es entsteht mit der Anlagenauslegung oder mit der Übernahme einer Vorlage.'
          : schemaFehler > 0
            ? `So darf die Anlage nicht gebaut werden: ${schemaFehler === 1 ? 'ein Befund verstößt' : `${schemaFehler} Befunde verstoßen`} gegen eine Norm oder eine ausdrückliche Herstellervorgabe. Der erste lautet „${befunde.find((b) => b.grad === 'fehler')?.titel ?? ''}".`
            : befunde.length > 0
              ? `Keine Fehler. Es bleiben ${befunde.length === 1 ? 'ein Punkt' : `${befunde.length} Punkte`} zum Nachsehen; der erste lautet „${befunde[0].titel}". Zu jedem steht die Quelle im Klartext daneben.`
              : 'Keine Befunde. Bauteile und Verbindungen des Fließbilds stimmen mit der Auslegung und mit den hinterlegten Regeln überein.',
      actions: [{ label: 'Befunde ansehen', run: () => onOpenTab('anlage') }],
    },
    {
      title: 'Wände gerade ziehen',
      tone: state.walls === 0 ? 'blocked' : state.krumm > 0 ? 'optional' : 'done',
      badge: state.krumm > 0 ? `${state.krumm} Knoten` : undefined,
      hint:
        state.walls === 0
          ? 'Ohne Wände gibt es nichts zu begradigen.'
          : state.krumm > 0
            ? `Ein Aufmaß von Hand oder aus dem Scan steht selten genau auf der Achse. „Begradigen" zieht ${state.krumm} Knoten gerade, ohne bewusst schräge Wände anzufassen — und ist mit Strg+Z in einem Schritt zurückzunehmen. Der Knopf steht im Reiter „Prüfung".`
            : 'Alle Wände stehen auf der Achse. Der Knopf dafür steht im Reiter „Prüfung" — dort finden Sie ihn auch, wenn später einmal etwas schief steht.',
      // Eigene Beschriftung, nicht noch ein „Prüfung öffnen": Der Reiter ist
      // nur der Weg, das Ziel ist das Begradigen.
      actions: [{ label: 'Begradigen öffnen', run: () => onOpenTab('check') }],
    },
    {
      title: 'Prüfung ohne Fehler',
      tone: state.rooms === 0 ? 'blocked' : state.report.errors > 0 ? 'open' : 'done',
      badge:
        state.report.errors > 0
          ? `${state.report.errors} Fehler`
          : state.report.warnings > 0
            ? `${state.report.warnings} Warnungen`
            : undefined,
      hint:
        state.report.errors > 0
          ? 'Es gibt Stellen, an denen die Rechnung nachweislich falsch würde. Der Reiter „Prüfung" nennt jede einzeln — mit einem Satz dazu, wie sie zu beheben ist.'
          : state.report.warnings > 0
            ? 'Keine Fehler. An den Warnstellen wird mit Standardannahmen gerechnet statt mit Ihren Angaben — ansehen lohnt sich, nötig ist es nicht.'
            : 'Alles vollständig. Nichts wird angenommen.',
      actions: [{ label: 'Prüfung öffnen', run: () => onOpenTab('check') }],
    },
    {
      title: 'Mappe drucken',
      tone: state.walls === 0 ? 'blocked' : 'optional',
      badge: state.walls === 0 ? undefined : `${druckwege.length} von 4`,
      hint:
        state.walls === 0
          ? 'Vor dem ersten Wandzug gibt es kein Blatt zu drucken.'
          : `Vier Blattfolgen, die an vier Stellen entstehen: der maßstäbliche Grundriss, der Rohrnetzbericht mit Teilstrecken und Einstellwerten, das Anlagenschema und das Anlagenbuch mit Auslegung, Raumbuch und Inbetriebnahme.${
              fehlendeDruckwege.length > 0
                ? ` Noch nicht verfügbar: ${fehlendeDruckwege.join(', ')} — dazu fehlt jeweils der Schritt davor.`
                : ''
            } Ob gedruckt wurde, kann das Programm nicht wissen; dieser Schritt hakt sich deshalb nie von selbst ab.`,
      actions: druckwege,
    },
    {
      title: 'An RaVia übergeben',
      tone: state.report.ready && state.rooms > 0 ? 'done' : 'blocked',
      hint:
        state.report.ready && state.rooms > 0
          ? 'Oben rechts „RaVia JSON" — die Datei enthält alles, was für die Heizlast gebraucht wird, samt Prüfbericht.'
          : 'Sobald die Prüfung keine Fehler mehr zeigt, steht die Übergabe bereit.',
    },
  ];

  /*
   * Die Schritte, die im aktuellen Modus zählen.
   *
   * Gefiltert wird über die Überschriften (`UEBERGABE_SCHRITTE`) und nicht
   * über ein Merkmal am Schritt: Die Liste entsteht hier aus dem
   * Modellzustand, und ihr eine zweite Ordnungsebene zu geben hieße, jeden
   * Schritt zweimal zu pflegen. Wer einen Titel ändert, ändert ihn dort mit
   * — und merkt es sofort, weil der Schritt im Handwerkermodus verschwindet.
   */
  const sichtbareSchritte =
    uiMode === 'handwerker' ? steps.filter((s2) => UEBERGABE_SCHRITTE.includes(s2.title)) : steps;

  /*
   * Gezählt wird nur, was gerade auf dem Tisch liegt.
   *
   * Seit die Liste bis zum Druck reicht, sind für ein reines Erfassungs-
   * projekt mehrere Schritte dauerhaft gesperrt — sie brauchen eine Anlage
   * oder ein Rohrnetz, das dort niemand plant. Zählte der Nenner sie mit,
   * stünde jedes solche Projekt auf halber Strecke, obwohl nichts fehlt. Wie
   * viele Schritte gesperrt sind, steht deshalb daneben statt im Bruch.
   */
  const done = steps.filter((s) => s.tone === 'done').length;
  const relevant = steps.filter((s) => s.tone === 'done' || s.tone === 'open').length;
  const gesperrt = steps.filter((s) => s.tone === 'blocked').length;

  return (
    <div className="space-y-3 p-3">
      <div className="flex items-baseline justify-between">
        <span className="label-xs">Was ist zu tun?</span>
        <span className="text-[10px] text-slate-500">
          {done} von {relevant} erledigt
        </span>
      </div>

      <div className="h-1 overflow-hidden rounded-full bg-white/[0.07]">
        <div
          className="h-full rounded-full bg-accent transition-all"
          style={{ width: `${Math.round((done / Math.max(1, relevant)) * 100)}%` }}
        />
      </div>

      {gesperrt > 0 && (
        <p className="text-[9.5px] leading-relaxed text-slate-600">
          {gesperrt === 1 ? 'Ein Schritt ist' : `${gesperrt} Schritte sind`} noch nicht möglich. Woran
          es jeweils liegt, steht beim Schritt.
        </p>
      )}

      {state.walls === 0 && (
        <div className="rounded-lg bg-accent/10 p-2.5">
          <p className="text-[10.5px] leading-relaxed text-slate-300">
            Noch nichts gezeichnet. Wer erst einmal sehen will, wie ein fertiges Projekt
            aussieht, lädt den Beispielgrundriss — er lässt sich jederzeit wieder löschen.
          </p>
          <button className="chip mt-2 bg-accent/15 text-accent" onClick={loadDemo}>
            Beispiel laden
          </button>
        </div>
      )}

      {/*
        Im Handwerkermodus nur die Schritte bis zur Heizlastübergabe.

        Eine Liste mit fünfzehn Punkten, von denen sechs — Anlage, Rohrnetz,
        Bericht, Schema, Schemaprüfung, Mappe — den Aufmesser nichts angehen,
        sieht nach einer unerledigten Aufgabe aus, obwohl sie fertig ist. Und
        wer sie trotzdem abarbeitet, legt eine Anlage aus, die er nicht plant.
      */}
      <div className="space-y-1">
        {sichtbareSchritte.map((step) => (
          <StepRow key={step.title} step={step} />
        ))}
      </div>

      <Begriffe />

      <div className="border-t border-white/[0.06] pt-3">
        <div className="label-xs mb-1.5">Ansicht</div>
        <div className="flex gap-0.5 rounded-lg bg-graphite-900/60 p-0.5">
          {(['handwerker', 'einfach', 'profi'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setUiMode(m)}
              title={UI_MODUS_AUSKUNFT[m]}
              className={`chip flex-1 ${
                uiMode === m ? 'bg-accent/15 text-accent' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {UI_MODUS_LABELS[m]}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[9.5px] leading-relaxed text-slate-600">{UI_MODUS_AUSKUNFT[uiMode]}</p>
      </div>

      {/* ------------------------------------------------------- Sprache */}
      <div className="border-t border-white/[0.06] pt-3">
        <div className="label-xs mb-1.5">Sprache · Dil · Język · Язык</div>
        <div className="flex flex-wrap gap-0.5 rounded-lg bg-graphite-900/60 p-0.5">
          {SPRACHEN.map((sp) => (
            <button
              key={sp.code}
              onClick={() => setSprache(sp.code)}
              title={`${sp.deutsch} — die Bedienung wird umgestellt. Fachbegriffe (Vorlauf, Heizlast, U-Wert …) bleiben deutsch, weil sie auf der Baustelle deutsch heißen. Plan, Massenauszug und Bericht bleiben ebenfalls deutsch.`}
              className={`chip ${
                sprache === sp.code ? 'bg-accent/15 text-accent' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {sp.eigenname}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[9.5px] leading-relaxed text-slate-600">
          Umgestellt wird die <b>Bedienung</b>. Die Fachbegriffe bleiben deutsch — sie stehen so
          auf dem Lieferschein und der Bauleiter fragt so danach. Plan, Massenauszug und
          Rohrnetzbericht bleiben ebenfalls deutsch: Die liest der Bauherr, nicht der Monteur.
        </p>
        {sprache !== 'de' && (
          <p className="mt-1 text-[9.5px] leading-relaxed text-amber-400/70">
            Diese Sprache ist noch nicht durchgesehen — was noch nicht übersetzt ist, steht auf
            Deutsch da. Nichts davon ist falsch, manches ist nur noch nicht übersetzt.
          </p>
        )}
      </div>

      {rohrnetzOffen &&
        createPortal(<RohrnetzDialog onClose={() => setRohrnetzOffen(false)} />, document.body)}
      {grundrissdruckOffen &&
        createPortal(<PlanPrintDialog onClose={() => setGrundrissdruckOffen(false)} />, document.body)}
    </div>
  );
}

const TONE: Record<Tone, { mark: string; ring: string; text: string }> = {
  done: { mark: '✓', ring: 'border-emerald-400/50 text-emerald-400', text: 'text-slate-400' },
  open: { mark: '', ring: 'border-accent/60 text-accent', text: 'text-slate-300' },
  blocked: { mark: '', ring: 'border-white/10 text-slate-700', text: 'text-slate-600' },
  optional: { mark: '·', ring: 'border-white/15 text-slate-600', text: 'text-slate-500' },
};

function StepRow({ step }: { step: Step }) {
  const tone = TONE[step.tone];
  return (
    <div className="rounded-lg bg-white/[0.02] px-2.5 py-2">
      <div className="flex items-baseline gap-2">
        <span
          className={`mt-0.5 flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-full border text-[9px] leading-none ${tone.ring}`}
        >
          {tone.mark}
        </span>
        <span className={`min-w-0 flex-1 text-[11px] leading-snug ${tone.text}`}>{step.title}</span>
        {step.badge && (
          <span className="shrink-0 text-[9.5px] tabular-nums text-slate-600">{step.badge}</span>
        )}
      </div>
      <p className="ml-[23px] mt-1 text-[10px] leading-relaxed text-slate-500">{step.hint}</p>
      {/*
        Ein gesperrter Schritt zeigt keine Schaltfläche: was noch nicht geht,
        soll auch nicht zum Klicken einladen. Der Satz darüber sagt dann, was
        zuerst fehlt.
      */}
      {step.actions && step.actions.length > 0 && step.tone !== 'blocked' && (
        <div className="ml-[23px] mt-1.5 flex flex-wrap gap-1">
          {step.actions.map((a) => (
            <button
              key={a.label}
              onClick={a.run}
              className="chip bg-accent/12 text-accent hover:bg-accent/20"
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Das Glossar als durchsuchbare Übersicht.
 *
 * Bisher stand jeder Begriff nur an dem Feld, zu dem er gehört — man fand ihn
 * also nur, wenn man ohnehin schon dort war. Wer „B-Strich" im Prüfbericht
 * liest und wissen will, was das ist, hatte keinen Weg dorthin. Diese Liste
 * ist dieser Weg, und sie steht bewusst im Start-Reiter: dort schaut nach,
 * wer nicht weiterweiß.
 */
function Begriffe() {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const alle = useMemo(() => glossaryList(), []);

  const treffer = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return alle;
    // Gesucht wird auch im Erklärtext, nicht nur im Begriff: wer „warum ist
    // mein Bad so warm" sucht, findet über das Wort „Bad" die Solltemperatur.
    return alle.filter(
      (e) =>
        e.term.toLowerCase().includes(q) ||
        e.short.toLowerCase().includes(q) ||
        e.long.toLowerCase().includes(q),
    );
  }, [alle, query]);

  return (
    <div className="border-t border-white/[0.06] pt-3">
      <button className="flex w-full items-baseline justify-between" onClick={() => setOpen((v) => !v)}>
        <span className="label-xs">Begriffe nachschlagen</span>
        <span className="text-[10px] text-slate-600">
          {alle.length} · {open ? '▾' : '▸'}
        </span>
      </button>

      {open && (
        <>
          <input
            className="field mt-1.5"
            placeholder="Begriff oder Stichwort …"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="mt-1.5 max-h-[22rem] space-y-1 overflow-y-auto pr-0.5">
            {treffer.map((e) => (
              <details key={e.id} className="rounded-lg bg-white/[0.03] px-2.5 py-1.5">
                <summary className="cursor-pointer text-[11px] text-slate-300">
                  {e.term}
                  <span className="ml-1 text-[10px] text-slate-600">{e.short}</span>
                </summary>
                <p className="mt-1 text-[10px] leading-relaxed text-slate-500">{e.long}</p>
                {e.typical && (
                  <p className="mt-1 text-[10px] leading-relaxed text-slate-600">
                    Übliche Werte: <span className="tabular-nums text-slate-400">{e.typical}</span>
                  </p>
                )}
              </details>
            ))}
            {treffer.length === 0 && (
              <p className="rounded-lg bg-white/[0.03] px-2.5 py-2 text-[10px] leading-relaxed text-slate-500">
                Nichts gefunden. Das Glossar erklärt die Begriffe, die im Programm vorkommen — steht ein Wort nicht
                darin, kommt es hier auch nicht vor.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
