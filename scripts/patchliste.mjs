/**
 * Erzeugt die Patchliste als eigenständige HTML-Seite.
 *
 * **Warum es dieses Skript gibt.** Die Patchliste war von Hand gepflegt und
 * stand deshalb irgendwann bei 1.59.0, während das Programm bei 1.64.0 war —
 * eine Liste, die behauptet, vollständig zu sein, und es nicht ist, ist
 * schlechter als keine. Ihr Inhalt steht ohnehin schon zweimal im Projekt:
 * der Text in der Fassungsgeschichte des Handbuchs (`handbuch/kap-18.html`,
 * Abschnitt 18.6), Datum und Commit in der Versionsverwaltung. Also wird sie
 * daraus gebaut und nicht daneben geschrieben.
 *
 * **Was von Hand bleibt.** Zwei Tabellen unten in dieser Datei: die
 * Überschriften der Zehnerblöcke (ein Schlagwort je Block — das kann kein
 * Rechner aus den Texten ziehen) und die Schnittstellenstände. Die zweite ist
 * absichtlich keine Ableitung: Welche Programmfassung welchen Exportstand
 * gebracht hat, ist eine Zusage an die Gegenstelle, und die gehört
 * aufgeschrieben, nicht geraten. Das Skript prüft nur, dass jede dort
 * genannte Fassung wirklich existiert.
 *
 *     node scripts/patchliste.mjs            → claude-patchliste-cad-light.html
 *     node scripts/patchliste.mjs <datei>    → dorthin
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const ZIEL = process.argv[2] ?? 'patchliste-cad-light.html';

// --- Von Hand: Überschrift je Zehnerblock ----------------------------------
const BLOeCKE = {
  70: 'Dachschnitt, Rohrlängen, Praxisprüfung, Abgleich mit RaVia und RaVia Scan',
  60: 'Verbrauchsabgleich, Baugrube, Scan als Datei, Aufnahme ohne Zeichnen, Fußbodenheizung',
  50: 'Anlagenschema, Normsymbole, Mehrgeschossigkeit, Schutzbereich',
  40: 'Steigleitung, Hüllflächenbilanz, Freigabelauf, Übersichtsschema',
  30: 'Importe, Gerätekatalog, Sprachschicht, Gebäudescan',
  20: 'Bauteile, Dachformen, Kompass, IFC-Import',
  10: 'Aufmaß, Raumscan, Serverbetrieb, Erzeugerhydraulik',
  0: 'Rückweg aus RaVia, erstes echtes Aufmaß, erste Fassungsreihe',
  vor1: 'vor der ersten Fassung — Grundgerüst, Zeichnen, Räume',
};

// --- Von Hand: Schnittstellenstände ---------------------------------------
const SCHNITT = [
  ['1.29.0', 'Export 2.2.0', '<code>pipeLengths</code> je Raum — die Rohrmeter, die in diesem Raum liegen'],
  ['1.44.0', 'Export 2.3.0', '<code>envelope</code> je Raum und Gebäude — die Hüllflächenbilanz als Prüfsumme'],
  ['1.46.0', 'Einbettung 1.5.0', '<code>getDocument</code> auch über die Nachrichtenbrücke'],
  ['1.47.0', 'Export 2.4.0 · Einbettung 1.6.0', '<code>envelope.withoutUValue</code>; <code>reportDiscardedRooms</code>'],
  ['1.58.0', 'Export 2.5.0', '<code>formerIds</code> am Raum — frühere Kennungen, damit der Rückweg sie wiederfindet'],
  ['1.59.0', 'Export 2.6.0', '<code>refrigerantClass</code>, <code>hermetisch</code>, <code>hoehe</code> am Außengerät'],
  ['1.60.0', 'Export 2.7.0', '<code>project.verbrauch</code>, <code>project.baualter</code>, <code>totals.heatLoadCrosscheck</code> — die Gegenprobe zur Heizlast'],
  ['1.64.0', 'Export 2.8.0', '<code>project.annahmen</code> — was angenommen wurde, weil nichts vorlag'],
  ['1.65.0', 'Export 2.9.0', '<code>pipeGraph</code> — das Rohrnetz als Netz mit Knoten, Vorgängern und Verzweigungen, dazu die Flächenheizkreise und die gemischt beheizten Räume'],
  ['1.73.0', 'Export 2.15.0', '<code>raviaRoomId</code>, Randbedingung <code>neighbour</code>, Heizkörper mit <code>ratedPower</code> bei 75/65/20 °C, <code>levels[].order</code>; dazu ein JSON-Schema, gegen das jeder Export geprüft wird'],
];

// --- Die Fassungen aus dem Handbuch ---------------------------------------
const kapitel = readFileSync('handbuch/kap-18.html', 'utf8');
const zeilen = [...kapitel.matchAll(/<tr><td>(\d+\.\d+\.\d+)<\/td><td>(.*?)<\/td><td>(.*?)<\/td><\/tr>/gs)];
if (zeilen.length < 60) {
  console.error(`Nur ${zeilen.length} Fassungen in handbuch/kap-18.html gefunden — das kann nicht stimmen.`);
  process.exit(1);
}

// --- Datum und Commit aus der Versionsverwaltung --------------------------
const herkunft = new Map();
for (const z of execFileSync('git', ['log', '--pretty=%h|%ad|%s', '--date=format:%d.%m.%Y'], { encoding: 'utf8' }).split('\n')) {
  const [commit, datum, betreff] = z.split('|');
  const m = /^(\d+\.\d+\.\d+)/.exec(betreff ?? '');
  // Die erste Nennung gewinnt nicht: `git log` kommt neu nach alt, und bei
  // einer Fassung, die zweimal vorkommt, ist der **frühere** Commit der, der
  // sie gebracht hat.
  if (m) herkunft.set(m[1], { commit, datum });
}

const nachNummer = (v) => v.split('.').map(Number);
const vergleich = (a, b) => {
  const [a1, a2, a3] = nachNummer(a); const [b1, b2, b3] = nachNummer(b);
  return b1 - a1 || b2 - a2 || b3 - a3;
};

const fassungen = zeilen.map(([, v, stich, text]) => {
  let korr = 0;
  let stichwort = stich.trim();
  if (stichwort === 'Fehlerkorrekturen') korr = 1;
  else if (stichwort.startsWith('nur Fehlerkorrekturen')) {
    korr = 1;
    stichwort = stichwort.replace(/^nur Fehlerkorrekturen\s*—\s*/, '');
  }
  const h = herkunft.get(v);
  const schnitt = SCHNITT.filter((s) => s[0] === v).map((s) => s[1]);
  return { v, stichwort, text: text.trim(), korr, datum: h?.datum, commit: h?.commit, schnitt };
}).sort((a, b) => vergleich(a.v, b.v));

