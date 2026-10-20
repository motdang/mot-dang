/* ---- MORE FOR A READER SIGNED IN WITH LINE (Nan, 2026-10-20) --------------
 * "I'd like to build out many more personalization and convenience features
 * that you can access in motdang with a LINE signin. Let's also offer some
 * kind of newsletter or offer to people who opt in at signup." Her pick: the
 * week on Mot Dang on LINE each Monday, and a free Gold month on their own
 * sites.motdang.net page.
 *
 *   GET  /api/me/more      friend, the weekly issue, home, reminders, the Gold code
 *   POST /api/me/weekly    {on}            the week on LINE; the first yes gives a Gold month
 *   POST /api/me/home      {lat,lng} | {clear}   the place river and dust alerts watch
 *   POST /api/me/line      {text}          send a page, a place, a plan to my own LINE
 *   POST /api/me/remind    {key,at,text} | {key,off}   one LINE message at `at`
 *   GET  /api/me/export    all of it, as JSON
 *   POST /api/me/delete    the account, its saves and what the LINE account keeps
 *
 * Pushes go through the Mot Dang LINE account (motdang-line, src/site.js),
 * reached by the LINEBOT service binding; it keeps the monthly count. The Gold
 * code is a row in motdang-pages' gift table (PAGES_DB), months = 1, redeemed
 * at sites.motdang.net/g/<code> like a founder's. */

import { whoIs } from "./accounts.js";

export const OA = "https://line.me/R/ti/p/@964yxgnk";
const GOLD_MONTHS = 1;

const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra } });

function sameSite(request, url) {
  const site = request.headers.get("sec-fetch-site");
  if (site) return site === "same-origin";
  try { return new URL(request.headers.get("origin") || request.headers.get("referer") || "").host === url.host; }
  catch { return false; }
}

async function body(request) {
  const t = await request.text();
  if (t.length > 8192) return null;
  try { const d = JSON.parse(t); return d && typeof d === "object" && !Array.isArray(d) ? d : null; } catch { return null; }
}

async function bot(env, fn, ...args) {
  if (!env.LINEBOT) return { error: "nobot" };
  try { return await env.LINEBOT[fn](...args); } catch (e) { console.log("linebot", fn, String(e && e.message || e).slice(0, 160)); return { error: "bot" }; }
}

/* ten letters and digits, the shape sites.motdang.net/g/ reads */
export function giftCode() {
  const a = "abcdefghijkmnpqrstuvwxyz23456789", b = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(b, (x) => a[x % a.length]).join("");
}

async function goldFor(env, u) {
  if (u.gold_code) return u.gold_code;
  if (!env.PAGES_DB) return null;
  const code = giftCode();
  await env.PAGES_DB.prepare("INSERT INTO gift (code, founder, made, months, source) VALUES (?, '', ?, ?, 'line')")
    .bind(code, new Date().toISOString(), GOLD_MONTHS).run();
  const set = await env.ACCOUNTS.prepare("UPDATE users SET gold_code = ? WHERE id = ? AND gold_code IS NULL").bind(code, u.id).run();
  if (set.meta && set.meta.changes) return code;
  /* a second tab got there first: theirs stands, this one goes */
  await env.PAGES_DB.prepare("DELETE FROM gift WHERE code = ? AND used IS NULL").bind(code).run();
  return (await env.ACCOUNTS.prepare("SELECT gold_code FROM users WHERE id = ?").bind(u.id).first())?.gold_code || null;
}

async function goldState(env, code) {
  if (!code || !env.PAGES_DB) return code ? { code } : null;
  try {
    const g = await env.PAGES_DB.prepare("SELECT g.used, s.name FROM gift g LEFT JOIN site s ON s.id = g.site_id WHERE g.code = ?").bind(code).first();
    return { code, used: !!(g && g.used), page: g && g.name || undefined };
  } catch { return { code }; }
}

async function row(env, id) {
  return env.ACCOUNTS.prepare("SELECT id, line_sub, name, picture, created, friend, weekly, weekly_at, gold_code FROM users WHERE id = ?").bind(id).first();
}

export function ownsMe(pathname) {
  return /^\/api\/me\/(more|weekly|home|line|remind|export|delete)$/.test(pathname);
}

