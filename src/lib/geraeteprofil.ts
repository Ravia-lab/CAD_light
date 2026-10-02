/**
 * Auf welchem Gerät läuft CAD Light? — die eine Antwort für beide Seiten.
 * ---------------------------------------------------------------------------
 *
 * **Warum CAD Light das der RaVia-Seite sagt.** Die RaVia-Seite zeigt den
 * Knopf „Gebäude scannen" je nach Gerät anders: am Rechner einen QR-Code, am
 * iPad „Mit diesem iPad scannen", am iPhone gar keinen QR-Code, weil man das
 * Telefon schon in der Hand hat. Dafür muss sie das Gerät kennen. Rät sie
 * selbst und CAD Light rät daneben noch einmal, gibt es zwei Antworten — und
 * an genau einem Gerät, das keiner von beiden getestet hat, widersprechen sie
 * sich: Der Dialog bietet den QR-Code an, während CAD Light schon die
 * Telefonansicht zeigt. Deshalb fragt die Seite (Embed-API 1.8.0,
 * `getDeviceProfile`), und CAD Light rät genau einmal.
 *
 * **Die Reihenfolge der Regeln**, und warum gerade diese:
 *
 *  1. **iPhone** an der Kennung des Browsers (`iPhone`, `iPod`). Eindeutig;
 *     Safari auf dem iPhone verstellt sich nicht.
 *  2. **iPad** an `iPad` in der Kennung — oder, seit iPadOS 13, an einer
 *     Mac-Kennung (`Macintosh`) mit mehr als einem Berührpunkt. Das iPad
 *     meldet sich in Safari standardmäßig als Mac, damit Webseiten ihm die
 *     Rechnerfassung geben. Ein echter Mac hat keinen Berührbildschirm und
 *     meldet `maxTouchPoints` 0. Ohne diese Regel wäre jedes iPad ein
 *     Desktop — und bekäme den QR-Code, den es selbst nicht lesen kann.
 *  3. **Sonst entscheidet der Zeiger**: Ist der Hauptzeiger grob
 *     (`pointer: coarse`, also ein Finger), ist es ein Telefon oder ein
 *     Tablet; ist er fein (Maus, Stift, Touchpad), ist es ein Rechner —
 *     auch dann, wenn der Bildschirm zusätzlich Berührung kann. Ein
 *     Notebook mit Berührbildschirm wird mit der Maus bedient und soll die
 *     Rechneransicht behalten.
 *  4. Bei grobem Zeiger trennt die **kürzere Bildschirmseite** Telefon und
 *     Tablet, Grenze 600 CSS-Pixel. Das ist die Schwelle, die Android selbst
 *     für Tablet-Layouts benutzt („smallest width 600 dp"); Telefone liegen
 *     mit der kurzen Seite bei 360–430, Tablets ab 600.
 *
 * **Bildschirm, nicht Fenster.** Die Form wird an der kürzeren Seite des
 * *Bildschirms* entschieden, nicht des Fensters. Sonst würde ein iPad in der
 * geteilten Ansicht (320 Pixel breit) zum Telefon, und ein Telefon würde beim
 * Drehen kurz zum Tablet — die Form eines Geräts ändert sich nicht, wenn man
 * es dreht. `width` und `height` im Ergebnis sind dagegen das **Fenster**,
 * weil es das ist, was die Gegenstelle für ihre Anordnung braucht.
 *
 * **Was hier nicht erkannt wird: LiDAR.** Ob ein Gerät einen LiDAR-Sensor
 * hat, lässt sich aus dem Browser nicht feststellen — weder die Kennung noch
 * eine Schnittstelle verrät es. Die App RaVia Scan prüft das selbst. Dieses
 * Profil behauptet darüber nichts, und die RaVia-Seite soll es auch nicht.
 */

export type Geraeteform = 'phone' | 'tablet' | 'desktop';

/**
 * Woran die Form erkannt wurde. Zusatz zum Vertrag aus dem Auftrag — er
 * kostet nichts und erspart beim ersten falsch erkannten Gerät die Frage,
 * welche Regel gegriffen hat.
 */
