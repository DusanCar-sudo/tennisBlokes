import { chromium } from 'playwright-core';
const CHROME='/home/dusan/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
const browser=await chromium.launch({executablePath:CHROME,headless:true,args:['--headless=new','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1280,height:720}});
const errors=[]; page.on('pageerror',e=>errors.push((e.stack||e.message).split('\n')[0]));
await page.goto('http://127.0.0.1:4173/?debug=1',{waitUntil:'load'});
await page.waitForFunction(()=>window.__SUNSET_SLAM_DEV__,null,{timeout:30000});
const out=await page.evaluate(()=>{
  const g=window.__SUNSET_SLAM_DEV__;
  g.startMatch('basket');
  g.paused=true; g.phase='rally';
  const H=g.hoops;
  const cases=[
    {label:'dunk (1.4m)',   pos:[0,-10.8], charge:0.72, want:'made-2'},
    {label:'layup (2.8m)',  pos:[0.4,-9.4], charge:0.72, want:'made-2'},
    {label:'freethrow (5.8m)', pos:[0,-6.4], charge:0.72, want:'made-2'},
    {label:'three (7.2m)',  pos:[0,-5.0], charge:0.72, want:'made-3'},
    {label:'deep (19m)',    pos:[0,6.9],  charge:0.72, want:'miss'},
    {label:'weak-brick',    pos:[0,-6.4], charge:0.3,  want:'miss'},
  ];
  const results=[];
  for(const c of cases){
    g.score.player=0; g.score.rival=0; g.phase='rally'; g.replay=null; g.pendingPoint=null; g.matchWinner=null;
    H.shot=null; H.lastScorer='player';
    H.resetPositions('player');
    g.player.pos.set(c.pos[0],0,c.pos[1]);
    g.rival.pos.set(...(c.def||[3.4,0,4.2]).slice(0,2).concat([0]).length===3?(c.def||[3.4,0,4.2]):[3.4,0,4.2]).set?g.rival.pos:g.rival.pos;
    if(c.def) g.rival.pos.set(c.def[0],0,c.def[1]); else g.rival.pos.set(3.4,0,4.2);
    g.ball.pos.copy(H.holdPos('player'));
    H.shoot('player',c.charge);
    let r=null;
    for(let i=0;i<800;i++){
      // chase so rebounds resolve
      if(i>360){ g.player.pos.x=g.ball.pos.x; g.player.pos.z=clampZ(g.ball.pos.z); }
      H.ballPhysics(1/120);
      if(g.phase==='point'){ r={made:true, score:g.score.player, reason:g.pendingPoint?.reason}; break; }
      if(H.possession && g.ball.mode==='held'){ r={made:false, picked:H.possession}; break; }
    }
    results.push({case:c.label, r});
    function clampZ(z){ return Math.max(-10.6, Math.min(12.4, z)); }
  }
  return results;
});
console.log(JSON.stringify(out,null,1));
console.log('ERRORS', errors.slice(0,4).join('\n')||'(none)');
await browser.close();
