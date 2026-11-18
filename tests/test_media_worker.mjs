#!/usr/bin/env node
// worker-media: the four picture prefixes from the bucket, everything else to the site Worker.
//
//   node tests/test_media_worker.mjs
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.MD_ROOT ? resolve(process.env.MD_ROOT) : resolve(HERE, "..");
globalThis.HTMLRewriter ??= class { on() { return this; } onDocument() { return this; } transform(r) { return r; } };   // the site Worker's, not run here
const media = (await import(pathToFileURL(join(ROOT, "worker-media/src/index.js")).href));
const { serve, keyOf } = media;
const site = (await import(pathToFileURL(join(ROOT, "publish/worker.js")).href)).default;
const { armOf } = await import(pathToFileURL(join(ROOT, "publish/crawlpay.js")).href);

const BODY = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
function env(objects = { "photos/a.jpg": BODY, "streetphotos/cm-x.jpg": BODY, "og/c.png": BODY, "inat/1.jpg": BODY }) {
  const asked = [];
  return {
    asked,
    MEDIA: {
      async get(key, opts) {
        const o = objects[key];
        if (!o) return null;
        const inm = opts?.onlyIf?.get?.("if-none-match");
        const base = { size: o.length, httpEtag: '"abc"' };
        if (inm === '"abc"') return base;
        const r = opts?.range?.get?.("range");
        if (r) {
          const m = /bytes=(\d+)-(\d+)/.exec(r);
          const [a, b] = [Number(m[1]), Number(m[2])];
          return { ...base, body: new Blob([o.slice(a, b + 1)]).stream(), range: { offset: a, length: b - a + 1 } };
        }
        return { ...base, body: new Blob([o]).stream() };
      },
    },
    SITE_WORKER: { async fetch(req) { asked.push(req.url + " " + req.method); return new Response("site", { status: 200 }); } },
  };
}
const get = (e, path, init) => serve(new Request("https://motdang.net" + path, init), e);

let n = 0;
const ok = (name) => console.log("  ok   " + name) || n++;

{ const e = env(); const r = await get(e, "/photos/a.jpg");
  assert.equal(r.status, 200); assert.equal(r.headers.get("content-type"), "image/jpeg");
  assert.equal(r.headers.get("etag"), '"abc"'); assert.equal(r.headers.get("x-served-by"), "mot-dang-media");
  assert.match(r.headers.get("cache-control"), /max-age=2592000/);
  assert.equal(r.headers.get("access-control-allow-origin"), "*");
  assert.deepEqual(new Uint8Array(await r.arrayBuffer()), BODY); assert.equal(e.asked.length, 0);
  ok("a hit comes from the bucket with its type, etag and cache life"); }

{ const e = env();
  assert.match((await get(e, "/streetphotos/cm-x.jpg")).headers.get("cache-control"), /31536000, immutable/);
  assert.equal((await get(e, "/og/c.png")).headers.get("content-type"), "image/png");
  assert.match((await get(e, "/inat/1.jpg")).headers.get("cache-control"), /immutable/);
  ok("each prefix has its own life and type"); }

{ const e = env(); const r = await get(e, "/photos/missing.jpg");
  assert.equal(await r.text(), "site"); assert.equal(e.asked.length, 1);
  ok("a miss goes to the site Worker"); }

{ const e = env();
  for (const p of ["/", "/cm/p/x.html", "/photos/", "/photos/credits.json", "/listings/photos/p1/1.jpg", "/sites/x/og/c.png", "/photos"]) {
    const r = await get(e, p); assert.equal(await r.text(), "site", p);
  }
  assert.equal(e.asked.length, 7);
  ok("paths outside the four prefixes and the image types never reach the bucket"); }

{ const e = env(); const r = await get(e, "/photos/a.jpg", { method: "POST" });
  assert.equal(await r.text(), "site"); assert.equal(e.asked.length, 1);
  ok("methods other than GET and HEAD go to the site Worker"); }

{ const e = env(); const r = await get(e, "/photos/a.jpg", { headers: { "if-none-match": '"abc"' } });
  assert.equal(r.status, 304); assert.equal(r.headers.get("etag"), '"abc"');
  ok("a matching etag answers 304"); }

{ const e = env(); const r = await get(e, "/photos/a.jpg", { headers: { range: "bytes=2-4" } });
  assert.equal(r.status, 206); assert.equal(r.headers.get("content-range"), "bytes 2-4/10");
  assert.deepEqual(new Uint8Array(await r.arrayBuffer()), BODY.slice(2, 5));
  ok("a range answers 206 with its content-range"); }

{ const e = env(); const r = await get(e, "/photos/a.jpg", { method: "HEAD" });
  assert.equal(r.status, 200); assert.equal(r.headers.get("content-length"), "10"); assert.equal(await r.text(), "");
  ok("HEAD carries the length and no body"); }

