#!/usr/bin/env python3
"""
Baut aus den Kapitelfragmenten, den Symboltafeln und dem Stilblatt **eine**
in sich geschlossene HTML-Datei.

Warum ein Generator und keine von Hand gepflegte Datei: die Kapitel entstehen
einzeln, die Symboltafeln kommen aus dem Programm, und das Inhaltsverzeichnis
muss zu beidem passen. Von Hand gepflegt liefe das nach der zweiten Änderung
auseinander — derselbe Fehlertyp, den dieses Projekt schon dreimal hatte.
"""

import html
import json
import pathlib
import re
import subprocess
import sys

# Repo-relativ, nicht absolut: Die Quelle liegt seit 1.29.0 im Projekt und
# nicht mehr in einem Verzeichnis, das mit dem Behälter verschwindet. Genau
# das ist einmal passiert — der Bau von 1.23.0 ist verloren, weil die
# Kapitelfragmente außerhalb des Projekts lagen.
HIER = pathlib.Path(__file__).resolve().parent
# Gebaut wird **dorthin, wo ausgeliefert wird**. Ein Handbuch, das neben dem
# Projekt liegt und von Hand kopiert werden muss, wird beim dritten Mal nicht
# mehr kopiert.
ZIEL = HIER.parent / 'server' / 'app' / 'handbuch.html'


def fassung() -> str:
    """
    Die Fassungsnummer — **aus `src/lib/fassung.ts`**, nicht von Hand hier.

    Bis 1.34.0 stand hier eine Zeichenkette, und sie stand auf `1.31.0`. Das
    Handbuch behauptete damit über drei Fassungen hinweg, es beschreibe einen
    Stand, den es nicht beschrieb — auf dem Deckblatt, im Seitentitel, im
    Fußtext jeder Seite. Ausgeliefert wurde das auch: Das Handbuch auf
    `ravia-tech.de/Cad_light/` trug den Aufdruck 1.31.0, während daneben
    1.32.0 lief.

    Es ist derselbe Fehler, den `scripts/pruefungen/fassung.ts` seit 1.28.0
    für Programm und Export verhindert — nur dass dieses Skript dort nicht
    mitgeprüft wurde. Jetzt gibt es die Nummer wieder nur an einem Ort, und
    der Prüfblock hält diese Datei dagegen.
    """
    quelle = (HIER.parent / 'src' / 'lib' / 'fassung.ts').read_text(encoding='utf-8')
    treffer = re.search(r"FASSUNG\s*=\s*'([0-9]+\.[0-9]+\.[0-9]+)'", quelle)
    if not treffer:
        raise SystemExit('In src/lib/fassung.ts steht keine Fassungsnummer — Abbruch.')
    return treffer.group(1)


VERSION = fassung()


def pruefungen() -> str:
    """
    Wie viele Prüfungen hinter den Zahlen stehen — **aus dem Prüflauf**, nicht
    von Hand eingetragen.

    Eine von Hand gepflegte Zahl stimmt bis zur nächsten Änderung; danach
    behauptet das Deckblatt etwas, das nicht mehr gilt. Schlimmer: Sie
    behauptet es auch dann, wenn der Prüflauf gerade rot ist. Ein Handbuch,
    das „5.140 Prüfungen" auf das Deckblatt schreibt, während zwölf davon
    fallen, ist an der ersten Zeile unglaubwürdig — deshalb bricht der Bau
    hier ab, statt eine alte Zahl weiterzureichen.
    """
    lauf = subprocess.run(
        ['npm', 'run', '--silent', 'verify'],
        cwd=HIER.parent, capture_output=True, text=True,
    )
    treffer = re.search(r'ALLE TESTS BESTANDEN — (\d+)/\1', lauf.stdout)
    if not treffer:
        letzte = [z for z in lauf.stdout.splitlines() if z.strip()][-3:]
        sys.exit('Der Prüflauf ist nicht grün — das Handbuch wird nicht gebaut.\n  '
                 + '\n  '.join(letzte))
    zahl = int(treffer.group(1))
    return f'{zahl:,}'.replace(',', '.')


PRUEFUNGEN = pruefungen()
STAND = '24.09.2026'

