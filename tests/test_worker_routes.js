#!/usr/bin/env node
// The site Worker's routing and headers, run against docs/ on disk.
//
//   node tests/test_worker_routes.js
//
// publish/worker.js is ordinary ES module code with one dependency it cannot
// supply itself: env.SITE, an R2 bucket. So this stubs R2 with the built docs/
// directory — get(key) reads a file, honours If-None-Match against a hash and
// Range against the bytes — and then makes real Requests against the real
// default export. Everything the deploy will do, minus Cloudflare.
//
// It exists mainly for the headers. A CORS header is invisible in every way
// that matters until the day someone's browser app fails on it, and "did we
// remember to put it on the 404 too" is exactly the kind of question nobody
// re-asks by hand. The licence says take it; this is what proves the door is
// actually open.
import { readFileSync, existsSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = process.env.MD_DOCS || join(ROOT, "docs");

if (!existsSync(join(DOCS, "api/v1/index.json"))) {
  console.log(`SKIPPED — no ${DOCS}/api/v1/index.json; build.py has not run`);
  process.exit(0);
}

const worker = (await import(join(ROOT, "publish/worker.js"))).default;

/* The smallest R2 that worker.js cannot tell from the real one: it only ever
 * uses get(key, {onlyIf, range}), .body, .text(), .httpEtag, .size and .range. */
const INDEX_GETS = { n: 0 };
const SITE = {
  async get(key, opts = {}) {
    if (key === "api/v1/index.json") INDEX_GETS.n++;
    const path = join(DOCS, normalize("/" + key));
    if (!path.startsWith(DOCS) || !existsSync(path) || !statSync(path).isFile()) return null;
    const buf = readFileSync(path);
    const httpEtag = '"' + createHash("md5").update(buf).digest("hex") + '"';
    const inm = opts.onlyIf?.get?.("if-none-match");
    if (inm && inm === httpEtag) return { httpEtag, size: buf.length, body: null };
    const rangeHdr = opts.range?.get?.("range");
    let out = buf, range;
    if (rangeHdr) {
      const m = rangeHdr.match(/bytes=(\d+)-(\d*)/);
      if (m) {
        const offset = +m[1];
        const end = m[2] ? +m[2] : buf.length - 1;
        out = buf.subarray(offset, end + 1);
        range = { offset, length: out.length };
      }
    }
    return { httpEtag, size: buf.length, range, body: out,
             async text() { return buf.toString("utf8"); } };
  },
  /* Metadata only, no body — what revalidateIndex() uses to notice that a
   * content deploy has replaced the API index under a running isolate.
   * ETAG_OVERRIDE lets a test pretend the bucket changed without writing to
   * docs/, which the rest of this file reads. */
  async head(key) {
    if (ETAG_OVERRIDE.has(key)) return { httpEtag: ETAG_OVERRIDE.get(key) };
    const path = join(DOCS, normalize("/" + key));
    if (!path.startsWith(DOCS) || !existsSync(path) || !statSync(path).isFile()) return null;
    const buf = readFileSync(path);
    return { httpEtag: '"' + createHash("md5").update(buf).digest("hex") + '"' };
  },
};
const ETAG_OVERRIDE = new Map();

const get = (path, init) =>
  worker.fetch(new Request("https://motdang.net" + path, init), { SITE },
               { waitUntil() {}, passThroughOnException() {} });

let failures = 0;
async function t(name, fn) {
  try { await fn(); console.log("  ok   " + name); }
  catch (e) { failures++; console.log("  FAIL " + name + "\n       " + e.message); }
}
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m || ""} ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };
const ok = (c, m) => { if (!c) throw new Error(m || "expected true"); };

console.log(`worker over ${DOCS}`);

/* ------------------------------------------------------------------ CORS */

await t("every kind of response is open to every origin", async () => {
  for (const p of ["/index.html", "/data/places.json", "/llms.txt", "/terms.html",
                   "/api/", "/api/v1/", "/api/v1/places?limit=1",
                   "/api/v1/openapi.json", "/no/such/path"]) {
    const r = await get(p);
    eq(r.headers.get("access-control-allow-origin"), "*", `${p} (${r.status})`);
  }
});

await t("the etag is readable cross-origin, so a caller can revalidate", async () => {
  const r = await get("/data/places.json");
  ok(r.headers.get("etag"), "no etag at all");
  ok(r.headers.get("access-control-expose-headers").includes("etag"),
     "etag is set but hidden from a browser, which makes it useless");
});

