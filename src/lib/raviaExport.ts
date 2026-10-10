/**
 * RaVia-Export — das Übergabeformat an die Heizlastberechnung.
 * ---------------------------------------------------------------------------
 * Leitgedanke: die Gegenstelle soll **rechnen können, ohne nachzufragen**.
 * Deshalb enthält der Export nicht nur Geometrie, sondern jede Größe, die
 * DIN EN 12831-1 für Transmission, Lüftung und Aufheizung verlangt — und zwar
 * bereits aufbereitet:
 *
 *   • je Raum **alle** Hüllbauteile in einer Liste (Wand, Boden, Decke),
 *     jeweils mit Fläche, U-Wert, Wärmebrückenzuschlag, Randbedingung *und*
 *     der Temperatur auf der anderen Seite. Der Temperatur-Korrekturfaktor
 *     ist damit eine Subtraktion, kein Nachschlagewerk.
 *   • Nachbarraum-Verweise für Innenbauteile — ohne sie lässt sich der
 *     Wärmestrom zwischen unterschiedlich temperierten Räumen nicht bilden.
 *   • Erdreich-Kennwerte: Umfang mit Erdkontakt und daraus B' = A/(0,5·P),
 *     dazu der Baugrund selbst — Bodenart und, falls erfasst, der
 *     Grundwasserstand.
 *   • Lüftung: n_min, daraus der Mindestvolumenstrom, dazu n50, Abschirmung,
 *     Zahl der Außenfassaden und die Höhenlage des Geschosses.
 *   • TGA-Bestand je Raum mit installierter Leistung und Volumenströmen.
 *   • Einheiten und Konventionen stehen **im Dokument**, nicht in einer Doku,
 *     die verloren geht.
 *   • Ein Prüfbericht sagt, worauf man sich verlassen kann.
 *
 * Die Rohgeometrie wandert mit, damit der Export zugleich als verlustfreie
 * Projektdatei taugt.
 */

import { leistungJeVerbraucher } from './verbraucherlast';
import {
  dachraumTemperatur,
  nachbarTemperatur,
  unbeheiztEingetragen,
  unbeheizteTemperatur,
} from './unbeheizt';
import type {
  ExportPlant,
  BimDocument,
  ExportBuildingTotals,
  ExportHeatPump,
  ExportRoom,
  Fixture,
  Opening,
  FixtureCategory,
  ExportPipe,
  Durchbruch,
  ExportDurchbruch,
  ExportSolid,
  ExportSubsoil,
  ExportVertical,
  PipeRun,
  PipeScheduleEntry,
  RaviaExport,
  ExportOccupancy,
  ExportOccupancyUnit,
  SetbackTotals,
  ThermalBridgeKind,
  ThermalBridgeTotals,
  Vec2,
  VentilationRole,
  VentilationTotals,
  SolidElement,
  VerticalElement,
} from '../types/bim';
import { SOIL_LABELS, durchbruchWirt } from '../types/bim';
import { durchbruchFlaeche, durchbruchMitte } from './durchbruchSymbols';
import { huellflaechenbilanz } from './huellflaechenbilanz';
import { rohrlaenge, steiganteil } from './rohrlaenge';
import { rohrmeterJeRaum } from './rohrImRaum';
import { ERZEUGER } from './fassung';
import {
  distance,
  distanceToSegment,
  pointInPolygon,
  polygonArea,
  polygonPerimeter,
  roundCm2,
  roundMm,
} from './geometry';
import { solidFootprint } from './verticalSymbols';
import { getWallGeometry, indexOpeningsByWall } from './wallGeometry';
import { isMassiveArea } from './roomDetection';
import { validateModel } from './validation';
import {
  envelopeArea,
  roomThermalBridges,
} from './thermalBridges';
import { buildPipeNetwork } from './pipeNetwork';
import { formteile } from './formteile';
import { buildEmitters, buildHydraulics } from './auslegungExport';
import { baueNetzExport, wegKennzahlen } from './netzExport';
import {
  ABGLEICHPFLICHT_AB,
  EINHEIT_LABELS,
  einheitenVonRaeumen,
  einheitenstand,
  einheitsbilanzen,
} from './nutzungseinheiten';
import { balanceNetwork } from './hydraulicBalance';
import { designPlant } from './plantDesign';
import {
  acousticReport,
  blockingFactor,
  IMMISSION_LIMITS,
  protectionIssues,
  sourceDemand,
} from './heatPump';
import { kaeltemittel } from './kaeltemittel';
import { heizlastAusBaualter, heizlastAusVerbrauch, verbrauchsabgleich } from './verbrauchsabgleich';
import { estimateHeatLoad } from './heatLoadEstimate';
import { buildRoom, heatedTemperatureByLevel, raumPruefsumme } from './raumExport';

export const GENERATOR = ERZEUGER;

/**
 * Die Nutzungseinheiten für den Export — Einheiten, Summen und § 60c-Stand.
 *
 * `undefined`, solange keine Einheit erfasst ist. Ein leerer Block wäre die
 * Behauptung, es seien keine da; das Fehlen des Blocks sagt, dass niemand
 * welche erfasst hat. Der Unterschied entscheidet darüber, ob eine Gegenstelle
 * nachfragt oder weiterrechnet.
 */
function baueEinheiten(
  doc: BimDocument,
): { occupancyUnits: ExportOccupancyUnit[]; occupancy: ExportOccupancy } | undefined {
  const bilanzen = einheitsbilanzen(doc);
  if (!bilanzen.length) return undefined;
  const stand = einheitenstand(doc);
  /*
   * Die Heizkreise je Einheit — dieselbe Zuordnung von der anderen Seite
   * gelesen, damit eine Gegenstelle für „Heizkreise je Wohnung" nicht alle
   * Kreise durchlaufen muss. Ein Kreis über zwei Einheiten steht bei beiden;
   * dass das nichts Gutes ist, sagt die Modellprüfung.
   */
  const kreiseJeEinheit = new Map<string, string[]>();
  for (const kreis of Object.values(doc.plant?.circuits ?? {})) {
    for (const unitId of einheitenVonRaeumen(doc, kreis.roomIds)) {
      const liste = kreiseJeEinheit.get(unitId);
      if (liste) liste.push(kreis.id);
      else kreiseJeEinheit.set(unitId, [kreis.id]);
    }
  }
  const art: Record<string, ExportOccupancyUnit['kind']> = {
    wohnung: 'dwelling',
    gewerbe: 'commercial',
    gemeinschaft: 'communal',
  };
  const deklariert = doc.plant?.dhw?.units;
  return {
    occupancyUnits: bilanzen.map((b) => ({
      id: b.einheit.id,
      name: b.einheit.name,
      kind: art[b.einheit.art],
      kindLabel: EINHEIT_LABELS[b.einheit.art],
      ...(b.einheit.lage ? { location: b.einheit.lage } : {}),
      roomIds: [...b.roomIds],
      ...(kreiseJeEinheit.get(b.einheit.id)?.length
        ? { circuitIds: kreiseJeEinheit.get(b.einheit.id) as string[] }
        : {}),
      area: roundCm2(b.flaeche),
      heatedArea: roundCm2(b.beheizteFlaeche),
      roomCount: b.raeume,
      heatedRoomCount: b.beheizteRaeume,
      levelIds: [...b.geschosse],
      maisonette: b.maisonette,
      heatLoad: Math.round(b.heizlastW),
    })),
    occupancy: {
      total: stand.gesamt,
      dwellings: stand.wohnungen,
      commercial: stand.gewerbe,
      communal: stand.gemeinschaft,
      independent: stand.selbstaendig,
      threshold: ABGLEICHPFLICHT_AB,
      balancingRequired: stand.abgleichpflicht,
      ...(typeof deklariert === 'number' ? { declared: deklariert } : {}),
      roomsWithoutUnit: stand.raeumeOhne,
    },
  };
}

/** Fassung des Exportvertrags; das Schema dazu liegt unter `ravia-vertrag/schema/`. */
export const EXPORT_FASSUNG = '2.16.0' as const;

