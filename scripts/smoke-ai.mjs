import { chromium } from 'playwright';

/**
 * Unter welcher Adresse geprüft wird.
 *
 * Vorgabe ist die Vorschau aus `vite preview`. Über `RAVIA_PROBE` lässt sich
 * stattdessen ein **echter Server** prüfen — und vor allem einer, der die
 * Anwendung unter einem **Unterpfad** ausliefert:
 *
 *     RAVIA_PROBE=http://localhost:8080/Cad_light/ node scripts/smoke-ui.mjs
 *
 * Das ist kein Beiwerk. Ein Build für einen Unterpfad schreibt andere
 * Adressen in die index.html, und ob die stimmen, zeigt sich nur, wenn man
 * genau dort prüft. Der abschließende Schrägstrich gehört dazu.
 */
const BASIS = process.env.RAVIA_PROBE ?? 'http://localhost:4177/';

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1600, height: 950 }, deviceScaleFactor: 2 });
const errs = [];
p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
p.on('console', m => { if (m.type() === 'error' && !m.text().includes('Failed to load resource')) errs.push(m.text()); });
// Die Rauchtests prüfen Fachplaner-Funktionen; der Auslieferungszustand ist
// bewusst der einfache Modus. Also vorher umschalten.
// Die Einführung beim allerersten Start würde jeden Klick abfangen. Sie
// gehört zur Anwendung und wird an genau einer Stelle geprüft
// (`smoke:ux`); überall sonst wird sie als „schon gesehen" markiert.
await p.addInitScript(() => {
  localStorage.setItem('ravia-ui-mode', 'profi');
  localStorage.setItem('ravia-einfuehrung', '1');
});


await p.goto(BASIS, { waitUntil: 'networkidle' });
await p.waitForTimeout(800);
await p.screenshot({ path: './screenshots/ai-0-start.png' });

// Referenz-Tab, Bild hochladen
await p.getByRole('button', { name: 'Referenz' }).click();
await p.setInputFiles('input[type=file][accept*="image"]', './scripts/fixtures/plan.png');
await p.waitForTimeout(900);
await p.screenshot({ path: './screenshots/ai-1-uploaded.png' });

// Auto-Trace
await p.getByRole('button', { name: 'Grundriss automatisch erkennen' }).click();
await p.waitForTimeout(3500);
await p.screenshot({ path: './screenshots/ai-2-trace.png' });
console.log('STATUS nach Analyse:', (await p.locator('footer').innerText()).replace(/\n/g,' | '));

// Einen Vektor auswählen und verwerfen
const box = await p.locator('canvas').boundingBox();
await p.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.18);
await p.waitForTimeout(400);
await p.screenshot({ path: './screenshots/ai-3-selected.png' });

// Übernehmen
await p.getByRole('button', { name: 'Vorschlag übernehmen' }).click();
await p.waitForTimeout(1200);
await p.screenshot({ path: './screenshots/ai-4-accepted.png' });
console.log('STATUS nach Übernahme:', (await p.locator('footer').innerText()).replace(/\n/g,' | '));

// Kalibrieren aktivieren
await p.getByRole('button', { name: 'Maßstab kalibrieren (2-Punkt)' }).click();
await p.waitForTimeout(300);
await p.mouse.move(box.x + box.width*0.25, box.y + box.height*0.8);
await p.mouse.down();
await p.mouse.move(box.x + box.width*0.7, box.y + box.height*0.8, { steps: 12 });
await p.mouse.up();
await p.waitForTimeout(500);
await p.screenshot({ path: './screenshots/ai-5-calibrate.png' });

console.log('ERRORS:', errs.length ? errs.join('\n') : 'keine');
await b.close();
