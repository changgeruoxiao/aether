import { chromium } from 'playwright';
import { mkdir } from 'fs/promises';

await mkdir('shots', { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (err) => console.error('PAGEERROR', err.message));
page.on('console', (msg) => {
  if (msg.type() === 'error') console.error('CONSOLE', msg.text());
});

await page.goto('http://127.0.0.1:8765/', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(3500);

const chip = await page.locator('#view-chip').textContent();
console.log('initial view chip:', chip);
await page.screenshot({ path: 'shots/01-hero.png' });
console.log('shot hero');

await page.click('button.mode-btn[data-view="gears"]');
await page.waitForTimeout(1800);
console.log('gears chip:', await page.locator('#view-chip').textContent());
await page.screenshot({ path: 'shots/02-gears.png' });

await page.click('button.mode-btn[data-view="wings"]');
await page.waitForTimeout(1800);
console.log('wings chip:', await page.locator('#view-chip').textContent());
await page.screenshot({ path: 'shots/03-wings.png' });

await page.click('button.mode-btn[data-view="side"]');
await page.waitForTimeout(1800);
console.log('side chip:', await page.locator('#view-chip').textContent());
await page.screenshot({ path: 'shots/04-side.png' });

await page.click('button.mode-btn[data-view="hero"]');
await page.waitForTimeout(1800);
await page.click('#btn-pulse');
await page.waitForTimeout(350);
await page.screenshot({ path: 'shots/05-pulse.png' });
console.log('shot pulse');

console.log('ok');
await browser.close();
