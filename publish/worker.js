/* mot-dang site Worker — serves the whole site out of an R2 bucket.
 *
 * WHY THIS EXISTS
 * ---------------
 * The site was published by Cloudflare Pages pulling from GitHub. When the
 * GitHub account was suspended that pipeline stopped, and because Pages keeps
 * serving its last good build, nothing looked broken — the site simply stopped
 * accepting new work. Months of pushes shipped nothing.
 *
 * There is a second, slower wall behind that one: Pages caps a project at
 * 20,000 files and docs/ is 27,577 (13,514 pages plus a .json sibling for each
 * place). So even with GitHub healthy, a full deploy no longer fits.
 *
 * R2 has no object limit and no dependency on anyone else's git host, so both
 * walls go away at once — and the 116 MB basemap archive lives in the same
 * bucket as the pages, served by the same code path.
 *
 * URL SHAPE, deliberately different from Pages
 * -------------------------------------------
 * Pages redirects /toilets.html to /toilets. Every internal link on this site
 * is written as "toilets.html" and every canonical says .html, so that default
 * put a 308 in front of ordinary navigation and left the canonical disagreeing
 * with the URL actually served. Here .html is served straight, and the
 * extensionless form resolves to the same object for anyone who types or has
 * bookmarked it. No redirects on the common path.
 *
 * CORS, AND WHY IT IS ON EVERYTHING
 * ---------------------------------
 * The licence has said "reuse it, train on it, quote it" on every page since
 * the site existed, and the data was reachable by anything that could make a
 * server-side request — and by nothing that ran in a browser, because no
 * response carried an Access-Control-Allow-Origin. An open licence a browser
 * cannot act on is an invitation with the door locked. Every response is now
 * origin-open. That is not a relaxation of a security boundary: the bucket
 * holds a public directory, it sets no cookie, keeps no session and holds no
 * credentials anywhere in this Worker, so there is nothing a cross-origin
 * reader can reach that it could not already have fetched from a server.
 *
 * THE API
 * -------
 * /api/v1/* is a query layer over one baked file (api/v1/index.json, written
 * by api_layer.py at build time), held in the isolate after the first request.
 * No database, no binding beyond the bucket that was already here. The
 * query semantics live in api.js so they can be tested without deploying.
 */

import { SCHEMA_VERSION, queryPlaces, findPlace, slugCandidates, minuteOfWeek,
         present, liftProvince, norm, parseQuery, rowMatches,
         gridEligible, queryPlacesGrid, cmpPlaceName, cmpPlaceDefault,
         RF_CUISINE, RF_SERVICE, RF_FEATURE, refineBit,
         LIMIT_DEFAULT, LIMIT_MAX } from "./api.js";
import { RowStore, refineSig } from "./rowstore.js";
import SEARCHCORE from "./searchcore.js";
import { fleetSearch } from "./fleetsearch.js";
import { translateApi } from "./quickanswer.js";
import { cachedGet } from "./r2cache.js";

/* The fleet search (publish/fleetsearch.js) answers /find, and it answers
 * /search.html — the address the header box on every page posts to — when
 * the query carries only its own parameters. The older place-filter page
 * (advanced.html → search.html?tag=…&su=…) keeps its address: any other
 * parameter falls through to the static file as before. */
const FLEET_PARAMS = new Set(["q", "adv", "lucky", "p", "n", "site", "from", "to", "fmt",
                              "sort", "in", "since", "near", "kind", "sec", "has", "bbox"]);
function fleetOwns(url) {
  const p = url.pathname;
  if (p === "/find" || p === "/find/" || p === "/find.html" || p === "/search") return true;
  if (p !== "/search.html") return false;
  for (const k of url.searchParams.keys()) if (!FLEET_PARAMS.has(k)) return false;
  return true;
}
import { EdgeIndex } from "./edgesearch.js";
import { classify } from "./classify.js";
import { subscribe } from "./subscribe.js";
import { newsletter, ownsNewsletter } from "./newsletter.js";
import { lister, ownsLister } from "./lister.js";
import { live, ownsLive, resolve } from "./live.js";
import { shareSense } from "./sharesense.js";
import { toHttps, sendToRules, askCrawler, record } from "./edge_gate.js";
export { toHttps };
import { accounts } from "./accounts.js";
import { me, ownsMe } from "./me.js";
import { trustedGuess } from "./where.js";
import { findSense, findJudge } from "./findlearn.js";

const TYPES = {
  html: "text/html; charset=utf-8",
  json: "application/json; charset=utf-8",
  geojson: "application/geo+json",
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  ico: "image/x-icon",
  woff2: "font/woff2",
  txt: "text/plain; charset=utf-8",
  xml: "application/xml; charset=utf-8",
  ics: "text/calendar; charset=utf-8",
  pdf: "application/pdf",
  apk: "application/vnd.android.package-archive",
  webmanifest: "application/manifest+json",
  pmtiles: "application/octet-stream",
  /* Label glyphs for the basemap, self-hosted since 2026-08-20 so that a page
   * carrying a map asks nobody but us for anything. They would already serve
   * as octet-stream by the fallback below; named here so the type is stated
   * rather than defaulted. */
  pbf: "application/x-protobuf",
};

/* Pages are rebuilt often and must never be served stale from a CDN edge after
 * a deploy; fingerprint-free assets (fonts, images, the tile archive) never
 * change under the same name, so they get a long life. The tile archive in
 * particular is fetched in hundreds of small ranges — re-validating each one
 * would undo the point of self-hosting it. */
function cacheFor(ext) {
  if (ext === "html" || ext === "json" || ext === "geojson" || ext === "xml")
    return "public, max-age=0, must-revalidate";
  if (ext === "pmtiles") return "public, max-age=31536000, immutable";
  /* MEASURED AND REJECTED, 2026-09-10, so nobody builds it twice: serving
   * data/index.json and vendor/ from caches.default, keyed by etag, with a
   * gzip twin baked beside each. It was deployed and measured against the
   * live site and it was SLOWER — 5.7-8.2 s where the plain path had been
   * 1.8-3.5 s, and most requests missed the cache anyway. Three reasons, all
   * of them things Cloudflare was already doing better: the edge was already
   * caching these and compressing them with BROTLI (smaller than the gzip
   * twin); finding the etag cost an extra R2 head() before every read; and
   * filling the cache cost a second full read of the same 9.4 MB object.
   * Taking a body away from the CDN to hand-cache it is a losing trade.
   *
   * Stylesheet, scripts and the icon sprite: the browser shows the copy it
   * holds and asks in the background whether it changed; a returning reader
   * is at most one page view behind after an edit, never a week. */
  if (ext === "css" || ext === "js" || ext === "svg")
    return "public, max-age=0, stale-while-revalidate=604800";
  return "public, max-age=604800";
}


const ext = (k) => {
  const i = k.lastIndexOf(".");
  return i < 0 ? "" : k.slice(i + 1).toLowerCase();
};

/* Every key this path could reasonably mean, most-likely first. Kept small on
 * purpose: each miss is a real R2 lookup. */
function candidates(pathname) {
  let p = decodeURIComponent(pathname).replace(/^\/+/, "");
  if (p === "" || p.endsWith("/")) return [p + "index.html"];
  if (p.includes(".")) return [p];
  return [p + ".html", p + "/index.html"];
}

/* Open to every origin, on every response.
 *
 * expose-headers matters more than it looks: without it a cross-origin reader
 * can see the body but not the ETag, so it cannot make a conditional request
 * and must re-download the 25 MB places.json every time. Exposing them is what
 * makes polite caching possible for the readers we most want to be polite. */
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, HEAD, OPTIONS",
  "access-control-allow-headers": "content-type, if-none-match, range",
  "access-control-expose-headers":
    "etag, content-length, content-range, content-type, last-modified",
  "access-control-max-age": "86400",
};

function headers(obj, key, extra) {
  const h = new Headers(extra);
  h.set("content-type", TYPES[ext(key)] || "application/octet-stream");
  h.set("cache-control", cacheFor(ext(key)));
  /* Range support is not decoration here: pmtiles is nothing but ranged reads,
   * and a client that cannot tell we accept them will refuse to try. */
  h.set("accept-ranges", "bytes");
  h.set("x-content-type-options", "nosniff");
  h.set("referrer-policy", "strict-origin-when-cross-origin");
  for (const [k, v] of Object.entries(CORS)) h.set(k, v);
  if (obj.httpEtag) h.set("etag", ext(key) === "html" ? ntEtag(obj.httpEtag) : obj.httpEtag);
  return h;
}

/* Machine translation off (Nan, 2026-09-23). Done here, not in a build, because
 * the bucket holds pages from several builds. A page's etag gains NT_ETAG so a
 * browser holding a copy from before this change fetches the page again. */
const NT_ETAG = "-nt2";
const NT_META_GOOGLE = '<meta name="google" content="notranslate">';
const NT_META_ROBOTS = '<meta name="robots" content="notranslate">';
const NT_SCRIPT = '<script>if(/[.]translate[.]goog$/.test(location.hostname))location.replace("https://"+location.hostname.slice(0,-15).replace(/--/g,"~").replace(/-/g,".").replace(/~/g,"-")+location.pathname+location.search.replace(/([?&])_x_tr_[^&]*/g,"$1").replace(/[?&]+$/,"").replace(/[?]&+/,"?")+location.hash)</script>';
const NT_DONE = new WeakSet();
/* Travelpayouts, project Motdang 581229 (Nan, 2026-10-11): their site script,
 * as they gave it, in the head of every page. */
