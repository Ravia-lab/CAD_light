# Verzeichnisbaum CAD Light

Stand: 11.10.2026 · Quelle: CAD_light@5200d65 (Version 1.78.0) · automatisch aus den Quelltexten erzeugt (Regex über `export`/`import`), danach geprüft

| Verzeichnis | Code-Dateien | Zeilen | Zweck |
|---|---:|---:|---|
| `scripts/` | 58 | 20.567 | Prüf-, Rauch- und Freigabeskripte (Node) |
| `scripts/pruefungen/` | 119 | 47.864 | Prüfläufe des Rechenkerns (`npm run verify`) |
| `scripts/vertrag/` | 2 | 282 | Prüfungen gegen den gemeinsamen Vertrag `ravia-vertrag/` |
| `scripts/werkstatt/` | 4 | 87 | Werkbank-Hilfen |
| `server/app/` | 1 | 184 | statische App-Dateien (Einbettungsbeispiel, Handbuch) |
| `server/einbettung/` | 1 | 154 | Einbettungsbeispiel/Doku für Wirte |
| `src/` | 3 | 1.012 | Einstieg (`main.tsx`, `App.tsx`), Einzeldatei-Start |
| `src/components/` | 42 | 31.375 | React-Oberfläche: 2D-Editor, 3D-Ansicht, Panels, Dialoge |
| `src/lib/` | 149 | 90.470 | Rechen- und Fachkern: Geometrie, Dokumentpflege und Raumerkennung, Heizlast-Überschlag, Hydraulik, Rohrnetz, Exporte (Raum-Flächen in `raumExport.ts`), Importe, Embed-API |
| `src/lib/sprachen/` | 1 | 60 | Sprachdateien |
| `src/services/` | 1 | 53 | Dienste (u. a. `aiVisionService.ts`) |
| `src/store/` | 4 | 1.801 | Zustand-Store: `useBimStore.ts` setzt den Store aus den Slices zusammen, `bimZustand.ts` (Zustandstyp, Vorgaben, Helfer), kleine Dialogzustände |
| `src/store/slices/` | 12 | 5.735 | Aktionen des Stores, thematisch getrennt (Bauteile, Geschosse, Anlage, Laden/Importe, UI u. a.) |
| `src/types/` | 1 | 6.006 | Datenmodell `bim.ts` (BimDocument) |

Weitere Verzeichnisse: `handbuch/` (Bedienungsanleitung als HTML), `public/` (statische Dateien, Beispiele), `ravia-vertrag/schema/` (JSON-Schemas `ravia.building-1.12.0`, `ravia.building-1.13.0`, `ravia.bim.light-2.16.0` – der gemeinsame Vertrag mit Scan und RaVia), `.github/workflows/` (CI: `npm run verify` und Build je Push).

Weiter: [Modulindex](module-index.md) · [Typindex](type-index.md)
