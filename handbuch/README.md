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
npx esbuild scripts/handbuch-symbole.ts --bundle --platform=node --format=esm \
  --outfile=/tmp/symbole.mjs && node /tmp/symbole.mjs   # Tafeln neu zeichnen
python3 handbuch/bauen.py                                # Handbuch zusammensetzen
```

`bauen.py` zählt am Ende nach, was es gebaut hat, und **bricht ab, wenn eine
Sprungmarke ins Leere zeigt**. Ein Handbuch mit toten Verweisen ist schlechter
als eines ohne Verweise.

Die Kennzahlen auf dem Deckblatt (Kapitelzahl, Symbolzahl, Fassung) werden
beim Bau eingesetzt, nicht im Deckblatt gepflegt: eine von Hand eingetragene
Zahl stimmt bis zur nächsten Änderung.

`BRIEFING.md` ist die Schreibanweisung, nach der die Kapitel entstanden sind —
Zielgruppe, Tonfall, die erlaubten HTML-Bausteine. Wer ein Kapitel ergänzt,
liest sie zuerst.
