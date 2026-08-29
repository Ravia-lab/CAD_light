# Handbuch RaVia CAD Light 1.14.0 — gemeinsames Briefing

Du schreibst **ein Kapitel** eines vollständigen Handbuchs. Alle Kapitel werden
danach zu **einer** HTML-Datei zusammengebaut. Halte dich genau an diese Regeln,
sonst passt dein Kapitel nicht zu den anderen.

## Für wen wir schreiben

Für den **Handwerker** — den Heizungsbauer, den SHK-Meister, den Monteur. Nicht
für einen Ingenieur und nicht für einen Programmierer. Er kann sein Handwerk,
aber er hat nicht Thermodynamik studiert und er liest keine Norm zum Vergnügen.

Das heißt konkret:

1. **Jede Formel wird zuerst in einem Satz auf Deutsch gesagt, bevor sie als
   Formel dasteht.** Nicht „Δp = λ · (l/d) · (ρ/2) · w²", sondern erst: „Je
   länger das Rohr, je enger es ist und je schneller das Wasser darin läuft,
   desto mehr Druck kostet es. Doppelte Geschwindigkeit kostet den vierfachen
   Druck." Dann die Formel.
2. **Zu jeder Formel gehört ein Zahlenbeispiel mit echten Zahlen**, das man
   nachrechnen kann — am besten aus einem Einfamilienhaus.
3. **Jede Abkürzung wird beim ersten Mal ausgeschrieben.** kv, ζ, λ, Re, DN,
   SCOP, MAG, THV — alles.
4. **Kein Beamtendeutsch, keine Werbesprache.** Kurze Sätze. „Sie" statt „man",
   wo es um Bedienung geht.
5. **Nie „einfach nur".** Wenn etwas kompliziert ist, sagen wir warum.
6. Keine Emoji. Keine Ausrufezeichen. Keine Smileys.
7. Wo das Programm eine **Grenze** hat, wird sie benannt, nicht beschönigt.

## Die eiserne Regel: nichts erfinden

Jede Zahl, jede Formel, jeder Normverweis muss aus dem **Quelltext** oder aus
den Modulkommentaren stammen. Der Quelltext liegt in
`/home/claude/ravia-cad-light` und ist durchgehend deutsch und begründend
kommentiert — die Kommentare sagen oft genau, *warum* etwas so gerechnet wird.
Das ist deine Hauptquelle.

Weitere Quellen im selben Verzeichnisbaum:
- `/home/claude/ravia-cad-light-architektur.md` — die Architektur- und
  Entscheidungsdokumentation, chronologisch nach Fassungen
- `/home/claude/recherche-*.md` — acht Rechercheberichte mit Normzitaten und
  Quellenangaben (Rohrnetznormen, Rohrtabellen, Hydraulikschemata, Bauformen,
  Erzeugerdruckverlust)
- `/home/claude/ravia-cad-light/scripts/pruefungen/*.ts` — die Prüfblöcke. Sie
  enthalten **von Hand ausgerechnete Zahlenbeispiele** mit Herleitung im
  Kommentar. Das sind die besten Beispiele für das Handbuch, weil sie
  nachweislich stimmen.

Findest du eine Angabe nicht belegt: **weglassen** oder ausdrücklich als
unbekannt kennzeichnen. Lieber eine Lücke als eine erfundene Zahl.

## Form: HTML-Fragment

Schreibe **nur** den Inhalt deines Kapitels, kein `<html>`, kein `<head>`, kein
`<style>`. Genau diese Struktur:

```html
<section id="kap-07" class="kapitel" data-titel="7 · Räume und Bauteile">
<h2 id="k7">7 · Räume und Bauteile</h2>
<p class="lead">Ein Satz, worum es in diesem Kapitel geht.</p>

<h3 id="k7-1">7.1 Wie ein Raum entsteht</h3>
<p>…</p>
</section>
```

- `id` der Section: `kap-NN` mit zweistelliger Kapitelnummer.
- `data-titel`: der Text, der ins Inhaltsverzeichnis kommt.
- Überschriften: `<h2>` einmal je Kapitel, `<h3>` für Abschnitte, `<h4>` für
  Unterabschnitte. **Jede** Überschrift bekommt eine `id` (`k7`, `k7-1`,
  `k7-1-2`) — daraus wird das Inhaltsverzeichnis gebaut.

### Bausteine, die du benutzen darfst (die CSS-Klassen gibt es schon)

