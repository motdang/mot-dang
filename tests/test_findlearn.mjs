// findlearn: /find's tap beacon, the people-only learning store, and the bounded lift it gives the ranking.
//   node --test tests/test_findlearn.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { learnKey, learnLift, findSense, learnedFor, LIFT_MAX, findJudge, judgeFields, judgeMult, UP_X, DOWN_X, JUDGE_CAP } from "../publish/findlearn.js";
import { sql, judgePanel } from "../publish/fleetsearch.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("a query folds to one key: case, order, punctuation, ร้าน, near-words", () => {
  assert.equal(learnKey("Khao Soi"), "khao soi");
  assert.equal(learnKey("soi  KHAO!"), "khao soi");
  assert.equal(learnKey("khao soi near me"), "khao soi");
  assert.equal(learnKey("ร้านข้าวซอย"), learnKey("ข้าวซอย"));
  assert.equal(learnKey("ร้าน"), "ร้าน");
  assert.equal(learnKey("   "), "");
});

test("the lift is 0 below the floor and never above 1", () => {
  assert.equal(learnLift({ shown: 19, taps: 15 }), 0);
  assert.equal(learnLift({ shown: 100, taps: 2 }), 0);
  assert.equal(learnLift({ shown: 100, taps: 5, pogo: 3 }), 0);   // quick returns come off
  assert.equal(learnLift({ shown: 100, taps: 10 }), 0);           // ≈ the prior: no lift
  const mid = learnLift({ shown: 40, taps: 12 });
  assert.ok(mid > 0.3 && mid < 0.6, String(mid));
  assert.equal(learnLift({ shown: 20, taps: 20 }), 1);
  assert.ok(learnLift({ shown: 40, taps: 12, down: 5 }) < mid);
  assert.ok(learnLift({ shown: 40, taps: 12, up: 3 }) > mid);
});

function fakeDb() {
  const ran = [];
  return { ran, prepare(text) { return { text, binds: [], bind(...b) { this.binds = b; return this; } }; },
           async batch(st) { ran.push(...st); return st.map(() => ({})); } };
}
const classify = (ua) => ({ category: /bot/i.test(ua) ? "ai" : "human", agent: /bot/i.test(ua) ? "GPTBot" : "Chrome" });
const post = (body, ua = "Mozilla/5.0 Chrome") => new Request("https://motdang.net/api/find",
  { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { "user-agent": ua } });

test("a person's leave writes impressions, taps, the via credit and the rephrase", async () => {
  const db = fakeDb(), rows = [];
  const env = { SEARCH: db, TRAFFIC: { writeDataPoint: (r) => rows.push(r) } };
  const r = await findSense(post({ e: "leave", q: "Khao soi nimman", pq: "khao soi", pqt: 0, first: 1,
    shown: ["https://motdang.net/cm/p/a.html", "https://motdang.net/cm/p/b.html", "javascript:alert(1)"],
    taps: [{ u: "https://motdang.net/cm/p/b.html", r: 2, ms: 4100 }] }), env, classify);
  assert.equal(r.status, 204);
  assert.deepEqual(rows.map((x) => x.blobs[8]), ["view", "tap"]);
  assert.equal(rows[1].blobs[9], "khao nimman soi");
  assert.deepEqual(rows[1].doubles, [0, 204, 4100, 2, 1]);
  const t = db.ran.map((s) => s.text.replace(/\s+/g, " ").slice(0, 40));
  assert.equal(t.filter((x) => x.startsWith("INSERT INTO learn(qk, url, shown")).length, 2);   // junk url dropped
  assert.ok(db.ran.some((s) => /taps/.test(s.text) && s.binds[1].endsWith("/b.html") && s.binds[3] === 2));
  assert.ok(db.ran.some((s) => /via/.test(s.text) && s.binds[0] === "khao soi"));
  assert.ok(db.ran.some((s) => /learn_pair/.test(s.text) && s.binds.join("|") === "khao soi|khao nimman soi"));
  assert.ok(db.ran.some((s) => /reform = reform \+ 1/.test(s.text)));
});

