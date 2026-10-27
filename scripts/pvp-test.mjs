// Two-browser PvP test over the real WebSocket backend.
// SwiftShader renders two simultaneous contexts at ~1 fps, so ALL waits key
// off game state (getState) with generous wall-clock budgets, and the guest
// page uses a tiny viewport to lighten the CPU renderer.
import { chromium } from 'playwright-core';

const CHROME = '/home/dusan/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
const URL = 'http://127.0.0.1:4173/';
const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--headless=new', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
});

const errors = { a: [], b: [] };
async function makePage(tag, viewport) {
  const page = await browser.newPage({ viewport });
  page.on('pageerror', (e) => errors[tag].push((e.stack || e.message).split('\n')[0]));
  page.on('console', (m) => { if (m.type() === 'error') errors[tag].push(m.text().slice(0, 160)); });
  await page.goto(URL + '?debug=1', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__, null, { timeout: 30000 });
  return page;
}

// Poll until a game-state predicate holds (game time != wall time here).
async function waitForGame(page, predicateSource, timeoutMs, label) {
  const start = Date.now();
  for (;;) {
    const ok = await page.evaluate(`(function () {
      try { const s = window.__THREE_GAME_TEST_HOOKS__.getState(); return Boolean((${predicateSource})(s)); }
      catch { return false; }
    })()`);
    if (ok) return;
    if (Date.now() - start > timeoutMs) throw new Error('waitForGame timeout: ' + label);
    await page.waitForTimeout(400);
  }
}

const A = await makePage('a', { width: 1280, height: 720 });
await A.evaluate(() => document.getElementById('host-btn').click());
await A.waitForFunction(() => {
  const el = document.getElementById('lobby-code');
  return el && el.textContent && el.textContent !== '····';
}, null, { timeout: 15000 });
const code = await A.evaluate(() => document.getElementById('lobby-code').textContent);
console.log('HOSTED, code:', code);

const B = await makePage('b', { width: 320, height: 200 });
await B.evaluate(() => document.getElementById('join-btn').click());
await B.waitForFunction(() => !document.getElementById('lobby-vs').hidden, null, { timeout: 20000 });
console.log('GUEST matched');

// Both pages auto-begin; wait on game state (intro -> serve), not wall time.
await waitForGame(A, '(s) => ["serve","rally","point","over"].includes(s.phase)', 180000, 'A enters serve');
console.log('A phase:', await A.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.getState().phase));
await waitForGame(B, '(s) => s.phase === "serve"', 180000, 'B sees serve');
const bPanel = await B.evaluate(() => document.querySelector('.player-id b')?.textContent);
console.log('B panel name:', bPanel, '(expect LAKI)');

// Host serves when the toss is up.
await waitForGame(A, '(s) => s.phase === "serve" && s.serve === "toss"', 180000, 'A toss');
await A.keyboard.press('Space');
console.log('A served');

// Wait until Laki return window, then hit.
let guestHit = false;
const deadline = Date.now() + 240000;
while (Date.now() < deadline) {
  const info = await B.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.getState());
  if (info.phase === 'point' || info.phase === 'over') break;
  if (info.phase === 'rally' && info.ready) {
    await B.keyboard.press('Space');
    guestHit = true;
    console.log('B hit attempted');
    await B.waitForTimeout(1500);
    break;
  }
  if (info.phase === 'rally' && info.ball.last === 'player') {
    // Guest keys are view-mirrored: KeyA moves world +x, KeyD world -x.
    const dx = info.ball.x - (info.rival ? info.rival.x : info.player.x);
    let key = null;
    if (dx < -0.3) key = 'KeyD';
    else if (dx > 0.3) key = 'KeyA';
    if (key) {
      await B.keyboard.down(key);
      await B.waitForTimeout(450);
      await B.keyboard.up(key);
    }
  }
  await B.waitForTimeout(150);
}

// Settle: wait for the point to resolve on the host.
await waitForGame(A, '(s) => s.phase === "point" || s.phase === "over" || s.serve === "wait" || s.serve === "toss"', 240000, 'point resolves');
const finalA = await A.evaluate(() => {
  const s = window.__THREE_GAME_TEST_HOOKS__.getState();
  const d = window.__THREE_GAME_DIAGNOSTICS__;
  return { phase: s.phase, score: `${d.score.playerLabel}-${d.score.rivalLabel}`, rally: s.rally, ballLast: s.ball.last, ballMode: s.ball.mode };
});
const finalB = await B.evaluate(() => {
  const s = window.__THREE_GAME_TEST_HOOKS__.getState();
  const d = window.__THREE_GAME_DIAGNOSTICS__;
  return { phase: s.phase, score: `${d.score.playerLabel}-${d.score.rivalLabel}`, rally: s.rally, hudVisible: !document.getElementById('hud').hidden };
});
console.log('A final:', JSON.stringify(finalA), 'guestHit:', guestHit);
console.log('B final:', JSON.stringify(finalB));

// Movement sync: wait for the next rally, then drive Laki and watch him move
// on the host (his athlete is the host's rival entity).
await waitForGame(A, '(s) => s.phase === "rally"', 240000, 'next rally');
const before = await A.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.getState().rival.x);
await B.keyboard.down('KeyA');
await B.waitForTimeout(2500);
await B.keyboard.up('KeyA');
const after = await A.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.getState().rival.x);
const moved = +(after - before).toFixed(2);
console.log('movement sync dx:', moved, moved < -0.3 ? '(OK, moved toward -x)' : '(check)');

await A.screenshot({ path: 'artifacts/raw/pvp-host.png' });
await B.screenshot({ path: 'artifacts/raw/pvp-guest.png' });
console.log('ERRORS A:', errors.a.slice(0, 4).join(' | ') || '(none)');
console.log('ERRORS B:', errors.b.slice(0, 4).join(' | ') || '(none)');
await browser.close();
