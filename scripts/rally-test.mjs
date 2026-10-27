import { chromium } from 'playwright-core';
const CHROME='/home/dusan/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
const browser=await chromium.launch({executablePath:CHROME,headless:true,args:['--headless=new','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});
const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1});
const page=await context.newPage();
const logs=[];
page.on('console',m=>{ if(m.type()==='error') logs.push(`[${m.type()}] ${m.text()}`);});
page.on('pageerror',e=>logs.push(`[pageerror] ${e.stack||e.message}`));
await page.goto('http://127.0.0.1:5188/',{waitUntil:'load'});
await page.waitForFunction(()=>window.__THREE_GAME_DIAGNOSTICS__,null,{timeout:15000});
await page.evaluate(async()=>{ await window.__THREE_GAME_TEST_HOOKS__.setState('active-play'); await window.__THREE_GAME_TEST_HOOKS__.setPausedForScreenshot(false); });
await page.waitForTimeout(500);
await page.keyboard.press('Space');
for (let i=0;i<20;i++) {
  await page.waitForTimeout(400);
  const s = await page.evaluate(()=>({
    phase: window.__SUNSET_SLAM_DEV__.phase,
    score: {...window.__SUNSET_SLAM_DEV__.score},
    label: window.__SUNSET_SLAM_DEV__.scoreLabels(),
    rally: window.__SUNSET_SLAM_DEV__.rally,
    ball: {mode: window.__SUNSET_SLAM_DEV__.ball.mode, pos: window.__SUNSET_SLAM_DEV__.ball.pos.toArray().map(n=>+n.toFixed(2)), speed:+window.__SUNSET_SLAM_DEV__.ball.vel.length().toFixed(1), bounces: window.__SUNSET_SLAM_DEV__.ball.bounces, last: window.__SUNSET_SLAM_DEV__.ball.lastHitter},
    player: window.__SUNSET_SLAM_DEV__.player.pos.toArray().map(n=>+n.toFixed(2)),
    rival: window.__SUNSET_SLAM_DEV__.rival.pos.toArray().map(n=>+n.toFixed(2)),
    paused: window.__SUNSET_SLAM_DEV__.paused,
    screenshotPaused: window.__SUNSET_SLAM_DEV__.screenshotPaused,
    pointBanner: document.getElementById('point-banner').hidden,
  }));
  console.log(i, JSON.stringify(s));
  if (s.phase==='point' || s.phase==='over') break;
}
await page.screenshot({path:'artifacts/raw/rally-test.png'});
console.log('logs:', logs.slice(0,10).join('\n')||'(none)');
await browser.close();
