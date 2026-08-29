import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { useBimStore } from './store/useBimStore';
import { installEmbedApi } from './lib/embedApi';
import type { RaviaCadApi } from './lib/embedApi';

/**
 * Zwei Haken am Fenster, mit sehr unterschiedlichem Anspruch:
 *
 * `RaViaCAD` ist die **Einbettungs-Schnittstelle** — schmal, dokumentiert und
 * von den inneren Datenstrukturen entkoppelt. Darauf darf RaVia bauen.
 *
 * `__ravia` ist der rohe Zustand-Store. Er ist für Rauchtests und für schnelle
 * Eingriffe in der Konsole da und ausdrücklich *kein* Vertrag: wer darauf
 * baut, bricht beim nächsten Umbau.
 */
declare global {
  interface Window {
    __ravia: typeof useBimStore;
    RaViaCAD?: RaviaCadApi;
  }
}

window.__ravia = useBimStore;
installEmbedApi(useBimStore);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
