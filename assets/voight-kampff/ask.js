/* Ask the log (2026-11-26): SQL over the Voight-Kampff data files, in the reader's browser.
 * DuckDB-WASM 1.32.0 (MIT) and Apache Arrow 17 (Apache-2.0), served from motdang.net
 * itself at /voight-kampff/data/lib/. Loaded on the first Ask, about 8 MB.
 * `bots` and `people` are views over the days picked; a question is a link:
 * /voight-kampff/?d=7#ask=<the SQL, base64url>. */
const LIB = "/voight-kampff/data/lib/duckdb-1.32.0/";
const DATA = location.origin + "/voight-kampff/data/";
const root = document.querySelector(".ask");
const $ = (id) => document.getElementById(id);
const sqlBox = $("ask-sql"), state = $("ask-state"), out = $("ask-out"), daysSel = $("ask-days");

const QUESTIONS = [
  ["ใครขอมากที่สุด", "Who asked most", "SELECT caller, kind, SUM(weight*counted) AS requests\nFROM bots GROUP BY caller, kind ORDER BY requests DESC LIMIT 20"],
  ["ใครอ่าน robots.txt", "Who reads robots.txt", "SELECT caller, SUM(weight*counted) AS asks, MIN(time) AS first\nFROM bots WHERE path = '/robots.txt' GROUP BY caller ORDER BY asks DESC LIMIT 25"],
  ["ทีละชั่วโมง", "Hour by hour", "SELECT hour(time + INTERVAL 7 HOUR) AS chiang_mai_hour,\n  SUM(weight*counted) FILTER (kind = 'ai') AS ai,\n  SUM(weight*counted) FILTER (kind = 'search') AS search,\n  SUM(weight*counted) AS everyone\nFROM bots GROUP BY 1 ORDER BY 1"],
  ["ประตูผิด", "Wrong doors (404)", "SELECT path, SUM(weight*counted) AS knocks, COUNT(DISTINCT caller) AS callers\nFROM bots WHERE status = 404 GROUP BY path ORDER BY knocks DESC LIMIT 25"],
  ["หน้ากาก", "Masks", "SELECT ciphers_sha1, COUNT(DISTINCT caller) AS names,\n  string_agg(DISTINCT caller, ', ') AS wearing, SUM(weight*counted) AS requests\nFROM bots WHERE ciphers_sha1 IS NOT NULL\nGROUP BY 1 ORDER BY names DESC, requests DESC LIMIT 15"],
  ["แสง", "Light", "SELECT caller, network, colo, MIN(rtt_ms) AS rtt_ms,\n  (MIN(rtt_ms) + 1) * 100 AS within_km, SUM(weight*counted) AS requests\nFROM bots WHERE rtt_ms IS NOT NULL\nGROUP BY ALL HAVING requests > 50 ORDER BY requests DESC LIMIT 25"],
  ["คำค้นที่ไม่เจอ", "Searches that found nothing", "SELECT f11 AS words, caller, SUM(weight) AS times\nFROM bots WHERE f9 = 'search' AND f11 IS NOT NULL\nGROUP BY ALL ORDER BY times DESC LIMIT 30"],
  ["ล่าสุด 100", "The last 100", "SELECT time, caller, path, status, country, network\nFROM bots ORDER BY time DESC LIMIT 100"],
  ["คนทีละหน้า", "People, page by page", "SELECT path, SUM(requests) AS requests, COUNT(DISTINCT country) AS countries\nFROM people GROUP BY path ORDER BY requests DESC LIMIT 25"],
];

let db = null, conn = null, index = null, lastRows = null, viewDays = null;

const b64e = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64d = (s) => decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/"))));

function say(th, en, cls) {
  state.textContent = "";
  state.className = "src" + (cls ? " " + cls : "");
  state.appendChild(document.createTextNode(th + " · " + en));
}

async function boot() {
  if (conn) return;
  say("กำลังโหลด DuckDB", "loading DuckDB, about 8 MB");
  const duck = await import(LIB + "duckdb.mjs");
  const bundle = await duck.selectBundle({
    mvp: { mainModule: LIB + "duckdb-mvp.wasm", mainWorker: LIB + "duckdb-browser-mvp.worker.js" },
    eh: { mainModule: LIB + "duckdb-eh.wasm", mainWorker: LIB + "duckdb-browser-eh.worker.js" },
  });
  const worker = new Worker(bundle.mainWorker);
  db = new duck.AsyncDuckDB(new duck.ConsoleLogger(4), worker);
  await db.instantiate(bundle.mainModule);
  conn = await db.connect();
  // DuckDB's Parquet reader is an extension; it comes from here too, not from extensions.duckdb.org
  const ext = location.origin + LIB.replace(/duckdb-[\d.]+\/$/, "") + "ext";
  await conn.query(`SET custom_extension_repository = '${ext}'`);
  await conn.query(`SET autoinstall_extension_repository = '${ext}'`);
  await conn.query("LOAD parquet");
}

