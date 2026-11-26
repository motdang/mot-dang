/* vk-data — the Voight-Kampff request log as files, at motdang.net/voight-kampff/data/.
 *
 * Her ask 2026-11-26: "downloadable data that's surprisingly granular (I'm open
 * about traffic and most things I do)"; her pick the same day: people as counts only.
 * vk_export.py writes one Chiang Mai day a file into the R2 bucket motdang-vk-data;
 * this Worker serves them, because the site's deploy mirrors
 * voight-kampff/ in mot-dang-site and would delete anything it did not build.
 *
 * GET/HEAD with Range (DuckDB reads Parquet in ranges), ETag and If-None-Match,
 * CORS open so a notebook anywhere can read them. /voight-kampff/data/ is a page
 * built from index.json. The site Worker hands these paths here (service binding
 * VKDATA, publish/worker.js) after its gate, and counts them in traffic_eye. */

const TYPES = {
  parquet: "application/vnd.apache.parquet",
  gz: "application/gzip",
  json: "application/json; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  wasm: "application/wasm",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  png: "image/png",
  svg: "image/svg+xml",
  html: "text/html; charset=utf-8",
};
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, HEAD, OPTIONS",
  "access-control-allow-headers": "range, if-none-match, content-type",
  "access-control-expose-headers": "content-range, content-length, etag, accept-ranges, content-type",
};
const ROOT = "voight-kampff/data/";

function cacheFor(key) {
  if (key.startsWith(ROOT + "lib/")) return "public, max-age=31536000, immutable";
  if (/\/\d{4}-\d{2}-\d{2}\.(parquet|csv\.gz)$/.test(key)) return "public, max-age=86400";
  return "public, max-age=300";
}

export default {
  fetch(request, env) {
    return serve(request, env);
  },
};

async function serve(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("GET or HEAD", { status: 405, headers: { allow: "GET, HEAD, OPTIONS", ...CORS } });
  }
  const url = new URL(request.url);
  let key = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  if (key === "voight-kampff/data") return Response.redirect(url.origin + "/" + ROOT, 301);
  if (key === ROOT || key === ROOT + "index.html") return page(env, request);
  if (!key.startsWith(ROOT) || key.includes("..")) return notFound();

  /* The in-page database (DuckDB, 34 MB of WebAssembly) sits gzipped under lib/
   * and goes out as it is, with its encoding named: about 8 MB on the wire. */
  if (key.startsWith(ROOT + "lib/")) {
    const z = await env.DATA.get(key + ".gz", { onlyIf: request.headers });
    if (z) {
      const ext = key.split(".").pop().toLowerCase();
      const h = new Headers(CORS);
      h.set("content-type", TYPES[ext] || "application/octet-stream");
      h.set("cache-control", cacheFor(key));
      h.set("etag", z.httpEtag);
      if (!("body" in z) || !z.body) return new Response(null, { status: 304, headers: h });
      h.set("content-encoding", "gzip");
      h.set("content-length", String(z.size));
      return new Response(request.method === "HEAD" ? null : z.body, { status: 200, headers: h, encodeBody: "manual" });
    }
  }

  const opts = { onlyIf: request.headers };
  const range = request.headers.get("range");
  if (range) opts.range = request.headers;
  const obj = await env.DATA.get(key, opts);
  if (!obj) return notFound();

  const ext = key.split(".").pop().toLowerCase();
  const h = new Headers(CORS);
  h.set("content-type", TYPES[ext] || "application/octet-stream");
  h.set("cache-control", cacheFor(key));
  h.set("etag", obj.httpEtag);
  h.set("accept-ranges", "bytes");
  if (obj.uploaded) h.set("last-modified", obj.uploaded.toUTCString());
  if (ext === "gz") h.set("content-disposition", `attachment; filename="${key.split("/").slice(-2).join("-")}"`);

  if (!("body" in obj) || !obj.body) {
    // onlyIf failed: a 304 for If-None-Match, a 412 for anything else
    return new Response(null, { status: request.headers.get("if-none-match") ? 304 : 412, headers: h });
  }
  if (range && obj.range) {
    const { offset = 0, length = obj.size - offset } = obj.range;
    h.set("content-range", `bytes ${offset}-${offset + length - 1}/${obj.size}`);
    h.set("content-length", String(length));
    return new Response(request.method === "HEAD" ? null : obj.body, { status: 206, headers: h });
  }
  h.set("content-length", String(obj.size));
  return new Response(request.method === "HEAD" ? null : obj.body, { status: 200, headers: h });
}

function notFound() {
  return new Response("Not found. The list: https://motdang.net/voight-kampff/data/\n",
    { status: 404, headers: { "content-type": TYPES.txt, ...CORS } });
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const mb = (b) => (b / 1e6).toFixed(1) + " MB";
const n = (x) => Number(x || 0).toLocaleString("en-US");
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "June", "July", "Aug", "Sept", "Oct", "Nov", "Dec"];
const day = (d) => { const [y, m, dd] = d.split("-"); return `${+dd} ${MON[+m - 1]} ${y}`; };

