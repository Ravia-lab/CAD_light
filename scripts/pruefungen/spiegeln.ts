/**
 * Prüfblock „Spiegeln" — links und rechts tauschen, ohne etwas zu verlieren.
 *
 * **Warum dieser Block gebraucht wird.** Spiegeln sieht nach einer einzigen
 * Zeile aus (`x ↦ 2c − x`) und ist es nicht. An einem Grundriss hängen fünf
 * Größen, die *kein* Punkt sind und trotzdem eine Seite haben:
 *
 *   · die Aufschlagseite einer Tür (`flipSwing`) — sie steht auf der
 *     Wandnormalen, und die kehrt sich um;
 *   · der Versatz einer Maßkette (`offset`) — dasselbe Vorzeichen;
 *   · jede Drehung (Heizkörper, Treppe, Deckendurchbruch) — θ ↦ 180° − θ;
 *   · der Dachazimut und die Ausblasrichtung der Wärmepumpe — a ↦ −a, und
 *     das ist **nicht** dieselbe Formel, weil der Azimut von Nord im
 *     Uhrzeigersinn zählt statt von Ost gegen ihn;
 *   · die Öffnungsmitte `distance` — die sich gerade *nicht* ändern darf,
 *     weil sie entlang der Wandachse gemessen wird und die Knoten `a` und
 *     `b` ihre Rollen behalten.
 *
 * Wer eine davon vergisst, bekommt einen Plan, der stimmt, bis man davor
 * steht: Türen schlagen in den Nachbarraum, das Dach fällt nach Osten statt
 * nach Westen, die Heizkörper hängen in der Wand. Geprüft wird deshalb
 * dreifach — an von Hand gerechneten Einzelwerten, an der Selbstumkehr
 * (zweimal spiegeln ist nichts tun) und an den Erhaltungsgrößen des
 * Referenzhauses.
 *
 * Alle Sollwerte in diesem Block sind von Hand gerechnet und stehen als
 * Rechnung im Kommentar daneben. Keiner ist aus einem Probelauf abgelesen.
 */

import type { BimDocument, FloorplanImage } from '../../src/types/bim';
import { spiegleAzimut, spiegleDokument, spiegleWinkel } from '../../src/lib/spiegeln';
import { detectRooms } from '../../src/lib/roomDetection';
import { distance } from '../../src/lib/geometry';
import { buildReferenceDocument } from '../reference';
import type { CheckFn } from './typ';

