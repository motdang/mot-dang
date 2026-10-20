// accounts.js: sign in with LINE and saved things, against a real SQLite
// standing in for D1 and LINE's two endpoints stubbed.   node --test tests/test_accounts.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { accounts, safeBack, cookies } from "../publish/accounts.js";

const SQL = ["0006_accounts.sql", "0007_me.sql"].map((f) => readFileSync(new URL("../publish/migrations/" + f, import.meta.url), "utf8")).join("\n");
function d1() {
  const db = new DatabaseSync(":memory:");
  db.exec(SQL);
  const stmt = (text) => {
    let binds = [];
    return {
      bind(...b) { binds = b; return this; },
      async first() { return db.prepare(text).get(...binds) ?? null; },
      async run() { const r = db.prepare(text).run(...binds); return { success: true, meta: { changes: r.changes } }; },
      async all() { return { results: db.prepare(text).all(...binds) }; },
    };
  };
  return { db, prepare: stmt };
}
const ENV = (db) => ({ ACCOUNTS: db, LINE_LOGIN_ID: "1650000000", LINE_LOGIN_SECRET: "s3cret" });
const req = (path, init = {}) => new Request("https://motdang.net" + path, init);
const call = (env, path, init) => accounts(req(path, init), env, new URL("https://motdang.net" + path));
const cookieOf = (res, name) => {
  for (const [k, v] of res.headers) if (k === "set-cookie" && v.startsWith(name + "=")) return decodeURIComponent(v.split(";")[0].slice(name.length + 1));
  return null;
};

test("switched off without the LINE secrets", async () => {
  const r = await call({ ACCOUNTS: d1() }, "/auth/line");
  assert.equal(r.status, 503);
  assert.match(await r.text(), /not switched on yet/);
  const me = await (await call({ ACCOUNTS: d1() }, "/api/me")).json();
  assert.deepEqual(me, { signedIn: false, line: false });
});

test("a back address stays on the site", () => {
  assert.equal(safeBack("/map.html?go=MD-M3ZX4"), "/map.html?go=MD-M3ZX4");
  assert.equal(safeBack("//evil.example/x"), "/my.html");
  assert.equal(safeBack("https://evil.example/"), "/my.html");
  assert.equal(safeBack("/\\evil"), "/my.html");
});

