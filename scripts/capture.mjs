import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const URL = process.env.GAME_URL || 'http://127.0.0.1:5188/';
const CHROME = process.env.CHROME_PATH || '/home/dusan/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
const OUT = process.env.OUT_DIR || 'artifacts/raw';
const requested = process.argv.slice(2);
const states = requested.length ? requested : ['title', 'active-play', 'paused', 'match-won'];

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    '--headless=new',
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--ignore-gpu-blocklist',
  ],
});

const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const messages = [];
page.on('console', (message) => messages.push(`[${message.type()}] ${message.text()}`));
page.on('pageerror', (error) => messages.push(`[pageerror] ${error.stack || error.message}`));

await page.goto(URL, { waitUntil: 'load' });
await page.waitForSelector('canvas', { state: 'visible' });
await page.waitForFunction(() => Boolean(window.__THREE_GAME_TEST_HOOKS__), null, { timeout: 15000 });
await page.waitForTimeout(800);

for (const state of states) {
  await page.evaluate(async (name) => {
    await window.__THREE_GAME_TEST_HOOKS__.setState(name);
    await window.__THREE_GAME_TEST_HOOKS__.setPausedForScreenshot(true);
  }, state);
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(OUT, `${state}.png`), fullPage: false });
  const diag = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__);
  console.log(`CAPTURED ${state}:`, JSON.stringify(diag));
}

const gpu = await page.evaluate(() => {
  const canvas = document.querySelector('canvas');
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
  const ext = gl?.getExtension('WEBGL_debug_renderer_info');
  return {
    renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl?.getParameter(gl.RENDERER),
    vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl?.getParameter(gl.VENDOR),
  };
});
console.log('GPU:', JSON.stringify(gpu));
console.log('MESSAGES:', messages.filter((m) => !m.includes('[vite]')).slice(0, 50).join('\n') || '(none)');
await browser.close();
