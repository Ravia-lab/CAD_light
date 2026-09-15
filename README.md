# RaVia CAD Light

Ultraleichter 2D-Grundriss-Editor mit 3D-Echtzeitansicht, KI-gestütztem
Grundriss-Import und strukturiertem BIM-/TGA-Export nach DIN EN 12831.

```bash
npm install
npm run dev        # Entwicklungsserver
npm run build      # Produktions-Build
npm run verify     # Geometrie-Kernel prüfen (Raumerkennung, Maße, Orientierungen)
npm run bench      # Belastungsprobe an einem synthetischen Mehrfamilienhaus
```

---

## Architektur

```
src/
├─ types/bim.ts               Das gesamte Datenmodell — eine einzige Quelle der Wahrheit
├─ lib/
│  ├─ geometry.ts             2D-Mathematik: Vektoren, Snapping, Polygon-Offset, Azimut
│  ├─ wallGeometry.ts         Abgeleitete Wandgeometrie — von 2D UND 3D gemeinsam genutzt
│  ├─ roomDetection.ts        Automatische Raumerkennung (planare Facetten-Traversierung)
│  ├─ fixtureSymbols.ts       TGA-Symbolik: Vektorzeichnungen für Heizung, Sanitär, Lüftung
│  ├─ verticalSymbols.ts      Treppen, Schächte und Leitungen im Grundriss
│  ├─ annotationSymbols.ts    Freie Maßketten, Texte, Hinweisfahnen
│  ├─ roofGeometry.ts         Ortsabhängige Raumhöhe unter Schräge, Gauben und Dachfenstern
│  ├─ ifcExport.ts            IFC4-Export als STEP-Datei (ISO 10303-21)
│  ├─ ifcImport.ts            STEP-Parser und IFC4-Import (Geschosse, Wände, Öffnungen)
│  ├─ embedApi.ts             Einbettung in RaVia: window.RaViaCAD und postMessage-Brücke
│  ├─ hostPatch.ts            Der Rückweg: was die Gegenstelle schreiben darf — geprüft, quittiert, rücknehmbar
│  ├─ thermalBridges.ts       Anschlusslängen aus der Geometrie, ψ-Katalog, Gegenprobe
│  ├─ pipeNetwork.ts          Strangschema: Rohrnetz als Graph, Weg je Verbraucher
│  ├─ roomTemplates.ts        Fertige Grundformen zum Aufziehen — Rechteck bis Achteck
│  ├─ heatLoadEstimate.ts     Überschlägige Heizlast als Grundlage der Anlagenauslegung
│  ├─ deviceCatalog.ts        Wärmepumpen- und Speicher-Typklassen, Geräteauswahl
│  ├─ hydraulics.ts           Volumenströme, Rohrdimensionierung, Druckverlust, Pumpe
│  ├─ safetyFittings.ts       Ausdehnungsgefäß, Sicherheitsventil, Armaturen (DIN EN 12828)
│  ├─ domesticWater.ts        Trinkwarmwasser: Bedarf, Speicher, Legionellen, Zirkulation
│  ├─ plantDesign.ts          Die Reihenfolge: aus Heizlast wird eine vollständige Anlage
│  ├─ plantDefaults.ts        Vorbelegung des Anlagenblatts, verträglich mit Altdateien
│  ├─ schematicSymbols.ts     Fließbildsymbole nach DIN EN ISO 14617 für das Anlagenschema
│  ├─ schematicPrint.ts       Anlagenschema als maßstäbliches SVG samt Legende und Stückliste
│  ├─ hydraulicBalance.ts     Hydraulischer Abgleich: Drosseldruck und k_v je Strang
│  ├─ deviceImport.ts         Herstellerdatenblätter als CSV/JSON einlesen und prüfen
│  ├─ materialSchedule.ts     Massenauszug aus Modell und Auslegung, mit Herkunftsangabe
│  ├─ plantBook.ts            Anlagenbuch in neun Kapiteln, druckbar
│  ├─ glossar.ts             Fachbegriffe in Alltagssprache — einmal, zentral
│  ├─ heatPump.ts            Schallnachweis, Schutzbereich, Wärmequellenbedarf
│  ├─ siteSymbols.ts         Grundstück, Wärmepumpe und ihre Bedingungskreise im Plan
│  ├─ validation.ts           Modellprüfung vor der Übergabe
│  ├─ raviaExport.ts          RaVia-/TGA-Export inkl. DIN-EN-12831-Kennwerten
│  ├─ exportDiff.ts           Vergleich zweier Exportstände auf Raumebene
│  ├─ planPrint.ts            Maßstäblicher Planausdruck als SVG in Millimetern
│  ├─ planScaleBar.ts         Maßstabsleiste zum Nachmessen auf Papier
│  └─ autosave.ts             Entprellte Sitzungssicherung im lokalen Speicher
├─ services/
│  └─ aiVisionService.ts      Provider-Interface für SAM 2 / YOLOv8 / Claude Vision + Mock
├─ store/useBimStore.ts       Zustand-Store: Dokument, Historie, UI, Auto-Trace
└─ components/
   ├─ Editor2D.tsx            Canvas-2D-Editor (Zeichnen, Snapping, Bemaßung, Selektion)
   ├─ Viewer3D.tsx            Three.js-Clay-Renderer mit echten Wandaussparungen
   ├─ ImageUploader.tsx       Grundriss-Upload, Overlay-Steuerung, KI-Analyse
   ├─ CalibrationOverlay.tsx  2-Punkt-Maßband → Pixels-per-Meter
   ├─ TraceReviewBar.tsx      Prüfen & Übernehmen der KI-Vorschläge
   ├─ TgaPalette.tsx          Symbolbibliothek mit echter Zeichenvorschau
   ├─ Toolbar.tsx             Werkzeugleiste + Kopfzeile
   ├─ LevelBar.tsx            Geschossumschalter (anlegen, kopieren, löschen)
   ├─ RoofPanel.tsx           Dachform, Neigung, Kniestock — und was daraus folgt
   ├─ PropertiesPanel.tsx     Kontextsensitiver Inspektor
   ├─ RoomBook.tsx            Raumbuch mit CSV-Ausgabe
   ├─ ConstructionPanel.tsx   Bauteilkatalog (Aufbauten und ihre U-Werte)
   ├─ GuidePanel.tsx          Aufgabenliste „Was ist zu tun?" aus dem Modellstand
   ├─ Erklaerung.tsx          Das Fragezeichen neben jedem Fachbegriff
   ├─ HeatPumpPanel.tsx       Wärmepumpe, Aufstellung, Schallnachweis, Wärmequelle
   ├─ AnlagenPanel.tsx        Anlagenblatt: Gerät, Kreise, Speicher, Sicherheitstechnik
   ├─ SchemaView.tsx          Anlagenschema als Fließbild mit Legende und Erklärungen
   ├─ ThermalBridgePanel.tsx  Wärmebrücken: Verfahren, ψ-Werte, Gegenprobe, Absenkbetrieb
   ├─ VentilationPanel.tsx    Lüftungsanlage, Rückgewinnung, Luftbilanz, Rollen je Raum
   ├─ ValidationPanel.tsx     Prüfbericht, jeder Befund anklickbar
   ├─ ExportDiffPanel.tsx     „Was hat sich seit der letzten Übergabe geändert?"
   ├─ PlanPrintDialog.tsx     Maßstab, Blattformat, Vorschau, Drucken
   ├─ LayerPanel.tsx          Ebenen, Fang-Einstellungen, Raumliste
   └─ StatusBar.tsx           Statuszeile mit Live-Maßen
```

### Die vier tragenden Entscheidungen

**1. Eine Geometrie-Quelle für 2D und 3D.**
`wallSolidParts()` zerlegt jede Wand in massive Teilquader — Öffnungen sind
echte Lücken mit Brüstung und Sturz. Der Grundriss zeichnet die Lücken, der
3D-Viewer extrudiert dieselben Quader. Plan und Modell können nicht
auseinanderlaufen, und es wird keine einzige boolesche Operation gebraucht.

**2. Raumerkennung als planarer Graph, nicht als Pixel-Flood-Fill.**
Wandachsen werden an ihren echten Schnittpunkten planarisiert, dann werden
über eine Halbkanten-Struktur alle beschränkten Facetten umlaufen. Ergebnis:
exakte Polygone unabhängig vom Zoom, in O((n+k)·log n). Anschließend wird jede
Kante um ihre *eigene* halbe Wandstärke nach innen versetzt — dadurch stimmen
die lichten Maße auch bei gemischten Wandstärken (36,5 außen / 11,5 innen).

**3. Topologie beim Zeichnen herstellen, nicht hinterher reparieren.**
Endet eine neue Wand auf einer bestehenden, wird diese sofort geteilt — aus dem
optischen T-Stoß wird ein topologischer. Zusätzlich heilt die Raumerkennung vor
jedem Durchlauf: Enden innerhalb von 5 cm werden verschweißt, Enden knapp neben
einer fremden Achse exakt darauf gezogen. Was danach *immer noch* offen ist,
wird als orangefarbener Warnpunkt im Plan markiert — mit Zähler in der
Werkzeugleiste und Erklärung im Inspektor. Damit ist „Raum wird nicht erkannt"
kein Rätsel mehr, sondern eine sichtbare Stelle im Plan.

**4. Die KI schlägt vor, der Planer entscheidet.**
Vision-Ergebnisse landen nie direkt im Dokument. Sie werden als magenta
gestrichelte Vektoren über dem Plan angezeigt, sind einzeln verwerfbar und über
eine Konfidenzschwelle filterbar. Erst „Vorschlag übernehmen" erzeugt echte,
editierbare CAD-Wände — und genau dieser Schritt ist ein Undo-Schritt.

---

## Bedienbarkeit

Dieses Programm wird nicht nur von Fachplanern geöffnet. Wer einen Bestand
aufnimmt, ist Monteur, Meister oder Kundendienst — und sieht „ΔU_WB", „B′" und
zehn Reiter zum ersten Mal. Wer dann irgendetwas einträgt, ist schlimmer dran
als jemand, der nichts einträgt: die Zahl sieht danach aus wie eine Angabe.

Vier Dinge sorgen dafür, dass das nicht passiert.

### Zwei Ansichten statt einer überladenen

Beim ersten Start läuft die Anwendung im **einfachen Modus**: sechs Reiter
statt elf, acht Werkzeuge statt zwölf. Sichtbar ist, was zum Aufnehmen eines
Gebäudes gebraucht wird — Wände, Fenster, Türen, Räume, Heizkörper, Prüfung,
Übergabe. Wärmebrücken, Lüftung, Bauteilkatalog, Geschossverwaltung und
Rohrnetz sind ausgeblendet; sie werden nicht gelöscht, sie stehen nur nicht im
Weg. Ein Klick auf **Fachplaner** holt alles zurück, und die Wahl bleibt über
den nächsten Start hinaus bestehen — sie gehört zum Menschen, nicht zum
Projekt.

### „Was ist zu tun?" statt einer leeren Fläche

Der erste Reiter ist keine Eigenschaftsliste, sondern eine Liste offener
Punkte, die den Modellstand liest:

```
WAS IST ZU TUN?                     4 von 7 erledigt
✓ Grundriss zeichnen                        10 Wände
✓ Alle Räume geschlossen
  Fenster und Türen setzen
  Fenster-Werkzeug wählen und auf die Wand klicken. Ohne Fenster
  rechnet die Heizlast mit einer geschlossenen Wand — und fällt zu
  klein aus.                              [Fenster setzen]
```

Jeder offene Punkt sagt in einem Satz, warum er zählt, und hat eine
Schaltfläche, die genau das Werkzeug oder den Reiter öffnet, um den es geht.
Bewusst kein Assistent, der durch Schritte zwingt: ein Bestand wird selten in
der Reihenfolge aufgenommen, in der ein Programm ihn gern hätte.

### Jeder Fachbegriff erklärt sich selbst

Neben jedem Kürzel steht ein Fragezeichen. Dahinter liegt kein Tooltip,
sondern ein Kärtchen mit drei Angaben: was der Begriff heißt, was er in
Alltagssprache bedeutet — und, das ist die häufigste Rückfrage überhaupt,
welche Werte üblich sind:

> **n50 — Luftdichtheit**
> Wie undicht das Gebäude ist, gemessen im Blower-Door-Test.
>
> Beim Blower-Door-Test wird das Gebäude mit einem Ventilator auf Über- und
> Unterdruck gebracht und gemessen, wie viel Luft durch Ritzen nachströmt.
> n50 = 1,5 heißt: unter Prüfdruck wird die Raumluft eineinhalbmal je Stunde
> ausgetauscht. Ohne Messung wird geschätzt — Neubau 1,5, Altbau 3 bis 6.
>
> *Üblich: Passivhaus 0,6 · Neubau 1,5–3 · Altbau 3–6*

Die Texte stehen zentral in `lib/glossar.ts`, jeder Begriff genau einmal. Es
gilt eine Regel: **kein Fachbegriff darf durch einen anderen erklärt werden.**
Wer „Transmissionswärmeverlust" nachschlägt, kann mit
„Wärmedurchgangskoeffizient" nichts anfangen.

Das Kärtchen hängt am Fenster, nicht im Panel — der Inspektor scrollt und
schneidet ab, was über seinen Rand ragt.

### Jeder Befund sagt, was zu tun ist

Ein Prüfbericht, der nur nennt, was falsch ist, hilft dem nicht weiter, der es
nicht ohnehin weiß. Deshalb trägt jeder Befund einen zweiten Satz:

```
● Öffnung ist mit 40,00 m breiter als die 6,00 m lange Wand.
  So beheben Sie das: Breite verkleinern oder die Öffnung auf eine
  längere Wand ziehen.
  Anklicken springt zur Stelle im Plan
```

Der Handlungssatz steht getrennt von der Meldung, damit die Meldung kurz
bleiben kann. Ein Test prüft, dass **kein** Befund ohne ihn auskommt: er
erzeugt absichtlich kaputte Modelle, sammelt alle auftretenden Befundcodes und
schlägt an, sobald einer keinen Satz hat. Der interne Fehlercode wird nur im
Fachplaner-Modus angezeigt — er ist für die Fehlersuche im Programm da, nicht
für den Anwender.

Dazu: die Statuszeile zeigt, solange nichts Wichtigeres zu melden ist, wie das
gerade gewählte Werkzeug bedient wird. „Bereit" sagt niemandem etwas.

---

## Overlay- & Auto-Trace-Workflow

```
Upload (PNG/JPG/PDF) → Kalibrieren (2-Punkt) → Auto-Trace → Prüfen → Übernehmen → Nachzeichnen
```

| Schritt | Verhalten |
|---|---|
| **Upload** | Bild liegt als unterste Ebene, Deckkraft 0–100 % stufenlos. PDFs werden über `pdfjs-dist` gerastert (lazy geladen). |
| **Sperre** | Das Bild ist standardmäßig gesperrt. Entsperrt bekommt es einen gestrichelten Rahmen und lässt sich frei verschieben. |
| **Kalibrierung** | Linie über eine bekannte Bemaßung ziehen, Reallänge eintragen. Das Panel zeigt Faktor sowie px/m vorher und nachher, bevor bestätigt wird. |
| **Auto-Trace** | Vision-Provider liefert Wände, Öffnungen, Raumstempel und Maßketten. Vorschau in Magenta mit Konfidenz-Badge pro Vektor. |
| **Prüfen** | Klick wählt einen Vektor, `Alt+Klick` oder `Entf` verwirft ihn, der Schieberegler blendet alles unter einer Konfidenzschwelle aus. |
| **Übernehmen** | Endpunkte im 8-cm-Raster verschmelzen zu gemeinsamen Knoten, Öffnungen werden der nächstgelegenen Wand zugeordnet, OCR-Raumnamen übertragen. |

### Vision-Provider anbinden

Die Anwendung kennt nur das Interface `FloorplanVisionProvider`:

```ts
interface FloorplanVisionProvider {
  readonly id: VisionModelId;
  readonly label: string;
  analyze(req: VisionAnalyzeRequest, onProgress?): Promise<AiFloorplanAnalysis>;
}
```

Standard ist `auto`: erst der serverseitige Proxy `/api/vision/floorplan`, bei
Nichterreichbarkeit die lokale Simulation (im Ergebnis als `(Fallback)`
gekennzeichnet). Fest vorgeben lässt sich der Provider über
`VITE_VISION_PROVIDER=mock|proxy|sam2|yolo`.

**Koordinatenvertrag:** Provider liefern immer Bildpixel der Originalauflösung.
Die Umrechnung in Meter macht der Client über den kalibrierten Maßstab — ein neu
kalibriertes Bild braucht deshalb keinen neuen Vision-Call.

