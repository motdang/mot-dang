// me.js: more for a reader signed in with LINE — the week on LINE and its Gold
// month, home alerts, send to my LINE, reminders, export, delete. SQLite stands
// in for both D1 databases; the LINE account's service binding is a stub.
//                                                         node --test tests/test_me.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { me, ownsMe, weeklyOnLine, giftCode } from "../publish/me.js";
import { sha256 } from "../publish/accounts.js";

const mig = (f) => readFileSync(new URL("../publish/migrations/" + f, import.meta.url), "utf8");
function d1(sql) {
  const db = new DatabaseSync(":memory:");
  db.exec(sql);
  const prepare = (text) => {
    let binds = [];
    return {
      bind(...b) { binds = b; return this; },
      async first() { return db.prepare(text).get(...binds) ?? null; },
      async run() { const r = db.prepare(text).run(...binds); return { success: true, meta: { changes: r.changes } }; },
      async all() { return { results: db.prepare(text).all(...binds) }; },
      _run() { return db.prepare(text).run(...binds); },
    };
  };
  return { db, prepare, async batch(list) { for (const s of list) s._run(); return []; } };
}
/* motdang-pages' tables, as far as the gift code goes */
const PAGES_SQL = `CREATE TABLE gift (code TEXT PRIMARY KEY, founder TEXT NOT NULL, made TEXT NOT NULL, site_id TEXT, used TEXT,
  months INTEGER NOT NULL DEFAULT 12, source TEXT); CREATE TABLE site (id TEXT PRIMARY KEY, name TEXT);`;

const UID = "U" + "1".repeat(32);
function botStub(friend = true) {
  const calls = [];
  const state = { friend, home: null, reminders: [] };
  const LINEBOT = new Proxy({}, { get: (_, fn) => async (...a) => {
    calls.push([fn, ...a]);
    if (fn === "status") return { friend: state.friend, home: state.home, alerts: true, push: true, reminders: state.reminders, selfLeft: 20 };
    if (fn === "setHome") { state.home = { lat: a[1], lng: a[2] }; return { ok: true, home: state.home }; }
    if (fn === "clearHome") { state.home = null; return { ok: true }; }
    if (fn === "toSelf") return state.friend ? { ok: true, left: 19 } : { error: "line" };
    if (fn === "remind") { state.reminders.push({ key: a[1], at: a[2], text: a[3] }); return { ok: true }; }
    if (fn === "unremind") { state.reminders = state.reminders.filter((r) => r.key !== a[1]); return { ok: true }; }
    if (fn === "weekly") return { asked: a[0].length, sent: a[0].length };
    return { ok: true };
  } });
  return { LINEBOT, calls, state };
}
async function setup(friend = true) {
  const acc = d1(mig("0006_accounts.sql") + mig("0007_me.sql") + mig("0008_gold_grants.sql"));
  acc.db.prepare("INSERT INTO users (line_sub, name) VALUES (?, 'NaN')").run(UID);
  acc.db.prepare("INSERT INTO sessions (hash, user_id, expires) VALUES (?, 1, datetime('now', '+1 day'))").run(await sha256("tok"));
  const pages = d1(PAGES_SQL);
  const bot = botStub(friend);
  return { env: { ACCOUNTS: acc, PAGES_DB: pages, LINEBOT: bot.LINEBOT }, acc, pages, bot };
}
const H = { cookie: "md-s=tok", "sec-fetch-site": "same-origin", "content-type": "application/json" };
const call = (env, path, body, headers = H) => {
  const url = new URL("https://motdang.net" + path);
  const init = body === undefined ? { headers } : { method: "POST", headers, body: JSON.stringify(body) };
  return me(new Request(url, init), env, url);
};

test("the paths it answers", () => {
  for (const p of ["more", "weekly", "home", "line", "remind", "export", "delete"]) assert.ok(ownsMe("/api/me/" + p));
  assert.ok(!ownsMe("/api/me") && !ownsMe("/api/me/saved"));
  assert.match(giftCode(), /^[a-z0-9]{10}$/, "the shape sites.motdang.net/g/ reads");
});

test("signed out, or from another site: refused", async () => {
  const { env } = await setup();
  assert.equal((await call(env, "/api/me/more", undefined, {})).status, 401);
  assert.equal((await call(env, "/api/me/weekly", { on: true }, { ...H, "sec-fetch-site": "cross-site" })).status, 403);
});

test("the week on LINE: a friend says yes and gets one Gold month code, once", async () => {
  const { env, acc, pages } = await setup(true);
  const r = await (await call(env, "/api/me/weekly", { on: true })).json();
  assert.equal(r.weekly, true);
  assert.match(r.gold.code, /^[a-z0-9]{10}$/);
  assert.equal(r.goldMonths, 1);
  const g = pages.db.prepare("SELECT * FROM gift").all();
  assert.equal(g.length, 1);
  assert.equal(g[0].months, 1);
  assert.equal(g[0].source, "line");
  // off and on again: the same code, no second one
  await call(env, "/api/me/weekly", { on: false });
  assert.equal(acc.db.prepare("SELECT weekly FROM users").get().weekly, 0);
  const again = await (await call(env, "/api/me/weekly", { on: true })).json();
  assert.equal(again.gold.code, r.gold.code);
  assert.equal(pages.db.prepare("SELECT COUNT(*) n FROM gift").get().n, 1);
  const more = await (await call(env, "/api/me/more")).json();
  assert.equal(more.weekly, true);
  assert.equal(more.gold.code, r.gold.code);
  assert.equal(more.gold.used, false);
});

