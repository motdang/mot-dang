/* Score /find on fleetsearch/bench_cases.json (written by bench_build.py).
 *
 *   node fleetsearch/bench.mjs --local                 the real handler over the local twin
 *   node fleetsearch/bench.mjs --base https://motdang.net --slow --set kind,spec
 *   node fleetsearch/bench.mjs --local --label after --set kind,spec
 *   node fleetsearch/bench.mjs --diff before after     what changed between two runs
 *
 * Each run writes cache/fleetsearch/bench/<label>.jsonl (one row per case) and
 * prints the score. --local has no meaning re-rank (no AI binding), so it is the
 * order a reader gets when that re-rank is late. */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUTD = join(ROOT, "cache/fleetsearch/bench");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(k);
const SITE = "https://motdang.net/";
const PAGED = /(?:-p\d+|page-\d+)\.html$/;

if (has("--diff")) { diff(arg("--diff"), process.argv[process.argv.indexOf("--diff") + 2]); process.exit(0); }

const sets = new Set((arg("--set", "name,audit,kind,spec")).split(","));
const cases = JSON.parse(readFileSync(join(ROOT, "fleetsearch/bench_cases.json"), "utf8")).filter((c) => sets.has(c.set));
const label = arg("--label", has("--local") ? "local" : "live");

/* url → the place it is: cat, sub, province, names. */
function placeMap() {
  const paths = JSON.parse(readFileSync(join(ROOT, "cache/place_paths.json"), "utf8"));
  const m = new Map();
  for (const prov of ["cm", "cr"]) {
    const f = [join(ROOT, `data/canonical/${prov}.json`), join(ROOT, `../../../data/canonical/${prov}.json`)].find(existsSync);
    for (const r of JSON.parse(readFileSync(f, "utf8"))) {
      const p = paths[r.id];
      if (!p) continue;
      m.set(SITE + p, { cat: r.cat || [], sub: (r.sub || []).map((s) => `${(r.cat || [])[0]}/${s}`), prov,
        name: [r.name, r.nameTh, r.nameEn].filter(Boolean).join(" ") });
    }
  }
  return m;
}

async function localRunner() {
  const { DatabaseSync } = await import("node:sqlite");
  const { fleetSearch } = await import(join(ROOT, "publish/fleetsearch.js"));
  const SEARCHCORE = (await import(join(ROOT, "publish/searchcore.js"))).default;
  const groups = JSON.parse(readFileSync(join(ROOT, "data/search_thesaurus.json"), "utf8")).groups;
  const segdict = readFileSync(join(ROOT, "data/search_segdict.txt"), "utf8").split("\n").filter((l) => l && l[0] !== "#");
  const core = new SEARCHCORE.SearchCore(groups, segdict);
  const db = new DatabaseSync(join(ROOT, "cache/fleetsearch/fleet.sqlite"), { readOnly: true });
  const SEARCH = {
    prepare(text) { return { text, binds: [], bind(...b) { this.binds = b; return this; },
      async all() { return { results: db.prepare(this.text).all(...this.binds) }; } }; },
    async batch(st) { return st.map((s) => ({ results: db.prepare(s.text).all(...s.binds) })); },
  };
  const env = { SEARCH, OWN_FIND_URL: "" };
  const CF = { city: "Chiang Mai", latitude: "18.79038", longitude: "98.98468", timezone: "Asia/Bangkok", country: "TH" };
  return async (qs) => {
    const url = new URL("https://motdang.net/find?" + qs);
    const req = new Request(url.toString());
    Object.defineProperty(req, "cf", { value: has("--nocf") ? undefined : CF });
    const res = await fleetSearch(req, env, url, { waitUntil() {} }, async () => core);
    return JSON.parse(await res.text());
  };
}

function liveRunner(base) {
  return async (qs) => {
    for (let i = 0; i < 3; i++) {
      try {
        const r = await fetch(`${base}/find?${qs}&cb=${Date.now()}`, { headers: { "User-Agent": "motdang-bench/1 (+https://motdang.net/find)" } });
        if (r.ok) return await r.json();
      } catch {}
      await new Promise((ok) => setTimeout(ok, 1500 * (i + 1)));
    }
    return { results: [], error: true };
  };
}

function judge(c, rows, places) {
  const urls = rows.map((r) => (r.url || "").split("#")[0]);
  const top10 = urls.slice(0, 10);
  const paged = top10.filter((u) => PAGED.test(u)).length;
  if (c.set === "kind") {
    const re = c.accept.name ? new RegExp(c.accept.name, "i") : null;
    const ok = (u) => { const p = places.get(u); if (!p) return false;
      if (c.prov && p.prov !== c.prov) return false;
      return (c.accept.cat || []).some((k) => p.cat[0] === k) || (c.accept.sub || []).some((s) => p.sub.includes(s)) || (re && re.test(p.name)); };
    const hits = top10.map(ok);
    const first = hits.indexOf(true) + 1 || 0;
    const n = hits.filter(Boolean).length;
    return { first, kind10: n, paged, pass: first > 0 && first <= 3 && n >= 5 && paged === 0 };
  }
  const want = new Set(c.want);
  const ranks = c.want.map((w) => urls.indexOf(w) + 1);
  const best = Math.min(...ranks.map((r) => r || 99));
  const pass = c.all ? ranks.every((r) => r > 0 && r <= c.top) : best <= c.top;
  return { rank: best === 99 ? 0 : best, paged, pass, other: urls.slice(0, 3).filter((u) => !want.has(u)).length };
}

