"""Map-first /map.html — a place opens over the map, so the reader stays on it.

Michael, 2026-09-28, through Nan: he finds motdang awkward and wants to work
with place IDs and maps directly. Her list, all of it:
  - stay on the map: a place opens in a sheet over the map; Back closes it
  - type or paste a place ID (MD-XXXXX, placecode.py) or a Mot Dang link
  - lots of coordinate systems, open-source mapping tools first (coords.js,
    coords_layer.py); what3words is recognised and answered with why it is not
    converted (their API needs an account)
  - drop pins and share them: the pins ride in the address, so the link is the set
  - search moves the map: a word searches what is on screen, and again as it moves

explore.js owns the map and the address bar; this file reaches it through
window.MDX (set when the map is ready), window.MDMAPSHEET (the sheet explore.js
opens a place in) and window.MDX_EXTRA (the q= and pins= it writes into the hash)."""

import glyphs


def search_html(bi, att, bi_text):
    ph = bi_text("ค้นหา หรือวางรหัสที่ / พิกัด / ลิงก์แผนที่",
                 "Search, or paste a place ID, coordinates or a map link")
    return (f'<form class="mfq" id="mfq" role="search">'
            f'<input id="mfin" type="search" enterkeyhint="go" autocomplete="off" '
            f'placeholder="{att(ph)}" aria-label="{att(ph)}">'
            f'<button type="submit">{glyphs.icon("i-search", 20)}'
            f'<span class="sr">{bi("ไป", "Go")}</span></button></form>'
            f'<p id="mfsay" class="mfsay" role="status" aria-live="polite"></p>')


def bar_html(bi, att, bi_text):
    return (f'<button type="button" id="mfme" class="xbtn">'
            f'{glyphs.icon("i-share", 20)}{bi("ส่งตำแหน่งฉัน", "Send my location")}</button>'
            f'<button type="button" id="mfdrop" class="xbtn" aria-pressed="false" '
            f'title="{att(bi_text("แตะแผนที่เพื่อปักหมุด หรือกดค้าง", "tap the map to drop a pin, or press and hold"))}">'
            f'{glyphs.icon("i-pin", 20)}{bi("ปักหมุด", "Drop a pin")}</button>'
            f'<button type="button" id="mfshare" class="xbtn" hidden>'
            f'{glyphs.icon("i-share", 20)}{bi("ส่งหมุด", "Send pins")}</button>')


CSS = """
.mfq{display:flex;gap:6px;margin:6px 0 4px}
.mfq input{flex:1;min-width:0;font:inherit;font-size:1rem;min-height:48px;padding:8px 12px;
  border:2px solid var(--ink,#2a1e16);border-radius:12px;background:var(--paper,#fffdf8);color:var(--ink,#2a1e16)}
.mfq button{min-width:52px;min-height:48px;border:2px solid var(--ink,#2a1e16);border-radius:12px;
  background:#C2401C;color:#fff;cursor:pointer}
.mfq .sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.mfsay{margin:0 0 6px;min-height:1.3em;font-size:.9rem;color:var(--mute,#5c4d38)}
.mfsheet{position:fixed;left:0;right:0;bottom:0;max-height:52vh;overflow:auto;z-index:60;
  background:var(--paper,#fffdf8);color:var(--ink,#2a1e16);border-top:3px solid var(--ink,#2a1e16);border-radius:18px 18px 0 0;
  box-shadow:0 -10px 30px rgba(30,20,10,.18);padding:12px 16px calc(18px + env(safe-area-inset-bottom))}
@media (min-width:900px){.mfsheet{left:auto;right:16px;top:84px;bottom:16px;width:390px;max-height:none;
  border:2px solid var(--ink,#2a1e16);border-radius:18px}}
.mfsheet h2{margin:.1em 2.4em .2em 0;font-size:1.25rem;line-height:1.3}
.mfx{position:absolute;right:10px;top:10px;width:44px;height:44px;border-radius:50%;
  border:2px solid var(--ink,#2a1e16);background:var(--paper,#fffdf8);color:var(--ink,#2a1e16);cursor:pointer}
.mfsheet .mfsub{margin:0 0 8px;color:var(--mute,#5c4d38);font-size:.9rem}
.mfsheet img{width:100%;max-height:150px;border-radius:12px;margin:4px 0 8px;object-fit:cover}
.mfsheet dl.mff{display:grid;grid-template-columns:auto 1fr;gap:4px 10px;margin:6px 0}
.mfsheet dl.mff dt{color:var(--mute,#5c4d38);font-size:.85rem}
.mfsheet dl.mff dd{margin:0;overflow-wrap:anywhere}
.mfbtns{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}
.mfbtns a,.mfbtns button{display:inline-flex;align-items:center;gap:4px;min-height:44px;padding:6px 12px;
  border:2px solid var(--ink,#2a1e16);border-radius:12px;background:var(--paper,#fffdf8);color:var(--ink,#2a1e16);
  font:inherit;font-size:.9rem;text-decoration:none;cursor:pointer}
.mfbtns .go{background:#C2401C;color:#fff;border-color:#C2401C}
.mfco{margin:10px 0;border-top:1px solid var(--rule,#e3d5bc);padding-top:8px}
.mfco summary{cursor:pointer;font-weight:600;min-height:32px}
.mfco dl{display:grid;grid-template-columns:1fr;gap:2px;margin:6px 0}
.mfco dt{font-size:.8rem;color:var(--mute,#5c4d38);margin-top:6px}
.mfco dd{margin:0;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.mfco code{font-family:ui-monospace,Menlo,monospace;font-size:.9rem;background:#f4ecd8;padding:2px 6px;border-radius:6px}
.mfcopy{font:inherit;font-size:.78rem;padding:3px 8px;border:1px solid var(--ink,#2a1e16);border-radius:8px;
  background:var(--paper,#fffdf8);color:var(--ink,#2a1e16);cursor:pointer}
.mfopen a{white-space:nowrap}
.mfnear{list-style:none;padding:0;margin:6px 0}
.mfnear button{width:100%;text-align:left;font:inherit;padding:8px 10px;margin:3px 0;min-height:44px;
  border:1px solid var(--rule,#e3d5bc);border-radius:10px;background:var(--paper,#fffdf8);color:var(--ink,#2a1e16);cursor:pointer}
.mfname{width:100%;font:inherit;font-size:1rem;min-height:44px;padding:6px 10px;margin:4px 0 8px;
  border:2px solid var(--ink,#2a1e16);border-radius:10px;background:var(--paper,#fffdf8);color:var(--ink,#2a1e16)}
.mfpin{width:30px;height:30px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);cursor:pointer;
  background:var(--link,#14479b);border:3px solid #fff;box-shadow:0 0 0 2px var(--ink,#2a1e16);padding:0;display:grid;place-items:center}
.mfpin span{display:block;transform:rotate(45deg);color:#fff;font:700 13px/1 inherit}
.mapdrop canvas{cursor:crosshair!important}
.mfbtns a.line{background:#06c755;border-color:#06c755;color:#fff}
"""


