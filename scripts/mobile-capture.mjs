import { chromium, devices } from 'playwright-core';
const CHROME='/home/dusan/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
const browser=await chromium.launch({executablePath:CHROME,headless:true,args:['--headless=new','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});
const context=await browser.newContext({...devices['iPhone 13'], userAgent: undefined});
const page=await context.newPage();
const logs=[]; page.on('console',m=>{if(m.type()==='error') logs.push(m.text());}); page.on('pageerror',e=>logs.push(e.message));
await page.goto('http://127.0.0.1:5188/',{waitUntil:'load'});
await page.waitForFunction(()=>window.__THREE_GAME_TEST_HOOKS__,null,{timeout:20000});
await page.waitForTimeout(800);
for (const state of ['title','active-play']) {
  await page.evaluate(async(name)=>{await window.__THREE_GAME_TEST_HOOKS__.setState(name);await window.__THREE_GAME_TEST_HOOKS__.setPausedForScreenshot(true);}, state);
  await page.waitForTimeout(400);
  await page.screenshot({path:`artifacts/raw/mobile-${state}.png`, fullPage:true});
  const d=await page.evaluate(()=>window.__THREE_GAME_DIAGNOSTICS__);
  console.log(state, JSON.stringify(d));
}
console.log('logs', logs.slice(0,10).join('\n')||'(none)');
await browser.close();
