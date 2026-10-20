/* The front page. Baked data in /front/*.json (front_layer.py); live data in
   /data/{weather,air,sky}.json. Thai or English from the bar's ไทย / EN. */
(function () {
'use strict';
/* the time model is when.js (window.MDWHEN): Bangkok's clock, the 03:00 day, span, ics, the names */
var MW = window.MDWHEN, bkk = MW.bkk, hhmm = MW.hhmm, ymd = MW.ymd, at = MW.at, atEnd = MW.atEnd, span = MW.span, ics = MW.ics,
  MON_TH = MW.MON_TH, MON_EN = MW.MON_EN, DAY_TH = MW.DAY_TH, DAY_EN = MW.DAY_EN;
var LIVE = '/';
var ON_SITE = /(^|\.)motdang\.net$/.test(location.hostname);
var REDUCED = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
var DPR = Math.min(window.devicePixelRatio || 1, 2);
var $ = function (id) { return document.getElementById(id); };
var H = document.documentElement;
var GATE = [18.7877, 98.9931];
var D = {};
/* the calendar in three bands (design 2026-10-11; Nan's answers 2026-10-11: the grid, the doodle's pager and the festival ribbon go, the #soon list goes) */
var CALNEXT = true;
H.classList.add('cal-next');
if (CALNEXT) (function () {
  var st = document.createElement('style'); st.id = 'front-cal-next';
  st.textContent = [
    '#month .nxtitle{font:700 1.5rem/1.15 var(--hand);margin:0 0 .6rem}',
    '#month .mtopbar{align-items:flex-end}',
    '#month .nxh{display:flex;flex-wrap:wrap;align-items:baseline;gap:.1rem .6rem;margin:1.3rem 0 .5rem;padding-bottom:.25rem;border-bottom:2px dashed #b0442e;font:700 1.25rem/1.2 var(--hand)}',
    '#month .nxh small{font:600 .85rem var(--hand);color:var(--mute)}',
    '#month .nxsub{margin:1.1rem 0 .2rem;font:700 1.05rem var(--hand);color:var(--hot)}#month .nxsub small{font:600 .85rem var(--hand);color:var(--mute)}',
    '#month .nxwk{margin:.9rem 0 .1rem;font:700 .95rem var(--hand);color:var(--mute)}',
    '#month .nxnone,#month .nxhint{margin:.6rem 0;color:var(--mute)}',
    '#month .nxmk{margin:.3rem 0 .5rem}',
    /* a row: its time large, the whole title wrapping, the buttons under it */
    '#month details.ev.nx{margin:.5rem 0}',
    '#month details.ev.nx>summary{display:grid;grid-template-columns:4.4rem minmax(0,1fr);gap:.15rem .7rem;align-items:start;padding:.6rem .7rem}',
    '#month details.ev.nx .nxt{font:800 1.4rem/1.05 var(--mono);color:var(--hot);min-width:0}',
    '#month details.ev.nx .nxt .bi{font:700 .88rem/1.2 var(--hand)}#month details.ev.nx .nxt .bi>.en{font-size:.78em}',
    '#month details.ev.nx .nxt .nxu{display:block;font:700 .8rem/1.1 var(--hand);color:var(--mute)}',
    '#month details.ev.nx .nxt .nxe{display:block;font:600 .8rem/1.2 var(--mono);color:var(--mute)}',
    '#month details.ev.nx .nxt .nxd{display:block;font:700 .9rem/1.15 var(--hand);color:var(--hot)}',
    '#month details.ev.nx .nxb{min-width:0}',
    '#month details.ev.nx .tt{font-size:1.08rem;line-height:1.3;overflow-wrap:anywhere}',
    '#month details.ev.nx .meta{overflow-wrap:anywhere}',
    '#month details.ev.nx .why{margin-top:.25rem}',
    '#month details.ev.nx .nxa{grid-column:1/-1;display:flex;flex-wrap:wrap;margin-top:.3rem;gap:5px}',
    '#month details.ev.nx .nxa a,#month details.ev.nx .nxa button{background:#fff;border:1.5px solid var(--ink);border-radius:10px 7px 11px 8px;color:var(--ink);text-decoration:none;cursor:pointer;font:inherit;padding:.3rem .55rem;font-size:.88rem;min-height:2.5rem;display:inline-flex;align-items:center;justify-content:center;text-align:center;line-height:1.15}',
    '#month details.ev.nx .nxa .on{background:var(--ink);color:var(--bg)}#month details.ev.nx .nxa .on .en{color:var(--bg)}',
    '#month details.ev.nx .nxa .bi.stack{align-items:center}',
    '#month details.ev.nxrun{border-left:6px solid #4fae8c}',
    '#month details.ev.nxrun>summary{display:block;padding:.45rem .7rem}',
    '#month details.ev.nxrun .tt{display:inline;font-size:1rem}',
    '#month details.ev.nxrun .nxu{color:var(--mute);font-weight:600;font-size:.9rem}',
    '#aheadwk{margin-top:.4rem}',
    /* a day of the next fourteen: its heading, wan phra and festival marks */
    '#month .nxday{margin:1rem 0 .2rem;font:700 1.05rem var(--hand);color:var(--hot)}#month .nxday small{font:600 .85rem var(--hand);color:var(--mute)}',
    '#month .nxmk{display:inline-block;font:600 .78rem var(--hand);color:var(--mute);border:1px solid var(--line);border-radius:999px;padding:0 .45rem;margin-left:.2rem}#month .nxmk.hot{color:#b0442e;border-color:#b0442e}',
    /* the reason and the thumbs, small, inside the opened card */
    '#month .nxwhy{margin:.1rem .8rem .3rem;font-size:.8rem;color:var(--mute)}',
    '#month .nxfb{margin:.1rem .8rem .6rem}#ahead .nxfb{margin:.5rem 0 0}',
    '#month .mord{display:inline-flex;gap:4px;flex:none}',
    /* plan ahead: the festival cards stacked, whole at phone width */
    '#ahead{margin-top:1.3rem}#ahcards{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,19rem),1fr));gap:12px;overflow:visible;scroll-snap-type:none;padding:.3rem 0}',
    '#ahcards .ahc{flex:none;margin:0}#ahcards .aha .chip.paid{font-size:.8rem}#ahcards .aha .chip i{font-style:normal;opacity:.75}',
    '@media (max-width:420px){#month details.ev.nx>summary{grid-template-columns:4rem minmax(0,1fr);gap:.1rem .55rem;padding:.55rem .6rem}#month details.ev.nx .nxt{font-size:1.28rem}}'
  ].join('');
  document.head.appendChild(st);
})();
/* the taps' own look (2026-10-04): slips, the turned clock, the picks, hearts */
(function () { var st = document.createElement('style'); st.id = 'front-taps'; st.textContent = '#doodc{touch-action:pan-y}#ddat[hidden],#spotev[hidden],#ddpop[hidden]{display:none!important}#ddclk{position:absolute;z-index:3;border-radius:50%;touch-action:none;cursor:grab;-webkit-tap-highlight-color:transparent}#ddclk:focus-visible{outline:3px dashed var(--hot);outline-offset:4px}#ddclk.turning{cursor:grabbing}#ddat{position:absolute;right:8px;z-index:4;display:flex;align-items:center;gap:.4rem;background:#f2e6c9;color:#2a1a0a;border-radius:6px;padding:.25rem .3rem .25rem .6rem;box-shadow:2px 3px 0 rgba(0,0,0,.35);font-size:.9rem;transform:rotate(.8deg);max-width:calc(100% - 16px)}#ddat b{font-weight:800}#ddat small{font-weight:600;color:#6a4a20}#ddat .en{color:inherit}html.lang-both #ddat .en{display:none}#ddat button{background:#2a1a0a;color:#fff;border:0;border-radius:6px;padding:.25rem .6rem;min-height:2.2rem;font-weight:800;cursor:pointer}#ddat button .en{color:#fff}#ddpop{z-index:5}#ddpop.unf{animation:ddUnf .42s cubic-bezier(.2,.9,.25,1.2) both;transform-origin:50% 100%}@keyframes ddUnf{from{opacity:0;transform:perspective(700px) rotateX(-75deg) scale(.6)}to{opacity:1;transform:rotate(-.6deg)}}#ddpop .pw{font-weight:700}#ddpop .pd{font-size:.88rem;color:#4a3420}#ddpop .sty{background:rgba(120,90,40,.12);border-left:3px solid #c9973f;padding:.3rem .5rem;border-radius:4px}#ddpop .thd{font-size:1.05rem;font-weight:700}#ddpop .ddacts{flex-wrap:wrap!important}#ddpop .ddacts a{min-height:2.4rem;white-space:nowrap}#ddpop .cd .en,#ddpop .cd{color:inherit}.ddtop.turned{border-color:var(--hot)!important}.ddw i{font-style:normal;color:var(--hot)}.ddair a[data-now]{color:var(--hot)}.cd{font-weight:700}.cd.on{color:#8be07a}.cd.over{opacity:.7}#ddpop .cd.on{color:#1d6b12}.ddwhen .cd{font:700 .85rem var(--sans);color:#fff}.ddwhen .cd.on{color:#8be07a}.ddwhen .cd .en::before,#ddpop .cd .en::before{content:none}html.lang-both .ddwhen .cd .en,html.lang-both #ddpop .cd .en,html.lang-both .evcd .cd .en{display:none}.mbar{display:flex;gap:6px;overflow-x:auto;padding:0 0 .6rem;scrollbar-width:none}.mbar::-webkit-scrollbar{display:none}.mq{flex:none;display:inline-flex;align-items:center;gap:.35rem;min-height:2.5rem;padding:.2rem .75rem;border-radius:999px;border:1px solid var(--line);background:var(--card);color:var(--ink);font:600 .92rem var(--sans);cursor:pointer;white-space:nowrap;transition:transform .15s}.mq:active{transform:scale(.95)}.mq i{font-style:normal;opacity:.75;font-size:.85em}.mq s{width:.7rem;height:.7rem;border-radius:50%;display:inline-block}.mq b{color:#ff6b8a}.mq[aria-pressed=true]{background:var(--hot);border-color:var(--hot);color:#000;font-weight:800}.mq[aria-pressed=true] .en,.mq[aria-pressed=true] b{color:#000}html.lang-both .mq .en{display:none}.msep{flex:none;width:1px;background:var(--line);margin:.3rem .15rem}#month .wrap{position:relative}#mday{touch-action:pan-y}#mday.unfold details.ev,#mday.slide-l details.ev,#mday.slide-r details.ev{animation:mdIn .45s ease both;animation-delay:calc(var(--i,0) * 45ms + .15s)}@keyframes mdIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}details.ev{position:relative}details.ev>summary{padding-right:3.2rem}.hrt{position:absolute;right:.45rem;top:.45rem;width:2.6rem;height:2.6rem;border-radius:50%;border:0;background:transparent;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0}.hrt svg{width:1.45rem;height:1.45rem;fill:none;stroke:var(--mute);stroke-width:2;transition:transform .2s}.hrt:hover svg{stroke:#ff6b8a}.hrt[aria-pressed=true] svg{fill:#ff4f7a;stroke:#ff4f7a}.hrt.pop svg{animation:hrtPop .5s cubic-bezier(.3,1.6,.5,1)}@keyframes hrtPop{0%{transform:scale(.6)}60%{transform:scale(1.35)}100%{transform:scale(1)}}details.ev.at{box-shadow:inset 5px 0 0 var(--hot),0 0 0 1px var(--hot)}details.ev.at .tm::after{content:" ▸";color:var(--hot)}.evx{margin:0 0 .6rem}canvas.evdd{display:block;width:100%;height:96px;border-radius:10px;margin-bottom:.4rem}.evcd{margin:.1rem 0 .5rem!important;font-size:1rem}.evcd .en::before{content:none}.evx .acts{margin-bottom:.4rem}#spotev{position:fixed;left:50%;bottom:calc(14px + env(safe-area-inset-bottom));transform:translateX(-50%) rotate(-.4deg);z-index:2147483600;width:min(26rem,calc(100% - 24px));background:#f2e6c9;color:#2a1a0a;border-radius:8px;padding:.6rem .7rem .6rem;box-shadow:3px 5px 0 rgba(0,0,0,.35),0 10px 30px rgba(0,0,0,.55);animation:ddUnf .4s ease both}#spotev b{display:block;padding-right:2rem}#spotev .en{color:#6a4a20}html.lang-both #spotev .en{display:none}#spotev .sp{display:block;width:100%;text-align:left;background:none;border:0;border-top:1px solid rgba(42,26,10,.2);padding:.45rem 0;color:#2a1a0a;font:600 .95rem var(--sans);cursor:pointer;min-height:2.6rem}#spotev time{font:800 .85rem var(--mono);color:#8a4a10}#spotev .x{position:absolute;right:.3rem;top:.2rem;background:none;border:0;font-size:1.5rem;color:#2a1a0a;cursor:pointer;min-width:2.4rem;min-height:2.4rem}@media (max-width:639px){#ddat{right:6px;font-size:.82rem}}@media (prefers-reduced-motion:reduce){#ddpop.unf,#spotev,#mday details.ev,.hrt.pop svg{animation:none!important}}#ddpop .ddvote{display:flex;flex-wrap:wrap;gap:.3rem .8rem;align-items:center;margin-top:.45rem;font-size:.85rem}#ddpop .ddvote[hidden]{display:none!important}#ddpop .ddvote span{display:inline-flex;gap:.25rem;align-items:center}#ddpop .ddvote span>.en,#ddpop .ddvote span>.th{margin-right:.15rem;font-weight:700}#ddpop .ddvote button{display:inline-flex;align-items:center;gap:.2rem;min-height:2.3rem;min-width:2.7rem;padding:0 .45rem;border:1px solid rgba(42,26,10,.35);border-radius:999px;background:transparent;color:#2a1a0a;font:700 .8rem var(--mono);cursor:pointer}#ddpop .ddvote button[aria-pressed=true]{background:#2a1a0a;color:#f2e6c9}#ddpop .ddvote svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}'; document.head.appendChild(st); })();

function j(u) { return fetch(u).then(function (r) { if (!r.ok) throw new Error(u); return r.json(); }); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function bi(th, en, cls) { return '<span class="bi' + (cls ? ' ' + cls : '') + '"><span class="th" lang="th">' + th + '</span><span class="en" lang="en">' + en + '</span></span>'; }
function hash(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function rnd(seed) { return function () { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; }
function store(k, v) { try { if (v === undefined) return JSON.parse(localStorage.getItem(k) || 'null'); localStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; } }

/* ------------------------------------------------------------ the bar folds (the fleet's rule)
   Past 60 px the brand row folds away and the seek row (menu, search) stays;
   14 px down hides the bar, 90 px up or the top brings it back. The bar is
   sticky in the page's flow, so the rows it drops become margin under it and
   scroll anchoring is off for the instant of the fold: otherwise a reader who
   stops just past the fold is thrown back above it (homebits.HEADER_JS). */
var bar = document.querySelector('header.bar');
function barh() { H.style.setProperty('--barh', (document.body.classList.contains('nav-away') ? 0 : bar.offsetHeight) + 'px'); }
(function () {
  var b = document.body, h = bar, y = window.pageYOffset, up = 0, dn = 0, ticking = false;
  function away(on) { if (on === b.classList.contains('nav-away')) return; b.classList.toggle('nav-away', on); barh(); }
  function tight(on) {
    if (on === b.classList.contains('nav-tight')) return;
    var r = H.style; r.overflowAnchor = 'none';
    h.style.marginBottom = ''; var a = h.offsetHeight;
    b.classList.toggle('nav-tight', on);
    if (on) h.style.marginBottom = Math.max(0, a - h.offsetHeight) + 'px';
    void h.offsetHeight; r.overflowAnchor = ''; barh();
  }
  function frame() {
    ticking = false;
    var n = window.pageYOffset, d = n - y; y = n;
    if (H.classList.contains('menu-open')) return;
    if (n < 60) { up = dn = 0; away(false); tight(false); return; }
    tight(true);
    if (d > 0) { dn += d; up = 0; if (dn > 14 && !h.contains(document.activeElement)) away(true); }
    else if (d < 0) { up -= d; dn = 0; if (up > 90) away(false); }
  }
  addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(frame); } }, { passive: true });
  addEventListener('resize', function () { if (b.classList.contains('nav-tight')) { b.classList.remove('nav-tight'); tight(true); } barh(); }, { passive: true });
  addEventListener('focusin', function (e) { if (h.contains(e.target)) away(false); });
  frame(); barh();
})();

/* ------------------------------------------------------------ the menu: the drawer as a sheet from the top */
(function () {
  var dlg = $('menu'), btn = $('menuBtn'), x = $('menuX');
  if (!dlg || !btn) return;
  var modal = typeof dlg.showModal === 'function';
  function open() {
    if (dlg.open) return;
    H.classList.add('menu-open');
    if (modal) dlg.showModal(); else dlg.setAttribute('open', '');
    btn.setAttribute('aria-expanded', 'true');
    x.focus();
  }
  function shut() { if (!dlg.open) return; if (modal) dlg.close(); else { dlg.removeAttribute('open'); closed(); } }
  function closed() {
    H.classList.remove('menu-open');
    btn.setAttribute('aria-expanded', 'false');
    btn.focus();
  }
  btn.addEventListener('click', function () { dlg.open ? shut() : open(); });
  x.addEventListener('click', shut);
  dlg.addEventListener('close', closed);
  /* a tap on the backdrop lands on the dialog itself, outside the sheet */
  dlg.addEventListener('click', function (e) {
    if (e.target !== dlg) return;
    var r = dlg.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) shut();
  });
  if (!modal) document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && dlg.open) shut(); });
  /* a link that only moves within this page closes the sheet on the way */
  dlg.addEventListener('click', function (e) { var a = e.target.closest && e.target.closest('a[href^="#"]'); if (a) shut(); });
})();

/* ------------------------------------------------------------ where the reader is */
var where = { lat: GATE[0], lng: GATE[1], how: 'gate' };
(function () {
  var m = document.querySelector('meta[name=md-where]'), v = m && m.content.split('|');
  if (v && v.length >= 3) {
    var la = parseFloat(v[1]), lo = parseFloat(v[2]);
    if (la > 17.3 && la < 20.7 && lo > 97.2 && lo < 100.7) where = { lat: la, lng: lo, how: 'network' };
  }
})();
/* where the reader is, shared by every map on the page (sessionStorage md-here, twenty minutes; the map's own
   pill and locshare.js write it too) — Nan, 2026-10-03: "I could share my location but I couldn't find myself" */
function hereLoad() { try { var v = JSON.parse(sessionStorage.getItem('md-here')); if (v && Date.now() - v.t < 20 * 60e3) return v; } catch (e) { } return null; }
function hereSave(lat, lng, acc) { try { sessionStorage.setItem('md-here', JSON.stringify({ lat: lat, lng: lng, acc: acc || null, t: Date.now() })); } catch (e) { } }
(function () { var h = hereLoad(); if (h && h.lat > 17.3 && h.lat < 20.7 && h.lng > 97.2 && h.lng < 100.7) where = { lat: h.lat, lng: h.lng, how: 'gps' }; })();
/* A map link, coordinates or a Plus Code typed into a search box opens the map at that point with the places
   around it, instead of a word search that cannot read it (Nan, 2026-10-03: "you should be able to search a
   google maps short link on motdang and come up with a map pin and placeIDs for anywhere nearby").
   /map.html?su= opens Google short links through /api/resolve (locshare.js inbound). */
(function(){
var LINK=/https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs|(?:www\.)?google\.[a-z.]+\/maps|maps\.google\.[a-z.]+|maps\.apple\.com|omaps\.app|(?:www\.)?openstreetmap\.org|osm\.org|line\.me\/R\/nv\/location)\S*/i;
var LL=/^\s*-?\d{1,2}\.\d{3,}\s*[, ]\s*-?\d{1,3}\.\d{3,}\s*$/, PLUS=/(^|\s)[23456789CFGHJMPQRVWX]{2,8}\+[23456789CFGHJMPQRVWX]{0,3}(\s|$)/i;
document.addEventListener('submit',function(e){
  var f=e.target;if(!f||!f.querySelector||!/\/find\b/.test(f.getAttribute('action')||''))return;
  var i=f.querySelector('input[type=search],input[name=q]');if(!i)return;
  var v=(i.value||'').trim();if(!v||!(LINK.test(v)||LL.test(v)||PLUS.test(v)))return;
  e.preventDefault();location.href='/map.html?su='+encodeURIComponent(v.slice(0,500));
},true);
})();
function north() { return where.how !== 'gate'; }
function precise(cb) {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(function (p) { where = { lat: p.coords.latitude, lng: p.coords.longitude, how: 'gps' }; hereSave(where.lat, where.lng, p.coords.accuracy); cb(); },
    function () { }, { maximumAge: 600000, timeout: 8000 });
}
function relocated() { near(); sky.text(); cal(); if (CLK) CLK.relocate(); }
/* a fix the map (or another tab of this page's tools) made: Near, the sky line and the calendar follow it */
addEventListener('storage', function (e) {
  if (e.key !== 'md-here') return; var h = hereLoad();
  if (h && h.lat > 17.3 && h.lat < 20.7 && h.lng > 97.2 && h.lng < 100.7) { where = { lat: h.lat, lng: h.lng, how: 'gps' }; relocated(); }
});
if (navigator.permissions) navigator.permissions.query({ name: 'geolocation' }).then(function (s) { if (s.state === 'granted') precise(relocated); }, function () { });
var DIRS = [['เหนือ', 'N'], ['ตะวันออกเฉียงเหนือ', 'NE'], ['ตะวันออก', 'E'], ['ตะวันออกเฉียงใต้', 'SE'], ['ใต้', 'S'], ['ตะวันตกเฉียงใต้', 'SW'], ['ตะวันตก', 'W'], ['ตะวันตกเฉียงเหนือ', 'NW']];
function km(a, b, c, d) { return Math.hypot((c - a) * 111.32, (d - b) * 111.32 * Math.cos(a * Math.PI / 180)); }
function dir(a, b, c, d) { var x = (d - b) * Math.cos(a * Math.PI / 180), y = c - a; return DIRS[Math.round(((Math.atan2(x, y) * 180 / Math.PI + 360) % 360) / 45) % 8]; }
function far(k) {
  var c = where.how === 'network' ? '~' : '';
  if (k < 0.1) return where.how === 'network' ? 'ใกล้ๆ' : Math.round(k * 1000) + ' ม.';
  if (k < 0.95) return c + Math.round(k * 10) * 100 + ' ม.';
  return c + (k < 10 ? k.toFixed(1) : Math.round(k)) + ' กม.';
}
function farEn(k) {
  var c = where.how === 'network' ? '~' : '';
  if (k < 0.1) return where.how === 'network' ? 'nearby' : Math.round(k * 1000) + ' m';
  if (k < 0.95) return c + Math.round(k * 10) * 100 + ' m';
  return c + (k < 10 ? k.toFixed(1) : Math.round(k)) + ' km';
}
function fromWhere() {
  return where.how === 'gps' ? bi('จากตรงที่คุณยืน', 'from where you stand')
    : where.how === 'network' ? bi('จากราวๆ ที่คุณอยู่ (เครือข่ายเดาให้)', 'from roughly where you are, a network guess')
    : bi('จากประตูท่าแพ', 'from Tha Phae Gate');
}

/* ------------------------------------------------------------ weather, read */
var WMO = { 0: ['แดดจ้า', 'Clear'], 1: ['แดดบางส่วน', 'Mainly clear'], 2: ['มีเมฆบางส่วน', 'Partly cloudy'], 3: ['เมฆมาก', 'Overcast'], 45: ['หมอก', 'Fog'], 48: ['หมอก', 'Fog'],
  51: ['ฝนปรอยเบา', 'Light drizzle'], 53: ['ฝนปรอย', 'Drizzle'], 55: ['ฝนปรอยหนัก', 'Heavy drizzle'], 61: ['ฝนเล็กน้อย', 'Light rain'], 63: ['ฝน', 'Rain'], 65: ['ฝนหนัก', 'Heavy rain'],
  80: ['ฝนไล่ช้าง', 'Showers'], 81: ['ฝนไล่ช้างหนัก', 'Heavy showers'], 82: ['ฝนกระหน่ำ', 'Violent showers'], 95: ['พายุฝนฟ้าคะนอง', 'Thunderstorm'], 96: ['พายุลูกเห็บ', 'Thunderstorm, hail'], 99: ['พายุลูกเห็บ', 'Thunderstorm, hail'] };
function city() {
  var w = D.weather; if (!w) return null;
  var id = where.lat > 19.5 ? 'chiang-rai' : 'chiang-mai';
  return w.cities.filter(function (c) { return c.id === id; })[0] || w.cities[0];
}
function hourKey(t) { return bkk(t).toISOString().slice(0, 13) + ':00'; }
/* the nearest of make_weather.SPOTS (~11 km apart) when we know roughly where the reader is */
function spot() {
  var w = D.weather; if (!w || !w.spots || !w.spots.length || where.how === 'gate') return null;
  var b = null, bk = 1e9;
  w.spots.forEach(function (s) { var d = km(where.lat, where.lng, s.lat, s.lng); if (d < bk) { bk = d; b = s; } });
  return bk <= 12 ? b : null;
}
/* "not raining?" (Nan, 2026-10-03): a reader who says it is dry is believed, here, for the hour */
var SAID = 'md-said-dry';
function saidDry() { try { return Date.now() - (+localStorage.getItem(SAID) || 0) < 60 * 60e3; } catch (e) { return false; } }
function rainState(at) {
  var c = city(); if (!c) return null;
  var tt = at == null ? Date.now() : at, then = Math.abs(tt - Date.now()) > 45 * 60e3;
  /* a forecast more than six hours old says nothing about now (2026-10-03: a day-old one said "raining") */
  var f = Date.parse(D.weather.fetched || ''); if (!(Date.now() - f < 6 * 36e5)) return null;
  var sp = spot(), hs = (sp && sp.hours.length ? sp.hours : c.hours) || [], k = hourKey(tt), i = -1;
  for (var n = 0; n < hs.length; n++) if (hs[n][0] === k) i = n;
  var st = { mm: 0, prob: 0, code: c.code, name: c.th, en: c.en, i: i };
  if (i < 0) { st.raining = !then && c.code >= 51 && c.code < 100; return st; }
  st.mm = hs[i][2]; st.prob = hs[i][1]; st.raining = st.mm >= 0.3 || (st.mm >= 0.1 && st.prob >= 45);
  if (st.raining && !then && saidDry()) { st.raining = false; st.said = true; st.mm = 0; }
  for (n = i + 1; n < Math.min(hs.length, i + 13); n++) {
    if (st.raining && hs[n][2] < 0.2 && !st.until) st.until = hs[n][0];
    if (!st.raining && !st.said && !st.next && (hs[n][2] >= 0.2 || hs[n][1] >= 60)) st.next = hs[n];
  }
  return st;
}
function air() {
  var a = D.air; if (!a) return null;
  var id = where.lat > 19.5 ? 'chiang-rai' : 'chiang-mai';
  return a.places.filter(function (p) { return p.id === id; })[0] || a.places[0];
}
function visKm(pm) { return 3912 / (13.3 * pm + 20); }
function sunAlt(t, lat, lng) {
  var r = Math.PI / 180, d = t / 864e5 - 10957.5;
  var g = (357.529 + 0.98560028 * d) * r, q = 280.459 + 0.98564736 * d;
  var L = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * r, e = (23.439 - 0.00000036 * d) * r;
  var ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)), dec = Math.asin(Math.sin(e) * Math.sin(L));
  var gmst = (280.46061837 + 360.98564736629 * d) % 360, Hh = (gmst + lng) * r - ra;
  return Math.asin(Math.sin(lat * r) * Math.sin(dec) + Math.cos(lat * r) * Math.cos(dec) * Math.cos(Hh)) / r;
}
function hex(c) { return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]; }
function mix(a, b, k) { k = Math.max(0, Math.min(1, k)); return [0, 1, 2].map(function (i) { return Math.round(a[i] + (b[i] - a[i]) * k); }); }
function rgb(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + (a == null ? 1 : a) + ')'; }

/* ------------------------------------------------------------ the air and the rain: told and drawn in the
   doodle (Nan, 2026-10-03: the Suthep panel "collapsed into the daily doodle"); the page veil stays */
