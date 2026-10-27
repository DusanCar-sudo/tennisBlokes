import { chromium } from 'playwright-core';
const browser=await chromium.launch({executablePath:'/home/dusan/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',headless:true,args:['--headless=new','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1280,height:720}});
await page.goto('http://127.0.0.1:4173/',{waitUntil:'load'});
await page.waitForFunction(()=>window.__THREE_GAME_TEST_HOOKS__,null,{timeout:20000});
const out = await page.evaluate(async () => {
  const hooks = window.__THREE_GAME_TEST_HOOKS__;
  await hooks.setPausedForScreenshot(false);
  await hooks.seed(42);
  await hooks.setState('active-play');
  await hooks.setPausedForScreenshot(true);
  await hooks.setReducedMotion(true);
  await hooks.hideDebugUi(true);
  if (document.fonts) await document.fonts.ready;
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  return {
    diag: window.__THREE_GAME_DIAGNOSTICS__.renderer,
    phase: window.__THREE_GAME_DIAGNOSTICS__.phase,
    raf: 'ran',
  };
});
console.log(JSON.stringify(out,null,1));
await browser.close();
