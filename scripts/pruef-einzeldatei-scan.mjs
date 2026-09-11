/** Die Einzeldatei muss den Raumscan genauso lesen wie die Serverfassung. */
import { chromium } from 'playwright';
import { resolve } from 'node:path';
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args:['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox']});
const p = await b.newPage({ viewport:{width:1500,height:900} });
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
p.on('console',m=>{if(m.type()==='error'&&!m.text().includes('Failed to load resource'))errs.push(m.text());});
await p.addInitScript(()=>{localStorage.setItem('ravia-ui-mode','profi');localStorage.setItem('ravia-einfuehrung','1');});
p.on('dialog', d=>void d.accept());
await p.goto('file://' + resolve('dist-einzeldatei/RaVia-CAD-Light.html'), {waitUntil:'networkidle'});
await p.waitForTimeout(1200);
await p.locator('header input[type=file][accept*="json"]').first().setInputFiles('./scripts/referenz/raumscan-beispiel.json');
await p.waitForTimeout(2500);
const f = (await p.locator('footer').innerText()).replace(/\n/g,' | ');
console.log('Statuszeile:', f.match(/\d+ Wände · \d+ Öffnungen · \d+ Räume/)?.[0] ?? '—');
await p.locator('button:has-text("Prüfung")').first().click(); await p.waitForTimeout(600);
await p.locator('button:has-text("Begradigen")').click(); await p.waitForTimeout(1000);
for(let i=0;i<4;i++){const k=p.locator('aside button:has-text("Tür")').first(); if(!(await k.count()))break; await k.click(); await p.waitForTimeout(900);}
const g = (await p.locator('footer').innerText()).replace(/\n/g,' | ');
console.log('nach Aufmaß :', g.match(/\d+ Wände · \d+ Öffnungen · \d+ Räume/)?.[0] ?? '—');
console.log('Fehler      :', errs.length ? errs.slice(0,3) : 'keine');
await b.close();
process.exit(errs.length ? 1 : 0);
