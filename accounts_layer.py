"""accounts_layer.py — saved things follow a reader who signs in with LINE.

Nan, 2026-10-20: "yes you should be able to remember and save things. There
should be good saving functions. Might require a login." · C230 (c): sign in
with LINE. The server half is publish/accounts.js.

MD_JS rides at the end of md.js and locshare.js. It keeps a time for each
change to the settings below (md-sync-t), and when the reader is signed in it
pulls their copy from /api/me/saved, merges it with this browser's and pushes
the result back — at page load, and a few seconds after any change.

  · saved places (md-saved): the union of both, less any removed later on
    either side (md-saved-gone keeps a removal for 120 days);
  · every other kept setting: the side that changed it last.

A box with id="md-acct" (my.html) shows "Sign in with LINE" and what it gives,
or who is signed in, the week on LINE with its Gold month, river and dust at
home, reminders, the reader's data and a way out (publish/me.js answers it).
The top bar carries the reader's LINE picture, or a way in; the Send sheet
carries "To my LINE", and on an event "Remind me on LINE". Until LINE is switched on (/api/me says line: false) the box
stays empty and the page makes no further calls.
"""

KEYS = ["md-plan", "md-bm", "md-pins", "md-widgets", "md-mods", "md-notes", "md-city",
        "md-origin", "md-planmode", "md-plan-kinds", "md-lang", "md-read"]

