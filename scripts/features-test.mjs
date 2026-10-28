import { chromium } from 'playwright-core';
const CHROME='/home/dusan/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
const browser=await chromium.launch({executablePath:CHROME,headless:true,args:['--headless=new','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1280,height:720}});
const errors=[];
page.on('pageerror',e=>errors.push((e.stack||e.message).split('\n').slice(0,2).join(' | ')));
page.on('console',m=>{if(m.type()==='error')errors.push(m.text().slice(0,180));});
await page.goto('http://127.0.0.1:4173/?debug=1',{waitUntil:'load'});
await page.waitForFunction(()=>window.__SUNSET_SLAM_DEV__,null,{timeout:30000});

// ── A) readiness stance: ball on the left → backhand coil, right → forehand
const stance = await page.evaluate(() => {
  const g=window.__SUNSET_SLAM_DEV__;
  g.startMatch(); g.phase='rally';
  g.player.pos.set(0,0,10); g.rival.pos.set(0,0,-9);
  g.ball.mode='flight'; g.ball.visible=true;
  g.ball.pos.set(-2.2,1.2,8.0); // LEFT of player
  g.updateCharacters(0.016,0,0);
  const backhandSide=g.playerCharacter.readySide;
  g.ball.pos.set(2.2,1.2,8.0);   // RIGHT of player
  for(let i=0;i<20;i++) g.updateCharacters(0.05,0,0);
  const forehandSide=g.playerCharacter.readySide;
  return {backhandSide:+backhandSide?.toFixed(2), forehandSide:+forehandSide?.toFixed(2), handRight:g.getIncomingHand()};
});
console.log('READINESS', JSON.stringify(stance));

// ── B) catch assist: ball just outside reach → auto lunge + hit
const assist = await page.evaluate(() => {
  const g=window.__SUNSET_SLAM_DEV__;
  g.startMatch(); g.phase='rally';
  g.player.pos.set(0,0,10); g.player.swingCooldown=0;
  g.ball.mode='flight'; g.ball.pos.set(2.8,1.1,9.9); // 2.8 > reach 2.45, < 3.3
  g.rival.pos.set(0,0,-9);
  const before={x:+g.player.pos.x.toFixed(2)};
  g.attemptHit('test');
  return {before, after:{x:+g.player.pos.x.toFixed(2)}, last:g.ball.lastHitter, rally:g.rally};
});
console.log('CATCH ASSIST', JSON.stringify(assist));

// ── C) point replay: force a point end and watch slow-mo → banner → next serve
const replayStart = await page.evaluate(() => {
  const g=window.__SUNSET_SLAM_DEV__;
  g.startMatch(); g.phase='rally'; g.recordBuffer.length=0;
  for (let i=0;i<80;i++){ // fabricate ~1.3s of rally footage
    g.elapsed+=0.016;
    g.ball.pos.set(1.5-i*0.05,1.2,7.5+i*0.02);
    g.player.pos.set(0,0,10); g.rival.pos.set(0.3,0,-9.2);
    g.recordReplayFrame();
  }
  g.awardPoint('player','WINNER');
  return {replay: !!g.replay, frames:g.replay?.frames.length||0, badge:!document.getElementById('replay-badge').hidden, bars:document.body.classList.contains('is-replay'), phase:g.phase};
});
console.log('REPLAY START', JSON.stringify(replayStart));
await page.waitForTimeout(1200);
const mid = await page.evaluate(() => ({
  replaying: !!window.__SUNSET_SLAM_DEV__.replay,
  ball: window.__SUNSET_SLAM_DEV__.ball.pos.toArray().map(n=>+n.toFixed(2)),
  playerX: +window.__SUNSET_SLAM_DEV__.playerCharacter.root.position.x.toFixed(2),
  prompt: document.getElementById('prompt').textContent,
}));
console.log('REPLAY MID', JSON.stringify(mid));
await page.screenshot({path:'artifacts/raw/replay-slowmo.png'});

// wait for replay to finish and banner to appear
await page.waitForFunction(()=>!window.__SUNSET_SLAM_DEV__.replay && !document.getElementById('point-banner').hidden, null, {timeout:120000});
const after = await page.evaluate(() => ({
  bannerTitle: document.getElementById('point-title').textContent,
  badgeHidden: document.getElementById('replay-badge').hidden,
  bars: document.body.classList.contains('is-replay'),
  phase: window.__SUNSET_SLAM_DEV__.phase,
  score: window.__SUNSET_SLAM_DEV__.score.player+'-'+window.__SUNSET_SLAM_DEV__.score.rival,
}));
console.log('AFTER REPLAY', JSON.stringify(after));
await page.screenshot({path:'artifacts/raw/replay-banner.png'});

// ensure the next point starts properly
await page.waitForFunction(()=>['serve','rally'].includes(window.__SUNSET_SLAM_DEV__.phase), null, {timeout:180000});
console.log('NEXT POINT PHASE', await page.evaluate(()=>window.__SUNSET_SLAM_DEV__.phase));
console.log('ERRORS', errors.slice(0,5).join('\n')||'(none)');
await browser.close();
