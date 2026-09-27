/**
 * Prüfblock „Der Scan als Datei".
 *
 * **Warum es diesen Block gibt.** Der Scan aus **RaVia Scan** (iPhone,
 * LiDAR/RoomPlan) kam bis 1.62.0 nur über die Einbettung herein — RaVia prüft
 * ihn und reicht ihn mit `loadBuilding` durch. Wer ihn am Schreibtisch ansehen
 * oder vorführen wollte, hatte nur die Datei, und die wurde an den
 * Projektleser weitergereicht und mit „Datei konnte nicht gelesen werden"
 * abgewiesen — obwohl das Programm genau dieses Format liest.
 *
 * Was der **Inhalt** eines Scans ergibt, prüft der Block „Gebäudescan" gegen
 * eine echte Ausgabe der App. Hier geht es nur um die beiden Dinge, die mit
 * dem Dateiweg dazugekommen sind:
 *
 *  1. **Die Erkennung.** Sie muss den Scan finden und darf nichts anderes
 *     für einen halten. Eine Erkennung, die zu viel fängt, schickt ein
 *     Projekt in den Scan-Import und wirft damit ein Modell weg.
 *  2. **Die mitgelieferte Beispieldatei.** Sie ist das, was der Knopf
 *     „Beispielscan laden" öffnet. Sie muss beiliegen, ein Scan sein — und
 *     **dieselbe** Datei wie die geprüfte Vorlage: Zwei Kopien laufen
 *     auseinander, und die ausgelieferte wäre dann die ungeprüfte.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { CheckFn } from './typ';
import { importBuildingModel, istGebaeudescan } from '../../src/lib/buildingModelImport';
import { buildReferenceDocument } from '../reference';
import { buildRaviaExport } from '../../src/lib/raviaExport';
import { buildIfc } from '../../src/lib/ifcExport';

/** Die Beispieldatei liegt neben der Anwendung — `public/` wird mit ausgeliefert. */
const BEISPIEL = path.join(process.cwd(), 'public', 'beispiele', 'lidar-scan-beispiel.json');
/** Dieselbe Aufnahme als Prüfvorlage — der Block „Gebäudescan" rechnet daran. */
const VORLAGE = path.join(process.cwd(), 'scripts', 'referenz', 'ravia-building-beispiel.json');

interface RbmDatei {
  format?: string;
  schemaVersion?: string;
  source?: { kind?: string; app?: { name?: string }; device?: { model?: string }; capturedAt?: string };
  walls?: unknown[];
  openings?: unknown[];
  emitters?: unknown[];
  levels?: unknown[];
  quality?: { assumptions?: { code?: string; count?: number }[] };
}

export function pruefeScandatei(check: CheckFn): void {
  // =========================================================================
  // 1 · Die Datei liegt bei und ist ein Scan
  // =========================================================================
  const vorhanden = fs.existsSync(BEISPIEL);
  check('Scandatei · der Beispielscan liegt bei', vorhanden, true);
  if (!vorhanden) return;

  const text = fs.readFileSync(BEISPIEL, 'utf8');
  check('Scandatei · er wird als Scan erkannt', istGebaeudescan(text), true);

  let datei: RbmDatei;
  try {
    datei = JSON.parse(text) as RbmDatei;
  } catch {
    check('Scandatei · die Beispieldatei ist lesbares JSON', false, true);
    return;
  }
  check('Scandatei · Formatkennzeichen', datei.format ?? 'fehlt', 'ravia.building');
  check('Scandatei · Schema 1.x', String(datei.schemaVersion ?? '').split('.')[0], '1');
  /*
   * Die Herkunft gehört in die Datei, sonst ist sie eine Zeichnung ohne
   * Absender: Wer hat wann womit aufgenommen? Der Block „LiDAR-Scan
   * übernehmen" verspricht genau das, und was versprochen wird, wird geprüft.
   */
  check('Scandatei · Aufnahmeart steht dabei', datei.source?.kind ?? 'fehlt', 'roomplan');
  check('Scandatei · die App steht dabei', datei.source?.app?.name ?? 'fehlt', 'RaVia Scan');
  check('Scandatei · das Gerät steht dabei', Boolean(datei.source?.device?.model), true);
  check('Scandatei · der Aufnahmezeitpunkt steht dabei', Boolean(datei.source?.capturedAt), true);

  // =========================================================================
  // 2 · Die Erkennung fängt nichts anderes
  // =========================================================================
  {
    /*
     * Ein Projektexport ist ebenfalls JSON und beginnt ebenfalls mit einer
     * geschweiften Klammer. Hielte die Erkennung ihn für einen Scan, ginge
     * beim Öffnen das Modell verloren, das in der Datei steht.
     */
    const doc = buildReferenceDocument();
    const projekt = JSON.stringify(buildRaviaExport(doc));
    check('Scandatei · ein Projektexport ist keiner', istGebaeudescan(projekt), false);
    check('Scandatei · eine IFC-Datei ist keiner', istGebaeudescan(buildIfc(doc).slice(0, 4000)), false);
    // Der RoomPlan-Rohscan des iPhones — der geht in den anderen Import.
    check('Scandatei · ein RoomPlan-Rohscan ist keiner', istGebaeudescan('{"roomData":{"walls":[]}}'), false);
    check('Scandatei · leerer Text ist keiner', istGebaeudescan(''), false);
    check('Scandatei · reiner Text ist keiner', istGebaeudescan('kein json'), false);
    /*
     * Und die Gegenprobe zur Gegenprobe: Das Kennzeichen wird **im ganzen
     * Text** gesucht. Steht es erst hinter einem Kilobyte Heizkörperdaten,
     * muss es trotzdem gefunden werden — sonst wäre die Erkennung von der
     * Feldreihenfolge des Absenders abhängig.
     */
    const spaet = `{"emitters":[${'{"id":"h"},'.repeat(200)}{"id":"x"}],"format":"ravia.building"}`;
    check('Scandatei · auch weit hinten im Text gefunden', istGebaeudescan(spaet), true);
  }

  // =========================================================================
  // 3 · Die ausgelieferte Datei ist die geprüfte Datei
  // =========================================================================
  {
    /*
     * Der Block „Gebäudescan" rechnet an `scripts/referenz/…` nach: Azimute,
     * Wandlängen, Lage der Heizkörper, keine erfundene Leistung. Damit diese
     * Arbeit auch für das gilt, was der Knopf im Programm lädt, muss es
     * dieselbe Datei sein — Zeichen für Zeichen. Zwei Kopien derselben
     * Aufnahme wären zwei Dateien, von denen nur eine geprüft ist.
     */
    const vorlage = fs.existsSync(VORLAGE) ? fs.readFileSync(VORLAGE, 'utf8') : '';
    check('Scandatei · die Prüfvorlage liegt vor', vorlage.length > 0, true);
    check('Scandatei · der ausgelieferte Scan ist dieselbe Datei', text === vorlage, true);

    /*
     * Und er kommt wirklich mit ausgeliefert: `public/` wird beim Bauen
     * unverändert neben die Anwendung gelegt. Läge die Datei woanders, wäre
     * der Knopf im Programm ein Knopf ins Leere.
     */
    check('Scandatei · sie liegt im ausgelieferten Verzeichnis', BEISPIEL.includes(`${path.sep}public${path.sep}`), true);

    const e = importBuildingModel(JSON.parse(text));
    check('Scandatei · sie lässt sich übernehmen', e.ok, true);
    check('Scandatei · und bringt Wände mit', e.walls.length > 0, true);
  }
}
