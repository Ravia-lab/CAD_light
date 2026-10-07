/**
 * Der QR-Code für den Dialog „Mit RaVia Scan scannen".
 *
 * Liegt bewusst nicht im Rechenkern (`src/lib`): Der kommt ohne fremde
 * Bibliothek aus, und das bleibt so. Der Code selbst stammt aus
 * `qrcode-generator` (MIT, ohne weitere Abhängigkeiten).
 */

import qrcode from 'qrcode-generator';

/**
 * Die Modulmatrix des QR-Codes. Fehlerkorrektur **M** (15 %): Ein Bildschirm
 * spiegelt, eine Handykamera wackelt — L wäre knapp, Q und H machen den Code
 * bei einem Link dieser Länge unnötig dicht.
 */
export function qrMatrix(text: string): boolean[][] {
  const qr = qrcode(0, 'M');
  qr.addData(text, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  const m: boolean[][] = [];
  for (let r = 0; r < n; r++) {
    const zeile: boolean[] = [];
    for (let c = 0; c < n; c++) zeile.push(qr.isDark(r, c));
    m.push(zeile);
  }
  return m;
}

/**
 * Ein einziger SVG-Pfad für alle dunklen Module, mit vier Modulen Ruhezone
 * ringsum — so viel verlangt die Norm (ISO/IEC 18004), und ohne sie liest
 * manche Kamera den Code auf dunklem Grund nicht. Jede waagerechte Folge
 * dunkler Module wird ein Rechteck; das hält den Pfad kurz.
 */
export function qrSvgPfad(matrix: boolean[][], ruhezone = 4): { pfad: string; groesse: number } {
  const n = matrix.length;
  const teile: string[] = [];
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (!matrix[r][c]) {
        c++;
        continue;
      }
      const start = c;
      while (c < n && matrix[r][c]) c++;
      teile.push(`M${start + ruhezone} ${r + ruhezone}h${c - start}v1h${-(c - start)}z`);
    }
  }
  return { pfad: teile.join(''), groesse: n + 2 * ruhezone };
}