export function buildRaviaExport(doc: BimDocument): RaviaExport {
  /*
   * Massive Flächen sind keine Räume.
   *
   * Im Regelfall hat der Store sie schon aussortiert (siehe
   * `isMassiveArea`); ein von außen eingelesenes Dokument kann sie aber noch
   * führen. Sie hier stehen zu lassen hieße, den Kaminzug als Aufenthaltsraum
   * zu übergeben — mit Solltemperatur, Luftwechsel und Heizlast.
   */
  const rooms = Object.values(doc.rooms).filter((r) => !isMassiveArea(r));
  // Einmal indizieren statt je Wandabschnitt die ganze Liste zu durchsuchen.
  const openingIndex = indexOpeningsByWall(Object.values(doc.openings));
  const heatedByLevel = heatedTemperatureByLevel(doc);
  const fixturesByRoom = groupFixturesByRoom(doc);
  /*
   * Die Rohrmeter je Raum — einmal für das ganze Dokument, nicht je Raum.
   *
   * Sie werden über *alle* Leitungen und *alle* Räume gerechnet und nicht je
   * Geschoss: Ein Abschnitt trägt seine Geschosskennung, ein Raum auch, und
   * ein Abschnitt kann ohnehin nur über der lichten Fläche eines Raums
   * liegen, der unter ihm ist. Die Zuordnung ist geometrisch (siehe
   * `rohrImRaum.ts`) — eine zusätzliche Filterung nach Geschoss brächte
   * dasselbe Ergebnis und eine zweite Stelle, an der es falsch sein kann.
   */
  const rohrJeRaum = rohrmeterJeRaum(Object.values(doc.pipes ?? {}), rooms);
  const exportRooms = rooms
    .map((room) => buildRoom(doc, room, openingIndex, heatedByLevel, fixturesByRoom, rohrJeRaum))
    // Die Prüfsumme steht bewusst *nach* `buildRoom` und nicht darin: Sie soll
    // über genau das gebildet werden, was die Gegenstelle am Ende sieht, und
    // nicht über eine Zwischenstufe, die sich später davon entfernen kann.
    .map((r) => ({ ...r, checksum: raumPruefsumme(r) }));
  const subsoil = buildSubsoil(doc, exportRooms);

  /*
   * Die Vorbemessung der Hydraulik — nur, wenn überhaupt ein Rohrnetz
   * gezeichnet ist. Ohne Leitungen gibt es nichts abzugleichen, und ein
   * leerer Block wäre eine Behauptung über eine Anlage, die es nicht gibt.
   *
   * Die Spreizung kommt aus der Anlagenauslegung, wenn eine da ist; sonst
   * bleibt es bei der Vorgabe des Rechenwegs. Sie hier zu erfinden hieße,
   * jedem Volumenstrom eine Zahl zugrunde zu legen, die niemand gesetzt hat.
   */
  const netz = buildPipeNetwork(doc);
  const auslegung = doc.plant?.design;
  /*
   * Die Erzeugerseite kommt aus der Anlagenauslegung, nicht aus dem Rohrnetz:
   * Δp des Geräts und Restförderhöhe stehen im Gerätekatalog, nicht in der
   * Zeichnung. Ohne Anlage bleibt der Block weg — ein Erzeugerposten ohne
   * Erzeuger wäre eine Behauptung.
   */
  const erzeuger = designPlant(doc, {}).generator;
  /*
   * Der Abgleich wird **einmal** gerechnet und zweimal benutzt: für
   * `hydraulics` (Verbrauchersicht) und für `pipeGraph` (Netzsicht). Zwei
   * Läufe würden zwei Zahlensätze ergeben, die sich unterscheiden dürfen und
   * es irgendwann täten.
   */
  const abgleich =
    netz.paths.length > 0
      ? balanceNetwork({
            network: netz,
            fixtures: doc.fixtures,
            // Befund A2: Volumenstrom aus der Raumheizlast.
            powerByFixture: leistungJeVerbraucher(doc),
            ...(auslegung
              ? {
                  spread: Math.max(2, auslegung.flowTemperature - auslegung.returnTemperature),
                  material: auslegung.material,
                  maxVelocity: auslegung.maxVelocity,
                  maxGradient: auslegung.maxGradient,
                }
              : {}),
          // Derselbe Verbraucherwiderstand wie im Anlagenblatt — sonst
          // stünde im Export ein anderer ungünstigster Strang als auf dem
          // Bildschirm, und beide wären „richtig".
          terminalLoss: 10000,
        })
      : undefined;
  const hydraulikRoh = abgleich ? buildHydraulics(abgleich, erzeuger) : undefined;
  /*
   * Je Verbraucher die Weglänge und die Formteile (seit 2.13.0) — gemeldet
   * am 02.10.2026: Für den Abgleich in RaVia fehlten die Rohrlängen, die
   * Formteile und die Steigleitung. Reiner Zuwachs an `consumers[]`.
   */
  const kennzahlen = wegKennzahlen(netz);
  const hydraulik = hydraulikRoh
    ? {
        ...hydraulikRoh,
        consumers: hydraulikRoh.consumers.map((c) => {
          const k = kennzahlen.get(c.fixtureId);
          return k ? { ...c, ...k } : c;
        }),
      }
    : undefined;
  const graph = baueNetzExport(doc, netz, abgleich);
  const einheiten = baueEinheiten(doc);

  const ergebnis: RaviaExport = {
    schema: 'ravia.bim.light',
    // 2.3.0: Hüllflächenbilanz je Raum und für das Gebäude (`envelope`).
    // 2.4.0: `envelope.withoutUValue` — wie viele Flächen ohne brauchbaren
    //        U-Wert in die Bilanz gingen. Reiner Zuwachs.
    // 2.13.0: `pipeFittings` — Formteile (Bögen, T-Stücke, Reduzierungen)
    //         aus der Geometrie; `hydraulics.consumers[]` mit routeLength,
    //         feedLength, circuitLength, riserLength und fittings;
    //         `pipeGraph.segments[].fittings`. Reiner Zuwachs.
    // 2.12.0: `plant.bivalence` — Deckungsanteile nach Bivalenzpunkt und
    //         Jahresdauerlinie, mit allen Annahmen im Klartext.
    // 2.11.0: Heizkreis ↔ Nutzungseinheit — `circuits[].occupancyUnitId`,
    //         `circuits[].occupancyUnitIds`, `occupancyUnits[].circuitIds`.
    // 2.10.0: `occupancyUnits`/`occupancy` — Nutzungseinheiten und die Zahl,
    //         an die § 60c Abs. 1 GModG die Abgleichpflicht knüpft.
    // 2.9.0: `pipeGraph` — Knoten, Abschnitte, Topologie, Flächenheizkreise.
    // 2.8.0: `project.annahmen` — was angenommen wurde, weil nichts vorlag.
    //        Reiner Zuwachs; ändert keinen Wert, sondern sagt, welcher nicht
    //        gemessen ist. Die vollständige Fassungsgeschichte steht an
    //        `RaviaExport` in `src/types/bim.ts`.
    // 2.14.0: `project.atticTemperature` — der Dachraum über der obersten
    //         Decke hat eine eigene Temperatur; Wände zu unbeheizten Räumen
    //         sind `unheated` mit θ_u statt `adjacent-room` mit deren Soll.
    // 2.15.0: `rooms[].raviaRoomId`, boundary `neighbour` mit
    //         `project.neighbourTemperature`, Heizkörper mit `ratedPower`
    //         (75/65/20), `exponentN`, `ratedPowerSource`, `panelType`;
    //         `project.unheatedTemperatureSource`. Schema in
    //         `ravia-vertrag/schema/ravia.bim.light-2.15.0.schema.json`.
    // 2.16.0: `pipeGraph.floorCircuits[].circuits[]` — jeder FBH-Kreis mit
    //         eigener Länge, Abgang, Fläche, Leistung und Strom; dazu
    //         `maxLoopLength`, `splitFrom` (automatisch geteilt),
    //         `feedLength`/`riserLength`/`generatorId` (Erzeuger → Verteiler).
    //         `manifoldPort` zählt jetzt je Kreis. Reiner Zuwachs.
    version: EXPORT_FASSUNG,
    generator: GENERATOR,
    exportedAt: new Date().toISOString(),
    units: {
      length: 'm',
      area: 'm2',
      volume: 'm3',
      temperature: 'degC',
      uValue: 'W/(m2K)',
      power: 'W',
      airflow: 'm3/h',
      angle: 'deg',
    },
    conventions: {
      azimuth:
        'Azimut der raumabgewandten Bauteilnormalen in Grad: 0 = Nord, 90 = Ost, im Uhrzeigersinn. Die Nordabweichung des Grundrisses (project.northAngle) ist bereits eingerechnet.',
      coordinates:
        'Weltkoordinaten in Metern, +x = Osten, +y = Norden. Raumpolygone sind lichte Innenkanten, gegen den Uhrzeigersinn, ohne Wiederholung des Startpunkts.',
      areas:
        'grossArea = Rohbaufläche des Bauteils, netArea = abzüglich aller Öffnungen. Raumflächen sind lichte Maße (Achsmaße abzüglich der halben Wandstärken).',
      boundaries:
        'neighbourTemperature ist die Temperatur auf der raumabgewandten Seite: Norm-Außentemperatur bei exterior, Erdreichtemperatur bei ground, bei unheated project.unheatedTemperature (seit 1.73.0 θ_i − b_u · (θ_i − θ_e), sofern unheatedTemperatureSource nicht "eingabe" oder "ravia" ist; an einer Wand zu einem unbeheizten Raum mit b_u nach dessen Außenwänden) — an der obersten Decke zum unbeheizten Dachraum stattdessen project.atticTemperature —, die Solltemperatur des Nachbarraums bei adjacent-room, project.neighbourTemperature (ohne Eintrag 15 °C) bei neighbour — fremde Nutzungseinheit oder Nachbargebäude, seit 2.15.0. Grenzt eine Wand an einen Raum mit isHeated = false, ist sie unheated (mit neighbourRoomId) und nicht adjacent-room.',
      groundContact:
        'Was unter project.terrainElevation liegt, grenzt an Erdreich. Eine teilweise eingegrabene Wand erscheint deshalb als zwei Flächen: der Teil unter Gelände mit boundary "ground" und der ID <wandId>-ground, der Teil darüber mit boundary "exterior" und der ID der Wand. Ihre Flächen ergeben zusammen wieder die Wandfläche. groundContact.embedmentDepth ist die Tiefe der Bauteilunterkante unter Gelände; die Faktoren f_g1, f_g2 und G_w nach DIN EN 12831-1 werden hier bewusst nicht gebildet — geliefert werden nur ihre Eingangsgrößen. Fehlt project.terrainElevation, ist keine Geländeoberkante erfasst und nichts wird als erdberührt gerechnet. Die Beschaffenheit des Baugrunds — Bodenart und Grundwasserstand — steht in subsoil.',
      ventilation:
        'rooms[].airChangeRate ist n_min, der hygienische Mindestluftwechsel aus der Nutzung [1/h] — nicht die Infiltration. rooms[].ventilation.minimumAirflow ist derselbe Wert als Volumenstrom (Raumvolumen · n_min), dieselbe Größe und keine zweite. supplyAirflow, exhaustAirflow und transferAirflow sind die Summen der im Plan platzierten Zuluft-, Abluft- und Überströmelemente des Raums, also der Anlagenstrom. Mindeststrom und Anlagenstrom beschreiben denselben Luftwechsel und werden nicht addiert: maßgebend ist der größere von beiden — ein Mindeststrom ist eine Untergrenze, keine Zugabe. Bei Wärmerückgewinnung gilt entweder effectiveSupplyAirflow = supplyAirflow · (1 − η) — nur dieser Anteil trägt noch Außenlufttemperatur — oder supplyAirflow mit einer eigenen Rückgewinnungsrechnung aus totals.ventilation.heatRecovery; beides zusammen zieht η zweimal ab. η ist nur bei totals.ventilation.kind = "balanced" von 0 verschieden, weil eine reine Abluftanlage nichts zurückzugewinnen hat. Ein Abluftraum (ventilation.role = "exhaust", also Bad, WC, Küche) bezieht seine Luft über den Überströmweg aus den Zulufträumen; sie ist dort bereits erwärmt worden. Sein exhaustAirflow ist deshalb Fortluft und kein Außenluftstrom — wer ihn als Außenluft ansetzt, überschätzt die Heizlast dieses Raums erheblich. Die Außenluftbilanz des Gebäudes steht in totals.ventilation: balance = supplyAirflow − exhaustAirflow, und was dort nicht bei 0 steht, geht ungewärmt durch die Gebäudehülle. Die Infiltration rechnet dieser Export nicht; geliefert werden nur ihre Eingangsgrößen project.n50, project.shielding, rooms[].exposedFacadeCount und rooms[].levelElevation.',
      subsoil:
        'subsoil sind die Erfassungsgrößen des Baugrunds, nicht seine Kennwerte. soil ist die Bodenart aus dem Lageplan (dry = trocken/sandig, normal = bindig-feucht, conductive = Festgestein, saturated = wassergesättigter Sand/Kies), soilLabel derselbe Wert im Klartext; sie ist eine Eingabe mit der Vorbelegung "normal" — ob sie erkundet oder belassen wurde, unterscheidet dieser Export nicht und behauptet es auch nicht. groundwaterDepth dagegen hat keine Vorbelegung: es ist der Grundwasserstand als Tiefe unter Geländeoberkante [m], positiv nach unten, und fehlt, solange er nicht erfasst ist. Ohne ihn lässt sich nicht entscheiden, ob die Korrektur G_w nach DIN EN ISO 13370 überhaupt greift — zu halten ist er gegen deepestEmbedment, die größte Einbindetiefe eines erdberührten Bauteils. Wärmeleitfähigkeiten λ des Bodens liefert dieser Export nicht: ihre Tabelle gehört zur Norm und ist nicht frei zitierbar, die Bodenart benennt nur die Zeile. Der ganze Block fehlt, wenn das Gebäude das Erdreich nirgends berührt und kein Grundwasserstand erfasst ist — dann gibt es nichts zu korrigieren und nichts zu berichten.',
      durchbrueche:
        'durchbrueche sind Durchbrüche und Bohrungen für Leitungen — Kernbohrung, Wanddurchbruch, Wandschlitz, Deckendurchbruch. Sie sind Ausführungsangaben und keine Rechengrößen: eine Kernbohrung mindert **keine** Wandfläche und erscheint in keiner Hüllflächenliste — sie wird geschottet, nicht gerechnet. Wer sie dennoch abzieht, rechnet ein Loch zweimal: einmal als fehlende Wand und einmal als Wärmebrücke. openArea ist der lichte Querschnitt [m²] für den Schottungsaufwand. wirt sagt, ob die Wand (wallId gesetzt) oder die Decke durchstoßen wird; beim Deckendurchbruch ist level das Geschoss **unter** der Decke. sillHeight ist bei runder Form die Achshöhe, bei rechteckiger die Unterkante — jeweils über OK Fertigfußboden. brandschutz ist die Anforderung an die Schottung, nicht das verbaute Produkt; "keine" heißt, dass keine Anforderung erfasst wurde, und nicht, dass keine besteht.',
      solids:
        'solids sind massive Bauteile ohne Raumfunktion — Kamin, Pfeiler, Wandversatz, Installationsblock. Ihre Grundfläche ist aus der Raumfläche und aus dem Luftvolumen herausgerechnet (rooms[].floorOpeningArea enthält sie, rooms[].solidArea nennt ihren Anteil); die Deckenfläche des Raums bleibt ungeschmälert, weil dort Mauerwerk und kein Luftraum steht. thermalBridge liefert nur Eingangsgrößen: atExteriorWall und die Berührungslänge contactLength [m]. Ein ψ-Wert wird hier nicht gebildet — er hängt an Aufbau, Zug und Dämmung des Bauteils und steht in keiner frei zitierbaren Tabelle.',
    },
    project: {
      ...doc.meta,
      // Ältere Dokumente kennen beide Felder nicht; gerechnet wird dann mit
      // dem pauschalen Verfahren ohne Kategorie — das steht jetzt auch da.
      thermalBridgeMethod: doc.meta.thermalBridgeMethod ?? 'flat',
      thermalBridgeCategory: doc.meta.thermalBridgeCategory ?? 'none',
      atticTemperature: dachraumTemperatur(doc.meta),
      // Seit 1.73.0 (Befund B1): θ_u steht immer da, auch wenn es aus b_u
      // abgeleitet ist; unheatedTemperatureSource sagt, welcher Fall es ist.
      unheatedTemperature: unbeheizteTemperatur(doc.meta),
      unheatedTemperatureSource: unbeheiztEingetragen(doc.meta) ? (doc.meta.unheatedTemperatureSource ?? 'eingabe') : 'b_u',
      // Seit 2.15.0 (Festlegung F4): θ hinter boundary "neighbour".
      neighbourTemperature: nachbarTemperatur(doc.meta),
    },
    ...(subsoil ? { subsoil } : {}),
    levels: Object.values(doc.levels)
      .sort((a, b) => (a.order ?? a.elevation) - (b.order ?? b.elevation))
      .map((l, i) => ({ ...l, order: l.order ?? i })),
    // Nutzungseinheiten — seit 2.10.0, nur wenn welche erfasst sind.
    ...(einheiten ?? {}),
    constructions: Object.values(doc.constructions ?? {}),
    verticals: buildVerticals(doc),
    solids: buildSolids(doc),
    durchbrueche: buildDurchbrueche(doc),
    pipes: buildPipes(doc),
    pipeSchedule: buildPipeSchedule(doc),
    // Formteile aus der Geometrie — seit 2.13.0, siehe `lib/formteile.ts`.
    pipeFittings: formteile(Object.values(doc.pipes ?? {}), Object.values(doc.pipeAccessories ?? {})),
    pipeNetwork: netz,
    emitters: buildEmitters(doc),
    ...(hydraulik ? { hydraulics: hydraulik } : {}),
    /*
     * Das Rohrnetz als Netz — seit 2.9.0, auf ausdrückliche Anforderung der
     * RaVia-Seite. Der Block entsteht nur, wenn es etwas zu übergeben gibt:
     * ein leeres Netz wäre dieselbe Aussage in mehr Zeichen.
     */
    ...(graph.segments.length || graph.floorCircuits.length ? { pipeGraph: graph } : {}),
    ...(Object.keys(doc.site?.pumps ?? {}).length || Object.keys(doc.site?.elements ?? {}).length
      ? { heatPump: buildHeatPumpExport(doc) }
      : {}),
    ...(hasPlant(doc) ? { plant: buildPlantExport(doc) } : {}),
    rooms: exportRooms,
    totals: buildTotals(doc, exportRooms, Object.values(doc.fixtures)),
    // Dieselbe Bilanz über alle Räume — die eine Zahl für das ganze Gebäude.
    envelope: huellflaechenbilanz(exportRooms.flatMap((r) => r.surfaces)),
    validation: validateModel(doc),
    geometry: {
      nodes: Object.values(doc.nodes),
      walls: Object.values(doc.walls),
      // Ältere Importe (Scan, Raumplan, IFC) schrieben an jede Öffnung ein
      // `layerId`, das der Typ nicht kennt — gespeicherte Projekte tragen es
      // noch. Es fällt hier weg, sonst ist die Datei nicht schemagültig.
      openings: Object.values(doc.openings).map((o) => {
        const { layerId: _ebene, ...rest } = o as Opening & { layerId?: unknown };
        return rest;
      }),
      fixtures: Object.values(doc.fixtures),
      verticals: Object.values(doc.verticals ?? {}),
      solids: Object.values(doc.solids ?? {}),
      durchbrueche: Object.values(doc.durchbrueche ?? {}),
      pipes: Object.values(doc.pipes ?? {}).map((run) => ({ ...run, points: ohneRauschen(run.points) })),
      annotations: Object.values(doc.annotations ?? {}),
      roofOpenings: Object.values(doc.roofOpenings ?? {}),
      /*
       * Gelände und Handnotizen gehören in die Rohgeometrie.
       *
       * `heatPump.elements` weiter oben ist die **ausgewertete** Sicht für den
       * Rechenkern — Schallnachweis, Schutzbereich, Grundstücksfläche. Zum
       * Zurücklesen taugt sie nicht: die Wärmepumpen stehen dort als
       * Rechenfall und nicht als Gerät im Modell.
       *
       * Ohne diesen Block verlor „exportieren, wieder öffnen" das gesamte
       * Grundstück samt Wärmepumpe — ohne Fehlermeldung, denn die Datei
       * enthielt die Zahlen ja, nur eben in einer Form, aus der das Modell
       * nicht wieder entsteht.
       */
      site: doc.site,
      ...(Object.keys(doc.freihand ?? {}).length ? { freihand: Object.values(doc.freihand ?? {}) } : {}),
    },
  };
  // Prüfhaken für die Prüfläufe (Festlegung F6): `npm run verify` prüft
  // jeden hier gebauten Export gegen das Vertragsschema. Im Programm ist er
  // nicht gesetzt und kostet nichts.
  (globalThis as { __raviaExportGebaut?: (e: RaviaExport) => void }).__raviaExportGebaut?.(ergebnis);
  return ergebnis;
}