const TP_SCRIPT = '<script nowprocket data-noptimize="1" data-cfasync="false" data-wpfc-render="false" seraph-accel-crit="1" data-no-defer="1" data-cmp-ab="2">(function () {var script = document.createElement("script");script.async = 1;script.setAttribute("data-cmp-ab","2");script.src = \'https://tp-em.com/NTgxMjI5.js?t=581229\';document.head.appendChild(script);})();</script>';

export const ntEtag = (tag) => tag.replace(/"$/, NT_ETAG + '"');

export function ntClass(c) {
  if (c == null || c.trim() === "") return "notranslate";
  return /(^|\s)notranslate(\s|$)/.test(c) ? c : c + " notranslate";
}

/* R2 knows the bare etag. A tag without the suffix names a copy from before
 * the rewrite, so it is dropped and the page goes out again. */
export function ntConditional(reqHeaders) {
  const h = new Headers();
  const inm = reqHeaders.get("if-none-match");
  if (inm) {
    const keep = [];
    for (const raw of inm.split(",")) {
      const t = raw.trim();
      const m = t.match(/^(W\/)?"(.*)"$/);
      if (t === "*") keep.push(t);
      else if (m && m[2].endsWith(NT_ETAG))
        keep.push(`${m[1] || ""}"${m[2].slice(0, -NT_ETAG.length)}"`);
    }
    if (keep.length) h.set("if-none-match", keep.join(", "));
  }
  for (const k of ["if-match", "if-unmodified-since"]) {
    const v = reqHeaders.get(k);
    if (v) h.set(k, v);
  }
  return h;
}

/* `atHeadEnd` is anything else a caller writes at the end of the head. It has
 * to come through here: an element holds one end-tag handler, so a second
 * onEndTag on <head> replaces this one and these tags fall through to before
 * <body>. */
/* SCRIPTS NAMED BY CONTENT (gemba 2, 2026-10-20). A script is served "show
 * the copy you hold, ask in the background" (cacheFor), so the first page
 * view after a fix ran the old code: the map's Copy link went on sending 0,0
 * for a reader who had the old mapfirst.js. deploy.py writes
 * data/asset-versions.json (top-level .js/.css → content hash); every page's
 * <script src> and stylesheet link to one of them gets ?v=<hash>, and a
 * ?v= address is kept by the browser for good — a new hash is a new address.
 * Read through the colo cache, at most once a minute per isolate. */
let AV = {}, AV_AT = 0, AV_P = null;
function assetVersions(env) {
  if (Date.now() - AV_AT < 60_000) return Promise.resolve(AV);
  if (!AV_P) AV_P = (async () => {
    try {
      const o = await cachedGet(env, "data/asset-versions.json", 60);
      const j = o ? await o.json() : null;
      if (j && typeof j === "object") AV = j;
    } catch { /* keep what we had */ }
    AV_AT = Date.now(); AV_P = null; return AV;
  })();
  return AV_P;
}
/* ref as written in a page at `base`; only a file at the site's top level
 * (md.js, map.js, style.css …) is in the list. */
export function versioned(ref, av = AV, base = "https://motdang.net/") {
  if (!ref || /[?#]|^[a-z]+:/i.test(ref) || ref.startsWith("//")) return null;
  let path;
  try { path = new URL(ref, base).pathname; } catch { return null; }
  const k = path.replace(/^\//, "");
  return !k.includes("/") && av[k] ? `${ref}?v=${av[k]}` : null;
}

function noTranslate(rw, atHeadEnd = () => {}, base = "https://motdang.net/") {
  let done = false, google = false, robots = false, script = false, tp = false;
  const tags = () => (google ? "" : NT_META_GOOGLE) + (robots ? "" : NT_META_ROBOTS) +
                     (script ? "" : NT_SCRIPT) + (tp ? "" : TP_SCRIPT);
  const put = (write) => { if (!done) { done = true; write(tags()); } };
  return rw
    .on("script[src]", { element(e) { const v = versioned(e.getAttribute("src"), AV, base); if (v) e.setAttribute("src", v); } })
    .on('link[rel="stylesheet"][href]', { element(e) { const v = versioned(e.getAttribute("href"), AV, base); if (v) e.setAttribute("href", v); } })
    .on("html", {
      element(e) {
        e.setAttribute("translate", "no");
        e.setAttribute("class", ntClass(e.getAttribute("class")));
      },
    })
    .on('meta[name="google" i][content*="notranslate" i]', { element() { google = true; } })
    .on('meta[name="robots" i][content*="notranslate" i]', { element() { robots = true; } })
    .on("head > script:not([src]):not([type])", {
      text(t) {
        if (t.text.includes("translate[.]goog")) script = true;
        if (t.text.includes("tp-em.com")) tp = true;
      },
    })
    .on("head", {
      element(e) {
        e.onEndTag((end) => { put((s) => end.before(s, { html: true })); atHeadEnd(end); });
      },
    })
    .on("body", { element(e) { put((s) => e.before(s, { html: true })); } })
    .onDocument({ end(d) { put((s) => d.append(s, { html: true })); } });
}

/* Last step for every response: a page not yet rewritten is rewritten, and
 * the header is appended (a page may already send noindex). A redirect has no
 * page to translate and keeps its headers as they were. */
export function finish(res, base) {
  const type = res.headers.get("content-type") || "";
  const out = res.body && !NT_DONE.has(res) && /^text\/html/i.test(type)
    ? noTranslate(new HTMLRewriter(), undefined, base).transform(res)
    : new Response(res.body, res);
  if (!(out.status >= 301 && out.status <= 308 && out.status !== 304))
    out.headers.append("x-robots-tag", "notranslate");
  return out;
}

/* WHERE THE READER IS, on every page
 * ----------------------------------
 * Cloudflare already knows roughly where a request came from, so a page can
 * stand in the right city before anyone taps anything. Two things are done
 * with that, and both hold to the same rule: SAY WHAT IT IS WORTH.
 *
 *   1. `meta[name=md-where]` carries city|lat|lon|tz|country. A page that has
 *      the tag gets it filled; a page without one has it written into the head.
 *      Writing it rather than only filling it is what makes this reach the
 *      whole site — and it is not theoretical: the front page rebuilt on
 *      2026-09-21 dropped the tag the 2026-09-19 page had carried, so the one
 *      page the geofence was built for stopped receiving a position while
 *      nothing looked broken.
 *   2. A page that says where IT is — schema.org GeoCoordinates in its head —
 *      gets a line under its heading saying how far away it is and which way.
 *
 * IT IS A CITY, NOT A PERSON. Measured 2026-09-21: Cloudflare placed a
 * connection at 18.790, 98.985 — Chiang Mai, and 6 km from the house it was
 * actually sent from. So a coarse position is drawn as "ใกล้ๆ · nearby" or
 * "~6 km", never with a decimal it has not earned, and the line says whose
 * guess it is. The exact fix is the reader's to give and the page offers a
 * tap for it; fleetsearch.js draws the same distinction the same way.
 *
 * A PERSONALISED PAGE IS MARKED `private`, so no shared cache may keep one
 * reader's copy for the next. HTML here is already `max-age=0,
 * must-revalidate` and Cloudflare is not caching it, but a page that carries a
 * reader's city says so in its own headers rather than resting on that.
 */
const M_PER_DEG = 111_320;
const COMPASS = [["เหนือ", "N"], ["ตะวันออกเฉียงเหนือ", "NE"], ["ตะวันออก", "E"],
                 ["ตะวันออกเฉียงใต้", "SE"], ["ใต้", "S"], ["ตะวันตกเฉียงใต้", "SW"],
                 ["ตะวันตก", "W"], ["ตะวันตกเฉียงเหนือ", "NW"]];

export function hereLine(from, to) {
  const dLat = (to.lat - from.lat) * M_PER_DEG;
  const dLon = (to.lon - from.lon) * M_PER_DEG * Math.cos((from.lat * Math.PI) / 180);
  const m = Math.sqrt(dLat * dLat + dLon * dLon);
  if (!Number.isFinite(m)) return null;
  const deg = (Math.atan2(dLon, dLat) * 180) / Math.PI;
  const dir = (dLat || dLon) ? COMPASS[Math.round(((deg + 360) % 360) / 45) % 8] : null;
  const far = m < 1500 ? ["ใกล้ๆ", "nearby"]
            : m < 100_000 ? [`~${Math.round(m / 1000)} กม.`, `~${Math.round(m / 1000)} km`]
            : [`~${Math.round(m / 1000)} กม.`, `~${Math.round(m / 1000)} km`];
  return { m, far, dir };
}

function whereHtml(from, to, city) {
  const line = hereLine(from, to);
  if (!line) return "";
  const dir = line.dir ? ` ${esc(line.dir[0])} · ${esc(line.dir[1])}` : "";
  const place = city ? ` ${esc(city)}` : "";
  return `<p class="md-here" style="margin:.2em 0 .6em;font-size:.95em">` +
         `<span style="color:#0b6b3a">${esc(line.far[0])} · ${esc(line.far[1])}${dir}</span> ` +
         `<span style="color:#5c4d38;font-size:.9em">— จากตำแหน่งโดยประมาณของเครือข่าย${place} · ` +
         `from your network's rough position</span></p>`;
}

const esc = (x) => String(x == null ? "" : x)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/* A directory or a shelf is not one place, so there is no distance to draw —
 * but the reader still stands in a city, and that city is drawn the way a
 * place page's line is drawn: Cloudflare's guess, named as a guess, never a
 * decimal it has not earned, and nothing at all when cf handed over no
 * position. The precise fix is the reader's to give, one tap away on /find,
 * which reads the same request.cf and offers the browser-geolocation upgrade
 * (fleetsearch.js exactLink). No script is injected into the shelf itself. */
function whereCityHtml(cf) {
  const city = cf.city ? `<span style="color:#0b6b3a">${esc(cf.city)}</span> ` : "";
  return `<p class="md-here" data-md-where-city style="margin:.2em 0 .6em;font-size:.95em">` +
         `${city}<span style="color:#5c4d38;font-size:.9em">` +
         `— จากตำแหน่งโดยประมาณของเครือข่าย · from your network's rough position</span> ` +
         `<a href="/find" style="font-size:.9em">ของใกล้ตัว · what's near you ›</a></p>`;
}

/* The one decision, made pure so it can be tested without HTMLRewriter: given
 * where the reader is (cf, and whether it was usable — `known`), what the page
 * turned out to be (a single place `pin`, or an ItemList directory `isList`),
 * return the line to draw under the heading, or "" for none.
 *   cf absent            → "" (no false position anywhere)
 *   a single place       → the distance line, as before
 *   an ItemList surface  → the reader's city line (newly covered)
 *   anything else        → "" (front page, an article, a game keep silence) */
export function whereLine({ known, pin, isList, from, cf }) {
  if (!known) return "";
  if (pin) return whereHtml(from, pin, cf.city);
  if (isList) return whereCityHtml(cf);
  return "";
}

/* One streaming pass. The JSON-LD sits in <head> and every heading after it,
 * so the page's own position is known before there is anywhere to write it —
 * which is why this needs no second fetch and no rebuild of the 88,000 pages
 * that already carry the coordinate. A page without one is untouched beyond
 * its meta. */
/* A page bigger than this gets its meta filled and nothing else. The biggest
 * hub pages run to tens of megabytes of rows, their JSON-LD is a list rather
 * than a place, and walking one to learn that would cost real time on a page
 * that was never going to draw the line. */
const GEO_MAX_BYTES = 2_000_000;
const LD_MAX_CHARS = 65_536;

function withWhere(res, request, size) {
  const cf = request.cf || {};
  /* The guess counts only inside a covered city (where.js): outside one the
   * meta carries no position and no line is drawn. */
  const g = trustedGuess(cf);
  const v = [g ? g.city : "", g ? g.lat : "", g ? g.lon : "",
             cf.timezone || "", cf.country || ""].join("|");
  const from = g ? { lat: g.lat, lon: g.lon } : { lat: NaN, lon: NaN };
  const known = !!g;

  let pin = null;      // the page's own position, set while the head streams
  let isList = false;  // an ItemList in the head → this is a directory or shelf
  let drawn = false;
  let metaSeen = false;
  const rw = noTranslate(new HTMLRewriter(), (end) => {
    if (!metaSeen) end.before(`<meta name="md-where" content="${esc(v)}">`, { html: true });
  }, request.url)
    .on('meta[name="md-where"]', {
      element(e) { metaSeen = true; e.setAttribute("content", v); },
    });

  if (known) {
    /* The full geo read is skipped on the biggest hub pages (GEO_MAX_BYTES):
     * walking tens of megabytes of rows to learn the page is a list, not a
     * place, would cost real time. The ItemList scan below is cheap either way
     * — HTMLRewriter hands it only the ld+json text, not the whole page — so a
     * shelf too big to walk still earns its city line. */
    const parseGeo = !(size > GEO_MAX_BYTES);
    rw.on('script[type="application/ld+json"]', {
      text(t) {
        /* An ItemList means a directory or a shelf: many places, none of them
         * where the page stands. The token is distinct from BreadcrumbList and
         * ListItem, and it sits at the head of the block, so a substring scan
         * of the streamed text settles it without a parse. */
        if (!isList && t.text.includes("ItemList")) isList = true;
        if (!parseGeo || pin === false) return;
        this.buf = (this.buf || "") + t.text;
        /* A block this long is a catalogue, not a place. Dropping it beats
         * holding megabytes of it in the isolate to reach the same answer. */
        if (this.buf.length > LD_MAX_CHARS) { this.buf = ""; pin = false; return; }
        if (!t.lastInTextNode) return;
        try {
          const found = [];
          collectGeo(JSON.parse(this.buf), found);
          /* A directory page carries a coordinate for every place it lists and
           * none of them is where the page is, so more than one distinct
           * coordinate means no distance line rather than a guess at which one
           * counts — it still draws the reader's city below. */
          const uniq = Array.from(new Set(found.map((g) => `${g.lat},${g.lon}`)));
          if (pin === null && uniq.length === 1) {
            const [lat, lon] = uniq[0].split(",").map(Number);
            pin = { lat, lon };
          } else if (uniq.length) {
            pin = false;
          }
        } catch { /* a block that will not parse tells us nothing */ }
        this.buf = "";
      },
    }).on("h1", {
      element(e) {
        if (drawn) return;
        drawn = true;
        const line = whereLine({ known, pin, isList, from, cf });
        if (line) e.after(line, { html: true });
      },
    });
  }
  const out = rw.transform(res);
  /* One reader's city must never be handed to the next one out of a shared
   * cache. The HTML is not cached at the edge today; this says it out loud so
   * it cannot start being. */
  out.headers.set("cache-control", "private, max-age=0, must-revalidate");
  NT_DONE.add(out);
  return out;
}

export function collectGeo(obj, out) {
  if (Array.isArray(obj)) { for (const v of obj) collectGeo(v, out); return; }
  if (!obj || typeof obj !== "object") return;
  const g = obj.geo;
  if (g && typeof g === "object") {
    const lat = Number(g.latitude), lon = Number(g.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lon) && (lat || lon) &&
        Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      out.push({ lat: Number(lat.toFixed(6)), lon: Number(lon.toFixed(6)) });
    }
  }
  for (const v of Object.values(obj)) collectGeo(v, out);
}

/* ------------------------------------------------------------------ API */

/* The baked index, parsed once per isolate. A cold isolate pays one R2 GET and
 * one parse; every request after that is memory. INDEX_P (not INDEX) is what
 * is cached so that N concurrent cold requests share ONE fetch instead of
 * racing to do the same work N times. A failed load is not cached — it clears
 * the promise so the next request retries rather than inheriting an outage.
 *
 * WHY THERE IS A REVALIDATION CLOCK HERE
 * -------------------------------------
 * Cached "once per isolate" meant once per isolate FOREVER, and an isolate
 * lives as long as Cloudflare cares to keep it. README.md promises that "the
 * API ships with a content deploy, not a Worker deploy" — and it did not.
 * Measured 2026-09-07: a full content deploy put a fresh index.json in the
 * bucket (generated 09-07, 25,914 places) and /api/v1/places went on answering
 * from the 09-05 copy, 25,856 places, through three cache-busted requests. The
 * only thing that cleared it was redeploying the Worker, which is exactly the
 * step the README says a content deploy does not need.
 *
 * So the index is now revalidated against the bucket at most once every
 * REVALIDATE_MS. The check is a HEAD — metadata only, no body, no parse — and
 * it compares etags. Same etag, nothing happens and the request is still
 * answered from memory. Different etag, the parsed copy is dropped and the
 * next load picks up the new one.
 *
 * The cost is one R2 HEAD per minute per isolate, not one per request. The
 * bound on staleness is REVALIDATE_MS, not the isolate's lifetime.
 *
 * A FAILED HEAD IS NOT AN OUTAGE. If the metadata call throws, we keep serving
 * the index we already hold and try again next window. The alternative — treat
 * a blipped HEAD as "reload everything" — would turn a metadata hiccup into a
 * cold parse on every isolate at once, which is a worse failure than answering
 * from a copy that is at most a minute old. */
const REVALIDATE_MS = 60_000;
let INDEX_P = null;
let INDEX_ETAG = null;
let INDEX_CHECKED = 0;

async function revalidateIndex(env) {
  const now = Date.now();
  if (!INDEX_P || now - INDEX_CHECKED < REVALIDATE_MS) return;
  INDEX_CHECKED = now;              // set BEFORE the await: a slow HEAD must
                                    // not let every concurrent request start
                                    // one of its own.
  try {
    const head = await env.SITE.head("api/v1/index.json");
    if (head && INDEX_ETAG && head.httpEtag !== INDEX_ETAG) {
      INDEX_P = null;
      INDEX_ETAG = null;
      EDGE_P = null;      // the shards were rebuilt with the index; walk the new ones
      CORE_P = null;
    }
  } catch (e) {
    /* keep what we have; try again next window */
  }
}

/* THE ENGINE AT THE EDGE (Nan, 2026-09-10: "Worker can run search engine,
 * that's fine"). searchcore — the same file the page runs — over the postings
 * publish/emit_edge_index.js wrote as shards under api/v1/edge/. The isolate
 * holds the vocabulary and the API index it already had; a posting list is
 * fetched from the bucket only when a query needs it. See edgesearch.js. */
let EDGE_P = null;
let CORE_P = null;

/* The engine's files through the data centre's cache (r2cache.js). Measured
 * 2026-10-20 from Chiang Mai: a "tulou" query on a fresh isolate made 28
 * bucket reads at ~2.6 s each, 8–17 s an answer, and traffic is light enough
 * that most answers start on a fresh isolate. The copies are named by
 * meta.json's etag, so a rebuilt index is read whole and new, never mixed. */
const R2N = { n: 0, ms: 0 };   // bucket reads by the engine, for server-timing
function edgeLoader(env, base = "api/v1/edge/") {
  let verP = null;
  const ver = () => verP || (verP = env.SITE.head(base + "meta.json")
    .then((h) => (h ? h.httpEtag : "")).catch(() => ""));
  return async (rel) => {
    const t = Date.now();
    const v = rel === base + "meta.json" ? "" : await ver();
    const o = v ? await cachedGet(env, rel, 86400, v) : await env.SITE.get(rel);
    const j = o ? await o.json() : null;
    R2N.n++; R2N.ms += Date.now() - t; return j;
  };
}

function edgeCore(env) {
  if (!CORE_P) {
    CORE_P = (async () => {
      const [th, sg] = await Promise.all([cachedGet(env, "data/search_thesaurus.json", 3600),
                                          cachedGet(env, "data/search_segdict.txt", 3600)]);
      const groups = th ? (await th.json()).groups : [];
      const seg = sg ? (await sg.text()).split("\n").filter((l) => l && l[0] !== "#") : [];
      return new SEARCHCORE.SearchCore(groups, seg);
    })().catch((e) => { CORE_P = null; throw e; });
  }
  return CORE_P;
}

function edgeIndex(env) {
  if (!EDGE_P) {
    EDGE_P = (async () => {
      const ix = new EdgeIndex(await edgeCore(env), edgeLoader(env));
      await ix.init();
      return ix;
    })().catch((e) => { EDGE_P = null; throw e; });
  }
  return EDGE_P;
}

/* REFINE FACETS — the narrowing chips, computed from the result set itself.
 *
 * A reader who typed two ordinary words ("japanese restaurant", "skin tag
 * removal", "somewhere to fix my zip") cannot be asked to also know our shelf
 * codes. So after the words are answered, we read what the ANSWER is made of —
 * its cuisines, its shelves, its services, its districts, whether any of it
 * keeps hours — and hand back the handful of splits that would actually divide
 * THIS set. Every value is a term the reader can add to their query; the chip
 * re-asks with one more word, which narrows on any engine and needs no field
 * the index does not already carry.
 *
 * GENEROUS, and read off what the row already tells us — the tags the build
 * writes, the shelf, the match blob — never a new column. A value every row
 * shares is dropped: it narrows nothing. Kept small on purpose: six per group,
 * and only groups that split the set. */
const RF_CATLABEL = { food: ["ร้านอาหาร", "food & eats"], medical: ["คลินิก-โรงพยาบาล", "clinics & hospitals"],
  shopping: ["ร้านค้า", "shops"], repair: ["ซ่อม", "repair"], beauty: ["ความงาม", "beauty"],
  hotel: ["ที่พัก", "stays"], school: ["โรงเรียน", "schools"], transport: ["เดินทาง", "transport"],
  wat: ["วัด", "temples"], market: ["ตลาด", "markets"], essentials: ["ของใช้", "essentials"],
  business: ["บริการ", "services"], sights: ["ที่เที่ยว", "sights"], community: ["ชุมชน", "community"],
  realestate: ["อสังหาฯ", "property"] };
const RF_ORDER = ["cuisine", "kind", "service", "type", "area", "feature", "open"];
const RF_GROUP_LABEL = { cuisine: ["อาหาร", "cuisine"], kind: ["ประเภท", "kind"], service: ["บริการ", "service"],
  type: ["หมวด", "category"], area: ["ย่าน", "area"], feature: ["สิ่งอำนวย", "features"], open: ["เวลาเปิด", "open"] };

function rfWord(hay, w) { return hay.includes(w); }

/* rows: the api index rows of the whole matched set (before paging). `qwords`:
 * the words already typed, so a chip never offers a term the reader gave. */
export function refineFacets(rows, qwords) {
  const n = rows.length;
  if (n < 2) return [];
  const typed = new Set((qwords || []).map(w => w.toLowerCase()));
  const dims = {};             // dim -> Map(value -> [count, add-term, thLabel, enLabel])
  const bump = (dim, value, add, th, en) => {
    if (typed.has((add || value).toLowerCase())) return;
    let m = dims[dim]; if (!m) { m = new Map(); dims[dim] = m; }
    const row = m.get(value) || [0, add || value, th || value, en || value];
    row[0] += 1; m.set(value, row);
  };
  for (const r of rows) {
    const cat = r.cat || [], sub = r.sub || [], tags = r.tags || [];
    /* A row from the packed store (rowstore.js) has no `q`; its _rf masks
     * say which refine words its text carries, worked out the same way. */
    const bits = r._rf;
    const hay = bits ? "" : ((r.q || "") + " " + (r.name || "") + " " + (r.nameEn || "")).toLowerCase();
    const has = (group, w) => bits ? refineBit(bits, group, w)
      : group === "feature" ? RF_FEATURE[w].some(nd => hay.includes(nd)) : (tags.includes(w) || rfWord(hay, w));
    for (const c of cat) { const l = RF_CATLABEL[c]; bump("type", c, l ? l[1] : c, l ? l[0] : c, l ? l[1] : c); }
    for (const s of sub) bump("kind", s, s, s, s);
    if (cat.includes("food")) for (const cz of RF_CUISINE)
      if (has("cuisine", cz)) bump("cuisine", cz, cz, cz, cz);
    for (const sv of RF_SERVICE) if (has("service", sv)) bump("service", sv, sv, sv, sv);
    for (const f in RF_FEATURE) if (has("feature", f)) bump("feature", f, RF_FEATURE[f][0], f, f);
    for (const t of tags) {
      if (t.startsWith("in-mueang-")) { const a = t.slice(3).replace(/-/g, " "); bump("area", a, a, a, a); }
      else if (t.startsWith("tambon-")) { const a = "tambon " + t.slice(7).replace(/-/g, " "); bump("area", a, t.slice(7).replace(/-/g, " "), a, a); }
    }
    if ((r.has || []).includes("hours")) bump("open", "open", "open now", "เปิดอยู่", "open now");
  }
  const out = [];
  for (const dim of RF_ORDER) {
    const m = dims[dim]; if (!m) continue;
    const vals = [...m.entries()]
      .filter(([, row]) => row[0] < n && row[0] > 0)      // a value shared by all narrows nothing
      .sort((a, b) => b[1][0] - a[1][0])
      .slice(0, 6)
      .map(([value, [count, add, th, en]]) => ({ value, add, count, th, en }));
    if (vals.length) out.push({ dim, th: RF_GROUP_LABEL[dim][0], en: RF_GROUP_LABEL[dim][1], values: vals });
  }
  return out;
}

/* /api/v1/search?q=…&limit=&offset=&province= — the words, ranked as the page
 * ranks them: tier, weight, coverage, loosen-by-steps. A city in q narrows to
 * its province (api.js liftProvince). What the page adds AFTER ranking — the
 * landmark, the tag routes, the shelf lift, the rail — stays on the page; the
 * page asks this first and repaints over it when its own index has landed. */
/* A name folded for comparison: lower case, letters and digits, one space,
 * and a leading or trailing kind word (restaurant, cafe, ร้าน …) taken off. */
const KIND_WORD = /^(restaurant|cafe|café|coffee|shop|store|bar|hotel|hostel|resort|spa|clinic|ร้าน|ร้านอาหาร|คาเฟ่|โรงแรม)$/;
export function nameKey(s) {
  return String(s || "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, " ").trim()
    .split(" ").filter((w, i, a) => w && !((i === 0 || i === a.length - 1) && a.length > 1 && KIND_WORD.test(w))).join(" ");
}

export async function searchHandler(env, ix, sp, now = new Date()) {
  const raw = sp.get("q") || "";
  const p = parseQuery(sp);
  const q = p.q;
  const province = p.province;
  const limit = p.limit;
  const offset = p.offset;
  /* WO-87. The endpoint answered words and one province and nothing else, so
   * the results page could only ask it for a bare query — every chip the
   * reader had tapped sent them back to waiting on 6.2 MB of index. It takes
   * the page's own filters now (tag, sub, cat, near, and the rest parseQuery
   * already read), applied through the same predicate /api/v1/places uses.
   *
   * Two shapes, not one:
   *   words + filters — searchcore answers the words, the predicate narrows
   *                     its hits, and the ranking that came out of the tiers
   *                     is kept.
   *   filters, no words — there is nothing for searchcore to rank, so the
   *                     index itself is walked, in the order /api/v1/places
   *                     would walk it: nearest when a point was given, best
   *                     known otherwise. This is the case the page could
   *                     never ask about at all.
   */
  const filtered = !!(p.cat.length || p.sub.length || p.tag.length || p.lens.length
                      || p.facet.length || p.has.length || p.minAnts || p.near
                      || p.bbox || p.openNow || p.openAt != null);
  const echo = {};
  for (const k of ["q", "province", "cat", "sub", "tag", "lens", "facet", "has",
                   "min_ants", "near", "radius", "bbox", "open_now", "open_at"]) {
    if (sp.has(k)) echo[k] = sp.get(k);
  }
  const envelope = { schemaVersion: SCHEMA_VERSION, generated: ix.generated, engine: "searchcore",
                     query: { ...echo, q: raw, ...(province ? { province } : {}), limit, offset } };
  const empty = { ...envelope, total: 0, count: 0, tier: null, results: [],
                  attribution: ix.attribution, licence: ix.licence, terms: ix.terms };
  if (!q.trim() && !filtered) return empty;
  const schedules = ix.schedules || [];
  const minute = p.openAt != null ? p.openAt : (p.openNow ? minuteOfWeek(now) : null);
  const nowMinute = minuteOfWeek(now);

  let rows;      // [row, distance|null, score|null, tier|null]
  let notes = null;
  if (q.trim()) {
    const edge = await edgeIndex(env);
    const an = edge.core.analyze(q, edge);
    notes = an.notes;
    const hits = await edge.search(an, 0);
    rows = [];
    for (const h of hits) {
      const row = findPlace(ix, h.id);
      if (!row) continue;
      const d = rowMatches(row, p, schedules, minute);
      if (d === false) continue;
      rows.push([row, d, h.score, h.tier]);
    }
    /* A place whose name is the words comes first, then one whose name holds
     * them as whole words; the engine's order stands inside each (gemba 2,
     * 2026-10-20: a place's own name came first 43 of 60 times here against
     * 51 on /find). Near-sorts keep their order. */
    if (!p.near) {
      const fq = nameKey(q);
      const tierOf = (r) => {
        const ks = [r.name, r.nameEn].filter(Boolean).map(nameKey);
        if (ks.includes(fq)) return 0;
        return ks.some((k) => (" " + k + " ").includes(" " + fq + " ")) ? 1 : 2;
      };
      rows = rows.map((r, i) => [r, tierOf(r[0]), i])
        .sort((a, b) => a[1] - b[1] || a[2] - b[2]).map((x) => x[0]);
    }
  } else {
    rows = [];
    for (const row of ix.places) {
      const d = rowMatches(row, p, schedules, minute);
      if (d === false) continue;
      rows.push([row, d, null, null]);
    }
    if (p.near) rows.sort((a, b) => a[1] - b[1] || cmpPlaceName(a[0], b[0]));
    else rows.sort((a, b) => cmpPlaceDefault(a[0], b[0]));
  }

  const page = rows.slice(offset, offset + limit);
  const results = page.map(([row, d, score, tier]) => {
    const out = present(row, ix.base, { near: p.near }, schedules, nowMinute);
    if (score != null) { out.score = Math.round(score * 1000) / 1000; out.tier = tier; }
    if (d != null) out.distanceM = Math.round(d);
    return out;
  });
  const refine = refineFacets(rows.map(r => r[0]),
                              (q || "").toLowerCase().split(/\s+/).filter(Boolean));
  return { ...envelope, total: rows.length, count: results.length,
           tier: rows.length && rows[0][3] != null ? rows[0][3] : null,
           notes, refine, results, attribution: ix.attribution, licence: ix.licence, terms: ix.terms };
}

/* The 🎲 destinations. Re-read every ten minutes so an isolate that has been
 * warm across a deploy cannot keep sending readers to a page that was removed;
 * a stale face costs one 404, not an error, which is why this is a timestamp
 * rather than the etag dance loadIndex does for the 74 MB index. */
const DICE_TTL_MS = 600_000;
let DICE_P = null;
let DICE_AT = 0;

function dice(env) {
  const now = Date.now();
  if (!DICE_P || now - DICE_AT > DICE_TTL_MS) {
    DICE_AT = now;
    DICE_P = (async () => {
      const obj = await env.SITE.get("data/dice.json");
      if (!obj) throw new Error("dice not deployed");
      return JSON.parse(await obj.text());
    })().catch((e) => { DICE_P = null; throw e; });
  }
  return DICE_P;
}

function loadIndex(env) {
  if (!INDEX_P) {
    INDEX_P = (async () => {
      /* Read straight from the bucket: through the colo cache the whole
       * 69 MB was held twice over before the parse, against a 128 MB
       * isolate (review of PR #24, 2026-10-20; the 2026-09-10 note at
       * cacheFor measured hand-caching big bodies slower too). */
      const obj = await env.SITE.get("api/v1/index.json");
      if (!obj) throw new Error("api index not deployed");
      INDEX_ETAG = obj.httpEtag;
      return JSON.parse(await obj.text());
    })().catch((e) => { INDEX_P = null; INDEX_ETAG = null; throw e; });
  }
  return INDEX_P;
}

/* THE PACKED ROWS (2026-10-22, ticket "search · answer in under a second").
 * index.json no isolate can keep, so the search, /places/<id>, /health and
 * the descriptor read api/v1/rows/ instead (publish/rowstore.js): ~36 MB held,
 * read once per isolate through the colo cache and re-checked once a minute
 * like the grid. Missing or out of step, they walk the index as before. */
let ROWS_P = null;
let ROWS_ETAG = null;
let ROWS_CHECKED = 0;

async function revalidateRows(env) {
  const now = Date.now();
  if (!ROWS_P || now - ROWS_CHECKED < REVALIDATE_MS) return;
  ROWS_CHECKED = now;
  try {
    const head = await env.SITE.head("api/v1/rows/text.json");
    if ((head ? head.httpEtag : null) !== ROWS_ETAG) { ROWS_P = null; ROWS_ETAG = null; }
  } catch { /* keep what we have; try again next window */ }
}

function loadRows(env) {
  if (!ROWS_P) {
    ROWS_CHECKED = Date.now();
    ROWS_P = (async () => {
      const head = await env.SITE.head("api/v1/rows/text.json");
      if (!head) return null;                      // not deployed: the index answers
      const t = await cachedGet(env, "api/v1/rows/text.json", 86400, head.httpEtag);
      if (!t) return null;
      const text = await t.json();
      if (text.rw !== refineSig()) { console.error("api/v1/rows written with other refine words"); return null; }
      /* keyed by the object's own etag, so bytes caught mid-deploy cannot sit
       * under the next version's name */
      const bh = await env.SITE.head("api/v1/rows/cols.bin");
      if (!bh) return null;
      const b = await cachedGet(env, "api/v1/rows/cols.bin", 86400, bh.httpEtag);
      if (!b) return null;
      const buf = await b.arrayBuffer();
      const sum = [...new Uint8Array(await crypto.subtle.digest("SHA-1", buf))]
        .map((x) => x.toString(16).padStart(2, "0")).join("").slice(0, 12);
      if (sum !== text.bv) { console.error("api/v1/rows out of step", sum, text.bv); return null; }
      ROWS_ETAG = head.httpEtag;
      return new RowStore(text, buf);
    })().catch((e) => { ROWS_P = null; ROWS_ETAG = null; console.error("api/v1/rows fault", e && e.message); return null; });
  }
  return ROWS_P;
}

/* The rows when they are deployed, else the index. */
async function loadLean(env) {
  return (await loadRows(env)) || loadIndex(env);
}

/* THE BOX INDEX (2026-10-11). api/v1/grid/, written by publish/emit_grid.mjs:
 * meta.json (3.6 MB, held per isolate) answers a bbox query's filter and
 * count, and the page's rows come from a few of the chunk files. See "the
 * grid" in api.js. meta is re-checked against the bucket once a minute, as
 * the index is. A chunk is kept only when it carries meta's v; any other
 * fault drops meta and the request walks the index instead. */
let GRID_P = null;
let GRID_ETAG = null;
let GRID_CHECKED = 0;
const GRID_ROWS = new Map();         // `${v}/${c}` -> rows, newest last
const GRID_KEEP = 24;

async function revalidateGrid(env) {
  const now = Date.now();
  if (!GRID_P || now - GRID_CHECKED < REVALIDATE_MS) return;
  GRID_CHECKED = now;
  try {
    const head = await env.SITE.head("api/v1/grid/meta.json");
    if ((head ? head.httpEtag : null) !== GRID_ETAG) { GRID_P = null; GRID_ETAG = null; }
  } catch { /* keep what we have; try again next window */ }
}

function loadGrid(env) {
  if (!GRID_P) {
    GRID_CHECKED = Date.now();
    GRID_P = (async () => {
      /* a cold isolate takes meta from the colo cache, keyed by its etag */
      const head = await env.SITE.head("api/v1/grid/meta.json");
      if (!head) return null;                      // not deployed: the index answers
      const key = (etag) => new Request("https://motdang.net/__grid/meta/" + encodeURIComponent(etag));
      let cache = null;
      try {
        cache = caches.default;
        const hit = await cache.match(key(head.httpEtag));
        if (hit) { GRID_ETAG = head.httpEtag; return JSON.parse(await hit.text()); }
      } catch { cache = null; }
      const obj = await env.SITE.get("api/v1/grid/meta.json");
      if (!obj) return null;
      GRID_ETAG = obj.httpEtag;
      const text = await obj.text();
      if (cache) {
        try { await cache.put(key(obj.httpEtag), new Response(text, { headers: { "cache-control": "public, max-age=86400" } })); }
        catch { /* the answer stands without the copy */ }
      }
      return JSON.parse(text);
    })().catch((e) => { GRID_P = null; GRID_ETAG = null; throw e; });
  }
  return GRID_P;
}

/* Two layouts, told apart by meta. Layout 2 (2026-10-13): meta.cn names each
 * chunk file and meta.cv holds its own hash, so a publish rewrites only the
 * chunks whose rows changed. Layout 1: c0000.json … all stamped with meta.v. */
async function gridChunk(env, meta, c) {
  const file = meta.cn ? meta.cn[c] + ".json" : "c" + String(c).padStart(4, "0") + ".json";
  const want = meta.cv ? meta.cv[c] : meta.v;
  const k = meta.cn ? meta.cn[c] + "/" + want : meta.v + "/" + c;
  const held = GRID_ROWS.get(k);
  if (held) { GRID_ROWS.delete(k); GRID_ROWS.set(k, held); return held; }
  let cache = null, req = null, text = null;
  try {
    cache = caches.default;
    req = new Request("https://motdang.net/__grid/" + k);
    const hit = await cache.match(req);
    if (hit) text = await hit.text();
  } catch { cache = null; }
  const fresh = text == null;
  if (fresh) {
    const obj = await env.SITE.get("api/v1/grid/" + file);
    if (!obj) throw new Error("grid chunk missing");
    text = await obj.text();
  }
  const body = JSON.parse(text);
  if (body.v !== want) throw new Error("grid chunk out of step");
  if (fresh && cache) {
    try { await cache.put(req, new Response(text, { headers: { "cache-control": "public, max-age=86400" } })); }
    catch { /* the answer stands without the copy */ }
  }
  GRID_ROWS.set(k, body.rows);
  while (GRID_ROWS.size > GRID_KEEP) GRID_ROWS.delete(GRID_ROWS.keys().next().value);
  return body.rows;
}

/* The /places answer from the grid, or null when the index has to walk. */
async function placesFromGrid(env, sp, timing) {
  if (!gridEligible(parseQuery(sp))) return null;
  try {
    const t0 = Date.now();
    const cold = !GRID_P;
    await revalidateGrid(env);
    const meta = await loadGrid(env);
    if (!meta) return null;
    const t1 = Date.now();
    let reads = 0;
    const body = await queryPlacesGrid(meta, (c) => { reads++; return gridChunk(env, meta, c); }, sp);
    timing.push(`meta;dur=${t1 - t0};desc=${cold ? "cold" : "held"}`,
                `rows;dur=${Date.now() - t1};desc=${reads}chunks`);
    return body;
  } catch (e) {
    console.error("/api/v1/places grid fault, walking the index", e && e.message);
    GRID_P = null; GRID_ETAG = null;
    return null;
  }
}

/* Discovery the standard way (RFC 8631), so a client that lands on any
 * endpoint can find the documentation and the machine spec without anyone
 * having told it where they are — and so can a person reading -v output. The
 * licence link is here for the same reason it is in every body: the terms are
 * the first thing a reuser needs and the last thing they should have to hunt
 * for. Listed in access-control-expose-headers so a browser can read them. */
const API_LINKS = [
  '<https://motdang.net/api/>; rel="service-doc"',
  '<https://motdang.net/api/v1/openapi.json>; rel="service-desc"',
  '<https://motdang.net/api/v1/schema.json>; rel="describedby"',
  '<https://motdang.net/terms.html>; rel="license"',
].join(", ");

/* Five minutes of edge cache on every API response. The corpus changes once a
 * build, so anything shorter buys nothing; anything longer would make an
 * emergency correction take too long to reach a reader standing in a street. */
const API_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
  link: API_LINKS,
  ...CORS,
  "access-control-expose-headers": CORS["access-control-expose-headers"] + ", link",
};

function apiJson(body, status = 200, extra) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...API_HEADERS,
      "cache-control": status === 200 ? "public, max-age=300" : "no-store",
      ...extra,
    },
  });
}

