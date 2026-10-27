import { chromium } from 'playwright-core';
const URL = process.env.GAME_URL || 'http://127.0.0.1:5188/';
const browser=await chromium.launch({executablePath:'/home/dusan/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',headless:true,args:['--headless=new','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1280,height:720}});
await page.goto(URL,{waitUntil:'load'});
await page.waitForFunction(()=>window.__THREE_GAME_DIAGNOSTICS__,null,{timeout:20000});
const audit=await page.evaluate(()=>{
  const game=window.__SUNSET_SLAM_DEV__;
  const scene=game.scene;
  const report={};
  const walk=(name,obj)=>{
    const found={meshes:0,visible:0,names:[]};
    obj?.traverse?.((o)=>{ if(o.isMesh){found.meshes++; if(o.visible)found.visible++; if(found.names.length<6)found.names.push(o.name||o.type);} });
    report[name]=found;
  };
  scene.traverse((o)=>{ if(o.isGroup && ['world','backdrop','court-furniture','fencing','stands','palms','big-screen'].includes(o.name)) walk(o.name,o); });
  report.renderer=window.__THREE_GAME_DIAGNOSTICS__.renderer;
  return report;
});
console.log(JSON.stringify(audit,null,1));
await browser.close();