/**
 * Der Baugrund für den Export.
 *
 * Die Bodenart steht im Modell, seit die Wärmequelle der Wärmepumpe ausgelegt
 * wird — sie war dort aber eingesperrt. Für die Erdreichrechnung nach
 * DIN EN ISO 13370 ist sie ebenso eine Eingangsgröße, und der Grundwasserstand
 * ist diejenige, die die Korrektur G_w überhaupt erst auslöst. Beides gehört
 * deshalb in den Export, und zwar als Erfassung: gerechnet wird hier nichts.
 * λ-Werte kommen keine vor — ihre Tabelle gehört zur Norm.
 *
 * `undefined`, solange es nichts zu berichten gibt. Zwei Fälle lösen den Block
 * aus: das Gebäude berührt das Erdreich — dann braucht die Gegenstelle den
 * Baugrund, und sei es, um ihn zu verwerfen —, oder ein Grundwasserstand ist
 * erfasst; der wurde bewusst eingetragen und darf nicht unterschlagen werden.
 * Berührt kein Bauteil das Erdreich und ist nichts erfasst, verhält sich das
 * Dokument exakt wie vor der Einführung dieses Blocks: dann stünde dort nur
 * eine Vorbelegung ohne Frage, auf die sie antwortet.
 *
 * Die Bodenart selbst ist eine Eingabe mit Vorbelegung („normal"); dass sie
 * eine ist, steht in `conventions.subsoil` und wird mit ausgeliefert. Der
 * Grundwasserstand hat keine Vorbelegung — er fehlt lieber.
 */
