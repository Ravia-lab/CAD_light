/**
 * Flaggen für die Sprachwahl — als SVG, nicht als Emoji.
 * ---------------------------------------------------------------------------
 * **Warum nicht 🇹🇷 als Zeichen.** Windows hat keine Flaggen-Schriftzeichen.
 * Ein Emoji-Flaggenzeichen besteht aus zwei Buchstaben aus dem
 * Regional-Indicator-Bereich, und wo keine Flagge im Zeichensatz liegt,
 * zeigt der Browser genau diese zwei Buchstaben: „TR", „PL", „RU". Auf dem
 * Mac sähe die Leiste richtig aus und auf dem Rechner des Monteurs nicht —
 * und der arbeitet unter Windows. Also gezeichnet statt gesetzt.
 *
 * **Und warum neben jeder Flagge der Sprachname steht.** Eine Flagge
 * bezeichnet ein Land, keine Sprache. Das ist hier nicht theoretisch:
 *
 *  • **Arabisch** hat gar kein Land — es wird in zwanzig gesprochen. Dafür
 *    steht deshalb keine Flagge, sondern ein Schriftzeichen: ع. Eine
 *    saudische Flagge für einen Syrer wäre schlechter als gar keine.
 *  • **Englisch** — Union Jack oder Sternenbanner? Hier der Union Jack, weil
 *    die Zielgruppe in Europa arbeitet.
 *  • **Serbisch und Kroatisch** sind zwei Sprachen mit zwei Flaggen und
 *    einer langen Geschichte dazwischen. Beide stehen getrennt da.
 *
 * Die Zeichnungen sind bewusst grob: 3 × 2 Einheiten, ohne Wappen, ohne
 * Schattierung. Bei 18 Bildpunkten Breite ist alles andere ein Fleck. Wo
 * ein Wappen die Flagge ausmacht — Albanien, Kroatien —, steht eine
 * vereinfachte Andeutung; sie soll wiedererkennbar sein, nicht heraldisch
 * richtig.
 */

import type { Sprache } from '../lib/sprache';

/** Drei waagerechte Streifen von oben nach unten. */
function Quer({ farben }: { farben: [string, string, string] }) {
  return (
    <>
      <rect width="3" height="0.667" fill={farben[0]} />
      <rect y="0.667" width="3" height="0.667" fill={farben[1]} />
      <rect y="1.333" width="3" height="0.667" fill={farben[2]} />
    </>
  );
}

/** Drei senkrechte Streifen von links nach rechts. */
function Laengs({ farben }: { farben: [string, string, string] }) {
  return (
    <>
      <rect width="1" height="2" fill={farben[0]} />
      <rect x="1" width="1" height="2" fill={farben[1]} />
      <rect x="2" width="1" height="2" fill={farben[2]} />
    </>
  );
}

/** Zwei waagerechte Hälften. */
function Halb({ oben, unten }: { oben: string; unten: string }) {
  return (
    <>
      <rect width="3" height="1" fill={oben} />
      <rect y="1" width="3" height="1" fill={unten} />
    </>
  );
}

