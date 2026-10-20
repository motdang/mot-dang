// accounts_layer.py's browser half: stamping and merging, against stub browser objects.
//   node tests/test_accounts_layer.mjs
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const code = execFileSync("python3", ["-c", "import accounts_layer,sys;sys.stdout.write(accounts_layer.MD_JS)"], { cwd: ROOT, encoding: "utf8" });
class Storage { constructor(){ this.m = new Map(); } getItem(k){ return this.m.has(k) ? this.m.get(k) : null; } setItem(k,v){ this.m.set(k,String(v)); } removeItem(k){ this.m.delete(k); } }
const ls = new Storage(), ss = new Storage();
const g = { Storage, localStorage: ls, sessionStorage: ss, location: { hostname: "example.org" }, document: { getElementById(){ return null; }, dispatchEvent(){} }, CustomEvent: class{}, fetch: () => Promise.reject() };
g.window = g;
new Function(...Object.keys(g), code)(...Object.values(g));
const M = g.window.MDACCT, A = (c, m) => { if (!c) { console.log("FAIL", m); process.exitCode = 1; } else console.log("ok  ", m); };
// stamping
ls.setItem("md-city", "cr"); const st = JSON.parse(ls.getItem("md-sync-t")); A(st["md-city"] > 0, "a kept setting is stamped on write");
ls.setItem("other", "x"); A(!JSON.parse(ls.getItem("md-sync-t")).other, "other keys are not stamped");
// merge: later setting wins
const a = { keys: { "md-city": { v: "cm", t: 10 }, "md-notes": { v: "mine", t: 50 } }, saved: [], gone: [] };
const b = { keys: { "md-city": { v: "cr", t: 20 }, "md-notes": { v: "theirs", t: 5 } }, saved: [], gone: [] };
const m = M.merge(a, b);
A(m.keys["md-city"].v === "cr" && m.keys["md-notes"].v === "mine", "each setting from the side that changed it last");
// saved: union, removal later wins, re-save after removal wins
const now = Date.now();
const s1 = { keys: {}, saved: [{ k: "cm:a", t: now - 5000 }, { lat: 18.7, lng: 98.9, n: "pin", t: now - 4000 }], gone: [] };
const s2 = { keys: {}, saved: [{ k: "cm:b", t: now - 3000 }], gone: [{ k: "cm:a", t: now - 1000 }] };
const ms = M.merge(s1, s2);
const ids = ms.saved.map((o) => o.k || o.n).sort().join(",");
A(ids === "cm:b,pin", "union of saved places, less one removed after it was saved: " + ids);
const s3 = { keys: {}, saved: [{ k: "cm:a", t: now }], gone: [] };
A(M.merge(s3, s2).saved.some((o) => o.k === "cm:a"), "a place saved again after its removal stays");
A(M.merge({ gone: [{ k: "x", t: now - 200 * 864e5 }] }, {}).gone.length === 0, "removals older than 120 days are dropped");
A(M.merge({ keys: { "evil-key": { v: 1, t: 9 } } }, {}).keys["evil-key"] === undefined, "only the kept settings travel");
ls.setItem("md-saved", JSON.stringify([{ k: "cm:a", t: 1 }])); ls.setItem("md-acct", "A"); ls.setItem("md-lang", "en");
M.wipe();
A(ls.getItem("md-saved") === null && ls.getItem("md-city") === null && ls.getItem("md-lang") === null, "sign-out clears the synced things from this browser");

/* A shared browser: A's unsent things are set aside when B signs in, B's account gets none of them,
   and they reach A's account when A signs in here again. */
async function boot(me, server) {
  const ls2 = new Storage(), ss2 = new Storage();
  return { ls2, ss2, run(seed) {
    for (const [k, v] of Object.entries(seed || {})) ls2.m.set(k, v);
    const g2 = { Storage, localStorage: ls2, sessionStorage: ss2, location: { hostname: "motdang.net", pathname: "/my.html", search: "" },
      document: { getElementById() { return null; }, dispatchEvent() {} }, CustomEvent: class {},
      fetch: async (u, init) => {
        if (u === "/api/me") return { ok: true, json: async () => me };
        if (u === "/api/me/saved" && (!init || !init.method)) return { ok: true, status: 200, json: async () => server[me.u] || { data: {}, ver: 0 } };
        if (u === "/api/me/saved" && init.method === "PUT") { const b = JSON.parse(init.body); server[me.u] = { data: b.data, ver: b.ver + 1 }; return { ok: true, status: 200 }; }
        return { ok: false, status: 404, json: async () => ({}) };
      } };
    g2.window = g2;
    new Function(...Object.keys(g2), code)(...Object.values(g2));
    return new Promise((r) => setTimeout(r, 50));
  } };
}
const server = {};
const t0 = Date.now();
const b1 = await boot({ signedIn: true, u: "BBBBBBBBBBBBBBBB", line: true }, server);
await b1.run({ "md-acct": "AAAAAAAAAAAAAAAA", "md-saved": JSON.stringify([{ k: "cm:a-only", t: t0 }]) });
const bSaved = JSON.stringify((server.BBBBBBBBBBBBBBBB || {}).data || {});
A(!bSaved.includes("a-only"), "B's account gets none of A's things");
A((b1.ls2.getItem("md-acct-stash:AAAAAAAAAAAAAAAA") || "").includes("a-only"), "A's unsent things are set aside on the browser");
const b2 = await boot({ signedIn: true, u: "AAAAAAAAAAAAAAAA", line: true }, server);
await b2.run(Object.fromEntries(b1.ls2.m));
A(JSON.stringify(server.AAAAAAAAAAAAAAAA.data).includes("a-only"), "A signing in again sends them to A's account");
A(b2.ls2.getItem("md-acct-stash:AAAAAAAAAAAAAAAA") === null, "and the set-aside copy is gone");