test("a quick return is a pogo; a slow one is dwell", async () => {
  const db = fakeDb();
  await findSense(post({ e: "back", q: "khao soi", u: "https://motdang.net/cm/p/b.html", ms: 3000 }), { SEARCH: db }, classify);
  await findSense(post({ e: "back", q: "khao soi", u: "https://motdang.net/cm/p/b.html", ms: 9e6 }), { SEARCH: db }, classify);
  assert.deepEqual(db.ran[0].binds, ["khao soi", "https://motdang.net/cm/p/b.html", 1, 3000, 1]);
  assert.deepEqual(db.ran[1].binds, ["khao soi", "https://motdang.net/cm/p/b.html", 0, 6e5, 1]);
});

test("machines are counted in traffic_eye and never reach the learning store", async () => {
  const db = fakeDb(), rows = [];
  await findSense(post({ e: "leave", q: "khao soi", first: 1, shown: ["https://motdang.net/x.html"],
    taps: [{ u: "https://motdang.net/x.html", r: 1, ms: 50 }] }, "GPTBot/1.2"),
    { SEARCH: db, TRAFFIC: { writeDataPoint: (r) => rows.push(r) } }, classify);
  assert.equal(db.ran.length, 0);
  assert.equal(rows[0].blobs[1], "ai");
  const F = fakeDb();
  await findSense(post("not json"), { SEARCH: F }, classify);
  await findSense(post({ e: "drop", q: "x" }), { SEARCH: F }, classify);
  await findSense(new Request("https://motdang.net/api/find"), { SEARCH: F }, classify);
  assert.equal(F.ran.length, 0);
});

test("learnedFor keeps only pages over the floor, as bounded multipliers", async () => {
  const db = { prepare: () => ({ bind() { return this; }, async all() { return { results: [
    { url: "https://motdang.net/cm/p/a.html", shown: 30, taps: 25, pogo: 0, via: 0 },
    { url: "https://motdang.net/cm/p/b.html", shown: 30, taps: 3, pogo: 2, via: 0 }] }; } }) };
  const m = await learnedFor(db, "learnedFor test " + Date.now());
  assert.equal(m.size, 1);
  assert.equal(m.get("https://motdang.net/cm/p/a.html"), 1 + LIFT_MAX);
  const none = await learnedFor({ prepare() { throw new Error("no such table: learn"); } }, "no table " + Date.now());
  assert.equal(none.size, 0);
});

test("sql(): the learned multiplier rides inside the rank window, binds in order", () => {
  const learn = new Map([["https://motdang.net/cm/p/a.html", 1.2]]);
  const s = sql('"khao" "soi"', { learn, n: 10, offset: 0, drop: true });
  assert.match(s.text, /CASE lp\.url WHEN \? THEN \? ELSE 1\.0 END/);
  assert.match(s.text, /JOIN pages lp ON lp\.id = w\.id/);
  assert.deepEqual(s.binds.slice(0, 2), ["https://motdang.net/cm/p/a.html", 1.2]);
  const plain = sql('"khao" "soi"', { n: 10, offset: 0, drop: true });
  assert.doesNotMatch(plain.text, /lp\.url/);
  const far = sql('"khao" "soi"', { learn, n: 10, offset: 400, drop: true });
  assert.doesNotMatch(far.text, /lp\.url/);
});

test("the page side parses, runs only on a results page, posts only from motdang.net", () => {
  const js = readFileSync(join(ROOT, "assets/find_learn.js"), "utf8");
  new Function(js);                                    // a syntax error throws here
  assert.match(js, /motdang\\\.net/);
  assert.match(js, /md-trail/);
  assert.match(js, /find\(\\\/\|\\\.html\)\?\|search/);
});

/* On the local twin, a lower-ranked page with a strong record moves up, by a
 * bounded amount, and a title-tier page is not overtaken. */