var sky = {
  text: function () {
    var st = rainState(), a = air();
    veil.set(st && st.raining && north() ? st.mm : 0, a ? a.pm25 : 0);
    forecast();
    if (CLK) CLK.relocate();
  }
};
/* what the air lets you see of Doi Suthep, 10.8 km west of Tha Phae Gate */
function suthep(pm, night) {
  var V = visKm(pm), C = Math.exp(-3.912 * 10.8 / V);
  var L = C > 0.1 ? (night ? ['อากาศใส', 'The air is clear'] : ['มองเห็นดอยสุเทพ', 'Doi Suthep is in view'])
    : C > 0.01 ? ['ดอยสุเทพจางในหมอกควัน', 'Doi Suthep is fading in the haze'] : ['ควันบังดอยสุเทพ', 'Smoke hides Doi Suthep'];
  return { V: V, C: C, th: L[0], en: L[1] };
}

var veil = (function () {
  var cv = $('veil'), c = cv.getContext('2d'), mm = 0, drops = [], run = false;
  function set(m, pm) {
    mm = m;
    document.body.style.boxShadow = pm > 50 ? 'inset 0 0 0 100vmax rgba(170,140,100,' + Math.min(0.1, (pm - 50) / 800) + ')' : '';
    if (mm > 0 && !REDUCED && !run) { run = true; requestAnimationFrame(frame); }
  }
  function frame() {
    var W = innerWidth, Hh = innerHeight;
    if (cv.width !== W * DPR) { cv.width = W * DPR; cv.height = Hh * DPR; }
    c.setTransform(DPR, 0, 0, DPR, 0, 0); c.clearRect(0, 0, W, Hh);
    if (H.dataset.contrast === 'more') { run = false; return; }
    var want = Math.min(200, 30 + mm * 45);
    while (drops.length < want) drops.push([Math.random() * W * 1.2, Math.random() * Hh, 700 + Math.random() * 500]);
    c.strokeStyle = 'rgba(190,210,235,.2)'; c.lineWidth = 1; c.beginPath();
    drops.forEach(function (d) { d[1] += d[2] / 60; d[0] -= d[2] / 450; if (d[1] > Hh) { d[1] = -12; d[0] = Math.random() * W * 1.2; } c.moveTo(d[0], d[1]); c.lineTo(d[0] + 2, d[1] - 12); });
    c.stroke();
    if (mm > 0) requestAnimationFrame(frame); else { run = false; c.clearRect(0, 0, W, Hh); }
  }
  return { set: set };
})();

/* ------------------------------------------------------------ the forecast, in plain view */
function icon(code) {                  /* drawn, not emoji: sun, cloud, rain, storm */
  var sun = '<circle cx="24" cy="22" r="9" fill="#ffc94a"/>' + [0, 45, 90, 135, 180, 225, 270, 315].map(function (a) {
    var r = a * Math.PI / 180; return '<line x1="' + (24 + Math.cos(r) * 13) + '" y1="' + (22 + Math.sin(r) * 13) + '" x2="' + (24 + Math.cos(r) * 17) + '" y2="' + (22 + Math.sin(r) * 17) + '" stroke="#ffc94a" stroke-width="2.5" stroke-linecap="round"/>'; }).join('');
  var cloud = '<path d="M14 36h22a8 8 0 0 0 0-16 11 11 0 0 0-21 3 7 7 0 0 0-1 13z" fill="#dfe6ee"/>';
  var rain = '<path d="M17 40l-3 6M25 40l-3 6M33 40l-3 6" stroke="#6fb4ff" stroke-width="2.5" stroke-linecap="round"/>';
  var bolt = '<path d="M26 37l-5 8h5l-3 7 8-10h-5l3-5z" fill="#ffd400"/>';
  var s = code <= 1 ? sun : code === 2 ? '<g transform="translate(-6,-5) scale(.8)">' + sun + '</g>' + cloud : code < 50 ? cloud : code >= 95 ? cloud + bolt : cloud + rain;
  return '<svg viewBox="0 0 48 52" width="48" height="52" aria-hidden="true">' + s + '</svg>';
}
function forecast() {
  /* wx.js draws the three panels when it loaded (2026-10-10); these lines are its stand-in */
  if (window.MDWX && MDWX.render(D.weather, D.air, where, spot())) return;
  var c = city(); if (!c) return;
  var hs = c.hours || [], k = hourKey(Date.now()), i0 = 0;
  for (var n = 0; n < hs.length; n++) if (hs[n][0] === k) i0 = n;
  var box = $('hours'), W = Math.max(260, Math.round(box.clientWidth - 36)), narrow = W < 520;
  var hrs = hs.slice(i0, i0 + (narrow ? 12 : 24)), step = narrow ? 2 : 3;
  if (hrs.length) {
    var Hh = 150, bw = W / hrs.length, peak = hrs.reduce(function (a, h) { return h[1] > a[1] ? h : a; }, hrs[0]);
    var bars = hrs.map(function (h, i) {
      var p = h[1], mm = h[2], y = 110 - p * 0.95, col = p >= 60 ? '#3d8bff' : p >= 30 ? '#7fb2ff' : '#5b6675';
      return '<rect x="' + (i * bw + 2) + '" y="' + y + '" width="' + (bw - 4) + '" height="' + (110 - y) + '" rx="3" fill="' + col + '"' + (i === 0 ? ' stroke="#fff" stroke-width="2.5"' : '') + '/>' +
        (mm >= 0.5 ? '<text x="' + (i * bw + bw / 2) + '" y="' + (y - 5) + '" font-size="15" fill="#fff" text-anchor="middle">' + mm + '</text>' : '') +
        (i % step === 0 ? '<text x="' + (i * bw + bw / 2) + '" y="136" font-size="17" fill="#d3d9e0" text-anchor="middle">' + (i === 0 ? 'now' : h[0].slice(11, 13)) + '</text>' : '');
    }).join('');
    var sth = peak[1] >= 30 ? 'ฝนมีโอกาสมากที่สุดราว ' + peak[0].slice(11) + ' (' + peak[1] + '%)' : 'ไม่น่ามีฝนตลอด 24 ชั่วโมง';
    var sen = peak[1] >= 30 ? 'rain most likely around ' + peak[0].slice(11) + ' (' + peak[1] + '%)' : 'little chance of rain for 24 hours';
    $('hours').innerHTML = '<h3>' + bi('ฝน ' + hrs.length + ' ชั่วโมงข้างหน้า', 'Rain, the next ' + hrs.length + ' hours') + '</h3><p class="sum">' + bi(sth, sen) + '</p>' +
      '<svg width="' + W + '" height="' + Hh + '" viewBox="0 0 ' + W + ' ' + Hh + '" role="img" aria-label="' + esc(sen) + '"><line x1="0" x2="' + W + '" y1="110" y2="110" stroke="#aab4be"/>' + bars + '</svg>' +
      '<p class="sum" style="font-size:.85rem">' + bi('แท่ง = โอกาสฝน · ขอบขาว = ชั่วโมงนี้ · ตัวเลข = มม.', 'bar = chance of rain · white edge = this hour · number = mm') + ' · Open-Meteo</p>';
  }
  var days = (c.days || []).slice(0, 3);
  $('days3').innerHTML = '<h3>' + bi('3 วัน', 'Three days') + '</h3><div id="days">' + days.map(function (d, i) {
    var dt = new Date(d.date + 'T12:00:00+07:00'), w = WMO[d.code] || ['', ''];
    return '<div class="day"><b>' + bi(i === 0 ? 'วันนี้' : DAY_TH[dt.getUTCDay()], i === 0 ? 'Today' : DAY_EN[dt.getUTCDay()].slice(0, 3), 'stack') + '</b>' + icon(d.code) +
      '<div class="t">' + Math.round(d.max) + '° <small>' + Math.round(d.min) + '°</small></div><div class="w">' + bi(w[0], w[1], 'stack') + '</div></div>';
  }).join('') + '</div>';
  var a = air();
  if (a) {
    var hist = (a.days || []).slice(-7), mx = Math.max.apply(null, hist.map(function (d) { return d.pm25; }).concat([a.pm25, 40]));
    $('airp').innerHTML = '<h3>' + bi('อากาศ', 'The air') + '</h3><div class="now"><span style="color:' + a.band.colour + '">●</span> PM2.5 ' + a.pm25 + ' · ' + bi(a.band.th, a.band.en) + '</div>' +
      '<div class="bars" role="img" aria-label="PM2.5, past 7 days">' + hist.map(function (d) { return '<i title="' + d.date + ': ' + d.pm25 + '" style="height:' + Math.max(6, d.pm25 / mx * 100) + '%;background:' + d.band.colour + '"></i>'; }).join('') +
      '</div><div class="lab"><span>' + bi('7 วันก่อน', '7 days ago') + '</span><span>' + bi('เมื่อวาน', 'yesterday') + '</span></div>';
  }
}

/* ------------------------------------------------------------ NEAR */
var heroTimer = null;
function near() {
  var P = D.near && D.near.photos; if (!P) return;
  var hr = bkk(Date.now()).getUTCHours(), pool = hr < 5 || hr >= 19 ? 'night' : hr < 10 ? 'morning' : hr < 17 ? 'day' : 'dusk';
  P.forEach(function (r) { r.d = km(where.lat, where.lng, r.la, r.lo); r.sc = r.d + (r.q === 3 ? 0 : 1.2) + (r.pool && r.pool !== pool ? 0.4 : 0) + (r.k === 'merch' || /^ride-/.test(r.s) ? 0.8 : 0); });
  var sorted = P.slice().sort(function (a, b) { return a.sc - b.sc; }), picked = [];
  for (var i = 0; i < sorted.length && picked.length < 22; i++) {
    var r = sorted[i];
    if (!picked.some(function (q) { return km(q.la, q.lo, r.la, r.lo) < 0.03; })) picked.push(r);
  }
  var heroes = picked.filter(function (r) { return (r.w || 0) >= 1000 || r.k === 'hero'; }).slice(0, 5);
  if (!heroes.length) heroes = picked.slice(0, 5);
  var box = $('nearHero'), idx = 0;
  box.querySelectorAll('img').forEach(function (im) { im.remove(); });
  heroes.forEach(function (r, i) { var im = new Image(); im.alt = ''; im.decoding = 'async'; im.src = LIVE + r.img; if (i === 0) im.className = 'on'; box.insertBefore(im, box.firstChild); });
  var imgs = box.querySelectorAll('img');
  function title(r) { var t = r.k === 'hero' ? r.t.replace(/\s\d+$/, '') : r.t; return [r.th && r.th.length < 70 ? r.th : '', t]; }
  function cap(r) {
    var t = title(r), d = dir(where.lat, where.lng, r.la, r.lo);
    $('nearCap').innerHTML = '<div class="d">' + bi(far(r.d) + ' ทิศ' + d[0], farEn(r.d) + ' ' + d[1]) + '</div>' +
      '<a class="t" href="' + (r.u ? LIVE + r.u : LIVE + 'field/') + '">' + (t[0] ? bi(esc(t[0]), esc(t[1])) : esc(t[1])) + '</a>';
  }
  cap(heroes[0]);
  clearInterval(heroTimer);
  if (!REDUCED && heroes.length > 1) heroTimer = setInterval(function () {
    imgs[imgs.length - 1 - idx].classList.remove('on'); idx = (idx + 1) % heroes.length;
    imgs[imgs.length - 1 - idx].classList.add('on'); cap(heroes[idx]);
  }, 9000);
  $('nearFrom').innerHTML = fromWhere() + (where.how === 'gps' ? '' : ' · <a href="#" id="exact">' + bi('ตรงที่ฉันยืน', 'where I stand') + '</a>');
  var ex = $('exact'); if (ex) ex.onclick = function (e) { e.preventDefault(); precise(relocated); };
  $('nearStrip').innerHTML = picked.filter(function (r) { return heroes.indexOf(r) < 0; }).slice(0, 16).map(function (r) {
    var t = title(r);
    return '<a class="ph" href="' + (r.u ? LIVE + r.u : LIVE + 'field/') + '"><img loading="lazy" decoding="async" alt="" src="' +
      (r.thumb ? LIVE + r.thumb : LIVE + 'front/thumbs/' + r.s + '.webp') + '"><span class="c"><b>' + bi(far(r.d), farEn(r.d)) + '</b>' + (t[0] && t[1] ? bi(esc(t[0]), esc(t[1])) : esc(t[0] || t[1])) + '</span></a>';
  }).join('');
  drift($('nearStrip'));
}
function drift(el) {
  if (REDUCED || el._drift) return; el._drift = true;
  var held = false, v = 0.35, last = 0;
  ['pointerdown', 'wheel', 'touchstart', 'focusin'].forEach(function (e) { el.addEventListener(e, function () { held = true; }, { passive: true }); });
  (function go(t) {
    if (!held && el.scrollWidth > el.clientWidth) {
      el.style.scrollSnapType = 'none';
      if (t - last > 16) { el.scrollLeft += v; last = t; if (el.scrollLeft + el.clientWidth >= el.scrollWidth - 1) v = -Math.abs(v); if (el.scrollLeft <= 0) v = Math.abs(v); }
    } else if (held) el.style.scrollSnapType = '';
    requestAnimationFrame(go);
  })(0);
}

/* ------------------------------------------------------------ SOON: the calendar
   Order within a day = what this reader is likely to want:
     completeness (how much of the record we hold)       × 1.0
     nearness to the reader (or Tha Phae Gate)           × 1.0
     readers' opens in the last 30 days (aggregate)      × 1.2
     this reader's own opens, saves, venues (personal)   × 1.5
     a picture +0.3, a weekly repeat −0.15
   A picture of its own sets how much is shown: feature, card, or one line. */
var ME = store('md-cal') || { cats: {}, venues: {}, saved: {}, hidden: {}, hideCats: {} };
function saveMe() { store('md-cal', ME); }
var CATMAP = {};
/* every beacon from this page carries the reader's arm of the A/B as its page: /ab/cal or /ab/map
   (a ?home= preview stays '/'); ab_home.py reads them */
var ARM = H.getAttribute('data-arm'), PG = ARM && !H.hasAttribute('data-ab-forced') ? '/ab/' + ARM : '/', TOLD = {};
function tell(e, k, once) {
  if (!ON_SITE || !navigator.sendBeacon || (once && TOLD[k])) return;
  TOLD[k] = 1;
  try { navigator.sendBeacon('/api/map', JSON.stringify({ pg: PG, ev: [{ e: e, k: k }] })); } catch (x) { }
}
function engaged() { if (PG !== '/') tell('open', 'ab:engaged', true); }
function beacon(k) { tell('open', 'ev:' + k.slice(0, 90)); engaged(); }
function score(e, maxN, maxC) {
  e.km = e.la != null ? km(where.lat, where.lng, e.la, e.lo) : null;
  var comp = e.have.length / 8, nr = e.km == null ? 0 : Math.max(0, 1 - e.km / 8);
  var agg = e.n ? Math.log(1 + e.n) / Math.log(1 + maxN) : 0;
  var thumb = 0; try { thumb = window.MDFB ? MDFB.mine('event:' + e.k) : 0; } catch (x) { }
  var pers = (ME.cats[e.c] || 0) / (maxC || 1) + (ME.saved[e.k] ? 1.5 : 0) + (ME.venues[e.v] ? 0.5 : 0) + thumb;
  e.sc = comp + nr + 1.2 * agg + 1.5 * pers + (e.img ? 0.3 : 0) - (e.rec ? 0.15 : 0);
  e.why = [];
  if (ME.saved[e.k]) e.why.push(['hot', 'จำไว้แล้ว', 'saved']);
  if (thumb > 0) e.why.push(['hot', 'คุณกดชอบ', 'you liked it']);
  if (e.km != null && e.km < 3) e.why.push(['', 'ใกล้ ' + far(e.km), farEn(e.km) + ' away', 'num']);
  if (e.n >= 3) e.why.push(['', 'คนเปิดดู ' + e.n + ' ครั้งเดือนนี้', 'opened ' + e.n + ' times this month']);
  if ((ME.cats[e.c] || 0) >= 2) e.why.push(['hot', 'คุณชอบ' + CATMAP[e.c].th, (CALNEXT ? 'you look at ' : 'you open ') + CATMAP[e.c].en.toLowerCase()]);
  if (e.have.length >= 7) e.why.push(['', 'ข้อมูลครบ', 'full details']);
  return e;
}
var FIELD_TH = { time: 'เวลา', end: 'เวลาจบ', venue: 'สถานที่', map: 'แผนที่', cost: 'ราคา', link: 'ลิงก์', about: 'รายละเอียด', picture: 'ภาพ' };
function meter(e) {
  var F = D.events.fields;
  return '<span class="meter" role="img" aria-label="details ' + e.have.length + ' of 8">' + F.map(function (f) { return '<i class="' + (e.have.indexOf(f) >= 0 ? 'on' : '') + '"></i>'; }).join('') + '</span>';
}
function art(cv, e, w, h) {            /* an illustration drawn from the kind of event, seeded by its name */
  cv.width = w; cv.height = h;
  var c = cv.getContext('2d'), r = rnd(hash(e.t)), HUE = { music: 280, dance: 330, wellness: 160, sport: 20, art: 45, learn: 200, food: 30, market: 0, social: 250, faith: 50, family: 120, other: 210 };
  var hue = (HUE[e.c] || 210) + (r() * 30 - 15), g = c.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, 'hsl(' + hue + ',55%,26%)'); g.addColorStop(1, 'hsl(' + (hue + 40) + ',60%,9%)');
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  c.lineCap = 'round'; var s = Math.min(w, h), i, x, y;
  function ink(a) { return 'hsla(' + (hue + r() * 60) + ',85%,72%,' + a + ')'; }
  if (e.c === 'music') for (i = 0; i < 7; i++) { c.strokeStyle = ink(0.5); c.lineWidth = 1 + r() * 2.5; c.beginPath(); for (x = 0; x <= w; x += 4) { y = h * (0.25 + i * 0.08) + Math.sin(x / (18 + i * 6) + i) * s * 0.08; x ? c.lineTo(x, y) : c.moveTo(x, y); } c.stroke(); }
  else if (e.c === 'dance') for (i = 0; i < 3; i++) { c.strokeStyle = ink(0.6); c.lineWidth = 2; c.beginPath(); for (var a = 0; a < 18; a += 0.1) { x = w * (0.3 + i * 0.2) + Math.cos(a) * a * s * 0.012; y = h * 0.5 + Math.sin(a) * a * s * 0.012; a ? c.lineTo(x, y) : c.moveTo(x, y); } c.stroke(); }
  else if (e.c === 'wellness') for (i = 1; i < 9; i++) { c.strokeStyle = ink(0.12 + i * 0.05); c.lineWidth = 1.5; c.beginPath(); c.arc(w / 2, h * 0.55, i * s * 0.06, 0, 7); c.stroke(); }
  else if (e.c === 'sport') for (i = 0; i < 16; i++) { c.strokeStyle = ink(0.5); c.lineWidth = 2 + r() * 3; x = r() * w; y = r() * h; c.beginPath(); c.moveTo(x, y); c.lineTo(x + s * 0.3, y - s * 0.12); c.stroke(); }
  else if (e.c === 'art') for (i = 0; i < 9; i++) { c.fillStyle = ink(0.35); c.beginPath(); c.ellipse(r() * w, r() * h, s * (0.05 + r() * 0.15), s * (0.03 + r() * 0.08), r() * 3, 0, 7); c.fill(); }
  else if (e.c === 'learn') { c.strokeStyle = ink(0.35); c.lineWidth = 1; for (x = 0; x < w; x += s * 0.08) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke(); } for (y = 0; y < h; y += s * 0.08) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); } c.fillStyle = ink(0.8); c.fillRect(w * 0.2, h * 0.3, w * 0.35, 3); c.fillRect(w * 0.2, h * 0.42, w * 0.5, 3); }
  else if (e.c === 'food') for (i = 0; i < 3; i++) { c.strokeStyle = ink(0.7); c.lineWidth = 3; c.beginPath(); c.arc(w * (0.28 + i * 0.22), h * 0.5, s * 0.1, 0, Math.PI); c.stroke(); c.lineWidth = 1.5; c.beginPath(); c.moveTo(w * (0.28 + i * 0.22), h * 0.4); c.bezierCurveTo(w * (0.25 + i * 0.22), h * 0.3, w * (0.31 + i * 0.22), h * 0.25, w * (0.28 + i * 0.22), h * 0.15); c.stroke(); }
  else if (e.c === 'market') for (i = 0; i < 6; i++) { c.fillStyle = ink(0.45); x = w * (0.08 + i * 0.16); c.beginPath(); c.moveTo(x, h * 0.62); c.lineTo(x + s * 0.08, h * 0.42); c.lineTo(x + s * 0.16, h * 0.62); c.fill(); c.fillRect(x + s * 0.075, h * 0.62, 2, h * 0.2); }
  else if (e.c === 'social') { var pts = []; for (i = 0; i < 11; i++) pts.push([r() * w, r() * h]); c.strokeStyle = ink(0.3); c.lineWidth = 1; pts.forEach(function (p, k) { pts.forEach(function (q, l) { if (l > k && Math.hypot(p[0] - q[0], p[1] - q[1]) < s * 0.45) { c.beginPath(); c.moveTo(p[0], p[1]); c.lineTo(q[0], q[1]); c.stroke(); } }); }); pts.forEach(function (p) { c.fillStyle = ink(0.9); c.beginPath(); c.arc(p[0], p[1], 4, 0, 7); c.fill(); }); }
  else if (e.c === 'faith') { c.fillStyle = ink(0.7); x = w / 2; c.beginPath(); c.moveTo(x - s * 0.18, h * 0.85); c.quadraticCurveTo(x, h * 0.35, x + s * 0.18, h * 0.85); c.fill(); c.beginPath(); c.moveTo(x - 3, h * 0.5); c.lineTo(x, h * 0.12); c.lineTo(x + 3, h * 0.5); c.fill(); for (i = 0; i < 12; i++) { c.strokeStyle = ink(0.15); c.beginPath(); c.moveTo(x, h * 0.2); c.lineTo(x + Math.cos(i / 12 * 6.28) * s, h * 0.2 + Math.sin(i / 12 * 6.28) * s); c.stroke(); } }
  else if (e.c === 'family') for (i = 0; i < 6; i++) { c.fillStyle = ink(0.6); x = r() * w; y = h * (0.2 + r() * 0.4); c.beginPath(); c.ellipse(x, y, s * 0.06, s * 0.075, 0, 0, 7); c.fill(); c.strokeStyle = ink(0.4); c.beginPath(); c.moveTo(x, y + s * 0.075); c.lineTo(x + 4, h); c.stroke(); }
  else for (i = 0; i < 60; i++) { c.fillStyle = ink(0.4); c.fillRect(r() * w, r() * h, 3, 3); }
}
function dayName(d) { var t = new Date(d + 'T12:00:00+07:00'); return [DAY_TH[t.getUTCDay()] + ' ' + t.getUTCDate() + ' ' + MON_TH[t.getUTCMonth()], DAY_EN[t.getUTCDay()] + ' ' + t.getUTCDate() + ' ' + MON_EN[t.getUTCMonth()]]; }
function evHtml(e, tier, day) {
  var C = CATMAP[e.c], s = at(e.s), dn = dayName(day);
  var crumbs = '<nav class="crumbs" aria-label="breadcrumb"><span>' + bi('เร็วๆ นี้', 'Soon') + '</span>›<button type="button" data-day="' + day + '">' + bi(dn[0], dn[1]) + '</button>›' +
    '<button type="button" data-cat="' + e.c + '">' + bi(C.th, C.en) + '</button>' + (e.ath ? '›<button type="button" data-area="' + esc(e.aen) + '">' + bi(e.ath, e.aen) + '</button>' : '') + '</nav>';
  var time = e.ad ? bi('ทั้งวัน', 'all day') : hhmm(s) + (e.e && e.e.slice(0, 10) === e.s.slice(0, 10) ? '–' + e.e.slice(11, 16) : '');
  var where_ = e.v ? esc(e.v) + (e.km != null ? ' · ' + bi(far(e.km), farEn(e.km), 'num') : '') : '';
  var why = e.why.length ? '<div class="why">' + e.why.map(function (w) { return '<span class="' + w[0] + '">' + bi(w[1], w[2], w[3]) + '</span>'; }).join('') + '</div>' : '';
  var pic = e.img ? '<img class="art" loading="lazy" alt="' + esc(e.alt || '') + '" src="' + LIVE + esc(e.img) + '">' : '<canvas class="art" aria-hidden="true" data-art="' + e.k + '"></canvas>';
  var head;
  if (tier === 'feature') head = pic + '<div><div class="tm">' + time + '</div><div class="tt">' + esc(e.t) + '</div><div class="meta">' + where_ + (e.cost ? ' · ' + esc(e.cost) : '') + meter(e) + '</div>' + (e.d ? '<div class="ds">' + esc(e.d) + '</div>' : '') + why + crumbs + '</div>';
  else if (tier === 'card') head = pic + '<div><div class="tm">' + time + '</div><div class="tt">' + esc(e.t) + '</div><div class="meta">' + where_ + meter(e) + '</div>' + (e.d ? '<div class="ds">' + esc(e.d) + '</div>' : '') + why + crumbs + '</div>';
  else head = '<div class="tm">' + time + '</div><div><div class="tt">' + esc(e.t) + '</div><div class="meta">' + where_ + '</div>' + why + '</div>';
  var d = e.km != null ? dir(where.lat, where.lng, e.la, e.lo) : null;
  var missing = D.events.fields.filter(function (f) { return e.have.indexOf(f) < 0; });
  var body = '<div class="evd">' + (e.d ? '<p>' + esc(e.d) + '</p>' : '') + (tier === 'row' ? crumbs : '') + '<dl class="facts">' +
    '<dt>' + bi('เมื่อ', 'When') + '</dt><dd>' + bi(dayName(day)[0], dayName(day)[1]) + ' · ' + time + (e.rec ? ' · ' + bi('ทุกสัปดาห์', 'weekly') : '') + '</dd>' +
    (e.v ? '<dt>' + bi('ที่', 'Where') + '</dt><dd>' + (e.vu ? '<a href="' + LIVE + e.vu + '">' + esc(e.v) + '</a>' : esc(e.v)) +
      (e.km != null ? ' · ' + bi(far(e.km) + ' ทิศ' + d[0], farEn(e.km) + ' ' + d[1]) + ' ' + fromWhere() : '') +
      (e.vp ? '<figure class="evvenue"><a href="' + LIVE + esc(e.vu) + '"><img loading="lazy" decoding="async" alt="' + esc(e.v) + '" src="' + LIVE + esc(e.vp) + '"></a>' +
        (e.vpb ? '<figcaption>' + (e.vpn ? bi('ใกล้ ๆ ' + e.vpn + ' ม.', 'nearby, ' + e.vpn + ' m') + ' · ' : '') + (e.vpl ? '<a href="' + esc(e.vpl) + '" rel="noopener">' + esc(e.vpb) + '</a>' : esc(e.vpb)) + '</figcaption>' : '') + '</figure>' : '') + '</dd>' : '') +
    (e.cost ? '<dt>' + bi('ราคา', 'Price') + '</dt><dd>' + esc(e.cost) + '</dd>' : '') +
    '<dt>' + bi('ข้อมูล', 'Details') + '</dt><dd>' + e.have.length + '/8' + meter(e) + (missing.length ? ' · ' + bi('ยังขาด ' + missing.map(function (f) { return FIELD_TH[f]; }).join(' '), 'missing ' + missing.join(', ')) : '') + '</dd>' +
    '</dl><div class="acts">' +
    (e.url || e.page ? '<a href="' + esc(e.page ? LIVE + e.page : e.url) + '" rel="noopener">' + (e.lk === 'host' && !e.page ? bi('เจ้าภาพ', 'the host') : bi('ดูต้นทาง', 'the source')) + ' ↗</a>' : '') +
    (e.la != null ? '<a href="' + mapHref(e) + '" data-dact="map" data-ek="' + esc(evKey(e)) + '">' + bi('แผนที่', 'map') + '</a>' : '') +
    (e.ad ? '' : '<a download="' + e.k + '.ics" href="' + ics(e) + '">' + bi('ลงปฏิทิน', 'add to calendar') + '</a>') +
    '<button type="button" data-save="' + e.k + '" class="' + (ME.saved[e.k] ? 'on' : '') + '" aria-pressed="' + (ME.saved[e.k] ? 'true' : 'false') + '">' + bi('จำไว้', 'keep') + '</button>' +
    '<button type="button" data-hide="' + e.k + '">' + bi('ไม่สนใจงานนี้', 'not for me') + '</button>' +
    '<button type="button" data-hidecat="' + e.c + '">' + bi('ซ่อน' + C.th + 'ทั้งหมด', 'hide all ' + C.en.toLowerCase()) + '</button>' +
    '</div></div>';
  var hrt = '<button type="button" class="hrt" data-save="' + e.k + '" aria-pressed="' + (ME.saved[e.k] ? 'true' : 'false') + '" aria-label="จำไว้ · keep" title="จำไว้ · keep">' +
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 7.9 3.6 4.5 7 4.5c2 0 3.6 1.2 5 3 1.4-1.8 3-3 5-3 3.4 0 5.6 3.4 4.3 6.8-1.8 4.6-9.3 9.2-9.3 9.2z"/></svg></button>';
  return '<details class="ev ' + tier + '" data-k="' + e.k + '" data-s="' + esc(e.s) + '"><summary>' + head + hrt + '</summary>' + body + '</details>';
}
/* the calendar's data has arrived, or the reader moved: the bands are cut again */
function cal() {
  var E = D.events; if (!E) return;
  E.cats.forEach(function (c) { CATMAP[c.k] = c; });
  month();
}
function arts(root, list) {
  document.querySelectorAll(root + ' canvas[data-art]').forEach(function (cv) {
    var e = list.filter(function (x) { return x.k === cv.dataset.art; })[0]; if (!e) return;
    var w = cv.closest('.feature') ? 800 : 200, h = cv.closest('.feature') ? 400 : 200;
    /* no picture of its own: the cover doodle it fits, still; else the kind's pattern */
    if (DOODLES.has(e.dd)) { cv.width = w; cv.height = h; DOODLES.draw(e.dd, cv.getContext('2d'), w, h, 4000, null, D.ridge); }
    else art(cv, e, w, h);
  });
}

