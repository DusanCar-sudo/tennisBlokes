// Verifies the waiting/notification flow:
//  B (Laki) presses JOIN while nobody hosts -> auto-join waiting
//  A (Duka) hosts -> B auto-joins -> A gets chime + tab title + system notification
import { chromium } from 'playwright-core';
const CHROME='/home/dusan/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
const browser=await chromium.launch({executablePath:CHROME,headless:true,args:['--headless=new','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});
const mk=async()=>{
  const p=await browser.newPage({viewport:{width:1280,height:720}});
  const errors=[]; p.on('pageerror',e=>errors.push((e.stack||e.message).split('\n')[0]));
  p.on('console',m=>{if(m.type()==='error')errors.push(m.text().slice(0,150));});
  await p.goto('http://127.0.0.1:4173/?debug=1',{waitUntil:'load'});
  await p.waitForFunction(()=>window.__SUNSET_SLAM_DEV__,null,{timeout:30000});
  await p.evaluate(()=>{
    const g=window.__SUNSET_SLAM_DEV__;
    // capture system notifications without real OS permission
    window.__notes=[];
    class FakeNotification { constructor(title, opts={}) { window.__notes.push({title, body:opts.body}); } close(){} }
    Object.defineProperty(FakeNotification, 'permission', { get: () => 'granted' });
    FakeNotification.requestPermission = () => Promise.resolve('granted');
    window.Notification = FakeNotification;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    window.__alerts=0; const orig=g.audio.playAlert.bind(g.audio); g.audio.playAlert=()=>{window.__alerts+=1; return orig();};
  });
  return {p, errors};
};
const A=await mk();
const B=await mk();
// Laki joins first and waits
await B.p.evaluate(()=>document.getElementById('join-btn').click());
await B.p.waitForTimeout(1200);
const bWait=await B.p.evaluate(()=>({title:document.title,status:document.getElementById('lobby-status-text').textContent, retrying:!!window.__SUNSET_SLAM_DEV__.joinRetry}));
// Duka hosts
await A.p.evaluate(()=>document.getElementById('host-btn').click());
await A.p.waitForTimeout(1500);
const aWait=await A.p.evaluate(()=>({title:document.title,status:document.getElementById('lobby-status-text').textContent,code:document.getElementById('lobby-code').textContent}));
// wait until Laki auto-joins (retry every 2.5 s) and the notification fires on A
await A.p.waitForFunction(()=>window.__notes.length>0, null, {timeout:30000});
const aAfter=await A.p.evaluate(()=>({
  title:document.title,
  notes:window.__notes.slice(0,2),
  alerts:window.__alerts,
  toast:document.getElementById('toast')?.innerText.trim(),
  status:document.getElementById('lobby-status-text').textContent,
}));
const bAfter=await B.p.evaluate(()=>({title:document.title,status:document.getElementById('lobby-status-text').textContent}));
// both should enter the match shortly
await A.p.waitForFunction(()=>window.__THREE_GAME_DIAGNOSTICS__?.phase && ['intro','serve','rally'].includes(window.__THREE_GAME_DIAGNOSTICS__.phase), null, {timeout:60000});
const aPhase=await A.p.evaluate(()=>window.__THREE_GAME_DIAGNOSTICS__.phase);
const aTitleInGame=await A.p.evaluate(()=>document.title);
const errs=[...A.errors,...B.errors];
console.log('B WAITING  ', JSON.stringify(bWait));
console.log('A WAITING  ', JSON.stringify(aWait));
console.log('A MATCHED  ', JSON.stringify(aAfter));
console.log('B MATCHED  ', JSON.stringify(bAfter));
console.log('A IN GAME  ', JSON.stringify({phase:aPhase, title:aTitleInGame}));
console.log('ERRORS A+B ', errs.slice(0,5).join('\n')||'(none)');
await browser.close();
