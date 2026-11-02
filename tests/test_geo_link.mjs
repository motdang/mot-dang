#!/usr/bin/env node
// A crawler that reads a place page's maps link (href="geo:lat,lng?q=…") as a
// page address lands on that place's page, not a 404.
//
//   node tests/test_geo_link.mjs          # MD_DOCS=<built docs/> to point elsewhere
//
// Runs the real Worker against the built docs/ on disk, as test_worker_routes.js
// does, with the two things Node lacks stubbed: ctx.waitUntil and HTMLRewriter.
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

globalThis.HTMLRewriter ??= class { on() { return this; } onDocument() { return this; } transform(r) { return r; } };
const mod = await import(join(ROOT, "publish/worker.js"));
const worker = mod.default;

const etag = (buf) => '"' + createHash("md5").update(buf).digest("hex") + '"';
const file = (key) => {
  const path = join(DOCS, normalize("/" + key));
  return path.startsWith(DOCS) && existsSync(path) && statSync(path).isFile() ? readFileSync(path) : null;
};
const SITE = {
  async get(key) {
    const buf = file(key);
    if (!buf) return null;
    return { httpEtag: etag(buf), size: buf.length, body: new Blob([buf]).stream(),
             async text() { return buf.toString("utf8"); },
             writeHttpMetadata() {} };
  },
  async head(key) { const buf = file(key); return buf ? { httpEtag: etag(buf) } : null; },
};
const ctx = { waitUntil() {}, passThroughOnException() {} };
const get = (path) => worker.fetch(new Request("https://motdang.net" + path, { redirect: "manual" }), { SITE }, ctx);

let failures = 0;
async function t(name, fn) {
  try { await fn(); console.log("  ok   " + name); }
  catch (e) { failures++; console.log("  FAIL " + name + "\n       " + e.message); }
}
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m || ""} ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };

await t("geoPath reads the address a crawler builds, and nothing else", () => {
  eq(JSON.stringify(mod.geoPath("/cr/p/geo:19.583432,99.772973")), '{"lat":"19.583432","lng":"99.772973"}');
  eq(JSON.stringify(mod.geoPath("/cm/p/geo%3A18.79,98.98")), '{"lat":"18.79","lng":"98.98"}');
  eq(mod.geoPath("/cr/p/32430879352468939674675569.html"), null);
  eq(mod.geoPath("/cr/p/geo:abc,def"), null);
  eq(mod.geoPath("/cr/geo:19.5,99.7"), null);
});

const pinned = (r) => Number.isFinite(+r.lat) && Number.isFinite(+(r.lng ?? r.lon)) && r.url;
const at = (r) => [(+r.lat).toFixed(6), (+(r.lng ?? r.lon)).toFixed(6)];
const within2m = async (r) => (await (await get(`/api/v1/places?near=${at(r).join(",")}&radius=2&limit=3`)).json()).total;
const list = ((await (await get("/api/v1/places?limit=60")).json()).results || []).filter(pinned);
let place = null, shared = null;
for (const r of list) {
  const n = await within2m(r);
  if (n === 1 && !place) place = r;
  if (n > 1 && !shared) shared = r;
  if (place && shared) break;
}

await t("the index has a place alone on its spot, and one sharing a spot", () => {
  if (!place) throw new Error("no place alone within 2 m among the first 60");
  if (!shared) throw new Error("no shared spot among the first 60");
});

if (shared) {
  await t("a spot two places share is not redirected to either", async () => {
    const r = await get(`/${new URL(shared.url).pathname.split("/")[1]}/p/geo:${at(shared).join(",")}`);
    if (r.status === 301) throw new Error(`redirected to ${r.headers.get("location")}`);
  });
}

if (place) {
  const [lat, lng] = at(place);
  const page = new URL(place.url).pathname;
  const prov = page.split("/")[1];

  await t("a geo: address on a place's own coordinates moves to that place's page", async () => {
    const r = await get(`/${prov}/p/geo:${lat},${lng}`);
    eq(r.status, 301, "not a permanent redirect");
    eq(new URL(r.headers.get("location")).pathname, page, "landed on another page");
  });

  await t("coordinates no place stands on are not redirected", async () => {
    const r = await get(`/${prov}/p/geo:1.000001,1.000001`);
    if (r.status === 301) throw new Error(`redirected to ${r.headers.get("location")}`);
  });
}

console.log(failures ? `\n${failures} FAILED` : "\nall green");
process.exit(failures ? 1 : 0);