/* ------------------------------------------------------------ THE CALENDAR: the stage's calendar (the A/B with the map) */
var MLIST = [], MVIEW = null, MF = { c: null }, MDAYS = [], CALAT = null, EVS = {};
/* the calendar's city; it follows the map's switch, and the map follows it */
var MCITY = ((document.querySelector('#now .mapcity button[aria-pressed="true"]') || { dataset: {} }).dataset.city) || 'cm';
var CITY_N = { cm: ['เชียงใหม่', 'Chiang Mai'], cr: ['เชียงราย', 'Chiang Rai'], pth: ['ปทุมธานี', 'Pathum Thani'], pp: ['พนมเปญ', 'Phnom Penh'] };
/* Pathum Thani and Phnom Penh (Nan, 2026-10-13: "just show me the PT view for when I'm there"): their calendar is theirs alone,
   and its button shows only when the map's switch is on that city */
var MAPSRC = { cm: '/sites/doodle-map/?embed=1', cr: '/sites/doodle-chiang-rai/?embed=1', pth: '/sites/doodle-pathum-thani/?embed=1', pp: '/sites/doodle-phnom-penh/?embed=1' };
function cityAt(lat, lng) { return lat < 12.5 && lng > 102 ? 'pp' : lat < 15 && lng > 100 ? 'pth' : lat > 19.5 ? 'cr' : 'cm'; }
var WD_TH = ['จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา'], WD_EN = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
function evKey(e) { return e.k + '|' + e.s; }
function evOf(el) { return el && EVS[el.dataset.k + '|' + el.dataset.s]; }
/* the quick picks: on now or within two hours; tonight from five; the weekend; what the reader keeps */
var VIEWS = { now: ['ตอนนี้', 'Now'], tonight: ['คืนนี้', 'Tonight'], weekend: ['สุดสัปดาห์', 'Weekend'], kept: ['ที่จำไว้', 'Kept'] };
function month(how) { return calNext(how); }
/* ------------------------------------------------------------ THE CALENDAR IN THREE BANDS (design, 2026-10-11)
   Only under ?cal=next (kept for the tab in sessionStorage md-cal-next). One calendar, ปฏิทิน · Calendar:
   TODAY (now to the end of today's night), NEXT 14 DAYS (tomorrow to day 14; the grid is its index and a tap
   opens that one day under it, her 2026-10-04 word) and PLAN AHEAD (day 15 to about seven months).
   Which band an event is in is MDWHEN.band; these only put what it keeps in order: time order inside a band,
   and the reader's fit (score) picks the five a day leads with. */
function nxByStart(a, b) { return at(a.s) - at(b.s) || (a.t < b.t ? -1 : a.t > b.t ? 1 : 0); }
/* TODAY: runs that began before today (a line each), then what is not over, by start */
function bandToday(evs, now) {
  var td = MW.dayOf(now), run = [], rows = [];
  evs.forEach(function (e) { if (MW.band(e, now) !== 'today') return; (MW.firstDay(e) < td ? run : rows).push(e); });
  return { run: run.sort(nxByStart), rows: rows.sort(nxByStart) };
}
/* NEXT 14 DAYS: day 1 to 14 after today, each event on its own first day, by start */
function bandNear(evs, now) {
  var t0 = at(MW.dayOf(now) + ' 12:00:00'), days = [], by = {}, i;
  for (i = 1; i <= 14; i++) { days.push(ymd(t0 + i * 864e5)); by[days[i - 1]] = []; }
  evs.forEach(function (e) { if (MW.band(e, now) === 'near') by[MW.firstDay(e)].push(e); });
  days.forEach(function (d) { by[d].sort(nxByStart); });
  return { days: days, by: by };
}
/* PLAN AHEAD: dated events from day 15 on, by start */
function bandAhead(evs, now) { return evs.filter(function (e) { return MW.band(e, now) === 'ahead'; }).sort(nxByStart); }
/* Order (Nan, 2026-10-11): rows by the reader's fit, a toggle to time order; the choice is kept in md-cal-order */
var ORDER = store('md-cal-order') === 'time' ? 'time' : 'fit';
function nxSort(evs) { return evs.slice().sort(ORDER === 'time' ? nxByStart : function (a, b) { return (b.sc || 0) - (a.sc || 0) || nxByStart(a, b); }); }
function nxPick(evs, n) { var o = nxSort(evs); return { top: o.slice(0, n), rest: o.slice(n) }; }
/* Monday of the week a date is in */
function nxWeek(d) { var t = at(d + ' 12:00:00'); return ymd(t - ((bkk(t).getUTCDay() + 6) % 7) * 864e5); }

/* a festival on the calendar of the city it is in: Chiang Mai's and Chiang Rai's as before, the national days
   on every Thai calendar, nothing Thai on Phnom Penh's */
function festHere(p) { return MCITY === 'pp' ? false : MCITY === 'pth' ? p === 'national' : p !== 'pth'; }
/* wan phra and festivals on a date: from when.json when it has arrived, else the older soon.json and sky.json */
function dayMarks(d) {
  var out = { wan: false, fest: [] }, W = D.when, m;
  if (W && W.items) {
    W.items.forEach(function (x) {
      if (x.kind === 'sky' && x.d === d && x.wan) { if (MCITY !== 'pp') out.wan = true; }
      else if (x.kind === 'fest' && d >= x.d0 && d <= x.d1 && festHere(x.prov)) out.fest.push(x);
    });
    return out;
  }
  m = D.sky && D.sky.days && D.sky.days[d] && D.sky.days[d].moon;
  if (m && m.wan_phra) out.wan = true;
  ((D.soon || {}).festivals || []).forEach(function (f) { if (d >= f.d0 && d <= f.d1) out.fest.push(f); });
  return out;
}
/* Find a room (Nan, 2026-10-11: a and b): the map with motdang's hotel layer on, by the calendar's city;
   and the paid booking link for that city when ahead.json's plan.room carries one */
function roomHref() {
  var c = MCITY === 'cr' ? ['cr', 19.9094, 99.8325] : MCITY === 'pth' ? ['pth', 14.0208, 100.5250] : ['cm', GATE[0], GATE[1]];
  return LIVE + 'map.html#12.4/' + c[1].toFixed(5) + '/' + c[2].toFixed(5) + '/' + c[0] + '-hotel';
}
function planOf() { return (D.ahead && D.ahead.plan) || {}; }
function roomBtns() {
  var P = planOf(), paid = P.room && P.room[MCITY];
  if (MCITY === 'pp') return '';
  return '<a class="chip room" href="' + roomHref() + '">' + bi('หาที่พัก', 'Find a room') + '</a>' +
    (paid ? '<a class="chip room paid" href="' + esc(paid.url) + '" rel="sponsored nofollow noopener" target="_blank" title="' + esc((P.paid || {}).en || '') + '">' + bi(esc(paid.th), esc(paid.en)) + '</a>' : '');
}
/* Find a guide (Nan, 2026-10-11: start with a, b on top when there): motdang.net Co.'s helpers for the city first,
   from plan.guide.helpers; then the Department of Tourism's licence register */
function guideBtns() {
  var G = planOf().guide || {}, hs = (G.helpers || []).filter(function (x) { return !x.city || x.city === MCITY; });
  if (MCITY === 'pp') return '';
  return hs.slice(0, 3).map(function (x) {
    return '<a class="chip guide" href="' + esc(x.url) + '" rel="noopener">' + bi(esc(x.th || x.en), esc(x.en)) + (x.price ? ' <i>฿' + esc(x.price) + '</i>' : '') + '</a>';
  }).join('') + (G.register ? '<a class="chip guide reg" href="' + esc(G.register) + '" rel="noopener" target="_blank">' + bi('เช็กใบอนุญาตไกด์', 'Check a guide’s licence') + '</a>' : '');
}
function nxBtn(e, a) {
  var k = esc(evKey(e));
  if (a === 'grab') return e.la != null ? '<a href="' + grabUrl(e) + '" rel="noopener">' + bi('ไปด้วย Grab', 'Grab there', 'stack') + '</a>' : '';
  if (a === 'invite') return '<button type="button" data-dact="share" data-ek="' + k + '">' + bi('ชวนเพื่อน', 'Invite', 'stack') + '</button>';
  if (a === 'keep') return '<button type="button" data-save="' + e.k + '" class="' + (ME.saved[e.k] ? 'on' : '') + '" aria-pressed="' + (ME.saved[e.k] ? 'true' : 'false') + '">' + bi('จำไว้', 'Keep', 'stack') + '</button>';
  if (a === 'ics') return e.ad ? '' : '<a download="' + e.k + '.ics" href="' + ics(e) + '">' + bi('ลงปฏิทิน', 'Add to calendar', 'stack') + '</a>';
  return '';
}
/* thumbs and a note on any item (feedback.js, window.MDFB); nothing when it has not loaded */
function fb(item) { try { return window.MDFB ? '<div class="nxfb">' + MDFB.html(item) + '</div>' : ''; } catch (x) { return ''; } }
/* the reason a row sits where it does: tucked into the opened card, small */
function nxWhy(e) {
  var w = e.why || [];
  return w.length ? '<p class="nxwhy">' + bi('ทำไมขึ้นตรงนี้: ', 'why here: ') + w.map(function (x) { return bi(x[1], x[2] === 'saved' ? 'kept' : x[2]); }).join(' · ') + '</p>' : '';
}
/* one row: its time large, the whole title, the place and the distance; the band's two buttons under it. A tap opens
   the card (evHtml's body: source, map, calendar, keep, not for me), the reason and the thumbs */
function nxRow(e, band, now, ix) {
  var s = span(e), st = at(e.s), on = band === 'today' && !e.ad && !!e.e && s[0] <= now, slot, bits = [], sameEnd = e.e && e.e.length > 10 && e.e.slice(0, 10) === e.s.slice(0, 10), u, acts;
  if (band === 'ahead') {
    u = dates(MW.firstDay(e), MW.firstDay(e));
    slot = '<span class="nxd">' + bi(u[0], u[1], 'stack') + '</span><span class="nxe">' + (e.ad ? bi('ทั้งวัน', 'all day') : hhmm(st)) + '</span>';
  } else if (e.ad) slot = '<span class="nxd">' + bi('ทั้งวัน', 'all day', 'stack') + '</span>';
  else if (on) {
    u = dates(ymd(s[1] - 1), ymd(s[1] - 1));
    slot = '<span class="nxu">' + bi('ถึง', 'until') + '</span>' + (MW.dayOf(s[1] - 1) === MW.dayOf(now) ? hhmm(s[1]) : '<span class="nxd">' + bi(u[0], u[1], 'stack') + '</span>');
  } else slot = hhmm(st) + (sameEnd ? '<span class="nxe">–' + e.e.slice(11, 16) + '</span>' : '');
  if (e.v) bits.push(esc(e.v));
  if (e.km != null) bits.push(bi(far(e.km), farEn(e.km), 'num'));
  if (e.e && e.e.slice(0, 10) > e.s.slice(0, 10) && !(on && MW.dayOf(s[1] - 1) !== MW.dayOf(now))) { u = dates(e.e.slice(0, 10), e.e.slice(0, 10)); bits.push(bi('ถึง ' + u[0], 'until ' + u[1])); }
  acts = band === 'today' ? ['grab', 'invite'] : band === 'near' ? ['keep', 'invite'] : ['ics', 'invite'];
  return nxEv(e, band === 'today' ? ymd(Math.max(st, now)) : MW.firstDay(e), ix,
    '<summary class="nxs"><div class="nxt">' + slot + '</div><div class="nxb"><div class="tt">' + esc(e.t) + '</div>' +
    (bits.length ? '<div class="meta">' + bits.join(' · ') + '</div>' : '') +
    '</div><div class="nxa">' + acts.map(function (a) { return nxBtn(e, a); }).join('') + '</div></summary>');
}
/* the same card as the day list's: evHtml's details and body, our summary, then the reason and the thumbs */
function nxEv(e, day, ix, summary, cls) {
  return evHtml(e, 'row', day).replace('<details class="ev row"', '<details' + (ix != null ? ' style="--i:' + ix + '"' : '') + ' class="ev row nx' + (cls ? ' ' + cls : '') + '"')
    .replace(/<summary>[\s\S]*?<\/summary>/, function () { return summary; })
    .replace(/<\/details>$/, function () { return nxWhy(e) + fb('event:' + e.k) + '</details>'; });
}
/* a run in progress that began before today: one line, tappable */
function nxRun(e) {
  var u = e.e ? dates(e.e.slice(0, 10), e.e.slice(0, 10)) : null;
  return nxEv(e, MW.dayOf(Date.now()), null, '<summary class="nxs nxr"><span class="tt">' + esc(e.t) + '</span>' + (u ? ' <span class="nxu">· ' + bi('ถึง ' + u[0], 'until ' + u[1]) + '</span>' : '') + '</summary>', 'nxrun');
}
/* dated events past day 14: by fit as one list, or by time under a heading a week */
function nxWeeks(evs, now) {
  var h = '', wk = '', ix = 0;
  evs.forEach(function (e) {
    var w = nxWeek(MW.firstDay(e));
    if (ORDER === 'time' && w !== wk) { wk = w; h += '<h4 class="nxwk" data-wk="' + w + '">' + bi('สัปดาห์ ' + dates(w, w)[0], 'Week of ' + dates(w, w)[1]) + '</h4>'; }
    h += nxRow(e, 'ahead', now, ix++);
  });
  return h;
}
/* MINISITES IN THE CALENDAR (Nan 2026-10-11: each minisite once; dated ones on their day, the rest under the map).
   A dated minisite (sites.json on, or now) goes on its day: today, one of the 14, or later. One an event already
   links to stays that event's; one tied to a festival card (MS_FEST) is a chip on that card. */
