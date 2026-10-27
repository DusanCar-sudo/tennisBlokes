// Plays AI-mode points and logs the phase timeline to catch any stall.
import { chromium } from 'playwright-core';
const CHROME='/home/dusan/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
const browser=await chromium.launch({executablePath:CHROME,headless:true,args:['--headless=new','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1280,height:720}});
const errors=[];
page.on('pageerror',e=>errors.push((e.stack||e.message).split('\n').slice(0,2).join(' | ')));
page.on('console',m=>{if(m.type()==='error')errors.push(m.text().slice(0,160));});
await page.goto('http://127.0.0.1:4173/?debug=1',{waitUntil:'load'});
await page.waitForFunction(()=>window.__SUNSET_SLAM_DEV__ && window.__THREE_GAME_DIAGNOSTICS__,null,{timeout:30000});
await page.evaluate(()=>window.__THREE_GAME_TEST_HOOKS__.seed(42));
await page.evaluate(()=>window.__SUNSET_SLAM_DEV__.startMatch());

let lastPhase='';
let phaseSince=Date.now();
const deadline=Date.now()+420000;
let chaseKey=null;
while(Date.now()<deadline){
  const s=await page.evaluate(()=>{
    const g=window.__SUNSET_SLAM_DEV__;
    return {phase:g.phase,serve:g.serve.state,server:g.server,score:g.score.player+'-'+g.score.rival,
      rally:g.rally,paused:g.paused,mw:g.matchWinner,
      ball:{m:g.ball.mode,x:+g.ball.pos.x.toFixed(1),y:+g.ball.pos.y.toFixed(1),z:+g.ball.pos.z.toFixed(1),last:g.ball.lastHitter,b:g.ball.bounces,v:[g.ball.vel.x.toFixed(2),g.ball.vel.y.toFixed(2),g.ball.vel.z.toFixed(2)],t:+g.ball.time.toFixed(2)},
      px:+g.player.pos.x.toFixed(1),pz:+g.player.pos.z.toFixed(1),ready:g.getHitInfo().ready,
      frame:window.__THREE_GAME_DIAGNOSTICS__.frame};
  });
  const key=s.phase+'|'+s.serve+'|'+s.server+'|'+s.score;
  if(key!==lastPhase){
    console.log(Date.now().toString().slice(-6),key,'ball',JSON.stringify(s.ball),'frame',s.frame);
    lastPhase=key; phaseSince=Date.now();
  }
  // stall detector: no phase/serve transition for 25s wall (SwiftShader ~1-3fps → generous)
  if(Date.now()-phaseSince>25000){
    console.log('STALL DETECTED in',key,JSON.stringify(s));
    const probe = await page.evaluate(async () => {
      const g = window.__SUNSET_SLAM_DEV__;
      let calls = 0;
      const orig = g.ball.update.bind(g.ball);
      g.ball.update = (dt) => { calls += 1; return orig(dt); };
      const t0 = performance.now();
      await new Promise((r) => setTimeout(r, 2000));
      g.ball.update = orig;
      return {
        callsIn2s: calls,
        frame: window.__THREE_GAME_DIAGNOSTICS__.frame,
        ballTime: +g.ball.time.toFixed(3),
        ballMode: g.ball.mode,
        elapsed: +g.elapsed.toFixed(2),
        manualUpdate: (() => { const p0 = g.ball.pos.clone(); g.ball.update(0.016); return +g.ball.pos.z.toFixed(2) + ' (was ' + p0.z.toFixed(2) + ')'; })(),
      };
    });
    console.log('PROBE:', JSON.stringify(probe, null, 1));
    console.log('errors:',errors.slice(0,6).join('\n')||'(none)');
    await page.screenshot({path:'artifacts/raw/stall.png'});
    await browser.close();
    process.exit(2);
  }
  // serve interaction
  if(s.phase==='serve'&&s.server==='player'){
    if(s.serve==='toss'){await page.keyboard.press('Space');}
  } else if(s.phase==='rally'){
    if(s.ball.last==='rival'&&s.ball.z>0){
      const dx=s.ball.x-s.px;
      if(Math.abs(dx)>0.35){const k=dx<0?'KeyA':'KeyD';await page.keyboard.down(k);chaseKey=k;}else if(chaseKey){await page.keyboard.up(chaseKey);chaseKey=null;}
      if(s.ready){await page.keyboard.press('Space');}
    } else if(chaseKey){await page.keyboard.up(chaseKey);chaseKey=null;}
  }
  if(s.phase==='over')break;
  await page.waitForTimeout(150);
}
console.log('done; score', lastPhase, 'errors:', errors.slice(0,5).join('\n')||'(none)');
await browser.close();
