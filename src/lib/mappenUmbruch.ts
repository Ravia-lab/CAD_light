/**
 * Textblätter der Projektmappe auf Druckseiten umbrechen.
 * ---------------------------------------------------------------------------
 * **Der Befund (07.10.2026, Prüfrunde 2).** Die Mappe des Bungalows A01
 * nannte auf jedem Blatt „Blatt n von 46" — gedruckt waren es 61 Seiten. Ein
 * Anlagenbuchkapitel, die Inbetriebnahme oder die Objektaufnahme ist länger
 * als eine Seite; der Browser brach es um, und die Fortsetzung stand ohne
 * Kopfzeile da, also ohne Projekt, ohne Blattnummer, nicht mehr zuordenbar.
 * Das Inhaltsverzeichnis verwies auf Blattnummern, die es im Ausdruck so
 * nicht gab.
 *
 * **Was hier passiert.** Ein Textblatt wird in Blöcke zerlegt — Überschrift,
 * Absatz, Liste, Tabelle, Tabellenzeile —, ihre Höhe wird geschätzt, und die
 * Blöcke werden auf Seiten verteilt. Jede Seite wird ein eigenes Blatt mit
 * Kopfzeile und Nummer; Tabellen tragen auf der Fortsetzung ihren Kopf
 * wieder. Eine Überschrift bleibt bei dem, was sie überschreibt.
 *
 * **Warum geschätzt und nicht gemessen.** Die Blattnummern stehen im
 * Inhaltsverzeichnis und müssen beim Bau der Mappe feststehen; der Kern hat
 * kein DOM. (Bis 1.74.0 schätzte `zeilenBudget` eine feste Zeilenzahl je
 * Blatt; die Schätzung hier ersetzt es.) Geschätzt wird
 * **vorsichtig** — mit der Zeichenbreite einer breiten Ersatzschrift und
 * einem Sicherheitsabstand. Eine Seite, die etwas leerer bleibt als nötig,
 * ist der kleinere Fehler; eine, die überläuft, ist genau der, um den es
 * hier geht. Der Rauchtest `smoke-mappe` druckt die Mappe als PDF und
 * vergleicht die Seitenzahl mit der Blattzahl.
 */

const PT = 0.3528; // mm je Punkt
const ZEILE = 1.45; // Zeilenhöhe als Vielfaches der Schriftgröße
/**
 * Mittlere Zeichenbreite als Anteil der Schriftgröße. Segoe UI liegt bei
 * etwa 0,50, DejaVu Sans — die Ersatzschrift ohne Segoe — bei 0,56 bis 0,60.
 * Gerechnet wird mit der breiten, damit die Schätzung auf jedem Rechner hält.
 */
const ZEICHEN = 0.58;

/** Schriftmaße eines Zusammenhangs: Mappe selbst oder eingebettetes Anlagenbuch. */
export interface Satzmass {
  grund: number; // pt
  tabelle: number; // pt
  zellenrand: number; // mm oben + unten je Zelle
  h2Abstand: number; // mm unter h2
  h3Abstand: number; // mm über + unter h3
}

// Der Abstand über h3 fällt mit dem unteren Rand des vorigen Absatzes
// zusammen (Randverschmelzung); gezählt wird, was davon übrig bleibt.
export const MAPPE_SATZ: Satzmass = { grund: 9, tabelle: 8, zellenrand: 2, h2Abstand: 3, h3Abstand: 4.5 };
export const BUCH_SATZ: Satzmass = { grund: 9.5, tabelle: 8.5, zellenrand: 2.2, h2Abstand: 4, h3Abstand: 5.5 };

const zeilenhoehe = (pt: number): number => pt * PT * ZEILE;
const zeichenbreite = (pt: number): number => pt * PT * ZEICHEN;