/* An error a person can act on: what went wrong, and where the answer is. */
const apiError = (status, error, hint) =>
  apiJson({ schemaVersion: SCHEMA_VERSION, error, hint,
            docs: "https://motdang.net/api/" }, status);

/* The short form of an error for a body: its class, then the head of its
 * message. The whole error goes to the log. */
const errCode = (e) => {
  const name = e && e.name && e.name !== "Error" ? e.name : "";
  const msg = String((e && e.message) || e || "").slice(0, 60);
  return name && msg ? `${name}: ${msg}` : name || msg || "unknown";
};

async function api(request, env, url, path, ctx) {
  /* Has the bucket been rebuilt under us? At most one HEAD a minute per
   * isolate; see REVALIDATE_MS. Placed here rather than inside loadIndex so
   * that it runs once per API request instead of once per loadIndex call —
   * a single request can make three. */
  await revalidateIndex(env);
  await revalidateRows(env);

  /* The descriptor, the spec and the schema are baked files — served straight
   * from the bucket so that what the API says about itself is written by the
   * same build that wrote the data, and cannot drift from it. */
  const baked = { "/index.json": "index", "/openapi.json": "openapi", "/schema.json": "schema" };
  if (baked[path]) {
    const obj = await env.SITE.get(`api/v1/${baked[path]}.json`);
    if (!obj) return apiError(503, "api not deployed", "the build has not been published yet");
    return new Response(obj.body, {
      headers: { ...API_HEADERS, "cache-control": "public, max-age=300" },
    });
  }

  /* The descriptor is index.json's head, not its 13,000 rows: a reader asking
   * "what is this" should not be handed several megabytes to find out. The
   * bulk file keeps its own address, named right here so it is one hop away. */
  if (path === "" || path === "/") {
    let ix;
    try { ix = await loadLean(env); }
    catch (e) { return apiError(503, "api not deployed", String(e.message)); }
    const { places, schedules, ...head } = ix.head || ix;
    return apiJson({ ...head,
      bulk: { url: ix.base + "api/v1/index.json", places: ix.count,
              note: "the whole query index in one file — take it and stop asking us" } });
  }

  if (path === "/health") {
    try {
      const ix = await loadLean(env);
      return apiJson({ schemaVersion: SCHEMA_VERSION, ok: true,
                       generated: ix.generated, places: ix.places.length,
                       minuteOfWeekBangkok: minuteOfWeek() });
    } catch (e) {
      return apiJson({ schemaVersion: SCHEMA_VERSION, ok: false, error: String(e.message) }, 503);
    }
  }

  /* THE ANSWER IS KEPT AT THE COLO (2026-09-10). Measured that night from
   * Chiang Mai: /api/v1/health — no scan, no sort, only loadIndex — answered
   * in 3.4 s, 9.0 s and 4.1 s; nine requests landed on five colos, and two
   * in a row to SIN were both slow. api/v1/index.json is 69 MB now (88,221
   * rows) and parses to 228 MB of heap in node against a 128 MB isolate, so
   * no isolate keeps it and every request streams it from R2 again: that is
   * the seconds. The scan is 30-450 ms and the parse 300. A Worker's own
   * response is not CDN-cached, so the max-age=300 above bought nothing at
   * the edge; here the answer is put in caches.default under its own URL
   * with that same header, so the same question asked again in the same
   * colo within five minutes never touches the index. A miss costs one
   * local lookup and fetches nothing to find it. GET only.
   *
   * /search JOINS IT (WO-87, 2026-09-18). It was left out when this was
   * written, and measured from here the day the filters landed it was paying
   * the whole bill every time: 1.7 s for a filter with no words and 3.8-7.8 s
   * for one with words, on repeat, while /places answered the same question
   * in 93 ms off this cache. Nothing about the answer is per-reader — the
   * query string IS the question — and a chip is the same URL for everybody
   * who taps it, which is the shape a colo cache is for. near= carries a
   * coordinate and will mostly miss; that is the price of asking where you
   * are standing, and it is the same price it was paying before. */
  let cache = null, ckey = null;
  if ((path === "/places" || path === "/search") && request.method === "GET") {
    try {
      cache = caches.default;
      ckey = new Request(url.href);
      const hit = await cache.match(ckey);
      if (hit) {
        const r = new Response(hit.body, hit);
        r.headers.set("x-md-edge", "hit");
        return r;
      }
    } catch {
      cache = null;                    /* no cache here: computed, as before */
    }
  }

  if (path === "/places") {
    const timing = [];
    const body = await placesFromGrid(env, url.searchParams, timing);
    if (body) {
      const res = apiJson(body);
      res.headers.set("server-timing", timing.join(", "));
      if (cache && ckey) {
        try { ctx.waitUntil(cache.put(ckey, res.clone()).catch(() => {})); }
        catch { /* unfilled: the next asker computes it */ }
        res.headers.set("x-md-edge", "miss");
      }
      res.headers.set("x-md-grid", "1");
      return res;
    }
  }

  let ix;
  /* What a cold isolate pays, said in the answer (gemba 2, 2026-10-20: the
   * search took 5–14 s a query). */
  const lean = path !== "/places";             // only /places?q= reads the match blob
  const coldIx = lean ? !ROWS_P : !INDEX_P, coldEdge = !EDGE_P, tIx = Date.now();
  try {
    ix = lean ? await loadLean(env) : await loadIndex(env);
  } catch (e) {
    return apiError(503, "index unavailable", String(e.message));
  }
  const msIx = Date.now() - tIx;

  if (path === "/places") {
    const res = apiJson(queryPlaces(ix, url.searchParams));
    if (cache && ckey) {
      try { ctx.waitUntil(cache.put(ckey, res.clone()).catch(() => {})); }
      catch { /* unfilled: the next asker computes it */ }
      res.headers.set("x-md-edge", "miss");
    }
    return res;
  }

  if (path === "/search") {
    try {
      const tS = Date.now(); const r0 = { ...R2N };
      const body = await searchHandler(env, ix, url.searchParams);
      const res = apiJson(body);
      res.headers.set("server-timing", `${ix instanceof RowStore ? "rows" : "index"};dur=${msIx};desc="${coldIx ? "cold" : "warm"}", ` +
        `engine;dur=${Date.now() - tS};desc="${coldEdge ? "cold" : "warm"}", ` +
        `reads;dur=${R2N.ms - r0.ms};desc="${R2N.n - r0.n} bucket reads"`);
      /* How many answered, for the counter (record(): a search that found
       * nothing keeps its words there). Set before the clone so a cached copy
       * carries it too. */
      res.headers.set("x-md-n", String(body.total ?? (body.results || []).length));
      if (cache && ckey) {
        try { ctx.waitUntil(cache.put(ckey, res.clone()).catch(() => {})); }
        catch { /* unfilled: the next asker computes it */ }
        res.headers.set("x-md-edge", "miss");
      }
      return res;
    }
    catch (e) {
      /* edgesearch.js says "edge index missing" when api/v1/edge/ is not in
       * the bucket: the build that writes it has not been published, which
       * is not a fault. Anything else is a deployed engine breaking on a
       * query — said as such, and logged with the query. */
      if (/edge index missing/.test(String(e && e.message)))
        return apiError(503, "search engine not deployed",
          "the build that writes api/v1/edge/ has not been published yet — /api/v1/places?q= still answers");
      console.error("/api/v1/search fault", url.search, e);
      return apiJson({ schemaVersion: SCHEMA_VERSION, error: "search engine fault", code: errCode(e),
                       hint: "the engine broke on this query — /api/v1/places?q= still answers",
                       docs: "https://motdang.net/api/" }, 500);
    }
  }

  if (path.startsWith("/places/")) {
    const key = decodeURIComponent(path.slice(8));
    const row = findPlace(ix, key);
    if (!row) {
      /* A slug two records share resolves to neither. 300 rather than 404,
       * because the place is not missing — the key is. The candidates come
       * back as ids, which are unique, so the caller can ask again and be
       * certain of the answer instead of taking our guess. */
      const many = slugCandidates(ix, key);
      if (many.length)
        return apiJson({
          schemaVersion: SCHEMA_VERSION,
          error: "ambiguous key",
          hint: "this page slug is shared; ask again by id",
          candidates: many.map((r) => ({
            id: r.id, name: r.name,
            apiUrl: ix.base + "api/v1/places/" + r.id,
            url: ix.base + `${r.province}/p/${r.slug}.html`,
          })),
          docs: "https://motdang.net/api/",
        }, 300);
      return apiError(404, "no such place",
        "try /api/v1/places?q=… — ids and page slugs both work here");
    }
    /* The full record is the .json sibling the place page has always had, not
     * a second rendering of it. One shape, one generator, nothing to drift. */
    const obj = await env.SITE.get(`${row.province}/p/${row.slug}.json`);
    if (!obj) return apiError(404, "record not deployed", "known to the index, absent from the bucket");
    return new Response(obj.body, {
      headers: { ...API_HEADERS, "cache-control": "public, max-age=300" },
    });
  }

  if (path === "/categories")
    return apiJson({ schemaVersion: SCHEMA_VERSION, generated: ix.generated,
                     provinces: ix.provinces, categories: ix.categories,
                     attribution: ix.attribution, terms: ix.terms });

  if (path === "/tags")
    return apiJson({ schemaVersion: SCHEMA_VERSION, generated: ix.generated,
                     tags: ix.tags, lenses: ix.lenses, facets: ix.facets,
                     attribution: ix.attribution, terms: ix.terms });

  return apiError(404, "no such endpoint",
    "GET /api/v1/ lists every endpoint this version has");
}