function buildSubsoil(doc: BimDocument, rooms: ExportRoom[]): ExportSubsoil | undefined {
  const site = doc.site;
  if (!site) return undefined;

  // Beide Größen aus der fertigen Flächenliste statt aus einer zweiten
  // Rechnung: so können sie dem widersprechen, was daneben im Dokument steht.
  let groundContactArea = 0;
  let deepestEmbedment = 0;
  for (const room of rooms) {
    groundContactArea += room.groundContactArea;
    for (const surface of room.surfaces) {
      const depth = surface.groundContact?.embedmentDepth ?? 0;
      if (depth > deepestEmbedment) deepestEmbedment = depth;
    }
  }

  if (groundContactArea <= 0 && site.groundwaterDepth === undefined) return undefined;

  return {
    soil: site.soil,
    soilLabel: SOIL_LABELS[site.soil],
    ...(site.groundwaterDepth !== undefined
      ? { groundwaterDepth: roundMm(site.groundwaterDepth) }
      : {}),
    ...(site.groundwaterAzimuth !== undefined
      ? { groundwaterAzimuth: site.groundwaterAzimuth }
      : {}),
    ...(doc.meta.terrainElevation !== undefined
      ? { terrainElevation: roundMm(doc.meta.terrainElevation) }
      : {}),
    deepestEmbedment: roundMm(deepestEmbedment),
    groundContactArea: roundCm2(groundContactArea),
  };
}