if (has("--q")) {
  /* one query, the JSON as the handler gives it: node fleetsearch/bench.mjs --local --q "museum" */
  const r = has("--local") ? await localRunner() : liveRunner(arg("--base", "https://motdang.net"));
  const d = await r(new URLSearchParams({ q: arg("--q"), fmt: "json", n: "10" }).toString());
  console.log(JSON.stringify({ ...d, results: (d.results || []).map((x) => [x.kind, x.url.replace(SITE, ""), x.title.slice(0, 70)]) }, null, 1));
  process.exit(0);
}
if (has("--engine")) {
  /* another benchmark's searches, answered here as {qid, urls} lines:
   * node fleetsearch/bench.mjs --local --engine <bench.json> --out <file.jsonl> */
  const qs = JSON.parse(readFileSync(arg("--engine"), "utf8"));
  const r = has("--local") ? await localRunner() : liveRunner(arg("--base", "https://motdang.net"));
  const lines = [];
  for (const b of qs) {
    const d = await r(new URLSearchParams({ q: b.q, fmt: "json", n: "10" }).toString());
    lines.push(JSON.stringify({ qid: b.qid, urls: (d.results || []).map((x) => x.url) }));
  }
  writeFileSync(arg("--out"), lines.join("\n") + "\n");
  process.exit(0);
}
const places = placeMap();
const run = has("--local") ? await localRunner() : liveRunner(arg("--base", "https://motdang.net"));
const out = [];
/* --slow: one search every 3.5 s, under the site's ~20-a-minute gate (precepts),
 * which otherwise turns the run away and scores the refusals. */
const conc = has("--local") || has("--slow") ? 1 : 3;
let i = 0;
async function worker() {
  while (i < cases.length) {
    const c = cases[i++];
    const p = new URLSearchParams({ q: c.q, fmt: "json", n: "20", ...(c.params || {}) });
    const t = Date.now();
    const d = await run(p.toString());
    const rows = d.results || [];
    out.push({ ...c, ms: Date.now() - t, total: d.total, match: d.match, meaning: d.meaning ? 1 : 0,
      top: rows.slice(0, 10).map((r) => [r.kind || "", (r.url || "").replace(SITE, "")]), j: judge(c, rows, places), err: d.error || undefined });
    if (!has("--local")) await new Promise((ok) => setTimeout(ok, has("--slow") ? 3500 : 250));
  }
}
await Promise.all(Array.from({ length: conc }, worker));
mkdirSync(OUTD, { recursive: true });
writeFileSync(join(OUTD, label + ".jsonl"), out.map((r) => JSON.stringify(r)).join("\n") + "\n");
summary(out, label);

function summary(rows, name) {
  const by = {};
  for (const r of rows) (by[r.set] ||= []).push(r);
  console.log(`bench ${name}: ${rows.length} cases${rows.some((r) => r.err) ? `, ${rows.filter((r) => r.err).length} failed to answer` : ""}`);
  for (const [s, rs] of Object.entries(by)) {
    const pass = rs.filter((r) => r.j.pass).length;
    if (s === "kind") {
      const firsts = rs.map((r) => r.j.first || 11);
      const med = firsts.sort((a, b) => a - b)[Math.floor(firsts.length / 2)];
      const k10 = rs.reduce((a, r) => a + r.j.kind10, 0);
      const pg = rs.reduce((a, r) => a + r.j.paged, 0);
      console.log(`  kind   ${pass}/${rs.length} pass · median first place of the kind ${med === 11 ? "none" : med} · kind in top 10 ${(k10 / rs.length).toFixed(1)}/10 · page-2+ lists in top 10 ${pg}`);
    } else {
      const at1 = rs.filter((r) => r.j.rank === 1).length, at3 = rs.filter((r) => r.j.rank && r.j.rank <= 3).length;
      console.log(`  ${s.padEnd(6)} ${pass}/${rs.length} pass · @1 ${at1} · @3 ${at3} · missing from top 20 ${rs.filter((r) => !r.j.rank).length}`);
    }
  }
}

function diff(a, b) {
  const read = (n) => new Map(readFileSync(join(OUTD, n + ".jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).map((r) => [r.set + "\t" + r.q, r]));
  const A = read(a), B = read(b);
  const fixed = [], broke = [];
  for (const [k, rb] of B) { const ra = A.get(k); if (!ra) continue;
    if (!ra.j.pass && rb.j.pass) fixed.push(k); if (ra.j.pass && !rb.j.pass) broke.push(k); }
  summary([...A.values()], a); summary([...B.values()], b);
  console.log(`fixed ${fixed.length}, broke ${broke.length}`);
  for (const k of broke) { const ra = A.get(k), rb = B.get(k);
    console.log("  BROKE " + k.replace("\t", ": ") + "  " + JSON.stringify(ra.j) + " → " + JSON.stringify(rb.j)); }
  if (has("-v")) for (const k of fixed) console.log("  fixed " + k.replace("\t", ": "));
}