function entity(t: string): string {
  return t
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

const reinerText = (html: string): string => entity(html.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();

/** Zeilen, die ein Text in einer Spalte der Breite `breite` [mm] belegt. */
function zeilen(text: string, breite: number, pt: number): number {
  if (!text) return 0;
  const proZeile = Math.max(4, Math.floor(breite / zeichenbreite(pt)));
  // Umbrochen wird an Wortgrenzen; ein Wort, das nicht mehr passt, kostet
  // im Mittel eine halbe Zeile Rest. Deshalb Wort für Wort gezählt.
  let n = 1;
  let belegt = 0;
  for (const wort of text.split(' ')) {
    const l = wort.length;
    if (belegt === 0) belegt = l;
    else if (belegt + 1 + l <= proZeile) belegt += 1 + l;
    else {
      n += 1;
      belegt = l;
    }
    while (belegt > proZeile) {
      n += 1;
      belegt -= proZeile;
    }
  }
  return n;
}

// ---------------------------------------------------------------------------
// Zerlegen
// ---------------------------------------------------------------------------

/** Markierung einer Fußzeile im Zeilenstrom — wird beim Zusammensetzen entfernt. */
const FUSS = '\u0000fuss';

const LEER = new Set(['br', 'hr', 'img', 'meta', 'input', 'col', 'wbr']);

/**
 * Die Elemente oberster Ebene eines HTML-Bruchstücks. Text zwischen ihnen
 * (nur Leerraum in dieser Mappe) fällt weg. Das HTML stammt aus diesem
 * Programm und ist wohlgeformt; ein allgemeiner Parser wäre hier Ballast.
 */
export function bloecke(html: string): string[] {
  const out: string[] = [];
  const marke = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/?)>/g;
  let tiefe = 0;
  let start = -1;
  let m: RegExpExecArray | null;
  while ((m = marke.exec(html))) {
    const name = m[1].toLowerCase();
    const schliessend = m[0].startsWith('</');
    const leer = LEER.has(name) || m[2] === '/';
    if (!schliessend) {
      if (tiefe === 0) start = m.index;
      if (leer) {
        if (tiefe === 0) out.push(html.slice(start, marke.lastIndex));
        continue;
      }
      tiefe += 1;
    } else {
      tiefe -= 1;
      if (tiefe === 0 && start >= 0) {
        out.push(html.slice(start, marke.lastIndex));
        start = -1;
      }
    }
  }
  return out;
}

const tagVon = (block: string): string => /^<([a-zA-Z0-9]+)/.exec(block)?.[1].toLowerCase() ?? '';
const klasseVon = (block: string): string => /^<[^>]*\bclass="([^"]*)"/.exec(block)?.[1] ?? '';

// ---------------------------------------------------------------------------
// Höhen
// ---------------------------------------------------------------------------

interface Tabelle {
  oeffnung: string; // `<table …>` samt `<colgroup>`, ohne Kopf
  kopf: string; // `<thead>…</thead>` oder ''
  zeilen: string[]; // die `<tr>` des Rumpfs
  breiten: (number | undefined)[]; // Spaltenbreiten [mm], undefined = frei
}

export function zerlegeTabelle(html: string): Tabelle {
  const oeffnung = /^<table\b[^>]*>/.exec(html)?.[0] ?? '<table>';
  const kopf = /<thead\b[\s\S]*?<\/thead>/.exec(html)?.[0] ?? '';
  const rumpf = /<tbody\b[^>]*>([\s\S]*?)<\/tbody>/.exec(html)?.[1] ?? html.replace(/^<table\b[^>]*>|<\/table>$/g, '').replace(kopf, '');
  // Der Tabellenfuß (Summenzeile) läuft als letzte Zeile mit; sie trägt die
  // Klasse `fuss`, damit sie wieder in einen `<tfoot>` kommt.
  const fuss = /<tfoot\b[^>]*>([\s\S]*?)<\/tfoot>/.exec(html)?.[1] ?? '';
  const zeilenListe = [
    ...bloecke(rumpf).filter((b) => tagVon(b) === 'tr'),
    ...bloecke(fuss).filter((b) => tagVon(b) === 'tr').map((tr) => `${FUSS}${tr}`),
  ];
  const kopfzellen = kopf ? [...kopf.matchAll(/<th\b([^>]*)>/g)].map((x) => x[1]) : [];
  const breiten = kopfzellen.map((attr) => {
    const w = /width:\s*([\d.]+)mm/.exec(attr);
    return w ? Number(w[1]) : undefined;
  });
  return { oeffnung, kopf, zeilen: zeilenListe, breiten };
}

