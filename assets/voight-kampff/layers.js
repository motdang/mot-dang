/* Voight-Kampff layers: what a tap does (vk_layers.py, 2026-11-26).
 * Pulse row: its echo (autocorrelation) and back, the trace drawn again.
 * Fingerprint picture: turns over and shows its hash.
 * A city on the map: light spreads to each bot that city answered.
 * A big robot face: a spin. */
(function () {
  function act(el, f) {
    el.addEventListener("click", f);
    el.addEventListener("keydown", function (ev) { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); f.call(el, ev); } });
  }
  document.querySelectorAll(".pl").forEach(function (row) {
    act(row, function (ev) {
      if (ev.target.closest("a")) return;
      var on = row.classList.toggle("echo");
      row.setAttribute("aria-pressed", on ? "true" : "false");
      row.classList.remove("run"); void row.offsetWidth; if (!on) row.classList.add("run");
    });
  });
  var file = document.getElementById("file");
  if (file && file.querySelector(".ecg")) act(file.querySelector(".ecg"), function () { file.classList.toggle("echo"); });
  document.querySelectorAll(".gl").forEach(function (b) { b.addEventListener("click", function () { b.classList.toggle("on"); }); });
  document.querySelectorAll(".big-face").forEach(function (f) {
    act(f, function () { f.classList.remove("spin"); void f.offsetWidth; f.classList.add("spin"); });
  });

  var map = document.getElementById("vkmap"), note = document.getElementById("vkmap-note"), raw = document.getElementById("vkmap-data");
  if (!map || !raw) return;
  var data = {};
  try { data = JSON.parse(raw.textContent); } catch (e) { /* the map without notes */ }
  function n(x) { return Math.round(x || 0).toLocaleString("en-US"); }
  function say(code) {
    var d = data[code];
    if (!note) return;
    note.textContent = "";
    if (!d) return;
    var h = document.createElement("div");
    var b = document.createElement("b"); b.textContent = d.city + " (" + code + ")";
    h.appendChild(b);
    h.appendChild(document.createTextNode(" · " + n(d.bots) + " bot · " + n(d.people) + " people"));
    note.appendChild(h);
    (d.callers || []).forEach(function (c) {
      var p = document.createElement("div");
      p.textContent = c[0] + " — " + n(c[1]) + " · " + c[2] + " ms → within " + n(c[3]) + " km";
      note.appendChild(p);
    });
  }
  /* Light rings: a circle on the globe (every point the same great-circle distance
   * from the data centre), drawn on the map's flat projection. */
  var MW = map.viewBox.baseVal.width, LATN = Number(map.getAttribute("data-latn") || 84), R = Math.PI / 180;
  function xy(lon, lat) { return [(lon + 180) / 360 * MW, (LATN - lat) / 360 * MW]; }
  function ringPath(lat, lon, km) {
    var d = km / 6371, p1 = lat * R, l1 = lon * R, out = "", last = null;
    for (var i = 0; i <= 72; i++) {
      var b = 2 * Math.PI * i / 72;
      var p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
      var l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
      var q = xy(((l2 / R + 540) % 360) - 180, p2 / R);
      out += (last === null || Math.abs(q[0] - last) > MW / 2 ? "M" : "L") + q[0].toFixed(1) + "," + q[1].toFixed(1);
      last = q[0];
    }
    return out;
  }
  var NS = "http://www.w3.org/2000/svg", firstDot = map.querySelector(".colo");
  function rings(code) {
    map.querySelectorAll(".rings").forEach(function (x) { x.remove(); });
    var d = data[code];
    if (!d || !d.at) return;
    var g = document.createElementNS(NS, "g");
    g.setAttribute("class", "rings on");
    (d.callers || []).forEach(function (c, j) {
      var p = document.createElementNS(NS, "path");
      p.setAttribute("class", "lr");
      p.setAttribute("style", "--d:" + (j * 0.18).toFixed(2) + "s");
      p.setAttribute("d", ringPath(d.at[0], d.at[1], Math.max(60, c[3])));
      g.appendChild(p);
    });
    map.insertBefore(g, firstDot);
  }
  map.querySelectorAll(".colo").forEach(function (g) {
    act(g, function () {
      var code = g.getAttribute("data-c");
      var was = g.classList.contains("on");
      map.querySelectorAll(".colo.on").forEach(function (x) { x.classList.remove("on"); });
      if (was) { map.querySelectorAll(".rings").forEach(function (x) { x.remove(); }); if (note) note.textContent = ""; return; }
      g.classList.add("on");
      rings(code);
      say(code);
    });
  });
  var first = map.querySelector(".colo");
  if (first && !matchMedia("(prefers-reduced-motion:reduce)").matches && "IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (es) {
      if (es[0].isIntersecting) { io.disconnect(); if (!map.querySelector(".colo.on")) first.dispatchEvent(new Event("click")); }
    }, { threshold: 0.5 });
    io.observe(map);
  }
})();