async function page(env, request) {
  const obj = await env.DATA.get(ROOT + "index.json");
  const ix = obj ? await obj.json() : { days: [] };
  const days = (ix.days || []).slice().reverse();
  const rows = days.reduce((a, x) => a + x.rows, 0);
  const bytes = days.reduce((a, x) => a + x.files.parquet.bytes, 0);
  const span = days.length ? `${day(days[days.length - 1].day)} – ${day(days[0].day)}` : "–";
  const links = ix.links || {};
  const elsewhere = [
    links.github ? `<a href="${esc(links.github)}">GitHub</a>` : "",
    links.huggingface ? `<a href="${esc(links.huggingface)}">Hugging Face</a>` : "",
  ].filter(Boolean).join(" · ");
  const list = days.map((x) => `<tr><td>${esc(day(x.day))}</td><td class="n">${n(x.rows)}</td>`
    + `<td class="n">${n(x.requests)}</td><td><a href="/${ROOT}${esc(x.files.parquet.path)}">Parquet</a> `
    + `<small>${mb(x.files.parquet.bytes)}</small></td><td><a href="/${ROOT}${esc(x.files.csv.path)}">CSV</a> `
    + `<small>${mb(x.files.csv.bytes)}</small></td><td><a href="/${ROOT}${esc(x.files.people.path)}">`
    + `<span class="th">คน</span> people</a></td></tr>`).join("");
  const latest = days[0] ? days[0].day : "2026-11-25";
  const html = `<!doctype html>
<html lang="th">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Voight-Kampff data · มดแดง</title>
<meta name="description" content="Every bot request to motdang.net and hongdam.net since 8 Sept 2026, one file a day, to the second. ${n(rows)} rows. CC BY 4.0.">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#1a1147">
<link rel="canonical" href="https://motdang.net/${ROOT}">
<link rel="icon" href="/ant.svg">
<meta property="og:title" content="Voight-Kampff data · motdang.net">
<meta property="og:description" content="${n(rows)} bot requests, one row each, to the second: network, Cloudflare city, TLS fingerprint, round trip. Free to download, CC BY 4.0.">
<meta property="og:url" content="https://motdang.net/${ROOT}">
<meta property="og:image" content="https://motdang.net/${ROOT}card.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="VOIGHT-KAMPFF DATA. Every bot request to motdang.net, one row each, to the second.">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">
<link rel="stylesheet" href="/voight-kampff/vk.css">
<div class="rain" aria-hidden="true"></div>
<header>
 <img src="/ant.svg" alt="">
 <h1>VK DATA</h1>
 <p class="th">ข้อมูลทุกคำขอของบอท <span class="rom">kho mun thuk kham kho khong bot</span>
  <span class="en">Every bot request, one row each</span></p>
</header>
<main>
<div class="stitch" aria-hidden="true"></div>
<section class="card">
 <dl class="id">
  <dt>DAYS</dt><dd><span class="big">${days.length}</span><br>${esc(span)}, <span class="th">วันละไฟล์ ตามเวลาเชียงใหม่</span> <span class="en" style="display:inline">one file a Chiang Mai day</span></dd>
  <dt>ROWS</dt><dd><span class="big">${n(rows)}</span><br><span class="th">หนึ่งคำขอหนึ่งแถว ละเอียดถึงวินาที</span> <span class="en" style="display:inline">one request a row, to the second</span></dd>
  <dt>SIZE</dt><dd>${mb(bytes)} Parquet</dd>
  <dt>LICENCE</dt><dd>CC BY 4.0 · <span class="th">ใช้ได้ ใส่ชื่อเรา</span> <span class="en" style="display:inline">use it, credit motdang.net Voight-Kampff</span></dd>
 </dl>
</section>
<div class="stitch" aria-hidden="true"></div>
<section>
 <h2 class="th">ในไฟล์มีอะไร <span class="en">In each file</span></h2>
 <p class="th">บอททุกตัวที่มาขอหน้าเว็บ motdang.net และ hongdam.net: เวลา หน้า ประเทศ สถานะ ชื่อที่มันบอก เครือข่าย ศูนย์ข้อมูล Cloudflare ที่ตอบ ลายนิ้วมือ TLS และเวลาไปกลับ ไม่มีที่อยู่ IP คนนับเป็นยอดรวมรายชั่วโมงต่อหน้าและประเทศเท่านั้น
  <span class="en">Every bot that asked motdang.net and hongdam.net for a page: time, page, country, status, the name it gave, its network, the Cloudflare data centre that answered, its TLS fingerprint and round-trip time. No addresses. People appear only as hourly counts per page and country.</span></p>
 <p><a class="pill th" href="/voight-kampff/#ask">ถามบันทึก · Ask the log</a>
  <a class="pill alt" href="/${ROOT}README.txt">README</a>
  <a class="pill alt" href="/${ROOT}index.json">index.json</a></p>
 <p class="src">DuckDB: <code>SELECT caller, SUM(weight*counted) n FROM 'https://motdang.net/${ROOT}bots/${esc(latest)}.parquet' GROUP BY caller ORDER BY n DESC LIMIT 20;</code>${elsewhere ? "<br>Also on " + elsewhere : ""}</p>
</section>
<div class="stitch" aria-hidden="true"></div>
<section class="more">
 <h2 class="th">ไฟล์รายวัน <span class="en">Day by day</span></h2>
 <div class="scroll"><table>
  <tr><th>DAY</th><th class="r">ROWS</th><th class="r">REQUESTS</th><th>BOTS</th><th></th><th>PEOPLE</th></tr>
  ${list}
 </table></div>
 <p class="src">Source: the request log the motdang.net and hongdam.net Workers write on every request (Cloudflare Workers Analytics Engine). New day each night. Updated ${esc(ix.updated || "")}.</p>
</section>
<p style="text-align:center"><a class="pill th" href="/voight-kampff/">Voight-Kampff</a></p>
</main>
</html>`;
  return new Response(request.method === "HEAD" ? null : html, {
    headers: { "content-type": TYPES.html, "cache-control": "public, max-age=300", ...CORS },
  });
}
