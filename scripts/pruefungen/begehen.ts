/**
 * Prüfblock „Begehen" — komme ich durch die Tür, und bleibe ich in der Wand?
 *
 * **Warum ausgerechnet das geprüft wird.** Im Begehmodus prüft der Anwender
 * das Ergebnis gegen seine eigene Erfahrung, und zwar sofort: Läuft er durch
 * eine Wand, glaubt er dem Modell nicht mehr. Bleibt er in einer Tür hängen,
 * glaubt er dem Programm nicht mehr. Beides ist reine Geometrie — also
 * prüfbar, ohne Bildschirm.
 *
 * Die Zahlen hier sind keine Beobachtung, sondern folgen aus zwei Größen:
 * Körperradius 28 cm und halbe Wandstärke. Wer an einer 24er-Wand steht,
 * steht mit seiner Achse 12 + 28 = **40 cm** von der Wandachse entfernt —
 * das lässt sich ausrechnen und muss nicht gemessen werden.
 */

import type { CheckFn } from './typ';
import type { BimDocument, Vec2 } from '../../src/types/bim';
import {
  AUGENHOEHE,
  KOERPER_RADIUS,
  begehbar,
  begrenzeNick,
  blickrichtung,
  gehe,
  hindernisse,
  loese,
  stecktFest,
  schritt,
} from '../../src/lib/begehen';

/**
 * Ein Zimmer, 5 × 4 m Achsmaß, 24er-Wände, mit einer Tür in der Südwand.
 *
 * Die Tür sitzt bei 2,5 m mit 0,885 m Rohbaubreite — das übliche Maß für ein
 * Türblatt von 0,86 m.
 */
function baueZimmer(mitTuer = true, tuerBreite = 0.885): BimDocument {
  const nodes = {
    n1: { id: 'n1', x: 0, y: 0, levelId: 'eg' },
    n2: { id: 'n2', x: 5, y: 0, levelId: 'eg' },
    n3: { id: 'n3', x: 5, y: 4, levelId: 'eg' },
    n4: { id: 'n4', x: 0, y: 4, levelId: 'eg' },
  };
  const wand = (id: string, a: string, b: string) => ({
    id,
    levelId: 'eg',
    a,
    b,
    thickness: 0.24,
    height: 2.5,
    type: 'exterior',
    layerId: 'layer-walls',
  });
  return {
    meta: { name: 'Zimmer' },
    activeLevelId: 'eg',
    nodes,
    walls: {
      w1: wand('w1', 'n1', 'n2'),
      w2: wand('w2', 'n2', 'n3'),
      w3: wand('w3', 'n3', 'n4'),
      w4: wand('w4', 'n4', 'n1'),
    },
    openings: mitTuer
      ? {
          t1: {
            id: 't1',
            wallId: 'w1',
            kind: 'door',
            distance: 2.5,
            width: tuerBreite,
            height: 2.01,
            sillHeight: 0,
          },
          f1: {
            id: 'f1',
            wallId: 'w3',
            kind: 'window',
            distance: 2.5,
            width: 1.26,
            height: 1.385,
            sillHeight: 0.9,
          },
        }
      : {},
    rooms: {},
    site: { elements: {}, pumps: {} },
    diagnostics: { openEnds: [], closure: [] },
  } as unknown as BimDocument;
}