API-Schlüssel gehören nicht in den Browser; `HttpVisionProvider` spricht
ausschließlich den eigenen Proxy an.

---

## Öffnungen und TGA

**Öffnungsarten.** Fenster, Türen und Durchgänge sind dieselbe Entität mit
unterschiedlicher Ausbildung. Der Typenkatalog in der Kopfzeile wechselt
automatisch mit dem Werkzeug:

| Fenster | Türen | Durchgänge |
|---|---|---|
| Fest, Dreh, Dreh-Kipp, 2-flügelig, Fenstertür, Bandfenster | 76/88,5/101 nach DIN 18100, 2-flügelig, Schiebetür | mit Sturz, raumhoch, breiter Durchbruch, Rundbogen |

Der Typ steuert Symbol im Plan *und* Ausbildung im Modell: ein zweiflügeliges
Fenster bekommt einen Pfosten, eine Schiebetür ein Blatt vor der Wand, ein
Durchgang bewusst weder Rahmen noch Blatt. Durchgänge bekommen keinen U-Wert —
sie werden in der Heizlast nur als Loch von der Wandfläche abgezogen.

**TGA-Symbolik** (21 Symbole in drei Gewerken, jedes auf eigener Ebene):

- **Heizung** — Heizkörper, Röhrenradiator, Unterflurkonvektor, FBH-Heizkreis, Verteiler, Wärmeerzeuger, Steigstrang, Thermostat
- **Sanitär** — WC, Waschtisch, Dusche, Badewanne, Spüle, Warmwasserbereiter, Fallstrang, Bodenablauf
- **Lüftung** — Zu-/Abluftventil, Überströmelement, Lüftungsgerät, Kanaltrasse

Wandgebundene Objekte rasten beim Setzen an die nächste Wand und richten sich
daran aus — ein Heizkörper steht nie schräg. Kennwerte (Leistung in W,
Volumenstrom in m³/h, Anschlussnennweite) stehen am Symbol und wandern in den
Export; die Raumzuordnung ist abgeleitet und aktualisiert sich mit jeder
Geometrieänderung.

---

## Bedienung

| Taste | Funktion | | Taste | Funktion |
|---|---|---|---|---|
| `V` | Auswählen | | `G` | Raster-Fang |
| `W` | Wand zeichnen | | `O` | Ortho-Zwang (nur 0/90°) |
| `D` | Tür | | `H` | Ausrichtungs-Hilfslinien |
| `F` | Fenster | | `M` | Maßketten |
| `E` | Durchgang | | `0` / `Home` | Ansicht einpassen |
| `T` | TGA-Symbol | | `Entf` | Löschen |
| `Esc` | Abbrechen | | `Strg+Z` / `Strg+Umschalt+Z` | Rückgängig / Wiederholen |
| `Strg+A` | Alles auswählen | | `Strg+C` / `Strg+V` | Kopieren / Einfügen |
| `Strg+D` | Duplizieren | | `Strg+Umschalt+H` / `+V` | Spiegeln waagerecht / senkrecht |
| `Pfeiltasten` | Auswahl verschieben | | `Bild↑` / `Bild↓` | Geschoss wechseln |
| `R` | Treppe | | `S` | Schacht |
| `L` | Leitung verlegen | | `B` | Text & Maßkette |
| `Z` | Raum aufziehen | | `A` / `P` | Außengelände / Wärmepumpe |
| `Q` | Freihand skizzieren | | `K` | Auf den Plan schreiben (Notiz) |
| `W A S D` | Gehen im Begehmodus | | `Esc` | Begehmodus beenden |
| `Enter` | Zug abschließen | | `Rücktaste` | letzten Punkt zurücknehmen |

**Navigation.** Schwenken geht auf vier Wegen — rechte Maustaste ziehen,
mittlere Maustaste, `Leertaste` + ziehen oder das Pan-Werkzeug. Mausrad zoomt
zum Cursor, die Bedienelemente unten rechts zoomen und passen ein. Ein
Rechtsklick *ohne* Ziehen hebt die Auswahl auf.

Wände werden als Kette gezeichnet: jeder Klick setzt einen Punkt, der Endpunkt
wird zum nächsten Startpunkt, `Esc` beendet. Gefangen wird auf Knotenpunkte,
Wandachsen, das Raster und Winkelvielfache (0/45/90°, einstellbar) — beim
Winkelfang wird zusätzlich die Länge auf das Raster gerundet, sodass Maße wie
3,25 m ohne Nacharbeit entstehen.

### Räume aufziehen statt Wände zeichnen

Die allermeisten Räume sind rechteckig, und die meisten der übrigen sind ein
Rechteck mit einer ausgeschnittenen Ecke. Wer das jedes Mal aus vier bis acht
Einzelwänden zusammensetzt, verbringt die Hälfte der Zeit mit Arbeit, die das
Programm kennt.

Das Werkzeug **Raum aufziehen** (`Z`) legt acht Grundformen an — Rechteck,
L, U, T, Trapez, Achteck, Sechseck und eine als Vieleck angenäherte runde
Form mit einstellbarer Segmentzahl. Bei L, U und T ist die Aussparung
stufenlos einstellbar und in Vierteldrehungen drehbar. Zwölf Fertigmaße
(Gäste-WC, Bad, Bad barrierefrei, Schlaf-, Kinder-, Wohnzimmer, Küche, Flur,
Hauswirtschafts-, Technik-, Abstellraum, Büro) setzen den Raum direkt in
gebräuchlicher Größe.

Was dabei entsteht, ist **kein Sonderobjekt**, sondern ganz normale Wände:
jede einzeln verschiebbar, in der Dicke änderbar, löschbar. Die Vorlage ist
eine Eingabehilfe, keine Datenstruktur. Aufgezogen wird auf den *Wandachsen* —
wer 4,00 × 5,00 aufzieht, bekommt Achsmaße von 4,00 × 5,00 und je nach
Wandstärke ein lichtes Maß von 3,76 × 4,76.

**Räume kopieren.** `Strg+D` dupliziert den gefassten Raum samt Wänden,
Fenstern, Türen und den TGA-Objekten darin; `Strg+C` legt ihn in die
Zwischenablage, auch für ein anderes Geschoss. Eine Trennwand, die zu zwei
Räumen gehört, kommt mit — der Nachbar behält seine eigene.

### Züge abschließen

Ein gezeichneter Zug — Leitung, Grundstücksgrenze, Kollektorfläche — lässt
sich auf vier Wegen beenden, und alle vier **übernehmen** ihn:

- Klick auf den Startpunkt (nur Flächen; ein grüner Fangring kündigt an, dass
  der nächste Klick schließt),
- Doppelklick,
- `Enter`,
- Rechtsklick ohne Ziehen — die Geste, die in jedem CAD „fertig" heißt.

Die `Rücktaste` nimmt den letzten Punkt zurück, `Esc` übernimmt ebenfalls statt
zu verwerfen. Der Fangring für den Schlusspunkt wird in **Bildschirmpixeln**
gemessen, nicht in Metern: ein halber Meter ist bei einem eingezoomten Bad eine
halbe Bildschirmbreite und bei einem ausgezoomten Grundstück zwei Pixel.

**Maß statt Augenmaß.** Während des Zeichnens lässt sich die Länge direkt
eintippen — Zahl eingeben, `Enter`, der Punkt sitzt exakt. Mehrere Objekte
werden mit einem Auswahlrahmen gefasst und dann gemeinsam verschoben,
gespiegelt, kopiert oder als Reihe vervielfältigt.

Gegen schräge und überstehende Wände arbeiten drei Mechanismen zusammen:
**Ortho-Zwang** lässt nur 0/90° zu, **Hilfslinien** zeigen magentafarben, wenn
der Cursor mit einem bestehenden Knoten fluchtet und ziehen ihn exakt darauf,
und das **automatische Teilen** bindet jedes Wandende topologisch an, statt es
danebenstehen zu lassen.

---

## Tablet und Stift

Auf der Baustelle liegt kein Laptop. Gearbeitet wird mit dem iPad in der einen
und dem Stift in der anderen Hand — und dafür reicht es nicht, die Oberfläche
schmaler zu machen. Drei Dinge mussten stimmen: **wer zeichnen darf**, **was
aus einem krummen Strich wird**, und **wo die Finger hinfassen**.

### Die Eingaberegel steht an einer Stelle

`src/lib/zeigereingabe.ts` beantwortet für jedes Zeigerereignis eine einzige
Frage: *zeichnen, schieben, Geste oder verwerfen?* Die Regel ist bewusst aus
der Leinwand herausgezogen, denn sie ist prüfbar und wird geprüft (33 Punkte
in `npm run verify`) — eine Regel, die in Ereignisbehandlern verstreut liegt,
ist es nicht.

- **Der Stift zeichnet.** Immer, und er hat Vorrang vor allem anderen.
- **Der Handballen zeichnet nie.** Ein Finger, der aufsetzt, während der Stift
  unten ist oder ihn gerade erst verlassen hat (500 ms Karenz), wird
  verworfen — nicht abgefangen, sondern gar nicht erst beachtet, damit er den
  laufenden Zug nicht anfasst.
- **Ein Finger schiebt** das Bild, wie die mittlere Maustaste. Wer mit dem
  Finger zeichnen will, schaltet das im Fang-Feld frei.
- **Zwei Finger** schwenken und zoomen zugleich. Dabei gilt: der Weltpunkt
  zwischen den Fingern bleibt liegen, wo er liegt.
- **Der Fangradius wächst mit dem Zeiger** — Maus 1,0, Stift 1,35, Finger 2,5.
  Die Toleranz in Bildpunkten ist dieselbe; was sich ändert, ist die Hand.

### Aus dem Strich werden Wände (`Q`)

Ein hingekrakelter Grundriss wird geglättet, vereinfacht (Ramer–Douglas–
Peucker), auf eine **Vorzugsrichtung** ausgerichtet — die aus dem Strich
selbst kommt, oder aus dem Bestand, wenn schon Wände stehen — und an den
Ecken auf die Schnittpunkte der Geraden gezogen. Ein geschlossener Zug wird
als Umriss erkannt und ergibt einen Raum.

Der Vorschlag ist nur ein Vorschlag: er steht magenta gestrichelt über dem
grauen Rohstrich, damit man sieht, ob die Erkennung getroffen hat, was gemeint
war. Wandstärke und Wandart lassen sich in der Leiste noch ändern, ohne neu zu
zeichnen. Erst **Übernehmen** legt Wände an — als **ein** Schritt in der
Historie. Bewusst schräg gezeichnete Strecken bleiben schräg und werden
bernsteinfarben markiert, damit man sie nicht für einen Erkennungsfehler hält.

**In mehreren Zügen.** Ein Grundriss entsteht nicht in einem Strich: erst die
Außenwände umfahren, dann die Innenwände einzeichnen. Jeder weitere Strich
kommt zum Vorschlag **dazu** — bis 1.18.0 warf er den vorigen weg, und ein
misslungener Kurzstrich löschte den fertigen Vorschlag gleich mit. „Letzter
Zug zurück" nimmt nur den letzten Strich heraus. Die Leiste lässt sich
zusammenklappen; sie liegt sonst über dem unteren Teil der Zeichenfläche und
fängt dort jede Berührung ab.

Zwei Fälle, die dabei nur so aussehen wie Wände und keine sind: sehr kurze
Stücke (unter 35 cm) gelten als Ecke, die der Stift in zwei Zügen genommen
hat; und ein **kurzes Schrägstück zwischen zwei ausgerichteten Wänden** fällt,
wenn nach der Eckenrechnung weniger als 50 cm davon übrig bliebe. Eine
gewollte Abschrägung überlebt beides — sie wird von ihren Nachbarn
angeschnitten und bleibt lang.

### Handnotizen als eigene Ebene (`K`)

Was mit `K` geschrieben wird, ist eine **Randbemerkung** und wird nie
Geometrie: Pfeile, Maße von Hand, „Steigleitung hier hoch". Die Striche
liegen in der Projektdatei und im Geschoss, in dem sie geschrieben wurden —
aber nicht in Massenauszug, Heizlast oder Export.

- **Radieren** statt Zeichnen schaltet die Notizleiste um. Was die Bahn
  berührt, fällt **ganz** — ein halb weggeriebener Strich sieht nach Zeichnung
  aus und ist doch keine mehr. Der Fassradius liegt bei 12 cm und wird als
  Kreis an der Spitze gezeigt. Auch das Radieren ist ein Schritt in der
  Historie.
- **Ein- und ausblenden** geht in der Notizleiste und bei den Ebenen; gelöscht
  wird dabei nichts.
- **Auf dem Plan** erscheinen sie nur, wenn im Druckdialog „Handnotizen"
  angehakt ist. Vorgabe ist *aus*: ein Plan, der aus dem Haus geht, trägt
  keine Bemerkung mit, die niemand bewusst dazugelegt hat.

### Text auf dem Plan (`B`)

Das Eingabefeld erscheint **dort, wo getippt wurde** — wie die Längeneingabe
beim Wandzeichnen, mit denselben Tasten (Enter setzt, Esc bricht ab). Wer eine
bestehende Beschriftung trifft, ändert sie, statt eine zweite anzulegen; ein
Doppeltipp öffnet sie auch mit dem Auswahlwerkzeug. Eine Beschriftung ohne
Text wird wieder entfernt, statt als Platzhalter im Plan zu bleiben.

Vorher lag der einzige Weg über den Inspektor: angelegt wurde „Text", und die
Statuszeile bat, den richtigen Text dort einzugeben. Am Rechner ist das ein
Blick nach rechts — auf dem Tablet ist der Inspektor eine Schublade, die
geschlossen startet. Das Werkzeug fehlte außerdem im einfachen Modus ganz.

### Was der Zeiger nicht mehr mitnimmt

Ein angefangener Zug — Grundstück, Leitung, Wand — bleibt sichtbar, auch wenn
der Zeiger das Bild verlässt. Bei Maus fällt das kaum auf; mit Stift und
Finger meldet der Browser nach *jedem* Abheben, dass der Zeiger weg ist, denn
es gibt ihn dann nicht mehr. Die gesamte bisherige Umfahrung verschwand damit
nach jedem gesetzten Eckpunkt und kam erst beim nächsten Aufsetzen zurück. Am
Zeiger hängt jetzt nur noch das Gummiband zum nächsten Punkt.

Dazu am Grundstück: eine zweite Grundstücksgrenze **ersetzt** die erste — es
gibt nur eine —, und das steht jetzt in der Statuszeile, statt still zu
geschehen. Ein Modell, in dem nur das Grundstück gezeichnet ist, wird
eingepasst und beim Neustart zur Wiederherstellung angeboten; beides hing
vorher an „mindestens drei Wandknoten".

### Fangen auf Ecken

Bis 1.19.0 war der **Wandknoten** das einzige Fangziel im ganzen Programm —
von zwölf Objektfamilien im Dokument genau eine. Eine Grundstücksgrenze ließ
sich nicht an die Ecke des Nachbargebäudes legen, eine Leitung nicht an den
Punkt der Leitung daneben, und der vierte Punkt einer Umfahrung nicht auf die
Höhe des ersten, obwohl das die häufigste Absicht überhaupt ist.

`src/lib/eckpunkte.ts` sammelt jetzt alles, was eine Ecke ist: Geländepunkte,
Leitungspunkte, Kamin- und Treppenecken, **lichte** Raumecken (nicht die
Achse — die liegt eine halbe Wandstärke daneben), TGA-Objekte und die Punkte
des gerade gezogenen Zuges. Priorisiert wird nach **Abstand**, nicht nach Art:
eine Rangfolge wäre eine Behauptung darüber, was der Zeichner meint, der
Abstand ist eine Messung. Geschossgebundenes wird gefiltert, das Gelände nicht
— es gehört zum Grundstück und gilt in jeder Etage.

Der Fangmarker sagt jetzt auch, **was** er gefangen hat („Raumecke",
„Geländepunkt", „45°"). Vorher waren alle Arten türkis und unterschieden sich
nur in der Form; Raster und frei sahen sogar identisch aus, obwohl das eine
gefangen ist und das andere nicht. Abschalten lässt sich das Ganze unter
„Fang & Raster" mit dem Schalter **Ecken**.

### Beschriftungen anfassen

