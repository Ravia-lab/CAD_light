/**
 * Bildschirmfotos für das Handbuch — aus dem Programm heraus aufgenommen.
 * ---------------------------------------------------------------------------
 * **Warum dieses Skript existiert.** Aus demselben Grund wie
 * `handbuch-symbole.ts`: ein von Hand geknipstes Bild ist ab der ersten
 * Oberflächenänderung falsch, und niemand merkt es — das Bild sieht ja
 * weiterhin plausibel aus. Bei den Symbolen hat dieser Fehlertyp das Projekt
 * dreimal getroffen; bei Bildschirmfotos wäre es derselbe Fehler mit einem
 * größeren Bild.
 *
 * Deshalb fährt dieses Skript die Anwendung wirklich an, stellt über
 * `window.__ravia` einen **festgelegten** Zustand her und nimmt auf. Jeder
 * Zustand steht unten als Eintrag mit Namen, Titel, Ausschnitt und Aufbau —
 * wer ein Bild ändern will, ändert den Aufbau und läuft das Skript neu.
 *
 * Ausgabe:
 *   `/home/claude/handbuch/bilder/<name>.png`  — die Aufnahmen
 *   `/home/claude/handbuch/bilder.json`        — Titel, Maße und Hinweis je Bild
 *
 * Der Handbuchbau setzt sie dort ein, wo `<!--BILD:name-->` steht.
 *
 * Aufruf:
 *   RAVIA_PROBE=http://localhost:4188/Cad_light/ node scripts/handbuch-bilder.mjs
 */

import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

/**
 * Unter welcher Adresse aufgenommen wird — wie bei den Rauchtests über
 * `RAVIA_PROBE` umstellbar, damit auch ein Build für einen Unterpfad
 * aufgenommen werden kann. Der abschließende Schrägstrich gehört dazu.
 */
const BASIS = process.env.RAVIA_PROBE ?? 'http://localhost:4177/';

const AUSGABE = '/home/claude/handbuch/bilder';
const VERZEICHNIS = '/home/claude/handbuch/bilder.json';

/**
 * Fensterbreite und damit die Breite jeder Vollaufnahme.
 *
 * Die Bilder wandern als data:-URI **in** das Handbuch; jedes Kilobyte steht
 * am Ende in der einen Datei, die jemand herunterlädt. Deshalb wird in der
 * Zielbreite aufgenommen und nicht nachträglich skaliert — Skalieren kostet
 * Schärfe und spart nichts, was die Aufnahme nicht schon sparen könnte.
 * Wächst das Handbuch über rund 6 MB, gehört hier 1100 hin.
 *
 * 1400 liegt bewusst weit über 1024: darunter schaltet die Anwendung auf das
 * schmale Layout mit der Inspektor-Schublade um, und das ist eine andere
 * Oberfläche als die, die das Handbuch beschreibt.
 */
const FENSTER = { width: 1400, height: 900 };

/** Aufnahme des ganzen Fensters. */
const FENSTERBILD = { art: 'fenster' };
/** Aufnahme eines Rechtecks, das erst zur Laufzeit feststeht. */
const rechteck = (ermittle) => ({ art: 'rechteck', ermittle });

/**
 * Aufnahme nur des Inspektors — unten abgeschnitten, wo der Inhalt endet.
 *
 * Der Inspektor ist so hoch wie das Fenster; sein Inhalt ist es meist nicht.
 * Das ganze Element aufzunehmen hieße, in jedes dieser Bilder ein paar
 * hundert Bildpunkte leere Fläche zu packen — im Handbuch als Loch sichtbar
 * und in der Dateigröße bezahlt. Läuft der Inhalt über, bleibt es bei der
 * vollen Höhe; dann ist das Abgeschnittene echter Inhalt und kein Leerraum.
 */
const INSPEKTOR = rechteck(async (p) =>
  p.evaluate(() => {
    const aside = document.querySelector('aside');
    if (!aside) throw new Error('Inspektor nicht gefunden');
    const r = aside.getBoundingClientRect();
    // Nicht `scrollHeight`: der ist bei kurzem Inhalt gleich der vollen Höhe
    // des Kastens und verriete nichts. Gemessen wird, wo das letzte Kind
    // aufhört — läuft es über den unteren Rand hinaus, greift `Math.min`.
    const rollend = aside.lastElementChild;
    const kinder = [...rollend.children];
    const unten = kinder.length
      ? Math.max(...kinder.map((k) => k.getBoundingClientRect().bottom))
      : rollend.getBoundingClientRect().bottom;
    return {
      x: r.x,
      y: r.y,
      width: r.width,
      height: Math.min(r.height, Math.ceil(unten - r.top) + 6),
    };
  }),
);

