#!/usr/bin/env python3
"""
Erzeugt das Kachelbild für den Home-Bildschirm (apple-touch-icon).

**Warum als Skript und nicht als abgelegte Datei.** Das Zeichen ist dasselbe
wie im Favicon und in der Anwendung selbst — das Haus aus Dach, Wänden, Boden
und Tür, in Akzentblau auf dem dunklen Grund der Anwendung. Wer es später
ändert, soll es an *einer* Stelle ändern und nicht in drei Dateigrößen
nachzeichnen müssen.

**Woher die Form kommt.** Die Vorlage ist das Markensymbol in der Werkzeugleiste
(`src/components/Toolbar.tsx`, Block 1): drei Züge in einem 24er-Feld —
Wände mit Dach (`M4 20V9l8-5 8 5v11`), Boden (`M4 20h16`), Tür
(`M10 20v-6h4v6`). Hier unten steht dieselbe Figur, nur in dem 32er-Feld
gerechnet, das auch das Favicon in `index.html` benutzt, damit Reiter und
Kachel Strich für Strich übereinstimmen.

**Warum überhaupt eine PNG-Datei.** iOS nimmt für die Kachel auf dem
Home-Bildschirm kein SVG. Fehlt ein `apple-touch-icon`, macht das Gerät ein
Bildschirmfoto der Seite und legt das auf den Bildschirm — bei einer dunklen
CAD-Oberfläche ein grauer Fleck, an dem niemand erkennt, was das sein soll.

Aufruf:  python3 scripts/kachelbild.py
"""

from pathlib import Path

from PIL import Image, ImageDraw

GRUND = (11, 17, 32)      # derselbe Ton wie der Anwendungshintergrund
STRICH = (56, 189, 248)   # Akzentblau

ZIEL = Path(__file__).resolve().parent.parent / "public"

# Vierfach zeichnen und dann verkleinern.
#
# `ImageDraw.line` kennt keine Kantenglättung. Beim alten „R" fiel das kaum
# auf, weil es fast nur waagerechte und senkrechte Striche hatte. Das Haus hat
# zwei Dachschrägen, und die bekämen ohne diesen Umweg bei 180 px eine deutlich
# sichtbare Treppe. Also wird in vierfacher Kantenlänge gezeichnet und mit
# LANCZOS heruntergerechnet — das glättet die Schrägen, ohne dass wir das
# Zeichnen selbst aus der Hand geben.
UEBERABTASTUNG = 4

# Das Haus im 32er-Feld — dieselben Zahlen wie im Favicon in `index.html`.
#
# Zwei Maße sind gegenüber dem Symbol in der Anwendung bewusst nachgezogen,
# weil ein Symbol in Briefmarkengröße andere Regeln hat als eines in der
# Werkzeugleiste:
#
#   * Der Strich ist 3 statt 1,5 Einheiten breit (im 24er-Feld der Vorlage
#     entspräche das gut 2,4). Ein Haarstrich wird beim Verkleinern grau
#     gewaschen; 3 Einheiten bleiben auch in 32 px blau.
#   * Die Tür ist breiter: 7 Einheiten statt der umgerechnet 4,8. Bei
#     Originalbreite bliebe zwischen den Türpfosten weniger als 2 px dunkler
#     Grund — die Tür liefe zu einem Klecks zusammen, statt als Öffnung zu
#     lesen.
#
# Weggelassen ist nichts: Dach, Wände, Boden und Tür sind alle vier da. Das
# Haus steht von 6,4 bis 25,6 und füllt damit 60 % der Kante; der Rest ist
# Luft, die jedes Betriebssystem beim Abrunden der Ecke braucht.
FELD = 32.0
STRICHBREITE_IM_FELD = 3.0
ZUEGE = [
    # Wände und Dach in einem Zug, von unten links über den First nach unten
    # rechts — wie in der Anwendung.
    [(6.4, 25.6), (6.4, 12.4), (16.0, 6.4), (25.6, 12.4), (25.6, 25.6)],
    # Der Boden. Er schließt das Haus unten; ohne ihn stünden die Wände offen.
    [(6.4, 25.6), (25.6, 25.6)],
    # Die Tür, ein auf den Boden gestelltes U.
    [(12.5, 25.6), (12.5, 17.0), (19.5, 17.0), (19.5, 25.6)],
]


def zeichne(kante: int, rand_anteil: float = 0.0) -> Image.Image:
    """
    Ein Kachelbild mit der Kantenlänge `kante`.

    `rand_anteil` hält bei den maskierbaren Größen Luft am Rand frei: Android
    beschneidet das Bild je nach Gerät zu einem Kreis oder einem abgerundeten
    Quadrat, und was zu nah am Rand steht, wird dabei abgeschnitten.
    """
    gross = kante * UEBERABTASTUNG
    bild = Image.new("RGB", (gross, gross), GRUND)
    zeichner = ImageDraw.Draw(bild)

    # Der Zeichenbereich, in dem das Zeichen steht. Das 32er-Feld wird auf
    # genau diesen Bereich abgebildet, damit das Haus in jeder Größe dieselben
    # Verhältnisse hat.
    luft = gross * rand_anteil
    nutzbar = gross - 2 * luft

    def punkt(p: tuple[float, float]) -> tuple[float, float]:
        return (luft + p[0] / FELD * nutzbar, luft + p[1] / FELD * nutzbar)

    breite = max(2, round(STRICHBREITE_IM_FELD / FELD * nutzbar))
    radius = breite / 2

    for zug in ZUEGE:
        ecken = [punkt(p) for p in zug]
        for anfang, ende in zip(ecken, ecken[1:]):
            zeichner.line([anfang, ende], fill=STRICH, width=breite)
        # Runde Enden und Ecken.
        #
        # `ImageDraw.line` stumpft jeden Strich rechtwinklig ab und lässt an
        # Knicken — vor allem am spitzen First — eine Kerbe stehen. Ein Kreis
        # auf jeder Ecke füllt sie und gibt zugleich die runden Enden, die das
        # Symbol in der Anwendung über `stroke-linecap="round"` hat.
        for x, y in ecken:
            zeichner.ellipse([x - radius, y - radius, x + radius, y + radius], fill=STRICH)

    return bild.resize((kante, kante), Image.LANCZOS)


def main() -> None:
    ZIEL.mkdir(parents=True, exist_ok=True)
    # 180 px ist das Maß, das iOS für die Kachel nimmt; 192 und 512 sind die
    # Größen, nach denen Android im Web-App-Manifest fragt.
    for kante, name, rand in [
        (180, "apple-touch-icon.png", 0.0),
        (192, "kachel-192.png", 0.08),
        (512, "kachel-512.png", 0.08),
    ]:
        bild = zeichne(kante, rand)
        pfad = ZIEL / name
        bild.save(pfad, "PNG", optimize=True)
        print(f"{pfad.name:26} {kante}x{kante}  {pfad.stat().st_size / 1024:.1f} kB")


if __name__ == "__main__":
    main()
