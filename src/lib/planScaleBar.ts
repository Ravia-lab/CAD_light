/**
 * Maßstabsleiste für den Planausdruck — als SVG-Fragment in Millimetern.
 * Sie ist das, was einen Ausdruck überprüfbar macht: wer nachmisst, sieht
 * sofort, ob der Drucker skaliert hat.
 */
import { dez } from './zahl';

export function drawableScaleBar(x: number, y: number, scale: number): string {
  // Segmentlänge in Metern so wählen, dass die Leiste rund 40 mm lang wird.
  const target = (40 * scale) / 1000;
  const steps = [0.5, 1, 2, 5, 10, 20];
  const step = steps.reduce((best, s) => (Math.abs(s * 4 - target) < Math.abs(best * 4 - target) ? s : best), 1);
  const mm = (step * 1000) / scale;

  const parts: string[] = [];
  for (let i = 0; i < 4; i++) {
    parts.push(
      `<rect x="${(x + i * mm).toFixed(2)}" y="${y.toFixed(2)}" width="${mm.toFixed(2)}" height="1.6" ` +
        `fill="${i % 2 ? '#FFFFFF' : '#0F172A'}" stroke="#0F172A" stroke-width="0.15"/>`,
    );
    parts.push(
      `<text x="${(x + i * mm).toFixed(2)}" y="${(y + 5).toFixed(2)}" font-size="2.2" text-anchor="middle" fill="#475569">${dez(i * step, step < 1 ? 1 : 0)}</text>`,
    );
  }
  parts.push(
    `<text x="${(x + 4 * mm).toFixed(2)}" y="${(y + 5).toFixed(2)}" font-size="2.2" text-anchor="middle" fill="#475569">${dez(4 * step, step < 1 ? 1 : 0)} m</text>`,
  );
  return `<g>${parts.join('')}</g>`;
}
