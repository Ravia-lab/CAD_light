import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

/**
 * Die Fassungsnummer — aus `package.json` und nirgendwo sonst.
 *
 * **Warum sie nicht als Zeichenkette im Quelltext steht.** Die Nummer wird
 * beim Ausliefern in `package.json` hochgezählt. Stünde sie zusätzlich als
 * `'1.23.0'` in einer Komponente, gäbe es zwei Wahrheiten — und spätestens
 * bei der übernächsten Auslieferung vergisst jemand die zweite. Der Anwender
 * läse dann in der Kopfzeile eine Nummer, die es so nicht gibt, und meldete
 * Fehler zu einer Fassung, die er gar nicht benutzt. Genau dafür ist die
 * Anzeige aber da: damit eine Meldung einer Fassung zugeordnet werden kann.
 *
 * Gelesen wird die Datei, statt sie zu importieren: ein `import … from
 * './package.json'` zöge die **ganze** Datei — Abhängigkeiten, Skripte,
 * Beschreibung — in das Bündel. Hier landet nur die eine Zeichenkette darin.
 */
const paket = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf-8'),
) as { version: string };

/**
 * Unter welchem Pfad die Anwendung ausgeliefert wird.
 *
 * **Warum das gebaut werden muss und nicht eingestellt werden kann.** Vite
 * schreibt die Verweise auf Skript, Stilblatt und Schriften **absolut** in
 * die `index.html` — bei `base: '/'` steht dort `/assets/index-….js`. Läuft
 * die Anwendung dann unter `/Cad_light/`, sucht der Browser die Datei unter
 * `https://…/assets/…` statt unter `https://…/Cad_light/assets/…` und findet
 * nichts. Das Ergebnis ist eine **weiße Seite ohne Fehlermeldung** — der
 * Server antwortet ja, nur mit der falschen Datei.
 *
 * Deshalb gehört der Pfad in den Build und nicht in die Serverkonfiguration.
 * Kein `try_files`, kein `rewrite` und kein Reverse-Proxy repariert das
 * hinterher, weil die falschen Adressen bereits im ausgelieferten HTML
 * stehen.
 *
 *     npm run build                          → Wurzel einer eigenen Domain
 *     RAVIA_BASE=/Cad_light/ npm run build   → Unterpfad einer bestehenden
 *
 * Der abschließende Schrägstrich ist Pflicht; Vite hängt die Dateinamen
 * unmittelbar an. Ohne ihn entstünde `/Cad_lightassets/…`.
 */
const BASIS = process.env.RAVIA_BASE ?? '/';
if (!BASIS.endsWith('/')) {
  throw new Error(`RAVIA_BASE muss auf „/" enden — bekommen: „${BASIS}"`);
}

export default defineConfig({
  base: BASIS,
  plugins: [react()],
  // `__RAVIA_FASSUNG__` wird beim Bauen durch die Nummer ersetzt. Dieselbe
  // Zeile steht in `vite.config.einzeldatei.ts` — eine Festlegung, die nur
  // in einer der beiden Konfigurationen stünde, ließe die Anzeige in der
  // anderen Fassung leer oder brächte das Bündel zum Absturz.
  define: { __RAVIA_FASSUNG__: JSON.stringify(paket.version) },
  build: {
    target: 'es2020',
    rollupOptions: {
      output: {
        // Three.js in einen eigenen Chunk: der 3D-View wird lazy geladen,
        // der 2D-Editor startet dadurch ohne WebGL-Payload.
        manualChunks: {
          three: ['three'],
        },
      },
    },
  },
});
