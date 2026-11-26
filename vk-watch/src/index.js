/* vk-watch — Voight-Kampff's flood watch for motdang.net and hongdam.net.
 *
 * Nan, 2026-11-26: "ramp up actual capabilities for VK"; alerts to STATE.txt + the VK page,
 * Discord #app-and-site, and email to nan@.
 *
 * Every minute (cron) it reads the last five whole minutes of traffic_eye, the request log
 * both sites write, and compares each site with the median five minutes of the day before.
 *   flood on    five minutes over max(floor, 4 × median), or more than 20% turned away
 *               "too busy" (503) with at least half the floor
 *   flood off   ten minutes in a row back under
 * A flood gets a snapshot (networks, callers, pages, countries, statuses, connections, TLS
 * fingerprints, Cloudflare data centres, and Cloudflare's own edge view where the token can
 * read it) and a signature: its biggest network or caller plus its biggest page. A signature
 * not seen in the last 7 days sends one Discord message and one email; a repeat is logged
 * on the page without a ping.
 *
 *   GET /floods.json   the last 300 floods, any flood on now, each site's median and last five minutes
 *   GET /              the same, as plain text
 *
 * Secrets: CF_API_TOKEN (Account Analytics read; Zone Analytics read for the edge view),
 * DISCORD_WEBHOOK, RESEND_KEY. KV: VK.
 */

export const SITES = {
  "motdang.net": { floor: 3000, mult: 4, zone: "a9e92ea931cf4f5b085d8ce8c6a2ff15" },
  "hongdam.net": { floor: 2000, mult: 4, zone: "0e3837d602f6a9f2bc831026ec1b45d6" },
};
const ACCOUNT = "fe332688b1b25b543f8429d7f08292a3";
const N = "SUM(_sample_interval * double1)";
const QUIET_MIN = 10;          // minutes back under before a flood ends
const SEEN_DAYS = 7;           // a signature seen this recently does not ping again
const KEEP = 300;              // floods kept in /floods.json
const PAGE = "https://motdang.net/voight-kampff/#floods";

/* ── time ─────────────────────────────────────────────────────────────── */

const minute = (ms) => Math.floor(ms / 60000) * 60000;
const sqlTime = (ms) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");
const ict = (ms) => new Date(ms + 7 * 3600e3).toISOString().slice(0, 16).replace("T", " ");

/* ── reading ──────────────────────────────────────────────────────────── */

async function sql(env, q) {
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/analytics_engine/sql`, {
    method: "POST", headers: { Authorization: `Bearer ${env.CF_API_TOKEN}`, "Content-Type": "text/plain" }, body: q,
  });
  if (!r.ok) throw new Error(`sql ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return (await r.json()).data || [];
}

const hostsIn = () => "(" + Object.keys(SITES).map((h) => `'${h}'`).join(",") + ")";
const span = (a, b) => `timestamp >= toDateTime('${sqlTime(a)}') AND timestamp < toDateTime('${sqlTime(b)}')`;

/* the last five whole minutes, per site and minute */
export async function lastFive(env, now) {
  const b = minute(now) - 60000, a = b - 5 * 60000;
  const rows = await sql(env, `SELECT blob1 h, toStartOfMinute(timestamp) m, ${N} n,
    SUM(IF(blob6 = '503', _sample_interval * double1, 0.0)) s
    FROM traffic_eye WHERE blob1 IN ${hostsIn()} AND ${span(a, b)} GROUP BY h, m`);
  const out = {};
  for (const h of Object.keys(SITES)) out[h] = { n: 0, s: 0, per: [0, 0, 0, 0, 0], a, b };
  for (const r of rows) {
    const o = out[r.h]; if (!o) continue;
    const i = Math.round((Date.parse(r.m.replace(" ", "T") + "Z") - a) / 60000);
    o.n += r.n; o.s += r.s; if (i >= 0 && i < 5) o.per[i] = Math.round(r.n);
  }
  return out;
}

