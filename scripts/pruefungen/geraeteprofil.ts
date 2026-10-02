/**
 * Prüfblock: Geräteprofil für die RaVia-Seite (Embed-API 1.8.0).
 * ---------------------------------------------------------------------------
 *
 * Die Kennungen unten sind die, die die Browser tatsächlich senden — das
 * Entscheidende ist die zweite: **Safari auf dem iPad meldet sich seit
 * iPadOS 13 als Mac.** Ein Prüffall mit einer „iPad"-Kennung allein prüfte
 * also den Fall, der in der Praxis kaum vorkommt, und ließe den häufigen
 * durch. Unterschieden wird dann nur an `maxTouchPoints`: ein Mac meldet 0,
 * ein iPad 5.
 *
 * Jede Erwartung folgt aus der Regel in `geraeteprofil.ts`, nicht aus einem
 * Lauf:
 *
 *   iPhone in der Kennung                         → phone
 *   iPad in der Kennung                           → tablet
 *   Macintosh + mehr als ein Berührpunkt          → tablet (iPad als Mac)
 *   feiner Zeiger                                 → desktop (auch mit Touch)
 *   grober Zeiger, kürzere Bildschirmseite < 600  → phone, sonst tablet
 */

import type { CheckFn } from './typ';
import { geraeteprofil, TABLET_AB, type Geraetemerkmale } from '../../src/lib/geraeteprofil';

const UA = {
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  // Chrome auf dem iPhone ist Safari mit anderem Namen — die Kennung trägt trotzdem „iPhone".
  iphoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.6668.69 Mobile/15E148 Safari/604.1',
  ipadMobil:
    'Mozilla/5.0 (iPad; CPU OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
  // iPadOS-Safari im Standard: „Desktop-Website anfordern" ist ab Werk an.
  macSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  androidPhone:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
  androidTablet:
    'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  windows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
};

const m = (teil: Partial<Geraetemerkmale>): Geraetemerkmale => ({
  userAgent: '',
  maxTouchPoints: 0,
  zeigerGrob: false,
  bildschirmBreite: 1920,
  bildschirmHoehe: 1080,
  fensterBreite: 1920,
  fensterHoehe: 1000,
  ...teil,
});