// ---------------------------------------------------------------------------
// Kleine Helfer
// ---------------------------------------------------------------------------

/** Kurz warten — die Anwendung zeichnet vieles erst im nächsten Rahmen. */
const ruhe = (p, ms = 500) => p.waitForTimeout(ms);

/** Lesender Zugriff auf den Speicher. */
const lies = (p, fn) => p.evaluate(fn);

/** Eine Aktion des Speichers auslösen. */
const tu = async (p, fn, ms = 500, arg) => {
  await p.evaluate(fn, arg);
  await ruhe(p, ms);
};

/** Den Beispielgrundriss laden und in den Fachplanermodus stellen. */
const grundstellung = async (p) => {
  await tu(p, () => {
    const s = window.__ravia.getState();
    s.loadDemo();
    s.setUiMode('profi');
    s.setViewMode('2d');
    s.setSelection(null);
  }, 800);
};

/** Einen Reiter des Inspektors öffnen. */
const reiter = async (p, name) => {
  await p.locator('aside').getByRole('button', { name, exact: true }).click();
  await ruhe(p, 600);
};

// ---------------------------------------------------------------------------
// Die Zustände
// ---------------------------------------------------------------------------
// Jeder Eintrag beschreibt **einen** Zustand vollständig. Die Reihenfolge ist
// nicht beliebig: die Liste läuft in einer Sitzung durch, und was ein Eintrag
// am Modell ändert, nimmt der nächste vor. Wo ein Eintrag eine Änderung nur
// für sein Bild braucht (der Befund in der Prüfung), nimmt er sie am Ende
// selbst zurück — sonst stünde sie auf jedem folgenden Bild.