export async function me(request, env, url) {
  const p = url.pathname.slice("/api/me/".length);
  const who = await whoIs(request, env);
  if (!who) return json({ error: "not signed in" }, 401);
  const u = await row(env, who.id);
  if (!u) return json({ error: "not signed in" }, 401);
  const post = request.method === "POST";
  if (post && !sameSite(request, url)) return json({ error: "from a motdang.net page" }, 403);

  if (p === "more" && request.method === "GET") {
    const s = await bot(env, "status", u.line_sub);
    if (s && typeof s.friend === "boolean" && (s.friend ? 1 : 0) !== u.friend)
      await env.ACCOUNTS.prepare("UPDATE users SET friend = ? WHERE id = ?").bind(s.friend ? 1 : 0, u.id).run();
    return json({
      friend: s && typeof s.friend === "boolean" ? s.friend : !!u.friend, oa: OA,
      weekly: !!u.weekly, gold: await goldState(env, u.weekly ? u.gold_code : null), goldMonths: GOLD_MONTHS,
      home: s && s.home || null, alerts: !!(s && s.alerts), push: !!(s && s.push),
      reminders: s && s.reminders || [], selfLeft: s && Number.isFinite(s.selfLeft) ? s.selfLeft : 0,
    });
  }

  if (p === "weekly" && post) {
    const d = await body(request);
    if (!d || typeof d.on !== "boolean") return json({ error: "{ on: true|false }" }, 400);
    if (!d.on) {
      await env.ACCOUNTS.prepare("UPDATE users SET weekly = 0 WHERE id = ?").bind(u.id).run();
      return json({ ok: true, weekly: false });
    }
    const s = await bot(env, "status", u.line_sub);
    const friend = s && s.friend === true;
    if (!friend) return json({ ok: false, needFriend: true, oa: OA }, 409);
    await env.ACCOUNTS.prepare("UPDATE users SET weekly = 1, friend = 1, weekly_at = COALESCE(weekly_at, datetime('now')) WHERE id = ?").bind(u.id).run();
    const code = await goldFor(env, u);
    return json({ ok: true, weekly: true, gold: await goldState(env, code), goldMonths: GOLD_MONTHS });
  }

  if (p === "home" && post) {
    const d = await body(request);
    if (!d) return json({ error: "{ lat, lng } or { clear: true }" }, 400);
    if (d.clear) return json(await bot(env, "clearHome", u.line_sub));
    const lat = Number(d.lat), lng = Number(d.lng);
    if (!(Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) return json({ error: "{ lat, lng }" }, 400);
    return json(await bot(env, "setHome", u.line_sub, lat, lng));
  }

  if (p === "line" && post) {
    const d = await body(request);
    const text = d && String(d.text || "").trim();
    if (!text) return json({ error: "{ text }" }, 400);
    const r = await bot(env, "toSelf", u.line_sub, text.slice(0, 2000));
    if (r && r.ok) return json(r);
    if (r && r.error === "line") {
      const s = await bot(env, "status", u.line_sub);
      if (s && s.friend === false) return json({ ok: false, needFriend: true, oa: OA }, 409);
    }
    return json(r || { error: "bot" }, 429);
  }

  if (p === "remind" && post) {
    const d = await body(request);
    const key = d && String(d.key || "").slice(0, 120);
    if (!key) return json({ error: "{ key, at, text } or { key, off: true }" }, 400);
    if (d.off) return json(await bot(env, "unremind", u.line_sub, key));
    const s = await bot(env, "status", u.line_sub);
    if (s && s.friend === false) return json({ ok: false, needFriend: true, oa: OA }, 409);
    const r = await bot(env, "remind", u.line_sub, key, Number(d.at), String(d.text || "").slice(0, 1500));
    return json(r, r && r.ok ? 200 : 400);
  }

  if (p === "export" && request.method === "GET") {
    const saved = await env.ACCOUNTS.prepare("SELECT data, at FROM saved WHERE user_id = ?").bind(u.id).first();
    let data = null; try { data = saved ? JSON.parse(saved.data) : null; } catch { data = saved && saved.data; }
    const s = await bot(env, "status", u.line_sub);
    return json({
      exported: new Date().toISOString(),
      account: { name: u.name, picture: u.picture || null, created: u.created, line_user_id: u.line_sub },
      weekly: !!u.weekly, weekly_since: u.weekly_at, gold: await goldState(env, u.gold_code),
      saved: data, saved_at: saved ? saved.at : null,
      line: s && !s.error ? { friend: s.friend, home: s.home, reminders: s.reminders } : null,
    }, 200, { "content-disposition": 'attachment; filename="motdang-me.json"' });
  }

  if (p === "delete" && post) {
    const d = await body(request);
    if (!d || d.confirm !== true) return json({ error: "{ confirm: true }" }, 400);
    await bot(env, "forget", u.line_sub);
    await env.ACCOUNTS.batch([
      env.ACCOUNTS.prepare("DELETE FROM sessions WHERE user_id = ?").bind(u.id),
      env.ACCOUNTS.prepare("DELETE FROM saved WHERE user_id = ?").bind(u.id),
      env.ACCOUNTS.prepare("DELETE FROM users WHERE id = ?").bind(u.id),
    ]);
    return json({ ok: true }, 200, { "set-cookie": "md-s=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax" });
  }

  return json({ error: "not here" }, 405);
}

/* The weekly issue on LINE, from /newsletter/send (newsletter.js). Unless
 * NEWSLETTER_LINE_LIVE is "true" it goes only to the LINE user IDs in
 * NEWSLETTER_LINE_TEST. */
export async function weeklyOnLine(env, issue, text) {
  if (!env.ACCOUNTS || !env.LINEBOT) return { skipped: "ACCOUNTS or LINEBOT binding missing" };
  const live = env.NEWSLETTER_LINE_LIVE === "true";
  let uids;
  if (live) uids = ((await env.ACCOUNTS.prepare("SELECT line_sub FROM users WHERE weekly = 1").all()).results || []).map((r) => r.line_sub);
  else uids = String(env.NEWSLETTER_LINE_TEST || "").split(",").map((s) => s.trim()).filter(Boolean);
  const r = await bot(env, "weekly", uids, issue, text);
  return { live, readers: uids.length, ...r };
}


