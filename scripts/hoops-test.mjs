import { chromium } from 'playwright-core';
const CHROME='/home/dusan/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
const browser=await chromium.launch({executablePath:CHROME,headless:true,args:['--headless=new','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1280,height:720}});
const errors=[]; page.on('pageerror',e=>errors.push((e.stack||e.message).split('\n').slice(0,2).join(' | ')));
page.on('console',m=>{if(m.type()==='error')errors.push(m.text().slice(0,180));});
await page.goto('http://127.0.0.1:4173/?debug=1',{waitUntil:'load'});
await page.waitForFunction(()=>window.__SUNSET_SLAM_DEV__,null,{timeout:30000});

// Pick basketball & start
await page.evaluate(()=>document.getElementById('sport-basket').click());
await page.evaluate(()=>document.getElementById('play-btn').click());
await page.waitForTimeout(2200);
const st1=await page.evaluate(()=>{
  const g=window.__SUNSET_SLAM_DEV__;
  return {sport:g.sport, phase:g.phase, possession:g.hoops?.possession,
    courtVisible:g.arena.getObjectByName('basketCourt')?.visible,
    tennisHidden:!g.world.court.group.visible, ballY:+g.ball.pos.y.toFixed(2), mode:g.ball.mode,
    prompt:document.getElementById('prompt').textContent};
});
console.log('START', JSON.stringify(st1));

// Force a clean shot: teleport near the hoop & shoot with sweet charge
const shot=await page.evaluate(()=>{
  const g=window.__SUNSET_SLAM_DEV__;
  g.phase='rally'; g.paused=false; g.screenshotPaused=false;
  g.hoops.resetPositions('player');
  // Stand at the free-throw distance
  g.player.pos.set(0,0,-6.4); g.rival.pos.set(2.4,0,4.2);
  g.hoops.shotClock=10;
  const before={score:g.score.player, mode:g.ball.mode};
  g.hoops.shoot('player',0.72); // sweet spot
  // integrate physics frames until resolution
  let resolved=null;
  for(let i=0;i<600;i+=1){
    g.hoops.ballPhysics(1/120);
    if(g.phase==='point'){resolved={made:true, score:g.score.player, reason:g.pendingPoint?.reason}; break;}
    if(!g.hoops.shot && g.ball.bounces>1){resolved={made:false, score:g.score.player}; break;}
  }
  return {before, after:{score:g.score.player, mode:g.ball.mode, phase:g.phase}, resolved,
    ball:[+g.ball.pos.x.toFixed(2),+g.ball.pos.y.toFixed(2),+g.ball.pos.z.toFixed(2)]};
});
console.log('SHOT', JSON.stringify(shot));

// Miss case: terrible charge from three
const miss=await page.evaluate(()=>{
  const g=window.__SUNSET_SLAM_DEV__;
  if(g.phase==='point'){ g.pointTimer=0.01; g.updatePoint(0.02); } // fast-forward banner
  g.phase='rally'; g.hoops && (g.hoops.lastScorer='player');
  g.hoops.resetPositions('player');
  g.player.pos.set(0,0,8.2); g.rival.pos.set(1.5,0,7.6); // defender close
  g.hoops.shotClock=10;
  g.hoops.shoot('player',0.25); // weak charge
  let out=null;
  for(let i=0;i<900;i+=1){
    g.hoops.ballPhysics(1/120);
    if(g.phase==='point'){out={made:true,score:g.score.player};break;}
    if(!g.hoops.shot && g.hoops.possession){out={made:false, possession:g.hoops.possession};break;}
  }
  return out;
});
console.log('MISS', JSON.stringify(miss));

await page.screenshot({path:'artifacts/raw/hoops-court.png'});
console.log('ERRORS', errors.slice(0,6).join('\n')||'(none)');
await browser.close();