# ---------------------------------------------------------------------------
# 1 · Kapitel einlesen
# ---------------------------------------------------------------------------

def lies(name: str) -> str:
    p = HIER / name
    if not p.exists():
        sys.exit(f'FEHLT: {name}')
    return p.read_text(encoding='utf-8')

teile: list[str] = []
# Kapitel 13 kam einmal aus drei Lieferungen; seit die Quelle aus dem
# ausgelieferten Handbuch zurückgewonnen wurde (1.29.0), liegt es wie jedes
# andere als eine Datei da. Die Sonderbehandlung ist damit weg — sie war der
# Grund, warum sich eine Ersetzung im Deckblatt unbemerkt verlaufen konnte.
for nr in range(1, 19):
    teile.append(lies(f'kap-{nr:02d}.html'))

roh = '\n'.join(teile)

# ---------------------------------------------------------------------------
# 2 · Querverweise geraderücken
# ---------------------------------------------------------------------------
# Die Kapitel entstehen einzeln, und wer auf ein Kapitel verweist, das es noch
# nicht gibt, muss die Nummer aus der Gliederung nehmen. Zwei davon haben sich
# beim Zusammenbau verschoben. Sie werden hier zentral korrigiert und nicht in
# den Fragmenten, damit nachvollziehbar bleibt, was warum umgehängt wurde —
# und damit die Prüfung am Ende dieses Skripts es merkt, falls jemand einen
# Verweis neu einbaut.
KORREKTUREN = [
    # Kapitel 14 meinte „die offenen Punkte". Nach der endgültigen Gliederung
    # ist 18.4 die Tastentafel; die Grenzen stehen in 18.5.
    ('href="#k18-4"', 'href="#k18-5"', 'Abschnitt 18.4', 'Abschnitt 18.5'),
    # Kapitel 16 hat fünf Abschnitte, nicht sechs. Gemeint ist „Belege statt
    # Suche: wie der Bericht zitiert" — das ist 16.4.
    ('href="#k16-6"', 'href="#k16-4"', 'Abschnitt 16.6', 'Abschnitt 16.4'),
]
korrigiert = 0
for altZiel, neuZiel, altText, neuText in KORREKTUREN:
    n = roh.count(altZiel)
    if not n:
        continue
    korrigiert += n
    # Erst den Verweis, dann den sichtbaren Text daneben — eine Sprungmarke,
    # die woandershin zeigt, als der Text ankündigt, ist die schlechtere Hälfte
    # des Fehlers.
    roh = roh.replace(altZiel + '>' + altText, neuZiel + '>' + neuText)
    roh = roh.replace(altZiel, neuZiel)

# ---------------------------------------------------------------------------
# 3 · Symboltafeln einsetzen
# ---------------------------------------------------------------------------

tafeln = json.loads((HIER / 'tafeln.json').read_text(encoding='utf-8'))

def tafel_html(name: str) -> str:
    t = tafeln.get(name)
    if not t:
        return f'<p class="warnung">Symboltafel „{name}" fehlt.</p>'
    grund = t['grund']
    kacheln = []
    for k in t['kacheln']:
        spitze = f'<span class="k-spitze">{html.escape(k["spitze"])}</span>' if k.get('spitze') else ''
        text = f'<p class="k-text">{html.escape(k["text"])}</p>' if k.get('text') else ''
        kacheln.append(
            f'<figure class="kachel"><div class="k-bild">{k["svg"]}</div>'
            f'<figcaption><b>{html.escape(k["titel"])}</b>{spitze}{text}</figcaption></figure>'
        )
    return (
        f'<div class="tafel tafel-{grund}" data-tafel="{name}">'
        f'<div class="kacheln">{"".join(kacheln)}</div>'
        f'<p class="tafel-hinweis">{html.escape(t["hinweis"])}</p></div>'
    )

gesetzt = []
def ersetze(m):
    name = m.group(1)
    gesetzt.append(name)
    return tafel_html(name)

roh = re.sub(r'<!--\s*SYMBOLTAFEL:([a-z]+)\s*-->', ersetze, roh)

# ---------------------------------------------------------------------------
# 4 · Inhaltsverzeichnis aus den Überschriften
# ---------------------------------------------------------------------------

