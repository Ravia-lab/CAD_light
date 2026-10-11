/**
 * Prüfblock „createRoom" — ein Raum aus der Raumliste des Wirts.
 *
 * Geprüft wird `src/lib/hostRaum.ts` mit einem nachgebauten Anlegen, das
 * wie `addRoomTemplate` einen Raum mit dem aufgezogenen Rechteck als
 * Innenpolygon erzeugt. Der Store selbst bleibt außen vor, damit der Block
 * nichts aus `src/store` importiert (siehe `schichtgrenze.ts`).
 */
import type { CheckFn } from './typ';
import type { BimDocument, RoomUsage, Vec2 } from '../../src/types/bim';
import { createRoom, RAUM_STANDARDFLAECHE, type RaumVorlageAnlegen } from '../../src/lib/hostRaum';

function leeresDokument(): BimDocument {
  return { activeLevelId: 'L0', nodes: {}, rooms: {} } as unknown as BimDocument;
}

function nachbau(doc: BimDocument, aufrufe: { from: Vec2; to: Vec2; usage?: RoomUsage; name?: string }[]): RaumVorlageAnlegen {
  return (_kind, from, to, options) => {
    aufrufe.push({ from, to, ...options });
    const ecken = [from, { x: to.x, y: from.y }, to, { x: from.x, y: to.y }];
    ecken.forEach((p, i) => {
      doc.nodes[`n${Object.keys(doc.nodes).length}-${i}`] = { id: 'n', levelId: doc.activeLevelId, ...p } as never;
    });
    const id = `r${Object.keys(doc.rooms).length + 1}`;
    doc.rooms[id] = { id, levelId: doc.activeLevelId, innerPolygon: ecken } as never;
    return { walls: 4, area: (to.x - from.x) * (to.y - from.y) };
  };
}

export function pruefeHostRaum(check: CheckFn): void {
  {
    const doc = leeresDokument();
    const aufrufe: Parameters<typeof nachbau>[1] = [];
    const erg = createRoom(() => doc, nachbau(doc, aufrufe), { name: ' Küche ', usage: 'kitchen' });
    check('createRoom: ohne Fläche gilt die Standardfläche', erg.area ?? 0, RAUM_STANDARDFLAECHE, 0.05);
    check('createRoom: liefert die Kennung des neuen Raums', erg.roomId ?? '', 'r1');
    check('createRoom: Name ohne Leerzeichen am Rand', aufrufe[0]?.name ?? '', 'Küche');
    check('createRoom: Nutzung wird übernommen', aufrufe[0]?.usage ?? '', 'kitchen');
    check('createRoom: leeres Geschoss beginnt am Ursprung', aufrufe[0]?.from.x ?? -1, 0);

    const zwei = createRoom(() => doc, nachbau(doc, aufrufe), { name: 'Bad', usage: 'sauna', areaHint: 6.25 });
    check('createRoom: zweiter Raum rechts neben dem ersten', aufrufe[1]?.from.x ?? 0, 3.46 + 1, 0.001);
    check('createRoom: Fläche aus areaHint', zwei.area ?? 0, 6.25, 0.001);
    check('createRoom: unbekannte Nutzung wird other', aufrufe[1]?.usage ?? '', 'other');
  }
  {
    const doc = leeresDokument();
    const aufrufe: Parameters<typeof nachbau>[1] = [];
    const anlegen = nachbau(doc, aufrufe);
    check('createRoom: ohne Namen abgelehnt', createRoom(() => doc, anlegen, { name: '  ' }).ok, false);
    check('createRoom: ohne Anfrage abgelehnt', createRoom(() => doc, anlegen, null).ok, false);
    check('createRoom: negative Fläche abgelehnt', createRoom(() => doc, anlegen, { name: 'X', areaHint: -3 }).ok, false);
    check('createRoom: Fläche als Text abgelehnt', createRoom(() => doc, anlegen, { name: 'X', areaHint: '20' }).ok, false);
    check('createRoom: übergroße Fläche abgelehnt', createRoom(() => doc, anlegen, { name: 'X', areaHint: 5000 }).ok, false);
    check('createRoom: abgelehnte Anfragen legen nichts an', aufrufe.length, 0);
    const nichts: RaumVorlageAnlegen = () => null;
    check('createRoom: Fehlschlag beim Anlegen wird gemeldet', createRoom(() => doc, nichts, { name: 'X' }).ok, false);
  }
}