async function serve(request, env, ctx) {
  const url = new URL(request.url);

  /* A preflight is answered for every path, not just /api/: a browser will
   * send one for a plain GET the moment the caller sets a header, and a 405
   * there would fail the fetch after the licence said yes. */
  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers: CORS });

  /* The mailing list (subscribe.js). Ahead of the GET/HEAD guard because the
   * sign-up form POSTs here; subscribe() refuses on its own every method a
   * given path does not take. Double opt-in, and the confirmation mail is
   * gated off (MAILING_LIST_LIVE). */
  if (url.pathname === "/subscribe" || url.pathname === "/subscribe/" ||
      url.pathname === "/subscribe/confirm")
    return subscribe(request, env, url);

  /* The weekly issue (newsletter.js): the token-gated send, and unsubscribe. */
  if (ownsNewsletter(url.pathname))
    return newsletter(request, env, url);

  /* The listing-agent gate (lister.js): join, confirm, Nan's invite and
   * decline taps, sign-in, and /lister/me for the add form. */
  if (ownsLister(url.pathname))
    return lister(request, env, url);

  /* A reader's position, shared for an hour (live.js). POSTs from the sharer's
   * phone, GETs from the people holding the link. */
  if (ownsLive(url.pathname))
    return live(request, env, url);
  if (url.pathname === "/api/resolve")
    return resolve(url);

  /* What readers do on the maps (mapSense, below). A POST from sendBeacon. */
  if (url.pathname === "/api/map")
    return mapSense(request, env);
  /* What gets shared, and who comes back (sharesense.js). A POST from sendBeacon. */
  if (url.pathname === "/api/share")
    return shareSense(request, env, classify);
  /* The translator in the search box (quickanswer.js). */
  if (url.pathname === "/api/translate")
    return translateApi(url, env);
  /* What people tap on /find, and whether they come back (findlearn.js). */
  if (url.pathname === "/api/find")
    return findSense(request, env, classify);
  /* A reader's word on one results page: good, bad, and why (findlearn.js). */
  if (url.pathname === "/api/find/judge")
    return findJudge(request, env, classify);
  /* More for a reader signed in with LINE (me.js): the week on LINE, home
   * alerts, send to my LINE, reminders, export, delete. */
  if (ownsMe(url.pathname)) return me(request, env, url);

  /* Sign in with LINE and saved things across devices (accounts.js). */
  if (url.pathname.startsWith("/auth/") || url.pathname === "/api/me" || url.pathname === "/api/me/saved") {
    const r = await accounts(request, env, url);
    if (r) return r;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { allow: "GET, HEAD, OPTIONS", ...CORS },
    });
  }

  /* 🎲 /random — the door on 91,000 pages, rolled here instead of baked.
   *
   * It used to be one destination chosen at BUILD TIME and seeded by the
   * build date (build.py: RAND_FALLBACK). Every page carrying it was rewritten
   * when the date rolled, so the first deploy after midnight re-uploaded
   * 91,000 objects and 4.3 GiB to move a single die — the same shape as the
   * ?v= fingerprint that came out of these pages on 2026-09-10. The link is
   * now a fixed string, identical in every build, and the roll happens per
   * click, which is what a die is for.
   *
   * data/dice.json, not api/v1/index.json: the index is 74 MB and a cold
   * isolate would read all of it to answer one click. The dice file is 4,000
   * destinations in ~170 KB. A miss lands on the cm shelf rather than an
   * error — the point of the door is that it always opens on somewhere real.
   *
   * no-store because a cached 302 is a die that stopped rolling; noindex
   * because it is a door, not a page. */
  if (url.pathname === "/random" || url.pathname === "/random/") {
    let to = "/cm/index.html";
    try {
      const faces = await dice(env);
      if (faces && faces.length)
        to = "/" + faces[Math.floor(Math.random() * faces.length)];
    } catch {
      /* the shelf is a fine place to be sent */
    }
    return new Response(null, {
      status: 302,
      headers: { location: to, "cache-control": "no-store",
                 "x-robots-tag": "noindex", ...CORS },
    });
  }

  /* /api/v1/… is the machine; /api and /api/ fall through to the static
   * handler and land on the human page, api/index.html, with no redirect —
   * same rule as the rest of the site. The version lives in the path because
   * that is the promise: v1's keys never change under a reader, and the day
   * one must, it is v2 at a different address with v1 still running. */
  if (url.pathname.startsWith("/api/v1"))
    return api(request, env, url, url.pathname.slice(7), ctx);

  if (fleetOwns(url))
    return fleetSearch(request, env, url, ctx, () => edgeCore(env));

  /* Renamed shelves. The learn/ slug said classes while the shelf held
   * gyms (WO-37, 2026-08-26); the pages moved to sport/ and every old URL
   * keeps working — a rename must never eat a bookmark or a search
   * result. 301 so crawlers move their index to the new address. */
  const renamed = url.pathname.match(/^\/(cm|cr)\/learn(\/.*|$)/);
  if (renamed) {
    const to = `/${renamed[1]}/sport${renamed[2] || "/"}`;
    return Response.redirect(url.origin + to + url.search, 301);
  }

  /* Retired pages. /why was "ทำไมมดแดงดีกว่า Google" and stopped being built
   * on 2026-09-04; what.html answers the same question and is the page a
   * reader wanted. It matters more than an ordinary retirement: on
   * 2026-09-20 it was one of a handful of motdang.net URLs Google held, and
   * a 404 on the only address an index knows teaches that index the site is
   * gone. 301 moves the entry to a page that exists.
   *
   * /merit.html was the nine-temple page; /wats/ is the site that replaced it
   * on 2026-09-21 — the same rounds with the streets drawn, a page per wat, and
   * a slug that says what it holds. Anything that linked or bookmarked the old
   * address lands on the new one. */
  const retired = { "/why": "/what.html", "/why.html": "/what.html",
                    "/merit": "/wats/", "/merit.html": "/wats/" };
  if (retired[url.pathname])
    return Response.redirect(url.origin + retired[url.pathname] + url.search, 301);

  /* Near-misses for the Listing Sheet. /listings resolves on its own (an
   * extensionless path tries listings/index.html), but the singular and the
   * .html form did not: a path containing a dot is looked up literally and
   * nothing else is tried, so /listings.html was a 404 on a page that
   * exists. These are the forms a person types or a link drops a character
   * from, and a directory nobody can reach by guessing is a directory
   * nobody reaches. 301, so a crawler learns the real address. */
  const sheet = url.pathname.match(
    /^\/(?:listing|listings\.html|listing\.html|listing\/(.*)|add-a-listing)$/);
  if (sheet) {
    const to = sheet[1] ? `/listings/${sheet[1]}` : "/listings/";
    return Response.redirect(url.origin + to + url.search, 301);
  }

  const range = request.headers.get("range");

  for (const key of candidates(url.pathname)) {
    /* Both conditionals and ranges are handed to R2 as the raw request
     * headers, so R2 does the parsing. This is not laziness — passing the
     * If-None-Match value straight into {etagDoesNotMatch} throws, because
     * that field wants a bare etag while the header always carries quotes
     * (and may carry W/ weak tags, a comma list, or *). Range has the same
     * shape of trap with suffix and open-ended forms. Letting R2 parse both
     * removes the whole class. */
    const opts = { onlyIf: ext(key) === "html" ? ntConditional(request.headers) : request.headers };
    if (range) opts.range = request.headers;

    const obj = await env.SITE.get(key, opts);
    if (obj === null) continue;

    /* A folder asked for without its slash: send the reader to the slash. Served
     * in place, the page's relative links (img/x.jpg, app.js, ../p/…) resolve one
     * folder too high and 404 — 43 pages broke that way, found 2026-10-04 after
     * /sites/best-krapow showed empty frames. Only the folder's index redirects;
     * /toilets still serves toilets.html straight. */
    if (key.endsWith("/index.html") &&
        key === decodeURIComponent(url.pathname).replace(/^\/+/, "") + "/index.html") {
      if (obj.body) obj.body.cancel();
      return Response.redirect(url.origin + url.pathname + "/" + url.search, 301);
    }

    /* No body means the conditional matched: unchanged since the copy the
     * reader already holds. R2 hands back a plain R2Object in that case. */
    if (obj.body == null) {
      return new Response(null, { status: 304, headers: headers(obj, key) });
    }

    const h = headers(obj, key);
    let status = 200;
    if (obj.range && range) {
      const { offset = 0, length = obj.size } = obj.range;
      const end = offset + length - 1;
      h.set("content-range", `bytes ${offset}-${end}/${obj.size}`);
      status = 206;
    }
    if (request.method === "HEAD") {
      h.set("content-length", String(obj.size));
      return new Response(null, { status, headers: h });
    }
    const res = new Response(obj.body, { status, headers: h });
    return ext(key) === "html" ? withWhere(res, request, obj.size) : res;
  }

  /* Miss. Serve the site's own 404 page when one has been deployed, so a
   * mistyped soi still lands somewhere with the search box on it. */
  const nf = await env.SITE.get("404.html");
  if (nf) {
    /* /this-page-does-not-exist-smoke-test is the smoke check's address
     * (publish/safety.py wants a 404 there). Something asked for it 79 times
     * the week to 2026-10-18, so it has a page to rest in now, still served
     * with status 404 and only when 404.html is deployed, so the check means
     * what it did. Nan, 2026-10-20. */
    const sala = url.pathname === "/this-page-does-not-exist-smoke-test"
      ? await env.SITE.get("voight-kampff/lost/index.html") : null;
    if (sala) nf.body.cancel();
    return new Response((sala || nf).body, {
      status: 404,
      headers: {
        "content-type": TYPES.html,
        "cache-control": "public, max-age=0, must-revalidate",
        ...CORS,
      },
    });
  }
  return new Response("Not found", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8", ...CORS },
  });
}