export function pruefeBegehen(check: CheckFn): void {
  // =========================================================================
  // 1 · Aus Wänden werden Hindernisse — mit Löchern an den richtigen Stellen
  // =========================================================================
  {
    const zu = hindernisse(baueZimmer(false), 'eg');
    check('Vier geschlossene Wände ergeben vier Hindernisse', zu.length, 4);

    const offen = hindernisse(baueZimmer(true), 'eg');
    // Die Südwand zerfällt in zwei Stücke, die übrigen bleiben ganz: 5 Teile.
    check('Die Tür teilt ihre Wand in zwei Stücke', offen.length, 5);

    // Das Fenster in der Nordwand darf **nicht** teilen — sonst liefe man
    // durch die Fensterbank.
    const nordteile = offen.filter((h) => Math.abs(h.a.y - 4) < 1e-6 && Math.abs(h.b.y - 4) < 1e-6);
    check('Das Fenster teilt seine Wand nicht', nordteile.length, 1);

    check('Eine Tür ist begehbar', begehbar({ kind: 'door', sillHeight: 0 } as never), true);
    check('Ein Durchgang auch', begehbar({ kind: 'passage', sillHeight: 0 } as never), true);
    check('Ein Fenster nicht', begehbar({ kind: 'window', sillHeight: 0 } as never), false);
    // Eine bodentiefe Verglasung reicht bis zum Boden und ist trotzdem zu.
    check('Eine bodentiefe Verglasung auch nicht', begehbar({ kind: 'window', sillHeight: 0 } as never), false);
    // Eine Tür mit Schwelle von 12 cm gilt nicht mehr als Loch.
    check('Eine hohe Schwelle zählt nicht als Loch', begehbar({ kind: 'door', sillHeight: 0.12 } as never), false);
  }

  // =========================================================================
  // 2 · Die Wand hält auf — und zwar auf den Zentimeter genau
  // =========================================================================
  {
    const hind = hindernisse(baueZimmer(true), 'eg');
    // Von der Raummitte gegen die Nordwand laufen (Achse y = 4) — und zwar
    // mit einem Schritt, der weit über die Wand hinauszielt. Genau daran ist
    // die erste Fassung gescheitert: Sie prüfte nur den Zielpunkt und ließ
    // einen hindurch.
    const ziel: Vec2 = { x: 1, y: 5 };
    const p = gehe({ x: 1, y: 2 }, ziel, hind);
    // Halbe Wandstärke 0,12 + Körperradius 0,28 = 0,40 m vor der Achse.
    check('Vor der Wand ist Schluss', p.y, 4 - 0.4, 1e-6);
    check('… und seitlich bleibt man, wo man war', p.x, 1, 1e-6);

    // Gegenprobe: ein Schritt, der gar nicht an die Wand reicht, bleibt
    // unverändert. Ein Hinderniskörper, der immer korrigiert, wäre schlimmer
    // als keiner.
    const frei = gehe({ x: 2.4, y: 2 }, { x: 2.5, y: 2 }, hind);
    check('Mitten im Raum wird nichts korrigiert', frei.x, 2.5, 1e-9);
    check('… auch nicht in der anderen Achse', frei.y, 2, 1e-9);
  }

  // =========================================================================
  // 3 · Durch die Tür kommt man
  // =========================================================================
  {
    const hind = hindernisse(baueZimmer(true), 'eg');
    // Mitten durch die Tür bei x = 2,5 nach draußen.
    const durch = gehe({ x: 2.5, y: 1 }, { x: 2.5, y: -0.5 }, hind);
    check('Durch die Tür geht es hinaus', durch.y, -0.5, 1e-9);
    check('… ohne seitlich abgedrängt zu werden', durch.x, 2.5, 1e-9);

    // Und direkt neben der Tür eben nicht.
    const daneben = gehe({ x: 1.2, y: 1 }, { x: 1.2, y: -0.5 }, hind);
    check('Neben der Tür hält die Wand', daneben.y, 0.4, 1e-6);

    // Eine zu schmale Öffnung lässt den Körper nicht durch: 50 cm Rohbau
    // ergeben bei 28 cm Radius keine 56 cm — man wird ausgedrückt.
    const schmal = hindernisse(baueZimmer(true, 0.5), 'eg');
    const gedrueckt = gehe({ x: 2.5, y: 1 }, { x: 2.5, y: -0.5 }, schmal);
    check('Durch eine 50er-Öffnung kommt man nicht', gedrueckt.y > 0.3, true);
    check('… und steckt dabei nicht in der Wand', stecktFest(gedrueckt, schmal), false);
    // Gegenprobe mit derselben Rechnung: durch die Regeltür kommt man.
    const regel = hindernisse(baueZimmer(true), 'eg');
    check('Durch die Regeltür schon', gehe({ x: 2.5, y: 1 }, { x: 2.5, y: -0.5 }, regel).y, -0.5, 1e-9);
  }

  // =========================================================================
  // 4 · Die Innenecke — der Fall, für den zweimal gerechnet wird
  // =========================================================================
  {
    const hind = hindernisse(baueZimmer(false), 'eg');
    // Schräg in die Nordwestecke laufen. Nach *einer* Korrekturrunde stünde
    // man noch in der anderen Wand.
    const p = gehe({ x: 2.5, y: 2 }, { x: -0.3, y: 4.3 }, hind);
    check('In der Ecke hält beides', p.x >= 0.4 - 1e-6, true);
    check('… in beiden Achsen', p.y <= 3.6 + 1e-6, true);
    // Und man landet nicht irgendwo weit draußen.
    check('Man wird nicht aus dem Raum geschleudert', p.x < 1 && p.y > 3, true);
  }

  // =========================================================================
  // 4b · Der Fall, an dem die erste Fassung gescheitert ist
  // =========================================================================
  {
    const hind = hindernisse(baueZimmer(false), 'eg');
    // Ein Schritt von 3 m quer durch das ganze Zimmer und durch die Wand
    // hindurch. Wer nur den Zielpunkt prüft, lässt ihn durch: dort draußen
    // ist keine Wand mehr in der Nähe.
    const durchgerauscht = gehe({ x: 2.5, y: 2 }, { x: 2.5, y: 7 }, hind);
    check('Ein großer Schritt tunnelt nicht', durchgerauscht.y, 3.6, 1e-6);

    // Und das Gleiten: schräg gegen die Wand laufen soll an ihr entlang
    // führen und nicht zum Stillstand.
    const gleitend = gehe({ x: 1, y: 3 }, { x: 2, y: 4.5 }, hind);
    check('An der Wand wird geglitten', gleitend.y, 3.6, 1e-6);
    check('… und man kommt dabei voran', gleitend.x > 1.5, true);

    // `loese` allein rührt einen freien Punkt nicht an.
    const frei = loese({ x: 2.5, y: 2 }, hind);
    check('Ein freier Punkt bleibt unberührt', frei.x === 2.5 && frei.y === 2, true);
  }

  // =========================================================================
  // 5 · Blick und Schritt
  // =========================================================================
  {
    const gerade = blickrichtung(0, 0);
    check('Gier 0 blickt nach +x', gerade.x, 1, 1e-9);
    check('… und nicht nach oben', gerade.z, 0, 1e-9);
    const hoch = blickrichtung(0, Math.PI / 4);
    check('Nicken hebt den Blick', hoch.z, Math.SQRT1_2, 1e-9);
    check('… und verkürzt die Waagerechte', hoch.x, Math.SQRT1_2, 1e-9);
    check('Der Nickwinkel wird begrenzt', begrenzeNick(Math.PI) < Math.PI / 2, true);
    check('… in beide Richtungen', begrenzeNick(-Math.PI) > -Math.PI / 2, true);

    // Ein Schritt geradeaus, eine Sekunde lang, mit Gehtempo.
    const s = schritt(0, 1, 0, 1.45, 1);
    check('Ein Schritt geradeaus ist so lang wie das Tempo', s.x, 1.45, 1e-9);
    check('… und geht nicht zur Seite', s.y, 0, 1e-9);
    // Seitwärts: rechts von +x ist −y.
    const quer = schritt(0, 0, 1, 1.45, 1);
    check('Seitwärts rechts geht nach −y', quer.y, -1.45, 1e-9);
    // Diagonal darf nicht schneller sein als geradeaus — der klassische Fehler.
    const diag = schritt(0, 1, 1, 1.45, 1);
    check('Diagonal ist nicht schneller', Math.hypot(diag.x, diag.y), 1.45, 1e-9);
    check('Ohne Eingabe kein Schritt', Math.hypot(...Object.values(schritt(0, 0, 0, 1.45, 1))), 0, 1e-12);
  }

  // =========================================================================
  // 6 · Die Maße, auf denen alles steht
  // =========================================================================
  {
    check('Augenhöhe 1,65 m', AUGENHOEHE, 1.65, 1e-9);
    check('Körperradius 28 cm', KOERPER_RADIUS, 0.28, 1e-9);
    // Der Radius muss durch eine Regeltür passen: 0,885 Rohbau minus zwei
    // Zargen von je 2,5 cm ergibt 0,835 lichte Weite — der Durchmesser von
    // 56 cm liegt deutlich darunter.
    check('Er passt durch eine 0,885er-Tür', KOERPER_RADIUS * 2 < 0.835, true);
  }
}