var MS_FEST = { krathong: 'yi-peng-loi-krathong', 'khom-loi': 'yi-peng-loi-krathong' };
function msHref(s) { return /^https?:/.test(s.href) ? s.href : LIVE + s.href; }
function msCal(td, last) {
  var out = { today: [], day: {}, later: [] }, urls = {};
  if (!D.sites || MF.c || MVIEW === 'kept' || MCITY === 'pth' || MCITY === 'pp') return out;   // the dated minisites are the north's
  (D.events ? D.events.events : []).forEach(function (e) { if (e.url) urls[e.url.replace(/^https?:\/\/[^/]+\//, '')] = 1; });
  D.sites.forEach(function (s) {
    if (!(s.on || s.now) || urls[s.href] || MS_FEST[s.id] || (s.u && s.u < td)) return;
    var d = s.on && s.on > td ? s.on : td;
    if (d === td) out.today.push(s); else if (d <= last) (out.day[d] = out.day[d] || []).push(s); else out.later.push(s);
  });
  return out;
}
function msRow(s) {
  var on = s.on ? dates(s.on, s.on) : null;
  return '<a class="nxms" href="' + esc(msHref(s)) + '"><img alt="" loading="lazy" decoding="async" src="' + LIVE + esc(s.img) + '"><span class="tt">' + bi(esc(s.th), esc(s.en)) + '</span>' +
    '<small>' + bi('เว็บเล็ก' + (on ? ' · ' + on[0] : ''), 'minisite' + (on ? ' · ' + on[1] : '')) + '</small></a>';
}
function nxAhead(evs, now, msh) {
  var box = $('aheadwk'), ab = $('ahead'), CAP = 8;
  if (!box) { if (!ab) return; box = document.createElement('div'); box.id = 'aheadwk'; ab.parentNode.insertBefore(box, ab.nextSibling); }
  if (!evs.length && !msh) { box.innerHTML = ''; return; }
  evs = nxSort(evs);
  box.innerHTML = '<h4 class="nxsub">' + bi('งานหลังจากนั้น', 'Later events') + ' <small>' + evs.length + '</small></h4>' + (msh || '') + nxWeeks(evs.slice(0, CAP), now) +
    (evs.length > CAP ? '<details class="dmore"><summary>' + bi('อีก ' + (evs.length - CAP) + ' งาน', '+ ' + (evs.length - CAP) + ' more') + '</summary>' + nxWeeks(evs.slice(CAP), now) + '</details>' : '');
}
var NXAT = 0;
function calNext(how) {
  var E = D.events, g = $('mgrid'); if (!E || !g) return;
  how = how || {};
  /* the city-now tiles (sky, air, flights, roads, films) are Chiang Mai's and Chiang Rai's */
  var cn = $('cnow'); if (cn) cn.style.display = MCITY === 'pth' || MCITY === 'pp' ? 'none' : '';
  var now = Date.now(), td = MW.dayOf(now), maxN = 1, maxC = 0, all = [], cityN = { cm: 0, cr: 0, pth: 0, pp: 0 }, kinds = {}, nKept = 0, h, o = '';
  NXAT = now;
  E.cats.forEach(function (c) { CATMAP[c.k] = c; });
  E.events.forEach(function (e) { if (e.n > maxN) maxN = e.n; EVS[evKey(e)] = e; });
  Object.keys(ME.cats).forEach(function (k) { if (ME.cats[k] > maxC) maxC = ME.cats[k]; });
  E.events.forEach(function (e) {
    if (ME.hidden[e.k] || ME.hideCats[e.c] || !MW.band(e, now)) return;
    var c = e.city || 'cm'; cityN[c] = (cityN[c] || 0) + 1;
    if (c !== MCITY) return;
    score(e, maxN, maxC); all.push(e);
    kinds[e.c] = (kinds[e.c] || 0) + 1; if (ME.saved[e.k]) nKept++;
  });
  var pool = all.filter(function (e) { return (!MF.c || e.c === MF.c) && (MVIEW !== 'kept' || ME.saved[e.k]); });
  var tb = bandToday(pool, now), nb = bandNear(pool, now), ah = bandAhead(pool, now), days = nb.days, by = nb.by, ms = msCal(td, days[13]);
  MDAYS = days; MLIST = E.events;
  var tot = days.reduce(function (n, d) { return n + by[d].length; }, 0);
  /* the title, the city, the order, the filters: one state for all three bands */
  h = '<div class="mtopbar"><div class="nxtitle" role="heading" aria-level="2">' + bi('ปฏิทิน', 'Calendar') + '</div>' +
    '<span class="mcity" role="group" aria-label="เมือง · city">' + ['cm', 'cr'].concat(MCITY === 'pth' || MCITY === 'pp' ? [MCITY] : []).map(function (c) {
      return '<button type="button" data-mcity="' + c + '" aria-pressed="' + (MCITY === c) + '">' + bi(CITY_N[c][0], CITY_N[c][1]) + '<i class="badge-count">' + (cityN[c] || 0) + '</i></button>';
    }).join('') + '</span></div>';
  h += '<div class="mbar" role="toolbar" aria-label="เลือกดู · pick"><span class="mord" role="group" aria-label="ลำดับ · order">' +
    [['fit', 'สำหรับคุณ', 'For you'], ['time', 'ตามเวลา', 'By time']].map(function (x) { return '<button type="button" class="mq" data-morder="' + x[0] + '" aria-pressed="' + (ORDER === x[0]) + '">' + bi(x[1], x[2]) + '</button>'; }).join('') +
    '</span><span class="msep" aria-hidden="true"></span>' +
    (nKept || MVIEW === 'kept' ? '<button type="button" class="mq mkp" data-mview="kept" aria-pressed="' + (MVIEW === 'kept') + '"><b aria-hidden="true">♥</b>' + bi(VIEWS.kept[0], VIEWS.kept[1]) + '<i class="badge-count">' + nKept + '</i></button><span class="msep" aria-hidden="true"></span>' : '') +
    E.cats.filter(function (c) { return kinds[c.k]; }).sort(function (a, b) { return kinds[b.k] - kinds[a.k]; }).map(function (c) {
      return '<button type="button" class="mq" data-mcat="' + c.k + '" aria-pressed="' + (MF.c === c.k) + '"><s style="background:' + (CAT_PAPER[c.k] || CAT_PAPER.other) + '"></s>' + bi(c.th, c.en) + '<i class="badge-count">' + kinds[c.k] + '</i></button>';
    }).join('') + '</div>';
  /* TODAY */
  var dn0 = dayName(td), n0 = tb.rows.length, pk = nxPick(tb.rows, 5), ix = 0;
  h += '<section id="mtoday" aria-label="วันนี้ · today"><h3 class="nxh">' + bi('วันนี้', 'Today') + ' <small>' + bi(dn0[0], dn0[1]) + (n0 ? ' · ' + bi(n0 + ' งาน', n0 + ' events') : '') + '</small></h3>';
  h += tb.run.slice(0, 3).map(nxRun).join('');
  if (tb.run.length > 3) h += '<details class="dmore"><summary>' + bi('อีก ' + (tb.run.length - 3) + ' งานที่จัดอยู่', '+ ' + (tb.run.length - 3) + ' more on now') + '</summary>' + tb.run.slice(3).map(nxRun).join('') + '</details>';
  h += ms.today.map(msRow).join('');
  if (!n0) h += '<p class="nxnone">' + bi('ไม่มีงานเหลือวันนี้', 'Nothing left on today') + '</p>';
  pk.top.forEach(function (e) { h += nxRow(e, 'today', now, ix++); });
  if (pk.rest.length) h += '<details class="dmore"><summary>' + bi('อีก ' + pk.rest.length + ' งานวันนี้', '+ ' + pk.rest.length + ' more today') + '</summary>' + pk.rest.map(function (e) { return nxRow(e, 'today', now); }).join('') + '</details>';
  h += '</section>';
  g.innerHTML = h;
  /* NEXT 14 DAYS: a day at a time, three rows each and the rest folded */
  var dr = dates(days[0], days[13]), j = 0;
  o += '<h3 class="nxh">' + bi('14 วันถัดไป', 'Next 14 days') + ' <small>' + bi(dr[0] + ' · ' + tot + ' งาน', dr[1] + ' · ' + tot + ' events') + '</small></h3>';
  days.forEach(function (d) {
    var evs = by[d], dn = dayName(d), mk = dayMarks(d), msd = ms.day[d] || [], p2;
    if (!evs.length && !mk.wan && !mk.fest.length && !msd.length) return;
    p2 = nxPick(evs, 3);
    o += '<h4 class="nxday" id="nxd-' + d + '" data-day="' + d + '">' + bi(dn[0], dn[1]) + (evs.length ? ' <small>' + bi(evs.length + ' งาน', evs.length + (evs.length === 1 ? ' event' : ' events')) + '</small>' : '') +
      (mk.wan ? ' <span class="nxmk">' + bi('วันพระ', 'wan phra') + '</span>' : '') + mk.fest.map(function (f) { return ' <span class="nxmk hot">' + bi(esc(f.th), esc(f.en || f.th)) + '</span>'; }).join('') + '</h4>';
    o += msd.map(msRow).join('');
    p2.top.forEach(function (e) { o += nxRow(e, 'near', now, j++); });
    if (p2.rest.length) o += '<details class="dmore"><summary>' + bi('อีก ' + p2.rest.length + ' งาน', '+ ' + p2.rest.length + ' more') + '</summary>' + p2.rest.map(function (e) { return nxRow(e, 'near', now); }).join('') + '</details>';
  });
  if (!tot) o += '<p class="nxnone">' + bi('ยังไม่มีงานใน' + CITY_N[MCITY][0] + 'ช่วงนี้ในปฏิทิน', 'Nothing in ' + CITY_N[MCITY][1] + ' in the calendar for these two weeks yet') + '</p>';
  var md = $('mday');
  md.classList.remove('unfold', 'slide-l', 'slide-r');
  md.innerHTML = o;
  if (!REDUCED && how.anim) { void md.offsetWidth; md.classList.add(how.anim); }
  /* PLAN AHEAD: festival cards with their room and guide buttons, then later events */
  ahead();
  nxAhead(ah, now, ms.later.map(msRow).join(''));
  markAt();
}
/* a shared #ev= or the clock's Calendar button: the band that holds the event opens it. False when no band holds it (over, hidden, too far). */
function openNext(e) {
  var now = Date.now(), b = MW.band(e, now), k = String(e.k).replace(/[^a-z0-9-]/g, ''), sel, el, p;
  if (!b || ME.hidden[e.k] || ME.hideCats[e.c]) return false;
  if ((e.city || 'cm') !== MCITY) setCity(e.city || 'cm', true);
  if (H.getAttribute('data-stage') !== 'cal') stage('cal');
  if ((MF.c && MF.c !== e.c) || (MVIEW === 'kept' && !ME.saved[e.k])) { MF.c = null; MVIEW = null; }
  month();
  sel = (b === 'today' ? '#mtoday' : b === 'near' ? '#mday' : '#aheadwk') + ' details.ev[data-k="' + k + '"]';
  el = document.querySelector(sel + '[data-s="' + e.s + '"]') || document.querySelector(sel);
  if (!el) return false;
  p = el.closest('details.dmore'); if (p) p.open = true;
  el.open = true; el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
  setTimeout(function () { var r = el.getBoundingClientRect(), bh = (parseFloat(getComputedStyle(H).getPropertyValue('--barh')) || 50) + 10; scrollTo({ top: scrollY + r.top - bh - 40, behavior: REDUCED ? 'auto' : 'smooth' }); }, 30);
  return true;
}
/* #ev=<key> and #day=<date> under the flag */
function goNext(h) {
  var m, now = Date.now(), td = MW.dayOf(now);
  if ((m = /^ev=([a-z0-9-]+)$/.exec(h))) {
    var c = D.events.events.filter(function (x) { return x.k === m[1] && MW.band(x, now); }).sort(nxByStart)[0];
    return !!c && openNext(c);
  }
  if ((m = /^day=(\d{4}-\d{2}-\d{2})$/.exec(h))) {
    var d = m[1], gap = Math.round((dms(d) - dms(td)) / 864e5), el = null, bh;
    if (gap < 0 || gap > MW.AHEAD_DAYS) return false;
    if (H.getAttribute('data-stage') !== 'cal') stage('cal');
    if (gap === 0) el = $('mtoday');
    else if (gap <= 14) el = $('nxd-' + d) || $('mday');
    else {
      el = document.querySelector('#aheadwk [data-wk="' + nxWeek(d) + '"]') || $('aheadwk') || $('ahead');
      var p = el && el.closest('details.dmore'); if (p) p.open = true;
    }
    if (!el) return false;
    bh = (parseFloat(getComputedStyle(H).getPropertyValue('--barh')) || 50) + 10;
    setTimeout(function () { scrollTo({ top: scrollY + el.getBoundingClientRect().top - bh - 12, behavior: REDUCED ? 'auto' : 'smooth' }); }, 30);
    return true;
  }
  return false;
}
/* back on the page after a while: the bands are cut again from the clock */
document.addEventListener('visibilitychange', function () {
  if (CALNEXT && !document.hidden && D.events && Date.now() - NXAT > 600e3 && !document.querySelector('#month details[open]')) month();
});
/* the clock turned to another hour (null = now): the list shows that day, and what runs then is marked */
function markAt() {
  document.querySelectorAll('#mtoday details.ev, #mday details.ev').forEach(function (el) { var e = evOf(el), s = e && span(e); el.classList.toggle('at', !!(CALAT != null && s && s[0] <= CALAT && s[1] > CALAT)); });
}
function calAt(t) { CALAT = t; markAt(); }
/* a Plan ahead card's picture answers a tap (Nan, 2026-10-10: every graphic does something when tapped):
   the festival's own drawing, or paper confetti, thrown up from the finger */
var FXK = ['lantern', 'firework', 'umbrella', 'flower', 'water', 'cny'];
function fxAdd(list, x, y, k, seed) {
  list.push({ x: x, y: y, k: k, t0: performance.now(), r: rnd(seed >>> 0) });
  if (list.length > 6) list.shift();
}
function fxDraw(c, list, W, Hh) {
  var now = performance.now(), pal = Object.keys(CAT_PAPER).map(function (k) { return CAT_PAPER[k]; });
  for (var i = list.length - 1; i >= 0; i--) {
    var f = list[i], a = REDUCED ? 0.4 : (now - f.t0) / 2200;
    if (a >= 1) { list.splice(i, 1); continue; }
    if (!f.parts) { f.parts = []; for (var j = 0; j < (f.k === 'confetti' ? 18 : f.k === 'note' ? 7 : 4); j++) f.parts.push({ vx: f.r() - .5, vy: .55 + f.r() * .6, s: .7 + f.r() * .6, sp: (f.r() - .5) * 9, col: pal[(f.r() * pal.length) | 0] }); }
    f.parts.forEach(function (p, j) {
      var sz = Math.max(7, Hh * .09) * p.s, px, py;
      c.save(); c.globalAlpha = Math.max(0, 1 - a * a);
      if (f.k === 'confetti') { px = f.x + p.vx * W * .5 * a; py = f.y - p.vy * Hh * 1.1 * a + Hh * 1.3 * a * a; c.translate(px, py); c.rotate(p.sp * a); c.fillStyle = p.col; c.fillRect(-sz * .35, -sz * .16, sz * .7, sz * .32); }
      else if (f.k === 'note') { px = f.x + p.vx * W * .18 + Math.sin(a * 9 + j) * sz * .8; py = f.y - Hh * .85 * a * p.vy * 1.3; c.fillStyle = p.col; c.font = '700 ' + Math.round(sz * 1.7) + 'px Mali, Sarabun, sans-serif'; c.textAlign = 'center'; c.fillText(j % 2 ? '\u266A' : '\u266B', px, py); }
      else { px = f.x + p.vx * W * .22 * a; py = f.y - Hh * .9 * a * p.vy; glyph(c, f.k, px, py, sz * 1.2, now, p.s); }
      c.restore();
    });
  }
}
/* ------------------------------------------------------------ AHEAD: past the fortnight
   Nan, 2026-10-02: "do something snazzy to encourage planning further out, such as for a loy
   krathong visit, new years, songkran … also planning to bug out for smoke season". A ribbon of
   the months to come: the smoke as haze, its height the satellite fires seen on that day of the
   year, 2003–2024 (the Smoky Season's numbers); the festivals as small moving drawings. Below,
   a card each: days to go, add to calendar, the festival's page. */
function dms(d) { return at(d + ' 12:00:00'); }
function daysTo(d) { return Math.round((dms(d) - dms(ymd(Date.now()))) / 864e5); }
function icsDay(id, title, d0, d1, url) {
  var n = function (d) { return d.replace(/-/g, ''); };
  var t = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//motdang.net//front//EN', 'BEGIN:VEVENT', 'UID:' + id + '-' + d0 + '@motdang.net',
    'DTSTAMP:' + new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z', 'DTSTART;VALUE=DATE:' + n(d0), 'DTEND;VALUE=DATE:' + n(ymd(dms(d1) + 864e5)),
    'SUMMARY:' + title.replace(/[,;]/g, ' '), 'URL:https://motdang.net/' + url, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  return 'data:text/calendar;charset=utf-8,' + encodeURIComponent(t);
}
function dates(d0, d1) {
  var a = +d0.slice(8), ma = +d0.slice(5, 7) - 1, b = +d1.slice(8), mb = +d1.slice(5, 7) - 1;
  if (d0 === d1) return [a + ' ' + MON_TH[ma], a + ' ' + MON_EN[ma]];
  if (ma === mb) return [a + '–' + b + ' ' + MON_TH[ma], a + '–' + b + ' ' + MON_EN[ma]];
  return [a + ' ' + MON_TH[ma] + ' – ' + b + ' ' + MON_TH[mb], a + ' ' + MON_EN[ma] + ' – ' + b + ' ' + MON_EN[mb]];
}
/* one small drawing per kind, at (x, y), size s, time t, seed r */
function glyph(c, k, x, y, s, t, r) {
  var i, a, p;
  c.save();
  if (k === 'lantern') {
    y += Math.sin(t / 900 + r * 6) * s * 0.08;
    var g = c.createRadialGradient(x, y, 0, x, y, s * 1.5); g.addColorStop(0, 'rgba(255,170,60,.5)'); g.addColorStop(1, 'rgba(255,170,60,0)');
    c.fillStyle = g; c.fillRect(x - s * 1.5, y - s * 1.5, s * 3, s * 3);
    g = c.createLinearGradient(0, y - s * .55, 0, y + s * .5); g.addColorStop(0, '#ffe3a3'); g.addColorStop(1, '#ff8a3d');
    c.fillStyle = g; c.beginPath(); c.moveTo(x - s * .42, y - s * .55); c.lineTo(x + s * .42, y - s * .55); c.lineTo(x + s * .33, y + s * .5); c.lineTo(x - s * .33, y + s * .5); c.closePath(); c.fill();
    c.fillStyle = '#fff6d0'; c.beginPath(); c.arc(x, y + s * .5, s * .1 * (1 + .25 * Math.sin(t / 120 + r * 9)), 0, 7); c.fill();
  } else if (k === 'firework') {
    p = (t / 1700 + r) % 1; a = 1 - p;
    for (i = 0; i < 12; i++) {
      var an = i / 12 * 6.283 + r * 3, rr = s * 1.25 * (1 - Math.pow(1 - p, 3));
      c.strokeStyle = 'hsla(' + ((r * 360 + i * 30) % 360) + ',95%,68%,' + a + ')'; c.lineWidth = Math.max(1, s * .07);
      c.beginPath(); c.moveTo(x + Math.cos(an) * rr * .45, y + Math.sin(an) * rr * .45); c.lineTo(x + Math.cos(an) * rr, y + Math.sin(an) * rr); c.stroke();
      c.fillStyle = 'rgba(255,250,220,' + a + ')'; c.fillRect(x + Math.cos(an) * rr - 1, y + Math.sin(an) * rr - 1, 2, 2);
    }
  } else if (k === 'umbrella') {
    c.translate(x, y); c.rotate(Math.sin(t / 1300 + r * 5) * .12);
    var col = ['#e5567f', '#ffc266', '#4fae8c', '#4d8fd1'];
    for (i = 0; i < 8; i++) { c.fillStyle = col[(i + Math.floor(r * 4)) % 4]; c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, s * .8, Math.PI + i * Math.PI / 8, Math.PI + (i + 1) * Math.PI / 8); c.closePath(); c.fill(); }
    c.strokeStyle = '#e8d7b5'; c.lineWidth = Math.max(1, s * .07); c.beginPath(); c.moveTo(0, 0); c.lineTo(0, s * .75); c.arc(-s * .12, s * .75, s * .12, 0, Math.PI); c.stroke();
  } else if (k === 'flower') {
    c.translate(x, y); c.rotate(t / 4000 + r * 6);
    for (i = 0; i < 6; i++) { c.rotate(Math.PI / 3); c.fillStyle = i % 2 ? '#ff8fb1' : '#ffb3c9'; c.beginPath(); c.ellipse(0, -s * .42, s * .2, s * .38, 0, 0, 7); c.fill(); }
    c.fillStyle = '#ffd34d'; c.beginPath(); c.arc(0, 0, s * .2, 0, 7); c.fill();
  } else if (k === 'cny') {
    c.translate(x, y); c.rotate(Math.sin(t / 1100 + r * 4) * .1);
    c.fillStyle = '#ffc94a'; c.fillRect(-s * .22, -s * .55, s * .44, s * .1); c.fillRect(-s * .22, s * .45, s * .44, s * .1);
    c.fillStyle = '#d62d2d'; c.beginPath(); c.ellipse(0, 0, s * .58, s * .46, 0, 0, 7); c.fill();
    c.strokeStyle = 'rgba(255,201,74,.75)'; c.lineWidth = Math.max(1, s * .05);
    for (i = -1; i <= 1; i++) { c.beginPath(); c.ellipse(0, 0, s * .58 * Math.abs(i * .55 || .02), s * .46, 0, 0, 7); c.stroke(); }
    c.beginPath(); c.moveTo(0, s * .55); c.lineTo(Math.sin(t / 500 + r) * s * .08, s * 1.0); c.stroke();
  } else if (k === 'water') {
    for (i = 0; i < 3; i++) {
      p = (t / 900 + r + i / 3) % 1; var dx = x + (i - 1) * s * .45, dy = y - s * .8 + p * s * 1.4;
      c.fillStyle = 'rgba(127,200,255,' + (1 - p * .6) + ')'; c.beginPath(); c.moveTo(dx, dy - s * .28); c.quadraticCurveTo(dx + s * .2, dy, dx, dy + s * .12); c.quadraticCurveTo(dx - s * .2, dy, dx, dy - s * .28); c.fill();
    }
    p = (t / 900 + r) % 1; c.strokeStyle = 'rgba(127,200,255,' + (1 - p) + ')'; c.lineWidth = 1.5; c.beginPath(); c.ellipse(x, y + s * .7, s * .7 * p + 2, s * .18 * p + 1, 0, 0, 7); c.stroke();
  } else if (k === 'smoke') {
    for (i = 0; i < 4; i++) { p = (t / 6000 + r + i / 4) % 1; c.fillStyle = 'rgba(190,165,135,' + (.35 * (1 - p)) + ')'; c.beginPath(); c.arc(x - s * .6 + p * s * 1.2, y + s * .4 - p * s, s * (.3 + p * .4), 0, 7); c.fill(); }
  }
  c.restore();
}
/* a card's picture: the kind, many times, moving */
var SCENE_BG = { lantern: ['#0b1026', '#2a1840'], firework: ['#05070f', '#1b1238'], umbrella: ['#3b2412', '#7a4a22'], flower: ['#2a1630', '#5a2b4a'],
                 cny: ['#3a0a0a', '#7a1414'], water: ['#0a2a44', '#1c5c88'], smoke: ['#4a4038', '#8a7766'] };
function scene(cv, k, t, seed) {
  var w = cv.clientWidth, h = cv.clientHeight; if (!w) return;
  if (cv.width !== Math.round(w * DPR)) { cv.width = Math.round(w * DPR); cv.height = Math.round(h * DPR); }
  var c = cv.getContext('2d'), R = rnd(seed), bg = SCENE_BG[k] || SCENE_BG.lantern, g = c.createLinearGradient(0, 0, 0, h), i, x;
  c.setTransform(DPR, 0, 0, DPR, 0, 0); g.addColorStop(0, bg[0]); g.addColorStop(1, bg[1]); c.fillStyle = g; c.fillRect(0, 0, w, h);
  if (k === 'lantern') {
    c.fillStyle = 'rgba(255,246,220,.9)'; c.beginPath(); c.arc(w * .82, h * .28, h * .14, 0, 7); c.fill();
    for (i = 0; i < 9; i++) { var sp = .5 + R() * .7, ph = R(); x = R() * w; glyph(c, k, x + Math.sin(t / 2000 + i) * 6, h + 10 - ((t / 60 * sp + ph * (h + 30)) % (h + 30)), 6 + R() * 7, t, R()); }
    c.strokeStyle = 'rgba(255,200,120,.35)'; c.beginPath(); c.moveTo(0, h - 6); c.lineTo(w, h - 6); c.stroke();
  } else if (k === 'firework') { for (i = 0; i < 4; i++) glyph(c, k, w * (.15 + .7 * R()), h * (.25 + .4 * R()), 12 + R() * 14, t, R()); }
  else if (k === 'umbrella') { for (i = 0; i < 4; i++) glyph(c, k, w * (.14 + i * .24), h * .55, 16 + R() * 6, t, R()); }
  else if (k === 'flower') { for (i = 0; i < 6; i++) glyph(c, k, w * (.08 + i * .17), h * (.35 + .35 * R()), 10 + R() * 8, t, R()); }
  else if (k === 'cny') {
    c.strokeStyle = 'rgba(255,201,74,.6)'; c.beginPath(); c.moveTo(0, h * .12); c.quadraticCurveTo(w / 2, h * .32, w, h * .12); c.stroke();
    for (i = 0; i < 5; i++) { x = w * (.1 + i * .2); glyph(c, k, x, h * (.12 + .2 * Math.sin(Math.PI * x / w)) + h * .28, 11 + R() * 4, t, R()); }
  } else if (k === 'water') { for (i = 0; i < 7; i++) glyph(c, k, w * (.07 + i * .145), h * (.45 + .15 * R()), 12 + R() * 5, t, R()); }
  else if (k === 'smoke') {
    c.fillStyle = 'rgba(255,150,70,.55)'; c.beginPath(); c.arc(w * .75, h * .35, h * .16, 0, 7); c.fill();
    for (i = 0; i < 8; i++) glyph(c, k, w * R(), h * (.3 + .5 * R()), 18 + R() * 16, t, R());
  }
}
var AH = { on: false, raf: 0, sel: null, marks: [] };
function ahead() {
  var A = D.ahead, box = $('ahead'); if (!A || !box) return;
  if (MCITY === 'pth' || MCITY === 'pp') { box.innerHTML = ''; AH.all = []; return; }   // the north's festivals and smoke season
  var today = ymd(Date.now()), all = A.items.filter(function (x) { return x.d1 >= today; });
  if (A.smoke && A.smoke.d1 >= today) all.push(A.smoke);
  all.sort(function (a, b) { return a.d0 < b.d0 ? -1 : 1; });
  var h = '<h3 class="nxh">' + bi('วางแผนล่วงหน้า', 'Plan ahead') + ' <small>' + bi('ห้องพักและตั๋วหมดเร็ว', 'rooms and tickets go early') + '</small></h3><div id="ahcards">';
  all.forEach(function (x) {
    var n = daysTo(x.d0), dd = dates(x.d0, x.d1), smoke = x.kind === 'smoke', live = n <= 0;
    var when = live ? bi('ตอนนี้', 'now') : smoke ? bi('อีก <b>' + n + '</b> วันควันเริ่ม', 'smoke in <b>' + n + '</b> days') : bi('อีก <b>' + n + '</b> วัน', 'in <b>' + n + '</b> days');
    var ics = smoke ? icsDay('smoke', 'Bug out: smoke season (หนีควัน)', x.d0, x.d1, x.page) : icsDay(x.id, x.en + ' · ' + x.th, x.d0, x.d1, x.page);
    h += '<article class="ahc" id="ah-' + (x.id || 'smoke') + '" data-k="' + x.kind + '"><canvas class="ahv" aria-hidden="true"></canvas><div class="ahb">' +
      '<div class="ahn">' + when + '</div><div class="aht">' + bi(esc(x.th), esc(x.en)) + '</div>' +
      '<div class="ahd">' + bi(dd[0] + (smoke ? ' · หนักสุดราว ' + dates(x.peak, x.peak)[0] : x.usual ? ' · ตามปกติ' : ''), dd[1] + (smoke ? ' · worst around ' + dates(x.peak, x.peak)[1] : x.usual ? ' · usually' : '')) + '</div>' +
      '<p>' + bi(esc(x.lth), esc(x.len)) + '</p><div class="aha">' +
      (smoke ? '' : roomBtns() + guideBtns()) +
      (D.sites || []).filter(function (s) { return x.id && MS_FEST[s.id] === x.id; }).map(function (s) { return '<a class="chip" href="' + esc(msHref(s)) + '">' + bi(esc(s.th), esc(s.en)) + ' →</a>'; }).join('') +
      '<a class="chip" download="' + (x.id || 'smoke') + '.ics" href="' + ics + '">' + (smoke ? bi('ลงปฏิทินวันหนีควัน', 'mark the getaway') : bi('ลงปฏิทิน', 'add to calendar')) + '</a>' +
      '<a class="chip" href="' + LIVE + x.page + '">' + (smoke ? bi('ฤดูหมอกควัน', 'The Smoky Season') : bi('ดูงาน', 'the festival')) + ' →</a></div>' +
      fb(smoke ? 'site:smoky-season' : 'festival:' + x.id) + '</div></article>';
  });
  box.innerHTML = h + '</div>';
  AH.all = all;
  if (!AH.io && window.IntersectionObserver) {
    AH.io = new IntersectionObserver(function (e) { AH.on = e[0].isIntersecting; if (AH.on && !AH.raf) AH.raf = requestAnimationFrame(aheadFrame); }, { rootMargin: '60px' });
    AH.io.observe(box);
  }
  aheadFrame(performance.now());
}
function aheadFrame(t) {
  AH.raf = 0;
  if (!D.ahead) return;
  if (REDUCED) t = 4000;
  /* the card pictures */
  document.querySelectorAll('#ahcards .ahc').forEach(function (a, k) {
    var cv = a.querySelector('canvas'); scene(cv, a.dataset.k, t, 101 + k * 7919);
    var L = AH.fx && AH.fx[a.id]; if (L && L.length) { var cx = cv.getContext('2d'); cx.setTransform(DPR, 0, 0, DPR, 0, 0); fxDraw(cx, L, cv.clientWidth, cv.clientHeight); }
  });
  if (AH.on && !REDUCED && H.getAttribute('data-stage') === 'cal') AH.raf = requestAnimationFrame(aheadFrame);
}
function stage(s, byHand) {
  H.setAttribute('data-stage', s);
  ['cal', 'map'].forEach(function (k) { var t = $('tab-' + k); if (t) { t.setAttribute('aria-selected', String(k === s)); t.tabIndex = k === s ? 0 : -1; } });
  if (s === 'map') { var f = document.querySelector('#now iframe'); if (f && !f.getAttribute('src')) f.src = f.getAttribute('data-src'); }
  else if (AH.on && !AH.raf && D.ahead) AH.raf = requestAnimationFrame(aheadFrame);
  if (byHand) { tell('open', 'ab:to-' + s); engaged(); }
}
stage(H.getAttribute('data-stage') === 'cal' ? 'cal' : 'map');
if (PG !== '/') tell('view', 'ab:seen', true);
$('flip').addEventListener('click', function (ev) { var b = ev.target.closest('button[data-stage]'); if (b && b.dataset.stage !== H.getAttribute('data-stage')) stage(b.dataset.stage, true); });
$('flip').addEventListener('keydown', function (ev) {
  if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
  var s = H.getAttribute('data-stage') === 'cal' ? 'map' : 'cal'; stage(s, true); $('tab-' + s).focus();
});
$('ahead').addEventListener('click', function (ev) { if (ev.target.closest('a, canvas')) { tell('open', 'ab:ahead'); engaged(); } });
$('ahead').addEventListener('click', function (ev) {
  var cv = ev.target.closest && ev.target.closest('canvas.ahv'); if (!cv) return;
  var a = cv.closest('.ahc'), r = cv.getBoundingClientRect(); AH.fx = AH.fx || {};
  var L = AH.fx[a.id] = AH.fx[a.id] || [];
  fxAdd(L, ev.clientX - r.left, ev.clientY - r.top, FXK.indexOf(a.dataset.k) >= 0 ? a.dataset.k : 'confetti', hash(a.id + L.length + ev.clientX));
  if (REDUCED) { aheadFrame(4000); setTimeout(function () { L.length = 0; aheadFrame(4000); }, 1400); }
  else if (!AH.raf) AH.raf = requestAnimationFrame(aheadFrame);
});
/* the calendar's city; the map's switch is moved with it (and it with the map's) */
function setCity(c, byHand) {
  if (!MAPSRC[c]) return;
  MCITY = c; MVIEW = null;
  month({ anim: 'unfold' });
  if (D.ahead) ahead();
  if (!byHand) return;
  try { sessionStorage.setItem('md-map-city', c); } catch (x) { }
  var mb = document.querySelector('#now .mapcity button[data-city="' + c + '"]'), f = mapFrame();
  if (!mb || mb.getAttribute('aria-pressed') === 'true') return;
  if (f && f.getAttribute('src')) { mb.click(); return; }
  document.querySelectorAll('#now .mapcity button').forEach(function (b) { b.setAttribute('aria-pressed', String(b === mb)); });
  if (f) f.setAttribute('data-src', MAPSRC[c]);
}
(function () {
  var mc = document.querySelector('#now .mapcity'); if (!mc) return;
  mc.addEventListener('click', function (e) { var b = e.target.closest('button[data-city]'); if (b && b.dataset.city !== MCITY) setCity(b.dataset.city, false); });
})();
$('month').addEventListener('click', function (ev) {
  var b = ev.target.closest('button'); if (!b) return;
  if (b.dataset.mview != null) {
    ev.stopPropagation(); MVIEW = b.dataset.mview && MVIEW !== b.dataset.mview ? b.dataset.mview : null;
    month({ anim: 'unfold' }); engaged();
  } else if (b.dataset.morder) {
    ev.stopPropagation(); if (b.dataset.morder !== ORDER) { ORDER = b.dataset.morder; store('md-cal-order', ORDER); month(); tell('open', 'cal:order-' + ORDER); } engaged();
  } else if (b.dataset.mcat) {
    ev.stopPropagation(); MF.c = MF.c === b.dataset.mcat ? null : b.dataset.mcat; month(); engaged();
  } else if (b.dataset.mcity) { ev.stopPropagation(); if (b.dataset.mcity !== MCITY) { setCity(b.dataset.mcity, true); engaged(); } }
});
/* the rest of the A/B's counts: a first touch on the map, a link followed, the calendar below reached */
(function () {
  var f = document.querySelector('#now iframe');
  function hook() { try { f.contentWindow.document.addEventListener('pointerdown', function () { tell('open', 'ab:map-touch', true); engaged(); }, { once: true, capture: true }); } catch (x) { } }
  if (f) f.addEventListener('load', hook);
  document.addEventListener('click', function (ev) {
    var a = ev.target.closest && ev.target.closest('a[href]'); if (!a || /^#/.test(a.getAttribute('href'))) return;
    tell('open', 'ab:go', true); engaged();
  }, true);
})();
/* a card's buttons: its crumbs go to the day or the kind; keep, not for me and hide redraw the bands in place */
var CALBOX = '#mtoday, #mday, #aheadwk';
document.addEventListener('click', function (ev) {
  var b = ev.target.closest && ev.target.closest('button'); if (!b || !b.closest(CALBOX)) return;
  var popK = null;
  if (b.dataset.day) { ev.preventDefault(); goNext('day=' + b.dataset.day); return; }
  if (b.dataset.area) { ev.preventDefault(); return; }
  if (b.dataset.cat) { ev.preventDefault(); MF.c = b.dataset.cat; month(); $('month').scrollIntoView({ block: 'start', behavior: REDUCED ? 'auto' : 'smooth' }); return; }
  if (b.dataset.save) { ev.preventDefault(); ME.saved[b.dataset.save] = !ME.saved[b.dataset.save]; if (!ME.saved[b.dataset.save]) delete ME.saved[b.dataset.save]; saveMe(); engaged(); popK = ME.saved[b.dataset.save] ? b.dataset.save : null; }
  else if (b.dataset.hide) { ME.hidden[b.dataset.hide] = 1; saveMe(); }
  else if (b.dataset.hidecat) { ME.hideCats[b.dataset.hidecat] = 1; saveMe(); }
  else return;
  var open = [].map.call(document.querySelectorAll('#mtoday details[open], #mday details[open], #aheadwk details[open]'), function (d) { return ['#' + d.closest(CALBOX).id, d.dataset.k]; });
  /* the row tapped stays under the finger through the redraw */
  var anc = b.closest('details.ev'), ancSel = anc && '#' + anc.closest(CALBOX).id + ' details.ev[data-k="' + anc.dataset.k + '"][data-s="' + anc.dataset.s + '"]', y0 = anc && anc.getBoundingClientRect().top;
  cal();
  var na = ancSel && document.querySelector(ancSel); if (na) scrollBy(0, na.getBoundingClientRect().top - y0);
  open.forEach(function (k) { var d = k[1] && document.querySelector(k[0] + ' details[data-k="' + k[1] + '"]'); if (d) d.open = true; });
  if (popK && !REDUCED) document.querySelectorAll('.hrt[data-save="' + popK + '"]').forEach(function (h) { h.classList.add('pop'); });
});
document.addEventListener('toggle', function (ev) {
  var d = ev.target; if (!d.matches || !d.matches('#mtoday details.ev, #mday details.ev, #aheadwk details.ev') || !d.open) return;
  var e = evOf(d) || D.events.events.filter(function (x) { return x.k === d.dataset.k; })[0]; if (!e) return;
  ME.cats[e.c] = (ME.cats[e.c] || 0) + 1; if (e.v) ME.venues[e.v] = (ME.venues[e.v] || 0) + 1; saveMe();
  beacon(e.k);
  richEv(d);
}, true);
/* ------------------------------------------------------------ an event, opened: its scene, how long till, and ways to go */
function untilTxt(e, now) {
  now = now || Date.now();
  var s = span(e), m;
  function dur(ms) {
    var mn = Math.round(ms / 6e4), d = Math.floor(mn / 1440), h = Math.floor(mn % 1440 / 60), mi = mn % 60;
    if (d) return [d + ' วัน' + (h ? ' ' + h + ' ชม.' : ''), d + (d > 1 ? ' days' : ' day') + (h ? ' ' + h + ' h' : '')];
    if (h) return [h + ' ชม.' + (mi ? ' ' + mi + ' นาที' : ''), h + ' h' + (mi ? ' ' + mi + ' min' : '')];
    return [Math.max(1, mi) + ' นาที', Math.max(1, mi) + ' min'];
  }
  if (now < s[0]) { m = dur(s[0] - now); return ['อีก ' + m[0], 'in ' + m[1], 'soon']; }
  if (now < s[1]) {
    if (e.e) { m = dur(s[1] - now); return ['กำลังมีอยู่ · เหลืออีก ' + m[0], 'on now · ' + m[1] + ' left', 'on']; }
    m = dur(now - s[0]); return ['เริ่มไปแล้ว ' + m[0], 'started ' + m[1] + ' ago', 'on'];
  }
  return ['จบแล้ว', 'over', 'over'];
}
function cdHtml(e) { var u = untilTxt(e); return '<span class="cd ' + u[2] + '" data-cd="' + esc(evKey(e)) + '">' + bi(u[0], u[1]) + '</span>'; }
setInterval(function () {
  document.querySelectorAll('[data-cd]').forEach(function (el) { var e = EVS[el.dataset.cd]; if (!e) return; var u = untilTxt(e); el.className = 'cd ' + u[2]; el.innerHTML = bi(u[0], u[1]); });
}, 20e3);
function grabUrl(e) {
  var dp = 'grab://open?screenType=BOOKING&dropOffLatitude=' + (+e.la).toFixed(6) + '&dropOffLongitude=' + (+e.lo).toFixed(6) + '&dropOffAddress=' + encodeURIComponent(e.v || e.t);
  return 'https://grab.onelink.me/2695613898?af_dp=' + encodeURIComponent(dp) + '&af_web_dp=' + encodeURIComponent('https://www.grab.com/th/transport/');
}
function guideUrl(e) { var m = /^(c[mr])\/p\/([a-z0-9-]+)\.html$/.exec(e.vu || ''); return m ? LIVE + 'plan.html?stops=' + encodeURIComponent(m[1] + ':' + m[2]) + '&go=1' : ''; }
/* the ways to go, one row: the map up top, share, the turn-by-turn guide, a Grab */
function goActs(e) {
  var k = esc(evKey(e)), g = guideUrl(e);
  return (e.la != null ? '<button type="button" data-dact="map" data-ek="' + k + '">' + bi('บนแผนที่', 'on the map') + '</button>' : '') +
    '<button type="button" data-dact="share" data-ek="' + k + '">' + bi('แชร์', 'share') + '</button>' +
    (g ? '<a href="' + g + '">' + bi('นำทาง', 'guide me') + '</a>' : '') +
    (e.la != null ? '<a href="' + grabUrl(e) + '" rel="noopener">' + bi('เรียก Grab', 'Grab a ride') + '</a>' : '');
}
var EVX = { list: [], raf: 0, last: 0 };
function richEv(det) {
  var e = evOf(det), body = det.querySelector('.evd'); if (!e || !body || body.querySelector('.evx')) return;
  var box = document.createElement('div'); box.className = 'evx';
  /* a picture of its own already leads the card; a drawing goes only where there is none */
  var draw = !e.img && window.MDDOODLER && window.MDSKY;
  box.innerHTML = (draw ? '<canvas class="evdd" aria-hidden="true"></canvas>' : '') + '<p class="evcd">' + cdHtml(e) + '</p><div class="acts">' + goActs(e) + '</div>';
  body.insertBefore(box, body.firstChild);
  if (draw) { EVX.list.push({ cv: box.querySelector('canvas'), e: e, det: det, bg: null }); if (!EVX.raf) EVX.raf = requestAnimationFrame(evxFrame); }
}
function evxFrame(t) {
  EVX.raf = 0;
  EVX.list = EVX.list.filter(function (o) { return o.cv.isConnected && o.det.open; });
  var any = false;
  if (REDUCED || t - EVX.last >= 50) {
    EVX.last = t;
    EVX.list.forEach(function (o) {
      var r = o.cv.getBoundingClientRect(); if (r.bottom < 0 || r.top > innerHeight || !r.width) { if (o.bg) return; }
      any = true; try { evxDraw(o, REDUCED ? 4000 : t); } catch (er) { }
    });
  } else any = EVX.list.length > 0;
  if (!REDUCED && (any || EVX.list.length)) EVX.raf = requestAnimationFrame(evxFrame);
}
function evxDraw(o, t) {
  var cv = o.cv, W = cv.clientWidth, Hh = cv.clientHeight, dpr = Math.min(2, window.devicePixelRatio || 1), e = o.e;
  if (!W || !Hh) return;
  var pw = Math.round(W * dpr), ph = Math.round(Hh * dpr);
  var s = at(e.s), la = e.la != null ? e.la : where.lat, lo = e.lo != null ? e.lo : where.lng, alt = sunAlt(e.ad ? at(e.s.slice(0, 10) + ' 12:00:00') : s, la, lo), night = alt < -4;
  if (!o.bg || o.bg.width !== pw || o.bg.height !== ph) {
    var B = document.createElement('canvas'); B.width = pw; B.height = ph;
    var k = B.getContext('2d'); k.setTransform(dpr, 0, 0, dpr, 0, 0);
    var g = k.createLinearGradient(0, 0, 0, Hh), band = alt > 6 ? 0 : alt > -1 ? 1 : alt > -8 ? 2 : 3;
    g.addColorStop(0, ['#5f9fc2', '#b9617a', '#2a2650', '#121330'][band]); g.addColorStop(1, ['#8fbfd6', '#e39a7a', '#4b3a6b', '#1d1f3f'][band]);
    k.fillStyle = g; k.fillRect(0, 0, W, Hh);
    if (night) { var r = rnd(9); for (var i = 0; i < 30; i++) { k.fillStyle = 'rgba(255,246,214,' + (0.4 + 0.4 * r()) + ')'; k.fillRect(r() * W, r() * Hh * 0.45, 1.5, 1.5); } }
    window.MDSKY.landscape(k, W, Hh, { horizon: Hh * 0.6, night: night, pm25: 12, ridge: D.ridge, phone: W < 560, cr: la > 19.5, x0: W * 0.02, x1: W * 0.98 });
    o.bg = B;
  }
  if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; }
  var c = cv.getContext('2d'); c.setTransform(1, 0, 0, 1, 0, 0); c.drawImage(o.bg, 0, 0); c.setTransform(dpr, 0, 0, dpr, 0, 0);
  window.MDDOODLER.scene(c, W, Hh, t, { set: window.MDDOODLER.setOf(e), seed: hash(e.k + e.s), night: night, phone: W < 560, deck: Hh * 0.88, x0: W * 0.04, x1: W * 0.96,
    label: '', title: e.t + ' ' + (e.v || '') + ' ' + (e.d || '').slice(0, 160), alt: alt, now: s, lat: e.la, lng: e.lo });
}
addEventListener('mddoodler', function () { EVX.list.forEach(function (o) { o.bg = null; }); if (EVX.list.length && !EVX.raf) EVX.raf = requestAnimationFrame(evxFrame); });
function shareEv(e, b) {
  var url = 'https://motdang.net/#ev=' + e.k, dn = dayName(ymd(Math.max(at(e.s), Date.now())));
  var text = e.t + ' · ' + dn[1] + (e.ad ? '' : ' ' + e.s.slice(11, 16)) + (e.v ? ' · ' + e.v : '');
  function said() { var o = b.innerHTML; b.innerHTML = bi('คัดลอกลิงก์แล้ว', 'link copied'); setTimeout(function () { b.innerHTML = o; }, 1800); }
  if (navigator.share) navigator.share({ title: e.t, text: text, url: url }).catch(function () { });
  else if (navigator.clipboard) navigator.clipboard.writeText(text + ' ' + url).then(said, function () { });
}
/* the calendar, opened at an event: the band that holds it opens it */
function openInFortnight(e) { if (!openNext(e)) go('ev=' + e.k); }

/* ------------------------------------------------------------ the map up top, flown to (the doodle map's md-fly / md-at / md-spot) */
var MAPQ = null, MAPREADY = false, FLYOK = null;
/* does the loaded map answer md-fly? read from its own script (cached), so a map without it is reopened at the place instead */
function flyCheck() {
  try { var sc = mapFrame().contentDocument.querySelector('script[src*="map.js"]'); if (!sc) return;
    fetch(sc.src).then(function (r) { return r.text(); }).then(function (t) { FLYOK = t.indexOf('md-fly') >= 0; }, function () { }); } catch (x) { }
}
function mapFrame() { return document.querySelector('#now iframe'); }
function mapPost(m) { var f = mapFrame(); try { f.contentWindow.postMessage(m, location.origin); } catch (x) { } }
function mapFlush() { if (MAPQ && MAPREADY) { mapPost(MAPQ); MAPQ = null; } }
(function () {
  var f = mapFrame(); if (!f) return;
  try { if (f.getAttribute('src') && f.contentDocument && f.contentDocument.readyState === 'complete') { MAPREADY = true; flyCheck(); } } catch (x) { }
  f.addEventListener('load', function () { MAPREADY = true; if (FLYOK == null) flyCheck(); if (MAPQ) setTimeout(mapFlush, 700); });
})();
function flyTo(lat, lng, label, z) {
  var f = mapFrame(); if (!f || lat == null) { if (lat != null) location.href = LIVE + 'map.html#16/' + lat + '/' + lng; return; }
  MAPQ = { type: 'md-fly', lat: lat, lng: lng, z: z || 'street', label: label || null, pulse: true };
  /* a map not yet loaded opens at the place itself (?v=lat,lng,scale); a loaded one is flown there */
  var cc = cityAt(+lat, +lng), cb = document.querySelector('#now .mapcity button[data-city="' + cc + '"]');
  var vu = MAPSRC[cc].replace('?embed=1', '') + '?embed=1&v=' + (+lat).toFixed(5) + ',' + (+lng).toFixed(5) + ',' + (z === 'area' ? 12000 : 34000);
  if (cb && cb.getAttribute('aria-pressed') !== 'true') { MAPREADY = false; cb.click(); f.setAttribute('data-src', vu); if (f.getAttribute('src')) f.src = vu; }
  else if (!f.getAttribute('src')) { MAPREADY = false; f.setAttribute('data-src', vu); }
  else if (FLYOK !== true) { MAPREADY = false; f.src = vu; }
  if (H.getAttribute('data-stage') !== 'map') stage('map', true);
  $('stage').scrollIntoView({ block: 'start', behavior: REDUCED ? 'auto' : 'smooth' });
  mapFlush();
  engaged();
}
function flyEv(e) { if (e.la != null) flyTo(e.la, e.lo, { th: e.v || e.t, en: e.v || e.t }); }
var atTimer = 0, atLast = undefined;
function mapAt(t) {
  if (t === atLast || !MAPREADY || H.getAttribute('data-stage') !== 'map') return;
  clearTimeout(atTimer); atTimer = setTimeout(function () { atLast = t; mapPost({ type: 'md-at', t: t }); }, 120);
}
/* a spot tapped in the map: what it hosts in the next fourteen days, offered in a slip */
addEventListener('message', function (m) {
  var f = mapFrame();
  if (m.origin !== location.origin || !f || m.source !== f.contentWindow || !m.data || m.data.type !== 'md-spot') return;
  var d = m.data, now = Date.now(), path = String(d.href || '').replace(/^https?:\/\/[^/]+/, '').replace(/^\//, '');
  var ahead = (MLIST || []).filter(function (e) { var s = span(e); return s[1] > now && !ME.hidden[e.k] && MDAYS.indexOf(ymd(Math.max(s[0], now))) >= 0; });
  /* the spot's own page first; failing that, a venue within 60 m */
  var hits = ahead.filter(function (e) { return path && e.vu && path.indexOf(e.vu) >= 0; });
  if (!hits.length) hits = ahead.filter(function (e) { return e.la != null && d.lat != null && km(e.la, e.lo, d.lat, d.lng) < 0.06; });
  hits.sort(function (a, b) { return at(a.s) - at(b.s); });
  var slip = $('spotev');
  if (!slip) { slip = document.createElement('div'); slip.id = 'spotev'; slip.setAttribute('role', 'status'); document.body.appendChild(slip); }
  if (!hits.length) { slip.hidden = true; return; }
  slip.innerHTML = '<button type="button" class="x" aria-label="ปิด · close">×</button><b>' + bi('งานที่นี่', 'On here') + (d.name ? ' · ' + bi(esc(d.name.th || d.name.en || ''), esc(d.name.en || d.name.th || '')) : '') + '</b>' +
    hits.slice(0, 3).map(function (e) { var dn = dayName(ymd(Math.max(span(e)[0], now))); return '<button type="button" class="sp" data-dact="cal" data-ek="' + esc(evKey(e)) + '"><time>' + bi(dn[0].split(' ').slice(0, 2).join(' '), dn[1].split(' ').slice(0, 2).join(' ')) + (e.ad ? '' : ' ' + e.s.slice(11, 16)) + '</time> ' + esc(e.t) + ' →</button>'; }).join('');
  slip.hidden = false; clearTimeout(slip._t); slip._t = setTimeout(function () { slip.hidden = true; }, 15e3);
});
document.addEventListener('click', function (ev) {
  var x = ev.target.closest && ev.target.closest('#spotev .x'); if (x) { $('spotev').hidden = true; return; }
  var b = ev.target.closest && ev.target.closest('[data-dact]'); if (!b) return;
  var e = EVS[b.dataset.ek]; if (!e && b.dataset.dact !== 'fly') return;
  ev.preventDefault(); ev.stopPropagation();
  var a = b.dataset.dact;
  if (a === 'cal') { if ($('spotev') && b.closest('#spotev')) $('spotev').hidden = true; if (CLK && b.closest('#doodle')) CLK.shut(); openInFortnight(e); }
  else if (a === 'map') { if (CLK && b.closest('#doodle')) CLK.shut(); flyEv(e); }
  else if (a === 'share') shareEv(e, b);
  else if (a === 'pop' && CLK) CLK.pop(e, b);
  else if (a === 'fly') { if (CLK) CLK.shut(); var ll = b.dataset.ll.split(','); flyTo(+ll[0], +ll[1], { th: b.dataset.th || '', en: b.dataset.en || '' }); }
  engaged();
}, true);

/* ------------------------------------------------------------ TODAY: the doodle
   One event a day above the map, drawn with math (Nan, 2026-10-01: "a doodle
   prominently up top above the map that depicts a calendar event"). The day's
   pick is data/curated/doodles.json → front/doodle.json; a day without one
   draws its leading event from the event's kind (art(), the calendar's own). */
function mapHref(e) {
  if (e.la == null) return '';
  var m = /^(c[mr])\/p\/([a-z0-9-]+)\.html$/.exec(e.vu || '');
  return LIVE + 'map.html#16/' + e.la + '/' + e.lo + '//ev=1' + (m ? '&pin=' + m[1] + ':' + m[2] : '');
}
var DOODLES = window.MDDOODLES || { has: function () { return false; } };   /* doodles.js */
function doodleEvent() {
  var E = D.events; if (!E) return null;
  var now = Date.now(), today = ymd(now), pick = null, kind = '', set = '';
  var row = ((D.doodle || {}).days || []).filter(function (d) { return d.date === today; })[0];
  /* a key repeats across a weekly event's dates: today's own date is the one to weigh (2026-10-04: the key
     table held next Sunday's market, so a 109 km hike already under way beat the market 2 km off) */
  var byK = {};
  E.events.forEach(function (e) { var s = span(e); if (ymd(s[0]) === today || (!byK[e.k] && s[1] > now)) byK[e.k] = e; });
  if (row && row.opts && row.opts.length && window.MDDOODLER) {
    /* the day's choices: this reader gets the one most useful to them (doodler.js forReader); here and now
       first, so an option already over or a long ride away steps aside while a near one is still ahead */
    var seen = store('md-dd-seen') || {};
    var useful = row.opts.filter(function (o) { var e = byK[o.k]; return e && span(e)[1] > now && (e.la == null || km(where.lat, where.lng, e.la, e.lo) < 40); });
    var o = useful.length ? window.MDDOODLER.forReader(useful, byK, ME, where, now, seen) : null;
    if (o) { row = Object.assign({}, row, o); seen[o.set + (o.variant ? ':' + o.variant : '') + '@' + (o.version || 1)] = today; store('md-dd-seen', seen); }
    else row = null;
  }
  if (row) { pick = byK[row.k] || null; kind = row.kind; if (pick && span(pick)[1] <= now) pick = null; }
  if (!pick) {
    /* the day's leading event still ahead: a time, a venue we can pin, the most we know */
    var cand = E.events.filter(function (e) { var s = span(e); return ymd(s[0]) === today && s[1] > now && s[1] - s[0] < 30 * 3600e3; });
    var nearC = cand.filter(function (e) { return e.la == null || km(where.lat, where.lng, e.la, e.lo) < 40; });
    if (nearC.length) cand = nearC;
    /* a new drawing each day (Nan, 2026-10-02): the auto-doodler turns the scenes by date */
    var yd = ymd(now - 864e5), prev = E.events.filter(function (e) { var s = span(e); return ymd(s[0]) === yd && s[1] - s[0] < 30 * 3600e3; });
    var r2 = ((D.doodle || {}).days || []).filter(function (d) { return d.date === today; })[0], sets = (r2 && r2.sets) || {};
    cand.forEach(function (e) { if (sets[e.k] && !e.ds) e.ds = sets[e.k]; });
    if (window.MDDOODLER) { var ch = window.MDDOODLER.choose(cand, today, prev, (D.doodle || {}).aired || {}); pick = ch && ch.e; set = ch && ch.set;
      /* every scene for today has aired at its version: the day's own row, if it is still ahead */
      if (!pick) { var r0 = ((D.doodle || {}).days || []).filter(function (d) { return d.date === today; })[0], e0 = r0 && byK[r0.k];
        if (e0 && span(e0)[1] > now) { pick = e0; row = r0; set = r0.set; } }
      /* the bake chose this event's drawing with every scene file loaded; here only some are, so its choice
         stands (2026-10-12: the Clock Tower show drew as a classroom off "read" in its description) */
      var r1 = ((D.doodle || {}).days || []).filter(function (d) { return d.date === today; })[0],
        o1 = pick && r1 && (r1.opts || [r1]).filter(function (o) { return o.k === pick.k; })[0];
      if (o1) { row = Object.assign({}, r1, o1); set = o1.set; } }
    else { cand.sort(function (a, b) { return (DOODLES.has(b.dd) ? 1 : 0) - (DOODLES.has(a.dd) ? 1 : 0) || (b.have.length + (b.la != null ? 1 : 0)) - (a.have.length + (a.la != null ? 1 : 0)) || at(a.s) - at(b.s); }); pick = cand[0]; }
    if (!row || !pick || row.k !== pick.k) row = null;
    kind = pick ? pick.dd : '';
  }
  return pick ? { e: pick, kind: DOODLES.has(kind) ? kind : '', row: row, set: set } : null;
}
/* TODAY, drawn: the day's pick as the scene, the city's landscape and sights behind
   it (skyline.js), and the day as a small paper clock in the corner (Nan, 2026-10-02:
   the clock "shouldn't be the main feature … should take up 20% of doodle and the
   whole doodle should be interactive"). Every part answers a tap: the stage and its
   banner open the event, a sight opens a card about it, the clock opens today's
   calendar, a tag on the clock opens that hour's event.
   The clock: a 12-hour face read like any wall clock (Nan, 2026-10-11: the 24-hour
   dial "doesn't tell the correct time"); its ring is the next 12 hours from the hour
   hand round, light by day and dark by night, cut at sunrise and sunset where the reader
   is; the sun or tonight's moon rides the hour hand; the red ant walks the rim once a
   minute; blue drops are the rain hours and tags the events still ahead, both within
   those 12 hours;
   brass gears mesh behind at true ratios (12 teeth turn once a minute, 36 once in
   three, 20 once in 100 s). */
var TH_DIG = '๐๑๒๓๔๕๖๗๘๙';
function thd(s) { return String(s).replace(/\d/g, function (d) { return TH_DIG[d]; }); }
function enMode() { return H.classList.contains('lang-en'); }
function hourOf(t) { var b = bkk(t); return b.getUTCHours() + b.getUTCMinutes() / 60 + b.getUTCSeconds() / 3600; }
function dialA(h) { return -Math.PI / 2 + h / 12 * Math.PI * 2; }
/* the colour of the day, Sunday first (importers/make_fortune.py THAI_DAYS): the clock's rim wears it */
var DAY_HEX = ['#DC3D3D', '#F2D95C', '#EC6A9C', '#4FA96B', '#EE8B3C', '#5BB6E0', '#8C63C4'];
/* the hour as Thai says it: ตี before dawn, โมงเช้า, เที่ยง, บ่าย, โมงเย็น, ทุ่ม; [Thai, romanised, English] */
var NUM_TH = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า', 'สิบ', 'สิบเอ็ด'],
  NUM_RO = ['', 'nueng', 'song', 'sam', 'si', 'ha', 'hok', 'chet', 'paet', 'kao', 'sip', 'sip et'];
function hourWord(h) {
  h = Math.floor(h) % 24;
  if (h === 0) return ['เที่ยงคืน', 'thiang khuen', 'midnight'];
  if (h < 6) return ['ตี' + NUM_TH[h], 'ti ' + NUM_RO[h], h + ' at night'];
  if (h < 12) return [NUM_TH[h] + 'โมงเช้า', NUM_RO[h] + ' mong chao', h + ' in the morning'];
  if (h === 12) return ['เที่ยง', 'thiang', 'noon'];
  if (h === 13) return ['บ่ายโมง', 'bai mong', '1 in the afternoon'];
  if (h < 16) return ['บ่าย' + NUM_TH[h - 12] + 'โมง', 'bai ' + NUM_RO[h - 12] + ' mong', (h - 12) + ' in the afternoon'];
  if (h < 19) return [NUM_TH[h - 12] + 'โมงเย็น', NUM_RO[h - 12] + ' mong yen', (h - 12) + (h < 18 ? ' in the afternoon' : ' in the evening')];
  return [(h === 19 ? 'หนึ่ง' : NUM_TH[h - 18]) + 'ทุ่ม', NUM_RO[h - 18] + ' thum', (h - 12) + ' at night'];
}
function sunTimes(t) {
  var d0 = at(ymd(t) + ' 00:00:00'), rise = null, set = null, prev = sunAlt(d0, where.lat, where.lng);
  for (var m = 4; m <= 1440; m += 4) {
    var a = sunAlt(d0 + m * 6e4, where.lat, where.lng);
    if (prev < -0.83 && a >= -0.83 && rise == null) rise = d0 + (m - 4 + 4 * (-0.83 - prev) / (a - prev)) * 6e4;
    if (prev >= -0.83 && a < -0.83 && set == null) set = d0 + (m - 4 + 4 * (prev + 0.83) / (prev - a)) * 6e4;
    prev = a;
  }
  return { rise: rise, set: set };
}
function gearPath(cx, cy, N, rp, ang) {
  return function (c) {
    var ro = rp * (1 + 2.2 / N), ri = rp * (1 - 2.4 / N), k, a, s = Math.PI * 2 / N;
    c.beginPath();
    for (k = 0; k < N; k++) {
      a = ang + k * s;
      c.lineTo(cx + Math.cos(a - s * 0.32) * ri, cy + Math.sin(a - s * 0.32) * ri);
      c.lineTo(cx + Math.cos(a - s * 0.17) * ro, cy + Math.sin(a - s * 0.17) * ro);
      c.lineTo(cx + Math.cos(a + s * 0.17) * ro, cy + Math.sin(a + s * 0.17) * ro);
      c.lineTo(cx + Math.cos(a + s * 0.32) * ri, cy + Math.sin(a + s * 0.32) * ri);
    }
    c.closePath();
    for (k = 0; k < (N > 16 ? 5 : 0); k++) { a = ang + k * 6.2832 / 5; var hx = cx + Math.cos(a) * rp * 0.55, hy = cy + Math.sin(a) * rp * 0.55; c.moveTo(hx + rp * 0.2, hy); c.arc(hx, hy, rp * 0.2, 0, 6.2832); }
    c.moveTo(cx + rp * 0.12, cy); c.arc(cx, cy, rp * 0.12, 0, 6.2832);
  };
}
var CAT_PAPER = { music: '#9b6bd6', dance: '#e5567f', wellness: '#4fae8c', sport: '#e0773a', art: '#e2b33c', learn: '#4d8fd1', food: '#e58f3a', market: '#d94b3b', social: '#8a76d8', faith: '#d9a53c', family: '#69b45a', other: '#8a99a8' };
var CLK = null;
/* the band's other choices today: the day's doodle options, then today's other events still ahead and near,
   soonest first (‹ › and a sideways swipe walk them) */
function ddChoices(first) {
  var E = D.events; if (!E) return first ? [first] : [];
  var now = Date.now(), today = ymd(now), out = [], seen = {};
  function occ(k) { var b = null; E.events.forEach(function (e) { if (e.k === k && ymd(span(e)[0]) === today) b = e; }); return b; }
  function add(e, row, set) {
    if (!e || seen[e.k] || ME.hidden[e.k] || ME.hideCats[e.c] || span(e)[1] <= now || (e.la != null && km(where.lat, where.lng, e.la, e.lo) > 40)) return;
    seen[e.k] = 1; out.push({ e: e, row: row || null, set: set || '', kind: DOODLES.has(e.dd) ? e.dd : '' });
  }
  if (first) { seen[first.e.k] = 1; out.push(first); }
  var row = ((D.doodle || {}).days || []).filter(function (d) { return d.date === today; })[0];
  ((row && row.opts) || []).forEach(function (o) { add(occ(o.k), o, o.set); });
  E.events.filter(function (e) { var s = span(e); return ymd(s[0]) === today && s[1] - s[0] < 30 * 3600e3 && !e.ad && e.s.slice(11, 16) !== '00:00'; })
    .sort(function (a, b) { return at(a.s) - at(b.s); }).forEach(function (e) { add(e); });
  return out.slice(0, 9);
}
/* the fortnight, opened at a day (the clock's face) */
function openDay(d) { if (H.getAttribute('data-stage') !== 'cal') stage('cal', true); goNext('day=' + d); }
function doodle() {
  var SKY = window.MDSKY; if (!SKY) return;
  var paper = SKY.paper, jagPoly = SKY.jag, circ = SKY.circ;
  var x = doodleEvent(), box = $('ddtext'), cv = $('doodc'), pop = $('ddpop');
  var c = cv.getContext('2d'), lay = {}, hits = [], on = true, lastMin = -1, last = 0, L, T = null;
  var AT = null, SPRING = null, HOLD = 0, FX = { warp: 0, warpTo: 0, hop0: 0, slide0: 0, dir: 0, bits: [], rings: [] }, GEAR = { extra: 0, v: 0 }, ANT = { t0: 0 };
  var HAND = {}, GEARS = [], dropHits = [], HOV = null, lastT = 0, CH = ddChoices(x), CI = 0;
  function geom() {
    var W = cv.clientWidth, Hh = cv.clientHeight, phone = W < 640;
    var R = phone ? Math.min(W * 0.15, Hh * 0.14) : Math.min(Hh * 0.17, W * 0.075);
    return { W: W, H: Hh, phone: phone, R: R, cx: W - R * 1.3 - 6, cy: R * 1.3 + 6,
             horizon: Hh * (phone ? 0.6 : 0.62), deck: Hh * (phone ? 0.84 : 0.86), x0: phone ? 0 : W * 0.3 };
  }
  function size() { cv.width = cv.clientWidth * DPR; cv.height = cv.clientHeight * DPR; L = geom(); lastMin = -1; placeClk(); }
  function layer(name, draw) {
    var o = lay[name] || (lay[name] = document.createElement('canvas'));
    o.width = cv.width; o.height = cv.height; var k = o.getContext('2d'); k.setTransform(DPR, 0, 0, DPR, 0, 0); k.clearRect(0, 0, L.W, L.H); draw(k); return o;
  }
  function today() {
    var now = AT != null ? AT : Date.now(), d = ymd(now), sk = D.sky && D.sky.days && D.sky.days[d];
    return { now: now, d: d, st: rainState(now), a: air(), w: city(), moon: sk ? sk.moon : null, sun: sunTimes(now), alt: sunAlt(now, where.lat, where.lng) };
  }
  /* the light of the hour (Nan, 2026-10-03: "a night version when it's dark out, and a day version during
     the day"): the sun's height where the reader is picks the sky, the shade over the scene, the lamps */
  var SKYSTOPS = [[-12, '#141633', '#0b0c22'], [-6, '#3b3266', '#221f48'], [-0.5, '#e39a7a', '#b9617a'], [4, '#f0c08a', '#d98c6a'], [9, '#8fbfd6', '#5f9fc2']];
  function skyAt(alt, i) {
    var S = SKYSTOPS, n;
    if (alt <= S[0][0]) return hex(S[0][i]);
    for (n = 1; n < S.length; n++) if (alt <= S[n][0]) return mix(hex(S[n - 1][i]), hex(S[n][i]), (alt - S[n - 1][0]) / (S[n][0] - S[n - 1][0]));
    return hex(S[S.length - 1][i]);
  }
  function lightOf(alt) {
    var n = Math.max(0, Math.min(1, (-1 - alt) / 8));                 /* 0 by day, 1 once it is dark */
    var g = Math.max(0, 1 - Math.abs(alt - 2.5) / 6.5) * (1 - n);     /* the gold hour at either end of the day */
    return { n: n, g: g };
  }
  function weatherGrey() { var st = T.st || {}, code = T.w ? T.w.code : 0; return st.raining ? 0.55 : code >= 3 ? 0.3 : code >= 2 ? 0.12 : 0; }
  function smokeOf() { var pm = T.a ? T.a.pm25 : 10; return Math.min(0.7, Math.max(0, (pm - 12) / 130)); }
  function back(k) {
    var alt = T.alt, li = lightOf(alt), grey = weatherGrey(), sm = smokeOf();
    var sky = skyAt(alt, 1), deep = skyAt(alt, 2);
    sky = mix(sky, li.n > 0.5 ? hex('#262a36') : hex('#a4acb6'), grey); deep = mix(deep, li.n > 0.5 ? hex('#1a1d26') : hex('#7d8792'), grey);
    sky = mix(sky, li.n > 0.5 ? hex('#3a3024') : hex('#cdb48c'), sm * 0.8); deep = mix(deep, li.n > 0.5 ? hex('#2a2219') : hex('#b39a74'), sm * 0.6);
    k.fillStyle = rgb(deep); k.fillRect(0, 0, L.W, L.H);
    paper(k, function (q) { jagPoly(q, [[-4, -4], [L.W + 4, -4], [L.W + 4, L.horizon * 0.8], [-4, L.horizon * 0.86]], 5, 3); }, rgb(sky), 0.5);
    var see = li.n * (1 - grey * 1.4) * (1 - sm * 1.2);                 /* stars: as dark, clear and clean as it is */
    if (see > 0.05) { var r = rnd(9); k.save(); k.globalAlpha = Math.min(1, see); for (var i = 0; i < 46; i++) { var sx = r() * L.W, sy = r() * L.horizon * 0.62, s = 1.2 + r() * 2.2; paper(k, function (q) { q.beginPath(); q.moveTo(sx, sy - s * 1.6); q.lineTo(sx + s * 0.4, sy - s * 0.4); q.lineTo(sx + s * 1.6, sy); q.lineTo(sx + s * 0.4, sy + s * 0.4); q.lineTo(sx, sy + s * 1.6); q.lineTo(sx - s * 0.4, sy + s * 0.4); q.lineTo(sx - s * 1.6, sy); q.lineTo(sx - s * 0.4, sy - s * 0.4); q.closePath(); }, '#fff6d6', 0.3); } k.restore(); }
  }
  var landHits = [];
  function land(k) {
    landHits = SKY.landscape(k, L.W, L.H, { horizon: L.horizon, cr: where.lat > 19.5, night: T.alt < -4, pm25: T.a ? T.a.pm25 : 10,
      ridge: D.ridge, river: riverOn() ? riverLook() : null, phone: L.phone, x0: L.phone ? L.W * 0.02 : L.W * 0.3, x1: L.W * 0.98 });
  }
  /* ---- the Ping on its gauge and the week's fires (Nan, 2026-10-03). Off the same day (her word: "revisit when
     needed by events"); on by event since 2026-10-13 (C123 (b)): the river and its staff gauge while the Ping at the
     Nawarat Bridge stands at 75% of its alert level or higher, the fires from 15 January to 30 April. The lottery and
     the films moved to their own tiles (tiles.js). */
  var LIVE_RIVER_AT = 0.75;
  function riverOn() { var g = gauge(); return !!(g && g.level / g.limit >= LIVE_RIVER_AT); }
  function firesOn() {                                                  /* the smoky season's dates, by the Bangkok calendar */
    var b = new Date(Date.now() + 7 * 36e5), m = b.getUTCMonth() + 1, d = b.getUTCDate();
    return (m === 1 && d >= 15) || m === 2 || m === 3 || (m === 4 && d <= 30);
  }
  function liveLoad() {                                                 /* 300 bytes for the gauge; the fire counts only in season */
    j(LIVE + 'front/ping.json').then(function (d) { D.ping = d; lastMin = -1; }, function () { });
    if (firesOn()) j(LIVE + 'front/fires.json').then(function (d) { D.fires = d; lastMin = -1; }, function () { });
  }
  liveLoad();
  setInterval(function () { if (!document.hidden) j(LIVE + 'front/ping.json').then(function (d) { D.ping = d; lastMin = -1; }, function () { }); }, 30 * 6e4);
  function gauge() {                                                   /* the city's gauge, Nawarat Bridge */
    if (!D.ping || where.lat > 19.5) return null;
    var g = D.ping.stations.filter(function (q) { return q.id === (D.ping.city_station || 'P.1'); })[0];
    return g && g.level != null && g.limit ? g : null;
  }
  function riverLook() {
    var g = gauge(); if (!g) return null;
    var k = Math.min(1.3, g.level / g.limit), silt = Math.max(0, Math.min(1, (k - 0.45) / 0.5)), night = T.alt < -4;
    return { w: 10 * (0.55 + 1.3 * k), col: rgb(mix(hex(night ? '#2a4c7a' : '#4b8fc9'), hex(night ? '#5c4a30' : '#9a7a4a'), silt)), k: k };
  }
  var liveHits = [];
  function river(k, t) {                                               /* glints riding the current, and the staff gauge */
    var g = gauge(), rv = landHits.river; if (!g || !rv) return;
    var flow = g.dischg && g.dischg_limit ? Math.min(1.5, g.dischg / g.dischg_limit) : 0.2, sp = 0.012 + flow * 0.06, i;
    k.save(); k.strokeStyle = T.alt < -4 ? 'rgba(200,220,255,.45)' : 'rgba(255,255,255,.7)'; k.lineWidth = 1.3; k.lineCap = 'round';
    for (i = 0; i < 9; i++) {
      var h = hash('glint' + i), span = L.W + 40, gx = ((t * sp * (0.8 + (h % 7) / 14) + (h % 997) / 997 * span) % span) - 20;
      var gy = rv[0] + 2 + ((h >> 6) % 100) / 100 * (rv[1] - rv[0] - 3) + Math.sin(gx * 0.02) * 3, len = 4 + (h % 5);
      k.beginPath(); k.moveTo(gx, gy); k.lineTo(gx + len, gy); k.stroke();
    }
    k.restore();
  }
  function staff(k) {                                                  /* drawn over the stage, so a full scene keeps it */
    var g = gauge(), rv = landHits.river; if (!g || !rv) return;
    var top = g.limit * 1.25, G = L.phone ? 32 : 44, pw = 8, px = L.phone ? L.W * 0.06 : L.x0 + 24, base = rv[1] + 3, y = function (m) { return base - Math.min(top, m) / top * G; };
    paper(k, function (q) { q.beginPath(); q.rect(px - pw / 2, base - G, pw, G); }, '#f4efe2', 1.2);
    k.fillStyle = '#d94b3b'; k.fillRect(px - pw / 2, base - G, pw, y(g.limit) - (base - G));          /* the alert band, above the register's level */
    k.fillStyle = 'rgba(75,143,201,.85)'; k.fillRect(px - pw / 2, y(g.level), pw, base - y(g.level));  /* the water on the staff */
    k.strokeStyle = '#2b2116'; k.lineWidth = 1; k.beginPath();
    for (var m = 1; m < top; m++) { k.moveTo(px - pw / 2, y(m)); k.lineTo(px + (m % 2 ? 0 : pw / 2), y(m)); }
    k.stroke();
    k.fillStyle = '#fff'; k.font = '800 10px "Sarabun",system-ui,sans-serif'; k.textAlign = 'left'; k.textBaseline = 'middle';
    k.shadowColor = '#000'; k.shadowBlur = 3; k.fillText(g.level.toFixed(1) + (enMode() ? ' m' : ' ม.'), px + pw / 2 + 3, y(g.level)); k.shadowBlur = 0;
    liveHits.push({ k: 'river', href: LIVE + 'nam.html', x0: px - 10, x1: px + 34, y0: base - G - 4, y1: base + 4 });
  }
  function fireNow() {                                                  /* the latest satellite pass that saw anything */
    var F = D.fires; if (!F || !F.prov) return null;
    var p = where.lat > 19.5 ? 'cr' : 'cm', row = F.prov[p] || [], i;
    for (i = F.days.length - 1; i >= 0; i--) if (F.per_day[i] > 0) return { d: F.days[i], n: row[i] || 0, all: F.per_day[i], p: p };
    return null;
  }
  function fires(k, t) {                                               /* a paper flame on the hills for each fire seen in the province */
    var f = fireNow(); if (!f || !f.n || !landHits.ridgeAt) return;
    var n = Math.min(9, f.n), x0 = L.phone ? L.W * 0.1 : L.x0 + 30, x1 = L.cx - L.R * 1.5, li = lightOf(T.alt), i;
    for (i = 0; i < n; i++) {
      var h = hash('fire' + f.d + i), fx = x0 + ((i + 0.5) / n) * (x1 - x0) + ((h % 21) - 10), fy = landHits.ridgeAt(fx) + 3;
      var fl = REDUCED ? 1 : 1 + Math.sin(t / 130 + i * 1.7) * 0.12 + Math.sin(t / 61 + i) * 0.06, s = (L.phone ? 4 : 5.5) * (0.8 + (h % 5) / 10);
      if (li.n > 0.3) { var g = k.createRadialGradient(fx, fy - s, 0, fx, fy - s, s * 4); g.addColorStop(0, 'rgba(255,140,40,' + 0.35 * li.n + ')'); g.addColorStop(1, 'rgba(255,140,40,0)'); k.fillStyle = g; k.fillRect(fx - s * 4, fy - s * 5, s * 8, s * 8); }
      k.save(); k.globalAlpha = 0.5; k.strokeStyle = li.n > 0.5 ? '#9a96a8' : '#8a7d6a'; k.lineWidth = 1.2; k.beginPath(); k.moveTo(fx, fy - s * 2.4 * fl);
      for (var j = 1; j <= 6; j++) k.lineTo(fx + j * 2.2 + Math.sin(t / 700 + j + i) * 2, fy - s * 2.4 - j * 4); k.stroke(); k.restore();   /* its smoke thread, drifting east */
      (function (x, y, r, a) {
        paper(k, function (q) { q.beginPath(); q.moveTo(x, y - r * 2.6 * a); q.bezierCurveTo(x + r * 1.3, y - r * 1.2, x + r, y, x, y); q.bezierCurveTo(x - r, y, x - r * 1.3, y - r * 1.2, x, y - r * 2.6 * a); q.closePath(); }, '#ef6a2a', 0.6);
        paper(k, function (q) { q.beginPath(); q.moveTo(x, y - r * 1.5 * a); q.bezierCurveTo(x + r * 0.6, y - r * 0.6, x + r * 0.5, y, x, y); q.bezierCurveTo(x - r * 0.5, y, x - r * 0.6, y - r * 0.6, x, y - r * 1.5 * a); q.closePath(); }, '#ffd65a', 0.4);
      })(fx, fy, s, fl);
    }
    liveHits.push({ k: 'fires', href: LIVE + 'sites/smoky-season/', x0: x0 - 10, x1: x1 + 10, y0: landHits.ridgeAt((x0 + x1) / 2) - 30, y1: L.horizon });
  }

  /* the clock face: cached a minute at a time */
  var tagHits = [];
  function dial(k) {
    var R = L.R, cx = L.cx, cy = L.cy, en = enMode(), i, a;
    var rim = DAY_HEX[new Date(T.d + 'T12:00:00Z').getUTCDay()] || '#c9973f';
    paper(k, function (q) { circ(q, cx, cy, R * 1.13, 21); q.moveTo(cx + R * 0.99, cy); q.arc(cx, cy, R * 0.99, 0, 6.2832, true); }, rim, 2.2);
    paper(k, function (q) { circ(q, cx, cy, R, 22); }, '#f2e6c9', 1.6);
    /* the face is wichaa.net/moon's dial (Nan, 2026-10-12), disc and indices turned to the phase by its own gear (lunation.js),
       filling the face; the 12-hour day ring and its rain drops went with it (her word, the same day) */
    var luna = window.MDLUNA && MDLUNA.draw(k, cx, cy, R, T.now);
    /* before the disc loads, the ring: the next 12 hours, from the hour hand clockwise, cut at sunrise and sunset */
    if (!luna) {
    var rise = T.sun.rise ? hourOf(T.sun.rise) : 6, set = T.sun.set ? hourOf(T.sun.set) : 18, h0 = hourOf(T.now), cuts = [h0];
    [rise, set].forEach(function (b) { for (var o = -24; o <= 24; o += 24) if (b + o > h0 && b + o < h0 + 12) cuts.push(b + o); });
    cuts.sort(function (p, q) { return p - q; }); cuts.push(h0 + 12);
    for (i = 0; i + 1 < cuts.length; i++) (function (u, v) {
      var m = ((u + v) / 2) % 24, lit = m >= rise && m < set;
      paper(k, function (q) { q.beginPath(); q.arc(cx, cy, R * 0.95, dialA(u), dialA(v)); q.arc(cx, cy, R * 0.79, dialA(v), dialA(u), true); q.closePath(); }, lit ? '#f7d27a' : '#2b2f63', 1);
    })(cuts[i], cuts[i + 1]);
    k.fillStyle = 'rgba(40,25,10,.7)';
    for (i = 0; i < 12; i++) { a = dialA(i); k.save(); k.translate(cx + Math.cos(a) * R, cy + Math.sin(a) * R); k.rotate(a); k.fillRect(-(i % 3 ? R * 0.06 : R * 0.12), -0.9, i % 3 ? R * 0.06 : R * 0.12, 1.8); k.restore(); }
    }
    /* the numerals: on the paper face before the disc; on the dial's dark case, in cream, once it fills the face */
    var nr = luna ? R * 0.94 : R * 0.63;
    k.font = '800 ' + Math.max(9, Math.round(R * (luna ? 0.1 : 0.2))) + 'px ' + (en ? 'system-ui' : '"Sarabun",system-ui'); k.textAlign = 'center'; k.textBaseline = 'middle'; k.fillStyle = luna ? '#f4e8c9' : '#24170a';
    for (i = 0; i < 12; i += 3) { a = dialA(i); k.fillText(en ? String(i || 12) : thd(i || 12), cx + Math.cos(a) * nr, cy + Math.sin(a) * nr); }
    /* before the disc loads: tonight's moon in a window over the 6; on wan phra its frame is gold */
    if (T.moon && !luna) {
      var mo = T.moon, il = mo.illum == null ? 0.5 : mo.illum, side = mo.waxing ? 1 : -1, kk = 2 * il - 1, mx = cx, my = cy + R * 0.36, mr = R * 0.11;
      paper(k, function (q) { circ(q, mx, my, mr * 1.3, 10); }, mo.wan_phra ? '#e0a92a' : '#8a6a3a', 1.2);
      paper(k, function (q) { circ(q, mx, my, mr, 9); }, '#2b2f63', 0.8);
      if (il > 0.02) paper(k, function (q) { q.beginPath(); q.arc(mx, my, mr, -Math.PI / 2, Math.PI / 2, side < 0); q.ellipse(mx, my, mr * Math.abs(kk), mr, 0, Math.PI / 2, -Math.PI / 2, side > 0 ? kk < 0 : kk >= 0); q.closePath(); }, '#fff2c8', 0.6);
    }
    var hs = T.w && !luna ? T.w.hours || [] : [], k0 = hourKey(T.now); dropHits = [];
    hs.forEach(function (h) {
      var t = Date.parse(h[0] + ':00+07:00'); if (t <= T.now - 36e5 || t > T.now + 11 * 36e5 || !(h[1] >= 40 || h[2] >= 0.2)) return;
      var aa = dialA(hourOf(t) + 0.5), s = R * (0.035 + 0.035 * Math.min(1, h[1] / 100)), dx = cx + Math.cos(aa) * R * 0.87, dy = cy + Math.sin(aa) * R * 0.87;
      dropHits.push({ x: dx, y: dy, r: Math.max(11, s * 2.6), h: h, t: t });
      paper(k, function (q) { q.beginPath(); q.moveTo(dx, dy - s * 1.8); q.bezierCurveTo(dx + s * 1.2, dy - s * 0.3, dx + s, dy + s, dx, dy + s); q.bezierCurveTo(dx - s, dy + s, dx - s * 1.2, dy - s * 0.3, dx, dy - s * 1.8); q.closePath(); }, h[0] === k0 ? '#2f7fd6' : '#5aa6e8', 0.6);
    });
    /* events still ahead in the ring's 12 hours: small tags on threads at their hours, the pick first, then the soonest */
    tagHits = [];
    var E = (D.events && D.events.events) || [], pick = x && x.e;
    var todays = E.filter(function (e) { var s = at(e.s); return s > T.now && s < T.now + 12 * 36e5 && !e.ad && e.s.slice(11, 16) !== '00:00' && !ME.hidden[e.k] && !ME.hideCats[e.c]; });
    todays.sort(function (a, b) { return (b === pick) - (a === pick) || at(a.s) - at(b.s); });
    var used = {}, placed = 0;
    todays.forEach(function (e) {
      if (placed >= (L.phone ? 3 : 5)) return;
      var h = hourOf(at(e.s)), near = Object.keys(used).some(function (u) { var d = Math.abs(u - h) % 12; return Math.min(d, 12 - d) < 1.1; }); if (near) return; used[h] = 1;
      var aa = dialA(h), rr = R * 1.42, tx = cx + Math.cos(aa) * rr, ty = cy + Math.sin(aa) * rr, tw = R * 0.62, th = R * 0.26;
      if (tx - tw / 2 < 2 || tx + tw / 2 > L.W - 2 || ty - th / 2 < 2) return;
      placed++;
      k.strokeStyle = 'rgba(40,25,10,.55)'; k.lineWidth = 1; k.beginPath(); k.moveTo(cx + Math.cos(aa) * R * 1.12, cy + Math.sin(aa) * R * 1.12); k.lineTo(tx, ty); k.stroke();
      var rot = (hash(e.k) % 100 / 100 - 0.5) * 0.3;
      paper(k, function (q) { q.save(); q.translate(tx, ty); q.rotate(rot); jagPoly(q, [[-tw / 2, -th / 2], [tw / 2 - th * 0.3, -th / 2], [tw / 2, 0], [tw / 2 - th * 0.3, th / 2], [-tw / 2, th / 2]], hash(e.k), 1.2); q.restore(); }, CAT_PAPER[e.c] || CAT_PAPER.other, e === pick ? 2 : 1.2);
      k.save(); k.translate(tx, ty); k.rotate(rot); k.fillStyle = '#fff'; k.textAlign = 'center'; k.textBaseline = 'middle';
      k.font = '800 ' + Math.max(9, Math.round(th * 0.6)) + 'px ' + (en ? 'system-ui' : '"Sarabun",system-ui');
      var lbl = hhmm(at(e.s)); k.fillText((e === pick ? '★' : '') + (en ? lbl : thd(lbl)), -th * 0.1, 1); k.restore();
      tagHits.push({ x0: tx - tw / 2 - 4, x1: tx + tw / 2 + 4, y0: ty - th / 2 - 4, y1: ty + th / 2 + 4, k: e.k, e: e });
    });
  }
  function gears(k) {
    /* real seconds, plus a spin from a tap, plus an hour of the clock turned = one turn of the small wheel */
    var R = L.R, m = R * 0.019, s = Date.now() / 1000 + GEAR.extra + (AT != null ? (AT - Date.now()) / 6e4 : 0);
    var g1 = { N: 36, r: 36 * m, x: L.cx - R * 0.8, y: L.cy + R * 0.66 }, g2 = { N: 12, r: 12 * m }, g3 = { N: 20, r: 20 * m }, a12 = -2.5, a23 = -0.9;
    g2.x = g1.x + Math.cos(a12) * (g1.r + g2.r); g2.y = g1.y + Math.sin(a12) * (g1.r + g2.r);
    g3.x = g2.x + Math.cos(a23) * (g2.r + g3.r); g3.y = g2.y + Math.sin(a23) * (g2.r + g3.r);
    var th2 = s / 60 * 6.2832, th1 = -th2 * 12 / 36 + a12 * (1 + 12 / 36) + Math.PI / 36 + Math.PI, th3 = -th2 * 12 / 20 + a23 * (1 + 12 / 20) + Math.PI / 20 + Math.PI;
    paper(k, gearPath(g1.x, g1.y, g1.N, g1.r, th1), '#b07a2c', 1.5);
    paper(k, gearPath(g3.x, g3.y, g3.N, g3.r, th3), '#c48a3a', 1.5);
    paper(k, gearPath(g2.x, g2.y, g2.N, g2.r, th2), '#d9a54a', 1.8);
    GEARS = [g1, g2, g3];
  }
  function hands(k) {
    var R = L.R, cx = L.cx, cy = L.cy, h = hourOf(T.now), a = dialA(h), b = bkk(T.now), mins = b.getUTCMinutes() + b.getUTCSeconds() / 60 + (AT != null ? 0 : (T.now % 1000) / 6e4);
    var am = mins / 60 * 6.2832 - Math.PI / 2, sx = cx + Math.cos(a) * R * 0.5, sy = cy + Math.sin(a) * R * 0.5, w = Math.max(1.6, R * 0.03);
    paper(k, function (q) { q.beginPath(); q.moveTo(cx + Math.cos(am + 1.57) * w, cy + Math.sin(am + 1.57) * w); q.lineTo(cx + Math.cos(am) * R * 0.92, cy + Math.sin(am) * R * 0.92); q.lineTo(cx + Math.cos(am - 1.57) * w, cy + Math.sin(am - 1.57) * w); q.closePath(); }, '#3b2a14', 2);
    paper(k, function (q) { q.beginPath(); q.moveTo(cx + Math.cos(a + 1.57) * w * 1.8, cy + Math.sin(a + 1.57) * w * 1.8); q.lineTo(sx + Math.cos(a + 1.57) * w, sy + Math.sin(a + 1.57) * w); q.lineTo(sx + Math.cos(a - 1.57) * w, sy + Math.sin(a - 1.57) * w); q.lineTo(cx + Math.cos(a - 1.57) * w * 1.8, cy + Math.sin(a - 1.57) * w * 1.8); q.closePath(); }, '#24170a', 2.2);
    var sr = R * 0.13 * (AT != null ? 1.18 : 1);
    if (T.alt > -0.83) {
      var spin = Date.now() / 20000;
      paper(k, function (q) { q.beginPath(); for (var i = 0; i < 24; i++) { var rr = i % 2 ? sr : sr * 1.45, aa = spin + i / 24 * 6.2832; q.lineTo(sx + Math.cos(aa) * rr, sy + Math.sin(aa) * rr); } q.closePath(); }, '#f6a92c', 2.4);
      paper(k, function (q) { circ(q, sx, sy, sr * 0.8, 8); }, '#ffd65a', 1);
    } else {
      var mo = T.moon, il = mo ? mo.illum : 0.5, side = mo && !mo.waxing ? -1 : 1, kk = 2 * il - 1;
      paper(k, function (q) { circ(q, sx, sy, sr, 9); }, '#3a3f78', 2.4);
      if (il > 0.02) paper(k, function (q) { q.beginPath(); q.arc(sx, sy, sr, -Math.PI / 2, Math.PI / 2, side < 0); q.ellipse(sx, sy, sr * Math.abs(kk), sr, 0, Math.PI / 2, -Math.PI / 2, side > 0 ? kk < 0 : kk >= 0); q.closePath(); }, '#fff2c8', 0.8);
    }
    paper(k, function (q) { circ(q, cx, cy, R * 0.1, 12); }, '#c9973f', 2);
    /* the red ant walks the rim, the second hand of the real minute; a tap sends it sprinting a lap */
    var real = Date.now(), lap = 0;
    if (ANT.t0) { var u = (performance.now() - ANT.t0) / 1300; if (u >= 1) ANT.t0 = 0; else lap = (1 - Math.pow(1 - u, 3)) * 6.2832; }
    var as = ((real / 1000) % 60) / 60 * 6.2832 - Math.PI / 2 + lap, ax = cx + Math.cos(as) * R * 1.06, ay = cy + Math.sin(as) * R * 1.06, sc = R / 90 * (lap ? 1.25 : 1);
    HAND = { sx: sx, sy: sy, sr: sr, ax: ax, ay: ay };
    k.save(); k.translate(ax, ay); k.rotate(as + Math.PI / 2); k.scale(sc, sc);
    var step = Math.sin(real / (lap ? 22 : 70)) * 0.5;
    k.strokeStyle = '#5a0e08'; k.lineWidth = 1.1;
    for (var l = -1; l <= 1; l++) [-1, 1].forEach(function (sd) { k.beginPath(); k.moveTo(l * 3, 0); k.lineTo(l * 3 + (l + step * sd) * 2.5, sd * 6); k.stroke(); });
    k.beginPath(); k.moveTo(6, -1); k.quadraticCurveTo(10, -4, 11, -6); k.moveTo(6, 1); k.quadraticCurveTo(10, 4, 11, 6); k.stroke();
    paper(k, function (q) { q.beginPath(); q.ellipse(-6, 0, 4.2, 3.2, 0, 0, 6.2832); q.moveTo(2.4, 0); q.ellipse(0, 0, 2.4, 1.8, 0, 0, 6.2832); q.moveTo(7.6, 0); q.ellipse(5.4, 0, 2.2, 2, 0, 0, 6.2832); }, '#d3261b', 0.8);
    k.restore();
  }
  function clouds(k, t) {
    var code = T.w ? T.w.code : 0, st = T.st || {}, wet = st.raining, n = wet ? 6 : code >= 3 ? 4 : code >= 2 ? 3 : code >= 1 ? 2 : 1, i, r = rnd(17), li = lightOf(T.alt);
    var day = wet ? hex('#9aa3ad') : hex('#f4f1ea'), dark = wet ? hex('#3a3f55') : hex('#5d6390'), col = rgb(mix(mix(day, dark, li.n), hex('#f3b48a'), li.g * 0.45));
    for (i = 0; i < n; i++) {
      var w = (L.phone ? 60 : 100) * (0.7 + r() * 0.6) * (wet ? 1.3 : 1), y = 10 + r() * L.horizon * (wet ? 0.22 : 0.3), x0 = ((r() * (L.W + w * 2) + t / (900 + i * 300)) % (L.W + w * 2)) - w;
      paper(k, function (q) { q.beginPath(); q.moveTo(x0, y + w * 0.18); q.arc(x0 + w * 0.22, y + w * 0.1, w * 0.13, Math.PI, 0); q.arc(x0 + w * 0.48, y + w * 0.02, w * 0.2, Math.PI, 0); q.arc(x0 + w * 0.78, y + w * 0.1, w * 0.14, Math.PI, 0); q.lineTo(x0 + w * 0.92, y + w * 0.18); q.closePath(); }, col, 1.2);
    }
  }
  /* rain: paper drops by the hour's millimetres, slanting with the wind, a splash where each lands */
  function rain(k, t) {
    var st = T.st; if (!st || !st.raining) return;
    var mm = st.mm || 0.5, n = Math.round(Math.min(110, 22 + mm * 32)), sz = mm >= 2 ? 1.25 : mm < 0.5 ? 0.75 : 1, v = 0.22 + Math.min(0.2, mm * 0.05), night = lightOf(T.alt).n > 0.5;
    var col = night ? '#8fb3e0' : '#7fb6ee', ring = night ? 'rgba(170,200,240,.6)' : 'rgba(225,240,255,.85)', i;
    k.save(); k.lineWidth = 1.2;
    for (i = 0; i < n; i++) {
      var h = hash('drop' + i), land = L.deck - 4 + (h % 997) / 997 * (L.H - L.deck), span = land + 30, per = span / v;
      var ph = ((t + (h % 7919) / 7919 * per) % per) / per, y = -20 + ph * span, x = ((h % 1009) / 1009) * (L.W + 60) - ph * 26;
      if (y < land) {
        (function (dx, dy) { paper(k, function (q) { q.beginPath(); q.moveTo(dx + 1.6 * sz, dy - 8 * sz); q.quadraticCurveTo(dx + 4 * sz, dy + 1, dx, dy + 3 * sz); q.quadraticCurveTo(dx - 4 * sz, dy + 1, dx - 0.4 * sz, dy - 8 * sz); q.closePath(); }, col, 0.4); })(x, y);
      } else {
        var u = (y - land) / 30;                                       /* the splash: a ring widening, fading */
        k.strokeStyle = ring.replace(/[\d.]+\)$/, (1 - u).toFixed(2) + ')'); k.beginPath(); k.ellipse(x, land, 2 + u * 9 * sz, 0.8 + u * 2.4 * sz, 0, Math.PI, 0); k.stroke();
      }
    }
    k.restore();
    if (st.code >= 95 && !REDUCED) { if (Math.random() < 0.004) flash = 1; if (flash > 0) { k.fillStyle = 'rgba(255,255,255,' + flash * 0.45 + ')'; k.fillRect(0, 0, L.W, L.H); flash -= 0.08; } }
  }
  var flash = 0;
  /* haze: soft bands drifting between Doi Suthep and the city, as thick as the PM2.5 */
  function haze(k, t) {
    var pm = T.a ? T.a.pm25 : 0, a = Math.min(0.5, Math.max(0, (pm - 8) / 90)); if (a < 0.02) return;
    var li = lightOf(T.alt), col = mix(mix(hex('#e8dcc6'), hex('#464a5e'), li.n), hex('#f0b98c'), li.g * 0.5), i;
    for (i = 0; i < 4; i++) {
      var w = L.W * (0.55 + i * 0.12), y = L.horizon * (0.62 + i * 0.1), hh = L.H * (0.07 + i * 0.015);
      var x = ((t / (240 + i * 90) * (i % 2 ? -1 : 1) + i * L.W * 0.37) % (L.W + w) + (L.W + w)) % (L.W + w) - w * 0.5;
      var g = k.createRadialGradient(x, y, 0, x, y, w * 0.5); g.addColorStop(0, rgb(col, a * (0.9 - i * 0.12))); g.addColorStop(1, rgb(col, 0));
      k.save(); k.translate(x, y); k.scale(1, hh / (w * 0.5)); k.translate(-x, -y); k.fillStyle = g; k.beginPath(); k.arc(x, y, w * 0.5, 0, 6.2832); k.fill(); k.restore();
    }
    k.fillStyle = rgb(col, a * 0.35); k.fillRect(0, L.horizon * 0.5, L.W, L.horizon * 0.62);   /* the far air, all of it */
  }
  /* smoke: little paper puffs, more as the PM2.5 climbs, drifting east off the hills */
  function puffs(k, t) {
    var pm = T.a ? T.a.pm25 : 0, n = pm < 12 ? 0 : Math.min(14, Math.round((pm - 10) / 5)); if (!n) return;
    var li = lightOf(T.alt), body = rgb(mix(mix(hex('#d8c9ae'), hex('#5c586c'), li.n), hex('#f0b48a'), li.g * 0.4)), eye = li.n > 0.5 ? '#c9c2d8' : '#4a3a26', i;
    for (i = 0; i < n; i++) {
      var h = hash('puff' + i), s = (L.phone ? 10 : 14) + (h % 13), sp = 0.008 + (h % 31) / 31 * 0.01, span = L.W + s * 6;
      var x = ((t * sp + (h % 2003) / 2003 * span) % span) - s * 3, y = L.horizon * (0.18 + ((h >> 8) % 61) / 100) + Math.sin(t / 1300 + i) * s * 0.35 - (x / L.W) * s;
      (function (px, py, r) {
        paper(k, function (q) { q.beginPath(); q.moveTo(px - r * 1.1, py + r * 0.4); q.arc(px - r * 0.55, py + r * 0.05, r * 0.55, Math.PI * 0.75, Math.PI * 1.6); q.arc(px + r * 0.05, py - r * 0.25, r * 0.7, Math.PI * 1.1, Math.PI * 1.9);
          q.arc(px + r * 0.65, py + r * 0.1, r * 0.5, Math.PI * 1.4, Math.PI * 0.3); q.quadraticCurveTo(px, py + r * 0.65, px - r * 1.1, py + r * 0.4); q.closePath(); }, body, 0.7);
        var blink = Math.sin(t / 900 + i * 2.1) > 0.97 ? 0.2 : 1;
        k.fillStyle = eye; k.beginPath(); k.ellipse(px - r * 0.2, py, r * 0.07, r * 0.09 * blink, 0, 0, 6.2832); k.ellipse(px + r * 0.22, py, r * 0.07, r * 0.09 * blink, 0, 0, 6.2832); k.fill();
      })(x, y, s);
    }
  }
  /* night and the gold hour laid over the land and the stage; the clock stays its own colour */
  function shade(k, t) {
    var li = lightOf(T.alt); if (li.n < 0.02 && li.g < 0.02) return;
    var tint = mix(mix(hex('#ffffff'), hex('#ffd2a6'), li.g * 0.7), hex('#8e97cc'), li.n), top = L.horizon * 0.35;
    k.save(); k.globalCompositeOperation = 'multiply';
    var g = k.createLinearGradient(0, top, 0, L.horizon); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, rgb(tint));
    k.fillStyle = g; k.fillRect(0, top, L.W, L.horizon - top); k.fillStyle = rgb(tint); k.fillRect(0, L.horizon, L.W, L.H - L.horizon);
    k.restore();
    if (li.n > 0.3) {                                                  /* lamps on: a warm pool on the stage, glints in the city */
      k.save(); k.globalCompositeOperation = 'lighter';
      var sx = (L.x0 + L.W) / 2 + Math.sin(t / 2600) * 6, sy = L.deck - L.H * 0.12, R = (L.W - L.x0) * 0.42;
      var p = k.createRadialGradient(sx, sy, 0, sx, sy, R); p.addColorStop(0, 'rgba(255,170,80,' + 0.22 * li.n + ')'); p.addColorStop(1, 'rgba(255,170,80,0)');
      k.translate(sx, sy); k.scale(1, 0.45); k.translate(-sx, -sy); k.fillStyle = p; k.beginPath(); k.arc(sx, sy, R, 0, 6.2832); k.fill();
      k.restore();
    }
  }
  /* the stage: the pick's own scene; a kind without one hangs its doodle as a poster */
  var stageHits = [], poster = null;
  function stage(k, t) {
    if (!x) { stageHits = []; return; }
    var e = x.e, lbl = (x.row && (enMode() ? x.row.en : x.row.th)) || e.t, s = at(e.s);
    lbl = (e.ad || e.s.slice(11, 16) === '00:00' ? '' : hhmm(s) + ' · ') + (lbl.length > 30 ? lbl.slice(0, 29) + '…' : lbl);
    if (x.kind === 'latin-night' || x.set === 'latin') { stageHits = SKY.latinNight(k, L.W, L.H, t, { x0: L.x0, x1: L.W, deck: L.deck, phone: L.phone, label: lbl }); return; }
    /* any other pick: the auto-doodler's scene for it, seeded by the day (doodler.js) */
    var DD = window.MDDOODLER;
    if (DD) { stageHits = DD.scene(k, L.W, L.H, t, { set: (x.row && x.row.set) || x.set || DD.setOf(e), variant: x.row && x.row.variant, seed: DD.hash(T.d + e.k), x0: L.x0, x1: L.W, deck: L.deck, phone: L.phone,
      night: T.alt < -4, alt: T.alt, now: T.now, lat: e.la, lng: e.lo, avoid: { cx: L.cx, cy: L.cy, r: L.R * 1.9 }, label: lbl, title: e.t + ' ' + (e.v || '') + ' ' + (e.d || '').slice(0, 160) }); return; }
    var pw = Math.min(L.W * 0.36, 300), ph = pw * 0.62, px = L.phone ? L.W * 0.06 : L.W * 0.34, py = L.deck - ph - 6;
    if (!poster) {
      poster = document.createElement('canvas'); poster.width = pw * DPR; poster.height = ph * DPR;
      var pq = poster.getContext('2d'); pq.setTransform(DPR, 0, 0, DPR, 0, 0);
      if (x.kind && DOODLES.has(x.kind)) DOODLES.draw(x.kind, pq, pw, ph, 4000, T.moon, D.ridge); else art(poster, e, poster.width, poster.height);
    }
    paper(k, function (q) { jagPoly(q, [[px - 6, py - 6], [px + pw + 6, py - 6], [px + pw + 6, py + ph + 6], [px - 6, py + ph + 6]], 61, 1.5); }, '#f2e6c9', 2.4);
    k.drawImage(poster, px, py, pw, ph);
    k.fillStyle = 'rgba(7,9,13,.75)'; k.fillRect(px, py + ph - 24, pw, 24);
    k.fillStyle = '#fff'; k.font = '800 13px "Sarabun",system-ui,sans-serif'; k.textAlign = 'left'; k.textBaseline = 'middle'; k.fillText(lbl, px + 8, py + ph - 12);
    stageHits = [{ k: 'event', x0: px - 6, x1: px + pw + 6, y0: py - 6, y1: py + ph + 6 }];
  }
  /* what runs at a moment, today's short events and not the season-long ones */
  function onAt(t) {
    return ((D.events && D.events.events) || []).filter(function (e) { var s = span(e); return s[0] <= t + 30 * 60e3 && s[1] > t && s[1] - s[0] < 30 * 3600e3 && !e.ad && !ME.hidden[e.k] && !ME.hideCats[e.c]; })
      .sort(function (a, b) { return at(a.s) - at(b.s); });
  }
  function relTxt(t) {
    var m = Math.round((t - Date.now()) / 6e4), a = Math.abs(m), h = Math.floor(a / 60), mi = a % 60;
    var th = (h ? h + ' ชม.' : '') + (mi ? (h ? ' ' : '') + mi + ' นาที' : ''), en = (h ? h + ' h' : '') + (mi ? (h ? ' ' : '') + mi + ' min' : '');
    return !a ? ['ตอนนี้', 'now'] : m > 0 ? ['อีก ' + th, 'in ' + en] : [th + 'ที่แล้ว', en + ' ago'];
  }
  function atLabel(t) {
    var d = ymd(t), now = Date.now(), tom = d !== ymd(now), hr = +hhmm(t).slice(0, 2), r = relTxt(t), n = onAt(t).length;
    var w = tom ? ['พรุ่งนี้', 'tomorrow'] : hr >= 18 || hr < 4 ? ['คืนนี้', 'tonight'] : ['วันนี้', 'today'];
    return bi(w[0] + ' ' + hhmm(t), w[1] + ' ' + hhmm(t)) + ' <small>' + bi(r[0], r[1]) + (n ? ' · ' + bi(n + ' งาน', n + ' on') : '') + '</small>';
  }
  function words() {
    var e = x && x.e, cw = T.w, a = T.a, st = T.st, b = bkk(T.now), d = b.getUTCDate(), mo = b.getUTCMonth(), dw = b.getUTCDay(), turned = AT != null;
    var here = where.how === 'gps' ? ['ตรงที่คุณยืน', 'where you stand'] : where.how === 'network' ? ['ราวๆ ที่คุณอยู่', 'roughly where you are'] : ['ประตูท่าแพ', 'Tha Phae Gate'];
    var ct = cw ? [cw.th, cw.en] : ['เชียงใหม่', 'Chiang Mai'];
    var bits = [];
    if (turned) {
      /* the hour the clock is turned to: its rain, its sun, what is on */
      if (st && st.i >= 0) bits.push(st.raining || st.prob >= 50 ? bi('ฝนโอกาส ' + st.prob + '%' + (st.mm ? ' · ' + st.mm + ' มม.' : ''), 'rain ' + st.prob + '% likely' + (st.mm ? ' · ' + st.mm + ' mm' : '')) : bi('น่าจะแห้ง · ฝน ' + st.prob + '%', 'likely dry · rain ' + st.prob + '%'));
      var ons = onAt(T.now);
      bits.push(ons.length ? bi('ตอนนั้นมี', 'on then:') + ' ' + ons.slice(0, 3).map(function (q) { return '<a class="nr" href="#ev=' + q.k + '" data-dact="pop" data-ek="' + esc(evKey(q)) + '">' + q.s.slice(11, 16) + ' ' + esc(q.t.length > 28 ? q.t.slice(0, 27) + '…' : q.t) + '</a>'; }).join(', ') : bi('ตอนนั้นยังไม่มีงานในปฏิทิน', 'nothing in the calendar then'));
    } else {
      if (cw) { var wm = WMO[cw.code] || ['', '']; bits.push(bi(Math.round(cw.temp) + '° ' + wm[0], Math.round(cw.temp) + '° ' + wm[1].toLowerCase())); }
      if (a) bits.push(bi('PM2.5 ' + Math.round(a.pm25) + (a.band ? ' ' + a.band.th : ''), 'PM2.5 ' + Math.round(a.pm25) + (a.band ? ' ' + a.band.en.toLowerCase() : '')));
      if (st) {
        if (st.raining) bits.push(bi('ฝนตกอยู่' + (st.until ? ' ถึงราว ' + st.until.slice(11, 16) : ''), 'raining' + (st.until ? ' till about ' + st.until.slice(11, 16) : '')) +
          ' <a class="nr" href="#" data-nr>' + bi('ไม่ตก?', 'not raining?') + '</a>');
        else if (st.said) bits.push(bi('แห้ง ตามที่คุณบอก', 'dry, you said') + ' <a class="nr" href="' + LIVE + 'suggest.html?kind=correction&t=' +
          encodeURIComponent('front page: ') + '">' + bi('อะไรผิดอีก บอกเรา', 'anything else wrong? tell us') + ' →</a>');
        else if (st.next) bits.push(bi('ยังแห้ง ฝนน่าจะมาราว ' + st.next[0].slice(11, 16) + ' (' + st.next[1] + '%)', 'dry for now, rain likely about ' + st.next[0].slice(11, 16) + ' (' + st.next[1] + '%)'));
        else bits.push(bi('ฟ้าแห้ง', 'dry'));
      }
    }
    if (T.alt > -0.83 && T.sun.set && T.sun.set > T.now) bits.push(bi('ตะวันตก ' + hhmm(T.sun.set), 'sunset ' + hhmm(T.sun.set)));
    else if (T.sun.rise && T.sun.rise > T.now) bits.push(bi('ตะวันขึ้น ' + hhmm(T.sun.rise), 'sunrise ' + hhmm(T.sun.rise)));
    if (T.moon) bits.push(bi(T.moon.thai_label_th + (T.moon.wan_phra ? ' วันพระ' : ''), T.moon.thai_label_en + (T.moon.wan_phra ? ', wan phra' : '')));
    var hw = hourWord(hourOf(T.now)); bits.unshift(bi(hw[0], '<span lang="th">' + hw[0] + '</span> · ' + hw[1] + ' · ' + hw[2]));
    var tm = turned ? '<i>▸ ' + hhmm(T.now) + '</i>' : hhmm(T.now), rl = turned ? relTxt(T.now) : null;
    var h = '<div class="ddtop' + (turned ? ' turned' : '') + '"><div class="ddw">' + bi('วัน' + DAY_TH[dw] + ' ' + d + ' ' + MON_TH[mo] + ' · ' + tm + (rl ? ' (' + rl[0] + ')' : '') + ' · ' + ct[0] + ' ' + here[0],
      DAY_EN[dw] + ' ' + d + ' ' + MON_EN[mo] + ' · ' + tm + (rl ? ' (' + rl[1] + ')' : '') + ' · ' + ct[1] + ', ' + here[1]) +
      '</div><div class="ddnow">' + bits.join('<i> · </i>') + '</div>';
    if (a && !turned) {
      var su = suthep(a.pm25, T.alt < -4), km0 = Math.round(su.V);
      h += '<div class="ddair">' + bi(su.th + ' · มองได้ไกลราว ' + km0 + ' กม.', su.en + ' · you could see about ' + km0 + ' km') +
        ' <a href="https://nanobotco.github.io/rain-chiang-mai/">' + bi('เรดาร์ฝนสด', 'rain radar, live') + ' →</a>' +
        (smoky(a.pm25) ? ' <a href="' + LIVE + 'sites/smoky-season/">' + bi('ฤดูหมอกควัน', 'the smoky season') + ' →</a>' : '') + '</div>';
    }
    if (turned) h += '<div class="ddair"><a href="#" data-now>' + bi('↺ กลับมาตอนนี้', '↺ back to now') + '</a></div>';
    h += '</div>';
    if (e) {
      var s = at(e.s), night = +hhmm(s).slice(0, 2) >= 17, when = ymd(s) === ymd(Date.now()) ? (night ? ['คืนนี้', 'Tonight'] : ['วันนี้', 'Today']) : dayName(ymd(s));
      var time = e.ad || e.s.slice(11, 16) === '00:00' ? '' : ' ' + hhmm(s), k = esc(evKey(e));
      var th = x.row && x.row.th, enn = x.row && x.row.en || e.t, C = (D.events.cats.filter(function (q) { return q.k === e.c; })[0]) || { th: '', en: '' };
      var km1 = e.la != null ? km(where.lat, where.lng, e.la, e.lo) : null, map = mapHref(e);
      var nav = '';   /* the pager is gone (Nan, 2026-10-11): the day's other events are in the calendar's Today */
      h += '<div class="ddev"><div class="ddwhen">' + (CI ? '' : '★ ') + bi(when[0] + time, when[1] + time) + ' · ' + cdHtml(e) + nav + '</div>' +
        '<a class="ddt" href="#ev=' + e.k + '" data-dact="pop" data-ek="' + k + '">' + (th ? bi(esc(th), esc(enn), 'stack') : esc(enn)) + '</a>' +
        '<div class="ddv">' + (e.v ? esc(e.v) : '') + (km1 != null ? ' · ' + bi(far(km1), farEn(km1), 'num') : '') + (C.th ? ' · ' + bi(C.th, C.en) : '') + '</div>' +
        '<div class="ddacts"><a href="#ev=' + e.k + '" data-dact="cal" data-ek="' + k + '">' + bi('ในปฏิทิน', 'Calendar') + '</a>' + (map ? '<a class="q" href="' + map + '" data-dact="map" data-ek="' + k + '">' + bi('แผนที่', 'Map') + '</a>' : '') + '</div></div>';
    }
    box.innerHTML = h;
    label(e);
  }
  /* the picture's words for a screen reader: what the stage draws (data/curated/doodle_alt.json) and the
     event on its banner; words() runs when the event or the hour changes, so the label follows */
  var ALT = null;
  function label(e) {
    if (!ALT) ALT = fetch(LIVE + 'front/doodle_alt.json').then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; });
    ALT.then(function (A) {
      var a = (x && x.e ? A[ddSetOf(x).split(':')[0]] : null) || ['', ''], th = x && x.row && x.row.th, en = (x && x.row && x.row.en) || (e && e.t) || '';
      cv.setAttribute('aria-label', 'ภาพวาด' + (a[0] ? ': ' + a[0] : 'ของวันนี้') + (e ? ' · ป้าย: ' + (th || en) : '') +
        ' / Drawing' + (a[1] ? ': ' + a[1] : ' for today') + (e ? '; banner: ' + en : ''));
    });
  }
  /* one tap: believed at once, sent to the readers' rain gauge (obs_layer.py) with where we think they are */
  box.addEventListener('click', function (ev) {
    if (ev.target.closest && ev.target.closest('[data-now]')) { ev.preventDefault(); springBack(); return; }
    var a = ev.target.closest && ev.target.closest('[data-nr]'); if (!a) return;
    ev.preventDefault();
    try { localStorage.setItem(SAID, String(Date.now())); } catch (e) { }
    /* only a fix from this device is the reader's position; without one the rain worker reads the network's
       and files it as 'edge' — a network guess posted here was filed as 'reader' (Nan, 2026-10-20) */
    var body = { answer: 'none' }; if (where.how === 'gps') { body.lat = where.lat; body.lng = where.lng; }
    fetch('https://mot-dang-claims.nanobotco.workers.dev/rain', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(function () { });
    veil.set(0, T.a ? T.a.pm25 : 0);
    rebuild();
  });
  document.addEventListener('mdluna', function () { lastMin = -1; });   /* the disc's pictures have loaded: redraw the face */
  function rebuild() {
    T = today(); words();
    lay.back = layer('back', back);
    lay.land = layer('land', land);
    lay.dial = layer('dial', dial);
  }
  /* ---- taps answered in the picture: a hop, a quickened step, cut-paper confetti, a ring where a finger lands */
  function react(px, py) {
    if (REDUCED) return;
    var n = performance.now(), col = ['#e5567f', '#ffc266', '#4fae8c', '#4d8fd1', '#d9a23a', '#fff1c2', '#9b6bd6'];
    FX.warpTo = n + 1500; FX.hop0 = n;
    for (var i = 0; i < 30; i++) {
      var a = -Math.PI / 2 + (Math.random() - 0.5) * 2.6, v = 0.18 + Math.random() * 0.32;
      FX.bits.push({ x: px, y: py, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.02, w: 3 + Math.random() * 5, h: 6 + Math.random() * 7, col: col[i % col.length], t0: n });
    }
  }
  function ring(px, py) { if (!REDUCED) FX.rings.push({ x: px, y: py, t0: performance.now() }); }
  function confetti(k) {
    if (!FX.bits.length && !FX.rings.length) return;
    var n = performance.now();
    FX.bits = FX.bits.filter(function (b) { return n - b.t0 < 1700; });
    FX.bits.forEach(function (b) {
      var a = n - b.t0, u = a / 1700;
      k.save(); k.globalAlpha = 1 - u * u; k.translate(b.x + b.vx * a, b.y + b.vy * a + 0.00042 * a * a); k.rotate(b.r + b.vr * a); k.scale(Math.cos(a / 90 + b.r), 1);
      k.fillStyle = b.col; k.fillRect(-b.w / 2, -b.h / 2, b.w, b.h); k.restore();
    });
    FX.rings = FX.rings.filter(function (r) { return n - r.t0 < 900; });
    FX.rings.forEach(function (r) {
      var u = (n - r.t0) / 900;
      k.save(); k.strokeStyle = 'rgba(255,214,120,' + (1 - u).toFixed(2) + ')'; k.lineWidth = 1 + 3 * (1 - u); k.beginPath(); k.arc(r.x, r.y, 8 + u * 42, 0, 6.2832); k.stroke(); k.restore();
    });
  }
  /* the hovered thing, outlined as a cutting line */
  function glow(k) {
    var h = HOV; if (!h || drag) return;
    k.save(); k.strokeStyle = 'rgba(255,230,170,.95)'; k.lineWidth = 2; k.shadowColor = 'rgba(255,190,90,.95)'; k.shadowBlur = 10;
    k.setLineDash([6, 4]); k.lineDashOffset = -performance.now() / 50; k.beginPath();
    if (h.circ) k.arc(h.circ[0], h.circ[1], h.circ[2], 0, 6.2832);
    else { var b = h.box; k.rect(b.x0 - 2, b.y0 - 2, b.x1 - b.x0 + 4, b.y1 - b.y0 + 4); }
    k.stroke(); k.restore();
  }
  function paint(t) {
    var dt = lastT ? Math.min(100, Math.max(0, t - lastT)) : 0; lastT = t;
    if (SPRING) {
      var u = (performance.now() - SPRING.t0) / 650;
      if (u >= 1) { SPRING = null; AT = null; lastMin = -1; turned(); }
      else { var ee = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2; AT = Date.now() + (SPRING.from - Date.now()) * (1 - ee); lastMin = -1; }
    }
    var shown = AT != null ? AT : Date.now(), mn = Math.floor(shown / 6e4);
    if (mn !== lastMin) { lastMin = mn; rebuild(); }
    T.now = shown; T.alt = sunAlt(T.now, where.lat, where.lng);
    if (FX.warpTo > t) FX.warp += dt * 2.4;
    if (GEAR.v > 0.02) { GEAR.extra += dt / 1000 * GEAR.v; GEAR.v *= Math.pow(0.5, dt / 600); }
    var pn = performance.now(), hy = 0, sl = 1;
    if (FX.hop0) { var hu = (pn - FX.hop0) / 700; if (hu >= 1) FX.hop0 = 0; else hy = Math.abs(Math.sin(hu * Math.PI * 2)) * (1 - hu) * (L.phone ? 9 : 14); }
    if (FX.slide0) { sl = (pn - FX.slide0) / 380; if (sl >= 1) { FX.slide0 = 0; sl = 1; } }
    c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, cv.width, cv.height); c.drawImage(lay.back, 0, 0);
    c.setTransform(DPR, 0, 0, DPR, 0, 0); clouds(c, t);
    c.setTransform(1, 0, 0, 1, 0, 0); c.drawImage(lay.land, 0, 0);
    c.setTransform(DPR, 0, 0, DPR, 0, 0); liveHits = []; if (riverOn()) river(c, t); if (firesOn()) fires(c, t); haze(c, t);
    c.save();
    if (sl < 1) { var se = 1 - Math.pow(1 - sl, 3); c.globalAlpha = se; c.translate(FX.dir * (1 - se) * L.W * 0.16, 0); }
    if (hy) c.translate(0, -hy);
    stage(c, t + FX.warp); c.restore();
    shade(c, t); if (riverOn()) staff(c); puffs(c, t); rain(c, t); confetti(c); gears(c);
    c.setTransform(1, 0, 0, 1, 0, 0); c.drawImage(lay.dial, 0, 0);
    c.setTransform(DPR, 0, 0, DPR, 0, 0); hands(c); glow(c);
  }
  /* ---- the slips: paper cards that unfold where the finger landed */
  function showPop(html, px, py) {
    pop.innerHTML = '<button type="button" class="x" aria-label="ปิด · close">×</button>' + html;
    pop.hidden = false;
    pop.style.maxHeight = (L.H - 16) + 'px'; pop.style.overflowY = 'auto';   /* taller than the band: it scrolls inside */
    var w = pop.offsetWidth, h = pop.offsetHeight, lx = px - w / 2, ty = py - h - 14;
    /* a slip from the clock stays off the clock, so the next tap on it lands */
    if (Math.hypot(px - L.cx, py - L.cy) < L.R * 1.9) {
      if (L.cx - L.R * 1.45 - w - 8 > 8) { lx = L.cx - L.R * 1.45 - w; ty = L.cy - h / 2; }
      else ty = L.cy + L.R * 1.5;
    }
    pop.style.left = Math.max(8, Math.min(L.W - w - 8, lx)) + 'px';
    pop.style.top = Math.max(8, Math.min(Math.max(8, L.H - h - 8), ty)) + 'px';
    pop.classList.remove('unf'); void pop.offsetWidth; pop.classList.add('unf');
  }
  function shut() { pop.hidden = true; }
  /* the stage's set[:variant], as stage() draws it: the doodle's id on /doodles/ is f-<date>-<set>[-<variant>] */
  function ddSetOf(x) {
    if (x.kind === 'latin-night' || x.set === 'latin') return 'latin';
    var DD = window.MDDOODLER, s = (x.row && x.row.set) || x.set || (DD ? DD.setOf(x.e) : ''), v = x.row && x.row.variant;
    return s + (v ? ':' + v : '');
  }
  function evPop(e, px, py, row) {
    var s = at(e.s), dn = dayName(ymd(Math.max(s, Date.now()))), km1 = e.la != null ? km(where.lat, where.lng, e.la, e.lo) : null, C = CATMAP[e.c] || { th: '', en: '' };
    var th = row && row.th, en = (row && row.en) || e.t, k = esc(evKey(e)), g = guideUrl(e);
    showPop('<b>' + (th ? bi(esc(th), esc(en), 'stack') : esc(en)) + '</b>' +
      '<p class="pw">' + bi(dn[0] + (e.ad ? '' : ' ' + hhmm(s)), dn[1] + (e.ad ? '' : ' ' + hhmm(s))) + ' · ' + cdHtml(e) + '</p>' +
      (e.v ? '<p>' + esc(e.v) + (km1 != null ? ' · ' + bi(far(km1), farEn(km1), 'num') : '') + (C.th ? ' · ' + bi(C.th, C.en) : '') + '</p>' : '') +
      (e.d ? '<p class="pd">' + esc(e.d.length > 170 ? e.d.slice(0, 169) + '…' : e.d) + '</p>' : '') +
      '<div class="ddacts"><a href="#ev=' + e.k + '" data-dact="cal" data-ek="' + k + '">' + bi('ในปฏิทิน', 'Calendar') + '</a>' +
      (e.la != null ? '<a class="q" href="' + mapHref(e) + '" data-dact="map" data-ek="' + k + '">' + bi('แผนที่', 'Map') + '</a>' : '') +
      (e.ad ? '' : '<a class="q" download="' + e.k + '.ics" href="' + ics(e) + '">' + bi('ลงปฏิทิน', 'Add to calendar') + '</a>') +
      '<a class="q" href="#" data-dact="share" data-ek="' + k + '">' + bi('แชร์', 'Share') + '</a>' +
      (g ? '<a class="q" href="' + g + '">' + bi('นำทาง', 'Guide me') + '</a>' : '') +
      (x && x.e === e ? '<a class="q" href="' + LIVE + 'doodles/d/?id=f-' + T.d + '-' + esc(ddSetOf(x).replace(':', '-')) + '">' + bi('ดูเดิลนี้', 'This doodle') + '</a>' : '') +
      (e.la != null ? '<a class="q" href="' + grabUrl(e) + '" rel="noopener">Grab</a>' : '') + '</div>' +
      (x && x.e === e ? '<div class="ddvote">' + ddvRows({}, null, 'f-' + T.d + '-' + ddSetOf(x).replace(':', '-')) + '</div>' : ''), px, py);
    if (x && x.e === e) ddVote(pop.querySelector('.ddvote'), 'f-' + T.d + '-' + ddSetOf(x).replace(':', '-'));
  }
  /* thumbs up or down on the doodle's accuracy and aesthetics, for its latest version on /doodles/
     (worker.js /doodle-vote; tools/doodle_redo.py ranks the low ones for a redraw) */
  var DDV = 'https://mot-dang-claims.nanobotco.workers.dev';
  function ddvRows(mine, T2, id) {
    function th(n) { return '<svg viewBox="0 0 24 24" aria-hidden="true"><use href="' + LIVE + 'icons.svg#i-thumb-' + n + '"></use></svg>'; }
    function c(a, k) { return T2 && T2[a] ? T2[a][k] : 0; }
    return [['accuracy', 'ถูกต้อง', 'Accuracy'], ['aesthetics', 'ความงาม', 'Aesthetics']].map(function (a) {
      return '<span>' + bi(a[1], a[2]) + [[1, 'up', 0, 'ดี'], [-1, 'down', 1, 'ไม่ดี']].map(function (u) {
        return '<button type="button" data-ddv="' + a[0] + '" data-x="' + u[0] + '" aria-pressed="' + (mine[a[0]] === u[0]) + '" aria-label="' + a[1] + ' ' + u[3] + ' · ' + a[2] + ', ' + u[1] + '">' + th(u[1]) + c(a[0], u[2]) + '</button>';
      }).join('') + '</span>';
    }).join('') + (id ? '<a class="q" href="' + LIVE + 'doodles/d/?id=' + encodeURIComponent(id) + '#vnote">' + bi('บันทึก', 'Notes') + ' →</a>' : '');
  }
  function ddVote(el, id) {
    var h = 2166136261; for (var i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
    var bk = ('00' + ((h >>> 0) % 1024).toString(16)).slice(-3), v = 0, T2 = null, mine = {}, key = '';
    function paint() { el.innerHTML = ddvRows(mine, T2, id); }
    fetch(LIVE + 'doodles/data/v/' + bk + '.json').then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      var D = d && d[id]; if (!el.isConnected) return;
      if (!D || D.g) { el.hidden = true; return; }   /* not in the repository yet: nothing to vote on */
      v = D.vs[D.vs.length - 1].v; key = 'md-dv:' + id + '@' + v;
      try { var st = JSON.parse(localStorage.getItem(key) || '{}') || {}; mine = st.votes || st; } catch (e) {}
      paint();
      fetch(DDV + '/doodle-votes?id=' + encodeURIComponent(id) + '&v=' + v).then(function (r) { return r.json(); }).then(function (r) { if (r && r.ok) { T2 = r.tally; paint(); } }).catch(function () {});
    }).catch(function () { el.hidden = true; });
    el.onclick = function (ev) {
      var b = ev.target.closest('[data-ddv]'); if (!b || !v) return;
      ev.stopPropagation();
      var a = b.dataset.ddv, x2 = +b.dataset.x, body = { id: id, v: v }; body[a] = mine[a] === x2 ? 0 : x2;
      fetch(DDV + '/doodle-vote', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
        .then(function (r) { return r.json(); }).then(function (r) {
          if (r && r.ok) { mine = r.mine || mine; T2 = r.tally; try { var st = JSON.parse(localStorage.getItem(key) || '{}') || {}; localStorage.setItem(key, JSON.stringify({ votes: mine, note: st.note || '' })); } catch (e) {} paint(); }
        }).catch(function () {});
    };
  }
  function dropPop(q, px, py) {
    var h = q.h, t = q.t, dn = ymd(t) === ymd(Date.now()) ? ['', ''] : ['พรุ่งนี้ ', 'tomorrow '];
    ring(q.x, q.y);
    showPop('<b>' + bi('ฝน ' + dn[0] + h[0].slice(11, 16), 'Rain, ' + dn[1] + h[0].slice(11, 16)) + '</b>' +
      '<p>' + bi('โอกาส ' + h[1] + '% · ' + h[2] + ' มม.', h[1] + '% chance · ' + h[2] + ' mm') + '</p>' +
      '<div class="ddacts"><a class="q" href="#" data-turn="' + t + '">' + bi('หมุนนาฬิกาไปตอนนั้น', 'Turn the clock there') + '</a>' +
      '<a href="https://nanobotco.github.io/rain-chiang-mai/">' + bi('เรดาร์ฝนสด', 'Rain radar, live') + '</a></div>', px, py);
  }
  function skyPop(px, py) {
    var d = T.d, sk = D.sky && D.sky.days && D.sky.days[d], mo = sk && sk.moon, su = T.sun, nwp = null, i;
    if (D.sky) Object.keys(D.sky.days).sort().some(function (k) { if (k > d && D.sky.days[k].moon && D.sky.days[k].moon.wan_phra) { nwp = k; return true; } });
    ring(HAND.sx, HAND.sy);
    var h = '<b>' + bi('ดวงอาทิตย์ ดวงจันทร์', 'Sun and moon') + '</b>';
    if (su.rise && su.set) {
      var len = (su.set - su.rise) / 6e4, nx = T.now < su.rise ? ['ตะวันขึ้น', 'sunrise', su.rise] : T.now < su.set ? ['ตะวันตก', 'sunset', su.set] : null, r = nx && relTxt(nx[2]);
      h += '<p>' + bi('ขึ้น ' + hhmm(su.rise) + ' · ตก ' + hhmm(su.set) + ' · กลางวัน ' + Math.floor(len / 60) + ' ชม. ' + Math.round(len % 60) + ' นาที', 'rise ' + hhmm(su.rise) + ' · set ' + hhmm(su.set) + ' · ' + Math.floor(len / 60) + ' h ' + Math.round(len % 60) + ' min of day') +
        (nx ? '<br>' + bi(nx[0] + ' ' + (AT == null ? r[0] : 'ตอน ' + hhmm(nx[2])), nx[1] + ' ' + (AT == null ? r[1] : 'at ' + hhmm(nx[2]))) : '') + '</p>';
    }
    var named = mo && !/^wa(x|n)ing/i.test(mo.phase_en || '');
    if (mo) h += '<p>' + bi((named ? mo.phase_th + ' · ' : '') + mo.thai_label_th + ' · สว่าง ' + Math.round(mo.illum * 100) + '%' + (mo.wan_phra ? ' · วันพระ' : ''), (named ? mo.phase_en + ' · ' : '') + mo.thai_label_en + ' · ' + Math.round(mo.illum * 100) + '% lit' + (mo.wan_phra ? ' · wan phra' : '')) + '</p>';
    if (nwp) { var nd = dayName(nwp), dd = Math.round((at(nwp + ' 12:00:00') - at(d + ' 12:00:00')) / 864e5); h += '<p>' + bi('วันพระถัดไป ' + nd[0] + ' · อีก ' + dd + ' วัน', 'next wan phra ' + nd[1] + ' · in ' + dd + (dd > 1 ? ' days' : ' day')) + '</p>'; }
    h += '<div class="ddacts"><a href="' + LIVE + 'full-moon/">' + bi('พระจันทร์เต็มดวงที่วัด', 'Full moon at the wat') + '</a></div>';
    showPop(h, px, py);
  }
  var MONF = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  var MONF_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function datePop(px, py) {
    /* the date three ways: the civil calendar in Buddhist years, the lunar day, and the Lanna count, two
       months ahead of the central Thai one (Yi Peng is the full moon of the Lanna second month, เดือนยี่) */
    var b = bkk(T.now), y = b.getUTCFullYear(), m = b.getUTCMonth(), dd = b.getUTCDate(), dw = b.getUTCDay(), mo = T.moon;
    var cs = y - ((m + 1) * 100 + dd < 416 ? 639 : 638);
    var h = '<b>' + bi('วันนี้ตามปฏิทินไทย', 'The Thai date') + '</b><p class="thd">' + thd('วัน' + DAY_TH[dw] + 'ที่ ' + dd + ' ' + MONF[m] + ' พ.ศ. ' + (y + 543) + ' · จ.ศ. ' + cs) + '</p>' +
      '<p class="en">' + DAY_EN[dw] + ' ' + dd + ' ' + MONF_EN[m] + ' ' + y + ' · Buddhist year ' + (y + 543) + ' · Lesser Era ' + cs + '</p>';
    if (mo && mo.thai_month) {
      var ln = (mo.thai_month + 1) % 12 + 1, lnTh = ln === 1 ? 'เดือนเกี๋ยง' : ln === 2 ? 'เดือนยี่' : 'เดือน ' + ln;
      h += '<p>' + bi(mo.thai_label_th + ' เดือน ' + mo.thai_month + ' (ภาคกลาง) · ' + lnTh + ' ล้านนา', mo.thai_label_en + ', month ' + mo.thai_month + ' (central Thai) · month ' + ln + ' in the Lanna count') + '</p>';
    }
    showPop(h, px, py);
  }
  /* a sight's card */
  function sightCard(k, px, py) {
    var s = (SKY.sights.cm.concat(SKY.sights.cr)).filter(function (q) { return q.k === k; })[0]; if (!s) return;
    var d = km(where.lat, where.lng, s.lat, s.lng), story = '';
    if (s.k === 'doi-suthep' && T.a) {
      /* how far the air lets you see (V = 3912 / (13.3·PM + 20) km) against how far the mountain is */
      var pm = Math.round(T.a.pm25), V = visKm(T.a.pm25), C = Math.exp(-3.912 * d / V), clear = Math.max(1, Math.round((3912 / (1.699 * Math.max(1, d)) - 20) / 13.3));
      story = '<p class="sty">' + bi('ตอนนี้ PM2.5 ' + pm + ' มองได้ไกลราว ' + Math.round(V) + ' กม. ดอยอยู่ห่าง ' + far(d) + (C > 0.1 ? ' จึงเห็นชัด' : C > 0.01 ? ' จึงเห็นจางๆ' : ' จึงจมในควัน') + ' · จะเห็นชัดเมื่อ PM2.5 ต่ำกว่าราว ' + clear,
        'PM2.5 is ' + pm + ': you could see about ' + Math.round(V) + ' km, the mountain is ' + farEn(d) + ' off, so it ' + (C > 0.1 ? 'stands clear' : C > 0.01 ? 'shows faintly' : 'is lost in the smoke') + ' · clear when PM2.5 is under about ' + clear) + '</p>';
    }
    showPop('<b>' + bi(esc(s.th), esc(s.en), 'stack') + '</b><p>' + bi(esc(s.about[0]), esc(s.about[1])) + '</p>' + story +
      '<div class="ddacts"><a href="' + LIVE + s.page + '">' + bi('อ่านต่อ', 'More') + '</a>' +
      '<a class="q" href="' + LIVE + 'map.html#17/' + s.lat + '/' + s.lng + '" data-dact="fly" data-ll="' + s.lat + ',' + s.lng + '" data-th="' + esc(s.th) + '" data-en="' + esc(s.en) + '">' + bi('แผนที่', 'Map') + ' · ' + bi(far(d), farEn(d), 'num') + '</a></div>', px, py);
  }
  function inBox(q, px, py) { return px >= q.x0 && px <= q.x1 && py >= q.y0 && py <= q.y1; }
  function hitAt(px, py) {
    var i, q;
    for (i = 0; i < tagHits.length; i++) if (inBox(tagHits[i], px, py)) return { tag: tagHits[i].e, box: tagHits[i] };
    for (i = 0; i < dropHits.length; i++) { q = dropHits[i]; if (Math.hypot(px - q.x, py - q.y) < q.r) return { drop: q, circ: [q.x, q.y, q.r * 0.8] }; }
    if (HAND.sx != null && Math.hypot(px - HAND.sx, py - HAND.sy) < Math.max(HAND.sr * 1.7, 14)) return { sun: 1, circ: [HAND.sx, HAND.sy, HAND.sr * 1.6] };
    if (HAND.ax != null && Math.hypot(px - HAND.ax, py - HAND.ay) < Math.max(L.R * 0.14, 14)) return { ant: 1, circ: [HAND.ax, HAND.ay, Math.max(L.R * 0.12, 10)] };
    var dc = Math.hypot(px - L.cx, py - L.cy);
    for (i = 0; i < GEARS.length; i++) { q = GEARS[i]; if (dc > L.R * 1.12 && Math.hypot(px - q.x, py - q.y) < q.r * 1.12) return { gear: 1, circ: [q.x, q.y, q.r * 1.15] }; }
    for (i = liveHits.length - 1; i >= 0; i--) if (inBox(liveHits[i], px, py)) return { live: liveHits[i] };
    if (dc < L.R * 1.15) return { day: T.d, circ: [L.cx, L.cy, L.R * 1.16] };
    for (i = 0; i < landHits.length; i++) if (inBox(landHits[i], px, py)) return { sight: landHits[i].k, box: landHits[i] };
    for (i = 0; i < stageHits.length; i++) if (inBox(stageHits[i], px, py)) return { ev: x.e.k, stage: 1 };
    return x ? { ev: x.e.k } : null;
  }
  var popKey = '';
  function tapAt(px, py) {
    var h = hitAt(px, py), key = !h ? '' : h.tag ? 't' + evKey(h.tag) : h.drop ? 'r' + h.drop.t : h.sun ? 'sun' : h.gear ? 'gear' : h.sight ? 's' + h.sight : h.ev ? 'ev' : '';
    if (!pop.hidden) { shut(); if (!h || (h.ev && !h.stage) || (key && key === popKey)) return; }
    if (!h) return;
    popKey = key;
    engaged();
    if (h.tag) { ring(px, py); evPop(h.tag, px, py); }
    else if (h.drop) dropPop(h.drop, px, py);
    else if (h.sun) skyPop(px, py);
    else if (h.ant) { if (!REDUCED) ANT.t0 = performance.now(); ring(HAND.ax, HAND.ay); }
    else if (h.gear) { GEAR.v = REDUCED ? 0 : 45; datePop(px, py); }
    else if (h.live) location.href = h.live.href;
    else if (h.day) openDay(T.d);
    else if (h.sight) { var b = h.box; ring((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2); sightCard(h.sight, px, py); }
    else if (h.ev) { react(px, py); evPop(x.e, px, py, x.row); }
    if (REDUCED) paint(4000);
  }
  /* ---- the clock turns: drag it round (or arrow keys) to see another hour of today and tomorrow; the sky,
     the lamps, the rain, the tags, the calendar's list and the map follow; let go and it springs back */
  var clk = document.createElement('div'), chip = document.createElement('div'), drag = null;
  clk.id = 'ddclk'; clk.tabIndex = 0; clk.setAttribute('role', 'slider'); clk.setAttribute('aria-valuemin', '0'); clk.setAttribute('aria-valuemax', '48');
  clk.setAttribute('aria-label', 'นาฬิกาของวัน หมุนเพื่อดูชั่วโมงอื่น · the day\'s clock, turn it to see another hour');
  clk.title = 'ลากหมุน · drag to turn';
  chip.id = 'ddat'; chip.hidden = true; chip.setAttribute('aria-live', 'polite');
  chip.innerHTML = '<b></b><button type="button">↺ ' + bi('ตอนนี้', 'now') + '</button>';
  cv.parentNode.insertBefore(clk, pop); cv.parentNode.insertBefore(chip, pop);
  chip.querySelector('button').addEventListener('click', function () { springBack(); });
  function placeClk() {
    var s = L.R * 2.3;
    clk.style.left = (L.cx - s / 2) + 'px'; clk.style.top = (L.cy - s / 2) + 'px'; clk.style.width = s + 'px'; clk.style.height = s + 'px';
    chip.style.top = (L.cy + L.R * 1.24) + 'px';
  }
  function setAt(t) {
    var now = Date.now(), lo = at(ymd(now) + ' 00:00:00'), hi = at(ymd(now + 864e5) + ' 23:55:00');
    t = Math.round(Math.max(lo, Math.min(hi, t)) / 3e5) * 3e5;
    if (t === AT) return;
    AT = t; SPRING = null; lastMin = -1; turned();
    if (REDUCED) paint(4000);
  }
  function turned() {
    var t = AT;
    chip.hidden = t == null;
    if (t != null) chip.querySelector('b').innerHTML = atLabel(t);
    var lo = at(ymd(Date.now()) + ' 00:00:00'), v = ((t != null ? t : Date.now()) - lo) / 36e5;
    clk.setAttribute('aria-valuenow', v.toFixed(2));
    clk.setAttribute('aria-valuetext', t == null ? 'ตอนนี้ ' + hhmm(Date.now()) + ' · now' : ymd(t) + ' ' + hhmm(t));
    calAt(t); mapAt(t);
  }
  function hold(ms) { clearTimeout(HOLD); HOLD = setTimeout(springBack, ms || 9000); }
  function springBack() {
    clearTimeout(HOLD); if (AT == null) return;
    if (REDUCED) { AT = null; lastMin = -1; turned(); paint(4000); return; }
    SPRING = { from: AT, t0: performance.now() };
  }
  function cvXY(ev) { var r = cv.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; }
  function angOf(p) { return Math.atan2(p[1] - L.cy, p[0] - L.cx); }
  clk.addEventListener('pointerdown', function (ev) {
    if (ev.button > 0) return;
    var p = cvXY(ev); drag = { p0: p, last: angOf(p), acc: 0, off0: (AT != null ? AT : Date.now()) - Date.now(), moved: false };
    try { clk.setPointerCapture(ev.pointerId); } catch (x) { }
    ev.preventDefault();
  });
  clk.addEventListener('pointermove', function (ev) {
    var p = cvXY(ev);
    if (!drag) { hover(p); return; }
    if (!drag.moved && Math.hypot(p[0] - drag.p0[0], p[1] - drag.p0[1]) < 7) return;
    if (!drag.moved) { drag.moved = true; clearTimeout(HOLD); shut(); clk.classList.add('turning'); HOV = null; engaged(); }
    var a = angOf(p), d = a - drag.last; if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI;
    drag.last = a; drag.acc += d;
    setAt(Date.now() + drag.off0 + drag.acc / (2 * Math.PI) * 12 * 36e5);
  });
  clk.addEventListener('pointerup', function () {
    if (!drag) return; var d = drag; drag = null; clk.classList.remove('turning');
    if (!d.moved) tapAt(d.p0[0], d.p0[1]); else hold();
  });
  clk.addEventListener('pointercancel', function () { if (drag && drag.moved) hold(); drag = null; clk.classList.remove('turning'); });
  clk.addEventListener('mouseleave', function () { if (!drag) setHov(null); });
  clk.addEventListener('keydown', function (ev) {
    var st = { ArrowRight: 15, ArrowUp: 15, ArrowLeft: -15, ArrowDown: -15, PageUp: 60, PageDown: -60 }[ev.key];
    if (st) { ev.preventDefault(); setAt((AT != null ? AT : Date.now()) + st * 6e4); hold(20000); engaged(); }
    else if (ev.key === 'Escape' || ev.key === 'Home') { ev.preventDefault(); springBack(); }
    else if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openDay(T.d); }
  });
  cv.onclick = function (ev) { var p = cvXY(ev); tapAt(p[0], p[1]); };
  pop.addEventListener('click', function (e) {
    if (e.target.closest('.x')) { shut(); return; }
    var tn = e.target.closest('[data-turn]'); if (tn) { e.preventDefault(); shut(); setAt(+tn.dataset.turn); hold(); }
  });
  var LT = { river: ['น้ำปิงตอนนี้', 'The Ping now'], fires: ['ไฟป่าที่ดาวเทียมเห็น', 'Fires seen from space'] };
  function setHov(h) {
    var was = HOV; HOV = h && (h.box || h.circ) && !(h.day && drag) ? h : null;
    cv.style.cursor = h ? 'pointer' : '';
    clk.style.cursor = drag ? 'grabbing' : h && h.day ? 'grab' : 'pointer';
    var s = h && h.sight && (SKY.sights.cm.concat(SKY.sights.cr)).filter(function (q) { return q.k === h.sight; })[0], lt = h && h.live && LT[h.live.k], en = enMode();
    var tt = lt ? lt[en ? 1 : 0] : s ? (en ? s.en : s.th) : h && h.tag ? h.tag.s.slice(11, 16) + ' ' + h.tag.t : h && h.drop ? (en ? 'Rain ' : 'ฝน ') + h.drop.h[0].slice(11, 16) + ' · ' + h.drop.h[1] + '%' :
      h && h.sun ? (en ? 'Sun and moon' : 'ดวงอาทิตย์ ดวงจันทร์') : h && h.gear ? (en ? 'The Thai date' : 'วันนี้ตามปฏิทินไทย') : h && h.ant ? (en ? 'Mot Dang, the red ant' : 'มดแดง') :
      h && h.day ? (en ? 'Drag to turn the clock · tap for the day' : 'ลากหมุนนาฬิกา · แตะดูวันนี้') : '';
    cv.title = tt; clk.title = tt;
    if (REDUCED && was !== HOV) paint(4000);
  }
  function hover(p) { setHov(hitAt(p[0], p[1])); }
  cv.addEventListener('mousemove', function (ev) { hover(cvXY(ev)); });
  cv.addEventListener('mouseleave', function () { setHov(null); });
  CLK = { relocate: function () { lastMin = -1; if (REDUCED) paint(0); }, shut: shut,
    pop: function (e, b) {
      var r = b.getBoundingClientRect(), q = cv.getBoundingClientRect(), px = Math.max(20, Math.min(L.W - 20, r.left + r.width / 2 - q.left)), py = Math.min(L.H - 10, r.top - q.top);
      if (x && e === x.e) react((L.x0 + L.W) / 2, L.deck - 30);
      evPop(e, px, py, x && e === x.e ? x.row : null); engaged();
      if (REDUCED) paint(4000);
    } };
  addEventListener('mddoodler', function () { paint(REDUCED ? 4000 : performance.now()); });   /* a scene file just arrived */
  size();
  addEventListener('resize', function () { size(); poster = null; if (REDUCED) paint(0); });
  new MutationObserver(function () { lastMin = -1; if (REDUCED) paint(0); }).observe(H, { attributes: true, attributeFilter: ['class'] });
  if (REDUCED) { paint(4000); setInterval(function () { paint(4000); }, 30e3); return; }
  new IntersectionObserver(function (es) { on = es[0].isIntersecting; if (on) requestAnimationFrame(f); }).observe(cv);
  function f(t) { if (!on) return; if (t - last > 32) { last = t; paint(t); } requestAnimationFrame(f); }
}