/**
 * Ist überhaupt eine Anlage geplant?
 *
 * Ein leeres Anlagenblatt gehört nicht in den Export: die Gegenseite müsste
 * dann unterscheiden, ob „kein Gerät" heißt *es gibt keines* oder *es wurde
 * noch nicht ausgewählt*. Der Block fehlt lieber ganz.
 */
function hasPlant(doc: BimDocument): boolean {
  const p = doc.plant;
  if (!p) return false;
  return Boolean(
    p.generatorModelId ||
      Object.keys(p.storages).length ||
      Object.keys(p.circuits).length ||
      Object.keys(p.schematic.components).length,
  );
}

/**
 * Die Anlagentechnik für den Export zusammenstellen.
 *
 * Gerechnet wird hier nichts, was nicht ohnehin gerechnet würde: die
 * Auslegung läuft einmal über `designPlant` und wird abgeschrieben. Damit
 * steht in der Datei genau das, was im Anlagenblatt auf dem Bildschirm steht —
 * eine zweite Rechenstrecke im Export wäre eine zweite Fehlerquelle.
 */
function buildPlantExport(doc: BimDocument): ExportPlant {
  const p = doc.plant;
  const design = designPlant(doc, { heatLoad: p.heatLoadOverride, extraModels: p.extraModels });
  const model = design.selected?.model;
  return {
    generator: model
      ? {
          modelId: model.id,
          label: model.label,
          form: model.form,
          source: model.source,
          refrigerant: model.refrigerant,
          refrigerantMass: model.refrigerantMass,
          nominalCapacity: model.nominalCapacity,
          nominalPoint: model.nominalPoint,
          capacityAtDesign: design.selected?.capacityAtDesign ?? model.nominalCapacity,
          maxFlowTemperature: model.maxFlowTemperature,
          scop35: model.scop35,
          provenance: model.provenance,
          manufacturer: model.manufacturer,
        }
      : undefined,
    storages: Object.values(p.storages).map((s2) => ({
      id: s2.id,
      label: s2.label,
      kind: s2.kind,
      volume: s2.volume,
      roomId: s2.roomId,
      suggested: s2.suggested,
    })),
    design: p.design,
    /*
     * Die Deckungsanteile — nur, wenn sie gerechnet werden konnten. Warum
     * nicht, steht in der Modellprüfung und nicht als leerer Block hier.
     */
    ...('ergebnis' in design.bivalenz
      ? {
          bivalence: {
            method: 'duration-curve-linear' as const,
            operation: design.bivalenz.ergebnis.betrieb,
            bivalencePoint: design.bivalenz.ergebnis.bivalenzpunkt,
            ...(design.bivalenz.ergebnis.abschaltpunkt === undefined
              ? {}
              : { cutOffPoint: design.bivalenz.ergebnis.abschaltpunkt }),
            heatPumpShare: design.bivalenz.ergebnis.anteilWaermepumpe,
            secondGeneratorShare: design.bivalenz.ergebnis.anteilZweiterzeuger,
            timeShareBelowBivalence: design.bivalenz.ergebnis.zeitanteilUnterBivalenz,
            timeShareWithoutHeatPump: design.bivalenz.ergebnis.zeitanteilOhneWaermepumpe,
            capacityAtBivalence: design.bivalenz.ergebnis.leistungAmBivalenzpunkt,
            secondGeneratorRequired: design.bivalenz.ergebnis.leistungZweiterzeuger,
            secondGeneratorInstalled: design.bivalenz.ergebnis.leistungVorhanden,
            secondGeneratorShortfall: design.bivalenz.ergebnis.leistungFehlt,
            curve: {
              designHeatLoad: design.heatLoad,
              designOutdoorTemperature: doc.meta.designOutdoorTemperature,
              heatingLimit: p.design.heatingLimit as number,
            },
            assumptions: design.bivalenz.ergebnis.annahmen,
          },
        }
      : {}),
    /*
     * Die Nutzungseinheit am Heizkreis — abgeleitet aus seinen Räumen.
     *
     * `occupancyUnitId` steht nur, wenn sie eindeutig ist. Läuft ein Kreis
     * über mehrere Einheiten, stehen sie in `occupancyUnitIds`, und die
     * Modellprüfung meldet es: Ein solcher Kreis lässt sich nicht je Wohnung
     * regeln und nicht je Wohnung abrechnen. Eine der mehreren auszuwählen
     * wäre geraten.
     */
    circuits: design.circuits.map((c) => {
      const einheiten = einheitenVonRaeumen(doc, c.circuit.roomIds);
      return {
        ...c.circuit,
        ...(einheiten.length === 1 ? { occupancyUnitId: einheiten[0] } : {}),
        ...(einheiten.length > 1 ? { occupancyUnitIds: einheiten } : {}),
      };
    }),
    safety: design.safety,
    domesticHotWater: design.dhw,
    schematic: {
      components: Object.values(p.schematic.components),
      links: Object.values(p.schematic.links),
    },
  };
}

function buildVerticals(doc: BimDocument): ExportVertical[] {
  return Object.values(doc.verticals ?? {}).map((v: VerticalElement) => {
    const room = Object.values(doc.rooms).find(
      (r) => r.levelId === v.levelId && r.innerPolygon.length >= 3 && pointInPolygon(v.position, r.innerPolygon),
    );
    return {
      id: v.id,
      kind: v.kind,
      name: v.name,
      level: doc.levels[v.levelId]?.name ?? v.levelId,
      toLevel: v.toLevelId ? doc.levels[v.toLevelId]?.name : undefined,
      area: roundCm2(v.width * v.length),
      width: roundMm(v.width),
      length: roundMm(v.length),
      steps: v.steps,
      service: v.service,
      deductsArea: v.deductsArea,
      openToAbove: v.openToAbove,
      roomId: room?.id,
    };
  });
}

/**
 * Größte Abweichung [m], bei der eine Grundrisskante noch als „liegt an der
 * Wand" gilt.
 *
 * Keine Normgröße, sondern eine Zeichentoleranz: ein Kamin wird an die
 * Wandinnenkante gesetzt, nicht auf sie gerechnet. Sechs Zentimeter fangen
 * das Rastermaß (5 cm) mit ab und sind schmal genug, dass ein frei im Raum
 * stehender Pfeiler nicht versehentlich als Wärmebrücke erscheint.
 */
const SOLID_WALL_TOUCH_TOLERANCE = 0.06;

/**
 * Massive Bauteile für den Export — samt der Eingangsgrößen ihrer Wärmebrücke.
 *
 * **Was hier gerechnet wird und was nicht.** Ein Schornstein in der Außenwand
 * ist eine Wärmebrücke; sein längenbezogener Wärmedurchgangskoeffizient ψ
 * hängt an Zugquerschnitt, Schamotte, Dämmschale und Anschlussausbildung und
 * steht in keiner frei zitierbaren Tabelle. Er wird deshalb **nicht** gebildet.
 * Geliefert wird stattdessen, was die Gegenstelle braucht, um ihn zu bilden:
 * ob das Bauteil eine Außenwand berührt, wie lang die Berührung ist und
 * welche Wände es sind.
 *
 * Berührung heißt: eine Kante des Grundrisses liegt auf der raumseitigen
 * Fläche einer Außenwand, also im Abstand einer halben Wandstärke von deren
 * Achse. Gemessen wird an der Kantenmitte; die Toleranz steht darüber.
 */