/* the median five minutes of the day before, refreshed hourly */
async function medians(env, now) {
  const got = await env.VK.get("base", "json");
  if (got && now - got.at < 3600e3) return got;
  const a = now - 24 * 3600e3;
  const rows = await sql(env, `SELECT blob1 h, toStartOfInterval(timestamp, INTERVAL '5' MINUTE) t, ${N} n
    FROM traffic_eye WHERE blob1 IN ${hostsIn()} AND ${span(a, now)} GROUP BY h, t`);
  const by = {};
  for (const r of rows) (by[r.h] ||= []).push(r.n);
  const base = { at: now };
  for (const h of Object.keys(SITES)) {
    const xs = (by[h] || []).sort((x, y) => x - y);
    while (xs.length < 288) xs.unshift(0);          // a quiet five minutes writes no row
    base[h] = Math.round(xs[Math.floor(xs.length / 2)]);
  }
  await env.VK.put("base", JSON.stringify(base));
  return base;
}

export function over(site, five, median) {
  const line = Math.max(site.floor, site.mult * median);
  const shed = five.n >= site.floor / 2 && five.s > 0.2 * five.n;
  return { line, hit: five.n > line || shed, shed };
}

/* ── the snapshot ─────────────────────────────────────────────────────── */

const DIMS = [
  ["networks", "blob15 k, blob16 l", "blob15 != ''"],
  ["callers", "blob3 k, blob2 l", ""],
  ["pages", "blob4 k, '' l", ""],
  ["countries", "blob5 k, '' l", ""],
  ["statuses", "blob6 k, '' l", ""],
  ["connections", "blob18 k, '' l", "blob18 != ''"],
  ["fingerprints", "blob19 k, blob3 l", "blob19 != ''"],
  ["colos", "blob17 k, '' l", "blob17 != ''"],
];

export async function snapshot(env, host, a, b) {
  const w = `blob1 = '${host}' AND double1 = 1 AND ${span(a, b)}`;
  const snap = { a, b };
  const total = await sql(env, `SELECT ${N} n FROM traffic_eye WHERE ${w}`);
  snap.total = Math.round(total[0]?.n || 0);
  for (const [name, sel, extra] of DIMS) {
    try {
      const rows = await sql(env, `SELECT ${sel}, ${N} n FROM traffic_eye WHERE ${w}${extra ? " AND " + extra : ""}
        GROUP BY k, l ORDER BY n DESC LIMIT 8`);
      snap[name] = rows.map((r) => [r.k, r.l, Math.round(r.n)]);
    } catch (e) { snap[name] = []; snap.errors = [...(snap.errors || []), `${name}: ${e.message}`]; }
  }
  snap.edge = await edge(env, host, a, b);
  return snap;
}

/* Cloudflare's own view: what it blocked or challenged before the site, by action and network.
 * Needs Zone Analytics read on CF_API_TOKEN; without it the snapshot says so. */
