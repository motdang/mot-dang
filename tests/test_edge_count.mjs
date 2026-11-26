#!/usr/bin/env node
// The edge count — what one row holds, and what it must never hold.
//
//   node tests/test_edge_count.mjs
//
// Nan's decision, 2026-09-05 (notes/arrivals-2026-09-05.txt, A1): count
// arrivals first-party, referrer host and landing path, no cookie, no third
// party, aggregated. This is the test that keeps the second half of that
// sentence true. Everything here runs against the real default export in
// publish/worker.js with a stubbed R2 and a stubbed Analytics Engine binding,
// so what it asserts is what the deploy will write.
//
// The failure this guards against is not a crash. A counter that quietly
// starts keeping the query string, or the full referrer, or a header that
// identifies somebody, works perfectly and is wrong — and nobody looks at a
// working counter. So the assertions are mostly about absence.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const worker = (await import(join(ROOT, "publish/worker.js"))).default;

/* R2 with exactly one object in it. The count does not care what was served,
 * only that something was, so there is no reason to need docs/ built. */
const SITE = {
  async get(key) {
    if (key !== "index.html" && key !== "404.html") return null;
    const buf = Buffer.from("<!doctype html><title>x</title>");
    return { httpEtag: '"x"', size: buf.length, body: buf,
             async text() { return buf.toString("utf8"); } };
  },
  async head() { return null; },
};

/* Analytics Engine, remembered rather than sent. */
function bench(opts = {}) {
  const rows = [];
  const TRAFFIC = {
    writeDataPoint(row) {
      if (opts.throws) throw new Error("analytics engine is having a day");
      rows.push(row);
    },
  };
  const waits = [];
  const ctx = { waitUntil: (p) => waits.push(p) };
  const env = opts.unbound ? { SITE } : { SITE, TRAFFIC };
  return {
    rows,
    async hit(path, init) {
      const r = await worker.fetch(new Request("https://motdang.net" + path, init), env, ctx);
      await Promise.all(waits.splice(0));
      return r;
    },
  };
}

let failures = 0;
async function t(name, fn) {
  try { await fn(); console.log("  ok   " + name); }
  catch (e) { failures++; console.log("  FAIL " + name + "\n       " + e.message); }
}
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m || ""} ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };
const ok = (c, m) => { if (!c) throw new Error(m || "expected true"); };

const CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const CLAUDEBOT = "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)";

console.log("edge count");

/* -------------------------------------------------------------- the row */

await t("a request writes exactly one row, in traffic-eye's blob order", async () => {
  const b = bench();
  await b.hit("/index.html", { headers: { "user-agent": CHROME } });
  eq(b.rows.length, 1, "rows written:");
  const [row] = b.rows;
  eq(row.blobs.length, 20, "blob count:");
  eq(row.blobs[0], "motdang.net", "blob1 site:");
  eq(row.blobs[1], "human", "blob2 category:");
  eq(row.blobs[2], "Chrome", "blob3 agent:");
  eq(row.blobs[3], "/index.html", "blob4 path:");
  eq(row.blobs[5], "200", "blob6 status:");
  eq(row.blobs[7], "GET", "blob8 method:");
  eq(row.indexes[0], "motdang.net", "sampling key:");
});

await t("double1 is a literal 1, so SUM survives sampling", async () => {
  const b = bench();
  await b.hit("/index.html", { headers: { "user-agent": CHROME } });
  eq(b.rows[0].doubles[0], 1);
  eq(b.rows[0].doubles[1], 200, "double2 status:");
  ok(typeof b.rows[0].doubles[2] === "number", "double3 should be milliseconds");
});

await t("a crawler is named, not lumped into one bot bucket", async () => {
  const b = bench();
  await b.hit("/cm/index.html", { headers: { "user-agent": CLAUDEBOT } });
  eq(b.rows[0].blobs[1], "ai");
  eq(b.rows[0].blobs[2], "ClaudeBot");
});

await t("a miss is counted too — a 404 is an arrival that failed", async () => {
  const b = bench();
  const r = await b.hit("/no/such/soi", { headers: { "user-agent": CHROME } });
  eq(r.status, 404);
  eq(b.rows.length, 1);
  eq(b.rows[0].blobs[5], "404");
});

/* ------------------------------------------------------------- the absences */

await t("the query string is never recorded", async () => {
  const b = bench();
  await b.hit("/search.html?q=%E0%B8%A3%E0%B9%89%E0%B8%B2%E0%B8%99%E0%B8%99%E0%B8%A7%E0%B8%94",
              { headers: { "user-agent": CHROME } });
  eq(b.rows[0].blobs[3], "/search.html");
  ok(!JSON.stringify(b.rows[0]).includes("q="), "a query string reached the row");
});

