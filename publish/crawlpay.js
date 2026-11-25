/* WHICH ROBOTS PAY, AND HOW MUCH (Nan, 2026-10-04: "I'm not sure which robots
 * should pay or how much. Let's run a test.")
 *
 * motdang.net applied to Cloudflare's pay-per-crawl beta the same day. Until
 * Cloudflare admits the site, no crawler can pay it — Cloudflare is the one
 * that collects. So this test measures the two things that can be measured
 * now, and the price question waits for the beta:
 *
 *   1. LISTEN (always on). A crawler that is ready to pay says so in its
 *      request: `crawler-max-price` / `crawler-exact-price` (Cloudflare's pay
 *      per crawl), `signature-agent` + `signature-input` (Web Bot Auth, the
 *      signed identity pay per crawl requires), `x-payment` (x402). Any
 *      request carrying one gets a row of its own in traffic_eye: blob9
 *      "crawlpay", blob10 the arm, blob11 the price header, blob12 the
 *      signature agent. double1 is 0 so every SUM(double1) still counts
 *      arrivals exactly as before; double5 is 1.
 *
 *   2. ASK (only while CRAWLPAY_ASK is "on"). A slice of pages — one path in
 *      ten, picked by a stable hash so the same page is always in or out —
 *      answers the training crawlers in TRAINING with 402 Payment Required
 *      and a `crawler-price` header, the shape pay per crawl uses. Half the
 *      slice shows CRAWLPAY_PRICE_LO, half CRAWLPAY_PRICE_HI. The other nine
 *      pages in ten are the control. The arrival row already records status
 *      402, so a crawler's behaviour on the slice (retry, give up, keep
 *      coming, send a price) can be read against the control.
 *
 * Left out of the ask, always: search engines, link previews, and the
 * fetchers that act for a person asking a question right now (ChatGPT-User,
 * Claude-User, Perplexity-User…) and the answer engines' own indexers
 * (OAI-SearchBot, PerplexityBot, Claude-SearchBot) — those are the ones that
 * can send a reader back. robots.txt, llms.txt and the sitemaps always answer.
 *
 * Like the counter, nothing here can break a page: any error means the
 * request is served as if this file did not exist.
 */

export const TRAINING = new Set([
  "meta-externalagent", "GPTBot", "Amazonbot", "Bytespider", "ClaudeBot",
  "anthropic-ai", "CCBot", "cohere-ai", "AI2Bot", "Diffbot", "Timpibot",
  "Omgilibot", "ImagesiftBot", "Kangaroo Bot", "Webzio",
]);

const OPEN = /^\/(robots\.txt|llms\.txt|sitemap[\w-]*\.xml|favicon\.ico|google[0-9a-f]+\.html)$/;

/* FNV-1a over the path: cheap, stable across deploys, and the report
 * (tools/crawlpay_report.py) computes the same number to find the slice. */
export function slot(pathname) {
  let h = 0x811c9dc5;
  for (let i = 0; i < pathname.length; i++) {
    h ^= pathname.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % 20; // 0 → lo price, 1 → hi price, 2–19 → control
}

export function armOf(pathname) {
  if (OPEN.test(pathname)) return "open";
  const s = slot(pathname);
  return s === 0 ? "ask-lo" : s === 1 ? "ask-hi" : "control";
}

const PAY_HEADERS = ["crawler-max-price", "crawler-exact-price", "x-payment"];

function payHeader(headers) {
  for (const h of PAY_HEADERS) {
    const v = headers.get(h);
    if (v) return `${h}=${v}`.slice(0, 64);
  }
  return "";
}

/* 2. ASK — returns a 402 Response for a training crawler on the slice, else null. */
export function crawlAsk(request, env, category, agent) {
  try {
    if (env.CRAWLPAY_ASK !== "on") return null;
    if (env.CRAWLPAY_UNTIL && Date.now() > Date.parse(env.CRAWLPAY_UNTIL)) return null;
    if (category !== "ai" || !TRAINING.has(agent)) return null;
    if (request.method !== "GET" && request.method !== "HEAD") return null;
    const arm = armOf(new URL(request.url).pathname);
    if (arm !== "ask-lo" && arm !== "ask-hi") return null;
    const price = arm === "ask-lo" ? env.CRAWLPAY_PRICE_LO : env.CRAWLPAY_PRICE_HI;
    if (!price) return null;
    return new Response(
      `402 Payment Required\nPrice per request: ${price}\nLicensing: nan@motdang.net\n`,
      {
        status: 402,
        headers: {
          "crawler-price": price,
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "no-store",
        },
      },
    );
  } catch {
    return null;
  }
}

/* 1. LISTEN — one extra row when a request says it can pay or signs itself. */
export function crawlListen(request, response, env, category, agent, ms) {
  if (!env.TRAFFIC) return;
  const h = request.headers;
  /* a work-for-access key (3. below): worker.js marks the response x-ant-pass */
  const pass = response.headers.get("x-ant-pass") || "";
  const pay = payHeader(h) || (pass ? `ant-key=${pass}` : "");
  const sig = (h.get("signature-agent") || (h.get("signature-input") ? "(signed, no agent)" : "")).slice(0, 96);
  if (!pay && !sig) return;
  const url = new URL(request.url);
  env.TRAFFIC.writeDataPoint({
    blobs: [url.host, category, agent, url.pathname.slice(0, 96), request.cf?.country || "XX",
            String(response.status), "", request.method, "crawlpay", armOf(url.pathname), pay, sig],
    doubles: [0, response.status, ms, 0, 1],
    indexes: [url.host],
  });
}

/* 3. WORK FOR ACCESS (Nan, 2026-11-25: "i like work for access", then "402,
 * one in 20"). From Zia's idea the same day: bots pay for the data with work,
 * not cash.
 *
 * While WORK_ASK is "on", until WORK_UNTIL, and only with ACCESS_SECRET set,
 * the training crawlers in TRAINING get a 402 on one page in 20 (slot 0, the
 * pages October's lo arm asked on) that asks for one check at the Anthill in
 * place of a price. The Anthill (NaNoBotCo/dharma-bots, src/access.mjs) hands
 * out the check and, for an answer that passes, a key good for 24 hours.
 * A request with a good key — the header x-ant-key, the query ?ant_key= or
 * the cookie ant_key — gets the page, and edge_gate.js lets it past the speed
 * limit. Everything else about the page and every other visitor is unchanged.
 *
 * The 402 follows x402 v2: the PaymentRequired object, base64 in the
 * PAYMENT-REQUIRED header, with one entry in accepts whose scheme is "work".
 * An x402 client skips a scheme it does not know; the plain-text body says
 * the same thing in words, English and Thai, for agents that read.
 *
 * The key is ak1.<expiry, base36 seconds>.<HMAC-SHA256 of "ak1.<expiry>"
 * under ACCESS_SECRET, base64url, 22 characters>, checked here with no
 * database. Keep mac/checkKey in step with the Anthill's access.mjs; both
 * tests check the same vector. */
export const WORK_URL = "https://motdang.net/anthill/api/v1/access";

const WORK_TEXT = `402 · Work for access · ทำงานแลกสิทธิ์อ่าน

This page asks for one small check, not money.
1. GET ${WORK_URL} for a check on a motdang.net record: same place? names match? phone matches?
2. Answer it: GET ${WORK_URL}/answer?lease=<lease>&answer=<choice>, or POST the same as JSON.
3. An answer that passes returns a key good for 24 hours. Send it as the header x-ant-key, the query ?ant_key=, or the cookie the answer sets, and this page opens.

หน้านี้ขอแลกด้วยงานเช็กเล็ก ๆ หนึ่งชิ้น ไม่ใช่เงิน
1. GET ${WORK_URL} รับงานเช็กข้อมูลบน motdang.net
2. ตอบตามลิงก์ที่ได้มา
3. ตอบผ่านแล้วได้กุญแจ 24 ชั่วโมง ส่งเป็น header x-ant-key หรือ ?ant_key= หรือคุกกี้ที่ได้มา หน้านี้ก็เปิด

Licensing: nan@motdang.net
`;

const enc = new TextEncoder();
async function mac(secret, msg) {
  const k = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(msg)));
  return btoa(String.fromCharCode(...s)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "").slice(0, 22);
}