/* ------------------------------------------------- who asked for the page */

/* ---- WHERE READERS LOOK: THE MAPS (Nan, 2026-09-29, "everything") --------
 * Two sources, both in traffic_eye beside the arrival rows:
 *
 *   /api/v1/search rows gain blob9 "search", blob10 the cell at the middle of
 *   the bbox the map asked about, blob11 the words — kept only when nothing
 *   was found — and double4 the view's zoom, double5 the number found. The
 *   map asks this every time a reader with words in the box moves it; so do
 *   machines that call the API directly, and they land in their own column.
 *
 *   /api/map rows, one per event the maps send (mapsense_layer.py): blob9 the
 *   event, blob10 the cell, blob11 the place key or a short detail, blob12
 *   the page the map is on; double4 the zoom. double1 is 0 on these rows so
 *   every existing SUM(double1) — traffic.py, ticker, served, the dashboard —
 *   counts arrivals exactly as before; a map event counts in double5.
 *
 * A cell is latitude and longitude to two decimals, about 1.1 km. */
const MAP_EVENTS = new Set(["view", "open", "saved", "unsave", "pin", "share",
                            "code", "coord", "near"]);

/* The beacon itself. Anything malformed is dropped without a word: this
 * answers 204 whatever arrives, so there is nothing here to probe. */