Eine Textbeschriftung wird auf ihrer **ganzen Fläche** getroffen, nicht mehr
nur am Ankerpunkt — bei zwanzig Zeichen waren vorher rund 95 % des sichtbaren
Textes tot. Ist sie gefasst, zeigt sie **Griffe**: weiße Quadrate an ihren
Punkten (verschieben, einzeln), ein blaues an der oberen rechten Ecke der
Textfläche (Größe ziehen, 0,5 bis 3fach — dieselben Grenzen wie im Inspektor).

Bei der Maßkette lässt sich damit ein **einzelner Messpunkt** umsetzen; vorher
verschob das Ziehen immer beide zugleich, und wer den falschen Punkt gesetzt
hatte, musste löschen und neu ansetzen. Der einzelne Punkt fängt dabei, die
ganze Beschriftung nicht: Wer einen Messpunkt umsetzt, meint eine Ecke, wer
den Text verschiebt, meint eine Stelle.

### Auf den Home-Bildschirm

`public/apple-touch-icon.png` (180 px) und das Web-App-Manifest liegen bei;
erzeugt werden sie aus `scripts/kachelbild.py`, damit das Zeichen an **einer**
Stelle geändert wird und nicht in drei Größen nachgezeichnet. Ohne
`apple-touch-icon` macht iOS ein Bildschirmfoto der Seite und legt das auf den
Home-Bildschirm — bei einer dunklen CAD-Oberfläche ein grauer Fleck.

Die Verweise stehen **relativ** in der `index.html`: Die Anwendung liegt auf
dem Server unter einem Unterpfad und als Einzeldatei unter `file://`, ein
führender Schrägstrich zeigte in beiden Fällen ins Leere. In der Einzeldatei
werden beide Verweise beim Bauen entfernt — dort gibt es keine Nachbardateien,
und zwei Fehler in der Konsole sind der falsche erste Eindruck für eine Datei,
die ausdrücklich ohne Server auskommt.

### Die Oberfläche unter dem Finger

Maßgeblich ist `pointer: coarse`, nicht die Fensterbreite: ein 13-Zoll-iPad
ist breiter als ein kleiner Laptop und braucht trotzdem große Schaltflächen.
Werkzeugknöpfe werden 44 px (Apples Mindestmaß; Google nennt 48), Chips 36 px,
Eingabefelder 16 px Schrift — darunter zoomt Safari beim Antippen ins Feld und
der Plan steht danach schief.

`flex: none` gehört bei beidem dazu und ist nicht Feinschliff: eine Höhe von
44 px hilft nichts, wenn der Knopf in einer Flex-Leiste sitzt und der Browser
ihn zusammendrückt, sobald mehr Knöpfe da sind als Platz. Gemessen auf dem
iPad quer: 44 × **20** px in der Werkzeugleiste, **18** × 44 px in der oberen.
Beide Leisten scrollen jetzt, statt zu schrumpfen.

Unter 1024 px Breite wird der Inspektor zur Schublade mit Griff am rechten
Rand, damit der Plan die Fläche behält. Geprüft wird das nicht mit Klicks,
sondern mit echten Zeigerereignissen in beiden Lagen des Geräts:

```bash
RAVIA_BASE=/Cad_light/ npm run build
RAVIA_BASE=/Cad_light/ npx vite preview --port 4177 &
npm run smoke:tablet     # iPad quer 1180×820 und hoch 820×1180
```

---

## Begehen — im Modell stehen statt es anzusehen

Die drei bisherigen Kameras (Orbit, Iso, Top) zeigen ein Modell auf dem Tisch.
**Begehen** ist etwas anderes: Man steht auf **1,65 m Augenhöhe** darin, und
die Frage lautet nicht mehr „wie sieht das aus", sondern „komme ich hier
durch". Das ist die Frage, die der Anwender sofort gegen seine eigene
Erfahrung prüft — und es ist die Grundlage für alles, was später im Raum
gesetzt werden soll.

**Am Rechner:** `W A S D` (oder die Pfeiltasten) gehen, Umschalt geht
schneller, die Maus dreht den Blick. Ein Klick ins Bild nimmt den Zeiger ins
Fangschloss, damit die Maus endlos dreht statt am Fensterrand anzustoßen; Esc
beendet beides.

**Auf dem Tablet:** unten links ein Schiebefeld zum Gehen — kein Steuerkreuz
aus vier Knöpfen, denn ein Mensch geht schräg, und zwar ständig. Der Knopf
kehrt beim Loslassen in die Mitte zurück; ohne das läuft man weiter, sobald
der Finger abrutscht. Gedreht wird durch Ziehen im Bild.

### Die Regel steht in einer Datei und wird geprüft

`src/lib/begehen.ts` beantwortet drei Fragen, und keine davon hat mit Three.js
zu tun:

- **Woran stößt man an?** Wände des aktiven Geschosses, aufgetrennt an jeder
  begehbaren Öffnung. Türen und Durchgänge sind Löcher, Fenster nicht — auch
  eine bodentiefe Verglasung nicht, sie ist zu. Eine Türschwelle über 5 cm
  gilt nicht mehr als Loch.
- **Wie weit kommt man?** Der Körper ist ein Kreis von 28 cm Radius; er gleitet
  an Kanten entlang, statt sich zu verhaken. Vor einer 24er-Wand steht die
  Achse 0,12 + 0,28 = **40 cm** von der Wandachse entfernt — nachrechenbar,
  nicht beobachtet.
- **Kommt man durch?** Durch eine Regeltür ja, durch eine 50 cm breite Öffnung
  nicht: Der Körper passt nicht, und die beiden Wandstücke heben sich beim
  Herausdrücken gegenseitig auf. Ohne eine ausdrückliche Prüfung darauf
  schlüpft man hindurch.

Gegangen wird in **Teilschritten** von höchstens einem halben Körperradius.
Die erste Fassung prüfte nur den Zielpunkt — und ließ einen bei 3,4 m/s durch
jede Wand, die schmaler war als ein Bildschritt. Der Prüflauf hat es sofort
gezeigt; 40 Punkte decken diese Regel ab.

---

## Geschosse, Aufbauten, Raumbuch

**Geschosse.** Jedes Geschoss ist ein eigenständiger Grundriss mit eigener
Höhe und eigener Lage über Gelände; Knoten, Wände und Objekte tragen ihre
Geschoss-ID, und die Raumerkennung läuft je Geschoss getrennt. Der Umschalter
sitzt in der Kopfzeile (`Bild↑`/`Bild↓`). Ein neues Geschoss kann den
Grundriss des aktuellen übernehmen — samt Raumnamen, Nutzung und
Solltemperatur, zugeordnet über den Raumschwerpunkt.

Der entscheidende Effekt steckt im Export: liegt über einem Raum ein
beheizter Raum gleicher Temperatur, wird seine Decke **adiabat** — dort fließt
keine Wärme. Ohne Geschossstapel müsste dieselbe Decke „gegen unbeheizt"
gerechnet werden und die Heizlast bekäme einen Verlust, den es nicht gibt.

**Bauteilkatalog.** Aufbauten (Außenwand, Innenwand, Decke, Boden, Fenster,
Tür) werden einmal gepflegt und den Bauteilen zugewiesen. Eine Änderung am
Aufbau zieht alle zugewiesenen Bauteile mit; im Export steht neben dem U-Wert
der Name des Aufbaus. Ist einem Bauteil ein Aufbau zugewiesen, gilt dessen
U-Wert — es soll keine zweite Wahrheit neben dem Katalog geben.

**Raumbuch.** Alle Räume aller Geschosse in einer Tabelle: Fläche, Höhe,
Volumen, Umfang, Solltemperatur, Luftwechsel, Außenwand- und Fensterfläche,
installierte Leistung. Ausgabe als CSV mit Semikolon und Komma-Dezimaltrenner,
also direkt in Excel zu öffnen.

**Sitzungssicherung.** Jede Änderung wird entprellt (1,5 s) im Browser
gesichert. Beim nächsten Start *fragt* die Anwendung, ob der Stand fortgesetzt
werden soll — automatisches Überschreiben dessen, was jemand gerade öffnen
wollte, ist keine Rettung.

---

## Dachgeschoss

Im Dachgeschoss stimmt nichts mehr, was im Regelgeschoss selbstverständlich
ist: Das Luftvolumen ist nicht Fläche × Höhe, eine Außenwand ist nicht
Länge × Geschosshöhe, und die Decke ist keine waagerechte Fläche, sondern eine
geneigte mit Giebeln an den Enden. Wer das Dachgeschoss wie ein Regelgeschoss
rechnet, bekommt zu viel Volumen und zu viel Wandfläche — bei gleichzeitig
fehlender Dachfläche, dem größten Verlustweg überhaupt.

Deshalb wird alles über *eine* Funktion abgeleitet: die lichte Höhe h(p) an
jedem Punkt des Grundrisses.

```
h(p) = Firsthöhe − Abstand(p, Firstachse) · tan(Neigung)
```

Volumen, Dachfläche, Wandflächen und die Wohnfläche sind Integrale über diese
Funktion, numerisch über ein 5-cm-Raster. Das ist bewusst gewählt: eine
geschlossene Lösung müsste das Raumpolygon an jeder Höhenlinie zerschneiden —
viel Code für Fälle, die in der Praxis nie auftreten.

Eingegeben werden vier Werte: **Dachform** (Sattel, Pult, Walm, flach),
**Neigung**, **Kniestock** und **Firstrichtung**; optional eine
Kehlbalkenlage. Alles andere folgt daraus und steht sofort im Inspektor —
Firsthöhe, Dachfläche, Luftvolumen und die **Wohnfläche nach WoFlV §4** (über
2,00 m voll, 1,00–2,00 m zur Hälfte, darunter gar nicht). Im Plan zeigen die
1-m- und 2-m-Höhenlinien, wo der Dachraum noch zählt; im Modell enden Wände,
Fenster und TGA-Objekte an der Dachfläche statt hindurchzustoßen.

Im Export wird daraus: je Dachfläche ein eigenes Hüllbauteil mit Neigung und
Azimut, die Giebel als eigene senkrechte Bauteile mit eigenem U-Wert, und
Wandflächen, die unter der Schräge auslaufen.

### Gauben und Dachflächenfenster

Beides sind Löcher in der Dachfläche, aber mit gegensätzlicher Wirkung.

Das **Dachflächenfenster** ersetzt ein Stück Dach durch Glas: dieselbe
Neigung, derselbe Azimut, anderer U-Wert und ein g-Wert dazu. Seine Fläche
wird von der Dachfläche *abgezogen* — und es landet auf der Dachfläche, über
der es tatsächlich sitzt. Ohne diese Zuordnung lägen alle solaren Gewinne auf
derselben Seite des Firsts.

Die **Gaube** hebt den Raum an. Sie wird nicht als Sonderfall gerechnet,
sondern über dieselbe Höhenfunktion: innerhalb ihrer Grundfläche läuft die
Decke von der Frontkante linear zurück, bis sie das Hauptdach trifft. Damit
stimmen Volumen und Wohnfläche von selbst, und drei neue Bauteile fallen
nebenbei an — die senkrechte Front (mit Verglasung), zwei Wangen und ein
eigenes Dach.

Auf welcher Seite des Firsts eine Gaube sitzt, entscheidet über die Richtung
ihrer Front. Ohne dieses Vorzeichen zeigten alle Gauben in dieselbe Richtung,
die eine Hälfte davon in den Berg hinein.

Die **Giebelgaube** unterscheidet sich von der Schleppgaube nicht im Namen,
sondern in der Höhenfunktion: ihre Front ist in der Mitte um das Giebeldreieck
höher und fällt zu beiden Wangen hin ab. Daraus folgt beides — die Frontfläche
wächst um ½ · Breite · Giebelhöhe, und ihr Dach steht quer geneigt, die Fläche
also um 1/cos(arctan(Giebelhöhe / halbe Breite)) über der Projektion. Eine
2,00 m breite Gaube mit 0,70 m Giebeldreieck bekommt so 1,60 m² Front statt
0,90 m² — ein Unterschied, der in der Heizlast ankommt.

---

## Treppen, Schächte, Rohrnetz

**Treppe und Schacht** sind dasselbe Problem: eine Fläche im Grundriss, die
kein Raum ist, weil die Decke darüber fehlt. Für die Heizlast heißt das
zweierlei — die Grundfläche des Raums wird kleiner, und über dieser Fläche
gibt es kein Bauteil, also auch keinen Transmissionsverlust. Beides schaltet
man je Bauteil einzeln: eine offene Treppe zieht ab, ein eingehauster
Treppenraum ist dagegen ein eigener Raum mit eigenen Wänden.

Die Treppe wird als echte Stufenfolge gezeichnet — mit Antritt, Stufenlinien
und Laufrichtungspfeil — und der Inspektor rechnet Steigungshöhe, Auftritt und
das Schrittmaß 2s+a aus; liegt die Steigung außerhalb 14–20 cm oder der
Auftritt außerhalb 23–37 cm nach DIN 18065, sagt er es.

Die vier Laufformen sind keine bloßen Symbole, sondern jeweils eine eigene
**Lauflinie**: der gerade Lauf eine Strecke, der viertelgewendelte L-Lauf zwei
Schenkel über ein Podest, der halbgewendelte U-Lauf zwei gegenläufige Läufe,
die Spindeltreppe ein Kreisbogen auf 0,62 · Radius. Die Stufen stehen immer
senkrecht auf dieser Linie — im Grundriss wie im 3D-Modell — und die
Steigungszahl folgt aus deren *Länge*, nicht aus der Luftlinie zwischen Anfang
und Ende. Bei der Spindeltreppe sind das schnell zwei Stufen Unterschied.

**Das Rohrnetz** dient dem Längenauszug: wie viele Meter DN 20 gedämmt, wie
viele Meter DN 15 blank. Leitungen werden als Polylinie verlegt und rasten an
TGA-Objekten ein — ein Klick auf den Heizkörper schließt den Zug dort an. Der
Export summiert alles je Gewerk, Nennweite und Dämmstärke.

---

## Planausdruck im Maßstab

`planPrint.ts` erzeugt ein SVG in **Millimetern** und setzt `@page size`
passend zum Blatt — damit ist der Ausdruck maßhaltig, ohne PDF-Bibliothek.
Wählbar sind 1:20 · 1:25 · 1:50 · 1:100 · 1:200, A4/A3, hoch oder quer.

Vor dem Drucken zeigt der Dialog, ob der Grundriss beim gewählten Maßstab
überhaupt aufs Blatt passt, und schlägt sonst den nächstpassenden vor — das
ist der Unterschied zu „drucken und hoffen". Auf dem Blatt stehen Schriftkopf
und eine **Maßstabsleiste**: damit lässt sich am ausgedruckten Papier
nachmessen, ob der Druckertreiber wirklich mit 100 % skaliert hat.

Bemaßt werden die Außenwände, und zwar außerhalb des Gebäudes — eine Maßlinie
im Raum überdeckt Raumstempel und Symbole und ist auf der Baustelle nicht
ablesbar. Zuschaltbar sind außerdem **Innenmaße** (die lichten Weiten je Raum),
**freie Maßketten und Beschriftungen** sowie eine **Legende**, die nur die
Symbole und Leitungsarten zeigt, die auf diesem Blatt tatsächlich vorkommen.

Freie Maßketten, Texte und Hinweisfahnen sind eigene Objekte (`B`): sie werden
gesetzt, wo sie gebraucht werden, und bleiben dort. Sie sind reine Plangrafik
und gehen nicht in die Berechnung ein.

---

## IFC4 — Export und Import

Das RaVia-JSON ist die Übergabe an die Heizlastberechnung. **IFC ist die
Übergabe an alles andere**: Architektur-CAD, Bauantrag, Fachplanung. Ein
Format, das nur ein einziges Programm liest, macht das Modell zur Sackgasse.

Geschrieben wird direkt als STEP-Datei nach ISO 10303-21, ohne Bibliothek —
eine IFC-Bibliothek bringt mehrere Megabyte WASM mit, für einen Umfang, der
hier auf gut dreihundert Zeilen passt. Erzeugt werden:

```
IfcProject → IfcSite → IfcBuilding → IfcBuildingStorey
  ├─ IfcWallStandardCase   Extrusion des Wandrechtecks
  ├─ IfcWindow / IfcDoor   mit IfcOpeningElement, IfcRelVoidsElement, IfcRelFillsElement
  ├─ IfcSpace              Raumpolygon + BaseQuantities (Fläche, Volumen, Höhe)
  ├─ IfcSlab               Bodenplatte je Raum
  ├─ IfcStair              Treppen
  ├─ IfcBuildingElementProxy  Schächte
  └─ IfcRoof               Dachfläche, sofern definiert
```

