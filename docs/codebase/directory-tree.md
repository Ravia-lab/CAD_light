# Verzeichnisbaum CAD Light

Stand: 09.10.2026 · Quelle: CAD_light@55f5460 (Version 1.77.0) · automatisch aus den Quelltexten erzeugt (Regex über `export`/`import`), danach geprüft

| Verzeichnis | Code-Dateien | Zeilen | Zweck |
|---|---:|---:|---|
| `scripts/` | 58 | 20.518 | Prüf-, Rauch- und Freigabeskripte (Node) |
| `scripts/pruefungen/` | 118 | 47.743 | Prüfläufe des Rechenkerns (`npm run verify`) |
| `scripts/vertrag/` | 2 | 282 | Prüfungen gegen den gemeinsamen Vertrag `ravia-vertrag/` |
| `scripts/werkstatt/` | 4 | 87 | Werkbank-Hilfen |
| `server/app/` | 1 | 184 | statische App-Dateien (Einbettungsbeispiel, Handbuch) |
| `server/einbettung/` | 1 | 154 | Einbettungsbeispiel/Doku für Wirte |
| `src/` | 3 | 1.004 | Einstieg (`main.tsx`, `App.tsx`), Einzeldatei-Start |
| `src/components/` | 42 | 31.372 | React-Oberfläche: 2D-Editor, 3D-Ansicht, Panels, Dialoge |
| `src/lib/` | 145 | 89.442 | Rechen- und Fachkern: Geometrie, Raumerkennung, Heizlast-Überschlag, Hydraulik, Rohrnetz, Exporte, Importe, Embed-API |
| `src/lib/sprachen/` | 1 | 60 | Sprachdateien |
| `src/services/` | 1 | 53 | Dienste (u. a. `aiVisionService.ts`) |
| `src/store/` | 3 | 7.592 | Zustand-Store (Dokument, Historie, UI) |
| `src/types/` | 1 | 6.005 | Datenmodell `bim.ts` (BimDocument) |

Weitere Verzeichnisse: `handbuch/` (Bedienungsanleitung als HTML), `public/` (statische Dateien, Beispiele), `ravia-vertrag/schema/` (JSON-Schemas `ravia.building-1.12.0`, `ravia.bim.light-2.16.0` – der gemeinsame Vertrag mit Scan und RaVia).

Weiter: [Modulindex](module-index.md) · [Typindex](type-index.md)