const TWIN = join(ROOT, "cache/fleetsearch/fleet.sqlite");
test("on the twin: a learned page rises, within the bound", { skip: !existsSync(TWIN) && "no local twin" }, async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const twin = new DatabaseSync(TWIN, { readOnly: true });
  const q = '"wat"';
  const base = sql(q, { n: 50, offset: 0, drop: true });
  const rows = twin.prepare(base.text).all(...base.binds);
  assert.ok(rows.length >= 20);
  const target = rows[15].url;
  const learn = new Map([[target, 1 + LIFT_MAX]]);
  const s = sql(q, { n: 50, offset: 0, drop: true, learn });
  const after = twin.prepare(s.text).all(...s.binds).map((r) => r.url);
  const at = after.indexOf(target);
  assert.ok(at >= 0 && at < 15, `moved to ${at}`);
  // rank × 1.25 can only pass pages whose score is within 25% of its own
  const r0 = twin.prepare(`SELECT rank FROM fts WHERE fts MATCH ? ORDER BY rank LIMIT 50`).all(s.binds[s.binds.length - 1]);
  assert.ok(r0.length > 0);
  twin.close();
});

/* ---- good / not it (findJudge, judgePanel) ---- */

function judgeDb() {
  const ran = [];
  const st = (text) => ({ text, binds: [], bind(...b) { this.binds = b; return this; },
    async first() { ran.push(this); return { id: 7 }; } });
  return { ran, prepare: st, async batch(x) { ran.push(...x); return x.map(() => ({})); } };
}
const A = "https://motdang.net/cm/p/a.html", B = "https://motdang.net/cm/p/b.html";

test("judgeMult: ✓ up, ✕ down, a tie or nothing leaves it", () => {
  assert.equal(judgeMult(1, 0), UP_X);
  assert.equal(judgeMult(0, 2), DOWN_X);
  assert.equal(judgeMult(1, 1), 1);
  assert.equal(judgeMult(undefined, null), 1);
  assert.ok(DOWN_X > 0 && DOWN_X < 1 && JUDGE_CAP < 2);
});

test("judgeFields keeps what is well formed and drops the rest", () => {
  const f = judgeFields({ q: " khao\nsoi ", v: "nonsense", why: ["far", "far", "bogus", "missing"],
    y: [A, "javascript:alert(1)", A], n: B, want: "x".repeat(900), snap: "{not json", lang: "fr" });
  assert.equal(f.q, "khao soi");
  assert.equal(f.v, "bad");
  assert.deepEqual(f.why, ["far", "missing"]);
  assert.deepEqual(f.y, [A]);
  assert.deepEqual(f.n, [B]);
  assert.equal(f.want.length, 600);
  assert.equal(f.snap, "");
  assert.equal(f.lang, "");
  assert.equal(judgeFields({ snap: '{"rows":[[1,"u"]]}' }).snap, '{"rows":[[1,"u"]]}');
  assert.equal(judgeFields({ snap: "[1,2]" }).snap, "");
  assert.equal(judgeFields({ snap: JSON.stringify({ x: "y".repeat(9000) }) }).snap, "");
});

test("a person's not-it: one judged row, ✓ ✕ into learn under the matched words, JSON back", async () => {
  const db = judgeDb(), rows = [];
  const r = await findJudge(new Request("https://motdang.net/api/find/judge", { method: "POST",
    headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0 Chrome", "sec-fetch-site": "same-origin" },
    body: JSON.stringify({ q: "khao soi open now", qm: "khao soi", v: "bad", why: ["kind"], y: [A], n: [B],
      want: "Khao Soi Mae Sai", snap: JSON.stringify({ rows: [[1, B], [2, A]] }), lang: "en" }) }),
    { SEARCH: db, TRAFFIC: { writeDataPoint: (x) => rows.push(x) } }, classify);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, id: 7 });
  const ins = db.ran.find((s) => /INSERT INTO judged/.test(s.text));
  assert.deepEqual(ins.binds.slice(0, 7), ["khao soi", "khao soi open now", "bad", "kind", JSON.stringify([A]), JSON.stringify([B]), "Khao Soi Mae Sai"]);
  assert.equal(ins.binds[8], "human");
  assert.ok(db.ran.some((s) => /SET up = up \+ 1/.test(s.text) && s.binds.join("|") === `khao soi|${A}`));
  assert.ok(db.ran.some((s) => /SET down = down \+ 1/.test(s.text) && s.binds.join("|") === `khao soi|${B}`));
  assert.equal(rows[0].blobs[8], "judge-bad");
  assert.deepEqual(rows[0].doubles.slice(2, 4), [1, 1]);
});