const ZUSTAENDE = [
  {
    name: 'oberflaeche',
    titel: 'Der Bildschirm im Überblick',
    hinweis:
      'Der Beispielgrundriss im Fachplanermodus: links die Werkzeugleiste, in der Mitte die Zeichenfläche, '
      + 'rechts der Inspektor, unten die Statuszeile.',
    bildausschnitt: FENSTERBILD,
    aufbau: async (p) => {
      await grundstellung(p);
      await reiter(p, 'Start');
    },
  },
  {
    name: 'werkzeugleiste',
    titel: 'Die Werkzeugleiste',
    hinweis:
      'Alle Werkzeuge des Fachplanermodus von oben nach unten, darunter die Schalter für Fang, '
      + 'Ortho-Zwang, Hilfslinien und Rückgängig.',
    // Die Leiste ist das einzige Element mit dieser festen Breite; über die
    // Klasse gefunden und nicht über die Position, damit ein geändertes
    // Layout hier scheitert statt ein falsches Rechteck aufzunehmen.
    bildausschnitt: rechteck(async (p) => {
      const kasten = await p.locator('div[class*="w-[52px]"]').first().boundingBox();
      if (!kasten) throw new Error('Werkzeugleiste nicht gefunden');
      // Ein paar Bildpunkte Luft, damit der abgerundete Rand nicht angeschnitten wird.
      return { x: kasten.x - 6, y: kasten.y - 6, width: kasten.width + 12, height: kasten.height + 12 };
    }),
    aufbau: async () => {},
  },
  {
    name: 'einfacher-modus',
    titel: 'Derselbe Grundriss im einfachen Modus',
    hinweis:
      'Im einfachen Modus bleiben Werkzeuge und Reiter stehen, die für das Aufmaß gebraucht werden. '
      + 'Am Modell ändert der Umschalter nichts — nur daran, wie viel gleichzeitig sichtbar ist.',
    bildausschnitt: FENSTERBILD,
    aufbau: async (p) => {
      await tu(p, () => window.__ravia.getState().setUiMode('einfach'), 700);
    },
    // Der einfache Modus gilt nur für dieses eine Bild.
    aufraeumen: async (p) => {
      await tu(p, () => window.__ravia.getState().setUiMode('profi'), 600);
    },
  },
  {
    name: 'raumbuch',
    titel: 'Das Raumbuch',
    hinweis:
      'Der Reiter „Räume“ führt alle erkannten Räume in einer Tabelle — Name, Nutzung, Fläche und Höhe '
      + 'lassen sich hier ändern, ohne Raum für Raum im Plan anzuklicken.',
    bildausschnitt: INSPEKTOR,
    aufbau: async (p) => {
      await reiter(p, 'Räume');
    },
  },
  {
    name: 'oeffnung-eigenschaften',
    titel: 'Die Eigenschaften einer Tür',
    hinweis:
      'Eine ausgewählte Tür im Reiter „Objekt“: Breite, Höhe, Brüstung und Anschlag stehen als Zahlen da '
      + 'und gehen unverändert in Plan, Rechnung und Export.',
    bildausschnitt: INSPEKTOR,
    aufbau: async (p) => {
      const gewaehlt = await lies(p, () => {
        const s = window.__ravia.getState();
        const tuer = Object.values(s.doc.openings).find((o) => o.kind === 'door');
        if (!tuer) return null;
        s.setSelection({ kind: 'opening', id: tuer.id });
        return tuer.id;
      });
      if (!gewaehlt) throw new Error('Keine Tür im Beispielgrundriss');
      await ruhe(p, 400);
      await reiter(p, 'Objekt');
    },
  },
  {
    name: 'pruefung',
    titel: 'Die Prüfung meldet einen Befund',
    hinweis:
      'Ein Fenster ist breiter gemacht worden als die Wand, in der es sitzt. Die Prüfung nennt den Befund, '
      + 'das betroffene Bauteil und den Weg, ihn zu beheben.',
    bildausschnitt: INSPEKTOR,
    aufbau: async (p) => {
      // Ein Befund muss her, und er muss **echt** sein: statt einer
      // erfundenen Meldung wird ein Fenster tatsächlich breiter gemacht als
      // seine Wand. Was die Prüfung darauf sagt, sagt sie dem Leser auch.
      const gemerkt = await lies(p, () => {
        const s = window.__ravia.getState();
        const d = s.doc;
        const fenster = Object.values(d.openings).find((o) => o.kind === 'window' && o.wallId);
        if (!fenster) return null;
        const wand = d.walls[fenster.wallId];
        const a = d.nodes[wand.a];
        const b = d.nodes[wand.b];
        const laenge = Math.hypot(b.x - a.x, b.y - a.y);
        s.setSelection(null);
        s.updateOpening(fenster.id, { width: Math.round((laenge + 0.8) * 100) / 100 });
        return { id: fenster.id, breite: fenster.width };
      });
      if (!gemerkt) throw new Error('Kein wandgebundenes Fenster im Beispielgrundriss');
      await ruhe(p, 700);
      await reiter(p, 'Prüfung');
      return gemerkt;
    },
    // Der Befund gehört zu diesem Bild und zu keinem anderen.
    aufraeumen: async (p, gemerkt) => {
      await tu(p, ({ id, breite }) => window.__ravia.getState().updateOpening(id, { width: breite }), 500, gemerkt);
    },
  },
  {
    name: 'durchbruch-plan',
    titel: 'Ein Durchbruch im Plan',
    hinweis:
      'Ein Durchbruch ist im Plan ein gekreuztes Feld; die Fahne darüber trägt Maß und Höhe über '
      + 'Fertigfußboden. Aufgenommen ist die voreingestellte Durchbruchart auf der längsten Wand '
      + 'des Beispielgrundrisses.',
    bildausschnitt: rechteck(async (p) => {
      const kasten = await p.locator('canvas').first().boundingBox();
      if (!kasten) throw new Error('Zeichenfläche nicht gefunden');
      // Ein Ausschnitt um die Mitte, denn dorthin wurde vorher gezoomt.
      const breite = Math.min(620, kasten.width);
      const hoehe = Math.min(430, kasten.height);
      return {
        x: kasten.x + (kasten.width - breite) / 2,
        y: kasten.y + (kasten.height - hoehe) / 2,
        width: breite,
        height: hoehe,
      };
    }),
    aufbau: async (p) => {
      const gesetzt = await lies(p, () => {
        const s = window.__ravia.getState();
        const d = s.doc;
        // Die längste Wand des Geschosses — dort ist Platz, und der Durchbruch
        // steht nicht zufällig auf einer Ecke.
        const waende = Object.values(d.walls).filter((w) => w.levelId === d.activeLevelId);
        let beste = null;
        for (const w of waende) {
          const a = d.nodes[w.a];
          const b = d.nodes[w.b];
          const laenge = Math.hypot(b.x - a.x, b.y - a.y);
          if (!beste || laenge > beste.laenge) beste = { w, a, b, laenge };
        }
        if (!beste) return null;
        const abstand = beste.laenge / 2;
        const preset = s.durchbruchPreset;
        const db = s.addDurchbruch(preset, { wallId: beste.w.id, distance: abstand });
        if (!db) return null;
        const t = abstand / beste.laenge;
        const mitte = {
          x: beste.a.x + (beste.b.x - beste.a.x) * t,
          y: beste.a.y + (beste.b.y - beste.a.y) * t,
        };
        // Nah genug heran, dass Symbol und Beschriftung lesbar sind.
        s.setViewport({ zoom: 220, center: mitte });
        return db.id;
      });
      if (!gesetzt) throw new Error('Durchbruch ließ sich nicht setzen');
      await ruhe(p, 900);
    },
    aufraeumen: async (p) => {
      // Der Durchbruch bleibt stehen — er gehört ab hier zum Modell und
      // stört die folgenden Bilder nicht. Nur die Ansicht kommt zurück.
      await tu(p, () => {
        const s = window.__ravia.getState();
        s.setSelection(null);
        s.setViewport({ zoom: 89, center: { x: 5, y: 3.75 } });
      }, 500);
    },
  },
  {
    name: 'dreidimensional',
    titel: 'Das Modell in drei Dimensionen',
    hinweis:
      'Dieselben Daten als Körper: Wände mit ihrer wirklichen Stärke, Öffnungen als Aussparungen, '
      + 'Räume mit ihrer Höhe. Die Ansicht wird gedreht, nicht neu gezeichnet.',
    bildausschnitt: FENSTERBILD,
    aufbau: async (p) => {
      await tu(p, () => {
        const s = window.__ravia.getState();
        s.setViewMode('3d');
        s.setCameraMode('orbit');
      }, 600);
      // Der 3D-Viewer wird nachgeladen und braucht danach ein paar Rahmen,
      // bis Geometrie und Licht stehen. Ohne dieses Warten fotografiert man
      // den Ladezustand.
      await p.waitForSelector('canvas', { timeout: 30000 });
      await ruhe(p, 3500);
    },
  },
  {
    name: 'begehen',
    titel: 'Begehen — der Blick aus Augenhöhe',
    hinweis:
      'Im Begehmodus steht die Kamera auf Augenhöhe im Raum. Türhöhen, Brüstungen und Durchgangsbreiten '
      + 'lassen sich so beurteilen, wie sie später erlebt werden.',
    bildausschnitt: FENSTERBILD,
    aufbau: async (p) => {
      await tu(p, () => window.__ravia.getState().setCameraMode('walk'), 600);
      await ruhe(p, 2500);
    },
    aufraeumen: async (p) => {
      await tu(p, () => {
        const s = window.__ravia.getState();
        s.setCameraMode('orbit');
        s.setViewMode('2d');
      }, 800);
    },
  },
  {
    name: 'anlage',
    titel: 'Die ausgelegte Anlage',
    hinweis:
      'Der Reiter „Anlage“ rechnet aus der Heizlast die erforderliche Leistung, schlägt Geräte vor und '
      + 'führt zu jedem, was für und was gegen es spricht. Hier ist der erste Vorschlag übernommen.',
    bildausschnitt: INSPEKTOR,
    aufbau: async (p) => {
      await reiter(p, 'Anlage');
      // Ohne gewähltes Gerät zeigt der Reiter nur den Überschlag; das Bild
      // soll die ausgelegte Anlage zeigen, also wird der erste — und damit
      // bestbewertete — Vorschlag übernommen.
      const geraet = p
        .locator('aside')
        .locator('button')
        .filter({ hasText: /^(Monoblock|Split|Sole|Wasser|Innenaufstellung)/ })
        .first();
      if (await geraet.count()) {
        await geraet.click();
        await ruhe(p, 900);
      }
    },
  },
  {
    name: 'schema',
    titel: 'Das Anlagenschema',
    hinweis:
      'Aus der ausgelegten Anlage entsteht das Fließbild: Erzeuger, Speicher, Kreise und Armaturen mit '
      + 'den Symbolen der Norm. Es wird erzeugt, nicht gezeichnet.',
    bildausschnitt: FENSTERBILD,
    aufbau: async (p) => {
      const erzeugen = p.getByRole('button', { name: /Schema erzeugen/ }).first();
      if (await erzeugen.count()) {
        await erzeugen.click();
        await ruhe(p, 1200);
      }
      await tu(p, () => window.__ravia.getState().setViewMode('schema'), 1200);
    },
    aufraeumen: async (p) => {
      await tu(p, () => window.__ravia.getState().setViewMode('2d'), 800);
    },
  },
  {
    name: 'druckdialog',
    titel: 'Der Druckdialog',
    hinweis:
      'Maßstab, Blattgröße und was auf dem Blatt steht — links gewählt, rechts sofort als Vorschau. '
      + 'Was hier zu sehen ist, kommt so aus dem Drucker.',
    bildausschnitt: FENSTERBILD,
    aufbau: async (p) => {
      await p.getByTitle(/maßstäblich drucken/).click();
      await ruhe(p, 1400);
    },
    aufraeumen: async (p) => {
      const zu = p.getByTitle('Schließen').first();
      if (await zu.count()) await zu.click();
      await ruhe(p, 400);
    },
  },
];