/* the row under it: today, tomorrow, the weekend, the calendar — counts from the same file */
function jump() {
  var E = D.events; if (!E) return;
  var now = Date.now(), today = ymd(now), b = new Date(now + 7 * 3600e3), dow = b.getUTCDay();
  var tom = ymd(now + 864e5), sat = ymd(now + ((6 - dow + 7) % 7) * 864e5), sun = ymd(at(sat + ' 12:00:00') + 864e5);
  function n(d0, d1) { return E.events.filter(function (e) { var s = span(e); return s[1] > now && s[1] - s[0] < 30 * 3600e3 && ymd(Math.max(s[0], now)) >= d0 && ymd(Math.max(s[0], now)) <= d1 && !ME.hidden[e.k] && !ME.hideCats[e.c]; }).length; }
  var h = [[today, today, 'วันนี้', 'Today'], [tom, tom, 'พรุ่งนี้', 'Tomorrow']];
  if (dow !== 6 && dow !== 0) h.push([sat, sun, 'เสาร์อาทิตย์', 'Weekend']);
  $('jump').innerHTML = h.map(function (r) { var c = n(r[0], r[1]); return c ? '<a class="chip" href="#day=' + r[0] + '">' + bi(r[2], r[3]) + '<i>' + c + '</i></a>' : ''; }).join('') +
    '<a class="chip cal" href="#day=' + today + '">' + bi('ปฏิทิน', 'The calendar') + ' ↑</a>';
}
/* #ev=<key> opens that event in the calendar; #day=<date> goes to that day.
   Search rows, the map's event taps and the doodle all lead here. */
