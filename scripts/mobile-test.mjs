import { chromium, devices } from 'playwright-core';
const CHROME='/home/dusan/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
const browser=await chromium.launch({executablePath:CHROME,headless:true,args:['--headless=new','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});
const profiles=[
  ['Pixel 7', devices['Pixel 7']],
  ['iPhone SE', devices['iPhone SE']],
  ['iPhone 14 Pro Max', devices['iPhone 14 Pro Max']],
  ['Pixel 7 landscape', {...devices['Pixel 7'], viewport:{width:915,height:412}, isMobile:true}],
];
let failed=0;
for (const [name, prof] of profiles) {
  const ctx=await browser.newContext({ ...prof });
  const page=await ctx.newPage();
  const errors=[]; page.on('pageerror',e=>errors.push((e.stack||e.message).split('\n')[0]));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text().slice(0,140));});
  await page.goto('http://127.0.0.1:4173/?debug=1',{waitUntil:'load'});
  await page.waitForFunction(()=>window.__SUNSET_SLAM_DEV__,null,{timeout:30000});
  await page.evaluate(()=>{ const g=window.__SUNSET_SLAM_DEV__; g.startMatch(); g.phase='rally'; g.ui.hideCountdown(); g.ui.showHud(true); g.player.pos.set(0,0,10.4); g.player.vel.set(0,0,0); g.ui._initViewportMode(); });
  await page.waitForTimeout(250);
  const layout=await page.evaluate(()=>{
    const r=(id)=>{const el=document.getElementById(id); if(!el) return null; const b=el.getBoundingClientRect(); return {x:Math.round(b.x),y:Math.round(b.y),w:Math.round(b.width),h:Math.round(b.height),bottom:Math.round(b.bottom)};};
    const c=document.getElementById('game-canvas');
    return { innerH:window.innerHeight, innerW:window.innerWidth,
      visH:Math.round(window.visualViewport?.height ?? 0),
      canvasH:c.clientHeight, canvasW:c.clientWidth,
      joystick:r('joystick-zone'), hit:r('hit-button'),
      docScrollH:document.documentElement.scrollHeight };
  });
  const inside=(o)=>o && o.y>=0 && o.bottom<=layout.innerH+1;
  const fit={joystickInside:inside(layout.joystick),hitInside:inside(layout.hit),canvasFits:Math.abs(layout.canvasH-layout.innerH)<=2,noScroll:layout.docScrollH<=layout.innerH+2};

  const cdp=await ctx.newCDPSession(page);
  const touch=async(type,x,y)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x,y,id:1}]});
  const before=await page.evaluate(()=>{const g=window.__SUNSET_SLAM_DEV__;return {px:g.player.pos.x,pz:g.player.pos.z,yaw:g.aimYaw};});
  const j=layout.joystick;
  const grab=async()=>{ await touch('touchStart', j.x+j.w/2, j.y+j.h/2); await touch('touchMove', j.x+j.w/2, j.y+j.h/2 - j.w*0.3); await page.waitForTimeout(500); };
  await grab();
  let active=await page.evaluate(()=>window.__SUNSET_SLAM_DEV__.joystick.active);
  if(!active){ await touch('touchEnd',0,0); await grab(); }
  const yawBefore=await page.evaluate(()=>window.__SUNSET_SLAM_DEV__.aimYaw);
  await page.waitForTimeout(700);
  const during=await page.evaluate(()=>{const g=window.__SUNSET_SLAM_DEV__;return {px:g.player.pos.x,pz:g.player.pos.z,yaw:g.aimYaw,joy:{...g.joystick}};});
  await touch('touchEnd',0,0);
  const moved=Math.hypot(during.px-before.px, during.pz-before.pz);
  const yawDelta=Math.abs(during.yaw-yawBefore);
  const aimOk = layout.innerW>0;
  const pass = fit.joystickInside && fit.hitInside && fit.canvasFits && fit.noScroll && moved>0.6 && yawDelta<0.02 && errors.length===0;
  if(!pass) failed+=1;
  console.log((pass?'PASS':'FAIL'), name, JSON.stringify({...fit, bodyMoved:+moved.toFixed(2), cameraYawDelta:+yawDelta.toFixed(3), joyZ:+during.joy.z.toFixed(2), errors:errors.length}));
  await ctx.close();
}
console.log(failed===0?'ALL MOBILE PROFILES PASS':failed+' profile(s) failed');
await browser.close();
