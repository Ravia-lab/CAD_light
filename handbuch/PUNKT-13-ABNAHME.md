# Punkt 13 — Boden, Decke und Dach in der Übernahme prüfen

**Worum es geht.** Die Übernahme der CAD-Light-Daten berücksichtigt Boden,
Decke und Dach nicht; die Heizlast fällt dadurch still zu niedrig aus. „Still“
ist das Gefährliche daran: Das Ergebnis sieht plausibel aus, es fehlt kein
Feld, es kommt keine Meldung. Wer es merken will, muss nachzählen.

CAD Light kann den Fehler nicht auf der Gegenseite beheben. Was es kann, ist
**ihn messbar machen** — und das ist seit Export **2.3.0** eingebaut.

---

## 1 · Was CAD Light liefert

Je Raum steht in `rooms[].surfaces[]` jede Hüllfläche einzeln, mit
`kind` (`wall` · `window`/`door` in `openings[]` · `floor` · `ceiling` ·
`roof` · `gable`), Fläche, U-Wert, Wärmebrückenzuschlag und Randbedingung.
Das war schon immer so.

**Neu ist die Bilanz daneben** — `rooms[].envelope` und, über alle Räume,
`envelope` auf der obersten Ebene:

```json
"envelope": {
  "byKind": {
    "wall":    { "netArea": 387.02, "heatTransferCoefficient": 230.376 },
    "window":  { "netArea": 12.54,  "heatTransferCoefficient": 13.794 },
    "door":    { "netArea": 10.68,  "heatTransferCoefficient": 19.224 },
    "floor":   { "netArea": 218.07, "heatTransferCoefficient": 112.670 },
    "ceiling": { "netArea": 142.38, "heatTransferCoefficient": 79.359 },
    "gable":   { "netArea": 87.76,  "heatTransferCoefficient": 19.307 },
    "roof":    { "netArea": 98.08,  "heatTransferCoefficient": 17.718 }
  },
  "byBoundary": { "exterior": …, "ground": …, "unheated": …, "adjacent-room": … },
  "total": { "netArea": 956.53, "heatTransferCoefficient": 492.448 },
  "shareHorizontal": 0.465,
  "note": "Σ A·(U+ΔU_WB) ohne Temperaturkorrekturfaktoren, ohne Lüftung, ohne Aufheizleistung — Eingangsgröße zur Prüfung der Übernahme, keine Heizlast."
}
```

Die Zahl ist schlicht

    H = Σ A_netto · (U + ΔU_WB)   [W/K]

und **ausdrücklich keine Heizlast**: keine Temperaturkorrekturfaktoren f_x für
Erdreich, unbeheizte Bereiche und Nachbarräume, keine Lüftung, keine
Aufheizleistung. Das alles gehört in die Rechnung von RaVia und wird hier
bewusst nicht vorweggenommen — es bliebe sonst genau die zweite Wahrheit
übrig, die beide Programme voneinander unterscheiden soll.

`shareHorizontal` ist der Anteil von Boden, Decke, Dach und Giebel am
Gesamtwert. **Am Referenzhaus sind das 46,5 %.**

---

## 2 · Die Abnahme in vier Schritten

Gegen die Beilage `referenzhaus-export.json` aus dem Übergabepaket — sie ist
aus genau diesem Stand erzeugt und ohne Kundendaten.

1. **Datei importieren** wie ein echtes Projekt.
2. **Je Bauteilart summieren**, was in der eigenen Rechnung angekommen ist:
   Σ A·(U+ΔU_WB) für Wand, Fenster, Tür, Boden, Decke, Dach, Giebel — vor
   Anwendung der Temperaturfaktoren.
3. **Gegen `envelope.byKind` halten.** Die Werte müssen im Rahmen der Rundung
   (drei Nachkommastellen) übereinstimmen.
4. **Sollwerte** (Referenzhaus, Export 2.3.0):

   | Bauteilart | Fläche [m²] | Σ A·(U+ΔU_WB) [W/K] |
   |---|---:|---:|
   | Wand | 387,02 | 230,376 |
   | Fenster | 12,54 | 13,794 |
   | Tür | 10,68 | 19,224 |
   | Boden | 218,07 | 112,670 |
   | Decke | 142,38 | 79,359 |
   | Giebel | 87,76 | 19,307 |
   | Dach | 98,08 | 17,718 |
   | **Summe** | **956,53** | **492,448** |

   Fehlen Boden, Decke, Dach und Giebel, bleiben **263,394 W/K** statt
   492,448 — also **46,5 % zu wenig**. Kommt eine andere Zahl heraus, sagt
   die Tabelle, an welcher Bauteilart es liegt.

**Wo die Prüfung hingehört:** nicht in ein einmaliges Protokoll, sondern in
den automatischen Prüflauf von RaVia — als fester Testfall mit dieser Datei
und diesen Zahlen. Dann fällt ein Rückfall beim nächsten Umbau auf, und nicht
erst beim nächsten Fördermittelantrag.

---

## 3 · Was noch zu beachten ist

* **Randbedingungen anwenden, nicht ignorieren.** `boundary` je Fläche sagt,
  wogegen sie grenzt: `exterior`, `ground`, `unheated`, `adjacent-room`. Boden
  auf Erdreich und Flächen gegen unbeheizte Bereiche gehören mit den Faktoren
  der Norm gerechnet (b_u, f_g), nicht mit A·U·Δθ. CAD Light liefert dafür
  zusätzlich `groundContactArea`, `groundContactPerimeter` und
  `characteristicGroundDimension` (B′) je Raum sowie `subsoil` für das
  Gebäude.
* **Nachbarräume nicht doppelt zählen.** Flächen mit `adjacent-room` tragen
  `neighbourRoomId` und `neighbourTemperature`. Zwischen zwei Räumen
  derselben Nutzungseinheit rechnet die Norm in der Regel keine Transmission;
  in der Bilanz stehen sie trotzdem, weil sie im Modell stehen. Für den
  Vergleich nach Schritt 3 also beide Seiten gleich behandeln.
* **Der Wärmebrückenzuschlag steckt schon drin.** In `envelope` ist
  `ΔU_WB` je Fläche eingerechnet. Wer im eigenen Programm den pauschalen
  Zuschlag auf die Hüllfläche aufschlägt, muss ihn beim Vergleich entweder
  hier abziehen oder dort ebenfalls anwenden — die Flächen tragen ihn einzeln
  als `thermalBridgeSupplement`.
* **Die Prüfsumme je Raum** (`rooms[].checksum`) sagt, ob eine einmal
  gerechnete Heizlast noch zum Modell passt. Sie deckt Geometrie, U-Werte,
  Randbedingungen und Öffnungen ab — also genau das, was in diese Bilanz
  eingeht.

---

## 4 · Warum das so und nicht anders gelöst ist

CAD Light rechnet **keine** Norm-Heizlast, und diese Bilanz ändert daran
nichts. Sie ist eine Summe über Eingangsgrößen, kein Ergebnis: dieselben
Flächen, dieselben U-Werte, einmal zusammengezählt. Damit kann die Gegenseite
prüfen, ohne dass zwei Programme dieselbe Zahl auf zwei Wegen behaupten.

Geprüft wird die Bilanz selbst im Prüfblock `huellflaeche` — mit einer
Handrechnung über fünf Flächen, der Gegenprobe „ohne die waagerechten
Bauteile“ und der Gegenrechnung am Referenzhaus, bei der die Summe ein
zweites Mal unabhängig gebildet wird.
