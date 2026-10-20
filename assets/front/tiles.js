/* motdang.net front page — the four tiles under the forecast (Nan, 2026-10-03: "3, 4 with deeply and richly
   integrated flight data, 5 definitely, 6 yes … add these as their own tiles or sections").
   Flights: every nonstop route from CNX and CEI on an azimuthal equidistant chart, a day of flights in a minute.
   Roads: the Department of Highways' counted sections, traffic flowing at each one's vehicles a day.
   Films: today's screenings in the reader's province on one strip, the playhead at now.
   Lottery: the last draw, the drum turning and the first prize falling out ball by ball.
   Each tile wakes when it scrolls into view and sleeps when it leaves.
   Since 2026-10-11 (Nan: not on the map, too many words, too much room) they live in the calendar tab, folded:
   a row of cards (MDNOW below) gives each a number, one line and a small chart; a card opens its full view. */
(function () {
'use strict';
var H = document.documentElement, LIVE = '/', DPR = Math.min(2, window.devicePixelRatio || 1);
var REDUCED = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
var $ = function (id) { return document.getElementById(id); };
function j(u) { return fetch(u).then(function (r) { if (!r.ok) throw new Error(u); return r.json(); }); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function bi(th, en, cls) { return '<span class="bi' + (cls ? ' ' + cls : '') + '"><span class="th" lang="th">' + th + '</span><span class="en" lang="en">' + en + '</span></span>'; }
function en() { return H.classList.contains('lang-en'); }
var bkk = window.MDWHEN.bkk, hhmm = window.MDWHEN.hhmm, ymd = window.MDWHEN.ymd, MON_TH = window.MDWHEN.MON_TH, MON_EN = window.MDWHEN.MON_EN;
function n0(x) { return Math.round(x).toLocaleString('en-US'); }
function hash(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function dayStr(d) { return [+d.slice(8) + ' ' + MON_TH[+d.slice(5, 7) - 1], +d.slice(8) + ' ' + MON_EN[+d.slice(5, 7) - 1]]; }
var SANS = '"Sarabun",system-ui,sans-serif', MONO = 'ui-monospace,"SF Mono",Menlo,monospace';

/* the reader's province, as front.js reads it: the city they chose, the network's guess, else Chiang Mai */
var PROV = (function () {
  try { var c = localStorage.getItem('md-city'); if (c === 'cm' || c === 'cr') return c; } catch (e) { }   // the city the reader chose
  var m = document.querySelector('meta[name=md-where]'), v = m && m.content.split('|'), la = v && parseFloat(v[1]);
  return la > 19.5 && la < 20.7 ? 'cr' : 'cm';
})();

/* paper: skyline.js's cut-paper fill when it is there, a plain fill when it is not */
function paper(k, path, fill, lift) { var S = window.MDSKY; if (S && S.paper) return S.paper(k, path, fill, lift); k.fillStyle = fill; path(k); k.fill('evenodd'); }
function disc(q, x, y, r) { q.beginPath(); q.arc(x, y, r, 0, 6.2832); }

/* one canvas per tile: sized to its box, painted while on screen */
function tile(id, draw, onTap) {
  var box = $(id); if (!box) return null;
  var cv = box.querySelector('canvas'), k = cv.getContext('2d'), on = false, t0 = performance.now(), T = { W: 0, H: 0, born: 0 };
  function size() { T.W = cv.clientWidth; T.H = cv.clientHeight; cv.width = T.W * DPR; cv.height = T.H * DPR; }
  function paint(t) { k.setTransform(DPR, 0, 0, DPR, 0, 0); k.clearRect(0, 0, T.W, T.H); draw(k, T, REDUCED ? 60000 : t - t0); }
  function loop(t) { if (!on) return; paint(t); requestAnimationFrame(loop); }
  size();
  addEventListener('resize', function () { size(); if (REDUCED || !on) paint(performance.now()); });
  new MutationObserver(function () { paint(performance.now()); }).observe(H, { attributes: true, attributeFilter: ['class'] });
  if ('IntersectionObserver' in window) new IntersectionObserver(function (es) {
    var was = on; on = es[0].isIntersecting;
    if (on && !T.born) { T.born = 1; t0 = performance.now(); }
    if (on && !was) { if (REDUCED) paint(performance.now()); else requestAnimationFrame(loop); }
  }, { rootMargin: '80px' }).observe(cv);
  else { on = true; requestAnimationFrame(loop); }
  if (onTap) cv.addEventListener('click', function (ev) { var r = cv.getBoundingClientRect(); onTap(ev.clientX - r.left, ev.clientY - r.top, T); });
  return { paint: function () { paint(performance.now()); }, fit: function () { size(); paint(performance.now()); }, T: T, cv: cv };
}
function cap(id, h) { var c = $(id) && $(id).querySelector('.tcap'); if (c) c.innerHTML = h; }

/* ======================================================================== THE CITY NOW: the cards
   Each section hands MDNOW.card(key, {l: label, v: number, s: one line, g: chart}); wx.js gives sky and air. A tap
   opens that section's full view in #cnx; the sources wait behind the i. */
var CN = { order: ['sky', 'air', 'flights', 'roads', 'films', 'lotto'], c: {}, open: null };
var MORE = { flights: ['flights.html', 'ใครบินมาที่นี่', 'Who flies here'], roads: ['traffic.html', 'รถติด ทุกชั่วโมง ทุกถนน', 'Traffic by hour and road'],
  films: ['films.html', 'ทุกโรง ทุกรอบ สามวัน', 'Every cinema, three days'], lotto: ['lottery.html', 'ทุกรางวัล และตรวจสลาก', 'Every prize, and check a ticket'] };
/* a small bar chart, 100 × 22: o.hi the lit bar, o.col(v, i) a colour per bar, o.line a second series as a line */
function spark(vals, o) {
  o = o || {}; var n = vals.length; if (!n) return '';
  var mx = o.max || Math.max.apply(null, vals.map(function (v) { return v || 0; }).concat([1e-9])), w = 100 / n, g = '';
  vals.forEach(function (v, i) {
    if (v == null) return; var h = Math.max(1.2, v / mx * 20), c = o.col ? o.col(v, i) : i === o.hi ? '#b0442e' : 'currentColor';
    g += '<rect x="' + (i * w + w * 0.12).toFixed(2) + '" y="' + (22 - h).toFixed(2) + '" width="' + (w * 0.76).toFixed(2) + '" height="' + h.toFixed(2) + '" fill="' + c + '"' + (c === 'currentColor' ? ' fill-opacity=".35"' : '') + '/>';
  });
  if (o.line) {
    var L = o.line.filter(function (v) { return v != null; }), lo = Math.min.apply(null, L), rg = Math.max(1, Math.max.apply(null, L) - lo);
    g += '<polyline fill="none" stroke="#b0442e" stroke-width="1.8" vector-effect="non-scaling-stroke" points="' + o.line.map(function (v, i) { return v == null ? '' : (i * w + w / 2).toFixed(2) + ',' + (19 - (v - lo) / rg * 15).toFixed(2); }).join(' ') + '"/>';
  }
  return '<svg viewBox="0 0 100 22" preserveAspectRatio="none" aria-hidden="true">' + g + '</svg>';
}
function cnDraw() {
  var box = document.querySelector('#cnow .cnc'); if (!box) return;
  box.innerHTML = CN.order.filter(function (k) { return CN.c[k]; }).map(function (k) {
    var o = CN.c[k];
    return '<button type="button" class="cn" data-cn="' + k + '" aria-pressed="' + (CN.open === k) + '" aria-controls="cnx"><span class="cnl">' + bi(o.l[0], o.l[1]) + '</span>' +
      '<span class="cnv">' + o.v + '</span>' + (o.s ? '<span class="cns">' + bi(o.s[0], o.s[1]) + '</span>' : '') + (o.g || '') + '</button>';
  }).join('');
}
var TILE = {};
function cnOpen(k) {
  var x = $('cnx'); if (!x) return;
  CN.open = CN.open === k ? null : k; x.hidden = !CN.open;
  x.querySelectorAll('[data-k]').forEach(function (el) { el.hidden = el.dataset.k !== CN.open; });
  var m = x.querySelector('.cnxmore'), M = MORE[CN.open];
  m.hidden = !M; if (M) { m.href = LIVE + M[0]; m.innerHTML = bi(M[1], M[2]) + ' →'; }
  cnDraw();
  if (CN.open) {
    if (TILE[k]) TILE[k].fit();
    if ((k === 'sky' || k === 'air') && window.MDWX && MDWX.draw) MDWX.draw();
  }
  var b = document.querySelector('.cn[data-cn="' + k + '"]');
  if (b) { b.focus(); if (!REDUCED) { b.classList.add('go'); setTimeout(function () { b.classList.remove('go'); }, 500); } }
}
window.MDNOW = { card: function (k, o) { if (o) CN.c[k] = o; else delete CN.c[k]; cnDraw(); }, spark: spark };
document.addEventListener('click', function (ev) {
  var t = ev.target.closest && ev.target.closest('.cn[data-cn], #cnx .cnxx, #cnx .cnxi'); if (!t) return;
  if (t.dataset.cn) cnOpen(t.dataset.cn);
  else if (t.classList.contains('cnxx')) { if (CN.open) cnOpen(CN.open); }
  else { var on = $('cnx').classList.toggle('info'); t.setAttribute('aria-pressed', String(on)); }
});

/* ======================================================================== FLIGHTS
   Azimuthal equidistant, centred on Chiang Mai's runway: every straight line out of the centre is a great
   circle, so each route from CNX is drawn as the path a plane takes, bearing true. Distance is on a log
   scale, r = ln(1 + d/400), so Vientiane and Abu Dhabi both fit. Chiang Rai's routes leave from CEI's own
   point on the same chart. A day of flights is played in a minute: each route launches its daily count
   (the timetable's arrivals a month ÷ 30.4, each way), evenly spaced, at the chart speed of 750 km/h. */
var FL = null, FSEL = null;
var AIRCOL = ['#ffc266', '#7fd8ff', '#ff7a8a', '#9be08f', '#c9a7ff', '#ffa45c', '#5fd1c1', '#f7e27a', '#ff9ad5', '#a8c1ff'];
function geo(a, b) {                                   /* distance (km) and initial bearing (rad) from a to b */
  var R = Math.PI / 180, la1 = a[0] * R, la2 = b[0] * R, dl = (b[1] - a[1]) * R;
  var d = 2 * Math.asin(Math.sqrt(Math.pow(Math.sin((la2 - la1) / 2), 2) + Math.cos(la1) * Math.cos(la2) * Math.pow(Math.sin(dl / 2), 2)));
  var y = Math.sin(dl) * Math.cos(la2), x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dl);
  return [d * 6371, Math.atan2(y, x)];
}
function flightsPrep(d) {
  var c = d.airports.CNX.ll, month = +ymd(Date.now()).slice(5, 7), lines = {}, li = 0;
  var rs = d.routes.map(function (r) {
    var g = geo(c, r.ll), s = r.season, live = !s || (s.months.indexOf(month) >= 0 && !(s.upcoming && r.per_month === 0));
    r.airlines.forEach(function (a) { if (!(a in lines)) lines[a] = { n: 0, col: AIRCOL[li++ % AIRCOL.length] }; lines[a].n++; });
    return { r: r, d: g[0], b: g[1], live: live && r.per_month > 0, day: r.per_month / 30.4 };
  });
  var cei = geo(c, d.airports.CEI.ll);
  FL = { d: d, rs: rs, lines: lines, cei: cei, dmax: Math.max.apply(null, rs.map(function (x) { return x.d; })) + 300,
    perDay: rs.reduce(function (s, x) { return s + (x.live ? x.day : 0); }, 0) };
}
function fxy(T, d, b) {                                  /* chart position of a point d km out on bearing b */
  var cx = T.W * 0.5, cy = T.H * 0.53, R = Math.min(T.W * 0.47, T.H * 0.46), r = R * Math.log(1 + d / 400) / Math.log(1 + FL.dmax / 400);
  return [cx + Math.sin(b) * r, cy - Math.cos(b) * r];
}
function endsOf(T, x) { var a = x.r.airport === 'CEI' ? fxy(T, FL.cei[0], FL.cei[1]) : fxy(T, 0, 0); return [a, fxy(T, x.d, x.b)]; }
function plane(k, x, y, ang, s, col) {
  k.save(); k.translate(x, y); k.rotate(ang);
  paper(k, function (q) { q.beginPath(); q.moveTo(s * 1.3, 0); q.lineTo(-s * 0.9, -s * 0.95); q.lineTo(-s * 0.45, 0); q.lineTo(-s * 0.9, s * 0.95); q.closePath(); }, col, 0.6);
  k.restore();
}
/* today's board (data/flightboard.json, AirLabs, refreshed through the day): a plane is drawn where its own
   clock puts it, the fraction of the way from its departure (actual, else estimated, else scheduled) to its
   arrival, along the same ray as its route */
var FB = null, FMODE = 'now', FHITS = [], FPLANE = null;
function tsOf(f, side) { return (f[side + '_actual_ts'] || f[side + '_estimated_ts'] || f[side + '_time_ts'] || 0) * 1000; }
function boardOn() { return FMODE === 'now' && FB && FB.flights && FB.flights.length && Date.now() - Date.parse(FB.generated) < 14 * 3600e3; }
function apt(T, i) { var ll = FL.d.ll && FL.d.ll[i]; if (i === 'CNX') return fxy(T, 0, 0); if (!ll) return null; var g = geo(FL.d.airports.CNX.ll, ll); return fxy(T, g[0], g[1]); }
function placeOf(i) { var r = FL.d.routes.filter(function (x) { return x.iata === i; })[0]; return r ? [r.th, r.en] : i === 'CNX' ? ['เชียงใหม่', 'Chiang Mai'] : i === 'CEI' ? ['เชียงราย', 'Chiang Rai'] : [i, i]; }
function alName(a) { var A = FL.d.airlines[a]; return A ? [A.th, A.en] : [a, a]; }
function inAir() { var n = Date.now(); return FB.flights.filter(function (f) { var a = tsOf(f, 'dep'), b = tsOf(f, 'arr'); return f.status !== 'cancelled' && a && b && n >= a && n < b; }); }
function drawFlights(k, T, t) {
  if (!FL) return;
  var W = T.W, Hh = T.H, cx = W * 0.5, cy = Hh * 0.53, R = Math.min(W * 0.47, Hh * 0.46), small = W < 520, i;
  var g = k.createRadialGradient(cx, cy, 0, cx, cy, R * 1.1); g.addColorStop(0, '#16233a'); g.addColorStop(1, '#0c1220');
  k.fillStyle = g; k.fillRect(0, 0, W, Hh);
  /* distance rings */
  k.font = '700 12px ' + SANS; k.textAlign = 'left'; k.textBaseline = 'middle';
  [500, 1000, 2000, 4000].forEach(function (km) {
    var r = R * Math.log(1 + km / 400) / Math.log(1 + FL.dmax / 400);
    k.strokeStyle = 'rgba(170,200,255,.16)'; k.setLineDash([2, 5]); k.beginPath(); k.arc(cx, cy, r, 0, 6.2832); k.stroke(); k.setLineDash([]);
    var rl = n0(km) + (en() ? ' km' : ' กม.'), rw = k.measureText(rl).width; k.fillStyle = 'rgba(215,226,245,.9)'; k.fillText(rl, Math.max(2, cx - r * 0.7071 - rw - 3), cy + r * 0.7071);
  });
  k.fillStyle = '#eef3ff'; k.font = '800 13px ' + SANS; k.textAlign = 'center'; k.fillText(en() ? 'N' : 'เหนือ', cx, cy - R - 2 < 8 ? 8 : cy - R - 2);
  /* routes: a ray per route, width by flights a month, dashed when out of season */
  var sel = FSEL, mx = Math.max.apply(null, FL.rs.map(function (x) { return x.r.per_month; }));
  FL.rs.forEach(function (x) {
    var e = endsOf(T, x), hot = !sel || x.r.airlines.indexOf(sel) >= 0;
    k.strokeStyle = x.r.dom ? 'rgba(255,194,102,' + (hot ? 0.55 : 0.1) + ')' : 'rgba(127,216,255,' + (hot ? 0.5 : 0.1) + ')';
    k.lineWidth = 0.8 + 4 * Math.sqrt(x.r.per_month / mx); if (!x.live) k.setLineDash([3, 4]);
    k.beginPath(); k.moveTo(e[0][0], e[0][1]); k.lineTo(e[1][0], e[1][1]); k.stroke(); k.setLineDash([]);
  });
  /* planes: today's, where they are now; or a day in a minute (t ms → day fraction) */
  var DAY = 60000, now = (t % DAY) / DAY, live = boardOn();
  FHITS = [];
  if (live) inAir().forEach(function (f) {
    var a = apt(T, f.dep_iata), b = apt(T, f.arr_iata); if (!a || !b) return;
    var u = (Date.now() - tsOf(f, 'dep')) / (tsOf(f, 'arr') - tsOf(f, 'dep')), px = a[0] + (b[0] - a[0]) * u, py = a[1] + (b[1] - a[1]) * u;
    if (sel && f.airline_iata !== sel) return;
    var col = FL.lines[f.airline_iata] ? FL.lines[f.airline_iata].col : '#ffffff', hot = FPLANE === f;
    if (hot) { k.strokeStyle = '#fff'; k.lineWidth = 1.5; k.beginPath(); k.arc(px, py, 11, 0, 6.2832); k.stroke(); }
    plane(k, px, py, Math.atan2(b[1] - a[1], b[0] - a[0]), small ? 6 : 7, col);
    FHITS.push({ f: f, x: px, y: py });
  });
  else FL.rs.forEach(function (x, ri) {
    if (!x.live || (sel && x.r.airlines.indexOf(sel) < 0)) return;
    var e = endsOf(T, x), dur = (x.d / 750 + 0.4) / 24, n = Math.max(1, Math.round(x.day * 2)), ph = (hash(x.r.iata + x.r.airport) % 1000) / 1000;
    for (i = 0; i < n; i++) {
      var start = (i + ph) / n, p = (now - start + 2) % 1; if (p > dur) continue;
      var u = p / dur, out = i % 2 === 0, a = out ? e[0] : e[1], b = out ? e[1] : e[0];
      var ease = u * u * (3 - 2 * u), px = a[0] + (b[0] - a[0]) * ease, py = a[1] + (b[1] - a[1]) * ease;
      var al = sel && x.r.airlines.indexOf(sel) >= 0 ? sel : x.r.airlines[i % x.r.airlines.length];
      plane(k, px, py, Math.atan2(b[1] - a[1], b[0] - a[0]), small ? 4.5 : 5.5, FL.lines[al].col);
    }
  });
  /* destinations: a dot per airport (size by flights), names on the busiest and on the chosen */
  var seen = {}, labels = [];
  FL.rs.slice().sort(function (a, b) { return b.r.per_month - a.r.per_month; }).forEach(function (x) {
    if (seen[x.r.iata]) return; seen[x.r.iata] = 1;
    var p = fxy(T, x.d, x.b), tot = FL.rs.filter(function (y) { return y.r.iata === x.r.iata; }).reduce(function (s, y) { return s + y.r.per_month; }, 0);
    var r = 2.2 + Math.sqrt(tot) * 0.16, hot = !sel || FL.rs.some(function (y) { return y.r.iata === x.r.iata && y.r.airlines.indexOf(sel) >= 0; });
    paper(k, function (q) { disc(q, p[0], p[1], r); }, hot ? (x.r.dom ? '#ffc266' : '#7fd8ff') : '#3a4660', 0.5);
    labels.push({ x: p[0], y: p[1], r: r, t: x.r.iata, hot: hot, big: tot });
  });
  k.font = '800 ' + (small ? 12 : 13) + 'px ' + MONO; k.textBaseline = 'middle';
  var taken = [];
  labels.forEach(function (l) {
    if (!l.hot) return;
    var w = k.measureText(l.t).width, lx = Math.max(3, Math.min(W - w - 3, l.x + (l.x >= cx ? l.r + 3 : -l.r - 3 - w))), box = [lx - 3, l.y - 9, lx + w + 3, l.y + 9];
    if (taken.some(function (b) { return !(box[2] < b[0] || box[0] > b[2] || box[3] < b[1] || box[1] > b[3]); })) return;
    taken.push(box); k.fillStyle = 'rgba(8,12,20,.9)'; k.fillRect(box[0], box[1], box[2] - box[0], box[3] - box[1]);
    k.fillStyle = '#f2f6ff'; k.textAlign = 'left'; k.fillText(l.t, lx, l.y + 0.5);
  });
  /* the two home airports */
  var cei = fxy(T, FL.cei[0], FL.cei[1]);
  [[cx, cy, 'CNX'], [cei[0], cei[1], 'CEI']].forEach(function (h) {
    paper(k, function (q) { disc(q, h[0], h[1], 6); }, '#ffffff', 1);
    k.fillStyle = '#0b0f18'; k.font = '800 7px ' + MONO; k.textAlign = 'center'; k.fillText('✈', h[0], h[1] + 0.5);
  });
  k.font = '800 13px ' + MONO; k.textBaseline = 'middle'; [['CNX', cx - 9, cy + 1, 'right'], ['CEI', cei[0] + 9, cei[1] - 8, 'left']].forEach(function (h) { var w = k.measureText(h[0]).width, bx = h[3] === 'right' ? h[1] - w : h[1]; k.fillStyle = 'rgba(8,12,20,.9)'; k.fillRect(bx - 3, h[2] - 9, w + 6, 18); k.fillStyle = '#fff'; k.textAlign = 'left'; k.fillText(h[0], bx, h[2] + 0.5); });
  /* the clock: the hour now, or where in the minute-long day we are */
  if (live) { var bn = bkk(Date.now()); now = (bn.getUTCHours() + bn.getUTCMinutes() / 60) / 24; }
  var hr = now * 24, ccx = W - 30, ccy = 30, cr = 21;
  k.strokeStyle = 'rgba(255,255,255,.35)'; k.lineWidth = 1.5; k.beginPath(); k.arc(ccx, ccy, cr, 0, 6.2832); k.stroke();
  k.strokeStyle = '#ffc266'; k.lineWidth = 2.5; k.beginPath(); k.arc(ccx, ccy, cr, -Math.PI / 2, -Math.PI / 2 + now * 6.2832); k.stroke();
  k.fillStyle = '#fff'; k.font = '800 11px ' + MONO; k.textAlign = 'center'; k.fillText(live ? hhmm(Date.now()) : String(Math.floor(hr)).padStart(2, '0') + ':00', ccx, ccy + 0.5);
}
/* today at CNX and CEI by the board: arrivals and departures by the hour, and how those already due ran */
function fDay() {
  var td = ymd(Date.now()), n = Date.now(), per = [], seen = {}, r = { all: 0, due: 0, late: 0, cx: 0, per: per }, i;
  for (i = 0; i < 24; i++) per.push(0);
  FB.flights.forEach(function (f) {
    ['dep', 'arr'].forEach(function (side) {
      var ap = f[side + '_iata'], t = f[side + '_time'], key = f.flight_iata + side;
      if ((ap !== 'CNX' && ap !== 'CEI') || !t || t.slice(0, 10) !== td || seen[key]) return;
      seen[key] = 1; r.all++; per[+t.slice(11, 13)]++;
      if ((f[side + '_time_ts'] || 0) * 1000 > n) return;
      r.due++;
      var dl = f[side + '_delayed'] != null ? f[side + '_delayed'] : f.delayed || 0;
      if (f.status === 'cancelled') r.cx++; else if (dl >= 15) r.late++;
    });
  });
  r.busy = per.indexOf(Math.max.apply(null, per));
  r.ok = r.due ? Math.round((r.due - r.late - r.cx) / r.due * 100) : null;
  return r;
}
function flightsCard() {
  if (!FL) return;
  var hr = bkk(Date.now()).getUTCHours(), fb = FB && FB.flights && FB.flights.length ? fDay() : null, live = boardOn();
  MDNOW.card('flights', { l: ['เครื่องบิน', 'Flights'],
    v: live ? inAir().length + '<small>' + bi('ลำบินอยู่', 'aloft') + '</small>' : n0(FL.perDay) + '<small>' + bi('/วัน', '/day') + '</small>',
    s: fb && fb.ok != null ? ['ตรงเวลา ' + fb.ok + '%', fb.ok + '% on time'] : fb ? ['วันนี้ ' + fb.all + ' เที่ยว', fb.all + ' today'] : [Object.keys(FL.lines).length + ' สายการบิน', Object.keys(FL.lines).length + ' airlines'],
    g: fb ? spark(fb.per, { hi: hr }) : '' });
}
function flightsCap(pick) {
  var F = FL; if (!F) return;
  flightsCard();
  var dests = {}; F.rs.forEach(function (x) { dests[x.r.iata] = 1; });
  var nRoutes = F.rs.filter(function (x) { return x.live; }).length, asof = dayStr(F.d.as_of);
  var live = boardOn(), h = '';
  if (FB && FB.flights && FB.flights.length) h += '<div class="tchips" role="group" aria-label="มุมมอง · view">' + [['now', 'ตอนนี้', 'Now'], ['day', 'หนึ่งวันในหนึ่งนาที', 'A day in a minute']].map(function (v) {
    return '<button type="button" class="tchip" data-fmode="' + v[0] + '" aria-pressed="' + (FMODE === v[0]) + '">' + bi(v[1], v[2]) + '</button>'; }).join('') + '</div>';
  if (live) h += boardHtml();
  else h += '<p class="tline">' + bi(nRoutes + ' เส้นทางบินตรง ลงจอดราว ' + n0(F.perDay) + ' เที่ยวต่อวัน · หนึ่งวันในหนึ่งนาที',
      nRoutes + ' nonstop routes, about ' + n0(F.perDay) + ' landings a day · a day in a minute') + '</p>';
  if (pick) {
    var rr = F.rs.filter(function (x) { return x.r.iata === pick; }), r0 = rr[0].r;
    h += '<p class="tpick"><b>' + bi(esc(r0.th), esc(r0.en)) + '</b> · ' + bi(esc(r0.country_th), esc(r0.country_en)) + '<br>' +
      rr.map(function (x) {
        var s = x.r.season;
        return bi('จาก ' + x.r.airport + ' ' + x.r.per_month + ' เที่ยวต่อเดือน', 'from ' + x.r.airport + ', ' + x.r.per_month + ' a month') +
          (s ? ' (' + bi(esc(s.th), esc(s.en)) + ')' : '') + ' · ' + x.r.airlines.map(function (a) { var A = F.d.airlines[a] || { th: a, en: a }; return bi(esc(A.th), esc(A.en)); }).join(', ') +
          ' · ' + bi(n0(x.d) + ' กม.', n0(x.d) + ' km') + (x.r.block_min ? ' · ' + bi('บินราว ' + x.r.block_min + ' นาที', 'about ' + x.r.block_min + ' min in the air') : '');
      }).join('<br>') + '</p>';
  }
  var al = Object.keys(F.lines).sort(function (a, b) { return F.lines[b].n - F.lines[a].n; }), chip = function (a) {
    var A = F.d.airlines[a] || { th: a, en: a };
    return '<button type="button" class="tchip" data-air="' + a + '" aria-pressed="' + (FSEL === a) + '"><i style="background:' + F.lines[a].col + '"></i>' + bi(esc(A.th), esc(A.en)) + ' <small>' + F.lines[a].n + '</small></button>';
  };
  h += '<details class="tmore"' + (FSEL ? ' open' : '') + '><summary>' + bi('สายการบิน ' + al.length, al.length + ' airlines') + '</summary><div class="tchips" role="group" aria-label="สายการบิน · airlines">' + al.map(chip).join('') + '</div></details>';
  h += '<p class="tsrc">' + (live ? bi('สถานะเที่ยวบินจาก AirLabs อัปเดต ' + FB.generated.slice(11, 16) + ' · เส้นทางจากตารางบิน ' + asof[0], 'flight status from AirLabs, updated ' + FB.generated.slice(11, 16) + ' · routes from the timetable of ' + asof[1]) + ' · ' + bi('แตะเครื่องบินเพื่อดูเที่ยวบิน', 'tap a plane for its flight')
    : bi('ตารางบิน ณ ' + asof[0] + ' · เครื่องบินเว้นระยะเท่ากันตามจำนวนเที่ยว ไม่ใช่เวลาจริงของวันนี้', 'timetable as of ' + asof[1] + ' · planes are spaced evenly by each route\'s count, not at today\'s times')) +
    ' · <a href="' + LIVE + 'flights.html">' + bi('ใครบินมาที่นี่', 'Who flies here') + ' →</a></p>';
  cap('t-flights', h);
}
function stat(f) {                                     /* a flight's state in words */
  var d = f.delayed || f.dep_delayed || f.arr_delayed;
  if (f.status === 'cancelled') return ['ยกเลิก', 'cancelled', 'bad'];
  if (f.status === 'landed') return ['ลงแล้ว', 'landed', ''];
  if (f.status === 'active') return ['บินอยู่', 'in the air', 'ok'];
  if (d >= 15) return ['ช้า ' + d + ' นาที', d + ' min late', 'late'];
  return ['ตรงเวลา', 'on time', 'ok'];
}
function fRow(f, side) {
  var other = side === 'dep' ? f.arr_iata : f.dep_iata, pl = placeOf(other), st = stat(f), t = f[side + '_estimated'] || f[side + '_time'];
  var sched = f[side + '_time'], moved = t && sched && t !== sched;
  return '<li class="fb ' + st[2] + '"><b>' + (t || '').slice(11, 16) + '</b>' + (moved ? ' <s>' + sched.slice(11, 16) + '</s>' : '') + ' ' + esc(f.flight_iata) + ' ' +
    bi((side === 'dep' ? 'ไป ' : 'จาก ') + esc(pl[0]), (side === 'dep' ? 'to ' : 'from ') + esc(pl[1])) + ' · <span class="st">' + bi(st[0], st[1]) + '</span></li>';
}
function boardHtml() {
  var n = Date.now(), air = inAir(), h = '';
  var next = function (side) { return FB.flights.filter(function (f) { return f[side + '_iata'] === 'CNX' || f[side + '_iata'] === 'CEI'; })
    .filter(function (f) { return tsOf(f, side) > n - 10 * 60e3 && !(side === 'dep' && (f.status === 'active' || f.status === 'landed')) && f.status !== 'landed'; })
    .sort(function (a, b) { return tsOf(a, side) - tsOf(b, side); }).slice(0, 4); };
  var fd = fDay();
  h += '<p class="tline">' + bi('ในอากาศ ' + air.length + ' ลำ · วันนี้ ' + fd.all + ' เที่ยวขึ้นลง' + (fd.due ? ' · ตรงเวลา ' + fd.ok + '% ช้า ' + fd.late + (fd.cx ? ' ยกเลิก ' + fd.cx : '') : '') + ' · คึกสุด ' + String(fd.busy).padStart(2, '0') + ':00',
    air.length + ' in the air · ' + fd.all + ' in and out today' + (fd.due ? ' · ' + fd.ok + '% on time, ' + fd.late + ' late' + (fd.cx ? ', ' + fd.cx + ' cancelled' : '') : '') + ' · busiest ' + String(fd.busy).padStart(2, '0') + ':00') + '</p>';
  if (FPLANE) {
    var f = FPLANE, al = alName(f.airline_iata), A = placeOf(f.dep_iata), B = placeOf(f.arr_iata), st = stat(f);
    h += '<p class="tpick"><b>' + esc(f.flight_iata) + ' ' + bi(esc(al[0]), esc(al[1])) + '</b><br>' + bi(esc(A[0]) + ' → ' + esc(B[0]), esc(A[1]) + ' → ' + esc(B[1])) + ' · ' +
      bi('ออก ' + (f.dep_actual || f.dep_estimated || f.dep_time).slice(11, 16) + ' ถึงราว ' + (f.arr_estimated || f.arr_time).slice(11, 16), 'off ' + (f.dep_actual || f.dep_estimated || f.dep_time).slice(11, 16) + ', due ' + (f.arr_estimated || f.arr_time).slice(11, 16)) +
      (f.aircraft_icao ? ' · ' + esc(f.aircraft_icao) : '') + (f.arr_gate ? ' · ' + bi('ประตู ' + esc(f.arr_gate), 'gate ' + esc(f.arr_gate)) : '') + ' · ' + bi(st[0], st[1]) + '</p>';
  }
  h += '<div class="fboard"><div><h4>' + bi('เที่ยวบินขาออก', 'Departures') + '</h4><ul>' + next('dep').map(function (f) { return fRow(f, 'dep'); }).join('') + '</ul></div>' +
    '<div><h4>' + bi('เที่ยวบินขาเข้า', 'Arrivals') + '</h4><ul>' + next('arr').map(function (f) { return fRow(f, 'arr'); }).join('') + '</ul></div></div>';
  return h;
}
function flightsTap(px, py, T) {
  if (!FL) return;
  if (boardOn()) {
    var hit = null, hd = 18;
    FHITS.forEach(function (q) { var d = Math.hypot(q.x - px, q.y - py); if (d < hd) { hd = d; hit = q.f; } });
    if (hit) { FPLANE = hit; flightsCap(); return; }
  }
  var best = null, bd = 22;
  FL.rs.forEach(function (x) { var p = fxy(T, x.d, x.b), d = Math.hypot(p[0] - px, p[1] - py); if (d < bd) { bd = d; best = x.r.iata; } });
  flightsCap(best);
}

/* ======================================================================== ROADS
   Each counted section of highway, drawn on its own line, carries traffic at its count: one moving car-dot per
   ~2,000 vehicles a day and one motorcycle-dot per ~2,000 motorcycles, spaced along the line, moving at a
   speed set by the section's grade (A, free-flowing, fastest; F, jammed, slowest). A plain equirectangular
   projection, x scaled by cos(latitude). */
var RD = null, RVIEW = 'city';
var GRADE = { A: '#5fd18a', B: '#a5d65a', C: '#f2d14b', D: '#f5a34a', E: '#f0703f', F: '#e5455a' };
var GSPEED = { A: 1, B: 0.85, C: 0.7, D: 0.5, E: 0.35, F: 0.22 };
var BOXES = { city: [98.86, 18.66, 99.12, 18.9], prov: [98.08, 17.4, 100.52, 20.46] };
function roadsPrep(d) {
  d.roads.forEach(function (r) {
    r.segs = r.lines.map(function (ln) {
      var L = 0, cum = [0];
      for (var i = 1; i < ln.length; i++) { L += Math.hypot((ln[i][0] - ln[i - 1][0]) * Math.cos(18.8 * Math.PI / 180), ln[i][1] - ln[i - 1][1]) * 111.32; cum.push(L); }
      return { ln: ln, cum: cum, km: L };
    });
    r.km = r.segs.reduce(function (s, x) { return s + x.km; }, 0);
  });
  d.roads.sort(function (a, b) { return a.motor - b.motor; });
  RD = d;
}
function rxy(T, p) {
  var b = BOXES[RVIEW], kx = Math.cos(18.8 * Math.PI / 180), w = (b[2] - b[0]) * kx, h = b[3] - b[1];
  var Hm = T.H - (RD && RD.tomtom ? 44 : 0), s = Math.min((T.W - 16) / w, (Hm - 16) / h), ox = (T.W - w * s) / 2, oy = (Hm - h * s) / 2;
  return [ox + (p[0] - b[0]) * kx * s, oy + (b[3] - p[1]) * s];
}
function along(seg, f) {                                /* point at fraction f of a polyline */
  var want = f * seg.km, c = seg.cum, i = 1;
  while (i < c.length - 1 && c[i] < want) i++;
  var a = seg.ln[i - 1], b = seg.ln[i], u = c[i] === c[i - 1] ? 0 : (want - c[i - 1]) / (c[i] - c[i - 1]);
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
}
var RN = null;                                          /* data/traffic_now.json: TomTom flow measured on the busiest roads */
function rnFresh() { return RN && RN.roads && RN.roads.length && Date.now() - Date.parse(RN.generated) < 2 * 3600e3; }
function rnCol(x) { return x.closed ? '#ff4d6d' : x.ratio == null ? '#9aa4b2' : x.ratio >= 0.85 ? '#5fd18a' : x.ratio >= 0.6 ? '#f5a34a' : '#e5455a'; }
function rnOf(r) { return rnFresh() ? RN.roads.filter(function (x) { return x.route === r.route && x.name === r.name; })[0] : null; }
/* RNPICK: a measured stretch picked in the list or on the map; RHOUR: an hour picked on the strip (2026-10-10) */
var RNPICK = null, RHOUR = null, RFLASH = 0;
var RPICK = null, DEN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], DTH = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์', 'อาทิตย์'];
/* TomTom's congestion for this weekday and hour, scaled by the month (the traffic page's own sum):
   c = week[dow][h] × month[m] ÷ year;  a 10-minute drive takes 10 × (1 + c/100) */
function cong(ms, h) {
  var TT = RD && RD.tomtom; if (!TT) return null;
  var b = bkk(ms), dow = (b.getUTCDay() + 6) % 7, hr = h == null ? b.getUTCHours() : h, c = TT.week[dow][hr] * TT.month[b.getUTCMonth()] / TT.year_c;
  return { c: c, min: 10 * (1 + c / 100), dow: dow, h: hr };
}
function drawRoads(k, T, t) {
  if (!RD) return;
  k.fillStyle = '#0f141c'; k.fillRect(0, 0, T.W, T.H);
  if (RVIEW === 'city') {                                /* the old city's square, for bearings */
    var a = rxy(T, [98.9786, 18.7963]), b = rxy(T, [98.9953, 18.7826]);
    k.strokeStyle = 'rgba(95,170,230,.55)'; k.lineWidth = 3; k.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
    k.fillStyle = '#eef3ff'; k.font = '700 12px ' + SANS; k.textAlign = 'center'; k.fillText(en() ? 'old city' : 'คูเมือง', (a[0] + b[0]) / 2, a[1] - 8);
  }
  var mx = RD.roads[RD.roads.length - 1].motor;
  RD.roads.forEach(function (r) {                       /* the road itself, wide as its count */
    var hot = RPICK === r;
    k.strokeStyle = hot ? '#ffffff' : 'rgba(255,255,255,.14)'; k.lineWidth = (RVIEW === 'city' ? 2 : 1) + (RVIEW === 'city' ? 7 : 3.5) * Math.sqrt(r.motor / mx); k.lineCap = 'round'; k.lineJoin = 'round';
    r.segs.forEach(function (sg) { k.beginPath(); sg.ln.forEach(function (p, i) { var q = rxy(T, p); i ? k.lineTo(q[0], q[1]) : k.moveTo(q[0], q[1]); }); k.stroke(); });
  });
  if (rnFresh()) RN.roads.forEach(function (x) {        /* the stretches TomTom measured this half hour, coloured by speed */
    if (!x.line || x.line.length < 2) return;
    k.lineCap = 'round'; k.lineJoin = 'round';
    if (x === RNPICK) { k.strokeStyle = 'rgba(255,255,255,.9)'; k.lineWidth = RVIEW === 'city' ? 13 : 8; k.beginPath(); x.line.forEach(function (p, i) { var q = rxy(T, p); i ? k.lineTo(q[0], q[1]) : k.moveTo(q[0], q[1]); }); k.stroke(); }
    k.strokeStyle = 'rgba(8,10,16,.85)'; k.lineWidth = RVIEW === 'city' ? 7 : 4; k.beginPath(); x.line.forEach(function (p, i) { var q = rxy(T, p); i ? k.lineTo(q[0], q[1]) : k.moveTo(q[0], q[1]); }); k.stroke();
    k.strokeStyle = rnCol(x); k.lineWidth = RVIEW === 'city' ? 4 : 2.2; k.stroke();
  });
  if (RNPICK && RNPICK.line && !REDUCED) {                /* a picked stretch answers with a ring */
    var age = (performance.now() - RFLASH) / 900;
    if (age < 1) { var mp = rxy(T, RNPICK.line[Math.floor(RNPICK.line.length / 2)]); k.strokeStyle = 'rgba(255,255,255,' + (1 - age) + ')'; k.lineWidth = 3; k.beginPath(); k.arc(mp[0], mp[1], 6 + age * 26, 0, 6.2832); k.stroke(); }
  }
  var sec = t / 1000, now = cong(Date.now()), hf = now ? 1.45 / (1 + now.c / 100) : 1;   /* slower in the jammed hours */
  RD.roads.forEach(function (r) {                       /* the traffic on it */
    var col = GRADE[r.grade] || '#c8d0da', sp = (GSPEED[r.grade] || 0.6) * (RVIEW === 'city' ? 0.9 : 3.5) * hf;
    r.segs.forEach(function (sg, si) {
      if (sg.km < 0.05) return;
      var cars = Math.max(1, Math.round(r.motor / 2000 * sg.km / Math.max(r.km, 0.01))), motos = Math.round(r.moto / 2000 * sg.km / Math.max(r.km, 0.01)), i;
      for (i = 0; i < cars; i++) {
        var dir = i % 2 ? 1 : -1, f = ((i / cars + dir * sec * sp / sg.km) % 1 + 1) % 1, p = rxy(T, along(sg, f));
        k.fillStyle = col; k.fillRect(p[0] - 1.6, p[1] - 1.6, 3.2, 3.2);
      }
      for (i = 0; i < motos; i++) {
        var dir2 = i % 2 ? -1 : 1, f2 = ((i / motos + 0.37 + dir2 * sec * sp * 1.15 / sg.km) % 1 + 1) % 1, p2 = rxy(T, along(sg, f2));
        k.fillStyle = '#ffffff'; k.beginPath(); k.arc(p2[0], p2[1], 1.1, 0, 6.2832); k.fill();
      }
    });
  });
  if (!now) return;
  /* today's 24 hours along the foot: bar height = minutes for a 10-minute drive, this hour lit */
  var sh = 44, y0 = T.H - sh, bw = (T.W - 16) / 24, mxm = 0, hh, cs = [];
  for (hh = 0; hh < 24; hh++) { cs.push(cong(Date.now(), hh)); mxm = Math.max(mxm, cs[hh].min); }
  k.fillStyle = 'rgba(10,13,19,.88)'; k.fillRect(0, y0, T.W, sh);
  k.font = '700 11px ' + MONO; k.textAlign = 'center'; k.textBaseline = 'alphabetic';
  cs.forEach(function (x, i) {
    var bh = (x.min - 9) / (mxm - 9) * (sh - 18), bx = 8 + i * bw, on = i === now.h;
    k.fillStyle = on ? '#ffc266' : x.c >= 60 ? '#e5455a' : x.c >= 35 ? '#f5a34a' : '#5fd18a';
    k.globalAlpha = on ? 1 : 0.75; k.fillRect(bx + 1, T.H - 14 - bh, bw - 2, bh); k.globalAlpha = 1;
    if (i === RHOUR) { k.strokeStyle = '#fff'; k.lineWidth = 2; k.strokeRect(bx + 0.5, y0 + 2, bw - 1, sh - 16); }
    if (i % 6 === 0) { k.fillStyle = '#e6ecf5'; k.fillText(String(i).padStart(2, '0'), bx + bw / 2, T.H - 2); }
  });
}
/* the usual worst hour of today's waking hours, and the clearest, from TomTom's week */
function roadsWorst() {
  var w = null, b = null;
  for (var hh = 6; hh <= 21; hh++) { var c = cong(Date.now(), hh); if (!c) return null; if (!w || c.c > w.c) w = c; if (!b || c.c < b.c) b = c; }
  return { w: w, b: b };
}
function roadsCard() {
  if (!RD) return;
  var nw = cong(Date.now()), cs = [], wb = roadsWorst(), hh;
  if (nw) for (hh = 0; hh < 24; hh++) cs.push(cong(Date.now(), hh).min - 9);
  var ms = rnFresh() ? RN.roads.filter(function (x) { return x.ratio != null; }) : [], avg = ms.length ? ms.reduce(function (s2, x) { return s2 + x.ratio; }, 0) / ms.length : null;
  var slow = ms.slice().sort(function (a, b) { return a.ratio - b.ratio; })[0];
  MDNOW.card('roads', { l: ['ถนน', 'Roads'],
    v: avg != null ? Math.round(avg * 100) + '<small>%</small>' : nw ? Math.round(nw.min) + '<small>' + bi('นาที', 'min') + '</small>' : n0(RD.roads[RD.roads.length - 1].motor),
    s: wb ? ['ติดสุดราว ' + String(wb.w.h).padStart(2, '0') + ':00', 'worst ~' + String(wb.w.h).padStart(2, '0') + ':00'] : slow ? ['ช้าสุด ' + slow.cur + ' กม./ชม.', 'slowest ' + slow.cur + ' km/h'] : null,
    g: cs.length ? spark(cs, { col: function (v, i) { var c = cong(Date.now(), i); return i === nw.h ? '#b0442e' : c.c >= 60 ? '#c2453a' : c.c >= 35 ? '#d98a2b' : '#4f9a5c'; } }) : '' });
}
function roadsCap() {
  if (!RD) return;
  roadsCard();
  var top = RD.roads[RD.roads.length - 1], r = RPICK || top, yr = RD.year_be;
  var h = '<div class="tchips" role="group" aria-label="มุมมอง · view">' + [['city', 'ในเมือง', 'City'], ['prov', 'ทั้งจังหวัด', 'Province']].map(function (v) {
    return '<button type="button" class="tchip" data-rview="' + v[0] + '" aria-pressed="' + (RVIEW === v[0]) + '">' + bi(v[1], v[2]) + '</button>'; }).join('') +
    '<span class="tlegend">' + 'ABCDEF'.split('').map(function (g) { return '<i style="background:' + GRADE[g] + '"></i>' + g; }).join(' ') + '</span></div>';
  var list = '';
  if (rnFresh()) {
    var ms = RN.roads.filter(function (x) { return x.ratio != null || x.closed; }), when = RN.generated.slice(11, 16);
    var avg = ms.reduce(function (s2, x) { return s2 + (x.ratio || 0); }, 0) / Math.max(1, ms.length);
    var st = ms.some(function (x) { return x.closed; }) ? ['มีถนนปิด', 'A road is closed', '#ff4d6d'] : avg >= 0.85 ? ['รถวิ่งคล่อง', 'Moving freely', '#5fd18a'] : avg >= 0.65 ? ['ช้าบางช่วง', 'Slow in places', '#f5a34a'] : ['ติดหลายช่วง', 'Jammed in places', '#e5455a'];
    h += '<p class="tline rstat"><i style="background:' + st[2] + '"></i>' + bi(st[0], st[1]) + ' · ' + bi('วัดเมื่อ ' + when + ' ถนนสายหลัก ' + ms.length + ' สาย วิ่งได้ ' + Math.round(avg * 100) + '% ของความเร็วตอนถนนโล่ง',
      'measured at ' + when + ', ' + ms.length + ' main roads at ' + Math.round(avg * 100) + '% of free-flow speed') + '</p>';
    var rows = ms.slice().sort(function (a, b) { return (a.closed ? -1 : a.ratio) - (b.closed ? -1 : b.ratio); });
    function row(x) {
      var pc = x.closed ? 0 : Math.round(Math.min(1, x.ratio) * 100);
      return '<button type="button" class="rnrow" data-rn="' + RN.roads.indexOf(x) + '" aria-pressed="' + (x === RNPICK) + '"><span class="rnn">' + bi('ทล. ' + esc(x.route), 'Rt ' + esc(x.route)) + ' ' + esc(x.name) + '</span>' +
        '<span class="rnb"><i style="width:' + Math.max(4, pc) + '%;background:' + rnCol(x) + '"></i></span><b>' + (x.closed ? bi('ปิด', 'closed') : x.cur + '<small>/' + x.free + '</small>') + '</b></button>';
    }
    list = '<div class="rnlist"><p class="rnh">' + bi('ถนนที่วัดได้ ช้าสุดก่อน · กม./ชม. ตอนนี้/ตอนโล่ง', 'Measured roads, slowest first · km/h now / free flow') + '</p>' + rows.slice(0, 4).map(row).join('') +
      (rows.length > 4 ? '<details class="tmore"' + (RNPICK && rows.indexOf(RNPICK) >= 4 ? ' open' : '') + '><summary>' + bi('อีก ' + (rows.length - 4) + ' สาย', (rows.length - 4) + ' more') + '</summary>' + rows.slice(4).map(row).join('') + '</details>' : '') + '</div>';
  }
  var nw = cong(Date.now());
  if (nw) {
    var wb = roadsWorst(), hs = function (x) { return String(x.h).padStart(2, '0') + ':00'; };
    h += '<p class="tline">' + bi('ขับ 10 นาทีในเมือง ปกติตอนนี้ใช้ ' + Math.round(nw.min) + ' นาที' + (wb ? ' · ติดสุด ' + hs(wb.w) + ' (' + Math.round(wb.w.min) + ') · โล่งสุด ' + hs(wb.b) + ' (' + Math.round(wb.b.min) + ')' : ''),
      'A 10-minute drive in town: usually ' + Math.round(nw.min) + ' now' + (wb ? ' · worst ' + hs(wb.w) + ' (' + Math.round(wb.w.min) + ') · clearest ' + hs(wb.b) + ' (' + Math.round(wb.b.min) + ')' : '')) + '</p>';
    /* worth waiting? the next four waking hours, when one saves two minutes in ten */
    var best = null;
    for (var a = 1; a <= 4; a++) { var c2 = cong(Date.now() + a * 3600e3); if (c2.h >= 6 && c2.h <= 21 && (!best || c2.min < best.min)) best = c2; }
    if (best && nw.h >= 6 && nw.min - best.min >= 2) h += '<p class="rlater">' + bi('ถ้าออกตอน ' + String(best.h).padStart(2, '0') + ':00 ปกติเหลือราว ' + Math.round(best.min) + ' นาที (ตอนนี้ ' + Math.round(nw.min) + ')',
      'Leave at ' + String(best.h).padStart(2, '0') + ':00 and it is usually about ' + Math.round(best.min) + ' minutes (' + Math.round(nw.min) + ' now)') + '</p>';
    if (RHOUR != null) {
      var rh = cong(Date.now(), RHOUR);
      h += '<p class="rlater on">' + bi('วัน' + DTH[rh.dow] + ' ' + String(RHOUR).padStart(2, '0') + ':00 ปกติ ขับ 10 นาทีใช้ราว ' + Math.round(rh.min) + ' นาที (รถติดกว่าตอนโล่ง ' + Math.round(rh.c) + '%)',
        DEN[rh.dow] + ' ' + String(RHOUR).padStart(2, '0') + ':00 usually: a 10-minute drive takes about ' + Math.round(rh.min) + ' minutes (' + Math.round(rh.c) + '% over free flow)') + '</p>';
    }
  }
  if (RPICK) h += '<p class="tpick"><b>' + bi('ทางหลวง ' + esc(r.route), 'Route ' + esc(r.route)) + ' ' + esc(r.name) + '</b><br>' +
    bi(n0(r.motor) + ' คันต่อวัน และรถจักรยานยนต์ ' + n0(r.moto) + ' คัน · รถหนัก ' + r.heavy + '% · ระดับ ' + (r.grade || '–'),
       n0(r.motor) + ' vehicles a day and ' + n0(r.moto) + ' motorcycles · ' + r.heavy + '% heavy · grade ' + (r.grade || '–')) +
    (RPICK ? '' : ' · ' + bi('ถนนที่รถมากที่สุด', 'the busiest')) +
    (rnOf(r) ? '<br>' + bi('วัดเมื่อ ' + RN.generated.slice(11, 16) + ': ' + rnOf(r).cur + ' กม./ชม. (ถนนโล่ง ' + rnOf(r).free + ')', 'measured at ' + RN.generated.slice(11, 16) + ': ' + rnOf(r).cur + ' km/h (free flow ' + rnOf(r).free + ')') : '') + '</p>';
  h += list;
  h += '<p class="tsrc">' + bi('จุดสี่เหลี่ยม = รถราว 2,000 คันต่อวัน จุดขาว = รถจักรยานยนต์ 2,000 คัน · ระดับ A คล่องตัวถึง F ติดขัด · วันเฉลี่ยของปี ' + yr + ' กรมทางหลวง',
    'square = about 2,000 vehicles a day, white dot = 2,000 motorcycles · grade A free-flowing to F jammed · an average day, ' + (yr - 543) + ', Department of Highways') + ' · ' + bi('เส้นสีหนา = ความเร็วที่ TomTom วัดได้ทุกครึ่งชั่วโมง เขียวโล่ง ส้มช้า แดงติด · แถบชั่วโมงจาก TomTom Traffic Index 2025', 'thick coloured lines = speed TomTom measures every half hour, green clear, orange slow, red jammed · hour bars from the TomTom Traffic Index 2025') + ' · ' + bi('แตะถนนเพื่อดูตัวเลข แตะแถบชั่วโมงเพื่อดูชั่วโมงนั้น', 'tap a road for its count, an hour bar for that hour') +
    ' · <a href="' + LIVE + 'traffic.html">' + bi('รถติด ทุกชั่วโมง ทุกถนน', 'Traffic by hour and road') + ' →</a></p>';
  cap('t-roads', h);
}
function roadsTap(px, py, T) {
  if (!RD) return;
  if (RD.tomtom && py > T.H - 44) {                     /* the hour strip */
    var hr = Math.floor((px - 8) / ((T.W - 16) / 24));
    if (hr >= 0 && hr < 24) { RHOUR = RHOUR === hr ? null : hr; roadsCap(); if (ROADS) ROADS.paint(); }
    return;
  }
  var best = null, bd = 14, bm = null, bmd = 12;
  if (rnFresh()) RN.roads.forEach(function (x) { (x.line || []).forEach(function (p) { var q = rxy(T, p), d = Math.hypot(q[0] - px, q[1] - py); if (d < bmd) { bmd = d; bm = x; } }); });
  RD.roads.forEach(function (r) { r.segs.forEach(function (sg) { sg.ln.forEach(function (p) { var q = rxy(T, p), d = Math.hypot(q[0] - px, q[1] - py); if (d < bd) { bd = d; best = r; } }); }); });
  RNPICK = bm || (best ? rnOf(best) : null) || null; RFLASH = performance.now();
  if (bm && !best) best = RD.roads.filter(function (r) { return r.route === bm.route && r.name === bm.name; })[0] || null;
  RPICK = best; roadsCap(); if (ROADS) ROADS.paint();
}

/* ======================================================================== FILMS
   Today's screenings in the reader's province on one strip of film: a row per film, a frame per show as long
   as the film runs, the playhead at now. Frames running now glow and their sprockets roll. */
var FM = null, FPICK = null;
function filmsPrep(d) {
  var today = ymd(Date.now()), by = {}, cines = d.cinemas.filter(function (c) { return c.province === PROV; });
  cines.forEach(function (c) {
    (c.days[today] || []).forEach(function (m) {
      var f = by[m.title] || (by[m.title] = { title: m.title, en: latin(m.slug), min: m.minutes || 110, shows: [] });
      m.times.forEach(function (tm) { f.shows.push({ tm: tm, c: c }); });
    });
  });
  var films = Object.keys(by).map(function (k) { by[k].shows.sort(function (a, b) { return a.tm < b.tm ? -1 : 1; }); return by[k]; });
  films.sort(function (a, b) { return b.shows.length - a.shows.length; });
  FM = { films: films, cines: cines, today: today, src: d.source };
}
/* Major's own Latin address for the film, as its English title (films_layer.latin): saming-kao-kwang -> Saming Kao Kwang */
var SMALL = { and: 1, at: 1, of: 1, the: 1, 'in': 1, on: 1, a: 1, an: 1, to: 1, 'with': 1, 'for': 1 };
function latin(slug) { return slug ? slug.split('-').map(function (x, i) { return i && SMALL[x] ? x : x.charAt(0).toUpperCase() + x.slice(1); }).join(' ') : ''; }
function ftitle(f) { return en() && f.en ? f.en : f.title; }
function mins(tm) { return +tm.slice(0, 2) * 60 + +tm.slice(3, 5); }
var FROWS = [];
function drawFilms(k, T, t) {
  if (!FM) return;
  var W = T.W, Hh = T.H, nowM = mins(hhmm(Date.now())), films = FM.films.slice(0, W < 520 ? 6 : 8), x0 = 8, x1 = W - 8, top = 26, rh = Math.min(32, (Hh - top - 8) / Math.max(1, films.length));
  var m0 = 9 * 60, m1 = 26 * 60, X = function (m) { return x0 + (m - m0) / (m1 - m0) * (x1 - x0); };
  k.fillStyle = '#121019'; k.fillRect(0, 0, W, Hh);
  k.font = '700 12px ' + MONO; k.textAlign = 'center'; k.textBaseline = 'middle';
  for (var h = 10; h <= 25; h += (W < 520 ? 3 : 2)) { var hx = X(h * 60); k.fillStyle = '#efe8ff'; k.fillText(String(h % 24).padStart(2, '0'), hx, 10); k.fillStyle = 'rgba(255,255,255,.06)'; k.fillRect(hx, top - 4, 1, Hh - top); }
  FROWS = [];
  films.forEach(function (f, i) {
    var y = top + i * rh, fh = rh - 6, hue = hash(f.title) % 360;
    k.fillStyle = 'rgba(255,255,255,.04)'; k.fillRect(x0, y, x1 - x0, fh);
    f.shows.forEach(function (s) {
      var a = mins(s.tm), b = a + f.min, past = b < nowM, play = a <= nowM && nowM < b, sx = X(a), ex = X(b);
      var col = 'hsl(' + hue + ',' + (past ? 15 : 70) + '%,' + (past ? 32 : play ? 66 : 55) + '%)';
      paper(k, function (q) { q.beginPath(); q.rect(sx, y, Math.max(3, ex - sx - 1), fh); }, col, play ? 1.4 : 0.6);
      var off = play && !REDUCED ? (t / 120) % 6 : 0;                         /* the sprockets roll on a show that is running */
      k.fillStyle = 'rgba(10,8,16,.55)';
      for (var px = sx + 2 + off; px < ex - 3; px += 6) { k.fillRect(px, y + 1.5, 2.4, 2); k.fillRect(px, y + fh - 3.5, 2.4, 2); }
      if (play) { k.strokeStyle = '#fff'; k.lineWidth = 1.5; k.strokeRect(sx + 0.5, y + 0.5, Math.max(3, ex - sx - 2), fh - 1); }
      FROWS.push({ f: f, s: s, x0: sx, x1: ex, y0: y, y1: y + fh });
    });
    var ft = ftitle(f), tt = ft.length > 26 ? ft.slice(0, 25) + '…' : ft;              /* the title on its own dark tab */
    k.font = '700 ' + Math.min(13, fh * 0.6) + 'px ' + SANS; k.textAlign = 'left';
    var tw = k.measureText(tt).width; k.fillStyle = 'rgba(10,8,16,.86)'; k.fillRect(x0 + 2, y + 2, tw + 8, fh - 4);
    k.fillStyle = '#fff'; k.fillText(tt, x0 + 6, y + fh / 2 + 0.5);
  });
  var nx = X(nowM < m0 ? m0 : nowM);                                         /* the playhead */
  k.fillStyle = '#ffc266'; k.fillRect(nx - 1, top - 6, 2, Hh - top + 2);
  k.beginPath(); k.moveTo(nx - 5, top - 9); k.lineTo(nx + 5, top - 9); k.lineTo(nx, top - 3); k.closePath(); k.fill();
}
function filmsCap() {
  if (!FM) return;
  var nowS = hhmm(Date.now()), next = null, playing = 0, left = 0, last = '', per = [], hr = +nowS.slice(0, 2), i;
  for (i = 10; i <= 24; i++) per.push(0);
  FM.films.forEach(function (f) { f.shows.forEach(function (s) {
    var a = mins(s.tm); per[Math.max(0, Math.min(14, Math.floor(a / 60) - 10))]++;
    if (s.tm > nowS) { left++; if (s.tm > last) last = s.tm; if (!next || s.tm < next.s.tm) next = { f: f, s: s }; }
    if (a <= mins(nowS) && mins(nowS) < a + f.min) playing++; }); });
  MDNOW.card('films', { l: ['หนัง', 'Films'], v: next ? next.s.tm : FM.films.length + '<small>' + bi('เรื่อง', 'films') + '</small>',
    s: ['ฉายอยู่ ' + playing + ' · เหลือ ' + left + ' รอบ', playing + ' on · ' + left + ' left'], g: spark(per, { hi: hr - 10 }) });
  var pk = FPICK || next, P = PROV === 'cr' ? ['เชียงราย', 'Chiang Rai'] : ['เชียงใหม่', 'Chiang Mai'];
  var h = '<p class="tline">' + bi(FM.films.length + ' เรื่อง ' + FM.cines.length + ' โรงใน' + P[0] + ' · ฉายอยู่ ' + playing + ' · เหลือ ' + left + ' รอบ' + (last ? ' รอบสุดท้าย ' + last : ''),
    FM.films.length + ' films, ' + FM.cines.length + ' cinemas in ' + P[1] + ' · ' + playing + ' on now · ' + left + ' left' + (last ? ', last at ' + last : '')) + '</p>';
  if (pk) h += '<p class="tpick"><b>' + (FPICK ? '' : bi('รอบต่อไป ', 'Next: ')) + pk.s.tm + ' ' + (pk.f.en ? bi(esc(pk.f.title), esc(pk.f.en)) : esc(pk.f.title)) + '</b><br>' +
    bi(pk.f.min + ' นาที · ' + esc(pk.s.c.th), pk.f.min + ' min · ' + esc(pk.s.c.en)) + ' · <a href="' + esc(pk.s.c.url) + '" rel="noopener">' + bi('ดูรอบที่เมเจอร์', 'times at Major') + ' →</a></p>';
  else h += '<p class="tpick">' + bi('วันนี้ไม่มีรอบเหลือแล้ว', 'No more shows today') + '</p>';
  h += '<p class="tsrc">' + bi('รอบฉายจากเว็บเมเจอร์ ซีนีเพล็กซ์ · แตะแถบหนังเพื่อดูรอบ', 'showtimes from Major Cineplex · tap a frame for its show') + ' · <a href="' + LIVE + 'films.html">' + bi('ทุกโรง ทุกรอบ สามวัน', 'Every cinema, every show, three days') + ' →</a></p>';
  cap('t-films', h);
}
function filmsTap(px, py) {
  var hit = FROWS.filter(function (r) { return px >= r.x0 && px <= r.x1 && py >= r.y0 && py <= r.y1; })[0];
  FPICK = hit ? { f: hit.f, s: hit.s } : null; filmsCap();
}

/* ======================================================================== LOTTERY
   The last draw. A drum of ten numbered balls turns (each ball on its own epicycle, r = R·(0.35 + 0.5·sin)),
   and the first prize drops out of it one digit at a time onto the rail, then the smaller prizes below. */
var LT = null;
var BALL = ['#e5567f', '#4d8fd1', '#e2b33c', '#4fae8c', '#9b6bd6', '#e0773a', '#d94b3b', '#69b45a', '#8a76d8', '#e58f3a'];
function ball(k, x, y, r, dg, col) {
  paper(k, function (q) { disc(q, x, y, r); }, col, 1);
  paper(k, function (q) { disc(q, x, y, r * 0.62); }, '#fffaf0', 0.3);
  k.fillStyle = '#2b2116'; k.font = '800 ' + Math.round(r * 1.05) + 'px ' + SANS; k.textAlign = 'center'; k.textBaseline = 'middle'; k.fillText(dg, x, y + 1);
}
function drawLotto(k, T, t) {
  if (!LT) return;
  var W = T.W, Hh = T.H, first = LT.first.split(''), small = W < 520;
  var g = k.createLinearGradient(0, 0, 0, Hh); g.addColorStop(0, '#1b1426'); g.addColorStop(1, '#100c18'); k.fillStyle = g; k.fillRect(0, 0, W, Hh);
  var R = Math.min(Hh * 0.4, W * 0.19), cx = R + 14, cy = Hh / 2, spin = t / 900, i;
  paper(k, function (q) { disc(q, cx, cy, R + 4); q.moveTo(cx + R, cy); q.arc(cx, cy, R, 0, 6.2832, true); }, '#c9973f', 1.4);   /* the drum's rim */
  k.save(); k.beginPath(); k.arc(cx, cy, R, 0, 6.2832); k.clip(); k.fillStyle = 'rgba(255,255,255,.05)'; k.fill();
  for (i = 0; i < 10; i++) {
    var a = spin * (1 + i * 0.07) + i * 0.628, rr = R * (0.35 + 0.28 * Math.sin(spin * 0.7 + i * 1.3)), bx = cx + Math.cos(a) * rr, by = cy + Math.sin(a) * rr + R * 0.22;
    ball(k, bx, by, R * 0.17, String(i), BALL[i]);
  }
  k.restore();
  k.strokeStyle = 'rgba(255,255,255,.35)'; k.lineWidth = 2; k.beginPath(); for (i = 0; i < 6; i++) { var sa = spin + i * 1.047; k.moveTo(cx, cy); k.lineTo(cx + Math.cos(sa) * R, cy + Math.sin(sa) * R); } k.stroke();
  /* the rail of the first prize: each digit falls, bounces, settles */
  var rx0 = cx + R + 22, rx1 = W - 12, br = Math.max(11, Math.min(small ? 18 : 24, (rx1 - rx0) / 13.5)), gap = br * 2.3, ry = cy;
  if (rx1 - rx0 < gap * 6) { br = Math.max(9, (rx1 - rx0) / 14); gap = br * 2.3; }
  k.strokeStyle = 'rgba(201,151,63,.7)'; k.lineWidth = 3; k.beginPath(); k.moveTo(rx0 - 4, ry + br + 3); k.lineTo(rx0 + gap * 6, ry + br + 3); k.stroke();
  first.forEach(function (dg, j) {
    var p = REDUCED ? 9 : (t - 400 - j * 420) / 1000; if (p < 0) return;
    var x = rx0 + br + j * gap, y = ry - (ry + br) * Math.exp(-3.4 * p) * Math.abs(Math.cos(p * Math.PI * 2.2));
    ball(k, x, y, br, dg, BALL[+dg]);
  });
}
function lottoPrep(d) {
  var D = d.draw, P = {}; (D.prizes || []).forEach(function (p) { P[p.id] = p; });
  if (!P.first) return;
  LT = { d: D, first: P.first.numbers[0], rows: ['front3', 'back3', 'last2'].filter(function (k) { return P[k]; }).map(function (k) {
    var p = P[k]; return { th: p.th, en: p.en, numbers: p.numbers, baht: p.amount_baht }; }) };
}
/* the next draw after the one held: the 1st and the 16th, with the GLO's standing moves (the 1 January draw on
   30 December, 16 January on the 17th, 1 May on the 2nd); a one-off move shows when lottery.json next updates */
function nextDraw(after) {
  var y = +after.slice(0, 4), m = +after.slice(5, 7) - 1, c = [], k;
  for (k = 0; k < 3; k++) {
    var yy = y + Math.floor((m + k) / 12), mm = (m + k) % 12;
    c.push(mm === 0 ? [yy - 1, 11, 30] : mm === 4 ? [yy, 4, 2] : [yy, mm, 1], mm === 0 ? [yy, 0, 17] : [yy, mm, 16]);
  }
  return c.map(function (x) { return x[0] + '-' + String(x[1] + 1).padStart(2, '0') + '-' + String(x[2]).padStart(2, '0'); }).sort().filter(function (d) { return d > after; })[0];
}
function lottoCard() {
  var nd = nextDraw(LT.d.date), days = Math.round((Date.parse(nd + 'T12:00:00Z') - Date.parse(ymd(Date.now()) + 'T12:00:00Z')) / 864e5), ds = dayStr(nd);
  var g = '<svg viewBox="0 0 100 22" aria-hidden="true">' + LT.first.split('').map(function (dg, i) { return '<circle cx="' + (9 + i * 16.4) + '" cy="11" r="7.5" fill="' + BALL[+dg] + '"/><text x="' + (9 + i * 16.4) + '" y="14.5" font-size="10" font-weight="800" text-anchor="middle" fill="#2b2116">' + dg + '</text>'; }).join('') + '</svg>';
  MDNOW.card('lotto', { l: ['สลาก', 'Lottery'], v: LT.first.slice(-2) + '<small>' + bi('2 ตัว', 'last 2') + '</small>',
    s: days >= 0 ? ['งวดหน้า ' + ds[0] + (days ? ' อีก ' + days + ' วัน' : ' วันนี้'), 'next ' + ds[1] + (days ? ' · ' + days + ' d' : ' · today')] : null, g: g });
  return [nd, ds, days];
}
function lottoCap() {
  if (!LT) return;
  var nx = lottoCard();
  var d = dayStr(LT.d.date), f = LT.d.prizes.filter(function (p) { return p.id === 'first'; })[0];
  var h = '<p class="tline">' + bi('สลากกินแบ่งรัฐบาล งวด ' + d[0] + ' ' + LT.d.be_year + ' · งวดหน้า ' + nx[1][0], 'Thai government lottery, ' + d[1] + ' draw · next ' + nx[1][1]) + '</p>' +
    '<p class="tpick"><b>' + bi('รางวัลที่ 1 ' + LT.first, 'First prize ' + LT.first) + '</b> · ' + bi(n0(f.amount_baht) + ' บาท', '฿' + n0(f.amount_baht)) + '<br>' +
    LT.rows.map(function (r) { return bi(esc(r.th) + ' ' + r.numbers.join(' '), esc(r.en) + ' ' + r.numbers.join(' ')); }).join(' · ') + '</p>' +
    '<p class="tsrc">' + bi('ผลตามประกาศของสำนักงานสลากกินแบ่งรัฐบาล', 'as announced by the Government Lottery Office') + ' · <a href="' + LIVE + 'lottery.html">' + bi('ทุกรางวัล และตรวจสลากของคุณ', 'Every prize, and check your ticket') + ' →</a></p>';
  cap('t-lotto', h);
}

/* ======================================================================== wiring */
var FLIGHTS = tile('t-flights', drawFlights, flightsTap), ROADS = tile('t-roads', drawRoads, roadsTap),
    FILMS = tile('t-films', drawFilms, filmsTap), LOTTO = tile('t-lotto', drawLotto);
TILE = { flights: FLIGHTS, roads: ROADS, films: FILMS, lotto: LOTTO };
function hide(id) { var b = $(id); if (b) b.hidden = true; var k = b && b.dataset.k; if (k) MDNOW.card(k, null); }
j(LIVE + 'front/flights.json').then(function (d) {
  flightsPrep(d); flightsCap(); if (FLIGHTS) FLIGHTS.paint();
  j(LIVE + 'data/flightboard.json').then(function (b) { FB = b; flightsCap(); if (FLIGHTS) FLIGHTS.paint(); }, function () { });
}, function () { hide('t-flights'); });
setInterval(function () { if (FB && FMODE === 'now') flightsCap(); }, 60e3);
j(LIVE + 'front/roads.json').then(function (d) {
  roadsPrep(d); roadsCap(); if (ROADS) ROADS.paint();
  j(LIVE + 'data/traffic_now.json').then(function (n) { RN = n; roadsCap(); if (ROADS) ROADS.paint(); }, function () { });
}, function () { hide('t-roads'); });
j(LIVE + 'data/showtimes.json').then(function (d) { filmsPrep(d); if (!FM.films.length) return hide('t-films'); filmsCap(); if (FILMS) FILMS.paint(); }, function () { hide('t-films'); });
j(LIVE + 'data/lottery.json').then(function (d) { lottoPrep(d); if (!LT) return hide('t-lotto'); lottoCap(); if (LOTTO) LOTTO.paint(); }, function () { hide('t-lotto'); });
document.addEventListener('click', function (ev) {
  var b = ev.target.closest && ev.target.closest('.tchip'); if (!b) return;
  if (b.dataset.fmode) { FMODE = b.dataset.fmode; FPLANE = null; flightsCap(); if (FLIGHTS) FLIGHTS.paint(); }
  if (b.dataset.air) { FSEL = FSEL === b.dataset.air ? null : b.dataset.air; flightsCap(); if (FLIGHTS) FLIGHTS.paint(); }
  if (b.dataset.rview) { RVIEW = b.dataset.rview; RPICK = null; roadsCap(); if (ROADS) ROADS.paint(); }
});
document.addEventListener('click', function (ev) {      /* a measured road in the list: lit on the map */
  var b = ev.target.closest && ev.target.closest('.rnrow'); if (!b || !RN) return;
  var x = RN.roads[+b.dataset.rn]; if (!x) return;
  RNPICK = RNPICK === x ? null : x; RFLASH = performance.now();
  RPICK = RNPICK ? RD.roads.filter(function (r) { return r.route === x.route && r.name === x.name; })[0] || null : null;
  if (RNPICK && RVIEW === 'city' && x.line && !x.line.some(function (p) { var bx = BOXES.city; return p[0] > bx[0] && p[0] < bx[2] && p[1] > bx[1] && p[1] < bx[3]; })) RVIEW = 'prov';
  roadsCap(); if (ROADS) ROADS.paint();
  var nb = document.querySelector('.rnrow[data-rn="' + b.dataset.rn + '"]'); if (nb) nb.focus();
});
new MutationObserver(function () { flightsCap(); roadsCap(); filmsCap(); lottoCap(); }).observe(H, { attributes: true, attributeFilter: ['class'] });
setInterval(function () { if (FM) filmsCap(); }, 60e3);
})();