/** Höhe einer Zelle: Haupttext plus Fußnoten, jeweils in ihrer Schriftgröße. */
function zellenhoehe(zelle: string, breite: number, pt: number): number {
  const innen = Math.max(8, breite - 4);
  let h = 0;
  // Fußnoten (`div.fussnote`, `span.einheit`) in 7,5 pt, je mit kleinem Abstand.
  const fuss = [...zelle.matchAll(/<(div|span)\b[^>]*class="(?:fussnote|einheit)"[^>]*>([\s\S]*?)<\/\1>/g)];
  let haupt = zelle;
  for (const f of fuss) {
    haupt = haupt.replace(f[0], ' ');
    h += zeilen(reinerText(f[2]), innen, 7.5) * zeilenhoehe(7.5) + 0.5;
  }
  // Harte Umbrüche (`<br>`) zählen als eigene Zeilen.
  for (const teil of haupt.split(/<br\s*\/?>/)) h += zeilen(reinerText(teil), innen, pt) * zeilenhoehe(pt);
  if (/class="kasten"/.test(zelle)) h = Math.max(h, 4.5);
  return h;
}

const zellenVon = (tr: string): RegExpMatchArray[] => [...tr.matchAll(/<(td|th)\b([^>]*)>([\s\S]*?)<\/\1>/g)];

/**
 * Breiten der freien Spalten wie das automatische Tabellenlayout: anteilig
 * zur längsten Zeile ihres Inhalts, mindestens 14 mm. Gleich verteilt hieße,
 * einer Spalte „Nr." dieselbe Breite zu geben wie dem Hinweistext daneben.
 */
export function verteileBreiten(t: Tabelle, gesamt: number, pt = 8): number[] {
  const spalten = Math.max(t.breiten.length, ...t.zeilen.map((tr) => zellenVon(tr).length), 1);
  const laenge = new Array<number>(spalten).fill(1);
  // Längstes Wort je Spalte: schmaler wird keine Spalte (min-content).
  const wort = new Array<number>(spalten).fill(1);
  for (const tr of [t.kopf, ...t.zeilen]) {
    const zellen = zellenVon(tr);
    if (zellen.some((z) => /colspan=/.test(z[2]))) continue;
    zellen.forEach((z, i) => {
      const text = reinerText(z[3]);
      wort[i] = Math.max(wort[i], ...text.split(' ').map((w) => w.length));
      if (tr === t.kopf) return;
      laenge[i] = Math.max(laenge[i], ...z[3].split(/<br\s*\/?>|<div\b/).map((teil) => reinerText(teil).length));
    });
  }
  const mindest = (i: number): number => Math.max(14, wort[i] * zeichenbreite(pt) * 1.08 + 4);
  const fest = t.breiten.reduce<number>((s, b) => s + (b ?? 0), 0);
  const frei = [...Array(spalten).keys()].filter((i) => t.breiten[i] === undefined);
  const rest = Math.max(14 * frei.length, gesamt - fest);
  // Wie das automatische Tabellenlayout: Eine Spalte, deren längster Eintrag
  // schmaler ist als ihr Anteil, bekommt genau so viel, wie er braucht; der
  // Rest geht anteilig an die Spalten mit langem Text.
  const bedarf = (i: number): number => Math.max(mindest(i), laenge[i] * zeichenbreite(pt) + 4);
  const breite = new Map<number, number>();
  let offen = [...frei];
  let verfuegbar = rest;
  for (;;) {
    const summe = offen.reduce((s, i) => s + laenge[i], 0) || 1;
    const schmal = offen.filter((i) => bedarf(i) <= (verfuegbar * laenge[i]) / summe);
    if (!schmal.length || schmal.length === offen.length) {
      for (const i of offen) breite.set(i, Math.max(mindest(i), schmal.length === offen.length ? bedarf(i) : (verfuegbar * laenge[i]) / summe));
      break;
    }
    for (const i of schmal) {
      breite.set(i, bedarf(i));
      verfuegbar -= bedarf(i);
    }
    offen = offen.filter((i) => !schmal.includes(i));
  }
  return [...Array(spalten).keys()].map((i) => t.breiten[i] ?? breite.get(i) ?? 14);
}

