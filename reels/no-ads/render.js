// Renders reel.html frame by frame (deterministic seek), then ffmpeg → mp4.
const {chromium}=require('playwright');const fs=require('fs');const path=require('path');
const FPS=30,DUR=11.5,out=process.argv[2]||'frames';
(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:1080,height:1920}});
await p.goto('file://'+path.resolve(__dirname,'reel.html'));await p.evaluate(()=>document.fonts.ready);
await p.waitForTimeout(500);fs.mkdirSync(out,{recursive:true});
const only=process.argv[3]?process.argv[3].split(',').map(Number):null;
const n=Math.round(FPS*DUR);
for(let i=0;i<n;i++){const t=i*1000/FPS;if(only&&!only.includes(Math.round(t/100)/10))continue;
 await p.evaluate(t=>window.seek(t),t);
 await p.screenshot({path:`${out}/f${String(i).padStart(4,'0')}.png`});}
await b.close();})();