export function pruefeGeraeteprofil(check: CheckFn): void {
  console.log('\n▸ Geräteprofil — getDeviceProfile für die RaVia-Seite');

  // --- iPhone ---------------------------------------------------------------
  // iPhone 15: 393 × 852 CSS-Pixel, Fenster in Safari kleiner (Leisten).
  {
    const p = geraeteprofil(m({ userAgent: UA.iphone, maxTouchPoints: 5, zeigerGrob: true,
      bildschirmBreite: 393, bildschirmHoehe: 852, fensterBreite: 393, fensterHoehe: 659 }));
    check('Geräteprofil · iPhone Safari → phone', p.form, 'phone');
    check('Geräteprofil · iPhone → touch', p.touch, true);
    check('Geräteprofil · iPhone → Grund aus der Kennung', p.grund, 'kennung-iphone');
    check('Geräteprofil · width ist das Fenster (393)', p.width, 393);
    check('Geräteprofil · height ist das Fenster (659), nicht der Bildschirm', p.height, 659);
  }
  check('Geräteprofil · Chrome auf dem iPhone → phone',
    geraeteprofil(m({ userAgent: UA.iphoneChrome, maxTouchPoints: 5, zeigerGrob: true })).form, 'phone');
  {
    // Quer gedreht: Fenster 852 × 361 — die Form bleibt Telefon.
    const p = geraeteprofil(m({ userAgent: UA.iphone, maxTouchPoints: 5, zeigerGrob: true,
      bildschirmBreite: 852, bildschirmHoehe: 393, fensterBreite: 852, fensterHoehe: 361 }));
    check('Geräteprofil · iPhone quer bleibt phone', p.form, 'phone');
    check('Geräteprofil · … und meldet die neue Fensterbreite 852', p.width, 852);
  }

  // --- iPad -----------------------------------------------------------------
  {
    // iPad Air 11": 820 × 1180, meldet sich als Mac.
    const p = geraeteprofil(m({ userAgent: UA.macSafari, maxTouchPoints: 5, zeigerGrob: true,
      bildschirmBreite: 820, bildschirmHoehe: 1180, fensterBreite: 820, fensterHoehe: 1106 }));
    check('Geräteprofil · iPad mit Mac-Kennung → tablet', p.form, 'tablet');
    check('Geräteprofil · … erkannt als iPad-als-Mac', p.grund, 'ipad-als-mac');
  }
  check('Geräteprofil · iPad mit iPad-Kennung → tablet',
    geraeteprofil(m({ userAgent: UA.ipadMobil, maxTouchPoints: 5, zeigerGrob: true })).form, 'tablet');
  {
    // Geteilte Ansicht: das Fenster ist 320 breit — schmaler als jedes Telefon.
    // Die Form hängt an der Kennung und am Bildschirm, nicht am Fenster.
    const p = geraeteprofil(m({ userAgent: UA.macSafari, maxTouchPoints: 5, zeigerGrob: true,
      bildschirmBreite: 1180, bildschirmHoehe: 820, fensterBreite: 320, fensterHoehe: 800 }));
    check('Geräteprofil · iPad in geteilter Ansicht (320 px) bleibt tablet', p.form, 'tablet');
    check('Geräteprofil · … mit Fensterbreite 320', p.width, 320);
  }

  // --- Mac: dieselbe Kennung, kein Finger -----------------------------------
  {
    const p = geraeteprofil(m({ userAgent: UA.macSafari, maxTouchPoints: 0, zeigerGrob: false }));
    check('Geräteprofil · Mac (gleiche Kennung, 0 Berührpunkte) → desktop', p.form, 'desktop');
    check('Geräteprofil · Mac → kein touch', p.touch, false);
  }
  // Ein Grafiktablett am Mac kann einen Berührpunkt melden — „mehr als einer" schützt davor.
  check('Geräteprofil · Mac mit 1 Berührpunkt bleibt desktop',
    geraeteprofil(m({ userAgent: UA.macSafari, maxTouchPoints: 1 })).form, 'desktop');

  // --- Windows mit Berührbildschirm: Maus ist der Hauptzeiger ---------------
  {
    const p = geraeteprofil(m({ userAgent: UA.windows, maxTouchPoints: 10, zeigerGrob: false }));
    check('Geräteprofil · Notebook mit Touch und Maus → desktop', p.form, 'desktop');
    check('Geräteprofil · … aber touch = true', p.touch, true);
    check('Geräteprofil · … Grund: feiner Zeiger', p.grund, 'feiner-zeiger');
  }

  // --- Android: kürzere Bildschirmseite gegen 600 ---------------------------
  check(`Geräteprofil · Schwelle Telefon/Tablet ${TABLET_AB} px`, TABLET_AB, 600);
  check('Geräteprofil · Android-Telefon 412 × 915 → phone',
    geraeteprofil(m({ userAgent: UA.androidPhone, maxTouchPoints: 5, zeigerGrob: true,
      bildschirmBreite: 412, bildschirmHoehe: 915 })).form, 'phone');
  check('Geräteprofil · Android-Telefon quer 915 × 412 → phone',
    geraeteprofil(m({ userAgent: UA.androidPhone, maxTouchPoints: 5, zeigerGrob: true,
      bildschirmBreite: 915, bildschirmHoehe: 412 })).form, 'phone');
  check('Geräteprofil · Android-Tablet 800 × 1280 → tablet',
    geraeteprofil(m({ userAgent: UA.androidTablet, maxTouchPoints: 5, zeigerGrob: true,
      bildschirmBreite: 800, bildschirmHoehe: 1280 })).form, 'tablet');
  // Grenzwerte: 599 ist Telefon, 600 ist Tablet.
  check('Geräteprofil · kurze Seite 599 → phone',
    geraeteprofil(m({ zeigerGrob: true, maxTouchPoints: 5, bildschirmBreite: 599, bildschirmHoehe: 900 })).form, 'phone');
  check('Geräteprofil · kurze Seite 600 → tablet',
    geraeteprofil(m({ zeigerGrob: true, maxTouchPoints: 5, bildschirmBreite: 600, bildschirmHoehe: 900 })).form, 'tablet');

  // --- Kaputte Eingaben -----------------------------------------------------
  {
    const p = geraeteprofil(m({ userAgent: '', maxTouchPoints: Number.NaN, zeigerGrob: false,
      fensterBreite: Number.NaN, fensterHoehe: -5 }));
    check('Geräteprofil · leere Kennung, NaN-Berührpunkte → desktop', p.form, 'desktop');
    check('Geräteprofil · NaN-Breite wird 0, keine NaN im Vertrag', p.width, 0);
    check('Geräteprofil · negative Höhe wird 0', p.height, 0);
  }
  {
    // Kein Bildschirmmaß: Rückfall auf das Fenster.
    const p = geraeteprofil(m({ zeigerGrob: true, maxTouchPoints: 5, bildschirmBreite: 0, bildschirmHoehe: 0,
      fensterBreite: 375, fensterHoehe: 700 }));
    check('Geräteprofil · ohne Bildschirmmaß entscheidet das Fenster (375 → phone)', p.form, 'phone');
  }

  // --- Vertrag: genau diese Felder ------------------------------------------
  {
    const p = geraeteprofil(m({ userAgent: UA.iphone, maxTouchPoints: 5, zeigerGrob: true }));
    check('Geräteprofil · Felder des Vertrags', Object.keys(p).sort().join(','), 'form,grund,height,touch,width');
  }
}