async function mapSense(request, env) {
  const done = new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  if (request.method !== "POST" || !env.TRAFFIC) return done;
  let d;
  try {
    const text = await request.text();
    if (text.length > 8192) return done;
    d = JSON.parse(text);
  } catch { return done; }
  if (!d || !Array.isArray(d.ev)) return done;
  const url = new URL(request.url);
  const { category, agent } = classify(request.headers.get("user-agent") || "",
    { asn: request.cf?.asn, headers: request.headers });
  const pg = typeof d.pg === "string" && /^\/[\w\-\/.]{0,95}$/.test(d.pg) ? d.pg : "";
  try {
    for (const e of d.ev.slice(0, 40)) {
      if (!e || !MAP_EVENTS.has(e.e)) continue;
      const c = typeof e.c === "string" && /^-?\d{1,2}\.\d{2},-?\d{1,3}\.\d{2}$/.test(e.c) ? e.c : "";
      const k = typeof e.k === "string" && /^[a-z]{2}:[a-z0-9-]{1,90}$/.test(e.k) ? e.k
              : typeof e.d === "string" && /^[a-z0-9_-]{1,24}$/.test(e.d) ? e.d : "";
      const z = Number.isInteger(e.z) && e.z >= 0 && e.z <= 22 ? e.z : -1;
      env.TRAFFIC.writeDataPoint({
        blobs: [url.host, category, agent, "/api/map", request.cf?.country || "XX",
                "204", "(same site)", "EVENT", e.e, c, k, pg],
        doubles: [0, 204, 0, z, 1],
        indexes: [url.host],
      });
    }
  } catch { /* counting is never worth an error */ }
  return done;
}

