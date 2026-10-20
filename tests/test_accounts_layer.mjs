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