JS = r"""
(function(){
var S={q:'',pins:[],drop:false,marks:[]};
var LD=%LINEDOOR%;  /* linedoor.py: null until the LINE bot answers */
function lineKeep(url){return LD?'<a class="go" href="https://line.me/R/oaMessage/'+LD.oa+'/?'+
  encodeURIComponent(LD.pins+url)+'" rel="noopener">เก็บไว้ใน LINE · Keep in LINE</a>':'';}
function $(id){return document.getElementById(id);}
function E(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function ic(n,s){return window.mdIcon?window.mdIcon(n,s||16):'';}
function R(){return window.MDX?MDX.root():'';}
function say(t){var el=$('mfsay');if(el)el.textContent=t||'';}
function fm(m){return m<950?Math.round(m)+' ม. · m':(m/1000).toFixed(1)+' กม. · km';}

/* ---- what this file adds to the address ------------------------------ */
function pinsStr(){return S.pins.map(function(p){return p.lat.toFixed(5)+','+p.lng.toFixed(5)+
  (p.n?','+p.n.replace(/[;,]/g,' '):'');}).join(';');}
window.MDX_EXTRA=function(){var o=[];
  if(S.q)o.push('q='+encodeURIComponent(S.q));
  if(S.pins.length)o.push('pins='+encodeURIComponent(pinsStr()));
  return o.join('&');};
function readExtra(){
  var h=(location.hash||'').replace(/^#/,'').split('/'),out={};
  (h[4]||'').split('&').forEach(function(kv){var i=kv.indexOf('=');if(i<0)return;
    try{out[kv.slice(0,i)]=decodeURIComponent(kv.slice(i+1));}catch(e){}});
  return out;}
function save(){if(window.MDX)MDX.writeHash();}

/* ---- the sheet --------------------------------------------------------- */
var sheet,body,pushed=false;
function mk(){
  sheet=document.createElement('aside');sheet.className='mfsheet';sheet.hidden=true;
  sheet.innerHTML='<button type="button" class="mfx" aria-label="ปิด · close">'+ic('i-x',20)+'</button><div class="mfbody"></div>';
  document.body.appendChild(sheet);body=sheet.querySelector('.mfbody');
  sheet.querySelector('.mfx').addEventListener('click',close);
  sheet.addEventListener('click',function(e){
    /* only the Send this spot button: the LINE / Share / Copy link row beside it
       carries no point, and reading one from it sent 0,0 (Nan, 2026-10-20) */
    var sd=e.target.closest('button.mfsend');
    if(sd&&window.MDSHAREPOINT){window.MDSHAREPOINT(+sd.getAttribute('data-lat'),+sd.getAttribute('data-lng'),{name:sd.getAttribute('data-n')||'',kind:'map'});return;}
    var c=e.target.closest('.mfcopy');if(c)copy(c.getAttribute('data-c'),c);});
}
function open(html){
  body.innerHTML=html;sheet.hidden=false;sheet.scrollTop=0;
  /* a phone: bring the map to the top of the screen so the sheet sits under it, not on it */
  if(window.MDX&&innerWidth<900){var r=MDX.el.getBoundingClientRect();
    if(r.top>8||r.top<-40)scrollBy({top:r.top-4,behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'auto':'smooth'});}
  if(!pushed){try{history.pushState({mf:1},'',location.href);pushed=true;}catch(e){}}
}
function close(){if(!sheet||sheet.hidden)return;sheet.hidden=true;
  if(pushed){pushed=false;try{history.back();}catch(e){}}}
window.addEventListener('popstate',function(){pushed=false;if(sheet&&!sheet.hidden)sheet.hidden=true;});
document.addEventListener('keydown',function(e){if(e.key==='Escape')close();});
function copy(t,btn){
  function ok(){if(btn){var o=btn.textContent;btn.textContent='คัดลอกแล้ว · Copied';setTimeout(function(){btn.textContent=o;},1400);}}
  if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(t).then(ok,function(){prompt('',t);});
  else prompt('',t);
}

/* ---- every way to say where a point is --------------------------------- */
function coordsHtml(lat,lng,name,openIt){
  /* the site's send sheet (share_layer MDSHAREPOINT): the address, the Plus Code, every map app */
  var h=window.MDSHAREPOINT?'<p><button type="button" class="mfcopy mfsend" data-lat="'+lat+'" data-lng="'+lng+'" data-n="'+E(name||'')+'">ส่งตำแหน่งนี้ · Send this spot</button></p>':'';
  h+='<details class="mfco"'+(openIt?' open':'')+'><summary>พิกัดทุกแบบ · Every coordinate system</summary>';
  if(window.MDCOORDS){
    h+='<dl>'+MDCOORDS.format(lat,lng).map(function(x){return '<dt>'+E(x.th)+' · '+E(x.en)+'</dt><dd><code>'+
      E(x.text)+'</code><button type="button" class="mfcopy" data-c="'+E(x.text)+'">คัดลอก · Copy</button></dd>';}).join('')+'</dl>';
    h+='<p class="mfopen"><b>เปิดใน · Open in</b><br>'+MDCOORDS.links(lat,lng,name||'').map(function(x){
      return '<a href="'+E(x.href)+'" rel="noopener">'+E(x.en)+'</a>';}).join(' · ')+'</p>';
  }else{var t=lat.toFixed(6)+', '+lng.toFixed(6);
    h+='<p><code>'+t+'</code> <button type="button" class="mfcopy" data-c="'+t+'">คัดลอก · Copy</button></p>';}
  return h+'</details>';
}
function nearHtml(it){
  var n=(window.MDX&&it.lat!=null)?MDX.pinsNear(it):null;
  if(!n||!n.length)return '';
  NEAR=n.map(function(p){return p[1];});
  return '<h3>ใกล้ ๆ · Nearby</h3><ul class="mfnear">'+n.map(function(p,i){
    return '<li><button type="button" data-near="'+i+'">'+E(p[1].name)+' <span class="quiet">· '+fm(p[0])+'</span></button></li>';}).join('')+'</ul>';
}
var NEAR=[];
function wireNear(){body.querySelectorAll('[data-near]').forEach(function(b){
  b.addEventListener('click',function(){var it=NEAR[+b.getAttribute('data-near')];
    if(it&&window.MDSENSE)MDSENSE.tell('near',{k:it.plan,lat:it.lat,lng:it.lng});if(it)show(it,{fly:true});});});}

/* ---- send a place or a point to anyone ----------------------------------
   Nan, 2026-09-28: "use motdang/line to send your location to anyone on LINE
   or other map apps, just like any placeid". A place travels as its MD- code,
   a point as its Plus Code; both open on this map through ?go=, and the
   sheet there carries the open-in links for every other map app. */
function goLink(id,n){return location.origin+location.pathname+'?go='+encodeURIComponent(id)+(n?'&n='+encodeURIComponent(n):'');}
function plusOf(lat,lng){
  if(!window.MDCOORDS)return lat.toFixed(6)+','+lng.toFixed(6);
  var f=MDCOORDS.format(lat,lng).filter(function(x){return x.kind==='pluscode'||x.kind==='olc';})[0];
  return f?f.text:lat.toFixed(6)+','+lng.toFixed(6);
}
function sendRow(what,id,n){
  var link=goLink(id,n),msg=what+' '+link;
  return '<div class="mfbtns mfsendrow"><a class="go line" href="https://line.me/R/share?text='+encodeURIComponent(msg)+
    '" rel="noopener">'+ic('i-share',18)+'ส่งทาง LINE · Send in LINE</a>'+
    (navigator.share?'<button type="button" data-share="'+E(link)+'" data-t="'+E(what)+'">'+ic('i-share',18)+'แชร์ · Share</button>':'')+
    '<button type="button" class="mfcopy" data-c="'+E(link)+'">คัดลอกลิงก์ · Copy link</button></div>';
}
document.addEventListener('click',function(e){var b=e.target.closest&&e.target.closest('[data-share]');
  if(b&&navigator.share)navigator.share({title:b.getAttribute('data-t'),url:b.getAttribute('data-share')}).catch(function(){});});

/* ---- a place ---------------------------------------------------------- */
/* On a phone the sheet covers the bottom half: the point it is about is
   moved into the part of the map still showing. */
function seen(lat,lng,fly,zoom){
  if(!window.MDX||lat==null)return;
  var m=MDX.map,c=m.getContainer().getBoundingClientRect(),sh=sheet&&!sheet.hidden?sheet.getBoundingClientRect():null;
  var cover=(sh&&sh.left<=c.left+10)?Math.max(0,c.bottom-sh.top):0;
  var p=m.project([lng,lat]),free=c.height-cover;
  if(fly){m.easeTo({center:[lng,lat],zoom:zoom||Math.max(m.getZoom(),16.5),offset:[0,-cover/2]});return;}
  if(p.y>free-30||p.y<30)m.panBy([0,p.y-(free/2)]);
}
var showSeq=0;
function show(it,opt){
  opt=opt||{};var mine=++showSeq;
  if(window.MDSENSE)MDSENSE.tell('open',{k:it.plan,lat:it.lat,lng:it.lng,z:window.MDX&&MDX.map.getZoom()});
  if(!sheet)mk();
  open('<h2>'+E(it.name)+'</h2><p class="mfsub">'+E(it.sub||'')+'</p><p class="quiet">…</p>');
  setTimeout(function(){seen(it.lat,it.lng,opt.fly);},380);
  if(!it.json){render(it,{});return;}
  /* only the card asked for last is drawn: an earlier one that answers late is dropped */
  fetch(it.json).then(function(r){return r.json();}).then(function(d){if(mine===showSeq)render(it,d);})
    .catch(function(){if(mine===showSeq)render(it,{});});
}
function render(it,d){
  var lat=d.lat!=null?d.lat:it.lat,lng=d.lng!=null?d.lng:it.lng;
  var nm=(d.names&&[d.names.th,d.names.en].filter(Boolean).join(' · '))||it.name;
  var h='<h2>'+E(nm)+'</h2><p class="mfsub">'+E(it.sub||'')+'</p>';
  if(d.photo&&d.photo.url)h+='<img src="'+E(d.photo.url)+'" alt="" loading="lazy">';
  h+='<div class="mfbtns">';
  if(d.phone)h+='<a class="go" href="tel:'+E(String(d.phone).replace(/[^0-9+]/g,''))+'">'+ic('i-phone',18)+'โทร · Call</a>';
  if(lat!=null&&window.MDCOORDS){var dir=MDCOORDS.links(lat,lng,nm)[0];
    if(dir)h+='<a href="'+E(dir.href)+'" rel="noopener">'+ic('i-map',18)+E(dir.en)+'</a>';}
  if(it.href)h+='<a href="'+E(it.href)+'">'+ic('i-list',18)+'หน้าเต็ม · Full page</a>';
  h+='<button type="button" id="mfpinit">'+ic('i-pin',18)+'ปักหมุด · Pin</button>';
  if(it.plan&&window.MDSAVED&&MDSAVED.has({k:it.plan}))h+='<button type="button" id="mfunsave">'+ic('i-x',18)+'เลิกบันทึก · Unsave</button>';
  h+='</div>';
  h+='<dl class="mff">';
  if(d.code)h+='<dt>รหัสที่ · Place ID</dt><dd><code>'+E(d.code)+'</code> <button type="button" class="mfcopy" data-c="'+E(d.code)+'">คัดลอก · Copy</button></dd>';
  if(d.address)h+='<dt>ที่อยู่ · Address</dt><dd>'+E(d.address)+'</dd>';
  if(d.hours)h+='<dt>เวลา · Hours</dt><dd>'+E(d.hours)+'</dd>';
  if(d.phone)h+='<dt>โทร · Phone</dt><dd><a href="tel:'+E(String(d.phone).replace(/[^0-9+]/g,''))+'">'+E(d.phone)+'</a></dd>';
  if(d.website)h+='<dt>เว็บ · Web</dt><dd><a href="'+E(d.website)+'" rel="noopener">'+E(String(d.website).replace(/^https?:\/\/(www\.)?/,'').slice(0,48))+'</a></dd>';
  h+='</dl>';
  if(d.code||lat!=null)h+=sendRow(nm+' · มดแดง',d.code||plusOf(lat,lng));
  if(lat!=null)h+=coordsHtml(lat,lng,nm,false);
  h+=nearHtml({lat:lat,lng:lng,plan:it.plan});
  if(d.photo&&d.photo.credit)h+='<p class="quiet" style="font-size:.75rem">'+E(d.photo.credit)+'</p>';
  body.innerHTML=h;wireNear();
  var pb=$('mfpinit');if(pb)pb.addEventListener('click',function(){addPin(lat,lng,nm,true,it.plan);});
  var us=$('mfunsave');if(us)us.addEventListener('click',function(){MDSAVED.forget({k:it.plan});us.remove();
    if(window.MDSENSE)MDSENSE.tell('unsave',{k:it.plan,lat:lat,lng:lng});});
}
window.MDMAPSHEET={show:show,point:function(lat,lng,t){showPoint(lat,lng,t);}};

/* ---- a point: pasted, or a dropped pin --------------------------------- */
var ptMark=null;
function showPoint(lat,lng,title,pinIdx){
  if(!sheet)mk();++showSeq;
  var h='<h2>'+E(title||'จุดนี้ · This point')+'</h2>';
  if(pinIdx!=null){
    h+='<label>ชื่อหมุด · Name this pin<input class="mfname" id="mfpname" value="'+E(S.pins[pinIdx].n||'')+'" maxlength="60"></label>'+
       '<div class="mfbtns"><button type="button" id="mfsend">'+ic('i-share',18)+'ส่งหมุดทั้งหมด · Send all pins</button>'+
       '<button type="button" id="mfdel">'+ic('i-x',18)+'ลบหมุดนี้ · Remove</button></div>';
  }else{
    h+='<div class="mfbtns"><button type="button" id="mfpinpt">'+ic('i-pin',18)+'ปักหมุดที่นี่ · Pin it</button>'+
       (window.MDSAVED&&MDSAVED.has({lat:lat,lng:lng})?'<button type="button" id="mfunsave">'+ic('i-x',18)+'เลิกบันทึก · Unsave</button>':'')+'</div>';
  }
  h+=sendRow((title||'จุดนี้ · This point')+' · มดแดง',plusOf(lat,lng),title?String(title).slice(0,60):'');
  h+=coordsHtml(lat,lng,title,true)+nearHtml({lat:lat,lng:lng,plan:''});
  open(h);wireNear();setTimeout(function(){seen(lat,lng,false);},380);
  if(pinIdx==null)placeHere(lat,lng);
  var nmI=$('mfpname');if(nmI)nmI.addEventListener('input',function(){S.pins[pinIdx].n=nmI.value;drawPins();save();
    /* the send row carries the name: redraw it with the new one */
    var row=body.querySelector('.mfsendrow'),nn=nmI.value.slice(0,60);
    if(row){var w=document.createElement('div');w.innerHTML=sendRow((nn||'จุดนี้ · This point')+' · มดแดง',plusOf(lat,lng),nn);row.replaceWith(w.firstChild);}
    if(window.MDSAVED)MDSAVED.add({lat:lat,lng:lng,n:nmI.value.slice(0,60)});});
  var us=$('mfunsave');if(us)us.addEventListener('click',function(){MDSAVED.forget({lat:lat,lng:lng});us.remove();
    if(window.MDSENSE)MDSENSE.tell('unsave',{lat:lat,lng:lng});});
  var sd=$('mfsend');if(sd)sd.addEventListener('click',share);
  var dl=$('mfdel');if(dl)dl.addEventListener('click',function(){
    if(window.MDSAVED)MDSAVED.forget({lat:lat,lng:lng});S.pins.splice(pinIdx,1);drawPins();save();close();});
  var pp=$('mfpinpt');if(pp)pp.addEventListener('click',function(){addPin(lat,lng,title&&title.indexOf('·')<0?title:'',true);});
}
/* A point within ~25 m of a place Mot Dang knows offers that place at the top of its card: a shared Plus
   Code or coordinates opened beside the place's own record, nameless (Nan, 2026-10-20, gemba 2: Tulou, 6 m). */
function placeHere(lat,lng){
  var mine=showSeq,d=0.00025,bb=[lng-d,lat-d,lng+d,lat+d].map(function(x){return x.toFixed(6);}).join(',');
  fetch(R()+'api/v1/places?bbox='+bb+'&limit=10').then(function(r){return r.json();}).then(function(j){
    if(mine!==showSeq||!body)return;
    var h=(j.results||[]).filter(function(r){return r.lat!=null;}).map(function(r){
      return [far({lat:r.lat,lng:r.lng},{lat:lat,lng:lng})*111320,r];}).filter(function(x){return x[0]<=25;})
      .sort(function(a,b){return a[0]-b[0];});
    if(!h.length)return;
    var r=h[0][1],it=qItem(r),b=document.createElement('button');
    b.type='button';b.className='mfhere';
    b.style.cssText='display:block;width:100%;min-height:44px;margin:4px 0 8px;padding:8px 12px;border:2px solid #C2401C;'+
      'border-radius:10px;background:#fff7f2;color:#7a2410;font:inherit;font-weight:600;text-align:left;cursor:pointer';
    b.textContent='ตรงนี้คือ · This is '+it.name+' · '+Math.round(h[0][0])+' ม. · m';
    b.addEventListener('click',function(){show(it,{fly:true});});
    var p=document.createElement('p');p.appendChild(b);
    var h2=body.querySelector('h2');if(h2)h2.after(p);else body.prepend(p);
  }).catch(function(){});
}
function gotoPoint(lat,lng,zoom,title){
  var m=MDX.map;
  if(ptMark)ptMark.remove();
  var el=document.createElement('div');el.className='xpin';
  ptMark=new maplibregl.Marker({element:el}).setLngLat([lng,lat]).addTo(m);
  showPoint(lat,lng,title);
  setTimeout(function(){seen(lat,lng,true,zoom);},400);
}

/* ---- dropped pins, carried in the address ------------------------------- */
function drawPins(){
  S.marks.forEach(function(m){m.remove();});S.marks=[];
  if(!window.MDX||!window.maplibregl)return;
  S.pins.forEach(function(p,i){
    var b=document.createElement('button');b.type='button';b.className='mfpin';
    b.setAttribute('aria-label',(p.n||('หมุด '+(i+1)))+' · pin '+(i+1));
    b.innerHTML='<span>'+(i+1)+'</span>';
    b.addEventListener('click',function(e){e.stopPropagation();showPoint(p.lat,p.lng,p.n||('หมุด · Pin '+(i+1)),i);});
    S.marks.push(new maplibregl.Marker({element:b,anchor:'bottom'}).setLngLat([p.lng,p.lat]).addTo(MDX.map));
  });
  var sh=$('mfshare');if(sh)sh.hidden=!S.pins.length;
}
function addPin(lat,lng,name,openIt,k){
  if(S.pins.length>=40){say('หมุดได้ ๔๐ อัน · up to 40 pins');return;}
  S.pins.push({lat:lat,lng:lng,n:(name||'').slice(0,60)});drawPins();save();
  if(window.MDSENSE)MDSENSE.tell('pin',{k:k,lat:lat,lng:lng});
  /* saved for every map after this one too (mine_layer.py) */
  if(window.MDSAVED)MDSAVED.add(k?{k:k,lat:lat,lng:lng,n:(name||'').slice(0,60)}:{lat:lat,lng:lng,n:(name||'').slice(0,60)});
  if(openIt)showPoint(lat,lng,name||('หมุด · Pin '+S.pins.length),S.pins.length-1);
  say('ปักแล้ว '+S.pins.length+' หมุด · '+S.pins.length+' pinned');
}
function share(){
  if(window.MDSENSE)MDSENSE.tell('share',{d:'pins'+S.pins.length});
  save();var url=location.href,t='หมุดของฉันบนมดแดง · My pins on Mot Dang';
  if(navigator.share&&!LD){navigator.share({title:t,url:url}).catch(function(){});return;}
  if(!sheet)mk();
  open('<h2>ส่งหมุด · Send pins</h2><p>'+S.pins.length+' หมุด · pins, ในลิงก์เดียว · in one link</p>'+
    '<div class="mfbtns">'+lineKeep(url)+'<a class="go" href="https://line.me/R/share?text='+encodeURIComponent(t+' '+url)+'" rel="noopener">ส่งให้เพื่อน · Send in LINE</a>'+
    (navigator.share?'<button type="button" id="mfnative">'+ic('i-share',18)+'แชร์ · Share</button>':'')+
    '<button type="button" class="mfcopy" data-c="'+E(url)+'">คัดลอกลิงก์ · Copy link</button></div>');
  var nb=$('mfnative');if(nb)nb.addEventListener('click',function(){navigator.share({title:t,url:url}).catch(function(){});});
}

/* ---- the box: a place ID, a point in any system, or words --------------- */
function openPath(path,miss){
  var pr=path.split('/')[0],slug=path.split('/')[1];
  var it={name:'',sub:(pr==='cr'?'เชียงราย · Chiang Rai':'เชียงใหม่ · Chiang Mai'),
    href:R()+pr+'/p/'+slug+'.html',json:R()+pr+'/p/'+slug+'.json',plan:pr+':'+slug};
  fetch(it.json).then(function(r){if(!r.ok)throw 0;return r.json();}).then(function(d){
    it.name=[d.nameTh,d.nameEn].filter(Boolean).join(' · ')||d.name||'';it.lat=d.lat;it.lng=d.lng;
    if(d.lat!=null){gotoPlaceMark(d.lat,d.lng);}
    show(it,{fly:d.lat!=null});say('');
  }).catch(function(){if(miss)miss();else say('ไม่พบที่นี้ · no such place');});
}
function gotoPlaceMark(lat,lng){if(ptMark)ptMark.remove();
  var el=document.createElement('div');el.className='xpin';
  ptMark=new maplibregl.Marker({element:el}).setLngLat([lng,lat]).addTo(MDX.map);}
function lookupCode(code){
  code=code.toUpperCase().replace(/^MD-?/,'').replace(/O/g,'0').replace(/[IL]/g,'1').replace(/[^0-9A-Z]/g,'');
  say('กำลังหา MD-'+code+' · looking up');
  fetch(R()+'data/codes/'+code[0]+'.json').then(function(r){if(!r.ok)throw 0;return r.json();}).then(function(m){
    if(!m[code])throw 0;if(window.MDSENSE)MDSENSE.tell('code',{d:'hit'});openPath(m[code]);}).catch(function(){
    if(window.MDSENSE)MDSENSE.tell('code',{d:'miss'});say('ไม่พบรหัส MD-'+code+' · no place has that ID');});
}
/* A Google link with no coordinates in it — what a phone's Share button sends: a name, an address and Google's
   own ID (Nan, 2026-10-03). Mot Dang's own search looks up the name; OpenStreetMap's address search (Nominatim)
   places the address; the name match nearest that point opens, else the point opens with the places around it. */
function linkText(u){
  var x;try{x=new URL(u);}catch(e){return '';}
  var m=x.pathname.match(/\/maps\/(?:place|search)\/([^\/]+)/),t=m?m[1]:(x.searchParams.get('q')||x.searchParams.get('query')||'');
  try{t=decodeURIComponent(t.replace(/\+/g,' '));}catch(e){t=t.replace(/\+/g,' ');}
  return t.trim();
}
var ADDR=/\b(road|rd\.?|soi|street|st\.?|lane|district|sub-?district|tambon|amphoe|mueang|moo|chiang mai|chiang rai|thailand|\d{5})\b|ถนน|ซอย|ตำบล|อำเภอ|จังหวัด|หมู่/i;
function wordsOf(s){return String(s||'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim().split(' ').filter(Boolean);}
function overlap(a,b){var A=wordsOf(a),B=wordsOf(b);if(!A.length)return 0;return A.filter(function(w){return B.indexOf(w)>=0;}).length/A.length;}
function far(a,g){return Math.hypot(a.lat-g.lat,(a.lng-g.lng)*Math.cos(g.lat*Math.PI/180));}
function fromLinkText(u){
  var t=linkText(u);if(!t){say('ลิงก์นี้ไม่มีตำแหน่ง · this link carries no place');return;}
  var parts=t.split(/\s*,\s*/).filter(function(p){return p&&!/^\d+[\/\d-]*$/.test(p);});
  var name=parts.filter(function(p){return !ADDR.test(p);})[0]||'';
  say('… '+t.slice(0,90));
  function geocode(ps){if(!ps.length)return Promise.resolve(null);
    return fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=th&accept-language=en&q='+encodeURIComponent(ps.join(', ')))
      .then(function(r){return r.json();}).then(function(a){return a&&a[0]?{lat:+a[0].lat,lng:+a[0].lon,used:ps.join(', ')}:geocode(ps.slice(1));},function(){return null;});}
  var hits=name?places(name,'n=20').then(function(d){
      return (d.results||[]).filter(function(x){return x.lat!=null&&Math.max(overlap(name,x.name),overlap(name,x.nameEn))>=0.6;});},function(){return [];}):Promise.resolve([]);
  Promise.all([geocode(parts),hits]).then(function(v){
    var g=v[0],h=v[1];
    if(h.length){
      if(g)h.sort(function(a,b){return far(a,g)-far(b,g);});
      var best=h[0],pm=best.url.match(/\/(cm|cr)\/p\/([^\/?#]+?)\.html/);
      if(pm){openPath(pm[1]+'/'+decodeURIComponent(pm[2]));
        if(h.length>1)setTimeout(function(){say('ชื่อนี้มี '+h.length+' ที่ เลือกที่ใกล้ที่อยู่ในลิงก์ที่สุด · '+h.length+' places share this name; this is the one nearest the link\'s address');},2800);
        return;}
    }
    if(g){var whole=g.used===parts.join(', ');
      say(whole?'จากที่อยู่ในลิงก์ · from the address in the link: '+t.slice(0,80)
        :'ราว ๆ ตรงนี้ หาได้แค่ '+g.used+' · roughly here: only "'+g.used+'" was found');
      gotoPoint(g.lat,g.lng,whole?17:14,t.slice(0,60));return;}
    S.q=(name||t).slice(0,80);runSearch(true);save();
  });
}
/* A Google place link carries its name and its point (/maps/place/<name>/@lat,lng): the Mot Dang place
   of that name within ~300 m opens with everything known about it, not a bare point (Nan, 2026-10-20,
   TULOU Restaurant: the point opened 6 m from its own record). */
function placeAt(name,c,miss){
  places(name,'n=20').then(function(d){
    var h=(d.results||[]).filter(function(x){return x.lat!=null&&far({lat:x.lat,lng:x.lng},c)<0.003&&
      Math.max(overlap(name,x.name),overlap(name,x.nameEn))>=0.6;});
    h.sort(function(a,b){return far({lat:a.lat,lng:a.lng},c)-far({lat:b.lat,lng:b.lng},c);});
    var pm=h[0]&&h[0].url.match(/\/(cm|cr)\/p\/([^\/?#]+?)\.html/);
    if(pm){openPath(pm[1]+'/'+decodeURIComponent(pm[2]),miss);return;}
    miss();
  },miss);
}
function submit(t,label){
  t=(t||'').trim();label=(label||'').slice(0,60);
  if(!t){clearQ();return;}
  /* a Google short link (maps.app.goo.gl, often pasted inside LINE's share text) is opened out by /api/resolve
     first; the long address it leads to carries the point (Nan, 2026-10-03) */
  var sl=t.match(/https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs)\/[^\s]+/);
  if(sl){say('…');fetch('/api/resolve?u='+encodeURIComponent(sl[0])).then(function(r){return r.json();})
    .then(function(d){var u=d&&d.url;if(u&&u!==sl[0])submit(u);else say('เปิดลิงก์นี้ไม่ได้ · this link did not open');},
    function(){say('เปิดลิงก์นี้ไม่ได้ · this link did not open');});return;}
  var lu=t.match(/https?:\/\/[^\s]+/);if(lu&&lu[0]!==t)t=lu[0];
  /* place IDs and Mot Dang links answer even without coords.js */
  var mdc=t.match(/^(?:MD-?)([0-9A-Za-z]{4,8})$/i),mdp=t.match(/\/(cm|cr)\/p\/([^\/?#]+?)(?:\.html|\.json)?(?:[?#].*)?$/);
  if(mdc){lookupCode(mdc[1]);return;}
  if(mdp){openPath(mdp[1]+'/'+decodeURIComponent(mdp[2]));return;}
  var c=window.MDCOORDS?MDCOORDS.parse(t,{ref:MDX.map.getCenter()}):null;
  if(c&&window.MDSENSE)MDSENSE.tell('coord',{d:c.kind});
  if(c){
    if(c.kind==='w3w'){say('what3words (///'+c.words+') แปลงไม่ได้ ต้องมีบัญชีกับบริษัท what3words · what3words needs an account with their company; paste the same spot as a Plus Code, coordinates or a map link');return;}
    if(c.kind==='mdcode'){lookupCode(c.code);return;}
    if(c.kind==='mdplace'){openPath(c.prov+'/'+c.slug);return;}
    if(c.lat!=null){clearQ(true);say((label||c.label||c.kind)+' → '+c.lat.toFixed(5)+', '+c.lng.toFixed(5));
      var gn=/google\.|maps\.app/i.test(t)?linkText(t):'';
      if(gn&&!/^-?\d/.test(gn)){placeAt(gn,c,function(){gotoPoint(c.lat,c.lng,c.zoom,label||c.label||gn);});return;}
      gotoPoint(c.lat,c.lng,c.zoom,label||c.label||null);return;}
  }
  if(/^https?:\/\/(?:[a-z]+\.)?google\.[a-z.]+\/maps|^https?:\/\/maps\.google\./i.test(t)){fromLinkText(t);return;}
  S.q=t.slice(0,80);runSearch(true);save();
}

/* ---- search moves the map ---------------------------------------------- */
var seq=0,tmo=null;
function qItem(r){return {name:[r.name,r.nameEn&&r.nameEn!==r.name?r.nameEn:''].filter(Boolean).join(' · '),
  sub:(r.province==='cr'?'เชียงราย · Chiang Rai':'เชียงใหม่ · Chiang Mai'),href:r.url,
  json:r.url.replace(/\.html$/,'.json'),plan:r.province+':'+(r.url.split('/p/')[1]||'').replace(/\.html$/,''),
  lat:r.lat,lng:r.lng};}
function paintQ(rs){
  var m=MDX.map,gj={type:'FeatureCollection',features:rs.filter(function(r){return r.lat!=null;}).map(function(r,i){
    return {type:'Feature',geometry:{type:'Point',coordinates:[r.lng,r.lat]},properties:{i:i}};})};
  QR=rs;
  if(m.getSource('mf-q'))m.getSource('mf-q').setData(gj);
  else{m.addSource('mf-q',{type:'geojson',data:gj});
    m.addLayer({id:'mf-q-dot',type:'circle',source:'mf-q',paint:{
      'circle-radius':['interpolate',['linear'],['zoom'],10,4,14,6.5,17,9],
      'circle-color':'#0a66c2','circle-stroke-color':'#fff','circle-stroke-width':2}});
    m.on('click','mf-q-dot',function(e){var f=e.features&&e.features[0];if(!f)return;
      var r=QR[f.properties.i];if(r)setTimeout(function(){show(qItem(r));},0);});
    m.on('mouseenter','mf-q-dot',function(){m.getCanvas().style.cursor='pointer';});
    m.on('mouseleave','mf-q-dot',function(){m.getCanvas().style.cursor='';});}
}
var QR=[];
/* The map asks /find: the site's own search index and ranking (gemba 2, 2026-10-20: the places API took
   5–17 s a query and ranked a place's own name lower). Each place row comes back in the shape the map uses. */
function places(q,extra){
  return fetch(R()+'find?q='+encodeURIComponent(q)+'&fmt=json&kind=place&'+extra).then(function(r){return r.json();}).then(function(d){
    var rs=(d.results||[]).filter(function(r){return /^https:\/\/motdang\.net\/(cm|cr)\/p\//.test(r.url||'');}).map(function(r){
      var t=String(r.title||'').replace(/\s+—\s+.*$/,'').replace(/\s*·\s*มดแดง.*$/,''),p=t.split(' · ');
      return {name:p[0]||t,nameEn:p[1]||'',url:r.url,lat:r.lat,lng:r.lon,province:r.url.indexOf('/cr/')>0?'cr':'cm'};});
    return {results:rs,total:d.total||rs.length};});
}
function runSearch(first){
  var m=MDX.map,b=m.getBounds(),my=++seq,namedOpen=false;
  /* the words are one place's whole name: open it, in view or not (Nan, 2026-10-20: "tulou" drew 339 dots).
     Judged on the whole match list, so a second place of that name anywhere leaves both on the map. */
  if(first)places(S.q,'n=50').then(function(w){
    if(my!==seq)return;var hit=named(S.q,(w.results||[]).filter(function(r){return r.lat!=null;}));
    if(hit){namedOpen=true;show(qItem(hit),{fly:true});}},function(){});
  var bb=[b.getWest(),b.getSouth(),b.getEast(),b.getNorth()].map(function(x){return x.toFixed(5);}).join(',');
  say('กำลังค้น · searching…');
  places(S.q,'n=200&bbox='+bb).then(function(d){
    if(my!==seq)return;
    var rs=d.results||[];
    if(!rs.length&&first){
      return places(S.q,'n=50').then(function(w){
        if(my!==seq)return;var all=(w.results||[]).filter(function(r){return r.lat!=null;});
        if(!all.length){paintQ([]);say('ไม่พบ "'+S.q+'" · nothing found');return;}
        var lo=[Math.min.apply(null,all.map(function(r){return r.lng;})),Math.min.apply(null,all.map(function(r){return r.lat;}))],
            hi=[Math.max.apply(null,all.map(function(r){return r.lng;})),Math.max.apply(null,all.map(function(r){return r.lat;}))];
        paintQ(all);m.fitBounds([lo,hi],{padding:40,maxZoom:16});
        say(all.length+(w.total>all.length?' จาก '+w.total:'')+' ที่ · places for "'+S.q+'"');});
    }
    paintQ(rs);
    var tot=Math.max(d.total||0,rs.length);
    say(tot+' ที่ในจอนี้ · '+tot+' in view for "'+S.q+'"'+(tot>rs.length?' — '+rs.length+' ขึ้นแผนที่ · '+rs.length+' drawn, zoom in for the rest':''));
    if(first&&rs.length===1&&!namedOpen&&!named(S.q,rs))show(qItem(rs[0]));
  }).catch(function(){say('ค้นไม่ได้ตอนนี้ · search is not answering');});
}
/* The one place whose name is the words, give or take a word like restaurant or ร้าน; none when two share it. */
var KIND=/^(restaurant|cafe|café|coffee|shop|store|bar|hotel|hostel|resort|spa|clinic|ร้าน|ร้านอาหาร|คาเฟ่|โรงแรม)$/;
function bare(n){return wordsOf(n).filter(function(w){return !KIND.test(w);}).join(' ');}
function named(q,rs){
  var fq=bare(q);if(!fq)return null;
  var h=rs.filter(function(r){return [r.name,r.nameEn].some(function(n){return n&&bare(n)===fq;});});
  var u={};h.forEach(function(r){u[r.url]=1;});
  return Object.keys(u).length===1?h[0]:null;
}
function clearQ(keepSay){S.q='';seq++;if(window.MDX&&MDX.map.getSource('mf-q'))paintQ([]);if(!keepSay)say('');save();}

/* ---- wiring ------------------------------------------------------------- */
function boot(){
  if(!window.MDX||boot.done)return;boot.done=true;
  var m=MDX.map,f=$('mfq'),inp=$('mfin');
  if(f)f.addEventListener('submit',function(e){e.preventDefault();if(inp)inp.blur();submit(inp.value);});
  if(inp)inp.addEventListener('search',function(){if(!inp.value)clearQ();});
  m.on('moveend',function(){if(!S.q)return;clearTimeout(tmo);tmo=setTimeout(function(){runSearch(false);},450);});
  var db=$('mfdrop');
  if(db)db.addEventListener('click',function(){S.drop=!S.drop;db.setAttribute('aria-pressed',S.drop?'true':'false');
    MDX.el.classList.toggle('mapdrop',S.drop);say(S.drop?'แตะแผนที่ตรงที่จะปักหมุด · tap the map where the pin goes':'');});
  m.on('click',function(e){if(!S.drop)return;S.drop=false;if(db)db.setAttribute('aria-pressed','false');
    MDX.el.classList.remove('mapdrop');var ll=e.lngLat;setTimeout(function(){addPin(ll.lat,ll.lng,'',true);},0);});
  /* press and hold drops a pin too — one finger, held still */
  var ht=null;
  m.on('touchstart',function(e){clearTimeout(ht);if(e.points&&e.points.length!==1)return;var ll=e.lngLat;
    ht=setTimeout(function(){ht=null;addPin(ll.lat,ll.lng,'',true);},650);});
  ['touchend','touchmove','touchcancel','dragstart','zoomstart'].forEach(function(ev){m.on(ev,function(){clearTimeout(ht);});});
  m.on('contextmenu',function(e){addPin(e.lngLat.lat,e.lngLat.lng,'',true);});
  var sh=$('mfshare');if(sh)sh.addEventListener('click',share);
  var me=$('mfme');
  if(me)me.addEventListener('click',function(){
    if(!window.MDLOC){say('ตำแหน่งใช้ไม่ได้ในเบราว์เซอร์นี้ · location is not available here');return;}
    me.setAttribute('aria-busy','true');
    MDLOC.ask(function(pt){me.removeAttribute('aria-busy');gotoPoint(pt.lat,pt.lng,17,'ตำแหน่งของฉัน · My location');},
      function(){me.removeAttribute('aria-busy');say('ยังไม่ได้บอกตำแหน่ง · no position given');});
  });
  var x=readExtra();
  if(x.pins){x.pins.split(';').slice(0,40).forEach(function(s){var p=s.split(',');var la=parseFloat(p[0]),ln=parseFloat(p[1]);
    if(isFinite(la)&&isFinite(ln))S.pins.push({lat:la,lng:ln,n:(p.slice(2).join(' ')||'').slice(0,60)});});drawPins();
    if(window.MDSAVED)MDSAVED.add(S.pins.map(function(q){return {lat:q.lat,lng:q.lng,n:q.n};}));}
  if(x.q){S.q=x.q.slice(0,80);if(inp)inp.value=S.q;runSearch(false);}
  /* a place ID or point handed in by link: map.html?go=MD-XXXXX */
  var sp=new URLSearchParams(location.search),go=sp.get('go');if(go)submit(go,sp.get('n')||'');
}
if(window.MDX)boot();else document.addEventListener('mdx-ready',boot);
})();
"""


def emit(docs):
    import linedoor
    (docs / "mapfirst.js").write_text(JS.replace("%LINEDOOR%", linedoor.js_const()))
    with open(docs / "explore.css", "a") as f:
        f.write(CSS)