{ const e = env(); const r = await get(e, "/media-check/photos/a.jpg");
  assert.equal(r.status, 200); assert.equal(r.headers.get("x-served-by"), "mot-dang-media");
  const m = await get(e, "/media-check/photos/none.jpg");
  assert.equal(await m.text(), "site"); assert.match(e.asked[0], /^https:\/\/motdang\.net\/photos\/none\.jpg GET$/);
  ok("the test route reads the same keys and hands a miss on without its prefix"); }

{ const e = env({ "streetphotos/cm-condoreg-กลอรี่.jpg": BODY });
  const r = await get(e, "/streetphotos/" + encodeURIComponent("cm-condoreg-กลอรี่.jpg"));
  assert.equal(r.status, 200);
  ok("a Thai key is found by its percent-encoded path"); }

{ assert.equal(keyOf("/photos/%E0%A4%A.jpg"), null); assert.equal(keyOf("/photos/../x.jpg"), null);
  ok("a bad escape or a .. is not a key"); }

{ const e = env(); e.MEDIA.get = async () => { throw new Error("r2 down"); };
  const r = await get(e, "/photos/a.jpg"); assert.equal(await r.text(), "site");
  ok("a bucket error goes to the site Worker"); }

/* ------------------------------------------------ the gate and the count */
// The request shapes tests/test_edge_count.mjs, test_crawlpay.mjs and test_classify.mjs use.
const CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const CLAUDEBOT = "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)";
const GPTBOT = "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)";
const CHROME_WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";
const REAL_CHROME = { "sec-fetch-mode": "navigate", "sec-fetch-site": "cross-site", "sec-fetch-dest": "document" };
const IMG = { "sec-fetch-mode": "no-cors", "sec-fetch-dest": "image", "sec-fetch-site": "same-origin" };   // what a browser sends for an <img>
const VARS = { CRAWLPAY_ASK: "on", CRAWLPAY_PRICE_LO: "USD 0.001", CRAWLPAY_PRICE_HI: "USD 0.05", CRAWLPAY_UNTIL: "2099-01-01T00:00:00Z" };

function counted(extra = {}, opts = {}) {
  const rows = [], waits = [];
  const e = env(opts.objects);
  Object.assign(e, VARS, extra);
  if (!opts.unbound) e.TRAFFIC = { writeDataPoint: (r) => { if (opts.throws) throw new Error("analytics down"); rows.push(r); } };
  const ctx = { waitUntil: (p) => waits.push(p) };
  const asn = (req, n) => { if (n) Object.defineProperty(req, "cf", { value: { asn: n, country: "TH" } }); return req; };
  return {
    rows, e,
    async hit(worker, path, init = {}, cfAsn, base = "https://motdang.net") {
      const r = await worker.fetch(asn(new Request(base + path, init), cfAsn), e, ctx);
      await Promise.all(waits.splice(0));
      return r;
    },
  };
}
const askPath = [...Array(500).keys()].map((i) => `/photos/p${i}.jpg`).find((p) => armOf(p) === "ask-hi");
const ctlPath = [...Array(500).keys()].map((i) => `/photos/p${i}.jpg`).find((p) => armOf(p) === "control");
const both = { "photos/a.jpg": BODY };
for (const k of [askPath, ctlPath]) both[k.slice(1)] = BODY;
const MEDIA = media.default;

{ const b = counted({}, { objects: both });
  const r = await b.hit(MEDIA, "/photos/a.jpg?secret=1", { headers: { ...IMG, "user-agent": CHROME, referer: "https://www.google.com/search?q=hidden+words" } });
  assert.equal(r.status, 200); assert.equal(b.rows.length, 1, "one row per request");
  const [row] = b.rows;
  assert.equal(row.blobs.length, 8); assert.equal(row.blobs[0], "motdang.net"); assert.equal(row.blobs[1], "human");
  assert.equal(row.blobs[2], "Chrome"); assert.equal(row.blobs[3], "/photos/a.jpg"); assert.equal(row.blobs[4], "XX");
  assert.equal(row.blobs[5], "200"); assert.equal(row.blobs[6], "www.google.com"); assert.equal(row.blobs[7], "GET");
  assert.equal(row.doubles[0], 1); assert.equal(row.doubles[1], 200); assert.deepEqual(row.indexes, ["motdang.net"]);
  assert.ok(!JSON.stringify(row).includes("secret") && !JSON.stringify(row).includes("hidden"));
  ok("an image answered here writes one row in traffic-eye's blob order, with no query string and the referrer cut to its host"); }