# Das sichtbare Verzeichnis führt Kapitel und Abschnitte (H2 und H3). Die
# Unterabschnitte (H4) kommen nicht hinein — es sind über vierhundert, und ein
# Verzeichnis, durch das man scrollen muss, ist keines mehr.
#
# **Gesucht wird trotzdem in allen dreien.** Wer „Ventilautorität" eintippt,
# will den Abschnitt finden, und der ist ein H4. Deshalb wird neben dem
# Verzeichnis ein Suchverzeichnis erzeugt, das alle Überschriften kennt und
# zu jeder das Kapitel mitführt, damit ein Treffer einzuordnen ist.

eintraege = []
kapitel_titel = ''
for m in re.finditer(r'<h([234])\s+id="([^"]+)"[^>]*>(.*?)</h\1>', roh, re.S):
    stufe, kennung, titel = int(m.group(1)), m.group(2), m.group(3)
    titel = re.sub(r'<[^>]+>', '', titel).strip()
    titel = html.unescape(titel)
    if stufe == 2:
        kapitel_titel = titel
    eintraege.append((stufe, kennung, titel, kapitel_titel))

toc = []
for stufe, kennung, titel, _ in eintraege:
    if stufe > 3:
        continue
    toc.append(f'<a class="toc-{stufe}" href="#{kennung}">{html.escape(titel)}</a>')

suchindex = json.dumps(
    [{'s': stufe, 'k': kennung, 't': titel, 'c': kap} for stufe, kennung, titel, kap in eintraege],
    ensure_ascii=False,
    separators=(',', ':'),
)

# ---------------------------------------------------------------------------
# 5 · Zusammenbauen
# ---------------------------------------------------------------------------

STIL = (HIER / 'stil.css').read_text(encoding='utf-8')
SKRIPT = (HIER / 'skript.js').read_text(encoding='utf-8')
DECKBLATT = (HIER / 'deckblatt.html').read_text(encoding='utf-8')

kacheln_gesamt = sum(len(t['kacheln']) for t in tafeln.values())
deckblatt = DECKBLATT

# Die Kennzahlen auf dem Deckblatt werden **ersetzt, nicht gepflegt** — und
# jede Ersetzung muss genau einmal treffen.
#
# **Warum diese Strenge.** Bis 1.23.0 suchte die Ersetzung eine Zeichenkette,
# die es im Deckblatt längst nicht mehr gab. Eine nicht gefundene Ersetzung
# meldet sich nicht; auf dem Deckblatt stand deshalb über Fassungen hinweg
# eine alte Nummer. Ein Handbuch, das seinen eigenen Stand falsch angibt, ist
# an der ersten Zeile unglaubwürdig.
def setze(text: str, muster: str, wert: str, was: str) -> str:
    treffer = re.findall(muster, text)
    if len(treffer) != 1:
        sys.exit(f'Deckblatt: „{was}" wurde {len(treffer)}-mal gefunden, erwartet genau einmal.')
    return re.sub(muster, wert, text)

deckblatt = setze(deckblatt, r'(?<=<b>Fassung )[0-9]+\.[0-9]+\.[0-9]+(?=</b>)', VERSION, 'Fassung im Fließtext')
deckblatt = setze(deckblatt, r'(?<=<div><b>)\d+(?=</b><span>Kapitel)', str(len(teile)), 'Kapitelzahl')
deckblatt = setze(deckblatt, r'(?<=<div><b>)\d+(?=</b><span>erklärte Symbole)', str(kacheln_gesamt), 'Symbolzahl')
deckblatt = setze(deckblatt, r'(?<=<div><b>)[0-9.]+(?=</b><span>Programmstand)', VERSION, 'Programmstand')
deckblatt = setze(deckblatt, r'(?<=<div><b>)[0-9.]+(?=</b><span>Prüfungen)', PRUEFUNGEN, 'Prüfungszahl')
DECKBLATT = deckblatt