export type Erkennungsgrund =
  | 'kennung-iphone'
  | 'kennung-ipad'
  | 'ipad-als-mac'
  | 'grober-zeiger-schmal'
  | 'grober-zeiger-breit'
  | 'feiner-zeiger';

export interface Geraeteprofil {
  /** Kann das Gerät Berührung — unabhängig davon, womit es bedient wird? */
  touch: boolean;
  form: Geraeteform;
  /** Fensterbreite in CSS-Pixeln (zum Zeitpunkt der Abfrage). */
  width: number;
  /** Fensterhöhe in CSS-Pixeln (zum Zeitpunkt der Abfrage). */
  height: number;
  grund: Erkennungsgrund;
}

/** Was aus dem Browser gelesen wird — getrennt, damit es prüfbar bleibt. */
export interface Geraetemerkmale {
  userAgent: string;
  maxTouchPoints: number;
  /** Ergebnis von `matchMedia('(pointer: coarse)')`. */
  zeigerGrob: boolean;
  bildschirmBreite: number;
  bildschirmHoehe: number;
  fensterBreite: number;
  fensterHoehe: number;
}

/** Kürzere Bildschirmseite, ab der ein Gerät mit Fingerbedienung ein Tablet ist [CSS-px]. */
export const TABLET_AB = 600;

const ganz = (v: number): number => (Number.isFinite(v) && v > 0 ? Math.round(v) : 0);

/** Die Entscheidung — eine reine Funktion. */
export function geraeteprofil(m: Geraetemerkmale): Geraeteprofil {
  const ua = m.userAgent ?? '';
  const punkte = Number.isFinite(m.maxTouchPoints) ? m.maxTouchPoints : 0;
  const touch = punkte > 0 || m.zeigerGrob;
  const width = ganz(m.fensterBreite);
  const height = ganz(m.fensterHoehe);
  const aus = (form: Geraeteform, grund: Erkennungsgrund): Geraeteprofil => ({ touch, form, width, height, grund });

  if (/iPhone|iPod/.test(ua)) return aus('phone', 'kennung-iphone');
  if (/iPad/.test(ua)) return aus('tablet', 'kennung-ipad');
  // „mehr als ein Berührpunkt" und nicht „mindestens einer": Ein Mac mit
  // angeschlossenem Grafiktablett kann einen Punkt melden, ein iPad meldet 5.
  if (/Macintosh/.test(ua) && punkte > 1) return aus('tablet', 'ipad-als-mac');
  if (!m.zeigerGrob) return aus('desktop', 'feiner-zeiger');

  const b = ganz(m.bildschirmBreite);
  const h = ganz(m.bildschirmHoehe);
  // Ohne Bildschirmmaß bleibt das Fenster — besser als gar keine Zahl.
  const kurz = b > 0 && h > 0 ? Math.min(b, h) : Math.min(width || Infinity, height || Infinity);
  return Number.isFinite(kurz) && kurz < TABLET_AB
    ? aus('phone', 'grober-zeiger-schmal')
    : aus('tablet', 'grober-zeiger-breit');
}

/** Die Merkmale aus einem echten Fenster lesen. */
export function geraetemerkmale(win: Window): Geraetemerkmale {
  const nav = win.navigator;
  let zeigerGrob = false;
  try {
    zeigerGrob = win.matchMedia?.('(pointer: coarse)').matches ?? false;
  } catch {
    // Ein Browser ohne matchMedia hat keinen Finger als Hauptzeiger.
  }
  return {
    userAgent: nav?.userAgent ?? '',
    maxTouchPoints: nav?.maxTouchPoints ?? 0,
    zeigerGrob,
    bildschirmBreite: win.screen?.width ?? 0,
    bildschirmHoehe: win.screen?.height ?? 0,
    fensterBreite: win.innerWidth,
    fensterHoehe: win.innerHeight,
  };
}
