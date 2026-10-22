/* /api/v1/search and /api/v1/places, driven under node with a bucket made of files.
 *     MD_DOCS=<docs with api/v1/edge and api/v1/index.json> node tests/test_edge_route.js
 * The first block needs no docs: the Worker's own fetch() over a bucket
 * holding one tiny index, with a fresh module instance per case so the
 * isolate-level caches (INDEX_P, EDGE_P, CORE_P) of one case cannot leak into
 * the next. The docs-backed block skips with the reason when a file is missing. */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { searchHandler } from "../publish/worker.js";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = process.env.MD_DOCS || join(ROOT, "docs");
const IDX = process.env.MD_API_INDEX || join(DOCS, "api/v1/index.json");
let failures = 0;
const t = async (name, fn) => { try { await fn(); console.log("  ok  ", name); } catch (e) { failures++; console.log("  FAIL", name, "—", e.message); } };
const ok = (c, m) => { if (!c) throw new Error(m || "assertion"); };

/* ---- the Worker itself, no docs needed (2026-09-10) ------------------------- */
const TINY = JSON.stringify({ schemaVersion: 1, generated: "2026-09-10", base: "https://motdang.net/",
  terms: "https://motdang.net/terms.html", attribution: "a", licence: {}, count: 1, schedules: [],
  places: [{ id: "cm-x", slug: "x", province: "cm", name: "X", q: "x เชียงใหม่ chiang mai", antRank: 1,
             cat: [], geoPrecision: "needs-pin", confidence: 1 }] });
// The two vocabulary files come from docs/ when it holds them, so the engine is built as it is live.
const vocab = (k) => { const p = join(DOCS, k); return existsSync(p) ? readFileSync(p, "utf8") : null; };
const bucket = (objects, boom) => {
  const gets = [];
  const SITE = {
    get: async (key) => {
      gets.push(key);
      if (boom && boom(key)) throw new TypeError("R2 fell over on " + key);
      const v = key in objects ? objects[key] : (key.startsWith("data/search_") ? vocab(key) : null);
      return v == null ? null : { text: async () => v, json: async () => JSON.parse(v), httpEtag: `"e-${key}"` };
    },
    head: async (key) => (key in objects ? { httpEtag: `"e-${key}"` } : null),
  };
  return { env: { SITE }, gets };
};
const store = new Map();
globalThis.caches = { default: {
  async match(req) { const v = store.get(req.url); return v ? new Response(v.body, { status: 200, headers: v.headers }) : undefined; },
  async put(req, res) { store.set(req.url, { body: await res.text(), headers: [...res.headers] }); },
} };
const pending = [];
const ctx = { waitUntil: (p) => pending.push(p) };
let n = 0;
const isolate = async () => (await import(`../publish/worker.js?isolate=${++n}`)).default;   // a cold isolate
const get = (w, env, path, init) => w.fetch(new Request("https://motdang.net" + path, init), env, ctx);
const errs = []; const realErr = console.error; console.error = (...a) => errs.push(a);

await t("no edge index in the bucket: 503, not deployed, nothing logged", async () => {
  const w = await isolate(); const { env } = bucket({ "api/v1/index.json": TINY });
  const r = await get(w, env, "/api/v1/search?q=coffee"); ok(r.status === 503, "status " + r.status);
  const b = await r.json(); ok(b.error === "search engine not deployed", b.error);
  ok(b.schemaVersion === 1 && b.hint && b.docs, "keys " + Object.keys(b));
  ok(errs.length === 0, "absence was logged as a fault"); });
await t("the engine is there and breaks: 500, said, logged with the query", async () => {
  const w = await isolate(); const { env } = bucket({ "api/v1/index.json": TINY }, (k) => k.startsWith("api/v1/edge/"));
  const r = await get(w, env, "/api/v1/search?q=coffee"); ok(r.status === 500, "status " + r.status);
  const b = await r.json(); ok(b.error === "search engine fault", b.error);
  ok(/^TypeError/.test(b.code), "code " + b.code);
  ok(b.schemaVersion === 1 && b.hint && b.docs, "keys " + Object.keys(b));
  ok(errs.length === 1 && errs[0].some((a) => String(a).includes("q=coffee")), "not logged with the query"); });
