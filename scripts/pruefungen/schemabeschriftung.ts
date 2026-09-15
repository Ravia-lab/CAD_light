/**
 * Prüfblock „Schemabeschriftung" — ist das Blatt lesbar?
 *
 * **Der Anlass.** Auf dem Anlagenschema der Projektmappe standen die
 * Bauteilnamen waagerecht am Symbol. Bei M 1:200 — dem Maßstab, in dem das
 * Referenzhaus auf A4 quer passt — ist ein Rasterschritt 5 mm breit, ein Name
 * wie „Monoblock Luft/Wasser R290 8 kW" aber 41 mm. Das Ergebnis waren
 * **63 einander überdeckende Beschriftungen** auf einem Blatt; gemeldet hat es
 * der Anwender mit dem Satz, es sei „durcheinander und nicht lesbar".
 *
 * **Warum das keine bestehende Prüfung gefunden hat.** Die Prüfungen zum
 * Schema fragten nach der *Topologie* — hängt jeder Stutzen am richtigen
 * Gegenstück, trennt die Systemtrennung wirklich —, und die Druckprüfungen
 * fragten nach dem *Rahmen*: ein Wurzelelement je Blatt, keine NaN-Koordinate,
 * passt der Inhalt ins Zeichenfeld. Beides war richtig. Ob zwei Texte
 * übereinanderliegen, hat niemand gezählt. Genau das tut dieser Block: er
 * misst die Lesbarkeit als Zahl, und die Zahl muss null sein.
 *
 * **Die Sollwerte stammen nicht aus einem Probelauf.** Sie folgen aus der
 * Sache: eine Beschriftung, die eine andere überdeckt, ist unlesbar (also
 * null); ein Bauteil ohne Nummer ist unauffindbar (also alle); eine Nummer,
 * die im Blatt steht, aber in keiner Liste, ist eine Sackgasse (also keine).
 */

import type { CheckFn } from './typ';
import type { SchematicComponent } from '../../src/types/bim';
import { buildSchematic, designPlant } from '../../src/lib/plantDesign';
import { buildComponentTable, buildSchematicSvg, type SchematicPrintOptions } from '../../src/lib/schematicPrint';
import {
  entscheideArt,
  namensKaesten,
  setzeLeitungsbeschriftung,
  setzePositionen,
  zaehleUeberlappungen,
} from '../../src/lib/schemaBeschriftung';
import { buildReferenceDocument } from '../reference';

const DRUCK: SchematicPrintOptions = {
  format: 'A4',
  orientation: 'landscape',
  projectName: 'Referenzhaus',
  plantName: 'Heizungsanlage',
  author: 'Prüfung',
  date: '01.01.2026',
  scale: 'auto',
  showLegend: true,
  colour: false,
};

/** Alle Kreise, die auf einem Blatt gezeichnet sind — Mittelpunkt und Halbmesser. */
function kreise(svg: string): { x: number; y: number; r: number }[] {
  const raus: { x: number; y: number; r: number }[] = [];
  const re = /<circle cx="([-\d.]+)" cy="([-\d.]+)" r="([\d.]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg))) raus.push({ x: Number(m[1]), y: Number(m[2]), r: Number(m[3]) });
  return raus;
}

/** Die Zahlen, die als Positionsnummer im Blatt stehen. */
function nummern(svg: string): number[] {
  const raus: number[] = [];
  const re = /<text[^>]*font-weight="600"[^>]*text-anchor="middle"[^>]*>(\d+)<\/text>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg))) raus.push(Number(m[1]));
  return raus;
}

/** Die weiß hinterlegten Kästen der Leitungsbeschriftung. */
function leitungsKaesten(svg: string): { x0: number; y0: number; x1: number; y1: number }[] {
  const raus: { x0: number; y0: number; x1: number; y1: number }[] = [];
  const re = /<rect x="([-\d.]+)" y="([-\d.]+)" width="([\d.]+)" height="([\d.]+)" fill="#FFFFFF" fill-opacity="0\.9"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg))) {
    const x = Number(m[1]);
    const y = Number(m[2]);
    raus.push({ x0: x, y0: y, x1: x + Number(m[3]), y1: y + Number(m[4]) });
  }
  return raus;
}