Die Ausgabe wurde mit **IfcOpenShell 0.8** gegengeprüft: 0 Schemaverstöße, und
alle Produkte lassen sich zu Geometrie auflösen. Die GUIDs sind deterministisch
aus dem Objektnamen abgeleitet — derselbe Export liefert dieselben GUIDs, damit
die Gegenstelle beim erneuten Import Objekte wiedererkennt statt Dubletten
anzulegen.

Zwei Fallstricke, die dabei auffielen und im Code dokumentiert sind: das erste
GUID-Zeichen trägt nur zwei Bit (Werte 0–3), und in ISO 10303-21 ist `1` ein
INTEGER — an einer REAL-Stelle muss `1.` stehen. Die meisten Betrachter
verzeihen beides stillschweigend, der Prüfer nicht.

### Import

Der wertvollste Grundriss ist der, den jemand anderes schon gezeichnet hat.
Wer eine IFC-Datei vom Architekten bekommt, soll sie nicht abpausen müssen —
Geschosse, Wände und Öffnungen stehen darin bereits maßhaltig. Gelesen werden
`IfcBuildingStorey`, `IfcWall*`, `IfcOpeningElement` (über `IfcRelVoidsElement`
der Wand zugeordnet) und die Art der Öffnung über `IfcRelFillsElement`.
Materialien, Bauteilaufbauten und Möblierung bleiben bewusst draußen: sie
wären Ballast für ein Werkzeug, dessen Zweck die Heizlast ist.

Die Wandachse kommt aus der **Axis-Repräsentation**, wenn die Datei sie
mitliefert — Revit und ArchiCAD tun das immer. Fehlt sie, wird die Mitte des
Volumenkörpers genommen. Der Unterschied ist keine Feinheit: liegt der Körper
einseitig zur Achse, verschiebt sich sonst der ganze Grundriss um eine halbe
Wandstärke.

Der STEP-Parser ist bewusst zeichenweise geschrieben statt zeilenweise. Eine
Entity darf über beliebig viele Zeilen gehen, und in Zeichenketten stehen
Semikolons und Klammern, die nicht als Struktur zählen — genau daran scheitern
naive Parser. Gelesen werden außerdem beide IFC4-Schreibweisen für Profile:
die klassische `IfcPolyline` und die kompakte `IfcIndexedPolyCurve` mit
`IfcCartesianPointList`.

Geprüft wurde gegen Dateien, die **nicht** von diesem Werkzeug stammen:
IfcOpenShell-Modelle mit und ohne Axis-Repräsentation, mit Öffnungen und über
zwei Geschosse. Der Import ersetzt das aktuelle Modell — mit Rückfrage, und
`Strg+Z` holt den vorherigen Stand zurück.

Geöffnet wird über denselben Knopf wie die Projektdatei; welches Format
vorliegt, entscheidet der *Inhalt*, nicht die Endung.

---

## Wärmebrücken

Der pauschale Zuschlag ΔU_WB ist bequem und meistens falsch — nur eben in
unbekannter Richtung. 0,10 W/(m²·K) ohne Nachweis liegen bei einem kompakten
Neubau weit auf der sicheren Seite; bei einem zerklüfteten Grundriss mit vielen
Fenstern können sie zu niedrig sein. Der Zuschlag hängt nämlich nicht an der
Fläche, sondern an **Kanten**: Gebäudeecken, Fensterlaibungen, Deckenauflagern,
Sockeln, Traufen.

Diese Kanten stehen bereits im Modell. Sie müssen nur gezählt werden:

| Anschluss | Länge kommt aus | ψ (Vorgabe) |
|---|---|---|
| Gebäudekante (Außenwandecke) | Ecke zweier Außenwände × Raumhöhe | −0,05 |
| Innenwand-Einbindung | Innenwand trifft Außenwand × Raumhöhe | 0,05 |
| Fenster-/Türlaibung | 2 × Höhe je Öffnung in der Außenwand | 0,10 |
| Sturz | Breite je Öffnung | 0,18 |
| Brüstung | Breite je Fenster (Türen haben keine) | 0,10 |
| Sockel / Bodenplatte | Umfang mit Erdkontakt | 0,22 |
| Geschossdecke an Außenwand | Außenwandlänge, wenn ein Geschoss darüber liegt | 0,08 |
| Traufe | Außenwandlänge unter der Dachschräge | −0,02 |
| Ortgang | Giebellänge ÷ cos(Neigung) | 0,06 |

Die negativen Werte sind kein Vorzeichenfehler: an einer Außenwandecke ist die
wärmeabgebende Außenfläche größer als die Innenfläche, über die gerechnet wird
— der Anschluss korrigiert eine Übertreibung der Flächenrechnung nach unten.

**Eine Kante, zwei Räume.** Die Einbindung einer Innenwand sehen beide
angrenzenden Räume, jeder von seiner Seite. Ungeteilt gezählt stünde sie
zweimal in der Bilanz; trennt die Wand zwei erkannte Räume, bekommt deshalb
jeder die Hälfte. Hängt sie frei, bleibt sie ganz beim einzigen Anlieger.

**Der eigentliche Nutzen ist die Gegenprobe.** Das Panel stellt den pauschalen
Zuschlag und die Bilanz Σ ψ·l nebeneinander und rechnet daraus den Zuschlag
aus, der dieselbe Bilanz ergäbe:

```
Hüllfläche            230,39 m²
pauschal               23,0 W/K      (0,10 × 230,39)
längenbezogen          11,4 W/K      (Σ ψ·l)
gleichwertig ΔU_WB    0,049 W/(m²·K)
```

Erst damit lässt sich die Frage „reichen 0,05?" beantworten, statt sie zu
beantworten, indem man 0,10 nimmt und hofft.

Gewählt wird **eines von beidem**: im pauschalen Verfahren trägt jede Fläche
ihren Zuschlag im U-Wert, im längenbezogenen tragen die Flächen 0 und der Raum
bekommt seine Anschlussliste. Beides zusammen wäre doppelt gezählt — deshalb
ist es eine Entscheidung und kein Nebeneinander.

**Derselbe Zuschlag steht auch je Raum.** Im längenbezogenen Verfahren trägt
jeder Raum im Export zusätzlich `thermalBridgeEquivalentSupplement` — sein
eigenes Σ ψ·l geteilt durch seine eigene Hüllfläche, die als
`thermalBridgeEnvelopeArea` danebensteht — nach derselben Definition wie der
gleichwertige Zuschlag auf Gebäudeebene. Das Feld ist die Brücke zu einer
Gegenstelle, die nur katalogisierte Wärmebrücken-Typen kennt und mit rohen
ψ-Werten nichts anfangen kann: sie multipliziert den Zuschlag wieder mit der
Hüllfläche und behandelt `detailed` raumweise wie `flat`, ohne eine
Genauigkeit vorzutäuschen, die ihr Modell nicht einlöst. Im pauschalen
Verfahren fehlt das Feld — dort steckt der Zuschlag schon im U-Wert jeder
Fläche, und ein zweiter Wert daneben wäre eine Einladung zur Doppelzählung.
Ein Raum ohne Hüllfläche trägt 0, weil es keine Bezugsfläche gibt; sein
Leitwert steht unverändert in `thermalBridgeHeatLoss`.

Die Vorgabewerte liegen in der Größenordnung der Planungsbeispiele zu
DIN 4108 Beiblatt 2 und bewusst auf der sicheren Seite; die pauschalen
Zuschläge derselben Norm sind hinterlegt (ohne Nachweis 0,10, Kategorie A 0,05,
Kategorie B 0,03). Jeder ψ-Wert ist überschreibbar und trägt im Export seine
Herkunft mit — ein geerbter Vorgabewert darf nicht wie ein gerechneter
aussehen.

### Absenkbetrieb

Der Wiederaufheizfaktor f_RH stand seit jeher im Datenmodell und wurde nirgends
benutzt. Jetzt wird er erfasst — zusammen mit Absenkzeit, Aufheizzeit,
Luftwechsel während der Absenkung und der Bauart als wirksame Speicherfähigkeit
(leicht 15, mittel 42, schwer 70 Wh/(m³·K)).

Abgeleitet werden nur die beiden Größen, die aus dem Modell selbst folgen:

```
τ    = c_wirk · V / H_Abs                     Zeitkonstante des Gebäudes [h]
ΔΘ   = (Θ_int − Θ_e) · (1 − e^(−t_Abs/τ))     Abfall in der Absenkzeit [K]
```

f_RH selbst wird **nicht geraten**. Er kommt aus einer Tabelle der geltenden
Norm, und in Deutschland ist er national auf 0 gesetzt. Eine erfundene Tabelle
wäre schlimmer als gar keine: sie sähe aus wie ein Nachweis. Wer einen Wert
vorgibt, bekommt die Aufheizleistung A_Boden · f_RH ausgewiesen; wer keinen
vorgibt, bekommt eine 0 und einen Hinweis im Prüfbericht, dass das eine
bewusste Angabe ist.

---

## Lüftungskonzept

In einem dichten Neubau entscheidet die Lüftung über einen guten Teil der
Heizlast. Ohne Wärmerückgewinnung geht die gesamte Zuluft mit
Außentemperatur ein; mit 80 % Rückgewinnung nur noch ein Fünftel davon. Fehlt
die Angabe im Datensatz, muss die Gegenstelle raten — und zwar um den Faktor
fünf.

Erfasst wird deshalb die **Anlage** (frei · Abluft · Zu-/Abluft), ihr
Rückgewinnungsgrad η und die Betriebsweise, dazu je Raum die **Rolle** im
Konzept. Die Rolle folgt zunächst der Nutzung — Aufenthaltsräume bekommen
Zuluft, Bad, WC und Küche sind Ablufträume, Flure strömen über — und lässt
sich je Raum umstellen. Die Volumenströme kommen von den gesetzten Ventilen,
nicht aus einer Tabelle: die raumbezogenen Werte der DIN 1946-6 sind
normativ und werden hier bewusst nicht nachgebildet.

Exportiert wird je Raum Zuluft, Abluft, Überströmung, der Mindestluftstrom
n_min·V zum Vergleich und die **wirksame Zuluft** V̇_zu · (1 − η) — genau der
Anteil, der noch Außenlufttemperatur trägt. Eine reine Abluftanlage bekommt
keine Rückgewinnung angerechnet; sie hat nichts, woraus sie zurückgewinnen
könnte.

Die zweite Zahl, auf die es ankommt, ist die **Luftbilanz**. Eine
Zu-/Abluftanlage ist per Definition ausgeglichen. Klafft sie, geht die
Differenz durch die Gebäudehülle: bei Überdruck hinaus, bei Unterdruck herein,
in beiden Fällen ungewärmt und in keiner Rechnung. Der Prüfbericht meldet eine
Abweichung über 10 %, einen Abluftraum ohne Ventil, einen Zuluftraum ohne
Ventil und einen Rückgewinnungsgrad, den kein Gerät erreicht.

---

## Strangschema

Der Längenauszug beantwortet die Frage des Einkaufs: wie viele Meter DN 20
gedämmt. Für den hydraulischen Abgleich zählt aber etwas anderes — **welcher
Verbraucher wie weit von seiner Quelle entfernt hängt**. Der ungünstigste
Strang bestimmt die Pumpe, und jeder Voreinstellwert folgt aus Länge und
Nennweite bis dorthin.

Diese Angaben stecken in der Zeichnung; sie müssen nur als Graph gelesen
werden statt als Striche:

1. Alle Stützpunkte werden zu Knoten verschmolzen, wenn sie näher als 6 cm
   beieinander liegen. Beim Zeichnen wird gefangen, exakt gleiche Koordinaten
   sind trotzdem die Ausnahme.
2. **Steigstränge verbinden Geschosse**: liegt in zwei Geschossen ein
   Steigstrang-Symbol übereinander, ist es dieselbe Leitung. Ohne diesen
   Schritt endete jeder Strang an der Geschossdecke.
3. Von allen Quellen — Verteiler, Erzeuger, Lüftungsgerät — läuft ein
   Dijkstra gleichzeitig los. Jeder Verbraucher bekommt damit seine
   *nächstgelegene* Quelle: dieselbe Zuordnung, die ein Installateur treffen
   würde.

Je Verbraucher steht danach im Export: Quelle, einfache Trassenlänge,
Kreislänge (hin und zurück), Höhenversatz, die kleinste Nennweite auf dem Weg
— der Engpass — und die Abschnittsfolge von der Quelle her gelesen. Dazu die
Liste derer, die **gar nicht angeschlossen** sind; das ist der häufigste
Planungsfehler und im Plan nicht zu sehen.

Gemessen wird an den gezeichneten Punkten, nicht an den verschmolzenen
Knoten. Sonst wichen Strangschema und Längenauszug um genau den Fangabstand
voneinander ab — zwei Zahlen im selben Dokument, die sich widersprechen.

Gerechnet wird auch hier nichts: Druckverluste, Ventilvoreinstellungen und
Pumpenauslegung entstehen in RaVia.

---

## Wärmepumpe und Außengelände

Wo eine Luft-Wärmepumpe stehen darf, ist keine Gerätefrage, sondern eine
Standortfrage. Und sie hat drei Antworten, die nichts miteinander zu tun haben
und trotzdem gleichzeitig stimmen müssen:

1. **Schall.** Am maßgeblichen Immissionsort darf der Beurteilungspegel nachts
   den Richtwert der TA Lärm nicht überschreiten. Das ist fast immer die
   härteste der drei Bedingungen — und die einzige, die man dem Gerät nicht
   ansieht.
2. **Sicherheitsabstand.** Bei Propan (R290) darf im Schutzbereich um das
   Gerät keine Öffnung liegen, durch die Gas nach unten wegsacken kann — und er
   darf nicht auf das Nachbargrundstück reichen.
3. **Bauordnung.** Abstandsflächen sind Ländersache; die meisten Länder haben
   Wärmepumpen inzwischen privilegiert, meist mit Bedingungen (Höhe bis 2 m,
   Länge je Grenze bis 3 m; NRW ohne Höhenbegrenzung, dafür 9 m je Grenze).

Das Werkzeug rechnet die erste Bedingung und prüft die zweite geometrisch. Zur
dritten sammelt es die Angaben, die dafür gebraucht werden — sie zu entscheiden
ist Sache der Behörde, nicht eines Programms.

### Der Schallnachweis

Gerechnet wird nach dem überschlägigen Verfahren der TA Lärm, Anhang A.2.4.3
Gleichung (G4):

```
L = L_WA + K_T + K0 − 20·lg(r) − 11 dB
```

Die 11 dB sind 10·lg(4π), also die Abstrahlung in alle Richtungen; **K0** holt
davon zurück, was Boden und Wände wieder zum Empfänger schicken (VDI 2714):

| Aufstellung | K0 | Bedeutung |
|---|---|---|
| frei im Garten, auf dem Boden | **+3 dB** | Halbraum — der Boden zählt bereits mit |
| vor einer Hauswand | **+6 dB** | Viertelraum |
| in einer Ecke oder Nische | **+9 dB** | Achtelraum |

Die drei Zeilen sind der Grund, warum dieselbe Wärmepumpe an der einen Stelle
passt und drei Meter weiter nicht: zwischen frei und Ecke liegen 6 dB, und das
sind bei sonst gleichen Werten **doppelter Abstand**.

Die Immissionsrichtwerte stehen in TA Lärm Nr. 6.1. Maßgeblich ist praktisch
immer die Nacht, weil eine Wärmepumpe durchläuft:

| Gebiet | tags | nachts |
|---|---|---|
| Reines Wohngebiet (WR) | 50 | **35** |
| Allgemeines Wohngebiet (WA), Kleinsiedlung | 55 | **40** |
| Misch-, Dorf-, Kerngebiet | 60 | **45** |
| Urbanes Gebiet | 63 | 45 |
| Gewerbegebiet | 65 | 50 |
| Kurgebiet, Krankenhaus | 45 | 35 |

**Wo gemessen wird**, sagt Anhang A.1.3: 0,50 m außerhalb vor der Mitte des
geöffneten Fensters des am stärksten betroffenen schutzbedürftigen Raums — und
zwar beim *Nachbarn*; das eigene Haus schützt die TA Lärm nicht. Deshalb kommen
die Immissionsorte aus zwei Quellen, in dieser Reihenfolge:

- **Gesetzte Immissionsorte.** Wer weiß, wo nebenan das Schlafzimmer liegt,
  setzt den Punkt dorthin. Das ist die richtige Antwort.
- **Die Grundstücksgrenze**, wenn keiner gesetzt ist. Für ein unbebautes
  Nachbargrundstück gilt ohnehin der Rand der überbaubaren Fläche (A.1.3 b) —
  die Grenze ist dafür die sichere Näherung, und sie ist immer bekannt.

