// vk-watch: quiet, a flood that pings, the same flood again (no ping), and its end.
//   node vk-watch/test/watch.test.mjs
import assert from "node:assert/strict";
import worker, { tick, over, signature, message, area, SITES } from "../src/index.js";

const kv = new Map();
const VK = {
  async get(k, t) { const v = kv.get(k); return v == null ? null : t === "json" ? JSON.parse(v) : v; },
  async put(k, v) { kv.set(k, v); },
  async delete(k) { kv.delete(k); },
};
const env = { VK, CF_API_TOKEN: "t", DISCORD_WEBHOOK: "https://discord.test/hook", RESEND_KEY: "re_test" };

let rate = { "motdang.net": 190, "hongdam.net": 2 };   // requests a minute
const pings = [];
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  const json = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { "content-type": "application/json" } });
  if (url.endsWith("/analytics_engine/sql")) {
    const q = init.body;
    const t0 = q.match(/toDateTime\('([^']+)'\)/)[1];
    if (q.includes("toStartOfMinute")) {
      const a = Date.parse(t0.replace(" ", "T") + "Z");
      const data = [];
      for (const h of Object.keys(SITES)) for (let i = 0; i < 5; i++)
        data.push({ h, m: new Date(a + i * 60000).toISOString().slice(0, 19).replace("T", " "), n: rate[h], s: h === "motdang.net" && rate[h] > 1000 ? rate[h] * 0.3 : 0 });
      return json({ data });
    }
    if (q.includes("INTERVAL '5' MINUTE")) {
      const data = [];
      for (const h of Object.keys(SITES)) for (let i = 0; i < 288; i++) data.push({ h, t: String(i), n: h === "motdang.net" ? 970 : 12 });
      return json({ data });
    }
    if (q.includes("GROUP BY k, l")) {
      if (q.includes("blob15 k")) return json({ data: [{ k: "396982", l: "Google LLC", n: 9000 }, { k: "131445", l: "AIS", n: 40 }] });
      if (q.includes("blob3 k")) return json({ data: [{ k: "Chrome string, no Chrome", l: "other", n: 8800 }] });
      if (q.includes("blob4 k")) return json({ data: [{ k: "/search.html", l: "", n: 8500 }] });
      if (q.includes("blob5 k")) return json({ data: [{ k: "US", l: "", n: 8000 }] });
      return json({ data: [] });
    }
    return json({ data: [{ n: 10000 }] });                 // the snapshot total
  }
  if (url.endsWith("/graphql")) {
    const q = JSON.parse(init.body).query;
    if (q.includes("firewallEventsAdaptive")) return json({ data: { viewer: { zones: [{ f: [
      { action: "block", source: "firewallManaged", clientAsn: "16509", clientASNDescription: "AMAZON-02", clientIP: "192.0.2.1" },
      { action: "block", source: "firewallManaged", clientAsn: "16509", clientASNDescription: "AMAZON-02", clientIP: "192.0.2.2" },
      { action: "block", source: "firewallManaged", clientAsn: "16509", clientASNDescription: "AMAZON-02", clientIP: "192.0.2.1" },
      { action: "managed_challenge", source: "securitylevel", clientAsn: "14061", clientASNDescription: "DIGITALOCEAN", clientIP: "198.51.100.9" }] }] } } });
    return json({ data: { viewer: { zones: [{ r: [{ count: 9000, dimensions: { edgeResponseStatus: 200 } }, { count: 600, dimensions: { edgeResponseStatus: 504 } }] }] } } });
  }
  if (url.startsWith("https://discord.test")) { pings.push(["discord", JSON.parse(init.body)]); return new Response(null, { status: 204 }); }
  if (url.startsWith("https://api.resend.com")) { pings.push(["email", JSON.parse(init.body)]); return json({ id: "email-1" }); }
  if (url === "https://motdang.net/" || url === "https://hongdam.net/") return new Response("ok", { status: 200 });
  throw new Error("unexpected fetch " + url);
};

