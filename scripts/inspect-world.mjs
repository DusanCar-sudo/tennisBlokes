import { chromium } from 'playwright-core';
const CHROME='/home/dusan/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
const browser=await chromium.launch({executablePath:CHROME,headless:true,args:['--headless=new','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1440,height:900}});
await page.goto('http://127.0.0.1:5188/',{waitUntil:'load'});
await page.waitForFunction(()=>window.__THREE_GAME_DIAGNOSTICS__,null,{timeout:20000});
await page.evaluate(async()=>{await window.__THREE_GAME_TEST_HOOKS__.setState('active-play');});
const data=await page.evaluate(()=>{
  const g=window.__SUNSET_SLAM_DEV__;
  const THREE = g.camera.constructor;
  function project(v){const p=v.clone().project(g.camera);return [Math.round((p.x*.5+.5)*innerWidth), Math.round((-p.y*.5+.5)*innerHeight), +p.z.toFixed(2)];}
  const trail = Array.from(g.ball.trail.geometry.attributes.position.array).slice(0,9);
  const trailPts = [];
  for (let i=0;i<5;i++){ const idx = i*3; trailPts.push(project(new g.ball.pos.constructor(trail[idx],trail[idx+1],trail[idx+2]))); }
  const arc = Array.from(g.arcPreview.geometry.attributes.position.array).slice(0,9);
  const arcPts = [];
  for (let i=0;i<3;i++){ const idx=i*3; arcPts.push(project(new g.ball.pos.constructor(arc[idx],arc[idx+1],arc[idx+2]))); }
  return {
    ball: {pos:g.ball.pos.toArray().map(n=>+n.toFixed(2)), screen:project(g.ball.pos), trailVisible:g.ball.trail.visible, trailPts},
    aim: {pos:g.aimMarker.position.toArray().map(n=>+n.toFixed(2)), screen:project(g.aimMarker.position), visible:g.aimMarker.visible, target:g.effectiveTarget.toArray().map(n=>+n.toFixed(2))},
    arc: {visible:g.arcPreview.visible, pts:arcPts, opacity:g.arcPreview.material.opacity},
    camera: {pos:g.camera.position.toArray().map(n=>+n.toFixed(2)), rot:g.camera.rotation.toArray().slice(0,3)},
    reticle: (()=>{const r=document.getElementById('reticle').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,cls:document.getElementById('reticle').className};})(),
    chip: (()=>{const r=document.getElementById('shot-chip').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,cls:document.getElementById('shot-chip').className};})(),
  };
});
console.log(JSON.stringify(data,null,2));
await browser.close();
