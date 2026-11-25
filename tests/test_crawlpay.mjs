// node tests/test_crawlpay.mjs — the crawl test's arms, ask and listen.
import assert from "node:assert/strict";
import { armOf, slot, crawlAsk, crawlListen, TRAINING, workAsk, accessPass, checkKey, keyOf, WORK_URL } from "../publish/crawlpay.js";
import { sendToRules } from "../publish/edge_gate.js";

const req = (path, ua, h = {}) => new Request("https://motdang.net" + path, { headers: { "user-agent": ua, ...h } });
const ON = { CRAWLPAY_ASK: "on", CRAWLPAY_PRICE_LO: "USD 0.001", CRAWLPAY_PRICE_HI: "USD 0.01" };

// arms: stable, about one in ten asked, open paths never
assert.equal(armOf("/robots.txt"), "open");
assert.equal(armOf("/sitemap-1.xml"), "open");
assert.equal(slot("/cm/p/x.html"), slot("/cm/p/x.html"));
let asked = 0; const N = 20000;
for (let i = 0; i < N; i++) if (armOf(`/cm/p/place-${i}.html`).startsWith("ask")) asked++;
assert.ok(asked / N > 0.08 && asked / N < 0.12, `asked share ${asked / N}`);

const askPath = [...Array(500).keys()].map(i => `/cm/p/p${i}.html`).find(p => armOf(p) === "ask-hi");
const ctlPath = [...Array(500).keys()].map(i => `/cm/p/p${i}.html`).find(p => armOf(p) === "control");

// ask: training crawler on the slice gets 402 + crawler-price
let r = crawlAsk(req(askPath, "GPTBot"), ON, "ai", "GPTBot");
assert.equal(r.status, 402);
assert.equal(r.headers.get("crawler-price"), "USD 0.01");
// control page, person-triggered fetcher, search engine, off switch, missing price: no 402
assert.equal(crawlAsk(req(ctlPath, "GPTBot"), ON, "ai", "GPTBot"), null);
assert.equal(crawlAsk(req(askPath, "ChatGPT-User"), ON, "ai", "ChatGPT-User"), null);
assert.equal(crawlAsk(req(askPath, "OAI-SearchBot"), ON, "ai", "OAI-SearchBot"), null);
assert.equal(crawlAsk(req(askPath, "Googlebot"), ON, "search", "Googlebot"), null);
assert.equal(crawlAsk(req(askPath, "GPTBot"), { ...ON, CRAWLPAY_ASK: "off" }, "ai", "GPTBot"), null);
assert.equal(crawlAsk(req(askPath, "GPTBot"), { ...ON, CRAWLPAY_PRICE_HI: "" }, "ai", "GPTBot"), null);
assert.equal(crawlAsk(new Request("https://motdang.net" + askPath, { method: "POST", headers: { "user-agent": "GPTBot" } }), ON, "ai", "GPTBot"), null);
assert.equal(crawlAsk(req(askPath, "GPTBot"), { ...ON, CRAWLPAY_UNTIL: "2020-01-01T00:00:00Z" }, "ai", "GPTBot"), null);
assert.equal(crawlAsk(req(askPath, "GPTBot"), { ...ON, CRAWLPAY_UNTIL: "2099-01-01T00:00:00Z" }, "ai", "GPTBot").status, 402);
assert.ok(!TRAINING.has("OAI-SearchBot") && !TRAINING.has("ChatGPT-User"));

