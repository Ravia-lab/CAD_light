# Handbuch — Quelle und Bau

Das Handbuch entsteht **nicht** von Hand, sondern aus drei Teilen:

1. **Kapitelfragmente** `kap-01.html` … `kap-18.html` (Kapitel 13 in drei
   Lieferungen `13a`/`13b`/`13c`). Reine HTML-Ausschnitte ohne Kopf und ohne
   Stilblatt.
2. **Symboltafeln** `tafeln.json`. Sie werden von
   `../scripts/handbuch-symbole.ts` erzeugt, und zwar aus **denselben
   Zeichenroutinen**, die Bildschirm und Blatt füllen — über den `SvgRecorder`
   aus `schematicPrint.ts`. Ein nachgezeichnetes Symbol wäre ab der ersten
   Programmänderung falsch, ohne dass es jemandem auffiele.
3. **Rahmen** `deckblatt.html`, `stil.css`, `skript.js`.

## Neu bauen

```bash
npm run handbuch        # Tafeln neu zeichnen und Handbuch zusammensetzen
```

Das schreibt nach `server/app/handbuch.html` — also **dorthin, wo ausgeliefert
wird**. Ein Handbuch, das neben dem Projekt entsteht und von Hand kopiert
werden muss, wird beim dritten Mal nicht mehr kopiert.

`bauen.py` ruft dabei `npm run verify` auf und bricht ab, wenn der Prüflauf
nicht grün ist. Die Zahl auf dem Deckblatt ist das Ergebnis dieses Laufs und
nicht von Hand eingetragen: Ein Handbuch, das „5.140 Prüfungen" behauptet,
während zwölf davon fallen, ist an der ersten Zeile unglaubwürdig.

`bauen.py` zählt am Ende nach, was es gebaut hat, und **bricht ab, wenn eine
Sprungmarke ins Leere zeigt**. Ein Handbuch mit toten Verweisen ist schlechter
als eines ohne Verweise.

Die Kennzahlen auf dem Deckblatt (Kapitelzahl, Symbolzahl, Fassung) werden
beim Bau eingesetzt, nicht im Deckblatt gepflegt: eine von Hand eingetragene
Zahl stimmt bis zur nächsten Änderung.

## Warum die Quelle seit 1.29.0 hier liegt

Bis dahin lagen die Kapitelfragmente unter `/home/claude/handbuch`, also
außerhalb des Projekts. Der Bau von 1.23.0 — 19 Kapitel, rund 140.800 Wörter —
ist damit **verloren**: Die Dateien waren beim nächsten Start nicht mehr da,
und ausgeliefert wurde weiter der Bau von 1.21.0. Wiederhergestellt ist die
Quelle aus dem ausgelieferten Handbuch; die Kapitel sind dieselben, die
Symboltafeln entstehen wieder aus dem Programm.

Beide Skripte arbeiten seither mit Pfaden relativ zum Projekt. Wer einen
absoluten Pfad einträgt, macht denselben Fehler noch einmal.

`BRIEFING.md` ist die Schreibanweisung, nach der die Kapitel entstanden sind —
Zielgruppe, Tonfall, die erlaubten HTML-Bausteine. Wer ein Kapitel ergänzt,
liest sie zuerst.
