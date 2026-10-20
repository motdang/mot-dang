/* ---- WHAT READERS TAP ON /find, AND WHAT THE RANKING LEARNS (Nan, 2026-10-04) --
 * "both search and AI should learn from user behavior both before and after a
 * response is given."
 *
 * The results page sends one beacon when the reader leaves it (findLearnJs
 * below): the query, the results ranked above the deepest one tapped (at
 * least the top three — a reader who tapped the 7th looked at the six above
 * it; one who tapped nothing looked at the top), each tap with its rank and
 * how long after the page appeared, and the query this tab asked just before,
 * when it asked one in the last five minutes. Coming back to the results is a
 * second beacon with the time spent away: under POGO_MS that tap is a miss.
 *
 * Two places it lands:
 *   traffic_eye — one row per event (blob4 "/api/find", blob8 "FIND"), with
 *     the people/machines column, like the map and share rows. double1 is 0.
 *   motdang-search D1 — three small tables beside the index, counted only for
 *     people (classify() says "human"): learn (query key × url: shown, taps,
 *     pogo, via, dwell), learn_q (per query key: views, views with a tap,
 *     reformulations), learn_pair (query key → the query asked next).
 *     A row holds a normalised query and a page address; nothing about the
 *     reader. fleetsearch/learn.sql makes them.
 *
 * The ranking reads learn back (learnedFor) and lifts a page by at most
 * LIFT_MAX of its own score — never past a title-match tier — and only once
 * the evidence floor is met. learnLift() is the formula; white-label-ai's
 * src/learn.js carries the same one for the assistant. */

export const FLOOR_SHOWN = 20;     // impressions before a page can move
export const FLOOR_TAPS = 3;       // people's taps (quick returns taken off) before a page can move
export const PRIOR = 0.10;         // a smoothed click-through rate starts here
export const PRIOR_N = 10;         // … with the weight of this many impressions
export const FULL_AT = 0.50;       // smoothed rate at which the lift is whole
export const POGO_MS = 10000;      // back on the results this soon = the tap did not answer
export const LIFT_MAX = 0.25;      // /find: bm25 × (1 + LIFT_MAX × s); a title tier is × 2 or × 3

const STOP = new Set(["the", "a", "an", "and", "or", "of", "in", "at", "on", "for", "to", "is", "are", "me", "my",
  "i", "near", "nearby", "around", "where", "can", "what", "whats", "which", "best", "good", "find", "please",
  "ใกล้", "แถว", "แถวนี้", "ที่ไหน", "ไหน", "ดี", "หา", "อยาก", "มี", "ไหม"]);
const TH_HEAD = /^(?:ร้านอาหาร|ร้าน|อาหาร)+(?=[฀-๿])/;

/* The words of a query, folded so "Khao Soi", "khao  soi!" and "soi khao"
 * share one row. Thai runs stay whole (no spaces to split on), with a leading
 * ร้าน taken off so ร้านข้าวซอย and ข้าวซอย meet. */
export function learnKey(q) {
  const toks = String(q || "").normalize("NFKC").toLowerCase()
    .replace(/[​-‏﻿]/g, "")
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ").trim().split(" ")
    .map((t) => t.replace(TH_HEAD, ""))
    .filter((t) => t && !STOP.has(t));
  return Array.from(new Set(toks)).sort().join(" ").slice(0, 80);
}

/* 0…1: how far a page's people-only record lifts it. 0 below the floor.
 *   good  = taps − quick returns (+ half a tap per "via", + 2 per thumbs-up)
 *   seen  = impressions (+ 2 per thumbs-down, + 1 per rephrased miss)
 *   rate  = (good + PRIOR × PRIOR_N) / (seen + PRIOR_N)
 *   lift  = clamp((rate − PRIOR) / (FULL_AT − PRIOR), 0, 1)                 */
export function learnLift(r) {
  if (!r) return 0;
  const shown = Number(r.shown) || 0;
  const real = Math.max(0, (Number(r.taps) || 0) - (Number(r.pogo) || 0));
  if (shown < FLOOR_SHOWN || real < FLOOR_TAPS) return 0;
  const good = real + 0.5 * (Number(r.via) || 0) + 2 * (Number(r.up) || 0);
  const seen = shown + 2 * (Number(r.down) || 0) + (Number(r.miss) || 0);
  const rate = (good + PRIOR * PRIOR_N) / (seen + PRIOR_N);
  return Math.max(0, Math.min(1, (rate - PRIOR) / (FULL_AT - PRIOR)));
}

