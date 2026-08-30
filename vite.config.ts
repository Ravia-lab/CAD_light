import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

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
