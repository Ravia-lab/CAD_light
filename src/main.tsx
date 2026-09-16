import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
/*
 * Die Schriften werden **mitgeliefert**, nicht nachgeladen.
 *
 * Bis 1.14.0 holte die Seite Inter und JetBrains Mono von Google Fonts. Das
 * hatte drei Nachteile, von denen jeder für sich schwer genug wiegt:
 *
 *  1. **Datenschutz.** Beim Nachladen einer Schrift von einem fremden Server
 *     wird die IP-Adresse des Anwenders dorthin übertragen. Das LG München I
 *     hat am 20.01.2022 (Az. 3 O 17493/20) entschieden, dass das ohne
 *     Einwilligung ein Verstoß gegen die DSGVO ist. Für ein Werkzeug, das
 *     auf einem deutschen Firmenserver läuft, ist das kein Randthema.
 *  2. **Verfügbarkeit.** Ohne Netz — Baustelle, Keller, abgeschottetes
 *     Firmennetz — fiel die Anwendung auf den Systemschriftstapel zurück.
 *     Sie lief, sah aber anders aus als geplant, und Tabellen mit
 *     Zahlenkolonnen liefen ohne die dicktengleiche Schrift auseinander.
 *  3. **Inhaltsrichtlinie.** Der Aufruf zwang die Sicherheitsrichtlinie des
 *     Servers, zwei fremde Herkünfte zuzulassen. Jede zugelassene Herkunft
 *     ist eine, die man nicht mehr ausschließt.
 *
 * Die Schriftdateien liegen jetzt im Paket und werden vom eigenen Server
 * ausgeliefert. Eingebunden sind nur die tatsächlich benutzten Schnitte —
 * Inter 300/400/500/600 und JetBrains Mono 400/500 — und davon nur der
 * **lateinische Zeichenvorrat**. Kyrillisch, Griechisch und Vietnamesisch
 * blähen das Paket um mehr als ein Megabyte auf, ohne dass ein deutsches
 * Anlagenblatt je ein Zeichen daraus enthielte; `latin-ext` bleibt für die
 * polnischen und tschechischen Namen, die auf einer Baustelle sehr wohl
 * vorkommen.
 */
import '@fontsource/inter/latin-300.css';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-ext-400.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-500.css';
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
    /**
     * Wo der Betrachter im Begehmodus steht — dieselbe Sorte Haken wie
     * `__ravia` und aus demselben Grund: Der Standort ändert sich sechzigmal
     * in der Sekunde und hat deshalb im Zustand-Store nichts zu suchen, muss
     * aber prüfbar sein. Ohne ihn ließe sich „hält die Wand?" im echten
     * Browser nur am Bild beurteilen, und ein Bild beweist nichts.
     */
    __raviaGeher?: { x: number; y: number; gier: number; nick: number };
    /**
     * Was in der 3D-Ansicht unter einem Bildschirmpunkt liegt — derselbe
     * Strahl, den auch der Klick benutzt. Ebenfalls nur für Prüfläufe: Ohne
     * ihn ließe sich „trifft der Klick das Objekt, das ich sehe?" nur am Bild
     * beurteilen, und ein Bild beweist nichts.
     */
    __raviaTreffer?: (
      x: number,
      y: number,
    ) => { fixtureId?: string; punkt?: { x: number; y: number }; hoehe?: number } | null;
    /**
     * Wie viele Eckpunkte je Bauteilart im Modell stehen — nach Art, so wie
     * der Betrachter sie am Körper vermerkt (`userData.art`). Dieselbe Sorte
     * Haken wie `__raviaTreffer`: Ob ein Rohr im Estrich gebaut wurde, ist am
     * Bild nicht zu beweisen; eine Null an dieser Stelle beweist, dass keines
     * gebaut wurde.
     */
    __raviaSzene?: () => Record<string, number>;
    /**
     * Wie weit jedes Türblatt aufsteht — 0 = zu, 1 = ganz auf. Dieselbe Sorte
     * Haken wie die beiden darüber: Ob eine Tür wirklich offen ist, entscheidet
     * im begehbaren Modus darüber, ob man durchkommt; am Bild ist es nicht zu
     * beweisen.
     */
    __raviaTueren?: () => number[];
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
