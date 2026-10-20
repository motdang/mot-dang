/* The weekly issue: sending it, and leaving the list.
 *
 *   POST /newsletter/send          bearer NEWSLETTER_TOKEN; body {issue, subject, text, html}
 *   GET  /subscribe/unsubscribe    ?token= — a page with one button
 *   POST /subscribe/unsubscribe    ?token= — the button, and RFC 8058 one-click
 *
 * importers/make_newsletter.py builds the issue from data/events.json and POSTs
 * it here, because the Resend key lives only in this Worker's secrets.
 *
 * THE SEND GATE is env.NEWSLETTER_LIVE. Unless it reads exactly "true", the
 * issue goes only to the addresses in env.NEWSLETTER_TEST (comma-separated) and
 * the confirmed list is left alone. Each (issue, address) is written to
 * newsletter_sends before its mail goes, so a second POST of the same issue
 * skips everyone already sent to.
 *
 * {{UNSUB}} in text and html is replaced, per address, with that subscriber's
 * own unsubscribe link (their confirm token, already the unsubscribe key in
 * 0001_subscribers.sql). A test address with no row gets the list page instead.
 */

import { weeklyOnLine } from "./me.js";

const FROM = "nan@motdang.net";
const SENDER_NAME = "Mot Dang · มดแดง";
const BATCH = 100;   // Resend's batch endpoint takes up to 100 messages a call

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function page(status, title, body) {
  return new Response(`<!doctype html><html lang="th"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${title}</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 16px}
button{font:inherit;padding:.5rem 1rem}</style></head><body>${body}</body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const goodToken = (t) => /^[a-f0-9]{8,64}$/.test(String(t || ""));

export async function unsubscribeToken(db, token, now) {
  if (!goodToken(token)) return { ok: false };
  const res = await db.prepare(
    `UPDATE subscribers SET status = 'unsubscribed', perks = json_set(perks, '$.unsubscribed_at', ?) WHERE token = ? AND status != 'unsubscribed'`
  ).bind(now, token).run();
  if (res && res.meta && res.meta.changes) return { ok: true, already: false };
  const row = await db.prepare(`SELECT status FROM subscribers WHERE token = ?`).bind(token).first();
  return row ? { ok: true, already: true } : { ok: false };
}

async function handleUnsubscribe(request, env, url) {
  if (!env.SUBSCRIBERS) return page(503, "Not ready", "<p>Not ready.</p>");
  const token = url.searchParams.get("token");
  if (request.method === "GET" || request.method === "HEAD") {
    if (!goodToken(token)) return page(400, "Unsubscribe", "<p>This link is not complete.</p>");
    return page(200, "Unsubscribe · เลิกรับ",
      `<h1>เลิกรับจดหมายข่าว · Unsubscribe</h1>
<form method="post" action="/subscribe/unsubscribe?token=${esc(token)}"><button>เลิกรับ · Unsubscribe</button></form>`);
  }
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { allow: "GET, POST, HEAD" } });
  const res = await unsubscribeToken(env.SUBSCRIBERS, token, new Date().toISOString());
  if (!res.ok) return page(400, "Unsubscribe", "<p>This link is not complete.</p>");
  return page(200, "Unsubscribed · เลิกรับแล้ว", "<h1>เลิกรับแล้ว · Unsubscribed</h1><p>No more issues will come to this address.</p>");
}

export function recipients(env, rows) {
  const live = env.NEWSLETTER_LIVE === "true";
  if (live) return { live, to: rows.map((r) => ({ email: r.email, token: r.token })) };
  const test = String(env.NEWSLETTER_TEST || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const byEmail = new Map(rows.map((r) => [r.email, r.token]));
  return { live, to: test.map((e) => ({ email: e, token: byEmail.get(e) || null })) };
}

export function personalise(issue, origin, rcpt) {
  const unsub = rcpt.token ? `${origin}/subscribe/unsubscribe?token=${rcpt.token}` : `${origin}/subscribe`;
  return {
    from: `${SENDER_NAME} <${FROM}>`,
    to: [rcpt.email],
    subject: issue.subject,
    text: String(issue.text).split("{{UNSUB}}").join(unsub),
    html: issue.html ? String(issue.html).split("{{UNSUB}}").join(esc(unsub)) : undefined,
    headers: { "List-Unsubscribe": `<${unsub}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  };
}

async function handleSend(request, env, url) {
  const auth = request.headers.get("authorization") || "";
  if (!env.NEWSLETTER_TOKEN || auth !== "Bearer " + env.NEWSLETTER_TOKEN) return new Response("not found", { status: 404 });
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { allow: "POST" } });
  let issue;
  try { issue = await request.json(); } catch { return json({ ok: false, reason: "bad-json" }, 400); }
  if (!issue || !/^\d{4}-\d{2}-\d{2}$/.test(issue.issue || "") || !issue.subject || !issue.text)
    return json({ ok: false, reason: "issue, subject and text are required" }, 400);
  /* The same issue on LINE to readers who said yes when signed in (me.js);
   * issue.line is its LINE text, else the plain text with the leaving link
   * pointed at My page. */
  const line = await weeklyOnLine(env, issue.issue,
    String(issue.line || issue.text).split("{{UNSUB}}").join(`${url.origin}/my.html#md-acct`)).catch((e) => ({ error: String(e && e.message || e) }));
  if (!env.SUBSCRIBERS) return json({ ok: false, reason: "no-db", line }, 503);
  if (!env.RESEND_KEY) return json({ ok: false, reason: "no-resend-key", line }, 503);

  const db = env.SUBSCRIBERS;
  const rows = (await db.prepare(`SELECT email, token FROM subscribers WHERE status = 'confirmed'`).all()).results || [];
  const { live, to } = recipients(env, rows);
  const done = new Set(((await db.prepare(`SELECT email FROM newsletter_sends WHERE issue = ?`)
    .bind(issue.issue).all()).results || []).map((r) => r.email));
  const todo = to.filter((r) => !done.has(r.email));

  let sent = 0;
  const failed = [];
  for (let i = 0; i < todo.length; i += BATCH) {
    const chunk = todo.slice(i, i + BATCH);
    const now = new Date().toISOString();
    await db.batch(chunk.map((r) => db.prepare(
      `INSERT OR IGNORE INTO newsletter_sends (issue, email, at, live) VALUES (?, ?, ?, ?)`
    ).bind(issue.issue, r.email, now, live ? 1 : 0)));
    const r = await fetch("https://api.resend.com/emails/batch", {
      method: "POST",
      headers: { authorization: `Bearer ${env.RESEND_KEY}`, "content-type": "application/json" },
      body: JSON.stringify(chunk.map((rc) => personalise(issue, url.origin, rc))),
    });
    if (r.ok) sent += chunk.length;
    else {
      const why = await r.text().catch(() => "");
      failed.push({ n: chunk.length, status: r.status, why: why.slice(0, 300) });
      await db.batch(chunk.map((rc) => db.prepare(`DELETE FROM newsletter_sends WHERE issue = ? AND email = ?`)
        .bind(issue.issue, rc.email)));
    }
  }
  return json({ ok: failed.length === 0, live, issue: issue.issue, confirmed: rows.length,
                already: to.length - todo.length, sent, failed, line });
}

export function ownsNewsletter(pathname) {
  return pathname === "/newsletter/send" || pathname === "/subscribe/unsubscribe";
}

export async function newsletter(request, env, url) {
  if (url.pathname === "/newsletter/send") return handleSend(request, env, url);
  return handleUnsubscribe(request, env, url);
}