async function edge(env, host, a, b) {
  const q = `query($z:String!,$s:Time!,$e:Time!){viewer{zones(filter:{zoneTag:$z}){
    f:firewallEventsAdaptiveGroups(limit:10,orderBy:[count_DESC],filter:{datetime_geq:$s,datetime_lt:$e}){count dimensions{action source clientAsn clientASNDescription}}
    r:httpRequestsAdaptiveGroups(limit:10,orderBy:[count_DESC],filter:{datetime_geq:$s,datetime_lt:$e}){count dimensions{edgeResponseStatus}}}}}`;
  try {
    const r = await fetch("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST", headers: { Authorization: `Bearer ${env.CF_API_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: q, variables: { z: SITES[host].zone, s: new Date(a).toISOString(), e: new Date(b).toISOString() } }),
    });
    const d = await r.json();
    if (d.errors?.length) return { error: String(d.errors[0].message).includes("permission") ? "no permission" : String(d.errors[0].message).slice(0, 160) };
    const z = d.data?.viewer?.zones?.[0] || {};
    return {
      actions: (z.f || []).map((x) => [x.dimensions.action, x.dimensions.source, x.dimensions.clientAsn, x.dimensions.clientASNDescription, x.count]),
      statuses: (z.r || []).map((x) => [x.dimensions.edgeResponseStatus, x.count]),
    };
  } catch (e) { return { error: String(e.message).slice(0, 160) }; }
}

export function signature(snap) {
  const top = (xs) => (xs && xs[0] ? xs[0] : null);
  const net = top(snap.networks), who = top(snap.callers), page = top(snap.pages);
  const lead = net && snap.total && net[2] >= 0.3 * snap.total ? `AS${net[0]}` : who ? who[0] : "?";
  return `${lead} → ${page ? page[0] : "?"}`;
}

/* can a person still get the front page? one fetch a minute while a flood is on */
async function frontDoor(host) {
  const t = Date.now();
  try {
    const r = await fetch(`https://${host}/`, { headers: { "user-agent": "vk-watch (+https://motdang.net/voight-kampff/)" }, redirect: "manual" });
    await r.arrayBuffer();
    return { status: r.status, ms: Date.now() - t };
  } catch (e) { return { status: 0, ms: Date.now() - t, error: String(e.message).slice(0, 80) }; }
}

/* ── words ────────────────────────────────────────────────────────────── */

const c = (n) => Math.round(n).toLocaleString("en-US");
const pct = (x, t) => (t ? Math.round((100 * x) / t) + "%" : "–");

export function message(host, f) {
  const s = f.snap, t = s.total || f.five;
  const net = s.networks?.[0], who = s.callers?.[0], page = s.pages?.[0], cc = s.countries?.[0];
  const lines = [
    `🌊 Flood on ${host} · คลื่นคำขอที่ ${host}`,
    `${c(f.five)} requests in 5 min (median ${c(f.median)}) · turned away busy (503): ${pct(f.shed, f.five)}`,
    `Started ${ict(f.start)} ICT`,
  ];
  if (net) lines.push(`Top network: AS${net[0]} ${net[1]} · ${pct(net[2], t)}`);
  if (who) lines.push(`Top caller: ${who[0]} (${who[1]}) · ${pct(who[2], t)}`);
  if (page) lines.push(`Top page: ${page[0]} · ${pct(page[2], t)}`);
  if (cc) lines.push(`Top country: ${cc[0]} · ${pct(cc[2], t)}`);
  if (f.door) lines.push(`Front page now: ${f.door.status || "no answer"} in ${c(f.door.ms)} ms`);
  if (s.edge?.actions?.length) lines.push(`Cloudflare stopped: ${s.edge.actions.slice(0, 3).map((x) => `${x[0]} ${c(x[4])}`).join(", ")}`);
  lines.push(PAGE);
  return lines.join("\n");
}

async function alert(env, host, f) {
  const text = message(host, f);
  const sent = {};
  if (env.DISCORD_WEBHOOK) {
    try {
      const r = await fetch(env.DISCORD_WEBHOOK, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text, allowed_mentions: { parse: [] } }) });
      sent.discord = r.status;
    } catch (e) { sent.discord = String(e.message).slice(0, 80); }
  }
  if (env.RESEND_KEY) {
    try {
      const r = await fetch("https://api.resend.com/emails", { method: "POST",
        headers: { Authorization: `Bearer ${env.RESEND_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: "Voight-Kampff · มดแดง <nan@motdang.net>", to: ["nan@motdang.net"],
          subject: `VK: flood on ${host}, ${c(f.five)} requests in 5 min`, text }) });
      const d = await r.json().catch(() => ({}));
      sent.email = r.ok ? d.id || r.status : `${r.status} ${JSON.stringify(d).slice(0, 80)}`;
    } catch (e) { sent.email = String(e.message).slice(0, 80); }
  }
  return sent;
}

/* ── the minute ───────────────────────────────────────────────────────── */

export async function tick(env, now = Date.now()) {
  const [five, base] = await Promise.all([lastFive(env, now), medians(env, now)]);
  const seen = (await env.VK.get("seen", "json")) || {};
  let floods = null;
  const status = {};
  for (const [host, site] of Object.entries(SITES)) {
    const o = five[host], med = base[host] || 0, v = over(site, o, med);
    status[host] = { five: Math.round(o.n), shed: Math.round(o.s), median: med, line: v.line, per: o.per, at: o.b };
    let f = await env.VK.get(`on:${host}`, "json");
    if (v.hit) {
      if (!f) {
        f = { host, start: o.a, lastOver: o.b, five: Math.round(o.n), shed: Math.round(o.s), median: med, peak: Math.round(o.n), minutes: [...o.per] };
        f.snap = await snapshot(env, host, o.a, o.b);
        f.sig = signature(f.snap);
        f.door = await frontDoor(host);
        const last = seen[f.sig];
        f.repeat = !!(last && now - last < SEEN_DAYS * 86400e3);
        if (!f.repeat) f.sent = await alert(env, host, f);
        seen[f.sig] = now;
        await env.VK.put("seen", JSON.stringify(seen));
      } else {
        f.lastOver = o.b; f.peak = Math.max(f.peak, Math.round(o.n));
        f.minutes = [...f.minutes, o.per[4]].slice(-180);
        if (now - f.snap.b >= 5 * 60000) f.snap = await snapshot(env, host, f.start, o.b);
        f.door = await frontDoor(host);
      }
      await env.VK.put(`on:${host}`, JSON.stringify(f));
    } else if (f) {
      f.minutes = [...f.minutes, o.per[4]].slice(-180);
      if (o.b - f.lastOver >= QUIET_MIN * 60000) {
        f.end = f.lastOver;
        f.snap = await snapshot(env, host, f.start, f.end);
        floods ||= (await env.VK.get("floods", "json")) || [];
        floods.unshift(f);
        await env.VK.delete(`on:${host}`);
      } else {
        await env.VK.put(`on:${host}`, JSON.stringify(f));
      }
    }
  }
  if (floods) await env.VK.put("floods", JSON.stringify(floods.slice(0, KEEP)));
  await env.VK.put("status", JSON.stringify({ at: now, sites: status }));
  return status;
}

async function view(env) {
  const [floods, st] = await Promise.all([env.VK.get("floods", "json"), env.VK.get("status", "json")]);
  const on = [];
  for (const h of Object.keys(SITES)) { const f = await env.VK.get(`on:${h}`, "json"); if (f) on.push(f); }
  return { updated: st?.at || null, sites: st?.sites || {}, on, floods: floods || [] };
}

function text(v) {
  const out = [`Voight-Kampff flood watch · ${v.updated ? ict(v.updated) + " ICT" : "not run yet"}`, ""];
  for (const [h, s] of Object.entries(v.sites)) out.push(`${h}: ${c(s.five)} in the last 5 min · median ${c(s.median)} · line ${c(s.line)}`);
  out.push("", v.on.length ? "ON NOW" : "No flood on now.");
  for (const f of v.on) out.push(`  ${f.host} since ${ict(f.start)} · ${f.sig} · peak ${c(f.peak)}/5 min`);
  out.push("", `Floods logged: ${v.floods.length}`);
  for (const f of v.floods.slice(0, 20)) out.push(`  ${ict(f.start)}–${ict(f.end).slice(11)} ${f.host} · ${c(f.snap?.total || 0)} requests · ${f.sig}${f.repeat ? " · again" : ""}`);
  return out.join("\n") + "\n";
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(tick(env, event.scheduledTime).catch(async (e) => {
      await env.VK.put("error", JSON.stringify({ at: Date.now(), error: String(e.message).slice(0, 300) }));
    }));
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = { "access-control-allow-origin": "*", "cache-control": "public, max-age=30" };
    if (url.pathname === "/floods.json") {
      const v = await view(env);
      const err = await env.VK.get("error", "json");
      if (err && err.at > (v.updated || 0)) v.error = err;
      return new Response(JSON.stringify(v), { headers: { ...cors, "content-type": "application/json; charset=utf-8" } });
    }
    if (url.pathname === "/") return new Response(text(await view(env)), { headers: { ...cors, "content-type": "text/plain; charset=utf-8" } });
    return new Response("not here\n", { status: 404, headers: cors });
  },
};
