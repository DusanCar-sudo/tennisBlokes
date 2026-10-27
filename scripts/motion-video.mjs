// Records a short in-game rally (real input) as motion evidence.
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';

const CHROME = '/home/dusan/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
const URL = process.env.GAME_URL || 'http://127.0.0.1:4173/';
await mkdir('artifacts/pass-2', { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--headless=new', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  recordVideo: { dir: 'artifacts/pass-2', size: { width: 1280, height: 720 } },
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__ && window.__THREE_GAME_DIAGNOSTICS__, null, { timeout: 20000 });

// Jump straight into a live rally and play it with real input for ~75s wall
// time (SwiftShader dilates game time, so this covers serve + several shots).
await page.evaluate(async () => {
  await window.__THREE_GAME_TEST_HOOKS__.setState('active-play');
  await window.__THREE_GAME_TEST_HOOKS__.setPausedForScreenshot(false);
});

let moveKeys = new Set();
async function hold(dir) {
  for (const k of moveKeys) await page.keyboard.up(k);
  moveKeys.clear();
  if (dir === 'left') { await page.keyboard.down('KeyA'); moveKeys.add('KeyA'); }
  else if (dir === 'right') { await page.keyboard.down('KeyD'); moveKeys.add('KeyD'); }
}

let hits = 0;
const end = Date.now() + 75_000;
while (Date.now() < end) {
  const s = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.getState());
  if (s.phase === 'serve' && s.server === 'player' && s.serve === 'toss') {
    await page.keyboard.press('Space'); hits++;
  } else if (s.phase === 'rally' && s.last === 'rival' && s.ballZ > -0.5) {
    const dx = s.ballX - s.playerX;
    await hold(Math.abs(dx) > 0.35 ? (dx < 0 ? 'left' : 'right') : null);
    if (s.ready) { await page.keyboard.press('Space'); hits++; }
  } else {
    await hold(null);
  }
  await page.waitForTimeout(70);
}
await hold(null);
const final = await page.evaluate(() => {
  const s = window.__THREE_GAME_TEST_HOOKS__.getState();
  return { score: `${s.score.player}-${s.score.rival}`, rally: s.rally, phase: s.phase };
});
console.log('MOTION', JSON.stringify({ hits, ...final, errors: errors.length }));
await context.close(); // finalizes the video
await browser.close();