test("sign in, save, read back, sign out", async () => {
  const db = d1(), env = ENV(db);
  const start = await call(env, "/auth/line?back=/map.html");
  assert.equal(start.status, 302);
  const loc = new URL(start.headers.get("location"));
  assert.equal(loc.origin + loc.pathname, "https://access.line.me/oauth2/v2.1/authorize");
  assert.equal(loc.searchParams.get("client_id"), "1650000000");
  assert.equal(loc.searchParams.get("redirect_uri"), "https://motdang.net/auth/line/callback");
  assert.equal(loc.searchParams.get("scope"), "profile openid");
  assert.equal(loc.searchParams.get("code_challenge_method"), "S256");
  assert.equal(loc.searchParams.get("bot_prompt"), "normal", "LINE's add-friend box on the consent screen");
  assert.ok(start.headers.get("location").includes("scope=profile%20openid"));
  const pending = cookieOf(start, "md-la");
  const pend = JSON.parse(pending);
  assert.equal(pend.state, loc.searchParams.get("state"));

  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, init) => {
    const body = Object.fromEntries(new URLSearchParams(init.body));
    sent.push([String(u), body]);
    if (String(u).endsWith("/token")) return new Response(JSON.stringify({ id_token: "idtok", access_token: "a" }));
    if (String(u).endsWith("/verify")) return new Response(JSON.stringify({ sub: "U1234", aud: "1650000000", name: "Nan", picture: "https://profile.line-scdn.net/x" }));
    throw new Error("unexpected " + u);
  };
  try {
    const cb = await call(env, `/auth/line/callback?code=abc&state=${pend.state}&friendship_status_changed=true`,
      { headers: { cookie: `md-la=${encodeURIComponent(pending)}` } });
    assert.equal(cb.status, 302);
    assert.equal(cb.headers.get("location"), "/my.html?welcome=1&back=%2Fmap.html#md-acct", "a first sign-in opens the welcome");
    assert.equal(db.db.prepare("SELECT friend FROM users").get().friend, 1, "ticked LINE's add-friend box");
    assert.equal(sent[0][1].code_verifier, pend.verifier);
    assert.equal(sent[0][1].client_secret, "s3cret");
    assert.equal(sent[1][1].nonce, pend.nonce);
    const token = cookieOf(cb, "md-s");
    assert.ok(token && token.length > 30);
    assert.equal(db.db.prepare("SELECT count(*) n FROM sessions WHERE hash = ?").get(token).n, 0, "the token itself is not stored");

    const ck = { cookie: `md-s=${token}` };
    const me = await (await call(env, "/api/me", { headers: ck })).json();
    assert.equal(me.signedIn, true);
    assert.equal(me.name, "Nan");
    assert.equal(me.friend, true);
    assert.equal(me.weekly, false);
    assert.match(me.u, /^[A-Za-z0-9_-]{16}$/, "an opaque mark of the account");

    const data = { keys: { "md-city": { v: "cm", t: 1 } }, saved: [{ k: "cm:tulou-restaurant-405600680", t: 2 }], gone: [] };
    const same = { ...ck, "sec-fetch-site": "same-origin" };
    const cross = await call(env, "/api/me/saved", { method: "PUT", headers: { ...ck, "sec-fetch-site": "cross-site" }, body: JSON.stringify({ data, ver: 0, acct: me.u }) });
    assert.equal(cross.status, 403);
    const put = await call(env, "/api/me/saved", { method: "PUT", headers: same, body: JSON.stringify({ data, ver: 0, acct: me.u }) });
    assert.equal(put.status, 200);
    assert.equal((await put.json()).ver, 1);
    const got = await (await call(env, "/api/me/saved", { headers: ck })).json();
    assert.deepEqual(got.data, data);
    assert.equal(got.ver, 1);
    // a second device merged from the same empty read: refused, reads again
    const stale = await call(env, "/api/me/saved", { method: "PUT", headers: same, body: JSON.stringify({ data: { keys: {} }, ver: 0, acct: me.u }) });
    assert.equal(stale.status, 409);
    const next = await call(env, "/api/me/saved", { method: "PUT", headers: same, body: JSON.stringify({ data, ver: 1, acct: me.u }) });
    assert.equal((await next.json()).ver, 2);
    // a tab still holding another account's things is refused
    const other = await call(env, "/api/me/saved", { method: "PUT", headers: same, body: JSON.stringify({ data, ver: 2, acct: "AAAAAAAAAAAAAAAA" }) });
    assert.equal(other.status, 409);
    assert.equal((await other.json()).error, "account");

    const anon = await call(env, "/api/me/saved", {});
    assert.equal(anon.status, 401);

    const out = await call(env, "/auth/logout", { method: "POST", headers: { ...ck, "sec-fetch-site": "same-origin" } });
    assert.equal(out.status, 200);
    assert.equal(cookieOf(out, "md-s"), "");
    const after = await (await call(env, "/api/me", { headers: ck })).json();
    assert.equal(after.signedIn, false);
  } finally { globalThis.fetch = realFetch; }
});

test("a wrong state, or a token for another channel, signs nobody in", async () => {
  const db = d1(), env = ENV(db);
  const start = await call(env, "/auth/line");
  const pending = cookieOf(start, "md-la"), pend = JSON.parse(pending);
  const bad = await call(env, `/auth/line/callback?code=abc&state=nope`, { headers: { cookie: `md-la=${encodeURIComponent(pending)}` } });
  assert.equal(bad.status, 400);
  // a back address forged into the cookie goes back to my.html
  const forged = JSON.stringify({ ...pend, back: "//evil.example/x" });
  const fb = await call(env, `/auth/line/callback?error=access_denied`, { headers: { cookie: `md-la=${encodeURIComponent(forged)}` } });
  assert.doesNotMatch(await fb.text(), /evil\.example/);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u) => String(u).endsWith("/token")
    ? new Response(JSON.stringify({ id_token: "idtok" }))
    : new Response(JSON.stringify({ sub: "U9", aud: "999" }));
  try {
    const other = await call(env, `/auth/line/callback?code=abc&state=${pend.state}`, { headers: { cookie: `md-la=${encodeURIComponent(pending)}` } });
    assert.equal(other.status, 400);
    assert.equal(cookieOf(other, "md-s"), null);
    assert.equal(db.db.prepare("SELECT count(*) n FROM users").get().n, 0);
  } finally { globalThis.fetch = realFetch; }
});

test("cookies parse", () => {
  assert.deepEqual(cookies(new Request("https://x/", { headers: { cookie: "a=1; md-s=abc%3D" } })), { a: "1", "md-s": "abc=" });
});
