/** Die Einzeldatei muss den Raumscan genauso lesen wie die Serverfassung. */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Eine Datei bauen, die aussieht wie das, was das iPhone wirklich ausgibt.
 *
 * Die Beispieldatei im Verzeichnis ist beschnitten: das USD-Netz
 * (`roomModelData`) ist heraus, weil der Import es nicht liest — 1,4 MB werden
 * so zu 49 kB. In der echten Ausgabe steht dieses Netz aber **vor** den
 * Raumdaten, und `roomData` beginnt erst bei Zeichen 486 099.
 *
 * Genau daran ist die Erkennung einmal gescheitert: sie schaute nur in die
 * ersten 4 kB, fand dort nichts und reichte die Datei an den Projektleser
 * weiter, der „Datei konnte nicht gelesen werden" meldete. Die Prüfungen
 * liefen grün, weil sie die beschnittene Datei benutzten — beim Verkleinern
 * war die Eigenschaft weggefallen, an der es scheitert.
 *
 * Deshalb wird das Netz hier als Attrappe wieder vorangestellt. Die Datei ist
 * dann so groß und so aufgebaut wie das Original, ohne dass 1,4 MB im
 * Verzeichnis liegen müssen.
 */
function wieVomGeraet(quelle) {
  const text = readFileSync(quelle, 'utf-8');
  const netz = 'A'.repeat(700 * 1024);
  const mitNetz = text.replace('{', `{"roomModelData":"${netz}",`);
  const ziel = join(tmpdir(), 'raumscan-wie-vom-geraet.json');
  writeFileSync(ziel, mitNetz);
  return { ziel, offset: mitNetz.indexOf('"roomData"') };
}
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args:['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox']});
const p = await b.newPage({ viewport:{width:1500,height:900} });
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
p.on('console',m=>{if(m.type()==='error'&&!m.text().includes('Failed to load resource'))errs.push(m.text());});
await p.addInitScript(()=>{localStorage.setItem('ravia-ui-mode','profi');localStorage.setItem('ravia-einfuehrung','1');});
p.on('dialog', d=>void d.accept());
await p.goto('file://' + resolve('dist-einzeldatei/RaVia-CAD-Light.html'), {waitUntil:'networkidle'});
await p.waitForTimeout(1200);
const echt = wieVomGeraet('./scripts/referenz/raumscan-beispiel.json');
console.log(`Datei wie vom Geraet: "roomData" ab Zeichen ${echt.offset}`);
if (echt.offset < 500000) { console.log('  ✗ Die Attrappe sitzt nicht vor den Raumdaten'); process.exit(1); }

await p.locator('header input[type=file][accept*="json"]').first().setInputFiles(echt.ziel);
await p.waitForTimeout(3000);
const f = (await p.locator('footer').innerText()).replace(/\n/g,' | ');
const gelesen = f.match(/\d+ Wände · \d+ Öffnungen · \d+ Räume/)?.[0] ?? '—';
console.log('Statuszeile:', gelesen);
if (gelesen !== '40 Wände · 17 Öffnungen · 9 Räume') {
  console.log('  ✗ Die Datei mit vorangestelltem 3D-Netz wurde nicht gelesen');
  process.exit(1);
}
await p.locator('button:has-text("Prüfung")').first().click(); await p.waitForTimeout(600);
await p.locator('button:has-text("Begradigen")').click(); await p.waitForTimeout(1000);
for(let i=0;i<4;i++){const k=p.locator('aside button:has-text("Tür")').first(); if(!(await k.count()))break; await k.click(); await p.waitForTimeout(900);}
const g = (await p.locator('footer').innerText()).replace(/\n/g,' | ');
console.log('nach Aufmaß :', g.match(/\d+ Wände · \d+ Öffnungen · \d+ Räume/)?.[0] ?? '—');
console.log('Fehler      :', errs.length ? errs.slice(0,3) : 'keine');
await b.close();
process.exit(errs.length ? 1 : 0);