Neben dem Richtwert steht ein zweiter, strengerer Zielwert: **Richtwert minus
6 dB**. Das ist die Irrelevanzschwelle der TA Lärm (Nr. 3.2.1 Abs. 2) — wer sie
hält, hat Luft für die Geräte, die in der Nachbarschaft noch dazukommen.
Behörden verlangen sie in der Praxis regelmäßig. Das Panel zeigt beides und der
Plan **zwei Kreise**: den engeren für den Richtwert, den weiteren für die
Reserve. Wer das Gerät verschiebt, sieht sofort, ob es passt.

Nachgerechnet: 55 dB(A) vor einer Wand, 5 m Abstand ⇒ 55 + 6 − 13,98 − 11 =
**36,0 dB(A)**. Im allgemeinen Wohngebiet eingehalten, aber ohne Reserve; dafür
wären 6,3 m nötig.

**Was das nicht ist: ein Gutachten.** Das überschlägige Verfahren liegt bei
etwa ±3 dB, Abschirmungen außer der Eigenabschirmung bleiben unberücksichtigt,
und im Grenzfall gehört die ausführliche Prognose nach DIN ISO 9613-2 dazu. Das
steht auch so im Panel — ein Programm, das eine Behördenentscheidung vortäuscht,
wäre schlimmer als keins.

Ein weiterer Punkt, an dem gern geschummelt wird: der **leise Nachtbetrieb**
zählt nur, wenn er auch garantiert läuft. Sonst gilt der lauteste
Betriebszustand — die Anlage könnte nachts ja hochlaufen. Das Programm rechnet
mit dem lauten Wert, solange der Haken nicht gesetzt ist.

### Der Schutzbereich bei Propan

Propan ist brennbar und schwerer als Luft. Tritt es aus, sinkt es zu Boden und
sammelt sich in Vertiefungen. Deshalb darf im Schutzbereich um das Gerät
nichts liegen, wo es hineinlaufen kann: Lichtschacht, Kellerabgang, Bodenablauf,
Kellerfenster, Kanaleinlauf — und er darf nicht über die Grundstücksgrenze
reichen.

Der Radius ist **kein Normwert**. Es gibt keine Tabelle „Füllmenge → Radius";
jeder Hersteller weist ihn für sein Gerät aus dem Prüfverfahren nach
DIN EN IEC 60335-2-40 aus. Verbreitet ist 1,00 m waagerecht ab Aufstellfläche.
Das Programm führt ihn deshalb als Gerätewert, nicht als Konstante — und sagt
das auch dazu.

Im Plan ist der Schutzbereich der dritte Kreis um das Gerät. Wer einen
Lichtschacht hineinschiebt, bekommt einen Fehler mit dem Satz, was zu tun ist.

### Der Baugrund

Bodenart und Grundwasserstand stehen im Reiter **Wärmepumpe** ganz oben unter
*Grundstück → Baugrund* — nicht beim Gerät. Der Grund: dieselbe Bodenart trägt
zwei Rechnungen, und nur eine davon hat mit der Wärmepumpe zu tun.

- Die **spezifische Entzugsleistung** der Erdwärmequelle (VDI 4640 Blatt 2,
  Tabelle unten) — nur bei Sole oder Grundwasser.
- Die **Erdreichrechnung der Heizlast** nach DIN EN ISO 13370 — die gibt es
  bei jedem Haus mit Keller oder Bodenplatte, auch bei einer Luft-Wärmepumpe
  und auch ganz ohne. Solange die Bodenart unter „Wärmequelle" saß, war sie
  für diesen Fall unerreichbar und stand nicht im Export.

Der **Grundwasserstand** ist die Tiefe des Spiegels unter Geländeoberkante. Er
ist die Größe, die die Grundwasserkorrektur G_w überhaupt erst auslöst: steht
der Spiegel dicht unter der Sohle, leitet der gesättigte Boden deutlich mehr
ab als der trockene darüber. Er hat **keine Vorbelegung** — das Feld bleibt
leer, bis jemand ins Bodengutachten gesehen hat, und der Export meldet dann
„nicht erfasst" statt einer geratenen Tiefe. Die Wärmeleitfähigkeiten λ des
Bodens liefert dieses Werkzeug nicht; ihre Tabelle gehört zur Norm.

### Die Wärmequelle

Für Sole und Grundwasser rechnet das Werkzeug den Bedarf und hält ihn gegen
das, was im Plan gezeichnet ist:

```
Entzugsleistung  Q̇₀ = Q̇_Heiz · (COP − 1)/COP
Sondenmeter      L  = Q̇₀ / q_spez          [W/m]
Kollektorfläche  A  = Q̇₀ / q_spez          [W/m²]
Fördermenge      V̇  = Q̇₀ / (1,163 · ΔT)    ΔT = 4 K
```

Die spezifischen Entzugsleistungen kommen aus VDI 4640 Blatt 2, mit den beiden
Spalten für 1800 h/a (ohne Warmwasser) und 2400 h/a (mit):

| Untergrund | Sonde 1800 h | Sonde 2400 h | Kollektor 1800 h | Kollektor 2400 h |
|---|---|---|---|---|
| trocken, sandig | 25 W/m | 20 W/m | 10 W/m² | 8 W/m² |
| normal, bindig-feucht | 60 | 50 | 25 | 20 |
| Festgestein, gut leitend | 84 | 70 | 30 | 24 |
| wassergesättigter Sand/Kies | 80 | 65 | 40 | 32 |

Beispiel: 8 kW bei COP 3,2 ⇒ 5,5 kW Entzug; normaler Untergrund mit Warmwasser
(50 W/m) ⇒ **110 Sondenmeter**, also zwei Bohrungen à 60 m. Beim Kollektor
wären es 275 m².

Ab **30 kW oder mehr als fünf Sonden** sagt das Programm, dass die
Tabellenauslegung nicht mehr reicht und simuliert werden muss — so steht es in
der Fassung 2019 der VDI 4640.

Das **Wasserschutzgebiet** wird als Ampel geführt: in den Zonen I bis III bzw.
III A ist die Errichtung nach § 49 Abs. 2 AwSV grundsätzlich unzulässig, in
Zone III B ist eine Ausnahme möglich. Verbindlich ist die
Schutzgebietsverordnung vor Ort — auch das steht dabei.

### Was im Gelände gezeichnet werden kann

Grundstücksgrenze · Nachbargebäude · Immissionsort · Öffnung, Schacht oder
Ablauf · Baum · Erdwärmesonde · Flächenkollektor · Grabenkollektor ·
Förder- und Schluckbrunnen · Ver- und Entsorgungsleitung · befestigte Fläche.

Punkte sitzen mit einem Klick, Flächen werden umfahren (ein Klick auf den
ersten Punkt schließt sie), Züge wie eine Leitung. Das Einpassen der Ansicht
schließt das Grundstück mit ein — eine Wärmepumpe steht selten innerhalb der
Außenwände.

### Im Export

`heatPump` trägt das Grundstück (Gebietstyp mit beiden Richtwerten, Bundesland,
Untergrund, Schutzzone, Fläche), je Gerät die Auslegungsdaten (Heizleistung im
Betriebspunkt, COP, Betriebsweise, Bivalenzpunkt, Kältemittel, Sperrzeitregime
und -faktor) sowie den **vollständigen Schallnachweis** mit Rohgrößen — die
Gegenstelle soll nachrechnen können, nicht das Ergebnis glauben müssen. Dazu
die Verletzungen des Schutzbereichs, der Quellenbedarf und alle Objekte des
Geländes als Rohdaten für den Lageplan.

---

## Anlagentechnik — vom Grundriss zur ausgelegten Anlage

Bis hierher erfasst das Werkzeug Daten. Der Reiter **Anlage** geht einen
Schritt weiter: er legt aus dem Modell eine vollständige Wärmepumpenanlage aus
— Gerät, Heizkreise, Rohrdimensionen, Speicher, Sicherheitsarmaturen,
Trinkwarmwasser — und zeichnet daraus ein Anlagenschema.

### Die Reihenfolge ist die eigentliche Leistung

Jeder Rechenkern für sich ist Schulstoff. Was in der Praxis schiefgeht, ist
die Reihenfolge. `plantDesign.ts` hält sie fest:

1. **Heizlast.** Ohne sie ist alles andere eine Vermutung.
2. **Warmwasserzuschlag und Sperrzeitfaktor** — sie erhöhen die geforderte
   Leistung, *bevor* ein Gerät gewählt wird.
3. **Gerät** — nach der Leistung im Auslegungspunkt, nicht nach der
   Nennleistung. Eine 8-kW-Wärmepumpe liefert bei −7 °C acht Kilowatt, bei
   −15 °C aber nur noch knapp sieben.
4. **Heizkreise** — sie bestimmen Volumenstrom und Wasserinhalt.
5. **Puffer** — er folgt aus dem Gerät und aus dem Wasser, das ohnehin in
   Estrich und Leitungen steht. Oft ist gar keiner nötig.
6. **Trinkwasser** — das Legionellenregime setzt die Speichertemperatur, und
   die entscheidet, ob das Gerät sie überhaupt erreicht.
7. **Rohrnetz und Pumpe.**
8. **Sicherheitsausrüstung** — sie braucht den fertigen Wasserinhalt,
   einschließlich des Puffers aus Schritt 5.

Wer Schritt 6 vor Schritt 3 zieht, legt den Wärmetauscher für 50 °C aus und
stellt danach fest, dass 60 °C gefordert sind — ein Viertel zu klein.

### Heizlast: Überschlag mit Ansage

Die Norm-Heizlast nach DIN EN 12831-1 rechnet RaVia; zwei Programme, die
dieselbe Zahl unterschiedlich ermitteln, sind schlimmer als eines. Für die
Anlagenauslegung braucht es aber *eine* Zahl, bevor die Heizlastberechnung
fertig ist. `heatLoadEstimate.ts` liefert sie aus denselben Flächen, U-Werten
und Temperaturen, die ohnehin exportiert werden — und kennzeichnet jedes
Ergebnis mit `istUeberschlag: true`. Wer die Norm-Heizlast hat, trägt sie im
Anlagenblatt ein; dann rechnet hier nichts mehr, und alle Folgegrößen fußen
gleichzeitig auf der belastbaren Zahl.

Die spezifische Heizlast wird eingeordnet — 51 W/m² heißt „saniert oder
Baujahr ab etwa 1995", 250 W/m² heißt „das ist ein Eingabefehler, kein
Gebäude".

### Der Gerätekatalog enthält keine Produkte

Es gibt keine öffentliche, vollständige, maschinenlesbare Datenbank aller
Wärmepumpen des deutschen Marktes. Was es gibt, sind Herstellerdatenblätter —
nicht in einer Form, die man ungefragt in ein Programm gießen darf, und
veraltet mit jeder Baureihenpflege.

Deshalb enthält `deviceCatalog.ts` **Typklassen statt Produkte**: „Monoblock
8 kW R290" ist kein bestellbares Gerät, sondern die Beschreibung dessen, was
ein Gerät dieser Bauart und Größe üblicherweise leistet. Sechs Baureihen —
Monoblock R290 und R32, Split R32 und R290, Innenaufstellung mit Luftkanälen,
Sole/Wasser, Wasser/Wasser — mit 40 Baugrößen. Jede Zahl ist aus einer
offengelegten Beziehung abgeleitet, nicht abgeschrieben:

| Größe | Herleitung |
|---|---|
| Leistungskurve | Faktoren je Betriebspunkt nach EN 14511, auf die Nennleistung angewandt |
| Schallleistung | L(P) = L(6 kW) + 10·lg(P/6) — größere Ventilatoren drehen langsamer |
| Abmessungen | Gehäusevolumen wächst mit der Leistung, Kanten mit der dritten Wurzel |
| Kältemittelmenge | linear in der Leistung, Achsenabschnitt je Bauart |
| Absicherung | nächster Normwert über dem 1,25-fachen Betriebsstrom |
| Mindestvolumenstrom | Nennvolumenstrom bei 8 K Spreizung |
| Mindestwasserinhalt | 12 l/kW bei Luft (Abtauung), 4 l/kW bei Sole |

Sobald ein Datenblatt vorliegt, wird die Typklasse durch die echten Werte
ersetzt (`provenance: 'hersteller'`), und die Auslegung wird belastbar. Das
Programm sagt an jeder Stelle dazu, womit es gerade rechnet.

### Geräteauswahl: Untergroß wird härter bestraft als übergroß

Bewertet wird die Deckung der geforderten Leistung bei der
Norm-Außentemperatur. Ideal sind rund 110 %. Die Bewertung ist bewusst
unsymmetrisch — zu wenig Leistung wiegt doppelt so schwer wie zu viel:

```
Fehler = Deckung < 1,10 ? (1,10 − Deckung) · 4 : (Deckung − 1,10) · 2
Bewertung = 1 / (1 + Fehler)
```

Ein zu großes Gerät taktet und kostet Arbeitszahl. Ein zu kleines lässt das
Haus kalt und heizt die Fehlmenge mit dem Heizstab — also mit Strom zum Preis
von Wärme geteilt durch eins. Ohne diese Gewichtung gewinnt bei knappen
Verhältnissen regelmäßig das kleinere Gerät um Haaresbreite.

### Fußbodenheizung raumweise

Ausgelegt wird nicht je Geschoss, sondern **je Raum**: ein Bad braucht 90 W/m²,
ein Schlafzimmer 45. Über das Geschoss gemittelt bekäme das Bad zu wenig und
das Schlafzimmer zu viel.

Das Anlagenblatt zeigt deshalb die Verteilertabelle, nach der eingeregelt wird —
je Raum Fläche, erforderliche Wärmestromdichte, Kreiszahl, Durchflussmenge in
l/h und Verlegeabstand. Räume, deren Wärmestromdichte über der Grenze aus der
Oberflächentemperatur liegt, stehen rot: dort hilft kein engerer Rohrabstand,
dort fehlt Fläche oder Dämmung.

Für die Pumpe zählt der **längste** Kreis, nicht der mittlere.

### Hydraulik

`hydraulics.ts` bringt sechs Werkstofftabellen mit (Kupfer nach EN 1057,
Stahl nach EN 10255, Edelstahl-Pressrohr nach EN 10312, PE-Xa,
Mehrschichtverbund, PP-R), Stoffwerte von Wasser und Wasser-Glykol-Gemischen
über der Temperatur, Druckverlust nach Darcy-Weisbach mit Colebrook-White,
eine ζ-Tabelle der gängigen Formstücke, die Rohrdimensionierung gegen
Geschwindigkeits- und Druckgefällegrenze, die Pumpenauslegung über den
ungünstigsten Strang und die Auslegung der Fußbodenheizung.

Die Dimensionierung sagt immer, **welches Kriterium gegriffen hat**:
`geschwindigkeit`, `druckgefälle`, `kleinste` oder `größte`. Das ist die
Information, mit der man die Vorgabe sinnvoll ändern kann.

Nicht frei verfügbare Normwerte — etwa das Kennlinienfeld der Fußbodenheizung
nach DIN EN 1264 — sind Parameter mit Vorbelegung und Herkunftsvermerk, keine
erfundenen Tabellen. Welcher Weg gegriffen hat, steht im Ergebnis
(`specificOutputSource`).

### Sicherheitsarmaturen nach DIN EN 12828

Vollständig nachrechenbar, mit jedem Zwischenwert im Ergebnis:

```
p₀  = statische Höhe / 10 + 0,2 bar        (mindestens 0,5 bar)
p_F = p₀ + 0,3 bar
p_e = p_SV − 0,5 bar                       (bei p_SV ≤ 5 bar)
V_e = V_A · n(ϑ)                           n aus der Dichte hergeleitet
V_WV = max(0,5 % · V_A ; 3 l)
V_n = (V_e + V_WV) · (p_e + 1) / (p_e − p₀)
```

Beispiel, das im Testlauf nachgerechnet wird: 300 l Anlageninhalt, 10 m
statische Höhe, 3,0 bar Ansprechdruck, 70 °C → p₀ = 1,2 bar, p_e = 2,5 bar,
V_e = 6,7 l, V_WV = 3 l, V_n = 26,2 l → **Baugröße 35 l**.

Dazu die vollständige Armaturenliste mit Nennweite und Normbezug —
Sicherheitsventil, Gefäß mit Kappenventil, Manometer, Thermometer, Füll- und
Entleerarmatur, Systemtrenner nach DIN EN 1717, Luft- und Schlammabscheider
(bei Wärmepumpen mit Magnetabscheider), Rückflussverhinderer, Absperrungen,
Überströmventil bei Bedarf, Wärmemengenzähler. Sie ist zugleich die Vorlage
für das Anlagenschema und für die Massenermittlung.