function buildSolids(doc: BimDocument): ExportSolid[] {
  const order = Object.values(doc.levels).sort((a, b) => a.order - b.order);
  const rank = new Map(order.map((l, i) => [l.id, i]));

  return Object.values(doc.solids ?? {}).map((b: SolidElement) => {
    const outline = solidFootprint(b);
    const area = polygonArea(outline);
    const own = doc.levels[b.levelId];

    // Durchlaufene Geschosse: das eigene und — beim Schornstein — jedes
    // darüber. Aus ihnen folgt auch das Bauvolumen, denn die Geschosse sind
    // nicht gleich hoch (ein Keller ist niedriger als ein Wohngeschoss).
    const here = rank.get(b.levelId);
    const spanned = order.filter((l, i) => l.id === b.levelId || (b.throughAllLevels && here !== undefined && i > here));
    const volume = spanned.reduce((sum, l) => sum + area * (b.height ?? l.height), 0);

    // --- Wärmebrücke: Berührung mit Außenwänden ---------------------------
    const walls = Object.values(doc.walls).filter((w) => w.levelId === b.levelId && w.type === 'exterior');
    const touched = new Set<string>();
    let contactLength = 0;
    for (let i = 0; i < outline.length; i++) {
      const p = outline[i];
      const q = outline[(i + 1) % outline.length];
      const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
      let hit: string | undefined;
      for (const w of walls) {
        const g = getWallGeometry(w, doc.nodes);
        if (!g) continue;
        if (Math.abs(distanceToSegment(mid, g.a, g.b) - g.halfThickness) > SOLID_WALL_TOUCH_TOLERANCE) continue;
        hit = w.id;
        break;
      }
      if (!hit) continue;
      touched.add(hit);
      contactLength += distance(p, q);
    }

    const room = Object.values(doc.rooms).find(
      (r) => r.levelId === b.levelId && r.innerPolygon.length >= 3 && pointInPolygon(b.position, r.innerPolygon),
    );

    return {
      id: b.id,
      kind: b.kind,
      name: b.name,
      level: own?.name ?? b.levelId,
      levels: spanned.map((l) => l.name),
      outline: outline.map((p) => ({ x: roundMm(p.x), y: roundMm(p.y) })),
      area: roundCm2(area),
      perimeter: roundCm2(polygonPerimeter(outline)),
      height: roundMm(b.height ?? own?.height ?? 2.75),
      volume: roundCm2(volume),
      material: b.material,
      roomId: room?.id,
      thermalBridge: {
        atExteriorWall: touched.size > 0,
        contactLength: roundCm2(contactLength),
        wallIds: [...touched],
      },
    };
  });
}

/**
 * Die Durchbrüche für den Export.
 *
 * Kurz, und das mit Absicht. Ein Durchbruch trägt keine Rechengröße, die
 * hier erst gebildet werden müsste — er trägt Maße, eine Lage und eine
 * Anforderung. Was diese Funktion tut, ist deshalb vor allem: die Lage aus
 * dem parametrischen Sitz in der Wand in einen Weltpunkt übersetzen, damit
 * die Gegenstelle den Durchbruch auf ihrem Plan wiederfindet, ohne die
 * Wandgeometrie nachbauen zu müssen.
 *
 * Ein verwaister Durchbruch — die Wand ist fort — bekommt keinen Punkt und
 * wird trotzdem geliefert. Er verschwindet nicht aus dem Export, nur weil er
 * unvollständig ist; die Prüfung meldet ihn als `durchbruch.orphan`, und die
 * Gegenstelle sieht ihn in derselben Liste wie der Zeichner.
 */
/**
 * Der lichte Querschnitt auf den Quadratzentimeter.
 *
 * `roundCm2` heißt zwar so, rundet aber auf 1/100 m² — das sind hundert
 * Quadratzentimeter. Bei einer Wandfläche ist das die richtige Auflösung; bei
 * einer Kernbohrung Ø 152 ist es die falsche: 0,0181 m² würden zu 0,02, ein
 * Fehler von zehn Prozent, und zwar bei jeder einzelnen Bohrung. Deshalb hier
 * eine eigene, feinere Rundung statt einer Änderung an der allgemeinen — die
 * wirkte auf jedes Bauteil im Export, und dafür gibt es keinen Anlass.
 */
const rundeQuerschnitt = (v: number): number => Math.round(v * 10000) / 10000;

function buildDurchbrueche(doc: BimDocument): ExportDurchbruch[] {
  return Object.values(doc.durchbrueche ?? {}).map((d: Durchbruch) => {
    const wirt = durchbruchWirt(d.kind);
    const mitte = durchbruchMitte(d, doc) ?? d.position ?? { x: 0, y: 0 };
    const level = doc.levels[d.levelId];
    return {
      id: d.id,
      kind: d.kind,
      name: d.name,
      wirt,
      level: level?.name ?? d.levelId,
      ...(d.wallId ? { wallId: d.wallId } : {}),
      form: d.form,
      ...(d.diameter !== undefined ? { diameter: roundMm(d.diameter) } : {}),
      ...(d.width !== undefined ? { width: roundMm(d.width) } : {}),
      ...(d.height !== undefined ? { height: roundMm(d.height) } : {}),
      openArea: rundeQuerschnitt(durchbruchFlaeche(d)),
      position: { x: roundMm(mitte.x), y: roundMm(mitte.y) },
      ...(wirt === 'wand' && d.sillHeight !== undefined
        ? { sillHeight: roundMm(d.sillHeight) }
        : {}),
      ...(d.service ? { service: d.service } : {}),
      ...(d.dn !== undefined ? { dn: d.dn } : {}),
      brandschutz: d.brandschutz ?? 'keine',
      ...(d.note ? { note: d.note } : {}),
    };
  });
}

/**
 * Gleitkomma-Rauschen aus Koordinaten nehmen — „2.5749999999999997" wird
 * „2.575". Gerundet wird auf den Mikrometer: Das entfernt nur die Reste der
 * Binärdarstellung und ändert keine Lage, auch nicht für das Zurücklesen.
 * Bis 1.74.0 trugen die Rohrpunkte im Export bis zu 16 Nachkommastellen.
 */
function ohneRauschen(punkte: readonly Vec2[]): Vec2[] {
  const r = (v: number): number => Math.round(v * 1e6) / 1e6;
  return punkte.map((p) => ({ ...p, x: r(p.x), y: r(p.y) }));
}

function buildPipes(doc: BimDocument): ExportPipe[] {
  return Object.values(doc.pipes ?? {}).map((run: PipeRun) => ({
    id: run.id,
    service: run.service,
    level: doc.levels[run.levelId]?.name ?? run.levelId,
    nominalDiameter: run.nominalDiameter,
    insulation: run.insulation,
    elevation: roundMm(run.elevation),
    // Wahre Länge, Trasse und Höhenversatz zusammen — siehe `rohrlaenge`.
    length: roundCm2(rohrlaenge(run)),
    elevationTo: run.elevationTo === undefined ? undefined : roundMm(run.elevationTo),
    points: ohneRauschen(run.points),
    fromFixtureId: run.fromFixtureId,
    toFixtureId: run.toFixtureId,
    label: run.label,
  }));
}

/**
 * Der Längenauszug: Meter je Gewerk, Nennweite und Dämmstärke.
 *
 * Das ist die Zahl, die man tatsächlich braucht — für den hydraulischen
 * Abgleich, für die Rohrwärmeabgabe und für die Massenermittlung. Einzelne
 * Abschnitte interessieren dort niemanden, die Summe je DN schon.
 */
function buildPipeSchedule(doc: BimDocument): PipeScheduleEntry[] {
  const map = new Map<string, PipeScheduleEntry>();
  for (const run of Object.values(doc.pipes ?? {})) {
    const key = `${run.service}|${run.nominalDiameter}|${run.insulation}`;
    const length = rohrlaenge(run);
    const steig = steiganteil(run);
    const entry = map.get(key);
    if (entry) {
      entry.length = roundCm2(entry.length + length);
      entry.riseLength = roundCm2((entry.riseLength ?? 0) + steig);
      entry.runs += 1;
    } else {
      map.set(key, {
        service: run.service,
        nominalDiameter: run.nominalDiameter,
        insulation: run.insulation,
        length: roundCm2(length),
        riseLength: roundCm2(steig),
        runs: 1,
      });
    }
  }
  return [...map.values()].sort(
    (a, b) => a.service.localeCompare(b.service) || a.nominalDiameter - b.nominalDiameter,
  );
}

