/*
 * Beispielseite zur Einbettung — das Skript dazu.
 * ---------------------------------------------------------------------------
 * **Warum eine eigene Datei und kein `<script>` in der Seite.** Der Server
 * liefert die Inhaltsrichtlinie `script-src 'self'` aus. Sie verwirft jedes
 * Skript, das im Dokument selbst steht — auch das dieser Seite. Als Skript
 * im Dokument sah die Beispielseite unter nginx aus wie eine Seite, deren
 * Einbettung nicht funktioniert; tatsächlich lief nur ihre eigene Steuerung
 * nicht.
 *
 * Das ist derselbe Grund, aus dem die fünf Druckwege seit 1.14.0 kein
 * eingebettetes Skript mehr schreiben. Wer diese Seite als Vorlage für die
 * Einbindung in RaVia benutzt, sieht die Regel hier gleich mit.
 */
const frame = document.getElementById('cad');
const out = document.getElementById('out');
let seq = 0;
const pending = new Map();

/** Ein Befehl an den Editor; das Versprechen löst sich mit der Antwort auf. */
function call(type, payload) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, resolve);
    setTimeout(() => {
      if (pending.delete(id)) reject(new Error('Zeitüberschreitung: ' + type));
    }, 8000);
    frame.contentWindow.postMessage({ channel: 'ravia-cad', type, id, payload }, '*');
  });
}

window.addEventListener('message', (e) => {
  const d = e.data;
  if (!d || d.channel !== 'ravia-cad') return;

  if (d.type === 'changed') {
    renderSummary(d.payload);
    return;
  }
  const resolve = pending.get(d.id);
  if (resolve) {
    pending.delete(d.id);
    resolve(d.payload);
  }
});

function renderSummary(s) {
  document.getElementById('summary').innerHTML = [
    ['Projekt', s.projectName],
    ['Geschosse', s.levels],
    ['Räume', s.rooms],
    ['Wände', s.walls],
    ['Öffnungen', s.openings],
    ['Nutzfläche', s.netFloorArea.toFixed(2) + ' m²'],
    ['Volumen', s.netVolume.toFixed(2) + ' m³'],
    ['Heizleistung', s.installedHeatingPower + ' W'],
  ].map(([k, v]) => `<div class="row"><span>${k}</span><span>${v}</span></div>`).join('') +
  `<div class="row"><span>Rechenfähig</span><span class="${s.ready ? 'ok' : 'bad'}">${
    s.ready ? 'ja' : s.errors + ' Fehler'}</span></div>`;
}

const show = (v) => { out.textContent = typeof v === 'string' ? v.slice(0, 4000) : JSON.stringify(v, null, 1).slice(0, 4000); };

document.getElementById('btn-summary').onclick = () => call('getSummary').then(show);
document.getElementById('btn-validate').onclick = () => call('validate').then(show);
document.getElementById('btn-export').onclick = () => call('getExport').then(show);
document.getElementById('btn-ifc').onclick = () => call('getIfc').then(show);

// --- Schreibweg -------------------------------------------------------------

/**
 * Ein Ziel für den Schreibvorgang. Die Raum-Kennungen stehen im Export — die
 * Gegenstelle erfindet sie nicht, sie liest sie. Genau darauf verweist auch
 * die Ablehnung, wenn eine unbekannte Kennung ankommt.
 */
async function ersterRaum() {
  const ex = await call('getExport');
  const raum = ex.rooms[0];
  if (raum) {
    document.getElementById('raum').textContent = raum.name;
    document.getElementById('soll').textContent = raum.setpointTemperature + ' °C';
  }
  return raum;
}

/**
 * Der Bericht Zeile für Zeile. Er ist der eigentliche Inhalt der Antwort:
 * ein Schreibvorgang, der nur „ok" meldet, ist eine Behauptung — hier steht
 * für jeden einzelnen Wert, was mit ihm geschehen ist und warum.
 */
function zeigeBericht(bericht) {
  const farbe = { 'übernommen': 'ok', 'unverändert': '', 'abgelehnt': 'bad' };
  document.getElementById('report').innerHTML =
    `<div class="row"><span>Bilanz</span><span class="${bericht.ok ? 'ok' : 'bad'}">${bericht.summary}</span></div>` +
    bericht.entries.map((e) => `<div class="row"><span>${e.label}</span><span class="${farbe[e.verdict]}">${
      e.verdict === 'übernommen' ? `${e.before ?? '—'} → ${e.after}` : e.verdict}</span></div>` +
      (e.reason ? `<p style="margin:2px 0 8px">${e.reason}</p>` : '')).join('');
  show(bericht);
}

/** Ein Schreibvorgang samt Anzeige des Berichts und des neuen Modellstands. */
async function schreibe(patch) {
  const bericht = await call('applyPatch', { source: 'RaVia-Beispielseite', ...patch });
  zeigeBericht(bericht);
  await ersterRaum();
}

document.getElementById('btn-patch').onclick = async () => {
  const raum = await ersterRaum();
  if (!raum) return;
  // Zweimal derselbe Wert ist kein Fehler, sondern „unverändert" — und
  // erzeugt im Editor bewusst keinen Schritt in der Rückgängig-Kette.
  await schreibe({ rooms: [{ id: raum.id, setpointTemperature: 22, airChangeRate: 0.6 }] });
};

document.getElementById('btn-patch-load').onclick = async () => {
  const raum = await ersterRaum();
  if (!raum) return;
  // Die Aufteilung muss die Summe ergeben, sonst wird sie abgelehnt.
  await schreibe({
    rooms: [{ id: raum.id, heatLoad: { total: 1200, transmission: 800, ventilation: 300, reheat: 100 } }],
    totalHeatLoad: 8400,
  });
};

document.getElementById('btn-patch-bad').onclick = async () => {
  const raum = await ersterRaum();
  if (!raum) return;
  // Geometrie gehört dem, der zeichnet. Die Antwort sagt das im Klartext.
  await schreibe({ rooms: [{ id: raum.id, area: 42 }] });
};

document.getElementById('btn-fields').onclick = () => call('getWritableFields').then(show);

frame.addEventListener('load', async () => {
  // Der Editor braucht einen Moment, bis der Store steht.
  for (let i = 0; i < 40; i++) {
    try {
      const pong = await call('ping');
      document.getElementById('status').textContent = 'verbunden';
      document.getElementById('status').className = 'ok';
      document.getElementById('version').textContent = pong.version;
      await call('subscribe');
      renderSummary(await call('getSummary'));
      await ersterRaum();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  document.getElementById('status').textContent = 'keine Antwort';
  document.getElementById('status').className = 'bad';
});
