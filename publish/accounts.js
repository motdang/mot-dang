/* ---- SIGN IN WITH LINE, AND SAVED THINGS ON EACH DEVICE (Nan, 2026-10-20) --
 * "yes you should be able to remember and save things. There should be good
 * saving functions. Might require a login." · C230 (c): "sign in with LINE".
 *
 * Saved places, the day plan, bookmarks, pinned shelves, notes, the chosen
 * city and the rest live in one browser's localStorage. Signed in with LINE,
 * a reader's copy is also kept here and every browser they sign in on pulls
 * it, merges, and pushes back (accounts_layer.py does the browser half).
 *
 *   GET  /auth/line            → LINE's sign-in page (PKCE, state, nonce)
 *   GET  /auth/line/callback   → code → token → verified ID token → session
 *   POST /auth/logout          → session ended, cookie cleared
 *   GET  /api/me               → { signedIn, name, picture }
 *   GET  /api/me/saved         → { data, at }
 *   PUT  /api/me/saved         → { data } in, { at } back
 *
 * The session is a random token in an HttpOnly cookie (md-s); the database
 * holds its SHA-256. LINE gives a user ID, a display name and a picture; no
 * email is asked for. Database motdang-accounts, binding ACCOUNTS
 * (migrations/0006_accounts.sql). Without the LINE_LOGIN_ID and
 * LINE_LOGIN_SECRET secrets /auth/line says it is not switched on yet. */

const AUTHORIZE = "https://access.line.me/oauth2/v2.1/authorize";
const TOKEN = "https://api.line.me/oauth2/v2.1/token";
const VERIFY = "https://api.line.me/oauth2/v2.1/verify";
const SESSION_DAYS = 180;
const SAVED_MAX = 262144;          // bytes of saved JSON per reader
const COOKIE = "md-s", PENDING = "md-la";

const enc = new TextEncoder();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const rand = (n = 32) => b64u(crypto.getRandomValues(new Uint8Array(n)));
export async function sha256(s) { return b64u(await crypto.subtle.digest("SHA-256", enc.encode(s))); }

export function cookies(request) {
  const out = {};
  for (const part of (request.headers.get("cookie") || "").split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i)] = decodeURIComponent(part.slice(i + 1));
  }
  return out;
}
const setCookie = (name, value, maxAge, path = "/") =>
  `${name}=${encodeURIComponent(value)}; Path=${path}; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;

const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra } });

/* A page back into the site after signing in: a same-site path, nothing else. */
export function safeBack(v) {
  const s = String(v || "");
  return /^\/(?!\/)[^\s\\]*$/.test(s) && s.length < 400 ? s : "/my.html";
}

function page(th, en, back = "/my.html", status = 200) {
  const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  return new Response(`<!DOCTYPE html><html lang="th"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(en)} · มดแดง</title>