const T0 = Date.parse("2026-11-26T02:00:00Z");
const at = (m) => T0 + m * 60000;

// the line
assert.equal(over(SITES["motdang.net"], { n: 4000, s: 0 }, 970).line, 3880);
assert.equal(over(SITES["motdang.net"], { n: 3000, s: 0 }, 970).hit, false);
assert.equal(over(SITES["motdang.net"], { n: 1600, s: 400 }, 970).hit, true, "a fifth turned away busy is a flood");
assert.equal(over(SITES["hongdam.net"], { n: 14000, s: 0 }, 12).hit, true);

// quiet
await tick(env, at(0));
assert.equal(kv.get("on:motdang.net"), undefined);
assert.equal(pings.length, 0);

// a flood: one Discord message, one email
rate["motdang.net"] = 2000;
await tick(env, at(1));
let f = JSON.parse(kv.get("on:motdang.net"));
assert.equal(f.sig, "AS396982 → /search.html");
assert.equal(f.repeat, false);
assert.equal(f.snap.edge.total, 9600);
assert.deepEqual(f.snap.edge.actions[0], ["block", "firewallManaged", "16509", "AMAZON-02", 3, 2]);
assert.equal(f.snap.edge.firewall.addresses, 3);
assert.ok(!JSON.stringify(f.snap).includes("192.0.2.1"), "an address reached the snapshot");
assert.deepEqual(pings.map((p) => p[0]), ["discord", "email"]);
assert.deepEqual(pings[0][1].allowed_mentions, { parse: [] }, "no one is pinged by name");
assert.match(pings[0][1].content, /Flood on motdang\.net/);
assert.match(pings[0][1].content, /Cloudflare stopped: block firewallManaged AS16509 3 from 2 addresses/);
assert.match(pings[1][1].subject, /VK: flood on motdang\.net, 10,000 requests in 5 min/);

// still on: no more messages
await tick(env, at(2));
assert.equal(pings.length, 2);

// back under: ends after ten quiet minutes
rate["motdang.net"] = 190;
for (let m = 3; m <= 11; m++) await tick(env, at(m));
assert.ok(kv.get("on:motdang.net"), "still on before ten quiet minutes");
await tick(env, at(12));
assert.equal(kv.get("on:motdang.net"), undefined);
let floods = JSON.parse(kv.get("floods"));
assert.equal(floods.length, 1);
assert.equal(floods[0].end, at(2) - 60000);

// the same shape again within 7 days: logged, no ping
rate["motdang.net"] = 2000;
await tick(env, at(60));
f = JSON.parse(kv.get("on:motdang.net"));
assert.equal(f.repeat, true);
assert.equal(pings.length, 2);

// what the page reads
const r = await worker.fetch(new Request("https://vk-watch.test/floods.json"), env);
const v = await r.json();
assert.equal(r.headers.get("access-control-allow-origin"), "*");
assert.equal(v.on.length, 1);
assert.equal(v.floods.length, 1);
assert.equal(v.sites["motdang.net"].median, 970);
assert.deepEqual(v.sites["motdang.net"].edge, { total: 9600, s5xx: 600, s504: 600 });
assert.ok(!JSON.stringify(v).includes("192.0.2"), "an address reached floods.json");
const txt = await (await worker.fetch(new Request("https://vk-watch.test/"), env)).text();
assert.match(txt, /ON NOW/);

// words
assert.equal(signature({ total: 100, networks: [["1", "x", 10]], callers: [["ClaudeBot", "ai", 60]], pages: [["/toilets.html", "", 50]] }), "ClaudeBot → /toilets.html");
assert.ok(!message("motdang.net", { ...f, snap: { total: 0 } }).includes("undefined"));
assert.equal(area("/api/fx"), "/api/…");
assert.equal(area("/api/swan/poll"), "/api/…");
assert.equal(area("/search.html"), "/search.html");
assert.equal(area("/find"), "/find");
console.log("vk-watch: all green");