MD_JS = r"""/* accounts_layer.py — saved things follow a reader signed in with LINE (Nan 2026-10-20, C230). */
(function(){
if(window.MDACCT)return;
var KEYS=%KEYS%,TK='md-sync-t',GONE_MS=120*864e5;
var LS=null;try{LS=window.localStorage;}catch(e){}
var SET=Storage.prototype.setItem,DEL=Storage.prototype.removeItem;
function get(k){try{return LS.getItem(k);}catch(e){return null;}}
function put(k,v){try{v==null?DEL.call(LS,k):SET.call(LS,k,v);}catch(e){}}
function J(k,d){try{var v=JSON.parse(get(k));return v==null?d:v;}catch(e){return d;}}
function stamps(){return J(TK,{});}
function idOf(o){return o&&o.k?'k:'+o.k:(o&&isFinite(o.lat)&&isFinite(o.lng)?'p:'+(+o.lat).toFixed(5)+','+(+o.lng).toFixed(5):'');}

/* this browser's state */
function local(){var s=stamps(),keys={};
  KEYS.forEach(function(k){var v=get(k);if(v!=null||s[k])keys[k]={v:v,t:s[k]||0};});
  return {keys:keys,saved:J('md-saved',[]),gone:J('md-saved-gone',[])};}

/* two states → one: settings by the later change, places by union less removals */
function merge(a,b){a=a||{};b=b||{};var out={keys:{},saved:[],gone:[]},now=Date.now();
  var ka=a.keys||{},kb=b.keys||{};
  Object.keys(ka).concat(Object.keys(kb)).forEach(function(k){
    if(out.keys[k]||KEYS.indexOf(k)<0)return;var x=ka[k],y=kb[k];
    out.keys[k]=!y||(x&&(x.t||0)>=(y.t||0))?x:y;});
  var gone={};(a.gone||[]).concat(b.gone||[]).forEach(function(g){var i=idOf(g);
    if(i&&(!gone[i]||gone[i].t<g.t)&&now-(g.t||0)<GONE_MS)gone[i]=g;});
  var sv={};(a.saved||[]).concat(b.saved||[]).forEach(function(o){var i=idOf(o);if(!i)return;
    if(!sv[i]){sv[i]=JSON.parse(JSON.stringify(o));return;}
    var p=sv[i];for(var f in o)if(o[f]!=null&&o[f]!==''&&(p[f]==null||p[f]===''||(o.t||0)>(p.t||0)))p[f]=o[f];
    p.t=Math.max(p.t||0,o.t||0);});
  Object.keys(sv).forEach(function(i){if(!gone[i]||(sv[i].t||0)>gone[i].t)out.saved.push(sv[i]);});
  out.saved.sort(function(x,y){return (x.t||0)-(y.t||0);});
  Object.keys(gone).forEach(function(i){out.gone.push(gone[i]);});
  return out;}

/* write a merged state into this browser without stamping it again */
function apply(m){var s=stamps(),changed=false;
  Object.keys(m.keys).forEach(function(k){var e=m.keys[k];if(get(k)!==e.v){put(k,e.v);changed=true;}s[k]=e.t;});
  put(TK,JSON.stringify(s));
  var sv=JSON.stringify(m.saved);if(get('md-saved')!==sv){put('md-saved',sv);changed=true;
    try{document.dispatchEvent(new CustomEvent('md-saved'));}catch(e){}}
  put('md-saved-gone',JSON.stringify(m.gone));return changed;}

/* a change to a kept setting is stamped, and the copy is sent a few seconds later */
if(LS){
  Storage.prototype.setItem=function(k,v){SET.call(this,k,v);if(this===LS)touched(k);};
  Storage.prototype.removeItem=function(k){DEL.call(this,k);if(this===LS)touched(k);};
}
function touched(k){
  if(KEYS.indexOf(k)>=0){var s=stamps();s[k]=Date.now();put(TK,JSON.stringify(s));}
  else if(k!=='md-saved'&&k!=='md-saved-gone')return;
  soon();}
var T=null;function soon(){if(!ME||!ME.signedIn)return;clearTimeout(T);T=setTimeout(sync,4000);}

var ME=null,BUSY=false;
function me(){
  try{var c=JSON.parse(sessionStorage.getItem('md-me'));if(c&&Date.now()-c.at<3e5)return Promise.resolve(c.me);}catch(e){}
  return fetch('/api/me',{credentials:'same-origin'}).then(function(r){return r.json();}).then(function(m){
    try{sessionStorage.setItem('md-me',JSON.stringify({at:Date.now(),me:m}));}catch(e){}return m;});}
/* This browser's synced things, cleared: after a confirmed last send on sign-out (they stay in the
   account), and before a different account's copy comes in, so one person's saves never join another's
   account on a shared browser. What the earlier account had not sent yet is set aside under its mark
   (md-acct-stash:<mark>) and joins that account when it signs in here again. */
function wipe(){KEYS.concat(['md-saved','md-saved-gone',TK]).forEach(function(k){put(k,null);});
  try{document.dispatchEvent(new CustomEvent('md-saved'));}catch(e){}}
function stash(owner){try{SET.call(LS,'md-acct-stash:'+owner,JSON.stringify(local()));}catch(e){}}
/* read, merge, send; a send refused as stale (another device wrote first) reads and merges again.
   Things saved before anyone signed in on this browser join the first account that does.
   Resolves true once the account holds this browser's state. */
function sync(){
  if(BUSY||!ME||!ME.signedIn)return Promise.resolve(false);BUSY=true;
  var owner=get('md-acct');
  if(owner&&owner!==ME.u){stash(owner);wipe();}
  var kept=J('md-acct-stash:'+ME.u,null);
  function round(n){
    return fetch('/api/me/saved',{credentials:'same-origin'}).then(function(r){return r.ok?r.json():null;}).then(function(srv){
      if(!srv)return false;
      /* the copy read is someone else's: another tab signed a different account in — stop, and ask again next load */
      if(srv.u&&srv.u!==ME.u){try{sessionStorage.removeItem('md-me');}catch(e){}ME={signedIn:false,line:true};return false;}
      var m=merge(merge(local(),kept||{}),srv.data||{});apply(m);put('md-acct',ME.u||'');
      if(JSON.stringify(m)===JSON.stringify(srv.data||{}))return true;
      return fetch('/api/me/saved',{method:'PUT',credentials:'same-origin',headers:{'content-type':'application/json'},
        body:JSON.stringify({data:m,ver:srv.ver||0,acct:ME.u})}).then(function(r){
          if(r.status===409&&n<3)return r.json().then(function(e){return e&&e.error==='account'?false:round(n+1);});
          return r.ok;});});}
  return round(0).catch(function(){return false;}).then(function(ok){
    if(ok&&kept)put('md-acct-stash:'+ME.u,null);BUSY=false;return ok;});}

/* ---- the account on every page, and the panel on my.html (Nan 2026-10-20: "many more
   personalization and convenience features … with a LINE signin", and the week on LINE
   with a Gold month for people who opt in). The server half is publish/me.js. */
function bi(th,en){return th+' · '+en;}
function el(tag,css,text){var e=document.createElement(tag);if(css)e.className=css;if(text!=null)e.textContent=text;return e;}
function btn(css,text,fn){var b=el('button',css,text);b.type='button';if(fn)b.addEventListener('click',fn);return b;}
function lnk(css,text,href,blank){var a=el('a',css,text);a.href=href;if(blank){a.target='_blank';a.rel='noopener';}return a;}
function signIn(){return '/auth/line?back='+encodeURIComponent(location.pathname+location.search);}
function forget(){try{sessionStorage.removeItem('md-me');}catch(e){}}
function api(path,body){return fetch('/api/me/'+path,body===undefined?{credentials:'same-origin'}:
  {method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify(body)})
  .then(function(r){return r.json().catch(function(){return {};}).then(function(j){j._s=r.status;return j;});});}
var CSS='.ma-card{border:2px solid #2a1e16;border-radius:14px;padding:12px 14px;margin:.6em 0;background:#fffdf8;color:#2a1e16}'+
  '.ma-card h4{margin:0 0 .35em;font-size:1.08em}.ma-card p{margin:.3em 0}.ma-row{display:flex;flex-wrap:wrap;gap:.5em;align-items:center;margin:.5em 0 0}'+
  '.ma-b{display:inline-flex;align-items:center;min-height:44px;padding:.35em 1em;border-radius:99px;border:2px solid #2a1e16;background:#fff;color:#2a1e16;font:inherit;font-weight:700;cursor:pointer;text-decoration:none}'+
  '.ma-gold{background:#f5c518;color:#000}.ma-line{background:#06c755;border-color:#06c755;color:#fff}.ma-red{color:#9a2a10;border-color:#9a2a10}'+
  '.ma-who{display:flex;align-items:center;gap:.6em;flex-wrap:wrap}.ma-who img{width:44px;height:44px;border-radius:50%}'+
  '.ma-code{font:700 1.4em ui-monospace,monospace;letter-spacing:.12em}.ma-ok{color:#0a7a32;font-weight:700}.ma-hint{font-size:.92em;color:#5c4d38}'+
  '.ma-list{list-style:none;padding:0;margin:.3em 0}.ma-list li{display:flex;gap:.5em;align-items:center;justify-content:space-between;padding:.35em 0;border-bottom:1px solid #eadfcb}'+
  '.ma-chip{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;margin-left:.4em;border-radius:50%;overflow:hidden;flex:none;background:#06c755;color:#fff;text-decoration:none;vertical-align:middle}'+
  '.ma-chip img{width:100%;height:100%;object-fit:cover}.ma-chip svg{width:20px;height:20px}'+
  '.ma-sheet{margin:.4em 0 .6em;padding:.6em 0 0;border-top:1px solid #eadfcb}.ma-sheet .ma-b{margin:0 .4em .4em 0}';
function css(){if(document.getElementById('ma-css'))return;var s=el('style');s.id='ma-css';s.textContent=CSS;document.head.appendChild(s);}

/* the top bar: the reader's LINE picture, or a way in */
function chip(){var m=document.querySelector('header .mast');if(!m||!ME||!ME.line)return;css();
  var old=m.querySelector('.ma-chip');if(old)old.remove();
  var a=el('a','ma-chip');
  if(ME.signedIn){a.href='/my.html#md-acct';a.setAttribute('aria-label',bi('บัญชีของฉัน','My account')+': '+(ME.name||'LINE'));
    if(ME.picture){var i=el('img');i.alt='';i.src=ME.picture;i.referrerPolicy='no-referrer';a.appendChild(i);}
    else a.textContent=(ME.name||'?').slice(0,1);}
  else{a.href=signIn();a.setAttribute('aria-label',bi('เข้าสู่ระบบด้วย LINE','Sign in with LINE'));a.addEventListener('click',forget);
    a.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4" fill="currentColor"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" fill="currentColor"/></svg>';}
  a.title=a.getAttribute('aria-label');m.appendChild(a);}

/* "add Mot Dang as a LINE friend first", with a way back */
function needFriend(host,oa,again){host.textContent='';
  host.appendChild(el('p',null,bi('เพิ่ม มดแดง Mot Dang เป็นเพื่อนใน LINE ก่อน','Add มดแดง Mot Dang as a LINE friend first')));
  var r=el('div','ma-row');r.append(lnk('ma-b ma-line',bi('เพิ่มเพื่อน','Add friend'),oa,true),btn('ma-b',bi('เพิ่มแล้ว ลองอีกครั้ง','Added — try again'),again));host.appendChild(r);}

function box(){var b=document.getElementById('md-acct');chip();if(!b||!ME||!ME.line)return;css();
  b.textContent='';
  if(!ME.signedIn){var c=el('div','ma-card');
    c.appendChild(el('h4',null,bi('เข้าสู่ระบบด้วย LINE','Sign in with LINE')));
    var ul=el('ul');[['ที่บันทึกไว้ แผน บุ๊กมาร์ก และการตั้งค่า ตามไปทุกเครื่องที่คุณเข้าสู่ระบบ','your saved places, plan, bookmarks and settings on every device you sign in on'],
      ['สัปดาห์นี้ในมดแดง ทาง LINE ทุกวันจันทร์ พร้อมทอง 1 เดือนฟรีสำหรับหน้าของคุณ','the week on Mot Dang on LINE each Monday, and a free Gold month for your own page'],
      ['ส่งหน้า ที่ หรือแผน เข้า LINE ของคุณเอง','send a page, a place or a plan to your own LINE'],
      ['ข้อความเข้า LINE ก่อนงานเริ่ม','event reminders on LINE before they start'],
      ['แจ้งทาง LINE เมื่อน้ำหรือฝุ่นถึงบ้าน','river and dust at your home, on LINE']].forEach(function(x){ul.appendChild(el('li',null,bi(x[0],x[1])));});
    c.appendChild(ul);var a=lnk('ma-b ma-line',bi('เข้าสู่ระบบด้วย LINE','Sign in with LINE'),signIn());a.addEventListener('click',forget);
    var r=el('div','ma-row');r.appendChild(a);c.appendChild(r);b.appendChild(c);return;}
  /* who */
  var who=el('div','ma-card ma-who');
  if(ME.picture){var im=el('img');im.alt='';im.src=ME.picture;im.referrerPolicy='no-referrer';who.appendChild(im);}
  var nm=el('b',null,(ME.name||'LINE'));who.appendChild(nm);
  var o=btn('ma-b',bi('ออกจากระบบ','Sign out'));who.appendChild(o);
  var q=new URLSearchParams(location.search),back=q.get('back');
  if(back&&/^\/(?!\/)/.test(back))who.appendChild(lnk('ma-b',bi('← กลับไปหน้าเดิม','← back where you were'),back));
  b.appendChild(who);
  /* sign-out only after the account holds the latest; otherwise stay signed in and say so */
  o.addEventListener('click',function(){clearTimeout(T);o.disabled=true;sync().then(function(ok){
    if(!ok){o.disabled=false;nm.textContent=bi('บันทึกล่าสุดยังส่งไม่ได้ ยังไม่ได้ออกจากระบบ','your latest changes did not reach the account; still signed in');return;}
    return fetch('/auth/logout',{method:'POST',credentials:'same-origin'}).then(function(r){if(!r.ok)throw 0;
      forget();wipe();put('md-acct',null);ME={signedIn:false,line:true};box();});
  }).catch(function(){o.disabled=false;});});
  var more=el('div');more.appendChild(el('p','ma-hint','…'));b.appendChild(more);
  api('more').then(function(m){if(m._s!==200){more.textContent='';return;}panel(more,m,q.get('welcome')==='1');});}

function panel(host,m,welcome){host.textContent='';
  /* the week on LINE, and the Gold month */
  var w=el('div','ma-card');host.appendChild(w);
  function week(){w.textContent='';
    w.appendChild(el('h4',null,(welcome&&!m.weekly?bi('ยินดีต้อนรับ','Welcome')+' — ':'')+bi('สัปดาห์นี้ในมดแดง ทาง LINE','The week on Mot Dang, on LINE')));
    if(!m.weekly){
      w.appendChild(el('p',null,bi('ทุกวันจันทร์: งานในเมืองเจ็ดวันข้างหน้า','Mondays: the next seven days of events in town')));
      w.appendChild(el('p',null,bi('ตอบรับแล้ว รับทอง '+m.goldMonths+' เดือนฟรีสำหรับหน้าของคุณบน sites.motdang.net','Say yes and get a free Gold month for your own page on sites.motdang.net')));
      var r=el('div','ma-row'),y=btn('ma-b ma-gold',bi('รับทุกวันจันทร์','Yes, every Monday'),function(){y.disabled=true;
        api('weekly',{on:true}).then(function(j){y.disabled=false;
          if(j.needFriend){needFriend(r,j.oa||m.oa,function(){y.click();});return;}
          if(j.ok){m.weekly=true;m.gold=j.gold;week();}});});
      r.appendChild(y);w.appendChild(r);return;}
    var on=el('div','ma-row');on.append(el('span','ma-ok','✓ '+bi('รับทุกวันจันทร์','Coming every Monday')),
      btn('ma-b',bi('หยุด','Stop'),function(){api('weekly',{on:false}).then(function(j){if(j.ok){m.weekly=false;week();}});}));
    w.appendChild(on);
    var g=m.gold;if(!g||!g.code)return;
    var gc=el('div','ma-card');gc.appendChild(el('h4',null,bi('ทอง '+m.goldMonths+' เดือนของคุณ','Your Gold month')));
    if(g.used){gc.appendChild(el('p','ma-ok','✓ '+bi('ใช้แล้วกับ','used on')+' sites.motdang.net/'+(g.page||'')));}
    else{gc.appendChild(el('p','ma-code',g.code));
      var gr=el('div','ma-row');gr.append(lnk('ma-b ma-gold',bi('ใช้กับหน้าของฉัน','Use on my page'),'https://sites.motdang.net/g/'+g.code),
        lnk('ma-b',bi('ยังไม่มีหน้า? สร้างหน้า','No page yet? Make one'),'https://sites.motdang.net/make'));gc.appendChild(gr);}
    w.appendChild(gc);}
  week();

  /* river and dust at home */
  var h=el('div','ma-card');host.appendChild(h);
  function home(){h.textContent='';
    h.appendChild(el('h4',null,bi('น้ำและฝุ่นที่บ้าน ทาง LINE','River and dust at home, on LINE')));
    h.appendChild(el('p','ma-hint',bi('ข้อความเมื่อสถานีวัดน้ำในรัศมี 15 กม. ถึงระดับของสถานีเอง หรือ PM2.5 เกิน 75','a message when a river gauge within 15 km reaches its own alert level, or PM2.5 passes 75 µg/m³')));
    var r=el('div','ma-row');h.appendChild(r);
    if(m.home){r.append(el('span',null,bi('บ้าน','Home')+': '+m.home.lat+', '+m.home.lng),
      lnk('ma-b',bi('แผนที่','Map'),'/map.html#16/'+m.home.lat+'/'+m.home.lng),
      btn('ma-b ma-red',bi('ล้าง','Clear'),function(){api('home',{clear:true}).then(function(){m.home=null;home();});}));return;}
    function set(lat,lng){api('home',{lat:lat,lng:lng}).then(function(j){if(j.ok){m.home=j.home;home();}});}
    var g=btn('ma-b ma-gold',bi('ที่นี่ ตอนนี้','Here, now'),function(){if(!navigator.geolocation)return;g.disabled=true;
      navigator.geolocation.getCurrentPosition(function(p){set(p.coords.latitude,p.coords.longitude);},function(){g.disabled=false;},{enableHighAccuracy:true,timeout:15000});});
    var f=el('form','ma-row'),inp=el('input');inp.placeholder='18.7883, 98.9853';inp.setAttribute('aria-label',bi('พิกัด','Coordinates'));
    inp.style.cssText='font:inherit;padding:.5em;border:2px solid #2a1e16;border-radius:10px;min-width:12em';
    f.append(inp,btn('ma-b',bi('ใช้พิกัดนี้','Use these')));f.querySelector('button').type='submit';
    f.addEventListener('submit',function(e){e.preventDefault();var x=/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/.exec(inp.value);if(x)set(+x[1],+x[2]);});
    r.appendChild(g);h.appendChild(f);}
  home();

  /* reminders and sending to my LINE */
  var s=el('div','ma-card');host.appendChild(s);
  s.appendChild(el('h4',null,bi('เข้า LINE ของฉัน','To my LINE')));
  s.appendChild(el('p',null,bi('แตะ ส่ง ที่มุมจอ แล้วเลือก ส่งเข้า LINE ของฉัน หรือบนงาน เลือก ⏰ ก่อนงาน','tap Send in the corner, then To my LINE; on an event, Remind me on LINE')));
  var ul=el('ul','ma-list');s.appendChild(ul);
  function rems(){ul.textContent='';(m.reminders||[]).forEach(function(x){var li=el('li');
    li.append(el('span',null,'⏰ '+new Date(x.at).toLocaleString('th-TH',{timeZone:'Asia/Bangkok',dateStyle:'medium',timeStyle:'short'})+' · '+String(x.text||'').split('\n')[0]),
      btn('ma-b',bi('ลบ','Remove'),function(){api('remind',{key:x.key,off:true}).then(function(){m.reminders=m.reminders.filter(function(y){return y.key!==x.key;});rems();});}));
    ul.appendChild(li);});}
  rems();
  if(!m.friend){var nf=el('div');s.appendChild(nf);needFriend(nf,m.oa,function(){location.reload();});}

  /* the reader's data */
  var d=el('div','ma-card');host.appendChild(d);
  d.appendChild(el('h4',null,bi('ข้อมูลของฉัน','My data')));
  d.appendChild(el('p','ma-hint',bi('ที่บันทึกไว้ แผน บุ๊กมาร์ก และการตั้งค่า ตามไปทุกเครื่องที่คุณเข้าสู่ระบบ','your saved places, plan, bookmarks and settings follow you to every device you sign in on')));
  var dr=el('div','ma-row');d.appendChild(dr);
  dr.append(lnk('ma-b',bi('ดาวน์โหลด','Download'),'/api/me/export'),
    btn('ma-b ma-red',bi('ลบบัญชี','Delete my account'),function(){
      if(!confirm(bi('ลบบัญชี ที่บันทึกไว้ในบัญชี บ้าน และข้อความที่ตั้งไว้? ที่บันทึกในเครื่องนี้ยังอยู่','Delete the account, what it saved, home and reminders? What this browser holds stays.')))return;
      api('delete',{confirm:true}).then(function(j){if(!j.ok)return;forget();put('md-acct',null);ME={signedIn:false,line:true};box();});}));
  if(welcome)setTimeout(function(){var t=document.getElementById('md-acct');if(t&&t.scrollIntoView)t.scrollIntoView({block:'start'});},50);}

/* the Send sheet: "To my LINE", and on an event "Remind me on LINE" */
function icsOf(body){var a=body.querySelector('[data-lp-ics]');if(!a)return '';var h=a.getAttribute('href')||'';
  try{return decodeURIComponent(h.split(',').slice(1).join(','));}catch(e){return '';}}
function field(t,n){var v=t.indexOf('BEGIN:VEVENT');if(v>=0)t=t.slice(v);var x=new RegExp('^'+n+'([^:\\n]*):(.*)$','m').exec(t.replace(/\r?\n[ \t]/g,''));
  return x?{p:x[1],v:x[2].trim().replace(/\\([,;\\])/g,'$1').replace(/\\n/gi,'\n')}:null;}
/* a Bangkok wall-clock stamp (20261025T190000 or 20261025) to epoch ms */
function bkk(s,h,mi){var x=/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/.exec(s||'');if(!x)return NaN;
  return Date.UTC(+x[1],+x[2]-1,+x[3],h!=null?h:+(x[4]||0),mi!=null?mi:+(x[5]||0))-7*36e5;}
function sheetRow(body){
  if(!body||body.querySelector('.ma-sheet'))return;var mode=body.dataset.mode;if(mode!=='send'&&mode!=='event')return;
  if(mode==='event'&&!body.querySelector('[data-lp-ics]'))return; /* still drawing; the observer comes back */
  css();var row=el('div','ma-sheet'),out=el('p','ma-hint');out.setAttribute('aria-live','polite');
  if(!ME||!ME.line)return;
  if(!ME.signedIn){var a=lnk('ma-b ma-line',bi('เข้าสู่ระบบด้วย LINE เพื่อส่งเข้า LINE ของคุณ','Sign in with LINE to send to your own LINE'),signIn());
    a.addEventListener('click',forget);row.appendChild(a);body.appendChild(row);return;}
  var U=window.MDSHARE&&MDSHARE.ui,ics=icsOf(body),ev=ics&&field(ics,'SUMMARY'),st=ics&&field(ics,'DTSTART'),url=ics&&field(ics,'URL');
  var title=ev?ev.v:(U?U.pageTitle():document.title),link=url?url.v:(U?U.pageUrl():location.href);
  function said(j,ok){if(j.needFriend){needFriend(out,j.oa,function(){out.textContent='';});return;}
    out.textContent=j.ok?'✓ '+ok:bi('ส่งไม่ได้ตอนนี้','could not send now');}
  var mine=btn('ma-b ma-line',bi('ส่งเข้า LINE ของฉัน','To my LINE'),function(){mine.disabled=true;
    api('line',{text:title+'\n'+link}).then(function(j){mine.disabled=false;said(j,bi('ส่งแล้ว','Sent'));});});
  row.appendChild(mine);
  if(st){var all=/VALUE=DATE/.test(st.p),start=bkk(st.v),key='ev:'+(field(ics,'UID')||{v:title}).v.slice(0,80);
    var when=[['เช้าวันงาน 08:00','Morning of, 08:00',bkk(st.v,8,0),'@am']];
    if(!all)when.push(['ก่อน 1 ชั่วโมง','1 hour before',start-36e5,'@1h']);
    when.forEach(function(w){if(!(w[2]>Date.now()))return;
      var b=btn('ma-b ma-gold','⏰ '+bi(w[0],w[1]),function(){b.disabled=true;
        var t='⏰ '+title+'\n'+new Date(start).toLocaleString('th-TH',{timeZone:'Asia/Bangkok',dateStyle:'medium',timeStyle:all?undefined:'short'})+'\n'+link;
        api('remind',{key:key+w[3],at:w[2],text:t}).then(function(j){b.disabled=false;said(j,bi('จะส่งเข้า LINE '+w[0],'on your LINE, '+w[1].toLowerCase()));});});
      row.appendChild(b);});}
  row.appendChild(out);body.appendChild(row);}
var OBS=null;
function watchSheet(){if(!document.addEventListener)return;document.addEventListener('click',function(){setTimeout(function(){var body=document.querySelector('.ls-wrap .ls-body');if(!body)return;
  sheetRow(body);if(!OBS&&window.MutationObserver){OBS=new MutationObserver(function(){sheetRow(body);});OBS.observe(body,{childList:true});}},0);},true);}

window.MDACCT={merge:merge,sync:sync,local:local,wipe:wipe};
if(!/^(?:[a-z0-9-]+\.)*motdang\.net$/.test(location.hostname))return;
watchSheet();
me().then(function(m){ME=m;if(m&&m.signedIn)sync();
  if(!document.querySelector)return;
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',box);else box();}).catch(function(){});
})();
""".replace("%KEYS%", __import__("json").dumps(KEYS))
