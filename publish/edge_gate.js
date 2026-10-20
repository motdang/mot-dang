/* The gate and the count every request to motdang.net passes through: the https
 * redirect, the courtesy 302 for browser strings from data centres, the crawler
 * 402, and the row in traffic_eye. publish/worker.js (the site) and
 * worker-media/ (the four picture folders) both import this file, so a picture
 * is classified, redirected, asked for payment and counted exactly as a page is.
 * Moved here from worker.js on 2026-10-13 with no change to what it does. */
import { classify } from "./classify.js";
import { shareLand } from "./sharesense.js";
import { crawlAsk, crawlListen } from "./crawlpay.js";

/* THE COUNT AT THE EDGE
 * --------------------
 * Nan's decision, 2026-09-05 (notes/arrivals-2026-09-05.txt, A1): count
 * arrivals first-party — referrer host and landing path, no cookie, no third
 * party, aggregated. Until this the site had 626,640 requests in 28 days and
 * no way to say how many were people, because Worker analytics carries no
 * User-Agent and zone analytics is a permission this account's token does not
 * hold.
 *
 * WHAT IT WRITES, AND WHAT IT DELIBERATELY DOES NOT
 * ------------------------------------------------
 * One row per request into Analytics Engine: host, category, agent name,
 * path, country, status, referrer HOST, method. No IP address. No cookie. No
 * identifier of any kind, so two requests by the same person are two rows
 * that cannot be joined — this counts arrivals, it cannot follow anybody.
 *
 * The referring URL is cut down to its host on purpose: a full referrer from
 * a search engine carries the words somebody typed, which are their business
 * and not ours. Query strings are dropped from the path for the same reason.
 *
 * IT MUST NOT BE ABLE TO BREAK THE SITE
 * -------------------------------------
 * serve() runs first and its result is returned no matter what happens next.
 * The write is handed to waitUntil inside a try/catch whose failure path is to
 * do nothing at all — a missing binding, an Analytics Engine outage, or a
 * User-Agent the classifier has never seen still ends with the reader getting
 * their page. The response body is never touched, so caching, ranges and
 * streaming behave exactly as they did before.
 *
 * ONE DATASET, NOT TWO. The rows go to `traffic_eye`, the fleet dataset
 * traffic-eye already writes and its dashboard already reads, in that Worker's
 * blob order. Keep the order below in step with traffic-eye/src/collector.js:
 * position IS the schema, and a row written out of order is a silently wrong
 * number rather than an error.
 */
export function record(request, response, env, ms) {
  if (!env.TRAFFIC) return; // not bound — nothing to do, and nothing to say

  const url = new URL(request.url);
  /* A map beacon is not an arrival: mapSense writes its own rows. Nor is a
   * live share's position, sent every few seconds for an hour. */
  if (url.pathname === "/api/map" || url.pathname === "/api/share" || url.pathname.startsWith("/api/find") || url.pathname.startsWith("/api/live")) return;
  const { category, agent } = classify(request.headers.get("user-agent") || "",
    { asn: request.cf?.asn, headers: request.headers });

  let refHost = "";
  const ref = request.headers.get("referer");
  if (ref) {
    try {
      const r = new URL(ref);
      refHost = r.host === url.host ? "(same site)" : r.host;
    } catch {
      refHost = "(unparseable)";
    }
  }

  env.TRAFFIC.writeDataPoint({
    blobs: [
      url.host,                       // 1 site
      category,                       // 2 human|ai|search|social|seo|monitor|tool|other|none
      agent,                          // 3 ClaudeBot, Chrome, …
      trimPath(url.pathname),         // 4 path, no query string
      request.cf?.country || "XX",    // 5 country
      String(response.status),        // 6 status
      refHost,                        // 7 referrer host only
      request.method,                 // 8 method
      ...searchSense(url, response),  // 9–11 search: the view, and words that found nothing
    ],
    /* double1 is a literal 1 so SUM(double1) survives sampling; COUNT(*) would
     * quietly under-report if this site ever gets busy enough to be sampled. */
    doubles: [1, response.status, ms, ...searchCount(url, response)],
    indexes: [url.host],              // sampling key, per-site
  });
  /* opened from a shared link (?s=<code>.<channel>): one more row, sharesense.js */
  shareLand(env, url, request, response, category, agent, refHost);
  /* a crawler that says it can pay, or signs itself: one more row, crawlpay.js */
  crawlListen(request, response, env, category, agent, ms);
}

const CELL = (lat, lng) => `${(+lat).toFixed(2)},${(+lng).toFixed(2)}`;

function bboxOf(url) {
  const b = (url.searchParams.get("bbox") || "").split(",").map(Number);
  return b.length === 4 && b.every(Number.isFinite) ? b : null;
}

function searchSense(url, response) {
  if (url.pathname !== "/api/v1/search") return [];
  const b = bboxOf(url);
  const h = response.headers.get("x-md-n");
  const n = h === null ? -1 : Number(h);
  const q = (url.searchParams.get("q") || "").trim().replace(/\s+/g, " ");
  return ["search", b ? CELL((b[1] + b[3]) / 2, (b[0] + b[2]) / 2) : "",
          n === 0 ? q.slice(0, 48) : ""];
}

function searchCount(url, response) {
  if (url.pathname !== "/api/v1/search") return [];
  const b = bboxOf(url);
  const w = b ? Math.abs(b[2] - b[0]) : 0;
  const h = response.headers.get("x-md-n");
  return [w > 0 ? Math.round(Math.log2(360 / w)) : -1, h === null ? -1 : Number(h)];
}

