import { chromium } from 'playwright-core';
const CHROME='/home/dusan/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
const browser=await chromium.launch({executablePath:CHROME,headless:true,args:['--headless=new','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});
const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1});
const page=await context.newPage();
const logs=[]; page.on('console',m=>{if(m.type()==='error') logs.push(m.text());}); page.on('pageerror',e=>logs.push(e.stack||e.message));
await page.goto('http://127.0.0.1:5188/',{waitUntil:'load'});
await page.waitForFunction(()=>Boolean(window.__SUNSET_SLAM_DEV__) && Boolean(window.__THREE_GAME_DIAGNOSTICS__),null,{timeout:20000});
await page.locator('#play-btn').click();
await page.waitForTimeout(600);
console.log('after play', await page.evaluate(()=>({phase:window.__SUNSET_SLAM_DEV__.phase, paused:window.__SUNSET_SLAM_DEV__.paused, pointerLocked:document.pointerLockElement!=null, serve:window.__SUNSET_SLAM_DEV__.serve, lock: document.pointerLockElement?.tagName||null})));
await page.screenshot({path:'artifacts/raw/match-intro.png'});
// Wait for toss
for (let i=0;i<30;i++){ await page.waitForTimeout(200); const s=await page.evaluate(()=>({phase:window.__SUNSET_SLAM_DEV__.phase,serveState:window.__SUNSET_SLAM_DEV__.serve.state,paused:window.__SUNSET_SLAM_DEV__.paused})); if(i%5===0) console.log('wait toss', s); if(s.serveState==='toss') break; }
await page.screenshot({path:'artifacts/raw/match-serve.png'});
await page.keyboard.press('Space');
await page.waitForTimeout(500);
console.log('after serve', await page.evaluate(()=>({phase:window.__SUNSET_SLAM_DEV__.phase, ball:window.__SUNSET_SLAM_DEV__.ball.mode, last:window.__SUNSET_SLAM_DEV__.ball.lastHitter, rally:window.__SUNSET_SLAM_DEV__.rally, paused:window.__SUNSET_SLAM_DEV__.paused, score:window.__SUNSET_SLAM_DEV__.score})));
await page.screenshot({path:'artifacts/raw/match-rally.png'});
// Wait for AI to return and see score progression; try auto-hitting whenever ready by moving toward ball with simple keys.
let hitCount=0;
for (let i=0;i<120;i++){
  await page.waitForTimeout(120);
  const info = await page.evaluate(()=>{
    const g=window.__SUNSET_SLAM_DEV__;
    return {phase:g.phase, paused:g.paused, ready:g.getHitInfo().ready, ballX:g.ball.pos.x, ballZ:g.ball.pos.z, playerX:g.player.pos.x, playerZ:g.player.pos.z, score:{...g.score}, rally:g.rally, last:g.ball.lastHitter, serve:g.serve.state, screenshotPaused:g.screenshotPaused};
  });
  if (info.phase==='point'||info.phase==='over') { console.log('point detected',JSON.stringify(info)); break; }
  if (info.ready && info.last==='rival') { await page.keyboard.press('Space'); hitCount++; console.log('hit',hitCount,JSON.stringify(info)); }
  // crude movement toward ball x when on player side and incoming
  if (info.last==='rival' && info.ballZ>0) {
    if (info.ballX < info.playerX-0.4) await page.keyboard.press('KeyA');
    else if (info.ballX > info.playerX+0.4) await page.keyboard.press('KeyD');
  }
  if (i%20===0) console.log('tick',i,JSON.stringify(info));
}
console.log('final', await page.evaluate(()=>({phase:window.__SUNSET_SLAM_DEV__.phase, score:window.__SUNSET_SLAM_DEV__.score, rally:window.__SUNSET_SLAM_DEV__.rally, paused:window.__SUNSET_SLAM_DEV__.paused})));
await page.screenshot({path:'artifacts/raw/match-late.png'});
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
console.log('after esc', await page.evaluate(()=>({phase:window.__SUNSET_SLAM_DEV__.phase, paused:window.__SUNSET_SLAM_DEV__.paused, pointerLocked:document.pointerLockElement!=null, pauseHidden:document.getElementById('pause-screen').hidden})));
await page.screenshot({path:'artifacts/raw/match-pause.png'});
console.log('logs:', logs.slice(0,10).join('\n')||'(none)');
await browser.close();