// Gegenprobe: Jede Fassung der Schnittstellentabelle muss es geben.
for (const [v] of SCHNITT) {
  if (!fassungen.some((f) => f.v === v)) {
    console.error(`Schnittstellentabelle nennt ${v} — diese Fassung steht nicht in der Fassungsgeschichte.`);
    process.exit(1);
  }
}

const live = fassungen[0];
const fassung = /FASSUNG = '([\d.]+)'/.exec(readFileSync('src/lib/fassung.ts', 'utf8'))?.[1];
if (live.v !== fassung) {
  console.error(`Neueste Fassung der Liste ist ${live.v}, das Programm steht auf ${fassung}.`);
  console.error('Erst die Fassungsgeschichte in handbuch/kap-18.html ergänzen, dann dieses Skript.');
  process.exit(1);
}

const mitDatum = fassungen.filter((f) => f.datum);
const aeltesteMitDatum = mitDatum.length ? mitDatum[mitDatum.length - 1].v : '—';
const datumWert = (d) => d.split('.').reverse().join('');
const spanne = mitDatum.map((f) => f.datum).sort((a, b) => datumWert(a).localeCompare(datumWert(b)));
const korrZahl = fassungen.filter((f) => f.korr).length;
const ohneDatum = fassungen.length - mitDatum.length;

// --- Zusammensetzen -------------------------------------------------------
/*
 * Zehnerblöcke — und die Hauptnummer gehört dazu. Ohne sie landeten 0.9.0 und
 * 1.9.0 im selben Block: Die Fassungsgeschichte reicht bis 0.4.0 zurück, und
 * das waren die Wochen vor der ersten Fassung.
 */
