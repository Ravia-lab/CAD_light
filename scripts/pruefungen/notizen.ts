/**
 * Prüfblock „Notizebene" — der Radierer und der Weg durch die Projektdatei.
 *
 * **Warum ausgerechnet das geprüft wird.** An einer Notizebene können genau
 * zwei Dinge schiefgehen, und beide fallen im Vorführfall nicht auf.
 *
 * Das erste ist der **Radierer**: Er löscht ganze Striche. Greift er zu
 * weit, nimmt er den Nachbarn mit — und der ist weg, bevor jemand merkt,
 * dass er weg ist. Greift er zu kurz, muss man zielen, und Zielen mit dem
 * Stift auf einem Tablet, das man in der anderen Hand hält, ist genau das,
 * was diese ganze Ausbaustufe vermeiden soll. Geprüft wird deshalb nicht
 * „radiert er", sondern **wo die Grenze liegt**: knapp innerhalb trifft,
 * knapp außerhalb trifft nicht.
 *
 * Das zweite ist der **Speicherweg**. Eine Notiz, die beim Speichern
 * verschwindet, schreibt niemand ein zweites Mal — und sie verschwindet
 * leise: kein Fehler, keine Meldung, nur eine leere Ebene beim nächsten
 * Öffnen. Deshalb wird hier ein Dokument mit Notizen durch Serialisierung
 * und Rücklesen geschickt und danach nachgezählt.
 */

import type { CheckFn } from './typ';
import type { Freihandstrich, Vec2 } from '../../src/types/bim';
import { RADIER_RADIUS, abstandZuZug, getroffene, trifft } from '../../src/lib/notizen';

