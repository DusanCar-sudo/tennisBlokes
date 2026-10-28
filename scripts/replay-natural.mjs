// Play real points and confirm the slow-mo replay triggers from recorded
// rally frames, then the next serve proceeds.
import { chromium } from 'playwright-core';
const CHROME='/home/dusan/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
const browser=await chromium.launch({executablePath:CHROME,headless:true,args:['--headless=new','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1280,height:720}});
const errors=[]; page.on('pageerror',e=>errors.push((e.stack||e.message).split('\n')[0]));
page.on('console',m=>{if(m.type()==='error')errors.push(m.text().slice(0,160));});
await page.goto('http://127.0.0.1:4173/?debug=1',{waitUntil:'load'});
await page.waitForFunction(()=>window.__SUNSET_SLAM_DEV__,null,{timeout:30000});
await page.evaluate(()=>{ const g=window.__SUNSET_SLAM_DEV__; g.startMatch(); });

const read = () => page.evaluate(() => {
  const g=window.__SUNSET_SLAM_DEV__;
  return { phase:g.phase, serve:g.serve.state, server:g.server, score:g.score.player+'-'+g.score.rival,
    replay:!!g.replay, frames:g.recordBuffer.length, ball:{m:g.ball.mode,z:+g.ball.pos.z.toFixed(1),last:g.ball.lastHitter},
    px:+g.player.pos.x.toFixed(1), ready:g.getHitInfo().ready };
});

let chase=null;
const end=Date.now()+420000;
let sawReplay=false, pointScored=false, deadlineServe=false;
while(Date.now()<end){
  const s=await read();
  if(s.replay && !sawReplay){ sawReplay=true; console.log('NATURAL REPLAY STARTED', JSON.stringify(s)); }
  if(s.phase==='point'||s.phase==='over'){ pointScored=true; }
  if(sawReplay && pointScored && !s.replay && ['serve','rally'].includes(s.phase)){ deadlineServe=true; console.log('REPLAY FINISHED + NEXT POINT', JSON.stringify(s)); break; }
  // drive play
  if(s.phase==='serve'&&s.server==='player'&&s.serve==='toss'){ await page.keyboard.press('Space'); }
  else if(s.phase==='rally'){
    if(s.ball.last==='rival'&&s.ball.z>0){
      const dx=s.ball.x-s.px;
      if(Math.abs(dx)>0.4){const k=dx<0?'KeyA':'KeyD'; if(chase!==k){ if(chase) await page.keyboard.up(chase); await page.keyboard.down(k); chase=k; } }
      else if(chase){ await page.keyboard.up(chase); chase=null; }
      if(s.ready){ await page.keyboard.press('Space'); }
    } else if(chase){ await page.keyboard.up(chase); chase=null; }
  }
  await page.waitForTimeout(150);
}
console.log('RESULT', JSON.stringify({sawReplay, pointScored, deadlineServe, final: await read()}));
console.log('ERRORS', errors.slice(0,5).join('\n')||'(none)');
await page.screenshot({path:'artifacts/raw/replay-natural.png'});
await browser.close();