```html
<div class="merke"><b>Merke</b><p>Der Kern in zwei Sätzen.</p></div>

<div class="warnung"><b>Achtung</b><p>Was schiefgeht, wenn man es falsch macht.</p></div>

<div class="baustelle"><b>Auf der Baustelle heißt das</b><p>Der praktische Griff.</p></div>

<div class="formel">
  <p class="worte">In Worten: …</p>
  <p class="math">Δp = λ · (l / d) · (ρ / 2) · w²</p>
  <dl class="zeichen">
    <dt>Δp</dt><dd>Druckverlust in Pascal [Pa]</dd>
    <dt>λ</dt><dd>Rohrreibungszahl [-] — wie rau das Rohr innen ist</dd>
  </dl>
</div>

<div class="beispiel">
  <b>Beispiel zum Nachrechnen</b>
  <p>Kupferrohr 22 × 1, also 20 mm innen …</p>
  <p class="ergebnis">= 137 Pa je Meter</p>
</div>

<p class="quelle">Quelle: VdZ, Leitfaden „Hydraulischer Abgleich in Heizungsanlagen", S. 25</p>

<table class="tab"><caption>Tabellenüberschrift</caption><thead>…</thead><tbody>…</tbody></table>

<p>Taste: <kbd>Strg</kbd> + <kbd>Z</kbd></p>

<p class="wo">Im Programm: Reiter <b>Anlage</b> → Abschnitt <b>Erzeugerkreis und Pumpe</b></p>
```

### Symboltafeln

Wo eine Symboltafel hingehört, schreibst du **nur diesen Kommentar** in eine
eigene Zeile. Ich setze die Tafel dort später ein; sie wird aus dem Programm
selbst gerendert, damit Handbuch und Bildschirm nicht auseinanderlaufen.

```
<!--SYMBOLTAFEL:tga-->
```

Verfügbare Tafeln (genau diese Namen):
| Marke | Inhalt |
|---|---|
| `tga` | die 23 TGA-Symbole im Grundriss (Heizung, Sanitär, Lüftung) |
| `armaturen` | die 12 Armaturen und Formstücke am Rohrnetz |
| `schema` | die 38 Bauteilsymbole des Anlagenschemas mit Legendentext |
| `oeffnungen` | Fenster- und Türsymbole im Grundriss |
| `treppen` | die vier Treppenlaufformen |
| `leitungen` | die Leitungsarten mit Farbe und Strichart |
| `gelaende` | Grundstück, Geländeobjekte, Wärmepumpe im Lageplan |
| `bauteile` | massive Bauteile (Stützen, Unterzüge, Podeste) |
| `beschriftung` | Maßketten, Texte, Hinweisfahnen |

Setze eine Tafel nur **einmal** im ganzen Handbuch, und zwar in dem Kapitel,
das sie erklärt. Wer sie woanders braucht, verweist mit einem Link darauf.

### Querverweise

Auf andere Kapitel verweist du mit `<a href="#k13-4">Abschnitt 13.4</a>`. Die
Nummern der anderen Kapitel stehen in der Gliederung unten — halte dich daran.

## Die Gliederung des ganzen Handbuchs

| Kapitel | Inhalt |
|---|---|
| 1 | Was dieses Programm ist und was nicht |
| 2 | Loslegen: die ersten dreißig Minuten |
| 3 | Die Oberfläche: Ansichten, Werkzeuge, Reiter, Tastatur |
| 4 | Zeichnen: Wände, Öffnungen, Räume |
| 5 | Geschosse und Höhen |
| 6 | Dach, Gauben, Dachfenster |
| 7 | Räume, Bauteilaufbauten, U-Werte |
| 8 | TGA-Objekte: Heizkörper, Sanitär, Lüftung |
| 9 | Das Rohrnetz: zeichnen, auslegen, Armaturen |
| 10 | Die Anlage: Gerät, Speicher, Heizkreise, Trinkwasser, Sicherheit |
| 11 | Das Anlagenschema |
| 12 | Hydraulikschemata: Katalog, Vorschlag, Prüfung |
| 13 | Die Rechenwege — alle Formeln des Programms |
| 14 | Berichte, Blätter und die Projektmappe |
| 15 | Nachweise und Recht: § 60c und was das Programm liefert |
| 16 | Die Wissensbasis: nachschlagen im Programm |
| 17 | Schnittstellen: Export, IFC, Einbettung in RaVia |
| 18 | Anhang: Glossar, Normen, Tastenkürzel, Grenzen |

## Was du abgibst

Eine Datei unter `/home/claude/handbuch/` mit dem Namen, der in deinem Auftrag
steht. Sonst nichts. **Ändere keine Datei im Quelltextverzeichnis
`/home/claude/ravia-cad-light`** — dort wird parallel gearbeitet; du liest dort
nur.

Am Ende antwortest du knapp auf Deutsch: welche Abschnitte dein Kapitel hat,
welche Symboltafeln du gesetzt hast, und wo du eine Angabe nicht belegen
konntest.