function zeilenhoeheTabelle(tr: string, t: Tabelle, gesamt: number, pt: number, rand: number, breiten?: number[]): number {
  const zellen = zellenVon(tr);
  const b = breiten ?? verteileBreiten(t, gesamt, pt);
  let spalte = 0;
  let h = 0;
  for (const z of zellen) {
    const span = Number(/colspan="(\d+)"/.exec(z[2])?.[1] ?? 1);
    let breite = 0;
    for (let i = 0; i < span; i++) breite += b[spalte + i] ?? gesamt / zellen.length;
    spalte += span;
    h = Math.max(h, zellenhoehe(z[3], breite, pt));
  }
  return h + rand + 0.3;
}

/**
 * Höhe eines Blocks [mm] einschließlich seines Abstands nach unten.
 */
export function blockhoehe(block: string, breite: number, satz: Satzmass): number {
  const tag = tagVon(block);
  const klasse = klasseVon(block);
  const text = reinerText(block);
  const lh = zeilenhoehe(satz.grund);
  if (klasse.includes('blattkopf') || /display:\s*none/.test(block.slice(0, 120))) return 0;
  switch (tag) {
    case 'h1':
      return zeilen(text, breite, 20) * 20 * PT * 1.2 + 2;
    case 'h2':
      return zeilen(text, breite, 13) * zeilenhoehe(13) + satz.h2Abstand;
    case 'h3':
      return zeilen(text, breite, 10) * zeilenhoehe(10) + satz.h3Abstand;
    case 'p': {
      if (klasse.includes('hinweiskasten')) return zeilen(text, Math.min(230, breite) - 5, satz.grund) * lh + 9;
      if (klasse.includes('schluss')) return zeilen(text, breite, 7.5) * zeilenhoehe(7.5) + 10;
      const fuss = klasse.includes('fussnote');
      const pt = fuss ? 7.5 : satz.grund;
      return zeilen(text, Math.min(230, breite), pt) * zeilenhoehe(pt) + (fuss ? 1 : 2.5);
    }
    case 'ul':
    case 'ol': {
      let h = 3;
      for (const li of block.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)) {
        h += zeilen(reinerText(li[1]), Math.min(230, breite) - 6, satz.grund) * lh + 1.2;
      }
      return h;
    }
    case 'table': {
      const t = zerlegeTabelle(block);
      const kennwerte = klasse.includes('kennwerte');
      const pt = kennwerte ? 9 : satz.tabelle;
      const rand = klasse.includes('check') ? 5.2 : satz.zellenrand;
      const gesamt = kennwerte ? Math.min(210, breite) : breite;
      if (kennwerte && !t.breiten.length) t.breiten = [52, undefined];
      const breiten = verteileBreiten(t, gesamt, pt);
      let h = 4 + (t.kopf ? zeilenhoehe(pt) + satz.zellenrand + 0.7 : 0);
      for (const tr of t.zeilen) h += zeilenhoeheTabelle(tr, t, gesamt, pt, rand, breiten);
      return h;
    }
    case 'div': {
      if (klasse.includes('unterschrift')) return 22;
      if (klasse.includes('fussnote')) return zeilen(text, breite, 7.5) * zeilenhoehe(7.5) + 0.5;
      // Unbekannter Behälter: seine Kinder zählen.
      const kinder = bloecke(block.replace(/^<div\b[^>]*>|<\/div>$/g, ''));
      if (kinder.length) return kinder.reduce((s, k) => s + blockhoehe(k, breite, satz), 0);
      return zeilen(text, breite, satz.grund) * lh;
    }
    default:
      return zeilen(text, breite, satz.grund) * lh;
  }
}