await t("the referrer is cut to its host — the words somebody typed stay theirs", async () => {
  const b = bench();
  await b.hit("/cm/index.html", {
    headers: { "user-agent": CHROME, referer: "https://www.google.com/search?q=nuat+chiang+mai" },
  });
  eq(b.rows[0].blobs[6], "www.google.com");
  ok(!JSON.stringify(b.rows[0]).includes("nuat"), "the search terms reached the row");
});

await t("a referrer from this site says so, rather than naming a page", async () => {
  const b = bench();
  await b.hit("/cm/index.html", {
    headers: { "user-agent": CHROME, referer: "https://motdang.net/cm/p/some-place.html" },
  });
  eq(b.rows[0].blobs[6], "(same site)");
});

await t("no referrer records nothing, and a broken one does not throw", async () => {
  const b = bench();
  await b.hit("/index.html", { headers: { "user-agent": CHROME } });
  eq(b.rows[0].blobs[6], "");
  const c = bench();
  await c.hit("/index.html", { headers: { "user-agent": CHROME, referer: "not a url" } });
  eq(c.rows[0].blobs[6], "(unparseable)");
});

await t("nothing that identifies a person survives into the row", async () => {
  const b = bench();
  await b.hit("/index.html", {
    headers: {
      "user-agent": CHROME,
      cookie: "sessionid=abc123; who=nan",
      "cf-connecting-ip": "203.0.113.44",
      "x-forwarded-for": "203.0.113.44",
      authorization: "Bearer sekrit",
      "accept-language": "th-TH",
    },
  });
  const s = JSON.stringify(b.rows[0]);
  for (const leak of ["203.0.113.44", "sessionid", "abc123", "sekrit", "Bearer"]) {
    ok(!s.includes(leak), `${leak} reached the row`);
  }
});

await t("two requests from one reader cannot be joined to each other", async () => {
  const b = bench();
  const h = { "user-agent": CHROME, cookie: "sessionid=abc123" };
  await b.hit("/index.html", { headers: h });
  await b.hit("/404.html", { headers: h });
  const [a, c] = b.rows;
  const idish = (row) => row.blobs.filter((_, i) => i !== 3);   // path differs by design
  eq(JSON.stringify(idish(a)), JSON.stringify(idish(c)),
     "if these differ, something in the row is per-reader");
});

await t("an absurd path is trimmed rather than written whole", async () => {
  const b = bench();
  await b.hit("/" + "x".repeat(300), { headers: { "user-agent": CHROME } });
  ok(b.rows[0].blobs[3].length <= 97, "path length " + b.rows[0].blobs[3].length);
  ok(b.rows[0].blobs[3].endsWith("…"), "a trimmed path should say it was trimmed");
});

/* ------------------------------------------------- it cannot break the site */

await t("with no binding at all the site still serves", async () => {
  const b = bench({ unbound: true });
  const r = await b.hit("/index.html", { headers: { "user-agent": CHROME } });
  eq(r.status, 200);
  eq(await r.text(), "<!doctype html><title>x</title>");
});

await t("a broken Analytics Engine is not an error page", async () => {
  const b = bench({ throws: true });
  const r = await b.hit("/index.html", { headers: { "user-agent": CHROME } });
  eq(r.status, 200);
  eq(b.rows.length, 0);
});

await t("no ctx (a caller that predates the count) still serves", async () => {
  const r = await worker.fetch(new Request("https://motdang.net/index.html"), { SITE });
  eq(r.status, 200);
});

await t("the response body is untouched — no buffering, no rewriting", async () => {
  const b = bench();
  const r = await b.hit("/index.html", { headers: { "user-agent": CHROME } });
  eq(r.headers.get("access-control-allow-origin"), "*");
  eq(r.headers.get("accept-ranges"), "bytes");
  eq(await r.text(), "<!doctype html><title>x</title>");
});

/* ---------------------------------------------------------------- drift */

await t("the blob order still matches traffic-eye, which shares the dataset", async () => {
  const sibling = join(ROOT, "..", "traffic-eye", "src", "collector.js");
  if (!existsSync(sibling)) {
    console.log("       (traffic-eye not beside this repo — order unchecked)");
    return;
  }
  const order = (src) =>
    [...src.matchAll(/\/\/ ([1-8]) (\w+)/g)].map((m) => m[1] + " " + m[2]).join(", ");
  const theirs = order(readFileSync(sibling, "utf8"));
  const ours = order(readFileSync(join(ROOT, "publish/worker.js"), "utf8"));
  ok(theirs.length > 0, "could not read traffic-eye's blob order");
  eq(ours, theirs, "one dataset, two writers, different order — the numbers would be nonsense:");
});

console.log(failures ? `\n${failures} failed` : "\nall green");
process.exit(failures ? 1 : 0);
