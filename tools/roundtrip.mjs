#!/usr/bin/env node
/* Round trips on the live site, in a real browser (gemba 2, Nan 2026-10-20).
 *
 * The map's Copy link sent 0,0 and copied nothing, and it shipped and stayed
 * because nothing ever pressed it. This presses it: for a fixed place it
 * searches, opens, shares every way, opens what was shared, and checks it
 * lands on the same place. Headless Chrome through its DevTools socket —
 * Node's own WebSocket, nothing installed. The build server has no browser,
 * so this runs on the Mac against the live site (launchd
 * com.nanobotco.roundtrip, every two hours) and a failure goes to the top of
 * STATE.txt through ~/.claude/state/roundtrip-red.txt.
 *
 *   node tools/roundtrip.mjs            # all cases, exit 1 on a failure
 *   node tools/roundtrip.mjs --only map_google
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, appendFileSync, existsSync, unlinkSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";

const ORIGIN = "https://motdang.net";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9333;
const TULOU = { url: `${ORIGIN}/cm/p/tulou-restaurant-405600680.html`, id: "MD-M3ZX4", lat: 18.77473, lng: 98.98249 };
const GOOGLE = "https://www.google.com/maps/place/TULOU+Restaurant/@18.7747497,98.9824371,17z/data=!3m1!4b1!4m6!3m5!1s0x30da3071282a09db:0x6b7aaa947640db48!8m2!3d18.7747497!4d98.9824371";
const RED = join(homedir(), ".claude/state/roundtrip-red.txt");
const TSV = join(homedir(), ".claude/state/roundtrip.tsv");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---- a tiny DevTools client ---------------------------------------------- */
async function browser() {
  const dir = mkdtempSync(join(tmpdir(), "md-roundtrip-"));
  const proc = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`,
    "--no-first-run", "--no-default-browser-check", "--window-size=1200,900", "about:blank"], { stdio: "ignore" });
  let ver = null;
  for (let i = 0; i < 50 && !ver; i++) {
    await sleep(200);
    try { ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); } catch { /* not up yet */ }
  }
  if (!ver) { proc.kill(); throw new Error("Chrome did not start"); }
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; });
  let id = 0; const wait = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); } };
  const send = (method, params = {}, sessionId) => new Promise((ok, no) => {
    const n = ++id; wait.set(n, (d) => (d.error ? no(new Error(d.error.message)) : ok(d.result)));
    ws.send(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  return { send, close() { try { ws.close(); } catch { /* gone */ } proc.kill(); try { rmSync(dir, { recursive: true, force: true }); } catch { /* left */ } } };
}

async function page(b, url) {
  const { targetId } = await b.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await b.send("Target.attachToTarget", { targetId, flatten: true });
  const s = (m, p) => b.send(m, p, sessionId);
  await s("Page.enable"); await s("Runtime.enable");
  await s("Page.navigate", { url });
  const ev = async (expr) => {
    const r = await s("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "page error");
    return r.result.value;
  };
  /* poll an expression until it is truthy */
  const until = async (expr, ms = 45000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      try { const v = await ev(expr); if (v) return v; } catch { /* still loading */ }
      await sleep(400);
    }
    return null;
  };
  return { ev, until, close: () => b.send("Target.closeTarget", { targetId }) };
}

/* clipboard, share and the spot sheet, recorded instead of done */
const STUBS = `(() => { window.__rt = { copied: [], shared: [], spot: [] };
  try { navigator.clipboard.writeText = (t) => { __rt.copied.push(t); return Promise.resolve(); }; } catch (e) {}
  navigator.share = (d) => { __rt.shared.push(d); return Promise.resolve(); };
  if (window.MDSHAREPOINT) { const real = window.MDSHAREPOINT; window.MDSHAREPOINT = (a, b, o) => { __rt.spot.push([a, b]); }; }
  return true; })()`;
const CARD = `(document.querySelector('.mfsheet:not([hidden]) h2') || {}).textContent || ''`;

/* ---- the cases ------------------------------------------------------------ */
const CASES = {
  async find_name() {
    const d = await (await fetch(`${ORIGIN}/find?q=tulou&fmt=json`)).json();
    const top = (d.results || [])[0];
    return top && top.url === TULOU.url ? "" : `/find "tulou" put ${top ? top.url : "nothing"} first`;
  },
  async map_google(b) {
    const p = await page(b, `${ORIGIN}/map.html?go=${encodeURIComponent(GOOGLE)}`);
    try {
      const card = await p.until(`(${CARD}).includes('Tulou') && /MD-M3ZX4/.test(document.querySelector('.mfsheet:not([hidden])').textContent) && ${CARD}`);
      if (!card) return `the Google link did not open Tulou's card (card: "${await p.ev(CARD)}")`;
      await p.ev(STUBS);
      await p.ev(`document.querySelector('.mfsheet .mfsendrow .mfcopy').click(), true`);
      await sleep(400);
      const rt = await p.ev(`window.__rt`);
      if (rt.spot.length) return `Copy link opened the spot sheet with ${JSON.stringify(rt.spot[0])}`;
      if (rt.copied[0] !== `${ORIGIN}/map.html?go=${TULOU.id}`) return `Copy link copied ${JSON.stringify(rt.copied)}`;
      return "";
    } finally { await p.close(); }
  },
  async map_id(b) {
    const p = await page(b, `${ORIGIN}/map.html?go=${TULOU.id}`);
    try {
      const card = await p.until(`(${CARD}).includes('Tulou') && ${CARD}`);
      if (!card) return `?go=${TULOU.id} did not open Tulou`;
      const line = (await p.until(`(document.querySelector('.mfsheet:not([hidden]) a.line') || {}).href || ''`, 15000)) || "";
      return line.includes(encodeURIComponent(`go=${TULOU.id}`)) ? "" : `the LINE link does not carry ${TULOU.id}: ${line.slice(0, 120)}`;
    } finally { await p.close(); }
  },
  async map_name(b) {
    const p = await page(b, `${ORIGIN}/map.html?go=tulou`);
    try {
      return (await p.until(`(${CARD}).includes('Tulou') && ${CARD}`)) ? "" : `"tulou" in the map's box did not open Tulou (card: "${await p.ev(CARD)}")`;
    } finally { await p.close(); }
  },
  async map_point(b) {
    const p = await page(b, `${ORIGIN}/map.html?go=${TULOU.lat},${TULOU.lng}`);
    try {
      if (!(await p.until(`!!document.querySelector('.mfsheet:not([hidden]) button.mfsend')`)))
        return `coordinates did not open a point card (card: "${await p.ev(CARD)}")`;
      await p.ev(STUBS);
      await p.ev(`document.querySelector('.mfsheet:not([hidden]) button.mfsend').click(), true`);
      await sleep(300);
      const rt = await p.ev(`window.__rt`);
      const s = rt.spot[0];
      return s && Math.abs(s[0] - TULOU.lat) < 0.001 && Math.abs(s[1] - TULOU.lng) < 0.001 ? ""
        : `Send this spot sent ${JSON.stringify(s)}`;
    } finally { await p.close(); }
  },
  async place_share(b) {
    const p = await page(b, TULOU.url);
    try {
      if (!(await p.until(`!!document.querySelector('button.ls-float')`, 30000)))
        return "the place page did not load its Send button";
      await p.ev(STUBS);
      const opened = await p.ev(`(() => { const b = document.querySelector('button.ls-float'); if (!b) return false; b.click(); return true; })()`);
      if (!opened) return "no Send button on the place page";
      const picked = await p.until(`(() => { const o = [...document.querySelectorAll('button,a,[role=button]')].find((x) => /This whole page/.test(x.textContent)); if (!o) return false; o.click(); return true; })()`, 8000);
      if (!picked) return "the Send sheet has no \"This whole page\"";
      await sleep(400);
      const rt = await p.ev(`window.__rt`);
      const text = JSON.stringify(rt.shared[0] || rt.copied[0] || "");
      return text.includes("tulou-restaurant-405600680.html") ? "" : `"This whole page" sent ${text.slice(0, 160)}`;
    } finally { await p.close(); }
  },
};

/* ---- run ------------------------------------------------------------------ */
const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : null;
const names = Object.keys(CASES).filter((k) => !only || k === only);
const b = await browser();
const fails = [];
try {
  for (const k of names) {
    let why;
    try { why = await CASES[k](b); } catch (e) { why = `threw: ${String(e.message || e).slice(0, 160)}`; }
    console.log(`${why ? "FAIL" : "ok  "} ${k}${why ? " — " + why : ""}`);
    if (why) fails.push(`${k}: ${why}`);
  }
} finally { b.close(); }

const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
try {
  if (!existsSync(TSV)) writeFileSync(TSV, "when\tok\tfailed\n");
  appendFileSync(TSV, `${stamp}\t${names.length - fails.length}/${names.length}\t${fails.join(" | ")}\n`);
  if (!only) {
    if (fails.length) writeFileSync(RED, `motdang round trip ${stamp}: ${fails.length} broken — ${fails[0]} (node tools/roundtrip.mjs)\n`);
    else if (existsSync(RED)) unlinkSync(RED);
  }
} catch { /* the result is on the terminal either way */ }
process.exit(fails.length ? 1 : 0);
