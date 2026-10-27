// Full-match bot: drives the game through real input (keys + space) from the
// title screen to the results screen, then rematches. Reports point-by-point
// progression, input responsiveness, and console errors.
import { chromium } from 'playwright-core';

const CHROME = '/home/dusan/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
const URL = process.env.GAME_URL || 'http://127.0.0.1:5188/';
const SEED = Number(process.env.SEED || 42);

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--headless=new', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.stack || e.message));

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => window.__SUNSET_SLAM_DEV__ && window.__THREE_GAME_DIAGNOSTICS__, null, { timeout: 20000 });
await page.evaluate((seed) => window.__THREE_GAME_TEST_HOOKS__.seed(seed), SEED);
await page.locator('#play-btn').click();
await page.waitForTimeout(400);

const read = () => page.evaluate(() => {
  const g = window.__SUNSET_SLAM_DEV__;
  return {
    phase: g.phase,
    paused: g.paused,
    serve: g.serve.state,
    server: g.server,
    score: { ...g.score },
    labels: g.scoreLabels(),
    rally: g.rally,
    matchWinner: g.matchWinner,
    ball: { mode: g.ball.mode, x: g.ball.pos.x, y: g.ball.pos.y, z: g.ball.pos.z, last: g.ball.lastHitter },
    player: { x: g.player.pos.x, z: g.player.pos.z },
    ready: g.getHitInfo().ready,
    resultsHidden: document.getElementById('results-screen').hidden,
    banner: !document.getElementById('point-banner').hidden ? document.getElementById('point-reason').textContent : null,
  };
});

const points = [];
let lastScoreKey = '0-0';
let hitCount = 0;
let swingWhiffs = 0;
let framesStalled = 0;
let lastPhase = 'intro';
let moveKeys = new Set();

async function holdMove(dir) {
  for (const key of moveKeys) await page.keyboard.up(key);
  moveKeys.clear();
  if (dir === 'left') { await page.keyboard.down('KeyA'); moveKeys.add('KeyA'); }
  else if (dir === 'right') { await page.keyboard.down('KeyD'); moveKeys.add('KeyD'); }
  else if (dir === 'up') { await page.keyboard.down('KeyW'); moveKeys.add('KeyW'); }
  else if (dir === 'down') { await page.keyboard.down('KeyS'); moveKeys.add('KeyS'); }
}

const deadline = Date.now() + 540_000; // 9 min hard cap (SwiftShader dilates game time)
let lastPlayerX = null;
let distanceTravelled = 0;

while (Date.now() < deadline) {
  const s = await read();

  if (s.phase === 'over' && !s.resultsHidden) break;

  // Track movement + stalls.
  if (lastPlayerX !== null) distanceTravelled += Math.abs(s.player.x - lastPlayerX);
  lastPlayerX = s.player.x;

  // Serve interaction.
  if (s.phase === 'serve' && s.server === 'player') {
    if (s.serve === 'toss') { await page.keyboard.press('Space'); hitCount++; }
    await holdMove(null);
  } else if (s.phase === 'rally') {
    if (s.ball.last === 'rival' && s.ball.z > -0.5) {
      // Chase the ball horizontally.
      const dx = s.ball.x - s.player.x;
      if (Math.abs(dx) > 0.35) await holdMove(dx < 0 ? 'left' : 'right');
      else await holdMove(null);
      if (s.ready) {
        await page.keyboard.press('Space');
        hitCount++;
        const after = await read();
        if (after.ball.last !== 'player') swingWhiffs++;
      }
    } else {
      // Recover toward center after own shot.
      const dx = -0.4 - s.player.x;
      if (Math.abs(dx) > 0.5) await holdMove(dx < 0 ? 'left' : 'right');
      else await holdMove(null);
    }
  } else if (s.phase === 'point') {
    await holdMove(null);
    const key = `${s.score.player}-${s.score.rival}`;
    if (key !== lastScoreKey) {
      const [lp, lr] = lastScoreKey.split('-').map(Number);
      const winner = s.score.player > lp ? 'player' : 'rival';
      points.push({ score: key, reason: s.banner, winner });
      console.log('POINT', key, winner, s.banner);
      lastScoreKey = key;
    }
  }

  if (s.phase === 'rally' && s.ball.mode === 'flight' && s.ball.last === 'rival' && s.ball.z > 0 && Math.abs(s.player.x - lastPlayerX) < 0.001) framesStalled++;

  lastPhase = s.phase;
  await page.waitForTimeout(60);
}

await holdMove(null);
const finalState = await read();
console.log('FINAL', JSON.stringify(finalState, null, 1));
console.log('POINTS', JSON.stringify(points, null, 1));
console.log('METRICS', JSON.stringify({
  hits: hitCount,
  whiffs: swingWhiffs,
  distanceTravelledX: +distanceTravelled.toFixed(2),
  stalledFrames: framesStalled,
  resultShown: !finalState.resultsHidden,
  matchWinner: finalState.matchWinner,
  errors: errors.length,
}));
console.log('ERRORS', errors.slice(0, 8).join('\n') || '(none)');
await page.screenshot({ path: 'artifacts/raw/bot-results.png' });

// Rematch from results.
if (!finalState.resultsHidden) {
  await page.locator('#rematch-btn').click();
  await page.waitForTimeout(600);
  console.log('REMATCH', JSON.stringify(await read()));
  await page.screenshot({ path: 'artifacts/raw/bot-rematch.png' });
}
await browser.close();