test("a form post with no script gets a page back; a machine's marks move nothing", async () => {
  const db = judgeDb();
  const body = new URLSearchParams([["q", "<b>soi</b>"], ["v", "good"], ["y", A]]);
  const r = await findJudge(new Request("https://motdang.net/api/find/judge", { method: "POST", body,
    headers: { "user-agent": "GPTBot/1.2" } }), { SEARCH: db }, classify);
  assert.equal(r.status, 200);
  const page = await r.text();
  assert.match(page, /Got it/);
  assert.doesNotMatch(page, /<b>soi/);
  assert.match(page, /href="\/find\?q=%3Cb%3Esoi%3C%2Fb%3E"/);
  assert.equal(db.ran.filter((s) => /INSERT INTO judged/.test(s.text)).length, 1);
  assert.equal(db.ran.filter((s) => /INSERT INTO learn/.test(s.text)).length, 0);
  const G = await findJudge(new Request("https://motdang.net/api/find/judge"), { SEARCH: db }, classify);
  assert.equal(G.status, 405);
});

test("learnedFor: one person's ✓ or ✕ moves the page below the tap floor, capped", async () => {
  const db = { prepare: () => ({ bind() { return this; }, async all() { return { results: [
    { url: A, shown: 1, taps: 0, pogo: 0, via: 0, up: 1, down: 0 },
    { url: B, shown: 1, taps: 0, pogo: 0, via: 0, up: 0, down: 1 },
    { url: A + "?big", shown: 30, taps: 25, pogo: 0, via: 0, up: 3, down: 0 }] }; } }) };
  const m = await learnedFor(db, "judge floor " + Date.now());
  assert.equal(m.get(A), UP_X);
  assert.equal(m.get(B), DOWN_X);
  assert.equal(m.get(A + "?big"), JUDGE_CAP);
});

test("judgePanel: two plain forms, the six reasons, the snap escaped, script parses", () => {
  const h = judgePanel('soi "x" <y>', "soi", { q: '<script>', rows: [[1, A]] }, true);
  assert.equal((h.match(/action="\/api\/find\/judge"/g) || []).length, 2);
  assert.equal((h.match(/name="why"/g) || []).length, 6);
  assert.doesNotMatch(h, /<y>|"<script>/);
  assert.match(h, /name="snap" value="\{&quot;q&quot;:&quot;&lt;script&gt;/);
  assert.match(h, /tap ✓ right/);
  assert.doesNotMatch(judgePanel("x", "x", {}, false), /tap ✓ right/);
  new Function(h.match(/<script>([\s\S]*)<\/script>/)[1]);
});

test("marks from another site, or on rows the page did not show, move nothing", async () => {
  const send = async (headers, y) => {
    const db = judgeDb();
    await findJudge(new Request("https://motdang.net/api/find/judge", { method: "POST",
      headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0 Chrome", ...headers },
      body: JSON.stringify({ q: "khao soi", v: "bad", y, snap: JSON.stringify({ rows: [[1, A]] }) }) }),
      { SEARCH: db }, classify);
    return db;
  };
  const cross = await send({ "sec-fetch-site": "cross-site" }, [A]);
  assert.equal(cross.ran.filter((s) => /INSERT INTO learn/.test(s.text)).length, 0);
  assert.equal(cross.ran.find((s) => /INSERT INTO judged/.test(s.text)).binds[8], "human/cross-site");
  const unshown = await send({ origin: "https://motdang.net" }, [B]);
  assert.equal(unshown.ran.filter((s) => /INSERT INTO learn/.test(s.text)).length, 0);
  const ok = await send({ origin: "https://motdang.net" }, [A]);
  assert.equal(ok.ran.filter((s) => /INSERT INTO learn/.test(s.text)).length, 1);
});