function go(h) { if (D.events) goNext(h); }
function route() { var h = location.hash.slice(1); try { h = decodeURIComponent(h); } catch (e) { } go(h); }
addEventListener('hashchange', route);
document.addEventListener('click', function (ev) {
  var a = ev.target.closest && ev.target.closest('a[href^="#ev="],a[href^="#day="]'); if (!a) return;
  ev.preventDefault(); var h = a.getAttribute('href');
  try { history.replaceState(null, '', h); } catch (e) { }
  go(h.slice(1));
});


/* the smoky-season page belongs beside the air reading in its season (mid-January
   to April, its card's window in sites.json) or on a day the air is bad (Thai AQI
   orange starts at PM2.5 37.5) */
function smoky(pm) { var md = new Date().toISOString().slice(5, 10); return pm >= 37.5 || (md >= '01-15' && md <= '04-30'); }

/* ------------------------------------------------------------ MINISITES
   Each once (Nan 2026-10-11): the dated ones in the calendar (msCal), the rest one row under the map */
function sites() {
  var S = D.sites, box = $('msmap'); if (!S) return;
  var rest = S.filter(function (s) { return !(s.on || s.now); });
  if (box) box.innerHTML = '<h3>' + bi('เว็บเล็ก', 'Minisites') + ' <small>' + rest.length + '</small></h3><div class="msrow">' + rest.map(function (s, i) {
    return '<a class="msc" href="' + esc(msHref(s)) + '"><img loading="' + (i < 4 ? 'eager' : 'lazy') + '" decoding="async" alt="" src="' + LIVE + esc(s.img) + '"><span>' + bi(esc(s.th), esc(s.en)) + '</span></a>';
  }).join('') + '</div>';
  if (D.events && $('mgrid') && $('mgrid').innerHTML) { try { month(); } catch (err) { console.error(err); } }
  if (D.ahead) ahead();
}

