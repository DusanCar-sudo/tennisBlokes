// Aim-based shooting verification:
// crosshair on the rim + green release -> swish; bad aim -> miss; weak -> short.
import { chromium } from 'playwright-core';
const CHROME='/home/dusan/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
const browser=await chromium.launch({executablePath:CHROME,headless:true,args:['--headless=new','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1280,height:720}});
const errors=[]; page.on('pageerror',e=>errors.push((e.stack||e.message).split('\n')[0]));
await page.goto('http://127.0.0.1:4173/?debug=1',{waitUntil:'load'});
await page.waitForFunction(()=>window.__SUNSET_SLAM_DEV__,null,{timeout:30000});
const out=await page.evaluate(()=>{
  const g=window.__SUNSET_SLAM_DEV__;
  g.startMatch('basket'); g.paused=true; g.phase='rally';
  const H=g.hoops;
  const HOOPS={rimCenter:g.hoopsRim};
  const run=(aimYaw,label)=>{
    g.phase='rally'; g.pendingPoint=null; g.replay=null; g.matchWinner=null;
    H.resetPositions('player');
    g.player.pos.set(0,0,-6.4); g.rival.pos.set(3.4,0,4.2);
    // aim at the rim from this spot
    g.aimYaw=Math.atan2(window.__SUNSET_SLAM_DEV__.hoopsRim.x-g.player.pos.x, -(window.__SUNSET_SLAM_DEV__.hoopsRim.z-g.player.pos.z));
    g.aimPitch=-0.11;
    g.ball.pos.copy(H.holdPos('player'));
    H.shoot('player', aimYaw);
    let r=null;
    for(let i=0;i<800;i++){
      H.ballPhysics(1/120);
      if(g.phase==='point'){r={made:true,score:g.score.player};break;}
      if(H.possession&&g.ball.mode==='held'){r={made:false,how:'short/long'};break;}
    }
    return {label,r};
  };
  const after=()=>{
    const g2=window.__SUNSET_SLAM_DEV__;
    g2.phase='rally'; g2.paused=true;
    H.resetPositions('player');
    g2.player.pos.set(0,0,-6.4); g2.rival.pos.set(3.4,0,4.2);
    return H.greenZone();
  };
  const gz=after();
  return {
    greenZone:gz,
    perfect: run(gz.center,'perfect power'),
    slightStrong: run(gz.center+0.06,'slightly strong'),
    slightWeak: run(gz.center-0.06,'slightly weak'),
    veryWeak: run(0.15,'very weak'),
    ballRadiusVis:+(g.ball.mesh.scale.x*0.033).toFixed(3),
  };
});
console.log(JSON.stringify(out,null,1));
await page.screenshot({path:'artifacts/raw/tpbc-gauge.png'});
console.log('done');
await browser.close();