/** TGA-Objekte einmal nach Raum sortieren statt je Raum alle zu filtern. */
function groupFixturesByRoom(doc: BimDocument): Map<string, Fixture[]> {
  const out = new Map<string, Fixture[]>();
  for (const f of Object.values(doc.fixtures)) {
    if (!f.roomId) continue;
    const list = out.get(f.roomId);
    if (list) list.push(f);
    else out.set(f.roomId, [f]);
  }
  return out;
}

/**
 * Wärmepumpe und Außenanlage für den Export.
 *
 * Bewusst mit *Nachweis*, nicht nur mit Gerätedaten: der Schallnachweis ist
 * die Angabe, die bei der Genehmigung verlangt wird, und sie lässt sich aus
 * den Rohdaten allein nicht wiederherstellen, ohne die Aufstellsituation zu
 * kennen. Die Rohgrößen stehen trotzdem daneben — die Gegenstelle soll
 * nachrechnen können.
 */
function buildHeatPumpExport(doc: BimDocument): ExportHeatPump {
  const site = doc.site;
  const boundary = Object.values(site.elements).find((e) => e.kind === 'boundary');
  return {
    site: {
      areaCategory: site.areaCategory,
      immissionLimits: IMMISSION_LIMITS[site.areaCategory],
      state: site.state,
      soil: site.soil,
      waterProtection: site.waterProtection,
      sourceRunHours: site.sourceRunHours,
      ...(boundary && boundary.points.length >= 3
        ? { plotArea: roundCm2(polygonArea(boundary.points)) }
        : {}),
    },
    pumps: Object.values(site.pumps).map((pump) => {
      const report = acousticReport(doc, pump);
      const demand = sourceDemand(doc, pump);
      return {
        id: pump.id,
        label: pump.label,
        source: pump.source,
        form: pump.form,
        heatingCapacity: pump.heatingCapacity,
        ratingPoint: pump.ratingPoint,
        cop: pump.cop,
        operation: pump.operation,
        bivalencePoint: pump.bivalencePoint,
        backupCapacity: pump.backupCapacity,
        flowTemperature: pump.flowTemperature,
        refrigerant: pump.refrigerant,
        refrigerantMass: pump.refrigerantMass,
        gridRegime: pump.gridRegime,
        blockedHours: pump.blockedHours,
        blockingFactor: pump.gridRegime === 'evu-3x2h' ? blockingFactor(pump.blockedHours) : 1,
        domesticHotWater: pump.domesticHotWater,
        occupants: pump.occupants,
        acoustics: {
          soundPower: report.soundPower,
          roomAngle: report.roomAngle,
          toneSurcharge: pump.toneSurcharge,
          limitNight: report.limitNight,
          limitDistance: report.limitDistance,
          safeDistance: report.safeDistance,
          points: report.points.map((p) => ({
            label: p.label,
            origin: p.origin,
            distance: p.distance,
            level: p.level,
            limit: p.limit,
            verdict: p.verdict,
          })),
        },
        // Die Sicherheitsgruppe geht mit: Sie entscheidet über den
        // Schutzbereich, und eine Gegenstelle, die sie aus dem Namen ableiten
        // müsste, bräuchte dafür eine eigene Tabelle — also eine zweite, die
        // von dieser abweichen kann.
        refrigerantClass: kaeltemittel(pump.refrigerant)?.klasse ?? 'unbekannt',
        hermetisch: pump.hermetisch === true,
        protectionIssues: protectionIssues(doc, pump),
        ...(demand ? { source_demand: demand } : {}),
      };
    }),
    elements: Object.values(site.elements),
  };
}

function buildTotals(
  doc: BimDocument,
  rooms: ExportRoom[],
  allFixtures: Fixture[],
): ExportBuildingTotals {
  let netFloorArea = 0;
  let grossFloorArea = 0;
  let netVolume = 0;
  let exteriorWallArea = 0;
  let windowArea = 0;
  let installedHeatingPower = 0;
  let heatedRoomCount = 0;
  let heatedVolume = 0;

  for (const room of rooms) {
    installedHeatingPower += room.installedHeatingPower;
    netFloorArea += room.area;
    netVolume += room.volume;
    exteriorWallArea += room.exteriorWallArea;
    windowArea += room.totalWindowArea;
    if (room.isHeated) {
      heatedRoomCount++;
      heatedVolume += room.volume;
    }
    // Bruttofläche grob über den Umfang und eine mittlere Wandstärke von 24 cm
    grossFloorArea += room.area + room.perimeter * 0.12;
  }

  /*
   * **Eine Hüllfläche, nicht zwei.**
   *
   * Hier stand `exteriorWallArea + 2 · netFloorArea`, und `exteriorWallArea`
   * ist die **Nettofläche** der Außenwände — also ohne die Fenster. Damit
   * fehlte in der Hüllfläche genau das Bauteil, über das ein Gebäude am
   * meisten verliert. Am FZK-Haus waren das 595,65 statt 630,85 m²: die
   * Kompaktheit, die das Eigenschaftenblatt als „A/V" ausweist, kam 6 %
   * zu günstig heraus. A/V ist für den Energieberater eine Kopfzahl; sie
   * darf nicht davon abhängen, welche der beiden Summen im Export gerade
   * gegriffen hat.
   *
   * Benutzt wird deshalb dieselbe Fläche, die auch die Wärmebrückenbilanz
   * und das Panel benutzen: `envelopeArea` zählt die Außenbauteile
   * **brutto** — Wand samt Fenstern und Türen — plus Boden, Decke bzw.
   * Dach, soweit sie an Außenluft, Erdreich oder Unbeheiztes grenzen. Das
   * ist die wärmeübertragende Hüllfläche, wie DIN EN ISO 13789 sie meint.
   */
  const bridgeEnvelope = envelopeArea(doc);

  const schaetzung = estimateHeatLoad(doc);
  const gegenprobe = verbrauchsabgleich(schaetzung.totalKw, [
    heizlastAusVerbrauch(doc.meta.verbrauch),
    heizlastAusBaualter(doc.meta.baualter, schaetzung.heatedArea, doc.meta.verbrauch?.mitWarmwasser ?? true),
  ]);

  return {
    thermalBridges: bridgeTotals(doc, rooms, bridgeEnvelope),
    setback: setbackTotals(doc, rooms, bridgeEnvelope),
    ventilation: ventilationTotals(doc, rooms),
    roomCount: rooms.length,
    heatedRoomCount,
    heatedVolume: roundCm2(heatedVolume),
    netFloorArea: roundCm2(netFloorArea),
    grossFloorArea: roundCm2(grossFloorArea),
    netVolume: roundCm2(netVolume),
    exteriorWallArea: roundCm2(exteriorWallArea),
    windowArea: roundCm2(windowArea),
    windowWallRatio:
      exteriorWallArea + windowArea > 0
        ? Math.round((windowArea / (exteriorWallArea + windowArea)) * 1000) / 1000
        : 0,
    compactness: netVolume > 0 ? Math.round((bridgeEnvelope / netVolume) * 1000) / 1000 : 0,
    installedHeatingPower,
    fixtureCount: countByCategory(allFixtures),
    /*
     * **Die Gegenprobe zur Heizlast.** Sie steht hier und nicht bei den
     * Räumen, weil sie eine Aussage über das ganze Gebäude ist — und sie
     * steht überhaupt im Export, damit die Gegenstelle sie nicht selbst
     * nachbauen muss. Wer die Vollbenutzungsstunden aus dem Teiler 250
     * zurückrechnen müsste, käme irgendwann auf eine andere Zahl als wir,
     * und dann gäbe es zwei Gegenproben, die sich widersprechen.
     *
     * Der Block fehlt, solange niemand einen Verbrauch oder ein Baualter
     * eingetragen hat — ein leerer Block wäre eine Behauptung über eine
     * Gegenprobe, die es nicht gibt.
     */
    ...(gegenprobe.zeilen.length ? { heatLoadCrosscheck: gegenprobe } : {}),
  };
}