// ---------------------------------------------------------------------------
// Aufnehmen
// ---------------------------------------------------------------------------

mkdirSync(AUSGABE, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
// `deviceScaleFactor: 1` ist keine Sparsamkeit am falschen Ende: bei 2 wiegt
// jedes Bild das Vierfache, und das Handbuch ist eine einzige Datei, die
// jemand herunterlädt.
const seite = await browser.newPage({ viewport: FENSTER, deviceScaleFactor: 1 });

const fehler = [];
seite.on('pageerror', (e) => fehler.push('PAGEERROR: ' + e.message));
seite.on('dialog', (d) => d.accept());

// Die Einführung beim allerersten Start legt sich über die Oberfläche und
// wäre auf jedem Bild zu sehen. Sie hat ein eigenes Kapitel und gehört nicht
// vor den Grundriss.
await seite.addInitScript(() => {
  localStorage.setItem('ravia-ui-mode', 'profi');
  localStorage.setItem('ravia-einfuehrung', '1');
});

await seite.goto(BASIS, { waitUntil: 'networkidle' });
await seite.waitForFunction(() => typeof window.__ravia !== 'undefined', null, { timeout: 30000 });
await seite.waitForTimeout(1200);

const verzeichnis = {};
const misslungen = [];

for (const z of ZUSTAENDE) {
  const ziel = `${AUSGABE}/${z.name}.png`;
  try {
    const merkzettel = await z.aufbau(seite);

    let bild;
    if (z.bildausschnitt.art === 'fenster') {
      bild = await seite.screenshot({ path: ziel });
    } else {
      const clip = await z.bildausschnitt.ermittle(seite);
      bild = await seite.screenshot({ path: ziel, clip });
    }

    if (z.aufraeumen) await z.aufraeumen(seite, merkzettel);

    // Die Maße stehen im Verzeichnis, damit der Handbuchbau sie nicht aus dem
    // PNG lesen muss und damit auffällt, wenn ein Bild plötzlich anders
    // ausfällt als beim letzten Lauf.
    const kopf = bild.subarray(16, 24);
    const breite = kopf.readUInt32BE(0);
    const hoehe = kopf.readUInt32BE(4);
    verzeichnis[z.name] = { titel: z.titel, datei: `bilder/${z.name}.png`, breite, hoehe, hinweis: z.hinweis };
    console.log(`  ✓ ${z.name.padEnd(22)} ${String(breite).padStart(5)} × ${String(hoehe).padStart(4)} px   ${(statSync(ziel).size / 1024).toFixed(0)} KB`);
  } catch (e) {
    // Ein Zustand, der sich nicht herstellen lässt, wird **weggelassen** und
    // nicht erfunden. Der Handbuchbau meldet die Marke danach als offen —
    // besser eine gemeldete Lücke als ein Bild, das etwas anderes zeigt.
    misslungen.push(`${z.name}: ${e.message}`);
    console.log(`  ✗ ${z.name.padEnd(22)} ${e.message}`);
  }
}

writeFileSync(VERZEICHNIS, JSON.stringify(verzeichnis, null, 2) + '\n', 'utf-8');
await browser.close();

const gesamt = Object.keys(verzeichnis).reduce((s, n) => s + statSync(`${AUSGABE}/${n}.png`).size, 0);
console.log(`\n  ${Object.keys(verzeichnis).length} Bilder · ${(gesamt / 1024 / 1024).toFixed(2)} MB · ${VERZEICHNIS}`);
if (fehler.length) console.log(`  Hinweis: ${fehler.length} Fehler auf der Seite: ${fehler.slice(0, 3).join(' | ')}`);
if (misslungen.length) {
  console.log(`  ✗ ${misslungen.length} Zustand/Zustände nicht herstellbar:`);
  for (const m of misslungen) console.log(`      ${m}`);
  process.exit(1);
}