seite = f"""<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Handbuch RaVia CAD Light {VERSION}</title>
<meta name="description" content="Vollständiges Handbuch zu RaVia CAD Light {VERSION}: Bedienung, Symbolik, Rechenwege, Berichte, Nachweise.">
<style>{STIL}</style>
</head>
<body>
<a class="sprung" href="#inhalt">Zum Inhalt</a>
<header class="kopf">
  <button class="menue" id="menue" aria-label="Inhaltsverzeichnis ein- und ausblenden">☰</button>
  <div class="kopf-titel"><b>Handbuch</b> RaVia CAD Light <span class="fassung">{VERSION}</span></div>
  <div class="suche"><input id="suchfeld" type="search" placeholder="Im Inhalt suchen …" autocomplete="off" aria-label="Im Inhaltsverzeichnis suchen"><span id="treffer" class="treffer"></span></div>
</header>
<div class="rahmen">
<nav class="toc" id="toc" aria-label="Inhaltsverzeichnis">
  <div id="verzeichnis">
    <a class="toc-0" href="#deckblatt">Titel und Hinweise</a>
    {''.join(toc)}
  </div>
  <div id="ergebnisse" hidden></div>
</nav>
<main id="inhalt">
{DECKBLATT}
{roh}
<footer class="fuss">
  <p>RaVia CAD Light {VERSION} · Handbuchstand {STAND}</p>
  <p>Dieses Handbuch beschreibt den Programmstand {VERSION}. Jede Formel darin ist die, die im Programm läuft; jede Zahl trägt ihre Herkunft. Wo eine Angabe nicht belegt werden konnte, steht das ausdrücklich dabei.</p>
</footer>
</main>
</div>
<script>window.__HANDBUCH_INDEX = {suchindex};</script>
<script>{SKRIPT}</script>
</body>
</html>
"""

ZIEL.write_text(seite, encoding='utf-8')

# ---------------------------------------------------------------------------
# 6 · Nachzählen — packen ist kein Nachweis
# ---------------------------------------------------------------------------

text = seite
kapitel = len(re.findall(r'<section id="kap-\d+"', text))
h2 = len(re.findall(r'<h2 ', text))
suchbar = len(eintraege)
h3 = len(re.findall(r'<h3 ', text))
h4 = len(re.findall(r'<h4 ', text))
kacheln = len(re.findall(r'<figure class="kachel">', text))
tabellen = len(re.findall(r'<table', text))
formeln = len(re.findall(r'class="formel"', text))
beispiele = len(re.findall(r'class="beispiel"', text))
quellen = len(re.findall(r'class="quelle"', text))
worte = len(re.sub(r'<[^>]+>', ' ', text).split())

# Tote Sprungmarken finden — ein Handbuch mit ins Leere zeigenden Verweisen
# ist schlimmer als eines ohne Verweise.
# Ohne die Skriptblöcke: dort steht `href="#' + e.k + '"` als Zeichenkette,
# und das ist kein Verweis, sondern der Bauplan für einen.
ohne_skript = re.sub(r'<script\b.*?</script>', '', text, flags=re.S)
ids = set(re.findall(r'\sid="([^"]+)"', ohne_skript))
ziele = set(re.findall(r'href="#([^"]+)"', ohne_skript))
tot = sorted(z for z in ziele if z not in ids)

print(f'  {ZIEL}  {len(seite)/1024:.0f} KB')
print(f'  {kapitel} Kapitel · {h2} Überschriften H2 · {h3} H3 · {h4} H4')
print(f'  {len(toc)} Zeilen im Verzeichnis, {suchbar} Überschriften im Suchverzeichnis')
print(f'  {kacheln} Symbolkacheln in {len(set(gesetzt))} Tafeln: {", ".join(sorted(set(gesetzt)))}')
print(f'  {tabellen} Tabellen · {formeln} Formelblöcke · {beispiele} Rechenbeispiele · {quellen} Quellenangaben')
print(f'  rund {worte:,} Wörter'.replace(',', '.'))
print(f'  {korrigiert} Querverweise geradegerückt')
if tot:
    print(f'  ✗ {len(tot)} tote Sprungmarken: {", ".join(tot[:12])}')
    sys.exit(1)
print('  ✓ keine tote Sprungmarke')
nicht_gesetzt = sorted(set(tafeln) - set(gesetzt))
if nicht_gesetzt:
    print(f'  Hinweis: nicht eingesetzte Tafeln: {", ".join(nicht_gesetzt)}')
