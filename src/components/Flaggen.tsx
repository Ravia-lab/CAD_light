/**
 * Flaggen für die Sprachwahl — als SVG, nicht als Emoji.
 * ---------------------------------------------------------------------------
 * **Warum nicht 🇹🇷 als Zeichen.** Windows hat keine Flaggen-Schriftzeichen.
 * Ein Emoji-Flaggenzeichen besteht aus zwei Buchstaben aus dem
 * Regional-Indicator-Bereich, und wo keine Flagge im Zeichensatz liegt,
 * zeigt der Browser genau diese zwei Buchstaben: „TR", „PL", „RU". Auf dem
 * Mac sähe die Leiste dann richtig aus und auf dem Rechner des Monteurs
 * nicht — und der arbeitet unter Windows. Also gezeichnet statt gesetzt.
 *
 * **Und warum die Flagge trotzdem nicht allein steht.** Eine Flagge
 * bezeichnet ein Land, keine Sprache. Neben jeder steht deshalb der Name
 * der Sprache in ihrer eigenen Schreibweise. Wer die Flagge sucht, findet
 * sie sofort; wer sich an ihr stört, liest den Namen.
 *
 * Die Zeichnungen sind bewusst grob: 3 × 2 Einheiten, ohne Wappen, ohne
 * Schattierung. Bei 18 Bildpunkten Breite ist alles andere ein Fleck.
 */

import type { Sprache } from '../lib/sprache';

/** Eine Flagge in 3 : 2 — das Seitenverhältnis fast aller Nationalflaggen. */
export function Flagge({ code, size = 18 }: { code: Sprache; size?: number }) {
  const h = Math.round((size * 2) / 3);
  const gemeinsam = {
    width: size,
    height: h,
    viewBox: '0 0 3 2',
    className: 'shrink-0 rounded-[1px] ring-1 ring-black/40',
    'aria-hidden': true as const,
  };

  switch (code) {
    case 'de':
      return (
        <svg {...gemeinsam}>
          <rect width="3" height="2" fill="#000" />
          <rect y="0.667" width="3" height="0.667" fill="#D00" />
          <rect y="1.333" width="3" height="0.667" fill="#FFCE00" />
        </svg>
      );
    case 'tr':
      return (
        <svg {...gemeinsam}>
          <rect width="3" height="2" fill="#E30A17" />
          {/* Mondsichel: ein weißer Kreis, aus dem ein roter Kreis beißt. */}
          <circle cx="1.15" cy="1" r="0.44" fill="#fff" />
          <circle cx="1.28" cy="1" r="0.35" fill="#E30A17" />
          <path
            d="M1.72 1 2.02 0.9 1.83 1.15 1.84 0.85 2.02 1.1Z"
            fill="#fff"
          />
        </svg>
      );
    case 'pl':
      return (
        <svg {...gemeinsam}>
          <rect width="3" height="2" fill="#fff" />
          <rect y="1" width="3" height="1" fill="#DC143C" />
        </svg>
      );
    case 'ru':
      return (
        <svg {...gemeinsam}>
          <rect width="3" height="2" fill="#fff" />
          <rect y="0.667" width="3" height="0.667" fill="#0039A6" />
          <rect y="1.333" width="3" height="0.667" fill="#D52B1E" />
        </svg>
      );
    case 'it':
      return (
        <svg {...gemeinsam}>
          <rect width="3" height="2" fill="#009246" />
          <rect x="1" width="1" height="2" fill="#fff" />
          <rect x="2" width="1" height="2" fill="#CE2B37" />
        </svg>
      );
    case 'ro':
      return (
        <svg {...gemeinsam}>
          <rect width="3" height="2" fill="#002B7F" />
          <rect x="1" width="1" height="2" fill="#FCD116" />
          <rect x="2" width="1" height="2" fill="#CE1126" />
        </svg>
      );
    default:
      return null;
  }
}
