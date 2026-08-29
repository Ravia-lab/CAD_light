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