test("the week on LINE before adding Mot Dang as a friend: asked to add it first, no code", async () => {
  const { env, pages } = await setup(false);
  const res = await call(env, "/api/me/weekly", { on: true });
  assert.equal(res.status, 409);
  const r = await res.json();
  assert.equal(r.needFriend, true);
  assert.equal(r.oa, "https://line.me/R/ti/p/@964yxgnk");
  assert.equal(pages.db.prepare("SELECT COUNT(*) n FROM gift").get().n, 0);
});

test("home for alerts: set, shown, cleared; nonsense refused", async () => {
  const { env, bot } = await setup();
  assert.equal((await call(env, "/api/me/home", { lat: "x" })).status, 400);
  await call(env, "/api/me/home", { lat: 18.788, lng: 98.993 });
  assert.deepEqual((await (await call(env, "/api/me/more")).json()).home, { lat: 18.788, lng: 98.993 });
  await call(env, "/api/me/home", { clear: true });
  assert.equal((await (await call(env, "/api/me/more")).json()).home, null);
  assert.deepEqual(bot.calls.find((c) => c[0] === "setHome"), ["setHome", UID, 18.788, 98.993]);
});

test("send to my LINE, and a reminder; not a friend: asked to add Mot Dang", async () => {
  const { env, bot } = await setup(true);
  const r = await (await call(env, "/api/me/line", { text: "Wat Phan Tao\nhttps://motdang.net/x" })).json();
  assert.equal(r.ok, true);
  assert.deepEqual(bot.calls.find((c) => c[0] === "toSelf"), ["toSelf", UID, "Wat Phan Tao\nhttps://motdang.net/x"]);
  const at = Date.now() + 3600e3;
  assert.equal((await call(env, "/api/me/remind", { key: "ev:x@1h", at, text: "x" })).status, 200);
  assert.equal((await (await call(env, "/api/me/more")).json()).reminders.length, 1);
  await call(env, "/api/me/remind", { key: "ev:x@1h", off: true });
  assert.equal((await (await call(env, "/api/me/more")).json()).reminders.length, 0);
  bot.state.friend = false;
  const nf = await call(env, "/api/me/line", { text: "x" });
  assert.equal(nf.status, 409);
  assert.equal((await nf.json()).needFriend, true);
});

test("export has the account and its saves; delete takes them all and asks the LINE account to forget", async () => {
  const { env, acc, bot } = await setup();
  acc.db.prepare("INSERT INTO saved (user_id, data) VALUES (1, ?)").run(JSON.stringify({ saved: [{ k: "cm:x" }] }));
  const ex = await call(env, "/api/me/export");
  assert.match(ex.headers.get("content-disposition"), /motdang-me\.json/);
  const j = await ex.json();
  assert.equal(j.account.name, "NaN");
  assert.deepEqual(j.saved, { saved: [{ k: "cm:x" }] });
  assert.equal((await call(env, "/api/me/delete", {})).status, 400, "needs { confirm: true }");
  const del = await call(env, "/api/me/delete", { confirm: true });
  assert.equal(del.status, 200);
  for (const t of ["users", "sessions", "saved"]) assert.equal(acc.db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n, 0, t);
  assert.ok(bot.calls.some((c) => c[0] === "forget" && c[1] === UID));
  assert.equal((await call(env, "/api/me/more")).status, 401);
});

test("delete and sign in again: the same Gold code, not a second one", async () => {
  const { env, acc, pages } = await setup(true);
  const first = (await (await call(env, "/api/me/weekly", { on: true })).json()).gold.code;
  await call(env, "/api/me/delete", { confirm: true });
  acc.db.prepare("INSERT INTO users (line_sub, name) VALUES (?, 'NaN')").run(UID);
  const id = acc.db.prepare("SELECT id FROM users").get().id;
  acc.db.prepare("INSERT INTO sessions (hash, user_id, expires) VALUES (?, ?, datetime('now', '+1 day'))").run(await sha256("tok"), id);
  const again = (await (await call(env, "/api/me/weekly", { on: true })).json()).gold.code;
  assert.equal(again, first);
  assert.equal(pages.db.prepare("SELECT COUNT(*) n FROM gift").get().n, 1);
});

test("the weekly issue on LINE: test IDs only until NEWSLETTER_LINE_LIVE, then everyone who said yes", async () => {
  const { env, acc, bot } = await setup();
  acc.db.prepare("INSERT INTO users (line_sub, name, weekly) VALUES (?, 'B', 1)").run("U" + "2".repeat(32));
  const t = await weeklyOnLine({ ...env, NEWSLETTER_LINE_TEST: UID }, "2026-10-26", "The week");
  assert.equal(t.live, false);
  assert.deepEqual(bot.calls.at(-1), ["weekly", [UID], "2026-10-26", "The week"]);
  const l = await weeklyOnLine({ ...env, NEWSLETTER_LINE_LIVE: "true" }, "2026-10-26", "The week");
  assert.equal(l.live, true);
  assert.deepEqual(bot.calls.at(-1)[1], ["U" + "2".repeat(32)]);
});