// listen: a row only when a request says it can pay or signs itself
const rows = []; const env = { TRAFFIC: { writeDataPoint: d => rows.push(d) } };
crawlListen(req(ctlPath, "GPTBot"), new Response("x"), env, "ai", "GPTBot", 3);
assert.equal(rows.length, 0);
crawlListen(req(askPath, "GPTBot", { "crawler-max-price": "USD 0.005" }), new Response("x", { status: 402 }), env, "ai", "GPTBot", 3);
crawlListen(req(ctlPath, "ChatGPT-User", { "signature-agent": '"https://chatgpt.com"', "signature-input": "sig1=()" }), new Response("x"), env, "ai", "ChatGPT-User", 3);
assert.equal(rows.length, 2);
assert.deepEqual(rows[0].blobs.slice(8, 11), ["crawlpay", "ask-hi", "crawler-max-price=USD 0.005"]);
assert.equal(rows[0].doubles[0], 0); // arrivals unchanged
assert.equal(rows[1].blobs[11], '"https://chatgpt.com"');
crawlListen(req(ctlPath, "GPTBot", { "x-payment": "abc" }), new Response("x"), {}, "ai", "GPTBot", 3); // no binding: no throw
// work for access (Nan 2026-11-25): a 402 asking for one check, on one page in 20
const W = { WORK_ASK: "on", ACCESS_SECRET: "vector-secret", WORK_UNTIL: "2099-01-01T00:00:00Z" };
const paths = [...Array(2000).keys()].map(i => `/cm/p/w${i}.html`);
const workPath = paths.find(p => slot(p) === 0), otherPath = paths.find(p => slot(p) === 1);
assert.ok(paths.filter(p => slot(p) === 0).length / paths.length > 0.03 && paths.filter(p => slot(p) === 0).length / paths.length < 0.07);
let w = workAsk(req(workPath, "GPTBot"), W, "ai", "GPTBot", "");
assert.equal(w.status, 402);
assert.equal(w.headers.get("link"), `<${WORK_URL}>; rel="payment"`);
const required = JSON.parse(atob(w.headers.get("payment-required")));
assert.equal(required.x402Version, 2);
assert.equal(required.accepts[0].scheme, "work");
assert.equal(required.resource.url, "https://motdang.net" + workPath);
assert.match(await w.text(), /ทำงานแลกสิทธิ์อ่าน[\s\S]*x-ant-key/);
// a good key opens it; other pages, person fetchers, search, POST, off, no secret, past the end: no 402
assert.equal(workAsk(req(workPath, "GPTBot"), W, "ai", "GPTBot", "valid"), null);
assert.equal(workAsk(req(workPath, "GPTBot"), W, "ai", "GPTBot", "invalid").status, 402);
assert.equal(workAsk(req(otherPath, "GPTBot"), W, "ai", "GPTBot", ""), null);
assert.equal(workAsk(req(workPath, "ChatGPT-User"), W, "ai", "ChatGPT-User", ""), null);
assert.equal(workAsk(req(workPath, "OAI-SearchBot"), W, "ai", "OAI-SearchBot", ""), null);
assert.equal(workAsk(req(workPath, "Googlebot"), W, "search", "Googlebot", ""), null);
assert.equal(workAsk(req("/robots.txt", "GPTBot"), W, "ai", "GPTBot", ""), null);
assert.equal(workAsk(new Request("https://motdang.net" + workPath, { method: "POST", headers: { "user-agent": "GPTBot" } }), W, "ai", "GPTBot", ""), null);
assert.equal(workAsk(req(workPath, "GPTBot"), { ...W, WORK_ASK: "off" }, "ai", "GPTBot", ""), null);
assert.equal(workAsk(req(workPath, "GPTBot"), { ...W, ACCESS_SECRET: "" }, "ai", "GPTBot", ""), null);
assert.equal(workAsk(req(workPath, "GPTBot"), { ...W, WORK_UNTIL: "2020-01-01T00:00:00Z" }, "ai", "GPTBot", ""), null);
// the key: the vector the Anthill's test checks too, and the three ways to send it
assert.equal(await checkKey("vector-secret", "ak1.tro8w0.ZtpGexWmge1V0KBtpnKuma", 1_800_000_000 - 60), 1_800_000_000);
assert.equal(await checkKey("vector-secret", "ak1.tro8w0.ZtpGexWmge1V0KBtpnKumb", 1_800_000_000 - 60), 0);
assert.equal(await checkKey("vector-secret", "ak1.tro8w0.ZtpGexWmge1V0KBtpnKuma", 1_800_000_000), 0);
assert.equal(keyOf(req("/x", "a", { "x-ant-key": " k1 " })), "k1");
assert.equal(keyOf(new Request("https://motdang.net/x?ant_key=k2")), "k2");
assert.equal(keyOf(req("/x", "a", { cookie: "a=b; ant_key=k3; c=d" })), "k3");
assert.equal(await accessPass(req("/x", "a"), W), "");
assert.equal(await accessPass(req("/x", "a", { "x-ant-key": "nonsense" }), W), "invalid");
// listen: a key's use gets a row, marked by worker.js's x-ant-pass
rows.length = 0;
crawlListen(req(workPath, "GPTBot", { "x-ant-key": "k" }), new Response("x", { headers: { "x-ant-pass": "valid" } }), env, "ai", "GPTBot", 3);
assert.equal(rows.length, 1);
assert.equal(rows[0].blobs[10], "ant-key=valid");
// the hammer count: a good key goes past it; probes are still sent
const tool = (p) => new Request("https://motdang.net" + p, { headers: { "user-agent": "python-requests/2.31", "cf-connecting-ip": "9.9.9.9" } });
let sent = 0; for (let i = 0; i < 25; i++) if (sendToRules(tool(`/cm/p/h${i}.html`))) sent++;
assert.ok(sent > 0, "no key: hammering is sent to the rules");
const tool2 = (p) => new Request("https://motdang.net" + p, { headers: { "user-agent": "python-requests/2.31", "cf-connecting-ip": "8.8.8.8" } });
sent = 0; for (let i = 0; i < 25; i++) if (sendToRules(tool2(`/cm/p/h${i}.html`), "valid")) sent++;
assert.equal(sent, 0);
assert.ok(sendToRules(tool2("/.env"), "valid"));
console.log("crawlpay: ok");
