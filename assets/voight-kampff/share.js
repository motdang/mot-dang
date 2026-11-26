/* Voight-Kampff sharing (2026-11-26): every gossip item, every layer and every bot
 * file gets its own link and a row of ways to send it. */
(function () {
  var targets = [].slice.call(document.querySelectorAll("article.gossip, section.layer, #file, .lineup"));
  if (!targets.length) return;
  function slug(s) { return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40); }
  function textOf(el) {
    var h = el.querySelector("h3, h2");
    var en = h && h.querySelector(".en");
    var t = (en ? en.textContent : h ? h.textContent : document.title).trim();
    var say = el.querySelector(".say p .en, .say .en, .lead .en");
    if (say) t += ": " + say.textContent.trim().split(/[.!?]\s/)[0];
    return t.length > 220 ? t.slice(0, 217) + "…" : t;
  }
  var used = {};
  targets.forEach(function (el, i) {
    if (!el.id) {
      var h = el.querySelector("h3, h2");
      var base = "g-" + (slug(h && (h.querySelector(".en") || h).textContent) || i);
      var id = base, k = 2;
      while (used[id] || document.getElementById(id)) id = base + "-" + k++;
      el.id = id;
    }
    used[el.id] = 1;
    var url = location.origin + location.pathname + "#" + el.id;
    var text = textOf(el);
    var row = document.createElement("div");
    row.className = "sh";
    row.setAttribute("role", "group");
    row.setAttribute("aria-label", "share");
    function btn(label, f) { var b = document.createElement("button"); b.type = "button"; b.textContent = label; b.addEventListener("click", f); row.appendChild(b); return b; }
    function link(label, href) { var a = document.createElement("a"); a.textContent = label; a.href = href; a.target = "_blank"; a.rel = "noopener"; row.appendChild(a); }
    if (navigator.share) btn("แชร์ · Share", function () { navigator.share({ title: document.title, text: text, url: url }).catch(function () {}); });
    link("LINE", "https://social-plugins.line.me/lineit/share?url=" + encodeURIComponent(url));
    link("Bluesky", "https://bsky.app/intent/compose?text=" + encodeURIComponent(text + " " + url));
    link("X", "https://x.com/intent/post?text=" + encodeURIComponent(text) + "&url=" + encodeURIComponent(url));
    var cp = btn("คัดลอกลิงก์ · Copy link", function () {
      (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function () {
        cp.textContent = "คัดลอกแล้ว · Copied"; setTimeout(function () { cp.textContent = "คัดลอกลิงก์ · Copy link"; }, 1600);
      }, function () { prompt("Link", url); });
    });
    (el.querySelector(".say") || el).appendChild(row);
  });
  if (location.hash && location.hash.length > 1 && location.hash.indexOf("=") < 0) {
    var t = document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (t) {
      setTimeout(function () { t.scrollIntoView({ block: "start" }); }, 60);
      // the floods table above loads late and pushes everything down: aim again, unless the reader has scrolled
      var y0 = null;
      setTimeout(function () { y0 = scrollY; }, 120);
      setTimeout(function () { if (y0 === null || Math.abs(scrollY - y0) < 4) t.scrollIntoView({ block: "start" }); }, 1500);
    }
  }
})();
