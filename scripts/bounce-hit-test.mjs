import { chromium } from 'playwright-core';
const CHROME='/home/dusan/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
const browser=await chromium.launch({executablePath:CHROME,headless:true,args:['--headless=new','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1280,height:720}});
const errors=[]; page.on('pageerror',e=>errors.push((e.stack||e.message).split('\n')[0]));
page.on('console',m=>{if(m.type()==='error')errors.push(m.text().slice(0,160));});
await page.goto('http://127.0.0.1:4173/?debug=1',{waitUntil:'load'});
await page.waitForFunction(()=>window.__SUNSET_SLAM_DEV__,null,{timeout:30000});

// CASE 1: ball has just bounced and is already within reach -> should hit
const case1 = await page.evaluate(() => {
  const g=window.__SUNSET_SLAM_DEV__;
  g.startMatch(); g.phase='rally'; g.ui.hideCountdown();
  g.player.pos.set(0,0,10.6); g.player.swingCooldown=0;
  g.rival.pos.set(0,0,-9);
  g.ball.mode='flight'; g.ball.mesh.visible=true;
  g.ball.pos.set(0.3,0.8,9.2); g.ball.vel.set(0.2,1.0,4.5); g.ball.bounces=1; g.ball.lastHitter='rival';
  g.ball.mesh.position.copy(g.ball.pos);
  const before={last:g.ball.lastHitter, rally:g.rally};
  g.attemptHit('test');
  return {before, after:{last:g.ball.lastHitter, rally:g.rally, mode:g.ball.mode}, ready:g.getHitInfo().ready};
});
console.log('CASE1 close-after-bounce', JSON.stringify(case1));

// CASE 2: clicked at the bounce moment, ball 5m away approaching -> what happens?
const case2 = await page.evaluate(() => {
  const g=window.__SUNSET_SLAM_DEV__;
  g.startMatch(); g.phase='rally'; g.ui.hideCountdown();
  g.player.pos.set(0,0,10.6); g.player.swingCooldown=0;
  g.rival.pos.set(0,0,-9);
  g.ball.mode='flight'; g.ball.mesh.visible=true;
  g.ball.pos.set(0.3,0.3,5.2); g.ball.vel.set(0.1,2.0,7.0); g.ball.bounces=1; g.ball.lastHitter='rival';
  g.ball.mesh.position.copy(g.ball.pos);
  const dist=Math.hypot(g.ball.pos.x-g.player.pos.x, g.ball.pos.z-g.player.pos.z);
  const before={last:g.ball.lastHitter, rally:g.rally, dist:+dist.toFixed(2)};
  g.attemptHit('test');
  return {before, after:{last:g.ball.lastHitter, rally:g.rally, cooldown:+g.player.swingCooldown.toFixed(2)}, ready:g.getHitInfo().ready};
});
console.log('CASE2 click-at-bounce (5m away)', JSON.stringify(case2));

// CASE 3: same click, but let the ball travel into reach first, then click
const case3 = await page.evaluate(() => {
  const g=window.__SUNSET_SLAM_DEV__;
  g.startMatch(); g.phase='rally'; g.ui.hideCountdown();
  g.player.pos.set(0,0,10.6); g.player.swingCooldown=0;
  g.rival.pos.set(0,0,-9);
  g.ball.mode='flight'; g.ball.mesh.visible=true;
  g.ball.pos.set(0.3,0.3,5.2); g.ball.vel.set(0.1,2.0,7.0); g.ball.bounces=1; g.ball.lastHitter='rival';
  for (let i=0;i<120;i++){ g.ball.update(1/120); if (g.getHitInfo().ready) break; }
  const dist=Math.hypot(g.ball.pos.x-g.player.pos.x, g.ball.pos.z-g.player.pos.z);
  g.attemptHit('test');
  return {dist:+dist.toFixed(2), last:g.ball.lastHitter, rally:g.rally, ready:g.getHitInfo().ready};
});
console.log('CASE3 travel-then-click', JSON.stringify(case3));
console.log('ERRORS', errors.slice(0,4).join('\n')||'(none)');
await browser.close();
