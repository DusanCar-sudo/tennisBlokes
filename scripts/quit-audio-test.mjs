import { chromium } from 'playwright-core';
const CHROME='/home/dusan/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
const browser=await chromium.launch({executablePath:CHROME,headless:true,args:['--headless=new','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1440,height:900}});
const errors=[]; page.on('pageerror',e=>errors.push(e.message)); page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
await page.goto('http://127.0.0.1:5188/',{waitUntil:'load'});
await page.waitForFunction(()=>window.__THREE_GAME_TEST_HOOKS__,null,{timeout:20000});

// 1) Title → play → audio unlocked by the click gesture.
await page.locator('#play-btn').click();
await page.waitForTimeout(300);
console.log('AUDIO', await page.evaluate(()=>({
  ctx: !!window.__SUNSET_SLAM_DEV__.audio.ctx,
  state: window.__SUNSET_SLAM_DEV__.audio.ctx?.state,
  sound: window.__SUNSET_SLAM_DEV__.audio.soundEnabled,
  music: window.__SUNSET_SLAM_DEV__.audio.musicEnabled,
})));

// 2) Pause → quit to title.
await page.keyboard.press('Escape');
await page.waitForTimeout(250);
await page.locator('#pause-quit').click();
await page.waitForTimeout(400);
console.log('QUIT-PAUSE', await page.evaluate(()=>({
  phase: window.__SUNSET_SLAM_DEV__.phase,
  titleVisible: !document.getElementById('title-screen').hidden,
  pauseHidden: document.getElementById('pause-screen').hidden,
  hudHidden: document.getElementById('hud').hidden,
})));

// 3) Results → back to title.
await page.evaluate(async()=>{ await window.__THREE_GAME_TEST_HOOKS__.setState('match-won'); });
await page.locator('#title-btn').click({timeout:5000});
await page.waitForTimeout(400);
console.log('QUIT-RESULTS', await page.evaluate(()=>({
  phase: window.__SUNSET_SLAM_DEV__.phase,
  titleVisible: !document.getElementById('title-screen').hidden,
  resultsHidden: document.getElementById('results-screen').hidden,
})));
await page.screenshot({path:'artifacts/raw/quit-to-title.png'});

// 4) Sound toggle reflects in UI.
await page.evaluate(()=>window.__SUNSET_SLAM_DEV__.audio.toggleSound());
await page.waitForTimeout(100);
console.log('MUTE', await page.evaluate(()=>({
  mutedClass: document.body.classList.contains('is-muted'),
  label: document.getElementById('pause-sound')?.textContent,
})));
console.log('ERRORS', errors.join('\n')||'(none)');
await browser.close();