/* Paths here are high-cardinality by design — 93,577 of them — which Analytics
 * Engine handles. The cap is only so an absurd URL cannot write an unbounded
 * string. */
function trimPath(pathname) {
  return pathname.length > 96 ? pathname.slice(0, 96) + "…" : pathname;
}

/* GO READ THE RULES (Nan, 2026-09-29; narrowed 2026-10-13, C188) — a courtesy, not a block.
 * A 302 to the precepts at the ho trai instead of the page, for two kinds of
 * asker and no other:
 *   1. a bot that misbehaves: a secret-file scanner (a path like /.env,
 *      /wp-login.php, /config.php); a client that asks for pages faster than
 *      a reader does (HAMMER_MAX page requests in HAMMER_MS from one address
 *      and one User-Agent); or one that sends no Sec-Fetch-Mode header, as a
 *      browser does, and asks for a page robots.txt disallows (the form pages,
 *      2,846 of the 2,999 Alibaba requests sent on 12 Oct);
 *   2. a bot that asks: a request to /precepts, which robots.txt names.
 * Until 2026-10-13 every browser string from a hosting network was sent, which
 * also sent people on a VPN and card services (24,833 on 5–12 Oct; 96.5% of
 * them one scraper). A named crawler (AI, search, social, SEO, monitor) is
 * never counted as hammering: its rules are in robots.txt. robots.txt and
 * llms.txt always answer.
 *
 * The hammer count lives in the isolate's memory, so it counts what one
 * isolate sees; a client spread across many isolates or addresses stays under
 * it. The counter still writes the row, with status 302. */
const RULES = "https://wichaa.net/hotrai/t/sin-yon.txt";
const RULES_OPEN = new Set(["/robots.txt", "/llms.txt"]);
const RULES_ASK = new Set(["/precepts", "/precepts.txt"]);
const HAMMER_MAX = 20, HAMMER_MS = 60_000, HAMMER_KEYS = 5000;
const HAMMER_SPARED = new Set(["ai", "search", "social", "seo", "monitor"]);
const PROBE = /(^|\/)\.(env|git|svn|hg|aws|ssh|htaccess|htpasswd|ds_store)(\b|$)|\.(php\d?|aspx?|jsp|cgi)$|^\/(wp-(admin|login|content|includes|json)|xmlrpc|phpmyadmin|pma|cgi-bin|vendor\/phpunit|actuator|server-status|boaform)(\/|$|\.)/i;
/* The Disallow lines of robots.txt (build.py FORMS); keep the two in step. */
const DISALLOWED = new Set(["/suggest.html", "/add.html", "/search.html"]);
const hammered = new Map();

/* A page, not a picture, script or data file. */
function isPage(url) {
  const last = url.pathname.split("/").pop();
  return !last.includes(".") || /\.html?$/i.test(last);
}

function isHammering(request, url, category) {
  if (HAMMER_SPARED.has(category) || request.method !== "GET") return false;
  if (DISALLOWED.has(url.pathname) && !request.headers.has("sec-fetch-mode")) return true;
  if (!isPage(url)) return false;
  const key = (request.headers.get("cf-connecting-ip") || "") + "|" + (request.headers.get("user-agent") || "");
  const now = Date.now();
  if (hammered.size > HAMMER_KEYS) {
    for (const [k, v] of hammered) if (now - v.t > HAMMER_MS) hammered.delete(k);
    if (hammered.size > HAMMER_KEYS) hammered.clear();
  }
  let w = hammered.get(key);
  if (!w || now - w.t > HAMMER_MS) { w = { t: now, n: 0 }; hammered.set(key, w); }
  return ++w.n > HAMMER_MAX;
}

export function sendToRules(request) {
  const url = new URL(request.url);
  if (RULES_OPEN.has(url.pathname)) return null;
  let send = RULES_ASK.has(url.pathname) || PROBE.test(url.pathname);
  if (!send) {
    const { category } = classify(request.headers.get("user-agent") || "",
      { asn: request.cf?.asn, headers: request.headers });
    send = isHammering(request, url, category);
  }
  if (!send) return null;
  return new Response(`Go read the rules: ${RULES}\n`, {
    status: 302,
    headers: {
      location: RULES,
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

/* WHICH ROBOTS PAY (Nan, 2026-10-04) — crawlpay.js. Off unless CRAWLPAY_ASK
 * is "on"; even then only training crawlers on one page in ten get a 402. */
export function askCrawler(request, env) {
  if (env.CRAWLPAY_ASK !== "on") return null;
  if (env.CRAWLPAY_UNTIL && Date.now() > Date.parse(env.CRAWLPAY_UNTIL)) return null;
  const { category, agent } = classify(request.headers.get("user-agent") || "",
    { asn: request.cf?.asn, headers: request.headers });
  return crawlAsk(request, env, category, agent);
}

/* Plain http:// answers with a 301 to the same path and query on https://.
 * A local wrangler dev on http://localhost is left alone. */
export function toHttps(request) {
  const u = new URL(request.url);
  if (u.protocol !== "http:") return null;
  if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname) || u.hostname.endsWith(".localhost")) return null;
  u.protocol = "https:";
  return new Response(null, { status: 301, headers: { location: u.toString(), "cache-control": "public, max-age=86400" } });
}