export default {
  async fetch(request, env, ctx) {
    const started = Date.now();

    /* An API answer carries no script tags, so it does not wait on the list:
     * on a fresh isolate that read cost a search 1–2 s (2026-10-22). */
    if (new URL(request.url).pathname.startsWith("/api/")) ctx.waitUntil(assetVersions(env).catch(() => {}));
    else try { await assetVersions(env); } catch { /* pages go out unversioned */ }
    /* The one thing that matters. Nothing below this line can fail it. */
    const response = finish(toHttps(request) || sendToRules(request) || askCrawler(request, env) || await serve(request, env, ctx), request.url);
    /* A script or stylesheet asked for by its content hash is kept for good —
     * when the bytes served are the ones the hash names. The bucket's etag of
     * a small file is its md5, so a ?v= that arrives before its file (or for a
     * file a round kept at its live copy) is served with the ordinary rule. */
    try {
      const u = new URL(request.url);
      const v = u.searchParams.get("v") || "";
      const et = (response.headers.get("etag") || "").replace(/^W\//, "").replace(/"/g, "");
      if (response.status === 200 && v.length >= 8 && /\.(js|css)$/.test(u.pathname) && et.startsWith(v))
        response.headers.set("cache-control", "public, max-age=31536000, immutable");
    } catch { /* headers as they were */ }

    try {
      ctx.waitUntil(Promise.resolve(record(request, response, env, Date.now() - started)));
    } catch {
      /* Counting is never worth an error page. */
    }
    return response;
  },
};
