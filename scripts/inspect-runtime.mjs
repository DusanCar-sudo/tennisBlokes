import { chromium } from 'playwright-core';
const CHROME='/home/dusan/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
const browser=await chromium.launch({executablePath:CHROME,headless:true,args:['--headless=new','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});
const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1});
const page=await context.newPage();
const logs=[];
page.on('console',m=>{ if(m.type()!=='debug') logs.push(`[${m.type()}] ${m.text()}`);});
page.on('pageerror',e=>logs.push(`[pageerror] ${e.stack||e.message}`));
await page.goto('http://127.0.0.1:5188/',{waitUntil:'load'});
await page.waitForFunction(()=>window.__THREE_GAME_TEST_HOOKS__,null,{timeout:15000});
await page.waitForFunction(()=>window.__THREE_GAME_DIAGNOSTICS__,null,{timeout:15000});
console.log('initial diag', await page.evaluate(()=>window.__THREE_GAME_DIAGNOSTICS__));
await page.evaluate(async()=>{ await window.__THREE_GAME_TEST_HOOKS__.setState('active-play'); await window.__THREE_GAME_TEST_HOOKS__.setPausedForScreenshot(false); });
await page.waitForTimeout(300);
console.log('classes', await page.evaluate(()=>({
  hud: document.getElementById('hud').hidden,
  reticle: document.getElementById('reticle').className,
  chip: document.getElementById('shot-chip').className,
  prompt: document.getElementById('prompt').textContent,
  promptClass: document.getElementById('prompt').className,
  ballState: {
    mode: window.__SUNSET_SLAM_DEV__.ball.mode,
    pos: window.__SUNSET_SLAM_DEV__.ball.pos.toArray(),
    speed: window.__SUNSET_SLAM_DEV__.ball.vel.length(),
    lastHitter: window.__SUNSET_SLAM_DEV__.ball.lastHitter,
  },
  hitInfo: window.__SUNSET_SLAM_DEV__.getHitInfo(),
  prediction: window.__SUNSET_SLAM_DEV__.predictShotType(),
  playerPos: window.__SUNSET_SLAM_DEV__.player.pos.toArray(),
})));
await page.waitForTimeout(700);
console.log('after wait diag', await page.evaluate(()=>window.__THREE_GAME_DIAGNOSTICS__));
await page.keyboard.press('Space');
await page.waitForTimeout(500);
console.log('after space', await page.evaluate(()=>({
  phase: window.__SUNSET_SLAM_DEV__.phase,
  rally: window.__SUNSET_SLAM_DEV__.rally,
  ballLast: window.__SUNSET_SLAM_DEV__.ball.lastHitter,
  ballMode: window.__SUNSET_SLAM_DEV__.ball.mode,
  ballPos: window.__SUNSET_SLAM_DEV__.ball.pos.toArray(),
  ballSpeed: window.__SUNSET_SLAM_DEV__.ball.vel.length(),
  score: window.__SUNSET_SLAM_DEV__.score,
  feedback: document.getElementById('hit-rating').textContent,
})));
await page.waitForTimeout(2500);
console.log('after 2.5s', await page.evaluate(()=>({phase:window.__SUNSET_SLAM_DEV__.phase, score:window.__SUNSET_SLAM_DEV__.score, rally:window.__SUNSET_SLAM_DEV__.rally, ball:window.__SUNSET_SLAM_DEV__.ball.mode, last:window.__SUNSET_SLAM_DEV__.ball.lastHitter})));
await page.screenshot({path:'artifacts/raw/runtime-after-hit.png'});
console.log('logs:', logs.slice(0,20).join('\n')||'(none)');
await browser.close();