// ---------------------------------------------------------------------------
// Verteilen
// ---------------------------------------------------------------------------

export interface Umbruchmass {
  /** Nutzbare Höhe unter der Kopfzeile [mm]. */
  hoehe: number;
  /** Satzbreite [mm]. */
  breite: number;
}

interface Stueck {
  html: string;
  hoehe: number;
  /** Überschrift — bleibt beim nächsten Stück. */
  kopf: boolean;
  /** Tabellenzeile: auf einer neuen Seite braucht sie den Tabellenkopf. */
  tabelle?: { oeffnung: string; kopf: string; kopfHoehe: number; id: number };
}

/**
 * Ein Textblatt in Seiten zerlegen. Gibt die Inhalte der Seiten zurück; ein
 * Blatt, das passt, kommt unverändert als einziges Element zurück.
 */
export function umbrechen(inhalt: string, mass: Umbruchmass): string[] {
  // Eingebettetes Anlagenbuch: `<div class="anlagenbuch"><section …>` umhüllt
  // den Inhalt und muss auf jeder Seite wieder stehen, sonst greifen dessen
  // Stile nicht.
  const huelle = /^(<div class="anlagenbuch">\s*<section\b[^>]*>)([\s\S]*)(<\/section>\s*<\/div>)$/.exec(inhalt.trim());
  const satz = huelle ? BUCH_SATZ : MAPPE_SATZ;
  const kern = huelle ? huelle[2] : inhalt;
  const auf = huelle ? huelle[1] : '';
  const zu = huelle ? huelle[3] : '';

  const liste = bloecke(kern);
  const gesamt = liste.reduce((s, b) => s + blockhoehe(b, mass.breite, satz), 0);
  if (gesamt <= mass.hoehe || liste.length <= 1) return [inhalt];

  // In Stücke zerlegen: Tabellen zeilenweise, alles andere als Ganzes.
  const stuecke: Stueck[] = [];
  let tabellenNr = 0;
  for (const b of liste) {
    const tag = tagVon(b);
    if (tag === 'table') {
      const t = zerlegeTabelle(b);
      const klasse = klasseVon(b);
      const kennwerte = klasse.includes('kennwerte');
      const pt = kennwerte ? 9 : satz.tabelle;
      const rand = klasse.includes('check') ? 5.2 : satz.zellenrand;
      const breite = kennwerte ? Math.min(210, mass.breite) : mass.breite;
      if (kennwerte && !t.breiten.length) t.breiten = [52, undefined];
      const kopfHoehe = t.kopf ? zeilenhoehe(pt) + satz.zellenrand + 0.7 : 0;
      const id = tabellenNr++;
      const breiten = verteileBreiten(t, breite, pt);
      t.zeilen.forEach((tr, i) => {
        stuecke.push({
          html: tr,
          hoehe: zeilenhoeheTabelle(tr, t, breite, pt, rand, breiten) + (i === 0 ? kopfHoehe + 4 : 0),
          // Gruppen- und Herkunftszeilen überschreiben die Zeilen darunter.
          kopf: /^<tr\b[^>]*class="(?:gruppe|herkunft)"/.test(tr),
          tabelle: { oeffnung: t.oeffnung, kopf: t.kopf, kopfHoehe: kopfHoehe + 4, id },
        });
      });
      continue;
    }
    stuecke.push({ html: b, hoehe: blockhoehe(b, mass.breite, satz), kopf: tag === 'h2' || tag === 'h3' });
  }

  // Verteilen.
  const seiten: Stueck[][] = [[]];
  let belegt = 0;
  const platzFuer = (i: number): number => {
    // Eine Überschrift zählt mit dem, was ihr folgt — bis zur ersten
    // Tabellenzeile bzw. zum ersten Absatz.
    let h = stuecke[i].hoehe;
    let j = i;
    while (stuecke[j]?.kopf && stuecke[j + 1]) {
      j += 1;
      h += stuecke[j].hoehe;
    }
    return h;
  };
  for (let i = 0; i < stuecke.length; i++) {
    const s = stuecke[i];
    const seite = seiten[seiten.length - 1];
    const vorige = seite[seite.length - 1];
    const bedarf = s.kopf ? platzFuer(i) : s.hoehe;
    if (seite.length > 0 && belegt + bedarf > mass.hoehe) {
      seiten.push([]);
      belegt = 0;
      // Fortgesetzte Tabelle: Kopf und Rand kommen auf der neuen Seite dazu.
      if (s.tabelle && vorige?.tabelle?.id === s.tabelle.id) belegt += s.tabelle.kopfHoehe;
    }
    seiten[seiten.length - 1].push(s);
    belegt += s.hoehe;
  }

  /*
   * Kein Schusterjunge von Blatt: Bleiben für die letzte Seite nur wenige
   * Zeilen, und passt alles noch auf die vorletzte, wenn man deren Reserve
   * angreift, kommt es dorthin. Die Reserve (siehe `UMBRUCH_RESERVE` der
   * Mappe) ist für die Unsicherheit der Schätzung da; ein Blatt mit drei
   * Zeilen ist der sicherere Ärger.
   */
  const hoeheVon = (seite: Stueck[]): number =>
    seite.reduce((summe, st) => summe + st.hoehe, 0);
  if (seiten.length >= 2) {
    const letzte = seiten[seiten.length - 1];
    const vorletzte = seiten[seiten.length - 2];
    if (hoeheVon(letzte) <= mass.hoehe * 0.2 && hoeheVon(vorletzte) + hoeheVon(letzte) <= mass.hoehe * 1.05) {
      vorletzte.push(...letzte);
      seiten.pop();
    }
  }

  // Wieder zu HTML: aufeinanderfolgende Zeilen derselben Tabelle werden eine
  // Tabelle mit Kopf.
  const html = seiten
    .filter((seite) => seite.length)
    .map((seite) => {
      let out = '';
      let offen: number | undefined;
      for (const s of seite) {
        if (s.tabelle) {
          if (offen !== s.tabelle.id) {
            if (offen !== undefined) out += '</tbody></table>';
            out += `${s.tabelle.oeffnung}${s.tabelle.kopf}<tbody>`;
            offen = s.tabelle.id;
          }
          out += s.html.startsWith(FUSS) ? `</tbody><tfoot>${s.html.slice(FUSS.length)}</tfoot><tbody>` : s.html;
        } else {
          if (offen !== undefined) {
            out += '</tbody></table>';
            offen = undefined;
          }
          out += s.html;
        }
      }
      if (offen !== undefined) out += '</tbody></table>';
      return auf + out + zu;
    });
  return html.length ? html : [inhalt];
}

/**
 * Höhe, die eine Tabellenzeile unter dem gegebenen Tabellenkopf belegt [mm] —
 * für Kapitel, die selbst paginieren (Massenauszug), damit sie mit derselben
 * Schätzung rechnen wie der Umbruch.
 */
export function zeilenMass(oeffnung: string, kopf: string, zeile: string, breite: number, satz: Satzmass = MAPPE_SATZ): number {
  const mit = blockhoehe(`${oeffnung}${kopf}<tbody>${zeile}</tbody></table>`, breite, satz);
  const ohne = blockhoehe(`${oeffnung}${kopf}<tbody></tbody></table>`, breite, satz);
  return mit - ohne;
}
