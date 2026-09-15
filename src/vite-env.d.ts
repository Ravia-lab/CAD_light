/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Überschreibt den Vision-Provider: 'mock' | 'proxy' | 'sam2' | 'yolo'. */
  readonly VITE_VISION_PROVIDER?: string;
  /** Abweichender Endpunkt des serverseitigen Vision-Proxys. */
  readonly VITE_VISION_ENDPOINT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/**
 * Die Fassungsnummer der Anwendung, z. B. „1.23.0".
 *
 * Der Wert wird beim Bauen aus `package.json` eingesetzt (`define` in
 * `vite.config.ts` **und** in `vite.config.einzeldatei.ts`). Er ist deshalb
 * kein `import.meta.env`-Eintrag: `import.meta.env` kommt aus Umgebungs-
 * variablen, die beim Kunden gar nicht gesetzt sind — die Nummer steht
 * dagegen fest, sobald das Bündel geschrieben ist.
 */
declare const __RAVIA_FASSUNG__: string;
