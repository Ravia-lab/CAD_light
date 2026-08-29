/**
 * Build-Variante „eine einzige Datei".
 * ---------------------------------------------------------------------------
 * Erzeugt eine HTML-Datei, die alles enthält — Skript, Stil, Schriftverweise —
 * und sich per Doppelklick aus dem Dateisystem öffnen lässt. Kein Server, kein
 * Node.js, keine Installation.
 *
 * Zwei Abweichungen vom normalen Build sind dafür nötig:
 *
 *  • **`format: 'iife'` statt ES-Modul.** Ein `<script type="module">` fällt
 *    aus einer `file://`-Adresse unter die CORS-Regeln und wird vom Browser
 *    blockiert. Ein klassisches Skript nicht.
 *  • **Keine Code-Aufteilung.** Ein zweiter Chunk wäre eine zweite Datei, und
 *    genau die soll es nicht geben. Der 3D-Viewer wird damit mitgeladen statt
 *    erst bei Bedarf — die Datei wird größer, dafür ist sie vollständig.
 *
 * Nachgeprüft, nicht vermutet: PNG, JPG *und* PDF lassen sich einlesen. Zwar
 * kann `pdfjs` seinen Arbeitsprozess hier nicht als eigene Datei nachladen —
 * es weicht dann aber selbsttätig auf den Hauptthread aus. Der Unterschied ist
 * eine Zehntelsekunde beim Rastern, kein Funktionsverlust.
 *
 * Ebenfalls geprüft: die Sitzungssicherung im lokalen Speicher funktioniert
 * auch aus einer `file://`-Adresse, und der 3D-Viewer läuft.
 */

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const OUT = 'dist-einzeldatei';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'alles-in-eine-datei',
      // Nach dem Schreiben: Skript und Stil in die HTML-Datei holen, die
      // Einzelteile löschen.
      closeBundle() {
        const dir = join(process.cwd(), OUT);
        const assets = join(dir, 'assets');
        const files = readdirSync(assets);
        const js = files.filter((f) => f.endsWith('.js'));
        const css = files.filter((f) => f.endsWith('.css'));
        let html = readFileSync(join(dir, 'index.html'), 'utf-8');

        for (const f of css) {
          const code = readFileSync(join(assets, f), 'utf-8');
          html = html.replace(
            new RegExp(`<link[^>]*href="[^"]*${f}"[^>]*>`),
            () => `<style>\n${code}\n</style>`,
          );
        }
        for (const f of js) {
          let code = readFileSync(join(assets, f), 'utf-8');
          // Steht die Zeichenfolge `</script` irgendwo im Code — und sei es in
          // einer Zeichenkette, die selbst HTML erzeugt —, beendet der Parser
          // das Skript genau dort. Der Rest landet als Text im Dokument. In
          // einer JS-Zeichenkette ist `<\/script` dasselbe wie `</script`,
          // deshalb ist das Ersetzen unschädlich und die einzige zuverlässige
          // Lösung.
          code = code.replace(/<\/script/gi, '<\\/script');
          // Der Verweis stand im `<head>`. Ein eingebettetes Skript wird dort
          // aber *sofort* ausgeführt — anders als ein Modul, das wartet. Es
          // liefe damit, bevor `<div id="root">` existiert. Also: Verweis
          // entfernen und das Skript ans Ende des Rumpfes hängen.
          html = html.replace(
            new RegExp(`<script[^>]*src=\"[^\"]*${f}\"[^>]*>\\s*</script>`, 'g'),
            '',
          );
          // Ersetzt wird über eine Funktion, nicht über eine Zeichenkette:
          // in einem Ersetzungstext hat `$` Sonderbedeutung (`$&`, `$\``, `$'`),
          // und minifizierter Code ist voll davon. Mit einer Funktion wird der
          // Text unverändert eingesetzt.
          html = html.replace('</body>', () => `<script>\n${code}\n</script>\n</body>`);
        }

        // Die Schriftverweise ins Netz haben in dieser Fassung nichts zu
        // suchen. Im normalen Build sind sie unschädlich (nicht blockierend
        // geladen, ohne Netz greift der Systemstapel) — hier ist die Datei
        // aber ausdrücklich die Fassung für USB-Stick, Baustelle und Archiv.
        // Ein Verweis, der ins Leere geht, kostet dort Ladezeit, erzeugt einen
        // Fehler in der Konsole und verrät dem Netz, dass die Datei geöffnet
        // wurde. Entfernt wird deshalb der ganze Block aus preconnect und
        // Stylesheet; die Schriftwahl im CSS führt den Systemstapel bereits
        // als Rückfall.
        html = html
          .replace(/<link rel="preconnect" href="https:\/\/fonts\.[^"]*"[^>]*>\s*/g, '')
          .replace(/<link\s[^>]*fonts\.googleapis\.com[^>]*>\s*/g, '');
        if (html.includes('fonts.googleapis.com')) {
          throw new Error('Einzeldatei enthält noch einen Schriftverweis ins Netz.');
        }

        writeFileSync(join(dir, 'RaVia-CAD-Light.html'), html, 'utf-8');
        rmSync(assets, { recursive: true, force: true });
        rmSync(join(dir, 'index.html'), { force: true });
      },
    },
  ],
  // Ohne relative Basis stehen absolute Pfade wie `/assets/app.js` im HTML —
  // aus einer `file://`-Adresse zeigen die auf die Wurzel der Festplatte.
  base: './',
  build: {
    target: 'es2020',
    outDir: OUT,
    emptyOutDir: true,
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    modulePreload: { polyfill: false },
    rollupOptions: {
      output: {
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'assets/app.js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});
