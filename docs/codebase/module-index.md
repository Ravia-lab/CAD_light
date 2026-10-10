# Modulindex CAD Light

Stand: 09.10.2026 · Quelle: CAD_light@55f5460 (Version 1.77.0) · automatisch aus den Quelltexten erzeugt (Regex über `export`/`import`), danach geprüft

Je Modul: Verantwortung (Kopfkommentar), exportierte Symbole, Abhängigkeiten (relative Importe) und Aufrufer (Module, die es importieren). Prüf- und Rauchskripte unter `scripts/` zählen als Aufrufer, sind aber getrennt ausgewiesen.

### [`src/App.tsx`](../../src/App.tsx) · 844 Zeilen

**Verantwortung:** App — Layout-Shell im High-End-Dark-Theme. Aufbau: Kopfzeile · Werkzeugleiste links · Zeichenfläche(n) · Inspektor  
**Abhängigkeiten:** `components/AnlagenPanel.tsx`, `components/AufmassPanel.tsx`, `components/AufnahmeAssistent.tsx`, `components/ConstructionPanel.tsx`, `components/Editor2D.tsx`, `components/ExportDiffPanel.tsx`, `components/GuidePanel.tsx`, `components/HeatPumpPanel.tsx`, `components/ImageUploader.tsx`, `components/KorrekturDialog.tsx`, `components/LayerPanel.tsx`, `components/ProjektDialog.tsx`, `components/PropertiesPanel.tsx`, `components/Pruefansicht.tsx`, `components/RaumnameFeld.tsx`, `components/RoofPanel.tsx`, `components/RoomBook.tsx`, `components/ScanDialog.tsx`, `components/SchemaView.tsx`, `components/SkizzenSeite.tsx`, `components/Skizzenblatt.tsx`, `components/StatusBar.tsx`, `components/TgaPalette.tsx`, `components/ThermalBridgePanel.tsx`, `components/Toolbar.tsx`, `components/ValidationPanel.tsx`, `components/VentilationPanel.tsx`, `lib/autosave.ts`, `lib/geraeteprofil.ts`, `lib/projectStore.ts`, `lib/scanDienst.ts`, `lib/uimodus.ts`, `store/scanDialog.ts`, `store/useBimStore.ts`  
**Aufrufer:** `main.tsx`  
**Aufrufer in scripts/:** 0

