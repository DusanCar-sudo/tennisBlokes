// Live basketball: pointer charge & shoot, CPU offense/defense, race to 11.
import { chromium } from 'playwright-core';
const CHROME='/home/dusan/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
const browser=await chromium.launch({executablePath:CHROME,headless:true,args:['--headless=new','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1280,height:720}});
const errors=[]; page.on('pageerror',e=>errors.push((e.stack||e.message).split('\n')[0]));
page.on('console',m=>{if(m.type()==='error')errors.push(m.text().slice(0,160));});
await page.goto('http://127.0.0.1:4173/?debug=1',{waitUntil:'load'});
await page.waitForFunction(()=>window.__SUNSET_SLAM_DEV__,null,{timeout:30000});
await page.evaluate(()=>{ const g=window.__SUNSET_SLAM_DEV__; g.startMatch('basket'); g.ui.hideCountdown(); });
await page.waitForFunction(()=>window.__SUNSET_SLAM_DEV__.phase==='rally',null,{timeout:60000});

const read=()=>page.evaluate(()=>{
  const g=window.__SUNSET_SLAM_DEV__;
  const H=g.hoops;
  return {phase:g.phase, poss:H?.possession, sc:g.score.player+'-'+g.score.rival,
    clock:H?+H.shotClock.toFixed(1):null, mode:g.ball.mode,
    p:[+g.player.pos.x.toFixed(1),+g.player.pos.z.toFixed(1)], r:[+g.rival.pos.x.toFixed(1),+g.rival.pos.z.toFixed(1)],
    b:[+g.ball.pos.x.toFixed(1),+g.ball.pos.y.toFixed(1),+g.ball.pos.z.toFixed(1)],
    shot:H?.shot?.type||null, replay:!!g.replay, prompt:document.getElementById('prompt')?.textContent};
});

let shots=0, made=0, lastScore='0-0';
const end=Date.now()+420000;
let over=false;
const center=await page.evaluate(()=>{const r=document.getElementById('game-canvas').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};});
while(Date.now()<end && !over){
  const s=await read();
  if(s.sc!==lastScore){ lastScore=s.sc; console.log('SCORE', s.sc, s.phase, s.prompt); }
  if(s.phase==='over'){ over=true; break; }
  // our offense: move toward the hoop & hold-release a shot
  if(s.phase==='rally'){
    if(s.poss==='player' && s.mode==='held'){
      // steer toward the free-throw spot
      const tz=-6.4, dz=tz-s.p[1];
      if(Math.abs(dz)>0.6){ await page.keyboard.down(dz<0?'KeyW':'KeyS'); await page.waitForTimeout(160); await page.keyboard.up(dz<0?'KeyW':'KeyS'); }
      else if(!s.shot){
        // charge with pointer hold ~0.61s => charge ≈0.72 sweet spot
        await page.mouse.move(center.x,center.y);
        await page.mouse.down();
        await page.waitForTimeout(640);
        await page.mouse.up();
        shots+=1;
      }
    } else if(s.poss==='rival' && s.mode==='held'){
      // contest: run at Laki
      const dx=s.r[0]-s.p[0], dz=s.r[1]-s.p[1];
      const k=Math.abs(dx)>Math.abs(dz)?(dx>0?'KeyD':'KeyA'):(dz>0?'KeyW':'KeyS');
      await page.keyboard.down(k); await page.waitForTimeout(120); await page.keyboard.up(k);
    }
  }
  if(s.phase==='point' && !s.replay){ await page.waitForTimeout(400); }
  await page.waitForTimeout(120);
}
const final=await read();
console.log('FINAL', JSON.stringify(final), 'shotsAttempted:', shots);
console.log('ERRORS', errors.slice(0,5).join('\n')||'(none)');
await page.screenshot({path:'artifacts/raw/hoops-live.png'});
await browser.close();