async function views() {
  const want = daysSel.value;
  if (viewDays === want) return;
  if (!index) index = await (await fetch(DATA + "index.json")).json();
  const days = index.days || [];
  const pick = want === "all" ? days : days.slice(-Number(want));
  const q = (xs) => "[" + xs.map((x) => "'" + DATA + x + "'").join(", ") + "]";
  await conn.query(`CREATE OR REPLACE VIEW bots AS SELECT * FROM read_parquet(${q(pick.map((d) => d.files.parquet.path))})`);
  await conn.query(`CREATE OR REPLACE VIEW people AS SELECT * FROM read_csv(${q(pick.map((d) => d.files.people.path))}, header = true)`);
  viewDays = want;
}

function cell(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "bigint") return Number(v).toLocaleString("en-US");
  if (typeof v === "number") return Number.isInteger(v) ? v.toLocaleString("en-US") : v.toLocaleString("en-US", { maximumFractionDigits: 3 });
  if (v instanceof Date) return v.toISOString().replace(".000Z", "Z");
  return String(v);
}

function render(table) {
  const cols = table.schema.fields.map((f) => f.name);
  const rows = table.toArray().map((r) => r.toJSON ? r.toJSON() : r);
  lastRows = { cols, rows };
  out.textContent = "";
  const t = document.createElement("table"), h = document.createElement("tr");
  cols.forEach((c) => { const th = document.createElement("th"); th.textContent = c; h.appendChild(th); });
  t.appendChild(h);
  // a bar beside the last number column, so the answer reads at a glance
  const numCol = [...cols].reverse().find((c) => rows.length && rows.every((r) => typeof r[c] === "number" || typeof r[c] === "bigint" || r[c] == null));
  const top = numCol ? Math.max(1, ...rows.map((r) => Number(r[numCol] || 0))) : 1;
  rows.slice(0, 500).forEach((r) => {
    const tr = document.createElement("tr");
    cols.forEach((c) => {
      const td = document.createElement("td");
      const v = r[c];
      td.textContent = cell(v);
      td.title = cell(v);
      if (typeof v === "number" || typeof v === "bigint") td.className = "n";
      if (c === numCol && v != null) { const b = document.createElement("span"); b.className = "bar"; b.style.width = Math.max(2, 80 * Number(v) / top) + "px"; td.appendChild(b); }
      tr.appendChild(td);
    });
    t.appendChild(tr);
  });
  out.appendChild(t);
  $("ask-csv").hidden = !rows.length;
}

async function run() {
  const sql = sqlBox.value.trim();
  if (!sql) return;
  const t0 = performance.now();
  try {
    await boot();
    say("กำลังอ่านไฟล์", "reading the files");
    await views();
    const res = await conn.query(sql);
    render(res);
    const ms = Math.round(performance.now() - t0);
    say(`${res.numRows.toLocaleString("en-US")} แถว ใน ${ms} ms`, `${res.numRows.toLocaleString("en-US")} rows in ${ms} ms`);
  } catch (e) {
    say("ถามไม่ได้", String(e && e.message || e).slice(0, 400), "err");
  }
}

function link() {
  return location.origin + "/voight-kampff/?d=" + daysSel.value + "#ask=" + b64e(sqlBox.value.trim());
}

if (root) {
  const box = root.querySelector(".askq");
  QUESTIONS.forEach(([th, en, q]) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = th + " · " + en;
    b.addEventListener("click", () => {
      box.querySelectorAll("button.on").forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
      sqlBox.value = q;
      run();
    });
    box.appendChild(b);
  });
  $("ask-run").addEventListener("click", run);
  sqlBox.addEventListener("keydown", (e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") run(); });
  daysSel.addEventListener("change", () => { if (conn) run(); });
  $("ask-link").addEventListener("click", async () => {
    const u = link();
    try { await navigator.clipboard.writeText(u); $("ask-link").textContent = "คัดลอกแล้ว · Copied"; }
    catch { prompt("Link", u); }
    history.replaceState(null, "", u);
    setTimeout(() => { $("ask-link").textContent = "ลิงก์ · Copy link"; }, 1600);
  });
  $("ask-csv").addEventListener("click", () => {
    if (!lastRows) return;
    const raw = (v) => v == null ? "" : v instanceof Date ? v.toISOString() : String(v);
    const esc = (v) => { const s = raw(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const text = [lastRows.cols.join(","), ...lastRows.rows.map((r) => lastRows.cols.map((c) => esc(r[c])).join(","))].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
    a.download = "voight-kampff-answer.csv";
    a.click();
  });
  const m = location.hash.match(/^#ask=([A-Za-z0-9_-]+)/);
  const d = new URLSearchParams(location.search).get("d");
  if (d && [...daysSel.options].some((o) => o.value === d)) daysSel.value = d;
  if (m) {
    try { sqlBox.value = b64d(m[1]); } catch { /* the default question */ }
    document.getElementById("ask").scrollIntoView({ block: "start" });
    run();
  }
}