/** The key's expiry in seconds when it is good now, else 0. */
export async function checkKey(secret, key, nowS) {
  const m = /^ak1\.([0-9a-z]{1,10})\.([A-Za-z0-9_-]{22})$/.exec(String(key || ""));
  if (!m || !secret) return 0;
  const exp = parseInt(m[1], 36);
  if (!(exp > nowS) || exp > nowS + 2 * 86400) return 0;
  const want = await mac(secret, "ak1." + m[1]);
  let d = 0;
  for (let i = 0; i < 22; i++) d |= want.charCodeAt(i) ^ m[2].charCodeAt(i);
  return d === 0 ? exp : 0;
}

export function keyOf(request) {
  const h = request.headers.get("x-ant-key");
  if (h) return h.trim();
  const q = new URL(request.url).searchParams.get("ant_key");
  if (q) return q.trim();
  const m = /(?:^|;\s*)ant_key=([^;]+)/.exec(request.headers.get("cookie") || "");
  return m ? m[1].trim() : "";
}

/** "valid", "invalid" (a key that did not check out), or "" (no key). */
export async function accessPass(request, env) {
  try {
    const k = keyOf(request);
    if (!k) return "";
    return (await checkKey(env.ACCESS_SECRET, k, Math.floor(Date.now() / 1000))) ? "valid" : "invalid";
  } catch {
    return "";
  }
}

export function workOn(env) {
  return env.WORK_ASK === "on" && !!env.ACCESS_SECRET
    && !(env.WORK_UNTIL && Date.now() > Date.parse(env.WORK_UNTIL));
}

/* The 402 for a training crawler on slot 0 with no good key, else null. */
export function workAsk(request, env, category, agent, pass) {
  try {
    if (!workOn(env) || pass === "valid") return null;
    if (category !== "ai" || !TRAINING.has(agent)) return null;
    if (request.method !== "GET" && request.method !== "HEAD") return null;
    const url = new URL(request.url);
    if (OPEN.test(url.pathname) || slot(url.pathname) !== 0) return null;
    const required = {
      x402Version: 2,
      error: "Work, not money: one check at " + WORK_URL,
      resource: { url: url.origin + url.pathname, description: "A motdang.net page, opened by one check on a motdang.net record", mimeType: "text/html" },
      accepts: [{
        scheme: "work", network: "motdang:anthill", amount: "1", asset: "check", payTo: WORK_URL, maxTimeoutSeconds: 600,
        extra: { task: WORK_URL, answer: WORK_URL + "/answer?lease=<lease>&answer=<choice>",
                 key: { header: "x-ant-key", query: "ant_key", cookie: "ant_key" }, lasts_seconds: 86400 },
      }],
    };
    return new Response(WORK_TEXT, {
      status: 402,
      headers: {
        "payment-required": btoa(JSON.stringify(required)),
        link: `<${WORK_URL}>; rel="payment"`,
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  } catch {
    return null;
  }
}