Exportierte Funktionen/Konstanten: [`App`](../../src/App.tsx#L113)

### [`src/components/AnlagenDialog.tsx`](../../src/components/AnlagenDialog.tsx) · 167 Zeilen

**Verantwortung:** Der Anlagendialog — gefragt wird da, wo man hinsieht. **Der gemeldete Mangel.** Die Angaben zur Anlage standen nur im  
**Abhängigkeiten:** `components/AnlagenFragen.tsx`, `lib/anlagenFragen.ts`, `lib/plantDefaults.ts`, `lib/plantDesign.ts`, `store/useBimStore.ts`, `types/bim.ts`  
**Aufrufer:** `components/SchemaView.tsx`  
**Aufrufer in scripts/:** 0

Exportierte Funktionen/Konstanten: [`AnlagenDialog`](../../src/components/AnlagenDialog.tsx#L38)

### [`src/components/AnlagenFragen.tsx`](../../src/components/AnlagenFragen.tsx) · 322 Zeilen

**Verantwortung:** Die sieben Angaben zur Anlage — ein Blatt, zwei Orte. **Warum es diese Datei gibt.** Die Felder standen bis 1.53.0 nur im  
**Abhängigkeiten:** `lib/anlagenFragen.ts`, `types/bim.ts`  
**Aufrufer:** `components/AnlagenDialog.tsx`, `components/AnlagenPanel.tsx`  
**Aufrufer in scripts/:** 0

Exportierte Funktionen/Konstanten: [`AnlagenFragen`](../../src/components/AnlagenFragen.tsx#L82)

### [`src/components/AnlagenPanel.tsx`](../../src/components/AnlagenPanel.tsx) · 2460 Zeilen

**Verantwortung:** AnlagenPanel — das Anlagenblatt. Hier wird aus einem Grundriss eine Anlage. Der Reiter beantwortet in einer  
**Abhängigkeiten:** `components/AnlagenFragen.tsx`, `components/Erklaerung.tsx`, `components/Protokoll.tsx`, `lib/anlagenFragen.ts`, `lib/bivalenz.ts`, `lib/deviceCatalog.ts`, `lib/deviceImport.ts`, `lib/erzeugerplatz.ts`, `lib/formteile.ts`, `lib/gebaeudeNetz.ts`, `lib/hydraulicBalance.ts`, `lib/materialSchedule.ts`, `lib/nutzungseinheiten.ts`, `lib/pipeNetwork.ts`, `lib/plantBook.ts`, `lib/plantDefaults.ts`, `lib/plantDesign.ts`, `lib/raviaExport.ts`, `lib/rohrlaenge.ts`, `lib/schemaPruefung.ts`, `lib/systemtemperatur.ts`, `lib/uimodus.ts`, `lib/verbraucherlast.ts`, `lib/verbrauchsabgleich.ts`, `lib/zahl.ts`, `store/useBimStore.ts`, `types/bim.ts`  
**Aufrufer:** `App.tsx`  
**Aufrufer in scripts/:** 0

Exportierte Funktionen/Konstanten: [`AnlagenPanel`](../../src/components/AnlagenPanel.tsx#L149)

### [`src/components/AufmassPanel.tsx`](../../src/components/AufmassPanel.tsx) · 492 Zeilen

**Verantwortung:** AufmassPanel — die Handgriffe nach einem Import. Ein eingelesener Grundriss ist fast fertig, aber eben nur fast: die Wände  
**Abhängigkeiten:** `lib/begradigen.ts`, `lib/luecken.ts`, `lib/wandhoehen.ts`, `store/korrekturDialog.ts`, `store/useBimStore.ts`, `types/bim.ts`  
**Aufrufer:** `App.tsx`  
**Aufrufer in scripts/:** 0

Exportierte Funktionen/Konstanten: [`AufmassPanel`](../../src/components/AufmassPanel.tsx#L60)

### [`src/components/AufnahmeAssistent.tsx`](../../src/components/AufnahmeAssistent.tsx) · 564 Zeilen

**Verantwortung:** Die Aufnahme Zimmer für Zimmer — die Bedienung. **Wofür.** Wer noch nie ein CAD bedient hat, scheitert nicht an der Zahl  
**Abhängigkeiten:** `lib/aufnahme.ts`, `lib/roomDetection.ts`, `lib/verbrauchsabgleich.ts`, `lib/zahl.ts`, `store/useBimStore.ts`, `types/bim.ts`  
**Aufrufer:** `App.tsx`  
**Aufrufer in scripts/:** 0

Exportierte Funktionen/Konstanten: [`AufnahmeAssistent`](../../src/components/AufnahmeAssistent.tsx#L72)

### [`src/components/CalibrationOverlay.tsx`](../../src/components/CalibrationOverlay.tsx) · 306 Zeilen

**Verantwortung:** CalibrationOverlay — interaktives 2-Punkt-Maßband. Bewusst als eigene Ereignis- und Render-Ebene über dem Canvas:  
**Abhängigkeiten:** `lib/geometry.ts`, `lib/zahl.ts`, `store/useBimStore.ts`, `types/bim.ts`  
**Aufrufer:** `components/Editor2D.tsx`  
**Aufrufer in scripts/:** 0

Exportierte Funktionen/Konstanten: [`CalibrationOverlay`](../../src/components/CalibrationOverlay.tsx#L33)

### [`src/components/ConstructionPanel.tsx`](../../src/components/ConstructionPanel.tsx) · 225 Zeilen

**Verantwortung:** ConstructionPanel — der Bauteilkatalog. Der Katalog ersetzt das Pflegen von U-Werten an jeder einzelnen Wand.  
**Abhängigkeiten:** `lib/zahl.ts`, `store/useBimStore.ts`, `types/bim.ts`  
**Aufrufer:** `App.tsx`  
**Aufrufer in scripts/:** 0

Exportierte Funktionen/Konstanten: [`ConstructionPanel`](../../src/components/ConstructionPanel.tsx#L26)

### [`src/components/Editor2D.tsx`](../../src/components/Editor2D.tsx) · 5325 Zeilen

**Verantwortung:** Editor2D — HTML5-Canvas-Zeichenfläche. Performance-Entscheidungen:  
**Abhängigkeiten:** `components/CalibrationOverlay.tsx`, `components/NotizLeiste.tsx`, `components/SkizzenLeiste.tsx`, `lib/annotationSymbols.ts`, `lib/aufstellgeschoss.ts`, `lib/bodenbelag.ts`, `lib/dachlandschaft.ts`, `lib/durchbruchSymbols.ts`, `lib/ebenen.ts`, `lib/eckpunkte.ts`, `lib/fixtureSymbols.ts`, `lib/fussbodenkurven.ts`, `lib/geometry.ts`, `lib/heatPump.ts`, `lib/kompass.ts`, `lib/notizen.ts`, `lib/openingSymbols.ts`, `lib/roofGeometry.ts`, `lib/roomTemplates.ts`, `lib/siteSymbols.ts`, `lib/verticalSymbols.ts`, `lib/wallGeometry.ts`, `lib/zeigereingabe.ts`, `store/useBimStore.ts`, `types/bim.ts`  
**Aufrufer:** `App.tsx`, `components/Pruefansicht.tsx`  
**Aufrufer in scripts/:** 0

Exportierte Funktionen/Konstanten: [`Editor2D`](../../src/components/Editor2D.tsx#L286)

### [`src/components/EntfernenKnopf.tsx`](../../src/components/EntfernenKnopf.tsx) · 110 Zeilen

**Verantwortung:** Der Entfernen-Knopf in der Statuszeile — löschen ohne Tastatur. **Warum es ihn gibt.** Im Grundriss führte bis 1.52.0 genau ein Weg zum  
**Abhängigkeiten:** `lib/auswahlNamen.ts`, `lib/ebenen.ts`, `store/useBimStore.ts`  
**Aufrufer:** `components/StatusBar.tsx`  
**Aufrufer in scripts/:** 0

Exportierte Funktionen/Konstanten: [`EntfernenKnopf`](../../src/components/EntfernenKnopf.tsx#L36)

### [`src/components/Erklaerung.tsx`](../../src/components/Erklaerung.tsx) · 130 Zeilen

**Verantwortung:** Erklärung — das kleine Fragezeichen neben einem Fachbegriff. Ein Tooltip über `title` reicht dafür nicht: er kommt spät, verschwindet  
**Abhängigkeiten:** `lib/glossar.ts`  
**Aufrufer:** `components/AnlagenPanel.tsx`, `components/HeatPumpPanel.tsx`, `components/PropertiesPanel.tsx`, `components/RoofPanel.tsx`, `components/ThermalBridgePanel.tsx`, `components/VentilationPanel.tsx`  
**Aufrufer in scripts/:** 0

Exportierte Funktionen/Konstanten: [`Erklaerung`](../../src/components/Erklaerung.tsx#L20), [`Beschriftung`](../../src/components/Erklaerung.tsx#L114)⁰

### [`src/components/ExportDiffPanel.tsx`](../../src/components/ExportDiffPanel.tsx) · 274 Zeilen

**Verantwortung:** ExportDiffPanel — „was hat sich seit der letzten Übergabe geändert?" Man lädt den zuletzt an RaVia übergebenen Export als Referenz; der aktuelle  
**Abhängigkeiten:** `lib/exportDiff.ts`, `lib/raviaExport.ts`, `lib/zahl.ts`, `store/useBimStore.ts`, `types/bim.ts`  
**Aufrufer:** `App.tsx`  
**Aufrufer in scripts/:** 0

Exportierte Funktionen/Konstanten: [`ExportDiffPanel`](../../src/components/ExportDiffPanel.tsx#L34)

### [`src/components/Flaggen.tsx`](../../src/components/Flaggen.tsx) · 200 Zeilen

**Verantwortung:** Flaggen für die Sprachwahl — als SVG, nicht als Emoji. **Warum nicht 🇹🇷 als Zeichen.** Windows hat keine Flaggen-Schriftzeichen.  
**Abhängigkeiten:** `lib/sprache.ts`  
**Aufrufer:** `components/Toolbar.tsx`  
**Aufrufer in scripts/:** 0

Exportierte Funktionen/Konstanten: [`Flagge`](../../src/components/Flaggen.tsx#L64)

### [`src/components/GuidePanel.tsx`](../../src/components/GuidePanel.tsx) · 958 Zeilen

**Verantwortung:** GuidePanel — „Was ist als Nächstes zu tun?" Ein CAD-Fenster beantwortet diese Frage nicht von selbst. Wer zum ersten  
**Abhängigkeiten:** `components/PlanPrintDialog.tsx`, `components/RohrnetzDialog.tsx`, `lib/begradigen.ts`, `lib/glossar.ts`, `lib/normleistung.ts`, `lib/objektaufnahme.ts`, `lib/pipeReport.ts`, `lib/plantDesign.ts`, `lib/schemaKatalog.ts`, `lib/schemaPruefung.ts`, `lib/sprache.ts`, `lib/uimodus.ts`, `lib/validation.ts`, `store/useBimStore.ts`, `types/bim.ts`  
**Aufrufer:** `App.tsx`  
**Aufrufer in scripts/:** 0

Exportierte Funktionen/Konstanten: [`GuidePanel`](../../src/components/GuidePanel.tsx#L87)

### [`src/components/HeatPumpPanel.tsx`](../../src/components/HeatPumpPanel.tsx) · 1002 Zeilen

**Verantwortung:** HeatPumpPanel — Wärmepumpe und Außenanlage. Die eigentliche Frage bei einer Luft-Wärmepumpe ist nicht, welches Gerät  
**Abhängigkeiten:** `components/Erklaerung.tsx`, `lib/anschlussgroesse.ts`, `lib/deviceCatalog.ts`, `lib/geometry.ts`, `lib/heatPump.ts`, `lib/kaeltemittel.ts`, `lib/plantDesign.ts`, `lib/primaerkreis.ts`, `store/useBimStore.ts`, `types/bim.ts`  
**Aufrufer:** `App.tsx`  
**Aufrufer in scripts/:** 0

Exportierte Funktionen/Konstanten: [`HeatPumpPanel`](../../src/components/HeatPumpPanel.tsx#L53)

### [`src/components/ImageUploader.tsx`](../../src/components/ImageUploader.tsx) · 362 Zeilen

**Verantwortung:** ImageUploader — Grundriss-Referenz: Upload und Overlay-Steuerung. Upload (PNG/JPG/PDF)  →  Kalibrieren (2-Punkt-Maßband)  
**Abhängigkeiten:** `components/ScanUebernahme.tsx`, `lib/zahl.ts`, `store/useBimStore.ts`, `types/bim.ts`  
**Aufrufer:** `App.tsx`  
**Aufrufer in scripts/:** 0

Exportierte Funktionen/Konstanten: [`ImageUploader`](../../src/components/ImageUploader.tsx#L29)

### [`src/components/KorrekturDialog.tsx`](../../src/components/KorrekturDialog.tsx) · 331 Zeilen

**Verantwortung:** Der Dialog „Grundriss prüfen und korrigieren". Verdrahtet nur — was gesucht und wie korrigiert wird, steht in  
**Abhängigkeiten:** `lib/autokorrektur.ts`, `lib/luecken.ts`, `lib/zahl.ts`, `store/korrekturDialog.ts`, `store/useBimStore.ts`, `types/bim.ts`  
**Aufrufer:** `App.tsx`  
**Aufrufer in scripts/:** 0

Exportierte Funktionen/Konstanten: [`KorrekturDialog`](../../src/components/KorrekturDialog.tsx#L44)

### [`src/components/LayerPanel.tsx`](../../src/components/LayerPanel.tsx) · 307 Zeilen

**Verantwortung:** LayerPanel — Ebenensteuerung, Raumliste und Fang-Einstellungen. Alles, was den *Zustand der Zeichenfläche* betrifft, an einem Ort.  
**Abhängigkeiten:** `lib/ebenen.ts`, `lib/zahl.ts`, `store/useBimStore.ts`  
**Aufrufer:** `App.tsx`  
**Aufrufer in scripts/:** 0

Exportierte Funktionen/Konstanten: [`LayerPanel`](../../src/components/LayerPanel.tsx#L17)

### [`src/components/LevelBar.tsx`](../../src/components/LevelBar.tsx) · 209 Zeilen

**Verantwortung:** LevelBar — Geschossumschalter in der Kopfzeile. Geschosse sind in einem Gebäudemodell keine Ebene wie eine Layer-Ebene,  
**Abhängigkeiten:** `lib/aussenwand.ts`, `lib/zahl.ts`, `store/useBimStore.ts`  
**Aufrufer:** `components/Toolbar.tsx`  
**Aufrufer in scripts/:** 0

Exportierte Funktionen/Konstanten: [`LevelBar`](../../src/components/LevelBar.tsx#L15)

### [`src/components/MappeDialog.tsx`](../../src/components/MappeDialog.tsx) · 264 Zeilen

**Verantwortung:** MappeDialog — die Projektmappe ansehen und drucken. Drei Dinge in einem Fenster, weil sie beim Übergeben zusammengehören:  
**Abhängigkeiten:** `lib/pipeReport.ts`, `lib/projektMappe.ts`, `lib/zahl.ts`, `store/useBimStore.ts`  
**Aufrufer:** `components/Toolbar.tsx`  
**Aufrufer in scripts/:** 0

Exportierte Funktionen/Konstanten: [`MappeDialog`](../../src/components/MappeDialog.tsx#L33)

### [`src/components/NotizLeiste.tsx`](../../src/components/NotizLeiste.tsx) · 100 Zeilen

**Verantwortung:** NotizLeiste — der Werkzeugkasten der Notizebene. **Warum es sie überhaupt gibt.** Auf dem Tablet fehlt alles, worüber man  
**Abhängigkeiten:** `store/useBimStore.ts`  
**Aufrufer:** `components/Editor2D.tsx`  
**Aufrufer in scripts/:** 0

Exportierte Funktionen/Konstanten: [`NotizLeiste`](../../src/components/NotizLeiste.tsx#L20)

### [`src/components/PlanPrintDialog.tsx`](../../src/components/PlanPrintDialog.tsx) · 350 Zeilen

**Verantwortung:** PlanPrintDialog — maßstäblicher Planausdruck. Der Dialog zeigt vor dem Drucken, ob der Grundriss beim gewählten Maßstab  
**Abhängigkeiten:** `lib/ebenen.ts`, `lib/planPrint.ts`, `lib/zahl.ts`, `store/useBimStore.ts`  
**Aufrufer:** `components/GuidePanel.tsx`, `components/Toolbar.tsx`  
**Aufrufer in scripts/:** 0

Exportierte Funktionen/Konstanten: [`PlanPrintDialog`](../../src/components/PlanPrintDialog.tsx#L20)

### [`src/components/ProjektDialog.tsx`](../../src/components/ProjektDialog.tsx) · 526 Zeilen

**Verantwortung:** ProjektDialog — die Projektverwaltung als Oberfläche. Der Anwender misst seine Wohnung über mehrere Abende auf und hat nebenher  
**Abhängigkeiten:** `lib/autosave.ts`, `lib/projectStore.ts`, `lib/raviaExport.ts`, `store/useBimStore.ts`  
**Aufrufer:** `App.tsx`  
**Aufrufer in scripts/:** 0

Exportierte Funktionen/Konstanten: [`ProjektDialog`](../../src/components/ProjektDialog.tsx#L44)

### [`src/components/PropertiesPanel.tsx`](../../src/components/PropertiesPanel.tsx) · 3200 Zeilen

**Verantwortung:** PropertiesPanel — kontextsensitive Eigenschaften der Auswahl. Zeigt genau das, was zum selektierten Objekt gehört; ohne Auswahl die  
**Abhängigkeiten:** `components/Erklaerung.tsx`, `components/RaumnameFeld.tsx`, `lib/annotationSymbols.ts`, `lib/beschriftung3d.ts`, `lib/bodenbelag.ts`, `lib/durchbruchSymbols.ts`, `lib/fixtureSymbols.ts`, `lib/geometry.ts`, `lib/heizflaechenAbgleich.ts`, `lib/kompass.ts`, `lib/levelGeometry.ts`, `lib/normleistung.ts`, `lib/nutzungseinheiten.ts`, `lib/pipeAccessorySymbols.ts`, `lib/raviaExport.ts`, `lib/rohrbezeichnung.ts`, `lib/roofGeometry.ts`, `lib/treppenlogik.ts`, `lib/tuerseiten.ts`, `lib/unbeheizt.ts`, `lib/uwert.ts`, `lib/verticalSymbols.ts`, `lib/wallGeometry.ts`, `lib/zahl.ts`, `store/useBimStore.ts`, `types/bim.ts`  
**Aufrufer:** `App.tsx`  
**Aufrufer in scripts/:** 0

Exportierte Funktionen/Konstanten: [`PropertiesPanel`](../../src/components/PropertiesPanel.tsx#L109)

### [`src/components/Protokoll.tsx`](../../src/components/Protokoll.tsx) · 71 Zeilen

**Verantwortung:** Protokoll — eingeklappt, mit einer Zeile zum Aufklappen (seit 1.71.0). Gemeldet am 02.10.2026: „Das Protokoll sollte immer ausgeblendet sein, nur  
**Abhängigkeiten:** –  
**Aufrufer:** `components/AnlagenPanel.tsx`, `components/RohrnetzDialog.tsx`  
**Aufrufer in scripts/:** 0

Exportierte Funktionen/Konstanten: [`Protokoll`](../../src/components/Protokoll.tsx#L23)

### [`src/components/Pruefansicht.tsx`](../../src/components/Pruefansicht.tsx) · 207 Zeilen

**Verantwortung:** Prüfansicht — ein Gebäudescan auf dem Telefon (seit 1.70.0). **Warum es diese Ansicht gibt.** Der Monteur scannt mit dem iPhone, RaVia  
**Abhängigkeiten:** `components/Editor2D.tsx`, `components/ValidationPanel.tsx`, `lib/validation.ts`, `store/korrekturDialog.ts`, `store/useBimStore.ts`  
**Aufrufer:** `App.tsx`  
**Aufrufer in scripts/:** 0

Exportierte Funktionen/Konstanten: [`Pruefansicht`](../../src/components/Pruefansicht.tsx#L65)

### [`src/components/RaumnameFeld.tsx`](../../src/components/RaumnameFeld.tsx) · 74 Zeilen

**Verantwortung:** Das Namensfeld eines Raums — frei tippen oder aus der Liste wählen. **Warum `<datalist>` und kein eigenes Aufklappmenü.** Die Liste ist ein  
**Abhängigkeiten:** `lib/raumnutzung.ts`, `types/bim.ts`  
**Aufrufer:** `App.tsx`, `components/PropertiesPanel.tsx`, `components/RoomBook.tsx`  
**Aufrufer in scripts/:** 0

Exportierte Funktionen/Konstanten: [`RAUMNAMEN_LISTE`](../../src/components/RaumnameFeld.tsx#L28)⁰, [`RaumnamenListe`](../../src/components/RaumnameFeld.tsx#L30), [`RaumnameFeld`](../../src/components/RaumnameFeld.tsx#L46)

### [`src/components/RohrnetzDialog.tsx`](../../src/components/RohrnetzDialog.tsx) · 406 Zeilen

**Verantwortung:** RohrnetzDialog — Rohrnetzberechnung ansehen, prüfen und als PDF sichern. Drei Dinge in einem Fenster, weil sie beim Arbeiten zusammengehören:  
**Abhängigkeiten:** `components/Protokoll.tsx`, `lib/formteile.ts`, `lib/pipeReport.ts`, `lib/pipeReportPrint.ts`, `lib/planPrint.ts`, `lib/plantDefaults.ts`, `lib/wissensbasis.ts`, `lib/zahl.ts`, `store/useBimStore.ts`, `types/bim.ts`  
**Aufrufer:** `components/GuidePanel.tsx`, `components/Toolbar.tsx`  
**Aufrufer in scripts/:** 0

Exportierte Funktionen/Konstanten: [`RohrnetzDialog`](../../src/components/RohrnetzDialog.tsx#L33)

### [`src/components/RoofPanel.tsx`](../../src/components/RoofPanel.tsx) · 808 Zeilen

**Verantwortung:** RoofPanel — das Dach über dem aktiven Geschoss. Bewusst wenige Eingaben: Form, Neigung, Kniestock, Firstrichtung. Alles  
**Abhängigkeiten:** `components/Erklaerung.tsx`, `lib/dachlandschaft.ts`, `lib/roofGeometry.ts`, `lib/roomDetection.ts`, `lib/zahl.ts`, `store/useBimStore.ts`, `types/bim.ts`  
**Aufrufer:** `App.tsx`  
**Aufrufer in scripts/:** 0

Exportierte Funktionen/Konstanten: [`RoofPanel`](../../src/components/RoofPanel.tsx#L49)

### [`src/components/RoomBook.tsx`](../../src/components/RoomBook.tsx) · 509 Zeilen

**Verantwortung:** RoomBook — das Raumbuch. Alle Räume in einer Tabelle statt Raum für Raum durchklicken. Genau die  
**Abhängigkeiten:** `components/RaumnameFeld.tsx`, `lib/normleistung.ts`, `lib/raviaExport.ts`, `lib/rohrImRaum.ts`, `lib/zahl.ts`, `store/useBimStore.ts`, `types/bim.ts`  
**Aufrufer:** `App.tsx`  
**Aufrufer in scripts/:** 0

Exportierte Funktionen/Konstanten: [`RoomBook`](../../src/components/RoomBook.tsx#L37)

### [`src/components/ScanDialog.tsx`](../../src/components/ScanDialog.tsx) · 428 Zeilen

**Verantwortung:** Der Dialog „Mit RaVia Scan scannen". Verdrahtet nur — was er tut und warum, steht in `lib/scanDienst.ts`.  
**Abhängigkeiten:** `lib/scanDienst.ts`, `services/qrBild.ts`, `store/scanDialog.ts`, `store/useBimStore.ts`  
**Aufrufer:** `App.tsx`  
**Aufrufer in scripts/:** 0

Exportierte Funktionen/Konstanten: [`ScanDialog`](../../src/components/ScanDialog.tsx#L73)

### [`src/components/ScanUebernahme.tsx`](../../src/components/ScanUebernahme.tsx) · 140 Zeilen

**Verantwortung:** Den LiDAR-Scan übernehmen — als Datei. **Warum es diesen Block gibt.** Ein Gebäudescan aus **RaVia Scan** (iPhone,  
**Abhängigkeiten:** `store/scanDialog.ts`, `store/useBimStore.ts`  
**Aufrufer:** `components/ImageUploader.tsx`  
**Aufrufer in scripts/:** 0

Exportierte Funktionen/Konstanten: [`ScanUebernahme`](../../src/components/ScanUebernahme.tsx#L31)

### [`src/components/SchemaView.tsx`](../../src/components/SchemaView.tsx) · 1164 Zeilen

**Verantwortung:** SchemaView — das Anlagenschema als Zeichnung. Ein Grundriss sagt, wo etwas steht. Ein Anlagenschema sagt, woran es hängt.  
**Abhängigkeiten:** `components/AnlagenDialog.tsx`, `lib/plantDesign.ts`, `lib/schemaBeschriftung.ts`, `lib/schemaLeitung.ts`, `lib/schemaUebersicht.ts`, `lib/schemaZuordnung.ts`, `lib/schematicPrint.ts`, `lib/schematicSymbols.ts`, `lib/uebersichtZeichnen.ts`, `lib/zahl.ts`, `store/useBimStore.ts`, `types/bim.ts`  
**Aufrufer:** `App.tsx`  
**Aufrufer in scripts/:** 0

Exportierte Funktionen/Konstanten: [`SchemaView`](../../src/components/SchemaView.tsx#L102)

### [`src/components/SkizzenLeiste.tsx`](../../src/components/SkizzenLeiste.tsx) · 158 Zeilen

**Verantwortung:** SkizzenLeiste — was aus dem Freihandstrich geworden ist, und was damit geschehen soll.  
**Abhängigkeiten:** `store/useBimStore.ts`, `types/bim.ts`  
**Aufrufer:** `components/Editor2D.tsx`  
**Aufrufer in scripts/:** 0

Exportierte Funktionen/Konstanten: [`SkizzenLeiste`](../../src/components/SkizzenLeiste.tsx#L25)

### [`src/components/SkizzenSeite.tsx`](../../src/components/SkizzenSeite.tsx) · 450 Zeilen

**Verantwortung:** Die Skizzenseite — ein Blatt Papier im Hauptbereich. **Der Unterschied zum Skizzenblatt über dem Plan.** Dort zeichnet man in das  
**Abhängigkeiten:** `lib/skizzenseite.ts`, `lib/zahl.ts`, `store/useBimStore.ts`, `types/bim.ts`  
**Aufrufer:** `App.tsx`  
**Aufrufer in scripts/:** 0

Exportierte Funktionen/Konstanten: [`SkizzenSeite`](../../src/components/SkizzenSeite.tsx#L49)

### [`src/components/Skizzenblatt.tsx`](../../src/components/Skizzenblatt.tsx) · 103 Zeilen

**Verantwortung:** Das Skizzenblatt — Vollbild, vier Knöpfe, Finger oder Stift. **Der Anlass.** Das Werkzeug „Freihand skizzieren" gibt es seit langem, und  
**Abhängigkeiten:** `store/useBimStore.ts`  
**Aufrufer:** `App.tsx`  
**Aufrufer in scripts/:** 0

Exportierte Funktionen/Konstanten: [`Skizzenblatt`](../../src/components/Skizzenblatt.tsx#L26)

### [`src/components/StatusBar.tsx`](../../src/components/StatusBar.tsx) · 180 Zeilen

**Verantwortung:** StatusBar — die schmale Zeile, die während der Arbeit alles Nötige zeigt: aktives Werkzeug, Live-Maße, Fangstatus, Zoom und Modellumfang.  
**Abhängigkeiten:** `components/EntfernenKnopf.tsx`, `lib/normleistung.ts`, `lib/zahl.ts`, `store/useBimStore.ts`  
**Aufrufer:** `App.tsx`  
**Aufrufer in scripts/:** 0

Exportierte Funktionen/Konstanten: [`StatusBar`](../../src/components/StatusBar.tsx#L57)

### [`src/components/TgaPalette.tsx`](../../src/components/TgaPalette.tsx) · 488 Zeilen

**Verantwortung:** TgaPalette — Symbolbibliothek für Heizung, Sanitär und Lüftung. Jedes Symbol wird als echte Vorschau gerendert: dieselbe Zeichenroutine wie  
**Abhängigkeiten:** `lib/fixtureSymbols.ts`, `lib/normleistung.ts`, `lib/pipeNetwork.ts`, `lib/zahl.ts`, `store/useBimStore.ts`, `types/bim.ts`  
**Aufrufer:** `App.tsx`  
**Aufrufer in scripts/:** 0

Exportierte Funktionen/Konstanten: [`TgaPalette`](../../src/components/TgaPalette.tsx#L27)

### [`src/components/ThermalBridgePanel.tsx`](../../src/components/ThermalBridgePanel.tsx) · 352 Zeilen

**Verantwortung:** ThermalBridgePanel — Wärmebrücken pauschal oder längenbezogen. Der Kern dieses Panels ist nicht die Eingabe, sondern die **Gegenprobe**:  
**Abhängigkeiten:** `components/Erklaerung.tsx`, `lib/thermalBridges.ts`, `store/useBimStore.ts`, `types/bim.ts`  
**Aufrufer:** `App.tsx`  
**Aufrufer in scripts/:** 0

Exportierte Funktionen/Konstanten: [`ThermalBridgePanel`](../../src/components/ThermalBridgePanel.tsx#L43)

### [`src/components/Toolbar.tsx`](../../src/components/Toolbar.tsx) · 1448 Zeilen

**Verantwortung:** Toolbar — Werkzeugleiste (vertikal) und Kopfzeile. Beide teilen sich die Icon-Sprache: 1,4 px Vektorlinien, keine Flächen,  
**Abhängigkeiten:** `components/Flaggen.tsx`, `components/LevelBar.tsx`, `components/MappeDialog.tsx`, `components/PlanPrintDialog.tsx`, `components/RohrnetzDialog.tsx`, `lib/buildingModelImport.ts`, `lib/ifcExport.ts`, `lib/planLeeren.ts`, `lib/plantDefaults.ts`, `lib/raumplanImport.ts`, `lib/raviaExport.ts`, `lib/sprache.ts`, `lib/uimodus.ts`, `lib/zahl.ts`, `store/useBimStore.ts`, `types/bim.ts`  
**Aufrufer:** `App.tsx`  
**Aufrufer in scripts/:** 0

Exportierte Funktionen/Konstanten: [`ToolRail`](../../src/components/Toolbar.tsx#L171), [`TopBar`](../../src/components/Toolbar.tsx#L467)

### [`src/components/ValidationPanel.tsx`](../../src/components/ValidationPanel.tsx) · 220 Zeilen

**Verantwortung:** ValidationPanel — der Prüfbericht vor der Übergabe. Jeder Befund ist anklickbar und springt auf das betroffene Objekt. Das ist  
**Abhängigkeiten:** `lib/uimodus.ts`, `lib/validation.ts`, `store/useBimStore.ts`, `types/bim.ts`  
**Aufrufer:** `App.tsx`, `components/Pruefansicht.tsx`  
**Aufrufer in scripts/:** 0

Exportierte Funktionen/Konstanten: [`ValidationPanel`](../../src/components/ValidationPanel.tsx#L21)

### [`src/components/VentilationPanel.tsx`](../../src/components/VentilationPanel.tsx) · 299 Zeilen

**Verantwortung:** VentilationPanel — das Lüftungskonzept. In einem dichten Neubau entscheidet die Lüftung über einen guten Teil der  
**Abhängigkeiten:** `components/Erklaerung.tsx`, `store/useBimStore.ts`, `types/bim.ts`  
**Aufrufer:** `App.tsx`  
**Aufrufer in scripts/:** 0

Exportierte Funktionen/Konstanten: [`VentilationPanel`](../../src/components/VentilationPanel.tsx#L40)

### [`src/components/Viewer3D.tsx`](../../src/components/Viewer3D.tsx) · 5683 Zeilen

**Verantwortung:** Viewer3D — Three.js-Echtzeitansicht im Clay-/Architekturmodell-Look. Renderstrategie:  
**Abhängigkeiten:** `lib/baugrube.ts`, `lib/begehen.ts`, `lib/beschriftung3d.ts`, `lib/bodenbelag.ts`, `lib/dachlandschaft.ts`, `lib/dachschnitt.ts`, `lib/durchbruchSymbols.ts`, `lib/ebenen.ts`, `lib/fussbodenkurven.ts`, `lib/geometry.ts`, `lib/griffe.ts`, `lib/kaeltemittel.ts`, `lib/kompass.ts`, `lib/levelGeometry.ts`, `lib/raumtreffer.ts`, `lib/rohrbezeichnung.ts`, `lib/rohrlaenge.ts`, `lib/roofGeometry.ts`, `lib/slabGeometry.ts`, `lib/treppenlogik.ts`, `lib/verticalSymbols.ts`, `lib/wallGeometry.ts`, `lib/wandfuehrung.ts`, `lib/werkzeugkiste.ts`, `lib/zahl.ts`, `store/useBimStore.ts`, `types/bim.ts`  
**Aufrufer:** `App.tsx`, `components/Pruefansicht.tsx`  
**Aufrufer in scripts/:** 0

Exportierte Funktionen/Konstanten: [`Viewer3D`](../../src/components/Viewer3D.tsx#L1819)⁰

### [`src/lib/anlagenFragen.ts`](../../src/lib/anlagenFragen.ts) · 474 Zeilen

**Verantwortung:** Aus sieben Antworten wird eine Anlage. **Was hier passiert.** Der Anwender sagt, was er baut — Bauart des  
**Abhängigkeiten:** `types/bim.ts`  
**Aufrufer:** `components/AnlagenDialog.tsx`, `components/AnlagenFragen.tsx`, `components/AnlagenPanel.tsx`, `lib/plantDesign.ts`, `store/useBimStore.ts`  
**Aufrufer in scripts/:** 2

Exportierte Funktionen/Konstanten: [`kaeltemittelImHaus`](../../src/lib/anlagenFragen.ts#L66), [`hatHeizstab`](../../src/lib/anlagenFragen.ts#L79), [`hatInneneinheit`](../../src/lib/anlagenFragen.ts#L84), [`heizstabImSpeicher`](../../src/lib/anlagenFragen.ts#L97), [`antwortenDes`](../../src/lib/anlagenFragen.ts#L118), [`kaeltemittelHinweis`](../../src/lib/anlagenFragen.ts#L142), [`anlageAusAntworten`](../../src/lib/anlagenFragen.ts#L193), [`abweichungen`](../../src/lib/anlagenFragen.ts#L335), [`antwortenAusAnlage`](../../src/lib/anlagenFragen.ts#L449)

### [`src/lib/anlagenhinweise.ts`](../../src/lib/anlagenhinweise.ts) · 107 Zeilen

**Verantwortung:** Drei Befunde zur Anlage, die aus Zahlen folgen, die längst im Modell stehen. **Warum sie hier und nicht in `validation.ts` stehen.** Alle drei sind  
**Abhängigkeiten:** –  
**Aufrufer:** `lib/validation.ts`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`VORLAUF_EINSTIEG`](../../src/lib/anlagenhinweise.ts#L44)⁰, [`LADEKREIS_SPREIZUNG_MAX`](../../src/lib/anlagenhinweise.ts#L46)⁰, [`HEIZGRENZE`](../../src/lib/anlagenhinweise.ts#L48)⁰, [`anlagenHinweise`](../../src/lib/anlagenhinweise.ts#L50)

### [`src/lib/annotationSymbols.ts`](../../src/lib/annotationSymbols.ts) · 311 Zeilen

**Verantwortung:** Planbeschriftung: freie Maßketten, Texte und Hinweisfahnen. Die automatischen Wandmaße nehmen einem die Fleißarbeit ab, aber sie  
**Abhängigkeiten:** `lib/beschriftung3d.ts`, `types/bim.ts`  
**Aufrufer:** `components/Editor2D.tsx`, `components/PropertiesPanel.tsx`, `lib/planPrint.ts`  
**Aufrufer in scripts/:** 2

Exportierte Funktionen/Konstanten: [`ANNOTATION_COLORS`](../../src/lib/annotationSymbols.ts#L16)⁰, [`annotationLength`](../../src/lib/annotationSymbols.ts#L23), [`annotationText`](../../src/lib/annotationSymbols.ts#L31), [`planbeschriftungsText`](../../src/lib/annotationSymbols.ts#L67), [`dimensionLine`](../../src/lib/annotationSymbols.ts#L79), [`drawAnnotation`](../../src/lib/annotationSymbols.ts#L94), [`textBreitePx`](../../src/lib/annotationSymbols.ts#L228)⁰, [`textKasten`](../../src/lib/annotationSymbols.ts#L250), [`distanceToAnnotation`](../../src/lib/annotationSymbols.ts#L279)

### [`src/lib/anschlussgroesse.ts`](../../src/lib/anschlussgroesse.ts) · 477 Zeilen

**Verantwortung:** Die Anschlussgröße des Wärmeerzeugers — und was sie für die Leitung bedeutet. **Warum es diese Datei gibt.** Ein Heizungsfachplaner formuliert den Befund  
**Abhängigkeiten:** –  
**Aufrufer:** `components/HeatPumpPanel.tsx`, `lib/pipeLayout.ts`, `lib/pipeReport.ts`, `lib/plantDesign.ts`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`ZOLL_NENNWEITE`](../../src/lib/anschlussgroesse.ts#L76)⁰, [`NENNWEITE_GEWINDE`](../../src/lib/anschlussgroesse.ts#L98), [`KUPFER_NENNWEITE`](../../src/lib/anschlussgroesse.ts#L127)⁰, [`nennweiteAusText`](../../src/lib/anschlussgroesse.ts#L176), [`anschlusstext`](../../src/lib/anschlussgroesse.ts#L259), [`anschlussVonGeraet`](../../src/lib/anschlussgroesse.ts#L309), [`pruefeAnschluss`](../../src/lib/anschlussgroesse.ts#L400), [`anschlussNotiz`](../../src/lib/anschlussgroesse.ts#L438), [`deutungsNotiz`](../../src/lib/anschlussgroesse.ts#L467)

### [`src/lib/aufnahme.ts`](../../src/lib/aufnahme.ts) · 287 Zeilen

**Verantwortung:** Die Aufnahme Zimmer für Zimmer — die Rechenseite. **Wofür.** Wer noch nie ein CAD bedient hat, scheitert nicht an der Zahl  
**Abhängigkeiten:** `types/bim.ts`  
**Aufrufer:** `components/AufnahmeAssistent.tsx`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`RAUMARTEN`](../../src/lib/aufnahme.ts#L55), [`raumart`](../../src/lib/aufnahme.ts#L68), [`ANBAU_LABELS`](../../src/lib/aufnahme.ts#L79), [`platziere`](../../src/lib/aufnahme.ts#L111), [`ecken`](../../src/lib/aufnahme.ts#L131), [`achsflaeche`](../../src/lib/aufnahme.ts#L136), [`seitenkanten`](../../src/lib/aufnahme.ts#L141), [`seiteBelegt`](../../src/lib/aufnahme.ts#L167), [`fensterseite`](../../src/lib/aufnahme.ts#L196), [`FENSTER_REGELBREITE`](../../src/lib/aufnahme.ts#L224)⁰, [`PFEILER_MIN`](../../src/lib/aufnahme.ts#L225)⁰, [`fensterPlatz`](../../src/lib/aufnahme.ts#L227), [`fensterLagen`](../../src/lib/aufnahme.ts#L240), [`merkeAnnahme`](../../src/lib/aufnahme.ts#L251), [`loescheAnnahme`](../../src/lib/aufnahme.ts#L256), [`GEBAEUDE_FRAGEN`](../../src/lib/aufnahme.ts#L265), [`RAUM_FRAGEN`](../../src/lib/aufnahme.ts#L268)⁰, [`raumFragen`](../../src/lib/aufnahme.ts#L271), [`fortschritt`](../../src/lib/aufnahme.ts#L283)

### [`src/lib/aufstellgeschoss.ts`](../../src/lib/aufstellgeschoss.ts) · 108 Zeilen

**Verantwortung:** Auf welchem Geschoss ein Gerät des Außengeländes angefasst wird. **Das Problem, das dieses Modul löst.** Die Wärmepumpe liegt in  
**Abhängigkeiten:** `types/bim.ts`  
**Aufrufer:** `components/Editor2D.tsx`, `lib/gebaeudeNetz.ts`, `lib/pipeLayout.ts`, `store/useBimStore.ts`  
**Aufrufer in scripts/:** 2

Exportierte Funktionen/Konstanten: [`aufstellgeschoss`](../../src/lib/aufstellgeschoss.ts#L40), [`stehtAufGeschoss`](../../src/lib/aufstellgeschoss.ts#L63), [`einfuehrungsgeschoss`](../../src/lib/aufstellgeschoss.ts#L87), [`fuehrtEinAufGeschoss`](../../src/lib/aufstellgeschoss.ts#L105)

### [`src/lib/auslegungExport.ts`](../../src/lib/auslegungExport.ts) · 337 Zeilen

**Verantwortung:** Die Eingangsgrößen der Auslegung — als Block für den Rechenkern. **Warum es diese Datei gibt.** Eine Lückenanalyse vor der Übergabe an RaVia  
**Abhängigkeiten:** `lib/erzeugerHydraulik.ts`, `lib/hydraulicBalance.ts`, `lib/normleistung.ts`, `types/bim.ts`  
**Aufrufer:** `lib/heizflaechenLeistung.ts`, `lib/raviaExport.ts`  
**Aufrufer in scripts/:** 2

Exportierte Funktionen/Konstanten: [`EMITTER_EXPONENT_ANNAHME`](../../src/lib/auslegungExport.ts#L62), [`NORM_TEMPERATUREN`](../../src/lib/auslegungExport.ts#L69), [`buildEmitters`](../../src/lib/auslegungExport.ts#L96), [`buildHydraulics`](../../src/lib/auslegungExport.ts#L223)

### [`src/lib/aussenwand.ts`](../../src/lib/aussenwand.ts) · 326 Zeilen

**Verantwortung:** Außenwände — erkennen und auf das nächste Geschoss übernehmen. **Warum es diese Datei gibt.** Steht der erste Grundriss, ist die  
**Abhängigkeiten:** `lib/roomDetection.ts`, `types/bim.ts`  
**Aufrufer:** `components/LevelBar.tsx`, `store/useBimStore.ts`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`UEBERNAHME_TOLERANZ`](../../src/lib/aussenwand.ts#L66), [`aussenwaendeVon`](../../src/lib/aussenwand.ts#L112), [`planeUebernahme`](../../src/lib/aussenwand.ts#L219), [`uebernahmeSinnvoll`](../../src/lib/aussenwand.ts#L317)

### [`src/lib/auswahlNamen.ts`](../../src/lib/auswahlNamen.ts) · 101 Zeilen

**Verantwortung:** Wie heißt das, was gerade angefasst ist? **Warum das eine eigene Datei ist.** Der Entfernen-Knopf soll nicht  
**Abhängigkeiten:** `types/bim.ts`  
**Aufrufer:** `components/EntfernenKnopf.tsx`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`AUSWAHL_NAME`](../../src/lib/auswahlNamen.ts#L28), [`auswahlName`](../../src/lib/auswahlNamen.ts#L73), [`entfernenAufschrift`](../../src/lib/auswahlNamen.ts#L94)

### [`src/lib/autokorrektur.ts`](../../src/lib/autokorrektur.ts) · 928 Zeilen

**Verantwortung:** Grundriss prüfen und korrigieren — ein Durchlauf, der vorher fragt. Ein aufgemessener oder eingelesener Grundriss hat immer dieselbe Handvoll  
**Abhängigkeiten:** `lib/begradigen.ts`, `lib/doppelwaende.ts`, `lib/geometry.ts`, `lib/leitungsbefund.ts`, `lib/luecken.ts`, `lib/roomDetection.ts`, `types/bim.ts`  
**Aufrufer:** `components/KorrekturDialog.tsx`, `store/useBimStore.ts`  
**Aufrufer in scripts/:** 2

Exportierte Funktionen/Konstanten: [`ANSCHLUSS_TOLERANZ`](../../src/lib/autokorrektur.ts#L67), [`STUMMEL_LAENGE`](../../src/lib/autokorrektur.ts#L70)⁰, [`UEBERSTAND_LAENGE`](../../src/lib/autokorrektur.ts#L80)⁰, [`KLEINRAUM_FLAECHE`](../../src/lib/autokorrektur.ts#L83)⁰, [`findeAnschluesse`](../../src/lib/autokorrektur.ts#L288)⁰, [`findeStummel`](../../src/lib/autokorrektur.ts#L426)⁰, [`lueckenHinweis`](../../src/lib/autokorrektur.ts#L449)⁰, [`planeKorrektur`](../../src/lib/autokorrektur.ts#L456), [`kleineRaeume`](../../src/lib/autokorrektur.ts#L548), [`wendeKorrekturAn`](../../src/lib/autokorrektur.ts#L755), [`berichtSatz`](../../src/lib/autokorrektur.ts#L905)

### [`src/lib/autosave.ts`](../../src/lib/autosave.ts) · 233 Zeilen

**Verantwortung:** Autosave — der Schutz gegen den versehentlichen Reload. Der gesamte Dokumentzustand liegt im Arbeitsspeicher. Ein F5 zur falschen  
**Abhängigkeiten:** `lib/projectStore.ts`, `types/bim.ts`  
**Aufrufer:** `App.tsx`, `components/ProjektDialog.tsx`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`scheduleAutosave`](../../src/lib/autosave.ts#L68), [`cancelAutosave`](../../src/lib/autosave.ts#L87), [`saveNow`](../../src/lib/autosave.ts#L92), [`loadAutosave`](../../src/lib/autosave.ts#L180), [`clearAutosave`](../../src/lib/autosave.ts#L214), [`relativeTime`](../../src/lib/autosave.ts#L223)

### [`src/lib/baugrube.ts`](../../src/lib/baugrube.ts) · 143 Zeilen

**Verantwortung:** Die Baugrube — was man sieht, wenn man in den Keller schaut. **Das gemeldete Bild.** Wer im Modell die Geschosse über dem Keller  
**Abhängigkeiten:** `lib/slabGeometry.ts`, `lib/wallGeometry.ts`, `types/bim.ts`  
**Aufrufer:** `components/Viewer3D.tsx`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`ARBEITSRAUM`](../../src/lib/baugrube.ts#L45), [`baugrube`](../../src/lib/baugrube.ts#L92)

### [`src/lib/begehen.ts`](../../src/lib/begehen.ts) · 496 Zeilen

**Verantwortung:** begehen — die Regel, nach der man sich im Modell bewegt. **Warum das eine eigene Einheit ist.** Die 3D-Ansicht war bisher eine  
**Abhängigkeiten:** `lib/wallGeometry.ts`, `types/bim.ts`  
**Aufrufer:** `components/Viewer3D.tsx`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`AUGENHOEHE`](../../src/lib/begehen.ts#L32), [`TEMPO_GEHEN`](../../src/lib/begehen.ts#L35), [`TEMPO_SCHNELL`](../../src/lib/begehen.ts#L38), [`KOERPER_RADIUS`](../../src/lib/begehen.ts#L48), [`begehbar`](../../src/lib/begehen.ts#L77), [`hindernisse`](../../src/lib/begehen.ts#L90), [`loese`](../../src/lib/begehen.ts#L160), [`stecktFest`](../../src/lib/begehen.ts#L196), [`gehe`](../../src/lib/begehen.ts#L228), [`blickrichtung`](../../src/lib/begehen.ts#L263), [`NICK_GRENZE`](../../src/lib/begehen.ts#L269)⁰, [`begrenzeNick`](../../src/lib/begehen.ts#L271), [`schritt`](../../src/lib/begehen.ts#L282), [`TUER_REICHWEITE`](../../src/lib/begehen.ts#L300), [`TUER_OFFEN_WINKEL`](../../src/lib/begehen.ts#L310), [`TUER_TEMPO`](../../src/lib/begehen.ts#L320), [`tuerInReichweite`](../../src/lib/begehen.ts#L335), [`tritt`](../../src/lib/begehen.ts#L466)

### [`src/lib/begradigen.ts`](../../src/lib/begradigen.ts) · 263 Zeilen

**Verantwortung:** Wände gerade ziehen. Ein aufgemessener Grundriss steht nie ganz gerade. Beim Raumscan sind es  
**Abhängigkeiten:** `types/bim.ts`  
**Aufrufer:** `components/AufmassPanel.tsx`, `components/GuidePanel.tsx`, `lib/autokorrektur.ts`, `store/useBimStore.ts`  
**Aufrufer in scripts/:** 2

Exportierte Funktionen/Konstanten: [`achsAbweichung`](../../src/lib/begradigen.ts#L83), [`begradige`](../../src/lib/begradigen.ts#L115)

### [`src/lib/beschriftung3d.ts`](../../src/lib/beschriftung3d.ts) · 198 Zeilen

**Verantwortung:** Beschriften in der begehbaren Ansicht. Wer im Haus steht und einen Heizkörper anschaut, will „2000 W" daneben  
**Abhängigkeiten:** `lib/normleistung.ts`, `lib/rohrbezeichnung.ts`, `types/bim.ts`  
**Aufrufer:** `components/PropertiesPanel.tsx`, `components/Viewer3D.tsx`, `lib/annotationSymbols.ts`, `lib/werkzeugkiste.ts`, `store/useBimStore.ts`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`hoehenText`](../../src/lib/beschriftung3d.ts#L65), [`beschriftungsVorschlaege`](../../src/lib/beschriftung3d.ts#L78), [`modellwert`](../../src/lib/beschriftung3d.ts#L165), [`beschriftungVeraltet`](../../src/lib/beschriftung3d.ts#L178), [`planText`](../../src/lib/beschriftung3d.ts#L191)

### [`src/lib/beschriftungsLage.ts`](../../src/lib/beschriftungsLage.ts) · 209 Zeilen

**Verantwortung:** Wohin eine Beschriftung an einer Trasse gesetzt wird. **Warum es diese Datei gibt.** Eine Rohrbeschriftung („DN 12") wurde an zwei  
**Abhängigkeiten:** –  
**Aufrufer:** `lib/planPrint.ts`, `lib/schemaBeschriftung.ts`, `lib/verticalSymbols.ts`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`rechteckeUeberlappen`](../../src/lib/beschriftungsLage.ts#L119), [`beschriftungsHuelle`](../../src/lib/beschriftungsLage.ts#L131), [`findeBeschriftungslage`](../../src/lib/beschriftungsLage.ts#L167)

### [`src/lib/bivalenz.ts`](../../src/lib/bivalenz.ts) · 269 Zeilen

**Verantwortung:** Deckungsanteile einer bivalenten Anlage — Bivalenzpunkt und Jahresdauerlinie. **Woher die Aufgabe kommt.** Die RaVia-Seite hat am 01.10.2026 das Verfahren  
**Abhängigkeiten:** `types/bim.ts`  
**Aufrufer:** `components/AnlagenPanel.tsx`, `lib/plantDesign.ts`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`gebaeudelast`](../../src/lib/bivalenz.ts#L67), [`zeitanteilUnter`](../../src/lib/bivalenz.ts#L81), [`dauerlinie`](../../src/lib/bivalenz.ts#L88), [`BIVALENZ_HINDERNIS_TEXT`](../../src/lib/bivalenz.ts#L131), [`bivalenzanteile`](../../src/lib/bivalenz.ts#L167), [`vorschlagBivalenzpunkt`](../../src/lib/bivalenz.ts#L255)

### [`src/lib/bodenbelag.ts`](../../src/lib/bodenbelag.ts) · 99 Zeilen

**Verantwortung:** Wärmedurchlasswiderstand üblicher Bodenbeläge. **Wozu die Liste.** Der Belagswiderstand R_λB ist einer der drei Eingänge  
**Abhängigkeiten:** –  
**Aufrufer:** `components/Editor2D.tsx`, `components/PropertiesPanel.tsx`, `components/Viewer3D.tsx`, `lib/materialSchedule.ts`, `store/useBimStore.ts`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`BODENBELAEGE`](../../src/lib/bodenbelag.ts#L60), [`belagNach`](../../src/lib/bodenbelag.ts#L72), [`belagsWiderstand`](../../src/lib/bodenbelag.ts#L84), [`BELAG_WIDERSTAND`](../../src/lib/bodenbelag.ts#L89), [`BELAG_GRENZE`](../../src/lib/bodenbelag.ts#L98)

### [`src/lib/buildingModelImport.ts`](../../src/lib/buildingModelImport.ts) · 788 Zeilen

**Verantwortung:** Import des „RaVia Building Model" (Format `ravia.building`, Schema 1.x). Das Gegenstück zur App **RaVia Scan**: Das iPhone scannt mit **LiDAR**  
**Abhängigkeiten:** `lib/raumplanImport.ts`, `lib/uwert.ts`, `types/bim.ts`  
**Aufrufer:** `components/Toolbar.tsx`, `lib/scanUebernahme.ts`, `store/useBimStore.ts`  
**Aufrufer in scripts/:** 8

Exportierte Funktionen/Konstanten: [`BUILDING_FORMAT`](../../src/lib/buildingModelImport.ts#L54)⁰, [`istGebaeudescan`](../../src/lib/buildingModelImport.ts#L69), [`randAusScan`](../../src/lib/buildingModelImport.ts#L229), [`istBuildingModel`](../../src/lib/buildingModelImport.ts#L251), [`importBuildingModel`](../../src/lib/buildingModelImport.ts#L255)

### [`src/lib/dachlandschaft.ts`](../../src/lib/dachlandschaft.ts) · 385 Zeilen

**Verantwortung:** Mehrere Dächer über einem Geschoss — die Dachlandschaft. **Der Befund, auf den dieses Modul antwortet.** Bis 1.35.0 trug ein  
**Abhängigkeiten:** `lib/geometry.ts`, `lib/roofGeometry.ts`, `lib/roomDetection.ts`, `types/bim.ts`  
**Aufrufer:** `components/Editor2D.tsx`, `components/RoofPanel.tsx`, `components/Viewer3D.tsx`, `lib/ifcExport.ts`, `lib/raviaExport.ts`, `lib/spiegeln.ts`, `lib/thermalBridges.ts`, `lib/validation.ts`, `store/useBimStore.ts`  
**Aufrufer in scripts/:** 5

Exportierte Funktionen/Konstanten: [`daecherVon`](../../src/lib/dachlandschaft.ts#L79), [`baueDachlandschaft`](../../src/lib/dachlandschaft.ts#L154), [`dachteilAn`](../../src/lib/dachlandschaft.ts#L214), [`frameAn`](../../src/lib/dachlandschaft.ts#L254), [`frameUeberWand`](../../src/lib/dachlandschaft.ts#L270), [`frameFuerRaum`](../../src/lib/dachlandschaft.ts#L296), [`raeumeOhneGeschossDarueber`](../../src/lib/dachlandschaft.ts#L321), [`raeumeMitGeschossDarueber`](../../src/lib/dachlandschaft.ts#L351), [`dachUeberRaum`](../../src/lib/dachlandschaft.ts#L381)

### [`src/lib/dachschnitt.ts`](../../src/lib/dachschnitt.ts) · 738 Zeilen

**Verantwortung:** Polygonschnitt unter der Dachfläche — Wandoberseiten und Dachhaut. **Der Befund (Feldscan 02.10.2026, Auftrag A2).** In der 3D-Ansicht hatten  
**Abhängigkeiten:** `lib/geometry.ts`, `lib/roofGeometry.ts`, `lib/wallGeometry.ts`, `types/bim.ts`  
**Aufrufer:** `components/Viewer3D.tsx`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`knickgeraden`](../../src/lib/dachschnitt.ts#L98), [`zerteile`](../../src/lib/dachschnitt.ts#L285)⁰, [`ebeneStuecke`](../../src/lib/dachschnitt.ts#L357)⁰, [`wandUnterDach`](../../src/lib/dachschnitt.ts#L500), [`tiefsteDachhoehe`](../../src/lib/dachschnitt.ts#L596), [`ohrenschnitt`](../../src/lib/dachschnitt.ts#L627), [`dachhaut`](../../src/lib/dachschnitt.ts#L675), [`hoeheAufEbene`](../../src/lib/dachschnitt.ts#L735)

### [`src/lib/deviceCatalog.ts`](../../src/lib/deviceCatalog.ts) · 1042 Zeilen

**Verantwortung:** Gerätekatalog — Wärmeerzeuger und Speicher als Typklassen. **Was hier steht und was nicht.**  
**Abhängigkeiten:** `lib/erzeugerHydraulik.ts`, `lib/kaeltemittel.ts`, `lib/zahl.ts`, `types/bim.ts`  
**Aufrufer:** `components/AnlagenPanel.tsx`, `components/HeatPumpPanel.tsx`, `lib/deviceImport.ts`, `lib/domesticWater.ts`, `lib/materialSchedule.ts`, `lib/pipeLayout.ts`, `lib/plantBook.ts`, `lib/plantDesign.ts`  
**Aufrufer in scripts/:** 7

Exportierte Funktionen/Konstanten: [`REFRIGERANTS`](../../src/lib/deviceCatalog.ts#L58), [`minimumRoomVolume`](../../src/lib/deviceCatalog.ts#L116), [`hatAusseneinheit`](../../src/lib/deviceCatalog.ts#L174), [`hatInnengeraet`](../../src/lib/deviceCatalog.ts#L185)⁰, [`anschlussStufe`](../../src/lib/deviceCatalog.ts#L574), [`HEAT_PUMP_CATALOG`](../../src/lib/deviceCatalog.ts#L762), [`HEAT_PUMP_SERIES`](../../src/lib/deviceCatalog.ts#L765), [`findModel`](../../src/lib/deviceCatalog.ts#L768), [`capacityAt`](../../src/lib/deviceCatalog.ts#L799), [`matchModels`](../../src/lib/deviceCatalog.ts#L840), [`STORAGE_CATALOG`](../../src/lib/deviceCatalog.ts#L991), [`selectStorage`](../../src/lib/deviceCatalog.ts#L1000), [`minimumBufferVolume`](../../src/lib/deviceCatalog.ts#L1018)

### [`src/lib/deviceImport.ts`](../../src/lib/deviceImport.ts) · 2960 Zeilen

**Verantwortung:** Datenblätter einlesen — von der Typklasse zum belastbaren Gerät. Der Gerätekatalog in `deviceCatalog.ts` enthält bewusst nur Typklassen  
**Abhängigkeiten:** `lib/deviceCatalog.ts`, `types/bim.ts`  
**Aufrufer:** `components/AnlagenPanel.tsx`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`parseCsv`](../../src/lib/deviceImport.ts#L303), [`detectDecimalStyle`](../../src/lib/deviceImport.ts#L428), [`normalizeHeading`](../../src/lib/deviceImport.ts#L613)⁰, [`importDevicesFromCsv`](../../src/lib/deviceImport.ts#L2579)⁰, [`importDevicesFromJson`](../../src/lib/deviceImport.ts#L2682)⁰, [`importDevices`](../../src/lib/deviceImport.ts#L2761), [`mergeIntoCatalog`](../../src/lib/deviceImport.ts#L2814), [`buildCsvTemplate`](../../src/lib/deviceImport.ts#L2922)

### [`src/lib/domesticWater.ts`](../../src/lib/domesticWater.ts) · 1440 Zeilen

**Verantwortung:** Trinkwassererwärmung und Trinkwasserinstallation. **Warum es dieses Modul gibt.**  
**Abhängigkeiten:** `lib/deviceCatalog.ts`, `lib/hydraulics.ts`, `types/bim.ts`  
**Aufrufer:** `lib/plantBook.ts`, `lib/plantDesign.ts`, `types/bim.ts`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`HEAT_PER_LITRE_KELVIN`](../../src/lib/domesticWater.ts#L75)⁰, [`COLD_WATER_REFERENCE`](../../src/lib/domesticWater.ts#L85)⁰, [`mixedVolume`](../../src/lib/domesticWater.ts#L98), [`UNIT_DWELLING`](../../src/lib/domesticWater.ts#L128)⁰, [`TAP_POINTS`](../../src/lib/domesticWater.ts#L183)⁰, [`demandIndex`](../../src/lib/domesticWater.ts#L324)⁰, [`defaultTapPoints`](../../src/lib/domesticWater.ts#L422)⁰, [`DAILY_DEMAND_PER_PERSON`](../../src/lib/domesticWater.ts#L443)⁰, [`DAILY_DEMAND_TEMPERATURE`](../../src/lib/domesticWater.ts#L450)⁰, [`sizeStorage`](../../src/lib/domesticWater.ts#L527)⁰, [`reheatPower`](../../src/lib/domesticWater.ts#L690)⁰, [`LARGE_PLANT_VOLUME_LIMIT`](../../src/lib/domesticWater.ts#L762)⁰, [`THREE_LITRE_LIMIT`](../../src/lib/domesticWater.ts#L771)⁰, [`assessLegionella`](../../src/lib/domesticWater.ts#L831)⁰, [`contentPerMetre`](../../src/lib/domesticWater.ts#L941)⁰, [`branchContent`](../../src/lib/domesticWater.ts#L963)⁰, [`insulatedPipeLoss`](../../src/lib/domesticWater.ts#L1031)⁰, [`assessCirculation`](../../src/lib/domesticWater.ts#L1076)⁰, [`hygieneNotes`](../../src/lib/domesticWater.ts#L1154)⁰, [`designDomesticHotWater`](../../src/lib/domesticWater.ts#L1267)

### [`src/lib/doppelleitung.ts`](../../src/lib/doppelleitung.ts) · 134 Zeilen

**Verantwortung:** Vor- und Rücklauf als ein Bauteil. **Was eine Doppelleitung ist.** Im Plan sind es zwei Linien, im Bau ist es  
**Abhängigkeiten:** `types/bim.ts`  
**Aufrufer:** `lib/pipeLayout.ts`, `store/useBimStore.ts`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`PAARABSTAND`](../../src/lib/doppelleitung.ts#L29), [`versetzeQuer`](../../src/lib/doppelleitung.ts#L55), [`bildePaar`](../../src/lib/doppelleitung.ts#L111), [`partnerVon`](../../src/lib/doppelleitung.ts#L127)

### [`src/lib/doppelwaende.ts`](../../src/lib/doppelwaende.ts) · 98 Zeilen

**Verantwortung:** Doppelte Wände finden — zwei Kanten zwischen denselben beiden Knoten. **Woher sie kommen.** Beim Anlegen einer Raumvorlage wird erst der Ring  
**Abhängigkeiten:** –  
**Aufrufer:** `lib/autokorrektur.ts`, `store/useBimStore.ts`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`doppelteWaende`](../../src/lib/doppelwaende.ts#L71), [`gespiegelt`](../../src/lib/doppelwaende.ts#L95)

### [`src/lib/druckFenster.ts`](../../src/lib/druckFenster.ts) · 97 Zeilen

**Verantwortung:** Das Druckfenster — ein Weg für alle fünf Ausdrucke. **Der Anlass.** Bis 1.14.0 schrieb jeder der fünf Druckwege  
**Abhängigkeiten:** –  
**Aufrufer:** `lib/pipeReportPrint.ts`, `lib/planPrint.ts`, `lib/plantBook.ts`, `lib/projektMappe.ts`, `lib/schematicPrint.ts`  
**Aufrufer in scripts/:** 0

Exportierte Funktionen/Konstanten: [`druckeDokument`](../../src/lib/druckFenster.ts#L39), [`loeseDruckAus`](../../src/lib/druckFenster.ts#L77)⁰

### [`src/lib/durchbruchSymbols.ts`](../../src/lib/durchbruchSymbols.ts) · 428 Zeilen

**Verantwortung:** Durchbrüche im Grundriss — Geometrie und Zeichnung. Ein Durchbruch ist das einzige Bauteil in diesem Modell, dessen Lage von  
**Abhängigkeiten:** `lib/wallGeometry.ts`, `types/bim.ts`  
**Aufrufer:** `components/Editor2D.tsx`, `components/PropertiesPanel.tsx`, `components/Viewer3D.tsx`, `lib/eckpunkte.ts`, `lib/ifcExport.ts`, `lib/planPrint.ts`, `lib/raviaExport.ts`, `lib/slabGeometry.ts`, `lib/validation.ts`  
**Aufrufer in scripts/:** 2

Exportierte Funktionen/Konstanten: [`RUND_SEGMENTE`](../../src/lib/durchbruchSymbols.ts#L23)⁰, [`DURCHBRUCH_COLORS`](../../src/lib/durchbruchSymbols.ts#L33)⁰, [`durchbruchFlaeche`](../../src/lib/durchbruchSymbols.ts#L42), [`durchbruchMitte`](../../src/lib/durchbruchSymbols.ts#L69), [`durchbruchUmriss`](../../src/lib/durchbruchSymbols.ts#L88), [`deckendurchbruchUmriss`](../../src/lib/durchbruchSymbols.ts#L115), [`durchbruecheAufGeschoss`](../../src/lib/durchbruchSymbols.ts#L155), [`trifftDurchbruch`](../../src/lib/durchbruchSymbols.ts#L181), [`durchbruchBeschriftung`](../../src/lib/durchbruchSymbols.ts#L202), [`zeichneDurchbruch`](../../src/lib/durchbruchSymbols.ts#L226), [`durchbruchPasst`](../../src/lib/durchbruchSymbols.ts#L329), [`durchbruchAussparungen`](../../src/lib/durchbruchSymbols.ts#L386)

### [`src/lib/ebenen.ts`](../../src/lib/ebenen.ts) · 277 Zeilen

**Verantwortung:** Ebenen — was auf welcher liegt, was sichtbar ist, was gesperrt ist. **Die Ebene ist hier eine Eigenschaft des Bauteils, keine Ablage.** Ein  
**Abhängigkeiten:** `types/bim.ts`  
**Aufrufer:** `components/Editor2D.tsx`, `components/EntfernenKnopf.tsx`, `components/LayerPanel.tsx`, `components/PlanPrintDialog.tsx`, `components/Viewer3D.tsx`, `lib/planPrint.ts`, `store/useBimStore.ts`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`EBENE_WAENDE`](../../src/lib/ebenen.ts#L33), [`EBENE_OEFFNUNGEN`](../../src/lib/ebenen.ts#L34), [`EBENE_RAEUME`](../../src/lib/ebenen.ts#L35), [`EBENE_MASSE`](../../src/lib/ebenen.ts#L36), [`EBENE_HEIZUNG`](../../src/lib/ebenen.ts#L37), [`EBENE_SANITAER`](../../src/lib/ebenen.ts#L38), [`EBENE_LUEFTUNG`](../../src/lib/ebenen.ts#L39), [`EBENE_DURCHBRUECHE`](../../src/lib/ebenen.ts#L40), [`EBENE_GELAENDE`](../../src/lib/ebenen.ts#L41), [`EBENE_BILD`](../../src/lib/ebenen.ts#L42), [`ebeneFuerMedium`](../../src/lib/ebenen.ts#L57), [`ebeneFuerObjekt`](../../src/lib/ebenen.ts#L82), [`EBENEN_KATALOG`](../../src/lib/ebenen.ts#L102), [`ebeneFuerAuswahl`](../../src/lib/ebenen.ts#L135), [`istSichtbar`](../../src/lib/ebenen.ts#L173), [`istGesperrt`](../../src/lib/ebenen.ts#L193), [`auswahlGesperrt`](../../src/lib/ebenen.ts#L200), [`BESTANDS_EBENEN`](../../src/lib/ebenen.ts#L212), [`GEWERKESAETZE`](../../src/lib/ebenen.ts#L245), [`sichtbarkeitAus`](../../src/lib/ebenen.ts#L273)

### [`src/lib/eckpunkte.ts`](../../src/lib/eckpunkte.ts) · 155 Zeilen

**Verantwortung:** eckpunkte — was beim Zeichnen außer Wandknoten noch gefangen werden soll. **Der Befund, aus dem das hier entstanden ist.** Von zwölf Objektfamilien  
**Abhängigkeiten:** `lib/durchbruchSymbols.ts`, `lib/geometry.ts`, `lib/verticalSymbols.ts`, `types/bim.ts`  
**Aufrufer:** `components/Editor2D.tsx`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`ECKART_LABELS`](../../src/lib/eckpunkte.ts#L39), [`sammleEckpunkte`](../../src/lib/eckpunkte.ts#L69), [`naechsterEckpunkt`](../../src/lib/eckpunkte.ts#L139)

### [`src/lib/embedApi.ts`](../../src/lib/embedApi.ts) · 513 Zeilen

**Verantwortung:** Einbettungs-Schnittstelle für RaVia. Der Umweg über eine Exportdatei ist für den Menschen gedacht: herunterladen,  
**Abhängigkeiten:** `lib/geraeteprofil.ts`, `lib/hostPatch.ts`, `lib/ifcExport.ts`, `lib/normleistung.ts`, `lib/raviaExport.ts`, `lib/validation.ts`, `lib/wirt.ts`, `types/bim.ts`  
**Aufrufer:** `main.tsx`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`EMBED_API_VERSION`](../../src/lib/embedApi.ts#L78)⁰, [`buildSummary`](../../src/lib/embedApi.ts#L242), [`installEmbedApi`](../../src/lib/embedApi.ts#L271)

### [`src/lib/erzeugerHydraulik.ts`](../../src/lib/erzeugerHydraulik.ts) · 975 Zeilen

**Verantwortung:** Erzeugerhydraulik — was zwischen Rohrnetz und Pumpe sonst noch im Weg liegt. **Der Anlass.** Bis 1.13.2 rechnete der Rohrnetzbericht mit  
**Abhängigkeiten:** `lib/valveCatalog.ts`, `types/bim.ts`  
**Aufrufer:** `lib/auslegungExport.ts`, `lib/deviceCatalog.ts`, `lib/pipeReport.ts`, `lib/plantDesign.ts`  
**Aufrufer in scripts/:** 5

Exportierte Funktionen/Konstanten: [`ERZEUGER_MARKTWERTE`](../../src/lib/erzeugerHydraulik.ts#L96), [`spezifischerWiderstand`](../../src/lib/erzeugerHydraulik.ts#L474), [`median`](../../src/lib/erzeugerHydraulik.ts#L479), [`quantil`](../../src/lib/erzeugerHydraulik.ts#L492), [`TYPKLASSE_WIDERSTAND`](../../src/lib/erzeugerHydraulik.ts#L513), [`TYPKLASSE_RESTFOERDERHOEHE`](../../src/lib/erzeugerHydraulik.ts#L528), [`TYPKLASSE_RFH_BEZUG`](../../src/lib/erzeugerHydraulik.ts#L540), [`DEFAULT_EXPONENT`](../../src/lib/erzeugerHydraulik.ts#L553), [`fehlbetragSpanne`](../../src/lib/erzeugerHydraulik.ts#L563), [`typklassenHydraulik`](../../src/lib/erzeugerHydraulik.ts#L583), [`skaliert`](../../src/lib/erzeugerHydraulik.ts#L626), [`ausserhalbGrenzen`](../../src/lib/erzeugerHydraulik.ts#L634), [`normierterKvs`](../../src/lib/erzeugerHydraulik.ts#L670), [`einbauteilDruck`](../../src/lib/erzeugerHydraulik.ts#L676), [`UMSCHALTVENTILE`](../../src/lib/erzeugerHydraulik.ts#L683), [`WAERMEMENGENZAEHLER`](../../src/lib/erzeugerHydraulik.ts#L697), [`ABSCHEIDER`](../../src/lib/erzeugerHydraulik.ts#L714), [`FBH_DURCHFLUSSMESSER`](../../src/lib/erzeugerHydraulik.ts#L728), [`umschaltventil`](../../src/lib/erzeugerHydraulik.ts#L739), [`waermemengenzaehler`](../../src/lib/erzeugerHydraulik.ts#L753), [`abscheider`](../../src/lib/erzeugerHydraulik.ts#L758), [`erzeugerBilanz`](../../src/lib/erzeugerHydraulik.ts#L832)

### [`src/lib/erzeugerplatz.ts`](../../src/lib/erzeugerplatz.ts) · 197 Zeilen

**Verantwortung:** Wo steht der Wärmeerzeuger? — der Vorschlag, wenn noch keiner steht. **Warum es das gibt.** Die Rohrauslegung braucht einen Ausgangspunkt:  
**Abhängigkeiten:** `lib/geometry.ts`, `types/bim.ts`  
**Aufrufer:** `components/AnlagenPanel.tsx`, `store/useBimStore.ts`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`hatAusgangspunkt`](../../src/lib/erzeugerplatz.ts#L70), [`schlageVerteilerVor`](../../src/lib/erzeugerplatz.ts#L100), [`schlageErzeugerVor`](../../src/lib/erzeugerplatz.ts#L149)

### [`src/lib/exportDiff.ts`](../../src/lib/exportDiff.ts) · 202 Zeilen

**Verantwortung:** Vergleich zweier Exportstände. Die Frage, die vor jeder erneuten Übergabe an RaVia steht: *was hat sich  
**Abhängigkeiten:** `types/bim.ts`  
**Aufrufer:** `components/ExportDiffPanel.tsx`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`diffExports`](../../src/lib/exportDiff.ts#L76), [`isRaviaExport`](../../src/lib/exportDiff.ts#L198)

### [`src/lib/fassung.ts`](../../src/lib/fassung.ts) · 23 Zeilen

**Verantwortung:** Die Fassung des Programms — an einer Stelle. **Warum das eine eigene Datei ist.** Die Nummer stand bis 1.28.0 an drei  
**Abhängigkeiten:** –  
**Aufrufer:** `lib/ifcExport.ts`, `lib/raviaExport.ts`  
**Aufrufer in scripts/:** 2

Exportierte Funktionen/Konstanten: [`FASSUNG`](../../src/lib/fassung.ts#L19), [`ERZEUGER`](../../src/lib/fassung.ts#L22)

### [`src/lib/fixtureSymbols.ts`](../../src/lib/fixtureSymbols.ts) · 790 Zeilen

**Verantwortung:** TGA-Symbolik — Vektorzeichnungen für den Grundriss. Jedes Symbol wird in *lokalen Symbolkoordinaten* beschrieben: Ursprung in  
**Abhängigkeiten:** `lib/floorLoopLayout.ts`, `lib/normleistung.ts`, `types/bim.ts`  
**Aufrufer:** `components/Editor2D.tsx`, `components/PropertiesPanel.tsx`, `components/TgaPalette.tsx`  
**Aufrufer in scripts/:** 2

Exportierte Funktionen/Konstanten: [`FIXTURE_COLORS`](../../src/lib/fixtureSymbols.ts#L21), [`fixtureBadge`](../../src/lib/fixtureSymbols.ts#L28)⁰, [`drawFixture`](../../src/lib/fixtureSymbols.ts#L590), [`drawFloorLoops`](../../src/lib/fixtureSymbols.ts#L656), [`floorLoopBadge`](../../src/lib/fixtureSymbols.ts#L760), [`hitTestFixture`](../../src/lib/fixtureSymbols.ts#L780)

### [`src/lib/floorLoopLayout.ts`](../../src/lib/floorLoopLayout.ts) · 1643 Zeilen

**Verantwortung:** Verlegekurve der Fußbodenheizung — vom Raumpolygon zur Rohrschlange. **Warum es dieses Modul gibt.**  
**Abhängigkeiten:** `lib/geometry.ts`, `types/bim.ts`  
**Aufrufer:** `lib/fixtureSymbols.ts`, `lib/fussbodenkurven.ts`, `store/useBimStore.ts`  
**Aufrufer in scripts/:** 3

Exportierte Funktionen/Konstanten: [`DEFAULT_EDGE_CLEARANCE`](../../src/lib/floorLoopLayout.ts#L120), [`DEFAULT_OBSTACLE_CLEARANCE`](../../src/lib/floorLoopLayout.ts#L127), [`DEFAULT_MIN_RUN_LENGTH`](../../src/lib/floorLoopLayout.ts#L138), [`DEFAULT_MAX_CIRCUIT_LENGTH`](../../src/lib/floorLoopLayout.ts#L151), [`DEFAULT_LOOP_PATTERN`](../../src/lib/floorLoopLayout.ts#L154), [`FLOOR_OBSTACLE_TYPES`](../../src/lib/floorLoopLayout.ts#L211), [`kreiseEinzeln`](../../src/lib/floorLoopLayout.ts#L314)⁰, [`measureLayableArea`](../../src/lib/floorLoopLayout.ts#L647), [`planFloorLoops`](../../src/lib/floorLoopLayout.ts#L1143), [`fixtureFootprint`](../../src/lib/floorLoopLayout.ts#L1621)

### [`src/lib/formteile.ts`](../../src/lib/formteile.ts) · 292 Zeilen

**Verantwortung:** Formteile des Rohrnetzes — Bögen, T-Stücke, Reduzierungen (seit 1.71.0). **Warum es das gibt.** Gemeldet am 02.10.2026: „außerdem müssen auch die  
**Abhängigkeiten:** `lib/rohrbezeichnung.ts`, `lib/rohrlaenge.ts`, `types/bim.ts`  
**Aufrufer:** `components/AnlagenPanel.tsx`, `components/RohrnetzDialog.tsx`, `lib/materialSchedule.ts`, `lib/raviaExport.ts`, `store/useBimStore.ts`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`FORMTEIL_LABELS`](../../src/lib/formteile.ts#L44), [`formteile`](../../src/lib/formteile.ts#L104), [`formteilSumme`](../../src/lib/formteile.ts#L287)

### [`src/lib/fussbodenkurven.ts`](../../src/lib/fussbodenkurven.ts) · 275 Zeilen

**Verantwortung:** Die Verlegekurven eines Geschosses — einmal gerechnet, zweimal gezeichnet. **Warum es diese Datei gibt.** Die Kurve einer raumfüllenden  
**Abhängigkeiten:** `lib/floorLoopLayout.ts`, `lib/geometry.ts`, `lib/verticalSymbols.ts`, `types/bim.ts`  
**Aufrufer:** `components/Editor2D.tsx`, `components/Viewer3D.tsx`, `lib/materialSchedule.ts`, `lib/netzExport.ts`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`sammleVerlegekurven`](../../src/lib/fussbodenkurven.ts#L77), [`verlegebilanz`](../../src/lib/fussbodenkurven.ts#L180), [`verlegesumme`](../../src/lib/fussbodenkurven.ts#L230), [`verlegelinien`](../../src/lib/fussbodenkurven.ts#L263)

### [`src/lib/gebaeudeNetz.ts`](../../src/lib/gebaeudeNetz.ts) · 468 Zeilen

**Verantwortung:** Das Rohrnetz über **alle** Geschosse — mit Steigleitung. **Die Meldung:** „Wenn der Wärmeerzeuger unten ist und die Abnahme oben,  
**Abhängigkeiten:** `lib/aufstellgeschoss.ts`, `lib/pipeLayout.ts`, `lib/pipeRouting.ts`, `lib/steigstrang.ts`, `lib/zahl.ts`, `types/bim.ts`  
**Aufrufer:** `components/AnlagenPanel.tsx`, `store/useBimStore.ts`  
**Aufrufer in scripts/:** 4

Exportierte Funktionen/Konstanten: [`fasseGeschossmeldungen`](../../src/lib/gebaeudeNetz.ts#L130), [`planeGebaeudeNetz`](../../src/lib/gebaeudeNetz.ts#L167)

### [`src/lib/geometry.ts`](../../src/lib/geometry.ts) · 464 Zeilen

**Verantwortung:** Geometrie-Kernel — allokationsarme 2D-Mathematik. Bewusst funktional und ohne Klassen: Vec2 ist ein reines Objekt-Literal,  
**Abhängigkeiten:** `types/bim.ts`  
**Aufrufer:** `components/CalibrationOverlay.tsx`, `components/Editor2D.tsx`, `components/HeatPumpPanel.tsx`, `components/PropertiesPanel.tsx`, `components/Viewer3D.tsx`, `lib/autokorrektur.ts`, `lib/dachlandschaft.ts`, `lib/dachschnitt.ts`, `lib/eckpunkte.ts`, `lib/erzeugerplatz.ts`, `lib/floorLoopLayout.ts`, `lib/fussbodenkurven.ts`, `lib/hauseinfuehrung.ts`, `lib/heatPump.ts`, `lib/heizkoerperplatz.ts`, `lib/ifcExport.ts`, `lib/notizen.ts`, `lib/pipeLayout.ts`, `lib/pipeRouting.ts`, `lib/planPrint.ts`, `lib/raumZuordnung.ts`, `lib/raumplanImport.ts`, `lib/raumtreffer.ts`, `lib/raviaExport.ts`, `lib/ringStich.ts`, `lib/ringleitung.ts`, `lib/rohrImRaum.ts`, `lib/roofGeometry.ts`, `lib/roomDetection.ts`, `lib/scanUebernahme.ts`, `lib/siteSymbols.ts`, `lib/skizze.ts`, `lib/slabGeometry.ts`, `lib/spiegeln.ts`, `lib/steigstrang.ts`, `lib/thermalBridges.ts`, `lib/tuerseiten.ts`, `lib/validation.ts`, `lib/wallGeometry.ts`, `lib/wandhoehen.ts`, `lib/wandquerung.ts`, `store/useBimStore.ts`  
**Aufrufer in scripts/:** 20

Exportierte Funktionen/Konstanten: [`EPS`](../../src/lib/geometry.ts#L13), [`v`](../../src/lib/geometry.ts#L19)⁰, [`add`](../../src/lib/geometry.ts#L20)⁰, [`sub`](../../src/lib/geometry.ts#L21), [`scale`](../../src/lib/geometry.ts#L22)⁰, [`dot`](../../src/lib/geometry.ts#L23)⁰, [`cross`](../../src/lib/geometry.ts#L25)⁰, [`length`](../../src/lib/geometry.ts#L27)⁰, [`distance`](../../src/lib/geometry.ts#L31), [`normalize`](../../src/lib/geometry.ts#L37), [`lerp`](../../src/lib/geometry.ts#L42), [`rotate`](../../src/lib/geometry.ts#L47)⁰, [`almostEqual`](../../src/lib/geometry.ts#L53)⁰, [`clamp`](../../src/lib/geometry.ts#L56), [`projectParam`](../../src/lib/geometry.ts#L64)⁰, [`closestPointOnSegment`](../../src/lib/geometry.ts#L73), [`distanceToSegment`](../../src/lib/geometry.ts#L77), [`segmentIntersection`](../../src/lib/geometry.ts#L85), [`lineIntersection`](../../src/lib/geometry.ts#L112), [`vorzugsrichtung`](../../src/lib/geometry.ts#L145), [`TO_DEG`](../../src/lib/geometry.ts#L159), [`TO_RAD`](../../src/lib/geometry.ts#L160)⁰, [`angleDeg`](../../src/lib/geometry.ts#L163)⁰, [`normalizeDeg`](../../src/lib/geometry.ts#L168), [`snapToAngle`](../../src/lib/geometry.ts#L179), [`snapToGrid`](../../src/lib/geometry.ts#L198), [`roundMm`](../../src/lib/geometry.ts#L203), [`roundCm2`](../../src/lib/geometry.ts#L204), [`signedArea`](../../src/lib/geometry.ts#L211), [`polygonArea`](../../src/lib/geometry.ts#L222), [`polygonPerimeter`](../../src/lib/geometry.ts#L224), [`polygonCentroid`](../../src/lib/geometry.ts#L232), [`pointInPolygon`](../../src/lib/geometry.ts#L260), [`innererPunkt`](../../src/lib/geometry.ts#L298), [`polygonBounds`](../../src/lib/geometry.ts#L334), [`offsetPolygonPerEdge`](../../src/lib/geometry.ts#L364), [`simplifyPolygon`](../../src/lib/geometry.ts#L422), [`azimuthFromNormal`](../../src/lib/geometry.ts#L455), [`orientationFromAzimuth`](../../src/lib/geometry.ts#L460)

### [`src/lib/geraeteprofil.ts`](../../src/lib/geraeteprofil.ts) · 136 Zeilen

**Verantwortung:** Auf welchem Gerät läuft CAD Light? — die eine Antwort für beide Seiten. **Warum CAD Light das der RaVia-Seite sagt.** Die RaVia-Seite zeigt den  
**Abhängigkeiten:** –  
**Aufrufer:** `App.tsx`, `lib/embedApi.ts`, `store/useBimStore.ts`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`TABLET_AB`](../../src/lib/geraeteprofil.ts#L88), [`geraeteprofil`](../../src/lib/geraeteprofil.ts#L93), [`geraetemerkmale`](../../src/lib/geraeteprofil.ts#L118)

### [`src/lib/glossar.ts`](../../src/lib/glossar.ts) · 408 Zeilen

**Verantwortung:** Glossar — die Abkürzungen, an denen das Werkzeug sonst scheitert. Dieses Programm bedient nicht nur, wer Bauphysik studiert hat. Ein Monteur,  
**Abhängigkeiten:** –  
**Aufrufer:** `components/Erklaerung.tsx`, `components/GuidePanel.tsx`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`GLOSSAR`](../../src/lib/glossar.ts#L27), [`glossaryList`](../../src/lib/glossar.ts#L404)

### [`src/lib/griffe.ts`](../../src/lib/griffe.ts) · 775 Zeilen

**Verantwortung:** Bauteile in der 3D-Ansicht anfassen und ändern. **Die Forderung:** Wände löschen und in der Größe ändern, im Raum stehend —  
**Abhängigkeiten:** `lib/wallGeometry.ts`, `types/bim.ts`  
**Aufrufer:** `components/Viewer3D.tsx`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`GRIFF_LABELS`](../../src/lib/griffe.ts#L61)⁰, [`MIN_WANDHOEHE`](../../src/lib/griffe.ts#L135), [`MAX_WANDHOEHE`](../../src/lib/griffe.ts#L136), [`MIN_WANDDICKE`](../../src/lib/griffe.ts#L145), [`MAX_WANDDICKE`](../../src/lib/griffe.ts#L146), [`MIN_OEFFNUNG`](../../src/lib/griffe.ts#L149), [`RAND_AN_DER_ECKE`](../../src/lib/griffe.ts#L163), [`griffeFuer`](../../src/lib/griffe.ts#L176), [`begrenze`](../../src/lib/griffe.ts#L481), [`aenderungFuer`](../../src/lib/griffe.ts#L494), [`wertAusZug`](../../src/lib/griffe.ts#L560), [`fangmasse`](../../src/lib/griffe.ts#L605), [`fange`](../../src/lib/griffe.ts#L640), [`griffText`](../../src/lib/griffe.ts#L654), [`gleichartige`](../../src/lib/griffe.ts#L695)

### [`src/lib/hauseinfuehrung.ts`](../../src/lib/hauseinfuehrung.ts) · 124 Zeilen

**Verantwortung:** Wo die Leitung von der Wärmepumpe ins Haus kommt. **Warum es das braucht.** Der Rohrausleger kannte als Anfang des Netzes nur  
**Abhängigkeiten:** `lib/geometry.ts`, `lib/wallGeometry.ts`, `types/bim.ts`  
**Aufrufer:** `lib/pipeLayout.ts`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`ECKABSTAND`](../../src/lib/hauseinfuehrung.ts#L34)⁰, [`OEFFNUNGSABSTAND`](../../src/lib/hauseinfuehrung.ts#L36)⁰, [`INNENVERSATZ`](../../src/lib/hauseinfuehrung.ts#L38)⁰, [`hauseinfuehrung`](../../src/lib/hauseinfuehrung.ts#L60)

### [`src/lib/heatLoadEstimate.ts`](../../src/lib/heatLoadEstimate.ts) · 492 Zeilen

**Verantwortung:** Überschlägige Heizlast — die Zahl, ohne die keine Anlage ausgelegt werden kann. **Warum es dieses Modul gibt und was es ausdrücklich nicht ist.**  
**Abhängigkeiten:** `lib/raviaExport.ts`, `lib/roomDetection.ts`, `lib/thermalBridges.ts`, `lib/uwert.ts`, `types/bim.ts`  
**Aufrufer:** `lib/heizflaechenAbgleich.ts`, `lib/pipeLayout.ts`, `lib/plantDesign.ts`, `lib/raviaExport.ts`, `lib/validation.ts`, `lib/verbraucherlast.ts`, `store/useBimStore.ts`  
**Aufrufer in scripts/:** 6

Exportierte Funktionen/Konstanten: [`AIR_CAPACITY`](../../src/lib/heatLoadEstimate.ts#L52)⁰, [`normHeatLoadCoverage`](../../src/lib/heatLoadEstimate.ts#L360), [`gebaeudeLueftung`](../../src/lib/heatLoadEstimate.ts#L426), [`estimateHeatLoad`](../../src/lib/heatLoadEstimate.ts#L439), [`domesticHotWaterSurcharge`](../../src/lib/heatLoadEstimate.ts#L488)

### [`src/lib/heatPump.ts`](../../src/lib/heatPump.ts) · 625 Zeilen

**Verantwortung:** Wärmepumpe und Außenanlage — die Aufstellung prüfbar machen. Wo eine Luft-Wärmepumpe stehen darf, entscheiden drei Dinge, die nichts  
**Abhängigkeiten:** `lib/geometry.ts`, `lib/kaeltemittel.ts`, `lib/wallGeometry.ts`, `types/bim.ts`  
**Aufrufer:** `components/Editor2D.tsx`, `components/HeatPumpPanel.tsx`, `lib/plantDesign.ts`, `lib/raviaExport.ts`, `lib/validation.ts`  
**Aufrufer in scripts/:** 2

Exportierte Funktionen/Konstanten: [`IMMISSION_LIMITS`](../../src/lib/heatPump.ts#L55), [`ROOM_ANGLE`](../../src/lib/heatPump.ts#L75), [`IRRELEVANCE_MARGIN`](../../src/lib/heatPump.ts#L83), [`MIN_DISTANCE`](../../src/lib/heatPump.ts#L90)⁰, [`soundPressureAt`](../../src/lib/heatPump.ts#L100), [`requiredDistance`](../../src/lib/heatPump.ts#L112), [`ratedSoundPower`](../../src/lib/heatPump.ts#L124), [`distanceToPolyline`](../../src/lib/heatPump.ts#L167)⁰, [`closestPointOn`](../../src/lib/heatPump.ts#L185)⁰, [`acousticReport`](../../src/lib/heatPump.ts#L223), [`FLAMMABLE`](../../src/lib/heatPump.ts#L317), [`protectionStatus`](../../src/lib/heatPump.ts#L353), [`protectionIssues`](../../src/lib/heatPump.ts#L409), [`EXTRACTION`](../../src/lib/heatPump.ts#L493)⁰, [`TABLE_LIMIT_KW`](../../src/lib/heatPump.ts#L502)⁰, [`TABLE_LIMIT_BOREHOLES`](../../src/lib/heatPump.ts#L503)⁰, [`sourceDemand`](../../src/lib/heatPump.ts#L525), [`waterProtectionVerdict`](../../src/lib/heatPump.ts#L592), [`blockingFactor`](../../src/lib/heatPump.ts#L621)

### [`src/lib/heizflaechenAbgleich.ts`](../../src/lib/heizflaechenAbgleich.ts) · 278 Zeilen

**Verantwortung:** Halten die Heizflächen noch mit der Heizlast Schritt? **Was dieses Modul entscheidet — und was nicht.** Es rechnet aus, welche  
**Abhängigkeiten:** `lib/heatLoadEstimate.ts`, `lib/heizflaechenLeistung.ts`, `lib/normleistung.ts`, `lib/systemtemperatur.ts`, `types/bim.ts`  
**Aufrufer:** `components/PropertiesPanel.tsx`, `store/useBimStore.ts`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`heizflaechenBefunde`](../../src/lib/heizflaechenAbgleich.ts#L97), [`normleistungAusRaumlast`](../../src/lib/heizflaechenAbgleich.ts#L110), [`heizflaechenbefundFuer`](../../src/lib/heizflaechenAbgleich.ts#L238), [`zieheHeizflaechenNach`](../../src/lib/heizflaechenAbgleich.ts#L251), [`unterdeckteHeizflaechen`](../../src/lib/heizflaechenAbgleich.ts#L273)

### [`src/lib/heizflaechenLeistung.ts`](../../src/lib/heizflaechenLeistung.ts) · 168 Zeilen

**Verantwortung:** Von der Raumheizlast zur Normleistung des Heizkörpers. **Die Forderung, aus der dieses Modul entstanden ist:** „Bei den  
**Abhängigkeiten:** `lib/auslegungExport.ts`, `lib/hydraulics.ts`, `lib/normleistung.ts`, `types/bim.ts`  
**Aufrufer:** `lib/heizflaechenAbgleich.ts`, `store/useBimStore.ts`  
**Aufrufer in scripts/:** 3

Exportierte Funktionen/Konstanten: [`NORM_UEBERTEMPERATUR`](../../src/lib/heizflaechenLeistung.ts#L65), [`normleistungFuerHeizlast`](../../src/lib/heizflaechenLeistung.ts#L80), [`anteilJeHeizflaeche`](../../src/lib/heizflaechenLeistung.ts#L136), [`HEIZFLAECHEN_BAUARTEN`](../../src/lib/heizflaechenLeistung.ts#L142)⁰, [`istHeizflaeche`](../../src/lib/heizflaechenLeistung.ts#L144), [`leistungsBegruendung`](../../src/lib/heizflaechenLeistung.ts#L155)

### [`src/lib/heizkoerperplatz.ts`](../../src/lib/heizkoerperplatz.ts) · 131 Zeilen

**Verantwortung:** Wohin ein Heizkörper kommt, wenn nur seine Leistung erfasst wird. **Wozu das gebraucht wird.** Im Raumbuch steht je Raum eine Zeile mit  
**Abhängigkeiten:** `lib/geometry.ts`, `lib/wallGeometry.ts`, `types/bim.ts`  
**Aufrufer:** `store/useBimStore.ts`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`PLATZ_TEXT`](../../src/lib/heizkoerperplatz.ts#L48), [`heizkoerperplatz`](../../src/lib/heizkoerperplatz.ts#L93)

### [`src/lib/hostPatch.ts`](../../src/lib/hostPatch.ts) · 1221 Zeilen

**Verantwortung:** Der Rückweg: was die Gegenstelle in dieses Modell schreiben darf. Bis hierher war die Einbettung einseitig. RaVia konnte den Modellstand  
**Abhängigkeiten:** `lib/normleistung.ts`, `types/bim.ts`  
**Aufrufer:** `lib/embedApi.ts`, `store/useBimStore.ts`  
**Aufrufer in scripts/:** 4

Exportierte Funktionen/Konstanten: [`PATCH_RANGES`](../../src/lib/hostPatch.ts#L245), [`PROTECTED_FIELDS`](../../src/lib/hostPatch.ts#L269), [`applyHostPatch`](../../src/lib/hostPatch.ts#L364), [`writableFields`](../../src/lib/hostPatch.ts#L826)

### [`src/lib/huellflaechenbilanz.ts`](../../src/lib/huellflaechenbilanz.ts) · 183 Zeilen

**Verantwortung:** Hüllflächenbilanz — die Prüfsumme gegen verlorene Bauteile. **Punkt 13.** Die Übernahme auf der Gegenseite berücksichtigt Boden, Decke  
**Abhängigkeiten:** –  
**Aufrufer:** `lib/raviaExport.ts`, `types/bim.ts`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`huellflaechenbilanz`](../../src/lib/huellflaechenbilanz.ts#L121)

### [`src/lib/hydraulicBalance.ts`](../../src/lib/hydraulicBalance.ts) · 1504 Zeilen

**Verantwortung:** Hydraulischer Abgleich — die Brücke zwischen Zeichnung und Rechenkern. **Warum es dieses Modul gibt.**  
**Abhängigkeiten:** `lib/hydraulics.ts`, `lib/normleistung.ts`, `lib/valveCatalog.ts`, `types/bim.ts`  
**Aufrufer:** `components/AnlagenPanel.tsx`, `lib/auslegungExport.ts`, `lib/netzExport.ts`, `lib/pipeReport.ts`, `lib/raviaExport.ts`  
**Aufrufer in scripts/:** 4

Exportierte Funktionen/Konstanten: [`dimensionForDn`](../../src/lib/hydraulicBalance.ts#L183), [`HEATING_CONSUMER_TYPES`](../../src/lib/hydraulicBalance.ts#L256)⁰, [`DEFAULT_POWER_BY_TYPE`](../../src/lib/hydraulicBalance.ts#L274)⁰, [`FALLBACK_POWER`](../../src/lib/hydraulicBalance.ts#L289)⁰, [`DEFAULT_SPREAD`](../../src/lib/hydraulicBalance.ts#L299)⁰, [`MIN_PRESET_PRESSURE`](../../src/lib/hydraulicBalance.ts#L314)⁰, [`MAX_PRESET_PRESSURE`](../../src/lib/hydraulicBalance.ts#L328)⁰, [`DEFAULT_SEGMENT_ZETA`](../../src/lib/hydraulicBalance.ts#L341), [`ACCESSORY_FITTING`](../../src/lib/hydraulicBalance.ts#L358), [`PRESET_VERDICT_LABELS`](../../src/lib/hydraulicBalance.ts#L466), [`requiredKv`](../../src/lib/hydraulicBalance.ts#L847), [`balanceNetwork`](../../src/lib/hydraulicBalance.ts#L890)

### [`src/lib/hydraulics.ts`](../../src/lib/hydraulics.ts) · 1930 Zeilen

**Verantwortung:** Hydraulik — Volumenströme, Rohrdimensionierung, Druckverluste, Pumpe. **Warum es dieses Modul gibt.**  
**Abhängigkeiten:** `types/bim.ts`  
**Aufrufer:** `lib/domesticWater.ts`, `lib/heizflaechenLeistung.ts`, `lib/hydraulicBalance.ts`, `lib/netzExport.ts`, `lib/pipeLayout.ts`, `lib/pipeReport.ts`, `lib/plantDesign.ts`, `lib/primaerkreis.ts`, `lib/rohrbezeichnung.ts`, `lib/safetyFittings.ts`, `lib/steigstrang.ts`, `lib/verbraucherlast.ts`, `store/useBimStore.ts`  
**Aufrufer in scripts/:** 6

Exportierte Funktionen/Konstanten: [`GRAVITY`](../../src/lib/hydraulics.ts#L46)⁰, [`COPPER_PIPES`](../../src/lib/hydraulics.ts#L138), [`STEEL_PIPES`](../../src/lib/hydraulics.ts#L164)⁰, [`STAINLESS_PIPES`](../../src/lib/hydraulics.ts#L188)⁰, [`PEX_PIPES`](../../src/lib/hydraulics.ts#L206)⁰, [`MULTILAYER_PIPES`](../../src/lib/hydraulics.ts#L223), [`PPR_PIPES`](../../src/lib/hydraulics.ts#L241)⁰, [`PIPE_TABLES`](../../src/lib/hydraulics.ts#L251), [`findDimension`](../../src/lib/hydraulics.ts#L261), [`PIPE_ROUGHNESS`](../../src/lib/hydraulics.ts#L297)⁰, [`STEEL_ROUGHNESS_BY_CONDITION`](../../src/lib/hydraulics.ts#L315)⁰, [`pipeRoughness`](../../src/lib/hydraulics.ts#L322)⁰, [`GLYCOL_LABELS`](../../src/lib/hydraulics.ts#L334), [`WATER_TEMPERATURES`](../../src/lib/hydraulics.ts#L340)⁰, [`WATER_HEAT_CAPACITY`](../../src/lib/hydraulics.ts#L349)⁰, [`WATER_KINEMATIC_VISCOSITY`](../../src/lib/hydraulics.ts#L360)⁰, [`waterDensity`](../../src/lib/hydraulics.ts#L387), [`waterHeatCapacity`](../../src/lib/hydraulics.ts#L403), [`waterKinematicViscosity`](../../src/lib/hydraulics.ts#L408)⁰, [`GLYCOL_FREEZE_POINTS`](../../src/lib/hydraulics.ts#L431), [`glycolFreezePoint`](../../src/lib/hydraulics.ts#L464), [`freezePoint`](../../src/lib/hydraulics.ts#L479), [`GLYCOL_PROPERTIES`](../../src/lib/hydraulics.ts#L498), [`GLYCOL_VISCOSITY_FACTOR`](../../src/lib/hydraulics.ts#L514)⁰, [`fluidProperties`](../../src/lib/hydraulics.ts#L580), [`DEFAULT_FLUID`](../../src/lib/hydraulics.ts#L662), [`massFlow`](../../src/lib/hydraulics.ts#L679)⁰, [`volumeFlow`](../../src/lib/hydraulics.ts#L696), [`SHORT_FORMULA_FACTOR`](../../src/lib/hydraulics.ts#L732)⁰, [`volumeFlowShort`](../../src/lib/hydraulics.ts#L744), [`REYNOLDS_LAMINAR`](../../src/lib/hydraulics.ts#L754)⁰, [`REYNOLDS_TURBULENT`](../../src/lib/hydraulics.ts#L757), [`velocityOf`](../../src/lib/hydraulics.ts#L768), [`reynolds`](../../src/lib/hydraulics.ts#L784)⁰, [`lambdaLaminar`](../../src/lib/hydraulics.ts#L796)⁰, [`colebrookWhite`](../../src/lib/hydraulics.ts#L814)⁰, [`swameeJain`](../../src/lib/hydraulics.ts#L848)⁰, [`frictionFactor`](../../src/lib/hydraulics.ts#L875)⁰, [`flowState`](../../src/lib/hydraulics.ts#L918), [`FITTING_RESISTANCES`](../../src/lib/hydraulics.ts#L982), [`fittingZeta`](../../src/lib/hydraulics.ts#L1011), [`zetaFromKvs`](../../src/lib/hydraulics.ts#L1035)⁰, [`DEFAULT_SIZING_LIMITS`](../../src/lib/hydraulics.ts#L1065), [`sizePipe`](../../src/lib/hydraulics.ts#L1116), [`pressureLoss`](../../src/lib/hydraulics.ts#L1259)⁰, [`evaluatePath`](../../src/lib/hydraulics.ts#L1349), [`DEFAULT_PUMP_EFFICIENCY`](../../src/lib/hydraulics.ts#L1429)⁰, [`MIN_PUMP_ELECTRIC_POWER`](../../src/lib/hydraulics.ts#L1438)⁰, [`designPump`](../../src/lib/hydraulics.ts#L1473), [`surfaceHeatFlux`](../../src/lib/hydraulics.ts#L1591)⁰, [`surfaceTemperatureFor`](../../src/lib/hydraulics.ts#L1598)⁰, [`MAX_SURFACE_TEMPERATURE`](../../src/lib/hydraulics.ts#L1621)⁰, [`logMeanOverTemperature`](../../src/lib/hydraulics.ts#L1642), [`DEFAULT_FLOOR_HEAT_FLUX`](../../src/lib/hydraulics.ts#L1667)⁰, [`DEFAULT_MAX_LOOP_LENGTH`](../../src/lib/hydraulics.ts#L1685)⁰, [`DEFAULT_MAX_LOOP_PRESSURE`](../../src/lib/hydraulics.ts#L1688)⁰, [`designFloorHeating`](../../src/lib/hydraulics.ts#L1798)

### [`src/lib/ifcExport.ts`](../../src/lib/ifcExport.ts) · 765 Zeilen

**Verantwortung:** IFC4-Export (STEP / ISO-10303-21). Das RaVia-JSON ist die Übergabe an die Heizlastberechnung. IFC ist die  
**Abhängigkeiten:** `lib/dachlandschaft.ts`, `lib/durchbruchSymbols.ts`, `lib/fassung.ts`, `lib/geometry.ts`, `lib/uwert.ts`, `lib/wallGeometry.ts`, `types/bim.ts`  
**Aufrufer:** `components/Toolbar.tsx`, `lib/embedApi.ts`  
**Aufrufer in scripts/:** 6

Exportierte Funktionen/Konstanten: [`schichtenAusText`](../../src/lib/ifcExport.ts#L51), [`buildIfc`](../../src/lib/ifcExport.ts#L199), [`downloadIfc`](../../src/lib/ifcExport.ts#L749), [`ifcFilename`](../../src/lib/ifcExport.ts#L761)

### [`src/lib/ifcImport.ts`](../../src/lib/ifcImport.ts) · 2201 Zeilen

**Verantwortung:** IFC4-Import (STEP / ISO-10303-21). Der wertvollste Grundriss ist der, den jemand anderes schon gezeichnet hat.  
**Abhängigkeiten:** `lib/uwert.ts`, `types/bim.ts`  
**Aufrufer:** `store/useBimStore.ts`  
**Aufrufer in scripts/:** 10

Exportierte Funktionen/Konstanten: [`parseStep`](../../src/lib/ifcImport.ts#L101), [`importIfc`](../../src/lib/ifcImport.ts#L1186)

### [`src/lib/importgeschoss.ts`](../../src/lib/importgeschoss.ts) · 192 Zeilen

**Verantwortung:** Den eingelesenen Grundriss einem Geschoss zuordnen. **Das Aufmaß beginnt selten im Erdgeschoss.** Wer eine Wohnung im ersten  
**Abhängigkeiten:** `lib/levelGeometry.ts`, `lib/uwert.ts`, `types/bim.ts`  
**Aufrufer:** `store/useBimStore.ts`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`planeGeschosszuordnung`](../../src/lib/importgeschoss.ts#L80)

### [`src/lib/inbetriebnahme.ts`](../../src/lib/inbetriebnahme.ts) · 197 Zeilen

**Verantwortung:** Inbetriebnahme und Optimierung — die fehlende dritte Hälfte. **Worum es geht.** Dieses Programm plant und rechnet. Was *danach* kommt —  
**Abhängigkeiten:** –  
**Aufrufer:** `lib/projektMappe.ts`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`EINSTIEG_ABSTAND`](../../src/lib/inbetriebnahme.ts#L32), [`QUELLE_INFOBLATT_62`](../../src/lib/inbetriebnahme.ts#L80), [`einstiegsvorlauf`](../../src/lib/inbetriebnahme.ts#L92), [`WARTUNG`](../../src/lib/inbetriebnahme.ts#L98)⁰, [`inbetriebnahmeblatt`](../../src/lib/inbetriebnahme.ts#L119)

### [`src/lib/kaeltemittel.ts`](../../src/lib/kaeltemittel.ts) · 220 Zeilen

**Verantwortung:** Kältemittelkatalog — Sicherheitsklasse, Treibhauspotenzial, Schwellenwerte. WAS DIESE DATEI IST  
**Abhängigkeiten:** –  
**Aufrufer:** `components/HeatPumpPanel.tsx`, `components/Viewer3D.tsx`, `lib/deviceCatalog.ts`, `lib/heatPump.ts`, `lib/raviaExport.ts`, `lib/validation.ts`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`KLASSENTEXT`](../../src/lib/kaeltemittel.ts#L52), [`KAELTEMITTEL`](../../src/lib/kaeltemittel.ts#L97), [`kaeltemittel`](../../src/lib/kaeltemittel.ts#L127), [`brauchtSchutzbereich`](../../src/lib/kaeltemittel.ts#L140), [`dichtheitspflicht`](../../src/lib/kaeltemittel.ts#L169), [`co2Aequivalent`](../../src/lib/kaeltemittel.ts#L211)

### [`src/lib/kompass.ts`](../../src/lib/kompass.ts) · 120 Zeilen

**Verantwortung:** Der Kompass — wo Norden liegt, und wie man es sieht. **Warum die Nordrichtung überhaupt zählt.** Sie geht nirgends in eine  
**Abhängigkeiten:** `types/bim.ts`  
**Aufrufer:** `components/Editor2D.tsx`, `components/PropertiesPanel.tsx`, `components/Viewer3D.tsx`, `lib/planPrint.ts`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`nordrichtung`](../../src/lib/kompass.ts#L51), [`nordabweichungAus`](../../src/lib/kompass.ts#L62), [`kompassRose`](../../src/lib/kompass.ts#L88)

### [`src/lib/leitungsbefund.ts`](../../src/lib/leitungsbefund.ts) · 187 Zeilen

**Verantwortung:** Leitungen, die in keiner Menge auftauchen dürfen — und die man trotzdem nicht still verschwinden lassen darf.  
**Abhängigkeiten:** `lib/rohrlaenge.ts`, `types/bim.ts`  
**Aufrufer:** `lib/autokorrektur.ts`, `lib/materialSchedule.ts`, `lib/pipeNetwork.ts`, `lib/validation.ts`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`DECKUNGSTOLERANZ`](../../src/lib/leitungsbefund.ts#L45)⁰, [`HOEHENTOLERANZ`](../../src/lib/leitungsbefund.ts#L53)⁰, [`nullLeitungen`](../../src/lib/leitungsbefund.ts#L90), [`doppelteLeitungen`](../../src/lib/leitungsbefund.ts#L162)

### [`src/lib/levelCopy.ts`](../../src/lib/levelCopy.ts) · 176 Zeilen

**Verantwortung:** Was beim Übernehmen eines Geschosses mitwandert — und was nicht. „Grundriss des aktuellen Geschosses übernehmen" ist eine Geste, aber drei  
**Abhängigkeiten:** `types/bim.ts`  
**Aufrufer:** `store/useBimStore.ts`  
**Aufrufer in scripts/:** 2

Exportierte Funktionen/Konstanten: [`copiesWithLevel`](../../src/lib/levelCopy.ts#L96), [`copyLevelContents`](../../src/lib/levelCopy.ts#L107)

### [`src/lib/levelGeometry.ts`](../../src/lib/levelGeometry.ts) · 139 Zeilen

**Verantwortung:** Höhenlage der Geschosse. Ein Geschoss trägt eine Höhenlage (`elevation`) — die Oberkante seines  
**Abhängigkeiten:** `types/bim.ts`  
**Aufrufer:** `components/PropertiesPanel.tsx`, `components/Viewer3D.tsx`, `lib/importgeschoss.ts`, `lib/slabGeometry.ts`, `store/useBimStore.ts`  
**Aufrufer in scripts/:** 6

Exportierte Funktionen/Konstanten: [`DEFAULT_SLAB`](../../src/lib/levelGeometry.ts#L24), [`DEFAULT_LEVEL_HEIGHT`](../../src/lib/levelGeometry.ts#L27), [`levelBaseHeights`](../../src/lib/levelGeometry.ts#L36), [`geschossName`](../../src/lib/levelGeometry.ts#L76), [`erdgeschossIndex`](../../src/lib/levelGeometry.ts#L89), [`benenneGeschosse`](../../src/lib/levelGeometry.ts#L114), [`istLagename`](../../src/lib/levelGeometry.ts#L134)

### [`src/lib/luecken.ts`](../../src/lib/luecken.ts) · 196 Zeilen

**Verantwortung:** Lücken im Grundriss finden — und sagen, was man daraus machen kann. Ein loses Wandende ist im Aufmaß fast nie ein Fehler, sondern eine Aussage:  
**Abhängigkeiten:** `types/bim.ts`  
**Aufrufer:** `components/AufmassPanel.tsx`, `components/KorrekturDialog.tsx`, `lib/autokorrektur.ts`, `store/useBimStore.ts`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`MAX_WEITE`](../../src/lib/luecken.ts#L29)⁰, [`findeLuecken`](../../src/lib/luecken.ts#L79), [`oeffnungFuerLuecke`](../../src/lib/luecken.ts#L172)

### [`src/lib/mappenUmbruch.ts`](../../src/lib/mappenUmbruch.ts) · 457 Zeilen

**Verantwortung:** Textblätter der Projektmappe auf Druckseiten umbrechen. **Der Befund (07.10.2026, Prüfrunde 2).** Die Mappe des Bungalows A01  
**Abhängigkeiten:** –  
**Aufrufer:** `lib/projektMappe.ts`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`MAPPE_SATZ`](../../src/lib/mappenUmbruch.ts#L49), [`BUCH_SATZ`](../../src/lib/mappenUmbruch.ts#L50)⁰, [`bloecke`](../../src/lib/mappenUmbruch.ts#L105), [`zerlegeTabelle`](../../src/lib/mappenUmbruch.ts#L147)⁰, [`verteileBreiten`](../../src/lib/mappenUmbruch.ts#L190)⁰, [`blockhoehe`](../../src/lib/mappenUmbruch.ts#L250), [`umbrechen`](../../src/lib/mappenUmbruch.ts#L327), [`zeilenMass`](../../src/lib/mappenUmbruch.ts#L452)

### [`src/lib/materialSchedule.ts`](../../src/lib/materialSchedule.ts) · 2023 Zeilen

**Verantwortung:** Massen- und Materialauszug über das ganze Projekt. Das ist die Liste, mit der jemand bestellt. Deshalb steht an jeder Position  
**Abhängigkeiten:** `lib/bodenbelag.ts`, `lib/deviceCatalog.ts`, `lib/formteile.ts`, `lib/fussbodenkurven.ts`, `lib/leitungsbefund.ts`, `lib/normleistung.ts`, `lib/plantDefaults.ts`, `lib/plantDesign.ts`, `lib/rohrbezeichnung.ts`, `lib/rohrlaenge.ts`, `lib/schematicPrint.ts`, `lib/schematicSymbols.ts`, `lib/uwert.ts`, `types/bim.ts`  
**Aufrufer:** `components/AnlagenPanel.tsx`, `lib/projektMappe.ts`  
**Aufrufer in scripts/:** 5

Exportierte Funktionen/Konstanten: [`PFLICHTARMATUR_HERKUNFT`](../../src/lib/materialSchedule.ts#L82), [`MATERIAL_TRADE_LABELS`](../../src/lib/materialSchedule.ts#L102), [`MENGEN_STATT_PREISE`](../../src/lib/materialSchedule.ts#L1595), [`herkunftsBasis`](../../src/lib/materialSchedule.ts#L1743), [`buildMaterialSchedule`](../../src/lib/materialSchedule.ts#L1839), [`materialScheduleCsv`](../../src/lib/materialSchedule.ts#L1985)

### [`src/lib/netzExport.ts`](../../src/lib/netzExport.ts) · 534 Zeilen

**Verantwortung:** Rohrnetz und Flächenheizkreise für die Übergabe — mit Topologie. **Warum dieses Modul entstanden ist.** Die Anweisung der RaVia-Seite vom  
**Abhängigkeiten:** `lib/fussbodenkurven.ts`, `lib/hydraulicBalance.ts`, `lib/hydraulics.ts`, `types/bim.ts`  
**Aufrufer:** `lib/raviaExport.ts`, `types/bim.ts`  
**Aufrufer in scripts/:** 3

Exportierte Funktionen/Konstanten: [`baueNetzExport`](../../src/lib/netzExport.ts#L244), [`baueFlaechenkreise`](../../src/lib/netzExport.ts#L376), [`gemischteRaeume`](../../src/lib/netzExport.ts#L454), [`wegKennzahlen`](../../src/lib/netzExport.ts#L510)

### [`src/lib/normleistung.ts`](../../src/lib/normleistung.ts) · 159 Zeilen

**Verantwortung:** Normwärmeleistung von Heizkörpern nach DIN EN 442-2 — die eine Stelle. **Festlegung F2 (gemeinsam mit RaVia und RaVia Scan).** Gespeichert und  
**Abhängigkeiten:** `types/bim.ts`  
**Aufrufer:** `components/GuidePanel.tsx`, `components/PropertiesPanel.tsx`, `components/RoomBook.tsx`, `components/StatusBar.tsx`, `components/TgaPalette.tsx`, `lib/auslegungExport.ts`, `lib/beschriftung3d.ts`, `lib/embedApi.ts`, `lib/fixtureSymbols.ts`, `lib/heizflaechenAbgleich.ts`, `lib/heizflaechenLeistung.ts`, `lib/hostPatch.ts`, `lib/hydraulicBalance.ts`, `lib/materialSchedule.ts`, `lib/raviaExport.ts`, `lib/validation.ts`, `lib/verbraucherlast.ts`, `store/useBimStore.ts`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`EN442_TYPEN`](../../src/lib/normleistung.ts#L27), [`istEn442`](../../src/lib/normleistung.ts#L34), [`NORMPUNKT_EN442`](../../src/lib/normleistung.ts#L39), [`NORM_UEBERTEMPERATUR_EN442`](../../src/lib/normleistung.ts#L42), [`ALT_UEBERTEMPERATUR_55_45`](../../src/lib/normleistung.ts#L45)⁰, [`EXPONENT_RICHTWERT`](../../src/lib/normleistung.ts#L51), [`RATED_POWER_SOURCE_LABELS`](../../src/lib/normleistung.ts#L59), [`exponentFuer`](../../src/lib/normleistung.ts#L67), [`ratedPowerAusAlt`](../../src/lib/normleistung.ts#L73), [`heizleistung`](../../src/lib/normleistung.ts#L84), [`migriereParams`](../../src/lib/normleistung.ts#L98), [`migriereFixtures`](../../src/lib/normleistung.ts#L122), [`mitLeistung`](../../src/lib/normleistung.ts#L136)

### [`src/lib/notizen.ts`](../../src/lib/notizen.ts) · 78 Zeilen

**Verantwortung:** notizen — die Regel für den Radiergummi der Notizebene. **Warum das hier steht und nicht in der Leinwand.** Radieren sieht nach  
**Abhängigkeiten:** `lib/geometry.ts`, `types/bim.ts`  
**Aufrufer:** `components/Editor2D.tsx`, `store/useBimStore.ts`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`RADIER_RADIUS`](../../src/lib/notizen.ts#L27), [`abstandZuZug`](../../src/lib/notizen.ts#L30), [`trifft`](../../src/lib/notizen.ts#L51), [`getroffene`](../../src/lib/notizen.ts#L65)

### [`src/lib/nutzungseinheiten.ts`](../../src/lib/nutzungseinheiten.ts) · 254 Zeilen

**Verantwortung:** Nutzungseinheiten — Wohnungen, Gewerbeeinheiten, Gemeinschaftsflächen. **Die Entscheidung, die hier getroffen wurde.** Die Frage stand so im Raum:  
**Abhängigkeiten:** `types/bim.ts`  
**Aufrufer:** `components/AnlagenPanel.tsx`, `components/PropertiesPanel.tsx`, `lib/plantDesign.ts`, `lib/raviaExport.ts`, `lib/validation.ts`, `store/useBimStore.ts`, `types/bim.ts`  
**Aufrufer in scripts/:** 2

Exportierte Funktionen/Konstanten: [`EINHEIT_LABELS`](../../src/lib/nutzungseinheiten.ts#L35), [`ABGLEICHPFLICHT_AB`](../../src/lib/nutzungseinheiten.ts#L45), [`einheitsbilanzen`](../../src/lib/nutzungseinheiten.ts#L81), [`einheitenVonRaeumen`](../../src/lib/nutzungseinheiten.ts#L129), [`einheitVonRaeumen`](../../src/lib/nutzungseinheiten.ts#L146), [`ohneEinheit`](../../src/lib/nutzungseinheiten.ts#L152), [`einheitenstand`](../../src/lib/nutzungseinheiten.ts#L179), [`einheitenAusRaumnamen`](../../src/lib/nutzungseinheiten.ts#L209), [`einheitenAbgleich`](../../src/lib/nutzungseinheiten.ts#L228), [`naechsterName`](../../src/lib/nutzungseinheiten.ts#L245)

### [`src/lib/objektaufnahme.ts`](../../src/lib/objektaufnahme.ts) · 382 Zeilen

**Verantwortung:** Der Objektaufnahmebogen (BWP-Vorhaben 4.2). **Woher die Liste kommt.** Der BWP-Praxisratgeber Modernisieren führt die  
**Abhängigkeiten:** `lib/verbrauchsabgleich.ts`, `types/bim.ts`  
**Aufrufer:** `components/GuidePanel.tsx`, `lib/projektMappe.ts`, `store/useBimStore.ts`, `types/bim.ts`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`DAEMMZUSTAND_LABELS`](../../src/lib/objektaufnahme.ts#L35), [`BESTANDSHEIZUNG_LABELS`](../../src/lib/objektaufnahme.ts#L54), [`WARMWASSER_BESTAND_LABELS`](../../src/lib/objektaufnahme.ts#L75), [`aufnahmestand`](../../src/lib/objektaufnahme.ts#L161)

### [`src/lib/openingSymbols.ts`](../../src/lib/openingSymbols.ts) · 274 Zeilen

**Verantwortung:** Öffnungssymbolik im Grundriss — die *eine* Wahrheit für Bildschirm und Blatt. Bis 1.7.0 zeichnete der Editor Türblatt und Schwenkbogen selbst, und der  
**Abhängigkeiten:** `lib/wallGeometry.ts`, `types/bim.ts`  
**Aufrufer:** `components/Editor2D.tsx`, `lib/planPrint.ts`  
**Aufrufer in scripts/:** 3

Exportierte Funktionen/Konstanten: [`openingSymbol`](../../src/lib/openingSymbols.ts#L62), [`openingLabel`](../../src/lib/openingSymbols.ts#L260), [`meterText`](../../src/lib/openingSymbols.ts#L269)⁰

### [`src/lib/pipeAccessorySymbols.ts`](../../src/lib/pipeAccessorySymbols.ts) · 170 Zeilen

**Verantwortung:** Symbolik der Armaturen am Rohrnetz — eine Quelle für Bildschirm und Blatt. Die Geometrie steht hier **einmal**, in lokalen Koordinaten um die  
**Abhängigkeiten:** `types/bim.ts`  
**Aufrufer:** `components/PropertiesPanel.tsx`, `lib/planPrint.ts`, `lib/verticalSymbols.ts`, `store/useBimStore.ts`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`ACCESSORY_LABELS`](../../src/lib/pipeAccessorySymbols.ts#L23), [`ACCESSORY_LEGEND`](../../src/lib/pipeAccessorySymbols.ts#L39), [`accessorySymbol`](../../src/lib/pipeAccessorySymbols.ts#L78)

### [`src/lib/pipeInsulation.ts`](../../src/lib/pipeInsulation.ts) · 632 Zeilen

**Verantwortung:** Mindestdicke der Dämmschicht von Rohrleitungen nach GEG Anlage 8. **Die einzige Stelle für die Rohrdämmung.** `domesticWater.ts` führte bis  
**Abhängigkeiten:** `types/bim.ts`  
**Aufrufer:** `lib/pipeLayout.ts`, `lib/pipeReport.ts`, `lib/steigstrang.ts`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`LAMBDA_BEZUG`](../../src/lib/pipeInsulation.ts#L61), [`GEG_ANLAGE_8`](../../src/lib/pipeInsulation.ts#L71), [`GEG_ANLAGE_8_KAELTE`](../../src/lib/pipeInsulation.ts#L86), [`thicknessForLambda`](../../src/lib/pipeInsulation.ts#L226), [`insulationThickness`](../../src/lib/pipeInsulation.ts#L317), [`insulationForDimension`](../../src/lib/pipeInsulation.ts#L626)

### [`src/lib/pipeLayout.ts`](../../src/lib/pipeLayout.ts) · 1759 Zeilen

**Verantwortung:** Rohrausleger — aus dem Grundriss ein fertiges Rohrnetz. Was hier zusammenkommt:  
**Abhängigkeiten:** `lib/anschlussgroesse.ts`, `lib/aufstellgeschoss.ts`, `lib/deviceCatalog.ts`, `lib/doppelleitung.ts`, `lib/geometry.ts`, `lib/hauseinfuehrung.ts`, `lib/heatLoadEstimate.ts`, `lib/hydraulics.ts`, `lib/pipeInsulation.ts`, `lib/pipeRouting.ts`, `lib/plantDefaults.ts`, `lib/ringleitung.ts`, `lib/rohrbezeichnung.ts`, `lib/rohrlaenge.ts`, `lib/steigstrang.ts`, `lib/systemtemperatur.ts`, `lib/verbraucherlast.ts`, `lib/zahl.ts`, `types/bim.ts`  
**Aufrufer:** `lib/gebaeudeNetz.ts`  
**Aufrufer in scripts/:** 6

Exportierte Funktionen/Konstanten: [`SIZING_LIMITS`](../../src/lib/pipeLayout.ts#L80), [`SOCKELLEISTE_MAX_AUSSEN`](../../src/lib/pipeLayout.ts#L99), [`RING_MINDEST_DN`](../../src/lib/pipeLayout.ts#L202), [`RING_HOECHST_DN`](../../src/lib/pipeLayout.ts#L216), [`verteilerVon`](../../src/lib/pipeLayout.ts#L401)⁰, [`planPipeNetwork`](../../src/lib/pipeLayout.ts#L514)

### [`src/lib/pipeNetwork.ts`](../../src/lib/pipeNetwork.ts) · 837 Zeilen

**Verantwortung:** Rohrnetz als Strangschema. Bisher waren verlegte Leitungen eine Liste von Polylinien: gut für den  
**Abhängigkeiten:** `lib/leitungsbefund.ts`, `lib/rohrlaenge.ts`, `types/bim.ts`  
**Aufrufer:** `components/AnlagenPanel.tsx`, `components/TgaPalette.tsx`, `lib/pipeReport.ts`, `lib/raviaExport.ts`, `lib/validation.ts`  
**Aufrufer in scripts/:** 10

Exportierte Funktionen/Konstanten: [`buildPipeNetwork`](../../src/lib/pipeNetwork.ts#L658)

### [`src/lib/pipeReport.ts`](../../src/lib/pipeReport.ts) · 848 Zeilen

**Verantwortung:** Rohrnetzbericht — die Rechnung als Nachweis, nicht als Zahl im Panel. Bis 1.11.0 rechnete dieses Programm den hydraulischen Abgleich vollständig  
**Abhängigkeiten:** `lib/anschlussgroesse.ts`, `lib/erzeugerHydraulik.ts`, `lib/hydraulicBalance.ts`, `lib/hydraulics.ts`, `lib/pipeInsulation.ts`, `lib/pipeNetwork.ts`, `lib/plantDefaults.ts`, `lib/plantDesign.ts`, `lib/rohrlaenge.ts`, `lib/systemtemperatur.ts`, `lib/valveCatalog.ts`, `lib/verbraucherlast.ts`, `lib/wissenKorpus.ts`, `lib/wissensbasis.ts`, `lib/zahl.ts`, `types/bim.ts`  
**Aufrufer:** `components/GuidePanel.tsx`, `components/MappeDialog.tsx`, `components/RohrnetzDialog.tsx`, `lib/pipeReportPrint.ts`, `lib/projektMappe.ts`  
**Aufrufer in scripts/:** 8

Exportierte Funktionen/Konstanten: [`heizlastHerkunftText`](../../src/lib/pipeReport.ts#L70), [`UEBERSCHLAG_HINWEIS`](../../src/lib/pipeReport.ts#L75), [`wissensbasis`](../../src/lib/pipeReport.ts#L81), [`vorherrschenderWerkstoff`](../../src/lib/pipeReport.ts#L303), [`buildPipeReport`](../../src/lib/pipeReport.ts#L365), [`berichtsUrteil`](../../src/lib/pipeReport.ts#L819), [`armaturenListe`](../../src/lib/pipeReport.ts#L839)

### [`src/lib/pipeReportPrint.ts`](../../src/lib/pipeReportPrint.ts) · 1108 Zeilen

**Verantwortung:** Rohrnetzbericht als Blattfolge — Grundriss, Teilstrecken, Einstellwerte. Das Ergebnis ist ein Stapel A4-Blätter im SVG-Format. Der Weg ins PDF führt  
**Abhängigkeiten:** `lib/druckFenster.ts`, `lib/pipeReport.ts`, `lib/planPrint.ts`, `types/bim.ts`  
**Aufrufer:** `components/RohrnetzDialog.tsx`, `lib/projektMappe.ts`  
**Aufrufer in scripts/:** 4

Exportierte Funktionen/Konstanten: [`buildPipeReportSheets`](../../src/lib/pipeReportPrint.ts#L380), [`printPipeReport`](../../src/lib/pipeReportPrint.ts#L1089)

### [`src/lib/pipeRouting.ts`](../../src/lib/pipeRouting.ts) · 2052 Zeilen

**Verantwortung:** Automatische Rohrtrassierung — vom Verteiler zu jedem Verbraucher. **Warum es dieses Modul gibt.**  
**Abhängigkeiten:** `lib/geometry.ts`, `lib/wallGeometry.ts`, `types/bim.ts`  
**Aufrufer:** `lib/gebaeudeNetz.ts`, `lib/pipeLayout.ts`  
**Aufrufer in scripts/:** 2

Exportierte Funktionen/Konstanten: [`TUER_ZUSCHLAG`](../../src/lib/pipeRouting.ts#L279), [`NUTZUNGS_GEWICHT`](../../src/lib/pipeRouting.ts#L319), [`SOLLABSTAND`](../../src/lib/pipeRouting.ts#L431), [`routePipes`](../../src/lib/pipeRouting.ts#L1544)

### [`src/lib/planLeeren.ts`](../../src/lib/planLeeren.ts) · 160 Zeilen

**Verantwortung:** „Alles löschen" — den Plan leeren, ohne das Projekt aufzugeben. **Was hier falsch war.** Der Papierkorb in der Werkzeugleiste hieß „Alle  
**Abhängigkeiten:** `lib/plantDefaults.ts`, `types/bim.ts`  
**Aufrufer:** `components/Toolbar.tsx`, `store/useBimStore.ts`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`loeschbilanz`](../../src/lib/planLeeren.ts#L59), [`bilanzSatz`](../../src/lib/planLeeren.ts#L86), [`leerePlan`](../../src/lib/planLeeren.ts#L132)

### [`src/lib/planPrint.ts`](../../src/lib/planPrint.ts) · 1416 Zeilen

**Verantwortung:** Maßstäblicher Planausdruck. Erzeugt aus dem Modell ein SVG in **Millimetern** und öffnet es in einem  
**Abhängigkeiten:** `lib/annotationSymbols.ts`, `lib/beschriftungsLage.ts`, `lib/druckFenster.ts`, `lib/durchbruchSymbols.ts`, `lib/ebenen.ts`, `lib/geometry.ts`, `lib/kompass.ts`, `lib/openingSymbols.ts`, `lib/pipeAccessorySymbols.ts`, `lib/planScaleBar.ts`, `lib/rohrbezeichnung.ts`, `lib/roofGeometry.ts`, `lib/roomDetection.ts`, `lib/verticalSymbols.ts`, `lib/wallGeometry.ts`, `lib/zahl.ts`, `types/bim.ts`  
**Aufrufer:** `components/PlanPrintDialog.tsx`, `components/RohrnetzDialog.tsx`, `lib/pipeReportPrint.ts`, `lib/projektMappe.ts`  
**Aufrufer in scripts/:** 5

Exportierte Funktionen/Konstanten: [`buildPlanSvg`](../../src/lib/planPrint.ts#L223), [`printPlan`](../../src/lib/planPrint.ts#L1184)

### [`src/lib/planScaleBar.ts`](../../src/lib/planScaleBar.ts) · 30 Zeilen

**Verantwortung:** Maßstabsleiste für den Planausdruck — als SVG-Fragment in Millimetern. Sie ist das, was einen Ausdruck überprüfbar macht: wer nachmisst, sieht  
**Abhängigkeiten:** `lib/zahl.ts`  
**Aufrufer:** `lib/planPrint.ts`, `lib/schematicPrint.ts`  
**Aufrufer in scripts/:** 0

Exportierte Funktionen/Konstanten: [`drawableScaleBar`](../../src/lib/planScaleBar.ts#L8)

### [`src/lib/plantBook.ts`](../../src/lib/plantBook.ts) · 2341 Zeilen

**Verantwortung:** Anlagenbuch — die Auslegung als Dokument zum Ausdrucken. **Warum es dieses Modul gibt.** Die Rechenkerne liefern Zahlen, die  
**Abhängigkeiten:** `lib/deviceCatalog.ts`, `lib/domesticWater.ts`, `lib/druckFenster.ts`, `lib/plantDesign.ts`, `types/bim.ts`  
**Aufrufer:** `components/AnlagenPanel.tsx`, `lib/projektMappe.ts`  
**Aufrufer in scripts/:** 2

Exportierte Funktionen/Konstanten: [`buildPlantBook`](../../src/lib/plantBook.ts#L2195), [`printPlantBook`](../../src/lib/plantBook.ts#L2322)

### [`src/lib/plantDefaults.ts`](../../src/lib/plantDefaults.ts) · 196 Zeilen

**Verantwortung:** Vorbelegung der Anlagentechnik. Die Werte sind die, die in einem Einfamilienhaus mit Wärmepumpe am  
**Abhängigkeiten:** `types/bim.ts`  
**Aufrufer:** `components/AnlagenDialog.tsx`, `components/AnlagenPanel.tsx`, `components/RohrnetzDialog.tsx`, `components/Toolbar.tsx`, `lib/materialSchedule.ts`, `lib/pipeLayout.ts`, `lib/pipeReport.ts`, `lib/planLeeren.ts`, `lib/plantDesign.ts`, `lib/projektMappe.ts`, `lib/systemtemperatur.ts`, `store/useBimStore.ts`  
**Aufrufer in scripts/:** 31

Exportierte Funktionen/Konstanten: [`emptyPlant`](../../src/lib/plantDefaults.ts#L18), [`plantOf`](../../src/lib/plantDefaults.ts#L63), [`emptySite`](../../src/lib/plantDefaults.ts#L82), [`VORHABEN_VORBELEGUNG`](../../src/lib/plantDefaults.ts#L118), [`verlegeartAus`](../../src/lib/plantDefaults.ts#L193)

### [`src/lib/plantDesign.ts`](../../src/lib/plantDesign.ts) · 2714 Zeilen

**Verantwortung:** Anlagenauslegung — der Faden, der die Rechenkerne verbindet. Die einzelnen Kerne rechnen jeder für sich: `heatLoadEstimate` liefert die  
**Abhängigkeiten:** `lib/anlagenFragen.ts`, `lib/anschlussgroesse.ts`, `lib/bivalenz.ts`, `lib/deviceCatalog.ts`, `lib/domesticWater.ts`, `lib/erzeugerHydraulik.ts`, `lib/heatLoadEstimate.ts`, `lib/heatPump.ts`, `lib/hydraulics.ts`, `lib/nutzungseinheiten.ts`, `lib/plantDefaults.ts`, `lib/safetyFittings.ts`, `lib/systemtemperatur.ts`, `lib/zahl.ts`, `types/bim.ts`  
**Aufrufer:** `components/AnlagenDialog.tsx`, `components/AnlagenPanel.tsx`, `components/GuidePanel.tsx`, `components/HeatPumpPanel.tsx`, `components/SchemaView.tsx`, `lib/materialSchedule.ts`, `lib/pipeReport.ts`, `lib/plantBook.ts`, `lib/raviaExport.ts`, `lib/schemaAuswahl.ts`, `lib/schemaPruefung.ts`, `lib/schemaZuordnung.ts`, `lib/validation.ts`  
**Aufrufer in scripts/:** 16

Exportierte Funktionen/Konstanten: [`deriveCircuits`](../../src/lib/plantDesign.ts#L365), [`designCircuit`](../../src/lib/plantDesign.ts#L456)⁰, [`gebaeudeHeizlast`](../../src/lib/plantDesign.ts#L618), [`leistungsbedarf`](../../src/lib/plantDesign.ts#L647), [`designPlant`](../../src/lib/plantDesign.ts#L659), [`buildSchematic`](../../src/lib/plantDesign.ts#L1633)

### [`src/lib/primaerkreis.ts`](../../src/lib/primaerkreis.ts) · 170 Zeilen

**Verantwortung:** Der Volumenstrom der Primärseite — Sole- oder Brunnenkreis. **Die Lücke, die das hier schließt.** Der BWP-Leitfaden Hydraulik legt die  
**Abhängigkeiten:** `lib/hydraulics.ts`  
**Aufrufer:** `components/HeatPumpPanel.tsx`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`TABELLE1_WASSER`](../../src/lib/primaerkreis.ts#L42), [`PRIMAER_SPREIZUNG`](../../src/lib/primaerkreis.ts#L52), [`kaelteleistung`](../../src/lib/primaerkreis.ts#L62), [`primaerauslegung`](../../src/lib/primaerkreis.ts#L96)

### [`src/lib/projectStore.ts`](../../src/lib/projectStore.ts) · 622 Zeilen

**Verantwortung:** Projektverwaltung — mehrere benannte Projekte im Browser-Speicher. Die Sitzungssicherung (`autosave.ts`) schützt vor dem Absturz und vor dem  
**Abhängigkeiten:** `types/bim.ts`  
**Aufrufer:** `App.tsx`, `components/ProjektDialog.tsx`, `lib/autosave.ts`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`ANGENOMMENE_GRENZE_BYTES`](../../src/lib/projectStore.ts#L59), [`BYTES_JE_ZEICHEN`](../../src/lib/projectStore.ts#L61), [`RICHTWERT_ZEICHEN`](../../src/lib/projectStore.ts#L69)⁰, [`setzeSpeicher`](../../src/lib/projectStore.ts#L98), [`baueVorschau`](../../src/lib/projectStore.ts#L314), [`listeProjekte`](../../src/lib/projectStore.ts#L379), [`aktivesProjekt`](../../src/lib/projectStore.ts#L400), [`setzeAktivesProjekt`](../../src/lib/projectStore.ts#L404), [`eindeutigerName`](../../src/lib/projectStore.ts#L415), [`legeProjektAn`](../../src/lib/projectStore.ts#L438), [`speichereProjekt`](../../src/lib/projectStore.ts#L479), [`ladeProjekt`](../../src/lib/projectStore.ts#L507), [`benenneProjektUm`](../../src/lib/projectStore.ts#L538), [`dupliziereProjekt`](../../src/lib/projectStore.ts#L550), [`loescheProjekt`](../../src/lib/projectStore.ts#L565), [`speicherBericht`](../../src/lib/projectStore.ts#L580), [`formatBytes`](../../src/lib/projectStore.ts#L617)

### [`src/lib/projektMappe.ts`](../../src/lib/projektMappe.ts) · 2409 Zeilen

**Verantwortung:** Projektmappe — vier Druckwege, ein Dokument. **Der Anlass.** Bis 1.13.2 druckte dieses Programm aus vier getrennten  
**Abhängigkeiten:** `lib/druckFenster.ts`, `lib/inbetriebnahme.ts`, `lib/mappenUmbruch.ts`, `lib/materialSchedule.ts`, `lib/objektaufnahme.ts`, `lib/pipeReport.ts`, `lib/pipeReportPrint.ts`, `lib/planPrint.ts`, `lib/plantBook.ts`, `lib/plantDefaults.ts`, `lib/raviaExport.ts`, `lib/schematicPrint.ts`, `lib/wissensbasis.ts`, `types/bim.ts`  
**Aufrufer:** `components/MappeDialog.tsx`  
**Aufrufer in scripts/:** 3

Exportierte Funktionen/Konstanten: [`blattBereich`](../../src/lib/projektMappe.ts#L266), [`skopiereStil`](../../src/lib/projektMappe.ts#L316), [`buildProjektMappe`](../../src/lib/projektMappe.ts#L471), [`printProjektMappe`](../../src/lib/projektMappe.ts#L2397)

### [`src/lib/pruefsumme.ts`](../../src/lib/pruefsumme.ts) · 109 Zeilen

**Verantwortung:** Prüfsummen für den Export — damit die Gegenstelle erkennt, *was* sich geändert hat, und nicht nur *dass* sich etwas geändert hat.  
**Abhängigkeiten:** –  
**Aufrufer:** `lib/raviaExport.ts`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`hash64`](../../src/lib/pruefsumme.ts#L52), [`kanonisch`](../../src/lib/pruefsumme.ts#L89), [`pruefsumme`](../../src/lib/pruefsumme.ts#L106)

### [`src/lib/raumZuordnung.ts`](../../src/lib/raumZuordnung.ts) · 167 Zeilen

**Verantwortung:** Gespeicherte Raumangaben wieder ihrem Raum zuordnen — geschossweise. **Der Fehler, der dieses Modul nötig gemacht hat.** Beim Öffnen einer  
**Abhängigkeiten:** `lib/geometry.ts`, `types/bim.ts`  
**Aufrufer:** `store/useBimStore.ts`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`geschossVon`](../../src/lib/raumZuordnung.ts#L74), [`ordneRaeumeZu`](../../src/lib/raumZuordnung.ts#L116)

### [`src/lib/raumnutzung.ts`](../../src/lib/raumnutzung.ts) · 351 Zeilen

**Verantwortung:** Von einem Raumnamen auf seine Nutzung schließen. Ein Raum, der „Bad" heißt, wird nach DIN EN 12831 mit 24 °C gerechnet,  
**Abhängigkeiten:** `types/bim.ts`  
**Aufrufer:** `components/RaumnameFeld.tsx`, `store/useBimStore.ts`  
**Aufrufer in scripts/:** 3

Exportierte Funktionen/Konstanten: [`normalisiere`](../../src/lib/raumnutzung.ts#L49), [`nutzungAusName`](../../src/lib/raumnutzung.ts#L125), [`ordneRaumnamenZu`](../../src/lib/raumnutzung.ts#L254), [`STANDARD_RAUMNAMEN`](../../src/lib/raumnutzung.ts#L313), [`istStandardraumname`](../../src/lib/raumnutzung.ts#L347)

### [`src/lib/raumplanImport.ts`](../../src/lib/raumplanImport.ts) · 1231 Zeilen

**Verantwortung:** Import eines Raumscans aus Apple RoomPlan. Wer mit dem iPhone durch die Wohnung geht, bekommt keine Punktwolke,  
**Abhängigkeiten:** `lib/geometry.ts`, `lib/uwert.ts`, `types/bim.ts`  
**Aufrufer:** `components/Toolbar.tsx`, `lib/buildingModelImport.ts`, `lib/scanUebernahme.ts`, `store/useBimStore.ts`  
**Aufrufer in scripts/:** 5

Exportierte Funktionen/Konstanten: [`istRaumplanDatei`](../../src/lib/raumplanImport.ts#L422), [`importRaumplan`](../../src/lib/raumplanImport.ts#L489), [`bauart`](../../src/lib/raumplanImport.ts#L912), [`teileAnStoessen`](../../src/lib/raumplanImport.ts#L1116)

### [`src/lib/raumtreffer.ts`](../../src/lib/raumtreffer.ts) · 110 Zeilen

**Verantwortung:** raumtreffer — was ein Punkt im 3D-Raum im Modell bedeutet. **Das Problem, das diese Datei löst.** In der 3D-Ansicht sind alle Bauteile  
**Abhängigkeiten:** `lib/geometry.ts`, `lib/wallGeometry.ts`, `types/bim.ts`  
**Aufrufer:** `components/Viewer3D.tsx`, `lib/werkzeugkiste.ts`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`WANDZUSCHLAG`](../../src/lib/raumtreffer.ts#L54), [`deuteTreffer`](../../src/lib/raumtreffer.ts#L63), [`szeneZuModell`](../../src/lib/raumtreffer.ts#L107)

### [`src/lib/raviaExport.ts`](../../src/lib/raviaExport.ts) · 2324 Zeilen

**Verantwortung:** RaVia-Export — das Übergabeformat an die Heizlastberechnung. Leitgedanke: die Gegenstelle soll **rechnen können, ohne nachzufragen**.  
**Abhängigkeiten:** `lib/auslegungExport.ts`, `lib/dachlandschaft.ts`, `lib/durchbruchSymbols.ts`, `lib/fassung.ts`, `lib/formteile.ts`, `lib/geometry.ts`, `lib/heatLoadEstimate.ts`, `lib/heatPump.ts`, `lib/huellflaechenbilanz.ts`, `lib/hydraulicBalance.ts`, `lib/kaeltemittel.ts`, `lib/netzExport.ts`, `lib/normleistung.ts`, `lib/nutzungseinheiten.ts`, `lib/pipeNetwork.ts`, `lib/plantDesign.ts`, `lib/pruefsumme.ts`, `lib/rohrImRaum.ts`, `lib/rohrlaenge.ts`, `lib/roofGeometry.ts`, `lib/roomDetection.ts`, `lib/thermalBridges.ts`, `lib/unbeheizt.ts`, `lib/uwert.ts`, `lib/validation.ts`, `lib/verbraucherlast.ts`, `lib/verbrauchsabgleich.ts`, `lib/verticalSymbols.ts`, `lib/wallGeometry.ts`, `types/bim.ts`  
**Aufrufer:** `components/AnlagenPanel.tsx`, `components/ExportDiffPanel.tsx`, `components/ProjektDialog.tsx`, `components/PropertiesPanel.tsx`, `components/RoomBook.tsx`, `components/Toolbar.tsx`, `lib/embedApi.ts`, `lib/heatLoadEstimate.ts`, `lib/projektMappe.ts`  
**Aufrufer in scripts/:** 20

Exportierte Funktionen/Konstanten: [`GENERATOR`](../../src/lib/raviaExport.ts#L147), [`EXPORT_FASSUNG`](../../src/lib/raviaExport.ts#L217), [`raumFlaechen`](../../src/lib/raviaExport.ts#L226), [`buildRaviaExport`](../../src/lib/raviaExport.ts#L237), [`downloadJson`](../../src/lib/raviaExport.ts#L2301), [`exportFilename`](../../src/lib/raviaExport.ts#L2315)

### [`src/lib/ringStich.ts`](../../src/lib/ringStich.ts) · 369 Zeilen

**Verantwortung:** Stichleitung vom Ring zu einem Heizkörper ohne Außenwand. **Die Meldung dahinter:** „bei Ring haben wir einen Spezialfall: ein  
**Abhängigkeiten:** `lib/geometry.ts`, `lib/wallGeometry.ts`, `types/bim.ts`  
**Aufrufer:** `lib/ringleitung.ts`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`STICH_RASTER`](../../src/lib/ringStich.ts#L46)⁰, [`STICH_KANAL`](../../src/lib/ringStich.ts#L51)⁰, [`STICH_WANDNAH`](../../src/lib/ringStich.ts#L53)⁰, [`STICH_NAH_FAKTOR`](../../src/lib/ringStich.ts#L55)⁰, [`STICH_FREI_FAKTOR`](../../src/lib/ringStich.ts#L57)⁰, [`STICH_KERNBOHRUNG`](../../src/lib/ringStich.ts#L59)⁰, [`STICH_BODENDURCHFUEHRUNG`](../../src/lib/ringStich.ts#L61)⁰, [`STICH_BOGEN`](../../src/lib/ringStich.ts#L63)⁰, [`planeStich`](../../src/lib/ringStich.ts#L126)

### [`src/lib/ringleitung.ts`](../../src/lib/ringleitung.ts) · 410 Zeilen

**Verantwortung:** Die Ringleitung — Vor- und Rücklauf einmal ums Haus, die Heizkörper hängen daran. **Was gewünscht war.** Aus einem echten Sanierungsfall, in den Worten des  
**Abhängigkeiten:** `lib/geometry.ts`, `lib/ringStich.ts`, `lib/roomDetection.ts`, `lib/wallGeometry.ts`, `types/bim.ts`  
**Aufrufer:** `lib/pipeLayout.ts`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`WANDABSTAND`](../../src/lib/ringleitung.ts#L57)⁰, [`GERADE_ANBINDUNG`](../../src/lib/ringleitung.ts#L63)⁰, [`TUER_BRUESTUNG`](../../src/lib/ringleitung.ts#L65)⁰, [`planeRing`](../../src/lib/ringleitung.ts#L237)

### [`src/lib/rohrImRaum.ts`](../../src/lib/rohrImRaum.ts) · 181 Zeilen

**Verantwortung:** Wie viele Rohrmeter liegen in welchem Raum? **Warum diese Frage überhaupt gestellt wird.** Ein Heizkreisverteiler in der  
**Abhängigkeiten:** `lib/geometry.ts`, `types/bim.ts`  
**Aufrufer:** `components/RoomBook.tsx`, `lib/raviaExport.ts`  
**Aufrufer in scripts/:** 0

Exportierte Funktionen/Konstanten: [`rohrmeterJeRaum`](../../src/lib/rohrImRaum.ts#L96)

### [`src/lib/rohrbezeichnung.ts`](../../src/lib/rohrbezeichnung.ts) · 136 Zeilen

**Verantwortung:** Wie eine Leitung im Plan heißt — und warum nicht „DN 12". **Der Befund.** Im Plan stand am Heizkörper „DN 12". Ein Heizungsbauer  
**Abhängigkeiten:** `lib/hydraulics.ts`, `lib/rohrlaenge.ts`, `types/bim.ts`  
**Aufrufer:** `components/PropertiesPanel.tsx`, `components/Viewer3D.tsx`, `lib/beschriftung3d.ts`, `lib/formteile.ts`, `lib/materialSchedule.ts`, `lib/pipeLayout.ts`, `lib/planPrint.ts`, `lib/verticalSymbols.ts`, `store/useBimStore.ts`  
**Aufrufer in scripts/:** 2

Exportierte Funktionen/Konstanten: [`WERKSTOFF_KUERZEL`](../../src/lib/rohrbezeichnung.ts#L50), [`handelsmass`](../../src/lib/rohrbezeichnung.ts#L80), [`rohrbezeichnung`](../../src/lib/rohrbezeichnung.ts#L99), [`rohrbezeichnungLang`](../../src/lib/rohrbezeichnung.ts#L115), [`leitungsbeschriftung`](../../src/lib/rohrbezeichnung.ts#L132)

### [`src/lib/rohrlaenge.ts`](../../src/lib/rohrlaenge.ts) · 116 Zeilen

**Verantwortung:** Wie lang ist eine Leitung wirklich? **Warum das ein eigenes Modul ist.** Bis 1.23.0 rechnete jede Stelle, die  
**Abhängigkeiten:** `types/bim.ts`  
**Aufrufer:** `components/AnlagenPanel.tsx`, `components/Viewer3D.tsx`, `lib/formteile.ts`, `lib/leitungsbefund.ts`, `lib/materialSchedule.ts`, `lib/pipeLayout.ts`, `lib/pipeNetwork.ts`, `lib/pipeReport.ts`, `lib/raviaExport.ts`, `lib/rohrbezeichnung.ts`, `lib/verticalSymbols.ts`, `lib/wandquerung.ts`, `store/useBimStore.ts`  
**Aufrufer in scripts/:** 3

Exportierte Funktionen/Konstanten: [`trassenlaenge`](../../src/lib/rohrlaenge.ts#L24), [`hoehenversatz`](../../src/lib/rohrlaenge.ts#L40), [`rohrlaenge`](../../src/lib/rohrlaenge.ts#L55), [`steiganteil`](../../src/lib/rohrlaenge.ts#L70), [`istStrang`](../../src/lib/rohrlaenge.ts#L87), [`hoeheAnPunkt`](../../src/lib/rohrlaenge.ts#L101)

### [`src/lib/roofGeometry.ts`](../../src/lib/roofGeometry.ts) · 1342 Zeilen

**Verantwortung:** Dachgeometrie — die ortsabhängige Raumhöhe unter einer Schräge. Im Dachgeschoss stimmt nichts mehr, was im Regelgeschoss selbstverständlich  
**Abhängigkeiten:** `lib/geometry.ts`, `types/bim.ts`  
**Aufrufer:** `components/Editor2D.tsx`, `components/PropertiesPanel.tsx`, `components/RoofPanel.tsx`, `components/Viewer3D.tsx`, `lib/dachlandschaft.ts`, `lib/dachschnitt.ts`, `lib/planPrint.ts`, `lib/raviaExport.ts`, `lib/roomDetection.ts`, `lib/wandhoehen.ts`, `store/useBimStore.ts`  
**Aufrufer in scripts/:** 7

Exportierte Funktionen/Konstanten: [`ROOF_SAMPLE_STEP`](../../src/lib/roofGeometry.ts#L29)⁰, [`MANSARD_OBEN_VORGABE`](../../src/lib/roofGeometry.ts#L388), [`MANSARD_KNICK_VORGABE`](../../src/lib/roofGeometry.ts#L390), [`KRUEPPELWALM_VORGABE`](../../src/lib/roofGeometry.ts#L392), [`mansardKnick`](../../src/lib/roofGeometry.ts#L407), [`buildRoofFrame`](../../src/lib/roofGeometry.ts#L434), [`baseRoofHeightAt`](../../src/lib/roofGeometry.ts#L617), [`dormerFrontHeightAt`](../../src/lib/roofGeometry.ts#L753)⁰, [`defaultGableRise`](../../src/lib/roofGeometry.ts#L760), [`dormerSide`](../../src/lib/roofGeometry.ts#L769), [`dormerFrontBack`](../../src/lib/roofGeometry.ts#L778)⁰, [`roofHeightAt`](../../src/lib/roofGeometry.ts#L804), [`neigungAn`](../../src/lib/roofGeometry.ts#L841)⁰, [`roofFaceAzimuthAt`](../../src/lib/roofGeometry.ts#L872), [`measureRoomUnderRoof`](../../src/lib/roofGeometry.ts#L930), [`wallProfileUnderRoof`](../../src/lib/roofGeometry.ts#L1151), [`roofContourLines`](../../src/lib/roofGeometry.ts#L1215), [`ridgeLine`](../../src/lib/roofGeometry.ts#L1285), [`roofOpeningCorners`](../../src/lib/roofGeometry.ts#L1320), [`hitTestRoofOpening`](../../src/lib/roofGeometry.ts#L1335)

### [`src/lib/roomDetection.ts`](../../src/lib/roomDetection.ts) · 2009 Zeilen

**Verantwortung:** Automatische Raumerkennung über planare Facetten-Traversierung. Warum kein Flood-Fill auf Pixeln? Ein rasterbasierter Fill ist auflösungs-  
**Abhängigkeiten:** `lib/geometry.ts`, `lib/roofGeometry.ts`, `lib/uwert.ts`, `lib/verticalSymbols.ts`, `lib/zahl.ts`, `types/bim.ts`  
**Aufrufer:** `components/AufnahmeAssistent.tsx`, `components/RoofPanel.tsx`, `lib/aussenwand.ts`, `lib/autokorrektur.ts`, `lib/dachlandschaft.ts`, `lib/heatLoadEstimate.ts`, `lib/planPrint.ts`, `lib/raviaExport.ts`, `lib/ringleitung.ts`, `lib/validation.ts`, `store/useBimStore.ts`  
**Aufrufer in scripts/:** 41

Exportierte Funktionen/Konstanten: [`gradeSplit`](../../src/lib/roomDetection.ts#L115), [`BRUESTUNGS_HOEHE`](../../src/lib/roomDetection.ts#L147), [`WELD_TOLERANCE`](../../src/lib/roomDetection.ts#L168), [`usageDefaults`](../../src/lib/roomDetection.ts#L197), [`findOpenEnds`](../../src/lib/roomDetection.ts#L445), [`gebaeudeUmriss`](../../src/lib/roomDetection.ts#L773), [`detectRooms`](../../src/lib/roomDetection.ts#L1031), [`applyVerticalDeductions`](../../src/lib/roomDetection.ts#L1531), [`MASSIVE_SHARE`](../../src/lib/roomDetection.ts#L1631), [`isMassiveArea`](../../src/lib/roomDetection.ts#L1640), [`MAX_GAP`](../../src/lib/roomDetection.ts#L1695), [`diagnoseClosure`](../../src/lib/roomDetection.ts#L1718)

### [`src/lib/roomTemplates.ts`](../../src/lib/roomTemplates.ts) · 308 Zeilen

**Verantwortung:** Raumvorlagen — fertige Grundformen zum Aufziehen. Wände einzeln zu ziehen ist der ehrliche Weg und der langsamste. Die  
**Abhängigkeiten:** `types/bim.ts`  
**Aufrufer:** `components/Editor2D.tsx`, `store/useBimStore.ts`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`ROOM_TEMPLATES`](../../src/lib/roomTemplates.ts#L45), [`ROOM_TEMPLATE_BY_KIND`](../../src/lib/roomTemplates.ts#L92), [`DEFAULT_TEMPLATE_OPTIONS`](../../src/lib/roomTemplates.ts#L109), [`templatePolygon`](../../src/lib/roomTemplates.ts#L129), [`ROOM_SIZE_PRESETS`](../../src/lib/roomTemplates.ts#L293)

### [`src/lib/safetyFittings.ts`](../../src/lib/safetyFittings.ts) · 1258 Zeilen

**Verantwortung:** Sicherheitstechnik der Heizungsanlage — Ausdehnungsgefäß, Sicherheitsventil, Pflichtarmaturen nach DIN EN 12828 und DIN 4753.  
**Abhängigkeiten:** `lib/hydraulics.ts`, `types/bim.ts`  
**Aufrufer:** `lib/plantDesign.ts`  
**Aufrufer in scripts/:** 4

Exportierte Funktionen/Konstanten: [`EXPANSION_REFERENCE_TEMPERATURE`](../../src/lib/safetyFittings.ts#L59)⁰, [`GLYCOLS`](../../src/lib/safetyFittings.ts#L98)⁰, [`mixtureDensity`](../../src/lib/safetyFittings.ts#L130)⁰, [`expansionCoefficient`](../../src/lib/safetyFittings.ts#L164)⁰, [`glycolMixture`](../../src/lib/safetyFittings.ts#L220), [`vapourPressure`](../../src/lib/safetyFittings.ts#L272)⁰, [`VESSEL_SIZES`](../../src/lib/safetyFittings.ts#L288)⁰, [`MINIMUM_PRE_PRESSURE`](../../src/lib/safetyFittings.ts#L298)⁰, [`PRE_PRESSURE_MARGIN`](../../src/lib/safetyFittings.ts#L312)⁰, [`FILL_PRESSURE_MARGIN`](../../src/lib/safetyFittings.ts#L322)⁰, [`CLOSING_DIFFERENCE_LIMIT`](../../src/lib/safetyFittings.ts#L337)⁰, [`CLOSING_DIFFERENCE_FLAT`](../../src/lib/safetyFittings.ts#L339)⁰, [`CLOSING_DIFFERENCE_SHARE`](../../src/lib/safetyFittings.ts#L341)⁰, [`WATER_SEAL_SHARE`](../../src/lib/safetyFittings.ts#L352)⁰, [`MINIMUM_WATER_SEAL`](../../src/lib/safetyFittings.ts#L354)⁰, [`membraneVessel`](../../src/lib/safetyFittings.ts#L434)⁰, [`EXPANSION_LINE_SIZES`](../../src/lib/safetyFittings.ts#L582)⁰, [`expansionLineDiameter`](../../src/lib/safetyFittings.ts#L590)⁰, [`HEATING_SAFETY_VALVES`](../../src/lib/safetyFittings.ts#L622)⁰, [`DHW_SAFETY_VALVES`](../../src/lib/safetyFittings.ts#L643)⁰, [`selectHeatingSafetyValve`](../../src/lib/safetyFittings.ts#L650)⁰, [`selectDhwSafetyValve`](../../src/lib/safetyFittings.ts#L655)⁰, [`connectionDiameter`](../../src/lib/safetyFittings.ts#L675), [`RADIATOR_SPECIFIC_CONTENT`](../../src/lib/safetyFittings.ts#L708)⁰, [`FLOOR_LOOP_SPACING`](../../src/lib/safetyFittings.ts#L717)⁰, [`systemVolume`](../../src/lib/safetyFittings.ts#L760), [`designSafety`](../../src/lib/safetyFittings.ts#L883)

### [`src/lib/scanDienst.ts`](../../src/lib/scanDienst.ts) · 490 Zeilen

**Verantwortung:** Mit RaVia Scan scannen — der Weg ohne Datei. **Der Auftrag (07.10.2026):** „Funktion einbauen, wo man direkt zum RaVia  
**Abhängigkeiten:** –  
**Aufrufer:** `App.tsx`, `components/ScanDialog.tsx`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`SCAN_DIENST_PFAD`](../../src/lib/scanDienst.ts#L47)⁰, [`ABFRAGE_MS`](../../src/lib/scanDienst.ts#L50), [`ERLAUBTE_SERVER`](../../src/lib/scanDienst.ts#L58)⁰, [`ScanDienstFehler`](../../src/lib/scanDienst.ts#L89), [`dienstBasis`](../../src/lib/scanDienst.ts#L110), [`kopplungslinkGueltig`](../../src/lib/scanDienst.ts#L122), [`appLink`](../../src/lib/scanDienst.ts#L149), [`rueckkehrErlaubt`](../../src/lib/scanDienst.ts#L158), [`rueckkehrUrl`](../../src/lib/scanDienst.ts#L176), [`sitzungAusUrl`](../../src/lib/scanDienst.ts#L183), [`scanEntfernen`](../../src/lib/scanDienst.ts#L193), [`istAppleMobil`](../../src/lib/scanDienst.ts#L204), [`tokenMerken`](../../src/lib/scanDienst.ts#L227), [`tokenHolen`](../../src/lib/scanDienst.ts#L238), [`tokenVergessen`](../../src/lib/scanDienst.ts#L257), [`sitzungAnlegen`](../../src/lib/scanDienst.ts#L350), [`sitzungStand`](../../src/lib/scanDienst.ts#L375), [`gebaeudeHolen`](../../src/lib/scanDienst.ts#L388), [`uebernommenMelden`](../../src/lib/scanDienst.ts#L401), [`sitzungAbbrechen`](../../src/lib/scanDienst.ts#L411), [`naechsterSchritt`](../../src/lib/scanDienst.ts#L427), [`statusText`](../../src/lib/scanDienst.ts#L434), [`codeAnzeige`](../../src/lib/scanDienst.ts#L454), [`kurzfassung`](../../src/lib/scanDienst.ts#L464)

### [`src/lib/scanUebernahme.ts`](../../src/lib/scanUebernahme.ts) · 257 Zeilen

**Verantwortung:** Was nach der Raumerkennung mit einem Gebäudescan geschieht. Der Import (`buildingModelImport.ts`) übersetzt Wände, Öffnungen und das  
**Abhängigkeiten:** `lib/buildingModelImport.ts`, `lib/geometry.ts`, `lib/raumplanImport.ts`, `types/bim.ts`  
**Aufrufer:** `store/useBimStore.ts`  
**Aufrufer in scripts/:** 4

Exportierte Funktionen/Konstanten: [`SCAN_DACH_ID`](../../src/lib/scanUebernahme.ts#L28)⁰, [`scanDachZuordnen`](../../src/lib/scanUebernahme.ts#L83), [`benenneRaeume`](../../src/lib/scanUebernahme.ts#L145), [`uebernimmBeheizung`](../../src/lib/scanUebernahme.ts#L194), [`pruefpunkteAlsHinweise`](../../src/lib/scanUebernahme.ts#L233)

### [`src/lib/schemaAuswahl.ts`](../../src/lib/schemaAuswahl.ts) · 546 Zeilen

**Verantwortung:** Schemavorschlag — welches Hydraulikschema passt zu dieser Anlage? Bis 1.12.0 gab es genau einen Weg zu einem Anlagenschema: einen Knopf, der  
**Abhängigkeiten:** `lib/plantDesign.ts`, `lib/schemaKatalog.ts`, `types/bim.ts`  
**Aufrufer:** `lib/schemaZuordnung.ts`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`anlagenMerkmale`](../../src/lib/schemaAuswahl.ts#L149), [`bewerte`](../../src/lib/schemaAuswahl.ts#L246), [`schlageSchemaVor`](../../src/lib/schemaAuswahl.ts#L491)

### [`src/lib/schemaBeschriftung.ts`](../../src/lib/schemaBeschriftung.ts) · 481 Zeilen

**Verantwortung:** Wie ein Bauteil im Anlagenschema benannt wird. **Der Befund.** Auf dem Schemablatt der Projektmappe standen die Bauteilnamen  
**Abhängigkeiten:** `lib/beschriftungsLage.ts`  
**Aufrufer:** `components/SchemaView.tsx`, `lib/schematicPrint.ts`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`zaehleUeberlappungen`](../../src/lib/schemaBeschriftung.ts#L134), [`namensKaesten`](../../src/lib/schemaBeschriftung.ts#L199), [`setzePositionen`](../../src/lib/schemaBeschriftung.ts#L262), [`entscheideArt`](../../src/lib/schemaBeschriftung.ts#L383), [`setzeLeitungsbeschriftung`](../../src/lib/schemaBeschriftung.ts#L437)

### [`src/lib/schemaKatalog.ts`](../../src/lib/schemaKatalog.ts) · 2079 Zeilen

**Verantwortung:** Schemakatalog — die benannten Hydraulikschemata, aus denen vorgeschlagen wird. WAS DIESE DATEI IST  
**Abhängigkeiten:** `types/bim.ts`  
**Aufrufer:** `components/GuidePanel.tsx`, `lib/schemaAuswahl.ts`, `lib/schemaZuordnung.ts`, `store/useBimStore.ts`  
**Aufrufer in scripts/:** 2

Exportierte Funktionen/Konstanten: [`SCHEMA_KATALOG`](../../src/lib/schemaKatalog.ts#L326), [`schemaVorlage`](../../src/lib/schemaKatalog.ts#L2063), [`vorlagenNachAnbindung`](../../src/lib/schemaKatalog.ts#L2068), [`ANBINDUNG_LABELS`](../../src/lib/schemaKatalog.ts#L2072)

### [`src/lib/schemaLeitung.ts`](../../src/lib/schemaLeitung.ts) · 186 Zeilen

**Verantwortung:** Wo eine Leitung im Schema langläuft — die Geometrie, nicht die Farbe. **Warum das ein eigenes Modul ist.** Die rechtwinklige Führung einer  
**Abhängigkeiten:** `lib/schematicSymbols.ts`, `types/bim.ts`  
**Aufrufer:** `components/SchemaView.tsx`, `lib/uebersichtZeichnen.ts`  
**Aufrufer in scripts/:** 2

Exportierte Funktionen/Konstanten: [`LEITUNG_VORLAUF`](../../src/lib/schemaLeitung.ts#L59)⁰, [`leitungsverlauf`](../../src/lib/schemaLeitung.ts#L84)

### [`src/lib/schemaPruefung.ts`](../../src/lib/schemaPruefung.ts) · 1128 Zeilen

**Verantwortung:** Prüfung eines berechneten Anlagenschemas gegen die Regeln der Fachliteratur. **Was dieses Modul tut.** Es bekommt ein fertiges Fließbild — die Bauteile  
**Abhängigkeiten:** `lib/plantDesign.ts`, `lib/schemaZuordnung.ts`, `lib/zahl.ts`, `types/bim.ts`  
**Aufrufer:** `components/AnlagenPanel.tsx`, `components/GuidePanel.tsx`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`pruefeSchema`](../../src/lib/schemaPruefung.ts#L245)

### [`src/lib/schemaUebersicht.ts`](../../src/lib/schemaUebersicht.ts) · 1189 Zeilen

**Verantwortung:** Das Übersichtsschema — dasselbe Bild, für den Monteur lesbar. **Der Anlass.** Das erzeugte Anlagenschema zeigt alles, was die Auslegung  
**Abhängigkeiten:** `lib/schematicSymbols.ts`, `types/bim.ts`  
**Aufrufer:** `components/SchemaView.tsx`, `lib/uebersichtZeichnen.ts`  
**Aufrufer in scripts/:** 2

Exportierte Funktionen/Konstanten: [`UEBERSICHT_HINWEIS`](../../src/lib/schemaUebersicht.ts#L136), [`UEBERSICHT_HOECHSTZAHL`](../../src/lib/schemaUebersicht.ts#L150), [`uebersichtsschema`](../../src/lib/schemaUebersicht.ts#L403)

### [`src/lib/schemaZuordnung.ts`](../../src/lib/schemaZuordnung.ts) · 106 Zeilen

**Verantwortung:** Welche Musterlösung ist das? — die Zuordnung ohne Auswahlliste. **Warum es diese Datei gibt.** Bis 1.50.1 stand im Anlagenblatt eine Liste  
**Abhängigkeiten:** `lib/plantDesign.ts`, `lib/schemaAuswahl.ts`, `lib/schemaKatalog.ts`, `types/bim.ts`  
**Aufrufer:** `components/SchemaView.tsx`, `lib/schemaPruefung.ts`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`zugeordneteVorlage`](../../src/lib/schemaZuordnung.ts#L58)

### [`src/lib/schematicPrint.ts`](../../src/lib/schematicPrint.ts) · 1917 Zeilen

**Verantwortung:** Anlagenschema als druckfähiges Blatt. **Warum es dieses Modul gibt.** Ein Anlagenschema wird nicht am Bildschirm  
**Abhängigkeiten:** `lib/druckFenster.ts`, `lib/planScaleBar.ts`, `lib/schemaBeschriftung.ts`, `lib/schematicSymbols.ts`, `types/bim.ts`  
**Aufrufer:** `components/SchemaView.tsx`, `lib/materialSchedule.ts`, `lib/projektMappe.ts`  
**Aufrufer in scripts/:** 4

Exportierte Funktionen/Konstanten: [`darkenForPrint`](../../src/lib/schematicPrint.ts#L95)⁰, [`SvgRecorder`](../../src/lib/schematicPrint.ts#L139), [`BLATT`](../../src/lib/schematicPrint.ts#L520), [`fitsOnSheet`](../../src/lib/schematicPrint.ts#L887), [`leitungsfarbeAufBlatt`](../../src/lib/schematicPrint.ts#L1026), [`buildComponentTable`](../../src/lib/schematicPrint.ts#L1321), [`componentTableCsv`](../../src/lib/schematicPrint.ts#L1370), [`buildSchematicSvg`](../../src/lib/schematicPrint.ts#L1646), [`printSchematic`](../../src/lib/schematicPrint.ts#L1903)

### [`src/lib/schematicSymbols.ts`](../../src/lib/schematicSymbols.ts) · 2142 Zeilen

**Verantwortung:** Symbolbibliothek für das Anlagenschema. **Warum es dieses Modul gibt.** Das Anlagenschema ist ein Fließbild, kein  
**Abhängigkeiten:** `types/bim.ts`  
**Aufrufer:** `components/SchemaView.tsx`, `lib/materialSchedule.ts`, `lib/schemaLeitung.ts`, `lib/schemaUebersicht.ts`, `lib/schematicPrint.ts`, `lib/uebersichtZeichnen.ts`  
**Aufrufer in scripts/:** 6

Exportierte Funktionen/Konstanten: [`SCHEMATIC_LEGEND`](../../src/lib/schematicSymbols.ts#L275), [`SYMBOL_PORTS`](../../src/lib/schematicSymbols.ts#L1797)⁰, [`symbolExtent`](../../src/lib/schematicSymbols.ts#L1840), [`symbolAchse`](../../src/lib/schematicSymbols.ts#L1876)⁰, [`symbolPortPoints`](../../src/lib/schematicSymbols.ts#L1889), [`pickPortPair`](../../src/lib/schematicSymbols.ts#L1922), [`hasPort`](../../src/lib/schematicSymbols.ts#L1954), [`portsOf`](../../src/lib/schematicSymbols.ts#L1959), [`drawSymbol`](../../src/lib/schematicSymbols.ts#L2056), [`hitTestSymbol`](../../src/lib/schematicSymbols.ts#L2130)

### [`src/lib/siteSymbols.ts`](../../src/lib/siteSymbols.ts) · 447 Zeilen

**Verantwortung:** Außenanlage im Grundriss zeichnen. Der Plan zeigt bisher das Gebäude. Für die Aufstellung einer Wärmepumpe  
**Abhängigkeiten:** `lib/geometry.ts`, `types/bim.ts`  
**Aufrufer:** `components/Editor2D.tsx`  
**Aufrufer in scripts/:** 0

Exportierte Funktionen/Konstanten: [`SITE_COLORS`](../../src/lib/siteSymbols.ts#L20)⁰, [`drawSiteElement`](../../src/lib/siteSymbols.ts#L46), [`pumpCorners`](../../src/lib/siteSymbols.ts#L281)⁰, [`drawHeatPump`](../../src/lib/siteSymbols.ts#L317), [`hitTestPump`](../../src/lib/siteSymbols.ts#L395), [`hitTestSiteElement`](../../src/lib/siteSymbols.ts#L407), [`hitTestSiteArea`](../../src/lib/siteSymbols.ts#L441)

### [`src/lib/skizze.ts`](../../src/lib/skizze.ts) · 529 Zeilen

**Verantwortung:** Aus einem Freihandstrich werden Wände. **Der Anlass.** Auf dem Tablet liegt der Stift schon in der Hand. Wer vor  
**Abhängigkeiten:** `lib/geometry.ts`, `types/bim.ts`  
**Aufrufer:** `store/useBimStore.ts`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`SKIZZE_LEER`](../../src/lib/skizze.ts#L127)⁰, [`glaette`](../../src/lib/skizze.ts#L147), [`vereinfache`](../../src/lib/skizze.ts#L173), [`erkenneSkizze`](../../src/lib/skizze.ts#L222)

### [`src/lib/skizzenseite.ts`](../../src/lib/skizzenseite.ts) · 231 Zeilen

**Verantwortung:** Die Skizzenseite — ein Blatt Papier, kein Grundriss. **Warum es sie gibt.** Seit 1.64.0 gibt es das *Skizzenblatt*: eine Fläche  
**Abhängigkeiten:** `types/bim.ts`  
**Aufrufer:** `components/SkizzenSeite.tsx`, `store/useBimStore.ts`, `types/bim.ts`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`BLATT`](../../src/lib/skizzenseite.ts#L30), [`STRICHSTAERKEN`](../../src/lib/skizzenseite.ts#L33), [`STIFTFARBEN`](../../src/lib/skizzenseite.ts#L43), [`MESSSTRECKE_MIN`](../../src/lib/skizzenseite.ts#L105), [`meterJeMm`](../../src/lib/skizzenseite.ts#L107), [`nachWelt`](../../src/lib/skizzenseite.ts#L124), [`neueSeite`](../../src/lib/skizzenseite.ts#L136), [`naechsterBlattname`](../../src/lib/skizzenseite.ts#L147), [`strichZurueck`](../../src/lib/skizzenseite.ts#L156), [`istLeer`](../../src/lib/skizzenseite.ts#L160), [`umriss`](../../src/lib/skizzenseite.ts#L170), [`duenneAus`](../../src/lib/skizzenseite.ts#L199), [`punktzahl`](../../src/lib/skizzenseite.ts#L228)

### [`src/lib/slabGeometry.ts`](../../src/lib/slabGeometry.ts) · 415 Zeilen

**Verantwortung:** Geschossdecken — die Platte zwischen zwei Geschossen. Bis 1.11.0 hob `levelBaseHeights` jedes Geschoss auf seine Höhe, und genau  
**Abhängigkeiten:** `lib/durchbruchSymbols.ts`, `lib/geometry.ts`, `lib/levelGeometry.ts`, `lib/treppenlogik.ts`, `lib/verticalSymbols.ts`, `lib/wallGeometry.ts`, `types/bim.ts`  
**Aufrufer:** `components/Viewer3D.tsx`, `lib/baugrube.ts`  
**Aufrufer in scripts/:** 3

Exportierte Funktionen/Konstanten: [`GROUND_SLAB`](../../src/lib/slabGeometry.ts#L101), [`levelSlabs`](../../src/lib/slabGeometry.ts#L151), [`TOP_SLAB`](../../src/lib/slabGeometry.ts#L244), [`topSlab`](../../src/lib/slabGeometry.ts#L270), [`groundSlab`](../../src/lib/slabGeometry.ts#L329), [`holeFitsOutline`](../../src/lib/slabGeometry.ts#L378), [`slabArea`](../../src/lib/slabGeometry.ts#L384), [`bodenloecher`](../../src/lib/slabGeometry.ts#L411)

### [`src/lib/spiegeln.ts`](../../src/lib/spiegeln.ts) · 415 Zeilen

**Verantwortung:** Den Grundriss spiegeln — seitenverkehrt eingelesene Pläne geraderücken. Ein Grundriss kommt oft seitenverkehrt herein: ein abfotografierter Plan von  
**Abhängigkeiten:** `lib/dachlandschaft.ts`, `lib/geometry.ts`, `types/bim.ts`  
**Aufrufer:** `store/useBimStore.ts`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`spiegleWinkel`](../../src/lib/spiegeln.ts#L122), [`spiegleAzimut`](../../src/lib/spiegeln.ts#L136), [`spiegleDokument`](../../src/lib/spiegeln.ts#L163)

### [`src/lib/sprache.ts`](../../src/lib/sprache.ts) · 243 Zeilen

**Verantwortung:** Sprachen — und warum die deutschen Fachbegriffe stehen bleiben. **Wen das betrifft.** Nicht andere Märkte, sondern **Deutschland**. Rund  
**Abhängigkeiten:** `lib/sprachen/katalog.ts`  
**Aufrufer:** `components/Flaggen.tsx`, `components/GuidePanel.tsx`, `components/Toolbar.tsx`, `lib/sprachen/katalog.ts`, `store/useBimStore.ts`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`SPRACHEN`](../../src/lib/sprache.ts#L113), [`RECHTS_NACH_LINKS`](../../src/lib/sprache.ts#L144), [`FACHBEGRIFFE`](../../src/lib/sprache.ts#L159), [`spracheSetzen`](../../src/lib/sprache.ts#L190), [`spracheHolen`](../../src/lib/sprache.ts#L194), [`schluessel`](../../src/lib/sprache.ts#L199), [`t`](../../src/lib/sprache.ts#L217), [`fach`](../../src/lib/sprache.ts#L235), [`istFachbegriff`](../../src/lib/sprache.ts#L240)

### [`src/lib/sprachen/katalog.ts`](../../src/lib/sprachen/katalog.ts) · 60 Zeilen

**Verantwortung:** Die Wörterbücher — eines je Sprache außer Deutsch. **Warum Deutsch hier fehlt.** Der deutsche Text *ist* der Schlüssel. Ein  
**Abhängigkeiten:** `lib/sprache.ts`  
**Aufrufer:** `lib/sprache.ts`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`KATALOGE`](../../src/lib/sprachen/katalog.ts#L57)

### [`src/lib/steigstrang.ts`](../../src/lib/steigstrang.ts) · 254 Zeilen

**Verantwortung:** Steigleitung — die Verbindung zwischen den Geschossen. **Die Meldung dahinter:** „Wenn der Wärmeerzeuger unten ist und die Abnahme  
**Abhängigkeiten:** `lib/geometry.ts`, `lib/hydraulics.ts`, `lib/pipeInsulation.ts`, `types/bim.ts`  
**Aufrufer:** `lib/gebaeudeNetz.ts`, `lib/pipeLayout.ts`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`STRANG_WANDABSTAND`](../../src/lib/steigstrang.ts#L49)⁰, [`STRANG_MAX_V`](../../src/lib/steigstrang.ts#L51)⁰, [`STRANG_MAX_GEFAELLE`](../../src/lib/steigstrang.ts#L53)⁰, [`steigpunkt`](../../src/lib/steigstrang.ts#L119), [`steigRuns`](../../src/lib/steigstrang.ts#L182)

### [`src/lib/systemtemperatur.ts`](../../src/lib/systemtemperatur.ts) · 426 Zeilen

**Verantwortung:** Mit welcher Temperatur fährt diese Anlage? **Warum es diese Datei gibt.** Die Frage hat genau eine Antwort, und bis  
**Abhängigkeiten:** `lib/plantDefaults.ts`, `types/bim.ts`  
**Aufrufer:** `components/AnlagenPanel.tsx`, `lib/heizflaechenAbgleich.ts`, `lib/pipeLayout.ts`, `lib/pipeReport.ts`, `lib/plantDesign.ts`, `lib/verbraucherlast.ts`  
**Aufrufer in scripts/:** 4

Exportierte Funktionen/Konstanten: [`HEIZKOERPER_MINDESTVORLAUF`](../../src/lib/systemtemperatur.ts#L86), [`HEIZKOERPER_MINDESTRUECKLAUF`](../../src/lib/systemtemperatur.ts#L87), [`HEIZKOERPER_MINDEST`](../../src/lib/systemtemperatur.ts#L114), [`SYSTEMTEMPERATUR_VORGABE`](../../src/lib/systemtemperatur.ts#L139), [`KLEINSTE_SPREIZUNG`](../../src/lib/systemtemperatur.ts#L149), [`heizflaechenArten`](../../src/lib/systemtemperatur.ts#L175), [`heizflaechenart`](../../src/lib/systemtemperatur.ts#L194), [`kreistemperatur`](../../src/lib/systemtemperatur.ts#L213), [`systemtemperatur`](../../src/lib/systemtemperatur.ts#L295), [`systemtemperaturVon`](../../src/lib/systemtemperatur.ts#L385)

### [`src/lib/thermalBridges.ts`](../../src/lib/thermalBridges.ts) · 385 Zeilen

**Verantwortung:** Wärmebrücken — längenbezogen statt pauschal. Bisher trug jedes Bauteil einen pauschalen Zuschlag ΔU_WB auf seinen U-Wert.  
**Abhängigkeiten:** `lib/dachlandschaft.ts`, `lib/geometry.ts`, `lib/wallGeometry.ts`, `types/bim.ts`  
**Aufrufer:** `components/ThermalBridgePanel.tsx`, `lib/heatLoadEstimate.ts`, `lib/raviaExport.ts`, `lib/validation.ts`  
**Aufrufer in scripts/:** 3

Exportierte Funktionen/Konstanten: [`FLAT_SUPPLEMENT`](../../src/lib/thermalBridges.ts#L43), [`BRIDGE_TYPES`](../../src/lib/thermalBridges.ts#L64), [`DEFAULT_BRIDGE_CATALOGUE`](../../src/lib/thermalBridges.ts#L76)⁰, [`bridgeLengths`](../../src/lib/thermalBridges.ts#L95), [`roomThermalBridges`](../../src/lib/thermalBridges.ts#L220), [`roomBridgeHeatLoss`](../../src/lib/thermalBridges.ts#L247), [`beheizteGeschosse`](../../src/lib/thermalBridges.ts#L255)⁰, [`roomEnvelopeArea`](../../src/lib/thermalBridges.ts#L281), [`envelopeArea`](../../src/lib/thermalBridges.ts#L320), [`roomEquivalentSupplement`](../../src/lib/thermalBridges.ts#L343), [`documentBridgeHeatLoss`](../../src/lib/thermalBridges.ts#L352), [`documentBridgeLengths`](../../src/lib/thermalBridges.ts#L363)

### [`src/lib/treppenlogik.ts`](../../src/lib/treppenlogik.ts) · 343 Zeilen

**Verantwortung:** Treppenlogik — Steigung, Auftritt und das Loch in der Decke. **Der Anlass.** Im 3D-Modell war eine Treppe nur in dem Geschoss zu sehen,  
**Abhängigkeiten:** `lib/verticalSymbols.ts`, `types/bim.ts`  
**Aufrufer:** `components/PropertiesPanel.tsx`, `components/Viewer3D.tsx`, `lib/slabGeometry.ts`, `store/useBimStore.ts`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`TREPPE_GRENZEN`](../../src/lib/treppenlogik.ts#L52), [`DURCHGANGSHOEHE`](../../src/lib/treppenlogik.ts#L73), [`treppenmasse`](../../src/lib/treppenlogik.ts#L147), [`oeffnungAb`](../../src/lib/treppenlogik.ts#L261), [`treppenoeffnung`](../../src/lib/treppenlogik.ts#L284)

### [`src/lib/tuerseiten.ts`](../../src/lib/tuerseiten.ts) · 200 Zeilen

**Verantwortung:** Wohin eine Tür aufgeht — in Worten, die auf der Baustelle gelten. **Das Problem war nie die Geometrie, sondern der Name.** Das Modell weiß  
**Abhängigkeiten:** `lib/geometry.ts`, `lib/wallGeometry.ts`, `types/bim.ts`  
**Aufrufer:** `components/PropertiesPanel.tsx`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`PRUEFABSTAND`](../../src/lib/tuerseiten.ts#L69)⁰, [`tueranschlag`](../../src/lib/tuerseiten.ts#L157)

### [`src/lib/uebersichtZeichnen.ts`](../../src/lib/uebersichtZeichnen.ts) · 264 Zeilen

**Verantwortung:** Das Übersichtsschema zeichnen. Die Formensprache ist dieselbe wie im vollständigen Bild — es sind dieselben  
**Abhängigkeiten:** `lib/schemaLeitung.ts`, `lib/schemaUebersicht.ts`, `lib/schematicSymbols.ts`, `types/bim.ts`  
**Aufrufer:** `components/SchemaView.tsx`  
**Aufrufer in scripts/:** 2

Exportierte Funktionen/Konstanten: [`UEBERSICHT_MASSE`](../../src/lib/uebersichtZeichnen.ts#L52), [`symbolgroesse`](../../src/lib/uebersichtZeichnen.ts#L103), [`zeichneUebersicht`](../../src/lib/uebersichtZeichnen.ts#L114)

### [`src/lib/uimodus.ts`](../../src/lib/uimodus.ts) · 185 Zeilen

**Verantwortung:** Wie viel von diesem Programm jemand sehen will. **Drei Stufen, nicht zwei.** Bisher gab es „Einfach" und „Fachplaner". Das  
**Abhängigkeiten:** –  
**Aufrufer:** `App.tsx`, `components/AnlagenPanel.tsx`, `components/GuidePanel.tsx`, `components/Toolbar.tsx`, `components/ValidationPanel.tsx`, `store/useBimStore.ts`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`UI_STUFE`](../../src/lib/uimodus.ts#L32), [`mindestens`](../../src/lib/uimodus.ts#L47), [`UI_MODUS_LABELS`](../../src/lib/uimodus.ts#L51), [`UI_MODUS_AUSKUNFT`](../../src/lib/uimodus.ts#L57), [`HANDWERKER_WERKZEUGE`](../../src/lib/uimodus.ts#L81), [`HANDWERKER_REITER`](../../src/lib/uimodus.ts#L104), [`HANDWERKER_KOPF`](../../src/lib/uimodus.ts#L130), [`zeigtKopfknopf`](../../src/lib/uimodus.ts#L133), [`zeigtAnsicht`](../../src/lib/uimodus.ts#L145), [`zeigtWerkzeug`](../../src/lib/uimodus.ts#L151), [`zeigtReiter`](../../src/lib/uimodus.ts#L158), [`UEBERGABE_SCHRITTE`](../../src/lib/uimodus.ts#L174)

### [`src/lib/unbeheizt.ts`](../../src/lib/unbeheizt.ts) · 171 Zeilen

**Verantwortung:** Temperaturen unbeheizter Nachbarbereiche (seit 1.72.0). **Warum es das gibt.** Bis 1.71.0 kannte das Programm genau eine  
**Abhängigkeiten:** `types/bim.ts`  
**Aufrufer:** `components/PropertiesPanel.tsx`, `lib/raviaExport.ts`, `store/useBimStore.ts`  
**Aufrufer in scripts/:** 3

Exportierte Funktionen/Konstanten: [`DACHRAUM_FAKTOR`](../../src/lib/unbeheizt.ts#L49), [`dachraumTemperatur`](../../src/lib/unbeheizt.ts#L52), [`istUnbeheizterNachbar`](../../src/lib/unbeheizt.ts#L60), [`B_U`](../../src/lib/unbeheizt.ts#L68)⁰, [`UNBEHEIZT_ART_LABELS`](../../src/lib/unbeheizt.ts#L77), [`UNBEHEIZT_ART_VORGABE`](../../src/lib/unbeheizt.ts#L87), [`temperaturAusBu`](../../src/lib/unbeheizt.ts#L90)⁰, [`unbeheiztEingetragen`](../../src/lib/unbeheizt.ts#L97), [`unbeheizteTemperatur`](../../src/lib/unbeheizt.ts#L106), [`unbeheizteArtVonRaum`](../../src/lib/unbeheizt.ts#L116), [`unbeheizterRaumTemperatur`](../../src/lib/unbeheizt.ts#L132), [`migriereUnbeheizt`](../../src/lib/unbeheizt.ts#L143), [`NACHBAR_TEMPERATUR_VORGABE`](../../src/lib/unbeheizt.ts#L164)⁰, [`nachbarTemperatur`](../../src/lib/unbeheizt.ts#L167)

### [`src/lib/uwert.ts`](../../src/lib/uwert.ts) · 282 Zeilen

**Verantwortung:** Der U-Wert eines Bauteils — und woher er kommt. **Warum es diese Datei gibt.** Die Frage „welchen U-Wert hat diese Wand?"  
**Abhängigkeiten:** `types/bim.ts`  
**Aufrufer:** `components/PropertiesPanel.tsx`, `lib/buildingModelImport.ts`, `lib/heatLoadEstimate.ts`, `lib/ifcExport.ts`, `lib/ifcImport.ts`, `lib/importgeschoss.ts`, `lib/materialSchedule.ts`, `lib/raumplanImport.ts`, `lib/raviaExport.ts`, `lib/roomDetection.ts`, `lib/validation.ts`, `store/useBimStore.ts`  
**Aufrufer in scripts/:** 2

Exportierte Funktionen/Konstanten: [`VORGABE_U`](../../src/lib/uwert.ts#L98), [`U_FENSTER_BESTAND`](../../src/lib/uwert.ts#L123), [`U_TUER_BESTAND`](../../src/lib/uwert.ts#L124), [`U_SOHLE_NEUES_GESCHOSS`](../../src/lib/uwert.ts#L131), [`U_GESCHOSSDECKE`](../../src/lib/uwert.ts#L132), [`BAUTEIL_BEZEICHNUNG`](../../src/lib/uwert.ts#L135), [`istErfasst`](../../src/lib/uwert.ts#L153), [`uWertWand`](../../src/lib/uwert.ts#L201), [`uWertOeffnung`](../../src/lib/uwert.ts#L225), [`uWertBoden`](../../src/lib/uwert.ts#L250), [`herkunftText`](../../src/lib/uwert.ts#L270)

### [`src/lib/validation.ts`](../../src/lib/validation.ts) · 1700 Zeilen

**Verantwortung:** Modellprüfung — der Torwächter vor dem Export. Eine Heizlastrechnung ist nur so gut wie die Daten, die sie bekommt. Fehlt  
**Abhängigkeiten:** `lib/anlagenhinweise.ts`, `lib/dachlandschaft.ts`, `lib/durchbruchSymbols.ts`, `lib/geometry.ts`, `lib/heatLoadEstimate.ts`, `lib/heatPump.ts`, `lib/kaeltemittel.ts`, `lib/leitungsbefund.ts`, `lib/normleistung.ts`, `lib/nutzungseinheiten.ts`, `lib/pipeNetwork.ts`, `lib/plantDesign.ts`, `lib/roomDetection.ts`, `lib/thermalBridges.ts`, `lib/uwert.ts`, `lib/verbrauchsabgleich.ts`, `lib/zahl.ts`, `types/bim.ts`  
**Aufrufer:** `components/GuidePanel.tsx`, `components/Pruefansicht.tsx`, `components/ValidationPanel.tsx`, `lib/embedApi.ts`, `lib/raviaExport.ts`  
**Aufrufer in scripts/:** 12

Exportierte Funktionen/Konstanten: [`REMEDIES`](../../src/lib/validation.ts#L64), [`validateModel`](../../src/lib/validation.ts#L257)

### [`src/lib/valveCatalog.ts`](../../src/lib/valveCatalog.ts) · 444 Zeilen

**Verantwortung:** Armaturen mit Voreinstellung — vom erforderlichen kv zum Einstellwert. Der hydraulische Abgleich rechnet bis zum **erforderlichen kv-Wert** und  
**Abhängigkeiten:** –  
**Aufrufer:** `lib/erzeugerHydraulik.ts`, `lib/hydraulicBalance.ts`, `lib/pipeReport.ts`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`KV_REFERENCE_PRESSURE`](../../src/lib/valveCatalog.ts#L31), [`KV_REFERENCE_DENSITY`](../../src/lib/valveCatalog.ts#L34), [`MIN_VALVE_AUTHORITY`](../../src/lib/valveCatalog.ts#L45), [`TARGET_VALVE_AUTHORITY`](../../src/lib/valveCatalog.ts#L48), [`MAX_VALVE_AUTHORITY`](../../src/lib/valveCatalog.ts#L56), [`MAX_THERMOSTAT_PRESSURE`](../../src/lib/valveCatalog.ts#L70), [`DEFAULT_THERMOSTAT_PRESSURE`](../../src/lib/valveCatalog.ts#L76), [`HEIMEIER_V_EXACT_II_XP2`](../../src/lib/valveCatalog.ts#L122), [`HEIMEIER_V_EXACT_II_XP1`](../../src/lib/valveCatalog.ts#L142)⁰, [`DANFOSS_RA_N_15_XP2`](../../src/lib/valveCatalog.ts#L169)⁰, [`DANFOSS_RA_N_10_XP2`](../../src/lib/valveCatalog.ts#L189)⁰, [`DANFOSS_RA_N_20_XP2`](../../src/lib/valveCatalog.ts#L209)⁰, [`HEIMEIER_REGULUX`](../../src/lib/valveCatalog.ts#L235)⁰, [`IMI_TA_STAD`](../../src/lib/valveCatalog.ts#L272)⁰, [`VALVE_MODELS`](../../src/lib/valveCatalog.ts#L285), [`DEFAULT_MODEL_BY_ROLE`](../../src/lib/valveCatalog.ts#L296), [`findValveModel`](../../src/lib/valveCatalog.ts#L302), [`modelFor`](../../src/lib/valveCatalog.ts#L313), [`requiredKv`](../../src/lib/valveCatalog.ts#L366), [`pressureFromKv`](../../src/lib/valveCatalog.ts#L376), [`selectPreset`](../../src/lib/valveCatalog.ts#L391), [`valveAuthority`](../../src/lib/valveCatalog.ts#L431), [`authorityVerdict`](../../src/lib/valveCatalog.ts#L438)

### [`src/lib/verbraucherlast.ts`](../../src/lib/verbraucherlast.ts) · 142 Zeilen

**Verantwortung:** Auslegungsleistung je Heizfläche — die Größe, aus der der Volumenstrom folgt. **Befund A2.** Der hydraulische Abgleich rechnete den Volumenstrom jeder  
**Abhängigkeiten:** `lib/heatLoadEstimate.ts`, `lib/hydraulics.ts`, `lib/normleistung.ts`, `lib/systemtemperatur.ts`, `types/bim.ts`  
**Aufrufer:** `components/AnlagenPanel.tsx`, `lib/pipeLayout.ts`, `lib/pipeReport.ts`, `lib/raviaExport.ts`  
**Aufrufer in scripts/:** 2

Exportierte Funktionen/Konstanten: [`traegtRaumlast`](../../src/lib/verbraucherlast.ts#L47), [`leistungImBetriebspunkt`](../../src/lib/verbraucherlast.ts#L55), [`verbraucherLasten`](../../src/lib/verbraucherlast.ts#L75), [`raumlastenVon`](../../src/lib/verbraucherlast.ts#L127)⁰, [`leistungJeVerbraucher`](../../src/lib/verbraucherlast.ts#L137)

### [`src/lib/verbrauchsabgleich.ts`](../../src/lib/verbrauchsabgleich.ts) · 299 Zeilen

**Verantwortung:** Verbrauchsabgleich — die zweite Zahl zur Heizlast. WAS DIESES MODUL IST  
**Abhängigkeiten:** `types/bim.ts`  
**Aufrufer:** `components/AnlagenPanel.tsx`, `components/AufnahmeAssistent.tsx`, `lib/objektaufnahme.ts`, `lib/raviaExport.ts`, `lib/validation.ts`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`BRENNSTOFF_LABELS`](../../src/lib/verbrauchsabgleich.ts#L68), [`BRENNSTOFF_EINHEIT`](../../src/lib/verbrauchsabgleich.ts#L74), [`ENERGIEINHALT`](../../src/lib/verbrauchsabgleich.ts#L89)⁰, [`VOLLBENUTZUNGSSTUNDEN`](../../src/lib/verbrauchsabgleich.ts#L99), [`BAUALTERSKLASSEN`](../../src/lib/verbrauchsabgleich.ts#L121), [`baualtersklasse`](../../src/lib/verbrauchsabgleich.ts#L132), [`heizlastAusVerbrauch`](../../src/lib/verbrauchsabgleich.ts#L154), [`heizlastAusBaualter`](../../src/lib/verbrauchsabgleich.ts#L184), [`SCHWELLE`](../../src/lib/verbrauchsabgleich.ts#L229), [`verbrauchsabgleich`](../../src/lib/verbrauchsabgleich.ts#L284)

### [`src/lib/verticalSymbols.ts`](../../src/lib/verticalSymbols.ts) · 945 Zeilen

**Verantwortung:** Darstellung von Treppen, Schächten und Leitungen im Grundriss. Eine Treppe im Plan ist nicht einfach ein Rechteck: sie braucht die  
**Abhängigkeiten:** `lib/beschriftungsLage.ts`, `lib/pipeAccessorySymbols.ts`, `lib/rohrbezeichnung.ts`, `lib/rohrlaenge.ts`, `lib/zahl.ts`, `types/bim.ts`  
**Aufrufer:** `components/Editor2D.tsx`, `components/PropertiesPanel.tsx`, `components/Viewer3D.tsx`, `lib/eckpunkte.ts`, `lib/fussbodenkurven.ts`, `lib/planPrint.ts`, `lib/raviaExport.ts`, `lib/roomDetection.ts`, `lib/slabGeometry.ts`, `lib/treppenlogik.ts`, `store/useBimStore.ts`  
**Aufrufer in scripts/:** 3

Exportierte Funktionen/Konstanten: [`VERTICAL_COLORS`](../../src/lib/verticalSymbols.ts#L36)⁰, [`verticalCorners`](../../src/lib/verticalSymbols.ts#L44), [`hitTestVertical`](../../src/lib/verticalSymbols.ts#L58), [`drawVertical`](../../src/lib/verticalSymbols.ts#L67), [`stairPath`](../../src/lib/verticalSymbols.ts#L121), [`stairRunLength`](../../src/lib/verticalSymbols.ts#L162), [`stairLayout`](../../src/lib/verticalSymbols.ts#L190), [`drawPipe`](../../src/lib/verticalSymbols.ts#L381), [`drawPipeAccessory`](../../src/lib/verticalSymbols.ts#L542), [`distanceToPipe`](../../src/lib/verticalSymbols.ts#L608), [`ROOF_OPENING_COLORS`](../../src/lib/verticalSymbols.ts#L628)⁰, [`drawRoofOpening`](../../src/lib/verticalSymbols.ts#L640), [`SOLID_COLORS`](../../src/lib/verticalSymbols.ts#L735)⁰, [`solidFootprint`](../../src/lib/verticalSymbols.ts#L751), [`solidsOnLevel`](../../src/lib/verticalSymbols.ts#L777), [`hitTestSolid`](../../src/lib/verticalSymbols.ts#L802), [`drawSolid`](../../src/lib/verticalSymbols.ts#L827), [`drawCeilingOpening`](../../src/lib/verticalSymbols.ts#L907)

### [`src/lib/verworfeneRaeume.ts`](../../src/lib/verworfeneRaeume.ts) · 166 Zeilen

**Verantwortung:** Räume, die RaVia beim Übernehmen verworfen hat — sichtbar machen. **Der Anlass.** RaVias Schnittstelle `raeume-uebernehmen` lässt Räume unter  
**Abhängigkeiten:** –  
**Aufrufer:** `store/useBimStore.ts`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`GRUND_TEXT`](../../src/lib/verworfeneRaeume.ts#L55), [`leseVerworfene`](../../src/lib/verworfeneRaeume.ts#L76), [`hinweisFuer`](../../src/lib/verworfeneRaeume.ts#L120), [`hinweiseZuRaeumen`](../../src/lib/verworfeneRaeume.ts#L143)

### [`src/lib/wallGeometry.ts`](../../src/lib/wallGeometry.ts) · 416 Zeilen

**Verantwortung:** Abgeleitete Wandgeometrie — die *eine* Wahrheit für 2D und 3D. Beide Renderer konsumieren dieselben Funktionen. Dadurch kann eine  
**Abhängigkeiten:** `lib/geometry.ts`, `types/bim.ts`  
**Aufrufer:** `components/Editor2D.tsx`, `components/PropertiesPanel.tsx`, `components/Viewer3D.tsx`, `lib/baugrube.ts`, `lib/begehen.ts`, `lib/dachschnitt.ts`, `lib/durchbruchSymbols.ts`, `lib/griffe.ts`, `lib/hauseinfuehrung.ts`, `lib/heatPump.ts`, `lib/heizkoerperplatz.ts`, `lib/ifcExport.ts`, `lib/openingSymbols.ts`, `lib/pipeRouting.ts`, `lib/planPrint.ts`, `lib/raumtreffer.ts`, `lib/raviaExport.ts`, `lib/ringStich.ts`, `lib/ringleitung.ts`, `lib/slabGeometry.ts`, `lib/thermalBridges.ts`, `lib/tuerseiten.ts`, `lib/wandfuehrung.ts`, `lib/wandquerung.ts`, `lib/werkzeugkiste.ts`  
**Aufrufer in scripts/:** 7

Exportierte Funktionen/Konstanten: [`getWallGeometry`](../../src/lib/wallGeometry.ts#L28), [`junctionExtension`](../../src/lib/wallGeometry.ts#L51), [`openingCenter`](../../src/lib/wallGeometry.ts#L67), [`openingSpan`](../../src/lib/wallGeometry.ts#L73), [`wallSolidParts`](../../src/lib/wallGeometry.ts#L100), [`wallLocalToWorld`](../../src/lib/wallGeometry.ts#L144), [`indexWallsByNode`](../../src/lib/wallGeometry.ts#L170), [`planWallPieces`](../../src/lib/wallGeometry.ts#L196), [`modelToScene`](../../src/lib/wallGeometry.ts#L242), [`flachGekippt`](../../src/lib/wallGeometry.ts#L262), [`flacheStuetzpunkte`](../../src/lib/wallGeometry.ts#L283), [`sceneRotationY`](../../src/lib/wallGeometry.ts#L307), [`wallLocalToScene`](../../src/lib/wallGeometry.ts#L312), [`wallBoxPlacement`](../../src/lib/wallGeometry.ts#L340), [`pickWallForOpening`](../../src/lib/wallGeometry.ts#L360), [`openingsOfWall`](../../src/lib/wallGeometry.ts#L386), [`indexOpeningsByWall`](../../src/lib/wallGeometry.ts#L400), [`openingsOf`](../../src/lib/wallGeometry.ts#L414)

### [`src/lib/wandfuehrung.ts`](../../src/lib/wandfuehrung.ts) · 100 Zeilen

**Verantwortung:** Wo ein wandgebundenes Objekt hin kann — und wie weit es schon ist. **Warum es diese Datei gibt.** Ein Heizkörper hängt an einer Wand und kann  
**Abhängigkeiten:** `lib/wallGeometry.ts`, `types/bim.ts`  
**Aufrufer:** `components/Viewer3D.tsx`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`wandfuehrung`](../../src/lib/wandfuehrung.ts#L47), [`fuehrungsText`](../../src/lib/wandfuehrung.ts#L80), [`umsetzungsMeldung`](../../src/lib/wandfuehrung.ts#L93)

### [`src/lib/wandhoehen.ts`](../../src/lib/wandhoehen.ts) · 238 Zeilen

**Verantwortung:** Wandhöhen angleichen — eine Deckenhöhe je Geschoss. **Warum das eine eigene Funktion braucht.** Die Raumhöhe wird in  
**Abhängigkeiten:** `lib/geometry.ts`, `lib/roofGeometry.ts`, `types/bim.ts`  
**Aufrufer:** `components/AufmassPanel.tsx`, `store/useBimStore.ts`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`TOTZONE`](../../src/lib/wandhoehen.ts#L46), [`BRUESTUNGS_HOEHE`](../../src/lib/wandhoehen.ts#L57), [`AUSNAHME_LABELS`](../../src/lib/wandhoehen.ts#L62), [`hoehenbefund`](../../src/lib/wandhoehen.ts#L156), [`befundSatz`](../../src/lib/wandhoehen.ts#L219)

### [`src/lib/wandquerung.ts`](../../src/lib/wandquerung.ts) · 382 Zeilen

**Verantwortung:** Wo eine Leitung durch eine Wand geht. **Warum es diese Datei gibt.** Eine ausgelegte Trasse läuft durch das  
**Abhängigkeiten:** `lib/geometry.ts`, `lib/rohrlaenge.ts`, `lib/wallGeometry.ts`, `types/bim.ts`  
**Aufrufer:** `store/useBimStore.ts`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`QUERUNG_ZUSAMMEN`](../../src/lib/wandquerung.ts#L53), [`QUERUNG_HOEHENFENSTER`](../../src/lib/wandquerung.ts#L55), [`QUERUNG_LUFT`](../../src/lib/wandquerung.ts#L57), [`QUERUNG_MINDESTMASS`](../../src/lib/wandquerung.ts#L59), [`aussenmass`](../../src/lib/wandquerung.ts#L110), [`wandquerungen`](../../src/lib/wandquerung.ts#L116), [`querungsstellen`](../../src/lib/wandquerung.ts#L191), [`kernbohrungFuer`](../../src/lib/wandquerung.ts#L246), [`durchbruchAusStelle`](../../src/lib/wandquerung.ts#L266), [`durchbruecheFuerTrassen`](../../src/lib/wandquerung.ts#L329)

### [`src/lib/werkzeugkiste.ts`](../../src/lib/werkzeugkiste.ts) · 475 Zeilen

**Verantwortung:** Die Werkzeugkiste im Haus. **Warum es sie gibt.** In der begehbaren Ansicht steht man dort, wo später  
**Abhängigkeiten:** `lib/beschriftung3d.ts`, `lib/raumtreffer.ts`, `lib/wallGeometry.ts`, `types/bim.ts`  
**Aufrufer:** `components/Viewer3D.tsx`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`WERKZEUGE`](../../src/lib/werkzeugkiste.ts#L87), [`WERKZEUG_BY_ID`](../../src/lib/werkzeugkiste.ts#L113), [`ANSCHLUSS_AUSWAHL`](../../src/lib/werkzeugkiste.ts#L124), [`VENTIL_AUSWAHL`](../../src/lib/werkzeugkiste.ts#L127), [`anschlussKurz`](../../src/lib/werkzeugkiste.ts#L129), [`deuteZiel`](../../src/lib/werkzeugkiste.ts#L175), [`zielAuskunft`](../../src/lib/werkzeugkiste.ts#L225), [`darfSetzen`](../../src/lib/werkzeugkiste.ts#L262), [`zielAuswahl`](../../src/lib/werkzeugkiste.ts#L339), [`rohrLaenge`](../../src/lib/werkzeugkiste.ts#L349), [`rohrHoehe`](../../src/lib/werkzeugkiste.ts#L366), [`aufputz`](../../src/lib/werkzeugkiste.ts#L379), [`durchbruchPreset`](../../src/lib/werkzeugkiste.ts#L390), [`sturzAusZiel`](../../src/lib/werkzeugkiste.ts#L403), [`durchbruchAmRand`](../../src/lib/werkzeugkiste.ts#L416), [`durchbruchMeldung`](../../src/lib/werkzeugkiste.ts#L440), [`rohrMeldung`](../../src/lib/werkzeugkiste.ts#L456), [`mediumName`](../../src/lib/werkzeugkiste.ts#L472)

### [`src/lib/wirt.ts`](../../src/lib/wirt.ts) · 50 Zeilen

**Verantwortung:** Was der Wirt kann — RaVia, wenn CAD Light eingebettet ist. Seit Embed-API 1.9.0 (CAD Light 1.74.0) teilt der Wirt mit, was er selbst  
**Abhängigkeiten:** –  
**Aufrufer:** `lib/embedApi.ts`, `store/scanDialog.ts`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`setzeWirtFaehigkeiten`](../../src/lib/wirt.ts#L24), [`registriereWirtMelder`](../../src/lib/wirt.ts#L31), [`scanBeimWirtAnfordern`](../../src/lib/wirt.ts#L40), [`wirtZuruecksetzen`](../../src/lib/wirt.ts#L46)

### [`src/lib/wissenKorpus.ts`](../../src/lib/wissenKorpus.ts) · 3753 Zeilen

**Verantwortung:** Wissenskorpus — die Daten hinter der Wissensbasis. ZWECK  
**Abhängigkeiten:** `lib/wissensbasis.ts`  
**Aufrufer:** `lib/pipeReport.ts`  
**Aufrufer in scripts/:** 2

Exportierte Funktionen/Konstanten: [`WISSEN_KORPUS`](../../src/lib/wissenKorpus.ts#L47), [`KORPUS_STAND`](../../src/lib/wissenKorpus.ts#L3737), [`korpusUmfang`](../../src/lib/wissenKorpus.ts#L3746)

### [`src/lib/wissensbasis.ts`](../../src/lib/wissensbasis.ts) · 471 Zeilen

**Verantwortung:** Wissensbasis — mehrere Korpora, getrennt indiziert, gemeinsam gewichtet. Das Programm trifft Entscheidungen, die begründet werden müssen: warum  
**Abhängigkeiten:** –  
**Aufrufer:** `components/RohrnetzDialog.tsx`, `lib/pipeReport.ts`, `lib/projektMappe.ts`, `lib/wissenKorpus.ts`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`KORPUS_LABELS`](../../src/lib/wissensbasis.ts#L54), [`BELASTBARKEIT_LABELS`](../../src/lib/wissensbasis.ts#L73), [`tokenisiere`](../../src/lib/wissensbasis.ts#L216), [`Wissensbasis`](../../src/lib/wissensbasis.ts#L367), [`quellenzeile`](../../src/lib/wissensbasis.ts#L467)

### [`src/lib/zahl.ts`](../../src/lib/zahl.ts) · 33 Zeilen

**Verantwortung:** Zahlen für deutschen Text — Komma statt Punkt, echtes Minuszeichen. `toFixed` liefert „12.37" und „-12"; in einem deutschsprachigen  
**Abhängigkeiten:** –  
**Aufrufer:** `components/AnlagenPanel.tsx`, `components/AufnahmeAssistent.tsx`, `components/CalibrationOverlay.tsx`, `components/ConstructionPanel.tsx`, `components/ExportDiffPanel.tsx`, `components/ImageUploader.tsx`, `components/KorrekturDialog.tsx`, `components/LayerPanel.tsx`, `components/LevelBar.tsx`, `components/MappeDialog.tsx`, `components/PlanPrintDialog.tsx`, `components/PropertiesPanel.tsx`, `components/RohrnetzDialog.tsx`, `components/RoofPanel.tsx`, `components/RoomBook.tsx`, `components/SchemaView.tsx`, `components/SkizzenSeite.tsx`, `components/StatusBar.tsx`, `components/TgaPalette.tsx`, `components/Toolbar.tsx`, `components/Viewer3D.tsx`, `lib/deviceCatalog.ts`, `lib/gebaeudeNetz.ts`, `lib/pipeLayout.ts`, `lib/pipeReport.ts`, `lib/planPrint.ts`, `lib/planScaleBar.ts`, `lib/plantDesign.ts`, `lib/roomDetection.ts`, `lib/schemaPruefung.ts`, `lib/validation.ts`, `lib/verticalSymbols.ts`, `store/useBimStore.ts`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`dez`](../../src/lib/zahl.ts#L9), [`wie`](../../src/lib/zahl.ts#L21), [`deDatum`](../../src/lib/zahl.ts#L30)

### [`src/lib/zeigereingabe.ts`](../../src/lib/zeigereingabe.ts) · 353 Zeilen

**Verantwortung:** Stift, Finger, Maus — wer darf was. **Warum es diese Datei gibt.** Der Zeichner arbeitet seit jeher mit  
**Abhängigkeiten:** `types/bim.ts`  
**Aufrufer:** `components/Editor2D.tsx`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`eingabeart`](../../src/lib/zeigereingabe.ts#L50), [`FANG_FAKTOR`](../../src/lib/zeigereingabe.ts#L70), [`TIPPZIEL`](../../src/lib/zeigereingabe.ts#L77), [`EINGABE_VORGABE`](../../src/lib/zeigereingabe.ts#L105), [`STIFT_KARENZ_MS`](../../src/lib/zeigereingabe.ts#L116), [`ZEIGERLAGE_LEER`](../../src/lib/zeigereingabe.ts#L135), [`absicht`](../../src/lib/zeigereingabe.ts#L143), [`TIPP_WEG_PX`](../../src/lib/zeigereingabe.ts#L204), [`TIPP_DAUER_MS`](../../src/lib/zeigereingabe.ts#L213), [`istTipp`](../../src/lib/zeigereingabe.ts#L216), [`TIPP_WERKZEUGE`](../../src/lib/zeigereingabe.ts#L233), [`tippBedient`](../../src/lib/zeigereingabe.ts#L247), [`fortschreiben`](../../src/lib/zeigereingabe.ts#L258), [`ZOOM_MIN`](../../src/lib/zeigereingabe.ts#L301), [`ZOOM_MAX`](../../src/lib/zeigereingabe.ts#L302), [`zuWelt`](../../src/lib/zeigereingabe.ts#L308), [`gestenschritt`](../../src/lib/zeigereingabe.ts#L327)

### [`src/main.tsx`](../../src/main.tsx) · 136 Zeilen

**Verantwortung:** _kein Kopfkommentar_  
**Abhängigkeiten:** `App.tsx`, `lib/embedApi.ts`, `store/useBimStore.ts`  
**Aufrufer:** –  
**Aufrufer in scripts/:** 0

### [`src/services/qrBild.ts`](../../src/services/qrBild.ts) · 53 Zeilen

**Verantwortung:** Der QR-Code für den Dialog „Mit RaVia Scan scannen". Liegt bewusst nicht im Rechenkern (`src/lib`): Der kommt ohne fremde  
**Abhängigkeiten:** –  
**Aufrufer:** `components/ScanDialog.tsx`  
**Aufrufer in scripts/:** 1

Exportierte Funktionen/Konstanten: [`qrMatrix`](../../src/services/qrBild.ts#L16), [`qrSvgPfad`](../../src/services/qrBild.ts#L36)

### [`src/store/korrekturDialog.ts`](../../src/store/korrekturDialog.ts) · 21 Zeilen

**Verantwortung:** Ob der Dialog „Grundriss prüfen und korrigieren" offen ist. Ein eigener kleiner Zustand wie beim Scan-Dialog: Der Dialog gehört nicht  
**Abhängigkeiten:** –  
**Aufrufer:** `components/AufmassPanel.tsx`, `components/KorrekturDialog.tsx`, `components/Pruefansicht.tsx`  
**Aufrufer in scripts/:** 0

Exportierte Funktionen/Konstanten: [`useKorrekturDialog`](../../src/store/korrekturDialog.ts#L16)

### [`src/store/scanDialog.ts`](../../src/store/scanDialog.ts) · 43 Zeilen

**Verantwortung:** Ob der Dialog „Mit RaVia Scan scannen" offen ist — und für welche Sitzung. Ein eigener kleiner Zustand statt eines Felds im Modellzustand: Der Dialog  
**Abhängigkeiten:** `lib/wirt.ts`  
**Aufrufer:** `App.tsx`, `components/ScanDialog.tsx`, `components/ScanUebernahme.tsx`  
**Aufrufer in scripts/:** 0

Exportierte Funktionen/Konstanten: [`useScanDialog`](../../src/store/scanDialog.ts#L23), [`scanStarten`](../../src/store/scanDialog.ts#L35)

### [`src/store/useBimStore.ts`](../../src/store/useBimStore.ts) · 7528 Zeilen

**Verantwortung:** Zentraler Anwendungszustand (Zustand-Store). Aufteilung mit Absicht:  
**Abhängigkeiten:** `lib/anlagenFragen.ts`, `lib/aufstellgeschoss.ts`, `lib/aussenwand.ts`, `lib/autokorrektur.ts`, `lib/begradigen.ts`, `lib/beschriftung3d.ts`, `lib/bodenbelag.ts`, `lib/buildingModelImport.ts`, `lib/dachlandschaft.ts`, `lib/doppelleitung.ts`, `lib/doppelwaende.ts`, `lib/ebenen.ts`, `lib/erzeugerplatz.ts`, `lib/floorLoopLayout.ts`, `lib/formteile.ts`, `lib/gebaeudeNetz.ts`, `lib/geometry.ts`, `lib/geraeteprofil.ts`, `lib/heatLoadEstimate.ts`, `lib/heizflaechenAbgleich.ts`, `lib/heizflaechenLeistung.ts`, `lib/heizkoerperplatz.ts`, `lib/hostPatch.ts`, `lib/hydraulics.ts`, `lib/ifcImport.ts`, `lib/importgeschoss.ts`, `lib/levelCopy.ts`, `lib/levelGeometry.ts`, `lib/luecken.ts`, `lib/normleistung.ts`, `lib/notizen.ts`, `lib/nutzungseinheiten.ts`, `lib/objektaufnahme.ts`, `lib/pipeAccessorySymbols.ts`, `lib/planLeeren.ts`, `lib/plantDefaults.ts`, `lib/raumZuordnung.ts`, `lib/raumnutzung.ts`, `lib/raumplanImport.ts`, `lib/rohrbezeichnung.ts`, `lib/rohrlaenge.ts`, `lib/roofGeometry.ts`, `lib/roomDetection.ts`, `lib/roomTemplates.ts`, `lib/scanUebernahme.ts`, `lib/schemaKatalog.ts`, `lib/skizze.ts`, `lib/skizzenseite.ts`, `lib/spiegeln.ts`, `lib/sprache.ts`, `lib/treppenlogik.ts`, `lib/uimodus.ts`, `lib/unbeheizt.ts`, `lib/uwert.ts`, `lib/verticalSymbols.ts`, `lib/verworfeneRaeume.ts`, `lib/wandhoehen.ts`, `lib/wandquerung.ts`, `lib/zahl.ts`, `types/bim.ts`  
**Aufrufer:** `App.tsx`, `components/AnlagenDialog.tsx`, `components/AnlagenPanel.tsx`, `components/AufmassPanel.tsx`, `components/AufnahmeAssistent.tsx`, `components/CalibrationOverlay.tsx`, `components/ConstructionPanel.tsx`, `components/Editor2D.tsx`, `components/EntfernenKnopf.tsx`, `components/ExportDiffPanel.tsx`, `components/GuidePanel.tsx`, `components/HeatPumpPanel.tsx`, `components/ImageUploader.tsx`, `components/KorrekturDialog.tsx`, `components/LayerPanel.tsx`, `components/LevelBar.tsx`, `components/MappeDialog.tsx`, `components/NotizLeiste.tsx`, `components/PlanPrintDialog.tsx`, `components/ProjektDialog.tsx`, `components/PropertiesPanel.tsx`, `components/Pruefansicht.tsx`, `components/RohrnetzDialog.tsx`, `components/RoofPanel.tsx`, `components/RoomBook.tsx`, `components/ScanDialog.tsx`, `components/ScanUebernahme.tsx`, `components/SchemaView.tsx`, `components/SkizzenLeiste.tsx`, `components/SkizzenSeite.tsx`, `components/Skizzenblatt.tsx`, `components/StatusBar.tsx`, `components/TgaPalette.tsx`, `components/ThermalBridgePanel.tsx`, `components/Toolbar.tsx`, `components/ValidationPanel.tsx`, `components/VentilationPanel.tsx`, `components/Viewer3D.tsx`, `main.tsx`  
**Aufrufer in scripts/:** 0

Exportierte Funktionen/Konstanten: [`pipeLength`](../../src/store/useBimStore.ts#L99)⁰, [`DEFAULT_LAYERS`](../../src/store/useBimStore.ts#L230)⁰, [`ergaenzeEbenen`](../../src/store/useBimStore.ts#L245)⁰, [`useBimStore`](../../src/store/useBimStore.ts#L2201)

### [`src/types/bim.ts`](../../src/types/bim.ts) · 6005 Zeilen

**Verantwortung:** RaVia CAD Light — BIM-Datenmodell Einheiten-Konvention (projektweit verbindlich):  
**Abhängigkeiten:** `lib/domesticWater.ts`, `lib/huellflaechenbilanz.ts`, `lib/netzExport.ts`, `lib/nutzungseinheiten.ts`, `lib/objektaufnahme.ts`, `lib/skizzenseite.ts`  
**Aufrufer:** `components/AnlagenDialog.tsx`, `components/AnlagenFragen.tsx`, `components/AnlagenPanel.tsx`, `components/AufmassPanel.tsx`, `components/AufnahmeAssistent.tsx`, `components/CalibrationOverlay.tsx`, `components/ConstructionPanel.tsx`, `components/Editor2D.tsx`, `components/ExportDiffPanel.tsx`, `components/GuidePanel.tsx`, `components/HeatPumpPanel.tsx`, `components/ImageUploader.tsx`, `components/KorrekturDialog.tsx`, `components/PropertiesPanel.tsx`, `components/RaumnameFeld.tsx`, `components/RohrnetzDialog.tsx`, `components/RoofPanel.tsx`, `components/RoomBook.tsx`, `components/SchemaView.tsx`, `components/SkizzenLeiste.tsx`, `components/SkizzenSeite.tsx`, `components/TgaPalette.tsx`, `components/ThermalBridgePanel.tsx`, `components/Toolbar.tsx`, `components/ValidationPanel.tsx`, `components/VentilationPanel.tsx`, `components/Viewer3D.tsx`, `lib/anlagenFragen.ts`, `lib/annotationSymbols.ts`, `lib/aufnahme.ts`, `lib/aufstellgeschoss.ts`, `lib/auslegungExport.ts`, `lib/aussenwand.ts`, `lib/auswahlNamen.ts`, `lib/autokorrektur.ts`, `lib/autosave.ts`, `lib/baugrube.ts`, `lib/begehen.ts`, `lib/begradigen.ts`, `lib/beschriftung3d.ts`, `lib/bivalenz.ts`, `lib/buildingModelImport.ts`, `lib/dachlandschaft.ts`, `lib/dachschnitt.ts`, `lib/deviceCatalog.ts`, `lib/deviceImport.ts`, `lib/domesticWater.ts`, `lib/doppelleitung.ts`, `lib/durchbruchSymbols.ts`, `lib/ebenen.ts`, `lib/eckpunkte.ts`, `lib/embedApi.ts`, `lib/erzeugerHydraulik.ts`, `lib/erzeugerplatz.ts`, `lib/exportDiff.ts`, `lib/fixtureSymbols.ts`, `lib/floorLoopLayout.ts`, `lib/formteile.ts`, `lib/fussbodenkurven.ts`, `lib/gebaeudeNetz.ts`, `lib/geometry.ts`, `lib/griffe.ts`, `lib/hauseinfuehrung.ts`, `lib/heatLoadEstimate.ts`, `lib/heatPump.ts`, `lib/heizflaechenAbgleich.ts`, `lib/heizflaechenLeistung.ts`, `lib/heizkoerperplatz.ts`, `lib/hostPatch.ts`, `lib/hydraulicBalance.ts`, `lib/hydraulics.ts`, `lib/ifcExport.ts`, `lib/ifcImport.ts`, `lib/importgeschoss.ts`, `lib/kompass.ts`, `lib/leitungsbefund.ts`, `lib/levelCopy.ts`, `lib/levelGeometry.ts`, `lib/luecken.ts`, `lib/materialSchedule.ts`, `lib/netzExport.ts`, `lib/normleistung.ts`, `lib/notizen.ts`, `lib/nutzungseinheiten.ts`, `lib/objektaufnahme.ts`, `lib/openingSymbols.ts`, `lib/pipeAccessorySymbols.ts`, `lib/pipeInsulation.ts`, `lib/pipeLayout.ts`, `lib/pipeNetwork.ts`, `lib/pipeReport.ts`, `lib/pipeReportPrint.ts`, `lib/pipeRouting.ts`, `lib/planLeeren.ts`, `lib/planPrint.ts`, `lib/plantBook.ts`, `lib/plantDefaults.ts`, `lib/plantDesign.ts`, `lib/projectStore.ts`, `lib/projektMappe.ts`, `lib/raumZuordnung.ts`, `lib/raumnutzung.ts`, `lib/raumplanImport.ts`, `lib/raumtreffer.ts`, `lib/raviaExport.ts`, `lib/ringStich.ts`, `lib/ringleitung.ts`, `lib/rohrImRaum.ts`, `lib/rohrbezeichnung.ts`, `lib/rohrlaenge.ts`, `lib/roofGeometry.ts`, `lib/roomDetection.ts`, `lib/roomTemplates.ts`, `lib/safetyFittings.ts`, `lib/scanUebernahme.ts`, `lib/schemaAuswahl.ts`, `lib/schemaKatalog.ts`, `lib/schemaLeitung.ts`, `lib/schemaPruefung.ts`, `lib/schemaUebersicht.ts`, `lib/schemaZuordnung.ts`, `lib/schematicPrint.ts`, `lib/schematicSymbols.ts`, `lib/siteSymbols.ts`, `lib/skizze.ts`, `lib/skizzenseite.ts`, `lib/slabGeometry.ts`, `lib/spiegeln.ts`, `lib/steigstrang.ts`, `lib/systemtemperatur.ts`, `lib/thermalBridges.ts`, `lib/treppenlogik.ts`, `lib/tuerseiten.ts`, `lib/uebersichtZeichnen.ts`, `lib/unbeheizt.ts`, `lib/uwert.ts`, `lib/validation.ts`, `lib/verbraucherlast.ts`, `lib/verbrauchsabgleich.ts`, `lib/verticalSymbols.ts`, `lib/wallGeometry.ts`, `lib/wandfuehrung.ts`, `lib/wandhoehen.ts`, `lib/wandquerung.ts`, `lib/werkzeugkiste.ts`, `lib/zeigereingabe.ts`, `store/useBimStore.ts`  
**Aufrufer in scripts/:** 94

Exportierte Funktionen/Konstanten: [`BOUNDARY_LABELS`](../../src/types/bim.ts#L79), [`BOUNDARY_CONDITIONS`](../../src/types/bim.ts#L89), [`DEFAULT_CONSTRUCTIONS`](../../src/types/bim.ts#L127), [`WALL_THICKNESS_PRESETS`](../../src/types/bim.ts#L167), [`OPENING_LABELS`](../../src/types/bim.ts#L241), [`OPENING_PRESETS`](../../src/types/bim.ts#L295), [`RADIATOR_CONNECTION_LABELS`](../../src/types/bim.ts#L662), [`VENTILSEITE_LABELS`](../../src/types/bim.ts#L691), [`LEISTUNG_HERKUNFT_LABELS`](../../src/types/bim.ts#L725), [`leistungNachziehbar`](../../src/types/bim.ts#L733), [`FIXTURE_LIBRARY`](../../src/types/bim.ts#L914), [`FIXTURE_BY_TYPE`](../../src/types/bim.ts#L994), [`FIXTURE_CATEGORY_LABELS`](../../src/types/bim.ts#L998), [`DACH_VORGABE`](../../src/types/bim.ts#L1101), [`ROOF_KIND_LABELS`](../../src/types/bim.ts#L1111), [`DACHFORMEN_AUS_UMRISS`](../../src/types/bim.ts#L1145), [`ROOF_OPENING_LABELS`](../../src/types/bim.ts#L1316), [`pixelsPerMeter`](../../src/types/bim.ts#L1456), [`VERTICAL_LABELS`](../../src/types/bim.ts#L1549), [`SHAFT_SERVICE_LABELS`](../../src/types/bim.ts#L1559), [`SOLID_LABELS`](../../src/types/bim.ts#L1617), [`DURCHBRUCH_LABELS`](../../src/types/bim.ts#L1698), [`durchbruchWirt`](../../src/types/bim.ts#L1708), [`BRANDSCHUTZ_LABELS`](../../src/types/bim.ts#L1723), [`DURCHBRUCH_PRESETS`](../../src/types/bim.ts#L1849), [`PIPE_SERVICE_LABELS`](../../src/types/bim.ts#L1894), [`PIPE_SERVICE_COLORS`](../../src/types/bim.ts#L1906), [`AREA_CATEGORY_LABELS`](../../src/types/bim.ts#L2221), [`MOUNTING_LABELS`](../../src/types/bim.ts#L2237), [`HEAT_SOURCE_LABELS`](../../src/types/bim.ts#L2247), [`SOIL_LABELS`](../../src/types/bim.ts#L2257), [`SITE_ELEMENT_LABELS`](../../src/types/bim.ts#L2424), [`IGNITION_LABELS`](../../src/types/bim.ts#L2473), [`ANNOTATION_LABELS`](../../src/types/bim.ts#L2527), [`ANNOTATION_QUELLE_LABELS`](../../src/types/bim.ts#L2617), [`VORHABEN_LABELS`](../../src/types/bim.ts#L2800), [`VENTILATION_ROLE_LABELS`](../../src/types/bim.ts#L3062), [`PUMP_FORM_LABELS`](../../src/types/bim.ts#L4837), [`STORAGE_KIND_LABELS`](../../src/types/bim.ts#L5198), [`PIPE_MATERIAL_LABELS`](../../src/types/bim.ts#L5240), [`ZWEITERZEUGER_LABELS`](../../src/types/bim.ts#L5642), [`INNENEINHEIT_LABELS`](../../src/types/bim.ts#L5826), [`ANTWORTEN_VORGABE`](../../src/types/bim.ts#L5843)

### [`src/vite-env.d.ts`](../../src/vite-env.d.ts) · 24 Zeilen

**Verantwortung:** <reference types="vite/client" />  
**Abhängigkeiten:** –  
**Aufrufer:** –  
**Aufrufer in scripts/:** 0

⁰ = kein Modul importiert dieses Symbol namentlich (Kandidat für toten Code; Verwendung im selben Modul ist möglich). Details: Review-Dokumente im RaVia-Repository `ravia_heizlast/docs/review/`.