### Trinkwarmwasser

Bedarfskennzahl N nach DIN 4708 mit offengelegten Rechenschritten,
Speichervolumen über zwei unabhängige Wege (Tagesbedarf und Bedarfsspitze —
der größere gewinnt, und es steht dabei, welcher es war), Aufheizleistung,
Legionellenregime nach DVGW W 551 und Zirkulationspflicht nach DIN 1988-200.

Die beiden Regeln werden **getrennt** geführt, weil sie es sind: ein
Einfamilienhaus bleibt auch bei fünf Litern Leitungsinhalt eine Kleinanlage
nach W 551, braucht aber trotzdem eine Zirkulation nach DIN 1988-200.

### Das Anlagenschema

Ein Grundriss sagt, wo etwas steht. Ein Anlagenschema sagt, woran es hängt.
Beides in ein Bild zu zwingen ist ein Fehler: die Leitungsführung im
Technikraum ist für die Hydraulik belanglos, und die Reihenfolge der
Armaturen lässt sich im Grundriss nicht ablesen.

Deshalb eine eigene Ansicht (Kopfzeile → **Schema**) auf einem eigenen Raster,
gezeichnet mit Fließbildsymbolen nach DIN EN ISO 14617. Erzeugt wird sie mit
einem Klick aus der Auslegung; Leitungen laufen rechtwinklig und tragen ihre
Nennweite. Ein Klick auf ein Bauteil erklärt in einem Satz, wofür es da ist —
geschrieben für den Monteur, nicht für den Ingenieur.

Das Ergebnis ist ein **Prinzipschema, kein Ausführungsplan**. Wer von Hand
eingreift, setzt `manual`, und ab dann wird nichts mehr überschrieben.

### Das Schema von Hand nachbearbeiten

Drei Werkzeugmodi in der Schema-Ansicht:

| Modus | Was ein Klick tut |
|---|---|
| Auswählen | anklicken, ziehen zum Verschieben (Raster: halbe Felder), `Entf` löscht |
| Verbinden | erstes Bauteil, zweites Bauteil — die Leitungsart steht daneben |
| Einfügen | Bauteil wählen und in das Schema klicken |

Ergänzbar sind bewusst nur **Armaturen und Messstellen** — das, was auf der
Baustelle dazukommt. Erzeuger, Speicher und Verteiler kommen aus der Auslegung
und werden dort geändert, nicht im Bild.

Der Inspektor unten links erklärt jedes angeklickte Bauteil in einem Satz für
den Monteur, lässt Beschriftung und technische Angabe ändern und zeigt seine
Verbindungen — jede davon mit einem Klick entfernbar. `Strg+Z` gilt auch hier;
die Schema-Ansicht bringt ihr eigenes Rückgängig mit, weil der Grundriss-Editor
dort gar nicht eingehängt ist.

Sobald etwas von Hand geändert wurde, fragt „Schema neu erzeugen" nach, bevor
es die Arbeit verwirft.

### Schema drucken

Maßstäbliches SVG in Millimetern, A4/A3/A2 quer oder hoch, Maßstab automatisch
eingepasst und im Schriftfeld ausgewiesen. Wahlweise farbig oder **schwarzweiß
mit Stricharten** — durchgezogen, gestrichelt, strichpunktiert, gepunktet —,
damit das Blatt auch aus einem Laserdrucker lesbar bleibt. Die Legende wandert
auf ein eigenes Blatt, wenn sie sonst das Schema überdecken würde.

Dazu eine **Stückliste**: gleiche Bauteile zusammengezählt, mit Position,
Anzahl, Bezeichnung und technischer Angabe. Als eigenes Blatt am Ausdruck oder
als CSV für die Kalkulation.

Die Symbole werden dafür nicht zweimal gezeichnet: `schematicPrint.ts` bringt
einen kleinen Aufzeichner mit, der die Canvas-Schnittstelle nachbildet und die
Aufrufe in SVG-Pfade übersetzt. Symbolbibliothek und Ausdruck können deshalb
nicht auseinanderlaufen.

### Hydraulischer Abgleich

`hydraulicBalance.ts` ist die Brücke zwischen dem **gezeichneten** Rohrnetz und
dem Druckverlust-Rechenkern: es baut aus `pipeNetwork.ts` die Lastdaten, die
`hydraulics.ts` erwartet, und rechnet daraus den Abgleich.

Der ungünstigste Strang jeder Quelle bleibt offen — er ist das Maß. Alle
anderen bekommen den Drosseldruck Δp = Δp_ungünstig − Δp_eigen und daraus den
erforderlichen k_v-Wert:

```
k_v = V̇ / √(Δp in bar)          [m³/h bei 1 bar]
```

Nachrechenbar: 0,50 m³/h bei 0,25 bar ergibt k_v = 0,50/0,50 = **1,00**.

Ausgewiesen wird auch, was sich **nicht** einstellen lässt: unter etwa 3 kPa
ist die Voreinstellung an einem Thermostatventil nicht mehr sicher darstellbar
(Erfahrungswert, als solcher gekennzeichnet). Liegen die Stränge so weit
auseinander, dass Ventile allein nicht reichen, sagt der Bericht das — dann
braucht es Strangregulierventile oder andere Rohrdimensionen.

Dazu eine Nachdimensionierung: je Abschnitt ist-Nennweite, soll-Nennweite,
Geschwindigkeit, Druckgefälle und ein Urteil (passt / zu klein / unnötig groß).

Die schwächste Stelle ist offengelegt: die gezeichnete Nennweite ist eine Zahl,
kein Werkstoff. `dimensionForDn` sucht sie in der Werkstofftabelle und rundet
auf, wenn sie dort nicht vorkommt — jedes Mal mit Vermerk im Bericht.

---

## Herstellerdatenblätter einlesen

Der eingebaute Katalog enthält Typklassen, keine Produkte (siehe oben). Für
ein Angebot reicht das nicht — dort steht ein Gerät mit Namen. `deviceImport.ts`
liest deshalb Datenblätter als **CSV oder JSON** ein und ersetzt die Typklasse
durch die echten Werte. `npm run verify` prüft diesen Weg mit eigenen Blöcken.

Was die Datei nicht können muss: eine bestimmte Form haben. Erkannt werden

- **Trennzeichen** Semikolon, Komma, Tabulator und Pipe — durch Auszählen,
  welche Spaltenbreite über die Datei hinweg am gleichmäßigsten trägt;
- **Titelzeilen** über der Kopfzeile („Technische Daten 2026", der
  Herstellername aus dem Prospekt) — gesucht wird in den ersten fünf Zeilen
  die erste, die mindestens zwei Felder trifft;
- **Zahlenformat** je Spalte: deutsches Komma, englischer Punkt, und der
  heikle Fall `1.234` — Tausenderpunkt oder Dezimalpunkt? Entschieden wird
  zuerst nach der Spalte, dann nach der Datei, und bei JSON grundsätzlich
  zugunsten des Punktes, weil JSON-Zahlen sprachneutral sind;
- **Einheiten in der Zelle**: `12,5 kW`, `55 dB(A)`, `3 x 16 A` — die letzte
  Angabe meint 16 A auf drei Phasen und nicht 3 A;