const block = (v) => {
  const [erste, zweite] = nachNummer(v);
  if (erste === 0) return 'vor1';
  return zweite < 10 ? 0 : Math.floor(zweite / 10) * 10;
};
const nullFassungen = fassungen.filter((f) => nachNummer(f.v)[0] === 0).map((f) => f.v);
const blockName = (b) =>
  b === 'vor1' ? `${nullFassungen[nullFassungen.length - 1]?.slice(0, 3) ?? '0.1'} bis ${nullFassungen[0]?.slice(0, 3) ?? '0.9'}`
  : b === 0 ? '1.0 bis 1.9'
  : `1.${b} bis 1.${b + 9}`;

const reihenfolge = (b) => (b === 'vor1' ? -1 : b);
const reihen = [...new Set(fassungen.map((f) => block(f.v)))]
  .sort((a, b) => reihenfolge(b) - reihenfolge(a))
  .map((b) => {
  const drin = fassungen.filter((f) => block(f.v) === b);
  const stuecke = drin.map((f) => {
    const marken = f.schnitt.map((s) => `<span class="marke m-schnitt">${s}</span>`).join('')
      + (f.korr ? '<span class="marke m-korr">Korrekturfassung</span>' : '')
      + (f === live ? '<span class="marke m-live">live</span>' : '');
    const woher = f.datum
      ? `<span class="datum">${f.datum}</span> <code>${f.commit}</code>`
      : '<span class="leer">vor der Versionsverwaltung</span>';
    return `<article class="fassung${f === live ? ' ist-live' : ''}" data-v="${f.v}" data-korr="${f.korr}" data-schnitt="${f.schnitt.length ? 1 : 0}">
  <div class="kopfzeile">
    <span class="nr">${f.v}</span>
    <span class="stichwort">${f.stichwort}</span>
    ${marken}
  </div>
  <div class="herkunft">${woher}</div>
  <p class="was">${f.text}</p>
</article>`;
  }).join('\n');
  return `<section class="reihe" data-reihe="${b}">
<h2>${blockName(b)}<span class="zusatz">${BLOeCKE[b] ?? ''} · ${drin.length} ${drin.length === 1 ? 'Fassung' : 'Fassungen'}</span></h2>
${stuecke}
</section>`;
}).join('\n\n');

const schnittZeilen = [...SCHNITT].reverse().map(([v, s, was]) => {
  const teile = s.split(' · ').map((t) => t.replace(/([\d.]+)$/, '<b>$1</b>')).join(' · ');
  return `  <tr><td><code>${v}</code></td><td>${teile}</td><td>${was}</td></tr>`;
}).reverse().join('\n');

