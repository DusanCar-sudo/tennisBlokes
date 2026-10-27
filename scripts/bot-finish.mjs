// Finish-bot: enters the frozen 3-2 match-point state, then plays the final
// point(s) with real input through match end, results, and rematch.
import { chromium } from 'playwright-core';

const CHROME = '/home/dusan/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--headless=new', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.stack || e.message));

await page.goto('http://127.0.0.1:5188/', { waitUntil: 'load' });
await page.waitForFunction(() => window.__SUNSET_SLAM_DEV__ && window.__THREE_GAME_DIAGNOSTICS__, null, { timeout: 20000 });
await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.seed(42));
await page.evaluate(async () => {
  await window.__THREE_GAME_TEST_HOOKS__.setState('match-point');
  await window.__THREE_GAME_TEST_HOOKS__.setPausedForScreenshot(false);
});
await page.waitForTimeout(500);

const read = () => page.evaluate(() => {
  const g = window.__SUNSET_SLAM_DEV__;
  return {
    phase: g.phase, serve: g.serve.state, server: g.server,
    score: { ...g.score }, labels: g.scoreLabels(), matchPoint: g.matchPoint,
    matchWinner: g.matchWinner, rally: g.rally,
    ball: { mode: g.ball.mode, x: g.ball.pos.x, z: g.ball.pos.z, last: g.ball.lastHitter },
    player: { x: g.player.pos.x },
    ready: g.getHitInfo().ready,
    resultsHidden: document.getElementById('results-screen').hidden,
    resultTitle: document.getElementById('result-title').textContent,
    stats: document.getElementById('stat-points').textContent + '/' + document.getElementById('stat-speed').textContent + '/' + document.getElementById('stat-rally').textContent,
  };
});

let moveKeys = new Set();
async function holdMove(dir) {
  for (const key of moveKeys) await page.keyboard.up(key);
  moveKeys.clear();
  if (dir === 'left') { await page.keyboard.down('KeyA'); moveKeys.add('KeyA'); }
  else if (dir === 'right') { await page.keyboard.down('KeyD'); moveKeys.add('KeyD'); }
}

console.log('START', JSON.stringify(await read()));
const deadline = Date.now() + 420_000;
let lastKey = '';
while (Date.now() < deadline) {
  const s = await read();
  if (s.phase === 'over' && !s.resultsHidden) break;
  if (s.phase === 'serve' && s.server === 'player') {
    if (s.serve === 'toss') await page.keyboard.press('Space');
    await holdMove(null);
  } else if (s.phase === 'rally') {
    if (s.ball.last === 'rival' && s.ball.z > -0.5) {
      const dx = s.ball.x - s.player.x;
      if (Math.abs(dx) > 0.35) await holdMove(dx < 0 ? 'left' : 'right');
      else await holdMove(null);
      if (s.ready) await page.keyboard.press('Space');
    } else {
      const dx = -0.4 - s.player.x;
      if (Math.abs(dx) > 0.5) await holdMove(dx < 0 ? 'left' : 'right');
      else await holdMove(null);
    }
  } else await holdMove(null);
  const key = `${s.phase}|${s.score.player}-${s.score.rival}`;
  if (key !== lastKey) { console.log('TICK', JSON.stringify(s)); lastKey = key; }
  await page.waitForTimeout(60);
}
await holdMove(null);
const finalState = await read();
console.log('FINAL', JSON.stringify(finalState, null, 1));
await page.screenshot({ path: 'artifacts/raw/bot-matchpoint-result.png' });
if (!finalState.resultsHidden) {
  await page.locator('#rematch-btn').click();
  await page.waitForTimeout(700);
  console.log('REMATCH', JSON.stringify(await read()));
  await page.screenshot({ path: 'artifacts/raw/bot-rematch.png' });
  // Quit to title also needs proof.
  await page.locator('#title-btn').click();
  await page.waitForTimeout(500);
  console.log('TITLE', JSON.stringify(await read()));
  await page.screenshot({ path: 'artifacts/raw/bot-title-return.png' });
}
console.log('ERRORS', errors.slice(0, 8).join('\n') || '(none)');
await browser.close();