<style>html{background:#fbf7ee;color:#1d1a16;font:17px/1.5 Georgia,Thonburi,serif}body{margin:0 auto;padding:2em 1rem;max-width:38em}</style>
</head><body><p>${esc(th)} · ${esc(en)}</p><p><a href="${esc(back)}">← มดแดง · Mot Dang</a></p></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

/* The reader behind this request's cookie, or null. */
export async function whoIs(request, env) {
  const t = cookies(request)[COOKIE];
  if (!t || !env.ACCOUNTS) return null;
  try {
    return await env.ACCOUNTS.prepare(
      `SELECT u.id, u.name, u.picture FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.hash = ? AND s.expires > datetime('now')`).bind(await sha256(t)).first();
  } catch { return null; }
}

/* A write from a motdang.net page only. */
function sameSite(request, url) {
  const site = request.headers.get("sec-fetch-site");
  if (site) return site === "same-origin";
  try { return new URL(request.headers.get("origin") || request.headers.get("referer") || "").host === url.host; }
  catch { return false; }
}

export async function accounts(request, env, url) {
  const p = url.pathname;
  const on = !!(env.LINE_LOGIN_ID && env.LINE_LOGIN_SECRET && env.ACCOUNTS);
  const callback = `${url.origin}/auth/line/callback`;

  if (p === "/auth/line") {
    if (!on) return page("การเข้าสู่ระบบด้วย LINE ยังไม่เปิด", "Sign in with LINE is not switched on yet", "/my.html", 503);
    const state = rand(16), nonce = rand(16), verifier = rand(48);
    const back = safeBack(url.searchParams.get("back"));
    const q = new URLSearchParams({
      response_type: "code", client_id: env.LINE_LOGIN_ID, redirect_uri: callback, state,
      scope: "profile openid", nonce, code_challenge: b64u(await crypto.subtle.digest("SHA-256", enc.encode(verifier))),
      code_challenge_method: "S256" });
    return new Response(null, { status: 302, headers: {
      location: `${AUTHORIZE}?${q.toString().replace(/\+/g, "%20")}`, "cache-control": "no-store",
      "set-cookie": setCookie(PENDING, JSON.stringify({ state, nonce, verifier, back }), 600, "/auth") } });
  }

  if (p === "/auth/line/callback") {
    if (!on) return page("การเข้าสู่ระบบด้วย LINE ยังไม่เปิด", "Sign in with LINE is not switched on yet", "/my.html", 503);
    let pend = null;
    try { pend = JSON.parse(cookies(request)[PENDING] || "null"); } catch { pend = null; }
    if (pend) pend.back = safeBack(pend.back);     // the cookie came back from the browser: checked again
    const clear = setCookie(PENDING, "", 0, "/auth");
    const fail = (th, en) => { const r = page(th, en, pend ? pend.back : "/my.html", 400); r.headers.append("set-cookie", clear); return r; };
    if (url.searchParams.get("error")) return fail("ยกเลิกการเข้าสู่ระบบ", "Sign-in was cancelled");
    if (!pend || !pend.state || url.searchParams.get("state") !== pend.state) return fail("ลิงก์เข้าสู่ระบบหมดอายุ ลองอีกครั้ง", "That sign-in link has expired — try again");
    const code = url.searchParams.get("code");
    if (!code) return fail("ไม่ได้รับรหัสจาก LINE", "LINE sent no code");
    let tok, who;
    try {
      tok = await (await fetch(TOKEN, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: callback,
          client_id: env.LINE_LOGIN_ID, client_secret: env.LINE_LOGIN_SECRET, code_verifier: pend.verifier }) })).json();
      if (!tok || !tok.id_token) throw new Error((tok && (tok.error_description || tok.error)) || "no id_token");
      who = await (await fetch(VERIFY, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ id_token: tok.id_token, client_id: env.LINE_LOGIN_ID, nonce: pend.nonce }) })).json();
      if (!who || !who.sub || String(who.aud) !== String(env.LINE_LOGIN_ID)) throw new Error((who && (who.error_description || who.error)) || "not verified");
    } catch (e) {
      console.log("line login", String(e && e.message || e).slice(0, 160));
      return fail("LINE ไม่ยืนยันการเข้าสู่ระบบ", "LINE did not confirm the sign-in");
    }
    const db = env.ACCOUNTS;
    const name = String(who.name || "").slice(0, 80), picture = String(who.picture || "").slice(0, 400);
    await db.prepare(`INSERT INTO users(line_sub, name, picture) VALUES (?, ?, ?)
      ON CONFLICT(line_sub) DO UPDATE SET name = excluded.name, picture = excluded.picture, last = datetime('now')`)
      .bind(who.sub, name, picture).run();
    const u = await db.prepare("SELECT id FROM users WHERE line_sub = ?").bind(who.sub).first();
    const token = rand(32);
    await db.prepare(`INSERT INTO sessions(hash, user_id, expires) VALUES (?, ?, datetime('now', '+${SESSION_DAYS} days'))`)
      .bind(await sha256(token), u.id).run();
    const r = new Response(null, { status: 302, headers: { location: pend.back || "/my.html", "cache-control": "no-store" } });
    r.headers.append("set-cookie", setCookie(COOKIE, token, SESSION_DAYS * 86400));
    r.headers.append("set-cookie", clear);
    return r;
  }

  if (p === "/auth/logout") {
    if (request.method !== "POST" || !sameSite(request, url)) return json({ error: "POST from a motdang.net page" }, 405);
    const t = cookies(request)[COOKIE];
    if (t && env.ACCOUNTS) { try { await env.ACCOUNTS.prepare("DELETE FROM sessions WHERE hash = ?").bind(await sha256(t)).run(); } catch { /* gone already */ } }
    return json({ ok: true }, 200, { "set-cookie": setCookie(COOKIE, "", 0) });
  }

  if (p === "/api/me") {
    const u = await whoIs(request, env);
    /* u: an opaque mark of the account, so a browser can tell when a
     * different person signs in on it (accounts_layer.py) */
    return json(u ? { signedIn: true, u: (await sha256("acct:" + u.id)).slice(0, 16), name: u.name,
                      picture: u.picture || undefined, line: on } : { signedIn: false, line: on });
  }

  if (p === "/api/me/saved") {
    const u = await whoIs(request, env);
    if (!u) return json({ error: "not signed in" }, 401);
    const db = env.ACCOUNTS;
    if (request.method === "GET") {
      const r = await db.prepare("SELECT data, at, ver FROM saved WHERE user_id = ?").bind(u.id).first();
      let data = {};
      try { data = r ? JSON.parse(r.data) : {}; } catch { data = {}; }
      return json({ data, at: r ? r.at : null, ver: r ? r.ver : 0 });
    }
    if (request.method === "PUT") {
      if (!sameSite(request, url)) return json({ error: "from a motdang.net page" }, 403);
      const text = await request.text();
      if (text.length > SAVED_MAX) return json({ error: "too big", max: SAVED_MAX }, 413);
      let d;
      try { d = JSON.parse(text); } catch { return json({ error: "not JSON" }, 400); }
      if (!d || typeof d !== "object" || Array.isArray(d) || typeof d.data !== "object" || Array.isArray(d.data)
          || !Number.isInteger(d.ver) || d.ver < 0)
        return json({ error: "{ data: {...}, ver: <the ver it was merged from> }" }, 400);
      /* A copy merged from an older read is refused, so two devices saving at
       * once cannot overwrite each other: the second reads again and merges. */
      const body = JSON.stringify(d.data);
      const up = await db.prepare(`UPDATE saved SET data = ?, at = datetime('now'), ver = ver + 1
                                   WHERE user_id = ? AND ver = ?`).bind(body, u.id, d.ver).run();
      if (!(up.meta && up.meta.changes) && d.ver === 0) {
        const ins = await db.prepare(`INSERT OR IGNORE INTO saved(user_id, data, at, ver) VALUES (?, ?, datetime('now'), 1)`)
          .bind(u.id, body).run();
        if (ins.meta && ins.meta.changes) return json({ ok: true, ver: 1 });
      } else if (up.meta && up.meta.changes) {
        return json({ ok: true, ver: d.ver + 1 });
      }
      return json({ error: "stale", hint: "read again, merge, send" }, 409);
    }
    return json({ error: "GET or PUT" }, 405);
  }
  return null;
}