/* ------------------------------------------------------------ THE DRAWER */
function drawer() {
  var d = D.drawer; if (!d) return;
  function chips(p) { return d.shelves.map(function (s) { return '<a href="' + LIVE + p + '/' + s.k + '/">' + bi(esc(s.th), esc(s.en)) + '</a>'; }).join(''); }
  var rest = [['map.html', 'แผนที่', 'Map'], ['calendar.html', 'ปฏิทินเต็ม', 'The full calendar'], ['sites/', 'ทุกเว็บ', 'Every site'], ['sites/city-live/#engine', '>_ เครื่องยนต์', 'engine']].map(function (x) {
    return '<a href="' + LIVE + x[0] + '">' + bi(esc(x[1]), esc(x[2])) + '</a>';
  }).join('') + d.more.map(function (s) { return '<a href="' + esc(/^https?:/.test(s.href) ? s.href : LIVE + s.href) + '">' + bi(esc(s.th), esc(s.en)) + '</a>'; }).join('');
  /* the same shelves in the bottom drawer and in the menu sheet */
  var fill = { cm: chips('cm'), cr: chips('cr'), rest: rest };
  document.querySelectorAll('.shelves[data-p]').forEach(function (el) { el.innerHTML = fill[el.dataset.p] || ''; });
}