export function pruefeSchemabeschriftung(check: CheckFn): void {
  const doc = buildReferenceDocument();
  const schema = buildSchematic(designPlant(doc, {}));
  const bauteile: readonly SchematicComponent[] = schema.components;

  // =========================================================================
  // 1 · Der gemeldete Fehler, als Zahl
  // =========================================================================
  {
    const blatt = buildSchematicSvg(bauteile, schema.links, DRUCK);
    // Der Befund, der den Umbau ausgelöst hat. Steht die Zahl eines Tages auf
    // null, weil jemand die Namen gekürzt hat, ist das kein Fehlschlag — dann
    // wählt `'auto'` von selbst wieder die Namen, und diese Prüfung darf mit
    // wandern. Solange sie über null steht, muss das Blatt Nummern tragen.
    check('Die Namen am Symbol würden einander überdecken', blatt.labelCollisions > 0, true);
    check('Deshalb trägt das Blatt Positionsnummern', blatt.labelMode, 'position');
    check('Keine Nummer steht gedrängt', blatt.crowdedPositions, 0);
    check('Die Begründung steht in den Hinweisen', blatt.notes.some((h) => h.includes('Positionsnummern')), true);
  }

  // =========================================================================
  // 2 · Jedes Bauteil trägt eine Nummer, jede Nummer steht in der Liste
  // =========================================================================
  {
    const blatt = buildSchematicSvg(bauteile, schema.links, DRUCK);
    const zeichnung = blatt.sheets[0];
    const liste = buildComponentTable(bauteile);

    // Je Bauteil genau ein Kreis. Fehlt einer, ist das Bauteil auf dem Blatt
    // nicht nachschlagbar; steht einer zu viel, zeigt er auf nichts.
    const gezeichnet = nummern(zeichnung);
    check('Jedes Bauteil trägt eine Nummer', gezeichnet.length, bauteile.length);

    const vergeben = new Set(liste.map((r) => r.position));
    check('Jede gezeichnete Nummer steht in der Liste', gezeichnet.every((z) => vergeben.has(z)), true);

    const benutzt = new Set(gezeichnet);
    check('Jede Position der Liste steht auch auf der Zeichnung', liste.every((r) => benutzt.has(r.position)), true);
    check('Die Liste zählt alle Bauteile', liste.reduce((s, r) => s + r.count, 0), bauteile.length);
    check('Die Positionen laufen lückenlos', liste.every((r, i) => r.position === i + 1), true);
  }

  // =========================================================================
  // 3 · Die Nummernkreise überdecken einander nicht
  // =========================================================================
  {
    const blatt = buildSchematicSvg(bauteile, schema.links, DRUCK);
    // Nur die Kreise der Zeichnung, nicht die des Positionsblatts: dort
    // stehen sie in einer Spalte und sollen sich gerade *nicht* ausweichen.
    const alle = kreise(blatt.sheets[0]);
    const nummernKreise = alle.filter((k) => k.r > 1);
    check('Es sind Nummernkreise gezeichnet', nummernKreise.length, bauteile.length);
    const kaesten = nummernKreise.map((k) => ({ x0: k.x - k.r, x1: k.x + k.r, y0: k.y - k.r, y1: k.y + k.r }));
    check('Keine zwei Nummern überdecken einander', zaehleUeberlappungen(kaesten), 0);

    // Und keine ragt aus dem Zeichenfeld. Die Ränder sind 12 mm; unten liegt
    // das Schriftfeld. Geprüft wird großzügig gegen den Blattrand — was dort
    // hinausragt, schneidet der Drucker ab.
    const drin = nummernKreise.every(
      (k) => k.x - k.r >= 0 && k.y - k.r >= 0 && k.x + k.r <= blatt.sheet.w && k.y + k.r <= blatt.sheet.h,
    );
    check('Keine Nummer ragt über das Blatt hinaus', drin, true);
  }

  // =========================================================================
  // 3b · Die Leitungsbeschriftung liegt nicht unter einer Nummer
  // =========================================================================
  {
    const blatt = buildSchematicSvg(bauteile, schema.links, DRUCK);
    const zeichnung = blatt.sheets[0];
    const beschriftungen = leitungsKaesten(zeichnung);
    check('Leitungen sind beschriftet', beschriftungen.length > 0, true);
    check('Keine zwei Leitungsbeschriftungen überdecken einander', zaehleUeberlappungen(beschriftungen), 0);

    const nummernKreise = kreise(zeichnung).filter((k) => k.r > 1);
    const alles = [
      ...beschriftungen,
      ...nummernKreise.map((k) => ({ x0: k.x - k.r, x1: k.x + k.r, y0: k.y - k.r, y1: k.y + k.r })),
    ];
    // Die eine Zahl, an der sich das Blatt messen lässt: Schrift auf Schrift
    // gibt es nicht mehr. „15 × 1" stand vorher im Absperrventil.
    check('Keine Nummer liegt auf einer Leitungsbeschriftung', zaehleUeberlappungen(alles), 0);
  }

  // =========================================================================
  // 3c · Die Platzierung der Leitungsbeschriftung, von Hand nachrechenbar
  // =========================================================================
  {
    // Eine waagerechte Strecke von (0,0) nach (40,0), Text 10 × 3 mm. Frei
    // ist die Mitte; der Text weicht quer aus, also auf y = ±(1,5 + 0,8).
    const frei = setzeLeitungsbeschriftung([{ x: 0, y: 0 }, { x: 40, y: 0 }], 10, 3, []);
    check('Auf freier Strecke steht der Text in der Mitte', frei?.x ?? -1, 20, 1e-9);
    check('… und quer neben der Leitung', Math.abs(frei?.y ?? 0), 2.3, 1e-9);

    // Jetzt liegt dort ein Bauteil. Der Text muss ausweichen — auf die andere
    // Seite oder auf einen Viertelpunkt, aber nicht auf das Bauteil.
    const hindernis = { x0: 14, y0: -6, x1: 26, y1: 6 };
    const aus = setzeLeitungsbeschriftung([{ x: 0, y: 0 }, { x: 40, y: 0 }], 10, 3, [hindernis]);
    check('Bei belegter Mitte weicht der Text aus', aus !== null, true);
    check(
      '… und liegt nicht mehr auf dem Hindernis',
      aus
        ? !(aus.x - 5 < hindernis.x1 && hindernis.x0 < aus.x + 5 && aus.y - 1.5 < hindernis.y1 && hindernis.y0 < aus.y + 1.5)
        : false,
      true,
    );

    // Ist alles belegt, kommt nichts zurück — der Aufrufer entscheidet dann.
    const voll = setzeLeitungsbeschriftung([{ x: 0, y: 0 }, { x: 40, y: 0 }], 10, 3, [
      { x0: -100, y0: -100, x1: 100, y1: 100 },
    ]);
    check('Ist alles belegt, kommt nichts zurück', voll === null, true);
    // Eine Strecke unter 2 mm trägt keine Beschriftung; sie stünde über beide
    // Enden hinaus und zeigte auf nichts.
    check(
      'Eine zu kurze Strecke trägt nichts',
      setzeLeitungsbeschriftung([{ x: 0, y: 0 }, { x: 1, y: 0 }], 10, 3, []) === null,
      true,
    );
  }

  // =========================================================================
  // 4 · Der Knoten ist kein Bauteil
  // =========================================================================
  {
    const liste = buildComponentTable(bauteile);
    const knoten = liste.filter((r) => r.kind === 'node');
    // Vier verschiedene Stellen im Netz („Zapfstellen", „Abblaseleitung",
    // „Vorlaufbalken", „Entwässerung") dürfen nicht dieselbe Nummer tragen:
    // die Liste sagte zu dieser Nummer sonst vier Namen, und die Zeichnung
    // wäre genau dort stumm, wo sie ins Gebäude zeigt.
    const namenJePosition = knoten.map((r) => new Set(r.labels).size);
    check('Ein Knotenpunkt trägt je Position genau einen Namen', namenJePosition.every((z) => z <= 1), true);
    check('Es gibt mehr als eine Knotenposition', knoten.length > 1, true);
  }

  // =========================================================================
  // 5 · Die Entscheidung ist eine Messung
  // =========================================================================
  {
    check('Ohne Überdeckung bleiben die Namen', entscheideArt('auto', 0).art, 'name');
    check('Mit Überdeckung kommen die Nummern', entscheideArt('auto', 1).art, 'position');
    // Die ausdrückliche Vorgabe schlägt die Messung — wer Namen will, bekommt
    // Namen, und den Befund dazu in der Begründung.
    check('„name" bleibt bei Namen', entscheideArt('name', 99).art, 'name');
    check('… und sagt, was das kostet', entscheideArt('name', 99).begruendung.includes('99'), true);
    check('„position" bleibt bei Nummern', entscheideArt('position', 0).art, 'position');

    const erzwungen = buildSchematicSvg(bauteile, schema.links, { ...DRUCK, labelMode: 'name' });
    check('Erzwungene Namen werden gezeichnet', erzwungen.labelMode, 'name');
    check('Und das Blatt sagt es nicht als Nummernblatt an', erzwungen.notes.some((h) => h.includes('Positionsnummern')), false);
  }

  // =========================================================================
  // 6 · Die Platzierung selbst — an einem Fall, der von Hand nachrechenbar ist
  // =========================================================================
  {
    // Zwei Bauteile, 20 mm auseinander, jedes 6 mm groß. Die Nummer braucht
    // bei 2,5 mm Schrift rund 1,6 mm Halbmesser; beide finden Platz, ohne
    // einander zu berühren.
    const teile = [
      { id: 'a', x: 20, y: 20, breite: 6, hoehe: 6, position: 1 },
      { id: 'b', x: 40, y: 20, breite: 6, hoehe: 6, position: 2 },
    ];
    const symbole = teile.map((t) => ({ x0: t.x - 3, x1: t.x + 3, y0: t.y - 3, y1: t.y + 3 }));
    const gesetzt = setzePositionen(teile, symbole, { schrift: 2.5 });
    check('Beide Nummern werden gesetzt', gesetzt.lagen.length, 2);
    check('Keine steht gedrängt', gesetzt.gedraengt, 0);
    check('Keine trägt eine Hinweislinie', gesetzt.mitLinie, 0);
    check('Die Reihenfolge bleibt die der Eingabe', gesetzt.lagen.map((l) => l.bauteilId).join(','), 'a,b');
    check(
      'Keine Nummer liegt auf ihrem eigenen Symbol',
      gesetzt.lagen.every((l, i) => Math.hypot(l.x - teile[i].x, l.y - teile[i].y) > 3),
      true,
    );

    // Dasselbe Paar in einem Feld, das nur 24 mm hoch ist: die Nummer darf
    // nicht darüber hinaus, sie muss also seitlich ausweichen.
    const eng = setzePositionen(teile, symbole, {
      schrift: 2.5,
      feld: { x0: 0, y0: 8, x1: 60, y1: 32 },
    });
    check(
      'Im engen Feld bleibt jede Nummer innerhalb',
      eng.lagen.every((l) => l.y - l.r >= 8 - 1e-6 && l.y + l.r <= 32 + 1e-6),
      true,
    );
  }

  // =========================================================================
  // 7 · Die Messung der Namenskästen stimmt mit dem überein, was gezeichnet wird
  // =========================================================================
  {
    // Ein Name von 10 Zeichen bei 2 mm Schrift ist 12 mm breit (0,6 em je
    // Zeichen — dieselbe Annahme wie in `schematicPrint.textWidth`).
    const kaesten = namensKaesten(
      [{ id: 'a', x: 0, y: 0, breite: 4, hoehe: 4, position: 1, name: '0123456789', angabe: '' }],
      2,
    );
    check('Ein Kasten je Name', kaesten.length, 1);
    check('Breite = Zeichen × Schrift × 0,6', kaesten[0].x1 - kaesten[0].x0, 12, 1e-9);
    check('Der Name steht über dem Symbol', kaesten[0].y1 < -2, true);
    // Ohne technische Angabe entsteht kein zweiter Kasten — ein leerer Kasten
    // würde Überdeckungen zählen, die niemand sieht.
    const mitAngabe = namensKaesten(
      [{ id: 'a', x: 0, y: 0, breite: 4, hoehe: 4, position: 1, name: 'A', angabe: 'B' }],
      2,
    );
    check('Mit Angabe sind es zwei Kästen', mitAngabe.length, 2);
    check('Die Angabe steht unter dem Symbol', mitAngabe[1].y0 > 2, true);
    check('Zwei Namen am selben Ort überdecken einander', zaehleUeberlappungen([kaesten[0], kaesten[0]]), 1);
  }
}