/** Eine Flagge in 3 : 2 — das Seitenverhältnis fast aller Nationalflaggen. */
export function Flagge({ code, size = 18 }: { code: Sprache; size?: number }) {
  const h = Math.round((size * 2) / 3);
  const rahmen = {
    width: size,
    height: h,
    viewBox: '0 0 3 2',
    className: 'shrink-0 rounded-[1px] ring-1 ring-black/40',
    'aria-hidden': true as const,
  };

  const inhalt = (() => {
    switch (code) {
      case 'de':
        return <Quer farben={['#000000', '#DD0000', '#FFCE00']} />;
      case 'tr':
        return (
          <>
            <rect width="3" height="2" fill="#E30A17" />
            {/* Mondsichel: ein weißer Kreis, aus dem ein roter Kreis beißt. */}
            <circle cx="1.15" cy="1" r="0.44" fill="#fff" />
            <circle cx="1.28" cy="1" r="0.35" fill="#E30A17" />
            <path d="M1.72 1 2.02 0.9 1.83 1.15 1.84 0.85 2.02 1.1Z" fill="#fff" />
          </>
        );
      case 'pl':
        return <Halb oben="#ffffff" unten="#DC143C" />;
      case 'ru':
        return <Quer farben={['#ffffff', '#0039A6', '#D52B1E']} />;
      case 'uk':
        return <Halb oben="#0057B7" unten="#FFD700" />;
      case 'ro':
        return <Laengs farben={['#002B7F', '#FCD116', '#CE1126']} />;
      case 'bg':
        return <Quer farben={['#ffffff', '#00966E', '#D62612']} />;
      case 'hr':
        return (
          <>
            <Quer farben={['#FF0000', '#ffffff', '#171796']} />
            {/* Das Schachbrett, auf vier Felder eingedampft. */}
            <rect x="1.35" y="0.7" width="0.15" height="0.15" fill="#FF0000" />
            <rect x="1.5" y="0.85" width="0.15" height="0.15" fill="#FF0000" />
            <rect x="1.35" y="0.85" width="0.15" height="0.15" fill="#ffffff" />
            <rect x="1.5" y="0.7" width="0.15" height="0.15" fill="#ffffff" />
            <rect x="1.35" y="0.7" width="0.3" height="0.3" fill="none" stroke="#171796" strokeWidth="0.04" />
          </>
        );
      case 'sr':
        return <Quer farben={['#C6363C', '#0C4076', '#ffffff']} />;
      case 'sq':
        return (
          <>
            <rect width="3" height="2" fill="#E41E20" />
            {/* Der Doppeladler, angedeutet: zwei Köpfe, ein Rumpf. */}
            <path
              d="M1.5 0.72 1.2 0.6 1.32 0.86 1.05 1.05 1.35 1.05 1.5 1.42 1.65 1.05 1.95 1.05 1.68 0.86 1.8 0.6Z"
              fill="#000000"
            />
          </>
        );
      case 'el':
        return (
          <>
            {/* Neun Streifen, auf fünf vereinfacht — mehr ist bei 12 px Höhe Brei. */}
            <rect width="3" height="2" fill="#ffffff" />
            {[0, 2, 4].map((i) => (
              <rect key={i} y={(i * 2) / 9} width="3" height={2 / 9} fill="#0D5EAF" />
            ))}
            <rect y={(6 * 2) / 9} width="3" height={2 / 9} fill="#0D5EAF" />
            <rect y={(8 * 2) / 9} width="3" height={2 / 9} fill="#0D5EAF" />
            <rect width={(5 * 2) / 9} height={(5 * 2) / 9} fill="#0D5EAF" />
            <rect x={(2 * 2) / 9} width={(2) / 9} height={(5 * 2) / 9} fill="#ffffff" />
            <rect y={(2 * 2) / 9} width={(5 * 2) / 9} height={(2) / 9} fill="#ffffff" />
          </>
        );
      case 'it':
        return <Laengs farben={['#009246', '#ffffff', '#CE2B37']} />;
      case 'es':
        return (
          <>
            <rect width="3" height="2" fill="#AA151B" />
            <rect y="0.5" width="3" height="1" fill="#F1BF00" />
          </>
        );
      case 'pt':
        return (
          <>
            <rect width="3" height="2" fill="#FF0000" />
            <rect width="1.2" height="2" fill="#006600" />
            <circle cx="1.2" cy="1" r="0.34" fill="#FFFF00" />
            <circle cx="1.2" cy="1" r="0.22" fill="#FF0000" />
          </>
        );
      case 'fr':
        return <Laengs farben={['#002395', '#ffffff', '#ED2939']} />;
      case 'nl':
        return <Quer farben={['#AE1C28', '#ffffff', '#21468B']} />;
      case 'en':
        return (
          <>
            {/* Union Jack, auf die drei Kreuze eingedampft. */}
            <rect width="3" height="2" fill="#012169" />
            <path d="M0 0 3 2M3 0 0 2" stroke="#ffffff" strokeWidth="0.42" />
            <path d="M0 0 3 2M3 0 0 2" stroke="#C8102E" strokeWidth="0.2" />
            <path d="M1.5 0V2M0 1H3" stroke="#ffffff" strokeWidth="0.66" />
            <path d="M1.5 0V2M0 1H3" stroke="#C8102E" strokeWidth="0.4" />
          </>
        );
      case 'ar':
        /*
         * **Keine Flagge, sondern ein Schriftzeichen.** Arabisch wird in
         * zwanzig Ländern gesprochen; welches davon sollte hier stehen? Eine
         * saudische Flagge für einen Syrer wäre schlechter als gar keine.
         * ع ist der Buchstabe, mit dem „arabisch" beginnt.
         */
        return (
          <>
            <rect width="3" height="2" fill="#1E5A46" />
            <text
              x="1.5"
              y="1.52"
              textAnchor="middle"
              fontSize="1.5"
              fill="#ffffff"
              fontFamily="system-ui, sans-serif"
            >
              ع
            </text>
          </>
        );
      default:
        return null;
    }
  })();

  return <svg {...rahmen}>{inhalt}</svg>;
}