console.error = realErr;
await t("a /places answer is kept at the colo for the 300 s its header says", async () => {
  const a = await isolate(); const { env, gets } = bucket({ "api/v1/index.json": TINY });
  const loads = () => gets.filter((k) => k === "api/v1/index.json").length;
  let r = await get(a, env, "/api/v1/places?q=x"); ok(r.status === 200, "status " + r.status);
  ok(r.headers.get("x-md-edge") === "miss", "first ask " + r.headers.get("x-md-edge"));
  const body = await r.text(); ok(JSON.parse(body).total === 1, "total");
  await Promise.all(pending.splice(0));
  ok(store.has("https://motdang.net/api/v1/places?q=x"), "not stored"); ok(loads() === 1, "loads " + loads());
  const b = await isolate();                                         // a cold isolate in the same colo
  r = await get(b, env, "/api/v1/places?q=x"); ok(r.status === 200, "status " + r.status);
  ok(r.headers.get("x-md-edge") === "hit", "second ask " + r.headers.get("x-md-edge"));
  ok(await r.text() === body, "the bytes differ");
  ok(r.headers.get("cache-control") === "public, max-age=300", "header " + r.headers.get("cache-control"));
  ok(loads() === 1, "the hit read the index");
  r = await get(b, env, "/api/v1/places?q=y");                       // another question: computed, index loaded now
  ok(r.headers.get("x-md-edge") === "miss" && loads() === 2, "a miss did not load the index");
  r = await get(b, env, "/api/v1/places?q=x", { method: "HEAD" });   // HEAD computes; only GET is kept
  ok(r.status === 200 && !r.headers.get("x-md-edge"), "HEAD took the cache"); });

/* ---- the ranking, over the real shards -------------------------------------- */
if (!existsSync(join(DOCS, "api/v1/edge/meta.json")) || !existsSync(IDX)) {
  console.log(`SKIPPED the docs-backed cases — need ${DOCS}/api/v1/edge and ${IDX}`);
  console.log(failures ? `\n${failures} FAILED` : "\nall green"); process.exit(failures ? 1 : 0);
}
const env = { SITE: { get: async (key) => { const p = join(DOCS, key); if (!existsSync(p)) return null;
  const buf = readFileSync(p); return { json: async () => JSON.parse(buf.toString("utf8")), text: async () => buf.toString("utf8"),
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), httpEtag: "x" }; },
  head: async (key) => (existsSync(join(DOCS, key)) ? { httpEtag: "x" } : null) } };
const ix = JSON.parse(readFileSync(IDX, "utf8"));
const q = (s) => searchHandler(env, ix, new URLSearchParams(s));
const edgeIds = new Set(JSON.parse(readFileSync(join(DOCS, "api/v1/edge/ids.json"), "utf8")));
await t("River Tavern answers with its city attached, first", async () => {
  const r = await q("q=river tavern chiang rai"); ok(r.query.province === "cr", "province not lifted");
  if (!edgeIds.has("cr-curated-river-tavern")) { console.log("       (this index predates the held-row change — the id is not in the shards; ranking not asserted)"); return; }
  ok(r.total >= 1, "nothing"); ok(r.results[0].id === "cr-curated-river-tavern", "first is " + r.results[0].id); });
await t("a city narrows: every row is in the province", async () => { const r = await q("q=khao soi chiang rai&limit=100"); ok(r.total >= 20, "too few: " + r.total); for (const x of r.results) ok(x.province === "cr", x.id); });
await t("nonsense answers zero, not a loose match", async () => { const r = await q("q=zzzzqqq"); ok(r.total === 0, "total " + r.total); });
await t("Thai is segmented and ranked by the same rules", async () => { const r = await q("q=ตอกเส้น&limit=5"); ok(r.total >= 10, "total " + r.total); ok(r.tier === "exact", "tier " + r.tier); ok(typeof r.results[0].score === "number"); });
await t("an empty q is an empty answer, not an error", async () => { const r = await q("q="); ok(r.total === 0 && r.results.length === 0); });
await t("limit and offset page the same ranking", async () => { const a = await q("q=coffee&limit=5"); const b = await q("q=coffee&limit=5&offset=5"); ok(a.results.length === 5 && b.results.length === 5); ok(a.results[0].id !== b.results[0].id); ok(a.total === b.total); });
console.log(failures ? `\n${failures} FAILED` : "\nall green"); process.exit(failures ? 1 : 0);