/** Ein gerader Strich von a nach b, in n Punkten abgetastet. */
function strich(id: string, a: Vec2, b: Vec2, levelId = 'L0', n = 20): Freihandstrich {
  const punkte: Vec2[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    punkte.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return { id, levelId, punkte, createdAt: '2026-01-01T00:00:00.000Z' };
}

export function pruefeNotizen(check: CheckFn): void {
  // =========================================================================
  // 1 · Der Abstand zum Streckenzug
  // =========================================================================
  {
    const zug: Vec2[] = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
    ];
    check('Ein Punkt auf dem Zug hat Abstand null', abstandZuZug({ x: 1, y: 0 }, zug), 0, 1e-9);
    check('Senkrecht daneben zählt der Lotabstand', abstandZuZug({ x: 1, y: 0.4 }, zug), 0.4, 1e-9);
    // Hinter dem Ende gilt der Abstand zum Endpunkt, nicht zur verlängerten
    // Geraden — sonst würde der Radierer eine Fortsetzung treffen, die es
    // gar nicht gibt.
    check('Hinter dem Ende zählt der Endpunkt', abstandZuZug({ x: 2, y: 3 }, zug), 1, 1e-9);
    check('Ein leerer Zug ist unendlich weit weg', Number.isFinite(abstandZuZug({ x: 0, y: 0 }, [])), false);
    check('Ein einzelner Punkt zählt als Punkt', abstandZuZug({ x: 3, y: 0 }, [{ x: 0, y: 0 }]), 3, 1e-9);
  }

  // =========================================================================
  // 2 · Wo die Grenze des Radierers liegt
  // =========================================================================
  {
    const notiz = strich('a', { x: 0, y: 0 }, { x: 2, y: 0 }).punkte;
    const knappDrin = [{ x: 1, y: RADIER_RADIUS - 0.005 }, { x: 1.2, y: RADIER_RADIUS - 0.005 }];
    const knappDraussen = [{ x: 1, y: RADIER_RADIUS + 0.005 }, { x: 1.2, y: RADIER_RADIUS + 0.005 }];
    check('Knapp innerhalb des Fassradius trifft', trifft(notiz, knappDrin), true);
    check('Knapp außerhalb trifft nicht', trifft(notiz, knappDraussen), false);
    check('Der Fassradius ist 12 cm', RADIER_RADIUS, 0.12, 1e-9);
  }

  // =========================================================================
  // 3 · Der Fall, für den beide Richtungen geprüft werden
  // =========================================================================
  {
    // Eine schnelle Querbewegung liefert nur wenige Ereignisse: zwei Punkte
    // weit ober- und unterhalb der Notiz. Keiner der beiden liegt im
    // Fassradius — die Bahn kreuzt den Strich trotzdem. Nur weil auch der
    // Strich gegen die Bahn geprüft wird, fällt er.
    const notiz = strich('a', { x: 0, y: 0 }, { x: 2, y: 0 }).punkte;
    const querDurch: Vec2[] = [
      { x: 1, y: -1.5 },
      { x: 1, y: 1.5 },
    ];
    check('Einmal quer durchgestrichen trifft', trifft(notiz, querDurch), true);
    // Gegenprobe: dieselbe Bewegung 50 cm neben dem Strichende darf nicht
    // treffen. Sonst wäre die beidseitige Prüfung nur großzügig und nicht
    // richtig.
    const daneben: Vec2[] = [
      { x: 2.5, y: -1.5 },
      { x: 2.5, y: 1.5 },
    ];
    check('Dieselbe Bewegung daneben trifft nicht', trifft(notiz, daneben), false);
  }

  // =========================================================================
  // 4 · Der Radierer bleibt im Geschoss und beim Getroffenen
  // =========================================================================
  {
    const notizen: Record<string, Freihandstrich> = {
      a: strich('a', { x: 0, y: 0 }, { x: 2, y: 0 }),
      b: strich('b', { x: 0, y: 1 }, { x: 2, y: 1 }),
      c: strich('c', { x: 0, y: 0 }, { x: 2, y: 0 }, 'L1'),
    };
    const bahn: Vec2[] = [{ x: 1, y: 0 }, { x: 1.4, y: 0 }];
    const treffer = getroffene(notizen, bahn, 'L0');
    check('Der berührte Strich fällt', treffer.includes('a'), true);
    check('Der Nachbar 1 m weiter bleibt', treffer.includes('b'), false);
    // Der gleiche Strich im anderen Geschoss liegt an derselben Stelle. Wer
    // ihn mitlöscht, löscht in einem Plan, den er gerade nicht ansieht.
    check('Das andere Geschoss bleibt unberührt', treffer.includes('c'), false);
    check('Genau ein Treffer', treffer.length, 1);
    check('Eine leere Bahn trifft nichts', getroffene(notizen, [], 'L0').length, 0);
  }

  // =========================================================================
  // 5 · Der Speicherweg — die Stelle, an der so etwas still verlorengeht
  // =========================================================================
  {
    // Die Projektdatei ist das serialisierte Dokument. Was JSON.stringify
    // nicht mitnimmt, ist beim nächsten Öffnen weg — ohne Fehlermeldung.
    const doc = {
      meta: { name: 'P' },
      activeLevelId: 'L0',
      freihand: {
        a: { ...strich('a', { x: 0, y: 0 }, { x: 1, y: 0 }), druck: [0.4, 0.6] },
      },
    };
    const zurueck = JSON.parse(JSON.stringify(doc)) as typeof doc;
    check('Die Notiz übersteht das Speichern', Object.keys(zurueck.freihand).length, 1);
    check('… mit ihren Punkten', zurueck.freihand.a.punkte.length, doc.freihand.a.punkte.length);
    check('… und mit dem Stiftdruck', zurueck.freihand.a.druck?.length ?? 0, 2);
    check('… und der Radierer findet sie wieder', getroffene(zurueck.freihand, [{ x: 0.5, y: 0 }], 'L0').length, 1);
  }

  // =========================================================================
  // 6 · Grenzfälle, die nicht abstürzen dürfen
  // =========================================================================
  {
    check('Ein leerer Strich wird nicht getroffen', trifft([], [{ x: 0, y: 0 }]), false);
    check('Ohne Notizen fällt nichts', getroffene({}, [{ x: 0, y: 0 }], 'L0').length, 0);
    // Ein stehender Stift: hundert Ereignisse an derselben Stelle. Der
    // Radierer muss ihn trotzdem greifen — sonst ist ein Punkt nicht mehr
    // löschbar, nur noch über „Alle löschen".
    const punkt: Record<string, Freihandstrich> = {
      p: { id: 'p', levelId: 'L0', punkte: Array.from({ length: 100 }, () => ({ x: 3, y: 3 })), createdAt: '' },
    };
    check('Ein stehengebliebener Punkt lässt sich radieren', getroffene(punkt, [{ x: 3.05, y: 3 }], 'L0').length, 1);
  }
}
