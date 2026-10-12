# Typindex CAD Light (Interfaces, Typen, Klassen, Enums)

Stand: 11.10.2026 · Quelle: CAD_light@5200d65 (Version 1.78.0) · automatisch aus den Quelltexten erzeugt (Regex über `export`/`import`), danach geprüft
**659 exportierte Typen.** Das fachliche Datenmodell steht fast vollständig in `src/types/bim.ts`; Beschreibung der Modelle: `ravia_heizlast/docs/models/`.


| Typ | Art | Ort | Importiert von |
|---|---|---|---|
| `AnlagenFragenProps` | interface | [`src/components/AnlagenFragen.tsx:67`](../../src/components/AnlagenFragen.tsx#L67) | – |
| `ProtokollEintrag` | interface | [`src/components/Protokoll.tsx:18`](../../src/components/Protokoll.tsx#L18) | – |
| `AnlageAusAntworten` | interface | [`src/lib/anlagenFragen.ts:179`](../../src/lib/anlagenFragen.ts#L179) | – |
| `Abweichung` | interface | [`src/lib/anlagenFragen.ts:323`](../../src/lib/anlagenFragen.ts#L323) | `components/AnlagenFragen.tsx` |
| `HinweisArt` | type | [`src/lib/anlagenhinweise.ts:17`](../../src/lib/anlagenhinweise.ts#L17) | – |
| `Anlagenhinweis` | interface | [`src/lib/anlagenhinweise.ts:19`](../../src/lib/anlagenhinweise.ts#L19) | – |
| `Ladekreis` | interface | [`src/lib/anlagenhinweise.ts:25`](../../src/lib/anlagenhinweise.ts#L25) | – |
| `Anlagenangaben` | interface | [`src/lib/anlagenhinweise.ts:33`](../../src/lib/anlagenhinweise.ts#L33) | – |
| `PlanningNote` | type | [`src/lib/anschlussgroesse.ts:56`](../../src/lib/anschlussgroesse.ts#L56) | – |
| `Geraeteanschluss` | interface | [`src/lib/anschlussgroesse.ts:268`](../../src/lib/anschlussgroesse.ts#L268) | – |
| `AnschlussHerkunft` | type | [`src/lib/anschlussgroesse.ts:276`](../../src/lib/anschlussgroesse.ts#L276) | – |
| `Anschluss` | interface | [`src/lib/anschlussgroesse.ts:278`](../../src/lib/anschlussgroesse.ts#L278) | – |
| `Anschlusspruefung` | interface | [`src/lib/anschlussgroesse.ts:353`](../../src/lib/anschlussgroesse.ts#L353) | `lib/plantDesign.ts` |
| `Raumart` | interface | [`src/lib/aufnahme.ts:45`](../../src/lib/aufnahme.ts#L45) | – |
| `Anbau` | type | [`src/lib/aufnahme.ts:77`](../../src/lib/aufnahme.ts#L77) | `components/AufnahmeAssistent.tsx` |
| `Achsrechteck` | interface | [`src/lib/aufnahme.ts:87`](../../src/lib/aufnahme.ts#L87) | `components/AufnahmeAssistent.tsx` |
| `RaumFrage` | type | [`src/lib/aufnahme.ts:269`](../../src/lib/aufnahme.ts#L269) | – |
| `UebernahmePlan` | interface | [`src/lib/aussenwand.ts:164`](../../src/lib/aussenwand.ts#L164) | `scripts/pruefungen/aussenwand.ts` |
| `UebernahmeEingabe` | interface | [`src/lib/aussenwand.ts:171`](../../src/lib/aussenwand.ts#L171) | – |
| `KorrekturDokument` | type | [`src/lib/autokorrektur.ts:97`](../../src/lib/autokorrektur.ts#L97) | `scripts/pruefungen/autokorrektur-belastung.ts`, `scripts/pruefungen/autokorrektur.ts` |
| `Anschluss` | type | [`src/lib/autokorrektur.ts:103`](../../src/lib/autokorrektur.ts#L103) | – |
| `Stummel` | interface | [`src/lib/autokorrektur.ts:114`](../../src/lib/autokorrektur.ts#L114) | – |
| `DoppelWand` | interface | [`src/lib/autokorrektur.ts:122`](../../src/lib/autokorrektur.ts#L122) | – |
| `SchiefGeschoss` | interface | [`src/lib/autokorrektur.ts:129`](../../src/lib/autokorrektur.ts#L129) | – |
| `LueckenFund` | interface | [`src/lib/autokorrektur.ts:140`](../../src/lib/autokorrektur.ts#L140) | – |
| `LeitungsFund` | interface | [`src/lib/autokorrektur.ts:147`](../../src/lib/autokorrektur.ts#L147) | – |
| `KleinraumFund` | interface | [`src/lib/autokorrektur.ts:157`](../../src/lib/autokorrektur.ts#L157) | – |
| `Korrekturplan` | interface | [`src/lib/autokorrektur.ts:165`](../../src/lib/autokorrektur.ts#L165) | `components/KorrekturDialog.tsx`, `store/bimZustand.ts` |
| `KorrekturAuswahl` | interface | [`src/lib/autokorrektur.ts:180`](../../src/lib/autokorrektur.ts#L180) | `scripts/pruefungen/autokorrektur.ts`, `components/KorrekturDialog.tsx`, `store/bimZustand.ts`, `store/slices/laden.ts` |
| `KorrekturBericht` | interface | [`src/lib/autokorrektur.ts:190`](../../src/lib/autokorrektur.ts#L190) | `store/bimZustand.ts`, `store/slices/laden.ts` |
| `AutosaveEntry` | interface | [`src/lib/autosave.ts:40`](../../src/lib/autosave.ts#L40) | `App.tsx` |
| `SicherungsErgebnis` | type | [`src/lib/autosave.ts:59`](../../src/lib/autosave.ts#L59) | `App.tsx` |
| `Baugrube` | interface | [`src/lib/baugrube.ts:57`](../../src/lib/baugrube.ts#L57) | `components/Viewer3D.tsx` |
| `BaugrubeEingabe` | interface | [`src/lib/baugrube.ts:68`](../../src/lib/baugrube.ts#L68) | – |
| `Hindernis` | interface | [`src/lib/begehen.ts:51`](../../src/lib/begehen.ts#L51) | `components/Viewer3D.tsx` |
| `Treppenlauf` | interface | [`src/lib/begehen.ts:385`](../../src/lib/begehen.ts#L385) | `scripts/pruefungen/begehen.ts`, `components/Viewer3D.tsx` |
| `Tritt` | interface | [`src/lib/begehen.ts:402`](../../src/lib/begehen.ts#L402) | – |
| `BegradigenOptionen` | interface | [`src/lib/begradigen.ts:37`](../../src/lib/begradigen.ts#L37) | `store/bimZustand.ts` |
| `BegradigenErgebnis` | interface | [`src/lib/begradigen.ts:55`](../../src/lib/begradigen.ts#L55) | – |
| `Beschriftungsvorschlag` | interface | [`src/lib/beschriftung3d.ts:44`](../../src/lib/beschriftung3d.ts#L44) | `components/Viewer3D.tsx` |
| `Beschriftungspunkt` | interface | [`src/lib/beschriftungsLage.ts:32`](../../src/lib/beschriftungsLage.ts#L32) | – |
| `Rechteck` | interface | [`src/lib/beschriftungsLage.ts:46`](../../src/lib/beschriftungsLage.ts#L46) | `scripts/pruefungen/beschriftungslage.ts`, `lib/planPrint.ts`, `lib/schemaBeschriftung.ts`, `lib/verticalSymbols.ts` |
| `Beschriftungsmass` | interface | [`src/lib/beschriftungsLage.ts:62`](../../src/lib/beschriftungsLage.ts#L62) | – |
| `Beschriftungslage` | interface | [`src/lib/beschriftungsLage.ts:72`](../../src/lib/beschriftungsLage.ts#L72) | – |
| `Beschriftungsoptionen` | interface | [`src/lib/beschriftungsLage.ts:87`](../../src/lib/beschriftungsLage.ts#L87) | – |
| `Gebaeudekennlinie` | interface | [`src/lib/bivalenz.ts:50`](../../src/lib/bivalenz.ts#L50) | `scripts/pruefungen/bivalenz.ts`, `lib/plantDesign.ts` |
| `Bivalenzergebnis` | interface | [`src/lib/bivalenz.ts:92`](../../src/lib/bivalenz.ts#L92) | `lib/plantDesign.ts` |
| `BivalenzHindernis` | type | [`src/lib/bivalenz.ts:124`](../../src/lib/bivalenz.ts#L124) | `lib/plantDesign.ts` |
| `BodenbelagId` | type | [`src/lib/bodenbelag.ts:25`](../../src/lib/bodenbelag.ts#L25) | – |
| `Bodenbelag` | interface | [`src/lib/bodenbelag.ts:35`](../../src/lib/bodenbelag.ts#L35) | – |
| `DachVorschlag` | interface | [`src/lib/buildingModelImport.ts:93`](../../src/lib/buildingModelImport.ts#L93) | – |
| `ScanPruefpunkt` | interface | [`src/lib/buildingModelImport.ts:110`](../../src/lib/buildingModelImport.ts#L110) | – |
| `BuildingImportErgebnis` | interface | [`src/lib/buildingModelImport.ts:118`](../../src/lib/buildingModelImport.ts#L118) | `lib/scanUebernahme.ts`, `store/bimZustand.ts` |
| `Dachteil` | interface | [`src/lib/dachlandschaft.ts:45`](../../src/lib/dachlandschaft.ts#L45) | `components/Viewer3D.tsx` |
| `LandschaftEingabe` | interface | [`src/lib/dachlandschaft.ts:116`](../../src/lib/dachlandschaft.ts#L116) | – |
| `Gerade` | interface | [`src/lib/dachschnitt.ts:48`](../../src/lib/dachschnitt.ts#L48) | – |
| `Punkt3` | interface | [`src/lib/dachschnitt.ts:55`](../../src/lib/dachschnitt.ts#L55) | `components/Viewer3D.tsx` |
| `Ebene` | interface | [`src/lib/dachschnitt.ts:62`](../../src/lib/dachschnitt.ts#L62) | – |
| `EbenesStueck` | interface | [`src/lib/dachschnitt.ts:69`](../../src/lib/dachschnitt.ts#L69) | `scripts/pruefungen/dachschnitt.ts` |
| `Koerperflaeche` | interface | [`src/lib/dachschnitt.ts:479`](../../src/lib/dachschnitt.ts#L479) | `components/Viewer3D.tsx` |
| `WandUnterDach` | interface | [`src/lib/dachschnitt.ts:484`](../../src/lib/dachschnitt.ts#L484) | – |
| `ModelMatch` | interface | [`src/lib/deviceCatalog.ts:780`](../../src/lib/deviceCatalog.ts#L780) | `scripts/pruefungen/schemapruefung.ts`, `scripts/pruefungen/schemavorschlag.ts`, `lib/plantDesign.ts` |
| `DeviceKind` | type | [`src/lib/deviceImport.ts:51`](../../src/lib/deviceImport.ts#L51) | – |
| `DecimalStyle` | type | [`src/lib/deviceImport.ts:57`](../../src/lib/deviceImport.ts#L57) | – |
| `ImportIssue` | interface | [`src/lib/deviceImport.ts:60`](../../src/lib/deviceImport.ts#L60) | – |
| `FieldMatch` | interface | [`src/lib/deviceImport.ts:74`](../../src/lib/deviceImport.ts#L74) | – |
| `ColumnMapping` | interface | [`src/lib/deviceImport.ts:94`](../../src/lib/deviceImport.ts#L94) | – |
| `ImportedDevice` | interface | [`src/lib/deviceImport.ts:107`](../../src/lib/deviceImport.ts#L107) | – |
| `DeviceImportReport` | interface | [`src/lib/deviceImport.ts:132`](../../src/lib/deviceImport.ts#L132) | `scripts/pruefungen/geraeteimport.ts`, `components/AnlagenPanel.tsx` |
| `DeviceImportOptions` | interface | [`src/lib/deviceImport.ts:148`](../../src/lib/deviceImport.ts#L148) | – |
| `ParsedCsv` | interface | [`src/lib/deviceImport.ts:295`](../../src/lib/deviceImport.ts#L295) | – |
| `CatalogMergeResult` | interface | [`src/lib/deviceImport.ts:2774`](../../src/lib/deviceImport.ts#L2774) | – |
| `CatalogMergeOptions` | interface | [`src/lib/deviceImport.ts:2790`](../../src/lib/deviceImport.ts#L2790) | – |
| `TemplateOptions` | interface | [`src/lib/deviceImport.ts:2901`](../../src/lib/deviceImport.ts#L2901) | – |
| `PlanningNote` | type | [`src/lib/domesticWater.ts:46`](../../src/lib/domesticWater.ts#L46) | – |
| `UnitDwelling` | interface | [`src/lib/domesticWater.ts:119`](../../src/lib/domesticWater.ts#L119) | – |
| `TapPointKind` | type | [`src/lib/domesticWater.ts:131`](../../src/lib/domesticWater.ts#L131) | – |
| `TapPointProfile` | interface | [`src/lib/domesticWater.ts:155`](../../src/lib/domesticWater.ts#L155) | – |
| `DwellingGroup` | interface | [`src/lib/domesticWater.ts:257`](../../src/lib/domesticWater.ts#L257) | – |
| `DemandIndexOptions` | interface | [`src/lib/domesticWater.ts:267`](../../src/lib/domesticWater.ts#L267) | – |
| `DemandIndexGroupResult` | interface | [`src/lib/domesticWater.ts:284`](../../src/lib/domesticWater.ts#L284) | – |
| `DemandIndexResult` | interface | [`src/lib/domesticWater.ts:298`](../../src/lib/domesticWater.ts#L298) | – |
| `ComfortLevel` | type | [`src/lib/domesticWater.ts:432`](../../src/lib/domesticWater.ts#L432) | – |
| `PeakDrawInput` | interface | [`src/lib/domesticWater.ts:453`](../../src/lib/domesticWater.ts#L453) | – |
| `StorageSizingInput` | interface | [`src/lib/domesticWater.ts:471`](../../src/lib/domesticWater.ts#L471) | – |
| `StorageSizingResult` | interface | [`src/lib/domesticWater.ts:495`](../../src/lib/domesticWater.ts#L495) | – |
| `ReheatInput` | interface | [`src/lib/domesticWater.ts:647`](../../src/lib/domesticWater.ts#L647) | – |
| `ReheatResult` | interface | [`src/lib/domesticWater.ts:660`](../../src/lib/domesticWater.ts#L660) | – |
| `LegionellaInput` | interface | [`src/lib/domesticWater.ts:773`](../../src/lib/domesticWater.ts#L773) | – |
| `LegionellaAssessment` | interface | [`src/lib/domesticWater.ts:788`](../../src/lib/domesticWater.ts#L788) | – |
| `BranchSegment` | interface | [`src/lib/domesticWater.ts:922`](../../src/lib/domesticWater.ts#L922) | – |
| `BranchContentResult` | interface | [`src/lib/domesticWater.ts:947`](../../src/lib/domesticWater.ts#L947) | – |
| `CirculationAssessment` | interface | [`src/lib/domesticWater.ts:989`](../../src/lib/domesticWater.ts#L989) | – |
| `CirculationInput` | interface | [`src/lib/domesticWater.ts:1042`](../../src/lib/domesticWater.ts#L1042) | – |
| `DomesticWaterInput` | interface | [`src/lib/domesticWater.ts:1196`](../../src/lib/domesticWater.ts#L1196) | – |
| `DomesticWaterResult` | interface | [`src/lib/domesticWater.ts:1235`](../../src/lib/domesticWater.ts#L1235) | `lib/plantBook.ts`, `lib/plantDesign.ts`, `types/bim.ts` |
| `WandKante` | interface | [`src/lib/doppelwaende.ts:34`](../../src/lib/doppelwaende.ts#L34) | `scripts/pruefungen/doppelwaende.ts` |
| `Verschmelzung` | interface | [`src/lib/doppelwaende.ts:45`](../../src/lib/doppelwaende.ts#L45) | – |
| `GewerkesatzId` | type | [`src/lib/ebenen.ts:220`](../../src/lib/ebenen.ts#L220) | `components/PlanPrintDialog.tsx` |
| `Gewerkesatz` | interface | [`src/lib/ebenen.ts:222`](../../src/lib/ebenen.ts#L222) | `store/bimZustand.ts` |
| `Eckart` | type | [`src/lib/eckpunkte.ts:29`](../../src/lib/eckpunkte.ts#L29) | – |
| `Eckpunkt` | interface | [`src/lib/eckpunkte.ts:50`](../../src/lib/eckpunkte.ts#L50) | – |
| `RaviaSummary` | interface | [`src/lib/embedApi.ts:96`](../../src/lib/embedApi.ts#L96) | – |
| `RaviaCadApi` | interface | [`src/lib/embedApi.ts:115`](../../src/lib/embedApi.ts#L115) | `main.tsx` |
| `NetzStand` | interface | [`src/lib/embedApi.ts:226`](../../src/lib/embedApi.ts#L226) | – |
| `Marktwert` | interface | [`src/lib/erzeugerHydraulik.ts:64`](../../src/lib/erzeugerHydraulik.ts#L64) | – |
| `EinbauteilTyp` | interface | [`src/lib/erzeugerHydraulik.ts:652`](../../src/lib/erzeugerHydraulik.ts#L652) | `scripts/pruefungen/erzeugerhydraulik.ts` |
| `FliesswegPosten` | interface | [`src/lib/erzeugerHydraulik.ts:767`](../../src/lib/erzeugerHydraulik.ts#L767) | – |
| `Erzeugerbilanz` | interface | [`src/lib/erzeugerHydraulik.ts:778`](../../src/lib/erzeugerHydraulik.ts#L778) | `lib/auslegungExport.ts`, `lib/pipeReport.ts`, `lib/plantDesign.ts` |
| `BilanzEingabe` | interface | [`src/lib/erzeugerHydraulik.ts:801`](../../src/lib/erzeugerHydraulik.ts#L801) | – |
| `Erzeugervorschlag` | interface | [`src/lib/erzeugerplatz.ts:41`](../../src/lib/erzeugerplatz.ts#L41) | – |
| `ChangeKind` | type | [`src/lib/exportDiff.ts:15`](../../src/lib/exportDiff.ts#L15) | `components/ExportDiffPanel.tsx` |
| `FieldChange` | interface | [`src/lib/exportDiff.ts:17`](../../src/lib/exportDiff.ts#L17) | – |
| `RoomDiff` | interface | [`src/lib/exportDiff.ts:26`](../../src/lib/exportDiff.ts#L26) | `components/ExportDiffPanel.tsx` |
| `ExportDiff` | interface | [`src/lib/exportDiff.ts:34`](../../src/lib/exportDiff.ts#L34) | `components/ExportDiffPanel.tsx` |
| `FloorLoopNote` | interface | [`src/lib/floorLoopLayout.ts:226`](../../src/lib/floorLoopLayout.ts#L226) | – |
| `FloorLoopOptions` | interface | [`src/lib/floorLoopLayout.ts:231`](../../src/lib/floorLoopLayout.ts#L231) | – |
| `FloorCircuit` | interface | [`src/lib/floorLoopLayout.ts:298`](../../src/lib/floorLoopLayout.ts#L298) | `lib/fussbodenkurven.ts` |
| `FloorSupplyLine` | interface | [`src/lib/floorLoopLayout.ts:344`](../../src/lib/floorLoopLayout.ts#L344) | – |
| `FloorLoopCurve` | interface | [`src/lib/floorLoopLayout.ts:354`](../../src/lib/floorLoopLayout.ts#L354) | – |
| `FloorLoopLayout` | interface | [`src/lib/floorLoopLayout.ts:369`](../../src/lib/floorLoopLayout.ts#L369) | `scripts/pruefungen/fussbodenheizung.ts`, `lib/fixtureSymbols.ts`, `lib/fussbodenkurven.ts` |
| `FormteilArt` | type | [`src/lib/formteile.ts:42`](../../src/lib/formteile.ts#L42) | – |
| `Formteil` | interface | [`src/lib/formteile.ts:50`](../../src/lib/formteile.ts#L50) | – |
| `Verlegekurven` | interface | [`src/lib/fussbodenkurven.ts:42`](../../src/lib/fussbodenkurven.ts#L42) | – |
| `Verlegebilanz` | interface | [`src/lib/fussbodenkurven.ts:132`](../../src/lib/fussbodenkurven.ts#L132) | – |
| `Verlegesumme` | interface | [`src/lib/fussbodenkurven.ts:217`](../../src/lib/fussbodenkurven.ts#L217) | – |
| `Verlegelinie` | interface | [`src/lib/fussbodenkurven.ts:263`](../../src/lib/fussbodenkurven.ts#L263) | `components/Viewer3D.tsx` |
| `GeschossNetz` | interface | [`src/lib/gebaeudeNetz.ts:42`](../../src/lib/gebaeudeNetz.ts#L42) | – |
| `Strangabschnitt` | interface | [`src/lib/gebaeudeNetz.ts:52`](../../src/lib/gebaeudeNetz.ts#L52) | – |
| `GebaeudeNetzErgebnis` | interface | [`src/lib/gebaeudeNetz.ts:61`](../../src/lib/gebaeudeNetz.ts#L61) | `components/AnlagenPanel.tsx`, `store/bimZustand.ts` |
| `Geraeteform` | type | [`src/lib/geraeteprofil.ts:49`](../../src/lib/geraeteprofil.ts#L49) | – |
| `Erkennungsgrund` | type | [`src/lib/geraeteprofil.ts:56`](../../src/lib/geraeteprofil.ts#L56) | – |
| `Geraeteprofil` | interface | [`src/lib/geraeteprofil.ts:64`](../../src/lib/geraeteprofil.ts#L64) | `lib/embedApi.ts` |
| `Geraetemerkmale` | interface | [`src/lib/geraeteprofil.ts:76`](../../src/lib/geraeteprofil.ts#L76) | `scripts/pruefungen/geraeteprofil.ts` |
| `GlossaryEntry` | interface | [`src/lib/glossar.ts:19`](../../src/lib/glossar.ts#L19) | – |
| `GriffArt` | type | [`src/lib/griffe.ts:48`](../../src/lib/griffe.ts#L48) | – |
| `Griff` | interface | [`src/lib/griffe.ts:84`](../../src/lib/griffe.ts#L84) | `scripts/pruefungen/griffe.ts`, `components/Viewer3D.tsx` |
| `GriffAenderung` | type | [`src/lib/griffe.ts:117`](../../src/lib/griffe.ts#L117) | `scripts/pruefungen/griffe.ts` |
| `Gleichartige` | interface | [`src/lib/griffe.ts:664`](../../src/lib/griffe.ts#L664) | `scripts/pruefungen/griffe.ts` |
| `Hauseinfuehrung` | interface | [`src/lib/hauseinfuehrung.ts:40`](../../src/lib/hauseinfuehrung.ts#L40) | – |
| `RoomHeatLoad` | interface | [`src/lib/heatLoadEstimate.ts:71`](../../src/lib/heatLoadEstimate.ts#L71) | – |
| `NormHeatLoadCoverage` | interface | [`src/lib/heatLoadEstimate.ts:134`](../../src/lib/heatLoadEstimate.ts#L134) | `lib/plantDesign.ts` |
| `HeatLoadEstimate` | interface | [`src/lib/heatLoadEstimate.ts:163`](../../src/lib/heatLoadEstimate.ts#L163) | `lib/embedApi.ts`, `lib/plantDesign.ts` |
| `AcousticCheck` | interface | [`src/lib/heatPump.ts:134`](../../src/lib/heatPump.ts#L134) | – |
| `AcousticReport` | interface | [`src/lib/heatPump.ts:150`](../../src/lib/heatPump.ts#L150) | – |
| `ProtectionIssue` | interface | [`src/lib/heatPump.ts:321`](../../src/lib/heatPump.ts#L321) | – |
| `ProtectionStatus` | interface | [`src/lib/heatPump.ts:337`](../../src/lib/heatPump.ts#L337) | – |
| `SourceDemand` | interface | [`src/lib/heatPump.ts:505`](../../src/lib/heatPump.ts#L505) | – |
| `Heizflaechenbefund` | interface | [`src/lib/heizflaechenAbgleich.ts:36`](../../src/lib/heizflaechenAbgleich.ts#L36) | `components/PropertiesPanel.tsx` |
| `Normleistung` | interface | [`src/lib/heizflaechenLeistung.ts:51`](../../src/lib/heizflaechenLeistung.ts#L51) | – |
| `Heizkoerperplatz` | interface | [`src/lib/heizkoerperplatz.ts:36`](../../src/lib/heizkoerperplatz.ts#L36) | – |
| `RoomPatch` | interface | [`src/lib/hostPatch.ts:66`](../../src/lib/hostPatch.ts#L66) | `scripts/pruefungen/einbettung.ts` |
| `FixturePatch` | interface | [`src/lib/hostPatch.ts:101`](../../src/lib/hostPatch.ts#L101) | – |
| `ConstructionPatch` | interface | [`src/lib/hostPatch.ts:147`](../../src/lib/hostPatch.ts#L147) | – |
| `ProjectPatch` | interface | [`src/lib/hostPatch.ts:166`](../../src/lib/hostPatch.ts#L166) | – |
| `HostPatch` | interface | [`src/lib/hostPatch.ts:181`](../../src/lib/hostPatch.ts#L181) | `scripts/pruefungen/einbettung.ts`, `lib/embedApi.ts`, `store/bimZustand.ts` |
| `PatchVerdict` | type | [`src/lib/hostPatch.ts:200`](../../src/lib/hostPatch.ts#L200) | – |
| `PatchEntry` | interface | [`src/lib/hostPatch.ts:202`](../../src/lib/hostPatch.ts#L202) | – |
| `HostPatchReport` | interface | [`src/lib/hostPatch.ts:214`](../../src/lib/hostPatch.ts#L214) | `scripts/pruefungen/einbettung.ts`, `scripts/pruefungen/raumkennung.ts`, `lib/embedApi.ts`, `store/bimZustand.ts` |
| `HostPatchResult` | interface | [`src/lib/hostPatch.ts:225`](../../src/lib/hostPatch.ts#L225) | – |
| `CreateRoomRequest` | interface | [`src/lib/hostRaum.ts:24`](../../src/lib/hostRaum.ts#L24) | – |
| `CreateRoomResult` | interface | [`src/lib/hostRaum.ts:33`](../../src/lib/hostRaum.ts#L33) | `lib/embedApi.ts` |
| `RaumVorlageAnlegen` | type | [`src/lib/hostRaum.ts:52`](../../src/lib/hostRaum.ts#L52) | `scripts/pruefungen/hostraum.ts`, `lib/embedApi.ts` |
| `BilanzArt` | type | [`src/lib/huellflaechenbilanz.ts:35`](../../src/lib/huellflaechenbilanz.ts#L35) | – |
| `BilanzRand` | type | [`src/lib/huellflaechenbilanz.ts:38`](../../src/lib/huellflaechenbilanz.ts#L38) | – |
| `BilanzPosten` | interface | [`src/lib/huellflaechenbilanz.ts:40`](../../src/lib/huellflaechenbilanz.ts#L40) | – |
| `Huellflaechenbilanz` | interface | [`src/lib/huellflaechenbilanz.ts:47`](../../src/lib/huellflaechenbilanz.ts#L47) | `types/bim.ts` |
| `BilanzFlaeche` | interface | [`src/lib/huellflaechenbilanz.ts:75`](../../src/lib/huellflaechenbilanz.ts#L75) | `scripts/pruefungen/huellflaeche.ts` |
| `BalanceNote` | interface | [`src/lib/hydraulicBalance.ts:113`](../../src/lib/hydraulicBalance.ts#L113) | – |
| `DimensionMatch` | interface | [`src/lib/hydraulicBalance.ts:129`](../../src/lib/hydraulicBalance.ts#L129) | – |
| `BalanceInput` | interface | [`src/lib/hydraulicBalance.ts:377`](../../src/lib/hydraulicBalance.ts#L377) | – |
| `PresetVerdict` | type | [`src/lib/hydraulicBalance.ts:454`](../../src/lib/hydraulicBalance.ts#L454) | – |
| `SegmentVerdict` | type | [`src/lib/hydraulicBalance.ts:475`](../../src/lib/hydraulicBalance.ts#L475) | – |
| `SegmentSizingCheck` | interface | [`src/lib/hydraulicBalance.ts:478`](../../src/lib/hydraulicBalance.ts#L478) | – |
| `ConsumerBalance` | interface | [`src/lib/hydraulicBalance.ts:508`](../../src/lib/hydraulicBalance.ts#L508) | `lib/pipeReport.ts` |
| `SourceBalance` | interface | [`src/lib/hydraulicBalance.ts:569`](../../src/lib/hydraulicBalance.ts#L569) | – |
| `BalanceReport` | interface | [`src/lib/hydraulicBalance.ts:586`](../../src/lib/hydraulicBalance.ts#L586) | `lib/auslegungExport.ts`, `lib/netzExport.ts`, `lib/pipeReport.ts` |
| `PipeCondition` | type | [`src/lib/hydraulics.ts:277`](../../src/lib/hydraulics.ts#L277) | `lib/hydraulicBalance.ts` |
| `GlycolKind` | type | [`src/lib/hydraulics.ts:332`](../../src/lib/hydraulics.ts#L332) | `lib/primaerkreis.ts`, `lib/safetyFittings.ts` |
| `FluidProperties` | interface | [`src/lib/hydraulics.ts:532`](../../src/lib/hydraulics.ts#L532) | `lib/hydraulicBalance.ts`, `lib/pipeReport.ts` |
| `FlowState` | interface | [`src/lib/hydraulics.ts:890`](../../src/lib/hydraulics.ts#L890) | – |
| `FittingResistance` | interface | [`src/lib/hydraulics.ts:952`](../../src/lib/hydraulics.ts#L952) | – |
| `SizingOptions` | interface | [`src/lib/hydraulics.ts:1072`](../../src/lib/hydraulics.ts#L1072) | – |
| `FittingCount` | interface | [`src/lib/hydraulics.ts:1187`](../../src/lib/hydraulics.ts#L1187) | `lib/hydraulicBalance.ts` |
| `PipeSegmentLoad` | interface | [`src/lib/hydraulics.ts:1196`](../../src/lib/hydraulics.ts#L1196) | `lib/hydraulicBalance.ts` |
| `PipeSegmentResult` | interface | [`src/lib/hydraulics.ts:1218`](../../src/lib/hydraulics.ts#L1218) | `lib/pipeReport.ts` |
| `PipePathLoad` | interface | [`src/lib/hydraulics.ts:1315`](../../src/lib/hydraulics.ts#L1315) | `lib/hydraulicBalance.ts` |
| `PathResult` | interface | [`src/lib/hydraulics.ts:1329`](../../src/lib/hydraulics.ts#L1329) | `lib/hydraulicBalance.ts` |
| `PumpDesign` | interface | [`src/lib/hydraulics.ts:1375`](../../src/lib/hydraulics.ts#L1375) | `lib/hydraulicBalance.ts`, `lib/pipeReport.ts`, `lib/plantDesign.ts` |
| `PumpOptions` | interface | [`src/lib/hydraulics.ts:1440`](../../src/lib/hydraulics.ts#L1440) | – |
| `FloorZone` | type | [`src/lib/hydraulics.ts:1630`](../../src/lib/hydraulics.ts#L1630) | – |
| `FloorHeatingOptions` | interface | [`src/lib/hydraulics.ts:1697`](../../src/lib/hydraulics.ts#L1697) | – |
| `FloorHeatingDesign` | interface | [`src/lib/hydraulics.ts:1740`](../../src/lib/hydraulics.ts#L1740) | `lib/plantDesign.ts` |
| `IfcExportOptions` | interface | [`src/lib/ifcExport.ts:193`](../../src/lib/ifcExport.ts#L193) | – |
| `StepValue` | type | [`src/lib/ifcImport.ts:77`](../../src/lib/ifcImport.ts#L77) | `scripts/verify.ts` |
| `StepRef` | interface | [`src/lib/ifcImport.ts:80`](../../src/lib/ifcImport.ts#L80) | – |
| `StepEntity` | interface | [`src/lib/ifcImport.ts:84`](../../src/lib/ifcImport.ts#L84) | – |
| `ImportedLevel` | interface | [`src/lib/ifcImport.ts:1051`](../../src/lib/ifcImport.ts#L1051) | – |
| `ImportedSpace` | interface | [`src/lib/ifcImport.ts:1078`](../../src/lib/ifcImport.ts#L1078) | – |
| `IfcImportResult` | interface | [`src/lib/ifcImport.ts:1088`](../../src/lib/ifcImport.ts#L1088) | – |
| `GeschossZuordnung` | interface | [`src/lib/importgeschoss.ts:47`](../../src/lib/importgeschoss.ts#L47) | – |
| `GeschossZuordnungPlan` | interface | [`src/lib/importgeschoss.ts:56`](../../src/lib/importgeschoss.ts#L56) | – |
| `Quellenart` | type | [`src/lib/inbetriebnahme.ts:26`](../../src/lib/inbetriebnahme.ts#L26) | `lib/projektMappe.ts` |
| `Uebergabeart` | type | [`src/lib/inbetriebnahme.ts:29`](../../src/lib/inbetriebnahme.ts#L29) | – |
| `Anlagenstand` | interface | [`src/lib/inbetriebnahme.ts:37`](../../src/lib/inbetriebnahme.ts#L37) | – |
| `Einstellwert` | interface | [`src/lib/inbetriebnahme.ts:55`](../../src/lib/inbetriebnahme.ts#L55) | – |
| `Pruefzeile` | interface | [`src/lib/inbetriebnahme.ts:63`](../../src/lib/inbetriebnahme.ts#L63) | – |
| `Inbetriebnahmeblatt` | interface | [`src/lib/inbetriebnahme.ts:69`](../../src/lib/inbetriebnahme.ts#L69) | – |
| `Sicherheitsklasse` | type | [`src/lib/kaeltemittel.ts:50`](../../src/lib/kaeltemittel.ts#L50) | – |
| `Kaeltemittel` | interface | [`src/lib/kaeltemittel.ts:58`](../../src/lib/kaeltemittel.ts#L58) | – |
| `Dichtheitspflicht` | interface | [`src/lib/kaeltemittel.ts:146`](../../src/lib/kaeltemittel.ts#L146) | – |
| `KompassTeil` | type | [`src/lib/kompass.ts:68`](../../src/lib/kompass.ts#L68) | – |
| `NullLeitung` | interface | [`src/lib/leitungsbefund.ts:56`](../../src/lib/leitungsbefund.ts#L56) | – |
| `DoppelLeitung` | interface | [`src/lib/leitungsbefund.ts:69`](../../src/lib/leitungsbefund.ts#L69) | – |
| `LevelCopySkipReason` | type | [`src/lib/levelCopy.ts:38`](../../src/lib/levelCopy.ts#L38) | – |
| `LevelCopySkip` | interface | [`src/lib/levelCopy.ts:52`](../../src/lib/levelCopy.ts#L52) | – |
| `LevelCopyInput` | interface | [`src/lib/levelCopy.ts:58`](../../src/lib/levelCopy.ts#L58) | – |
| `LevelCopyResult` | interface | [`src/lib/levelCopy.ts:79`](../../src/lib/levelCopy.ts#L79) | – |
| `LueckenSchluss` | type | [`src/lib/luecken.ts:40`](../../src/lib/luecken.ts#L40) | `components/AufmassPanel.tsx`, `components/KorrekturDialog.tsx`, `lib/autokorrektur.ts`, `store/bimZustand.ts` |
| `Luecke` | interface | [`src/lib/luecken.ts:42`](../../src/lib/luecken.ts#L42) | `lib/autokorrektur.ts` |
| `Satzmass` | interface | [`src/lib/mappenUmbruch.ts:39`](../../src/lib/mappenUmbruch.ts#L39) | – |
| `Umbruchmass` | interface | [`src/lib/mappenUmbruch.ts:307`](../../src/lib/mappenUmbruch.ts#L307) | – |
| `MaterialTrade` | type | [`src/lib/materialSchedule.ts:91`](../../src/lib/materialSchedule.ts#L91) | `scripts/pruefungen/massenauszug.ts` |
| `MaterialUnit` | type | [`src/lib/materialSchedule.ts:134`](../../src/lib/materialSchedule.ts#L134) | `scripts/pruefungen/massenauszug.ts` |
| `MaterialItem` | interface | [`src/lib/materialSchedule.ts:150`](../../src/lib/materialSchedule.ts#L150) | `scripts/pruefungen/massenauszug.ts`, `lib/projektMappe.ts` |
| `MaterialGroup` | interface | [`src/lib/materialSchedule.ts:169`](../../src/lib/materialSchedule.ts#L169) | – |
| `MaterialNote` | type | [`src/lib/materialSchedule.ts:181`](../../src/lib/materialSchedule.ts#L181) | – |
| `MaterialSchedule` | interface | [`src/lib/materialSchedule.ts:183`](../../src/lib/materialSchedule.ts#L183) | `scripts/pruefungen/leitungsbefund.ts`, `scripts/pruefungen/massenauszug.ts` |
| `KnotenArt` | type | [`src/lib/netzExport.ts:50`](../../src/lib/netzExport.ts#L50) | – |
| `NetzKnoten` | interface | [`src/lib/netzExport.ts:52`](../../src/lib/netzExport.ts#L52) | – |
| `NetzAbschnitt` | interface | [`src/lib/netzExport.ts:61`](../../src/lib/netzExport.ts#L61) | – |
| `WegKennzahlen` | interface | [`src/lib/netzExport.ts:111`](../../src/lib/netzExport.ts#L111) | – |
| `NetzFlaechenkreis` | interface | [`src/lib/netzExport.ts:126`](../../src/lib/netzExport.ts#L126) | – |
| `NetzEinzelkreis` | interface | [`src/lib/netzExport.ts:185`](../../src/lib/netzExport.ts#L185) | – |
| `NetzExport` | interface | [`src/lib/netzExport.ts:206`](../../src/lib/netzExport.ts#L206) | `types/bim.ts` |
| `EinheitArt` | type | [`src/lib/nutzungseinheiten.ts:33`](../../src/lib/nutzungseinheiten.ts#L33) | `scripts/pruefungen/nutzungseinheiten.ts`, `components/AnlagenPanel.tsx`, `components/PropertiesPanel.tsx`, `store/bimZustand.ts`, `store/slices/laden.ts` |
| `Nutzungseinheit` | interface | [`src/lib/nutzungseinheiten.ts:47`](../../src/lib/nutzungseinheiten.ts#L47) | `store/slices/einheiten.ts`, `store/slices/laden.ts`, `types/bim.ts` |
| `Einheitsbilanz` | interface | [`src/lib/nutzungseinheiten.ts:57`](../../src/lib/nutzungseinheiten.ts#L57) | – |
| `Einheitenstand` | interface | [`src/lib/nutzungseinheiten.ts:156`](../../src/lib/nutzungseinheiten.ts#L156) | – |
| `Daemmzustand` | type | [`src/lib/objektaufnahme.ts:33`](../../src/lib/objektaufnahme.ts#L33) | `components/GuidePanel.tsx` |
| `BestandsheizungArt` | type | [`src/lib/objektaufnahme.ts:43`](../../src/lib/objektaufnahme.ts#L43) | `components/GuidePanel.tsx` |
| `WarmwasserBestand` | type | [`src/lib/objektaufnahme.ts:67`](../../src/lib/objektaufnahme.ts#L67) | `components/GuidePanel.tsx` |
| `Objektaufnahme` | interface | [`src/lib/objektaufnahme.ts:90`](../../src/lib/objektaufnahme.ts#L90) | `store/bimZustand.ts`, `types/bim.ts` |
| `Aufnahmezeile` | interface | [`src/lib/objektaufnahme.ts:119`](../../src/lib/objektaufnahme.ts#L119) | `lib/projektMappe.ts` |
| `Aufnahmegruppe` | interface | [`src/lib/objektaufnahme.ts:137`](../../src/lib/objektaufnahme.ts#L137) | – |
| `Aufnahmestand` | interface | [`src/lib/objektaufnahme.ts:142`](../../src/lib/objektaufnahme.ts#L142) | – |
| `SymbolWeight` | type | [`src/lib/openingSymbols.ts:26`](../../src/lib/openingSymbols.ts#L26) | – |
| `SymbolRole` | type | [`src/lib/openingSymbols.ts:29`](../../src/lib/openingSymbols.ts#L29) | – |
| `SymbolPart` | type | [`src/lib/openingSymbols.ts:31`](../../src/lib/openingSymbols.ts#L31) | `components/Editor2D.tsx`, `lib/planPrint.ts` |
| `AccessoryPart` | type | [`src/lib/pipeAccessorySymbols.ts:16`](../../src/lib/pipeAccessorySymbols.ts#L16) | `lib/planPrint.ts` |
| `PlanningNote` | type | [`src/lib/pipeInsulation.ts:52`](../../src/lib/pipeInsulation.ts#L52) | `scripts/pruefungen/rohrdaemmung.ts` |
| `InsulationInput` | interface | [`src/lib/pipeInsulation.ts:98`](../../src/lib/pipeInsulation.ts#L98) | `scripts/pruefungen/rohrdaemmung.ts` |
| `InsulationResult` | interface | [`src/lib/pipeInsulation.ts:141`](../../src/lib/pipeInsulation.ts#L141) | `scripts/pruefungen/rohrdaemmung.ts` |
| `PipeLayoutOptions` | interface | [`src/lib/pipeLayout.ts:119`](../../src/lib/pipeLayout.ts#L119) | `lib/gebaeudeNetz.ts` |
| `PipeLayoutResult` | interface | [`src/lib/pipeLayout.ts:365`](../../src/lib/pipeLayout.ts#L365) | `lib/gebaeudeNetz.ts` |
| `TeilstreckenZeile` | interface | [`src/lib/pipeReport.ts:91`](../../src/lib/pipeReport.ts#L91) | `lib/pipeReportPrint.ts` |
| `StrangZeile` | interface | [`src/lib/pipeReport.ts:132`](../../src/lib/pipeReport.ts#L132) | – |
| `HeizflaechenZeile` | interface | [`src/lib/pipeReport.ts:165`](../../src/lib/pipeReport.ts#L165) | – |
| `NachweisPunkt` | interface | [`src/lib/pipeReport.ts:196`](../../src/lib/pipeReport.ts#L196) | – |
| `RohrnetzBericht` | interface | [`src/lib/pipeReport.ts:207`](../../src/lib/pipeReport.ts#L207) | `lib/pipeReportPrint.ts`, `lib/projektMappe.ts` |
| `RohrnetzOptionen` | interface | [`src/lib/pipeReport.ts:264`](../../src/lib/pipeReport.ts#L264) | – |
| `RohrnetzDruckOptionen` | interface | [`src/lib/pipeReportPrint.ts:313`](../../src/lib/pipeReportPrint.ts#L313) | – |
| `RohrnetzDruckErgebnis` | interface | [`src/lib/pipeReportPrint.ts:338`](../../src/lib/pipeReportPrint.ts#L338) | – |
| `PlanningNote` | type | [`src/lib/pipeRouting.ts:98`](../../src/lib/pipeRouting.ts#L98) | `lib/gebaeudeNetz.ts`, `lib/pipeLayout.ts` |
| `RoutingRequest` | interface | [`src/lib/pipeRouting.ts:100`](../../src/lib/pipeRouting.ts#L100) | – |
| `RoutedLeg` | interface | [`src/lib/pipeRouting.ts:125`](../../src/lib/pipeRouting.ts#L125) | – |
| `RoutedNetwork` | interface | [`src/lib/pipeRouting.ts:137`](../../src/lib/pipeRouting.ts#L137) | `lib/pipeLayout.ts` |
| `Loeschposten` | interface | [`src/lib/planLeeren.ts:41`](../../src/lib/planLeeren.ts#L41) | `store/bimZustand.ts` |
| `PaperFormat` | type | [`src/lib/planPrint.ts:168`](../../src/lib/planPrint.ts#L168) | `components/PlanPrintDialog.tsx`, `components/RohrnetzDialog.tsx`, `lib/pipeReportPrint.ts` |
| `PaperOrientation` | type | [`src/lib/planPrint.ts:169`](../../src/lib/planPrint.ts#L169) | `components/PlanPrintDialog.tsx`, `lib/pipeReportPrint.ts` |
| `PlanPrintOptions` | interface | [`src/lib/planPrint.ts:171`](../../src/lib/planPrint.ts#L171) | `scripts/pruefungen/beschriftungslage.ts` |
| `PlanFitResult` | interface | [`src/lib/planPrint.ts:214`](../../src/lib/planPrint.ts#L214) | – |
| `PlantBookPaperFormat` | type | [`src/lib/plantBook.ts:64`](../../src/lib/plantBook.ts#L64) | – |
| `PlantBookChapterId` | type | [`src/lib/plantBook.ts:67`](../../src/lib/plantBook.ts#L67) | `scripts/pruefungen/anlagenbuch.ts` |
| `PlantBookChapter` | interface | [`src/lib/plantBook.ts:86`](../../src/lib/plantBook.ts#L86) | `scripts/pruefungen/anlagenbuch.ts` |
| `PlantBookOptions` | interface | [`src/lib/plantBook.ts:101`](../../src/lib/plantBook.ts#L101) | – |
| `PlantBookResult` | interface | [`src/lib/plantBook.ts:153`](../../src/lib/plantBook.ts#L153) | – |
| `PlanningNote` | type | [`src/lib/plantDesign.ts:106`](../../src/lib/plantDesign.ts#L106) | `lib/plantBook.ts` |
| `RoomLoopDesign` | interface | [`src/lib/plantDesign.ts:116`](../../src/lib/plantDesign.ts#L116) | `lib/materialSchedule.ts` |
| `CircuitDesign` | interface | [`src/lib/plantDesign.ts:147`](../../src/lib/plantDesign.ts#L147) | `scripts/pruefungen/massenauszug.ts`, `scripts/pruefungen/schemapruefung.ts`, `scripts/pruefungen/schemavorschlag.ts`, `components/AnlagenPanel.tsx`, `lib/materialSchedule.ts` (+1) |
| `PlantDesignOptions` | interface | [`src/lib/plantDesign.ts:185`](../../src/lib/plantDesign.ts#L185) | `scripts/pruefungen/anlagenschema.ts` |
| `PlantDesignResult` | interface | [`src/lib/plantDesign.ts:196`](../../src/lib/plantDesign.ts#L196) | `scripts/pruefungen/anlagenbuch.ts`, `scripts/pruefungen/schemapruefung.ts`, `scripts/pruefungen/schemavorschlag.ts`, `lib/materialSchedule.ts`, `lib/pipeReport.ts` (+4) |
| `Primaerauslegung` | interface | [`src/lib/primaerkreis.ts:67`](../../src/lib/primaerkreis.ts#L67) | – |
| `SpeicherAdapter` | interface | [`src/lib/projectStore.ts:83`](../../src/lib/projectStore.ts#L83) | `scripts/pruefungen/projekte.ts` |
| `Vorschau` | interface | [`src/lib/projectStore.ts:125`](../../src/lib/projectStore.ts#L125) | `components/ProjektDialog.tsx` |
| `ProjektUmfang` | interface | [`src/lib/projectStore.ts:132`](../../src/lib/projectStore.ts#L132) | – |
| `ProjektKopf` | interface | [`src/lib/projectStore.ts:141`](../../src/lib/projectStore.ts#L141) | `components/ProjektDialog.tsx` |
| `Schreibfehler` | type | [`src/lib/projectStore.ts:155`](../../src/lib/projectStore.ts#L155) | – |
| `Fehlschlag` | interface | [`src/lib/projectStore.ts:157`](../../src/lib/projectStore.ts#L157) | `lib/autosave.ts` |
| `Ergebnis` | type | [`src/lib/projectStore.ts:164`](../../src/lib/projectStore.ts#L164) | – |
| `SpeicherBericht` | interface | [`src/lib/projectStore.ts:166`](../../src/lib/projectStore.ts#L166) | `components/ProjektDialog.tsx` |
| `MappeFormat` | type | [`src/lib/projektMappe.ts:71`](../../src/lib/projektMappe.ts#L71) | `components/MappeDialog.tsx` |
| `MappeKapitelId` | type | [`src/lib/projektMappe.ts:74`](../../src/lib/projektMappe.ts#L74) | `scripts/pruefungen/projektmappe.ts` |
| `MappeBlatt` | interface | [`src/lib/projektMappe.ts:99`](../../src/lib/projektMappe.ts#L99) | – |
| `MappeKapitel` | interface | [`src/lib/projektMappe.ts:115`](../../src/lib/projektMappe.ts#L115) | – |
| `ProjektMappeOptionen` | interface | [`src/lib/projektMappe.ts:130`](../../src/lib/projektMappe.ts#L130) | – |
| `ProjektMappe` | interface | [`src/lib/projektMappe.ts:161`](../../src/lib/projektMappe.ts#L161) | – |
| `GespeicherterRaum` | interface | [`src/lib/raumZuordnung.ts:48`](../../src/lib/raumZuordnung.ts#L48) | – |
| `BenannterRaum` | interface | [`src/lib/raumnutzung.ts:167`](../../src/lib/raumnutzung.ts#L167) | – |
| `ErkannterRaum` | interface | [`src/lib/raumnutzung.ts:175`](../../src/lib/raumnutzung.ts#L175) | – |
| `Raumzuordnung` | interface | [`src/lib/raumnutzung.ts:182`](../../src/lib/raumnutzung.ts#L182) | – |
| `RaumplanGeschoss` | interface | [`src/lib/raumplanImport.ts:125`](../../src/lib/raumplanImport.ts#L125) | `lib/buildingModelImport.ts` |
| `RaumHinweis` | interface | [`src/lib/raumplanImport.ts:138`](../../src/lib/raumplanImport.ts#L138) | `lib/buildingModelImport.ts`, `lib/scanUebernahme.ts` |
| `Annahme` | interface | [`src/lib/raumplanImport.ts:157`](../../src/lib/raumplanImport.ts#L157) | `lib/buildingModelImport.ts` |
| `RaumplanImportErgebnis` | interface | [`src/lib/raumplanImport.ts:163`](../../src/lib/raumplanImport.ts#L163) | `lib/buildingModelImport.ts`, `store/bimZustand.ts` |
| `Trefferart` | type | [`src/lib/raumtreffer.ts:30`](../../src/lib/raumtreffer.ts#L30) | – |
| `Raumtreffer` | interface | [`src/lib/raumtreffer.ts:32`](../../src/lib/raumtreffer.ts#L32) | – |
| `StichErgebnis` | interface | [`src/lib/ringStich.ts:67`](../../src/lib/ringStich.ts#L67) | – |
| `RingVerbraucher` | interface | [`src/lib/ringleitung.ts:67`](../../src/lib/ringleitung.ts#L67) | – |
| `RingAnschluss` | interface | [`src/lib/ringleitung.ts:73`](../../src/lib/ringleitung.ts#L73) | – |
| `RingAbschnitt` | interface | [`src/lib/ringleitung.ts:93`](../../src/lib/ringleitung.ts#L93) | – |
| `RingPlan` | interface | [`src/lib/ringleitung.ts:100`](../../src/lib/ringleitung.ts#L100) | – |
| `RingErgebnis` | type | [`src/lib/ringleitung.ts:118`](../../src/lib/ringleitung.ts#L118) | – |
| `RohrAnteil` | interface | [`src/lib/rohrImRaum.ts:54`](../../src/lib/rohrImRaum.ts#L54) | `lib/raumExport.ts` |
| `Rohrangabe` | interface | [`src/lib/rohrbezeichnung.ts:60`](../../src/lib/rohrbezeichnung.ts#L60) | – |
| `RoofFrame` | interface | [`src/lib/roofGeometry.ts:337`](../../src/lib/roofGeometry.ts#L337) | `scripts/pruefungen/dachschnitt.ts`, `components/Editor2D.tsx`, `lib/dachlandschaft.ts`, `lib/dachschnitt.ts`, `lib/roomDetection.ts` (+1) |
| `WallRoofProfile` | interface | [`src/lib/roofGeometry.ts:1133`](../../src/lib/roofGeometry.ts#L1133) | – |
| `GradeSplit` | interface | [`src/lib/roomDetection.ts:91`](../../src/lib/roomDetection.ts#L91) | – |
| `DetectRoomsInput` | interface | [`src/lib/roomDetection.ts:786`](../../src/lib/roomDetection.ts#L786) | – |
| `DiagnoseClosureInput` | interface | [`src/lib/roomDetection.ts:1703`](../../src/lib/roomDetection.ts#L1703) | – |
| `RoomTemplateKind` | type | [`src/lib/roomTemplates.ts:24`](../../src/lib/roomTemplates.ts#L24) | `store/bimZustand.ts` |
| `RoomTemplate` | interface | [`src/lib/roomTemplates.ts:34`](../../src/lib/roomTemplates.ts#L34) | – |
| `TemplateOptions` | interface | [`src/lib/roomTemplates.ts:96`](../../src/lib/roomTemplates.ts#L96) | `store/bimZustand.ts` |
| `RoomSizePreset` | interface | [`src/lib/roomTemplates.ts:285`](../../src/lib/roomTemplates.ts#L285) | – |
| `GlycolProperties` | interface | [`src/lib/safetyFittings.ts:77`](../../src/lib/safetyFittings.ts#L77) | – |
| `GlycolMixture` | interface | [`src/lib/safetyFittings.ts:202`](../../src/lib/safetyFittings.ts#L202) | – |
| `VesselInput` | interface | [`src/lib/safetyFittings.ts:357`](../../src/lib/safetyFittings.ts#L357) | – |
| `VesselDesign` | interface | [`src/lib/safetyFittings.ts:387`](../../src/lib/safetyFittings.ts#L387) | – |
| `SafetyValveRow` | interface | [`src/lib/safetyFittings.ts:600`](../../src/lib/safetyFittings.ts#L600) | – |
| `SystemVolumeInput` | interface | [`src/lib/safetyFittings.ts:719`](../../src/lib/safetyFittings.ts#L719) | `lib/plantDesign.ts` |
| `SystemVolumeResult` | interface | [`src/lib/safetyFittings.ts:740`](../../src/lib/safetyFittings.ts#L740) | – |
| `SafetyDesignInput` | interface | [`src/lib/safetyFittings.ts:798`](../../src/lib/safetyFittings.ts#L798) | – |
| `ScanStatus` | type | [`src/lib/scanDienst.ts:60`](../../src/lib/scanDienst.ts#L60) | `components/ScanDialog.tsx` |
| `ScanSitzung` | interface | [`src/lib/scanDienst.ts:64`](../../src/lib/scanDienst.ts#L64) | – |
| `ScanStand` | interface | [`src/lib/scanDienst.ts:73`](../../src/lib/scanDienst.ts#L73) | – |
| `ScanGebaeude` | interface | [`src/lib/scanDienst.ts:80`](../../src/lib/scanDienst.ts#L80) | – |
| `FetchFn` | type | [`src/lib/scanDienst.ts:86`](../../src/lib/scanDienst.ts#L86) | `scripts/pruefungen/scandienst.ts` |
| `ScanDienstFehler` | class | [`src/lib/scanDienst.ts:89`](../../src/lib/scanDienst.ts#L89) | `scripts/pruefungen/scandienst.ts`, `components/ScanDialog.tsx` |
| `Ablage` | interface | [`src/lib/scanDienst.ts:213`](../../src/lib/scanDienst.ts#L213) | `scripts/pruefungen/scandienst.ts`, `components/ScanDialog.tsx` |
| `Schritt` | type | [`src/lib/scanDienst.ts:424`](../../src/lib/scanDienst.ts#L424) | – |
| `ScanDachZuordnung` | interface | [`src/lib/scanUebernahme.ts:30`](../../src/lib/scanUebernahme.ts#L30) | `store/slices/laden.ts` |
| `AnlagenMerkmale` | interface | [`src/lib/schemaAuswahl.ts:45`](../../src/lib/schemaAuswahl.ts#L45) | `scripts/pruefungen/schemavorschlag.ts` |
| `Passung` | type | [`src/lib/schemaAuswahl.ts:191`](../../src/lib/schemaAuswahl.ts#L191) | `scripts/pruefungen/schemavorschlag.ts`, `lib/schemaZuordnung.ts` |
| `Abweichung` | interface | [`src/lib/schemaAuswahl.ts:199`](../../src/lib/schemaAuswahl.ts#L199) | `lib/schemaZuordnung.ts` |
| `SchemaVorschlag` | interface | [`src/lib/schemaAuswahl.ts:210`](../../src/lib/schemaAuswahl.ts#L210) | `scripts/pruefungen/schemavorschlag.ts` |
| `AuswahlErgebnis` | interface | [`src/lib/schemaAuswahl.ts:472`](../../src/lib/schemaAuswahl.ts#L472) | – |
| `SchemaBeschriftungsart` | type | [`src/lib/schemaBeschriftung.ts:53`](../../src/lib/schemaBeschriftung.ts#L53) | `components/SchemaView.tsx`, `lib/schematicPrint.ts` |
| `Beschriftungsbauteil` | interface | [`src/lib/schemaBeschriftung.ts:56`](../../src/lib/schemaBeschriftung.ts#L56) | – |
| `Positionsoptionen` | interface | [`src/lib/schemaBeschriftung.ts:68`](../../src/lib/schemaBeschriftung.ts#L68) | – |
| `Positionslage` | interface | [`src/lib/schemaBeschriftung.ts:94`](../../src/lib/schemaBeschriftung.ts#L94) | – |
| `Positionsergebnis` | interface | [`src/lib/schemaBeschriftung.ts:115`](../../src/lib/schemaBeschriftung.ts#L115) | – |
| `Anbindung` | type | [`src/lib/schemaKatalog.ts:100`](../../src/lib/schemaKatalog.ts#L100) | `scripts/pruefungen/schemavorschlag.ts`, `lib/schemaAuswahl.ts` |
| `Trinkwasserart` | type | [`src/lib/schemaKatalog.ts:103`](../../src/lib/schemaKatalog.ts#L103) | `lib/schemaAuswahl.ts` |
| `SchemaMerkmale` | interface | [`src/lib/schemaKatalog.ts:106`](../../src/lib/schemaKatalog.ts#L106) | – |
| `SchemaBedingung` | interface | [`src/lib/schemaKatalog.ts:134`](../../src/lib/schemaKatalog.ts#L134) | – |
| `SchemaBauteil` | interface | [`src/lib/schemaKatalog.ts:145`](../../src/lib/schemaKatalog.ts#L145) | – |
| `SchemaVorlage` | interface | [`src/lib/schemaKatalog.ts:155`](../../src/lib/schemaKatalog.ts#L155) | `scripts/pruefungen/schemavorschlag.ts`, `lib/schemaAuswahl.ts`, `lib/schemaZuordnung.ts` |
| `LeitungsEnde` | interface | [`src/lib/schemaLeitung.ts:24`](../../src/lib/schemaLeitung.ts#L24) | – |
| `Leitungsverlauf` | interface | [`src/lib/schemaLeitung.ts:41`](../../src/lib/schemaLeitung.ts#L41) | – |
| `SchemaBefundGrad` | type | [`src/lib/schemaPruefung.ts:68`](../../src/lib/schemaPruefung.ts#L68) | – |
| `SchemaBefund` | interface | [`src/lib/schemaPruefung.ts:70`](../../src/lib/schemaPruefung.ts#L70) | `scripts/pruefungen/schemapruefung.ts`, `components/AnlagenPanel.tsx` |
| `SchemaPruefEingabe` | interface | [`src/lib/schemaPruefung.ts:95`](../../src/lib/schemaPruefung.ts#L95) | – |
| `UebersichtZone` | type | [`src/lib/schemaUebersicht.ts:56`](../../src/lib/schemaUebersicht.ts#L56) | – |
| `UebersichtBauteil` | interface | [`src/lib/schemaUebersicht.ts:59`](../../src/lib/schemaUebersicht.ts#L59) | `lib/uebersichtZeichnen.ts` |
| `UebersichtGruppe` | interface | [`src/lib/schemaUebersicht.ts:76`](../../src/lib/schemaUebersicht.ts#L76) | – |
| `UebersichtLeitung` | interface | [`src/lib/schemaUebersicht.ts:83`](../../src/lib/schemaUebersicht.ts#L83) | – |
| `UebersichtWeglassung` | interface | [`src/lib/schemaUebersicht.ts:93`](../../src/lib/schemaUebersicht.ts#L93) | – |
| `Uebersichtsschema` | interface | [`src/lib/schemaUebersicht.ts:109`](../../src/lib/schemaUebersicht.ts#L109) | `scripts/pruefungen/uebersichtsschema.ts`, `lib/uebersichtZeichnen.ts` |
| `Zuordnung` | interface | [`src/lib/schemaZuordnung.ts:35`](../../src/lib/schemaZuordnung.ts#L35) | – |
| `SvgRecorder` | class | [`src/lib/schematicPrint.ts:139`](../../src/lib/schematicPrint.ts#L139) | `scripts/handbuch-symbole.ts` |
| `SchematicPaperFormat` | type | [`src/lib/schematicPrint.ts:477`](../../src/lib/schematicPrint.ts#L477) | `components/SchemaView.tsx` |
| `SchematicOrientation` | type | [`src/lib/schematicPrint.ts:478`](../../src/lib/schematicPrint.ts#L478) | `components/SchemaView.tsx` |
| `SchematicPrintOptions` | interface | [`src/lib/schematicPrint.ts:626`](../../src/lib/schematicPrint.ts#L626) | `scripts/pruefungen/schemabeschriftung.ts` |
| `SchematicPrintResult` | interface | [`src/lib/schematicPrint.ts:663`](../../src/lib/schematicPrint.ts#L663) | – |
| `SchematicFitResult` | interface | [`src/lib/schematicPrint.ts:690`](../../src/lib/schematicPrint.ts#L690) | – |
| `ComponentTableRow` | interface | [`src/lib/schematicPrint.ts:700`](../../src/lib/schematicPrint.ts#L700) | `lib/materialSchedule.ts` |
| `PortSide` | type | [`src/lib/schematicSymbols.ts:60`](../../src/lib/schematicSymbols.ts#L60) | – |
| `SymbolPort` | interface | [`src/lib/schematicSymbols.ts:70`](../../src/lib/schematicSymbols.ts#L70) | – |
| `SymbolPorts` | type | [`src/lib/schematicSymbols.ts:81`](../../src/lib/schematicSymbols.ts#L81) | – |
| `SymbolLegendEntry` | interface | [`src/lib/schematicSymbols.ts:84`](../../src/lib/schematicSymbols.ts#L84) | – |
| `SymbolOptions` | interface | [`src/lib/schematicSymbols.ts:93`](../../src/lib/schematicSymbols.ts#L93) | – |
| `PumpOverlay` | interface | [`src/lib/siteSymbols.ts:297`](../../src/lib/siteSymbols.ts#L297) | – |
| `Skizzenstrecke` | interface | [`src/lib/skizze.ts:105`](../../src/lib/skizze.ts#L105) | – |
| `Skizzenergebnis` | interface | [`src/lib/skizze.ts:114`](../../src/lib/skizze.ts#L114) | – |
| `StiftfarbeId` | type | [`src/lib/skizzenseite.ts:50`](../../src/lib/skizzenseite.ts#L50) | `components/SkizzenSeite.tsx`, `store/bimZustand.ts` |
| `Strich` | interface | [`src/lib/skizzenseite.ts:52`](../../src/lib/skizzenseite.ts#L52) | `store/slices/skizze.ts` |
| `Massstab` | interface | [`src/lib/skizzenseite.ts:71`](../../src/lib/skizzenseite.ts#L71) | `store/bimZustand.ts` |
| `Skizzenseite` | interface | [`src/lib/skizzenseite.ts:79`](../../src/lib/skizzenseite.ts#L79) | `scripts/pruefungen/skizzenseite.ts`, `types/bim.ts` |
| `SlabPlan` | interface | [`src/lib/slabGeometry.ts:45`](../../src/lib/slabGeometry.ts#L45) | `scripts/pruefungen/geschossdecken.ts`, `scripts/pruefungen/treppenlogik.ts`, `components/Viewer3D.tsx` |
| `SlabInput` | interface | [`src/lib/slabGeometry.ts:129`](../../src/lib/slabGeometry.ts#L129) | – |
| `SpiegelAchse` | type | [`src/lib/spiegeln.ts:74`](../../src/lib/spiegeln.ts#L74) | `store/bimZustand.ts` |
| `SpiegelAuftrag` | interface | [`src/lib/spiegeln.ts:76`](../../src/lib/spiegeln.ts#L76) | – |
| `SpiegelErgebnis` | interface | [`src/lib/spiegeln.ts:94`](../../src/lib/spiegeln.ts#L94) | – |
| `Sprache` | type | [`src/lib/sprache.ts:67`](../../src/lib/sprache.ts#L67) | `scripts/pruefungen/sprache.ts`, `components/Flaggen.tsx`, `lib/sprachen/katalog.ts`, `store/bimZustand.ts`, `store/slices/ui.ts` |
| `Sprachangabe` | interface | [`src/lib/sprache.ts:87`](../../src/lib/sprache.ts#L87) | – |
| `Katalog` | type | [`src/lib/sprachen/katalog.ts:27`](../../src/lib/sprachen/katalog.ts#L27) | – |
| `SteigGrund` | type | [`src/lib/steigstrang.ts:57`](../../src/lib/steigstrang.ts#L57) | `lib/gebaeudeNetz.ts` |
| `Steigpunkt` | interface | [`src/lib/steigstrang.ts:59`](../../src/lib/steigstrang.ts#L59) | – |
| `SteigErgebnis` | interface | [`src/lib/steigstrang.ts:165`](../../src/lib/steigstrang.ts#L165) | – |
| `Heizflaechenart` | type | [`src/lib/systemtemperatur.ts:64`](../../src/lib/systemtemperatur.ts#L64) | `lib/plantDesign.ts` |
| `Auslegungstemperatur` | interface | [`src/lib/systemtemperatur.ts:67`](../../src/lib/systemtemperatur.ts#L67) | `scripts/pruefungen/wandquerung.ts`, `lib/plantDesign.ts` |
| `Temperaturherkunft` | type | [`src/lib/systemtemperatur.ts:241`](../../src/lib/systemtemperatur.ts#L241) | `components/AnlagenPanel.tsx`, `lib/pipeReport.ts` |
| `Systemtemperatur` | interface | [`src/lib/systemtemperatur.ts:250`](../../src/lib/systemtemperatur.ts#L250) | `lib/pipeReport.ts`, `lib/plantDesign.ts` |
| `Kreistemperatur` | interface | [`src/lib/systemtemperatur.ts:259`](../../src/lib/systemtemperatur.ts#L259) | – |
| `SystemtemperaturEingabe` | interface | [`src/lib/systemtemperatur.ts:263`](../../src/lib/systemtemperatur.ts#L263) | – |
| `BridgeTypeInfo` | interface | [`src/lib/thermalBridges.ts:49`](../../src/lib/thermalBridges.ts#L49) | – |
| `BridgeComparison` | interface | [`src/lib/thermalBridges.ts:375`](../../src/lib/thermalBridges.ts#L375) | – |
| `Treppenbefund` | interface | [`src/lib/treppenlogik.ts:92`](../../src/lib/treppenlogik.ts#L92) | – |
| `Treppenmasse` | interface | [`src/lib/treppenlogik.ts:97`](../../src/lib/treppenlogik.ts#L97) | – |
| `Tuerseite` | type | [`src/lib/tuerseiten.ts:81`](../../src/lib/tuerseiten.ts#L81) | – |
| `Tueranschlag` | interface | [`src/lib/tuerseiten.ts:86`](../../src/lib/tuerseiten.ts#L86) | – |
| `UebersichtMasse` | interface | [`src/lib/uebersichtZeichnen.ts:26`](../../src/lib/uebersichtZeichnen.ts#L26) | – |
| `UebersichtFarben` | interface | [`src/lib/uebersichtZeichnen.ts:33`](../../src/lib/uebersichtZeichnen.ts#L33) | – |
| `UiModus` | type | [`src/lib/uimodus.ts:29`](../../src/lib/uimodus.ts#L29) | `scripts/pruefungen/uimodus.ts`, `App.tsx`, `components/Toolbar.tsx`, `store/bimZustand.ts`, `store/useBimStore.ts` |
| `UWertHerkunft` | type | [`src/lib/uwert.ts:65`](../../src/lib/uwert.ts#L65) | – |
| `UWertAuskunft` | interface | [`src/lib/uwert.ts:68`](../../src/lib/uwert.ts#L68) | `components/PropertiesPanel.tsx`, `lib/materialSchedule.ts`, `lib/raumExport.ts` |
| `WandArtig` | interface | [`src/lib/uwert.ts:187`](../../src/lib/uwert.ts#L187) | – |
| `OeffnungArtig` | interface | [`src/lib/uwert.ts:210`](../../src/lib/uwert.ts#L210) | – |
| `ValveRole` | type | [`src/lib/valveCatalog.ts:79`](../../src/lib/valveCatalog.ts#L79) | – |
| `ValveStep` | interface | [`src/lib/valveCatalog.ts:88`](../../src/lib/valveCatalog.ts#L88) | – |
| `ValveModel` | interface | [`src/lib/valveCatalog.ts:96`](../../src/lib/valveCatalog.ts#L96) | – |
| `PresetFit` | type | [`src/lib/valveCatalog.ts:330`](../../src/lib/valveCatalog.ts#L330) | – |
| `PresetSelection` | interface | [`src/lib/valveCatalog.ts:338`](../../src/lib/valveCatalog.ts#L338) | `lib/hydraulicBalance.ts` |
| `VerbraucherlastQuelle` | type | [`src/lib/verbraucherlast.ts:36`](../../src/lib/verbraucherlast.ts#L36) | – |
| `Verbraucherlast` | interface | [`src/lib/verbraucherlast.ts:38`](../../src/lib/verbraucherlast.ts#L38) | `lib/pipeLayout.ts` |
| `Baualtersklasse` | interface | [`src/lib/verbrauchsabgleich.ts:114`](../../src/lib/verbrauchsabgleich.ts#L114) | – |
| `Gegenprobe` | interface | [`src/lib/verbrauchsabgleich.ts:137`](../../src/lib/verbrauchsabgleich.ts#L137) | – |
| `Urteil` | type | [`src/lib/verbrauchsabgleich.ts:207`](../../src/lib/verbrauchsabgleich.ts#L207) | – |
| `AbgleichZeile` | interface | [`src/lib/verbrauchsabgleich.ts:209`](../../src/lib/verbrauchsabgleich.ts#L209) | – |
| `Abgleich` | interface | [`src/lib/verbrauchsabgleich.ts:269`](../../src/lib/verbrauchsabgleich.ts#L269) | – |
| `StairLayout` | interface | [`src/lib/verticalSymbols.ts:179`](../../src/lib/verticalSymbols.ts#L179) | – |
| `VerworfenerRaum` | interface | [`src/lib/verworfeneRaeume.ts:37`](../../src/lib/verworfeneRaeume.ts#L37) | – |
| `RaumverlustHinweis` | interface | [`src/lib/verworfeneRaeume.ts:128`](../../src/lib/verworfeneRaeume.ts#L128) | `store/bimZustand.ts`, `store/slices/laden.ts` |
| `WallGeometry` | interface | [`src/lib/wallGeometry.ts:12`](../../src/lib/wallGeometry.ts#L12) | `scripts/pruefungen/dachschnitt.ts`, `components/Editor2D.tsx`, `components/Viewer3D.tsx`, `lib/dachschnitt.ts`, `lib/openingSymbols.ts` (+1) |
| `WallSolidPart` | interface | [`src/lib/wallGeometry.ts:84`](../../src/lib/wallGeometry.ts#L84) | – |
| `PlanWallPiece` | interface | [`src/lib/wallGeometry.ts:162`](../../src/lib/wallGeometry.ts#L162) | `components/Editor2D.tsx` |
| `ScenePoint` | interface | [`src/lib/wallGeometry.ts:235`](../../src/lib/wallGeometry.ts#L235) | `scripts/verify.ts` |
| `WallBoxPlacement` | interface | [`src/lib/wallGeometry.ts:317`](../../src/lib/wallGeometry.ts#L317) | – |
| `Wandfuehrung` | interface | [`src/lib/wandfuehrung.ts:19`](../../src/lib/wandfuehrung.ts#L19) | – |
| `Ausnahmegrund` | type | [`src/lib/wandhoehen.ts:62`](../../src/lib/wandhoehen.ts#L62) | – |
| `Hoehenaenderung` | interface | [`src/lib/wandhoehen.ts:70`](../../src/lib/wandhoehen.ts#L70) | – |
| `Hoehenausnahme` | interface | [`src/lib/wandhoehen.ts:76`](../../src/lib/wandhoehen.ts#L76) | – |
| `Hoehenbefund` | interface | [`src/lib/wandhoehen.ts:82`](../../src/lib/wandhoehen.ts#L82) | `components/AufmassPanel.tsx` |
| `Hoehenbefundeingabe` | interface | [`src/lib/wandhoehen.ts:95`](../../src/lib/wandhoehen.ts#L95) | – |
| `Wandquerung` | interface | [`src/lib/wandquerung.ts:62`](../../src/lib/wandquerung.ts#L62) | – |
| `Querungsstelle` | interface | [`src/lib/wandquerung.ts:79`](../../src/lib/wandquerung.ts#L79) | – |
| `WerkzeugArt` | type | [`src/lib/werkzeugkiste.ts:61`](../../src/lib/werkzeugkiste.ts#L61) | – |
| `Werkzeug` | interface | [`src/lib/werkzeugkiste.ts:63`](../../src/lib/werkzeugkiste.ts#L63) | `components/Viewer3D.tsx` |
| `Zieltreffer` | interface | [`src/lib/werkzeugkiste.ts:139`](../../src/lib/werkzeugkiste.ts#L139) | `components/Viewer3D.tsx` |
| `Setzurteil` | interface | [`src/lib/werkzeugkiste.ts:256`](../../src/lib/werkzeugkiste.ts#L256) | – |
| `WirtFaehigkeiten` | interface | [`src/lib/wirt.ts:17`](../../src/lib/wirt.ts#L17) | – |
| `KorpusId` | type | [`src/lib/wissensbasis.ts:33`](../../src/lib/wissensbasis.ts#L33) | `scripts/pruefungen/wissensbasis.ts`, `components/RohrnetzDialog.tsx`, `lib/projektMappe.ts` |
| `Belastbarkeit` | type | [`src/lib/wissensbasis.ts:71`](../../src/lib/wissensbasis.ts#L71) | `scripts/pruefungen/wissensbasis.ts` |
| `WissensEintrag` | interface | [`src/lib/wissensbasis.ts:79`](../../src/lib/wissensbasis.ts#L79) | `scripts/pruefungen/wissensbasis.ts`, `lib/projektMappe.ts`, `lib/wissenKorpus.ts` |
| `Treffer` | interface | [`src/lib/wissensbasis.ts:329`](../../src/lib/wissensbasis.ts#L329) | – |
| `SuchOptionen` | interface | [`src/lib/wissensbasis.ts:339`](../../src/lib/wissensbasis.ts#L339) | – |
| `Wissensbasis` | class | [`src/lib/wissensbasis.ts:367`](../../src/lib/wissensbasis.ts#L367) | `scripts/pruefungen/wissensbasis.ts`, `lib/pipeReport.ts` |
| `Eingabeart` | type | [`src/lib/zeigereingabe.ts:41`](../../src/lib/zeigereingabe.ts#L41) | – |
| `Absicht` | type | [`src/lib/zeigereingabe.ts:84`](../../src/lib/zeigereingabe.ts#L84) | – |
| `Eingabeeinstellung` | interface | [`src/lib/zeigereingabe.ts:94`](../../src/lib/zeigereingabe.ts#L94) | `components/Editor2D.tsx` |
| `Zeigerlage` | interface | [`src/lib/zeigereingabe.ts:126`](../../src/lib/zeigereingabe.ts#L126) | `scripts/pruefungen/zeigereingabe.ts`, `components/Editor2D.tsx` |
| `Ausschnitt` | interface | [`src/lib/zeigereingabe.ts:281`](../../src/lib/zeigereingabe.ts#L281) | – |
| `Feldgroesse` | interface | [`src/lib/zeigereingabe.ts:289`](../../src/lib/zeigereingabe.ts#L289) | – |
| `Fingerpaar` | interface | [`src/lib/zeigereingabe.ts:295`](../../src/lib/zeigereingabe.ts#L295) | `components/Editor2D.tsx` |
| `ClipboardContent` | interface | [`src/store/bimZustand.ts:266`](../../src/store/bimZustand.ts#L266) | – |
| `FloorLoopBatchSkip` | interface | [`src/store/bimZustand.ts:288`](../../src/store/bimZustand.ts#L288) | `store/slices/bauteile.ts` |
| `FloorLoopBatchResult` | interface | [`src/store/bimZustand.ts:294`](../../src/store/bimZustand.ts#L294) | `store/slices/bauteile.ts` |
| `FloorLoopBatchReport` | interface | [`src/store/bimZustand.ts:304`](../../src/store/bimZustand.ts#L304) | – |
| `WallDefaults` | interface | [`src/store/bimZustand.ts:313`](../../src/store/bimZustand.ts#L313) | – |
| `OpeningDefaults` | interface | [`src/store/bimZustand.ts:320`](../../src/store/bimZustand.ts#L320) | – |
| `BimState` | interface | [`src/store/bimZustand.ts:328`](../../src/store/bimZustand.ts#L328) | `store/slices/anlage.ts`, `store/slices/bauteile.ts`, `store/slices/bauteilkatalog.ts`, `store/slices/dach.ts`, `store/slices/einheiten.ts` (+8) |
| `StoreSet` | type | [`src/store/bimZustand.ts:1460`](../../src/store/bimZustand.ts#L1460) | `store/slices/anlage.ts`, `store/slices/bauteile.ts`, `store/slices/bauteilkatalog.ts`, `store/slices/dach.ts`, `store/slices/einheiten.ts` (+7) |
| `StoreGet` | type | [`src/store/bimZustand.ts:1462`](../../src/store/bimZustand.ts#L1462) | `store/slices/anlage.ts`, `store/slices/bauteile.ts`, `store/slices/bauteilkatalog.ts`, `store/slices/dach.ts`, `store/slices/einheiten.ts` (+7) |
| `Mutate` | type | [`src/store/bimZustand.ts:1464`](../../src/store/bimZustand.ts#L1464) | `store/slices/anlage.ts`, `store/slices/bauteile.ts`, `store/slices/bauteilkatalog.ts`, `store/slices/dach.ts`, `store/slices/einheiten.ts` (+7) |
| `AnlageSchluessel` | type | [`src/store/slices/anlage.ts:41`](../../src/store/slices/anlage.ts#L41) | – |
| `BauteileSchluessel` | type | [`src/store/slices/bauteile.ts:45`](../../src/store/slices/bauteile.ts#L45) | – |
| `BauteilkatalogSchluessel` | type | [`src/store/slices/bauteilkatalog.ts:13`](../../src/store/slices/bauteilkatalog.ts#L13) | – |
| `DachSchluessel` | type | [`src/store/slices/dach.ts:17`](../../src/store/slices/dach.ts#L17) | – |
| `EinheitenSchluessel` | type | [`src/store/slices/einheiten.ts:18`](../../src/store/slices/einheiten.ts#L18) | – |
| `GeschosseSchluessel` | type | [`src/store/slices/geschosse.ts:24`](../../src/store/slices/geschosse.ts#L24) | – |
| `GruppenSchluessel` | type | [`src/store/slices/gruppen.ts:19`](../../src/store/slices/gruppen.ts#L19) | – |
| `InstallationSchluessel` | type | [`src/store/slices/installation.ts:36`](../../src/store/slices/installation.ts#L36) | – |
| `LadenSchluessel` | type | [`src/store/slices/laden.ts:71`](../../src/store/slices/laden.ts#L71) | – |
| `ReferenzbildSchluessel` | type | [`src/store/slices/referenzbild.ts:23`](../../src/store/slices/referenzbild.ts#L23) | – |
| `SkizzeSchluessel` | type | [`src/store/slices/skizze.ts:39`](../../src/store/slices/skizze.ts#L39) | – |
| `UiSchluessel` | type | [`src/store/slices/ui.ts:28`](../../src/store/slices/ui.ts#L28) | – |
| `NodeId` | type | [`src/types/bim.ts:33`](../../src/types/bim.ts#L33) | – |
| `WallId` | type | [`src/types/bim.ts:34`](../../src/types/bim.ts#L34) | – |
| `OpeningId` | type | [`src/types/bim.ts:35`](../../src/types/bim.ts#L35) | – |
| `RoomId` | type | [`src/types/bim.ts:36`](../../src/types/bim.ts#L36) | – |
| `LevelId` | type | [`src/types/bim.ts:37`](../../src/types/bim.ts#L37) | `lib/aufstellgeschoss.ts`, `lib/begehen.ts`, `lib/eckpunkte.ts`, `lib/fussbodenkurven.ts`, `lib/raumtreffer.ts` (+1) |
| `LayerId` | type | [`src/types/bim.ts:38`](../../src/types/bim.ts#L38) | `scripts/pruefungen/ebenen.ts`, `lib/ebenen.ts` |
| `Vec2` | interface | [`src/types/bim.ts:41`](../../src/types/bim.ts#L41) | `scripts/pruefungen/begehen.ts`, `scripts/pruefungen/beschriftungslage.ts`, `scripts/pruefungen/dachformen.ts`, `scripts/pruefungen/dachschnitt.ts`, `scripts/pruefungen/dachumriss.ts` (+95) |
| `Bounds` | interface | [`src/types/bim.ts:47`](../../src/types/bim.ts#L47) | `lib/geometry.ts` |
| `Orientation` | type | [`src/types/bim.ts:55`](../../src/types/bim.ts#L55) | `lib/geometry.ts`, `lib/raumExport.ts`, `lib/tuerseiten.ts` |
| `BoundaryCondition` | type | [`src/types/bim.ts:67`](../../src/types/bim.ts#L67) | `scripts/pruefungen/keller.ts`, `components/AufnahmeAssistent.tsx`, `components/PropertiesPanel.tsx`, `lib/buildingModelImport.ts`, `lib/importgeschoss.ts` (+2) |
| `ConstructionCategory` | type | [`src/types/bim.ts:102`](../../src/types/bim.ts#L102) | `components/ConstructionPanel.tsx`, `lib/hostPatch.ts` |
| `Construction` | interface | [`src/types/bim.ts:110`](../../src/types/bim.ts#L110) | `scripts/pruefungen/uwert.ts`, `scripts/pruefungen/uwertquelle.ts`, `components/ConstructionPanel.tsx`, `lib/hostPatch.ts`, `lib/materialSchedule.ts` (+5) |
| `BimNode` | interface | [`src/types/bim.ts:154`](../../src/types/bim.ts#L154) | `scripts/bench.ts`, `scripts/handbuch-symbole.ts`, `scripts/pruefungen/anschlussgroesse.ts`, `scripts/pruefungen/aufmass.ts`, `scripts/pruefungen/aussenwand.ts` (+65) |
| `WallThicknessPreset` | type | [`src/types/bim.ts:168`](../../src/types/bim.ts#L168) | – |
| `WallType` | type | [`src/types/bim.ts:170`](../../src/types/bim.ts#L170) | `components/PropertiesPanel.tsx`, `components/SkizzenLeiste.tsx`, `components/Toolbar.tsx`, `lib/buildingModelImport.ts`, `lib/ifcImport.ts` (+5) |
| `Wall` | interface | [`src/types/bim.ts:172`](../../src/types/bim.ts#L172) | `scripts/bench.ts`, `scripts/handbuch-symbole.ts`, `scripts/pruefungen/anschlussgroesse.ts`, `scripts/pruefungen/aufmass.ts`, `scripts/pruefungen/aussenwand.ts` (+67) |
| `OpeningKind` | type | [`src/types/bim.ts:223`](../../src/types/bim.ts#L223) | `scripts/pruefungen/griffe.ts`, `components/Toolbar.tsx`, `lib/buildingModelImport.ts`, `lib/ifcImport.ts`, `lib/raumplanImport.ts` (+1) |
| `UnbeheizteArt` | type | [`src/types/bim.ts:226`](../../src/types/bim.ts#L226) | `components/PropertiesPanel.tsx`, `lib/unbeheizt.ts` |
| `WindowType` | type | [`src/types/bim.ts:252`](../../src/types/bim.ts#L252) | `components/PropertiesPanel.tsx` |
| `DoorType` | type | [`src/types/bim.ts:261`](../../src/types/bim.ts#L261) | `components/PropertiesPanel.tsx` |
| `PassageType` | type | [`src/types/bim.ts:269`](../../src/types/bim.ts#L269) | `components/PropertiesPanel.tsx` |
| `OpeningTypePreset` | interface | [`src/types/bim.ts:274`](../../src/types/bim.ts#L274) | `store/bimZustand.ts` |
| `Opening` | interface | [`src/types/bim.ts:322`](../../src/types/bim.ts#L322) | `scripts/bench.ts`, `scripts/handbuch-symbole.ts`, `scripts/pruefungen/aufmass.ts`, `scripts/pruefungen/aussenwand.ts`, `scripts/pruefungen/autokorrektur.ts` (+43) |
| `RoomBoundary` | interface | [`src/types/bim.ts:361`](../../src/types/bim.ts#L361) | `lib/roomDetection.ts` |
| `RoomUsage` | type | [`src/types/bim.ts:389`](../../src/types/bim.ts#L389) | `scripts/pruefungen/flurfuehrung.ts`, `scripts/pruefungen/hostraum.ts`, `components/PropertiesPanel.tsx`, `components/RaumnameFeld.tsx`, `components/RoomBook.tsx` (+8) |
| `Room` | interface | [`src/types/bim.ts:401`](../../src/types/bim.ts#L401) | `scripts/pruefungen/anlagenschema.ts`, `scripts/pruefungen/autokorrektur.ts`, `scripts/pruefungen/belegstufe.ts`, `scripts/pruefungen/dachlandschaft.ts`, `scripts/pruefungen/dachschnitt.ts` (+47) |
| `RoomHeatLoad` | interface | [`src/types/bim.ts:568`](../../src/types/bim.ts#L568) | `lib/heatLoadEstimate.ts`, `lib/hostPatch.ts`, `lib/plantDesign.ts` |
| `FixtureCategory` | type | [`src/types/bim.ts:593`](../../src/types/bim.ts#L593) | `scripts/pruefungen/ebenen.ts`, `components/TgaPalette.tsx`, `components/Viewer3D.tsx`, `lib/fixtureSymbols.ts`, `lib/raviaExport.ts` |
| `FixtureType` | type | [`src/types/bim.ts:600`](../../src/types/bim.ts#L600) | `components/Editor2D.tsx`, `components/GuidePanel.tsx`, `components/PropertiesPanel.tsx`, `components/Viewer3D.tsx`, `lib/auslegungExport.ts` (+10) |
| `FloorLoopPattern` | type | [`src/types/bim.ts:640`](../../src/types/bim.ts#L640) | `lib/floorLoopLayout.ts` |
| `RadiatorConnection` | type | [`src/types/bim.ts:652`](../../src/types/bim.ts#L652) | `components/PropertiesPanel.tsx`, `components/Viewer3D.tsx`, `lib/hostPatch.ts`, `lib/werkzeugkiste.ts` |
| `VentilSeite` | type | [`src/types/bim.ts:689`](../../src/types/bim.ts#L689) | `components/PropertiesPanel.tsx`, `components/Viewer3D.tsx`, `lib/werkzeugkiste.ts` |
| `LeistungHerkunft` | type | [`src/types/bim.ts:715`](../../src/types/bim.ts#L715) | `scripts/pruefungen/heizflaeche.ts` |
| `RatedPowerSource` | type | [`src/types/bim.ts:738`](../../src/types/bim.ts#L738) | `components/PropertiesPanel.tsx`, `lib/buildingModelImport.ts`, `lib/hostPatch.ts`, `lib/normleistung.ts`, `store/bimZustand.ts` |
| `FixtureParams` | interface | [`src/types/bim.ts:740`](../../src/types/bim.ts#L740) | `lib/hostPatch.ts`, `lib/normleistung.ts`, `lib/raumExport.ts` |
| `Fixture` | interface | [`src/types/bim.ts:879`](../../src/types/bim.ts#L879) | `scripts/bench.ts`, `scripts/handbuch-symbole.ts`, `scripts/pruefungen/anlagenschema.ts`, `scripts/pruefungen/anschlussgroesse.ts`, `scripts/pruefungen/auslegungsuebergabe.ts` (+48) |
| `FixtureDefinition` | interface | [`src/types/bim.ts:901`](../../src/types/bim.ts#L901) | `components/TgaPalette.tsx` |
| `Level` | interface | [`src/types/bim.ts:1009`](../../src/types/bim.ts#L1009) | `scripts/pruefungen/anschlussgroesse.ts`, `scripts/pruefungen/autokorrektur-belastung.ts`, `scripts/pruefungen/autokorrektur.ts`, `scripts/pruefungen/beschriftungslage.ts`, `scripts/pruefungen/dachlandschaft.ts` (+49) |
| `RoofKind` | type | [`src/types/bim.ts:1079`](../../src/types/bim.ts#L1079) | `scripts/pruefungen/dachschnitt.ts`, `components/RoofPanel.tsx`, `lib/buildingModelImport.ts` |
| `ScanDachHerkunft` | interface | [`src/types/bim.ts:1179`](../../src/types/bim.ts#L1179) | `lib/buildingModelImport.ts` |
| `RoofDefinition` | interface | [`src/types/bim.ts:1204`](../../src/types/bim.ts#L1204) | `scripts/pruefungen/dachformen.ts`, `scripts/pruefungen/dachschnitt.ts`, `scripts/pruefungen/dachumriss.ts`, `components/RoofPanel.tsx`, `lib/dachlandschaft.ts` (+4) |
| `RoofOpeningKind` | type | [`src/types/bim.ts:1315`](../../src/types/bim.ts#L1315) | `components/RoofPanel.tsx`, `store/bimZustand.ts` |
| `RoofOpening` | interface | [`src/types/bim.ts:1323`](../../src/types/bim.ts#L1323) | `components/PropertiesPanel.tsx`, `components/Viewer3D.tsx`, `lib/dachlandschaft.ts`, `lib/roofGeometry.ts`, `lib/roomDetection.ts` (+5) |
| `RoomRoofMetrics` | interface | [`src/types/bim.ts:1356`](../../src/types/bim.ts#L1356) | `lib/roofGeometry.ts` |
| `Layer` | interface | [`src/types/bim.ts:1395`](../../src/types/bim.ts#L1395) | `scripts/pruefungen/ebenen.ts`, `lib/ebenen.ts`, `store/bimZustand.ts` |
| `CalibrationLine` | interface | [`src/types/bim.ts:1408`](../../src/types/bim.ts#L1408) | – |
| `FloorplanImage` | interface | [`src/types/bim.ts:1416`](../../src/types/bim.ts#L1416) | `scripts/pruefungen/spiegeln.ts`, `components/ImageUploader.tsx`, `lib/spiegeln.ts`, `store/bimZustand.ts` |
| `AiAnalysisState` | type | [`src/types/bim.ts:1468`](../../src/types/bim.ts#L1468) | `store/bimZustand.ts` |
| `Freihandstrich` | interface | [`src/types/bim.ts:1481`](../../src/types/bim.ts#L1481) | `scripts/pruefungen/notizen.ts`, `lib/notizen.ts`, `lib/spiegeln.ts`, `store/slices/laden.ts`, `store/slices/referenzbild.ts` |
| `SkizzenZug` | interface | [`src/types/bim.ts:1502`](../../src/types/bim.ts#L1502) | – |
| `SkizzenVorschlag` | interface | [`src/types/bim.ts:1510`](../../src/types/bim.ts#L1510) | `store/bimZustand.ts` |
| `VerticalKind` | type | [`src/types/bim.ts:1548`](../../src/types/bim.ts#L1548) | `scripts/handbuch-symbole.ts`, `components/Editor2D.tsx`, `components/PropertiesPanel.tsx`, `components/Toolbar.tsx`, `store/bimZustand.ts` |
| `ShaftService` | type | [`src/types/bim.ts:1558`](../../src/types/bim.ts#L1558) | `components/PropertiesPanel.tsx`, `lib/wandquerung.ts` |
| `VerticalElement` | interface | [`src/types/bim.ts:1578`](../../src/types/bim.ts#L1578) | `scripts/handbuch-symbole.ts`, `scripts/pruefungen/druckplan.ts`, `scripts/pruefungen/geschossdecken.ts`, `scripts/pruefungen/massivbauteile.ts`, `scripts/pruefungen/treppenlogik.ts` (+13) |
| `SolidKind` | type | [`src/types/bim.ts:1616`](../../src/types/bim.ts#L1616) | `scripts/handbuch-symbole.ts`, `components/Editor2D.tsx`, `components/PropertiesPanel.tsx`, `components/Toolbar.tsx`, `store/bimZustand.ts` (+1) |
| `SolidElement` | interface | [`src/types/bim.ts:1645`](../../src/types/bim.ts#L1645) | `scripts/handbuch-symbole.ts`, `scripts/pruefungen/druckplan.ts`, `scripts/pruefungen/massivbauteile.ts`, `components/PropertiesPanel.tsx`, `components/Viewer3D.tsx` (+11) |
| `DurchbruchKind` | type | [`src/types/bim.ts:1693`](../../src/types/bim.ts#L1693) | `components/PropertiesPanel.tsx`, `components/Toolbar.tsx`, `store/bimZustand.ts` |
| `DurchbruchWirt` | type | [`src/types/bim.ts:1707`](../../src/types/bim.ts#L1707) | – |
| `DurchbruchForm` | type | [`src/types/bim.ts:1713`](../../src/types/bim.ts#L1713) | – |
| `Brandschutzklasse` | type | [`src/types/bim.ts:1722`](../../src/types/bim.ts#L1722) | `components/PropertiesPanel.tsx` |
| `Durchbruch` | interface | [`src/types/bim.ts:1757`](../../src/types/bim.ts#L1757) | `scripts/handbuch-symbole.ts`, `scripts/pruefungen/beschriftung.ts`, `scripts/pruefungen/durchbrueche.ts`, `scripts/pruefungen/werkzeugkiste.ts`, `components/PropertiesPanel.tsx` (+12) |
| `DurchbruchPreset` | interface | [`src/types/bim.ts:1837`](../../src/types/bim.ts#L1837) | `scripts/handbuch-symbole.ts`, `components/Toolbar.tsx`, `lib/wandquerung.ts`, `lib/werkzeugkiste.ts`, `store/bimZustand.ts` |
| `PipeService` | type | [`src/types/bim.ts:1875`](../../src/types/bim.ts#L1875) | `scripts/handbuch-symbole.ts`, `scripts/pruefungen/anlagenschema.ts`, `scripts/pruefungen/ebenen.ts`, `scripts/pruefungen/schemapruefung.ts`, `components/Editor2D.tsx` (+16) |
| `PipeRun` | interface | [`src/types/bim.ts:1929`](../../src/types/bim.ts#L1929) | `scripts/bench.ts`, `scripts/pruefungen/anschlussgroesse.ts`, `scripts/pruefungen/autokorrektur.ts`, `scripts/pruefungen/beschriftung.ts`, `scripts/pruefungen/beschriftungslage.ts` (+35) |
| `PipeRoutingMode` | type | [`src/types/bim.ts:2028`](../../src/types/bim.ts#L2028) | `scripts/pruefungen/rohrausleger.ts`, `components/RohrnetzDialog.tsx`, `components/Toolbar.tsx`, `lib/pipeLayout.ts`, `lib/pipeRouting.ts` (+2) |
| `PipeSurrounding` | type | [`src/types/bim.ts:2038`](../../src/types/bim.ts#L2038) | `lib/pipeInsulation.ts`, `lib/pipeLayout.ts`, `lib/pipeReport.ts`, `lib/steigstrang.ts` |
| `PipeAccessoryKind` | type | [`src/types/bim.ts:2053`](../../src/types/bim.ts#L2053) | `scripts/handbuch-symbole.ts`, `lib/hydraulicBalance.ts`, `lib/pipeAccessorySymbols.ts`, `lib/pipeLayout.ts`, `lib/pipeNetwork.ts` (+3) |
| `PipeAccessory` | interface | [`src/types/bim.ts:2075`](../../src/types/bim.ts#L2075) | `scripts/pruefungen/ebenen.ts`, `scripts/pruefungen/rohrnetzrechner.ts`, `components/PropertiesPanel.tsx`, `components/Viewer3D.tsx`, `lib/formteile.ts` (+8) |
| `PipeScheduleEntry` | interface | [`src/types/bim.ts:2095`](../../src/types/bim.ts#L2095) | `lib/materialSchedule.ts`, `lib/raviaExport.ts` |
| `PipeSegment` | interface | [`src/types/bim.ts:2113`](../../src/types/bim.ts#L2113) | `scripts/pruefungen/rohrnetzrechner.ts`, `lib/hydraulicBalance.ts`, `lib/netzExport.ts`, `lib/pipeNetwork.ts`, `lib/pipeReport.ts` |
| `PipePath` | interface | [`src/types/bim.ts:2164`](../../src/types/bim.ts#L2164) | `scripts/pruefungen/rohrnetzrechner.ts`, `lib/hydraulicBalance.ts`, `lib/pipeNetwork.ts` |
| `PipeNetworkReport` | interface | [`src/types/bim.ts:2198`](../../src/types/bim.ts#L2198) | `scripts/pruefungen/rohrnetzrechner.ts`, `lib/hydraulicBalance.ts`, `lib/netzExport.ts`, `lib/pipeNetwork.ts` |
| `AreaCategory` | type | [`src/types/bim.ts:2220`](../../src/types/bim.ts#L2220) | `components/HeatPumpPanel.tsx`, `lib/heatPump.ts` |
| `MountingSituation` | type | [`src/types/bim.ts:2236`](../../src/types/bim.ts#L2236) | `components/HeatPumpPanel.tsx`, `lib/heatPump.ts` |
| `HeatSourceKind` | type | [`src/types/bim.ts:2246`](../../src/types/bim.ts#L2246) | `components/AnlagenPanel.tsx`, `components/HeatPumpPanel.tsx`, `lib/deviceCatalog.ts`, `lib/deviceImport.ts` |
| `SoilKind` | type | [`src/types/bim.ts:2256`](../../src/types/bim.ts#L2256) | `scripts/pruefungen/uebergabe.ts`, `components/HeatPumpPanel.tsx`, `lib/heatPump.ts` |
| `WaterProtectionZone` | type | [`src/types/bim.ts:2266`](../../src/types/bim.ts#L2266) | – |
| `HeatPump` | interface | [`src/types/bim.ts:2275`](../../src/types/bim.ts#L2275) | `scripts/pruefungen/anschlussgroesse.ts`, `scripts/pruefungen/planleeren.ts`, `scripts/pruefungen/ringleitung.ts`, `scripts/pruefungen/schutzbereich.ts`, `scripts/verify.ts` (+6) |
| `SiteElementKind` | type | [`src/types/bim.ts:2402`](../../src/types/bim.ts#L2402) | `components/Editor2D.tsx`, `store/bimZustand.ts` |
| `SiteElement` | interface | [`src/types/bim.ts:2448`](../../src/types/bim.ts#L2448) | `lib/siteSymbols.ts`, `lib/spiegeln.ts`, `store/bimZustand.ts`, `store/slices/anlage.ts`, `store/slices/laden.ts` |
| `IgnitionKind` | type | [`src/types/bim.ts:2472`](../../src/types/bim.ts#L2472) | `components/HeatPumpPanel.tsx` |
| `SitePlan` | interface | [`src/types/bim.ts:2485`](../../src/types/bim.ts#L2485) | `components/Viewer3D.tsx`, `lib/plantDefaults.ts`, `lib/spiegeln.ts` |
| `AnnotationKind` | type | [`src/types/bim.ts:2526`](../../src/types/bim.ts#L2526) | `components/Toolbar.tsx`, `store/bimZustand.ts` |
| `Annotation` | interface | [`src/types/bim.ts:2542`](../../src/types/bim.ts#L2542) | `scripts/handbuch-symbole.ts`, `scripts/pruefungen/beschriftung.ts`, `scripts/pruefungen/eckpunkte.ts`, `components/PropertiesPanel.tsx`, `lib/annotationSymbols.ts` (+7) |
| `AnnotationAnchor` | interface | [`src/types/bim.ts:2587`](../../src/types/bim.ts#L2587) | `scripts/pruefungen/beschriftung.ts`, `components/PropertiesPanel.tsx`, `lib/beschriftung3d.ts`, `store/bimZustand.ts` |
| `AnnotationQuelle` | type | [`src/types/bim.ts:2607`](../../src/types/bim.ts#L2607) | `scripts/pruefungen/beschriftung.ts`, `lib/beschriftung3d.ts` |
| `ToolId` | type | [`src/types/bim.ts:2630`](../../src/types/bim.ts#L2630) | `components/Toolbar.tsx`, `lib/zeigereingabe.ts`, `store/bimZustand.ts`, `store/slices/skizze.ts` |
| `ViewMode` | type | [`src/types/bim.ts:2658`](../../src/types/bim.ts#L2658) | `components/Toolbar.tsx`, `store/bimZustand.ts` |
| `CameraMode` | type | [`src/types/bim.ts:2667`](../../src/types/bim.ts#L2667) | `components/Viewer3D.tsx`, `store/bimZustand.ts` |
| `SnapSettings` | interface | [`src/types/bim.ts:2669`](../../src/types/bim.ts#L2669) | `store/bimZustand.ts` |
| `SnapResult` | interface | [`src/types/bim.ts:2707`](../../src/types/bim.ts#L2707) | `components/Editor2D.tsx` |
| `SelectionKind` | type | [`src/types/bim.ts:2720`](../../src/types/bim.ts#L2720) | `scripts/pruefungen/auswahlnamen.ts`, `scripts/pruefungen/ebenen.ts`, `components/Editor2D.tsx`, `lib/auswahlNamen.ts`, `lib/ebenen.ts` |
| `Selection` | interface | [`src/types/bim.ts:2738`](../../src/types/bim.ts#L2738) | `scripts/pruefungen/griffe.ts`, `components/Viewer3D.tsx`, `lib/ebenen.ts`, `lib/griffe.ts`, `lib/werkzeugkiste.ts` (+3) |
| `AuswahlQuelle` | type | [`src/types/bim.ts:2753`](../../src/types/bim.ts#L2753) | `store/bimZustand.ts` |
| `Viewport` | interface | [`src/types/bim.ts:2756`](../../src/types/bim.ts#L2756) | `store/bimZustand.ts` |
| `Vorhaben` | type | [`src/types/bim.ts:2799`](../../src/types/bim.ts#L2799) | `scripts/pruefungen/vorhaben.ts`, `components/AnlagenPanel.tsx`, `lib/plantDefaults.ts`, `lib/systemtemperatur.ts`, `store/bimZustand.ts` |
| `Brennstoff` | type | [`src/types/bim.ts:2809`](../../src/types/bim.ts#L2809) | `lib/verbrauchsabgleich.ts` |
| `Verbrauchsangabe` | interface | [`src/types/bim.ts:2818`](../../src/types/bim.ts#L2818) | `lib/verbrauchsabgleich.ts` |
| `ProjectMeta` | interface | [`src/types/bim.ts:2827`](../../src/types/bim.ts#L2827) | `lib/hostPatch.ts` |
| `Annahme` | interface | [`src/types/bim.ts:3009`](../../src/types/bim.ts#L3009) | `scripts/pruefungen/aufnahme.ts`, `lib/aufnahme.ts` |
| `HostPatchTrace` | interface | [`src/types/bim.ts:3021`](../../src/types/bim.ts#L3021) | – |
| `VentilationSystem` | interface | [`src/types/bim.ts:3039`](../../src/types/bim.ts#L3039) | – |
| `VentilationRole` | type | [`src/types/bim.ts:3061`](../../src/types/bim.ts#L3061) | `components/VentilationPanel.tsx`, `lib/heatLoadEstimate.ts`, `lib/raviaExport.ts`, `lib/roomDetection.ts` |
| `SetbackOperation` | interface | [`src/types/bim.ts:3077`](../../src/types/bim.ts#L3077) | – |
| `ThermalBridgeCatalogue` | type | [`src/types/bim.ts:3095`](../../src/types/bim.ts#L3095) | `lib/thermalBridges.ts` |
| `ThermalBridgeKind` | type | [`src/types/bim.ts:3098`](../../src/types/bim.ts#L3098) | `components/ThermalBridgePanel.tsx`, `lib/raviaExport.ts`, `lib/thermalBridges.ts` |
| `RoomThermalBridge` | interface | [`src/types/bim.ts:3110`](../../src/types/bim.ts#L3110) | `lib/thermalBridges.ts` |
| `BimDocument` | interface | [`src/types/bim.ts:3124`](../../src/types/bim.ts#L3124) | `scripts/bench.ts`, `scripts/handbuch-symbole.ts`, `scripts/pruefungen/abgleich2026.ts`, `scripts/pruefungen/anlagenschema.ts`, `scripts/pruefungen/anschlussgroesse.ts` (+106) |
| `UWertQuelle` | type | [`src/types/bim.ts:3216`](../../src/types/bim.ts#L3216) | `lib/raumExport.ts` |
| `ExportOpening` | interface | [`src/types/bim.ts:3226`](../../src/types/bim.ts#L3226) | `lib/raumExport.ts` |
| `GroundContact` | interface | [`src/types/bim.ts:3265`](../../src/types/bim.ts#L3265) | – |
| `ExportSurface` | interface | [`src/types/bim.ts:3288`](../../src/types/bim.ts#L3288) | `scripts/pruefungen/keller.ts`, `lib/heatLoadEstimate.ts`, `lib/raumExport.ts` |
| `ExportFixture` | interface | [`src/types/bim.ts:3334`](../../src/types/bim.ts#L3334) | `lib/raumExport.ts` |
| `ExportRoom` | interface | [`src/types/bim.ts:3346`](../../src/types/bim.ts#L3346) | `scripts/pruefungen/keller.ts`, `scripts/pruefungen/uebergabe.ts`, `lib/exportDiff.ts`, `lib/plantBook.ts`, `lib/raumExport.ts` (+1) |
| `ExportRoomPipe` | interface | [`src/types/bim.ts:3563`](../../src/types/bim.ts#L3563) | `lib/raumExport.ts` |
| `ExportVertical` | interface | [`src/types/bim.ts:3574`](../../src/types/bim.ts#L3574) | `lib/raviaExport.ts` |
| `ExportSolidThermalBridge` | interface | [`src/types/bim.ts:3599`](../../src/types/bim.ts#L3599) | – |
| `ExportSolid` | interface | [`src/types/bim.ts:3609`](../../src/types/bim.ts#L3609) | `lib/raviaExport.ts` |
| `ExportDurchbruch` | interface | [`src/types/bim.ts:3643`](../../src/types/bim.ts#L3643) | `lib/raviaExport.ts` |
| `ExportPipe` | interface | [`src/types/bim.ts:3672`](../../src/types/bim.ts#L3672) | `lib/raviaExport.ts` |
| `ExportBuildingTotals` | interface | [`src/types/bim.ts:3696`](../../src/types/bim.ts#L3696) | `lib/raviaExport.ts` |
| `VentilationTotals` | interface | [`src/types/bim.ts:3761`](../../src/types/bim.ts#L3761) | `lib/raviaExport.ts` |
| `ThermalBridgeTotals` | interface | [`src/types/bim.ts:3799`](../../src/types/bim.ts#L3799) | `lib/raviaExport.ts` |
| `SetbackTotals` | interface | [`src/types/bim.ts:3824`](../../src/types/bim.ts#L3824) | `lib/raviaExport.ts` |
| `ExportRoomVentilation` | interface | [`src/types/bim.ts:3860`](../../src/types/bim.ts#L3860) | – |
| `ClosureIssueKind` | type | [`src/types/bim.ts:3912`](../../src/types/bim.ts#L3912) | `lib/roomDetection.ts` |
| `ClosureIssue` | interface | [`src/types/bim.ts:3915`](../../src/types/bim.ts#L3915) | `components/Editor2D.tsx`, `lib/dokumentPflege.ts`, `lib/roomDetection.ts` |
| `ValidationIssue` | interface | [`src/types/bim.ts:3950`](../../src/types/bim.ts#L3950) | `components/ValidationPanel.tsx`, `lib/validation.ts` |
| `ValidationReport` | interface | [`src/types/bim.ts:3973`](../../src/types/bim.ts#L3973) | `lib/embedApi.ts`, `lib/validation.ts` |
| `ExportSubsoil` | interface | [`src/types/bim.ts:4002`](../../src/types/bim.ts#L4002) | `lib/raviaExport.ts` |
| `ExportHeatPump` | interface | [`src/types/bim.ts:4035`](../../src/types/bim.ts#L4035) | `lib/raviaExport.ts` |
| `ExportPlant` | interface | [`src/types/bim.ts:4140`](../../src/types/bim.ts#L4140) | `lib/raviaExport.ts` |
| `ExportOccupancyUnit` | interface | [`src/types/bim.ts:4225`](../../src/types/bim.ts#L4225) | `lib/raviaExport.ts` |
| `ExportOccupancy` | interface | [`src/types/bim.ts:4273`](../../src/types/bim.ts#L4273) | `lib/raviaExport.ts` |
| `ExportLevel` | type | [`src/types/bim.ts:4289`](../../src/types/bim.ts#L4289) | – |
| `RaviaExport` | interface | [`src/types/bim.ts:4294`](../../src/types/bim.ts#L4294) | `scripts/pruefungen/exportvertrag.ts`, `scripts/pruefungen/uebergabe.ts`, `scripts/pruefungen/uwertquelle.ts`, `components/ExportDiffPanel.tsx`, `lib/embedApi.ts` (+3) |
| `Herkunft` | type | [`src/types/bim.ts:4619`](../../src/types/bim.ts#L4619) | – |
| `Auslegungswert` | interface | [`src/types/bim.ts:4634`](../../src/types/bim.ts#L4634) | `lib/auslegungExport.ts` |
| `ExportEmitter` | interface | [`src/types/bim.ts:4656`](../../src/types/bim.ts#L4656) | `lib/auslegungExport.ts` |
| `ExportHydraulics` | interface | [`src/types/bim.ts:4719`](../../src/types/bim.ts#L4719) | `lib/auslegungExport.ts` |
| `ExportConsumerBalance` | interface | [`src/types/bim.ts:4757`](../../src/types/bim.ts#L4757) | `lib/auslegungExport.ts` |
| `PumpForm` | type | [`src/types/bim.ts:4830`](../../src/types/bim.ts#L4830) | `scripts/pruefungen/schemavorschlag.ts`, `components/AnlagenFragen.tsx`, `components/AnlagenPanel.tsx`, `lib/anlagenFragen.ts`, `lib/deviceCatalog.ts` (+4) |
| `UnitContents` | interface | [`src/types/bim.ts:4855`](../../src/types/bim.ts#L4855) | `scripts/pruefungen/schemavorschlag.ts`, `lib/deviceCatalog.ts`, `lib/schemaKatalog.ts` |
| `Refrigerant` | type | [`src/types/bim.ts:4893`](../../src/types/bim.ts#L4893) | `scripts/pruefungen/schutzbereich.ts`, `components/AnlagenFragen.tsx`, `components/HeatPumpPanel.tsx`, `lib/anlagenFragen.ts`, `lib/deviceCatalog.ts` (+1) |
| `RefrigerantProperties` | interface | [`src/types/bim.ts:4915`](../../src/types/bim.ts#L4915) | `lib/deviceCatalog.ts` |
| `DeviceRatingPoint` | interface | [`src/types/bim.ts:4941`](../../src/types/bim.ts#L4941) | `lib/deviceCatalog.ts`, `lib/deviceImport.ts` |
| `WertHerkunft` | type | [`src/types/bim.ts:4960`](../../src/types/bim.ts#L4960) | `lib/erzeugerHydraulik.ts`, `lib/pipeReportPrint.ts`, `lib/projektMappe.ts` |
| `ErzeugerAngabe` | type | [`src/types/bim.ts:4992`](../../src/types/bim.ts#L4992) | `lib/erzeugerHydraulik.ts` |
| `ErzeugerUmfang` | type | [`src/types/bim.ts:5002`](../../src/types/bim.ts#L5002) | `lib/erzeugerHydraulik.ts`, `lib/pipeReportPrint.ts` |
| `GeneratorHydraulics` | interface | [`src/types/bim.ts:5017`](../../src/types/bim.ts#L5017) | `lib/erzeugerHydraulik.ts` |
| `HeatPumpModel` | interface | [`src/types/bim.ts:5063`](../../src/types/bim.ts#L5063) | `scripts/pruefungen/anlagenbuch.ts`, `scripts/pruefungen/geraeteimport.ts`, `scripts/pruefungen/schemavorschlag.ts`, `components/AnlagenPanel.tsx`, `lib/deviceCatalog.ts` (+4) |
| `StorageKind` | type | [`src/types/bim.ts:5191`](../../src/types/bim.ts#L5191) | `scripts/pruefungen/schemavorschlag.ts`, `lib/deviceCatalog.ts`, `lib/deviceImport.ts`, `lib/plantDesign.ts`, `lib/schemaAuswahl.ts` (+2) |
| `StorageModel` | interface | [`src/types/bim.ts:5209`](../../src/types/bim.ts#L5209) | `lib/deviceCatalog.ts`, `lib/deviceImport.ts` |
| `PipeMaterial` | type | [`src/types/bim.ts:5239`](../../src/types/bim.ts#L5239) | `components/AnlagenPanel.tsx`, `lib/domesticWater.ts`, `lib/hydraulicBalance.ts`, `lib/hydraulics.ts`, `lib/materialSchedule.ts` (+6) |
| `PipeDimension` | interface | [`src/types/bim.ts:5251`](../../src/types/bim.ts#L5251) | `scripts/pruefungen/rohrdaemmung.ts`, `lib/hydraulicBalance.ts`, `lib/hydraulics.ts`, `lib/pipeInsulation.ts`, `lib/pipeReport.ts` (+1) |
| `PipeSizing` | interface | [`src/types/bim.ts:5268`](../../src/types/bim.ts#L5268) | `lib/hydraulicBalance.ts`, `lib/hydraulics.ts`, `lib/plantBook.ts`, `lib/plantDesign.ts` |
| `HeatingCircuit` | interface | [`src/types/bim.ts:5287`](../../src/types/bim.ts#L5287) | `scripts/pruefungen/anlagenfragen.ts`, `scripts/pruefungen/anlagenschema.ts`, `scripts/pruefungen/schemapruefung.ts`, `scripts/pruefungen/schemavorschlag.ts`, `scripts/pruefungen/uebersichtsschema.ts` (+6) |
| `ExportBivalence` | interface | [`src/types/bim.ts:5330`](../../src/types/bim.ts#L5330) | – |
| `ExportHeatingCircuit` | interface | [`src/types/bim.ts:5394`](../../src/types/bim.ts#L5394) | – |
| `SchematicKind` | type | [`src/types/bim.ts:5420`](../../src/types/bim.ts#L5420) | `scripts/handbuch-symbole.ts`, `scripts/pruefungen/anlagenschema.ts`, `scripts/pruefungen/normsymbole.ts`, `scripts/pruefungen/schemapruefung.ts`, `scripts/pruefungen/schemavorschlag.ts` (+15) |
| `SchematicComponent` | interface | [`src/types/bim.ts:5495`](../../src/types/bim.ts#L5495) | `scripts/pruefungen/anlagenschema.ts`, `scripts/pruefungen/schemabeschriftung.ts`, `scripts/pruefungen/schemapruefung.ts`, `components/SchemaView.tsx`, `lib/materialSchedule.ts` (+6) |
| `SchematicLink` | interface | [`src/types/bim.ts:5513`](../../src/types/bim.ts#L5513) | `scripts/pruefungen/anlagenschema.ts`, `scripts/pruefungen/schemapruefung.ts`, `components/SchemaView.tsx`, `lib/plantDesign.ts`, `lib/schemaPruefung.ts` (+4) |
| `SafetyDesign` | interface | [`src/types/bim.ts:5542`](../../src/types/bim.ts#L5542) | `lib/plantBook.ts`, `lib/plantDesign.ts`, `lib/safetyFittings.ts` |
| `DomesticHotWaterDesign` | interface | [`src/types/bim.ts:5578`](../../src/types/bim.ts#L5578) | `lib/domesticWater.ts` |
| `BivalenzBetrieb` | type | [`src/types/bim.ts:5627`](../../src/types/bim.ts#L5627) | `components/AnlagenPanel.tsx`, `lib/bivalenz.ts` |
| `ZweitErzeugerArt` | type | [`src/types/bim.ts:5634`](../../src/types/bim.ts#L5634) | `components/AnlagenPanel.tsx` |
| `SecondGenerator` | interface | [`src/types/bim.ts:5667`](../../src/types/bim.ts#L5667) | `scripts/pruefungen/bivalenz.ts`, `components/AnlagenPanel.tsx`, `lib/bivalenz.ts` |
| `CascadeDefinition` | interface | [`src/types/bim.ts:5698`](../../src/types/bim.ts#L5698) | – |
| `AnlagenAntworten` | interface | [`src/types/bim.ts:5745`](../../src/types/bim.ts#L5745) | `scripts/pruefungen/anlagenfragen.ts`, `scripts/pruefungen/anlagenschema.ts`, `components/AnlagenDialog.tsx`, `components/AnlagenFragen.tsx`, `components/AnlagenPanel.tsx` (+3) |
| `Inneneinheit` | type | [`src/types/bim.ts:5825`](../../src/types/bim.ts#L5825) | `scripts/pruefungen/anlagenfragen.ts`, `components/AnlagenFragen.tsx`, `lib/anlagenFragen.ts` |
| `HeizkreisArt` | type | [`src/types/bim.ts:5834`](../../src/types/bim.ts#L5834) | `components/AnlagenFragen.tsx`, `lib/anlagenFragen.ts` |
| `PlantDefinition` | interface | [`src/types/bim.ts:5854`](../../src/types/bim.ts#L5854) | `scripts/pruefungen/schemapruefung.ts`, `scripts/pruefungen/schemavorschlag.ts`, `lib/anlagenFragen.ts`, `lib/plantDefaults.ts`, `lib/schemaAuswahl.ts` (+3) |
| `PlantStorage` | interface | [`src/types/bim.ts:5994`](../../src/types/bim.ts#L5994) | `scripts/pruefungen/anlagenfragen.ts`, `scripts/pruefungen/anlagenschema.ts`, `scripts/pruefungen/schemapruefung.ts`, `scripts/pruefungen/schemavorschlag.ts`, `scripts/pruefungen/uebersichtsschema.ts` (+7) |
