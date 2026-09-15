/**
 * StatusBar — die schmale Zeile, die während der Arbeit alles Nötige zeigt:
 * aktives Werkzeug, Live-Maße, Fangstatus, Zoom und Modellumfang.
 */

import { useBimStore } from '../store/useBimStore';

const TOOL_LABELS: Record<string, string> = {
  select: 'Auswählen',
  wall: 'Wand',
  door: 'Tür',
  window: 'Fenster',
  dimension: 'Bemaßung',
  passage: 'Durchgang',
  fixture: 'TGA-Symbol',
  stair: 'Treppe',
  shaft: 'Schacht',
  pipe: 'Leitung',
  annotation: 'Beschriftung',
  calibrate: 'Kalibrieren',
  pan: 'Verschieben',
  heatpump: 'Wärmepumpe',
  site: 'Außengelände',
};

/**
 * Kurzanleitung je Werkzeug — sie steht dort, wo sonst „Bereit" stünde.
 *
 * „Bereit" sagt nichts. Solange nichts Wichtigeres zu melden ist, kann an
 * derselben Stelle stehen, wie das gerade gewählte Werkzeug zu bedienen ist.
 * Sobald es etwas zu melden gibt — eine Länge, ein Ergebnis, eine Warnung —,
 * tritt der Hinweis zurück.
 */
const TOOL_HINTS: Record<string, string> = {
  select: 'Anklicken zum Bearbeiten · Rahmen ziehen wählt mehrere · Entf löscht',
  wall: 'Klick setzt einen Punkt, der nächste zieht die Wand · Länge eintippen geht auch · Esc beendet',
  door: 'Auf eine Wand klicken — die Tür sitzt an der Klickstelle',
  window: 'Auf eine Wand klicken · Breite und Brüstung stehen danach rechts',
  passage: 'Wandöffnung ohne Tür — auf eine Wand klicken',
  fixture: 'Symbol rechts im Reiter „TGA" wählen, dann in den Plan klicken',
  stair: 'In den Raum klicken · Lauf, Steigungen und Abzüge stehen danach rechts',
  shaft: 'In den Raum klicken — die Fläche zählt nicht mehr als Raum',
  pipe: 'Punkte setzen · Klick auf ein Symbol schließt dort an · Esc beendet',
  annotation: 'Zwei Punkte für eine Maßkette · nur Plangrafik, nicht für die Rechnung',
  calibrate: 'Eine bekannte Strecke im Bild abfahren und ihre wahre Länge eintragen',
  pan: 'Ziehen verschiebt die Ansicht · geht auch mit der rechten Maustaste',
  heatpump: 'In den Garten klicken · der Kreis zeigt, ab wo der Nachtwert eingehalten ist',
  site: 'Art im Reiter „Wärmepumpe" wählen · Flächen umfahren, erster Punkt schließt',
};

export default function StatusBar() {
  const tool = useBimStore((s) => s.tool);
  const status = useBimStore((s) => s.statusMessage);
  const snap = useBimStore((s) => s.snap);
  const viewport = useBimStore((s) => s.viewport);
  const doc = useBimStore((s) => s.doc);
  const trace = useBimStore((s) => s.trace);
  const hostPatch = doc.meta.lastHostPatch;

  const rooms = Object.values(doc.rooms);
  const totalArea = rooms.reduce((sum, r) => sum + r.area, 0);
  const openEnds = doc.diagnostics.openEnds.length;
  // Lücken werden getrennt gezählt, nicht zu den offenen Wandenden geschlagen.
  // Es sind zwei verschiedene Befunde: dort endet eine Wand im Nichts, hier
  // fehlt eine ganze Wand zwischen zwei sauberen Anschlüssen. Wer beides in
  // einer Zahl liest, sucht die Hälfte davon am falschen Ort.
  const gaps = (doc.diagnostics.closure ?? []).filter((c) => c.kind === 'gap').length;
  const fixtureCount = Object.keys(doc.fixtures).length;
  const heatingPower = Object.values(doc.fixtures).reduce((sum, f) => sum + (f.params.powerW ?? 0), 0);

  /*
      * Dieselbe Regel wie in der Kopfzeile: lieber wischen als abschneiden.
      * `whitespace-nowrap` verhindert den Umbruch, der die Zeile sonst auf
      * zwei Zeilen zieht und die untere unter den Bildschirmrand schiebt.
     */
  return (
    <footer
      className="flex h-7 shrink-0 items-center gap-3 overflow-x-auto overscroll-x-contain whitespace-nowrap px-3 font-mono text-[10px] text-slate-500 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      style={{ touchAction: 'pan-x' }}
    >
      <span className="flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-accent" />
        <span className="text-slate-300">{TOOL_LABELS[tool] ?? tool}</span>
      </span>

      <span className="text-slate-700">│</span>
      {status === 'Bereit' && TOOL_HINTS[tool] ? (
        <span className="text-slate-500">{TOOL_HINTS[tool]}</span>
      ) : (
        <span className="text-slate-400">{status}</span>
      )}

      <div className="flex-1" />

      {openEnds > 0 && (
        <>
          <span className="text-orange-300">
            {openEnds} offene {openEnds === 1 ? 'Wandende' : 'Wandenden'}
          </span>
          <span className="text-slate-700">│</span>
        </>
      )}

      {gaps > 0 && (
        <>
          <span className="text-orange-300">
            {gaps} {gaps === 1 ? 'Lücke' : 'Lücken'} in der Umschließung
          </span>
          <span className="text-slate-700">│</span>
        </>
      )}

      {trace && (
        <>
          <span className="text-fuchsia-300">
            Auto-Trace aktiv · {trace.walls.filter((w) => !w.rejected).length} Vektoren
          </span>
          <span className="text-slate-700">│</span>
        </>
      )}

      {/*
        Hat die Gegenstelle in dieses Modell geschrieben, muss das dauerhaft
        sichtbar sein und nicht nur einen Moment lang in der Meldung stehen.
        Wer eine Solltemperatur sieht, die er nicht eingetragen hat, findet
        hier die Erklärung — samt Absender und Zeitpunkt im Tooltip.
      */}
      {hostPatch && (
        <>
          <span
            className="text-cyan-300"
            title={`${hostPatch.summary} — ${new Date(hostPatch.at).toLocaleString('de-DE')}. Strg+Z nimmt den Vorgang zurück.`}
          >
            ← {hostPatch.source}: {hostPatch.applied} {hostPatch.applied === 1 ? 'Wert' : 'Werte'}
            {hostPatch.rejected > 0 ? `, ${hostPatch.rejected} abgelehnt` : ''}
          </span>
          <span className="text-slate-700">│</span>
        </>
      )}

      <span>
        Raster {snap.grid ? `${snap.gridSize.toFixed(3)} m` : 'aus'}
      </span>
      <span className="text-slate-700">│</span>
      <span>Winkel {snap.angle ? `${snap.angleStep}°` : 'frei'}</span>
      <span className="text-slate-700">│</span>
      <span>{Math.round(viewport.zoom)} px/m</span>
      <span className="text-slate-700">│</span>
      <span>
        {Object.keys(doc.walls).length} Wände · {Object.keys(doc.openings).length} Öffnungen ·{' '}
        {rooms.length} Räume
      </span>
      <span className="text-slate-700">│</span>
      <span className="text-accent">{totalArea.toFixed(2)} m²</span>
      {fixtureCount > 0 && (
        <>
          <span className="text-slate-700">│</span>
          <span>
            {fixtureCount} TGA · {heatingPower.toLocaleString('de-DE')} W
          </span>
        </>
      )}
    </footer>
  );
}