await t("a conditional request still short-circuits, with CORS on the 304", async () => {
  const first = await get("/llms.txt");
  const again = await get("/llms.txt", { headers: { "if-none-match": first.headers.get("etag") } });
  eq(again.status, 304);
  eq(again.headers.get("access-control-allow-origin"), "*");
});

await t("a preflight is answered anywhere, not just under /api/", async () => {
  for (const p of ["/api/v1/places", "/data/places.json"]) {
    const r = await get(p, { method: "OPTIONS" });
    eq(r.status, 204, p);
    ok(r.headers.get("access-control-allow-methods").includes("GET"), p);
  }
});

await t("a write is still refused — open to read is not open to write", async () => {
  const r = await get("/api/v1/places", { method: "POST" });
  eq(r.status, 405);
  eq(r.headers.get("access-control-allow-origin"), "*", "even the refusal explains itself");
});

/* -------------------------------------------------------------- the API */

await t("the descriptor lists every endpoint and carries no bulk rows", async () => {
  const r = await get("/api/v1/");
  eq(r.status, 200);
  const j = await r.json();
  ok(!("places" in j), "the descriptor shipped 13,000 rows to answer 'what is this'");
  ok(!("schedules" in j));
  for (const k of ["places", "place", "categories", "tags", "health", "openapi", "schema", "bulk"])
    ok(j.endpoints[k], `descriptor omits ${k}`);
  ok(j.terms.endsWith("/terms.html"), "the descriptor never names the terms");
});

await t("a query answers, and says what it understood", async () => {
  const r = await get("/api/v1/places?cat=wat&limit=3");
  eq(r.status, 200);
  const j = await r.json();
  eq(j.count, 3);
  eq(j.query.cat, "wat");
  ok(j.total > 3);
  ok(j.attribution.includes("motdang.net"), "a result set with no attribution in it");
});

await t("one place resolves by id and by the slug in its own URL", async () => {
  const first = (await (await get("/api/v1/places?limit=1")).json()).results[0];
  const byId = await get("/api/v1/places/" + encodeURIComponent(first.id));
  eq(byId.status, 200);
  const rec = await byId.json();
  eq(rec.id, first.id);
  ok(rec.sources, "the full record dropped its provenance");
  ok(rec.license, "the full record dropped its licence line");
  const slug = first.url.split("/p/")[1].replace(".html", "");
  eq((await get("/api/v1/places/" + encodeURIComponent(slug))).status, 200, "slug lookup");
});

await t("a miss is a JSON 404 that says where the answer is", async () => {
  const r = await get("/api/v1/places/definitely-not-a-place");
  eq(r.status, 404);
  const j = await r.json();
  ok(j.error && j.hint && j.docs, "an error with nothing actionable in it");
  eq(r.headers.get("content-type").split(";")[0], "application/json");
});

await t("an unknown endpoint under v1 does not fall through to the site 404", async () => {
  const r = await get("/api/v1/nonsense");
  eq(r.status, 404);
  eq(r.headers.get("content-type").split(";")[0], "application/json",
     "a machine asking a machine got an HTML page back");
});

await t("the spec and the schema serve as JSON", async () => {
  for (const p of ["/api/v1/openapi.json", "/api/v1/schema.json"]) {
    const j = await (await get(p)).json();
    ok(j, p);
  }
  eq((await (await get("/api/v1/openapi.json")).json()).openapi, "3.1.0");
});

await t("discovery links point at the documentation and the spec", async () => {
  const link = (await get("/api/v1/places?limit=1")).headers.get("link");
  for (const rel of ["service-doc", "service-desc", "describedby", "license"])
    ok(link.includes(`rel="${rel}"`), `no ${rel} link header`);
});

await t("health reports the build it is answering from", async () => {
  const j = await (await get("/api/v1/health")).json();
  eq(j.ok, true);
  ok(/^\d{4}-\d{2}-\d{2}$/.test(j.generated), j.generated);
  ok(j.minuteOfWeekBangkok >= 0 && j.minuteOfWeekBangkok < 10080);
});

/* ---------------------------------------------------------- the pages */

await t("/api and /api/ land on the documentation with no redirect", async () => {
  for (const p of ["/api", "/api/"]) {
    const r = await get(p);
    eq(r.status, 200, p);
    ok((await r.text()).includes("api/v1"), `${p} is not the API page`);
  }
});

await t("the terms page is reachable and says take it", async () => {
  const html = await (await get("/terms.html")).text();
  for (const s of ["CC BY 4.0", "ODbL", "motdang.net"]) ok(html.includes(s), s);
});