/* ------------------------------------------------------------ reveal on scroll */
var io = 'IntersectionObserver' in window ? new IntersectionObserver(function (es) {
  es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
}, { rootMargin: '0px 0px -8% 0px' }) : null;
function reveal() { document.querySelectorAll('.reveal:not(.in)').forEach(function (el) { io ? io.observe(el) : el.classList.add('in'); }); }
reveal();

/* ------------------------------------------------------------ load: small and near first */
Promise.all([j(LIVE + 'data/weather.json').then(function (d) { D.weather = d; }, function () { }),
             j(LIVE + 'data/air.json').then(function (d) { D.air = d; }, function () { }),
             j(LIVE + 'front/ridge.json').then(function (d) { D.ridge = d; }, function () { })])
  .then(function () { sky.text(); });
j(LIVE + 'front/ahead.json').then(function (d) { D.ahead = d; ahead(); }, function () { });
/* the one bake of the calendar's dates (front_layer.bake_when); it 404s until a hand-off carries it, nothing waits on it,
   and the readers stay on events.json (cats, fields) until they move over */
j(LIVE + 'front/when.json').then(function (d) { D.when = d; if (CALNEXT && D.events) { try { month(); } catch (err) { console.error(err); } } }, function () { });
j(LIVE + 'front/near.json').then(function (d) { D.near = d; near(); }, function () { });
Promise.all([j(LIVE + 'front/events.json').then(function (d) { D.events = d; }), j(LIVE + 'front/soon.json').then(function (d) { D.soon = d; }),
             j(LIVE + 'data/sky.json').then(function (d) { D.sky = d; }, function () { }),
             j(LIVE + 'front/doodle.json').then(function (d) { D.doodle = d; }, function () { })])
  .then(function () { [cal, doodle, jump, route].forEach(function (f) { try { f(); } catch (err) { console.error(err); } }); }, function () { });   /* each on its own: one that fails leaves the rest, the doodle above all, standing */
j(LIVE + 'front/sites.json').then(function (d) { D.sites = d; sites(); }, function () { });

j(LIVE + 'front/drawer.json').then(function (d) { D.drawer = d; drawer(); }, function () { });
/* a phone's address bar coming and going changes the height only; the panels redraw for a new width */
var rz, rzW = innerWidth; addEventListener('resize', function () { if (innerWidth === rzW) return; rzW = innerWidth; clearTimeout(rz); rz = setTimeout(forecast, 300); });
setInterval(function () {
  Promise.all([j(LIVE + 'data/weather.json').then(function (d) { D.weather = d; }, function () { }),
               j(LIVE + 'data/air.json').then(function (d) { D.air = d; }, function () { })]).then(function () { sky.text(); });
}, 600e3);
})();

/* the city map: its first touch asks for the whole screen (Nan, 2026-10-02: "if you play
   with the map, it needs to become 100% tool"); ✕ in the map, Esc or Back return it */
(function () {
  var now = document.getElementById('now'), fr = now && now.querySelector('iframe');
  if (!fr) return;
  function off() {
    now.classList.remove('tool'); document.documentElement.classList.remove('maptool');
    try { fr.contentWindow.postMessage({ type: 'md-map', tool: false }, location.origin); } catch (e) { }
  }
  addEventListener('message', function (e) {
    if (e.origin !== location.origin || e.source !== fr.contentWindow || !e.data || e.data.type !== 'md-map') return;
    if (e.data.tool) {
      if (now.classList.contains('tool')) return;
      now.classList.add('tool'); document.documentElement.classList.add('maptool');
      try { history.pushState({ mdmap: 1 }, ''); } catch (x) { }
    } else if (now.classList.contains('tool')) {
      if (history.state && history.state.mdmap) history.back(); else off();
    }
  });
  addEventListener('popstate', function () { if (now.classList.contains('tool') && !(history.state && history.state.mdmap)) off(); });
  /* a pinch on the city switch zooms nothing, not the whole page */
  now.addEventListener('wheel', function (e) { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
})();
