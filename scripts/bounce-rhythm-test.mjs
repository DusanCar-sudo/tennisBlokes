// Presses HIT at the moment the ball bounces on our side and logs what the
// game did with that click (buffered / direct / swallowed / whiff).
import { chromium } from 'playwright-core';
const CHROME='/home/dusan/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
const browser=await chromium.launch({executablePath:CHROME,headless:true,args:['--headless=new','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1280,height:720}});
const errors=[]; page.on('pageerror',e=>errors.push((e.stack||e.message).split('\n')[0]));
page.on('console',m=>{if(m.type()==='error')errors.push(m.text().slice(0,160));});
await page.goto('http://127.0.0.1:4173/?debug=1',{waitUntil:'load'});
await page.waitForFunction(()=>window.__SUNSET_SLAM_DEV__,null,{timeout:30000});
await page.evaluate(()=>window.__SUNSET_SLAM_DEV__.startMatch());

const log=[];
let prev=0, ended=false;
const end=Date.now()+300000;
while(Date.now()<end && log.length<6 && !ended){
  const s=await page.evaluate(()=>{
    const g=window.__SUNSET_SLAM_DEV__;
    return { phase:g.phase, serve:g.serve.state, server:g.server, bounces:g.ball.bounces,
      z:+g.ball.pos.z.toFixed(2), y:+g.ball.pos.y.toFixed(2), last:g.ball.lastHitter,
      v:[+g.ball.vel.x.toFixed(1),+g.ball.vel.y.toFixed(1),+g.ball.vel.z.toFixed(1)],
      cd:+g.player.swingCooldown.toFixed(2),
      dist:+Math.hypot(g.ball.pos.x-g.player.pos.x,g.ball.pos.z-g.player.pos.z).toFixed(2),
      px:+g.player.pos.x.toFixed(1), pz:+g.player.pos.z.toFixed(1),
      score:g.score.player+'-'+g.score.rival, mode:g.ball.mode };
  });
  if(s.phase==='serve'&&s.server==='player'&&s.serve==='toss'){ await page.keyboard.press('Space'); }
  if(s.phase==='rally'&&s.last==='rival'&&s.z>0){
    if(s.bounces>prev){
      prev=s.bounces;
      const res=await page.evaluate(()=>{
        const g=window.__SUNSET_SLAM_DEV__;
        const cdBefore=g.player.swingCooldown;
        const d=Math.hypot(g.ball.pos.x-g.player.pos.x,g.ball.pos.z-g.player.pos.z);
        const b=g.ball;
        const dx=g.player.pos.x-b.pos.x, dz=g.player.pos.z-b.pos.z, len=Math.hypot(dx,dz)||1;
        const closing=(b.vel.x*dx+b.vel.z*dz)/len;
        const before=g.pendingSwing;
        g.attemptHit('test');
        const buffered=!!g.pendingSwing && !before;
        let fired=false;
        for(let i=0;i<400 && g.pendingSwing;i+=1){ g.ball.update(1/120); g.updatePendingSwing(1/120); }
        fired=g.ball.lastHitter==='player';
        return { cdBefore:+cdBefore.toFixed(2), d:+d.toFixed(2), closing:+closing.toFixed(2), buffered, fired,
          lastAfter:g.ball.lastHitter, cdAfter:+g.player.swingCooldown.toFixed(2) };
      });
      log.push({ ...s, ...res });
      if(res.fired){ /* keep playing to see repeated behaviour */ }
    }
  }
  if(s.phase==='over') ended=true;
  if(s.bounces<prev) prev=0;
  await page.waitForTimeout(120);
}
console.log('CLICK LOG');
for(const l of log) console.log(JSON.stringify(l));
console.log('SUMMARY', JSON.stringify({clicks:log.length, buffered:log.filter(x=>x.buffered).length, hits:log.filter(x=>x.fired).length}));
console.log('ERRORS', errors.slice(0,4).join('\n')||'(none)');
await browser.close();
