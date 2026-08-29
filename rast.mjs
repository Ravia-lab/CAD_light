import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
for (const name of process.argv.slice(2)) {
  const svg = readFileSync(`/tmp/plan-${name}.svg`, 'utf8');
  const page = await browser.newPage({ viewport: { width: 2000, height: 1400 }, deviceScaleFactor: 1.4 });
  await page.setContent(`<html><body style="margin:0;background:#fff">${svg}</body></html>`);
  await page.waitForTimeout(300);
  const el = await page.$('svg');
  await el.screenshot({ path: `/tmp/plan-${name}.png` });
  await page.close();
}
await browser.close();
console.log('ok');
