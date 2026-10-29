import { chromium } from 'playwright-core';
const CHROME='/home/dusan/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
const browser=await chromium.launch({executablePath:CHROME,headless:true,args:['--headless=new','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});
const errors=[];
const page=await browser.newPage({viewport:{width:1280,height:720}});
page.on('pageerror',e=>errors.push((e.stack||e.message).split('\n')[0]));
page.on('console',m=>{if(m.type()==='error')errors.push(m.text().slice(0,140));});
await page.goto('http://127.0.0.1:4173/?debug=1',{waitUntil:'load'});
await page.waitForFunction(()=>window.__SUNSET_SLAM_DEV__,null,{timeout:30000});
await page.evaluate(()=>{
  const g=window.__SUNSET_SLAM_DEV__;
  g.startMatch(); g.phase='serve'; g.ui.hideCountdown(); g.ui.showHud(true);
  g.player.pos.set(0,0,10.4); g.rival.pos.set(0.4,0,-9.2);
  g.score.player=2; g.score.rival=1; g.updateScoreHud();
  g.ui.setScore({player:'30',rival:'15',meta:'RACE TO 4',matchLabel:'TIEBREAK · FIRST TO 4',serving:'player'});
  g.ui.setAim({shot:'SLICE',hand:'backhand',ready:true,readiness:0.6});
  g.ui.setRally(6); g.ui.setTopSpeed(142);
  g.ui.setPrompt('WAITING FOR IT…','ready');
  g.snapCamera(true); g.updateHud(0.016);
  window.__THREE_GAME_TEST_HOOKS__?.hideDebugUi?.();
  document.querySelectorAll('.debug-panel').forEach((n)=>(n.hidden=true));
});
await page.waitForTimeout(400);
await page.screenshot({path:'artifacts/raw/hud-final-serve.png'});
// countdown in cluster
await page.evaluate(()=>{
  const g=window.__SUNSET_SLAM_DEV__;
  g.ui.showCountdown({kicker:'NEXT POINT',value:'YOUR SERVE',sub:'DUKA'}); g.ui.setPrompt('GET READY','neutral');
  g.renderer.render(g.scene,g.camera);
});
await page.waitForTimeout(300);
await page.screenshot({path:'artifacts/raw/hud-final-countdown.png'});
console.log('states done; errors:', errors.slice(0,5).join('\n')||'(none)');
await browser.close();