/* ---------------------------------------------------------------- the beacon */

const EVENTS = new Set(["leave", "back"]);
const URLRE = /^https:\/\/[a-z0-9.-]{3,80}\/[^\s"<>]{0,240}$/i;
const okUrl = (u) => (typeof u === "string" && URLRE.test(u) ? u : "");
const num = (v, lo, hi) => (Number.isFinite(+v) ? Math.max(lo, Math.min(hi, Math.round(+v))) : 0);

export async function findSense(request, env, classify) {
  const done = new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  if (request.method !== "POST") return done;
  let d;
  try {
    const text = await request.text();
    if (!text || text.length > 6144) return done;
    d = JSON.parse(text);
  } catch { return done; }
  if (!d || !EVENTS.has(d.e)) return done;
  const qk = learnKey(d.q);
  if (!qk) return done;
  const url = new URL(request.url);
  const { category, agent } = classify(request.headers.get("user-agent") || "",
    { asn: request.cf?.asn, headers: request.headers });
  const pqk = d.pq ? learnKey(d.pq) : "";
  const shown = (Array.isArray(d.shown) ? d.shown : []).slice(0, 10).map(okUrl).filter(Boolean);
  const taps = (Array.isArray(d.taps) ? d.taps : []).slice(0, 5)
    .map((t) => ({ u: okUrl(t && t.u), r: num(t && t.r, 0, 1000), ms: num(t && t.ms, 0, 36e5) })).filter((t) => t.u);
  const back = d.e === "back" ? { u: okUrl(d.u), ms: num(d.ms, 0, 864e5) } : null;
  if (back && !back.u) return done;

  const row = (e, u, ms, rank) => {
    if (!env.TRAFFIC) return;
    let short = "";
    try { const x = new URL(u); short = (x.host + x.pathname).slice(0, 96); } catch { /* none */ }
    env.TRAFFIC.writeDataPoint({
      blobs: [url.host, category, agent, "/api/find", request.cf?.country || "XX", "204", "(same site)",
              "FIND", e, qk.slice(0, 64), short, pqk.slice(0, 64)],
      doubles: [0, 204, ms, rank, 1],
      indexes: [url.host],
    });
  };
  try {
    if (back) row("back", back.u, back.ms, 0);
    else {
      if (shown.length || !taps.length) row(taps.length ? "view" : "view-none", "", 0, shown.length);
      for (const t of taps) row("tap", t.u, t.ms, t.r);
    }
  } catch { /* counting is never worth an error */ }

  /* The learning store counts people only. A machine's taps are in
   * traffic_eye with its own label and never move a ranking. */
  if (category !== "human" || !env.SEARCH) return done;
  const db = env.SEARCH;
  const up = (cols) => db.prepare(
    `INSERT INTO learn(qk, url, ${Object.keys(cols).join(", ")}) VALUES (?, ?, ${Object.keys(cols).map(() => "?").join(", ")})
     ON CONFLICT(qk, url) DO UPDATE SET ${Object.keys(cols).map((k) => `${k} = ${k} + excluded.${k}`).join(", ")}, last = datetime('now')`);
  const stmts = [];
  try {
    if (back) {
      const pogo = back.ms < POGO_MS ? 1 : 0;
      stmts.push(up({ pogo: 0, dwell_ms: 0, dwell_n: 0 }).bind(qk, back.u, pogo, Math.min(back.ms, 6e5), 1));
    } else {
      for (const u of shown) stmts.push(up({ shown: 0 }).bind(qk, u, 1));
      for (const t of taps) {
        stmts.push(up({ taps: 0, rank_sum: 0 }).bind(qk, t.u, 1, t.r));
        /* A tap after a rephrase also tells the earlier query what it should
         * have found: half a tap, as "via". */
        if (pqk && pqk !== qk) stmts.push(up({ via: 0 }).bind(pqk, t.u, 1));
      }
      if (d.first) {
        stmts.push(db.prepare(
          `INSERT INTO learn_q(qk, views, tapped, reform) VALUES (?, 1, ?, 0)
           ON CONFLICT(qk) DO UPDATE SET views = views + 1, tapped = tapped + excluded.tapped, last = datetime('now')`)
          .bind(qk, taps.length ? 1 : 0));
        if (pqk && pqk !== qk) {
          stmts.push(db.prepare(
            `INSERT INTO learn_pair(qk, next, n) VALUES (?, ?, 1)
             ON CONFLICT(qk, next) DO UPDATE SET n = n + 1, last = datetime('now')`).bind(pqk, qk));
          if (!d.pqt) stmts.push(db.prepare(
            `INSERT INTO learn_q(qk, views, tapped, reform) VALUES (?, 0, 0, 1)
             ON CONFLICT(qk) DO UPDATE SET reform = reform + 1, last = datetime('now')`).bind(pqk));
        }
      } else if (taps.length && d.ft) {
        stmts.push(db.prepare("UPDATE learn_q SET tapped = tapped + 1 WHERE qk = ? AND tapped < views").bind(qk));
      }
    }
    if (stmts.length) await db.batch(stmts);
  } catch (e) {
    /* The index may be mid-reload (D1 holds it during an import) or the
     * tables not made yet: the beacon is dropped, the reader never knows. */
    console.log("findSense", String(e && e.message || e).slice(0, 120));
  }
  return done;
}

/* ------------------------------------------------------------ reading it back */

const LEARNED = new Map();
const LEARNED_TTL = 10 * 60 * 1000;
const LEARNED_MAX = 500;

/* url → multiplier for this query: pages over the floor, and pages a person
 * marked ✓ or ✕ for these words (judgeMult). Empty map when nothing
 * qualifies or the tables are not there (the local twin). */
export async function learnedFor(db, q) {
  const qk = learnKey(q);
  const out = new Map();
  if (!qk || !db) return out;
  const hit = LEARNED.get(qk);
  if (hit && Date.now() - hit.at < LEARNED_TTL) return hit.map;
  try {
    const r = await db.prepare(
      `SELECT url, shown, taps, pogo, via, up, down FROM learn WHERE qk = ?
         AND ((shown >= ? AND taps - pogo >= ?) OR up > 0 OR down > 0)
       ORDER BY taps + up DESC LIMIT 24`).bind(qk, FLOOR_SHOWN, FLOOR_TAPS).all();
    for (const row of r.results || []) {
      const m = Math.min(JUDGE_CAP, (1 + LIFT_MAX * learnLift(row)) * judgeMult(row.up, row.down));
      if (m !== 1) out.set(row.url, Math.round(m * 1000) / 1000);
    }
  } catch { /* no table, or the index is busy: rank as before */ }
  if (LEARNED.size >= LEARNED_MAX) LEARNED.delete(LEARNED.keys().next().value);
  LEARNED.set(qk, { at: Date.now(), map: out });
  return out;
}

/* ---- A READER'S WORD ON ONE RESULTS PAGE (Nan, 2026-10-20) -----------------
 * "Would like to provide feedback directly after a bad search. … simple for
 * users and provide machines with the kind of data they need to do better."
 *
 * The page (judgePanel in fleetsearch.js) posts one form to /api/find/judge:
 *   q, qm the words as typed, and as matched (intent words lifted out)
 *   v     good | bad
 *   why   what went wrong, any of WHY
 *   y, n  addresses of rows marked ✓ (this one) and ✕ (wrong)
 *   want  the reader's own words for what they were after: a name, a Maps
 *         link, a description
 *   snap  the page as it was built: the words, the match that answered, the
 *         loosening note, the intent lifted, the shelf door, the ten rows
 *         with their ranks, the total. Same for every reader of a cached page.
 * One row per send in motdang-search `judged` (fleetsearch/learn.sql), read
 * by fleetsearch/judged.py, which turns them into cases a change to the
 * ranking is scored against. A person's ✓/✕ also lands in learn.up/down and
 * moves that query's order at once (judgeMult); a machine's is kept in
 * `judged` with its label and moves nothing. */

export const WHY = ["missing", "kind", "far", "closed", "buried", "words"];
export const UP_X = 1 + LIFT_MAX;   // ✓ outnumbers ✕ for these words: × 1.25, as a full tap lift
export const DOWN_X = 0.6;          // ✕ outnumbers ✓: × 0.6, down the list, never out of it
export const JUDGE_CAP = 1 + 2 * LIFT_MAX;   // taps and ✓ together stay under a title tier (× 2)

export function judgeMult(up, down) {
  const u = Number(up) || 0, d = Number(down) || 0;
  return u > d ? UP_X : d > u ? DOWN_X : 1;
}

const clip = (s, n) => String(s == null ? "" : s).replace(/[\u0000-\u001f]+/g, " ").trim().slice(0, n);
const escH = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/* The fields of one send, from a form post (no script) or JSON (the page's
 * own fetch). Anything malformed is dropped, not refused. */
export function judgeFields(d) {
  const all = (k) => [].concat(d[k] == null ? [] : d[k]);
  const urls = (k) => Array.from(new Set(all(k).map(okUrl).filter(Boolean))).slice(0, 10);
  let snap = "";
  try { const s = JSON.parse(String(d.snap || "")); if (s && typeof s === "object") snap = JSON.stringify(s).slice(0, 8000); } catch { /* none */ }
  return {
    q: clip(d.q, 200),
    qm: clip(d.qm, 200),
    v: d.v === "good" ? "good" : "bad",
    why: all("why").filter((w) => WHY.includes(w)).filter((w, i, a) => a.indexOf(w) === i),
    y: urls("y"),
    n: urls("n"),
    want: clip(d.want, 600),
    lang: d.lang === "en" || d.lang === "th" ? d.lang : "",
    snap,
  };
}

export async function findJudge(request, env, classify) {
  const url = new URL(request.url);
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } });
  const ct = request.headers.get("content-type") || "";
  const viaForm = !/json/i.test(ct);
  let d = {};
  try {
    if (viaForm) {
      const fd = await request.formData();
      for (const k of new Set(fd.keys())) d[k] = fd.getAll(k).map(String);
      for (const k of ["q", "qm", "v", "want", "snap", "lang"]) if (Array.isArray(d[k])) d[k] = d[k][0];
    } else {
      const text = await request.text();
      if (text.length > 16384) throw new Error("big");
      d = JSON.parse(text) || {};
    }
  } catch { d = {}; }
  const f = judgeFields(d);
  /* Keyed by the words the ranking matched (intent words lifted out), the key
   * learnedFor reads back. */
  const qk = learnKey(f.qm) || learnKey(f.q);
  const { category, agent } = classify(request.headers.get("user-agent") || "",
    { asn: request.cf?.asn, headers: request.headers });
  let id = 0;
  if (qk) {
    try {
      env.TRAFFIC && env.TRAFFIC.writeDataPoint({
        blobs: [url.host, category, agent, "/api/find", request.cf?.country || "XX", "200", "(same site)",
                "FIND", `judge-${f.v}`, qk.slice(0, 64), f.why.join(","), ""],
        doubles: [0, 200, f.y.length, f.n.length, 1],
        indexes: [url.host],
      });
    } catch { /* counting is never worth an error */ }
    if (env.SEARCH) {
      const db = env.SEARCH;
      try {
        const r = await db.prepare(
          `INSERT INTO judged(qk, q, verdict, why, yes, no, want, snap, who, agent, country, lang)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`)
          .bind(qk, f.q, f.v, f.why.join(","), JSON.stringify(f.y), JSON.stringify(f.n), f.want, f.snap,
                category, String(agent || "").slice(0, 40), request.cf?.country || "", f.lang).first();
        id = (r && r.id) || 0;
        if (category === "human" && (f.y.length || f.n.length)) {
          const mark = (col) => db.prepare(
            `INSERT INTO learn(qk, url, ${col}) VALUES (?, ?, 1)
             ON CONFLICT(qk, url) DO UPDATE SET ${col} = ${col} + 1, last = datetime('now')`);
          await db.batch([...f.y.map((u) => mark("up").bind(qk, u)), ...f.n.map((u) => mark("down").bind(qk, u))]);
          LEARNED.delete(qk);
        }
      } catch (e) {
        console.log("findJudge", String(e && e.message || e).slice(0, 120));
      }
    }
  }
  if (!viaForm) {
    return new Response(JSON.stringify({ ok: !!qk, id }), { status: 200, headers: {
      "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
  }
  /* No script on the reader's side: a page that says it arrived and leads back. */
  const back = `/find?q=${encodeURIComponent(f.q)}`;
  return new Response(`<!DOCTYPE html><html lang="th"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>ได้รับแล้ว · Got it · มดแดง</title>
<style>html{background:#fbf7ee;color:#1d1a16;font:17px/1.5 Georgia,Thonburi,serif}body{margin:0 auto;padding:2em 1rem;max-width:38em}</style>
</head><body><p>ได้รับแล้ว · Got it.</p><p><a href="${escH(back)}">← ${escH(f.q || "ค้นหา · search")}</a></p></body></html>`,
    { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