await t("nothing else about the site moved", async () => {
  eq((await get("/index.html")).status, 200);
  eq((await get("/cm/wat/")).status, 200, "a shelf page");
  const renamed = await get("/cm/learn/");
  eq(renamed.status, 301, "the learn→sport rename stopped working");
});

/* /why stopped being built on 2026-09-04 and was still one of the handful of
 * motdang.net URLs Google held on 2026-09-20 — a 404 on the only address an
 * index knows teaches that index the site is gone. */
await t("the retired /why lands on the page that answers it", async () => {
  for (const u of ["/why", "/why.html"]) {
    const r = await get(u);
    eq(r.status, 301, `${u} should be a permanent redirect`);
    eq(r.headers.get("location"), "https://motdang.net/what.html",
       `${u} should land on what.html`);
  }
});

/* 2026-11-02: Search Console held 2,593 id-form place addresses
 * (/cm/p/cm-osm-node-….html) as 404s. The id forwards to the place's page. */
await t("a place page asked for by its record id forwards to its page", async () => {
  const body = await (await get("/api/v1/places?limit=1")).json();
  const p = (body.results || body.places || [])[0];
  ok(p && p.id && p.url, "the API gave no place to try");
  const r = await get(`/${p.province}/p/${p.id}.html`);
  eq(r.status, 301, `/${p.province}/p/${p.id}.html`);
  eq(r.headers.get("location"), p.url, "should land on the place's own page");
});

/* ------------------------------------------- the index revalidation clock */

/* 2026-09-07: a content deploy replaced api/v1/index.json in the bucket and the
 * API kept answering from the copy a running isolate had parsed days earlier —
 * generated 09-05 against a bucket holding 09-07. README.md promises a content
 * deploy is enough; this is the test that makes that true. */

await t("the parsed index is NOT re-read on every request", async () => {
  await get("/api/v1/places?limit=1");
  const before = INDEX_GETS.n;
  await get("/api/v1/places?limit=1");
  await get("/api/v1/places?limit=1");
  eq(INDEX_GETS.n, before, "the index was re-read while nothing had changed");
});

await t("a content deploy under a running isolate IS picked up", async () => {
  await get("/api/v1/places?limit=1");
  const before = INDEX_GETS.n;

  // the bucket now holds a different object under the same key
  ETAG_OVERRIDE.set("api/v1/index.json", '"deadbeefdeadbeefdeadbeefdeadbeef"');

  // ...and a minute of wall clock passes, so the revalidation window opens
  const realNow = Date.now;
  Date.now = () => realNow() + 61_000;
  try {
    await get("/api/v1/places?limit=1");
  } finally {
    Date.now = realNow;
    ETAG_OVERRIDE.delete("api/v1/index.json");
  }

  ok(INDEX_GETS.n > before,
     "the bucket changed and the isolate went on serving its stale parse");
});

await t("a HEAD that throws does not take the API down", async () => {
  await get("/api/v1/places?limit=1");
  const broken = SITE.head;
  SITE.head = async () => { throw new Error("R2 blipped"); };
  const realNow = Date.now;
  Date.now = () => realNow() + 61_000;
  try {
    const r = await get("/api/v1/places?limit=1");
    eq(r.status, 200, "a failed metadata call became a failed request");
  } finally {
    Date.now = realNow;
    SITE.head = broken;
  }
});

/* 🎲 The door that used to be baked into 91,000 pages. What matters here is
 * that it ALWAYS opens on somewhere real — a dead die is worse than a dull
 * one — and that nothing caches the answer, because a cached 302 is a die
 * that stopped rolling. */
await t("the dice door opens on a real page, and is never cached", async () => {
  const r = await get("/random");
  eq(r.status, 302, "the dice door did not redirect");
  const to = r.headers.get("location");
  ok(to && to.startsWith("/"), `the die landed off the site: ${to}`);
  ok(to.endsWith(".html"), `the die landed on something that is not a page: ${to}`);
  eq(r.headers.get("cache-control"), "no-store", "a cached die stops rolling");
  eq(r.headers.get("x-robots-tag"), "noindex", "a door got indexed as a page");
});

await t("the dice door still opens when the dice file is missing", async () => {
  const real = SITE.get;
  SITE.get = async (k, o) => (k === "data/dice.json" ? null : real.call(SITE, k, o));
  try {
    const r = await get("/random");
    eq(r.status, 302, "no dice file took the door down");
    eq(r.headers.get("location"), "/cm/index.html", "the fallback is not a shelf");
  } finally {
    SITE.get = real;
  }
});

console.log(failures ? `\n${failures} FAILED` : "\nall green");
process.exit(failures ? 1 : 0);
