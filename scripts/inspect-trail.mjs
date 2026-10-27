import { chromium } from 'playwright-core';
const CHROME='/home/dusan/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
const browser=await chromium.launch({executablePath:CHROME,headless:true,args:['--headless=new','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1440,height:900}});
await page.goto('http://127.0.0.1:5188/',{waitUntil:'load'});
await page.waitForFunction(()=>window.__THREE_GAME_DIAGNOSTICS__,null,{timeout:20000});
await page.evaluate(async()=>{await window.__THREE_GAME_TEST_HOOKS__.setState('active-play');});
const data=await page.evaluate(()=>{
  const g=window.__SUNSET_SLAM_DEV__;
  const pos=g.ball.trail.geometry.attributes.position.array;
  const alpha=g.ball.trail.geometry.attributes.aAlpha.array;
  const pts=[];
  for(let i=0;i<30;i++){
    const v=new g.ball.pos.constructor(pos[i*3],pos[i*3+1],pos[i*3+2]);
    const p=v.clone().project(g.camera);
    pts.push({i,x:Math.round((p.x*.5+.5)*innerWidth),y:Math.round((-p.y*.5+.5)*innerHeight),wx:+v.x.toFixed(2),wy:+v.y.toFixed(2),wz:+v.z.toFixed(2),a:+alpha[i].toFixed(2)});
  }
  return {pts, otherVisible:[]};
});
console.log(JSON.stringify(data.pts,null,1));
await browser.close();