{ const b = counted({}, { objects: both });
  await b.hit(MEDIA, "/photos/a.jpg", { headers: { "user-agent": CLAUDEBOT } });
  assert.equal(b.rows[0].blobs[1], "ai"); assert.equal(b.rows[0].blobs[2], "ClaudeBot");
  await b.hit(MEDIA, "/photos/a.jpg", { headers: { ...IMG, "user-agent": CHROME, referer: "https://motdang.net/cm/" } });
  assert.equal(b.rows[1].blobs[6], "(same site)");
  ok("a crawler is named and a same-site referrer says so"); }

{ const b = counted({}, { objects: both });
  const r = await b.hit(MEDIA, "/photos/none.jpg", { headers: { ...IMG, "user-agent": CHROME } });
  assert.equal(await r.text(), "site"); assert.equal(b.rows.length, 0);
  ok("a miss is counted by the site Worker it goes to, not twice"); }

{ for (const [name, opts] of [["no binding", { unbound: true }], ["a binding that throws", { throws: true }]]) {
    const b = counted({}, { objects: both, ...opts });
    const r = await b.hit(MEDIA, "/photos/a.jpg", { headers: { ...IMG, "user-agent": CHROME } });
    assert.equal(r.status, 200, name);
  }
  ok("counting never breaks the picture"); }

{ const b = counted({}, { objects: both });
  const H = { headers: { "user-agent": CHROME_WIN, ...IMG } };
  for (const asn of [132203, 45102, 8075]) assert.equal((await b.hit(MEDIA, "/photos/a.jpg", H, asn)).status, 200, "a browser string on a hosting network is served (" + asn + ")");
  assert.equal((await b.hit(MEDIA, "/photos/a.jpg", { headers: { "user-agent": "Mozilla/5.0 (compatible; Embedly/0.2; +http://support.embed.ly/)" } }, 14061)).status, 200);
  ok("a browser string or card fetcher on a hosting network is served"); }

{ const b = counted({}, { objects: both });
  for (const path of ["/.env", "/wp-login.php", "/config.php", "/.git/config", "/xmlrpc.php", "/precepts", "/precepts.txt"]) {
    const r = await b.hit(MEDIA, path, { headers: { "user-agent": CHROME, ...REAL_CHROME } });
    assert.equal(r.status, 302, path); assert.equal(r.headers.get("location"), "https://wichaa.net/hotrai/t/patimokkha.txt", path);
    assert.equal(r.headers.get("cache-control"), "no-store");
  }
  assert.equal(b.rows.at(-1).blobs[5], "302");
  for (const path of ["/robots.txt", "/llms.txt", "/.well-known/security.txt", "/photos/a.jpg"]) assert.notEqual((await b.hit(MEDIA, path, { headers: { "user-agent": CHROME, ...REAL_CHROME } })).status, 302, path);
  ok("a secret-file scan and a request to /precepts are sent to the rules, and counted as a 302; robots.txt and .well-known are not"); }

{ const b = counted({}, { objects: both });
  b.e.SITE = { async get() { return null; }, async head() { return null; } };
  const hit = (i, ua, ip) => b.hit(site, "/cm/p/page-" + i + ".html", { headers: { "user-agent": ua, "cf-connecting-ip": ip, ...REAL_CHROME } });
  const seen = [];
  for (let i = 0; i < 25; i++) seen.push((await hit(i, CHROME_WIN, "203.0.113.9")).status);
  assert.deepEqual(seen.slice(0, 20), Array(20).fill(404), "twenty pages in a minute are served (404: the test bucket is empty)");
  assert.deepEqual(seen.slice(20), Array(5).fill(302), "the next ones are sent to the rules");
  assert.equal((await hit(1, CHROME_WIN, "203.0.113.10")).status, 404, "another address is served");
  for (let i = 0; i < 30; i++) assert.notEqual((await hit(i, CLAUDEBOT, "203.0.113.11")).status, 302, "a named crawler is not counted as hammering");
  for (let i = 0; i < 30; i++) assert.notEqual((await b.hit(site, "/assets/x" + i + ".js", { headers: { "user-agent": CHROME_WIN, "cf-connecting-ip": "203.0.113.12" } })).status, 302, "scripts and pictures are not pages");
  const bare = (ua, h = {}) => b.hit(site, "/suggest.html", { headers: { "user-agent": ua, "cf-connecting-ip": "203.0.113.20", ...h } });
  assert.equal((await bare(CHROME_WIN)).status, 302, "no Sec-Fetch-Mode and a page robots.txt disallows");
  assert.equal((await bare(CHROME_WIN, REAL_CHROME)).status, 404, "a browser sends Sec-Fetch-Mode and is served");
  assert.equal((await bare(CLAUDEBOT)).status, 404, "a named crawler is not sent");
  assert.equal((await b.hit(site, "/cm/", { headers: { "user-agent": CHROME_WIN, "cf-connecting-ip": "203.0.113.21" } })).status, 404, "a page robots.txt allows is served");
  ok("a client asking for more than 20 pages a minute is sent to the rules; one address, a named crawler and pictures are not; a client with no Sec-Fetch-Mode on a disallowed form page is"); }

