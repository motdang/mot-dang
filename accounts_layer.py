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

A box with id="md-acct" (my.html) shows "Sign in with LINE", or who is signed
in and a way out. Until LINE is switched on (/api/me says line: false) the box
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

/* the box on my.html */
function bi(th,en){return th+' · '+en;}
function box(){var b=document.getElementById('md-acct');if(!b||!ME||!ME.line)return;
  b.textContent='';
  if(!ME.signedIn){
    var a=document.createElement('a');a.href='/auth/line?back='+encodeURIComponent(location.pathname+location.search);
    a.addEventListener('click',function(){try{sessionStorage.removeItem('md-me');}catch(e){}});
    a.className='md-line-in';a.textContent=bi('เข้าสู่ระบบด้วย LINE','Sign in with LINE');
    a.style.cssText='display:inline-block;padding:.55em 1em;border-radius:99px;background:#06c755;color:#fff;font-weight:bold;text-decoration:none';
    var p=document.createElement('p');p.style.cssText='margin:.4em 0 0;font-size:.92em';
    p.textContent=bi('ที่บันทึกไว้ แผน บุ๊กมาร์ก และการตั้งค่า ตามไปเครื่องอื่นที่คุณเข้าสู่ระบบ',
      'your saved places, plan, bookmarks and settings follow you to the other devices you sign in on');
    b.append(a,p);return;}
  var s=document.createElement('span');s.textContent=bi('เข้าสู่ระบบแล้ว','Signed in')+': '+(ME.name||'LINE')+' ';
  var o=document.createElement('button');o.type='button';o.textContent=bi('ออกจากระบบ','Sign out');
  /* sign-out only after the account holds the latest; otherwise stay signed in and say so */
  o.addEventListener('click',function(){clearTimeout(T);o.disabled=true;sync().then(function(ok){
    if(!ok){o.disabled=false;s.textContent=bi('บันทึกล่าสุดยังส่งไม่ได้ ยังไม่ได้ออกจากระบบ','your latest changes did not reach the account; still signed in')+' ';return;}
    return fetch('/auth/logout',{method:'POST',credentials:'same-origin'}).then(function(r){if(!r.ok)throw 0;
      try{sessionStorage.removeItem('md-me');}catch(e){}wipe();put('md-acct',null);ME={signedIn:false,line:true};box();});
  }).catch(function(){o.disabled=false;});});
  b.append(s,o);}

window.MDACCT={merge:merge,sync:sync,local:local,wipe:wipe};
if(!/^(?:[a-z0-9-]+\.)*motdang\.net$/.test(location.hostname))return;
me().then(function(m){ME=m;box();if(m&&m.signedIn)sync();}).catch(function(){});
})();
""".replace("%KEYS%", __import__("json").dumps(KEYS))