/**
 * Wärmebrücken über alle Räume. Die Bilanz wird *immer* gebildet, auch im
 * pauschalen Verfahren — nur so lässt sich sehen, ob die gewählte Pauschale
 * für dieses Gebäude zu groß oder zu klein ist. Übernommen in die Rechnung
 * wird trotzdem nur eines von beiden.
 */
function bridgeTotals(
  doc: BimDocument,
  rooms: ExportRoom[],
  envelopeArea: number,
): ThermalBridgeTotals {
  const lengthsByKind: Partial<Record<ThermalBridgeKind, number>> = {};
  const openingIndex = indexOpeningsByWall(Object.values(doc.openings));
  let detailed = 0;

  for (const room of rooms) {
    const source = doc.rooms[room.id];
    // Unbeheizte Räume liegen außerhalb der Hülle (Befund B5).
    if (source && !source.isHeated) continue;
    const bridges = room.thermalBridges ?? (source ? roomThermalBridges(doc, source, openingIndex) : []);
    for (const b of bridges) {
      detailed += b.heatLossCoefficient;
      lengthsByKind[b.kind] = roundCm2((lengthsByKind[b.kind] ?? 0) + b.length);
    }
  }

  const supplement = doc.meta.thermalBridgeSupplement;
  return {
    method: doc.meta.thermalBridgeMethod ?? 'flat',
    category: doc.meta.thermalBridgeCategory ?? 'none',
    supplement,
    envelopeArea: roundCm2(envelopeArea),
    detailedHeatLoss: roundCm2(detailed),
    flatHeatLoss: roundCm2(supplement * envelopeArea),
    equivalentSupplement:
      envelopeArea > 0.01 ? Math.round((detailed / envelopeArea) * 10000) / 10000 : 0,
    lengthsByKind,
  };
}

/** Wirksame Speicherfähigkeit c_wirk je Bauart [Wh/(m³·K)]. */
const HEAT_CAPACITY = { light: 15, medium: 42, heavy: 70 } as const;

/**
 * Absenkbetrieb. Erfasst werden Eingangsgrößen; abgeleitet werden nur die
 * beiden Größen, die aus dem Modell selbst folgen — die Zeitkonstante des
 * Gebäudes und der Temperaturabfall, der sich in der Absenkzeit einstellt.
 *
 * Der Wiederaufheizfaktor f_RH selbst kommt aus einer Tabelle der geltenden
 * Norm und wird hier *nicht* geraten: in Deutschland ist er national auf 0
 * gesetzt, und eine erfundene Tabelle wäre schlimmer als gar keine. Wer einen
 * Wert vorgibt, bekommt die Leistung ausgewiesen.
 */
function setbackTotals(
  doc: BimDocument,
  rooms: ExportRoom[],
  envelopeArea: number,
): SetbackTotals | undefined {
  const setback = doc.meta.setback;
  if (!setback?.active) return undefined;

  const heatedVolume = rooms.reduce((sum, r) => sum + (r.isHeated ? r.volume : 0), 0);
  const floorArea = rooms.reduce((sum, r) => sum + (r.isHeated ? (r.netFloorArea ?? r.area) : 0), 0);

  // H_Abs: Transmission über die Hüllfläche plus Lüftung mit dem
  // Absenk-Luftwechsel. Ein mittlerer U-Wert reicht hier — die Zeitkonstante
  // reagiert darauf logarithmisch, nicht linear.
  const meanU = meanEnvelopeUValue(rooms);
  const transmission = meanU * envelopeArea;
  const ventilation = 0.34 * setback.airChangeRate * heatedVolume;
  const heatLossCoefficient = transmission + ventilation;

  const capacity = HEAT_CAPACITY[setback.massClass];
  const timeConstant = heatLossCoefficient > 0.01 ? (capacity * heatedVolume) / heatLossCoefficient : 0;
  const drop =
    timeConstant > 0.01
      ? (doc.meta.designIndoorTemperature - doc.meta.designOutdoorTemperature) *
        (1 - Math.exp(-setback.hours / timeConstant))
      : 0;

  const reheatFactor = doc.meta.reheatFactor ?? 0;
  return {
    active: true,
    hours: setback.hours,
    reheatHours: setback.reheatHours,
    airChangeRate: setback.airChangeRate,
    massClass: setback.massClass,
    effectiveHeatCapacity: capacity,
    heatLossCoefficient: roundCm2(heatLossCoefficient),
    timeConstant: roundCm2(timeConstant),
    temperatureDrop: roundCm2(drop),
    reheatFactor,
    reheatPower: Math.round(floorArea * reheatFactor),
  };
}

/**
 * Luftbilanz des Gebäudes. Die interessante Zahl ist `balance`: eine
 * ausgeglichene Anlage steht bei 0. Steht sie nicht bei 0, geht die Differenz
 * durch die Gebäudehülle — bei Überdruck hinaus, bei Unterdruck herein, und
 * zwar ungewärmt. Das ist kein Rundungsfehler, sondern eine Heizlast, die in
 * keiner Rechnung auftaucht, solange niemand nachzählt.
 */
function ventilationTotals(doc: BimDocument, rooms: ExportRoom[]): VentilationTotals {
  const system = doc.meta.ventilation;
  const kind = system?.kind ?? 'none';
  const recovery = kind === 'balanced' ? Math.min(0.95, Math.max(0, system?.heatRecovery ?? 0)) : 0;

  const roomsByRole: Record<VentilationRole, number> = { supply: 0, exhaust: 0, transfer: 0, none: 0 };
  let supply = 0;
  let exhaust = 0;
  let transfer = 0;
  for (const room of rooms) {
    roomsByRole[room.ventilation.role]++;
    supply += room.ventilation.supplyAirflow;
    exhaust += room.ventilation.exhaustAirflow;
    transfer += room.ventilation.transferAirflow;
  }

  return {
    kind,
    heatRecovery: recovery,
    operation: system?.operation ?? 'continuous',
    ...(system?.preheatTemperature !== undefined
      ? { preheatTemperature: system.preheatTemperature }
      : {}),
    supplyAirflow: Math.round(supply),
    exhaustAirflow: Math.round(exhaust),
    transferAirflow: Math.round(transfer),
    effectiveSupplyAirflow: Math.round(supply * (1 - recovery)),
    balance: Math.round(supply - exhaust),
    roomsByRole,
  };
}

/** Flächengewichteter U-Wert aller Hüllbauteile gegen Außenluft oder Erdreich. */
function meanEnvelopeUValue(rooms: ExportRoom[]): number {
  let area = 0;
  let sum = 0;
  for (const room of rooms) {
    for (const s of room.surfaces) {
      if (s.boundary === 'adjacent-room' || s.boundary === 'adiabatic') continue;
      area += s.netArea;
      sum += s.netArea * (s.uValue + (s.thermalBridgeSupplement ?? 0));
      for (const o of s.openings ?? []) {
        area += o.area;
        sum += o.area * o.uValue;
      }
    }
  }
  return area > 0.01 ? sum / area : 0;
}

function countByCategory(fixtures: Fixture[]): Record<FixtureCategory, number> {
  const counts: Record<FixtureCategory, number> = { heating: 0, sanitary: 0, ventilation: 0 };
  for (const f of fixtures) counts[f.category]++;
  return counts;
}

/** Löst den Download der Exportdatei aus. */
export function downloadJson(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Object-URLs leben bis zum Reload weiter, wenn man sie nicht freigibt.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Dateiname aus Projektname + Datum — ohne Sonderzeichen. */
export function exportFilename(projectName: string): string {
  const slug = projectName
    .toLowerCase()
    .replace(/[äöüß]/g, (c) => ({ ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' })[c] ?? c)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  const date = new Date().toISOString().slice(0, 10);
  return `${slug || 'projekt'}_ravia-bim_${date}.json`;
}