{ const b = counted({}, { objects: both });
  const r = await b.hit(MEDIA, askPath, { headers: { "user-agent": GPTBOT } });
  assert.equal(r.status, 402); assert.equal(r.headers.get("crawler-price"), "USD 0.05"); assert.equal(r.headers.get("x-robots-tag"), "notranslate");
  assert.equal(b.rows[0].blobs[5], "402");
  const ctl = await b.hit(MEDIA, ctlPath, { headers: { "user-agent": GPTBOT } });
  assert.equal(ctl.status, 200);
  const person = await b.hit(MEDIA, askPath, { headers: { "user-agent": "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ChatGPT-User/1.0)" } });
  assert.equal(person.status, 200);
  const off = counted({ CRAWLPAY_ASK: "off" }, { objects: both });
  assert.equal((await off.hit(MEDIA, askPath, { headers: { "user-agent": GPTBOT } })).status, 200);
  ok("a training crawler on the asked slice gets a 402 with its price; the control slice, a person's fetcher and the off switch do not"); }

{ const b = counted({}, { objects: both });
  const withPrice = await b.hit(MEDIA, ctlPath, { headers: { "user-agent": GPTBOT, "crawler-max-price": "USD 0.005" } });
  assert.equal(withPrice.status, 200);
  assert.ok(b.rows.some((r) => r.blobs[8] === "crawlpay"), "a crawler that says it can pay gets its own row");
  ok("a crawler that can pay is listened to"); }

{ const b = counted({}, { objects: both });
  const r = await b.hit(MEDIA, "/photos/a.jpg?x=1", { headers: { ...IMG, "user-agent": CHROME } }, undefined, "http://motdang.net");
  assert.equal(r.status, 301); assert.equal(r.headers.get("location"), "https://motdang.net/photos/a.jpg?x=1");
  ok("http:// goes to https:// with its query"); }

{ // the same request, the site Worker and this one
  const cases = [
    ["a secret-file scan", "/.env", { headers: { "user-agent": CHROME_WIN, ...REAL_CHROME } }, 132203],
    ["a request for the precepts", "/precepts", { headers: { "user-agent": GPTBOT } }, undefined],
    ["a training crawler on the asked slice", askPath, { headers: { "user-agent": GPTBOT } }, undefined],
    ["http", "/photos/a.jpg?x=1", { headers: { ...IMG, "user-agent": CHROME } }, undefined, "http://motdang.net"],
  ];
  for (const [name, path, init, asn, base] of cases) {
    const m = counted({}, { objects: both }), w = counted({}, { objects: both });
    w.e.SITE = { async get() { return null; }, async head() { return null; } };
    const a = await m.hit(MEDIA, path, init, asn, base), c = await w.hit(site, path, init, asn, base);
    assert.equal(a.status, c.status, name);
    for (const h of ["location", "crawler-price", "cache-control", "x-robots-tag"]) assert.equal(a.headers.get(h), c.headers.get(h), name + " " + h);
    assert.equal(await a.text(), await c.text(), name);
    assert.deepEqual(m.rows.map((r) => [r.blobs, r.doubles.slice(0, 2), r.indexes]), w.rows.map((r) => [r.blobs, r.doubles.slice(0, 2), r.indexes]), name + " rows");
  }
  ok("the gate answers and the rows are those the site Worker gives the same request"); }

{ const src = readFileSync(join(ROOT, "publish/worker.js"), "utf8"), mine = readFileSync(join(ROOT, "worker-media/src/index.js"), "utf8");
  assert.match(src, /from "\.\/edge_gate\.js"/); assert.match(mine, /publish\/edge_gate\.js/);
  for (const fn of ["function sendToRules", "function askCrawler", "function record", "const RULES"]) assert.ok(!src.includes(fn) && !mine.includes(fn), fn + " is defined once, in edge_gate.js");
  ok("the classifier and the gate are one module that both Workers import"); }

{ const vars = (f) => Object.fromEntries([...readFileSync(join(ROOT, f), "utf8").matchAll(/^(CRAWLPAY_[A-Z_]+)\s*=\s*"([^"]*)"/gm)].map((m) => [m[1], m[2]]));
  assert.deepEqual(vars("worker-media/wrangler.toml"), vars("publish/wrangler.toml"));
  assert.equal(Object.keys(vars("worker-media/wrangler.toml")).length, 4);
  ok("the crawler-402 settings are the same in both wrangler.toml files"); }

console.log(`all ${n} checks passed`);
