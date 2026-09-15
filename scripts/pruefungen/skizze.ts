/**
 * Prüfblock „Skizze" — aus einem Freihandstrich werden Wände.
 *
 * **Warum das eine Prüfung braucht und keine Vorführung.** Eine Erkennung,
 * die im Vorführfall gut aussieht, ist wertlos: der Vorführfall ist immer der
 * saubere Strich. Interessant sind die anderen — der zittrige, der in einer
 * Ecke doppelt angesetzte, der bewusst schräge, der fast, aber nicht ganz
 * geschlossene Ring. Genau die stehen hier.
 *
 * **Wie der Prüfstrich entsteht.** Nicht abgetippt aus einem Probelauf,
 * sondern **gerechnet**: eine ideale Strecke wird abgetastet und mit einem
 * Zittern überlagert, dessen Größe bekannt ist. Damit lässt sich sagen, was
 * herauskommen *muss* — bei 3 cm Zittern und 6 cm Vereinfachungstoleranz
 * bleibt eine Gerade eine Gerade, und das ist keine Beobachtung, sondern
 * eine Folge der beiden Zahlen.
 *
 * Das Zittern ist bewusst **nicht zufällig**: ein Prüflauf, der bei jedem
 * Durchgang etwas anderes prüft, ist kein Prüflauf. Es ist eine
 * Sinusschwingung mit fester Frequenz — dieselbe Größenordnung wie eine
 * zittrige Hand und in jedem Lauf dieselbe.
 */

import type { CheckFn } from './typ';
import type { Vec2 } from '../../src/types/bim';
import { erkenneSkizze, glaette, vereinfache } from '../../src/lib/skizze';

/**
 * Einen Zug abtasten und mit einem bekannten Zittern überlagern.
 *
 * **Warum das Zittern über den ganzen Zug läuft und nicht je Strecke.** Die
 * erste Fassung dieser Hilfe hat jede Strecke einzeln verzittert. An jeder
 * Ecke sprang die Auslenkung dadurch um mehrere Zentimeter — eine echte Hand
 * tut das nicht, sie zittert stetig weiter. Die Sprünge waren groß genug,
 * dass das Vereinfachen sie für Ecken hielt, und die Prüfung meldete Fehler,
 * die es im Programm gar nicht gab. Eine Prüfvorlage, die unrealistischer
 * ist als die Wirklichkeit, prüft das Falsche.
 *
 * Das Zittern ist eine Sinusschwingung über die **Bogenlänge**: stetig über
 * Ecken hinweg, in jedem Lauf dieselbe, und quer zur jeweiligen Richtung —
 * so wie eine Hand seitlich schwankt und nicht in Zeichenrichtung.
 */