const seite = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>RaVia CAD Light — Patchliste</title>
<style>
  :root{
    --bg:#0B1120; --panel:#0F172A; --panel2:#131c33; --line:rgba(255,255,255,.09);
    --text:#E2E8F0; --dim:#94A3B8; --dim2:#64748B;
    --accent:#38BDF8; --gruen:#34D399; --gelb:#FBBF24; --rot:#F87171; --lila:#A78BFA;
  }
  *{box-sizing:border-box}
  html{-webkit-text-size-adjust:100%}
  body{margin:0;background:var(--bg);color:var(--text);
       font:15px/1.65 Inter,"Segoe UI",system-ui,-apple-system,sans-serif;
       padding:0 16px 80px}
  .wrap{max-width:980px;margin:0 auto}
  header{padding:40px 0 20px;border-bottom:1px solid var(--line)}
  h1{font-size:26px;line-height:1.25;margin:0 0 4px;font-weight:650;letter-spacing:-.01em}
  .unter{color:var(--dim);font-size:13.5px;margin:0;max-width:74ch}
  h2{font-size:19px;margin:40px 0 12px;font-weight:620;letter-spacing:-.01em;
     padding-bottom:8px;border-bottom:1px solid var(--line)}
  h2 .zusatz{display:block;font-weight:400;color:var(--dim2);font-size:12.5px;
             margin-top:3px;letter-spacing:0}
  p{margin:8px 0}
  a{color:var(--accent);text-decoration:none}
  a:hover{text-decoration:underline}
  code{font:12px/1.5 "JetBrains Mono",ui-monospace,SFMono-Regular,monospace;
       background:rgba(255,255,255,.06);padding:1px 5px;border-radius:4px;color:#cbd5e1;
       overflow-wrap:anywhere}
  kbd{font:11.5px/1.4 "JetBrains Mono",ui-monospace,monospace;background:rgba(255,255,255,.08);
      border:1px solid var(--line);border-bottom-width:2px;border-radius:4px;padding:1px 5px;color:#cbd5e1}

  .karten{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin:20px 0 0}
  .karte{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
  .karte .ort{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--dim2)}
  .karte .zahl{font-size:26px;font-weight:650;letter-spacing:-.02em;margin:3px 0 2px}
  .karte .note{font-size:11.5px;color:var(--dim);line-height:1.5}
  .karte.gut .zahl{color:var(--gruen)}
  .karte.acc .zahl{color:var(--accent)}

  .hinweis{background:var(--panel2);border:1px solid var(--line);border-left:3px solid var(--gruen);
           border-radius:10px;padding:13px 17px;margin:20px 0 0;font-size:13.5px;color:var(--dim);line-height:1.62}
  .hinweis b{color:var(--text);font-weight:600}

  .leiste{position:sticky;top:0;z-index:5;background:rgba(11,17,32,.92);
          backdrop-filter:blur(8px);border-bottom:1px solid var(--line);
          margin:24px -16px 0;padding:12px 16px;display:flex;gap:10px;
          align-items:center;flex-wrap:wrap}
  .suche{flex:1;min-width:200px;background:var(--panel);border:1px solid var(--line);
         border-radius:9px;padding:8px 12px;color:var(--text);font:inherit;font-size:13.5px}
  .suche:focus{outline:none;border-color:var(--accent)}
  .chip{background:var(--panel);border:1px solid var(--line);border-radius:99px;
        padding:6px 13px;color:var(--dim);cursor:pointer;font:inherit;
        font-size:12.5px;line-height:1.4}
  .chip:hover{color:var(--text)}
  .chip[aria-pressed=true]{background:rgba(56,189,248,.14);border-color:rgba(56,189,248,.35);color:var(--accent)}
  .treffer{font-size:12px;color:var(--dim2);white-space:nowrap}

  .fassung{background:var(--panel);border:1px solid var(--line);border-radius:11px;
           padding:13px 16px;margin:9px 0}
  .fassung.ist-live{border-color:rgba(52,211,153,.4);background:rgba(52,211,153,.05)}
  .kopfzeile{display:flex;align-items:baseline;gap:9px;flex-wrap:wrap}
  .nr{font:13px/1.4 "JetBrains Mono",ui-monospace,monospace;font-weight:600;
      color:var(--accent);white-space:nowrap}
  .ist-live .nr{color:var(--gruen)}
  .stichwort{font-weight:600;font-size:14.5px;flex:1;min-width:140px}
  .marke{font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;
         padding:2px 8px;border-radius:99px;white-space:nowrap}
  .m-korr{background:rgba(251,191,36,.14);color:var(--gelb)}
  .m-schnitt{background:rgba(167,139,250,.15);color:var(--lila)}
  .m-live{background:rgba(52,211,153,.16);color:var(--gruen)}
  .herkunft{margin-top:4px;font-size:11.5px;color:var(--dim2)}
  .herkunft .datum{font-variant-numeric:tabular-nums}
  .herkunft .leer{font-style:italic}
  .was{margin:7px 0 0;font-size:13.5px;color:var(--dim);line-height:1.66}
  .was b{color:var(--text);font-weight:600}
  .reihe.leer{display:none}

  table{width:100%;border-collapse:collapse;margin:12px 0;font-size:13px}
  th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}
  th{color:var(--dim2);font-size:11px;text-transform:uppercase;letter-spacing:.07em;font-weight:600}
  .tabellenrahmen{overflow-x:auto;-webkit-overflow-scrolling:touch}

  footer{margin-top:48px;padding-top:18px;border-top:1px solid var(--line);
         font-size:12px;color:var(--dim2);line-height:1.7}

  @media (max-width:560px){
    h1{font-size:22px} body{font-size:14.5px}
    .karte .zahl{font-size:22px}
    .leiste{position:static;margin:20px 0 0;padding:12px 0;background:none}
  }
  @media print{
    body{background:#fff;color:#111;padding:0}
    .leiste,.karten{display:none}
    .fassung{background:none;border:none;border-bottom:1px solid #ddd;border-radius:0;
             padding:8px 0;break-inside:avoid}
    .was,.herkunft,.unter{color:#333}
    a{color:#111}
    h2{break-after:avoid}
  }
</style>
</head>
<body>
<div class="wrap">

<header>
  <h1>RaVia CAD Light · Patchliste</h1>
  <p class="unter">Alle Fassungen von <b>${fassungen[fassungen.length - 1].v}</b> bis <b>${live.v}</b> — vollständig, von der neuesten
  zur ältesten. Der Text jeder Zeile stammt aus der Fassungsgeschichte des Handbuchs
  (Kapitel 18.6); Datum und Commit kommen aus der Versionsverwaltung. Diese Seite wird
  daraus <b>erzeugt</b> (<code>scripts/patchliste.mjs</code>) — hier ist nichts nachträglich
  umformuliert worden und nichts kann zurückfallen.</p>

  <div class="karten">
    <div class="karte acc">
      <div class="ort">Fassungen</div>
      <div class="zahl">${fassungen.length}</div>
      <div class="note">davon ${korrZahl} reine Korrekturfassungen</div>
    </div>
    <div class="karte">
      <div class="ort">Zeitraum</div>
      <div class="zahl" style="font-size:19px">${spanne[0]} – ${spanne[spanne.length - 1]}</div>
      <div class="note">Spanne der Fassungen mit Commit; die ${ohneDatum} ohne liegen davor</div>
    </div>
    <div class="karte gut">
      <div class="ort">Live · ravia-tech.de/Cad_light/</div>
      <div class="zahl">${live.v}</div>
      <div class="note">${live.commit
        ? `Commit <code>${live.commit}</code> · aufgespielt und abgenommen`
        : 'noch nicht eingecheckt — diese Seite nach dem Commit neu erzeugen'}</div>
    </div>
  </div>

  <div class="hinweis">
    <b>Der Live-Stand ist immer der neueste.</b> Zwischen dem Arbeitsplatz und dem Server
    steht eine durchgehende Kette — Paket, Prüfsumme, <code>scp</code>, <code>ssh</code>,
    Abnahme —, und sie wird für jede fertige Fassung gefahren. Es gibt deshalb keinen
    Rückstand zwischen dem, was hier steht, und dem, was unter
    <code>ravia-tech.de/Cad_light/</code> läuft: Was in dieser Liste oben steht, ist live.
    <b>Nicht davon betroffen ist die bei RaVia eingebettete Kopie</b> — die liegt auf einem
    eigenen Server und wird von dort nachgezogen; ihr Stand ist nach unserer letzten
    Rückmeldung 1.44.0.
  </div>
</header>

<div class="leiste">
  <input class="suche" id="suche" type="search" placeholder="Suchen — Fassung, Stichwort, Text …"
         autocomplete="off" aria-label="Patchliste durchsuchen" />
  <button class="chip" id="f-alle" aria-pressed="true">alle</button>
  <button class="chip" id="f-korr" aria-pressed="false">nur Korrekturen</button>
  <button class="chip" id="f-schnitt" aria-pressed="false">nur Schnittstelle</button>
  <span class="treffer" id="treffer"></span>
</div>

${reihen}

<h2>Schnittstellenstände im Zeitverlauf<span class="zusatz">nur die Schritte, die sich einzeln belegen lassen</span></h2>

<div class="tabellenrahmen"><table>
  <tr><th style="width:110px">Fassung</th><th style="width:170px">Schnittstelle</th><th>Was dazukam</th></tr>
${schnittZeilen}
</table></div>

<p class="unter">Jeder dieser Schritte ist <b>additiv</b>: Kein Feld ist weggefallen, keines hat
seine Bedeutung geändert. Eine Gegenstelle, die gegen 2.0.0 gebaut hat, liest eine
2.8.0-Datei unverändert. Die Schritte 2.0.0 und 2.1.0 sind hier nicht aufgeführt, weil sich
nicht mehr eindeutig belegen lässt, mit welcher Programmfassung sie kamen.</p>

<footer>
  <b>Quellen.</b> Der Text jeder Fassung ist wörtlich die Fassungsgeschichte aus Kapitel 18.6
  des Handbuchs (<code>handbuch/kap-18.html</code>) — dieselbe Quelle, aus der auch das
  ausgelieferte Handbuch entsteht. Datum und Commit stammen aus <code>git log</code>.
  Erzeugt am ${new Date().toLocaleDateString('de-DE')} mit <code>node scripts/patchliste.mjs</code>.
  <br><br>
  <b>Zwei Lücken, die in den Daten liegen und nicht im Text.</b>
  Die Versionsverwaltung dieses Projekts beginnt erst bei <code>${aeltesteMitDatum}</code> —
  die ${ohneDatum} Fassungen ohne Datum liegen davor oder kamen gebündelt in einem
  Stand an. Namentlich die Fassungen <code>1.17.0</code> bis <code>1.27.0</code>:
  sie wurden zusammen eingecheckt (<code>630d70e</code>, „zwölf Fassungen in einem
  Stand"). Sie tragen deshalb kein eigenes Datum, und das steht an jeder einzelnen
  dran, statt dass ein plausibles Datum eingesetzt wird.
  <br><br>
  Die Suche und die Filter laufen nur in diesem Browser; es wird nichts gespeichert und
  nichts übertragen.
</footer>

</div>
<script>
(function () {
  var suche = document.getElementById('suche');
  var treffer = document.getElementById('treffer');
  var knoepfe = {
    alle: document.getElementById('f-alle'),
    korr: document.getElementById('f-korr'),
    schnitt: document.getElementById('f-schnitt')
  };
  var fassungen = Array.prototype.slice.call(document.querySelectorAll('.fassung'));
  var reihen = Array.prototype.slice.call(document.querySelectorAll('.reihe'));
  var filter = 'alle';

  /* Einmal den durchsuchbaren Text je Fassung bilden — nicht bei jedem Tastendruck. */
  fassungen.forEach(function (f) {
    f._text = (f.getAttribute('data-v') + ' ' + f.textContent).toLowerCase();
  });

  function zeigen() {
    var q = suche.value.trim().toLowerCase();
    var n = 0;
    fassungen.forEach(function (f) {
      var passtFilter =
        filter === 'alle' ? true :
        filter === 'korr' ? f.getAttribute('data-korr') === '1' :
        f.getAttribute('data-schnitt') === '1';
      var passtText = !q || f._text.indexOf(q) !== -1;
      var sichtbar = passtFilter && passtText;
      f.style.display = sichtbar ? '' : 'none';
      if (sichtbar) n++;
    });
    /* Eine Reihe ohne sichtbare Fassung verschwindet samt Überschrift. */
    reihen.forEach(function (r) {
      var sichtbar = r.querySelector('.fassung:not([style*="display: none"])');
      r.classList.toggle('leer', !sichtbar);
    });
    treffer.textContent = n === fassungen.length
      ? n + ' Fassungen'
      : n + ' von ' + fassungen.length;
  }

  suche.addEventListener('input', zeigen);
  Object.keys(knoepfe).forEach(function (name) {
    knoepfe[name].addEventListener('click', function () {
      filter = (filter === name && name !== 'alle') ? 'alle' : name;
      Object.keys(knoepfe).forEach(function (k) {
        knoepfe[k].setAttribute('aria-pressed', String(k === filter));
      });
      zeigen();
    });
  });
  zeigen();
})();
</script>
</body>
</html>
`;

writeFileSync(ZIEL, seite);
console.log(`Patchliste geschrieben: ${ZIEL}`);
console.log(`  ${fassungen.length} Fassungen · ${korrZahl} Korrekturfassungen · neueste ${live.v} (${live.commit ?? 'noch kein Commit'})`);
console.log(`  ${ohneDatum} ohne Datum (vor der Versionsverwaltung) · Zeitraum ${spanne[0]} – ${spanne[spanne.length - 1]}`);