export function pruefeSpiegeln(check: CheckFn): void {
  // === 1 — Die beiden Winkelformeln ========================================
  // Eine Drehung θ zeigt in Richtung (cos θ, sin θ). An der Senkrechtachse
  // wird daraus (−cos θ, sin θ) = Richtung 180° − θ, an der Waagerechtachse
  // (cos θ, −sin θ) = Richtung −θ.
  check('Drehung 0° an der Senkrechtachse → 180°', spiegleWinkel(0, 'senkrecht'), 180);
  check('Drehung 45° an der Senkrechtachse → 135°', spiegleWinkel(45, 'senkrecht'), 135);
  check('Drehung 90° an der Senkrechtachse bleibt 90°', spiegleWinkel(90, 'senkrecht'), 90);
  check('Drehung 45° an der Waagerechtachse → 315°', spiegleWinkel(45, 'waagerecht'), 315);
  check('Drehung 0° an der Waagerechtachse bleibt 0°', spiegleWinkel(0, 'waagerecht'), 0);

  // Der Azimut zählt von Nord im Uhrzeigersinn; die Richtung ist (sin a, cos a).
  // Senkrecht: (−sin a, cos a) = Azimut −a. Waagerecht: (sin a, −cos a) = 180° − a.
  // Anschaulich: an der Senkrechtachse tauschen Ost und West, an der
  // Waagerechtachse Nord und Süd.
  check('Azimut Nord bleibt an der Senkrechtachse Nord', spiegleAzimut(0, 'senkrecht'), 0);
  check('Azimut Ost wird an der Senkrechtachse West', spiegleAzimut(90, 'senkrecht'), 270);
  check('Azimut Süd bleibt an der Senkrechtachse Süd', spiegleAzimut(180, 'senkrecht'), 180);
  check('Azimut Nord wird an der Waagerechtachse Süd', spiegleAzimut(0, 'waagerecht'), 180);
  check('Azimut Ost bleibt an der Waagerechtachse Ost', spiegleAzimut(90, 'waagerecht'), 90);
  check('Azimut Nordost wird an der Senkrechtachse Nordwest', spiegleAzimut(45, 'senkrecht'), 315);

  // === 2 — Einzelwerte am Referenzhaus =====================================
  // Der Grundriss liegt in x ∈ [0, 10] und y ∈ [0, 8] — auf allen drei
  // Geschossen derselbe Umriss. Alle übrigen Bauteile (Heizkörper bei x = 3
  // und x = 8, Verteiler bei x = 0,6, Treppe bei x = 8, Gaube bei x = 3)
  // liegen dazwischen. Die Spiegelachse ist also x = (0 + 10)/2 = 5
  // beziehungsweise y = (0 + 8)/2 = 4.
  const doc = buildReferenceDocument();
  const s = spiegleDokument(doc, { achse: 'senkrecht', geschosse: 'alle' });

  check('Die Senkrechtachse liegt bei x = 5', s.lage, 5, 1e-9);
  check('Es gab etwas zu spiegeln', s.leer, false);

  // 2·5 − 0 = 10
  check('Ecke SW (0|0) wandert nach (10|0) — x', s.nodes['eg-sw'].x, 10, 1e-9);
  check('Ecke SW (0|0) wandert nach (10|0) — y bleibt', s.nodes['eg-sw'].y, 0, 1e-9);
  // 2·5 − 6 = 4
  check('Mittelknoten Süd (6|0) wandert nach (4|0)', s.nodes['eg-sm'].x, 4, 1e-9);
  // 2·5 − 10 = 0
  check('Ecke SO (10|0) wandert nach (0|0)', s.nodes['eg-se'].x, 0, 1e-9);
  check('Die y-Werte bleiben unberührt', s.nodes['eg-ne'].y, 8, 1e-9);

  // Die Wand behält ihre Knoten: `eg-w-s1` läuft weiter von `eg-sw` nach
  // `eg-sm`, nur liegen beide jetzt anders. Damit bleibt jede Angabe entlang
  // der Achse gültig — die Öffnungsmitte allen voran.
  check('Die Öffnungsmitte bleibt bei 3,00 m', s.openings['eg-o-s1'].distance, 3, 1e-9);
  check('Die Öffnungsbreite bleibt 2,00 m', s.openings['eg-o-s1'].width, 2, 1e-9);
  // Die Wandnormale kehrt sich um, also kippt die Aufschlagseite. Im
  // Referenzhaus ist `flipSwing` nirgends gesetzt — nach dem Spiegeln steht
  // es überall.
  check('Die Tür schlägt nach dem Spiegeln zur anderen Seite auf', s.openings['eg-o-d'].flipSwing === true, true);

  // Heizkörper 1 steht bei (3|0,4) mit Drehung 0°.
  // 2·5 − 3 = 7;  180° − 0° = 180°
  check('Heizkörper 1 wandert von x = 3 nach x = 7', s.fixtures['eg-f-hk1'].position.x, 7, 1e-9);
  check('Heizkörper 1 bleibt bei y = 0,4', s.fixtures['eg-f-hk1'].position.y, 0.4, 1e-9);
  check('Heizkörper 1 dreht sich auf 180°', s.fixtures['eg-f-hk1'].rotation, 180, 1e-9);
  // Verteiler bei (0,6|0,6): 2·5 − 0,6 = 9,4
  check('Der Verteiler wandert nach x = 9,4', s.fixtures['eg-f-vt'].position.x, 9.4, 1e-9);

  // Treppe bei (8|6,5): 2·5 − 8 = 2
  check('Die Treppe wandert nach x = 2', s.verticals['treppe'].position.x, 2, 1e-9);
  // Gaube bei (3|2): 2·5 − 3 = 7
  check('Die Gaube wandert nach x = 7', s.roofOpenings['gaube'].position.x, 7, 1e-9);

  // Leitung p1 läuft (0,6|0,6) → (3|0,6) → (3|0,4).
  // Gespiegelt: (9,4|0,6) → (7|0,6) → (7|0,4)
  check('Leitung p1 hat weiterhin drei Stützpunkte', s.pipes['eg-p1'].points.length, 3, 0);
  check('Leitung p1 beginnt bei x = 9,4', s.pipes['eg-p1'].points[0].x, 9.4, 1e-9);
  check('Leitung p1 endet bei x = 7', s.pipes['eg-p1'].points[2].x, 7, 1e-9);
  check('Leitung p1 endet weiterhin bei y = 0,4', s.pipes['eg-p1'].points[2].y, 0.4, 1e-9);

  // Das Satteldach im OG fällt nach Osten (Azimut 90°) — nach dem Spiegeln
  // nach Westen (270°).
  check('Die Dachrichtung dreht von Ost auf West', s.levels['og'].roof?.azimuth ?? -1, 270, 1e-9);
  check('Die Dachneigung bleibt', s.levels['og'].roof?.pitch ?? -1, 40, 1e-9);
  check('Der Firstversatz bleibt', s.levels['og'].roof?.ridgeOffset ?? -1, 0, 1e-9);

  // === 3 — Die Waagerechtachse =============================================
  const w = spiegleDokument(doc, { achse: 'waagerecht', geschosse: 'alle' });
  check('Die Waagerechtachse liegt bei y = 4', w.lage, 4, 1e-9);
  // 2·4 − 0 = 8
  check('Ecke SW (0|0) wandert nach (0|8) — y', w.nodes['eg-sw'].y, 8, 1e-9);
  check('Ecke SW (0|0) wandert nach (0|8) — x bleibt', w.nodes['eg-sw'].x, 0, 1e-9);
  // −0° = 0°
  check('Heizkörper 1 behält an der Waagerechtachse seine Drehung', w.fixtures['eg-f-hk1'].rotation, 0, 1e-9);
  // 180° − 90° = 90°: Ost bleibt Ost, wenn Nord und Süd tauschen.
  check('Die Dachrichtung bleibt an der Waagerechtachse Ost', w.levels['og'].roof?.azimuth ?? -1, 90, 1e-9);

  // === 4 — Selbstumkehr ====================================================
  // Zweimal an derselben Achse spiegeln ist nichts tun. Das ist keine
  // Zusatzeigenschaft, sondern die Definition: Wäre es nicht so, wäre eine
  // der Formeln oben keine Spiegelung, sondern eine Drehung.
  //
  // Die Achse stimmt beim zweiten Durchgang von selbst wieder, weil die
  // Ausdehnung des Gespiegelten dieselbe Mitte hat.
  const zurueck = spiegleDokument({ ...doc, ...s, walls: doc.walls }, { achse: 'senkrecht', geschosse: 'alle' });
  check('Die zweite Spiegelung findet dieselbe Achse', zurueck.lage, 5, 1e-9);
  check('Knoten sind wieder am Ausgangsort', JSON.stringify(zurueck.nodes) === JSON.stringify(doc.nodes), true);
  // Bei den Öffnungen wird die Aufschlagseite vor dem Vergleich auf einen
  // Wahrheitswert gebracht: Im Ausgangsdokument fehlt `flipSwing` ganz,
  // nach zwei Spiegelungen steht dort `false`. Das ist dieselbe Aussage in
  // anderer Schreibweise — und der Vergleich soll die Aussage prüfen, nicht
  // die Schreibweise.
  const seiten = (o: Record<string, { flipSwing?: boolean }>): string =>
    JSON.stringify(
      Object.entries(o)
        .map(([id, x]) => [id, { ...x, flipSwing: x.flipSwing === true }])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]), 'en')),
    );
  check('Öffnungen sind wieder im Ausgangszustand', seiten(zurueck.openings) === seiten(doc.openings), true);
  check('Einbauten sind wieder im Ausgangszustand', JSON.stringify(zurueck.fixtures) === JSON.stringify(doc.fixtures), true);
  check('Leitungen sind wieder im Ausgangszustand', JSON.stringify(zurueck.pipes) === JSON.stringify(doc.pipes), true);
  check('Die Dachrichtung ist wieder Ost', zurueck.levels['og'].roof?.azimuth ?? -1, 90, 1e-9);

  // === 5 — Erhaltungsgrößen ================================================
  // Eine Spiegelung ist längentreu. Jede Wandlänge muss deshalb auf den
  // Millimeter dieselbe bleiben — und mit ihr jede Öffnung, die hineinpasst.
  let groessteLaengenabweichung = 0;
  let oeffnungenAusserhalb = 0;
  for (const wand of Object.values(doc.walls)) {
    const vorher = distance(doc.nodes[wand.a], doc.nodes[wand.b]);
    const nachher = distance(s.nodes[wand.a], s.nodes[wand.b]);
    groessteLaengenabweichung = Math.max(groessteLaengenabweichung, Math.abs(vorher - nachher));
  }
  for (const o of Object.values(s.openings)) {
    const wand = doc.walls[o.wallId];
    if (!wand) continue;
    const laenge = distance(s.nodes[wand.a], s.nodes[wand.b]);
    if (o.distance - o.width / 2 < -1e-9 || o.distance + o.width / 2 > laenge + 1e-9) {
      oeffnungenAusserhalb++;
    }
  }
  check('Keine Wand ändert ihre Länge', groessteLaengenabweichung, 0, 1e-9);
  check('Keine Öffnung ragt aus ihrer Wand heraus', oeffnungenAusserhalb, 0, 0);

  // Die Raumerkennung muss dieselben Räume mit derselben Fläche finden. Sie
  // läuft auf der gespiegelten Geometrie ganz neu — wenn dabei ein Raum
  // verschwindet, ist der Umlaufsinn irgendwo gekippt.
  const egWaende = Object.values(doc.walls).filter((x) => x.levelId === 'eg');
  const vorherRaeume = detectRooms({
    walls: egWaende,
    nodes: doc.nodes,
    openings: Object.values(doc.openings),
    levelId: 'eg',
    defaultHeight: 2.75,
    northAngle: 0,
  });
  const nachherRaeume = detectRooms({
    walls: egWaende,
    nodes: s.nodes,
    openings: Object.values(s.openings),
    levelId: 'eg',
    defaultHeight: 2.75,
    northAngle: 0,
  });
  check('Es werden gleich viele Räume erkannt', nachherRaeume.length, vorherRaeume.length, 0);
  const flaecheVorher = vorherRaeume.reduce((sum, r) => sum + r.area, 0);
  const flaecheNachher = nachherRaeume.reduce((sum, r) => sum + r.area, 0);
  check('Die Summe der Raumflächen bleibt gleich', flaecheNachher, flaecheVorher, 1e-6);

  // === 6 — Das Referenzbild ================================================
  // Ein Bild von 1000 × 500 px bei 0,01 m/px ist 10,00 m breit und 5,00 m
  // hoch. `origin` ist die am Bildschirm links oben liegende Ecke, im Modell
  // also (x_min | y_max). Liegt sie bei (2|9), belegt das Bild
  // x ∈ [2, 12] und y ∈ [4, 9].
  const bild: FloorplanImage = {
    id: 'bild', src: '', name: 'plan.png',
    naturalWidth: 1000, naturalHeight: 500,
    origin: { x: 2, y: 9 }, scale: 0.01, rotation: 0,
    opacity: 0.5, visible: true, locked: true,
  };
  const mitBild: BimDocument = { ...doc, image: bild };

  // An x = 5 gespiegelt liegt das Bild bei x ∈ [−2, 8]; die linke obere Ecke
  // ist dann (−2|9).
  const b1 = spiegleDokument(mitBild, { achse: 'senkrecht', geschosse: 'alle', lage: 5 }).image;
  check('Das Bild wird seitenverkehrt aufgetragen', b1?.gespiegelt === true, true);
  check('Der Bildursprung wandert nach x = −2', b1?.origin.x ?? NaN, -2, 1e-9);
  check('Der Bildursprung bleibt bei y = 9', b1?.origin.y ?? NaN, 9, 1e-9);
  check('Die Bilddrehung bleibt 0°', b1?.rotation ?? NaN, 0, 1e-9);

  // An y = 4 gespiegelt liegt das Bild bei y ∈ [−1, 4]. Derselbe Rahmen wird
  // dann von der anderen Ecke her aufgespannt: Ursprung (12|−1), Drehung 180°
  // — die Breitenachse zeigt nach −x, die Höhenachse nach +y.
  const b2 = spiegleDokument(mitBild, { achse: 'waagerecht', geschosse: 'alle', lage: 4 }).image;
  check('Der Bildursprung wandert an der Waagerechtachse nach x = 12', b2?.origin.x ?? NaN, 12, 1e-9);
  check('Der Bildursprung wandert an der Waagerechtachse nach y = −1', b2?.origin.y ?? NaN, -1, 1e-9);
  check('Die Bilddrehung wird 180°', b2?.rotation ?? NaN, 180, 1e-9);

  // Gedrehtes Bild, an x = 0 gespiegelt. Ursprung (1|0), Drehung 30°.
  // Die Breitenachse zeigt nach R(30°)·(1|0) = (0,8660254|0,5); die Ecke am
  // anderen Ende der Breite liegt also bei
  //   (1 + 10·0,8660254 | 0 + 10·0,5) = (9,660254 | 5).
  // Gespiegelt an x = 0 wird daraus (−9,660254 | 5) — und das ist der neue
  // Ursprung, denn die Breitenachse kehrt sich um. Die Drehung wird −30°,
  // also 330°.
  const b3 = spiegleDokument(
    { ...mitBild, image: { ...bild, origin: { x: 1, y: 0 }, rotation: 30 } },
    { achse: 'senkrecht', geschosse: 'alle', lage: 0 },
  ).image;
  // Der Ursprung wird wie jede Koordinate auf den Millimeter gerundet:
  // −9,660254 m → −9,660 m.
  check('Gedrehtes Bild: Ursprung x', b3?.origin.x ?? NaN, -9.66, 1e-9);
  check('Gedrehtes Bild: Ursprung y', b3?.origin.y ?? NaN, 5, 1e-6);
  check('Gedrehtes Bild: Drehung 330°', b3?.rotation ?? NaN, 330, 1e-9);

  // === 7 — Umfang ==========================================================
  // Nur ein Geschoss: die anderen bleiben, wo sie sind. Das ist der Fall,
  // in dem gerade *ein* Plan eingelesen wurde.
  const nurEg = spiegleDokument(doc, { achse: 'senkrecht', geschosse: ['eg'] });
  check('Nur das EG: der EG-Knoten wandert', nurEg.nodes['eg-sw'].x, 10, 1e-9);
  check('Nur das EG: der OG-Knoten bleibt stehen', nurEg.nodes['og-sw'].x, 0, 1e-9);
  check('Nur das EG: das OG-Dach bleibt bei Ost', nurEg.levels['og'].roof?.azimuth ?? -1, 90, 1e-9);
  // Beim Geschossumfang bleibt das Grundstück unberührt — es gehört keinem
  // Geschoss, und ein mitgedrehtes Grundstück wäre ein Fehler, den niemand
  // sucht.
  check('Nur das EG: das Grundstück bleibt dasselbe Objekt', nurEg.site === doc.site, true);

  // Ein Geschoss ohne Inhalt liefert „nichts zu tun" statt einer Achse bei 0.
  const leer = spiegleDokument(doc, { achse: 'senkrecht', geschosse: ['gibt-es-nicht'] });
  check('Ein leeres Geschoss meldet sich als leer', leer.leer, true);
  check('Ein leeres Geschoss lässt alles stehen', leer.nodes['eg-sw'].x, 0, 1e-9);
}
