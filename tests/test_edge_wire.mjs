#!/usr/bin/env node
// The request row's network and connection fields (Nan, 2026-11-26: "Network + TLS, everyone").
//
//   node tests/test_edge_wire.mjs
//
// Runs publish/edge_gate.js record() with a stub Analytics Engine and a request
// carrying the request.cf fields Cloudflare gives every plan.
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const { record } = await import(join(ROOT, "publish/edge_gate.js"));

let failures = 0;
const eq = (a, b, m = "") => { if (a !== b) { failures++; console.log(`  FAIL ${m} ${JSON.stringify(a)} != ${JSON.stringify(b)}`); } };
const ok = (c, m) => { if (!c) { failures++; console.log(`  FAIL ${m}`); } };

const CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";
const CF = {
  country: "TH", asn: 131445, asOrganization: "Advanced Wireless Network Company Limited", colo: "BKK",
  httpProtocol: "HTTP/2", tlsVersion: "TLSv1.3", tlsCipher: "AEAD-AES128-GCM-SHA256",
  tlsClientCiphersSha1: "GXSPDLP4G3X+prK73a4wBuOaHRc=", tlsClientExtensionsSha1: "OWFiM2I5ZDc0YWI0YWYzZmFkMGU0ZjhlYjhiYmVkMjgxNTU5YTU2Mg==",
  tlsClientHelloLength: "508", clientTcpRtt: 22, tlsClientRandom: "c2VjcmV0LXJhbmRvbS1wZXItY29ubmVjdGlvbg==",
};

function hit(path, { cf = CF, headers = {}, status = 200, xmdn = null } = {}) {
  const rows = [];
  const env = { TRAFFIC: { writeDataPoint: (r) => rows.push(r) } };
  const h = new Headers({ "user-agent": CHROME, "sec-fetch-mode": "navigate", "sec-fetch-dest": "document", "sec-fetch-site": "none", "accept-language": "th-TH", ...headers });
  const request = { url: "https://motdang.net" + path, method: "GET", headers: h, cf: cf || undefined };
  const rh = new Headers(); if (xmdn !== null) rh.set("x-md-n", String(xmdn));
  record(request, { status, headers: rh }, env, 12);
  return rows;
}

const t = (name, fn) => { const before = failures; fn(); console.log(`  ${failures === before ? "ok  " : "FAIL"} ${name}`); };

t("a page row fills all twenty blobs and seven doubles", () => {
  const [r] = hit("/index.html");
  eq(r.blobs.length, 20, "blobs:");
  eq(r.doubles.length, 7, "doubles:");
  eq(r.blobs[0], "motdang.net"); eq(r.blobs[1], "human"); eq(r.blobs[3], "/index.html");
  eq(r.blobs[4], "TH"); eq(r.blobs[5], "200"); eq(r.blobs[7], "GET");
  for (const i of [8, 9, 10, 11, 12, 13]) eq(r.blobs[i], "", `blob${i + 1} empty:`);
  eq(r.doubles[0], 1); eq(r.doubles[1], 200); eq(r.doubles[2], 12);
  eq(r.doubles[3], 0, "double4 pad:"); eq(r.doubles[4], 0, "double5 pad:");
});

t("the network and connection land at blob15–20, double6–7", () => {
  const [r] = hit("/index.html");
  eq(r.blobs[14], "131445", "blob15 asn:");
  eq(r.blobs[15], "Advanced Wireless Network Company Limited", "blob16 owner:");
  eq(r.blobs[16], "BKK", "blob17 colo:");
  eq(r.blobs[17], "HTTP/2 TLSv1.3 AEAD-AES128-GCM-SHA256", "blob18 connection:");
  eq(r.blobs[18], CF.tlsClientCiphersSha1, "blob19 ciphers:");
  eq(r.blobs[19], CF.tlsClientExtensionsSha1, "blob20 extensions:");
  eq(r.doubles[5], 22, "double6 rtt:");
  eq(r.doubles[6], 508, "double7 hello:");
});

t("a search row keeps its view at 9–11 and double4–5, network still at 15", () => {
  const [r] = hit("/api/v1/search?q=khao%20soi&bbox=98.9,18.7,99.1,18.9", { xmdn: 0 });
  eq(r.blobs[8], "search"); ok(r.blobs[9].includes(","), "blob10 cell"); eq(r.blobs[10], "khao soi");
  eq(r.doubles[4], 0, "double5 found:"); ok(r.doubles[3] > 0, "double4 zoom");
  eq(r.blobs[14], "131445"); eq(r.blobs.length, 20);
});

t("no request.cf (a test, a local run) writes empty fields, not an error", () => {
  const [r] = hit("/index.html", { cf: null });
  eq(r.blobs.length, 20); eq(r.blobs[4], "XX");
  for (const i of [14, 15, 16, 17, 18, 19]) eq(r.blobs[i], "", `blob${i + 1}:`);
  eq(r.doubles[5], -1); eq(r.doubles[6], -1);
});

t("QUIC round-trip time is used when there is no TCP one", () => {
  const { clientTcpRtt, ...rest } = CF;
  const [r] = hit("/index.html", { cf: { ...rest, httpProtocol: "HTTP/3", clientQuicRtt: 41 } });
  eq(r.doubles[5], 41);
});

t("no IP address, cookie, credential or per-connection random reaches the row", () => {
  const [r] = hit("/index.html", { headers: { cookie: "sessionid=abc123", "cf-connecting-ip": "203.0.113.44",
    "x-forwarded-for": "203.0.113.44", authorization: "Bearer sekrit" } });
  const s = JSON.stringify(r);
  for (const leak of ["203.0.113.44", "sessionid", "abc123", "sekrit", CF.tlsClientRandom]) ok(!s.includes(leak), `${leak} reached the row`);
});

t("an over-long network owner is cut at 64", () => {
  const [r] = hit("/index.html", { cf: { ...CF, asOrganization: "x".repeat(200) } });
  eq(r.blobs[15].length, 64);
});

t("a map beacon still writes no request row", () => {
  eq(hit("/api/map").length, 0);
});

console.log(failures ? `\n${failures} failed` : "\nall green");
process.exit(failures ? 1 : 0);