- **Überschriften** über Wortstämme und Abkürzungen, mit Vorschlag bei
  Fehlschlag („gemeint sein könnte …") statt eines stummen Ignorierens.

Bewusst **nicht** gelesen werden Spalten mit Aufnahme- oder Kälteleistung —
sie sehen wie die Heizleistung aus und sind es nicht. Wer sie träfe, würde
eine 12-kW-Maschine als 3-kW-Gerät führen.

Jede Zeile endet mit einer Entscheidung: `accepted` oder nicht, dazu die Liste
der fehlenden Pflichtangaben und der unplausiblen Werte. Unplausibel heißt
nachrechenbar, nicht geraten — etwa: die angegebene Absicherung liegt unter
dem angegebenen maximalen Betriebsstrom; die Füllmenge liegt bei 0,9 kg/kW,
während marktüblich 0,10 bis 0,35 kg/kW sind; ein Betriebspunkt liegt über der
angegebenen Höchst-Vorlauftemperatur; der „Flüsterbetrieb" ist lauter als der
Normalbetrieb (dann sind vermutlich zwei Spalten vertauscht).

**Die Fundstelle heißt, wie sie heißt.** Bei CSV ist es die physische Zeile
(„Zeile 7", Kopfzeile mitgezählt, so wie der Editor zählt), bei JSON der
Eintrag in der Liste („Eintrag 3"). Beides wäre unter einer Nummer
verwechselbar; deshalb trägt jeder Datensatz die Bezeichnung im Klartext mit.

Übernommene Geräte landen als `extraModels` in der Anlagendefinition und tragen
`provenance: 'hersteller'` — an jeder Stelle im Programm bleibt sichtbar, ob
eine Zahl aus einer Typklasse stammt oder aus einem Datenblatt. `mergeIntoCatalog`
verdrängt eine Typklasse nur mit Vermerk, und eine Herstellerangabe wird nie
still von einer generischen überschrieben.

Wer wissen will, welche Spalten erwartet werden: `buildCsvTemplate` erzeugt
eine ausgefüllte Beispieldatei, die sich sofort wieder einlesen lässt.

### Was ein Datenblatt hergeben muss

Pflicht sind die Angaben, ohne die keine Auslegung möglich ist: Bauform,
Wärmequelle, Kältemittel und Füllmenge, Nennleistung mit ihrem Betriebspunkt,
höchste Vorlauftemperatur, Mindestvolumenstrom, Mindestwasserinhalt, Phasen
und Absicherung — bei Geräten mit Außeneinheit zusätzlich der
Schallleistungspegel außen.

Zwei Felder sind mit dieser Fassung dazugekommen, beide aus dem Betrieb heraus:

- **maximaler Betriebsstrom** (`electric.maxCurrent`) — der Wert, den das
  Anmeldeformular des Netzbetreibers verlangt. Er steht im Datenblatt und ist
  nicht die Absicherung; liegt die Absicherung darunter, ist das ein Fehler
  und keine Warnung. Ist er angegeben, ersetzt er die überschlägige Rechnung
  aus Leistung und COP — gemessen schlägt geschätzt.
- **Schallleistung außen darf fehlen.** Ein Sole/Wasser-Gerät im Keller hat
  keine Außeneinheit. Bisher stand dort eine 0, und eine 0 heißt „gemessen und
  lautlos". Jetzt steht dort nichts, und im Anlagenbuch steht „entfällt — keine
  Außeneinheit".

---

## Massenauszug

`materialSchedule.ts` zählt zusammen, was gezeichnet und ausgelegt wurde:
Wandflächen und -längen nach Aufbau, Türen und Fenster nach Größe, Estrich- und
Dämmflächen, Heizkreise mit Rohrlänge je Teilung, Rohrleitungen nach Nennweite
und Werkstoff, Heizflächen, Anlagenteile aus der Auslegung.

Zwei Regeln machen den Auszug brauchbar statt beeindruckend:

1. **Jede Position nennt ihre Herkunft** — gezeichnet, gerechnet oder
   angenommen. Wer eine Zahl anzweifelt, sieht sofort, wo sie herkommt.
2. **Nichts wird ergänzt, was nicht im Modell steht.** Es gibt keinen
   Verschnittzuschlag, keine Befestigungsmittel, keine Kleinteile. Ein
   Massenauszug, der Positionen erfindet, wäre ein Angebot — und das ist nicht
   die Aufgabe dieses Werkzeugs.

Ausgabe als CSV mit Semikolon und deutschem Dezimalkomma, direkt für die
Kalkulation. Ohne Anlagenplanung entsteht der Bauteil-Anteil trotzdem.

---

## Anlagenbuch

`plantBook.ts` fasst die Auslegung in neun Kapiteln zu einem druckbaren
Dokument zusammen: Anlass und Datenstand, Gebäude und Heizlast, Wärmeerzeuger,
Speicher, Trinkwarmwasser, Hydraulik und Sicherheit, Schema, Massenauszug,
Inbetriebnahme.

Das erste Kapitel heißt **„Was hier steht und was nicht"** und ist das
wichtigste. Es benennt in Sätzen, dass die Heizlast ein Überschlag ist und die
Rechnung nach DIN EN 12831 in RaVia stattfindet, dass der Gerätekatalog
Typklassen enthält, solange kein Datenblatt eingelesen wurde, und welche
Angaben aus kostenpflichtigen Normen als Parameter mit Vorgabewert geführt
werden statt als Tabelle im Programm.

Ein Anlagenbuch, das seine Grenzen verschweigt, wird auf der Baustelle für eine
Ausführungsplanung gehalten. Deshalb steht der Vorbehalt vorn und nicht im
Kleingedruckten.

Fehlende Werte erscheinen als Strich. Eine 0 behauptet eine Messung, ein Strich
sagt „nicht bekannt" — dieser Unterschied zieht sich durch das ganze Dokument.

---

## Gelände im 3D-Modell

Was im Grundriss als Grundstück erfasst wird — Grenze, Nachbargebäude, Bäume,
befestigte Flächen, Erdsonden, Kollektorfläche, Immissionsort, Aufstellort der
Wärmepumpe samt Schutzbereich — steht jetzt auch im 3D-Modell. Der Schallweg
zum Nachbarn wird damit ansehbar statt nur rechenbar.

Eine Lehre steckt darin: Erdsonden gehen 100 m nach unten. Beim ersten Versuch
war die Ansicht schwarz — die Kamera stand mitten im Erdreich, weil die
Einpassung die volle Höhe des Modells nahm. Die Geländebox wird deshalb
vertikal begrenzt (−2 m bis +25 m), bevor sie in die Einpassung eingeht: was
unter der Geländeoberkante liegt, darf die Ansicht nicht bestimmen.

---

## Export-Vergleich

Vor jeder erneuten Übergabe an RaVia steht die Frage: *was hat sich seit dem
letzten Mal geändert?* Der Vergleich lädt den zuletzt übergebenen Export als
Referenz und stellt ihn dem aktuellen Modellstand gegenüber — auf Raumebene,
weil dort die Heizlast gerechnet wird. Räume werden über ihre ID zugeordnet,
hilfsweise über Geschoss und Name.

Verglichen wird nur, was die Heizlast bewegt: Fläche, Volumen, Höhe,
Solltemperatur, Luftwechsel, Außenwand- und Fensterfläche, installierte
Leistung, Erdkontakt, Zahl der Hüllbauteile — und der **Hüll-Leitwert**
Σ A·(U + ΔU_WB) in W/K. Der letzte Wert ist nötig, weil ein gewechselter
Bauteilaufbau keine einzige Fläche verändert: ohne ihn bliebe der Sprung von
einer 0,24er auf eine 0,15er Außenwand unsichtbar. Er wird nur für den
Vergleich gebildet und *nicht* exportiert — die Rechnung bleibt in RaVia.

---

## Export (`ravia.bim.light` v2) — Übergabe an die Heizlastberechnung

Leitgedanke: **die Gegenstelle soll rechnen können, ohne nachzufragen.**

Kern des Formats ist je Raum eine *einzige* Liste aller Hüllbauteile —
Wand, Boden und Decke in derselben Struktur, weil die Transmission sie
identisch behandelt (A · U · f):

```jsonc
"surfaces": [
  { "kind": "wall",    "boundary": "exterior",      "neighbourTemperature": -12,
    "orientation": "S", "azimuth": 180, "tilt": 90,
    "grossArea": 16.5, "netArea": 14.41, "uValue": 0.21,
    "thermalBridgeSupplement": 0.1, "openings": [ /* Fenster, Türen, Durchgänge */ ] },
  { "kind": "wall",    "boundary": "adjacent-room", "neighbourTemperature": 20,
    "neighbourRoomId": "room-level-0-1", /* … */ },
  { "kind": "floor",   "boundary": "ground",        "neighbourTemperature": 10, "tilt": 0, /* … */ },
  { "kind": "ceiling", "boundary": "unheated",      "neighbourTemperature": 10, "tilt": 0, /* … */ }
]
```

`neighbourTemperature` ist der Punkt, an dem sich die meiste Arbeit erledigt:
der Temperatur-Korrekturfaktor wird damit zu einer Subtraktion statt zu einer
Nachschlagearbeit über Bauteillisten und Raumtabellen.

**Was pro Raum sonst noch mitkommt**

| Gruppe | Felder |
|---|---|
| Geometrie | lichte Fläche, Höhe, Luftvolumen, Umfang, Raumpolygon, Geschoss + Höhenlage |
| Temperatur | Solltemperatur, `isHeated` |
| Erdreich | `groundContactPerimeter`, `characteristicGroundDimension` (B′ = A/(0,5·P)) |
| Lüftung | n_min, `minimumAirflow`, `exposedFacadeCount`; auf Gebäudeebene n50 und Abschirmung |
| Öffnungen | Fläche, Brüstung, Orientierung, Azimut, U-Wert, g-Wert; Fensterfläche je Himmelsrichtung |
| TGA | alle Objekte mit Kennwerten, installierte Heizleistung, Zu-/Abluftvolumenstrom |
| Wärmebrücken | im längenbezogenen Verfahren je Anschlussart ψ, Länge, ψ·l und Herkunft, dazu je Raum Hüllfläche und gleichwertiger pauschaler Zuschlag; auf Gebäudeebene die Gegenprobe gegen den pauschalen Zuschlag |
| Lüftung | Rolle, Zuluft, Abluft, Überströmung, wirksame Zuluft nach η; auf Gebäudeebene Anlagenart, η, Betriebsweise und Luftbilanz |
| Rohrnetz | Längenauszug **und** Strangschema: je Verbraucher Quelle, Trassen- und Kreislänge, Engpass-Nennweite, Abschnittsfolge |
| Wärmepumpe | Grundstück, Auslegungsdaten, vollständiger Schallnachweis mit Rohgrößen, Schutzbereich, Quellenbedarf, Geländeobjekte |
| Baugrund | auf Gebäudeebene `subsoil`: Bodenart, Grundwasserstand, Einbindetiefe, erdberührte Fläche |

**Und drum herum**

- `units` und `conventions` stehen **im Dokument** — Einheiten und die
  Azimut-Konvention können nicht verloren gehen. Dort stehen auch die beiden
  Konventionen, nach denen bei der Integration gefragt wurde:
  - `conventions.ventilation` — `rooms[].airChangeRate` ist der hygienische
    Mindestluftwechsel n_min aus der Nutzung und **nicht** die Infiltration;
    `ventilation.minimumAirflow` ist derselbe Wert als Volumenstrom, keine
    zweite Größe. Mindeststrom und Anlagenstrom (die Summe der platzierten
    Ventile) beschreiben denselben Luftwechsel und werden nicht addiert —
    maßgebend ist der größere. Bei Wärmerückgewinnung gilt **entweder**
    `effectiveSupplyAirflow = supplyAirflow · (1 − η)` **oder** der rohe
    Zuluftstrom mit eigener Rückgewinnungsrechnung, nie beides. Und: die
    Abluft eines Bades ist Fortluft, keine Außenluft — sie kam über den
    Überströmweg aus den Zulufträumen und ist dort bereits erwärmt worden.
    Die Infiltration selbst rechnet der Export nicht; er liefert nur ihre
    Eingangsgrößen `project.n50`, `project.shielding`,
    `rooms[].exposedFacadeCount` und `rooms[].levelElevation`.
  - `conventions.subsoil` — was der Baugrundblock erfasst und was er bewusst
    nicht liefert.
- `subsoil` sind die Erfassungsgrößen des Baugrunds: Bodenart (eine Eingabe
  mit der Vorbelegung „normal", und der Text sagt das auch), Grundwasserstand
  als Tiefe unter Geländeoberkante (ohne Vorbelegung — fehlt, solange nichts
  erfasst ist), dazu Geländeoberkante, größte Einbindetiefe und erdberührte
  Hüllfläche als Vergleichsgrößen. Wärmeleitfähigkeiten λ stehen **nicht**
  darin: ihre Tabelle gehört zu DIN EN ISO 13370. Der Block fehlt ganz, wenn
  das Gebäude das Erdreich nirgends berührt und kein Grundwasserstand erfasst
  ist — ein Dokument ohne Baugrundangaben verhält sich wie vorher.
- `validation` ist der Prüfbericht: Fehler, Warnungen, Hinweise und ein
  `ready`-Flag. Die Gegenstelle sieht damit sofort, worauf sie sich verlassen
  kann und wo mit Annahmen statt Angaben gerechnet wird.
- `geometry` enthält die Rohgeometrie — der Export ist zugleich die
  Projektdatei und lässt sich über die Schaltfläche neben „RaVia JSON"
  verlustfrei zurücklesen.

Die Nordabweichung des Grundrisses ist im Inspektor einstellbar und ist in
jedem exportierten Azimut bereits eingerechnet.

---

## Einbettung in RaVia

Der Umweg über eine Exportdatei ist für den Menschen gedacht: herunterladen,
ablegen, hochladen. Wenn RaVia dieses Werkzeug einbettet, ist er überflüssig
und sogar schädlich — jede Datei ist ein Stand, der veralten kann, und
niemand sieht ihr an, ob sie noch zum Modell im Editor passt.

Deshalb gibt es einen **stabilen Vertrag** unter `window.RaViaCAD`:

```ts
interface RaviaCadApi {
  readonly version: string;                 // "1.1.0"
  getExport(): RaviaExport;                 // vollständiges ravia.bim.light v2
  getIfc(): string;                         // dasselbe Modell als IFC4/STEP
  getSummary(): RaviaSummary;               // Kurzfassung ohne die große Datenmenge
  validate(): ValidationReport;             // derselbe Bericht wie im Reiter „Prüfung"
  getDocument(): BimDocument;               // Rohdokument, nur lesend gedacht
  loadProject(data): { ok, message };       // Projektdatei laden
  loadIfc(text): { ok, message };           // IFC4-Datei laden
  applyPatch(patch): HostPatchReport;       // Fachdaten zurückschreiben (siehe unten)
  getWritableFields(): Field[];             // Selbstauskunft: was ist schreibbar
  onChange(fn): () => void;                 // Änderungen abonnieren, entprellt
}
```

Läuft der Editor in einem `<iframe>`, tut es dieselbe Schnittstelle über
`postMessage` — Befehl rein, Antwort zurück:

```js
cad.contentWindow.postMessage(
  { channel: 'ravia-cad', type: 'getExport', id: 1 }, '*');

window.addEventListener('message', (e) => {
  if (e.data?.channel !== 'ravia-cad') return;
  // e.data.type: 'export' | 'summary' | 'validation' | 'ifc' | 'changed' | 'error'
});
```

Befehle: `ping` · `getSummary` · `getExport` · `getIfc` · `validate` ·
`loadProject` · `loadIfc` · `applyPatch` · `getWritableFields` · `subscribe` ·
`unsubscribe`. Nach `subscribe`
kommt bei jeder Modelländerung ungefragt ein `changed` mit der Kurzfassung —
entprellt auf 250 ms, denn bei jedem gezogenen Wandende den vollen Export zu
schicken wäre Verschwendung. `public/einbettung-beispiel.html` zeigt beides
lauffähig und dient zugleich als Testfall.

Drei Entscheidungen, die den Vertrag tragen:

**Die Schnittstelle ist schmal und von den inneren Datenstrukturen
entkoppelt.** `window.__ravia` (der rohe Zustand-Store) bleibt daneben
bestehen, ist aber ausdrücklich *kein* Vertrag — wer darauf baut, bricht beim
nächsten Umbau. `RaViaCAD` bricht nicht.

**Antworten gehen an genau den Absender zurück, mit dessen eigenem Origin als
Ziel.** Ein `*` als Ziel würde den kompletten Modellinhalt an jedes Fenster
ausliefern, das zufällig zuhört.

**Gemeldet wird die Kurzfassung, nicht das Modell.** Wer nach einem `changed`
wirklich alles braucht, holt es sich mit `getExport` — so entscheidet die
Gegenstelle über die Datenmenge, nicht der Editor.

### Der Rückweg — RaVia schreibt zurück

Bis 1.4.0 war die Einbettung einseitig: RaVia konnte den Modellstand holen,
aber nichts zurückgeben. Die Norm-Heizlast, die dort gerechnet wird, musste von
Hand abgetippt werden, und die Anlagenauslegung rechnete weiter mit dem eigenen
Überschlag. Das ist keine Verbindung zweier Programme, das ist ein Export mit
besserer Anbindung.

`applyPatch` schließt den Kreis:

```js
const bericht = cad.RaViaCAD.applyPatch({
  source: 'RaVia 3.2',                       // Pflicht — die Spur bleibt am Modell
  project: { designOutdoorTemperature: -14 },
  rooms: [
    { id: 'room-eg-0', setpointTemperature: 22,
      heatLoad: { total: 1240, transmission: 890, ventilation: 350 } },
  ],
  constructions: [{ id: 'c-aw-wdvs', uValue: 0.19 }],
  totalHeatLoad: 8400,
});
// bericht.applied / .unchanged / .rejected / .entries[] / .summary
```

**Fünf Regeln machen das Schreiben beherrschbar** — sie sind der eigentliche
Inhalt von `lib/hostPatch.ts`:

1. **Geometrie ist tabu.** Wände, Knoten, Öffnungen, Polygone, Flächen und
   Höhen gehören dem, der zeichnet. Ein Versuch, sie zu setzen, wird nicht
   still übergangen, sondern mit dem *Grund* abgelehnt („Fläche und Volumen
   werden aus der Geometrie gerechnet. Wer sie setzt, erzeugt einen Widerspruch
   im Modell.") — sonst sucht der Entwickler auf der Gegenseite den Fehler bei
   sich.
2. **Nichts still.** Jeder Wert endet als *übernommen*, *unverändert* oder
   *abgelehnt*, mit altem Wert, neuem Wert und Begründung. Ein Schreibvorgang
   ohne Quittung ist eine Behauptung.
3. **Teilweise anwenden, vollständig berichten.** Ein Tippfehler in einer
   Raum-Kennung darf nicht vierzig gültige Werte mitreißen. Die Gegenprobe
   („alles oder nichts") wäre nur richtig, wenn die Werte voneinander abhingen
   — sie tun es nicht.
4. **Gleich bleibt gleich.** Ein Wert, der schon so im Modell steht, gilt als
   *unverändert* und erzeugt keinen Historieneintrag. Sonst füllt eine
   Gegenstelle, die im Sekundentakt schreibt, die Rückgängig-Kette mit Nichts.
5. **Die Spur bleibt am Modell.** `meta.lastHostPatch` hält fest, wer wann was
   geschrieben hat; die Statuszeile zeigt es dauerhaft an. Ohne diese Spur
   erklärt später niemand mehr, warum im Bad 24 °C stehen, die hier keiner
   eingetragen hat.

Dazu die Bedingung, unter der ein zweites Programm überhaupt schreiben darf:
**der ganze Vorgang ist ein Schritt in der Historie.** Strg+Z nimmt ihn zurück
— der Mensch am Bildschirm behält das letzte Wort.

`getWritableFields()` ist die Selbstauskunft: jedes schreibbare Feld mit
Einheit und zulässigem Bereich. Die Gegenstelle muss nicht ausprobieren, was
geht, und kann ihre eigene Maske daraus bauen.

### Was die zurückgeschriebene Heizlast bewirkt

Sie ist der Grund für den ganzen Rückweg. Liegt für einen Raum eine gerechnete
Norm-Heizlast vor, wird **dieser Raum damit ausgelegt** statt mit dem
Überschlag — die Fußbodenheizung bekommt die echte Last, nicht eine Schätzung.
Jedes Raumergebnis weist aus, welcher Weg gegriffen hat.

Für die **Gebäudeheizlast** gilt eine Rangfolge: eingetragene Zahl vor Summe
der raumweisen Normlasten vor Überschlag. Die mittlere Stufe zählt nur, wenn
*alle* beheizten Räume eine gerechnete Last tragen. Eine Summe aus gerechneten
und überschlagenen Räumen wäre keines von beidem und gegen keine Kennzahl zu
prüfen; das Anlagenblatt sagt stattdessen, wie viele Räume noch fehlen und
welche.

Und weil ein Schreibvorgang die Geometrie nicht ändert, aber jede gezeichnete
Änderung sie ändert, trägt jede übernommene Last den **Modellstand** mit, für
den sie gerechnet wurde. Weicht er ab, steht das im Anlagenblatt — als Hinweis,
nicht als Fehler, und die Zahl wird weiter verwendet: eine verschobene
Innenwand macht die Heizlast des Nachbarraums fraglich, nicht ungültig.

---

## Modellprüfung

Der Reiter **Prüfung** bewertet das Modell in drei Stufen und macht jeden Befund
anklickbar — ein Klick springt auf das betroffene Bauteil:

- **Fehler** — die Rechnung wäre nachweislich falsch: offene Wandenden,
  Öffnung breiter als ihre Wand, überlappende Öffnungen, Öffnung über Wandhöhe.
- **Warnung** — es wird gerechnet, aber mit einer Annahme statt einer Angabe:
  fehlender U-Wert, unplausible Werte, Innenwand ohne erkannten Nachbarraum,
  TGA-Objekt außerhalb jedes Raums.
- **Hinweis** — Unvollständigkeit ohne Rechenfolgen: Raum ohne Nutzung,
  Fenster ohne g-Wert.

Derselbe Bericht wandert in den Export.

---

## Performance

- Pointer-Bewegungen schreiben in Refs und planen einen rAF-Frame — kein React-Render im Interaktionspfad.
- Manuelle Welt→Screen-Transformation statt `ctx.setTransform`: Linienstärken, Textgrößen und Fangradien bleiben zoom-unabhängig in Pixeln.
- Wände in zwei globalen Canvas-Durchgängen (Kanten, dann Poché) — Ecken und T-Stöße verschmelzen ohne boolesche Geometrie.
- 3D: alle Wandquader pro Material zu einer Geometrie zusammengeführt; der Renderloop läuft nur, solange die 3D-Ansicht sichtbar ist.
- Code-Splitting: Three.js (126 kB gzip) und pdf.js (106 kB gzip) werden erst bei Bedarf geladen.
- Öffnungen, TGA-Objekte und Geschosstemperaturen werden je Export einmal indiziert statt je Wand, Raum und Bauteil neu durchsucht — siehe die Belastungsprobe unten.

---

## Belastungsprobe und Regressionstest

Ein Werkzeug, das mit drei Räumen gut aussieht, kann beim ersten echten
Projekt unbenutzbar sein. Zwei Prüfungen sorgen dafür, dass das nicht
unbemerkt passiert.

### `npm run bench` — was passiert bei einem echten Gebäude?

Erzeugt ein synthetisches Haus in drei Größen und misst genau die Wege, die
bei *jeder* Änderung laufen:

```
▸ Belastungsprobe (normal)
  4 Geschosse · 180 Wände · 180 Öffnungen · 72 Räume · 104 TGA · 76 Leitungen

  ✓ Raumerkennung (alle Geschosse)        11.0 ms   (Budget 60 ms)
  ✓ Modellprüfung                          5.9 ms   (Budget 40 ms)
  ✓ Wärmebrückenbilanz                     1.0 ms   (Budget 30 ms)
  ✓ Rohrnetz                               3.3 ms   (Budget 30 ms)
  ✓ RaVia-Export                          11.7 ms   (Budget 80 ms)
  ✓ IFC-Export                             8.8 ms   (Budget 80 ms)
```

`npm run bench -- large` (Wohnanlage) und `-- huge` (12 Geschosse, 1.716
Wände, 720 Räume) gehen bewusst über das Sinnvolle hinaus — dort zeigt sich,
was quadratisch wächst. Die Budgets liegen knapp über dem Gemessenen: sie
sollen anschlagen, wenn etwas wieder quadratisch wird, nicht erst, wenn das
Werkzeug hakt.

**Was die Messung gefunden hat.** Beim ersten Lauf mit Öffnungen — ein
Gebäude ohne Fenster ist keine ehrliche Probe — brauchte der Export 953 ms,
die Prüfung 259 ms, der IFC-Export 688 ms. Die Ursache war überall dieselbe:
`openingsOfWall()` durchsucht die ganze Öffnungsliste, und in einer Schleife
über alle Wandabschnitte aller Räume wird daraus ein Produkt — bei 1.700
Wänden und 1.700 Öffnungen knapp drei Millionen Vergleiche, je Export. Ein
Index nach Wand-ID, einmal gebaut, macht dieselbe Abfrage konstant teuer:

| | vorher | nachher |
|---|---|---|
| RaVia-Export | 953 ms | 86 ms |
| IFC-Export | 688 ms | 81 ms |
| Modellprüfung | 259 ms | 34 ms |
| Wärmebrückenbilanz | 214 ms | 2 ms |

Dazu drei weitere Stellen, die dasselbe Muster hatten: die mittlere
Solltemperatur je Geschoss wurde für jeden Raum neu über alle Räume gebildet,
die TGA-Objekte für jeden Raum neu gefiltert, und das Verschmelzen der
Rohrnetz-Stützpunkte verglich jeden Punkt mit jedem. Jetzt: eine Tabelle je
Geschoss, eine Gruppierung nach Raum, ein Rasterhash — und im Dijkstra ein
Binärheap statt einer linearen Suche nach dem Minimum.

### Referenzprojekt — Fernwirkungen sichtbar machen

Die Einzeltests prüfen jeder für sich eine Formel. Was sie nicht sehen: dass
eine Änderung an der Raumerkennung nebenbei die Fensterflächen verschiebt oder
ein neues Exportfeld eine Nachbartemperatur überschreibt. Solche Fernwirkungen
fallen sonst erst bei der Gegenstelle auf.

`scripts/reference.ts` baut deshalb ein festes Haus — zwei Geschosse,
Satteldach mit Gaube, Fenster und Türen, Treppe, TGA, Rohrnetz, längenbezogene
Wärmebrücken, Lüftungsanlage mit Wärmerückgewinnung, Absenkbetrieb — und
verdichtet dessen Export auf die Zahlen, auf die es ankommt. Der Sollstand
liegt als `scripts/fixtures/referenz-soll.json` im Projekt und wird bei jedem
`npm run verify` verglichen.

Weicht etwas ab, sagt der Test *welche* Zahl:

```
▸ Referenzprojekt
  Abweichungen gegenüber dem Sollstand:
      rooms[0].envelopeConductance: 66.141 → 66.212
      totals.setbackTimeConstant: 134.04 → 133.79
  Gewollt? Dann: npm run reference:update — und den Diff ansehen.
```

Je Raum stehen darin unter anderem Fläche, Volumen, Umfang, Zahl der
Hüllbauteile, Fensterfläche, B′, Wärmebrückenbilanz, Lüftungsrolle — und der
**Hüll-Leitwert** Σ A·(U+ΔU): die eine Zahl, in der sich jede Flächen- oder
U-Wert-Verschiebung zeigt, egal woher sie kommt. Dazu die Gebäudesummen, der
Prüfbericht mit seinen Befundcodes, die Kennzahlen des Rohrnetzes und die
Entity-Zahlen der IFC-Ausgabe.

Ein zweiter Lauf muss bitgleich sein — sonst prüft der Sollstand nichts. Auch
das wird geprüft.

Beim Anlegen des Referenzhauses fielen zwei falsche Befunde auf, die im
Beispielgrundriss nie aufgetreten waren: ein Heizkreisverteiler wurde als
„Objekt ohne Leistungsangabe" gemeldet, obwohl ein Verteiler keine Leistung
hat, und Lüftungsventile galten als „nicht angeschlossen", obwohl im Projekt
gar keine Lüftungskanäle gezeichnet waren. Beides gemeldet wird jetzt nur
noch dort, wo es etwas abzustellen gibt.

---

## Verifikation

`npm run verify` prüft Rechenkerne und Exporte ohne Browser (574 Prüfungen,
einschließlich des Referenzprojekts oben):
Polygon-Offset, Azimut/Orientierung, Wandzerlegung (Volumenbilanz Wand −
Öffnung), lichte Raummaße bei gemischten Wandstärken, Zuordnung der
Öffnungsflächen zur richtigen Fassade, Topologie-Heilung in allen bekannten
Fehlerfällen — und für den Export: Boden und Decke bei jedem Raum, korrekte
Nachbartemperaturen je Randbedingung, aufgelöste Nachbarräume an Trennwänden,
B′, Mindestluftstrom sowie das Anschlagen der Modellprüfung bei fehlerhaften
Eingaben. Dazu der Geschossstapel (adiabate Decke über beheiztem Raum), der
Vorrang des Bauteilaufbaus vor dem Einzel-U-Wert, die Passt-aufs-Blatt-Prüfung
des Planausdrucks und der Export-Vergleich in allen vier Fällen (neu,
entfallen, geändert, unverändert).

Die Dachgeometrie wird gegen von Hand nachrechenbare Werte geprüft: ein
Satteldach 45° mit 1,00 m Kniestock über 8 × 10 m ergibt 5,00 m Firsthöhe,
240 m³ Luftvolumen, 3,00 m mittlere Höhe, 113,14 m² Dachfläche und 70 m²
Wohnfläche nach WoFlV — alles ohne Toleranztricks nachvollziehbar.

Die Anlagentechnik wird gegen von Hand nachrechenbare Werte geprüft, nicht nur
auf Plausibilität. Beispiele aus dem Testlauf:

| Prüfung | Handrechnung | Ergebnis |
|---|---|---|
| Leistung bei −11 °C | Mitte zwischen A-15 (6,9 kW) und A-7 (8,0 kW) | 7,44 kW |
| Schall über die Baugröße | 10·lg(12/6) | +3,0 dB |
| Aufstellraum 1,5 kg R290 | 1,5 / 0,008 kg/m³ | 187,5 m³ |
| Wasserinhalt Cu 22 × 1 | π/4 · 0,20² dm² · 10 dm | 0,314 l/m |
| Geschwindigkeit in DN 20 | 1,72/3600 / (π/4 · 0,02²) | 1,521 m/s |
| Ausdehnungsgefäß | (6,7 + 3) · 3,5 / 1,3 | 26,2 l → 35 l |
| Mischungsregel | 100 l · (60−10)/(45−10) | 142,86 l |
| Achsfläche der L-Form | 10 · 8 − 5 · 4 | 60,00 m² |
| Puffer nach Taktung | 10 kW · 0,1 h / (1,163 · 5 K) · 1000 − 60 l | 112 l |
| k_v eines Drosselventils | 0,50 m³/h / √0,25 bar | 1,00 |

Dazu strukturelle Prüfungen des erzeugten Anlagenschemas: keine Verbindung
ohne Bauteil, kein Bauteil auf einem anderen, jedes Symbol im
Legendenverzeichnis erklärt, Hinweise ohne Dopplung und nach Schwere sortiert.

Der IFC-Export wird auf Struktur geprüft: Entity-Terminierung, eindeutige IDs,
keine baumelnden `#`-Referenzen, GUID-Kodierung und STEP-REAL-Schreibweise.
Der Import läuft im Rundlauf über den eigenen Export — Wanddicken, Höhen,
Öffnungsbreiten und Brüstungshöhen müssen unverändert zurückkommen — und der
Parser wird an einem Testfall mit verdoppelten Apostrophen, mehrzeiligen
Entities und Semikolons in Zeichenketten geprüft.

Die Gaubengeometrie wird gegen von Hand nachgerechnete Werte gehalten: eine
2,00 m breite Schleppgaube mit 2,20 m Front auf einem 45°-Dach mit 1,00 m
Kniestock ergibt genau 0,90 m² Frontfläche, dieselbe Gaube als Giebelgaube mit
0,70 m Giebeldreieck 1,60 m² — und beide auf der anderen Firsthälfte dieselben
Zahlen. Ebenso die Lauflängen der vier Treppenformen, jede von Hand
nachrechenbar.

Die Wärmebrücken werden an einem Rechteck geprüft, das sich im Kopf
nachrechnen lässt: 6 × 5 m über Wandachsen, 36,5 cm Wand, 2,60 m hoch, ein
Fenster 1,00 × 1,00 m. Vier Gebäudekanten ⇒ 10,40 m, Laibung 2,00 m, Sturz und
Brüstung je 1,00 m, Sockel 22,00 m — Σ ψ·l = 4,80 W/K. Dazu die Proben, dass im
längenbezogenen Verfahren *keine* Fläche mehr einen Zuschlag trägt, dass eine
Innenwand-Einbindung zwischen zwei Räumen einmal und nicht zweimal zählt, und
dass Traufe und Ortgang unter einem 45°-Dach an den richtigen Wänden landen.

Das Rohrnetz wird an kleinen, überschaubaren Netzen geprüft: ein Zug über
Eck ⇒ 7,00 m Trasse und 14,00 m Kreislänge, zwei Züge mit 3 cm Versatz am
Stoß ⇒ 9,97 m (die *gezeichnete* Länge, nicht die verschmolzene), zwei
Quellen ⇒ die nähere gewinnt, ein Steigstrang über zwei Geschosse ⇒ 4,00 +
2,75 + 2,90 m. Dazu: ein Verbraucher ohne Quelle wird gemeldet statt
übergangen, und der ungünstigste Strang steht oben.

Der Schallnachweis wird gegen von Hand nachrechenbare Werte gehalten:
55 dB(A) vor einer Wand in 5 m ⇒ 36,02 dB(A), gerundet die 36 aus der Tabelle
des BWP-Leitfadens; doppelter Abstand ⇒ 6 dB weniger; Mindestabstand für
55 dB(A) im Wohngebiet ⇒ 4,47 m frei und 6,31 m vor einer Wand, was die
Abstandstabelle des Merkblatts Brandenburg reproduziert. Dazu: der leise
Nachtbetrieb zählt nur mit Garantie, ein gesetzter Immissionsort schlägt die
Grenzennäherung, der Schutzbereich meldet Lichtschacht *und*
Grundstücksgrenze, und 8 kW bei COP 3,2 ergeben 110 Sondenmeter bzw. 275 m²
Kollektor.

Zusätzlich prüfen neun Playwright-Skripte die Anwendung im echten Browser:

```bash
npm run build && npx vite preview --port 4177   # in einem zweiten Terminal
npm run smoke:ui    # 2D, Split, 3D, Screenshots nach ./screenshots
npm run smoke:ai    # Upload → Auto-Trace → Übernehmen → Kalibrierung
npm run smoke:feat  # Durchgang, TGA-Platzierung, Ortho, Rechts-Drag, offene Enden
npm run smoke:export # Exportinhalt, Hüllflächen-Vollständigkeit, Roundtrip
npm run smoke:round2 # Geschosse, Raumbuch/CSV, Aufbauten, Planausdruck,
                     # Export-Vergleich, Sitzungssicherung über einen Neustart
npm run smoke:tga    # Dachformen, Gauben, Dachfenster, Treppe, Schacht,
                     # Rohrnetz, Längenauszug, RaVia-JSON, IFC-Export *und*
                     # -Import aus derselben Sitzung
npm run smoke:embed  # window.RaViaCAD direkt und die postMessage-Brücke aus
                     # einer Wirtsseite: subscribe/changed, Fehlerantwort auf
                     # unbekannte Befehle, fremde Nachrichten ignoriert
npm run smoke:ux     # Bedienbarkeit: einfacher Modus, Aufgabenliste,
                     # Erklärkarten, Handlungsanweisungen, gemerkte Ansicht
npm run smoke:wp     # Außenanlage: Grenze, Aufstellung, Schallnachweis,
                     # Schutzbereich, Erdwärme, Wasserschutzzone, Zeichnen
npm run smoke:raum   # Raumvorlagen aufziehen, Wände einzeln nachziehen,
                     # Räume kopieren, Geländeumriss schließen
npm run smoke:anlage # Anlagenblatt: Auslegung, Geräteauswahl, Schema
                     # bearbeiten und drucken, Datenblatt einlesen,
                     # Massenauszug, Anlagenbuch
npm run smoke:einzeldatei-scan
                     # Derselbe Raumscan in der Einzeldatei über file:// —
                     # der Weg, den ein Handwerker ohne Server geht
npm run smoke:scan   # Raumscan vom iPhone (Apple RoomPlan): echte Datei in den
                     # Öffnen-Dialog, Wand-/Öffnungs-/Raumzahl, Rechenschaft
                     # über Geschätztes und Offengebliebenes, eingepasste
                     # Ansicht, Raumnamen, Wände begradigen, Lücken als Tür
                     # schließen, Bearbeitbarkeit, 3D bei ungleichen Wandhöhen
```

### Die Prüfungen selbst werden geprüft

Zwei Dinge sind in dieser Fassung dazugekommen, beide aus derselben Einsicht:
ein Test, der nicht scheitern kann, ist kein Test.

**`npm run typecheck:pruefung`** übersetzt `src` *und* `scripts` mit denselben
strengen Schaltern. Bisher stand im `tsconfig.json` nur `include: ["src"]` —
der ganze Prüfordner war damit typfrei, weil `npm run verify` über esbuild
bündelt und esbuild keine Typen prüft. Sichtbar wurde das an einem
Referenzhaus, dem seit zwei Ausbaustufen die Pflichtfelder `site` und `plant`
fehlten, ohne dass ein Lauf es gemerkt hätte.

**Die Prüfblöcke liegen in eigenen Dateien** unter `scripts/pruefungen/` und
bekommen die Zählfunktion übergeben. Das erlaubt, einen Block zu schreiben und
ihn anschließend von jemand anderem *gegenlesen* zu lassen — mit dem Auftrag,
Prüfungen zu suchen, deren Sollwert aus dem Lauf abgeschrieben wurde statt aus
der Formel hergeleitet, und Prüfungen, die immer bestehen. Die Gegenprobe ist
mechanisch: den Fehler absichtlich einbauen und sehen, ob die Prüfung
anspringt. Sie hat unter anderem eine Prüfung entlarvt, die eine Phasenzahl
gegen die Ersatzannahme des Moduls verglich — beide waren „3", und die Prüfung
bestand auch dann noch, wenn man die Erkennung vollständig stilllegte.

Ein dreiwertiges Ergebnis (`'fehlt' | 'ja' | 'nein'`) statt eines
Wahrheitswerts zieht sich seitdem durch die Prüfblöcke: `?? false` verschmilzt
„das Kapitel fehlt" mit „das Kapitel sagt nichts", und dann besteht die
Prüfung auch, wenn das Kapitel ganz verschwindet.

---

## Eine Datei statt einer Installation

`npm run build:einzeldatei` erzeugt **eine einzige HTML-Datei**, die alles
enthält: Programm, Symbole, Beispielprojekt. Sie braucht kein Node.js, keine
Installation, kein Netz und keinen Server — Doppelklick genügt, sie läuft aus
`file://` heraus in jedem aktuellen Browser und lässt sich auf einem USB-Stick
weitergeben.

Drei Dinge stehen dem im Weg, und alle drei sind im Build gelöst:

1. **Module sind aus `file://` nicht ladbar** — der Browser verweigert sie mit
   einem CORS-Fehler. Deshalb `format: 'iife'` statt ESM und
   `inlineDynamicImports`, damit es überhaupt nur ein Bündel gibt.
2. **Ein eingebettetes Skript wartet nicht.** Im `<head>` läuft es, bevor
   `<div id="root">` existiert — React bricht mit Fehler 299 ab. Das Skript
   steht deshalb unmittelbar vor `</body>`.
3. **Minifizierter Code enthält `$&`, `` $` `` und `$'`.** Wird er über
   `String.replace` mit einer Zeichenkette eingesetzt, ersetzt die
   Ersetzungssyntax Teile des Programms durch sich selbst. Eingesetzt wird
   deshalb über eine Funktion, und `</script` wird zu `<\/script` maskiert.

Der Preis ist ehrlich zu nennen: die Datei ist einige Megabyte groß, und ein
Browser lädt sie ohne Zwischenspeicher jedes Mal neu. Für den Arbeitsplatz ist
der normale Build der bessere Weg; die Einzeldatei ist für Weitergabe und
Archiv.

---

## Nächste Schritte

- Kältemittelleitungen bei Split-Geräten im Grundriss führen und begrenzen
- Voreinstellwerte konkreter Ventilfabrikate statt des rechnerischen k_v
- Vor- und Rücklauf im Rohrnetz getrennt führen statt als gemeinsame Trasse
- Massenauszug um Verlegepläne ergänzen (heute nur Mengen, keine Verlegung)
- Anlagenbuch mit Herstellerunterlagen verknüpfen statt sie nur zu nennen
- Anlagenschema auch aus mehreren Erzeugern (bivalent, Solar) erzeugen
- IFC-Import räumlich zusammenführen: Wände aus mehreren Dateien überlagern
- Gewendelte Stufen im Podest statt eines rechtwinkligen Wechsels
- Gaubenanschlüsse (Wange, Front, Kehle) in der Wärmebrückenbilanz
- Vor- und Rücklauf als getrennte Stränge statt einer gemeinsamen Trasse
- Belastungsprobe auch für den Zeichenpfad im Browser, nicht nur für die Kernel
- Abstandsflächen der Landesbauordnung je Bundesland prüfen (heute nur erfasst)
- Schallabschirmung durch das eigene Gebäude ansetzen (heute konservativ ohne)
- Überströmwege im Plan zeigen (welcher Zuluftraum entlüftet über welchen Flur)