function krakel(ecken: readonly Vec2[], punkteJeMeter: number, zittern: number, wellenJeMeter = 1.5): Vec2[] {
  const raus: Vec2[] = [];
  let bogen = 0;
  for (let i = 1; i < ecken.length; i++) {
    const a = ecken[i - 1];
    const b = ecken[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l = Math.hypot(dx, dy) || 1;
    const qx = -dy / l;
    const qy = dx / l;
    const n = Math.max(2, Math.round(l * punkteJeMeter));
    for (let k = i === 1 ? 0 : 1; k <= n; k++) {
      const t = k / n;
      const s2 = Math.sin((bogen + l * t) * wellenJeMeter * Math.PI * 2) * zittern;
      raus.push({ x: a.x + dx * t + qx * s2, y: a.y + dy * t + qy * s2 });
    }
    bogen += l;
  }
  return raus;
}

const laenge = (s: { a: Vec2; b: Vec2 }): number => Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
/** Winkel einer Strecke zur nächsten Achse [°] — 0 heißt achsparallel. */
const achsfehler = (s: { a: Vec2; b: Vec2 }): number => {
  const w = (Math.atan2(s.b.y - s.a.y, s.b.x - s.a.x) * 180) / Math.PI;
  const r = Math.abs(w - Math.round(w / 90) * 90);
  return Math.round(r * 100) / 100;
};

export function pruefeSkizze(check: CheckFn): void {
  // =========================================================================
  // 1 · Glätten und Vereinfachen für sich
  // =========================================================================
  {
    const roh: Vec2[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0.5 },
      { x: 2, y: 0 },
      { x: 3, y: 0.5 },
      { x: 4, y: 0 },
    ];
    const glatt = glaette(roh);
    check('Glätten behält die Punktzahl', glatt.length, roh.length);
    // Anfang und Ende bleiben unangetastet — sonst geht der Ring nicht mehr zu.
    check('Der Anfangspunkt bleibt liegen', glatt[0].x === 0 && glatt[0].y === 0, true);
    check('Der Endpunkt bleibt liegen', glatt[4].x === 4 && glatt[4].y === 0, true);
    check('Dazwischen wird gemittelt', Math.abs(glatt[1].y - 0.5) > 0.01, true);

    // Eine ideale Gerade mit vielen Punkten dampft auf zwei ein.
    const gerade = krakel([{ x: 0, y: 0 }, { x: 5, y: 0 }], 40, 0);
    check('Eine ideale Gerade bleibt eine Strecke', vereinfache(gerade).length, 2);
    // Ein deutlicher Knick bleibt erhalten.
    const knick = krakel([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }], 20, 0);
    check('Ein Knick bleibt eine Ecke', vereinfache(knick).length, 3);
    // Zwei Punkte lassen sich nicht vereinfachen und dürfen nicht abstürzen.
    check('Zwei Punkte bleiben zwei Punkte', vereinfache([{ x: 0, y: 0 }, { x: 1, y: 1 }]).length, 2);
    check('Ein Punkt bleibt ein Punkt', vereinfache([{ x: 0, y: 0 }]).length, 1);
  }

  // =========================================================================
  // 2 · Der zittrige gerade Strich
  // =========================================================================
  {
    // 3 cm Zittern quer, Vereinfachungstoleranz 6 cm: das Zittern liegt
    // vollständig innerhalb der Toleranz, also bleibt eine Strecke übrig.
    const s = erkenneSkizze(krakel([{ x: 0, y: 0 }, { x: 5, y: 0.08 }], 48, 0.03));
    check('Aus dem zittrigen Strich wird eine Strecke', s.strecken.length, 1);
    check('… mit rund fünf Metern', Math.round(laenge(s.strecken[0]) * 10) / 10, 5, 0.35);
    check('… und sie wird auf die Achse gezogen', s.strecken[0].ausgerichtet, true);
    // Eine **einzelne** Strecke richtet sich nach den Weltachsen und nicht
    // nach sich selbst — sonst bliebe sie genau so schief, wie sie gezogen
    // wurde, und das Ausrichten täte nichts.
    check('… und liegt dann wirklich auf ihr', achsfehler(s.strecken[0]), 0, 0.001);
    check('Der Strich war kein Ring', s.ring, false);
    check('Aus 240 Punkten wurden wenige', s.punkteEinfach <= 3, true);
    check('Die rohe Punktzahl wird mitgeteilt', s.punkteRoh, 241);
  }

  // =========================================================================
  // 3 · Das freihändig gekrakelte Zimmer
  // =========================================================================
  {
    // Ein 5 × 4 m großer Raum, um 7° verdreht gezeichnet, mit zittriger
    // Hand, und der Zug endet 25 cm neben seinem Anfang — so wie es
    // wirklich passiert.
    const w = (7 * Math.PI) / 180;
    const dreh = (p: Vec2): Vec2 => ({
      x: p.x * Math.cos(w) - p.y * Math.sin(w),
      y: p.x * Math.sin(w) + p.y * Math.cos(w),
    });
    const E = [
      dreh({ x: 0, y: 0 }),
      dreh({ x: 5, y: 0 }),
      dreh({ x: 5, y: 4 }),
      dreh({ x: 0, y: 4 }),
    ];
    const roh = krakel([...E, { x: E[0].x + 0.18, y: E[0].y + 0.17 }], 16, 0.035);

    const s = erkenneSkizze(roh);
    check('Aus dem Zug werden vier Wände', s.strecken.length, 4);
    check('Der Zug wird als Ring erkannt', s.ring, true);
    check('… und das steht in den Hinweisen', s.hinweise.some((h) => h.includes('geschlossen')), true);

    // Die Vorzugsrichtung ist die, in der gezeichnet wurde — 7°.
    check('Die Vorzugsrichtung wird gefunden', s.drehungGrad, 7, 0.6);

    // Alle vier liegen nach dem Ausrichten exakt auf ihren Achsen.
    check('Alle vier sind ausgerichtet', s.strecken.every((x) => x.ausgerichtet), true);
    // Geprüft wird zwischen den Strecken selbst und nicht gegen die
    // gemeldete Drehung: die ist auf ein Zehntelgrad gerundet, und an einer
    // Rundung soll keine Prüfung hängen.
    const bezug = (Math.atan2(s.strecken[0].b.y - s.strecken[0].a.y, s.strecken[0].b.x - s.strecken[0].a.x) * 180) / Math.PI;
    const rechtwinklig = s.strecken.every((x) => {
      const w2 = (Math.atan2(x.b.y - x.a.y, x.b.x - x.a.x) * 180) / Math.PI;
      const rel = w2 - bezug;
      return Math.abs(rel - Math.round(rel / 90) * 90) < 0.01;
    });
    check('… und stehen rechtwinklig zueinander', rechtwinklig, true);

    // Und der Ring ist wirklich zu: jede Wand endet dort, wo die nächste
    // anfängt. Das ist der Punkt, an dem die Raumerkennung später greift.
    let groessteLuecke = 0;
    for (let i = 0; i < s.strecken.length; i++) {
      const jetzt = s.strecken[i];
      const naechste = s.strecken[(i + 1) % s.strecken.length];
      groessteLuecke = Math.max(groessteLuecke, Math.hypot(naechste.a.x - jetzt.b.x, naechste.a.y - jetzt.b.y));
    }
    check('Die Ecken sind geschlossen', groessteLuecke < 1e-6, true);

    // Die Maße stimmen auf wenige Zentimeter — mehr kann eine Skizze nicht,
    // und mehr verspricht sie auch nicht.
    const laengen = s.strecken.map(laenge).sort((a, b) => a - b);
    check('Zwei Wände sind rund 4 m lang', Math.abs(laengen[0] - 4) < 0.3 && Math.abs(laengen[1] - 4) < 0.3, true);
    check('Zwei Wände sind rund 5 m lang', Math.abs(laengen[2] - 5) < 0.3 && Math.abs(laengen[3] - 5) < 0.3, true);
  }

  // =========================================================================
  // 4 · Was schräg gemeint war, bleibt schräg
  // =========================================================================
  {
    // Ein Erker: zwei achsparallele Wände und dazwischen eine 45°-Schräge.
    const roh = krakel([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 6, y: 2 }, { x: 6, y: 5 }], 18, 0.02);
    const s = erkenneSkizze(roh);
    check('Drei Strecken', s.strecken.length, 3);
    // Die 45°-Schräge liegt weit über der Ausrichttoleranz von 18° und
    // bleibt deshalb stehen. Sie zwangsweise auf die Achse zu ziehen hieße,
    // den Erker wegzurechnen.
    const schraege = s.strecken.filter((x) => !x.ausgerichtet);
    check('Die Schräge bleibt schräg', schraege.length, 1);
    // Sie behält ihre Richtung — auf das Grad genau, das eine freihändige
    // Linie überhaupt hergibt. Der Ausrichter fasst sie nicht an; was sie
    // um wenige Grad verschiebt, sind die beschnittenen Enden an den
    // ausgerichteten Nachbarn.
    check('… und bleibt bei rund 45°', achsfehler(schraege[0]), 45, 4);
    check('… und es steht in den Hinweisen', s.hinweise.some((h) => h.includes('schräg')), true);
    check('Die beiden anderen sind ausgerichtet', s.strecken.filter((x) => x.ausgerichtet).length, 2);
  }

  // =========================================================================
  // 5 · Die doppelt angesetzte Ecke
  // =========================================================================
  {
    // In der Ecke hat der Stift kurz abgesetzt und 12 cm daneben neu
    // angesetzt. Geprüft wird das **Ergebnis** und nicht, welcher Schritt den
    // Ausrutscher beseitigt hat: Zwei Wände, saubere Ecke. Ob ihn schon das
    // Vereinfachen wegnimmt oder erst das Schlucken kurzer Stücke, ist eine
    // Frage der inneren Einrichtung und keine Zusage an den Anwender.
    const roh = krakel([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4.1, y: 0.12 }, { x: 4.1, y: 3 }], 18, 0.015);
    const s = erkenneSkizze(roh);
    check('Der Ausrutscher wird nicht zur Wand', s.strecken.length, 2);
    check('Die Ecke ist zu', Math.hypot(s.strecken[1].a.x - s.strecken[0].b.x, s.strecken[1].a.y - s.strecken[0].b.y), 0, 1e-6);
    // Sie stehen rechtwinklig **zueinander** — nicht auf den Weltachsen. Die
    // Vorzugsrichtung dieser Skizze ist die, in der sie gezeichnet wurde
    // (hier 0,3° schief), und daran richtet sich beides aus. Wer auf einen
    // Bestand zeichnet, gibt dessen Richtung mit; wer neu anfängt, rückt den
    // Plan hinterher mit „Wände begradigen" gerade.
    const dreh = (x: { a: Vec2; b: Vec2 }): number => (Math.atan2(x.b.y - x.a.y, x.b.x - x.a.x) * 180) / Math.PI;
    const zwischen = Math.abs(dreh(s.strecken[1]) - dreh(s.strecken[0]));
    check('Die beiden Wände stehen rechtwinklig zueinander', zwischen, 90, 0.02);

    // Und der Fall, in dem wirklich das Schlucken greift: ein 20 cm hoher
    // Versatz mitten in einer geraden Wand. Er ist zu groß, als dass das
    // Vereinfachen ihn überginge, und zu klein für eine eigene Wand.
    const versatz = erkenneSkizze(
      krakel([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 0.2 }, { x: 8, y: 0.2 }], 18, 0.01),
    );
    check('Ein 20-cm-Versatz wird als Ecke gelesen, nicht als Wand', versatz.strecken.length, 1);
    check('… und der Anwender erfährt es', versatz.hinweise.some((h) => h.includes('kurze')), true);
    check('… und übrig bleibt eine durchgehende Wand', versatz.strecken[0].laenge, 8, 0.3);
  }

  // =========================================================================
  // 6 · Grenzfälle, die nicht abstürzen dürfen
  // =========================================================================
  {
    check('Ein leerer Strich ergibt nichts', erkenneSkizze([]).strecken.length, 0);
    check('… und sagt warum', erkenneSkizze([]).hinweise.length > 0, true);
    check('Ein einzelner Punkt ergibt nichts', erkenneSkizze([{ x: 1, y: 1 }]).strecken.length, 0);
    // Ein Punkt, auf dem der Stift stehen geblieben ist — hundert Ereignisse
    // an derselben Stelle.
    const stehen = Array.from({ length: 100 }, () => ({ x: 2, y: 2 }));
    const s = erkenneSkizze(stehen);
    check('Ein stehender Stift ergibt keine Wand', s.strecken.length, 0);
    check('… und keine Zahl, die keine ist', s.strecken.every((x) => Number.isFinite(x.laenge)), true);
    // Ein Kringel: rund, ohne Ecken. Er darf nicht in fünfzig Wandstückchen
    // zerfallen.
    const kringel: Vec2[] = Array.from({ length: 120 }, (_, i) => {
      const t = (i / 119) * Math.PI * 2;
      return { x: Math.cos(t) * 1.5, y: Math.sin(t) * 1.5 };
    });
    // Bei 1,5 m Halbmesser und 6 cm Vereinfachungstoleranz folgt die Zahl der
    // Sehnen aus der Geometrie: die Pfeilhöhe r·(1−cos(θ/2)) = 0,06 ergibt
    // θ ≈ 0,57 rad, also rund elf Sehnen. Geprüft wird, dass der Kringel
    // **nicht zerfällt** — nicht eine genaue Zahl, die niemand braucht.
    const rund = erkenneSkizze(kringel).strecken.length;
    check('Ein Kringel zerfällt nicht in Dutzende Wände', rund > 0 && rund <= 16, true);
  }

  // =========================================================================
  // 7 · Das Schrägstück in der Ecke — und die echte Schräge daneben
  // =========================================================================
  //
  // Der Fall stammt aus dem Rauchtest auf dem iPad: ein mit dem Stift
  // gezogenes Rechteck ergab **fünf** Wände, die fünfte ein 28 cm langes
  // Diagonalstück in einer Ecke. Der Stift hatte die Ecke in zwei Zügen
  // genommen; das Zwischenstück war mit 47 cm zu lang für die Schwelle von
  // 35 cm und mit 20° zu schräg zum Ausrichten. Geprüft wird beides: dass
  // das Stück fällt — und dass eine **gewollte** Schräge stehen bleibt.
  {
    // Ein Rechteck, dessen letzte Ecke der Stift in zwei Zügen genommen
    // hat: kurz vor der Ecke setzt er ab und trifft die untere Wand schräg.
    // Das Zwischenstück ist mit 48 cm zu lang für Schritt 3 und mit 20° zu
    // schräg zum Ausrichten — die Eckenrechnung schneidet es danach auf
    // 30 cm zusammen. Genau dieser Rest fällt.
    const mitEckstueck = krakel(
      [
        { x: 0, y: 3.7 },
        { x: 5.4, y: 3.7 },
        { x: 5.4, y: 0.18 },
        { x: 4.95, y: 0.02 },
        { x: 0, y: 0.14 },
        { x: 0, y: 3.7 },
      ],
      20,
      0.02,
    );
    const e = erkenneSkizze(mitEckstueck);
    check('Aus dem Rechteck mit Eckstück werden vier Wände', e.strecken.length, 4);
    check('… alle ausgerichtet', e.strecken.every((x) => x.ausgerichtet), true);
    check('… der Umriss bleibt geschlossen', e.ring, true);
    check('… und es steht im Bericht', e.hinweise.some((h) => h.includes('Schrägstück')), true);

    // Dieselbe Form mit einer echten Abschrägung von 85 cm: die gehört in
    // den Plan. Sie überlebt die Eckenrechnung, weil ihre Nachbarn sie
    // anschneiden, statt sich hinter ihr zu treffen.
    const mitFase = krakel(
      [
        { x: 0, y: 0 },
        { x: 5.4, y: 0 },
        { x: 5.4, y: -2.7 },
        { x: 4.8, y: -3.3 },
        { x: 0, y: -3.3 },
        { x: 0, y: 0 },
      ],
      18,
      0.02,
    );
    const f = erkenneSkizze(mitFase);
    check('Die abgeschrägte Ecke bleibt eine Wand', f.strecken.length, 5);
    check('… und zwar die schräge', f.strecken.filter((x) => !x.ausgerichtet).length, 1);
    const fase = f.strecken.find((x) => !x.ausgerichtet);
    check('… mit brauchbarer Länge', (fase?.laenge ?? 0) > 0.6, true);
  }

  // =========================================================================
  // 8 · Das Ausrichten lässt sich abschalten
  // =========================================================================
  {
    const roh = krakel([{ x: 0, y: 0 }, { x: 5, y: 0.4 }], 20, 0.02);
    const mit = erkenneSkizze(roh);
    const ohne = erkenneSkizze(roh, { ausrichten: false });
    check('Mit Ausrichten liegt sie auf der Achse', achsfehler(mit.strecken[0]), 0, 0.001);
    check('Ohne Ausrichten bleibt sie schief', achsfehler(ohne.strecken[0]) > 3, true);
    check('… und gilt nicht als ausgerichtet', ohne.strecken[0].ausgerichtet, false);
  }
}
