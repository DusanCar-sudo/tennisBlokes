import { chromium } from 'playwright-core';
const CHROME='/home/dusan/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
const browser=await chromium.launch({executablePath:CHROME,headless:true,args:['--headless=new','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});
const errors=[];
const shoot=async (vp,name)=>{
  const page=await browser.newPage({viewport:vp});
  page.on('pageerror',e=>errors.push(name+': '+(e.stack||e.message).split('\n')[0]));
  page.on('console',m=>{if(m.type()==='error')errors.push(name+': '+m.text().slice(0,140));});
  await page.goto('http://127.0.0.1:4173/?debug=1',{waitUntil:'load'});
  await page.waitForFunction(()=>window.__SUNSET_SLAM_DEV__,null,{timeout:30000});
  await page.evaluate(()=>{
    const g=window.__SUNSET_SLAM_DEV__;
    g.startMatch(); g.phase='rally'; g.ui.hideCountdown(); g.ui.showHud(true);
    g.player.pos.set(0,0,10.4); g.playerCharacter.root.position.copy(g.player.pos);
    g.rival.pos.set(0.4,0,-9.2);
    g.ball.mode='flight'; g.ball.mesh.visible=true; g.ball.pos.set(2.2,1.3,8.2); g.ball.mesh.position.copy(g.ball.pos);
    g.ball.lastHitter='rival'; g.ball.bounces=1; g.rally=4;
    g.score.player=2; g.score.rival=1; g.updateScoreHud();
    g.ui.setScore({player:'30',rival:'15',meta:'RACE TO 4',matchLabel:'TIEBREAK · FIRST TO 4',serving:'player'});
    g.ui.setAim({shot:'TOPSPIN',hand:'forehand',ready:true,readiness:0.8});
    g.ui.setPrompt('CLICK TO HIT','ready');
    g.ui.showHitFeedback({rating:'PERFECT',detail:'FOREHAND · 138 KM/H',tone:'perfect',duration:5000});
    g.ui.setRally(4); g.ui.setTopSpeed(138);
    for(let i=0;i<20;i++) g.updateCharacters(0.05,0,0);
    g.snapCamera(true); g.updateHud(0.016);
    window.__THREE_GAME_TEST_HOOKS__?.hideDebugUi?.();
    document.querySelectorAll('.debug-panel').forEach((n) => (n.hidden = true));
  });
  await page.waitForTimeout(600);
  await page.screenshot({path:`artifacts/raw/hud-${name}.png`});
  // point banner state
  await page.evaluate(()=>{
    const g=window.__SUNSET_SLAM_DEV__;
    g.ui.showPointBanner({kicker:'POINT · DUKA',title:'DUKA',reason:'WINNER',tone:'player'});
    g.ui.setPrompt('NICE POINT','ready');
    g.renderer.render(g.scene,g.camera);
  });
  await page.waitForTimeout(400);
  await page.screenshot({path:`artifacts/raw/hud-${name}-point.png`});
  await page.close();
};
await shoot({width:1280,height:720},'desktop');
await shoot({width:390,height:844},'mobile');
console.log('shots done; errors:', errors.slice(0,6).join('\n')||'(none)');
await browser.close();
